/**
 * research-orchestration/test/planner.test.mjs
 *
 * P1-T18 focused tests — Research Planner Semantic Proposal (Issue #50,
 * Spec §4 / §5.2 / §10 of docs/specs/p1-cross-question-deep-research.md).
 *
 * The planner is controller-owned orchestration: USER_REQUEST → approved
 * deepseek-api-tool-less SemanticRuntime (tool-less channel discipline) →
 * semantic plan proposal → EXISTING T04 structured validation (plan-contract.mjs,
 * unchanged) → persisted Research Plan / planHash.
 *
 * Required coverage (ticket REQUIRED_TESTS):
 *   1. semantic proposal → validation round-trip (persisted artifact + stable planHash)
 *   2. six conceptual field classes preserved (Spec §4.1)
 *   3. invalid / unparseable plan → planner_invalid FAIL_CLOSED (nothing persisted)
 *   4. runtime failure propagation (transport / HTTP / envelope / credential) —
 *      FAIL_CLOSED + NO_SILENT_RUNTIME_FALLBACK
 *   5. runtime identity recorded faithfully
 *   6. credentials never enter prompt / output / state
 *   7. USER_REQUEST input validation (Spec §10.1 class; not UNTRUSTED_CORPUS)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PLANNER_RUNTIME_ID,
  PLANNER_FAILURE_USER_REQUEST_INVALID,
  PLANNER_FAILURE_RUNTIME_UNAVAILABLE,
  PLANNER_FAILURE_PLANNER_INVALID,
  proposeResearchPlan,
} from '../lib/planner.mjs';
import {
  PLAN_ARTIFACT_FILENAME,
  PLAN_FAILURE_PLANNER_INVALID,
  loadPlan,
  planHash,
} from '../lib/plan-contract.mjs';

// ---------------------------------------------------------------------------
// helpers (injectable seams, mirroring corpus-anthology/lib/deepseek-tool-less.mjs)
// ---------------------------------------------------------------------------

const CREDENTIAL = Object.freeze({
  source: 'env', configured: true, usable: true, error: 'none', key: 'sk-fake-test-key-000',
});

const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

function tmpWorkDir(prefix = 'planner-t18') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

/** Valid plan JSON text covering all six conceptual field classes (Spec §4.1). */
const VALID_PLAN_TEXT = JSON.stringify({
  schemaVersion: 1,
  queryVariants: ['大语言模型 Agent 落地争议', 'LLM agent adoption debate'],
  aspects: ['技术成熟度', '行业落地现状'],
  entities: ['OpenAI', 'Anthropic'],
  opposingFramings: ['Agent 已可大规模落地', 'Agent 仍不成熟'],
  terminologyVariants: [{ term: 'Agent', variants: ['智能体', '代理'] }],
  sourceGroupIntents: [
    { intent: '关注反方观点', constraints: ['至少包含一个高赞反对回答'], groupKey: 'controversy' },
  ],
});

/** DeepSeek chat-completion envelope shaped exactly like the reviewed runtime returns. */
function deepseekEnvelope(contentText, { model = DEEPSEEK_MODEL, finish = 'stop', toolCalls = undefined } = {}) {
  return {
    object: 'chat.completion',
    model,
    choices: [
      {
        message: { role: 'assistant', content: contentText, ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}) },
        finish_reason: finish,
      },
    ],
  };
}

/** Deterministic fetchImpl: captures calls, returns a fixed payload/status. */
function fakeFetch(payload, { status = 200, capture = null, reject = null, jsonThrows = false } = {}) {
  return async (url, init) => {
    if (capture) capture.push({ url, init });
    if (reject) throw reject;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (jsonThrows) throw new Error('invalid json');
        return payload;
      },
    };
  };
}

// ---------------------------------------------------------------------------
// 1. semantic proposal → T04 validation round-trip (persisted plan + planHash)
// ---------------------------------------------------------------------------

