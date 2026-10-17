// SPDX-License-Identifier: AGPL-3.0-only
/**
 * evaluation/run-scoring.mjs — offline scoring of a COMPLETE P1 run.
 *
 * Reads only existing run artifacts (it never re-runs, re-queries or calls a
 * model), so it cannot change run semantics. Three layers:
 *
 *   1. metrics: mechanical numbers from the report model (the same model that
 *      renders report.md) plus usage records and events — citation coverage,
 *      claim counts, multi-source claims, synthesis shape, model cost, time;
 *   2. scoring sheet: a human-filled form bound to the run and a gold set —
 *      gold viewpoint matches (with lexical suggestions), a deterministic sample
 *      of claims to check against their cited answers, and a 1–5 rubric;
 *   3. human scores: weighted gold recall, citation faithfulness, rubric mean.
 *
 * Untrusted text (answers, model statements) is plain text in JSON and is
 * neutralised before it reaches Markdown. Links are built from numeric IDs only.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { escapeUntrustedMarkdownText } from '../../zhihu-answer-grabber/src/markdown-security.js';
import { loadReportModel } from '../lib/report.mjs';

export const EVAL_DIR = 'evaluation';
export const METRICS_FILENAME = 'metrics.json';
export const SHEET_JSON_FILENAME = 'scoring-sheet.json';
export const SHEET_MD_FILENAME = 'scoring-sheet.md';
export const HUMAN_SCORES_FILENAME = 'human-scores.json';
export const DEFAULT_SAMPLE_SIZE = 10;
/** A multi-source claim is checked against its first few sources (in group order). */
export const MAX_CHECK_SOURCES = 3;

const CLAIM_KINDS = ['main', 'minority', 'contradictory'];
const STANCES = new Set(['supports', 'opposes', 'conditional']);
const MATCHES = { full: 1, partial: 0.5, none: 0 };
const VERDICTS = { supported: 1, partial: 0.5, unsupported: 0 };
const RUBRIC = [
  ['coverage', '覆盖：重要观点和视角是否都出现了'],
  ['faithfulness', '准确：结论是否忠实于引用的回答，没有夸大或曲解'],
  ['balance', '平衡：正反和条件性观点是否都有，比例是否合理'],
  ['usefulness', '可用：读完能否帮人形成判断，结构是否清楚'],
];
const EXCERPT_CHARS = 280;

export class ScoringError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScoringError';
    this.code = code;
  }
}

const round = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
const ratio = (part, whole) => (Number.isFinite(part) && Number.isFinite(whole) && whole > 0 ? round(part / whole) : null);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const md = (value) => escapeUntrustedMarkdownText(String(value ?? '').replace(/\s+/gu, ' ').trim());

function groupClaims(claimsArtifact) {
  const out = [];
  for (const rep of claimsArtifact?.groupRepresentations ?? []) {
    for (const kind of CLAIM_KINDS) {
      for (const c of rep?.claims?.[kind] ?? []) {
        if (!c || typeof c.claimId !== 'string') continue;
        const refs = [...new Set((c.sourceRefs ?? []).map((r) => (typeof r === 'string' ? r : r?.sourceRef)).filter((r) => typeof r === 'string'))];
        out.push({ claimId: c.claimId, groupId: rep.groupId, kind, statement: String(c.statement ?? ''), refs });
      }
    }
  }
  return out;
}

/** Sum compose spans: each p1_compose_begin until the next complete / failed / stop. */
function composeTime(events) {
  let start = null;
  let ms = 0;
  let occurrences = 0;
  for (const e of events ?? []) {
    const t = Date.parse(e?.ts);
    if (!Number.isFinite(t)) continue;
    if (e.event === 'p1_compose_begin') { start = t; occurrences += 1; continue; }
    if (start !== null && ['p1_compose_complete', 'p1_compose_failed', 'stop'].includes(e.event)) {
      ms += Math.max(0, t - start);
      start = null;
    }
  }
  return { composeMs: ms, occurrences };
}

