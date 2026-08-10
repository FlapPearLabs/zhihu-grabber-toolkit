// SPDX-License-Identifier: AGPL-3.0-only
/**
 * V2 Phase 3 — Question Metadata（Spec §17）对抗与合同测试。
 *
 * 覆盖（§17 Test Matrix + Phase 3 review P1-1/P1-3/P1-4/P2-1）：
 *   A. QUESTION ADDITIVE SCHEMA：question 对象 additive，V1 top-level 字段不变
 *   B. DESCRIPTION SOURCE：detail 来自现有 question info 请求（零新增请求）
 *   C. DESCRIPTION CANONICALITY：descriptionHtml 严格等于 source raw HTML；descriptionMarkdown 确定性
 *   D. DESCRIPTION SECURITY：Markdown 注入惰性、raw HTML 活性移除、heading scope 安全
 *   E. TOPICS：真实 topics 最小字段确定性提取；恶意 topic 文本惰性；id/name 严格 string
 *   F. V1/PHASE2 兼容：answers[].content / assets 不变；旧产物（无 question）可读
 *   G. REQUEST BUDGET：QUESTION_INCLUDE 含 detail,topics（复用现有请求，无新增网络面）
 *   H. DETERMINISM：同一输入 → 同一 question 对象 / descriptionMarkdown
 *   I. MISSING VS EMPTY（P1-1）：detail/topics 缺失 ≠ 明确空值
 *   J. IDENTITY GATE（P1-4）：server info.id 与 canonical qid 冲突 → 稳定错误
 *   K. RESUME PRESERVATION（P1-3）：metadata 临时失败不得抹掉已有合法 question
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  grabAll, buildQuestionMetadata, extractTopics,
  loadExistingQuestion, QuestionMetadataIdentityError,
} from '../src/grabber.js';
import { buildQuestionInfoUrl } from '../src/http.js';
import { richHtmlToMarkdown } from '../src/rich-renderer.js';

const TEST_CONFIG = {
  cookies: { z_c0: 'zc-test', d_c0: 'dc-test' },
  userAgent: 'UA-TEST',
  zse93: '101_3_3.0',
};

// synthetic fixture based on observed real schema（2026-08-10 schema discovery：
// detail=string HTML、topics=array of {id,type,url,name,avatar_url,topic_type}）。
// 不是 verbatim 真实 API 样本——description 为最小合成样例，避免复制真实长正文。
const SCHEMA_SHAPED_QUESTION_INFO = {
  id: '477427067',
  title: '宜搭和简道云、氚云比起来有什么优劣之处？',
  detail: '<p>这是问题描述正文，包含<b>加粗</b>与<a href="https://example.com/foo">链接</a>。</p>',
  answer_count: 17,
  topics: [
    { id: '19550163', type: 'topic', url: 'https://www.zhihu.com/topic/19550163', name: 'ERP', avatar_url: 'https://pic1.zhimg.com/v2-x.png', topic_type: 'topic' },
    { id: '19550458', type: 'topic', url: 'https://www.zhihu.com/topic/19550458', name: '信息化', avatar_url: 'https://pic1.zhimg.com/v2-y.png', topic_type: 'topic' },
    { id: '19734444', type: 'topic', url: 'https://www.zhihu.com/topic/19734444', name: 'aPaaS', avatar_url: '', topic_type: 'topic' },
  ],
};

/** 模拟 requestJson 的 fetch：区分问题信息 URL 与回答分页 URL */
function stubFetch(answersBody, questionInfoBody = { title: '测试问题', answer_count: 0 }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/answers?') ? answersBody : questionInfoBody;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return () => { globalThis.fetch = original; };
}

// ===== A. QUESTION ADDITIVE SCHEMA =====

