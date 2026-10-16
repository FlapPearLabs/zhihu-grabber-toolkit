#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * evaluation/retrieval-ledger.mjs — #142 as an offline script.
 *
 * Builds a candidate ledger and a small failure attribution from the artifacts
 * a run already wrote. It never re-runs, re-queries or calls a model, so it
 * cannot change provider queries, fusion, selection, capture or analysis.
 *
 * Per candidate: the channels (query × provider) that returned it and at which
 * rank, its fused rank, the selector's decision, the capture outcome, analysis
 * and citation counts, and one mechanical terminal state:
 *
 *   CITED · ANALYZED_NOT_CITED · CAPTURE_FAILED · SELECTED_NOT_ANALYZED
 *   SELECTION_PENDING (a clarification is open) · NOT_SELECTED · NOT_ELIGIBLE · UNKNOWN
 *
 * For question IDs a reviewer expected (gold set `expectedSources`):
 *
 *   PROVIDER_RECALL_MISS  not returned by any executed channel (this does not
 *                         claim the provider could never return it)
 *   SELECTION_MISS        returned and eligible, not selected
 *   NOT_ELIGIBLE · CAPTURE_FAILURE · ANALYZED_NOT_CITED · FOUND
 *   UNKNOWN               evidence is insufficient for a narrower class
 *
 * Usage:
 *   node research-orchestration/evaluation/retrieval-ledger.mjs <workDir> [--gold <file>] [--json]
 * Exit codes: 0 ok · 1 failure (coded) · 2 usage error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EVAL_DIR, loadGoldset } from './run-scoring.mjs';

export const LEDGER_FILENAME = 'retrieval-ledger.json';
const POOL_REL = path.join('retrieval-rounds', 'accumulated-pool.json');
const TERMINALS = ['CITED', 'ANALYZED_NOT_CITED', 'CAPTURE_FAILED', 'SELECTED_NOT_ANALYZED', 'SELECTION_PENDING', 'NOT_SELECTED', 'NOT_ELIGIBLE', 'UNKNOWN'];

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

const key = (c) => `${c?.query}\u0000${c?.providerId}`;

function channelTable(pool) {
  const table = new Map();
  for (const entry of pool?.channels ?? []) {
    const c = entry?.channel;
    if (!c) continue;
    const k = key(c);
    const prev = table.get(k);
    const itemCount = Number.isFinite(entry.itemCount) ? entry.itemCount : null;
    if (!prev) {
      table.set(k, { query: c.query, providerId: c.providerId, ok: entry.ok === true, itemCount });
    } else {
      prev.ok = prev.ok || entry.ok === true;
      if (itemCount !== null) prev.itemCount = Math.max(prev.itemCount ?? 0, itemCount);
    }
  }
  return table;
}

function analysisByGroup(claimsArtifact) {
  if (!claimsArtifact) return null;
  const out = new Map();
  for (const rep of claimsArtifact.groupRepresentations ?? []) {
    const refs = new Set();
    for (const kind of ['main', 'minority', 'contradictory']) {
      for (const c of rep?.claims?.[kind] ?? []) {
        for (const r of c?.sourceRefs ?? []) {
          const id = typeof r === 'string' ? r : r?.sourceRef;
          if (typeof id === 'string') refs.add(id);
        }
      }
    }
    out.set(String(rep.groupId), { analyzed: rep?.accounting?.analyzed ?? null, cited: refs.size });
  }
  return out;
}

function terminalOf({ decision, pending, capture, analysis, analysisKnown }) {
  if (!decision) return 'UNKNOWN';
  if (decision.eligible === false) return 'NOT_ELIGIBLE';
  // A clarification is pending: the selector has not chosen or refused anything yet.
  if (pending) return 'SELECTION_PENDING';
  if (decision.selected !== true) return decision.selected === false ? 'NOT_SELECTED' : 'UNKNOWN';
  if (capture?.failed === true) return 'CAPTURE_FAILED';
  if (analysis) return analysis.cited > 0 ? 'CITED' : 'ANALYZED_NOT_CITED';
  return analysisKnown ? 'UNKNOWN' : 'SELECTED_NOT_ANALYZED';
}

/**
 * Build the ledger from artifact objects (pool required; the rest optional).
 * @param {{pool, decision?, groupState?, claimsArtifact?, coverageState?}} a
 * @param {{expectedSources?: string[]}} [opts]
 */
