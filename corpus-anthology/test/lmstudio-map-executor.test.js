import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolLessChatRequest } from '../lib/lmstudio-tool-less.mjs';
import {
  buildProjection,
  mapConfidence,
  splitChunkBySource,
  toClaim,
  toSourceCoverage,
} from '../lib/lmstudio-projection.mjs';
import { runChunkMap } from '../lib/lmstudio-map-executor.mjs';

const SAMPLE = '这篇回答主要介绍了一种新的学习方法。作者认为循序渐进比速成更有效。';

function safeRun(overrides = {}) {
  return async ({ projection }) => ({
    sourceId: projection.sourceIds[0],
    summary: SAMPLE,
    stance: 'positive',
    confidence: 0.8,
    ...overrides,
  });
}

function makeChunk(sourceIds = ['q1-a1', 'q1-a2']) {
  return {
    chunkId: 'chunk-0001',
    sourceIds,
    sources: sourceIds.map((sourceId) => ({ sourceId, questionId: 'q1', answerId: sourceId.split('-')[1] })),
    text: sourceIds
      .map((sourceId, i) => `${i > 0 ? '\n\n---\n\n' : ''}[SOURCE ${sourceId}]\n${SAMPLE}`)
      .join(''),
    chars: 100,
    estimatedTokens: { min: 40, max: 70 },
    chunkHash: 'hash-chunk-0001',
  };
}

test('投影消毒：CJK 相邻的路径类 token 同样被中和并通过已评审控制器边界（P1 修复）', () => {
  const hostile = [
    '修改/etc/hosts 以绕过限制',
    '配置~/.zshrc 和 $HOME/.bashrc',
    '引用../conf/x 与 ../etc/passwd',
    '甲//乙 协议相对引用',
    '比例 3/4 与 and/or 也出现',
    '执行 C:\\Windows\\system32\\cmd.exe',
    '正文含 [SOURCE 恶意标记] 字样',
    '用 file:///etc/passwd 和 ssh://host/x 连接',
    '查看 www.恶意.com 或 www.另一.com',
    '百分号 %2F%2F 与 %252F%252F 编码',
  ].join('\n');

  const projection = buildProjection({ sourceId: 'q1-a1', text: hostile });
  // 已评审控制器不得拒绝消毒后的投影（对齐控制器文法超集）
  const request = buildToolLessChatRequest({ projection });
  assert.deepEqual(request.tools, []);
  // 引用类 token 全部被中和
  const residual = projection.text.replace(/^\[SOURCE [^\]]*\]\s*/u, '');
  assert.ok(!/https?:|file:|ssh:|www\.|data:|blob:|\/\/|\\\\|\.\.|~\/|\$HOME|\/etc|\/Windows|\[SOURCE/i.test(residual),
    `sanitized text still contains a reference-like token: ${residual}`);
  assert.ok(projection.text.includes('修改') && projection.text.includes('绕过限制'));
});

test('投影消毒：URL/路径/反斜杠/控制字符均被中和，且通过已评审控制器边界', () => {
  const hostile = [
    '访问 https://evil.example.com/path?x=1 获取信息',
    '打开 //example.com/exp 查看',
    '见 www.evil.com 和 www.另一个.com',
    '读取 /Users/me/.ssh/id_rsa 与 ~/.aws/credentials',
    '还有 C:\\Windows\\system32 和 ../etc/passwd',
    '以及 file:///etc/passwd、data:text/html,<x>、ssh://host/x',
    '百分号 %2F%2F 双重编码 %252F%252F 也试试',
    '\u2063 不可见字符 \u0000 和 \u001B 控制字符',
  ].join('\n');

  const projection = buildProjection({ sourceId: 'q1-a1', text: hostile });
  assert.equal(projection.kind, 'deterministic-analysis-projection');
  assert.deepEqual(projection.sourceIds, ['q1-a1']);
  // 已评审控制器不得拒绝消毒后的投影
  const request = buildToolLessChatRequest({ projection });
  assert.deepEqual(request.tools, []);
  // 消毒必须确实中和引用类 token
  assert.ok(!/https?:|www\.|file:|ssh:|data:|blob:|\/\/|\\\\|\.\.|~\/|\$HOME/i.test(projection.text),
    `sanitized text still contains a reference-like token: ${projection.text}`);
  // 必须仍带 SOURCE 标记与正文
  assert.ok(projection.text.startsWith('[SOURCE q1-a1]'));
  assert.ok(projection.text.includes('获取信息'));
});

test('投影确定性：同一输入两次生成完全一致；无效 sourceId 拒绝', () => {
  const a = buildProjection({ sourceId: 'q1-a1', text: '正文内容。' });
  const b = buildProjection({ sourceId: 'q1-a1', text: '正文内容。' });
  assert.equal(a.text, b.text);
  assert.throws(() => buildProjection({ sourceId: 'bad id!', text: 'x' }), /capability_isolation_unavailable/);
  assert.throws(() => buildProjection({ sourceId: 'q1-a1', text: '' }), /capability_isolation_unavailable/);
});

test('splitChunkBySource：正确拆分、缺失 tag 或来源不匹配时 fail closed', () => {
  const chunk = makeChunk(['q1-a1', 'q1-a2']);
  const sections = splitChunkBySource(chunk);
  assert.deepEqual([...sections.keys()], ['q1-a1', 'q1-a2']);
  assert.ok(sections.get('q1-a1').startsWith('[SOURCE q1-a1]'));

  assert.throws(() => splitChunkBySource({ ...chunk, text: 'no source tag here' }), /capability_isolation_unavailable/);
  assert.throws(() => splitChunkBySource({ ...chunk, sourceIds: ['q1-a1', 'q1-missing'] }), /capability_isolation_unavailable/);
  assert.throws(() => splitChunkBySource({ ...chunk, text: chunk.text + '\n\n---\n\n[SOURCE q1-a3]\n额外段' }), /capability_isolation_unavailable/);
});