test('P3-A1: grabAll 成功时写入 additive question 对象，top-level V1 字段不变', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-additive-'));
  const outDir = path.join(dir, 'out');
  const body = {
    data: [{ id: '1', content: '<p>回答</p>', author: 'A', voteup_count: 1, comment_count: 0 }],
    paging: { is_end: true },
  };
  const restore = stubFetch(body, SCHEMA_SHAPED_QUESTION_INFO);
  try {
    const result = await grabAll(TEST_CONFIG, '477427067', { outDir });
    // V1 top-level 字段语义不变
    assert.equal(result.questionId, '477427067');
    assert.equal(result.questionTitle, SCHEMA_SHAPED_QUESTION_INFO.title);
    assert.equal(result.answerCount, 17);
    assert.equal(result.url, 'https://www.zhihu.com/question/477427067');
    // additive question 对象
    assert.ok(result.question, 'question 对象存在');
    assert.equal(result.question.id, '477427067', 'question.id 与 canonical questionId 一致');
    assert.equal(result.question.title, SCHEMA_SHAPED_QUESTION_INFO.title, 'question.title 与 canonical questionTitle 一致');
    assert.equal(result.question.descriptionHtml, SCHEMA_SHAPED_QUESTION_INFO.detail, 'descriptionHtml 严格保留 server raw HTML');
    assert.ok(typeof result.question.descriptionMarkdown === 'string');
    assert.deepEqual(result.question.topics, [
      { id: '19550163', name: 'ERP' },
      { id: '19550458', name: '信息化' },
      { id: '19734444', name: 'aPaaS' },
    ], 'topics 只保留 {id, name} 最小字段（真实 schema evidence）');
    // 磁盘 snapshot 同样包含 question 且 content 不变
    const disk = JSON.parse(fs.readFileSync(path.join(outDir, '477427067', 'answers.json'), 'utf8'));
    assert.deepEqual(disk.question, result.question);
    assert.equal(disk.answers[0].content, '<p>回答</p>');
  } finally {
    restore();
  }
});

test('P3-A2: 旧 V1 产物（无 question 字段）仍可被读取并续传，不报错', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-oldv1-'));
  const outDir = path.join(dir, 'out');
  const qdir = path.join(outDir, '123');
  fs.mkdirSync(qdir, { recursive: true });
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
  const restore = stubFetch(body, { title: '新', answer_count: 2 });
  try {
    const result = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(result.answers.length, 2);
    assert.equal(result.answers[0].content, '<p>old</p>', '旧回答 content 不被改写');
    assert.ok(result.question, '续传成功后 question 对象被补全');
    assert.equal(result.question.id, '123');
  } finally {
    restore();
  }
});

test('P3-A3: question info 请求失败 → question 对象缺省（fresh，无已有产物），core 抓取继续（Spec §20.2）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-metafail-'));
  const outDir = path.join(dir, 'out');
  const body = {
    data: [{ id: '1', content: '<p>x</p>' }],
    paging: { is_end: true },
  };
  // 问题信息 URL 返回 500（模拟 metadata 临时失败）
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/answers?')) {
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };
  try {
    const events = [];
    const result = await grabAll(TEST_CONFIG, '123', { outDir, onProgress: (p) => events.push(p) });
    assert.ok(events.some((e) => e.event === 'metadata_failed'), 'metadata 失败事件触发');
    assert.equal(result.answers.length, 1, 'core 抓取不因 metadata 失败而中断');
    assert.equal(result.questionId, '123');
    assert.ok(!('question' in result), 'fresh 无已有产物时 question 缺省（不伪造空事实）');
  } finally {
    globalThis.fetch = original;
  }
});

// ===== B. DESCRIPTION SOURCE =====

test('P3-B1: description 复用现有 question info 请求（include 含 detail/topics，零新增请求）', () => {
  const u = new URL(buildQuestionInfoUrl('123'));
  const include = u.searchParams.get('include');
  assert.ok(include.includes('detail'), 'include 包含 detail');
  assert.ok(include.includes('topics'), 'include 包含 topics');
  assert.ok(include.includes('title'), 'include 保留 title');
  assert.ok(include.includes('answer_count'), 'include 保留 answer_count');
  // detail/topics 必须位于 include 前部（真实 discovery：放末尾会被服务端丢弃）
  const detailIdx = include.indexOf('detail');
  const answerCountIdx = include.indexOf('answer_count');
  assert.ok(detailIdx >= 0 && detailIdx < answerCountIdx, 'detail 位于 answer_count 之前');
});

test('P3-B2: server 明确返回 detail="" → 明确空描述（descriptionHtml="" 且 descriptionMarkdown=""）', () => {
  const q = buildQuestionMetadata('123', { title: 'T', answer_count: 0, detail: '', topics: [] }, 'T');
  assert.equal(q.descriptionHtml, '');
  assert.equal(q.descriptionMarkdown, '');
  assert.ok('descriptionHtml' in q && 'descriptionMarkdown' in q, '明确空值是合法持久化形态');
});

// ===== I. MISSING VS EMPTY（P1-1）=====

