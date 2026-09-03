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

import { test } from 'node:test';
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

test('planHash dependency: missing pool planHash tolerates, status checks plan only', () => {
  const plan = makePlan();
  const ph = validPlanHash(plan);
  const pool = makePool([cand('100', 0.100)], undefined); // no pool planHash
  const d = selectSourceGroups(pool, plan);
  assert.equal(d.planHash, ph);
  assert.equal(d.poolPlanHash, null);
  // Status only asserts plan identity when pool identity absent.
  const st = selectionDecisionStatus({ decision: d, currentPlanHash: ph, currentPoolPlanHash: undefined });
  assert.equal(st.reusable, true);
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
