/**
 * research-orchestration/test/helpers/p1-seam-contracts.mjs
 *
 * P1 Seam Contract validators (SEAM A–D, V1).
 *
 * Authority: docs/planning/P1_SEAM_CONTRACTS_V1.md (NON_AUTHORITATIVE_CANDIDATE
 * until external audit PASS + integration). Semantic fields trace to
 * docs/specs/p1-cross-question-deep-research.md and Issues #41/#44/#45/#46/#47.
 *
 * Pure, offline, deterministic. No product-module imports, no network, no
 * credentials. These validators verify STRUCTURE + frozen invariants of the
 * canonical encoding; for SEAM A they additionally RECOMPUTE the producer's
 * manifestHash (R1: self-verifying identity — tamper/stale detection).
 */

import crypto from 'node:crypto';
import path from 'node:path';

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
const PLAN_HASH = /^[0-9a-f]{64}$/;
// T13-I3 ratified SEAM C V1 amendment (product owner via P1 WAVE 01
// integration gate, 2026-09-05): every claim entry carries a REQUIRED but
// NULLABLE authorRef. Non-null must match the frozen controller-derived
// scheme 'author-' + 16 lowercase hex chars; null = author identity
// unresolvable from canonical metadata (disclosed, never fabricated).
const AUTHOR_REF = /^author-[0-9a-f]{16}$/;
// Real producer hash domain (state.mjs @ 4789382): plain 64-char lowercase hex,
// NO "sha256:" prefix — answersHash / handoffHash / selectionIdentity /
// selectionDecisionHash / manifestHash all use this encoding.
const HEX64 = /^[0-9a-f]{64}$/;

const COMPLETENESS_STATUSES = ['captured', 'verified', 'partial', 'failed'];
const SYNTHESIS_CLAIM_CATEGORIES = ['widely-shared', 'group-specific', 'minority', 'conflicting'];
// SEAM D diagnostics = EXACTLY the keys T14 can write through the frozen T07 hook
// updateSynthesisDiagnostics (coverage-state.mjs @ master):
//   claim_source_diversity (explicit T14-only write) + applyNewRateDiagnostics (4 rates).
// novelty_gain is owned by T06 / Retrieval Controller (updateRetrievalCoverage) and is
// NOT T14-writable — removed from SEAM D (R1-F3). Selection diagnostics (T12, Hook 3)
// and Source Completeness diagnostics (T09, Hook 2) never travel through SEAM D.
const T14_WRITABLE_DIAGNOSTIC_KEYS = [
  'new_aspect_rate',
  'new_claim_rate',
  'new_expert_rate',
  'new_contradiction_rate',
  'claim_source_diversity',
];
const FORBIDDEN_CONTENT_KEYS = [
  'content',
  'contentBody',
  'answerContent',
  'answersContent',
  'markdown',
  'answersMarkdown',
  'renderedContent',
  'rawHtml',
];

function err(code, path, detail) {
  return { code, path, detail };
}

function ok() {
  return { ok: true, errors: [] };
}

function fail(errors) {
  return { ok: false, errors };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Recursively walk a value and report (key, path) for every occurrence of a
 * forbidden key. Detects canonical-content duplication (key-decisions D09).
 */
export function walkForForbiddenKeys(value, forbiddenKeys, prefix = '') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      found.push(...walkForForbiddenKeys(item, forbiddenKeys, `${prefix}[${i}]`));
    });
    return found;
  }
  if (!isPlainObject(value)) {
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (forbiddenKeys.includes(key)) {
      found.push(path);
    }
    found.push(...walkForForbiddenKeys(child, forbiddenKeys, path));
  }
  return found;
}

/**
 * Deterministic canonical JSON — byte-identical algorithm to the real T09
 * producer's private canonicalJson (multi-group-execution.mjs @ 4789382):
 * recursively key-sorted, JSON.stringify leaf semantics. Used ONLY to recompute
 * manifestHash so tampering of any hashed field is mechanically detectable.
 */
