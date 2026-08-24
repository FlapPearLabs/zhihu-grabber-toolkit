/**
 * research-orchestration/test/orchestration.test.mjs
 *
 * Focused Research Orchestration MVP tests (deterministic, no network).
 * Covers Approved Acceptance A–L and MVP cases A–F:
 *   A normal generic research (full-coverage happy path)
 *   B material ambiguity → clarification required, no capture starts
 *   C explicit sampled intent → top-percent + disclosure
 *   D resume: validated stages skipped, continue from checkpoint
 *   E stale state: mutated artifact identity → re-run, no silent reuse
 *   F runtime failure → fail closed, NO silent fallback
 *   I focused selection tests (clear/ambiguous/none)
 *   J default full-coverage regression (generic request never defaults to sampled)
 *   K runtime policy (default deepseek; failure → no fallback)
 *   L resume/stale tests (D + E)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  normalizeTopic,
  resolveAnalysisIntent,
  resolveRequestedMode,
  extractPercent,
  normalizeExplicitMode,
  MODE_DIGEST,
  MODE_TOP_PERCENT,
  QUICK_PERCENT,
} from '../lib/intent.mjs';
import {
  selectCandidate,
  SELECT_VERDICT_AUTO,
  SELECT_VERDICT_AMBIGUOUS,
  SELECT_VERDICT_NONE,
  MIN_ABS_SCORE,
  AMBIGUITY_MARGIN,
} from '../lib/selection.mjs';
import {
  makeState,
  validateCheckpoint,
  validateArtifactCheckpoint,
  readState,
  STAGE_SEARCH,
  STAGE_SELECT,
  STAGE_CAPTURE,
  STAGE_VERIFY,
  STAGE_HANDOFF,
  STAGE_ANALYZE,
  STAGE_RENDER,
  STAGE_COMPLETE,
  runIdentityHash,
} from '../lib/state.mjs';
import { createOrchestrator, OrchestrationError, RUNTIME_DEEPSEEK, RUNTIME_LMSTUDIO, HIERARCHY_THRESHOLD_CHARS } from '../lib/orchestrator.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ro-${prefix}-`));
}

function sha(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Fake runner: deterministic, records invocations, materializes the files the
 * real primitives would create (capture fixture, handoff, corpus artifacts).
 */
