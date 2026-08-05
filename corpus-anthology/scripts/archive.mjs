#!/usr/bin/env node
/**
 * archive — full-archive 模式：把多篇 Markdown（如每题 answers.md）合并成"大合集"。
 * 纯脚本拼接 + 目录索引，正文不做任何改写 → 不会占用 LLM 上下文。
 *
 * 用法:
 *   node archive.mjs <srcDir> [--out collection.md] [--title "合集标题"] [--volume N]
 *   --volume N : 每 N 篇分一卷，输出 collection_001.md / collection_002.md ...
 *   --name 文件名前缀（配合 --volume 用，默认 collection）
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const srcDir = path.resolve(process.argv[2] || '.');
const OUT = arg('--out', path.join(process.cwd(), 'collection.md'));
const TITLE = arg('--title', path.basename(srcDir));
const VOLUME = Number(arg('--volume', '0'));
const PREFIX = arg('--name', 'collection');
if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
  console.error(`源目录不存在: ${srcDir}`); process.exit(2);
}

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
  const text = fs.readFileSync(f, 'utf8');
  const titleLine = text.split(/\r?\n/).find((l) => l.startsWith('# ')) || path.basename(path.dirname(f));
  const title = titleLine.replace(/^#\s+/, '').trim();
  return { file: f, title, chars: text.length, lines: text.split(/\r?\n/).length, text };
});
const totalChars = entries.reduce((s, e) => s + e.chars, 0);

function buildVolume(items, volNo) {
  const outFile = VOLUME > 0
    ? path.join(path.dirname(OUT), `${PREFIX}_${String(volNo).padStart(3, '0')}.md`)
    : OUT;
  const L = [];
  L.push(`# ${TITLE}${VOLUME > 0 ? `（第 ${volNo} 卷 / 共 ${Math.ceil(files.length / VOLUME)} 卷）` : ''}`);
  L.push('');
  L.push(`> 全量合集 · 本卷 ${items.length} 篇 · 总 ${totalChars} 字符 · 生成时间 ${new Date().toISOString()}`);
  L.push('');
  L.push('## 目录');
  items.forEach((e, i) => L.push(`${i + 1}. ${e.title}（${e.chars.toLocaleString()} 字符）`));
  L.push('');
  items.forEach((e, i) => {
    L.push('---');
    L.push('');
    L.push(`# ${i + 1}. ${e.title}`);
    L.push('');
    L.push(`> 来源: ${e.file}`);
    L.push('');
    L.push(e.text.replace(/^#\s+.*$/m, '').trim());
    L.push('');
  });
  fs.writeFileSync(outFile, L.join('\n'), 'utf8');
  return { outFile, count: items.length };
}

if (VOLUME > 0) {
  let vols = [];
  for (let i = 0; i < entries.length; i += VOLUME) vols.push(entries.slice(i, i + VOLUME));
  vols.forEach((v, idx) => {
    const r = buildVolume(v, idx + 1);
    console.log(`卷 ${idx + 1}: ${r.outFile}（${r.count} 篇）`);
  });
} else {
  const r = buildVolume(entries, 1);
  console.log(`大合集已生成: ${r.outFile}`);
  console.log(`共 ${r.count} 篇, ${totalChars.toLocaleString()} 字符（正文未改写，纯脚本拼接）`);
}
