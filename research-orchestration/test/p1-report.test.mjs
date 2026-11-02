// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-report.test.mjs
 *
 * report.md: the human-readable view of a COMPLETE P1 run.
 *
 *   R1  a real offline composition renders a report whose every claim links
 *       to exactly the answers in its controller-owned sourceRefs;
 *   R2  the CLI renders the report on the reuse path, prints its path, and
 *       --json reports it — and report.md does not disturb checkpoint reuse;
 *   R3  a report that cannot be written never changes the run's exit code;
 *   R4  untrusted strings cannot create Markdown structure, HTML or links;
 *   R5  links are built only from numeric IDs; artifact refs outside the
 *       work directory are never read;
 *   R6  incomplete or missing artifacts fail with a coded ReportError.
 *
 * Fully offline: injected providers / capture / runner / embeddings / runtime.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { deriveCanonicalSourceId } from '../lib/rce-input-adapter.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import {
  REPORT_FILENAME, ReportError, buildReportModel, buildSourceIndex, renderReportMarkdown, writeReport,
} from '../lib/report.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';

const CLI = fileURLToPath(new URL('../bin/research-p1.mjs', import.meta.url));
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
const DOCS = {
  100: {
    questionId: '100',
    questionTitle: 'AI 编程工具会让初级程序员失业吗？',
    answers: [
      { id: '1001', content: '重复性的增删改查会被自动化。', author: '甲', voteupCount: 120 },
      { id: '1002', content: '我们团队招聘没有减少。', author: '乙', voteupCount: 80 },
      { id: '1003', content: '被取代的是不学习的人。', author: '丙', voteupCount: 30 },
    ],
  },
  200: {
    questionId: '200',
    questionTitle: '企业为什么还需要工程师？',
    answers: [
      { id: '2001', content: '责任边界需要人承担。', author: '丁', voteupCount: 60 },
      { id: '2002', content: '小团队能做大项目。', author: '戊', voteupCount: 15 },
    ],
  },
};

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function searchResult(providerId) {
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: NOW(),
    items: [['100', 1], ['200', 2]].map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
  };
}

function seam() {
  const adapter = (providerId) => ({
    providerId, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve: () => searchResult(providerId),
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
    const doc = DOCS[String(questionId)];
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

function runner(name, args) {
  const doc = () => JSON.parse(fs.readFileSync(path.join(args[0], 'answers.json'), 'utf8'));
  if (name === 'zhihu-verify') {
    const d = doc();
    return { status: 0, stdout: JSON.stringify({ valid: true, questionId: String(d.questionId), capturedAnswerCount: d.answers.length, reportedAnswerCount: d.answers.length }) };
  }
  if (name === 'zhihu-handoff') {
    fs.writeFileSync(path.join(args[0], 'handoff.json'), JSON.stringify({ questionId: String(doc().questionId), task: 'digest', sourceType: 'session-capture', verified: true, generatedBy: 'fixture' }));
    return { status: 0, stdout: '' };
  }
  if (name === 'corpus-verify-handoff') return { status: 0, stdout: JSON.stringify({ valid: true }) };
  throw new Error(`unexpected runner command: ${name}`);
}

const embeddingProvider = {
  preflight: async () => ({ ok: true }),
  embed: async (texts) => ({ vectors: texts.map(() => mockVector768(7)) }),
};

/** Runtime double: group 100 yields main/minority/contradictory, group 200 main/minority. */
function runtime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async ({ projection }) => {
      const t = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      return t.length === 3
        ? { main: [{ tokenRef: t[0], statement: '观点甲' }], minority: [{ tokenRef: t[2], statement: '观点丙' }], contradictory: [{ tokenRef: t[1], statement: '观点乙' }], expertEvidenceRichTokens: [t[1]] }
        : { main: [{ tokenRef: t[0], statement: '观点丁' }], minority: [{ tokenRef: t[1], statement: '观点戊' }], contradictory: [], expertEvidenceRichTokens: [] };
    },
    async synthesize({ claims }) {
      const id = (s) => claims.find((c) => c.statement === s).claimId;
      return {
        families: [
          { aspect: '议题一', anchorClaimId: id('观点甲'), members: [{ claimId: id('观点甲'), stance: 'ASSERTS' }, { claimId: id('观点乙'), stance: 'OPPOSES' }] },
          { aspect: '议题二', anchorClaimId: id('观点丁'), members: [{ claimId: id('观点丁'), stance: 'ASSERTS' }, { claimId: id('观点戊'), stance: 'ASSERTS' }] },
        ],
        unresolvedClaimIds: [id('观点丙')],
      };
    },
  };
}

async function completedRun() {
  const workDir = tmpDir('p1-report-');
  const out = await composeP1Research({
    topic: TOPIC, workDir, plan: PLAN, runtime: runtime(), seam: seam(), captureAdapter, runner, embeddingProvider,
  });
  assert.equal(out.ok, true, `fixture composition failed: ${JSON.stringify(out)}`);
  return workDir;
}

function readJson(workDir, rel) {
  return JSON.parse(fs.readFileSync(path.join(workDir, rel), 'utf8'));
}

/** canonicalSourceId → answer URL, computed independently of report.mjs. */
function expectedAnswerUrls() {
  const map = new Map();
  for (const [groupId, doc] of Object.entries(DOCS)) {
    for (const a of doc.answers) {
      map.set(deriveCanonicalSourceId(groupId, a.id), `https://www.zhihu.com/question/${doc.questionId}/answer/${a.id}`);
    }
  }
  return map;
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, TOPIC, ...args], { encoding: 'utf8', timeout: 60_000 });
}

