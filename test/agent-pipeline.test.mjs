import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 仓库级 CLI × Skill 契约 / pipeline 集成测试（不联网，全部用 fixture）。
 *
 * 正向链路（必须闭环）:
 *   preflight --json（机器契约）
 *   → captured fixture（verify-output valid=true）
 *   → make-handoff → corpus verify --handoff
 *   → stats → chunk → map fixture → verify --work → reduce → final.json → verify --final
 *
 * 负向:
 *   A. .progress.done=true 但 answers.md/json 不一致 → verify FAIL + make-handoff FAIL
 *   B. answers.json 损坏 → status 不报告 verified 且不崩溃
 *   C. CLI --json stdout 纯净可 JSON.parse
 */

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ZHIHU_SCRIPTS = path.join(REPO, 'zhihu-answer-grabber', 'scripts');
const CORPUS_SCRIPTS = path.join(REPO, 'corpus-anthology', 'scripts');
const CLI = path.join(REPO, 'zhihu-answer-grabber', 'src', 'cli.js');

function run(node, script, args = [], opts = {}) {
  return spawnSync(node, [script, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || REPO,
    env: { ...process.env, ...(opts.env || {}) },
    timeout: 60_000,
  });
}

function makeQuestionFixture(outRoot, { consistent = true, progressDone = true, corruptJson = false, rawArray = false } = {}) {
  const outDir = path.join(outRoot, 'out', '123');
  fs.mkdirSync(outDir, { recursive: true });
  const json = {
    questionId: '123',
    questionTitle: '测试问题',
    answerCount: 3,
    answers: [
      { id: '1', author: '甲', content: '<p>回答一内容</p>', voteupCount: 99, commentCount: 2 },
      { id: '2', author: '乙', content: '<p>回答二内容</p>', voteupCount: 50, commentCount: 1 },
      { id: '3', author: '丙', content: '<p>回答三内容</p>', voteupCount: 10, commentCount: 0 },
    ],
  };
  if (corruptJson) {
    fs.writeFileSync(path.join(outDir, 'answers.json'), '{broken json!!');
  } else if (rawArray) {
    // 历史 raw-array 形态（legacy），无 questionId 元信息
    fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify(json.answers));
  } else {
    fs.writeFileSync(path.join(outDir, 'answers.json'), JSON.stringify(json));
  }
  const mdLines = ['# 测试问题', '', '> 问题链接: https://www.zhihu.com/question/123', ''];
  const count = consistent ? 3 : 1; // 负向 A：md 只写 1 条
  for (let i = 0; i < count; i += 1) {
    mdLines.push(`## ${i + 1}. ${['甲', '乙', '丙'][i]} — ${[99, 50, 10][i]} 赞`, `回答${['一', '二', '三'][i]}内容`, '');
  }
  fs.writeFileSync(path.join(outDir, 'answers.md'), mdLines.join('\n'));
  fs.writeFileSync(path.join(outDir, '.progress.json'), JSON.stringify({ offset: 60, done: progressDone }));
  return outDir;
}

const NODE = process.execPath;

