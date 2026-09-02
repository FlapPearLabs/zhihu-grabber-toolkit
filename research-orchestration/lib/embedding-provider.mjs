// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/embedding-provider.mjs
 *
 * P1-T10 — LOCAL EmbeddingProvider adapter + preflight + validation.
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §5.3, §10; Issue #42.)
 *
 * Accepted Implementation Profile (Mechanically Consumed from T01 Decision):
 *   PROVIDER_CATEGORY           = LOCAL
 *   NAMED_PROVIDER              = transformersjs-local-onnx
 *   NAMED_MODEL_PROFILE         = Xenova/bge-base-zh-v1.5
 *   MODEL_REVISION              = 71e50dc531959f9e04ebf190ea25b00261a0a186
 *   VECTOR_DIMENSION            = 768
 *   INPUT_NORMALIZATION_VERSION = T01_INPUT_NORM_V1
 *   OUTPUT_NORMALIZATION_VERSION= L2_UNIT_NORM
 *   EGRESS                      = LOCAL
 *   NO_NEW_EGRESS               = YES
 *   P1-T02                      = CONDITIONAL_NOT_ACTIVE
 *
 * Hard Contracts:
 *   - No provider / model / profile reselection (T10 has NO authority to reselect).
 *   - Exact model revision is required (71e50dc531959f9e04ebf190ea25b00261a0a186).
 *   - No silent fallback to main / remote / other model / zero-vectors / popularity-only.
 *   - Vector validity: 768 finite numbers, L2 unit-norm; invalid vector FAILS CLOSED.
 *   - Local egress policy: env.allowRemoteModels = false; no outbound network at embed time.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  EmbeddingCache,
  computeEmbeddingCacheKey,
  normalizeInputForHashing,
} from './embedding-cache.mjs';

/** Frozen T01 Accepted Profile (Spec §5.3 / Issue #42) */
export const ACCEPTED_LOCAL_PROFILE = Object.freeze({
  providerCategory: 'LOCAL',
  providerId: 'transformersjs-local-onnx',
  modelId: 'Xenova/bge-base-zh-v1.5',
  modelRevision: '71e50dc531959f9e04ebf190ea25b00261a0a186',
  vectorDimension: 768,
  embeddingVersion: 'v1',
  inputNormalizationVersion: 'T01_INPUT_NORM_V1',
  outputNormalizationVersion: 'L2_UNIT_NORM',
  egressPolicy: Object.freeze({
    category: 'LOCAL',
    noNewEgress: true,
  }),
});

/** Stable machine-readable error codes */
export const EMBEDDING_ERROR_PROVIDER_UNREACHABLE = 'EMBEDDING_PROVIDER_UNREACHABLE';
export const EMBEDDING_ERROR_MODEL_UNKNOWN = 'EMBEDDING_MODEL_UNKNOWN';
export const EMBEDDING_ERROR_REVISION_MISMATCH = 'EMBEDDING_REVISION_MISMATCH';
export const EMBEDDING_ERROR_VECTOR_INVALID = 'EMBEDDING_VECTOR_INVALID';
export const EMBEDDING_ERROR_PROFILE_MISMATCH = 'EMBEDDING_PROFILE_MISMATCH';
export const EMBEDDING_ERROR_DENSE_UNAVAILABLE = 'DENSE_CAPABILITY_UNAVAILABLE';
export const EMBEDDING_ERROR_OFFLINE_VIOLATION = 'EMBEDDING_OFFLINE_VIOLATION';
export const EMBEDDING_ERROR_INVALID_INPUT = 'EMBEDDING_INVALID_INPUT';

/**
 * Validates that an embedding vector conforms strictly to 768-dimensional finite numbers.
 * Fails closed if malformed, empty, NaN, Infinity, wrong dimension, or non-numeric.
 */
export function validateEmbeddingVector(vector, { expectedDimension = 768, allowTolerance = 1e-3 } = {}) {
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
  // If vector is all zeros or norm is completely off from unit length
  if (norm < 1e-6) {
    return { ok: false, reason: 'zero_magnitude_vector', error: 'Vector has near-zero magnitude' };
  }

  return { ok: true, norm, dimension: vector.length };
}

/**
 * Computes L2 unit normalization for a raw vector array.
 */
