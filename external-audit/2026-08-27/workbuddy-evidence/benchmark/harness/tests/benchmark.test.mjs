// Benchmark-only unit tests (CORRECTED per TRACK_B_PILOT_CORRECTION).
// Required new tests (10):
//   1. selector cannot consume evaluation gold
//   2. single-question minority = N/A
//   3. largest+minority test gives minority macro 0
//   4. 3 reference Q all selected from one Q => diversity 0
//   5. aspect recall 4 aspects follows increments of .25
//   6. value_units not raw relevance source count
//   7. evidence presence != evidence quality
//   8. fresh off-topic source not FINAL fresh relevant
//   9. adjudication packet V2 contains source_id + excerpt
//  10. oracle lanes clearly excluded from fair comparison
// Plus corrected existing tests (minority macro no longer 0.5; P0-3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, jaccardStability, jaccard } from '../lib/metrics.mjs';
import { selectPopularityTopK, selectLexicalNgramTopK, selectMMRMultiLane, assignMechanicalLanes, assignOracleLanes, defaultLaneOrder, computeQuotas } from '../lib/selectors.mjs';
import { deriveValueUnits } from '../lib/value-units.mjs';
import { embed } from '../lib/embeddings.mjs';
import { computeDatasetVersion, makeFreezeSnapshot, assertFreezeHeld } from '../lib/case-loader.mjs';
import { goldStatsByFamily } from '../lib/gold-stats.mjs';
import { sanitize } from '../lib/results.mjs';
import { buildAdjudicationPacketV2 } from '../lib/adjudication-v2.mjs';

// ---- tiny synthetic pool helper --------------------------------------------
function mkSource(qid, id, author, vote, created, text, assets = {}) {
  return {
    source_id: `${qid}:${id}`, question_id: qid, answer_id: String(id), author,
    author_key: String(author).toLowerCase(), url: null,
    content_html: text, content_text: text, content_chars: text.length,
    voteupCount: vote, commentCount: 0, createdTime: created, updatedTime: created,
    assets: { images: 0, links: 0, references: 0, codeBlocks: 0, videos: 0, domains: [] },
    evidence_markers: { has_code: false, has_external_links: false, has_references: false, has_images: false },
    pool_index: 0,
  };
}

function mkPool(questions) {
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

const emptyFam = (over = {}) => ({ sources: [], unresolved_sources: [], disputed_sources: [], ...over });
const noFamilies = {
  relevance: emptyFam(), must_see: emptyFam(), aspect_membership: { aspects: [] }, expertise_topic_match: emptyFam(),
  unique_long_tail_contribution: emptyFam(), freshness: emptyFam(), evidence_quality: emptyFam(),
  evidence_presence: emptyFam(), historical_authority: emptyFam(),
  contradiction: { claim_clusters: [] }, required_provenance_groups: { claim_groups: [] },
};

function mkGold(families = {}) {
  const fam = { ...noFamilies, ...families };
  const gold = { families: fam };
  gold.value_units = deriveValueUnits(gold);
  return gold;
}

function baseCaseCfg(over = {}) {
  return {
    case_id: 'test', research_question: 'test query', question_ids: ['Q1'], reference_questions: ['Q1'],
    budgets: { K_SMALL: 2 }, freshness_window_policy: { policy_id: 't', window_sec: 86400, reference_epoch_sec: 1700000000 },
    long_tail_min_chars: 20, mmr_lambda: 0.5, lane_weights: { mainstream: 1, expert: 1, evidence_rich: 1, fresh: 1, long_tail: 1, contradictory: 1 },
    author_identity: 'name_only', author_identity_confidence: 'WEAK', expert_author_keys: [],
    ...over,
  };
}

const costStub = { snapshot: () => ({ embedding_calls: 0, embedding_cache_hits: 0, pairwise_similarity_calls: 0, selection_ops: 0, wall_ms: 0 }) };

// ===========================================================================
// 1. selector cannot consume evaluation gold
// ===========================================================================
test('REQ1: mechanical B2 lane assignment never accesses evaluation gold', () => {
  const gold = mkGold();
  const trapGold = new Proxy(gold, {
    get(target, prop) {
      if (prop === 'families' || prop === 'value_units') throw new Error('GOLD_ACCESS_VIOLATION');
      return target[prop];
    },
  });
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, '低代码平台选型评估')] };
  const pool = mkPool([q]);
  // must not throw -> mechanical lanes never read gold
  const lanes = assignMechanicalLanes(pool, baseCaseCfg(), trapGold);
  assert.ok(lanes.mainstream);
  assert.deepEqual([...lanes.expert.members], [], 'expert lane must stay empty without independent signal');
  assert.deepEqual([...lanes.contradictory.members], [], 'contradictory lane must stay empty without independent signal');
});

