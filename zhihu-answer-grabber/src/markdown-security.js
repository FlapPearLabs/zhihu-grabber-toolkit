// SPDX-License-Identifier: AGPL-3.0-only
/**
 * markdown-security — V2 Phase 1 安全 Markdown 信任根（纯函数，无网络，无 IO）。
 *
 * 合同来源：docs/specs/v2-rich-content-fidelity.md §8.0 / §8.0.1 / §8.0.2 / §11 / §11.5.1
 *
 * 核心原则：
 *   UNTRUSTED CONTENT ≠ MARKDOWN CONTROL SYNTAX
 *   只有 renderer 自己生成的 Markdown control syntax 具有结构意义；
 *   知乎正文/author/title 中的任意字符串都只是 DATA。
 *
 * 本模块只做确定性字符串/URL 处理，绝不发起任何网络请求。
 */

// ---------------------------------------------------------------------------
// §8.0 escapeUntrustedMarkdownText
// ---------------------------------------------------------------------------

// 能产生 Markdown 结构的字符全集（Spec §8.0 清单）。
// 注意：字符类中 `-` 必须显式转义以免被当作范围。
const MD_CONTROL_RE = /([\\`*_[\]{}()#+.!|>~<\-])/g;

// C0/C1 控制字符（保留 \n \r \t，它们是合法的文本换行）。
// 控制字符可能被某些 renderer 解释成奇怪结构或造成输出污染，确定性替换为 U+FFFD。
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g;

/**
 * 行级结构中和（P1-1）：
 *
 * 字符级转义无法覆盖跨行结构。不可信文本中保留的换行/Tab 可能让用户内容
 * 自己“长成” Markdown 块级结构：
 *   - Setext H1/H2：段落行后紧跟纯 `===`（或 `---`）行；
 *   - indented code block：空行后 4 空格或 Tab 缩进行的行首。
 *
 * 处理（仅针对第二行起的每一行，避免破坏 renderer 自己生成的块语法）：
 *   - 0-3 空格缩进的纯 `=` 行 → 转义第一个 `=`（`\=` 渲染显示 `=`）；
 *     `-` 已在字符级被转义（`---` → `\-\-\-`），Setext H2 / thematic break 均被中和；
 *   - 4 空格或 Tab 行首 → 替换为等量 NBSP（U+00A0）。NBSP 不是空格/Tab，
 *     不计入 Markdown 缩进，不触发 indented code block，且视觉上近似原缩进。
 *
 * 普通正文中的 `a = b` 不受影响（`=` 不参与字符级全局转义）。
 */
function neutralizeLineStructures(s) {
  const lines = s.split('\n');
  if (lines.length <= 1) return s;
  for (let i = 1; i < lines.length; i += 1) {
    let line = lines[i];
    // indented code block 前缀（4 空格或 Tab）→ 等量 NBSP
    const indentMatch = line.match(/^(?: {4,}|\t+)/);
    if (indentMatch) {
      line = '\u00A0'.repeat(indentMatch[0].length) + line.slice(indentMatch[0].length);
    }
    // Setext H1：0-3 空格缩进的纯等号行
    const setext = line.match(/^( {0,3})=+\s*$/);
    if (setext) {
      line = `${setext[1]}\\${line.slice(setext[1].length)}`;
    }
    lines[i] = line;
  }
  return lines.join('\n');
}

/**
 * §8.0 不可信文本 Markdown escaping。
 *
 * 行为合同：任何来自知乎/LLM 的字符串经过本函数后，不能自己产生
 * link / image / heading / list / blockquote / raw HTML / code fence 结构。
 *
 * 实现：对全部 Markdown control 字符加反斜杠前缀。反斜杠转义在 Markdown
 * 渲染时不可见（`\#` 显示为 `#`），因此不会破坏阅读性，同时保证输入
 * 永远无法“长成”结构语法。
 *
 * @param {unknown} value 不可信字符串
 * @returns {string} 惰性文本（inert text）
 */
export function escapeUntrustedMarkdownText(value) {
  if (value == null) return '';
  const s = String(value);
  const escaped = s.replace(MD_CONTROL_RE, '\\$1').replace(CONTROL_RE, '\uFFFD');
  return neutralizeLineStructures(escaped);
}

// ---------------------------------------------------------------------------
// §8.0.1 / §8.0.2 bare URL tokenizer（不依赖 HTML 的 URL span 检测）
// ---------------------------------------------------------------------------

const BARE_URL_RE = /https?:\/\/[^\s<>"'`|{}[\]\\]+/gi;

// 可修剪的 ASCII 尾标点（不构成 URL 一部分）
const TRAILING_PUNCT_ASCII = new Set(['.', ',', ';', ':', '!', '?', '"', "'"]);
// 中文/全角标点（URL 中几乎不可能出现，作为文本结束边界修剪）
const TRAILING_PUNCT_FULLWIDTH = new Set([
  '。', '，', '、', '；', '：', '！', '？', '…', '‥',
  '」', '』', '）', '】', '》', '〉', '］', '｝', '"', '\'',
  '「', '『', '（', '【', '《', '〈', '［', '｛',
]);

/** 修剪 URL 尾部标点：ASCII 成对括号只保留配平部分，其余标点/全角标点去掉 */
function trimTrailingPunct(raw) {
  let s = raw;
  for (let guard = 0; guard < s.length; guard += 1) {
    const last = s[s.length - 1];
    if (last === undefined) break;
    if (last === ')' || last === ']' || last === '}') {
      const open = last === ')' ? '(' : last === ']' ? '[' : '{';
      let opens = 0;
      let closes = 0;
      for (const ch of s) {
        if (ch === open) opens += 1;
        else if (ch === last) closes += 1;
      }
      if (opens >= closes) break; // 括号配平，保留
      s = s.slice(0, -1);
      continue;
    }
    if (TRAILING_PUNCT_ASCII.has(last) || TRAILING_PUNCT_FULLWIDTH.has(last)) {
      s = s.slice(0, -1);
      continue;
    }
    break;
  }
  return s;
}

/**
 * §8.0.2 不可信文本 → URL span 检测。
 *
 * 返回 span 数组：`{ type: 'text', text }` 或 `{ type: 'url', url }`。
 * 不做任何 escape（escape 由调用方对非 URL span 执行），
 * 不做任何安全判定（判定由 sanitizer/classifier 执行）。
 *
 * @param {unknown} value
 * @returns {Array<{type: 'text', text: string} | {type: 'url', url: string}>}
 */
export function tokenizeBareUrls(value) {
  const s = value == null ? '' : String(value);
  const spans = [];
  let cursor = 0;
  BARE_URL_RE.lastIndex = 0;
  for (let m = BARE_URL_RE.exec(s); m !== null; m = BARE_URL_RE.exec(s)) {
    const start = m.index;
    const matched = m[0];
    const trimmed = trimTrailingPunct(matched);
    if (trimmed.length === 0) {
      // 剪没了（异常输入），整段当普通文本
      spans.push({ type: 'text', text: s.slice(cursor, start + matched.length) });
      cursor = start + matched.length;
      continue;
    }
    if (start > cursor) spans.push({ type: 'text', text: s.slice(cursor, start) });
    spans.push({ type: 'url', url: trimmed });
    // 被修剪掉的部分属于普通文本
    if (start + matched.length > start + trimmed.length) {
      spans.push({ type: 'text', text: s.slice(start + trimmed.length, start + matched.length) });
    }
    cursor = start + matched.length;
  }
  if (cursor < s.length) spans.push({ type: 'text', text: s.slice(cursor) });
  if (spans.length === 0 && s.length === 0) return [];
  return spans;
}

// ---------------------------------------------------------------------------
// §11 URL sanitizer / classifier
// ---------------------------------------------------------------------------

// 私有/回环/link-local IP 判定（IPv4 + IPv6）。
// 全部基于数值计算，不用字符串 includes/endsWith 判断安全域。

function isPrivateIPv4(a, b, c, d) {
  // 10/8
  if (a === 10) return true;
  // 172.16/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168/16
  if (a === 192 && b === 168) return true;
  // 127/8 回环
  if (a === 127) return true;
  // 169.254/16 link-local
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 未指定/当前网络（含 0.0.0.0 自身）
  if (a === 0) return true;
  // 100.64/10 CGNAT（运营商级 NAT 共享地址，视为私有）
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.0/24、192.0.2/24、198.18/15、198.51.100/24、203.0.113/24 等保留/文档/基准段
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  // 224/4 组播
  if (a >= 224 && a <= 239) return true;
  // 240/4 保留 + 255.255.255.255
  if (a >= 240) return true;
  return false;
}

function parseIPv4(host) {
  // 纯点分十进制 IPv4（WHATWG URL 的 IPv4 形态）
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function isPrivateIPv6(host) {
  // host 形态：无 zone index、无方括号（调用方已处理），小写。
  // ::1 回环
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  // :: 未指定
  if (host === '::' || host === '0:0:0:0:0:0:0:0') return true;
  // IPv4-mapped IPv6：点分形式 ::ffff:127.0.0.1
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) {
    const v4 = parseIPv4(mapped[1].toLowerCase());
    if (v4) return isPrivateIPv4(...v4);
    return true; // 解析失败按保守拒绝
  }
  // IPv4-mapped IPv6：hex 形式 ::ffff:7f00:1（WHATWG URL 会规范化成该形态）
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const a = Number.parseInt(mappedHex[1], 16);
    const b = Number.parseInt(mappedHex[2], 16);
    const v4 = [a >> 8, a & 0xff, b >> 8, b & 0xff];
    if (isPrivateIPv4(...v4)) return true;
    return false;
  }
  // 按第一组 16-bit 判定前缀范围（数值计算，覆盖压缩表示如 fc00::1）
  const first = (host.split(':')[0] || '').toLowerCase();
  if (/^[0-9a-f]{1,4}$/.test(first)) {
    const v = Number.parseInt(first, 16);
    // fc00::/7 ULA（私有）
    if (v >= 0xfc00 && v < 0xfe00) return true;
    // fe80::/10 link-local
    if (v >= 0xfe80 && v <= 0xfebf) return true;
    // ff00::/8 组播
    if (v >= 0xff00) return true;
  }
  return false;
}

/** hostname 是否属于回环/私有/link-local（含 IP 字面量与 localhost 名） */
function isRestrictedHost(hostname) {
  let host = String(hostname).toLowerCase();
  // WHATWG URL.hostname 对 IPv6 保留方括号（如 [::1]），去掉以做数值判定
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  // 去除 IPv6 的尾部 zone（理论上 URL parser 会拒绝 zone，防御处理）
  const cleanHost = host.includes('%') ? host.split('%')[0] : host;
  // localhost 系列名（含尾点规范化后的形式；`*.localhost` 亦属本机解析域）
  const hostNoDot = cleanHost.endsWith('.') ? cleanHost.slice(0, -1) : cleanHost;
  if (hostNoDot === 'localhost') return true;
  if (hostNoDot.endsWith('.localhost')) return true;
  // 含非 [a-z0-9.-] 字符则不是正常域名/IP（如 IPv6 的 ':'）
  if (/^[0-9a-f.:]+$/.test(hostNoDot)) {
    if (hostNoDot.includes(':')) {
      if (isPrivateIPv6(hostNoDot)) return true;
    } else {
      const v4 = parseIPv4(hostNoDot);
      if (v4) return isPrivateIPv4(...v4);
    }
    return false; // 合法公网数字域名或已判定公网 IPv4/IPv6
  }
  // 正常域名：检查是否残留 control 字符（防御）
  if (/[\u0000-\u001F\u007F]/.test(host)) return true;
  return false;
}

/** URL 字符串是否含控制字符（任何位置，拒绝） */
function hasControlChars(raw) {
  return /[\u0000-\u001F\u007F]/.test(String(raw));
}

/** 是否精确等于 link.zhihu.com（知乎外链 redirect host） */
function isZhihuRedirectHost(hostname) {
  const h = String(hostname).toLowerCase();
  return h === 'link.zhihu.com' || h === 'link.zhihu.com.';
}

/** 从 link.zhihu.com URL 中解出 target 参数（确定性） */
export function extractZhihuRedirectTarget(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  if (!isZhihuRedirectHost(parsed.hostname)) return null;
  const target = parsed.searchParams.get('target');
  if (typeof target !== 'string' || target.length === 0) return null;
  return target;
}

/**
 * §11 URL sanitizer / classifier。
 *
 * 判定基于 WHATWG URL parser（Node 内置 `URL`）+ 显式 IP/host 校验，
 * 禁止字符串前缀匹配作为唯一手段。
 *
 * @param {unknown} rawUrl 原始 URL（可能来自 <a href> 或裸 URL span）
 * @returns {null | {
 *   clickable: boolean,
 *   securityClass: string,
 *   canonicalUrl: string,
 *   displayHost: string,
 *   reason: string,
 *   zhihuRedirect?: { targetUrl: string, clickable: boolean }
 * }}
 *   clickable=true 表示允许作为可点击链接渲染（仅 https: + 公网 host + 无 userinfo）。
 *   securityClass 表示分类，不表示信任；公网 https 一律 external_unverified。
 *   无法解析/拒绝时返回 null（调用方按 inert text 处理）。
 */
export function classifyUrl(rawUrl) {
  const raw = rawUrl == null ? '' : String(rawUrl);
  if (raw.length === 0) return null;
  if (hasControlChars(raw)) return null;

  // link.zhihu.com redirect：解出 target，target 必须再走完整 sanitizer
  const redirectTarget = extractZhihuRedirectTarget(raw);
  if (redirectTarget !== null) {
    const inner = classifyUrl(redirectTarget);
    if (inner === null) {
      return null;
    }
    return {
      clickable: inner.clickable,
      securityClass: inner.securityClass,
      canonicalUrl: inner.canonicalUrl,
      displayHost: inner.displayHost,
      reason: `zhihu_redirect_target:${inner.reason}`,
      zhihuRedirect: { targetUrl: inner.canonicalUrl, clickable: inner.clickable },
    };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null; // 无法被标准 parser 解析 → 拒绝
  }

  // 协议：第一版 clickable 只允许 https:
  if (parsed.protocol !== 'https:') {
    return null;
  }

  // userinfo：user:pass@host 拒绝
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  // host 缺失/空
  if (hostname.length === 0) {
    return null;
  }

  // 回环 / 私有 / link-local 拒绝
  if (isRestrictedHost(hostname)) {
    return null;
  }

  // link.zhihu.com 本身不允许作为最终目标（redirect host ≠ 最终安全目标；
  // 无 target 参数的 link.zhihu.com 直接拒绝）
  if (isZhihuRedirectHost(hostname)) {
    return null;
  }

  return {
    clickable: true,
    securityClass: 'external_unverified',
    canonicalUrl: parsed.href,
    displayHost: hostname,
    reason: 'https_public',
  };
}

// ---------------------------------------------------------------------------
// §11.5.1 safeMarkdownDestination
// ---------------------------------------------------------------------------

// 需要 percent-encode 才能安全进入 Markdown destination 的字符：
//   ( ) < > \ 空白 控制字符
// 使用 WHATWG percent-encode（UTF-8）。对 ASCII 单字节直接 %XX。
function percentEncodeByte(code) {
  return '%' + code.toString(16).toUpperCase().padStart(2, '0');
}

function shouldEncodeDestinationChar(ch) {
  const code = ch.codePointAt(0);
  if (code <= 0x1f || code === 0x7f) return true; // 控制字符（含 \n \r \t）
  if (code === 0x20) return true; // 空格
  if (ch === '(' || ch === ')') return true;
  if (ch === '<' || ch === '>') return true;
  if (ch === '\\') return true;
  if (code === 0x22 || code === 0x27) return true; // " '
  return false;
}

/**
 * §11.5.1 Markdown destination serializer。
 *
 * 输入：已通过 §11 URL policy 的 canonical URL（WHATWG href）。
 * 输出：安全字符串，可直接放入 `[label](<output>)`，不会破坏 Markdown
 * link/image 语法结构。
 *
 * 处理：`( ) < > \`、空白、控制字符、`" '` 全部 percent-encode；
 * 展示域名由调用方使用 canonical ASCII hostname（本函数不负责展示域名）。
 *
 * 注意：本函数只处理 URL→destination 序列化边界；与 URL policy
 * （classifyUrl）是两个独立安全边界，必须分别测试。
 *
 * @param {string} canonicalUrl
 * @returns {string}
 */
export function safeMarkdownDestination(canonicalUrl) {
  const s = canonicalUrl == null ? '' : String(canonicalUrl);
  let out = '';
  for (const ch of s) {
    out += shouldEncodeDestinationChar(ch) ? percentEncodeByte(ch.codePointAt(0)) : ch;
  }
  return out;
}