function canonicalJsonForHash(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForHash).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonForHash(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Recompute manifestHash exactly as the real producer does: sha256 over the
 * canonical JSON of every present field EXCEPT manifestHash itself (the producer
 * hashes the manifest before attaching the hash). Adding new fields later keeps
 * working (they enter the hash on the producer side); any post-hoc mutation of a
 * hashed field breaks the recomputation — the fail-closed tamper/stale signal.
 */
function recomputeManifestHash(artifact) {
  const { manifestHash: _omitted, ...hashedFields } = artifact;
  return crypto.createHash('sha256').update(canonicalJsonForHash(hashedFields)).digest('hex');
}

/**
 * Work-relative artifact reference: non-empty string, never absolute, never
 * escaping the work dir. Exact file layout stays PRIVATE (seam doc §0) — the
 * real producer currently uses `zhihu/<questionId>/{answers,handoff}.json`.
 */
function isWorkRelativeRef(value) {
  if (!isNonEmptyString(value)) return false;
  if (value.startsWith('/') || path.isAbsolute(value)) return false;
  return !value.split('/').includes('..');
}

/* ---------------------------------- SEAM A --------------------------------- */

/**
 * SEAM A — T09_TO_T12: MINIMUM OBSERVABLE CONTRACT (R1 producer-grounded).
 * The observable artifact IS the real ResearchCorpusManifest emitted by
 * deriveResearchCorpusManifest (reviewed T09 @ 4789382): identity projection,
 * no renamed/invented fields. Invented mandatory fields of the pre-R1 seam
 * (verifyResultRef / verifyAuthority / verifiedAt / selectedSourceCount /
 * derivedFrom / selectorOutputRef / groupProvenance) were REMOVED — see
 * P1_SEAM_CONTRACTS_V1.md SEAM A "F1 审计" table.
 */
export function validateResearchCorpusManifest(artifact) {
  const errors = [];
  if (!isPlainObject(artifact)) return fail([err('SEAM_A_SHAPE', '$', 'not an object')]);
  if (artifact.type !== 'research-corpus-manifest') errors.push(err('SEAM_A_TYPE', '$.type', 'expected research-corpus-manifest (real producer binding)'));
  if (artifact.schemaVersion !== 1) errors.push(err('SEAM_A_SCHEMA_VERSION', '$.schemaVersion', 'expected 1'));
  if (!PLAN_HASH.test(artifact.planHash || '')) errors.push(err('SEAM_A_PLAN_HASH', '$.planHash', '64hex required'));
  if (!HEX64.test(artifact.selectionIdentity || '')) errors.push(err('SEAM_A_SELECTION_IDENTITY', '$.selectionIdentity', '64hex required'));
  if (!HEX64.test(artifact.selectionDecisionHash || '')) errors.push(err('SEAM_A_SELECTION_IDENTITY', '$.selectionDecisionHash', '64hex required'));

  const groups = artifact.groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    // A manifest with zero verified groups cannot seed selection (Spec §7.2 no
    // valid candidate → fail closed); it is a legal producer STATE but never a
    // consumable SEAM A artifact.
    errors.push(err('SEAM_A_REFS_REQUIRED', '$.groups', 'non-empty array required (empty manifest is a terminal producer state, not a consumable artifact)'));
  } else {
    groups.forEach((ref, i) => {
      const p = `$.groups[${i}]`;
      if (!isNonEmptyString(ref.groupId) || !isNonEmptyString(ref.questionId)) {
        errors.push(err('SEAM_A_GROUP_IDENTITY', `${p}`, 'groupId/questionId required'));
      }
      if (!isWorkRelativeRef(ref.answersRel) || !isWorkRelativeRef(ref.handoffRel)) {
        errors.push(err('SEAM_A_ARTIFACT_REF', `${p}.answersRel/handoffRel`, 'work-relative refs required (content-free)'));
      }
      if (!HEX64.test(ref.answersHash || '') || !HEX64.test(ref.handoffHash || '')) {
        errors.push(err('SEAM_A_CONTENT_HASH', `${p}.answersHash/handoffHash`, '64hex required (real producer encoding, no prefix)'));
      }
      for (const countKey of ['capturedAnswerCount', 'reportedAnswerCount']) {
        const v = ref[countKey];
        if (v !== null && !isNonNegativeInt(v)) {
          errors.push(err('SEAM_A_COUNT_INVALID', `${p}.${countKey}`, 'non-negative int or null required'));
        }
      }
      if (!['complete', 'partial', 'unknown'].includes(ref.paginationStatus)) {
        errors.push(err('SEAM_A_PAGINATION_STATUS', `${p}.paginationStatus`, 'complete/partial/unknown required'));
      }
    });
  }

  const accounting = artifact.accounting;
  if (!isPlainObject(accounting)) {
    errors.push(err('SEAM_A_ACCOUNTING_INVALID', '$.accounting', 'object required'));
  } else {
    const keys = ['selectedGroupCount', 'verifiedGroupCount', 'capturedNotVerifiedGroupCount', 'failedGroupCount'];
    if (!keys.every((k) => isNonNegativeInt(accounting[k]))) {
      errors.push(err('SEAM_A_ACCOUNTING_INVALID', '$.accounting', `${keys.join('/')} non-negative ints required`));
    } else {
      if (Array.isArray(groups) && accounting.verifiedGroupCount !== groups.length) {
        errors.push(err('SEAM_A_ACCOUNTING_INCONSISTENT', '$.accounting.verifiedGroupCount', `expected ${groups.length} (groups[] is valid-only)`));
      }
      if (accounting.verifiedGroupCount > accounting.selectedGroupCount) {
        errors.push(err('SEAM_A_ACCOUNTING_INCONSISTENT', '$.accounting', 'verifiedGroupCount cannot exceed selectedGroupCount'));
      }
    }
  }

  if (!HEX64.test(artifact.manifestHash || '')) {
    errors.push(err('SEAM_A_MANIFEST_HASH', '$.manifestHash', '64hex required'));
  } else {
    // Self-verifying identity: recompute over every present field except the
    // hash itself (exact producer derivation). Detects tampered group entries,
    // smuggled captured-not-verified groups, and any stale content drift.
    const recomputed = recomputeManifestHash(artifact);
    if (recomputed !== artifact.manifestHash) {
      errors.push(err('SEAM_A_MANIFEST_HASH_MISMATCH', '$.manifestHash', 'recomputed manifestHash differs — manifest is stale or tampered (e.g. a captured-not-verified group smuggled into groups[])'));
    }
  }

  for (const path of walkForForbiddenKeys(artifact, FORBIDDEN_CONTENT_KEYS)) {
    errors.push(err('SEAM_A_CANONICAL_CONTENT_FORBIDDEN', path, 'manifest must not carry canonical content (D09)'));
  }
  return errors.length === 0 ? ok() : fail(errors);
}

/* ---------------------------------- SEAM B --------------------------------- */

export function validateSelectedResearchCorpus(artifact) {
  const errors = [];
  if (!isPlainObject(artifact)) return fail([err('SEAM_B_SHAPE', '$', 'not an object')]);
  if (artifact.seam !== 'T12_TO_T13') errors.push(err('SEAM_B_ID', '$.seam', 'expected T12_TO_T13'));
  if (artifact.seamVersion !== 1) errors.push(err('SEAM_B_VERSION', '$.seamVersion', 'expected 1'));
  if (!PLAN_HASH.test(artifact.planHash || '')) errors.push(err('SEAM_B_PLAN_HASH', '$.planHash', '64hex required'));
  if (!SHA256_REF.test(artifact.selectedCorpusIdentity || '')) {
    errors.push(err('SEAM_B_CORPUS_IDENTITY', '$.selectedCorpusIdentity', 'sha256:64hex required'));
  }

  for (const path of walkForForbiddenKeys(artifact, ['analyzed'])) {
    errors.push(err('SEAM_B_ANALYZED_FIELD_FORBIDDEN', path, 'analyzed accounting is owned by P1-T13 (single writer)'));
  }

  const corpus = artifact.corpus;
  if (!isPlainObject(corpus) || !Array.isArray(corpus.groups) || corpus.groups.length === 0) {
    errors.push(err('SEAM_B_GROUPS_REQUIRED', '$.corpus.groups', 'non-empty array required'));
    return fail(errors);
  }

  let totalEligible = 0;
  let totalSelected = 0;
  let totalVerified = 0;
  const totalsExclusions = {};

  corpus.groups.forEach((group, i) => {
    const p = `$.corpus.groups[${i}]`;
    if (!isNonEmptyString(group.groupId)) errors.push(err('SEAM_B_GROUP_ID', `${p}.groupId`, 'required'));
    const refs = group.selectedSourceRefs;
    if (!Array.isArray(refs) || refs.length === 0) {
      errors.push(err('SEAM_B_SOURCES_REQUIRED', `${p}.selectedSourceRefs`, 'non-empty array required'));
    } else {
      refs.forEach((ref, j) => {
        if (!isNonEmptyString(ref.canonicalSourceId) || !SHA256_REF.test(ref.contentHash || '') || !isNonEmptyString(ref.verifiedArtifactRef)) {
          errors.push(err('SEAM_B_UNVERIFIED_SOURCE_REF', `${p}.selectedSourceRefs[${j}]`, 'canonicalSourceId + contentHash + verifiedArtifactRef required'));
        }
      });
    }
    const acc = group.accounting;
    if (!isPlainObject(acc)) {
      errors.push(err('SEAM_B_ACCOUNTING_REQUIRED', `${p}.accounting`, 'object required'));
      return;
    }
    const { eligible, selected, verified } = acc;
    if (![eligible, selected, verified].every(isNonNegativeInt)) {
      errors.push(err('SEAM_B_ACCOUNTING_INCONSISTENT', `${p}.accounting`, 'eligible/selected/verified ints required'));
      return;
    }
    if (!(selected <= verified && verified <= eligible)) {
      errors.push(err('SEAM_B_ACCOUNTING_INCONSISTENT', `${p}.accounting`, 'require selected <= verified <= eligible'));
    }
    const exclusions = acc.exclusionReasonCategories;
    if (!isPlainObject(exclusions)) {
      errors.push(err('SEAM_B_MISSING_EXCLUSION_REASON', `${p}.accounting.exclusionReasonCategories`, 'object required'));
      return;
    }
    const exclusionSum = Object.values(exclusions).reduce((s, n) => s + n, 0);
    if (eligible - selected !== exclusionSum) {
      errors.push(err('SEAM_B_MISSING_EXCLUSION_REASON', `${p}.accounting`, 'every excluded eligible source needs a recorded reason category'));
    }
    totalEligible += eligible;
    totalSelected += selected;
    totalVerified += verified;
    for (const [k, n] of Object.entries(exclusions)) totalsExclusions[k] = (totalsExclusions[k] || 0) + n;
  });

  const totals = corpus.totals;
  if (!isPlainObject(totals)) {
    errors.push(err('SEAM_B_TOTALS_REQUIRED', '$.corpus.totals', 'object required'));
  } else {
    if (totals.eligible !== totalEligible || totals.selected !== totalSelected || totals.verified !== totalVerified) {
      errors.push(err('SEAM_B_ACCOUNTING_INCONSISTENT', '$.corpus.totals', 'totals must equal per-group sums'));
    }
    const totalsSum = Object.values(totals.exclusionReasonCategories || {}).reduce((s, n) => s + n, 0);
    if (totalEligible - totalSelected !== totalsSum) {
      errors.push(err('SEAM_B_MISSING_EXCLUSION_REASON', '$.corpus.totals', 'totals exclusion accounting incomplete'));
    }
  }
  return errors.length === 0 ? ok() : fail(errors);
}