function makeFakeRunner({ searchCandidates, deepseekUsable = true, failOn = {}, outputs = {} } = {}) {
  const calls = [];
  const fixtureAnswers = {
    questionId: '123',
    questionTitle: '测试问题',
    answerCount: 3,
    answers: [
      { id: '1', author: '甲', content: '<p>回答一内容</p>', voteupCount: 99, commentCount: 2 },
      { id: '2', author: '乙', content: '<p>回答二内容</p>', voteupCount: 50, commentCount: 1 },
      { id: '3', author: '丙', content: '<p>回答三内容</p>', voteupCount: 10, commentCount: 0 },
    ],
  };

  function record(name, args) {
    calls.push({ name, args });
  }

  function maybeFail(name) {
    if (failOn[name]) {
      return { status: 1, stdout: '', stderr: `injected ${name} failure` };
    }
    return null;
  }

  /** Injected gate output: outputs[name] = { status, stdout } where stdout may be object or raw string. */
  function maybeOutput(name) {
    const o = outputs[name];
    if (o === undefined) return null;
    return {
      status: o.status ?? 0,
      stdout: typeof o.stdout === 'string' ? o.stdout : JSON.stringify(o.stdout),
      stderr: '',
    };
  }

  const runner = (name, args, _opts) => {
    record(name, args);
    const injected = maybeFail(name);
    if (injected) return injected;
    const out = maybeOutput(name);
    if (out) return out;

    switch (name) {
      case 'zhihu-preflight':
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, cookie: { configured: true, usable: true }, secret: { configured: true, usable: true } }), stderr: '' };
      case 'deepseek-preflight':
        return deepseekUsable
          ? { status: 0, stdout: JSON.stringify({ schemaVersion: 1, credential: { configured: true, usable: true, source: 'env' } }), stderr: '' }
          : { status: 1, stdout: JSON.stringify({ schemaVersion: 1, credential: { configured: true, usable: false, error: 'injected' } }), stderr: '' };
      case 'zhihu-search': {
        const candidates = searchCandidates ?? [];
        return { status: 0, stdout: JSON.stringify({ schemaVersion: 1, ok: true, command: 'search', query: args[0], candidates }), stderr: '' };
      }
      case 'zhihu-grab': {
        // args: [qid, --out-dir, <parentDir>, --json] → writes <parentDir>/<qid>/answers.json
        const qid = args[0];
        const parentDir = args[2];
        const outDir = path.join(parentDir, qid);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify(fixtureAnswers));
        fs.writeFileSync(path.join(outDir, 'answers.md'), '# 测试问题\n\n## 1. 甲 — 99 赞\n回答一内容\n\n## 2. 乙 — 50 赞\n回答二内容\n\n## 3. 丙 — 10 赞\n回答三内容\n');
        fs.writeFileSync(path.join(outDir, '.progress.json'), JSON.stringify({ offset: 60, done: true }));
        return {
          status: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            ok: true,
            command: 'grab',
            stage: 'captured',
            questionId: qid,
            capturedAnswerCount: 3,
            artifacts: { json: 'answers.json', markdown: 'answers.md', progress: '.progress.json' },
            verified: false,
            warnings: [],
          }),
          stderr: '',
        };
      }
      case 'zhihu-verify': {
        // args: [<captureDir>]
        const dir = args[0];
        let valid = false;
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
          valid = Boolean(j.questionId) && Array.isArray(j.answers);
        } catch {
          valid = false;
        }
        return {
          status: valid ? 0 : 1,
          stdout: JSON.stringify({ valid, questionId: '123', capturedAnswerCount: 3, reportedAnswerCount: 3, done: true }),
          stderr: '',
        };
      }
      case 'zhihu-handoff': {
        // args: [<captureDir>, --task, digest]
        const dir = args[0];
        fs.writeFileSync(
          path.join(dir, 'handoff.json'),
          JSON.stringify({ task: 'digest', sourceType: 'zhihu-answers', questionId: '123', inputJson: 'answers.json', inputMarkdown: 'answers.md', verified: true, answerCount: 3, warnings: [] }),
        );
        return { status: 0, stdout: '', stderr: '' };
      }
      case 'corpus-verify-handoff':
        return { status: 0, stdout: JSON.stringify({ valid: true, issues: [] }), stderr: '' };
      case 'corpus-chunk': {
        // args: [<input>, --work, <work>, (--mode|--selection) ...]
        const work = args[2];
        fs.mkdirSync(path.join(work, 'chunks'), { recursive: true });
        const modeIdx = args.indexOf('--mode');
        const inputs = [
          { sourceId: 'question-123-answer-1', relativePath: 'answers.json', chars: 1200 },
          { sourceId: 'question-123-answer-2', relativePath: 'answers.json', chars: 900 },
          { sourceId: 'question-123-answer-3', relativePath: 'answers.json', chars: 400 },
        ];
        fs.writeFileSync(
          path.join(work, 'manifest.json'),
          JSON.stringify({ schemaVersion: 1, mode: modeIdx !== -1 ? args[modeIdx + 1] : 'digest', inputs }),
        );
        fs.writeFileSync(path.join(work, 'chunks', 'chunk-0001.json'), JSON.stringify({ chunkId: 'c1', chunkHash: sha('chunk'), sourceIds: ['q1', 'q2', 'q3'], text: '...', chars: 2500 }));
        return { status: 0, stdout: '', stderr: '' };
      }
      case 'corpus-select': {
        // args: [<input>, --work, <work>, --percent, X]
        const work = args[2];
        fs.mkdirSync(work, { recursive: true });
        fs.writeFileSync(
          path.join(work, 'selection.json'),
          JSON.stringify({ schemaVersion: 1, requestedPercent: Number(args[4]), selectionRule: `top-${args[4]}-pct`, originalTotal: 3, selectedSourceIds: ['question-123-answer-1'], selectorHash: sha('sel') }),
        );
        return { status: 0, stdout: '', stderr: '' };
      }
      case 'corpus-map': {
        const work = args[1]; // [--work, <work>, ...]
        fs.mkdirSync(path.join(work, 'map-results'), { recursive: true });
        fs.writeFileSync(path.join(work, 'map-results', 'map-chunk-0001.json'), JSON.stringify({ chunkId: 'c1', sourceIds: ['q1'], summary: 's', claims: [] }));
        return { status: 0, stdout: '', stderr: '' };
      }
      case 'corpus-verify-work': {
        const work = args[0];
        fs.mkdirSync(work, { recursive: true });
        fs.writeFileSync(path.join(work, 'coverage.json'), JSON.stringify({ valid: true, mode: 'digest', mapCount: 1, missingMappedSources: 0, staleHashes: 0, hierarchyIssues: null }));
        return { status: 0, stdout: JSON.stringify({ valid: true, mode: 'digest', mapCount: 1 }), stderr: '' };
      }
      case 'corpus-verify-final':
        return { status: 0, stdout: JSON.stringify({ valid: true, invalidRefs: 0, validRefs: 1, claimsWithoutEvidence: 0 }), stderr: '' };
      case 'corpus-reduce': {
        // args: [--work, <work>, --out, <out.md>]
        const work = args[1];
        const finalDir = path.join(work, 'final');
        fs.mkdirSync(finalDir, { recursive: true });
        // top-percent disclosure fields are spread at top level (mirrors real reduce.mjs)
        const mode = fs.existsSync(path.join(work, 'selection.json')) ? 'top-percent-analysis' : 'digest';
        const base = {
          schemaVersion: 1,
          mode,
          inputCount: 3,
          chunkCount: 1,
          claims: [{ text: '核心观点一。', evidenceSourceIds: ['question-123-answer-1'], confidence: 'high' }],
          minorityViews: ['少数观点。'],
          uncertainties: ['不确定性。'],
        };
        const final = mode === 'top-percent-analysis'
          ? {
              ...base,
              totalAnswers: 198,
              selectedAnswers: 40,
              requestedPercent: 20,
              actualCoveragePercent: 20.2,
              selectionRule: 'top-20-pct-voteup-desc-answerid-dec-asc-strict',
              selectedSourceIds: ['question-123-answer-1'],
              isFullCoverage: false,
            }
          : { ...base, disclosure: { mode: 'digest', isFullCoverage: true } };
        fs.writeFileSync(path.join(finalDir, 'final.json'), JSON.stringify(final));
        return { status: 0, stdout: '', stderr: '' };
      }
      case 'corpus-render': {
        // args: [--final, <final.json>, --out, <digest.md>]
        const out = args[3];
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, '# 摘要\n\n核心观点一。\n');
        return { status: 0, stdout: '', stderr: '' };
      }
      default:
        throw new Error(`fake runner: unexpected primitive ${name}`);
    }
  };
  return { runner, calls };
}

