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
 *     contributing channel (channelKey ascending) — permutation-invariant;
 *   - candidate identity is canonical: every fused candidate identity.kind is
 *     'candidate' (T06 candidate contract), independent of any upstream item
 *     kind — permutation-invariant under differing/missing upstream kinds;
 *   - retrieval-route provenance (provenance.route) is preserved on every fused
 *     rank (and every rejected observation); an absent upstream route stays
 *     NULL and is never invented.
 *
 * Fail-closed semantics:
 *   - malformed channel identity, or a FUSIBLE item with a missing/invalid
 *     1-based integer rank or missing/empty questionId → hard error (throws with
 *     a machine-readable .code; nothing half-fused);
 *   - items carrying a per-item provider failure (T05 seam P2-1 shape) are
 *     REJECTED (never fused) and surfaced in `rejected` with their
 *     machine-readable failure identity + contributing channel; an EXPLICIT
 *     per-item failure that is present-but-malformed (not a { code, class }
 *     identity) is a CONTRACT VIOLATION → hard error (never treated as "no
 *     failure", never fused);
 *   - a duplicate of an already-contributed candidate within the same channel is
 *     a CONTRACT VIOLATION → hard error (FUSION_DUPLICATE_IN_CHANNEL): "keep the
 *     first / reject the second" would make scores depend on item array order
 *     (P1-4), so a within-channel duplicate fails closed regardless of order;
 *   - rejected observations are canonicalized by a stable key (channel triple +
 *     questionId + rank/route + failure code/class) before returning, so the
 *     rejected list is permutation-invariant under channel/item order (P1-5).
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
export const FUSION_ERROR_FAILURE_IDENTITY_INVALID = 'FUSION_FAILURE_IDENTITY_INVALID';
/** Hard fail-closed error code: within-channel duplicate candidate (P1-4). */
export const FUSION_ERROR_DUPLICATE_IN_CHANNEL = 'FUSION_DUPLICATE_IN_CHANNEL';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Safely render an arbitrary value inside a fail-closed error message (P2-2).
 * BigInt / cyclic references / hostile serializers must never prevent the
 * machine-readable error .code from being attached: JSON.stringify first, then
 * String(), then a stable placeholder — this NEVER throws.
 */
function safeFormat(value) {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // fall through to String()
  }
  try {
    return String(value);
  } catch {
    return '[unrepresentable value]';
  }
}

/**
 * A valid per-item failure identity is a machine-readable { code, class }
 * record (T05 seam P2-1 shape). Anything else present on `failure` is a
 * contract violation — distinguishable from an ABSENT failure.
 */