test('P1-T18: valid semantic proposal passes existing T04 validation and is persisted with planHash', async () => {
  const workDir = tmpWorkDir();
  const capture = [];
  const res = await proposeResearchPlan({
    userRequest: '研究一下大家怎么看大语言模型 Agent 的落地争议',
    workDir,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT), { capture }),
    credential: CREDENTIAL,
  });

  assert.equal(res.ok, true);
  assert.equal(res.file, PLAN_ARTIFACT_FILENAME);

  // Persisted artifact re-validates through the EXISTING T04 contract (no bypass).
  const loaded = loadPlan(workDir);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.planHash, res.planHash);
  // planHash recomputed independently through the T04 contract matches.
  assert.equal(res.planHash, planHash(loaded.plan));

  // Exactly the pinned approved endpoint was called (tool-less channel discipline).
  assert.equal(capture.length, 1);
  assert.equal(capture[0].url, DEEPSEEK_ENDPOINT);
  const body = JSON.parse(capture[0].init.body);
  assert.equal(body.model, DEEPSEEK_MODEL);
  assert.equal(body.response_format.type, 'json_object');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.tools, undefined);
});

test('P1-T18: persisted plan keeps all six conceptual field classes (Spec §4.1)', async () => {
  const workDir = tmpWorkDir();
  const res = await proposeResearchPlan({
    userRequest: '跨问题研究：中文 NLP 开源社区生态',
    workDir,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT)),
    credential: CREDENTIAL,
  });
  assert.equal(res.ok, true);
  const loaded = loadPlan(workDir);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.plan.schemaVersion, 1);
  assert.deepEqual(loaded.plan.queryVariants, JSON.parse(VALID_PLAN_TEXT).queryVariants);
  assert.deepEqual(loaded.plan.aspects, JSON.parse(VALID_PLAN_TEXT).aspects);
  assert.deepEqual(loaded.plan.entities, JSON.parse(VALID_PLAN_TEXT).entities);
  assert.deepEqual(loaded.plan.opposingFramings, JSON.parse(VALID_PLAN_TEXT).opposingFramings);
  assert.deepEqual(loaded.plan.terminologyVariants, JSON.parse(VALID_PLAN_TEXT).terminologyVariants);
  assert.deepEqual(loaded.plan.sourceGroupIntents, JSON.parse(VALID_PLAN_TEXT).sourceGroupIntents);
});

test('P1-T18: planner prompt names the exact plan schema and data-only task', async () => {
  const workDir = tmpWorkDir();
  const capture = [];
  await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论',
    workDir,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT), { capture }),
    credential: CREDENTIAL,
  });
  const body = JSON.parse(capture[0].init.body);
  const [system, user] = body.messages;
  assert.equal(system.role, 'system');
  for (const key of ['schemaVersion', 'queryVariants', 'aspects', 'entities', 'opposingFramings', 'terminologyVariants', 'sourceGroupIntents']) {
    assert.ok(system.content.includes(key), `system prompt must name plan key: ${key}`);
  }
  assert.ok(/never call tools/i.test(system.content));
  assert.ok(/json/i.test(system.content)); // DeepSeek JSON-mode guide requirement
  assert.equal(user.role, 'user');
  const userData = JSON.parse(user.content);
  assert.equal(userData.userRequest, '研究知乎上对量化交易的讨论');
});

// ---------------------------------------------------------------------------
// 2. invalid / unparseable plan → planner_invalid FAIL_CLOSED (nothing persisted)
// ---------------------------------------------------------------------------

test('P1-T18: natural-language free text output → planner_invalid, nothing persisted', async () => {
  const workDir = tmpWorkDir();
  const res = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论',
    workDir,
    fetchImpl: fakeFetch(deepseekEnvelope('我不能帮助完成这个请求。')),
    credential: CREDENTIAL,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.equal(res.reason, 'planner_invalid');
  assert.ok(Array.isArray(res.issues) && res.issues.length > 0);
  assert.equal(fs.existsSync(path.join(workDir, PLAN_ARTIFACT_FILENAME)), false);
  assert.equal(loadPlan(workDir).ok, false);
});

