// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-attempts.mjs
 *
 * P2A-T07 (#119) — Deterministic targeted attempt counting (SEAM F → SEAM H).
 *
 * Authority (FROZEN; this module must not reinterpret, generalize or "improve" it):
 *   - docs/specs/p2-ari-f02-targeted-requery.md      §5 D4, D6, §11, §13      (APPROVED)
 *   - docs/planning/..._SEAM_CONTRACT_V1.md          F.6, F.6.1, H.1 (H-1…H-5)
 *   - docs/planning/..._SEAM_MAP_V1.md               S11
 *   - docs/architecture/key-decisions.md             D12-4, D12-6
 *
 * Ownership boundary (Ticket Graph V1 §4 — ONE_ACTIVE_WRITER_PER_BRANCH):
 *   T07 OWNS  : the deterministic ledger → counts export, and (in
 *               retrieval-round-controller.mjs) the single additive `targetedAttempts`
 *               input with the two denominator semantics.
 *   T07 DOES NOT OWN: writing executedRoutes (explicitly forbidden), changing
 *               plannedRoutes, any cost/token/money controller, any new round
 *               semantics (targeted is not a P1 round), any
 *               SATURATION_SEMANTICS_DISCLAIMER change, retrieval IO, orchestration.
 *
 * ---------------------------------------------------------------------------
 * FROZEN SEMANTICS AND THE INTERPRETATION DECISIONS TAKEN HERE
 * ---------------------------------------------------------------------------
 *
 * 1. F.6 COUNTING IS THE PROVIDERSCOPE EXPANSION, NOT THE ACTION COUNT.
 *      executed = Σ providerScope.length over actions whose status is in the
 *                 committed set (COMMITTED, EVALUATED, RESOLVED, UNRESOLVED,
 *                 EXHAUSTED_WITHIN_BUDGET) — each such action consumed all of its
 *                 authorized channels.
 *      failed   = Σ providerScope.length over FAILED_OPERATIONAL actions — an
 *                 operational failure is an attempt that consumed its authorized
 *                 channels and produced no evidence conclusion (Spec §14).
 *    PROPOSED / AUTHORIZED / REJECTED contribute ZERO: none of them has performed
 *    IO (E.7: a REJECTED decision is zero-IO by definition).
 *
 * 2. THE EXPORT IS READ-ONLY AND DETERMINISTIC. It takes action records (the T06
 *    actions-artifact shape) and returns plain integers. The caller (controller /
 *    T09) derives these counts and hands them to `evaluateRetrievalRound` as the
 *    additive `targetedAttempts` input — the counts are never invented by the
 *    caller (AC6 / F.6.1).
 *
 * 3. NO MODEL-SUPPLIED SCORE AND NO LEDGER IO HERE. The module reads no files and
 *    reads no materiality / confidence / heat field; it is a pure function of the
 *    action records it is handed.
 */

import {
  ACTION_STATUSES,
  ACTION_STATUS_FAILED_OPERATIONAL,
  COMMITTED_SET,
} from './targeted-requery-lifecycle.mjs';

/** Typed error code for every fail-closed refusal in this module. */
export const ATTEMPT_ERROR_INVALID = 'p2a_targeted_requery_attempts_invalid';

function attemptError(message) {
  const err = new Error(message);
  err.code = ATTEMPT_ERROR_INVALID;
  return err;
}

/**
 * F.6: derive the targeted channel-attempt counts from action records.
 *
 * Returns `{ executed, failed }` — exactly the shape `evaluateRetrievalRound`'s
 * additive `targetedAttempts` input expects. Deterministic, read-only, and free of
 * any model-supplied score.
 */
export function computeTargetedAttemptCounts({ actions = [] } = {}) {
  if (!Array.isArray(actions)) throw attemptError('actions must be an array');
  let executed = 0;
  let failed = 0;
  for (let i = 0; i < actions.length; i += 1) {
    const record = actions[i];
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw attemptError(`actions[${i}] must be a plain action record`);
    }
    if (!ACTION_STATUSES.includes(record.status)) {
      throw attemptError(`actions[${i}].status is outside the closed persisted status set`);
    }
    if (!Array.isArray(record.providerScope)) {
      throw attemptError(`actions[${i}].providerScope must be an array`);
    }
    const channelAttempts = record.providerScope.length;
    if (COMMITTED_SET.includes(record.status)) executed += channelAttempts;
    else if (record.status === ACTION_STATUS_FAILED_OPERATIONAL) failed += channelAttempts;
  }
  return { executed, failed };
}
