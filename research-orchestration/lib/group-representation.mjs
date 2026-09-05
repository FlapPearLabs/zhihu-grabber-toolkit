// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/group-representation.mjs
 *
 * P1-T13 — Question/Source-group representation + analyzed source-set identity
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §8.1 / §9.2 / §9.3;
 * Issue #45; SEAM C = T13_TO_T14 V1).
 *
 * INPUT  = SEAM B artifact (Selected Verified Research Corpus; frozen fixture
 *          test/fixtures/p1-seams/seam-b/). UPSTREAM_SEAM = T12_TO_T13_V1;
 *          this module develops against the FROZEN FIXTURE, not against T12 code
 *          (INTEGRATION_STATUS = NOT_YET_REAL_UPSTREAM).
 * OUTPUT = SEAM C shape: group representations + aggregate analyzed identity.
 *
 * Single-owner clause (Issue #45 / Ticket Graph §B / key-decisions D10):
 *   ANALYZED_SOURCE_SET_IDENTITY_OWNER = P1-T13. This module is the ONLY place
 *   in this codebase where mapped/analyzed source-set identities are derived;
 *   T14 only consumes, T15 only audits. The derivation is mechanical:
 *     - per-group identity  = sha256 over {groupId, analyzed sorted id set};
 *     - aggregate identity  = selectedCorpusIdentity (byte-identical echo) when
 *       the analyzed set covers the FULL selected corpus (guard-equal branch,
 *       Issue #46 mechanical comparison), otherwise a DISTINCT deterministic
 *       partial-coverage identity that can never masquerade as full coverage.
 *
 * Fail-closed semantics (§SEAM C frozen codes):
 *   SEAM_C_GUARD_MISMATCH              aggregate != selected (guard-unequal branch)
 *   SEAM_C_REPRESENTATION_CONFLICT     representation vs canonical conflict / bad input
 *   SEAM_C_MODEL_OWNED_IDENTITY        claims carrying non-controller-owned identity
 *   SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE missing aggregate identity artifact
 *   Module-level (implementation detail, NOT part of the frozen seam table):
 *   SEAM_C_RUNTIME_UNAVAILABLE         semantic runtime unavailable (NO_SILENT_RUNTIME_FALLBACK)
 *
 * Identity family rule: every emitted "sha256:<64hex>" value is the SAME
 * identity encoding family as SEAM B selectedCorpusIdentity — Issue #46's
 * mechanical guard compares them for equality.
 */

import crypto from 'node:crypto';

/** SEAM C envelope constants (frozen, §SEAM C OUTPUT_OBSERVABLE_SHAPE). */
export const SEAM_C_SEAM = 'T13_TO_T14';
export const SEAM_C_SEAM_VERSION = 1;

/** Frozen §SEAM C fail-closed error codes. */
export const SEAM_C_GUARD_MISMATCH = 'SEAM_C_GUARD_MISMATCH';
export const SEAM_C_REPRESENTATION_CONFLICT = 'SEAM_C_REPRESENTATION_CONFLICT';
export const SEAM_C_MODEL_OWNED_IDENTITY = 'SEAM_C_MODEL_OWNED_IDENTITY';
export const SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE = 'SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE';
/** Module-level fail-closed code (runtime unavailability; NO_SILENT_RUNTIME_FALLBACK, Spec §5.2/§10.2). */
export const SEAM_C_RUNTIME_UNAVAILABLE = 'SEAM_C_RUNTIME_UNAVAILABLE';

/** §9.2 frozen completeness vocabulary (Spec §9.2; validator COMPLETENESS_STATUSES). */
export const COMPLETENESS_STATUSES = Object.freeze(['captured', 'verified', 'partial', 'failed']);

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export class SeamCError extends Error {
  constructor(code, message, { details = null } = {}) {
    super(message);
    this.name = 'SeamCError';
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

/** Deterministic canonical JSON — same byte semantics as the frozen seam
 *  validator's canonicalJsonForHash (helpers/p1-seam-contracts.mjs) and the
 *  real T09 producer hash domain (multi-group-execution.mjs). */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function sortedUniqueIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(isNonEmptyString))].sort();
}

function setsEqual(a, b) {
  const sa = sortedUniqueIds(a);
  const sb = sortedUniqueIds(b);
  return sa.length === sb.length && sa.every((id, i) => id === sb[i]);
}

// ---------------------------------------------------------------------------
// SEAM B input validation (controller-side mechanical gate before consumption)
// ---------------------------------------------------------------------------

/**
 * Validate a SEAM B artifact for T13 consumption. Fail closed with
 * SEAM_C_REPRESENTATION_CONFLICT on any malformed/conflicting input.
 * The "analyzed" accounting field is T13-owned: its presence in the INPUT is
 * a single-ownership violation and is rejected (mirrors SEAM_B_ANALYZED_FIELD_FORBIDDEN).
 */
export function validateSeamBCorpusArtifact(artifact) {
  const conflict = (message, details) => {
    throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, message, { details });
  };
  if (!isPlainObject(artifact)) conflict('SEAM B artifact must be a plain object');
  if (artifact.seam !== 'T12_TO_T13') conflict(`expected seam T12_TO_T13, got ${String(artifact.seam)}`);
  if (artifact.seamVersion !== 1) conflict('expected seamVersion 1');
  if (!HEX64.test(artifact.planHash || '')) conflict('planHash must be 64hex');
  if (!SHA256_REF.test(artifact.selectedCorpusIdentity || '')) {
    conflict('selectedCorpusIdentity must be sha256:64hex (identity family binding for Issue #46 guard)');
  }
  const corpus = artifact.corpus;
  if (!isPlainObject(corpus) || !Array.isArray(corpus.groups) || corpus.groups.length === 0) {
    conflict('corpus.groups must be a non-empty array');
  }
  for (const group of corpus.groups) {
    const p = `groups[${group?.groupId ?? '?'}]`;
    if (!isNonEmptyString(group.groupId)) conflict(`${p}: groupId required`);
    if (!isPlainObject(group.accounting)) conflict(`${p}: accounting required`);
    if ('analyzed' in group.accounting) {
      conflict(`${p}: analyzed accounting is owned by P1-T13 (single writer) — SEAM B input must not carry it`);
    }
    const { eligible, selected, verified } = group.accounting;
    if (![eligible, selected, verified].every(isNonNegativeInt)) {
      conflict(`${p}: eligible/selected/verified must be non-negative ints`);
    }
    if (!(selected <= verified && verified <= eligible)) {
      conflict(`${p}: require selected <= verified <= eligible`);
    }
    const refs = group.selectedSourceRefs;
    if (!Array.isArray(refs) || refs.length === 0) conflict(`${p}: selectedSourceRefs must be non-empty`);
    if (refs.length !== selected) {
      conflict(`${p}: selectedSourceRefs.length (${refs.length}) != accounting.selected (${selected})`);
    }
    for (const ref of refs) {
      if (!isNonEmptyString(ref.canonicalSourceId) || !SHA256_REF.test(ref.contentHash || '') || !isNonEmptyString(ref.verifiedArtifactRef)) {
        conflict(`${p}: each selected source needs canonicalSourceId + sha256:64hex contentHash + verifiedArtifactRef`);
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// analyzed source-set identity derivation (SINGLE WRITE PATH — P1-T13 only)
// ---------------------------------------------------------------------------

/**
 * Per-group analyzed source-set identity: deterministic function of the
 * analyzed canonicalSourceId set (order-independent). Same identity family as
 * SEAM B selectedCorpusIdentity ("sha256:" + 64hex).
 */
export function derivePerGroupAnalyzedIdentity(groupId, analyzedSourceIds) {
  if (!isNonEmptyString(groupId)) {
    throw new SeamCError(SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE, 'derivePerGroupAnalyzedIdentity: groupId required');
  }
  const analyzed = sortedUniqueIds(analyzedSourceIds);
  return `sha256:${sha256Hex(canonicalJson({ groupId, analyzed }))}`;
}

/**
 * Controller-derived aggregate mapped/analyzed source-set identity.
 *
 * Full coverage (every group's analyzed set == its selected set) → the
 * aggregate IS the selected corpus identity (byte-identical) — the guard-equal
 * branch that lets Issue #46's mechanical comparison PASS.
 *
 * Any partial coverage → a DISTINCT deterministic identity encoding the partial
 * set; it can never equal selectedCorpusIdentity, so the downstream guard
 * mechanically fails closed (SEAM_C_GUARD_MISMATCH) instead of masquerading.
 */
export function deriveAggregateAnalyzedIdentity({ selectedCorpusIdentity, perGroupAnalyzed, perGroupSelected }) {
  if (!SHA256_REF.test(selectedCorpusIdentity || '')) {
    throw new SeamCError(SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE, 'deriveAggregateAnalyzedIdentity: selectedCorpusIdentity must be sha256:64hex');
  }
  if (!isPlainObject(perGroupAnalyzed) || !isPlainObject(perGroupSelected)) {
    throw new SeamCError(SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE, 'deriveAggregateAnalyzedIdentity: perGroupAnalyzed/perGroupSelected maps required');
  }
  const groupIds = Object.keys(perGroupSelected).sort();
  if (groupIds.length === 0) {
    throw new SeamCError(SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE, 'deriveAggregateAnalyzedIdentity: empty selected map');
  }
  const fullCoverage = groupIds.every((gid) => (
    Object.prototype.hasOwnProperty.call(perGroupAnalyzed, gid)
    && setsEqual(perGroupAnalyzed[gid], perGroupSelected[gid])
  ));
  if (fullCoverage) {
    return selectedCorpusIdentity;
  }
  const partial = {};
  for (const gid of groupIds) {
    partial[gid] = sortedUniqueIds(perGroupAnalyzed[gid] ?? []);
  }
  return `sha256:${sha256Hex(canonicalJson({
    kind: 'T13_PARTIAL_ANALYZED_SOURCE_SET',
    selectedCorpusIdentity,
    perGroupAnalyzed: partial,
  }))}`;
}

/**
 * Mechanical guard comparison (mirrors the frozen assertSeamCGuardPass in
 * test/helpers/p1-seam-contracts.mjs; T14 consumes this exact semantics).
 */
export function evaluateSeamCGuard(selectedCorpusIdentity, mappedAnalyzedSourceSetIdentity) {
  if (selectedCorpusIdentity === mappedAnalyzedSourceSetIdentity) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: [{
      code: SEAM_C_GUARD_MISMATCH,
      path: '$.aggregateAnalyzedIdentity',
      detail: 'mapped/analyzed identity != selected corpus identity; FAIL_CLOSED, no synthesis artifact',
    }],
  };
}

// ---------------------------------------------------------------------------
// group representation construction (§8.1 fields)
// ---------------------------------------------------------------------------

/**
 * Build one §8.1 group representation from the canonical corpus group +
 * controller-derived analysis results. Accounting is computed MECHANICALLY
 * from the corpus (never from the model): analyzed <= verified <= selected is
 * enforced here (fail closed SEAM_C_REPRESENTATION_CONFLICT).
 */
export function buildGroupRepresentation({
  corpusGroup,
  canonicalGroupIdentity,
  mappedSourceIds,
  analyzedSourceIds,
  claims,
  expertEvidenceRichRefs,
  completenessStatus,
  discussionVolume,
}) {
  if (!isPlainObject(corpusGroup) || !isNonEmptyString(corpusGroup.groupId)) {
    throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, 'buildGroupRepresentation: corpusGroup with groupId required');
  }
  if (!isPlainObject(canonicalGroupIdentity)
    || !isNonEmptyString(canonicalGroupIdentity.questionId)
    || !isNonEmptyString(canonicalGroupIdentity.providerId)
    || !isNonEmptyString(canonicalGroupIdentity.capability)) {
    throw new SeamCError(
      SEAM_C_REPRESENTATION_CONFLICT,
      `group ${corpusGroup.groupId}: canonicalGroupIdentity {questionId, providerId, capability} required (provenance authority input; none invented)`,
    );
  }
  if (!COMPLETENESS_STATUSES.includes(completenessStatus)) {
    throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, `group ${corpusGroup.groupId}: completenessStatus outside frozen §9.2 vocabulary`);
  }
  const selected = corpusGroup.selectedSourceRefs.map((r) => r.canonicalSourceId);
  const verified = corpusGroup.accounting.verified;
  const mappedCount = sortedUniqueIds(mappedSourceIds).length;
  const analyzedCount = sortedUniqueIds(analyzedSourceIds).length;
  if (analyzedCount > verified || verified > selected.length) {
    throw new SeamCError(
      SEAM_C_REPRESENTATION_CONFLICT,
      `group ${corpusGroup.groupId}: accounting invariant violated (require analyzed <= verified <= selected)`,
      { details: { analyzed: analyzedCount, verified, selected: selected.length } },
    );
  }
  const canonicalIds = new Set(selected);
  for (const ref of expertEvidenceRichRefs ?? []) {
    if (!canonicalIds.has(ref)) {
      throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, `group ${corpusGroup.groupId}: expertEvidenceRichRef ${ref} is not a controller-owned canonicalSourceId`);
    }
  }
  return {
    groupId: corpusGroup.groupId,
    canonicalGroupIdentity: { ...canonicalGroupIdentity },
    accounting: { selected: selected.length, verified, mapped: mappedCount, analyzed: analyzedCount },
    claims: {
      main: (claims?.main ?? []).map((c) => ({ ...c })),
      minority: (claims?.minority ?? []).map((c) => ({ ...c })),
      contradictory: (claims?.contradictory ?? []).map((c) => ({ ...c })),
    },
    expertEvidenceRichRefs: sortedUniqueIds(expertEvidenceRichRefs ?? []),
    completenessStatus,
    discussionVolume: { ...discussionVolume },
  };
}

