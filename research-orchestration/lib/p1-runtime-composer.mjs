// SPDX-License-Identifier: AGPL-3.0-only
/**
 * lib/p1-runtime-composer.mjs
 *
 * P1-T15 POST-MERGE REPAIR (Issue #47): runtime composition wiring.
 *
 * This module is the PRODUCTION RUNTIME COMPOSER: the single composition-
 * layer entrypoint that drives the frozen P1 composition owner
 * (lib/coverage-final-integration.mjs) through its canonical single-pass
 * stage order and binds the result for the product render/result seam:
 *
 *   persisted Research Plan (planner, plan-contract)
 *     → provider seam (official zhihu_search + global_search adapters)
 *     → beginResearchCoverageLedger
 *     → runRetrievalFeedbackLoop        (T06/T07; multi-query × multi-provider)
 *     → applySourceGroupSelection       (T08; clarification is a structured stop)
 *     → executeSelectedGroups           (T09; capture → verify → handoff, resume-aware)
 *     → dense embeddings (T11; local provider, fail-closed when unavailable)
 *     → selectResearchCorpusWithCoverage (T12; RCE)
 *     → analyzeSelectedCorpus           (T13; single analyzed-set write path)
 *     → produceSynthesisWithCoverage    (T14; pre-synthesis guard)
 *     → finalizeResearchCoverage        (T15; second independent defense)
 *     → coverage-final.json + state.p1FinalCoveragePlanHash binding
 *     → research-result.json (disclosure + verification, honest partial/failure)
 *
 * Hard rules preserved (never weakened here):
 *   - NO algorithm is implemented here: every stage is an existing frozen
 *     component joined at its published seam.
 *   - NO_SILENT_RUNTIME_FALLBACK: the composition runs ONLY on the approved
 *     canonical runtime identity; any other identity fails closed. A failure
 *     NEVER falls back to the v0.3 single-question path or to any local smoke
 *     runtime.
 *   - NO_SILENT_PROVIDER_FALLBACK: the provider seam refuses substitution.
 *   - PARTIAL != COMPLETE: a partial corpus/state produces a failure outcome
 *     with a truthful disclosure; the render binding is written ONLY on a
 *     successful full-coverage compose.
 *   - state.p1FinalCoveragePlanHash is written ONLY by this composer, ONLY on
 *     success, and ONLY to the exact planHash of the executed plan (run-bound
 *     render seam contract, docs/project-memory.md).
 *   - The global_search transport is a SYNC IO bridge (T05 seam synchrony —
 *     async HTTP bridging is the composition layer's concern, per the adapter
 *     header contract). The bridge child process resolves the access secret
 *     itself (env/file, never argv, never logged) and prints only
 *     { status, body }; credentials never enter the composer, the seam, or
 *     the adapter.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync, copyFileSync, mkdirSync, openSync, fsyncSync, closeSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  beginResearchCoverageLedger,
  runRetrievalFeedbackLoop,
  applySourceGroupSelection,
  executeSelectedGroups,
  selectResearchCorpusWithCoverage,
  analyzeSelectedCorpus,
  produceSynthesisWithCoverage,
  buildFinalDisclosure,
  finalizeResearchCoverage,
  P1_PIPELINE_IDENTITY,
  COVERAGE_STATE_FILENAME,
  FINAL_COVERAGE_FILENAME,
  RETRIEVAL_ROUNDS_DIRNAME,
  ACCUMULATED_POOL_FILENAME,
  STAGE_RETRIEVAL_ROUNDS,
  STAGE_SOURCE_GROUP_SELECTION,
  recordStage,
  beginConvergenceJournal,
  CoverageIntegrationError,
} from './coverage-final-integration.mjs';
import { TARGETED_RESOLUTION_INPUT_STAGING_KEY, TARGETED_RESOLUTION_INPUT_PREFIX, runTargetedSubphase, augmentAccumulatedPool, TARGETED_SUBPHASE_DIRNAME, computePlannedAttemptCount } from './targeted-requery-subphase.mjs';
import { TARGETED_BINDING_PREFIX, LEDGER_CHECKPOINT_KEY, LEDGER_STAGING_KEY, ACTIONS_FILENAME, readAnchoredLedger } from './targeted-requery-lifecycle.mjs';
import { computeTargetedAttemptCounts } from './targeted-requery-attempts.mjs';
import { buildTargetedResearchGapBlock } from './targeted-requery-gap-visibility.mjs';
import { loadResolutionArtifact } from './targeted-requery-resolution.mjs';
import { resolveRoundControllerConfig } from './retrieval-round-controller.mjs';
import { TERMINATION_NONE, TERMINATION_RUN_BUDGET_STOP, TERMINATION_RUN_SATURATED } from './targeted-requery-resolution.mjs';
import { decideTargetedReplay, RESUME_REUSE } from './targeted-requery-lifecycle.mjs';
import { DECISION_PROVIDER_FAILURE } from './retrieval-round-controller.mjs';
import {
  SELECTION_DECISION_FILENAME,
  loadSelectionDecision,
  selectionDecisionStatus,
  applySelectionToCoverageState,
  selectSourceGroups,
  intendedGroupCount,
  DEFAULT_MIN_GROUP_SCORE,
  DEFAULT_AMBIGUITY_MARGIN,
} from './source-group-selection.mjs';
import { loadCoverageState, validateCoverageState } from './coverage-state.mjs';
import { MULTI_GROUP_STATE_FILENAME } from './multi-group-execution.mjs';
import { CAPABILITY_SEARCH, createProviderSeam } from './provider-seam.mjs';
import { createOfficialSearchAdapter } from './official-search-provider.mjs';
import { createGlobalSearchAdapter } from './global-search-provider.mjs';
import { createSessionCaptureAdapter } from './session-capture-provider.mjs';
import { defaultRunner } from './runner.mjs';
import { proposeResearchPlan } from './planner.mjs';
import { loadPlan, persistPlan, PLAN_ARTIFACT_FILENAME } from './plan-contract.mjs';
import {
  makeState,
  readState,
  writeState,
  appendEvent,
  runIdentityHash,
  sha256File,
  configFingerprint,
  STAGE_SEARCH,
  STAGE_SELECT,
  STAGE_CAPTURE,
  STAGE_ANALYZE,
  STAGE_RENDER,
  STAGE_COMPLETE,
  STAGE_FAILED,
} from './state.mjs';
import { createEmbeddingProvider } from './embedding-provider.mjs';
import { REQUIRED_EMBEDDING_IDENTITY } from './dense-geometry.mjs';
import { deriveCanonicalSourceId } from './rce-input-adapter.mjs';
import { assertArtifactSafe } from './rrf.mjs';
import { buildDeepSeekResearchRuntime } from './deepseek-research-runtime.mjs';
import { validateCompleteReuseClosure, CHECKPOINT_BINDING_ACCUMULATED_POOL, CHECKPOINT_BINDING_SELECTION_DECISION, CHECKPOINT_BINDING_COVERAGE_STATE } from './p1-reuse-closure.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RO_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(RO_ROOT, '..');

/** Pinned canonical composition identity (planner-pinned twin; T14 accepts exactly this). */
const CANONICAL_RUNTIME_ID = 'deepseek-api-tool-less';
// OWNER RULING 2026-09-10: authorized request model id (served naming is
// observability only — never an equality gate).
const CANONICAL_MODEL = 'deepseek-v4-pro';

/** T03-documented first-party global_search endpoint (read-only search). */
const GLOBAL_SEARCH_ENDPOINT = 'https://developer.zhihu.com/api/v1/content/global_search';

/** Work-relative artifact names produced/consumed by the composer. */
const PER_GROUP_CLAIMS_FILENAME = 'per-group-claims.json';
const SYNTHESIS_FILENAME = 'cross-source-synthesis.json';
const RESEARCH_RESULT_FILENAME = 'research-result.json';

export const P1_RESULT_TYPE = 'p1-research-result';

/** Composer-level stable failure identities (composition-layer; stage codes pass through). */
const CFC_TOPIC_INVALID = 'user_request_invalid';
const CFC_RUN_IDENTITY_CONFLICT = 'run_identity_conflict';
const CFC_FAILED_STATE_REQUIRES_RESTART = 'failed_state_requires_restart';
const CFC_STATE_INVALID = 'state_invalid';
const CFC_RUNTIME_NOT_SUPPORTED = 'runtime_not_supported';
const CFC_PLANNER_FAILED = 'planner_failed';
const CFC_RETRIEVAL_FAILED = 'retrieval_failed';
const CFC_SELECTION_FAILED = 'selection_failed';
const CFC_GROUP_EXECUTION_FAILED = 'group_execution_failed';
const CFC_DENSE_LAYER_UNAVAILABLE = 'dense_layer_unavailable';
const CFC_ANALYSIS_FAILED = 'analysis_failed';
const CFC_SYNTHESIS_FAILED = 'synthesis_failed';
const CFC_INCOMPLETE_ANALYSIS = 'incomplete_analysis';
const CFC_ABORTED = 'p1_compose_aborted';
const CFC_CLARIFICATION_REQUIRED = 'clarification_required';
const CLARIFICATION_KEY = 'source-group-clarification';
const CLARIFICATION_REQUEST_FILE = 'source-group-clarification-request.json';

function clarificationBinding(state, planHash, decisionHash, selectorVersion, targetedEnabled) {
  return { runId: state.runId, occurrenceId: state.occurrenceId, planHash,
    poolHash: state.hashes[CHECKPOINT_BINDING_ACCUMULATED_POOL],
    coverageHash: state.hashes[CHECKPOINT_BINDING_COVERAGE_STATE], pendingDecisionHash: decisionHash,
    configFingerprint: state.configFingerprint ?? null, selectorVersion,
    selectorMinScore: DEFAULT_MIN_GROUP_SCORE, selectorAmbiguityMargin: DEFAULT_AMBIGUITY_MARGIN,
    targetedSubphaseEnabled: targetedEnabled };
}

function boundClarificationRequest(workDir, state) {
  const inspected = inspectCommittedArtifact({ workDir, key: CLARIFICATION_KEY,
    canonicalRel: CLARIFICATION_REQUEST_FILE, expectedHash: state?.hashes?.[CLARIFICATION_KEY] });
  if (!inspected.absPath) return null;
  try {
    const request = JSON.parse(readFileSync(inspected.absPath, 'utf8'));
    const pending = inspectCommittedArtifact({ workDir, key: CHECKPOINT_BINDING_SELECTION_DECISION,
      canonicalRel: SELECTION_DECISION_FILENAME, expectedHash: request.binding.pendingDecisionHash });
    if (!pending.absPath) return null;
    const decision = JSON.parse(readFileSync(pending.absPath, 'utf8'));
    if (request.schemaVersion !== 1 || request.type !== 'p1-source-group-clarification-request'
      || decision.verdict !== 'ambiguous' || decision.selectorVersion !== request.binding.selectorVersion) return null;
    return request;
  } catch { return null; }
}

