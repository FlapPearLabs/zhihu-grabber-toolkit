// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline transport for lib/model-runtime.mjs: a fake `fetch` that answers
 * OpenAI-compatible chat requests with a server-sent-event stream, so tests
 * exercise the real model layer (pi-ai request building, streaming, error
 * handling) without any network.
 *
 * reply(body, { call }) returns one of:
 *   'text'                                   assistant text, clean stop
 *   { text, finish?, model?, usage? }        assistant text with options
 *   { status, body? }                        HTTP error response
 *   { toolCall: true }                       a tool call (must fail closed)
 *   { hang: true }                           headers, then nothing
 *   { reject: Error }                        network failure
 */

import { createModelRuntime, DEFAULT_MODEL_SPEC } from '../../lib/model-runtime.mjs';

export const TEST_API_KEY = 'sk-fake-test-key-000';

function chunk(model, delta, finish = null) {
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function sse(events) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export function fakeModelFetch(reply) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
    const rawBody = typeof init.body === 'string' ? init.body : '';
    const body = rawBody ? JSON.parse(rawBody) : null;
    calls.push({ url: String(url), headers, body, rawBody });
    const r = typeof reply === 'function' ? reply(body, { call: calls.length }) : reply;
    const spec = typeof r === 'string' ? { text: r } : r;
    if (spec.reject) throw spec.reject;
    if (spec.status) {
      // A string body is sent as plain text (local proxies answer like that).
      const text = typeof spec.body === 'string';
      return new Response(text ? spec.body : JSON.stringify(spec.body ?? { error: { message: 'fake error' } }), {
        status: spec.status,
        headers: { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json' },
      });
    }
    if (spec.hang) {
      return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } });
    }
    const model = spec.model ?? body?.model ?? 'fake-model';
    if (spec.toolCall) {
      return sse([
        chunk(model, { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }] }),
        chunk(model, {}, 'tool_calls'),
      ]);
    }
    const events = [
      chunk(model, { role: 'assistant', content: spec.text ?? '' }),
      chunk(model, {}, spec.finish ?? 'stop'),
    ];
    if (spec.usage) events.push({ ...chunk(model, {}), choices: [], usage: spec.usage });
    return sse(events);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/**
 * A real model runtime over the fake transport. Retries default to 1 attempt,
 * and retry backoff never really waits: delays are recorded in `delays`.
 */
export async function fakeModelRuntime(reply, {
  spec = DEFAULT_MODEL_SPEC,
  baseUrl = null,
  apiKey = TEST_API_KEY,
  usageSink = null,
  maxAttempts = 1,
  idleTimeoutMs = 2000,
} = {}) {
  const fetchImpl = fakeModelFetch(reply);
  const delays = [];
  const sleep = async (ms) => { delays.push(ms); };
  const runtime = await createModelRuntime({ spec, baseUrl, apiKey, fetchImpl, usageSink, maxAttempts, idleTimeoutMs, sleep });
  return { runtime, calls: fetchImpl.calls, delays };
}

/** The system and user text of a captured chat request. */
export function messagesOf(body) {
  const text = (content) => (typeof content === 'string'
    ? content
    : (content ?? []).map((part) => part?.text ?? '').join(''));
  const system = (body?.messages ?? []).find((m) => m.role === 'system' || m.role === 'developer');
  const user = (body?.messages ?? []).find((m) => m.role === 'user');
  return { system: text(system?.content), user: text(user?.content) };
}
