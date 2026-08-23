#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * reduce — digest 模式：合并已验证的 map 结果。
 *
 * 用法:
 *   node scripts/reduce.mjs --work work/ [--out work/final/digest.md]
 *
 * 规则:
 *   - 只基于当前 manifest、map-results 合并；不重新读取原文。
 *   - 不信任旧 coverage 文件：启动时重新校验当前 map 集合
 *     （manifestHash / mapSetHash 与 coverage 快照一致才继续）。
 *   - 损坏的 map 结果视为失败，**不得静默跳过**。
 *   - 合并重复主题（按 chunk 计数，不冒充来源数）；保留少数观点和反对意见。
 *   - 区分高赞与代表性：高赞（voteupCount 高）≠ 真实性，仅标注传播度。
 *   - 保留来源 ID；明确未经验证的推断；不生成来源中不存在的结论。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { renderDigest } from './render-final.mjs';
import { validateSelection } from '../lib/top-percent-selector.mjs';
import { computeNodeHash } from '../lib/hierarchy.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256Of(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel || '.';
}

/** top-percent-analysis 披露块（D2.8 + D6 OPTION C）：mode 恒为 top-percent-analysis
 *  isFullCoverage 为覆盖事实：selectedSourceIds 与 original 集合比较。因 selectedSourceIds
 *  来自同一候选集（无重复、无外部 ID），「selected == original」⟺「长度相等」。
 */
function buildDisclosure(selection) {
  const selectedSourceIds = selection.selectedSourceIds;
  const totalAnswers = selection.originalTotal;
  return {
    mode: 'top-percent-analysis',
    totalAnswers,
    selectedAnswers: selectedSourceIds.length,
    requestedPercent: selection.requestedPercent,
    actualCoveragePercent: `${((selectedSourceIds.length / totalAnswers) * 100).toFixed(1)}`,
    selectionRule: selection.selectionRule,
    selectedSourceIds,
    isFullCoverage: selectedSourceIds.length === totalAnswers,
  };
}

