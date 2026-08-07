import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/preflight.mjs', import.meta.url));

function runWithEnv(env) {
  return spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('preflight 无任何凭据时全部为 false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-none-'));
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /cookie_configured: false/);
  assert.match(r.stdout, /secret_configured: false/);
  assert.match(r.stdout, /config_source: none/);
});

test('preflight 本地 cookie 文件被识别，且不输出凭据值', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-file-'));
  fs.writeFileSync(path.join(dir, 'zhihu_cookie.txt'), 'z_c0=SUPERSECRET; d_c0=xxx');
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /cookie_configured: true/);
  assert.match(r.stdout, /config_source: local_file/);
  assert.ok(!r.stdout.includes('SUPERSECRET'), '不得输出凭据值');
  assert.ok(!r.stdout.includes('z_c0'), '不得输出凭据字段名');
});

test('preflight 环境变量优先，且不输出凭据值', () => {
  const r = runWithEnv({ ZHIHU_COOKIE: 'z_c0=ENVSECRET; d_c0=y', ZHIHU_SECRET: '' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /cookie_configured: true/);
  assert.match(r.stdout, /config_source: env/);
  assert.ok(!r.stdout.includes('ENVSECRET'));
});

test('preflight 输出只含三行，无额外内容', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-clean-'));
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => /^(cookie_configured|secret_configured|config_source): (true|false|env|local_file|user_config|none)$/.test(l)));
});

test('preflight 不打印凭据文件路径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-path-'));
  fs.writeFileSync(path.join(dir, 'zhihu_cookie.txt'), 'z_c0=secret; d_c0=secret2');
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir });
  assert.ok(!r.stdout.includes(dir), '不得泄漏本机路径');
});
