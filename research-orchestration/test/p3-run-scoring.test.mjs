// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p3-run-scoring.test.mjs
 *
 * evaluation/run-scoring.mjs + evaluation/score-run.mjs — offline scoring of a
 * COMPLETE P1 run against a human gold set.
 *
 *   S0  the composer persists the model layer's usage records in
 *       research-result.json (no key material);
 *   S1  automatic metrics of a real offline run match its artifacts and the
 *       report model; missing usage is "unavailable", never zero;
 *   S2  citation coverage, multi-source claims, usage per label and compose
 *       time are computed mechanically;
 *   S3  malformed gold sets fail with a coded error;
 *   S4  the scoring sheet is bound to the run and the gold set, samples claims
 *       deterministically, links only numeric IDs, strips HTML from excerpts,
 *       neutralises untrusted text in Markdown and never overwrites a sheet;
 *   S5  a filled sheet yields weighted gold recall, citation faithfulness and
 *       rubric scores; unfilled, out-of-range or foreign sheets are refused;
 *   S6  the CLI writes metrics, the sheet and human scores with stable exit codes.
 *
 * Fully offline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { CLAIMS_SYSTEM_PROMPT } from '../lib/research-prompts.mjs';
import { loadReportModel } from '../lib/report.mjs';
import {
  EVAL_DIR, METRICS_FILENAME, SHEET_JSON_FILENAME, SHEET_MD_FILENAME, HUMAN_SCORES_FILENAME,
  ScoringError, buildScoringSheet, computeMetrics, loadGoldset, renderScoringSheetMarkdown,
  scoreRun, scoreSheet,
} from '../evaluation/run-scoring.mjs';
import {
  DOCS, PLAN, TOPIC, captureAdapter, completedRun, embeddingProvider, runner, seam, tmpDir,
} from './helpers/p1-offline-run.mjs';
import { fakeModelRuntime, messagesOf } from './helpers/fake-model-transport.mjs';

const CLI = fileURLToPath(new URL('../evaluation/score-run.mjs', import.meta.url));

const GOLD = {
  schemaVersion: 1,
  type: 'p1-goldset',
  id: 't1-test',
  topic: TOPIC,
  status: 'draft',
  viewpoints: [
    { id: 'v01', statement: '重复性的编码工作会被自动化', stance: 'supports', weight: 3 },
    { id: 'v02', statement: '团队招聘并没有减少', stance: 'opposes', weight: 2 },
    { id: 'v03', statement: '会用 AI 的人取代不会用的人', stance: 'conditional', weight: 1 },
  ],
  expectedSources: [],
};

function writeGold(dir, gold = GOLD) {
  const file = path.join(dir, 'gold.json');
  fs.writeFileSync(file, JSON.stringify(gold, null, 2));
  return file;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60_000 });
}

