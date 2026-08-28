// D2.1 provenance invariant tests (Phase A — evaluator correction).
// Required invariants:
//   SOURCE_ORDER_INVARIANCE
//   MULTI_QUESTION_ASPECT_PROVENANCE
//   CASE_LEVEL_UNIT_NOT_IN_QUESTION_DENOMINATOR
//   QUESTION_MEMBERSHIP_EXACT_MATCH
// Plus: per-question credit semantics, D2-hit regression (per_question units),
// and cross-question ordering invariance through the WHOLE benchmark metric set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../lib/metrics.mjs';
import { deriveValueUnits, scorableUnitsByQuestion, unitsCoveredForQuestion } from '../lib/value-units.mjs';
import { loadCase } from '../lib/case-loader.mjs';
import { paths } from '../lib/paths.mjs';

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
    case_id: 'test', research_question: 'test query', question_ids: ['Q1', 'Q2', 'Q3'], reference_questions: ['Q1', 'Q2', 'Q3'],
    budgets: { K_SMALL: 2 }, freshness_window_policy: { policy_id: 't', window_sec: 86400, reference_epoch_sec: 1700000000 },
    long_tail_min_chars: 20, mmr_lambda: 0.5, lane_weights: { mainstream: 1, expert: 1, evidence_rich: 1, fresh: 1, long_tail: 1, contradictory: 1 },
    author_identity: 'name_only', author_identity_confidence: 'WEAK', expert_author_keys: [],
    ...over,
  };
}

const costStub = { snapshot: () => ({ embedding_calls: 0, embedding_cache_hits: 0, pairwise_similarity_calls: 0, selection_ops: 0, wall_ms: 0 }) };

// Build a cross-question gold fixture: aspect spanning Q1|Q2|Q3, must_see per
// question, contradiction side spanning Q1|Q2, case-level expert group.
function xqFixture() {
  const q1 = { qid: 'Q1', title: 't1', verified: true, sources: [mkSource('Q1', 'a', 'A', 10, 1, 'x'), mkSource('Q1', 'b', 'B', 5, 1, 'y')] };
  const q2 = { qid: 'Q2', title: 't2', verified: true, sources: [mkSource('Q2', 'c', 'C', 10, 1, 'z'), mkSource('Q2', 'd', 'D', 1, 1, 'w')] };
  const q3 = { qid: 'Q3', title: 't3', verified: true, sources: [mkSource('Q3', 'e', 'E', 10, 1, 'v'), mkSource('Q3', 'f', 'F', 1, 1, 'u')] };
  const pool = mkPool([q1, q2, q3]);
  const gold = mkGold({
    must_see: { sources: ['Q1:a', 'Q2:c', 'Q3:e'], unresolved_sources: [], disputed_sources: [] },
    aspect_membership: {
      aspects: [
        // MULTI-question aspect: primary support in ALL three questions.
        { aspect_id: 'xq-aspect', primary_sources: ['Q3:e', 'Q1:a', 'Q2:c'], disputed: false },
        // single-question aspect
        { aspect_id: 'q1-only', primary_sources: ['Q1:a', 'Q1:b'], disputed: false },
      ],
    },
    expertise_topic_match: { sources: ['Q1:a', 'Q2:c', 'Q3:e'], unresolved_sources: [], disputed_sources: [] },
    contradiction: {
      claim_clusters: [
        { claim_id: 'c1', disputed: false, stances: { for: ['Q1:a', 'Q2:c'], against: ['Q3:e'] } },
      ],
    },
  });
  return { pool, gold };
}

// ===========================================================================
// SOURCE_ORDER_INVARIANCE — shuffling gold support arrays must not change
// ANY benchmark metric.
// ===========================================================================
test('SOURCE_ORDER_INVARIANCE: shuffling primary/supporting arrays leaves all metrics identical', () => {
  const { pool, gold } = xqFixture();
  const selected = ['Q1:a', 'Q2:d', 'Q3:e'];

  const metricsOf = (g) => {
    const m = computeMetrics({ caseCfg: baseCaseCfg(), gold: g, pool, selected, cost: costStub, extra: {} });
    return JSON.stringify({
      must_see: m.must_see_recall.value,
      aspect: m.aspect_recall.value,
      aspect_src: m.aspect_source_recall_diagnostic.value,
      xq_claim: m.cross_question_claim_recall.value,
      per_q: Object.fromEntries(Object.entries(m.per_question_coverage_preservation.per_question).map(([q, v]) => [q, v.value])),
      minority_macro: m.minority_question_recall_macro.value,
      minority_min: m.minority_question_recall_min.value,
      diversity: m.normalized_question_diversity.value,
      contra: m.contradiction_claim_recall.value,
      expert: m.expert_recall.value,
      long_tail: m.long_tail_recall.value,
      sem_red: m.semantic_redundancy.value,
      claim_red: m.claim_redundancy.value,
    });
  };

  const baseline = metricsOf(gold);
  // deterministic shuffle of every support array (three different permutations)
  for (const perm of [1, 2, 3]) {
    const g2 = JSON.parse(JSON.stringify(gold));
    const permute = (arr, p) => {
      if (!Array.isArray(arr)) return arr;
      const a = [...arr];
      if (p === 1) { const [x] = a.splice(0, 1); a.push(x); }
      if (p === 2) { const x = a.pop(); a.unshift(x); }
      if (p === 3) { a.reverse(); }
      return a;
    };
    g2.families.aspect_membership.aspects[0].primary_sources = permute(gold.families.aspect_membership.aspects[0].primary_sources, perm);
    g2.families.aspect_membership.aspects[1].primary_sources = permute(gold.families.aspect_membership.aspects[1].primary_sources, perm);
    g2.families.must_see.sources = permute(gold.families.must_see.sources, perm);
    g2.families.contradiction.claim_clusters[0].stances.for = permute(gold.families.contradiction.claim_clusters[0].stances.for, perm);
    g2.families.expertise_topic_match.sources = permute(gold.families.expertise_topic_match.sources, perm);
    g2.value_units = deriveValueUnits(g2);
    assert.equal(metricsOf(g2), baseline, `permutation ${perm} changed metrics`);
  }
});