async function runOrch(opts) {
  const workDir = tmpDir('orch');
  const fake = makeFakeRunner(opts.fake ?? {});
  const orch = createOrchestrator({ workDir, runner: fake.runner, ...opts.orch });
  let outcome;
  let error = null;
  try {
    outcome = await orch.runOrchestration();
  } catch (err) {
    error = err;
  }
  return { workDir, fake, outcome, error };
}

// ---------------------------------------------------------------------------
// intent (J: generic → full coverage; sampled only on explicit intent)
// ---------------------------------------------------------------------------

test('intent: generic research intent defaults to FULL-COVERAGE digest (Acceptance J)', () => {
  for (const t of ['帮我研究人工智能', '看看知乎上大家怎么讨论大模型', '综合分析一下新能源汽车', '研究一下量子计算']) {
    const r = resolveAnalysisIntent(t);
    assert.equal(r.mode, MODE_DIGEST, `generic intent must be digest: ${t}`);
    assert.equal(r.sampledIntent, false);
  }
});

test('intent: explicit sampled hints select top-percent with disclosure percent', () => {
  for (const t of ['快速看看人工智能', 'quick look at 大模型', '只看高赞回答', '前20% 的回答', 'top 30% 的观点', '给我一个 sampled view', '不需要全量']) {
    const r = resolveAnalysisIntent(t);
    assert.equal(r.mode, MODE_TOP_PERCENT, `sampled hint must be top-percent: ${t}`);
    assert.equal(r.sampledIntent, true);
  }
  assert.equal(extractPercent('前20%的回答'), 20);
  assert.equal(extractPercent('top 30%'), 30);
  assert.equal(resolveAnalysisIntent('前20%的回答').percent, 20);
  assert.equal(resolveAnalysisIntent('快速看看').percent, QUICK_PERCENT);
  assert.equal(resolveAnalysisIntent('只看高赞').percent, QUICK_PERCENT);
});

test('intent: subject words containing 快速/高赞 must NOT trigger silent sampled downgrade (Acceptance E/J)', () => {
  for (const t of [
    '研究一下快速排序算法',
    '如何快速提升写作能力',
    '快速学习英语的方法',
    '高赞回答有什么特点',
    '高赞率的营销技巧',
    '量子计算',
    '帮我研究人工智能对教育的影响',
    // percentage/采样 as SUBJECT words (not an explicit sampling request) must stay full-coverage
    '研究一下收益率20%的投资策略',
    '如何提高30%的工作效率',
    '2024年增长50%的行业分析',
    '研究一下采样定理',
    '帮我分析采样数据的特点',
  ]) {
    const r = resolveAnalysisIntent(t);
    assert.equal(r.mode, MODE_DIGEST, `generic intent with subject word must stay full-coverage: ${t}`);
    assert.equal(r.sampledIntent, false);
  }
  // explicit sampled phrasings still route to sampled
  for (const t of ['快速看看新能源汽车', '只看高赞回答 新能源汽车', '前20%的回答', '只看前20%的回答', 'top 30% 的观点', 'sampled view', '不要全量', '给我一个采样视图']) {
    assert.equal(resolveAnalysisIntent(t).mode, MODE_TOP_PERCENT, `explicit sampled phrasing must be sampled: ${t}`);
  }
});

test('intent: normalizeTopic strips quoting/whitespace', () => {
  assert.equal(normalizeTopic('  帮我研究 X  '), '帮我研究 X');
  assert.equal(normalizeTopic('"帮我研究 X"'), '帮我研究 X');
});

test('intent: normalizeExplicitMode accepts approved modes only', () => {
  assert.equal(normalizeExplicitMode('digest'), MODE_DIGEST);
  assert.equal(normalizeExplicitMode('full-coverage'), MODE_DIGEST);
  assert.equal(normalizeExplicitMode('top-percent'), MODE_TOP_PERCENT);
  assert.equal(normalizeExplicitMode('sampled'), MODE_TOP_PERCENT);
  assert.equal(normalizeExplicitMode('bogus'), null);
});

