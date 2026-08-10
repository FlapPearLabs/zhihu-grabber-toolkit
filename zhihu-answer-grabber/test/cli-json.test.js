import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, ...(opts.env || {}) },
    timeout: 30_000,
  });
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-json-cli-'));
  const outDir = path.join(dir, 'out', '123');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify({
    questionId: '123',
    questionTitle: '测试',
    answerCount: 2,
    answers: [
      { id: '1', author: 'A', content: '<p>x</p>' },
      { id: '2', author: 'B', content: '<p>y</p>' },
    ],
  }));
  fs.writeFileSync(path.join(outDir, 'answers.md'), '# 测试\n\n## 1. A\nx\n\n## 2. B\ny\n');
  fs.writeFileSync(path.join(outDir, '.progress.json'), JSON.stringify({ offset: 40, done: true }));
  return { dir, outDir };
}

// ===== P1-INT-1：completion 语义 =====

test('P1-INT-1: grab 失败时（无凭据）JSON 错误可解析，且不声称完成', () => {
  const r = runCli(['grab', '123', '--json'], { env: { PATH: process.env.PATH } });
  // 无凭据 → 结构化错误，stdout 必须是单一合法 JSON
  assert.equal(r.status, 1, '无凭据时应退出非 0');
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, 'grab');
  assert.ok(parsed.error.type, '错误必须有 type');
  assert.ok(['configuration_error', 'invalid_input'].includes(parsed.error.type), `错误类型: ${parsed.error.type}`);
});

