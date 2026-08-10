// SPDX-License-Identifier: AGPL-3.0-only
// V2 Phase 4 — Comments Enrichment focused tests（Spec §15/§18/§20.2.2/§21/§26）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCommentsUrl } from '../src/http.js';
import {
  grabAll,
  extractTopComments,
  isV1CompatibleComments,
  selectTopAnswers,
} from '../src/grabber.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, ...(opts.env || {}) },
    timeout: 30_000,
  });
}

/** 干净 config：requestJson 需要这些字段 */
const TEST_CONFIG = {
  cookies: { z_c0: 'z', d_c0: 'd', _xsrf: 'x' },
  userAgent: 'UA-TEST',
  zse93: '101_3_3.0',
};

/** mock fetch：按 URL 路由 question info / answers / comments */
function stubFetch({ info, answers, commentsByAnswer = {}, failCommentsFor = new Set(), attempts = {} }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    attempts[u] = (attempts[u] || 0) + 1;
    let body;
    if (u.includes('/api/v4/comment_v5/answers/')) {
      const m = u.match(/answers\/(\d+)\/root_comment/);
      const aid = m ? m[1] : '?';
      if (failCommentsFor.has(aid)) {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      body = commentsByAnswer[aid] ?? { data: [], paging: { totals: 0, is_end: true } };
    } else if (u.includes('/answers?')) {
      body = answers;
    } else {
      body = info;
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return () => { globalThis.fetch = original; };
}

function tmpOut() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-comments-'));
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  return { dir, outDir };
}

/** 构造 n 个 answers 的 canonical fixture（voteupCount 递减） */
function makeAnswers(n) {
  const answers = [];
  for (let i = 0; i < n; i += 1) {
    const id = String(1000 + i);
    answers.push({
      id,
      author: `author-${i}`,
      url: `https://www.zhihu.com/question/123/answer/${id}`,
      content: `<p>body-${i}</p>`,
      excerpt: `ex-${i}`,
      voteupCount: n - i, // DESC by construction
      commentCount: i % 2, // 混入 0 值（验证不跳过请求）
      createdTime: 1000 + i,
      updatedTime: 1000 + i,
      assets: { images: [], links: [], references: [], codeBlocks: [], videos: [] },
    });
  }
  return answers;
}

/** 预写已完成产物（含既有 comments），progress done=true → grabAll 跳过抓取、直接 enrichment */
function seedArtifact(outDir, qid, answers) {
  const dir = path.join(outDir, qid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify({
    questionId: qid,
    questionTitle: '测试问题',
    answerCount: answers.length,
    url: `https://www.zhihu.com/question/${qid}`,
    fetchedAt: new Date().toISOString(),
    answers,
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.progress.json'), JSON.stringify({ offset: answers.length, done: true }));
}

function readArtifact(outDir, qid) {
  return JSON.parse(fs.readFileSync(path.join(outDir, qid, 'answers.json'), 'utf8'));
}

const INFO = { id: '123', title: '测试问题', answer_count: 3, detail: '', topics: [] };

// ===== A. URL builder =====

test('A: buildCommentsUrl 精确端点/score/limit=3/offset=/无 status=open', () => {
  const url = new URL(buildCommentsUrl('1682718413'));
  assert.equal(url.origin + url.pathname, 'https://www.zhihu.com/api/v4/comment_v5/answers/1682718413/root_comment');
  assert.equal(url.searchParams.get('order_by'), 'score');
  assert.equal(url.searchParams.get('limit'), '3');
  assert.equal(url.searchParams.get('offset'), ''); // 空串（真实客户端形态）
  assert.ok(!url.searchParams.has('status'), '禁止 status=open');
  // 非法字符被 URL 编码（安全行为）
  assert.equal(buildCommentsUrl('a<b'), 'https://www.zhihu.com/api/v4/comment_v5/answers/a%3Cb/root_comment?order_by=score&limit=3&offset=');
});

// ===== B. selection =====

test('B: selectTopAnswers 按 voteupCount DESC + 稳定 tie + max 上限', () => {
  const answers = [
    { id: '1', voteupCount: 5 },
    { id: '2', voteupCount: 9 },
    { id: '3', voteupCount: 5 },
    { id: '4', voteupCount: 1 },
  ];
  const top = selectTopAnswers(answers, 3);
  assert.deepEqual(top.map((a) => a.id), ['2', '1', '3']); // DESC；同分保持原顺序
  assert.equal(selectTopAnswers(answers, 10).length, 4);
});

test('B: selection 使用 canonical voteupCount（非 voteup_count/commentCount）', () => {
  const answers = [
    { id: '1', voteupCount: 0, commentCount: 0 },
    { id: '2', voteupCount: 10, commentCount: 0 },
  ];
  const top = selectTopAnswers(answers, 10);
  assert.deepEqual(top.map((a) => a.id), ['2', '1']);
});

// ===== root item fixture（reply_root_comment_id 默认跟随 id） =====

function rootItem(over = {}) {
  const id = over.id ?? 'c1';
  return {
    id,
    type: 'comment',
    resource_type: 'answer',
    url: 'https://www.zhihu.com/api/v4/comment_v5/answers/1/root_comment/c1',
    content: '<p>hello</p>',
    reply_comment_id: '0',
    reply_root_comment_id: id,
    created_time: 1234567890,
    author: { name: 'user-x', id: 'u1' },
    like_count: 7,
    score: 0,
    child_comment_count: 1,
    child_comments: [{ id: 'r1', content: '<p>reply</p>', reply_comment_id: id, reply_root_comment_id: id }],
    ...over,
  };
}

// ===== D. parser =====

test('D: 合法 Top3 提取 — raw content 精确、Markdown 派生、optional 字段', () => {
  const resp = {
    data: [
      rootItem({ id: 'c1', content: '<p>a</p>', created_time: 10, author: { name: 'n1' } }),
      rootItem({ id: 'c2', content: '<p>b</p>', created_time: 20, author: { name: 'n2' } }),
      rootItem({ id: 'c3', content: '<p>c</p>', created_time: 30, author: { name: 'n3' } }),
    ],
    paging: { totals: 3, is_end: true },
  };
  const { comments, isExplicitZero } = extractTopComments(resp);
  assert.equal(isExplicitZero, false);
  assert.equal(comments.length, 3);
  assert.equal(comments[0].contentHtml, '<p>a</p>'); // raw 原样
  assert.equal(comments[0].contentMarkdown, 'a'); // 同一 renderer 派生
  assert.equal(comments[0].authorName, 'n1');
  assert.equal(comments[0].createdTime, 10);
  assert.ok(!('id' in comments[0]), 'comment id 不持久化');
  assert.ok(!('like_count' in comments[0]), 'like_count 不持久化');
  assert.ok(!('score' in comments[0]), 'score 不持久化');
});

test('D: 超过 3 条只取前 3；child_comments 完全忽略', () => {
  const resp = {
    data: [rootItem({ id: 'c1' }), rootItem({ id: 'c2' }), rootItem({ id: 'c3' }), rootItem({ id: 'c4' })],
    paging: { totals: 10, is_end: false },
  };
  const { comments } = extractTopComments(resp);
  assert.equal(comments.length, 3);
  assert.deepEqual(comments.map((c) => c.contentHtml), ['<p>hello</p>', '<p>hello</p>', '<p>hello</p>']);
});

test('D: optional authorName/createdTime 缺失/非法 → omit', () => {
  const resp = {
    data: [
      rootItem({ id: 'c1', author: {}, created_time: 'not-a-number' }),
      rootItem({ id: 'c2', author: { name: 42 }, created_time: null }),
    ],
    paging: { totals: 2, is_end: true },
  };
  const { comments } = extractTopComments(resp);
  assert.ok(!('authorName' in comments[0]));
  assert.ok(!('createdTime' in comments[0]));
  assert.equal(comments[1].contentHtml, '<p>hello</p>');
});

// ===== E. root failures =====

test('E: 任一 target item 违反 root predicate → 整个 answer failure（无补位）', () => {
  const bad = [
    rootItem({ id: 123 }), // id 非 string
    rootItem({ id: 'c1', reply_comment_id: 'r1' }), // != "0"
    rootItem({ id: 'c1', reply_root_comment_id: 'other' }), // != item.id
    rootItem({ id: 'c1', reply_root_comment_id: 99 }),
    rootItem({ id: 'c1', content: 123 }), // content 非 string
  ];
  for (const item of bad) {
    assert.throws(
      () => extractTopComments({ data: [rootItem({ id: 'ok1' }), item], paging: { totals: 2, is_end: true } }),
      /root\/content schema/,
      `应失败: ${JSON.stringify(item).slice(0, 90)}`,
    );
  }
});

// ===== F. zero semantics =====

test('F: explicit zero（data=[]+totals=0+is_end=true）→ []', () => {
  const { comments, isExplicitZero } = extractTopComments({ data: [], paging: { totals: 0, is_end: true } });
  assert.equal(isExplicitZero, true);
  assert.deepEqual(comments, []);
});

test('F: data=[] 但 totals>0 → failure（不伪造 []）', () => {
  assert.throws(() => extractTopComments({ data: [], paging: { totals: 5, is_end: false } }), /非 explicit zero/);
});

test('F: data 缺失/非数组/响应非对象 → failure', () => {
  assert.throws(() => extractTopComments(null), /不是对象/);
  assert.throws(() => extractTopComments({}), /data 不是数组/);
  assert.throws(() => extractTopComments({ data: 'x' }), /data 不是数组/);
});

// ===== v1-compatible validator =====

test('validator: v1-compatible 判定', () => {
  assert.equal(isV1CompatibleComments([]), true);
  assert.equal(isV1CompatibleComments([{ contentHtml: 'a', contentMarkdown: 'b' }]), true);
  assert.equal(isV1CompatibleComments([{ contentHtml: 'a', contentMarkdown: 'b', authorName: 'n', createdTime: 1 }]), true);
  assert.equal(isV1CompatibleComments([{ contentHtml: 'a', contentMarkdown: 'b', extraKey: true }]), true, '未知 keys 允许');
  assert.equal(isV1CompatibleComments({}), false);
  assert.equal(isV1CompatibleComments([{ contentHtml: 123, contentMarkdown: 'b' }]), false);
  assert.equal(isV1CompatibleComments([{ contentHtml: 'a' }]), false, 'contentMarkdown required');
  assert.equal(isV1CompatibleComments([{ contentHtml: 'a', contentMarkdown: 'b', authorName: 5 }]), false);
  assert.equal(isV1CompatibleComments([{ contentHtml: 'a', contentMarkdown: 'b', createdTime: 'x' }]), false);
  assert.equal(isV1CompatibleComments([{}, {}]), false);
  assert.equal(isV1CompatibleComments(Array(4).fill({ contentHtml: 'a', contentMarkdown: 'b' })), false, 'length>3 invalid');
});

// ===== C + G + I: grabAll 集成 =====

test('C/G-B: comments OFF → 0 comments 请求；既有任意 comments 原样保留（不 validate）', async () => {
  const { outDir } = tmpOut();
  const seeded = makeAnswers(2);
  seeded[1].comments = { legacy: true }; // 任意 incompatible 值
  seedArtifact(outDir, '123', seeded);
  const attempts = {};
  const restore = stubFetch({ info: INFO, attempts });
  try {
    await grabAll(TEST_CONFIG, '123', { outDir });
    const saved = readArtifact(outDir, '123');
    assert.equal(Object.keys(attempts).filter((u) => u.includes('comment_v5')).length, 0, 'OFF：无 comments 请求');
    assert.deepEqual(saved.answers[1].comments, { legacy: true }, '既有 incompatible 原样保留');
  } finally {
    restore();
  }
});

test('C/G-D: selected failure + v1-compatible 既有 → preserve；+ incompatible → omit', async () => {
  const { outDir } = tmpOut();
  const seeded = makeAnswers(3);
  seeded[0].comments = [{ contentHtml: '<p>ok</p>', contentMarkdown: 'ok' }]; // v1-compatible
  seeded[1].comments = { legacy: true }; // incompatible
  seedArtifact(outDir, '123', seeded);
  const events = [];
  const restore = stubFetch({
    info: INFO,
    failCommentsFor: new Set(['1000', '1001', '1002']),
  });
  try {
    await grabAll(TEST_CONFIG, '123', { outDir, comments: true, onProgress: (p) => events.push(p.event) });
    const saved = readArtifact(outDir, '123');
    assert.deepEqual(saved.answers[0].comments, [{ contentHtml: '<p>ok</p>', contentMarkdown: 'ok' }], 'v1-compatible → preserve');
    assert.ok(!('comments' in saved.answers[1]), 'incompatible → omit');
    assert.ok(!('comments' in saved.answers[2]), '无既有 → omit');
    assert.equal(events.filter((e) => e === 'comments_failed').length, 3, '内部逐 answer 事件（CLI 侧聚合）');
  } finally {
    restore();
  }
});

test('C/G-C: comments ON + not selected + 既有任意 incompatible → 原样保留（不 validate）', async () => {
  const { outDir } = tmpOut();
  const seeded = makeAnswers(12);
  seeded[11].comments = { legacy: true }; // voteup 最低（1011）→ 未选中
  seedArtifact(outDir, '123', seeded);
  const restore = stubFetch({
    info: INFO,
    commentsByAnswer: {
      1000: { data: [rootItem()], paging: { totals: 1, is_end: true } },
      1001: { data: [rootItem()], paging: { totals: 1, is_end: true } },
      1002: { data: [rootItem()], paging: { totals: 1, is_end: true } },
    },
    failCommentsFor: new Set(['1003', '1004', '1005', '1006', '1007', '1008', '1009']),
  });
  try {
    await grabAll(TEST_CONFIG, '123', { outDir, comments: true });
    const saved = readArtifact(outDir, '123');
    const low = saved.answers.find((a) => a.id === '1011');
    assert.deepEqual(low.comments, { legacy: true }, 'not selected → 原样保留 incompatible（不 validate）');
    assert.equal(saved.answers.find((a) => a.id === '1000').comments.length, 1, 'selected success → replace');
  } finally {
    restore();
  }
});

test('C: comments ON 时每个 selected answer 恰好 1 次请求；retries=0 生效（5xx 不重试）', async () => {
  const { outDir } = tmpOut();
  const attempts = {};
  const restore = stubFetch({
    info: INFO,
    answers: { data: makeAnswers(3), paging: { is_end: true, totals: 3 } },
    commentsByAnswer: { 1000: { data: [rootItem({ id: 'x1' })], paging: { totals: 1, is_end: true } } },
    failCommentsFor: new Set(['1001', '1002']),
    attempts,
  });
  try {
    await grabAll(TEST_CONFIG, '123', { outDir, comments: true });
    const commentUrls = Object.keys(attempts).filter((u) => u.includes('comment_v5'));
    assert.equal(commentUrls.length, 3, '3 个 selected answers 各 1 次');
    for (const u of commentUrls) assert.equal(attempts[u], 1, 'retries=0 → 5xx 不重试，恰好 1 次 HTTP 尝试');
    const saved = readArtifact(outDir, '123');
    assert.equal(saved.answers[0].comments.length, 1, 'success → replace');
  } finally {
    restore();
  }
});

test('G-D: selected success → replace；explicit zero → []', async () => {
  const { outDir } = tmpOut();
  const seeded = makeAnswers(2);
  seeded[0].comments = [{ contentHtml: '<p>old</p>', contentMarkdown: 'old' }];
  seedArtifact(outDir, '123', seeded);
  const restore = stubFetch({
    info: INFO,
    commentsByAnswer: {
      1000: { data: [rootItem({ id: 'n1' })], paging: { totals: 1, is_end: true } },
      1001: { data: [], paging: { totals: 0, is_end: true } },
    },
  });
  try {
    await grabAll(TEST_CONFIG, '123', { outDir, comments: true });
    const saved = readArtifact(outDir, '123');
    assert.equal(saved.answers[0].comments.length, 1, 'success → replace（不 merge 旧值）');
    assert.equal(saved.answers[0].comments[0].contentHtml, '<p>hello</p>');
    assert.deepEqual(saved.answers[1].comments, [], 'explicit zero → replace []');
  } finally {
    restore();
  }
});

// ===== H. CLI =====

test('H: batch/search/status + --comments → static invalid_input（先于凭据）', () => {
  const noCred = {
    PATH: process.env.PATH,
    ZAG_CONFIG_DIR: path.join(os.tmpdir(), 'zhihu-nope-a'),
    ZHIHU_CLI_CONFIG: path.join(os.tmpdir(), 'zhihu-nope-b'),
  };
  const cases = [
    ['batch', 'x.txt', '--comments', '--json'],
    ['search', 'kw', '--comments', '--json'],
    ['status', '--comments', '--json'],
    ['search', 'kw', '--grab', '--comments', '--json'],
  ];
  for (const args of cases) {
    const r = runCli(args, { env: noCred });
    assert.equal(r.status, 1, args.join(' '));
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.type, 'invalid_input', args.join(' '));
    assert.match(parsed.error.message, /仅支持 grab/);
  }
});

test('H: grab --comments 被接受（无凭据时走到 configuration_error 而非 invalid_input）', () => {
  const noCred = {
    PATH: process.env.PATH,
    ZAG_CONFIG_DIR: path.join(os.tmpdir(), 'zhihu-nope-a'),
    ZHIHU_CLI_CONFIG: path.join(os.tmpdir(), 'zhihu-nope-b'),
  };
  const r = runCli(['grab', '123', '--comments', '--json'], { env: noCred });
  assert.equal(r.status, 1);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'configuration_error', '--comments 通过静态检查、走到凭据阶段');
});

// ===== I. warning =====

test('I: 多个 selected answer 失败 → 内部逐 answer 事件（CLI 侧聚合为单条）', async () => {
  const { outDir } = tmpOut();
  const events = [];
  const restore = stubFetch({
    info: INFO,
    answers: { data: makeAnswers(3), paging: { is_end: true, totals: 3 } },
    failCommentsFor: new Set(['1000', '1001', '1002']),
  });
  try {
    await grabAll(TEST_CONFIG, '123', { outDir, comments: true, onProgress: (p) => events.push(p.event) });
    assert.equal(events.filter((e) => e === 'comments_failed').length, 3);
  } finally {
    restore();
  }
});

// ===== J. V1 compatibility =====

test('J: fresh OFF 抓取 → answers 无 comments 字段（additive optional）', async () => {
  const { outDir } = tmpOut();
  const restore = stubFetch({ info: INFO, answers: { data: makeAnswers(2), paging: { is_end: true, totals: 2 } } });
  try {
    await grabAll(TEST_CONFIG, '123', { outDir });
    const saved = readArtifact(outDir, '123');
    assert.equal(saved.questionId, '123');
    assert.ok(saved.answers.every((a) => !('comments' in a)), 'OFF 时无 comments 字段');
  } finally {
    restore();
  }
});
