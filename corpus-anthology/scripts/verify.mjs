#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * verify — digest 覆盖率验证 / 最终引用验证 / handoff 输入验证。
 *
 * 用法:
 *   node scripts/verify.mjs --work work/                    # 覆盖率验证
 *   node scripts/verify.mjs --work work/ --final <file.md>  # 最终引用验证
 *   node scripts/verify.mjs --handoff <handoff.json>        # handoff 输入验证
 *
 * 完整性保障:
 *   - map 结果必须回传 chunkHash，且与当前 chunk 的 chunkHash 一致
 *     （输入变化重建后，旧 map 因 hash 不匹配而失效）。
 *   - map.sourceIds ⊆ 当前 chunk.sourceIds；
 *     claim.evidenceSourceIds ⊆ 当前 chunk.sourceIds（禁止跨 chunk 引用）。
 *   - 同一 chunk 只允许一个 map 结果。
 *   - coverage 记录 manifestHash 与 mapSetHash，供 reduce 校验当前状态。
 *   - 覆盖率报告写入 work/coverage.json；任一校验失败退出码非 0。
 *   - handoff 校验完整执行共享 schema 的约束（required/enum/pattern/array/相对路径）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** 共享 handoff schema（仓库级，两个 Skill 的唯一事实来源） */
const HANDOFF_SCHEMA_FILE = fileURLToPath(new URL('../../references/zhihu-corpus-handoff.schema.json', import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const has = (name) => process.argv.includes(name);

function sha256Of(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadManifest(workDir) {
  const manifestFile = path.join(workDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`manifest 不存在: ${displayPath(manifestFile)}（请先运行 chunk.mjs）`);
  }
  return readJson(manifestFile);
}

function listChunks(workDir) {
  const chunksDir = path.join(workDir, 'chunks');
  const chunks = new Map();
  if (fs.existsSync(chunksDir)) {
    for (const f of fs.readdirSync(chunksDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const chunk = readJson(path.join(chunksDir, f));
        chunks.set(chunk.chunkId, chunk);
      } catch {
        // 损坏 chunk 由 coverage 报告
      }
    }
  }
  return chunks;
}

function listMaps(workDir) {
  const mapDir = path.join(workDir, 'map-results');
  const maps = [];
  if (fs.existsSync(mapDir)) {
    for (const f of fs.readdirSync(mapDir).sort()) {
      if (!f.endsWith('.json')) continue;
      try {
        const map = readJson(path.join(mapDir, f));
        maps.push({ file: f, map });
      } catch (error) {
        maps.push({ file: f, map: null, error: error.message });
      }
    }
  }
  return maps;
}

/** 覆盖率验证（digest 完成判定） */
function verifyCoverage(workDir, manifest) {
  const chunks = listChunks(workDir);
  const maps = listMaps(workDir);
  const report = {
    valid: true,
    missingSources: 0,
    duplicateAssignments: 0,
    failedChunks: 0,
    invalidEvidenceRefs: 0,
    missingMapResults: 0,
    staleHashes: 0,
    staleMaps: 0,
    crossChunkEvidence: 0,
    malformedMaps: 0,
    duplicateMaps: 0,
    missingMappedSources: 0,
    issues: [],
  };

  // 2. 每个输入进入某个 chunk
  for (const input of manifest.inputs) {
    if (!input.chunkIds || input.chunkIds.length === 0) {
      report.missingSources += 1;
      report.issues.push(`输入未进入任何 chunk: ${input.sourceId}`);
    } else {
      for (const cid of input.chunkIds) {
        if (!chunks.has(cid)) {
          report.missingSources += 1;
          report.issues.push(`输入引用的 chunk 不存在: ${input.sourceId} → ${cid}`);
        }
      }
    }
  }

  // 3+4. 每个 chunk 可解析、sourceIds 有效且无重复分配
  const validSources = new Set(manifest.inputs.map((i) => i.sourceId));
  for (const [cid, chunk] of chunks) {
    if (chunk.status === 'failed') {
      report.failedChunks += 1;
      report.issues.push(`chunk 标记为失败: ${cid}`);
    }
    if (!chunk.chunkHash) {
      report.failedChunks += 1;
      report.issues.push(`chunk 缺少 chunkHash: ${cid}`);
      continue;
    }
    if (!Array.isArray(chunk.sourceIds)) {
      report.failedChunks += 1;
      report.issues.push(`chunk 缺少 sourceIds 数组: ${cid}`);
      continue;
    }
    const localSeen = new Set();
    for (const sid of chunk.sourceIds) {
      if (localSeen.has(sid)) {
        report.duplicateAssignments += 1;
        report.issues.push(`chunk 内重复来源: ${cid} → ${sid}`);
      }
      localSeen.add(sid);
      if (!validSources.has(sid)) {
        report.invalidEvidenceRefs += 1;
        report.issues.push(`chunk 引用未知来源: ${cid} → ${sid}`);
      }
    }
  }

  // 5+6. map 结果校验：chunkHash 绑定 + map 全覆盖 + evidence ⊆ 当前 chunk
  const mappedChunks = new Map();
  const expectedMapFile = (cid) => `map-${cid}.json`;
  for (const { file, map, error } of maps) {
    if (map === null) {
      report.malformedMaps += 1;
      report.issues.push(`map 结果损坏: ${file} — ${error}`);
      continue;
    }
    const cid = map.chunkId;
    if (!cid || !chunks.has(cid)) {
      report.invalidEvidenceRefs += 1;
      report.issues.push(`map 引用的 chunk 不存在: ${file} → ${cid ?? '(缺失)'}`);
      continue;
    }
    // 文件名必须与 chunkId 对应
    if (file !== expectedMapFile(cid)) {
      report.malformedMaps += 1;
      report.issues.push(`map 文件名与 chunkId 不一致: ${file} → ${cid}`);
      continue;
    }
    // 同一 chunk 只允许一个 map
    if (mappedChunks.has(cid)) {
      report.duplicateMaps += 1;
      report.issues.push(`同一 chunk 存在多个 map 结果: ${cid}（${mappedChunks.get(cid)} 与 ${file}）`);
      continue;
    }
    mappedChunks.set(cid, file);

    const chunk = chunks.get(cid);
    // chunkHash 绑定：map 必须回传与当前 chunk 一致的 chunkHash
    if (!map.chunkHash || map.chunkHash !== chunk.chunkHash) {
      report.staleMaps += 1;
      report.issues.push(`map 的 chunkHash 与当前 chunk 不一致（过期 map）: ${cid}`);
      continue;
    }
    // 字段完整性
    if (!Array.isArray(map.sourceIds) || map.sourceIds.length === 0) {
      report.malformedMaps += 1;
      report.issues.push(`map 缺少 sourceIds 数组: ${cid}`);
      continue;
    }
    if (typeof map.summary !== 'string' || map.summary.trim().length === 0) {
      report.malformedMaps += 1;
      report.issues.push(`map 缺少 summary: ${cid}`);
      continue;
    }
    if (!Array.isArray(map.claims)) {
      report.malformedMaps += 1;
      report.issues.push(`map 缺少 claims 数组: ${cid}`);
      continue;
    }
    const chunkSourceSet = new Set(chunk.sourceIds);
    // P1-NEW-1: map.sourceIds 必须与 chunk.sourceIds 集合**相等**
    //   （map 声明了本 chunk 实际覆盖哪些来源 → 必须全部覆盖，不能只摘要一部分）
    const mapSourceSet = new Set(map.sourceIds);
    for (const sid of map.sourceIds) {
      if (!chunkSourceSet.has(sid)) {
        report.crossChunkEvidence += 1;
        report.issues.push(`map.sourceIds 引用非本 chunk 来源: ${cid} → ${sid}`);
      }
    }
    const unmapped = chunk.sourceIds.filter((sid) => !mapSourceSet.has(sid));
    if (unmapped.length > 0) {
      report.missingMappedSources += unmapped.length;
      report.issues.push(`map 未覆盖本 chunk 的全部来源: ${cid} → 缺 ${unmapped.join(', ')}`);
    }
    // claim.evidenceSourceIds ⊆ 当前 chunk.sourceIds（claim 证据可以是子集）
    for (const [i, claim] of map.claims.entries()) {
      if (!claim || typeof claim !== 'object') {
        report.malformedMaps += 1;
        report.issues.push(`claim 结构非法: ${cid} → claims[${i}]`);
        continue;
      }
      if (typeof claim.claim !== 'string' || claim.claim.trim().length === 0) {
        report.malformedMaps += 1;
        report.issues.push(`claim 缺少文本: ${cid} → claims[${i}]`);
        continue;
      }
      if (!Array.isArray(claim.evidenceSourceIds) || claim.evidenceSourceIds.length === 0) {
        report.malformedMaps += 1;
        report.issues.push(`claim 缺少 evidenceSourceIds: ${cid} → claims[${i}]`);
        continue;
      }
      if (!['high', 'medium', 'low'].includes(claim.confidence)) {
        report.malformedMaps += 1;
        report.issues.push(`claim.confidence 非法: ${cid} → claims[${i}]（${claim.confidence}）`);
        continue;
      }
      for (const ev of claim.evidenceSourceIds) {
        if (!chunkSourceSet.has(ev)) {
          report.crossChunkEvidence += 1;
          report.issues.push(`claim 引用非本 chunk 来源（跨 chunk）: ${cid} → ${ev}`);
        }
      }
    }
    // themes/uncertainties 数组
    if (!Array.isArray(map.themes)) {
      report.malformedMaps += 1;
      report.issues.push(`map 缺少 themes 数组: ${cid}`);
    }
    if (!Array.isArray(map.uncertainties)) {
      report.malformedMaps += 1;
      report.issues.push(`map 缺少 uncertainties 数组: ${cid}`);
    }
    if (map.minorityViews !== undefined && !Array.isArray(map.minorityViews)) {
      report.malformedMaps += 1;
      report.issues.push(`map.minorityViews 必须是数组: ${cid}`);
    }
    // P1-1 sourceCoverage：逐来源覆盖记录（证明"每个输入来源都有结构化处理痕迹"，
    // 而不是只声明 ID 出现过）。强制：
    //   set(sourceCoverage.sourceId) === set(chunk.sourceIds)（全覆盖）
    //   每条恰好一次、无重复、summary/disposition 至少一个有效处理结果。
    if (!Array.isArray(map.sourceCoverage) || map.sourceCoverage.length === 0) {
      report.malformedMaps += 1;
      report.issues.push(`map 缺少 sourceCoverage 数组（逐来源覆盖记录）: ${cid}`);
    } else {
      const scIds = new Set();
      for (const [i, sc] of map.sourceCoverage.entries()) {
        if (!sc || typeof sc !== 'object' || Array.isArray(sc)) {
          report.malformedMaps += 1;
          report.issues.push(`sourceCoverage[${i}] 结构非法: ${cid}`);
          continue;
        }
        if (typeof sc.sourceId !== 'string' || sc.sourceId.trim() === '') {
          report.malformedMaps += 1;
          report.issues.push(`sourceCoverage[${i}] 缺少 sourceId: ${cid}`);
          continue;
        }
        if (scIds.has(sc.sourceId)) {
          report.malformedMaps += 1;
          report.issues.push(`sourceCoverage 重复记录: ${cid} → ${sc.sourceId}`);
          continue;
        }
        scIds.add(sc.sourceId);
        if (!chunkSourceSet.has(sc.sourceId)) {
          report.crossChunkEvidence += 1;
          report.issues.push(`sourceCoverage 引用非本 chunk 来源: ${cid} → ${sc.sourceId}`);
          continue;
        }
        const summary = typeof sc.summary === 'string' ? sc.summary.trim() : '';
        const disposition = sc.disposition;
        if (summary === '' && !['substantive', 'duplicate', 'unclear'].includes(disposition)) {
          report.malformedMaps += 1;
          report.issues.push(`sourceCoverage[${i}] 缺少有效处理记录（summary 或 disposition）: ${cid} → ${sc.sourceId}`);
          continue;
        }
        if (disposition !== undefined && !['substantive', 'duplicate', 'unclear'].includes(disposition)) {
          report.malformedMaps += 1;
          report.issues.push(`sourceCoverage[${i}].disposition 非法: ${cid} → ${disposition}`);
        }
      }
      // 全覆盖：sourceCoverage 的 sourceId 集合必须等于 chunk.sourceIds
      const missingSc = chunk.sourceIds.filter((sid) => !scIds.has(sid));
      if (missingSc.length > 0) {
        report.missingMappedSources += missingSc.length;
        report.issues.push(`sourceCoverage 未覆盖本 chunk 全部来源（缺 ${missingSc.length} 条）: ${cid} → 缺 ${missingSc.join(', ')}`);
      }
    }
  }

  // 8. 无未完成状态：每个 chunk 都有 map 结果
  for (const cid of chunks.keys()) {
    if (!mappedChunks.has(cid)) {
      report.missingMapResults += 1;
      report.issues.push(`chunk 缺少 map 结果: ${cid}`);
    }
  }

  // 7. 输入哈希未变化
  for (const input of manifest.inputs) {
    const abs = path.resolve(workDir, input.relativePath);
    if (!fs.existsSync(abs)) {
      report.staleHashes += 1;
      report.issues.push(`输入文件缺失: ${input.relativePath}`);
      continue;
    }
    const currentHash = sha256Of(fs.readFileSync(abs, 'utf8'));
    if (currentHash !== input.sha256) {
      report.staleHashes += 1;
      report.issues.push(`输入已变化（哈希不一致）: ${input.sourceId}（${input.relativePath}）`);
    }
  }

  // 快照：供 reduce 校验当前状态（不信任旧 coverage）
  const manifestText = fs.readFileSync(path.join(workDir, 'manifest.json'), 'utf8');
  const mapSetText = maps
    .filter((m) => m.map !== null)
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((m) => `${m.file}:${JSON.stringify(m.map)}`)
    .join('\n');
  report.manifestHash = sha256Of(manifestText);
  report.mapSetHash = sha256Of(mapSetText);
  report.chunkHashByChunk = Object.fromEntries([...chunks.entries()].map(([cid, c]) => [cid, c.chunkHash ?? null]));
  report.mapCount = maps.length;

  report.valid =
    report.missingSources === 0
    && report.duplicateAssignments === 0
    && report.failedChunks === 0
    && report.invalidEvidenceRefs === 0
    && report.missingMapResults === 0
    && report.staleHashes === 0
    && report.staleMaps === 0
    && report.crossChunkEvidence === 0
    && report.malformedMaps === 0
    && report.duplicateMaps === 0
    && report.missingMappedSources === 0;

  return report;
}

/** 最终产物验证：final.json 的每个 claim 必须携带 ≥1 个合法证据引用（P1-2） */
function verifyFinal(workDir, manifest, finalFile) {
  const report = { valid: true, invalidRefs: [], validRefs: [], claimsWithoutEvidence: 0 };
  if (!fs.existsSync(finalFile)) {
    report.valid = false;
    report.invalidRefs.push('final.json 不存在');
    return report;
  }
  let final;
  try {
    final = readJson(finalFile);
  } catch (error) {
    report.valid = false;
    report.invalidRefs.push(`final.json 无法解析: ${error.message}`);
    return report;
  }
  if (!Array.isArray(final.claims) || final.claims.length === 0) {
    report.valid = false;
    report.invalidRefs.push('final.json 缺少 claims 数组（没有任何观点）');
    return report;
  }
  const validSources = new Set(manifest.inputs.map((i) => i.sourceId));
  for (const [i, claim] of final.claims.entries()) {
    if (!claim || typeof claim !== 'object') {
      report.claimsWithoutEvidence += 1;
      report.valid = false;
      report.invalidRefs.push(`claims[${i}] 结构非法`);
      continue;
    }
    if (typeof claim.text !== 'string' || claim.text.trim().length === 0) {
      report.claimsWithoutEvidence += 1;
      report.valid = false;
      report.invalidRefs.push(`claims[${i}] 缺少文本`);
      continue;
    }
    const evs = Array.isArray(claim.evidenceSourceIds) ? claim.evidenceSourceIds : [];
    if (evs.length === 0) {
      report.claimsWithoutEvidence += 1;
      report.valid = false;
      report.invalidRefs.push(`claims[${i}] 没有任何来源引用（缺证据）`);
      continue;
    }
    for (const ev of evs) {
      if (validSources.has(ev)) {
        report.validRefs.push(ev);
      } else {
        report.valid = false;
        report.invalidRefs.push(`claims[${i}] 引用无效来源: ${ev}`);
      }
    }
  }
  return report;
}

/**
 * 迷你 JSON Schema 解释器：从共享 schema 读取约束并执行（仅支持本项目 schema 用到的子集：
 * type / required / properties / additionalProperties / enum / const / pattern / minimum / items）。
 * schema 是唯一事实来源，validator 不重复维护结构约束 → 与 schema 永不漂移。
 */
function typeLabel(t) {
  return { string: '字符串', integer: '整数', number: '数字', boolean: '布尔值', array: '数组', object: '对象' }[t] || t;
}

function valueLabel(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return '数组';
  return typeof v;
}

function matchesType(t, v) {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number';
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'null': return v === null;
    default: return true;
  }
}

function validateBySchema(schema, data, p = '$') {
  const issues = [];
  if (!schema || typeof schema !== 'object') return issues;
  if (schema.type !== undefined && !matchesType(schema.type, data)) {
    issues.push(`${p} 类型应为 ${typeLabel(schema.type)}，收到 ${valueLabel(data)}`);
  }
  if (schema.enum !== undefined && !schema.enum.includes(data)) {
    issues.push(`${p} 必须是 ${schema.enum.join('/')} 之一，收到 ${JSON.stringify(data)}`);
  }
  if (schema.const !== undefined && data !== schema.const) {
    issues.push(`${p} 必须为 ${JSON.stringify(schema.const)}，收到 ${JSON.stringify(data)}`);
  }
  if (schema.pattern !== undefined && typeof data === 'string' && !new RegExp(schema.pattern).test(data)) {
    issues.push(`${p} 不匹配 pattern ${schema.pattern}，收到 ${JSON.stringify(data)}`);
  }
  if (schema.minimum !== undefined && typeof data === 'number' && data < schema.minimum) {
    issues.push(`${p} 不能小于 ${schema.minimum}`);
  }
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    if (schema.required) {
      for (const r of schema.required) {
        if (!(r in data)) issues.push(`${p} 缺少必需字段 ${r}`);
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in data) issues.push(...validateBySchema(sub, data[k], `${p}.${k}`));
      }
      if (schema.additionalProperties === false) {
        for (const k of Object.keys(data)) {
          if (!(k in schema.properties)) issues.push(`${p} 不允许额外字段 ${k}`);
        }
      }
    }
  }
  if (Array.isArray(data) && schema.items) {
    data.forEach((item, i) => issues.push(...validateBySchema(schema.items, item, `${p}[${i}]`)));
  }
  return issues;
}

