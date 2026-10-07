// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-subphase.mjs
 *
 * P2A-T09 (#121) — targeted sub-phase orchestration (SEAM S5 / S8 placement,
 * D12-7's "two contact surfaces" closure, the anti-second-pipeline checkpoint).
 *
 * This module assembles the frozen T02–T08 components into ONE sub-phase that
 * runs INSIDE STAGE_SEARCH and strictly BEFORE T08 source-group selection:
 *
 *   accumulated pool (from the frozen retrieval feedback loop)
 *     → T03 diagnose gaps            (provenance-coverage only)
 *     → gapId ascending selection    (T01's frozen E.8 order)
 *     → T04 gate + T05 authorization (dual-lens admission, bounded authority)
 *     → T06 replay decision / commit point (checkpoint-first)
 *     → T02 execution                (runMultiQueryRetrieval(targetedQueries))
 *     → T08 re-evaluation            → terminal record
 *     → T07 counting                 (computeTargetedAttemptCounts)
 *     → augmented accumulated pool   (T09 is the single writer of this walk)
 *     → (zero change) source-group selection and every downstream stage
 *
 * ---------------------------------------------------------------------------
 * DESIGN DECISIONS (frozen by this ticket; each is mechanically test-pinned)
 * ---------------------------------------------------------------------------
 * 1. POSITION IS THE CONTRACT. The sub-phase is a pure function invoked by the
 *    composition owner (p1-runtime-composer) in exactly one place: after the
 *    retrieval feedback loop has produced the accumulated pool, and before
 *    the T08 source-group selection call runs. It journals NO new stage (the
 *    convergence
 *    journal's single-pass acyclic order is untouched — no new stage is legal).
 *    A mechanical source assertion pins the call site order.
 *
 * 2. DISABLED BY DEFAULT ⇒ BYTE-IDENTICAL COMPOSITION PATH. The composer only
 *    invokes this function when an opt-in `targetedSubphase` config is supplied.
 *    Absent it, no line of the historical path executes differently.
 *
 * 3. NO SECOND RETRIEVAL PIPELINE. The ONLY execution route is
 *    `runMultiQueryRetrieval({..., targetedQueries})` — the T02 additive seam. This
 *    module never combines `seam.retrieve` + `rrfFusion` + pool merge itself, never
 *    builds channels, never re-derives canonical identity, and never adds a
 *    provider / capability / ordering rule.
 *
 * 4. CHECKPOINT-FIRST AT THE INTEGRATION LAYER (AC5). The commit point is exactly
 *    T06's: round artifact bytes written+fsynced → the hash bound into
 *    `state.hashes['targeted-action:<id>']` → the action advanced to COMMITTED and
 *    persisted → `writeState`. A crash before the checkpoint leaves "no completion
 *    evidence" (one safe re-run), never a false reuse.
 *
 * 5. DETERMINISTIC ORDER. Gaps are processed in `gapId` ascending order (T01's
 *    frozen E.8 canonical order); two identical inputs produce identical artifacts.
 *
 * 6. FAIL-CLOSED, NO FABRICATED EVIDENCE. Malformed input throws a typed error and
 *    performs no IO. A gap with no admissible proposal is NOT re-run (E.7: no
 *    silent fallback to the parent plan). A CONTRADICTION gap whose side cannot be
 *    mechanically declared is UNRESOLVED, never a guess (T08 G.4).
 *
 * 7. THE AUGMENTED POOL KEEPS THE FROZEN CONTRACT. Targeted candidates enter the
 *    SAME accumulated pool with the SAME RRF/canonical-questionId dedup (best
 *    rrfScore wins), re-walked by `assertArtifactSafe` and re-persisted to the same
 *    `retrieval-rounds/accumulated-pool.json` before any downstream consumer reads it.
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { isValidPlanHashFormat } from './plan-contract.mjs';
import { appendEvent, validateArtifactCheckpoint, writeState } from './state.mjs';
import {
  RETRIEVAL_POOL_FILENAME,
  RETRIEVAL_POOL_SCHEMA_VERSION,
  RETRIEVAL_POOL_TYPE,
  runMultiQueryRetrieval,
} from './retrieval.mjs';
import { assertArtifactSafe } from './rrf.mjs';
import {
  ACCUMULATED_POOL_FILENAME,
  RETRIEVAL_ROUNDS_DIRNAME,
} from './coverage-final-integration.mjs';
import {
  gapTypeAllowsRetrievalAction,
  normalizeGapType,
  makeGapId,
  appendGapRecord,
  normalizeSubjectString,
  opposingFramingSubjectKey,
  persistLedger,
  sortGapsByGapId,
} from './targeted-requery-ledger.mjs';
import { diagnoseGaps } from './targeted-requery-diagnosis.mjs';
import {
  AUTHORIZATION_STATUS_AUTHORIZED,
  authorizeTargetedAction,
  REJECTION_ATTEMPT_BOUND_EXCEEDED,
  REJECTION_BUDGET_EXCEEDED,
} from './targeted-requery-authorization.mjs';
import {
  ACTION_STATUS_AUTHORIZED,
  ACTION_STATUS_EVALUATED,
  ACTION_STATUS_FAILED_OPERATIONAL,
  ACTIONS_FILENAME,
  actionsArtifactBytes,
  advanceActionStatus,
  anchorLedgerVersion,
  createActionsArtifact,
  decideTargetedReplay,
  FINAL_EVIDENCE_STATUSES,
  LEDGER_CHECKPOINT_KEY,
  LEDGER_STAGING_KEY,
  // `loadActionsArtifact` is deliberately NOT imported. It is the one loader in this
  // module's dependency set that reads the CANONICAL ledger file without consulting
  // the checkpoint, so keeping it available here would make the revoked P0 a
  // one-token regression away.
  persistActionsArtifact,
  prepareTargetedCommit,
  finalizeTargetedCommit,
  readAnchoredLedger,
  recordRejectedDecision,
  registerAuthorizedAction,
  RESUME_REUSE,
  RESUME_BLOCKED,
  TARGETED_BINDING_PREFIX,
  targetedBindingKey,
} from './targeted-requery-lifecycle.mjs';
import {
  RESOLUTION_FILENAME,
  createResolutionArtifact,
  classifyGapTerminal,
  evaluateResolution,
  TERMINATION_NONE,
  TERMINATION_PER_GAP_BOUND_EXHAUSTED,
  TERMINATION_RUN_BUDGET_STOP,
  TERMINATION_ACTION_OPERATIONAL_FAILURE,
  TERMINATION_NEVER_AUTHORIZED,
  loadResolutionArtifact,
  persistResolutionArtifact,
  recordResolution,
} from './targeted-requery-resolution.mjs';
import { computeTargetedAttemptCounts } from './targeted-requery-attempts.mjs';

export const SUBPHASE_ERROR_INVALID = 'p2a_targeted_requery_subphase_invalid';

/**
 * F.6 / F.6.1 — the PLANNED half of the global attempt budget, read straight off the
 * coverage state the frozen P1 retrieval loop maintains.
 *
 * `attemptsBudgetCount` is defined by the frozen contract as
 *
 *     attemptsBudgetCount = 计划 executedRoutes + 计划 providerFailures
 *                           + targetedExecutedCount + targetedFailedCount
 *
 * and the ledger can only ever supply the second line. The planned line is NOT
 * derivable from the ledger (the ledger never sees a planned round), and the
 * targeted line is NOT derivable from the coverage state (D4 forbids writing
 * targeted attempts back into `executedRoutes`). Each counter therefore has
 * exactly one honest source, and the budget is the sum of both.
 *
 * This is a PURE READ of an already-validated coverage state — no new
 * `ResearchCoverageState` field, no write, no new round semantics. Without it the
 * authorization preflight (E.5(7), `authorization.mjs`) can only see the targeted
 * half, which is precisely the "不得静默超出全局预算" failure Spec §13 forbids.
 */
export function computePlannedAttemptCount(coverageState) {
  if (!isPlainObject(coverageState)) {
    throw subphaseError('computePlannedAttemptCount requires a coverage state plain object');
  }
  const retrieval = coverageState.retrieval;
  if (!isPlainObject(retrieval)) {
    throw subphaseError('computePlannedAttemptCount requires a coverage state with a retrieval section');
  }
  const executedRoutes = retrieval.executedRoutes;
  const providerFailures = retrieval.providerFailures;
  if (!Array.isArray(executedRoutes) || !Array.isArray(providerFailures)) {
    throw subphaseError('computePlannedAttemptCount requires executedRoutes[] and providerFailures[]');
  }
  return executedRoutes.length + providerFailures.length;
}

/** No actionable gap (or no admissible proposal) — a legal, non-failing outcome. */
export const SUBPHASE_STATUS_NO_ACTION = 'NO_ACTION';
/** At least one targeted action was authorized and processed. */
export const SUBPHASE_STATUS_COMPLETED = 'COMPLETED';

/** Work-relative directory that owns every targeted round artifact. */
export const TARGETED_SUBPHASE_DIRNAME = 'targeted-requery-subphase';

/** First diagnosis pass; later passes use the same frozen core identity. */
export const SUBPHASE_DIAGNOSIS_ROUND = 0;

/** Derived T08 input only; never a retrieval completion/replay credential. */
export const TARGETED_RESOLUTION_INPUT_PREFIX = 'targeted-resolution-input:';
export const TARGETED_RESOLUTION_INPUT_STAGING_KEY = 'targeted-resolution-input';
export function targetedResolutionInputKey(targetedActionId) {
  return `${TARGETED_RESOLUTION_INPUT_PREFIX}${targetedActionId}`;
}

const RESOLUTION_INPUT_KEYS = ['schemaVersion', 'type', 'targetedActionId', 'planHash',
  'occurrenceId', 'priorQuestionIds', 'declaredFraming', 'coveredFramings'].sort();
const canonicalStrings = values => [...new Set(values)].sort();

function validateResolutionInput(snapshot, action, gapType) {
  const canonicalArray = values => Array.isArray(values)
    && values.every(value => isNonEmptyString(value))
    && JSON.stringify(values) === JSON.stringify(canonicalStrings(values));
  if (!isPlainObject(snapshot)
      || JSON.stringify(Object.keys(snapshot).sort()) !== JSON.stringify(RESOLUTION_INPUT_KEYS)
      || snapshot.schemaVersion !== 1 || snapshot.type !== 'TargetedResolutionInput'
      || snapshot.targetedActionId !== action.targetedActionId
      || snapshot.planHash !== action.planHash || snapshot.occurrenceId !== action.occurrenceId
      || !canonicalArray(snapshot.priorQuestionIds)
      || !snapshot.priorQuestionIds.every(id => /^[1-9]\d*$/.test(id))
      || (gapType !== 'CONTRADICTION_GAP' && (snapshot.declaredFraming !== null || snapshot.coveredFramings !== null))
      || !(snapshot.declaredFraming === null || isNonEmptyString(snapshot.declaredFraming))
      || !(snapshot.coveredFramings === null || canonicalArray(snapshot.coveredFramings))) {
    throw subphaseError('targeted resolution input is malformed or belongs to another action/occurrence');
  }
  // Default strict walk: no new trustedPlanStrings call site or exemptions.
  const safety = assertArtifactSafe(snapshot);
  if (!safety.ok) throw subphaseError('targeted resolution input failed the artifact safety boundary');
  return snapshot;
}

function readResolutionInput(state, action, resolveBytes, gapType) {
  const sha = state?.hashes?.[targetedResolutionInputKey(action.targetedActionId)];
  if (typeof resolveBytes !== 'function' || typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
    throw subphaseError('checkpoint-bound original targeted resolution input is missing');
  }
  const bytes = resolveBytes(action.targetedActionId, sha);
  if (bytes === null) throw subphaseError('checkpoint-bound original targeted resolution input is unrecoverable');
  let snapshot;
  try { snapshot = JSON.parse(bytes.toString('utf8')); }
  catch { throw subphaseError('checkpoint-bound original targeted resolution input is not JSON'); }
  return validateResolutionInput(snapshot, action, gapType);
}

export class TargetedSubphaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetedSubphaseError';
    this.code = code;
  }
}

function subphaseError(message) {
  return new TargetedSubphaseError(SUBPHASE_ERROR_INVALID, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * G.4 side declaration for a CONTRADICTION gap — a PURE provenance fact, never a
 * content judgment:
 *
 *   · `declaredFraming` = the plan-owned opposing framing the gap was diagnosed
 *     for (matched by T01's frozen `opposingFramingSubjectKey`).
 *   · `coveredFramings` = the plan-owned opposing framings ALREADY covered by the
 *     executed-query provenance (normalized equality, the same lens T03 used).
 *
 * An empty covered list means "no already-covered side to oppose" ⇒ the caller of
 * `evaluateResolution` sees an undecidable side and the gap stays UNRESOLVED. This
 * module never guesses a side. Non-CONTRADICTION gaps get `null` (irrelevant).
 */
function defaultFramingForGap(gap, plan, provenance) {
  if (gap.gapType !== 'CONTRADICTION_GAP') return { declaredFraming: null, coveredFramings: null };
  const framings = Array.isArray(plan.opposingFramings) ? plan.opposingFramings : [];
  const normalizedProvenance = new Set(provenance.map((q) => normalizeSubjectString(q)).filter((v) => v !== null));
  const coveredFramings = framings.filter((f) => {
    const key = normalizeSubjectString(f);
    return key !== null && normalizedProvenance.has(key);
  });
  const declaredFraming = framings.find((f) => opposingFramingSubjectKey(f) === gap.subjectKey) ?? null;
  return { declaredFraming, coveredFramings };
}

/**
 * The executed-query provenance of the accumulated pool: the query string of every
 * channel record the retrieval path actually executed. Only `ok` channels are
 * provenance — a failed channel executed nothing that can cover a plan material
 * (E.3.1's coverage judgment stays a pure function of what succeeded).
 */
function executedQueryProvenance(accumulatedPool) {
  const seen = new Set();
  const out = [];
  for (const record of accumulatedPool.channels) {
    if (record?.ok !== true) continue;
    const query = record?.channel?.query;
    if (!isNonEmptyString(query) || seen.has(query)) continue;
    seen.add(query);
    out.push(query);
  }
  return out;
}

/**
 * Canonical merge of targeted fused candidates into the accumulated pool using the
 * frozen rule: canonical questionId identity, best `rrfScore` wins, deterministic
 * ordering (rrfScore desc, then questionId asc). No weighting, no private ordering.
 */
function mergeCandidates(accumulatedPool, targetedPools) {
  const best = new Map();
  for (const candidate of accumulatedPool.candidates) {
    best.set(String(candidate?.identity?.questionId), candidate);
  }
  for (const pool of targetedPools) {
    for (const candidate of pool.candidates) {
      const id = String(candidate?.identity?.questionId);
      const existing = best.get(id);
      if (existing === undefined || Number(candidate.rrfScore) > Number(existing.rrfScore)) {
        best.set(id, candidate);
      }
    }
  }
  return [...best.values()].sort((a, b) => {
    const byScore = Number(b.rrfScore) - Number(a.rrfScore);
    if (byScore !== 0) return byScore;
    return String(a.identity.questionId) < String(b.identity.questionId) ? -1 : 1;
  });
}

/** Channel records: keep the first occurrence of each (query, providerId, capability). */
function mergeChannels(accumulatedPool, targetedPools) {
  const seen = new Set();
  const out = [];
  for (const record of [...accumulatedPool.channels, ...targetedPools.flatMap((p) => p.channels)]) {
    const key = `${record?.channel?.query ?? ''}::${record?.channel?.providerId ?? ''}::${record?.channel?.capability ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

/**
 * Run the targeted sub-phase.
 *
 * @returns {{ ok: true, status: string, pool: object, state: object|null,
 *             actionsArtifact: object, resolutionArtifact: object,
 *             counts: { executed: number, failed: number },
 *             executedActionIds: string[], reusedActionIds: string[],
 *             rejectedActionIds: string[], gaps: object[] }}
 */
export function runTargetedSubphase({
  workDir,
  plan,
  planHash: expectedPlanHash,
  runId,
  occurrenceId,
  seam,
  channels,
  plannedRoutes,
  accumulatedPool,
  proposals = [],
  proposeForDiagnosis = null,
  diagnosticCandidates = [],
  executionAllowed = true,
  runTerminationReason = TERMINATION_NONE,
  maxQueryBudget,
  maxAttemptsPerGap,
  // F.6 — the PLANNED half of the global attempt budget, resolved by the composition
  // owner via the exported `computePlannedAttemptCount(coverageState)` from the live
  // coverage state it owns. Required (non-negative integer): the budget preflight must
  // see planned + targeted, and a targeted-only denominator silently under-counts the
  // money already spent on the frozen P1 rounds.
  plannedAttemptsBudgetCount = null,
  state = null,
  crashAt = () => {},
  framingForGap = null,
  // F.5.1 — injected by the composition layer, which owns the content-addressed
  // staging directory. `stageLedgerBytes(bytes) -> sha256` publishes a version;
  // `resolveAnchoredBytes(sha) -> bytes|null` returns the bytes the checkpoint anchors.
  // Injection is required by the module graph (composer -> subphase -> lifecycle), so the
  // lifecycle cannot import the staging helper without a cycle.
  stageLedgerBytes = null,
  resolveAnchoredBytes = null,
  stageResolutionInputBytes = null,
  resolveResolutionInputBytes = null,
} = {}) {
  // ---- fail-closed input gates (no artifact is produced on any failure) -------
  if (!isNonEmptyString(workDir)) throw subphaseError('workDir must be a non-empty string');
  if (!isValidPlanHashFormat(expectedPlanHash)) throw subphaseError('planHash must be a 64-hex plan contract hash');
  if (!isNonEmptyString(runId)) throw subphaseError('runId must be a non-empty string');
  if (!isNonEmptyString(occurrenceId)) throw subphaseError('occurrenceId must be a non-empty string');
  if (!isPlainObject(plan)) throw subphaseError('plan must be a plain object');
  if (!isPlainObject(seam)) throw subphaseError('seam must be a plain object');
  if (!Array.isArray(channels) || channels.length === 0) throw subphaseError('channels must be a non-empty array');
  if (!Array.isArray(plannedRoutes)) throw subphaseError('plannedRoutes must be an array');
  if (!isPlainObject(accumulatedPool) || !Array.isArray(accumulatedPool.candidates) || !Array.isArray(accumulatedPool.channels)) {
    throw subphaseError('accumulatedPool must carry candidates[] and channels[]');
  }
  if (!Array.isArray(proposals)) throw subphaseError('proposals must be an array');
  if (proposeForDiagnosis !== null && typeof proposeForDiagnosis !== 'function') throw subphaseError('proposeForDiagnosis must be a function or null');
  if (!Array.isArray(diagnosticCandidates)) throw subphaseError('diagnosticCandidates must be an array');
  if (typeof executionAllowed !== 'boolean') throw subphaseError('executionAllowed must be boolean');
  if (!isPositiveInteger(maxQueryBudget)) throw subphaseError('maxQueryBudget must be a positive integer');
  if (!isPositiveInteger(maxAttemptsPerGap)) throw subphaseError('maxAttemptsPerGap must be a positive integer');
  if (!isNonNegativeInteger(plannedAttemptsBudgetCount)) {
    throw subphaseError(
      'plannedAttemptsBudgetCount must be a non-negative integer: the global attempt budget denominator '
      + '(F.6) is planned executedRoutes + planned providerFailures + targeted executed + targeted failed, '
      + 'so its planned half cannot be omitted',
    );
  }
  if (state !== null && !isPlainObject(state)) throw subphaseError('state must be a plain object or null');
  if (typeof crashAt !== 'function') throw subphaseError('crashAt must be a function');
  if (framingForGap !== null && typeof framingForGap !== 'function') throw subphaseError('framingForGap must be a function or null');

  // Diagnostic candidates never acquire gap identity. T03 remains the producer
  // of the three legitimate gap types; unknown is only a rejection audit.
  for (let index = 0; index < diagnosticCandidates.length; index += 1) {
    const gapType = normalizeGapType(diagnosticCandidates[index]?.gapType);
    appendEvent(workDir, { event: 'targeted_diagnostic_validation', runId, occurrenceId,
      planHash: expectedPlanHash, candidateIndex: index, gapType,
      status: gapTypeAllowsRetrievalAction(gapType) ? 'REQUIRES_DIAGNOSIS' : 'REJECTED',
      rejectionCode: gapTypeAllowsRetrievalAction(gapType) ? null : 'UNKNOWN_GAP_TYPE' });
  }
  let workingPool = accumulatedPool;

  // ---- 1. diagnose gaps from the executed-query provenance (T03) -------------
  const provenance = executedQueryProvenance(accumulatedPool);
  const diagnosed = diagnoseGaps({
    plan,
    executedQueryProvenance: provenance,
    planHash: expectedPlanHash,
    occurrenceId,
    diagnosisRound: SUBPHASE_DIAGNOSIS_ROUND,
  });

  // S1 / F.4 — persist the controller-owned gap ledger. T03 is READ-ONLY BY
  // CONSTRUCTION and deliberately hands the persistence decision to this controller
  // ("the persistence decision belongs to the controller (T09) using T01's own
  // persistLedger"), so without this line the diagnosed gaps exist only in memory and
  // S1's OBSERVABLE_PRODUCTION_EFFECT (a new controller-owned gap ledger artifact)
  // never happens. `diagnoseGaps` already returns a ledger built with T01 primitives,
  // so this is a single write with T01's own determinism guarantee (canonical gapId
  // order -> byte-identical output for identical logical content).
  //
  // It is written BEFORE any authorization so a crash mid-sub-phase still leaves an
  // observable record of what was diagnosed. It is NOT a trust root: nothing reads it
  // back for authority (the action ledger anchor is the only trust root), so it needs
  // no checkpoint binding of its own.
  persistLedger(workDir, diagnosed.ledger);

  // ---- 2. deterministic gapId-ascending selection (E.8) ----------------------
  let gapLedger = diagnosed.ledger;
  let gaps = sortGapsByGapId(diagnosed.records);

  // ---- 3. artifacts (create when absent; the composer owns the work dir) -----
  // The two persisted artifacts are anchored on BOTH planHash and occurrenceId.
  // `loadActionsArtifact` / `loadResolutionArtifact` only check the planHash, and
  // the composer archives just the group-level derived state across occurrences
  // (P1-R02) — so a NEW occurrence in a reused work dir would load the PRIOR
  // occurrence's artifact and every later `registerAuthorizedAction` would throw
  // on the occurrenceId anchor, aborting the whole composition (CFC_ABORTED).
  //
  // The occurrence anchor is checked HERE, in the orchestrator, rather than by
  // widening T06's / T08's frozen loader signatures: this ticket owns orchestration,
  // not the lifecycle persistence surface. A stale anchor is treated exactly like a
  // stale planHash — not reusable, rebuild from scratch for this occurrence.
  // F.5.1 AUTHORITY_RULE — the authoritative ledger is the version the CHECKPOINT
  // anchors, not whatever the canonical file currently holds. The canonical file is
  // overwritten in place, so after a crash between the COMMITTED ledger write and the
  // checkpoint commit it holds a NEWER version that no checkpoint vouches for; reading
  // it would let an unproven record drive dedupe / lifecycle / completion — exactly the
  // P0 unanchored-second-credential pattern (P1-R06).
  //
  // The three cases are deliberately NOT collapsed:
  //   · a checkpoint exists and anchors a version  → that version is authoritative
  //   · a checkpoint exists but anchors nothing    → CASE 1b, fail closed
  //   · no checkpoint at all (fresh composition)    → start a new ledger
  let currentState = state;
  const priorState = currentState;
  let actionsArtifact;
  if (priorState === null) {
    actionsArtifact = createActionsArtifact({ planHash: expectedPlanHash, occurrenceId });
  } else {
    const anchored = resolveAnchoredBytes === null
      ? null
      : readAnchoredLedger(priorState, resolveAnchoredBytes);
    // Both discriminators use the SAME shape test on purpose. `readAnchoredLedger`
    // accepts an anchor only when it is 64 lowercase hex, so `hasAnchor` must agree;
    // if it merely counted 64 characters, a non-hex value would be reported as
    // "anchored but unrecoverable" here while the reader treated it as "no anchor" —
    // two different verdicts for one value. Both outcomes are fail-closed either
    // way, but disagreeing classifications are how a real corruption turns into a
    // confusing failure later.
    const hasAnchor = typeof priorState.hashes?.[LEDGER_CHECKPOINT_KEY] === 'string'
      && /^[0-9a-f]{64}$/.test(priorState.hashes[LEDGER_CHECKPOINT_KEY]);
    if (anchored === null && hasAnchor) {
      // Anchored, but the anchored bytes are unrecoverable -> CASE 3b, fail closed.
      throw subphaseError(
        'the checkpoint anchors an action-ledger version whose bytes are unrecoverable '
        + '(UNKNOWN != PASS: refusing to fall back to the unanchored canonical ledger)',
      );
    }
    if (anchored === null) {
      // CASE 1b — a checkpoint exists but never anchored a ledger, while the work
      // dir holds a ledger nobody vouches for. That is precisely the window where
      // ANCHOR 1 crashed: the AUTHORIZED record was persisted, but the `writeState`
      // that would have anchored it never completed.
      //
      // The amendment requires this to FAIL CLOSED rather than start fresh, and the
      // reason is worth stating because starting fresh looks harmless and is not:
      // the unanchored ledger may name an authorization, and re-authorizing the same
      // proposal is free while re-running its retrieval is not. Starting a new ledger
      // silently discards a decision the checkpoint cannot prove, so a corruption
      // anomaly would be swallowed and the run would report a clean start. UNKNOWN
      // must surface (B-layer: UNKNOWN != PASS).
      //
      // "No ledger on disk either" is the genuine fresh-composition case and is
      // allowed to start clean — there is nothing unproven to discard.
      const unanchoredLedgerPresent = fs.existsSync(path.join(workDir, ACTIONS_FILENAME));
      if (unanchoredLedgerPresent) {
        throw subphaseError(
          'the checkpoint anchors no action-ledger version but an unanchored ledger exists on disk '
          + '(F.5.1 CASE 1b: an authorization persisted without its anchor is an authorization the '
          + 'checkpoint cannot prove — refusing to discard it and start clean)',
        );
      }
      actionsArtifact = createActionsArtifact({ planHash: expectedPlanHash, occurrenceId });
    } else if (anchored.occurrenceId === occurrenceId) {
      actionsArtifact = anchored;
    } else {
      actionsArtifact = createActionsArtifact({ planHash: expectedPlanHash, occurrenceId });
    }
  }
  const loadedResolution = loadResolutionArtifact(workDir, expectedPlanHash);
  let resolutionArtifact = loadedResolution.ok && loadedResolution.artifact.occurrenceId === occurrenceId
    ? loadedResolution.artifact
    : createResolutionArtifact({ planHash: expectedPlanHash, occurrenceId });

  // Rebuild legitimate audit subjects from the Approved plan and checkpoint-
  // anchored actions, never from a canonical ledger file as a credential.
  const templates = diagnoseGaps({ plan, executedQueryProvenance: [],
    planHash: expectedPlanHash, occurrenceId, diagnosisRound: 0 }).records;
  for (const prior of actionsArtifact.targetedActions) {
    if (gaps.some(gap => gap.gapId === prior.gapId)) continue;
    const template = templates.find(gap => gap.gapIdentityCore === prior.gapIdentityCore);
    if (!template) throw subphaseError('anchored action has no legitimate plan-owned gap subject');
    const diagnosisRound = Number(prior.gapId.split(':')[1]);
    const record = { ...template, diagnosisRound, gapId: makeGapId(template.gapIdentityCore, diagnosisRound) };
    gapLedger = appendGapRecord(gapLedger, record);
    gaps = gapLedger.diagnosedGaps;
  }
  persistLedger(workDir, gapLedger);
  const actionable = gaps.filter(gap => gapTypeAllowsRetrievalAction(gap.gapType));
  const blockedCores = new Set();
  let diagnosisRound = 0;
  let roundGaps = actionable.filter(gap => gap.diagnosisRound === 0);
  const targetedPools = [];
  const executedActionIds = [];
  const reusedActionIds = [];
  const rejectedActionIds = [];

  const resolveGap = (gapId) => {
    const found = gaps.find((g) => g.gapId === gapId);
    return found ? { gapId: found.gapId, gapType: found.gapType } : null;
  };

  for (;;) {
    appendEvent(workDir, { event: 'targeted_diagnosis', runId, occurrenceId,
      planHash: expectedPlanHash, diagnosisRound, gaps: roundGaps.map(gap => ({
        gapId: gap.gapId, gapIdentityCore: gap.gapIdentityCore, gapType: gap.gapType })) });
    const roundProposals = !executionAllowed ? [] : proposeForDiagnosis === null
      ? (diagnosisRound === 0 ? proposals : [])
      : proposeForDiagnosis({ diagnosisRound, gaps: roundGaps.map(gap => ({ ...gap })) });
    if (!Array.isArray(roundProposals)) throw subphaseError('diagnosis proposals must be an array');
    for (const gap of roundGaps) {
    const proposal = roundProposals.find(p => isPlainObject(p) && p.gapId === gap.gapId);
    const prior = latestActionForGap(actionsArtifact, gap.gapId);
    if (proposal === undefined && prior === null) { blockedCores.add(gap.gapIdentityCore); continue; }
    if (proposal !== undefined) appendEvent(workDir, { event: 'targeted_proposal',
      diagnosisRound, gapId: gap.gapId, gapIdentityCore: gap.gapIdentityCore,
      runId, occurrenceId, planHash: expectedPlanHash,
      planOwnedStringRef: proposal.planOwnedStringRef ?? null });
    if (proposal !== undefined && prior === null && actionsArtifact.rejected.some(record =>
      record.gapId === gap.gapId && JSON.stringify(record.proposalVerbatim) === JSON.stringify(proposal))) {
      blockedCores.add(gap.gapIdentityCore); continue;
    }

    // ---- F.5 REPLAY FIRST (the frozen decision outranks authorization) -------
    // A gap that already carries a recorded action is resolved by T06's replay
    // decision BEFORE any authorization attempt. Two frozen rules make this
    // ordering mandatory, not stylistic:
    //   (1) F.5: `AUTHORIZED`-only records and hash-mismatch / missing-artifact
    //       cases take the SAFE RE-RUN ONCE branch. Re-authorizing would route
    //       through T05's dedupe gate, which rejects a dedupe key it has already
    //       seen (EQUIVALENT_QUERY_ALREADY_AUTHORIZED) and would make F.5's
    //       mandated re-run structurally unreachable.
    //   (2) F.5 / P1-R06: the checkpoint is the ONLY trust root. The COMMITTED
    //       record's own `bindingHash` is NOT anchored by the checkpoint (it is
    //       outside the F.1 identity, so it never self-verifies), so promoting it
    //       into `state.hashes` here would manufacture a completion credential
    //       from an unanchored second source — the exact P0 pattern P1-R06
    //       revoked. When `state.hashes[bindingKey]` is absent or mismatched the
    //       contract answer is a RE-RUN, admitting the possible double payment
    //       that `UNKNOWN != PASS` demands. Never fabricate completion evidence.
    let action;
    let mergedPool = null;
    let advanceToTerminal = false;

    if (prior !== null) {
      const replay = decideTargetedReplay({
        workDir,
        state: currentState,
        artifact: actionsArtifact,
        identity: identityOf(prior),
      });
      if (replay.decision === RESUME_BLOCKED) { blockedCores.add(gap.gapIdentityCore); continue; }
      if (replay.decision === RESUME_REUSE) {
        // A committed-set action whose checkpoint binding validates: never repeat
        // the paid retrieval, and never drop the evidence already bought. REUSE
        // covers the WHOLE committed set, including the two non-terminal members
        // COMMITTED / EVALUATED — a crash between the commit point and the T08
        // conclusion leaves exactly those statuses behind, and skipping them
        // outright would strand the gap with no terminal forever (S10: no gap may
        // silently vanish). So REUSE skips only the PAID retrieval; the T08
        // evaluation still has to run for a non-terminal status.
        // F.5.1: the expected hash is the CHECKPOINT BINDING (`state.hashes[bindingKey]`),
        // never `prior.artifactHash`. The record's own field lives inside the ledger,
        // which is exactly the unanchored second credential P1-R06 ruled a P0: reading
        // bytes against it would let a tampered-but-parseable ledger vouch for itself.
        // `decideTargetedReplay` has already proven this binding is present and 64-hex.
        mergedPool = readBoundTargetedPool(workDir, prior.artifactRel, currentState.hashes[targetedBindingKey(prior.targetedActionId)]);
        if (mergedPool !== null) targetedPools.push(mergedPool);
        reusedActionIds.push(prior.targetedActionId);
        advanceToTerminal = !FINAL_EVIDENCE_STATUSES.includes(prior.status);
        action = prior;
      } else if (prior.status === ACTION_STATUS_AUTHORIZED) {
        if (!executionAllowed) throw subphaseError('run STOP forbids re-paying an uncommitted targeted action');
        // F.5's plain safe re-run: an AUTHORIZED-only record carries no completion
        // evidence, so the single retrieval entry point below runs it for real. This
        // is the only re-run branch that may pay again — and it is the branch the
        // contract's "承认可能重复付费一次" cost statement is about.
        action = prior;
      } else if (FINAL_EVIDENCE_STATUSES.includes(prior.status)) {
        // A terminal conclusion exists, but its binding does not validate and its
        // bytes are gone. F.5 has NO terminal exemption for this case:
        //   hash 不匹配 / 产物缺失 → 视为未提交，安全重跑一次
        // The verdict being append-only history does not make the missing bytes
        // optional, because nothing downstream reads the resolution artifact at
        // all — the augmented pool is the ONLY downstream-consumable product of a
        // targeted action. Returning `ok: true` here would silently drop paid
        // evidence from the one channel that carries it. Fail closed, exactly like
        // the non-terminal branch below; the asymmetry that made this `continue`
        // was a design preference of mine and the frozen contract overrules it.
        mergedPool = readBoundTargetedPool(workDir, prior.artifactRel, currentState.hashes[targetedBindingKey(prior.targetedActionId)]);
        if (mergedPool === null) {
          throw subphaseError(
            `no completion evidence and no readable product for targeted action ${prior.targetedActionId} `
            + `(terminal status ${prior.status}, replay ${replay.reason}): the augmented pool is the only `
            + 'downstream-consumable product of a targeted action, so ok:true would silently drop paid evidence',
          );
        }
        targetedPools.push(mergedPool);
        reusedActionIds.push(prior.targetedActionId);
        continue;
      } else {
        // COMMITTED / EVALUATED with a MISSING or MISMATCHED checkpoint binding, reached
        // from a ledger that is NOT the anchored version. With F.5.1 in place this is now
        // a defensive branch rather than the expected path: the anchored ledger version
        // is what resume reads, so a crash between the COMMITTED ledger write and the
        // checkpoint commit presents an AUTHORIZED record (handled above) and never
        // reaches here. The branch is kept because fail-closed must hold even if a future
        // caller hands us an unanchored ledger.
        //
        // F.5 still forbids manufacturing completion evidence, and a re-run still cannot
        // be obtained by re-authorizing (E.6's dedupeKey excludes `attempt`). So the only
        // honest in-scope move is to finish the T08 conclusion for the record that exists,
        // using whatever bytes are still readable — and to read them against the CHECKPOINT
        // binding, never against the record's own unanchored `artifactHash`.
        mergedPool = readBoundTargetedPool(workDir, prior.artifactRel, currentState.hashes[targetedBindingKey(prior.targetedActionId)]);
        if (mergedPool === null) {
          // The paid evidence is genuinely gone AND no terminal was ever reached.
          // Continuing would report `ok: true` while silently dropping a paid
          // action — a silent wrong value. Fail closed with a typed error instead:
          // UNKNOWN must surface, not be laundered into a clean result.
          throw subphaseError(
            `no completion evidence and no readable product for targeted action ${prior.targetedActionId} `
            + `(status ${prior.status}, replay ${replay.reason}): the paid retrieval cannot be re-paid `
            + 'because E.6 dedupe forbids re-authorizing the same equivalent query, so this needs an '
            + 'explicit operator decision rather than a synthesized conclusion',
          );
        }
        targetedPools.push(mergedPool);
        advanceToTerminal = true;
        action = prior;
      }
    } else {
      if (!executionAllowed) { blockedCores.add(gap.gapIdentityCore); continue; }
      const countsSoFar = computeTargetedAttemptCounts({ actions: actionsArtifact.targetedActions });
      // F.6 / E.5(7): the preflight denominator is BOTH halves of the budget. The
      // targeted half below is the ledger pure function; the planned half
      // (`plannedAttemptsBudgetCount`) is the frozen P1 coverage state, resolved by the
      // composition owner that owns it and gated fail-closed at the top of this
      // function. The preflight therefore sees the same four-term sum
      // `evaluateRetrievalRound` computes for `attemptsBudgetCount` — never a
      // targeted-only or planned-only denominator.
      const decision = authorizeTargetedAction(proposal, {
        plan,
        resolveGap,
        plannedRoutes,
        runId,
        occurrenceId,
        planHash: expectedPlanHash,
        maxAttemptsPerGap,
        maxQueryBudget,
        // F.6: planned + targeted. The caller resolves the planned half with the
        // exported `computePlannedAttemptCount(coverageState)`; this module adds the
        // ledger's own targeted half. Neither half may be substituted for the other.
        attemptsBudgetCount: plannedAttemptsBudgetCount + countsSoFar.executed + countsSoFar.failed,
        attemptsByGapIdentityCore: attemptsByGapIdentityCore(actionsArtifact.targetedActions),
        authorizedDedupeKeys: actionsArtifact.targetedActions
          .filter((r) => r.status !== ACTION_STATUS_FAILED_OPERATIONAL)
          .map((r) => r.dedupeKey)
          .filter((k) => isNonEmptyString(k)),
      });

      appendEvent(workDir, { event: 'targeted_decision', diagnosisRound,
        gapId: gap.gapId, gapIdentityCore: gap.gapIdentityCore, runId, occurrenceId,
        planHash: expectedPlanHash, status: decision.status,
        rejectionCode: decision.rejectionCode, normalizedQuery: decision.normalizedQuery,
        targetedActionId: decision.targetedActionId,
        attemptsByCore: attemptsByGapIdentityCore(actionsArtifact.targetedActions)[gap.gapIdentityCore] ?? 0,
        attemptsBudgetCount: plannedAttemptsBudgetCount + countsSoFar.executed + countsSoFar.failed });
      if (decision.status !== AUTHORIZATION_STATUS_AUTHORIZED) {
        blockedCores.add(gap.gapIdentityCore);
        actionsArtifact = recordRejectedDecision(actionsArtifact, decision, proposal);
        persistActionsArtifact(workDir, actionsArtifact);
        if (isNonEmptyString(decision.gapId)) rejectedActionIds.push(decision.gapId);
        continue;
      }

      if (typeof stageLedgerBytes !== 'function' || typeof stageResolutionInputBytes !== 'function'
          || typeof resolveResolutionInputBytes !== 'function') {
        throw subphaseError('targeted authorization requires the composition-owned resolution-input staging seam');
      }
      const framing = gap.gapType !== 'CONTRADICTION_GAP' ? null : framingForGap === null
        ? defaultFramingForGap(gap, plan, executedQueryProvenance(workingPool)) : framingForGap(gap);
      const snapshot = validateResolutionInput({
        schemaVersion: 1, type: 'TargetedResolutionInput', targetedActionId: decision.targetedActionId,
        planHash: expectedPlanHash, occurrenceId,
        priorQuestionIds: canonicalStrings(workingPool.candidates.map(candidate => String(candidate.identity.questionId))),
        declaredFraming: framing?.declaredFraming ?? null,
        coveredFramings: Array.isArray(framing?.coveredFramings)
          ? canonicalStrings(framing.coveredFramings) : framing?.coveredFramings ?? null,
      }, decision, gap.gapType);
      const snapshotBytes = `${JSON.stringify(snapshot, null, 2)}\n`;
      const snapshotHash = stageResolutionInputBytes(decision.targetedActionId, snapshotBytes);
      if (snapshotHash !== createHash('sha256').update(snapshotBytes).digest('hex')) {
        throw subphaseError('resolution-input publisher must return an exact content hash');
      }
      currentState = { ...currentState, hashes: { ...currentState?.hashes,
        [targetedResolutionInputKey(decision.targetedActionId)]: snapshotHash } };
      actionsArtifact = registerAuthorizedAction(actionsArtifact, decision);
      persistActionsArtifact(workDir, actionsArtifact);
      // F.5.1 ANCHOR 1 — an authorization is a decision to spend money, so it must be
      // checkpoint-anchored too. Without this, a crash before the commit point would
      // leave an AUTHORIZED record in the canonical file that NO checkpoint vouches for,
      // and resume (which now trusts only the anchored version) could not honour it —
      // the ledger anchor and the record would disagree about what was authorized.
      //
      // The staged copy is published FIRST and its exact bytes are hashed, so the hash
      // in `state.hashes` describes bytes that can actually be recovered later. This
      // authorization decision is its own atomic event with its own `writeState`; it is
      // not a second commit point for the retrieval, which still commits only at
      // `finalizeTargetedCommit`.
      if (stageLedgerBytes !== null) {
        const ledgerBytes = actionsArtifactBytes(actionsArtifact);
        const ledgerHash = stageLedgerBytes(ledgerBytes);
        currentState = anchorLedgerVersion(currentState, actionsArtifact, ledgerHash);
        writeState(workDir, currentState);
      }
      [action] = actionsArtifact.targetedActions.filter((r) => r.targetedActionId === decision.targetedActionId);
    }

    const targetedActionId = action.targetedActionId;

    // ---- T02 execution (the ONLY retrieval route) ----------------------------
    // Only a still-AUTHORIZED action is executed. Every committed-set record
    // carries its durable product already: re-running the retrieval for one of
    // those would pay twice for the same query, which E.6's dedupe makes illegal
    // and F.5's C4 forbids. The one branch that DOES re-execute is the
    // AUTHORIZED-only safe re-run above — the contract's acknowledged possible
    // double payment, admitted precisely because it has no evidence to prove it.
    if (action.status === ACTION_STATUS_AUTHORIZED) {
      // AUTHORIZED-only safe re-run must retain its original G.1 inputs too.
      readResolutionInput(currentState, action, resolveResolutionInputBytes, gap.gapType);
      const roundDir = path.join(workDir, TARGETED_SUBPHASE_DIRNAME, `action-${targetedActionId}`);
      const res = runMultiQueryRetrieval({
        plan,
        planHash: expectedPlanHash,
        seam,
        channels: channels.filter(channel => action.providerScope.some(scope => scope.providerId === channel.providerId)),
        workDir: roundDir,
        targetedQueries: [action.normalizedQuery],
      });

      if (!res.ok) {
        // Operational failure: AUTHENTICALLY recorded as FAILED_OPERATIONAL (one
        // in-edge from AUTHORIZED) — never fabricated as resolved, never retried
        // here (the STOP / budget owner decides policy, not this sub-phase).
        actionsArtifact = advanceActionStatusSafely(
          actionsArtifact, targetedActionId, ACTION_STATUS_FAILED_OPERATIONAL, { event: 'EXECUTE_FAILED', reason: 'operational' },
        );
        persistActionsArtifact(workDir, actionsArtifact);
        blockedCores.add(gap.gapIdentityCore);
        continue;
      }

      mergedPool = res.pool;
      targetedPools.push(res.pool);
      crashAt('after_targeted_execution');

      // ---- T06 commit point (checkpoint-first), reused verbatim ---------------
      const artifactRel = path.join(TARGETED_SUBPHASE_DIRNAME, `action-${targetedActionId}`, RETRIEVAL_POOL_FILENAME);
      const artifactBytes = fs.readFileSync(path.join(roundDir, RETRIEVAL_POOL_FILENAME));
      const prepared = prepareTargetedCommit({
        workDir,
        artifact: actionsArtifact,
        state: currentState,
        targetedActionId,
        artifactRel,
        artifactBytes,
        // F.5.1 ANCHOR 2 — the commit point also anchors the COMMITTED ledger version
        // and publishes its exact bytes under their content address. It runs BEFORE the
        // crash window below so the anchored version is always recoverable by the time
        // the checkpoint names it. The checkpoint itself is still committed exactly
        // once, by `finalizeTargetedCommit` below — this is not a second commit point.
        stageLedgerBytes,
      });
      actionsArtifact = prepared.artifact;
      currentState = prepared.state;
      // crashAt window: bytes + binding + COMMITTED record are durable, the checkpoint
      // is NOT yet committed → "no completion evidence". F.5's answer is a safe
      // re-run once; the recovery branch above picks the recorded action back up and
      // carries it to its terminal without re-paying.
      crashAt('after_targeted_commit_prepare');
      finalizeTargetedCommit(workDir, currentState);
      // The commit point is now COMPLETE: bytes durable, COMMITTED record durable,
      // binding in the checkpoint. A crash here leaves a record that is COMMITTED
      // but not yet concluded — the exact window REUSE + advanceToTerminal covers.
      crashAt('after_targeted_commit_finalize');
      executedActionIds.push(targetedActionId);
    }

    // ---- T08 re-evaluation (RESOLVED only when a predicate says so) ----------
    // A resumed action already carrying a terminal conclusion keeps it verbatim:
    // re-deriving it here would re-run the predicate against the CURRENT turn's
    // accumulated pool and could rewrite append-only history. Only a record that
    // still owes a conclusion is evaluated here.
    if (advanceToTerminal || !FINAL_EVIDENCE_STATUSES.includes(action.status)) {
      const snapshot = readResolutionInput(currentState, action, resolveResolutionInputBytes, gap.gapType);
      const priorQuestionIds = snapshot.priorQuestionIds;
      const targetedQuestionIds = (mergedPool?.candidates ?? []).map((c) => String(c.identity.questionId));
      const framing = snapshot;
      const predicateResult = evaluateResolution({
        gapType: gap.gapType,
        priorQuestionIds,
        targetedQuestionIds,
        declaredFraming: framing?.declaredFraming ?? null,
        coveredFramings: framing?.coveredFramings ?? null,
      });
      const paidCounts = computeTargetedAttemptCounts({ actions: actionsArtifact.targetedActions });
      const terminationReason = attemptsByGapIdentityCore(actionsArtifact.targetedActions)[gap.gapIdentityCore] >= maxAttemptsPerGap
        ? TERMINATION_PER_GAP_BOUND_EXHAUSTED
        : plannedAttemptsBudgetCount + paidCounts.executed + paidCounts.failed >= maxQueryBudget
          ? TERMINATION_RUN_BUDGET_STOP : TERMINATION_NONE;
      const terminal = classifyGapTerminal({ predicateResult, terminationReason, everAuthorized: true });
      actionsArtifact = advanceActionStatusSafely(actionsArtifact, targetedActionId, ACTION_STATUS_EVALUATED, { event: 'EVALUATE' });
      actionsArtifact = advanceActionStatusSafely(actionsArtifact, targetedActionId, terminal.status, { event: 'CONCLUDE' });
      persistActionsArtifact(workDir, actionsArtifact);

      resolutionArtifact = recordResolution(resolutionArtifact, {
        gapId: gap.gapId,
        gapIdentityCore: gap.gapIdentityCore,
        targetedActionId,
        ...terminal,
        newEvidenceIds: predicateResult.newEvidenceIds,
      });
      persistResolutionArtifact(workDir, resolutionArtifact);
    }
    if (resolutionArtifact.resolutions.some(record => record.gapId === gap.gapId && record.status === 'RESOLVED')) {
      blockedCores.add(gap.gapIdentityCore);
    }
    // Evaluate novelty against the pre-action pool, then merge its bound product.
    if (mergedPool !== null) workingPool = augmentAccumulatedPool({
      workDir, plan, expectedPlanHash, accumulatedPool: workingPool, targetedPools: [mergedPool] });
  }

  // H-8 / E.7: every diagnosed gap reaches an explicit terminal, including
  // no-proposal, rejected and operational-failure paths. No action is fabricated.
  for (const gap of roundGaps) {
    if (resolutionArtifact.resolutions.some(record => record.gapId === gap.gapId)) continue;
    const prior = latestActionForGap(actionsArtifact, gap.gapId);
    const paidCounts = computeTargetedAttemptCounts({ actions: actionsArtifact.targetedActions });
    const coreAttempts = attemptsByGapIdentityCore(actionsArtifact.targetedActions)[gap.gapIdentityCore] ?? 0;
    const rejected = actionsArtifact.rejected.find(record => record.gapId === gap.gapId);
    const terminal = classifyGapTerminal({
      predicateResult: evaluateResolution({ gapType: gap.gapType }),
      terminationReason: prior?.status === ACTION_STATUS_FAILED_OPERATIONAL ? TERMINATION_ACTION_OPERATIONAL_FAILURE
        : !executionAllowed ? runTerminationReason
          : coreAttempts >= maxAttemptsPerGap || rejected?.rejectionCode === REJECTION_ATTEMPT_BOUND_EXCEEDED
            ? TERMINATION_PER_GAP_BOUND_EXHAUSTED
            : plannedAttemptsBudgetCount + paidCounts.executed + paidCounts.failed >= maxQueryBudget
              || rejected?.rejectionCode === REJECTION_BUDGET_EXCEEDED ? TERMINATION_RUN_BUDGET_STOP
                : TERMINATION_NEVER_AUTHORIZED,
      everAuthorized: coreAttempts > 0,
    });
    resolutionArtifact = recordResolution(resolutionArtifact, {
      gapId: gap.gapId, gapIdentityCore: gap.gapIdentityCore,
      targetedActionId: prior?.targetedActionId ?? null, ...terminal,
    });
  }
  persistResolutionArtifact(workDir, resolutionArtifact);
  persistActionsArtifact(workDir, actionsArtifact);
  // Publish the terminal/rejection ledger through the existing checkpoint owner.
  // This records decisions; finalizeTargetedCommit remains the retrieval commit.
  if (stageLedgerBytes !== null) {
    currentState = anchorLedgerVersion(currentState, actionsArtifact, stageLedgerBytes(actionsArtifactBytes(actionsArtifact)));
    writeState(workDir, currentState);
  }

    const nextRound = diagnosisRound + 1;
    const nextByCore = new Map(gaps.filter(gap => gap.diagnosisRound === nextRound)
      .map(gap => [gap.gapIdentityCore, gap]));
    if (executionAllowed && proposeForDiagnosis !== null) {
      const nextDiagnosis = diagnoseGaps({ plan, executedQueryProvenance: executedQueryProvenance(workingPool),
        planHash: expectedPlanHash, occurrenceId, diagnosisRound: nextRound });
      for (const gap of [...nextDiagnosis.records, ...roundGaps]) {
        if (blockedCores.has(gap.gapIdentityCore) || nextByCore.has(gap.gapIdentityCore)) continue;
        nextByCore.set(gap.gapIdentityCore, { ...gap, diagnosisRound: nextRound,
          gapId: makeGapId(gap.gapIdentityCore, nextRound) });
      }
    }
    roundGaps = sortGapsByGapId([...nextByCore.values()]);
    if (roundGaps.length === 0) break;
    for (const gap of roundGaps) {
      if (!gaps.some(record => record.gapId === gap.gapId)) gapLedger = appendGapRecord(gapLedger, gap);
    }
    gaps = gapLedger.diagnosedGaps;
    persistLedger(workDir, gapLedger);
    diagnosisRound = nextRound;
  }

  // ---- 4. augment the accumulated pool (T09's single writer face) ------------
  // With nothing merged there is nothing to augment: the input pool is returned by
  // identity so a NO_ACTION run makes ZERO extra write (no needless churn, no
  // criteria relabeling) and downstream bytes are exactly the loop's own.
  const pool = targetedPools.length === 0
    ? accumulatedPool
    : augmentAccumulatedPool({
      workDir,
      plan,
      expectedPlanHash,
      accumulatedPool,
      targetedPools,
    });

  // ---- 5. T07 counting (must come from the frozen ledger export) -------------
  const counts = computeTargetedAttemptCounts({ actions: actionsArtifact.targetedActions });

  appendEvent(workDir, {
    event: 'targeted_subphase_complete',
    status: actionable.length === 0 ? SUBPHASE_STATUS_NO_ACTION : SUBPHASE_STATUS_COMPLETED,
    gapsDiagnosed: gaps.length,
    gapsActionable: actionable.length,
    executed: counts.executed,
    failed: counts.failed,
    reused: reusedActionIds.length,
    rejected: rejectedActionIds.length,
  });

  return {
    ok: true,
    status: actionable.length === 0 ? SUBPHASE_STATUS_NO_ACTION : SUBPHASE_STATUS_COMPLETED,
    pool,
    state: currentState,
    actionsArtifact,
    resolutionArtifact,
    counts,
    executedActionIds,
    reusedActionIds,
    rejectedActionIds,
    gaps,
  };
}

/** E.7 attempt accounting: how many attempts each gap identity core has accrued. */
function attemptsByGapIdentityCore(records) {
  const counts = {};
  for (const record of records) {
    const core = record.gapIdentityCore;
    if (!isNonEmptyString(core)) continue;
    counts[core] = (counts[core] ?? 0) + 1;
  }
  return counts;
}

/** The exact F.1 identity field set of a persisted action record (F.5 replay input). */
function identityOf(record) {
  return {
    runId: record.runId,
    occurrenceId: record.occurrenceId,
    planHash: record.planHash,
    gapId: record.gapId,
    attempt: record.attempt,
    normalizedQuery: record.normalizedQuery,
    providerScope: record.providerScope,
  };
}

/** Highest-attempt recorded action for a gap, or null. Deterministic. */
function latestActionForGap(artifact, gapId) {
  const forGap = artifact.targetedActions.filter((r) => r.gapId === gapId);
  if (forGap.length === 0) return null;
  return forGap.reduce((best, r) => (Number(r.attempt) >= Number(best.attempt) ? r : best));
}

/** Advance a status, tolerating an already-advanced record (idempotent re-entry). */
function advanceActionStatusSafely(artifact, targetedActionId, nextStatus, options) {
  const record = artifact.targetedActions.find((r) => r.targetedActionId === targetedActionId);
  if (record === undefined || record.status === nextStatus) return artifact;
  return advanceActionStatus(artifact, targetedActionId, nextStatus, options);
}

/**
 * Read a previously committed targeted round pool from its bound work-relative
 * path.
 *
 * `expectedHash` is REQUIRED whenever one is known, and the bytes are verified
 * against it through the same `validateArtifactCheckpoint` the commit point and
 * the replay decision use — no second hash formula, and no unverified read. A
 * tampered-but-still-parseable artifact is exactly the case a shape check alone
 * cannot see: without this it would be merged into the augmented pool and
 * returned as `ok: true`, carrying bytes no checkpoint ever vouched for. When the
 * expected hash is unknown, the bytes are NOT trusted (returns null) rather than
 * being accepted on the strength of a JSON parse.
 */
function readBoundTargetedPool(workDir, artifactRel, expectedHash) {
  if (!isNonEmptyString(artifactRel) || !isNonEmptyString(expectedHash)) return null;
  const check = validateArtifactCheckpoint(workDir, artifactRel, expectedHash);
  if (!check.ok) return null;
  const abs = path.join(workDir, artifactRel);
  if (!fs.existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!isPlainObject(parsed) || !Array.isArray(parsed.candidates) || !Array.isArray(parsed.channels)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Rebuild the accumulated pool with the targeted candidates merged in, re-walk it
 * with the SAME artifact-safety contract, and re-persist it to the same canonical
 * path (work-relative; deterministic).
 *
 * TRUST SET: the walk uses `plan.queryVariants` and NOTHING else — byte-identical
 * in shape to the four frozen call sites (F.3 / D12-3 / Seam Map §3: "MVP 不向
 * assertArtifactSafe 的既有调用点传入任何扩展 trustedPlanStrings"). The targeted
 * query strings are deliberately NOT added.
 *
 * An earlier revision of this module added them, on the reasoning that T04 had
 * already admitted them, so trusting them here "is the same plan-boundary contract".
 * That reasoning was wrong twice over: listing a string in the trust set is a
 * RELAXATION (per the contract's own worked example), and T04's gate is the
 * INTERSECTION of two lenses (`isPlanBoundarySafeString` AND `isBoundarySafeString`),
 * whereas the walk's trust list exempts a string from the provider-content lens
 * entirely. Adding them would have extended a single-lens relaxation to new
 * strings — the exact regression F.3 was written to forbid, and it would have
 * pre-empted T11's acceptance criterion that targeted strings appear in no
 * trustedPlanStrings. The targeted strings pass on their own merits: having
 * cleared both lenses at admission, they also clear the untrusted baseline.
 */
export function augmentAccumulatedPool({ workDir, plan, expectedPlanHash, accumulatedPool, targetedPools }) {
  const candidates = mergeCandidates(accumulatedPool, targetedPools);
  const channels = mergeChannels(accumulatedPool, targetedPools);
  const trusted = new Set(Array.isArray(plan.queryVariants) ? plan.queryVariants : []);
  const pool = {
    schemaVersion: RETRIEVAL_POOL_SCHEMA_VERSION,
    type: RETRIEVAL_POOL_TYPE,
    planHash: expectedPlanHash,
    channels,
    candidates,
    rejected: [],
    criteria: {
      fusion: 'rrf',
      scope: 'multi-round-accumulated+targeted',
      retrievalRounds: accumulatedPool.criteria?.retrievalRounds ?? null,
    },
  };
  const safety = assertArtifactSafe(pool, { trustedPlanStrings: trusted });
  if (!safety.ok) throw subphaseError(`augmented accumulated pool failed the artifact safety walk: ${String(safety.reason)}`);
  try {
    fs.mkdirSync(path.join(workDir, RETRIEVAL_ROUNDS_DIRNAME), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, RETRIEVAL_ROUNDS_DIRNAME, ACCUMULATED_POOL_FILENAME),
      `${JSON.stringify(pool, null, 2)}\n`,
    );
  } catch {
    throw subphaseError('augmented accumulated pool persistence failed');
  }
  return pool;
}

/** Import-time binding of the transition helper (kept out of the hot path signature). */
export const SUBPHASE_ARTIFACT_FILENAMES = Object.freeze({
  actions: ACTIONS_FILENAME,
  resolution: RESOLUTION_FILENAME,
  accumulatedPool: ACCUMULATED_POOL_FILENAME,
  targetedBindingPrefix: TARGETED_BINDING_PREFIX,
});
