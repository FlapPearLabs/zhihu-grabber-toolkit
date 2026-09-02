// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/coverage-state.mjs
 *
 * P1-T07 — ResearchCoverageState contract + update hooks + D-6 defaults record.
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §9, §6.2, §10.2; Issue #39.)
 *
 * Architecture & Three-Ledger Accounting (§9):
 *   1. Retrieval Coverage (§9.1):
 *      planHash, planned query variants, executed routes, fused candidate/group counts,
 *      provider failures, retrieval rounds and stop reason.
 *   2. Source Completeness (§9.2):
 *      per-group captured/verified/partial/failed status, pagination evidence,
 *      selected/verified source counts, captured != verified diagnostics.
 *   3. Analysis Coverage (§9.3):
 *      selected Verified Research Corpus source set identity, mapped source set identity,
 *      analyzed source set identity, evidence ref issues, and 100% analysis assertion
 *      (asserted true ONLY when selectedCorpusSourceSet === analyzedSourceSet mechanically).
 *   4. Diagnostics (§9.4):
 *      new_aspect_rate, new_claim_rate, new_expert_rate, new_contradiction_rate, novelty_gain,
 *      plus source-group representation/concentration diagnostics.
 *
 * Ownership Boundaries (Strict Hook Enforcement):
 *   - T06 / Controller: Retrieval Coverage updates (updateRetrievalCoverage)
 *   - T09: Source Completeness updates (updateSourceCompleteness)
 *   - T12: Selection Accounting updates (updateSelectionAccounting)
 *   - T13: Per-group mapped/analyzed source-set identity + per-group diagnostics (updatePerGroupAnalysis)
 *   - T14: Synthesis-level diagnostics (updateSynthesisDiagnostics) — NEVER writes analyzed source-set identity!
 *   - T15: Final coverage reconciliation / 100% assertion (reconcileFinalCoverage)
 *
 * Security & Fail-Closed Rules:
 *   - UNKNOWN != PASS. Missing coverage cannot be asserted as complete.
 *   - Credential-sensitive strings / machine-private absolute paths rejected fail-closed.
 *   - Unauthorized cross-ledger writes rejected fail-closed.
 *   - Malformed updates rejected fail-closed.
 *   - Immutable state transitions: every update returns a fresh validated, canonicalized state.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { isValidPlanHashFormat, isPlanBoundarySafeString } from './plan-contract.mjs';
import {
  isBoundarySafeString,
  assertArtifactSafe,
} from './rrf.mjs';

/** Canonical persisted coverage state artifact filename. */
export const COVERAGE_STATE_FILENAME = 'coverage-state.json';

/** Schema version. */
export const COVERAGE_STATE_SCHEMA_VERSION = 1;

/** Ownership tokens for hook access control. */
export const OWNER_T06_RETRIEVAL = 'T06';
export const OWNER_RETRIEVAL_CONTROLLER = 'RETRIEVAL_CONTROLLER';
export const OWNER_T09_SOURCE_COMPLETENESS = 'T09';
export const OWNER_T12_SELECTION = 'T12';
export const OWNER_T13_ANALYSIS = 'T13';
export const OWNER_T14_SYNTHESIS = 'T14';
export const OWNER_T15_FINAL = 'T15';

/** Machine-readable error codes. */
export const COVERAGE_ERROR_UNAUTHORIZED_OWNER = 'coverage_unauthorized_owner';
export const COVERAGE_ERROR_INVALID_STATE = 'coverage_invalid_state';
export const COVERAGE_ERROR_MALFORMED_UPDATE = 'coverage_malformed_update';
export const COVERAGE_ERROR_ILLEGAL_WRITE = 'coverage_illegal_write';
export const COVERAGE_ERROR_INCOMPLETE_ANALYSIS = 'coverage_incomplete_analysis';
export const COVERAGE_ERROR_PERSISTENCE_FAILED = 'coverage_persistence_failed';

/**
 * Implementation defaults record (Spec D-6 delegation).
 * These are explicit, validated implementation defaults — NOT spec-frozen immutable truths.
 */
