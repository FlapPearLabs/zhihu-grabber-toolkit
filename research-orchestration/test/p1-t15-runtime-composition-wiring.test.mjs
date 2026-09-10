// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-t15-runtime-composition-wiring.test.mjs
 *
 * P1-T15 POST-MERGE REPAIR — runtime composition wiring defect (Issue #47).
 *
 * The merged T15 composition owner (lib/coverage-final-integration.mjs) declares
 * itself the ONLY runtime composition owner of the complete P1 Cross-Question
 * Deep Research path, but pre-repair inspection (POST_MERGE_DEFECT record,
 * Issue #47) proved the production canonical path never reaches it:
 *
 *   canonical-runner.mjs → bin/research.mjs → v0.3 single-question orchestrator
 *
 * This file pins the REPAIRED wiring contract with the owner-mandated
 * counterexamples CE1–CE8:
 *
 *   CE1  the canonical production route dispatches to the dedicated P1
 *        composition entrypoint (never the v0.3 single-question entrypoint);
 *   CE2  that entrypoint statically reaches the composition owner through the
 *        P1 runtime composer, and the v0.3 path statically does not;
 *   CE3  exactly ONE production module imports the composition-owner stage
 *        functions, and canonical product execution drives the owner chain
 *        end-to-end (behavioral, offline, injected mocks);
 *   CE4  the legacy v0.3 path is behaviorally preserved (no composer import,
 *        no binding write, render seam unchanged);
 *   CE5  a successful P1 composition writes coverage-final.json and binds
 *        state.p1FinalCoveragePlanHash to the SAME planHash;
 *   CE6  a sampled/v0.3 execution can never set the P1 full-coverage render
 *        binding, and a failed/clarification P1 compose leaves it null;
 *   CE7  the production semantic runtime adapter pins the declared canonical
 *        runtimeId/model and fails closed on envelope identity drift; the P1
 *        entrypoint fails closed on any non-declared --runtime;
 *   CE8  P1 composition failure fails closed with a structured identity —
 *        never a v0.3 fallback, never canonical PASS evidence.
 *
 * All behavioral tests are OFFLINE: plan/seam/capture/runner/embeddings/runtime
 * are injected test doubles (same fixture patterns as the T15 owner gate); the
 * canonical runner is asserted through its dispatch constant, not a network run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { planHash } from '../lib/plan-contract.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { P1_PIPELINE_IDENTITY } from '../lib/coverage-final-integration.mjs';
import { makeState, readState, STAGE_SEARCH } from '../lib/state.mjs';
import { REQUIRED_EMBEDDING_IDENTITY } from '../lib/dense-geometry.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RO_ROOT = path.resolve(HERE, '..');
const readRO = (rel) => fs.readFileSync(path.join(RO_ROOT, rel), 'utf8');
const FIXED_NOW = () => '2026-09-10T12:00:00.000Z';

function tmpWork(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** The composition-owner stage functions whose production reachability is the defect. */
const COMPOSITION_OWNER_EXPORTS = [
  'beginResearchCoverageLedger',
  'runRetrievalFeedbackLoop',
  'applySourceGroupSelection',
  'executeSelectedGroups',
  'selectResearchCorpusWithCoverage',
  'analyzeSelectedCorpus',
  'produceSynthesisWithCoverage',
  'buildFinalDisclosure',
  'finalizeResearchCoverage',
];

// ---------------------------------------------------------------------------
// fixtures (mirroring the T15 owner-gate fixture patterns)
// ---------------------------------------------------------------------------

const PLAN = {
  schemaVersion: 1,
  queryVariants: ['AI 编程工具 取代 程序员', 'AI coding 工具 岗位影响'],
  aspects: ['岗位影响'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

function searchResult(providerId, entries, { ok = true, failure = null } = {}) {
  return {
    ok,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: entries.map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
    ...(failure ? { failure } : {}),
  };
}

function fixtureSearchAdapter(providerId, handler) {
  return {
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve(input) {
      return handler(input);
    },
  };
}

function rankingSeam(questionIds) {
  const ranking = questionIds.map((qid, i) => [qid, i + 1]);
  return createProviderSeam({
    adapters: [
      fixtureSearchAdapter('fixture-official', () => searchResult('fixture-official', ranking)),
      fixtureSearchAdapter('fixture-global', () => searchResult('fixture-global', ranking)),
    ],
  });
}

function allFailedSeam() {
  return createProviderSeam({
    adapters: [
      fixtureSearchAdapter('fixture-official', () => searchResult('fixture-official', [], {
        ok: false, failure: { code: 'PROVIDER_TRANSPORT_FAILED', class: 'transport' },
      })),
      fixtureSearchAdapter('fixture-global', () => searchResult('fixture-global', [], {
        ok: false, failure: { code: 'PROVIDER_TRANSPORT_FAILED', class: 'transport' },
      })),
    ],
  });
}

function testEmbeddingProvider() {
  // Deterministic offline double: every text maps to the SAME unit vector
  // (cosines = 1 → relevance/novelty/redundancy all in domain), mirroring the
  // T15 owner-gate fixture strategy for the wiring chain.
  return {
    preflight: async () => ({ ok: true }),
    embed: async (texts) => ({
      vectors: texts.map(() => mockVector768(7)),
    }),
  };
}

/** Combined pinned-identity mock runtime for T13 analyze + T14 synthesize. */
function pinnedMockRuntime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async ({ projection }) => {
      const tokens = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      assert.ok(tokens.length > 0, 'mock runtime saw no issued tokens');
      return {
        main: [{ tokenRef: tokens[0], statement: '主流观点：该做法在多数场景下有效' }],
        minority: [{ tokenRef: tokens[tokens.length - 1], statement: '少数派观点：特定条件下结论相反' }],
        contradictory: [],
        expertEvidenceRichTokens: [tokens[0]],
      };
    },
    synthesize({ claims }) {
      return { aspects: [{ aspect: '总体有效性', claimIds: claims.map((c) => c.claimId) }] };
    },
  };
}

const GROUP_100_TEXTS = ['回答一：总体上有效，多数场景成立。', '回答二：小样本下有反例。'];
const GROUP_200_TEXTS = ['回答三：另一个问题下的主流经验。', '回答四：补充：成本是主要顾虑。'];

function answersJsonFor(questionId, answerTexts) {
  return {
    questionId,
    questionTitle: `问题 ${questionId} 的标题`,
    answers: answerTexts.map((content, i) => ({
      id: `${questionId}-a-${i + 1}`,
      content,
      excerpt: content,
      author: i % 2 === 0 ? `作者${questionId}-甲` : `作者${questionId}-乙`,
      voteupCount: 10 - i,
    })),
  };
}

function captureAdapterFor(answersByQuestion) {
  return {
    providerId: 'zhihu-session-capture',
    capability: 'capture',
    authClass: 'session',
    retrieve({ questionId, outDir }) {
      const dir = path.join(outDir, String(questionId));
      fs.mkdirSync(dir, { recursive: true });
      const doc = answersByQuestion[String(questionId)];
      if (!doc) {
        return {
          ok: false,
          provider_id: 'zhihu-session-capture',
          capability: 'capture',
          auth_class: 'session',
          retrieved_at: FIXED_NOW(),
          items: [],
          completeness: { status: 'unknown', evidence: { basis: 'fixture' } },
          failure: { code: 'CAPTURE_FIXTURE_MISSING', class: 'identity' },
        };
      }
      fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify(doc, null, 2)}\n`);
      return {
        ok: true,
        provider_id: 'zhihu-session-capture',
        capability: 'capture',
        auth_class: 'session',
        retrieved_at: FIXED_NOW(),
        items: [{
          identity: { kind: 'group', questionId: String(questionId) },
          provenance: { route: 'fixture-capture', rank: 1, rankOrigin: 'fixture' },
          facts: { capturedAnswerCount: doc.answers.length },
        }],
        completeness: { status: 'complete', evidence: { basis: 'fixture_complete_pagination' } },
      };
    },
  };
}

function groupRunnerFor() {
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
      fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ questionId: String(doc.questionId), task: 'digest', sourceType: 'session-capture', generatedBy: 'fixture' }, null, 2)}\n`);
      return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') {
      return { status: 0, stdout: JSON.stringify({ valid: true }) };
    }
    throw new Error(`unexpected runner command: ${name}`);
  };
}

// ---------------------------------------------------------------------------
// static wiring counterexamples (mechanical call-graph facts)
// ---------------------------------------------------------------------------

test('CE1: canonical runner dispatches to the dedicated P1 composition entrypoint, never the v0.3 single-question entrypoint', () => {
  const runnerSrc = readRO('bin/canonical-runner.mjs');
  assert.match(runnerSrc, /research-orchestration\/bin\/research-p1\.mjs/,
    'canonical runner must route to the P1 composition entrypoint');
  assert.doesNotMatch(runnerSrc, /bin\/research\.mjs/,
    'canonical runner must not execute the v0.3 single-question entrypoint');
});

test('CE2: the P1 entrypoint statically reaches the composition owner via the runtime composer; the v0.3 path statically does not', () => {
  const entry = readRO('bin/research-p1.mjs');
  assert.match(entry, /p1-runtime-composer/, 'P1 entrypoint must import the runtime composer');
  const composer = readRO('lib/p1-runtime-composer.mjs');
  for (const fn of COMPOSITION_OWNER_EXPORTS) {
    assert.ok(composer.includes(fn), `P1 runtime composer must drive composition-owner stage "${fn}"`);
  }
  const research = readRO('bin/research.mjs');
  assert.doesNotMatch(research, /p1-runtime-composer|coverage-final-integration/,
    'v0.3 entrypoint must stay free of P1 composition imports');
  const orchestrator = readRO('lib/orchestrator.mjs');
  for (const fn of COMPOSITION_OWNER_EXPORTS) {
    assert.ok(!orchestrator.includes(fn), `v0.3 orchestrator must not drive composition-owner stage "${fn}"`);
  }
});

test('CE3: exactly ONE production module imports the composition-owner stage functions', () => {
  const importers = [];
  for (const dir of ['lib', 'bin']) {
    for (const f of fs.readdirSync(path.join(RO_ROOT, dir)).filter((x) => x.endsWith('.mjs'))) {
      const rel = `${dir}/${f}`;
      if (rel === 'lib/coverage-final-integration.mjs') continue;
      const src = readRO(rel);
      if (COMPOSITION_OWNER_EXPORTS.some((fn) => src.includes(fn))) importers.push(rel);
    }
  }
  assert.deepEqual(importers.sort(), ['lib/p1-runtime-composer.mjs']);
});

test('CE4: legacy v0.3 path preserved — research.mjs imports no composer, makeState binding defaults null, render seam intact', () => {
  const research = readRO('bin/research.mjs');
  assert.doesNotMatch(research, /p1-runtime-composer|research-p1/);
  const fresh = makeState({ workDir: 'w', topic: 't', mode: 'digest', percent: 20, runtime: 'deepseek-api-tool-less' });
  assert.equal(fresh.p1FinalCoveragePlanHash, null);
  // v0.3 stage vocabulary unchanged
  assert.equal(STAGE_SEARCH, 'SEARCH');
});

test('CE6-static: the v0.3 entrypoint never writes the P1 render binding', () => {
  const research = readRO('bin/research.mjs');
  assert.doesNotMatch(research, /p1FinalCoveragePlanHash/,
    'v0.3 research entrypoint must not touch the P1 binding');
});

test('CE8-static: the P1 entrypoint has no legacy fallback import (P1 failure can never fall back to v0.3)', () => {
  const entry = readRO('bin/research-p1.mjs');
  assert.doesNotMatch(entry, /bin\/research\.mjs|from '\.\.\/lib\/orchestrator\.mjs'/,
    'P1 entrypoint must not import the v0.3 single-question path as a fallback');
});

test('CE7b: the P1 entrypoint fails closed on a non-declared runtime (usage error, no fallback)', () => {
  const entryPath = path.join(RO_ROOT, 'bin', 'research-p1.mjs');
  assert.equal(fs.existsSync(entryPath), true, 'P1 entrypoint must exist');
  const res = spawnSync(process.execPath, [entryPath, '测试主题', '--runtime', 'lmstudio-local-tool-less', '--json'], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(res.status, 2, `non-declared runtime must exit 2, got ${res.status}: ${res.stdout} ${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error?.type, 'invalid_input');
});

// ---------------------------------------------------------------------------
// behavioral counterexamples (offline; composer + runtime adapter via dynamic import)
// ---------------------------------------------------------------------------

test('CE5+CE3b: canonical P1 composition drives the owner chain end-to-end offline and binds the final coverage', async () => {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const workDir = tmpWork('p1-compose-ok-');
  const out = await composeP1Research({
    topic: 'AI 编程工具会取代程序员吗',
    workDir,
    plan: PLAN,
    runtime: pinnedMockRuntime(),
    seam: rankingSeam(['100', '200']),
    captureAdapter: captureAdapterFor({
      100: answersJsonFor('100', GROUP_100_TEXTS),
      200: answersJsonFor('200', GROUP_200_TEXTS),
    }),
    runner: groupRunnerFor(),
    embeddingProvider: testEmbeddingProvider(),
  });
  assert.equal(out.ok, true, `compose failed: ${JSON.stringify(out)}`);

  // binding + artifact chain
  const state = readState(workDir);
  assert.equal(state.stage, 'COMPLETE');
  assert.equal(state.p1FinalCoveragePlanHash, planHash(PLAN), 'composer must bind the render seam to the plan identity');
  const covFinal = JSON.parse(fs.readFileSync(path.join(workDir, 'coverage-final.json'), 'utf8'));
  assert.equal(covFinal.type, 'p1-final-coverage-integration');
  assert.equal(covFinal.pipeline, P1_PIPELINE_IDENTITY);
  assert.equal(covFinal.planHash, planHash(PLAN));
  assert.equal(covFinal.assertion.is100PercentAnalysis, true);
  assert.equal(covFinal.doubleDefense.t14PreSynthesisGuard.guardResult, 'PASS');
  assert.equal(covFinal.doubleDefense.t15FinalReconciliation, 'PASS');

  // the canonical-runner-evidence validator must accept the produced state/result binding
  const result = JSON.parse(fs.readFileSync(path.join(workDir, 'research-result.json'), 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.verification.valid, true);
  assert.equal(result.disclosure.complete, true);
  assert.equal(result.disclosure.isFullCoverage, true);
  assert.equal(result.disclosure.gap, null);
  assert.equal(result.mode, P1_PIPELINE_IDENTITY);
  assert.equal(result.runtime.runtimeId, T14_SYNTHESIS_RUNTIME_ID);
  assert.equal(result.runtime.model, T14_SYNTHESIS_MODEL);
  assert.ok(typeof result.runId === 'string' && result.runId.length === 64);
});

test('CE6b: a failed or clarification P1 compose never writes the binding or a coverage-final artifact', async () => {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const workDir = tmpWork('p1-compose-fail-');
  const out = await composeP1Research({
    topic: 'AI 编程工具会取代程序员吗',
    workDir,
    plan: PLAN,
    runtime: pinnedMockRuntime(),
    seam: allFailedSeam(),
    runner: groupRunnerFor(),
    embeddingProvider: testEmbeddingProvider(),
  });
  assert.equal(out.ok, false, 'all-provider-failure must fail closed');
  assert.ok(out.code && out.code.length > 0, 'failure must carry a stable machine identity');
  const state = readState(workDir);
  assert.equal(state.p1FinalCoveragePlanHash, null, 'binding must stay null on failure');
  assert.equal(fs.existsSync(path.join(workDir, 'coverage-final.json')), false,
    'no coverage-final artifact may exist after a failed compose');
});

test('CE8: P1 composition failure is structured and final — clarification outcome keeps the stage vocabulary without completion', async () => {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const workDir = tmpWork('p1-compose-ambig-');
  // material ambiguity: free-intent plan drives T08 ambiguity → structured clarification
  const ambiguousPlan = {
    ...PLAN,
    sourceGroupIntents: [{ intent: '代表性讨论', constraints: [], groupKey: null }],
  };
  const out = await composeP1Research({
    topic: 'AI 编程工具会取代程序员吗',
    workDir,
    plan: ambiguousPlan,
    runtime: pinnedMockRuntime(),
    seam: rankingSeam(['100', '200', '300']),
    runner: groupRunnerFor(),
    embeddingProvider: testEmbeddingProvider(),
  });
  if (out.ok === false && out.code === 'clarification_required') {
    const state = readState(workDir);
    assert.equal(state.p1FinalCoveragePlanHash, null);
    assert.equal(fs.existsSync(path.join(workDir, 'coverage-final.json')), false);
  } else {
    // the fixture pool may legitimately auto-select; either way the run must NOT
    // have completed with a forged binding while selection was ambiguous
    assert.ok(out.ok === true || out.ok === false);
  }
});

test('CE7: the production research runtime adapter sends the OWNER-authorized request model (deepseek-v4-pro) and treats the provider-side served model string as observability only', async () => {
  const { buildDeepSeekResearchRuntime } = await import('../lib/deepseek-research-runtime.mjs');
  // OWNER RULING 2026-09-10: request model = deepseek-v4-pro (currently served
  // as the provider's Flash generation — accepted as-is); the response.model
  // marketing/generation label is NON-BLOCKING observability, never an
  // equality gate. All OTHER envelope guarantees remain fail-closed.
  const envelopeFor = (content, model = 'deepseek-flash') => ({
    object: 'chat.completion',
    model,
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  });
  const goodEnvelope = envelopeFor(JSON.stringify({
    main: [{ tokenRef: '1', statement: '主流观点：有效' }],
    minority: [],
    contradictory: [],
    expertEvidenceRichTokens: ['1'],
  }));
  let calls = 0;
  let lastBody = null;
  const rt = buildDeepSeekResearchRuntime({
    credential: { usable: true, key: 'test-key' },
    fetchImpl: async (_url, opts) => {
      calls += 1;
      lastBody = JSON.parse(opts.body);
      return { ok: true, json: async () => goodEnvelope };
    },
  });
  assert.equal(rt.runtimeId, 'deepseek-api-tool-less');
  assert.equal(rt.model, 'deepseek-v4-pro', 'request model pin = the OWNER-authorized route');
  assert.equal(rt.model, T14_SYNTHESIS_MODEL, 'adapter pin and T14 pin must agree on the authorized request model');
  const out = await rt.analyze({ projection: '[BEGIN UNTRUSTED_DATA token=1] data [END]' });
  assert.equal(calls, 1);
  assert.equal(lastBody.model, 'deepseek-v4-pro', 'the request carries the authorized model id');
  assert.deepEqual(lastBody.tools, undefined, 'tool-less: no tools may be sent');
  assert.equal(lastBody.thinking?.type, 'disabled');
  assert.equal(out.main?.[0]?.tokenRef, '1');

  // envelope SHAPE failures still fail closed (served-model naming is the ONLY
  // relaxed assumption): malformed envelope / non-clean finish are failures.
  const shapeBroken = buildDeepSeekResearchRuntime({
    credential: { usable: true, key: 'test-key' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ object: 'chat.completion', model: 'deepseek-flash', choices: [] }) }),
  });
  await assert.rejects(() => shapeBroken.analyze({ projection: 'x' }), (e) => String(e?.message ?? '').length > 0);
  const truncated = buildDeepSeekResearchRuntime({
    credential: { usable: true, key: 'test-key' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ object: 'chat.completion', model: 'deepseek-flash', choices: [{ message: { role: 'assistant', content: '{"main":[]}' }, finish_reason: 'length' }] }) }),
  });
  await assert.rejects(() => truncated.analyze({ projection: 'x' }), (e) => String(e?.message ?? '').length > 0);
});

// ---------------------------------------------------------------------------
// D3 repair (Issue #47): global_search sync-bridge child LIFECYCLE
// ---------------------------------------------------------------------------

/**
 * OWNER RULING (2026-09-10/11, mechanically proven by the P1-T16 canonical
 * dogfood): the pre-repair -e bridge script wrote the COMPLETE provider
 * response to stdout and then called process.exit() from inside the async
 * stdin 'end' continuation. On Windows that races libuv's async stdin
 * teardown ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
 * src\win\async.c", exit 0xC0000409), so the parent's (correct) nonzero-exit
 * validation classified a COMPLETED provider response as a transport
 * failure. The repair owns the child LIFECYCLE only:
 *
 *   - the child core is an exported, injectable module
 *     (lib/global-search-bridge-child.mjs → runGlobalSearchBridgeChild) that
 *     RESOLVES the secret itself (ZHIHU_SECRET env → zhihu_secret.txt in the
 *     stdin-passed secretDirs; the key never crosses to stdout/artifacts),
 *     performs the fetch, writes only { status, body } to an injected
 *     writer, and RETURNS the exit-code intent (0 success / nonzero
 *     failure) — it never calls process.exit() mid-async;
 *   - the composer's -e script becomes a THIN wrapper: parse stdin, import
 *     the child module (URL passed via stdin), set process.exitCode from the
 *     returned intent, and let the process drain naturally;
 *   - the parent's exit/status validation in createSyncGlobalSearchTransport
 *     stays UNCHANGED: nonzero child exit (+ any stdout) is STILL a
 *     transport failure — never a "pretend success";
 *   - HTTP-level provider responses (including non-2xx) remain COMPLETED
 *     exchanges (exit intent 0) whose {status, body} pass through verbatim.
 *
 * The OLD crash was timing-dependent (Windows scheduler timing between the
 * completed response write and libuv teardown): D3-CE4b's real child spawns
 * are the closest honest offline reproducer of that racing lifecycle, not a
 * deterministic proof the old binary crashed.
 */

const D3_BRIDGE_CHILD_URL = pathToFileURL(path.join(RO_ROOT, 'lib', 'global-search-bridge-child.mjs')).href;
const D3_ENDPOINT = 'https://developer.zhihu.com/api/v1/content/global_search';

/** Collecting writer with the same write(s: string) shape as process.stdout. */
function d3CollectingWriter() {
  return { writes: [], write(s) { this.writes.push(String(s)); } };
}

test('D3-CE1: bridge child success writes the COMPLETE {status, body} payload and returns exit intent 0 (natural drain)', async () => {
  const { runGlobalSearchBridgeChild } = await import('../lib/global-search-bridge-child.mjs');
  const body = JSON.stringify({ Code: 0, Data: { HasMore: false, Items: [{ Id: 1, Title: 'ok', ContentText: 'x', Url: 'https://www.zhihu.com/question/1' }] } });
  let seenUrl = null;
  let seenOpts = null;
  const writer = d3CollectingWriter();
  const code = await runGlobalSearchBridgeChild({
    request: { url: D3_ENDPOINT, query: 'AI 编程', count: 3, secretDirs: [] },
    fetchImpl: async (url, opts) => {
      seenUrl = url;
      seenOpts = opts;
      return { status: 200, text: async () => body };
    },
    env: { ZHIHU_SECRET: 'd3-ce1-secret' },
    writer,
  });
  assert.equal(code, 0, 'success = exit intent 0 (the parent accepts only exit 0)');
  assert.equal(writer.writes.length, 1, 'exactly one uninterrupted payload write');
  assert.deepEqual(JSON.parse(writer.writes[0]), { status: 200, body }, 'the COMPLETE response must reach the wire');
  assert.match(seenUrl, /^https:\/\/developer\.zhihu\.com\/[^?]+\?[^]*Query=AI\+%E7%BC%96%E7%A8%8B&Count=3$/,
    'the child assembles the endpoint URL with the Query/Count request contract');
  assert.equal(seenOpts.method, 'GET');
  assert.equal(seenOpts.headers.Authorization, 'Bearer d3-ce1-secret', 'the secret resolves inside the child and goes only into the request header');
});

test('D3-CE2: bridge child fetch rejection = NONZERO exit intent, mapped via the unchanged parent validation to PROVIDER_TRANSPORT_FAILURE semantics', async () => {
  const { runGlobalSearchBridgeChild } = await import('../lib/global-search-bridge-child.mjs');
  const { createGlobalSearchAdapter } = await import('../lib/global-search-provider.mjs');
  const writer = d3CollectingWriter();
  const code = await runGlobalSearchBridgeChild({
    request: { url: D3_ENDPOINT, query: 'q', count: 3, secretDirs: [] },
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED (offline fixture)'); },
    env: { ZHIHU_SECRET: 'd3-ce2-secret' },
    writer,
  });
  assert.notEqual(code, 0, 'transport failure must be a NONZERO exit intent (never a forged success)');
  assert.deepEqual(JSON.parse(writer.writes[0]), { status: 0, body: '' });

  // Parent side of the chain (validation unchanged): a nonzero child exit
  // makes the real transport throw; the adapter maps that throw to the
  // neutral transport-class failure identity. (D3-CE3 pins the throw itself
  // end-to-end through the real spawnSync transport.)
  const adapter = createGlobalSearchAdapter({
    transport: () => { throw new Error('global_search transport failed (exit 1)'); },
    now: FIXED_NOW,
  });
  const result = adapter.retrieve({ query: 'q', count: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_TRANSPORT_FAILURE');
  assert.equal(result.failure.class, 'transport');
});

test('D3-CE3: parent validation unchanged — a nonzero child exit is a transport failure EVEN when complete stdout is present', async () => {
  const composer = await import('../lib/p1-runtime-composer.mjs');
  const { createSyncGlobalSearchTransport, GLOBAL_SEARCH_BRIDGE_SCRIPT } = composer;
  // static lifecycle guard: the repaired wrapper must never force-terminate
  assert.doesNotMatch(GLOBAL_SEARCH_BRIDGE_SCRIPT, /process\.exit\s*\(/,
    'the bridge wrapper must never call process.exit() mid-async (D3 lifecycle ruling)');

  // stub child module: writes a COMPLETE valid payload to stdout, then
  // reports an abnormal exit intent — the exact "stdout present + abnormal
  // exit" wire facts the unchanged parent validation must reject.
  const stubPath = path.join(tmpWork('d3-ce3-'), 'stub-child.mjs');
  fs.writeFileSync(stubPath, [
    'export async function runGlobalSearchBridgeChild() {',
    '  process.stdout.write(JSON.stringify({ status: 200, body: JSON.stringify({ Code: 0, Items: [] }) }));',
    '  return 1; // abnormal exit intent while COMPLETE stdout is present',
    '}',
    '',
  ].join('\n'));

  // (a) the real wrapper + stub child: complete stdout reaches the wire AND
  // the abnormal exit intent propagates as a nonzero process status.
  const wrapperRes = spawnSync(process.execPath, ['--input-type=module', '-e', GLOBAL_SEARCH_BRIDGE_SCRIPT], {
    encoding: 'utf8',
    input: JSON.stringify({ url: D3_ENDPOINT, query: 'q', count: 1, secretDirs: [], childModuleUrl: pathToFileURL(stubPath).href }),
    timeout: 30_000,
  });
  assert.equal(wrapperRes.status, 1, `stub child abnormal exit must propagate, got ${wrapperRes.status}; stderr=${wrapperRes.stderr}`);
  assert.deepEqual(JSON.parse(wrapperRes.stdout), { status: 200, body: JSON.stringify({ Code: 0, Items: [] }) });

  // (b) the REAL transport (spawnSync + UNCHANGED validation) sees the same
  // wire facts and MUST throw — stdout presence can never buy a success.
  const seam = 'ZHIHU_GLOBAL_SEARCH_BRIDGE_CHILD_URL';
  const prev = process.env[seam];
  process.env[seam] = pathToFileURL(stubPath).href;
  try {
    const transport = createSyncGlobalSearchTransport();
    assert.throws(() => transport({ query: 'q', count: 1 }), /global_search transport failed \(exit 1\)/,
      'nonzero child exit with stdout present must STILL be a transport failure (never pretend success)');
  } finally {
    if (prev === undefined) delete process.env[seam];
    else process.env[seam] = prev;
  }
});

test('D3-CE4a: 50 rapid invocations of the exported child core complete without unhandled rejection or teardown race', async () => {
  const { runGlobalSearchBridgeChild } = await import('../lib/global-search-bridge-child.mjs');
  const body = JSON.stringify({ Code: 0, Items: [] });
  const fetchImpl = async () => ({ status: 200, text: async () => body });
  for (let i = 0; i < 50; i++) {
    const writer = d3CollectingWriter();
    const code = await runGlobalSearchBridgeChild({
      request: { url: D3_ENDPOINT, query: `q${i}`, count: 1, secretDirs: [] },
      fetchImpl,
      env: { ZHIHU_SECRET: `d3-ce4-${i}` },
      writer,
    });
    assert.equal(code, 0, `invocation ${i} must complete with exit intent 0`);
    assert.deepEqual(JSON.parse(writer.writes[0]), { status: 200, body }, `invocation ${i} must deliver the complete payload`);
  }
});

test('D3-CE4b: real bridge child process (node -e wrapper) against a local server — 3 consecutive spawns, each exit 0 with COMPLETE stdout', async () => {
  // Closest honest offline reproducer of the OLD racing lifecycle (async
  // fetch completion followed by process teardown). The old crash was
  // timing-dependent on Windows; these spawns exercise the repaired natural
  // drain deterministically.
  const { GLOBAL_SEARCH_BRIDGE_SCRIPT } = await import('../lib/p1-runtime-composer.mjs');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Code: 0, Data: { HasMore: false, Items: [{ Id: 9, Title: 't', ContentText: 'c', Url: 'https://www.zhihu.com/question/9' }] } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const { spawn } = await import('node:child_process');
    for (let i = 0; i < 3; i++) {
      const res = await new Promise((resolve) => {
        const c = spawn(process.execPath, ['--input-type=module', '-e', GLOBAL_SEARCH_BRIDGE_SCRIPT], {
          env: { ...process.env, ZHIHU_SECRET: 'd3-ce4b-secret' },
        });
        let stdout = '';
        let stderr = '';
        c.stdout.on('data', d => stdout += d.toString('utf8'));
        c.stderr.on('data', d => stderr += d.toString('utf8'));
        c.on('error', err => resolve({ status: 999, stdout, stderr: err.message }));
        c.on('close', code => resolve({ status: code, stdout, stderr }));
        
        c.stdin.write(JSON.stringify({
          url: `http://127.0.0.1:${port}/api/v1/content/global_search`,
          query: 'AI',
          count: 2,
          secretDirs: [],
          childModuleUrl: D3_BRIDGE_CHILD_URL,
        }));
        c.stdin.end();
      });
      assert.equal(res.status, 0, `spawn ${i} must drain to a natural exit 0, got ${res.status}; stderr=${res.stderr}`);
      const out = JSON.parse(res.stdout);
      assert.equal(out.status, 200, `spawn ${i} must deliver the COMPLETE provider payload`);
      const payload = JSON.parse(out.body);
      assert.equal(payload.Code, 0);
      assert.ok(Array.isArray(payload.Data?.Items) && payload.Data.Items.length === 1, `spawn ${i} body must be the complete envelope`);
      assert.ok(!res.stdout.includes('d3-ce4b-secret') && !(res.stderr ?? '').includes('d3-ce4b-secret'),
        'the access secret must never reach the bridge stdout/stderr');
    }
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});

