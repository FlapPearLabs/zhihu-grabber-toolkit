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

export function validateSynthesisOutput(artifact) {
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
