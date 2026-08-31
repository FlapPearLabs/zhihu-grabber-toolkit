// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/rrf.mjs
 *
 * P1-T06 — Deterministic RRF (Reciprocal Rank Fusion) candidate fusion
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §5.4; Issue #38).
 *
 * RRF fuses QUERY/PROVIDER RETRIEVAL RANKINGS only. Its channel identity comes
 * from query + ZhihuDataProvider/capability — it does NOT include SemanticRuntime
 * or EmbeddingProvider. RRF is Candidate Fusion ONLY: it never selects a final
 * corpus (selection is a downstream controller responsibility, T08).
 *
 * Determinism contract (Issue #38):
 *   - scores accumulate 1/(RRF_K + rank) per contributing channel;
 *   - accumulation is canonical: each candidate's contributions are summed in
 *     channelKey order (query asc, providerId asc, capability asc) so that any
 *     input channel permutation yields bitwise-identical scores;
 *   - candidate order: rrfScore desc, then questionId ASC (lexicographic string
 *     compare) — documented tie semantics;
 *   - item array order within a ranking is irrelevant (rank comes from
 *     provenance.rank, never from array position);
 *   - facts/sourceUrl of a fused candidate are taken from the canonical-first
 *     contributing channel (channelKey ascending) — permutation-invariant.
 *
 * Fail-closed semantics:
 *   - malformed channel identity, or a FUSIBLE item with a missing/invalid
 *     1-based integer rank or missing/empty questionId → hard error (throws with
 *     a machine-readable .code; nothing half-fused);
 *   - items already carrying a per-item provider failure (T05 seam P2-1 shape)
 *     are REJECTED (never fused) and surfaced in `rejected` with their
 *     machine-readable failure identity + contributing channel;
 *   - a duplicate of an already-contributed candidate within the same channel is
 *     explicitly REJECTED with a machine-readable failure identity — it is never
 *     silently re-ranked (the first occurrence keeps its rank).
 *
 * This module is PURE: no IO, no seam, no credentials, no clock.
 */

/** Standard RRF constant (k = 60). */
export const RRF_K = 60;

/** Rank source field inside provider-result items. */
export const RRF_RANK_SOURCE = 'provenance.rank';

/** Documented tie-break identity. */
export const RRF_TIE_BREAK = 'score-desc-questionId-asc';

/** Hard fail-closed error codes (malformed input; nothing half-fused). */
export const FUSION_ERROR_CHANNEL_IDENTITY_INVALID = 'FUSION_CHANNEL_IDENTITY_INVALID';
export const FUSION_ERROR_RANK_INVALID = 'FUSION_RANK_INVALID';
export const FUSION_ERROR_ITEM_IDENTITY_INVALID = 'FUSION_ITEM_IDENTITY_INVALID';

/** Rejection failure identity (explicit, machine-readable; never silent). */
export const FUSION_REJECT_DUPLICATE_IN_CHANNEL = 'DUPLICATE_CANDIDATE_IN_CHANNEL';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** Canonical channel key: [query, providerId, capability] — exact §5.4 identity triple. */
function channelKey(channel) {
  return JSON.stringify([channel.query, channel.providerId, channel.capability]);
}

/** Compare two channel keys lexicographically (array element order). */
function compareChannelKey(a, b) {
  const [aq, ap, ac] = JSON.parse(a);
  const [bq, bp, bc] = JSON.parse(b);
  if (aq !== bq) return aq < bq ? -1 : 1;
  if (ap !== bp) return ap < bp ? -1 : 1;
  if (ac !== bc) return ac < bc ? -1 : 1;
  return 0;
}

/**
 * Validate one channel identity (§5.4): non-empty query + providerId + capability.
 * Throw FUSION_CHANNEL_IDENTITY_INVALID otherwise (fail closed).
 */
function assertValidChannel(channel) {
  if (!isPlainObject(channel)
    || !isNonEmptyString(channel.query)
    || !isNonEmptyString(channel.providerId)
    || !isNonEmptyString(channel.capability)) {
    const err = new Error(`malformed fusion channel identity (query + providerId + capability required): ${JSON.stringify(channel)}`);
    err.code = FUSION_ERROR_CHANNEL_IDENTITY_INVALID;
    throw err;
  }
  return channel;
}

/**
 * Deterministic RRF fusion over an explicit list of retrieval-ranked channels.
 *
 * @param {Array<{ channel: {query, providerId, capability}, items: Array }>} rankings
 *   each ranking mirrors a §5.1 provider result channel: `channel` is the exact
 *   query+provider+capability identity; `items` are provider-result items
 *   (identity.questionId + provenance.rank + optional per-item failure).
 * @returns {{ candidates: Array, rejected: Array }}
 *   candidates: deterministically ordered fused candidates
 *     [{ identity: {kind, questionId}, rrfScore, ranks: [{channel, rank, rankOrigin}],
 *       sourceUrl, facts }]
 *   rejected: explicitly rejected observations
 *     [{ channel, identity, rank, failure: {code, class} }]
 * @throws {Error} with .code = FUSION_* when input is malformed (fail closed).
 */
export function rrfFusion(rankings) {
  if (!Array.isArray(rankings)) {
    const err = new Error('rankings must be an array of channel rankings');
    err.code = FUSION_ERROR_CHANNEL_IDENTITY_INVALID;
    throw err;
  }

  const rejected = []; // deterministic: input channel order × item order
  const byCandidate = new Map(); // questionId -> accumulated record

  for (const ranking of rankings) {
    assertValidChannel(ranking?.channel);
    if (!Array.isArray(ranking.items)) {
      const err = new Error(`ranking items must be an array for channel ${JSON.stringify(ranking.channel)}`);
      err.code = FUSION_ERROR_CHANNEL_IDENTITY_INVALID;
      throw err;
    }
    const key = channelKey(ranking.channel);

    for (const item of ranking.items) {
      const hasFailure = isPlainObject(item?.failure);

      // Items already carrying a provider failure are never fused (T05 P2-1):
      // they surface in `rejected` with their machine-readable identity.
      if (hasFailure) {
        rejected.push({
          channel: ranking.channel,
          identity: item.identity ?? null,
          rank: item.provenance?.rank ?? null,
          failure: item.failure,
        });
        continue;
      }

      // FUSIBLE item: mechanical contract checks (fail closed, nothing half-fused).
      const identity = item?.identity;
      if (!isPlainObject(identity) || !isNonEmptyString(identity.questionId)) {
        const err = new Error(`fusible item without a valid questionId identity in channel ${JSON.stringify(ranking.channel)}`);
        err.code = FUSION_ERROR_ITEM_IDENTITY_INVALID;
        throw err;
      }
      const rank = item?.provenance?.rank;
      if (!Number.isInteger(rank) || rank < 1) {
        const err = new Error(`fusible item carries no valid 1-based ${RRF_RANK_SOURCE} (got ${JSON.stringify(rank)}) in channel ${JSON.stringify(ranking.channel)}`);
        err.code = FUSION_ERROR_RANK_INVALID;
        throw err;
      }

      const questionId = identity.questionId;
      let record = byCandidate.get(questionId);
      if (!record) {
        record = {
          questionId,
          identity: { kind: identity.kind ?? 'candidate', questionId },
          contributions: [],
        };
        byCandidate.set(questionId, record);
      }

      // Duplicate within the same channel: explicitly rejected, never re-ranked.
      if (record.contributions.some((c) => c.key === key)) {
        rejected.push({
          channel: ranking.channel,
          identity,
          rank,
          failure: { code: FUSION_REJECT_DUPLICATE_IN_CHANNEL, class: 'contract' },
        });
        continue;
      }

      record.contributions.push({
        key,
        channel: ranking.channel,
        rank,
        rankOrigin: item.provenance?.rankOrigin ?? null,
        source_url: item.source_url ?? null,
        facts: item.facts ?? {},
      });
    }
  }

  const candidates = [];
  for (const record of byCandidate.values()) {
    // Canonical accumulation order (permutation-invariant → bitwise-deterministic).
    record.contributions.sort((a, b) => compareChannelKey(a.key, b.key));
    let rrfScore = 0;
    for (const c of record.contributions) rrfScore += 1 / (RRF_K + c.rank);

    const first = record.contributions[0]; // canonical-first contributing channel
    candidates.push({
      identity: record.identity,
      rrfScore,
      ranks: record.contributions.map((c) => ({
        channel: c.channel,
        rank: c.rank,
        rankOrigin: c.rankOrigin,
      })),
      source_url: first.source_url,
      facts: first.facts,
    });
  }

  // Deterministic candidate order: score desc, then questionId ASC (documented tie).
  candidates.sort((a, b) => {
    if (a.rrfScore !== b.rrfScore) return b.rrfScore - a.rrfScore;
    return a.identity.questionId < b.identity.questionId ? -1 : 1;
  });

  return { candidates, rejected };
}