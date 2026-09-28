// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-resolution.mjs
 *
 * P2A-T08 (#120) — Gap re-evaluation, resolution predicates and terminal semantics.
 *
 * Authority (FROZEN; this module must not reinterpret, generalize or "improve" it):
 *   - docs/specs/p2-ari-f02-targeted-requery.md      §13, §14, §18, §20-8, §20-9  (APPROVED)
 *   - docs/planning/..._SEAM_CONTRACT_V1.md          G.1–G.5.1, H-6, H-7, H-8
 *   - docs/planning/..._SEAM_MAP_V1.md               S9, S10
 *   - Ticket Decomposition §P2A-T08; Issue #120 GOAL / IN_SCOPE / OUT_OF_SCOPE
 *
 * Ownership boundary (Ticket Graph V1 §4 — ONE_ACTIVE_WRITER_PER_BRANCH):
 *   T08 OWNS  : the re-evaluation module, `newEvidenceIds` (canonical-questionId
 *               novelty), the three resolution predicates (including
 *               NONE_REGISTERED), the closed `resolutionBasis` set, the G.5.1
 *               terminal rule and the H-8 run-stop finalisation.
 *   T08 DOES NOT OWN (and this module deliberately contains NONE of):
 *               any #111 authority predicate (OUT_OF_SCOPE, explicitly forbidden),
 *               热度 / 点赞 / 认证外观 / author 身份字段作为权威性代理（G-A4）；
 *               任何立场判别器、倾向判别器或文本归因设施
 *               （G.4 明令禁止引入），terminal visibility
 *               rendering (T10), orchestration (T09), STOP / attempt accounting
 *               (T07), lifecycle and commit-point semantics (T06 — CONSUMED via
 *               its status constants), retrieval IO.
 *
 * ---------------------------------------------------------------------------
 * FROZEN SEMANTICS AND THE INTERPRETATION DECISIONS TAKEN HERE
 * (recorded explicitly so reviewers can audit the decisions instead of
 * reconstructing intent from the code)
 * ---------------------------------------------------------------------------
 *
 * 1. NEW EVIDENCE IS CANONICAL-QUESTION-ID NOVELTY AND NOTHING ELSE.
 *    G.1: newEvidenceIds = {canonical questionId} ∩ targeted fused candidates
 *    \ (ids already in the accumulated pool before the action). Not a returned
 *    count, not text similarity. The canonical gate is REUSED from the existing P1
 *    seam (`isCanonicalQuestionId`); a non-canonical id fails closed with a typed
 *    throw rather than being silently dropped (dropping would manufacture
 *    "no new evidence" and therefore manufacture an UNRESOLVED gap).
 *
 * 2. ATTRIBUTION COMES FROM PROVENANCE, NEVER FROM CONTENT.
 *    G.4's ASPECT predicate reads "新证据可归因到该 aspect 的 subjectKey". The only
 *    mechanical, already-frozen attribution available is the action's own
 *    authorization-time provenance: the evaluated action was authorized against
 *    that gap (and therefore that subjectKey). This module attributes via the
 *    (gapId, targetedActionId) binding it is handed and never inspects content.
 *    A content attribution step would be the forbidden text-attribution facility.
 *
 * 3. "THE OTHER SIDE" IS A DECLARED FACT, NEVER INFERRED.
 *    G.4: the opposing side comes from the action's authorization-time provenance.
 *    `declaredFraming` and `coveredFramings` are both provenance inputs; when
 *    either is absent the side is UNDECIDABLE and the verdict is UNKNOWN →
 *    UNRESOLVED. Guessing a side from returned content is forbidden.
 *
 * 4. AUTHORITY_GAP HAS NO PREDICATE IN MVP AND SAYS SO.
 *    #111 is not implemented, so resolutionPredicateRef = NONE_REGISTERED and the
 *    default terminal is UNRESOLVED with
 *    resolutionBasis = UNKNOWN_NO_AUTHORITY_PREDICATE — even when new evidence
 *    exists (C8). Registering a real predicate later is #111's authority; this
 *    module's other fields and flow are unchanged by such a registration (§18).
 *
 * 5. RESOLUTION IS NEVER GRANTED BY THE CLOSED "NOT RESOLUTION" LIST (G.3).
 *    Executing a query, a non-zero provider count, all-duplicate returns, a
 *    same-side return, 热度代理, a model's natural-language assertion and an
 *    operational failure are all non-resolution. Only a satisfied predicate
 *    resolves a gap.
 *
 * 6. EXHAUSTED_WITHIN_BUDGET IS A BUDGET FACT, NOT A COVERAGE FACT (G.5, G.5.1).
 *    It is produced only when the gap had at least one authorization AND the stop
 *    cause is a budget-class cause (per-gap bound / authorization-time budget
 *    preflight / run-level BUDGET_STOP). SATURATED, PROVIDER_FAILURE and a
 *    targeted action's FAILED_OPERATIONAL are NEVER written as
 *    EXHAUSTED_WITHIN_BUDGET: that would disguise "marginal gain decayed" or
 *    "the provider broke" as "we ran out of budget".
 *
 * 7. RESOLVED IS STICKY. A gap that has satisfied its predicate keeps RESOLVED even
 *    if a later evaluation of another action for the same gap finds nothing new.
 *    The later outcome is still recorded in the append-only audit, because the
 *    audit records what was EVALUATED while `status` records the gap's TERMINAL
 *    state.
 *
 * 8. H-8 FINALISATION DROPS NOTHING. On a run-level stop every non-terminal gap is
 *    written explicitly as UNRESOLVED or EXHAUSTED_WITHIN_BUDGET with its real
 *    basis and stays visible; a silently vanishing gap is an S10 ILLEGAL_STATE.
 *
 * 9. H-7 / D12-5: NO MODEL-SUPPLIED VERDICT. The public evaluation surface has no
 *    parameter through which a caller (model or otherwise) can assert RESOLVED,
 *    SATURATED, CONTINUE or STOP; unknown input keys are ignored, so an assertion
 *    can never change a verdict. 模型供给的材料性 / 置信度分数在本设计中仅作审计，
 *    本模块完全不读取它们。
 *
 * 10. PERSISTENCE IS A SIBLING ARTIFACT, NOT A CHANGE TO THE T06 ACTIONS ARTIFACT.
 *    The same reasoning T06 applied to T01's ledger applies here: T06 owns its
 *    artifact's file IO / schema / validation, and the ticket graph's "own field
 *    group" rule is about FIELD ownership, not about forcing every later ticket to
 *    edit a predecessor's closed schema (file layout is explicitly not frozen —
 *    Seam Contract §0). The resolution artifact is anchored by the same
 *    (planHash, occurrenceId) pair and is keyed by gapId.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isValidPlanHashFormat } from './plan-contract.mjs';
