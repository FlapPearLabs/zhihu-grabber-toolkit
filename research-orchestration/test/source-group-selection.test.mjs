/**
 * research-orchestration/test/source-group-selection.test.mjs
 *
 * P1-T08 focused tests — Source-group Set Selection / Ambiguity Gate
 * (Issue #40, Spec §7 of docs/specs/p1-cross-question-deep-research.md).
 *
 * Required coverage (ticket REQUIRED_TESTS):
 *   1. clear-best branch → deterministic AUTO selection of a source-group set
 *      (auto; visible/recordable; multi-group when scope demands).
 *   2. material-ambiguity branch → AMBIGUOUS verdict (never silently guessed);
 *      structured clarification request with count <= 1.
 *   3. no-valid branch → NONE fail-closed (empty pool / plan-pool mismatch /
 *      invalid plan / minScore gate).
 *   4. one-clarification protocol (clarificationCount <= 1): clarification
 *      resolves to a forced set; ambiguous verdict never re-issued; invalid
 *      forced id fails closed.
 *   5. machine-readable decision record: persisted + reloadable; deterministic.
 *   6. planHash dependency: decision carries planHash + poolPlanHash; stale
 *      detection (changed plan → not reusable); plan/pool identity mismatch fails closed.
 *   7. consistency with plan sourceGroupIntents: k from intents; groupKey
 *      binding; intent shortfall / unmet recorded.
 *   8. T07 fusion-coverage hook: applySelectionToCoverageState records
 *      fusedCandidateCount / fusedGroupCount under OWNER_T08_FUSION.
 *
 * Pure, offline, deterministic; fixtures inline (no network, no credentials).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  validatePlanInput,
  planHash,
  isValidPlanHashFormat,
} from '../lib/plan-contract.mjs';
import { createInitialCoverageState } from '../lib/coverage-state.mjs';
import {
  SELECT_VERDICT_AUTO,
  SELECT_VERDICT_AMBIGUOUS,
  SELECT_VERDICT_NONE,
  SELECTION_DECISION_FILENAME,
  SELECTION_FAILURE_PLANNER_INVALID,
  SELECTION_FAILURE_PLAN_POOL_MISMATCH,
  SELECTION_FAILURE_INVALID_CLARIFICATION,
  SELECTION_FAILURE_NO_VALID_GROUP,
  SELECT_REASON_CLEAR_BEST,
  SELECT_REASON_CLARIFICATION_FORCED,
  selectSourceGroups,
  buildCandidateGroups,
  scoreCandidateGroup,
  intendedGroupCount,
  bindGroupsToPlanIntents,
  isCanonicalQuestionId,
  persistSelectionDecision,
  loadSelectionDecision,
  selectionDecisionStatus,
  applySelectionToCoverageState,
} from '../lib/source-group-selection.mjs';

/** Build a validated Research Plan (T04 contract). */
function makePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    queryVariants: ['大语言模型 Agent 落地争议'],
    aspects: ['技术成熟度'],
    entities: ['OpenAI'],
    opposingFramings: ['Agent 仍不成熟'],
    terminologyVariants: [{ term: 'Agent', variants: ['智能体'] }],
    sourceGroupIntents: [{ intent: '关注反方观点', constraints: [], groupKey: null }],
    ...overrides,
  };
}

/** Build one pool candidate group. */
function cand(qid, rrfScore) {
  return {
    identity: { kind: 'candidate', questionId: qid },
    rrfScore,
    ranks: [{ channel: { query: 'q', providerId: 'p', capability: 'search' }, rank: 1, rankOrigin: 'search', route: 'web' }],
    source_url: `https://www.zhihu.com/question/${qid}`,
    facts: { title: `question ${qid}` },
  };
}

/** Build a retrieval-pool artifact bound to a planHash. */
function makePool(candidates, planHashValue) {
  return {
    schemaVersion: 1,
    type: 'retrieval-pool',
    planHash: planHashValue,
    candidates,
  };
}

function validPlanHash(plan) {
  const v = validatePlanInput(plan);
  assert.ok(v.ok, 'fixture plan must validate');
  return planHash(v.plan);
}

test('clear-best: single dominant group → AUTO, one selected', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.030), cand('300', 0.020)], ph);
  const d = selectSourceGroups(pool, plan);

  assert.equal(d.verdict, SELECT_VERDICT_AUTO);
  assert.equal(d.reason, 'clear_best');
  assert.equal(d.selectedGroups.length, 1);
  assert.equal(d.selectedGroups[0].questionId, '100');
  assert.equal(d.selectedGroups[0].groupId, '100');
  assert.equal(d.selectedGroups[0].selectionReason, SELECT_REASON_CLEAR_BEST);
  assert.equal(d.clarificationCount, 0);
  assert.equal(d.clarification, null);
  // Transparency list records all candidates with selected flags.
  assert.equal(d.candidates.length, 3);
  assert.equal(d.candidates.find((c) => c.questionId === '100').selected, true);
  assert.equal(d.candidates.find((c) => c.questionId === '200').selected, false);
});

test('clear-best: no plan intents → select ALL eligible groups (multi-group set)', () => {
  const plan = makePlan({ sourceGroupIntents: [] });
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.030), cand('300', 0.020)], ph);
  const d = selectSourceGroups(pool, plan);

  assert.equal(d.verdict, SELECT_VERDICT_AUTO);
  // takeAll semantics → no boundary ambiguity → all three selected.
  assert.equal(d.selectedGroups.length, 3);
  assert.deepEqual(
    d.selectedGroups.map((g) => g.questionId),
    ['100', '200', '300'],
  );
  assert.equal(d.intentCoverage.total, 0);
});

