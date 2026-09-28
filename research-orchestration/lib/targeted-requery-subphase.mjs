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
import path from 'node:path';

import { isValidPlanHashFormat } from './plan-contract.mjs';
import { appendEvent, validateArtifactCheckpoint } from './state.mjs';
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
  normalizeSubjectString,
  opposingFramingSubjectKey,
  sortGapsByGapId,
} from './targeted-requery-ledger.mjs';
import { diagnoseGaps } from './targeted-requery-diagnosis.mjs';
import {
  AUTHORIZATION_STATUS_AUTHORIZED,
  authorizeTargetedAction,
} from './targeted-requery-authorization.mjs';
import {
  ACTION_STATUS_AUTHORIZED,
  ACTION_STATUS_COMMITTED,
  ACTION_STATUS_EVALUATED,
  ACTION_STATUS_FAILED_OPERATIONAL,
  ACTIONS_FILENAME,
  advanceActionStatus,
  COMMITTED_SET,
  createActionsArtifact,
  decideTargetedReplay,
  loadActionsArtifact,
  persistActionsArtifact,
  prepareTargetedCommit,
  finalizeTargetedCommit,
  recordRejectedDecision,
  registerAuthorizedAction,
  RESUME_REUSE,
  RESUME_RERUN,
  RESUME_BLOCKED,
  TARGETED_BINDING_PREFIX,
  targetedBindingKey,
} from './targeted-requery-lifecycle.mjs';
import {
  RESOLUTION_FILENAME,
  createResolutionArtifact,
  evaluateResolution,
  loadResolutionArtifact,
  persistResolutionArtifact,
  recordResolution,
} from './targeted-requery-resolution.mjs';
import { computeTargetedAttemptCounts } from './targeted-requery-attempts.mjs';

export const SUBPHASE_ERROR_INVALID = 'p2a_targeted_requery_subphase_invalid';

/** No actionable gap (or no admissible proposal) — a legal, non-failing outcome. */
export const SUBPHASE_STATUS_NO_ACTION = 'NO_ACTION';
/** At least one targeted action was authorized and processed. */
export const SUBPHASE_STATUS_COMPLETED = 'COMPLETED';

/** Work-relative directory that owns every targeted round artifact. */
export const TARGETED_SUBPHASE_DIRNAME = 'targeted-requery-subphase';