import { isCanonicalQuestionId } from './source-group-selection.mjs';
import {
  GAP_TYPE_ASPECT,
  GAP_TYPE_AUTHORITY,
  GAP_TYPE_CONTRADICTION,
  GAP_TYPE_UNKNOWN,
} from './targeted-requery-ledger.mjs';
import {
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
} from './targeted-requery-lifecycle.mjs';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Typed error code for every fail-closed refusal in this module. */
export const RESOLUTION_ERROR_INVALID = 'p2a_targeted_requery_resolution_invalid';

// --- G.4 resolution predicates (closed; #111 is deliberately NOT registered) -----

export const RESOLUTION_PREDICATE_ASPECT = 'ASPECT_MIN_NEW_SOURCES_V1';
export const RESOLUTION_PREDICATE_OPPOSING = 'OPPOSING_SIDE_NEW_SOURCES_V1';
/** #111 is unimplemented → AUTHORITY_GAP has no predicate in the MVP. */
export const RESOLUTION_PREDICATE_NONE_REGISTERED = 'NONE_REGISTERED';

export const RESOLUTION_PREDICATES = Object.freeze([
  RESOLUTION_PREDICATE_ASPECT,
  RESOLUTION_PREDICATE_OPPOSING,
  RESOLUTION_PREDICATE_NONE_REGISTERED,
]);

// --- resolutionBasis (closed; no authority proxy is a member) --------------------

export const RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED = 'NEW_EVIDENCE_ATTRIBUTED';
export const RESOLUTION_BASIS_OPPOSING_SIDE_NEW_EVIDENCE = 'OPPOSING_SIDE_NEW_EVIDENCE';
export const RESOLUTION_BASIS_NO_NEW_EVIDENCE = 'NO_NEW_EVIDENCE';
export const RESOLUTION_BASIS_DUPLICATE_ONLY = 'DUPLICATE_ONLY';
export const RESOLUTION_BASIS_SAME_SIDE_ONLY = 'SAME_SIDE_ONLY';
export const RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE = 'UNKNOWN_NO_AUTHORITY_PREDICATE';
export const RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED = 'UNKNOWN_SIDE_NOT_DECLARED';
export const RESOLUTION_BASIS_GAP_TYPE_NOT_ACTIONABLE = 'GAP_TYPE_NOT_ACTIONABLE';
export const RESOLUTION_BASIS_NEVER_AUTHORIZED = 'NEVER_AUTHORIZED';
export const RESOLUTION_BASIS_RUN_SATURATED = 'RUN_SATURATED';
export const RESOLUTION_BASIS_PROVIDER_FAILURE = 'PROVIDER_FAILURE';
export const RESOLUTION_BASIS_OPERATIONAL_FAILURE = 'OPERATIONAL_FAILURE';
export const RESOLUTION_BASIS_PER_GAP_BOUND_EXHAUSTED = 'PER_GAP_BOUND_EXHAUSTED';
export const RESOLUTION_BASIS_BUDGET_PREFLIGHT_REJECTED = 'BUDGET_PREFLIGHT_REJECTED';
export const RESOLUTION_BASIS_RUN_BUDGET_STOP = 'RUN_BUDGET_STOP';

