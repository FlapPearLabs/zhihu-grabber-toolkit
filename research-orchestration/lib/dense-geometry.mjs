// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/dense-geometry.mjs
 *
 * P1-T11 — Dense semantic geometry layer (Issue #43; Spec §3.2, §5.3).
 *
 * Consumes a Candidate / Retrieval Pool's embeddings + a target (research
 * intent) embedding and emits deterministic geometry signals for the T12 RCE
 * selector:
 *   - relevance  : cosine(target, candidate)            — semantic relevance
 *   - redundancy : max non-self peer cosine (clamped≥0)  — lightweight
 *                  redundancy / similarity (feeds optional MMR in T12)
 *   - novelty    : 1 - redundancy                        — semantic novelty
 *   - pairwiseSimilarity : full N×N cosine matrix         — peer geometry
 *
 * Hard Contracts (inherit from T10 / T01 / Spec §3.2 / §5.3 / §10):
 *   - NO provider / model / profile reselection. The required embedding
 *     identity is consumed verbatim from the accepted LOCAL T10/T01 profile.
 *   - Embeddings MUST carry identity metadata matching the accepted profile
 *     (providerId / modelId / modelRevision / vectorDimension /
 *     embeddingVersion / inputNormalizationVersion / outputNormalizationVersion).
 *   - Missing / invalid / identity-mismatched embeddings FAIL CLOSED with
 *     DENSE_CAPABILITY_UNAVAILABLE. NO silent fallback to popularity-only,
 *     remote embedding, or zero-vectors.
 *   - Geometry math is PURE and DETERMINISTIC. All output is a function of the
 *     validated inputs only; no stochasticity, no network, no global state.
 *   - Security invariant (T10 default-deny): caller-controlled identity values
 *     (modelId / modelRevision / etc.) are NEVER echoed into any error surface.
 *     Mismatch reports only a stable machine-readable reason.
 */

import {
  ACCEPTED_LOCAL_PROFILE,
  EMBEDDING_ERROR_DENSE_UNAVAILABLE,
  validateEmbeddingVector,
} from './embedding-provider.mjs';

/** Reuse T10's machine-readable fail-closed identity. Value: 'DENSE_CAPABILITY_UNAVAILABLE'. */
export const DENSE_CAPABILITY_UNAVAILABLE = EMBEDDING_ERROR_DENSE_UNAVAILABLE;

/**
 * The exact embedding identity contract this geometry layer requires.
 * T11 CONSUMES the accepted T10/T01 LOCAL profile; it does not redefine or
 * reselect it. These seven fields are the only ones T11 validates against.
 */
export const REQUIRED_EMBEDDING_IDENTITY = Object.freeze({
  providerId: ACCEPTED_LOCAL_PROFILE.providerId,
  modelId: ACCEPTED_LOCAL_PROFILE.modelId,
  modelRevision: ACCEPTED_LOCAL_PROFILE.modelRevision,
  vectorDimension: ACCEPTED_LOCAL_PROFILE.vectorDimension,
  embeddingVersion: ACCEPTED_LOCAL_PROFILE.embeddingVersion,
  inputNormalizationVersion: ACCEPTED_LOCAL_PROFILE.inputNormalizationVersion,
  outputNormalizationVersion: ACCEPTED_LOCAL_PROFILE.outputNormalizationVersion,
});

/** Identity fields compared (exact equality) against the accepted profile. */
const IDENTITY_FIELDS = Object.freeze([
  'providerId',
  'modelId',
  'modelRevision',
  'vectorDimension',
  'embeddingVersion',
  'inputNormalizationVersion',
  'outputNormalizationVersion',
]);

/** Resolved once from the frozen profile (768). */
const REQUIRED_DIMENSION = REQUIRED_EMBEDDING_IDENTITY.vectorDimension;

/**
 * Deterministic relevance/equality epsilon. Two signals whose relevance differ
 * by ≤ EPS are treated as TIED; callers (T12) own the final tie-break policy,
 * but T11 provides a stable, documented fallback (id ASC) so the layer itself
 * is never order-ambiguous. Documented, not hidden.
 */
export const DENSE_SIMILARITY_EPSILON = 1e-9;

function failClosed(reason) {
  const err = new Error(`Dense geometry unavailable: ${reason}`);
  err.code = DENSE_CAPABILITY_UNAVAILABLE;
  return err;
}

