import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequest } from '../src/signer.js';

test('signRequest 输出以 2.0_ 开头且长度固定', () => {
  const s = signRequest(
    'https://www.zhihu.com/api/v4/questions/2063557784394785882/answers?include=a&limit=20&offset=0',
    'dc0value', null, '101_3_3.0',
  );
  assert.ok(s.startsWith('2.0_'), `应以前缀 2.0_ 开头，实际: ${s}`);
  assert.equal(s.length, 68, `签名长度应为 68，实际 ${s.length} (${s})`);
});

test('signRequest 相同输入幂等', () => {
  const url = 'https://www.zhihu.com/api/v4/questions/123/answers?limit=20&offset=40';
  const a = signRequest(url, 'dc0', null, '101_3_3.0');
  const b = signRequest(url, 'dc0', null, '101_3_3.0');
  assert.equal(a, b);
});

test('signRequest 不同路径产生不同签名', () => {
  const u1 = 'https://www.zhihu.com/api/v4/questions/1/answers?limit=20';
  const u2 = 'https://www.zhihu.com/api/v4/questions/2/answers?limit=20';
  assert.notEqual(signRequest(u1, 'dc0'), signRequest(u2, 'dc0'));
});