test('P3-I1: detail 缺失 → 不写 descriptionHtml/descriptionMarkdown（缺省，不伪造 ""）', () => {
  const q = buildQuestionMetadata('123', { title: 'T', answer_count: 0, topics: [] }, 'T');
  assert.ok(!('descriptionHtml' in q), 'detail 缺失时不得合成 descriptionHtml=""');
  assert.ok(!('descriptionMarkdown' in q), 'detail 缺失时不得合成 descriptionMarkdown=""');
});

test('P3-I2: detail 非 string（如 number/object）→ 视为缺失，不写 description 字段', () => {
  assert.ok(!('descriptionHtml' in buildQuestionMetadata('1', { detail: 123 }, '')));
  assert.ok(!('descriptionHtml' in buildQuestionMetadata('1', { detail: { x: 1 } }, '')));
  assert.ok(!('descriptionHtml' in buildQuestionMetadata('1', { detail: null }, '')));
  assert.ok(!('descriptionHtml' in buildQuestionMetadata('1', {}, '')));
});

test('P3-I3: topics 明确返回 [] → 持久化 topics=[]（服务器明确 0 个话题）', () => {
  const q = buildQuestionMetadata('1', { title: 'T', detail: '', topics: [] }, 'T');
  assert.ok('topics' in q, '明确空数组必须持久化');
  assert.deepEqual(q.topics, []);
});

test('P3-I4: topics 缺失/非数组 → 不写 question.topics（缺省，不伪造 []）', () => {
  assert.ok(!('topics' in buildQuestionMetadata('1', { title: 'T' }, 'T')));
  assert.ok(!('topics' in buildQuestionMetadata('1', { title: 'T', topics: null }, 'T')));
  assert.ok(!('topics' in buildQuestionMetadata('1', { title: 'T', topics: 'nope' }, 'T')));
  assert.ok(!('topics' in buildQuestionMetadata('1', { title: 'T', topics: {} }, 'T')));
});

// ===== J. IDENTITY GATE（P1-4）=====

test('P3-J1: server info.id 与 canonical qid 不一致 → QuestionMetadataIdentityError（不被 metadata_failed 吞掉）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-identity-'));
  const outDir = path.join(dir, 'out');
  const body = {
    data: [{ id: '1', content: '<p>x</p>' }],
    paging: { is_end: true },
  };
  // question info 返回 id=999，但请求 qid=123 → 身份冲突
  const restore = stubFetch(body, { id: '999', title: 'T', answer_count: 0 });
  try {
    await assert.rejects(
      grabAll(TEST_CONFIG, '123', { outDir }),
      (error) => {
        assert.ok(error instanceof QuestionMetadataIdentityError, '必须是稳定身份冲突错误');
        assert.equal(error.name, 'QuestionMetadataIdentityError');
        assert.equal(error.errorType, 'question_metadata_identity_conflict');
        assert.match(error.message, /QUESTION_METADATA_IDENTITY_CONFLICT/);
        return true;
      },
    );
    // 不得写出产物（core 未完成）
    assert.ok(!fs.existsSync(path.join(outDir, '123', 'answers.json')), '身份冲突时不得写入 answers.json');
  } finally {
    restore();
  }
});

test('P3-J2: info.id 缺失/非数字串 → 不触发 identity gate（仅当 id 存在且不一致才冲突）', () => {
  // buildQuestionMetadata 层不负责 gate；grabAll 层对缺失 id 不抛错
  const q = buildQuestionMetadata('123', { title: 'T' }, 'T');
  assert.equal(q.id, '123');
});

test('P3-J3: question.title 与 canonical questionTitle 单一归一化来源（同一值）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-title-'));
  const outDir = path.join(dir, 'out');
  const body = { data: [], paging: { is_end: true } };
  // title 为 number → 单一归一化：顶层与 question.title 都取 ''（不做 || 强转）
  const restore = stubFetch(body, { id: '123', title: 123, answer_count: 0 });
  try {
    const result = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(result.questionTitle, '');
    assert.equal(result.question.title, '');
    assert.ok(result.questionTitle === result.question.title, '两者必须同源');
  } finally {
    restore();
  }
});

// ===== K. RESUME PRESERVATION（P1-3 / re-review P1-1）=====