test('intent: resolveRequestedMode — auto/absent → intent-driven; explicit wins; percent-only implies sampled', () => {
  const sampledIntent = resolveAnalysisIntent('快速看看新能源汽车');
  assert.equal(sampledIntent.mode, MODE_TOP_PERCENT);
  const genericIntent = resolveAnalysisIntent('帮我研究人工智能');
  assert.equal(genericIntent.mode, MODE_DIGEST);

  // absent / auto → intent-driven
  assert.deepEqual(resolveRequestedMode({ intent: genericIntent }), { valid: true, mode: MODE_DIGEST, percent: null });
  assert.deepEqual(resolveRequestedMode({ explicitMode: 'auto', intent: sampledIntent }), { valid: true, mode: MODE_TOP_PERCENT, percent: QUICK_PERCENT });
  // explicit digest overrides sampled intent
  assert.deepEqual(resolveRequestedMode({ explicitMode: 'digest', intent: sampledIntent }), { valid: true, mode: MODE_DIGEST, percent: null });
  // explicit top-percent overrides generic intent, percent = explicit
  assert.deepEqual(resolveRequestedMode({ explicitMode: 'top-percent', explicitPercent: '30', intent: genericIntent }), { valid: true, mode: MODE_TOP_PERCENT, percent: 30 });
  // explicit top-percent without percent → intent-extracted or QUICK_PERCENT
  assert.equal(resolveRequestedMode({ explicitMode: 'top-percent', intent: genericIntent }).percent, QUICK_PERCENT);
  // percent-only implies sampled
  assert.deepEqual(resolveRequestedMode({ explicitPercent: '10', intent: genericIntent }), { valid: true, mode: MODE_TOP_PERCENT, percent: 10 });
  // invalid mode / percent
  assert.equal(resolveRequestedMode({ explicitMode: 'bogus', intent: genericIntent }).valid, false);
  assert.equal(resolveRequestedMode({ explicitMode: 'top-percent', explicitPercent: '200', intent: genericIntent }).valid, false);
  assert.equal(resolveRequestedMode({ explicitPercent: '0', intent: genericIntent }).valid, false);
  // strict full-string percent validation (no silent truncation)
  assert.equal(resolveRequestedMode({ explicitPercent: '20.5', intent: genericIntent }).valid, false);
  assert.equal(resolveRequestedMode({ explicitPercent: '20abc', intent: genericIntent }).valid, false);
  assert.equal(resolveRequestedMode({ explicitPercent: '', intent: genericIntent }).valid, false);
});

// ---------------------------------------------------------------------------
// selection (Acceptance I: clear / ambiguous / none)
// ---------------------------------------------------------------------------

const cand = (id, title, answerCount = null) => ({ questionId: id, title, answerCount, url: `https://www.zhihu.com/question/${id}` });

test('selection: CLEAR BEST MATCH → auto-select, visible rationale (Acceptance I)', () => {
  const topic = '人工智能对教育的影响';
  const candidates = [cand('1', '人工智能对教育的影响', 50), cand('2', '美食推荐', 500)];
  const r = selectCandidate(topic, candidates);
  assert.equal(r.verdict, SELECT_VERDICT_AUTO);
  assert.equal(r.selected.questionId, '1');
  assert.ok(r.rationale.includes('clear best match'));
  assert.ok(r.candidates[0].score > r.candidates[1].score);
});

test('selection: MATERIAL AMBIGUITY → clarification required, no capture (Acceptance I)', () => {
  const topic = '人工智能伦理';
  // both titles contain all topic tokens → comparable scores, distinct questions
  const candidates = [cand('1', '人工智能伦理的困境', 40), cand('2', '人工智能伦理与法律', 45)];
  const r = selectCandidate(topic, candidates);
  assert.equal(r.verdict, SELECT_VERDICT_AMBIGUOUS);
  assert.equal(r.selected, null);
  assert.ok(r.rationale.includes('material ambiguity'));
});

test('selection: NO VALID CANDIDATE → fail/report, never invent (Acceptance I)', () => {
  const topic = '量子计算';
  const candidates = [cand('1', '美食推荐', 500)];
  const r = selectCandidate(topic, candidates);
  assert.equal(r.verdict, SELECT_VERDICT_NONE);
  assert.equal(r.selected, null);
});

test('selection: explicit forced choice resolves ambiguity (at most one clarification)', () => {
  const topic = '人工智能伦理';
  const candidates = [cand('1', '人工智能伦理的困境', 40), cand('2', '人工智能伦理与法律', 45)];
  const r = selectCandidate(topic, candidates, { forceQuestionId: '2' });
  assert.equal(r.verdict, SELECT_VERDICT_AUTO);
  assert.equal(r.selected.questionId, '2');
  assert.ok(r.rationale.includes('clarification'));
});

test('selection: forced choice outside candidates → none (no unrelated pick)', () => {
  const r = selectCandidate('人工智能', [cand('1', '人工智能的现状', 10)], { forceQuestionId: '999' });
  assert.equal(r.verdict, SELECT_VERDICT_NONE);
});

// ---------------------------------------------------------------------------
// state (R6: checkpoint validation / stale detection)
// ---------------------------------------------------------------------------

test('state: FILE EXISTS != VALID CACHE — hash mismatch is stale', () => {
  const workDir = tmpDir('state');
  fs.mkdirSync(workDir, { recursive: true });
  const f = path.join(workDir, 'a.json');
  fs.writeFileSync(f, 'v1');
  const h1 = sha('v1');
  assert.equal(validateArtifactCheckpoint(workDir, 'a.json', h1).ok, true);
  fs.writeFileSync(f, 'v2-mutated');
  assert.equal(validateArtifactCheckpoint(workDir, 'a.json', h1).ok, false);
  assert.match(validateArtifactCheckpoint(workDir, 'a.json', h1).reason, /stale/);
  // missing file
  assert.equal(validateArtifactCheckpoint(workDir, 'nope.json', h1).ok, false);
});

