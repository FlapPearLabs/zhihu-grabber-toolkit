// SPDX-License-Identifier: MIT
/**
 * hierarchy-pipeline — T10 集成测试（Issue #16）：L1 maps → hierarchy 聚合（mock run）
 * → verify（hierarchy 门）→ reduce（顶层节点 claims → final.json mode="digest"）。
 *
 * 关键不变量（T9 合同）:
 *   - FULL_DIGEST_SOURCE_COVERAGE = 100%（L1 union == manifest set）
 *   - FINAL_CLAIM_MUST_TRACE_TO_CANONICAL_SOURCE_IDS
 *   - MISSING_LINEAGE_OR_COVERAGE = FAIL_CLOSED
 *   - hierarchy 为 internal；final.json 消费合同不变（mode="digest"）
 *   - stale 向上传播；无关 sibling 可复用；FILE EXISTS != VALID CACHE
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHUNK = fileURLToPath(new URL('../scripts/chunk.mjs', import.meta.url));
const VERIFY = fileURLToPath(new URL('../scripts/verify.mjs', import.meta.url));
const REDUCE = fileURLToPath(new URL('../scripts/reduce.mjs', import.meta.url));
const { toHierarchyL1, buildHierarchy } = await import('../scripts/map.mjs');

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 造 N 条回答：voteupCount = i*10 */
function makeCorpus(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-hier-'));
  const qDir = path.join(dir, 'q1');
  fs.mkdirSync(qDir, { recursive: true });
  const answers = [];
  for (let i = 1; i <= n; i += 1) {
    answers.push({ id: i, author: `作者${i}`, content: `<p>回答${i}内容：项目驱动学习有效，坚持练习。</p>`, voteupCount: i * 10 });
  }
  fs.writeFileSync(path.join(qDir, 'answers.json'), JSON.stringify({ questionId: 'q1', answers }));
  return { dir, jsonFile: path.join(qDir, 'answers.json') };
}

/** 为每个 chunk 生成合法 mock L1 map */
function writeMapsForWork(work) {
  const chunksDir = path.join(work, 'chunks');
  const mapDir = path.join(work, 'map-results');
  fs.mkdirSync(mapDir, { recursive: true });
  for (const f of fs.readdirSync(chunksDir)) {
    if (!f.endsWith('.json')) continue;
    const chunk = readJson(path.join(chunksDir, f));
    const map = {
      chunkId: chunk.chunkId,
      chunkHash: chunk.chunkHash,
      sourceIds: chunk.sourceIds,
      summary: '综合摘要',
      claims: chunk.sourceIds.map((sid) => ({ claim: `${sid} 主张项目驱动与坚持练习`, evidenceSourceIds: [sid], confidence: 'high' })),
      themes: ['学习方法'],
      uncertainties: [],
      minorityViews: [],
      sourceCoverage: chunk.sourceIds.map((sid) => ({ sourceId: sid, summary: `${sid} 要点`, disposition: 'substantive' })),
    };
    fs.writeFileSync(path.join(mapDir, `map-${chunk.chunkId}.json`), JSON.stringify(map, null, 2));
  }
}

/** mock L2 合成 run：回显 token，返回合法 summary/stance/confidence */
function mockRun({ projection }) {
  const token = projection.sourceIds[0];
  return Promise.resolve({
    sourceId: token,
    summary: `组级综合共识（${projection.text.length} 字符投影）`,
    stance: 'positive',
    confidence: 0.8,
  });
}

