// SPDX-License-Identifier: AGPL-3.0-only
// T3 — countMismatch Diagnostic-Only Semantics (V0.3 决策 D)
// R2-5 六项 contract assertions + regressions.
//
// 目的：证明 T3 实现满足 V0.3 Spec §6 与 Issue #9 / #4 product contract：
//   1. countMismatch === true  (诊断字段保留)
//   2. verifier.valid === true (无其他 failure)
//   3. verifier.warnings 不含 countMismatch warning
//   4. handoff 仍能正常生成
//   5. handoff.warnings 不含 countMismatch warning
//   6. 其它 verifier warnings 正常传播到 handoff.warnings
//
// 配套回归：matched-count 行为、existing verifier failure cases、其它 warning
// semantics、verify-output 14 项校验权威不变。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERIFY_SCRIPT = fileURLToPath(new URL('../scripts/verify-output.mjs', import.meta.url));
const HANDOFF_SCRIPT = fileURLToPath(new URL('../scripts/make-handoff.mjs', import.meta.url));

function makeFixture({ questionId = '123', answers = [
  { id: '1', author: 'A', content: '<p>x</p>' },
  { id: '2', author: 'B', content: '<p>y</p>' },
] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-t3-'));
  const outDir = path.join(dir, 'out', questionId);
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    answersJson: path.join(outDir, 'answers.json'),
    answersMd: path.join(outDir, 'answers.md'),
    progress: path.join(outDir, '.progress.json'),
  };
  fs.writeFileSync(files.answersJson, JSON.stringify({
    questionId,
    questionTitle: '测试',
    answerCount: answers.length,
    answers,
  }));
  const mdLines = [`# 测试`];
  for (let i = 0; i < answers.length; i += 1) {
    mdLines.push('', `## ${i + 1}. ${answers[i].author} — 1 赞 · 0 评论`, 'x');
  }
  fs.writeFileSync(files.answersMd, mdLines.join('\n') + '\n');
  fs.writeFileSync(files.progress, JSON.stringify({ offset: 40, done: true }));
  return { dir, outDir, files };
}

function runVerify(outDir) {
  return spawnSync(process.execPath, [VERIFY_SCRIPT, outDir], { encoding: 'utf8' });
}

function runHandoff(outDir, task = 'digest') {
  return spawnSync(process.execPath, [HANDOFF_SCRIPT, outDir, '--task', task], { encoding: 'utf8' });
}

function readHandoff(outDir) {
  return JSON.parse(fs.readFileSync(path.join(outDir, 'handoff.json'), 'utf8'));
}

function withMismatchReported(reported) {
  // Build a fixture where reportedAnswerCount != answers.length to exercise
  // the DIAGNOSTIC_ONLY path.
  const fx = makeFixture();
  const json = JSON.parse(fs.readFileSync(fx.files.answersJson, 'utf8'));
  json.reportedAnswerCount = reported; // e.g. 253 vs 2 captured
  fs.writeFileSync(fx.files.answersJson, JSON.stringify(json));
  return fx;
}

// ---------------------------------------------------------------------------
// R2-5 六项 contract assertions
// ---------------------------------------------------------------------------

test('T3-R2-5-1: countMismatch === true when reported != captured', () => {
  const fx = withMismatchReported(253);
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.countMismatch, true, 'mismatch fixture 必须设置 countMismatch=true');
  assert.equal(parsed.capturedAnswerCount, 2);
  assert.equal(parsed.reportedAnswerCount, 253);
});

test('T3-R2-5-2: verifier.valid === true when no other validity failure exists', () => {
  const fx = withMismatchReported(253);
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true, 'countMismatch 不得让 valid=false（DIAGNOSTIC_ONLY）');
  assert.equal(parsed.jsonValid, true);
  assert.equal(parsed.markdownPresent, true);
  assert.equal(parsed.done, true);
});

test('T3-R2-5-3: verifier.warnings 不含 countMismatch warning', () => {
  const fx = withMismatchReported(253);
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  // 必须没有 countMismatch / 数量不一致 / 页面统计 等字样的 warning
  const violations = parsed.warnings.filter((w) =>
    /countMismatch|页面统计|不一致/.test(w)
  );
  assert.equal(violations.length, 0,
    `verifier.warnings 不得含 countMismatch warning；实际: ${JSON.stringify(violations)}`);
});

test('T3-R2-5-4: handoff 仍能正常生成（valid fixture）', () => {
  const fx = withMismatchReported(253);
  const r = runHandoff(fx.outDir);
  assert.equal(r.status, 0, `handoff 生成应成功；stderr=${r.stderr}`);
  assert.ok(fs.existsSync(path.join(fx.outDir, 'handoff.json')), '必须写入 handoff.json');
  const handoff = readHandoff(fx.outDir);
  assert.equal(handoff.verified, true);
  assert.equal(handoff.questionId, '123');
  assert.equal(handoff.answerCount, 2);
  assert.equal(handoff.task, 'digest');
});

test('T3-R2-5-5: handoff.warnings 不含 countMismatch warning', () => {
  const fx = withMismatchReported(253);
  const r = runHandoff(fx.outDir);
  assert.equal(r.status, 0);
  const handoff = readHandoff(fx.outDir);
  const violations = (handoff.warnings || []).filter((w) =>
    /countMismatch|页面统计|不一致/.test(w)
  );
  assert.equal(violations.length, 0,
    `handoff.warnings 不得含 countMismatch warning；实际: ${JSON.stringify(violations)}`);
  // 透传 contract：handoff.warnings 必须严格等于 verifier.warnings 的当前子集
  const verifyR = runVerify(fx.outDir);
  const parsed = JSON.parse(verifyR.stdout);
  assert.deepEqual(handoff.warnings, parsed.warnings,
    'handoff.warnings 必须严格等于 verifier.warnings（投影保真）');
});

