// SPDX-License-Identifier: AGPL-3.0-only
/**
 * lib/model-runtime.mjs
 *
 * The single model-access layer for the P1 path: the planner, T13 claim
 * extraction and T14 synthesis all call a model through the runtime object
 * built here. Transport, auth and provider differences are delegated to
 * pi-ai (@earendil-works/pi-ai), so any provider it supports — or any
 * OpenAI-compatible endpoint given with a base URL — can be used.
 *
 * Model selection: `<provider>/<model-id>`, e.g.
 *   deepseek/deepseek-v4-pro          (default)
 *   moonshotai-cn/kimi-k2.6
 *   openrouter/anthropic/claude-sonnet-4.5
 *   antigravity/claude-sonnet-4-6     + baseUrl http://127.0.0.1:8045/v1
 * With a base URL the provider name is a free label and the endpoint is
 * treated as OpenAI-compatible.
 *
 * Runtime identity recorded in state/results: runtimeId
 * `<provider>-api-tool-less`, model `<model-id>`. The default therefore keeps
 * the historical identity (deepseek-api-tool-less / deepseek-v4-pro).
 *
 * Boundaries (unchanged from the previous DeepSeek-only adapter):
 *   - tool-less: no tools are ever sent; a tool call in the reply fails closed;
 *   - the model only proposes semantics; callers validate every output;
 *   - no fallback: a failure throws a typed runtime_unavailable error, it
 *     never switches to another model or provider;
 *   - keys come from env vars or 0600 files and are never logged, persisted,
 *     placed in prompts, or echoed in error messages (provider error text is
 *     dropped; only an HTTP status class is kept).
 *
 * pi-ai is imported lazily, so modules that only need the identity helpers
 * never load it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDeepSeekCredential } from '../../corpus-anthology/lib/deepseek-tool-less.mjs';
import { CLAIMS_SYSTEM_PROMPT, MAP_CLAIMS_SYSTEM_PROMPT, MERGE_CLAIMS_SYSTEM_PROMPT, SYNTHESIS_SYSTEM_PROMPT } from './research-prompts.mjs';

export const DEFAULT_MODEL_SPEC = 'deepseek/deepseek-v4-pro';
export const MODEL_API_KEY_ENV = 'RESEARCH_MODEL_API_KEY';
export const MODEL_API_KEY_FILE = '.model_api_key';
export const DEFAULT_MAX_TOKENS = 8192;
export const DEFAULT_IDLE_TIMEOUT_MS = 180_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 900_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Wait before retry n (1-based) when the provider gives no hint. */
export const RETRY_BACKOFF_MS = Object.freeze([5_000, 30_000, 60_000]);
/** Upper bound for any single wait, including a provider's "Wait Ns" hint. */
export const MAX_RETRY_DELAY_MS = 120_000;
/** Bad model output (unparseable/empty) is retried after a short pause. */
export const QUICK_RETRY_MS = 1_000;
export const CUSTOM_CONTEXT_WINDOW = 200_000;
export const CUSTOM_MAX_TOKENS = 32_768;
/** Output budgets for calls whose output grows with the input (chunked analysis, synthesis). */
export const BATCH_MAX_TOKENS = 16_384;
export const LARGE_OUTPUT_MAX_TOKENS = 32_768;

const RUNTIME_SUFFIX = '-api-tool-less';
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const RUNTIME_ID = /^[a-z0-9][a-z0-9-]{0,63}-api-tool-less$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export class ModelRuntimeError extends Error {
  constructor(code, message, { kind = null } = {}) {
    super(`${code}: ${message}`);
    this.name = 'ModelRuntimeError';
    this.code = code;
    this.kind = kind;
  }
}

/** `<provider>/<model-id>` → { provider, modelId }. The model id may contain '/'. */
export function parseModelSpec(spec) {
  if (typeof spec !== 'string') throw new ModelRuntimeError('model_spec_invalid', 'model must be a string like deepseek/deepseek-v4-pro');
  const trimmed = spec.trim();
  const slash = trimmed.indexOf('/');
  const provider = slash > 0 ? trimmed.slice(0, slash) : '';
  const modelId = slash > 0 ? trimmed.slice(slash + 1) : '';
  if (!PROVIDER_ID.test(provider) || !MODEL_ID.test(modelId)) {
    throw new ModelRuntimeError('model_spec_invalid', 'model must look like <provider>/<model-id>, e.g. deepseek/deepseek-v4-pro');
  }
  return { provider, modelId };
}

export function runtimeIdentityFor({ provider, modelId }) {
  return { runtimeId: `${provider}${RUNTIME_SUFFIX}`, model: modelId };
}

