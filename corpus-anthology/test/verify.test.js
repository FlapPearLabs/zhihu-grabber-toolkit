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

function makeCorpus(answerCount = 6, baseDir) {
  const dir = baseDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-verify-'));
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
      sourceCoverage: chunk.sourceIds.map((sid) => ({ sourceId: sid, summary: `${sid} 的内容概要`, disposition: 'substantive' })),
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

test('verify: map 只覆盖 chunk 部分来源 → 失败（P1-NEW-1）', () => {
  const { work, mapDir } = setupWork(40); // 40 条回答确保 chunk 含多个来源
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  // 只保留一个 sourceId：声称只 map 了 chunk 的一小部分
  map.sourceIds = [map.sourceIds[0]];
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.missingMappedSources >= 1, `应检测到未覆盖来源，实际: ${parsed.missingMappedSources}`);
});

test('verify: map.sourceIds 与 chunk 集合相等时通过（全覆盖）', () => {
  const { work } = setupWork(40);
  const r = run(['--work', work]);
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.missingMappedSources, 0);
  assert.equal(parsed.valid, true);
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

test('verify --final: final.json 每 claim 必须有 ≥1 合法证据（P1-2）', () => {
  const { work } = setupWork();
  const finalDir = path.join(work, 'final');
  fs.mkdirSync(finalDir, { recursive: true });
  const finalFile = path.join(finalDir, 'final.json');
  const validRef = 'question-123-answer-1';

  // 1. 合法：每个 claim 都有有效 evidence → 通过
  fs.writeFileSync(finalFile, JSON.stringify({
    schemaVersion: 1,
    mode: 'digest',
    claims: [
      { text: '观点 A', evidenceSourceIds: [validRef], confidence: 'high' },
      { text: '观点 B', evidenceSourceIds: [validRef], confidence: 'medium' },
    ],
  }));
  const r1 = run(['--work', work, '--final', finalFile]);
  assert.equal(r1.status, 0, r1.stdout);
  assert.equal(JSON.parse(r1.stdout).valid, true);

  // 2. 无效引用 → 失败
  fs.writeFileSync(finalFile, JSON.stringify({
    schemaVersion: 1, mode: 'digest',
    claims: [{ text: 'x', evidenceSourceIds: ['question-999-answer-999'], confidence: 'high' }],
  }));
  const r2 = run(['--work', work, '--final', finalFile]);
  assert.equal(r2.status, 1);
  const parsed2 = JSON.parse(r2.stdout);
  assert.equal(parsed2.valid, false);
  assert.ok(parsed2.invalidRefs.some((i) => i.includes('question-999-answer-999')));

  // 3. 0 引用 → 失败（claimsWithoutEvidence）
  fs.writeFileSync(finalFile, JSON.stringify({
    schemaVersion: 1, mode: 'digest',
    claims: [{ text: '没有证据的观点', evidenceSourceIds: [], confidence: 'low' }],
  }));
  const r3 = run(['--work', work, '--final', finalFile]);
  assert.equal(r3.status, 1);
  const parsed3 = JSON.parse(r3.stdout);
  assert.equal(parsed3.valid, false);
  assert.ok(parsed3.claimsWithoutEvidence >= 1, `应统计缺证据的 claim，实际: ${parsed3.claimsWithoutEvidence}`);

  // 4. 审查者反例：10 个观点只有 1 个有引用 → 必须失败
  const claims10 = [];
  for (let i = 0; i < 10; i += 1) {
    claims10.push(i === 0
      ? { text: `有证据的观点 ${i}`, evidenceSourceIds: [validRef], confidence: 'high' }
      : { text: `无证据的观点 ${i}`, evidenceSourceIds: [], confidence: 'low' });
  }
  fs.writeFileSync(finalFile, JSON.stringify({ schemaVersion: 1, mode: 'digest', claims: claims10 }));
  const r4 = run(['--work', work, '--final', finalFile]);
  assert.equal(r4.status, 1, '10 观点只有 1 个引用必须失败');
  const parsed4 = JSON.parse(r4.stdout);
  assert.equal(parsed4.valid, false);
  assert.ok(parsed4.claimsWithoutEvidence >= 9, `应检测到 9 个缺证据 claim，实际: ${parsed4.claimsWithoutEvidence}`);
});

test('verify --final: final.json 缺失/非 JSON/空 claims → 失败', () => {
  const { work } = setupWork();
  const finalDir = path.join(work, 'final');
  fs.mkdirSync(finalDir, { recursive: true });
  const finalFile = path.join(finalDir, 'final.json');
  // 缺失
  const r1 = run(['--work', work, '--final', path.join(work, 'final', 'nope.json')]);
  assert.equal(r1.status, 1);
  // 非法 JSON
  fs.writeFileSync(finalFile, '{bad json');
  const r2 = run(['--work', work, '--final', finalFile]);
  assert.equal(r2.status, 1);
  assert.ok(JSON.parse(r2.stdout).invalidRefs.some((i) => i.includes('解析')));
  // 空 claims
  fs.writeFileSync(finalFile, JSON.stringify({ schemaVersion: 1, mode: 'digest', claims: [] }));
  const r3 = run(['--work', work, '--final', finalFile]);
  assert.equal(r3.status, 1);
  assert.ok(JSON.parse(r3.stdout).invalidRefs.some((i) => i.includes('claims')));
});

// ===== handoff 完整 schema 校验 =====

function makeHandoffFile(dir, overrides = {}) {
  // corpus 必须与 handoff 同目录（containment 校验：inputJson/inputMarkdown 不得越出 handoff 所在目录）
  const { jsonFile, mdFile } = makeCorpus(3, dir);
  const base = {
    task: 'digest',
    sourceType: 'zhihu-answers',
    questionId: '123',
    inputJson: path.relative(dir, jsonFile).split(path.sep).join('/'),
    inputMarkdown: path.relative(dir, mdFile).split(path.sep).join('/'),
    verified: true,
    answerCount: 3,
    warnings: [],
  };
  const handoff = { ...base, ...overrides };
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
  const { jsonFile, mdFile } = makeCorpus(3, dir);
  const handoff = {
    task: 'digest',
    sourceType: 'zhihu-answers',
    questionId: '123',
    inputJson: path.relative(dir, jsonFile).split(path.sep).join('/'),
    inputMarkdown: path.relative(dir, mdFile).split(path.sep).join('/'),
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

test('handoff: warnings 含非字符串项 → 拒绝（P1-NEW-6）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-warn-items-'));
  const { hf } = makeHandoffFile(dir, { warnings: [123, false, { x: 1 }] });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('warnings')), '逐项类型校验应拒绝非字符串项');
});

