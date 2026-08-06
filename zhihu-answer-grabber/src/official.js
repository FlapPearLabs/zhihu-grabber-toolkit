// SPDX-License-Identifier: AGPL-3.0-only
/** 官方开放平台客户端（developer.zhihu.com）：仅 search（平台无按问题列回答接口） */
const BASE = 'https://developer.zhihu.com/api/v1';

/** 移除终端控制字符（ANSI 注入防护），保留换行/制表符 */
function terminalSafe(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

export async function searchQuestions(keyword, secret, { limit = 10 } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const url = new URL(`${BASE}/content/zhihu_search`);
  url.searchParams.set('Query', keyword);
  url.searchParams.set('limit', String(limit));
  let lastError = null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    let res;
    try {
      res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${secret}`,
          'X-Request-Timestamp': String(ts),
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (2 ** attempt)));
        continue;
      }
      throw new Error(`官方搜索网络失败: ${error.message}`);
    }
    if (!res.ok && (res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (2 ** attempt)));
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`官方搜索失败: HTTP ${res.status} ${terminalSafe(text.slice(0, 200))}`);
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error(`官方搜索返回非 JSON: ${terminalSafe(text.slice(0, 200))}`); }
    if (parsed.Code !== 0) throw new Error(`官方搜索返回错误: Code=${parsed.Code} ${terminalSafe(parsed.Message || '')}`);
    return parsed.Data?.Items || [];
  }
  throw lastError instanceof Error ? lastError : new Error('官方搜索重试流程异常结束');
}

export function extractQuestionId(item) {
  try {
    const url = new URL(String(item.Url || ''));
    if (!['www.zhihu.com', 'zhihu.com'].includes(url.hostname)) return null;
    const m = url.pathname.match(/^\/question\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
