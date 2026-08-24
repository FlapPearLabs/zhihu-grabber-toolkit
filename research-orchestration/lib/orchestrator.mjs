/**
 * research-orchestration/lib/orchestrator.mjs
 *
 * Research Orchestration MVP — thin deterministic controller (Approved
 * docs/specs/research-orchestration-scope.md §3 / §8 / §9 / §10).
 *
 * ORCHESTRATOR_COORDINATES / VERIFIER_AUTHORITATES: the orchestrator sequences existing
 * primitives, inspects their machine-readable results, chooses legal next stages, applies
 * Approved routing/product policy, maintains resumable state, and surfaces progress/failures.
 * It NEVER reimplements capture/verify/handoff/corpus logic, NEVER lets an LLM decide
 * validity, and FAILS CLOSED with no semantic downgrade and no silent runtime fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  STAGE_SEARCH,
  STAGE_SELECT,
  STAGE_CAPTURE,
  STAGE_VERIFY,
  STAGE_HANDOFF,
  STAGE_ANALYZE,
  STAGE_RENDER,
  STAGE_COMPLETE,
  STAGE_FAILED,
  STAGES,
  makeState,
  readState,
  writeState,
  appendEvent,
  validateCheckpoint,
  toWorkRelative,
  sha256,
} from './state.mjs';
import { selectCandidate, SELECT_VERDICT_AUTO, SELECT_VERDICT_AMBIGUOUS, SELECT_VERDICT_NONE } from './selection.mjs';
import { MODE_DIGEST, MODE_TOP_PERCENT } from './intent.mjs';

/** Approved qualified semantic runtimes for public Zhihu research (R5). */
export const RUNTIME_DEEPSEEK = 'deepseek-api-tool-less';
export const RUNTIME_LMSTUDIO = 'lmstudio-local-tool-less';
export const APPROVED_RUNTIMES = [RUNTIME_DEEPSEEK, RUNTIME_LMSTUDIO];

/** Hierarchy trigger: digest mode uses hierarchical full digest when corpus exceeds this (R4). */
export const HIERARCHY_THRESHOLD_CHARS = 32_000;

export class OrchestrationError extends Error {
  constructor(code, message, { stage = null, details = null } = {}) {
    super(message);
    this.name = 'OrchestrationError';
    this.code = code;
    this.stage = stage;
    this.details = details;
  }
}

function parseJson(stdout, what) {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new OrchestrationError('analysis_failed', `${what}: unparseable machine output`, { details: err.message });
  }
}

function firstLine(text) {
  const s = String(text ?? '').trim();
  return s.split('\n')[0] ?? '';
}

/** Extract a useful diagnostic from pretty-printed JSON stdout (warnings/issues/error). */
function jsonDetail(stdout) {
  try {
    const j = JSON.parse(stdout);
    const d = j?.warnings ?? j?.issues ?? j?.error?.message ?? null;
    if (d != null) return JSON.stringify(d).slice(0, 500);
  } catch {
    /* fall through to first line */
  }
  return firstLine(stdout);
}