export const RESOLUTION_BASES = Object.freeze([
  RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
  RESOLUTION_BASIS_OPPOSING_SIDE_NEW_EVIDENCE,
  RESOLUTION_BASIS_NO_NEW_EVIDENCE,
  RESOLUTION_BASIS_DUPLICATE_ONLY,
  RESOLUTION_BASIS_SAME_SIDE_ONLY,
  RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
  RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED,
  RESOLUTION_BASIS_GAP_TYPE_NOT_ACTIONABLE,
  RESOLUTION_BASIS_NEVER_AUTHORIZED,
  RESOLUTION_BASIS_RUN_SATURATED,
  RESOLUTION_BASIS_PROVIDER_FAILURE,
  RESOLUTION_BASIS_OPERATIONAL_FAILURE,
  RESOLUTION_BASIS_PER_GAP_BOUND_EXHAUSTED,
  RESOLUTION_BASIS_BUDGET_PREFLIGHT_REJECTED,
  RESOLUTION_BASIS_RUN_BUDGET_STOP,
]);

// --- termination reasons (closed) ------------------------------------------------

export const TERMINATION_NONE = 'NONE';
export const TERMINATION_PER_GAP_BOUND_EXHAUSTED = 'PER_GAP_BOUND_EXHAUSTED';
export const TERMINATION_BUDGET_PREFLIGHT_REJECTED = 'BUDGET_PREFLIGHT_REJECTED';
export const TERMINATION_RUN_BUDGET_STOP = 'RUN_BUDGET_STOP';
export const TERMINATION_RUN_SATURATED = 'RUN_SATURATED';
export const TERMINATION_RUN_PROVIDER_FAILURE = 'RUN_PROVIDER_FAILURE';
export const TERMINATION_ACTION_OPERATIONAL_FAILURE = 'ACTION_OPERATIONAL_FAILURE';
export const TERMINATION_NEVER_AUTHORIZED = 'NEVER_AUTHORIZED';

export const TERMINATION_REASONS = Object.freeze([
  TERMINATION_NONE,
  TERMINATION_PER_GAP_BOUND_EXHAUSTED,
  TERMINATION_BUDGET_PREFLIGHT_REJECTED,
  TERMINATION_RUN_BUDGET_STOP,
  TERMINATION_RUN_SATURATED,
  TERMINATION_RUN_PROVIDER_FAILURE,
  TERMINATION_ACTION_OPERATIONAL_FAILURE,
  TERMINATION_NEVER_AUTHORIZED,
]);

/**
 * G.5.1: the ONLY termination reasons that may produce EXHAUSTED_WITHIN_BUDGET — and
 * only when the gap had at least one authorization. SATURATED / PROVIDER_FAILURE /
 * OPERATIONAL_FAILURE are deliberately absent.
 */
const BUDGET_CLASS_TERMINATIONS = Object.freeze([
  TERMINATION_PER_GAP_BOUND_EXHAUSTED,
  TERMINATION_BUDGET_PREFLIGHT_REJECTED,
  TERMINATION_RUN_BUDGET_STOP,
]);

const TERMINATION_TO_BASIS = Object.freeze({
  [TERMINATION_PER_GAP_BOUND_EXHAUSTED]: RESOLUTION_BASIS_PER_GAP_BOUND_EXHAUSTED,
  [TERMINATION_BUDGET_PREFLIGHT_REJECTED]: RESOLUTION_BASIS_BUDGET_PREFLIGHT_REJECTED,
  [TERMINATION_RUN_BUDGET_STOP]: RESOLUTION_BASIS_RUN_BUDGET_STOP,
  [TERMINATION_RUN_SATURATED]: RESOLUTION_BASIS_RUN_SATURATED,
  [TERMINATION_RUN_PROVIDER_FAILURE]: RESOLUTION_BASIS_PROVIDER_FAILURE,
  [TERMINATION_ACTION_OPERATIONAL_FAILURE]: RESOLUTION_BASIS_OPERATIONAL_FAILURE,
  [TERMINATION_NEVER_AUTHORIZED]: RESOLUTION_BASIS_NEVER_AUTHORIZED,
});

// --- persistence -----------------------------------------------------------------

export const RESOLUTION_SCHEMA = 'p2-ari-targeted-requery-resolution/v1';
export const RESOLUTION_FILENAME = 'targeted-requery-resolution.json';

export const RESOLUTION_TOP_LEVEL_KEYS = Object.freeze([
  'occurrenceId', 'planHash', 'resolutions', 'schema',
]);

export const RESOLUTION_RECORD_KEYS = Object.freeze([
  'audit',
  'evaluatedActionIds',
  'gapId',
  'gapIdentityCore',
  'occurrenceId',
  'planHash',
  'resolutionBasis',
  'resolutionEvidence',
  'resolutionPredicateRef',
  'status',
]);

export const RESOLUTION_AUDIT_ENTRY_KEYS = Object.freeze([
  'basis', 'event', 'predicateRef', 'seq', 'status', 'targetedActionId',
]);

const GAP_TERMINALS = Object.freeze([
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
]);

const GAP_ID_SHAPE = /^[0-9a-f]{64}:\d+$/;
const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// module-private helpers (no shared module is created; see the sibling modules)
// ---------------------------------------------------------------------------

function resolutionError(message) {
  const err = new Error(message);
  err.code = RESOLUTION_ERROR_INVALID;
  return err;
}

