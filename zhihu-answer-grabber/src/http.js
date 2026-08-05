import { signRequest } from './signer.js';

const ANSWERS_INCLUDE = 'data[*].is_normal,admin_closed_comment,reward_info,is_collapsed,annotation_action,annotation_detail,collapse_reason,is_sticky,collapsed_by,suggest_edit,comment_count,can_comment,content,editable_content,attachment,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,relevant_info,question,excerpt,is_labeled,paid_info,paid_info_content,relationship.is_authorized,is_author,voting,is_thanked,is_nothelp,is_favorited,is_orgmember,author.badge_info[*].topics;author.vip_info';

const QUESTION_INCLUDE = 'title,answer_count,comment_count,follower_count,excerpt,author.name';

export function cookieHeader(cookies) {
  return Object.entries(cookies)
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** 构建带 x-zse-96 签名的请求头（对齐 zhihu-cli 的 web 通道行为） */
export function buildSignedHeaders(config, url, { referer, bodyText = null } = {}) {
  const headers = {
    'user-agent': config.userAgent,
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'fetch',
    'x-zse-93': config.zse93,
  };
  const cookie = cookieHeader(config.cookies || {});
  if (cookie) headers.cookie = cookie;
  if (config.cookies?._xsrf) headers['x-xsrftoken'] = config.cookies._xsrf;
  headers['x-zse-96'] = signRequest(url, config.cookies?.d_c0 || '', bodyText, config.zse93);
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

/** 发起签名 GET 请求并解析 JSON；429/5xx 指数退避重试 */
export async function requestJson(config, url, { retries = 2, referer, timeoutMs = 20_000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: buildSignedHeaders(config, url, { referer }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (2 ** attempt)));
        continue;
      }
      throw new HttpError(`网络请求失败: ${error.message}`, { url });
    }
    if (response.ok) {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError('知乎返回了无法解析的 JSON', { status: response.status, url, snippet: text.slice(0, 200) });
      }
    }
    if (attempt < retries && (response.status === 429 || response.status >= 500)) {
      await new Promise((r) => setTimeout(r, 500 * (2 ** attempt)));
      continue;
    }
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 忽略 */ }
    const hint = response.status === 401
      ? '凭证已失效，请重新执行 zhihu-cli login --qrcode'
      : response.status === 403
        ? '请求被知乎风控拦截（403）：请确认本机 IP 未被风控，或稍后再试'
        : '';
    throw new HttpError(`知乎请求失败: HTTP ${response.status}${parsed?.message ? ` ${parsed.message}` : ''}${hint ? `；${hint}` : ''}`, {
      status: response.status,
      url,
      snippet: parsed ? JSON.stringify(parsed).slice(0, 300) : text.slice(0, 300),
    });
  }
  throw lastError instanceof Error ? lastError : new HttpError('请求重试流程异常结束', { url });
}