test('P3-K1: resume 时 fresh metadata 失败 → 保留兼容 question + canonical questionTitle（不变量成立）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-resume-preserve-'));
  const outDir = path.join(dir, 'out');
  const qdir = path.join(outDir, '123');
  fs.mkdirSync(qdir, { recursive: true });
  // 模拟 Phase 3 已成功产物：已有 question + 1 条回答 + progress 未完成
  const previousQuestion = {
    id: '123',
    title: '旧标题',
    descriptionHtml: '<p>旧描述</p>',
    descriptionMarkdown: '旧描述',
    topics: [{ id: '1', name: '旧话题' }],
  };
  fs.writeFileSync(path.join(qdir, 'answers.json'), JSON.stringify({
    questionId: '123',
    questionTitle: '旧标题',
    answerCount: 2,
    url: 'https://www.zhihu.com/question/123',
    question: previousQuestion,
    answers: [{ id: '1', author: 'A', content: '<p>old</p>' }],
  }));
  fs.writeFileSync(path.join(qdir, '.progress.json'), JSON.stringify({ offset: 1, done: false }));
  // fresh question info 请求失败（500），下一页回答成功
  const body = {
    data: [{ id: '2', content: '<p>new</p>' }],
    paging: { is_end: true },
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/answers?')) {
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };
  try {
    const events = [];
    const result = await grabAll(TEST_CONFIG, '123', { outDir, onProgress: (p) => events.push(p) });
    assert.ok(events.some((e) => e.event === 'metadata_failed'), 'metadata 失败事件触发');
    assert.equal(result.answers.length, 2, 'core 抓取继续');
    assert.deepEqual(result.question, previousQuestion, '已有兼容 question 必须被保留（deepEqual）');
    assert.equal(result.questionTitle, '旧标题', 'canonical questionTitle 同时保留');
    assert.equal(result.question.title, result.questionTitle, 'question.title === canonical questionTitle（不变量）');
    // 磁盘 snapshot 同样保留
    const disk = JSON.parse(fs.readFileSync(path.join(qdir, 'answers.json'), 'utf8'));
    assert.deepEqual(disk.question, previousQuestion, '磁盘产物不得抹掉已有 question');
    assert.equal(disk.questionTitle, '旧标题');
    assert.equal(disk.question.title, disk.questionTitle);
  } finally {
    globalThis.fetch = original;
  }
});

test('P3-K2: fresh capture（无已有 question）+ metadata 失败 → question 缺省（不伪造）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-fresh-meta-fail-'));
  const outDir = path.join(dir, 'out');
  const body = { data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/answers?')) {
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(result.answers.length, 1);
    assert.ok(!('question' in result), 'fresh 无已有 question 时 question 缺省');
  } finally {
    globalThis.fetch = original;
  }
});

test('P3-K3: loadExistingQuestion 兼容性校验（re-review P1-1 逐项）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-leq-'));
  const file = path.join(dir, 'answers.json');
  assert.equal(loadExistingQuestion(file, '1'), null, '文件不存在 → null');

  // 完全兼容 → 返回 { question, questionTitle }
  fs.writeFileSync(file, JSON.stringify({
    questionId: '1', questionTitle: 'T',
    question: { id: '1', title: 'T', descriptionHtml: '', descriptionMarkdown: '', topics: [] },
  }));
  assert.deepEqual(loadExistingQuestion(file, '1'), {
    question: { id: '1', title: 'T', descriptionHtml: '', descriptionMarkdown: '', topics: [] },
    questionTitle: 'T',
  });

  // 无 question 字段
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', answers: [] }));
  assert.equal(loadExistingQuestion(file, '1'), null, '无 question 字段 → null');

  // question 非 object
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', question: 'not-an-object' }));
  assert.equal(loadExistingQuestion(file, '1'), null, 'question 非 object → null');

  // A. question.id != 当前 qid → 不保留（不允许绕过 identity gate）
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', questionTitle: 'T', question: { id: '999', title: 'T' } }));
  assert.equal(loadExistingQuestion(file, '1'), null, 'question.id 与 qid 不一致 → null');
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', questionTitle: 'T', question: { id: '1', title: 'T' } }));
  assert.equal(loadExistingQuestion(file, '2'), null, 'artifact.questionId 与当前 qid 不一致 → null');

  // B. question.title != artifact.questionTitle → 不保留
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', questionTitle: 'TT', question: { id: '1', title: 'T' } }));
  assert.equal(loadExistingQuestion(file, '1'), null, 'question.title !== questionTitle → null');

  // D. malformed optional shape → 不视为合法
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', questionTitle: 'T', question: { id: '1', title: 'T', descriptionHtml: 42 } }));
  assert.equal(loadExistingQuestion(file, '1'), null, 'descriptionHtml 非 string → null');
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', questionTitle: 'T', question: { id: '1', title: 'T', descriptionMarkdown: {} } }));
  assert.equal(loadExistingQuestion(file, '1'), null, 'descriptionMarkdown 非 string → null');
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', questionTitle: 'T', question: { id: '1', title: 'T', topics: 'nope' } }));
  assert.equal(loadExistingQuestion(file, '1'), null, 'topics 非 array → null');
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', questionTitle: 'T', question: { id: '1', title: 'T', topics: [{ id: 5, name: 'x' }] } }));
  assert.equal(loadExistingQuestion(file, '1'), null, 'topics item id 非 string → null');
  fs.writeFileSync(file, JSON.stringify({ questionId: '1', questionTitle: 'T', question: { id: '1', title: 'T', topics: [{ id: '1', name: 5 }] } }));
  assert.equal(loadExistingQuestion(file, '1'), null, 'topics item name 非 string → null');

  // 损坏文件 → null（不抛错）
  fs.writeFileSync(file, 'corrupt{{{');
  assert.equal(loadExistingQuestion(file, '1'), null, '损坏文件 → null（不抛错）');
});