/** Byte-deterministic canonical JSON (sorted keys; arrays keep their order). */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  if (actual.length !== expectedKeys.length) return false;
  return actual.every((key, index) => key === expectedKeys[index]);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate a list of canonical question ids. FAIL-CLOSED, and deliberately does NOT
 * interpolate the offending value into the message: an id-shaped caller string could
 * be a machine-private path, and RULES.md §11 forbids leaking those into messages,
 * logs or artifacts.
 */
function requireCanonicalIdList(value, label) {
  if (!Array.isArray(value)) throw resolutionError(`${label} must be an array`);
  for (let i = 0; i < value.length; i += 1) {
    if (!isCanonicalQuestionId(value[i])) {
      throw resolutionError(`${label}[${i}] is not a canonical questionId`);
    }
  }
  return value;
}

/**
 * The closed set of (status, resolutionPredicateRef, resolutionBasis) triples.
 *
 * This is the mechanical answer to "a caller must not be able to persist a verdict
 * the predicates never produced": a status may only be written together with a
 * predicate reference and a basis that the frozen predicates can actually emit. In
 * particular RESOLVED can never be paired with NONE_REGISTERED (no predicate ⇒ no
 * resolution) and can never carry an UNKNOWN / failure basis.
 */
const RESOLVED_BASES = Object.freeze([
  RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
  RESOLUTION_BASIS_OPPOSING_SIDE_NEW_EVIDENCE,
]);
const UNRESOLVED_PREDICATE_BASES = Object.freeze({
  [RESOLUTION_PREDICATE_ASPECT]: Object.freeze([RESOLUTION_BASIS_NO_NEW_EVIDENCE, RESOLUTION_BASIS_DUPLICATE_ONLY]),
  [RESOLUTION_PREDICATE_OPPOSING]: Object.freeze([
    RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    RESOLUTION_BASIS_DUPLICATE_ONLY,
    RESOLUTION_BASIS_SAME_SIDE_ONLY,
    RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED,
  ]),
  [RESOLUTION_PREDICATE_NONE_REGISTERED]: Object.freeze([
    RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
    RESOLUTION_BASIS_GAP_TYPE_NOT_ACTIONABLE,
  ]),
});
const EXHAUSTED_BASES = Object.freeze([
  RESOLUTION_BASIS_PER_GAP_BOUND_EXHAUSTED,
  RESOLUTION_BASIS_BUDGET_PREFLIGHT_REJECTED,
  RESOLUTION_BASIS_RUN_BUDGET_STOP,
]);
const STOP_BASES = Object.freeze([
  RESOLUTION_BASIS_NEVER_AUTHORIZED,
  RESOLUTION_BASIS_RUN_SATURATED,
  RESOLUTION_BASIS_PROVIDER_FAILURE,
  RESOLUTION_BASIS_OPERATIONAL_FAILURE,
]);

export function isAllowedTerminalTriple(status, resolutionPredicateRef, resolutionBasis) {
  if (status === ACTION_STATUS_RESOLVED) {
    return RESOLVED_BASES.includes(resolutionBasis)
      && resolutionPredicateRef !== RESOLUTION_PREDICATE_NONE_REGISTERED
      && resolutionPredicateRef !== null;
  }
  if (status === ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET) return EXHAUSTED_BASES.includes(resolutionBasis);
  if (status === ACTION_STATUS_UNRESOLVED) {
    if (STOP_BASES.includes(resolutionBasis)) return true;
    const allowed = UNRESOLVED_PREDICATE_BASES[resolutionPredicateRef];
    return Array.isArray(allowed) && allowed.includes(resolutionBasis);
  }
  return false;
}

