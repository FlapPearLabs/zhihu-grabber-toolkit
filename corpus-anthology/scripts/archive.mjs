#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * archive — 机械归档：把多份 answers.md 合并为大合集（分卷可选）。
 *
 * archive 是归档，不是摘要，也不是编辑：
 *   - 正文零改写（仅剥离每篇开头的首个 H1，改为合集内标题）；
 *   - 流式处理（StringDecoder 保证多字节 UTF-8 不被切坏）；
 *   - 来源使用相对路径，不泄漏绝对路径；
 *   - 按体积（--max-volume-chars，字符数）或篇数（--volume）分卷，二者互斥；
 *   - 生成 sidecar manifest（bodySha256/bodyChars），供 --verify 做真实正文校验。
 *
 * 用法:
 *   node archive.mjs <srcDir> [--out collection.md] [--title "合集标题"]
 *     [--volume N] [--max-volume-chars M] [--name 前缀] [--manifest <file>]
 *   node archive.mjs <srcDir> --verify <collection.md> [--manifest <file>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

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
function stripLeadingH1(text) {
  return text.replace(/^\uFEFF?#[ \t]+[^\r\n]*(?:\r?\n)?/, '');
}

/** 来源路径转为相对 srcDir，分隔符统一为 /，避免泄漏本机绝对路径 */
function relSource(srcDir, file) {
  return path.relative(srcDir, file).split(path.sep).join('/');
}

/** stdout 展示路径：相对当前工作目录，避免泄漏本机绝对路径 */
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
 * 流式计算单篇 body（剥离 H1 后 trim）的 sha256 与字符数。
 * 用 StringDecoder 保证多字节 UTF-8 跨块不损坏。
 */
function streamBodyInfo(file) {
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    let offset = 0;
    let headerSkipped = false;
    let pending = '';
    let hash = crypto.createHash('sha256');
    let chars = 0;
    let done = false;
    const decoder = new StringDecoder('utf8');

    const pump = () => {
      if (done) return;
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      if (n === 0) {
        done = true;
        fs.closeSync(fd);
        let tail = decoder.end();
        if (!headerSkipped) {
          pending += tail;
          tail = '';
          // 首行即文件末尾：处理首个 H1
          const firstLine = pending.replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
          const body = /^#[ \t]+[^\r\n]*$/.test(firstLine.trim())
            ? pending.slice(firstLine.length + (pending.includes('\n') ? 1 : 0))
            : pending;
          const trimmed = body.trim();
          hash.update(trimmed, 'utf8');
          chars += trimmed.length;
        } else if (tail) {
          const trimmed = tail.trim();
          if (trimmed) {
            hash.update(trimmed, 'utf8');
            chars += trimmed.length;
          }
        }
        resolve({ sha256: hash.digest('hex'), chars });
        return;
      }
      const text = decoder.write(buf.subarray(0, n));
      if (!headerSkipped) {
        pending += text;
        const nl = pending.indexOf('\n');
        if (nl === -1) {
          if (pending.length > 1_000_000) {
            // 超长单行（无换行）：剥离 BOM 后整体作为 body
            headerSkipped = true;
            const body = pending.replace(/^\uFEFF/, '').trim();
            hash.update(body, 'utf8');
            chars += body.length;
            pending = '';
          }
          pump();
          return;
        }
        const firstLine = pending.slice(0, nl).replace(/^\uFEFF/, '');
        const rest = pending.slice(nl + 1);
        pending = '';
        headerSkipped = true;
        if (/^#[ \t]+[^\r\n]*$/.test(firstLine.trim())) {
          if (rest.trim()) {
            hash.update(rest.trim(), 'utf8');
            chars += rest.trim().length;
          }
        } else {
          const combined = (firstLine + '\n' + rest).trim();
          if (combined) {
            hash.update(combined, 'utf8');
            chars += combined.length;
          }
        }
        pump();
        return;
      }
      if (text.trim()) {
        hash.update(text.trim(), 'utf8');
        chars += text.trim().length;
      }
      pump();
    };
    pump();
  });
}

