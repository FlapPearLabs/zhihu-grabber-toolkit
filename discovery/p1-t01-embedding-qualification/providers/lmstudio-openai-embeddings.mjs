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
