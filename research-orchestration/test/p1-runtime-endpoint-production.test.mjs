// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-runtime-endpoint-production.test.mjs
 *
 * The end-to-end proof for Issues #145 / custom base URL: the identity the
 * composer hashes must be the identity the production model layer exports, and
 * the endpoint must be bound into it. The previous red suite
 * (p1-runtime-identity-binding.test.mjs) used hand-built runtime objects; this
 * suite goes through the REAL production factory:
 *
 *   createModelRuntime({ spec, baseUrl, fetchImpl })   (lib/model-runtime.mjs)
 *
 * with the repository's fake OpenAI-compatible transport standing in for the
 * network, so pi-ai request building, streaming and the runtime object are all
 * production code. No real service is contacted: `fetchImpl` is a local fake
 * and the only URLs used are loopback addresses that are never dialled.
 *
 *   E1  a custom-endpoint run COMPLETES through the production runtime, and
 *       re-entering the same endpoint with a fresh runtime instance REUSES the
 *       checkpoint (no run_identity_conflict, no second model call);
 *   E2  a DIFFERENT endpoint never reuses that checkpoint (fail closed,
 *       checkpoint left intact, no model call);
 *   E3  a run labelled `deepseek` but pointed at a custom endpoint is NOT the
 *       default identity, so it neither reuses nor is reused by a default run;
 *   E4  neither the endpoint URL nor the API key reaches state, events, the
 *       result or the usage sink — only the endpoint digest does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { readState, eventsFile } from '../lib/state.mjs';
import { validateBaseUrl } from '../lib/model-runtime.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';
import { fakeModelRuntime, messagesOf, TEST_API_KEY } from './helpers/fake-model-transport.mjs';

const TOPIC = 'AI 编程工具会取代程序员吗';
const NOW = () => '2026-10-15T00:00:00.000Z';
const PLAN = {
  schemaVersion: 1,
  queryVariants: ['AI 编程工具 取代 程序员', 'AI coding 岗位影响'],
  aspects: ['岗位影响'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};
const TEXTS = {
  100: ['回答一：总体上有效，多数场景成立。', '回答二：小样本下有反例。'],
  200: ['回答三：另一个问题下的主流经验。', '回答四：补充：成本是主要顾虑。'],
};

const CLAIMS_MARKER = '信息抽取器';
const SYNTHESIS_MARKER = '观点聚类器';

const tmpWork = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function searchResult(providerId, ranking) {
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: NOW(),
    items: ranking.map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
  };
}

function rankingSeam() {
  const ranking = [['100', 1], ['200', 2]];
  const adapter = (providerId) => ({
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve: () => searchResult(providerId, ranking),
  });
  return createProviderSeam({ adapters: [adapter('fixture-official'), adapter('fixture-global')] });
}

const captureAdapter = {
  providerId: 'zhihu-session-capture',
  capability: 'capture',
  authClass: 'session',
  retrieve({ questionId, outDir }) {
    const dir = path.join(outDir, String(questionId));
    fs.mkdirSync(dir, { recursive: true });
    const doc = {
      questionId: String(questionId),
      questionTitle: `问题 ${questionId} 的标题`,
      answers: TEXTS[String(questionId)].map((content, i) => ({
        id: `${questionId}-a-${i + 1}`,
        content,
        excerpt: content,
        author: `作者${questionId}-${i}`,
        voteupCount: 10 - i,
      })),
    };
    fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify(doc, null, 2)}\n`);
    return {
      ok: true,
      provider_id: 'zhihu-session-capture',
      capability: 'capture',
      auth_class: 'session',
      retrieved_at: NOW(),
      items: [{
        identity: { kind: 'group', questionId: String(questionId) },
        provenance: { route: 'fixture-capture', rank: 1, rankOrigin: 'fixture' },
        facts: { capturedAnswerCount: doc.answers.length },
      }],
      completeness: { status: 'complete', evidence: { basis: 'fixture_complete_pagination' } },
    };
  },
};

function groupRunner() {
  return (name, args) => {
    if (name === 'zhihu-verify') {
      const doc = JSON.parse(fs.readFileSync(path.join(args[0], 'answers.json'), 'utf8'));
      return {
        status: 0,
        stdout: JSON.stringify({ valid: true, questionId: String(doc.questionId), capturedAnswerCount: doc.answers.length, reportedAnswerCount: doc.answers.length }),
      };
    }
    if (name === 'zhihu-handoff') {
      const dir = args[0];
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
      fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ questionId: String(doc.questionId), task: 'digest', sourceType: 'session-capture', verified: true, generatedBy: 'fixture' }, null, 2)}\n`);
      return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') return { status: 0, stdout: JSON.stringify({ valid: true }) };
    throw new Error(`unexpected runner command: ${name}`);
  };
}

