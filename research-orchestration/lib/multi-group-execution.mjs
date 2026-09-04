// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/multi-group-execution.mjs
 *
 * P1-T09 — Multi-group Execution State + Per-group Capture/Verify/Handoff composition
 * (Approved docs/specs/p1-cross-question-deep-research.md §6 / §6.1 / §6.2 / §6.3 / §9.2;
 * Issue #41; TICKET_LANE_V2 HIGH-RISK state/orchestration/identity/persistence ticket).
 *
 * ADDITIVE composition layer over the EXISTING per-question authority surfaces:
 *   capture  → T05 session-capture adapter (wraps zhihu grab; captured != verified)
 *   validity → verify-output authority, mirrored per group (RULES §4)
 *   handoff  → make-handoff + corpus handoff verify authority (no new handoff schema)
 *   coverage → T07 updateSourceCompleteness hook, caller T09 ONLY
 *
 * Hard invariants (Issue #41 / Spec §6):
 *   I1  CAPTURED != VERIFIED (per group; captured groups never enter VerifiedGroupRefs)
 *   I2  VerifiedGroupRefs[] is VALID-ONLY and DERIVED (never hand-appended)
 *   I3  per-group isolation (group B's failure/staleness never mutates group A)
 *   I4  FILE EXISTS != VALID CACHE (reuse revalidates recorded artifact hashes)
 *   I5  stale propagation invalidates the group AND its dependents — siblings isolated
 *   I6  PARTIAL != COMPLETE (researchComplete only when EVERY group is composed valid)
 *   I7  the manifest is a derived composition artifact, NOT a second canonical store
 *   I8  handoff/verify authority is inherited; no manual validity upgrade anywhere
 *   I9  credentials / secret-bearing / unsafe strings never enter any persisted surface
 *       (ONE rrf.assertArtifactSafe walker, pin-then-walk persistence)
 *   I10 planHash / selectionIdentity / selectionDecisionHash drift invalidates from the
 *       matching boundary; reordered-but-identical group sets keep cache identity stable
 *
 * Failure identities are stable, value-free machine codes: raw provider diagnostics,
 * credential-shaped content and unsafe strings are NEVER echoed into state.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isValidPlanHashFormat } from './plan-contract.mjs';
import { assertArtifactSafe } from './rrf.mjs';
import { validateProviderResult } from './provider-seam.mjs';
import { isCanonicalQuestionId } from './source-group-selection.mjs';
import {
  updateSourceCompleteness,
  OWNER_T09_SOURCE_COMPLETENESS,
} from './coverage-state.mjs';
import { sha256, sha256File, validateArtifactCheckpoint, toWorkRelative } from './state.mjs';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const MULTI_GROUP_STATE_FILENAME = 'multi-group-state.json';
export const MULTI_GROUP_STATE_SCHEMA_VERSION = 1;
export const MULTI_GROUP_STATE_TYPE = 'multi-group-execution-state';

export const GROUP_STAGE_PENDING = 'pending';
export const GROUP_STAGE_CAPTURED = 'captured';
export const GROUP_STAGE_VERIFIED = 'verified';
export const GROUP_STAGE_HANDED_OFF = 'handed_off';
export const GROUP_STAGE_FAILED = 'failed';

/** Stable, value-free controller failure identities (provider codes pass through as-is). */
export const GROUP_FAILURE_PROVIDER_RESULT_CONTRACT_INVALID = 'PROVIDER_RESULT_CONTRACT_INVALID';
export const GROUP_FAILURE_CAPTURE_IDENTITY_MISMATCH = 'CAPTURE_IDENTITY_MISMATCH';
export const GROUP_FAILURE_CAPTURE_ARTIFACT_MISSING = 'CAPTURE_ARTIFACT_MISSING';
export const GROUP_FAILURE_VERIFY_PROCESS_FAILED = 'VERIFY_PROCESS_FAILED';
export const GROUP_FAILURE_VERIFY_IDENTITY_MISMATCH = 'VERIFY_IDENTITY_MISMATCH';
export const GROUP_FAILURE_HANDOFF_ARTIFACT_MISSING = 'HANDOFF_ARTIFACT_MISSING';
export const GROUP_FAILURE_HANDOFF_GATE_INVALID = 'HANDOFF_GATE_INVALID';
export const GROUP_FAILURE_HANDOFF_PROCESS_FAILED = 'HANDOFF_PROCESS_FAILED';

/** Resume invalidation boundaries (Spec §6.2: invalidate from the correct boundary). */
export const RESUME_BOUNDARY_NO_STATE = 'no_state';
export const RESUME_BOUNDARY_INCOMPATIBLE = 'incompatible';
export const RESUME_BOUNDARY_PLAN = 'plan';
export const RESUME_BOUNDARY_SELECTION = 'selection';
export const RESUME_BOUNDARY_SELECTION_DECISION = 'selection_decision';
export const RESUME_BOUNDARY_RESUME = 'resume';

const MULTI_GROUP_STATE_UNSAFE = 'multi_group_state_unsafe';
const MULTI_GROUP_STATE_WRITE_FAILED = 'multi_group_state_write_failed';

const PAGINATION_COMPLETE = 'complete';
const PAGINATION_PARTIAL = 'partial';
const PAGINATION_UNKNOWN = 'unknown';

// strict persisted-shape domains (CE-21/CE-22: a parseable file with wrong shapes
// is CORRUPT — loads as null, never partially reused, never raw-throws)
const GROUP_STAGE_VALUES = [GROUP_STAGE_PENDING, GROUP_STAGE_CAPTURED, GROUP_STAGE_VERIFIED, GROUP_STAGE_HANDED_OFF, GROUP_STAGE_FAILED];
const PAGINATION_STATUS_VALUES = [PAGINATION_COMPLETE, PAGINATION_PARTIAL, PAGINATION_UNKNOWN];
const GROUP_ARTIFACT_HASH_KEYS = ['answersJson', 'handoffJson'];
const GROUP_ENTRY_KEYS = [
  'groupId', 'questionId', 'stage', 'captured', 'verified', 'handoffValid', 'failed', 'partial',
  'paginationStatus', 'evidenceRef', 'handoffRef', 'artifactHashes', 'capturedAnswerCount',
  'verification', 'failure',
];
const MULTI_GROUP_STATE_KEYS = [
  'schemaVersion', 'type', 'planHash', 'selectionIdentity', 'selectionDecisionHash',
  'groups', 'verifiedGroupRefs', 'manifest', 'researchComplete',
];

// ---------------------------------------------------------------------------
// error type
// ---------------------------------------------------------------------------

export class MultiGroupError extends Error {
  constructor(code, message, { details = null } = {}) {
    super(message);
    this.name = 'MultiGroupError';
    this.code = code;
    this.details = details;
  }
}

function requireGroup(state, groupId) {
  if (!state || typeof state !== 'object' || !state.groups || typeof state.groups !== 'object') {
    throw new MultiGroupError('MULTI_GROUP_STATE_INVALID', 'multi-group execution state is invalid');
  }
  const g = state.groups[groupId];
  if (!g || typeof g !== 'object') {
    throw new MultiGroupError('MULTI_GROUP_GROUP_NOT_FOUND', `group not in execution state: ${String(groupId)}`);
  }
  return g;
}

// ---------------------------------------------------------------------------
// deterministic canonical JSON (hash domain for identity values)
// ---------------------------------------------------------------------------

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function intOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Selection identity: the SET of selected group ids (order-independent).
 * A reordered-but-identical SelectedSourceGroups[] keeps the same cache identity (I10);
 * any membership change produces a different identity.
 */
export function computeSelectionIdentity(selectedGroups) {
  const ids = [...new Set((Array.isArray(selectedGroups) ? selectedGroups : [])
    .map((g) => (g && typeof g === 'object') ? String(g.groupId ?? '') : '')
    .filter((id) => id.length > 0))].sort();
  return sha256(canonicalJson({ groupIds: ids }));
}

/**
 * Selection DECISION identity (R2-F4): canonical over the decision CONTENT with the
 * incidental array ORDER of selectedGroups (keyed by groupId) and candidates (keyed
 * by questionId) normalized. Honors the recorded reuse contract: a reordered-but-
 * identical selection keeps the same decision identity (composed groups are reused),
 * while ANY content change (rationale, scores, membership) still produces a
 * different identity. All other decision fields are covered verbatim.
 */
function computeSelectionDecisionIdentity(decision) {
  if (!decision || typeof decision !== 'object') return sha256(canonicalJson(null));
  const key = (v) => String(v ?? '');
  const sortedSelected = [...(Array.isArray(decision.selectedGroups) ? decision.selectedGroups : [])]
    .sort((a, b) => (key(a?.groupId) < key(b?.groupId) ? -1 : key(a?.groupId) > key(b?.groupId) ? 1 : 0));
  const sortedCandidates = [...(Array.isArray(decision.candidates) ? decision.candidates : [])]
    .sort((a, b) => (key(a?.questionId) < key(b?.questionId) ? -1 : key(a?.questionId) > key(b?.questionId) ? 1 : 0));
  return sha256(canonicalJson({ ...decision, selectedGroups: sortedSelected, candidates: sortedCandidates }));
}

// ---------------------------------------------------------------------------
// state creation
// ---------------------------------------------------------------------------

function freshGroup({ groupId, questionId }) {
  return {
    groupId,
    questionId,
    stage: GROUP_STAGE_PENDING,
    captured: false,
    verified: false,
    handoffValid: false,
    failed: false,
    partial: false,
    paginationStatus: PAGINATION_UNKNOWN,
    evidenceRef: null, // work-relative answers.json path (set by T09, never by provider)
    handoffRef: null, // work-relative handoff.json path
    artifactHashes: {}, // { answersJson, handoffJson } — FILE EXISTS != VALID CACHE
    capturedAnswerCount: null,
    verification: null, // mirrored verify-output verdict (validity authority)
    failure: null, // { code, class } value-free machine identity; NEVER raw detail
  };
}

/**
 * Create the multi-group execution state from the T08 selection decision.
 * Fail closed on: invalid planHash, non-auto verdict, decision plan/pool identity
 * mismatch (CE-20), empty/invalid/duplicate groups.
 */
export function createMultiGroupExecutionState({ planHash, selectionDecision }) {
  if (!isValidPlanHashFormat(planHash)) {
    throw new MultiGroupError('MULTI_GROUP_PLAN_HASH_INVALID', 'planHash is missing or malformed (fail closed)');
  }
  if (!selectionDecision || typeof selectionDecision !== 'object' || selectionDecision.verdict !== 'auto') {
    throw new MultiGroupError('MULTI_GROUP_SELECTION_INVALID', 'selection decision must be a T08 auto verdict (fail closed)');
  }
  // CE-20: the decision is only composable under the plan it was actually made for.
  // BOTH identity fields T08 embeds in every decision (decision.planHash and
  // decision.poolPlanHash) must be format-valid and equal the executing planHash —
  // a decision made under another plan/pool can never silently seed this state.
  // (Mirrors the T08 selectionDecisionStatus hard fail-closed reuse contract.)
  if (!isValidPlanHashFormat(selectionDecision.planHash) || selectionDecision.planHash !== planHash) {
    throw new MultiGroupError('MULTI_GROUP_PLAN_IDENTITY_MISMATCH', 'selection decision plan identity missing, malformed, or not the executing plan (fail closed)');
  }
  if (!isValidPlanHashFormat(selectionDecision.poolPlanHash) || selectionDecision.poolPlanHash !== planHash) {
    throw new MultiGroupError('MULTI_GROUP_PLAN_IDENTITY_MISMATCH', 'selection decision pool identity missing, malformed, or built under a different plan (fail closed)');
  }
  const selected = Array.isArray(selectionDecision.selectedGroups) ? selectionDecision.selectedGroups : [];
  if (selected.length === 0) {
    throw new MultiGroupError('MULTI_GROUP_SELECTION_INVALID', 'selected source group set is empty (fail closed)');
  }
  const seen = new Set();
  for (const sg of selected) {
    const groupId = sg && typeof sg === 'object' ? sg.groupId : null;
    const questionId = sg && typeof sg === 'object' ? sg.questionId : null;
    if (typeof groupId !== 'string' || groupId.length === 0 || typeof questionId !== 'string' || questionId.length === 0) {
      throw new MultiGroupError('MULTI_GROUP_SELECTION_INVALID', 'selected group identity missing/invalid (fail closed)');
    }
    // R2-F6: prototype-dangerous keys can silently vanish from a plain-object
    // groups map (e.g. '__proto__' assignment hits the accessor setter) — reject.
    if (groupId === '__proto__' || groupId === 'constructor' || groupId === 'prototype') {
      throw new MultiGroupError('MULTI_GROUP_GROUP_ID_FORBIDDEN', 'selected group id is a prototype-dangerous key (fail closed)');
    }
    // R2-F8: questionId canonicality is T06/T08 authority — align the T09 boundary
    // with it (non-canonical identities would otherwise wedge at persistence).
    if (!isCanonicalQuestionId(questionId)) {
      throw new MultiGroupError('MULTI_GROUP_SELECTION_INVALID', 'selected group questionId is not a canonical question id (fail closed)');
    }
    if (seen.has(groupId)) {
      throw new MultiGroupError('MULTI_GROUP_DUPLICATE_GROUP_ID', 'duplicate groupId in SelectedSourceGroups (fail closed)');
    }
    seen.add(groupId);
  }

  const groups = {};
  for (const sg of [...selected].sort((a, b) => (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0))) {
    groups[sg.groupId] = freshGroup({ groupId: sg.groupId, questionId: sg.questionId });
  }

  return {
    schemaVersion: MULTI_GROUP_STATE_SCHEMA_VERSION,
    type: MULTI_GROUP_STATE_TYPE,
    planHash,
    selectionIdentity: computeSelectionIdentity(selected),
    selectionDecisionHash: computeSelectionDecisionIdentity(selectionDecision),
    groups,
    verifiedGroupRefs: [],
    manifest: null,
    researchComplete: false,
  };
}

// ---------------------------------------------------------------------------
// per-group execution (controller-owned; primitives keep their authority)
// ---------------------------------------------------------------------------

function markGroupFailed(g, code, failureClass) {
  g.failed = true;
  g.stage = GROUP_STAGE_FAILED;
  g.failure = { code: String(code), class: String(failureClass) };
  // R2-F1: a failed group's completeness/partiality claims are void. The T07
  // validator rejects contradictory complete&&failed, and the derived Source
  // Completeness payload must ALWAYS be applicable (CE-18) — downgrade.
  g.paginationStatus = PAGINATION_UNKNOWN;
  g.partial = false;
}

/**
 * Per-group capture via the T05 session-capture adapter (I8: no reimplementation).
 * The provider result must pass the §5.1 mechanical gate (validateProviderResult);
 * failures are recorded as value-free {code, class} identities (I9). Group B is
 * never touched while executing group A (I3).
 */
export function executeGroupCapture({ state, groupId, workDir, captureAdapter }) {
  const g = requireGroup(state, groupId);
  if (g.verified || g.handoffValid) {
    throw new MultiGroupError('MULTI_GROUP_REEXEC_BLOCKED', `group ${groupId} already composed valid; re-capture blocked (fail closed)`);
  }

  let result = null;
  try {
    result = captureAdapter.retrieve({ questionId: g.questionId, outDir: path.join(workDir, 'zhihu') });
  } catch {
    markGroupFailed(g, GROUP_FAILURE_PROVIDER_RESULT_CONTRACT_INVALID, 'contract');
    return state;
  }

  const gate = validateProviderResult(result);
  if (!gate.valid) {
    markGroupFailed(g, GROUP_FAILURE_PROVIDER_RESULT_CONTRACT_INVALID, 'contract');
    return state;
  }

  if (result.ok !== true) {
    markGroupFailed(g, result.failure.code, result.failure.class);
    return state;
  }

  const item = Array.isArray(result.items)
    ? result.items.find((it) => it && it.identity && String(it.identity.questionId ?? '') === g.questionId)
    : null;
  if (!item) {
    markGroupFailed(g, GROUP_FAILURE_CAPTURE_IDENTITY_MISMATCH, 'identity');
    return state;
  }

  const answersAbs = path.join(workDir, 'zhihu', g.questionId, 'answers.json');
  if (!fs.existsSync(answersAbs)) {
    markGroupFailed(g, GROUP_FAILURE_CAPTURE_ARTIFACT_MISSING, 'contract');
    return state;
  }

  g.captured = true;
  g.failed = false;
  g.failure = null;
  g.stage = GROUP_STAGE_CAPTURED;
  g.paginationStatus = result.completeness.status === PAGINATION_COMPLETE
    ? PAGINATION_COMPLETE
    : result.completeness.status === PAGINATION_PARTIAL ? PAGINATION_PARTIAL : PAGINATION_UNKNOWN;
  g.partial = g.paginationStatus === PAGINATION_PARTIAL;
  g.evidenceRef = toWorkRelative(workDir, answersAbs);
  g.artifactHashes.answersJson = sha256File(answersAbs);
  g.capturedAnswerCount = intOrNull(item.facts?.capturedAnswerCount);
  return state;
}

/**
 * Per-group verify by MIRRORING the verify-output authority verdict (I1/I8).
 * - valid=false is a LEGAL diagnostic outcome: captured stays true, verified stays false.
 * - a verify verdict naming a foreign questionId fails closed (identity mismatch).
 * - subprocess crash records a process failure; retry is legal while !verified.
 */
export function executeGroupVerify({ state, groupId, workDir, runner }) {
  const g = requireGroup(state, groupId);
  if (g.verified) {
    throw new MultiGroupError('MULTI_GROUP_REEXEC_BLOCKED', `group ${groupId} already verified; re-verify blocked (fail closed)`);
  }
  if (!g.captured || !g.evidenceRef) {
    throw new MultiGroupError('MULTI_GROUP_VERIFY_PRECONDITION_INVALID', `group ${groupId} must be captured before verify (fail closed)`);
  }

  const captureDirAbs = path.join(workDir, 'zhihu', g.questionId);
  let res = null;
  try {
    res = runner('zhihu-verify', [captureDirAbs]);
  } catch {
    markGroupFailed(g, GROUP_FAILURE_VERIFY_PROCESS_FAILED, 'process');
    return state;
  }
  if (!res || typeof res.status !== 'number') {
    markGroupFailed(g, GROUP_FAILURE_VERIFY_PROCESS_FAILED, 'process');
    return state;
  }
  if (res.status !== 0) {
    markGroupFailed(g, GROUP_FAILURE_VERIFY_PROCESS_FAILED, 'process');
    return state;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = null;
  }

  if (!parsed || parsed.valid !== true) {
    // captured != verified: legal outcome, NOT a group failure. The group simply
    // remains outside VerifiedGroupRefs (derivation enforces this).
    // R2-F1b: a COMPLETED verify run supersedes any prior process/identity failure
    // marks — a stale failure identity must never leak into coverage accounting
    // (and combined with a recorded 'complete' pagination it would contradict T07).
    g.verified = false;
    g.failed = false;
    g.failure = null;
    g.verification = {
      valid: false,
      questionId: parsed && typeof parsed.questionId === 'string' ? parsed.questionId : null,
      capturedAnswerCount: intOrNull(parsed?.capturedAnswerCount),
      reportedAnswerCount: intOrNull(parsed?.reportedAnswerCount),
    };
    return state;
  }

  if (String(parsed.questionId ?? '') !== g.questionId) {
    markGroupFailed(g, GROUP_FAILURE_VERIFY_IDENTITY_MISMATCH, 'identity');
    return state;
  }

  g.verified = true;
  g.failed = false;
  g.failure = null;
  g.stage = GROUP_STAGE_VERIFIED;
  g.verification = {
    valid: true,
    questionId: parsed.questionId,
    capturedAnswerCount: intOrNull(parsed.capturedAnswerCount),
    reportedAnswerCount: intOrNull(parsed.reportedAnswerCount),
  };
  if (g.verification.capturedAnswerCount !== null) {
    g.capturedAnswerCount = g.verification.capturedAnswerCount;
  }
  return state;
}

/**
 * Per-group handoff through the EXISTING handoff authority (I8):
 * make-handoff generates handoff.json; corpus handoff verify must return valid=true.
 * A handoff gate failure NEVER upgrades validity: verified (verify-output's verdict)
 * stays, handoffValid stays false, and the group remains outside VerifiedGroupRefs.
 * Note: failed is NOT set here — coverage accounting forbids failed && verified;
 * the failure identity is recorded in g.failure instead.
 */
export function executeGroupHandoff({ state, groupId, workDir, runner }) {
  const g = requireGroup(state, groupId);
  if (!g.verified) {
    throw new MultiGroupError('MULTI_GROUP_HANDOFF_PRECONDITION_INVALID', `group ${groupId} must be verified before handoff (fail closed)`);
  }

  const captureDirAbs = path.join(workDir, 'zhihu', g.questionId);
  let res = null;
  try {
    res = runner('zhihu-handoff', [captureDirAbs, '--task', 'digest']);
  } catch {
    g.failure = { code: GROUP_FAILURE_HANDOFF_PROCESS_FAILED, class: 'process' };
    return state;
  }
  if (!res || res.status !== 0) {
    g.failure = { code: GROUP_FAILURE_HANDOFF_PROCESS_FAILED, class: 'process' };
    return state;
  }

  const handoffAbs = path.join(captureDirAbs, 'handoff.json');
  if (!fs.existsSync(handoffAbs)) {
    g.failure = { code: GROUP_FAILURE_HANDOFF_ARTIFACT_MISSING, class: 'contract' };
    return state;
  }

  let gateRes = null;
  try {
    gateRes = runner('corpus-verify-handoff', [handoffAbs, '--source-root', captureDirAbs]);
  } catch {
    g.failure = { code: GROUP_FAILURE_HANDOFF_GATE_INVALID, class: 'gate' };
    return state;
  }
  let gate = null;
  try {
    gate = JSON.parse(gateRes.stdout);
  } catch {
    gate = null;
  }
  if (!gateRes || gateRes.status !== 0 || !gate || gate.valid !== true) {
    g.failure = { code: GROUP_FAILURE_HANDOFF_GATE_INVALID, class: 'gate' };
    return state;
  }

  g.handoffValid = true;
  g.failure = null;
  g.stage = GROUP_STAGE_HANDED_OFF;
  g.handoffRef = toWorkRelative(workDir, handoffAbs);
  g.artifactHashes.handoffJson = sha256File(handoffAbs);
  return state;
}

// ---------------------------------------------------------------------------
// derived projections (authoritative recomputation — never hand-appended)
// ---------------------------------------------------------------------------

/**
 * Valid-only VerifiedGroupRefs (I2): a group composes a ref ONLY when its own
 * dependency chain is valid — captured && verified && handoffValid with recorded
 * artifact identities. Deterministic (groupId-sorted); idempotent; duplicate-free.
 */
export function deriveVerifiedGroupRefs(state) {
  const refs = [];
  for (const groupId of Object.keys(state.groups).sort()) {
    const g = state.groups[groupId];
    if (
      g.captured === true
      && g.verified === true
      && g.handoffValid === true
      && typeof g.evidenceRef === 'string' && g.evidenceRef.length > 0
      && typeof g.handoffRef === 'string' && g.handoffRef.length > 0
      && typeof g.artifactHashes.answersJson === 'string'
      && typeof g.artifactHashes.handoffJson === 'string'
    ) {
      refs.push({
        groupId: g.groupId,
        questionId: g.questionId,
        answersRel: g.evidenceRef,
        handoffRel: g.handoffRef,
        answersHash: g.artifactHashes.answersJson,
        handoffHash: g.artifactHashes.handoffJson,
        capturedAnswerCount: g.capturedAnswerCount,
        reportedAnswerCount: g.verification?.reportedAnswerCount ?? null,
        paginationStatus: g.paginationStatus,
      });
    }
  }
  state.verifiedGroupRefs = refs; // authoritative re-derivation
  return refs;
}

/**
 * Deterministic ResearchCorpusManifest (I7): composition / group provenance /
 * dependent hashes / accounting ONLY — never canonical content. Reproducible
 * byte-identically from (state, selectionDecision); manifestHash changes when any
 * selection identity or verified artifact hash changes.
 */
export function deriveResearchCorpusManifest({ state, selectionDecision }) {
  const refs = deriveVerifiedGroupRefs(state);
  const selected = Array.isArray(selectionDecision?.selectedGroups) ? selectionDecision.selectedGroups : [];
  const selectedIds = new Set(selected.map((g) => String(g?.groupId ?? '')).filter((id) => id.length > 0));

  // identity binding guard: a ref naming a group outside the current selection
  // must never be stitched into the manifest (fail closed).
  for (const ref of refs) {
    if (!selectedIds.has(ref.groupId)) {
      throw new MultiGroupError('MULTI_GROUP_REF_IDENTITY_INVALID', 'verified ref references a group outside the current selection (fail closed)');
    }
  }

  const groups = refs.map((r) => ({
    groupId: r.groupId,
    questionId: r.questionId,
    answersRel: r.answersRel,
    handoffRel: r.handoffRel,
    answersHash: r.answersHash,
    handoffHash: r.handoffHash,
    capturedAnswerCount: r.capturedAnswerCount,
    reportedAnswerCount: r.reportedAnswerCount,
    paginationStatus: r.paginationStatus,
  }));

  let capturedNotVerifiedGroupCount = 0;
  let failedGroupCount = 0;
  for (const g of Object.values(state.groups)) {
    if (g.captured && !g.verified) capturedNotVerifiedGroupCount += 1;
    if (g.failed) failedGroupCount += 1;
  }

  const manifest = {
    schemaVersion: 1,
    type: 'research-corpus-manifest',
    planHash: state.planHash,
    selectionIdentity: state.selectionIdentity,
    selectionDecisionHash: state.selectionDecisionHash,
    groups,
    accounting: {
      selectedGroupCount: selectedIds.size,
      verifiedGroupCount: groups.length,
      capturedNotVerifiedGroupCount,
      failedGroupCount,
    },
  };
  manifest.manifestHash = sha256(canonicalJson(manifest));
  state.manifest = manifest;
  return manifest;
}

/**
 * PARTIAL != COMPLETE (I6): complete ONLY when every group composed valid.
 */
export function isResearchComplete(state) {
  const groupIds = Object.keys(state.groups);
  if (groupIds.length === 0) return false;
  return deriveVerifiedGroupRefs(state).length === groupIds.length;
}

/**
 * Explicit completion finalize. Throws (fail closed) when any group is not yet
 * composed valid — partial state can never be finalized as complete.
 */
export function finalizeResearch(state) {
  if (!isResearchComplete(state)) {
    throw new MultiGroupError('MULTI_GROUP_RESEARCH_NOT_COMPLETE', 'research has groups that are not composed valid; partial state must never be finalized as complete');
  }
  state.researchComplete = true;
  return state;
}

// ---------------------------------------------------------------------------
// CoverageState hook (T09 owns ONLY Source Completeness)
// ---------------------------------------------------------------------------

function groupSelectedCount(g) {
  return g.captured && intOrNull(g.capturedAnswerCount) !== null ? g.capturedAnswerCount : 0;
}

/**
 * Mechanically derive the Source Completeness update from real per-group
 * execution evidence. selectedCount/verifiedCount are per-group source counts;
 * the aggregate diagnostics are exact per-group sums (the T07 validator rejects
 * any drift — this derivation can never produce one).
 */
export function buildSourceCompletenessUpdate(state) {
  const perGroupStatus = {};
  let totalSelectedCount = 0;
  let totalVerifiedCount = 0;
  let capturedNotVerifiedCount = 0;

  for (const groupId of Object.keys(state.groups).sort()) {
    const g = state.groups[groupId];
    const selectedCount = groupSelectedCount(g);
    const verifiedCount = g.verified ? selectedCount : 0;
    perGroupStatus[groupId] = {
      captured: g.captured === true,
      verified: g.verified === true,
      partial: g.partial === true,
      failed: g.failed === true,
      paginationStatus: g.paginationStatus,
      evidenceRef: g.captured ? g.evidenceRef : null,
      selectedCount,
      verifiedCount,
    };
    totalSelectedCount += selectedCount;
    totalVerifiedCount += verifiedCount;
    if (g.captured) capturedNotVerifiedCount += selectedCount - verifiedCount;
  }

  return {
    perGroupStatus,
    diagnostics: {
      capturedNotVerifiedCount,
      totalSelectedCount,
      totalVerifiedCount,
    },
  };
}

/**
 * Apply the derived update through the T07 hook with the T09 owner identity.
 * This is the ONLY CoverageState ledger T09 writes; the hook's own validator
 * rejects illegal writes to any other ledger.
 */
export function applySourceCompletenessToCoverageState(coverageState, state) {
  return updateSourceCompleteness(
    coverageState,
    buildSourceCompletenessUpdate(state),
    { caller: OWNER_T09_SOURCE_COMPLETENESS },
  );
}

// ---------------------------------------------------------------------------
// persistence (pin-then-walk; ONE artifact-safety walker; work-relative only)
// ---------------------------------------------------------------------------

/**
 * Persist the multi-group state. The serialized bytes are produced FIRST and are
 * the single source of truth; rrf.assertArtifactSafe then walks the parsed plain
 * data (JSON-domain types only, safe keys, no credential/path-shaped strings, no
 * cycles). A hostile getter, a credential-shaped string, or any unsafe content →
 * stable value-free rejection, NOTHING is written (I9).
 */
export function persistMultiGroupState(workDir, state) {
  let serialized;
  let plain;
  try {
    serialized = JSON.stringify(state, null, 2);
    plain = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: MULTI_GROUP_STATE_UNSAFE };
  }
  const safety = assertArtifactSafe(plain);
  if (!safety.ok) {
    return { ok: false, reason: MULTI_GROUP_STATE_UNSAFE };
  }
  try {
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME), `${serialized}\n`);
  } catch {
    return { ok: false, reason: MULTI_GROUP_STATE_WRITE_FAILED };
  }
  return { ok: true, file: MULTI_GROUP_STATE_FILENAME };
}