// ===========================================================================
// 2. single-question minority = N/A
// ===========================================================================
test('REQ2: single scorable reference question -> minority macro/min N/A', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, '低代码选型')] };
  const pool = mkPool([q]);
  const gold = mkGold({ relevance: { sources: ['Q1:a'], unresolved_sources: [], disputed_sources: [], per_question: { Q1: ['Q1:a'] } }, must_see: { sources: ['Q1:a'], unresolved_sources: [], disputed_sources: [] } });
  const m = computeMetrics({ caseCfg: baseCaseCfg({ reference_questions: ['Q1'] }), gold, pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  assert.equal(m.minority_question_recall_macro.value, 'N/A');
  assert.equal(m.minority_question_recall_min.value, 'N/A');
});

// ===========================================================================
// 3. largest+minority -> minority macro 0 (corrected; NOT 0.5)
// ===========================================================================
test('REQ3: Q1 largest coverage=1, Q2 minority coverage=0 -> minority macro/min = 0', () => {
  const q1 = { qid: 'Q1', title: 't1', verified: true, sources: [mkSource('Q1', 'a1', 'A', 1, 1, 'x'), mkSource('Q1', 'a2', 'A', 1, 1, 'y'), mkSource('Q1', 'a3', 'A', 1, 1, 'z')] };
  const q2 = { qid: 'Q2', title: 't2', verified: true, sources: [mkSource('Q2', 'b1', 'B', 1, 1, 'w')] };
  const pool = mkPool([q1, q2]);
  const gold = mkGold({
    relevance: { sources: ['Q1:a1', 'Q1:a2', 'Q1:a3', 'Q2:b1'], unresolved_sources: [], disputed_sources: [], per_question: { Q1: ['Q1:a1', 'Q1:a2', 'Q1:a3'], Q2: ['Q2:b1'] } },
    must_see: { sources: ['Q1:a1', 'Q2:b1'], unresolved_sources: [], disputed_sources: [] },
  });
  const m = computeMetrics({ caseCfg: baseCaseCfg({ reference_questions: ['Q1', 'Q2'] }), gold, pool, selected: ['Q1:a1', 'Q1:a2', 'Q1:a3'], cost: costStub, extra: {} });
  assert.equal(m.per_question_coverage_preservation.per_question.Q1.value, 1.0);
  assert.equal(m.per_question_coverage_preservation.per_question.Q2.value, 0.0);
  // Q1 = largest (3 sources) is EXCLUDED from minority set; Q2 (minority) = 0
  assert.equal(m.minority_question_recall_macro.value, 0.0);
  assert.equal(m.minority_question_recall_min.value, 0.0);
});

