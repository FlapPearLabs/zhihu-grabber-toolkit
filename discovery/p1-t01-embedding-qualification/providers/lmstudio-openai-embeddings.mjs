/**
 * DISCOVERY-ONLY (P1-T01 / Issue #33) — LOCAL candidate provider adapter probe.
 * Not production code. Not imported by any production package.
 *
 * Candidate profile under test:
 *   PROVIDER_CATEGORY = LOCAL
 *   NAMED_PROVIDER    = lmstudio-local-embeddings (OpenAI-compatible /v1/embeddings on loopback)
 *   NAMED_MODEL       = text-embedding-nomic-embed-text-v1.5 (GGUF, served by LM Studio)
 *
 * Isolation note: this probe talks ONLY to 127.0.0.1. It sends no credential and
 * sends no corpus data off-machine. The corpus-bearing egress question is answered
 * by AC_11 (black-hole proxy run), not by assertion.
 */
import { EmbeddingProbeError, FAILURE_CODES, redact } from './errors.mjs';

const DEFAULT_BASE_URL = 'http://127.0.0.1:1234';

function classifyFailure(err) {
  return { outcome: 'FAILURE', failureCode: err?.failureCode ?? 'UNCLASSIFIED', message: redact(String(err?.message ?? err)).slice(0, 240) };
}

export function createProvider({
  baseUrl = process.env.P1_T01_LMSTUDIO_BASE_URL ?? DEFAULT_BASE_URL,
  model = process.env.P1_T01_LMSTUDIO_EMBED_MODEL ?? 'text-embedding-nomic-embed-text-v1.5',
  timeoutMs = 120_000,
} = {}) {
  return {
    id: 'lmstudio-local-nomic-embed-text-v1.5',
    providerCategory: 'LOCAL',
    providerId: 'lmstudio-local-embeddings',
    providerVersionId: 'openai-compatible-v1-embeddings',
    modelId: model,
    transport: `loopback-http:${baseUrl}`,
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
      };
    },

    async health() {
      try {
        const res = await fetchWithTimeout(`${baseUrl}/v1/models`, { method: 'GET' }, timeoutMs);
        if (!res.ok) {
          throw new EmbeddingProbeError(
            FAILURE_CODES.PROVIDER_HTTP_ERROR,
            `model listing failed: HTTP ${res.status}`,
            { status: res.status },
          );
        }
        const body = await res.json();
        const ids = Array.isArray(body?.data) ? body.data.map((m) => m?.id).filter(Boolean) : [];
        return { ok: true, models: ids, modelPresent: ids.includes(model) };
      } catch (err) {
        if (err instanceof EmbeddingProbeError) throw err;
        throw new EmbeddingProbeError(
          FAILURE_CODES.PROVIDER_UNREACHABLE,
          `loopback embedding server unreachable: ${redact(err?.message ?? String(err))}`,
        );
      }
    },

    /**
     * PROVIDER-SPECIFIC failure surface (review finding P1-2).
     * These are the failure modes that actually apply to a loopback HTTP
     * OpenAI-compatible embeddings server. They are NOT transferable to the
     * in-process ONNX provider family and vice versa.
     */
    failureProbes() {
      return [
        {
          id: 'UNKNOWN_OR_ABSENT_MODEL',
          applicable: true,
          description: 'request embeddings for a model name that is not loaded / not available',
          probe: async () => {
            const p = createProvider({ baseUrl, model: 't01-probe-no-such-model', timeoutMs });
            try {
              await p.embed(['失败身份探测']);
              return { outcome: 'NO_FAILURE', failureCode: 'NONE', note: 'server accepted an unknown model name and returned vectors — silent fallback' };
            } catch (err) {
              return classifyFailure(err);
            }
          },
        },
        {
          id: 'INVALID_PROVIDER_INPUT',
          applicable: true,
          description: 'malformed request body (input not an array of strings) against the HTTP contract',
          probe: async () => {
            try {
              const res = await fetchWithTimeout(
                `${baseUrl}/v1/embeddings`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: 'not-an-array' }) },
                timeoutMs,
              );
              const status = res.status;
              if (res.ok) return { outcome: 'NO_FAILURE', failureCode: 'NONE', note: 'server returned 200 for a malformed body' };
              return { outcome: 'FAILURE', failureCode: 'EMBEDDING_PROVIDER_HTTP_ERROR', message: `HTTP ${status} for malformed request body` };
            } catch (err) {
              return classifyFailure(err);
            }
          },
        },
        {
          id: 'ENDPOINT_UNREACHABLE',
          applicable: true,
          description: 'loopback server not listening on the configured port',
          probe: async () => {
            const dead = createProvider({ baseUrl: 'http://127.0.0.1:9', model, timeoutMs: 5_000 });
            try {
              await dead.embed(['失败身份探测']);
              return { outcome: 'NO_FAILURE', failureCode: 'NONE' };
            } catch (err) {
              return classifyFailure(err);
            }
          },
        },
        {
          id: 'MISSING_LOCAL_ARTIFACT_OR_LOAD_FAILURE',
          applicable: false,
          reason: 'N/A — model artifact loading is server-side (LM Studio manages GGUF files); it is not observable through the OpenAI-compatible API surface probed here.',
        },
      ];
    },

    async embed(texts) {
      if (!Array.isArray(texts)) {
        throw new EmbeddingProbeError(FAILURE_CODES.INPUT_INVALID, 'embed() requires an array of strings');
      }
      let res;
      try {
        res = await fetchWithTimeout(
          `${baseUrl}/v1/embeddings`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: texts }),
          },
          timeoutMs,
        );
      } catch (err) {
        throw new EmbeddingProbeError(
          FAILURE_CODES.PROVIDER_UNREACHABLE,
          `loopback embedding server unreachable: ${redact(err?.message ?? String(err))}`,
        );
      }

      const raw = await res.text();
      if (!res.ok) {
        const code =
          res.status === 404 || res.status === 400 ? FAILURE_CODES.MODEL_UNKNOWN : FAILURE_CODES.PROVIDER_HTTP_ERROR;
        throw new EmbeddingProbeError(code, `embeddings request failed: HTTP ${res.status}`, {
          status: res.status,
          bodyExcerpt: redact(raw).slice(0, 300),
        });
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new EmbeddingProbeError(FAILURE_CODES.RESPONSE_SCHEMA_INVALID, 'response body is not JSON');
      }
      if (!Array.isArray(body?.data) || body.data.length !== texts.length) {
        throw new EmbeddingProbeError(
          FAILURE_CODES.RESPONSE_SCHEMA_INVALID,
          `response data length ${body?.data?.length} != input length ${texts.length}`,
        );
      }

      const vectors = [];
      for (const item of body.data) {
        const v = item?.embedding;
        if (!Array.isArray(v) || v.length === 0) {
          throw new EmbeddingProbeError(FAILURE_CODES.RESPONSE_SCHEMA_INVALID, 'missing embedding array in response item');
        }
        vectors.push(v);
      }

      return {
        vectors,
        meta: {
          echoedModel: body.model ?? null,
          usage: body.usage ?? null,
          transport: this.transport,
        },
      };
    },
  };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}
