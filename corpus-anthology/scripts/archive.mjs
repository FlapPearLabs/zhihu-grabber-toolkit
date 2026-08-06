#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * archive — full-archive 模式：把多篇 Markdown（如每题 answers.md）合并成"大合集"。
 * 纯脚本拼接 + 目录索引，正文不做任何改写 → 不会占用 LLM 上下文。
 *
 * 用法:
 *   node archive.mjs <srcDir> [--out collection.md] [--title "合集标题"]
 *   [--volume N] [--max-volume-chars M] [--name 文件前缀]
 *
 *   --volume N            : 每 N 篇分一卷（篇数上限）
 *   --max-volume-chars M  : 每卷字符数上限（按累计体积切卷；与 --volume 二选一）
 *   --name 文件名前缀      : 分卷时输出 collection_001.md / collection_002.md ...
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function parseNonNegativeInt(raw, { name, fallback }) {
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数，收到: ${raw}`);
  }
  return value;
}

const srcDir = path.resolve(process.argv[2] || '.');
const OUT = arg('--out', path.join(process.cwd(), 'collection.md'));
const TITLE = arg('--title', path.basename(srcDir));
const VOLUME = parseNonNegativeInt(arg('--volume', null), { name: '--volume', fallback: 0 });
const MAX_VOLUME_CHARS = parseNonNegativeInt(arg('--max-volume-chars', null), { name: '--max-volume-chars', fallback: 0 });
const PREFIX = arg('--name', 'collection');
if (VOLUME > 0 && MAX_VOLUME_CHARS > 0) {
  throw new Error('--volume 与 --max-volume-chars 不能同时使用，请二选一');
}
if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
  console.error(`源目录不存在: ${srcDir}`); process.exit(2);
}

// 第一遍扫描：只记录路径、标题、字符数，不把正文驻留内存
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name === 'answers.md') files.push(full);
  }
};
walk(srcDir);
files.sort();
if (files.length === 0) {
  console.error(`在 ${srcDir} 下未找到任何 answers.md`); process.exit(1);
}

const entries = files.map((f) => {
  const firstLine = fs.readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith('# ')) || path.basename(path.dirname(f));
  const title = firstLine.replace(/^#\s+/, '').trim();
  const chars = fs.statSync(f).size;
  return { file: f, title, chars };
});
const totalChars = entries.reduce((s, e) => s + e.chars, 0);

/** 只删除文档开头的首个 H1（含 BOM），不动正文中的标题 */
function stripLeadingH1(text) {
  return text.replace(/^\uFEFF?#[ \t]+[^\r\n]*(?:\r?\n)?/, '');
}

/** 来源路径转为相对 srcDir，分隔符统一为 /，避免泄漏本机绝对路径 */
function relSource(file) {
  return path.relative(srcDir, file).split(path.sep).join('/');
}

function writeVolume(items, volNo, outFile) {
  const L = [];
  L.push(`# ${TITLE}${volNo > 0 ? `（第 ${volNo} 卷）` : ''}`);
  L.push('');
  L.push(`> 全量合集 · 本卷 ${items.length} 篇 · 总 ${totalChars} 字符 · 生成时间 ${new Date().toISOString()}`);
  L.push('');
  L.push('## 目录');
  items.forEach((e, i) => L.push(`${i + 1}. ${e.title}（${e.chars.toLocaleString()} 字符）`));
  L.push('');
  // 第二遍：逐篇读入并立即写入，正文不常驻内存
  const stream = fs.createWriteStream(outFile, 'utf8');
  let first = true;
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', () => resolve({ outFile, count: items.length }));
    for (const chunk of L) stream.write(chunk + '\n');
    for (const e of items) {
      let text;
      try {
        text = fs.readFileSync(e.file, 'utf8');
      } catch (error) {
        stream.destroy(error);
        return;
      }
      const body = stripLeadingH1(text).trim();
      if (first) { first = false; } else { stream.write('\n---\n\n'); }
      stream.write(`# ${e.title}\n\n`);
      stream.write(`> 来源: ${relSource(e.file)}\n\n`);
      stream.write(body + '\n');
    }
    stream.end();
  });
}

async function main() {
  if (VOLUME > 0 || MAX_VOLUME_CHARS > 0) {
    // 分卷：按篇数（--volume）或按累计字符（--max-volume-chars）
    const vols = [];
    let current = [];
    let currentChars = 0;
    for (const e of entries) {
      if (MAX_VOLUME_CHARS > 0 && current.length > 0 && currentChars + e.chars > MAX_VOLUME_CHARS) {
        vols.push(current);
        current = [];
        currentChars = 0;
      } else if (VOLUME > 0 && current.length >= VOLUME) {
        vols.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(e);
      currentChars += e.chars;
    }
    if (current.length > 0) vols.push(current);
    for (const [idx, v] of vols.entries()) {
      const outFile = path.join(path.dirname(OUT), `${PREFIX}_${String(idx + 1).padStart(3, '0')}.md`);
      const r = await writeVolume(v, idx + 1, outFile);
      console.log(`卷 ${idx + 1}: ${r.outFile}（${r.count} 篇）`);
    }
  } else {
    const r = await writeVolume(entries, 0, OUT);
    console.log(`大合集已生成: ${r.outFile}`);
    console.log(`共 ${r.count} 篇, ${totalChars.toLocaleString()} 字符（正文未改写，纯脚本拼接）`);
  }
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