test('clear-best: explicit groupCount override picks top-k without ambiguity', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.090), cand('300', 0.020)], ph);
  const d = selectSourceGroups(pool, plan, { groupCount: 2, ambiguityMargin: 0.01 });

  assert.equal(d.verdict, SELECT_VERDICT_AUTO);
  assert.equal(d.selectedGroups.length, 2);
  assert.deepEqual(d.selectedGroups.map((g) => g.questionId), ['100', '200']);
});

test('material-ambiguity: fuzzy set boundary → AMBIGUOUS, never silently guessed', () => {
  const plan = makePlan(); // sourceGroupIntents length 1 → k = 1
  const ph = validPlanHash(plan);
  // top-1 and first-excluded are comparably relevant (gap < ambiguityMargin).
  const pool = makePool([cand('100', 0.100), cand('200', 0.099), cand('300', 0.020)], ph);
  const d = selectSourceGroups(pool, plan, { ambiguityMargin: 0.01 });

  assert.equal(d.verdict, SELECT_VERDICT_AMBIGUOUS);
  assert.equal(d.reason, 'material_ambiguity');
  // Never silently select — selectedGroups empty on ambiguity.
  assert.equal(d.selectedGroups.length, 0);
  // Structured clarification request, exactly one allowed.
  assert.ok(d.clarification);
  assert.equal(d.clarification.required, true);
  assert.equal(d.clarification.count, 1);
  assert.ok(Array.isArray(d.clarification.options) && d.clarification.options.length >= 1);
  assert.match(d.rationale, /material ambiguity/i);
});

test('no-valid: empty candidate pool → NONE fail-closed', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([], ph);
  const d = selectSourceGroups(pool, plan);

  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_NO_VALID_GROUP);
  assert.equal(d.selectedGroups.length, 0);
});

test('no-valid: plan/pool identity mismatch → NONE fail-closed', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100)], 'a'.repeat(64)); // wrong pool planHash
  const d = selectSourceGroups(pool, plan);

  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_PLAN_POOL_MISMATCH);
  assert.equal(d.planHash, ph); // plan identity still computed
  assert.equal(d.poolPlanHash, 'a'.repeat(64));
  assert.equal(d.planHashMatch, false);
});

test('no-valid: invalid plan → planner_invalid fail-closed', () => {
  const plan = { schemaVersion: 1, queryVariants: ['x'] }; // missing required fields
  const ph = 'b'.repeat(64);
  const pool = makePool([cand('100', 0.100)], ph);
  const d = selectSourceGroups(pool, plan);

  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_PLANNER_INVALID);
});

test('no-valid: minScore gate filters every candidate → NONE', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.090)], ph);
  const d = selectSourceGroups(pool, plan, { minScore: 1.0 }); // nothing reaches it

  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_NO_VALID_GROUP);
});

test('clarification protocol: forced resolution → AUTO, count = 1, never re-ambiguous', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.099), cand('300', 0.020)], ph);

  const first = selectSourceGroups(pool, plan, { ambiguityMargin: 0.01 });
  assert.equal(first.verdict, SELECT_VERDICT_AMBIGUOUS);

  // Controller asks the user once; user picks the dominant group.
  const resolved = selectSourceGroups(pool, plan, {
    ambiguityMargin: 0.01,
    clarification: { forceGroupIds: ['100'] },
  });
  assert.equal(resolved.verdict, SELECT_VERDICT_AUTO);
  assert.equal(resolved.clarificationCount, 1);
  assert.equal(resolved.selectedGroups.length, 1);
  assert.equal(resolved.selectedGroups[0].questionId, '100');
  assert.equal(resolved.selectedGroups[0].selectionReason, SELECT_REASON_CLARIFICATION_FORCED);
  // No further clarification permitted.
  assert.equal(resolved.clarification.count, 0);
  assert.equal(resolved.clarification.required, false);
});

test('clarification protocol: invalid forced id → NONE fail-closed', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.099)], ph);
  const d = selectSourceGroups(pool, plan, {
    ambiguityMargin: 0.01,
    clarification: { forceGroupIds: ['999'] }, // not a pool candidate
  });
  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_INVALID_CLARIFICATION);
  assert.equal(d.clarificationCount, 0);
});

test('clarification protocol: second clarification input still resolves (count stays 1, never ambiguous)', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.099), cand('300', 0.050)], ph);
  const d = selectSourceGroups(pool, plan, {
    ambiguityMargin: 0.01,
    clarification: { forceGroupIds: ['200', '300'] },
  });
  assert.equal(d.verdict, SELECT_VERDICT_AUTO);
  assert.equal(d.clarificationCount, 1);
  assert.deepEqual(d.selectedGroups.map((g) => g.questionId), ['200', '300']);
});

test('decision record: persisted + reloadable + deterministic content', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.030)], ph);
  const d = selectSourceGroups(pool, plan);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't08-dec-'));
  try {
    const persist = persistSelectionDecision(tmp, d);
    assert.equal(persist.ok, true);
    assert.equal(persist.file, SELECTION_DECISION_FILENAME);
    const loaded = loadSelectionDecision(tmp);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.decision, d);
    // type discriminator is preserved (machine-readable contract).
    assert.equal(loaded.decision.type, 'source-group-selection-decision');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('planHash dependency: decision carries planHash + poolPlanHash; mismatch → stale', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100)], ph);
  const d = selectSourceGroups(pool, plan);

  assert.ok(isValidPlanHashFormat(d.planHash));
  assert.equal(d.planHash, ph);
  assert.equal(d.poolPlanHash, ph);
  assert.equal(d.planHashMatch, true);

  // Reusable against the same current plan + pool identity.
  const same = selectionDecisionStatus({ decision: d, currentPlanHash: ph, currentPoolPlanHash: ph });
  assert.equal(same.reusable, true);
  assert.equal(same.stale, false);

  // Mutated plan → different planHash → decision is stale (not reusable).
  const mutated = makePlan({ entities: ['OpenAI', 'Anthropic'] });
  const mutatedHash = validPlanHash(mutated);
  assert.notEqual(mutatedHash, ph);
  const stale = selectionDecisionStatus({ decision: d, currentPlanHash: mutatedHash, currentPoolPlanHash: ph });
  assert.equal(stale.reusable, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.reason, 'selection_plan_hash_mismatch');
});