test('P1-T18: schema-invalid plan output (unknown field / missing field) → planner_invalid', async () => {
  const workDirA = tmpWorkDir();
  const badUnknown = JSON.stringify({ ...JSON.parse(VALID_PLAN_TEXT), extraField: ['nope'] });
  const resA = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir: workDirA,
    fetchImpl: fakeFetch(deepseekEnvelope(badUnknown)), credential: CREDENTIAL,
  });
  assert.equal(resA.ok, false);
  assert.equal(resA.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.equal(fs.existsSync(path.join(workDirA, PLAN_ARTIFACT_FILENAME)), false);

  const workDirB = tmpWorkDir();
  const { sourceGroupIntents: _dropped, ...missingField } = JSON.parse(VALID_PLAN_TEXT);
  const resB = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir: workDirB,
    fetchImpl: fakeFetch(deepseekEnvelope(JSON.stringify(missingField))), credential: CREDENTIAL,
  });
  assert.equal(resB.ok, false);
  assert.equal(resB.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.equal(fs.existsSync(path.join(workDirB, PLAN_ARTIFACT_FILENAME)), false);
});

test('P1-T18: unparseable JSON content → planner_invalid (plan quality, not channel failure)', async () => {
  const workDir = tmpWorkDir();
  const res = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir,
    fetchImpl: fakeFetch(deepseekEnvelope('{"schemaVersion": 1, "queryVariants": [')), credential: CREDENTIAL,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.equal(fs.existsSync(path.join(workDir, PLAN_ARTIFACT_FILENAME)), false);
});

// ---------------------------------------------------------------------------
// 3. runtime failure propagation — FAIL_CLOSED + NO_SILENT_RUNTIME_FALLBACK
// ---------------------------------------------------------------------------

test('P1-T18: transport failure / HTTP error / non-JSON payload → runtime_unavailable', async () => {
  const common = { userRequest: '研究知乎上对量化交易的讨论', credential: CREDENTIAL };

  const workDirA = tmpWorkDir();
  const resA = await proposeResearchPlan({
    ...common, workDir: workDirA,
    fetchImpl: fakeFetch(null, { reject: new Error('ECONNREFUSED') }),
  });
  assert.equal(resA.ok, false);
  assert.equal(resA.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE);
  assert.match(resA.details, /transport failed/);
  assert.equal(fs.existsSync(path.join(workDirA, PLAN_ARTIFACT_FILENAME)), false);

  const workDirB = tmpWorkDir();
  const resB = await proposeResearchPlan({ ...common, workDir: workDirB, fetchImpl: fakeFetch(null, { status: 500 }) });
  assert.equal(resB.ok, false);
  assert.equal(resB.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE);
  assert.match(resB.details, /HTTP 500/);

  const workDirC = tmpWorkDir();
  const resC = await proposeResearchPlan({ ...common, workDir: workDirC, fetchImpl: fakeFetch(null, { jsonThrows: true }) });
  assert.equal(resC.ok, false);
  assert.equal(resC.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE);
  assert.match(resC.details, /non-JSON data/);
});

