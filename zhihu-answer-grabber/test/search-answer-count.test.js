// SPDX-License-Identifier: AGPL-3.0-only
/**
 * T2 — search answer-count enrichment 单元测试（Issue #8 / OPEN-D1
 * APPROVED_BOUNDED_QUESTION_INFO_ENRICHMENT）。
 *
 * 不联网：stub global fetch；loadConfig 与 humanDelay 均注入。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichAnswerCounts, applyAnswerCountEnrichment } from '../src/search-answer-count.js';

const CONFIG = { cookies: { z_c0: 'zc', d_c0: 'dc' }, userAgent: 'UA', zse93: '101_3_3.0' };
const NO_DELAY = async () => {};

/** 对 question-info 请求计数并返回配置好的 fetch stub */
function stubFetchWithInfo({ answerCounts = {}, failQids = new Set(), failStatus = null } = {}) {
  let infoRequests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/api/v4/questions/')) {
      infoRequests += 1;
      const m = u.match(/\/api\/v4\/questions\/([^/?]+)/);
      const qid = m ? m[1] : '';
      if (failQids.has(qid)) {
        return new Response(failStatus ? `{"message":"boom-${failStatus}"}` : '{}', {
          status: failStatus ?? 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const n = answerCounts[qid] ?? 0;
      return new Response(JSON.stringify({ answer_count: n }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected request: ${u}`);
  };
  return {
    count: () => infoRequests,
    restore: () => { globalThis.fetch = original; },
  };
}

// ===== enrichAnswerCounts 单元 =====

test('已知 answer_count → answerCount 为数值，顺序保持', async () => {
  const stub = stubFetchWithInfo({ answerCounts: { '1': 538, '2': 12, '3': 0 } });
  try {
    const inCands = [
      { questionId: '1', title: 'a', contentType: 'question', url: 'https://www.zhihu.com/question/1' },
      { questionId: '2', title: 'b', contentType: 'question', url: 'https://www.zhihu.com/question/2' },
      { questionId: '3', title: 'c', contentType: 'question', url: 'https://www.zhihu.com/question/3' },
    ];
    const out = await enrichAnswerCounts(inCands, CONFIG, { delay: NO_DELAY });
    assert.deepEqual(out.map((c) => c.answerCount), [538, 12, 0], '顺序保持且数值正确');
    assert.deepEqual(out.map((c) => c.questionId), ['1', '2', '3'], 'questionId 顺序不变');
    assert.equal(stub.count(), 3, '3 个候选 → 恰好 3 次 question-info 请求');
  } finally {
    stub.restore();
  }
});

test('单候选 enrichment 失败 → 仅该候选 null，其余正常，search 不失败', async () => {
  const stub = stubFetchWithInfo({ answerCounts: { '1': 5, '2': 7 }, failQids: new Set(['2']) });
  try {
    const out = await enrichAnswerCounts(
      [
        { questionId: '1', title: 'a', contentType: 'question', url: 'https://www.zhihu.com/question/1' },
        { questionId: '2', title: 'b', contentType: 'question', url: 'https://www.zhihu.com/question/2' },
      ],
      CONFIG,
      { delay: NO_DELAY },
    );
    assert.equal(out[0].answerCount, 5);
    assert.equal(out[1].answerCount, null, '失败候选为 null');
    assert.equal(stub.count(), 2, '每候选至多 1 次请求');
  } finally {
    stub.restore();
  }
});

test('响应无 answer_count 字段 / 非数值 → null（不伪造、不显示 0）', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ title: 'no count field' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const out = await enrichAnswerCounts(
      [{ questionId: '1', title: 'a', contentType: 'question', url: 'https://www.zhihu.com/question/1' }],
      CONFIG,
      { delay: NO_DELAY },
    );
    assert.equal(out[0].answerCount, null, '缺失 → null，绝不是 0');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('enrichment 错误信息不泄漏（失败仅产生 null，错误文本不进结果）', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network failed SECRET_TOKEN leaked');
  };
  try {
    const out = await enrichAnswerCounts(
      [{ questionId: '1', title: 'a', contentType: 'question', url: 'https://www.zhihu.com/question/1' }],
      CONFIG,
      { delay: NO_DELAY },
    );
    assert.equal(out[0].answerCount, null);
    assert.ok(!JSON.stringify(out).includes('SECRET'), '错误文本不得进入输出');
  } finally {
    globalThis.fetch = original;
  }
});

test('budget：N 个最终候选 → 至多 N 次 question-info 请求（retries: 0）', async () => {
  const qids = Array.from({ length: 10 }, (_, i) => String(i + 1));
  const answerCounts = Object.fromEntries(qids.map((q) => [q, 100]));
  const stub = stubFetchWithInfo({ answerCounts });
  try {
    const cands = qids.map((q) => ({ questionId: q, title: 't', contentType: 'question', url: `https://www.zhihu.com/question/${q}` }));
    const out = await enrichAnswerCounts(cands, CONFIG, { delay: NO_DELAY });
    assert.equal(stub.count(), 10, '10 候选 → 10 次请求（≤ MAX_EXTRA_REQUESTS_PER_SEARCH=10）');
    assert.ok(out.every((c) => c.answerCount === 100));
  } finally {
    stub.restore();
  }
});

test('HTTP 5xx 失败时 retries:0 → 仍只算 1 次真实 HTTP 尝试', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{"message":"server-busy"}', { status: 503, headers: { 'content-type': 'application/json' } });
  };
  try {
    const out = await enrichAnswerCounts(
      [{ questionId: '1', title: 'a', contentType: 'question', url: 'https://www.zhihu.com/question/1' }],
      CONFIG,
      { delay: NO_DELAY },
    );
    assert.equal(calls, 1, 'retries:0 → 1 次尝试，不重试');
    assert.equal(out[0].answerCount, null);
  } finally {
    globalThis.fetch = original;
  }
});

// ===== applyAnswerCountEnrichment（Cookie 降级语义）=====

test('Cookie 不可用（loadConfig 抛错）→ 全部 answerCount=null，不抛错（Secret-only search 仍成功）', async () => {
  const loadConfigImpl = () => { throw new Error('缺少 Cookie'); };
  const cands = [
    { questionId: '1', title: 'a', contentType: 'question', url: 'https://www.zhihu.com/question/1' },
    { questionId: '2', title: 'b', contentType: 'question', url: 'https://www.zhihu.com/question/2' },
  ];
  const out = await applyAnswerCountEnrichment(cands, { loadConfigImpl, delay: NO_DELAY });
  assert.ok(Array.isArray(out));
  assert.deepEqual(out.map((c) => c.answerCount), [null, null], '全部 null');
  assert.deepEqual(out.map((c) => c.questionId), ['1', '2'], '顺序/字段不变');
});

test('Cookie 可用 → 正常 enrichment；组合降级：单候选失败仅该候选 null', async () => {
  const stub = stubFetchWithInfo({ answerCounts: { '1': 42 }, failQids: new Set(['2']) });
  try {
    const cands = [
      { questionId: '1', title: 'a', contentType: 'question', url: 'https://www.zhihu.com/question/1' },
      { questionId: '2', title: 'b', contentType: 'question', url: 'https://www.zhihu.com/question/2' },
    ];
    const out = await applyAnswerCountEnrichment(cands, { loadConfigImpl: () => CONFIG, delay: NO_DELAY });
    assert.equal(out[0].answerCount, 42);
    assert.equal(out[1].answerCount, null);
    assert.equal(stub.count(), 2);
  } finally {
    stub.restore();
  }
});

test('enrichment 只作用于传入的最终候选（被丢弃 Item 不在列表内 → 不发请求）', async () => {
  const stub = stubFetchWithInfo({ answerCounts: { '9': 3 } });
  try {
    // 模拟 cli 侧 slice 后只把 1 个 final candidate 传入：仅该候选被 enrich
    const out = await applyAnswerCountEnrichment(
      [{ questionId: '9', title: 'keep', contentType: 'question', url: 'https://www.zhihu.com/question/9' }],
      { loadConfigImpl: () => CONFIG, delay: NO_DELAY },
    );
    assert.equal(out[0].answerCount, 3);
    assert.equal(stub.count(), 1, '只有 final candidate 被请求');
  } finally {
    stub.restore();
  }
});