/* ---------------------------------- SEAM C --------------------------------- */

/**
 * Mechanical guard comparison (Issue #46): equal identities allow synthesis;
 * unequal → FAIL_CLOSED with no synthesis artifact.
 */
export function assertSeamCGuardPass(selectedCorpusIdentity, mappedAnalyzedSourceSetIdentity) {
  if (selectedCorpusIdentity === mappedAnalyzedSourceSetIdentity) return ok();
  return fail([err('SEAM_C_GUARD_MISMATCH', '$.aggregateAnalyzedIdentity', 'mapped/analyzed identity != selected corpus identity; FAIL_CLOSED, no synthesis artifact')]);
}

export function validateGroupRepresentations(artifact) {
  const errors = [];
  if (!isPlainObject(artifact)) return fail([err('SEAM_C_SHAPE', '$', 'not an object')]);
  if (artifact.seam !== 'T13_TO_T14') errors.push(err('SEAM_C_ID', '$.seam', 'expected T13_TO_T14'));
  if (artifact.seamVersion !== 1) errors.push(err('SEAM_C_VERSION', '$.seamVersion', 'expected 1'));
  if (!PLAN_HASH.test(artifact.planHash || '')) errors.push(err('SEAM_C_PLAN_HASH', '$.planHash', '64hex required'));
  if (!SHA256_REF.test(artifact.selectedCorpusIdentityRef || '')) {
    errors.push(err('SEAM_C_INPUT_ECHO', '$.selectedCorpusIdentityRef', 'sha256:64hex required (read-only echo of SEAM B identity)'));
  }

  const groups = artifact.groupRepresentations;
  if (!Array.isArray(groups) || groups.length === 0) {
    errors.push(err('SEAM_C_REPRESENTATIONS_REQUIRED', '$.groupRepresentations', 'non-empty array required'));
  } else {
    groups.forEach((group, i) => {
      const p = `$.groupRepresentations[${i}]`;
      if (!isNonEmptyString(group.groupId)) errors.push(err('SEAM_C_GROUP_ID', `${p}.groupId`, 'required'));
      const identity = group.canonicalGroupIdentity;
      if (!isPlainObject(identity) || !isNonEmptyString(identity.questionId) || !isNonEmptyString(identity.providerId) || !isNonEmptyString(identity.capability)) {
        errors.push(err('SEAM_C_REPRESENTATION_CONFLICT', `${p}.canonicalGroupIdentity`, 'questionId/providerId/capability required'));
      }
      const acc = group.accounting;
      if (!isPlainObject(acc) || ![acc.selected, acc.verified, acc.mapped, acc.analyzed].every(isNonNegativeInt) || !(acc.analyzed <= acc.verified && acc.verified <= acc.selected)) {
        errors.push(err('SEAM_C_ACCOUNTING_INCONSISTENT', `${p}.accounting`, 'require analyzed <= verified <= selected'));
      }
      const claims = group.claims;
      if (!isPlainObject(claims) || !Array.isArray(claims.main) || !Array.isArray(claims.minority) || !Array.isArray(claims.contradictory)) {
        errors.push(err('SEAM_C_CLAIM_STRUCTURE_REQUIRED', `${p}.claims`, 'main/minority/contradictory arrays required'));
      } else {
        for (const kind of ['main', 'minority', 'contradictory']) {
          claims[kind].forEach((claim, j) => {
            if (!isNonEmptyString(claim.claimId) || !isNonEmptyString(claim.statement) || !Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0 || !claim.sourceRefs.every(isNonEmptyString)) {
              errors.push(err('SEAM_C_CLAIM_LINEAGE_REQUIRED', `${p}.claims.${kind}[${j}]`, 'claimId + statement + controller-owned sourceRefs required'));
            }
            // T13-I3 ratified amendment (2026-09-05): authorRef REQUIRED but
            // NULLABLE — presence is mandatory; null discloses an unresolvable
            // author; non-null must be the frozen controller-derived scheme.
            // The model never creates authorRef (controller-attached).
            if (!Object.prototype.hasOwnProperty.call(claim, 'authorRef')) {
              errors.push(err('SEAM_C_AUTHOR_REF_REQUIRED', `${p}.claims.${kind}[${j}].authorRef`, 'authorRef field required (nullable; ratified P1 WAVE 01 integration gate 2026-09-05)'));
            } else if (claim.authorRef !== null && !(typeof claim.authorRef === 'string' && AUTHOR_REF.test(claim.authorRef))) {
              errors.push(err('SEAM_C_AUTHOR_REF_INVALID', `${p}.claims.${kind}[${j}].authorRef`, 'null or author-<16 lowercase hex> required (controller-attached; never model-owned, never fabricated)'));
            }
          });
        }
      }
      if (!Array.isArray(group.expertEvidenceRichRefs)) {
        errors.push(err('SEAM_C_EXPERT_REFS_REQUIRED', `${p}.expertEvidenceRichRefs`, 'array required'));
      }
      if (!COMPLETENESS_STATUSES.includes(group.completenessStatus)) {
        errors.push(err('SEAM_C_COMPLETENESS_STATUS', `${p}.completenessStatus`, `one of ${COMPLETENESS_STATUSES.join('/')}`));
      }
      if (!isPlainObject(group.discussionVolume)) {
        errors.push(err('SEAM_C_DISCUSSION_VOLUME', `${p}.discussionVolume`, 'separate signal object required'));
      }
    });
  }

  const agg = artifact.aggregateAnalyzedIdentity;
  // R1-F5: ownership is static authority (Issue #45 single-owner clause; Ticket
  // Graph §B; key-decisions D10) — NOT a runtime field. owner labels and
  // derivedFrom explanation arrays were removed from the REQUIRED shape.
  // SEAM C producer identity is guaranteed by the seam itself (only T13 can
  // produce this artifact); a forged owner label would provide zero security.
  if (!isPlainObject(agg) || !SHA256_REF.test(agg.mappedAnalyzedSourceSetIdentity || '') || !isPlainObject(agg.perGroup)) {
    errors.push(err('SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE', '$.aggregateAnalyzedIdentity', 'mappedAnalyzedSourceSetIdentity + perGroup map required (single writer = P1-T13 by static authority)'));
  }
  return errors.length === 0 ? ok() : fail(errors);
}

