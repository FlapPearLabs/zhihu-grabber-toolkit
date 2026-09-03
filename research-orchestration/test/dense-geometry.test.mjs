// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/dense-geometry.test.mjs
 *
 * P1-T11 focused tests — Dense semantic geometry layer (Issue #43, Spec §3.2, §5.3).
 *
 * Required evidence categories (Issue #43):
 *   1. Geometry determinism
 *   2. Failure semantics (missing / invalid / identity-mismatched → fail closed)
 *   3. Version / identity consistency
 *
 * All tests are OFFLINE + DETERMINISTIC: fixture embedding vectors carry
 * accepted identity metadata (no ONNX model load, no network). The geometry
 * math is pure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mockVector768 } from './helpers/test-embedding-provider.mjs';
import {
  REQUIRED_EMBEDDING_IDENTITY,
  DENSE_CAPABILITY_UNAVAILABLE,
  validateEmbeddingIdentity,
  validateEmbedding,
  cosineSimilarity,
  compareByRelevance,
  computeDenseGeometry,
  computeDenseGeometryForPool,
} from '../lib/dense-geometry.mjs';

/** Build an embedding fixture with the accepted identity (no attacker value). */
function acceptedEmbedding(id, seed) {
  return {
    id,
    vector: mockVector768(seed),
    identity: { ...REQUIRED_EMBEDDING_IDENTITY },
  };
}

/** Build an embedding whose identity overrides one accepted field (caller-controlled). */
function embeddingWithIdentity(id, seed, overrides) {
  return {
    id,
    vector: mockVector768(seed),
    identity: { ...REQUIRED_EMBEDDING_IDENTITY, ...overrides },
  };
}

function badVector(dimension, makeNonFinite = false) {
  const v = new Array(dimension).fill(0);
  for (let i = 0; i < dimension; i += 1) v[i] = i % 2 === 0 ? 1 : -1; // L2 ~ unit-ish, length = dimension
  if (makeNonFinite) v[0] = NaN;
  return v;
}

// Deterministic target embedding for relevance.
const TARGET = acceptedEmbedding('target-intent', 99);

// ---------------------------------------------------------------------------
// 1. GEOMETRY DETERMINISM
// ---------------------------------------------------------------------------

test('P1-T11: computeDenseGeometry is deterministic across repeated calls', () => {
  const items = [
    acceptedEmbedding('q1', 1),
    acceptedEmbedding('q2', 2),
    acceptedEmbedding('q3', 3),
  ];
  const r1 = computeDenseGeometry({ target: TARGET, items });
  const r2 = computeDenseGeometry({ target: TARGET, items });
  assert.deepEqual(r1, r2);
});

test('P1-T11: per-id signals are invariant under item reordering', () => {
  const ordered = [
    acceptedEmbedding('q1', 1),
    acceptedEmbedding('q2', 2),
    acceptedEmbedding('q3', 3),
  ];
  const shuffled = [ordered[2], ordered[0], ordered[1]];

  const rOrdered = computeDenseGeometry({ target: TARGET, items: ordered });
  const rShuffled = computeDenseGeometry({ target: TARGET, items: shuffled });

  const byId = (res) => {
    const m = new Map();
    for (const s of res.signals) m.set(s.id, s);
    return m;
  };
  const mo = byId(rOrdered);
  const ms = byId(rShuffled);
  assert.equal(mo.size, ms.size);
  for (const [id, sig] of mo) {
    const other = ms.get(id);
    assert.ok(other, `id ${id} present in both`);
    assert.equal(sig.relevance, other.relevance, `relevance stable for ${id}`);
    assert.equal(sig.redundancy, other.redundancy, `redundancy stable for ${id}`);
    assert.equal(sig.novelty, other.novelty, `novelty stable for ${id}`);
  }
});

test('P1-T11: cosineSimilarity is pure and symmetric', () => {
  const a = mockVector768(7);
  const b = mockVector768(11);
  assert.equal(cosineSimilarity(a, b), cosineSimilarity(b, a));
  assert.equal(cosineSimilarity(a, a), 1); // unit-norm self-similarity
  assert.equal(cosineSimilarity(a, b), cosineSimilarity(a.slice(), b)); // copy determinism
});

test('P1-T11: signal ranges are bounded (redundancy/novelty ∈ [0,1])', () => {
  const items = [acceptedEmbedding('q1', 1), acceptedEmbedding('q2', 2)];
  const res = computeDenseGeometry({ target: TARGET, items });
  for (const s of res.signals) {
    assert.ok(s.redundancy >= 0 && s.redundancy <= 1, 'redundancy in [0,1]');
    assert.ok(s.novelty >= 0 && s.novelty <= 1, 'novelty in [0,1]');
    assert.ok(Number.isFinite(s.relevance), 'relevance finite');
  }
  // pairwise is symmetric
  assert.equal(res.pairwiseSimilarity[0][1], res.pairwiseSimilarity[1][0]);
});

test('P1-T11: relevance == 1 when a candidate equals the target vector', () => {
  const targetCopy = {
    id: 'target-intent',
    vector: TARGET.vector,
    identity: { ...REQUIRED_EMBEDDING_IDENTITY },
  };
  const items = [targetCopy, acceptedEmbedding('q2', 2)];
  const res = computeDenseGeometry({ target: TARGET, items });
  const self = res.signals.find((s) => s.id === 'target-intent');
  assert.ok(Math.abs(self.relevance - 1) < 1e-9, 'self-relevance ~ 1');
});

test('P1-T11: single candidate has redundancy 0 / novelty 1', () => {
  const res = computeDenseGeometry({ target: TARGET, items: [acceptedEmbedding('q1', 1)] });
  assert.equal(res.candidateCount, 1);
  assert.equal(res.signals[0].redundancy, 0);
  assert.equal(res.signals[0].novelty, 1);
});

test('P1-T11: identical candidates yield high redundancy / low novelty', () => {
  const v = mockVector768(5);
  const items = [
    { id: 'a', vector: v, identity: { ...REQUIRED_EMBEDDING_IDENTITY } },
    { id: 'b', vector: v, identity: { ...REQUIRED_EMBEDDING_IDENTITY } },
  ];
  const res = computeDenseGeometry({ target: TARGET, items });
  for (const s of res.signals) {
    assert.ok(s.redundancy > 0.999, 'identical peers ~ maximal redundancy');
    assert.ok(s.novelty < 0.001, 'identical peers ~ zero novelty');
  }
});

test('P1-T11: empty items (empty pool) yields empty signals, no fail-closed', () => {
  const res = computeDenseGeometry({ target: TARGET, items: [] });
  assert.equal(res.candidateCount, 0);
  assert.deepEqual(res.signals, []);
  assert.deepEqual(res.pairwiseSimilarity, []);
});

test('P1-T11: compareByRelevance is deterministic and documented-stable on ties', () => {
  const tied = [
    { id: 'bbb', relevance: 0.5 },
    { id: 'aaa', relevance: 0.5 },
    { id: 'ccc', relevance: 0.9 },
  ];
  const sorted = [...tied].sort(compareByRelevance);
  assert.deepEqual(sorted.map((s) => s.id), ['ccc', 'aaa', 'bbb']);
});

// ---------------------------------------------------------------------------
// 2. FAILURE SEMANTICS (fail closed, never silent downgrade)
// ---------------------------------------------------------------------------

test('P1-T11: missing target fails closed with DENSE_CAPABILITY_UNAVAILABLE', () => {
  assert.throws(
    () => computeDenseGeometry({ target: null, items: [acceptedEmbedding('q1', 1)] }),
    (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
  );
});

test('P1-T11: missing candidate vector fails closed', () => {
  const items = [
    { id: 'q1', vector: null, identity: { ...REQUIRED_EMBEDDING_IDENTITY } },
  ];
  assert.throws(
    () => computeDenseGeometry({ target: TARGET, items }),
    (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
  );
});

test('P1-T11: wrong-dimension candidate vector fails closed', () => {
  const items = [
    { id: 'q1', vector: badVector(512), identity: { ...REQUIRED_EMBEDDING_IDENTITY } },
  ];
  assert.throws(
    () => computeDenseGeometry({ target: TARGET, items }),
    (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
  );
});

test('P1-T11: non-finite candidate vector fails closed', () => {
  const items = [
    { id: 'q1', vector: badVector(768, true), identity: { ...REQUIRED_EMBEDDING_IDENTITY } },
  ];
  assert.throws(
    () => computeDenseGeometry({ target: TARGET, items }),
    (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
  );
});

test('P1-T11: pool adapter fails closed when a candidate lacks an embedding', () => {
  const pool = {
    candidates: [
      { identity: { kind: 'candidate', questionId: '123' } },
      { identity: { kind: 'candidate', questionId: '456' } },
    ],
  };
  const embeddingsById = { '123': acceptedEmbedding('123', 1) }; // 456 missing
  assert.throws(
    () => computeDenseGeometryForPool({ target: TARGET, pool, embeddingsById }),
    (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
  );
});

test('P1-T11: pool adapter fails closed on malformed pool / missing lookup', () => {
  assert.throws(
    () => computeDenseGeometryForPool({ target: TARGET, pool: null, embeddingsById: {} }),
    (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
  );
  const pool = { candidates: [{ identity: { kind: 'candidate', questionId: '123' } }] };
  assert.throws(
    () => computeDenseGeometryForPool({ target: TARGET, pool, embeddingsById: null }),
    (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
  );
});

// ---------------------------------------------------------------------------
// 3. VERSION / IDENTITY CONSISTENCY
// ---------------------------------------------------------------------------

test('P1-T11: accepted identity validates; every mismatch fails closed', () => {
  assert.equal(validateEmbeddingIdentity({ ...REQUIRED_EMBEDDING_IDENTITY }).ok, true);

  const mismatchCases = {
    providerId: 'attacker-runtime',
    modelId: 'Attacker/injected-model',
    modelRevision: 'deadbeefcafe',
    vectorDimension: 512,
    embeddingVersion: 'v2',
    inputNormalizationVersion: 'T99_OTHER_NORM',
    outputNormalizationVersion: 'NONE',
  };

  for (const [field, badValue] of Object.entries(mismatchCases)) {
    const emb = embeddingWithIdentity('q1', 1, { [field]: badValue });
    const idRes = validateEmbeddingIdentity(emb.identity);
    assert.equal(idRes.ok, false, `${field} mismatch detected`);
    assert.equal(idRes.reason, 'identity_mismatch', `${field} stable reason`);

    // computeDenseGeometry must fail closed (not silently accept / downgrade)
    assert.throws(
      () => computeDenseGeometry({ target: TARGET, items: [emb] }),
      (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
      `${field} fails closed in geometry`,
    );

    // SECURITY: the attacker-chosen value must NEVER appear in the error text.
    let thrown;
    try {
      computeDenseGeometry({ target: TARGET, items: [emb] });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'error thrown');
    assert.equal(thrown.message.includes(String(badValue)), false,
      `error message must not echo caller value for ${field}`);
  }
});

test('P1-T11: missing identity object fails closed without echoing anything', () => {
  const emb = { id: 'q1', vector: mockVector768(1), identity: null };
  const idRes = validateEmbeddingIdentity(emb.identity);
  assert.equal(idRes.ok, false);
  assert.throws(
    () => computeDenseGeometry({ target: TARGET, items: [emb] }),
    (err) => err.code === DENSE_CAPABILITY_UNAVAILABLE,
  );
});

test('P1-T11: geometry result exposes the consumed accepted profile verbatim', () => {
  const res = computeDenseGeometry({ target: TARGET, items: [acceptedEmbedding('q1', 1)] });
  assert.deepEqual(res.profile, { ...REQUIRED_EMBEDDING_IDENTITY });
  assert.equal(res.vectorDimension, 768);
});
