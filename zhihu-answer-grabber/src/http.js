// SPDX-License-Identifier: AGPL-3.0-only
import { signRequest } from './signer.js';

/** 允许携带认证头（Cookie / x-zse-96 签名）的目标主机白名单 */
const AUTHENTICATED_HOSTS = new Set(['www.zhihu.com']);
/** 响应体上限：10MB，防止异常大响应拖垮内存 */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** 校验目标 URL 是受信知乎 HTTPS 主机，防止把 Cookie/签名外发给任意域名 */
function assertAuthenticatedTarget(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TypeError(`非法 URL，拒绝携带认证头: ${String(rawUrl).slice(0, 100)}`);
  }
  if (
    url.protocol !== 'https:'
    || !AUTHENTICATED_HOSTS.has(url.hostname)
    || url.username
    || url.password
  ) {
    throw new TypeError(`拒绝向非知乎 HTTPS 目标发送认证头: ${url.origin}`);
  }
  return url;
}

/** 从响应头读取 Retry-After（秒），无则返回 null */
function retryAfterMs(response) {
  const raw = response?.headers?.get('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? Math.min(secs * 1000, 30_000) : null;
}

const ANSWERS_INCLUDE = 'data[*].is_normal,admin_closed_comment,reward_info,is_collapsed,annotation_action,annotation_detail,collapse_reason,is_sticky,collapsed_by,suggest_edit,comment_count,can_comment,content,editable_content,attachment,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,relevant_info,question,excerpt,is_labeled,paid_info,paid_info_content,relationship.is_authorized,is_author,voting,is_thanked,is_nothelp,is_favorited,is_orgmember,author.badge_info[*].topics;author.vip_info';

// V2 Phase 3：detail（问题描述 HTML）与 topics（话题数组）加入问题元信息 include。
// 实测（schema discovery, 2026-08-10）：该端点的 include 是严格字段白名单，
// detail/topics 必须位于 include 字符串前部才会被返回（放在 author.name 之后会被丢弃）。
const QUESTION_INCLUDE = 'detail,topics,title,answer_count,comment_count,follower_count,excerpt,author.name';

export function cookieHeader(cookies) {
  return Object.entries(cookies)
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** 构建带 x-zse-96 签名的请求头（对齐 zhihu-cli 的 web 通道行为） */
export function buildSignedHeaders(config, url, { referer, bodyText = null } = {}) {
  const target = assertAuthenticatedTarget(url);
  const headers = {
    'user-agent': config.userAgent,
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'fetch',
    'x-zse-93': config.zse93,
  };
  const cookie = cookieHeader(config.cookies || {});
  if (cookie) headers.cookie = cookie;
  if (config.cookies?._xsrf) headers['x-xsrftoken'] = config.cookies._xsrf;
  headers['x-zse-96'] = signRequest(target.toString(), config.cookies?.d_c0 || '', bodyText, config.zse93);
  if (referer) headers.referer = referer;
  return headers;
}

export function buildAnswersUrl(qid, offset, limit = 20) {
  const u = new URL(`https://www.zhihu.com/api/v4/questions/${qid}/answers`);
  u.searchParams.set('include', ANSWERS_INCLUDE);
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('offset', String(offset));
  return u.toString();
}

export function buildQuestionInfoUrl(qid) {
  const u = new URL(`https://www.zhihu.com/api/v4/questions/${qid}`);
  u.searchParams.set('include', QUESTION_INCLUDE);
  return u.toString();
}

/** 随机延迟（模拟真人浏览节奏），默认 1.5–4s */
export function humanDelay(min = 1500, max = 4000) {
  return new Promise((resolve) => {
    const ms = Math.floor(min + Math.random() * (max - min));
    setTimeout(resolve, ms);
  });
}

export class HttpError extends Error {
  constructor(message, { status, url, snippet } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.snippet = snippet;
  }
}

/** 指数退避 + 随机抖动；优先遵循 Retry-After */
function backoffDelay(attempt, retryAfter) {
  if (retryAfter != null) return retryAfter;
  const base = 1000 * (2 ** attempt); // 1s, 2s, 4s, ...
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(base + jitter, 30_000);
}

/** 发起签名 GET 请求并解析 JSON；429/5xx 指数退避重试（最多 retries 次重试） */
export async function requestJson(config, url, { retries = 2, referer, timeoutMs = 20_000 } = {}) {
  const target = assertAuthenticatedTarget(url).toString();
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(target, {
        method: 'GET',
        headers: buildSignedHeaders(config, target, { referer }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffDelay(attempt, null)));
        continue;
      }
      throw new HttpError(`网络请求失败: ${error.message}`, { url: target });
    }
    if (response.ok) {
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new HttpError(`响应体过大 (${contentLength} 字节)，超过上限 ${MAX_RESPONSE_BYTES}`, { status: response.status, url: target });
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new HttpError('响应体超过上限 10MB，已中止', { status: response.status, url: target });
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError('知乎返回了无法解析的 JSON', { status: response.status, url: target, snippet: text.slice(0, 200) });
      }
    }
    const retryAfter = retryAfterMs(response);
    if (attempt < retries && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, backoffDelay(attempt, retryAfter)));
      continue;
    }
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 忽略 */ }
    // 401/403 只陈述事实与候选，不把未经验证原因写成结论（与 SKILL.md 诊断合同一致）
    let hint = '';
    if (response.status === 401) {
      hint = '知乎返回 HTTP 401。认证请求未被接受；可能与本地凭据或当前认证要求有关，具体原因尚未确定。';
    } else if (response.status === 403) {
      hint = '知乎返回 HTTP 403。请求被服务器拒绝；可能涉及凭据、签名协议、请求上下文、账号权限或风控，具体原因尚未确定。';
    }
    throw new HttpError(`知乎请求失败: HTTP ${response.status}${parsed?.message ? ` ${parsed.message}` : ''}${hint ? `；${hint}` : ''}`, {
      status: response.status,
      url: target,
      snippet: parsed ? JSON.stringify(parsed).slice(0, 300) : text.slice(0, 300),
    });
  }
  throw lastError instanceof Error ? lastError : new HttpError('请求重试流程异常结束', { url: target });
}
