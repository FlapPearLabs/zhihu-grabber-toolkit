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
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  const inspected = inspectArtifact(workDir, rel);
  if (inspected.unsafe) {
    throw new ReportError('REPORT_INPUT_UNSAFE', `${rel} is not a regular file inside the run directory`);
  }
  if (!inspected.file) throw new ReportError('REPORT_INPUT_MISSING', `${rel} is missing`);
  const text = readInspectedText(inspected, rel);
  try {
    return JSON.parse(text);
  } catch {
    throw new ReportError('REPORT_INPUT_INVALID', `${rel} is not valid JSON`);
  }
}

/**
 * Inspect a work-relative artifact ref WITHOUT following links.
 *
 * An artifact is readable only when every path component below the run
 * directory is a real directory and the leaf is a regular file. A symlinked
 * leaf, or a symlinked parent directory, could otherwise make the report read
 * data the run never produced (and disclose it in the report).
 *
 * Returns `{ file }` when readable, `{ unsafe: true }` when the ref cannot be
 * proven to stay inside the run, and `{}` when it is simply absent. Callers
 * must never echo the resolved target of an unsafe ref.
 */
function inspectArtifact(workDir, rel) {
  const root = path.resolve(workDir);
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) return { unsafe: true };
  const parts = rel.split(/[\\/]+/).filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.includes('..')) return { unsafe: true };
  let current = root;
  let leaf = null;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (err) {
      return err.code === 'ENOENT' ? {} : { unsafe: true };
    }
    if (stat.isSymbolicLink()) return { unsafe: true };
    if (index === parts.length - 1) {
      if (!stat.isFile()) return { unsafe: true };
      leaf = stat;
    } else if (!stat.isDirectory()) return { unsafe: true };
  }
  // Defense in depth: even with no link component, the resolved target must
  // still live inside the resolved run directory.
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(current);
    if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) return { unsafe: true };
  } catch {
    return { unsafe: true };
  }
  // `dev`/`ino` identify the object the inspection saw; the read below proves
  // it opened THAT object (see readInspectedText).
  return { file: current, dev: leaf.dev, ino: leaf.ino };
}

/**
 * Read the object `inspectArtifact` verified, THROUGH AN OPEN DESCRIPTOR.
 *
 * Inspecting and then reading by path is check-then-use: between the two calls
 * the leaf — or any parent directory — can be replaced with a symlink, and a
 * path-based read would follow it out of the run directory. So the leaf is
 * opened with O_NOFOLLOW, the OPENED object is re-verified (regular file, same
 * device and inode the inspection saw), and the bytes are taken from the
 * descriptor. A swap after the open cannot redirect the read; a swap before it
 * either fails to open (leaf is now a link) or opens a different object and is
 * refused. Nothing about the target is echoed in the error.
 *
 * Residual risk: identity is dev/ino, so a hard link to the very same inode is
 * indistinguishable from the file itself — it carries the same bytes.
 */
function readInspectedText(inspected, rel) {
  let fd;
  try {
    fd = fs.openSync(inspected.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (err) {
    if (err?.code === 'ENOENT') throw new ReportError('REPORT_INPUT_MISSING', `${rel} is missing`);
    throw new ReportError('REPORT_INPUT_UNSAFE', `${rel} cannot be opened without following a link`);
  }
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== inspected.dev || opened.ino !== inspected.ino) {
      throw new ReportError('REPORT_INPUT_UNSAFE', `${rel} is not the regular file that was inspected`);
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    try { fs.closeSync(fd); } catch { /* descriptor is already gone */ }
  }
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
    const inspected = inspectArtifact(workDir, g.evidenceRef);
    let doc = null;
    if (inspected.file) {
      try { doc = JSON.parse(readInspectedText(inspected, g.evidenceRef)); } catch { doc = null; }
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

const REPORT_TEMP_PREFIX = `.${REPORT_FILENAME}.tmp-`;

/**
 * Open the run directory and keep the OBJECT, not the path.
 *
 * `stat` on a path resolves whatever the path currently names, so every path
 * check is check-then-use: between the check and the write the run directory
 * itself can be renamed away and replaced with a symlink to somewhere else,
 * which would make the report land outside the run. Holding an OPEN directory
 * descriptor pins the real object, and each step below re-verifies that the
 * path still names that very object (same device and inode) immediately before
 * and after the rename. A replaced directory therefore fails closed instead of
 * being followed.
 */
function openRunDir(workDir) {
  let fd;
  try {
    fd = fs.openSync(workDir, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
  } catch {
    throw new ReportError('REPORT_OUTPUT_UNSAFE', 'the run directory cannot be opened');
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isDirectory()) throw new ReportError('REPORT_OUTPUT_UNSAFE', 'the run directory is not a directory');
    return { fd, dev: stat.dev, ino: stat.ino };
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* descriptor is already gone */ }
    throw err instanceof ReportError
      ? err
      : new ReportError('REPORT_OUTPUT_UNSAFE', 'the run directory cannot be inspected');
  }
}

/** Fail closed unless `dir` still names the directory object `handle` holds open. */
function assertSameRunDir(handle, dir) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new ReportError('REPORT_OUTPUT_UNSAFE', 'the run directory disappeared while the report was being written');
  }
  if (!stat.isDirectory() || stat.dev !== handle.dev || stat.ino !== handle.ino) {
    throw new ReportError('REPORT_OUTPUT_UNSAFE', 'the run directory was replaced while the report was being written');
  }
}