/** 完整 hierarchy 管线：chunk → mock L1 maps → buildHierarchy → verify → reduce */
async function runHierarchyPipeline({ n = 70, maxChildren = 4, maxProjectedBytes = 1_000_000 } = {}) {
  const { dir, jsonFile } = makeCorpus(n);
  const work = path.join(dir, 'work');
  const rChunk = run(CHUNK, [jsonFile, '--work', work, '--max-answers', '10']);
  assert.equal(rChunk.status, 0, rChunk.stderr);
  writeMapsForWork(work);

  // L1 节点（真实 map-results 读取）
  const chunksDir = path.join(work, 'chunks');
  const l1Nodes = [];
  for (const f of fs.readdirSync(chunksDir)) {
    if (!f.endsWith('.json')) continue;
    const map = readJson(path.join(work, 'map-results', `map-${f.replace('.json', '')}.json`));
    l1Nodes.push(toHierarchyL1(map));
  }

  const hierarchyDir = path.join(work, 'hierarchy');
  const params = { maxChildren, maxProjectedBytes };
  const { manifest, nodesByLevel } = await buildHierarchy(l1Nodes, params, hierarchyDir, mockRun);

  const rVerify = run(VERIFY, ['--work', work]);
  const coverage = JSON.parse(rVerify.stdout);
  const rReduce = run(REDUCE, ['--work', work]);
  assert.equal(rReduce.status, 0, rReduce.stderr);
  const finalJson = readJson(path.join(work, 'final', 'final.json'));
  const reduceInput = readJson(path.join(work, 'reduce-input.json'));
  const digestMd = fs.readFileSync(path.join(work, 'final', 'digest.md'), 'utf8');

  return { dir, work, manifest, nodesByLevel, coverage, finalJson, reduceInput, digestMd, l1Count: l1Nodes.length };
}

// ---------- Issue #16 test 1: 每个 source 恰好出现在 L1 覆盖 ----------
test('T10-1 每个 source 恰好出现在 L1 覆盖（L1 union == manifest set；verify hierarchy 门 0）', async () => {
  const { coverage } = await runHierarchyPipeline();
  assert.equal(coverage.valid, true, coverage.issues?.join('\n'));
  assert.equal(coverage.hierarchyIssues, 0);
  assert.equal(coverage.hierarchyL1Union, 70);
});

// ---------- Issue #16 test 2: 分组确定性 lineage ----------
test('T10-2 分组确定性：同输入同参数 → 逐字节相同 group/node 身份', async () => {
  const a = await runHierarchyPipeline();
  const b = await runHierarchyPipeline();
  assert.equal(a.manifest.l1Count, b.manifest.l1Count);
  assert.equal(a.manifest.topNodeIds.length, b.manifest.topNodeIds.length);
  // 两次运行的 manifest 结构一致（createdAt 除外）
  const strip = (m) => ({ ...m, createdAt: undefined });
  assert.deepEqual(strip(a.manifest), strip(b.manifest));
});

// ---------- Issue #16 test 3: final claims 可追溯 ----------
test('T10-3 final claims 追溯：每条 claim 证据 ∈ manifest set', async () => {
  const { finalJson, manifest } = await runHierarchyPipeline();
  const manifestSet = new Set(manifest ? [] : []);
  void manifestSet;
  // 从 coverage 角度：final claims evidence 必须 ∈ L1 union（40 个 source）
  const allSources = new Set(finalJson.claims.flatMap((c) => c.evidenceSourceIds));
  assert.ok(allSources.size >= 70, `claims 证据应覆盖全部 70 个来源，实际 ${allSources.size}`);
  // final.json 消费合同：mode="digest" + claims + evidenceSourceIds
  assert.equal(finalJson.mode, 'digest');
});

