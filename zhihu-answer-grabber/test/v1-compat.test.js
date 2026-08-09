// SPDX-License-Identifier: AGPL-3.0-only
/**
 * V2 Phase 2 — V1 兼容回归测试（S5）。
 *
 * 证明 additive assets（Spec §18）不破坏 V1 对外合同：
 *   1. 旧 V1 JSON（无 assets）→ render / verify / make-handoff 全 PASS；
 *   2. 含 assets 的产物 → verify 语义不变（仍 valid，新增字段不影响校验）；
 *   3. canonical immutability（RULES.md §3 / Spec §6.1）：content 原样保留；
 *   4. determinism（G9）：同一 HTML → deepEqual 相同 assets；
 *   5. CLI --json 机器契约无 drift（status 对含 assets 产物仍 valid）。
 *
 * 断言只依赖公开契约（产物文件、verify 结果、CLI JSON 字段），不依赖
 * renderer/输出内部结构细节（AGENTS.md §7 防脆弱）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAnswers } from '../src/render.js';
import { extractAssets } from '../src/asset-extractor.js';

const VERIFY_SCRIPT = fileURLToPath(new URL('../scripts/verify-output.mjs', import.meta.url));
const HANDOFF_SCRIPT = fileURLToPath(new URL('../scripts/make-handoff.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

/** 构造一个严格 V1 形态（无 assets 字段）的已验证产物 fixture */
function makeV1Fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-v1compat-'));
  const outDir = path.join(dir, 'out', '123');
  fs.mkdirSync(outDir, { recursive: true });
  const json = {
    questionId: '123',
    questionTitle: '测试',
    answerCount: 2,
    fetchedAt: '2026-01-01T00:00:00.000Z', // 固定时间戳：render 确定性（G9）
    answers: [
      { id: '1', author: 'A', content: '<p>第一条 <strong>粗</strong></p>', voteupCount: 2, commentCount: 1 },
      { id: '2', author: 'B', content: '<p>第二条</p>', voteupCount: 1, commentCount: 0 },
    ],
  };
  fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify(json));
  fs.writeFileSync(path.join(outDir, 'answers.md'), renderAnswers(json, json.answers));
  fs.writeFileSync(path.join(outDir, '.progress.json'), JSON.stringify({ offset: 40, done: true }));
  return { dir, outDir, json };
}

function runVerify(outDir) {
  return spawnSync(process.execPath, [VERIFY_SCRIPT, outDir], { encoding: 'utf8' });
}

function runHandoff(outDir) {
  return spawnSync(process.execPath, [HANDOFF_SCRIPT, outDir, '--task', 'digest'], { encoding: 'utf8' });
}

// ===== 1. 旧 V1 JSON（无 assets）向后兼容 =====

test('V1-COMPAT-1: 旧 V1 JSON（无 assets）render PASS，保持 V1 结构', () => {
  const { json } = makeV1Fixture();
  const md = renderAnswers(json, json.answers);
  assert.ok(md.includes('# 测试'));
  const headings = md.match(/^## \d+\./gm) || [];
  assert.equal(headings.length, 2, 'V1 framing 记录数不变');
  assert.ok(!md.includes('<p>'), '无 HTML 标签');
});

test('V1-COMPAT-2: 旧 V1 JSON（无 assets）verify PASS', () => {
  const { outDir } = makeV1Fixture();
  const r = runVerify(outDir);
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.answers, 2);
});

test('V1-COMPAT-3: 旧 V1 JSON（无 assets）make-handoff PASS', () => {
  const { outDir } = makeV1Fixture();
  const r = runHandoff(outDir);
  assert.equal(r.status, 0, r.stderr);
  const handoff = JSON.parse(fs.readFileSync(path.join(outDir, 'handoff.json'), 'utf8'));
  assert.equal(handoff.verified, true);
  assert.equal(handoff.answerCount, 2);
});

// ===== 2. assets present：verifier 语义不变 =====

test('V1-COMPAT-4: 含 assets 产物 verify 仍 valid（新增字段不影响 14 项校验）', () => {
  const { outDir, json } = makeV1Fixture();
  json.answers = json.answers.map((a) => ({ ...a, assets: extractAssets(a.content) }));
  fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify(json));
  const r = runVerify(outDir);
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.answers, 2);
  assert.equal(parsed.duplicates, 0);
});

test('V1-COMPAT-5: status --json 对含 assets 产物 → verificationStatus valid（CLI 无 drift）', () => {
  const { dir, outDir, json } = makeV1Fixture();
  json.answers = json.answers.map((a) => ({ ...a, assets: extractAssets(a.content) }));
  fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify(json));
  const r = spawnSync(process.execPath, [CLI, 'status', '--json', '--out-dir', path.join(dir, 'out')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: process.env.PATH },
    timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.command, 'status');
  const item = parsed.items.find((i) => i.questionId === '123');
  assert.ok(item, '应包含 123 的状态');
  assert.equal(item.captureStatus, 'captured');
  assert.equal(item.verificationStatus, 'valid');
});

// ===== 3. canonical immutability（RULES.md §3 / Spec §6.1） =====

test('V1-COMPAT-6: canonical immutability —— extractAssets 不修改 html 输入', () => {
  const html = '<p>a <img src="https://picx.zhimg.com/x.png"> <a href="https://github.com/foo">l</a></p>';
  const before = html.slice();
  extractAssets(html);
  assert.equal(html, before, '输入 HTML 字符串不得被修改');
});

test('V1-COMPAT-7: canonical immutability —— renderAnswers 不修改 answer.content', () => {
  const { json } = makeV1Fixture();
  const contentsBefore = json.answers.map((a) => a.content);
  renderAnswers(json, json.answers);
  json.answers.forEach((a, i) => {
    assert.equal(a.content, contentsBefore[i], `第 ${i} 条 content 必须原样保留`);
  });
});

// ===== 4. determinism（G9） =====

test('V1-COMPAT-8: determinism —— 同一 HTML → deepEqual 相同 assets', () => {
  const html = [
    '<p>x</p>',
    '<img src="https://picx.zhimg.com/1.png">',
    '<a href="https://github.com/a">l</a>',
    '<sup data-text="注" data-numero="1">[1]</sup>',
    '<pre><code class="language-js">a</code></pre>',
  ].join('');
  assert.deepEqual(extractAssets(html), extractAssets(html));
});

test('V1-COMPAT-9: determinism —— 同一 answers 两次 render 输出一致', () => {
  const { json } = makeV1Fixture();
  assert.equal(renderAnswers(json, json.answers), renderAnswers(json, json.answers));
});
