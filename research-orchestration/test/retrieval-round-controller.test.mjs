// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/retrieval-round-controller.test.mjs
 *
 * P1-T07 focused tests — Retrieval-round controller infrastructure (Issue #39, Spec §9, §6.2).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialCoverageState,
} from '../lib/coverage-state.mjs';
import {
  DECISION_CONTINUE,
  DECISION_SATURATED,
  DECISION_BUDGET_STOP,
  DECISION_PROVIDER_FAILURE,
  CONTROLLER_ERROR_INVALID_CONFIG,
  CONTROLLER_ERROR_INVALID_INPUT,
  SATURATION_SEMANTICS_DISCLAIMER,
  resolveRoundControllerConfig,
  evaluateRetrievalRound,
  applyRoundEvaluationToCoverageState,
} from '../lib/retrieval-round-controller.mjs';

const VALID_PLAN_HASH = 'b'.repeat(64);

test('P1-T07: resolveRoundControllerConfig defaults and validation', () => {
  // Default config
  const def = resolveRoundControllerConfig({});
  assert.equal(def.maxRetrievalRounds, 3);
  assert.equal(def.maxQueryBudget, 10);
  assert.equal(def.saturationNoveltyGainThreshold, 0.05);
  assert.equal(def.minRoundsBeforeSaturation, 1);

  // Custom valid overrides
  const custom = resolveRoundControllerConfig({
    maxRetrievalRounds: 5,
    maxQueryBudget: 20,
    saturationNoveltyGainThreshold: 0.1,
    minRoundsBeforeSaturation: 2,
  });
  assert.equal(custom.maxRetrievalRounds, 5);
  assert.equal(custom.maxQueryBudget, 20);
  assert.equal(custom.saturationNoveltyGainThreshold, 0.1);
  assert.equal(custom.minRoundsBeforeSaturation, 2);

  // Invalid configs fail closed
  assert.throws(() => resolveRoundControllerConfig({ maxRetrievalRounds: 0 }), (err) => err.code === CONTROLLER_ERROR_INVALID_CONFIG);
  assert.throws(() => resolveRoundControllerConfig({ maxRetrievalRounds: -1 }), (err) => err.code === CONTROLLER_ERROR_INVALID_CONFIG);
  assert.throws(() => resolveRoundControllerConfig({ maxQueryBudget: 'ten' }), (err) => err.code === CONTROLLER_ERROR_INVALID_CONFIG);
  assert.throws(() => resolveRoundControllerConfig({ saturationNoveltyGainThreshold: 1.5 }), (err) => err.code === CONTROLLER_ERROR_INVALID_CONFIG);
  assert.throws(() => resolveRoundControllerConfig({ saturationNoveltyGainThreshold: -0.1 }), (err) => err.code === CONTROLLER_ERROR_INVALID_CONFIG);
});

test('P1-T07: evaluateRetrievalRound - CONTINUE decision', () => {
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1,
    newCandidatesCount: 10,
    totalCandidatesCount: 10, // 100% novelty gain
    executedRoutesThisRound: [{ query: 'q1', providerId: 'p1', capability: 'search', roundIndex: 1 }],
  });

  assert.equal(result.decision, DECISION_CONTINUE);
  assert.equal(result.shouldStop, false);
  assert.equal(result.nextRoundIndex, 2);
  assert.equal(result.noveltyGain, 1);
  assert.equal(result.saturationSemantics, null);
});

test('P1-T07: evaluateRetrievalRound - SATURATED decision (diminished novelty gain)', () => {
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  // 1 new candidate out of 100 total = 0.01 novelty gain < 0.05 threshold
  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 2,
    newCandidatesCount: 1,
    totalCandidatesCount: 100,
    executedRoutesThisRound: [{ query: 'q2', providerId: 'p1', capability: 'search', roundIndex: 2 }],
  });

  assert.equal(result.decision, DECISION_SATURATED);
  assert.equal(result.shouldStop, true);
  assert.equal(result.stopReason, 'marginal_gain_below_threshold');
  assert.equal(result.nextRoundIndex, null);
  assert.equal(result.noveltyGain, 0.01);

  // Saturation semantics disclaimer must be present and accurate
  assert.ok(result.saturationSemantics);
  assert.equal(result.saturationSemantics.meaning, SATURATION_SEMANTICS_DISCLAIMER.meaning);
  assert.deepEqual(result.saturationSemantics.nonGoals, SATURATION_SEMANTICS_DISCLAIMER.nonGoals);
});

