// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/model-runtime.test.mjs
 *
 * lib/model-runtime.mjs — the single model-access layer (pi-ai based).
 *
 *   M1  model spec parsing and runtime identity (default identity unchanged)
 *   M2  JSON extraction tolerates fences/prose, still parses strictly
 *   M3  base URL policy: https anywhere, plain http only to this machine
 *   M4  key resolution: env > DeepSeek legacy > 0600 file > none; unsafe files refused
 *   M5  default DeepSeek request keeps the historical shape; key only in the header
 *   M6  custom OpenAI-compatible endpoint (e.g. a local proxy on 8045)
 *   M7  failure classes: no retry for 4xx/truncated/tool call, bounded retry
 *       for 5xx/transport/invalid JSON, idle timeout for a stalled stream
 *   M8  provider error text (which may echo the key) never surfaces
 *   M9  analyze/synthesize send the T13/T14 prompts; usage is recorded per call
 *   M10 unknown provider/model fails closed with model_not_found
 *
 * Offline: the fake SSE transport in test/helpers/fake-model-transport.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_MODEL_SPEC,
  MODEL_API_KEY_ENV,
  MODEL_API_KEY_FILE,
  createModelRuntime,
  extractJsonText,
  isDefaultRuntimeIdentity,
  isResearchRuntimeIdentity,
  parseJsonObject,
  parseModelSpec,
  resolveModelApiKey,
  runtimeIdentityFor,
  validateBaseUrl,
} from '../lib/model-runtime.mjs';
import { CLAIMS_SYSTEM_PROMPT, SYNTHESIS_SYSTEM_PROMPT } from '../lib/research-prompts.mjs';
import { fakeModelFetch, fakeModelRuntime, messagesOf, TEST_API_KEY } from './helpers/fake-model-transport.mjs';

const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const posix = process.platform !== 'win32';

