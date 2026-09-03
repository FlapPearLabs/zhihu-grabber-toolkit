// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/embedding-cache.test.mjs
 *
 * P1-T10 focused tests — Deterministic Embedding Cache (Issue #42, Spec §5.3, §10).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EmbeddingCache,
  computeEmbeddingCacheKey,
  normalizeInputForHashing,
  CACHE_ERROR_INVALID_KEY,
  CACHE_ERROR_CORRUPTED_ENTRY,
} from '../lib/embedding-cache.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `embed-cache-${prefix}-`));
}

test('P1-T10: computeEmbeddingCacheKey determinism and privacy invariants', () => {
  const profile = {
    providerId: 'transformersjs-local-onnx',
    modelId: 'Xenova/bge-base-zh-v1.5',
    modelRevision: '71e50dc531959f9e04ebf190ea25b00261a0a186',
    embeddingVersion: 'v1',
    inputNormalizationVersion: 'T01_INPUT_NORM_V1',
    outputNormalizationVersion: 'L2_UNIT_NORM',
  };

  const key1 = computeEmbeddingCacheKey({ text: '这是一段测试文本', ...profile });
  const key2 = computeEmbeddingCacheKey({ text: '这是一段测试文本', ...profile });

  // 1. Key must be exact 64-char lowercase hex
  assert.match(key1, /^[0-9a-f]{64}$/);
  assert.equal(key1, key2, 'Same input and profile must yield exact same cache key');

  // 2. Cache identity preserves raw text distinctions (T10-F2: no invented NFKC / trim)
  const keyTrimmed = computeEmbeddingCacheKey({ text: '  这是一段测试文本  ', ...profile });
  assert.notEqual(key1, keyTrimmed, 'Distinct raw texts must not collide in cache key');

  // 3. Different text -> different key
  const keyDiffText = computeEmbeddingCacheKey({ text: '另一段完全不同的文本', ...profile });
  assert.notEqual(key1, keyDiffText);

  // 4. Model revision change -> distinct key (automatic invalidation)
  const keyDiffRevision = computeEmbeddingCacheKey({
    text: '这是一段测试文本',
    ...profile,
    modelRevision: '0000000000000000000000000000000000000000',
  });
  assert.notEqual(key1, keyDiffRevision);

  // 5. Normalization version change -> distinct key
  const keyDiffNorm = computeEmbeddingCacheKey({
    text: '这是一段测试文本',
    ...profile,
    outputNormalizationVersion: 'NONE',
  });
  assert.notEqual(key1, keyDiffNorm);

  // 6. Must not contain credentials or paths
  assert.equal(key1.includes('/'), false);
  assert.equal(key1.includes('\\'), false);
  assert.equal(key1.includes('token'), false);
});

test('P1-T10: EmbeddingCache in-memory operations', () => {
  const cache = new EmbeddingCache({ inMemoryOnly: true });
  const key = 'a'.repeat(64);
  const vec = mockVector768(1);

  assert.equal(cache.has(key), false);
  assert.equal(cache.get(key), null);

  cache.set(key, vec);
  assert.equal(cache.has(key), true);
  const retrieved = cache.get(key);
  assert.deepEqual(retrieved, vec);

  // Malformed key throws
  assert.throws(() => cache.set('bad-key', vec), (err) => err.code === CACHE_ERROR_INVALID_KEY);

  // Wrong dimension vector throws
  assert.throws(() => cache.set(key, [1, 2, 3]), (err) => err.code === CACHE_ERROR_CORRUPTED_ENTRY);
});

test('P1-T10: EmbeddingCache disk persistence and reload', () => {
  const dir = tmpDir('disk');
  const cache1 = new EmbeddingCache({ cacheDir: dir });
  const key = 'b'.repeat(64);
  const vec = mockVector768(2);

  cache1.set(key, vec);
  assert.equal(cache1.has(key), true);

  // Read back from a fresh cache instance on the same directory
  const cache2 = new EmbeddingCache({ cacheDir: dir });
  assert.equal(cache2.has(key), true);
  const retrieved = cache2.get(key);
  assert.deepEqual(retrieved, vec);
});

test('P1-T10: Corrupted cache file is gracefully handled as cache miss', () => {
  const dir = tmpDir('corrupt');
  const cache = new EmbeddingCache({ cacheDir: dir });
  const key = 'c'.repeat(64);

  // Write corrupted content to the disk location
  const prefix = key.slice(0, 2);
  const subDir = path.join(dir, prefix);
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, `${key}.json`), '{ "vector": [1, 2, "not_enough_numbers"] }', 'utf8');

  // Should return null (cache miss) rather than crashing
  assert.equal(cache.get(key), null);
});

test('P1-T10: Cache rejects vectors not satisfying L2_UNIT_NORM', () => {
  const cache = new EmbeddingCache({ inMemoryOnly: true });
  const badVector = new Array(768).fill(1.0); // magnitude = sqrt(768) != 1.0
  const key = 'a'.repeat(64);
  assert.throws(() => cache.set(key, badVector), (err) => err.code === 'cache_corrupted_entry');
});

test('P1-T10: Cache fallback to memory on persistence failure throws', () => {
  // Pass a file path where a directory is expected, so mkdirSync throws
  assert.throws(() => {
    new EmbeddingCache({ cacheDir: '?\0invalid/path*' });
  }, (err) => err.code === 'cache_persistence_failed');
});