function verifyHandoff(handoffFile, sourceRootArg) {
  const report = { valid: true, issues: [] };
  const handoffBaseDir = path.dirname(path.resolve(handoffFile));
  let handoff;
  try {
    handoff = readJson(handoffFile);
  } catch (error) {
    report.valid = false;
    report.issues.push(`handoff 无法解析: ${error.message}`);
    return report;
  }
  if (handoff === null || typeof handoff !== 'object' || Array.isArray(handoff)) {
    report.valid = false;
    report.issues.push('handoff 必须是 JSON 对象');
    return report;
  }
  // —— 结构约束全部来自共享 schema（required/enum/const/pattern/type/items/additionalProperties）——
  let schema;
  try {
    schema = readJson(HANDOFF_SCHEMA_FILE);
  } catch (error) {
    report.valid = false;
    report.issues.push(`共享 schema 无法读取: ${displayPath(HANDOFF_SCHEMA_FILE)} — ${error.message}（请确认在仓库工作区内运行）`);
    return report;
  }
  for (const issue of validateBySchema(schema, handoff)) {
    report.valid = false;
    report.issues.push(issue);
  }
  // —— 业务/IO 校验（schema 无法表达的部分：路径 containment、文件存在、answerCount 一致、questionId 三方一致）——
  // P1-3 containment：inputJson/inputMarkdown 的 realpath 必须位于可信 sourceRoot 内，
  //   拒绝 `../` 越界与 symlink escape；sourceRoot 默认 = handoff 文件所在目录（最保守），
  //   可用 --source-root 显式指定，但绝不能由 handoff 内容自己定义。
  const sourceRoot = sourceRootArg ? path.resolve(sourceRootArg) : handoffBaseDir;
  let sourceRootReal;
  try {
    sourceRootReal = fs.realpathSync(sourceRoot);
  } catch {
    report.valid = false;
    report.issues.push(`可信 source-root 不存在: ${displayPath(sourceRoot)}`);
    return report;
  }
  for (const key of ['inputJson', 'inputMarkdown']) {
    const file = handoff[key];
    if (typeof file !== 'string' || file.trim().length === 0) {
      report.valid = false;
      report.issues.push(`${key} 缺失或为空`);
      continue;
    }
    if (path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file) || /^~\//.test(file)) {
      report.valid = false;
      report.issues.push(`${key} 必须是相对路径，收到绝对路径: ${file}`);
      continue;
    }
    const abs = path.resolve(handoffBaseDir, file);
    let absReal;
    try {
      absReal = fs.realpathSync(abs);
    } catch {
      report.valid = false;
      report.issues.push(`${key} 文件不存在: ${file}`);
      continue;
    }
    const rel = path.relative(sourceRootReal, absReal);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      report.valid = false;
      report.issues.push(`${key} 越出可信 source-root（拒绝 ../ 越界或 symlink 逃逸）: ${file}`);
      continue;
    }
  }
  if (handoff.inputJson) {
    const abs = path.resolve(handoffBaseDir, handoff.inputJson);
    if (fs.existsSync(abs)) {
      try {
        const json = readJson(abs);
        // P1-4 三方一致：目录 qid === answers.json.questionId === handoff.questionId
        //   （此处校验 handoff.questionId 与 inputJson.questionId；目录侧由 verify-output.mjs 校验）
        const jsonQid = json && typeof json === 'object' && !Array.isArray(json) ? json.questionId : undefined;
        if (jsonQid === undefined) {
          report.valid = false;
          report.issues.push('inputJson 缺少 questionId 字段');
        } else if (String(jsonQid) !== String(handoff.questionId)) {
          report.valid = false;
          report.issues.push(`questionId 不一致: handoff=${handoff.questionId}, answers.json=${jsonQid}`);
        }
        const answers = Array.isArray(json) ? json : json.answers;
        const actual = Array.isArray(answers) ? answers.length : -1;
        if (actual !== handoff.answerCount) {
          report.valid = false;
          report.issues.push(`answerCount 不一致: handoff=${handoff.answerCount}, 实际=${actual}`);
        }
      } catch (error) {
        report.valid = false;
        report.issues.push(`inputJson 无法解析: ${error.message}`);
      }
    }
  }
  return report;
}

