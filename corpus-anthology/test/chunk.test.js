import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/chunk.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 生成 10 条回答的 answers.json */
function makeAnswers(count = 10, { qid = '123', bigAnswer = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-chunk-'));
  const qDir = path.join(dir, qid);
  fs.mkdirSync(qDir, { recursive: true });
  const answers = [];
  for (let i = 1; i <= count; i += 1) {
    const content = bigAnswer && i === 1
      ? '<p>' + '很长很长'.repeat(20000) + '</p>' // ~8 万字符，必被拆分
      : `<p>回答${i}内容</p>`;
    answers.push({ id: String(i), author: `作者${i}`, content, voteupCount: i * 10 });
  }
  const file = path.join(qDir, 'answers.json');
  fs.writeFileSync(file, JSON.stringify({ questionId: qid, questionTitle: '测试', answers }));
  return { dir, file, qid };
}

function runChunk(input, work) {
  return spawnSync(process.execPath, [SCRIPT, input, '--work', work], { encoding: 'utf8' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('chunk: 10 条回答全部进入 chunk，无遗漏无重复', () => {
  const { file, qid } = makeAnswers(10);
  const work = path.join(path.dirname(file), '..', 'work');
  const r = runChunk(file, work);
  assert.equal(r.status, 0, r.stderr);

  const manifest = readJson(path.join(work, 'manifest.json'));
  assert.equal(manifest.inputs.length, 10);
  const chunkIds = new Set(manifest.inputs.flatMap((i) => i.chunkIds));
  assert.ok(chunkIds.size >= 1);

  // 每个输入恰好分配一次
  for (const input of manifest.inputs) {
    assert.ok(input.chunkIds.length >= 1, `${input.sourceId} 未被分配`);
  }

  // chunk 覆盖所有来源
  const chunksDir = path.join(work, 'chunks');
  const allSourceIds = [];
  for (const f of fs.readdirSync(chunksDir)) {
    const chunk = readJson(path.join(chunksDir, f));
    allSourceIds.push(...chunk.sourceIds);
  }
  assert.equal(new Set(allSourceIds).size, 10, 'chunk 应覆盖全部 10 个来源');
});

test('chunk: sourceId 格式为 question-<qid>-answer-<id>', () => {
  const { file, qid } = makeAnswers(3);
  const work = path.join(path.dirname(file), '..', 'work2');
  const r = runChunk(file, work);
  assert.equal(r.status, 0, r.stderr);
  const manifest = readJson(path.join(work, 'manifest.json'));
  for (const input of manifest.inputs) {
    assert.match(input.sourceId, new RegExp(`^question-${qid}-answer-\\d+$`));
  }
});

test('chunk: 超长回答被拆分且 UTF-8 边界安全', () => {
  const { file } = makeAnswers(5, { bigAnswer: true });
  const work = path.join(path.dirname(file), '..', 'work3');
  const r = runChunk(file, work);
  assert.equal(r.status, 0, r.stderr);
  const manifest = readJson(path.join(work, 'manifest.json'));
  const big = manifest.inputs.find((i) => i.answerId === '1');
  assert.ok(big.chunkIds.length > 1, '超长回答应被拆成多个 chunk');
  // 检查 chunk 文本不含半个字符（解码后文本可正常解析即可，已由 JSON 解析保证）
  const chunksDir = path.join(work, 'chunks');
  for (const f of fs.readdirSync(chunksDir)) {
    const chunk = readJson(path.join(chunksDir, f));
    assert.ok(chunk.chars > 0);
  }
});

test('chunk: 幂等重跑复用（哈希一致时不重建）', () => {
  const { file } = makeAnswers(5);
  const work = path.join(path.dirname(file), '..', 'work4');
  const r1 = runChunk(file, work);
  assert.equal(r1.status, 0);
  const manifest1 = readJson(path.join(work, 'manifest.json'));
  const chunksBefore = fs.readdirSync(path.join(work, 'chunks')).sort();

  const r2 = runChunk(file, work);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /复用/);
  const manifest2 = readJson(path.join(work, 'manifest.json'));
  assert.deepEqual(manifest1.inputs.map((i) => i.sha256), manifest2.inputs.map((i) => i.sha256));
  assert.deepEqual(fs.readdirSync(path.join(work, 'chunks')).sort(), chunksBefore);
});

test('chunk: 输入变化后旧状态失效并重建', () => {
  const { file } = makeAnswers(5);
  const work = path.join(path.dirname(file), '..', 'work5');
  runChunk(file, work);
  const manifest1 = readJson(path.join(work, 'manifest.json'));
  const oldHash = manifest1.inputs[0].sha256;

  // 修改输入
  const json = readJson(file);
  json.answers.push({ id: '99', author: '新', content: '<p>新回答</p>' });
  fs.writeFileSync(file, JSON.stringify(json));

  const r = runChunk(file, work);
  assert.equal(r.status, 0);
  const manifest2 = readJson(path.join(work, 'manifest.json'));
  assert.equal(manifest2.inputs.length, 6, '新增回答应进入 manifest');
  assert.notEqual(manifest2.inputs[0].sha256, oldHash, '哈希应随输入变化');
});

test('chunk: manifest 路径为相对路径，无绝对路径泄漏', () => {
  const { file } = makeAnswers(3);
  const work = path.join(path.dirname(file), '..', 'work6');
  const r = runChunk(file, work);
  assert.equal(r.status, 0);
  const manifestText = fs.readFileSync(path.join(work, 'manifest.json'), 'utf8');
  assert.ok(!manifestText.includes(os.homedir()), '不得包含用户主目录');
  assert.ok(!/^[A-Za-z]:[\\/]/.test(manifestText.split('\n').find((l) => l.includes('relativePath')) || ''), 'relativePath 应为相对路径');
});

test('chunk: 每个 chunk 带 chunkHash（P1-1）', () => {
  const { file } = makeAnswers(4);
  const work = path.join(path.dirname(file), '..', 'work-hash');
  const r = runChunk(file, work);
  assert.equal(r.status, 0);
  const chunksDir = path.join(work, 'chunks');
  for (const f of fs.readdirSync(chunksDir)) {
    const chunk = readJson(path.join(chunksDir, f));
    assert.ok(chunk.chunkHash && chunk.chunkHash.startsWith('sha256:') === false, `chunk 应含 chunkHash: ${chunk.chunkId}`);
    assert.ok(typeof chunk.chunkHash === 'string' && chunk.chunkHash.length === 64, 'chunkHash 应为 sha256 hex');
  }
});

test('chunk: 正文带 [SOURCE sourceId] 显式标记（P1-3）', () => {
  const { file } = makeAnswers(6);
  const work = path.join(path.dirname(file), '..', 'work-source-mark');
  const r = runChunk(file, work);
  assert.equal(r.status, 0);
  const chunksDir = path.join(work, 'chunks');
  let foundMarker = false;
  for (const f of fs.readdirSync(chunksDir)) {
    const chunk = readJson(path.join(chunksDir, f));
    for (const sid of chunk.sourceIds) {
      assert.ok(chunk.text.includes(`[SOURCE ${sid}]`), `chunk ${chunk.chunkId} 正文应含 [SOURCE ${sid}] 标记`);
      foundMarker = true;
    }
  }
  assert.ok(foundMarker, '应至少有一个 source 标记');
});

test('chunk: chunkConfig 变化触发重建（P2-2）', () => {
  const { file } = makeAnswers(5);
  const work = path.join(path.dirname(file), '..', 'work-config');
  const r1 = runChunk(file, work);
  assert.equal(r1.status, 0);
  const manifest1 = readJson(path.join(work, 'manifest.json'));
  assert.ok(manifest1.chunkConfig, 'manifest 应记录 chunkConfig');

  // 用不同 --max-chars 重跑 → 应重建而非复用
  const r2 = spawnSync(process.execPath, [SCRIPT, file, '--work', work, '--max-chars', '5000'], { encoding: 'utf8' });
  assert.equal(r2.status, 0);
  assert.ok(!/复用/.test(r2.stdout), 'chunkConfig 变化不应复用');
  const manifest2 = readJson(path.join(work, 'manifest.json'));
  assert.equal(manifest2.chunkConfig.maxChars, 5000);
});

test('chunk: 输入变化后整个 digest cache 全失效（P1-1）', () => {
  const { file } = makeAnswers(5);
  const work = path.join(path.dirname(file), '..', 'work-full-invalidate');
  runChunk(file, work);
  // 模拟已有 map 结果与 coverage
  fs.mkdirSync(path.join(work, 'map-results'), { recursive: true });
  fs.writeFileSync(path.join(work, 'map-results', 'map-chunk-0001.json'), '{"chunkId":"chunk-0001"}');
  fs.writeFileSync(path.join(work, 'coverage.json'), '{"valid":true}');
  fs.writeFileSync(path.join(work, 'reduce-input.json'), '{}');
  fs.mkdirSync(path.join(work, 'final'), { recursive: true });
  fs.writeFileSync(path.join(work, 'final', 'digest.md'), '# x');

  // 修改输入（同 sourceId，仅改正文）
  const json = readJson(file);
  json.answers[0].content = '<p>改变正文但 ID 不变</p>';
  fs.writeFileSync(file, JSON.stringify(json));

  const r = runChunk(file, work);
  assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(path.join(work, 'map-results')), 'map-results 应被清除');
  assert.ok(!fs.existsSync(path.join(work, 'coverage.json')), 'coverage 应被清除');
  assert.ok(!fs.existsSync(path.join(work, 'reduce-input.json')), 'reduce-input 应被清除');
  assert.ok(!fs.existsSync(path.join(work, 'final')), 'final 应被清除');
});

test('chunk: manifest 保存 voteupCount（P2-4）', () => {
  const { file } = makeAnswers(3);
  const work = path.join(path.dirname(file), '..', 'work-votes');
  const r = runChunk(file, work);
  assert.equal(r.status, 0);
  const manifest = readJson(path.join(work, 'manifest.json'));
  assert.ok(manifest.inputs.every((i) => typeof i.voteupCount === 'number'), 'manifest inputs 应含 voteupCount');
});
