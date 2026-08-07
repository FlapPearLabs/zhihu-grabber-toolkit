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

  // 少数观点与反对意见：uncertainties 去重保留
  const minorityViews = [];
  for (const m of maps) {
    for (const c of m.uncertainties ?? []) {
      const key = String(c).trim();
      if (!key) continue;
      if (!minorityViews.some((v) => v.statement === key)) {
        minorityViews.push({ statement: key, noted: true });
      }
    }
  }

  // 未验证推断：confidence=low 的 claims
  const unverifiedInferences = claims
    .filter((c) => c.confidence === 'low')
    .map((c) => ({ claim: c.claim, evidenceSourceIds: c.evidenceSourceIds }));

  // reduce-input（供 LLM 撰写最终文档的结构化输入）
  const reduceInput = {
    schemaVersion: 1,
    mode: 'digest',
    inputCount: manifest.inputs.length,
    chunkCount: maps.length,
    themes,
    claims,
    minorityViews,
    uncertainties: minorityViews.map((v) => v.statement),
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

  // 最终文档草稿：机械合并（LLM 应基于此完善，来源 ID 必须保留）
  const out = arg('--out', path.join(finalDir, 'digest.md'));
  const L = [];
  L.push('# 语料全覆盖摘要（digest 草稿）');
  L.push('');
  L.push(`> 覆盖 ${reduceInput.inputCount} 条回答 / ${reduceInput.chunkCount} 个 chunk。`);
  L.push(`> 说明：本文件由 reduce 机械合并生成；最终版本应在保留 [sourceId] 引用的前提下完善。`);
  L.push('');
  L.push('## 主题分布');
  for (const t of themes) L.push(`- ${t.theme}（${t.chunkCount} 个 chunk）`);
  L.push('');
  L.push('## 主要观点（claims）');
  claims.forEach((c, i) => {
    L.push(`### ${i + 1}. ${c.claim}`);
    L.push(`- 来源: ${c.evidenceSourceIds.map((s) => `[${s}]`).join(' ')}`);
    L.push(`- 置信度: ${c.confidence}${c.highVoteSources > 0 ? `；高赞来源 ${c.highVoteSources} 个（仅传播度，非真实性证据）` : ''}`);
    L.push('');
  });
  L.push('## 少数观点与不确定性');
  for (const v of minorityViews) L.push(`- ${v.statement}`);
  L.push('');
  L.push('## 未经验证的推断');
  for (const u of unverifiedInferences) {
    L.push(`- ${u.claim}（来源: ${u.evidenceSourceIds.map((s) => `[${s}]`).join(' ')}，置信度 low）`);
  }
  L.push('');
  fs.writeFileSync(out, L.join('\n'), 'utf8');

  const relOut = path.relative(process.cwd(), out) || '.';
  const relReduce = path.relative(process.cwd(), reduceInputFile) || '.';
  console.log(`reduce-input: ${relReduce}`);
  console.log(`最终文档草稿: ${relOut}`);
  console.log(`主题 ${themes.length} 个 / claims ${claims.length} 条 / 少数观点 ${minorityViews.length} 条`);
}

main();
