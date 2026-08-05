#!/usr/bin/env node
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

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.includes(name); }

const input = process.argv[2];
const TOP = Number(arg('--top', '6'));
const MAX_CHARS = Number(arg('--max-chars', '1300'));
const KEY = arg('--key', 'voteupCount');
const OUT = arg('--out', 'digest.md');
if (!input) { console.error('用法: node digest.mjs <input> [--top N] [--max-chars M] [--key 字段] [--out 文件]'); process.exit(2); }

function stripHtml(html) {
  if (html == null) return '';
  let text = String(html)
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  for (const [e, c] of [['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&nbsp;', ' ']]) text = text.split(e).join(c);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function loadQuestions(inputPath) {
  const resolved = path.resolve(inputPath);
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
for (const file of loadQuestions(input)) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const answers = Array.isArray(json) ? json : (json.answers || []);
  const title = json.questionTitle || path.basename(path.dirname(file));
  totalAnswers += answers.length;
  lines.push(`\n${'='.repeat(68)}\n问题: ${title}  (${answers.length} 条回答)\n${'='.repeat(68)}`);
  const top = [...answers].sort((a, b) => (b[KEY] ?? 0) - (a[KEY] ?? 0)).slice(0, TOP);
  top.forEach((a, i) => {
    const text = stripHtml(a.content);
    lines.push(`\n--- Top${i + 1}  ${a.author || '(匿名)'}  [${a.voteupCount ?? 0}赞 / ${a.commentCount ?? 0}评] ---`);
    lines.push(text.slice(0, MAX_CHARS));
  });
}

const head = [
  `# 语料精华摘要（digest）`,
  ``,
  `> 输入: ${path.resolve(input)}  共 ${lines.length === 0 ? 0 : totalAnswers} 条回答，摘要取每题 Top ${TOP}`,
  `> 说明: 此为摘要，如需全文请用 archive 模式（脚本拼接，不耗上下文）`,
  ``,
].join('\n');
fs.writeFileSync(OUT, head + lines.join('\n'), 'utf8');
console.log(`已生成摘要: ${OUT}（${(head + lines.join('\n')).length} 字符）`);