/**
 * Load + validate the persisted state. Absent / corrupt (unparseable OR
 * shape-invalid — CE-21/CE-22) / incompatible-typed files all load as null
 * (treated as absent by resume — FILE EXISTS != VALID; never raw-throws,
 * never partially reused).
 */
export function loadMultiGroupState(workDir) {
  const file = path.join(workDir, MULTI_GROUP_STATE_FILENAME);
  if (!fs.existsSync(file)) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.type !== MULTI_GROUP_STATE_TYPE || parsed.schemaVersion !== MULTI_GROUP_STATE_SCHEMA_VERSION) {
    return null;
  }
  if (!isValidPersistedMultiGroupShape(parsed)) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// persisted-state shape validation (CE-21 / CE-22)
// ---------------------------------------------------------------------------

function isStrictBoolean(v) {
  return v === true || v === false;
}

function isPlainObjectValue(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * A persisted group entry is reusable only in its EXACT production shape:
 * identity-coherent with its key, strict booleans (no truthiness coercion),
 * enum-bounded stage/pagination, whitelist-bounded artifact hash keys, and a
 * value-free failure object ({code, class} only — never raw detail keys).
 */
function isValidGroupEntry(key, g) {
  if (!isPlainObjectValue(g)) return false;
  for (const k of Object.keys(g)) {
    if (!GROUP_ENTRY_KEYS.includes(k)) return false;
  }
  if (g.groupId !== key) return false;
  if (typeof g.questionId !== 'string' || g.questionId.length === 0) return false;
  if (!GROUP_STAGE_VALUES.includes(g.stage)) return false;
  for (const flag of ['captured', 'verified', 'handoffValid', 'failed', 'partial']) {
    if (!isStrictBoolean(g[flag])) return false;
  }
  if (!PAGINATION_STATUS_VALUES.includes(g.paginationStatus)) return false;
  if (g.evidenceRef !== null && typeof g.evidenceRef !== 'string') return false;
  if (g.handoffRef !== null && typeof g.handoffRef !== 'string') return false;
  if (!isPlainObjectValue(g.artifactHashes)) return false;
  for (const k of Object.keys(g.artifactHashes)) {
    if (!GROUP_ARTIFACT_HASH_KEYS.includes(k)) return false;
    if (typeof g.artifactHashes[k] !== 'string' || g.artifactHashes[k].length === 0) return false;
  }
  if (g.capturedAnswerCount !== null && !(Number.isInteger(g.capturedAnswerCount) && g.capturedAnswerCount >= 0)) return false;
  if (g.verification !== null && !isPlainObjectValue(g.verification)) return false;
  if (g.failure !== null) {
    if (!isPlainObjectValue(g.failure)) return false;
    if (Object.keys(g.failure).length !== 2) return false;
    if (typeof g.failure.code !== 'string' || g.failure.code.length === 0) return false;
    if (typeof g.failure.class !== 'string' || g.failure.class.length === 0) return false;
  }
  // R2-F2/F3 cross-field coherence: a captured group MUST carry its OWN recorded
  // answers identity (hash + the exact production work-relative ref shape);
  // handoffValid likewise. Without this, I4 revalidation is vacuous (a missing
  // expected hash skips the comparison entirely) and cross-group artifact swaps
  // load cleanly into the manifest.
  if (g.captured) {
    if (g.evidenceRef !== `zhihu/${g.questionId}/answers.json`) return false;
    if (typeof g.artifactHashes.answersJson !== 'string' || g.artifactHashes.answersJson.length === 0) return false;
  }
  if (g.handoffValid) {
    if (g.handoffRef !== `zhihu/${g.questionId}/handoff.json`) return false;
    if (typeof g.artifactHashes.handoffJson !== 'string' || g.artifactHashes.handoffJson.length === 0) return false;
  }
  return true;
}

/**
 * Deep structural validation for a parsed persisted state (CE-21/CE-22). A
 * parseable file with a valid type/schemaVersion but a missing/malformed groups
 * map, tampered group entries, or tampered identity fields is CORRUPT — it must
 * never be partially reused and never raw-throw the resume path. Invalid shape
 * loads as null (treated as absent by resume → fresh execution, fail closed).
 */
function isValidPersistedMultiGroupShape(parsed) {
  for (const k of Object.keys(parsed)) {
    if (!MULTI_GROUP_STATE_KEYS.includes(k)) return false;
  }
  if (typeof parsed.planHash !== 'string' || !isValidPlanHashFormat(parsed.planHash)) return false;
  if (typeof parsed.selectionIdentity !== 'string' || parsed.selectionIdentity.length === 0) return false;
  if (typeof parsed.selectionDecisionHash !== 'string' || parsed.selectionDecisionHash.length === 0) return false;
  if (!isPlainObjectValue(parsed.groups)) return false;
  const groupIds = Object.keys(parsed.groups);
  if (groupIds.length === 0) return false;
  for (const id of groupIds) {
    // R2-F6: prototype-dangerous keys never belong in a persisted groups map
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') return false;
    if (!isValidGroupEntry(id, parsed.groups[id])) return false;
  }
  // R2-F5: the persisted groups map must be EXACTLY the recorded selection set —
  // any superset/subset/rename is corruption (loads as null → fresh; resume's
  // composition derivation must never even see it, let alone throw from it).
  if (computeSelectionIdentity(groupIds.map((id) => ({ groupId: id }))) !== parsed.selectionIdentity) return false;
  if (!Array.isArray(parsed.verifiedGroupRefs)) return false;
  for (const ref of parsed.verifiedGroupRefs) {
    if (!isPlainObjectValue(ref) || typeof ref.groupId !== 'string' || ref.groupId.length === 0) return false;
  }
  if (parsed.manifest !== null && !isPlainObjectValue(parsed.manifest)) return false;
  if (!isStrictBoolean(parsed.researchComplete)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// resume / stale propagation
// ---------------------------------------------------------------------------

function resetGroupToPending(g) {
  g.stage = GROUP_STAGE_PENDING;
  g.captured = false;
  g.verified = false;
  g.handoffValid = false;
  g.partial = false;
  g.failed = false;
  g.paginationStatus = PAGINATION_UNKNOWN;
  g.evidenceRef = null;
  g.handoffRef = null;
  g.artifactHashes = {};
  g.capturedAnswerCount = null;
  g.verification = null;
  g.failure = null;
}

/**
 * Resume the multi-group execution from persisted state (Spec §6.2):
 *  - no/corrupt/shape-invalid (CE-21/CE-22)/incompatible state → fresh create
 *    (no silent partial reuse; shape-invalid loads as null, never raw-throws)
 *  - planHash drift                           → fresh create from the PLAN boundary
 *    (the (planHash, decision) pair must itself be consistent — a stale decision
 *     fails closed per CE-20; plan drift requires a re-selection, not reuse)
 *  - selectionIdentity drift                 → fresh create from the SELECTION boundary
 *  - selectionDecisionHash drift             → fresh create from the DECISION boundary
 *  - otherwise revalidate each group's recorded artifact hashes (I4) and invalidate:
 *      answers.json stale  → the whole group resets (its handoff/verification are
 *                            DEPENDENT artifacts — invalidated upward, I5);
 *      handoff.json stale  → ONLY handoffValid drops (answers-bound verified status
 *                            preserved; the handoff stage re-runs);
 *    siblings without stale dependencies are never touched (I3).
 * Returns { state, fresh, boundary, invalidatedGroupIds }.
 */
export function resumeMultiGroupExecution({ workDir, planHash, selectionDecision }) {
  const selectionIdentity = computeSelectionIdentity(selectionDecision?.selectedGroups);
  const selectionDecisionHash = computeSelectionDecisionIdentity(selectionDecision ?? null);

  const existing = loadMultiGroupState(workDir);
  if (!existing) {
    return {
      state: createMultiGroupExecutionState({ planHash, selectionDecision }),
      fresh: true,
      boundary: RESUME_BOUNDARY_NO_STATE,
      invalidatedGroupIds: [],
    };
  }
  if (existing.type !== MULTI_GROUP_STATE_TYPE || existing.schemaVersion !== MULTI_GROUP_STATE_SCHEMA_VERSION) {
    return {
      state: createMultiGroupExecutionState({ planHash, selectionDecision }),
      fresh: true,
      boundary: RESUME_BOUNDARY_INCOMPATIBLE,
      invalidatedGroupIds: [],
    };
  }
  if (!isValidPlanHashFormat(existing.planHash) || existing.planHash !== planHash) {
    return {
      state: createMultiGroupExecutionState({ planHash, selectionDecision }),
      fresh: true,
      boundary: RESUME_BOUNDARY_PLAN,
      invalidatedGroupIds: [],
    };
  }
  if (existing.selectionIdentity !== selectionIdentity) {
    return {
      state: createMultiGroupExecutionState({ planHash, selectionDecision }),
      fresh: true,
      boundary: RESUME_BOUNDARY_SELECTION,
      invalidatedGroupIds: [],
    };
  }
  if (existing.selectionDecisionHash !== selectionDecisionHash) {
    return {
      state: createMultiGroupExecutionState({ planHash, selectionDecision }),
      fresh: true,
      boundary: RESUME_BOUNDARY_SELECTION_DECISION,
      invalidatedGroupIds: [],
    };
  }

  const state = existing;
  const invalidatedGroupIds = [];

  for (const groupId of Object.keys(state.groups).sort()) {
    const g = state.groups[groupId];

    // I4: FILE EXISTS != VALID CACHE — answers.json is the root dependency.
    if (g.captured) {
      const expectedAnswersHash = g.artifactHashes.answersJson ?? null;
      // R2-F2 (defense in depth; load already rejects this shape): a captured group
      // without a recorded answers hash has NO revalidatable identity —
      // validateArtifactCheckpoint would skip the comparison entirely. Stale.
      if (!expectedAnswersHash) {
        resetGroupToPending(g);
        invalidatedGroupIds.push(groupId);
        continue;
      }
      const answersCheck = validateArtifactCheckpoint(workDir, g.evidenceRef, expectedAnswersHash);
      if (!answersCheck.ok) {
        // stale root → whole group + dependents (verification, handoff) invalidated
        resetGroupToPending(g);
        invalidatedGroupIds.push(groupId);
        continue;
      }
      // handoff.json is a DEPENDENT artifact of the verified answers
      if (g.handoffValid) {
        if (!g.handoffRef || !g.artifactHashes.handoffJson) {
          // R2-F2: handoff validity without a revalidatable recorded identity is stale
          g.handoffValid = false;
          g.stage = GROUP_STAGE_VERIFIED; // verified stays (answers unchanged)
          invalidatedGroupIds.push(groupId);
        } else {
          const handoffCheck = validateArtifactCheckpoint(workDir, g.handoffRef, g.artifactHashes.handoffJson);
          if (!handoffCheck.ok) {
            g.handoffValid = false;
            g.stage = GROUP_STAGE_VERIFIED; // verified stays (answers unchanged)
            invalidatedGroupIds.push(groupId);
          }
        }
      }
    }
    // groups never captured have nothing recorded to revalidate (controller retries)
  }

  // re-derive authoritative projections after any invalidation
  deriveVerifiedGroupRefs(state);
  deriveResearchCorpusManifest({ state, selectionDecision });
  state.researchComplete = isResearchComplete(state);

  return { state, fresh: false, boundary: RESUME_BOUNDARY_RESUME, invalidatedGroupIds };
}
