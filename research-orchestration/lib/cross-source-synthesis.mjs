// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/cross-source-synthesis.mjs
 *
 * P1-T14 — cross-source synthesis orchestration (Issue #46).
 *
 * Authority:
 *   - docs/specs/p1-cross-question-deep-research.md §5.2 (SemanticRuntime
 *     duties: map/reduce/synthesis), §8.2/§8.3 (aggregation + synthesis
 *     semantics and forbidden patterns), §9.4 (diagnostics), §10.1
 *     (EXTERNAL_CORPUS = UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION), §10.2
 *     (FAIL_CLOSED / NO_SILENT_RUNTIME_FALLBACK / NO_SEMANTIC_DOWNGRADE).
 *   - docs/planning/P1_SEAM_CONTRACTS_V1.md §SEAM C (input) / §SEAM D (output
 *     observable shape — this module's artifact is the canonical producer of
 *     that shape; re-validated by the FROZEN validator in the test suite).
 *   - Issue #46: PRE-SYNTHESIS guard is the FIRST gate; unequal identities →
 *     FAIL_CLOSED and NO synthesis artifact (not even partial); T14 NEVER
 *     writes analyzed source-set identity (single writer = T13); diagnostics
 *     ONLY through the frozen T07 hook updateSynthesisDiagnostics.
 *
 * Pipeline (all deterministic given deterministic inputs + runtime):
 *   1. readSeamCInput            — structural gate on the SEAM C artifact;
 *   2. degradation gate          — any non-verified representation → fail
 *                                  closed (synthesizing over non-verified
 *                                  representations is a semantic downgrade);
 *                                  a structurally-valid input with ZERO verified
 *                                  claims also fails closed
 *                                  (T14_EMPTY_VERIFIED_INPUT — "empty
 *                                  saturation" must never masquerade as a
 *                                  conclusion);
 *   3. runtime pin               — injected runtime must exactly match the
 *                                  approved deepseek-api-tool-less identity
 *                                  (same discipline as planner.mjs); anything
 *                                  else → T14_RUNTIME_UNAVAILABLE, no fallback;
 *   4. PRE-SYNTHESIS guard       — mechanical identity equality; the runtime is
 *                                  invoked only AFTER the guard passes;
 *   5. Stage-1 aggregation       — lib/cross-group-aggregation.mjs (§8.2
 *                                  structure-preserving records);
 *   6. runtime aspect clustering — untrusted statements are sanitized
 *                                  (DATA_NOT_INSTRUCTION) before the runtime
 *                                  ever sees them; the runtime returns ONLY an
 *                                  aspect partition over controller-owned
 *                                  claimIds (validated, bounded —
 *                                  MODEL_GENERATED content never owns
 *                                  identity);
 *   7. artifact assembly         — §8.3 categories (mechanical precedence:
 *                                  conflicting > minority > widely-shared >
 *                                  group-specific), evidence strength, group
 *                                  differences, discussion-volume disclosure;
 *                                  answer counts NEVER enter category/weight
 *                                  decisions;
 *   8. diagnostics               — recomputed mechanically and written ONLY via
 *                                  updateSynthesisDiagnostics (caller T14).
 *
 * This module performs NO filesystem IO by design (persistence is a controller/
 * T15 concern); `workDir` is accepted for interface symmetry and ignored.
 */

import crypto from 'node:crypto';

import { readSeamCInput, runPreSynthesisGuard, GUARD_PASS } from './pre-synthesis-guard.mjs';
import {
  aggregateCrossGroupClaims,
  deriveSynthesisClaimId,
  canonicalJson,
} from './cross-group-aggregation.mjs';
import { isBoundarySafeString } from './rrf.mjs';
import { sanitizeProjectionText } from '../../corpus-anthology/lib/lmstudio-projection.mjs';
import {
  createInitialCoverageState,
  updateSynthesisDiagnostics,
  OWNER_T14_SYNTHESIS,
} from './coverage-state.mjs';

/** Approved synthesis runtime identity (Spec §5.2 policy — planner-pinned twin). */
export const T14_SYNTHESIS_RUNTIME_ID = 'deepseek-api-tool-less';
export const T14_SYNTHESIS_MODEL = 'deepseek-v4-flash';

/** Frozen §8.3 claim category vocabulary (static authority — NOT embedded in the artifact). */
const CLAIM_CATEGORIES = ['widely-shared', 'group-specific', 'minority', 'conflicting'];

/** SEAM D diagnostics keys = exactly the T14-writable set of the frozen T07 hook. */
const T14_DIAGNOSTIC_KEYS = [
  'new_aspect_rate',
  'new_claim_rate',
  'new_expert_rate',
  'new_contradiction_rate',
  'claim_source_diversity',
];

const ERROR_RUNTIME_UNAVAILABLE = 'T14_RUNTIME_UNAVAILABLE';
const ERROR_RUNTIME_OUTPUT_INVALID = 'T14_RUNTIME_OUTPUT_INVALID';
const ERROR_DEGRADED_REPRESENTATION = 'T14_DEGRADED_REPRESENTATION';
const ERROR_EMPTY_VERIFIED_INPUT = 'T14_EMPTY_VERIFIED_INPUT';
const ERROR_INPUT_INVALID = 'T14_INPUT_INVALID';
const ERROR_DIAGNOSTICS_HOOK_REJECTED = 'T14_DIAGNOSTICS_HOOK_REJECTED';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256HexOf(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Runtime identity exact-match pin (planner.mjs discipline). The synthesis
 * accepts ONLY the approved runtime; anything else fails closed with
 * NO_SILENT_RUNTIME_FALLBACK — never re-route, never degrade.
 */
function assertSynthesisRuntime(runtime) {
  return isPlainObject(runtime)
    && runtime.runtimeId === T14_SYNTHESIS_RUNTIME_ID
    && runtime.model === T14_SYNTHESIS_MODEL
    && typeof runtime.synthesize === 'function';
}

/** Mechanical §8.3 category assignment — documented precedence, zero thresholds. */
function assignCategory(constituents, support) {
  if (constituents.some((r) => r.kind === 'contradictory')) return 'conflicting';
  if (constituents.every((r) => r.kind === 'minority')) return 'minority';
  const supportGroups = new Set(support.map((s) => s.groupId));
  if (supportGroups.size >= 2) return 'widely-shared';
  return 'group-specific';
}

function dedupeBySourceRef(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (seen.has(entry.sourceRef)) continue;
    seen.add(entry.sourceRef);
    out.push(entry);
  }
  return out.sort((a, b) => (a.sourceRef < b.sourceRef ? -1 : 1));
}

/**
 * Produce the SEAM D cross-source synthesis artifact.
 *
 * @param {object} opts
 * @param {object} opts.seamCArtifact      SEAM C artifact (frozen contract).
 * @param {object} opts.runtime            INJECTED semantic runtime (mock in
 *                                         tests; no network is ever constructed
 *                                         here — the module only calls the
 *                                         injected object).
 * @param {object} [opts.coverageState]    current ResearchCoverageState; a valid
 *                                         initial state is derived from planHash
 *                                         when omitted.
 * @param {object} [opts.priorSynthesis]   previous synthesis (claims with
 *                                         aspect + sourceClaimIds) for new_*_rate
 *                                         baselines; absent → everything counts
 *                                         as new (no silent prior is invented).
 * @param {string} [opts.workDir]          reserved; this module performs no IO.
 *
 * @returns on success: { ok:true, artifact, coverageState }
 *          on failure:  { ok:false, code, errors?, preSynthesisGuard? } — and
 *          NEVER a synthesis artifact (fail-closed, no partial output).
 */
export function produceCrossSourceSynthesis({
  seamCArtifact,
  runtime = null,
  coverageState = null,
  priorSynthesis = null,
  workDir = null, // eslint-disable-line no-unused-vars — reserved, no IO by design
} = {}) {
  // 1. Structural gate on the input seam artifact.
  const input = readSeamCInput(seamCArtifact);
  if (!input.ok) {
    return { ok: false, code: ERROR_INPUT_INVALID, errors: input.errors };
  }

  // 2. Degradation gate: synthesis requires verified representations (§10.2
  //    NO_SEMANTIC_DOWNGRADE — a degraded base is never silently synthesized over).
  const degraded = seamCArtifact.groupRepresentations.filter((g) => g.completenessStatus !== 'verified');
  if (degraded.length > 0) {
    return {
      ok: false,
      code: ERROR_DEGRADED_REPRESENTATION,
      details: { groupIds: degraded.map((g) => g.groupId) },
    };
  }

  // 2b. Empty-corpus gate: a structurally-valid SEAM C input whose groups carry
  //     ZERO claims must NOT produce an "empty saturation" artifact that could
  //     masquerade as a real conclusion downstream. Spec/issue never authorized
  //     synthesis over an empty verified corpus; repo convention is
  //     fail-closed on unauthorized states → T14_EMPTY_VERIFIED_INPUT.
  const totalVerifiedClaims = seamCArtifact.groupRepresentations.reduce(
    (n, g) => n + g.claims.main.length + g.claims.minority.length + g.claims.contradictory.length,
    0,
  );
  if (totalVerifiedClaims === 0) {
    return { ok: false, code: ERROR_EMPTY_VERIFIED_INPUT };
  }

  // 3. Runtime pin — the pin happens before the guard but performs no runtime
  //    invocation; the guard strictly precedes any runtime call and any
  //    synthesis write.
  if (!assertSynthesisRuntime(runtime)) {
    return { ok: false, code: ERROR_RUNTIME_UNAVAILABLE };
  }

  // 4. PRE-SYNTHESIS guard (Issue #46 R2 F-2) — mechanical, evidence-bearing.
  const guard = runPreSynthesisGuard({
    selectedVerifiedSourceSetIdentity: input.selectedVerifiedSourceSetIdentity,
    mappedAnalyzedSourceSetIdentity: input.mappedAnalyzedSourceSetIdentity,
  });
  if (!guard.ok) {
    // FAIL_CLOSED: no synthesis artifact, not even partial. Evidence records both
    // identities (or their visible absence).
    return {
      ok: false,
      code: guard.code,
      preSynthesisGuard: {
        guardResult: guard.guardResult,
        selectedVerifiedSourceSetIdentity: guard.selectedVerifiedSourceSetIdentity,
        mappedAnalyzedSourceSetIdentity: guard.mappedAnalyzedSourceSetIdentity,
      },
    };
  }
  if (guard.guardResult !== GUARD_PASS) {
    return { ok: false, code: guard.code ?? ERROR_INPUT_INVALID };
  }

  // 5. Stage-1 mechanical aggregation (§8.2 structure-preserving records).
  const stage1 = aggregateCrossGroupClaims(seamCArtifact);
  const records = stage1.records;
  const recordsByClaimId = new Map(records.map((r) => [r.claimId, r]));

  // 6. Runtime aspect clustering — untrusted statements sanitized FIRST
  //    (EXTERNAL_CORPUS → DATA_NOT_INSTRUCTION, Spec §10.1); the runtime sees
  //    sanitized text + controller-owned opaque tokens only.
  let runtimeResult;
  try {
    runtimeResult = runtime.synthesize({
      claims: records.map((r) => ({
        claimId: r.claimId,
        groupId: r.groupId,
        kind: r.kind,
        statement: sanitizeProjectionText(r.statement),
      })),
    });
  } catch {
    return { ok: false, code: ERROR_RUNTIME_UNAVAILABLE };
  }

  // Runtime output is MODEL_GENERATED: structured validation, bounds, no identity
  // authority. It must be a PARTITION of the known claimIds; anything else → fail closed.
  const aspectClusters = validateRuntimePartition(runtimeResult, recordsByClaimId);
  if (!aspectClusters) {
    return { ok: false, code: ERROR_RUNTIME_OUTPUT_INVALID };
  }

  // 7. Artifact assembly.
  const claims = [];
  for (const { aspect, claimIds } of aspectClusters) {
    const constituents = claimIds.map((id) => recordsByClaimId.get(id));
    const support = dedupeBySourceRef(constituents.flatMap((r) => r.support));
    const oppose = dedupeBySourceRef(constituents.flatMap((r) => r.oppose));
    const sourceClaimIds = [...claimIds].sort();
    claims.push({
      claimId: deriveSynthesisClaimId(sourceClaimIds),
      aspect,
      category: assignCategory(constituents, support),
      support,
      oppose,
      expertEvidenceRichSupport: constituents.some((r) => r.expertEvidenceRichSupport),
      // additive lineage field (V1-compatible): controller-owned traceability
      sourceClaimIds,
    });
  }
  claims.sort((a, b) => (a.aspect < b.aspect ? -1 : a.aspect > b.aspect ? 1 : 0));

  const allAspects = claims.map((c) => c.aspect);
  const groupDifferences = seamCArtifact.groupRepresentations
    .map((g) => g.groupId)
    .sort()
    .map((groupId) => {
      const covered = new Set(
        claims.filter((c) => c.sourceClaimIds.some((id) => recordsByClaimId.get(id).groupId === groupId))
          .map((c) => c.aspect),
      );
      return {
        groupId,
        uncoveredAspects: allAspects.filter((a) => !covered.has(a)),
      };
    });

  const evidenceStrength = claims
    .map((c) => ({
      claimId: c.claimId,
      expertEvidenceRichSupport: c.expertEvidenceRichSupport,
      crossGroupSupport: new Set(c.support.map((s) => s.groupId)).size >= 2,
      supportSourceCount: c.support.length,
      opposeSourceCount: c.oppose.length,
    }))
    .sort((a, b) => (a.claimId < b.claimId ? -1 : 1));

  // discussionVolume is input-integrity validated in the readSeamCInput gate
  // (before any runtime invocation); here it is disclosed as a separate signal,
  // never an epistemic weight.
  const byGroup = {};
  for (const g of seamCArtifact.groupRepresentations) {
    byGroup[g.groupId] = g.discussionVolume.answerCount;
  }
  const discussionVolumeDifferences = { byGroup };

  const synthesis = {
    synthesisIdentity: `sha256:${sha256HexOf({ claims, groupDifferences, evidenceStrength, discussionVolumeDifferences })}`,
    claims,
    groupDifferences,
    evidenceStrength,
    discussionVolumeDifferences,
  };

  // 8. Diagnostics — mechanical recomputation, written ONLY through the frozen
  //    T07 hook (single authorized write path for the five owned keys).
  const diagnostics = computeDiagnostics(claims, priorSynthesis);
  let nextCoverageState;
  try {
    const baseState = coverageState ?? createInitialCoverageState({ planHash: seamCArtifact.planHash });
    nextCoverageState = updateSynthesisDiagnostics(baseState, diagnostics, { caller: OWNER_T14_SYNTHESIS });
  } catch {
    return { ok: false, code: ERROR_DIAGNOSTICS_HOOK_REJECTED };
  }

  const artifact = {
    seam: 'T14_TO_T15',
    seamVersion: 1,
    planHash: seamCArtifact.planHash,
    preSynthesisGuard: {
      guardResult: GUARD_PASS,
      selectedVerifiedSourceSetIdentity: guard.selectedVerifiedSourceSetIdentity,
      mappedAnalyzedSourceSetIdentity: guard.mappedAnalyzedSourceSetIdentity,
    },
    synthesis,
    diagnostics: { ...diagnostics },
  };

  return { ok: true, artifact, coverageState: nextCoverageState };
}

/**
 * Validate the runtime-returned aspect partition. Returns the validated cluster
 * list (aspect + claimIds) or null on any violation:
 *   - shape violations (not object/array, non-string/non-safe aspect);
 *   - unknown claimIds (model-minted identity — forbidden);
 *   - duplicates or incomplete coverage (not a partition).
 */
function validateRuntimePartition(runtimeResult, recordsByClaimId) {
  if (!isPlainObject(runtimeResult) || !Array.isArray(runtimeResult.aspects)) return null;
  const seen = new Set();
  const clusters = [];
  for (const entry of runtimeResult.aspects) {
    if (!isPlainObject(entry) || !Array.isArray(entry.claimIds)) return null;
    const aspect = entry.aspect;
    if (typeof aspect !== 'string' || aspect.length === 0 || aspect.length > 300 || !isBoundarySafeString(aspect)) {
      return null;
    }
    for (const id of entry.claimIds) {
      if (typeof id !== 'string' || !recordsByClaimId.has(id) || seen.has(id)) return null;
      seen.add(id);
    }
    clusters.push({ aspect, claimIds: entry.claimIds });
  }
  if (seen.size !== recordsByClaimId.size) return null;
  // deterministic order independent of runtime iteration order
  clusters.sort((a, b) => (a.aspect < b.aspect ? -1 : 1));
  return clusters;
}

/**
 * Diagnostics recomputation (Spec §9.4 keys, mechanically defined):
 *   new_aspect_rate / new_claim_rate — share of aspects / constituent claimIds
 *     not present in priorSynthesis (absent prior → all new: no prior is ever
 *     invented silently);
 *   new_expert_rate                  — share of claims with expert/evidence-rich
 *     support;
 *   new_contradiction_rate           — share of 'conflicting' claims;
 *   claim_source_diversity           — distinct sourceRefs / total support+oppose
 *     reference slots across all claims.
 * Empty synthesis → all rates 0 (degenerate but honest denominators, no NaN).
 */
function computeDiagnostics(claims, priorSynthesis) {
  const total = claims.length;
  if (total === 0) {
    return {
      new_aspect_rate: 0,
      new_claim_rate: 0,
      new_expert_rate: 0,
      new_contradiction_rate: 0,
      claim_source_diversity: 0,
    };
  }

  const priorAspects = new Set(
    isPlainObject(priorSynthesis) && Array.isArray(priorSynthesis.claims)
      ? priorSynthesis.claims.map((c) => c.aspect).filter((a) => typeof a === 'string')
      : [],
  );
  const priorClaimIds = new Set(
    isPlainObject(priorSynthesis) && Array.isArray(priorSynthesis.claims)
      ? priorSynthesis.claims.flatMap((c) => (Array.isArray(c.sourceClaimIds) ? c.sourceClaimIds : []))
      : [],
  );

  const aspects = [...new Set(claims.map((c) => c.aspect))];
  const sourceClaimIds = claims.flatMap((c) => c.sourceClaimIds);
  const allRefs = claims.flatMap((c) => [...c.support, ...c.oppose].map((s) => s.sourceRef));

  const ratio = (numerator, denominator) => (denominator === 0 ? 0 : numerator / denominator);

  return {
    new_aspect_rate: ratio(aspects.filter((a) => !priorAspects.has(a)).length, aspects.length),
    new_claim_rate: ratio(sourceClaimIds.filter((id) => !priorClaimIds.has(id)).length, sourceClaimIds.length),
    new_expert_rate: ratio(claims.filter((c) => c.expertEvidenceRichSupport).length, total),
    new_contradiction_rate: ratio(claims.filter((c) => c.category === 'conflicting').length, total),
    claim_source_diversity: ratio(new Set(allRefs).size, allRefs.length),
  };
}

export { T14_DIAGNOSTIC_KEYS, CLAIM_CATEGORIES };
