import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/make-handoff.mjs', import.meta.url));

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-handoff-'));
  const outDir = path.join(dir, 'out', '123');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify({
    questionId: '123',
    questionTitle: '测试',
    answerCount: 2,
    answers: [
      { id: '1', author: 'A', content: '<p>x</p>' },
      { id: '2', author: 'B', content: '<p>y</p>' },
    ],
  }));
  fs.writeFileSync(path.join(outDir, 'answers.md'), '# 测试\n\n## 1. A\nx\n\n## 2. B\ny\n');
  fs.writeFileSync(path.join(outDir, '.progress.json'), JSON.stringify({ offset: 40, done: true }));
  return { dir, outDir };
}

function runHandoff(outDir, task = 'digest') {
  return spawnSync(process.execPath, [SCRIPT, outDir, '--task', task], { encoding: 'utf8' });
}

test('make-handoff 有效产物 → 生成 verified=true handoff', () => {
  const { outDir } = makeFixture();
  const r = runHandoff(outDir);
  assert.equal(r.status, 0, r.stderr);
  const handoff = JSON.parse(fs.readFileSync(path.join(outDir, 'handoff.json'), 'utf8'));
  assert.equal(handoff.verified, true);
  assert.equal(handoff.questionId, '123');
  assert.equal(handoff.answerCount, 2);
  assert.equal(handoff.task, 'digest');
  assert.equal(handoff.sourceType, 'zhihu-answers');
  // 相对路径：inputJson 必须是文件名（相对 handoff 所在目录）
  assert.equal(handoff.inputJson, 'answers.json');
  assert.equal(handoff.inputMarkdown, 'answers.md');
  assert.ok(!path.isAbsolute(handoff.inputJson), 'inputJson 必须是相对路径');
});

test('make-handoff --task archive / inspect 均支持', () => {
  for (const task of ['archive', 'inspect']) {
    const { outDir } = makeFixture();
    const r = runHandoff(outDir, task);
    assert.equal(r.status, 0, `${task}: ${r.stderr}`);
    const handoff = JSON.parse(fs.readFileSync(path.join(outDir, 'handoff.json'), 'utf8'));
    assert.equal(handoff.task, task);
  }
});

test('make-handoff 非法 --task 拒绝生成', () => {
  const { outDir } = makeFixture();
  const r = spawnSync(process.execPath, [SCRIPT, outDir, '--task', 'edit'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(outDir, 'handoff.json')), '非法 task 不得生成 handoff');
});

test('make-handoff 未通过验证（progress.done=false）→ 拒绝生成 verified=true', () => {
  const { outDir } = makeFixture();
  fs.writeFileSync(path.join(outDir, '.progress.json'), JSON.stringify({ offset: 5, done: false }));
  const r = runHandoff(outDir);
  assert.notEqual(r.status, 0, '未完成产物应被拒绝');
  assert.ok(!fs.existsSync(path.join(outDir, 'handoff.json')), '不得生成 handoff');
});

test('make-handoff 产物损坏（JSON 与 MD 不一致）→ 拒绝生成', () => {
  const { outDir } = makeFixture();
  fs.writeFileSync(path.join(outDir, 'answers.md'), '# 测试\n\n## 1. A\nx\n'); // 只有 1 条记录
  const r = runHandoff(outDir);
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(outDir, 'handoff.json')), '不一致产物不得生成 handoff');
});

test('make-handoff 生成失败时给出原因（warnings 列表）', () => {
  const { outDir } = makeFixture();
  fs.rmSync(path.join(outDir, 'answers.md'));
  const r = runHandoff(outDir);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes('answers.md'), '错误信息应指出缺失文件');
});
