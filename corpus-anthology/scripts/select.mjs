#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * select — top-percent 确定性选择器 CLI（T8, Issue #14）。
 *
 * 用法:
 *   node scripts/select.mjs <answers.json 或目录> [更多...] --work work/ --percent X
 *
 * 行为:
 *   - 收集所有 answers.json（单个文件或递归目录），与 chunk.mjs 相同的来源识别规则。
 *   - 按 T7 批准合同（D2.1-D2.5）确定性选择：K = max(1, ceil(X/100*N))，
 *     排序 (voteupCount DESC, canonical decimal answerId ASC)，strict count 取前 K。
 *   - 输出 work/selection.json：{ schemaVersion, requestedPercent, selectionRule,
 *     originalTotal, selectedSourceIds, selectorHash }。
 *   - selectionRule 机器表示: top-<X>-pct-voteup-desc-answerid-dec-asc-strict。
 *   - 输入非法（X 越界 / answerId 非纯数字 / 无候选）→ invalid_input，fail closed。
 *   - 幂等：同输入同 X 重跑产生逐字节相同的 selection.json（selectorHash 恒定）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildSelection,
  parsePercent,
  validateSelection,
} from '../lib/top-percent-selector.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function parseArgs() {
  const positional = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      if (['--work', '--percent'].includes(a)) i += 1; // 跳过值
      continue;
    }
    positional.push(a);
  }
  return {
    inputs: positional,
    workDir: arg('--work', 'work'),
    percent: arg('--percent', null),
  };
}

function collectJsonFiles(inputs) {
  const files = new Set();
  for (const raw of inputs) {
    const p = path.resolve(raw);
    if (!fs.existsSync(p)) {
      console.error(`(跳过不存在: ${raw})`);
      continue;
    }
    const st = fs.statSync(p);
    if (st.isFile()) {
      files.add(p);
    } else if (st.isDirectory()) {
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.name === 'answers.json') files.add(full);
        }
      };
      walk(p);
    }
  }
  return [...files].sort();
}

function parseAnswers(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.answers)) return json.answers;
  return [];
}

function readAnswers(file) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`文件损坏: ${file} — ${error.message}`);
  }
  const answers = parseAnswers(json);
  const qid = String(json.questionId ?? path.basename(path.dirname(file)));
  return { qid, answers };
}

function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel || '.';
}

function main() {
  const opts = parseArgs();
  if (opts.inputs.length === 0) {
    console.error('用法: node scripts/select.mjs <answers.json 或目录> [更多...] --work work/ --percent X');
    process.exit(2);
  }
  const x = parsePercent(opts.percent); // 非法 → invalid_input throw

  const files = collectJsonFiles(opts.inputs);
  if (files.length === 0) {
    console.error('未找到任何 answers.json');
    process.exit(1);
  }

  // 构造 canonical candidates（sourceId 与 chunk.mjs 完全一致）
  const candidates = [];
  for (const file of files) {
    const { qid, answers } = readAnswers(file);
    for (const a of answers) {
      candidates.push({
        sourceId: `question-${qid}-answer-${String(a.id ?? 'unknown')}`,
        answerId: String(a.id ?? 'unknown'),
        voteupCount: a.voteupCount ?? 0,
      });
    }
  }

  // 确定性选择 + selection.json（selectorHash 恒定）
  const selection = buildSelection(candidates, x);
  validateSelection(selection); // 回读自检（fail closed）

  const workDir = path.resolve(opts.workDir);
  fs.mkdirSync(workDir, { recursive: true });
  const selectionFile = path.join(workDir, 'selection.json');
  const tmp = `${selectionFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(selection, null, 2), 'utf8');
  fs.renameSync(tmp, selectionFile);

  console.log(`selection.json: ${displayPath(selectionFile)}`);
  console.log(`originalTotal: ${selection.originalTotal} → selected: ${selection.selectedSourceIds.length}（X=${x}%, K=${selection.selectedSourceIds.length}, rule=${selection.selectionRule}）`);
  console.log(`selectorHash: ${selection.selectorHash}`);
}

main();
