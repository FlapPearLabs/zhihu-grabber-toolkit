// SPDX-License-Identifier: AGPL-3.0-only
// F1 回归（VERIFIER_FALSE_POSITIVE_FENCED_CODE）：countMarkdownAnswerFrames
// fence-aware 答案帧计数单元测试。
//
// 真实 artifact 证据（1999136031413384196）：545 个 /^## \d+\./gm 匹配
//   = 538 真帧（1-538 连续）+ 7 fenced-code 假匹配（回答代码块内 markdown 文档
//   `## 0. 任务坐标` … `## 6. 是否进入修改计划`）。
// 修复后 fence 外计数必须精确等于真帧数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countMarkdownAnswerFrames } from '../src/verifier.js';

test('F1: 无 fence 普通帧计数不变', () => {
  const md = '## 1. A — 1 赞 · 0 评论\nx\n## 2. B — 2 赞 · 0 评论\ny\n';
  assert.equal(countMarkdownAnswerFrames(md), 2);
});

test('F1: fenced code 内 ## N. 不计入（最小合成 repro）', () => {
  // triage 最小 repro：1 answer + fenced `## 1.`/`## 2.` → 修复前 mdCount=3、valid=false
  const md = [
    '## 1. A — 1 赞 · 0 评论',
    '',
    '```markdown',
    '## 1. 标题一',
    '## 2. 标题二',
    '```',
    '',
  ].join('\n');
  assert.equal(countMarkdownAnswerFrames(md), 1, 'fence 内 ## 1./## 2. 不得计入');
});

test('F1: 带 lang fence open（``` js）内容不计入（triage 原正则缺陷回归）', () => {
  // renderer langPart 带前导空格（"``` js"）；FENCE_OPEN 必须支持该形态，
  // 否则 fence 失明 → 真帧被误分类（triage 脚本曾把 238 个真帧误判为 fence 内）
  const md = [
    '## 1. A — 1 赞 · 0 评论',
    '',
    '``` js',
    '## 1. inside',
    '```',
    '',
  ].join('\n');
  assert.equal(countMarkdownAnswerFrames(md), 1);
});

test('F1: fence open 行可带任意无 backtick info（如 ```python）', () => {
  const md = [
    '## 1. A — 1 赞 · 0 评论',
    '',
    '```python',
    '## 1. inside',
    '```',
    '',
  ].join('\n');
  assert.equal(countMarkdownAnswerFrames(md), 1);
});

test('F1: 多 fence 块各自开合', () => {
  const md = [
    '## 1. A — 1 赞 · 0 评论',
    '',
    '```',
    '## 1. in-block-1',
    '```',
    '',
    '## 2. B — 1 赞 · 0 评论',
    '',
    '```python',
    '## 3. in-block-2',
    '```',
    '',
  ].join('\n');
  assert.equal(countMarkdownAnswerFrames(md), 2);
});

test('F1: fence 内更短纯 backtick 行不闭合', () => {
  // open ```（3）；fence 内 "``"（2）纯行不满足 {3,}，保持 fence
  const md = [
    '## 1. A — 1 赞 · 0 评论',
    '',
    '```',
    '## 1. inside',
    '``',
    '## 2. still inside',
    '```',
    '',
  ].join('\n');
  assert.equal(countMarkdownAnswerFrames(md), 1);
});

test('F1: close 后恢复计数', () => {
  const md = [
    '```',
    '## 1. inside',
    '```',
    '',
    '## 1. after close — 1 赞 · 0 评论',
    '',
  ].join('\n');
  assert.equal(countMarkdownAnswerFrames(md), 1);
});

test('F1: 未闭合 fence（文档末尾仍 open）后续不计入', () => {
  const md = [
    '## 1. A — 1 赞 · 0 评论',
    '',
    '```',
    '## 1. inside',
    '## 2. inside',
    // 无 close
  ].join('\n');
  assert.equal(countMarkdownAnswerFrames(md), 1);
});

test('F1: CRLF 行尾不影响计数', () => {
  const md = '## 1. A — 1 赞 · 0 评论\r\n\r\n```\r\n## 1. inside\r\n```\r\n';
  assert.equal(countMarkdownAnswerFrames(md), 1);
});
