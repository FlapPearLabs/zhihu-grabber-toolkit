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

// ===== Fix 1：normalizeQuestionInput 完整 1-20 位静态校验 =====

test('Fix1: normalizeQuestionInput 拒绝 21 位纯数字', () => {
  assert.throws(() => normalizeQuestionInput('123456789012345678901'), /1-20 位数字/);
});

test('Fix1: normalizeQuestionInput 拒绝 21 位数字 URL', () => {
  assert.throws(() => normalizeQuestionInput('https://www.zhihu.com/question/123456789012345678901'), /1-20 位数字/);
});

test('Fix1: normalizeQuestionInput 接受合法 1-20 位 ID（原行为不回归）', () => {
  assert.equal(normalizeQuestionInput('2063557784394785882'), '2063557784394785882');
  assert.equal(normalizeQuestionInput('0'), '0');
  assert.equal(normalizeQuestionInput('12345678901234567890'), '12345678901234567890'); // 20 位边界
  assert.equal(normalizeQuestionInput('https://www.zhihu.com/question/2063557784394785882/answer/123'), '2063557784394785882');
});

// ===== Fix 2：空页假完成（fail closed） =====

const TEST_CONFIG = {
  cookies: { z_c0: 'zc-test', d_c0: 'dc-test' },
  userAgent: 'UA-TEST',
  zse93: '101_3_3.0',
};

/** 模拟 requestJson 的 fetch：区分问题信息 URL 与回答分页 URL */
function stubFetch(answersBody) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/answers?') ? answersBody : { title: '测试问题', answer_count: 0 };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return () => { globalThis.fetch = original; };
}

test('Fix2: data=[] + paging.is_end=false → 抓取失败，不得写 done=true', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-grab-empty-notend-'));
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const restore = stubFetch({ data: [], paging: { is_end: false } });
  try {
    await assert.rejects(
      grabAll(TEST_CONFIG, '123', { outDir }),
      /分页返回空数据，但服务端未声明 is_end=true/,
    );
    const progressFile = path.join(outDir, '123', '.progress.json');
    assert.ok(!fs.existsSync(progressFile), '失败时不得写入 .progress.json');
    const answersFile = path.join(outDir, '123', 'answers.json');
    assert.ok(!fs.existsSync(answersFile), '失败时不得写入 answers.json');
  } finally {
    restore();
  }
});

test('Fix2: data=[] + paging.is_end=true → 可以正常结束（done=true）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-grab-empty-end-'));
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const restore = stubFetch({ data: [], paging: { is_end: true } });
  try {
    const result = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(result.answers.length, 0);
    const progress = JSON.parse(fs.readFileSync(path.join(outDir, '123', '.progress.json'), 'utf8'));
    assert.equal(progress.done, true, '服务端明确 is_end=true 时才允许 done=true');
  } finally {
    restore();
  }
});
