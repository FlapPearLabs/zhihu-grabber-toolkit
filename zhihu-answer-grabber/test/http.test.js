import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignedHeaders, buildAnswersUrl, buildQuestionInfoUrl, cookieHeader, requestJson } from '../src/http.js';const config = {
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

test('buildSignedHeaders 拒绝非知乎域名（防止 Cookie 外传）', () => {
  assert.throws(() => buildSignedHeaders(config, 'https://attacker.example/collect'), /拒绝/);
  assert.throws(() => buildSignedHeaders(config, 'http://www.zhihu.com/api'), /拒绝/);
  assert.throws(() => buildSignedHeaders(config, 'https://evil-zhihu.com/api'), /拒绝/);
});

test('buildSignedHeaders 拒绝带用户名密码的 URL', () => {
  assert.throws(() => buildSignedHeaders(config, 'https://user:pass@www.zhihu.com/api'), /拒绝/);
});

// ===== Fix 3：401/403 中性诊断（不武断归因） =====

/** 临时替换全局 fetch，返回固定 status + body */
function stubFetchStatus(status, body = '{}') {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
  return () => { globalThis.fetch = original; };
}

test('Fix3: 401 错误是事实型诊断，不武断归因凭证失效/IP/风控', async () => {
  const restore = stubFetchStatus(401);
  try {
    await assert.rejects(
      requestJson(config, 'https://www.zhihu.com/api/v4/questions/123'),
      (error) => {
        assert.equal(error.name, 'HttpError');
        assert.equal(error.status, 401);
        const msg = error.message;
        assert.ok(msg.includes('HTTP 401'), '应保留 HTTP 状态');
        assert.ok(!msg.includes('已失效'), '不得断言凭证已失效');
        assert.ok(!msg.includes('IP'), '不得断言 IP 被风控');
        assert.ok(!msg.includes('qrcode'), '不得强制要求重新登录');
        assert.ok(!/风控拦截/.test(msg), '不得武断归因风控');
        assert.ok(msg.includes('尚未确定'), '应保留"具体原因尚未确定"');
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('Fix3: 403 错误是事实型诊断，不武断归因风控/IP', async () => {
  const restore = stubFetchStatus(403);
  try {
    await assert.rejects(
      requestJson(config, 'https://www.zhihu.com/api/v4/questions/123'),
      (error) => {
        assert.equal(error.name, 'HttpError');
        assert.equal(error.status, 403);
        const msg = error.message;
        assert.ok(msg.includes('HTTP 403'), '应保留 HTTP 状态');
        assert.ok(!msg.includes('风控拦截'), '不得断言"被风控拦截"');
        assert.ok(!msg.includes('IP'), '不得断言 IP 类型');
        assert.ok(!/已失效/.test(msg), '不得断言凭证已失效');
        assert.ok(msg.includes('尚未确定'), '应保留"具体原因尚未确定"');
        return true;
      },
    );
  } finally {
    restore();
  }
});
