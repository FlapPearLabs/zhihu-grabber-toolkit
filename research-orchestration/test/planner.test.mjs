/**
 * research-orchestration/test/planner.test.mjs
 *
 * P1-T18 focused tests — Research Planner Semantic Proposal (Issue #50,
 * Spec §4 / §5.2 / §10 of docs/specs/p1-cross-question-deep-research.md).
 *
 * The planner is controller-owned orchestration: USER_REQUEST → research
 * SemanticRuntime (lib/model-runtime.mjs; any provider) → semantic plan
 * proposal → EXISTING T04 structured validation (plan-contract.mjs,
 * unchanged) → persisted Research Plan / planHash.
 *
 * Tests run the REAL model layer over an offline SSE transport
 * (test/helpers/fake-model-transport.mjs): the request body, headers and
 * streamed reply are the actual wire shapes, without network.
 *
 * Required coverage:
 *   1. semantic proposal → validation round-trip (persisted artifact + stable planHash)
 *   2. six conceptual field classes preserved (Spec §4.1)
 *   3. invalid / unparseable plan → planner_invalid FAIL_CLOSED (nothing persisted)
 *   4. runtime failure propagation (transport / HTTP / truncation / tool call /
 *      missing runtime) — FAIL_CLOSED + NO_SILENT_RUNTIME_FALLBACK
 *   5. runtime identity recorded faithfully
 *   6. credentials never enter prompt / output / state
 *   7. USER_REQUEST input validation (Spec §10.1 class; not UNTRUSTED_CORPUS)
 *   8. OWNER RULING 2026-09-10/11 (Issue #48 D1 repair): model-generated
 *      pre-retrieval plans must have groupKey === null (D1-CE1..CE5)
 *   9. D4: constraints must be [] (D4-CE1..CE7)
 *  10. other providers: fenced JSON from non-DeepSeek models, custom endpoint
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PLANNER_FAILURE_USER_REQUEST_INVALID,
  PLANNER_FAILURE_RUNTIME_UNAVAILABLE,
  PLANNER_FAILURE_PLANNER_INVALID,
  buildPlannerSystemPrompt,
  proposeResearchPlan,
} from '../lib/planner.mjs';
import {
  PLAN_ARTIFACT_FILENAME,
  loadPlan,
  planHash,
  validatePlanInput,
} from '../lib/plan-contract.mjs';
import { fakeModelRuntime, messagesOf, TEST_API_KEY } from './helpers/fake-model-transport.mjs';

const DEEPSEEK_MODEL = 'deepseek-v4-pro';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const REQUEST = '研究知乎上对量化交易的讨论';

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
    // groupKey MUST be null and constraints MUST be [] in planner MODEL output
    // (D1 / D4); the generic T04 contract still accepts both for other callers.
    { intent: '关注反方观点', constraints: [], groupKey: null },
  ],
});

/** Run the planner against a runtime whose model replies with `reply`. */
async function plan(reply, { userRequest = REQUEST, workDir = tmpWorkDir(), ...runtimeOpts } = {}) {
  const { runtime, calls } = await fakeModelRuntime(reply, runtimeOpts);
  const res = await proposeResearchPlan({ userRequest, workDir, runtime });
  return { res, calls, workDir };
}

const persisted = (workDir) => fs.existsSync(path.join(workDir, PLAN_ARTIFACT_FILENAME));

// ---------------------------------------------------------------------------
// 1. semantic proposal → T04 validation round-trip (persisted plan + planHash)
// ---------------------------------------------------------------------------

test('P1-T18: valid semantic proposal passes existing T04 validation and is persisted with planHash', async () => {
  const { res, calls, workDir } = await plan(VALID_PLAN_TEXT, { userRequest: '研究一下大家怎么看大语言模型 Agent 的落地争议' });

  assert.equal(res.ok, true);
  assert.equal(res.file, PLAN_ARTIFACT_FILENAME);
  const loaded = loadPlan(workDir);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.planHash, res.planHash);
  assert.equal(res.planHash, planHash(loaded.plan));

  // Default model: the historical DeepSeek request shape, tool-less.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DEEPSEEK_ENDPOINT);
  assert.equal(calls[0].body.model, DEEPSEEK_MODEL);
  assert.equal(calls[0].body.response_format.type, 'json_object');
  assert.deepEqual(calls[0].body.thinking, { type: 'disabled' });
  assert.equal(calls[0].body.temperature, 0);
  assert.equal(calls[0].body.tools, undefined);
});