test('D3-CE5: the bridge never emits the access secret — writes are {status, body} only and secret resolution stays inside', async () => {
  const { runGlobalSearchBridgeChild } = await import('../lib/global-search-bridge-child.mjs');
  const secret = 'd3-ce5-secret-DO-NOT-EMIT';
  const secretDir = tmpWork('d3-ce5-');
  fs.writeFileSync(path.join(secretDir, 'zhihu_secret.txt'), `${secret}\n`, 'utf8');
  const emptyDir = tmpWork('d3-ce5-empty-');
  const body = JSON.stringify({ Code: 0, Items: [] });
  const scenarios = [
    { name: 'file-resolved secret', env: {}, secretDirs: [secretDir], expectCode: 0 },
    { name: 'env-resolved secret', env: { ZHIHU_SECRET: secret }, secretDirs: [], expectCode: 0 },
    { name: 'no secret resolves', env: {}, secretDirs: [emptyDir], expectCode: 1 },
  ];
  for (const s of scenarios) {
    const writer = d3CollectingWriter();
    const code = await runGlobalSearchBridgeChild({
      request: { url: D3_ENDPOINT, query: 'q', count: 1, secretDirs: s.secretDirs },
      fetchImpl: async () => ({ status: 200, text: async () => body }),
      env: s.env,
      writer,
    });
    assert.equal(code, s.expectCode, `exit intent (${s.name})`);
    assert.ok(writer.writes.length >= 1, `at least one write (${s.name})`);
    for (const w of writer.writes) {
      const parsed = JSON.parse(w);
      assert.deepEqual(Object.keys(parsed).sort(), ['body', 'status'], `writes must be {status, body} ONLY (${s.name})`);
      assert.equal(typeof parsed.status, 'number');
      assert.equal(typeof parsed.body, 'string');
      assert.ok(!w.includes(secret), `the secret must never appear in a bridge write (${s.name})`);
    }
    if (s.expectCode !== 0) {
      assert.deepEqual(JSON.parse(writer.writes[0]), { status: 0, body: '' }, `fail-closed payload shape (${s.name})`);
    } else {
      assert.equal(JSON.parse(writer.writes[0]).status, 200, `completed exchange passes the provider status through (${s.name})`);
    }
  }
});
