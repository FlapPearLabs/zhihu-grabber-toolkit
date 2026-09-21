// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/cross-source-synthesis.mjs
 *
 * P1-T14 — cross-source synthesis orchestration (Issue #46), SEAM D V2
 * production producer (P1-R05 / Issue #93).
 *
 * Authority:
 *   - docs/specs/p1-cross-question-deep-research.md §5.2 (SemanticRuntime
 *     duties: map/reduce/synthesis), §8.2/§8.3 (aggregation + synthesis
 *     semantics and forbidden patterns), §9.4 (diagnostics), §10.1
 *     (EXTERNAL_CORPUS = UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION), §10.2
 *     (FAIL_CLOSED / NO_SILENT_RUNTIME_FALLBACK / NO_SEMANTIC_DOWNGRADE),
 *     §11 (versioning).
 *   - docs/specs/p1-cross-question-deep-research.md 2026-09-19 repair
 *     amendment (effective S1): proposition families, claim-level stance
 *     (ASSERTS/OPPOSES/UNRESOLVED), ORTHOGONAL relationStatus +
 *     supportBreadth, independent unresolved records, complete input
 *     partition, complete original claim lineage.
 *   - docs/planning/P1_SEAM_CONTRACTS_V1.md §SEAM C (input) / §SEAM D V2
 *     (output observable shape — this module is the canonical producer of that
 *     shape; re-validated by the FROZEN V2 validator in the test suite).
 *   - Issue #46: PRE-SYNTHESIS guard is the FIRST gate; unequal identities →
 *     FAIL_CLOSED and NO synthesis artifact (not even partial); T14 NEVER
 *     writes analyzed source-set identity (single writer = T13); diagnostics
 *     ONLY through the frozen T07 hook updateSynthesisDiagnostics.
 *
 * Pipeline (all deterministic given deterministic inputs + runtime):
 *   0. input snapshot            — the untrusted seamCArtifact is deep-copied
 *                                  ONCE, at the very first read (every own
 *                                  property — including hostile accessors —
 *                                  is read exactly once into a plain-data
 *                                  snapshot); validation, guard, aggregation
 *                                  and synthesis then ALL operate on that one
 *                                  snapshot (TOCTOU seal). Getter throws /
 *                                  non-JSON values / cycles → coded
 *                                  T14_INPUT_INVALID, never a bare throw;
 *   1. readSeamCInput            — structural gate on the snapshot;
 *   2. degradation gate          — any non-verified representation → fail
 *                                  closed; a structurally-valid input with
 *                                  ZERO verified claims also fails closed
 *                                  (T14_EMPTY_VERIFIED_INPUT);
 *   3. runtime pin               — injected runtime must exactly match the
 *                                  approved deepseek-api-tool-less identity;
 *   4. PRE-SYNTHESIS guard       — mechanical identity equality; the runtime is
 *                                  invoked only AFTER the guard passes;
 *   5. Stage-1 aggregation       — lib/cross-group-aggregation.mjs (complete
 *                                  original lineage; NO group-local kind →
 *                                  global opposition inference);
 *   6. runtime V2 proposal       — untrusted statements are sanitized
 *                                  (DATA_NOT_INSTRUCTION) before the runtime
 *                                  ever sees them; the runtime proposes
 *                                  proposition families + per-claim stance +
 *                                  independent unresolved, over controller-owned
 *                                  opaque claimIds. Controller re-validates:
 *                                  complete partition, known/unique ids, legal
 *                                  stances, anchor membership + self-ASSERT.
 *                                  MODEL_GENERATED content never owns identity;
 *   7. V2 artifact assembly      — controller DERIVES the orthogonal state:
 *                                    relationStatus = OPPOSES present ?
 *                                      CONFLICTING : SUPPORT_ONLY
 *                                    supportBreadth = distinct ASSERTS groups
 *                                      >= 2 ? MULTI_GROUP : SINGLE_GROUP
 *                                  and derives support/oppose as the FULL
 *                                  lineage of the ASSERTS/OPPOSES members (no
 *                                  dedupe by sourceRef). Legacy category is
 *                                  NEVER an input to either dimension;
 *   8. diagnostics               — recomputed from canonical V2 state
 *                                  (new_contradiction_rate reads
 *                                  relationStatus == CONFLICTING, never a
 *                                  legacy category) and written ONLY via
 *                                  updateSynthesisDiagnostics (caller T14).
 *
 * This module performs NO filesystem IO by design (persistence is a controller/
 * T15 concern); `workDir` is accepted for interface symmetry and ignored.
 */

import crypto from 'node:crypto';

import { readSeamCInput, runPreSynthesisGuard, GUARD_PASS } from './pre-synthesis-guard.mjs';
import {
  aggregateCrossGroupClaims,
  lineageEntries,
  deriveFamilyKey,
  canonicalJson,
  SYNTHESIS_SEMANTIC_CONTRACT_VERSION,
} from './cross-group-aggregation.mjs';
import { isBoundarySafeString } from './rrf.mjs';
import { sanitizeProjectionText } from '../../corpus-anthology/lib/lmstudio-projection.mjs';
import {
  createInitialCoverageState,
  updateSynthesisDiagnostics,
  OWNER_T14_SYNTHESIS,
} from './coverage-state.mjs';

/** Approved synthesis runtime identity (Spec §5.2 policy — planner-pinned twin).
 * OWNER RULING 2026-09-10: request model = deepseek-v4-pro; served naming is
 * observability only (never an equality gate). */
export const T14_SYNTHESIS_RUNTIME_ID = 'deepseek-api-tool-less';
export const T14_SYNTHESIS_MODEL = 'deepseek-v4-pro';

/** SEAM D V2 majors — emitted on every artifact, never defaulted from V1. */
export const SEAM_D_SEAM_VERSION = 2;
export const SEAM_D_SEMANTIC_CONTRACT_VERSION = SYNTHESIS_SEMANTIC_CONTRACT_VERSION;

/** Canonical V2 stance vocabulary for RESOLVED family members. */
export const V2_RESOLVED_STANCES = ['ASSERTS', 'OPPOSES'];
/** Canonical V2 orthogonal relation states. */
export const V2_RELATION_STATUSES = ['SUPPORT_ONLY', 'CONFLICTING'];
export const V2_SUPPORT_BREADTHS = ['SINGLE_GROUP', 'MULTI_GROUP'];

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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Deep structural snapshot of the untrusted SEAM C input.
 *
 * Properties (adversarial round 2, H2/H1):
 *   - SINGLE READ: every own property of the input is read EXACTLY once
 *     (Reflect.ownKeys — hostile accessors are invoked once, whether or not
 *     they are enumerable); the returned graph is plain data with own data
 *     properties only. Any read after the snapshot is getter-free, so the
 *     guard, the aggregation and the synthesis physically cannot observe
 *     divergent bytes of the same input.
 *   - FULL DETACHMENT: values are copied by value (deep); the output shares
 *     no object identity with the input, so later mutation of the input (or
 *     of objects reachable from it) cannot change what the pipeline sees.
 *   - FAIL CLOSED on non-JSON values (function/symbol/bigint) and cyclic
 *     graphs (SEAM C is a frozen JSON contract; the caller maps the throw to
 *     coded T14_INPUT_INVALID — never a bare throw from the exported entry).
 *   - defineProperty is used so a literal `__proto__` own key is copied as an
 *     own data property instead of dispatching through the prototype setter.
 */
function deepSnapshot(value, seen = new Set()) {
  const t = typeof value;
  if (value === undefined || value === null || t === 'string' || t === 'number' || t === 'boolean') {
    return value;
  }
  if (t !== 'object' || seen.has(value)) {
    throw new TypeError('SEAM C input is not a JSON-safe acyclic value');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => deepSnapshot(entry, seen));
  }
  const out = {};
  for (const key of Reflect.ownKeys(value)) {
    Object.defineProperty(out, key, {
      value: deepSnapshot(value[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function sha256HexOf(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Emission-order-independent normalization used ONLY for identity hashing
 * (SEAM D V2 IDENTITY_FIELDS: 集合性质的数组以 controller identity 及规范内容
 * 作稳定全序，排除模型 emission order 的偶然影响). Pure array emission order
 * must never change canonical identity; object keys are sorted at
 * serialization time by canonicalJson.
 */
function normalizeForHash(value) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeForHash)
      .sort((a, b) => {
        const ea = canonicalJson(a);
        const eb = canonicalJson(b);
        return ea < eb ? -1 : ea > eb ? 1 : 0;
      });
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeForHash(v);
    return out;
  }
  return value;
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

/**
 * Validate the runtime-returned SEAM D V2 proposal.
 *
 * The runtime is MODEL_GENERATED: it may propose families/stances/unresolved,
 * but it owns NO identity and no orthogonal state. Returns
 * { ok: true, families, unresolvedIds } or { ok: false } on ANY violation:
 *   - shape violations (not object/array, non-string/unsafe aspect);
 *   - unknown / duplicate / missing claimIds (model-minted identity or an
 *     incomplete partition — REQUIRED_INVARIANTS 3);
 *   - empty family (a resolved family is never empty — F06 evidence closure);
 *   - illegal stance (resolved members allow only ASSERTS/OPPOSES);
 *   - anchor not a member, or anchor that does not self-ASSERT;
 *   - family/unresolved overlap;
 *   - families and unresolved both empty;
 *   - a V1 `aspects`-shaped proposal (no silent V1→V2 migration: the missing
 *     semantic version is never defaulted).
 */
function validateRuntimeProposalV2(runtimeResult, recordsByClaimId) {
  if (!isPlainObject(runtimeResult)) return { ok: false };
  // V1 masquerade guard: the legacy aspect-partition shape carries no stance
  // and no semantic version. It is HISTORICAL_ONLY and is never laundered.
  if (Array.isArray(runtimeResult.aspects)) return { ok: false };
  if (!Array.isArray(runtimeResult.families)) return { ok: false };
  if (!Array.isArray(runtimeResult.unresolvedClaimIds)) return { ok: false };

  const families = [];
  const seen = new Set();

  for (const entry of runtimeResult.families) {
    if (!isPlainObject(entry)) return { ok: false };
    const aspect = entry.aspect;
    if (typeof aspect !== 'string' || aspect.length === 0 || aspect.length > 300 || !isBoundarySafeString(aspect)) {
      return { ok: false };
    }
    if (!Array.isArray(entry.members) || entry.members.length === 0) return { ok: false };
    if (!isNonEmptyString(entry.anchorClaimId)) return { ok: false };

    const members = [];
    const localIds = new Set();
    for (const member of entry.members) {
      if (!isPlainObject(member) || !isNonEmptyString(member.claimId)) return { ok: false };
      if (!V2_RESOLVED_STANCES.includes(member.stance)) return { ok: false };
      if (!recordsByClaimId.has(member.claimId)) return { ok: false };
      if (localIds.has(member.claimId)) return { ok: false };
      if (seen.has(member.claimId)) return { ok: false };
      localIds.add(member.claimId);
      seen.add(member.claimId);
      members.push({ claimId: member.claimId, stance: member.stance });
    }
    // anchor must be a member AND self-ASSERT (no free-text proposition
    // rewriting, no anchor that opposes itself).
    if (!localIds.has(entry.anchorClaimId)) return { ok: false };
    if (!members.some((m) => m.claimId === entry.anchorClaimId && m.stance === 'ASSERTS')) return { ok: false };

    families.push({ aspect, anchorClaimId: entry.anchorClaimId, members });
  }

  const unresolvedIds = [];
  for (const id of runtimeResult.unresolvedClaimIds) {
    if (!isNonEmptyString(id)) return { ok: false };
    if (!recordsByClaimId.has(id)) return { ok: false };
    if (seen.has(id)) return { ok: false }; // family/unresolved overlap
    seen.add(id);
    unresolvedIds.push(id);
  }

  // Complete partition of every input claim, exactly once.
  if (seen.size !== recordsByClaimId.size) return { ok: false };
  // families and unresolved may not both be empty.
  if (families.length === 0 && unresolvedIds.length === 0) return { ok: false };

  return { ok: true, families, unresolvedIds };
}

/**
 * Assemble one canonical V2 proposition family from a validated runtime
 * proposal + the controller-owned aggregation records.
 *
 * Controller-derived (never model-supplied, never inferred from `kind` or from
 * any legacy category):
 *   familyKey        — deterministic, run-scoped
 *   relationStatus   — OPPOSES present ? CONFLICTING : SUPPORT_ONLY
 *   supportBreadth   — distinct ASSERTS groups >= 2 ? MULTI_GROUP : SINGLE_GROUP
 *   support / oppose — the FULL lineage of the ASSERTS / OPPOSES members; no
 *                      dedupe by sourceRef (Case F keeps both same-source
 *                      lineages)
 *   expertEvidenceRichSupport — ASSERTS-side refs ∩ expertEvidenceRichRefs;
 *                      never granted from the opposing side.
 */
function buildFamilyV2({ aspect, anchorClaimId, members }, recordsByClaimId) {
  const sourceClaims = members.map((m) => {
    const record = recordsByClaimId.get(m.claimId);
    return {
      sourceClaimId: record.claimId,
      statement: record.statement,
      // kind survives as GROUP-LOCAL METADATA ONLY — it never becomes a global
      // minority taxonomy and never decides relation/breadth.
      kind: record.kind,
      sourceRefs: record.sourceRefs.map((r) => ({
        sourceRef: r.sourceRef,
        groupId: r.groupId,
        authorRef: r.authorRef ?? null,
      })),
    };
  });

  const relationships = members.map((m) => ({ sourceClaimId: m.claimId, stance: m.stance }));

  const support = [];
  const oppose = [];
  for (const m of members) {
    const side = m.stance === 'ASSERTS' ? support : oppose;
    side.push(...lineageEntries(recordsByClaimId.get(m.claimId)));
  }

  const anchorRecord = recordsByClaimId.get(anchorClaimId);
  const assertsGroups = new Set(support.map((s) => s.groupId));

  return {
    familyKey: deriveFamilyKey({ aspect, anchorClaimId, members }),
    aspect,
    anchor: { sourceClaimId: anchorClaimId, statement: anchorRecord.statement },
    relationships,
    sourceClaims,
    relationStatus: oppose.length > 0 ? 'CONFLICTING' : 'SUPPORT_ONLY',
    supportBreadth: assertsGroups.size >= 2 ? 'MULTI_GROUP' : 'SINGLE_GROUP',
    support,
    oppose,
    expertEvidenceRichSupport: members
      .filter((m) => m.stance === 'ASSERTS')
      .some((m) => recordsByClaimId.get(m.claimId).expertEvidenceRichSupport),
  };
}

/**
 * ONE-WAY legacy display projection (SEAM D V2 BACKWARD_COMPATIBILITY).
 *
 * Allowed direction: canonical V2 → LEGACY_DERIVED_VIEW. Never the reverse:
 * legacy → relationStatus/supportBreadth is forbidden, and this view is NOT
 * part of the canonical hash payload.
 *
 * Frozen mapping:
 *   CONFLICTING                     → conflicting
 *   otherwise MULTI_GROUP           → widely-shared   (Case B keeps MULTI_GROUP)
 *   otherwise SINGLE_GROUP          → group-specific
 *   UNRESOLVED                      → no legacy category (null)
 */
export function deriveLegacyView({ families = [], unresolved = [] } = {}) {
  const legacyCategoryOf = (family) => {
    if (family.relationStatus === 'CONFLICTING') return 'conflicting';
    if (family.supportBreadth === 'MULTI_GROUP') return 'widely-shared';
    if (family.supportBreadth === 'SINGLE_GROUP') return 'group-specific';
    return null;
  };
  return {
    derivedFrom: 'canonical V2 families/unresolved (one-way presentation; never an input to relationStatus/supportBreadth)',
    families: families.map((f) => ({
      familyKey: f.familyKey,
      legacyCategory: legacyCategoryOf(f),
      relationStatus: f.relationStatus,
      supportBreadth: f.supportBreadth,
    })),
    unresolved: unresolved.map((r) => ({
      sourceClaimId: r.sourceClaim?.sourceClaimId ?? null,
      legacyCategory: null,
      relationStatus: 'UNRESOLVED',
      supportBreadth: null,
    })),
  };
}

/**
 * Produce the SEAM D V2 cross-source synthesis artifact.
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
 * @param {object} [opts.priorSynthesis]   previous V2 synthesis (families with
 *                                         aspect + sourceClaim lineage) for
 *                                         new_*_rate baselines; absent →
 *                                         everything counts as new (no silent
 *                                         prior is invented).
 * @param {string} [opts.workDir]          reserved; this module performs no IO.
 *
 * @returns on success (awaited): { ok:true, artifact, coverageState }
 *          on failure (awaited): { ok:false, code, errors?, preSynthesisGuard? }
 *          — and NEVER a synthesis artifact (fail-closed, no partial output).
 *
 * ASYNC SEAM CONTRACT (D6 repair): `runtime.synthesize(input)` is a Promise by
 * canonical contract — the production DeepSeek adapter returns `chatJson(...)`,
 * which is async. This module is therefore uniformly `async` and `await`s the
 * runtime exactly once. There is ONE contract (Promise-returning); the module
 * never inspects the return value for "Promise-ness", never branches on a
 * runtime type, and never supports a `Result | Promise<Result>` union. That
 * `await` also accepts a plain value is a JavaScript semantic and nothing more
 * — synchronous test doubles rely on it as a convenience only.
 */
export async function produceCrossSourceSynthesis({
  seamCArtifact,
  runtime = null,
  coverageState = null,
  priorSynthesis = null,
  workDir = null, // eslint-disable-line no-unused-vars — reserved, no IO by design
} = {}) {
  // 0. SINGLE-READ input snapshot (H2/H1, adversarial round 2): the ONLY read
  //    of the untrusted artifact happens here; validation (step 1), the guard
  //    (step 4), aggregation (step 5) and assembly (step 7) all run on the
  //    snapshot, so guard PASS and synthesis content are computed from one
  //    consistent set of bytes. Hostile getters that throw, or the input
  //    being non-JSON/cyclic, are coded failures — never a bare throw.
  let seamC;
  try {
    seamC = deepSnapshot(seamCArtifact);
  } catch {
    return {
      ok: false,
      code: ERROR_INPUT_INVALID,
      errors: [{ code: 'SEAM_C_INPUT_SNAPSHOT_FAILED', path: '$', detail: 'input must be a JSON-safe acyclic value; hostile accessors are not readable consistently' }],
    };
  }

  // 1. Structural gate on the snapshot (not the raw input — same bytes as
  //    every later stage).
  const input = readSeamCInput(seamC);
  if (!input.ok) {
    return { ok: false, code: ERROR_INPUT_INVALID, errors: input.errors };
  }

  // 2. Degradation gate: synthesis requires verified representations (§10.2
  //    NO_SEMANTIC_DOWNGRADE — a degraded base is never silently synthesized over).
  const degraded = seamC.groupRepresentations.filter((g) => g.completenessStatus !== 'verified');
  if (degraded.length > 0) {
    return {
      ok: false,
      code: ERROR_DEGRADED_REPRESENTATION,
      details: { groupIds: degraded.map((g) => g.groupId) },
    };
  }

  // 2b. Empty-corpus gate: a structurally-valid SEAM C input whose groups carry
  //     ZERO claims must NOT produce an "empty saturation" artifact that could
  //     masquerade as a real conclusion downstream (T14_EMPTY_VERIFIED_INPUT).
  const totalVerifiedClaims = seamC.groupRepresentations.reduce(
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

  // 5. Stage-1 mechanical aggregation — complete original lineage, NO group-local
  //    kind → global opposition inference (P1-R05 removes the F03 root cause).
  const stage1 = aggregateCrossGroupClaims(seamC);
  const records = stage1.records;
  const recordsByClaimId = new Map(records.map((r) => [r.claimId, r]));

  // 6. Runtime V2 proposition proposal — untrusted statements sanitized FIRST
  //    (EXTERNAL_CORPUS → DATA_NOT_INSTRUCTION, Spec §10.1); the runtime sees
  //    sanitized text + controller-owned opaque tokens only.
  //
  //    ASYNC SEAM (D6): the runtime seam is Promise-returning by canonical
  //    contract, so this is the SINGLE `await` on the injected runtime. The
  //    try/catch deliberately wraps the await so the two fail-closed classes
  //    stay disjoint and never collapse:
  //      - Promise rejection / transport failure → T14_RUNTIME_UNAVAILABLE
  //      - resolved but structurally invalid output → T14_RUNTIME_OUTPUT_INVALID
  //    (the latter is validated AFTER the await, outside this catch).
  let runtimeResult;
  try {
    runtimeResult = await runtime.synthesize({
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
  // authority. It must be a complete V2 partition with legal stances/anchors.
  const proposal = validateRuntimeProposalV2(runtimeResult, recordsByClaimId);
  if (!proposal.ok) {
    return { ok: false, code: ERROR_RUNTIME_OUTPUT_INVALID };
  }

  // 7. V2 artifact assembly — controller-owned identities and orthogonal state.
  const families = proposal.families
    .map((p) => buildFamilyV2(p, recordsByClaimId))
    // Total order (adversarial round 2, C5): aspect, then familyKey (unique),
    // then canonical JSON of the family as a content-level backstop, so the
    // artifact is invariant under the runtime's emission order.
    .sort((a, b) => (a.aspect < b.aspect ? -1 : a.aspect > b.aspect ? 1 : 0)
      || (a.familyKey < b.familyKey ? -1 : a.familyKey > b.familyKey ? 1 : 0)
      || (canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0));

  const unresolved = proposal.unresolvedIds
    .map((id) => {
      const record = recordsByClaimId.get(id);
      return {
        sourceClaim: {
          sourceClaimId: record.claimId,
          statement: record.statement,
          kind: record.kind,
          sourceRefs: record.sourceRefs.map((r) => ({
            sourceRef: r.sourceRef,
            groupId: r.groupId,
            authorRef: r.authorRef ?? null,
          })),
        },
        stance: 'UNRESOLVED',
        relationStatus: 'UNRESOLVED',
        supportBreadth: null,
      };
    })
    .sort((a, b) => (a.sourceClaim.sourceClaimId < b.sourceClaim.sourceClaimId ? -1 : 1));

  const allAspects = [...new Set(families.map((f) => f.aspect))];
  const groupDifferences = seamC.groupRepresentations
    .map((g) => g.groupId)
    .sort()
    .map((groupId) => {
      const covered = new Set(
        families
          .filter((f) => f.sourceClaims.some((c) => c.sourceRefs.some((r) => r.groupId === groupId)))
          .map((f) => f.aspect),
      );
      return {
        groupId,
        uncoveredAspects: allAspects.filter((a) => !covered.has(a)),
      };
    });

  const evidenceStrength = families
    .map((f) => ({
      familyKey: f.familyKey,
      expertEvidenceRichSupport: f.expertEvidenceRichSupport,
      crossGroupSupport: new Set(f.support.map((s) => s.groupId)).size >= 2,
      supportSourceCount: f.support.length,
      opposeSourceCount: f.oppose.length,
    }))
    .sort((a, b) => (a.familyKey < b.familyKey ? -1 : 1));

  // discussionVolume is input-integrity validated in the readSeamCInput gate
  // (before any runtime invocation); here it is disclosed as a separate signal,
  // never an epistemic weight.
  const byGroup = {};
  for (const g of seamC.groupRepresentations) {
    byGroup[g.groupId] = g.discussionVolume.answerCount;
  }
  const discussionVolumeDifferences = { byGroup };

  const preSynthesisGuard = {
    guardResult: GUARD_PASS,
    selectedVerifiedSourceSetIdentity: guard.selectedVerifiedSourceSetIdentity,
    mappedAnalyzedSourceSetIdentity: guard.mappedAnalyzedSourceSetIdentity,
  };

  const synthesisContent = { families, unresolved, groupDifferences, evidenceStrength, discussionVolumeDifferences };

  // Canonical identity (SEAM D V2 IDENTITY_FIELDS): seam/semantic contract
  // version + planHash + guard identity chain + the canonical synthesis content
  // WITHOUT the identity itself. Diagnostics (derived disclosure) and
  // LEGACY_DERIVED_VIEW (one-way presentation) are deliberately NOT part of the
  // canonical hash payload.
  const synthesisIdentity = `sha256:${sha256HexOf({
    seam: 'T14_TO_T15',
    seamVersion: SEAM_D_SEAM_VERSION,
    semanticContractVersion: SEAM_D_SEMANTIC_CONTRACT_VERSION,
    planHash: seamC.planHash,
    preSynthesisGuard,
    synthesis: normalizeForHash(synthesisContent),
  })}`;

  const synthesis = {
    synthesisIdentity,
    ...synthesisContent,
  };

  // 8. Diagnostics — recomputed from CANONICAL V2 state and written ONLY through
  //    the frozen T07 hook (single authorized write path for the five owned keys).
  const diagnostics = computeDiagnosticsV2({ families, unresolved }, priorSynthesis);
  let nextCoverageState;
  try {
    const baseState = coverageState ?? createInitialCoverageState({ planHash: seamC.planHash });
    nextCoverageState = updateSynthesisDiagnostics(baseState, diagnostics, { caller: OWNER_T14_SYNTHESIS });
  } catch {
    return { ok: false, code: ERROR_DIAGNOSTICS_HOOK_REJECTED };
  }

  const artifact = {
    seam: 'T14_TO_T15',
    seamVersion: SEAM_D_SEAM_VERSION,
    semanticContractVersion: SEAM_D_SEMANTIC_CONTRACT_VERSION,
    planHash: seamC.planHash,
    preSynthesisGuard,
    synthesis,
    diagnostics: { ...diagnostics },
    // One-way canonical → legacy display projection. NOT part of the canonical
    // hash payload; changing or deleting it must never change canonical
    // identity, support/oppose, relation/breadth or diagnostics.
    legacyDerivedView: deriveLegacyView({ families, unresolved }),
  };

  return { ok: true, artifact, coverageState: nextCoverageState };
}

/**
 * SEAM D V2 diagnostics recomputation (Spec §9.4 keys, mechanically defined).
 *
 * Population = canonical output records (families + unresolved) — the V2
 * analogue of the frozen V1 "output synthesis records" denominator.
 *
 *   new_aspect_rate / new_claim_rate — share of family aspects / constituent
 *     sourceClaimIds not present in priorSynthesis (absent prior → all new:
 *     no prior is ever invented silently);
 *   new_expert_rate                  — share of records carrying expert /
 *     evidence-rich support (an unresolved record never does);
 *   new_contradiction_rate           — share of records whose canonical
 *     relationStatus === CONFLICTING. NEVER read from a legacy category;
 *   claim_source_diversity           — distinct sourceRefs / total canonical
 *     support+oppose reference slots.
 *
 * Empty population → all rates 0 (degenerate but honest denominators, no NaN);
 * an empty population is nevertheless never produced: zero legal input fails
 * closed as T14_EMPTY_VERIFIED_INPUT before this point.
 */
function computeDiagnosticsV2({ families, unresolved }, priorSynthesis) {
  const total = families.length + unresolved.length;
  if (total === 0) {
    return {
      new_aspect_rate: 0,
      new_claim_rate: 0,
      new_expert_rate: 0,
      new_contradiction_rate: 0,
      claim_source_diversity: 0,
    };
  }

  const priorV2 = isPlainObject(priorSynthesis) && Array.isArray(priorSynthesis.families);
  const priorAspects = new Set(
    priorV2 ? priorSynthesis.families.map((f) => f.aspect).filter((a) => typeof a === 'string') : [],
  );
  const priorClaimIds = new Set(
    priorV2
      ? priorSynthesis.families.flatMap((f) => (Array.isArray(f.sourceClaims)
        ? f.sourceClaims.map((c) => c.sourceClaimId)
        : []))
      : [],
  );

  const aspects = [...new Set(families.map((f) => f.aspect))];
  const sourceClaimIds = [
    ...families.flatMap((f) => f.sourceClaims.map((c) => c.sourceClaimId)),
    ...unresolved.map((r) => r.sourceClaim.sourceClaimId),
  ];
  const allRefs = families.flatMap((f) => [...f.support, ...f.oppose].map((s) => s.sourceRef));

  const ratio = (numerator, denominator) => (denominator === 0 ? 0 : numerator / denominator);

  return {
    new_aspect_rate: ratio(aspects.filter((a) => !priorAspects.has(a)).length, aspects.length),
    new_claim_rate: ratio(sourceClaimIds.filter((id) => !priorClaimIds.has(id)).length, sourceClaimIds.length),
    new_expert_rate: ratio(families.filter((f) => f.expertEvidenceRichSupport).length, total),
    new_contradiction_rate: ratio(families.filter((f) => f.relationStatus === 'CONFLICTING').length, total),
    claim_source_diversity: ratio(new Set(allRefs).size, allRefs.length),
  };
}

export { T14_DIAGNOSTIC_KEYS, validateRuntimeProposalV2 };