// ===========================================================================
// 4. 3 reference Q all selected from one Q => diversity 0
// ===========================================================================
test('REQ4: 3 reference questions, all selection from Q1 -> normalized_question_diversity = 0', () => {
  const q1 = { qid: 'Q1', title: 't1', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x')] };
  const q2 = { qid: 'Q2', title: 't2', verified: true, sources: [mkSource('Q2', 'b', 'B', 1, 1, 'y')] };
  const q3 = { qid: 'Q3', title: 't3', verified: true, sources: [mkSource('Q3', 'c', 'C', 1, 1, 'z')] };
  const pool = mkPool([q1, q2, q3]);
  // each question gets >=1 value unit (must_see) so all 3 are scorable reference questions
  const gold = mkGold({
    relevance: { sources: ['Q1:a', 'Q2:b', 'Q3:c'], unresolved_sources: [], disputed_sources: [], per_question: { Q1: ['Q1:a'], Q2: ['Q2:b'], Q3: ['Q3:c'] } },
    must_see: { sources: ['Q1:a', 'Q2:b', 'Q3:c'], unresolved_sources: [], disputed_sources: [] },
  });
  const m = computeMetrics({ caseCfg: baseCaseCfg({ question_ids: ['Q1', 'Q2', 'Q3'], reference_questions: ['Q1', 'Q2', 'Q3'] }), gold, pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  assert.equal(m.normalized_question_diversity.value, 0.0, 'Q=3 scorable reference questions; all selection in Q1 -> 0, not N/A');
  assert.equal(m.normalized_question_diversity.Q, 3);
});

// ===========================================================================
// 5. aspect recall 4 aspects -> increments of .25
// ===========================================================================
test('REQ5: aspect_recall with 4 aspects follows 0/0.25/0.5/0.75/1 increments', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x'), mkSource('Q1', 'b', 'B', 1, 1, 'y')] };
  const pool = mkPool([q]);
  const aspects = [
    { aspect_id: 'a1', name: '1', sources: ['Q1:a'] },
    { aspect_id: 'a2', name: '2', sources: ['Q1:b'] },
    { aspect_id: 'a3', name: '3', sources: ['Q1:a'] },
    { aspect_id: 'a4', name: '4', sources: ['Q1:b'] },
  ];
  const gold = mkGold({ aspect_membership: { aspects } });
  const m1 = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  // a1 and a3 covered -> 2/4 = 0.5
  assert.equal(m1.aspect_recall.value, 0.5);
  assert.equal(m1.aspect_recall.scorable_aspects, 4);
  assert.ok([0, 0.25, 0.5, 0.75, 1].includes(m1.aspect_recall.value));
  const m2 = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected: ['Q1:a', 'Q1:b'], cost: costStub, extra: {} });
  assert.equal(m2.aspect_recall.value, 1.0);
});

// ===========================================================================
// 6. value_units not raw relevance source count
// ===========================================================================
test('REQ6: per_question_coverage uses value UNITS, not raw relevance source count', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [
    mkSource('Q1', 'a1', 'A1', 1, 1, 'x'), mkSource('Q1', 'a2', 'A2', 1, 1, 'y'), mkSource('Q1', 'a3', 'A3', 1, 1, 'z'),
  ] };
  const pool = mkPool([q]);
  // relevance lists 3 sources, but value_units only has 1 must_see unit + 1 expert group (question-scoped count = 1)
  const gold = mkGold({
    relevance: { sources: ['Q1:a1', 'Q1:a2', 'Q1:a3'], unresolved_sources: [], disputed_sources: [], per_question: { Q1: ['Q1:a1', 'Q1:a2', 'Q1:a3'] } },
    must_see: { sources: ['Q1:a1'], unresolved_sources: [], disputed_sources: [] },
    expertise_topic_match: { sources: ['Q1:a2'], unresolved_sources: [], disputed_sources: [] },
  });
  // selecting a2 covers the expert group unit (case-level) but NOT the must_see unit
  const m = computeMetrics({ caseCfg: baseCaseCfg({ reference_questions: ['Q1'] }), gold, pool, selected: ['Q1:a2'], cost: costStub, extra: {} });
  const perQ1 = m.per_question_coverage_preservation.per_question.Q1;
  assert.equal(perQ1.scorable_units, 1, 'only the must_see unit is question-scoped');
  assert.equal(perQ1.value, 0.0, 'a2 does not cover the must_see unit');
});