test('P1-T07: evaluateRetrievalRound - SATURATED decision (0 new candidates)', () => {
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 2,
    newCandidatesCount: 0,
    totalCandidatesCount: 50,
    executedRoutesThisRound: [{ query: 'q2', providerId: 'p1', capability: 'search', roundIndex: 2 }],
  });

  assert.equal(result.decision, DECISION_SATURATED);
  assert.equal(result.shouldStop, true);
  assert.equal(result.stopReason, 'zero_new_candidates');
});

test('P1-T07: evaluateRetrievalRound - BUDGET_STOP (max rounds reached)', () => {
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  // Round 3 with default maxRetrievalRounds=3
  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 3,
    newCandidatesCount: 15,
    totalCandidatesCount: 30, // 50% gain, but round 3 reaches limit
    executedRoutesThisRound: [{ query: 'q3', providerId: 'p1', capability: 'search', roundIndex: 3 }],
  });

  assert.equal(result.decision, DECISION_BUDGET_STOP);
  assert.equal(result.shouldStop, true);
  assert.equal(result.stopReason, 'max_rounds_reached');
});

test('P1-T07: evaluateRetrievalRound - BUDGET_STOP (query budget exhausted)', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });
  // Add 9 existing routes
  state.retrieval.executedRoutes = Array(9).fill({ query: 'q', providerId: 'p', capability: 's', roundIndex: 1 });

  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 2,
    newCandidatesCount: 10,
    totalCandidatesCount: 20,
    executedRoutesThisRound: [
      { query: 'q10', providerId: 'p', capability: 's', roundIndex: 2 },
      { query: 'q11', providerId: 'p', capability: 's', roundIndex: 2 },
    ], // 9 + 2 = 11 > 10
  });

  assert.equal(result.decision, DECISION_BUDGET_STOP);
  assert.equal(result.shouldStop, true);
  assert.equal(result.stopReason, 'query_budget_exhausted');
});

test('P1-T07: evaluateRetrievalRound - PROVIDER_FAILURE (all routes failed in round)', () => {
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1,
    newCandidatesCount: 0,
    totalCandidatesCount: 0,
    executedRoutesThisRound: [],
    providerFailuresThisRound: [{ code: 'TIMEOUT', class: 'NETWORK_FAILURE' }],
  });

  assert.equal(result.decision, DECISION_PROVIDER_FAILURE);
  assert.equal(result.shouldStop, true);
  assert.equal(result.stopReason, 'all_providers_failed_this_round');
});

test('P1-T07: applyRoundEvaluationToCoverageState deterministically updates coverage state', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  const route1 = { query: 'q1', providerId: 'p1', capability: 'search', roundIndex: 1 };
  const evalResult1 = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1,
    newCandidatesCount: 10,
    totalCandidatesCount: 10,
    executedRoutesThisRound: [route1],
  });

  state = applyRoundEvaluationToCoverageState(state, evalResult1, {
    executedRoutesThisRound: [route1],
    fusedCandidateCount: 10,
  });

  assert.equal(state.retrieval.retrievalRounds, 1);
  assert.equal(state.retrieval.fusedCandidateCount, 10);
  assert.equal(state.retrieval.fusedGroupCount, 0, 'fusedGroupCount is owned by T08 and must not be mutated by retrieval controller');
  assert.equal(state.retrieval.executedRoutes.length, 1);
  assert.equal(state.retrieval.stopReason, null);
  assert.equal(state.diagnostics.novelty_gain, 1);
});

test('P1-T07: Input validation fail closed in evaluateRetrievalRound', () => {
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  assert.throws(
    () => evaluateRetrievalRound({ coverageState: null, roundIndex: 1, newCandidatesCount: 0, totalCandidatesCount: 0 }),
    (err) => err.code === CONTROLLER_ERROR_INVALID_INPUT
  );

  assert.throws(
    () => evaluateRetrievalRound({ coverageState: state, roundIndex: 0, newCandidatesCount: 0, totalCandidatesCount: 0 }),
    (err) => err.code === CONTROLLER_ERROR_INVALID_INPUT
  );

  assert.throws(
    () => evaluateRetrievalRound({ coverageState: state, roundIndex: 1, newCandidatesCount: 10, totalCandidatesCount: 5 }),
    (err) => err.code === CONTROLLER_ERROR_INVALID_INPUT
  );
});
test('P1-T07: evaluateRetrievalRound rejects empty/no-op retrieval rounds', () => {
  const coverageState = createInitialCoverageState({ planHash: 'a'.repeat(64) });
  assert.throws(() => {
    evaluateRetrievalRound({
      coverageState,
      roundIndex: 1,
      newCandidatesCount: 0,
      totalCandidatesCount: 0,
      executedRoutesThisRound: [],
      providerFailuresThisRound: [],
      config: { maxRetrievalRounds: 5, maxQueryBudget: 100, saturationNoveltyGainThreshold: 0.1, minRoundsBeforeSaturation: 1 }
    });
  }, (err) => err.code === 'controller_invalid_input' && err.message.includes('no-op'));
});

