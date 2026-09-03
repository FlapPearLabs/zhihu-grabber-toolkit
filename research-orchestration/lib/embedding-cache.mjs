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

import { isBoundarySafeString } from './rrf.mjs';

/** Error codes */
export const CACHE_ERROR_INVALID_KEY = 'cache_invalid_key';
export const CACHE_ERROR_CORRUPTED_ENTRY = 'cache_corrupted_entry';
export const CACHE_ERROR_PERSISTENCE_FAILED = 'cache_persistence_failed';

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * Normalizes input text for hashing per input normalization version.
 */
export function normalizeInputForHashing(text, normalizationVersion = 'T01_INPUT_NORM_V1') {
  if (typeof text !== 'string') {
    throw new Error('Input text must be a string');
  }
  if (normalizationVersion === 'T01_INPUT_NORM_V1') {
    // T10-F2: Cache identity must hash the exact effective model input semantics.
    // Do not invent NFKC + trim unless explicitly in T01 contract.
    return text;
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
    if (!this.cacheDir || typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) {
      return null;
    }
    // Prefix partitioning to avoid single-directory saturation
    const prefix = key.slice(0, 2);
    const subDir = path.join(this.cacheDir, prefix);
    return path.join(subDir, `${key}.json`);
  }

  get(key) {
    if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) {
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
          if (Array.isArray(parsed?.vector) && parsed.vector.length === 768) {
            // Verify all elements are finite numbers
            const allNumbers = parsed.vector.every((x) => typeof x === 'number' && Number.isFinite(x));
            if (allNumbers) {
              // Validate L2 unit norm (same contract as set())
              const norm = Math.sqrt(parsed.vector.reduce((sum, v) => sum + v * v, 0));
              if (Math.abs(norm - 1.0) > 1e-4) return null;
              if (this.memoryStore.size < this.maxMemoryEntries) {
                this.memoryStore.set(key, [...parsed.vector]);
              }
              return [...parsed.vector];
            }
          }
        } catch {
          // Corrupted file -> return null (cache miss)
          return null;
        }
      }
    }

    return null;
  }

  set(key, vector, metadata = {}) {
    if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) {
      const err = new Error(`Invalid cache key: ${key}`);
      err.code = CACHE_ERROR_INVALID_KEY;
      throw err;
    }

    if (!Array.isArray(vector) || vector.length !== 768) {
      const err = new Error(`Invalid vector to cache (expected 768 numbers, got ${vector?.length})`);
      err.code = CACHE_ERROR_CORRUPTED_ENTRY;
      throw err;
    }

    // Check all elements are finite numbers before doing math
    if (!vector.every(v => typeof v === 'number' && Number.isFinite(v))) {
      const err = new Error(`Invalid vector to cache (contains non-finite or non-numeric elements)`);
      err.code = CACHE_ERROR_CORRUPTED_ENTRY;
      throw err;
    }

    // Check L2 norm (magnitude must be 1.0)
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (Math.abs(norm - 1.0) > 1e-4) {
      const err = new Error(`Cached vectors must satisfy L2_UNIT_NORM (magnitude = ${norm})`);
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