test('S0: the composer persists model usage records in research-result.json, without key material', async () => {
  const usageSink = [];
  const usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };
  const { runtime } = await fakeModelRuntime((body) => {
    const { system, user } = messagesOf(body);
    if (system === CLAIMS_SYSTEM_PROMPT) {
      const t = [...user.matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      return { text: JSON.stringify({ main: [{ tokenRef: t[0], statement: `观点${t.length}` }], minority: [], contradictory: [], expertEvidenceRichTokens: [] }), usage };
    }
    const { claims } = JSON.parse(user);
    return {
      text: JSON.stringify({
        families: [{ aspect: '议题', anchorClaimId: claims[0].claimId, members: claims.map((c) => ({ claimId: c.claimId, stance: 'ASSERTS' })) }],
        unresolvedClaimIds: [],
      }),
      usage,
    };
  }, { usageSink });

  const workDir = tmpDir('p3-usage-');
  const out = await composeP1Research({
    topic: TOPIC, workDir, plan: PLAN, runtime, seam: seam(), captureAdapter, runner, embeddingProvider, usageSink,
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  const result = readJson(path.join(workDir, 'research-result.json'));
  assert.deepEqual(result.usage.map((u) => u.label), ['analyze', 'analyze', 'synthesize']);
  assert.ok(result.usage.every((u) => u.ok === true && u.inputTokens === 120 && u.outputTokens === 30));
  assert.doesNotMatch(JSON.stringify(result.usage), /sk-|apiKey|authorization/i);

  const metrics = computeMetrics(loadReportModel(workDir), { events: [] });
  assert.equal(metrics.cost.available, true);
  assert.equal(metrics.cost.calls, 3);
  assert.equal(metrics.cost.inputTokens, 360);
  assert.equal(metrics.cost.outputTokens, 90);
  assert.deepEqual(metrics.cost.byLabel.analyze, { calls: 2, failedCalls: 0, inputTokens: 240, outputTokens: 60 });
});

test('S1: metrics of a real offline run match its artifacts; missing usage is unavailable, not zero', async () => {
  const workDir = await completedRun('p3-metrics-');
  const { metrics, metricsPath } = scoreRun(workDir);
  assert.equal(metricsPath, path.join(workDir, EVAL_DIR, METRICS_FILENAME));
  assert.deepEqual(readJson(metricsPath), metrics);

  const result = readJson(path.join(workDir, 'research-result.json'));
  assert.equal(metrics.type, 'p1-run-metrics');
  assert.equal(metrics.runId, result.runId);
  assert.equal(metrics.topic, TOPIC);
  assert.deepEqual(metrics.analysis, { groups: 2, selectedCount: 5, analyzedCount: 5 });
  assert.deepEqual(
    { total: metrics.claims.total, main: metrics.claims.main, minority: metrics.claims.minority, contradictory: metrics.claims.contradictory },
    { total: 5, main: 2, minority: 2, contradictory: 1 },
  );
  assert.equal(metrics.citations.cited, 5);
  assert.equal(metrics.citations.coverage, 1);
  assert.deepEqual(metrics.citations.perGroup.map((g) => [g.questionId, g.analyzed, g.cited]), [['100', 3, 3], ['200', 2, 2]]);
  assert.deepEqual(metrics.synthesis, { families: 2, conflicting: 1, crossGroup: 0, unresolved: 1 });
  assert.equal(metrics.cost.available, false);
  assert.equal(metrics.cost.calls, null);
  assert.equal(metrics.cost.inputTokens, null);
  assert.ok(metrics.time.composeMs >= 0);
  assert.equal(metrics.time.occurrences, 1);
});

test('S2: coverage, multi-source claims, usage by label and compose time are mechanical', () => {
  const src = (g, a) => [`asrc-${g}-${a}`, { groupId: g, questionId: g, answerId: a }];
  const index = { sources: new Map([src('10', '1'), src('10', '2'), src('10', '3'), src('10', '4'), src('20', '5'), src('20', '6')]), groups: new Map() };
  const claimsArtifact = {
    groupRepresentations: [
      { groupId: '10', accounting: { analyzed: 4 }, claims: { main: [{ claimId: 'c1', statement: 'a', sourceRefs: ['asrc-10-1', 'asrc-10-2'] }], minority: [{ claimId: 'c2', statement: 'b', sourceRefs: ['asrc-10-1', 'asrc-10-1'] }], contradictory: [] } },
      { groupId: '20', accounting: { analyzed: 2 }, claims: { main: [{ claimId: 'c3', statement: 'c', sourceRefs: ['asrc-20-5', 'asrc-20-6', 'asrc-20-5'] }], minority: [], contradictory: [] } },
    ],
  };
  const model = {
    topic: 'T', runId: 'r', runtime: { runtimeId: 'x-api-tool-less', model: 'm' },
    overview: { groupCount: 2, analyzedCount: 6, selectedCount: 6, familyCount: 1, conflictingCount: 0, crossGroupCount: 1 },
    unresolved: [],
    groups: [
      { groupId: '10', questionId: '10', title: 'A', analyzed: 4 },
      { groupId: '20', questionId: '20', title: 'B', analyzed: 2 },
    ],
    sources: [{ id: 'asrc-10-1' }, { id: 'asrc-10-2' }, { id: 'asrc-20-5' }, { id: 'asrc-20-6' }],
  };
  const result = {
    usage: [
      { label: 'planner', ok: true, inputTokens: 100, outputTokens: 50 },
      { label: 'analyze', ok: false, inputTokens: 0, outputTokens: 0 },
      { label: 'analyze', ok: true, inputTokens: 1000, outputTokens: 200 },
      { label: 'synthesize', ok: true, inputTokens: null, outputTokens: 70 },
    ],
  };
  const events = [
    { ts: '2026-10-16T00:00:00.000Z', event: 'p1_compose_begin' },
    { ts: '2026-10-16T00:00:10.000Z', event: 'stop', reason: 'clarification_required' },
    { ts: '2026-10-16T01:00:00.000Z', event: 'p1_compose_begin' },
    { ts: '2026-10-16T01:00:05.500Z', event: 'p1_compose_complete' },
  ];
  const m = computeMetrics({ model, index, result, claimsArtifact }, { events });

  assert.equal(m.citations.cited, 4);
  assert.equal(m.citations.coverage, 0.6667);
  assert.deepEqual(m.citations.perGroup.map((g) => [g.groupId, g.cited, g.coverage]), [['10', 2, 0.5], ['20', 2, 1]]);
  assert.equal(m.claims.total, 3);
  assert.equal(m.claims.multiSource, 2, 'refs are deduplicated before counting sources');
  assert.equal(m.claims.multiSourceRate, 0.6667);
  assert.equal(m.claims.refsPerClaim, 1.6667, 'a repeated ref counts once');
  assert.equal(m.claims.perHundredAnswers, 50);
  assert.equal(m.cost.available, true);
  assert.equal(m.cost.calls, 4);
  assert.equal(m.cost.failedCalls, 1);
  assert.equal(m.cost.inputTokens, 1100);
  assert.equal(m.cost.outputTokens, 320);
  assert.equal(m.cost.tokensComplete, false, 'an unknown token count is flagged, not hidden');
  assert.deepEqual(Object.keys(m.cost.byLabel).sort(), ['analyze', 'planner', 'synthesize']);
  assert.equal(m.time.composeMs, 15_500);
  assert.equal(m.time.occurrences, 2);
});

test('S3: malformed gold sets fail with a coded error', () => {
  const dir = tmpDir('p3-gold-');
  const bad = [
    ['not json', '{', 'GOLD_INVALID_JSON'],
    ['wrong type', { ...GOLD, type: 'x' }, 'GOLD_INVALID'],
    ['no viewpoints', { ...GOLD, viewpoints: [] }, 'GOLD_INVALID'],
    ['bad stance', { ...GOLD, viewpoints: [{ id: 'v1', statement: 's', stance: 'maybe', weight: 1 }] }, 'GOLD_INVALID'],
    ['bad weight', { ...GOLD, viewpoints: [{ id: 'v1', statement: 's', stance: 'supports', weight: 5 }] }, 'GOLD_INVALID'],
    ['duplicate id', { ...GOLD, viewpoints: [GOLD.viewpoints[0], GOLD.viewpoints[0]] }, 'GOLD_INVALID'],
    ['empty statement', { ...GOLD, viewpoints: [{ id: 'v1', statement: ' ', stance: 'supports', weight: 1 }] }, 'GOLD_INVALID'],
    ['bad expected source', { ...GOLD, expectedSources: ['https://example.com/q/1'] }, 'GOLD_INVALID'],
  ];
  for (const [name, content, code] of bad) {
    const file = path.join(dir, `${name.replace(/ /g, '-')}.json`);
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    assert.throws(() => loadGoldset(file), (e) => e instanceof ScoringError && e.code === code, name);
  }
  assert.throws(() => loadGoldset(path.join(dir, 'missing.json')), (e) => e.code === 'GOLD_MISSING');
  const { gold, hash } = loadGoldset(writeGold(dir));
  assert.equal(gold.id, 't1-test');
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
});

test('S4: the sheet is bound, deterministic, numeric-linked, HTML-free and safe to render; never overwritten', async () => {
  const workDir = await completedRun('p3-sheet-');
  // Hostile markup in a captured answer must not survive into the sheet.
  const answersFile = path.join(workDir, 'zhihu', '100', 'answers.json');
  const doc = readJson(answersFile);
  doc.answers[0].content = '<p>重复性的<b>增删改查</b>会被自动化。</p><script>alert(1)</script>\n# 标题 [点我](javascript:alert(1)) <img src=x onerror=alert(1)>';
  fs.writeFileSync(answersFile, JSON.stringify(doc));

  const goldFile = writeGold(tmpDir('p3-gold-'));
  const { gold, hash } = loadGoldset(goldFile);
  const loaded = loadReportModel(workDir);
  const sheet = buildScoringSheet({ ...loaded, workDir, gold, goldHash: hash, sampleSize: 3 });

  assert.equal(sheet.type, 'p1-scoring-sheet');
  assert.equal(sheet.runId, loaded.result.runId);
  assert.equal(sheet.goldId, 't1-test');
  assert.equal(sheet.goldHash, hash);
  assert.deepEqual(sheet.viewpoints.map((v) => [v.id, v.match]), [['v01', null], ['v02', null], ['v03', null]]);
  const systemIds = new Set(loaded.claimsArtifact.groupRepresentations.flatMap((r) => Object.values(r.claims).flat().map((c) => c.claimId)));
  for (const v of sheet.viewpoints) for (const s of v.suggestions) assert.ok(systemIds.has(s.claimId), 'suggestions come from the run only');
  assert.equal(sheet.viewpoints[0].suggestions.length <= 3, true);

  assert.equal(sheet.claimChecks.length, 3);
  // The sample is the first N claims ordered by sha256(runId:claimId) — computed independently here.
  const expectedSample = [...systemIds]
    .map((id) => [id, createHash('sha256').update(`${sheet.runId}:${id}`).digest('hex')])
    .sort((a, b) => a[1].localeCompare(b[1]))
    .slice(0, 3)
    .map(([id]) => id);
  assert.deepEqual(sheet.claimChecks.map((c) => c.claimId), expectedSample, 'sampling is deterministic and run-seeded');
  for (const check of sheet.claimChecks) {
    assert.equal(check.verdict, null);
    for (const s of check.sources) {
      assert.match(s.url, /^https:\/\/www\.zhihu\.com\/question\/\d+\/answer\/\d+$/);
      assert.doesNotMatch(s.excerpt, /<[a-z/]/i, 'excerpts are plain text');
      assert.doesNotMatch(s.excerpt, /alert\(1\)<\/script>|<script/i);
    }
  }
  const allExcerpts = sheet.claimChecks.flatMap((c) => c.sources.map((s) => s.excerpt)).join('\n');
  if (allExcerpts.includes('增删改查')) assert.doesNotMatch(allExcerpts, /alert\(1\)\s*#/, 'script bodies are dropped');

  const md = renderScoringSheetMarkdown(sheet);
  assert.doesNotMatch(md, /<script|<img|\]\(javascript:/i);
  assert.doesNotMatch(md, /^# 标题/m, 'untrusted text cannot create headings');

  // CLI-level write: a second --gold run refuses to overwrite a sheet that may be filled in.
  const first = scoreRun(workDir, { goldFile });
  assert.equal(first.sheetPath, path.join(workDir, EVAL_DIR, SHEET_JSON_FILENAME));
  assert.ok(fs.existsSync(path.join(workDir, EVAL_DIR, SHEET_MD_FILENAME)));
  assert.throws(() => scoreRun(workDir, { goldFile }), (e) => e.code === 'SHEET_EXISTS');
  scoreRun(workDir, { goldFile, force: true });
});

function filledSheet(sheet, { match = ['full', 'partial', 'none'], verdict = 'supported', rubric = { coverage: 4, faithfulness: 5, balance: 3, usefulness: 4 } } = {}) {
  const s = structuredClone(sheet);
  s.viewpoints.forEach((v, i) => { v.match = match[i]; });
  s.claimChecks.forEach((c, i) => { c.verdict = Array.isArray(verdict) ? verdict[i] : verdict; });
  s.rubric = rubric;
  return s;
}

test('S5: a filled sheet yields weighted recall, faithfulness and rubric; bad sheets are refused', async () => {
  const workDir = await completedRun('p3-human-');
  const goldFile = writeGold(tmpDir('p3-gold-'));
  const { gold, hash } = loadGoldset(goldFile);
  const sheet = buildScoringSheet({ ...loadReportModel(workDir), workDir, gold, goldHash: hash, sampleSize: 4 });

  const scores = scoreSheet(filledSheet(sheet, { verdict: ['supported', 'partial', 'unsupported', 'supported'] }));
  // weights 3 / 2 / 1 → (3·1 + 2·0.5 + 1·0) / 6
  assert.equal(scores.goldRecall.score, 0.6667);
  assert.deepEqual([scores.goldRecall.full, scores.goldRecall.partial, scores.goldRecall.none], [1, 1, 1]);
  assert.equal(scores.faithfulness.score, 0.625);
  assert.equal(scores.faithfulness.n, 4);
  assert.equal(scores.rubric.mean, 4);
  assert.equal(scores.runId, sheet.runId);

  assert.throws(() => scoreSheet(sheet), (e) => e.code === 'SHEET_INCOMPLETE', 'unfilled');
  assert.throws(() => scoreSheet(filledSheet(sheet, { match: ['full', 'yes', 'none'] })), (e) => e.code === 'SHEET_INVALID');
  assert.throws(() => scoreSheet(filledSheet(sheet, { rubric: { coverage: 6, faithfulness: 5, balance: 3, usefulness: 4 } })), (e) => e.code === 'SHEET_INVALID');
  assert.throws(() => scoreSheet(filledSheet(sheet, { verdict: 'maybe' })), (e) => e.code === 'SHEET_INVALID');

  // A sheet from another run cannot be scored against this run.
  const foreign = filledSheet(sheet);
  foreign.runId = 'f'.repeat(64);
  const foreignFile = path.join(tmpDir('p3-sheet-'), 'sheet.json');
  fs.writeFileSync(foreignFile, JSON.stringify(foreign));
  assert.throws(() => scoreRun(workDir, { sheetFile: foreignFile }), (e) => e.code === 'SHEET_RUN_MISMATCH');
});

test('S6: CLI writes metrics, the sheet and human scores; exit codes are stable', async () => {
  const workDir = await completedRun('p3-cli-');
  const goldFile = writeGold(tmpDir('p3-gold-'));

  const plain = cli([workDir]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /引用覆盖率：5\/5（100%）/);

  const withGold = cli([workDir, '--gold', goldFile, '--json']);
  assert.equal(withGold.status, 0, withGold.stderr);
  const out = JSON.parse(withGold.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.sheet, path.join(EVAL_DIR, SHEET_JSON_FILENAME));

  const again = cli([workDir, '--gold', goldFile, '--json']);
  assert.equal(again.status, 1);
  assert.equal(JSON.parse(again.stdout).error.code, 'SHEET_EXISTS');

  const sheetPath = path.join(workDir, EVAL_DIR, SHEET_JSON_FILENAME);
  fs.writeFileSync(sheetPath, JSON.stringify(filledSheet(readJson(sheetPath))));
  const scored = cli([workDir, '--sheet', sheetPath]);
  assert.equal(scored.status, 0, scored.stderr);
  assert.match(scored.stdout, /黄金观点召回：/);
  assert.ok(fs.existsSync(path.join(workDir, EVAL_DIR, HUMAN_SCORES_FILENAME)));

  assert.equal(cli([]).status, 2);
  assert.equal(cli([workDir, '--bogus']).status, 2);
  const incomplete = tmpDir('p3-empty-');
  const missing = cli([incomplete, '--json']);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).error.code, 'REPORT_INPUT_MISSING');
  assert.ok(DOCS);
});