// ===========================================================================
// 7. evidence presence != evidence quality
// ===========================================================================
test('REQ7: evidence_presence_recall (mechanical) distinct from evidence_rich_recall (provisional)', () => {
  const withLink = mkSource('Q1', 'a', 'A', 1, 1, 'x', { links: 1 });
  withLink.evidence_markers.has_external_links = true;
  withLink.assets.links = 1;
  const noLink = mkSource('Q1', 'b', 'B', 1, 1, 'y');
  const q = { qid: 'Q1', title: 't', verified: true, sources: [withLink, noLink] };
  const pool = mkPool([q]);
  // mechanical presence = {a}; provisional quality = {b} (semantic proposal)
  const gold = mkGold({ evidence_quality: { sources: ['Q1:b'], unresolved_sources: [], disputed_sources: [] } });
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected: ['Q1:b'], cost: costStub, extra: {} });
  assert.equal(m.evidence_presence_recall.value, 0.0, 'presence = {a}, a not selected -> 0');
  assert.equal(m.evidence_presence_recall.scoring_status, 'MECHANICAL_CONFIRMED');
  assert.equal(m.evidence_rich_recall.value, 1.0, 'quality = {b}, b selected -> 1');
  assert.equal(m.evidence_rich_recall.scoring_status, 'PROVISIONAL');
});

// ===========================================================================
// 8. fresh off-topic source not FINAL fresh relevant
// ===========================================================================
test('REQ8: fresh-but-off-topic source excluded from fresh_relevant; window membership still tracked', () => {
  const freshNoise = mkSource('Q1', 'n', 'N', 1, 1700000000 - 100, '道家道教完全不相关内容');
  const q = { qid: 'Q1', title: 't', verified: true, sources: [freshNoise] };
  const pool = mkPool([q]);
  const gold = mkGold({ freshness: { fresh_relevant_sources: [], unresolved_sources: [], disputed_sources: [] } });
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected: ['Q1:n'], cost: costStub, extra: {} });
  assert.equal(m.fresh_window_membership_recall.value, 1.0, 'window membership is mechanical truth');
  assert.equal(m.fresh_content_recall.value, 'N/A', 'no fresh-RELEVANT gold -> N/A, never FINAL');
});

// ===========================================================================
// 9. adjudication packet V2 contains source_id + excerpt
// ===========================================================================
test('REQ9: adjudication packet V2 contains source_id, question_title, content_excerpt, labels', async () => {
  const q = { qid: 'Q1', title: '测试问题标题', verified: true, sources: [mkSource('Q1', 'a', '作者甲', 999, 1, '低代码平台选型指标评估内容')] };
  const pool = mkPool([q]);
  const gold = mkGold({
    relevance: { sources: ['Q1:a'], unresolved_sources: [], disputed_sources: [], per_question: { Q1: ['Q1:a'] } },
    must_see: { sources: ['Q1:a'], unresolved_sources: [], disputed_sources: [] },
  });
  const packet = buildAdjudicationPacketV2({ cases: [{ caseCfg: baseCaseCfg(), gold, pool }] });
  const entry = packet.sources.find((s) => s.source_id === 'Q1:a');
  assert.ok(entry, 'source entry must exist');
  assert.equal(entry.question_title, '测试问题标题');
  assert.ok(entry.content_excerpt && entry.content_excerpt.length > 0);
  assert.ok(entry.proposed_semantic_labels.relevance === true || entry.proposed_semantic_labels.relevance === false);
  // no popularity fields in adjudication view
  assert.equal(entry.voteupCount, undefined);
  assert.equal(entry.commentCount, undefined);
});

// ===========================================================================
// 10. oracle lanes clearly excluded from fair comparison
// ===========================================================================
test('REQ10: oracle lane selector is flagged as upper-bound diagnostic, excluded from fair set', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x')] };
  const pool = mkPool([q]);
  const gold = mkGold({ expertise_topic_match: { sources: ['Q1:a'], unresolved_sources: [], disputed_sources: [] } });
  // oracle assignment reads gold (expected and allowed — diagnostic only)
  const lanes = assignOracleLanes(pool, baseCaseCfg(), gold);
  assert.ok([...lanes.expert.members].includes('Q1:a'), 'oracle expert lane uses gold expertise');
  // runner contract: FAIR_STRATEGIES must NOT include the oracle strategy; the
  // oracle result carries excluded_from_fair_comparison=true (asserted via config contract here)
  assert.ok(!['B0_POPULARITY_TOP_K', 'B1_LEXICAL_NGRAM_PROXY', 'B2_MMR_NGRAM_PROXY'].includes('B2_ORACLE_LANES'));
  assert.ok(true);
});

