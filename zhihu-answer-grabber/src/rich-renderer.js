// SPDX-License-Identifier: AGPL-3.0-only
/**
 * rich-renderer — V2 Phase 1 严格白名单 HTML → Markdown renderer。
 *
 * 合同来源：docs/specs/v2-rich-content-fidelity.md §8 / §12 / §14 / §18 / §19 / §20
 *
 * 安全模型：
 *   - 使用成熟 HTML5 parser（parse5）解析，不做 regex 假 parser；
 *   - 只有白名单元素的语义被保留；未知/危险元素丢弃 tag+attrs，仅保留可见文本；
 *   - 所有 text node / anchor text / caption / alt 一律先过 text/URL pipeline
 *     （escapeUntrustedMarkdownText + bare URL tokenizer + URL sanitizer）；
 *   - 最终 Markdown 不允许 raw HTML passthrough；
 *   - 图片 Phase 1 只输出 inert 占位（不自动加载、不产生任意远程 href）；
 *   - 脚注 Phase 1 只保留安全可见文本（不重建脚注 identifier）。
 *
 * 本模块为纯函数渲染，不发起任何网络请求。
 */
import { parseFragment } from 'parse5';
import {
  escapeUntrustedMarkdownText,
  tokenizeBareUrls,
  classifyUrl,
  safeMarkdownDestination,
} from './markdown-security.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

// 白名单/已知块级标签（用于 inline/block 分流；未知块级走默认分支）
const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'figure',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'section', 'article', 'aside', 'header', 'footer', 'main',
  'dl', 'dt', 'dd', 'details', 'summary', 'nav',
]);

// 主动行为元素：丢弃元素本身与属性；其下可见文本按 §18 保留（script/style 完全丢弃）
const ACTIVE_TAGS = new Set([
  'script', 'style', 'form', 'input', 'button', 'iframe', 'object', 'embed',
  'select', 'option', 'textarea', 'template', 'applet', 'frame', 'frameset',
  'link', 'meta', 'base',
]);

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function getAttr(node, name) {
  for (const a of node.attrs ?? []) {
    if (a.name.toLowerCase() === name) return a.value;
  }
  return null;
}

/** 元素内全部文本（递归，不含 tag）；用于 code/pre 等需要原文的场景 */
function nodeText(node) {
  let out = '';
  for (const c of node.childNodes ?? []) {
    if (c.nodeName === '#text') out += c.value;
    else if (c.nodeName === '#comment') continue;
    else if (c.tagName) out += nodeText(c);
  }
  return out;
}