test('P1-T18: envelope contract violations → runtime_unavailable (isolation/channel failures)', async () => {
  const common = { userRequest: '研究知乎上对量化交易的讨论', credential: CREDENTIAL, fetchImpl: null };
  const cases = [
    { name: 'wrong model identity', payload: deepseekEnvelope(VALID_PLAN_TEXT, { model: 'some-other-model' }) },
    { name: 'truncated completion', payload: deepseekEnvelope(VALID_PLAN_TEXT, { finish: 'length' }) },
    { name: 'model-visible tool call', payload: deepseekEnvelope(VALID_PLAN_TEXT, { toolCalls: [{ id: '1', type: 'function', function: { name: 'x', arguments: '{}' } }] }) },
    { name: 'empty assistant content', payload: deepseekEnvelope('   ') },
    { name: 'missing assistant message', payload: { object: 'chat.completion', model: DEEPSEEK_MODEL, choices: [{ message: null, finish_reason: 'stop' }] } },
    { name: 'multiple choices', payload: { object: 'chat.completion', model: DEEPSEEK_MODEL, choices: [deepseekEnvelope(VALID_PLAN_TEXT).choices[0], deepseekEnvelope(VALID_PLAN_TEXT).choices[0]] } },
  ];
  for (const c of cases) {
    const workDir = tmpWorkDir();
    const res = await proposeResearchPlan({ ...common, workDir, fetchImpl: fakeFetch(c.payload) });
    assert.equal(res.ok, false, c.name);
    assert.equal(res.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE, c.name);
    assert.equal(fs.existsSync(path.join(workDir, PLAN_ARTIFACT_FILENAME)), false, c.name);
  }
});

test('P1-T18: credential unusable → runtime_unavailable before any egress', async () => {
  const workDir = tmpWorkDir();
  const capture = [];
  const res = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT), { capture }),
    credential: { source: 'file', configured: false, usable: false, error: 'missing', key: null },
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE);
  assert.match(res.details, /credential is not configured or not usable/);
  assert.equal(capture.length, 0); // no egress attempted
  assert.equal(fs.existsSync(path.join(workDir, PLAN_ARTIFACT_FILENAME)), false);
});

test('P1-T18: unsupported runtime → runtime_unavailable, fetch never called (NO_SILENT_RUNTIME_FALLBACK)', async () => {
  const workDir = tmpWorkDir();
  const capture = [];
  const res = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir,
    runtime: { runtimeId: 'lmstudio-local-tool-less', model: 'qwen/qwen3-1.7b', thinking: 'disabled', endpoint: 'http://127.0.0.1:1234/v1/chat/completions', jsonMode: 'json_object', tools: 'none' },
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT), { capture }),
    credential: CREDENTIAL,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE);
  assert.match(res.details, /does not exactly match the approved deepseek-api-tool-less runtime/);
  assert.equal(capture.length, 0); // never re-routed to another runtime
  assert.equal(fs.existsSync(path.join(workDir, PLAN_ARTIFACT_FILENAME)), false);
});

// ---------------------------------------------------------------------------
// 4. runtime identity recording
// ---------------------------------------------------------------------------

test('P1-T18: runtime identity recorded faithfully on success and on failures', async () => {
  const expected = { runtimeId: 'deepseek-api-tool-less', model: DEEPSEEK_MODEL };

  const workDirA = tmpWorkDir();
  const ok = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir: workDirA,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT)), credential: CREDENTIAL,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.runtime, expected);

  const workDirB = tmpWorkDir();
  const badPlan = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir: workDirB,
    fetchImpl: fakeFetch(deepseekEnvelope('free text')), credential: CREDENTIAL,
  });
  assert.equal(badPlan.ok, false);
  assert.deepEqual(badPlan.runtime, expected);

  const workDirC = tmpWorkDir();
  const noCred = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir: workDirC,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT)),
    credential: { source: 'file', configured: false, usable: false, error: 'missing', key: null },
  });
  assert.equal(noCred.ok, false);
  assert.deepEqual(noCred.runtime, expected);
});

// ---------------------------------------------------------------------------
// 5. credentials never enter prompt / output / state
// ---------------------------------------------------------------------------