function isValidFailureIdentity(failure) {
  return isPlainObject(failure) && isNonEmptyString(failure.code) && isNonEmptyString(failure.class);
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
 * Canonical stable key for one rejected observation (P1-5): channel triple +
 * questionId + rank/route + failure code/class (+ full identity serialization to
 * keep identical-questionId/differing-kind observations distinguishable). Sorting
 * rejected observations by this key makes the rejected list permutation-invariant.
 * Only primitives are compared; identity is serialized with a safe fallback.
 */
function rejectedKey(rejected) {
  const identity = isPlainObject(rejected.identity) ? rejected.identity : null;
  const questionId = identity !== null && isNonEmptyString(identity.questionId) ? identity.questionId : null;
  const rank = typeof rejected.rank === 'number' && Number.isFinite(rejected.rank) ? rejected.rank : null;
  const route = typeof rejected.route === 'string' ? rejected.route : null;
  const code = isNonEmptyString(rejected.failure?.code) ? rejected.failure.code : '';
  const klass = isNonEmptyString(rejected.failure?.class) ? rejected.failure.class : '';
  let identityKey;
  try {
    identityKey = JSON.stringify(identity);
  } catch {
    identityKey = `[unserializable:${typeof identity}]`;
  }
  return JSON.stringify([
    rejected.channel?.query ?? '',
    rejected.channel?.providerId ?? '',
    rejected.channel?.capability ?? '',
    questionId,
    rank,
    route,
    code,
    klass,
    identityKey,
  ]);
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
    const err = new Error(`malformed fusion channel identity (query + providerId + capability required): ${safeFormat(channel)}`);
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
 *     [{ identity: {kind: 'candidate', questionId}, rrfScore,
 *        ranks: [{channel, rank, rankOrigin, route}], sourceUrl, facts }]
 *   rejected: explicitly rejected observations
 *     [{ channel, identity, rank, route, failure: {code, class} }]
 * @throws {Error} with .code = FUSION_* when input is malformed (fail closed).
 */
export function rrfFusion(rankings) {
  if (!Array.isArray(rankings)) {
    const err = new Error('rankings must be an array of channel rankings');
    err.code = FUSION_ERROR_CHANNEL_IDENTITY_INVALID;
    throw err;
  }

  const rejected = []; // collected in traversal order; canonicalized below (P1-5)
  const byCandidate = new Map(); // questionId -> accumulated record

  for (const ranking of rankings) {
    assertValidChannel(ranking?.channel);
    if (!Array.isArray(ranking.items)) {
      const err = new Error(`ranking items must be an array for channel ${safeFormat(ranking.channel)}`);
      err.code = FUSION_ERROR_CHANNEL_IDENTITY_INVALID;
      throw err;
    }
    const key = channelKey(ranking.channel);

    for (const item of ranking.items) {
      // Distinguish failure ABSENT vs PRESENT-BUT-MALFORMED (P1-3): an explicit
      // `failure` key must carry a machine-readable { code, class } identity.
      // A malformed explicit failure is a contract violation → fail closed
      // (never treated as "no failure", never fused, nothing half-fused).
      const failurePresent = item != null && Object.prototype.hasOwnProperty.call(item, 'failure');
      if (failurePresent) {
        if (!isValidFailureIdentity(item.failure)) {
          const err = new Error(`per-item failure present but not a machine-readable { code, class } identity in channel ${safeFormat(ranking.channel)}`);
          err.code = FUSION_ERROR_FAILURE_IDENTITY_INVALID;
          throw err;
        }
        // Items already carrying a provider failure are never fused (T05 P2-1):
        // they surface in `rejected` with their machine-readable identity.
        rejected.push({
          channel: ranking.channel,
          identity: item.identity ?? null,
          rank: item.provenance?.rank ?? null,
          route: item.provenance?.route ?? null,
          failure: item.failure,
        });
        continue;
      }

      // FUSIBLE item: mechanical contract checks (fail closed, nothing half-fused).
      const identity = item?.identity;
      if (!isPlainObject(identity) || !isNonEmptyString(identity.questionId)) {
        const err = new Error(`fusible item without a valid questionId identity in channel ${safeFormat(ranking.channel)}`);
        err.code = FUSION_ERROR_ITEM_IDENTITY_INVALID;
        throw err;
      }
      const rank = item?.provenance?.rank;
      if (!Number.isInteger(rank) || rank < 1) {
        const err = new Error(`fusible item carries no valid 1-based ${RRF_RANK_SOURCE} (got ${safeFormat(rank)}) in channel ${safeFormat(ranking.channel)}`);
        err.code = FUSION_ERROR_RANK_INVALID;
        throw err;
      }

      const questionId = identity.questionId;
      let record = byCandidate.get(questionId);
      if (!record) {
        record = {
          questionId,
          // Canonical T06 candidate identity (P1-3): fusion keys by questionId;
          // kind is normalized to the candidate contract so the fused identity is
          // order-independent — an upstream kind variant is never "first wins".
          identity: { kind: 'candidate', questionId },
          contributions: [],
        };
        byCandidate.set(questionId, record);
      }

      // Duplicate within the same channel (P1-4): "keep the first / reject the
      // second" would make scores depend on item array order (rank 1 vs rank 5),
      // which violates the item-order-independence contract. FAIL CLOSED instead —
      // the detection is order-independent (a duplicate anywhere throws).
      if (record.contributions.some((c) => c.key === key)) {
        const err = new Error(`duplicate questionId '${questionId}' within the same channel ${safeFormat(ranking.channel)}; within-channel duplicates fail closed (item-order-independence, P1-4)`);
        err.code = FUSION_ERROR_DUPLICATE_IN_CHANNEL;
        throw err;
      }

      record.contributions.push({
        key,
        channel: ranking.channel,
        rank,
        rankOrigin: item.provenance?.rankOrigin ?? null,
        route: item.provenance?.route ?? null,
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
        route: c.route,
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

  // P1-5: canonicalize rejected observations by stable key so the rejected list
  // is permutation-invariant (channel order / item order never change it).
  rejected.sort((a, b) => {
    const ka = rejectedKey(a);
    const kb = rejectedKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });

  return { candidates, rejected };
}