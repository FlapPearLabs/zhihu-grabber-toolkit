// SPDX-License-Identifier: MIT
/**
 * top-percent-selector — T7 批准合同确定性选择器测试（T8, Issue #14）。
 * 覆盖 Issue #14 Required tests 的 11 项要求（纯函数层）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualCoveragePercentString,
  buildSelection,
  canonicalDecimalAnswerId,
  compareDecimalAnswerId,
  computeIsFullCoverage,
  parsePercent,
  SELECTION_RULE_PATTERN,
  selectionRuleFor,
  selectTopPercent,
  validateSelection,
} from '../lib/top-percent-selector.mjs';

/** 造 N 条候选：voteupCount 递减（i 越大 vote 越小），answerId 升序 */
function makeCandidates(n, { vote = (i) => n * 10 - i * 10, ids = (i) => String(i) } = {}) {
  return Array.from({ length: n }, (_, idx) => {
    const i = idx + 1;
    return { sourceId: `question-q-answer-${i}`, answerId: ids(i), voteupCount: vote(i) };
  });
}

// ---------- Issue #14 required test 1: lower-bound percent ----------
test('T1 下界百分比：N=200, X=1 → K=max(1,ceil(2))=2（minimum 1 且 ceil）', () => {
  const cands = makeCandidates(200);
  const { selectedIds, k } = selectTopPercent(cands, 1);
  assert.equal(k, 2);
  assert.equal(selectedIds.length, 2);
  assert.deepEqual(selectedIds, ['question-q-answer-1', 'question-q-answer-2']);
});

test('T1b 极小语料 minimum 1：N=3, X=1 → K=1', () => {
  const cands = makeCandidates(3);
  const { selectedIds, k } = selectTopPercent(cands, 1);
  assert.equal(k, 1);
  assert.equal(selectedIds.length, 1);
});

// ---------- Issue #14 required test 2: ordinary percent on odd corpus ----------
test('T2 奇数规模常规百分比：N=101, X=10 → K=ceil(10.1)=11', () => {
  const cands = makeCandidates(101);
  const { selectedIds, k } = selectTopPercent(cands, 10);
  assert.equal(k, 11);
  assert.equal(selectedIds.length, 11);
  // 前 11 个最高 vote 的 sourceId
  assert.deepEqual(selectedIds, Array.from({ length: 11 }, (_, i) => `question-q-answer-${i + 1}`));
});

// ---------- Issue #14 required test 3: boundary vote ties ----------
test('T3 边界同赞 strict count：N=10, X=30 → K=3，tie 组不扩展，按 decimal answerId ASC 取剩余名额', () => {
  // votes: 100a,100b,90c,90d,90e,50f,50g,50h,50i,10j
  const cands = [
    { sourceId: 'a', answerId: '10', voteupCount: 100 },
    { sourceId: 'b', answerId: '20', voteupCount: 100 },
    { sourceId: 'c', answerId: '30', voteupCount: 90 },
    { sourceId: 'd', answerId: '40', voteupCount: 90 },
    { sourceId: 'e', answerId: '50', voteupCount: 90 },
    { sourceId: 'f', answerId: '60', voteupCount: 50 },
    { sourceId: 'g', answerId: '70', voteupCount: 50 },
    { sourceId: 'h', answerId: '80', voteupCount: 50 },
    { sourceId: 'i', answerId: '90', voteupCount: 50 },
    { sourceId: 'j', answerId: '100', voteupCount: 10 },
  ];
  const { selectedIds, k } = selectTopPercent(cands, 30);
  assert.equal(k, 3);
  assert.equal(selectedIds.length, 3); // STRICT：恰好 3，无 tie 扩展
  assert.deepEqual(selectedIds, ['a', 'b', 'c']); // 90 组内按 answerId ASC 取首个
});

// ---------- Issue #14 required test 4: deterministic repeated selection ----------
test('T4 确定性重复选择：同输入同 X 两次选择结果逐字节一致（含 selectorHash）', () => {
  const cands = makeCandidates(37, { vote: (i) => (i * 7919) % 101 }); // 伪随机 vote，制造大量 tie
  const s1 = buildSelection(cands, 25);
  const s2 = buildSelection(cands, 25);
  assert.deepEqual(s1, s2);
  assert.equal(s1.selectorHash, s2.selectorHash);
  // selectionRule 可机器解析
  assert.match(s1.selectionRule, SELECTION_RULE_PATTERN);
});

// ---------- Issue #14 required test 5: missing/zero/duplicate vote metadata ----------
test('T5 缺失/零/重复 vote 元数据：缺失按 0；零值参与排序；重复 vote 由 answerId ASC 决胜', () => {
  const cands = [
    { sourceId: 'z1', answerId: '1', voteupCount: undefined }, // 缺失 → 0
    { sourceId: 'z2', answerId: '2', voteupCount: 0 },          // 显式 0
    { sourceId: 'm1', answerId: '3', voteupCount: 50 },
    { sourceId: 'm2', answerId: '4', voteupCount: 50 },         // 与 m1 重复 vote
    { sourceId: 't1', answerId: '5', voteupCount: 100 },
  ];
  const { selectedIds } = selectTopPercent(cands, 100);
  // 全选时顺序：100(t1) → 50(m1,m2 按 answerId asc → m1) → 0(z1,z2 按 answerId asc → z1)
  assert.deepEqual(selectedIds, ['t1', 'm1', 'm2', 'z1', 'z2']);
});