test('正向：CLI verify → handoff → corpus verify 闭环', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pipe-happy-'));
  const outDir = makeQuestionFixture(tmp);

  // 1. verify-output → PASS
  const v = run(NODE, path.join(ZHIHU_SCRIPTS, 'verify-output.mjs'), [outDir]);
  assert.equal(v.status, 0, v.stdout);
  const vp = JSON.parse(v.stdout);
  assert.equal(vp.valid, true);

  // 2. make-handoff → 生成 verified=true
  const h = run(NODE, path.join(ZHIHU_SCRIPTS, 'make-handoff.mjs'), [outDir, '--task', 'digest']);
  assert.equal(h.status, 0, h.stderr);
  const handoff = JSON.parse(fs.readFileSync(path.join(outDir, 'handoff.json'), 'utf8'));
  assert.equal(handoff.verified, true);
  assert.equal(handoff.questionId, '123');
  assert.equal(handoff.answerCount, 3);

  // 3. corpus verify --handoff → PASS（upstream handoff 被 downstream 接受）
  const cv = run(NODE, path.join(CORPUS_SCRIPTS, 'verify.mjs'), ['--handoff', path.join(outDir, 'handoff.json'), '--source-root', outDir]);
  assert.equal(cv.status, 0, cv.stdout);
  assert.equal(JSON.parse(cv.stdout).valid, true);

  // 4. stats → PASS
  const s = run(NODE, path.join(CORPUS_SCRIPTS, 'stats.mjs'), [path.join(outDir, 'answers.md')]);
  assert.equal(s.status, 0, s.stdout);

  // 5. chunk → manifest + chunks
  const work = path.join(tmp, 'work');
  const c = run(NODE, path.join(CORPUS_SCRIPTS, 'chunk.mjs'), [path.join(outDir, 'answers.json'), '--work', work, '--mode', 'digest', '--max-answers', '40']);
  assert.equal(c.status, 0, c.stdout + c.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.inputs) && manifest.inputs.length > 0, 'manifest 必须有 inputs');
  const chunks = fs.readdirSync(path.join(work, 'chunks')).filter((f) => f.endsWith('.json'));
  assert.ok(chunks.length > 0, 'chunk 文件必须生成');

  // 6. 构造合法 map 结果（模拟 LLM map 输出，回传 chunkHash + sourceCoverage 全覆盖）
  const mapDir = path.join(work, 'map-results');
  fs.mkdirSync(mapDir, { recursive: true });
  for (const cf of chunks) {
    const chunk = JSON.parse(fs.readFileSync(path.join(work, 'chunks', cf), 'utf8'));
    const map = {
      chunkId: chunk.chunkId,
      chunkHash: chunk.chunkHash,
      sourceIds: chunk.sourceIds,
      summary: '本块回答的覆盖摘要：主要观点为测试内容。',
      claims: [
        { claim: '回答一提出核心观点。', evidenceSourceIds: [chunk.sourceIds[0]], confidence: 'high' },
      ],
      sourceCoverage: chunk.sourceIds.map((sid, i) => ({
        sourceId: sid,
        summary: `来源 ${i + 1} 的处理记录：已阅读并纳入摘要。`,
        disposition: 'substantive',
      })),
      themes: ['测试'],
      uncertainties: [],
    };
    fs.writeFileSync(path.join(mapDir, `map-${chunk.chunkId}.json`), JSON.stringify(map, null, 2));
  }

  // 7. verify --work → PASS
  const wv = run(NODE, path.join(CORPUS_SCRIPTS, 'verify.mjs'), ['--work', work]);
  assert.equal(wv.status, 0, wv.stdout);
  assert.equal(JSON.parse(wv.stdout).valid, true);

  // 8. reduce → final.json
  const rd = run(NODE, path.join(CORPUS_SCRIPTS, 'reduce.mjs'), ['--work', work, '--out', path.join(work, 'final', 'digest.md')]);
  assert.equal(rd.status, 0, rd.stdout + rd.stderr);
  const finalFile = path.join(work, 'final', 'final.json');
  assert.ok(fs.existsSync(finalFile), 'reduce 必须产出 final.json');

  // 9. verify --final → PASS
  const fv = run(NODE, path.join(CORPUS_SCRIPTS, 'verify.mjs'), ['--work', work, '--final', finalFile]);
  assert.equal(fv.status, 0, fv.stdout);
  assert.equal(JSON.parse(fv.stdout).valid, true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('负向 A：progress.done=true 但 md/json 不一致 → verify FAIL + make-handoff FAIL，无 verified handoff', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pipe-negA-'));
  const outDir = makeQuestionFixture(tmp, { consistent: false, progressDone: true });
  const v = run(NODE, path.join(ZHIHU_SCRIPTS, 'verify-output.mjs'), [outDir]);
  assert.notEqual(v.status, 0, '不一致产物 verify 必须失败');
  assert.equal(JSON.parse(v.stdout).valid, false);
  const h = run(NODE, path.join(ZHIHU_SCRIPTS, 'make-handoff.mjs'), [outDir, '--task', 'digest']);
  assert.notEqual(h.status, 0, '未通过 verify 时 make-handoff 必须失败');
  assert.ok(!fs.existsSync(path.join(outDir, 'handoff.json')), '不得生成 verified=true handoff');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('负向 B：answers.json 损坏 → status 不报告 verified 且不崩溃', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pipe-negB-'));
  const outDir = makeQuestionFixture(tmp, { corruptJson: true, progressDone: true });
  const r = run(NODE, CLI, ['status', '--json', '--out-dir', path.join(tmp, 'out')], { env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, 'status 不应因损坏目录崩溃');
  const parsed = JSON.parse(r.stdout);
  const item = parsed.items.find((i) => i.questionId === '123');
  assert.ok(item, '损坏目录也应出现在 items');
  assert.notEqual(item.verificationStatus, 'valid', '损坏产物不得报告为 verified');
  assert.equal(item.verificationStatus, 'invalid');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('负向 C：CLI --json stdout 纯净（可 JSON.parse，无人类日志/ANSI）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pipe-negC-'));
  const outDir = makeQuestionFixture(tmp);
  const r = run(NODE, CLI, ['status', '--json', '--out-dir', path.join(tmp, 'out')], { env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout); // 混入人类日志会抛错
  assert.equal(parsed.command, 'status');
  assert.ok(!r.stdout.includes('已抓取'), 'stdout 不得含人类日志');
  assert.ok(!r.stdout.includes('\u001b'), 'stdout 不得含 ANSI 控制字符');
  assert.equal(r.stdout.trim().split('\n').length, 1, 'stdout 必须恰好一个 JSON 文档');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Fix6: legacy raw-array 不能升级为 verified handoff（upstream→downstream 反例闭环）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pipe-rawarray-'));
  const outDir = makeQuestionFixture(tmp, { rawArray: true, progressDone: true });

  // 1. upstream verify：raw-array 缺 questionId → 必须失败
  const v = run(NODE, path.join(ZHIHU_SCRIPTS, 'verify-output.mjs'), [outDir]);
  assert.notEqual(v.status, 0, 'raw-array 不得通过 verify');
  assert.equal(JSON.parse(v.stdout).valid, false);
  assert.ok(JSON.parse(v.stdout).warnings.some((w) => w.includes('raw-array')));

  // 2. upstream make-handoff：未通过 verify → 拒绝生成，不得产出 verified handoff
  const h = run(NODE, path.join(ZHIHU_SCRIPTS, 'make-handoff.mjs'), [outDir, '--task', 'digest']);
  assert.notEqual(h.status, 0, 'raw-array 不得生成 handoff');
  assert.ok(!fs.existsSync(path.join(outDir, 'handoff.json')), '不得生成 verified=true handoff');

  // 3. 即便手工伪造一个指向 raw-array 的 handoff，downstream corpus verify --handoff 也必须拒绝
  //    （contract 缝隙：downstream 要求 answers.json.questionId，raw-array 没有 → 必须失败）
  fs.writeFileSync(path.join(outDir, 'handoff.json'), JSON.stringify({
    task: 'digest',
    sourceType: 'zhihu-answers',
    questionId: '123',
    inputJson: 'answers.json',
    inputMarkdown: 'answers.md',
    verified: true,
    answerCount: 3,
    warnings: [],
  }));
  const cv = run(NODE, path.join(CORPUS_SCRIPTS, 'verify.mjs'), ['--handoff', path.join(outDir, 'handoff.json'), '--source-root', outDir]);
  assert.notEqual(cv.status, 0, 'downstream 必须拒绝 raw-array handoff');
  const cvp = JSON.parse(cv.stdout);
  assert.ok(cvp.issues.some((i) => i.includes('questionId')), `downstream 应指出缺 questionId: ${cvp.issues.join('; ')}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('preflight --json 机器契约：合法 JSON、无凭据泄漏', () => {
  const r = run(NODE, path.join(ZHIHU_SCRIPTS, 'preflight.mjs'), ['--json'], { env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.schemaVersion, 1);
  assert.ok('cookie' in parsed && 'secret' in parsed, '必须含 cookie/secret 对象');
  assert.ok(typeof parsed.cookie.configured === 'boolean');
  assert.ok(typeof parsed.cookie.usable === 'boolean');
  assert.ok(typeof parsed.secret.usable === 'boolean');
  assert.ok(!r.stdout.includes('z_c0='), '不得输出凭据值');
  assert.ok(!r.stdout.includes('Bearer'), '不得输出 token 前缀');
});