/* ---------------------------------- SEAM D --------------------------------- */

/**
 * SEAM D V1 — HISTORICAL ROUTE ONLY (explicit name per P1-R03).
 *
 * Validates the legacy four-category synthesis shape (seamVersion === 1,
 * category ∈ widely-shared/group-specific/minority/conflicting). The 2026-09-19
 * repair amendment (docs/specs/p1-cross-question-deep-research.md §0.2 +
 * P1_SEAM_CONTRACTS_V1.md §SEAM D V2) supersedes the V1 category contract:
 * V1 category artifacts are HISTORICAL_ONLY — they must never pass a V2
 * validator, and this validator hard-rejects seamVersion 2 (fail-closed, no
 * automatic downgrade in either direction). The REAL producer
 * (lib/cross-source-synthesis.mjs produceCrossSourceSynthesis) still emits V1
 * until P1-R05; V1 validation of that base production path stays intact here.
 *
 * V2 conformance MUST use validateSynthesisOutputV2 — never this function.
 */
export function validateSynthesisOutputV1Historical(artifact) {
  const errors = [];
  if (!isPlainObject(artifact)) return fail([err('SEAM_D_SHAPE', '$', 'not an object')]);
  if (artifact.seam !== 'T14_TO_T15') errors.push(err('SEAM_D_ID', '$.seam', 'expected T14_TO_T15'));
  if (artifact.seamVersion !== 1) errors.push(err('SEAM_D_VERSION', '$.seamVersion', 'expected 1'));
  if (!PLAN_HASH.test(artifact.planHash || '')) errors.push(err('SEAM_D_PLAN_HASH', '$.planHash', '64hex required'));

  const guard = artifact.preSynthesisGuard;
  if (!isPlainObject(guard) || guard.guardResult !== 'PASS' || !SHA256_REF.test(guard.selectedVerifiedSourceSetIdentity || '') || !SHA256_REF.test(guard.mappedAnalyzedSourceSetIdentity || '')) {
    errors.push(err('SEAM_D_GUARD_EVIDENCE_REQUIRED', '$.preSynthesisGuard', 'PASS + both identities required; no guard evidence → no synthesis artifact'));
  } else if (guard.selectedVerifiedSourceSetIdentity !== guard.mappedAnalyzedSourceSetIdentity) {
    errors.push(err('SEAM_D_IDENTITY_CHAIN_BREAK', '$.preSynthesisGuard', 'guard identities must be mechanically equal'));
  }

  const synthesis = artifact.synthesis;
  if (!isPlainObject(synthesis)) {
    errors.push(err('SEAM_D_SYNTHESIS_REQUIRED', '$.synthesis', 'object required'));
  } else {
    if (!SHA256_REF.test(synthesis.synthesisIdentity || '')) {
      errors.push(err('SEAM_D_SYNTHESIS_IDENTITY', '$.synthesis.synthesisIdentity', 'sha256:64hex required'));
    }
    if (!Array.isArray(synthesis.claims)) {
      errors.push(err('SEAM_D_CLAIMS_REQUIRED', '$.synthesis.claims', 'array required'));
    } else {
      synthesis.claims.forEach((claim, i) => {
        const p = `$.synthesis.claims[${i}]`;
        if (!isNonEmptyString(claim.claimId) || !isNonEmptyString(claim.aspect)) {
          errors.push(err('SEAM_D_CLAIM_STRUCTURE_REQUIRED', p, 'claimId + aspect required'));
        }
        if (!SYNTHESIS_CLAIM_CATEGORIES.includes(claim.category)) {
          errors.push(err('SEAM_D_UNKNOWN_CLAIM_CATEGORY', `${p}.category`, `one of ${SYNTHESIS_CLAIM_CATEGORIES.join('/')}`));
        }
        const sideOk = (side) => Array.isArray(claim[side]) && claim[side].every((s) => isPlainObject(s) && isNonEmptyString(s.sourceRef) && isNonEmptyString(s.groupId));
        if (!sideOk('support') || !sideOk('oppose')) {
          errors.push(err('SEAM_D_CLAIM_STRUCTURE_REQUIRED', `${p}.support/oppose`, 'source/group structure required'));
        }
        if (Object.prototype.hasOwnProperty.call(claim, 'support_count')) {
          errors.push(err('SEAM_D_COUNT_ONLY_CLAIM', `${p}.support_count`, 'support_count-only aggregation forbidden (Spec §8.2)'));
        }
      });
    }
    for (const key of ['groupDifferences', 'evidenceStrength', 'discussionVolumeDifferences']) {
      if (!(key in synthesis)) {
        errors.push(err('SEAM_D_SYNTHESIS_SECTION_REQUIRED', `$.synthesis.${key}`, 'required by Spec §8.3'));
      }
    }
  }

  const diagnostics = artifact.diagnostics;
  if (!isPlainObject(diagnostics)) {
    errors.push(err('SEAM_D_DIAGNOSTICS_REQUIRED', '$.diagnostics', 'object required'));
  } else {
    // R1-F3: the SEAM D diagnostics key set is EXACTLY what T14 can write via the
    // frozen T07 hook updateSynthesisDiagnostics. novelty_gain (T06-owned) and all
    // selection/completeness diagnostics do NOT travel through SEAM D.
    for (const key of Object.keys(diagnostics)) {
      if (!T14_WRITABLE_DIAGNOSTIC_KEYS.includes(key)) {
        errors.push(err('SEAM_D_UNKNOWN_DIAGNOSTIC_KEY', `$.diagnostics.${key}`, 'not in the T14-writable set (updateSynthesisDiagnostics / Spec §9.4)'));
      }
    }
    for (const key of T14_WRITABLE_DIAGNOSTIC_KEYS) {
      if (typeof diagnostics[key] !== 'number') {
        errors.push(err('SEAM_D_DIAGNOSTICS_INCOMPLETE', `$.diagnostics.${key}`, 'numeric value required'));
      }
    }
  }
  return errors.length === 0 ? ok() : fail(errors);
}

