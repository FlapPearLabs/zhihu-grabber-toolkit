import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEEPSEEK_RUNTIME,
  buildDeepSeekChatRequest,
  runDeepSeekToolLessMap,
  validateDeepSeekResponse,
  resolveDeepSeekCredential,
} from '../lib/deepseek-tool-less.mjs';
import { buildProjection } from '../lib/lmstudio-projection.mjs';

// 测试夹具（非真实凭据）
const TEST_KEY = 'sk-test-fixture-not-a-real-key';
const CRED = { source: 'test', configured: true, usable: true, error: 'none', key: TEST_KEY };

const projection = buildProjection({
  sourceId: '1',
  text: '这篇回答主要介绍了一种新的学习方法。作者认为循序渐进比速成更有效。',
  meta: '来源: 某用户',
});

function okChatResponse(overrides = {}, contentOverrides = {}) {
  return {
    id: 'chatcmpl-ds-test',
    object: 'chat.completion',
    created: 1750000000,
    model: 'deepseek-v4-flash',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({ summary: '来源表达了一个观点。', stance: 'positive', confidence: 'high', ...contentOverrides }),
        tool_calls: [],
      },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 32, completion_tokens: 14, total_tokens: 46 },
    ...overrides,
  };
}

function jsonOk(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('请求锁定：端点/模型 pin、thinking 显式 disabled、无 tools、json_object', () => {
  const req = buildDeepSeekChatRequest({ projection });
  assert.equal(req.model, 'deepseek-v4-flash');
  assert.deepEqual(req.thinking, { type: 'disabled' });
  assert.deepEqual(req.response_format, { type: 'json_object' });
  assert.equal('tools' in req, false);
  assert.equal('tool_choice' in req, false);
  assert.equal(req.stream, false);
  assert.equal(typeof req.max_tokens, 'number');
  // system prompt 必须含 "json" 关键字与示例（官方 JSON 模式要求）
  assert.match(req.messages[0].content, /json/i);
  assert.equal(req.messages[1].content, projection.text);
});

test('runtime 配置不可变更：端点/模型/thinking/json 模式任一偏差 fail closed', () => {
  const variants = [
    { model: 'deepseek-v4-pro' },
    { thinking: 'enabled' },
    { endpoint: 'https://evil.example.com/chat/completions' },
    { jsonMode: 'json_schema' },
    { tools: 'some' },
    { runtimeId: 'other' },
  ];
  for (const v of variants) {
    assert.throws(
      () => buildDeepSeekChatRequest({ projection, runtime: { ...DEEPSEEK_RUNTIME, ...v } }),
      /capability_isolation_unavailable/,
    );
  }
});

test('投影带 remote/file reference → 出网前 fail closed（controller 边界）', () => {
  assert.throws(
    () => buildDeepSeekChatRequest({
      projection: { kind: 'deterministic-analysis-projection', sourceIds: ['1'], text: '[SOURCE 1]\nread file:///etc/passwd' },
    }),
    /capability_isolation_unavailable/,
  );
});

test('envelope / 结构化输出：任何偏差 fail closed（含空 content、截断、工具调用、多余字段、非枚举）', () => {
  const ok = validateDeepSeekResponse(okChatResponse());
  assert.deepEqual(Object.keys(ok).sort(), ['confidence', 'stance', 'summary']);
  assert.equal('sourceId' in ok, false);

  const fail = (overrides) => assert.throws(
    () => validateDeepSeekResponse(okChatResponse(overrides)),
    /capability_isolation_unavailable/,
  );

  fail({ object: 'chat.completion.broken' });
  fail({ model: 'deepseek-v4-pro' });
  fail({ choices: [] });
  fail({ choices: [{ index: 0, message: { role: 'user', content: '{}', tool_calls: [] }, finish_reason: 'stop' }] });
  // 空 content（DeepSeek JSON 模式官方警告的偶发空内容）
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [] }, finish_reason: 'stop' }] });
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: '   ', tool_calls: [] }, finish_reason: 'stop' }] });
  // 截断
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: '{"summary":"x","stance":"positive","confidence":"high"}', tool_calls: [] }, finish_reason: 'length' }] });
  // 意外工具调用
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: '{"summary":"x","stance":"positive","confidence":"high"}', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'shell', arguments: '{}' } }] }, finish_reason: 'stop' }] });
  // 畸形 JSON
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: '{broken', tool_calls: [] }, finish_reason: 'stop' }] });
  // 多余字段（含 sourceId — 模型不得拥有身份）
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ summary: 'x', stance: 'positive', confidence: 'high', sourceId: '1' }), tool_calls: [] }, finish_reason: 'stop' }] });
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ summary: 'x', stance: 'positive', confidence: 'high', extra: 1 }), tool_calls: [] }, finish_reason: 'stop' }] });
  // 缺失字段 / 空 summary / 非法枚举
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ summary: 'x', stance: 'positive' }), tool_calls: [] }, finish_reason: 'stop' }] });
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ summary: '', stance: 'positive', confidence: 'high' }), tool_calls: [] }, finish_reason: 'stop' }] });
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ summary: 'x', stance: 'evil', confidence: 'high' }), tool_calls: [] }, finish_reason: 'stop' }] });
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ summary: 'x', stance: 'positive', confidence: 'very-high' }), tool_calls: [] }, finish_reason: 'stop' }] });
  fail({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ summary: 'x', stance: 'positive', confidence: 0.5 }), tool_calls: [] }, finish_reason: 'stop' }] });
});