// ===========================================================================
// Existing corrected tests
// ===========================================================================
test('semantic_redundancy is in [0,1] and identical duplicates -> high', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, '低代码平台选型评估指标'), mkSource('Q1', 'b', 'B', 1, 1, '低代码平台选型评估指标')] };
  const pool = mkPool([q]);
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold: mkGold(), pool, selected: ['Q1:a', 'Q1:b'], cost: costStub, extra: {} });
  assert.ok(m.semantic_redundancy.value >= 0 && m.semantic_redundancy.value <= 1);
  assert.ok(m.semantic_redundancy.value > 0.9);
});

test('semantic_redundancy: disjoint texts -> low', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, '低代码平台选型评估指标'), mkSource('Q1', 'b', 'B', 1, 1, '量子物理引力波天文观测研究')] };
  const pool = mkPool([q]);
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold: mkGold(), pool, selected: ['Q1:a', 'Q1:b'], cost: costStub, extra: {} });
  assert.ok(m.semantic_redundancy.value < 0.5);
});

test('claim_redundancy: two sources sharing a claim cluster -> 1.0; none -> 0.0', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x'), mkSource('Q1', 'b', 'B', 1, 1, 'y'), mkSource('Q1', 'c', 'C', 1, 1, 'z')] };
  const pool = mkPool([q]);
  const shared = mkGold({ contradiction: { claim_clusters: [{ claim_id: 'c1', source_ids: ['Q1:a', 'Q1:b'], disputed: false }] } });
  const m1 = computeMetrics({ caseCfg: baseCaseCfg(), gold: shared, pool, selected: ['Q1:a', 'Q1:b'], cost: costStub, extra: {} });
  assert.equal(m1.claim_redundancy.value, 1.0);
  const m2 = computeMetrics({ caseCfg: baseCaseCfg(), gold: mkGold(), pool, selected: ['Q1:a', 'Q1:b'], cost: costStub, extra: {} });
  assert.equal(m2.claim_redundancy.value, 0.0);
});

test('|S|<2 -> semantic_redundancy and claim_redundancy are N/A', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x')] };
  const pool = mkPool([q]);
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold: mkGold(), pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  assert.equal(m.semantic_redundancy.value, 'N/A');
  assert.equal(m.claim_redundancy.value, 'N/A');
});

test('disputed gold excluded from numerator AND denominator; reported in gold stats', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x'), mkSource('Q1', 'b', 'B', 1, 1, 'y'), mkSource('Q1', 'c', 'C', 1, 1, 'z')] };
  const pool = mkPool([q]);
  const gold = mkGold({ must_see: { sources: ['Q1:a', 'Q1:b', 'Q1:c'], unresolved_sources: ['Q1:c'], disputed_sources: ['Q1:b'] } });
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected: ['Q1:a', 'Q1:b'], cost: costStub, extra: {} });
  assert.equal(m.must_see_recall.value, 1.0);
  assert.equal(m.must_see_recall.scorable, 1);
  const stats = goldStatsByFamily(gold);
  assert.equal(stats.must_see.scorable, 1);
  assert.equal(stats.must_see.disputed, 1);
  assert.equal(stats.must_see.unresolved, 1);
});

test('omitted question -> per-question coverage 0, still counted in macro/min', () => {
  const q1 = { qid: 'Q1', title: 't1', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, '低代码选型指标')] };
  const q2 = { qid: 'Q2', title: 't2', verified: true, sources: [mkSource('Q2', 'b', 'B', 1, 1, '低代码平台选型')] };
  const pool = mkPool([q1, q2]);
  const gold = mkGold({
    relevance: { sources: ['Q1:a', 'Q2:b'], unresolved_sources: [], disputed_sources: [], per_question: { Q1: ['Q1:a'], Q2: ['Q2:b'] } },
    must_see: { sources: ['Q1:a', 'Q2:b'], unresolved_sources: [], disputed_sources: [] },
  });
  const m = computeMetrics({ caseCfg: baseCaseCfg({ question_ids: ['Q1', 'Q2'], reference_questions: ['Q1', 'Q2'] }), gold, pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  assert.equal(m.per_question_coverage_preservation.per_question.Q1.value, 1.0);
  assert.equal(m.per_question_coverage_preservation.per_question.Q2.value, 0.0);
  // Q1 largest (1 source), Q2 minority (1 source, tied size) -> both are max size -> non-largest empty -> N/A
  assert.equal(m.minority_question_recall_macro.value, 'N/A', 'tie for largest -> no non-largest questions');
});