/** True for any well-formed research runtime identity (any provider, any model). */
export function isResearchRuntimeIdentity(runtime) {
  return runtime !== null && typeof runtime === 'object'
    && typeof runtime.runtimeId === 'string' && RUNTIME_ID.test(runtime.runtimeId)
    && typeof runtime.model === 'string' && MODEL_ID.test(runtime.model);
}

/** True when the identity is the default model (keeps historical run identity). */
export function isDefaultRuntimeIdentity(runtime) {
  const def = runtimeIdentityFor(parseModelSpec(DEFAULT_MODEL_SPEC));
  return runtime?.runtimeId === def.runtimeId && runtime?.model === def.model;
}

/**
 * Strip what models commonly wrap around a JSON object: a Markdown code fence
 * or a sentence before/after it. Returns the text from the first `{` to the
 * last `}`; the caller still parses and validates it strictly.
 */
export function extractJsonText(text) {
  const s = String(text ?? '').trim();
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(s);
  const body = (fenced ? fenced[1] : s).trim();
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  return first >= 0 && last > first ? body.slice(first, last + 1) : body;
}

export function parseJsonObject(text) {
  const value = JSON.parse(extractJsonText(text));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyntaxError('model output is not a JSON object');
  }
  return value;
}

/** https anywhere; plain http only to this machine. No credentials, query or fragment. */
export function validateBaseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new ModelRuntimeError('base_url_invalid', 'base URL is not a valid URL');
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ModelRuntimeError('base_url_invalid', 'base URL must use https (plain http is allowed only for localhost)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ModelRuntimeError('base_url_invalid', 'base URL must not contain credentials, a query or a fragment');
  }
  return url.toString().replace(/\/+$/, '');
}

function readKeyFile(dir) {
  const file = path.join(dir, MODEL_API_KEY_FILE);
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new ModelRuntimeError('credential_unusable', `${MODEL_API_KEY_FILE} must be a regular file`);
  }
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    throw new ModelRuntimeError('credential_unusable', `${MODEL_API_KEY_FILE} must have 0600 permissions`);
  }
  const key = fs.readFileSync(file, 'utf8').trim();
  return key === '' ? null : key;
}

/**
 * Resolve the API key without ever exposing it:
 *   1. RESEARCH_MODEL_API_KEY (any provider)
 *   2. DeepSeek only: DEEPSEEK_API_KEY / .deepseek_api_key (existing contract)
 *   3. .model_api_key (0600) in cwd, then the repo root
 *   4. none → built-in providers fall back to pi-ai's own env vars
 *      (OPENAI_API_KEY, MOONSHOT_API_KEY, ...); custom endpoints go keyless.
 */
export function resolveModelApiKey({ provider, custom = false, env = process.env, cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  const fromEnv = typeof env[MODEL_API_KEY_ENV] === 'string' ? env[MODEL_API_KEY_ENV].trim() : '';
  if (fromEnv) return { key: fromEnv, source: 'env' };
  if (provider === 'deepseek' && !custom) {
    const cred = resolveDeepSeekCredential({ env, cwd, repoRoot });
    if (cred.usable) return { key: cred.key.trim(), source: cred.source };
    if (cred.configured) throw new ModelRuntimeError('credential_unusable', `DeepSeek credential is configured but unusable (${cred.error})`);
  }
  for (const dir of [cwd, repoRoot]) {
    const key = readKeyFile(dir);
    if (key) return { key, source: 'file' };
  }
  return { key: null, source: 'none' };
}

function customModelDefinition({ provider, modelId, baseUrl }) {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CUSTOM_CONTEXT_WINDOW,
    maxTokens: CUSTOM_MAX_TOKENS,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
    },
  };
}

async function loadModel({ provider, modelId, baseUrl, injectedModels }) {
  if (injectedModels) {
    const model = injectedModels.getModel(provider, modelId);
    if (!model) throw new ModelRuntimeError('model_not_found', `model ${provider}/${modelId} is not registered`);
    return { models: injectedModels, model };
  }
  if (baseUrl) {
    const { createModels, createProvider } = await import('@earendil-works/pi-ai');
    const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
    const definition = customModelDefinition({ provider, modelId, baseUrl });
    const models = createModels();
    models.setProvider(createProvider({
      id: provider,
      name: provider,
      baseUrl,
      // The key is passed per request; the provider itself resolves nothing.
      auth: { apiKey: { name: `${provider} API key`, resolve: async () => ({ auth: {} }) } },
      models: [definition],
      api: openAICompletionsApi(),
    }));
    return { models, model: models.getModel(provider, modelId) };
  }
  const { builtinModels } = await import('@earendil-works/pi-ai/providers/all');
  const models = builtinModels();
  if (!models.getProvider(provider)) {
    throw new ModelRuntimeError('model_not_found', `unknown provider "${provider}"; pass --base-url for an OpenAI-compatible endpoint`);
  }
  const model = models.getModel(provider, modelId);
  if (!model) {
    const known = models.getModels(provider).map((m) => m.id).slice(0, 12).join(', ');
    throw new ModelRuntimeError('model_not_found', `provider "${provider}" has no model "${modelId}" (known: ${known})`);
  }
  return { models, model };
}

