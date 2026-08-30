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
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { redact } from './errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL_DIR = resolve(HERE, '..', 'models');
const EMPTY_ARTIFACT_DIR = resolve(HERE, '..', 'probe-empty-model-dir');

function classifyFailure(err) {
  return { outcome: 'FAILURE', failureCode: err?.failureCode ?? 'UNCLASSIFIED', message: redact(String(err?.message ?? err)).slice(0, 240) };
}

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

    /**
     * MEASURED input-side normalization identity (review finding P1-3).
     * Everything reported here is observed at qualification time — nothing is asserted.
     * This is the identity T10 must consume when composing the Spec §5.3 cache identity,
     * together with OUTPUT_NORMALIZATION_VERSION (L2_UNIT_NORM) and the model revision.
     */
    async inputProfile() {
      const ex = await this.init();
      const tokenizer = ex.tokenizer;
      const toIdArray = (enc) => {
        let ids = enc?.input_ids;
        let arr = Array.isArray(ids) ? ids : typeof ids?.tolist === 'function' ? ids.tolist() : Array.from(ids?.data ?? []);
        if (Array.isArray(arr?.[0])) arr = arr.flat();
        return Array.from(arr ?? []).map((x) => Number(x));
      };
      const base = '这是一段用于测量输入侧截断边界的合成中文文本。';
      const long = base.repeat(150); // far beyond any 512-token window
      let rawTokens = null;
      let defaultTokens = null;
      try {
        rawTokens = toIdArray(tokenizer(long, { truncation: false })).length;
      } catch {
        rawTokens = null;
      }
      try {
        defaultTokens = toIdArray(tokenizer(long)).length;
      } catch {
        defaultTokens = null;
      }
      const modelMaxLength = tokenizer.model_max_length ?? null;

      // Empirical truncation probe (shared-prefix bracketing): build a long text,
      // then compare it against texts that are the same base repeated K times.
      // The first K whose token count reaches the model window yields cos == 1.0
      // against the long text; the K below the window yields cos < 1. That brackets
      // the effective truncation window without relying on decode/re-encode.
      let truncationEvidence = { measured: false };
      try {
        const long = base.repeat(50);
        const window = Math.min(modelMaxLength ?? 512, 512);
        // Token counts are NOT linear in the number of repeats (adjacent repeats can
        // merge wordpieces), so the bracket is found by counting tokens directly.
        const countTokens = (s) => toIdArray(tokenizer(s, { truncation: false })).length;
        let kAt = 1;
        while (countTokens(base.repeat(kAt)) < window) kAt += 1;
        const kBelow = kAt - 1;
        const cos = (a, b) => {
          let d = 0;
          for (let i = 0; i < a.length; i += 1) d += a[i] * b[i];
          return d;
        };
        const [vLong] = (await this.embed([long])).vectors;
        const atWindow = base.repeat(kAt);
        const belowWindow = base.repeat(kBelow);
        const atWindowTokens = countTokens(atWindow);
        const belowWindowTokens = countTokens(belowWindow);
        const [vAt] = (await this.embed([atWindow])).vectors;
        const [vBelow] = (await this.embed([belowWindow])).vectors;
        const cosAt = Number(cos(vLong, vAt).toFixed(6));
        const cosBelow = Number(cos(vLong, vBelow).toFixed(6));
        const bracketValid = atWindowTokens >= window && belowWindowTokens < window;
        truncationEvidence = {
          measured: true,
          method: 'shared-prefix bracketing (direct token counts, repeats are non-linear)',
          windowTokens: window,
          atWindowRepeats: kAt,
          atWindowTokens,
          cos_long_vs_atWindow: cosAt,
          belowWindowRepeats: kBelow,
          belowWindowTokens,
          cos_long_vs_belowWindow: cosBelow,
          bracketValid,
          interpretedAs:
            bracketValid && cosAt >= 0.999999 && cosBelow < 0.999
              ? 'INPUT_TRUNCATED_TO_MAX_TOKENS'
              : 'INPUT_TRUNCATION_BEHAVIOR_UNRESOLVED',
        };
      } catch (err) {
        truncationEvidence = { measured: false, error: redact(String(err?.message ?? err)).slice(0, 200) };
      }

      return {
        tokenizerClass: tokenizer?.constructor?.name ?? null,
        vocabSize: tokenizer?.vocab_size ?? null,
        modelMaxLengthTokens: modelMaxLength,
        rawTokenCountMeasured: rawTokens,
        defaultCallTokenCount: defaultTokens,
        pooling: 'mean',
        outputNormalize: true,
        instructionPrefix: null,
        instructionPrefixNote: 'no task instruction / query prefix was prepended in this battery (bge-zh instruction prefixes are a retrieval-query optimization and were deliberately not applied)',
        truncationEvidence,
      };
    },

    /**
     * PROVIDER-SPECIFIC failure surface (review finding P1-2).
     * Only failure modes that actually apply to an in-process ONNX provider are
     * probed. `ENDPOINT_UNREACHABLE` is explicitly N/A: this transport has no
     * endpoint, so an unreachable-endpoint result would be a cross-provider
     * misattribution.
     */
    failureProbes() {
      return [
        {
          id: 'UNKNOWN_OR_ABSENT_MODEL',
          applicable: true,
          description: 'model id that does not exist in the local artifact dir (allowRemoteModels=false)',
          probe: async () => {
            const p = createProvider({ model: 'T01Probe/no-such-model', modelDir });
            try {
              await p.embed(['失败身份探测']);
              return { outcome: 'NO_FAILURE', failureCode: 'NONE', note: 'provider accepted an absent model id — silent fallback' };
            } catch (err) {
              return classifyFailure(err);
            }
          },
        },
        {
          id: 'MISSING_LOCAL_ARTIFACT_OR_LOAD_FAILURE',
          applicable: true,
          description: 'valid model id, but the local artifact directory contains no model files',
          probe: async () => {
            await mkdir(EMPTY_ARTIFACT_DIR, { recursive: true });
            const p = createProvider({ model: 'Xenova/bge-base-zh-v1.5', modelDir: EMPTY_ARTIFACT_DIR });
            try {
              await p.embed(['失败身份探测']);
              return { outcome: 'NO_FAILURE', failureCode: 'NONE', note: 'provider produced vectors without any local artifact' };
            } catch (err) {
              return classifyFailure(err);
            }
          },
        },
        {
          id: 'INVALID_PROVIDER_INPUT',
          applicable: true,
          description: "embed() called with a non-array input (violates this provider's input contract)",
          probe: async () => {
            try {
              await this.embed('not-an-array');
              return { outcome: 'NO_FAILURE', failureCode: 'NONE', note: 'invalid input accepted' };
            } catch (err) {
              return classifyFailure(err);
            }
          },
        },
        {
          id: 'ENDPOINT_UNREACHABLE',
          applicable: false,
          reason:
            'N/A — in-process ONNX transport has no network endpoint. An unreachable-endpoint probe belongs to the HTTP-server provider family (e.g. lmstudio-local-embeddings) and must not be attributed to this provider.',
        },
      ];
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