/** Gap diagnosis round index for the MVP (a single diagnosis pass per run). */
export const SUBPHASE_DIAGNOSIS_ROUND = 0;

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
  maxQueryBudget,
  maxAttemptsPerGap,
  state = null,
  crashAt = () => {},
  framingForGap = null,
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
  if (!isPositiveInteger(maxQueryBudget)) throw subphaseError('maxQueryBudget must be a positive integer');
  if (!isPositiveInteger(maxAttemptsPerGap)) throw subphaseError('maxAttemptsPerGap must be a positive integer');
  if (state !== null && !isPlainObject(state)) throw subphaseError('state must be a plain object or null');
  if (typeof crashAt !== 'function') throw subphaseError('crashAt must be a function');
  if (framingForGap !== null && typeof framingForGap !== 'function') throw subphaseError('framingForGap must be a function or null');

  // ---- 1. diagnose gaps from the executed-query provenance (T03) -------------
  const provenance = executedQueryProvenance(accumulatedPool);
  const diagnosed = diagnoseGaps({
    plan,
    executedQueryProvenance: provenance,
    planHash: expectedPlanHash,
    occurrenceId,
    diagnosisRound: SUBPHASE_DIAGNOSIS_ROUND,
  });

  // ---- 2. deterministic gapId-ascending selection (E.8) ----------------------
  const gaps = sortGapsByGapId(diagnosed.records);
  const actionable = gaps.filter((gap) => gapTypeAllowsRetrievalAction(gap.gapType));

  // ---- 3. artifacts (create when absent; the composer owns the work dir) -----
  const loadedActions = loadActionsArtifact(workDir, expectedPlanHash);
  let actionsArtifact = loadedActions.ok ? loadedActions.artifact : createActionsArtifact({ planHash: expectedPlanHash, occurrenceId });
  const loadedResolution = loadResolutionArtifact(workDir, expectedPlanHash);
  let resolutionArtifact = loadedResolution.ok
    ? loadedResolution.artifact
    : createResolutionArtifact({ planHash: expectedPlanHash, occurrenceId });

  let currentState = state;
  const targetedPools = [];
  const targetedQueries = [];
  const executedActionIds = [];
  const reusedActionIds = [];
  const rejectedActionIds = [];

  const resolveGap = (gapId) => {
    const found = gaps.find((g) => g.gapId === gapId);
    return found ? { gapId: found.gapId, gapType: found.gapType } : null;
  };

  for (const gap of actionable) {
    const proposal = proposals.find((p) => isPlainObject(p) && p.gapId === gap.gapId);
    // E.7: a gap with no admissible controller proposal is NEVER silently re-run.
    if (proposal === undefined) continue;

    // ---- F.5 RECOVERY FIRST (never re-authorize a recorded action) -----------
    // A gap that already carries a recorded action is resolved by the frozen replay
    // decision BEFORE any authorization attempt. Ordering matters: the T05 dedupe
    // gate deliberately rejects a dedupe key it has already seen, so authorizing
    // first would REJECT the very action whose durable evidence we must recover
    // (EQUIVALENT_QUERY_ALREADY_AUTHORIZED) — silently dropping already-paid
    // committed candidates and making F.5's REUSE structurally unreachable.
    const prior = latestActionForGap(actionsArtifact, gap.gapId);
    let action;
    let mergedPool = null;

    if (prior !== null) {
      const replay = decideTargetedReplay({
        workDir,
        state: currentState,
        artifact: actionsArtifact,
        identity: identityOf(prior),
      });
      if (replay.decision === RESUME_BLOCKED) continue; // non-advancing terminal: fail closed
      if (replay.decision === RESUME_REUSE) {
        // A committed-set action with a valid bound hash: never repeat the paid
        // retrieval, and never drop the evidence already bought.
        mergedPool = readBoundTargetedPool(workDir, prior.artifactRel);
        if (mergedPool !== null) targetedPools.push(mergedPool);
        reusedActionIds.push(prior.targetedActionId);
        continue;
      }
      // RERUN.
      if (COMMITTED_SET.includes(prior.status)) {
        // The record is COMMITTED but the checkpoint never carried its binding (a
        // crash between the record persist and `writeState`). The artifact bytes and
        // the record's own binding ARE durable, so the correct recovery COMPLETES the
        // checkpoint commit — it never repeats the paid retrieval. Bytes that no
        // longer validate cannot be recovered: fail closed, never fabricate.
        const recovered = recoverCheckpointBinding({ workDir, record: prior, state: currentState });
        if (recovered === null) continue;
        currentState = recovered;
        mergedPool = readBoundTargetedPool(workDir, prior.artifactRel);
        if (mergedPool !== null) targetedPools.push(mergedPool);
      }
      action = prior;
    } else {
      const countsSoFar = computeTargetedAttemptCounts({ actions: actionsArtifact.targetedActions });
      const decision = authorizeTargetedAction(proposal, {
        plan,
        resolveGap,
        plannedRoutes,
        runId,
        occurrenceId,
        planHash: expectedPlanHash,
        maxAttemptsPerGap,
        maxQueryBudget,
        attemptsBudgetCount: countsSoFar.executed + countsSoFar.failed,
        attemptsByGapIdentityCore: attemptsByGapIdentityCore(actionsArtifact.targetedActions),
        authorizedDedupeKeys: actionsArtifact.targetedActions
          .filter((r) => r.status !== ACTION_STATUS_FAILED_OPERATIONAL)
          .map((r) => r.dedupeKey)
          .filter((k) => isNonEmptyString(k)),
      });

      if (decision.status !== AUTHORIZATION_STATUS_AUTHORIZED) {
        actionsArtifact = recordRejectedDecision(actionsArtifact, decision, proposal);
        persistActionsArtifact(workDir, actionsArtifact);
        if (isNonEmptyString(decision.gapId)) rejectedActionIds.push(decision.gapId);
        continue;
      }

      actionsArtifact = registerAuthorizedAction(actionsArtifact, decision);
      persistActionsArtifact(workDir, actionsArtifact);
      [action] = actionsArtifact.targetedActions.filter((r) => r.targetedActionId === decision.targetedActionId);
    }

    const targetedActionId = action.targetedActionId;

    // ---- T02 execution (the ONLY retrieval route) ----------------------------
    // Only a still-AUTHORIZED action is executed; a recovered COMMITTED action
    // already has its durable product and must never be re-run.
    if (action.status === ACTION_STATUS_AUTHORIZED) {
      const roundDir = path.join(workDir, TARGETED_SUBPHASE_DIRNAME, `action-${targetedActionId}`);
      const res = runMultiQueryRetrieval({
        plan,
        planHash: expectedPlanHash,
        seam,
        channels,
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
        continue;
      }

      mergedPool = res.pool;
      targetedPools.push(res.pool);
      targetedQueries.push(action.normalizedQuery);
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
      });
      actionsArtifact = prepared.artifact;
      currentState = prepared.state;
      // crashAt window: bytes + binding + COMMITTED record are durable, the checkpoint
      // is NOT yet committed → "no completion evidence" (one safe re-run / recovery).
      crashAt('after_targeted_commit_prepare');
      finalizeTargetedCommit(workDir, currentState);
      executedActionIds.push(targetedActionId);
    }

    // ---- T08 re-evaluation (RESOLVED only when a predicate says so) ----------
    const priorQuestionIds = [...new Set(accumulatedPool.candidates.map((c) => String(c.identity.questionId)))];
    const targetedQuestionIds = (mergedPool?.candidates ?? []).map((c) => String(c.identity.questionId));
    const framing = framingForGap === null
      ? defaultFramingForGap(gap, plan, provenance)
      : framingForGap(gap);
    const predicateResult = evaluateResolution({
      gapType: gap.gapType,
      priorQuestionIds,
      targetedQuestionIds,
      declaredFraming: framing?.declaredFraming ?? null,
      coveredFramings: framing?.coveredFramings ?? null,
    });
    actionsArtifact = advanceActionStatusSafely(actionsArtifact, targetedActionId, ACTION_STATUS_EVALUATED, { event: 'EVALUATE' });
    actionsArtifact = advanceActionStatusSafely(actionsArtifact, targetedActionId, predicateResult.status, { event: 'CONCLUDE' });
    persistActionsArtifact(workDir, actionsArtifact);

    resolutionArtifact = recordResolution(resolutionArtifact, {
      gapId: gap.gapId,
      gapIdentityCore: gap.gapIdentityCore,
      targetedActionId,
      status: predicateResult.status,
      resolutionPredicateRef: predicateResult.resolutionPredicateRef,
      resolutionBasis: predicateResult.resolutionBasis,
      newEvidenceIds: predicateResult.newEvidenceIds,
    });
    persistResolutionArtifact(workDir, resolutionArtifact);
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
      extraTrustedStrings: targetedQueries,
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