function costOf(usage) {
  if (!Array.isArray(usage)) {
    return { available: false, calls: null, failedCalls: null, inputTokens: null, outputTokens: null, tokensComplete: null, byLabel: {} };
  }
  const byLabel = {};
  let input = 0;
  let output = 0;
  let complete = true;
  for (const u of usage) {
    const label = typeof u?.label === 'string' ? u.label : 'unknown';
    const b = (byLabel[label] ??= { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0 });
    b.calls += 1;
    if (u?.ok !== true) b.failedCalls += 1;
    if (Number.isFinite(u?.inputTokens)) { input += u.inputTokens; b.inputTokens += u.inputTokens; } else complete = false;
    if (Number.isFinite(u?.outputTokens)) { output += u.outputTokens; b.outputTokens += u.outputTokens; } else complete = false;
  }
  return {
    available: true,
    calls: usage.length,
    failedCalls: usage.filter((u) => u?.ok !== true).length,
    inputTokens: input,
    outputTokens: output,
    tokensComplete: complete,
    byLabel,
  };
}

/**
 * Mechanical metrics of a COMPLETE run.
 * @param {{model, index, result, claimsArtifact}} loaded  from loadReportModel()
 * @param {{events?: object[]}} [opts]
 */
export function computeMetrics({ model, index, result, claimsArtifact }, { events = [] } = {}) {
  const claims = groupClaims(claimsArtifact);
  const analyzed = model.overview.analyzedCount;
  const citedIds = (model.sources ?? []).map((s) => s.id);
  const citedByGroup = new Map();
  for (const id of citedIds) {
    const g = index?.sources?.get(id)?.groupId;
    if (g !== undefined) citedByGroup.set(g, (citedByGroup.get(g) ?? 0) + 1);
  }
  const multiSource = claims.filter((c) => c.refs.length >= 2).length;
  return {
    schemaVersion: 1,
    type: 'p1-run-metrics',
    runId: model.runId,
    topic: model.topic,
    runtime: { runtimeId: model.runtime?.runtimeId ?? null, model: model.runtime?.model ?? null },
    analysis: {
      groups: model.overview.groupCount,
      selectedCount: model.overview.selectedCount,
      analyzedCount: analyzed,
    },
    claims: {
      total: claims.length,
      main: claims.filter((c) => c.kind === 'main').length,
      minority: claims.filter((c) => c.kind === 'minority').length,
      contradictory: claims.filter((c) => c.kind === 'contradictory').length,
      multiSource,
      multiSourceRate: ratio(multiSource, claims.length),
      refsPerClaim: ratio(claims.reduce((n, c) => n + c.refs.length, 0), claims.length),
      perHundredAnswers: Number.isFinite(analyzed) && analyzed > 0 ? round((claims.length / analyzed) * 100) : null,
    },
    citations: {
      cited: citedIds.length,
      analyzed,
      coverage: ratio(citedIds.length, analyzed),
      perGroup: (model.groups ?? []).map((g) => ({
        groupId: g.groupId,
        questionId: g.questionId,
        title: g.title ?? null,
        analyzed: g.analyzed ?? null,
        cited: citedByGroup.get(g.groupId) ?? 0,
        coverage: ratio(citedByGroup.get(g.groupId) ?? 0, g.analyzed),
      })),
    },
    synthesis: {
      families: model.overview.familyCount,
      conflicting: model.overview.conflictingCount,
      crossGroup: model.overview.crossGroupCount,
      unresolved: (model.unresolved ?? []).length,
    },
    cost: costOf(result?.usage),
    time: composeTime(events),
  };
}