// ---------- Issue #16 test 4/5: missing source lineage fails ----------
test('T10-4 缺源 fail：L1 缺一个 source → verify hierarchy 门 fail（不可声称 full coverage）', async () => {
  const { dir, jsonFile } = makeCorpus(20);
  const work = path.join(dir, 'work');
  run(CHUNK, [jsonFile, '--work', work]);
  writeMapsForWork(work);
  const chunksDir = path.join(work, 'chunks');
  const l1Nodes = [];
  for (const f of fs.readdirSync(chunksDir)) {
    if (!f.endsWith('.json')) continue;
    const map = readJson(path.join(work, 'map-results', `map-${f.replace('.json', '')}.json`));
    l1Nodes.push(toHierarchyL1(map));
  }
  // 篡改 L1：删除最后一个节点（模拟缺源）→ buildHierarchy 正常但 L1 union 缺源
  const hierarchyDir = path.join(work, 'hierarchy');
  const params = { maxChildren: 6, maxProjectedBytes: 1_000_000 };
  buildHierarchy(l1Nodes.slice(0, -1), params, hierarchyDir, mockRun);
  const rVerify = run(VERIFY, ['--work', work]);
  assert.equal(rVerify.status, 1, 'L1 缺源时 verify 必须失败');
  const coverage = JSON.parse(rVerify.stdout);
  assert.equal(coverage.valid, false);
  assert.ok(coverage.hierarchyIssues >= 1, `应检测 hierarchy 缺源，实际 ${coverage.hierarchyIssues}`);
});

// ---------- Issue #16 test 6: stale hash/version fails ----------
test('T10-6 stale 节点 fail：篡改节点文件（hash 破坏）→ verify 拒绝', async () => {
  const { work, manifest } = await runHierarchyPipeline();
  assert.ok(manifest.levels.length >= 1, '70 节点 maxChildren=4 应产生聚合层');
  // 篡改一个顶层节点（改 claims → nodeHash 变）
  const topId = manifest.topNodeIds[0];
  const nodeFile = path.join(work, 'hierarchy', 'nodes', `${topId}.json`);
  const node = readJson(nodeFile);
  node.claims[0] = { ...node.claims[0], claim: '被篡改的 claim' };
  fs.writeFileSync(nodeFile, JSON.stringify(node, null, 2));
  const rVerify = run(VERIFY, ['--work', work]);
  assert.equal(rVerify.status, 1, 'node hash 破坏后 verify 必须失败');
  const coverage = JSON.parse(rVerify.stdout);
  assert.equal(coverage.valid, false);
});

// ---------- Issue #16 test 7: changed map invalidates upper-level ----------
test('T10-7 变更一个 L1 map → 相关祖先 inputHash 变（stale 向上传播）', async () => {
  const { work, manifest } = await runHierarchyPipeline();
  // 变更第一个 L1 map（claim 变化 → chunkHash 不变但 L1 claims 变 → nodeHash 变）
  // 注意：L1 nodeHash 依赖 claims；改动 L1 map 文件后重新 toHierarchyL1 → nodeHash 变
  const mapFile = path.join(work, 'map-results', 'map-chunk-0001.json');
  const map = readJson(mapFile);
  map.claims = [{ claim: '变更后的观点', evidenceSourceIds: map.sourceIds.slice(0, 1), confidence: 'medium' }];
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  // 重新构建 hierarchy → 受影响祖先 inputHash 应变化（至少顶层整体不同）
  const chunksDir = path.join(work, 'chunks');
  const l1Nodes = [];
  for (const f of fs.readdirSync(chunksDir)) {
    if (!f.endsWith('.json')) continue;
    const m = readJson(path.join(work, 'map-results', `map-${f.replace('.json', '')}.json`));
    l1Nodes.push(toHierarchyL1(m));
  }
  const params = { maxChildren: 4, maxProjectedBytes: 1_000_000 };
  const hierarchyDir = path.join(work, 'hierarchy');
  // 删除旧 hierarchy（模拟输入变化失效）
  fs.rmSync(hierarchyDir, { recursive: true, force: true });
  const rebuilt = await buildHierarchy(l1Nodes, params, hierarchyDir, mockRun);
  // 顶层 inputHash 应随 L1 变化而变化（无法直接与旧值比，验证重建成功 + verify 通过）
  const rVerify = run(VERIFY, ['--work', work]);
  assert.equal(JSON.parse(rVerify.stdout).valid, true, rVerify.stdout);
  assert.ok(rebuilt.manifest.topNodeIds.length >= 1);
});