test('P3-K4: resume 保留不兼容 question 的回归（re-review P1-1 A/B）', async () => {
  for (const bad of [
    // A. question.id != qid → 不保留
    { questionId: '123', questionTitle: 'T', question: { id: '999', title: 'T' }, label: 'id mismatch' },
    // B. question.title != questionTitle → 不保留
    { questionId: '123', questionTitle: 'TT', question: { id: '123', title: 'T' }, label: 'title mismatch' },
    // D. malformed topics shape → 不保留
    { questionId: '123', questionTitle: 'T', question: { id: '123', title: 'T', topics: [{ id: 5, name: 'x' }] }, label: 'malformed topics' },
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-resume-bad-'));
    const outDir = path.join(dir, 'out');
    const qdir = path.join(outDir, '123');
    fs.mkdirSync(qdir, { recursive: true });
    fs.writeFileSync(path.join(qdir, 'answers.json'), JSON.stringify({
      ...bad, url: 'https://www.zhihu.com/question/123',
      answers: [{ id: '1', author: 'A', content: '<p>old</p>' }],
    }));
    fs.writeFileSync(path.join(qdir, '.progress.json'), JSON.stringify({ offset: 1, done: false }));
    const body = { data: [{ id: '2', content: '<p>new</p>' }], paging: { is_end: true } };
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/answers?')) {
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
    };
    try {
      const result = await grabAll(TEST_CONFIG, '123', { outDir });
      assert.ok(!('question' in result), `[${bad.label}] 不兼容 question 不得保留`);
      const disk = JSON.parse(fs.readFileSync(path.join(qdir, 'answers.json'), 'utf8'));
      assert.ok(!('question' in disk), `[${bad.label}] 磁盘产物不得含不兼容 question`);
    } finally {
      globalThis.fetch = original;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('P3-K5: resume 兼容 question 保留后 canonical title 不变量（re-review P1-1 C）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-resume-ok-'));
  const outDir = path.join(dir, 'out');
  const qdir = path.join(outDir, '123');
  fs.mkdirSync(qdir, { recursive: true });
  fs.writeFileSync(path.join(qdir, 'answers.json'), JSON.stringify({
    questionId: '123', questionTitle: '兼容标题', url: 'https://www.zhihu.com/question/123',
    question: { id: '123', title: '兼容标题', descriptionHtml: '', descriptionMarkdown: '', topics: [] },
    answers: [{ id: '1', author: 'A', content: '<p>old</p>' }],
  }));
  fs.writeFileSync(path.join(qdir, '.progress.json'), JSON.stringify({ offset: 1, done: false }));
  const body = { data: [{ id: '2', content: '<p>new</p>' }], paging: { is_end: true } };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/answers?')) {
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(result.questionTitle, '兼容标题', 'canonical questionTitle 保留');
    assert.equal(result.question.title, result.questionTitle, 'question.title === questionTitle');
    assert.equal(result.question.id, '123');
  } finally {
    globalThis.fetch = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===== C. DESCRIPTION CANONICALITY =====

test('P3-C1: descriptionHtml 严格等于 source raw HTML（不 trim / 不重排 / 不 sanitize 回写）', () => {
  const raw = '  <p>  <b>带空格</b>  原始  </p>  ';
  const q = buildQuestionMetadata('1', { detail: raw }, 'T');
  assert.equal(q.descriptionHtml, raw, 'descriptionHtml 必须原样保留 server raw value');
});

test('P3-C2: descriptionMarkdown 确定性（同一 HTML → 同一输出；两次调用 deepEqual）', () => {
  const q1 = buildQuestionMetadata('1', SCHEMA_SHAPED_QUESTION_INFO, SCHEMA_SHAPED_QUESTION_INFO.title);
  const q2 = buildQuestionMetadata('1', SCHEMA_SHAPED_QUESTION_INFO, SCHEMA_SHAPED_QUESTION_INFO.title);
  assert.equal(q1.descriptionMarkdown, q2.descriptionMarkdown);
  assert.ok(q1.descriptionMarkdown.length > 0);
  // 与 richHtmlToMarkdown 直接调用一致（同一 renderer，无第二套实现）
  assert.equal(q1.descriptionMarkdown, richHtmlToMarkdown(SCHEMA_SHAPED_QUESTION_INFO.detail, { headingOffset: 2 }));
});

test('P3-C3: 渲染不改变 descriptionHtml（canonical 不可变）', () => {
  const q = buildQuestionMetadata('1', SCHEMA_SHAPED_QUESTION_INFO, SCHEMA_SHAPED_QUESTION_INFO.title);
  const before = q.descriptionHtml;
  void q.descriptionMarkdown; // 渲染已发生
  assert.equal(q.descriptionHtml, before);
  assert.equal(q.descriptionHtml, SCHEMA_SHAPED_QUESTION_INFO.detail);
});

// ===== D. DESCRIPTION SECURITY =====

test('P3-D1: description 中 Markdown 注入（link/image/heading/quote/list/autolink/裸URL）全部惰性', () => {
  const injection = [
    '<p>[click](https://evil.example)</p>',
    '<p>![img](https://evil.example/x.png)</p>',
    '<p>https://evil.example</p>',
    '<p>&lt;https://evil.example&gt;</p>',
    '<p># 伪标题</p>',
    '<p>&gt; 伪引用</p>',
    '<p>- 伪列表</p>',
  ].join('');
  const md = richHtmlToMarkdown(injection, { headingOffset: 2 });
  // 不可信 text 自身不得产生 Markdown 结构语义：转义后不会成为真实 heading/link/image/quote/list
  assert.ok(!/^#\s/m.test(md), '不得产生顶层 heading');
  assert.ok(!/\n#\s/m.test(md), '不得在行首产生 heading');
  assert.ok(!md.includes('![img]'), '不得产生 image markdown');
  assert.ok(!/\[click\]\(/.test(md), '不得产生可点击伪造链接');
  // 惰性文本仍在（内容作为数据保留，control 字符被转义 → \[click\]）
  assert.ok(md.includes('[click]') || md.includes('\\[click\\]'), '内容保留（转义后的惰性文本）');
});

test('P3-D2: description 中 raw HTML 活性行为移除（script/style/form/input/iframe/event handler）', () => {
  const hostile = '<script>alert(1)</script><p onclick="evil()">正文 <iframe src="https://evil.example"></iframe></p><style>.x{}</style><form><input value="x"></form>';
  const md = richHtmlToMarkdown(hostile, { headingOffset: 2 });
  assert.ok(!md.includes('<script>'), 'script 剥离');
  assert.ok(!md.includes('<iframe'), 'iframe 剥离');
  assert.ok(!md.includes('<form>'), 'form 剥离');
  assert.ok(!md.includes('<input'), 'input 剥离');
  assert.ok(!md.includes('<style>'), 'style 剥离');
  assert.ok(!md.includes('onclick'), 'event handler 剥离');
  assert.ok(md.includes('正文'), '可见文本保留');
});

test('P3-D3: description 内 heading 不越界（headingOffset=2 → h1 降级 H3，低于 ## N. framing）', () => {
  const html = '<h1>大标题</h1><h2>中标题</h2><p>正文</p>';
  const md = richHtmlToMarkdown(html, { headingOffset: 2 });
  assert.ok(md.includes('### 大标题'), 'source h1 → H3');
  assert.ok(md.includes('#### 中标题'), 'source h2 → H4');
  assert.ok(!/^# [^#]/.test(md), '不得产生 # 顶层标题（与问题标题同级）');
  assert.ok(!/^## [^#]/.test(md), '不得产生 ## N. 回答 framing 同级标题');
});

test('P3-D4: description 中 javascript:/data: 链接不可点击（URL sanitizer 复用）', () => {
  const html = '<p>链接 <a href="javascript:alert(1)">x</a> 与 <a href="data:text/html,evil">y</a></p>';
  const md = richHtmlToMarkdown(html, { headingOffset: 2 });
  assert.ok(!md.includes('javascript:alert'), 'javascript: 不出现在 href');
  assert.ok(!md.includes('data:text/html'), 'data: 不出现在 href');
  assert.ok(md.includes('x') && md.includes('y'), '锚文本保留');
});

// ===== E. TOPICS =====

test('P3-E1: extractTopics 确定性提取最小字段；id/name 严格 string（P2-1，拒绝 String() 强转任意对象）', () => {
  const raw = [
    { id: '1', type: 'topic', url: 'https://x', name: 'A', avatar_url: 'https://img', topic_type: 'topic' },
    { id: '2', name: 'B' },
    { id: null, name: 'C' },
    { name: 'D' },
    { id: '5', name: 123 },
    { id: {}, name: 'E' },          // id 非 string → 跳过（不得变成 "[object Object]"）
    { id: 42, name: 'F' },          // id 为 number → 跳过（observed schema 是 string）
    'not-an-object',
    null,
  ];
  const topics = extractTopics(raw);
  assert.deepEqual(topics, [
    { id: '1', name: 'A' },
    { id: '2', name: 'B' },
  ], '只保留 id/name 均为 string 的 item，丢弃多余字段与类型不合法项');
});

test('P3-E2: extractTopics 仅接受数组输入（缺失/类型不对由 buildQuestionMetadata 缺省，见 P3-I4）', () => {
  assert.deepEqual(extractTopics([]), []);
  assert.deepEqual(extractTopics(undefined), []);
  assert.deepEqual(extractTopics(null), []);
  assert.deepEqual(extractTopics('nope'), []);
  assert.deepEqual(extractTopics({}), []);
});

test('P3-E3: 恶意 topic 文本只作为数据保存，不产生 Markdown 结构', () => {
  const q = buildQuestionMetadata('1', {
    detail: '',
    topics: [
      { id: '1', name: '# 伪标题 [x](https://evil.example) ![img](https://evil.example/i.png) > quote - list' },
      { id: '2', name: '<script>alert(1)</script>' },
    ],
  }, 'T');
  // topics 作为 canonical 数据原样保存（name 是 untrusted data，不是渲染产物）
  assert.equal(q.topics[0].name, '# 伪标题 [x](https://evil.example) ![img](https://evil.example/i.png) > quote - list');
  assert.equal(q.topics[1].name, '<script>alert(1)</script>');
  // 若未来进入 Markdown 展示面，必须经过 escapeUntrustedMarkdownText —— 由调用方负责；
  // 本测试断言 canonical 层只保存数据、不自行生成结构（§11 topics contract）
});

// ===== F. V1 / PHASE2 COMPATIBILITY =====

test('P3-F1: grabAll 输出 answers[].content 与 assets 语义不变（canonical immutability）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-compat-'));
  const outDir = path.join(dir, 'out');
  const content = '<p>正文 <img src="https://picx.zhimg.com/a.png"></p>';
  const body = {
    data: [{ id: '1', content, author: 'A', voteup_count: 1, comment_count: 0 }],
    paging: { is_end: true },
  };
  const restore = stubFetch(body, SCHEMA_SHAPED_QUESTION_INFO);
  try {
    const result = await grabAll(TEST_CONFIG, '477427067', { outDir });
    const a = result.answers[0];
    assert.equal(a.content, content, 'content 原样保留');
    assert.ok(a.assets, 'assets 存在');
    assert.equal(a.assets.images.length, 1);
    assert.deepEqual(Object.keys(a).sort(), ['assets', 'author', 'commentCount', 'content', 'createdTime', 'excerpt', 'id', 'updatedTime', 'url', 'voteupCount'].sort());
  } finally {
    restore();
  }
});

// ===== G. REQUEST BUDGET =====

test('P3-G1: 每次抓取只发 1 次 question info 请求（零新增 metadata 请求）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-budget-'));
  const outDir = path.join(dir, 'out');
  const body = {
    data: [{ id: '1', content: '<p>x</p>' }],
    paging: { is_end: true },
  };
  let questionInfoRequests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('/answers?')) questionInfoRequests += 1;
    const b = u.includes('/answers?') ? body : SCHEMA_SHAPED_QUESTION_INFO;
    return new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await grabAll(TEST_CONFIG, '477427067', { outDir });
    assert.equal(questionInfoRequests, 1, 'question info 请求恰 1 次（与 V1 相同，description 复用）');
  } finally {
    globalThis.fetch = original;
  }
});

