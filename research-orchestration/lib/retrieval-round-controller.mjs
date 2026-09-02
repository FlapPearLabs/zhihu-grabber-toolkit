// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/retrieval-round-controller.mjs
 *
 * P1-T07 — Retrieval-round controller infrastructure.
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §9, §6.2; Issue #39.)
 *
 * Architecture & Decision Semantics:
 *   Evaluates deterministic state transitions for retrieval rounds:
 *     ROUND_COMPLETED
 *     → update Retrieval Coverage
 *     → evaluate retrieval-level saturation / budget state
 *     → one of:
 *       - CONTINUE
 *       - SATURATED
 *       - BUDGET_STOP
 *       - PROVIDER_FAILURE
 *
 * Saturation Semantics (Spec §9 / Issue #39 hard requirement):
 *   SATURATED means ONLY:
 *     Marginal information gain under the CURRENT retrieval policy has diminished
 *     according to the current implementation policy.
 *   SATURATED MUST NOT mean:
 *     - All relevant information has been found
 *     - Global search completeness
 *     - No undiscovered source exists
 *     - Final research completeness
 *     - Final analysis completeness
 *
 * Ownership Boundaries:
 *   T07 provides round controller infrastructure.
 *   T07 does NOT implement:
 *     - T08 source-group set selection / ambiguity gate
 *     - T09 multi-group execution
 *     - T12 RCE selector
 *     - T15 complete saturation feedback wiring
 *     - Issue #53 targeted re-query
 *     - Issue #54 escape probe
 *     - Issue #55 advanced research loop
 */

import {
  OWNER_RETRIEVAL_CONTROLLER,
  IMPLEMENTATION_DEFAULTS_RECORD,
  updateRetrievalCoverage,
  canonicalizeCoverageState,
  validateCoverageState,
} from './coverage-state.mjs';

/** Round decision identities. */
export const DECISION_CONTINUE = 'CONTINUE';
export const DECISION_SATURATED = 'SATURATED';
export const DECISION_BUDGET_STOP = 'BUDGET_STOP';
export const DECISION_PROVIDER_FAILURE = 'PROVIDER_FAILURE';

/** Controller error codes. */
export const CONTROLLER_ERROR_INVALID_CONFIG = 'controller_invalid_config';
export const CONTROLLER_ERROR_INVALID_INPUT = 'controller_invalid_input';

/** Saturation semantics definition. */
export const SATURATION_SEMANTICS_DISCLAIMER = Object.freeze({
  meaning: 'Marginal information gain under the current retrieval policy has diminished according to the current implementation policy.',
  nonGoals: Object.freeze([
    'Does not imply all relevant information has been found',
    'Does not imply global search completeness',
    'Does not imply no undiscovered source exists',
    'Does not imply final research completeness',
    'Does not imply final analysis completeness',
  ]),
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isPositiveInteger(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

function isNonNegativeInteger(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && !Number.isNaN(v);
}

function isRatio0to1(v) {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

/**
 * Validates and resolves round controller configuration.
 * Uses explicit implementation defaults from IMPLEMENTATION_DEFAULTS_RECORD.
 */
export function resolveRoundControllerConfig(customConfig = {}) {
  if (!isPlainObject(customConfig)) {
    const err = new Error('Controller config must be a plain object');
    err.code = CONTROLLER_ERROR_INVALID_CONFIG;
    throw err;
  }

  const ALLOWED_CONFIG_KEYS = new Set([
    'maxRetrievalRounds',
    'maxQueryBudget',
    'saturationNoveltyGainThreshold',
    'minRoundsBeforeSaturation',
  ]);
  for (const key of Object.keys(customConfig)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      const err = new Error(`Unknown controller config key: ${key}`);
      err.code = CONTROLLER_ERROR_INVALID_CONFIG;
      throw err;
    }
  }

  const d = IMPLEMENTATION_DEFAULTS_RECORD.retrieval;

  const maxRetrievalRounds = customConfig.maxRetrievalRounds ?? d.defaultMaxRetrievalRounds;
  if (!isPositiveInteger(maxRetrievalRounds)) {
    const err = new Error(`maxRetrievalRounds must be a positive integer, got ${maxRetrievalRounds}`);
    err.code = CONTROLLER_ERROR_INVALID_CONFIG;
    throw err;
  }

  const maxQueryBudget = customConfig.maxQueryBudget ?? d.defaultMaxQueryBudget;
  if (!isPositiveInteger(maxQueryBudget)) {
    const err = new Error(`maxQueryBudget must be a positive integer, got ${maxQueryBudget}`);
    err.code = CONTROLLER_ERROR_INVALID_CONFIG;
    throw err;
  }

  const saturationNoveltyGainThreshold = customConfig.saturationNoveltyGainThreshold ?? d.defaultSaturationNoveltyGainThreshold;
  if (!isRatio0to1(saturationNoveltyGainThreshold)) {
    const err = new Error(`saturationNoveltyGainThreshold must be between 0 and 1, got ${saturationNoveltyGainThreshold}`);
    err.code = CONTROLLER_ERROR_INVALID_CONFIG;
    throw err;
  }

  const minRoundsBeforeSaturation = customConfig.minRoundsBeforeSaturation ?? d.defaultMinRoundsBeforeSaturation;
  if (!isPositiveInteger(minRoundsBeforeSaturation)) {
    const err = new Error(`minRoundsBeforeSaturation must be a positive integer, got ${minRoundsBeforeSaturation}`);
    err.code = CONTROLLER_ERROR_INVALID_CONFIG;
    throw err;
  }

  return Object.freeze({
    maxRetrievalRounds,
    maxQueryBudget,
    saturationNoveltyGainThreshold,
    minRoundsBeforeSaturation,
  });
}

/**
 * Evaluates the next retrieval round transition deterministically.
 *
 * @param {object} params
 * @param {object} params.coverageState - Current valid ResearchCoverageState
 * @param {number} params.roundIndex - Current round index (1-based)
 * @param {number} params.newCandidatesCount - Count of new unique candidates discovered in this round
 * @param {number} params.totalCandidatesCount - Cumulative unique candidates count after this round
 * @param {Array} params.executedRoutesThisRound - Routes executed in this round
 * @param {Array} [params.providerFailuresThisRound] - Provider failures in this round
 * @param {object} [params.config] - Optional configuration overrides
 * @returns {object} Evaluation result with decision, stopReason, noveltyGain, nextRoundIndex, semantics
 */
export function evaluateRetrievalRound({
  coverageState,
  roundIndex,
  newCandidatesCount,
  totalCandidatesCount,
  executedRoutesThisRound = [],
  providerFailuresThisRound = [],
  config = {},
} = {}) {
  const stateValidation = validateCoverageState(coverageState);
  if (!stateValidation.ok) {
    const err = new Error(`Invalid coverage state provided to round controller: ${stateValidation.error}`);
    err.code = CONTROLLER_ERROR_INVALID_INPUT;
    throw err;
  }

  if (!isPositiveInteger(roundIndex)) {
    const err = new Error(`roundIndex must be a positive integer (1-based), got ${roundIndex}`);
    err.code = CONTROLLER_ERROR_INVALID_INPUT;
    throw err;
  }

  if (!isNonNegativeInteger(newCandidatesCount)) {
    const err = new Error(`newCandidatesCount must be a non-negative integer, got ${newCandidatesCount}`);
    err.code = CONTROLLER_ERROR_INVALID_INPUT;
    throw err;
  }

  if (!isNonNegativeInteger(totalCandidatesCount)) {
    const err = new Error(`totalCandidatesCount must be a non-negative integer, got ${totalCandidatesCount}`);
    err.code = CONTROLLER_ERROR_INVALID_INPUT;
    throw err;
  }

  if (newCandidatesCount > totalCandidatesCount) {
    const err = new Error(`newCandidatesCount (${newCandidatesCount}) cannot exceed totalCandidatesCount (${totalCandidatesCount})`);
    err.code = CONTROLLER_ERROR_INVALID_INPUT;
    throw err;
  }

  if (!Array.isArray(executedRoutesThisRound)) {
    const err = new Error('executedRoutesThisRound must be an array');
    err.code = CONTROLLER_ERROR_INVALID_INPUT;
    throw err;
  }
  for (const r of executedRoutesThisRound) {
    if (!r || typeof r !== 'object' || typeof r.query !== 'string' || typeof r.providerId !== 'string' || typeof r.capability !== 'string') {
      const err = new Error('executedRoutesThisRound entries must be valid route objects (query, providerId, capability)');
      err.code = CONTROLLER_ERROR_INVALID_INPUT;
      throw err;
    }
  }

  if (!Array.isArray(providerFailuresThisRound)) {
    const err = new Error('providerFailuresThisRound must be an array');
    err.code = CONTROLLER_ERROR_INVALID_INPUT;
    throw err;
  }

  const resolvedConfig = resolveRoundControllerConfig(config);

  // Cumulative accounting
  const existingExecutedRoutes = coverageState.retrieval.executedRoutes;
  const cumulativeExecutedRoutesCount = existingExecutedRoutes.length + executedRoutesThisRound.length;

  // Compute novelty gain: new / total
  const noveltyGain = totalCandidatesCount > 0 ? Number((newCandidatesCount / totalCandidatesCount).toFixed(6)) : 0;

  if (executedRoutesThisRound.length === 0 && providerFailuresThisRound.length === 0) {
    const err = new Error('Empty/no-op retrieval round does not prove saturation');
    err.code = CONTROLLER_ERROR_INVALID_INPUT;
    throw err;
  }

  // 1. Check all provider failures in this round (zero executed routes and >0 failures)
  if (executedRoutesThisRound.length === 0 && providerFailuresThisRound.length > 0) {
    return {
      decision: DECISION_PROVIDER_FAILURE,
      stopReason: 'all_providers_failed_this_round',
      roundIndex,
      noveltyGain,
      cumulativeExecutedRoutesCount,
      totalCandidatesCount,
      saturationSemantics: null,
      shouldStop: true,
      nextRoundIndex: null,
    };
  }

  // 2. Check Budget Stop: Max rounds reached
  if (roundIndex >= resolvedConfig.maxRetrievalRounds) {
    return {
      decision: DECISION_BUDGET_STOP,
      stopReason: 'max_rounds_reached',
      roundIndex,
      noveltyGain,
      cumulativeExecutedRoutesCount,
      totalCandidatesCount,
      saturationSemantics: null,
      shouldStop: true,
      nextRoundIndex: null,
    };
  }

  // 3. Check Budget Stop: Query budget exhausted
  if (cumulativeExecutedRoutesCount >= resolvedConfig.maxQueryBudget) {
    return {
      decision: DECISION_BUDGET_STOP,
      stopReason: 'query_budget_exhausted',
      roundIndex,
      noveltyGain,
      cumulativeExecutedRoutesCount,
      totalCandidatesCount,
      saturationSemantics: null,
      shouldStop: true,
      nextRoundIndex: null,
    };
  }

  // 4. Check Saturation (only if roundIndex >= minRoundsBeforeSaturation and NO provider failures in this round)
  if (roundIndex >= resolvedConfig.minRoundsBeforeSaturation && providerFailuresThisRound.length === 0) {
    if (newCandidatesCount === 0) {
      return {
        decision: DECISION_SATURATED,
        stopReason: 'zero_new_candidates',
        roundIndex,
        noveltyGain: 0,
        cumulativeExecutedRoutesCount,
        totalCandidatesCount,
        saturationSemantics: SATURATION_SEMANTICS_DISCLAIMER,
        shouldStop: true,
        nextRoundIndex: null,
      };
    }

    if (noveltyGain < resolvedConfig.saturationNoveltyGainThreshold) {
      return {
        decision: DECISION_SATURATED,
        stopReason: 'marginal_gain_below_threshold',
        roundIndex,
        noveltyGain,
        cumulativeExecutedRoutesCount,
        totalCandidatesCount,
        saturationSemantics: SATURATION_SEMANTICS_DISCLAIMER,
        shouldStop: true,
        nextRoundIndex: null,
      };
    }
  }

  // 5. Default: Continue to next round
  return {
    decision: DECISION_CONTINUE,
    stopReason: null,
    roundIndex,
    noveltyGain,
    cumulativeExecutedRoutesCount,
    totalCandidatesCount,
    saturationSemantics: null,
    shouldStop: false,
    nextRoundIndex: roundIndex + 1,
  };
}

/**
 * Helper to update coverageState with the evaluation of a completed retrieval round.
 */
export function applyRoundEvaluationToCoverageState(coverageState, evaluationResult, {
  executedRoutesThisRound = [],
  providerFailuresThisRound = [],
  fusedCandidateCount = null,
  fusedGroupCount = null,
} = {}) {
  const currentRoutes = coverageState.retrieval.executedRoutes;
  const currentFailures = coverageState.retrieval.providerFailures;

  const combinedRoutes = [...currentRoutes, ...executedRoutesThisRound];
  const combinedFailures = [...currentFailures, ...providerFailuresThisRound];

  return updateRetrievalCoverage(
    coverageState,
    {
      executedRoutes: combinedRoutes,
      providerFailures: combinedFailures,
      fusedCandidateCount: fusedCandidateCount ?? evaluationResult.totalCandidatesCount,
      ...(fusedGroupCount !== null ? { fusedGroupCount } : {}),
      retrievalRounds: evaluationResult.roundIndex,
      stopReason: evaluationResult.stopReason,
      novelty_gain: evaluationResult.noveltyGain,
    },
    { caller: OWNER_RETRIEVAL_CONTROLLER }
  );
}