/** Sorted, de-duplicated list of canonical question ids (byte-deterministic). */
function canonicalIdSet(ids) {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function byGapId(a, b) {
  return a.gapId < b.gapId ? -1 : a.gapId > b.gapId ? 1 : 0;
}

// ---------------------------------------------------------------------------
// G.1 / G.2 — new evidence
// ---------------------------------------------------------------------------

/**
 * G.1/G.2: newEvidenceIds = {canonical questionId} ∩ targeted fused candidates
 * \ (questionIds already in the accumulated pool before this action).
 *
 * The judgment is canonical-questionId IDENTITY: not a returned count, not text
 * similarity. Ids repeated inside one action collapse to one (G.2). A non-canonical
 * id fails closed with a typed error — silently dropping it would fabricate
 * "no new evidence" and therefore fabricate an UNRESOLVED gap.
 */
export function computeNewEvidenceIds({ priorQuestionIds = [], targetedQuestionIds = [] } = {}) {
  requireCanonicalIdList(priorQuestionIds, 'priorQuestionIds');
  requireCanonicalIdList(targetedQuestionIds, 'targetedQuestionIds');
  const prior = new Set(priorQuestionIds);
  return { newEvidenceIds: canonicalIdSet(targetedQuestionIds.filter((id) => !prior.has(id))) };
}

// ---------------------------------------------------------------------------
// G.4 — resolution predicates
// ---------------------------------------------------------------------------

/**
 * Evaluate one gap against its registered predicate.
 *
 * Returns the total shape { status, resolutionPredicateRef, resolutionBasis,
 * newEvidenceIds }; `status` is RESOLVED or UNRESOLVED only —
 * EXHAUSTED_WITHIN_BUDGET is a budget fact and is produced by
 * `classifyGapTerminal` (G.5.1), never here.
 *
 * Unknown input keys are ignored, so a caller (a model included) cannot assert an
 * outcome (H-7). `targetedCandidateCount` exists only to distinguish "nothing came
 * back" from "things came back but all were already in the pool" (G.2 / C6); it
 * never contributes to a RESOLVED verdict.
 */
export function evaluateResolution({
  gapType,
  priorQuestionIds = [],
  targetedQuestionIds = [],
  declaredFraming = null,
  coveredFramings = null,
} = {}) {
  // G.1/G.2: novelty is computed HERE from the two id sets, so the "all returns were
  // duplicates" judgment is a mechanical fact about ids — never a caller-supplied
  // count that could be inflated to manufacture DUPLICATE_ONLY or hide it.
  const { newEvidenceIds } = computeNewEvidenceIds({ priorQuestionIds, targetedQuestionIds });
  const ids = newEvidenceIds;
  const targetedCount = canonicalIdSet(targetedQuestionIds).length;

  // G.5 / E.1: UNKNOWN_GAP_TYPE is recordable but never actionable.
  if (gapType === GAP_TYPE_UNKNOWN) {
    return {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED,
      resolutionBasis: RESOLUTION_BASIS_GAP_TYPE_NOT_ACTIONABLE,
      newEvidenceIds: ids,
    };
  }

  // G.4 AUTHORITY_GAP: no predicate is registered in the MVP (#111 unimplemented),
  // so the honest terminal is UNRESOLVED even when new evidence exists (C8).
  if (gapType === GAP_TYPE_AUTHORITY) {
    return {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED,
      resolutionBasis: RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
      newEvidenceIds: ids,
    };
  }

  if (gapType !== GAP_TYPE_ASPECT && gapType !== GAP_TYPE_CONTRADICTION) {
    throw resolutionError('gapType is not an actionable closed-enum member');
  }

  // G.1: zero new evidence is never resolution, whatever came back.
  if (ids.length === 0) {
    return {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: gapType === GAP_TYPE_ASPECT
        ? RESOLUTION_PREDICATE_ASPECT
        : RESOLUTION_PREDICATE_OPPOSING,
      resolutionBasis: targetedCount > 0
        ? RESOLUTION_BASIS_DUPLICATE_ONLY
        : RESOLUTION_BASIS_NO_NEW_EVIDENCE,
      newEvidenceIds: ids,
    };
  }

  if (gapType === GAP_TYPE_ASPECT) {
    // Attribution is the action's provenance binding (design decision 2), never content.
    return {
      status: ACTION_STATUS_RESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
      newEvidenceIds: ids,
    };
  }

  // CONTRADICTION_GAP: the side is a DECLARED provenance fact, never inferred.
  if (declaredFraming === null || declaredFraming === undefined
      || coveredFramings === null || coveredFramings === undefined) {
    return {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_OPPOSING,
      resolutionBasis: RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED,
      newEvidenceIds: ids,
    };
  }
  if (!Array.isArray(coveredFramings) || coveredFramings.length === 0) {
    // No provenance of an already-covered side ⇒ opposition cannot be demonstrated.
    // Fail closed (G.4: 无法机械判定侧别时一律 UNKNOWN → UNRESOLVED，不得猜测).
    return {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_OPPOSING,
      resolutionBasis: RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED,
      newEvidenceIds: ids,
    };
  }
  if (coveredFramings.includes(declaredFraming)) {
    return {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_OPPOSING,
      resolutionBasis: RESOLUTION_BASIS_SAME_SIDE_ONLY,
      newEvidenceIds: ids,
    };
  }
  return {
    status: ACTION_STATUS_RESOLVED,
    resolutionPredicateRef: RESOLUTION_PREDICATE_OPPOSING,
    resolutionBasis: RESOLUTION_BASIS_OPPOSING_SIDE_NEW_EVIDENCE,
    newEvidenceIds: ids,
  };
}

// ---------------------------------------------------------------------------
// G.5.1 — terminal classification
// ---------------------------------------------------------------------------

/**
 * G.5.1: turn a predicate outcome plus a termination reason into a gap terminal.
 *
 *   · predicate satisfied                      → RESOLVED (never downgraded)
 *   · budget-class cause AND ≥1 authorization  → EXHAUSTED_WITHIN_BUDGET
 *   · SATURATED / PROVIDER_FAILURE / FAILED_OPERATIONAL / never authorized
 *                                              → UNRESOLVED with the real basis
 *
 * The prohibition is absolute: SATURATED and PROVIDER_FAILURE (and an action's
 * operational failure) are NEVER written as EXHAUSTED_WITHIN_BUDGET — that would
 * disguise "marginal gain decayed" or "the provider broke" as a budget fact.
 */
export function classifyGapTerminal({ predicateResult, terminationReason, everAuthorized = false } = {}) {
  if (!isPlainObject(predicateResult)) throw resolutionError('predicateResult must be a plain object');
  if (!TERMINATION_REASONS.includes(terminationReason)) {
    throw resolutionError('terminationReason is outside the closed TERMINATION_REASONS set');
  }
  if (typeof everAuthorized !== 'boolean') throw resolutionError('everAuthorized must be a boolean');
  const { resolutionPredicateRef, resolutionBasis } = predicateResult;

  if (predicateResult.status === ACTION_STATUS_RESOLVED) {
    return { status: ACTION_STATUS_RESOLVED, resolutionPredicateRef, resolutionBasis };
  }

  if (!everAuthorized) {
    return {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef,
      resolutionBasis: RESOLUTION_BASIS_NEVER_AUTHORIZED,
    };
  }

  if (BUDGET_CLASS_TERMINATIONS.includes(terminationReason)) {
    return {
      status: ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
      resolutionPredicateRef,
      resolutionBasis: TERMINATION_TO_BASIS[terminationReason],
    };
  }

  return {
    status: ACTION_STATUS_UNRESOLVED,
    resolutionPredicateRef,
    resolutionBasis: TERMINATION_TO_BASIS[terminationReason] ?? resolutionBasis,
  };
}

// ---------------------------------------------------------------------------
// H-8 — run-level STOP finalisation
// ---------------------------------------------------------------------------

/**
 * H-8: on a run-level stop, finalise EVERY non-terminal gap explicitly.
 *
 * Nothing is dropped and nothing is silently left in a non-terminal state (S10
 * ILLEGAL_STATES). Gaps that already carry a terminal keep it — a RESOLVED gap is
 * never rewritten by a later stop. Output is in deterministic ascending `gapId`
 * order so the persisted view is byte-deterministic.
 */
export function finalizeGapsOnRunStop({ gaps = [], runStopReason } = {}) {
  if (!Array.isArray(gaps)) throw resolutionError('gaps must be an array');
  if (!TERMINATION_REASONS.includes(runStopReason)) {
    throw resolutionError('runStopReason is outside the closed TERMINATION_REASONS set');
  }
  const finalised = gaps.map((gap) => {
    if (!isPlainObject(gap) || !isNonEmptyString(gap.gapId)) {
      throw resolutionError('each gap must be a plain object with a gapId');
    }
    if (GAP_TERMINALS.includes(gap.status)) {
      return { gapId: gap.gapId, status: gap.status, resolutionBasis: gap.resolutionBasis ?? null };
    }
    const verdict = classifyGapTerminal({
      predicateResult: {
        status: ACTION_STATUS_UNRESOLVED,
        resolutionPredicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED,
        resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
      },
      terminationReason: runStopReason,
      everAuthorized: gap.everAuthorized === true,
    });
    return { gapId: gap.gapId, status: verdict.status, resolutionBasis: verdict.resolutionBasis };
  });
  return { gaps: finalised.sort((a, b) => (a.gapId < b.gapId ? -1 : a.gapId > b.gapId ? 1 : 0)) };
}

// ---------------------------------------------------------------------------
// persistence (work-dir relative, byte-deterministic)
// ---------------------------------------------------------------------------

export function createResolutionArtifact({ planHash, occurrenceId } = {}) {
  if (!isValidPlanHashFormat(planHash)) throw resolutionError('planHash must be a 64-hex plan contract hash');
  if (!isNonEmptyString(occurrenceId)) throw resolutionError('occurrenceId must be a non-empty string');
  return { occurrenceId, planHash, resolutions: [], schema: RESOLUTION_SCHEMA };
}

export function resolutionFile(workDir) {
  return path.join(workDir, RESOLUTION_FILENAME);
}

function canonicalAuditEntry(entry) {
  return {
    basis: entry.basis ?? null,
    event: entry.event,
    predicateRef: entry.predicateRef ?? null,
    seq: entry.seq,
    status: entry.status,
    targetedActionId: entry.targetedActionId ?? null,
  };
}

function canonicalRecord(record) {
  return {
    audit: record.audit.map(canonicalAuditEntry),
    evaluatedActionIds: [...record.evaluatedActionIds],
    gapId: record.gapId,
    gapIdentityCore: record.gapIdentityCore,
    resolutionEvidence: [...record.resolutionEvidence],
    occurrenceId: record.occurrenceId,
    planHash: record.planHash,
    resolutionBasis: record.resolutionBasis ?? null,
    resolutionPredicateRef: record.resolutionPredicateRef ?? null,
    status: record.status,
  };
}

function canonicalResolutionArtifact(artifact) {
  return {
    occurrenceId: artifact.occurrenceId,
    planHash: artifact.planHash,
    resolutions: [...artifact.resolutions].map(canonicalRecord).sort(byGapId),
    schema: artifact.schema,
  };
}

function validateAuditEntry(entry, expectedSeq) {
  if (!hasExactKeys(entry, RESOLUTION_AUDIT_ENTRY_KEYS)) return 'audit entry has an unexpected key set';
  if (!Number.isInteger(entry.seq) || entry.seq !== expectedSeq) return 'audit entry seq is not monotonic';
  if (!isNonEmptyString(entry.event)) return 'audit entry event is malformed';
  if (!GAP_TERMINALS.includes(entry.status)) return 'audit entry status is outside the closed terminal set';
  if (entry.basis !== null && !RESOLUTION_BASES.includes(entry.basis)) return 'audit entry basis is outside the closed set';
  if (entry.predicateRef !== null && !RESOLUTION_PREDICATES.includes(entry.predicateRef)) {
    return 'audit entry predicateRef is outside the closed set';
  }
  if (entry.targetedActionId !== null && !HEX64.test(entry.targetedActionId)) {
    return 'audit entry targetedActionId is malformed';
  }
  return null;
}

function validateResolutionRecord(record, artifact) {
  if (!hasExactKeys(record, RESOLUTION_RECORD_KEYS)) return 'resolution record has an unexpected key set';
  if (typeof record.gapId !== 'string' || !GAP_ID_SHAPE.test(record.gapId)) return 'resolution record gapId is malformed';
  if (typeof record.gapIdentityCore !== 'string' || !HEX64.test(record.gapIdentityCore)) {
    return 'resolution record gapIdentityCore is malformed';
  }
  if (!record.gapId.startsWith(`${record.gapIdentityCore}:`)) return 'resolution record gapId does not derive from its core';
  if (record.planHash !== artifact.planHash) return 'resolution record planHash does not match the artifact anchor';
  if (record.occurrenceId !== artifact.occurrenceId) return 'resolution record occurrenceId does not match the artifact anchor';
  if (!GAP_TERMINALS.includes(record.status)) return 'resolution record status is outside the closed terminal set';
  if (record.resolutionPredicateRef !== null && !RESOLUTION_PREDICATES.includes(record.resolutionPredicateRef)) {
    return 'resolution record resolutionPredicateRef is outside the closed set';
  }
  if (record.resolutionBasis !== null && !RESOLUTION_BASES.includes(record.resolutionBasis)) {
    return 'resolution record resolutionBasis is outside the closed set';
  }
  try {
    requireCanonicalIdList(record.resolutionEvidence, 'resolutionEvidence');
  } catch (err) {
    return err.message;
  }
  const orderedEvidence = [...record.resolutionEvidence].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < orderedEvidence.length; i += 1) {
    if (orderedEvidence[i] !== record.resolutionEvidence[i]) {
      return 'resolutionEvidence is not in canonical questionId order';
    }
  }
  if (!isAllowedTerminalTriple(record.status, record.resolutionPredicateRef, record.resolutionBasis)) {
    return 'terminal triple (status, resolutionPredicateRef, resolutionBasis) is not producible by the frozen predicates';
  }
  if (!Array.isArray(record.evaluatedActionIds)) return 'evaluatedActionIds must be an array';
  for (const id of record.evaluatedActionIds) {
    if (!HEX64.test(id)) return 'evaluatedActionIds contains a malformed action id';
  }
  if (!Array.isArray(record.audit) || record.audit.length === 0) return 'resolution record audit must be a non-empty array';
  for (let i = 0; i < record.audit.length; i += 1) {
    const reason = validateAuditEntry(record.audit[i], i + 1);
    if (reason !== null) return reason;
  }
  return null;
}

