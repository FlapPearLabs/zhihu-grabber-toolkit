#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * archive — 机械归档：把多份 answers.md 合并为大合集（分卷可选）。
 *
 * archive 是归档，不是摘要，也不是编辑：
 *   - 正文零改写（仅剥离每篇开头的首个 H1，改为合集内标题）；
 *   - 流式处理（StringDecoder 保证多字节 UTF-8 不被切坏）；
 *   - 来源使用相对路径，不泄漏绝对路径；
 *   - 按体积（--max-volume-chars，按正文字符数）或篇数（--volume）分卷，二者互斥；
 *   - 生成 sidecar manifest（每篇 bodySha256/bodyChars + 分卷结构），
 *     --verify 读取 manifest 逐卷做真实正文 SHA-256 校验。
 *
 * 机器 framing：
 *   每篇正文写入时前后加不可歧义的分隔标记
 *   （BEGIN_SOURCE / END_SOURCE + bodyByteLength），
 *   verifier 按标记与长度切分，不依赖正文的 Markdown 语法。
 *
 * 用法:
 *   node archive.mjs <srcDir> [--out collection.md] [--title "合集标题"]
 *     [--volume N] [--max-volume-chars M] [--name 前缀] [--manifest <file>]
 *   node archive.mjs <srcDir> --verify --manifest <manifest.json>   # 逐卷核验（推荐）
 *   node archive.mjs <srcDir> --verify <collection.md>              # 单卷兼容核验
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const BEGIN_MARKER = '<!-- ARCHIVE_SOURCE_BEGIN -->';
const END_MARKER = '<!-- ARCHIVE_SOURCE_END -->';

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