export const IMPLEMENTATION_DEFAULTS_RECORD = Object.freeze({
  type: 'IMPLEMENTATION_DEFAULT',
  status: 'DELEGATED_TO_IMPLEMENTATION_D6',
  immutableSpecTruth: false,
  retrieval: Object.freeze({
    defaultMaxRetrievalRounds: 3,
    defaultSaturationNoveltyGainThreshold: 0.05,
    defaultMaxQueryBudget: 10,
    defaultMinRoundsBeforeSaturation: 1,
  }),
  sourceCompleteness: Object.freeze({
    requireExplicitCompletenessEvidence: true,
  }),
  analysisCoverage: Object.freeze({
    strictSetEqualityRequiredFor100Percent: true,
  }),
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
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

function dedupeAndSortStrings(arr) {
  if (!Array.isArray(arr)) return [];
  const set = new Set();
  for (const item of arr) {
    if (typeof item === 'string' && item.length > 0) {
      set.add(item);
    }
  }
  return Array.from(set).sort();
}

/**
 * Deep clone and canonical sort of coverage state.
 */
export function canonicalizeCoverageState(state) {
  if (!isPlainObject(state)) {
    const err = new Error('State must be a plain object');
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }

  // Canonicalize perGroupStatus sorted by group keys
  const perGroupStatus = {};
  if (isPlainObject(state.sourceCompleteness?.perGroupStatus)) {
    const sortedKeys = Object.keys(state.sourceCompleteness.perGroupStatus).sort();
    for (const k of sortedKeys) {
      const g = state.sourceCompleteness.perGroupStatus[k];
      perGroupStatus[k] = {
        captured: Boolean(g.captured),
        verified: Boolean(g.verified),
        partial: Boolean(g.partial),
        failed: Boolean(g.failed),
        paginationStatus: String(g.paginationStatus ?? 'unknown'),
        evidenceRef: g.evidenceRef === null || g.evidenceRef === undefined ? null : String(g.evidenceRef),
        selectedCount: Number(g.selectedCount ?? 0),
        verifiedCount: Number(g.verifiedCount ?? 0),
      };
    }
  }

  // Canonicalize diagnostics dictionaries sorted by key
  const selectedContentByGroup = {};
  if (isPlainObject(state.diagnostics?.selected_content_by_group)) {
    for (const k of Object.keys(state.diagnostics.selected_content_by_group).sort()) {
      selectedContentByGroup[k] = Number(state.diagnostics.selected_content_by_group[k]);
    }
  }

  const selectedContentTypeDistribution = {};
  if (isPlainObject(state.diagnostics?.selected_content_type_distribution)) {
    for (const k of Object.keys(state.diagnostics.selected_content_type_distribution).sort()) {
      selectedContentTypeDistribution[k] = Number(state.diagnostics.selected_content_type_distribution[k]);
    }
  }

  const perGroupSelectionCoverage = {};
  if (isPlainObject(state.diagnostics?.per_group_selection_coverage)) {
    for (const k of Object.keys(state.diagnostics.per_group_selection_coverage).sort()) {
      perGroupSelectionCoverage[k] = Number(state.diagnostics.per_group_selection_coverage[k]);
    }
  }

  const executedRoutes = Array.isArray(state.retrieval?.executedRoutes)
    ? state.retrieval.executedRoutes.map((r) => ({
        query: String(r.query ?? ''),
        providerId: String(r.providerId ?? ''),
        capability: String(r.capability ?? ''),
        roundIndex: Number(r.roundIndex ?? 0),
      }))
    : [];

  const plannedRoutes = Array.isArray(state.retrieval?.plannedRoutes)
    ? state.retrieval.plannedRoutes.map((r) => ({
        providerId: String(r.providerId ?? ''),
        capability: String(r.capability ?? ''),
      }))
    : [];

  const providerFailures = Array.isArray(state.retrieval?.providerFailures)
    ? state.retrieval.providerFailures.map((f) => ({
        code: f.code !== undefined ? String(f.code) : undefined,
        class: f.class !== undefined ? String(f.class) : undefined,
        ...(f.query ? { query: String(f.query) } : {}),
        ...(f.providerId ? { providerId: String(f.providerId) } : {}),
        ...(f.capability ? { capability: String(f.capability) } : {}),
        ...(typeof f.roundIndex === 'number' ? { roundIndex: f.roundIndex } : {}),
      }))
    : [];

  const evidenceRefIssues = {
    missingRefs: dedupeAndSortStrings(state.analysisCoverage?.evidenceRefIssues?.missingRefs),
    duplicateRefs: dedupeAndSortStrings(state.analysisCoverage?.evidenceRefIssues?.duplicateRefs),
    staleRefs: dedupeAndSortStrings(state.analysisCoverage?.evidenceRefIssues?.staleRefs),
    invalidRefs: dedupeAndSortStrings(state.analysisCoverage?.evidenceRefIssues?.invalidRefs),
  };

  const perGroupMappedSourceSet = {};
  if (isPlainObject(state.analysisCoverage?.perGroupMappedSourceSet)) {
    for (const [k, v] of Object.entries(state.analysisCoverage.perGroupMappedSourceSet).sort()) {
      perGroupMappedSourceSet[k] = dedupeAndSortStrings(v);
    }
  }

  const perGroupAnalyzedSourceSet = {};
  if (isPlainObject(state.analysisCoverage?.perGroupAnalyzedSourceSet)) {
    for (const [k, v] of Object.entries(state.analysisCoverage.perGroupAnalyzedSourceSet).sort()) {
      perGroupAnalyzedSourceSet[k] = dedupeAndSortStrings(v);
    }
  }

  return {
    schemaVersion: COVERAGE_STATE_SCHEMA_VERSION,
    planHash: String(state.planHash ?? ''),
    retrieval: {
      plannedQueryVariants: dedupeAndSortStrings(state.retrieval?.plannedQueryVariants),
      plannedRoutes,
      executedRoutes,
      fusedCandidateCount: Number(state.retrieval?.fusedCandidateCount ?? 0),
      fusedGroupCount: Number(state.retrieval?.fusedGroupCount ?? 0),
      providerFailures,
      retrievalRounds: Number(state.retrieval?.retrievalRounds ?? 0),
      stopReason: state.retrieval?.stopReason ? String(state.retrieval.stopReason) : null,
    },
    sourceCompleteness: {
      perGroupStatus,
      diagnostics: {
        capturedNotVerifiedCount: Number(state.sourceCompleteness?.diagnostics?.capturedNotVerifiedCount ?? 0),
        totalSelectedCount: Number(state.sourceCompleteness?.diagnostics?.totalSelectedCount ?? 0),
        totalVerifiedCount: Number(state.sourceCompleteness?.diagnostics?.totalVerifiedCount ?? 0),
      },
    },
    analysisCoverage: {
      selectedCorpusSourceSet: dedupeAndSortStrings(state.analysisCoverage?.selectedCorpusSourceSet),
      mappedSourceSet: dedupeAndSortStrings(state.analysisCoverage?.mappedSourceSet),
      analyzedSourceSet: dedupeAndSortStrings(state.analysisCoverage?.analyzedSourceSet),
      perGroupMappedSourceSet,
      perGroupAnalyzedSourceSet,
      evidenceRefIssues,
      is100PercentAnalysis: Boolean(state.analysisCoverage?.is100PercentAnalysis),
    },
    diagnostics: {
      new_aspect_rate: Number(state.diagnostics?.new_aspect_rate ?? 0),
      new_claim_rate: Number(state.diagnostics?.new_claim_rate ?? 0),
      new_expert_rate: Number(state.diagnostics?.new_expert_rate ?? 0),
      new_contradiction_rate: Number(state.diagnostics?.new_contradiction_rate ?? 0),
      novelty_gain: Number(state.diagnostics?.novelty_gain ?? 0),
      selected_source_group_count: Number(state.diagnostics?.selected_source_group_count ?? 0),
      selected_content_by_group: selectedContentByGroup,
      largest_group_share: Number(state.diagnostics?.largest_group_share ?? 0),
      selected_author_concentration: Number(state.diagnostics?.selected_author_concentration ?? 0),
      selected_content_type_distribution: selectedContentTypeDistribution,
      claim_source_diversity: Number(state.diagnostics?.claim_source_diversity ?? 0),
      per_group_selection_coverage: perGroupSelectionCoverage,
    },
  };
}

/**
 * Validates a ResearchCoverageState against Spec §9 and repository safety invariants.
 */
export function validateCoverageState(state) {
  if (!isPlainObject(state)) {
    return { ok: false, reason: 'state_not_plain_object', error: 'CoverageState must be a plain object' };
  }

  if (state.schemaVersion !== COVERAGE_STATE_SCHEMA_VERSION) {
    return { ok: false, reason: 'schema_version_mismatch', error: `Expected schemaVersion ${COVERAGE_STATE_SCHEMA_VERSION}` };
  }

  if (typeof state.planHash !== 'string' || !isValidPlanHashFormat(state.planHash)) {
    return { ok: false, reason: 'invalid_plan_hash', error: 'planHash must be a 64-char lowercase hex string' };
  }

  // 1. Retrieval Coverage Validation (§9.1)
  const ret = state.retrieval;
  if (!isPlainObject(ret)) {
    return { ok: false, reason: 'retrieval_ledger_missing', error: 'retrieval ledger must be a plain object' };
  }
  if (!Array.isArray(ret.plannedQueryVariants) || !ret.plannedQueryVariants.every((q) => typeof q === 'string' && isPlanBoundarySafeString(q))) {
    return { ok: false, reason: 'invalid_planned_query_variants', error: 'plannedQueryVariants must be an array of plan-safe strings' };
  }
  if (!Array.isArray(ret.plannedRoutes)) {
    return { ok: false, reason: 'invalid_planned_routes', error: 'plannedRoutes must be an array' };
  }
  for (const r of ret.plannedRoutes) {
    if (!isPlainObject(r) || typeof r.providerId !== 'string' || typeof r.capability !== 'string') {
      return { ok: false, reason: 'invalid_planned_route_entry', error: 'plannedRoute entry malformed' };
    }
    if (!isBoundarySafeString(r.providerId) || !isBoundarySafeString(r.capability)) {
      return { ok: false, reason: 'unsafe_planned_route_string', error: 'plannedRoute contains unsafe string' };
    }
  }
  if (!Array.isArray(ret.executedRoutes)) {
    return { ok: false, reason: 'invalid_executed_routes', error: 'executedRoutes must be an array' };
  }
  for (const r of ret.executedRoutes) {
    if (!isPlainObject(r) || typeof r.query !== 'string' || typeof r.providerId !== 'string' || typeof r.capability !== 'string') {
      return { ok: false, reason: 'invalid_executed_route_entry', error: 'executedRoute entry malformed' };
    }
    if (!isBoundarySafeString(r.query) || !isBoundarySafeString(r.providerId) || !isBoundarySafeString(r.capability)) {
      return { ok: false, reason: 'unsafe_executed_route_string', error: 'executedRoute contains unsafe string' };
    }
  }
  if (!Array.isArray(ret.providerFailures)) {
    return { ok: false, reason: 'invalid_provider_failures', error: 'providerFailures must be an array' };
  }
  for (const f of ret.providerFailures) {
    if (!isPlainObject(f) || typeof f.code !== 'string' || typeof f.class !== 'string') {
      return { ok: false, reason: 'invalid_provider_failure_entry', error: 'providerFailure entry malformed' };
    }
    if (!f.code.trim() || !f.class.trim() || !isBoundarySafeString(f.code) || !isBoundarySafeString(f.class)) {
      return { ok: false, reason: 'unsafe_provider_failure', error: 'providerFailure code/class must be safe, non-empty strings' };
    }
  }
  if (!isNonNegativeInteger(ret.fusedCandidateCount) || !isNonNegativeInteger(ret.fusedGroupCount) || !isNonNegativeInteger(ret.retrievalRounds)) {
    return { ok: false, reason: 'invalid_retrieval_counts', error: 'retrieval counts must be non-negative integers' };
  }
  if (ret.stopReason !== null && (typeof ret.stopReason !== 'string' || !isBoundarySafeString(ret.stopReason))) {
    return { ok: false, reason: 'invalid_stop_reason', error: 'stopReason must be null or a safe string' };
  }

  // 2. Source Completeness Validation (§9.2)
  const sc = state.sourceCompleteness;
  if (!isPlainObject(sc)) {
    return { ok: false, reason: 'source_completeness_missing', error: 'sourceCompleteness ledger must be a plain object' };
  }
  if (!isPlainObject(sc.perGroupStatus)) {
    return { ok: false, reason: 'invalid_per_group_status', error: 'perGroupStatus must be a plain object' };
  }

  let computedTotalSelected = 0;
  let computedTotalVerified = 0;
  let computedCapturedNotVerified = 0;

  for (const [gid, g] of Object.entries(sc.perGroupStatus)) {
    if (!isBoundarySafeString(gid)) {
      return { ok: false, reason: 'unsafe_group_id', error: `groupId ${gid} is unsafe` };
    }
    if (!isPlainObject(g)) {
      return { ok: false, reason: 'invalid_group_status_entry', error: `group entry for ${gid} must be a plain object` };
    }
    if (typeof g.captured !== 'boolean' || typeof g.verified !== 'boolean' || typeof g.partial !== 'boolean' || typeof g.failed !== 'boolean') {
      return { ok: false, reason: 'invalid_group_status_booleans', error: `group booleans malformed for ${gid}` };
    }
    if (g.verified && !g.captured) {
      return { ok: false, reason: 'impossible_accounting', error: `Group ${gid} cannot be verified without being captured` };
    }
    if (g.failed && g.verified) {
      return { ok: false, reason: 'impossible_accounting', error: `Group ${gid} cannot be both failed and verified` };
    }
    if (!isNonNegativeInteger(g.selectedCount) || !isNonNegativeInteger(g.verifiedCount)) {
      return { ok: false, reason: 'invalid_group_counts', error: `group counts malformed for ${gid}` };
    }
    if (g.verifiedCount > g.selectedCount) {
      return { ok: false, reason: 'impossible_accounting', error: `verifiedCount (${g.verifiedCount}) exceeds selectedCount (${g.selectedCount}) for group ${gid}` };
    }
    computedTotalSelected += g.selectedCount;
    computedTotalVerified += g.verifiedCount;
    if (g.captured) {
      computedCapturedNotVerified += (g.selectedCount - g.verifiedCount);
    }

    if (typeof g.paginationStatus !== 'string' || !isBoundarySafeString(g.paginationStatus)) {
      return { ok: false, reason: 'invalid_pagination_status', error: `paginationStatus malformed for ${gid}` };
    }
    if (g.evidenceRef !== null && (typeof g.evidenceRef !== 'string' || !isBoundarySafeString(g.evidenceRef))) {
      return { ok: false, reason: 'invalid_evidence_ref', error: `evidenceRef malformed for ${gid}` };
    }
  }

  const sDiag = sc.diagnostics;
  if (!isPlainObject(sDiag) || !isNonNegativeInteger(sDiag.capturedNotVerifiedCount) || !isNonNegativeInteger(sDiag.totalSelectedCount) || !isNonNegativeInteger(sDiag.totalVerifiedCount)) {
    return { ok: false, reason: 'invalid_sc_diagnostics', error: 'sourceCompleteness diagnostics must contain non-negative integers' };
  }
  if (sDiag.totalVerifiedCount > sDiag.totalSelectedCount) {
    return { ok: false, reason: 'impossible_accounting', error: `totalVerifiedCount (${sDiag.totalVerifiedCount}) exceeds totalSelectedCount (${sDiag.totalSelectedCount})` };
  }
  if (sDiag.totalSelectedCount !== computedTotalSelected || sDiag.totalVerifiedCount !== computedTotalVerified) {
    return { ok: false, reason: 'accounting_mismatch', error: `aggregate counts do not match per-group sum` };
  }
  if (sDiag.capturedNotVerifiedCount !== computedCapturedNotVerified) {
    return { ok: false, reason: 'inconsistent_captured_not_verified_count', error: `capturedNotVerifiedCount must sum selectedCount - verifiedCount only for captured groups` };
  }

  // 3. Analysis Coverage Validation (§9.3)
  const ac = state.analysisCoverage;
  if (!isPlainObject(ac)) {
    return { ok: false, reason: 'analysis_coverage_missing', error: 'analysisCoverage ledger must be a plain object' };
  }
  if (!Array.isArray(ac.selectedCorpusSourceSet) || !ac.selectedCorpusSourceSet.every((s) => typeof s === 'string' && isBoundarySafeString(s))) {
    return { ok: false, reason: 'invalid_selected_corpus_source_set', error: 'selectedCorpusSourceSet must be an array of safe strings' };
  }
  if (!Array.isArray(ac.mappedSourceSet) || !ac.mappedSourceSet.every((s) => typeof s === 'string' && isBoundarySafeString(s))) {
    return { ok: false, reason: 'invalid_mapped_source_set', error: 'mappedSourceSet must be an array of safe strings' };
  }
  if (!Array.isArray(ac.analyzedSourceSet) || !ac.analyzedSourceSet.every((s) => typeof s === 'string' && isBoundarySafeString(s))) {
    return { ok: false, reason: 'invalid_analyzed_source_set', error: 'analyzedSourceSet must be an array of safe strings' };
  }
  if (!isPlainObject(ac.perGroupMappedSourceSet) || !isPlainObject(ac.perGroupAnalyzedSourceSet)) {
    return { ok: false, reason: 'invalid_per_group_analysis_sets', error: 'perGroupMappedSourceSet and perGroupAnalyzedSourceSet must be plain objects' };
  }
  for (const [gid, arr] of Object.entries(ac.perGroupMappedSourceSet)) {
    if (!isBoundarySafeString(gid) || !Array.isArray(arr) || !arr.every((s) => typeof s === 'string' && isBoundarySafeString(s))) {
      return { ok: false, reason: 'invalid_per_group_mapped_source_set', error: 'perGroupMappedSourceSet keys and arrays must be safe strings' };
    }
  }
  for (const [gid, arr] of Object.entries(ac.perGroupAnalyzedSourceSet)) {
    if (!isBoundarySafeString(gid) || !Array.isArray(arr) || !arr.every((s) => typeof s === 'string' && isBoundarySafeString(s))) {
      return { ok: false, reason: 'invalid_per_group_analyzed_source_set', error: 'perGroupAnalyzedSourceSet keys and arrays must be safe strings' };
    }
  }
  if (typeof ac.is100PercentAnalysis !== 'boolean') {
    return { ok: false, reason: 'invalid_is100percent_boolean', error: 'is100PercentAnalysis must be a boolean' };
  }

  // 100% Analysis mechanical assertion check:
  // If is100PercentAnalysis is true, selectedCorpusSourceSet and analyzedSourceSet MUST be mechanically equal and non-empty.
  // Additionally, all evidence ref issue lists must be empty.
  if (ac.is100PercentAnalysis) {
    if (ac.selectedCorpusSourceSet.length === 0) {
      return { ok: false, reason: 'empty_corpus_cannot_be_100_percent', error: 'Cannot assert 100% analysis on an empty selected corpus' };
    }
    const selectedSorted = dedupeAndSortStrings(ac.selectedCorpusSourceSet);
    const analyzedSorted = dedupeAndSortStrings(ac.analyzedSourceSet);
    if (selectedSorted.length !== analyzedSorted.length || !selectedSorted.every((id, idx) => id === analyzedSorted[idx])) {
      return {
        ok: false,
        reason: 'analysis_coverage_set_mismatch',
        error: 'is100PercentAnalysis is true but selectedCorpusSourceSet !== analyzedSourceSet',
      };
    }
    const eri = ac.evidenceRefIssues;
    if (
      (Array.isArray(eri?.missingRefs) && eri.missingRefs.length > 0) ||
      (Array.isArray(eri?.staleRefs) && eri.staleRefs.length > 0) ||
      (Array.isArray(eri?.invalidRefs) && eri.invalidRefs.length > 0)
    ) {
      return {
        ok: false,
        reason: 'evidence_ref_issues_block_100_percent',
        error: 'is100PercentAnalysis cannot be true when missingRefs, staleRefs, or invalidRefs are non-empty',
      };
    }
  }

  // 4. Diagnostics Validation (§9.4)
  const diag = state.diagnostics;
  if (!isPlainObject(diag)) {
    return { ok: false, reason: 'diagnostics_missing', error: 'diagnostics must be a plain object' };
  }
  const rates = ['new_aspect_rate', 'new_claim_rate', 'new_expert_rate', 'new_contradiction_rate', 'novelty_gain', 'largest_group_share', 'selected_author_concentration', 'claim_source_diversity'];
  for (const r of rates) {
    if (!isRatio0to1(diag[r])) {
      return { ok: false, reason: `invalid_diagnostic_rate_${r}`, error: `${r} must be a number between 0 and 1` };
    }
  }
  if (!isNonNegativeInteger(diag.selected_source_group_count)) {
    return { ok: false, reason: 'invalid_selected_source_group_count', error: 'selected_source_group_count must be non-negative integer' };
  }

  // Artifact safety walk (no credentials, cycles, proto pollution)
  const safetyVerdict = assertArtifactSafe(state, { trustedPlanStrings: new Set(ret.plannedQueryVariants) });
  if (!safetyVerdict.ok) {
    return { ok: false, reason: 'artifact_safety_violation', error: safetyVerdict.reason };
  }

  return { ok: true, validated: canonicalizeCoverageState(state) };
}

/**
 * Creates an initial valid ResearchCoverageState.
 */
export function createInitialCoverageState({ planHash, plannedQueryVariants = [], plannedRoutes = [] }) {
  if (typeof planHash !== 'string' || !isValidPlanHashFormat(planHash)) {
    const err = new Error('planHash must be a valid 64-char lowercase hex string');
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }

  const rawState = {
    schemaVersion: COVERAGE_STATE_SCHEMA_VERSION,
    planHash,
    retrieval: {
      plannedQueryVariants: Array.isArray(plannedQueryVariants) ? plannedQueryVariants : [],
      plannedRoutes: Array.isArray(plannedRoutes) ? plannedRoutes : [],
      executedRoutes: [],
      fusedCandidateCount: 0,
      fusedGroupCount: 0,
      providerFailures: [],
      retrievalRounds: 0,
      stopReason: null,
    },
    sourceCompleteness: {
      perGroupStatus: {},
      diagnostics: {
        capturedNotVerifiedCount: 0,
        totalSelectedCount: 0,
        totalVerifiedCount: 0,
      },
    },
    analysisCoverage: {
      selectedCorpusSourceSet: [],
      mappedSourceSet: [],
      analyzedSourceSet: [],
      perGroupMappedSourceSet: {},
      perGroupAnalyzedSourceSet: {},
      evidenceRefIssues: {
        missingRefs: [],
        duplicateRefs: [],
        staleRefs: [],
        invalidRefs: [],
      },
      is100PercentAnalysis: false,
    },
    diagnostics: {
      new_aspect_rate: 0,
      new_claim_rate: 0,
      new_expert_rate: 0,
      new_contradiction_rate: 0,
      novelty_gain: 0,
      selected_source_group_count: 0,
      selected_content_by_group: {},
      largest_group_share: 0,
      selected_author_concentration: 0,
      selected_content_type_distribution: {},
      claim_source_diversity: 0,
      per_group_selection_coverage: {},
    },
  };

  const validation = validateCoverageState(rawState);
  if (!validation.ok) {
    const err = new Error(`Initial state invalid: ${validation.error}`);
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }
  return validation.validated;
}

/**
 * Assert caller authorization.
 */
function assertCallerAuthorization(caller, allowedOwners, hookName) {
  if (!caller || !allowedOwners.includes(caller)) {
    const err = new Error(`Unauthorized caller "${caller}" for hook "${hookName}". Allowed: ${allowedOwners.join(', ')}`);
    err.code = COVERAGE_ERROR_UNAUTHORIZED_OWNER;
    throw err;
  }
}

/**
 * Hook 1: Update Retrieval Coverage.
 * Owned by T06 / Retrieval Controller.
 */
export function updateRetrievalCoverage(state, update, { caller } = {}) {
  assertCallerAuthorization(caller, [OWNER_T06_RETRIEVAL, OWNER_RETRIEVAL_CONTROLLER], 'updateRetrievalCoverage');

  const current = canonicalizeCoverageState(state);
  if (!isPlainObject(update)) {
    const err = new Error('Update payload must be a plain object');
    err.code = COVERAGE_ERROR_MALFORMED_UPDATE;
    throw err;
  }

  // Reject writes to other ledgers
  if ('sourceCompleteness' in update || 'analysisCoverage' in update || 'selectedCorpusSourceSet' in update) {
    const err = new Error('Illegal write: updateRetrievalCoverage cannot write sourceCompleteness or analysisCoverage');
    err.code = COVERAGE_ERROR_ILLEGAL_WRITE;
    throw err;
  }

  const nextState = JSON.parse(JSON.stringify(current));

  if ('plannedQueryVariants' in update && Array.isArray(update.plannedQueryVariants)) {
    nextState.retrieval.plannedQueryVariants = update.plannedQueryVariants;
  }
  if ('plannedRoutes' in update && Array.isArray(update.plannedRoutes)) {
    nextState.retrieval.plannedRoutes = update.plannedRoutes;
  }
  if ('executedRoutes' in update && Array.isArray(update.executedRoutes)) {
    nextState.retrieval.executedRoutes = update.executedRoutes;
  }
  if ('fusedCandidateCount' in update && isNonNegativeInteger(update.fusedCandidateCount)) {
    nextState.retrieval.fusedCandidateCount = update.fusedCandidateCount;
  }
  if ('fusedGroupCount' in update && isNonNegativeInteger(update.fusedGroupCount)) {
    nextState.retrieval.fusedGroupCount = update.fusedGroupCount;
  }
  if ('providerFailures' in update && Array.isArray(update.providerFailures)) {
    nextState.retrieval.providerFailures = update.providerFailures;
  }
  if ('retrievalRounds' in update && isNonNegativeInteger(update.retrievalRounds)) {
    nextState.retrieval.retrievalRounds = update.retrievalRounds;
  }
  if ('stopReason' in update) {
    nextState.retrieval.stopReason = update.stopReason ? String(update.stopReason) : null;
  }
  if ('novelty_gain' in update && isRatio0to1(update.novelty_gain)) {
    nextState.diagnostics.novelty_gain = update.novelty_gain;
  }

  const validation = validateCoverageState(nextState);
  if (!validation.ok) {
    const err = new Error(`Updated state invalid: ${validation.error}`);
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }
  return validation.validated;
}

/**
 * Hook 2: Update Source Completeness.
 * Owned by T09.
 */
export function updateSourceCompleteness(state, update, { caller } = {}) {
  assertCallerAuthorization(caller, [OWNER_T09_SOURCE_COMPLETENESS], 'updateSourceCompleteness');

  const current = canonicalizeCoverageState(state);
  if (!isPlainObject(update)) {
    const err = new Error('Update payload must be a plain object');
    err.code = COVERAGE_ERROR_MALFORMED_UPDATE;
    throw err;
  }

  // Reject writes to other ledgers
  if ('retrieval' in update || 'analysisCoverage' in update || 'selectedCorpusSourceSet' in update) {
    const err = new Error('Illegal write: updateSourceCompleteness cannot write retrieval or analysisCoverage');
    err.code = COVERAGE_ERROR_ILLEGAL_WRITE;
    throw err;
  }

  const nextState = JSON.parse(JSON.stringify(current));

  if (isPlainObject(update.perGroupStatus)) {
    nextState.sourceCompleteness.perGroupStatus = {
      ...nextState.sourceCompleteness.perGroupStatus,
      ...update.perGroupStatus,
    };
  }

  if (isPlainObject(update.diagnostics)) {
    if ('capturedNotVerifiedCount' in update.diagnostics && isNonNegativeInteger(update.diagnostics.capturedNotVerifiedCount)) {
      nextState.sourceCompleteness.diagnostics.capturedNotVerifiedCount = update.diagnostics.capturedNotVerifiedCount;
    }
    if ('totalSelectedCount' in update.diagnostics && isNonNegativeInteger(update.diagnostics.totalSelectedCount)) {
      nextState.sourceCompleteness.diagnostics.totalSelectedCount = update.diagnostics.totalSelectedCount;
    }
    if ('totalVerifiedCount' in update.diagnostics && isNonNegativeInteger(update.diagnostics.totalVerifiedCount)) {
      nextState.sourceCompleteness.diagnostics.totalVerifiedCount = update.diagnostics.totalVerifiedCount;
    }
  }

  const validation = validateCoverageState(nextState);
  if (!validation.ok) {
    const err = new Error(`Updated state invalid: ${validation.error}`);
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }
  return validation.validated;
}

/**
 * Hook 3: Update Selection Accounting.
 * Owned by T12.
 */
export function updateSelectionAccounting(state, update, { caller } = {}) {
  assertCallerAuthorization(caller, [OWNER_T12_SELECTION], 'updateSelectionAccounting');

  const current = canonicalizeCoverageState(state);
  if (!isPlainObject(update)) {
    const err = new Error('Update payload must be a plain object');
    err.code = COVERAGE_ERROR_MALFORMED_UPDATE;
    throw err;
  }

  // Reject writes to mappedSourceSet or analyzedSourceSet (owned by T13) or retrieval ledger
  if ('mappedSourceSet' in update || 'analyzedSourceSet' in update || 'retrieval' in update) {
    const err = new Error('Illegal write: updateSelectionAccounting cannot write mappedSourceSet or analyzedSourceSet');
    err.code = COVERAGE_ERROR_ILLEGAL_WRITE;
    throw err;
  }

  const nextState = JSON.parse(JSON.stringify(current));

  if (Array.isArray(update.selectedCorpusSourceSet)) {
    const newSelected = dedupeAndSortStrings(update.selectedCorpusSourceSet);
    const oldSelected = current.analysisCoverage.selectedCorpusSourceSet;
    if (JSON.stringify(newSelected) !== JSON.stringify(oldSelected)) {
      // Invalidate all dependent downstream analysis state
      nextState.analysisCoverage.selectedCorpusSourceSet = newSelected;
      nextState.analysisCoverage.mappedSourceSet = [];
      nextState.analysisCoverage.analyzedSourceSet = [];
      nextState.analysisCoverage.perGroupMappedSourceSet = {};
      nextState.analysisCoverage.perGroupAnalyzedSourceSet = {};
      nextState.analysisCoverage.evidenceRefIssues = {
        missingRefs: [],
        duplicateRefs: [],
        staleRefs: [],
        invalidRefs: [],
      };
      nextState.analysisCoverage.is100PercentAnalysis = false;
    }
  }
  if ('selected_source_group_count' in update && isNonNegativeInteger(update.selected_source_group_count)) {
    nextState.diagnostics.selected_source_group_count = update.selected_source_group_count;
  }
  if (isPlainObject(update.selected_content_by_group)) {
    nextState.diagnostics.selected_content_by_group = update.selected_content_by_group;
  }
  if ('largest_group_share' in update && isRatio0to1(update.largest_group_share)) {
    nextState.diagnostics.largest_group_share = update.largest_group_share;
  }
  if ('selected_author_concentration' in update && isRatio0to1(update.selected_author_concentration)) {
    nextState.diagnostics.selected_author_concentration = update.selected_author_concentration;
  }
  if (isPlainObject(update.selected_content_type_distribution)) {
    nextState.diagnostics.selected_content_type_distribution = update.selected_content_type_distribution;
  }
  if (isPlainObject(update.per_group_selection_coverage)) {
    nextState.diagnostics.per_group_selection_coverage = update.per_group_selection_coverage;
  }

  const validation = validateCoverageState(nextState);
  if (!validation.ok) {
    const err = new Error(`Updated state invalid: ${validation.error}`);
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }
  return validation.validated;
}

/**
 * Hook 4: Update Per-group Analysis.
 * Owned by T13.
 */
export function updatePerGroupAnalysis(state, update, { caller } = {}) {
  assertCallerAuthorization(caller, [OWNER_T13_ANALYSIS], 'updatePerGroupAnalysis');

  const current = canonicalizeCoverageState(state);
  if (!isPlainObject(update)) {
    const err = new Error('Update payload must be a plain object');
    err.code = COVERAGE_ERROR_MALFORMED_UPDATE;
    throw err;
  }

  // Reject writes to selectedCorpusSourceSet (owned by T12) or retrieval ledger
  if ('selectedCorpusSourceSet' in update || 'retrieval' in update) {
    const err = new Error('Illegal write: updatePerGroupAnalysis cannot write selectedCorpusSourceSet or retrieval');
    err.code = COVERAGE_ERROR_ILLEGAL_WRITE;
    throw err;
  }

  const nextState = JSON.parse(JSON.stringify(current));

  if (Array.isArray(update.mappedSourceSet)) {
    nextState.analysisCoverage.mappedSourceSet = update.mappedSourceSet;
  }
  if (Array.isArray(update.analyzedSourceSet)) {
    nextState.analysisCoverage.analyzedSourceSet = update.analyzedSourceSet;
  }
  if (isPlainObject(update.perGroupMappedSourceSet)) {
    nextState.analysisCoverage.perGroupMappedSourceSet = update.perGroupMappedSourceSet;
  }
  if (isPlainObject(update.perGroupAnalyzedSourceSet)) {
    nextState.analysisCoverage.perGroupAnalyzedSourceSet = update.perGroupAnalyzedSourceSet;
  }
  if (isPlainObject(update.evidenceRefIssues)) {
    nextState.analysisCoverage.evidenceRefIssues = {
      ...nextState.analysisCoverage.evidenceRefIssues,
      ...update.evidenceRefIssues,
    };
  }
  if ('new_aspect_rate' in update && isRatio0to1(update.new_aspect_rate)) {
    nextState.diagnostics.new_aspect_rate = update.new_aspect_rate;
  }
  if ('new_claim_rate' in update && isRatio0to1(update.new_claim_rate)) {
    nextState.diagnostics.new_claim_rate = update.new_claim_rate;
  }
  if ('new_expert_rate' in update && isRatio0to1(update.new_expert_rate)) {
    nextState.diagnostics.new_expert_rate = update.new_expert_rate;
  }
  if ('new_contradiction_rate' in update && isRatio0to1(update.new_contradiction_rate)) {
    nextState.diagnostics.new_contradiction_rate = update.new_contradiction_rate;
  }

  const validation = validateCoverageState(nextState);
  if (!validation.ok) {
    const err = new Error(`Updated state invalid: ${validation.error}`);
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }
  return validation.validated;
}

/**
 * Hook 5: Update Synthesis Diagnostics.
 * Owned by T14.
 * Strict ownership boundary: T14 CANNOT write analyzedSourceSet or mappedSourceSet or selectedCorpusSourceSet!
 */
export function updateSynthesisDiagnostics(state, update, { caller } = {}) {
  assertCallerAuthorization(caller, [OWNER_T14_SYNTHESIS], 'updateSynthesisDiagnostics');

  const current = canonicalizeCoverageState(state);
  if (!isPlainObject(update)) {
    const err = new Error('Update payload must be a plain object');
    err.code = COVERAGE_ERROR_MALFORMED_UPDATE;
    throw err;
  }

  // Strict ownership rejection: T14 must NOT write source sets!
  if (
    'analyzedSourceSet' in update ||
    'mappedSourceSet' in update ||
    'selectedCorpusSourceSet' in update ||
    'retrieval' in update
  ) {
    const err = new Error('Illegal write: updateSynthesisDiagnostics cannot write source set identities');
    err.code = COVERAGE_ERROR_ILLEGAL_WRITE;
    throw err;
  }

  const nextState = JSON.parse(JSON.stringify(current));

  if ('claim_source_diversity' in update && isRatio0to1(update.claim_source_diversity)) {
    nextState.diagnostics.claim_source_diversity = update.claim_source_diversity;
  }
  if ('new_aspect_rate' in update && isRatio0to1(update.new_aspect_rate)) {
    nextState.diagnostics.new_aspect_rate = update.new_aspect_rate;
  }
  if ('new_claim_rate' in update && isRatio0to1(update.new_claim_rate)) {
    nextState.diagnostics.new_claim_rate = update.new_claim_rate;
  }
  if ('new_expert_rate' in update && isRatio0to1(update.new_expert_rate)) {
    nextState.diagnostics.new_expert_rate = update.new_expert_rate;
  }
  if ('new_contradiction_rate' in update && isRatio0to1(update.new_contradiction_rate)) {
    nextState.diagnostics.new_contradiction_rate = update.new_contradiction_rate;
  }

  const validation = validateCoverageState(nextState);
  if (!validation.ok) {
    const err = new Error(`Updated state invalid: ${validation.error}`);
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }
  return validation.validated;
}

/**
 * Hook 6: Final Coverage Reconciliation & 100% Analysis Assertion.
 * Owned by T15.
 */
export function reconcileFinalCoverage(state, { caller, assertFullCoverage = false } = {}) {
  assertCallerAuthorization(caller, [OWNER_T15_FINAL], 'reconcileFinalCoverage');

  const current = canonicalizeCoverageState(state);
  const selected = current.analysisCoverage.selectedCorpusSourceSet;
  const mapped = current.analysisCoverage.mappedSourceSet;
  const analyzed = current.analysisCoverage.analyzedSourceSet;

  const isSelectedNonEmpty = selected.length > 0;
  const isSelectedEqAnalyzed =
    isSelectedNonEmpty &&
    selected.length === analyzed.length &&
    selected.every((id, idx) => id === analyzed[idx]);

  const isSelectedEqMapped =
    isSelectedNonEmpty &&
    selected.length === mapped.length &&
    selected.every((id, idx) => id === mapped[idx]);

  // Ensure aggregate sets are perfectly derived from the union of per-group sets
  const perGroupMapped = dedupeAndSortStrings(Object.values(current.analysisCoverage.perGroupMappedSourceSet).flat());
  const perGroupAnalyzed = dedupeAndSortStrings(Object.values(current.analysisCoverage.perGroupAnalyzedSourceSet).flat());
  
  const isMappedEqPerGroupMapped = mapped.length === perGroupMapped.length && mapped.every((id, idx) => id === perGroupMapped[idx]);
  const isAnalyzedEqPerGroupAnalyzed = analyzed.length === perGroupAnalyzed.length && analyzed.every((id, idx) => id === perGroupAnalyzed[idx]);

  const isSetEqual = isSelectedEqAnalyzed && isSelectedEqMapped && isMappedEqPerGroupMapped && isAnalyzedEqPerGroupAnalyzed;

  const hasNoEvidenceIssues =
    current.analysisCoverage.evidenceRefIssues.missingRefs.length === 0 &&
    current.analysisCoverage.evidenceRefIssues.duplicateRefs.length === 0 &&
    current.analysisCoverage.evidenceRefIssues.invalidRefs.length === 0 &&
    current.analysisCoverage.evidenceRefIssues.staleRefs.length === 0;

  const canAssert100Percent = isSetEqual && hasNoEvidenceIssues;

  if (assertFullCoverage && !canAssert100Percent) {
    const err = new Error(
      `Cannot assert 100% Analysis Coverage: selected=${selected.length}, mapped=${mapped.length}, analyzed=${analyzed.length}, setEqual=${isSetEqual}, evidenceClean=${hasNoEvidenceIssues}`
    );
    err.code = COVERAGE_ERROR_INCOMPLETE_ANALYSIS;
    throw err;
  }

  const nextState = JSON.parse(JSON.stringify(current));
  nextState.analysisCoverage.is100PercentAnalysis = canAssert100Percent;

  const validation = validateCoverageState(nextState);
  if (!validation.ok) {
    const err = new Error(`Reconciled state invalid: ${validation.error}`);
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }
  return validation.validated;
}

/**
 * Deterministic SHA-256 hash of the canonical serialized coverage state.
 */
export function coverageStateHash(state) {
  const canonical = canonicalizeCoverageState(state);
  const json = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Persist coverage state to file.
 */
export function persistCoverageState(workDir, state) {
  const validation = validateCoverageState(state);
  if (!validation.ok) {
    const err = new Error(`Cannot persist invalid coverage state: ${validation.reason}`);
    err.code = COVERAGE_ERROR_INVALID_STATE;
    throw err;
  }
  const filePath = path.join(workDir, COVERAGE_STATE_FILENAME);
  try {
    fs.mkdirSync(workDir, { recursive: true });
    const content = JSON.stringify(validation.validated, null, 2);
    fs.writeFileSync(filePath, content, 'utf8');
    // Return work-relative filename only — never expose absolute workDir
    return { ok: true, path: COVERAGE_STATE_FILENAME, hash: coverageStateHash(validation.validated) };
  } catch (e) {
    const err = new Error('Failed to persist coverage state');
    err.code = COVERAGE_ERROR_PERSISTENCE_FAILED;
    throw err;
  }
}

/**
 * Load coverage state from file.
 */
export function loadCoverageState(workDir, expectedPlanHash = null) {
  const filePath = path.join(workDir, COVERAGE_STATE_FILENAME);
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'file_not_found', path: COVERAGE_STATE_FILENAME };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const validation = validateCoverageState(parsed);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason, error: validation.reason, path: COVERAGE_STATE_FILENAME };
    }
    if (expectedPlanHash !== null && validation.validated.planHash !== expectedPlanHash) {
      return { ok: false, reason: 'stale_plan_hash', path: COVERAGE_STATE_FILENAME };
    }
    // Return work-relative filename only — never expose absolute workDir
    return { ok: true, state: validation.validated, hash: coverageStateHash(validation.validated), path: COVERAGE_STATE_FILENAME };
  } catch (e) {
    return { ok: false, reason: 'unparseable', error: 'unparseable', path: COVERAGE_STATE_FILENAME };
  }
}
