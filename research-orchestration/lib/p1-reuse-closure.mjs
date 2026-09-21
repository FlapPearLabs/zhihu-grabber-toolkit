// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/p1-reuse-closure.mjs
 *
 * P1-R06 (GitHub Issue #94) — the COMPOSITION-LEVEL dependency-closure
 * validator for a persisted `stage === COMPLETE` P1 checkpoint.
 *
 * WHY THIS EXISTS (F02, fresh-confirmed root cause): the composer's COMPLETE
 * branch used to accept a checkpoint after checking only the P1 render binding
 * plus the recorded hashes of `research-result.json` / `coverage-final.json`.
 * That is a terminal existence check, NOT a dependency closure: deleting or
 * semantically mutating ANY upstream artifact (plan, selection decision,
 * canonical answers, handoff, T13 claims, T14 synthesis) left the two terminal
 * files byte-identical, so a FALSE COMPLETE was reused.
 *
 * WHAT THIS MODULE IS — and is NOT:
 *   - It is a pure COMPOSITION-LEVEL ORCHESTRATOR of already-frozen owner
 *     validators. It implements NO new identity scheme, NO second state engine,
 *     NO second canonical store and NO provenance guessing. Every real judgement
 *     is delegated to the module that already owns that seam:
 *       * plan identity ......... plan-contract.loadPlan / planHash
 *       * selection dependency ... source-group-selection.selectionDecisionStatus
 *       * group artifact identity  multi-group-execution.resumeMultiGroupExecution
 *                                  (+ state.mjs validateArtifactCheckpoint)
 *       * SEAM D V2 version ...... cross-source-synthesis
 *                                  SEAM_D_SEAM_VERSION /
 *                                  SEAM_D_SEMANTIC_CONTRACT_VERSION
 *       * SEAM D guard evidence .. pre-synthesis-guard
 *                                  (guardResult === 'PASS' + sha256 identity refs)
 *       * T15 final binding ...... coverage-final-integration (the T15 owner
 *                                  module's coverage-final artifact contract)
 *     The version/guard constants are imported FROM the producers. If a
 *     producer bumps its contract, this validator follows automatically — that
 *     is the point; a future constant is never guessed here.
 *
 * SIDE-EFFECT FREE BY CONSTRUCTION: this module performs READ-ONLY filesystem
 * access (existsSync / readFileSync / the owner validators' own read paths).
 * It performs ZERO network calls, ZERO planner/retrieval/capture/T13/T14 model
 * calls, ZERO canonical writes, and NEVER repairs or re-seals a hash. A
 * validation failure leaves the work directory byte-identical.
 *
 * EARLIEST-INVALID-BOUNDARY: validation walks the dependency chain in canonical
 * production order and returns at the FIRST broken edge, reporting the boundary
 * name plus bounded, credential-free detail. An operator can therefore see
 * which dependency actually rotted instead of a generic "state invalid".
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PLAN_ARTIFACT_FILENAME, loadPlan, planHash } from './plan-contract.mjs';
import { SELECTION_DECISION_FILENAME, loadSelectionDecision, selectionDecisionStatus } from './source-group-selection.mjs';
import {
  MULTI_GROUP_STATE_FILENAME,
  loadMultiGroupState,
  computeSelectionIdentity,
  resumeMultiGroupExecution,
  RESUME_BOUNDARY_RESUME,
} from './multi-group-execution.mjs';
import { sha256File, validateArtifactCheckpoint } from './state.mjs';
import {
  SEAM_D_SEAM_VERSION,
  SEAM_D_SEMANTIC_CONTRACT_VERSION,
} from './cross-source-synthesis.mjs';
import { GUARD_PASS } from './pre-synthesis-guard.mjs';
import {
  FINAL_COVERAGE_FILENAME,
  COVERAGE_STATE_FILENAME,
  P1_PIPELINE_IDENTITY,
  RETRIEVAL_ROUNDS_DIRNAME,
  ACCUMULATED_POOL_FILENAME,
} from './coverage-final-integration.mjs';

/** Work-relative artifact names produced/consumed by the composer. */
export const PER_GROUP_CLAIMS_FILENAME = 'per-group-claims.json';
export const SYNTHESIS_FILENAME = 'cross-source-synthesis.json';
export const RESEARCH_RESULT_FILENAME = 'research-result.json';

/** SHA-256 identity-ref format used by the frozen SEAM D contract. */
const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
const PLAN_HASH = /^[0-9a-f]{64}$/;

/**
 * Boundary vocabulary — the canonical production order of the dependency chain.
 * A returned boundary is always the EARLIEST broken edge.
 */
export const CLOSURE_BOUNDARY_CONFIG = 'request_config';
export const CLOSURE_BOUNDARY_PLAN = 'plan';
export const CLOSURE_BOUNDARY_RETRIEVAL_ROUNDS = 'retrieval_rounds';
export const CLOSURE_BOUNDARY_SELECTION = 'selection';
export const CLOSURE_BOUNDARY_GROUP = 'group';
export const CLOSURE_BOUNDARY_CLAIMS = 'claims';
export const CLOSURE_BOUNDARY_SYNTHESIS = 'synthesis';
export const CLOSURE_BOUNDARY_COVERAGE = 'coverage';
export const CLOSURE_BOUNDARY_RESULT = 'result';

/**
 * Checkpoint content-binding keys recorded by the composer AS IT PRODUCES each
 * stage-boundary artifact (see `state.hashes`).
 *
 * WHY RECORD-TIME BINDINGS. A resume may skip a stage only when the artifact that
 * stage produced is provably the artifact the interrupted run left behind. Shape
 * or count checks cannot prove that — an artifact can be well-formed, have the
 * right number of entries, and still carry different content. A content hash
 * recorded by the producer is the only cheap proof of BYTE identity, and it is
 * what makes same-count semantic mutation detectable rather than invisible.
 *
 * ONE HASH MAP, TWO VALIDATION GATES. The composer writes these keys at the
 * moment it persists each artifact, and every checkpoint write re-records the
 * coverage ledger, so the binding always names the bytes on disk as of that
 * checkpoint:
 *   - `accumulatedPool` / `selectionDecision` / `coverageState` are the
 *     STAGE-BOUNDARY proofs an interrupted resume verifies (`planResumeReentry`);
 *   - a COMPLETION checkpoint additionally carries the terminal keys
 *     (researchPlan / coverageFinal / perGroupClaims / synthesis /
 *     researchResult), which only the completion write produces.
 * The terminal keys can never appear on a pre-completion checkpoint (only the
 * completion write makes them), and the stage-boundary keys SURVIVE completion:
 * an interrupted run and a completed run must prove the same first-stage
 * dependencies, so `validateCompleteReuseClosure` requires them too.
 *
 * MISSING BINDING ⇒ NOT BOUND ⇒ NEVER REUSABLE. A checkpoint that predates a
 * binding key (or was hand-stripped of one) is refused at that boundary —
 * missing provenance is never guessed.
 */
export const CHECKPOINT_BINDING_ACCUMULATED_POOL = 'accumulatedPool';
export const CHECKPOINT_BINDING_SELECTION_DECISION = 'selectionDecision';
export const CHECKPOINT_BINDING_COVERAGE_STATE = 'coverageState';

function refuse(boundary, detail, extra = {}) {
  return { valid: false, boundary, detail, ...extra };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function readJson(abs) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(abs, 'utf8')) };
  } catch {
    return { ok: false, value: null };
  }
}

