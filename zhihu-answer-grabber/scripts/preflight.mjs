#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * preflight — 凭据配置预检。
 *
 * 只输出凭据是否已本地配置（布尔值）与配置来源类型，
 * 绝不输出任何凭据值、长度、前缀或哈希。
 *
 * 用法: node scripts/preflight.mjs
 * 输出:
 *   cookie_configured: true|false
 *   secret_configured: true|false
 *   config_source: env|local_file|user_config|none
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCliConfigPath } from '../src/config.js';

function configDir() {
  return process.env.ZAG_CONFIG_DIR ? path.resolve(process.env.ZAG_CONFIG_DIR) : process.cwd();
}

function hasEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function fileExists(file) {
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function main() {
  const dir = configDir();
  const cookieFile = path.join(dir, 'zhihu_cookie.txt');
  const secretFile = path.join(dir, 'zhihu_secret.txt');
  const cliConfig = getCliConfigPath();

  // 仅判断存在性，不读取内容
  const cookieEnv = hasEnv('ZHIHU_COOKIE');
  const cookieFileOk = fileExists(cookieFile);
  const cliConfigOk = fileExists(cliConfig);
  const cookieConfigured = cookieEnv || cookieFileOk || cliConfigOk;

  const secretEnv = hasEnv('ZHIHU_SECRET');
  const secretFileOk = fileExists(secretFile);
  const secretConfigured = secretEnv || secretFileOk;

  let configSource = 'none';
  if (cookieEnv) {
    configSource = 'env';
  } else if (cookieFileOk) {
    configSource = 'local_file';
  } else if (cliConfigOk) {
    configSource = 'user_config';
  }

  console.log(`cookie_configured: ${cookieConfigured}`);
  console.log(`secret_configured: ${secretConfigured}`);
  console.log(`config_source: ${configSource}`);
}

main();