test('planHash dependency: missing pool planHash → FAIL CLOSED (reform F2; no tolerant reuse)', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  // Reform F2: the pool planHash is a hard dependency identity — a pool
  // without one must fail closed, never be silently tolerated as AUTO.
  const pool = makePool([cand('100', 0.100)], undefined); // no pool planHash
  const d = selectSourceGroups(pool, plan);
  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, 'selection_pool_planhash_missing');
  assert.equal(d.selectedGroups.length, 0);
  assert.equal(d.planHash, ph);
  // Reuse seam: a missing current pool identity is NOT reusable (stale).
  const st = selectionDecisionStatus({ decision: d, currentPlanHash: ph, currentPoolPlanHash: undefined });
  assert.equal(st.reusable, false);
  assert.equal(st.stale, true);
  assert.equal(st.reason, 'selection_dependency_missing');
});

test('consistency: k derived from sourceGroupIntents; groupKey binding', () => {
  const plan = makePlan({
    sourceGroupIntents: [{ intent: '关注反方', constraints: [], groupKey: '555' }],
  });
  const ph = validPlanHash(plan);
  // '555' is the dominant group and matches the intent groupKey.
  const pool = makePool([cand('555', 0.100), cand('111', 0.030)], ph);
  const d = selectSourceGroups(pool, plan);

  assert.equal(d.verdict, SELECT_VERDICT_AUTO);
  assert.equal(d.selectedGroups.length, 1);
  assert.equal(d.selectedGroups[0].questionId, '555');
  assert.ok(d.selectedGroups[0].rationaleRef);
  assert.equal(d.selectedGroups[0].rationaleRef.groupKey, '555');
  assert.equal(d.selectedGroups[0].rationaleRef.intentIndex, 0);
  assert.equal(d.intentCoverage.bound, 1);
  assert.equal(d.intentCoverage.unmet, 0);
});

test('consistency: intent shortfall + unmet recorded when fewer groups than intents', () => {
  const plan = makePlan({
    sourceGroupIntents: [
      { intent: 'a', constraints: [], groupKey: null },
      { intent: 'b', constraints: [], groupKey: null },
    ],
  });
  const ph = validPlanHash(plan);
  // Only one eligible group; plan wants two → shortfall 1, unmet 1.
  const pool = makePool([cand('100', 0.100)], ph);
  const d = selectSourceGroups(pool, plan);

  assert.equal(d.verdict, SELECT_VERDICT_AUTO);
  assert.equal(d.selectedGroups.length, 1);
  assert.equal(d.intentCoverage.shortfall, 1);
  assert.equal(d.intentCoverage.unmet, 1);
});

test('T07 fusion hook: applySelectionToCoverageState records fused counts under T08 owner', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.030), cand('300', 0.020)], ph);
  const d = selectSourceGroups(pool, plan);

  const state = createInitialCoverageState({ planHash: ph });
  assert.equal(state.retrieval.fusedCandidateCount, 0);
  assert.equal(state.retrieval.fusedGroupCount, 0);

  const next = applySelectionToCoverageState(state, d);
  assert.equal(next.retrieval.fusedCandidateCount, d.candidates.length);
  assert.equal(next.retrieval.fusedGroupCount, d.selectedGroups.length);
});

test('helpers: scoreCandidateGroup + buildCandidateGroups + intendedGroupCount', () => {
  // scoring: missing/non-finite rrfScore degrades to 0; canonical ordering.
  assert.equal(scoreCandidateGroup(cand('1', 0.5)), 0.5);
  assert.equal(scoreCandidateGroup({ identity: { kind: 'candidate', questionId: '1' } }), 0);

  const built = buildCandidateGroups(makePool([
    cand('200', 0.030),
    cand('100', 0.100),
    { identity: { kind: 'candidate', questionId: '300' } }, // missing rrfScore → invalid
  ], 'a'.repeat(64)));
  assert.equal(built.ok, true);
  assert.equal(built.groups.length, 3);
  assert.deepEqual(built.groups.map((g) => g.questionId), ['100', '200', '300']); // sorted score desc
  // Invalid (missing rrfScore) group is marked ineligible; valid groups are eligible.
  assert.equal(built.groups.find((g) => g.questionId === '300').eligible, false);
  assert.equal(built.groups.find((g) => g.questionId === '300').rrfScore, null);
  assert.equal(built.groups.find((g) => g.questionId === '100').eligible, true);

  // malformed pool → fail-closed.
  const bad = buildCandidateGroups({ candidates: [{ identity: { kind: 'candidate', questionId: 'abc' } }] });
  assert.equal(bad.ok, false);

  // intendedGroupCount: plan intents win; explicit groupCount overrides; none → takeAll.
  assert.equal(intendedGroupCount(makePlan({ sourceGroupIntents: [{ intent: 'x', constraints: [], groupKey: null }] })), 1);
  assert.equal(intendedGroupCount(makePlan({ sourceGroupIntents: [] })), Number.POSITIVE_INFINITY);
  assert.equal(intendedGroupCount(makePlan(), { groupCount: 3 }), 3);
  assert.equal(intendedGroupCount(makePlan(), { groupCount: 'bad' }), 0);
});