test('served model string is observability only — a different response.model does not block the planner', async () => {
  const { res } = await plan({ text: VALID_PLAN_TEXT, model: 'deepseek-flash' });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, reason: res.reason, details: res.details }));
});

test('P1-T18: persisted plan keeps all six conceptual field classes (Spec §4.1)', async () => {
  const { res, workDir } = await plan(VALID_PLAN_TEXT, { userRequest: '跨问题研究：中文 NLP 开源社区生态' });
  assert.equal(res.ok, true);
  const loaded = loadPlan(workDir);
  const expected = JSON.parse(VALID_PLAN_TEXT);
  assert.equal(loaded.plan.schemaVersion, 1);
  for (const key of ['queryVariants', 'aspects', 'entities', 'opposingFramings', 'terminologyVariants', 'sourceGroupIntents']) {
    assert.deepEqual(loaded.plan[key], expected[key], key);
  }
});

test('P1-T18: planner prompt names the exact plan schema and data-only task', async () => {
  const { calls } = await plan(VALID_PLAN_TEXT);
  const { system, user } = messagesOf(calls[0].body);
  for (const key of ['schemaVersion', 'queryVariants', 'aspects', 'entities', 'opposingFramings', 'terminologyVariants', 'sourceGroupIntents']) {
    assert.ok(system.includes(key), `system prompt must name plan key: ${key}`);
  }
  assert.ok(/never call tools/i.test(system));
  assert.ok(/json/i.test(system)); // JSON-mode providers require the keyword
  assert.equal(JSON.parse(user).userRequest, REQUEST);
});

// ---------------------------------------------------------------------------
// 2. invalid / unparseable plan → planner_invalid FAIL_CLOSED (nothing persisted)
// ---------------------------------------------------------------------------

test('P1-T18: natural-language free text output → planner_invalid, nothing persisted', async () => {
  const { res, workDir } = await plan('我不能帮助完成这个请求。');
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.ok(Array.isArray(res.issues) && res.issues.length > 0);
  assert.equal(persisted(workDir), false);
  assert.equal(loadPlan(workDir).ok, false);
});

