#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * digest — summary 模式：从语料中提取"精华摘要"（按评分字段倒序，每条截断），
 * 产出小体量 Markdown，供 LLM 直接读取后归纳，避免读取全部原文。
 *
 * 用法:
 *   node digest.mjs <input> [--top N] [--max-chars M] [--key voteupCount] [--out digest.md]
 * input 可以是:
 *   - 单个 answers.json（结构: {questionTitle, answers:[...]} 或纯数组）
 *   - 目录（递归查找所有 answers.json，按目录名排序逐题处理）
 */
import fs from 'node:fs';
import path from 'node:path';
import { stripHtml } from '../lib/text.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function parsePositiveInt(raw, { min, max, name }) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 的整数，收到: ${raw}`);
  }
  return value;
}

const input = process.argv[2];
if (!input) { console.error('用法: node digest.mjs <input> [--top N] [--max-chars M] [--key 字段] [--out 文件]'); process.exit(2); }
const TOP = parsePositiveInt(arg('--top', '6'), { min: 1, max: 100, name: '--top' });
const MAX_CHARS = parsePositiveInt(arg('--max-chars', '1300'), { min: 100, max: 100000, name: '--max-chars' });
const KEY = arg('--key', 'voteupCount');
const OUT = arg('--out', 'digest.md');

function loadQuestions(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    console.error(`输入路径不存在: ${inputPath}`);
    process.exit(2);
  }
  const items = [];
  if (fs.statSync(resolved).isDirectory()) {
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === 'answers.json') items.push(full);
      }
    };
    walk(resolved);
    items.sort();
  } else {
    items.push(resolved);
  }
  return items;
}

const lines = [];
let totalAnswers = 0;
let failedFiles = 0;
for (const file of loadQuestions(input)) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failedFiles += 1;
    console.error(`(跳过损坏文件: ${file} — ${error.message})`);
    continue;
  }
  const answers = Array.isArray(json) ? json : (json.answers || []);
  const title = json.questionTitle || path.basename(path.dirname(file));
  totalAnswers += answers.length;
  lines.push(`\n${'='.repeat(68)}\n问题: ${title}  (${answers.length} 条回答)\n${'='.repeat(68)}`);
  const top = [...answers].sort((a, b) => (b[KEY] ?? 0) - (a[KEY] ?? 0)).slice(0, TOP);
  top.forEach((a, i) => {
    const text = stripHtml(a.content);
    lines.push(`\n--- Top${i + 1}  ${a.author || '(匿名)'}  [${a.voteupCount ?? 0}赞 / ${a.commentCount ?? 0}评] ---`);
    // 在段落/句子边界截断，避免从词中间切断
    let slice = text.slice(0, MAX_CHARS);
    if (text.length > MAX_CHARS) {
      const boundary = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('。'),
        slice.lastIndexOf('！'),
        slice.lastIndexOf('？'),
        slice.lastIndexOf('. '),
      );
      if (boundary > MAX_CHARS * 0.6) slice = text.slice(0, boundary + 1);
    }
    lines.push(slice);
  });
}

if (failedFiles > 0) console.error(`(共 ${failedFiles} 个文件解析失败，已跳过)`);

// 输入路径改为相对输出目录，避免泄漏本机绝对路径
let inputDisplay = input;
try {
  inputDisplay = path.relative(path.dirname(path.resolve(OUT)), path.resolve(input)) || input;
} catch { /* 保持原样 */ }

const head = [
  `# 语料精华摘要（digest）`,
  ``,
  `> 输入: ${inputDisplay}  共 ${lines.length === 0 ? 0 : totalAnswers} 条回答，摘要取每题 Top ${TOP}`,
  `> 说明: 此为摘要，如需全文请用 archive 模式（脚本拼接，不耗上下文）`,
  ``,
].join('\n');
fs.writeFileSync(OUT, head + lines.join('\n'), 'utf8');
console.log(`已生成摘要: ${OUT}（${(head + lines.join('\n')).length} 字符）`);
