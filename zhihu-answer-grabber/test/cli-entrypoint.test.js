// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CLI entrypoint regression（T2_REPAIR_R2, P1）。
 *
 * 防止 `isDirectExecution` 对 POSIX bin symlink（npm/pnpm/yarn
 * node_modules/.bin/zhigrab -> ../package/src/cli.js）误判为「非直接执行」，
 * 导致 main() 不运行、CLI 无输出的回归。
 *
 * 覆盖：
 *  A. direct invocation：node src/cli.js --help → 有 CLI 输出
 *  B. POSIX symlink invocation：<tmp>/zhigrab -> src/cli.js --help → 有 CLI 输出
 *     （Windows 无 symlink 权限时 platform skip；POSIX CI 必跑）
 *  C. import：import('../src/cli.js') 不得自动跑 main（stdout 无 CLI help/error）
 *  D. helper 单测：测试进程内 isDirectExecution() === false
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const CLI_URL = pathToFileURL(CLI).href;
const HELP_MARKER = 'zhigrab — 知乎回答抓取工具';

function runNode(args, opts = {}) {
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd: opts.cwd || path.dirname(CLI),
    env: { ...process.env, ...(opts.env || {}) },
    timeout: 30_000,
  });
}

// ===== A. direct invocation =====

test('entrypoint: node src/cli.js --help 直接执行 → 有 CLI 输出', () => {
  const r = runNode([CLI, '--help']);
  assert.equal(r.status, 0, `exit 0, stderr=${r.stderr.slice(0, 200)}`);
  assert.ok(r.stdout.includes(HELP_MARKER), 'stdout 含 CLI help');
});

test('entrypoint: node src/cli.js 无参数 → 输出 help 且 exit 0', () => {
  const r = runNode([CLI]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(HELP_MARKER));
});

// ===== B. symlink invocation（POSIX）=====

test('entrypoint: POSIX symlink 调用 → 仍执行 main（bin 安装回归）', (t) => {
  // Windows：Node 不执行无扩展名 symlink 入口（平台行为，与 isDirectExecution 无关）；
  // 且 npm/pnpm/yarn 在 Windows 用 .cmd shim（argv[1] 即真实路径，由 direct 用例覆盖）。
  // POSIX（Linux/macOS）才是 node_modules/.bin -> ../package/src/cli.js 真实 symlink 场景。
  if (process.platform === 'win32') {
    t.skip('Windows 无扩展名 symlink 不被 Node 执行且 npm 用 .cmd shim；POSIX CI 覆盖本用例');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhigrab-bin-'));
  const link = path.join(dir, 'zhigrab');
  fs.symlinkSync(CLI, link);
  const r = runNode([link, '--help']);
  assert.equal(r.status, 0, `symlink 调用 exit 0, stderr=${r.stderr.slice(0, 200)}`);
  assert.ok(r.stdout.includes(HELP_MARKER), 'symlink 调用必须执行 main 并输出 CLI help');
});

// ===== C. import 不得自动跑 main =====

test('entrypoint: import cli.js 不得自动执行 main（stdout 无 CLI help/error）', async () => {
  // 在独立子进程内 import，捕获该进程 stdout
  const script = `
    import(${JSON.stringify(CLI_URL)})
      .then((m) => {
        if (typeof m.isDirectExecution !== 'function') throw new Error('isDirectExecution 未导出');
        if (typeof m.cmdSearch !== 'function') throw new Error('cmdSearch 未导出');
        console.log('IMPORT_OK');
      })
      .catch((e) => { console.error('IMPORT_FAIL', e.message); process.exit(1); });
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: path.dirname(CLI),
    timeout: 30_000,
  });
  assert.equal(r.status, 0, `import 子进程 exit 0, stderr=${r.stderr.slice(0, 300)}`);
  assert.ok(r.stdout.includes('IMPORT_OK'), '模块可正常导入');
  assert.ok(!r.stdout.includes(HELP_MARKER), 'import 不得触发 main / 输出 CLI help');
  assert.ok(!r.stderr.includes('✗'), 'import 不得输出 CLI error');
});

// ===== D. helper 单测（测试进程内不得误判为直接执行）=====

test('entrypoint: 测试进程内 isDirectExecution() === false（argv[1] 是测试 runner）', async () => {
  const m = await import('../src/cli.js');
  assert.equal(m.isDirectExecution(), false, '被 import 时不得判定为直接执行');
});
