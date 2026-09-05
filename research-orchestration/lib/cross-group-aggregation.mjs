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
 *   - docs/planning/P1_SEAM_CONTRACTS_V1.md §SEAM C (input) / §SEAM D (output).
 *
 * What this module does (deterministic, no runtime, no thresholds):
 *   Stage 1 turns per-group SEAM C claim records into flat-but-STRUCTURED claim
 *   records that keep every §8.2 dimension:
 *     - claimId / statement / kind (main|minority|contradictory) / groupId;
 *     - sourceRefs (controller-owned canonicalSourceIds — never re-minted);
 *     - expertEvidenceRichSupport = claim refs ∩ group expertEvidenceRichRefs ≠ ∅;
 *     - in-group opposition: a group's contradictory claims oppose that group's
 *       main claims (and vice versa) — this is the ONLY mechanically decidable
 *       opposition relation in SEAM C V1.
 *
 * What it deliberately does NOT do:
 *   - no cross-group aspect clustering (semantic stage → injected runtime in
 *     cross-source-synthesis.mjs; the runtime labels aspects, never owns
 *     identities);
 *   - no weights, no scores, no counts as epistemic signal; discussion volume
 *     stays a separate disclosure signal and never enters this module;
 *   - no flat reduce: every output record retains its full source structure.
 */

import crypto from 'node:crypto';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Deterministic author dimension (§8.2 keeps authors).
 *
 * DECISION_REQUIRED: SEAM C V1 does not carry author identity (the §8.1 shape
 * has no author field), so T14 derives a stable, non-reversible pseudo author
 * token from the controller-owned canonicalSourceId. When upstream authority
 * adds author identity to SEAM C (additive = V1-compatible), this derivation is
 * replaced by the consumed field — never by a model-owned value.
 */
export function deriveAuthorRef(sourceRef) {
  // CONSUMER WARNING (DECISION_REQUIRED #1): this is a derived source-token,
  // NOT a real author identity — SEAM D consumers must not read it as an
  // author signal until the SEAM C author carrier is adjudicated.
  const digest = crypto.createHash('sha256').update(canonicalJson(sourceRef), 'utf8').digest('hex');
  return `author-${digest.slice(0, 12)}`;
}

/** One structured reference entry (§8.2 dimension triple). */
function toSideEntry(sourceRef, groupId) {
  return { sourceRef, groupId, authorRef: deriveAuthorRef(sourceRef) };
}

/**
 * Stage-1 mechanical aggregation over a structurally-validated SEAM C artifact
 * (validate FIRST via readSeamCInput — this function assumes validity).
 *
 * @returns {{ ok: true, records: Array<object> }} — one record per SEAM C claim.
 */
export function aggregateCrossGroupClaims(seamCArtifact) {
  const records = [];
  for (const group of seamCArtifact.groupRepresentations) {
    const expertRefs = new Set(group.expertEvidenceRichRefs);
    const mainSources = new Set(group.claims.main.flatMap((c) => c.sourceRefs));

    for (const kind of ['main', 'minority', 'contradictory']) {
      for (const claim of group.claims[kind]) {
        const support = claim.sourceRefs.map((ref) => toSideEntry(ref, group.groupId));
        const oppose = [];
        if (kind === 'main') {
          // in-group contradictory claims oppose this group's main claims
          for (const contra of group.claims.contradictory) {
            for (const ref of contra.sourceRefs) {
              if (!mainSources.has(ref)) oppose.push(toSideEntry(ref, group.groupId));
            }
          }
        } else if (kind === 'contradictory') {
          // this group's main claims oppose the contradictory claim
          for (const ref of mainSources) {
            oppose.push(toSideEntry(ref, group.groupId));
          }
        }
        records.push({
          claimId: claim.claimId,
          statement: claim.statement,
          kind,
          groupId: group.groupId,
          sourceRefs: [...claim.sourceRefs],
          support,
          oppose: dedupeBySourceRef(oppose),
          expertEvidenceRichSupport: claim.sourceRefs.some((ref) => expertRefs.has(ref)),
        });
      }
    }
  }
  return { ok: true, records };
}

function dedupeBySourceRef(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (seen.has(entry.sourceRef)) continue;
    seen.add(entry.sourceRef);
    out.push(entry);
  }
  return out;
}

/**
 * Deterministic controller-derived synthesis claimId for an aspect cluster:
 * traceable (the full constituent claimId list is carried alongside), stable,
 * never model-minted.
 */
export function deriveSynthesisClaimId(sourceClaimIds) {
  const digest = crypto.createHash('sha256').update(canonicalJson([...sourceClaimIds].sort()), 'utf8').digest('hex');
  return `syn-${digest.slice(0, 12)}`;
}

export { canonicalJson };
