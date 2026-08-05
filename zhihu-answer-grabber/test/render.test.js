import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, renderAnswers } from '../src/render.js';

test('stripHtml 剥离标签并解码实体', () => {
  const html = '<p>Hello <b>Codex</b> &amp; friends</p><br/>line2';
  const text = stripHtml(html);
  assert.ok(!text.includes('<'), '不应残留标签');
  assert.ok(text.includes('Hello Codex & friends'));
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
