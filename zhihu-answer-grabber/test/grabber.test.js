import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeQuestionInput, ProgressStore, shouldContinue, loadExistingAnswers, grabAll } from '../src/grabber.js';
import { extractAssets } from '../src/asset-extractor.js';

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

// ===== S3: additive answers[].assets 集成（Spec §6.1 / §18） =====

test('S3: grabAll 为每条新回答写入 assets，content 原样不变（canonical immutability）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-grab-assets-'));
  const outDir = path.join(dir, 'out');
  const content = '<p>正文 <img src="https://picx.zhimg.com/a.png"> <a href="https://github.com/foo">链接</a></p>';
  const body = {
    data: [{ id: '1', content, author: 'A', voteup_count: 1, comment_count: 0 }],
    paging: { is_end: true },
  };
  const restore = stubFetch(body);
  try {
    const result = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(result.answers.length, 1);
    const a = result.answers[0];
    assert.equal(a.content, content, 'content 必须原样保留（canonical 不变）');
    assert.ok(a.assets, 'assets 字段存在');
    assert.equal(a.assets.images.length, 1);
    assert.equal(a.assets.links.length, 1);
    assert.ok(Array.isArray(a.assets.references));
    assert.ok(Array.isArray(a.assets.codeBlocks));
    assert.ok(Array.isArray(a.assets.videos));
    assert.equal(a.assets.images[0].clickable, true);
    assert.equal(a.assets.images[0].securityClass, 'zhimg_cdn');
    // 磁盘 snapshot 同样包含 assets 且 content 不变
    const disk = JSON.parse(fs.readFileSync(path.join(outDir, '123', 'answers.json'), 'utf8'));
    assert.equal(disk.answers[0].content, content);
    assert.deepEqual(disk.answers[0].assets, a.assets);
  } finally {
    restore();
  }
});

test('S3: assets additive —— 既有 V1 字段类型/语义完全不变', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-grab-additive-'));
  const outDir = path.join(dir, 'out');
  const body = {
    data: [{
      id: '42', content: '<p>x</p>', author: { name: '甲' },
      voteup_count: 7, comment_count: 2, created_time: 1000, updated_time: 2000, excerpt: '摘',
    }],
    paging: { is_end: true },
  };
  const restore = stubFetch(body);
  try {
    const result = await grabAll(TEST_CONFIG, '123', { outDir });
    const a = result.answers[0];
    assert.equal(a.id, '42');
    assert.equal(a.author, '甲');
    assert.equal(a.content, '<p>x</p>');
    assert.equal(a.excerpt, '摘');
    assert.equal(a.voteupCount, 7);
    assert.equal(a.commentCount, 2);
    assert.equal(a.createdTime, 1000);
    assert.equal(a.updatedTime, 2000);
    assert.deepEqual(
      Object.keys(a).sort(),
      ['assets', 'author', 'commentCount', 'content', 'createdTime', 'excerpt', 'id', 'updatedTime', 'url', 'voteupCount'].sort(),
      '仅新增 assets 一个字段',
    );
  } finally {
    restore();
  }
});

test('S3: 断点续传 —— 旧回答（无 assets）不被改写，新回答带 assets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-grab-resume-assets-'));
  const outDir = path.join(dir, 'out');
  const qdir = path.join(outDir, '123');
  fs.mkdirSync(qdir, { recursive: true });
  // 模拟 V1 旧产物：已有 1 条无 assets 回答 + progress offset=1
  fs.writeFileSync(path.join(qdir, 'answers.json'), JSON.stringify({
    questionId: '123',
    questionTitle: 'T',
    answerCount: 2,
    answers: [{ id: '1', author: '旧', content: '<p>old</p>' }],
  }));
  fs.writeFileSync(path.join(qdir, '.progress.json'), JSON.stringify({ offset: 1, done: false }));
  const body = {
    data: [{ id: '2', content: '<img src="https://picx.zhimg.com/b.png">' }],
    paging: { is_end: true },
  };
  const restore = stubFetch(body);
  try {
    const result = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(result.answers.length, 2);
    const old = result.answers.find((x) => x.id === '1');
    const fresh = result.answers.find((x) => x.id === '2');
    assert.equal(old.assets, undefined, '旧回答字段不被改写');
    assert.equal(old.content, '<p>old</p>');
    assert.ok(fresh.assets, '新回答带 assets');
    assert.equal(fresh.content, '<img src="https://picx.zhimg.com/b.png">');
    assert.equal(fresh.assets.images.length, 1);
  } finally {
    restore();
  }
});

test('S3: determinism —— 相同 content 两次抓取 → 相同 assets（G9）', async () => {
  const html = '<p>x</p><img src="https://picx.zhimg.com/1.png"><a href="https://github.com/a">l</a>';
  const first = extractAssets(html);
  const second = extractAssets(html);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});