// Read-only input admission, BEFORE COMPLETE reuse, planner fallback or any write.
// The checkpoint is still the sole authority; the response cannot grant reuse.
function admitClarification({ workDir, state, runId, response, config, targetedEnabled }) {
  const refused = code => ({ ok: false, code });
  try {
    if (!isPlainObject(response) || Object.keys(response).sort().join(',') !== 'binding,clarification,schemaVersion'
      || response.schemaVersion !== 1 || !isPlainObject(response.binding)
      || !isPlainObject(response.clarification)
      || Object.keys(response.clarification).join(',') !== 'forceGroupIds') return refused('clarification_invalid');
    // Pin caller-owned getters/arrays; the selector remains the identity/selection validator.
    const input = JSON.parse(JSON.stringify(response));
    if (input.schemaVersion !== 1 || Object.keys(input).sort().join(',') !== 'binding,clarification,schemaVersion'
      || !isPlainObject(input.binding) || !isPlainObject(input.clarification)
      || Object.keys(input.clarification).join(',') !== 'forceGroupIds') return refused('clarification_invalid');
    const request = boundClarificationRequest(workDir, state);
    const loaded = loadPlan(workDir);
    if (!request || !loaded.ok || !state || state.runId !== runId || state.stage === STAGE_FAILED
      || request.binding.runId !== state.runId || request.binding.occurrenceId !== state.occurrenceId
      || request.binding.planHash !== loaded.planHash
      || request.binding.configFingerprint !== (configFingerprint(config) ?? null)
      || request.binding.targetedSubphaseEnabled !== targetedEnabled
      || request.binding.selectorMinScore !== DEFAULT_MIN_GROUP_SCORE
      || request.binding.selectorAmbiguityMargin !== DEFAULT_AMBIGUITY_MARGIN
      || Object.keys(input.binding).length !== Object.keys(request.binding).length
      || !Object.keys(request.binding).every(key => input.binding[key] === request.binding[key])) return refused('clarification_stale');
    const reentry = planResumeReentry({ workDir, priorState: state,
      planHash: loaded.planHash, currentConfigFingerprint: configFingerprint(config) });
    if (!reentry.ok || state.hashes[CHECKPOINT_BINDING_ACCUMULATED_POOL] !== request.binding.poolHash)
      return refused('clarification_stale');
    if (reentry.decision) {
      const ids = reentry.decision.clarification?.forcedGroupIds;
      const force = input.clarification.forceGroupIds;
      if (reentry.decision.clarificationCount !== 1 || !Array.isArray(force) || !Array.isArray(ids)
        || force.some(id => typeof id !== 'string') || new Set(force).size !== force.length
        || JSON.stringify([...force].sort()) !== JSON.stringify([...ids].sort())) return refused('clarification_already_resolved');
    } else {
      if (state.stage !== STAGE_SELECT || state.hashes[CHECKPOINT_BINDING_COVERAGE_STATE] !== request.binding.coverageHash
        || state.hashes[CHECKPOINT_BINDING_SELECTION_DECISION] !== request.binding.pendingDecisionHash)
        return refused('clarification_stale');
      const decision = selectSourceGroups(reentry.pool, loaded.plan, { clarification: input.clarification });
      if (decision.verdict !== 'auto') return { ok: false, code: decision.reason,
        clarificationRequired: true, clarificationRequest: request,
        options: request.clarification.options.map(o => o.questionId) };
      if (decision.selectorVersion !== request.binding.selectorVersion) return refused('clarification_stale');
    }
    return { ok: true, input, request };
  } catch { return refused('clarification_invalid'); }
}

/**
 * P1-R02 (#90, Issue #90): derived-state occurrence isolation.
 *
 * The frozen T09 resume authority (multi-group-execution resumeMultiGroupExecution)
 * keys derived research stages on (planHash, selectionIdentity,
 * selectionDecisionHash) — a stable CONTENT identity. That is exactly right for
 * ordinary process-restart resume, but it cannot express that a NEW execution
 * occurrence began: an explicit restart with an identical canonical planHash
 * (same topic re-run) would otherwise silently reuse the PRIOR occurrence's
 * captured/verified group state.
 *
 * The occurrence boundary is drawn here, in the composer (the component that
 * owns occurrence identity), WITHOUT editing the frozen T09/T08 primitives and
 * WITHOUT deleting canonical data: when a new occurrence starts, the prior
 * occurrence's T09 derived state file is ARCHIVED intact (bytes preserved under
 * a fixed `.prior-occurrence.bak` sibling). The T09 resume authority then finds
 * no state and creates a fresh one through its own fail-closed validation
 * (decision planHash binding stays on the canonical planHash — comparable
 * across occurrences). Ordinary same-occurrence resume never archives, so
 * valid plan / group-level reuse is preserved (full cross-stage zero-recompute
 * closure is P1-R06's scope, NOT claimed here).
 */
const PRIOR_OCCURRENCE_ARCHIVE_SUFFIX = '.prior-occurrence.bak';

function archivePriorOccurrenceDerivedState(workDir, occurrenceId) {
  const file = path.join(workDir, MULTI_GROUP_STATE_FILENAME);
  if (!existsSync(file)) return false;
  renameSync(file, path.join(workDir, `${MULTI_GROUP_STATE_FILENAME}${PRIOR_OCCURRENCE_ARCHIVE_SUFFIX}`));
  appendEvent(workDir, { event: 'prior_occurrence_state_archived', occurrenceId, file: MULTI_GROUP_STATE_FILENAME });
  return true;
}

// ---------------------------------------------------------------------------
// P1-R06 (#94) — ordinary interrupted-resume RE-ENTRY BOUNDARY
// ---------------------------------------------------------------------------

/**
 * Re-entry boundary discriminators. `planResumeReentry` returning `ok:false` means
 * "cannot PROVE reusability" — the caller then falls through to re-executing the
 * stage, which is the pre-R06 behaviour and always legal. Only a proven boundary
 * is ever optimised, never assumed.
 */
const RESUME_REENTRY_RETRIEVAL_ROUNDS = 'coverage-state:retrieval-rounds';
const RESUME_REENTRY_SOURCE_GROUP_SELECTION = 'coverage-state:source-group-selection';

/** Read + parse a persisted JSON artifact; never throws, never writes. */
function readPersistedArtifact(workDir, filename) {
  const file = path.join(workDir, filename);
  if (!existsSync(file)) return { ok: false, reason: 'artifact_missing' };
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { ok: false, reason: 'artifact_unreadable' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'artifact_unparseable' };
  }
}

/**
 * Checkpoint-first Staging & Recovery (Issue #94, Round-4 Architecture).
 *
 * Checkpoint is the single source of authority and commit point.
 * Artifact bytes are staged into content-addressed paths before checkpoint commit.
 * Staged bytes earn reuse authority ONLY when referenced by checkpoint hash.
 */
export const COMMIT_STAGING_DIR = '.p1-commit-staging';

export const ARTIFACT_CANONICAL_MATCH = 'CANONICAL_MATCH';
export const ARTIFACT_STAGED_MATCH = 'STAGED_MATCH';
export const ARTIFACT_INVALID = 'INVALID';
export const ARTIFACT_UNBOUND = 'UNBOUND';

export function getStagingPath(workDir, key, sha) {
  return path.join(workDir, COMMIT_STAGING_DIR, key, `${sha}.json`);
}

export function safeFsync(fd, fsyncImpl = fsyncSync) {
  try {
    fsyncImpl(fd);
  } catch (err) {
    if (err.code !== 'EINVAL' && err.code !== 'EPERM' && err.code !== 'EROFS') {
      throw err;
    }
  }
}

// Process-crash recoverable replacement fallback for non-atomic platforms (e.g. Windows EEXIST/EPERM).
// Physical atomic replacement across all OS/filesystems is NOT claimed.
// If a process crash occurs during rmSync -> renameSync, the protocol guarantees fail-safe
// recovery via checkpoint-authorized staging exact-bytes inspection (R9/R10).
function safeRename(temp, target) {
  try {
    renameSync(temp, target);
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'EPERM') {
      rmSync(target, { force: true });
      renameSync(temp, target);
    } else {
      throw err;
    }
  }
}

export function stageArtifactBytes(workDir, key, bytes) {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const target = getStagingPath(workDir, key, sha);
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    try {
      if (sha256File(target) === sha) {
        return { sha, target };
      }
    } catch {
      // re-write
    }
  }
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(temp, 'w');
  try {
    writeFileSync(fd, bytes);
    safeFsync(fd);
  } finally {
    closeSync(fd);
  }
  safeRename(temp, target);
  return { sha, target };
}

export function cleanupStaging(stagedPath) {
  try {
    if (existsSync(stagedPath)) {
      rmSync(stagedPath, { force: true });
    }
  } catch {
    // ignore
  }
}

export function inspectCommittedArtifact({ workDir, key, canonicalRel, expectedHash }) {
  if (typeof expectedHash !== 'string' || expectedHash.length === 0) {
    return { status: ARTIFACT_UNBOUND, reason: 'unbound' };
  }
  const canonicalAbs = path.join(workDir, canonicalRel);
  if (existsSync(canonicalAbs)) {
    try {
      const actual = sha256File(canonicalAbs);
      if (actual === expectedHash) {
        return { status: ARTIFACT_CANONICAL_MATCH, path: canonicalRel, hash: expectedHash, absPath: canonicalAbs };
      }
    } catch {
      // unreadable
    }
  }
  const stagedAbs = getStagingPath(workDir, key, expectedHash);
  if (existsSync(stagedAbs)) {
    try {
      const actual = sha256File(stagedAbs);
      if (actual === expectedHash) {
        return { status: ARTIFACT_STAGED_MATCH, stagedPath: stagedAbs, canonicalRel, hash: expectedHash, absPath: stagedAbs };
      }
    } catch {
      // unreadable
    }
  }
  return { status: ARTIFACT_INVALID, reason: existsSync(canonicalAbs) ? 'content_changed' : 'missing' };
}

/**
 * F.5.1 — resolve the action-ledger bytes a checkpoint anchors, or `null`.
 *
 * Single definition of "read the anchored ledger version", shared by the sub-phase
 * injection and the composition-level budget pre-read. It returns bytes ONLY when a
 * stored artifact (canonical or staged) hashes to exactly the anchored sha256; every
 * other outcome is `null`, which callers must treat as "no authority" rather than
 * falling back to whatever the canonical file currently holds. Keeping one resolver
 * means the two call sites cannot drift into trusting different things.
 */
export function resolveAnchoredLedgerBytes(workDir, sha) {
  const inspect = inspectCommittedArtifact({
    workDir,
    key: LEDGER_STAGING_KEY,
    canonicalRel: ACTIONS_FILENAME,
    expectedHash: sha,
  });
  if (inspect.status !== ARTIFACT_STAGED_MATCH && inspect.status !== ARTIFACT_CANONICAL_MATCH) return null;
  try {
    return readFileSync(inspect.absPath);
  } catch {
    return null;
  }
}

/** Only checkpoint-hash-verified derived T08 input; not a replay decision. */
export function resolveResolutionInputBytes(workDir, targetedActionId, sha) {
  const inspect = inspectCommittedArtifact({
    workDir, key: TARGETED_RESOLUTION_INPUT_STAGING_KEY,
    canonicalRel: path.join('targeted-requery-subphase', `action-${targetedActionId}`, 'resolution-input.json'),
    expectedHash: sha,
  });
  if (inspect.status !== ARTIFACT_STAGED_MATCH && inspect.status !== ARTIFACT_CANONICAL_MATCH) return null;
  try { return readFileSync(inspect.absPath); } catch { return null; }
}

export function materializeStagedArtifact(workDir, stagedPath, canonicalRel) {
  const dest = path.join(workDir, canonicalRel);
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    try {
      if (sha256File(dest) === sha256File(stagedPath)) {
        return;
      }
    } catch {
      // proceed
    }
  }
  const temp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  copyFileSync(stagedPath, temp);
  const fd = openSync(temp, 'r+');
  try {
    safeFsync(fd);
  } finally {
    closeSync(fd);
  }
  safeRename(temp, dest);
}

/**
 * Prove that a stage-boundary artifact on disk is BYTE-IDENTICAL to the artifact
 * this checkpoint recorded when it produced that stage.
 */
