#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * preflight-deepseek — DeepSeek API 凭据预检（T11-R2）。
 *
 * 仅输出布尔状态与错误类型（configured/usable/error/source），
 * 绝不输出凭据内容（值/长度/前缀/哈希均禁止）。
 *
 * 用法: node scripts/preflight-deepseek.mjs [--json]
 */
import { resolveDeepSeekCredential } from '../lib/deepseek-tool-less.mjs';

function main() {
  const jsonMode = process.argv.includes('--json');
  const status = resolveDeepSeekCredential();
  const publicStatus = {
    schemaVersion: 1,
    credential: {
      configured: status.configured,
      usable: status.usable,
      source: status.source ?? 'none',
      error: status.error ?? 'missing',
    },
  };
  if (jsonMode) {
    console.log(JSON.stringify(publicStatus, null, 2));
  } else {
    console.log(`configured: ${publicStatus.credential.configured}`);
    console.log(`usable: ${publicStatus.credential.usable}`);
    console.log(`source: ${publicStatus.credential.source}`);
    console.log(`error: ${publicStatus.credential.error}`);
  }
  process.exit(publicStatus.credential.usable ? 0 : 1);
}

main();