test('state: run identity mismatch → state_mismatch (no silent reuse across runs)', () => {
  const workDir = tmpDir('state2');
  const s1 = makeState({ workDir, topic: 'A', mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, forceQuestionId: null });
  const s2 = makeState({ workDir, topic: 'B', mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, forceQuestionId: null });
  assert.notEqual(s1.runId, s2.runId);
  fs.writeFileSync(path.join(workDir, 'orchestration-state.json'), JSON.stringify(s1));
  const check = validateCheckpoint(workDir, s2.runId, {});
  assert.equal(check.valid, false);
  assert.equal(check.reason, 'state_mismatch');
});

// ---------------------------------------------------------------------------
// orchestrator happy path (CASE A): full-coverage digest, clear candidate
// ---------------------------------------------------------------------------

test('CASE A: generic intent → search → auto-select → capture → verify → handoff → full digest → render → COMPLETE', async () => {
  const topic = '人工智能对教育的影响';
  const fake = makeFakeRunner({
    searchCandidates: [cand('1', '人工智能对教育的影响', 50), cand('2', '美食推荐', 500)],
  });
  const workDir = tmpDir('caseA');
  const orch = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: fake.runner });
  const outcome = await orch.runOrchestration();

  assert.equal(outcome.stage, STAGE_COMPLETE);
  assert.equal(outcome.analysis.mode, MODE_DIGEST);
  assert.equal(outcome.analysis.isFullCoverage, true);
  assert.equal(outcome.selectedQuestion.questionId, '1');
  assert.equal(outcome.verification.valid, true);
  assert.ok(outcome.synthesis.claims.length >= 1);

  // primitive call order — orchestrator coordinates, never reimplements
  const names = fake.calls.map((c) => c.name);
  assert.deepEqual(names.slice(0, 2), ['zhihu-preflight', 'zhihu-search']);
  assert.ok(names.includes('zhihu-grab'));
  assert.ok(names.includes('zhihu-verify'));
  assert.ok(names.includes('zhihu-handoff'));
  assert.ok(names.includes('corpus-verify-handoff'));
  assert.ok(names.includes('corpus-chunk'));
  assert.ok(names.includes('corpus-map'));
  assert.ok(names.includes('corpus-verify-work'));
  assert.ok(names.includes('corpus-reduce'));
  assert.ok(names.includes('corpus-verify-final'));
  assert.ok(names.includes('corpus-render'));

  // machine-readable artifacts
  const resultFile = path.join(workDir, 'research-result.json');
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  assert.equal(result.stage, STAGE_COMPLETE);
  // work-relative paths only (no absolute path leak)
  for (const rel of Object.values(result.artifacts)) {
    assert.equal(path.isAbsolute(rel), false, `artifact path must be relative: ${rel}`);
  }
  // events record machine-readable progress
  const events = fs.readFileSync(path.join(workDir, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.ok(events.length > 0);
  assert.ok(events.some((l) => JSON.parse(l).event === 'stage' && JSON.parse(l).stage === STAGE_COMPLETE));
  // credentials never in state
  const state = readState(workDir);
  assert.equal(JSON.stringify(state).includes('cookie'), false);
  assert.equal(JSON.stringify(state).includes('secret'), false);
  assert.equal(JSON.stringify(state).includes('api_key'), false);
});

test('CASE B: MATERIAL AMBIGUITY → clarification_required, NO capture starts', async () => {
  const topic = '人工智能伦理';
  const fake = makeFakeRunner({
    searchCandidates: [cand('1', '人工智能伦理的困境', 40), cand('2', '人工智能伦理与法律', 45)],
  });
  const workDir = tmpDir('caseB');
  const orch = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: fake.runner });
  const outcome = await orch.runOrchestration();

  assert.equal(outcome.clarificationRequired, true);
  assert.ok(outcome.selection.candidates.length >= 2);
  const names = fake.calls.map((c) => c.name);
  assert.ok(names.includes('zhihu-search'));
  assert.ok(!names.includes('zhihu-grab'), 'no capture may start before selection resolved');
  assert.ok(!names.includes('zhihu-verify'));
});

test('CASE B→resolve: rerun with --select picks candidate and completes (at most one clarification)', async () => {
  const topic = '人工智能伦理';
  const candidates = [cand('1', '人工智能伦理的困境', 40), cand('2', '人工智能伦理与法律', 45)];
  const workDir = tmpDir('caseB2');
  // first run → clarification
  const f1 = makeFakeRunner({ searchCandidates: candidates });
  const o1 = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: f1.runner });
  const out1 = await o1.runOrchestration();
  assert.equal(out1.clarificationRequired, true);
  // second run with forceQuestionId → resumes from SELECT and completes
  const f2 = makeFakeRunner({ searchCandidates: candidates });
  const o2 = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, forceQuestionId: '2', runner: f2.runner });
  const out2 = await o2.runOrchestration();
  assert.equal(out2.stage, STAGE_COMPLETE);
  assert.equal(out2.selectedQuestion.questionId, '2');
});

