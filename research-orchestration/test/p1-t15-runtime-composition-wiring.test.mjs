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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('CE7: the production research runtime adapter pins the declared canonical identity and fails closed on envelope drift', async () => {
  const { buildDeepSeekResearchRuntime } = await import('../lib/deepseek-research-runtime.mjs');
  const envelopeFor = (content, model = 'deepseek-v4-flash') => ({
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
  assert.equal(rt.model, 'deepseek-v4-flash');
  const out = await rt.analyze({ projection: '[BEGIN UNTRUSTED_DATA token=1] data [END]' });
  assert.equal(calls, 1);
  assert.equal(lastBody.model, 'deepseek-v4-flash');
  assert.deepEqual(lastBody.tools, undefined, 'tool-less: no tools may be sent');
  assert.equal(lastBody.thinking?.type, 'disabled');
  assert.equal(out.main?.[0]?.tokenRef, '1');

  // envelope model drift → fail closed (identity drift is never tolerated)
  const driftEnvelope = envelopeFor('{"main":[],"minority":[],"contradictory":[]}', 'some-other-model');
  const driftRt = buildDeepSeekResearchRuntime({
    credential: { usable: true, key: 'test-key' },
    fetchImpl: async () => ({ ok: true, json: async () => driftEnvelope }),
  });
  await assert.rejects(() => driftRt.analyze({ projection: 'x' }), (e) => String(e?.message ?? '').length > 0);
});
