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

// ===== URL trust boundary（P1-A：page.goto 前的确定性校验） =====

const ZHI_HTTPS_HOST = 'www.zhihu.com';

/**
 * 校验「应打开的 answer 页面 URL」是否落在信任边界内。
 *
 * 信任边界（全部必须满足，否则拒绝，绝不发出浏览器请求）：
 *   - 可被 WHATWG URL parser 正常解析
 *   - protocol === 'https:'
 *   - hostname === 'www.zhihu.com'（精确匹配；evilwww.zhihu.com、www.zhihu.com.evil.com 均拒绝）
 *   - port 为空或 443
 *   - 无 username / password（禁止 userinfo）
 *   - pathname（去尾部斜杠）精确等于 /question/<expectedQuestionId>/answer/<expectedAnswerId>
 *
 * 返回 { ok: true, url } 或 { ok: false, reason }。reason 为确定性的短标识。
 */
export function classifyAnswerUrl(rawUrl, expectedQuestionId, expectedAnswerId) {
  if (rawUrl == null) return { ok: false, reason: 'url_missing' };
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: 'url_unparsable' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'protocol_not_https' };
  if (parsed.hostname !== ZHI_HTTPS_HOST) return { ok: false, reason: 'host_not_zhihu' };
  if (parsed.port !== '' && parsed.port !== '443') return { ok: false, reason: 'port_not_https' };
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'url_has_userinfo' };
  const expectedPath = `/question/${String(expectedQuestionId)}/answer/${String(expectedAnswerId)}`;
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path !== expectedPath) {
    if (!path.startsWith('/question/')) return { ok: false, reason: 'path_not_answer' };
    return { ok: false, reason: 'path_mismatch' };
  }
  return { ok: true, url: parsed.href };
}

/**
 * 单条 answer 的「是否可导航」决策：封装 classifyAnswerUrl + id 归一。
 * 供 browser-smoke.mjs 在 page.goto() 前调用；ok=false 时绝不允许导航。
 * 纯函数，可离线测试「恶意 answers.json URL 被拒」。
 */
export function classifyAnswerCheck(answer, questionId) {
  const answerId = String(answer?.id ?? '');
  const rawUrl = answer?.url ?? null;
  const classified = classifyAnswerUrl(rawUrl, questionId, answerId);
  return {
    answerId,
    ok: classified.ok,
    url: classified.ok ? classified.url : null,
    reason: classified.ok ? null : classified.reason,
  };
}

/** redirect 后 finalUrl 的同一信任边界校验（独立别名，语义相同） */
export const classifyFinalUrl = classifyAnswerUrl;

// ===== CLI exit semantics（P1-B：inconclusive 不得 exit 0） =====

/**
 * shell exit code 合同：
 *   0 = pass
 *   1 = fail / mismatch
 *   2 = inconclusive / environment unavailable / 配置与运行错误
 */
export function exitCodeForResult(result) {
  if (result === 'pass') return 0;
  if (result === 'fail') return 1;
  return 2; // inconclusive / unknown
}

// ===== --sample 静态校验（P2：硬上限，避免无限放大请求面） =====

/** --sample 合法范围：整数 1-20，默认 5；其余一律 invalid */
export function parseSampleSize(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { ok: true, value: 5 };
  }
  const n = Number(rawValue);
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    return { ok: false, reason: 'invalid_sample' };
  }
  return { ok: true, value: n };
}

export { sleep, loadConfig, ConfigError };