export function buildRetrievalLedger({ pool, decision = null, groupState = null, claimsArtifact = null, coverageState = null }, { expectedSources = [] } = {}) {
  if (!pool || !Array.isArray(pool.candidates)) throw new LedgerError('LEDGER_INPUT_INVALID', 'retrieval pool has no candidate list');
  const channels = channelTable(pool);
  const decisions = new Map((decision?.candidates ?? []).map((c) => [String(c.questionId), c]));
  // --max-group-answers: groups excluded before selection are not in the decision's candidate list.
  for (const e of decision?.excludedByAnswerLimit ?? []) {
    decisions.set(String(e.questionId), { questionId: String(e.questionId), eligible: false, selected: false, score: null, ineligibleReason: 'answer_count_over_limit', answerCount: e.answerCount ?? null });
  }
  const groups = new Map(Object.values(groupState?.groups ?? {}).map((g) => [String(g.questionId ?? g.groupId), g]));
  const analysis = analysisByGroup(claimsArtifact);
  const pending = decision?.verdict === 'ambiguous' || decision?.clarification?.required === true;

  const ordered = pool.candidates
    .map((c) => ({ c, qid: String(c?.identity?.questionId), rrf: Number(c?.rrfScore) }))
    .sort((a, b) => (b.rrf - a.rrf) || (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0));

  const candidates = ordered.map(({ c, qid, rrf }, i) => {
    const d = decisions.get(qid) ?? null;
    const g = groups.get(qid) ?? null;
    const an = analysis?.get(qid) ?? null;
    const capture = g ? {
      stage: g.stage ?? null,
      failed: g.failed === true,
      failureCode: g.failure?.code ?? null,
      capturedAnswerCount: Number.isFinite(g.capturedAnswerCount) ? g.capturedAnswerCount : null,
    } : null;
    return {
      questionId: qid,
      title: typeof c?.facts?.title === 'string' ? c.facts.title : null,
      rrfScore: Number.isFinite(rrf) ? rrf : null,
      fusedRank: i + 1,
      channels: (c?.ranks ?? [])
        .map((r) => ({ query: r?.channel?.query ?? null, providerId: r?.channel?.providerId ?? null, rank: Number.isFinite(r?.rank) ? r.rank : null }))
        .sort((x, y) => String(x.query).localeCompare(String(y.query)) || String(x.providerId).localeCompare(String(y.providerId))),
      selection: d ? {
        eligible: d.eligible ?? null,
        selected: d.selected ?? null,
        score: Number.isFinite(d.score) ? d.score : null,
        ...(d.ineligibleReason ? { ineligibleReason: d.ineligibleReason, answerCount: d.answerCount } : {}),
      } : null,
      capture,
      analysis: an,
      terminal: terminalOf({ decision: d, pending, capture, analysis: an, analysisKnown: false }),
    };
  });

  const channelStats = [...channels.values()].map((ch) => {
    const k = key(ch);
    const hits = candidates.filter((c) => c.channels.some((r) => key(r) === k));
    const unique = hits.filter((c) => new Set(c.channels.map(key)).size === 1).length;
    return {
      query: ch.query,
      providerId: ch.providerId,
      ok: ch.ok,
      itemCount: ch.itemCount,
      returned: hits.length,
      unique,
      selected: hits.filter((c) => c.selection?.selected === true).length,
      droppedBeforeFusion: ch.itemCount === null ? null : Math.max(0, ch.itemCount - hits.length),
    };
  }).sort((a, b) => String(a.query).localeCompare(String(b.query)) || String(a.providerId).localeCompare(String(b.providerId)));

  const byTerminal = {};
  for (const t of TERMINALS) {
    const n = candidates.filter((c) => c.terminal === t).length;
    if (n) byTerminal[t] = n;
  }
  const selected = candidates.filter((c) => c.selection?.selected === true);
  const summary = {
    candidates: candidates.length,
    selected: selected.length,
    captured: selected.filter((c) => c.capture && !c.capture.failed).length,
    captureFailed: selected.filter((c) => c.capture?.failed).length,
    analyzed: candidates.filter((c) => c.analysis).length,
    cited: candidates.filter((c) => c.terminal === 'CITED').length,
    byTerminal,
  };

  const lastSelectedRank = selected.length ? Math.max(...selected.map((c) => c.fusedRank)) : null;
  const executed = [...channels.values()].filter((ch) => ch.ok).length;
  const failed = channels.size - executed;
  const byQid = new Map(candidates.map((c) => [c.questionId, c]));
  const expected = (expectedSources ?? []).map((raw) => {
    const qid = String(raw);
    const c = byQid.get(qid);
    if (!c) {
      // Only what successful channels returned was observed; failed channels are disclosed.
      return executed > 0
        ? { questionId: qid, attribution: 'PROVIDER_RECALL_MISS', evidence: { channelsOk: executed, channelsFailed: failed } }
        : { questionId: qid, attribution: 'UNKNOWN', evidence: { reason: 'no_successful_channel' } };
    }
    const map = {
      CITED: 'FOUND',
      ANALYZED_NOT_CITED: 'ANALYZED_NOT_CITED',
      CAPTURE_FAILED: 'CAPTURE_FAILURE',
      NOT_ELIGIBLE: 'NOT_ELIGIBLE',
      NOT_SELECTED: 'SELECTION_MISS',
    };
    const attribution = map[c.terminal] ?? 'UNKNOWN';
    const evidence = attribution === 'SELECTION_MISS'
      ? { fusedRank: c.fusedRank, score: c.selection?.score ?? null, lastSelectedRank }
      : { fusedRank: c.fusedRank, terminal: c.terminal };
    return { questionId: qid, attribution, evidence };
  });

  return {
    schemaVersion: 1,
    type: 'p1-retrieval-ledger',
    planHash: pool.planHash ?? null,
    retrieval: {
      rounds: coverageState?.retrieval?.retrievalRounds ?? null,
      stopReason: coverageState?.retrieval?.stopReason ?? null,
      channelsOk: executed,
      channelsFailed: failed,
    },
    summary,
    channels: channelStats,
    candidates,
    expected,
  };
}