test('handoff: questionId 为数字 → 拒绝（P1-NEW-6，schema type: string）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-qid-num-'));
  const { hf } = makeHandoffFile(dir, { questionId: 123 });
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).issues.some((i) => i.includes('字符串')), '数字 questionId 应被拒绝');
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

test('reduce: 通过后生成 reduce-input、final.json 与最终文档，保留来源 ID', () => {
  const { work, mapDir } = setupWork();
  const r = run(['--work', work], REDUCE);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(work, 'reduce-input.json')));
  const finalJsonFile = path.join(work, 'final', 'final.json');
  assert.ok(fs.existsSync(finalJsonFile), 'reduce 必须输出 canonical final.json');
  const finalFile = path.join(work, 'final', 'digest.md');
  assert.ok(fs.existsSync(finalFile));
  const finalText = fs.readFileSync(finalFile, 'utf8');
  assert.match(finalText, /question-123-answer-1/);
  // 最终文档（final.json）必须通过 --final 验证
  const v = run(['--work', work, '--final', finalJsonFile]);
  assert.equal(v.status, 0, v.stdout);
});

// ===== P1-1 sourceCoverage 语义全覆盖 =====

test('verify: map 缺 sourceCoverage → 失败（P1-1）', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  delete map.sourceCoverage;
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.malformedMaps >= 1, '应检测到缺少 sourceCoverage');
});

test('verify: sourceCoverage 漏掉 chunk 部分来源 → 失败（P1-1）', () => {
  const { work, mapDir } = setupWork(40); // 多来源 chunk
  const all = fs.readdirSync(mapDir).sort();
  let checked = false;
  for (const f of all) {
    const mapFile = path.join(mapDir, f);
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    if (map.sourceCoverage && map.sourceCoverage.length >= 2) {
      map.sourceCoverage = map.sourceCoverage.slice(0, 1); // 只保留 1 条
      fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
      const r = run(['--work', work]);
      assert.equal(r.status, 1);
      const parsed = JSON.parse(r.stdout);
      assert.ok(parsed.missingMappedSources >= 1, '应检测到 sourceCoverage 未覆盖来源');
      checked = true;
      break;
    }
  }
  assert.ok(checked, '40 条回答应存在多来源 chunk');
});

