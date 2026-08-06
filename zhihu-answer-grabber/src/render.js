// SPDX-License-Identifier: AGPL-3.0-only
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

/** 行内 Markdown 转义：防止标题/作者等短文本破坏文档结构 */
function escapeInlineMd(value) {
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

function fmtTime(unix) {
  if (!unix) return '(未知)';
  const d = new Date(unix * 1000);
  return Number.isNaN(d.getTime()) ? '(未知)' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/** 生成可读 Markdown：题目信息 + 按赞数倒序的回答全文 */
export function renderAnswers(meta, answers) {
  const lines = [];
  const title = escapeInlineMd(meta.questionTitle || `问题 ${meta.questionId}`);
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> 问题链接: ${meta.url}`);
  lines.push(`> 抓取时间: ${meta.fetchedAt || new Date().toISOString()}`);
  lines.push(`> 问题回答总数: ${meta.answerCount ?? '(未知)'}，本次抓取到: 共 ${answers.length} 条回答`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const sorted = [...answers].sort((a, b) => (b.voteupCount ?? 0) - (a.voteupCount ?? 0));
  sorted.forEach((a, i) => {
    const author = escapeInlineMd(a.author || '(匿名)');
    lines.push(`## ${i + 1}. ${author} — ${a.voteupCount ?? 0} 赞 · ${a.commentCount ?? 0} 评论`);
    lines.push('');
    lines.push(`- 链接: ${a.url}`);
    lines.push(`- 创建时间: ${fmtTime(a.createdTime)}`);
    lines.push('');
    lines.push(stripHtml(a.content));
    lines.push('');
    lines.push('---');
    lines.push('');
  });
  return lines.join('\n');
}