function sha256Of(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 只删除文档开头的首个 H1（含 BOM），不动正文中的标题 */
export function stripLeadingH1(text) {
  return text.replace(/^\uFEFF?#[ \t]+[^\r\n]*(?:\r?\n)?/, '');
}

/** 来源路径转为相对 srcDir，分隔符统一为 /，避免泄漏本机绝对路径 */
function relSource(srcDir, file) {
  return path.relative(srcDir, file).split(path.sep).join('/');
}

/** stdout/stderr 展示路径：相对当前工作目录，避免泄漏本机绝对路径 */
function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel || '.';
}

/** 收集 srcDir 下所有 answers.md（按路径排序） */
function collectFiles(srcDir) {
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
  return files;
}

/** 读取文件首行标题（只读文件头，避免大文件全载内存） */
function readTitle(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n).toString('utf8');
    const firstLine = head.split(/\r?\n/)[0] || '';
    const m = firstLine.match(/^#\s+(.+)$/);
    if (m) return m[1].trim();
    return path.basename(path.dirname(file));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 唯一 canonical body 生成器。
 *
 * canonical body 定义：`stripLeadingH1(raw).trim()`（整体 trim，无歧义）。
 * 一次性计算后按块 yield；写作者与哈希者消费同一字符串 → 不可能漂移。
 * 单篇读入内存（archive 逐篇处理，不把全部语料同时驻留内存），
 * 输出流按块写入，避免 createWriteStream 大块缓冲。
 */
export function* canonicalBodyChunks(file, chunkSize = 64 * 1024) {
  const raw = fs.readFileSync(file, 'utf8');
  const body = stripLeadingH1(raw).trim();
  if (body.length === 0) return;
  for (let offset = 0; offset < body.length; offset += chunkSize) {
    yield body.slice(offset, offset + chunkSize);
  }
}

/** 计算单篇 canonical body 的 sha256 与字符数 */
export function bodyInfoOf(file) {
  const hash = crypto.createHash('sha256');
  let chars = 0;
  for (const chunk of canonicalBodyChunks(file)) {
    hash.update(chunk, 'utf8');
    chars += chunk.length;
  }
  return { sha256: hash.digest('hex'), chars };
}

/**
 * 把 canonical body 逐块写入 outStream，同时累加字节计数。
 * 返回 { sha256, chars }——**对实际写出的字符流**计算，与 bodyInfoOf 必然一致。
 */
async function writeCanonicalBody(outStream, file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let chars = 0;
    let pendingError = null;
    try {
      for (const chunk of canonicalBodyChunks(file)) {
        if (pendingError) break;
        outStream.write(chunk, 'utf8', () => {});
        hash.update(chunk, 'utf8');
        chars += chunk.length;
      }
      outStream.on('error', (e) => { pendingError = e; });
      resolve({ sha256: hash.digest('hex'), chars });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 从输出文本中按「字符数长度 framing」精确提取各来源的 body。
 *
 * 每篇 section 结构：
 *   <!-- ARCHIVE_SOURCE_BEGIN <rel> -->
 *   <!-- ARCHIVE_BODY_CHARS: N -->
 *   <恰好 N 个字符的 canonical body>
 *   <!-- ARCHIVE_SOURCE_END -->
 *
 * 切分依据是 N（长度），而不是查找 END 标记或正则识别 Markdown 语法，
 * 因此正文即使包含 BEGIN/END marker 文本或 H1/'> 来源:' 行也不会产生歧义。
 */
function extractFramedSections(outText) {
  const sections = new Map();
  const LEN_RE = /^<!-- ARCHIVE_BODY_CHARS: (\d+) -->\n/;
  let pos = 0;
  while (true) {
    const beginAt = outText.indexOf(BEGIN_MARKER, pos);
    if (beginAt === -1) break;
    const nl = outText.indexOf('\n', beginAt);
    if (nl === -1) {
      throw new Error(`framing 损坏: 缺少 source 行与长度头（第 ${beginAt} 字节）`);
    }
    const header = outText.slice(beginAt + BEGIN_MARKER.length, nl).trim();
    const rest = outText.slice(nl + 1);
    const m = rest.match(LEN_RE);
    if (!m) {
      throw new Error(`framing 损坏: section ${header} 缺少 ARCHIVE_BODY_CHARS 长度头`);
    }
    const n = Number(m[1]);
    const bodyStart = nl + 1 + m[0].length;
    sections.set(header, outText.slice(bodyStart, bodyStart + n));
    pos = bodyStart + n;
  }
  return sections;
}

/** 单卷核验（兼容旧用法：不传 manifest 时直接对单个 collection 校验全部输入） */
async function verifySingle(srcDir, collectionFile) {
  const report = { valid: true, warnings: [] };
  const files = collectFiles(srcDir);
  const outPath = path.resolve(collectionFile);
  if (!fs.existsSync(outPath)) {
    report.valid = false;
    report.warnings.push(`输出文件不存在: ${collectionFile}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  const outText = fs.readFileSync(outPath, 'utf8');
  const expected = files.map((f) => relSource(srcDir, f));
  const sections = extractFramedSections(outText);
  const foundKeys = [...sections.keys()];

  // 篇数一致
  const missing = expected.filter((s) => !foundKeys.includes(s));
  const extra = foundKeys.filter((s) => !expected.includes(s));
  if (missing.length > 0) {
    report.valid = false;
    report.warnings.push(`输出缺少来源: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    report.valid = false;
    report.warnings.push(`输出含未知来源: ${extra.join(', ')}`);
  }
  // 无绝对路径泄漏
  const absPaths = outText.match(/[A-Za-z]:[\\/][^\s`>]*|\/(?:Users|home|tmp|private)\/[^\s`>]*/g) || [];
  if (absPaths.length > 0) {
    report.valid = false;
    report.warnings.push(`输出包含绝对路径: ${absPaths.slice(0, 5).join(', ')}`);
  }
  // 正文 sha256 逐一比对
  for (const rel of expected) {
    const abs = path.resolve(srcDir, rel);
    if (!fs.existsSync(abs)) {
      report.valid = false;
      report.warnings.push(`输入文件缺失: ${rel}`);
      continue;
    }
    const { sha256 } = bodyInfoOf(abs);
    const sectionBody = sections.get(rel);
    if (sectionBody === undefined) {
      report.valid = false;
      report.warnings.push(`输出中未找到来源 section: ${rel}`);
      continue;
    }
    if (sha256Of(sectionBody) !== sha256) {
      report.valid = false;
      report.warnings.push(`正文被改写或损坏: ${rel}（sha256 不一致）`);
    }
  }
  report.inputFiles = expected.length;
  report.outputSections = foundKeys.length;
  report.bodyHashesChecked = Math.min(expected.length, foundKeys.length);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.valid ? 0 : 1);
}

/** 逐卷核验（推荐）：读取 manifest，对每卷文件仅验证该卷 sources，全部通过才 valid */
async function verifyVolumes(srcDir, manifestFile) {
  const report = { valid: true, warnings: [], volumes: [] };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFile), 'utf8'));
  } catch (error) {
    report.valid = false;
    report.warnings.push(`manifest 无法解析: ${manifestFile} — ${error.message}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  if (!Array.isArray(manifest.volumes) || manifest.volumes.length === 0) {
    report.valid = false;
    report.warnings.push('manifest 缺少 volumes 数组');
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  const manifestBase = path.dirname(path.resolve(manifestFile));

  for (const volume of manifest.volumes) {
    const volReport = { valid: true, volume: volume.volume, file: volume.file, warnings: [] };
    const volPath = path.resolve(manifestBase, volume.file);
    if (!fs.existsSync(volPath)) {
      volReport.valid = false;
      volReport.warnings.push(`卷文件不存在: ${volume.file}`);
    } else {
      const outText = fs.readFileSync(volPath, 'utf8');
      const sections = extractFramedSections(outText);
      const expected = volume.sources || [];
      const missing = expected.filter((s) => !sections.has(s));
      if (missing.length > 0) {
        volReport.valid = false;
        volReport.warnings.push(`卷缺少来源: ${missing.join(', ')}`);
      }
      const absPaths = outText.match(/[A-Za-z]:[\\/][^\s`>]*|\/(?:Users|home|tmp|private)\/[^\s`>]*/g) || [];
      if (absPaths.length > 0) {
        volReport.valid = false;
        volReport.warnings.push(`卷包含绝对路径: ${absPaths.slice(0, 5).join(', ')}`);
      }
      // 卷内每篇正文 sha256 与 manifest 记录的 snapshot 比对
      for (const entry of volume.entries || []) {
        const sectionBody = sections.get(entry.source);
        if (sectionBody === undefined) {
          volReport.valid = false;
          volReport.warnings.push(`卷缺少正文 section: ${entry.source}`);
          continue;
        }
        if (sha256Of(sectionBody) !== entry.bodySha256) {
          volReport.valid = false;
          volReport.warnings.push(`正文被改写或损坏: ${entry.source}（sha256 不一致）`);
        }
      }
    }
    report.volumes.push(volReport);
    if (!volReport.valid) {
      report.valid = false;
      report.warnings.push(`卷 ${volReport.volume} 验证失败: ${volReport.warnings.join('; ')}`);
    }
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.valid ? 0 : 1);
}

async function main() {
  const srcDir = path.resolve(process.argv[2] || '.');
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    console.error(`源目录不存在: ${srcDir}`); process.exit(2);
  }

  // --verify 模式
  if (hasFlag('--verify')) {
    const manifestArg = arg('--manifest', null);
    const verifyTarget = arg('--verify', null);
    if (manifestArg) {
      await verifyVolumes(srcDir, manifestArg);
    } else if (verifyTarget) {
      await verifySingle(srcDir, verifyTarget);
    } else {
      console.error('用法: node archive.mjs <srcDir> --verify --manifest <manifest.json> | <collection.md>');
      process.exit(2);
    }
    return;
  }

  const OUT = arg('--out', path.join(process.cwd(), 'collection.md'));
  const TITLE = arg('--title', path.basename(srcDir));
  const VOLUME = parseNonNegativeInt(arg('--volume', null), { name: '--volume', fallback: 0 });
  const MAX_VOLUME_CHARS = parseNonNegativeInt(arg('--max-volume-chars', null), { name: '--max-volume-chars', fallback: 0 });
  const PREFIX = arg('--name', 'collection');
  const MANIFEST = arg('--manifest', null);
  if (VOLUME > 0 && MAX_VOLUME_CHARS > 0) {
    throw new Error('--volume 与 --max-volume-chars 不能同时使用，请二选一');
  }

  const files = collectFiles(srcDir);
  if (files.length === 0) {
    console.error(`在 ${srcDir} 下未找到任何 answers.md`); process.exit(1);
  }

  // 第一遍扫描：记录路径、标题、字符数、body sha256（canonical）
  const entries = [];
  for (const f of files) {
    const title = readTitle(f);
    const { sha256, chars } = bodyInfoOf(f);
    entries.push({ file: f, title, chars, sha256 });
  }
  const totalChars = entries.reduce((s, e) => s + e.chars, 0);

  /** 分卷清单（每卷 entries） */
  const buildVolumes = () => {
    if (VOLUME === 0 && MAX_VOLUME_CHARS === 0) return [entries];
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
    return vols;
  };

  function writeVolume(items, volNo, outFile) {
    const L = [];
    L.push(`# ${TITLE}${volNo > 0 ? `（第 ${volNo} 卷）` : ''}`);
    L.push('');
    L.push(`> 全量归档 · 本卷 ${items.length} 篇 · 总 ${totalChars} 字符 · 生成时间 ${new Date().toISOString()}`);
    L.push('');
    L.push('## 目录');
    items.forEach((e, i) => L.push(`${i + 1}. ${e.title}（${e.chars.toLocaleString()} 字符）`));
    L.push('');
    const stream = fs.createWriteStream(outFile, 'utf8');
    return new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', () => resolve({ outFile, count: items.length }));
      (async () => {
        for (const chunk of L) stream.write(chunk + '\n');
        for (const [i, e] of items.entries()) {
          if (i > 0) stream.write('\n---\n\n');
          stream.write(`## ${e.title}\n\n`);
          stream.write(`> 来源: ${relSource(srcDir, e.file)}\n\n`);
          // 机器 framing：BEGIN/END 标记 + 字符数长度头（长度 framing 使正文含任何 marker 文本均无歧义）
          stream.write(`${BEGIN_MARKER} ${relSource(srcDir, e.file)}\n`);
          stream.write(`<!-- ARCHIVE_BODY_CHARS: ${e.chars} -->\n`);
          await writeCanonicalBody(stream, e.file);
          stream.write(`\n${END_MARKER}\n`);
        }
        stream.end();
      })().catch((error) => {
        stream.destroy(error);
      });
    });
  }

  const volumes = buildVolumes();
  // manifest 文件位置先确定：volume.file 相对 manifest 所在目录存储（与 handoff 相对路径语义一致）
  const manifestFile = MANIFEST || (volumes.length === 1 && !(VOLUME > 0 || MAX_VOLUME_CHARS > 0)
    ? `${OUT}.manifest.json`
    : path.join(path.dirname(OUT), `${PREFIX}.manifest.json`));
  const manifestBase = path.dirname(path.resolve(manifestFile));
  const manifestData = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    title: TITLE,
    srcDirName: path.basename(srcDir),
    volumes: [],
    totalFiles: entries.length,
    totalChars,
  };

  const relToManifest = (p) => path.relative(manifestBase, p).split(path.sep).join('/');

  const outFiles = [];
  if (volumes.length > 1 || (VOLUME > 0 || MAX_VOLUME_CHARS > 0)) {
    for (const [idx, v] of volumes.entries()) {
      const outFile = path.join(path.dirname(OUT), `${PREFIX}_${String(idx + 1).padStart(3, '0')}.md`);
      const r = await writeVolume(v, idx + 1, outFile);
      outFiles.push(outFile);
      manifestData.volumes.push({
        file: relToManifest(outFile),
        volume: idx + 1,
        sources: v.map((e) => relSource(srcDir, e.file)),
        entries: v.map((e) => ({
          source: relSource(srcDir, e.file),
          title: e.title,
          bodyChars: e.chars,
          bodySha256: e.sha256,
        })),
      });
      console.log(`卷 ${idx + 1}: ${displayPath(outFile)}（${r.count} 篇）`);
    }
    console.log(`归档完成，共 ${volumes.length} 卷 / ${entries.length} 篇（正文零改写，纯脚本拼接）`);
  } else {
    const r = await writeVolume(volumes[0], 0, OUT);
    outFiles.push(OUT);
    manifestData.volumes.push({
      file: relToManifest(OUT),
      volume: 1,
      sources: volumes[0].map((e) => relSource(srcDir, e.file)),
      entries: volumes[0].map((e) => ({
        source: relSource(srcDir, e.file),
        title: e.title,
        bodyChars: e.chars,
        bodySha256: e.sha256,
      })),
    });
    console.log(`归档已生成: ${displayPath(OUT)}`);
    console.log(`共 ${r.count} 篇, ${totalChars.toLocaleString()} 字符（正文零改写，纯脚本拼接）`);
  }

  // 写 sidecar manifest
  const manifestTmp = `${manifestFile}.${process.pid}.tmp`;
  fs.writeFileSync(manifestTmp, JSON.stringify(manifestData, null, 2), 'utf8');
  fs.renameSync(manifestTmp, manifestFile);
  console.log(`归档 manifest: ${displayPath(manifestFile)}`);
  console.log(`核验: node scripts/archive.mjs ${process.argv[2]} --verify --manifest ${displayPath(manifestFile)}`);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

// 仅在直接运行时执行 main（import 时供测试复用导出函数）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  });
}