// ---------------------------------------------------------------------------
// SEAM C artifact assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the SEAM C artifact (§SEAM C OUTPUT_OBSERVABLE_SHAPE) from the SEAM
 * B corpus + per-group representations + per-group analyzed sets.
 *
 * Fail closed:
 *   - selectedCorpusIdentityRef is a READ-ONLY echo of the input identity
 *     (never rewritten — no code path mutates it);
 *   - claims / expert refs must bind to the group's controller-owned
 *     canonicalSourceIds (SEAM_C_REPRESENTATION_CONFLICT);
 *   - missing identity components → SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE;
 *   - aggregate != selected (guard-unequal branch) → SEAM_C_GUARD_MISMATCH by
 *     default. enforceGuardEquality:false exists ONLY to materialize the
 *     diagnostic mismatch input state mirroring the frozen
 *     invalid.guard-mismatch.json semantics (structurally valid, guard-failing).
 */
export function assembleSeamCArtifact({
  corpus,
  groupRepresentations,
  perGroupAnalyzedSourceIds,
  planHash,
  enforceGuardEquality = true,
}) {
  validateSeamBCorpusArtifact(corpus);
  if (!HEX64.test(planHash || '')) {
    throw new SeamCError(SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE, 'assembleSeamCArtifact: planHash (64hex) required for the SEAM C envelope');
  }
  if (!Array.isArray(groupRepresentations) || groupRepresentations.length === 0) {
    throw new SeamCError(SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE, 'assembleSeamCArtifact: non-empty groupRepresentations required (identity artifact incomplete)');
  }
  if (!isPlainObject(perGroupAnalyzedSourceIds)) {
    throw new SeamCError(SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE, 'assembleSeamCArtifact: perGroupAnalyzedSourceIds map required (identity artifact incomplete)');
  }

  const perGroupSelected = {};
  for (const group of corpus.corpus.groups) {
    perGroupSelected[group.groupId] = group.selectedSourceRefs.map((r) => r.canonicalSourceId);
  }

  const seenGroupIds = new Set();
  for (const rep of groupRepresentations) {
    if (!isPlainObject(rep) || !isNonEmptyString(rep.groupId)) {
      throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, 'assembleSeamCArtifact: representation without groupId');
    }
    if (seenGroupIds.has(rep.groupId)) {
      throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, `duplicate representation for group ${rep.groupId}`);
    }
    seenGroupIds.add(rep.groupId);
    const corpusGroup = corpus.corpus.groups.find((g) => g.groupId === rep.groupId);
    if (!corpusGroup) {
      throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, `representation group ${rep.groupId} does not exist in the canonical corpus`);
    }
    const canonicalIds = new Set(perGroupSelected[rep.groupId]);
    for (const kind of ['main', 'minority', 'contradictory']) {
      for (const claim of rep.claims?.[kind] ?? []) {
        if (!isNonEmptyString(claim.claimId) || !isNonEmptyString(claim.statement) || !Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0) {
          throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, `group ${rep.groupId}: claim lineage incomplete (claimId + statement + sourceRefs required)`);
        }
        for (const ref of claim.sourceRefs) {
          if (!canonicalIds.has(ref)) {
            throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, `group ${rep.groupId}: claim sourceRef ${ref} is not a controller-owned canonicalSourceId of this group`);
          }
        }
      }
    }
    for (const ref of rep.expertEvidenceRichRefs ?? []) {
      if (!canonicalIds.has(ref)) {
        throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, `group ${rep.groupId}: expertEvidenceRichRef ${ref} outside controller-owned canonical set`);
      }
    }
  }
  for (const groupId of Object.keys(perGroupSelected)) {
    if (!seenGroupIds.has(groupId)) {
      throw new SeamCError(SEAM_C_REPRESENTATION_CONFLICT, `canonical group ${groupId} has no representation (no silent group drop)`);
    }
  }

  const perGroup = {};
  for (const groupId of Object.keys(perGroupSelected).sort()) {
    perGroup[groupId] = derivePerGroupAnalyzedIdentity(groupId, perGroupAnalyzedSourceIds[groupId] ?? []);
  }
  const mappedAnalyzedSourceSetIdentity = deriveAggregateAnalyzedIdentity({
    selectedCorpusIdentity: corpus.selectedCorpusIdentity,
    perGroupAnalyzed: perGroupAnalyzedSourceIds,
    perGroupSelected,
  });
  if (!SHA256_REF.test(mappedAnalyzedSourceSetIdentity)) {
    throw new SeamCError(SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE, 'assembleSeamCArtifact: derived aggregate identity malformed (identity artifact incomplete)');
  }

  if (enforceGuardEquality) {
    const guard = evaluateSeamCGuard(corpus.selectedCorpusIdentity, mappedAnalyzedSourceSetIdentity);
    if (!guard.ok) {
      throw new SeamCError(
        SEAM_C_GUARD_MISMATCH,
        'mapped/analyzed source-set identity != selected corpus identity; FAIL_CLOSED (guard-unequal branch)',
        { details: { errors: guard.errors } },
      );
    }
  }

  // READ-ONLY echo: the input identity value is copied verbatim, never recomputed.
  return {
    seam: SEAM_C_SEAM,
    seamVersion: SEAM_C_SEAM_VERSION,
    planHash,
    selectedCorpusIdentityRef: corpus.selectedCorpusIdentity,
    groupRepresentations: groupRepresentations.map((rep) => ({ ...rep })),
    aggregateAnalyzedIdentity: { mappedAnalyzedSourceSetIdentity, perGroup },
  };
}
