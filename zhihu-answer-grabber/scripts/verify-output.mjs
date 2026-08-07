#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * verify-output — 验证抓取产物完整性（CLI 薄壳，验证逻辑在 src/verifier.js 单一事实来源）。
 *
 * 用法: node scripts/verify-output.mjs <out/question-id>
 * 输出: 结构化 JSON（见 src/verifier.js），valid=false 时退出码非 0。
 */
import path from 'node:path';
import { verifyOutput } from '../src/verifier.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const questionDirArg = process.argv[2] || arg('--dir', null);
if (!questionDirArg) {
  console.error('用法: node scripts/verify-output.mjs <out/question-id>');
  process.exit(2);
}

const result = verifyOutput(path.resolve(questionDirArg));
console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
