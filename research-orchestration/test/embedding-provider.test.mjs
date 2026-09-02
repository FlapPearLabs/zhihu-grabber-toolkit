// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/embedding-provider.test.mjs
 *
 * P1-T10 focused tests — LOCAL EmbeddingProvider adapter + validation + preflight (Issue #42, Spec §5.3, §10).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ACCEPTED_LOCAL_PROFILE,
  EMBEDDING_ERROR_PROVIDER_UNREACHABLE,
  EMBEDDING_ERROR_MODEL_UNKNOWN,
  EMBEDDING_ERROR_REVISION_MISMATCH,
  EMBEDDING_ERROR_VECTOR_INVALID,
  EMBEDDING_ERROR_PROFILE_MISMATCH,
  EMBEDDING_ERROR_DENSE_UNAVAILABLE,
  EMBEDDING_ERROR_INVALID_INPUT,
  validateEmbeddingVector,
  l2Normalize,
  createEmbeddingProvider,
} from '../lib/embedding-provider.mjs';
import { EmbeddingCache } from '../lib/embedding-cache.mjs';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `embed-prov-${prefix}-`));
}

function mockVector768(seed = 1) {
  const vec = [];
  let sumSq = 0;
  for (let i = 0; i < 768; i += 1) {
    const v = Math.sin(seed + i);
    vec.push(v);
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  return vec.map((x) => x / norm);
}

test('P1-T10: Accepted profile mechanical identity (8 contract fields)', () => {
  const provider = createEmbeddingProvider();

  assert.equal(provider.providerCategory, 'LOCAL');
  assert.equal(provider.providerId, 'transformersjs-local-onnx');
  assert.equal(provider.modelId, 'Xenova/bge-base-zh-v1.5');
  assert.equal(provider.modelRevision, '71e50dc531959f9e04ebf190ea25b00261a0a186');
  assert.equal(provider.vectorDimension, 768);
  assert.equal(provider.embeddingVersion, 'v1');
  assert.equal(provider.inputNormalizationVersion, 'T01_INPUT_NORM_V1');
  assert.equal(provider.outputNormalizationVersion, 'L2_UNIT_NORM');
  assert.deepEqual(provider.egressPolicy, { category: 'LOCAL', noNewEgress: true });
});

test('P1-T10: Profile reselection rejection fail-closed', () => {
  // Rejecting any attempted profile override
  assert.throws(
    () => createEmbeddingProvider({ profileCheck: { modelId: 'Xenova/bge-small-zh-v1.5' } }),
    (err) => err.code === EMBEDDING_ERROR_PROFILE_MISMATCH
  );
  assert.throws(
    () => createEmbeddingProvider({ profileCheck: { providerCategory: 'REMOTE' } }),
    (err) => err.code === EMBEDDING_ERROR_PROFILE_MISMATCH
  );
  assert.throws(
    () => createEmbeddingProvider({ profileCheck: { modelRevision: 'main' } }),
    (err) => err.code === EMBEDDING_ERROR_PROFILE_MISMATCH
  );
});

test('P1-T10: Vector validation (768-dim, finite numbers, unit norm)', () => {
  const valid = mockVector768(1);
  const checkValid = validateEmbeddingVector(valid);
  assert.equal(checkValid.ok, true);
  assert.equal(checkValid.dimension, 768);

  // Wrong dimension
  const shortVec = valid.slice(0, 512);
  const checkShort = validateEmbeddingVector(shortVec);
  assert.equal(checkShort.ok, false);
  assert.equal(checkShort.reason, 'dimension_mismatch');

  // Non-array
  assert.equal(validateEmbeddingVector('not-array').ok, false);

  // NaN element
  const nanVec = [...valid];
  nanVec[10] = NaN;
  const checkNan = validateEmbeddingVector(nanVec);
  assert.equal(checkNan.ok, false);
  assert.equal(checkNan.reason, 'non_finite_element');

  // Infinity element
  const infVec = [...valid];
  infVec[20] = Infinity;
  const checkInf = validateEmbeddingVector(infVec);
  assert.equal(checkInf.ok, false);
  assert.equal(checkInf.reason, 'non_finite_element');

  // -Infinity element
  const negInfVec = [...valid];
  negInfVec[30] = -Infinity;
  const checkNegInf = validateEmbeddingVector(negInfVec);
  assert.equal(checkNegInf.ok, false);
  assert.equal(checkNegInf.reason, 'non_finite_element');

  // Non-numeric element
  const strVec = [...valid];
  strVec[40] = 'string-value';
  const checkStr = validateEmbeddingVector(strVec);
  assert.equal(checkStr.ok, false);
  assert.equal(checkStr.reason, 'non_finite_element');

  // All zeros
  const zeroVec = Array(768).fill(0);
  const checkZero = validateEmbeddingVector(zeroVec);
  assert.equal(checkZero.ok, false);
  assert.equal(checkZero.reason, 'zero_magnitude_vector');
});

test('P1-T10: L2 normalization helper', () => {
  const raw = Array(768).fill(2); // length = 2 * sqrt(768)
  const normalized = l2Normalize(raw);
  const valCheck = validateEmbeddingVector(normalized);
  assert.equal(valCheck.ok, true);
  assert.ok(Math.abs(valCheck.norm - 1.0) < 1e-6);

  // Zero vector throws
  assert.throws(() => l2Normalize(Array(768).fill(0)), (err) => err.code === EMBEDDING_ERROR_VECTOR_INVALID);
});

test('P1-T10: Local Preflight checks identity.json and exact revision', async () => {
  const dir = tmpDir('preflight');

  // 1. Missing identity.json -> FAILED
  const prov1 = createEmbeddingProvider({ modelDir: dir });
  const pre1 = await prov1.preflight();
  assert.equal(pre1.ok, false);
  assert.equal(pre1.status, 'FAILED');
  assert.equal(pre1.failureCode, EMBEDDING_ERROR_MODEL_UNKNOWN);

  // 2. Mismatched revision sha in identity.json -> FAILED
  fs.writeFileSync(
    path.join(dir, 'identity.json'),
    JSON.stringify({
      modelId: 'Xenova/bge-base-zh-v1.5',
      revisionSha: '0000000000000000000000000000000000000000',
    }),
    'utf8'
  );

  const prov2 = createEmbeddingProvider({ modelDir: dir });
  const pre2 = await prov2.preflight();
  assert.equal(pre2.ok, false);
  assert.equal(pre2.status, 'FAILED');
  assert.equal(pre2.failureCode, EMBEDDING_ERROR_REVISION_MISMATCH);

  // 3. Injected extractor -> READY
  const mockExtractor = async (text) => mockVector768(text.length);
  const prov3 = createEmbeddingProvider({ extractorEngine: mockExtractor });
  const pre3 = await prov3.preflight();
  assert.equal(pre3.ok, true);
  assert.equal(pre3.status, 'READY');
  assert.equal(pre3.providerId, 'transformersjs-local-onnx');
});

test('P1-T10: Embed execution with deterministic cache and vector validation', async () => {
  let computeCallCount = 0;
  const mockExtractor = async (text) => {
    computeCallCount += 1;
    return mockVector768(text.length + computeCallCount);
  };

  const cache = new EmbeddingCache({ inMemoryOnly: true });
  const provider = createEmbeddingProvider({ extractorEngine: mockExtractor, cache });

  // 1. First embed call: both computed
  const res1 = await provider.embed(['第一段文本', '第二段文本']);
  assert.equal(res1.vectors.length, 2);
  assert.equal(res1.usage.total, 2);
  assert.equal(res1.usage.computed, 2);
  assert.equal(res1.usage.cached, 0);
  assert.equal(computeCallCount, 2);

  // Validate vectors
  assert.equal(validateEmbeddingVector(res1.vectors[0]).ok, true);
  assert.equal(validateEmbeddingVector(res1.vectors[1]).ok, true);

  // 2. Second embed call with same texts: both cached
  const res2 = await provider.embed(['第一段文本', '第二段文本']);
  assert.equal(res2.vectors.length, 2);
  assert.equal(res2.usage.total, 2);
  assert.equal(res2.usage.computed, 0);
  assert.equal(res2.usage.cached, 2);
  assert.equal(computeCallCount, 2, 'Extractor must not be called on cache hit');
  assert.deepEqual(res2.vectors, res1.vectors);

  // 3. Mixed call: one cached, one fresh
  const res3 = await provider.embed(['第一段文本', '第三段崭新的文本']);
  assert.equal(res3.vectors.length, 2);
  assert.equal(res3.usage.total, 2);
  assert.equal(res3.usage.computed, 1);
  assert.equal(res3.usage.cached, 1);
  assert.equal(computeCallCount, 3);
  assert.deepEqual(res3.vectors[0], res1.vectors[0]);
});

test('P1-T10: Fail-closed behavior on invalid input and extractor errors', async () => {
  const mockExtractor = async () => mockVector768(1);
  const provider = createEmbeddingProvider({ extractorEngine: mockExtractor });

  // Non-array input
  await assert.rejects(
    () => provider.embed('not-an-array'),
    (err) => err.code === EMBEDDING_ERROR_INVALID_INPUT
  );

  // Non-string element
  await assert.rejects(
    () => provider.embed(['valid text', 12345]),
    (err) => err.code === EMBEDDING_ERROR_INVALID_INPUT
  );

  // Extractor throwing error
  const throwingExtractor = async () => {
    throw new Error('Native ONNX runtime fault');
  };
  const failingProvider = createEmbeddingProvider({ extractorEngine: throwingExtractor });
  await assert.rejects(
    () => failingProvider.embed(['测试文本']),
    (err) => err.code === EMBEDDING_ERROR_DENSE_UNAVAILABLE
  );

  // Extractor returning malformed vector
  const malformedExtractor = async () => [1, 2, 3]; // only 3 elements
  const malformedProvider = createEmbeddingProvider({ extractorEngine: malformedExtractor });
  await assert.rejects(
    () => malformedProvider.embed(['测试文本']),
    (err) => err.code === EMBEDDING_ERROR_VECTOR_INVALID
  );
});
