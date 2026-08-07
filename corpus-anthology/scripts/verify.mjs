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
 * 覆盖率报告写入 work/coverage.json。
 * 任一校验失败时退出码非 0。
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
    throw new Error(`manifest 不存在: ${manifestFile}（请先运行 chunk.mjs）`);
  }
  return readJson(manifestFile);
}

/** 覆盖率验证（digest 完成判定） */
function verifyCoverage(workDir, manifest) {
  const chunksDir = path.join(workDir, 'chunks');
  const mapDir = path.join(workDir, 'map-results');
  const report = {
    valid: true,
    missingSources: 0,
    duplicateAssignments: 0,
    failedChunks: 0,
    invalidEvidenceRefs: 0,
    missingMapResults: 0,
    staleHashes: 0,
    issues: [],
  };

  // 2. 每个输入进入某个 chunk
  const chunkIds = new Set();
  if (fs.existsSync(chunksDir)) {
    for (const f of fs.readdirSync(chunksDir)) {
      if (f.endsWith('.json')) chunkIds.add(f.replace(/\.json$/, ''));
    }
  }
  for (const input of manifest.inputs) {
    if (!input.chunkIds || input.chunkIds.length === 0) {
      report.missingSources += 1;
      report.issues.push(`输入未进入任何 chunk: ${input.sourceId}`);
    } else {
      for (const cid of input.chunkIds) {
        if (!chunkIds.has(cid)) {
          report.missingSources += 1;
          report.issues.push(`输入引用的 chunk 不存在: ${input.sourceId} → ${cid}`);
        }
      }
    }
  }

  // 3+4. 每个 chunk 可解析、sourceIds 有效且无重复分配
  const seenSources = new Set();
  const sourceOccurrences = new Map();
  if (fs.existsSync(chunksDir)) {
    for (const f of fs.readdirSync(chunksDir)) {
      if (!f.endsWith('.json')) continue;
      let chunk;
      try {
        chunk = readJson(path.join(chunksDir, f));
      } catch (error) {
        report.failedChunks += 1;
        report.issues.push(`chunk 损坏: ${f} — ${error.message}`);
        continue;
      }
      const cid = chunk.chunkId || f.replace(/\.json$/, '');
      if (chunk.status === 'failed') {
        report.failedChunks += 1;
        report.issues.push(`chunk 标记为失败: ${cid}`);
      }
      if (!Array.isArray(chunk.sourceIds)) continue;
      const localSeen = new Set();
      for (const sid of chunk.sourceIds) {
        if (localSeen.has(sid)) {
          report.duplicateAssignments += 1;
          report.issues.push(`chunk 内重复来源: ${cid} → ${sid}`);
        }
        localSeen.add(sid);
        seenSources.add(sid);
        sourceOccurrences.set(sid, (sourceOccurrences.get(sid) ?? 0) + 1);
      }
    }
  }
  // 未知来源（chunk 中出现 manifest 之外的 sourceId）
  const validSources = new Set(manifest.inputs.map((i) => i.sourceId));
  for (const sid of seenSources) {
    if (!validSources.has(sid)) {
      report.invalidEvidenceRefs += 1;
      report.issues.push(`chunk 引用未知来源: ${sid}`);
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

  // 5+6. map 结果校验
  if (fs.existsSync(mapDir)) {
    const mapFiles = fs.readdirSync(mapDir).filter((f) => f.endsWith('.json'));
    const mappedChunks = new Set();
    for (const f of mapFiles) {
      let map;
      try {
        map = readJson(path.join(mapDir, f));
      } catch (error) {
        report.failedChunks += 1;
        report.issues.push(`map 结果损坏: ${f} — ${error.message}`);
        continue;
      }
      const cid = map.chunkId || f.replace(/^map-/, '').replace(/\.json$/, '');
      if (map.status === 'failed') {
        report.failedChunks += 1;
        report.issues.push(`map 标记为失败: ${cid}`);
      }
      if (!chunkIds.has(cid)) {
        report.invalidEvidenceRefs += 1;
        report.issues.push(`map 引用的 chunk 不存在: ${cid}`);
      }
      mappedChunks.add(cid);
      // 6. 每个 claim 的 evidenceSourceIds 有效
      for (const claim of map.claims ?? []) {
        for (const ev of claim.evidenceSourceIds ?? []) {
          if (!validSources.has(ev)) {
            report.invalidEvidenceRefs += 1;
            report.issues.push(`claim 引用无效来源: ${ev}（chunk ${cid}）`);
          }
        }
      }
    }
    // 8. 无未完成状态：每个 chunk 都有 map 结果
    for (const cid of chunkIds) {
      if (!mappedChunks.has(cid)) {
        report.missingMapResults += 1;
        report.issues.push(`chunk 缺少 map 结果: ${cid}`);
      }
    }
  } else {
    report.missingMapResults = chunkIds.size;
    for (const cid of chunkIds) report.issues.push(`chunk 缺少 map 结果: ${cid}`);
  }

  // 9. 无失败 chunk 已在上面统计
  // 只有全部完成条件满足才算 valid（含 map 覆盖与哈希新鲜度）
  report.valid =
    report.missingSources === 0
    && report.duplicateAssignments === 0
    && report.failedChunks === 0
    && report.invalidEvidenceRefs === 0
    && report.missingMapResults === 0
    && report.staleHashes === 0;

  return report;
}

/** 最终引用验证 */
function verifyFinal(workDir, manifest, finalFile) {
  const report = { valid: true, invalidRefs: [], validRefs: [] };
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
  return report;
}

/** handoff 输入验证 */
function verifyHandoff(handoffFile) {
  const report = { valid: true, issues: [] };
  let handoff;
  try {
    handoff = readJson(handoffFile);
  } catch (error) {
    report.valid = false;
    report.issues.push(`handoff 无法解析: ${error.message}`);
    return report;
  }
  if (handoff.sourceType !== 'zhihu-answers') {
    report.valid = false;
    report.issues.push(`sourceType 必须是 zhihu-answers，收到: ${handoff.sourceType}`);
  }
  if (handoff.verified !== true) {
    report.valid = false;
    report.issues.push('verified 必须为 true（请先在 zhihu-answer-grabber 中运行 verify-output.mjs 并修复产物）');
  }
  for (const key of ['inputJson', 'inputMarkdown']) {
    const file = handoff[key];
    if (file && !fs.existsSync(file)) {
      report.valid = false;
      report.issues.push(`${key} 文件不存在: ${file}`);
    }
  }
  if (handoff.inputJson && fs.existsSync(handoff.inputJson)) {
    try {
      const json = readJson(handoff.inputJson);
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
  return report;
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
    console.error(`work 目录不存在: ${workDir}`);
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
  process.stderr.write(`覆盖率报告: ${coverageFile}\n`);
  process.exit(report.valid ? 0 : 1);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
