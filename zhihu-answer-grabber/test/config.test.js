import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadZhihuCliConfig, loadConfig, parseCookieHeader, resolveSecret, ConfigError } from '../src/config.js';

function makeFixture(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-config-test-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(json));
  return { dir, file };
}

test('loadZhihuCliConfig 正确解析 zhihu-cli 配置', () => {
  const { file } = makeFixture({
    cookies: { z_c0: 'z', _xsrf: 'x', d_c0: 'd' },
    userAgent: 'UA-TEST',
    zse93: '101_3_3.0',
    proxy: null,
  });
  process.env.ZHIHU_CLI_CONFIG = file;
  try {
    const cfg = loadZhihuCliConfig();
    assert.equal(cfg.cookies.z_c0, 'z');
    assert.equal(cfg.userAgent, 'UA-TEST');
    assert.equal(cfg.zse93, '101_3_3.0');
  } finally {
    delete process.env.ZHIHU_CLI_CONFIG;
  }
});

test('loadZhihuCliConfig 缺失文件抛 ConfigError', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-config-missing-'));
  process.env.ZHIHU_CLI_CONFIG = path.join(dir, 'nope.json');
  try {
    assert.throws(() => loadZhihuCliConfig(), ConfigError);
  } finally {
    delete process.env.ZHIHU_CLI_CONFIG;
  }
});

test('loadZhihuCliConfig 缺 z_c0 抛 ConfigError', () => {
  const { file } = makeFixture({ cookies: { d_c0: 'd' } });
  process.env.ZHIHU_CLI_CONFIG = file;
  try {
    assert.throws(() => loadZhihuCliConfig(), ConfigError);
  } finally {
    delete process.env.ZHIHU_CLI_CONFIG;
  }
});

test('loadZhihuCliConfig 缺 d_c0 抛 ConfigError（签名必需）', () => {
  const { file } = makeFixture({ cookies: { z_c0: 'z' } });
  process.env.ZHIHU_CLI_CONFIG = file;
  try {
    assert.throws(() => loadZhihuCliConfig(), /d_c0/);
  } finally {
    delete process.env.ZHIHU_CLI_CONFIG;
  }
});

test('parseCookieHeader 解析整串 Cookie 并跳过属性字段', () => {
  const cookies = parseCookieHeader('z_c0=abc; d_c0=def; path=/; HttpOnly; Secure');
  assert.equal(cookies.z_c0, 'abc');
  assert.equal(cookies.d_c0, 'def');
  assert.equal(cookies.path, undefined);
  assert.equal(cookies.httponly, undefined);
});

test('loadConfig 优先取 ZHIHU_COOKIE 环境变量', () => {
  process.env.ZHIHU_COOKIE = 'z_c0=envz; d_c0=envd';
  try {
    const cfg = loadConfig();
    assert.equal(cfg.cookies.z_c0, 'envz');
    assert.equal(cfg.cookies.d_c0, 'envd');
    assert.ok(cfg.userAgent.includes('Mozilla'));
    assert.equal(cfg.zse93, '101_3_3.0');
  } finally {
    delete process.env.ZHIHU_COOKIE;
  }
});

test('loadConfig 读取本地 zhihu_cookie.txt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-cookie-file-'));
  fs.writeFileSync(path.join(dir, 'zhihu_cookie.txt'), 'z_c0=filez; d_c0=filed');
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const cfg = loadConfig();
    assert.equal(cfg.cookies.z_c0, 'filez');
  } finally {
    process.chdir(prev);
  }
});

test('loadConfig 无 cookie 时回退 zhihu-cli 配置', () => {
  const { file } = makeFixture({ cookies: { z_c0: 'z', d_c0: 'd' } });
  process.env.ZHIHU_CLI_CONFIG = file;
  try {
    const cfg = loadConfig();
    assert.equal(cfg.cookies.z_c0, 'z');
  } finally {
    delete process.env.ZHIHU_CLI_CONFIG;
  }
});

test('loadConfig 均缺失时抛 ConfigError', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-cookie-none-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    assert.throws(() => loadConfig(), ConfigError);
  } finally {
    process.chdir(prev);
  }
});

test('resolveSecret 优先取环境变量', () => {
  process.env.ZHIHU_SECRET = 'envsecret';
  try {
    assert.equal(resolveSecret(), 'envsecret');
  } finally {
    delete process.env.ZHIHU_SECRET;
  }
});

test('resolveSecret 读本地 zhihu_secret.txt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-secret-test-'));
  fs.writeFileSync(path.join(dir, 'zhihu_secret.txt'), 'filesecret');
  const prev = process.cwd();
  process.chdir(dir);
  try {
    assert.equal(resolveSecret(), 'filesecret');
  } finally {
    process.chdir(prev);
  }
});

test('resolveSecret 都没有时抛 ConfigError', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-secret-missing-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    assert.throws(() => resolveSecret(), ConfigError);
  } finally {
    process.chdir(prev);
  }
});