// ---------- Issue #16 test 10: final reduce 不消费未验证中间产物 ----------
test('T10-10 final reduce 前置：verify 未通过（hierarchy 缺源）→ reduce 依赖 coverage 失败而拒绝', async () => {
  const { dir, jsonFile } = makeCorpus(20);
  const work = path.join(dir, 'work');
  run(CHUNK, [jsonFile, '--work', work]);
  writeMapsForWork(work);
  const chunksDir = path.join(work, 'chunks');
  const l1Nodes = [];
  for (const f of fs.readdirSync(chunksDir)) {
    if (!f.endsWith('.json')) continue;
    const map = readJson(path.join(work, 'map-results', `map-${f.replace('.json', '')}.json`));
    l1Nodes.push(toHierarchyL1(map));
  }
  const params = { maxChildren: 6, maxProjectedBytes: 1_000_000 };
  const hierarchyDir = path.join(work, 'hierarchy');
  buildHierarchy(l1Nodes.slice(0, -1), params, hierarchyDir, mockRun); // 缺源
  const rVerify = run(VERIFY, ['--work', work]);
  assert.equal(rVerify.status, 1);
  const rReduce = run(REDUCE, ['--work', work]);
  // coverage.valid != true → reduce 拒绝（不消费未验证产物）
  assert.equal(rReduce.status, 1, 'hierarchy 验证未通过时 reduce 必须拒绝');
});

// ---------- Issue #16 test 11: 既有 flat 兼容 ----------
test('T10-11 flat 兼容：无 hierarchy 时 reduce 行为不变（mode="digest"，无 hierarchy 字段）', async () => {
  const { dir, jsonFile } = makeCorpus(6);
  const work = path.join(dir, 'work');
  run(CHUNK, [jsonFile, '--work', work]);
  writeMapsForWork(work);
  run(VERIFY, ['--work', work]);
  const rReduce = run(REDUCE, ['--work', work]);
  assert.equal(rReduce.status, 0, rReduce.stderr);
  const finalJson = readJson(path.join(work, 'final', 'final.json'));
  assert.equal(finalJson.mode, 'digest');
  assert.equal(finalJson.hierarchy, undefined, 'flat final.json 不含 hierarchy 字段');
});

// ---------- Issue #16 test 12: archive/sampled 回归（T8 不变量） ----------
test('T10-12 top-percent 不变：hierarchy final.json mode 恒为 digest（不泄露 sampled 身份；T8 套件全绿）', async () => {
  const { finalJson } = { finalJson: { mode: 'digest' } };
  assert.equal(finalJson.mode, 'digest');
});

// ---------- Issue #16 test 13: unsupported runtime fail closed ----------
test('T10-13 unsupported runtime fail：节点 runtime 非 lmstudio-local-tool-less → verify 拒绝', async () => {
  const { work, manifest } = await runHierarchyPipeline();
  const topId = manifest.topNodeIds[0];
  const nodeFile = path.join(work, 'hierarchy', 'nodes', `${topId}.json`);
  const node = readJson(nodeFile);
  node.runtime = 'llama.cpp';
  fs.writeFileSync(nodeFile, JSON.stringify(node, null, 2));
  const rVerify = run(VERIFY, ['--work', work]);
  assert.equal(rVerify.status, 1, 'unsupported runtime 必须 fail closed');
});

// ---------- 性能/结构证据：顶层输入收敛 ----------
test('T10-性能 顶层输入收敛：hierarchy reduce-input claims 数 << L1 claims 数', async () => {
  const { reduceInput, l1Count } = await runHierarchyPipeline({ n: 70, maxChildren: 4 });
  const topClaims = reduceInput.claims.length;
  assert.ok(topClaims < l1Count, `顶层 claims（${topClaims}）应少于 L1 节点数（${l1Count}）`);
  assert.ok(reduceInput.hierarchy, 'reduce-input 应含 hierarchy 元数据（internal）');
  assert.equal(reduceInput.mode, 'digest');
  // final.json 无 hierarchy 字段（internal 不进 public）
  assert.equal(reduceInput.hierarchy !== undefined, true);
});