function readOptional(workDir, rel) {
  const file = path.join(workDir, rel);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new LedgerError('LEDGER_INPUT_INVALID', `${rel} is not valid JSON`); }
}

/** Read the run's artifacts, build the ledger, write evaluation/retrieval-ledger.json. */
export function writeRetrievalLedger(workDir, { goldFile = null } = {}) {
  const pool = readOptional(workDir, POOL_REL);
  if (!pool) throw new LedgerError('LEDGER_INPUT_MISSING', `${POOL_REL} is missing (the run has not finished retrieval)`);
  const expectedSources = goldFile ? loadGoldset(goldFile).gold.expectedSources : [];
  const ledger = buildRetrievalLedger({
    pool,
    decision: readOptional(workDir, 'source-group-selection-decision.json'),
    groupState: readOptional(workDir, 'multi-group-state.json'),
    claimsArtifact: readOptional(workDir, 'per-group-claims.json'),
    coverageState: readOptional(workDir, 'coverage-state.json'),
  }, { expectedSources });
  const ledgerPath = path.join(workDir, EVAL_DIR, LEDGER_FILENAME);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  return { ledger, ledgerPath };
}

// ---------------------------------------------------------------------------
// CLI

const TERMINAL_LABEL = {
  CITED: '被引用',
  ANALYZED_NOT_CITED: '已分析未引用',
  CAPTURE_FAILED: '抓取失败',
  SELECTED_NOT_ANALYZED: '已选未分析',
  SELECTION_PENDING: '待人工选择',
  NOT_SELECTED: '未选中',
  NOT_ELIGIBLE: '不合格',
  UNKNOWN: '未知',
};

function main(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--gold') {
      o.goldFile = argv[++i];
      if (!o.goldFile || o.goldFile.startsWith('--')) o.usageError = 'missing value for --gold';
    } else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) o.usageError = `unknown option: ${a}`;
    else if (o.workDir === undefined) o.workDir = a;
    else o.usageError = `unexpected argument: ${a}`;
    if (o.usageError) break;
  }
  const help = '用法: node research-orchestration/evaluation/retrieval-ledger.mjs <运行目录> [--gold <黄金集>] [--json]';
  if (o.help) { console.log(help); return 0; }
  if (!o.usageError && !o.workDir) o.usageError = 'missing run directory';
  if (o.usageError) {
    if (o.json) console.log(JSON.stringify({ ok: false, error: { code: 'USAGE', message: o.usageError } }));
    else console.error(`retrieval-ledger: ${o.usageError}\n${help}`);
    return 2;
  }
  const workDir = path.resolve(process.cwd(), o.workDir);
  try {
    const { ledger, ledgerPath } = writeRetrievalLedger(workDir, { goldFile: o.goldFile ?? null });
    if (o.json) {
      console.log(JSON.stringify({ ok: true, ledger: path.relative(workDir, ledgerPath), summary: ledger.summary, expected: ledger.expected }));
      return 0;
    }
    const s = ledger.summary;
    const lines = [
      `检索：${ledger.retrieval.channelsOk} 个检索通道成功，${ledger.retrieval.channelsFailed} 个失败；停止原因 ${ledger.retrieval.stopReason ?? '未知'}`,
      `候选问题：${s.candidates}，选中 ${s.selected}，抓取成功 ${s.captured}，抓取失败 ${s.captureFailed}，被引用 ${s.cited}`,
      `去向：${Object.entries(s.byTerminal).map(([t, n]) => `${TERMINAL_LABEL[t]} ${n}`).join('，')}`,
    ];
    const dropped = ledger.channels.reduce((n, c) => n + (c.droppedBeforeFusion ?? 0), 0);
    if (dropped) lines.push(`检索返回但未进入候选池的条目：${dropped}（文章、外链等非问题内容）`);
    if (ledger.expected.length) {
      lines.push('预期来源：');
      for (const e of ledger.expected) lines.push(`  ${e.questionId}：${e.attribution}`);
    }
    lines.push(`台账：${path.relative(workDir, ledgerPath)}`);
    console.log(lines.join('\n'));
    return 0;
  } catch (err) {
    const code = typeof err?.code === 'string' ? err.code : 'LEDGER_FAILED';
    if (o.json) console.log(JSON.stringify({ ok: false, error: { code, message: String(err?.message ?? err) } }));
    else console.error(`retrieval-ledger: ${code}: ${err?.message ?? err}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
