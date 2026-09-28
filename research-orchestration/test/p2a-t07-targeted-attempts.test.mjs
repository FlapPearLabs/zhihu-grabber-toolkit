// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p2a-t07-targeted-attempts.test.mjs
 *
 * P2A-T07 (#119) focused tests — targeted attempt counting + global budget / STOP
 * integration (SEAM F.6 / F.6.1; Seam Map S11; Spec §5 D4 / D6, §11, §13; H-1…H-5;
 * D12-4 / D12-6).
 *
 * T07 owns: the additive `targetedAttempts` input on `evaluateRetrievalRound`, the
 * two denominator semantics (attemptsBudgetCount includes targeted attempts,
 * plannedCoverageCount is verbatim the old cumulativeAttemptsCount and excludes
 * them), and the deterministic ledger → counts export.
 * T07 explicitly does NOT own: writing executedRoutes, changing plannedRoutes, any
 * cost/token/money controller, any new round semantics, any
 * SATURATION_SEMANTICS_DISCLAIMER change, retrieval IO, orchestration.
 *
 * Anti-tautology discipline: expected denominators are computed here from the raw
 * route/failure arrays with the frozen formula, never by re-reading the module's
 * own output fields as ground truth.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createInitialCoverageState } from '../lib/coverage-state.mjs';
import {
  DECISION_BUDGET_STOP,
  DECISION_CONTINUE,
  DECISION_SATURATED,
  CONTROLLER_ERROR_INVALID_INPUT,
  evaluateRetrievalRound,
} from '../lib/retrieval-round-controller.mjs';
import {
  ATTEMPT_ERROR_INVALID,
  computeTargetedAttemptCounts,
} from '../lib/targeted-requery-attempts.mjs';
import {
  ACTION_STATUS_AUTHORIZED,
  ACTION_STATUS_COMMITTED,
  ACTION_STATUS_EVALUATED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
  ACTION_STATUS_FAILED_OPERATIONAL,
  ACTION_STATUS_PROPOSED,
  ACTION_STATUS_REJECTED,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
} from '../lib/targeted-requery-lifecycle.mjs';

const MODULE_PATH = fileURLToPath(new URL('../lib/retrieval-round-controller.mjs', import.meta.url));
const PLAN_HASH = 'b'.repeat(64);

const ROUTE_A = { query: 'q1', providerId: 'official', capability: 'search' };
const ROUTE_B = { query: 'q2', providerId: 'official', capability: 'search' };
const FAILURE_A = { query: 'q1', providerId: 'official', capability: 'search', errorCode: 'E_X' };

function makeState({ plannedRoutes = 3 } = {}) {
  const state = createInitialCoverageState({ planHash: PLAN_HASH });
  state.retrieval.plannedRoutes = Array.from({ length: plannedRoutes }, (_, i) => ({
    query: `planned-${i}`, providerId: 'official', capability: 'search',
  }));
  return state;
}

