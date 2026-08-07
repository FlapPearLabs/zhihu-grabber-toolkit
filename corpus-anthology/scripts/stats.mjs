#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * stats — inspect 模式：评估语料规模，决定输出模式与分块策略。
 *
 * 用法: node stats.mjs <file|dir> [更多...]
 * 输出: 每个文件的行数 / 字符数 / 字节数 / 估算 token，以及总量。
 *
 * 实现：流式读取（逐块统计），超大文件不会一次性全部载入内存。
 */
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

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

/** 流式统计文件：字符数 / 行数 / 字节数（不整篇载入内存） */
function statFile(file) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    const decoder = new StringDecoder('utf8');
    let chars = 0;
    let bytes = 0;
    let lines = 1;
    let leftover = '';
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      const text = decoder.write(chunk);
      chars += text.length;
      lines += (text.match(/\n/g) || []).length;
      // 处理跨块被切开的 UTF-8 字符：StringDecoder 已处理多字节，剩余残留字符计入下一块
      leftover = text;
    });
    stream.on('end', () => {
      const tail = decoder.end();
      if (tail) {
        chars += tail.length;
        lines += (tail.match(/\n/g) || []).length;
      }
      resolve({ chars, bytes, lines });
    });
    stream.on('error', reject);
  });
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

console.log('文件规模统计（用于决定: inspect/digest/archive 模式与分块）');
console.log('-'.repeat(96));
console.log(''.padEnd(4) + '字符数'.padStart(10) + '字节数'.padStart(10) + '行数'.padStart(8) + '估算token'.padStart(16) + '  路径');
console.log('-'.repeat(96));

const results = await Promise.all(files.map(async (f) => ({ f, s: await statFile(f) })));

for (const { f, s } of results) {
  totalChars += s.chars;
  totalLines += s.lines;
  totalBytes += s.bytes;
  console.log(String(s.chars).padStart(4) + String(s.chars).padStart(10) + String(s.bytes).padStart(10) + String(s.lines).padStart(8) + tokenRange(s.chars).padStart(16) + `  ${f}`);
}
console.log('-'.repeat(96));
console.log(`合计: ${files.length} 个文件, ${totalChars} 字符, ${totalBytes} 字节, ${totalLines} 行, 约 ${tokenRange(totalChars)} token`);
console.log('\n分块参考: 单块 ≤ 24KB 字符（启发式）或 ≤ 40 条回答。');
console.log('上下文保护规则: 总规模 > 40KB 时禁止一次性读取全部内容; 必须用 digest 管线或 archive 脚本处理。');