test('verify: sourceCoverage 重复记录同一来源 → 失败（P1-1）', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  map.sourceCoverage.push({ ...map.sourceCoverage[0] });
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.malformedMaps >= 1, '应检测到重复 sourceCoverage');
});

// ===== P1-3 handoff containment =====

test('handoff: inputJson 用 ../ 越出 source-root → 拒绝（P1-3）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-escape-'));
  const { hf } = makeHandoffFile(dir);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.json'), JSON.stringify({ questionId: '123', answers: [] }));
  const handoff = JSON.parse(fs.readFileSync(hf, 'utf8'));
  handoff.inputJson = path.relative(dir, path.join(outside, 'secret.json')).split(path.sep).join('/');
  fs.writeFileSync(hf, JSON.stringify(handoff));
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.issues.some((i) => i.includes('越出可信 source-root')), '应拒绝越界路径');
});

test('handoff: symlink 指向 source-root 之外 → 拒绝（P1-3）', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-symlink-'));
  const { hf } = makeHandoffFile(dir);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-outside-'));
  const secret = path.join(outside, 'secret.json');
  fs.writeFileSync(secret, JSON.stringify({ questionId: '123', answers: [] }));
  const link = path.join(dir, 'linked.json');
  fs.symlinkSync(secret, link);
  const handoff = JSON.parse(fs.readFileSync(hf, 'utf8'));
  handoff.inputJson = 'linked.json';
  fs.writeFileSync(hf, JSON.stringify(handoff));
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.issues.some((i) => i.includes('越出可信 source-root')), '应拒绝 symlink 逃逸');
});

test('handoff: 显式 --source-root 且文件在 root 内 → 通过', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-root-'));
  const { hf } = makeHandoffFile(dir);
  const r = run(['--handoff', hf, '--source-root', dir]);
  assert.equal(r.status, 0, r.stdout);
});

// ===== P1-4 questionId 三方一致（handoff 侧） =====

test('handoff: handoff.questionId 与 answers.json.questionId 不一致 → 拒绝（P1-4）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-qid-'));
  const { hf } = makeHandoffFile(dir);
  const handoff = JSON.parse(fs.readFileSync(hf, 'utf8'));
  handoff.questionId = '999';
  fs.writeFileSync(hf, JSON.stringify(handoff));
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.issues.some((i) => i.includes('questionId 不一致')), '应检测到 questionId 不一致');
});

test('handoff: inputJson 缺少 questionId 字段 → 拒绝（P1-4）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-noqid-'));
  const { hf, jsonFile } = makeHandoffFile(dir);
  const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  delete json.questionId;
  fs.writeFileSync(jsonFile, JSON.stringify(json));
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.issues.some((i) => i.includes('questionId')), '应提示缺少 questionId');
});

// ===== 本轮窄范围修复：P1-1 sourceCoverage summary 必填 =====

function sourceCoverageOnly(work, mapDir, mutate) {
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  mutate(map);
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  return run(['--work', work]);
}

test('sourceCoverage: 只有 disposition 无 summary → 失败（P1-1 Case A）', () => {
  const { work, mapDir } = setupWork();
  const r = sourceCoverageOnly(work, mapDir, (map) => {
    map.sourceCoverage = map.sourceCoverage.map((sc) => ({ sourceId: sc.sourceId, disposition: 'substantive' }));
  });
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.malformedMaps >= 1, 'disposition 不能替代 summary');
  assert.ok(parsed.issues.some((i) => i.includes('非空 summary')), '应明确指出缺 summary');
});

test('sourceCoverage: summary 为空字符串 → 失败（P1-1 Case B）', () => {
  const { work, mapDir } = setupWork();
  const r = sourceCoverageOnly(work, mapDir, (map) => {
    map.sourceCoverage = map.sourceCoverage.map((sc) => ({ sourceId: sc.sourceId, summary: '', disposition: 'substantive' }));
  });
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.malformedMaps >= 1, '空 summary 应失败');
});

test('sourceCoverage: summary 为纯空白 → 失败（P1-1 Case C）', () => {
  const { work, mapDir } = setupWork();
  const r = sourceCoverageOnly(work, mapDir, (map) => {
    map.sourceCoverage = map.sourceCoverage.map((sc) => ({ sourceId: sc.sourceId, summary: '   ', disposition: 'substantive' }));
  });
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.malformedMaps >= 1, '纯空白 summary 应失败');
});