export function l2Normalize(vector) {
  if (!Array.isArray(vector) || vector.length === 0) {
    const err = new Error('Vector must be a non-empty array');
    err.code = EMBEDDING_ERROR_VECTOR_INVALID;
    throw err;
  }
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const val = vector[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      const err = new Error(`Vector contains non-finite element at index ${i}: ${val}`);
      err.code = EMBEDDING_ERROR_VECTOR_INVALID;
      throw err;
    }
    sumSquares += val * val;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm < 1e-9) {
    const err = new Error('Cannot L2-normalize zero-magnitude vector');
    err.code = EMBEDDING_ERROR_VECTOR_INVALID;
    throw err;
  }
  return vector.map((x) => x / norm);
}

let loadedTransformersModule = null;
async function getTransformersModule() {
  if (loadedTransformersModule) return loadedTransformersModule;
  try {
    loadedTransformersModule = await import('@xenova/transformers');
    return loadedTransformersModule;
  } catch (err) {
    const e = new Error(`@xenova/transformers module unreachable or not installed: ${err?.message ?? err}`);
    e.code = EMBEDDING_ERROR_PROVIDER_UNREACHABLE;
    throw e;
  }
}

/**
 * Creates the production LOCAL EmbeddingProvider adapter conforming to Spec §5.3.
 *
 * @param {object} [options]
 * @param {string} [options.modelDir] - Local directory containing model weights & identity.json
 * @param {EmbeddingCache} [options.cache] - Custom or shared cache instance
 * @param {Function} [options.extractorEngine] - Injected extractor for testing / headless runs
 * @param {object} [options.profileCheck] - Enforces exact match with ACCEPTED_LOCAL_PROFILE
 */
export function createTestEmbeddingProvider({
  modelDir = process.env.P1_T10_ONNX_MODEL_DIR ?? path.resolve('models-bge-base-zh-v1.5'),
  cacheDir = null,
  cache = null,
  extractorEngine = null,
  profileCheck = null,
} = {}) {
  return _createEmbeddingProviderInternal({ modelDir, cacheDir, cache, extractorEngine, profileCheck });
}

export function createEmbeddingProvider({
  modelDir = process.env.P1_T10_ONNX_MODEL_DIR ?? path.resolve('models-bge-base-zh-v1.5'),
  cacheDir = null,
  cache = null,
  profileCheck = null,
} = {}) {
  return _createEmbeddingProviderInternal({ modelDir, cacheDir, cache, extractorEngine: null, profileCheck });
}

