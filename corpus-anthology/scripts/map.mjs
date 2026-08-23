#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * map — digest 管线 map 步骤：
 *   flat：对全部 chunk 执行 lmstudio-local-tool-less per-source map（T6, Issue #12）
 *   --hierarchy：L1 maps 之上构建 T9 批准合同的自适应中间聚合层（T10, Issue #16）
 *
 * 用法:
 *   node scripts/map.mjs --work work/
 *   node scripts/map.mjs --work work/ --hierarchy [--max-children 16] [--max-projected-bytes 32000]
 *
 * 前置: LM Studio 本地服务器运行于 127.0.0.1:1234 且 qwen/qwen3-1.7b 已加载
 *       （corpus-anthology/scripts/qualify-lmstudio-runtime.mjs 可先行验证）。
 * 行为（flat）:
 *   - 读取 work/chunks/chunk-*.json；逐 chunk 逐来源调用 tool-less runtime。
 *   - 任何失败 → 该 chunk 不写 map 并整体 fail closed（capability_isolation_unavailable）。
 *   - 输出 work/map-results/map-chunk-XXXX.json（原子写）。
 *   - 幂等：已存在且 chunkHash 匹配的 map 复用。
 * 行为（--hierarchy）:
 *   - L1 maps 完成后：若 L1 数量 > 1 且投影超预算 → 左到右贪婪分组（controller-owned）
 *     → 每组合成 1 个聚合节点（投影 = 子节点 claims + union + meta，经 T6 控制器，
 *     tools:[]/tool_choice:none/json_schema，MODEL_VISIBLE_TOOL_COUNT=0）→ 递归至收敛。
 *   - 收敛不变量（T9）：if nodeCount==1 terminate；2<=childCount<=MAX_CHILDREN_PER_NODE；
 *     禁 single-child；nextLevel.nodeCount < currentLevel.nodeCount 严格递减；
 *     hierarchy_input_too_large / hierarchy_runtime_budget_unknown fail closed。
 *   - 输出 work/hierarchy/nodes/<nodeId>.json + work/hierarchy/manifest.json（原子写）。
 *   - 幂等：inputHash+childHashes+版本+runtime 全匹配才复用（FILE EXISTS != VALID CACHE）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { runChunkMap } from '../lib/lmstudio-map-executor.mjs';
import { runToolLessMap } from '../lib/lmstudio-tool-less.mjs';
import { mapConfidence } from '../lib/lmstudio-projection.mjs';
import {
  buildAggregationNode,
  buildHierarchyProjection,
  computeNodeHash,
  finalizeAggregationNode,
  HIERARCHY_CONTRACT_VERSION,
  NODE_SCHEMA_VERSION,
  packGroups,
  resolveProfileParams,
  REVIEWED_HIERARCHY_RUNTIME,
} from '../lib/hierarchy.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const has = (name) => process.argv.includes(name);

function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel || '.';
}

/** 将已验证的 L1 map 结果转换为 hierarchy L1 节点（nodeId = chunkId；inputHash = chunkHash） */
export function toHierarchyL1(map) {
  const node = {
    schemaVersion: NODE_SCHEMA_VERSION,
    hierarchyContractVersion: HIERARCHY_CONTRACT_VERSION,
    level: 0,
    nodeId: map.chunkId,
    children: [],
    childHashes: [],
    canonicalSourceIds: [...map.sourceIds],
    inputHash: map.chunkHash,
    runtime: REVIEWED_HIERARCHY_RUNTIME,
    claims: (map.claims ?? []).map((c) => ({
      claim: c.claim,
      evidenceSourceIds: [...c.evidenceSourceIds],
      confidence: c.confidence,
    })),
    minorityViews: [...(map.minorityViews ?? [])],
    uncertainties: [...(map.uncertainties ?? [])],
  };
  node.nodeHash = computeNodeHash(node);
  return node;
}

/**
 * 合成一个聚合层（每组 1 次模型调用，经 T6 控制器）。
 * @param {number} level 目标层（>=1）
 * @param {Array<object>} nodes 已验证子节点（level-1 节点）
 * @param {{maxChildren: number, maxProjectedBytes: number}} params
 * @param {Map<string, object>} existingNodes 已有节点（幂等复用）
 * @param {string} nodesDir node 文件目录
 * @returns {Promise<Array<object>>} 本层合成节点
 */