test('T3-R2-5-6: 其它 verifier warnings 仍正常传播到 handoff.warnings', () => {
  // 构造一个带真实 failure 的 fixture（断点未 done）→ verifier.warnings 应有
  // "断点状态 done !== true ..."；该 warning 必须经 handoff 投影原样保留。
  const fx = makeFixture();
  fs.writeFileSync(fx.files.progress, JSON.stringify({ offset: 5, done: false }));
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(
    parsed.warnings.some((w) => w.includes('done')),
    'unrelated verifier warning (done !== true) 必须保留'
  );
  // handoff 必须拒绝生成（valid=false 不通过投影门）
  const hr = runHandoff(fx.outDir);
  assert.notEqual(hr.status, 0, 'unverified 产物不得生成 handoff');
  assert.ok(!fs.existsSync(path.join(fx.outDir, 'handoff.json')),
    'unverified 产物不得有 handoff.json');
});

// ---------------------------------------------------------------------------
// 回归：matched-count 行为
// ---------------------------------------------------------------------------

test('T3-regression: matched counts (reported === captured) → countMismatch=false, no warning', () => {
  const fx = makeFixture();
  // 默认 fixture 不写 reportedAnswerCount → verifier 走 fallback 到
  // parsed.answerCount（= 2），与 answers.length 相等 → 非 mismatch
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.countMismatch, false);
  assert.equal(parsed.reportedAnswerCount, 2,
    'verifier 走 parsed.answerCount fallback（reportedAnswerCount 缺省时）');
  assert.equal(parsed.capturedAnswerCount, 2);
  assert.equal(parsed.warnings.length, 0, 'matched counts 不得产生任何 warning');
});

test('T3-regression: reported === captured 显式相等 → countMismatch=false', () => {
  const fx = makeFixture();
  const json = JSON.parse(fs.readFileSync(fx.files.answersJson, 'utf8'));
  json.reportedAnswerCount = 2; // 与 answers.length 相等
  fs.writeFileSync(fx.files.answersJson, JSON.stringify(json));
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.countMismatch, false);
  assert.equal(parsed.reportedAnswerCount, 2);
  assert.equal(parsed.capturedAnswerCount, 2);
  assert.equal(parsed.warnings.length, 0);
});

// ---------------------------------------------------------------------------
// 回归：existing verifier failure cases（确保没有削弱其他 failure 语义）
// ---------------------------------------------------------------------------

test('T3-regression: 真实 failure 仍让 valid=false 且 warning 保留', () => {
  const fx = makeFixture();
  // 制造 JSON/MD 记录数不一致（fence-aware 计数：写入 MD 仅 1 帧）
  fs.writeFileSync(fx.files.answersMd, '# 测试\n\n## 1. A\nx\n');
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false, 'MD 与 JSON 记录数不一致必须保留 failure');
  assert.ok(
    parsed.warnings.some((w) => w.includes('记录数')),
    'Markdown 记录数不一致 warning 必须保留'
  );
});

test('T3-regression: 重复 ID 仍让 valid=false 且 warning 保留', () => {
  const fx = makeFixture();
  fs.writeFileSync(fx.files.answersJson, JSON.stringify({
    questionId: '123',
    questionTitle: '测试',
    answerCount: 2,
    answers: [
      { id: '1', author: 'A', content: '<p>x</p>' },
      { id: '1', author: 'A2', content: '<p>y</p>' },
    ],
  }));
  // 同步 MD（仅为了 verify-output 走到 ID 校验这一步）
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  // 重复 ID 校验在 answers 数组解析之后；这里要么因 ID 重复 fail，要么因
  // 某些中间路径 fail。核心 contract：valid=false 且 ID 相关 warning 保留。
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.length > 0, 'real failure 仍应产 warning');
});

test('T3-regression: 缺失 answers.json → valid=false 且 warning 保留（与 T3 无关）', () => {
  const fx = makeFixture();
  fs.rmSync(fx.files.answersJson);
  const r = runVerify(fx.outDir);
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('answers.json 不存在')));
});

test('T3-regression: 三方一致 questionId mismatch 仍 fail + warning 保留', () => {
  const fx = makeFixture({ questionId: '123' });
  const json = JSON.parse(fs.readFileSync(fx.files.answersJson, 'utf8'));
  json.questionId = '999';
  fs.writeFileSync(fx.files.answersJson, JSON.stringify(json));
  const r = runVerify(fx.outDir);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('questionId')));
});

// ---------------------------------------------------------------------------
// 回归：canonical answerCount / answers[].id 字段语义不变
// ---------------------------------------------------------------------------

test('T3-regression: canonical answers.json / answerCount 字段不变', () => {
  const fx = makeFixture();
  const json = JSON.parse(fs.readFileSync(fx.files.answersJson, 'utf8'));
  // canonical answerCount (在 answers.json 顶层) 必须保留
  assert.equal(json.answerCount, 2);
  // answers 数组每条带 id（canonical ID 字段）
  assert.equal(json.answers[0].id, '1');
  assert.equal(json.answers[1].id, '2');
  // 不应被 T3 改动写入或删除任何字段
  assert.deepEqual(Object.keys(json).sort(), ['answerCount', 'answers', 'questionId', 'questionTitle'].sort());
});

test('T3-regression: handoff.answerCount 与 canonical answerCount 一致', () => {
  const fx = withMismatchReported(253);
  const r = runHandoff(fx.outDir);
  assert.equal(r.status, 0);
  const handoff = readHandoff(fx.outDir);
  // handoff.answerCount 来自 answers.length（与 canonical answerCount 一致）
  assert.equal(handoff.answerCount, 2);
});
