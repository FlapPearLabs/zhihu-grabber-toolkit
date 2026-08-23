#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * chunk — digest 模式：建立 manifest 并对全部输入记录确定性分块。
 *
 * 用法:
 *   node scripts/chunk.mjs <answers.json 或目录> [更多...] --work work/ [--mode digest]
 *     [--max-chars 24000] [--max-answers 40]
 *   node scripts/chunk.mjs <answers.json 或目录> [更多...] --work work/ --mode top-percent-analysis --selection work/selection.json
 *
 * 行为:
 *   - 收集所有 answers.json（单个文件或递归目录），解析每条回答。
 *   - 生成 work/manifest.json 与 work/chunks/chunk-XXXX.json。
 *   - 幂等：重跑时比对输入 sha256 与 chunkConfig，未变化则复用现有 chunks。
 *   - 输入变化时**整个 digest cache 全失效**（chunks/map-results/coverage/reduce-input/final
 *     一并清除），不静默复用任何过期中间结果。
 *   - 每个 chunk 带 chunkHash；map 结果必须回传相同 chunkHash 才能通过 verify。
 *   - 所有路径为相对路径（相对 --work 的 sourceRoot）；stdout 路径相对 cwd。
 *
 * top-percent-analysis 模式（T8, Issue #14）:
 *   - 必须先运行 scripts/select.mjs 生成 work/selection.json。
 *   - 仅对 selection.selectedSourceIds 中的来源分块（strict count 子集，完整正文）。
 *   - manifest.mode 与 selectionHash 记录选择身份；verify/reduce 依此走 selection-scope 门。
 *   - SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST：mode 恒为 top-percent-analysis。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stripHtml } from '../lib/text.mjs';
import { validateSelection } from '../lib/top-percent-selector.mjs';

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

function parseArgs() {
  const positional = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      if (['--work', '--mode', '--max-chars', '--max-answers', '--selection'].includes(a)) i += 1; // 跳过值
      continue;
    }
    positional.push(a);
  }
  return {
    inputs: positional,
    workDir: arg('--work', 'work'),
    mode: arg('--mode', 'digest'),
    selectionFile: arg('--selection', null),
    maxChars: parsePositiveInt(arg('--max-chars', '24000'), { min: 1000, max: 1_000_000, name: '--max-chars' }),
    maxAnswers: parsePositiveInt(arg('--max-answers', '40'), { min: 1, max: 10000, name: '--max-answers' }),
  };
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 简化版实体解码（与 lib/text.mjs 对齐，供 chunk 元数据使用） */
function decodeEntities(value) {
  return value.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, token) => {
    const lower = token.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

function cleanText(html) {
  const text = stripHtml(html ?? '');
  return decodeEntities(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

/** 估算 token 区间（启发式，非精确值） */
function tokenRange(chars) {
  return { min: Math.round(chars / 2.2), max: Math.round(chars / 1.4) };
}

/** stdout 展示路径：相对当前工作目录，避免泄漏本机绝对路径 */
function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel || '.';
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

function sha256Of(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** 解析 answers.json 为回答记录列表。兼容: { answers: [...] } 或纯数组。 */
function parseAnswers(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.answers)) return json.answers;
  return [];
}

function readAnswers(file) {
  const text = fs.readFileSync(file, 'utf8');
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`文件损坏: ${file} — ${error.message}`);
  }
  const answers = parseAnswers(json);
  const qid = String(json.questionId ?? path.basename(path.dirname(file)));
  return { file, qid, answers };
}