test('M1: model spec parsing and runtime identity', () => {
  assert.deepEqual(parseModelSpec('deepseek/deepseek-v4-pro'), { provider: 'deepseek', modelId: 'deepseek-v4-pro' });
  assert.deepEqual(parseModelSpec('openrouter/anthropic/claude-sonnet-4.5'), { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5' });
  for (const bad of ['', 'deepseek', '/x', 'Deep Seek/x', 'deepseek/', 'deepseek/has space', 'a/b\nc', 42]) {
    assert.throws(() => parseModelSpec(bad), /model_spec_invalid/, JSON.stringify(bad));
  }
  // The default keeps the historical identity, so existing checkpoints and the canonical runner still match.
  const def = runtimeIdentityFor(parseModelSpec(DEFAULT_MODEL_SPEC));
  assert.deepEqual(def, { runtimeId: 'deepseek-api-tool-less', model: 'deepseek-v4-pro' });
  assert.equal(isDefaultRuntimeIdentity(def), true);
  assert.equal(isDefaultRuntimeIdentity({ runtimeId: 'deepseek-api-tool-less', model: 'deepseek-flash' }), false);
  assert.equal(isResearchRuntimeIdentity({ runtimeId: 'antigravity-api-tool-less', model: 'claude-sonnet-4-6' }), true);
  for (const bad of [null, {}, { runtimeId: 'lmstudio-local-tool-less', model: 'x' }, { runtimeId: 'x-api-tool-less', model: '' }, { runtimeId: 'X-api-tool-less', model: 'm' }]) {
    assert.equal(isResearchRuntimeIdentity(bad), false, JSON.stringify(bad));
  }
});

test('M2: JSON extraction tolerates fences and prose but parses strictly', () => {
  assert.equal(extractJsonText('{"a":1}'), '{"a":1}');
  assert.equal(extractJsonText('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJsonText('结果如下：\n{"a":{"b":2}}\n以上。'), '{"a":{"b":2}}');
  assert.deepEqual(parseJsonObject('```\n{"a":[1,2]}\n```'), { a: [1, 2] });
  assert.throws(() => parseJsonObject('[1,2]'), SyntaxError);
  assert.throws(() => parseJsonObject('no json here'), SyntaxError);
  assert.throws(() => parseJsonObject('{"a":'), SyntaxError);
});

test('M3: base URL policy', () => {
  assert.equal(validateBaseUrl('http://127.0.0.1:8045/v1/'), 'http://127.0.0.1:8045/v1');
  assert.equal(validateBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(validateBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
  for (const bad of ['http://10.0.0.5:8000/v1', 'http://example.com/v1', 'ftp://127.0.0.1/', 'https://user:pw@api.example.com/v1', 'https://api.example.com/v1?key=x', 'not a url']) {
    assert.throws(() => validateBaseUrl(bad), /base_url_invalid/, bad);
  }
});

test('M4: key resolution order and unsafe key files', { skip: !posix && 'POSIX permission semantics' }, () => {
  const cwd = tmpDir('mr-key-cwd-');
  const repoRoot = tmpDir('mr-key-root-');
  const none = resolveModelApiKey({ provider: 'moonshotai-cn', env: {}, cwd, repoRoot });
  assert.deepEqual(none, { key: null, source: 'none' });

  fs.writeFileSync(path.join(repoRoot, MODEL_API_KEY_FILE), 'sk-from-root\n', { mode: 0o600 });
  assert.deepEqual(resolveModelApiKey({ provider: 'x', env: {}, cwd, repoRoot }), { key: 'sk-from-root', source: 'file' });
  fs.writeFileSync(path.join(cwd, MODEL_API_KEY_FILE), 'sk-from-cwd', { mode: 0o600 });
  assert.equal(resolveModelApiKey({ provider: 'x', env: {}, cwd, repoRoot }).key, 'sk-from-cwd');
  assert.equal(resolveModelApiKey({ provider: 'x', env: { [MODEL_API_KEY_ENV]: 'sk-env' }, cwd, repoRoot }).key, 'sk-env');

  // DeepSeek keeps its existing credential contract (env / .deepseek_api_key) ahead of the generic file.
  const dsCwd = tmpDir('mr-key-ds-');
  fs.writeFileSync(path.join(dsCwd, '.deepseek_api_key'), 'sk-deepseek-file', { mode: 0o600 });
  assert.equal(resolveModelApiKey({ provider: 'deepseek', env: {}, cwd: dsCwd, repoRoot }).key, 'sk-deepseek-file');
  assert.equal(resolveModelApiKey({ provider: 'deepseek', env: { DEEPSEEK_API_KEY: 'sk-ds-env' }, cwd: dsCwd, repoRoot }).key, 'sk-ds-env');
  // ...but a custom endpoint named "deepseek" does not receive the DeepSeek key.
  assert.equal(resolveModelApiKey({ provider: 'deepseek', custom: true, env: {}, cwd: dsCwd, repoRoot: tmpDir('mr-key-empty-') }).key, null);

  const loose = tmpDir('mr-key-loose-');
  fs.writeFileSync(path.join(loose, MODEL_API_KEY_FILE), 'sk-loose', { mode: 0o644 });
  fs.chmodSync(path.join(loose, MODEL_API_KEY_FILE), 0o644);
  assert.throws(() => resolveModelApiKey({ provider: 'x', env: {}, cwd: loose, repoRoot }), /0600/);

  const linked = tmpDir('mr-key-link-');
  fs.symlinkSync(path.join(cwd, MODEL_API_KEY_FILE), path.join(linked, MODEL_API_KEY_FILE));
  assert.throws(() => resolveModelApiKey({ provider: 'x', env: {}, cwd: linked, repoRoot }), /regular file/);
});

test('M5: the default DeepSeek request keeps the historical shape; the key appears only in the header', async () => {
  const { runtime, calls } = await fakeModelRuntime('{"ok":true}');
  assert.equal(runtime.runtimeId, 'deepseek-api-tool-less');
  assert.equal(runtime.model, 'deepseek-v4-pro');
  assert.deepEqual(await runtime.completeJson({ system: 's', user: 'u' }), { ok: true });
  const [call] = calls;
  assert.equal(call.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(call.body.model, 'deepseek-v4-pro');
  assert.deepEqual(call.body.thinking, { type: 'disabled' });
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.equal(call.body.temperature, 0);
  assert.equal(call.body.tools, undefined);
  assert.equal(call.headers.authorization, `Bearer ${TEST_API_KEY}`);
  assert.equal(call.rawBody.includes(TEST_API_KEY), false);
});

test('M6: a custom OpenAI-compatible endpoint (local proxy) gets the request; fenced JSON is accepted', async () => {
  const { runtime, calls } = await fakeModelRuntime('```json\n{"main":[]}\n```', {
    spec: 'antigravity/claude-sonnet-4-6',
    baseUrl: 'http://127.0.0.1:8045/v1',
  });
  assert.equal(runtime.runtimeId, 'antigravity-api-tool-less');
  assert.equal(runtime.endpoint, 'http://127.0.0.1:8045/v1');
  assert.deepEqual(await runtime.completeJson({ system: 's', user: 'u' }), { main: [] });
  assert.equal(calls[0].url, 'http://127.0.0.1:8045/v1/chat/completions');
  assert.equal(calls[0].body.model, 'claude-sonnet-4-6');
  assert.equal(calls[0].body.max_tokens > 0, true, 'custom endpoints get the widely supported max_tokens field');
  assert.equal(calls[0].body.temperature, 0);
  assert.equal(calls[0].body.response_format, undefined);
  assert.equal(calls[0].body.tools, undefined);
  await assert.rejects(() => createModelRuntime({ spec: 'x/y', baseUrl: 'http://example.com/v1' }), /base_url_invalid/);
});

test('M7: failure classes — what is retried and what is not', async () => {
  const cases = [
    { name: '401', reply: { status: 401 }, kind: 'http_401', calls: 1 },
    { name: '400', reply: { status: 400 }, kind: 'http_400', calls: 1 },
    { name: 'truncated', reply: { text: '{"a":1}', finish: 'length' }, kind: 'truncated', calls: 1 },
    { name: 'tool call', reply: { toolCall: true }, kind: 'tool_call', calls: 1 },
    { name: '503', reply: { status: 503 }, kind: 'http_503', calls: 3 },
    { name: '429', reply: { status: 429 }, kind: 'http_429', calls: 3 },
    { name: 'network', reply: { reject: new Error('ECONNRESET') }, kind: 'transport', calls: 3 },
    { name: 'invalid json', reply: 'not json at all', kind: 'invalid_json', calls: 3 },
    { name: 'empty', reply: '  ', kind: 'empty', calls: 3 },
  ];
  for (const c of cases) {
    const { runtime, calls } = await fakeModelRuntime(c.reply, { maxAttempts: 3 });
    await assert.rejects(
      () => runtime.completeJson({ system: 's', user: 'u', label: 'probe' }),
      (e) => e.code === 'runtime_unavailable' && e.kind === c.kind && /^runtime_unavailable: probe via deepseek\/deepseek-v4-pro failed/.test(e.message),
      c.name,
    );
    assert.equal(calls.length, c.calls, c.name);
  }

  // A transient failure followed by success is recovered within the attempt budget.
  const { runtime: flaky, calls: flakyCalls } = await fakeModelRuntime((_b, { call }) => (call === 1 ? { status: 503 } : '{"ok":1}'), { maxAttempts: 3 });
  assert.deepEqual(await flaky.completeJson({ system: 's', user: 'u' }), { ok: 1 });
  assert.equal(flakyCalls.length, 2);

  // Empty input is refused before any request.
  const { runtime: guarded, calls: none } = await fakeModelRuntime('{}');
  await assert.rejects(() => guarded.analyze({ projection: '   ' }), (e) => e.kind === 'empty_input');
  assert.equal(none.length, 0);
});

test('M7b: a stream that sends headers and then nothing ends as a timeout, not a hang', async () => {
  const started = Date.now();
  const { runtime } = await fakeModelRuntime({ hang: true }, { idleTimeoutMs: 300, maxAttempts: 1 });
  await assert.rejects(() => runtime.completeText({ system: 's', user: 'u' }), (e) => e.kind === 'timeout');
  assert.ok(Date.now() - started < 5000, 'the idle timeout must fire promptly');
});

test('M8: provider error text that echoes the key never reaches the error message', async () => {
  const { runtime } = await fakeModelRuntime({ status: 401, body: { error: { message: `Authentication Fails, your api key ${TEST_API_KEY} is invalid` } } });
  await assert.rejects(() => runtime.completeText({ system: 's', user: 'u' }), (e) => {
    assert.equal(String(e.message).includes(TEST_API_KEY), false);
    assert.equal(String(e.message).includes('Authentication Fails'), false);
    return e.kind === 'http_401';
  });
});

test('M9: analyze/synthesize send the T13/T14 prompts; usage is recorded per call without the key', async () => {
  const usageSink = [];
  const seen = [];
  const fetchImpl = fakeModelFetch((body) => {
    seen.push(messagesOf(body));
    return { text: '{"families":[],"unresolvedClaimIds":[],"main":[]}', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  });
  const runtime = await createModelRuntime({ apiKey: TEST_API_KEY, fetchImpl, usageSink, maxAttempts: 1 });
  await runtime.analyze({ projection: '[BEGIN UNTRUSTED_DATA token=1] x [END UNTRUSTED_DATA token=1]' });
  await runtime.synthesize({ claims: [{ claimId: 'c-1', groupId: 'g', kind: 'main', statement: 's' }] });
  assert.equal(seen[0].system, CLAIMS_SYSTEM_PROMPT);
  assert.ok(seen[0].user.includes('UNTRUSTED_DATA token=1'));
  assert.equal(seen[1].system, SYNTHESIS_SYSTEM_PROMPT);
  assert.deepEqual(JSON.parse(seen[1].user).claims[0].claimId, 'c-1');
  assert.deepEqual(usageSink.map((u) => u.label), ['analyze', 'synthesize']);
  assert.equal(usageSink[0].totalTokens, 15);
  assert.equal(usageSink[0].provider, 'deepseek');
  assert.equal(JSON.stringify(usageSink).includes(TEST_API_KEY), false);
});

test('M10: unknown provider or model fails closed with model_not_found', async () => {
  await assert.rejects(() => createModelRuntime({ spec: 'no-such-provider/x', apiKey: 'k' }), /model_not_found: unknown provider/);
  await assert.rejects(() => createModelRuntime({ spec: 'deepseek/no-such-model', apiKey: 'k' }), /model_not_found: provider "deepseek" has no model/);
  const rt = await createModelRuntime({ spec: 'moonshotai-cn/kimi-k2.6', apiKey: 'k' });
  assert.deepEqual({ runtimeId: rt.runtimeId, model: rt.model }, { runtimeId: 'moonshotai-cn-api-tool-less', model: 'kimi-k2.6' });
});