/** Request options that keep the historical DeepSeek request shape; neutral elsewhere. */
function requestTuning({ provider, custom }) {
  if (provider === 'deepseek' && !custom) {
    return { temperature: 0, samplingParams: { response_format: { type: 'json_object' }, thinking: { type: 'disabled' } } };
  }
  if (custom) return { temperature: 0 };
  return {};
}

/**
 * A provider's own retry hint ("Wait 27s", "Retry-After: 30"), in ms. Only the
 * number is used; the provider text itself is never surfaced.
 */
function waitHintMs(text) {
  const s = String(text ?? '');
  const m = /\bwait\s+(\d{1,5})\s*s(?:ec(?:onds?)?)?\b/i.exec(s) ?? /\bretry[- ]after[:\s]+(\d{1,5})\b/i.exec(s);
  return m ? Number(m[1]) * 1000 : null;
}

/** Classify a failed pi-ai message. Provider error text is never surfaced. */
function classifyFailure(msg) {
  if (msg.stopReason === 'aborted') return { kind: 'timeout', retry: true };
  if (msg.stopReason === 'length') return { kind: 'truncated', retry: false };
  if (msg.stopReason === 'toolUse') return { kind: 'tool_call', retry: false };
  const status = /^(\d{3})\b/.exec(String(msg.errorMessage ?? ''))?.[1];
  if (status) {
    const code = Number(status);
    const retry = code === 408 || code === 429 || code >= 500;
    return { kind: `http_${code}`, retry, hintMs: waitHintMs(msg.errorMessage) };
  }
  return { kind: 'transport', retry: true };
}

/** How long to wait before the next attempt (attempt is the one that just failed). */
function retryDelayMs(attempt, outcome) {
  if (outcome.kind === 'invalid_json' || outcome.kind === 'empty') return QUICK_RETRY_MS;
  if (Number.isFinite(outcome.hintMs)) return Math.min(outcome.hintMs + 1_000, MAX_RETRY_DELAY_MS);
  return RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length) - 1];
}

const realSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Build the research runtime.
 *
 * @param {object} [options]
 * @param {string} [options.spec]           `<provider>/<model-id>` (default DEFAULT_MODEL_SPEC)
 * @param {string} [options.baseUrl]        OpenAI-compatible endpoint (custom provider)
 * @param {string} [options.apiKey]         explicit key (tests); otherwise resolveModelApiKey
 * @param {Function} [options.fetchImpl]    HTTP transport passed to pi-ai (tests inject fakes)
 * @param {object} [options.models]         pre-built pi-ai Models collection (tests)
 * @param {Array}  [options.usageSink]      receives one non-sensitive usage record per call
 * @param {number} [options.maxAttempts]    attempts per call; retryable failures back off between them
 * @param {Function} [options.sleep]        waits between attempts (tests inject a recorder)
 */
