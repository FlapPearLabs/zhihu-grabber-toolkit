import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeQuestionInput, ProgressStore, shouldContinue, loadExistingAnswers, grabAll } from '../src/grabber.js';

test('normalizeQuestionInput 从链接提取 QID', () => {
  assert.equal(normalizeQuestionInput('https://www.zhihu.com/question/2063557784394785882/answer/123'), '2063557784394785882');
  assert.equal(normalizeQuestionInput('https://www.zhihu.com/question/2063557784394785882'), '2063557784394785882');
  assert.equal(normalizeQuestionInput('2063557784394785882'), '2063557784394785882');
});

test('normalizeQuestionInput 非法输入抛错', () => {
  assert.throws(() => normalizeQuestionInput('https://example.com/foo'), /无法识别/);
});

test('ProgressStore save/load 往返一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-progress-'));
  const store = new ProgressStore(dir, '123');
  store.save({ offset: 40, done: false });
  const loaded = store.load();
  assert.equal(loaded.offset, 40);
  assert.equal(loaded.done, false);
});

test('ProgressStore load 无状态时返回默认', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-progress-empty-'));
  const store = new ProgressStore(dir, '123');
  const loaded = store.load();
  assert.deepEqual(loaded, { offset: 0, done: false });
});

test('shouldContinue 依据 paging.is_end', () => {
  assert.equal(shouldContinue({ is_end: false }), true);
  assert.equal(shouldContinue({ is_end: true }), false);
});

test('loadExistingAnswers 兼容纯数组与带元信息对象', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-answers-'));
  const arrFile = path.join(dir, 'arr.json');
  const objFile = path.join(dir, 'obj.json');
  fs.writeFileSync(arrFile, JSON.stringify([{ id: '1' }]));
  fs.writeFileSync(objFile, JSON.stringify({ questionId: '123', answers: [{ id: '2' }] }));
  assert.deepEqual(loadExistingAnswers(arrFile), [{ id: '1' }]);
  assert.deepEqual(loadExistingAnswers(objFile), [{ id: '2' }]);
  assert.deepEqual(loadExistingAnswers(path.join(dir, 'missing.json')), []);
});

test('loadExistingAnswers 损坏文件抛错而非静默返回空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-answers-corrupt-'));
  const file = path.join(dir, 'answers.json');
  fs.writeFileSync(file, '{broken json!!');
  assert.throws(() => loadExistingAnswers(file), /损坏/);
});

test('grabAll 拒绝目录穿越 qid', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-grab-traversal-'));
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  await assert.rejects(grabAll({}, '../../etc/passwd', { outDir }), /非法问题 ID/);
  await assert.rejects(grabAll({}, '123;rm', { outDir }), /非法问题 ID/);
  assert.ok(!fs.existsSync(path.join(dir, 'etc')), '不应写出 outDir 之外');
});