/** Bounded, credential-free detail string (never echoes untrusted content). */
function bounded(v, max = 120) {
  return String(v ?? '').slice(0, max);
}

// ---------------------------------------------------------------------------
// edge 1 — Plan binding
// ---------------------------------------------------------------------------

/**
 * The persisted plan must still load through its OWN contract validator AND
 * still hash to the planHash the COMPLETE checkpoint recorded. A plan whose
 * content was mutated in place keeps its filename but not its identity.
 */
function validatePlanEdge(workDir, boundPlanHash) {
  if (!PLAN_HASH.test(String(boundPlanHash ?? ''))) {
    return refuse(CLOSURE_BOUNDARY_PLAN, 'checkpoint carries no well-formed planHash binding');
  }
  const abs = path.join(workDir, PLAN_ARTIFACT_FILENAME);
  if (!existsSync(abs)) {
    return refuse(CLOSURE_BOUNDARY_PLAN, `plan artifact missing (${PLAN_ARTIFACT_FILENAME})`);
  }
  const loaded = loadPlan(workDir);
  if (!loaded.ok) {
    return refuse(CLOSURE_BOUNDARY_PLAN, `plan artifact no longer passes its own contract (${bounded(loaded.reason)})`);
  }
  if (String(loaded.planHash) !== String(boundPlanHash)) {
    return refuse(CLOSURE_BOUNDARY_PLAN, 'plan artifact content no longer hashes to the bound planHash');
  }
  return { valid: true, plan: loaded.plan, planHash: loaded.planHash };
}

