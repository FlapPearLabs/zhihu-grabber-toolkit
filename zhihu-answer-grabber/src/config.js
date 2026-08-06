// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.errorType = 'configuration_error';
  }
}

export function getCliConfigPath() {
  return process.env.ZHIHU_CLI_CONFIG
    || process.env.ZHIHU_CREATOR_CONFIG
    || path.join(os.homedir(), '.zhihu-cli', 'config.json');
}

/** 解析浏览器 Cookie 头字符串（如 "z_c0=abc; d_c0=def; path=/"），跳过属性字段 */
export function parseCookieHeader(input) {
  const skippedNames = new Set(['domain', 'path', 'expires', 'max-age', 'httponly', 'secure', 'samesite']);
  const cookies = {};
  for (const segment of String(input).split(';')) {
    const part = segment.trim();
    if (!part) continue;
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name || skippedNames.has(name.toLowerCase())) continue;
    cookies[name] = value;
  }
  return cookies;
}

/** 拒绝符号链接与过宽权限的凭据文件（多用户机器上防止读取非预期文件） */
function assertSafeCredentialFile(file) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) {
    throw new ConfigError(`凭据文件 ${file} 是符号链接，已拒绝读取（防止被指向非预期文件）`);
  }
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    throw new ConfigError(`凭据文件 ${file} 权限过宽（应为 0600 仅当前用户可读写），请先执行 chmod 600`);
  }
}

function buildConfigFromCookies(cookies, extra = {}) {
  const missing = ['z_c0', 'd_c0'].filter((name) => !cookies[name]);
  if (missing.length > 0) {
    throw new ConfigError(`Cookie 缺少必要字段: ${missing.join(', ')}\n请复制浏览器 zhihu.com 登录后的完整 Cookie（需包含 z_c0 与 d_c0，d_c0 用于签名）`);
  }
  return {
    cookies,
    userAgent: extra.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    zse93: extra.zse93 || '101_3_3.0',
  };
}

/** 读取 zhihu-cli 登录后的配置（cookies/userAgent/zse93） */
export function loadZhihuCliConfig() {
  const configPath = getCliConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new ConfigError(`未找到 zhihu-cli 配置 ${configPath}\n请先在本机执行: zhihu-cli login --qrcode 完成登录，或改用 Cookie 方式（ZHIHU_COOKIE / zhihu_cookie.txt）`);
  }
  try {
    assertSafeCredentialFile(configPath);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new ConfigError(`配置文件 ${configPath} 无法解析: ${error.message}`);
  }
  return buildConfigFromCookies(parsed.cookies || {}, { userAgent: parsed.userAgent, zse93: parsed.zse93 });
}

/** 凭据目录：优先 ZAG_CONFIG_DIR，否则调用者当前目录 */
function configDir() {
  return process.env.ZAG_CONFIG_DIR ? path.resolve(process.env.ZAG_CONFIG_DIR) : process.cwd();
}

/**
 * 统一配置入口，Cookie 来源优先级：
 *   1) 环境变量 ZHIHU_COOKIE（整串 cookie）
 *   2) 凭据目录 zhihu_cookie.txt（ZAG_CONFIG_DIR 或当前目录）
 *   3) ~/.zhihu-cli/config.json（zhihu-cli 登录产物）
 */
export function loadConfig() {
  if (process.env.ZHIHU_COOKIE && process.env.ZHIHU_COOKIE.trim()) {
    return buildConfigFromCookies(parseCookieHeader(process.env.ZHIHU_COOKIE));
  }
  const cookieFile = path.join(configDir(), 'zhihu_cookie.txt');
  if (fs.existsSync(cookieFile)) {
    assertSafeCredentialFile(cookieFile);
    const raw = fs.readFileSync(cookieFile, 'utf8').trim();
    if (raw) return buildConfigFromCookies(parseCookieHeader(raw));
  }
  return loadZhihuCliConfig();
}

/** 官方开放平台 Access Secret（仅 search 功能需要） */
export function resolveSecret() {
  if (process.env.ZHIHU_SECRET && process.env.ZHIHU_SECRET.trim()) {
    return process.env.ZHIHU_SECRET.trim();
  }
  const file = path.join(configDir(), 'zhihu_secret.txt');
  if (fs.existsSync(file)) {
    assertSafeCredentialFile(file);
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value) return value;
  }
  throw new ConfigError('缺少 Access Secret：请设置环境变量 ZHIHU_SECRET 或在当前目录放置 zhihu_secret.txt（search 功能需要）');
}