// ===== H. DETERMINISM =====

test('P3-H1: 同一 source input → 同一 question 对象（deepEqual）', () => {
  const a = buildQuestionMetadata('477427067', SCHEMA_SHAPED_QUESTION_INFO, SCHEMA_SHAPED_QUESTION_INFO.title);
  const b = buildQuestionMetadata('477427067', SCHEMA_SHAPED_QUESTION_INFO, SCHEMA_SHAPED_QUESTION_INFO.title);
  assert.deepEqual(a, b);
});

// ===== F2. 端到端兼容：新产物过 verify-output + make-handoff；旧产物无 question 仍 valid =====

import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const VERIFY_SCRIPT = fileURLToPath(new URL('../scripts/verify-output.mjs', import.meta.url));
const HANDOFF_SCRIPT = fileURLToPath(new URL('../scripts/make-handoff.mjs', import.meta.url));

/** 构造完整产物（answers.json + answers.md + .progress.json） */
function writeArtifact(dir, json, mdLines) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(json, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'answers.md'), mdLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(dir, '.progress.json'), JSON.stringify({ offset: 999, done: true }), 'utf8');
}

const MD_LINES = [
  '# 问题标题',
  '',
  '> 问题链接: [知乎问题](https://www.zhihu.com/question/123)',
  '> 抓取时间: 2026-08-10T00:00:00.000Z',
  '> 问题回答总数: 1，本次抓取到: 共 1 条回答',
  '',
  '---',
  '',
  '## 1. 作者 — 1 赞 · 0 评论',
  '',
  '- 链接: [知乎回答](https://www.zhihu.com/question/123/answer/1)',
  '- 创建时间: (未知)',
  '',
  '回答正文',
  '',
  '---',
  '',
];