test('P1-T07: F4 - Saturation Requires Policy Execution Evidence', () => {
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });
  // Add 5 planned routes
  state.retrieval.plannedRoutes = Array(5).fill({ providerId: 'p', capability: 's' });
  
  // Example: 5 required planned routes, 1 route executed, 0 new candidates, 4 routes never attempted
  // Should NOT SATURATE!
  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1, // min rounds is 1
    newCandidatesCount: 0,
    totalCandidatesCount: 10,
    executedRoutesThisRound: [{ query: 'q', providerId: 'p', capability: 's', roundIndex: 1 }],
    providerFailuresThisRound: []
  });
  
  assert.notEqual(result.decision, DECISION_SATURATED, 'Should not saturate when execution evidence is missing for planned routes');
  // It should probably continue, or budget stop if budget was 1, but budget is 10.
});

test('P1-T07: F6 - Round Monotonicity', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });
  state.retrieval.retrievalRounds = 2;
  state.retrieval.fusedCandidateCount = 10;
  
  assert.throws(() => {
    evaluateRetrievalRound({
      coverageState: state,
      roundIndex: 2, // not strictly greater
      newCandidatesCount: 1,
      totalCandidatesCount: 11,
      executedRoutesThisRound: [{ query: 'q', providerId: 'p', capability: 's', roundIndex: 2 }]
    });
  }, (err) => err.code === CONTROLLER_ERROR_INVALID_INPUT && err.message.includes('must be strictly greater'));

  assert.throws(() => {
    evaluateRetrievalRound({
      coverageState: state,
      roundIndex: 3,
      newCandidatesCount: 0,
      totalCandidatesCount: 9, // regressed
      executedRoutesThisRound: [{ query: 'q', providerId: 'p', capability: 's', roundIndex: 3 }]
    });
  }, (err) => err.code === CONTROLLER_ERROR_INVALID_INPUT && err.message.includes('cannot be less than current fusedCandidateCount'));
});

test('P1-T07: F7 - Query Budget Accounting counts providerFailures', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });
  
  // Set budget to 2
  // We execute 1 route, and have 1 provider failure => Total 2 ATTEMPTS.
  // Next round should be BUDGET_STOP.
  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1,
    newCandidatesCount: 1,
    totalCandidatesCount: 1,
    executedRoutesThisRound: [{ query: 'q', providerId: 'p', capability: 's', roundIndex: 1 }],
    providerFailuresThisRound: [{ code: 'ERR', class: 'NETWORK', query: 'q' }],
    config: { maxQueryBudget: 2 }
  });
  
  assert.equal(result.decision, DECISION_BUDGET_STOP, 'Should budget stop when total attempts reach maxQueryBudget');
});

test('P1-T07: F8 - Evaluation / Apply Binding', () => {
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });
  const executed = [{ query: 'q1', providerId: 'p', capability: 's', roundIndex: 1 }];
  const failures = [{ code: 'ERR', class: 'NET', query: 'q2' }];
  
  const result = evaluateRetrievalRound({
    coverageState: state,
    roundIndex: 1,
    newCandidatesCount: 1,
    totalCandidatesCount: 1,
    executedRoutesThisRound: executed,
    providerFailuresThisRound: failures
  });
  
  // applyRoundEvaluationToCoverageState must extract executed/failures from result!
  // It shouldn't take them as arguments.
  const updated = applyRoundEvaluationToCoverageState(state, result, {
    fusedCandidateCount: 1,
    fusedGroupCount: 1
  });
  
  assert.equal(updated.retrieval.executedRoutes.length, 1);
  assert.equal(updated.retrieval.providerFailures.length, 1);
});