test('sourceCoverage: 全部来源都只有 disposition → 失败（P1-1 Case D）', () => {
  const { work, mapDir } = setupWork(40); // 多来源 chunk
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  map.sourceCoverage = map.sourceCoverage.map((sc) => ({ sourceId: sc.sourceId, disposition: 'substantive' }));
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1, '机械 disposition 全覆盖必须失败');
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.malformedMaps >= 1);
});

// ===== 本轮窄范围修复：P1-2 containment 失败后禁止后续 IO =====

test('handoff: 越界损坏 JSON → 只报 containment，不得出现"无法解析"（P1-2 Case A）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-stopio-'));
  const { hf } = makeHandoffFile(dir);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-outside-'));
  const badJson = path.join(outside, 'bad.json');
  fs.writeFileSync(badJson, '{ definitely-invalid-json'); // 损坏 JSON，若被读取必然"无法解析"
  const handoff = JSON.parse(fs.readFileSync(hf, 'utf8'));
  handoff.inputJson = path.relative(dir, badJson).split(path.sep).join('/');
  fs.writeFileSync(hf, JSON.stringify(handoff));
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.issues.some((i) => i.includes('越出可信 source-root')), '应报告 containment 失败');
  assert.ok(!parsed.issues.some((i) => i.includes('无法解析')), '出现"无法解析"说明仍读取了越界文件');
});

test('handoff: symlink 指向越界损坏 JSON → 只报 containment（P1-2 Case B）', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-stopio-sym-'));
  const { hf } = makeHandoffFile(dir);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-outside-'));
  const badJson = path.join(outside, 'bad.json');
  fs.writeFileSync(badJson, '{ definitely-invalid-json');
  const link = path.join(dir, 'linked.json');
  fs.symlinkSync(badJson, link);
  const handoff = JSON.parse(fs.readFileSync(hf, 'utf8'));
  handoff.inputJson = 'linked.json';
  fs.writeFileSync(hf, JSON.stringify(handoff));
  const r = run(['--handoff', hf]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.issues.some((i) => i.includes('越出可信 source-root')), 'symlink 逃逸应报 containment');
  assert.ok(!parsed.issues.some((i) => i.includes('无法解析')), '不得读取 symlink 指向的越界文件');
});

// ===== 本轮窄范围修复：P2-1 final confidence enum =====

test('verify --final: confidence 非法值 → 失败（P2-1）', () => {
  const { work } = setupWork();
  const finalDir = path.join(work, 'final');
  fs.mkdirSync(finalDir, { recursive: true });
  const finalFile = path.join(finalDir, 'final.json');
  fs.writeFileSync(finalFile, JSON.stringify({
    schemaVersion: 1, mode: 'digest',
    claims: [{ text: '观点', evidenceSourceIds: ['question-123-answer-1'], confidence: 'certain' }],
  }));
  const r = run(['--work', work, '--final', finalFile]);
  assert.equal(r.status, 1, 'confidence=certain 必须失败');
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.invalidRefs.some((i) => i.includes('confidence')), '应报告 confidence 非法');
});

test('verify --final: confidence 缺省可接受（P2-1）', () => {
  const { work } = setupWork();
  const finalDir = path.join(work, 'final');
  fs.mkdirSync(finalDir, { recursive: true });
  const finalFile = path.join(finalDir, 'final.json');
  const claim = { text: '观点', evidenceSourceIds: ['question-123-answer-1'] };
  fs.writeFileSync(finalFile, JSON.stringify({ schemaVersion: 1, mode: 'digest', claims: [claim] }));
  const r = run(['--work', work, '--final', finalFile]);
  assert.equal(r.status, 0, r.stdout);
});

// ===== 本轮窄范围修复：P2-2 reduce --out 自动建目录 =====

test('reduce: --out 指向不存在的多级目录 → 自动创建并生成文件（P2-2）', () => {
  const { work } = setupWork();
  const deepOut = path.join(work, 'build', 'reports', 'final', 'digest.md');
  const r = run(['--work', work, '--out', deepOut], REDUCE);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(deepOut), '应自动创建多级父目录并生成 digest.md');
  assert.ok(fs.readFileSync(deepOut, 'utf8').includes('语料全覆盖摘要'), '文件内容应为渲染的摘要');
});
