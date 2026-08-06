import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, renderAnswers } from '../src/render.js';

test('stripHtml 剥离标签并解码实体', () => {
  const html = '<p>Hello <b>Codex</b> &amp; friends</p><br/>line2';
  const text = stripHtml(html);
  assert.ok(!text.includes('<'), '不应残留标签');
  assert.ok(text.includes('Hello Codex &amp; friends'), '& 应保持编码态防重引入');
  assert.ok(text.includes('line2'));
});

test('renderAnswers 含题目信息且按赞数倒序', () => {
  const meta = { questionId: '123', questionTitle: '测试问题', answerCount: 2, url: 'https://www.zhihu.com/question/123' };
  const answers = [
    { id: 'a1', author: 'B', voteupCount: 5, commentCount: 1, content: '<p>low</p>' },
    { id: 'a2', author: 'A', voteupCount: 99, commentCount: 3, content: '<p>high</p>' },
  ];
  const md = renderAnswers(meta, answers);
  assert.ok(md.includes('测试问题'));
  assert.ok(md.includes('https://www.zhihu.com/question/123'));
  assert.ok(md.includes('共 2 条回答'));
  const highIdx = md.indexOf('high');
  const lowIdx = md.indexOf('low');
  assert.ok(highIdx !== -1 && lowIdx !== -1 && highIdx < lowIdx, '高赞回答应排在前面');
  assert.ok(!md.includes('<p>'), '正文不应含 HTML 标签');
});

test('stripHtml 不把编码标签恢复为原始 HTML（XSS 回归）', () => {
  const value = stripHtml('&lt;img src=x onerror="alert(1)"&gt;');
  assert.ok(!value.includes('<img'), '不应恢复出原始标签');
  assert.ok(value.includes('&lt;img'), '尖括号应保持编码态');
});

test('stripHtml 移除 script/style 完整内容', () => {
  const html = 'hello<script>alert(1)</script>world<style>body{display:none}</style>end';
  const text = stripHtml(html);
  assert.ok(!text.includes('alert'), 'script 内容应被整体移除');
  assert.ok(!text.includes('display:none'), 'style 内容应被整体移除');
  assert.ok(text.includes('hello'));
  assert.ok(text.includes('end'));
});

test('renderAnswers 标题中的 Markdown 特殊字符被转义', () => {
  const meta = { questionId: '123', questionTitle: '# 伪造标题\n---\n`代码`', answerCount: 0, url: 'https://www.zhihu.com/question/123' };
  const md = renderAnswers(meta, []);
  const titleLine = md.split('\n')[0];
  assert.ok(titleLine.startsWith('# \\# 伪造标题'), '题目标题中的井号应被转义，不破坏文档结构');
  assert.ok(!titleLine.includes('\n---'), '标题中的换行分隔符应被中和');
});
