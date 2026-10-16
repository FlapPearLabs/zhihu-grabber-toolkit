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
 * behavior unchanged. One model serves the whole chain; it is chosen with
 * --model (default deepseek/deepseek-v4-pro, see lib/model-runtime.mjs). A
 * model that cannot be used fails closed — there is no fallback model.
 *
 * Usage:
 *   node bin/research-p1.mjs <topic> [options]
 *
 * Options:
 *   --work <dir>        run work directory (default ./work/research-p1)
 *   --json              single machine-readable JSON object on stdout
 *   --restart           discard any prior checkpoint and start fresh
 *   --model <p/id>      model as <provider>/<model-id> (default deepseek/deepseek-v4-pro)
 *   --base-url <url>    OpenAI-compatible endpoint for --model (any provider label)
 *   --runtime <id>      legacy; only deepseek-api-tool-less (= the default model)
 *   -h, --help
 *
 * On success a human-readable report.md is rendered into the work directory
 * (derived view; see lib/report.mjs).
 *
 * Exit codes (v0.3 CLI contract vocabulary):
 *   0  COMPLETE (or a valid completed checkpoint was reused)
 *   1  failure (fail-closed; --json gives the structured error identity)
 *   2  usage error
 *   3  CLARIFICATION_REQUIRED (material ambiguity; structured options)
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { P1_PIPELINE_IDENTITY } from '../lib/coverage-final-integration.mjs';
import { writeReport, summarizeReport, REPORT_FILENAME } from '../lib/report.mjs';
import { parseModelSpec, validateBaseUrl } from '../lib/model-runtime.mjs';

const HELP = `research-p1 — P1 cross-question deep research composition entrypoint

用法:
  node research-orchestration/bin/research-p1.mjs <topic> [options]

选项:
  --work <dir>        运行工作目录（默认 ./work/research-p1）
  --json              在 stdout 输出单一机器可读 JSON 结果
  --restart           丢弃既有 checkpoint 重新开始
  --clarification <file>  从绑定同一 occurrence 的 JSON 用户回应恢复；不能与 --restart 同用
  --model <p/id>      模型，格式 <provider>/<model-id>（默认 deepseek/deepseek-v4-pro）
                      例：moonshotai-cn/kimi-k2.6、openrouter/anthropic/claude-sonnet-4.5
  --base-url <url>    OpenAI 兼容接口地址；此时 provider 可任取名字
                      例：--model antigravity/claude-sonnet-4-6 --base-url http://127.0.0.1:8045/v1
  --runtime <id>      旧参数，只接受 deepseek-api-tool-less（等同默认模型）
  -h, --help          本帮助

API key：RESEARCH_MODEL_API_KEY 环境变量，或 0600 权限的 .model_api_key 文件；
DeepSeek 仍可用 DEEPSEEK_API_KEY / .deepseek_api_key；其他内置 provider 也认各自的
标准环境变量（如 OPENAI_API_KEY、MOONSHOT_API_KEY）。模型不可用时直接失败，不换模型。

成功后会在工作目录写出可读报告 report.md。

退出码:
  0  COMPLETE（或合法复用已完成 checkpoint）
  1  失败（fail-closed；--json 给出结构化错误）
  2  用法错误
  3  CLARIFICATION_REQUIRED（实质歧义；--json 给出候选组选项）
`;

const LEGACY_RUNTIME = 'deepseek-api-tool-less';

function parseArgs(argv) {
  const opts = { workDir: path.join(process.cwd(), 'work', 'research-p1'), json: false, restart: false, runtime: LEGACY_RUNTIME };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--restart') { opts.restart = true; continue; }
    if (a === '--clarification') { opts.clarificationFile = argv[++i];
      if (!opts.clarificationFile || opts.clarificationFile.startsWith('--')) opts.usageError = 'missing clarification response file';
      continue; }
    if (a === '--work') { opts.workDir = path.resolve(process.cwd(), argv[++i] ?? ''); continue; }
    if (a === '--runtime') { opts.runtime = String(argv[++i] ?? ''); continue; }
    if (a === '--model') { opts.model = String(argv[++i] ?? ''); continue; }
    if (a === '--base-url') { opts.baseUrl = String(argv[++i] ?? ''); continue; }
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
  if (opts.clarificationFile && opts.restart) usageError('clarification recovery cannot restart the occurrence', opts.json);
  let clarificationResponse = null;
  if (opts.clarificationFile) {
    try { clarificationResponse = JSON.parse(readFileSync(opts.clarificationFile, 'utf8'));
      if (clarificationResponse === null) throw new Error('null response'); }
    catch { usageError('clarification response must be readable JSON', opts.json); }
  }
  // Legacy --runtime: only the default model's identity is accepted.
  if (opts.runtime !== LEGACY_RUNTIME) {
    usageError(`--runtime accepts only ${LEGACY_RUNTIME}; use --model <provider>/<model-id> (got ${JSON.stringify(opts.runtime)}); NO_SILENT_RUNTIME_FALLBACK`, opts.json);
  }
  if (opts.model !== undefined) {
    try { parseModelSpec(opts.model); } catch (err) { usageError(err.message, opts.json); }
  }
  if (opts.baseUrl !== undefined) {
    if (opts.model === undefined) usageError('--base-url requires --model <provider>/<model-id>', opts.json);
    try { validateBaseUrl(opts.baseUrl); } catch (err) { usageError(err.message, opts.json); }
  }

  const usage = [];
  const out = await composeP1Research({
    topic: opts.topic,
    workDir: opts.workDir,
    restart: opts.restart,
    fetchImpl: fetch,
    model: opts.model ?? null,
    modelBaseUrl: opts.baseUrl ?? null,
    usageSink: usage,
    clarificationResponse,
  });

  if (out.ok) {
    // report.md is a derived, human-readable view. Failing to render it never
    // changes the run outcome: the canonical artifacts are already written.
    let report = null;
    try {
      report = writeReport(opts.workDir);
    } catch (err) {
      console.error(`[research-p1] 警告：未能生成 ${REPORT_FILENAME}（${err?.code ?? 'error'}）: ${err?.message ?? String(err)}`);
    }
    if (opts.json) {
      console.log(JSON.stringify({ ...out.result, reused: out.reused === true, report: report ? REPORT_FILENAME : null }, null, 2));
    } else {
      console.log(`[research-p1] 完成（P1 ${P1_PIPELINE_IDENTITY}；100% 分析覆盖=${out.result.disclosure.isFullCoverage}）`);
      if (report) {
        for (const line of summarizeReport(report.model)) console.log(line);
        console.log(`报告：${report.reportPath}`);
      }
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
        clarificationRequest: out.clarificationRequest,
      }, null, 2));
    } else {
      console.error('[research-p1] 需要澄清：存在多个实质不同的研究解释（候选组：' + (out.options ?? []).join(', ') + '）');
      console.error('请求已保存在 source-group-clarification-request.json；用 --clarification <file> 提交绑定的用户回应。');
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
