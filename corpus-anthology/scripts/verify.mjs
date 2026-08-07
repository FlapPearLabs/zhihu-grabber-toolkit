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

/** 最终引用验证：文档引用的 sourceId 必须有效且至少有一个证据引用 */
function verifyFinal(workDir, manifest, finalFile) {
  const report = { valid: true, invalidRefs: [], validRefs: [], hasEvidence: false };
  if (!fs.existsSync(finalFile)) {
    report.valid = false;
    report.invalidRefs.push('最终文档不存在');
    return report;
  }
  const text = fs.readFileSync(finalFile, 'utf8');
  const refs = [...text.matchAll(/\[(question-\d+-answer-[^\]]+)\]/g)].map((m) => m[1]);
  const validSources = new Set(manifest.inputs.map((i) => i.sourceId));
  for (const ref of [...new Set(refs)]) {
    if (validSources.has(ref)) report.validRefs.push(ref);
    else {
      report.valid = false;
      report.invalidRefs.push(ref);
    }
  }
  report.hasEvidence = report.validRefs.length > 0;
  if (!report.hasEvidence) {
    report.valid = false;
    report.invalidRefs.push('最终文档没有任何来源引用（缺少证据）');
  }
  return report;
}

/** 与 references/zhihu-corpus-handoff.schema.json 同源的确定性校验 */
const HANDOFF_TASKS = ['inspect', 'digest', 'archive'];
const HANDOFF_REQUIRED = ['task', 'sourceType', 'questionId', 'inputJson', 'inputMarkdown', 'verified', 'answerCount', 'warnings'];
const HANDOFF_ALLOWED = new Set([...HANDOFF_REQUIRED]);

function verifyHandoff(handoffFile) {
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
  // required 全字段
  for (const key of HANDOFF_REQUIRED) {
    if (!(key in handoff)) {
      report.valid = false;
      report.issues.push(`缺少必需字段: ${key}`);
    }
  }
  // additionalProperties 拒绝
  for (const key of Object.keys(handoff)) {
    if (!HANDOFF_ALLOWED.has(key)) {
      report.valid = false;
      report.issues.push(`不允许的额外字段: ${key}`);
    }
  }
  // task enum
  if (handoff.task !== undefined && !HANDOFF_TASKS.includes(handoff.task)) {
    report.valid = false;
    report.issues.push(`task 必须是 ${HANDOFF_TASKS.join('/')} 之一，收到: ${handoff.task}`);
  }
  // sourceType const
  if (handoff.sourceType !== undefined && handoff.sourceType !== 'zhihu-answers') {
    report.valid = false;
    report.issues.push(`sourceType 必须是 zhihu-answers，收到: ${handoff.sourceType}`);
  }
  // questionId：必须是 string 且匹配 pattern（与 schema type: string + pattern 一致）
  if (handoff.questionId !== undefined) {
    if (typeof handoff.questionId !== 'string') {
      report.valid = false;
      report.issues.push(`questionId 必须是字符串，收到: ${JSON.stringify(handoff.questionId)}`);
    } else if (!/^\d{1,20}$/.test(handoff.questionId)) {
      report.valid = false;
      report.issues.push(`questionId 必须是 1-20 位数字，收到: ${handoff.questionId}`);
    }
  }
  // verified 必须为 true
  if (handoff.verified !== undefined && handoff.verified !== true) {
    report.valid = false;
    report.issues.push('verified 必须为 true（请先在 zhihu-answer-grabber 中运行 verify-output.mjs 并修复产物）');
  }
  // answerCount 非负整数
  if (handoff.answerCount !== undefined && (!Number.isSafeInteger(handoff.answerCount) || handoff.answerCount < 0)) {
    report.valid = false;
    report.issues.push(`answerCount 必须是非负整数，收到: ${handoff.answerCount}`);
  }
  // warnings：必须是 string 数组（与 schema type: array + items: string 一致）
  if (handoff.warnings !== undefined) {
    if (!Array.isArray(handoff.warnings)) {
      report.valid = false;
      report.issues.push('warnings 必须是数组');
    } else {
      const nonStrings = handoff.warnings.filter((w) => typeof w !== 'string');
      if (nonStrings.length > 0) {
        report.valid = false;
        report.issues.push(`warnings 数组必须全部为字符串，发现 ${nonStrings.length} 个非字符串项`);
      }
    }
  }
  // 路径：必须是相对路径（不泄漏绝对路径），相对 handoff 文件所在目录解析，且文件存在
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
    if (!fs.existsSync(abs)) {
      report.valid = false;
      report.issues.push(`${key} 文件不存在: ${file}`);
    }
  }
  if (handoff.inputJson) {
    const abs = path.resolve(handoffBaseDir, handoff.inputJson);
    if (fs.existsSync(abs)) {
      try {
        const json = readJson(abs);
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
      console.error('用法: node scripts/verify.mjs --handoff <handoff.json>');
      process.exit(2);
    }
    const report = verifyHandoff(file);
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
      console.error('用法: node scripts/verify.mjs --work work/ --final <file.md>');
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