/**
 * A report target may only be a regular file or absent. A symlink is refused:
 * following it would let `report.md → research-result.json` rewrite canonical
 * run data. Any other non-regular object (directory, FIFO, device) is refused
 * for the same reason.
 *
 * Returns the existing identity (mode, link count, dev+ino) when a report is
 * already there, or `null` when the report is being created. The identity is
 * what an in-place update re-checks on the opened descriptor.
 */
function inspectReportTarget(reportPath) {
  let stat;
  try {
    stat = fs.lstatSync(reportPath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new ReportError('REPORT_OUTPUT_UNSAFE', `${REPORT_FILENAME} cannot be inspected as a regular file`);
  }
  if (!stat.isFile()) throw new ReportError('REPORT_OUTPUT_UNSAFE', `${REPORT_FILENAME} must be a regular file`);
  return { mode: stat.mode & 0o7777, nlink: stat.nlink, dev: stat.dev, ino: stat.ino };
}

/**
 * Rewrite the report IN PLACE, through a descriptor whose identity is verified
 * against the file that was inspected. Same inode means the ACL, mode and
 * ownership stay exactly as the run left them, and no directory entry is
 * published — so there is no "check, then publish" window to race.
 *
 * Only used when the report is a single-link, owner-writable regular file.
 * A hard-linked report (nlink > 1) is still replaced so a canonical artifact
 * sharing the inode is never rewritten; a read-only report is replaced for the
 * same practical reason (we may not write it).
 */
function rewriteReportInPlace(handle, dir, reportPath, expected, markdown) {
  // The run directory must still be the object opened at the start, IMMEDIATELY
  // before the name is resolved again: otherwise a directory swapped for a
  // symlink would make `reportPath` resolve outside the run.
  assertSameRunDir(handle, dir);
  let fd;
  try {
    fd = fs.openSync(reportPath, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0));
  } catch (err) {
    throw new ReportError(
      err?.code === 'ELOOP' ? 'REPORT_OUTPUT_UNSAFE' : 'REPORT_OUTPUT_FAILED',
      `${REPORT_FILENAME} could not be opened for rewrite (${err?.code ?? 'error'})`,
    );
  }
  try {
    const opened = fs.fstatSync(fd);
    // Identity is re-checked on the DESCRIPTOR: the path could have been
    // swapped between the inspection and this open.
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino) {
      throw new ReportError('REPORT_OUTPUT_UNSAFE', `${REPORT_FILENAME} changed identity before it was rewritten`);
    }
    // A link added since the inspection would make the shared inode the target
    // of this rewrite; refuse instead of writing through an alias.
    if (opened.nlink !== 1) {
      throw new ReportError('REPORT_OUTPUT_UNSAFE', `${REPORT_FILENAME} gained a hard link before it was rewritten`);
    }
    // Re-bind the directory once more right before the bytes are replaced: the
    // check above can be overtaken by a swap between open() and truncate().
    assertSameRunDir(handle, dir);
    const bytes = Buffer.from(markdown, 'utf8');
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, bytes, 0, bytes.length, 0);
    // The inode is unchanged, so mode/ACL/owner are unchanged by construction;
    // no fchmod is needed (and it must not be attempted: it can EPERM on files
    // this process does not own).
  } finally {
    try { fs.closeSync(fd); } catch { /* descriptor is already gone */ }
  }
  assertSameRunDir(handle, dir);
  return reportPath;
}