/** 生成阶段：单篇 body 的确定性信息（与写入内容一致） */
async function bodyInfoOf(file) {
  return streamBodyInfo(file);
}

/** 写单篇 body 到输出流（剥离 H1，逐块写入，StringDecoder 防多字节损坏） */
async function writeBody(outStream, file) {
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder('utf8');
    let offset = 0;
    let headerSkipped = false;
    let pending = '';
    let done = false;

    const pump = () => {
      if (done) return;
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      if (n === 0) {
        done = true;
        fs.closeSync(fd);
        const tail = decoder.end();
        if (!headerSkipped) {
          pending += tail;
          const firstLine = pending.replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
          const body = /^#[ \t]+[^\r\n]*$/.test(firstLine.trim())
            ? pending.slice(firstLine.length + (pending.includes('\n') ? 1 : 0))
            : pending;
          outStream.write(body.trim());
        } else if (tail) {
          outStream.write(tail);
        }
        resolve();
        return;
      }
      const text = decoder.write(buf.subarray(0, n));
      if (!headerSkipped) {
        pending += text;
        const nl = pending.indexOf('\n');
        if (nl === -1) {
          if (pending.length > 1_000_000) {
            headerSkipped = true;
            outStream.write(pending.replace(/^\uFEFF/, '').trim());
            pending = '';
          }
          pump();
          return;
        }
        const firstLine = pending.slice(0, nl).replace(/^\uFEFF/, '');
        const rest = pending.slice(nl + 1);
        pending = '';
        headerSkipped = true;
        if (/^#[ \t]+[^\r\n]*$/.test(firstLine.trim())) {
          if (rest.trim()) outStream.write(rest.trim());
        } else {
          const combined = (firstLine + '\n' + rest).trim();
          if (combined) outStream.write(combined);
        }
        pump();
        return;
      }
      outStream.write(text);
      pump();
    };
    pump();
  });
}