test('CASE C: explicit sampled intent → top-percent mode + disclosure, no full-coverage claim', async () => {
  const topic = '快速看看人工智能对教育的影响';
  const fake = makeFakeRunner({
    searchCandidates: [cand('1', '人工智能对教育的影响', 50), cand('2', '美食推荐', 500)],
  });
  const workDir = tmpDir('caseC');
  const orch = createOrchestrator({ workDir, topic, mode: MODE_TOP_PERCENT, percent: 20, runtime: RUNTIME_DEEPSEEK, runner: fake.runner });
  const outcome = await orch.runOrchestration();

  assert.equal(outcome.analysis.mode, MODE_TOP_PERCENT);
  assert.equal(outcome.analysis.isFullCoverage, false);
  assert.equal(outcome.analysis.requestedPercent, 20);
  // sampled disclosure must be surfaced (mode identity + coverage facts)
  assert.ok(outcome.analysis.disclosure, 'sampled disclosure must be surfaced');
  assert.equal(outcome.analysis.disclosure.mode, MODE_TOP_PERCENT);
  assert.equal(outcome.analysis.disclosure.requestedPercent, 20);
  assert.equal(outcome.analysis.disclosure.isFullCoverage, false);
  const names = fake.calls.map((c) => c.name);
  assert.ok(names.includes('corpus-select'));
  const selectCall = fake.calls.find((c) => c.name === 'corpus-select');
  assert.ok(selectCall.args.includes('--percent'));
  assert.ok(selectCall.args.includes('20'));
  // no silent full-coverage claim in final json
  assert.equal(outcome.analysis.isFullCoverage, false);
});

test('CASE D: resume skips validated completed stages (Acceptance L)', async () => {
  const topic = '人工智能对教育的影响';
  const candidates = [cand('1', '人工智能对教育的影响', 50)];
  const workDir = tmpDir('caseD');

  // run 1: fail at VERIFY (injected)
  const f1 = makeFakeRunner({ searchCandidates: candidates, failOn: { 'zhihu-verify': true } });
  const o1 = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: f1.runner });
  await assert.rejects(() => o1.runOrchestration(), (err) => err.code === 'verification_failed');
  const calls1 = f1.calls.map((c) => c.name);
  assert.ok(calls1.includes('zhihu-search'));
  assert.ok(calls1.includes('zhihu-grab'));
  assert.ok(calls1.includes('zhihu-verify'));

  // run 2: resume — SEARCH/SELECT/CAPTURE must NOT be re-invoked
  const f2 = makeFakeRunner({ searchCandidates: candidates });
  const o2 = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: f2.runner });
  const out2 = await o2.runOrchestration();
  assert.equal(out2.stage, STAGE_COMPLETE);
  const names2 = f2.calls.map((c) => c.name);
  assert.ok(!names2.includes('zhihu-search'), 'SEARCH must not re-run on resume');
  assert.ok(!names2.includes('zhihu-grab'), 'CAPTURE must not re-run on resume');
  assert.ok(names2.includes('zhihu-verify'));
});

test('CASE E: stale artifact identity → re-run owning stage, no silent reuse (Acceptance L)', async () => {
  const topic = '人工智能对教育的影响';
  const candidates = [cand('1', '人工智能对教育的影响', 50)];
  const workDir = tmpDir('caseE');

  // run 1: complete everything
  const f1 = makeFakeRunner({ searchCandidates: candidates });
  const o1 = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: f1.runner });
  await o1.runOrchestration();
  assert.equal(f1.calls.some((c) => c.name === 'zhihu-grab'), true);

  // mutate answers.json (artifact identity changed)
  const answersPath = path.join(workDir, 'zhihu', '1', 'answers.json');
  fs.writeFileSync(answersPath, JSON.stringify({ questionId: '1', answers: [] }));

  // run 2: must detect stale CAPTURE artifact → re-run from CAPTURE (grab invoked again)
  const f2 = makeFakeRunner({ searchCandidates: candidates });
  const o2 = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: f2.runner });
  const out2 = await o2.runOrchestration();
  assert.equal(out2.stage, STAGE_COMPLETE);
  const names2 = f2.calls.map((c) => c.name);
  assert.ok(!names2.includes('zhihu-search'), 'SEARCH unchanged → skipped');
  assert.ok(names2.includes('zhihu-grab'), 'stale CAPTURE artifact → re-captured');
  const events = fs.readFileSync(path.join(workDir, 'events.jsonl'), 'utf8');
  assert.ok(events.includes('stale'), 'stale detection must be observable in events');
});

test('CASE F: runtime failure → fail closed, NO silent fallback (Acceptance K)', async () => {
  const topic = '人工智能对教育的影响';
  const candidates = [cand('1', '人工智能对教育的影响', 50)];
  const fake = makeFakeRunner({ searchCandidates: candidates, deepseekUsable: false });
  const workDir = tmpDir('caseF');
  const orch = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: fake.runner });
  await assert.rejects(() => orch.runOrchestration(), (err) => err.code === 'runtime_unavailable');
  const names = fake.calls.map((c) => c.name);
  assert.ok(!names.includes('corpus-map'), 'no map fallback');
  assert.ok(!fake.calls.some((c) => c.name === 'corpus-map' && c.args.includes('--runtime') && c.args.includes(RUNTIME_LMSTUDIO)), 'no silent runtime switch');
});

