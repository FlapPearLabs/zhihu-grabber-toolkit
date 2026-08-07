import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/verify-output.mjs', import.meta.url));

function makeFixture(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-verify-'));
  const outDir = path.join(dir, 'out', '123');
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    answersJson: path.join(outDir, 'answers.json'),
    answersMd: path.join(outDir, 'answers.md'),
    progress: path.join(outDir, '.progress.json'),
  };
  fs.writeFileSync(files.answersJson, JSON.stringify({
    questionId: '123',
    questionTitle: '测试',
    answerCount: 2,
    answers: [
      { id: '1', author: 'A', content: '<p>x</p>' },
      { id: '2', author: 'B', content: '<p>y</p>' },
    ],
  }));
  fs.writeFileSync(files.answersMd, '# 测试\n\n## 1. A\nx\n\n## 2. B\ny\n');
  fs.writeFileSync(files.progress, JSON.stringify({ offset: 40, done: true }));
  return { dir, outDir, files };
}

function runVerify(outDir) {
  return spawnSync(process.execPath, [SCRIPT, outDir], { encoding: 'utf8' });
}

test('verify-output 有效产物 → valid true', () => {
  const { outDir } = makeFixture();
  const r = runVerify(outDir);
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.done, true);
  assert.equal(parsed.answers, 2);
  assert.equal(parsed.duplicates, 0);
  assert.equal(parsed.jsonValid, true);
  assert.equal(parsed.markdownPresent, true);
});

test('verify-output 缺失 answers.json → valid false', () => {
  const { outDir, files } = makeFixture();
  fs.rmSync(files.answersJson);
  const r = runVerify(outDir);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('answers.json 不存在')));
});

test('verify-output 损坏 JSON → valid false', () => {
  const { outDir, files } = makeFixture();
  fs.writeFileSync(files.answersJson, '{broken');
  const r = runVerify(outDir);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.jsonValid, false);
});

test('verify-output 重复回答 ID → valid false', () => {
  const { outDir, files } = makeFixture();
  fs.writeFileSync(files.answersJson, JSON.stringify({
    answers: [{ id: '1' }, { id: '1' }],
  }));
  const r = runVerify(outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.equal(parsed.duplicates, 1);
});

test('verify-output done !== true → valid false', () => {
  const { outDir, files } = makeFixture();
  fs.writeFileSync(files.progress, JSON.stringify({ offset: 40, done: false }));
  const r = runVerify(outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('done')));
});

test('verify-output 损坏状态文件 → valid false', () => {
  const { outDir } = makeFixture();
  fs.writeFileSync(path.join(outDir, '.progress.json.corrupt-1'), 'x');
  const r = runVerify(outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('.corrupt-')));
});

test('verify-output Markdown 与 JSON 记录数不一致 → valid false', () => {
  const { outDir, files } = makeFixture();
  fs.writeFileSync(files.answersMd, '# 测试\n\n## 1. A\nx\n');
  const r = runVerify(outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('Markdown')));
});

test('verify-output 空输出（0 条回答）→ valid false', () => {
  const { outDir, files } = makeFixture();
  fs.writeFileSync(files.answersJson, JSON.stringify({ answers: [] }));
  fs.writeFileSync(files.answersMd, '# 测试\n');
  const r = runVerify(outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('空')));
});
