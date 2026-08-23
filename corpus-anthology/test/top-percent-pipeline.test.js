// SPDX-License-Identifier: MIT
/**
 * top-percent-pipeline — T8 集成测试（Issue #14）：select → chunk(--selection)
 * → verify(selection-scope) → reduce(mode=top-percent-analysis + 披露块) → render。
 *
 * 关键不变量（T7 合同）:
 *   - SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST：mode 恒为 top-percent-analysis，
 *     即使 X=100 也不得变成 digest。
 *   - isFullCoverage 是覆盖事实（选中集==原集时为 true），不是 mode identity。
 *   - verify 的 selection-scope 门：selection.json 与 manifest 不一致 → fail closed。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELECT = fileURLToPath(new URL('../scripts/select.mjs', import.meta.url));
const CHUNK = fileURLToPath(new URL('../scripts/chunk.mjs', import.meta.url));
const VERIFY = fileURLToPath(new URL('../scripts/verify.mjs', import.meta.url));
const REDUCE = fileURLToPath(new URL('../scripts/reduce.mjs', import.meta.url));

/** 造 N 条回答：voteupCount = i*10（i 越大赞越高），answerId = String(i) */
function makeCorpus(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-tp-'));
  const qDir = path.join(dir, 'q1');
  fs.mkdirSync(qDir, { recursive: true });
  const answers = [];
  for (let i = 1; i <= n; i += 1) {
    answers.push({ id: i, author: `作者${i}`, content: `<p>回答${i}内容</p>`, voteupCount: i * 10 });
  }
  fs.writeFileSync(path.join(qDir, 'answers.json'), JSON.stringify({ questionId: 'q1', answers }));
  return { dir, jsonFile: path.join(qDir, 'answers.json') };
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 为每个 chunk 生成合法 map（满足 verify 的 sourceCoverage 全覆盖 + claims 契约） */
function writeMapsForWork(work) {
  const chunksDir = path.join(work, 'chunks');
  const mapDir = path.join(work, 'map-results');
  fs.mkdirSync(mapDir, { recursive: true });
  for (const f of fs.readdirSync(chunksDir)) {
    const chunk = readJson(path.join(chunksDir, f));
    const map = {
      chunkId: chunk.chunkId,
      chunkHash: chunk.chunkHash,
      sourceIds: chunk.sourceIds,
      summary: '摘要',
      claims: chunk.sourceIds.map((sid) => ({ claim: `${sid} 的观点`, evidenceSourceIds: [sid], confidence: 'high' })),
      themes: ['主题'],
      uncertainties: [],
      sourceCoverage: chunk.sourceIds.map((sid) => ({ sourceId: sid, summary: `${sid} 的内容概要`, disposition: 'substantive' })),
    };
    fs.writeFileSync(path.join(mapDir, `map-${chunk.chunkId}.json`), JSON.stringify(map, null, 2));
  }
}

/** 完整跑一遍 top-percent 链路，返回所有关键产物 */
function runTopPercentPipeline({ n = 10, percent = 50 } = {}) {
  const { dir, jsonFile } = makeCorpus(n);
  const work = path.join(dir, 'work');
  const selectionFile = path.join(work, 'selection.json');

  const rSel = run(SELECT, [jsonFile, '--work', work, '--percent', String(percent)]);
  assert.equal(rSel.status, 0, `select 失败: ${rSel.stderr}`);
  const selection = readJson(selectionFile);

  const rChunk = run(CHUNK, [jsonFile, '--work', work, '--mode', 'top-percent-analysis', '--selection', selectionFile]);
  assert.equal(rChunk.status, 0, `chunk 失败: ${rChunk.stderr}`);
  const manifest = readJson(path.join(work, 'manifest.json'));

  writeMapsForWork(work);

  const rVerify = run(VERIFY, ['--work', work]);
  assert.equal(rVerify.status, 0, `verify 失败: ${rVerify.stderr}\n${rVerify.stdout}`);
  const coverage = JSON.parse(rVerify.stdout);

  const rReduce = run(REDUCE, ['--work', work]);
  assert.equal(rReduce.status, 0, `reduce 失败: ${rReduce.stderr}`);
  const finalJson = readJson(path.join(work, 'final', 'final.json'));
  const digestMd = fs.readFileSync(path.join(work, 'final', 'digest.md'), 'utf8');

  return { dir, work, selection, manifest, coverage, finalJson, digestMd };
}

test('T6-链路：X=50, N=10 → 选中 5 条，verify selection-scope 通过，final.json 披露字段齐全', () => {
  const { selection, manifest, coverage, finalJson, digestMd } = runTopPercentPipeline({ n: 10, percent: 50 });

  // selection：strict count K=5
  assert.equal(selection.originalTotal, 10);
  assert.equal(selection.selectedSourceIds.length, 5);
  assert.equal(selection.selectionRule, 'top-50-pct-voteup-desc-answerid-dec-asc-strict');
  assert.ok(selection.selectorHash);

  // manifest：mode + selectionHash
  assert.equal(manifest.mode, 'top-percent-analysis');
  assert.equal(manifest.selectionHash, selection.selectorHash);
  assert.equal(manifest.inputs.length, 5);

  // verify：selection-scope 无问题
  assert.equal(coverage.valid, true);
  assert.equal(coverage.selectionScopeIssues, 0);

  // final.json：mode 恒为 top-percent-analysis + 披露块
  assert.equal(finalJson.mode, 'top-percent-analysis');
  assert.equal(finalJson.totalAnswers, 10);
  assert.equal(finalJson.selectedAnswers, 5);
  assert.equal(finalJson.requestedPercent, 50);
  assert.equal(finalJson.actualCoveragePercent, '50.0');
  assert.equal(finalJson.selectionRule, 'top-50-pct-voteup-desc-answerid-dec-asc-strict');
  assert.equal(finalJson.selectedSourceIds.length, 5);
  assert.equal(finalJson.isFullCoverage, false);
  assert.ok(Array.isArray(finalJson.claims) && finalJson.claims.length > 0);

  // digest.md：⚠️ 披露块 7 项齐全 + 明确非 full-digest
  for (const needle of [
    'Top-percent 采样分析',
    '不是全量摘要',
    '50%',
    '5 / 10',
    '50.0%',
    'top-50-pct-voteup-desc-answerid-dec-asc-strict',
    'isFullCoverage',
    'canonical full-digest 管线',
  ]) {
    assert.ok(digestMd.includes(needle), `digest.md 缺少: ${needle}`);
  }
});

test('T6-链路：X=100 → 选中全部，isFullCoverage=true，但 mode 恒为 top-percent-analysis（身份不随 X 切换）', () => {
  const { selection, manifest, finalJson, digestMd } = runTopPercentPipeline({ n: 8, percent: 100 });

  assert.equal(selection.selectedSourceIds.length, 8);
  assert.equal(selection.originalTotal, 8);
  assert.equal(manifest.inputs.length, 8);

  // 覆盖事实 = true（数值全量）
  assert.equal(finalJson.isFullCoverage, true);
  assert.equal(finalJson.actualCoveragePercent, '100.0');
  // 但 pipeline 身份仍是 sampled（不静默变 digest）
  assert.equal(finalJson.mode, 'top-percent-analysis');
  assert.equal(finalJson.selectionRule, 'top-100-pct-voteup-desc-answerid-dec-asc-strict');
  assert.ok(digestMd.includes('canonical full-digest 管线'), 'X=100 也必须在披露块声明非 full-digest');
});

test('T6-链路：sampled 输出永远不能呈现为 task=digest / full coverage 身份', () => {
  const { finalJson, digestMd } = runTopPercentPipeline({ n: 10, percent: 30 });
  assert.equal(finalJson.mode, 'top-percent-analysis');
  assert.notEqual(finalJson.mode, 'digest');
  assert.ok(!digestMd.startsWith('# 语料全覆盖摘要'), 'top-percent 渲染不得使用 full-digest 标题');
  assert.ok(digestMd.startsWith('# 语料 Top-percent 分析摘要'));
});

test('T6-链路：verify 的 selection-scope 门 —— 篡改 selection.json → fail closed', () => {
  const { work, selection, manifest } = runTopPercentPipeline({ n: 10, percent: 50 });
  // 篡改 selection（保留 selectorHash 但修改 selectedSourceIds → validateSelection 拒绝）
  const selectionFile = path.join(work, 'selection.json');
  fs.writeFileSync(selectionFile, JSON.stringify({ ...selection, selectedSourceIds: selection.selectedSourceIds.slice(0, 2) }));
  const r = run(VERIFY, ['--work', work]);
  assert.equal(r.status, 1, '篡改 selection 后 verify 必须失败');
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.selectionScopeIssues >= 1, `应检测 selection 非法，实际: ${parsed.selectionScopeIssues}`);
});

