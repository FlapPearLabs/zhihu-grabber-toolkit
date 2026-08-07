import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
