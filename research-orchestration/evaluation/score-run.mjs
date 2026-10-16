#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * evaluation/score-run.mjs — score a COMPLETE P1 run offline.
 *
 * Usage:
 *   node research-orchestration/evaluation/score-run.mjs <workDir> [options]
 *
 * Options:
 *   --gold <file>    write a scoring sheet for this gold set (evaluation/scoring-sheet.{json,md})
 *   --sheet <file>   score a filled sheet (evaluation/human-scores.json)
 *   --sample <n>     claims to check in the sheet (default 10)
 *   --force          replace an existing scoring sheet
 *   --json           single machine-readable JSON object on stdout
 *
 * Exit codes: 0 ok · 1 scoring failure (coded) · 2 usage error.
 * Reads only existing artifacts; never re-runs, re-queries or calls a model.
 */

import path from 'node:path';

import { DEFAULT_SAMPLE_SIZE, EVAL_DIR, scoreRun } from './run-scoring.mjs';

const HELP = `score-run — 离线评估一次已完成的 P1 运行

用法:
  node research-orchestration/evaluation/score-run.mjs <运行目录> [选项]

选项:
  --gold <file>    按黄金集生成评分表（evaluation/scoring-sheet.json 和 .md）
  --sheet <file>   读取填好的评分表，计算人工评分（evaluation/human-scores.json）
  --sample <n>     评分表里抽查的观点条数（默认 ${DEFAULT_SAMPLE_SIZE}）
  --force          覆盖已有的评分表
  --json           输出单一机器可读 JSON

退出码: 0 成功 · 1 评估失败 · 2 用法错误`;

function parse(argv) {
  const o = { sampleSize: DEFAULT_SAMPLE_SIZE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) o.usageError = `missing value for ${a}`;
      return v;
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--force') o.force = true;
    else if (a === '--gold') o.goldFile = value();
    else if (a === '--sheet') o.sheetFile = value();
    else if (a === '--sample') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 0 || n > 200) o.usageError = '--sample must be an integer 0–200';
      o.sampleSize = n;
    } else if (a.startsWith('--')) o.usageError = `unknown option: ${a}`;
    else if (o.workDir === undefined) o.workDir = a;
    else o.usageError = `unexpected argument: ${a}`;
    if (o.usageError) break;
  }
  if (!o.help && !o.usageError && !o.workDir) o.usageError = 'missing run directory';
  return o;
}

const pct = (x) => (x === null || x === undefined ? '未知' : `${Math.round(x * 100)}%`);

function printHuman({ metrics, sheetPath, human }) {
  const c = metrics.citations;
  const k = metrics.claims;
  const lines = [
    `话题：${metrics.topic}`,
    `问题组：${metrics.analysis.groups}，分析回答：${metrics.analysis.analyzedCount}`,
    `引用覆盖率：${c.cited}/${c.analyzed}（${pct(c.coverage)}）`,
    `观点：${k.total} 条（主流 ${k.main} / 少数 ${k.minority} / 反对 ${k.contradictory}），多来源 ${k.multiSource} 条（${pct(k.multiSourceRate)}）`,
    `议题：${metrics.synthesis.families}（有分歧 ${metrics.synthesis.conflicting}，跨问题 ${metrics.synthesis.crossGroup}），未归类观点 ${metrics.synthesis.unresolved}`,
    metrics.cost.available
      ? `模型调用：${metrics.cost.calls} 次（失败 ${metrics.cost.failedCalls}），输入 ${metrics.cost.inputTokens} / 输出 ${metrics.cost.outputTokens} tokens${metrics.cost.tokensComplete ? '' : '（部分调用缺少用量）'}`
      : '模型调用：未记录用量',
    `运行耗时：${Math.round(metrics.time.composeMs / 1000)} 秒（${metrics.time.occurrences} 次执行）`,
  ];
  if (sheetPath) lines.push(`评分表：${path.join(EVAL_DIR, path.basename(sheetPath))}（填写后用 --sheet 计分）`);
  if (human) {
    lines.push(
      `黄金观点召回：${pct(human.goldRecall.score)}（完整 ${human.goldRecall.full} / 部分 ${human.goldRecall.partial} / 缺失 ${human.goldRecall.none}）`,
      `引用忠实度：${pct(human.faithfulness.score)}（抽查 ${human.faithfulness.n} 条）`,
      `整体评分：${human.rubric.mean} / 5`,
    );
  }
  console.log(lines.join('\n'));
}

const opts = parse(process.argv.slice(2));
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.usageError) {
  if (opts.json) console.log(JSON.stringify({ ok: false, error: { code: 'USAGE', message: opts.usageError } }));
  else console.error(`score-run: ${opts.usageError}\n\n${HELP}`);
  process.exit(2);
}

const workDir = path.resolve(process.cwd(), opts.workDir);
try {
  const out = scoreRun(workDir, { goldFile: opts.goldFile, sheetFile: opts.sheetFile, force: opts.force, sampleSize: opts.sampleSize });
  if (opts.json) {
    const rel = (p) => (p ? path.relative(workDir, p) : null);
    console.log(JSON.stringify({
      ok: true,
      metrics: rel(out.metricsPath),
      sheet: rel(out.sheetPath),
      humanScores: rel(out.humanPath),
      summary: { citationCoverage: out.metrics.citations.coverage, claims: out.metrics.claims.total, ...(out.human ? { goldRecall: out.human.goldRecall.score, faithfulness: out.human.faithfulness.score, rubricMean: out.human.rubric.mean } : {}) },
    }));
  } else {
    printHuman(out);
  }
} catch (err) {
  const code = typeof err?.code === 'string' ? err.code : 'SCORING_FAILED';
  if (opts.json) console.log(JSON.stringify({ ok: false, error: { code, message: String(err?.message ?? err) } }));
  else console.error(`score-run: ${code}: ${err?.message ?? err}`);
  process.exit(1);
}
