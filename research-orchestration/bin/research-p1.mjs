#!/usr/bin/env node
/**
 * research-orchestration/bin/research-p1.mjs
 *
 * The DEDICATED P1 Cross-Question Deep Research runtime composition
 * entrypoint (P1-T15 post-merge runtime-composition wiring repair, Issue
 * #47). The project canonical runner (bin/canonical-runner.mjs) executes
 * THIS entrypoint: it drives the frozen P1 composition owner
 * (lib/coverage-final-integration.mjs) through its canonical stage order —
 * plan → multi-provider retrieval → source-group selection → multi-group
 * execution → dense geometry + RCE → per-group analysis → guarded
 * synthesis → final coverage reconciliation → render binding + result.
 *
 * This is NOT the generic/v0.3 single-question CLI, which keeps its own
 * behavior unchanged. The P1 composition chain pins the
 * approved public-Zhihu semantic runtime (deepseek-api-tool-less /
 * deepseek-v4-pro request route); any other --runtime value fails closed as invalid
 * input (NO_SILENT_RUNTIME_FALLBACK — there is no fallback path here).
 *
 * Usage:
 *   node bin/research-p1.mjs <topic> [options]
 *
 * Options (the canonical runner passes exactly these):
 *   --work <dir>    run work directory (default ./work/research-p1)
 *   --json          single machine-readable JSON object on stdout
 *   --restart       discard any prior checkpoint and start fresh
 *   --runtime <id>  must be exactly deepseek-api-tool-less (fail-closed otherwise)
 *   -h, --help
 *
 * Exit codes (v0.3 CLI contract vocabulary):
 *   0  COMPLETE (or a valid completed checkpoint was reused)
 *   1  failure (fail-closed; --json gives the structured error identity)
 *   2  usage error
 *   3  CLARIFICATION_REQUIRED (material ambiguity; structured options)
 */

import path from 'node:path';
import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { P1_PIPELINE_IDENTITY } from '../lib/coverage-final-integration.mjs';

const HELP = `research-p1 — P1 cross-question deep research composition entrypoint

用法:
  node research-orchestration/bin/research-p1.mjs <topic> [options]

选项:
  --work <dir>        运行工作目录（默认 ./work/research-p1）
  --json              在 stdout 输出单一机器可读 JSON 结果
  --restart           丢弃既有 checkpoint 重新开始
  --runtime <id>      必须恰好是 deepseek-api-tool-less（其余一律 invalid_input，无回退）
  -h, --help          本帮助

退出码:
  0  COMPLETE（或合法复用已完成 checkpoint）
  1  失败（fail-closed；--json 给出结构化错误）
  2  用法错误
  3  CLARIFICATION_REQUIRED（实质歧义；--json 给出候选组选项）
`;

const APPROVED_P1_RUNTIME = 'deepseek-api-tool-less';

function parseArgs(argv) {
  const opts = { workDir: path.join(process.cwd(), 'work', 'research-p1'), json: false, restart: false, runtime: APPROVED_P1_RUNTIME };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--restart') { opts.restart = true; continue; }
    if (a === '--work') { opts.workDir = path.resolve(process.cwd(), argv[++i] ?? ''); continue; }
    if (a === '--runtime') { opts.runtime = String(argv[++i] ?? ''); continue; }
    if (a.startsWith('--')) { opts.usageError = `unknown option: ${a}`; break; }
    positional.push(a);
  }
  opts.topic = positional.join(' ').trim();
  return opts;
}

function usageError(msg, json) {
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, ok: false, command: 'research-p1', error: { type: 'invalid_input', message: msg } }, null, 2));
  } else {
    console.error(`错误: ${msg}`);
    console.error(HELP);
  }
  process.exit(2);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (opts.usageError) usageError(opts.usageError, opts.json);
  if (!opts.topic) usageError('missing research topic', opts.json);
  // The pinned composition chain accepts ONLY the approved public-Zhihu
  // semantic runtime; anything else is invalid input, never a fallback.
  if (opts.runtime !== APPROVED_P1_RUNTIME) {
    usageError(`P1 composition accepts only ${APPROVED_P1_RUNTIME} (got ${JSON.stringify(opts.runtime)}); NO_SILENT_RUNTIME_FALLBACK`, opts.json);
  }

  const usage = [];
  const out = await composeP1Research({
    topic: opts.topic,
    workDir: opts.workDir,
    restart: opts.restart,
    fetchImpl: fetch,
    usageSink: usage,
  });

  if (out.ok) {
    if (opts.json) {
      console.log(JSON.stringify({ ...out.result, reused: out.reused === true }, null, 2));
    } else {
      console.log(`[research-p1] 完成（P1 ${P1_PIPELINE_IDENTITY}；100% 分析覆盖=${out.result.disclosure.isFullCoverage}）`);
    }
    process.exit(0);
  }

  if (out.clarificationRequired) {
    if (opts.json) {
      console.log(JSON.stringify({
        schemaVersion: 1,
        ok: false,
        command: 'research-p1',
        error: { type: 'clarification_required', message: 'material ambiguity — multiple source-group interpretations' },
        options: out.options ?? [],
      }, null, 2));
    } else {
      console.error('[research-p1] 需要澄清：存在多个实质不同的研究解释（候选组：' + (out.options ?? []).join(', ') + '）');
    }
    process.exit(3);
  }

  if (opts.json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      ok: false,
      command: 'research-p1',
      error: { type: out.code ?? 'unknown_error', message: out.details ?? '' },
    }, null, 2));
  } else {
    console.error(`[research-p1] 失败（${out.code ?? 'unknown_error'}）: ${out.details ?? ''}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(`[research-p1] aborted: ${err?.message ?? String(err)}`);
  process.exit(1);
});
