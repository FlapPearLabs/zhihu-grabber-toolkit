#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * evaluation/replay-analysis.mjs — re-run the analysis of a finished run.
 *
 * Runs the full P1 pipeline again into a NEW work directory, but feeds it the
 * baseline's recorded inputs instead of the network:
 *
 *   - the baseline's research plan (no planner call);
 *   - search: every (provider, query) call is answered from the baseline's
 *     accumulated pool, with the recorded ranks, facts and completeness
 *     (search titles are not replayed: they are only trusted from the real
 *     search client, see lib/provider-title-origin.mjs);
 *   - capture: the baseline's capture files (answers.json, answers.md,
 *     .progress.json), byte for byte; handoff.json is regenerated;
 *   - selection: the same answer-count limit, and a clarification (when the
 *     selector asks for one) answered with the baseline's chosen groups.
 *
 * Everything after capture is real: verification, local embeddings, the
 * corpus, the per-group analysis (single or chunked), synthesis and the report.
 * Running the same baseline once per analysis mode therefore compares the
 * analysis layer on identical inputs; score the replay directories with
 * score-run.mjs as usual.
 *
 * The replay checks itself and records the result in replay-info.json:
 * the selected groups and the analysed corpus must equal the baseline's, and
 * no search call may be missing from the recording. A replay whose fidelity
 * fails is still written but exits 1.
 *
 * One deviation, disclosed in replay-info.json: when a captured answers.json
 * has an empty question title, the baseline embedded the search-result title
 * instead (group_title_fallback); the replay cannot replay that title, so it
 * writes the same title (" - 知乎" removed) into the copied answers.json.
 *
 * Usage:
 *   node research-orchestration/evaluation/replay-analysis.mjs <baselineDir> --out <dir>
 *        [--analysis single|chunked] [--model <provider>/<id>] [--base-url <url>] [--json]
 * Exit codes: 0 replay complete and faithful · 1 failure or fidelity mismatch · 2 usage error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, CAPABILITY_CAPTURE, AUTH_CLASS_SESSION } from '../lib/provider-seam.mjs';
import { loadPlan } from '../lib/plan-contract.mjs';
import { parseModelSpec, validateBaseUrl } from '../lib/model-runtime.mjs';
import { writeReport } from '../lib/report.mjs';

export const REPLAY_INFO_FILENAME = 'replay-info.json';
const POOL_REL = path.join('retrieval-rounds', 'accumulated-pool.json');
const DECISION_FILE = 'source-group-selection-decision.json';
const STATE_FILE = 'orchestration-state.json';
const COVERAGE_FILE = 'coverage-state.json';
const CAPTURE_PROVIDER = 'zhihu-session-capture';
/** What the grabber writes per question; the verify step checks all three. handoff.json is regenerated. */
const CAPTURE_FILES = ['answers.json', 'answers.md', '.progress.json'];

export class ReplayError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function readJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new ReplayError('BASELINE_INCOMPLETE', `${what} is missing or unreadable: ${path.basename(file)}`);
  }
}

const channelKey = (providerId, query) => `${providerId}\u0000${query}`;
const searchTitle = (title) => (typeof title === 'string' ? title.replace(/\s*-\s*知乎\s*$/u, '').trim() : '');

