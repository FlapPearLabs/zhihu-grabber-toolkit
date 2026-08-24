#!/usr/bin/env node
/**
 * research-orchestration/bin/research.mjs
 *
 * Research Orchestration MVP CLI entrypoint.
 *
 * Usage:
 *   node research-orchestration/bin/research.mjs <topic> [options]
 *
 * Options:
 *   --work <dir>        run work directory (default ./work/research)
 *   --json              single machine-readable JSON result on stdout
 *   --select <qid>      resolve candidate selection (at most one clarification)
 *   --mode <mode>       explicit analysis mode: digest | top-percent | auto (default auto)
 *   --percent <X>       sampled percent 1..100 (for top-percent mode)
 *   --runtime <id>      semantic runtime (default deepseek-api-tool-less)
 *   --restart           discard prior checkpoint and start fresh
 *   -h, --help          usage
 *
 * Exit codes:
 *   0  COMPLETE
 *   1  failure (FAIL_CLOSED; --json gives structured error)
 *   2  usage error
 *   3  CLARIFICATION_REQUIRED (material ambiguity; structured candidates with --json)
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOrchestrator, OrchestrationError, APPROVED_RUNTIMES, RUNTIME_DEEPSEEK } from '../lib/orchestrator.mjs';
import { defaultRunner } from '../lib/runner.mjs';
import {
  normalizeTopic,
  resolveAnalysisIntent,
  resolveRequestedMode,
  MODE_TOP_PERCENT,
} from '../lib/intent.mjs';
import { readState } from '../lib/state.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const HELP = `research — thin end-to-end Zhihu research workflow

用法:
  node research-orchestration/bin/research.mjs <topic> [options]

选项:
  --work <dir>        运行工作目录（默认 ./work/research）
  --json              在 stdout 输出单一机器可读 JSON 结果
  --select <qid>      解决候选选择（最多一次 clarification）
  --mode <mode>       分析模式: digest | top-percent | auto（默认 auto，按意图解析）
  --percent <X>       采样百分比 1..100（top-percent 模式；默认按意图解析，缺省 20）
  --runtime <id>      语义运行时（默认 deepseek-api-tool-less；可选 lmstudio-local-tool-less）
  --restart           丢弃既有 checkpoint 重新开始
  -h, --help          本帮助

退出码:
  0  COMPLETE
  1  失败（FAIL_CLOSED；--json 给出结构化错误）
  2  用法错误
  3  CLARIFICATION_REQUIRED（实质歧义；--json 给出候选列表）
`;

function parseArgs(argv) {
  const opts = { workDir: path.join(process.cwd(), 'work', 'research'), json: false, select: null, mode: null, percent: null, runtime: RUNTIME_DEEPSEEK, restart: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--restart') { opts.restart = true; continue; }
    if (a === '--work') { opts.workDir = path.resolve(process.cwd(), argv[++i] ?? ''); continue; }
    if (a === '--select') { opts.select = String(argv[++i] ?? ''); continue; }
    if (a === '--mode') { opts.mode = String(argv[++i] ?? ''); continue; }
    if (a === '--percent') { opts.percent = String(argv[++i] ?? ''); continue; }
    if (a === '--runtime') { opts.runtime = String(argv[++i] ?? ''); continue; }
    if (a.startsWith('--')) { opts.usageError = `unknown option: ${a}`; break; }
    positional.push(a);
  }
  opts.topic = normalizeTopic(positional.join(' '));
  return opts;
}

function usageError(msg, json) {
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, ok: false, command: 'research', error: { type: 'invalid_input', message: msg } }, null, 2));
  } else {
    console.error(`错误: ${msg}`);
    console.error(HELP);
  }
  process.exit(2);
}

function emitError(err, opts, workDir) {
  const payload = {
    schemaVersion: 1,
    ok: false,
    command: 'research',
    topic: opts.topic,
    error: { type: err.code ?? 'unknown_error', message: err.message, stage: err.stage ?? null },
  };
  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(`[research] 失败（${err.code ?? 'unknown_error'}）: ${err.message}`);
    if (err.details) console.error(`[research] 详情: ${String(err.details).slice(0, 500)}`);
    const state = readState(workDir);
    if (state?.stage === 'FAILED') console.error(`[research] 进度已记录于 ${path.join(workDir, 'events.jsonl')}`);
  }
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (opts.usageError) usageError(opts.usageError, opts.json);
  if (!opts.topic) usageError('missing research topic', opts.json);
  if (!APPROVED_RUNTIMES.includes(opts.runtime)) {
    usageError(`runtime must be one of: ${APPROVED_RUNTIMES.join(', ')}`, opts.json);
  }

  // Approved analysis-mode policy (R4): explicit --mode wins; 'auto'/absent → intent-driven.
  const intent = resolveAnalysisIntent(opts.topic);
  const resolved = resolveRequestedMode({ explicitMode: opts.mode, explicitPercent: opts.percent, intent });
  if (!resolved.valid) {
    usageError(resolved.mode === MODE_TOP_PERCENT ? '--percent must be an integer 1..100' : '--mode must be digest | top-percent | auto', opts.json);
  }
  const { mode, percent } = resolved;

  const workDir = opts.workDir;
  fs.mkdirSync(workDir, { recursive: true });
  if (opts.restart) {
    const stateFile = path.join(workDir, 'orchestration-state.json');
    if (fs.existsSync(stateFile)) fs.rmSync(stateFile);
  }

  const orchestrator = createOrchestrator({
    workDir,
    topic: opts.topic,
    mode,
    percent,
    runtime: opts.runtime,
    forceQuestionId: opts.select,
    runner: defaultRunner(),
  });

  let outcome;
  try {
    outcome = await orchestrator.runOrchestration();
  } catch (err) {
    if (err instanceof OrchestrationError) {
      emitError(err, opts, workDir);
    }
    emitError(new OrchestrationError('unknown_error', String(err?.message ?? err)), opts, workDir);
  }

  if (outcome && outcome.clarificationRequired) {
    const candidates = (outcome.selection?.candidates ?? []).map((c) => ({
      questionId: c.questionId,
      title: c.title,
      answerCount: c.answerCount,
      url: c.url,
      score: c.score,
    }));
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 1,
            ok: false,
            command: 'research',
            topic: opts.topic,
            status: 'clarification_required',
            reason: outcome.selection?.rationale ?? 'material ambiguity',
            candidates,
            // cwd-relative only — no machine-private absolute paths in machine output (RULES §11)
            resume: { workDir: path.relative(process.cwd(), workDir) || '.', select: '<questionId>' },
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`[research] 需要一次澄清（MATERIAL AMBIGUITY）: ${outcome.selection?.rationale}`);
      for (const c of candidates) {
        console.error(`  - ${c.questionId}  ${c.title}（score=${c.score}，回答数=${c.answerCount ?? '未知'}）`);
      }
      console.error(`[research] 请用 --select <questionId> 重跑以继续（最多一次澄清）`);
    }
    process.exit(3);
  }

  // COMPLETE
  const resultFile = path.join(workDir, 'research-result.json');
  if (opts.json) {
    const r = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : outcome;
    console.log(JSON.stringify(r, null, 2));
  } else {
    const human = path.join(workDir, 'research-result.md');
    if (fs.existsSync(human)) {
      console.log(fs.readFileSync(human, 'utf8'));
    } else if (fs.existsSync(resultFile)) {
      console.log(JSON.stringify(JSON.parse(fs.readFileSync(resultFile, 'utf8')), null, 2));
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`[research] 未预期错误: ${err?.message ?? err}`);
  process.exit(1);
});
