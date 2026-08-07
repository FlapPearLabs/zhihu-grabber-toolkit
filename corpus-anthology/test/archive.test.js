import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARCHIVE = fileURLToPath(new URL('../scripts/archive.mjs', import.meta.url));

function makeCorpus(count = 4) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-archive-'));
  for (let i = 1; i <= count; i += 1) {
    const qDir = path.join(dir, `q${i}`);
    fs.mkdirSync(qDir, { recursive: true });
    fs.writeFileSync(path.join(qDir, 'answers.md'), `# 问题${i}\n\n问题${i}的正文内容，用于测试。\n`);
  }
  return dir;
}

/** 输出目录：放回语料目录内部的 out/，避免污染 os.tmpdir 根（跨测试隔离） */
function outDirFor(dir) {
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  return out;
}

function run(args) {
  return spawnSync(process.execPath, [ARCHIVE, ...args], { encoding: 'utf8' });
}

test('archive: 篇数一致且正文零改写', () => {
  const dir = makeCorpus(4);
  const out = path.join(outDirFor(dir), 'collection.md');
  const r = run([dir, '--out', out, '--title', '测试合集']);
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.includes('测试合集'));
  assert.ok(text.includes('问题1的正文内容'));
  assert.ok(text.includes('问题4的正文内容'));
  // 来源相对路径，无绝对路径
  assert.ok(!text.includes(os.homedir()), '不得包含主目录');
  assert.ok(!/[A-Za-z]:[\\/]/.test(text), '不得包含盘符绝对路径');
  assert.ok(!/^\/(?:Users|home|tmp|private)\//m.test(text), '不得包含 POSIX 绝对路径');
  const sources = text.match(/^> 来源: (.+)$/gm) || [];
  assert.equal(sources.length, 4);
  // sidecar manifest 生成
  assert.ok(fs.existsSync(`${out}.manifest.json`), '应生成 sidecar manifest');
});

test('archive: 按体积分卷且前后篇数一致', () => {
  const dir = makeCorpus(5);
  const prefix = path.join(outDirFor(dir), 'vol');
  const r = run([dir, '--max-volume-chars', '60', '--name', 'vol', '--out', `${prefix}.md`]);
  assert.equal(r.status, 0, r.stderr);
  const vols = fs.readdirSync(outDirFor(dir)).filter((f) => f.startsWith('vol_'));
  assert.ok(vols.length >= 2, '应按体积分卷');
  let total = 0;
  for (const v of vols) {
    const text = fs.readFileSync(path.join(outDirFor(dir), v), 'utf8');
    total += (text.match(/^> 来源: (.+)$/gm) || []).length;
  }
  assert.equal(total, 5, '分卷后篇数应保持一致');
});

test('archive --verify: 有效合集通过（正文 sha256 一致）', () => {
  const dir = makeCorpus(3);
  const out = path.join(outDirFor(dir), 'collection2.md');
  run([dir, '--out', out]);
  const r = run([dir, '--verify', out]);
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.inputFiles, 3);
  assert.equal(parsed.outputSections, 3);
  assert.ok(parsed.bodyHashesChecked >= 3, '应逐篇核验正文 sha256');
});

test('archive --verify: 正文被篡改但来源 marker 保留 → 失败（P1-5）', () => {
  const dir = makeCorpus(3);
  const out = path.join(outDirFor(dir), 'collection3.md');
  run([dir, '--out', out]);
  // 保留 "> 来源: q1/answers.md" 标记，但篡改正文
  const text = fs.readFileSync(out, 'utf8');
  const modified = text.replace('问题1的正文内容', '被恶意篡改的内容');
  fs.writeFileSync(out, modified);
  const r = run([dir, '--verify', out]);
  assert.notEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('sha256')), '应检测到正文哈希不一致');
});

test('archive --verify: 篇数不一致时失败', () => {
  const dir = makeCorpus(3);
  const out = path.join(outDirFor(dir), 'collection4.md');
  run([dir, '--out', out]);
  const text = fs.readFileSync(out, 'utf8');
  const modified = text.replace(/^> 来源: q3\/answers\.md$/m, '');
  fs.writeFileSync(out, modified);
  const r = run([dir, '--verify', out]);
  assert.notEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
});

