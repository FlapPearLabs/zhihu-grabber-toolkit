// SPDX-License-Identifier: AGPL-3.0-only
/**
 * asset-extractor — V2 Phase 2 富内容资产元数据提取（纯函数，无网络，无 IO）。
 *
 * 合同来源：docs/specs/v2-rich-content-fidelity.md §10（图片）/ §11（外链）/
 *           §12（代码块）/ §13（脚注）/ §18（additive assets schema）
 *
 * 从 answer.content（原始 HTML）中确定性提取：
 *   - images[]：data-original → data-actualsrc → 合法 https src 的 candidate-by-candidate
 *     选择：placeholder（PHASE2_1PX_PLACEHOLDER_CONTRACT：data:/blob: 一律视为 placeholder；
 *     HTTP(S) 仅当原始 <img> 显式提供 width==1 && height==1 才确定性视为 1×1 placeholder）
 *     被忽略并继续 fallback 到 lower-priority 真实候选（§10.1）；每个候选在 selection
 *     阶段即经 classifyImageUrl 确认可接受（null 跳过）；
 *     src 仅合法 https 可作 fallback（http: 不是合法候选）；detected 与 clickable
 *     分离；同 URL 去重（§23.2）。
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

/**
 * 图片 URL 候选（§10.1 优先级）：data-original → data-actualsrc → 合法 https src。
 *
 * candidate-by-candidate selection，返回首个可接受的 image candidate：
 *   1. missing/empty → next candidate；
 *   2. placeholder（PHASE2_1PX_PLACEHOLDER_CONTRACT：data:/blob: 一律；HTTP(S) 仅当
 *      原始 <img> 显式提供 width==1 && height==1 才视为 1×1 placeholder）→ next
 *      candidate（placeholder 不计入 detected；若存在 lower-priority 真实 URL 必须
 *      继续 fallback）；
 *      —— 1px 尺寸证据只消费一次：首个被显式 width==1&&height==1 判为 1px placeholder
 *        的 candidate（如 data-original 为 1×1 跟踪像素）被跳过（P2-1PX-A/B）后，后续
 *        lower-priority candidate 不再因同一证据被判 1px，它们是真实 swap-in 图片；
 *      —— data:/blob: 形态不消费该证据：src=data: 占位 + data-actualsrc=1×1 跟踪像素时，
 *        data-actualsrc 仍需用尺寸证据判定（真实知乎 lazy-loading 跟踪像素形态）。
 *   3. classifyImageUrl(url) === null → next candidate（空/控制字符/非 http(s) scheme
 *      如 javascript: / file: 不是可接受的 image candidate，不得抑制 lower-priority
 *      真实候选）；data-original / data-actualsrc 无协议限制，http 形态返回非 null
 *      分类对象、按 §10.1 记录 detected 但 clickable=false；
 *   4. src 仅合法 https 可作 §10.1 fallback（http: 不是「合法 https src」候选 → 跳过）；
 *   5. 否则 → 采用，返回 { url, cls }（cls = classifyImageUrl(url) 且非 null，避免
 *      collectImage 重复 parse 一次）。
 *   6. 全部无可用候选 → null（整张图忽略，不进 assets）。
 *
 * 注意：classifyImageUrl 对「无法解析的 https 形态」返回 { detected:true, clickable:false,
 * reason:'unparsable' } 而非 null —— 该形态是合法 candidate，应选用；只有
 * classifyImageUrl 返回 null 的（空/控制字符/data:/blob:/javascript: 等非 http(s) scheme）
 * 才跳过。
 */