/** Everything a replay needs from a baseline directory, validated. */
export function loadBaseline(baselineDir) {
  const dir = path.resolve(baselineDir);
  const plan = loadPlan(dir);
  if (!plan.ok) throw new ReplayError('BASELINE_INCOMPLETE', `baseline research plan unusable (${plan.reason})`);
  const state = readJson(path.join(dir, STATE_FILE), 'baseline state');
  if (typeof state.topic !== 'string' || state.topic.trim() === '') throw new ReplayError('BASELINE_INCOMPLETE', 'baseline state has no topic');
  const pool = readJson(path.join(dir, POOL_REL), 'baseline accumulated pool');
  const decision = readJson(path.join(dir, DECISION_FILE), 'baseline selection decision');
  if (!Array.isArray(pool.channels) || !Array.isArray(pool.candidates)) throw new ReplayError('BASELINE_INCOMPLETE', 'baseline pool has no channels/candidates');
  if (decision.verdict !== 'auto' || !Array.isArray(decision.selectedGroups)) {
    throw new ReplayError('BASELINE_INCOMPLETE', `baseline selection is not final (verdict ${String(decision.verdict)})`);
  }
  const selectedGroupIds = decision.selectedGroups.map((g) => String(g.questionId));
  const captures = new Map();
  for (const qid of selectedGroupIds) {
    const groupDir = path.join(dir, 'zhihu', qid);
    if (!fs.existsSync(path.join(groupDir, 'answers.json'))) {
      throw new ReplayError('BASELINE_INCOMPLETE', `baseline has no captured answers for selected group ${qid}`);
    }
    captures.set(qid, new Map(CAPTURE_FILES
      .filter((name) => fs.existsSync(path.join(groupDir, name)))
      .map((name) => [name, fs.readFileSync(path.join(groupDir, name))])));
  }
  let corpusSourceSet = null;
  try {
    const coverage = JSON.parse(fs.readFileSync(path.join(dir, COVERAGE_FILE), 'utf8'));
    const set = coverage?.analysisCoverage?.selectedCorpusSourceSet;
    if (Array.isArray(set) && set.length > 0) corpusSourceSet = [...set].sort();
  } catch { /* a baseline that failed before the corpus stage has no corpus to compare */ }
  return {
    dir,
    topic: state.topic,
    plan: plan.plan,
    planHash: plan.planHash,
    pool,
    selectedGroupIds,
    forcedGroupIds: decision.clarification?.forcedGroupIds ?? null,
    maxGroupAnswers: Number.isInteger(decision.maxGroupAnswers) ? decision.maxGroupAnswers : null,
    captures,
    corpusSourceSet,
    baselineStage: state.stage ?? null,
    baselineRunId: state.runId ?? null,
  };
}

/** Search adapters that answer every (provider, query) call from the recorded pool. */
export function replaySearchSeam(pool, { onMiss = () => {} } = {}) {
  const channels = new Map();
  for (const record of pool.channels) {
    const { providerId, query } = record.channel ?? {};
    channels.set(channelKey(providerId, query), { record, items: [] });
  }
  for (const candidate of pool.candidates) {
    for (const rank of candidate.ranks ?? []) {
      const entry = channels.get(channelKey(rank.channel?.providerId, rank.channel?.query));
      if (!entry) continue;
      const facts = {};
      if (typeof candidate.facts?.contentType === 'string') facts.contentType = candidate.facts.contentType;
      if (Number.isInteger(candidate.facts?.answerCount)) facts.answerCount = candidate.facts.answerCount;
      entry.items.push({
        identity: { kind: 'candidate', questionId: String(candidate.identity.questionId) },
        provenance: { route: rank.route, rank: rank.rank, rankOrigin: rank.rankOrigin },
        source_url: candidate.source_url ?? null,
        facts,
      });
    }
  }
  for (const entry of channels.values()) entry.items.sort((a, b) => a.provenance.rank - b.provenance.rank);

  const providers = new Map();
  for (const { record } of channels.values()) {
    const { providerId } = record.channel;
    if (!providers.has(providerId)) providers.set(providerId, record.auth_class);
  }
  const adapters = [...providers].map(([providerId, authClass]) => ({
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass,
    retrieve({ query }) {
      const entry = channels.get(channelKey(providerId, query));
      const base = { provider_id: providerId, capability: CAPABILITY_SEARCH, auth_class: authClass };
      if (!entry) {
        onMiss({ providerId, query });
        return { ...base, ok: false, retrieved_at: new Date().toISOString(), items: [],
          failure: { code: 'REPLAY_NOT_RECORDED', class: 'replay' } };
      }
      const { record, items } = entry;
      if (record.ok === false) {
        return { ...base, ok: false, retrieved_at: record.retrievedAt, items: [],
          failure: { code: 'REPLAYED_PROVIDER_FAILURE', class: 'replay' } };
      }
      return { ...base, ok: true, retrieved_at: record.retrievedAt, items: structuredClone(items),
        completeness: structuredClone(record.completeness) };
    },
  }));
  return createProviderSeam({ adapters });
}

