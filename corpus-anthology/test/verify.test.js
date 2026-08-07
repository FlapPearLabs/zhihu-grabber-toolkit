import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHUNK = fileURLToPath(new URL('../scripts/chunk.mjs', import.meta.url));
const VERIFY = fileURLToPath(new URL('../scripts/verify.mjs', import.meta.url));
const REDUCE = fileURLToPath(new URL('../scripts/reduce.mjs', import.meta.url));

function makeCorpus(answerCount = 6) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-verify-'));
  const qDir = path.join(dir, '123');
  fs.mkdirSync(qDir, { recursive: true });
  const answers = [];
  for (let i = 1; i <= answerCount; i += 1) {
    answers.push({ id: String(i), author: `作者${i}`, content: `<p>回答${i}内容</p>`, voteupCount: i });
  }
  fs.writeFileSync(path.join(qDir, 'answers.json'), JSON.stringify({ questionId: '123', answers }));
  fs.writeFileSync(path.join(qDir, 'answers.md'), '# 测试\n\n## 1. A\nx\n');
  return { dir, jsonFile: path.join(qDir, 'answers.json'), mdFile: path.join(qDir, 'answers.md'), qid: '123' };
}

function run(args, script = VERIFY) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

/** 为每个 chunk 生成合法 map（带 chunkHash） */
function writeMapsForWork(work) {
  const chunksDir = path.join(work, 'chunks');
  const mapDir = path.join(work, 'map-results');
  fs.mkdirSync(mapDir, { recursive: true });
  for (const f of fs.readdirSync(chunksDir)) {
    const chunk = JSON.parse(fs.readFileSync(path.join(chunksDir, f), 'utf8'));
    const map = {
      chunkId: chunk.chunkId,
      chunkHash: chunk.chunkHash,
      sourceIds: chunk.sourceIds,
      summary: '摘要',
      claims: chunk.sourceIds.map((sid) => ({ claim: `${sid} 的观点`, evidenceSourceIds: [sid], confidence: 'high' })),
      themes: ['主题'],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, `map-${chunk.chunkId}.json`), JSON.stringify(map, null, 2));
  }
}

function setupWork(answerCount = 6) {
  const { dir, jsonFile } = makeCorpus(answerCount);
  const work = path.join(dir, 'work');
  const r = run([jsonFile, '--work', work], CHUNK);
  assert.equal(r.status, 0, r.stderr);
  writeMapsForWork(work);
  // 先跑一次 verify 生成 coverage.json（reduce 依赖）
  run(['--work', work]);
  return { dir, work, chunksDir: path.join(work, 'chunks'), mapDir: path.join(work, 'map-results') };
}

test('verify: 完整 map 后覆盖率通过', () => {
  const { work } = setupWork();
  const r = run(['--work', work]);
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.missingSources, 0);
  assert.equal(parsed.duplicateAssignments, 0);
  assert.equal(parsed.failedChunks, 0);
  assert.equal(parsed.invalidEvidenceRefs, 0);
  assert.equal(parsed.missingMapResults, 0);
  assert.equal(parsed.staleMaps, 0);
  assert.equal(parsed.crossChunkEvidence, 0);
  assert.equal(parsed.malformedMaps, 0);
  assert.equal(parsed.duplicateMaps, 0);
  assert.ok(parsed.manifestHash && parsed.mapSetHash, 'coverage 应含不可变快照');
});

test('verify: 删除一个 map 结果 → 验证失败', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  fs.rmSync(path.join(mapDir, first));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.missingMapResults >= 1);
});

test('verify: 跨 chunk evidence 引用 → 验证失败（P1-2）', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  // 引用一个必然不在本 chunk 的来源
  map.claims.push({ claim: 'x', evidenceSourceIds: ['question-123-answer-999'], confidence: 'high' });
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.crossChunkEvidence >= 1, `应检测到跨 chunk 引用，实际: ${parsed.crossChunkEvidence}`);
});

test('verify: map 缺 chunkHash（过期 map）→ 验证失败（P1-1）', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  delete map.chunkHash;
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.staleMaps >= 1, `应检测到 stale map，实际: ${parsed.staleMaps}`);
});