/**
 * Validates an embedding identity against the accepted LOCAL profile.
 * Returns { ok, reason }. Never echoes caller-controlled identity values.
 *
 * @param {object|null|undefined} identity
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateEmbeddingIdentity(identity) {
  if (!identity || typeof identity !== 'object') {
    return { ok: false, reason: 'identity_missing' };
  }
  for (const field of IDENTITY_FIELDS) {
    if (identity[field] !== REQUIRED_EMBEDDING_IDENTITY[field]) {
      // Stable reason only — the actual caller value (e.g. an attacker-chosen
      // modelId) is deliberately NOT surfaced (RULES §11 / T10 default-deny).
      return { ok: false, reason: 'identity_mismatch' };
    }
  }
  return { ok: true };
}

/**
 * Validates a full embedding { vector, identity }: identity must match the
 * accepted profile AND the vector must pass the canonical T10 vector contract
 * (exactly 768 finite numbers, L2 unit-norm within tolerance).
 *
 * @param {object} embedding - { vector: number[], identity: object }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateEmbedding(embedding) {
  if (!embedding || typeof embedding !== 'object') {
    return { ok: false, reason: 'embedding_missing' };
  }
  const idCheck = validateEmbeddingIdentity(embedding.identity);
  if (!idCheck.ok) return { ok: false, reason: idCheck.reason };

  const vCheck = validateEmbeddingVector(embedding.vector, {
    expectedDimension: REQUIRED_DIMENSION,
  });
  if (!vCheck.ok) return { ok: false, reason: vCheck.reason };
  return { ok: true };
}

/**
 * Pure deterministic cosine similarity of two equal-length numeric vectors.
 * Returns dot / (|a|·|b|). Degenerate (both ~zero) => 0 (treated orthogonal).
 * Throws DENSE_CAPABILITY_UNAVAILABLE only on length mismatch (caller error);
 * validated input never hits this.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  const n = a.length;
  if (n !== b.length) {
    throw failClosed('vector_length_mismatch');
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom < 1e-12) return 0;
  return dot / denom;
}

/**
 * Deterministic comparator for T12 consumption: orders by relevance desc.
 * TIE semantics (documented): when |a.relevance - b.relevance| ≤ EPS the two
 * are considered equal and the stable fallback is id ASC. This makes any
 * ordering derived from T11 reproducible, independent of input array order.
 */
export function compareByRelevance(a, b) {
  const ra = a?.relevance ?? 0;
  const rb = b?.relevance ?? 0;
  if (Math.abs(ra - rb) <= DENSE_SIMILARITY_EPSILON) {
    const ia = String(a?.id ?? '');
    const ib = String(b?.id ?? '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }
  return rb - ra;
}

/**
 * Core geometry computation over a validated target embedding + candidate
 * embeddings. Pure & deterministic; fail-closed on any missing/invalid/
 * identity-mismatched embedding.
 *
 * @param {{ target: object, items: Array<object> }} args
 *   target : { id?, vector: number[], identity: object }
 *   items  : [{ id, vector: number[], identity: object }]
 * @returns {{
 *   profile: object,
 *   targetId: (string|null),
 *   vectorDimension: number,
 *   candidateCount: number,
 *   signals: Array<{ id, relevance: number, redundancy: number, novelty: number }>,
 *   pairwiseSimilarity: number[][]
 * }}
 */
export function computeDenseGeometry({ target, items } = {}) {
  if (!target || !Array.isArray(items)) {
    throw failClosed('invalid_input');
  }

  const targetCheck = validateEmbedding(target);
  if (!targetCheck.ok) {
    throw failClosed(targetCheck.reason);
  }

  const n = items.length;
  const vectors = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const item = items[i];
    if (!item) throw failClosed('item_missing');
    const chk = validateEmbedding(item);
    if (!chk.ok) throw failClosed(chk.reason);
    vectors[i] = item.vector;
  }

  // Relevance: cosine(target, candidate)
  const relevance = new Array(n);
  for (let i = 0; i < n; i += 1) {
    relevance[i] = cosineSimilarity(target.vector, vectors[i]);
  }

  // Pairwise similarity matrix (symmetric, N×N)
  const pairwise = new Array(n);
  for (let i = 0; i < n; i += 1) {
    pairwise[i] = new Array(n);
    for (let j = 0; j < n; j += 1) {
      pairwise[i][j] = cosineSimilarity(vectors[i], vectors[j]);
    }
  }

  // Redundancy[i] = max over j≠i of clamped peer similarity (clamped ≥ 0 so
  // negative cosines do not push novelty > 1). Single candidate => 0.
  const redundancy = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let maxSim = 0;
    if (n > 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const s = pairwise[i][j];
        const clamped = s > 0 ? s : 0;
        if (clamped > maxSim) maxSim = clamped;
      }
    }
    redundancy[i] = maxSim;
  }

  const novelty = redundancy.map((r) => 1 - r);

  const signals = items.map((item, i) => ({
    id: item.id,
    relevance: relevance[i],
    redundancy: redundancy[i],
    novelty: novelty[i],
  }));

  return {
    profile: { ...REQUIRED_EMBEDDING_IDENTITY },
    targetId: target.id ?? null,
    vectorDimension: REQUIRED_EMBEDDING_IDENTITY.vectorDimension,
    candidateCount: n,
    signals,
    pairwiseSimilarity: pairwise,
  };
}

/**
 * Pool-aware adapter: consumes a T06 Candidate / Retrieval Pool (candidates
 * carrying identity.questionId) plus a target embedding and an embedding lookup
 * keyed by questionId. Validates every candidate embedding; fail-closed when
 * any candidate lacks a valid/accepted embedding. Returns the same geometry
 * result as computeDenseGeometry (signals parallel to pool.candidates order).
 *
 * @param {{ target: object, pool: object, embeddingsById: object }} args
 * @returns {object} geometry result (see computeDenseGeometry)
 */
export function computeDenseGeometryForPool({ target, pool, embeddingsById } = {}) {
  if (!pool || !Array.isArray(pool.candidates)) {
    throw failClosed('invalid_pool');
  }
  if (!embeddingsById || typeof embeddingsById !== 'object') {
    throw failClosed('missing_embeddings');
  }

  const items = [];
  for (const cand of pool.candidates) {
    const qid = cand?.identity?.questionId;
    if (!qid) throw failClosed('pool_candidate_identity_invalid');
    const emb = embeddingsById[qid];
    if (!emb) throw failClosed('missing_embedding_for_candidate');
    items.push({ id: qid, vector: emb.vector, identity: emb.identity });
  }

  return computeDenseGeometry({ target, items });
}