test('P1-INT-1: grab 人类模式输出不含 verified 语义（产物尚未验证）', () => {
  // 不联网场景：用 --json 验证契约字段，人类模式的语义由 cli 内部逻辑保证
  const r = runCli(['status', '--json'], { env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.command, 'status');
  assert.ok(Array.isArray(parsed.items));
});

// ===== P1-INT-2：status 区分 captured / verified =====

test('P1-INT-2: status --json 区分 captureStatus 与 verificationStatus（有效产物 → valid）', () => {
  const { dir, outDir } = makeFixture();
  const r = runCli(['status', '--json', '--out-dir', path.join(dir, 'out')], { env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  const item = parsed.items.find((i) => i.questionId === '123');
  assert.ok(item, '应包含 123 的状态');
  assert.equal(item.captureStatus, 'captured');
  assert.equal(item.verificationStatus, 'valid');
  assert.equal(item.capturedAnswerCount, 2);
  assert.equal(path.isAbsolute(item.questionId), false);
});

test('P1-INT-2: status 不把 progress.done 直接当 verified（产物不一致 → invalid）', () => {
  const { dir, outDir } = makeFixture();
  // 破坏一致性：answers.md 记录数与 answers.json 不一致
  fs.writeFileSync(path.join(outDir, 'answers.md'), '# 测试\n\n## 1. A\nx\n'); // 只有 1 条
  const r = runCli(['status', '--json', '--out-dir', path.join(dir, 'out')], { env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  const item = parsed.items.find((i) => i.questionId === '123');
  assert.equal(item.captureStatus, 'captured');
  assert.equal(item.verificationStatus, 'invalid');
  assert.ok(Array.isArray(item.verificationWarnings) && item.verificationWarnings.length > 0);
});

test('P1-INT-2: status 遇到损坏目录不崩溃，且不报告 verified', () => {
  const { dir, outDir } = makeFixture();
  fs.writeFileSync(path.join(outDir, 'answers.json'), '{broken!!');
  fs.writeFileSync(path.join(outDir, '.progress.json'), JSON.stringify({ offset: 5, done: true }));
  const r = runCli(['status', '--json', '--out-dir', path.join(dir, 'out')], { env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, '损坏目录不应导致整个 status 崩溃');
  const parsed = JSON.parse(r.stdout);
  const item = parsed.items.find((i) => i.questionId === '123');
  assert.ok(item, '损坏目录也应出现在 items 中');
  assert.notEqual(item.verificationStatus, 'valid', '损坏目录不得报告为 verified');
  assert.equal(item.verificationStatus, 'invalid');
});

// ===== P1-INT-3：JSON 机器契约 =====

test('P1-INT-3: status --json stdout 纯净（单一合法 JSON，无人类日志）', () => {
  const { dir, outDir } = makeFixture();
  const r = runCli(['status', '--json', '--out-dir', path.join(dir, 'out')], { env: { PATH: process.env.PATH } });
  const parsed = JSON.parse(r.stdout); // 若混入人类日志，这里必然抛错
  assert.equal(parsed.command, 'status');
  // 确认没有人类日志标记
  assert.ok(!r.stdout.includes('已抓取'), 'stdout 不应含人类日志');
  assert.ok(!r.stdout.includes('▶'), 'stdout 不应含进度符号');
});

test('P1-INT-3: search 无 secret → 结构化错误 JSON', () => {
  const r = runCli(['search', 'codex', '--json'], { env: { PATH: process.env.PATH, ZHIHU_SECRET: '' } });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, 'search');
  assert.equal(parsed.error.type, 'configuration_error');
});

test('P1-INT-3: 错误 JSON 不泄漏凭据', () => {
  const r = runCli(['grab', '123', '--json'], { env: { PATH: process.env.PATH, ZHIHU_COOKIE: '' } });
  const stdout = r.stdout;
  assert.ok(!stdout.includes('z_c0='), '错误输出不得包含凭据');
  assert.ok(!stdout.includes('secret'), '错误输出不得包含 secret 值');
});

test('P1-INT-3: JSON 输出路径为相对路径（不泄漏绝对路径）', () => {
  const { dir, outDir } = makeFixture();
  const r = runCli(['status', '--json', '--out-dir', path.join(dir, 'out')], { env: { PATH: process.env.PATH } });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  // items 内不出现绝对路径
  const text = r.stdout;
  assert.ok(!text.includes(os.tmpdir()), 'JSON 不得包含绝对路径');
});

test('P1-INT-3: grab 参数校验错误也走结构化 JSON', () => {
  const r = runCli(['grab', '--json'], { env: { PATH: process.env.PATH } });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.command, 'grab');
  assert.equal(parsed.error.type, 'invalid_input');
});

// ===== P1-INT-NEW-1：JSON 错误通道不得泄漏本机绝对路径 =====

test('P1-INT-NEW-1: ConfigError JSON 消息不泄漏绝对路径（ZHIHU_CLI_CONFIG 私有路径）', () => {
  const r = runCli(['grab', '123', '--json'], {
    env: { PATH: process.env.PATH, ZHIHU_CLI_CONFIG: '/very/private/user/path/config.json' },
  });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'configuration_error');
  assert.ok(!r.stdout.includes('/very/private/user/path'), 'stdout 不得包含绝对路径');
  assert.ok(!r.stdout.includes('config.json'), 'stdout 不得包含配置文件名');
  assert.ok(parsed.error.message.includes('preflight'), '应引导运行 preflight');
});

test('P1-INT-NEW-1: Windows 绝对路径同样被抹掉', () => {
  // 用人类模式验证 sanitizeDisplayPaths 效果（ConfigError 固定消息 + 其他错误 sanitize）
  const r = runCli(['batch', 'C:\\Users\\alice\\private\\list.txt', '--json'], {
    env: { PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
  });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input');
  assert.ok(!r.stdout.includes('C:\\Users\\alice'), 'stdout 不得包含 Windows 绝对路径');
});

test('P1-1: 任意 POSIX 绝对路径（/workspace、/custom 等非白名单根）也被脱敏', () => {
  for (const p of ['/workspace/alice/private/list.txt', '/custom/internal/question.txt']) {
    const r = runCli(['batch', p, '--json'], {
      env: { PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
    });
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.type, 'invalid_input');
    assert.ok(!r.stdout.includes(p), `stdout 不得包含 ${p}`);
  }
});

test('P1-1: batch failed[].input 不得泄漏绝对路径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-batch-input-'));
  const listFile = path.join(dir, 'list.txt');
  fs.writeFileSync(listFile, '/custom/internal/question.txt\n');
  const r = runCli(['batch', listFile, '--json'], {
    env: { PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
  });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.failed.length, 1);
  assert.ok(!r.stdout.includes('/custom/internal/question.txt'), 'failed[].input 不得包含绝对路径');
  assert.ok(!parsed.failed[0].input.includes('/custom/'), 'input 字段应被脱敏');
});

// ===== P1-INT-NEW-2：结构化 error.type 稳定分类 =====

test('P1-INT-NEW-2: 凭据可用时 grab 非法输入 → invalid_input', () => {
  const r = runCli(['grab', 'definitely-not-a-question', '--json'], {
    env: { PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
  });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input');
});

test('P1-INT-NEW-2: 不存在的 batch 文件 → invalid_input（非 unknown_error）', () => {
  const r = runCli(['batch', path.join(os.tmpdir(), 'no-such-batch-file-xyz.txt'), '--json'], {
    env: { PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
  });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input');
});

test('P1-INT-NEW-2: 未知命令 → invalid_input', () => {
  const r = runCli(['totally-unknown-command', '--json'], { env: { PATH: process.env.PATH } });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input');
});

// ===== P1-2：静态输入校验先于凭据检查（invalid_input 不依赖凭据状态） =====

test('P1-2: 无凭据时 grab 非法输入仍 → invalid_input（静态校验前置）', () => {
  const r = runCli(['grab', 'definitely-not-a-question', '--json'], { env: { PATH: process.env.PATH } }); // 无 ZHIHU_COOKIE
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input', '非法输入不应因无凭据变成 configuration_error');
});

test('P1-2: 无凭据时 batch 缺失文件 → invalid_input（静态校验前置）', () => {
  const r = runCli(['batch', path.join(os.tmpdir(), 'no-such-batch-xyz.txt'), '--json'], { env: { PATH: process.env.PATH } }); // 无凭据
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input', '缺失文件不应因无凭据变成 configuration_error');
});

test('P1-2: 无凭据时 grab 合法输入 → configuration_error（语义区分仍成立）', () => {
  const r = runCli(['grab', '123', '--json'], { env: { PATH: process.env.PATH } }); // 合法输入但无凭据
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'configuration_error', '合法输入 + 缺凭据 → configuration_error');
});

// ===== Fix 1：完整 questionId 静态校验先于凭据加载 =====

const QID_21 = '123456789012345678901'; // 21 位纯数字 → 静态非法
const QID_21_URL = `https://www.zhihu.com/question/${QID_21}`;

test('Fix1: 21 位 QID + 无凭据 → invalid_input（完整静态校验先于凭据加载）', () => {
  const r = runCli(['grab', QID_21, '--json'], { env: { PATH: process.env.PATH } });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input', '21 位非法 QID 不应变成 configuration_error');
  assert.ok(/1-20 位数字/.test(parsed.error.message), '错误应说明仅接受 1-20 位数字');
});

test('Fix1: 21 位 QID + 假凭据 → invalid_input（与凭据状态无关）', () => {
  const r = runCli(['grab', QID_21, '--json'], {
    env: { PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
  });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input');
});

test('Fix1: 21 位 QID URL + 无凭据 → invalid_input', () => {
  const r = runCli(['grab', QID_21_URL, '--json'], { env: { PATH: process.env.PATH } });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'invalid_input');
  assert.ok(/1-20 位数字/.test(parsed.error.message));
});

test('Fix1: 合法 1-20 位 QID 原行为不回归（无凭据 → configuration_error）', () => {
  const r = runCli(['grab', '2063557784394785882', '--json'], { env: { PATH: process.env.PATH } });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.error.type, 'configuration_error', '合法 19 位 QID + 缺凭据 → configuration_error');
});

// ===== P1-2（Phase 3）：metadata 失败必须用户可见 warning =====
// 通过 node --import 预加载 stub 网络（子进程内替换 globalThis.fetch），
// 验证 CLI grab --json 在 question info 失败时 warnings 非空且确定性。

test('P3-P1-2: question info 失败 → CLI --json warnings 非空（metadata 丢失用户可见）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-cli-meta-fail-'));
  const stubFile = path.join(dir, 'stub-fetch.mjs');
  fs.writeFileSync(stubFile, `
// 临时测试 stub（不进仓库）：question info 500，answers 成功
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
};
`, 'utf8');
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(stubFile).href,
    CLI, 'grab', '123', '--json', '--out-dir', path.join(dir, 'out'),
  ], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
    timeout: 30_000,
  });
  assert.equal(r.status, 0, `CLI 应成功退出: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true, 'core capture 仍成功');
  assert.equal(parsed.command, 'grab');
  assert.ok(Array.isArray(parsed.warnings), 'warnings 必须为数组');
  assert.ok(parsed.warnings.length > 0, 'metadata 失败时 warnings 不得为空');
  assert.ok(parsed.warnings[0].includes('本次问题元信息获取/刷新失败'), 'warning 说明 metadata 获取/刷新失败');
  // 不得泄漏凭据 / 绝对路径
  assert.ok(!r.stdout.includes('z_c0='), 'warning 不得含凭据');
  assert.ok(!r.stdout.includes(dir), 'warning 不得含绝对路径');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P3-P1-2: question info 成功 → CLI --json warnings 为空（正常路径无噪音）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-cli-meta-ok-'));
  const stubFile = path.join(dir, 'stub-fetch.mjs');
  fs.writeFileSync(stubFile, `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ id: '123', title: 'T', answer_count: 0, detail: '', topics: [] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};