test('archive --verify: 输出含绝对路径时失败（跨平台）', () => {
  const dir = makeCorpus(2);
  const out = path.join(outDirFor(dir), 'collection5.md');
  run([dir, '--out', out]);
  const text = fs.readFileSync(out, 'utf8');
  // Windows 风格 + POSIX 风格都测试
  const absLeak = process.platform === 'win32'
    ? `泄漏: C:\\Users\\someone\\secret`
    : `泄漏: /home/someone/secret`;
  fs.writeFileSync(out, text + `\n${absLeak}\n`);
  const r = run([dir, '--verify', out]);
  assert.notEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('绝对路径')));
});

test('archive: UTF-8 多字节字符跨 64KB 边界不损坏（P1-7）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-archive-utf8-'));
  const qDir = path.join(dir, 'utf8');
  fs.mkdirSync(qDir, { recursive: true });
  // 构造：标题 + 64KB-10 个 ASCII + 一串中文，让中文字符正好跨 64KB 边界
  const pad = 'a'.repeat(64 * 1024 - 20);
  const chinese = '这是一个中文测试。'.repeat(500);
  fs.writeFileSync(path.join(qDir, 'answers.md'), `# UTF8 测试\n\n${pad}${chinese}\n`);

  const out = path.join(outDirFor(dir), 'collection-utf8.md');
  const r = run([dir, '--out', out]);
  assert.equal(r.status, 0, r.stderr);

  // 读取输出，验证中文没有被替换字符（�）损坏
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(!text.includes('\uFFFD'), '输出不得包含 UTF-8 替换字符 �');
  assert.ok(text.includes('这是一个中文测试'), '中文应完整保留');

  // verify 必须通过（body sha256 一致）
  const v = run([dir, '--verify', out]);
  assert.equal(v.status, 0, v.stdout);
});

test('archive: 超大单文件可处理（流式，不整篇驻留内存）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-archive-big-'));
  const qDir = path.join(dir, 'big');
  fs.mkdirSync(qDir, { recursive: true });
  const chunk = 'x'.repeat(1024 * 1024); // 1MB
  const fd = fs.openSync(path.join(qDir, 'answers.md'), 'w');
  fs.writeSync(fd, '# 超大问题\n\n');
  for (let i = 0; i < 20; i += 1) {
    fs.writeSync(fd, chunk);
  }
  fs.closeSync(fd);

  const out = path.join(outDirFor(dir), 'collection-big.md');
  const r = run([dir, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const stats = fs.statSync(out);
  assert.ok(stats.size > 20 * 1024 * 1024, '输出应包含全部正文');
  // 大文件 verify 也应通过
  const v = run([dir, '--verify', out]);
  assert.equal(v.status, 0, v.stdout);
});

test('archive: 起始 H1 被剥离，正文标题不被改写', () => {
  const dir = makeCorpus(1);
  const qDir = path.join(dir, 'q1');
  fs.writeFileSync(path.join(qDir, 'answers.md'), '# 原始标题\n\n## 正文内标题\n内容\n');
  const out = path.join(outDirFor(dir), 'collection6.md');
  const r = run([dir, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.includes('# 问题1') || text.includes('# 原始标题'), '正文起始 H1 被替换为篇目标题');
  assert.ok(text.includes('## 正文内标题'), '正文内的标题不得被剥离');
});

test('archive: 分卷 manifest 记录 volumes（P1-6）', () => {
  const dir = makeCorpus(5);
  const prefix = path.join(outDirFor(dir), 'volman');
  const r = run([dir, '--max-volume-chars', '60', '--name', 'volman', '--out', `${prefix}.md`]);
  assert.equal(r.status, 0, r.stderr);
  const manifestFile = path.join(outDirFor(dir), 'volman.manifest.json');
  assert.ok(fs.existsSync(manifestFile), '分卷应生成 manifest');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.ok(Array.isArray(manifest.volumes) && manifest.volumes.length >= 2, 'manifest 应记录多卷');
  const totalSources = manifest.volumes.reduce((s, v) => s + v.sources.length, 0);
  assert.equal(totalSources, 5, '分卷 manifest 来源总数应等于输入篇数');
  // 每卷文件存在
  for (const v of manifest.volumes) {
    assert.ok(fs.existsSync(v.file), `卷文件应存在: ${v.file}`);
  }
});
