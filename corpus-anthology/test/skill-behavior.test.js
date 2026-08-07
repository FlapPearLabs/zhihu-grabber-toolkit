import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATS = fileURLToPath(new URL('../scripts/stats.mjs', import.meta.url));
const POPULAR = fileURLToPath(new URL('../scripts/popular-sample.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILL_MD = path.join(ROOT, 'SKILL.md');

function makeAnswers(count = 6) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-stats-'));
  const qDir = path.join(dir, '123');
  fs.mkdirSync(qDir, { recursive: true });
  const answers = [];
  for (let i = 1; i <= count; i += 1) {
    answers.push({
      id: String(i),
      author: `作者${i}`,
      content: `<p>回答${i}的详细内容</p>`,
      voteupCount: i * 100,
      commentCount: i,
    });
  }
  fs.writeFileSync(path.join(qDir, 'answers.json'), JSON.stringify({ questionId: '123', questionTitle: '测试', answers }));
  return { dir, jsonFile: path.join(qDir, 'answers.json') };
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('stats: 统计文件规模', () => {
  const { jsonFile } = makeAnswers(3);
  const r = run(STATS, [jsonFile]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /字符/);
  assert.match(r.stdout, /token/);
});

test('stats: 超大单文件流式统计不崩溃', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-stats-big-'));
  const big = path.join(dir, 'big.md');
  const fd = fs.openSync(big, 'w');
  fs.writeSync(fd, '# 大文件\n');
  const chunk = 'y'.repeat(1024 * 1024);
  for (let i = 0; i < 15; i += 1) fs.writeSync(fd, chunk);
  fs.closeSync(fd);
  const r = run(STATS, [big]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /157\d{4,}/); // 约 15MB+ 字符（无千分位逗号）
});

test('popular-sample: 输出高赞样本并标注 non-digest', () => {
  const { jsonFile, dir } = makeAnswers(6);
  const out = path.join(dir, 'sample.md');
  const r = run(POPULAR, [jsonFile, '--top', '2', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(out));
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /高赞样本/);
  assert.match(text, /不代表整个语料|不代表/);
  // 只应包含 Top2
  assert.ok(text.includes('作者6') || text.includes('回答6'), '最高赞回答应出现');
});

test('SKILL.md: 不再声称 edit/full/成书 为已实现能力', () => {
  const text = fs.readFileSync(SKILL_MD, 'utf8');
  // 允许出现"不支持/未实现"的声明，但不得作为可执行模式宣传
  assert.ok(!/^\|.*\*\*edit\*\*.*排版/.test(text));
  // 必须明确标注不支持
  assert.match(text, /不支持/);
});

test('SKILL.md: popular-sample 与 digest 概念区分', () => {
  const text = fs.readFileSync(SKILL_MD, 'utf8');
  assert.match(text, /popular-sample/);
  assert.match(text, /高赞样本/);
  assert.match(text, /不能代表整个语料|不代表整个语料/);
  assert.match(text, /全覆盖/);
});

test('SKILL.md: 不得称为完整摘要/精华摘要', () => {
  const text = fs.readFileSync(SKILL_MD, 'utf8');
  // 允许"不得称为"的禁止性说明；不允许正面把 popular-sample 称为完整摘要/精华摘要
  const cleaned = text.replace(/不得称为[^。]*。+/g, '').replace(/不是 digest[^。]*。+/g, '');
  assert.ok(!/完整摘要/.test(cleaned), '不得将高赞样本正面称为完整摘要');
  assert.ok(!/精华摘要/.test(cleaned), '不得将高赞样本正面称为精华摘要');
  assert.ok(!/语料总结/.test(cleaned), '不得将高赞样本正面称为语料总结');
});

test('SKILL.md: 引用脚本全部存在', () => {
  const text = fs.readFileSync(SKILL_MD, 'utf8');
  const refs = [...text.matchAll(/scripts\/([\w-]+\.mjs)/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', r)), `SKILL 引用不存在的脚本: ${r}`);
  }
});

test('SKILL.md: 不泄漏本机路径', () => {
  const text = fs.readFileSync(SKILL_MD, 'utf8');
  assert.ok(!/[A-Za-z]:[\\/]/.test(text), '不得包含盘符路径');
  assert.ok(!text.includes(os.homedir()));
});

test('SKILL.md: 触发边界正反例文档化', () => {
  const text = fs.readFileSync(SKILL_MD, 'utf8');
  assert.match(text, /应当触发/);
  assert.match(text, /不应触发/);
});

test('references 文件齐全且 handoff schema 一致', () => {
  for (const f of ['modes.md', 'state-and-resume.md', 'evidence-schema.md', 'verification.md', 'handoff-schema.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'references', f)), `缺少 references/${f}`);
  }
  const shared = fs.existsSync(path.join(ROOT, '..', 'references', 'zhihu-corpus-handoff.schema.json'));
  assert.ok(shared, '仓库级 handoff schema 应存在');
});

test('agents/openai.yaml 存在且允许隐式调用', () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'agents', 'openai.yaml'), 'utf8');
  assert.match(yaml, /allow_implicit_invocation:\s*true/);
});