test('P1-T18: schema-invalid plan output (unknown field / missing field) → planner_invalid', async () => {
  const unknown = await plan(JSON.stringify({ ...JSON.parse(VALID_PLAN_TEXT), extraField: ['nope'] }));
  assert.equal(unknown.res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.equal(persisted(unknown.workDir), false);

  const { sourceGroupIntents: _dropped, ...missingField } = JSON.parse(VALID_PLAN_TEXT);
  const missing = await plan(JSON.stringify(missingField));
  assert.equal(missing.res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.equal(persisted(missing.workDir), false);
});

test('P1-T18: unparseable JSON content → planner_invalid (plan quality, not channel failure)', async () => {
  const { res, workDir } = await plan('{"schemaVersion": 1, "queryVariants": [');
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.equal(persisted(workDir), false);
});

// ---------------------------------------------------------------------------
// 3. runtime failure propagation — FAIL_CLOSED + NO_SILENT_RUNTIME_FALLBACK
// ---------------------------------------------------------------------------

test('P1-T18: transport failure / HTTP errors → runtime_unavailable with a typed kind', async () => {
  const cases = [
    { reply: { reject: new Error('ECONNREFUSED') }, kind: /\(transport\)/ },
    { reply: { status: 500 }, kind: /\(http_500\)/ },
    { reply: { status: 401 }, kind: /\(http_401\)/ },
  ];
  for (const c of cases) {
    const { res, workDir } = await plan(c.reply);
    assert.equal(res.ok, false);
    assert.equal(res.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE);
    assert.match(res.details, c.kind);
    assert.equal(persisted(workDir), false);
  }
});

test('P1-T18: channel violations (truncated / tool call / empty reply) → runtime_unavailable', async () => {
  const cases = [
    { name: 'truncated completion', reply: { text: VALID_PLAN_TEXT, finish: 'length' }, kind: /\(truncated\)/ },
    { name: 'model-visible tool call', reply: { toolCall: true }, kind: /\(tool_call\)/ },
    { name: 'empty assistant content', reply: '   ', kind: /\(empty\)/ },
  ];
  for (const c of cases) {
    const { res, workDir } = await plan(c.reply);
    assert.equal(res.ok, false, c.name);
    assert.equal(res.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE, c.name);
    assert.match(res.details, c.kind, c.name);
    assert.equal(persisted(workDir), false, c.name);
  }
});

test('P1-T18: no runtime → runtime_unavailable before any egress', async () => {
  const workDir = tmpWorkDir();
  const res = await proposeResearchPlan({ userRequest: REQUEST, workDir });
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE);
  assert.equal(persisted(workDir), false);
});

test('P1-T18: malformed runtime identity → runtime_unavailable, never called (NO_SILENT_RUNTIME_FALLBACK)', async () => {
  const workDir = tmpWorkDir();
  let called = 0;
  const res = await proposeResearchPlan({
    userRequest: REQUEST,
    workDir,
    runtime: { runtimeId: 'lmstudio-local-tool-less', model: 'qwen/qwen3-1.7b', completeText: async () => { called += 1; return VALID_PLAN_TEXT; } },
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_RUNTIME_UNAVAILABLE);
  assert.equal(called, 0);
  assert.equal(persisted(workDir), false);
});

// ---------------------------------------------------------------------------
// 4. runtime identity recording
// ---------------------------------------------------------------------------

test('P1-T18: runtime identity recorded faithfully on success and on failures', async () => {
  const expected = { runtimeId: 'deepseek-api-tool-less', model: DEEPSEEK_MODEL };
  assert.deepEqual((await plan(VALID_PLAN_TEXT)).res.runtime, expected);
  assert.deepEqual((await plan('free text')).res.runtime, expected);
  assert.deepEqual((await plan({ status: 503 })).res.runtime, expected);
});

// ---------------------------------------------------------------------------
// 5. credentials never enter prompt / output / state
// ---------------------------------------------------------------------------

test('P1-T18: credential key never appears in request messages, body, artifact, result, or errors', async () => {
  const usageSink = [];
  const { res, calls, workDir } = await plan(VALID_PLAN_TEXT, { usageSink });
  assert.equal(res.ok, true);
  assert.equal(calls[0].headers.authorization, `Bearer ${TEST_API_KEY}`);
  assert.equal(calls[0].rawBody.includes(TEST_API_KEY), false);
  assert.equal(fs.readFileSync(path.join(workDir, PLAN_ARTIFACT_FILENAME), 'utf8').includes(TEST_API_KEY), false);
  assert.equal(JSON.stringify(res).includes(TEST_API_KEY), false);
  assert.equal(JSON.stringify(usageSink).includes(TEST_API_KEY), false);

  // A provider error that echoes the key is never surfaced.
  const failed = await plan({ status: 401, body: { error: { message: `bad key ${TEST_API_KEY}` } } });
  assert.equal(JSON.stringify(failed.res).includes(TEST_API_KEY), false);
});

test('P1-T18: credential-shaped USER_REQUEST → user_request_invalid before any egress', async () => {
  const { res, calls, workDir } = await plan(VALID_PLAN_TEXT, { userRequest: '用这个 key 帮我查: token: sk-abc123secret' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_FAILURE_USER_REQUEST_INVALID);
  assert.ok(res.issues.some((i) => /credential-shape/i.test(i.message)));
  assert.equal(calls.length, 0);
  assert.equal(persisted(workDir), false);
});

// ---------------------------------------------------------------------------
// 6. USER_REQUEST input validation (Spec §10.1)
// ---------------------------------------------------------------------------

test('P1-T18: USER_REQUEST deterministic validation boundaries', async () => {
  const cases = [
    { name: 'empty', input: '   ' },
    { name: 'non-string', input: 42 },
    { name: 'too long', input: '研'.repeat(2001) },
    { name: 'control characters', input: '研究\u0000知乎' },
    { name: 'machine-private path', input: '研究 /Users/someone/secrets 里的项目' },
  ];
  for (const c of cases) {
    const { res, calls } = await plan(VALID_PLAN_TEXT, { userRequest: c.input });
    assert.equal(res.reason, PLANNER_FAILURE_USER_REQUEST_INVALID, c.name);
    assert.equal(calls.length, 0, c.name);
  }
  // A legitimate multiline request with tab/newline is accepted.
  const ok = await plan(VALID_PLAN_TEXT, { userRequest: '研究两个问题：\n1. 量化交易入门\t2. 量化交易风险' });
  assert.equal(ok.res.ok, true);
});

// ---------------------------------------------------------------------------
// 7. §10 non-sensitive usage evidence (recorded by the model layer)
// ---------------------------------------------------------------------------

test('P1-T18: usage evidence is recorded per model call when the provider reports it', async () => {
  const usageSink = [];
  const { res } = await plan({ text: VALID_PLAN_TEXT, usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } }, { usageSink });
  assert.equal(res.ok, true);
  assert.equal(usageSink.length, 1);
  assert.equal(usageSink[0].label, 'planner');
  assert.equal(usageSink[0].provider, 'deepseek');
  assert.equal(usageSink[0].model, DEEPSEEK_MODEL);
  assert.equal(usageSink[0].totalTokens, 200);
  assert.equal(typeof usageSink[0].ms, 'number');
});

// ---------------------------------------------------------------------------
// 6b. P1-T18 REPAIR (P1-1): Windows machine-private profile paths
// ---------------------------------------------------------------------------

test('P1-T18 repair P1-1: mid-sentence/multiline Windows profile path in USER_REQUEST -> user_request_invalid, no egress', async () => {
  for (const input of [
    '研究 C:\\Users\\alice\\secret.txt 里的项目',
    '请比较 C:\\Documents and Settings\\bob\\notes.md 和公开资料',
    '第一行\nD:\\Users\\carol\\private.txt',
  ]) {
    const { res, calls, workDir } = await plan(VALID_PLAN_TEXT, { userRequest: input });
    assert.equal(res.reason, PLANNER_FAILURE_USER_REQUEST_INVALID, input);
    assert.equal(calls.length, 0, input);
    assert.equal(persisted(workDir), false, input);
  }
});

test('P1-T18 repair P1-1: legitimate USER_REQUEST with tilde / drive-colon text stays valid (no over-rejection)', async () => {
  const { res, calls } = await plan(VALID_PLAN_TEXT, { userRequest: '分析温度~25度时的用户讨论，以及会议在 3:30 开始的安排' });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// 8. OWNER RULING 2026-09-10/11 (Issue #48 D1 repair): groupKey MUST be null
// ---------------------------------------------------------------------------

function planTextWithGroupKey(groupKey) {
  return JSON.stringify({
    ...JSON.parse(VALID_PLAN_TEXT),
    sourceGroupIntents: [{ intent: '关注反方观点', constraints: [], groupKey }],
  });
}

test('OWNER RULING D1-CE1: model-emitted semantic groupKey ("pro-replacement") → planner_invalid FAIL_CLOSED, nothing persisted', async () => {
  const { res, workDir } = await plan(planTextWithGroupKey('pro-replacement'));
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.ok(res.issues.some((i) => /sourceGroupIntents\[0\]\.groupKey/.test(i.path)));
  assert.equal(persisted(workDir), false);
  assert.equal(loadPlan(workDir).ok, false);
});

test('OWNER RULING D1-CE2: numeric-looking groupKey ("123456789") is still planner_invalid', async () => {
  const { res, workDir } = await plan(planTextWithGroupKey('123456789'));
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.ok(res.issues.some((i) => /sourceGroupIntents\[0\]\.groupKey/.test(i.path)));
  assert.equal(persisted(workDir), false);
});

test('OWNER RULING D1-CE3: groupKey null remains a valid planner proposal — persisted as today', async () => {
  const { res, workDir } = await plan(planTextWithGroupKey(null));
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, reason: res.reason, issues: res.issues }));
  const loaded = loadPlan(workDir);
  assert.equal(loaded.plan.sourceGroupIntents[0].groupKey, null);
  assert.equal(res.planHash, planHash(loaded.plan));
});

test('OWNER RULING D1-CE4: generic T04 validatePlanInput KEEPS accepting a legitimate non-null groupKey', () => {
  const v = validatePlanInput(JSON.parse(planTextWithGroupKey('canonical-question-1')));
  assert.equal(v.ok, true);
  assert.equal(v.plan.sourceGroupIntents[0].groupKey, 'canonical-question-1');
});

test('OWNER RULING D1-CE5: planner system prompt explicitly requires groupKey MUST be null', () => {
  const prompt = buildPlannerSystemPrompt();
  assert.match(prompt, /"groupKey"[^.\n]*MUST be null/i);
  assert.match(prompt, /no source-identity authority/i);
  assert.match(prompt, /cannot know Zhihu question IDs/i);
});

// ---------------------------------------------------------------------------
// 9. D4 (Issue #50): constraints MUST be []
// ---------------------------------------------------------------------------

function planTextWithConstraints(constraints) {
  return JSON.stringify({
    ...JSON.parse(VALID_PLAN_TEXT),
    sourceGroupIntents: [{ intent: '关注反方观点', constraints, groupKey: null }],
  });
}

function planTextWithIntents(intents) {
  return JSON.stringify({ ...JSON.parse(VALID_PLAN_TEXT), sourceGroupIntents: intents });
}

test('D4-CE1: model-emitted non-empty constraints -> planner_invalid FAIL_CLOSED, nothing persisted', async () => {
  const { res, workDir } = await plan(planTextWithConstraints(['至少包含一个高赞反对回答']));
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.ok(res.issues.some((i) => /sourceGroupIntents\[0\]\.constraints/.test(i.path)));
  assert.equal(persisted(workDir), false);
});

test('D4-CE2: constraints=[""] is still planner_invalid — emptiness is structural, not textual', async () => {
  const { res, workDir } = await plan(planTextWithConstraints(['']));
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.ok(res.issues.some((i) => /sourceGroupIntents\[0\]\.constraints/.test(i.path)));
  assert.equal(persisted(workDir), false);
});

test('D4-CE3: constraints=[] remains a valid planner proposal — persisted unchanged', async () => {
  const { res, workDir } = await plan(planTextWithConstraints([]));
  assert.equal(res.ok, true);
  const loaded = loadPlan(workDir);
  assert.deepEqual(loaded.plan.sourceGroupIntents[0].constraints, []);
  assert.equal(res.planHash, planHash(loaded.plan));
});

test('D4-CE4: multiple sourceGroupIntents, every constraints=[] -> valid and fully preserved', async () => {
  const intents = [
    { intent: '关注支持方观点', constraints: [], groupKey: null },
    { intent: '关注反方观点', constraints: [], groupKey: null },
    { intent: '关注中立综述', constraints: [], groupKey: null },
  ];
  const { res, workDir } = await plan(planTextWithIntents(intents));
  assert.equal(res.ok, true);
  assert.deepEqual(loadPlan(workDir).plan.sourceGroupIntents, intents);
});

test('D4-CE5: one invalid intent among valid ones invalidates the WHOLE plan (no partial acceptance)', async () => {
  const { res, workDir } = await plan(planTextWithIntents([
    { intent: '关注支持方观点', constraints: [], groupKey: null },
    { intent: '关注反方观点', constraints: ['至少包含一个高赞反对回答'], groupKey: null },
  ]));
  assert.equal(res.reason, PLANNER_FAILURE_PLANNER_INVALID);
  assert.ok(res.issues.some((i) => /sourceGroupIntents\[1\]\.constraints/.test(i.path)));
  assert.equal(persisted(workDir), false);
});

test('D4-CE6: generic T04 validatePlanInput is UNCHANGED — non-empty constraints stay valid for non-planner callers', () => {
  const constraints = ['Valid constraint string for other caller'];
  const v = validatePlanInput(JSON.parse(planTextWithConstraints(constraints)));
  assert.equal(v.ok, true);
  assert.deepEqual(v.plan.sourceGroupIntents[0].constraints, constraints);
});

test('D4-CE7: planner prompt states the constraints=[] rule and its schema example is itself valid', () => {
  const prompt = buildPlannerSystemPrompt();
  assert.match(prompt, /every "constraints" array MUST be \[\]/i);
  assert.match(prompt, /free-form (?:semantic )?constraints are unsupported/i);
  assert.equal(prompt.includes('"constraints": ["string"]'), false);
  assert.match(prompt, /"constraints": \[\]/);
  assert.match(
    prompt,
    /semantic diversity[^.\n]*"intent"[^.\n]*"queryVariants"[^.\n]*"aspects"[^.\n]*"entities"[^.\n]*"opposingFramings"[^.\n]*"terminologyVariants"/i,
  );
  assert.match(prompt, /"groupKey"[^.\n]*MUST be null/i);
});

// ---------------------------------------------------------------------------
// 10. other providers
// ---------------------------------------------------------------------------

test('a plan wrapped in a Markdown code fence (common for non-DeepSeek models) is accepted', async () => {
  const { res } = await plan(`下面是计划：\n\`\`\`json\n${VALID_PLAN_TEXT}\n\`\`\``);
  assert.equal(res.ok, true, JSON.stringify({ reason: res.reason, issues: res.issues }));
});

test('a custom OpenAI-compatible endpoint plans through the same contract and records its identity', async () => {
  const { res, calls } = await plan(VALID_PLAN_TEXT, { spec: 'antigravity/claude-sonnet-4-6', baseUrl: 'http://127.0.0.1:8045/v1' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.runtime, { runtimeId: 'antigravity-api-tool-less', model: 'claude-sonnet-4-6' });
  assert.equal(calls[0].url, 'http://127.0.0.1:8045/v1/chat/completions');
  assert.equal(calls[0].body.model, 'claude-sonnet-4-6');
  assert.equal(calls[0].body.tools, undefined);
  assert.equal(calls[0].body.response_format, undefined, 'JSON mode is not assumed for unknown endpoints');
});
