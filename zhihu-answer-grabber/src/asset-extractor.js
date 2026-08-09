// SPDX-License-Identifier: AGPL-3.0-only
/**
 * asset-extractor — V2 Phase 2 富内容资产元数据提取（纯函数，无网络，无 IO）。
 *
 * 合同来源：docs/specs/v2-rich-content-fidelity.md §10（图片）/ §11（外链）/
 *           §12（代码块）/ §13（脚注）/ §18（additive assets schema）
 *
 * 从 answer.content（原始 HTML）中确定性提取：
 *   - images[]：data-original → data-actualsrc → 合法 https src；忽略 placeholder
 *     （data:/blob:/1px 等）；detected 与 clickable 分离（§10.1）；同 URL 去重（§23.2）。
 *   - links[]：<a href> 全部记录（含被安全策略拒绝的，clickable=false），
 *     zhihu redirect 解包由 classifyUrl 完成（§11.1）。
 *   - references[]：<sup data-numero data-text> 脚注；sourceNumero 只作 source metadata，
 *     内部 ID 由 renderer 按出现顺序生成（§13.1）。
 *   - codeBlocks[]：language + lines 统计（不收录代码正文，正文仍在 content 中，§12.4）。
 *   - videos[]：恒空（Spec §16 明确待真实样本确认 schema，禁止 speculative parser）。
 *
 * 本模块只做确定性 DOM 遍历与分类，绝不发起任何网络请求。
 */
import { parseFragment } from 'parse5';
import { classifyImageUrl, classifyUrl } from './markdown-security.js';
import { extractLanguage } from './rich-renderer.js';

function getAttr(node, name) {
  for (const a of node.attrs ?? []) {
    if (a.name.toLowerCase() === name) return a.value;
  }
  return null;
}

/** 元素内全部文本（递归，不含 tag）；用于锚文本 / figcaption */
function nodeText(node) {
  let out = '';
  for (const c of node.childNodes ?? []) {
    if (c.nodeName === '#text') out += c.value;
    else if (c.nodeName === '#comment') continue;
    else if (c.tagName) out += nodeText(c);
  }
  return out;
}