/**
 * DEPRECATED compatibility alias = the SAME historical V1 validator above
 * (kept byte-stable so existing historical test routes —
 * p1-t14-cross-group-synthesis.test.mjs, p1-seam-d-real-conformance.test.mjs —
 * keep their exact V1 semantics until P1-R05 rewires them). It is NOT a
 * version-neutral validator: it accepts ONLY seamVersion 1 and therefore can
 * never launder a V1 artifact into V2 conformance. New code must use
 * validateSynthesisOutputV1Historical (V1 history) or validateSynthesisOutputV2
 * (V2 TYPE_A) explicitly.
 */
export const validateSynthesisOutput = validateSynthesisOutputV1Historical;

/* ------------------------- SEAM D V2 (P1-R03) ------------------------------ */

/**
 * SEAM D V2 — TYPE_A executable contract (P1-R03, Issue #91).
 *
 * Authority transcribed (fixtures implement authority; they never BECOME
 * authority):
 *   - docs/planning/P1_SEAM_CONTRACTS_V1.md §SEAM D (V2 major candidate):
 *     OUTPUT_OBSERVABLE_SHAPE, SourceClaim expansion, IDENTITY_FIELDS,
 *     REQUIRED_INVARIANTS 1–9, VALID_SUCCESS, FAIL_CLOSED, VERSIONING_RULE.
 *   - docs/specs/p1-cross-question-deep-research.md §8.2/§8.3/§8.4/§9.4
 *     (2026-09-19 repair amendment candidate, commit afb391e): proposition
 *     families + claim stance (S1), orthogonal relationStatus/supportBreadth,
 *     independent unresolved records, Cases A–F, diagnostics read canonical.
 *
 * Scope limits (deliberate, per ticket):
 *   - STRUCTURE + identity + version routing only. A valid hash is NOT a
 *     semantic proof ("hash != semantic proof"): natural-language relation
 *     correctness (Spec §8.4) is NOT judged here and semantic goldens stay
 *     the authority's responsibility.
 *   - The REAL producer still emits V1. This validator existing does NOT mean
 *     production is V2-conformant (CURRENT_PRODUCER_V2_CONFORMANCE =
 *     NOT_IMPLEMENTED; the atomic switch belongs to P1-R05).
 *   - No defaults are invented, no lineage/relations back-filled, no V1
 *     category is accepted or translated (VERSION_INCOMPATIBLE on any V1 /
 *     missing / mixed semantic version).
 */

const SEAM_D_V2_STANCES = ['ASSERTS', 'OPPOSES'];
const SEAM_D_V2_KINDS = ['main', 'minority', 'contradictory'];
const SEAM_D_V2_RELATION_STATUSES = ['SUPPORT_ONLY', 'CONFLICTING'];
const SEAM_D_V2_SUPPORT_BREADTHS = ['SINGLE_GROUP', 'MULTI_GROUP'];
const SEAM_D_V2_STRUCT = 'SEAM_D_CLAIM_STRUCTURE_REQUIRED';

/**
 * Emission-order-independent normalization used ONLY for identity hashing
 * (IDENTITY_FIELDS: "集合性质的数组以 controller identity 及规范内容作稳定全序，
 * 排除模型 emission order 的偶然影响"). Every array is sorted by the canonical
 * JSON encoding of its elements (a deterministic total order); object keys are
 * sorted at serialization time by canonicalJsonForHash. Diagnostics and any
 * LEGACY_DERIVED_VIEW are deliberately NOT part of the canonical hash payload
 * (derived disclosure cannot define proposition relations; a legacy view must
 * not influence canonical identity).
 */
