#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * render-final — 从 final.json（canonical digest 产物）确定性渲染 digest.md。
 *
 * 用法:
 *   node scripts/render-final.mjs --final work/final/final.json --out work/final/digest.md
 *   node scripts/render-final.mjs --final work/final/final.json   # 输出到 stdout
 *
 * 设计原则:
 *   - final.json 是「事实来源」（canonical artifact）：结构化 sections/claims，
 *     每个 claim 携带 evidenceSourceIds；digest.md 只是展示层，由本脚本确定性渲染。
 *   - 校验（verify.mjs --final）针对 final.json 执行，而不是 regex 猜 Markdown。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeRawHtml } from '../lib/text.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * 自然语言字段安全规范化（P1-3）：
 * - escapeRawHtml：把 & < > 转义为实体，防止 raw HTML 注入（复用 lib/text.mjs，不重复实现）
 * - 换行折叠为空格：防止内容注入新的 Markdown 结构（如行首 `#` 变 H1、`---` 变水平线）
 * - 双转义输入（如 `&lt;script&gt;`）经 escapeRawHtml 后 `&` 会再编码为 `&amp;`，
 *   输出中不会恢复成 raw `<script>` 标签。
 * sourceId 是系统生成的受控格式（question-123-answer-456），保持直接渲染。
 */
function safeText(value) {
  return escapeRawHtml(String(value ?? ''))
    .replace(/\r?\n/g, ' ')
    .trim();
}

/** 从 final.json 渲染 Markdown（确定性；meta 可补充 inputCount/chunkCount 展示信息）
 *  mode='top-percent-analysis' → Top-percent 分析摘要 + 7 项披露块（D2.8，SAMPLED != FULL）
 *  mode='digest'（默认）      → 语料全覆盖摘要（原行为不变）
 */
export function renderDigest(final, meta = {}) {
  const L = [];
  const claims = Array.isArray(final.claims) ? final.claims : [];
  const minorityViews = Array.isArray(final.minorityViews) ? final.minorityViews : [];
  const uncertainties = Array.isArray(final.uncertainties) ? final.uncertainties : [];
  const isTopPercent = final.mode === 'top-percent-analysis';

  if (isTopPercent) {
    L.push('# 语料 Top-percent 分析摘要');
    L.push('');
    L.push('> ⚠️ **这是 Top-percent 采样分析，不是全量摘要（canonical full-digest）。**');
    L.push('>');
    L.push(`> - 请求比例：**${safeText(final.requestedPercent)}%**（requestedPercent）`);
    L.push(`> - 选中 / 总数：**${safeText(final.selectedAnswers)} / ${safeText(final.totalAnswers)}**（selectedAnswers / totalAnswers）`);
    L.push(`> - 实际覆盖：**${safeText(final.actualCoveragePercent)}%**（actualCoveragePercent）`);
    L.push(`> - 选择规则：${safeText(final.selectionRule)}（selectionRule）`);
    L.push(`> - canonical-source 覆盖是否恰好完整：**${final.isFullCoverage === true ? '是' : '否'}**（isFullCoverage）`);
    L.push(`> - 即使覆盖为 100%，本产物**也不是** canonical full-digest 管线（mode=top-percent-analysis，身份恒为采样分析）。`);
    L.push(`> - 选中来源：${(Array.isArray(final.selectedSourceIds) ? final.selectedSourceIds : []).map((s) => `[${s}]`).join(' ')}（selectedSourceIds）`);
    L.push('');
  } else {
    L.push('# 语料全覆盖摘要');
    L.push('');
    const inputCount = final.inputCount ?? meta.inputCount;
    const chunkCount = final.chunkCount ?? meta.chunkCount;
    if (inputCount !== undefined || chunkCount !== undefined) {
      L.push(`> 覆盖 ${inputCount ?? '?'} 条回答 / ${chunkCount ?? '?'} 个 chunk。`);
      L.push('');
    }
  }

  if (claims.length > 0) {
    L.push('## 主要观点');
    claims.forEach((c, i) => {
      const text = safeText(c.text);
      if (!text) return;
      const evs = Array.isArray(c.evidenceSourceIds) ? c.evidenceSourceIds : [];
      L.push(`${i + 1}. ${text}`);
      const confidence = safeText(c.confidence);
      L.push(`   - 来源: ${evs.map((s) => `[${s}]`).join(' ')}${confidence ? `（置信度 ${confidence}）` : ''}`);
    });
    L.push('');
  }

  if (minorityViews.length > 0) {
    L.push('## 少数观点');
    for (const v of minorityViews) L.push(`- ${safeText(v)}`);
    L.push('');
  }

  if (uncertainties.length > 0) {
    L.push('## 不确定性');
    for (const u of uncertainties) L.push(`- ${safeText(u)}`);
    L.push('');
  }

  return L.join('\n') + '\n';
}

function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel || '.';
}

function main() {
  const finalFile = arg('--final', null);
  if (!finalFile) {
    console.error('用法: node scripts/render-final.mjs --final <final.json> [--out <digest.md>]');
    process.exit(2);
  }
  let final;
  try {
    final = readJson(finalFile);
  } catch (error) {
    console.error(`final.json 无法解析: ${finalFile} — ${error.message}`);
    process.exit(1);
  }
  const md = renderDigest(final);
  const out = arg('--out', null);
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, md, 'utf8');
    console.log(`digest.md: ${displayPath(out)}`);
  } else {
    process.stdout.write(md);
  }
}

// 仅作为 CLI 直接运行时执行 main（被 reduce.mjs import 时不得执行）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
