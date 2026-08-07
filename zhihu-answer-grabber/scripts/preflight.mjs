#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * preflight — 凭据配置预检。
 *
 * 与 src/config.js 的 loader 校验保持一致，区分：
 *   - cookie_configured: true|false   # 存在（含 env/本地文件/cli 配置）
 *   - cookie_usable: true|false       # 存在且可被 loader 使用（无 symlink/权限/缺字段问题）
 *   - secret_configured: true|false
 *   - secret_usable: true|false
 *   - config_source: env|local_file|user_config|none
 *   - cookie_error: none|missing|symlink|permission|missing_z_c0|missing_d_c0|unreadable
 *   - secret_error: none|missing|symlink|permission|unreadable
 *
 * 绝不输出任何凭据值、长度、前缀或哈希；错误只给类型，不给内容。
 *
 * 用法: node scripts/preflight.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCliConfigPath, parseCookieHeader } from '../src/config.js';

function configDir() {
  return process.env.ZAG_CONFIG_DIR ? path.resolve(process.env.ZAG_CONFIG_DIR) : process.cwd();
}

function hasEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 与 config.js assertSafeCredentialFile 一致的可用性检查。
 * 返回 { ok, error }；error 取值为 symlink / permission / unreadable / none。
 */
function credentialFileUsable(file) {
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) return { ok: false, error: 'symlink' };
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
      return { ok: false, error: 'permission' };
    }
    if (!st.isFile()) return { ok: false, error: 'unreadable' };
    return { ok: true, error: 'none' };
  } catch {
    return { ok: false, error: 'unreadable' };
  }
}

/** 检查 cookie 字符串是否含 loader 必需的字段（z_c0 与 d_c0） */
function cookieFieldsUsable(cookieValue) {
  const cookies = parseCookieHeader(cookieValue);
  if (!cookies.z_c0) return { ok: false, error: 'missing_z_c0' };
  if (!cookies.d_c0) return { ok: false, error: 'missing_d_c0' };
  return { ok: true, error: 'none' };
}

/** 读取文件内容（仅用于字段可用性判断，不输出） */
function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function main() {
  const dir = configDir();
  const cookieFile = path.join(dir, 'zhihu_cookie.txt');
  const secretFile = path.join(dir, 'zhihu_secret.txt');
  const cliConfig = getCliConfigPath();

  const cookieEnv = hasEnv('ZHIHU_COOKIE');
  const cookieFileExists = fs.existsSync(cookieFile);
  const cliConfigExists = fs.existsSync(cliConfig);
  const cookieConfigured = cookieEnv || cookieFileExists || cliConfigExists;

  const secretEnv = hasEnv('ZHIHU_SECRET');
  const secretFileExists = fs.existsSync(secretFile);
  const secretConfigured = secretEnv || secretFileExists;

  let configSource = 'none';
  let cookieUsable = false;
  let cookieError = 'missing';
  let secretUsable = false;
  let secretError = 'missing';

  // —— Cookie 可用性（与 loadConfig 的优先级/fallback 完全一致） ——
  //   loadConfig 逻辑：env 有值 → 用之（缺字段 throw）；
  //   否则本地文件存在 → 安全检查（symlink/权限 throw），内容非空 → 用之（缺字段 throw），
  //   内容为空 → fallback 到 CLI config；CLI config 缺失 → throw。
  if (cookieEnv) {
    configSource = 'env';
    const { ok, error } = cookieFieldsUsable(process.env.ZHIHU_COOKIE);
    cookieUsable = ok;
    cookieError = error;
  } else if (cookieFileExists) {
    const usable = credentialFileUsable(cookieFile);
    if (!usable.ok) {
      // symlink/权限问题 → loader 会 throw，不 fallback
      cookieUsable = false;
      cookieError = usable.error;
    } else {
      const raw = readFileSafe(cookieFile);
      if (raw !== null && raw !== '') {
        // 内容非空 → 用之；缺字段即 unusable（loader 会 throw，不 fallback）
        configSource = 'local_file';
        const { ok, error } = cookieFieldsUsable(raw);
        cookieUsable = ok;
        cookieError = error;
      } else if (cliConfigExists) {
        // 内容为空 → loader fallback 到 CLI config
        configSource = 'user_config';
        const cliUsable = credentialFileUsable(cliConfig);
        if (!cliUsable.ok) {
          cookieUsable = false;
          cookieError = cliUsable.error;
        } else {
          let parsed = null;
          try {
            parsed = JSON.parse(readFileSafe(cliConfig) || '{}');
          } catch {
            parsed = null;
          }
          const cookies = parsed?.cookies || {};
          if (!cookies.z_c0 || !cookies.d_c0) {
            cookieUsable = false;
            cookieError = cookies.z_c0 ? 'missing_d_c0' : 'missing_z_c0';
          } else {
            cookieUsable = true;
            cookieError = 'none';
          }
        }
      } else {
        // 空文件且无 CLI config → 不可用
        cookieUsable = false;
        cookieError = 'missing';
      }
    }
  } else if (cliConfigExists) {
    configSource = 'user_config';
    const usable = credentialFileUsable(cliConfig);
    if (!usable.ok) {
      cookieUsable = false;
      cookieError = usable.error;
    } else {
      let parsed = null;
      try {
        parsed = JSON.parse(readFileSafe(cliConfig) || '{}');
      } catch {
        parsed = null;
      }
      const cookies = parsed?.cookies || {};
      if (!cookies.z_c0 || !cookies.d_c0) {
        cookieUsable = false;
        cookieError = cookies.z_c0 ? 'missing_d_c0' : 'missing_z_c0';
      } else {
        cookieUsable = true;
        cookieError = 'none';
      }
    }
  }

  // —— Secret 可用性（与 resolveSecret 的优先级一致：env → 本地文件） ——
  if (secretEnv) {
    secretUsable = true;
    secretError = 'none';
  } else if (secretFileExists) {
    const usable = credentialFileUsable(secretFile);
    if (!usable.ok) {
      secretUsable = false;
      secretError = usable.error;
    } else {
      const raw = readFileSafe(secretFile);
      secretUsable = raw !== null && raw !== '';
      secretError = secretUsable ? 'none' : 'missing';
    }
  }

  console.log(`cookie_configured: ${cookieConfigured}`);
  console.log(`cookie_usable: ${cookieUsable}`);
  console.log(`secret_configured: ${secretConfigured}`);
  console.log(`secret_usable: ${secretUsable}`);
  console.log(`config_source: ${configSource}`);
  console.log(`cookie_error: ${cookieError}`);
  console.log(`secret_error: ${secretError}`);
}

main();