const embeddingProvider = () => ({
  preflight: async () => ({ ok: true }),
  embed: async (texts) => ({ vectors: texts.map(() => mockVector768(7)) }),
});

/** Claims / synthesis payloads shaped for the production prompts. */
function modelReply(body) {
  const { system, user } = messagesOf(body);
  if (system.includes(SYNTHESIS_MARKER)) {
    const claims = JSON.parse(user).claims ?? [];
    const refs = claims.map((c) => c.claimId).sort();
    return {
      text: JSON.stringify({
        families: refs.length === 0 ? [] : [{ aspect: '总体有效性', anchorClaimId: refs[0], members: refs.map((claimId) => ({ claimId, stance: 'ASSERTS' })) }],
        unresolvedClaimIds: [],
      }),
    };
  }
  assert.ok(system.includes(CLAIMS_MARKER), 'the production claims prompt must be the one sent');
  const tokens = [...String(user).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
  assert.ok(tokens.length > 0, 'no issued token reached the model request');
  return {
    text: JSON.stringify({
      main: [{ tokenRef: tokens[0], statement: '主流观点：该做法在多数场景下有效' }],
      minority: [{ tokenRef: tokens[tokens.length - 1], statement: '少数派观点：特定条件下结论相反' }],
      contradictory: [],
      expertEvidenceRichTokens: [tokens[0]],
    }),
  };
}

/** A REAL production runtime over the fake transport (no network). */
async function productionRuntime({ spec = 'antigravity/claude-sonnet-4-6', baseUrl }) {
  return fakeModelRuntime(modelReply, { spec, baseUrl });
}

function composer(workDir, runtime) {
  return composeP1Research({
    topic: TOPIC,
    workDir,
    plan: PLAN,
    runtime,
    seam: rankingSeam(),
    captureAdapter,
    runner: groupRunner(),
    embeddingProvider: embeddingProvider(),
  });
}

const ENDPOINT_A = 'http://127.0.0.1:8045/v1';
const ENDPOINT_B = 'http://127.0.0.1:8046/v1';

test('E1: a custom-endpoint run completes through the production runtime and resumes on the same endpoint', async () => {
  const workDir = tmpWork('p1-endpoint-prod-');
  const first = await productionRuntime({ baseUrl: ENDPOINT_A });
  // The production factory's own identity surface:
  assert.equal(first.runtime.provider, 'antigravity');
  assert.equal(first.runtime.model, 'claude-sonnet-4-6');
  assert.equal(first.runtime.endpoint, validateBaseUrl(ENDPOINT_A));
  assert.equal(first.runtime.customEndpoint, validateBaseUrl(ENDPOINT_A));

  const out1 = await composer(workDir, first.runtime);
  assert.equal(out1.ok, true, `production-endpoint compose failed: ${JSON.stringify(out1)}`);
  assert.equal(first.calls.length > 0, true, 'the production transport must have been exercised');
  for (const call of first.calls) {
    assert.equal(call.body.model, 'claude-sonnet-4-6');
    assert.equal(call.body.tools, undefined, 'tool-less runtime must never send tools');
  }
  const state1 = readState(workDir);
  assert.match(state1.runtime, /^antigravity-api-tool-less:claude-sonnet-4-6:endpoint-[0-9a-f]{16}$/);

  // A FRESH runtime instance (new process-equivalent) on the same endpoint.
  const second = await productionRuntime({ baseUrl: ENDPOINT_A });
  const out2 = await composer(workDir, second.runtime);
  assert.equal(out2.ok, true, `same-endpoint re-entry must reuse: ${JSON.stringify(out2)}`);
  assert.equal(out2.reused, true);
  assert.equal(out2.runId, out1.runId);
  assert.equal(second.calls.length, 0, 'reuse must not call the model again');
  assert.deepEqual(readState(workDir), state1, 'a reuse must leave the checkpoint untouched');
});

test('E2: a different endpoint never reuses the checkpoint (fail closed, intact, no model call)', async () => {
  const workDir = tmpWork('p1-endpoint-cross-');
  const a = await productionRuntime({ baseUrl: ENDPOINT_A });
  const first = await composer(workDir, a.runtime);
  assert.equal(first.ok, true, JSON.stringify(first));
  const before = readState(workDir);

  const b = await productionRuntime({ baseUrl: ENDPOINT_B });
  const crossed = await composer(workDir, b.runtime);
  assert.equal(crossed.ok, false, 'another endpoint must not be served this checkpoint');
  assert.equal(crossed.code, 'run_identity_conflict');
  assert.equal(b.calls.length, 0, 'a refused identity must not call the model');
  assert.deepEqual(readState(workDir), before, 'the foreign checkpoint must be left intact');

  // And the same endpoint as a different model is a different identity too.
  const otherModel = await productionRuntime({ spec: 'antigravity/gpt-5.1-mini', baseUrl: ENDPOINT_A });
  const switched = await composer(workDir, otherModel.runtime);
  assert.equal(switched.ok, false);
  assert.equal(switched.code, 'run_identity_conflict');
  assert.equal(otherModel.calls.length, 0);
});

test('E3: a `deepseek` label on a custom endpoint is not the default identity', async () => {
  const defaultDir = tmpWork('p1-endpoint-default-');
  const defaultRun = await productionRuntime({ spec: 'deepseek/deepseek-v4-pro', baseUrl: null });
  const d = await composer(defaultDir, defaultRun.runtime);
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.equal(readState(defaultDir).runtime, 'deepseek-api-tool-less', 'the default keeps the historical identity');

  // Same model string, but the operator pointed it at a custom endpoint.
  const customDir = tmpWork('p1-endpoint-deepseek-custom-');
  const customRun = await productionRuntime({ spec: 'deepseek/deepseek-v4-pro', baseUrl: ENDPOINT_A });
  const c = await composer(customDir, customRun.runtime);
  assert.equal(c.ok, true, JSON.stringify(c));
  const customState = readState(customDir);
  assert.notEqual(customState.runtime, 'deepseek-api-tool-less', 'a custom endpoint must widen the identity');
  assert.match(customState.runtime, /^deepseek-api-tool-less:endpoint-[0-9a-f]{16}$/);
  assert.notEqual(customState.runId, readState(defaultDir).runId);

  // A default checkpoint is never served to the same model on another endpoint.
  const crossedDir = tmpWork('p1-endpoint-deepseek-crossed-');
  fs.cpSync(defaultDir, crossedDir, { recursive: true });
  const crossedRun = await productionRuntime({ spec: 'deepseek/deepseek-v4-pro', baseUrl: ENDPOINT_A });
  const reused = await composer(crossedDir, crossedRun.runtime);
  assert.equal(reused.ok, false, 'the endpoint must separate histories');
  assert.equal(reused.code, 'run_identity_conflict');
  assert.equal(crossedRun.calls.length, 0);
});

test('E4: neither the endpoint URL nor the API key reaches state, events, result or usage', async () => {
  const workDir = tmpWork('p1-endpoint-noleak-');
  const usageSink = [];
  const { runtime, calls } = await fakeModelRuntime(modelReply, {
    spec: 'antigravity/claude-sonnet-4-6',
    baseUrl: 'http://127.0.0.1:8047/tenant-hidden-path/v1',
    usageSink,
  });
  const out = await composer(workDir, runtime);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(calls.length > 0);
  assert.ok(usageSink.length > 0, 'usage must be observable without carrying the endpoint');

  const surfaces = new Map([
    ['state', fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8')],
    ['events', fs.readFileSync(eventsFile(workDir), 'utf8')],
    ['result', fs.readFileSync(path.join(workDir, 'research-result.json'), 'utf8')],
    ['usage', JSON.stringify(usageSink)],
  ]);
  for (const [label, text] of surfaces) {
    for (const secret of ['tenant-hidden-path', '127.0.0.1', '8047', ENDPOINT_A, TEST_API_KEY]) {
      assert.ok(!text.includes(secret), `${label} must not record ${secret}`);
    }
  }
  assert.match(fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8'), /endpoint-[0-9a-f]{16}/,
    'the digest is the only endpoint-derived value allowed into state');
});
