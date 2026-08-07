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

function setupWork() {
  const { dir, jsonFile } = makeCorpus();
  const work = path.join(dir, 'work');
  const r = run([jsonFile, '--work', work], CHUNK);
  assert.equal(r.status, 0, r.stderr);
  // 为每个 chunk 生成 map 结果
  const chunksDir = path.join(work, 'chunks');
  const mapDir = path.join(work, 'map-results');
  fs.mkdirSync(mapDir, { recursive: true });
  for (const f of fs.readdirSync(chunksDir)) {
    const chunk = JSON.parse(fs.readFileSync(path.join(chunksDir, f), 'utf8'));
    const map = {
      chunkId: chunk.chunkId,
      sourceIds: chunk.sourceIds,
      summary: '摘要',
      claims: chunk.sourceIds.map((sid) => ({ claim: `${sid} 的观点`, evidenceSourceIds: [sid], confidence: 'high' })),
      themes: ['主题'],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, `map-${chunk.chunkId}.json`), JSON.stringify(map, null, 2));
  }
  // 先跑一次 verify 生成 coverage.json（reduce 依赖）
  run(['--work', work]);
  return { dir, work, chunksDir, mapDir };
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

test('verify: 非法 evidence ID 被发现', () => {
  const { work, mapDir } = setupWork();
  const first = fs.readdirSync(mapDir).sort()[0];
  const mapFile = path.join(mapDir, first);
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  map.claims.push({ claim: 'x', evidenceSourceIds: ['question-999-answer-999'], confidence: 'high' });
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  const r = run(['--work', work]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.invalidEvidenceRefs >= 1);
});

test('verify: 修改原始输入后旧状态失效', () => {
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

test('verify: coverage.json 被写入', () => {
  const { work } = setupWork();
  const r = run(['--work', work]);
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(work, 'coverage.json')));
});

test('verify --final: 最终文档引用有效来源通过，无效来源失败', () => {
  const { work, mapDir } = setupWork();
  const finalFile = path.join(work, 'final.md');
  fs.writeFileSync(finalFile, '正文 [question-123-answer-1] 和 [question-123-answer-2]');
  const r1 = run(['--work', work, '--final', finalFile]);
  assert.equal(r1.status, 0);
  assert.equal(JSON.parse(r1.stdout).valid, true);

  fs.writeFileSync(finalFile, '正文 [question-999-answer-999]');
  const r2 = run(['--work', work, '--final', finalFile]);
  assert.equal(r2.status, 1);
  const parsed = JSON.parse(r2.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.invalidRefs.includes('question-999-answer-999'));
});

test('verify --handoff: 已验证 handoff 通过', () => {
  const { dir, jsonFile } = makeCorpus(3);
  const handoff = {
    task: 'digest',
    sourceType: 'zhihu-answers',
    questionId: '123',
    inputJson: jsonFile,
    inputMarkdown: path.join(path.dirname(jsonFile), 'answers.md'),
    verified: true,
    answerCount: 3,
    warnings: [],
  };
  fs.writeFileSync(path.join(dir, 'handoff.json'), JSON.stringify(handoff));
  const r = run(['--handoff', path.join(dir, 'handoff.json')]);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).valid, true);
});

test('verify --handoff: verified=false 被拒绝', () => {
  const { dir, jsonFile } = makeCorpus(3);
  const handoff = {
    task: 'digest',
    sourceType: 'zhihu-answers',
    questionId: '123',
    inputJson: jsonFile,
    inputMarkdown: 'x.md',
    verified: false,
    answerCount: 3,
    warnings: [],
  };
  fs.writeFileSync(path.join(dir, 'handoff.json'), JSON.stringify(handoff));
  const r = run(['--handoff', path.join(dir, 'handoff.json')]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.issues.some((i) => i.includes('verified')));
});

test('verify --handoff: answerCount 不一致被拒绝', () => {
  const { dir, jsonFile } = makeCorpus(3);
  const handoff = {
    task: 'digest',
    sourceType: 'zhihu-answers',
    questionId: '123',
    inputJson: jsonFile,
    inputMarkdown: 'x.md',
    verified: true,
    answerCount: 99,
    warnings: [],
  };
  fs.writeFileSync(path.join(dir, 'handoff.json'), JSON.stringify(handoff));
  const r = run(['--handoff', path.join(dir, 'handoff.json')]);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.issues.some((i) => i.includes('answerCount')));
});

test('reduce: 覆盖率未通过时拒绝执行', () => {
  const { dir, jsonFile } = makeCorpus(3);
  const work = path.join(dir, 'work');
  run([jsonFile, '--work', work], CHUNK);
  const r = run(['--work', work], REDUCE);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /覆盖率|verify/);
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