test('helpers: bindGroupsToPlanIntents exact groupKey + positional fallback', () => {
  const plan = makePlan({
    sourceGroupIntents: [
      { intent: 'a', constraints: [], groupKey: '555' },
      { intent: 'b', constraints: [], groupKey: null },
    ],
  });
  const groups = [
    { questionId: '111' }, { questionId: '555' },
  ];
  const { bindings, unmet } = bindGroupsToPlanIntents(groups, plan);
  assert.equal(bindings.get('555').intentIndex, 0); // exact groupKey
  assert.equal(bindings.get('111').intentIndex, 1); // positional fallback
  assert.equal(unmet, 0);
});

// ---------------------------------------------------------------------------
// P1-1 (review finding): empty clarification forceGroupIds must NOT yield an
// empty SUCCESS verdict — fail closed instead.
// ---------------------------------------------------------------------------
test('P1-1: clarification with empty forceGroupIds → NONE fail-closed (no silent empty success)', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100), cand('200', 0.099)], ph);
  const d = selectSourceGroups(pool, plan, {
    ambiguityMargin: 0.01,
    clarification: { forceGroupIds: [] }, // user selected nothing
  });
  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_INVALID_CLARIFICATION);
  assert.equal(d.selectedGroups.length, 0);
  assert.equal(d.clarificationCount, 0);
});

// ---------------------------------------------------------------------------
// P1-2 (review finding): missing/non-finite rrfScore makes a group INELIGIBLE;
// an all-invalid pool lands in the no-valid-set fail-closed branch.
// ---------------------------------------------------------------------------
test('P1-2: candidate missing rrfScore → ineligible → NONE fail-closed', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = {
    schemaVersion: 1, type: 'retrieval-pool', planHash: ph,
    candidates: [{ identity: { kind: 'candidate', questionId: '100' }, ranks: [], source_url: 'x', facts: {} }],
  };
  const d = selectSourceGroups(pool, plan);
  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_NO_VALID_GROUP);
  assert.equal(d.selectedGroups.length, 0);
});

test('P1-2: candidate with non-finite rrfScore (NaN/Infinity) → ineligible → NONE fail-closed', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([
    { identity: { kind: 'candidate', questionId: '100' }, rrfScore: NaN, ranks: [], source_url: 'x', facts: {} },
    { identity: { kind: 'candidate', questionId: '200' }, rrfScore: Infinity, ranks: [], source_url: 'x', facts: {} },
  ], ph);
  const d = selectSourceGroups(pool, plan);
  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_NO_VALID_GROUP);
  assert.equal(d.selectedGroups.length, 0);
});

test('P1-2: all-invalid pool (missing + non-finite scores) → NONE fail-closed', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([
    { identity: { kind: 'candidate', questionId: '100' }, ranks: [], source_url: 'x', facts: {} }, // missing
    { identity: { kind: 'candidate', questionId: '200' }, rrfScore: NaN, ranks: [], source_url: 'x', facts: {} }, // non-finite
  ], ph);
  const d = selectSourceGroups(pool, plan);
  assert.equal(d.verdict, SELECT_VERDICT_NONE);
  assert.equal(d.reason, SELECTION_FAILURE_NO_VALID_GROUP);
  assert.equal(d.selectedGroups.length, 0);
});

test('P1-2: valid + invalid mix → only the valid group is eligible/selectable', () => {
  const plan = makePlan(); // sourceGroupIntents length 1 → k = 1
  const ph = validPlanHash(plan);
  const pool = makePool([
    cand('100', 0.100),
    { identity: { kind: 'candidate', questionId: '200' }, ranks: [], source_url: 'x', facts: {} }, // missing rrfScore → invalid
  ], ph);
  const d = selectSourceGroups(pool, plan);
  assert.equal(d.verdict, SELECT_VERDICT_AUTO);
  assert.equal(d.reason, 'clear_best');
  assert.equal(d.selectedGroups.length, 1);
  assert.equal(d.selectedGroups[0].questionId, '100');
  // The invalid group must not appear as a selected/eligible candidate.
  assert.equal(d.candidates.length, 1);
});