/** Fail-closed schema validation: `{ ok: true, validated }` or `{ ok: false, reason }`. */
export function validateResolutionArtifact(artifact) {
  if (!isPlainObject(artifact)) return { ok: false, reason: 'resolution artifact must be a plain object' };
  if (!hasExactKeys(artifact, RESOLUTION_TOP_LEVEL_KEYS)) return { ok: false, reason: 'resolution artifact has an unexpected key set' };
  if (artifact.schema !== RESOLUTION_SCHEMA) return { ok: false, reason: 'resolution artifact schema id is not recognised' };
  if (!isValidPlanHashFormat(artifact.planHash)) return { ok: false, reason: 'resolution artifact planHash is malformed' };
  if (!isNonEmptyString(artifact.occurrenceId)) return { ok: false, reason: 'resolution artifact occurrenceId is malformed' };
  if (!Array.isArray(artifact.resolutions)) return { ok: false, reason: 'resolutions must be an array' };

  const seen = new Set();
  for (const record of artifact.resolutions) {
    const reason = validateResolutionRecord(record, artifact);
    if (reason !== null) return { ok: false, reason };
    if (seen.has(record.gapId)) return { ok: false, reason: `duplicate gapId: ${record.gapId}` };
    seen.add(record.gapId);
  }
  const canonical = canonicalResolutionArtifact(artifact);
  for (let i = 0; i < canonical.resolutions.length; i += 1) {
    if (canonicalJson(canonical.resolutions[i]) !== canonicalJson(artifact.resolutions[i])) {
      return { ok: false, reason: 'resolutions are not in canonical gapId order' };
    }
  }
  return { ok: true, validated: canonical };
}

