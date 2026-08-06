// SPDX-License-Identifier: MIT
/**
 * corpus-anthology 共享文本工具（MIT 许可，独立于 AGPL 的 zhihu-answer-grabber）。
 * 与 render.js 中的实现保持逻辑一致，但允许在 MIT 模块内自由使用。
 */

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 解码数字（十进制/十六进制）与常见命名实体 */
export function decodeEntities(value) {
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
export function escapeRawHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 行内 Markdown 转义 */
export function escapeInlineMd(value) {
  return String(value).replace(/([\\`*_[\]{}()#+.!|>~-])/g, '\\$1');
}

/** 剥离 HTML 标签、解码实体、重新转义，输出安全纯文本 */
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

/** 移除终端控制字符（ANSI 注入防护） */
export function terminalSafe(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}
