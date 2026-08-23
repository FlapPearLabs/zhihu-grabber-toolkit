// SPDX-License-Identifier: AGPL-3.0-only
/**
 * T-2 — Batch current-semantics regression coverage（现状承诺回归加固）。
 *
 * 纯测试票：不修改 src 产品行为。证明当前已批准语义稳定可回归：
 *   - 分页终止：重复页指纹检测、MAX_PAGES 边界
 *   - batch 多问题部分失败：顺序 / 失败隔离 / 顶层 ok=false / exit 1 / 产物保留
 *   - resume 当前语义：done=true 重跑跳过分页、磁盘 answers.json 不重写（comments OFF）
 *   - artifact isolation：失败项不污染成功项
 *
 * 全部离线 stub（不联网）；不引入 retry / fresh / 自动清理等新产品行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { grabAll } from '../src/grabber.js';

const TEST_CONFIG = {
  cookies: { z_c0: 'zc-test', d_c0: 'dc-test' },
  userAgent: 'UA-TEST',
  zse93: '101_3_3.0',
};

/** 模拟 requestJson 的 fetch：区分问题信息 URL 与回答分页 URL */
function stubFetch(answersBody, onCall) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    onCall?.(u);
    const body = u.includes('/answers?') ? answersBody : { title: '测试问题', answer_count: 0 };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return () => { globalThis.fetch = original; };
}

// ===== A. 分页终止：重复页指纹 =====