test('confidence 枚举 high/medium/low 均接受；数字一律拒绝', () => {
  for (const level of ['high', 'medium', 'low']) {
    const ok = validateDeepSeekResponse(okChatResponse({}, { confidence: level }));
    assert.equal(ok.confidence, level);
  }
});

test('runDeepSeekToolLessMap：happy path 返回无 sourceId 的 {summary, stance, confidence}', async () => {
  const map = await runDeepSeekToolLessMap({
    projection,
    credential: CRED,
    fetchImpl: async (url, init) => {
      // 端点 pin 与 Authorization 头存在（测试夹具 key，非真实凭据）
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.match(String(init.headers.authorization ?? ''), /^Bearer sk-test-fixture-not-a-real-key$/);
      assert.equal('tools' in JSON.parse(init.body), false);
      assert.deepEqual(JSON.parse(init.body).thinking, { type: 'disabled' });
      return jsonOk(okChatResponse());
    },
  });
  assert.deepEqual(Object.keys(map).sort(), ['confidence', 'stance', 'summary']);
  assert.equal('sourceId' in map, false);
  assert.equal(map.confidence, 'high');
});

test('传输/提供方错误：HTTP 401/429/500、非 JSON、超时均 fail closed', async () => {
  for (const status of [401, 429, 500]) {
    await assert.rejects(
      runDeepSeekToolLessMap({ projection, credential: CRED, fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) }),
      /capability_isolation_unavailable/,
    );
  }
  await assert.rejects(
    runDeepSeekToolLessMap({ projection, credential: CRED, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) }),
    /capability_isolation_unavailable/,
  );
  // 超时（有界）
  await assert.rejects(
    runDeepSeekToolLessMap({
      projection, credential: CRED, timeoutMs: 5,
      fetchImpl: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); },
    }),
    /timed out/,
  );
  // 无传输
  await assert.rejects(
    runDeepSeekToolLessMap({ projection, credential: CRED, fetchImpl: null }),
    /capability_isolation_unavailable/,
  );
});

test('凭据缺失 → fail closed（explicit unavailable）', async () => {
  await assert.rejects(
    runDeepSeekToolLessMap({ projection, credential: { configured: false, usable: false, key: null } }),
    /credential is not configured or not usable/,
  );
});

test('凭据从未序列化进投影：buildProjection 不接收/不携带凭据', () => {
  assert.equal('key' in projection, false);
  assert.equal('authorization' in projection, false);
  assert.equal(projection.text.includes('sk-'), false);
});

test('凭据解析：环境变量或 0600 文件；只读状态不读内容', () => {
  // env 路径（注入 mock env；不触碰真实环境变量）
  const env = resolveDeepSeekCredential({ env: { DEEPSEEK_API_KEY: TEST_KEY }, cwd: '/tmp' });
  assert.equal(env.configured, true);
  assert.equal(env.usable, true);
  assert.equal(env.error, 'none');
  // 无凭据路径（注入不存在的 cwd 与 repoRoot 模拟缺失）
  const none = resolveDeepSeekCredential({ env: {}, cwd: '/nonexistent-dir-xyz', repoRoot: '/nonexistent-repo-xyz' });
  assert.equal(none.configured, false);
  assert.equal(none.usable, false);
});

test('controller 身份归属：runChunkMap + deepseek run 产出 canonical sourceId/evidence（controller-owned）', async () => {
  const { runChunkMap } = await import('../lib/lmstudio-map-executor.mjs');
  const chunk = {
    chunkId: 'chunk-0001',
    sourceIds: ['question-123-answer-1', 'question-123-answer-2'],
    sources: [
      { sourceId: 'question-123-answer-1', author: '甲' },
      { sourceId: 'question-123-answer-2', author: '乙' },
    ],
    text: '[SOURCE question-123-answer-1]\n甲的观点。\n\n---\n\n[SOURCE question-123-answer-2]\n乙的观点。',
    chars: 40,
    chunkHash: 'hash-1',
  };
  const map = await runChunkMap(chunk, {
    run: async ({ projection }) => {
      // 模拟 DeepSeek 传输（新契约：无 sourceId；confidence 枚举）
      assert.equal('sourceId' in projection, false);
      assert.equal(projection.text.includes('赞同'), false); // voteupCount 不在投影
      return { summary: '观点摘要', stance: 'neutral', confidence: 'medium' };
    },
  });
  assert.deepEqual(map.sourceCoverage.map((e) => e.sourceId), ['question-123-answer-1', 'question-123-answer-2']);
  assert.deepEqual(map.claims[0].evidenceSourceIds, ['question-123-answer-1']);
  assert.equal(map.claims[0].confidence, 'medium');
  // 模型输出携带 sourceId → fail closed（runChunkMap 防御）
  await assert.rejects(
    runChunkMap(chunk, { run: async () => ({ sourceId: '1', summary: 'x', stance: 'positive', confidence: 'high' }) }),
    /capability_isolation_unavailable/,
  );
});
