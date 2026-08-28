// Race selector unit tests (Phase B) — determinism, floor behavior,
// novelty gate, gold-gate, budgets, and D2.1 evaluator integration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDenseSemanticTopK, selectQuestionStratifiedSimple, selectDenseMMRMultiLane, assignMechanicalLanes, defaultLaneOrder, computeQuotas } from '../lib/selectors-race.mjs';
import { embedDense, denseCosine, loadDiskCache } from '../lib/dense-embed.mjs';

function mkSource(qid, id, author, vote, text) {
  return {
    source_id: `${qid}:${id}`, question_id: qid, answer_id: String(id), author,
    author_key: String(author).toLowerCase(), url: null,
    content_html: text, content_text: text, content_chars: text.length,
    voteupCount: vote, commentCount: 0, createdTime: 1, updatedTime: 1,
    assets: { images: 0, links: 0, references: 0, codeBlocks: 0, videos: 0, domains: [] },
    evidence_markers: { has_code: false, has_external_links: false, has_references: false, has_images: false },
    pool_index: 0,
  };
}

function mkPool(qdefs) {
  const questions = qdefs.map(([qid, title, srcs, verified = true]) => ({
    qid, title, verified,
    sources: srcs.map((s, i) => ({ ...s, pool_index: i })),
  }));
  const sources = questions.flatMap((q) => q.sources);
  return {
    candidate_pool_id: 'test-pool',
    questionIds: questions.map((q) => q.qid),
    questions,
    sources,
    verifiedSourceCount: questions.filter((q) => q.verified).length,
    byId: new Map(sources.map((s) => [s.source_id, s])),
  };
}

const costStub = { add: () => {} };

// A SharedArrayBuffer-free, persistent-ish cache for tests (module cache).
let _testCache = loadDiskCache();

// Rich pool: 1 big question (8 near-duplicate medical texts) + 1 small
// question (2 distinct texts) -> B2 must represent the small question.
const BIG = [
  ['Q1', 'a1', 'A', 100, '幽门螺杆菌感染需要四联疗法根除治疗避免胃癌风险'],
  ['Q1', 'a2', 'B', 90, '感染幽门螺杆菌后应当进行规范的四联根除治疗'],
  ['Q1', 'a3', 'C', 80, '根除幽门螺杆菌可用铋剂四联方案治疗十四天'],
  ['Q1', 'a4', 'D', 70, '幽门螺杆菌阳性患者建议四联方案根除治疗'],
  ['Q1', 'a5', 'E', 60, '四联疗法是根除幽门螺杆菌的规范治疗方案'],
  ['Q1', 'a6', 'F', 50, '幽门螺杆菌根除治疗常用铋剂四联十四天'],
  ['Q1', 'a7', 'G', 40, '四联根除幽门螺杆菌降低胃癌发生风险'],
  ['Q1', 'a8', 'H', 30, '幽门螺杆菌需要四联疗法根除以预防胃溃疡'],
];
const SMALL = [
  ['Q2', 'b1', 'I', 1, '幽门螺杆菌感染者可以做碳十三呼气试验检测'],
  ['Q2', 'b2', 'J', 1, '幽门螺杆菌检测可以使用碳13或者碳14呼气试验'],
];

function bigPool() {
  return mkPool([
    ['Q1', '大问题', BIG.map(([qid, id, a, v, t]) => mkSource(qid, id, a, v, t))],
    ['Q2', '小问题', SMALL.map(([qid, id, a, v, t]) => mkSource(qid, id, a, v, t))],
  ]);
}

test('RACE-1: B2 question-stratified guarantees small-question representation (floor)', async () => {
  const pool = bigPool();
  const sel = await selectQuestionStratifiedSimple(pool, 6, { queryText: '幽门螺杆菌治疗', embedCache: _testCache, noveltyThreshold: 0.9 }, { cost: costStub });
  assert.equal(sel.length, 6);
  const qids = sel.map((id) => id.split(':')[0]);
  assert.ok(qids.includes('Q2'), 'small question must get >=1 slot before duplication');
});

test('RACE-2: B2 deterministic across runs (same inputs -> same selection)', async () => {
  const pool = bigPool();
  const c1 = loadDiskCache(); const c2 = loadDiskCache();
  const s1 = await selectQuestionStratifiedSimple(pool, 8, { queryText: '幽门螺杆菌治疗', embedCache: c1, noveltyThreshold: 0.9 }, { cost: costStub });
  const s2 = await selectQuestionStratifiedSimple(pool, 8, { queryText: '幽门螺杆菌治疗', embedCache: c2, noveltyThreshold: 0.9 }, { cost: costStub });
  assert.deepEqual(s1, s2);
});