test('T2-fingerprint: 连续两页同指纹 → 停止并报错（不无限循环）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-t2-fingerprint-'));
  const outDir = path.join(dir, 'out');
  const restore = stubFetch({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: false } });
  try {
    await assert.rejects(grabAll(TEST_CONFIG, '123', { outDir }), /检测到重复分页/);
  } finally {
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===== B. 分页终止：MAX_PAGES 边界 =====

test('T2-maxpages: 达到 MAX_PAGES 阈值仍未结束 → 确定性失败（不静默截断为成功）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-t2-maxpages-'));
  const outDir = path.join(dir, 'out');
  let page = 0;
  const originalFetch = globalThis.fetch;
  // 每页返回不同指纹（id 递增）且 is_end=false → 只可能因 MAX_PAGES 触发
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/answers?')) {
      page += 1;
      return new Response(JSON.stringify({ data: [{ id: String(page), content: '<p>x</p>' }], paging: { is_end: false } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ title: 'T', answer_count: 0 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  // 绕过 humanDelay（1.5-4s/页 × 300 页不可接受）；仅测试期间替换，finally 恢复
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { fn(); return 0; };
  try {
    await assert.rejects(grabAll(TEST_CONFIG, '123', { outDir }), /达到安全阈值（300 页）仍未见结尾/);
    // 精确边界：MAX_PAGES=300，逐页循环在 page>=300 时抛错 → 恰好请求 300 页后失败。
    // 不允许 301/350 等更多页仍以"300 页"文本通过（锁定当前实现的确切语义）。
    assert.equal(page, 300, `应恰好请求 300 页后失败（实际 ${page}）`);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===== C. batch 多问题部分失败（CLI 端到端，离线 stub） =====

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

/**
 * 运行 batch CLI 子进程（离线 stub，不联网）。
 *
 * SAME_VOLUME_RELATIVE_PATH 场景：CLI 子进程 cwd 设为临时目录（与 out-dir 同盘）
 * → relPath 生成相对路径。此测试只证明"正常同盘"下的相对路径契约成立。
 *
 * 注意（T-2 review 修正）：Windows 跨盘时 path.relative() 会退化为
 * drive-qualified 绝对路径 —— 这不是"非产品语义"，而是真实的实现违约
 * （Product Behavior Contract §3.3 要求机器 JSON 路径一律相对 cwd、不泄漏
 * 绝对路径，且 --out-dir 与 cwd 是独立配置维度、无同盘限制）。
 * BUG_ID: B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE（BUG_CONFIRMED: YES）。
 * 跨盘失败回归与生产修复由独立的 B-1 CODE bug ticket 负责（T-2 纯测试票
 * 不修 source、不加永久失败用例、不用 skip/todo 编码该 bug）。
 * 临时目录位于 os.tmpdir()，删除方式与既有 cli-json.test.js 一致。
 */
function runBatchCli({ qids, failingQids }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-t2-batch-'));
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const stubFile = path.join(dir, 'stub-fetch.mjs');
  const failing = JSON.stringify(failingQids);
  fs.writeFileSync(stubFile, `
// 临时测试 stub（不进仓库）：failingQids 的 answers 请求返回 500，其余成功
globalThis.fetch = async (url) => {
  const u = String(url);
  const failSet = new Set(${failing});
  if (u.includes('/answers?')) {
    const qid = u.match(/questions\\/(\\d+)\\/answers/)?.[1] ?? '';
    if (failSet.has(qid)) {
      return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: [{ id: qid + 'a1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ id: u.match(/questions\\/(\\d+)/)?.[1] ?? '0', title: 'T', answer_count: 0, detail: '', topics: [] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};
`, 'utf8');
  const listFile = path.join(dir, 'list.txt');
  fs.writeFileSync(listFile, `${qids.join('\n')}\n`, 'utf8');
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(stubFile).href,
    CLI, 'batch', listFile, '--json', '--out-dir', outDir,
  ], {
    encoding: 'utf8',
    cwd: dir, // CLI 的 process.cwd() = 临时目录（与 out-dir 同盘）
    env: { ...process.env, PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake; d_c0=fake' },
    timeout: 30_000,
  });
  return { r, dir, outDir };
}

test('T2-batch: 中间问题失败 → 顺序保持、失败隔离、顶层 ok=false、exit 1、成功项产物保留', () => {
  const { r, dir, outDir } = runBatchCli({ qids: ['123', '456', '789'], failingQids: ['456'] });
  try {
    assert.equal(r.status, 1, 'batch 任一失败 → exit 1');
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false, '任一 failed → 顶层 ok=false');
    // 顺序保持：succeeded 按输入顺序，failed 记录失败项
    assert.deepEqual(parsed.succeeded.map((s) => s.questionId), ['123', '789'], '成功项顺序 = 输入顺序（456 被隔离）');
    assert.deepEqual(parsed.failed.map((f) => f.questionId ?? f.input), ['456']);
    // 成功项产物保留
    for (const qid of ['123', '789']) {
      assert.ok(fs.existsSync(path.join(outDir, qid, 'answers.json')), `成功项 ${qid} 产物应保留`);
    }
    // 失败项不产生 answers.json（artifact isolation）
    assert.ok(!fs.existsSync(path.join(outDir, '456', 'answers.json')), `失败项 ${'456'} 不应有 answers.json`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('T2-batch: 全成功 → exit 0、ok=true、artifacts 相对路径', () => {
  const { r, dir, outDir } = runBatchCli({ qids: ['111', '222'], failingQids: [] });
  try {
    assert.equal(r.status, 0, '全成功 → exit 0');
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.failed.length, 0);
    assert.deepEqual(parsed.succeeded.map((s) => s.questionId), ['111', '222']);
    // 机器契约：artifacts 路径为相对路径 —— 仅证明 SAME_VOLUME_RELATIVE_PATH 场景
    // （CLI cwd 与 out-dir 同盘）。跨盘（RELATIVE_PATH_CROSS_VOLUME）属已确认违约
    // B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE，由独立 CODE bug ticket 修复，不在本票。
    for (const s of parsed.succeeded) {
      for (const key of ['json', 'markdown', 'progress']) {
        const p = s.artifacts?.[key];
        assert.ok(p && !path.isAbsolute(p), `artifacts.${key} 应为相对路径: ${p}`);
      }
      assert.equal(s.artifacts.json,
        path.relative(dir, path.join(outDir, s.questionId, 'answers.json')).split(path.sep).join('/'));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===== D. resume 当前语义（done=true 重跑） =====

test('T2-resume: done=true 重跑 → 分页跳过、metadata 仍请求、磁盘 answers.json 不重写（comments OFF）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-t2-resume-'));
  const outDir = path.join(dir, 'out');
  let answersRequests = 0;
  let infoRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/answers?')) {
      answersRequests += 1;
      return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    infoRequests += 1;
    return new Response(JSON.stringify({ id: '123', title: 'T', answer_count: 1, detail: '', topics: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const first = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(first.answers.length, 1);
    const answersRequestsAfterFirst = answersRequests;
    assert.equal(answersRequestsAfterFirst, 1, '首次抓取恰 1 次 answers 请求（is_end=true）');
    const jsonPath = path.join(outDir, '123', 'answers.json');
    const jsonAfterFirst = fs.readFileSync(jsonPath, 'utf8');
    assert.ok(fs.existsSync(path.join(outDir, '123', '.progress.json')));

    // done=true 重跑
    const second = await grabAll(TEST_CONFIG, '123', { outDir });
    assert.equal(second.answers.length, 1);
    assert.equal(answersRequests, answersRequestsAfterFirst, 'done=true 重跑不再请求 answers 页');
    assert.ok(infoRequests >= 2, '重跑时 question metadata 请求仍发生');
    assert.equal(fs.readFileSync(jsonPath, 'utf8'), jsonAfterFirst, 'comments OFF 且 done=true 时磁盘 answers.json 不重写');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
