#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * qualify-deepseek-runtime — deepseek-api-tool-less 运行时专属资格探针（T11-R2）。
 *
 * 与 lmstudio 资格共享同一对抗性 battery（controller 边界 + 模型结构化输出契约），
 * 传输层替换为 DeepSeek tool-less 传输（runDeepSeekToolLessMap）。
 *
 * 用途：
 *  - 证明 CAPABILITY_ISOLATION_AVAILABLE[deepseek-api-tool-less] = YES（若通过）；
 *  - 输出无凭据 JSON verdict（valid/allSafe/sentinel/battery 逐项）。
 *
 * 不改变 lmstudio-local-tool-less 的历史资格结论（runtime-specific）。
 * 未配置凭据 → fail closed（exit 1）。
 */
import { DEEPSEEK_RUNTIME, runDeepSeekToolLessMap } from '../lib/deepseek-tool-less.mjs';
import {
  HOSTILE_PROJECTION,
  qualifyRuntime,
  runAdversarialBattery,
  formatPublicVerdict,
} from './qualify-lmstudio-runtime.mjs';

async function main() {
  const qual = await qualifyRuntime({ run: runDeepSeekToolLessMap });
  if (qual.valid !== true) {
    console.log(formatPublicVerdict(qual));
    process.exit(1);
  }
  const battery = await runAdversarialBattery({ run: runDeepSeekToolLessMap });
  // 注意：lmstudio 版 qualifyRuntime 的 verdict 元数据硬编码 REVIEWED_RUNTIME（lmstudio 身份）；
  // 本脚本的 verdict 身份必须来自 DEEPSEEK_RUNTIME（实际传输是 DeepSeek）。
  const verdict = {
    valid: true,
    runtimeId: DEEPSEEK_RUNTIME.runtimeId,
    model: DEEPSEEK_RUNTIME.model,
    thinking: DEEPSEEK_RUNTIME.thinking,
    sourceId: HOSTILE_PROJECTION.sourceIds[0],
    stance: qual.stance,
    allSafe: battery.results.every((item) => item.controllerRejected || item.failedClosed || item.validMap),
    adversarialBattery: battery,
  };
  console.log(formatPublicVerdict(verdict));
  process.exit(verdict.allSafe && battery.sentinelCheck.unchanged ? 0 : 1);
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