/** 按段落/句子边界切分超长文本，避免从词中间切断 */
function splitLongText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  // 用代码点数组切分，保证 emoji 等 surrogate pair 不被拆开
  const codepoints = Array.from(text);
  if (codepoints.length <= maxChars) return [text];
  const parts = [];
  let start = 0;
  while (codepoints.length - start > maxChars) {
    const slice = codepoints.slice(start, start + maxChars).join('');
    const boundary = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('。'),
      slice.lastIndexOf('！'),
      slice.lastIndexOf('？'),
      slice.lastIndexOf('. '),
    );
    if (boundary > maxChars * 0.6) {
      parts.push(slice.slice(0, boundary + 1));
      start += boundary + 1;
    } else {
      // 无合适边界：按代码点边界切（Array.from 保证 surrogate pair 完整）
      parts.push(slice);
      start += maxChars;
    }
  }
  const rest = codepoints.slice(start).join('');
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/** 将回答记录分块 */
function buildChunks(records, { maxChars, maxAnswers }) {
  const chunks = [];
  let current = null;

  const closeChunk = () => {
    if (current && current.sources.length > 0) {
      chunks.push(current);
      current = null;
    }
  };

  const startChunk = () => {
    current = {
      chunkId: `chunk-${String(chunks.length + 1).padStart(4, '0')}`,
      sourceIds: [],
      sources: [],
      parts: [],
      chars: 0,
    };
  };

  for (const rec of records) {
    const text = cleanText(rec.content);
    const source = {
      sourceId: rec.sourceId,
      questionId: rec.questionId,
      answerId: rec.answerId,
      author: rec.author || '(匿名)',
      relativePath: rec.relativePath,
      voteupCount: rec.voteupCount ?? 0,
    };
    const segments = splitLongText(text, maxChars);
    for (const segment of segments) {
      if (!current || current.chars + segment.length > maxChars || current.sources.length >= maxAnswers) {
        closeChunk();
        startChunk();
      }
      current.sourceIds.push(source.sourceId);
      current.sources.push(source);
      current.parts.push({ sourceId: source.sourceId, text: segment });
      current.chars += segment.length;
    }
  }
  closeChunk();

  // 组装 chunk 对象：正文带 [SOURCE sourceId] 显式局部标记
  return chunks.map((c) => {
    const body = c.parts
      .map((p, i) => `${i > 0 ? '\n\n---\n\n' : ''}[SOURCE ${p.sourceId}]\n${p.text}`)
      .join('');
    const chunk = {
      chunkId: c.chunkId,
      sourceIds: [...new Set(c.sourceIds)],
      sources: c.sources,
      text: body,
      chars: c.chars,
      estimatedTokens: tokenRange(c.chars),
    };
    // chunkHash：对内容序列化计算，map 结果必须回传相同值
    chunk.chunkHash = sha256Of(JSON.stringify({
      chunkId: chunk.chunkId,
      sourceIds: chunk.sourceIds,
      sources: chunk.sources,
      text: chunk.text,
      chars: chunk.chars,
    }));
    return chunk;
  });
}

