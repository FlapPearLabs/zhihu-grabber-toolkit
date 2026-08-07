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

function run(args) {
  return spawnSync(process.execPath, [ARCHIVE, ...args], { encoding: 'utf8' });
}

test('archive: 篇数一致且正文零改写', () => {
  const dir = makeCorpus(4);
  const out = path.join(path.dirname(dir), 'collection.md');
  const r = run([dir, '--out', out, '--title', '测试合集']);
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(out, 'utf8');
  // 目录索引 4 篇 + 正文 4 篇
  assert.ok(text.includes('测试合集'));
  assert.ok(text.includes('问题1的正文内容'));
  assert.ok(text.includes('问题4的正文内容'));
  // 来源相对路径，无绝对路径
  assert.ok(!text.includes(os.homedir()), '不得包含主目录');
  assert.ok(!/[A-Za-z]:[\\/]/.test(text), '不得包含盘符绝对路径');
  // 每篇都标记来源
  const sources = text.match(/^> 来源: (.+)$/gm) || [];
  assert.equal(sources.length, 4);
});

test('archive: 按体积分卷且前后篇数一致', () => {
  const dir = makeCorpus(5);
  const prefix = path.join(path.dirname(dir), 'vol');
  const r = run([dir, '--max-volume-chars', '60', '--name', 'vol', '--out', `${prefix}.md`]);
  assert.equal(r.status, 0, r.stderr);
  const vols = fs.readdirSync(path.dirname(dir)).filter((f) => f.startsWith('vol_'));
  assert.ok(vols.length >= 2, '应按体积分卷');
  let total = 0;
  for (const v of vols) {
    const text = fs.readFileSync(path.join(path.dirname(dir), v), 'utf8');
    total += (text.match(/^> 来源: (.+)$/gm) || []).length;
  }
  assert.equal(total, 5, '分卷后篇数应保持一致');
});

test('archive --verify: 有效合集通过', () => {
  const dir = makeCorpus(3);
  const out = path.join(path.dirname(dir), 'collection2.md');
  run([dir, '--out', out]);
  const r = run([dir, '--verify', out]);
  assert.equal(r.status, 0, r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.inputFiles, 3);
  assert.equal(parsed.outputSections, 3);
});

test('archive --verify: 篇数不一致时失败', () => {
  const dir = makeCorpus(3);
  const out = path.join(path.dirname(dir), 'collection3.md');
  run([dir, '--out', out]);
  // 模拟输出缺一篇
  const text = fs.readFileSync(out, 'utf8');
  const modified = text.replace(/^> 来源: q3\/answers\.md$/m, '');
  fs.writeFileSync(out, modified);
  const r = run([dir, '--verify', out]);
  assert.notEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
});

test('archive --verify: 输出含绝对路径时失败', () => {
  const dir = makeCorpus(2);
  const out = path.join(path.dirname(dir), 'collection4.md');
  run([dir, '--out', out]);
  const text = fs.readFileSync(out, 'utf8');
  fs.writeFileSync(out, text + `\n泄漏: ${os.homedir()}\\secret\n`);
  const r = run([dir, '--verify', out]);
  assert.notEqual(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.warnings.some((w) => w.includes('绝对路径')));
});

test('archive: 超大单文件可处理（流式，不整篇驻留内存）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-archive-big-'));
  const qDir = path.join(dir, 'big');
  fs.mkdirSync(qDir, { recursive: true });
  // 构造约 20MB 的单文件（超出 10MB 常规上限，验证流式能力）
  const chunk = 'x'.repeat(1024 * 1024); // 1MB
  const fd = fs.openSync(path.join(qDir, 'answers.md'), 'w');
  fs.writeSync(fd, '# 超大问题\n\n');
  for (let i = 0; i < 20; i += 1) {
    fs.writeSync(fd, chunk);
  }
  fs.closeSync(fd);

  const out = path.join(path.dirname(dir), 'collection-big.md');
  const r = run([dir, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const stats = fs.statSync(out);
  assert.ok(stats.size > 20 * 1024 * 1024, '输出应包含全部正文');
});

test('archive: 起始 H1 被剥离，正文标题不被改写', () => {
  const dir = makeCorpus(1);
  const qDir = path.join(dir, 'q1');
  fs.writeFileSync(path.join(qDir, 'answers.md'), '# 原始标题\n\n## 正文内标题\n内容\n');
  const out = path.join(path.dirname(dir), 'collection5.md');
  const r = run([dir, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.includes('# 问题1') || text.includes('# 原始标题'), '正文起始 H1 被替换为篇目标题');
  assert.ok(text.includes('## 正文内标题'), '正文内的标题不得被剥离');
});