test('CASE F2: unsupported runtime rejected at construction (no arbitrary routing)', () => {
  const fake = makeFakeRunner({ searchCandidates: [] });
  const workDir = tmpDir('caseF2');
  assert.throws(
    () => createOrchestrator({ workDir, topic: 'x', mode: MODE_DIGEST, percent: null, runtime: 'some-random-provider', runner: fake.runner }),
    (err) => err.code === 'runtime_unavailable',
  );
});

test('CASE D+large corpus: digest mode with large corpus uses hierarchical full digest (R4)', async () => {
  const topic = '人工智能对教育的影响';
  const candidates = [cand('1', '人工智能对教育的影响', 50)];
  const workDir = tmpDir('caseH');
  // monkey-patch manifest size by overriding fake chunk output via searchCandidates size? simpler: use threshold override
  const fake = makeFakeRunner({ searchCandidates: candidates });
  const orch = createOrchestrator({
    workDir,
    topic,
    mode: MODE_DIGEST,
    percent: null,
    runtime: RUNTIME_DEEPSEEK,
    runner: fake.runner,
    hierarchyThresholdChars: 0, // force hierarchy decision (any corpus is "large")
  });
  const out = await orch.runOrchestration();
  assert.equal(out.stage, STAGE_COMPLETE);
  const mapCall = fake.calls.find((c) => c.name === 'corpus-map');
  assert.ok(mapCall.args.includes('--hierarchy'), 'hierarchy must be used for large corpus in digest mode');
  assert.equal(out.analysis.useHierarchy, true);
  // still full coverage identity
  assert.equal(out.analysis.isFullCoverage, true);
});

test('no-valid-candidate path fails closed with structured error (Acceptance I)', async () => {
  const topic = '量子计算';
  const fake = makeFakeRunner({ searchCandidates: [cand('1', '美食推荐', 500)] });
  const workDir = tmpDir('caseNone');
  const orch = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: fake.runner });
  await assert.rejects(() => orch.runOrchestration(), (err) => err.code === 'no_valid_candidate');
  const names = fake.calls.map((c) => c.name);
  assert.ok(!names.includes('zhihu-grab'), 'no capture on no-valid-candidate');
});

test('primitive subprocess failure records stage=FAILED + state.error + failed event (observability)', async () => {
  const topic = '人工智能对教育的影响';
  const fake = makeFakeRunner({ searchCandidates: [cand('1', '人工智能对教育的影响', 50)], failOn: { 'zhihu-grab': true } });
  const workDir = tmpDir('caseFailObs');
  const orch = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: fake.runner });
  await assert.rejects(() => orch.runOrchestration(), (err) => err.code === 'capture_failed');
  const state = readState(workDir);
  assert.equal(state.stage, 'FAILED');
  assert.equal(state.error.code, 'capture_failed');
  const events = fs.readFileSync(path.join(workDir, 'events.jsonl'), 'utf8');
  assert.ok(events.includes('"status":"failed"'), 'failed event must be recorded');
  assert.ok(events.includes('capture_failed'), 'failure identity must be observable');
});

test('state: completion records stage COMPLETE; rerun on complete returns result (no re-execution)', async () => {
  const topic = '人工智能对教育的影响';
  const candidates = [cand('1', '人工智能对教育的影响', 50)];
  const workDir = tmpDir('caseR');
  const f1 = makeFakeRunner({ searchCandidates: candidates });
  const o1 = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: f1.runner });
  await o1.runOrchestration();
  const grabCount1 = f1.calls.filter((c) => c.name === 'zhihu-grab').length;

  const f2 = makeFakeRunner({ searchCandidates: candidates });
  const o2 = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: f2.runner });
  const out2 = await o2.runOrchestration();
  assert.equal(out2.stage, STAGE_COMPLETE);
  assert.equal(f2.calls.length, 0, 'complete run must not re-execute primitives');
});

// ---------------------------------------------------------------------------
// ChatGPT Final Review P1: conservative sampled-intent regression matrix
// (generic/default → FULL-COVERAGE; sampled only on explicit answer/corpus frame)
// ---------------------------------------------------------------------------

test('P1: explicit answer/corpus-frame sampled requests MUST route to top-percent (R4)', () => {
  for (const t of [
    '前20%的回答',
    '只看前20%的回答',
    '看前20%的高赞回答',
    '取前20%的答案',
    '选20%的回答做分析',
    'top 20% answers',
    'sampled view',
    '给我一个采样视图',
    '不需要全量',
    '快速看看新能源汽车',
    '只看高赞回答 新能源汽车',
  ]) {
    const r = resolveAnalysisIntent(t);
    assert.equal(r.mode, MODE_TOP_PERCENT, `explicit sampled frame must be sampled: ${t}`);
    assert.equal(r.sampledIntent, true);
  }
  // percent extraction from the frame
  assert.equal(resolveAnalysisIntent('前20%的回答').percent, 20);
  assert.equal(resolveAnalysisIntent('只看前20%的回答').percent, 20);
  assert.equal(resolveAnalysisIntent('看前20%的高赞回答').percent, 20);
  assert.equal(resolveAnalysisIntent('取前20%的答案').percent, 20);
  assert.equal(resolveAnalysisIntent('选20%的回答做分析').percent, 20);
  assert.equal(resolveAnalysisIntent('top 20% answers').percent, 20);
});

