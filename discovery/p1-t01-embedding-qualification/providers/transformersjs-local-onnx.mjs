/**
 * DISCOVERY-ONLY (P1-T01 / Issue #33) — LOCAL candidate provider adapter probe.
 * Not production code. Not imported by any production package.
 *
 * Candidate profile under test:
 *   PROVIDER_CATEGORY = LOCAL
 *   NAMED_PROVIDER    = transformersjs-local-onnx (in-process ONNX Runtime, Node)
 *   NAMED_MODEL       = Xenova/bge-small-zh-v1.5 (quantized ONNX)
 *
 * HARD OFFLINE CONSTRAINT
 * -----------------------
 * This adapter is configured with `env.allowRemoteModels = false`, so after
 * `fetch-model.mjs` has populated the local model directory it performs NO network
 * I/O. That is what makes AC_11 (black-hole proxy run) meaningful evidence rather
 * than an assertion.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL_DIR = resolve(HERE, '..', 'models');

let transformersModule = null;
async function loadTransformers() {
  if (transformersModule) return transformersModule;
  // Loaded lazily so that a missing optional dependency produces a clean
  // machine-readable failure instead of an import-time crash.
  transformersModule = await import('@xenova/transformers');
  return transformersModule;
}

export function createProvider({
  model = process.env.P1_T01_ONNX_MODEL ?? 'Xenova/bge-small-zh-v1.5',
  modelDir = process.env.P1_T01_ONNX_MODEL_DIR ?? DEFAULT_MODEL_DIR,
  quantization = 'quantized',
} = {}) {
  let extractor = null;
  let identity = null;

  async function readIdentity() {
    if (identity !== null) return identity;
    try {
      identity = JSON.parse(await readFile(join(modelDir, 'identity.json'), 'utf8'));
    } catch {
      identity = { modelId: model, revisionSha: null, files: [], note: 'identity.json absent; run fetch-model.mjs' };
    }
    return identity;
  }

  return {
    id: `transformersjs-local-${model.replace(/[^A-Za-z0-9._-]+/g, '-')}`,
    providerCategory: 'LOCAL',
    providerId: 'transformersjs-local-onnx',
    providerVersionId: 'onnxruntime-node-inprocess',
    modelId: model,
    transport: 'inprocess-onnx',
    requiresCredential: false,

    describe() {
      return {
        id: this.id,
        providerCategory: this.providerCategory,
        providerId: this.providerId,
        providerVersionId: this.providerVersionId,
        modelId: this.modelId,
        transport: this.transport,
        requiresCredential: this.requiresCredential,
        quantization,
      };
    },

    async health() {
      await this.init();
      const id = await readIdentity();
      return { ok: true, models: [this.modelId], modelPresent: true, revisionSha: id.revisionSha ?? null };
    },

    async init() {
      if (extractor) return extractor;
      let tf;
      try {
        tf = await loadTransformers();
      } catch (err) {
        const e = new Error(`optional dependency @xenova/transformers not installed: ${err?.message ?? err}`);
        e.failureCode = 'EMBEDDING_PROVIDER_UNREACHABLE';
        throw e;
      }
      const { pipeline, env } = tf;
      env.allowRemoteModels = false; // hard offline constraint for the battery
      env.localModelPath = modelDir;
      env.cacheDir = modelDir;
      try {
        extractor = await pipeline('feature-extraction', model, { quantized: quantization === 'quantized' });
      } catch (err) {
        const e = new Error(`local ONNX model load failed: ${err?.message ?? err}`);
        e.failureCode = 'EMBEDDING_MODEL_UNKNOWN';
        throw e;
      }
      return extractor;
    },

    async embed(texts) {
      if (!Array.isArray(texts)) {
        const e = new Error('embed() requires an array of strings');
        e.failureCode = 'EMBEDDING_INPUT_INVALID';
        throw e;
      }
      const ex = await this.init();
      const out = await ex(texts, { pooling: 'mean', normalize: true });
      const list = out.tolist();
      if (!Array.isArray(list) || list.length !== texts.length) {
        const e = new Error(`tensor shape mismatch: got ${list?.length}, expected ${texts.length}`);
        e.failureCode = 'EMBEDDING_RESPONSE_SCHEMA_INVALID';
        throw e;
      }
      const id = await readIdentity();
      return {
        vectors: list,
        meta: {
          echoedModel: this.modelId,
          dims: out.dims ?? null,
          dtype: out.type ?? null,
          revisionSha: id.revisionSha ?? null,
          transport: this.transport,
        },
      };
    },
  };
}