function serializeResolutionArtifact(artifact) {
  return `${JSON.stringify(canonicalResolutionArtifact(artifact), null, 2)}\n`;
}

export function persistResolutionArtifact(workDir, artifact) {
  const verdict = validateResolutionArtifact(artifact);
  if (!verdict.ok) throw resolutionError(`refusing to persist an invalid resolution artifact: ${verdict.reason}`);
  const payload = serializeResolutionArtifact(verdict.validated);
  const target = resolutionFile(workDir);
  try {
    fs.mkdirSync(workDir, { recursive: true });
    const temp = `${target}.tmp-${process.pid}`;
    const fd = fs.openSync(temp, 'w');
    try {
      fs.writeFileSync(fd, payload, 'utf8');
      try {
        fs.fsyncSync(fd);
      } catch (e) {
        if (e.code !== 'EINVAL' && e.code !== 'EPERM' && e.code !== 'EROFS') throw e;
      }
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, target);
  } catch {
    throw resolutionError('failed to persist the targeted-requery resolution artifact');
  }
  return { ok: true, path: RESOLUTION_FILENAME };
}

/** FILE EXISTS != VALID CACHE: a stale / unparseable / invalid artifact fails closed. */
export function loadResolutionArtifact(workDir, expectedPlanHash = null) {
  const target = resolutionFile(workDir);
  if (!fs.existsSync(target)) return { ok: false, reason: 'file_not_found', path: RESOLUTION_FILENAME };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return { ok: false, reason: 'unparseable', path: RESOLUTION_FILENAME };
  }
  const verdict = validateResolutionArtifact(parsed);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, path: RESOLUTION_FILENAME };
  if (expectedPlanHash !== null && verdict.validated.planHash !== expectedPlanHash) {
    return { ok: false, reason: 'stale_plan_hash', path: RESOLUTION_FILENAME };
  }
  return { ok: true, artifact: verdict.validated, path: RESOLUTION_FILENAME };
}