function normalizeForHash(value) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeForHash)
      .sort((a, b) => {
        const ea = canonicalJsonForHash(a);
        const eb = canonicalJsonForHash(b);
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
 * Recompute the SEAM D V2 synthesisIdentity over the canonical hash payload:
 * seam/semantic contract version + planHash + guard identity chain + the
 * canonical synthesis content enumerated by IDENTITY_FIELDS (families,
 * unresolved records, and the retained report sections) WITHOUT the identity
 * itself. Diagnostics are derived disclosure and LEGACY_DERIVED_VIEW is a
 * one-way presentation — neither belongs to the canonical hash payload.
 * The validator recomputes and COMPARES — it never rewrites a bad hash (a
 * mismatched identity is rejected, never healed: stale/tampered content cannot
 * be granted V2 validity).
 */
export function recomputeSynthesisIdentityV2(artifact) {
  const s = artifact.synthesis;
  const payload = {
    seam: artifact.seam,
    seamVersion: artifact.seamVersion,
    semanticContractVersion: artifact.semanticContractVersion,
    planHash: artifact.planHash,
    preSynthesisGuard: artifact.preSynthesisGuard,
    synthesis: normalizeForHash({
      families: s.families,
      unresolved: s.unresolved,
      groupDifferences: s.groupDifferences,
      evidenceStrength: s.evidenceStrength,
      discussionVolumeDifferences: s.discussionVolumeDifferences,
    }),
  };
  return `sha256:${crypto.createHash('sha256').update(canonicalJsonForHash(payload)).digest('hex')}`;
}

function validateSourceClaimV2(claim, p, errors) {
  if (!isPlainObject(claim)) {
    errors.push(err(SEAM_D_V2_STRUCT, p, 'SourceClaim object required'));
    return;
  }
  if (!isNonEmptyString(claim.sourceClaimId)) {
    errors.push(err(SEAM_D_V2_STRUCT, `${p}.sourceClaimId`, 'controller-resolved claimId required'));
  }
  if (!isNonEmptyString(claim.statement)) {
    errors.push(err(SEAM_D_V2_STRUCT, `${p}.statement`, 'original claim statement required'));
  }
  if (!SEAM_D_V2_KINDS.includes(claim.kind)) {
    errors.push(err(SEAM_D_V2_STRUCT, `${p}.kind`, 'main/minority/contradictory required (group-local metadata only; kind != stance)'));
  }
  const refs = claim.sourceRefs;
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(err(SEAM_D_V2_STRUCT, `${p}.sourceRefs`, 'non-empty original lineage required (all claim refs retained)'));
    return;
  }
  refs.forEach((r, j) => {
    const rp = `${p}.sourceRefs[${j}]`;
    if (!isPlainObject(r) || !isNonEmptyString(r.sourceRef) || !isNonEmptyString(r.groupId)) {
      errors.push(err(SEAM_D_V2_STRUCT, rp, 'sourceRef + groupId required (controller-owned lineage)'));
    }
    if (!Object.prototype.hasOwnProperty.call(r, 'authorRef')) {
      errors.push(err(SEAM_D_V2_STRUCT, `${rp}.authorRef`, 'authorRef field required (nullable; unknown author disclosed as null, never synthesized)'));
    } else if (r.authorRef !== null && !(typeof r.authorRef === 'string' && AUTHOR_REF.test(r.authorRef))) {
      errors.push(err(SEAM_D_V2_STRUCT, `${rp}.authorRef`, 'null or author-<16 lowercase hex> required (T13 controller-attached)'));
    }
  });
}

/**
 * Canonical lineage projection: the support/oppose sides must be EXACTLY the
 * full lineage refs of the ASSERTS / OPPOSES members (no count-only claims, no
 * cross-side sourceRef dedupe — Case F keeps both claim lineages even when the
 * sourceRef is identical).
 */
function lineageSideV2(sourceClaimsById, stance) {
  const out = [];
  for (const claim of sourceClaimsById.values()) {
    for (const relEntry of claim.__relationships) {
      if (relEntry.sourceClaimId !== claim.sourceClaimId) continue;
      if (relEntry.stance !== stance) continue;
      for (const r of claim.sourceRefs) {
        out.push({
          sourceClaimId: claim.sourceClaimId,
          sourceRef: r.sourceRef,
          groupId: r.groupId,
          authorRef: r.authorRef,
        });
      }
    }
  }
  return out;
}

function sameMembershipV2(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const encode = (x) => canonicalJsonForHash(x);
  const left = a.map(encode).sort();
  const right = b.map(encode).sort();
  return left.every((v, i) => v === right[i]);
}

export function validateSynthesisOutputV2(artifact) {
  const errors = [];
  if (!isPlainObject(artifact)) return fail([err('SEAM_D_SHAPE', '$', 'not an object')]);

  if (artifact.seam !== 'T14_TO_T15') errors.push(err('SEAM_D_ID', '$.seam', 'expected T14_TO_T15'));

  // Version gate (VERSIONING_RULE + Spec §10.2): V1 artifacts, artifacts with a
  // missing semantic version, or mixed version envelopes are
  // VERSION_INCOMPATIBLE — no default filling, no legacy-category fallback.
  if (artifact.seamVersion !== 2) {
    errors.push(err('SEAM_D_VERSION_INCOMPATIBLE', '$.seamVersion', 'SEAM D V2 validator requires seamVersion === 2; V1 artifacts are HISTORICAL_ONLY and must use the explicit V1 historical route'));
  }
  if (!Object.prototype.hasOwnProperty.call(artifact, 'semanticContractVersion') || artifact.semanticContractVersion !== 2) {
    errors.push(err('SEAM_D_VERSION_INCOMPATIBLE', '$.semanticContractVersion', 'missing or non-2 semanticContractVersion (V1 / missing / mixed versions are never defaulted into V2)'));
  }

  if (!PLAN_HASH.test(artifact.planHash || '')) errors.push(err('SEAM_D_PLAN_HASH', '$.planHash', '64hex required'));

  const guard = artifact.preSynthesisGuard;
  if (!isPlainObject(guard) || guard.guardResult !== 'PASS' || !SHA256_REF.test(guard.selectedVerifiedSourceSetIdentity || '') || !SHA256_REF.test(guard.mappedAnalyzedSourceSetIdentity || '')) {
    errors.push(err('SEAM_D_GUARD_EVIDENCE_REQUIRED', '$.preSynthesisGuard', 'PASS + both identities required; no guard evidence → no synthesis artifact'));
  } else if (guard.selectedVerifiedSourceSetIdentity !== guard.mappedAnalyzedSourceSetIdentity) {
    errors.push(err('SEAM_D_IDENTITY_CHAIN_BREAK', '$.preSynthesisGuard', 'guard identities must be mechanically equal (B = C = D identity chain)'));
  }

  const synthesis = artifact.synthesis;
  if (!isPlainObject(synthesis)) {
    errors.push(err('SEAM_D_SYNTHESIS_REQUIRED', '$.synthesis', 'object required'));
    return errors.length === 0 ? ok() : fail(errors);
  }

  if (!SHA256_REF.test(synthesis.synthesisIdentity || '')) {
    errors.push(err('SEAM_D_SYNTHESIS_IDENTITY', '$.synthesis.synthesisIdentity', 'sha256:64hex required'));
  } else {
    const recomputed = recomputeSynthesisIdentityV2(artifact);
    if (recomputed !== synthesis.synthesisIdentity) {
      errors.push(err('SEAM_D_SYNTHESIS_IDENTITY_MISMATCH', '$.synthesis.synthesisIdentity', 'recomputed synthesisIdentity over the canonical payload differs — stale or tampered content is rejected, never re-hashed into validity'));
    }
  }

  const families = synthesis.families;
  const unresolved = synthesis.unresolved;
  if (!Array.isArray(families)) errors.push(err(SEAM_D_V2_STRUCT, '$.synthesis.families', 'array required (may be empty only when unresolved is non-empty)'));
  if (!Array.isArray(unresolved)) errors.push(err(SEAM_D_V2_STRUCT, '$.synthesis.unresolved', 'array required (may be empty only when families is non-empty)'));
  if (Array.isArray(families) && Array.isArray(unresolved) && families.length === 0 && unresolved.length === 0) {
    errors.push(err(SEAM_D_V2_STRUCT, '$.synthesis', 'families and unresolved cannot both be empty (complete partition of all input claims required)'));
  }

  // Global partition: every claim belongs to exactly one family or exactly one
  // unresolved record (REQUIRED_INVARIANTS 3/4).
  const seenClaimIds = new Map();

  if (Array.isArray(families)) {
    families.forEach((family, i) => {
      const p = `$.synthesis.families[${i}]`;
      if (!isPlainObject(family)) {
        errors.push(err(SEAM_D_V2_STRUCT, p, 'family object required'));
        return;
      }
      if (!isNonEmptyString(family.familyKey)) errors.push(err(SEAM_D_V2_STRUCT, `${p}.familyKey`, 'controller-owned family identity required'));
      if (!isNonEmptyString(family.aspect)) errors.push(err(SEAM_D_V2_STRUCT, `${p}.aspect`, 'discussion dimension required (aspect != proposition)'));
      if (Object.prototype.hasOwnProperty.call(family, 'category') || Object.prototype.hasOwnProperty.call(family, 'minority') || Object.prototype.hasOwnProperty.call(family, 'groupSalience')) {
        errors.push(err(SEAM_D_V2_STRUCT, p, 'legacy category / global minority taxonomy forbidden in V2 canonical families (orthogonal three-dimension state only)'));
      }
      if (Object.prototype.hasOwnProperty.call(family, 'support_count')) {
        errors.push(err('SEAM_D_COUNT_ONLY_CLAIM', `${p}.support_count`, 'count-only aggregation forbidden'));
      }

      const sourceClaims = family.sourceClaims;
      if (!Array.isArray(sourceClaims) || sourceClaims.length === 0) {
        // A resolved family is never empty (VALID_SUCCESS).
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.sourceClaims`, 'non-empty array required (resolved families are never empty)'));
      } else {
        const localIds = new Set();
        for (const claim of sourceClaims) {
          validateSourceClaimV2(claim, `${p}.sourceClaims`, errors);
          if (isPlainObject(claim) && isNonEmptyString(claim.sourceClaimId)) {
            if (localIds.has(claim.sourceClaimId)) {
              errors.push(err(SEAM_D_V2_STRUCT, `${p}.sourceClaims`, `duplicate claim ID within family: ${claim.sourceClaimId}`));
            }
            localIds.add(claim.sourceClaimId);
            if (seenClaimIds.has(claim.sourceClaimId)) {
              errors.push(err(SEAM_D_V2_STRUCT, `${p}.sourceClaims`, `claim ${claim.sourceClaimId} appears more than once across families/unresolved (must belong exactly once)`));
            }
            seenClaimIds.set(claim.sourceClaimId, p);
          }
        }
        // Stash relationships for lineage derivation after basic shape checks.
        for (const claim of sourceClaims) {
          if (isPlainObject(claim)) claim.__relationships = Array.isArray(family.relationships) ? family.relationships : [];
        }
      }

      const relationships = family.relationships;
      if (!Array.isArray(relationships)) {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationships`, 'array required'));
      } else {
        const relIds = new Set();
        for (const r of relationships) {
          if (!isPlainObject(r) || !isNonEmptyString(r.sourceClaimId)) {
            errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationships`, 'sourceClaimId required'));
            continue;
          }
          if (!SEAM_D_V2_STANCES.includes(r.stance)) {
            errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationships`, `illegal stance ${JSON.stringify(r.stance)}; resolved members allow only ASSERTS/OPPOSES (UNRESOLVED lives in independent records)`));
          }
          if (relIds.has(r.sourceClaimId)) {
            errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationships`, `duplicate relationship for ${r.sourceClaimId}`));
          }
          relIds.add(r.sourceClaimId);
        }
        if (Array.isArray(sourceClaims) && sourceClaims.length > 0) {
          const claimIds = new Set(sourceClaims.map((c) => (isPlainObject(c) ? c.sourceClaimId : null)).filter(isNonEmptyString));
          for (const id of relIds) {
            if (!claimIds.has(id)) {
              errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationships`, `foreign/unknown claim ID ${id} (relationship IDs must resolve to this family's sourceClaims)`));
            }
          }
          for (const id of claimIds) {
            if (!relIds.has(id)) {
              errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationships`, `missing relationship for claim ${id} (relationships and sourceClaims ID sets must be strictly equal)`));
            }
          }
        }
      }

      // Anchor: must be a member, carry that member's ORIGINAL statement, and
      // self-ASSERT (no free-text proposition rewriting).
      const anchor = family.anchor;
      const memberById = Array.isArray(sourceClaims)
        ? new Map(sourceClaims.filter((c) => isPlainObject(c) && isNonEmptyString(c.sourceClaimId)).map((c) => [c.sourceClaimId, c]))
        : new Map();
      if (!isPlainObject(anchor) || !isNonEmptyString(anchor.sourceClaimId)) {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.anchor`, 'anchor {sourceClaimId, statement} required'));
      } else {
        const member = memberById.get(anchor.sourceClaimId);
        if (!member) {
          errors.push(err(SEAM_D_V2_STRUCT, `${p}.anchor`, `anchor ${anchor.sourceClaimId} is not a member of this family`));
        } else {
          if (anchor.statement !== member.statement) {
            errors.push(err(SEAM_D_V2_STRUCT, `${p}.anchor.statement`, 'anchor statement must be the member claim\'s ORIGINAL statement (free-text proposition rewriting forbidden)'));
          }
          const selfRel = Array.isArray(relationships)
            && relationships.some((r) => isPlainObject(r) && r.sourceClaimId === anchor.sourceClaimId && r.stance === 'ASSERTS');
          if (!selfRel) {
            errors.push(err(SEAM_D_V2_STRUCT, `${p}.anchor`, 'anchor must self-ASSERT within family relationships'));
          }
        }
      }

      if (family.relationStatus !== 'SUPPORT_ONLY' && family.relationStatus !== 'CONFLICTING') {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationStatus`, 'SUPPORT_ONLY/CONFLICTING required (controller-derived orthogonal state)'));
      }
      if (family.supportBreadth !== 'SINGLE_GROUP' && family.supportBreadth !== 'MULTI_GROUP') {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.supportBreadth`, 'SINGLE_GROUP/MULTI_GROUP required (controller-derived orthogonal state; never guessed from category)'));
      }

      if (!Array.isArray(family.support) || !Array.isArray(family.oppose)) {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.support/oppose`, 'lineage-backed arrays required'));
      }
      if (typeof family.expertEvidenceRichSupport !== 'boolean') {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.expertEvidenceRichSupport`, 'boolean required'));
      }

      // Orthogonal state recomputation (REQUIRED_INVARIANTS 5/6): persisted
      // values must equal the mechanical derivation from relationships +
      // lineage; neither side may be trusted or guessed from kind/legacy label.
      if (Array.isArray(relationships) && Array.isArray(sourceClaims) && sourceClaims.length > 0 && relationships.every((r) => isPlainObject(r) && SEAM_D_V2_STANCES.includes(r.stance))) {
        const hasOppose = relationships.some((r) => r.stance === 'OPPOSES');
        const expectedStatus = hasOppose ? 'CONFLICTING' : 'SUPPORT_ONLY';
        if (family.relationStatus === 'SUPPORT_ONLY' || family.relationStatus === 'CONFLICTING') {
          if (family.relationStatus !== expectedStatus) {
            errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationStatus`, `persisted ${family.relationStatus} != recomputed ${expectedStatus} (ASSERTS/OPPOSES non-emptiness)`));
          }
        }
        const expectedSupport = lineageSideV2(memberById, 'ASSERTS');
        const expectedOppose = lineageSideV2(memberById, 'OPPOSES');
        if (Array.isArray(family.support) && !sameMembershipV2(family.support, expectedSupport)) {
          errors.push(err(SEAM_D_V2_STRUCT, `${p}.support`, 'must be exactly the full lineage of ASSERTS members (no dedupe, no drop, no fabrication; Case F keeps both same-source lineages)'));
        }
        if (Array.isArray(family.oppose) && !sameMembershipV2(family.oppose, expectedOppose)) {
          errors.push(err(SEAM_D_V2_STRUCT, `${p}.oppose`, 'must be exactly the full lineage of OPPOSES members (no dedupe, no drop, no fabrication)'));
        }
        const groups = new Set(expectedSupport.map((s) => s.groupId));
        const expectedBreadth = groups.size >= 2 ? 'MULTI_GROUP' : 'SINGLE_GROUP';
        if (family.supportBreadth === 'SINGLE_GROUP' || family.supportBreadth === 'MULTI_GROUP') {
          if (family.supportBreadth !== expectedBreadth) {
            errors.push(err(SEAM_D_V2_STRUCT, `${p}.supportBreadth`, `persisted ${family.supportBreadth} != recomputed ${expectedBreadth} (distinct ASSERTS groups: ${groups.size})`));
          }
        }
      }

      for (const claim of sourceClaims || []) {
        if (isPlainObject(claim)) delete claim.__relationships; // never mutate caller data beyond the scratch key
      }
    });
  }

  if (Array.isArray(unresolved)) {
    unresolved.forEach((record, i) => {
      const p = `$.synthesis.unresolved[${i}]`;
      if (!isPlainObject(record)) {
        errors.push(err(SEAM_D_V2_STRUCT, p, 'unresolved record object required'));
        return;
      }
      for (const forbidden of ['familyKey', 'anchor', 'relationships', 'support', 'oppose', 'category', 'minority', 'groupSalience', 'support_count']) {
        if (Object.prototype.hasOwnProperty.call(record, forbidden)) {
          const code = forbidden === 'support_count' ? 'SEAM_D_COUNT_ONLY_CLAIM' : SEAM_D_V2_STRUCT;
          errors.push(err(code, `${p}.${forbidden}`, 'unresolved records carry no family/anchor/relations/support/legacy-category fields (independent records only)'));
        }
      }
      if (record.stance !== 'UNRESOLVED') {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.stance`, 'UNRESOLVED required'));
      }
      if (record.relationStatus !== 'UNRESOLVED') {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.relationStatus`, 'UNRESOLVED required'));
      }
      if (record.supportBreadth !== null) {
        errors.push(err(SEAM_D_V2_STRUCT, `${p}.supportBreadth`, 'exactly null required (UNRESOLVED never borrows a breadth)'));
      }
      validateSourceClaimV2(record.sourceClaim, `${p}.sourceClaim`, errors);
      if (isPlainObject(record.sourceClaim) && isNonEmptyString(record.sourceClaim.sourceClaimId)) {
        const id = record.sourceClaim.sourceClaimId;
        if (seenClaimIds.has(id)) {
          errors.push(err(SEAM_D_V2_STRUCT, `${p}.sourceClaim`, `claim ${id} appears more than once across families/unresolved (must belong exactly once)`));
        }
        seenClaimIds.set(id, p);
      }
    });
  }

  for (const key of ['groupDifferences', 'evidenceStrength', 'discussionVolumeDifferences']) {
    if (!(key in synthesis)) {
      errors.push(err('SEAM_D_SYNTHESIS_SECTION_REQUIRED', `$.synthesis.${key}`, 'retained report section required (Spec §8.3)'));
    }
  }

  const diagnostics = artifact.diagnostics;
  if (!isPlainObject(diagnostics)) {
    errors.push(err('SEAM_D_DIAGNOSTICS_REQUIRED', '$.diagnostics', 'object required'));
  } else {
    for (const key of Object.keys(diagnostics)) {
      if (!T14_WRITABLE_DIAGNOSTIC_KEYS.includes(key)) {
        errors.push(err('SEAM_D_UNKNOWN_DIAGNOSTIC_KEY', `$.diagnostics.${key}`, 'not in the T14-writable set (updateSynthesisDiagnostics / Spec §9.4)'));
      }
    }
    for (const key of T14_WRITABLE_DIAGNOSTIC_KEYS) {
      if (typeof diagnostics[key] !== 'number') {
        errors.push(err('SEAM_D_DIAGNOSTICS_INCOMPLETE', `$.diagnostics.${key}`, 'numeric value required'));
      }
    }
    // Diagnostics read canonical state (Spec §9.4, repair amendment): the
    // contradiction rate is recomputed from canonical relationStatus — never
    // from a legacy category.
    if (typeof diagnostics.new_contradiction_rate === 'number' && Array.isArray(families) && Array.isArray(unresolved)) {
      const total = families.length + unresolved.length;
      const conflicting = families.filter((f) => isPlainObject(f) && f.relationStatus === 'CONFLICTING').length;
      const expected = total === 0 ? 0 : conflicting / total;
      if (diagnostics.new_contradiction_rate !== expected) {
        errors.push(err('SEAM_D_DIAGNOSTICS_INCONSISTENT', '$.diagnostics.new_contradiction_rate', `persisted ${diagnostics.new_contradiction_rate} != canonical recomputation ${expected} (CONFLICTING families / (families + unresolved))`));
      }
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

/**
 * Cross-artifact identity chain (SEAM B → C → D): the guard comparisons only
 * mean something if all artifacts encode set identity the same way.
 */
export function assertIdentityChain(seamB, seamC, seamD) {
  const errors = [];
  if (seamB.selectedCorpusIdentity !== seamC.selectedCorpusIdentityRef) {
    errors.push(err('SEAM_D_IDENTITY_CHAIN_BREAK', '$.selectedCorpusIdentityRef', 'SEAM C echo != SEAM B identity'));
  }
  if (seamC.aggregateAnalyzedIdentity.mappedAnalyzedSourceSetIdentity !== seamD.preSynthesisGuard.mappedAnalyzedSourceSetIdentity) {
    errors.push(err('SEAM_D_IDENTITY_CHAIN_BREAK', '$.preSynthesisGuard.mappedAnalyzedSourceSetIdentity', '!= SEAM C aggregate identity'));
  }
  if (seamB.selectedCorpusIdentity !== seamD.preSynthesisGuard.selectedVerifiedSourceSetIdentity) {
    errors.push(err('SEAM_D_IDENTITY_CHAIN_BREAK', '$.preSynthesisGuard.selectedVerifiedSourceSetIdentity', '!= SEAM B identity'));
  }
  return errors.length === 0 ? ok() : fail(errors);
}