export function createOrchestrator({
  workDir,
  topic,
  mode,
  percent,
  runtime = RUNTIME_DEEPSEEK,
  forceQuestionId = null,
  runner,
  hierarchyThresholdChars = HIERARCHY_THRESHOLD_CHARS,
}) {
  if (!runner) throw new Error('orchestrator requires a runner');
  if (!APPROVED_RUNTIMES.includes(runtime)) {
    throw new OrchestrationError('runtime_unavailable', `unsupported runtime: ${runtime}（approved: ${APPROVED_RUNTIMES.join(', ')}）`);
  }

  const run = (name, args, opts) => {
    const res = runner(name, args, opts);
    if (res.status !== 0) {
      // route through fail() so stage=FAILED, state.error and a failed event are observable (§10)
      fail(new OrchestrationError(stageErrorCode(name), `${name} failed (exit ${res.status})`, {
        stage: state.stage,
        details: firstLine(res.stderr) || firstLine(res.stdout),
      }));
    }
    return res;
  };

  function stageErrorCode(name) {
    switch (name) {
      case 'zhihu-search': return 'search_failed';
      case 'zhihu-grab': return 'capture_failed';
      case 'zhihu-verify': return 'verification_failed';
      case 'zhihu-handoff':
      case 'corpus-verify-handoff': return 'handoff_invalid';
      case 'corpus-map': return 'analysis_failed';
      case 'corpus-verify-work':
      case 'corpus-verify-final': return 'coverage_failed';
      case 'corpus-chunk':
      case 'corpus-select':
      case 'corpus-reduce': return 'analysis_failed';
      case 'corpus-render': return 'render_failed';
      default: return 'analysis_failed';
    }
  }

  const stageDone = (stage) => {
    if (!state.completedStages.includes(stage)) state.completedStages.push(stage);
    state.stage = stage;
    writeState(workDir, state);
    appendEvent(workDir, { event: 'stage', stage, status: 'done' });
  };

  const stageStart = (stage) => {
    state.stage = stage;
    writeState(workDir, state);
    appendEvent(workDir, { event: 'stage', stage, status: 'start' });
  };

  const fail = (err) => {
    state.stage = STAGE_FAILED;
    state.error = { code: err.code, message: err.message, stage: err.stage ?? state.stage };
    writeState(workDir, state);
    appendEvent(workDir, { event: 'stage', stage: state.stage, status: 'failed', code: err.code, message: err.message });
    throw err;
  };

  /**
   * Deterministic gate validation with correct FAILURE IDENTITY:
   *   VALID FALSE  !=  UNPARSEABLE OUTPUT  !=  SUBPROCESS EXIT FAILURE  (all FAIL_CLOSED).
   * parse first → evaluate valid → fail() OUTSIDE the parsing try/catch,
   * so valid=false is never misreported as unparseable.
   * Returns parsed gate report when valid (status 0 + valid===true); otherwise throws via fail().
   */
  function assertGateValid(res, { code, stage, validFalseMessage, gateLabel }) {
    let parsed = null;
    let parseError = false;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      parseError = true;
    }
    if (res.status === 0 && parsed && parsed.valid === true) return parsed;
    let reason;
    if (parsed && parsed.valid === false) {
      reason = validFalseMessage;
    } else if (res.status === 2) {
      reason = `${gateLabel} subprocess failed (exit 2)`;
    } else if (parseError) {
      reason = String(res.stdout ?? '').trim()
        ? `${gateLabel} output unparseable`
        : `${gateLabel} subprocess failed (exit ${res.status})`;
    } else {
      reason = `${gateLabel} subprocess failed (exit ${res.status})`;
    }
    fail(new OrchestrationError(code, reason, { stage, details: jsonDetail(res.stdout) || firstLine(res.stderr) }));
    return null;
  }

  // ---------- stage implementations (each idempotent; resume skips validated stages) ----------

  async function stageSearch() {
    stageStart(STAGE_SEARCH);
    const pre = runner('zhihu-preflight', [], {});
    let secretUsable = false;
    try {
      const p = parseJson(pre.stdout, 'zhihu-preflight');
      secretUsable = Boolean(p?.secret?.usable);
    } catch {
      /* preflight stdout may be human; treat unparseable as unusable */
    }
    if (!secretUsable) {
      fail(new OrchestrationError('configuration_error', 'zhihu search secret is not usable（zhihu_secret.txt 或 ZHIHU_SECRET）', { stage: STAGE_SEARCH }));
    }
    const res = run('zhihu-search', [topic, '--json']);
    let data;
    try {
      data = JSON.parse(res.stdout);
    } catch {
      fail(new OrchestrationError('search_failed', 'search output unparseable', { stage: STAGE_SEARCH, details: firstLine(res.stdout) }));
    }
    if (data.ok !== true) {
      fail(new OrchestrationError('search_failed', 'search returned ok=false', { stage: STAGE_SEARCH, details: data.error?.message }));
    }
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    // Persist search evidence (observable + resumable); hash the EXACT file bytes for checkpoint validation.
    const searchFile = path.join(workDir, 'search-result.json');
    const searchContent = `${JSON.stringify({ topic, candidates }, null, 2)}\n`;
    fs.writeFileSync(searchFile, searchContent);
    state.artifacts[STAGE_SEARCH] = toWorkRelative(workDir, searchFile);
    state.hashes[STAGE_SEARCH] = sha256(searchContent);
    state.searchCandidates = candidates;
    stageDone(STAGE_SEARCH);
  }

  function stageSelect() {
    stageStart(STAGE_SELECT);
    const candidates = state.searchCandidates ?? [];
    const decision = selectCandidate(topic, candidates, { forceQuestionId });
    const decisionFile = path.join(workDir, 'selection-decision.json');
    const decisionContent = `${JSON.stringify(decision, null, 2)}\n`;
    fs.writeFileSync(decisionFile, decisionContent);
    state.artifacts[STAGE_SELECT] = toWorkRelative(workDir, decisionFile);
    state.hashes[STAGE_SELECT] = sha256(decisionContent);
    state.selection = {
      verdict: decision.verdict,
      rationale: decision.rationale,
      candidates: decision.candidates.map((c) => ({
        questionId: c.questionId,
        title: c.title,
        answerCount: c.answerCount,
        url: c.url,
        score: c.score,
      })),
    };
    if (decision.verdict === SELECT_VERDICT_NONE) {
      fail(new OrchestrationError('no_valid_candidate', decision.rationale, { stage: STAGE_SELECT, details: decision.candidates }));
    }
    if (decision.verdict === SELECT_VERDICT_AMBIGUOUS) {
      state.stage = STAGE_SELECT;
      writeState(workDir, state);
      appendEvent(workDir, { event: 'clarification_required', stage: STAGE_SELECT, candidates: state.selection.candidates });
      return { clarificationRequired: true, selection: state.selection };
    }
    state.selectedQuestionId = decision.selected.questionId;
    state.selectedQuestion = {
      questionId: decision.selected.questionId,
      title: decision.selected.title,
      answerCount: decision.selected.answerCount,
      url: decision.selected.url,
    };
    stageDone(STAGE_SELECT);
    return { clarificationRequired: false, selection: state.selection };
  }

  function captureParentDir() {
    return path.join(workDir, 'zhihu');
  }

  function captureDir() {
    return path.join(captureParentDir(), String(state.selectedQuestionId));
  }

  function stageCapture() {
    stageStart(STAGE_CAPTURE);
    const dir = captureDir();
    fs.mkdirSync(captureParentDir(), { recursive: true });
    // zhigrab treats --out-dir as the PARENT: it writes <out-dir>/<questionId>/answers.json
    const res = run('zhihu-grab', [String(state.selectedQuestionId), '--out-dir', captureParentDir(), '--json']);
    let data;
    try {
      data = JSON.parse(res.stdout);
    } catch {
      fail(new OrchestrationError('capture_failed', 'grab output unparseable', { stage: STAGE_CAPTURE, details: firstLine(res.stdout) }));
    }
    if (data.ok !== true) {
      fail(new OrchestrationError('capture_failed', 'grab returned ok=false', { stage: STAGE_CAPTURE, details: data.error?.message }));
    }
    const answersJson = path.join(dir, 'answers.json');
    if (!fs.existsSync(answersJson)) {
      fail(new OrchestrationError('capture_failed', 'answers.json missing after capture', { stage: STAGE_CAPTURE }));
    }
    state.artifacts[STAGE_CAPTURE] = toWorkRelative(workDir, answersJson);
    state.hashes[STAGE_CAPTURE] = sha256(fs.readFileSync(answersJson, 'utf8'));
    stageDone(STAGE_CAPTURE);
  }

  function stageVerify() {
    stageStart(STAGE_VERIFY);
    const res = runner('zhihu-verify', [captureDir()], {});
    const v = assertGateValid(res, {
      code: 'verification_failed',
      stage: STAGE_VERIFY,
      validFalseMessage: 'verify-output valid=false（FAIL_CLOSED；captured != verified）',
      gateLabel: 'verify-output',
    });
    state.verification = {
      valid: true,
      questionId: v?.questionId ?? null,
      capturedAnswerCount: v?.capturedAnswerCount ?? null,
      reportedAnswerCount: v?.reportedAnswerCount ?? null,
    };
    state.artifacts[STAGE_VERIFY] = state.artifacts[STAGE_CAPTURE];
    state.hashes[STAGE_VERIFY] = state.hashes[STAGE_CAPTURE];
    stageDone(STAGE_VERIFY);
  }

  function stageHandoff() {
    stageStart(STAGE_HANDOFF);
    run('zhihu-handoff', [captureDir(), '--task', 'digest']);
    const handoffFile = path.join(captureDir(), 'handoff.json');
    if (!fs.existsSync(handoffFile)) {
      fail(new OrchestrationError('handoff_invalid', 'handoff.json missing after make-handoff', { stage: STAGE_HANDOFF }));
    }
    const cv = runner('corpus-verify-handoff', [handoffFile, '--source-root', captureDir()]);
    assertGateValid(cv, {
      code: 'handoff_invalid',
      stage: STAGE_HANDOFF,
      validFalseMessage: 'corpus handoff verify valid=false',
      gateLabel: 'corpus handoff verify',
    });
    state.artifacts[STAGE_HANDOFF] = toWorkRelative(workDir, handoffFile);
    state.hashes[STAGE_HANDOFF] = sha256(fs.readFileSync(handoffFile, 'utf8'));
    stageDone(STAGE_HANDOFF);
  }

  function corpusWorkDir() {
    return path.join(workDir, 'corpus');
  }

  function analyzeInputAnswersJson() {
    return path.join(captureDir(), 'answers.json');
  }

  function readManifestChars() {
    const mf = path.join(corpusWorkDir(), 'manifest.json');
    if (!fs.existsSync(mf)) return 0;
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      return Array.isArray(m.inputs) ? m.inputs.reduce((acc, i) => acc + (Number(i.chars) || 0), 0) : 0;
    } catch {
      return 0;
    }
  }

  function readCoverage() {
    const cf = path.join(corpusWorkDir(), 'coverage.json');
    if (!fs.existsSync(cf)) return null;
    try {
      return JSON.parse(fs.readFileSync(cf, 'utf8'));
    } catch {
      return null;
    }
  }

  function readFinalJson() {
    const ff = path.join(corpusWorkDir(), 'final', 'final.json');
    if (!fs.existsSync(ff)) return null;
    try {
      return JSON.parse(fs.readFileSync(ff, 'utf8'));
    } catch {
      return null;
    }
  }

  function stageAnalyze() {
    stageStart(STAGE_ANALYZE);
    // R5 runtime preflight: fail closed with observable identity; NO silent fallback.
    if (runtime === RUNTIME_DEEPSEEK) {
      const pre = runner('deepseek-preflight', [], {});
      let usable = pre.status === 0;
      if (pre.status === 0) {
        try {
          usable = JSON.parse(pre.stdout)?.credential?.usable === true;
        } catch {
          usable = true; // exit 0 is the authoritative usable signal for preflight-deepseek
        }
      }
      if (!usable) {
        fail(new OrchestrationError('runtime_unavailable', `runtime ${runtime} unavailable（deepseek preflight failed）；NO_SILENT_RUNTIME_FALLBACK`, { stage: STAGE_ANALYZE }));
      }
    }

    const cw = corpusWorkDir();
    fs.mkdirSync(cw, { recursive: true });
    const answersJson = analyzeInputAnswersJson();

    if (mode === MODE_TOP_PERCENT) {
      run('corpus-select', [answersJson, '--work', cw, '--percent', String(percent)]);
      run('corpus-chunk', [answersJson, '--work', cw, '--mode', MODE_TOP_PERCENT, '--selection', path.join(cw, 'selection.json')]);
    } else {
      run('corpus-chunk', [answersJson, '--work', cw, '--mode', MODE_DIGEST]);
    }

    const totalChars = readManifestChars();
    const useHierarchy = mode === MODE_DIGEST && totalChars > hierarchyThresholdChars;
    const mapArgs = ['--work', cw, '--runtime', runtime];
    if (useHierarchy) mapArgs.push('--hierarchy');
    run('corpus-map', mapArgs);

    const vw = runner('corpus-verify-work', [cw]);
    assertGateValid(vw, {
      code: 'coverage_failed',
      stage: STAGE_ANALYZE,
      validFalseMessage: 'corpus coverage valid=false（FAIL_CLOSED；不得绕过 sourceCoverage）',
      gateLabel: 'corpus verify --work',
    });

    const finalDir = path.join(cw, 'final');
    fs.mkdirSync(finalDir, { recursive: true });
    run('corpus-reduce', ['--work', cw, '--out', path.join(finalDir, 'digest.md')]);

    const finalFile = path.join(finalDir, 'final.json');
    if (!fs.existsSync(finalFile)) {
      fail(new OrchestrationError('analysis_failed', 'final.json missing after reduce', { stage: STAGE_ANALYZE }));
    }
    const fv = runner('corpus-verify-final', [cw, '--final', finalFile]);
    assertGateValid(fv, {
      code: 'coverage_failed',
      stage: STAGE_ANALYZE,
      validFalseMessage: 'corpus verify --final valid=false',
      gateLabel: 'corpus verify --final',
    });

    state.coverage = readCoverage();
    state.analysisResult = {
      mode,
      percent: mode === MODE_TOP_PERCENT ? percent : null,
      useHierarchy,
      totalChars,
      finalJson: readFinalJson(),
    };
    state.artifacts[STAGE_ANALYZE] = toWorkRelative(workDir, finalFile);
    state.hashes[STAGE_ANALYZE] = sha256(fs.readFileSync(finalFile, 'utf8'));
    stageDone(STAGE_ANALYZE);
  }

  function stageRender() {
    stageStart(STAGE_RENDER);
    const cw = corpusWorkDir();
    const finalFile = path.join(cw, 'final', 'final.json');
    run('corpus-render', ['--final', finalFile, '--out', path.join(cw, 'final', 'digest.md')]);

    const finalJson = state.analysisResult?.finalJson ?? readFinalJson();
    const digestMd = fs.existsSync(path.join(cw, 'final', 'digest.md'))
      ? fs.readFileSync(path.join(cw, 'final', 'digest.md'), 'utf8')
      : '';
    const coverage = state.coverage ?? readCoverage();

    // reduce.mjs spreads the top-percent disclosure block at final.json top level
    // (mode / totalAnswers / selectedAnswers / requestedPercent / actualCoveragePercent /
    //  selectionRule / selectedSourceIds / isFullCoverage) rather than a nested `disclosure`.
    const disclosure = finalJson
      ? {
          mode: finalJson.mode ?? mode,
          totalAnswers: finalJson.totalAnswers ?? null,
          selectedAnswers: finalJson.selectedAnswers ?? null,
          requestedPercent: finalJson.requestedPercent ?? null,
          actualCoveragePercent: finalJson.actualCoveragePercent ?? null,
          selectionRule: finalJson.selectionRule ?? null,
          selectedSourceIds: finalJson.selectedSourceIds ?? null,
          isFullCoverage: finalJson.isFullCoverage ?? null,
        }
      : null;
    const isFullCoverage = mode === MODE_DIGEST;
    const result = {
      schemaVersion: 1,
      topic,
      selectedQuestion: state.selectedQuestion ?? null,
      selection: state.selection ?? null,
      analysis: {
        mode,
        isFullCoverage,
        disclosure,
        requestedPercent: mode === MODE_TOP_PERCENT ? percent : null,
        useHierarchy: state.analysisResult?.useHierarchy ?? false,
      },
      runtime,
      verification: state.verification ?? null,
      coverage: coverage
        ? {
            valid: coverage.valid,
            mode: coverage.mode,
            mapCount: coverage.mapCount,
            missingMappedSources: coverage.missingMappedSources,
            staleHashes: coverage.staleHashes,
            hierarchyIssues: coverage.hierarchyIssues ?? null,
          }
        : null,
      synthesis: finalJson
        ? {
            claims: Array.isArray(finalJson.claims) ? finalJson.claims : [],
            minorityViews: Array.isArray(finalJson.minorityViews) ? finalJson.minorityViews : [],
            uncertainties: Array.isArray(finalJson.uncertainties) ? finalJson.uncertainties : [],
            summary: finalJson.summary ?? null,
          }
        : null,
      artifacts: {
        captureDir: toWorkRelative(workDir, captureDir()),
        handoff: state.artifacts[STAGE_HANDOFF],
        finalJson: state.artifacts[STAGE_ANALYZE],
        digestMd: toWorkRelative(workDir, path.join(cw, 'final', 'digest.md')),
        researchResult: 'research-result.json',
      },
      stage: STAGE_COMPLETE,
    };

    const resultFile = path.join(workDir, 'research-result.json');
    const resultContent = `${JSON.stringify(result, null, 2)}\n`;
    fs.writeFileSync(resultFile, resultContent);

    // Human-facing final rendered research result (header + digest body).
    const header = [
      `# 知乎研究结果：${topic}`,
      '',
      `- 研究主题：${topic}`,
      `- 选中问题：${state.selectedQuestion?.title ?? '(无)'}（${state.selectedQuestion?.url ?? ''}）`,
      `- 分析模式：${mode === MODE_DIGEST ? '全量研究（FULL-COVERAGE DIGEST）' : `采样分析（top ${percent}%）`}`,
      mode === MODE_DIGEST ? '- 覆盖：100% 全量（isFullCoverage=true）' : `- 覆盖：采样（requested ${percent}%；非全量）`,
      `- 运行时：${runtime}`,
      `- 验证：${state.verification?.valid === true ? 'verified（verify-output PASS）' : 'unverified'}`,
      `- 捕获回答数：${state.verification?.capturedAnswerCount ?? '(n/a)'}`,
      `- 选择决策：${state.selection?.rationale ?? '(n/a)'}`,
      '',
      '---',
      '',
    ].join('\n');
    const humanMd = `${header}${digestMd}`;
    fs.writeFileSync(path.join(workDir, 'research-result.md'), humanMd);

    state.artifacts[STAGE_RENDER] = 'research-result.json';
    state.hashes[STAGE_RENDER] = sha256(resultContent);
    state.result = result;
    stageDone(STAGE_RENDER);
  }

  // ---------- top-level run ----------

  const state = makeState({ workDir, topic, mode, percent, runtime, forceQuestionId });
  const stagesToArtifacts = {
    [STAGE_SEARCH]: (s) => s.artifacts?.[STAGE_SEARCH] ?? null,
    [STAGE_SELECT]: (s) => s.artifacts?.[STAGE_SELECT] ?? null,
    [STAGE_CAPTURE]: (s) => s.artifacts?.[STAGE_CAPTURE] ?? null,
    [STAGE_VERIFY]: (s) => s.artifacts?.[STAGE_VERIFY] ?? null,
    [STAGE_HANDOFF]: (s) => s.artifacts?.[STAGE_HANDOFF] ?? null,
    [STAGE_ANALYZE]: (s) => s.artifacts?.[STAGE_ANALYZE] ?? null,
    [STAGE_RENDER]: (s) => s.artifacts?.[STAGE_RENDER] ?? null,
  };

  async function runOrchestration() {
    fs.mkdirSync(workDir, { recursive: true });
    appendEvent(workDir, { event: 'run_start', topic, mode, percent, runtime });

    const existing = readState(workDir);
    if (existing) {
      const check = validateCheckpoint(workDir, state.runId, stagesToArtifacts);
      if (!check.valid && check.reason === 'state_mismatch') {
        throw new OrchestrationError('state_mismatch', 'existing orchestration state belongs to a different run（topic/mode/percent/runtime changed）；use --work 新目录或 --restart', { stage: null });
      }
      if (existing.stage === STAGE_COMPLETE && check.valid) {
        appendEvent(workDir, { event: 'resume', stage: STAGE_COMPLETE, note: 'already complete' });
        return existing.result ?? readResult();
      }
      if (existing.completedStages.length > 0) {
        appendEvent(workDir, { event: 'resume', stage: check.resumeFromStage, reason: check.reason });
      }
      // Carry forward validated state. When a stale/incompatible artifact is detected,
      // drop every stage from the resume point onward so it re-runs (no silent reuse).
      const resumeIdx = STAGES.indexOf(check.resumeFromStage);
      state.completedStages = (existing.completedStages ?? []).filter((s) => {
        const i = STAGES.indexOf(s);
        return i !== -1 && i < resumeIdx;
      });
      Object.assign(state, {
        stage: check.resumeFromStage,
        selectedQuestionId: existing.selectedQuestionId ?? null,
        selectedQuestion: existing.selectedQuestion ?? null,
        selection: existing.selection ?? null,
        artifacts: existing.artifacts ?? {},
        hashes: existing.hashes ?? {},
        verification: existing.verification ?? null,
        coverage: existing.coverage ?? null,
        analysisResult: existing.analysisResult ?? null,
        searchCandidates: existing.searchCandidates ?? null,
        result: existing.result ?? null,
      });
    }

    if (!state.completedStages.includes(STAGE_SEARCH)) await stageSearch();
    const selectOutcome = !state.completedStages.includes(STAGE_SELECT) ? stageSelect() : { clarificationRequired: false };
    if (selectOutcome.clarificationRequired) {
      appendEvent(workDir, { event: 'stop', reason: 'clarification_required', candidates: state.selection?.candidates ?? [] });
      return { clarificationRequired: true, selection: state.selection, stage: STAGE_SELECT, workDir };
    }
    if (!state.completedStages.includes(STAGE_CAPTURE)) stageCapture();
    if (!state.completedStages.includes(STAGE_VERIFY)) stageVerify();
    if (!state.completedStages.includes(STAGE_HANDOFF)) stageHandoff();
    if (!state.completedStages.includes(STAGE_ANALYZE)) stageAnalyze();
    if (!state.completedStages.includes(STAGE_RENDER)) stageRender();

    state.stage = STAGE_COMPLETE;
    writeState(workDir, state);
    appendEvent(workDir, { event: 'stage', stage: STAGE_COMPLETE, status: 'done' });
    return state.result ?? readResult();
  }

  function readResult() {
    const rf = path.join(workDir, 'research-result.json');
    if (!fs.existsSync(rf)) return null;
    try {
      return JSON.parse(fs.readFileSync(rf, 'utf8'));
    } catch {
      return null;
    }
  }

  return { runOrchestration, state };
}

export function resultFromJson(json) {
  return json;
}