test('R1: every claim line links exactly the answers in its sourceRefs; overview counts are mechanical', async () => {
  const workDir = await completedRun();
  const { reportPath, model } = writeReport(workDir);
  assert.equal(reportPath, path.join(workDir, REPORT_FILENAME));
  const report = fs.readFileSync(reportPath, 'utf8');
  const urls = expectedAnswerUrls();
  const claims = readJson(workDir, 'per-group-claims.json');

  const allRefs = new Set();
  for (const rep of claims.groupRepresentations) {
    for (const kind of ['main', 'minority', 'contradictory']) {
      for (const claim of rep.claims[kind]) {
        claim.sourceRefs.forEach((r) => allRefs.add(r));
        const line = report.split('\n').find((l) => l.startsWith(`- ${claim.statement} `));
        assert.ok(line, `claim "${claim.statement}" missing from report`);
        const linked = [...line.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1]).sort();
        assert.deepEqual(linked, claim.sourceRefs.map((r) => urls.get(r)).sort(), `wrong citation for "${claim.statement}"`);
      }
    }
  }
  assert.equal(model.overview.citedCount, allRefs.size);
  assert.equal(model.overview.analyzedCount, 5);
  assert.equal(model.overview.familyCount, 2);
  assert.equal(model.overview.conflictingCount, 1);
  assert.match(report, /^# 研究报告：/m);
  assert.match(report, /### 1\. 议题/);
  assert.match(report, /\[AI 编程工具会让初级程序员失业吗？\]\(https:\/\/www\.zhihu\.com\/question\/100\)/);
  assert.match(report, /## 未归入议题的观点\n\n- 观点丙 /);
  assert.match(report, new RegExp(`结论实际引用了 ${allRefs.size}/5`));
});

test('R2: CLI renders report.md on the reuse path, prints its path, reports it in --json, and reuse still holds', async () => {
  const workDir = await completedRun();
  const resultBefore = fs.readFileSync(path.join(workDir, 'research-result.json'), 'utf8');

  const human = runCli(['--work', workDir]);
  assert.equal(human.status, 0, human.stderr);
  assert.ok(human.stdout.includes(`报告：${path.join(workDir, REPORT_FILENAME)}`), human.stdout);
  assert.match(human.stdout, /2 个议题（存在分歧 1）/);
  assert.ok(fs.existsSync(path.join(workDir, REPORT_FILENAME)));

  // A second run with report.md present must still be a legal reuse.
  const json = runCli(['--work', workDir, '--json']);
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.reused, true);
  assert.equal(parsed.report, REPORT_FILENAME);
  assert.equal(fs.readFileSync(path.join(workDir, 'research-result.json'), 'utf8'), resultBefore,
    'rendering the report must not touch canonical artifacts');
});

test('R3: a report that cannot be written warns but keeps exit 0 and the canonical result', async () => {
  const workDir = await completedRun();
  fs.mkdirSync(path.join(workDir, REPORT_FILENAME)); // writeFileSync onto a directory fails

  const json = runCli(['--work', workDir, '--json']);
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.report, null);
  assert.match(json.stderr, /未能生成 report\.md/);
});