test('T6-链路：manifest.selectionHash 与 selection 不一致 → verify fail closed', () => {
  const { work, selection } = runTopPercentPipeline({ n: 10, percent: 50 });
  // 重建一个不同 X 的 selection 文件（selectorHash 合法但与 manifest.selectionHash 不同）
  const selFile = path.join(work, 'selection.json');
  const { jsonFile } = (() => {
    // 重新从原 answers 造 selection X=40（合法但 hash 不同）
    const answersFile = path.join(path.dirname(work), 'q1', 'answers.json');
    const r = run(SELECT, [answersFile, '--work', work, '--percent', '40']);
    assert.equal(r.status, 0, r.stderr);
    return { jsonFile: answersFile };
  })();
  void jsonFile;
  const r = run(VERIFY, ['--work', work]);
  assert.equal(r.status, 1, 'selectionHash 不一致时 verify 必须失败');
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.selectionScopeIssues >= 1);
  // 清理：把原 selection 恢复（避免影响后续测试）
  fs.writeFileSync(selFile, JSON.stringify(selection, null, 2));
});

test('T6-回归：digest 模式不受影响 —— final.json.mode=digest，无 top-percent 披露字段', () => {
  const { dir, jsonFile } = makeCorpus(6);
  const work = path.join(dir, 'work');
  const rChunk = run(CHUNK, [jsonFile, '--work', work]); // 默认 digest
  assert.equal(rChunk.status, 0, rChunk.stderr);
  const manifest = readJson(path.join(work, 'manifest.json'));
  assert.equal(manifest.mode, 'digest');
  assert.equal(manifest.selectionHash, undefined, 'digest 模式不得记录 selectionHash');
  writeMapsForWork(work);
  const rVerify = run(VERIFY, ['--work', work]);
  assert.equal(rVerify.status, 0, rVerify.stdout);
  assert.equal(JSON.parse(rVerify.stdout).mode, 'digest');
  const rReduce = run(REDUCE, ['--work', work]);
  assert.equal(rReduce.status, 0, rReduce.stderr);
  const finalJson = readJson(path.join(work, 'final', 'final.json'));
  assert.equal(finalJson.mode, 'digest');
  assert.equal(finalJson.isFullCoverage, undefined, 'digest 产物不得携带 top-percent 披露字段');
  assert.equal(finalJson.selectedSourceIds, undefined);
  // digest.md 标题不变
  const md = fs.readFileSync(path.join(work, 'final', 'digest.md'), 'utf8');
  assert.ok(md.startsWith('# 语料全覆盖摘要'));
});