function main() {
  const workDir = path.resolve(arg('--work', 'work'));
  const manifestFile = path.join(workDir, 'manifest.json');
  const coverageFile = path.join(workDir, 'coverage.json');
  const mapDir = path.join(workDir, 'map-results');

  if (!fs.existsSync(manifestFile)) {
    console.error(`manifest 不存在: ${manifestFile}（请先运行 chunk.mjs）`);
    process.exit(2);
  }
  if (!fs.existsSync(coverageFile)) {
    console.error(`coverage 报告不存在: ${coverageFile}（请先运行 verify.mjs）`);
    process.exit(2);
  }

  const manifest = readJson(manifestFile);
  const coverage = readJson(coverageFile);

  // 重新校验当前状态：不信任旧 coverage
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  const currentManifestHash = sha256Of(manifestText);
  if (coverage.manifestHash !== currentManifestHash) {
    console.error('manifest 已变化（与 coverage 快照不一致），请重新运行 chunk.mjs 与 verify.mjs');
    process.exit(1);
  }

  if (!fs.existsSync(mapDir)) {
    console.error(`map-results 目录不存在: ${mapDir}`);
    process.exit(1);
  }

  // ---- hierarchy 模式（T10 #16 / T9 合同）：若 hierarchy manifest 存在，
  //      顶层撰写输入 = 顶层聚合节点 claims（组级综合），而非全部 L1 map claims。
  //      final.json 消费合同不变（mode="digest" + claims + evidenceSourceIds +
  //      minorityViews/uncertainties）；hierarchy 为 internal execution structure。
  //      门禁：coverage 必须验证通过（含 hierarchyIssues==0），否则 fail closed。 ----
  const hierarchyManifestFile = path.join(workDir, 'hierarchy', 'manifest.json');
  let hierarchyInfo = null;
  if (fs.existsSync(hierarchyManifestFile)) {
    if (coverage.valid !== true) {
      console.error('覆盖率验证未通过（含 hierarchy 校验），禁止 hierarchical reduce（请先修复并重新 verify.mjs）');
      process.exit(1);
    }
    const hManifest = readJson(hierarchyManifestFile);
    const topNodes = hManifest.topNodeIds.map((id) => readJson(path.join(workDir, 'hierarchy', 'nodes', `${id}.json`)));
    // 纵深防御：顶层节点 nodeHash 自检（verify 后篡改节点文件 → 拒绝；FAIL CLOSED）
    for (const n of topNodes) {
      if (typeof n?.nodeHash !== 'string' || n.nodeHash !== computeNodeHash(n)) {
        console.error(`hierarchy 顶层节点 hash 校验失败（节点可能被篡改）: ${n?.nodeId ?? '(unknown)'}`);
        process.exit(1);
      }
    }
    hierarchyInfo = {
      levels: hManifest.levels,
      nodeCountByLevel: hManifest.nodeCountByLevel,
      topLevel: hManifest.topLevel,
      topNodeIds: hManifest.topNodeIds,
      effectiveParams: hManifest.effectiveParams,
      l1Count: hManifest.l1Count,
    };
    // 顶层节点 claims 作为聚合视图（evidence 已由 controller 校验 ⊆ 各节点 union）
    const claims = topNodes.flatMap((n) => n.claims ?? []);
    const minorityViews = [...new Set(topNodes.flatMap((n) => n.minorityViews ?? []))];
    const uncertainties = [...new Set(topNodes.flatMap((n) => n.uncertainties ?? []))];
    const themes = [];
    const unverifiedInferences = claims
      .filter((c) => c.confidence === 'low')
      .map((c) => ({ claim: c.claim, evidenceSourceIds: c.evidenceSourceIds }));

    // reduce-input（internal；供 LLM 撰写最终文档）
    const reduceInput = {
      schemaVersion: 1,
      mode: 'digest',
      inputCount: manifest.inputs.length,
      chunkCount: hManifest.l1Count,
      hierarchy: hierarchyInfo,
      themes,
      claims,
      minorityViews,
      uncertainties,
      unverifiedInferences,
      sourceIndex: Object.fromEntries(
        [...new Set(manifest.inputs.map((i) => i.sourceId))].map((sid) => [sid, {
          questionId: manifest.inputs.find((i) => i.sourceId === sid)?.questionId,
          answerId: manifest.inputs.find((i) => i.sourceId === sid)?.answerId,
          relativePath: manifest.inputs.find((i) => i.sourceId === sid)?.relativePath,
          voteupCount: manifest.inputs.find((i) => i.sourceId === sid)?.voteupCount,
        }]),
      ),
      note: 'hierarchical full digest（T10）：顶层节点为组级综合 claim，evidence 为各节点 canonical source union；hierarchical 输出与 flat 模型合成输出无需 byte-for-byte 相同。',
    };

    const finalDir = path.join(workDir, 'final');
    fs.mkdirSync(finalDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'reduce-input.json'), JSON.stringify(reduceInput, null, 2), 'utf8');

    // canonical final.json（消费合同不变：mode="digest"）
    const finalJson = {
      schemaVersion: 1,
      mode: 'digest',
      inputCount: manifest.inputs.length,
      chunkCount: hManifest.l1Count,
      claims: claims.map((c) => ({
        text: c.claim,
        evidenceSourceIds: c.evidenceSourceIds,
        confidence: c.confidence,
      })),
      minorityViews,
      uncertainties,
    };
    fs.writeFileSync(path.join(finalDir, 'final.json'), JSON.stringify(finalJson, null, 2), 'utf8');

    const out = arg('--out', path.join(finalDir, 'digest.md'));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, renderDigest(finalJson), 'utf8');

    console.log(`reduce-input: ${displayPath(path.join(workDir, 'reduce-input.json'))}`);
    console.log(`final.json: ${displayPath(path.join(finalDir, 'final.json'))}`);
    console.log(`digest.md: ${displayPath(out)}`);
    console.log(`hierarchical digest（T10）：L1=${hManifest.l1Count}，顶层=${hManifest.topNodeIds.length} 节点，claims=${claims.length} 条 / 少数观点 ${minorityViews.length} 条 / 不确定性 ${uncertainties.length} 条`);
    return;
  }

  const mapFiles = fs.readdirSync(mapDir).filter((f) => f.endsWith('.json')).sort();
  const maps = [];
  for (const f of mapFiles) {
    let map;
    try {
      map = readJson(path.join(mapDir, f));
    } catch (error) {
      console.error(`map 结果损坏，禁止 reduce（不能静默跳过）: ${f} — ${error.message}`);
      process.exit(1);
    }
    if (map.status === 'failed') {
      console.error(`map 标记为失败，禁止 reduce: ${f}`);
      process.exit(1);
    }
    maps.push(map);
  }

  // mapSetHash 与 coverage 快照一致（map 在 verify 之后被修改 → 拒绝）
  const mapSetText = maps
    .map((m) => `${'map-' + (m.chunkId ?? 'unknown') + '.json'}:${JSON.stringify(m)}`)
    .sort((a, b) => a.localeCompare(b))
    .join('\n');
  const currentMapSetHash = sha256Of(mapSetText);
  if (coverage.mapSetHash !== currentMapSetHash) {
    console.error('map 集合已变化（与 coverage 快照不一致，可能被篡改），请重新运行 verify.mjs');
    process.exit(1);
  }
  if (coverage.valid !== true) {
    console.error('覆盖率验证未通过，禁止 reduce（请先修复并重新 verify.mjs）');
    process.exit(1);
  }

  // top-percent-analysis：读取并校验 selection.json，构建披露块（D2.8）
  let disclosure = null;
  if (manifest.mode === 'top-percent-analysis') {
    const selectionFile = path.join(workDir, 'selection.json');
    if (!fs.existsSync(selectionFile)) {
      console.error('top-percent-analysis 缺少 selection.json（请先运行 scripts/select.mjs 与 chunk.mjs --mode top-percent-analysis）');
      process.exit(1);
    }
    let selection;
    try {
      selection = validateSelection(readJson(selectionFile));
    } catch (error) {
      console.error(`selection.json 非法: ${error.message}`);
      process.exit(1);
    }
    if (manifest.selectionHash !== selection.selectorHash) {
      console.error('manifest.selectionHash 与 selection.selectorHash 不一致（chunk 与 selection 不同步）');
      process.exit(1);
    }
    disclosure = buildDisclosure(selection);
  }

  const validSources = new Set(manifest.inputs.map((i) => i.sourceId));
  const sourceMeta = new Map(manifest.inputs.map((i) => [i.sourceId, i]));

  // 合并主题（按 chunk 计数，不冒充来源数）
  const themeCount = new Map();
  for (const m of maps) {
    for (const t of m.themes ?? []) {
      const key = String(t).trim();
      if (key) themeCount.set(key, (themeCount.get(key) ?? 0) + 1);
    }
  }
  const themes = [...themeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([theme, count]) => ({ theme, chunkCount: count }));

  // 合并 claims：去重（同文本），保留来源与置信度
  const claims = [];
  const claimIndex = new Map();
  for (const m of maps) {
    for (const c of m.claims ?? []) {
      const text = String(c.claim ?? '').trim();
      if (!text) continue;
      const key = text;
      if (claimIndex.has(key)) {
        const existing = claimIndex.get(key);
        existing.evidenceSourceIds = [...new Set([...existing.evidenceSourceIds, ...(c.evidenceSourceIds ?? [])])];
        const order = { high: 3, medium: 2, low: 1 };
        if (order[c.confidence] > order[existing.confidence]) existing.confidence = c.confidence;
      } else {
        const entry = {
          claim: text,
          evidenceSourceIds: [...new Set(c.evidenceSourceIds ?? [])],
          confidence: c.confidence ?? 'low',
          // 标注传播度（高赞来源数），不代表真实性
          highVoteSources: (c.evidenceSourceIds ?? []).filter((sid) => {
            const meta = sourceMeta.get(sid);
            return meta && Number(meta.voteupCount) >= 1000;
          }).length,
        };
        claimIndex.set(key, entry);
        claims.push(entry);
      }
    }
  }

  // 少数观点（map.minorityViews 显式标注的少数派观点）与不确定性（map.uncertainties）
  // 两者语义不同：minorityViews = 少数人的不同观点；uncertainties = 表达不明确/无法核实。
  const minorityViews = [];
  for (const m of maps) {
    for (const c of m.minorityViews ?? []) {
      const key = String(c).trim();
      if (!key) continue;
      if (!minorityViews.includes(key)) minorityViews.push(key);
    }
  }
  const uncertainties = [];
  for (const m of maps) {
    for (const c of m.uncertainties ?? []) {
      const key = String(c).trim();
      if (!key) continue;
      if (!uncertainties.includes(key)) uncertainties.push(key);
    }
  }

  // 未验证推断：confidence=low 的 claims
  const unverifiedInferences = claims
    .filter((c) => c.confidence === 'low')
    .map((c) => ({ claim: c.claim, evidenceSourceIds: c.evidenceSourceIds }));

  // reduce-input（供 LLM 撰写最终文档的结构化输入）
  const reduceInput = {
    schemaVersion: 1,
    mode: manifest.mode ?? 'digest',
    ...(disclosure ?? {}),
    inputCount: manifest.inputs.length,
    chunkCount: maps.length,
    themes,
    claims,
    minorityViews,
    uncertainties,
    unverifiedInferences,
    sourceIndex: Object.fromEntries(
      [...validSources].map((sid) => [sid, {
        questionId: sourceMeta.get(sid)?.questionId,
        answerId: sourceMeta.get(sid)?.answerId,
        relativePath: sourceMeta.get(sid)?.relativePath,
        voteupCount: sourceMeta.get(sid)?.voteupCount,
      }]),
    ),
    note: 'highVoteSources 仅表示传播度（高赞来源数量），不构成真实性证据。confidence 由 map 阶段标注。',
  };

  const finalDir = path.join(workDir, 'final');
  fs.mkdirSync(finalDir, { recursive: true });

  const reduceInputFile = path.join(workDir, 'reduce-input.json');
  fs.writeFileSync(reduceInputFile, JSON.stringify(reduceInput, null, 2), 'utf8');

  // canonical 最终产物：final.json（结构化，每个 claim 携带 evidenceSourceIds）
  // digest.md 只是展示层，由 render-final.mjs 确定性渲染（LLM 完善时改 final.json，不改 md）。
  const finalJson = {
    schemaVersion: 1,
    mode: manifest.mode ?? 'digest',
    ...(disclosure ?? {}),
    inputCount: manifest.inputs.length,
    chunkCount: maps.length,
    claims: claims.map((c) => ({
      text: c.claim,
      evidenceSourceIds: c.evidenceSourceIds,
      confidence: c.confidence,
    })),
    minorityViews,
    uncertainties,
  };
  const finalJsonFile = path.join(finalDir, 'final.json');
  fs.writeFileSync(finalJsonFile, JSON.stringify(finalJson, null, 2), 'utf8');

  const out = arg('--out', path.join(finalDir, 'digest.md'));
  // P2-2：自定义 --out 指向不存在的多级目录时自动创建父目录
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, renderDigest(finalJson), 'utf8');

  const relOut = path.relative(process.cwd(), out) || '.';
  const relReduce = path.relative(process.cwd(), reduceInputFile) || '.';
  const relFinal = path.relative(process.cwd(), finalJsonFile) || '.';
  console.log(`reduce-input: ${relReduce}`);
  console.log(`final.json: ${relFinal}`);
  console.log(`digest.md: ${relOut}`);
  console.log(`主题 ${themes.length} 个 / claims ${claims.length} 条 / 少数观点 ${minorityViews.length} 条 / 不确定性 ${uncertainties.length} 条`);
}

main();
