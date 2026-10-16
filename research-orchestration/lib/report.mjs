// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/report.mjs
 *
 * Human-readable `report.md` for a COMPLETE P1 run.
 *
 * The report is a DERIVED VIEW: it is rendered from the canonical run
 * artifacts after the run completes (fresh or reused), it is never read back
 * by the pipeline, and it is not part of the checkpoint binding. Deleting it
 * changes nothing; re-running the CLI re-renders it.
 *
 * Safety:
 *   - every string that came from Zhihu or from the model (topic, question
 *     titles, authors, statements, aspects) goes through
 *     escapeUntrustedMarkdownText, so it cannot create headings, links,
 *     images or HTML;
 *   - every link is built from verified numeric IDs, never from a URL stored
 *     in an artifact.
 */

import fs from 'node:fs';
import path from 'node:path';
import { escapeUntrustedMarkdownText } from '../../zhihu-answer-grabber/src/markdown-security.js';
import { deriveCanonicalSourceId } from './rce-input-adapter.mjs';

export const REPORT_FILENAME = 'report.md';

const RESULT_FILENAME = 'research-result.json';
const SYNTHESIS_FILENAME = 'cross-source-synthesis.json';
const CLAIMS_FILENAME = 'per-group-claims.json';
const GROUP_STATE_FILENAME = 'multi-group-state.json';

const CLAIM_KINDS = [['main', '主流观点'], ['minority', '少数观点'], ['contradictory', '反对观点']];
const NUMERIC_ID = /^\d+$/;

export class ReportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
  }
}

/**
 * Untrusted text → one escaped Markdown line. Every report slot (heading,
 * list item, table cell) is single-line, so whitespace runs (including
 * newlines) collapse to one space before escaping.
 */
const md = (value) => escapeUntrustedMarkdownText(String(value ?? '').replace(/\s+/gu, ' ').trim());

function readJson(workDir, rel) {
  const file = path.join(workDir, rel);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new ReportError('REPORT_INPUT_MISSING', `${rel} is missing`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ReportError('REPORT_INPUT_INVALID', `${rel} is not valid JSON`);
  }
}

/** Resolve a work-relative artifact ref, refusing anything outside workDir. */
function resolveInside(workDir, rel) {
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) return null;
  const root = path.resolve(workDir);
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

function questionUrl(questionId) {
  return NUMERIC_ID.test(String(questionId)) ? `https://www.zhihu.com/question/${questionId}` : null;
}

function answerUrl(questionId, answerId) {
  return NUMERIC_ID.test(String(questionId)) && NUMERIC_ID.test(String(answerId))
    ? `https://www.zhihu.com/question/${questionId}/answer/${answerId}`
    : null;
}

/**
 * canonicalSourceId → { questionId, answerId, author, voteupCount } from the
 * verified answers.json of every handed-off group, plus groupId → question meta.
 */