test('P1-T18: credential key never appears in request messages, body, artifact, or result', async () => {
  const workDir = tmpWorkDir();
  const capture = [];
  const res = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT), { capture }), credential: CREDENTIAL,
  });
  assert.equal(res.ok, true);
  assert.equal(capture.length, 1);
  const { init } = capture[0];
  // Authorization header carries the key (transport-only usage).
  assert.equal(init.headers.authorization, `Bearer ${CREDENTIAL.key}`);
  // ...but the key never appears anywhere else.
  const bodyText = init.body;
  assert.equal(bodyText.includes(CREDENTIAL.key), false);
  const parsed = JSON.parse(bodyText);
  assert.equal(JSON.stringify(parsed.messages).includes(CREDENTIAL.key), false);
  const artifactText = fs.readFileSync(path.join(workDir, PLAN_ARTIFACT_FILENAME), 'utf8');
  assert.equal(artifactText.includes(CREDENTIAL.key), false);
  assert.equal(JSON.stringify(res).includes(CREDENTIAL.key), false);
});

test('P1-T18: credential-shaped USER_REQUEST → user_request_invalid before any egress', async () => {
  const workDir = tmpWorkDir();
  const capture = [];
  const res = await proposeResearchPlan({
    userRequest: '用这个 key 帮我查: token: sk-abc123secret', workDir,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT), { capture }), credential: CREDENTIAL,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_USER_REQUEST_INVALID);
  assert.equal(res.reason, 'user_request_invalid');
  assert.ok(res.issues.some((i) => /credential-shape/i.test(i.message)));
  assert.equal(capture.length, 0);
  assert.equal(fs.existsSync(path.join(workDir, PLAN_ARTIFACT_FILENAME)), false);
});

// ---------------------------------------------------------------------------
// 6. USER_REQUEST input validation (Spec §10.1)
// ---------------------------------------------------------------------------

test('P1-T18: USER_REQUEST deterministic validation boundaries', async () => {
  const credential = CREDENTIAL;
  const cases = [
    { name: 'empty', input: '   ' },
    { name: 'non-string', input: 42 },
    { name: 'too long', input: '研'.repeat(2001) },
    { name: 'control characters', input: '研究\u0000知乎' },
    { name: 'machine-private path', input: '研究 /Users/someone/secrets 里的项目' },
  ];
  for (const c of cases) {
    const res = await proposeResearchPlan({
      userRequest: c.input, workDir: tmpWorkDir(),
      fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT)), credential,
    });
    assert.equal(res.ok, false, c.name);
    assert.equal(res.reason, PLANNER_FAILURE_USER_REQUEST_INVALID, c.name);
  }
  // Legitimate multiline request with tab/newline is accepted (encoding hygiene,
  // not corpus sanitization — §10.1: USER_REQUEST is not UNTRUSTED_CORPUS).
  const workDir = tmpWorkDir();
  const ok = await proposeResearchPlan({
    userRequest: '研究两个问题：\n1. 量化交易入门\t2. 量化交易风险', workDir,
    fetchImpl: fakeFetch(deepseekEnvelope(VALID_PLAN_TEXT)), credential,
  });
  assert.equal(ok.ok, true);
});

// ---------------------------------------------------------------------------
// 7. §10 non-sensitive usage evidence (contract unchanged)
// ---------------------------------------------------------------------------

test('P1-T18: usageSink collects non-sensitive token/timing evidence when reported', async () => {
  const workDir = tmpWorkDir();
  const usageSink = [];
  const payload = deepseekEnvelope(VALID_PLAN_TEXT);
  payload.usage = { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 };
  const res = await proposeResearchPlan({
    userRequest: '研究知乎上对量化交易的讨论', workDir,
    fetchImpl: fakeFetch(payload), credential: CREDENTIAL, usageSink,
  });
  assert.equal(res.ok, true);
  assert.equal(usageSink.length, 1);
  assert.equal(usageSink[0].model, DEEPSEEK_MODEL);
  assert.equal(usageSink[0].totalTokens, 200);
  assert.equal(typeof usageSink[0].ms, 'number');
  assert.equal(JSON.stringify(usageSink).includes(CREDENTIAL.key), false);
});