/**
 * Record one evaluation for a gap. Append-only: the audit history and the
 * `evaluatedActionIds` list only ever grow, and a RESOLVED gap is never downgraded
 * by a later, weaker evaluation (design decision 7).
 */
export function recordResolution(artifact, input = {}) {
  const verdict = validateResolutionArtifact(artifact);
  if (!verdict.ok) throw resolutionError(`refusing to record onto an invalid resolution artifact: ${verdict.reason}`);
  if (!isPlainObject(input)) throw resolutionError('resolution input must be a plain object');
  const validated = verdict.validated;
  const {
    gapId,
    gapIdentityCore,
    targetedActionId = null,
    status,
    resolutionPredicateRef,
    resolutionBasis,
    newEvidenceIds = [],
    planHash = null,
    occurrenceId = null,
  } = input;
  if (targetedActionId !== null && (typeof targetedActionId !== 'string' || !HEX64.test(targetedActionId))) {
    throw resolutionError('targetedActionId must be 64 lowercase hex characters (or null for a finalisation record)');
  }
  if (!GAP_TERMINALS.includes(status)) throw resolutionError('status must be a gap terminal');
  // The anchor comes from the artifact; caller-supplied copies must AGREE, never override.
  if (planHash !== null && planHash !== validated.planHash) {
    throw resolutionError('planHash does not match the artifact anchor');
  }
  if (occurrenceId !== null && occurrenceId !== validated.occurrenceId) {
    throw resolutionError('occurrenceId does not match the artifact anchor');
  }
  // The persisted verdict must be one the frozen predicates can actually produce:
  // a caller cannot bypass the predicates by handing in a bare RESOLVED.
  if (!isAllowedTerminalTriple(status, resolutionPredicateRef ?? null, resolutionBasis ?? null)) {
    throw resolutionError('terminal triple (status, resolutionPredicateRef, resolutionBasis) is not producible by the frozen predicates');
  }

  const existingIndex = validated.resolutions.findIndex((r) => r.gapId === gapId);
  const prior = existingIndex === -1 ? null : validated.resolutions[existingIndex];
  const sticky = prior !== null && prior.status === ACTION_STATUS_RESOLVED;
  const resultingStatus = sticky ? ACTION_STATUS_RESOLVED : status;

  const entry = {
    basis: resolutionBasis ?? null,
    event: 'EVALUATE',
    predicateRef: resolutionPredicateRef ?? null,
    seq: (prior?.audit.length ?? 0) + 1,
    status,
    targetedActionId: targetedActionId ?? null,
  };

  const record = {
    audit: [...(prior?.audit ?? []), entry],
    evaluatedActionIds: targetedActionId === null
      ? [...(prior?.evaluatedActionIds ?? [])]
      : [...(prior?.evaluatedActionIds ?? []), targetedActionId],
    gapId,
    gapIdentityCore,
    // Evidence ACCUMULATES across evaluations for the gap, so a later, weaker
    // evaluation can never erase what an earlier one attributed (design decision 7).
    resolutionEvidence: canonicalIdSet([...(prior?.resolutionEvidence ?? []), ...newEvidenceIds]),
    occurrenceId: validated.occurrenceId,
    planHash: validated.planHash,
    resolutionBasis: sticky ? prior.resolutionBasis : (resolutionBasis ?? null),
    resolutionPredicateRef: sticky ? prior.resolutionPredicateRef : (resolutionPredicateRef ?? null),
    status: resultingStatus,
  };

  const resolutions = prior === null
    ? [...validated.resolutions, record]
    : validated.resolutions.map((r, i) => (i === existingIndex ? record : r));
  const next = validateResolutionArtifact({ ...validated, resolutions: resolutions.sort(byGapId) });
  if (!next.ok) throw resolutionError(`refusing an invalid resolution record: ${next.reason}`);
  return next.validated;
}
