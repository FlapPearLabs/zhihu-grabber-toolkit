// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p4-replay-analysis.test.mjs
 *
 * evaluation/replay-analysis.mjs re-runs a finished run's analysis on its
 * recorded inputs (plan, search pool, captured answers, selection):
 *
 *   RP1  a replay never searches or captures for real, reproduces the
 *        baseline's selection and corpus, and records that it did; the replay
 *        directory is an ordinary run (report, metrics);
 *   RP2  the same baseline replays in chunked mode with identical inputs;
 *   RP3  a baseline that needed a clarification is answered with the
 *        baseline's chosen groups;
 *   RP4  a search the recording cannot answer, or a different selection, is a
 *        fidelity failure (written, never reported as faithful);
 *   RP5  an empty captured question title is filled from the recorded search
 *        title (as the baseline's fallback did), and disclosed;
 *   RP6  refusals: non-empty output directory, unfinished baseline, CLI usage.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam } from '../lib/provider-seam.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { loadReportModel } from '../lib/report.mjs';
import { computeMetrics } from '../evaluation/run-scoring.mjs';
import { replayAnalysis, REPLAY_INFO_FILENAME } from '../evaluation/replay-analysis.mjs';
import { captureAdapter, completedRun, embeddingProvider, runner, runtime, tmpDir } from './helpers/p1-offline-run.mjs';

const CLI = fileURLToPath(new URL('../evaluation/replay-analysis.mjs', import.meta.url));
const tokensOf = (projection) => [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
const writeJson = (dir, rel, value) => fs.writeFileSync(path.join(dir, rel), JSON.stringify(value, null, 2));
const offline = { embeddingProvider, runner };

/** A chunked-capable runtime double: one claim per batch citing every token. */
function chunkedRuntime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async () => { throw new Error('single analyze must not run'); },
    analyzeBatch: async ({ projection }) => ({ claims: [{ kind: 'main', statement: '共同观点', tokenRefs: tokensOf(projection) }] }),
    mergeClaims: async ({ claims }) => ({ merged: [{ kind: 'main', statement: '共同观点', memberIds: claims.map((c) => c.id) }] }),
    synthesize: async ({ claims }) => ({
      families: [{ aspect: '议题', anchorClaimId: claims[0].claimId, members: claims.map((c) => ({ claimId: c.claimId, stance: 'ASSERTS' })) }],
      unresolvedClaimIds: [],
    }),
  };
}

test('RP1: single replay reproduces selection and corpus without searching or capturing', async () => {
  const baseline = await completedRun('p4-replay-base-');
  const outDir = path.join(tmpDir('p4-replay-'), 'single');
  const noNetwork = () => { throw new Error('a replay must not use the network'); };
  const replay = await replayAnalysis(baseline, { outDir, runtime: runtime(), fetchImpl: noNetwork, ...offline });
  assert.equal(replay.ok, true, JSON.stringify(replay.info));
  const info = readJson(outDir, REPLAY_INFO_FILENAME);
  assert.deepEqual(info.fidelity, { selectionMatches: true, corpusMatches: true, unrecordedSearches: [], ok: true });
  assert.equal(info.analysisMode, 'single');
  assert.equal(info.clarified, false);
  assert.deepEqual(info.titleFilledFromSearch, []);
  assert.equal(info.report, 'report.md');
  assert.ok(fs.existsSync(path.join(outDir, 'report.md')));
  // The same plan and the same claims as the baseline: the analysis is the only thing that ran again.
  assert.deepEqual(readJson(outDir, 'research-plan.json'), readJson(baseline, 'research-plan.json'));
  assert.deepEqual(readJson(outDir, 'per-group-claims.json').groupRepresentations.map((g) => g.claims),
    readJson(baseline, 'per-group-claims.json').groupRepresentations.map((g) => g.claims));
  for (const qid of ['100', '200']) {
    assert.equal(fs.readFileSync(path.join(outDir, 'zhihu', qid, 'answers.json'), 'utf8'),
      fs.readFileSync(path.join(baseline, 'zhihu', qid, 'answers.json'), 'utf8'), 'captured answers are copied byte for byte');
  }
  assert.equal(computeMetrics(loadReportModel(outDir)).citations.analyzed, 5);
});

test('RP2: the same baseline replays in chunked mode on identical inputs', async () => {
  const baseline = await completedRun('p4-replay-base-');
  const outDir = path.join(tmpDir('p4-replay-'), 'chunked');
  const replay = await replayAnalysis(baseline, { outDir, runtime: chunkedRuntime(), analysisMode: 'chunked', analysisOptions: { maxBatchSources: 2 }, ...offline });
  assert.equal(replay.ok, true, JSON.stringify(replay.info));
  assert.equal(replay.info.analysisMode, 'chunked');
  assert.equal(replay.info.fidelity.corpusMatches, true);
  const m = computeMetrics(loadReportModel(outDir));
  assert.equal(m.citations.cited, 5, 'every analysed answer is cited');
  assert.equal(m.claims.multiSource, 2);
});

/** A runtime double for any corpus: one main claim per group, one family per claim. */
function genericRuntime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async ({ projection }) => ({ main: [{ tokenRef: tokensOf(projection)[0], statement: '远程访问需要正确配置。' }], minority: [], contradictory: [], expertEvidenceRichTokens: [] }),
    synthesize: async ({ claims }) => ({
      families: claims.map((c) => ({ aspect: '访问条件', anchorClaimId: c.claimId, members: [{ claimId: c.claimId, stance: 'ASSERTS' }] })),
      unresolvedClaimIds: [],
    }),
  };
}