/** stdout/stderr 展示路径：相对当前工作目录，避免泄漏本机绝对路径 */
function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel || '.';
}

async function main() {
  if (has('--handoff')) {
    const file = arg('--handoff', null);
    if (!file) {
      console.error('用法: node scripts/verify.mjs --handoff <handoff.json> [--source-root <dir>]');
      process.exit(2);
    }
    const sourceRoot = arg('--source-root', null);
    const report = verifyHandoff(file, sourceRoot);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.valid ? 0 : 1);
  }

  const workDir = path.resolve(arg('--work', 'work'));
  if (!fs.existsSync(workDir)) {
    console.error(`work 目录不存在: ${displayPath(workDir)}`);
    process.exit(2);
  }
  const manifest = loadManifest(workDir);

  if (has('--final')) {
    const finalFile = arg('--final', null);
    if (!finalFile) {
      console.error('用法: node scripts/verify.mjs --work work/ --final <final.json>');
      process.exit(2);
    }
    const report = verifyFinal(workDir, manifest, path.resolve(finalFile));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.valid ? 0 : 1);
  }

  const report = verifyCoverage(workDir, manifest);
  const coverageFile = path.join(workDir, 'coverage.json');
  const tmp = `${coverageFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2), 'utf8');
  fs.renameSync(tmp, coverageFile);
  console.log(JSON.stringify(report, null, 2));
  process.stderr.write(`覆盖率报告: ${displayPath(coverageFile)}\n`);
  process.exit(report.valid ? 0 : 1);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