// ===========================================================================
// MULTI_QUESTION_ASPECT_PROVENANCE
// ===========================================================================
test('MULTI_QUESTION_ASPECT_PROVENANCE: cross-question aspect keeps FULL question_ids', () => {
  const { gold } = xqFixture();
  const units = deriveValueUnits(gold);
  const xq = units.find((u) => u.unit_id === 'critical_aspect:xq-aspect');
  assert.equal(xq.scope, 'CROSS_QUESTION');
  assert.deepEqual(xq.question_ids, ['Q1', 'Q2', 'Q3'], 'full provenance set, sorted, NOT first-element');
  const q1only = units.find((u) => u.unit_id === 'critical_aspect:q1-only');
  assert.equal(q1only.scope, 'QUESTION');
  assert.deepEqual(q1only.question_ids, ['Q1']);
  // contradiction side spanning 2 questions
  const cFor = units.find((u) => u.unit_id === 'contra_side:c1:for');
  assert.equal(cFor.scope, 'CROSS_QUESTION');
  assert.deepEqual(cFor.question_ids, ['Q1', 'Q2']);
});

// ===========================================================================
// CASE_LEVEL_UNIT_NOT_IN_QUESTION_DENOMINATOR
// ===========================================================================
test('CASE_LEVEL_UNIT_NOT_IN_QUESTION_DENOMINATOR: case units excluded from all per-question denominators', () => {
  const { pool, gold } = xqFixture();
  const byQ = scorableUnitsByQuestion(gold.value_units);
  for (const q of ['Q1', 'Q2', 'Q3']) {
    const ids = byQ.get(q).map((u) => u.unit_id);
    assert.ok(!ids.includes('expert_source_group'), `expert group leaked into ${q} denominator`);
    assert.ok(!ids.includes('evidence_source_group'), `evidence group leaked into ${q} denominator`);
  }
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected: ['Q1:a'], cost: costStub, extra: {} });
  // Q3 denominator = must_see:Q3:e + xq-aspect + contra_side:c1:against = 3
  // (CASE expert group unit must NOT add to it)
  const perQ3 = m.per_question_coverage_preservation.per_question.Q3;
  const idsQ3 = byQ.get('Q3').map((u) => u.unit_id).sort();
  assert.deepEqual(idsQ3, ['contra_side:c1:against', 'critical_aspect:xq-aspect', 'must_see:Q3:e'], 'Q3 units = 3 scorable QUESTION/CROSS_QUESTION units');
  assert.equal(perQ3.scorable_units, 3, 'CASE units never join per-question denominators');
});

// ===========================================================================
// QUESTION_MEMBERSHIP_EXACT_MATCH
// ===========================================================================
test('QUESTION_MEMBERSHIP_EXACT_MATCH: question_ids == per-scope semantic membership', () => {
  const { gold } = xqFixture();
  for (const u of deriveValueUnits(gold)) {
    if (u.scope === 'CASE') {
      assert.deepEqual(u.question_ids, [], `CASE unit ${u.unit_id} must have no question ownership`);
      continue;
    }
    const expected = [...new Set((u.supporting_source_ids || []).map((s) => s.split(':')[0]))].sort();
    assert.deepEqual(u.question_ids, expected, `unit ${u.unit_id} membership mismatch`);
    assert.equal(u.scope, expected.length > 1 ? 'CROSS_QUESTION' : 'QUESTION', `unit ${u.unit_id} scope mismatch`);
  }
});