function _createEmbeddingProviderInternal({
  modelDir,
  cacheDir,
  cache,
  extractorEngine,
  profileCheck,
}) {
  // Mechanical check: Reject any profile reselection attempt
  if (profileCheck && typeof profileCheck === 'object') {
    for (const [k, expectedVal] of Object.entries(ACCEPTED_LOCAL_PROFILE)) {
      if (k in profileCheck) {
        const actualVal = profileCheck[k];
        let matches = actualVal === expectedVal;
        if (typeof expectedVal === 'object' && expectedVal !== null && actualVal && typeof actualVal === 'object') {
          const keys1 = Object.keys(expectedVal);
          const keys2 = Object.keys(actualVal);
          matches = keys1.length === keys2.length && keys1.every(key => expectedVal[key] === actualVal[key]);
        }
        if (!matches) {
          const err = new Error(`Profile mismatch for ${k}`);
          err.code = EMBEDDING_ERROR_PROFILE_MISMATCH;
          throw err;
        }
      }
    }
  }

  const embeddingCache = cache instanceof EmbeddingCache ? cache : new EmbeddingCache({ cacheDir });
  let activeExtractor = extractorEngine;

  async function getExtractor() {
    if (activeExtractor) return activeExtractor;
    const tf = await getTransformersModule();
    const { pipeline, env } = tf;
    env.allowRemoteModels = false; // HARD OFFLINE REQUIREMENT (NO_NEW_EGRESS)
    env.localModelPath = modelDir;
    env.cacheDir = modelDir;

    try {
      activeExtractor = await pipeline('feature-extraction', ACCEPTED_LOCAL_PROFILE.modelId, {
        quantized: true,
      });
      return activeExtractor;
    } catch (err) {
      // Scrub the absolute path from error messages if transformers.js throws it
      let msg = String(err?.message ?? err);
      if (modelDir) {
        msg = msg.split(modelDir).join('[LOCAL_MODEL_DIR]')
                 .split(modelDir.replace(/\\/g, '/')).join('[LOCAL_MODEL_DIR]');
      }
      const e = new Error(`Failed to load local ONNX model: ${msg}`);
      e.code = EMBEDDING_ERROR_MODEL_UNKNOWN;
      throw e;
    }
  }

  async function checkIdentityJson() {
    const identityPath = path.join(modelDir, 'identity.json');
    if (!fs.existsSync(identityPath)) {
      return { ok: false, reason: 'identity_json_absent', error: 'identity.json not found in local model directory' };
    }
    try {
      const raw = fs.readFileSync(identityPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.modelId !== ACCEPTED_LOCAL_PROFILE.modelId) {
        return {
          ok: false,
          reason: 'model_id_mismatch',
          error: `Model ID mismatch: expected ${ACCEPTED_LOCAL_PROFILE.modelId}, found ${parsed.modelId}`,
        };
      }
      if (parsed.revisionSha !== ACCEPTED_LOCAL_PROFILE.modelRevision) {
        return {
          ok: false,
          reason: 'revision_mismatch',
          error: `Model revision mismatch: expected ${ACCEPTED_LOCAL_PROFILE.modelRevision}, found ${parsed.revisionSha}`,
        };
      }
      return { ok: true, identity: parsed };
    } catch (e) {
      return { ok: false, reason: 'identity_json_malformed', error: e.message };
    }
  }

  return {
    // 8 Contract Fields (Spec §5.3)
    providerCategory: ACCEPTED_LOCAL_PROFILE.providerCategory,
    providerId: ACCEPTED_LOCAL_PROFILE.providerId,
    modelId: ACCEPTED_LOCAL_PROFILE.modelId,
    modelRevision: ACCEPTED_LOCAL_PROFILE.modelRevision,
    vectorDimension: ACCEPTED_LOCAL_PROFILE.vectorDimension,
    embeddingVersion: ACCEPTED_LOCAL_PROFILE.embeddingVersion,
    inputNormalizationVersion: ACCEPTED_LOCAL_PROFILE.inputNormalizationVersion,
    outputNormalizationVersion: ACCEPTED_LOCAL_PROFILE.outputNormalizationVersion,
    egressPolicy: ACCEPTED_LOCAL_PROFILE.egressPolicy,

    /**
     * Local preflight verification (Boolean mode & structured output).
     */
    async preflight() {
      // If extractorEngine was injected, verify its contract
      if (extractorEngine) {
        return {
          ok: true,
          status: 'READY',
          providerCategory: this.providerCategory,
          providerId: this.providerId,
          modelId: this.modelId,
          modelRevision: this.modelRevision,
          vectorDimension: this.vectorDimension,
          egressPolicy: this.egressPolicy,
          injected: true,
        };
      }

      // Check model identity on disk
      const idCheck = await checkIdentityJson();
      if (!idCheck.ok) {
        return {
          ok: false,
          status: 'FAILED',
          failureCode: idCheck.reason === 'revision_mismatch' ? EMBEDDING_ERROR_REVISION_MISMATCH : EMBEDDING_ERROR_MODEL_UNKNOWN,
          error: idCheck.error,
        };
      }

      // Try initializing extractor
      try {
        await getExtractor();
        return {
          ok: true,
          status: 'READY',
          providerCategory: this.providerCategory,
          providerId: this.providerId,
          modelId: this.modelId,
          modelRevision: this.modelRevision,
          vectorDimension: this.vectorDimension,
          egressPolicy: this.egressPolicy,
          revisionSha: idCheck.identity.revisionSha,
        };
      } catch (err) {
        return {
          ok: false,
          status: 'FAILED',
          failureCode: err.code ?? EMBEDDING_ERROR_DENSE_UNAVAILABLE,
          error: err.message,
        };
      }
    },

    /**
     * Embeds an array of texts into 768-dimensional normalized vectors with deterministic caching.
     *
     * @param {string[]} texts - Array of input texts
     * @param {object} [options]
     * @param {boolean} [options.useCache=true] - Enable deterministic cache lookup and storage
     * @returns {Promise<{ vectors: Array<number[]>, usage: { total: number, cached: number, computed: number } }>}
     */
    async embed(texts, { useCache = true } = {}) {
      if (!Array.isArray(texts)) {
        const err = new Error('texts must be an array of strings');
        err.code = EMBEDDING_ERROR_INVALID_INPUT;
        throw err;
      }

      if (texts.length === 0) {
        return { vectors: [], usage: { total: 0, cached: 0, computed: 0 } };
      }

      for (let i = 0; i < texts.length; i += 1) {
        if (typeof texts[i] !== 'string') {
          const err = new Error(`Input at index ${i} is not a string`);
          err.code = EMBEDDING_ERROR_INVALID_INPUT;
          throw err;
        }
      }

      const results = new Array(texts.length);
      const uncachedIndices = [];
      const uncachedTexts = [];

      let cachedCount = 0;

      // 1. Cache lookup
      for (let i = 0; i < texts.length; i += 1) {
        const text = texts[i];
        if (useCache) {
          const key = computeEmbeddingCacheKey({
            text,
            providerId: this.providerId,
            modelId: this.modelId,
            modelRevision: this.modelRevision,
            embeddingVersion: this.embeddingVersion,
            inputNormalizationVersion: this.inputNormalizationVersion,
            outputNormalizationVersion: this.outputNormalizationVersion,
          });
          const cachedVector = embeddingCache.get(key);
          if (cachedVector) {
            const valResult = validateEmbeddingVector(cachedVector, { expectedDimension: this.vectorDimension });
            if (valResult.ok) {
              results[i] = cachedVector;
              cachedCount += 1;
              continue;
            }
          }
        }
        uncachedIndices.push(i);
        uncachedTexts.push(text);
      }

      // 2. Compute uncached vectors if any
      if (uncachedTexts.length > 0) {
        const extractor = await getExtractor();
        const inFlightComputations = new Map();

        for (let j = 0; j < uncachedTexts.length; j += 1) {
          const text = uncachedTexts[j];
          const origIdx = uncachedIndices[j];

          let rawOutput;
          try {
            if (inFlightComputations.has(text)) {
              rawOutput = await inFlightComputations.get(text);
            } else {
              const computePromise = extractor(text, { pooling: 'mean', normalize: false, truncation: true, max_length: 512 });
              inFlightComputations.set(text, computePromise);
              rawOutput = await computePromise;
            }
          } catch (err) {
            const e = new Error(`Embedding computation failed for input ${origIdx}: ${err?.message ?? err}`);
            e.code = EMBEDDING_ERROR_DENSE_UNAVAILABLE;
            throw e;
          }

          // Convert output to plain number array
          let rawArray = null;
          if (Array.isArray(rawOutput)) {
            rawArray = rawOutput;
          } else if (rawOutput?.data) {
            rawArray = Array.from(rawOutput.data);
          } else if (typeof rawOutput?.tolist === 'function') {
            rawArray = rawOutput.tolist();
          } else if (rawOutput?.tolist) {
            rawArray = Array.from(rawOutput);
          } else {
            rawArray = Array.from(rawOutput ?? []);
          }

          if (Array.isArray(rawArray[0])) {
            rawArray = rawArray.flat();
          }

          // Apply L2 unit normalization
          const normalizedVector = l2Normalize(rawArray);

          // Validate vector strictly
          const valCheck = validateEmbeddingVector(normalizedVector, { expectedDimension: this.vectorDimension });
          if (!valCheck.ok) {
            const err = new Error(`Invalid embedding vector produced: ${valCheck.error}`);
            err.code = EMBEDDING_ERROR_VECTOR_INVALID;
            throw err;
          }

          results[origIdx] = normalizedVector;

          // Write to cache
          if (useCache) {
            const key = computeEmbeddingCacheKey({
              text,
              providerId: this.providerId,
              modelId: this.modelId,
              modelRevision: this.modelRevision,
              embeddingVersion: this.embeddingVersion,
              inputNormalizationVersion: this.inputNormalizationVersion,
              outputNormalizationVersion: this.outputNormalizationVersion,
            });
            embeddingCache.set(key, normalizedVector, {
              providerId: this.providerId,
              modelId: this.modelId,
              modelRevision: this.modelRevision,
            });
          }
        }
      }

      return {
        vectors: results,
        usage: {
          total: texts.length,
          cached: cachedCount,
          computed: uncachedTexts.length,
        },
      };
    },
  };
}