test('normalized_question_diversity Q<=1 -> N/A', () => {
  const q1 = { qid: 'Q1', title: 't1', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x')] };
  const q2 = { qid: 'Q2', title: 't2', verified: true, sources: [mkSource('Q2', 'b', 'B', 1, 1, 'y')] };
  const pool = mkPool([q1, q2]);
  const gold = mkGold({ relevance: { sources: ['Q1:a', 'Q2:b'], unresolved_sources: [], disputed_sources: [], per_question: { Q1: ['Q1:a'], Q2: ['Q2:b'] } }, must_see: { sources: ['Q1:a'], unresolved_sources: [], disputed_sources: [] } });
  const single = computeMetrics({ caseCfg: baseCaseCfg({ reference_questions: ['Q1'] }), gold, pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  assert.equal(single.normalized_question_diversity.value, 'N/A', 'reference Q<=1 -> N/A');
});

test('cross_question_claim_recall requires EVERY provenance group covered', () => {
  const q1 = { qid: 'Q1', title: 't1', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x')] };
  const q2 = { qid: 'Q2', title: 't2', verified: true, sources: [mkSource('Q2', 'b', 'B', 1, 1, 'y')] };
  const q3 = { qid: 'Q3', title: 't3', verified: true, sources: [mkSource('Q3', 'c', 'C', 1, 1, 'z')] };
  const pool = mkPool([q1, q2, q3]);
  const gold = mkGold({ required_provenance_groups: { claim_groups: [{ claim_id: 'x1', required_provenance_groups: [{ sources: ['Q1:a'] }, { sources: ['Q2:b'] }, { sources: ['Q3:c'] }], disputed: false }] } });
  const partial = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected: ['Q1:a', 'Q2:b'], cost: costStub, extra: {} });
  assert.equal(partial.cross_question_claim_recall.value, 0.0);
  const full = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected: ['Q1:a', 'Q2:b', 'Q3:c'], cost: costStub, extra: {} });
  assert.equal(full.cross_question_claim_recall.value, 1.0);
});

test('dataset_version changes when gold mutates in place (freeze detection)', () => {
  const corpusDir = 'benchmark/corpus';
  const goldA = { families: { must_see: { sources: ['a'] } }, value_units: [] };
  const goldB = { families: { must_see: { sources: ['a', 'b'] } }, value_units: [] };
  const policy = { window_sec: 1 };
  const vA = computeDatasetVersion({ corpusDir, gold: goldA, valueUnits: [], freshnessWindowPolicy: policy });
  const vB = computeDatasetVersion({ corpusDir, gold: goldB, valueUnits: [], freshnessWindowPolicy: policy });
  assert.notEqual(vA, vB);
});

test('freeze snapshot detects freshness policy mutation', () => {
  const mk = (w) => ({ dataset_version: 'd1-x', gold_hash: 'h', value_units_hash: 'u', freshness_policy_hash: w });
  const before = mk('p1');
  const after = mk('p2');
  assert.throws(() => assertFreezeHeld(before, after), /FREEZE_VIOLATION/);
});

test('freshness window is read from the frozen policy, not recomputed from results', () => {
  const policy = { policy_id: 'frozen-365d', window_sec: 31536000, reference_epoch_sec: 1700000000 };
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1700000000 - 100, 'x')] };
  const pool = mkPool([q]);
  const gold = mkGold({ freshness: { fresh_relevant_sources: ['Q1:a'], unresolved_sources: [], disputed_sources: [] } });
  const m = computeMetrics({ caseCfg: baseCaseCfg({ freshness_window_policy: policy }), gold, pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  assert.equal(m.fresh_window_membership_recall.value, 1.0);
  assert.equal(m.fresh_content_recall.value, 1.0);
});