function verifyBoundArtifact(workDir, recordedHash, relPath) {
  if (typeof recordedHash !== 'string' || recordedHash.length === 0) return { ok: false, reason: 'unbound' };
  const abs = path.join(workDir, relPath);
  if (!existsSync(abs)) return { ok: false, reason: 'missing' };
  let actual;
  try {
    actual = sha256File(abs);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (actual !== recordedHash) return { ok: false, reason: 'content_changed' };
  return { ok: true, path: relPath };
}

/**
 * Re-record the coverage ledger's content binding so the checkpoint on disk
 * ALWAYS names the ledger bytes that existed when it was written.
 */
function recordLedgerBinding(state, workDir) {
  const abs = path.join(workDir, COVERAGE_STATE_FILENAME);
  if (!existsSync(abs)) return;
  const { sha } = stageArtifactBytes(
    workDir,
    CHECKPOINT_BINDING_COVERAGE_STATE,
    readFileSync(abs),
  );
  state.hashes = {
    ...state.hashes,
    [CHECKPOINT_BINDING_COVERAGE_STATE]: sha,
  };
}

/**
 * Decide the HIGHEST re-entry point for an ordinary (same-occurrence, non-restart)
 * resume of an interrupted run.
 *
 * CONTRACT (Issue #94): "普通中断从适当边界继续；仍有效的已完成阶段 / 无依赖
 * siblings 不重做." A completed stage may be re-entered only when the artifact it
 * produced is PROVABLY the artifact the interrupted run left behind — not merely
 * present, and not merely the same shape.
 *
 * WHY CONTENT BINDING AND NOT RE-DERIVATION. The composition layer owns none of
 * the retrieval-pool / ledger / selection-accounting semantics; T06/T07/T08 do.
 * A ledger CAN be rebuilt by replaying the frozen hooks from the persisted round
 * artifact, but such a replay reproduces only the fields those hooks happen to
 * rewrite and silently diverges on every other field of the state document
 * (diagnostics ratios, per-entry bookkeeping). The resume would then persist a
 * ledger that DIFFERS from the one an uninterrupted run persists for identical
 * logical work — a fidelity defect wearing the costume of an optimisation.
 *
 * So the composer instead RECORDS a content hash of each stage-boundary artifact
 * as it produces it, and a resume only has to prove those bytes are untouched.
 * Nothing is invented, no owner semantics are duplicated, and the proof is
 * strictly stronger: byte identity catches same-count semantic mutation that a
 * shape or count check waves straight through.
 *
 * THE BOUNDARY IS DERIVED FROM THE EVIDENCE, NEVER FROM A STAGE LABEL. Whichever
 * binding verifies decides how far back the resume may start; `state.stage` is
 * never consulted, so a stale or forged stage label cannot widen re-entry:
 *
 *   - composition config fingerprint agrees .... else nothing is reusable
 *   - coverage ledger bound and unchanged ...... the resumed run keeps THE
 *     interrupted run's own state document (see below for why this is the
 *     substrate every downstream boundary consumes)
 *   - T06 pool bound and unchanged ........... retrieval need not be re-run
 *   - + T08 decision bound and unchanged ..... selection need not be re-run
 *   - anything else .......................... fall through and re-execute
 *
 * THE LEDGER IS ITSELF A BOUND ARTIFACT (independent-review P0-2). The persisted
 * `coverage-state.json` is the state document every downstream boundary consumes,
 * so reusing the pool/decision on top of an unproven ledger would compose proven
 * inputs with unproven state. The composer therefore re-records the ledger's
 * content hash at EVERY checkpoint write, and a resume that cannot prove the
 * ledger bytes are the interrupted run's bytes has NO proven re-entry point at
 * all — it falls through to a full re-execution rather than continuing from a
 * state document nobody can vouch for. (Fail closed: redo work, never invent.)
 *
 * OWNER-PERSIST BINDING LAG IS RECOVERED FROM CHECKPOINT-AUTHORIZED STAGING.
 * A stage owner persists the ledger inside its own execution, so a kill before
 * the composer's next checkpoint can leave canonical bytes newer than the last
 * committed binding. Every checkpoint write stages the exact ledger bytes it
 * authorizes, and those bytes are retained while that binding can remain the
 * recovery authority. Resume therefore restores the older authorized ledger
 * instead of consuming the newer uncommitted bytes or repeating retrieval.
 * The rejected write-ahead receipt remains absent: staging earns no authority
 * by itself and is considered only at the hash named by the checkpoint.
 *
 * EVERY CHECK DELEGATES TO ITS OWNER rather than re-implementing it: the persisted
 * ledger is validated and plan-bound by the T07 authority (`loadCoverageState`),
 * the persisted decision is certified reusable by the T08 stale-propagation
 * authority (`selectionDecisionStatus`), and the bindings are the composer's own
 * records of what it wrote.
 *
 * CONFIG IDENTITY IS PART OF THE PROOF (independent-review P0-3). `runIdentityHash`
 * covers only the stable request identity, so the SAME runId can be resumed under
 * a DIFFERENT composition config (rounds, thresholds, budgets) that would produce
 * a different corpus. The COMPLETE reuse gate compares config fingerprints; the
 * resume path does too — a checkpoint recorded under config A is never re-entered
 * by a request made under config B, otherwise the two gates would disagree about
 * what a "dependency of the current request" is.
 *
 * READ-ONLY BY CONSTRUCTION: no write, no network call, and no planner /
 * retrieval / capture / model invocation.
 */
function planResumeReentry({ workDir, priorState, planHash: expectedPlanHash, currentConfigFingerprint = undefined }) {
  if (typeof expectedPlanHash !== 'string' || expectedPlanHash.length === 0) {
    return { ok: false, reason: 'plan_hash_missing' };
  }
  const recorded = priorState?.hashes;
  if (!isPlainObject(recorded)) return { ok: false, reason: 'checkpoint_carries_no_hash_bindings' };

  // Config identity is the OUTERMOST gate (independent-review P0-3): a request
  // made under a different composition config is a different request, so no
  // stage-boundary artifact of the prior occurrence is evidence for it. The
  // COMPLETE reuse gate enforces the same rule, so both gates agree.
  if (currentConfigFingerprint !== undefined) {
    const recordedFp = priorState?.configFingerprint ?? null;
    if (recordedFp !== (currentConfigFingerprint ?? null)) {
      return { ok: false, reason: 'config_fingerprint_mismatch' };
    }
  }

  const materialize = [];

  // The coverage ledger is the substrate every downstream boundary consumes
  // (independent-review P0-2). An unproven ledger means there is NO proven
  // re-entry point: a fresh ledger has no retrieval accounting, so neither the
  // selection boundary nor the retrieval boundary can be entered safely.
  const ledgerInspect = inspectCommittedArtifact({
    workDir,
    key: CHECKPOINT_BINDING_COVERAGE_STATE,
    canonicalRel: COVERAGE_STATE_FILENAME,
    expectedHash: recorded[CHECKPOINT_BINDING_COVERAGE_STATE],
  });
  if (ledgerInspect.status === ARTIFACT_UNBOUND || ledgerInspect.status === ARTIFACT_INVALID) {
    return { ok: false, reason: `coverage_state_${ledgerInspect.reason}` };
  }
  if (ledgerInspect.status === ARTIFACT_STAGED_MATCH) {
    materialize.push({ key: CHECKPOINT_BINDING_COVERAGE_STATE, stagedPath: ledgerInspect.stagedPath, canonicalRel: COVERAGE_STATE_FILENAME });
  }

  // The T06 pool is the artifact that proves retrieval finished AND that any
  // decision below was made from THESE candidates.
  const poolRel = path.join(RETRIEVAL_ROUNDS_DIRNAME, ACCUMULATED_POOL_FILENAME);
  const poolInspect = inspectCommittedArtifact({
    workDir,
    key: CHECKPOINT_BINDING_ACCUMULATED_POOL,
    canonicalRel: poolRel,
    expectedHash: recorded[CHECKPOINT_BINDING_ACCUMULATED_POOL],
  });
  if (poolInspect.status === ARTIFACT_UNBOUND || poolInspect.status === ARTIFACT_INVALID) {
    return { ok: false, reason: `accumulated_pool_${poolInspect.reason}` };
  }
  if (poolInspect.status === ARTIFACT_STAGED_MATCH) {
    materialize.push({ key: CHECKPOINT_BINDING_ACCUMULATED_POOL, stagedPath: poolInspect.stagedPath, canonicalRel: poolRel });
  }

  let pool;
  try {
    pool = JSON.parse(readFileSync(poolInspect.absPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'accumulated_pool_unparseable' };
  }
  if (!isPlainObject(pool) || typeof pool.planHash !== 'string') {
    return { ok: false, reason: 'accumulated_pool_not_a_canonical_t06_pool' };
  }

  // The ledger is read through its OWNER: structure validation and the plan
  // binding are T07 semantics and are never re-implemented here.
  let ledgerState;
  try {
    const raw = readFileSync(ledgerInspect.absPath, 'utf8');
    const parsed = JSON.parse(raw);
    const validation = validateCoverageState(parsed);
    if (!validation.ok) {
      return { ok: false, reason: `ledger_${validation.reason}` };
    }
    if (expectedPlanHash !== null && validation.validated.planHash !== expectedPlanHash) {
      return { ok: false, reason: 'ledger_plan_hash_mismatch' };
    }
    ledgerState = validation.validated;
  } catch {
    return { ok: false, reason: 'ledger_unreadable_or_corrupt' };
  }

  const decisionInspect = inspectCommittedArtifact({
    workDir,
    key: CHECKPOINT_BINDING_SELECTION_DECISION,
    canonicalRel: SELECTION_DECISION_FILENAME,
    expectedHash: recorded[CHECKPOINT_BINDING_SELECTION_DECISION],
  });
  if (decisionInspect.status === ARTIFACT_UNBOUND || decisionInspect.status === ARTIFACT_INVALID) {
    return {
      ok: true,
      boundary: RESUME_REENTRY_RETRIEVAL_ROUNDS,
      decision: null,
      pool,
      coverageState: ledgerState,
      materialize,
      selectionRefusalReason: decisionInspect.reason,
    };
  }
  if (decisionInspect.status === ARTIFACT_STAGED_MATCH) {
    materialize.push({ key: CHECKPOINT_BINDING_SELECTION_DECISION, stagedPath: decisionInspect.stagedPath, canonicalRel: SELECTION_DECISION_FILENAME });
  }

  let decision;
  try {
    decision = JSON.parse(readFileSync(decisionInspect.absPath, 'utf8'));
  } catch {
    return {
      ok: true,
      boundary: RESUME_REENTRY_RETRIEVAL_ROUNDS,
      decision: null,
      pool,
      coverageState: ledgerState,
      materialize,
      selectionRefusalReason: 'selection_decision_unparseable',
    };
  }
  if (!isPlainObject(decision) || decision.type !== 'source-group-selection-decision') {
    return {
      ok: true,
      boundary: RESUME_REENTRY_RETRIEVAL_ROUNDS,
      decision: null,
      pool,
      coverageState: ledgerState,
      materialize,
      selectionRefusalReason: 'selection_decision_invalid',
    };
  }
  const status = selectionDecisionStatus({
    decision,
    currentPlanHash: expectedPlanHash,
    currentPoolPlanHash: pool.planHash,
  });
  if (!status.reusable) {
    return {
      ok: true,
      boundary: RESUME_REENTRY_RETRIEVAL_ROUNDS,
      decision: null,
      pool,
      coverageState: ledgerState,
      materialize,
      selectionRefusalReason: status.reason,
    };
  }
  const selected = Array.isArray(decision.selectedGroups)
    ? decision.selectedGroups
    : null;
  if (selected === null || selected.length === 0) {
    // A decision that selected nothing is not a reusable SELECTION: re-running
    // selection is allowed to reach a different verdict, so this is a refusal.
    return {
      ok: true,
      boundary: RESUME_REENTRY_RETRIEVAL_ROUNDS,
      decision: null,
      pool,
      coverageState: ledgerState,
      materialize,
      selectionRefusalReason: 'selection_no_selected_groups',
    };
  }
  return {
    ok: true,
    boundary: RESUME_REENTRY_SOURCE_GROUP_SELECTION,
    decision,
    pool,
    coverageState: ledgerState,
    materialize,
  };
}

// ---------------------------------------------------------------------------
// global_search sync transport bridge (composition layer's IO concern)
// ---------------------------------------------------------------------------

/**
 * The bridge child resolves the access secret ITSELF (ZHIHU_SECRET env, then
 * the git-ignored zhihu_secret.txt at cwd/repo root — the same resolution the
 * grabber preflight exposes) and never prints it. Only { url, query, count,
 * childModuleUrl } cross the stdin boundary; the parent receives only
 * { status, body }.
 *
 * D3 LIFECYCLE REPAIR (Issue #47, owner ruling 2026-09-10/11): the child
 * core (secret resolution + fetch + { status, body } write + exit intent)
 * lives in lib/global-search-bridge-child.mjs as an exported, injectable
 * function; this -e script is a THIN WRAPPER that sets process.exitCode from
 * the returned intent and lets the process drain naturally. It must NEVER
 * call process.exit() mid-async: on Windows that explicit exit races libuv's
 * async stdin teardown ("Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING), src\win\async.c", exit 0xC0000409), so a fully-written
 * success response was misclassified as a transport failure by the parent's
 * (correct) nonzero-exit validation.
 */
export const GLOBAL_SEARCH_BRIDGE_SCRIPT = `
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    const req = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof req.childModuleUrl !== 'string' || req.childModuleUrl.length === 0) {
      throw new Error('bridge child module url missing');
    }
    const child = await import(req.childModuleUrl);
    const code = await child.runGlobalSearchBridgeChild({ request: req, writer: process.stdout });
    process.exitCode = code === 0 ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
});
`;

/** The composition-layer bridge child lifecycle module (D3 repair, Issue #47). */
const GLOBAL_SEARCH_BRIDGE_CHILD_URL = new URL('./global-search-bridge-child.mjs', import.meta.url).href;

/**
 * Build the production global_search transport: a SYNC IO boundary that runs
 * the authenticated GET through a short-lived node child (async HTTP bridged
 * synchronously; no new dependencies). Throws on transport failure — the
 * adapter maps that to its neutral PROVIDER_TRANSPORT_FAILURE identity.
 */
export function createSyncGlobalSearchTransport({ timeoutMs = 30_000 } = {}) {
  return function transport({ query, count }) {
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', GLOBAL_SEARCH_BRIDGE_SCRIPT], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      input: JSON.stringify({
        url: GLOBAL_SEARCH_ENDPOINT,
        query,
        count,
        secretDirs: [process.cwd(), REPO_ROOT],
        // Test/ops seam ONLY (never credential material): lets an offline
        // test point the wrapper at a stub child module. Defaults to the
        // composition-layer lifecycle module shipped beside this composer.
        childModuleUrl: process.env.ZHIHU_GLOBAL_SEARCH_BRIDGE_CHILD_URL || GLOBAL_SEARCH_BRIDGE_CHILD_URL,
      }),
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (res.error || res.status !== 0 || typeof res.stdout !== 'string') {
      throw new Error(`global_search transport failed (exit ${res.status ?? 'n/a'})`);
    }
    const out = JSON.parse(res.stdout);
    if (typeof out?.status !== 'number' || typeof out?.body !== 'string') {
      throw new Error('global_search transport returned a malformed bridge payload');
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// embedding computation (T11 dense geometry; exact seam-B recipe contract)
// ---------------------------------------------------------------------------

async function computeEmbeddings({ manifest, workDir, provider, fail }) {
  const texts = [];
  const slots = []; // { kind: 'source' | 'target', key } — parallel to texts
  for (const g of manifest.groups) {
    const answersAbs = path.join(workDir, g.answersRel);
    if (!existsSync(answersAbs)) fail(CFC_GROUP_EXECUTION_FAILED, `missing verified artifact ${g.answersRel}`);
    const actual = sha256File(answersAbs);
    if (actual !== g.answersHash) fail(CFC_GROUP_EXECUTION_FAILED, `answersHash mismatch for ${g.answersRel}`);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(answersAbs, 'utf8'));
    } catch {
      fail(CFC_GROUP_EXECUTION_FAILED, `verified artifact unreadable for group ${g.groupId}`);
    }
    for (const entry of parsed.answers ?? []) {
      slots.push({ kind: 'source', key: deriveCanonicalSourceId(g.groupId, entry.id) });
      texts.push(String(entry.excerpt ?? ''));
    }
    const targetText = String(parsed.questionTitle ?? '');
    if (targetText.length === 0) fail(CFC_GROUP_EXECUTION_FAILED, `no questionTitle for group ${g.groupId}`);
    slots.push({ kind: 'target', key: g.groupId });
    texts.push(targetText);
  }

  const pre = await provider.preflight();
  if (!pre.ok) fail(CFC_DENSE_LAYER_UNAVAILABLE, `embedding provider preflight failed (${pre.failureCode ?? 'unknown'})`);
  let vectors;
  try {
    ({ vectors } = await provider.embed(texts));
  } catch {
    fail(CFC_DENSE_LAYER_UNAVAILABLE, 'embedding computation failed');
  }
  const embeddingsBySourceId = {};
  const targetEmbeddingByGroupId = {};
  vectors.forEach((vector, i) => {
    const slot = slots[i];
    const entry = { vector, identity: { ...REQUIRED_EMBEDDING_IDENTITY } };
    if (slot.kind === 'source') embeddingsBySourceId[slot.key] = entry;
    else targetEmbeddingByGroupId[slot.key] = entry;
  });
  for (const slot of slots) {
    if (slot.kind === 'source' && !embeddingsBySourceId[slot.key]) fail(CFC_DENSE_LAYER_UNAVAILABLE, `missing source vector for ${slot.key}`);
    if (slot.kind === 'target' && !targetEmbeddingByGroupId[slot.key]) fail(CFC_DENSE_LAYER_UNAVAILABLE, `missing target vector for ${slot.key}`);
  }
  return { embeddingsBySourceId, targetEmbeddingByGroupId, sourceCount: slots.filter((s) => s.kind === 'source').length };
}

// ---------------------------------------------------------------------------
// the composer
// ---------------------------------------------------------------------------

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Canonical lowercase 64-hex content hash shape (the only binding value shape). */
const HEX64_BINDING = /^[0-9a-f]{64}$/;

/**
 * The `targeted-action:*` bindings carried in a checkpoint's `hashes`.
 *
 * These are the F.5 completion evidence for the targeted sub-phase, and they
 * deliberately live in their own namespace, disjoint from the stage-boundary keys
 * (`targetedBindingKey`). Both the resume boundary and the terminal checkpoint
 * rebuild must preserve them: a checkpoint that drops them silently downgrades
 * "proven committed" back to "no evidence", which is how a paid retrieval ends up
 * re-run. Stage-boundary keys get their own re-entry proof; the targeted namespace
 * gets none, so it is carried by identity and shape-validated.
 */
function targetedBindingsOf(hashes) {
  if (!isPlainObject(hashes)) return {};
  const out = {};
  for (const [key, value] of Object.entries(hashes)) {
    const resolutionInputKey = key.startsWith(TARGETED_RESOLUTION_INPUT_PREFIX)
      && HEX64_BINDING.test(key.slice(TARGETED_RESOLUTION_INPUT_PREFIX.length));
    if ((key.startsWith(TARGETED_BINDING_PREFIX) || resolutionInputKey)
        && typeof value === 'string' && HEX64_BINDING.test(value)) {
      out[key] = value;
    }
  }
  // F.5.1: the action-ledger anchor is in the same trust namespace and must survive a
  // resume boundary and a terminal checkpoint rebuild for the same reason: dropping it
  // silently downgrades "which ledger version is authoritative" to "no authority at all",
  // which is the fail-closed CASE 3b rather than a recoverable state. Carried by exact
  // identity (a single known key) and shape-validated as 64-hex.
  if (typeof hashes[LEDGER_CHECKPOINT_KEY] === 'string' && HEX64_BINDING.test(hashes[LEDGER_CHECKPOINT_KEY])) {
    out[LEDGER_CHECKPOINT_KEY] = hashes[LEDGER_CHECKPOINT_KEY];
  }
  return out;
}

/**
 * F.5.1: staged-artifact keys whose bytes the checkpoint still anchors, and which
 * therefore must survive `cleanupStaging` on the resume materialize path.
 *
 * This is a SET rather than an inline `key !== A && key !== B` chain because the
 * safety property is "never delete bytes a checkpoint anchors", and a set is where
 * that property can be stated once, extended safely, and tested directly instead of
 * by pattern-matching a source line.
 */
const anchoredStagingKeys = new Set([
  CHECKPOINT_BINDING_COVERAGE_STATE,
  LEDGER_STAGING_KEY,
]);

/**
 * Which staged keys must NOT be cleaned on the resume materialize path because the
 * checkpoint still anchors them. Exported so the G3 gate can assert the actual
 * membership rather than pattern-match a source line — a regex on an inline
 * comparison proves the text is present, not that the property holds.
 */
export function stagingKeysAnchoredByCheckpoint() {
  return new Set(anchoredStagingKeys);
}

function sanitizeMessage(message) {
  return String(message ?? '').slice(0, 300);
}

/**
 * Drive the complete P1 Cross-Question Deep Research composition.
 *
 * Returns (never throws for expected outcomes):
 *   { ok: true,  result, runId, planHash, reused?: true }
 *   { ok: false, code, details?, clarificationRequired?, options?, partialDisclosure? }
 */
export async function composeP1Research({
  topic,
  workDir,
  plan: injectedPlan = null,
  runtime = null,
  seam = null,
  captureAdapter = null,
  runner = null,
  embeddingProvider = null,
  fetchImpl = fetch,
  config = undefined,
  usageSink = null,
  restart = false,
  planner = null,
  crashPoint = null,
  targetedSubphase = null,
  clarificationResponse = null,
} = {}) {
  const fail = (code, details = null, extra = {}) => ({ ok: false, code, details: details ? sanitizeMessage(details) : null, ...extra });
  // P1-R02 (#90): planner is injected for tests; production uses the frozen
  // proposeResearchPlan. (Mirrors the existing runtime/seam/capture/runner seams.)
  const propose = typeof planner === 'function' ? planner : proposeResearchPlan;
  // P1-R06 (#94, round-2 review): crash-consistency injection seam. A no-op in
  // production; tests inject a one-shot hook to simulate a SIGKILL at an exact
  // checkpoint-protocol point (e.g. after a stage owner returned but before its
  // checkpoint was adopted — a window no other injected seam can reach, because
  // it contains no injectable component). The hook throwing IS the simulated
  // death: the ordinary failure handling runs, and the test restores the
  // kill-shape stage label — the same discipline as the other seams.
  const crashAt = typeof crashPoint === 'function' ? crashPoint : () => {};

  // 0. input validation (USER_REQUEST class — normal validation, §10.1).
  if (!isNonEmptyString(topic) || topic.trim().length > 2000) {
    return fail(CFC_TOPIC_INVALID, 'topic must be a non-empty string of at most 2000 characters');
  }
  if (!isNonEmptyString(workDir)) {
    return fail(CFC_ABORTED, 'workDir is required');
  }
  const normalizedTopic = topic.trim();

  // Runtime pin: the composition chain (planner/T13/T14) accepts ONLY the
  // approved canonical runtime identity — anything else fails closed.
  const effectiveRuntime = runtime ?? buildDeepSeekResearchRuntime({ fetchImpl });
  if (effectiveRuntime.runtimeId !== CANONICAL_RUNTIME_ID || effectiveRuntime.model !== CANONICAL_MODEL) {
    return fail(CFC_RUNTIME_NOT_SUPPORTED, `P1 composition accepts only ${CANONICAL_RUNTIME_ID}/${CANONICAL_MODEL} — refusing ${String(effectiveRuntime.runtimeId ?? 'unknown')}`);
  }

  const mode = P1_PIPELINE_IDENTITY;
  const runId = runIdentityHash({ topic: normalizedTopic, mode, percent: null, runtime: effectiveRuntime.runtimeId });

  // 1. State bootstrap / resume classification (checkpoint identity validated —
  //    FILE EXISTS != VALID CACHE). restart discards any prior checkpoint and
  //    starts a NEW occurrence (the canonical runner passes --restart for fresh
  //    calls; explicit clarification instead uses the bound request below).
  //    A new occurrence always proposes a fresh plan and never
  //    silently reuses a prior occurrence's plan/derived state.
  const existing = restart ? null : readState(workDir);
  if (clarificationResponse !== null && injectedPlan !== null) return fail('clarification_invalid');
  const clarificationAdmission = clarificationResponse === null ? null
    : restart ? { ok: false, code: 'clarification_stale' }
      : admitClarification({ workDir, state: existing, runId, response: clarificationResponse,
        config, targetedEnabled: targetedSubphase !== null });
  if (clarificationAdmission && !clarificationAdmission.ok) return clarificationAdmission;
  if (clarificationResponse === null && existing?.stage === STAGE_SELECT && existing.hashes?.[CLARIFICATION_KEY]) {
    const request = boundClarificationRequest(workDir, existing);
    const loaded = loadPlan(workDir);
    const proof = loaded.ok ? planResumeReentry({ workDir, priorState: existing,
      planHash: loaded.planHash, currentConfigFingerprint: configFingerprint(config) }) : null;
    if (!request || !proof?.ok || existing.runId !== runId
      || request.binding.occurrenceId !== existing.occurrenceId || request.binding.planHash !== loaded.planHash
      || request.binding.poolHash !== existing.hashes[CHECKPOINT_BINDING_ACCUMULATED_POOL]
      || request.binding.coverageHash !== existing.hashes[CHECKPOINT_BINDING_COVERAGE_STATE]
      || request.binding.pendingDecisionHash !== existing.hashes[CHECKPOINT_BINDING_SELECTION_DECISION]
      || request.binding.targetedSubphaseEnabled !== (targetedSubphase !== null)) return fail('clarification_stale');
    return fail(CFC_CLARIFICATION_REQUIRED, null, { clarificationRequired: true,
      clarificationRequest: request, options: request.clarification.options.map(o => o.questionId) });
  }
  if (existing) {
    if (existing.runId !== runId) {
      return fail(CFC_RUN_IDENTITY_CONFLICT, 'existing state belongs to a different run identity (topic/mode/runtime)');
    }
    if (existing.stage === STAGE_COMPLETE) {
      // P1-R06 (#94): historical COMPLETE != currently reusable COMPLETE.
      //
      // The pre-repair branch checked ONLY the render binding plus the two
      // TERMINAL artifact hashes. That is an end-of-chain existence check, not
      // a dependency closure: deleting or semantically mutating any upstream
      // dependency (plan / selection decision / canonical answers / handoff /
      // T13 claims / T14 synthesis) left the terminal files byte-identical, so
      // a FALSE COMPLETE was silently reused as { ok: true, reused: true }.
      //
      // Validation is now delegated to the composition-level closure validator,
      // which walks the canonical production order and reports the EARLIEST
      // invalid boundary. It is side-effect free: zero network, zero
      // planner/retrieval/capture/T13/T14 model call, zero canonical write, and
      // no hash self-healing — a refusal leaves the work dir byte-identical.
      if (existing.p1FinalCoveragePlanHash == null) {
        return fail(CFC_STATE_INVALID, 'state says COMPLETE but carries no P1 render binding (boundary=plan)');
      }
      let closure;
      try {
        closure = validateCompleteReuseClosure({
          workDir,
          state: existing,
          boundPlanHash: existing.p1FinalCoveragePlanHash,
          currentConfigFingerprint: configFingerprint(config),
        });
      } catch (error) {
        closure = {
          valid: false,
          boundary: 'unreadable',
          detail: `closure validation threw (${sanitizeMessage(error?.code ?? error?.message)})`,
        };
      }
      if (!closure.valid) {
        appendEvent(workDir, {
          event: 'p1_complete_reuse_refused',
          boundary: closure.boundary,
          detail: sanitizeMessage(closure.detail),
        });
        return fail(
          CFC_STATE_INVALID,
          `completed checkpoint is not currently reusable (earliest invalid boundary=${closure.boundary}): ${closure.detail}`,
          { reuseBoundary: closure.boundary },
        );
      }
      // T14: a COMPLETE result also depends on each paid targeted product.
      // Consume F.5's checkpoint-anchored ledger and replay authority; never use
      // the canonical ledger as a second completion credential.
      const targetedKeys = Object.keys(existing.hashes ?? {}).filter(key => key.startsWith(TARGETED_BINDING_PREFIX));
      if (targetedKeys.length > 0 || existing.hashes?.[LEDGER_CHECKPOINT_KEY] !== undefined
        || closure.result.targetedResearchGaps !== undefined) {
        const actions = readAnchoredLedger(existing, sha => resolveAnchoredLedgerBytes(workDir, sha));
        if (actions === null || actions.planHash !== existing.p1FinalCoveragePlanHash
          || actions.occurrenceId !== existing.occurrenceId) {
          return fail(CFC_STATE_INVALID, 'completed targeted action ledger is not checkpoint-bound to this occurrence');
        }
        for (const key of targetedKeys) {
          const action = actions.targetedActions.find(record => record.bindingKey === key);
          if (!action) return fail(CFC_STATE_INVALID, 'completed checkpoint has an orphan targeted binding');
          const identity = Object.fromEntries(['runId', 'occurrenceId', 'planHash', 'gapId', 'attempt', 'normalizedQuery', 'providerScope']
            .map(field => [field, action[field]]));
          const replay = decideTargetedReplay({ workDir, state: existing, artifact: actions, identity });
          if (replay.decision !== RESUME_REUSE) {
            return fail(CFC_STATE_INVALID, `completed targeted product is not reusable: ${replay.reason}`);
          }
        }
        const resolution = loadResolutionArtifact(workDir, existing.p1FinalCoveragePlanHash);
        if (!resolution.ok || resolution.artifact.occurrenceId !== existing.occurrenceId) {
          return fail(CFC_STATE_INVALID, 'completed targeted resolution is unavailable for this occurrence');
        }
        const gapBlock = buildTargetedResearchGapBlock({
          resolutionArtifact: resolution.artifact, actionsArtifact: actions, occurrenceId: existing.occurrenceId,
        });
        // The completion credential is the checkpoint-bound final artifact.
        // A derived resolution may reject reuse; it can never grant completion.
        if (JSON.stringify(gapBlock) !== JSON.stringify(closure.result.targetedResearchGaps)) {
          return fail(CFC_STATE_INVALID, 'completed targeted gap disclosure disagrees with its dependencies');
        }
      }
      // The closure already re-read and re-validated the result artifact; return
      // its parsed value rather than re-reading the file a second time.
      return { ok: true, reused: true, result: closure.result, runId, planHash: existing.p1FinalCoveragePlanHash };
    }
    if (existing.stage === STAGE_FAILED) {
      return fail(CFC_FAILED_STATE_REQUIRES_RESTART, 'previous run failed — restart required (state.stage=FAILED)');
    }
    // else: resume — plan reuse below keeps the run deterministic where reuse
    // is legal (Spec §4.3), and the T09 resume authority reuses still-valid groups.
  }

  // P1-R02 (#90): occurrence identity. An ordinary (non-restart) resume of a
  // still-resumable prior checkpoint CONTINUES the same occurrence (same
  // occurrenceId → plan/group reuse is preserved). Any other path (explicit
  // restart, or no resumable prior state) is a NEW occurrence with a fresh id.
  // The occurrenceId — NOT the stable runId, NOT the stochastic planHash — is
  // what makes a restart a distinct execution (TARGET_CONTRACT: request/config
  // separation from occurrence).
  const isResumingOccurrence = !restart && !!existing
    && existing.runId === runId
    && existing.stage !== STAGE_COMPLETE
    && existing.stage !== STAGE_FAILED;
  const occurrenceId = isResumingOccurrence && typeof existing.occurrenceId === 'string' && existing.occurrenceId.length > 0
    ? existing.occurrenceId
    : randomUUID();

  // P1-R02 (#90): a NEW occurrence must not consume the prior occurrence's
  // derived research stages (T09 state) — archive them intact (bytes preserved)
  // so the frozen T09 resume authority starts fresh for this occurrence.
  if (!isResumingOccurrence) {
    archivePriorOccurrenceDerivedState(workDir, occurrenceId);
  }

  const state = makeState({ workDir, topic: normalizedTopic, mode, percent: null, runtime: effectiveRuntime.runtimeId, occurrenceId, config });
  state.stage = STAGE_SEARCH;
  // P1-R06 repair (independent-review P1-2): a resuming occurrence must NOT
  // replace the durable checkpoint before the re-entry proof has decided what
  // may be reused. The checkpoint's recorded bindings are the ONLY evidence a
  // later process could resume from — persisting the fresh state here (before
  // `planResumeReentry` has even run) destroyed them, so a process killed in
  // that window turned a resumable run into a full redo it never needed. The
  // fresh state is persisted once the proof has run (or was never applicable:
  // a fresh occurrence owns the work dir from the start); failures before that
  // point leave the prior checkpoint byte-identical and still resumable.
  let checkpointAdopted = !isResumingOccurrence;
  if (checkpointAdopted) {
    writeState(workDir, state);
  }
  appendEvent(workDir, { event: 'p1_compose_begin', runId, mode, runtime: effectiveRuntime.runtimeId, occurrenceId, resuming: isResumingOccurrence });

  const persistFailure = (code, details = null, extra = {}) => {
    state.stage = STAGE_FAILED;
    state.p1FinalCoveragePlanHash = null;
    if (checkpointAdopted) {
      writeState(workDir, state);
    }
    appendEvent(workDir, { event: 'p1_compose_failed', code });
    return fail(code, details, extra);
  };

  try {
    // 2. Research Plan (injected for tests; production: reuse a valid persisted
    //    plan, else propose through the pinned planner — never both). The
    //    injected plan is persisted through the same validate-then-write
    //    contract so the plan artifact always exists for identity binding.
    //
    //    P1-R02 (#90) occurrence binding: the plan is reused from disk ONLY when
    //    this is an ORDINARY resume of the SAME occurrence (isResumingOccurrence)
    //    AND the on-disk plan validates. An explicit restart — or any
    //    non-resumable prior state — is a NEW occurrence and ALWAYS re-proposes a
    //    fresh plan; a stale plan left in the work dir by a prior occurrence is
    //    never silently loaded (the stable runId does NOT express a new
    //    execution having occurred). The canonical plan bytes/hash remain
    //    comparable; only the occurrence binding is what isolates executions.
    let plan = injectedPlan;
    let expectedPlanHash = null;
    if (plan) {
      const persisted = persistPlan(workDir, plan);
      if (!persisted.ok) {
        return persistFailure(CFC_PLANNER_FAILED, persisted.reason ?? 'plan_invalid');
      }
      expectedPlanHash = persisted.planHash;
      appendEvent(workDir, { event: 'plan_persisted', planHash: expectedPlanHash, occurrenceId });
    } else if (isResumingOccurrence) {
      const loaded = loadPlan(workDir);
      if (loaded.ok) {
        plan = loaded.plan;
        expectedPlanHash = loaded.planHash;
        appendEvent(workDir, { event: 'plan_reused', planHash: expectedPlanHash, occurrenceId });
      } else {
        const proposed = await propose({ userRequest: normalizedTopic, workDir, fetchImpl, usageSink });
        if (!proposed.ok) {
          return persistFailure(CFC_PLANNER_FAILED, proposed.details ?? proposed.reason, { plannerReason: proposed.reason ?? null });
        }
        // Persist the proposed plan through the same validate-then-write
        // contract (idempotent when the production planner already wrote it;
        // required when an injected planner seam returns without writing) so
        // the on-disk plan artifact always matches the executed plan.
        const persisted = persistPlan(workDir, proposed.plan);
        if (!persisted.ok) {
          return persistFailure(CFC_PLANNER_FAILED, persisted.reason ?? 'plan_invalid');
        }
        plan = proposed.plan;
        expectedPlanHash = persisted.planHash;
        appendEvent(workDir, { event: 'plan_proposed', planHash: expectedPlanHash, occurrenceId });
      }
    } else {
      const proposed = await propose({ userRequest: normalizedTopic, workDir, fetchImpl, usageSink });
      if (!proposed.ok) {
        return persistFailure(CFC_PLANNER_FAILED, proposed.details ?? proposed.reason, { plannerReason: proposed.reason ?? null });
      }
      const persisted = persistPlan(workDir, proposed.plan);
      if (!persisted.ok) {
        return persistFailure(CFC_PLANNER_FAILED, persisted.reason ?? 'plan_invalid');
      }
      plan = proposed.plan;
      expectedPlanHash = persisted.planHash;
      appendEvent(workDir, { event: 'plan_proposed', planHash: expectedPlanHash, occurrenceId, restart: restart === true });
    }

    // 3. Provider seam (official zhihu_search + global_search — NO substitution).
    const effectiveRunner = runner ?? defaultRunner();
    const effectiveSeam = seam ?? createProviderSeam({
      adapters: [
        createOfficialSearchAdapter({ runner: effectiveRunner }),
        createGlobalSearchAdapter({ transport: createSyncGlobalSearchTransport() }),
      ],
    });
    const plannedRoutes = effectiveSeam.listProviders()
      .filter((p) => p.capability === CAPABILITY_SEARCH)
      .map((p) => ({ providerId: p.providerId, capability: p.capability }));

    // 4. Stage chain — the frozen composition owner, canonical single-pass order.
    //
    // P1-R06 (#94): `beginResearchCoverageLedger` creates AND PERSISTS an EMPTY
    // ledger, so on an ordinary resume it would both destroy the persisted state
    // and force retrieval + selection to re-run even when their artifacts are
    // still valid. Plan the re-entry boundary from the PERSISTED checkpoint
    // FIRST (read-only), and only begin a fresh ledger when no boundary is proven.
    // `remote truth > assumption`: only a proven boundary is ever optimised.
    const reentry = isResumingOccurrence
      ? planResumeReentry({
        workDir,
        priorState: existing,
        planHash: expectedPlanHash,
        currentConfigFingerprint: configFingerprint(config),
      })
      : { ok: false, reason: 'not_resuming' };
    // The re-entry proof has now been made (or was never applicable). From here
    // the composer owns the checkpoint and may persist its own state; a failure
    // after this point marks the CURRENT occurrence FAILED, while a failure
    // before it left the prior checkpoint intact and resumable (P1-2).
    checkpointAdopted = true;

    // The targeted sub-phase's completion evidence lives in the PRIOR checkpoint's
    // `targeted-action:*` bindings (F.5: the checkpoint is the only trust root).
    // `makeState` starts from empty `hashes`, so without carrying these across the
    // resume boundary `decideTargetedReplay` could never see a binding and F.5's
    // REUSE branch would be unreachable on every production resume — a paid
    // retrieval would be re-run and the round pool re-read WITHOUT its hash check.
    // Only the targeted namespace is adopted here; stage bindings keep their own
    // re-entry proof (`planResumeReentry`) and are never inherited by assumption.
    if (isResumingOccurrence) {
      Object.assign(state.hashes, targetedBindingsOf(existing?.hashes));
      if (existing.hashes?.[CLARIFICATION_KEY]) state.hashes[CLARIFICATION_KEY] = existing.hashes[CLARIFICATION_KEY];
    }

    let coverageState;
    let journal;
    if (reentry.ok) {
      if (Array.isArray(reentry.materialize) && reentry.materialize.length > 0) {
        for (const item of reentry.materialize) {
          materializeStagedArtifact(workDir, item.stagedPath, item.canonicalRel);
          // F.5.1: a staged artifact must survive cleanup whenever the checkpoint
          // still anchors its exact sha256. Two keys qualify:
          //   · the coverage ledger — every boundary reads it;
          //   · the targeted action ledger — the sole authority for dedupe / lifecycle /
          //     completion. Deleting its staged copy while the checkpoint anchors that
          //     hash would destroy the only recoverable bytes and force the CASE 3b
          //     fail-closed path on the next resume.
          // `planResumeReentry` currently enumerates only the three stage-boundary
          // keys, so the ledger key is a no-op TODAY; it is kept because that set is
          // owned by the reuse-closure module and may grow, and the failure it prevents
          // is silent and permanent (every later resume fails closed) rather than loud.
          // G3 pins the real property: no cleanup may remove bytes the checkpoint anchors.
          // The request still depends on the original pending bytes after the
          // canonical decision is replaced by a successful resolution.
          const pendingClarificationBytes = clarificationAdmission
            && item.key === CHECKPOINT_BINDING_SELECTION_DECISION
            && item.stagedPath === getStagingPath(workDir, item.key,
              clarificationAdmission.request.binding.pendingDecisionHash);
          if (!anchoredStagingKeys.has(item.key) && !pendingClarificationBytes) cleanupStaging(item.stagedPath);
        }
      }
      // Continue the PERSISTED ledger: it is already validated and plan-bound by
      // its owner (`loadCoverageState`), and it is used verbatim. The ledger is
      // deliberately NOT re-created here, because that would overwrite the very
      // state this branch just certified reusable.
      coverageState = reentry.coverageState;
      journal = beginConvergenceJournal();
      appendEvent(workDir, {
        event: 'coverage_ledger_resume', planHash: expectedPlanHash, boundary: reentry.boundary, occurrenceId,
      });
    } else {
      const started = beginResearchCoverageLedger({ plan, planHash: expectedPlanHash, workDir, plannedRoutes });
      coverageState = started.coverageState;
      ({ journal } = started);
    }

    let boundary;
    let pool = null;
    if (reentry.ok) {
      // Retrieval was SKIPPED, so its canonical stage must still be journaled —
      // the single-pass acyclic order is a journal invariant every downstream
      // stage asserts, not an accident of which calls happened to run.
      recordStage(journal, STAGE_RETRIEVAL_ROUNDS);
      boundary = reentry.boundary;
      pool = reentry.pool;
      appendEvent(workDir, {
        event: 'resume_reentry',
        boundary,
        occurrenceId,
        reusedRetrieval: true,
        reusedSelection: reentry.decision !== null,
        selectionRefusalReason: reentry.selectionRefusalReason ?? null,
      });
    } else {
      state.stage = STAGE_SEARCH;
      recordLedgerBinding(state, workDir);
      writeState(workDir, state);

      // ---------------------------------------------------------------------
      // F.6 / F.6.1 — the targeted half of the global attempt budget, for the
      // BUDGET_STOP denominator of the frozen round loop.
      //
      // The loop starts with the targeted attempts already recorded in the
      // CHECKPOINT-ANCHORED ledger of the prior occurrence state (F.5.1): an
      // action paid for earlier but whose commit point was never reached is
      // precisely a payment the budget must still account for. Deriving them from
      // the anchored version — never the raw canonical file, which after a crash
      // can hold a NEWER unproven version — is what keeps this read inside the
      // single trust root (P1-R06).
      //
      // Absent an anchor there is no authority for any targeted count, so the
      // input stays `null` and the controller keeps its verbatim historical
      // `attemptsBudgetCount`. That is the default-zero path, not a fallback.
      // ---------------------------------------------------------------------
      const anchoredPriorLedger = readAnchoredLedger(state, (sha) => resolveAnchoredLedgerBytes(workDir, sha));
      const priorTargetedAttempts = anchoredPriorLedger === null
        ? null
        : computeTargetedAttemptCounts({ actions: anchoredPriorLedger.targetedActions });

      let targeted = null;
      const invokeTargeted = (liveCoverage, livePool, executionAllowed, runTerminationReason = TERMINATION_NONE) => {
        const targetedBudget = targetedSubphase.maxQueryBudget;
        targeted = runTargetedSubphase({
          ...targetedSubphase,
          workDir,
          plan,
          planHash: expectedPlanHash,
          runId,
          occurrenceId,
          seam: effectiveSeam,
          channels: plannedRoutes.map((r) => ({ providerId: r.providerId })),
          plannedRoutes,
          accumulatedPool: livePool,
          state,
          crashAt,
          // F.5.1 — the composition layer owns the content-addressed staging directory and
          // injects the ledger and resolution-input staging primitives. Injection rather than a direct
          // import is forced by the module graph (composer -> subphase -> lifecycle): the
          // lifecycle must not import this module back, or the cycle would make the trust
          // decision and the byte-movement mutually dependent.
          stageLedgerBytes: (bytes) => stageArtifactBytes(workDir, LEDGER_STAGING_KEY, bytes).sha,
          resolveAnchoredBytes: (sha) => resolveAnchoredLedgerBytes(workDir, sha),
          stageResolutionInputBytes: (actionId, bytes) => stageArtifactBytes(workDir, TARGETED_RESOLUTION_INPUT_STAGING_KEY, bytes).sha,
          resolveResolutionInputBytes: (actionId, sha) => resolveResolutionInputBytes(workDir, actionId, sha),
          // F.6 / E.5(7): the PLANNED half of the global budget denominator, read from
          // the live coverage snapshot in the current planned CONTINUE window.
          // Without it the authorization preflight would see only the targeted half
          // and could authorize work the global budget cannot pay for.
          plannedAttemptsBudgetCount: computePlannedAttemptCount(liveCoverage),
          // Invalid policy reaches the original strict gate without numeric coercion.
          maxQueryBudget: Number.isInteger(targetedBudget) && targetedBudget > 0
            ? Math.min(targetedBudget, resolveRoundControllerConfig(config).maxQueryBudget) : targetedBudget,
          executionAllowed,
          runTerminationReason,
        });
        if (targeted.state !== null) state.hashes = targeted.state.hashes;
        appendEvent(workDir, { event: 'targeted_subphase', status: targeted.status,
          gapsDiagnosed: targeted.gaps.length, executed: targeted.counts.executed, failed: targeted.counts.failed });
        return targeted;
      };

      const loop = runRetrievalFeedbackLoop({
        coverageState, plan, planHash: expectedPlanHash, workDir,
        seam: effectiveSeam,
        // Explicit deterministic routes: every registered search channel, in
        // registry order — the same list recorded as plannedRoutes in the ledger.
        channels: plannedRoutes.map((r) => ({ providerId: r.providerId })),
        config, journal,
        // F.6.1: additive; the controller adds this to the planned half it derives
        // from `coverageState.retrieval`, giving the contract's four-term sum.
        targetedAttempts: priorTargetedAttempts,
        targetedOnContinue: targetedSubphase === null ? null : ({ coverageState: liveCoverage, pool: livePool }) =>
          invokeTargeted(liveCoverage, livePool, true),
      });
      if (loop.pool === null || loop.decision === DECISION_PROVIDER_FAILURE) {
        return persistFailure(CFC_RETRIEVAL_FAILED, `retrieval ended without a candidate pool (decision=${String(loop.decision)}, stopReason=${String(loop.stopReason)})`);
      }
      coverageState = loop.coverageState;
      boundary = RESUME_REENTRY_RETRIEVAL_ROUNDS;
      pool = loop.pool;

      // ---------------------------------------------------------------------
      // P2A-T09 (#121) — targeted sub-phase.
      //
      // POSITION IS THE CONTRACT: this runs INSIDE STAGE_SEARCH and strictly
      // BEFORE `applySourceGroupSelection` below. It journals NO new stage (the
      // convergence journal's single-pass acyclic order is untouched).
      //
      // DISABLED BY DEFAULT: `targetedSubphase === null` (the default) makes this
      // block a no-op, so the #108-off composition path is byte-identical to the
      // historical one. When enabled, the sub-phase is the single writer of the
      // augmented accumulated pool (merged through the SAME RRF/canonical identity
      // and re-walked by `assertArtifactSafe`), and every downstream stage consumes
      // the larger pool with ZERO change.
      //
      // The only retrieval route it may use is T02's additive
      // `runMultiQueryRetrieval({..., targetedQueries})` seam (no second pipeline).
      // ---------------------------------------------------------------------
      if (targetedSubphase !== null) {
        if (targeted === null) invokeTargeted(coverageState, pool, false,
          loop.decision === 'BUDGET_STOP' ? TERMINATION_RUN_BUDGET_STOP : TERMINATION_RUN_SATURATED);
        pool = augmentAccumulatedPool({ workDir, plan, expectedPlanHash,
          accumulatedPool: pool, targetedPools: [targeted.pool] });
      }

      // Crash-consistency seam: the T06 loop has returned
      // with the FINAL pool durably persisted; a kill here — before the
      // composer's accumulatedPool binding checkpoint — is the pool binding-lag
      // window (reviewer's R9).
      crashAt('after_retrieval_loop');

      // Checkpoint-first staging: stage exact bytes before checkpoint commit
      const poolRel = path.join(RETRIEVAL_ROUNDS_DIRNAME, ACCUMULATED_POOL_FILENAME);
      const poolBytes = readFileSync(path.join(workDir, poolRel));
      stageArtifactBytes(workDir, CHECKPOINT_BINDING_ACCUMULATED_POOL, poolBytes);

      const ledgerBytes = readFileSync(path.join(workDir, COVERAGE_STATE_FILENAME));
      stageArtifactBytes(workDir, CHECKPOINT_BINDING_COVERAGE_STATE, ledgerBytes);

      crashAt('after_retrieval_precommit');

      // Same event, live payload: the boundary this run STARTED at, with the reuse
      // flags false. Recording both cases in one event keeps a single auditable
      // answer to "from where did this run begin, and what did it reuse?" — plus
      // the exact reason the persisted bindings were refused, so a resume that
      // fell back to a full re-execution is auditable too (contract: earliest
      // invalid boundary, audibly, on BOTH reuse gates).
      appendEvent(workDir, {
        event: 'resume_reentry', boundary, occurrenceId,
        reusedRetrieval: false, reusedSelection: false,
        reentryRefusalReason: reentry.reason ?? null,
      });
    }

    // The T06 pool is FINAL at this point — either just produced by the loop, or
    // proven byte-unchanged by the binding above. Recording its content hash here
    // is exactly what lets a LATER resume skip retrieval.
    const poolRel = path.join(RETRIEVAL_ROUNDS_DIRNAME, ACCUMULATED_POOL_FILENAME);
    state.hashes = {
      ...state.hashes,
      [CHECKPOINT_BINDING_ACCUMULATED_POOL]: pool
        ? sha256File(path.join(workDir, poolRel))
        : state.hashes[CHECKPOINT_BINDING_ACCUMULATED_POOL],
      // P1-R06 repair (round-2 review P1-1): a successful re-entry proof has
      // just CERTIFIED the persisted decision (byte-identity against the prior
      // checkpoint's binding, plus T08's own status authority). The FIRST
      // checkpoint this occurrence writes must already carry that binding:
      // spreading a fresh state.hashes without it let the STAGE_SELECT
      // checkpoint temporarily DOWNGRADE proven durable evidence, and a kill
      // inside that window forced the next resume to redo a selection that was
      // already proven reusable. The binding is re-recorded from the very bytes
      // the proof just certified — identical to the prior binding by that
      // proof, and never stale. No checkpoint write may downgrade evidence.
      ...(reentry.decision
        ? { [CHECKPOINT_BINDING_SELECTION_DECISION]: sha256File(path.join(workDir, SELECTION_DECISION_FILENAME)) }
        : clarificationAdmission
          ? { [CHECKPOINT_BINDING_SELECTION_DECISION]: clarificationAdmission.request.binding.pendingDecisionHash }
          : {}),
    };
    state.stage = STAGE_SELECT;
    recordLedgerBinding(state, workDir);
    writeState(workDir, state);
    // Crash-consistency seam: checkpoint committed, before canonical materialize
    crashAt('after_retrieval_checkpoint_before_materialize');
    crashAt('after_select_checkpoint');

    // Materialize canonical files from staging and cleanup staging
    if (pool) {
      const stagedPool = getStagingPath(workDir, CHECKPOINT_BINDING_ACCUMULATED_POOL, state.hashes[CHECKPOINT_BINDING_ACCUMULATED_POOL]);
      if (existsSync(stagedPool)) {
        materializeStagedArtifact(workDir, stagedPool, poolRel);
        cleanupStaging(stagedPool);
      }
    }
    const stagedLedger = getStagingPath(workDir, CHECKPOINT_BINDING_COVERAGE_STATE, state.hashes[CHECKPOINT_BINDING_COVERAGE_STATE]);
    if (existsSync(stagedLedger)) {
      materializeStagedArtifact(workDir, stagedLedger, COVERAGE_STATE_FILENAME);
    }

    let selection = null;
    if (boundary === RESUME_REENTRY_SOURCE_GROUP_SELECTION) {
      // The frozen T08 authority already certified this decision reusable against
      // the CURRENT planHash and the pool this run is bound to, and its bytes are
      // provably unchanged. Delegation, not judgement: T08's own
      // stale-propagation authority is the only thing that may declare a decision
      // reusable, and the persisted decision is applied to the persisted ledger
      // exactly as the live path would have.
      //
      // The persisted ledger is the RETRIEVAL-time ledger: `applySourceGroupSelection`
      // updates the T08 fusion accounting only IN MEMORY, and the group stage is what
      // persists it. So re-entering at the selection boundary has to perform that same
      // in-memory step — otherwise the resumed run would carry a ledger the live run
      // never had, and T14's `selected_source_group_count <= fusedGroupCount`
      // invariant would fail closed on it. This is the frozen T08 hook deriving the
      // accounting from the frozen T08 decision, not a locally invented counter, and
      // it is idempotent because the hook SETS both counters from the decision.
      coverageState = applySelectionToCoverageState(coverageState, reentry.decision);
      recordStage(journal, STAGE_SOURCE_GROUP_SELECTION);
      appendEvent(workDir, {
        event: 'source_group_selection',
        verdict: reentry.decision.verdict,
        selectedGroupCount: reentry.decision.selectedGroupCount,
        candidateGroupCount: reentry.decision.candidates.length,
        reused: true,
      });
      selection = { ok: true, coverageState, decision: reentry.decision };
    }

    if (selection === null) {
      selection = applySourceGroupSelection({ coverageState, pool, plan, workDir, journal,
        clarification: clarificationAdmission?.input.clarification ?? null });
      if (selection.clarificationRequired) {
        let request;
        try {
          const decisionBytes = readFileSync(path.join(workDir, SELECTION_DECISION_FILENAME));
          const decisionStage = stageArtifactBytes(workDir, CHECKPOINT_BINDING_SELECTION_DECISION, decisionBytes);
          const requiredGroupIds = [...new Set(plan.sourceGroupIntents.map(i => i.groupKey).filter(Boolean))];
          request = { schemaVersion: 1, type: 'p1-source-group-clarification-request',
            binding: clarificationBinding(state, expectedPlanHash, decisionStage.sha,
              selection.decision.selectorVersion, targetedSubphase !== null),
            clarification: selection.decision.clarification, requiredGroupIds,
            remainingSlots: Math.max(0, intendedGroupCount(plan) - requiredGroupIds.length) };
          const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`);
          const requestStage = stageArtifactBytes(workDir, CLARIFICATION_KEY, requestBytes);
          state.hashes[CHECKPOINT_BINDING_SELECTION_DECISION] = decisionStage.sha;
          state.hashes[CLARIFICATION_KEY] = requestStage.sha;
          writeState(workDir, state);
          materializeStagedArtifact(workDir, getStagingPath(workDir, CLARIFICATION_KEY, requestStage.sha), CLARIFICATION_REQUEST_FILE);
        } catch { return fail('clarification_persistence_failed', 'clarification request could not be committed'); }
        appendEvent(workDir, {
          event: 'clarification_required', stage: STAGE_SELECT,
          options: (selection.decision?.clarification?.options ?? []).map((o) => o.questionId),
        });
        appendEvent(workDir, { event: 'stop', reason: 'clarification_required' });
        return fail(CFC_CLARIFICATION_REQUIRED, null, {
          clarificationRequired: true,
          clarificationRequest: request,
          options: (selection.decision?.clarification?.options ?? []).map((o) => o.questionId),
        });
      }
      if (!selection.ok) {
        return persistFailure(CFC_SELECTION_FAILED, selection.code, { selectionReason: selection.code ?? null });
      }

      // Checkpoint-first staging: stage exact bytes before checkpoint commit
      const decisionBytes = readFileSync(path.join(workDir, SELECTION_DECISION_FILENAME));
      stageArtifactBytes(workDir, CHECKPOINT_BINDING_SELECTION_DECISION, decisionBytes);

      const selLedgerBytes = readFileSync(path.join(workDir, COVERAGE_STATE_FILENAME));
      stageArtifactBytes(workDir, CHECKPOINT_BINDING_COVERAGE_STATE, selLedgerBytes);

      crashAt('after_selection_precommit');
    }
    coverageState = selection.coverageState;
    if (clarificationAdmission) appendEvent(workDir, { event: 'clarification_supplied', occurrenceId,
      requestHash: state.hashes[CLARIFICATION_KEY], selectionResumed: true });
    // Crash-consistency seam (round-3 review P1): the T08 selection call has
    // returned with the decision durably persisted; a kill here — before the
    // composer's selectionDecision binding — is the decision binding-lag
    // window (reviewer's R10).
    crashAt('after_selection');

    // The T08 decision is FINAL here; bind it so a later resume can skip selection.
    state.hashes = {
      ...state.hashes,
      [CHECKPOINT_BINDING_SELECTION_DECISION]: sha256File(path.join(workDir, SELECTION_DECISION_FILENAME)),
    };

    state.stage = STAGE_CAPTURE;
    recordLedgerBinding(state, workDir);
    writeState(workDir, state);
    // Crash-consistency seam: checkpoint committed, before canonical materialize
    crashAt('after_selection_checkpoint_before_materialize');

    // Materialize canonical files from staging and cleanup staging
    const stagedDecision = getStagingPath(workDir, CHECKPOINT_BINDING_SELECTION_DECISION, state.hashes[CHECKPOINT_BINDING_SELECTION_DECISION]);
    if (existsSync(stagedDecision)) {
      materializeStagedArtifact(workDir, stagedDecision, SELECTION_DECISION_FILENAME);
      cleanupStaging(stagedDecision);
    }
    const stagedSelLedger = getStagingPath(workDir, CHECKPOINT_BINDING_COVERAGE_STATE, state.hashes[CHECKPOINT_BINDING_COVERAGE_STATE]);
    if (existsSync(stagedSelLedger)) {
      materializeStagedArtifact(workDir, stagedSelLedger, COVERAGE_STATE_FILENAME);
    }

    const execution = executeSelectedGroups({
      coverageState, decision: selection.decision, planHash: expectedPlanHash, workDir,
      captureAdapter: captureAdapter ?? createSessionCaptureAdapter({ runner: effectiveRunner }),
      runner: effectiveRunner, journal,
    });
    coverageState = execution.coverageState;

    state.stage = STAGE_ANALYZE;
    recordLedgerBinding(state, workDir);
    writeState(workDir, state);

    // 5. Dense geometry (T11) — fail-closed when the local provider is unavailable.
    const embeddings = await computeEmbeddings({
      manifest: execution.manifest, workDir,
      provider: embeddingProvider ?? createEmbeddingProvider({
        modelDir: process.env.P1_T10_ONNX_MODEL_DIR ?? path.join(RO_ROOT, 'models-bge-base-zh-v1.5'),
      }),
      fail: (code, details) => { throw new CoverageIntegrationError(code, details ?? code); },
    });

    const corpus = selectResearchCorpusWithCoverage({
      coverageState, manifest: execution.manifest, workDir,
      embeddingsBySourceId: embeddings.embeddingsBySourceId,
      targetEmbeddingByGroupId: embeddings.targetEmbeddingByGroupId,
      journal,
    });
    coverageState = corpus.coverageState;
    // Crash-consistency seam (round-2 review P1-2): the T12 owner has just
    // persisted its final ledger and RETURNED; a kill here — before the
    // composer's next checkpoint — is the disclosed binding-lag window.
    crashAt('after_corpus_selection');
    // The ledger owner persists the coverage state INSIDE each stage, so a kill
    // between two checkpoint writes would leave the on-disk ledger NEWER than
    // the recorded binding and a resume could no longer prove the ledger bytes.
    // Refresh the checkpoint at every stage boundary so the binding names the
    // ledger bytes the run actually left behind (independent-review P0-2).
    state.stage = STAGE_ANALYZE;
    recordLedgerBinding(state, workDir);
    writeState(workDir, state);

    const analysis = await analyzeSelectedCorpus({
      coverageState, corpusArtifact: corpus.corpusArtifact, manifest: execution.manifest,
      planHash: expectedPlanHash, runtime: effectiveRuntime, workDir, journal,
    });
    coverageState = analysis.coverageState;
    writeArtifact(workDir, PER_GROUP_CLAIMS_FILENAME, analysis.seamCArtifact);
    state.stage = STAGE_ANALYZE;
    recordLedgerBinding(state, workDir);
    writeState(workDir, state);

    const synthesis = await produceSynthesisWithCoverage({
      coverageState, seamCArtifact: analysis.seamCArtifact, runtime: effectiveRuntime, workDir, journal,
    });
    coverageState = synthesis.coverageState;
    writeArtifact(workDir, SYNTHESIS_FILENAME, synthesis.synthesisArtifact);

    state.stage = STAGE_RENDER;
    recordLedgerBinding(state, workDir);
    writeState(workDir, state);

    // T14 closes S10 at the real final-artifact owner. The action version
    // comes from the checkpoint; T10 consumes T08 terminals without judging them.
    let targetedResearchGaps = null;
    if (targetedSubphase !== null) {
      const resolution = loadResolutionArtifact(workDir, expectedPlanHash);
      const actions = readAnchoredLedger(state, sha => resolveAnchoredLedgerBytes(workDir, sha));
      if (!resolution.ok || actions === null) {
        return persistFailure(CFC_STATE_INVALID, 'targeted gap artifacts are unavailable for final visibility');
      }
      targetedResearchGaps = buildTargetedResearchGapBlock({
        resolutionArtifact: resolution.artifact, actionsArtifact: actions, occurrenceId,
      });
    }

    // 6. FINAL reconciliation (T15; second independent defense) — 100% ONLY via
    //    mechanical set equality; partial refuses completion.
    const fin = finalizeResearchCoverage({
      coverageState, synthesisArtifact: synthesis.synthesisArtifact, workDir, journal,
      requireFullCoverage: true,
      runtimeIdentity: { runtimeId: effectiveRuntime.runtimeId, model: effectiveRuntime.model },
      synthesisArtifactRef: SYNTHESIS_FILENAME,
      targetedResearchGaps,
    });
    if (!fin.ok) {
      const result = {
        schemaVersion: 1,
        type: P1_RESULT_TYPE,
        ok: false,
        topic: normalizedTopic,
        mode,
        runId,
        planHash: expectedPlanHash,
        runtime: { runtimeId: effectiveRuntime.runtimeId, model: effectiveRuntime.model },
        disclosure: fin.partialDisclosure,
        verification: { valid: false, basis: { t15FinalReconciliation: 'REFUSED_INCOMPLETE' } },
        error: { code: CFC_INCOMPLETE_ANALYSIS, message: 'P1 analysis coverage is not 100% — partial state is never complete' },
      };
      writeResult(workDir, result);
      return persistFailure(CFC_INCOMPLETE_ANALYSIS, 'analysis coverage is not 100%', { partialDisclosure: fin.partialDisclosure });
    }

    // 7. Result artifact + render binding (written ONLY here, ONLY on success).
    const groups = Object.values(execution.multiGroupState.groups);
    const verifiedCount = groups.filter((g) => g.handoffValid === true).length;
    const result = {
      schemaVersion: 1,
      type: P1_RESULT_TYPE,
      ok: true,
      topic: normalizedTopic,
      mode,
      runId,
      planHash: expectedPlanHash,
      runtime: { runtimeId: effectiveRuntime.runtimeId, model: effectiveRuntime.model },
      disclosure: buildFinalDisclosure({ artifact: fin.artifact }),
      ...(targetedResearchGaps === null ? {} : { targetedResearchGaps }),
      verification: {
        valid: true,
        basis: {
          t14PreSynthesisGuard: 'PASS',
          t15FinalReconciliation: 'PASS',
          groupsVerified: `${verifiedCount}/${groups.length}`,
          analysisCoverage: {
            selectedCount: fin.artifact.coverage.analysisCoverage.selectedCount,
            mappedCount: fin.artifact.coverage.analysisCoverage.mappedCount,
            analyzedCount: fin.artifact.coverage.analysisCoverage.analyzedCount,
          },
        },
      },
      artifacts: {
        researchPlan: PLAN_ARTIFACT_FILENAME,
        selectionDecision: SELECTION_DECISION_FILENAME,
        coverageState: COVERAGE_STATE_FILENAME,
        coverageFinal: FINAL_COVERAGE_FILENAME,
        perGroupClaims: PER_GROUP_CLAIMS_FILENAME,
        synthesis: SYNTHESIS_FILENAME,
        researchResult: RESEARCH_RESULT_FILENAME,
      },
      ...(Array.isArray(usageSink) ? { usage: usageSink } : {}),
    };
    writeResult(workDir, result);

    state.stage = STAGE_COMPLETE;
    state.completedStages = [STAGE_SEARCH, STAGE_SELECT, STAGE_CAPTURE, STAGE_ANALYZE, STAGE_RENDER];
    state.p1FinalCoveragePlanHash = expectedPlanHash;
    state.artifacts = { ...result.artifacts };
    // P1-R06 (#94): record the FULL content-binding set, not just the two
    // terminal artifacts. The reuse closure re-reads every one of these and
    // refuses reuse when any mid-chain artifact drifted — including a
    // SAME-COUNT semantic mutation that only a content hash can detect.
    //
    // The STAGE-BOUNDARY keys survive completion on purpose (independent-review
    // P0-1): a completed run's first-stage dependencies (accumulated pool,
    // selection decision) are dependencies of the completed result in exactly
    // the same way they are for an interrupted resume, so the COMPLETE gate
    // must be able to prove them too. Dropping them here is what let a
    // deleted/mutated pool ride through a COMPLETE reuse.
    // The targeted-action:* and derived resolution-input namespaces are carried THROUGH this rebuild: it is
    // rebuilt from scratch here (no spread), and dropping it would erase the
    // sub-phase's F.5 completion evidence from the final checkpoint — the exact
    // "no evidence ⇒ re-run the paid retrieval" downgrade the resume boundary
    // above exists to prevent.
    state.hashes = {
      ...targetedBindingsOf(state.hashes),
      ...(state.hashes[CLARIFICATION_KEY] ? { [CLARIFICATION_KEY]: state.hashes[CLARIFICATION_KEY] } : {}),
      researchPlan: sha256File(path.join(workDir, PLAN_ARTIFACT_FILENAME)),
      coverageState: sha256File(path.join(workDir, COVERAGE_STATE_FILENAME)),
      coverageFinal: sha256File(path.join(workDir, FINAL_COVERAGE_FILENAME)),
      perGroupClaims: sha256File(path.join(workDir, PER_GROUP_CLAIMS_FILENAME)),
      synthesis: sha256File(path.join(workDir, SYNTHESIS_FILENAME)),
      researchResult: sha256File(path.join(workDir, RESEARCH_RESULT_FILENAME)),
      [CHECKPOINT_BINDING_ACCUMULATED_POOL]: sha256File(
        path.join(workDir, RETRIEVAL_ROUNDS_DIRNAME, ACCUMULATED_POOL_FILENAME),
      ),
      [CHECKPOINT_BINDING_SELECTION_DECISION]: sha256File(path.join(workDir, SELECTION_DECISION_FILENAME)),
    };
    state.coverage = {
      is100PercentAnalysis: fin.artifact.assertion.is100PercentAnalysis,
      selectedCount: fin.artifact.coverage.analysisCoverage.selectedCount,
      analyzedCount: fin.artifact.coverage.analysisCoverage.analyzedCount,
    };
    writeState(workDir, state);
    appendEvent(workDir, { event: 'p1_compose_complete', planHash: expectedPlanHash, runId });

    return { ok: true, result, runId, planHash: expectedPlanHash };
  } catch (error) {
    if (error instanceof CoverageIntegrationError) {
      return persistFailure(error.code, error.message);
    }
    return persistFailure(CFC_ABORTED, error?.message ?? String(error));
  }
}

function writeArtifact(workDir, filename, value) {
  const safety = assertArtifactSafe(value);
  if (!safety.ok) {
    throw new CoverageIntegrationError(CFC_ABORTED, `artifact ${filename} failed the safety walk: ${safety.reason}`);
  }
  writeFileSync(path.join(workDir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function writeResult(workDir, result) {
  const safety = assertArtifactSafe(result);
  if (!safety.ok) {
    throw new CoverageIntegrationError(CFC_ABORTED, `research result failed the safety walk: ${safety.reason}`);
  }
  writeFileSync(path.join(workDir, RESEARCH_RESULT_FILENAME), `${JSON.stringify(result, null, 2)}\n`);
}