function pickImageUrl(node) {
  let consumed1pxEvidence = false; // 显式 width==1&&height==1 证据是否已用于判 1px placeholder
  for (const attr of ['data-original', 'data-actualsrc', 'src']) {
    const v = getAttr(node, attr);
    if (v === null || v === undefined) continue; // missing → next candidate
    const url = String(v).trim();
    if (url.length === 0) continue; // empty → next candidate
    // 已消费 1px 尺寸证据后，后续 candidate 只做 data:/blob: 判定（合同 1），不再用
    // 同一 width/height 证据判 1px（P2-1PX-A/B fallback 语义）。
    const placeholder = consumed1pxEvidence
      ? isDataOrBlobPlaceholder(url)
      : isImageCandidatePlaceholder(node, url);
    if (placeholder) {
      // 仅 HTTP(S) 显式 1×1 形态消费尺寸证据；data:/blob: 形态不消费（真实图片候选
      // 仍可用尺寸证据判定，如 src=data: 占位 + data-actualsrc=1×1 跟踪像素）。
      if (!consumed1pxEvidence && !isDataOrBlobPlaceholder(url)) consumed1pxEvidence = true;
      continue; // placeholder → next candidate
    }
    if (attr === 'src' && !/^https:\/\//i.test(url)) continue; // http: 不得作 src fallback
    const cls = classifyImageUrl(url);
    if (cls === null) continue; // 非可接受 image candidate（javascript:/file: 等）→ next
    return { url, cls };
  }
  return null;
}

/**
 * data:/blob: 一律视为 placeholder（PHASE2_1PX_PLACEHOLDER_CONTRACT 合同 1）。
 *
 * §10.1 明确列出的 lazy-loading placeholder 形态（`data:image/svg+xml;...` 占位、
 * `data:image/gif;base64` 1x1 透明 gif 示例）由本函数确定性覆盖；本函数不依赖
 * 任何 width/height 尺寸证据。
 */
function isDataOrBlobPlaceholder(url) {
  if (!url) return true;
  if (/^data:/i.test(url)) return true;
  if (/^blob:/i.test(url)) return true;
  return false;
}

/**
 * image candidate placeholder 判定（PHASE2_1PX_PLACEHOLDER_CONTRACT，合同 1-5）。
 *
 * - 合同 1：`data:` / `blob:` candidate 一律视为 placeholder；
 * - 合同 2：HTTP(S) image candidate 仅当原始 <img> 同时显式提供 width==1 且
 *   height==1 才确定性视为 1×1 placeholder；
 * - 合同 3：width/height 缺失、非法、或不同时为 1 → 不得猜测为 1px placeholder
 *   （intAttr 对缺失/非法返回 null，`w === 1 && h === 1` 不成立）；
 * - 合同 4：禁止启发式 —— URL filename / path / token / query / host / CSS class /
 *   alt text 一律不用于判断 1px；
 * - 合同 5：禁止网络请求获取 intrinsic dimensions（本模块纯函数、无网络）；
 * - 其它 scheme（javascript:/file: 等）返回 false，交给 pickImageUrl 的
 *   classifyImageUrl 过滤（非 http(s) scheme 返回 null → next candidate）。
 *
 * 注意：本函数返回 true 只表示「该 candidate 是 placeholder」；1px 尺寸证据的
 * 单次消费语义由 pickImageUrl 的 consumed1pxEvidence 处理（P2-1PX-A/B）。
 */
function isImageCandidatePlaceholder(node, url) {
  if (!url) return true;
  if (/^data:/i.test(url)) return true; // 合同 1
  if (/^blob:/i.test(url)) return true; // 合同 1
  if (/^https?:\/\//i.test(url)) { // 合同 2：HTTP(S) 仅 width==1 AND height==1 视为 1px
    const w = intAttr(node, 'width');
    const h = intAttr(node, 'height');
    if (w === 1 && h === 1) return true;
    return false; // 合同 3/4：无证据不猜
  }
  return false; // 其它 scheme 交给 pickImageUrl 的 classifyImageUrl 过滤
}

function collectImage(node, ctx, caption) {
  const pick = pickImageUrl(node);
  if (pick === null) return; // §10.1：无可用候选 → 整张图忽略（不进 assets）
  const cls = pick.cls; // pickImageUrl 已确认 cls 非 null，无需重复 parse
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

function collectLink(node, ctx) {
  const href = getAttr(node, 'href');
  if (href === null || href.trim().length === 0) return;
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
  ctx.links.push(entry);
}

function collectReference(node, ctx) {
  const numero = getAttr(node, 'data-numero');
  const text = getAttr(node, 'data-text');
  if (numero === null && text === null) return; // 普通上标，非脚注（§13.1）
  ctx.references.push({
    sourceNumero: numero, // 外部不可信字段，仅作 source metadata，不进 Markdown identifier
    text: text !== null ? text : '', // data-text 确定性提取（缺失置空，不 fallback nodeText）
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

/**
 * figure：负责建立 figcaption → 图片 caption 关联 + 收集 figure 内 img（带 caption），
 * 但**不得阻断**其它 asset 类型（a/sup/pre/非 img 容器）的通用遍历（P1-2）。
 * img 重复计数由 collectImage 的 seenImages（§23.2 同 URL 去重）保证只计一次：
 * 先在此处以 caption 收集，随后 walk() 再次遍历到同一 img 时被去重跳过。
 */
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
      // figure 内其它容器：收集其下 img（§10.2 常见形态：<a><img></a> 等）
      collectNestedImages(child, imgs);
    }
  }
  for (const img of imgs) collectImage(img, ctx, caption);
  // 不阻断其它 asset 类型：figure 内 a/sup/pre/非 img 容器继续走通用遍历
  walk(node, ctx);
}

function collectNestedImages(node, out) {
  for (const child of node.childNodes ?? []) {
    if (!child.tagName) continue;
    if (child.tagName.toLowerCase() === 'img') out.push(child);
    else collectNestedImages(child, out);
  }
}

/**
 * 深度优先遍历。figure 特殊处理（caption 关联 + 不阻断其它 asset；img 由
 * seenImages 去重防 double-count）；其余 tag 走通用 asset 收集后继续递归。
 */
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