async function main() {
  const opts = parseArgs();
  if (opts.inputs.length === 0) {
    console.error('用法: node scripts/chunk.mjs <answers.json 或目录> [更多...] --work work/ [--mode digest|top-percent-analysis]');
    process.exit(2);
  }
  if (!['digest', 'top-percent-analysis'].includes(opts.mode)) {
    console.error(`不支持的 mode: ${opts.mode}（支持 digest / top-percent-analysis）`);
    process.exit(2);
  }

  // top-percent-analysis：必须携带 selection.json（由 select.mjs 生成）
  let selection = null;
  if (opts.mode === 'top-percent-analysis') {
    if (!opts.selectionFile) {
      console.error('top-percent-analysis 模式必须提供 --selection <selection.json>（先运行 scripts/select.mjs）');
      process.exit(2);
    }
    const selPath = path.resolve(opts.selectionFile);
    if (!fs.existsSync(selPath)) {
      console.error(`selection 文件不存在: ${displayPath(selPath)}（请先运行 scripts/select.mjs --percent X）`);
      process.exit(2);
    }
    try {
      selection = validateSelection(JSON.parse(fs.readFileSync(selPath, 'utf8')));
    } catch (error) {
      console.error(`selection 非法: ${error.message}`);
      process.exit(2);
    }
  }

  const files = collectJsonFiles(opts.inputs);
  if (files.length === 0) {
    console.error('未找到任何 answers.json');
    process.exit(1);
  }

  const workDir = path.resolve(opts.workDir);
  const chunksDir = path.join(workDir, 'chunks');
  fs.mkdirSync(chunksDir, { recursive: true });

  const chunkConfig = { maxChars: opts.maxChars, maxAnswers: opts.maxAnswers };

  // 读取输入并计算哈希
  const parsedInputs = [];
  for (const file of files) {
    const { file: f, qid, answers } = readAnswers(file);
    const fileText = fs.readFileSync(f, 'utf8');
    const fileHash = sha256Of(fileText);
    const rel = path.relative(workDir, f).split(path.sep).join('/');
    for (const a of answers) {
      parsedInputs.push({
        sourceId: `question-${qid}-answer-${String(a.id ?? 'unknown')}`,
        relativePath: rel,
        questionId: qid,
        answerId: String(a.id ?? 'unknown'),
        author: a.author || '',
        content: a.content ?? '',
        voteupCount: a.voteupCount ?? 0,
        fileHash,
      });
    }
  }

  // top-percent-analysis：仅对 selection 选中的来源分块（strict count 子集，完整正文）
  if (selection) {
    if (parsedInputs.length !== selection.originalTotal) {
      console.error(`原始输入数量（${parsedInputs.length}）与 selection.originalTotal（${selection.originalTotal}）不一致——输入已变化，请重新运行 scripts/select.mjs --percent ${selection.requestedPercent}`);
      process.exit(2);
    }
    const selectedSet = new Set(selection.selectedSourceIds);
    const filtered = parsedInputs.filter((i) => selectedSet.has(i.sourceId));
    if (filtered.length !== selection.selectedSourceIds.length) {
      console.error('selection.selectedSourceIds 与当前输入不匹配（部分选中来源缺失）——请重新运行 scripts/select.mjs');
      process.exit(2);
    }
    // 按 selection.selectedSourceIds 顺序重排（审计一致性：与 selection.json 完全对齐）
    const bySourceId = new Map(filtered.map((i) => [i.sourceId, i]));
    parsedInputs.length = 0;
    for (const sid of selection.selectedSourceIds) parsedInputs.push(bySourceId.get(sid));
    console.log(`top-percent-analysis: 仅分块 ${parsedInputs.length}/${selection.originalTotal} 个选中来源（X=${selection.requestedPercent}%）`);
  }

  // 幂等检查：现有 manifest 且输入哈希 + chunkConfig + selectionHash 全部一致 → 复用
  const manifestFile = path.join(workDir, 'manifest.json');
  let reuse = false;
  if (fs.existsSync(manifestFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (existing.schemaVersion === 1 && existing.mode === opts.mode) {
        const configMatch = JSON.stringify(existing.chunkConfig) === JSON.stringify(chunkConfig);
        const selMatch = selection ? existing.selectionHash === selection.selectorHash : true;
        const existingHashes = new Map(existing.inputs.map((i) => [i.sourceId, i.sha256]));
        const allMatch = configMatch && parsedInputs.every((i) => existingHashes.get(i.sourceId) === i.fileHash);
        const countMatch = existing.inputs.length === parsedInputs.length;
        if (allMatch && countMatch && selMatch) reuse = true;
      }
    } catch {
      // manifest 损坏 → 重建
    }
  }

  if (reuse) {
    console.log(`manifest 未变化（${parsedInputs.length} 条输入），复用现有 chunks`);
    return;
  }

  // 输入已变：**整个 digest cache 全失效**（不得静默复用任何过期中间结果）
  for (const sub of ['chunks', 'map-results', 'final']) {
    const subDir = path.join(workDir, sub);
    if (fs.existsSync(subDir)) {
      fs.rmSync(subDir, { recursive: true, force: true });
    }
  }
  for (const staleFile of ['coverage.json', 'reduce-input.json']) {
    const p = path.join(workDir, staleFile);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  fs.mkdirSync(chunksDir, { recursive: true });

  // 分块
  const chunks = buildChunks(parsedInputs, chunkConfig);

  // 写 chunk 文件（先写临时文件再改名，避免半截文件）
  const chunkIdsBySource = new Map();
  for (const chunk of chunks) {
    const target = path.join(chunksDir, `${chunk.chunkId}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(chunk, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    for (const sid of chunk.sourceIds) {
      if (!chunkIdsBySource.has(sid)) chunkIdsBySource.set(sid, []);
      chunkIdsBySource.get(sid).push(chunk.chunkId);
    }
  }

  // manifest
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceRoot: path.relative(process.cwd(), workDir).split(path.sep).join('/') || '.',
    mode: opts.mode,
    ...(selection
      ? { selectionFile: path.relative(workDir, path.resolve(opts.selectionFile)).split(path.sep).join('/'), selectionHash: selection.selectorHash }
      : {}),
    chunkConfig,
    inputs: parsedInputs.map((i) => ({
      sourceId: i.sourceId,
      relativePath: i.relativePath,
      questionId: i.questionId,
      answerId: i.answerId,
      chars: String(i.content ?? '').length,
      voteupCount: i.voteupCount,
      sha256: i.fileHash,
      chunkIds: chunkIdsBySource.get(i.sourceId) ?? [],
      status: 'pending',
    })),
  };
  const manifestTmp = `${manifestFile}.${process.pid}.tmp`;
  fs.writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(manifestTmp, manifestFile);

  console.log(`已生成 manifest: ${displayPath(manifestFile)}`);
  console.log(`输入: ${parsedInputs.length} 条回答 → ${chunks.length} 个 chunk`);
  console.log(`chunk 目录: ${displayPath(chunksDir)}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
