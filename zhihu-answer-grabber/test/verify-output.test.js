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

test('verify-output 目录名与 answers.json.questionId 不一致 → valid false（P1-4）', () => {
  const { outDir, files } = makeFixture();
  // 模拟目录被改名：JSON 里 questionId 仍是 123，但目录改为 456
  const renamed = path.join(path.dirname(outDir), '456');
  fs.renameSync(outDir, renamed);
  fs.writeFileSync(path.join(renamed, 'answers.md'), '# 测试\n\n## 1. A\nx\n\n## 2. B\ny\n');
  const r = runVerify(renamed);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('不一致')), '应检测到目录名与 JSON questionId 不一致');
  assert.equal(parsed.jsonQuestionId, '123');
});

test('verify-output answers.json 缺少 questionId → valid false（P1-4）', () => {
  const { outDir, files } = makeFixture();
  const json = JSON.parse(fs.readFileSync(files.answersJson, 'utf8'));
  delete json.questionId;
  fs.writeFileSync(files.answersJson, JSON.stringify(json));
  const r = runVerify(outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('questionId')));
});

test('verify-output reportedAnswerCount 不一致 → 诊断字段保留 + DIAGNOSTIC_ONLY（不进 warnings，P2-3，T3 归一化）', () => {
  const { outDir, files } = makeFixture();
  const json = JSON.parse(fs.readFileSync(files.answersJson, 'utf8'));
  json.reportedAnswerCount = 253; // 页面统计 253，实际抓 2
  fs.writeFileSync(files.answersJson, JSON.stringify(json));
  const r = runVerify(outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true, '数量不一致只是诊断，不得让 valid=false');
  // 三诊断字段必须保留（VERIFIER_DIAGNOSTIC_RESULT 不变）
  assert.equal(parsed.countMismatch, true);
  assert.equal(parsed.capturedAnswerCount, 2);
  assert.equal(parsed.reportedAnswerCount, 253);
  // T3 归一化后，countMismatch 不再写入 warnings[]（DIAGNOSTIC_ONLY）
  assert.ok(
    !parsed.warnings.some((w) => w.includes('不一致') || w.includes('countMismatch')),
    'countMismatch 不得再进入 verifier.warnings[]'
  );
});

// ===== Fix 6：legacy raw-array 不能升级为 canonical verified handoff =====

test('Fix6: answers.json 为 raw-array（缺 questionId）→ valid=false，拒绝验证', () => {
  const { outDir, files } = makeFixture();
  // 历史 raw-array 形态：纯数组，无 questionId 元信息
  fs.writeFileSync(files.answersJson, JSON.stringify([
    { id: '1', author: 'A', content: '<p>x</p>' },
    { id: '2', author: 'B', content: '<p>y</p>' },
  ]));
  const r = runVerify(outDir);
  assert.equal(r.status, 1, 'raw-array 不能通过验证（缺 questionId）');
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('raw-array')), '应明确指出 raw-array 形态问题');
});

// ===== F1: fenced code 假匹配回归（VERIFIER_FALSE_POSITIVE_FENCED_CODE） =====
// 真实证据：538 真帧 + 7 fenced-code 假匹配（回答代码块内 markdown 文档 `## 0.` … `## 6.`）→ 545。
// verifier 必须 fence-aware 计数：fence 内 `## N.` 不计入，fence 外真帧全计入。

test('F1: fenced code 内 ## N. 假匹配不再导致 valid=false', () => {
  const { outDir, files } = makeFixture();
  // 1 条 JSON 回答；answers.md 真帧 1 个 + fenced code 内 2 个假 ## N. 行
  const json = JSON.parse(fs.readFileSync(files.answersJson, 'utf8'));
  json.answers = [{ id: '1', author: 'A', content: '<p>x</p>' }];
  fs.writeFileSync(files.answersJson, JSON.stringify(json));
  fs.writeFileSync(files.answersMd, [
    '# 测试',
    '',
    '## 1. A — 0 赞 · 0 评论',
    '',
    '```markdown',
    '## 1. 假帧一',
    '## 2. 假帧二',
    '```',
    '',
  ].join('\n'));
  const r = runVerify(outDir);
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true, 'fenced code 内 ## N. 不得影响记录数校验');
});

test('F1: 多帧 + 带 lang fence 形态 valid=true（真实 DOGFOOD_1 场景）', () => {
  const { outDir, files } = makeFixture();
  // 2 条 JSON 回答；md 2 真帧 + 带 lang fence 内 3 个假帧
  fs.writeFileSync(files.answersMd, [
    '# 测试',
    '',
    '## 1. A — 1 赞 · 0 评论',
    '',
    '``` js',
    '## 0. 任务坐标',
    '## 1. 目录层',
    '## 2. 配置层',
    '```',
    '',
    '## 2. B — 2 赞 · 0 评论',
    '',
  ].join('\n'));
  const r = runVerify(outDir);
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true, '带 lang fence 内假帧不得计入，真帧必须全部计入');
});

test('F1: fence 外真帧缺失仍报记录数不一致（修复不放松既有语义）', () => {
  const { outDir, files } = makeFixture();
  // 2 条 JSON；md 只有 1 个真帧（无 fence）—— 修复不得掩盖真实缺帧
  fs.writeFileSync(files.answersMd, '# 测试\n\n## 1. A\nx\n');
  const r = runVerify(outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('Markdown')));
});