/** 字符串中最长连续 backtick 串长度 */
export function longestBacktickRun(value) {
  let max = 0;
  let cur = 0;
  for (const ch of String(value)) {
    if (ch === '`') {
      cur += 1;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// §8.0.2 text/URL pipeline
// ---------------------------------------------------------------------------

/**
 * 不可信文本 → Markdown 的唯一确定性处理顺序：
 * tokenize bare URL → URL span 走 sanitizer（通过 → renderer 显式链接，
 * 拒绝 → escaped inert text）；普通 span → escapeUntrustedMarkdownText。
 */
function textPipeline(text, ctx) {
  const spans = tokenizeBareUrls(text);
  let out = '';
  for (const span of spans) {
    if (span.type === 'url') {
      const cls = classifyUrl(span.url);
      if (cls !== null && cls.clickable) {
        out += `[打开外部链接 · ${cls.displayHost}](${safeMarkdownDestination(cls.canonicalUrl)})`;
      } else {
        out += escapeUntrustedMarkdownText(span.url);
      }
    } else {
      out += escapeUntrustedMarkdownText(span.text);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 行内渲染
// ---------------------------------------------------------------------------

function renderInlineChildren(node, ctx) {
  let out = '';
  for (const c of node.childNodes ?? []) {
    if (c.nodeName === '#text') out += textPipeline(c.value, ctx);
    else if (c.nodeName === '#comment') continue;
    else if (c.tagName) out += renderInlineNode(c, ctx);
  }
  return out;
}

function renderInlineNode(node, ctx) {
  if (node.nodeName === '#text') return textPipeline(node.value, ctx);
  if (node.nodeName === '#comment') return '';
  if (!node.tagName) return '';
  const tag = node.tagName.toLowerCase();

  switch (tag) {
    case 'br':
      return '\n';
    case 'strong':
    case 'b': {
      const t = renderInlineChildren(node, ctx).trim();
      return t ? `**${t}**` : '';
    }
    case 'em':
    case 'i': {
      const t = renderInlineChildren(node, ctx).trim();
      return t ? `*${t}*` : '';
    }
    case 'code':
      return renderInlineCode(node, ctx);
    case 'a':
      return renderAnchor(node, ctx);
    case 'img':
      return renderImage(node, ctx);
    case 'sup':
    case 'sub':
      // Phase 1：保留安全可见文本（不重建 footnote contract，Phase 2 再做）
      return renderInlineChildren(node, ctx);
    case 'script':
    case 'style':
      return '';
    default:
      // 未知/容器行内元素：保留可见文本，丢弃 tag + attrs
      return renderInlineChildren(node, ctx);
  }
}

// ---------------------------------------------------------------------------
// 块级渲染
// ---------------------------------------------------------------------------

function renderBlockChildren(nodes, ctx) {
  const blocks = [];
  let inline = '';
  const flush = () => {
    if (inline.trim().length > 0) blocks.push(inline.trim());
    inline = '';
  };
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      inline += textPipeline(node.value, ctx);
      continue;
    }
    if (node.nodeName === '#comment') continue;
    if (!node.tagName) continue;
    const tag = node.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) {
      flush();
      const r = renderBlock(node, ctx);
      if (r.trim().length > 0) blocks.push(r);
    } else {
      inline += renderInlineNode(node, ctx);
    }
  }
  flush();
  return blocks.join('\n\n');
}

function renderBlock(node, ctx) {
  const tag = node.tagName.toLowerCase();
  switch (tag) {
    case 'p':
    case 'div':
      return renderBlockChildren(node.childNodes ?? [], ctx);
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return renderHeading(node, ctx);
    case 'ul':
      return renderList(node, ctx, false);
    case 'ol':
      return renderList(node, ctx, true);
    case 'blockquote':
      return renderBlockquote(node, ctx);
    case 'pre':
      return renderPre(node, ctx);
    case 'hr':
      return '---';
    case 'figure':
      return renderFigure(node, ctx);
    case 'script':
    case 'style':
      // 内容也不进入用户正文（§18）
      return '';
    case 'form':
    case 'input':
    case 'button':
    case 'iframe':
    case 'object':
    case 'embed':
    case 'select':
    case 'option':
    case 'textarea':
    case 'template':
    case 'applet':
    case 'frame':
    case 'frameset':
    case 'link':
    case 'meta':
    case 'base':
      // 主动行为全部删除；保留可见普通文本（§18）
      return renderBlockChildren(node.childNodes ?? [], ctx);
    default:
      // 未知标签：保留安全可见文字，丢弃 tag + attrs（§14.2，fail closed）
      return renderBlockChildren(node.childNodes ?? [], ctx);
  }
}

// ---------------------------------------------------------------------------
// 白名单元素渲染
// ---------------------------------------------------------------------------

/** §14.1.1 heading offset：answer body 的 source h1 → H3, h2 → H4, h3 → H5, h4-h6 → H6 */
function renderHeading(node, ctx) {
  const src = Number(node.tagName.slice(1)) || 1;
  const offset = Number.isInteger(ctx.headingOffset) ? ctx.headingOffset : 2;
  const level = Math.min(src + offset, 6);
  const text = renderBlockChildren(node.childNodes ?? [], ctx);
  return `${'#'.repeat(level)} ${text}`;
}

function renderBlockquote(node, ctx) {
  const content = renderBlockChildren(node.childNodes ?? [], ctx);
  if (content.length === 0) return '';
  return content
    .split('\n')
    .map((line) => (line.length === 0 ? '>' : `> ${line}`))
    .join('\n');
}

/** §12.3 fenced code 安全：fence 长度自适应；language 白名单 */
function renderPre(node, ctx) {
  let codeEl = null;
  for (const c of node.childNodes ?? []) {
    if (c.tagName && c.tagName.toLowerCase() === 'code') {
      codeEl = c;
      break;
    }
  }
  const text = codeEl !== null ? nodeText(codeEl) : nodeText(node);
  const lang = codeEl !== null ? extractLanguage(codeEl) : null;
  // fence 必须比内容中最长 backtick 串更长，且至少 3 个（标准 fence）
  const fence = '`'.repeat(Math.max(longestBacktickRun(text) + 1, 3));
  const langPart = lang === null ? '' : ` ${lang}`;
  return `${fence}${langPart}\n${text}\n${fence}`;
}

/** language 属于不可信 metadata：只允许 [A-Za-z0-9_+-]* 且长度受限；非法 → 省略（导出供 asset-extractor 复用，单一事实来源） */
export function extractLanguage(codeEl) {
  const cls = getAttr(codeEl, 'class') || '';
  // class 含换行/控制字符 → 整体拒绝（防止 language-bash\nrm -rf 等注入）
  if (/[\u0000-\u001F\u007F]/.test(cls)) return null;
  const m = cls.match(/(?:^|\s)(?:language-|lang-)([A-Za-z0-9_+-]+)/);
  let lang = m ? m[1] : '';
  if (lang.length === 0) {
    const dl = getAttr(codeEl, 'data-language');
    if (dl != null) lang = String(dl).trim();
    if (/[\u0000-\u001F\u007F]/.test(lang)) return null;
  }
  if (lang.length === 0 || lang.length > 40) return null;
  if (!/^[A-Za-z0-9_+-]+$/.test(lang)) return null;
  return lang;
}

/** inline code：内容中的 backtick 不能造成 Markdown escape */
function renderInlineCode(node, ctx) {
  const text = nodeText(node);
  const run = longestBacktickRun(text);
  const delim = '`'.repeat(run + 1); // run=0 → 1 个 backtick，run≥1 → 更长 delimiter
  const needSpace = text.length === 0 || text.startsWith('`') || text.endsWith('`');
  return needSpace ? `${delim} ${text} ${delim}` : `${delim}${text}${delim}`;
}

/** §8.2 / §11.5：外链必须 renderer 生成；明示 canonical 域名；拒绝的 href → 仅保留锚文本 */
function renderAnchor(node, ctx) {
  const href = getAttr(node, 'href');
  const anchorText = renderInlineChildren(node, ctx).trim();
  const cls = href ? classifyUrl(href) : null;
  const parts = [];
  if (anchorText.length > 0) {
    parts.push(`原文链接文字：${anchorText}`);
  }
  if (cls !== null && cls.clickable) {
    parts.push(`[打开外部链接 · ${cls.displayHost}](${safeMarkdownDestination(cls.canonicalUrl)})`);
  }
  return parts.join('\n');
}

/** §19 Phase 1 图片：inert 占位，不自动加载、不透传、不产生任意远程 href */
function renderImage(node, ctx) {
  const alt = getAttr(node, 'alt');
  if (alt != null && alt.trim().length > 0) {
    return `[图片：${escapeUntrustedMarkdownText(alt.trim())}]`;
  }
  return '[图片]';
}

/** figure：保留安全 caption 文本 + 图片 inert 占位 */
function renderFigure(node, ctx) {
  const blocks = [];
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === '#text' || child.nodeName === '#comment') continue;
    if (!child.tagName) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'figcaption') {
      const c = renderBlockChildren(child.childNodes ?? [], ctx);
      if (c.trim().length > 0) blocks.push(c);
    } else if (tag === 'img') {
      blocks.push(renderImage(child, ctx));
    } else {
      const r = renderBlock(child, ctx);
      if (r.trim().length > 0) blocks.push(r);
    }
  }
  return blocks.join('\n\n');
}

