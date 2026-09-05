// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/pre-synthesis-guard.mjs
 *
 * P1-T14 — PRE-SYNTHESIS coverage guard (R2 F-2, Issue #46) + SEAM C input
 * readability gate.
 *
 * Authority:
 *   - docs/specs/p1-cross-question-deep-research.md §9.3 / §10.2 (FAIL_CLOSED)
 *   - Issue #46 "Pre-synthesis coverage guard" clause:
 *       selected_verified_source_set_identity == mapped_analyzed_source_set_identity
 *       equal   → synthesis allowed;
 *       unequal → FAIL_CLOSED + NO SYNTHESIS ARTIFACT (not even partial).
 *   - docs/planning/P1_SEAM_CONTRACTS_V1.md §SEAM C (input contract),
 *     §SEAM D (preSynthesisGuard evidence block).
 *
 * Ownership:
 *   - T14 is a CONSUMER of the mapped/analyzed source-set identity. The single
 *     writer is P1-T13 (Issue #45 / Ticket Graph §B / key-decisions D10). This
 *     module never creates, mutates, or persists any analyzed identity — it only
 *     mechanically compares the two identity strings it is handed.
 *   - Comparison is MECHANICAL STRING EQUALITY on the shared "sha256:<64hex>"
 *     identity encoding (SEAM B selectedCorpusIdentity ↔ SEAM C aggregate
 *     identity must use the same encoding, §SEAM C IDENTITY_FIELDS).
 *
 * Design note (ticket-authorized choice): the guard lives in its own module so
 * the synthesis orchestrator (cross-source-synthesis.mjs) composes it as the
 * FIRST gate, before any semantic runtime invocation.
 */

/** Guard outcomes (SEAM D preSynthesisGuard.guardResult vocabulary). */
export const GUARD_PASS = 'PASS';
export const GUARD_FAIL_CLOSED = 'FAIL_CLOSED';

/** Machine-readable guard failure codes (distinct identities, §10.2). */
export const GUARD_ERROR_MISMATCH = 'SEAM_C_GUARD_MISMATCH';
export const GUARD_ERROR_IDENTITY_MISSING = 'T14_GUARD_IDENTITY_MISSING';
export const GUARD_ERROR_IDENTITY_FORMAT = 'T14_GUARD_IDENTITY_FORMAT';

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
const PLAN_HASH = /^[0-9a-f]{64}$/;

/** Frozen §9.2 completeness vocabulary; synthesis requires verified representations. */
const COMPLETENESS_STATUSES = ['captured', 'verified', 'partial', 'failed'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate one guard identity input. Returns { ok, code? } — never throws.
 */
function checkIdentity(value, label) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, code: GUARD_ERROR_IDENTITY_MISSING, label };
  }
  if (typeof value !== 'string' || !SHA256_REF.test(value)) {
    return { ok: false, code: GUARD_ERROR_IDENTITY_FORMAT, label };
  }
  return { ok: true };
}

/**
 * PRE-SYNTHESIS coverage guard — mechanical comparison, both branches evidence-
 * bearing. Never throws; never writes anything.
 *
 * @returns {{ ok: boolean, guardResult: 'PASS'|'FAIL_CLOSED', code?: string,
 *             selectedVerifiedSourceSetIdentity: string,
 *             mappedAnalyzedSourceSetIdentity: string }}
 *   On PASS: ok=true, guardResult=GUARD_PASS, both identities echoed (the
 *   SEAM D preSynthesisGuard evidence block).
 *   On failure: ok=false, guardResult=GUARD_FAIL_CLOSED, machine-readable code,
 *   BOTH identities recorded in the evidence (or the offending one absent so the
 *   omission itself is visible).
 */
export function runPreSynthesisGuard({ selectedVerifiedSourceSetIdentity, mappedAnalyzedSourceSetIdentity }) {
  const evidence = {
    guardResult: GUARD_FAIL_CLOSED,
    selectedVerifiedSourceSetIdentity: isNonEmptyString(selectedVerifiedSourceSetIdentity)
      ? selectedVerifiedSourceSetIdentity
      : null,
    mappedAnalyzedSourceSetIdentity: isNonEmptyString(mappedAnalyzedSourceSetIdentity)
      ? mappedAnalyzedSourceSetIdentity
      : null,
  };

  const selected = checkIdentity(selectedVerifiedSourceSetIdentity, 'selectedVerifiedSourceSetIdentity');
  if (!selected.ok) {
    return { ...evidence, ok: false, code: selected.code };
  }
  const analyzed = checkIdentity(mappedAnalyzedSourceSetIdentity, 'mappedAnalyzedSourceSetIdentity');
  if (!analyzed.ok) {
    return { ...evidence, ok: false, code: analyzed.code };
  }

  if (selectedVerifiedSourceSetIdentity !== mappedAnalyzedSourceSetIdentity) {
    // Mechanical string inequality → FAIL_CLOSED + NO SYNTHESIS ARTIFACT.
    return { ...evidence, ok: false, code: GUARD_ERROR_MISMATCH };
  }

  return {
    ok: true,
    guardResult: GUARD_PASS,
    selectedVerifiedSourceSetIdentity,
    mappedAnalyzedSourceSetIdentity,
  };
}

/**
 * SEAM C input readability gate (structural minimum T14 needs before it may
 * even run the guard or aggregate). Mirrors the FROZEN seam validator's
 * fail-closed codes (test/helpers/p1-seam-contracts.mjs — same authority, kept
 * in sync deliberately; lib must not import from test/).
 *
 * @returns {{ ok: boolean, errors: Array<{code, path, detail}>,
 *             selectedVerifiedSourceSetIdentity?: string,
 *             mappedAnalyzedSourceSetIdentity?: string }}
 */