/** `detectAccessAcl` could not look: unknown is not "no ACL". */
const ACL_UNKNOWN = Symbol('acl-unknown');
const REGULAR_FILE_LISTING = /^-[r-][w-][xSs-][r-][w-][xSs-][r-][w-][xTt-][+@.]?\s/;

/**
 * Does this path carry an access ACL? `true` / `false`, or `ACL_UNKNOWN` when
 * the platform listing could not be read (unknown != absent, so the caller
 * fails closed). macOS prints ACL entries as extra lines under `ls -le`; Linux
 * marks an ACL with a trailing `+` on the permission bits. Windows returns
 * `false` by design: inherited ACLs are inherited by new files from the run
 * directory; explicit Windows ACLs have not been verified.
 */
function detectAccessAcl(targetPath) {
  if (process.platform === 'win32') return false;
  try {
    if (process.platform === 'darwin') {
      const listing = execFileSync('ls', ['-led', targetPath], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (!REGULAR_FILE_LISTING.test(listing.split('\n')[0])) return ACL_UNKNOWN;
      return listing.split('\n').slice(1).some((line) => line.trim() !== '');
    }
    const listing = execFileSync('ls', ['-ld', targetPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!REGULAR_FILE_LISTING.test(listing.split('\n')[0])) return ACL_UNKNOWN;
    return /\+$/.test(listing.split(/\s+/)[0] ?? '');
  } catch {
    return ACL_UNKNOWN;
  }
}

/**
 * Write the report WITHOUT ever writing through an object it did not create.
 *
 * Create path: atomic (temp + rename, a reader sees the old file or the whole
 * new one). Update path: in place on the same inode, so a reader may observe a
 * truncated or partially written report for the duration of the rewrite — that
 * is the deliberate trade for never swapping the inode (ACL/mode/owner stay).
 *
 * Creation: bytes go to a fresh temp file in the same directory (O_EXCL) and
 * the entry is published with rename(), so nothing pre-planted under the name
 * is written through.
 *
 * Update: the existing report is rewritten IN PLACE through a descriptor whose
 * dev+ino are re-verified against the file just inspected. Same inode means
 * the ACL, mode and ownership cannot be lost, and no directory entry is
 * published — so "swap the run directory between the check and the rename" has
 * no publication step to hijack. A hard-linked report (nlink > 1) or one we may
 * not write (no owner-write bit) is still replaced with temp+rename, so a
 * shared canonical inode is never rewritten; those two cases keep the old,
 * documented publish window.
 *
 * The write is confined to the directory object opened by `openRunDir`: the
 * directory identity is re-checked before the rename and after it, and the
 * object left at the target must be the very inode the temp write created. A
 * directory swapped for a symlink in between is refused, and the temp file is
 * unlinked only when it is still that same inode (never a foreign one).
 *
 * Permissions belong to the run, not to the umask: a NEW report is created
 * 0600, and an UPDATE keeps the mode the existing report already had. The temp
 * file is created 0600 and its mode is set explicitly, so a permissive umask
 * can never widen an existing report to 0644.
 *
 * An in-place rewrite keeps whatever ACL is attached to the inode, so the
 * normal update path cannot drop one. When the report has to be REPLACED
 * (hard-linked or read-only) a rename would drop an ACL, and this layer cannot
 * reproduce an arbitrary ACL, so a report that carries one (or whose ACL could
 * not be read) is REFUSED instead. Inherited Windows ACLs are inherited by new
 * files from the directory; explicit Windows ACLs have not been verified.
 *
 * Residual BLOCK: on the replace path, ACL detection and rename are still not
 * atomic — an ACL added in that window can be dropped. Pure JS cannot bind the
 * check and the replace atomically; the in-place path does not have the window.
 */
function writeReportFile(workDir, markdown) {
  const dir = path.resolve(workDir);
  const handle = openRunDir(dir);
  try {
    const reportPath = path.join(dir, REPORT_FILENAME);
    assertSameRunDir(handle, dir);
    const existing = inspectReportTarget(reportPath);
    const existingMode = existing?.mode ?? null;
    const targetMode = existingMode ?? 0o600;
    if (existing !== null) {
      // Normal case: rewrite the SAME inode. No directory entry is published and
      // the ACL (if any) belongs to that inode, so it cannot be dropped.
      if (existing.nlink === 1 && (existing.mode & 0o600) === 0o600) {
        return rewriteReportInPlace(handle, dir, reportPath, existing, markdown);
      }
      // Replace path only (hard-linked or not owner-writable): a rename swaps
      // the inode, which would drop an ACL, and this layer cannot reproduce an
      // arbitrary one. Refuse instead of silently widening access.
      const acl = detectAccessAcl(reportPath);
      if (acl !== false) {
        throw new ReportError(
          'REPORT_OUTPUT_UNSAFE',
          acl === true
            ? `${REPORT_FILENAME} carries an access ACL and has to be replaced; refusing to drop it (remove the ACL, or delete the file to re-render it)`
            : `${REPORT_FILENAME} could not be inspected for an access ACL; refusing to replace it`,
        );
      }
    }

    const tempPath = path.join(dir, `${REPORT_TEMP_PREFIX}${process.pid}-${randomUUID()}`);
    let temp = null;
    let created = null;
    try {
      // `wx` is O_CREAT|O_EXCL: it never opens an existing object, so a link
      // pre-planted under the temp name cannot be written through.
      const fd = fs.openSync(tempPath, 'wx', 0o600);
      try {
        created = fs.fstatSync(fd);
        temp = { dev: created.dev, ino: created.ino };
        fs.writeSync(fd, Buffer.from(markdown, 'utf8'));
        // umask only narrows a CREATE mode, so the mode is applied explicitly:
        // 0600 for a new report, the existing mode for an update.
        fs.fchmodSync(fd, targetMode);
      } finally {
        try { fs.closeSync(fd); } catch { /* descriptor is already gone */ }
      }

      assertSameRunDir(handle, dir); // the temp file must still be inside the run
      fs.renameSync(tempPath, reportPath);
      temp = null; // the object now lives at the target

      assertSameRunDir(handle, dir);
      const written = fs.lstatSync(reportPath);
      if (!written.isFile() || written.dev !== created.dev || written.ino !== created.ino) {
        throw new ReportError('REPORT_OUTPUT_UNSAFE', `${REPORT_FILENAME} was not written into the run directory`);
      }
      return reportPath;
    } catch (err) {
      if (temp) {
        try {
          const stray = fs.lstatSync(tempPath);
          if (stray.dev === temp.dev && stray.ino === temp.ino) fs.unlinkSync(tempPath);
        } catch { /* the temp file is already gone */ }
      }
      if (err instanceof ReportError) throw err;
      throw new ReportError('REPORT_OUTPUT_FAILED', `${REPORT_FILENAME} could not be written (${err?.code ?? 'error'})`);
    }
  } finally {
    try { fs.closeSync(handle.fd); } catch { /* descriptor is already gone */ }
  }
}

/**
 * Render and write `report.md` for a completed run directory.
 * Returns { reportPath, model }.
 *
 * The target is validated as a file OBJECT: an existing symlink (or any other
 * non-regular object) is refused, so a `report.md → research-result.json` link
 * can never make rendering overwrite canonical run data. The write itself is
 * atomic (temp file + rename) and bound to the run directory OBJECT, so
 * replacing the directory with a symlink cannot redirect the report outside it.
 */
export function writeReport(workDir) {
  const result = readJson(workDir, RESULT_FILENAME);
  const synthesisArtifact = readJson(workDir, SYNTHESIS_FILENAME);
  const claimsArtifact = readJson(workDir, CLAIMS_FILENAME);
  const groupState = readJson(workDir, GROUP_STATE_FILENAME);
  const index = buildSourceIndex(workDir, groupState);
  const model = buildReportModel({ result, synthesisArtifact, claimsArtifact, index });
  const reportPath = writeReportFile(workDir, renderReportMarkdown(model));
  return { reportPath, model };
}