test('P1: percentage as SUBJECT (not corpus subset) MUST stay FULL-COVERAGE (R4, no silent downgrade)', () => {
  for (const t of [
    '我要20%的年化收益',
    '我想要20%的投资回报',
    '研究一下如何提取20%的收益',
    '选择20%的股票是否合理',
    '20%收益率意味着什么',
    '收益率20%的投资策略',
    '研究一下采样定理',
    '用采样数据训练模型有什么问题',
    '采样率20%的信号处理方法',
    '如何选20%的员工进入试点',
    '研究一下快速排序算法',
    '如何快速提升写作能力',
    '高赞回答有什么特点',
    '帮我研究人工智能对教育的影响',
    '量子计算',
  ]) {
    const r = resolveAnalysisIntent(t);
    assert.equal(r.mode, MODE_DIGEST, `generic intent with %/采样 subject must stay full-coverage: ${t}`);
    assert.equal(r.sampledIntent, false);
  }
});

// ---------------------------------------------------------------------------
// ChatGPT Final Review P2: failure identity
// VALID FALSE != UNPARSEABLE OUTPUT != SUBPROCESS EXIT FAILURE (all FAIL_CLOSED, FAILED state)
// ---------------------------------------------------------------------------

async function expectFailureIdentity({ failOn, outputs, topic = '人工智能对教育的影响', expectCode, expectReasonPart }) {
  const fake = makeFakeRunner({ searchCandidates: [cand('1', '人工智能对教育的影响', 50)], failOn, outputs });
  const workDir = tmpDir('fid');
  const orch = createOrchestrator({ workDir, topic, mode: MODE_DIGEST, percent: null, runtime: RUNTIME_DEEPSEEK, runner: fake.runner });
  await assert.rejects(
    () => orch.runOrchestration(),
    (err) => {
      assert.equal(err.code, expectCode, `code must be ${expectCode}, got ${err.code}`);
      assert.ok(err.message.includes(expectReasonPart), `message must mention "${expectReasonPart}", got: ${err.message}`);
      return true;
    },
  );
  const state = readState(workDir);
  assert.equal(state.stage, 'FAILED', 'state.stage must be FAILED');
  assert.equal(state.error.code, expectCode);
  assert.ok(state.error.message.includes(expectReasonPart));
  const events = fs.readFileSync(path.join(workDir, 'events.jsonl'), 'utf8');
  assert.ok(events.includes('"status":"failed"'), 'failed event must be recorded');
  assert.ok(events.includes(expectCode), 'failure identity must be observable in events');
}

test('P2: verify valid=false → verification_failed (NOT unparseable), FAILED state', async () => {
  await expectFailureIdentity({
    outputs: { 'zhihu-verify': { status: 1, stdout: { valid: false, warnings: ['gate'] } } },
    expectCode: 'verification_failed',
    expectReasonPart: 'valid=false',
  });
});

test('P2: verify malformed JSON → verification_failed with unparseable reason, FAILED state', async () => {
  await expectFailureIdentity({
    outputs: { 'zhihu-verify': { status: 1, stdout: '{broken json!!' } },
    expectCode: 'verification_failed',
    expectReasonPart: 'unparseable',
  });
});

test('P2: verify child exit != 0 (empty stdout) → subprocess failure reason, FAILED state', async () => {
  await expectFailureIdentity({
    failOn: { 'zhihu-verify': true },
    expectCode: 'verification_failed',
    expectReasonPart: 'subprocess failed',
  });
});

test('P2: corpus-verify-handoff valid=false → handoff_invalid valid=false (NOT unparseable)', async () => {
  await expectFailureIdentity({
    outputs: { 'corpus-verify-handoff': { status: 1, stdout: { valid: false, issues: ['bad'] } } },
    expectCode: 'handoff_invalid',
    expectReasonPart: 'valid=false',
  });
});

test('P2: corpus-verify-handoff malformed JSON → handoff_invalid unparseable', async () => {
  await expectFailureIdentity({
    outputs: { 'corpus-verify-handoff': { status: 1, stdout: 'oops' } },
    expectCode: 'handoff_invalid',
    expectReasonPart: 'unparseable',
  });
});

test('P2: corpus-verify-work valid=false → coverage_failed valid=false (NOT unparseable)', async () => {
  await expectFailureIdentity({
    outputs: { 'corpus-verify-work': { status: 1, stdout: { valid: false, missingMappedSources: 2 } } },
    expectCode: 'coverage_failed',
    expectReasonPart: 'valid=false',
  });
});

test('P2: corpus-verify-work malformed JSON → coverage_failed unparseable', async () => {
  await expectFailureIdentity({
    outputs: { 'corpus-verify-work': { status: 1, stdout: 'not json' } },
    expectCode: 'coverage_failed',
    expectReasonPart: 'unparseable',
  });
});

test('P2: corpus-verify-final valid=false → coverage_failed valid=false', async () => {
  await expectFailureIdentity({
    outputs: { 'corpus-verify-final': { status: 1, stdout: { valid: false, invalidRefs: 3 } } },
    expectCode: 'coverage_failed',
    expectReasonPart: 'valid=false',
  });
});

test('P2: search malformed JSON → search_failed unparseable, FAILED state', async () => {
  await expectFailureIdentity({
    outputs: { 'zhihu-search': { status: 0, stdout: 'not json at all' } },
    expectCode: 'search_failed',
    expectReasonPart: 'unparseable',
  });
});