// ---------- Issue #14 required test 6: X=100 ----------
test('T6 X=100：全选；selectionRule 仍是 top-100-pct-*；selected==original → isFullCoverage 覆盖事实', () => {
  const cands = makeCandidates(500);
  const selection = buildSelection(cands, 100);
  assert.equal(selection.selectedSourceIds.length, 500);
  assert.equal(selection.originalTotal, 500);
  assert.equal(selection.selectionRule, 'top-100-pct-voteup-desc-answerid-dec-asc-strict');
  assert.equal(computeIsFullCoverage(selection.selectedSourceIds, cands.map((c) => c.sourceId)), true);
  // identity 是 sampled（模式身份由 reduce 层 final.json.mode 保证，见集成测试）
  assert.notEqual(selection.selectionRule.includes('digest'), true);
});

// ---------- Issue #14 required test 7: coverage/disclosure output ----------
test('T7 覆盖率/披露：N=3, X=10 → K=1, actualCoveragePercent="33.3", isFullCoverage=false, 字段齐全', () => {
  const cands = makeCandidates(3);
  const selection = buildSelection(cands, 10);
  assert.deepEqual(
    Object.keys(selection).sort(),
    ['originalTotal', 'requestedPercent', 'schemaVersion', 'selectedSourceIds', 'selectionRule', 'selectorHash'].sort(),
  );
  assert.equal(selection.requestedPercent, 10);
  assert.equal(selection.originalTotal, 3);
  assert.equal(selection.selectedSourceIds.length, 1);
  assert.equal(actualCoveragePercentString(selection.selectedSourceIds, cands.map((c) => c.sourceId)), '33.3');
  assert.equal(computeIsFullCoverage(selection.selectedSourceIds, cands.map((c) => c.sourceId)), false);
});

// ---------- Issue #14 required test 8: selected source-ID integrity ----------
test('T8 选中 source-ID 完整性：全部来自原集、无重复、数量 == K、顺序 == 排序后前 K', () => {
  const cands = makeCandidates(50);
  const { selectedIds, k, ordered } = selectTopPercent(cands, 20);
  const original = new Set(cands.map((c) => c.sourceId));
  assert.equal(selectedIds.length, k);
  assert.equal(new Set(selectedIds).size, k); // 无重复
  for (const sid of selectedIds) assert.ok(original.has(sid), `选中来源不在原集: ${sid}`);
  assert.deepEqual(selectedIds, ordered.slice(0, k).map((c) => c.sourceId)); // 排序后前 K
});

// ---------- Issue #14 required test 9: sampled identity / invalid input ----------
test('T9 非法输入 fail closed：X=0 / 101 / 1.5 / -5 / 非数字 / 空 → invalid_input', () => {
  for (const bad of [0, 101, 1.5, -5, 'abc', '', null, undefined]) {
    assert.throws(() => parsePercent(bad), /invalid_input/, `X=${String(bad)} 应被拒绝`);
  }
  assert.equal(parsePercent('10'), 10);
  assert.equal(parsePercent(100), 100);
});

test('T9b 无候选 → invalid_input', () => {
  assert.throws(() => selectTopPercent([], 10), /invalid_input/);
});

// ---------- Issue #14 required test 10: schema version / compatibility ----------
test('T10 schemaVersion=1 + selectionRule 文法 + validateSelection 自洽', () => {
  const cands = makeCandidates(20);
  const selection = buildSelection(cands, 15);
  assert.equal(selection.schemaVersion, 1);
  assert.match(selection.selectionRule, SELECTION_RULE_PATTERN);
  assert.equal(selection.selectionRule, `top-15-pct-voteup-desc-answerid-dec-asc-strict`);
  // 回读校验通过
  assert.deepEqual(validateSelection(selection), selection);
  // 篡改 → selectorHash 不匹配 → 拒绝
  assert.throws(() => validateSelection({ ...selection, selectedSourceIds: selection.selectedSourceIds.slice(0, 2) }), /selectorHash/);
  // requestedPercent 与 selectionRule 不一致 → 拒绝
  assert.throws(() => validateSelection({ ...selection, requestedPercent: 16 }), /selectionRule|requestedPercent/);
});

// ---------- Issue #14 required test 11: canonical decimal answerId ----------
test('T11 canonical decimal answerId：长度优先（9<10）；前导零等价（001==1）；非纯数字 fail closed', () => {
  assert.equal(compareDecimalAnswerId('9', '10'), -1); // 长度优先，非字典序
  assert.equal(compareDecimalAnswerId('10', '9'), 1);
  assert.equal(compareDecimalAnswerId('001', '1'), 0); // 前导零等价
  assert.equal(compareDecimalAnswerId('100', '99'), 1);
  assert.equal(canonicalDecimalAnswerId('000'), '0');
  assert.throws(() => canonicalDecimalAnswerId('unknown'), /invalid_input/);
  assert.throws(() => canonicalDecimalAnswerId(''), /invalid_input/);
  assert.throws(() => canonicalDecimalAnswerId('12a'), /invalid_input/);
  assert.throws(() => selectTopPercent([{ sourceId: 's', answerId: 'unknown', voteupCount: 1 }], 100), /invalid_input/);
});

// ---------- 追加：selectionRule 文法覆盖 X 全范围 ----------
test('selectionRuleFor 覆盖 X∈[1,100] 且严格可解析（X 合法性由 parsePercent 负责）', () => {
  for (const x of [1, 5, 10, 25, 50, 99, 100]) {
    assert.match(selectionRuleFor(x), SELECTION_RULE_PATTERN);
  }
  // selectionRuleFor 是纯模板；非法 X 由 parsePercent 拒绝（T9 已覆盖）
  assert.equal(selectionRuleFor(0), 'top-0-pct-voteup-desc-answerid-dec-asc-strict');
  assert.throws(() => parsePercent(0), /invalid_input/);
});