/**
 * Complete a checkpoint commit whose record binding was already made durable but
 * whose `writeState` never ran (a crash between the COMMITTED record persist and the
 * checkpoint commit). This is the checkpoint-completion recovery: it neither repeats
 * the paid retrieval nor invents a credential — it copies the action's OWN durable
 * binding hash into `state.hashes` under T06's namespaced key and commits.
 *
 * Returns the next state, or `null` when the bound bytes no longer validate (a
 * missing/corrupted artifact cannot be recovered — fail closed rather than claim).
 */
function recoverCheckpointBinding({ workDir, record, state }) {
  const bindingKey = record.bindingKey ?? targetedBindingKey(record.targetedActionId);
  const bindingHash = record.bindingHash;
  if (!isNonEmptyString(bindingHash) || !isNonEmptyString(record.artifactRel)) return null;
  const check = validateArtifactCheckpoint(workDir, record.artifactRel, bindingHash);
  if (!check.ok) return null;
  const nextState = { ...(state ?? {}), hashes: { ...((state ?? {}).hashes ?? {}), [bindingKey]: bindingHash } };
  finalizeTargetedCommit(workDir, nextState);
  return nextState;
}

/** Advance a status, tolerating an already-advanced record (idempotent re-entry). */
function advanceActionStatusSafely(artifact, targetedActionId, nextStatus, options) {
  const record = artifact.targetedActions.find((r) => r.targetedActionId === targetedActionId);
  if (record === undefined || record.status === nextStatus) return artifact;
  return advanceActionStatus(artifact, targetedActionId, nextStatus, options);
}

/** Read a previously committed targeted round pool from its bound work-relative path. */
function readBoundTargetedPool(workDir, artifactRel) {
  if (!isNonEmptyString(artifactRel)) return null;
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
 * `extraTrustedStrings` are the T04-admitted targeted query strings: they already
 * passed the plan boundary lens at admission, so trusting them here is the same
 * plan-boundary contract the round-level walk applies — NOT a caller-defined bypass.
 */
function augmentAccumulatedPool({ workDir, plan, expectedPlanHash, accumulatedPool, targetedPools, extraTrustedStrings }) {
  const candidates = mergeCandidates(accumulatedPool, targetedPools);
  const channels = mergeChannels(accumulatedPool, targetedPools);
  const trusted = new Set([
    ...(Array.isArray(plan.queryVariants) ? plan.queryVariants : []),
    ...extraTrustedStrings,
  ]);
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
