// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/embedding-cache.mjs
 *
 * P1-T10 — Deterministic Embedding Cache.
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §5.3, §10; Issue #42.)
 *
 * Cache Identity Contract:
 *   cacheKey = sha256(canonicalInputHash + ":" + providerId + ":" + modelId + ":" + modelRevision + ":" + embeddingVersion + ":" + inputNormalizationVersion + ":" + outputNormalizationVersion)
 *
 * Security & Privacy Invariants:
 *   - Cache key MUST NOT contain credentials, secrets, access tokens, local absolute paths,
 *     usernames, machine-private directories, unstable timestamps, or process IDs.
 *   - Cache key is a deterministic 64-character lowercase hex sha256.
 *   - Cache reuse is exact-match only; any profile, revision, or normalization change
 *     yields a distinct cache key (automatic cache invalidation).
 *   - Corrupted or invalid cache entries FAIL CLOSED.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Error codes */
export const CACHE_ERROR_INVALID_KEY = 'cache_invalid_key';
export const CACHE_ERROR_CORRUPTED_ENTRY = 'cache_corrupted_entry';
export const CACHE_ERROR_PERSISTENCE_FAILED = 'cache_persistence_failed';

/**
 * Single source of truth for the L2_UNIT_NORM tolerance shared by the cache
 * and the provider (previously drifted: cache 1e-4 vs provider 1e-3).
 * The stricter value is fail-closed and is satisfied by any vector produced
 * via l2Normalize (float error ~1e-12).
 */
export const EMBEDDING_L2_UNIT_NORM_TOLERANCE = 1e-4;

/** Cache keys are deterministic 64-char lowercase hex sha256 digests. */
const CACHE_KEY_FORMAT = /^[0-9a-f]{64}$/;

/** Frozen input normalization version accepted by the T01 profile. */
export const INPUT_NORMALIZATION_VERSION = 'T01_INPUT_NORM_V1';

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * Validates that an embedding vector conforms strictly to the accepted profile:
 * an array of exactly `expectedDimension` finite numbers whose L2 norm is a
 * unit norm within EMBEDDING_L2_UNIT_NORM_TOLERANCE.
 * Fails closed if malformed, empty, NaN, Infinity, wrong dimension, or non-numeric.
 *
 * Canonical home: this module (the cache guards entry integrity with it and the
 * provider delegates to it; provider -> cache is the existing import direction).
 */
export function validateEmbeddingVector(vector, { expectedDimension = 768, allowTolerance = EMBEDDING_L2_UNIT_NORM_TOLERANCE } = {}) {
  if (!Array.isArray(vector)) {
    return { ok: false, reason: 'vector_not_array', error: 'Vector must be an array' };
  }

  if (vector.length !== expectedDimension) {
    return {
      ok: false,
      reason: 'dimension_mismatch',
      error: `Expected dimension ${expectedDimension}, got ${vector.length}`,
    };
  }

  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const val = vector[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
      return {
        ok: false,
        reason: 'non_finite_element',
        error: `Element at index ${i} is not a finite number: ${val}`,
      };
    }
    sumSquares += val * val;
  }

  const norm = Math.sqrt(sumSquares);
  // If vector is all zeros
  if (norm < 1e-6) {
    return { ok: false, reason: 'zero_magnitude_vector', error: 'Vector has near-zero magnitude' };
  }

  // T10-F6: Actually enforce unit norm tolerance
  if (Math.abs(norm - 1.0) > allowTolerance) {
    return { ok: false, reason: 'norm_out_of_tolerance', error: `Vector norm ${norm} deviates from 1.0 by more than ${allowTolerance}` };
  }

  return { ok: true, norm, dimension: vector.length };
}

/**
 * Normalizes input text for hashing per input normalization version.
 *
 * T01_INPUT_NORM_V1 is the only normalization version accepted by the T01
 * profile (identity semantics — hash the exact effective model input; do not
 * invent NFKC + trim unless explicitly in the T01 contract). Unknown versions
 * FAIL CLOSED instead of silently hashing with different semantics.
 */
export function normalizeInputForHashing(text, normalizationVersion = INPUT_NORMALIZATION_VERSION) {
  if (typeof text !== 'string') {
    throw new Error('Input text must be a string');
  }
  if (normalizationVersion !== INPUT_NORMALIZATION_VERSION) {
    const err = new Error(`Unsupported input normalization version: ${normalizationVersion} (accepted: ${INPUT_NORMALIZATION_VERSION})`);
    err.code = CACHE_ERROR_INVALID_KEY;
    throw err;
  }
  return text;
}

/**
 * Computes deterministic 64-char hex cache key.
 */