function hostileFixture() {
  const workDir = tmpDir('p1-report-hostile-');
  const evil = '\n# 注入标题\n![x](https://evil.example/x.png) <script>alert(1)</script> [点我](javascript:alert(1))';
  fs.mkdirSync(path.join(workDir, 'zhihu', '100'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'zhihu', '100', 'answers.json'), JSON.stringify({
    questionId: '100',
    questionTitle: `标题${evil}`,
    answers: [{ id: '1001', author: `作者${evil}`, voteupCount: '1. fake' }],
  }));
  const ref = deriveCanonicalSourceId('100', '1001');
  const claim = (statement) => ({ claimId: 'c-100-001', statement, sourceRefs: [ref] });
  return {
    workDir,
    ref,
    groupState: { groups: { 100: { groupId: '100', questionId: '100', evidenceRef: 'zhihu/100/answers.json' } } },
    result: { ok: true, topic: `主题${evil}`, runtime: { runtimeId: `rt${evil}`, model: 'm' }, disclosure: { analysisCoverage: { selectedCount: 1, analyzedCount: 1 }, isFullCoverage: true, retrieval: { retrievalRounds: 1, stopReason: `stop${evil}` } } },
    synthesisArtifact: { synthesis: {
      families: [{
        aspect: `议题${evil}`,
        relationStatus: 'SUPPORT_ONLY',
        supportBreadth: 'SINGLE_GROUP',
        relationships: [{ sourceClaimId: 'c-100-001', stance: 'ASSERTS' }],
        sourceClaims: [{ sourceClaimId: 'c-100-001', statement: `观点${evil}`, sourceRefs: [{ sourceRef: ref, groupId: '100' }] }],
      }],
      unresolved: [],
    } },
    claimsArtifact: { groupRepresentations: [{ groupId: '100', accounting: { analyzed: 1 }, claims: { main: [claim(`观点${evil}`)], minority: [], contradictory: [] }, expertEvidenceRichRefs: [] }] },
  };
}

test('R4: untrusted strings cannot create headings, images, HTML or links', () => {
  const f = hostileFixture();
  const index = buildSourceIndex(f.workDir, f.groupState);
  const report = renderReportMarkdown(buildReportModel({ ...f, index }));

  assert.doesNotMatch(report, /(^|[^\\])</m, 'every < must be backslash-escaped');
  assert.doesNotMatch(report, /^\S*#+ 注入标题/m);
  assert.doesNotMatch(report, /^\\?# 注入/m, 'untrusted newlines must not start a new line');
  assert.doesNotMatch(report, /!\[x\]\(/);
  assert.doesNotMatch(report, /\]\(javascript:/i);
  assert.doesNotMatch(report, /\]\(https:\/\/evil\.example/);
  const links = [...report.matchAll(/\]\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.match(link, /^https:\/\/www\.zhihu\.com\/question\/\d+(\/answer\/\d+)?$/, `unexpected link ${link}`);
  }
  // Every line that starts a heading or list item is one the renderer produced.
  for (const line of report.split('\n')) {
    if (/^#/.test(line)) assert.match(line, /^(# 研究报告：|## |### )/, `foreign heading: ${line}`);
  }
  assert.doesNotMatch(report, /1\. fake 赞同/, 'non-numeric vote counts are dropped');
});

test('R5: no link for non-numeric IDs; refs outside the work directory are never read', () => {
  const f = hostileFixture();
  // Non-numeric ids → no URL.
  const index = buildSourceIndex(f.workDir, f.groupState);
  const src = index.sources.get(f.ref);
  index.sources.set(f.ref, { ...src, answerId: '1001/../../x' });
  const noLink = renderReportMarkdown(buildReportModel({ ...f, index }));
  assert.doesNotMatch(noLink, /\/answer\//);

  // Traversal: a readable answers.json OUTSIDE workDir is ignored.
  const outside = tmpDir('p1-report-outside-');
  fs.writeFileSync(path.join(outside, 'answers.json'), JSON.stringify({ questionId: '100', questionTitle: 'OUTSIDE_SECRET_TITLE', answers: [] }));
  const rel = path.relative(f.workDir, path.join(outside, 'answers.json'));
  for (const evidenceRef of [rel, path.join(outside, 'answers.json')]) {
    const idx = buildSourceIndex(f.workDir, { groups: { 100: { groupId: '100', questionId: '100', evidenceRef } } });
    assert.equal(idx.groups.get('100').title, null, `read outside workDir via ${evidenceRef}`);
    assert.equal(idx.sources.size, 0);
  }
});

test('R6: incomplete run and missing artifacts fail with coded errors', async () => {
  const f = hostileFixture();
  const index = buildSourceIndex(f.workDir, f.groupState);
  assert.throws(() => buildReportModel({ ...f, index, result: { ...f.result, ok: false } }),
    (e) => e instanceof ReportError && e.code === 'REPORT_RUN_NOT_COMPLETE');

  const empty = tmpDir('p1-report-empty-');
  assert.throws(() => writeReport(empty), (e) => e instanceof ReportError && e.code === 'REPORT_INPUT_MISSING');
  fs.writeFileSync(path.join(empty, 'research-result.json'), '{not json');
  assert.throws(() => writeReport(empty), (e) => e instanceof ReportError && e.code === 'REPORT_INPUT_INVALID');
});