function evaluate(state, overrides = {}) {
  return evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1,
    newCandidatesCount: 1,
    totalCandidatesCount: 2,
    executedRoutesThisRound: [ROUTE_A],
    providerFailuresThisRound: [],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// A. F.6.1 — additive input, default-verbatim equivalence
// ---------------------------------------------------------------------------

test('A1 — default (no targetedAttempts): both denominators equal the frozen old formula', () => {
  const state = makeState();
  const result = evaluate(state);
  const existing = state.retrieval.executedRoutes.length;
  const failures = state.retrieval.providerFailures.length;
  // frozen formula, computed HERE from the raw arrays (not from the result fields)
  const oldCumulative = existing + 1 + failures + 0;
  assert.equal(result.plannedCoverageCount, oldCumulative);
  assert.equal(result.attemptsBudgetCount, oldCumulative);
  assert.deepEqual(result.targetedAttempts, { executed: 0, failed: 0 });
});

test('A2 — explicitly passing zero targeted attempts is byte-equivalent to the default', () => {
  const state = makeState();
  const without = evaluate(state);
  const withZero = evaluate(state, { targetedAttempts: { executed: 0, failed: 0 } });
  assert.deepEqual(
    { ...without, targetedAttempts: null },
    { ...withZero, targetedAttempts: null },
  );
});

test('A3 — targetedAttempts participates ONLY in attemptsBudgetCount (F.6)', () => {
  const state = makeState();
  const result = evaluate(state, { targetedAttempts: { executed: 2, failed: 1 } });
  const oldCumulative = state.retrieval.executedRoutes.length + 1 + state.retrieval.providerFailures.length;
  assert.equal(result.plannedCoverageCount, oldCumulative);           // excluded
  assert.equal(result.attemptsBudgetCount, oldCumulative + 2 + 1);    // included
});

test('A4 — malformed targetedAttempts fail closed (typed)', () => {
  const state = makeState();
  for (const bad of [
    { executed: -1, failed: 0 },
    { executed: 0, failed: 1.5 },
    { executed: 0, failed: '2' },
    { executed: 0 },
    { failed: 0 },
    { executed: 0, failed: 0, extra: 1 },
    'not an object',
    [0, 0],
    3,
  ]) {
    assert.throws(
      () => evaluate(state, { targetedAttempts: bad }),
      (err) => err.code === CONTROLLER_ERROR_INVALID_INPUT,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// B. H-3 / H-5 — BUDGET_STOP denominator includes targeted; saturation does not
// ---------------------------------------------------------------------------

test('B1 — targeted attempts can trigger BUDGET_STOP that the plan routes alone would not (H-3)', () => {
  // 1 existing route + 1 this round = 2 < maxQueryBudget(10); +4 targeted = 6 < 10.
  // Push targeted high enough to cross the budget line.
  const state = makeState({ plannedRoutes: 8 });
  const without = evaluate(state, { targetedAttempts: { executed: 0, failed: 0 } });
  assert.equal(without.decision, DECISION_CONTINUE);
  const withTargeted = evaluate(state, { targetedAttempts: { executed: 7, failed: 2 } });
  assert.equal(withTargeted.decision, DECISION_BUDGET_STOP);
  assert.equal(withTargeted.stopReason, 'query_budget_exhausted');
});

test('B2 — targeted attempts NEVER advance the saturation precondition (H-2 / H-5)', () => {
  // plannedRoutes = 5, cumulative = 1, targeted = 4 → attemptsBudgetCount = 5
  // (a naive implementation that fed the budget count into the saturation
  // precondition would see 5 >= 5 and SATURATE) but plannedCoverageCount = 1 < 5,
  // so the honest outcome is CONTINUE.
  const state = makeState({ plannedRoutes: 5 });
  const result = evaluate(state, { targetedAttempts: { executed: 2, failed: 2 } });
  assert.equal(result.attemptsBudgetCount, 5);
  assert.equal(result.plannedCoverageCount, 1);
  assert.equal(result.decision, DECISION_CONTINUE);
});

test('B3 — targeted attempts cannot BLOCK a saturation that the plan routes earned (H-5)', () => {
  // plannedRoutes = 2, cumulative = 2, zero failures, zero new candidates →
  // SATURATED with or without targeted attempts (identical decision).
  const state = makeState({ plannedRoutes: 2 });
  const base = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1,
    newCandidatesCount: 0,
    totalCandidatesCount: 2,
    executedRoutesThisRound: [ROUTE_A, ROUTE_B],
    providerFailuresThisRound: [],
  });
  assert.equal(base.decision, DECISION_SATURATED);
  const withTargeted = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1,
    newCandidatesCount: 0,
    totalCandidatesCount: 2,
    executedRoutesThisRound: [ROUTE_A, ROUTE_B],
    providerFailuresThisRound: [],
    targetedAttempts: { executed: 1, failed: 1 },
  });
  assert.equal(withTargeted.decision, DECISION_SATURATED);
  assert.equal(withTargeted.plannedCoverageCount, base.plannedCoverageCount);
});

// ---------------------------------------------------------------------------
// C. H-1 / H-4 — plannedRoutes untouched; no new round semantics
// ---------------------------------------------------------------------------

test('C1 — plannedRoutes are byte-identical before and after (H-1)', () => {
  const state = makeState({ plannedRoutes: 3 });
  const before = JSON.stringify(state.retrieval.plannedRoutes);
  evaluate(state, { targetedAttempts: { executed: 5, failed: 5 } });
  assert.equal(JSON.stringify(state.retrieval.plannedRoutes), before);
});

test('C2 — targeted attempts do not change round semantics (H-4)', () => {
  const state = makeState();
  const without = evaluate(state);
  const withTargeted = evaluate(state, { targetedAttempts: { executed: 4, failed: 4 } });
  assert.equal(without.roundIndex, withTargeted.roundIndex);
  assert.equal(without.nextRoundIndex, withTargeted.nextRoundIndex);
  assert.equal(without.shouldStop, withTargeted.shouldStop);
});

// ---------------------------------------------------------------------------
// D. F.6 — deterministic ledger → counts export (AC6)
// ---------------------------------------------------------------------------

function action(status, scopeSize) {
  return {
    status,
    providerScope: Array.from({ length: scopeSize }, (_, i) => ({ providerId: `p${i}`, capability: 'search' })),
  };
}

test('D1 — counts are the providerScope expansion of the committed set (F.6)', () => {
  const counts = computeTargetedAttemptCounts({
    actions: [
      action(ACTION_STATUS_COMMITTED, 2),
      action(ACTION_STATUS_EVALUATED, 1),
      action(ACTION_STATUS_RESOLVED, 3),
      action(ACTION_STATUS_UNRESOLVED, 1),
      action(ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET, 2),
      action(ACTION_STATUS_FAILED_OPERATIONAL, 2),
      action(ACTION_STATUS_AUTHORIZED, 5),   // not executed yet
      action(ACTION_STATUS_PROPOSED, 5),     // not actionable
      action(ACTION_STATUS_REJECTED, 5),     // no IO by definition (E.7)
    ],
  });
  assert.equal(counts.executed, 2 + 1 + 3 + 1 + 2);
  assert.equal(counts.failed, 2);
});

test('D2 — the export is deterministic and read-only', () => {
  const actions = [action(ACTION_STATUS_COMMITTED, 2), action(ACTION_STATUS_FAILED_OPERATIONAL, 1)];
  const a = computeTargetedAttemptCounts({ actions });
  const b = computeTargetedAttemptCounts({ actions });
  assert.deepEqual(a, b);
  assert.equal(a.executed, 2);
  assert.equal(a.failed, 1);
});

test('D3 — malformed count input fails closed (typed)', () => {
  assert.throws(() => computeTargetedAttemptCounts({ actions: 'no' }), (err) => err.code === ATTEMPT_ERROR_INVALID);
  assert.throws(() => computeTargetedAttemptCounts({ actions: [42] }), (err) => err.code === ATTEMPT_ERROR_INVALID);
  assert.throws(
    () => computeTargetedAttemptCounts({ actions: [{ status: 'SOMETHING_ELSE', providerScope: [] }] }),
    (err) => err.code === ATTEMPT_ERROR_INVALID,
  );
  assert.throws(
    () => computeTargetedAttemptCounts({ actions: [{ status: ACTION_STATUS_COMMITTED, providerScope: 'no' }] }),
    (err) => err.code === ATTEMPT_ERROR_INVALID,
  );
});

test('D4 — an empty ledger yields { executed: 0, failed: 0 } (the additive default)', () => {
  assert.deepEqual(computeTargetedAttemptCounts({ actions: [] }), { executed: 0, failed: 0 });
  assert.deepEqual(computeTargetedAttemptCounts({}), { executed: 0, failed: 0 });
});

// ---------------------------------------------------------------------------
// E. source guards — ownership prohibitions
// ---------------------------------------------------------------------------

test('E1 — the round controller gains no targeted-ledger import and no coverage writes', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  // the P1 controller must stay ignorant of the targeted family (F.6.1: one additive input)
  assert.equal(/targeted-requery/.test(source), false);
  // no executedRoutes backfill from targeted attempts
  assert.equal(/targetedAttempts.*executedRoutes|executedRoutes.*targetedAttempts/.test(source), false);
});

test('E2 — the saturation disclaimer is untouched (H-3 wording unchanged)', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(/SATURATION_SEMANTICS_DISCLAIMER/.test(source), true);
  assert.equal(/Marginal information gain under the current retrieval policy has diminished/.test(source), true);
});