export function readEvents(workDir) {
  let text = '';
  try { text = fs.readFileSync(path.join(workDir, 'events.jsonl'), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Gold set

/** Load and validate a gold set; returns the gold object and its content hash. */
export function loadGoldset(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new ScoringError('GOLD_MISSING', `gold set not readable: ${path.basename(String(file))}`); }
  let gold;
  try { gold = JSON.parse(text); } catch { throw new ScoringError('GOLD_INVALID_JSON', 'gold set is not valid JSON'); }
  const fail = (msg) => { throw new ScoringError('GOLD_INVALID', msg); };
  if (gold?.schemaVersion !== 1 || gold?.type !== 'p1-goldset') fail('expected schemaVersion 1 and type "p1-goldset"');
  if (typeof gold.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(gold.id)) fail('id must be a lowercase slug');
  if (typeof gold.topic !== 'string' || !gold.topic.trim()) fail('topic is required');
  if (!['draft', 'reviewed'].includes(gold.status)) fail('status must be "draft" or "reviewed"');
  if (!Array.isArray(gold.viewpoints) || gold.viewpoints.length === 0) fail('viewpoints must be a non-empty array');
  const ids = new Set();
  for (const v of gold.viewpoints) {
    if (typeof v?.id !== 'string' || !/^v\d{2}$/.test(v.id) || ids.has(v.id)) fail(`viewpoint id must be unique like "v01" (got ${JSON.stringify(v?.id)})`);
    ids.add(v.id);
    if (typeof v.statement !== 'string' || !v.statement.trim()) fail(`${v.id}: statement is required`);
    if (!STANCES.has(v.stance)) fail(`${v.id}: stance must be supports | opposes | conditional`);
    if (![1, 2, 3].includes(v.weight)) fail(`${v.id}: weight must be 1, 2 or 3`);
  }
  const expected = gold.expectedSources ?? [];
  if (!Array.isArray(expected) || !expected.every((q) => typeof q === 'string' && /^\d{1,24}$/.test(q))) {
    fail('expectedSources must be an array of numeric Zhihu question IDs');
  }
  return { gold: { ...gold, expectedSources: expected }, hash: `sha256:${sha256(text)}` };
}

// ---------------------------------------------------------------------------
// Scoring sheet

function bigrams(text) {
  const s = String(text).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
  return set;
}

function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Untrusted HTML → short plain text (no markup survives; script/style bodies dropped). */
export function plainExcerpt(html, max = EXCERPT_CHARS) {
  const text = String(html ?? '')
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d{1,6});/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[<>]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function answerExcerpts(workDir, index) {
  const cache = new Map();
  return (ref) => {
    const s = index?.sources?.get(ref);
    if (!s || !/^\d+$/.test(String(s.questionId)) || !/^\d+$/.test(String(s.answerId))) return null;
    if (!cache.has(s.groupId)) {
      let doc = null;
      try {
        doc = JSON.parse(fs.readFileSync(path.join(workDir, 'zhihu', String(s.questionId), 'answers.json'), 'utf8'));
      } catch { doc = null; }
      cache.set(s.groupId, new Map((doc?.answers ?? []).map((a) => [String(a?.id), a?.content])));
    }
    return {
      url: `https://www.zhihu.com/question/${s.questionId}/answer/${s.answerId}`,
      excerpt: plainExcerpt(cache.get(s.groupId).get(String(s.answerId))),
    };
  };
}

/** Build the human scoring sheet for a COMPLETE run and a validated gold set. */
export function buildScoringSheet({ model, index, result, claimsArtifact, workDir, gold, goldHash, sampleSize = DEFAULT_SAMPLE_SIZE, maxCheckSources = MAX_CHECK_SOURCES }) {
  const claims = groupClaims(claimsArtifact);
  const runId = result?.runId ?? model.runId;
  const excerptFor = answerExcerpts(workDir, index);
  const viewpoints = gold.viewpoints.map((v) => ({
    id: v.id,
    statement: v.statement,
    stance: v.stance,
    weight: v.weight,
    suggestions: claims
      .map((c) => ({ claimId: c.claimId, statement: c.statement, score: round(similarity(v.statement, c.statement)) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => (b.score - a.score) || a.claimId.localeCompare(b.claimId))
      .slice(0, 3),
    match: null,
    matchedClaimIds: [],
    note: '',
  }));
  const claimChecks = claims
    .map((c) => ({ c, key: sha256(`${runId}:${c.claimId}`) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, Math.max(0, sampleSize))
    .map(({ c }) => ({
      claimId: c.claimId,
      kind: c.kind,
      statement: c.statement,
      sourceCount: c.refs.length,
      sources: c.refs.slice(0, maxCheckSources).map(excerptFor).filter(Boolean),
      verdict: null,
      note: '',
    }));
  return {
    schemaVersion: 1,
    type: 'p1-scoring-sheet',
    runId,
    topic: model.topic,
    goldId: gold.id,
    goldHash,
    instructions: {
      viewpoints: 'match 填 full（报告里有这个观点）、partial（只部分覆盖或说法偏差）、none（没有）；matchedClaimIds 可选填对应的系统观点 ID。suggestions 只是按字面相似度给的参考。',
      claimChecks: `verdict 填 supported（引用的回答确实支持这条观点）、partial（部分支持或有夸大）、unsupported（不支持或无关）。必要时点开链接看原文。引用多于 ${maxCheckSources} 条的观点只列出前 ${maxCheckSources} 条，按列出的判断。`,
      rubric: '每项填 1–5 的整数，5 最好。',
    },
    viewpoints,
    claimChecks,
    rubric: Object.fromEntries(RUBRIC.map(([k]) => [k, null])),
    rubricGuide: Object.fromEntries(RUBRIC),
  };
}

const STANCE_LABEL = { supports: '支持', opposes: '反对', conditional: '视情况' };

export function renderScoringSheetMarkdown(sheet) {
  const lines = [
    `# 评分表：${md(sheet.topic)}`,
    '',
    `运行 \`${sheet.runId.slice(0, 12)}\` · 黄金集 \`${sheet.goldId}\``,
    '',
    '在同目录的 `scoring-sheet.json` 里填写，本文件只是方便阅读。填完后运行：',
    '',
    '```bash',
    'node research-orchestration/evaluation/score-run.mjs <运行目录> --sheet <运行目录>/evaluation/scoring-sheet.json',
    '```',
    '',
    '## 一、黄金观点是否被覆盖',
    '',
    md(sheet.instructions.viewpoints),
    '',
  ];
  for (const v of sheet.viewpoints) {
    lines.push(`### ${v.id}（${STANCE_LABEL[v.stance] ?? v.stance}，权重 ${v.weight}）`, '', md(v.statement), '');
    if (v.suggestions.length) {
      lines.push('参考（字面相似度）：', '');
      for (const s of v.suggestions) lines.push(`- \`${s.claimId}\` ${md(s.statement)}（${s.score}）`);
      lines.push('');
    }
  }
  lines.push('## 二、引用是否支持结论', '', md(sheet.instructions.claimChecks), '');
  for (const c of sheet.claimChecks) {
    lines.push(`### \`${c.claimId}\``, '', md(c.statement), '');
    for (const s of c.sources) lines.push(`- [原回答](${s.url})：${md(s.excerpt)}`);
    if (c.sourceCount > c.sources.length) lines.push(`- （共引用 ${c.sourceCount} 条回答，这里列出 ${c.sources.length} 条）`);
    lines.push('');
  }
  lines.push('## 三、整体评分（1–5）', '');
  for (const [k, guide] of Object.entries(sheet.rubricGuide)) lines.push(`- \`${k}\`：${md(guide)}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Human scores

/** Aggregate a filled sheet. Refuses unfilled or out-of-range values. */
export function scoreSheet(sheet) {
  if (sheet?.type !== 'p1-scoring-sheet' || sheet?.schemaVersion !== 1) throw new ScoringError('SHEET_INVALID', 'not a p1 scoring sheet');
  const invalid = (msg) => { throw new ScoringError('SHEET_INVALID', msg); };
  const missing = [];
  let weightTotal = 0;
  let weighted = 0;
  const counts = { full: 0, partial: 0, none: 0 };
  for (const v of sheet.viewpoints ?? []) {
    if (v.match === null || v.match === undefined) { missing.push(v.id); continue; }
    if (!(v.match in MATCHES)) invalid(`${v.id}: match must be full | partial | none`);
    counts[v.match] += 1;
    weightTotal += v.weight;
    weighted += v.weight * MATCHES[v.match];
  }
  const verdicts = { supported: 0, partial: 0, unsupported: 0 };
  let support = 0;
  for (const c of sheet.claimChecks ?? []) {
    if (c.verdict === null || c.verdict === undefined) { missing.push(c.claimId); continue; }
    if (!(c.verdict in VERDICTS)) invalid(`${c.claimId}: verdict must be supported | partial | unsupported`);
    verdicts[c.verdict] += 1;
    support += VERDICTS[c.verdict];
  }
  const rubric = {};
  for (const [k] of RUBRIC) {
    const x = sheet.rubric?.[k];
    if (x === null || x === undefined) { missing.push(`rubric.${k}`); continue; }
    if (!Number.isInteger(x) || x < 1 || x > 5) invalid(`rubric.${k} must be an integer 1–5`);
    rubric[k] = x;
  }
  if (missing.length) throw new ScoringError('SHEET_INCOMPLETE', `unfilled: ${missing.join(', ')}`);
  const n = (sheet.claimChecks ?? []).length;
  const rubricValues = Object.values(rubric);
  return {
    schemaVersion: 1,
    type: 'p1-human-scores',
    runId: sheet.runId,
    goldId: sheet.goldId,
    goldHash: sheet.goldHash,
    goldRecall: { score: ratio(weighted, weightTotal), ...counts, weightTotal },
    faithfulness: { score: ratio(support, n), ...verdicts, n },
    rubric: { ...rubric, mean: round(rubricValues.reduce((a, b) => a + b, 0) / rubricValues.length) },
  };
}

// ---------------------------------------------------------------------------
// Orchestration (used by the CLI)

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Score a run directory. Always writes metrics; with goldFile writes a new sheet
 * (refusing to overwrite unless force); with sheetFile writes human scores.
 */
export function scoreRun(workDir, { goldFile = null, sheetFile = null, force = false, sampleSize = DEFAULT_SAMPLE_SIZE } = {}) {
  const loaded = loadReportModel(workDir);
  const metrics = computeMetrics(loaded, { events: readEvents(workDir) });
  const evalDir = path.join(workDir, EVAL_DIR);
  const metricsPath = path.join(evalDir, METRICS_FILENAME);
  writeJson(metricsPath, metrics);
  const out = { metrics, metricsPath };

  if (goldFile) {
    const { gold, hash } = loadGoldset(goldFile);
    const sheetPath = path.join(evalDir, SHEET_JSON_FILENAME);
    if (fs.existsSync(sheetPath) && !force) {
      throw new ScoringError('SHEET_EXISTS', 'a scoring sheet already exists (it may be filled in); pass --force to replace it');
    }
    const sheet = buildScoringSheet({ ...loaded, workDir, gold, goldHash: hash, sampleSize });
    writeJson(sheetPath, sheet);
    fs.writeFileSync(path.join(evalDir, SHEET_MD_FILENAME), renderScoringSheetMarkdown(sheet));
    out.sheetPath = sheetPath;
    out.sheet = sheet;
  }

  if (sheetFile) {
    let sheet;
    try { sheet = JSON.parse(fs.readFileSync(sheetFile, 'utf8')); } catch { throw new ScoringError('SHEET_INVALID', 'scoring sheet is not readable JSON'); }
    if (sheet?.runId !== metrics.runId) throw new ScoringError('SHEET_RUN_MISMATCH', 'the sheet belongs to a different run');
    const human = scoreSheet(sheet);
    const humanPath = path.join(evalDir, HUMAN_SCORES_FILENAME);
    writeJson(humanPath, human);
    out.human = human;
    out.humanPath = humanPath;
  }
  return out;
}