// ---------------------------------------------------------------------------
// Reform round (external review F1/F2 repairs on the rejected candidate):
// regression tests for the fail-closed contract. These are appended as a
// separate block so the repair can be reviewed independently of the
// carried-forward baseline.
//
// F1 — PLAN_INTENT_CONSTRAINT_FAIL_OPEN: an explicit plan-intent groupKey is a
//      HARD constraint (exact binding required, never positionally rebound),
//      and free-form plan constraints (schemaVersion 1 has no structured
//      constraint semantics) must FAIL CLOSED instead of being silently
//      treated as satisfied.
// F2 — MISSING_POOL_PLANHASH_ACCEPTED: the pool planHash is a hard dependency
//      identity (Spec §4.3); missing/malformed identities fail closed, and the
//      reuse seam never treats an invalid identity as reusable.
// ---------------------------------------------------------------------------
describe('reform F1/F2: fail-closed plan-intent gates + pool planHash identity', () => {
  describe('F1: plan intent groupKey is a hard constraint', () => {
    test('F1-T1: explicit groupKey present among eligible candidates → AUTO with exact binding', () => {
      const plan = makePlan({
        sourceGroupIntents: [{ intent: '关注反方观点', constraints: [], groupKey: '555' }],
      });
      const ph = validPlanHash(plan);
      // '555' is dominant AND matches the required groupKey → valid AUTO path.
      const pool = makePool([cand('555', 0.100), cand('111', 0.030)], ph);
      const d = selectSourceGroups(pool, plan);

      assert.equal(d.verdict, SELECT_VERDICT_AUTO);
      assert.equal(d.reason, 'clear_best');
      assert.ok(d.selectedGroups.some((g) => g.questionId === '555'));
      const bound = d.selectedGroups.find((g) => g.questionId === '555');
      assert.ok(bound.rationaleRef);
      assert.equal(bound.rationaleRef.intentIndex, 0);
      assert.equal(bound.rationaleRef.groupKey, '555');
      assert.equal(d.planHashMatch, true);
    });

    test('F1-T2: explicit groupKey absent from the eligible pool → FAIL CLOSED', () => {
      const plan = makePlan({
        sourceGroupIntents: [{ intent: '关注反方观点', constraints: [], groupKey: '777' }],
      });
      const ph = validPlanHash(plan);
      const pool = makePool([cand('100', 0.100), cand('200', 0.030)], ph);
      const d = selectSourceGroups(pool, plan);

      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, 'selection_plan_group_key_unsatisfied');
      assert.equal(d.selectedGroups.length, 0);
      assert.equal(d.clarificationCount, 0);
    });

    test('F1-T3: best group differs from required groupKey → the REQUIRED group is selected (never positionally rebound)', () => {
      const plan = makePlan({
        sourceGroupIntents: [{ intent: '关注反方观点', constraints: [], groupKey: '555' }],
      });
      const ph = validPlanHash(plan);
      // '100' is the high-RRF best; the required '555' is not dominant. The
      // pre-reform contract positionally rebound '100' to intent 0; the first
      // reform rejected the whole selection post-hoc. Repair round 2 (P1-1)
      // constructs the set constraint-first: the required '555' is a MANDATORY
      // member and '100' can never displace or be rebound onto intent 0.
      const pool = makePool([cand('100', 0.100), cand('555', 0.030), cand('300', 0.020)], ph);
      const d = selectSourceGroups(pool, plan);

      assert.equal(d.verdict, SELECT_VERDICT_AUTO);
      assert.equal(d.reason, 'clear_best');
      // The selected group is the required groupKey itself — NOT a positional
      // substitute — and the binding is exact.
      assert.deepEqual(d.selectedGroups.map((g) => g.questionId), ['555']);
      assert.ok(d.selectedGroups[0].rationaleRef);
      assert.equal(d.selectedGroups[0].rationaleRef.intentIndex, 0);
      assert.equal(d.selectedGroups[0].rationaleRef.groupKey, '555');
      assert.ok(!d.selectedGroups.some((g) => g.questionId === '100'));
    });

    test('F1-T4: two required groupKeys, only one satisfiable → FAIL CLOSED (no AUTO with shortfall)', () => {
      const plan = makePlan({
        sourceGroupIntents: [
          { intent: 'a', constraints: [], groupKey: '555' },
          { intent: 'b', constraints: [], groupKey: '666' },
        ],
      });
      const ph = validPlanHash(plan);
      // Only '555' exists in the pool; '666' can never be satisfied.
      const pool = makePool([cand('555', 0.100), cand('100', 0.050)], ph);
      const d = selectSourceGroups(pool, plan);

      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, 'selection_plan_group_key_unsatisfied');
      assert.equal(d.selectedGroups.length, 0);
    });

    test('F1-T5: any intent with non-empty constraints[] → FAIL CLOSED (no structured constraint semantics in schemaVersion 1)', () => {
      const plan = makePlan({
        sourceGroupIntents: [{ intent: '只看高质量回答', constraints: ['仅高赞回答'], groupKey: null }],
      });
      const ph = validPlanHash(plan);
      const pool = makePool([cand('100', 0.100), cand('200', 0.030)], ph);
      const d = selectSourceGroups(pool, plan);

      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, 'selection_constraint_unevaluable');
      assert.equal(d.selectedGroups.length, 0);
      // Fixed rationale text; constraint strings are not echoed back.
      assert.ok(!d.rationale.includes('仅高赞回答'));
    });
  });

  describe('F2: pool planHash is a hard dependency identity', () => {
    test('F2-T1: pool.planHash missing/undefined/empty → FAIL CLOSED', () => {
      const plan = makePlan();
      const ph = validPlanHash(plan);

      const missing = selectSourceGroups(makePool([cand('100', 0.100)], undefined), plan);
      assert.equal(missing.verdict, SELECT_VERDICT_NONE);
      assert.equal(missing.reason, 'selection_pool_planhash_missing');
      assert.equal(missing.selectedGroups.length, 0);

      const empty = selectSourceGroups(makePool([cand('100', 0.100)], ''), plan);
      assert.equal(empty.verdict, SELECT_VERDICT_NONE);
      assert.equal(empty.reason, 'selection_pool_planhash_missing');
    });

    test('F2-T2: pool.planHash malformed → FAIL CLOSED; decision records poolPlanHash null (no raw echo)', () => {
      const plan = makePlan();
      const ph = validPlanHash(plan);

      for (const malformed of ['not-a-valid-hash', 'A'.repeat(64), `${ph}extra`]) {
        const d = selectSourceGroups(makePool([cand('100', 0.100)], malformed), plan);
        assert.equal(d.verdict, SELECT_VERDICT_NONE);
        assert.equal(d.reason, 'selection_pool_planhash_malformed');
        assert.equal(d.selectedGroups.length, 0);
        // Untrusted raw value is NOT persisted into the decision.
        assert.equal(d.poolPlanHash, null);
      }
    });

    test('F2-T3: pool.planHash valid-format but different from plan planHash → FAIL CLOSED (preserved)', () => {
      const plan = makePlan();
      const ph = validPlanHash(plan);
      const pool = makePool([cand('100', 0.100)], 'a'.repeat(64)); // valid format, wrong identity
      const d = selectSourceGroups(pool, plan);

      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, SELECTION_FAILURE_PLAN_POOL_MISMATCH);
      assert.equal(d.planHash, ph);
      assert.equal(d.poolPlanHash, 'a'.repeat(64));
      assert.equal(d.planHashMatch, false);
    });

    test('F2-T4: reuse seam — missing/malformed pool identities are never reusable', () => {
      const plan = makePlan();
      const ph = validPlanHash(plan);
      const d = selectSourceGroups(makePool([cand('100', 0.100)], ph), plan);
      assert.equal(d.verdict, SELECT_VERDICT_AUTO);

      // Missing currentPoolPlanHash → NOT reusable (stale).
      const missing = selectionDecisionStatus({ decision: d, currentPlanHash: ph, currentPoolPlanHash: undefined });
      assert.equal(missing.reusable, false);
      assert.equal(missing.stale, true);
      assert.equal(missing.reason, 'selection_dependency_missing');

      // Malformed currentPoolPlanHash → NOT reusable (invalid identity).
      const invalidCurrent = selectionDecisionStatus({ decision: d, currentPlanHash: ph, currentPoolPlanHash: 'zzz' });
      assert.equal(invalidCurrent.reusable, false);
      assert.equal(invalidCurrent.stale, true);
      assert.equal(invalidCurrent.reason, 'selection_dependency_invalid');

      // Malformed decision.poolPlanHash → NOT reusable (invalid identity).
      const tampered = { ...d, poolPlanHash: 'bogus' };
      const invalidDecision = selectionDecisionStatus({ decision: tampered, currentPlanHash: ph, currentPoolPlanHash: ph });
      assert.equal(invalidDecision.reusable, false);
      assert.equal(invalidDecision.stale, true);
      assert.equal(invalidDecision.reason, 'selection_dependency_invalid');
    });

    test('F2-T5: exact matching planHash + matching poolPlanHash → reusable=true', () => {
      const plan = makePlan();
      const ph = validPlanHash(plan);
      const d = selectSourceGroups(makePool([cand('100', 0.100)], ph), plan);
      assert.equal(d.verdict, SELECT_VERDICT_AUTO);

      const st = selectionDecisionStatus({ decision: d, currentPlanHash: ph, currentPoolPlanHash: ph });
      assert.equal(st.reusable, true);
      assert.equal(st.stale, false);
      assert.equal(st.reason, null);
    });
  });
});