export function computeEmbeddingCacheKey({
  text,
  providerId,
  modelId,
  modelRevision,
  embeddingVersion = 'v1',
  inputNormalizationVersion = 'T01_INPUT_NORM_V1',
  outputNormalizationVersion = 'L2_UNIT_NORM',
} = {}) {
  if (typeof text !== 'string') {
    const err = new Error('text must be a string');
    err.code = CACHE_ERROR_INVALID_KEY;
    throw err;
  }
  if (!providerId || !modelId || !modelRevision) {
    const err = new Error('providerId, modelId, and modelRevision are required');
    err.code = CACHE_ERROR_INVALID_KEY;
    throw err;
  }

  const normalizedInput = normalizeInputForHashing(text, inputNormalizationVersion);
  const inputHash = sha256(normalizedInput);

  const profileComposite = [
    providerId,
    modelId,
    modelRevision,
    embeddingVersion,
    inputNormalizationVersion,
    outputNormalizationVersion,
  ].join(':');

  return sha256(`${inputHash}:${profileComposite}`);
}

/**
 * Deterministic flat-file / in-memory embedding cache.
 */
export class EmbeddingCache {
  constructor({ cacheDir = null, inMemoryOnly = false, maxMemoryEntries = 5000 } = {}) {
    this.cacheDir = cacheDir;
    this.inMemoryOnly = inMemoryOnly || !cacheDir;
    this.maxMemoryEntries = maxMemoryEntries;
    this.memoryStore = new Map();

    if (!this.inMemoryOnly && this.cacheDir) {
      try {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      } catch (e) {
        const err = new Error(`Cannot initialize cache directory at [LOCAL_CACHE_DIR]`);
        err.code = CACHE_ERROR_PERSISTENCE_FAILED;
        throw err;
      }
    }
  }

  _filePathForKey(key) {
    if (!this.cacheDir || typeof key !== 'string' || !CACHE_KEY_FORMAT.test(key)) {
      return null;
    }
    // Prefix partitioning to avoid single-directory saturation
    const prefix = key.slice(0, 2);
    const subDir = path.join(this.cacheDir, prefix);
    return path.join(subDir, `${key}.json`);
  }

  get(key) {
    if (typeof key !== 'string' || !CACHE_KEY_FORMAT.test(key)) {
      return null;
    }

    // 1. Check memory store
    if (this.memoryStore.has(key)) {
      return [...this.memoryStore.get(key)];
    }

    // 2. Check disk store
    if (!this.inMemoryOnly && this.cacheDir) {
      const filePath = this._filePathForKey(key);
      if (filePath && fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          // Key must match exactly — reject mismatched file content
          if (parsed?.key !== key) return null;
          // Entry integrity: full vector contract (768 / finite / L2 unit norm)
          const check = validateEmbeddingVector(parsed.vector);
          if (check.ok) {
            if (this.memoryStore.size < this.maxMemoryEntries) {
              this.memoryStore.set(key, [...parsed.vector]);
            }
            return [...parsed.vector];
          }
          return null;
        } catch {
          // Corrupted file -> return null (cache miss)
          return null;
        }
      }
    }

    return null;
  }

  set(key, vector, metadata = {}) {
    if (typeof key !== 'string' || !CACHE_KEY_FORMAT.test(key)) {
      const err = new Error(`Invalid cache key: ${key}`);
      err.code = CACHE_ERROR_INVALID_KEY;
      throw err;
    }

    // Entry integrity: full vector contract (768 / finite / L2 unit norm)
    const check = validateEmbeddingVector(vector);
    if (!check.ok) {
      const err = new Error(`Invalid vector to cache: ${check.error}`);
      err.code = CACHE_ERROR_CORRUPTED_ENTRY;
      throw err;
    }

    // Persist to disk FIRST — only promote to memory after successful disk write
    if (!this.inMemoryOnly && this.cacheDir) {
      const filePath = this._filePathForKey(key);
      if (filePath) {
        try {
          const subDir = path.dirname(filePath);
          fs.mkdirSync(subDir, { recursive: true });
          const payload = {
            key,
            vector,
            dimension: vector.length,
            cachedAt: new Date().toISOString(),
            ...(metadata && typeof metadata === 'object' ? metadata : {}),
          };
          fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
        } catch {
          // Redact absolute paths — expose only stable error code
          const err = new Error(`Failed to persist cache entry at [LOCAL_CACHE_DIR]`);
          err.code = CACHE_ERROR_PERSISTENCE_FAILED;
          throw err;
        }
      }
    }

    // Add to memory only after successful persistence (or if memory-only mode)
    if (this.memoryStore.size < this.maxMemoryEntries) {
      this.memoryStore.set(key, [...vector]);
    }
  }

  has(key) {
    return this.get(key) !== null;
  }

  clearMemory() {
    this.memoryStore.clear();
  }
}