test('verify: map 的 chunkHash 与 chunk 不一致 → 验证失败（P1-1）', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  map.chunkHash = 'sha256:deadbeef';
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.staleMaps >= 1);
});

test('verify: map 缺 sourceIds → malformedMaps', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  delete map.sourceIds;
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.malformedMaps >= 1);
});

test('verify: malformed claim（缺 evidence/非法 confidence）→ malformedMaps', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  map.claims.push({ claim: '无证据断言', confidence: 'certain' });
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.malformedMaps >= 1, `应检测到 malformed claim，实际: ${parsed.malformedMaps}`);
});

test('verify: 同一 chunk 两个 map → duplicateMaps（P1-2 补充）', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const chunkId = first.replace(/^map-/, '').replace(/\.json$/, '');
  fs.copyFileSync(path.join(mapDir, first), path.join(mapDir, `map-${chunkId}-dup.json`));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.duplicateMaps >= 1 || parsed.malformedMaps >= 1, '重复 map 应被检测');
});

test('verify: 输入变化后旧 map 失效（P1-1：input 改变、sourceIds 不变）', () => {
  const { dir, work, mapDir } = setupWork();
  const jsonFile = path.join(dir, '123', 'answers.json');
  const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  // 修改内容但不改 sourceId 集合（id 不变）
  json.answers[0].content = '<p>被修改的正文内容</p>';
  fs.writeFileSync(jsonFile, JSON.stringify(json));
  // 重新 chunk：整个 digest cache 应被清除（map-results 消失）
  const r = run([jsonFile, '--work', work], CHUNK);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(work, 'coverage.json')), 'coverage 应被清除');
  assert.ok(!fs.existsSync(path.join(work, 'map-results')), 'map-results 应被清除（cache 全失效）');
  assert.ok(!fs.existsSync(path.join(work, 'reduce-input.json')), 'reduce-input 应被清除');
  // 新的 chunk 即使 id 相同，旧 map 也不能通过（目录已清空）
  const v = run(['--work', work]);
  assert.equal(v.status, 1);
  assert.ok(JSON.parse(v.stdout).missingMapResults >= 1, '新 chunk 缺 map，必须重做 map');
});

test('verify: 修改原始输入后旧状态失效（staleHashes）', () => {
  const { dir, work } = setupWork();
  const jsonFile = path.join(dir, '123', 'answers.json');
  const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  json.answers.push({ id: '100', author: 'x', content: '<p>新</p>' });
  fs.writeFileSync(jsonFile, JSON.stringify(json));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.staleHashes >= 1, '输入变化应触发 staleHashes');
});

test('verify: coverage.json 被写入且含快照', () => {
  const { work } = setupWork();
  const r = run(['--work', work]);
  assert.equal(r.status, 0);
  const coverage = JSON.parse(fs.readFileSync(path.join(work, 'coverage.json'), 'utf8'));
  assert.ok(coverage.manifestHash);
  assert.ok(coverage.mapSetHash);
  assert.ok(coverage.chunkHashByChunk);
});

test('verify --final: 有效引用通过，无效引用失败，0 引用失败', () => {
  const { work, mapDir } = setupWork();
  const finalFile = path.join(work, 'final.md');
  fs.writeFileSync(finalFile, '正文 [question-123-answer-1] 和 [question-123-answer-2]');
  const r1 = run(['--work', work, '--final', finalFile]);
  assert.equal(r1.status, 0);
  assert.equal(JSON.parse(r1.stdout).valid, true);

  fs.writeFileSync(finalFile, '正文 [question-999-answer-999]');
  const r2 = run(['--work', work, '--final', finalFile]);
  assert.equal(r2.status, 1);
  const parsed2 = JSON.parse(r2.stdout);
  assert.equal(parsed2.valid, false);
  assert.ok(parsed2.invalidRefs.includes('question-999-answer-999'));

  // 0 引用（无证据）→ 必须失败
  fs.writeFileSync(finalFile, '没有任何引用的纯文本摘要');
  const r3 = run(['--work', work, '--final', finalFile]);
  assert.equal(r3.status, 1);
  assert.equal(JSON.parse(r3.stdout).valid, false);
  assert.equal(JSON.parse(r3.stdout).hasEvidence, false);
});

// ===== handoff 完整 schema 校验 =====