// ---------------------------------------------------------------------------
// External repair round 2 (review findings P1-1 / P1-2 on candidate 1eeeaa6).
//
// P1-1 — CONSTRAINED GROUP-SET CONSTRUCTION: the selected set must be
//        CONSTRUCTED around the plan's required (non-empty groupKey) intents
//        (constraint-first), not an unconstrained RRF top-k followed by a
//        post-hoc required-key check. An eligible required group ranked below
//        the top-k boundary is a MANDATORY member of the set; remaining slots
//        are filled from eligible NON-required groups in deterministic RRF
//        order; the ambiguity boundary is evaluated ONLY on the optional pool
//        (required membership never distorts it).
// P1-2 — CLARIFICATION IDENTITY BOUNDARY: forceGroupIds is mechanically
//        validated BEFORE any lookup (array / non-empty / string / canonical
//        questionId / unique / eligible), with NO String() coercion anywhere
//        and ONE fixed value-free rationale — no caller-controlled value is
//        ever echoed into the persisted decision artifact.
// ---------------------------------------------------------------------------
describe('repair round 2: constraint-first group-set construction + clarification identity boundary', () => {
  describe('P1-1: constraint-first construction', () => {
    test('P1-1 A: eligible required group ranked below top-k is INCLUDED (auto through construction)', () => {
      const plan = makePlan({
        sourceGroupIntents: [{ intent: '关注反方观点', constraints: [], groupKey: '555' }],
      });
      const ph = validPlanHash(plan);
      // k defaults to intents.length = 1. The old implementation took the
      // unconstrained top-1 ([100]) and failed closed post-hoc even though a
      // valid plan-satisfying set ([555]) exists.
      const pool = makePool([cand('100', 0.100), cand('555', 0.030)], ph);
      const d = selectSourceGroups(pool, plan);

      assert.equal(d.verdict, SELECT_VERDICT_AUTO);
      assert.equal(d.reason, 'clear_best');
      assert.deepEqual(d.selectedGroups.map((g) => g.questionId), ['555']);
      assert.equal(d.selectedGroups[0].rationaleRef.intentIndex, 0);
      assert.equal(d.selectedGroups[0].rationaleRef.groupKey, '555');
      assert.equal(d.intentCoverage.unmet, 0);
      assert.equal(d.intentCoverage.shortfall, 0);
    });

    test('P1-1 B: required group is a mandatory member; optional fill from RRF order', () => {
      const plan = makePlan({
        sourceGroupIntents: [
          { intent: '关注反方观点', constraints: [], groupKey: '555' },
          { intent: '看主流讨论', constraints: [], groupKey: null },
        ],
      });
      const ph = validPlanHash(plan);
      // k = 2 (intents.length); required 555 (.030) + one optional slot filled
      // by the best optional group 100 (.100). The higher-RRF optional group
      // must NOT displace the required groupKey.
      const pool = makePool([cand('100', 0.100), cand('200', 0.090), cand('555', 0.030)], ph);
      const d = selectSourceGroups(pool, plan, { ambiguityMargin: 0.01 });

      assert.equal(d.verdict, SELECT_VERDICT_AUTO);
      assert.equal(d.selectedGroups.length, 2);
      const ids = d.selectedGroups.map((g) => g.questionId).sort();
      assert.deepEqual(ids, ['100', '555']);
      // 555 is bound to the required intent via exact groupKey (intentIndex 0).
      const bound = d.selectedGroups.find((g) => g.questionId === '555');
      assert.ok(bound.rationaleRef);
      assert.equal(bound.rationaleRef.intentIndex, 0);
      assert.equal(bound.rationaleRef.groupKey, '555');
      // Deterministic artifact ordering: score DESC then questionId ASC.
      assert.deepEqual(d.selectedGroups.map((g) => g.questionId), ['100', '555']);
      assert.equal(d.intentCoverage.unmet, 0);
      assert.equal(d.intentCoverage.shortfall, 0);
    });

    test('P1-1 C: required groupKey absent from eligible pool → FAIL CLOSED (regression guard)', () => {
      const plan = makePlan({
        sourceGroupIntents: [{ intent: '关注反方观点', constraints: [], groupKey: '777' }],
      });
      const ph = validPlanHash(plan);
      const pool = makePool([cand('100', 0.100), cand('200', 0.030)], ph);
      const d = selectSourceGroups(pool, plan);

      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, 'selection_plan_group_key_unsatisfied');
      assert.equal(d.selectedGroups.length, 0);
    });

    test('P1-1 D: required group present but below minimum validity → FAIL CLOSED (regression guard)', () => {
      // (i) required group has an invalid (non-finite) rrfScore → ineligible.
      const plan = makePlan({
        sourceGroupIntents: [{ intent: 'a', constraints: [], groupKey: '555' }],
      });
      const ph = validPlanHash(plan);
      const poolInvalid = makePool([
        cand('100', 0.100),
        { identity: { kind: 'candidate', questionId: '555' }, rrfScore: NaN, ranks: [], source_url: 'x', facts: {} },
      ], ph);
      const dInvalid = selectSourceGroups(poolInvalid, plan);
      assert.equal(dInvalid.verdict, SELECT_VERDICT_NONE);
      assert.equal(dInvalid.reason, 'selection_plan_group_key_unsatisfied');

      // (ii) required group is eligible by rrfScore but below minScore.
      const poolBelow = makePool([cand('100', 0.100), cand('555', 0.030)], ph);
      const dBelow = selectSourceGroups(poolBelow, plan, { minScore: 0.5 });
      assert.equal(dBelow.verdict, SELECT_VERDICT_NONE);
      assert.equal(dBelow.reason, 'selection_plan_group_key_unsatisfied');
    });

    test('P1-1 E: ambiguity is driven by the OPTIONAL free-slot boundary only (required membership never distorts it)', () => {
      const plan = makePlan({
        sourceGroupIntents: [
          { intent: '关注反方观点', constraints: [], groupKey: '555' },
          { intent: '看主流讨论', constraints: [], groupKey: null },
        ],
      });
      const ph = validPlanHash(plan);
      // required 555 (.030); optional pool 100 (.100), 200 (.099), 300 (.020).
      // remainingSlots = 1 → free boundary = 100 vs 200 (gap .001 < margin).
      const pool = makePool([cand('555', 0.030), cand('100', 0.100), cand('200', 0.099), cand('300', 0.020)], ph);
      const d = selectSourceGroups(pool, plan, { ambiguityMargin: 0.01 });

      assert.equal(d.verdict, SELECT_VERDICT_AMBIGUOUS);
      assert.equal(d.reason, 'material_ambiguity');
      assert.equal(d.selectedGroups.length, 0);
      // Options express a COMPLETE legal resolution: the required group plus
      // the free-boundary optional candidates.
      const optionIds = d.clarification.options.map((o) => o.groupId);
      assert.ok(optionIds.includes('555'), 'required group must appear in clarification options');
      assert.ok(optionIds.includes('100') && optionIds.includes('200'), 'free-boundary options must appear');
    });

    test('P1-1 E control: fuzzy gap BELOW the optional boundary does NOT trigger ambiguity', () => {
      const plan = makePlan({
        sourceGroupIntents: [
          { intent: '关注反方观点', constraints: [], groupKey: '555' },
          { intent: '看主流讨论', constraints: [], groupKey: null },
        ],
      });
      const ph = validPlanHash(plan);
      // optional pool 100 (.100), 200 (.090), 300 (.089): the top boundary gap
      // (100 vs 200) is wide, but a fuzzy gap exists BELOW the boundary
      // (200 vs 300). The old implementation evaluated the boundary over the
      // merged eligible list including the required group and reported
      // AMBIGUOUS — required membership must not distort the boundary logic.
      const pool = makePool([cand('555', 0.030), cand('100', 0.100), cand('200', 0.090), cand('300', 0.089)], ph);
      const d = selectSourceGroups(pool, plan, { ambiguityMargin: 0.01 });

      assert.equal(d.verdict, SELECT_VERDICT_AUTO);
      assert.equal(d.reason, 'clear_best');
      const ids = d.selectedGroups.map((g) => g.questionId).sort();
      assert.deepEqual(ids, ['100', '555']);
    });
  });

  describe('P1-2: clarification identity boundary', () => {
    /** Ambiguity fixture (plan/pool reach AMBIGUOUS → nearest clarification path). */
    function ambiguousContext() {
      const plan = makePlan();
      const ph = validPlanHash(plan);
      const pool = makePool([cand('100', 0.100), cand('200', 0.099), cand('300', 0.020)], ph);
      return { plan, pool };
    }

    const FIXED_RATIONALE = 'clarification contains an invalid or unavailable source-group identity';

    test('P1-2: non-string entry [{}] → fail closed, no throw, no object coercion, no echo', () => {
      const { plan, pool } = ambiguousContext();
      const d = selectSourceGroups(pool, plan, {
        ambiguityMargin: 0.01,
        clarification: { forceGroupIds: [{}] },
      });
      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, SELECTION_FAILURE_INVALID_CLARIFICATION);
      assert.equal(d.clarificationCount, 0);
      assert.equal(d.rationale, FIXED_RATIONALE);
      assert.ok(!JSON.stringify(d).includes('[object Object]'));
    });

    test('P1-2: non-canonical id ["abc"] → fail closed, no echo', () => {
      const { plan, pool } = ambiguousContext();
      const d = selectSourceGroups(pool, plan, {
        ambiguityMargin: 0.01,
        clarification: { forceGroupIds: ['abc'] },
      });
      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, SELECTION_FAILURE_INVALID_CLARIFICATION);
      assert.equal(d.rationale, FIXED_RATIONALE);
      assert.ok(!JSON.stringify(d).includes('abc'));
    });

    test('P1-2: duplicate ids ["123","123"] → fail closed, no echo', () => {
      const { plan, pool } = ambiguousContext();
      const d = selectSourceGroups(pool, plan, {
        ambiguityMargin: 0.01,
        clarification: { forceGroupIds: ['123', '123'] },
      });
      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, SELECTION_FAILURE_INVALID_CLARIFICATION);
      assert.equal(d.rationale, FIXED_RATIONALE);
      assert.ok(!JSON.stringify(d).includes('123'));
    });

    test('P1-2: credential-shaped value ["token=SECRET_VALUE"] → fail closed; value never persists', () => {
      const { plan, pool } = ambiguousContext();
      const d = selectSourceGroups(pool, plan, {
        ambiguityMargin: 0.01,
        clarification: { forceGroupIds: ['token=SECRET_VALUE'] },
      });
      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, SELECTION_FAILURE_INVALID_CLARIFICATION);
      assert.equal(d.rationale, FIXED_RATIONALE);
      assert.ok(!JSON.stringify(d).includes('SECRET_VALUE'));
      assert.ok(!JSON.stringify(d).includes('token='));
    });

    test('P1-2: unknown canonical id ["999999999999"] → fail closed; raw id never persists', () => {
      const { plan, pool } = ambiguousContext();
      const d = selectSourceGroups(pool, plan, {
        ambiguityMargin: 0.01,
        clarification: { forceGroupIds: ['999999999999'] },
      });
      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, SELECTION_FAILURE_INVALID_CLARIFICATION);
      assert.equal(d.rationale, FIXED_RATIONALE);
      assert.ok(!JSON.stringify(d).includes('999999999999'));
    });

    test('P1-2: valid unique eligible ids → forced resolution still works (AUTO with forced set)', () => {
      const { plan, pool } = ambiguousContext();
      const d = selectSourceGroups(pool, plan, {
        ambiguityMargin: 0.01,
        clarification: { forceGroupIds: ['200'] },
      });
      assert.equal(d.verdict, SELECT_VERDICT_AUTO);
      assert.equal(d.clarificationCount, 1);
      assert.deepEqual(d.selectedGroups.map((g) => g.questionId), ['200']);
      assert.equal(d.selectedGroups[0].selectionReason, SELECT_REASON_CLARIFICATION_FORCED);
    });

    test('P1-2: missing forceGroupIds under a provided clarification object → fail closed (value-free rationale)', () => {
      const { plan, pool } = ambiguousContext();
      const d = selectSourceGroups(pool, plan, {
        ambiguityMargin: 0.01,
        clarification: { note: 'no selection' },
      });
      assert.equal(d.verdict, SELECT_VERDICT_NONE);
      assert.equal(d.reason, SELECTION_FAILURE_INVALID_CLARIFICATION);
      assert.equal(d.rationale, FIXED_RATIONALE);
    });
  });
});