/** 从输出中按来源顺序提取各 section 的 body 文本 */
function extractSections(outText, expectedSources) {
  const sections = new Map();
  for (const src of expectedSources) {
    const begin = outText.indexOf(`> 来源: ${src}`);
    if (begin === -1) continue;
    const bodyStart = outText.indexOf('\n', begin);
    if (bodyStart === -1) continue;
    // 正文从来源行之后到下一个 "# " 标题或文件尾
    const after = outText.slice(bodyStart + 1);
    const nextTitle = after.search(/\n# /);
    const body = nextTitle === -1 ? after : after.slice(0, nextTitle);
    // 去掉结尾的 "---" 分隔线
    const bodyClean = body.replace(/\n---\s*$/, '').trim();
    sections.set(src, bodyClean);
  }
  return sections;
}

async function verifyArchive(srcDir, collectionFile, manifestFileArg) {
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
  const outSources = [...outText.matchAll(/^> 来源: (.+)$/gm)].map((m) => m[1]);
  const expected = files.map((f) => relSource(srcDir, f));

  // 1. 篇数一致
  if (outSources.length !== expected.length) {
    report.valid = false;
    report.warnings.push(`篇数不一致: 输入 ${expected.length} 篇, 输出 ${outSources.length} 篇`);
  }
  const missing = expected.filter((s) => !outSources.includes(s));
  const extra = outSources.filter((s) => !expected.includes(s));
  if (missing.length > 0) {
    report.valid = false;
    report.warnings.push(`输出缺少来源: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    report.valid = false;
    report.warnings.push(`输出含未知来源: ${extra.join(', ')}`);
  }

  // 2. 无绝对路径泄漏
  const absPaths = outText.match(/[A-Za-z]:[\\/][^\s`>]*|\/(?:Users|home|tmp|private)\/[^\s`>]*/g) || [];
  if (absPaths.length > 0) {
    report.valid = false;
    report.warnings.push(`输出包含绝对路径: ${absPaths.slice(0, 5).join(', ')}`);
  }

  // 3. 正文完整性：逐篇重算 body sha256，与输出 section 对比
  const sections = extractSections(outText, expected);
  for (const rel of expected) {
    const abs = path.resolve(srcDir, rel);
    if (!fs.existsSync(abs)) {
      report.valid = false;
      report.warnings.push(`输入文件缺失: ${rel}`);
      continue;
    }
    const { sha256 } = await bodyInfoOf(abs);
    const sectionBody = sections.get(rel);
    if (sectionBody === undefined) {
      report.valid = false;
      report.warnings.push(`输出中未找到来源 section: ${rel}`);
      continue;
    }
    const sectionSha = sha256Of(sectionBody);
    if (sectionSha !== sha256) {
      report.valid = false;
      report.warnings.push(`正文被改写或损坏: ${rel}（sha256 不一致）`);
    }
  }

  report.inputFiles = expected.length;
  report.outputSections = outSources.length;
  report.bodyHashesChecked = Math.min(expected.length, sections.size);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.valid ? 0 : 1);
}

async function main() {
  const srcDir = path.resolve(process.argv[2] || '.');
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    console.error(`源目录不存在: ${srcDir}`); process.exit(2);
  }

  // --verify 模式
  const verifyFile = arg('--verify', null);
  if (verifyFile) {
    const manifestArg = arg('--manifest', null);
    await verifyArchive(srcDir, verifyFile, manifestArg);
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

  // 第一遍扫描：记录路径、标题、字符数、body sha256（流式）
  const entries = [];
  for (const f of files) {
    const title = readTitle(f);
    const { sha256, chars } = await bodyInfoOf(f);
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
          stream.write(`# ${e.title}\n\n`);
          stream.write(`> 来源: ${relSource(srcDir, e.file)}\n\n`);
          await writeBody(stream, e.file);
          stream.write('\n');
        }
        stream.end();
      })().catch((error) => {
        stream.destroy(error);
      });
    });
  }

  const volumes = buildVolumes();
  const manifestData = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    title: TITLE,
    srcDirName: path.basename(srcDir),
    volumes: [],
    totalFiles: entries.length,
    totalChars,
  };

  const outFiles = [];
  if (volumes.length > 1 || (VOLUME > 0 || MAX_VOLUME_CHARS > 0)) {
    for (const [idx, v] of volumes.entries()) {
      const outFile = path.join(path.dirname(OUT), `${PREFIX}_${String(idx + 1).padStart(3, '0')}.md`);
      const r = await writeVolume(v, idx + 1, outFile);
      outFiles.push(outFile);
      manifestData.volumes.push({
        file: path.relative(process.cwd(), outFile).split(path.sep).join('/'),
        volume: idx + 1,
        sources: v.map((e) => relSource(srcDir, e.file)),
      });
      console.log(`卷 ${idx + 1}: ${displayPath(outFile)}（${r.count} 篇）`);
    }
    console.log(`归档完成，共 ${volumes.length} 卷 / ${entries.length} 篇（正文零改写，纯脚本拼接）`);
  } else {
    const r = await writeVolume(volumes[0], 0, OUT);
    outFiles.push(OUT);
    manifestData.volumes.push({
      file: path.relative(process.cwd(), OUT).split(path.sep).join('/'),
      volume: 1,
      sources: volumes[0].map((e) => relSource(srcDir, e.file)),
    });
    console.log(`归档已生成: ${displayPath(OUT)}`);
    console.log(`共 ${r.count} 篇, ${totalChars.toLocaleString()} 字符（正文零改写，纯脚本拼接）`);
  }

  // 写 sidecar manifest
  const manifestFile = MANIFEST || (outFiles.length === 1
    ? `${OUT}.manifest.json`
    : path.join(path.dirname(OUT), `${PREFIX}.manifest.json`));
  const manifestTmp = `${manifestFile}.${process.pid}.tmp`;
  fs.writeFileSync(manifestTmp, JSON.stringify(manifestData, null, 2), 'utf8');
  fs.renameSync(manifestTmp, manifestFile);
  console.log(`归档 manifest: ${displayPath(manifestFile)}`);
  console.log(`核验: node scripts/archive.mjs ${process.argv[2]} --verify ${displayPath(outFiles[0])} --manifest ${displayPath(manifestFile)}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