// ---------------------------------------------------------------------------
// edge 2 — source-group selection decision
// ---------------------------------------------------------------------------

/**
 * Delegate to the T08 owner's own staleness verdict. It binds the decision to
 * the current plan identity AND to the pool identity, so a same-planHash but
 * different selection is refused by the owner, not by a re-implementation here.
 *
 * The pool identity passed here is the LIVE pool's own planHash — read from the
 * pool artifact after its content binding has already proven the bytes are the
 * completed run's bytes. The decision's own `poolPlanHash` field is NOT
 * evidence about the live pool: trusting it would let the decision certify the
 * very dependency it consumes (a decision and a mutated pool could agree on a
 * pool identity neither of them proves any more).
 */
function validateSelectionEdge(workDir, boundPlanHash, livePoolPlanHash) {
  const abs = path.join(workDir, SELECTION_DECISION_FILENAME);
  if (!existsSync(abs)) {
    return refuse(CLOSURE_BOUNDARY_SELECTION, `selection decision missing (${SELECTION_DECISION_FILENAME})`);
  }
  const loaded = loadSelectionDecision(workDir);
  if (!loaded.ok) {
    return refuse(CLOSURE_BOUNDARY_SELECTION, `selection decision no longer loads (${bounded(loaded.reason)})`);
  }
  const status = selectionDecisionStatus({
    decision: loaded.decision,
    currentPlanHash: boundPlanHash,
    currentPoolPlanHash: livePoolPlanHash,
  });
  if (!status.reusable) {
    return refuse(CLOSURE_BOUNDARY_SELECTION, `selection decision is not reusable (${bounded(status.reason)})`);
  }
  return { valid: true, decision: loaded.decision };
}

// ---------------------------------------------------------------------------
// edge 3 — T09 group-level artifact identity (canonical answers + handoff)
// ---------------------------------------------------------------------------

/**
 * The group edge is decided by the FROZEN T09 resume authority. This function
 * calls it through the SAME entrypoint production uses
 * (`resumeMultiGroupExecution`) so R06 introduces no second group-reuse
 * semantics, and it only READS: it never persists the resumed state.
 *
 * `resumeMultiGroupExecution` returns `boundary` = the earliest matching drift
 * among plan / selection / selection_decision, or `resume` when it revalidated
 * the recorded per-group artifact hashes. A drift other than the ones already
 * reported above, or any invalidated group, is a broken group edge.
 */
function validateGroupEdge(workDir, boundPlanHash, selectionDecision) {
  const abs = path.join(workDir, MULTI_GROUP_STATE_FILENAME);
  if (!existsSync(abs)) {
    return refuse(CLOSURE_BOUNDARY_GROUP, `group execution state missing (${MULTI_GROUP_STATE_FILENAME})`);
  }
  const persisted = loadMultiGroupState(workDir);
  if (!persisted) {
    return refuse(CLOSURE_BOUNDARY_GROUP, 'group execution state unreadable or of an incompatible schema');
  }
  if (persisted.planHash !== boundPlanHash) {
    return refuse(CLOSURE_BOUNDARY_GROUP, 'group execution state was produced under a different planHash');
  }
  // The authority derives the live selection identity from the persisted
  // decision; a divergent recorded identity means the state belongs to another
  // selection (same planHash, different selection is a REAL counterexample).
  const liveSelectionIdentity = computeSelectionIdentity(selectionDecision?.selectedGroups);
  if (persisted.selectionIdentity !== liveSelectionIdentity) {
    return refuse(CLOSURE_BOUNDARY_GROUP, 'group execution state was produced under a different selection identity');
  }

  let resumed;
  try {
    resumed = resumeMultiGroupExecution({
      workDir,
      planHash: boundPlanHash,
      selectionDecision,
    });
  } catch (error) {
    return refuse(CLOSURE_BOUNDARY_GROUP, `group resume authority rejected the state (${bounded(error?.code ?? error?.name)}): ${bounded(error?.message, 200)}`);
  }
  // READ-ONLY contract: the authority must have resolved to a genuine resume
  // (not a fresh/again-derived state) for the checkpoint to be reusable.
  if (resumed.fresh === true) {
    return refuse(CLOSURE_BOUNDARY_GROUP, `group artifacts are no longer a valid resumable set (boundary=${bounded(resumed.boundary)})`);
  }
  if (resumed.boundary !== RESUME_BOUNDARY_RESUME) {
    return refuse(CLOSURE_BOUNDARY_GROUP, `group artifacts drifted at boundary=${bounded(resumed.boundary)}`);
  }
  if (Array.isArray(resumed.invalidatedGroupIds) && resumed.invalidatedGroupIds.length > 0) {
    return refuse(
      CLOSURE_BOUNDARY_GROUP,
      `${resumed.invalidatedGroupIds.length} group(s) invalidated (missing/stale artifact): ${resumed.invalidatedGroupIds.slice(0, 5).join(',')}`,
      { invalidatedGroupIds: [...resumed.invalidatedGroupIds] },
    );
  }
  if (resumed.state?.researchComplete !== true) {
    return refuse(CLOSURE_BOUNDARY_GROUP, 'group execution state no longer reports a complete, fully-verified corpus');
  }
  return { valid: true, multiGroupState: resumed.state };
}

