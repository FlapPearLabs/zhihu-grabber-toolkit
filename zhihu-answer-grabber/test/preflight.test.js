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

function parseOutput(stdout) {
  const map = {};
  for (const line of stdout.trim().split('\n')) {
    const [k, v] = line.split(': ');
    map[k] = v;
  }
  return map;
}

test('preflight 无任何凭据时全部为 false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-none-'));
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  assert.equal(r.status, 0);
  const out = parseOutput(r.stdout);
  assert.equal(out.cookie_configured, 'false');
  assert.equal(out.secret_configured, 'false');
  assert.equal(out.cookie_usable, 'false');
  assert.equal(out.config_source, 'none');
});

test('preflight 本地合法 cookie 文件：configured=true, usable=true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-file-'));
  fs.writeFileSync(path.join(dir, 'zhihu_cookie.txt'), 'z_c0=SUPERSECRET; d_c0=xxx');
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  assert.equal(r.status, 0);
  const out = parseOutput(r.stdout);
  assert.equal(out.cookie_configured, 'true');
  assert.equal(out.cookie_usable, 'true');
  assert.equal(out.cookie_error, 'none');
  assert.equal(out.config_source, 'local_file');
  assert.ok(!r.stdout.includes('SUPERSECRET'), '不得输出凭据值');
  assert.ok(!r.stdout.includes('z_c0='), '不得输出凭据字段值');
});

test('preflight 本地缺 d_c0 的 cookie：usable=false, error=missing_d_c0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-missing-'));
  fs.writeFileSync(path.join(dir, 'zhihu_cookie.txt'), 'z_c0=onlyz');
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  const out = parseOutput(r.stdout);
  assert.equal(out.cookie_configured, 'true');
  assert.equal(out.cookie_usable, 'false');
  assert.equal(out.cookie_error, 'missing_d_c0');
});

test('preflight 环境变量合法 cookie：usable=true, source=env', () => {
  const r = runWithEnv({ ZHIHU_COOKIE: 'z_c0=ENVSECRET; d_c0=y', ZHIHU_SECRET: '' });
  assert.equal(r.status, 0);
  const out = parseOutput(r.stdout);
  assert.equal(out.cookie_configured, 'true');
  assert.equal(out.cookie_usable, 'true');
  assert.equal(out.config_source, 'env');
  assert.ok(!r.stdout.includes('ENVSECRET'));
});

test('preflight 环境变量缺 d_c0：usable=false', () => {
  const r = runWithEnv({ ZHIHU_COOKIE: 'z_c0=onlyz', ZHIHU_SECRET: '' });
  const out = parseOutput(r.stdout);
  assert.equal(out.cookie_configured, 'true');
  assert.equal(out.cookie_usable, 'false');
  assert.equal(out.cookie_error, 'missing_d_c0');
});

test('preflight symlink 凭据文件：usable=false, error=symlink（POSIX）', (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows 无法可靠创建 symlink');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-symlink-'));
  const real = path.join(dir, 'real.txt');
  fs.writeFileSync(real, 'z_c0=secret; d_c0=secret2');
  try {
    fs.symlinkSync(real, path.join(dir, 'zhihu_cookie.txt'));
  } catch {
    t.skip('symlink 创建失败');
    return;
  }
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  const out = parseOutput(r.stdout);
  assert.equal(out.cookie_configured, 'true');
  assert.equal(out.cookie_usable, 'false');
  assert.equal(out.cookie_error, 'symlink');
});

test('preflight 过宽权限（0644）：usable=false, error=permission（POSIX）', (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows 无 POSIX 权限模型');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-perm-'));
  const file = path.join(dir, 'zhihu_cookie.txt');
  fs.writeFileSync(file, 'z_c0=secret; d_c0=secret2');
  fs.chmodSync(file, 0o644);
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  const out = parseOutput(r.stdout);
  assert.equal(out.cookie_configured, 'true');
  assert.equal(out.cookie_usable, 'false');
  assert.equal(out.cookie_error, 'permission');
});

test('preflight 0600 权限：usable=true（POSIX）', (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows 无 POSIX 权限模型');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-600-'));
  const file = path.join(dir, 'zhihu_cookie.txt');
  fs.writeFileSync(file, 'z_c0=secret; d_c0=secret2');
  fs.chmodSync(file, 0o600);
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  const out = parseOutput(r.stdout);
  assert.equal(out.cookie_usable, 'true');
});

test('preflight 输出格式固定：7 行且无额外内容', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-clean-'));
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_COOKIE: '', ZHIHU_SECRET: '' });
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 7);
  assert.ok(lines.every((l) => /^(cookie_configured|cookie_usable|secret_configured|secret_usable|config_source|cookie_error|secret_error): /.test(l)));
});

test('preflight 不打印凭据文件路径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-path-'));
  fs.writeFileSync(path.join(dir, 'zhihu_cookie.txt'), 'z_c0=secret; d_c0=secret2');
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir });
  assert.ok(!r.stdout.includes(dir), '不得泄漏本机路径');
});

test('preflight secret 可用性：env 与文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-preflight-secret-'));
  fs.writeFileSync(path.join(dir, 'zhihu_secret.txt'), 'SECRETVALUE');
  const r = runWithEnv({ ZAG_CONFIG_DIR: dir, ZHIHU_SECRET: '' });
  const out = parseOutput(r.stdout);
  assert.equal(out.secret_configured, 'true');
  assert.equal(out.secret_usable, 'true');
  assert.ok(!r.stdout.includes('SECRETVALUE'));
});