test('RP3: a baseline clarification is answered with the baseline’s chosen groups', async () => {
  const plan = { schemaVersion: 1, queryVariants: ['家庭远程访问'], aspects: ['可达性'], entities: [], opposingFramings: [],
    terminologyVariants: [], sourceGroupIntents: [{ intent: '实际使用限制', constraints: [], groupKey: null }] };
  const adapter = (providerId) => ({ providerId, capability: 'search', authClass: 'official-secret', retrieve: () => ({
    ok: true, provider_id: providerId, capability: 'search', auth_class: 'official-secret', retrieved_at: '2026-10-10T00:00:00.000Z',
    items: ['100', '200'].map((id, i) => ({ identity: { kind: 'candidate', questionId: id },
      provenance: { route: 'offline-test', rank: i + 1, rankOrigin: 'fixture_order' }, facts: {}, source_url: null })),
    completeness: { status: 'unknown', evidence: { signal: 'absent' } } }) });
  const baseline = tmpDir('p4-replay-clar-');
  const common = { topic: '家庭 IPv6 远程访问有哪些限制？', workDir: baseline, runtime: genericRuntime(), captureAdapter, ...offline,
    seam: createProviderSeam({ adapters: [adapter('fixture-official'), adapter('fixture-global')] }) };
  const pending = await composeP1Research({ ...common, plan });
  assert.equal(pending.clarificationRequired, true, 'fixture must need a clarification');
  const done = await composeP1Research({ ...common,
    clarificationResponse: { schemaVersion: 1, binding: pending.clarificationRequest.binding, clarification: { forceGroupIds: ['200'] } } });
  assert.equal(done.ok, true, JSON.stringify(done));

  const outDir = path.join(tmpDir('p4-replay-'), 'single');
  const replay = await replayAnalysis(baseline, { outDir, runtime: genericRuntime(), ...offline });
  assert.equal(replay.ok, true, JSON.stringify(replay.info));
  assert.equal(replay.info.clarified, true);
  assert.deepEqual(readJson(outDir, 'source-group-selection-decision.json').selectedGroups.map((g) => g.questionId), ['200']);
});

test('RP4: unrecorded searches and a different selection are fidelity failures', async () => {
  const baseline = await completedRun('p4-replay-base-');
  const pool = readJson(baseline, 'retrieval-rounds/accumulated-pool.json');
  const dropped = pool.channels.shift();
  writeJson(baseline, 'retrieval-rounds/accumulated-pool.json', pool);
  const outDir = path.join(tmpDir('p4-replay-'), 'single');
  const replay = await replayAnalysis(baseline, { outDir, runtime: runtime(), ...offline });
  assert.equal(replay.ok, false);
  assert.deepEqual(replay.info.fidelity.unrecordedSearches, [{ providerId: dropped.channel.providerId, query: dropped.channel.query }]);
  assert.equal(readJson(outDir, REPLAY_INFO_FILENAME).fidelity.ok, false);

  // The baseline claims a group the recorded pool would never select.
  const other = await completedRun('p4-replay-base-');
  const decision = readJson(other, 'source-group-selection-decision.json');
  decision.selectedGroups = decision.selectedGroups.filter((g) => g.questionId === '100');
  writeJson(other, 'source-group-selection-decision.json', decision);
  const second = await replayAnalysis(other, { outDir: path.join(tmpDir('p4-replay-'), 'x'), runtime: runtime(), ...offline });
  assert.equal(second.ok, false);
  assert.equal(second.info.fidelity.selectionMatches, false);
});

test('RP5: an empty captured title is filled from the recorded search title and disclosed', async () => {
  const baseline = await completedRun('p4-replay-base-');
  const answersFile = path.join(baseline, 'zhihu', '200', 'answers.json');
  writeJson(path.dirname(answersFile), 'answers.json', { ...JSON.parse(fs.readFileSync(answersFile, 'utf8')), questionTitle: '' });
  const pool = readJson(baseline, 'retrieval-rounds/accumulated-pool.json');
  pool.candidates.find((c) => c.identity.questionId === '200').facts.title = '企业为什么还需要工程师？ - 知乎';
  writeJson(baseline, 'retrieval-rounds/accumulated-pool.json', pool);
  const outDir = path.join(tmpDir('p4-replay-'), 'single');
  const replay = await replayAnalysis(baseline, { outDir, runtime: runtime(), ...offline });
  assert.equal(replay.ok, true, JSON.stringify(replay.info));
  assert.deepEqual(replay.info.titleFilledFromSearch, ['200']);
  assert.equal(readJson(outDir, 'zhihu/200/answers.json').questionTitle, '企业为什么还需要工程师？');
  assert.equal(readJson(outDir, 'zhihu/100/answers.json').questionTitle, 'AI 编程工具会让初级程序员失业吗？');
});

test('RP6: refusals — non-empty output, unfinished baseline, CLI usage', async () => {
  const baseline = await completedRun('p4-replay-base-');
  const busy = tmpDir('p4-replay-busy-');
  fs.writeFileSync(path.join(busy, 'x'), 'x');
  await assert.rejects(() => replayAnalysis(baseline, { outDir: busy, runtime: runtime(), ...offline }), (e) => e.code === 'OUT_NOT_EMPTY');
  const pendingDecision = readJson(baseline, 'source-group-selection-decision.json');
  writeJson(baseline, 'source-group-selection-decision.json', { ...pendingDecision, verdict: 'clarify' });
  await assert.rejects(() => replayAnalysis(baseline, { outDir: path.join(tmpDir('p4-replay-'), 'y'), runtime: runtime(), ...offline }),
    (e) => e.code === 'BASELINE_INCOMPLETE');
  for (const args of [[], [baseline], [baseline, '--out'], [baseline, '--out', 'o', '--analysis', 'x'], [baseline, '--out', 'o', '--bogus']]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
  }
});