/** 属性转有限整数；缺失/非法 → null（§10.1 width/height 为可得 metadata） */
function intAttr(node, name) {
  const v = getAttr(node, name);
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** 图片 URL 候选（按优先级）：data-original → data-actualsrc → 合法 https src */
function pickImageUrl(node) {
  for (const attr of ['data-original', 'data-actualsrc', 'src']) {
    const v = getAttr(node, attr);
    if (v && typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

/** placeholder 判定：data:/blob: 形态不是真实图片 URL（§10.1 完全忽略） */
function isPlaceholder(url) {
  if (!url) return true;
  if (/^data:/i.test(url)) return true;
  if (/^blob:/i.test(url)) return true;
  return false;
}

function collectImage(node, ctx, caption) {
  const url = pickImageNodeUrl(node);
  if (url === null || isPlaceholder(url)) return;
  const cls = classifyImageUrl(url);
  if (cls === null) return; // 分类器对非 placeholder 一律返回对象；null 仅防御
  if (ctx.seenImages.has(cls.originalUrl)) return; // §23.2 同 URL 去重
  ctx.seenImages.add(cls.originalUrl);
  const width = intAttr(node, 'width');
  const height = intAttr(node, 'height');
  const entry = {
    detected: true,
    host: cls.host,
    originalUrl: cls.originalUrl,
    displayUrl: cls.displayUrl,
  };
  if (width !== null) entry.width = width;
  if (height !== null) entry.height = height;
  const cap = caption !== undefined ? caption : getAttr(node, 'alt');
  if (cap !== null && typeof cap === 'string' && cap.trim().length > 0) {
    entry.caption = cap.trim();
  }
  entry.clickable = cls.clickable;
  entry.securityClass = cls.securityClass;
  ctx.images.push(entry);
}

/** pickImageUrl 的包装（区分「无候选」与「候选为空」语义） */
function pickImageNodeUrl(node) {
  const url = pickImageUrl(node);
  if (url === null) return null;
  return url;
}

function collectLink(node, ctx) {
  const href = getAttr(node, 'href');
  if (href === null || href.trim().length === 0) return;
  const anchorText = nodeText(node).trim();
  const cls = classifyUrl(href.trim());
  const entry = {
    originalUrl: href.trim(),
    canonicalUrl: cls !== null ? cls.canonicalUrl : null,
    domain: cls !== null ? cls.displayHost : null,
    clickable: cls !== null ? cls.clickable : false,
    securityClass: cls !== null ? cls.securityClass : 'rejected',
  };
  if (cls !== null && cls.zhihuRedirect !== undefined) {
    entry.zhihuRedirect = cls.zhihuRedirect;
  }
  if (anchorText.length > 0) entry.anchorText = anchorText;
  ctx.links.push(entry);
}

function collectReference(node, ctx) {
  const numero = getAttr(node, 'data-numero');
  const text = getAttr(node, 'data-text');
  if (numero === null && text === null) return; // 普通上标，非脚注（§13.1）
  ctx.references.push({
    sourceNumero: numero, // 外部不可信字段，仅作 source metadata，不进 Markdown identifier
    text: text !== null ? text : '', // data-text 确定性提取（缺失置空，不 fallback nodeText）
    index: ctx.references.length, // 出现顺序 → renderer 生成 a<answerId>-r<index>
  });
}

function countLines(text) {
  const s = text == null ? '' : String(text);
  if (s.length === 0) return 0;
  return s.split('\n').length;
}

function collectCodeBlock(node, ctx) {
  let codeEl = null;
  for (const c of node.childNodes ?? []) {
    if (c.tagName && c.tagName.toLowerCase() === 'code') {
      codeEl = c;
      break;
    }
  }
  const lang = codeEl !== null ? extractLanguage(codeEl) : null;
  const text = codeEl !== null ? nodeText(codeEl) : nodeText(node);
  ctx.codeBlocks.push({
    language: lang !== null ? lang : '', // 非法/缺失 → 空串（不收录正文）
    lines: countLines(text),
  });
}

/** figure：先收集 figcaption 文本作为其内图片的 caption（§10.2 保留可见 caption 文本） */
function walkFigure(node, ctx) {
  let caption = null;
  const imgs = [];
  for (const child of node.childNodes ?? []) {
    if (!child.tagName) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'figcaption') {
      const t = nodeText(child).trim();
      if (t.length > 0) caption = t;
    } else if (tag === 'img') {
      imgs.push(child);
    } else {
      // figure 内其它容器：收集其下 img（capture 深度一层，足够覆盖常见形态）
      collectNestedImages(child, imgs);
    }
  }
  for (const img of imgs) collectImage(img, ctx, caption);
}

function collectNestedImages(node, out) {
  for (const child of node.childNodes ?? []) {
    if (!child.tagName) continue;
    if (child.tagName.toLowerCase() === 'img') out.push(child);
    else collectNestedImages(child, out);
  }
}

/** 深度优先遍历（figure 特殊处理避免重复计数） */
function walk(node, ctx) {
  for (const child of node.childNodes ?? []) {
    if (!child.tagName) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'figure') {
      walkFigure(child, ctx);
      continue;
    }
    if (tag === 'img') collectImage(child, ctx);
    else if (tag === 'a') collectLink(child, ctx);
    else if (tag === 'sup') collectReference(child, ctx);
    else if (tag === 'pre') collectCodeBlock(child, ctx);
    walk(child, ctx);
  }
}

/**
 * 从知乎回答 HTML 提取结构化资产元数据（§18 additive schema）。
 *
 * @param {unknown} html answer.content 原始 HTML
 * @returns {{ images: object[], links: object[], references: object[], codeBlocks: object[], videos: object[] }}
 *   全部数组按文档出现顺序；videos 恒空（§16 待真实样本）。
 */
export function extractAssets(html) {
  const source = html == null ? '' : String(html);
  const doc = parseFragment(source);
  const ctx = {
    images: [],
    links: [],
    references: [],
    codeBlocks: [],
    videos: [], // Spec §16：真实样本 schema 确认前禁止 speculative parser
    seenImages: new Set(),
  };
  walk(doc, ctx);
  return {
    images: ctx.images,
    links: ctx.links,
    references: ctx.references,
    codeBlocks: ctx.codeBlocks,
    videos: ctx.videos,
  };
}