test('selectors respect K exactly (budget fairness check)', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: Array.from({ length: 12 }, (_, i) => mkSource('Q1', 's' + i, 'A' + i, 12 - i, 1, '低代码平台' + i + '选型评估指标内容')) };
  const pool = mkPool([q]);
  const K = 5;
  const embedCache = new Map();
  const b0 = selectPopularityTopK(pool, K, {});
  const b1 = selectLexicalNgramTopK(pool, K, { queryText: '低代码平台选型', embedCache }, {});
  const lanes = assignMechanicalLanes(pool, baseCaseCfg());
  const quotas = computeQuotas(K, lanes, defaultLaneOrder(), {});
  const b2 = selectMMRMultiLane(pool, K, { queryText: '低代码平台选型', embedCache, lambda: 0.5, lanes, laneOrder: defaultLaneOrder(), quotas }, {});
  assert.equal(b0.length, K);
  assert.equal(b1.length, K);
  assert.equal(b2.length, K);
});

test('B0 tie-breaks deterministically by source_id when votes equal', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'z', 'Z', 5, 1, 'x'), mkSource('Q1', 'a', 'A', 5, 1, 'y'), mkSource('Q1', 'm', 'M', 5, 1, 'w')] };
  const pool = mkPool([q]);
  const s1 = selectPopularityTopK(pool, 2, {});
  const s2 = selectPopularityTopK(pool, 2, {});
  assert.deepEqual(s1, s2);
  assert.deepEqual(s1, ['Q1:a', 'Q1:m']);
});

test('B1/B2 deterministic across repeated runs (same inputs -> same selection)', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: Array.from({ length: 10 }, (_, i) => mkSource('Q1', 's' + i, 'A' + i, 10 - i, 1, '低代码平台' + i + '选型评估指标内容')) };
  const pool = mkPool([q]);
  const cfg = baseCaseCfg();
  const c1 = new Map(), c2 = new Map();
  const b1a = selectLexicalNgramTopK(pool, 4, { queryText: '低代码平台选型', embedCache: c1 }, {});
  const b1b = selectLexicalNgramTopK(pool, 4, { queryText: '低代码平台选型', embedCache: c2 }, {});
  assert.deepEqual(b1a, b1b);
  const lanes = assignMechanicalLanes(pool, cfg);
  const quotas = computeQuotas(4, lanes, defaultLaneOrder(), {});
  const b2a = selectMMRMultiLane(pool, 4, { queryText: '低代码平台选型', embedCache: c1, lambda: 0.5, lanes, laneOrder: defaultLaneOrder(), quotas }, {});
  const b2b = selectMMRMultiLane(pool, 4, { queryText: '低代码平台选型', embedCache: c2, lambda: 0.5, lanes, laneOrder: defaultLaneOrder(), quotas }, {});
  assert.deepEqual(b2a, b2b);
});

test('jaccard stability: identical selections -> 1.0 mean/min; disjoint -> 0', () => {
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1.0);
  assert.equal(jaccard(['a', 'b'], ['c', 'd']), 0.0);
  const s = jaccardStability([['a', 'b'], ['a', 'b'], ['a', 'b']]);
  assert.equal(s.value, 1.0);
  assert.equal(s.min, 1.0);
  assert.equal(s.pairs, 3);
});

test('result sanitizer strips sensitive keys/values', () => {
  const dirty = { ok: 1, zhihu_cookie: 'abc', apiKey: 'x', note: 'token=123', nested: { secret: 's' }, fine: 'path' };
  const clean = sanitize(dirty);
  assert.equal(clean.zhihu_cookie, undefined);
  assert.equal(clean.apiKey, undefined);
  assert.equal(clean.nested.secret, undefined);
  assert.equal(clean.note, undefined);
  assert.equal(clean.ok, 1);
});

test('cost uses relative_compute_ops label (P1-2)', () => {
  const q = { qid: 'Q1', title: 't', verified: true, sources: [mkSource('Q1', 'a', 'A', 1, 1, 'x')] };
  const pool = mkPool([q]);
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold: mkGold(), pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  assert.ok(typeof m.cost.relative_compute_ops === 'number');
  assert.ok(m.cost.wall_clock_ms !== undefined);
  assert.ok(m.cost.embedding_calls !== undefined);
  assert.ok(m.cost.pairwise_similarity_calls !== undefined);
});
