#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * stats — 评估语料规模，决定输出模式与分块策略。
 * 用法: node stats.mjs <file|dir> [更多...]
 * 输出: 每个文件的行数 / 字符数 / 估算 token，以及总量。
 */
import fs from 'node:fs';
import path from 'node:path';

const TARGET_EXTS = new Set(['.md', '.json', '.txt']);

function collectFiles(input) {
  const files = new Set();
  for (const raw of input) {
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
          else if (TARGET_EXTS.has(path.extname(e.name).toLowerCase())) files.add(full);
        }
      };
      walk(p);
    }
  }
  return [...files].sort();
}

/** 粗略 token 估算区间：中英文混合，取 2.2–1.4 字符/token 两个极端 */
function tokenRange(chars) {
  return `${Math.round(chars / 2.2)}–${Math.round(chars / 1.4)}`;
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('用法: node stats.mjs <file|dir> [更多...]');
  process.exit(2);
}

const files = collectFiles(inputs);
let totalChars = 0;
let totalLines = 0;
let totalBytes = 0;

console.log('文件规模统计（用于决定: summary/archive/edit/full 模式与分块）');
console.log('-'.repeat(96));
console.log(''.padEnd(4) + '字符数'.padStart(10) + '字节数'.padStart(10) + '行数'.padStart(8) + '估算token'.padStart(16) + '  路径');
console.log('-'.repeat(96));
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const chars = text.length;
  const bytes = Buffer.byteLength(text, 'utf8');
  const lines = text.split(/\r?\n/).length;
  totalChars += chars;
  totalLines += lines;
  totalBytes += bytes;
  console.log(String(chars).padStart(4) + String(chars).padStart(10) + String(bytes).padStart(10) + String(lines).padStart(8) + tokenRange(chars).padStart(16) + `  ${f}`);
}
console.log('-'.repeat(96));
console.log(`合计: ${files.length} 个文件, ${totalChars} 字符, ${totalBytes} 字节, ${totalLines} 行, 约 ${tokenRange(totalChars)} token`);
console.log('\n分块参考: 单块 ≤ 30KB(约2万token) 或 ≤ 800 行。');
console.log('上下文保护规则: 总规模 > 40KB 时禁止一次性读取全部内容; 必须用 map-reduce 分块或脚本处理。');
