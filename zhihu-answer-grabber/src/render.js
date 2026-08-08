// SPDX-License-Identifier: AGPL-3.0-only
import { escapeUntrustedMarkdownText, safeMarkdownDestination } from './markdown-security.js';
import { richHtmlToMarkdown } from './rich-renderer.js';

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 解码数字（十进制/十六进制）与常见命名实体 */
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

/** 关键字符重新编码，防止解码后重新引入原始 HTML 标签 */
function escapeRawHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 行内 Markdown 转义：防止标题/作者等短文本破坏文档结构（V1 遗留，保持导出语义） */
function escapeInlineMd(value) {
  return String(value).replace(/([\\`*_[\]{}()#+.!|>~-])/g, '\\$1');
}

/**
 * 剥离 HTML 标签、解码实体、重新转义，输出安全纯文本。
 *
 * V1 遗留 API：保留其语义供兼容（test/browser-smoke-core.mjs 等引用其行为）。
 * V2 renderAnswers 已改用 richHtmlToMarkdown（白名单结构渲染），不再调用本函数。
 */
export function stripHtml(html) {
  if (html == null) return '';
  let text = String(html)
    // 先整体移除 script/style 内容，防止解码后恢复为可执行脚本
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  text = decodeEntities(text);
  text = escapeRawHtml(text);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fmtTime(unix) {
  if (!unix) return '(未知)';
  const d = new Date(unix * 1000);
  return Number.isNaN(d.getTime()) ? '(未知)' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/**
 * scalar metadata 数值收口（P1-2）：
 * 只接受有限 numeric 值（数字或可安全转成数字的字符串），否则用 fallback。
 * 防止异常字符串（如 `1. fake` / `- fake`）直接插进 Markdown 制造结构。
 */
function numericOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * P1-2：framing 中的问题/回答链接由已验证 ID 确定性构造，
 * 不信任 meta.url / answer.url（断点续传可能加载被篡改的磁盘产物）。
 */
function buildQuestionUrl(questionId) {
  return `https://www.zhihu.com/question/${String(questionId)}`;
}

function buildAnswerUrl(questionId, answerId) {
  return `https://www.zhihu.com/question/${String(questionId)}/answer/${String(answerId)}`;
}

/**
 * 生成可读 Markdown：题目信息 + 按赞数倒序的回答全文。
 *
 * V2 Phase 1：回答正文改用严格白名单 HTML → Markdown renderer（richHtmlToMarkdown），
 * 保持 V1 文件级 framing 合同：
 *   # 问题标题
 *   ## N. 作者 — 赞 · 评论
 *   ---
 * 每条回答恰好一个 renderer 生成的 `## N.` heading（verifier 记录数校验依赖）。
 *
 * questionTitle / author / 一切不可信 metadata 一律先过 escapeUntrustedMarkdownText；
 * 链接目标由 questionId/answerId 确定性构造并经 safeMarkdownDestination，
 * 不得自行产生 heading / link / list 结构。
 */
export function renderAnswers(meta, answers) {
  const lines = [];
  const title = escapeUntrustedMarkdownText(meta.questionTitle || `问题 ${meta.questionId}`);
  const questionLink = `[知乎问题](${safeMarkdownDestination(buildQuestionUrl(meta.questionId))})`;
  const answerCount = numericOr(meta.answerCount, null);
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> 问题链接: ${questionLink}`);
  lines.push(`> 抓取时间: ${meta.fetchedAt || new Date().toISOString()}`);
  lines.push(`> 问题回答总数: ${answerCount === null ? '(未知)' : answerCount}，本次抓取到: 共 ${answers.length} 条回答`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const sorted = [...answers].sort((a, b) => numericOr(b.voteupCount, 0) - numericOr(a.voteupCount, 0));
  sorted.forEach((a, i) => {
    const author = escapeUntrustedMarkdownText(a.author || '(匿名)');
    const voteup = numericOr(a.voteupCount, 0);
    const comment = numericOr(a.commentCount, 0);
    const answerLink = `[知乎回答](${safeMarkdownDestination(buildAnswerUrl(meta.questionId, a.id))})`;
    lines.push(`## ${i + 1}. ${author} — ${voteup} 赞 · ${comment} 评论`);
    lines.push('');
    lines.push(`- 链接: ${answerLink}`);
    lines.push(`- 创建时间: ${fmtTime(a.createdTime)}`);
    lines.push('');
    lines.push(richHtmlToMarkdown(a.content));
    lines.push('');
    lines.push('---');
    lines.push('');
  });
  return lines.join('\n');
}
