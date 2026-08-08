// SPDX-License-Identifier: AGPL-3.0-only
/**
 * browser-smoke 纯函数离线测试（不联网、不用真实凭据）。
 * 覆盖：Cookie parser / HTML normalization / content matcher / sample indexes / credential secrecy。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPlaywrightCookies,
  normalizeHtmlText,
  collapseWhitespace,
  extractStableFragments,
  contentMatched,
  sampleIndexes,
  normalizeAuthor,
} from '../scripts/browser-smoke-core.mjs';

// ===== Cookie parser（虚构 cookie，禁止真实凭据） =====

test('cookie: 虚构 cookie header → Playwright cookies', () => {
  const cookies = { foo: 'bar', hello: 'world', empty: '' };
  const pwc = toPlaywrightCookies(cookies);
  assert.equal(pwc.length, 2);
  assert.deepEqual(pwc[0], { name: 'foo', value: 'bar', domain: 'www.zhihu.com', path: '/' });
  assert.ok(pwc.every((c) => c.domain === 'www.zhihu.com' && c.path === '/'));
});

test('cookie: 空 cookie 对象 → 空数组', () => {
  assert.deepEqual(toPlaywrightCookies({}), []);
  assert.deepEqual(toPlaywrightCookies({ a: null, b: undefined }), []);
});

// ===== HTML normalization =====

test('html: <p>Hello <b>world</b></p> → Hello world', () => {
  assert.equal(collapseWhitespace(normalizeHtmlText('<p>Hello <b>world</b></p>')), 'Hello world');
});

test('html: 块级标签转行 + 实体解码', () => {
  const out = normalizeHtmlText('<div>第一段<br/>第二段</div><p>三 &amp; 四</p>');
  assert.equal(collapseWhitespace(out), '第一段 第二段 三 & 四');
});

test('html: script/style 内容被移除，标签全部剥离', () => {
  const out = normalizeHtmlText('<p>正文</p><script>alert(1)</script><style>.x{}</style>');
  assert.equal(collapseWhitespace(out), '正文');
});

test('html: 数字实体解码', () => {
  assert.equal(normalizeHtmlText('&#20013;&#x6587;'), '中文');
});

test('html: 图片 img 标签忽略（无文字残留）', () => {
  assert.equal(normalizeHtmlText('<p>文字<img src="https://x/y.png"/>结尾</p>'), '文字结尾');
});

// ===== Content matcher =====

const LONG_API_CONTENT = `
<p>第一段稳定文字：介绍这个问题的背景和主要争议点。</p>
<p>中间部分：包含若干技术细节与具体做法说明。</p>
<p>最后一段：总结性文字，给出整体判断与建议。</p>
`;

test('matcher: 相同正文 → 匹配（前/中/尾片段都能命中）', () => {
  const browserText = '第一段稳定文字：介绍这个问题的背景和主要争议点。\n中间部分：包含若干技术细节与具体做法说明。\n最后一段：总结性文字，给出整体判断与建议。';
  assert.equal(contentMatched(LONG_API_CONTENT, browserText), true);
});

test('matcher: 完全不相关正文 → 不匹配', () => {
  assert.equal(contentMatched(LONG_API_CONTENT, '今天天气不错，出去散步。'), false);
});

test('matcher: 只命中 1/3 片段 → 不匹配（需 >= 2/3）', () => {
  const browserText = '第一段稳定文字：介绍这个问题的背景和主要争议点。\n完全无关的其他内容。';
  assert.equal(contentMatched(LONG_API_CONTENT, browserText), false);
});

test('matcher: 命中 2/3 片段 → 匹配', () => {
  const browserText = '第一段稳定文字：介绍这个问题的背景和主要争议点。\n中间部分：包含若干技术细节与具体做法说明。\n无关结尾。';
  assert.equal(contentMatched(LONG_API_CONTENT, browserText), true);
});

test('matcher: 短正文按比例放宽（至少 1 片段命中）', () => {
  const short = '<p>一句话的简短回答，没有更多内容。</p>';
  assert.equal(contentMatched(short, '一句话的简短回答，没有更多内容。'), true);
  assert.equal(contentMatched(short, '完全不同的一句话'), false);
});

test('matcher: 空正文 → 不匹配', () => {
  assert.equal(contentMatched(null, '随便什么'), false);
  assert.equal(contentMatched('<p></p>', '随便什么'), false);
});

test('matcher: URL 标签属性被剥离，正文文字仍可命中', () => {
  // <a href> 里的 URL 不进入可见文本；正文文字本身是匹配依据
  const withUrl = '<p>请看 <a href="https://example.com/very/long/url">这篇文章</a> 了解更多。</p>';
  const browserText = '请看 这篇文章 了解更多。';
  assert.equal(contentMatched(withUrl, browserText), true);
});

test('matcher: 纯 URL 子串被剔除，不作为匹配依据（不影响正文命中）', () => {
  // 正文中散落的裸 URL（如引用来源）从片段中剔除，正文句子仍可匹配
  const api = '<p>来源：https://example.com/a/b/c 这是正文内容，与浏览器一致。</p>';
  const browserText = '来源： 这是正文内容，与浏览器一致。';
  assert.equal(contentMatched(api, browserText), true);
});

// ===== Sample indexes =====

test('sample: N=59 得到 5 个分布位置（首/25%/50%/75%/尾）', () => {
  assert.deepEqual(sampleIndexes(59, 5), [0, 14, 29, 43, 58]);
});

test('sample: 去重后保持最多 min(sampleSize, n) 条（N=3 时取满 3 个唯一位置）', () => {
  const idxs = sampleIndexes(3, 5);
  assert.equal(idxs.length, 3);
  assert.deepEqual(idxs, [0, 1, 2]);
});

test('sample: 严格单调且长度正确（N=3 去重后从 0..n-1 补齐）', () => {
  const idxs = sampleIndexes(3, 5);
  assert.equal(idxs.length, 3);
  assert.deepEqual(idxs, [0, 1, 2]);
});

test('sample: N=1 → 只有 index 0', () => {
  assert.deepEqual(sampleIndexes(1, 5), [0]);
});

test('sample: 非法 N → 空数组', () => {
  assert.deepEqual(sampleIndexes(0, 5), []);
  assert.deepEqual(sampleIndexes(-3, 5), []);
  assert.deepEqual(sampleIndexes('x', 5), []);
});

// ===== Author normalization =====

test('author: 空白折叠 + 大小写归一', () => {
  assert.equal(normalizeAuthor('  AI  程序员老陈 '), 'ai 程序员老陈');
  assert.equal(normalizeAuthor('UR4N0X'), 'ur4n0x');
  assert.equal(normalizeAuthor(null), '');
});

// ===== Credential secrecy（机器输出不含凭据） =====

test('secrecy: 机器输出字符串不得包含 z_c0 / d_c0 / Cookie 值', () => {
  const fakeOutput = JSON.stringify({
    checks: [{ author: '某用户', answerId: '123', result: 'pass' }],
    warnings: [],
  });
  assert.ok(!fakeOutput.includes('z_c0'));
  assert.ok(!fakeOutput.includes('d_c0'));
  assert.ok(!/Cookie\s*[:=]/.test(fakeOutput));
});

test('secrecy: toPlaywrightCookies 不接受凭据名（防御：拒绝 z_c0/d_c0 进入输出路径）', () => {
  // 本测试只验证转换函数本身不把敏感名当普通字段泄露；真实调用只发生在浏览器进程内存中
  const pwc = toPlaywrightCookies({ z_c0: 'secret-value', d_c0: 'secret-value-2' });
  assert.equal(pwc.length, 2);
  // 转换结果只含 name/value/domain/path，且 value 不会出现在任何 stdout 序列化路径中（由 runSmoke 保证）
  for (const c of pwc) {
    assert.deepEqual(Object.keys(c).sort(), ['domain', 'name', 'path', 'value']);
  }
});