/** Confirm each group's recorded artifact hashes still bind via the state owner. */
function validateGroupArtifactHashes(workDir, multiGroupState) {
  for (const groupId of Object.keys(multiGroupState.groups ?? {}).sort()) {
    const g = multiGroupState.groups[groupId];
    if (g.handoffValid !== true) continue;
    for (const [rel, expected] of [
      [g.answersRel, g.artifactHashes?.answersJson],
      [g.handoffRel, g.artifactHashes?.handoffJson],
    ]) {
      if (!isNonEmptyString(rel)) continue;
      const check = validateArtifactCheckpoint(workDir, rel, expected ?? null);
      if (!check.ok) {
        return refuse(CLOSURE_BOUNDARY_GROUP, `group ${bounded(groupId)} artifact invalid: ${bounded(check.reason)}`);
      }
    }
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// edge 4 — T13 per-group claims (Seam C artifact)
// ---------------------------------------------------------------------------

/**
 * The claims artifact is a SEAM C artifact. Validate its own structural
 * contract (seam identity, seam version, planHash binding, aggregate identity
 * shape) — never by re-deriving claims, and never by trusting its file hash
 * alone (a same-count mutation keeps the shape and only changes semantics).
 */
function validateClaimsEdge(workDir, boundPlanHash) {
  const abs = path.join(workDir, PER_GROUP_CLAIMS_FILENAME);
  if (!existsSync(abs)) {
    return refuse(CLOSURE_BOUNDARY_CLAIMS, `T13 claims artifact missing (${PER_GROUP_CLAIMS_FILENAME})`);
  }
  const parsed = readJson(abs);
  if (!parsed.ok) {
    return refuse(CLOSURE_BOUNDARY_CLAIMS, 'T13 claims artifact is unreadable or not JSON');
  }
  const artifact = parsed.value;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return refuse(CLOSURE_BOUNDARY_CLAIMS, 'T13 claims artifact is not an object');
  }
  if (artifact.seam !== 'T13_TO_T14') {
    return refuse(CLOSURE_BOUNDARY_CLAIMS, 'T13 claims artifact is not a SEAM C artifact (unexpected seam identity)');
  }
  if (!Number.isInteger(artifact.seamVersion) || artifact.seamVersion < 1) {
    return refuse(CLOSURE_BOUNDARY_CLAIMS, 'T13 claims artifact carries no usable seamVersion');
  }
  if (String(artifact.planHash ?? '') !== String(boundPlanHash)) {
    return refuse(CLOSURE_BOUNDARY_CLAIMS, 'T13 claims artifact does not bind to the checkpoint planHash (foreign-run claims refused)');
  }
  const agg = artifact.aggregateAnalyzedIdentity;
  if (!agg || typeof agg !== 'object'
    || !SHA256_REF.test(String(agg.mappedAnalyzedSourceSetIdentity ?? ''))) {
    return refuse(CLOSURE_BOUNDARY_CLAIMS, 'T13 claims artifact lacks a usable aggregate analyzed-source-set identity');
  }
  if (!Array.isArray(artifact.groupRepresentations) || artifact.groupRepresentations.length === 0) {
    return refuse(CLOSURE_BOUNDARY_CLAIMS, 'T13 claims artifact carries no group representations');
  }
  // The analyzed-set identity is T13-owned; R06 must never recompute it. It
  // must, however, match the identity the T15 final artifact recorded, which is
  // a pure equality consumption of the producer's own output (see coverage edge).
  return { valid: true, artifact, mappedAnalyzedSourceSetIdentity: String(agg.mappedAnalyzedSourceSetIdentity) };
}

// ---------------------------------------------------------------------------
// edge 5 — T14 synthesis (SEAM D V2 version + guard evidence)
// ---------------------------------------------------------------------------

/**
 * Version constants are imported from the PRODUCER (`cross-source-synthesis`),
 * never guessed. A missing / V1 / mixed version is refused outright: V1 is
 * historical-only and must not become reusable just because its own file hash
 * is self-consistent.
 */
function validateSynthesisEdge(workDir, boundPlanHash) {
  const abs = path.join(workDir, SYNTHESIS_FILENAME);
  if (!existsSync(abs)) {
    return refuse(CLOSURE_BOUNDARY_SYNTHESIS, `T14 synthesis artifact missing (${SYNTHESIS_FILENAME})`);
  }
  const parsed = readJson(abs);
  if (!parsed.ok) {
    return refuse(CLOSURE_BOUNDARY_SYNTHESIS, 'T14 synthesis artifact is unreadable or not JSON');
  }
  const artifact = parsed.value;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return refuse(CLOSURE_BOUNDARY_SYNTHESIS, 'T14 synthesis artifact is not an object');
  }
  if (artifact.seam !== 'T14_TO_T15') {
    return refuse(CLOSURE_BOUNDARY_SYNTHESIS, 'T14 synthesis artifact is not a SEAM D artifact (unexpected seam identity)');
  }
  if (artifact.seamVersion !== SEAM_D_SEAM_VERSION
    || artifact.semanticContractVersion !== SEAM_D_SEMANTIC_CONTRACT_VERSION) {
    return refuse(CLOSURE_BOUNDARY_SYNTHESIS, 'T14 synthesis artifact is not the current SEAM D version (missing/V1/mixed is never defaulted)', {
      seamVersion: artifact.seamVersion ?? null,
      semanticContractVersion: artifact.semanticContractVersion ?? null,
    });
  }
  if (String(artifact.planHash ?? '') !== String(boundPlanHash)) {
    return refuse(CLOSURE_BOUNDARY_SYNTHESIS, 'T14 synthesis artifact does not bind to the checkpoint planHash (foreign-run synthesis refused)');
  }
  const guard = artifact.preSynthesisGuard;
  if (!guard || typeof guard !== 'object'
    || guard.guardResult !== GUARD_PASS
    || !SHA256_REF.test(String(guard.selectedVerifiedSourceSetIdentity ?? ''))
    || !SHA256_REF.test(String(guard.mappedAnalyzedSourceSetIdentity ?? ''))) {
    return refuse(CLOSURE_BOUNDARY_SYNTHESIS, 'T14 synthesis artifact lacks usable PASS pre-synthesis guard evidence (SEAM D fail closed)');
  }
  const synthesis = artifact.synthesis;
  if (!synthesis || typeof synthesis !== 'object' || !isNonEmptyString(synthesis.synthesisIdentity)) {
    return refuse(CLOSURE_BOUNDARY_SYNTHESIS, 'T14 synthesis artifact carries no canonical synthesis identity');
  }
  return {
    valid: true,
    artifact,
    synthesisIdentity: String(synthesis.synthesisIdentity),
    guardSelectedVerifiedSourceSetIdentity: String(guard.selectedVerifiedSourceSetIdentity),
    guardMappedAnalyzedSourceSetIdentity: String(guard.mappedAnalyzedSourceSetIdentity),
  };
}

