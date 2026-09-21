// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/cross-group-aggregation.mjs
 *
 * P1-T14 — mechanical cross-group Claim/Aspect aggregation (Stage 1).
 *
 * Authority:
 *   - docs/specs/p1-cross-question-deep-research.md §8.2:
 *       "跨 group 聚合相同/相反 claims，并保留 supporting/opposing sources、
 *        questions/groups、authors、expert/evidence-rich support。禁止只保留
 *        support_count。"
 *     §8.3: 禁止 flat reduce，禁止 naive equal weight；answer count 不自动成为
 *     epistemic weight。
 *   - docs/specs/p1-cross-question-deep-research.md (2026-09-19 repair
 *     amendment, effective S1): proposition families + claim-level stance +
 *     orthogonal relationStatus/supportBreadth + independent unresolved.
 *   - docs/planning/P1_SEAM_CONTRACTS_V1.md §SEAM C (input) / §SEAM D V2
 *     (output).
 *
 * What this module does (deterministic, no runtime, no thresholds):
 *   Stage 1 turns per-group SEAM C claim records into flat-but-STRUCTURED claim
 *   records that keep every §8.2 dimension:
 *     - claimId / statement / kind (main|minority|contradictory) / groupId;
 *     - sourceRefs (controller-owned canonicalSourceIds — never re-minted) with
 *       the claim's controller-attached authorRef carrier;
 *     - expertEvidenceRichSupport = claim refs ∩ group expertEvidenceRichRefs ≠ ∅.
 *
 * P1-R05 (Issue #93) CHANGE — the F03 root cause is REMOVED here:
 *   the V1 aggregation mechanically attached a group's `contradictory` claims as
 *   OPPOSING every `main` claim of that group (and vice versa). That promoted a
 *   GROUP-LOCAL metadata kind into a GLOBAL opposition relation, so an unrelated
 *   main claim inherited an opposition it never carried, and the downstream
 *   union then collapsed the whole cluster into a legacy `conflicting`
 *   category. Under the effective S1 / SEAM D V2 contract:
 *     - `kind` (main/minority/contradictory) is GROUP-LOCAL METADATA ONLY;
 *     - opposition is expressed EXCLUSIVELY as a per-claim STANCE inside a
 *       proposition family, proposed by the semantic runtime and re-validated /
 *       assembled by the controller (cross-source-synthesis.mjs);
 *     - this module therefore emits NO support/oppose sides at all. It emits the
 *       complete ORIGINAL LINEAGE from which the controller derives the sides.
 *   No group-local contradictory → global OPPOSES inference remains anywhere.
 *
 * What it deliberately does NOT do:
 *   - no cross-group proposition clustering (semantic stage → injected runtime
 *     in cross-source-synthesis.mjs; the runtime proposes families/stances,
 *     never owns identities);
 *   - no weights, no scores, no counts as epistemic signal; discussion volume
 *     stays a separate disclosure signal and never enters this module;
 *   - no flat reduce: every output record retains its full source structure.
 */

import crypto from 'node:crypto';

/** SEAM D V2 semantic contract version — frozen with the D major (P1-R03/#91). */
export const SYNTHESIS_SEMANTIC_CONTRACT_VERSION = 2;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Stage-1 mechanical aggregation over a structurally-validated SEAM C artifact
 * (validate FIRST via readSeamCInput — this function assumes validity).
 *
 * One record per SEAM C claim, carrying the COMPLETE ORIGINAL LINEAGE
 * (claimId / statement / kind / groupId / sourceRefs with authorRef carrier).
 * No cross-claim relation is inferred here: relations are stance-driven and
 * family-scoped (see the P1-R05 note above).
 *
 * @returns {{ ok: true, records: Array<object> }} — one record per SEAM C claim.
 */
export function aggregateCrossGroupClaims(seamCArtifact) {
  const records = [];
  for (const group of seamCArtifact.groupRepresentations) {
    const expertRefs = new Set(group.expertEvidenceRichRefs);
    for (const kind of ['main', 'minority', 'contradictory']) {
      for (const claim of group.claims[kind]) {
        // Author dimension: authorRef is the claim's CONTROLLER-OWNED carrier
        // value consumed VERBATIM from the SEAM C input (single writer =
        // P1-T13; the model never creates it). null = author identity
        // unresolvable upstream → disclosed as null, never fabricated.
        const authorRef = claim.authorRef ?? null;
        records.push({
          claimId: claim.claimId,
          statement: claim.statement,
          // group-local metadata ONLY — never a global relation or a global
          // minority taxonomy (P1-R05 / effective S1).
          kind,
          groupId: group.groupId,
          sourceRefs: claim.sourceRefs.map((ref) => ({
            sourceRef: ref,
            groupId: group.groupId,
            authorRef,
          })),
          expertEvidenceRichSupport: claim.sourceRefs.some((ref) => expertRefs.has(ref)),
        });
      }
    }
  }
  return { ok: true, records };
}

/**
 * Full canonical lineage entries for one aggregated claim record.
 *
 * Every entry binds the ORIGINAL sourceClaimId, so two claims that share a
 * sourceRef NEVER collapse (SEAM D V2 REQUIRED_INVARIANTS 5: "不能将同 source
 * 两侧 claim dedupe 丢失" — Case F keeps both c1 ASSERTS / c2 OPPOSES
 * lineages even when the sourceRef is identical).
 */
export function lineageEntries(record) {
  return record.sourceRefs.map((ref) => ({
    sourceClaimId: record.claimId,
    sourceRef: ref.sourceRef,
    groupId: ref.groupId,
    authorRef: ref.authorRef ?? null,
  }));
}

/**
 * Deterministic controller-derived familyKey for a proposition family
 * (SEAM D V2 IDENTITY_FIELDS): run-scoped, binds the semantic contract
 * version, the aspect, the anchor identity and the canonical
 * (claimId, stance) sequence. Never model-minted, never cross-run merged.
 */
export function deriveFamilyKey({ aspect, anchorClaimId, members }) {
  const digest = crypto.createHash('sha256')
    .update(canonicalJson({
      semanticContractVersion: SYNTHESIS_SEMANTIC_CONTRACT_VERSION,
      aspect,
      anchorClaimId,
      members: [...members]
        .map((m) => [m.claimId, m.stance])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    }), 'utf8')
    .digest('hex');
  return `fam-${digest.slice(0, 16)}`;
}

export { canonicalJson };