test('P3-F2: 新产物（question present）过 verify-output valid + make-handoff verified（additive 不影响 14 项校验）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-verify-new-'));
  const dir = path.join(base, '123'); // verify-output 三方一致：目录名必须等于 questionId
  const json = {
    questionId: '123',
    questionTitle: '问题标题',
    answerCount: 1,
    url: 'https://www.zhihu.com/question/123',
    fetchedAt: '2026-08-10T00:00:00.000Z',
    question: {
      id: '123',
      title: '问题标题',
      descriptionHtml: '<p>描述</p>',
      descriptionMarkdown: '描述',
      topics: [{ id: '1', name: '话题' }],
    },
    answers: [{ id: '1', author: '作者', content: '<p>回答正文</p>', url: 'https://www.zhihu.com/question/123/answer/1' }],
  };
  writeArtifact(dir, json, MD_LINES);
  try {
    const v = JSON.parse(execFileSync(process.execPath, [VERIFY_SCRIPT, dir], { encoding: 'utf8' }));
    assert.equal(v.valid, true, '新产物 verify valid');
    execFileSync(process.execPath, [HANDOFF_SCRIPT, dir], { encoding: 'utf8' });
    const handoff = JSON.parse(fs.readFileSync(path.join(dir, 'handoff.json'), 'utf8'));
    assert.equal(handoff.verified, true, 'handoff verified=true');
    assert.equal(handoff.answerCount, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('P3-F3: 旧 V1 产物（无 question 字段）过 verify-output 仍 valid（additive 向后兼容）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-verify-old-'));
  const dir = path.join(base, '123'); // verify-output 三方一致：目录名必须等于 questionId
  const json = {
    questionId: '123',
    questionTitle: '问题标题',
    answerCount: 1,
    url: 'https://www.zhihu.com/question/123',
    fetchedAt: '2026-08-10T00:00:00.000Z',
    answers: [{ id: '1', author: '作者', content: '<p>回答正文</p>', url: 'https://www.zhihu.com/question/123/answer/1' }],
  };
  writeArtifact(dir, json, MD_LINES);
  try {
    const v = JSON.parse(execFileSync(process.execPath, [VERIFY_SCRIPT, dir], { encoding: 'utf8' }));
    assert.equal(v.valid, true, '旧产物（无 question）verify 仍 valid');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