// ---------------------------------------------------------------------------
// edge 6 — T15 final coverage + research result binding
// ---------------------------------------------------------------------------

/**
 * The T15 artifact is the only completeness authority. Re-validate its own
 * mechanical assertion, its planHash binding, its SEAM D version echo, and
 * cross-bind it to the T14 guard identities (a well-formed guard from a
 * DIFFERENT synthesis must never be recorded as this run's double defense).
 * Then cross-bind the render result to the same identity triple.
 */
function validateCoverageAndResultEdges(workDir, boundPlanHash, claims, synthesis) {
  const covAbs = path.join(workDir, FINAL_COVERAGE_FILENAME);
  if (!existsSync(covAbs)) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, `T15 final coverage artifact missing (${FINAL_COVERAGE_FILENAME})`);
  }
  const covParsed = readJson(covAbs);
  if (!covParsed.ok) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final coverage artifact is unreadable or not JSON');
  }
  const cov = covParsed.value;
  if (!cov || typeof cov !== 'object' || Array.isArray(cov)) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final coverage artifact is not an object');
  }
  if (cov.pipeline !== P1_PIPELINE_IDENTITY) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final coverage artifact belongs to a different pipeline identity');
  }
  if (String(cov.planHash ?? '') !== String(boundPlanHash)) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final coverage artifact does not bind to the checkpoint planHash');
  }
  if (cov.assertion?.is100PercentAnalysis !== true) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final coverage artifact does not assert 100% analysis');
  }
  if (cov.assertion?.basis !== 'MECHANICAL_SET_EQUALITY') {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 assertion basis is not the frozen mechanical set equality');
  }
  if (cov.doubleDefense?.t15FinalReconciliation !== 'PASS') {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final reconciliation is not PASS in the recorded artifact');
  }

  // SEAM D V2 echo + cross-binding against the LIVE synthesis artifact.
  const sc = cov.doubleDefense?.t14PreSynthesisGuard;
  if (!sc || typeof sc !== 'object' || sc.guardResult !== GUARD_PASS) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final coverage artifact has no PASS SEAM D guard echo');
  }
  const contract = cov.doubleDefense?.synthesisContract;
  if (!contract || typeof contract !== 'object') {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final coverage artifact carries no synthesis contract echo');
  }
  if (contract.seamVersion !== SEAM_D_SEAM_VERSION
    || contract.semanticContractVersion !== SEAM_D_SEMANTIC_CONTRACT_VERSION) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 final coverage artifact echoes a non-current SEAM D version');
  }
  if (String(contract.synthesisIdentity ?? '') !== String(synthesis.synthesisIdentity)) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE,
      'T15 final coverage artifact does not match the live T14 synthesis identity (stale/foreign final coverage refused)');
  }

  // Guard identity cross-binding: the guard that T15 recorded must be the guard
  // that the LIVE synthesis artifact actually carries.
  if (String(sc.selectedVerifiedSourceSetIdentity ?? '') !== synthesis.guardSelectedVerifiedSourceSetIdentity
    || String(sc.mappedAnalyzedSourceSetIdentity ?? '') !== synthesis.guardMappedAnalyzedSourceSetIdentity) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'T15 recorded SEAM D guard identities do not match the live synthesis artifact');
  }

  // T13 → T15 identity consumption: the mapped analyzed-set identity T15/guard
  // recorded must equal the identity the live T13 claims artifact carries. Both
  // sides are the PRODUCER's own values; R06 only compares them.
  if (String(sc.mappedAnalyzedSourceSetIdentity ?? '') !== claims.mappedAnalyzedSourceSetIdentity) {
    return refuse(CLOSURE_BOUNDARY_CLAIMS,
      'T13 claims artifact identity no longer matches the identity downstream stages recorded (claims drifted)');
  }

  // Coverage ledger presence (the T15 artifact's own declared sibling).
  if (!existsSync(path.join(workDir, COVERAGE_STATE_FILENAME))) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, `coverage ledger missing (${COVERAGE_STATE_FILENAME})`);
  }
  return { valid: true, coverageFinal: cov };
}