function makeHandoffFile(dir, overrides = {}) {
  const { jsonFile, mdFile } = makeCorpus(3);
  const base = {
    task: 'digest',
    sourceType: 'zhihu-answers',
    questionId: '123',
    inputJson: path.relative(dir, jsonFile),
    inputMarkdown: path.relative(dir, mdFile),
    verified: true,
    answerCount: 3,
    warnings: [],
  };
  const handoff = { ...base, ...overrides };
  // 相对路径基于 dir 计算后需转为从 dir 解析
  const hf = path.join(dir, 'handoff.json');
  fs.writeFileSync(hf, JSON.stringify(handoff));
  return { hf, jsonFile, mdFile };
}

test('handoff: 完整合法通过', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-ok-'));
  const { hf } = makeHandoffFile(dir);
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(JSON.parse(r.stdout).valid, true);
});

test('handoff: 缺 inputJson → 拒绝（P1-8）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-miss-'));
  const { jsonFile, mdFile } = makeCorpus(3);
  const handoff = {
    task: 'digest',
    sourceType: 'zhihu-answers',
    questionId: '123',
    inputJson: path.relative(dir, jsonFile),
    inputMarkdown: path.relative(dir, mdFile),
    verified: true,
    answerCount: 3,
    warnings: [],
  };
  delete handoff.inputJson;
  const hf = path.join(dir, 'handoff.json');
  fs.writeFileSync(hf, JSON.stringify(handoff));
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('inputJson')));
});

test('handoff: 非法 task enum → 拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-task-'));
  const { hf } = makeHandoffFile(dir, { task: 'edit' });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('task')));
});

test('handoff: 非法 questionId → 拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-qid-'));
  const { hf } = makeHandoffFile(dir, { questionId: '../../etc/passwd' });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('questionId')));
});

test('handoff: 绝对路径 → 拒绝（不泄漏路径）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-abs-'));
  const { hf } = makeHandoffFile(dir, { inputJson: path.join(os.tmpdir(), 'out', 'x.json') });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.issues.some((i) => i.includes('相对路径')), '绝对路径应被拒绝');
});

test('handoff: warnings 非数组 → 拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-warn-'));
  const { hf } = makeHandoffFile(dir, { warnings: 'oops' });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('warnings')));
});

test('handoff: 额外字段 → 拒绝（additionalProperties）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-extra-'));
  const { hf } = makeHandoffFile(dir, { extraField: true });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('额外字段')));
});

test('handoff: answerCount 不一致 → 拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-count-'));
  const { hf } = makeHandoffFile(dir, { answerCount: 99 });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('answerCount')));
});

test('handoff: verified=false → 拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-ver-'));
  const { hf } = makeHandoffFile(dir, { verified: false });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('verified')));
});

// ===== reduce 完整性 =====

test('reduce: 覆盖率未通过时拒绝执行', () => {
  const { dir, jsonFile } = makeCorpus(3);
  const work = path.join(dir, 'work');
  run([jsonFile, '--work', work], CHUNK);
  const r = run(['--work', work], REDUCE);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /覆盖率|verify/);
});

test('reduce: coverage 生成后篡改 map → 拒绝（P1-4）', () => {
  const { work, mapDir } = setupWork();
  // 篡改一个 map
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  map.summary = '被篡改的摘要';
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work], REDUCE);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /mapSetHash|已变化|verify/);
});

test('reduce: 损坏的 map 结果 → 拒绝，不静默跳过（P1-4）', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  fs.writeFileSync(path.join(mapDir, first), '{broken');
  const r = run(['--work', work], REDUCE);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /损坏|不能静默跳过/);
});

test('reduce: 通过后生成 reduce-input 与最终文档，保留来源 ID', () => {
  const { work, mapDir } = setupWork();
  const r = run(['--work', work], REDUCE);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(work, 'reduce-input.json')));
  const finalFile = path.join(work, 'final', 'digest.md');
  assert.ok(fs.existsSync(finalFile));
  const finalText = fs.readFileSync(finalFile, 'utf8');
  assert.match(finalText, /question-123-answer-1/);
  // 最终文档必须通过 --final 验证
  const v = run(['--work', work, '--final', finalFile]);
  assert.equal(v.status, 0);
});