describe('canonical questionId gate consistency with T06', () => {
  // T06 source of truth: rrf.mjs CANONICAL_QUESTION_ID = /^[1-9]\d*$/
  // (unlimited length). The T08 selection boundary must accept exactly the
  // same set of ids — same canonical identity at both boundaries (CE-08).
  test("accepts '123'", () => {
    assert.equal(isCanonicalQuestionId('123'), true);
  });
  test("rejects '0'", () => {
    assert.equal(isCanonicalQuestionId('0'), false);
  });
  test("rejects '0123' (leading zero)", () => {
    assert.equal(isCanonicalQuestionId('0123'), false);
  });
  test("rejects 'abc'", () => {
    assert.equal(isCanonicalQuestionId('abc'), false);
  });
  test("rejects ''", () => {
    assert.equal(isCanonicalQuestionId(''), false);
  });
  test("accepts 20-digit id '9'.repeat(20) (T06 drift case)", () => {
    assert.equal(isCanonicalQuestionId('9'.repeat(20)), true);
  });
  test("accepts 30-digit id '9'.repeat(30)", () => {
    assert.equal(isCanonicalQuestionId('9'.repeat(30)), true);
  });
  test('rejects non-string values', () => {
    assert.equal(isCanonicalQuestionId(123), false);
    assert.equal(isCanonicalQuestionId(null), false);
    assert.equal(isCanonicalQuestionId(undefined), false);
  });
});
