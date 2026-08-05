/** 官方开放平台客户端（developer.zhihu.com）：仅 search（平台无按问题列回答接口） */
const BASE = 'https://developer.zhihu.com/api/v1';

export async function searchQuestions(keyword, secret, { limit = 10 } = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const url = new URL(`${BASE}/content/zhihu_search`);
  url.searchParams.set('Query', keyword);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Request-Timestamp': String(ts),
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`官方搜索失败: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`官方搜索返回非 JSON: ${text.slice(0, 200)}`); }
  if (parsed.Code !== 0) throw new Error(`官方搜索返回错误: Code=${parsed.Code} ${parsed.Message || ''}`);
  return parsed.Data?.Items || [];
}

export function extractQuestionId(item) {
  const m = String(item.Url || '').match(/question\/(\d+)/);
  return m ? m[1] : null;
}