function validateResultEdge(workDir, boundPlanHash, coverageFinal) {
  const abs = path.join(workDir, RESEARCH_RESULT_FILENAME);
  if (!existsSync(abs)) {
    return refuse(CLOSURE_BOUNDARY_RESULT, `research result artifact missing (${RESEARCH_RESULT_FILENAME})`);
  }
  const parsed = readJson(abs);
  if (!parsed.ok) {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'research result artifact is unreadable or not JSON');
  }
  const result = parsed.value;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'research result artifact is not an object');
  }
  if (result.ok !== true || result.verification?.valid !== true) {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'research result artifact is not a valid completed result');
  }
  if (String(result.planHash ?? '') !== String(boundPlanHash)) {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'research result artifact does not bind to the checkpoint planHash');
  }
  if (result.disclosure?.isFullCoverage !== true || result.disclosure?.complete !== true) {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'research result artifact does not disclose full coverage');
  }
  if (String(result.disclosure?.pipeline ?? '') !== P1_PIPELINE_IDENTITY) {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'research result artifact belongs to a different pipeline identity');
  }
  const basis = result.verification?.basis;
  if (basis?.t14PreSynthesisGuard !== 'PASS' || basis?.t15FinalReconciliation !== 'PASS') {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'research result artifact lacks the double-defense PASS basis');
  }
  const ac = basis?.analysisCoverage;
  const covAc = coverageFinal.coverage?.analysisCoverage;
  if (!ac || !covAc
    || Number(ac.selectedCount) !== Number(covAc.selectedCount)
    || Number(ac.mappedCount) !== Number(covAc.mappedCount)
    || Number(ac.analyzedCount) !== Number(covAc.analyzedCount)) {
    return refuse(CLOSURE_BOUNDARY_RESULT,
      'research result analysis accounting disagrees with the final coverage artifact (foreign/stale result refused)');
  }
  if (Number(ac.selectedCount) !== Number(ac.analyzedCount) || Number(ac.selectedCount) !== Number(ac.mappedCount)) {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'research result analysis accounting is not 100%');
  }
  return { valid: true, result };
}

