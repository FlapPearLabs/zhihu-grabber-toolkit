#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * make-handoff — 确定性 handoff producer。
 *
 * 只接受 verify-output（src/verifier.js）返回 valid=true 的产物，拒绝生成 verified=false 的 handoff。
 * 从已验证产物（answers.json / answers.md）构建 handoff.json，写入 question 输出目录内。
 *
 * 用法:
 *   node scripts/make-handoff.mjs <out/question-id> --task digest
 *   --task: inspect | digest | archive（默认 digest）
 *
 * 输出: out/<question-id>/handoff.json
 * 说明: handoff 内路径为相对 handoff 文件所在目录（= question 输出目录）的相对路径，
 *       与 corpus-anthology 的 --source-root containment 语义一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { verifyOutput } from '../src/verifier.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TASKS = new Set(['inspect', 'digest', 'archive']);
const questionDirArg = process.argv[2];
const task = arg('--task', 'digest');

if (!questionDirArg) {
  console.error('用法: node scripts/make-handoff.mjs <out/question-id> --task digest|archive|inspect');
  process.exit(2);
}
if (!TASKS.has(task)) {
  console.error(`非法 --task: ${task}（仅允许 inspect / digest / archive）`);
  process.exit(2);
}

const dir = path.resolve(questionDirArg);

// 1. 唯一事实门：必须通过 verify-output
const verification = verifyOutput(dir);
if (!verification.valid) {
  console.error('拒绝生成 handoff：产物未通过 verify-output（valid !== true）');
  for (const w of verification.warnings) console.error(`  - ${w}`);
  process.exit(1);
}

// 2. 从已验证产物读取事实字段（不信任用户输入）
const answersFile = path.join(dir, 'answers.json');
const mdFile = path.join(dir, 'answers.md');
let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
} catch (error) {
  console.error(`answers.json 无法解析: ${error.message}`);
  process.exit(1);
}
const answers = Array.isArray(parsed) ? parsed : parsed.answers;
const questionId = verification.questionId; // 来自 verifier（= 目录名 = answers.json.questionId）
const answerCount = Array.isArray(answers) ? answers.length : 0;

// 3. 构建 handoff（相对路径，相对 handoff 所在目录）
//    warnings 原样保留（含 countMismatch 等非失败提示，供下游知情；不设失败门）
const handoff = {
  task,
  sourceType: 'zhihu-answers',
  questionId,
  inputJson: path.basename(answersFile),
  inputMarkdown: path.basename(mdFile),
  verified: true,
  answerCount,
  warnings: verification.warnings,
};

// 4. 写入 question 输出目录
const outFile = path.join(dir, 'handoff.json');
fs.writeFileSync(outFile, JSON.stringify(handoff, null, 2) + '\n', 'utf8');
console.log(`handoff 已生成: ${path.relative(process.cwd(), outFile)}`);
console.log(`  task=${task} questionId=${questionId} answers=${answerCount} verified=true`);