export async function createModelRuntime({
  spec = DEFAULT_MODEL_SPEC,
  baseUrl = null,
  apiKey = undefined,
  env = process.env,
  cwd = process.cwd(),
  fetchImpl = undefined,
  models: injectedModels = null,
  usageSink = null,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  sleep = realSleep,
} = {}) {
  const { provider, modelId } = parseModelSpec(spec);
  const custom = baseUrl !== null && baseUrl !== undefined && baseUrl !== '';
  const endpoint = custom ? validateBaseUrl(baseUrl) : null;
  const key = apiKey !== undefined ? apiKey : resolveModelApiKey({ provider, custom, env, cwd }).key;
  const { models, model } = await loadModel({ provider, modelId, baseUrl: endpoint, injectedModels });
  const tuning = requestTuning({ provider, custom });
  const identity = runtimeIdentityFor({ provider, modelId });

  async function once({ system, user, maxTokens }) {
    const controller = new AbortController();
    let idle = setTimeout(() => controller.abort(), idleTimeoutMs);
    const total = setTimeout(() => controller.abort(), totalTimeoutMs);
    const started = Date.now();
    try {
      const stream = models.stream(model, {
        systemPrompt: system,
        messages: [{ role: 'user', content: user, timestamp: started }],
      }, {
        ...(key ? { apiKey: key } : {}),
        ...(typeof fetchImpl === 'function' ? { fetch: fetchImpl } : {}),
        signal: controller.signal,
        maxRetries: 0,
        maxTokens: Math.min(maxTokens, Number(model.maxTokens) || maxTokens),
        ...tuning,
      });
      for await (const _event of stream) {
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), idleTimeoutMs);
      }
      return { msg: await stream.result(), ms: Date.now() - started };
    } finally {
      clearTimeout(idle);
      clearTimeout(total);
    }
  }

  function record(label, msg, ms, attempt) {
    if (!Array.isArray(usageSink)) return;
    const u = msg?.usage ?? {};
    usageSink.push({
      label,
      provider,
      model: modelId,
      attempt,
      ok: msg?.stopReason === 'stop',
      inputTokens: Number.isFinite(u.input) ? u.input : null,
      outputTokens: Number.isFinite(u.output) ? u.output : null,
      totalTokens: Number.isFinite(u.totalTokens) ? u.totalTokens : null,
      costUsd: Number.isFinite(u.cost?.total) ? u.cost.total : null,
      ms,
    });
  }

  /** One validated text completion, with bounded retries; parse() may reject the text. */
  async function complete({ system, user, maxTokens = DEFAULT_MAX_TOKENS, label = 'model' }, parse = (t) => t) {
    if (typeof user !== 'string' || user.trim() === '') {
      throw new ModelRuntimeError('runtime_unavailable', `${label}: input is empty`, { kind: 'empty_input' });
    }
    let last = 'unknown';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let outcome;
      try {
        const { msg, ms } = await once({ system, user, maxTokens });
        record(label, msg, ms, attempt);
        const toolCall = (msg.content ?? []).some((b) => b?.type === 'toolCall');
        if (msg.stopReason !== 'stop' || toolCall) {
          outcome = toolCall ? { kind: 'tool_call', retry: false } : classifyFailure(msg);
        } else {
          const text = (msg.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
          if (text.trim() === '') {
            outcome = { kind: 'empty', retry: true };
          } else {
            try {
              return parse(text);
            } catch {
              outcome = { kind: 'invalid_json', retry: true };
            }
          }
        }
      } catch {
        outcome = { kind: 'transport', retry: true };
      }
      last = outcome.kind;
      if (!outcome.retry || attempt === maxAttempts) break;
      await sleep(retryDelayMs(attempt, outcome));
    }
    throw new ModelRuntimeError('runtime_unavailable',
      `${label} via ${provider}/${modelId} failed (${last})`, { kind: last });
  }

  const runtime = {
    ...identity,
    provider,
    endpoint: endpoint ?? model.baseUrl ?? null,
    /** Raw assistant text (the planner validates it). */
    completeText(args) {
      return complete(args);
    },
    /** A parsed JSON object (fences/prose around it are tolerated). */
    completeJson(args) {
      return complete(args, parseJsonObject);
    },
    /** T13 seam: claims for one group projection (T13 validates the output). */
    analyze({ projection }) {
      return complete({ system: CLAIMS_SYSTEM_PROMPT, user: String(projection ?? ''), label: 'analyze' }, parseJsonObject);
    },
    /** Chunked T13 (P4): claims for one batch of a group's sources (T13 validates). */
    analyzeBatch({ projection }) {
      return complete({ system: MAP_CLAIMS_SYSTEM_PROMPT, user: String(projection ?? ''), maxTokens: BATCH_MAX_TOKENS, label: 'analyze_batch' }, parseJsonObject);
    },
    /** Chunked T13 (P4): proposed partition of a group's batch claims (T13 validates). */
    mergeClaims({ claims }) {
      return complete({ system: MERGE_CLAIMS_SYSTEM_PROMPT, user: JSON.stringify({ claims }), maxTokens: LARGE_OUTPUT_MAX_TOKENS, label: 'merge' }, parseJsonObject);
    },
    /** T14 seam: proposition families over aggregated claims (T14 validates). */
    synthesize({ claims }) {
      return complete({ system: SYNTHESIS_SYSTEM_PROMPT, user: JSON.stringify({ claims }), maxTokens: LARGE_OUTPUT_MAX_TOKENS, label: 'synthesize' }, parseJsonObject);
    },
  };
  return Object.freeze(runtime);
}
