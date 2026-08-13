// SPDX-License-Identifier: AGPL-3.0-only
/**
 * B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE 回归（fix/b1-cross-volume-machine-paths）。
 *
 * 合同：Product Behavior Contract §3.3 APPROVED_TARGET_BEHAVIOR = OPTION A
 *  - 同盘：artifacts 路径 relative-to-cwd，artifacts.base 缺席（JSON 与旧版逐字节一致）
 *  - Windows 跨盘（cwd-relative 无法表达）：relative-to-effective-out-dir
 *    + artifacts.base = "outdir"；无盘符 / 无前导斜杠 / 绝不绝对
 *  - fail closed：两种表示都无法生成安全相对路径 → null（绝不输出绝对路径）
 *  - make-handoff：inputJson/inputMarkdown 合同不变（相对 handoff 目录）；
 *    human display 不泄漏绝对 / drive-qualified 路径
 *
 * Portable 设计：生产决策 helper（src/machine-paths.js）支持注入 pathImpl，
 * 用 path.win32 做确定性跨盘单测（任意平台可跑）；CLI 集成在 Windows 上
 * 用 repo cwd（D:）与 os.tmpdir()（C:）做真实跨盘证据，非 Windows 走同盘断言。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { machineArtifacts } from '../src/machine-paths.js';

const win32 = path.win32;

// ===== A. helper 单测（确定性，任意平台） =====

test('B1-helper: 同盘（win32）→ base 缺席、路径 relative-to-cwd', () => {
  const r = machineArtifacts('D:\\proj\\out\\123', {
    cwd: 'D:\\proj',
    outDirRoot: 'D:\\proj\\out',
    pathImpl: win32,
  });
  assert.ok(r);
  assert.equal(r.base, undefined, '同盘不得发射 artifacts.base');
  assert.equal(r.json, 'out/123/answers.json');
  assert.equal(r.markdown, 'out/123/answers.md');
  assert.equal(r.progress, 'out/123/.progress.json');
});

test('B1-helper: 跨盘（win32）→ base="outdir"、路径 relative-to-out-dir、无盘符/前导斜杠', () => {
  const r = machineArtifacts('C:\\cap\\123', {
    cwd: 'D:\\proj',
    outDirRoot: 'C:\\cap',
    pathImpl: win32,
  });
  assert.ok(r);
  assert.equal(r.base, 'outdir');
  assert.equal(r.json, '123/answers.json');
  assert.equal(r.markdown, '123/answers.md');
  assert.equal(r.progress, '123/.progress.json');
  for (const p of [r.json, r.markdown, r.progress]) {
    assert.ok(!win32.isAbsolute(p), `不得绝对: ${p}`);
    assert.ok(!/^[A-Za-z]:/.test(p), `不得 drive-qualified: ${p}`);
    assert.ok(!p.startsWith('/') && !p.startsWith('\\'), `不得前导斜杠: ${p}`);
  }
});

test('B1-helper: fail closed（dir 在 out-dir 外且跨盘，两种相对都不可表达）→ null', () => {
  const r = machineArtifacts('E:\\elsewhere\\123', {
    cwd: 'C:\\a',
    outDirRoot: 'D:\\b',
    pathImpl: win32,
  });
  assert.equal(r, null, 'fail closed：绝不输出绝对路径');
});

test('B1-helper: 同盘（native path，同盘基准）→ base 缺席、相对路径', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-b1-native-'));
  try {
    const cwd = path.join(base, 'cwd');
    const outDirRoot = path.join(cwd, 'out');
    const dir = path.join(outDirRoot, '123');
    fs.mkdirSync(dir, { recursive: true });
    // 全部在同一盘（tmpBase 内）→ 同盘语义；cwd 显式传 tmpBase 下目录
    const r = machineArtifacts(dir, { cwd, outDirRoot });
    assert.ok(r);
    assert.equal(r.base, undefined, '同盘不得发射 artifacts.base');
    assert.ok(!path.isAbsolute(r.json), 'json 应为相对路径');
    assert.ok(!path.isAbsolute(r.markdown) && !path.isAbsolute(r.progress));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ===== CLI 集成（stub fetch，不联网） =====

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

const STUB = `
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/answers?')) {
    return new Response(JSON.stringify({ data: [{ id: 'a1', content: '<p>x</p>' }], paging: { is_end: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ id: u.match(/questions\\/(\\d+)/)?.[1] ?? '0', title: 'T', answer_count: 1, detail: '', topics: [] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};
`;

/** 跑 grab --json 子进程；cwd = 本仓库（repo），out-dir = 调用方传入 */
function runGrabCli({ outDir }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-b1-cli-'));
  const stubFile = path.join(dir, 'stub-fetch.mjs');
  fs.writeFileSync(stubFile, STUB, 'utf8');
  const r = spawnSync(process.execPath, [
    '--import', pathToFileURL(stubFile).href,
    CLI, 'grab', '123', '--json', '--out-dir', outDir,
  ], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...process.env, PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake; d_c0=fake' },
    timeout: 30_000,
  });
  return { r, dir };
}

