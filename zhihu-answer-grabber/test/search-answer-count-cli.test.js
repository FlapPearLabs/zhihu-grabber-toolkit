// SPDX-License-Identifier: AGPL-3.0-only
/**
 * T2 — CLI / 集成层测试（Issue #8 Required tests，P1-2 repair）。
 *
 * 通过最小依赖注入（cmdSearch deps，默认生产实现）+ 受控 fetch stub 验证
 * 完整 search 命令合同的自动化覆盖；不真实联网。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmdSearch } from '../src/cli.js';

const CONFIG = { cookies: { z_c0: 'zc', d_c0: 'dc' }, userAgent: 'UA', zse93: '101_3_3.0' };

function makeItem(id, { type = 'question' } = {}) {
  return { Url: `https://www.zhihu.com/question/${id}`, Title: `题目${id}`, ContentType: type };
}

/** 受控 fetch stub：search（developer.zhihu.com）与 question-info（www.zhihu.com）分开处理 */
function stubFetch({ items, answerCounts = {}, failQids = new Set(), failStatus = null } = {}) {
  let infoRequests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/v1/content/zhihu_search')) {
      return new Response(JSON.stringify({ Code: 0, Data: { Items: items } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/api/v4/questions/')) {
      infoRequests += 1;
      const m = u.match(/\/api\/v4\/questions\/([^/?]+)/);
      const qid = m ? m[1] : '';
      if (failQids.has(qid)) {
        return new Response(JSON.stringify({ message: 'server-error' }), {
          status: failStatus ?? 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      const n = answerCounts[qid];
      return new Response(JSON.stringify({ answer_count: n }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return { infoRequests: () => infoRequests, restore: () => { globalThis.fetch = original; } };
}

/** 捕获 cmdSearch 写入 stdout 的人类/JSON 输出；统一注入无延迟（测试不等待 humanDelay） */
async function runSearch(opts) {
  const deps = opts.deps || {};
  const effective = {
    ...opts,
    deps: {
      ...deps,
      enrichmentOptions: { delay: async () => {}, ...(deps.enrichmentOptions || {}) },
    },
  };
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk, ...rest) => {
    out += chunk;
    return true;
  };
  try {
    const result = await cmdSearch('测试关键词', effective);
    return { result, out };
  } finally {
    process.stdout.write = original;
  }
}

const baseDeps = { resolveSecretImpl: () => 'test-secret', loadConfigImpl: () => CONFIG };

// ===== 1. 完整 search JSON 成功路径 =====

test('CLI: JSON 成功路径 — answerCount:number 且既有字段语义保持', async () => {
  const stub = stubFetch({
    items: [makeItem('1'), makeItem('2'), makeItem('3')],
    answerCounts: { '1': 538, '2': 12, '3': 0 },
  });
  try {
    const { result, out } = await runSearch({ json: true, deps: baseDeps });
    assert.equal(result.candidates.length, 3);
    const [c0, c1, c2] = result.candidates;
    assert.deepEqual(
      Object.keys(c0),
      ['questionId', 'title', 'answerCount', 'contentType', 'url'],
      '候选字段顺序与形状符合 #8 contract',
    );
    assert.equal(c0.questionId, '1');
    assert.equal(c0.title, '题目1');
    assert.equal(c0.answerCount, 538);
    assert.equal(c0.contentType, 'question');
    assert.equal(c0.url, 'https://www.zhihu.com/question/1');
    assert.equal(c1.answerCount, 12);
    assert.equal(c2.answerCount, 0, '真实 0 保留为 0（不是未知）');
    // stdout 是单一合法 JSON 文档且含 answerCount
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, 'search');
    assert.equal(parsed.candidates[0].answerCount, 538);
  } finally {
    stub.restore();
  }
});

// ===== 2. Secret usable + Cookie unavailable =====

test('CLI: Secret usable + Cookie unavailable → search 成功 + 全部 null（非 configuration_error）', async () => {
  const stub = stubFetch({ items: [makeItem('1'), makeItem('2')], answerCounts: { '1': 5, '2': 6 } });
  try {
    const { result, out } = await runSearch({
      json: true,
      deps: { resolveSecretImpl: () => 'test-secret', loadConfigImpl: () => { throw new Error('缺少 Cookie'); } },
    });
    assert.equal(result.candidates.length, 2);
    assert.ok(result.candidates.every((c) => c.answerCount === null), 'Cookie 不可用 → 全部 null');
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true, 'search 必须成功');
    assert.ok(!parsed.error, '不得 configuration_error');
    assert.equal(parsed.candidates[0].answerCount, null);
  } finally {
    stub.restore();
  }
});

// ===== 3. human 输出 =====

test('CLI: human known → 「回答数：N」；unknown → 「回答数：未知」（绝不为 0）', async () => {
  const stub = stubFetch({
    items: [makeItem('1'), makeItem('2')],
    answerCounts: { '1': 538 },
    failQids: new Set(['2']), // 候选 2 enrichment 失败 → 未知
  });
  try {
    const { out } = await runSearch({ json: false, deps: baseDeps });
    // 两条候选：id 1 已知 538，id 2 enrichment 失败 → 未知
    assert.ok(out.includes('回答数：538'), 'known 显示数值');
    assert.ok(out.includes('回答数：未知'), 'unknown 显示未知');
    assert.ok(!/回答数：0/.test(out), 'unknown 不得显示为 0');
  } finally {
    stub.restore();
  }
});

test('CLI: human 真实 count=0 → 显示「回答数：0」（不是未知）', async () => {
  const stub = stubFetch({ items: [makeItem('1')], answerCounts: { '1': 0 } });
  try {
    const { out } = await runSearch({ json: false, deps: baseDeps });
    assert.ok(out.includes('回答数：0'), '真实 0 显示 0');
    assert.ok(!out.includes('回答数：未知'), '0 不得被当作未知');
  } finally {
    stub.restore();
  }
});

// ===== 4. dedupe + slice 之后才 enrichment =====

test('CLI: enrichment 只发生在 dedupe + slice 之后的 final candidates（12 唯一 → 10 请求；重复不请求）', async () => {
  // 13 个 items：id 1–12 各一次 + id 1 重复一次 → dedupe 12 唯一 → slice 10
  const items = Array.from({ length: 12 }, (_, i) => makeItem(String(i + 1)));
  items.push(makeItem('1')); // 重复 id
  const answerCounts = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), 100]));
  const stub = stubFetch({ items, answerCounts });
  try {
    const { result } = await runSearch({ json: true, deps: baseDeps });
    assert.equal(result.candidates.length, 10, 'slice(0,10) 后 10 个 final candidates');
    assert.equal(stub.infoRequests(), 10, '恰好 10 次 question-info 请求（只对 final candidates）');
  } finally {
    stub.restore();
  }
});

// ===== 5. search 不带 --grab =====

test('CLI: search 不带 --grab → 不触发任何抓取控制流', async () => {
  const stub = stubFetch({ items: [makeItem('1')], answerCounts: { '1': 5 } });
  try {
    let grabCalled = false;
    const { result, out } = await runSearch({
      json: false,
      deps: {
        ...baseDeps,
        cmdGrabImpl: async () => { grabCalled = true; },
      },
    });
    assert.equal(result.candidates.length, 1);
    assert.equal(grabCalled, false, '无 --grab 不得调用抓取');
    assert.ok(out.includes('回答数：5'));
  } finally {
    stub.restore();
  }
});

// ===== 6. --grab 原控制流 =====

test('CLI: --grab 仍选择第一个结果进入 grab；answerCount=null（enrichment 全失败）不阻止 grab', async () => {
  const stub = stubFetch({ items: [makeItem('11'), makeItem('22')], failQids: new Set(['11', '22']) });
  try {
    let grabbed = null;
    const { out } = await runSearch({
      json: false,
      grab: true,
      deps: {
        ...baseDeps, // Cookie 可用；enrichment 全部失败 → 全 null
        cmdGrabImpl: async (config, id) => { grabbed = id; },
      },
    });
    assert.equal(grabbed, '11', 'enrichment 后仍选择第一个结果（unique[0]）进入 grab');
    assert.ok(out.includes('回答数：未知'), 'enrichment 失败 → 未知');
  } finally {
    stub.restore();
  }
});

test('CLI: --grab（Cookie 可用）→ enrichment 后仍选第一个结果且 Cookie 路径正常', async () => {
  const stub = stubFetch({ items: [makeItem('7'), makeItem('8')], answerCounts: { '7': 42, '8': 9 } });
  try {
    let grabbed = null;
    await runSearch({
      json: false,
      grab: true,
      deps: {
        ...baseDeps,
        cmdGrabImpl: async (config, id) => { grabbed = id; assert.equal(config, CONFIG, 'Cookie config 传给 grab'); },
      },
    });
    assert.equal(grabbed, '7');
  } finally {
    stub.restore();
  }
});

// ===== 7. enrichment failure 的 CLI / machine surface =====

test('CLI: 单候选 enrichment 失败 → 仅该候选 null；原始 error/Secret/Cookie 不进 stdout/stderr/candidate', async () => {
  const stub = stubFetch({
    items: [makeItem('1'), makeItem('2'), makeItem('3')],
    answerCounts: { '1': 100, '2': 200, '3': 300 },
    failQids: new Set(['2']),
  });
  try {
    const originalErr = process.stderr.write;
    let errOut = '';
    process.stderr.write = (chunk, ...rest) => { errOut += chunk; return true; };
    let result;
    let out;
    try {
      ({ result, out } = await runSearch({
        json: true,
        deps: { resolveSecretImpl: () => 'SECRET-TOKEN-XYZ', loadConfigImpl: () => CONFIG },
      }));
    } finally {
      process.stderr.write = originalErr;
    }
    assert.equal(result.candidates[0].answerCount, 100);
    assert.equal(result.candidates[1].answerCount, null, '失败候选 → null');
    assert.equal(result.candidates[2].answerCount, 300, '其余候选正常');
    assert.equal(stub.infoRequests(), 3, '每候选至多 1 次尝试');
    assert.ok(!out.includes('SECRET-TOKEN-XYZ'), 'Secret 不得进 stdout JSON');
    assert.ok(!out.includes('server-error'), '原始 error 不得进 stdout JSON');
    assert.ok(!out.includes('z_c0') && !out.includes('dc'), 'Cookie 值不得进 stdout');
    assert.equal(errOut, '', 'stderr 无泄漏');
  } finally {
    stub.restore();
  }
});