// ===========================================================================
// Per-question credit semantics — D2.1 core behavior
// ===========================================================================
test('PER_QUESTION_CREDIT: cross-question unit covered for q ONLY via q source', () => {
  const { pool, gold } = xqFixture();
  // Select only Q1:a (supports xq-aspect) + Q3:e: xq-aspect credited to Q1 and Q3,
  // but NOT to Q2 (no Q2 source selected).
  const selected = ['Q1:a', 'Q3:e'];
  const m = computeMetrics({ caseCfg: baseCaseCfg(), gold, pool, selected, cost: costStub, extra: {} });
  const perQ1 = m.per_question_coverage_preservation.per_question.Q1;
  const perQ2 = m.per_question_coverage_preservation.per_question.Q2;
  const perQ3 = m.per_question_coverage_preservation.per_question.Q3;
  // Q1: must_see:Q1:a + xq-aspect + q1-only + contra_side:c1:for = 4; Q1:a covers all 4 -> 1.0
  assert.equal(perQ1.scorable_units, 4);
  assert.equal(perQ1.value, 1.0);
  // Q2: must_see:Q2:c + xq-aspect + contra_side:c1:for = 3; no Q2 source selected -> 0
  assert.equal(perQ2.scorable_units, 3);
  assert.equal(perQ2.value, 0.0);
  // Q3: must_see:Q3:e + xq-aspect + contra_side:c1:against = 3; Q3:e selected -> 1.0
  assert.equal(perQ3.scorable_units, 3);
  assert.equal(perQ3.value, 1.0);
});

// ===========================================================================
// D2-hit regression: derivations must stay deterministic & canonical
// ===========================================================================
test('D2.1 derivations canonical: same gold twice -> identical units JSON', () => {
  const { gold } = xqFixture();
  const u1 = JSON.stringify(deriveValueUnits(gold));
  const u2 = JSON.stringify(deriveValueUnits(JSON.parse(JSON.stringify(gold))));
  assert.equal(u1, u2);
});

// ===========================================================================
// Real-case regression: case-cross-lowcode provenance recovered mechanically
// ===========================================================================
test('REAL_CASE: cross-lowcode multi-question aspects carry FULL question_ids (no collapse)', () => {
  const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId: 'case-cross-lowcode' });
  const units = loaded.valueUnits;
  const aspConcept = units.find((u) => u.unit_id === 'critical_aspect:case-cross-lowcode:asp-concept');
  assert.ok(aspConcept, 'asp-concept unit exists');
  assert.equal(aspConcept.scope, 'CROSS_QUESTION');
  assert.deepEqual(aspConcept.question_ids, ['462973596', '477427067', '485463474', '487214224']);
  const aspCriteria = units.find((u) => u.unit_id === 'critical_aspect:case-cross-lowcode:asp-criteria');
  assert.deepEqual(aspCriteria.question_ids, ['462973596', '477427067']);
  const aspPitfalls = units.find((u) => u.unit_id === 'critical_aspect:asp-pitfalls');
  assert.deepEqual(aspPitfalls.question_ids, ['485463474', '487214224']);
  // every unit's membership equals the semantic scope rule
  for (const u of units) {
    if (u.scope === 'CASE') {
      assert.deepEqual(u.question_ids, [], `unit ${u.unit_id} membership mismatch`);
      continue;
    }
    const expected = [...new Set((u.supporting_source_ids || []).map((s) => s.split(':')[0]))].sort();
    assert.deepEqual(u.question_ids, expected, `unit ${u.unit_id} membership mismatch`);
  }
});

// ===========================================================================
// D2 -> D2.1 regression: unit counts for the four affected questions change
// (487214224 gains asp-pitfalls; 485463474 gains asp-pitfalls; 477427067 and
// 462973596 gain cross-question aspects) — proves per_question_coverage and
// minority metrics are NOT frozen-only-aspect_recall.
// ===========================================================================
test('D2.1: per-question scorable units change vs order-collapsed D2 for cross-question aspects', () => {
  const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId: 'case-cross-lowcode' });
  const units = loaded.valueUnits;
  const byQ = scorableUnitsByQuestion(units);
  const countOf = (q) => (byQ.get(q) || []).length;
  // D2.1 (corrected, cross-question units credited to EVERY question they span):
  assert.equal(countOf('487214224'), 3, '487214224 = must_see + asp-concept + asp-pitfalls (D2 collapsed both aspects off it)');
  assert.equal(countOf('485463474'), 5, '485463474 = 2 must_see + unique_claim + asp-concept + asp-pitfalls (D2 had 4)');
  assert.equal(countOf('477427067'), 11, '477427067 = 4 must_see + 5 unique + asp-criteria + asp-concept (D2 had 10)');
  assert.equal(countOf('462973596'), 7, '462973596 = 2 must_see + asp-criteria + asp-concept + asp-zero-vs-low + 2 contra (D2 had 6)');
  // D2 (order-collapsed, first-element question_id) unit counts for reference:
  //   487214224 = 1, 485463474 = 4, 477427067 = 10, 462973596 = 6
  // (recorded from the pilot D2 value-units.json; the delta is exactly the
  //  provenance distortion that D2.1 removes)
  // ORDER-INDEPENDENCE of the REAL case: shuffling aspect primary_sources must
  // leave the derived unit JSON byte-identical.
  const shuffledGold = JSON.parse(JSON.stringify(loaded.gold));
  const rev = (arr) => [...arr].reverse();
  for (const a of shuffledGold.families.aspect_membership.aspects) {
    if (Array.isArray(a.primary_sources)) a.primary_sources = rev(a.primary_sources);
  }
  const units2 = deriveValueUnits(shuffledGold);
  assert.equal(JSON.stringify(units2), JSON.stringify(units), 'real-case derivation must be order-invariant');
});