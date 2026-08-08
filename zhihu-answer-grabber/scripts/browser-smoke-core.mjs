// SPDX-License-Identifier: AGPL-3.0-only
/**
 * browser-smoke-core — browser-smoke 的纯函数核心（零第三方依赖，可离线测试）。
 *
 * 与 scripts/browser-smoke.mjs 分离的原因：离线测试必须能在无 @playwright/test
 * 依赖、无浏览器、无网络的普通 CI 中运行；真实浏览器逻辑在 browser-smoke.mjs 中
 * 运行时动态 import playwright，两者通过本模块共享纯函数。
 */
import { loadConfig, ConfigError } from '../src/config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 从 loadConfig 的 cookies 对象转换为 Playwright cookies。
 * 只做内存转换，不输出、不落盘。
 */
export function toPlaywrightCookies(cookies) {
  return Object.entries(cookies)
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([name, value]) => ({ name, value, domain: 'www.zhihu.com', path: '/' }));
}

/**
 * HTML → 可匹配文本：剥离标签、解码实体、块级转行、折叠空白。
 * 注：不复用 render.js 的 stripHtml()，因其末尾 escapeRawHtml() 会把 &<> 重新转义
 * 成实体（面向 Markdown 渲染安全），会破坏与浏览器可见文本的匹配；此处为匹配语义
 * 使用「剥离 + 解码」版本（剥离逻辑与 stripHtml 一致）。
 */
export function normalizeHtmlText(html) {
  if (html == null) return '';
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  let text = String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  text = text.replace(/&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, token) => {
    const lower = token.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[lower] ?? whole;
  });
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 折叠空白：空格/换行/tab 统一为单个空格（用于两侧文本比对） */
export function collapseWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * 从规范化文本中提取稳定片段（前/中/尾各一）。
 * 按句子边界切分后分成前/中/尾三组，每组句子拼接为一个片段：
 *   - 片段彼此不重叠、不互相污染（front 不会吞掉尾部内容）；
 *   - 剔除句子内裸 URL 子串；
 *   - 句子少于 3 句时整体作为单片段（由 contentMatched 短文本兜底处理）。
 */
export function extractStableFragments(normalizedText, targetChars = 60) {
  const text = collapseWhitespace(normalizedText);
  const sentences = text
    .split(/(?<=[。！？!?])/)
    .map((s) => s.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return [];

  const n = sentences.length;
  let groups;
  if (n >= 3) {
    const third = Math.ceil(n / 3);
    groups = [
      sentences.slice(0, third),
      sentences.slice(third, n - third),
      sentences.slice(n - third),
    ];
  } else {
    groups = [sentences];
  }
  const join = (arr) => arr.join(' ').trim();
  return [...new Set(groups.map(join))].filter((f) => f.length >= 20);
}

/**
 * 内容匹配：browserText 中能命中 >= ceil(fragments*2/3) 个稳定片段。
 * 片段过短（短正文）时用整段文本做单一片段匹配。
 */
export function contentMatched(apiContent, browserText, targetChars = 60) {
  const apiText = normalizeHtmlText(apiContent);
  if (!apiText) return false;
  const hay = collapseWhitespace(browserText);
  const fragments = extractStableFragments(apiText, targetChars);
  if (fragments.length === 0) {
    // 短正文：整段归一后作为唯一片段（过短 <8 字符视为无实质内容）；剔除裸 URL
    const whole = collapseWhitespace(apiText).replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
    if (whole.length < 8) return false;
    return hay.includes(whole);
  }
  const hits = fragments.filter((f) => hay.includes(f)).length;
  const needed = fragments.length <= 2 ? 1 : Math.ceil(fragments.length * 2 / 3);
  return hits >= needed;
}

/**
 * 确定性抽样：N 条中取 index 0 / 25% / 50% / 75% / N-1。
 * 重复 index 去重后向邻近补齐，最终恰好 sampleSize 个，保持原始数组顺序语义。
 */
export function sampleIndexes(n, sampleSize = 5) {
  if (!Number.isInteger(n) || n <= 0) return [];
  const positions = [0, 0.25, 0.5, 0.75, 1].slice(0, Math.max(sampleSize, 1));
  const raw = positions.map((p) => Math.floor((n - 1) * p));
  const seen = new Set();
  const result = [];
  for (const idx of raw) {
    if (seen.has(idx)) continue;
    seen.add(idx);
    result.push(idx);
  }
  // 去重后不足 sampleSize：从 0..n-1 顺序补最近未选位置；最多只能取满 n 个唯一位置
  for (let idx = 0; idx < n && result.length < sampleSize; idx += 1) {
    if (!seen.has(idx)) {
      seen.add(idx);
      result.push(idx);
    }
  }
  return result.sort((a, b) => a - b).slice(0, Math.min(sampleSize, n));
}

/** 作者归一化（空白折叠 + 常见全角/半角差异容忍） */
export function normalizeAuthor(value) {
  return collapseWhitespace(String(value ?? '')).toLowerCase();
}

export { sleep, loadConfig, ConfigError };