export function buildSourceIndex(workDir, groupState) {
  const sources = new Map();
  const groups = new Map();
  for (const g of Object.values(groupState?.groups ?? {})) {
    if (!g || typeof g.groupId !== 'string') continue;
    const abs = resolveInside(workDir, g.evidenceRef);
    let doc = null;
    if (abs) {
      try { doc = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { doc = null; }
    }
    const questionId = String(g.questionId ?? doc?.questionId ?? g.groupId);
    groups.set(g.groupId, {
      groupId: g.groupId,
      questionId,
      title: typeof doc?.questionTitle === 'string' && doc.questionTitle.trim() ? doc.questionTitle.trim() : null,
      answerCount: Array.isArray(doc?.answers) ? doc.answers.length : null,
    });
    for (const entry of Array.isArray(doc?.answers) ? doc.answers : []) {
      if (entry == null || entry.id == null || String(entry.id) === '') continue;
      const answerId = String(entry.id);
      sources.set(deriveCanonicalSourceId(g.groupId, answerId), {
        groupId: g.groupId,
        questionId,
        answerId,
        author: typeof entry.author === 'string' && entry.author.trim() ? entry.author.trim() : null,
        voteupCount: Number.isFinite(Number(entry.voteupCount)) ? Number(entry.voteupCount) : null,
      });
    }
  }
  return { sources, groups };
}

/** Assign citation numbers in order of first appearance. */
function createCitations() {
  const order = new Map();
  return {
    ref(id) {
      if (typeof id !== 'string') return null;
      if (!order.has(id)) order.set(id, order.size + 1);
      return order.get(id);
    },
    entries() {
      return [...order.entries()].map(([id, n]) => ({ id, n }));
    },
  };
}

function sourceRefIds(refs) {
  return (refs ?? []).map((r) => (typeof r === 'string' ? r : r?.sourceRef)).filter((r) => typeof r === 'string');
}

/**
 * Build the report model from loaded artifacts. Pure; no IO.
 */
export function buildReportModel({ result, synthesisArtifact, claimsArtifact, index }) {
  if (result?.ok !== true) {
    throw new ReportError('REPORT_RUN_NOT_COMPLETE', 'research-result.json does not describe a completed run');
  }
  const synthesis = synthesisArtifact?.synthesis ?? {};
  const groupReps = Array.isArray(claimsArtifact?.groupRepresentations) ? claimsArtifact.groupRepresentations : [];
  const citations = createCitations();

  const families = (Array.isArray(synthesis.families) ? synthesis.families : []).map((f) => {
    const claims = new Map((f.sourceClaims ?? []).map((c) => [c.sourceClaimId, c]));
    const side = (stance) => (f.relationships ?? [])
      .filter((r) => r.stance === stance)
      .map((r) => claims.get(r.sourceClaimId))
      .filter(Boolean)
      .map((c) => ({ statement: c.statement, refs: sourceRefIds(c.sourceRefs) }));
    const support = side('ASSERTS');
    const oppose = side('OPPOSES');
    const groupIds = new Set((f.sourceClaims ?? []).flatMap((c) => (c.sourceRefs ?? []).map((r) => r.groupId)));
    const sourceCount = new Set([...support, ...oppose].flatMap((c) => c.refs)).size;
    return {
      aspect: f.aspect,
      conflicting: f.relationStatus === 'CONFLICTING',
      crossGroup: f.supportBreadth === 'MULTI_GROUP',
      groupIds: [...groupIds].filter(Boolean).sort(),
      sourceCount,
      support,
      oppose,
    };
  });
  // Cross-question topics first, then by how many answers back them.
  families.sort((a, b) => (Number(b.crossGroup) - Number(a.crossGroup)) || (b.sourceCount - a.sourceCount));
  for (const f of families) for (const c of [...f.support, ...f.oppose]) c.refs.forEach((id) => citations.ref(id));

  const unresolved = (Array.isArray(synthesis.unresolved) ? synthesis.unresolved : [])
    .map((u) => u?.sourceClaim)
    .filter(Boolean)
    .map((c) => ({ statement: c.statement, refs: sourceRefIds(c.sourceRefs) }));
  for (const c of unresolved) c.refs.forEach((id) => citations.ref(id));

  const evidenceRich = new Set();
  const groups = groupReps.map((rep) => {
    (rep.expertEvidenceRichRefs ?? []).forEach((id) => evidenceRich.add(id));
    const meta = index.groups.get(rep.groupId) ?? {};
    const claims = {};
    for (const [kind] of CLAIM_KINDS) {
      claims[kind] = (rep.claims?.[kind] ?? []).map((c) => ({ statement: c.statement, refs: sourceRefIds(c.sourceRefs) }));
      for (const c of claims[kind]) c.refs.forEach((id) => citations.ref(id));
    }
    return {
      groupId: rep.groupId,
      questionId: meta.questionId ?? rep.canonicalGroupIdentity?.questionId ?? rep.groupId,
      title: meta.title ?? null,
      analyzed: rep.accounting?.analyzed ?? null,
      claims,
    };
  });

  const cited = citations.entries();
  const analysis = result.disclosure?.analysisCoverage ?? {};
  const retrieval = result.disclosure?.retrieval ?? {};
  return {
    topic: result.topic,
    runId: result.runId,
    runtime: result.runtime ?? {},
    overview: {
      groupCount: groups.length,
      analyzedCount: Number.isFinite(analysis.analyzedCount) ? analysis.analyzedCount : null,
      selectedCount: Number.isFinite(analysis.selectedCount) ? analysis.selectedCount : null,
      citedCount: cited.length,
      familyCount: families.length,
      conflictingCount: families.filter((f) => f.conflicting).length,
      crossGroupCount: families.filter((f) => f.crossGroup).length,
      retrievalRounds: retrieval.retrievalRounds ?? null,
      stopReason: retrieval.stopReason ?? null,
      isFullCoverage: result.disclosure?.isFullCoverage === true,
    },
    families,
    unresolved,
    groups,
    sources: cited.map(({ id, n }) => {
      const s = index.sources.get(id) ?? {};
      return { n, id, ...s, evidenceRich: evidenceRich.has(id) };
    }),
  };
}

function ratio(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return '—';
  return `${part}/${whole}（${Math.round((part / whole) * 100)}%）`;
}

function citationNote(cited, analyzed) {
  if (!Number.isFinite(analyzed) || analyzed <= 0) return '- 引用覆盖：没有可统计的已分析回答。';
  const head = `- 引用覆盖：结论实际引用了 ${ratio(cited, analyzed)}的已分析回答。`;
  return cited < analyzed
    ? `${head}其余 ${analyzed - cited} 条进入了分析，但没有被任何结论引用。`
    : head;
}

/** Render the model as Markdown. Pure. */
export function renderReportMarkdown(model) {
  const byId = new Map(model.sources.map((s) => [s.id, s]));
  const cite = (refs) => refs
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((s) => {
      const url = answerUrl(s.questionId, s.answerId);
      return url ? `[[${s.n}]](${url})` : `[${s.n}]`;
    })
    .join('');
  const claimLine = (c) => `- ${md(c.statement)} ${cite(c.refs)}`.trimEnd();
  const groupLabel = (g) => (g.title ? md(g.title) : `问题 ${md(g.questionId)}`);
  const groupsById = new Map(model.groups.map((g) => [g.groupId, g]));
  const o = model.overview;
  const lines = [];

  lines.push(`# 研究报告：${md(model.topic)}`, '');
  lines.push('> 本文件由研究结果自动生成，便于阅读；权威数据在同目录的 `research-result.json`、`cross-source-synthesis.json` 和 `per-group-claims.json`。', '');

  lines.push('## 概览', '');
  lines.push('| 项目 | 数值 |', '|---|---|');
  lines.push(`| 问题组 | ${o.groupCount} |`);
  lines.push(`| 已分析回答 | ${o.analyzedCount ?? '—'} |`);
  lines.push(`| 结论引用的回答 | ${ratio(o.citedCount, o.analyzedCount)} |`);
  lines.push(`| 议题 | ${o.familyCount}（跨问题 ${o.crossGroupCount}，存在分歧 ${o.conflictingCount}） |`);
  lines.push(`| 模型 | ${md([model.runtime.runtimeId, model.runtime.model].filter(Boolean).join(' / ') || '—')} |`);
  lines.push(`| 检索 | ${o.retrievalRounds ?? '—'} 轮，停止原因 ${md(o.stopReason ?? '—')} |`, '');

  lines.push('## 议题', '');
  if (model.families.length === 0) lines.push('没有形成可归类的议题。', '');
  model.families.forEach((f, i) => {
    const tags = [f.crossGroup ? '跨问题' : '单一问题', f.conflicting ? '存在分歧' : '无反对意见'];
    lines.push(`### ${i + 1}. ${md(f.aspect)}`, '');
    const where = f.groupIds.map((id) => groupsById.get(id)).filter(Boolean).map(groupLabel);
    lines.push(`${tags.join(' · ')} · ${f.sourceCount} 条回答${where.length ? ` · 来自：${where.join('；')}` : ''}`, '');
    if (f.support.length) lines.push('**支持**', '', ...f.support.map(claimLine), '');
    if (f.oppose.length) lines.push('**反对**', '', ...f.oppose.map(claimLine), '');
  });

  if (model.unresolved.length) {
    lines.push('## 未归入议题的观点', '');
    lines.push(...model.unresolved.map(claimLine), '');
  }

  lines.push('## 各问题组观点', '');
  for (const g of model.groups) {
    const url = questionUrl(g.questionId);
    lines.push(`### ${url ? `[${groupLabel(g)}](${url})` : groupLabel(g)}`, '');
    if (Number.isFinite(g.analyzed)) lines.push(`已分析 ${g.analyzed} 条回答。`, '');
    let any = false;
    for (const [kind, label] of CLAIM_KINDS) {
      if (!g.claims[kind].length) continue;
      any = true;
      lines.push(`**${label}**`, '', ...g.claims[kind].map(claimLine), '');
    }
    if (!any) lines.push('该组没有抽取到观点。', '');
  }

  lines.push('## 覆盖说明', '');
  lines.push(`- 分析覆盖：所选 ${o.selectedCount ?? '—'} 条回答${o.isFullCoverage ? '全部' : '未全部'}进入分析。这不等于搜遍了知乎，检索范围以上面的检索轮数和停止原因为准。`);
  lines.push(citationNote(o.citedCount, o.analyzedCount));
  lines.push('- 标注“含实质证据”的来源是模型的候选标注，不代表作者身份或证据已被外部核实。', '');

  lines.push('## 来源', '');
  if (model.sources.length === 0) lines.push('无。', '');
  for (const s of model.sources) {
    const group = groupsById.get(s.groupId);
    const url = answerUrl(s.questionId, s.answerId);
    const parts = [
      s.author ? md(s.author) : '匿名或未知作者',
      group ? groupLabel(group) : null,
      Number.isFinite(s.voteupCount) ? `${s.voteupCount} 赞同` : null,
      s.evidenceRich ? '含实质证据' : null,
    ].filter(Boolean);
    lines.push(`${s.n}. ${parts.join(' · ')}${url ? ` · [原文](${url})` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** One-line-per-item summary for the CLI. */
export function summarizeReport(model, { maxFamilies = 3 } = {}) {
  const o = model.overview;
  const head = `${o.familyCount} 个议题（存在分歧 ${o.conflictingCount}），结论引用了 ${ratio(o.citedCount, o.analyzedCount)}的已分析回答`;
  const top = model.families.slice(0, maxFamilies).map((f, i) => `  ${i + 1}. ${f.aspect}${f.conflicting ? '（存在分歧）' : ''}`);
  return [head, ...top];
}

/**
 * Render and write `report.md` for a completed run directory.
 * Returns { reportPath, model }.
 */
/**
 * Read a COMPLETE run's artifacts and build the report model (also used by
 * evaluation/score-run.mjs, so report.md and run metrics never disagree).
 */
export function loadReportModel(workDir) {
  const result = readJson(workDir, RESULT_FILENAME);
  const synthesisArtifact = readJson(workDir, SYNTHESIS_FILENAME);
  const claimsArtifact = readJson(workDir, CLAIMS_FILENAME);
  const groupState = readJson(workDir, GROUP_STATE_FILENAME);
  const index = buildSourceIndex(workDir, groupState);
  const model = buildReportModel({ result, synthesisArtifact, claimsArtifact, index });
  return { model, index, result, claimsArtifact, groupState };
}

export function writeReport(workDir) {
  const { model } = loadReportModel(workDir);
  const reportPath = path.join(workDir, REPORT_FILENAME);
  fs.writeFileSync(reportPath, renderReportMarkdown(model));
  return { reportPath, model };
}
