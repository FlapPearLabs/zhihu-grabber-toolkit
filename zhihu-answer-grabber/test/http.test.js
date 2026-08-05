import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignedHeaders, buildAnswersUrl, buildQuestionInfoUrl, cookieHeader } from '../src/http.js';

const config = {
  cookies: { z_c0: 'zc', _xsrf: 'xs', d_c0: 'dc' },
  userAgent: 'UA-TEST',
  zse93: '101_3_3.0',
};

test('buildSignedHeaders 包含完整签名与身份头', () => {
  const url = 'https://www.zhihu.com/api/v4/questions/123/answers?limit=20';
  const h = buildSignedHeaders(config, url, { referer: 'https://www.zhihu.com/question/123' });
  assert.equal(h['x-zse-93'], '101_3_3.0');
  assert.ok(h['x-zse-96'] && h['x-zse-96'].startsWith('2.0_'));
  assert.equal(h.cookie, 'z_c0=zc; _xsrf=xs; d_c0=dc');
  assert.equal(h['user-agent'], 'UA-TEST');
  assert.equal(h['x-requested-with'], 'fetch');
  assert.equal(h.referer, 'https://www.zhihu.com/question/123');
  assert.equal(h['x-xsrftoken'], 'xs');
});

test('cookieHeader 过滤空值', () => {
  assert.equal(cookieHeader({ a: '1', b: '', c: null }), 'a=1');
});

test('buildAnswersUrl 结构与编码正确', () => {
  const u = new URL(buildAnswersUrl('2063557784394785882', 40, 20));
  assert.equal(u.hostname, 'www.zhihu.com');
  assert.equal(u.pathname, '/api/v4/questions/2063557784394785882/answers');
  assert.equal(u.searchParams.get('limit'), '20');
  assert.equal(u.searchParams.get('offset'), '40');
  assert.ok(u.searchParams.get('include').includes('content'));
});

test('buildQuestionInfoUrl 结构正确', () => {
  const u = new URL(buildQuestionInfoUrl('123'));
  assert.equal(u.pathname, '/api/v4/questions/123');
  assert.ok(u.searchParams.get('include').includes('title'));
});