`, 'utf8');
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(stubFile).href,
    CLI, 'grab', '123', '--json', '--out-dir', path.join(dir, 'out'),
  ], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
    timeout: 30_000,
  });
  assert.equal(r.status, 0, `CLI 应成功退出: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.warnings, [], '正常抓取 warnings 为空');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== P1-2 re-review：human batch 模式必须显示 metadata warning =====

test('P3-P1-2-BATCH: human batch + metadata 失败 → stdout 包含 metadata warning（batch core 行为不变）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-cli-batch-warn-'));
  const stubFile = path.join(dir, 'stub-fetch.mjs');
  fs.writeFileSync(stubFile, `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
};
`, 'utf8');
  const listFile = path.join(dir, 'list.txt');
  fs.writeFileSync(listFile, '123\n', 'utf8');
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(stubFile).href,
    CLI, 'batch', listFile, '--out-dir', path.join(dir, 'out'),
  ], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
    timeout: 30_000,
  });
  assert.equal(r.status, 0, `batch 应成功退出（enrichment 失败不致命）: ${r.stderr}`);
  assert.ok(r.stdout.includes('本次问题元信息获取/刷新失败'), 'human batch stdout 必须包含 metadata warning');
  assert.ok(!r.stdout.includes('z_c0='), 'warning 不得含凭据');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('P3-P1-2-BATCH-JSON: JSON batch + metadata 失败 → succeeded[].warnings 非空（机器通道保留）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-cli-batch-json-'));
  const stubFile = path.join(dir, 'stub-fetch.mjs');
  fs.writeFileSync(stubFile, `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
};
`, 'utf8');
  const listFile = path.join(dir, 'list.txt');
  fs.writeFileSync(listFile, '123\n', 'utf8');
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(stubFile).href,
    CLI, 'batch', listFile, '--json', '--out-dir', path.join(dir, 'out'),
  ], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
    timeout: 30_000,
  });
  assert.equal(r.status, 0, `batch --json 应成功: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.failed.length, 0, 'enrichment 失败不算 batch fail');
  assert.equal(parsed.succeeded.length, 1);
  assert.ok(Array.isArray(parsed.succeeded[0].warnings) && parsed.succeeded[0].warnings.length > 0,
    'JSON batch 经 succeeded[].warnings 暴露 metadata warning');
  assert.ok(parsed.succeeded[0].warnings[0].includes('本次问题元信息获取/刷新失败'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ===== P1-3 re-review：warning 必须走 public path sanitizer（Windows/POSIX 反例）=====

function runCliWithFetchStub({ stubBody, args, listFile = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-p3-sanitize-'));
  const stubFile = path.join(dir, 'stub-fetch.mjs');
  fs.writeFileSync(stubFile, stubBody, 'utf8');
  const outDir = path.join(dir, 'out');
  // 把 args 中的 __OUT__ 占位符替换为实际输出目录
  const replacedArgs = args.map((a) => (a === '__OUT__' ? outDir : a));
  const finalArgs = listFile
    ? [...replacedArgs.slice(0, 2), listFile, ...replacedArgs.slice(2)]
    : replacedArgs;
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(stubFile).href, CLI, ...finalArgs], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake123; d_c0=fake456' },
    timeout: 30_000,
  });
  return { r, dir };
}

test('P3-P1-3: warning 内 Windows 绝对路径被脱敏（fetch throw 含 D:\\Users\\alice\\secret）', () => {
  const { r, dir } = runCliWithFetchStub({
    stubBody: `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error('connect failed at D:\\\\Users\\\\alice\\\\secret\\\\cookie.txt');
};
`,
    args: ['grab', '123', '--json', '--out-dir', '__OUT__'],
  });
  try {
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.warnings) && parsed.warnings.length > 0, 'metadata 失败 warning 存在');
    assert.ok(!r.stdout.includes('Users\\\\alice'), 'Windows 路径不得泄漏（原始形态）');
    assert.ok(!r.stdout.includes('Users\\alice'), 'Windows 路径不得泄漏');
    assert.ok(!r.stdout.includes('cookie.txt'), '文件名不得泄漏');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P3-P1-3: warning 内 POSIX 绝对路径被脱敏（fetch throw 含 /home/alice/secret）', () => {
  const { r, dir } = runCliWithFetchStub({
    stubBody: `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error('connect failed at /home/alice/secret/cookie.txt');
};
`,
    args: ['grab', '123', '--json', '--out-dir', '__OUT__'],
  });
  try {
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.warnings) && parsed.warnings.length > 0, 'metadata 失败 warning 存在');
    assert.ok(!r.stdout.includes('/home/alice'), 'POSIX 路径不得泄漏');
    assert.ok(!r.stdout.includes('cookie.txt'), '文件名不得泄漏');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P3-P1-3: human grab + fetch throw 含绝对路径 → 人类 warning 同样脱敏', () => {
  const { r, dir } = runCliWithFetchStub({
    stubBody: `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error('connect failed at /home/alice/secret/cookie.txt');
};
`,
    args: ['grab', '123', '--out-dir', '__OUT__'],
  });
  try {
    assert.equal(r.status, 0, 'enrichment 失败不致命');
    assert.ok(r.stdout.includes('本次问题元信息获取/刷新失败'), '人类模式显示 warning');
    assert.ok(!r.stdout.includes('/home/alice'), '人类 warning 不含 POSIX 路径');
    assert.ok(!r.stdout.includes('cookie.txt'), '人类 warning 不含文件名');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ===== P1-NEW-2（final re-review）：公开 warning 必须 stable/minimal，不得转发 raw error =====

test('P3-P1-NEW-2: fetch throw 含 Cookie 值 → 公开 warning 不泄漏（z_c0/d_c0/secret）', () => {
  const { r, dir } = runCliWithFetchStub({
    stubBody: `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error('request failed; Cookie: z_c0=TOP_SECRET; d_c0=SECRET2');
};
`,
    args: ['grab', '123', '--json', '--out-dir', '__OUT__'],
  });
  try {
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.warnings) && parsed.warnings.length > 0, 'metadata 失败 warning 存在');
    assert.ok(parsed.warnings[0].includes('本次问题元信息获取/刷新失败；回答核心抓取继续。'), 'warning 为固定最小文本');
    // 固定文本不含 raw error → 不泄漏 Cookie
    for (const needle of ['z_c0', 'd_c0', 'TOP_SECRET', 'SECRET2', 'request failed']) {
      assert.ok(!parsed.warnings[0].includes(needle), `warning 不得包含 ${needle}`);
    }
    assert.ok(!r.stdout.includes('TOP_SECRET'), 'stdout 不得包含 secret');
    assert.ok(!r.stdout.includes('SECRET2'), 'stdout 不得包含 d_c0 值');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P3-P1-NEW-2: HTTP 失败响应携带服务器 message → 公开 warning 不包含该外部文本', () => {
  const { r, dir } = runCliWithFetchStub({
    stubBody: `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ message: 'EXTERNAL_SERVER_TEXT_SHOULD_NOT_SURFACE' }), {
    status: 500, headers: { 'content-type': 'application/json' },
  });
};
`,
    args: ['grab', '123', '--json', '--out-dir', '__OUT__'],
  });
  try {
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.warnings) && parsed.warnings.length > 0, 'metadata 失败 warning 存在');
    assert.ok(parsed.warnings[0].includes('本次问题元信息获取/刷新失败；回答核心抓取继续。'), 'warning 为固定最小文本');
    assert.ok(!parsed.warnings[0].includes('EXTERNAL_SERVER_TEXT_SHOULD_NOT_SURFACE'),
      'warning 不得包含服务器返回的 message 正文');
    assert.ok(!r.stdout.includes('EXTERNAL_SERVER_TEXT_SHOULD_NOT_SURFACE'), 'stdout 不得包含服务器正文');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P3-P1-NEW-2: human 模式 warning 同为固定文本（多行注入/服务器文本被消除）', () => {
  const { r, dir } = runCliWithFetchStub({
    stubBody: `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: '1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  throw new Error('line1\\nINJECTED_LOG_LINE\\nz_c0=HIDDEN');
};
`,
    args: ['grab', '123', '--out-dir', '__OUT__'],
  });
  try {
    assert.equal(r.status, 0, 'enrichment 失败不致命');
    assert.ok(r.stdout.includes('本次问题元信息获取/刷新失败；回答核心抓取继续。'), '人类 warning 为固定文本');
    assert.ok(!r.stdout.includes('INJECTED_LOG_LINE'), '人类 warning 不含注入行');
    assert.ok(!r.stdout.includes('HIDDEN'), '人类 warning 不含 Cookie 值');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