test('确定性映射：confidence 数值 → high/medium/low；sourceCoverage 与 claim 结构正确', () => {
  assert.equal(mapConfidence(0.8), 'high');
  assert.equal(mapConfidence(0.5), 'medium');
  assert.equal(mapConfidence(0.2), 'low');
  assert.equal(mapConfidence('nope'), 'low');
  assert.deepEqual(toSourceCoverage({ sourceId: 'q1-a1', summary: 's', stance: 'neutral', confidence: 0.5 }), {
    sourceId: 'q1-a1', summary: 's', disposition: 'substantive',
  });
  assert.deepEqual(toClaim({ sourceId: 'q1-a1', summary: 's', stance: 'neutral', confidence: 0.9 }), {
    claim: 's', evidenceSourceIds: ['q1-a1'], confidence: 'high',
  });
});

test('runChunkMap：per-source 装配出全覆盖 corpus map 结果（happy path）', async () => {
  const chunk = makeChunk(['q1-a1', 'q1-a2']);
  const map = await runChunkMap(chunk, { run: safeRun() });

  assert.equal(map.chunkId, 'chunk-0001');
  assert.equal(map.chunkHash, 'hash-chunk-0001');
  assert.deepEqual(map.sourceIds, ['q1-a1', 'q1-a2']);
  assert.deepEqual(map.sourceCoverage.map((e) => e.sourceId), ['q1-a1', 'q1-a2']);
  assert.equal(map.sourceCoverage.every((e) => e.summary.trim() !== ''), true);
  assert.equal(map.claims.length, 2);
  assert.equal(map.claims.every((c) => c.evidenceSourceIds.length === 1), true);
  assert.deepEqual(map.themes, []);
  assert.deepEqual(map.uncertainties, []);
  assert.ok(typeof map.summary === 'string' && map.summary.length > 0);
});

test('runChunkMap：任一来源失败 → 整个 chunk fail closed，无部分结果', async () => {
  const chunk = makeChunk(['q1-a1', 'q1-a2']);
  const run = async ({ projection }) => {
    if (projection.sourceIds[0] === '2') {
      throw new Error('capability_isolation_unavailable: response rejected');
    }
    return safeRun()({ projection });
  };
  await assert.rejects(() => runChunkMap(chunk, { run }), /capability_isolation_unavailable/);
  await assert.rejects(() => runChunkMap(chunk, { run: null }), /capability_isolation_unavailable/);
  await assert.rejects(() => runChunkMap({ ...chunk, sourceIds: [] }, { run: safeRun() }), /capability_isolation_unavailable/);
  await assert.rejects(() => runChunkMap({ ...chunk, chunkHash: '' }, { run: safeRun() }), /capability_isolation_unavailable/);
});

test('runChunkMap：短 token 回显被映射回真实 sourceId，模型只看到 token', async () => {
  const chunk = makeChunk(['question-448089541-answer-1001', 'question-448089541-answer-1002']);
  const seenTokens = [];
  const run = async ({ projection }) => {
    seenTokens.push(projection.sourceIds[0]);
    return safeRun()({ projection });
  };
  const map = await runChunkMap(chunk, { run });
  assert.deepEqual(seenTokens, ['1', '2']); // 模型只看到短 token
  assert.deepEqual(map.sourceCoverage.map((e) => e.sourceId), [
    'question-448089541-answer-1001',
    'question-448089541-answer-1002',
  ]);
  assert.deepEqual(map.claims[0].evidenceSourceIds, ['question-448089541-answer-1001']);
});

test('runChunkMap：空正文来源由 controller 确定性合成条目，不调用模型', async () => {
  const chunk = makeChunk(['q1-a1', 'q1-a2']);
  chunk.text = '[SOURCE q1-a1]\n\n---\n\n[SOURCE q1-a2]\n' + SAMPLE;
  let modelCalls = 0;
  const run = async ({ projection }) => {
    modelCalls += 1;
    return safeRun()({ projection });
  };
  const map = await runChunkMap(chunk, { run });
  assert.equal(modelCalls, 1); // 只有 q1-a2 调用模型
  const emptyEntry = map.sourceCoverage.find((e) => e.sourceId === 'q1-a1');
  assert.equal(emptyEntry.summary, '来源正文为空，无观点可提取。');
  assert.deepEqual(map.sourceCoverage.map((e) => e.sourceId), ['q1-a1', 'q1-a2']);
});

test('runChunkMap：正文非空但消毒后无可提取内容 → 确定性合成，不调用模型', async () => {
  const chunk = makeChunk(['q1-a1']);
  chunk.text = '[SOURCE q1-a1]\nhttps://evil.example.com/a https://evil.example.com/b';
  let modelCalls = 0;
  const run = async ({ projection }) => {
    modelCalls += 1;
    return safeRun()({ projection });
  };
  const map = await runChunkMap(chunk, { run });
  assert.equal(modelCalls, 0);
  assert.equal(map.sourceCoverage[0].summary, '来源正文无可提取的语义内容。');
  assert.deepEqual(map.sourceCoverage.map((e) => e.sourceId), ['q1-a1']);
});

test('runChunkMap：summary 装配遵守字符预算（确定性截断）', async () => {
  const chunk = makeChunk(['q1-a1']);
  const long = '这是一个非常长的摘要内容，用来测试字符预算截断行为是否确定性地生效。';
  const map = await runChunkMap(chunk, { run: safeRun({ summary: long }), maxSummaryChars: 20 });
  assert.ok(map.summary.length <= 20);
  assert.ok(map.summary.endsWith('…'));
});