// ---------------------------------------------------------------------------
// producer-recorded content bindings
// ---------------------------------------------------------------------------

/** Work-relative location of the T06 accumulated pool. */
const RETRIEVAL_POOL_REL = `${RETRIEVAL_ROUNDS_DIRNAME}/${ACCUMULATED_POOL_FILENAME}`;

/**
 * Prove that a recorded content binding still describes the bytes on disk.
 *
 * This is the SAME discipline the interrupted-resume path uses
 * (`verifyBoundArtifact` in the composer): a binding that is absent, malformed,
 * or disagrees with the file is a REFUSAL at the owning boundary — never a
 * repair, never a re-derivation, never a guess. Missing binding ⇒ NOT BOUND.
 */
function verifyContentBinding(workDir, boundary, expected, rel) {
  if (typeof expected !== 'string' || expected.length === 0) {
    return refuse(boundary, `checkpoint carries no recorded content hash for ${rel} (incomplete binding set — not currently reusable)`);
  }
  const abs = path.join(workDir, rel);
  if (!existsSync(abs)) {
    return refuse(boundary, `recorded artifact missing: ${rel}`);
  }
  let actual = null;
  try {
    actual = sha256File(abs);
  } catch {
    return refuse(boundary, `recorded artifact unreadable: ${rel}`);
  }
  if (actual !== expected) {
    return refuse(boundary, `recorded artifact content changed since completion (stale/tampered): ${rel}`);
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// the closure
// ---------------------------------------------------------------------------

/**
 * Validate the full dependency closure of a persisted COMPLETE checkpoint.
 *
 * READ-ONLY. Returns:
 *   { valid: true,  ... }
 *   { valid: false, boundary, detail, extra? }
 * where `boundary` is the EARLIEST invalid edge in canonical production order.
 *
 * @param {object}  args
 * @param {string}  args.workDir            work directory (absolute)
 * @param {object}  args.state              the persisted P1 state record
 * @param {string}  args.boundPlanHash      state.p1FinalCoveragePlanHash
 * @param {object} [args.selectionIdentity] persisted selection identity, if any
 */
export function validateCompleteReuseClosure({ workDir, state, boundPlanHash, currentConfigFingerprint = undefined } = {}) {
  if (!isNonEmptyString(workDir)) {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'workDir is required for closure validation');
  }
  if (!state || typeof state !== 'object') {
    return refuse(CLOSURE_BOUNDARY_RESULT, 'no persisted state record to validate');
  }

  // 0) request/config control. A checkpoint produced under a different
  //    composition config is NOT currently reusable for this request — config
  //    materially changes the corpus and the claims, so serving the prior
  //    COMPLETE would silently answer a different question than the one asked.
  if (currentConfigFingerprint !== undefined) {
    const recordedFp = state.configFingerprint ?? null;
    const currentFp = currentConfigFingerprint ?? null;
    if (recordedFp !== currentFp) {
      return refuse(CLOSURE_BOUNDARY_CONFIG,
        'checkpoint was produced under a different composition config (not reusable for this request)');
    }
  }

  // The content hashes this checkpoint recorded as it PRODUCED each artifact.
  // Every boundary below requires its own binding, and each boundary's binding
  // is checked AT that boundary so a multi-fault work dir still reports the
  // EARLIEST broken edge (a structural check for a later boundary must never
  // preempt a content break in an earlier one).
  const recorded = state.hashes ?? {};

  // 1) plan — the owner contract (loadPlan + planHash) AND the producer's own
  //    content binding, at the same boundary.
  const planEdge = validatePlanEdge(workDir, boundPlanHash);
  if (!planEdge.valid) return planEdge;
  const planBinding = verifyContentBinding(workDir, CLOSURE_BOUNDARY_PLAN, recorded.researchPlan, PLAN_ARTIFACT_FILENAME);
  if (!planBinding.valid) return planBinding;

  // 2) retrieval rounds — the accumulated pool is the first durable artifact of
  //    the chain. Its bytes must be proven unchanged BEFORE the selection edge
  //    is evaluated: the decision's own `poolPlanHash` field is a claim, not
  //    evidence, so the selection edge is checked against the LIVE pool identity
  //    read from these proven bytes.
  const poolBinding = verifyContentBinding(workDir, CLOSURE_BOUNDARY_RETRIEVAL_ROUNDS, recorded.accumulatedPool, RETRIEVAL_POOL_REL);
  if (!poolBinding.valid) return poolBinding;
  const poolParsed = readJson(path.join(workDir, RETRIEVAL_POOL_REL));
  if (!poolParsed.ok || !poolParsed.value || typeof poolParsed.value !== 'object'
    || Array.isArray(poolParsed.value) || typeof poolParsed.value.planHash !== 'string') {
    return refuse(CLOSURE_BOUNDARY_RETRIEVAL_ROUNDS, 'accumulated pool is not a canonical T06 pool artifact');
  }

  // 3) selection decision (plan-bound AND live-pool-bound)
  const selectionEdge = validateSelectionEdge(workDir, boundPlanHash, poolParsed.value.planHash);
  if (!selectionEdge.valid) return selectionEdge;
  const decisionBinding = verifyContentBinding(workDir, CLOSURE_BOUNDARY_SELECTION, recorded.selectionDecision, SELECTION_DECISION_FILENAME);
  if (!decisionBinding.valid) return decisionBinding;

  // 4) T09 group artifacts (canonical answers + handoff), via the frozen
  //    resume authority — no second group-reuse semantics here. The authority
  //    recomputes planHash / selectionIdentity / selectionDecisionHash against
  //    the LIVE decision, so no identity needs to be threaded in from here.
  const groupEdge = validateGroupEdge(workDir, boundPlanHash, selectionEdge.decision);
  if (!groupEdge.valid) return groupEdge;
  const hashEdge = validateGroupArtifactHashes(workDir, groupEdge.multiGroupState);
  if (!hashEdge.valid) return hashEdge;

  // 5) T13 claims (SEAM C)
  const claimsEdge = validateClaimsEdge(workDir, boundPlanHash);
  if (!claimsEdge.valid) return claimsEdge;
  const claimsBinding = verifyContentBinding(workDir, CLOSURE_BOUNDARY_CLAIMS, recorded.perGroupClaims, PER_GROUP_CLAIMS_FILENAME);
  if (!claimsBinding.valid) return claimsBinding;

  // 6) T14 synthesis (SEAM D V2 + guard), cross-bound to T13
  const synthesisEdge = validateSynthesisEdge(workDir, boundPlanHash);
  if (!synthesisEdge.valid) return synthesisEdge;
  const synthesisBinding = verifyContentBinding(workDir, CLOSURE_BOUNDARY_SYNTHESIS, recorded.synthesis, SYNTHESIS_FILENAME);
  if (!synthesisBinding.valid) return synthesisBinding;

  // 7) T15 final coverage (+ cross-binding to T13/T14)
  const coverageEdge = validateCoverageAndResultEdges(workDir, boundPlanHash, claimsEdge, synthesisEdge);
  if (!coverageEdge.valid) return coverageEdge;
  const ledgerBinding = verifyContentBinding(workDir, CLOSURE_BOUNDARY_COVERAGE, recorded.coverageState, COVERAGE_STATE_FILENAME);
  if (!ledgerBinding.valid) return ledgerBinding;
  const finalBinding = verifyContentBinding(workDir, CLOSURE_BOUNDARY_COVERAGE, recorded.coverageFinal, FINAL_COVERAGE_FILENAME);
  if (!finalBinding.valid) return finalBinding;

  // 8) research result (render binding)
  const resultEdge = validateResultEdge(workDir, boundPlanHash, coverageEdge.coverageFinal);
  if (!resultEdge.valid) return resultEdge;
  const resultBinding = verifyContentBinding(workDir, CLOSURE_BOUNDARY_RESULT, recorded.researchResult, RESEARCH_RESULT_FILENAME);
  if (!resultBinding.valid) return resultBinding;

  // 9) Identity agreement between the checkpoint record and the artifacts.
  if (String(state.p1FinalCoveragePlanHash ?? '') !== String(coverageEdge.coverageFinal.planHash ?? '')) {
    return refuse(CLOSURE_BOUNDARY_COVERAGE, 'checkpoint render binding disagrees with the final coverage artifact planHash');
  }

  return {
    valid: true,
    plan: planEdge.plan,
    decision: selectionEdge.decision,
    multiGroupState: groupEdge.multiGroupState,
    claims: claimsEdge.artifact,
    synthesis: synthesisEdge.artifact,
    coverageFinal: coverageEdge.coverageFinal,
    result: resultEdge.result,
  };
}

export { planHash as computePlanHash };