export function readSeamCInput(artifact) {
  const errors = [];
  if (!isPlainObject(artifact)) {
    return { ok: false, errors: [{ code: 'SEAM_C_SHAPE', path: '$', detail: 'not an object' }] };
  }
  if (artifact.seam !== 'T13_TO_T14') errors.push({ code: 'SEAM_C_ID', path: '$.seam', detail: 'expected T13_TO_T14' });
  if (artifact.seamVersion !== 1) errors.push({ code: 'SEAM_C_VERSION', path: '$.seamVersion', detail: 'expected 1' });
  if (typeof artifact.planHash !== 'string' || !PLAN_HASH.test(artifact.planHash)) {
    errors.push({ code: 'SEAM_C_PLAN_HASH', path: '$.planHash', detail: '64hex required' });
  }
  if (typeof artifact.selectedCorpusIdentityRef !== 'string' || !SHA256_REF.test(artifact.selectedCorpusIdentityRef)) {
    errors.push({ code: 'SEAM_C_INPUT_ECHO', path: '$.selectedCorpusIdentityRef', detail: 'sha256:64hex required (read-only echo of SEAM B identity)' });
  }

  const groups = artifact.groupRepresentations;
  if (!Array.isArray(groups) || groups.length === 0) {
    errors.push({ code: 'SEAM_C_REPRESENTATIONS_REQUIRED', path: '$.groupRepresentations', detail: 'non-empty array required' });
  } else {
    groups.forEach((group, i) => {
      const p = `$.groupRepresentations[${i}]`;
      if (!isNonEmptyString(group.groupId)) {
        errors.push({ code: 'SEAM_C_GROUP_ID', path: `${p}.groupId`, detail: 'required' });
      }
      if (!COMPLETENESS_STATUSES.includes(group.completenessStatus)) {
        errors.push({ code: 'SEAM_C_COMPLETENESS_STATUS', path: `${p}.completenessStatus`, detail: `one of ${COMPLETENESS_STATUSES.join('/')}` });
      }
      const acc = group.accounting;
      if (!isPlainObject(acc) || ![acc.selected, acc.verified, acc.mapped, acc.analyzed].every((v) => Number.isInteger(v) && v >= 0)
        || !(acc.analyzed <= acc.verified && acc.verified <= acc.selected)) {
        errors.push({ code: 'SEAM_C_ACCOUNTING_INCONSISTENT', path: `${p}.accounting`, detail: 'require analyzed <= verified <= selected' });
      }
      const claims = group.claims;
      if (!isPlainObject(claims) || !Array.isArray(claims.main) || !Array.isArray(claims.minority) || !Array.isArray(claims.contradictory)) {
        errors.push({ code: 'SEAM_C_CLAIM_STRUCTURE_REQUIRED', path: `${p}.claims`, detail: 'main/minority/contradictory arrays required' });
      } else {
        for (const kind of ['main', 'minority', 'contradictory']) {
          claims[kind].forEach((claim, j) => {
            if (!isNonEmptyString(claim.claimId) || !isNonEmptyString(claim.statement)
              || !Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0
              || !claim.sourceRefs.every(isNonEmptyString)) {
              errors.push({ code: 'SEAM_C_CLAIM_LINEAGE_REQUIRED', path: `${p}.claims.${kind}[${j}]`, detail: 'claimId + statement + controller-owned sourceRefs required' });
            }
          });
        }
      }
      if (!Array.isArray(group.expertEvidenceRichRefs)) {
        errors.push({ code: 'SEAM_C_EXPERT_REFS_REQUIRED', path: `${p}.expertEvidenceRichRefs`, detail: 'array required' });
      }
      if (!isPlainObject(group.discussionVolume)) {
        errors.push({ code: 'SEAM_C_DISCUSSION_VOLUME', path: `${p}.discussionVolume`, detail: 'separate signal object required' });
      } else if (!Number.isInteger(group.discussionVolume.answerCount) || group.discussionVolume.answerCount < 0) {
        errors.push({ code: 'SEAM_C_DISCUSSION_VOLUME', path: `${p}.discussionVolume.answerCount`, detail: 'non-negative int required (separate signal, never an epistemic weight)' });
      }
    });
  }

  const agg = artifact.aggregateAnalyzedIdentity;
  if (!isPlainObject(agg) || !SHA256_REF.test(agg.mappedAnalyzedSourceSetIdentity || '') || !isPlainObject(agg.perGroup)) {
    errors.push({ code: 'SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE', path: '$.aggregateAnalyzedIdentity', detail: 'mappedAnalyzedSourceSetIdentity + perGroup map required (single writer = P1-T13 by static authority)' });
  }

  // NOTE: claim statements are EXTERNAL_CORPUS-derived (UNTRUSTED_CONTENT /
  // DATA_NOT_INSTRUCTION, Spec §10.1). Per the reviewed projection precedent
  // (corpus-anthology/lib/lmstudio-projection.mjs) they are SANITIZED at the
  // runtime boundary (cross-source-synthesis.mjs), not rejected here — real
  // Zhihu corpus legitimately contains URL/path-like tokens, and failing the
  // whole group on them would be a false positive. Identity/lineage fields
  // above ARE rejected fail-closed.

  return {
    ok: errors.length === 0,
    errors,
    selectedVerifiedSourceSetIdentity: artifact.selectedCorpusIdentityRef,
    mappedAnalyzedSourceSetIdentity: isPlainObject(agg) ? agg.mappedAnalyzedSourceSetIdentity : undefined,
  };
}