async function synthesizeLevel(level, nodes, params, existingNodes, nodesDir, run = runToolLessMap) {
  const groups = packGroups(nodes, params);
  const next = [];
  for (let gi = 0; gi < groups.length; gi += 1) {
    const g = groups[gi];
    const nodeId = `level-${level}-node-${String(gi + 1).padStart(4, '0')}`;
    const token = String(gi + 1);
    const agg = buildAggregationNode({ nodeId, level, children: g, effectiveParams: params });
    // 幂等：inputHash 匹配 + childHashes 匹配 + 版本/runtime 匹配 → 复用（FILE EXISTS != VALID CACHE）
    const nodeFile = path.join(nodesDir, `${nodeId}.json`);
    const existing = existingNodes.get(nodeId) ?? (fs.existsSync(nodeFile)
      ? (() => { try { return JSON.parse(fs.readFileSync(nodeFile, 'utf8')); } catch { return null; } })()
      : null);
    if (existing
      && existing.inputHash === agg.inputHash
      && existing.hierarchyContractVersion === HIERARCHY_CONTRACT_VERSION
      && existing.schemaVersion === NODE_SCHEMA_VERSION
      && existing.runtime === REVIEWED_HIERARCHY_RUNTIME
      && JSON.stringify(existing.childHashes) === JSON.stringify(agg.childHashes)) {
      next.push(existing);
      console.log(`  复用聚合节点: ${nodeId}（${g.length} 子节点，inputHash 匹配）`);
      continue;
    }
    // 新合成：确定性投影 → T6 控制器（tool-less, json_schema, MODEL_VISIBLE_TOOL_COUNT=0）
    const projection = buildHierarchyProjection({ token, nodeId, children: g });
    const result = await run({ projection });
    // T11-R1 #27：模型不再回显身份；controller 从 trusted 请求状态归属节点身份。
    // 校验仅针对 summary/stance/confidence（枚举），且禁止模型输出 sourceId 字段。
    if (!result || typeof result !== 'object'
      || typeof result.summary !== 'string'
      || result.summary.trim() === ''
      || !['positive', 'neutral', 'negative'].includes(result.stance)
      || !['high', 'medium', 'low'].includes(result.confidence)
      || Object.hasOwn(result, 'sourceId')) {
      throw new Error(`capability_isolation_unavailable: 聚合节点 ${nodeId} 模型输出不符合协议`);
    }
    // 综合 claim：evidence = 本节点 union（controller 确定性赋予；LLM 不得发明证据）
    const claims = [{
      claim: result.summary,
      evidenceSourceIds: [...agg.canonicalSourceIds],
      confidence: mapConfidence(result.confidence),
    }];
    const finalized = finalizeAggregationNode(agg, { claims });
    const tmp = `${nodeFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(finalized, null, 2), 'utf8');
    fs.renameSync(tmp, nodeFile);
    next.push(finalized);
    console.log(`  合成聚合节点: ${nodeId}（${g.length} 子节点 → union ${agg.canonicalSourceIds.length} 来源）`);
  }
  return next;
}

/**
 * 构建自适应层级（T9 批准合同）。
 * @param {Array<object>} l1Nodes 已验证 L1 节点
 * @param {{maxChildren: number, maxProjectedBytes: number}} params
 * @param {string} hierarchyDir work/hierarchy
 * @returns {Promise<{manifest: object, nodesByLevel: Map<number, Map<string, object>>, topNodes: Array<object>}>}
 */
export async function buildHierarchy(l1Nodes, params, hierarchyDir, run = runToolLessMap) {
  const nodesDir = path.join(hierarchyDir, 'nodes');
  fs.mkdirSync(nodesDir, { recursive: true });
  const nodesByLevel = new Map();
  const existingNodes = new Map();

  // L1 节点持久化（internal artifact；顶层未聚合时 reduce 从 nodes 读取统一口径）
  for (const l1 of l1Nodes) {
    const nodeFile = path.join(nodesDir, `${l1.nodeId}.json`);
    if (!fs.existsSync(nodeFile)) {
      const tmp = `${nodeFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(l1, null, 2), 'utf8');
      fs.renameSync(tmp, nodeFile);
    }
    existingNodes.set(l1.nodeId, l1);
  }

  let levelNodes = l1Nodes;
  let levelNum = 0;
  // 收敛：nodeCount==1 或 未超限（count<=maxChildren 且投影<=预算）→ 终止
  while (levelNodes.length > 1) {
    const totalProjectionBytes = buildHierarchyProjection({
      token: 'x', nodeId: 'x', children: levelNodes,
    }).text.length;
    if (levelNodes.length <= params.maxChildren && totalProjectionBytes <= params.maxProjectedBytes) {
      break; // 顶层可被 final reduce 直接消费
    }
    levelNum += 1;
    const next = await synthesizeLevel(levelNum, levelNodes, params, existingNodes, nodesDir, run);
    for (const n of next) existingNodes.set(n.nodeId, n);
    nodesByLevel.set(levelNum, new Map(next.map((n) => [n.nodeId, n])));
    if (next.length >= levelNodes.length) {
      // 理论上不可能（分组严格递减），防御性 fail closed
      throw new Error('capability_isolation_unavailable: 层级未严格递减（违反收敛不变量）');
    }
    levelNodes = next;
  }

  const manifest = {
    schemaVersion: 1,
    hierarchyContractVersion: HIERARCHY_CONTRACT_VERSION,
    effectiveParams: params,
    runtime: REVIEWED_HIERARCHY_RUNTIME,
    l1Count: l1Nodes.length,
    levels: [...nodesByLevel.keys()],
    nodeCountByLevel: Object.fromEntries([...nodesByLevel].map(([l, m]) => [l, m.size])),
    topLevel: levelNum,
    topNodeIds: levelNodes.map((n) => n.nodeId),
    createdAt: new Date().toISOString(),
  };
  const manifestFile = path.join(hierarchyDir, 'manifest.json');
  const tmp = `${manifestFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, manifestFile);
  return { manifest, nodesByLevel, topNodes: levelNodes };
}

async function main() {
  const workDir = path.resolve(arg('--work', 'work'));
  const chunksDir = path.join(workDir, 'chunks');
  const mapsDir = path.join(workDir, 'map-results');
  const hierarchy = has('--hierarchy');
  // profile 参数：未显式提供时使用引擎 safe defaults（flat 模式不得因缺省参数失败）
  const maxChildrenArg = arg('--max-children', undefined);
  const maxProjArg = arg('--max-projected-bytes', undefined);
  const params = resolveProfileParams({
    ...(maxChildrenArg !== undefined ? { maxChildren: maxChildrenArg } : {}),
    ...(maxProjArg !== undefined ? { maxProjectedBytes: maxProjArg } : {}),
  });

  if (!fs.existsSync(chunksDir)) {
    console.error('未找到 chunk 目录（先运行 scripts/chunk.mjs --work work/ --mode digest|top-percent-analysis）');
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

  if (hierarchy) {
    // L1 maps → hierarchy L1 节点
    const l1Nodes = [];
    for (const name of chunkFiles) {
      const mapPath = path.join(mapsDir, `map-${name}`);
      if (!fs.existsSync(mapPath)) {
        console.error(`hierarchy 前置缺失 L1 map: ${mapPath}`);
        process.exit(1);
      }
      const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      if (map.chunkHash !== undefined && map.chunkHash !== '') l1Nodes.push(toHierarchyL1(map));
      else {
        console.error(`hierarchy 前置 L1 map 无效: ${mapPath}`);
        process.exit(1);
      }
    }
    const hierarchyDir = path.join(workDir, 'hierarchy');
    const { manifest } = await buildHierarchy(l1Nodes, params, hierarchyDir, runToolLessMap);
    console.log(`hierarchy 完成：L1=${manifest.l1Count}，聚合层=${manifest.levels.join('/') || '(无，flat 等价)'}，顶层节点=${manifest.topNodeIds.length}`);
    console.log(`hierarchy manifest: ${displayPath(path.join(hierarchyDir, 'manifest.json'))}`);
  }
}

// 仅作为 CLI 直接运行时执行 main（被测试 import 时不得执行）
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  });
}