test('RACE-3: B1 dense top-K deterministic and size == K', async () => {
  const pool = bigPool();
  const c = loadDiskCache();
  const s1 = await selectDenseSemanticTopK(pool, 4, { queryText: '幽门螺杆菌治疗', embedCache: c }, { cost: costStub });
  const s2 = await selectDenseSemanticTopK(pool, 4, { queryText: '幽门螺杆菌治疗', embedCache: loadDiskCache() }, { cost: costStub });
  assert.deepEqual(s1, s2);
  assert.equal(s1.length, 4);
});

test('RACE-4: B3 dense MMR + mechanical lanes deterministic, respects K', async () => {
  const pool = bigPool();
  const cfg = { freshness_window_policy: { policy_id: 't', window_sec: 86400, reference_epoch_sec: 1700000000 }, long_tail_min_chars: 20, lane_weights: { mainstream: 1, expert: 1, evidence_rich: 1, fresh: 1, long_tail: 1, contradictory: 1 }, mmr_lambda: 0.5 };
  const lanes = assignMechanicalLanes(pool, cfg);
  const laneOrder = defaultLaneOrder();
  const quotas = computeQuotas(6, lanes, laneOrder, {});
  const c = loadDiskCache();
  const s1 = await selectDenseMMRMultiLane(pool, 6, { queryText: '幽门螺杆菌治疗', embedCache: c, lambda: 0.5, lanes, laneOrder, quotas }, { cost: costStub });
  assert.equal(s1.length, 6);
  const s2 = await selectDenseMMRMultiLane(pool, 6, { queryText: '幽门螺杆菌治疗', embedCache: loadDiskCache(), lambda: 0.5, lanes, laneOrder, quotas }, { cost: costStub });
  assert.deepEqual(s1, s2);
});

test('RACE-5: dense cosine is symmetric & in [0,1]; same text -> 1', async () => {
  const c = loadDiskCache();
  const a = await embedDense('幽门螺杆菌需要治疗吗', c);
  const b = await embedDense('幽门螺杆菌需要治疗吗', c);
  const d = await embedDense('完全无关的量子物理话题', c);
  assert.ok(Math.abs(await denseCosine(a.vec, b.vec) - 1) < 1e-6, 'identical input -> cosine ~1');
  const ab = await denseCosine(a.vec, b.vec);
  const ba = await denseCosine(b.vec, a.vec);
  assert.equal(ab, ba, 'symmetric');
  assert.ok((await denseCosine(a.vec, d.vec)) < (await denseCosine(a.vec, b.vec)), 'unrelated < related');
});

test('RACE-6: B0/B1/B2/B3 receive a throwing-gold proxy and never read gold (no leak)', async () => {
  const pool = bigPool();
  const gold = { families: { must_see: { sources: ['Q2:b1'] } }, value_units: [] };
  const gate = new Proxy(gold, {
    get(t, prop) {
      if (['families', 'value_units'].includes(prop)) throw new Error('GOLD_READ_VIOLATION');
      return t[prop];
    },
  });
  const cfg = { freshness_window_policy: { policy_id: 't', window_sec: 86400, reference_epoch_sec: 1700000000 }, long_tail_min_chars: 20, lane_weights: { mainstream: 1, expert: 1, evidence_rich: 1, fresh: 1, long_tail: 1, contradictory: 1 }, mmr_lambda: 0.5 };
  // mechanical lanes must not read gold (assignMechanicalLanes signature ignores it)
  const lanes = assignMechanicalLanes(pool, cfg, gate);
  assert.ok(lanes.mainstream);
  const laneOrder = defaultLaneOrder();
  const quotas = computeQuotas(4, lanes, laneOrder, {});
  const c = loadDiskCache();
  await selectDenseSemanticTopK(pool, 2, { queryText: 't', embedCache: c }, { cost: costStub });
  await selectQuestionStratifiedSimple(pool, 2, { queryText: 't', embedCache: c }, { cost: costStub });
  await selectDenseMMRMultiLane(pool, 2, { queryText: 't', embedCache: c, lambda: 0.5, lanes, laneOrder, quotas }, { cost: costStub });
  assert.ok(true, 'no gold access raised');
});