test('B1-cli: 真实 out-dir（tmpdir）→ 机器 JSON 无绝对路径；Windows 跨盘时 base="outdir" + 相对 out-dir', () => {
  const outBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-b1-out-'));
  const outDir = path.join(outBase, 'capture');
  fs.mkdirSync(outDir, { recursive: true });
  const { r, dir } = runGrabCli({ outDir });
  try {
    assert.equal(r.status, 0, `grab 应成功: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    const a = parsed.artifacts;
    assert.ok(a, '应含 artifacts');
    const crossVolume = process.platform === 'win32'
      && path.parse(process.cwd()).root !== path.parse(os.tmpdir()).root;
    for (const key of ['json', 'markdown', 'progress']) {
      assert.ok(!path.isAbsolute(a[key]), `artifacts.${key} 不得绝对: ${a[key]}`);
      assert.ok(!/^[A-Za-z]:/.test(a[key]), `artifacts.${key} 不得 drive-qualified: ${a[key]}`);
    }
    if (crossVolume) {
      assert.equal(a.base, 'outdir', 'Windows 跨盘 → base="outdir"');
      assert.equal(a.json, '123/answers.json', '跨盘路径相对 effective out-dir');
      assert.equal(a.markdown, '123/answers.md');
      assert.equal(a.progress, '123/.progress.json');
    } else {
      assert.equal(a.base, undefined, '同盘不得发射 artifacts.base');
    }
    assert.ok(!r.stdout.includes(os.tmpdir()), 'stdout 不得含 tmpdir 绝对路径');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outBase, { recursive: true, force: true });
  }
});

test('B1-batch: 跨盘语义传播到 succeeded[].artifacts（顺序/失败语义不变）', () => {
  const outBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-b1-batch-out-'));
  const outDir = path.join(outBase, 'capture');
  fs.mkdirSync(outDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-b1-batch-'));
  const stubFile = path.join(work, 'stub-fetch.mjs');
  const listFile = path.join(work, 'list.txt');
  fs.writeFileSync(stubFile, STUB, 'utf8');
  fs.writeFileSync(listFile, '123\n456\n', 'utf8');
  try {
    const r = spawnSync(process.execPath, [
      '--import', pathToFileURL(stubFile).href,
      CLI, 'batch', listFile, '--json', '--out-dir', outDir,
    ], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, PATH: process.env.PATH, ZHIHU_COOKIE: 'z_c0=fake; d_c0=fake' },
      timeout: 60_000,
    });
    assert.equal(r.status, 0, `batch 应成功: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.succeeded.map((s) => s.questionId), ['123', '456'], '顺序保持');
    const crossVolume = process.platform === 'win32'
      && path.parse(process.cwd()).root !== path.parse(os.tmpdir()).root;
    for (const s of parsed.succeeded) {
      assert.ok(!path.isAbsolute(s.artifacts.json), 'batch artifacts.json 不得绝对');
      if (crossVolume) {
        assert.equal(s.artifacts.base, 'outdir', 'batch 跨盘 → base="outdir"');
        assert.equal(s.artifacts.json, `${s.questionId}/answers.json`);
      } else {
        assert.equal(s.artifacts.base, undefined);
      }
    }
    assert.ok(!r.stdout.includes(os.tmpdir()), 'batch stdout 不得含 tmpdir 绝对路径');
  } finally {
    fs.rmSync(outBase, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

// ===== make-handoff：JSON 合同不变 + human display 无绝对路径 =====

const HANDOFF_SCRIPT = fileURLToPath(new URL('../scripts/make-handoff.mjs', import.meta.url));
const REAL_ARTIFACT = fileURLToPath(new URL('../../out/439521858', import.meta.url));

test('B1-handoff: JSON 合同不变（inputJson/inputMarkdown/verified/questionId）+ display 无绝对/跨盘路径', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-b1-handoff-'));
  const dir = path.join(base, '439521858');
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const f of ['answers.json', 'answers.md', '.progress.json']) {
      fs.copyFileSync(path.join(REAL_ARTIFACT, f), path.join(dir, f));
    }
    const r = spawnSync(process.execPath, [HANDOFF_SCRIPT, dir, '--task', 'inspect'], {
      encoding: 'utf8',
      cwd: process.cwd(),
      timeout: 30_000,
    });
    assert.equal(r.status, 0, `make-handoff 应成功: ${r.stderr}`);
    // JSON 合同不变（相对 handoff 所在目录；无 base 字段）
    const handoff = JSON.parse(fs.readFileSync(path.join(dir, 'handoff.json'), 'utf8'));
    assert.equal(handoff.inputJson, 'answers.json');
    assert.equal(handoff.inputMarkdown, 'answers.md');
    assert.equal(handoff.verified, true);
    assert.equal(handoff.questionId, '439521858');
    assert.equal(handoff.base, undefined, 'handoff.json 不得出现 artifacts.base');
    // human display 无绝对 / drive-qualified 路径
    assert.ok(r.stdout.includes('handoff.json'), 'display 应含确定性相对标识');
    assert.ok(!r.stdout.includes(os.tmpdir()), 'display 不得含 tmpdir 绝对路径');
    assert.ok(!/^[A-Za-z]:[\\/]/m.test(r.stdout), 'display 不得含 drive-qualified 路径');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