test('T6-边界：chunk top-percent 模式缺 --selection → 拒绝（exit 2）', () => {
  const { jsonFile } = makeCorpus(5);
  const work = path.join(path.dirname(jsonFile), '..', 'work2');
  const r = run(CHUNK, [jsonFile, '--work', work, '--mode', 'top-percent-analysis']);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('--selection'));
});

test('T6-边界：select 与 chunk 输入不一致（originalTotal 不匹配）→ chunk fail closed', () => {
  const { dir, jsonFile } = makeCorpus(10);
  const work = path.join(dir, 'work');
  const rSel = run(SELECT, [jsonFile, '--work', work, '--percent', '50']);
  assert.equal(rSel.status, 0, rSel.stderr);
  // 增加一条回答（输入变化）
  const qDir = path.join(dir, 'q1');
  const data = readJson(path.join(qDir, 'answers.json'));
  data.answers.push({ id: 99, author: '新', content: '<p>新回答</p>', voteupCount: 999 });
  fs.writeFileSync(path.join(qDir, 'answers.json'), JSON.stringify(data));
  const rChunk = run(CHUNK, [jsonFile, '--work', work, '--mode', 'top-percent-analysis', '--selection', path.join(work, 'selection.json')]);
  assert.equal(rChunk.status, 2, 'originalTotal 不一致必须失败');
  assert.ok(rChunk.stderr.includes('originalTotal') || rChunk.stderr.includes('select'), rChunk.stderr);
});
