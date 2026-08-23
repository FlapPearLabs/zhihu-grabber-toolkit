#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * map — 对 digest 管线中全部 chunk 执行 lmstudio-local-tool-less per-source map，
 * 由 trusted controller 确定性装配 corpus map 结果（T6, Issue #12）。
 *
 * 用法:
 *   node scripts/map.mjs --work work/
 *
 * 前置: LM Studio 本地服务器运行于 127.0.0.1:1234 且 qwen/qwen3-1.7b 已加载
 *       （corpus-anthology/scripts/qualify-lmstudio-runtime.mjs 可先行验证）。
 * 行为:
 *   - 读取 work/chunks/chunk-*.json（存在 manifest 且 schemaVersion=1 时以其 sourceIds 为准）。
 *   - 逐 chunk 逐来源调用 tool-less runtime；任何失败 → 该 chunk 不写 map 并整体 fail closed。
 *   - 输出 work/map-results/map-chunk-XXXX.json（先写临时文件再改名）。
 *   - 幂等：已存在且 chunkHash 匹配的 map 复用，不重复调用模型。
 */

import fs from 'node:fs';
import path from 'node:path';
import { runChunkMap } from '../lib/lmstudio-map-executor.mjs';
import { runToolLessMap } from '../lib/lmstudio-tool-less.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel || '.';
}

async function main() {
  const workDir = path.resolve(arg('--work', 'work'));
  const chunksDir = path.join(workDir, 'chunks');
  const mapsDir = path.join(workDir, 'map-results');

  if (!fs.existsSync(chunksDir)) {
    console.error('未找到 chunk 目录（先运行 scripts/chunk.mjs --work work/ --mode digest）');
    process.exit(2);
  }
  fs.mkdirSync(mapsDir, { recursive: true });

  const chunkFiles = fs.readdirSync(chunksDir)
    .filter((name) => /^chunk-\d{4}\.json$/u.test(name))
    .sort();

  if (chunkFiles.length === 0) {
    console.error('chunk 目录为空');
    process.exit(2);
  }

  let mapped = 0;
  let reused = 0;

  for (const name of chunkFiles) {
    const chunk = JSON.parse(fs.readFileSync(path.join(chunksDir, name), 'utf8'));
    const mapFile = path.join(mapsDir, `map-${chunk.chunkId}.json`);
    if (fs.existsSync(mapFile)) {
      const existing = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      if (existing.chunkHash === chunk.chunkHash && existing.chunkId === chunk.chunkId) {
        reused += 1;
        continue;
      }
    }
    const map = await runChunkMap(chunk, { run: runToolLessMap });
    const tmp = `${mapFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
    fs.renameSync(tmp, mapFile);
    mapped += 1;
    console.log(`已生成 map: ${displayPath(mapFile)}（${chunk.sourceIds.length} 来源）`);
  }

  console.log(`map 完成：新增 ${mapped}，复用 ${reused}，共 ${chunkFiles.length} 个 chunk`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
