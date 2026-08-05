#!/usr/bin/env node
/**
 * zhigrab — zhihu-answer-grabber 的 Agent 统一入口。
 * 用法: node zhigrab.mjs <grab|batch|search|status> [参数...]
 * 环境变量: ZAG_DIR 可覆盖工具目录（默认指向已安装位置）
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// 默认定位到本脚本上一级目录（即 zhihu-answer-grabber 根，内含 src/cli.js）。
// 也可通过环境变量 ZAG_DIR 覆盖（适用于把 src 放到别处的部署场景）。
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOOL_DIR = path.resolve(SELF_DIR, '..');
const toolDir = process.env.ZAG_DIR || DEFAULT_TOOL_DIR;
const cli = path.join(toolDir, 'src', 'cli.js');

if (!fs.existsSync(cli)) {
  console.error(`[zhigrab] 找不到工具: ${cli}\n[zhigrab] 请设置环境变量 ZAG_DIR 指向 zhihu-answer-grabber 目录`);
  process.exit(2);
}

const args = process.argv.slice(2);
try {
  // cwd 切到工具目录，确保能读到 zhihu_cookie.txt / zhihu_secret.txt
  execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit', cwd: toolDir });
} catch (error) {
  process.exit(error.status ?? 1);
}