/** ul/ol 列表：marker 由 renderer 生成；嵌套列表缩进由外层 li 对齐规则负责 */
function renderList(node, ctx, ordered) {
  const lines = [];
  let n = 1;
  let start = 1;
  if (ordered) {
    const startAttr = getAttr(node, 'start');
    if (startAttr !== null && /^\d{1,6}$/.test(startAttr)) start = Number(startAttr);
  }
  for (const child of node.childNodes ?? []) {
    if (!child.tagName) continue;
    const tag = child.tagName.toLowerCase();
    if (tag !== 'li') {
      const r = renderBlock(child, ctx);
      if (r.trim().length > 0) lines.push(r);
      continue;
    }
    const marker = ordered ? `${start + n - 1}.` : '-';
    const content = renderLiContent(child, ctx);
    const cLines = content.split('\n');
    lines.push(`${marker} ${cLines[0]}`);
    const contPad = ' '.repeat(marker.length + 1);
    for (let i = 1; i < cLines.length; i += 1) {
      lines.push(`${contPad}${cLines[i]}`);
    }
    n += 1;
  }
  return lines.join('\n');
}

function renderLiContent(li, ctx) {
  const blocks = [];
  let inline = '';
  const flush = () => {
    if (inline.trim().length > 0) blocks.push(inline.trim());
    inline = '';
  };
  for (const child of li.childNodes ?? []) {
    if (child.nodeName === '#text') {
      inline += textPipeline(child.value, ctx);
      continue;
    }
    if (child.nodeName === '#comment') continue;
    if (!child.tagName) continue;
    const tag = child.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) {
      flush();
      if (tag === 'ul') blocks.push(renderList(child, ctx, false));
      else if (tag === 'ol') blocks.push(renderList(child, ctx, true));
      else blocks.push(renderBlock(child, ctx));
    } else {
      inline += renderInlineNode(child, ctx);
    }
  }
  flush();
  return blocks.join('\n');
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * HTML（知乎 answer.content / description 等）→ 安全 Markdown。
 *
 * @param {unknown} html
 * @param {{ headingOffset?: number }} [ctx]
 *   headingOffset：正文 heading 相对文档顶层的偏移（answer body 默认 2 → h1 变 H3）
 * @returns {string}
 */
export function richHtmlToMarkdown(html, ctx = {}) {
  const source = html == null ? '' : String(html);
  const doc = parseFragment(source);
  const merged = { headingOffset: 2, ...ctx };
  return renderBlockChildren(doc.childNodes ?? [], merged).trim();
}