/** Capture adapter that writes the baseline's capture files (title filled only where the baseline fell back). */
export function replayCaptureAdapter(baseline, { titleFills }) {
  const titles = new Map(baseline.pool.candidates.map((c) => [String(c.identity?.questionId), searchTitle(c.facts?.title)]));
  return {
    providerId: CAPTURE_PROVIDER,
    capability: CAPABILITY_CAPTURE,
    authClass: AUTH_CLASS_SESSION,
    retrieve({ questionId, outDir }) {
      const qid = String(questionId);
      const base = { provider_id: CAPTURE_PROVIDER, capability: CAPABILITY_CAPTURE, auth_class: AUTH_CLASS_SESSION, retrieved_at: new Date().toISOString() };
      const files = baseline.captures.get(qid);
      if (!files) {
        return { ...base, ok: false, items: [], failure: { code: 'REPLAY_NOT_CAPTURED', class: 'replay' } };
      }
      const doc = JSON.parse(files.get('answers.json').toString('utf8'));
      const dir = path.join(outDir, qid);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, bytes] of files) fs.writeFileSync(path.join(dir, name), bytes);
      if ((typeof doc.questionTitle !== 'string' || doc.questionTitle.trim() === '') && titles.get(qid)) {
        doc.questionTitle = titles.get(qid);
        fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify(doc, null, 2)}\n`);
        titleFills.push(qid);
      }
      return {
        ...base,
        ok: true,
        items: [{
          identity: { kind: 'group', questionId: qid },
          provenance: { route: 'replay-capture', rank: 1, rankOrigin: 'baseline_capture' },
          facts: { capturedAnswerCount: Array.isArray(doc.answers) ? doc.answers.length : 0 },
        }],
        completeness: { status: 'complete', evidence: { basis: 'baseline_capture_replay' } },
      };
    },
  };
}

function sameSet(a, b) {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Replay one baseline into outDir (must not exist or be empty).
 * Injectables (runtime, embeddingProvider, runner) are for tests; the CLI uses
 * the real model, local embeddings and the real verify/handoff scripts.
 */
export async function replayAnalysis(baselineDir, {
  outDir,
  analysisMode = 'single',
  analysisOptions = null,
  model = null,
  modelBaseUrl = null,
  runtime = null,
  embeddingProvider = null,
  runner = null,
  fetchImpl = fetch,
} = {}) {
  if (typeof outDir !== 'string' || outDir === '') throw new ReplayError('USAGE', 'outDir is required');
  const out = path.resolve(outDir);
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) throw new ReplayError('OUT_NOT_EMPTY', `output directory is not empty: ${out}`);
  const baseline = loadBaseline(baselineDir);
  if (path.resolve(baseline.dir) === out) throw new ReplayError('USAGE', 'output directory must differ from the baseline');

  const misses = [];
  const titleFills = [];
  const usage = [];
  const common = {
    topic: baseline.topic,
    workDir: out,
    seam: replaySearchSeam(baseline.pool, { onMiss: (m) => misses.push(m) }),
    captureAdapter: replayCaptureAdapter(baseline, { titleFills }),
    runner,
    embeddingProvider,
    runtime,
    model,
    modelBaseUrl,
    fetchImpl,
    usageSink: usage,
    maxGroupAnswers: baseline.maxGroupAnswers,
    analysisMode,
    ...(analysisOptions ? { analysisOptions } : {}),
  };

  let result = await composeP1Research({ ...common, plan: baseline.plan, restart: true });
  let clarified = false;
  if (!result.ok && result.clarificationRequired) {
    const force = baseline.forcedGroupIds ?? baseline.selectedGroupIds;
    clarified = true;
    result = await composeP1Research({
      ...common,
      clarificationResponse: { schemaVersion: 1, binding: result.clarificationRequest.binding, clarification: { forceGroupIds: force } },
    });
  }

  let selectedGroupIds = null;
  let corpusSourceSet = null;
  try {
    selectedGroupIds = JSON.parse(fs.readFileSync(path.join(out, DECISION_FILE), 'utf8')).selectedGroups.map((g) => String(g.questionId));
  } catch { /* the replay failed before selection */ }
  try {
    const set = JSON.parse(fs.readFileSync(path.join(out, COVERAGE_FILE), 'utf8')).analysisCoverage?.selectedCorpusSourceSet;
    if (Array.isArray(set) && set.length > 0) corpusSourceSet = [...set].sort();
  } catch { /* no corpus yet */ }

  const fidelity = {
    selectionMatches: selectedGroupIds !== null && sameSet(selectedGroupIds, baseline.selectedGroupIds),
    // A baseline that failed before its corpus stage has nothing to compare against.
    corpusMatches: baseline.corpusSourceSet === null ? null
      : corpusSourceSet !== null && sameSet(corpusSourceSet, baseline.corpusSourceSet),
    unrecordedSearches: misses,
  };
  fidelity.ok = fidelity.selectionMatches && fidelity.corpusMatches !== false && misses.length === 0;

  let report = null;
  if (result.ok) {
    try { report = writeReport(out); } catch { report = null; }
  }
  const info = {
    schemaVersion: 1,
    type: 'p1-analysis-replay',
    baseline: { dir: baseline.dir, runId: baseline.baselineRunId, stage: baseline.baselineStage, planHash: baseline.planHash },
    analysisMode,
    clarified,
    titleFilledFromSearch: titleFills,
    fidelity,
    outcome: result.ok ? { ok: true, runId: result.result?.runId ?? null } : { ok: false, code: result.code ?? null, details: result.details ?? null },
    report: report ? path.basename(report.reportPath) : null,
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, REPLAY_INFO_FILENAME), `${JSON.stringify(info, null, 2)}\n`);
  return { ok: result.ok === true && fidelity.ok, info, result };
}

// ---------------------------------------------------------------------------
// CLI

const USAGE = `用法：node research-orchestration/evaluation/replay-analysis.mjs <基线运行目录> --out <新目录>
        [--analysis single|chunked] [--model <provider>/<id>] [--base-url <url>] [--json]

用基线运行记录下的检索结果和回答重新跑一遍分析（不联网检索、不重新抓取），
用来在同样的输入上比较分析模式。结果目录可以直接用 score-run.mjs 评估。`;

function parseArgs(argv) {
  const opts = { analysisMode: 'single', json: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--out') { opts.outDir = argv[++i]; if (!opts.outDir) return { error: '--out requires a directory' }; continue; }
    if (a === '--analysis') {
      opts.analysisMode = argv[++i];
      if (opts.analysisMode !== 'single' && opts.analysisMode !== 'chunked') return { error: '--analysis requires single or chunked' };
      continue;
    }
    if (a === '--model') { opts.model = argv[++i] ?? ''; continue; }
    if (a === '--base-url') { opts.baseUrl = argv[++i] ?? ''; continue; }
    if (a.startsWith('--')) return { error: `unknown option: ${a}` };
    positional.push(a);
  }
  if (positional.length !== 1) return { error: 'exactly one baseline directory is required' };
  if (!opts.outDir) return { error: '--out is required' };
  try {
    if (opts.model !== undefined) parseModelSpec(opts.model);
    if (opts.baseUrl !== undefined) {
      if (opts.model === undefined) return { error: '--base-url requires --model' };
      validateBaseUrl(opts.baseUrl);
    }
  } catch (err) {
    return { error: err.message };
  }
  return { ...opts, baselineDir: positional[0] };
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(USAGE); return 0; }
  if (opts.error) { console.error(`错误：${opts.error}\n${USAGE}`); return 2; }
  let replay;
  try {
    replay = await replayAnalysis(opts.baselineDir, {
      outDir: opts.outDir, analysisMode: opts.analysisMode, model: opts.model ?? null, modelBaseUrl: opts.baseUrl ?? null,
    });
  } catch (err) {
    if (opts.json) console.log(JSON.stringify({ ok: false, error: { code: err.code ?? 'error', message: err.message } }, null, 2));
    else console.error(`重放失败（${err.code ?? 'error'}）：${err.message}`);
    return 1;
  }
  const { info } = replay;
  if (opts.json) {
    console.log(JSON.stringify({ ok: replay.ok, ...info }, null, 2));
  } else {
    const f = info.fidelity;
    console.log([
      `分析模式：${info.analysisMode}`,
      `运行：${info.outcome.ok ? '完成' : `失败（${info.outcome.code}）${info.outcome.details ?? ''}`}`,
      `与基线一致：选中问题 ${f.selectionMatches ? '是' : '否'}，分析的回答 ${f.corpusMatches === null ? '基线无可比' : f.corpusMatches ? '是' : '否'}，未录制的检索 ${f.unrecordedSearches.length} 次`,
      ...(info.titleFilledFromSearch.length ? [`用搜索标题补了空标题：${info.titleFilledFromSearch.join(', ')}`] : []),
      `目录：${path.resolve(opts.outDir)}`,
    ].join('\n'));
  }
  return replay.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
