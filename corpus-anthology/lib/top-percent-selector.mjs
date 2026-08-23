// SPDX-License-Identifier: MIT
/**
 * top-percent-selector — T7 批准合同的确定性选择器（T8, Issue #14）。
 *
 * 批准合同（docs/t7-top-percent-contract-decision.md，MODIFY + APPROVE 2026-08-23）:
 *   D2.1  K = max(1, ceil(X/100 * N))（ceil，非 floor/round）
 *   D2.2  minimum = 1（N >= 1 且 X >= 1 时）
 *   D2.3  X 必须是显式 safe integer ∈ [1,100]；0/小数/负数/>100 → invalid_input
 *   D2.4  STRICT COUNT：恰好选中 K 条，无 tie 扩展（有界成本）
 *   D2.5  排序 (voteupCount DESC, canonical decimal answerId ASC)
 *         —— decimal 数字串比较（先比规范化长度，等长再字典序），
 *            不是 JS 字符串字典序，也不是 Number 转换
 *   D2.6  X=100 保持 sampled identity；isFullCoverage 是覆盖事实（选中集==原集时为 true）
 *   D2.7  --percent 必填，无默认
 *   D2.8  披露块字段 + 人类可读 7 项
 *   D6    OPTION C：selection.json（schemaVersion/requestedPercent/selectionRule/
 *         originalTotal/selectedSourceIds/selectorHash）；共享 handoff schema 零变更
 *
 * 本模块为纯函数（无 IO），供 scripts/select.mjs 与测试复用。
 */
import crypto from 'node:crypto';

/** selection.json schemaVersion（本 ticket 固定为 1） */
export const SELECTION_SCHEMA_VERSION = 1;

/** selectionRule 稳定机器文法：top-<X>-pct-voteup-desc-answerid-dec-asc-strict */
export function selectionRuleFor(percent) {
  return `top-${percent}-pct-voteup-desc-answerid-dec-asc-strict`;
}

/** selectionRule 合法性 pattern（机器可解析性，R6） */
export const SELECTION_RULE_PATTERN = /^top-\d+-pct-voteup-desc-answerid-dec-asc-strict$/u;

/**
 * 校验并解析 --percent。
 * @param {number|string} raw
 * @returns {number} X ∈ [1,100] 的 safe integer
 * @throws {Error} invalid_input（0 / 小数 / 负数 / >100 / 非数字 / 非整数 / 非 safe）
 */
export function parsePercent(raw) {
  if (raw === null || raw === undefined || raw === '') {
    throw new Error('invalid_input: --percent 必填（X ∈ [1,100] 整数）');
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`invalid_input: X 必须是整数，收到 ${JSON.stringify(raw)}`);
  }
  if (value < 1 || value > 100) {
    throw new Error(`invalid_input: X 必须在 [1,100]，收到 ${value}`);
  }
  return value;
}

/**
 * answerId canonical 化为 decimal digit string（D2.5，R2）。
 * - 仅接受纯数字串；空串 / 'unknown' / 含非数字字符 → invalid_input（fail closed，
 *   不静默 fallback，保证排序确定性可审计）。
 * - 去除前导零（'001' → '1'；全零 → '0'），保证等价 answerId 比较一致。
 * @param {string} answerId
 * @returns {string} canonical decimal digit string
 */
export function canonicalDecimalAnswerId(answerId) {
  if (typeof answerId !== 'string' || !/^[0-9]+$/u.test(answerId)) {
    throw new Error(`invalid_input: answerId 必须是纯数字字符串（canonical decimal），收到 ${JSON.stringify(answerId)}`);
  }
  return answerId.replace(/^0+(?=[0-9])/u, '');
}

/**
 * canonical decimal answerId 比较（D2.5）：
 * 先比规范化后的 digit-string 长度（长度短 = 数值小），等长再按字典序比较。
 * 无语言数值精度依赖（不经过 Number）。
 * @param {string} a
 * @param {string} b
 * @returns {number} -1 | 0 | 1
 */
export function compareDecimalAnswerId(a, b) {
  const ca = canonicalDecimalAnswerId(a);
  const cb = canonicalDecimalAnswerId(b);
  if (ca.length !== cb.length) return ca.length < cb.length ? -1 : 1;
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}

/**
 * 确定性选择（D2.1-D2.5 完整算法）。
 * @param {Array<{sourceId: string, answerId: string, voteupCount: number}>} candidates
 *   每项必须含 sourceId / answerId；voteupCount 缺失或 null 按 0（D2.5 缺失元数据规则）。
 * @param {number} percent 已由 parsePercent 校验的 X
 * @returns {{selectedIds: string[], k: number, ordered: Array}}
 *   selectedIds = 排序后前 K 条的 sourceId（保持排序序）；ordered = 完整排序结果。
 */
export function selectTopPercent(candidates, percent) {
  const x = parsePercent(percent);
  if (!Array.isArray(candidates)) {
    throw new Error('invalid_input: candidates 必须是数组');
  }
  const n = candidates.length;
  if (n === 0) {
    throw new Error('invalid_input: 无候选回答可选中');
  }
  // 排序：(voteupCount DESC, canonical decimal answerId ASC)
  // voteupCount 非有限数值（NaN/Infinity/非数字串）→ 归一化为 0，保证确定性排序语义明确
  const ordered = [...candidates].map((c) => {
    const rawVote = c.voteupCount === undefined || c.voteupCount === null ? 0 : Number(c.voteupCount);
    const vote = Number.isFinite(rawVote) ? rawVote : 0;
    return {
      sourceId: String(c.sourceId ?? ''),
      answerId: String(c.answerId ?? ''),
      voteupCount: vote,
    };
  });
  // 前置校验：所有 sourceId/answerId 必须合法（fail closed，避免排序中途才炸）
  for (const c of ordered) {
    if (c.sourceId.trim() === '') throw new Error('invalid_input: 候选缺少 sourceId');
    canonicalDecimalAnswerId(c.answerId); // 非法 answerId → throw
  }
  ordered.sort((a, b) => {
    if (a.voteupCount !== b.voteupCount) return b.voteupCount - a.voteupCount;
    return compareDecimalAnswerId(a.answerId, b.answerId);
  });
  const k = Math.max(1, Math.ceil((x / 100) * n));
  return {
    selectedIds: ordered.slice(0, k).map((c) => c.sourceId),
    k,
    ordered,
  };
}

/** 覆盖事实（D2.6）：选中集是否恰等于原集（集合相等，忽略顺序） */
export function computeIsFullCoverage(selectedIds, originalIds) {
  const s = new Set(selectedIds);
  const o = new Set(originalIds);
  if (s.size !== o.size) return false;
  for (const id of o) if (!s.has(id)) return false;
  return true;
}

/** 实际覆盖百分比字符串（1 位小数，D2.8）：selected/original × 100 */
export function actualCoveragePercentString(selectedIds, originalIds) {
  const original = new Set(originalIds).size;
  const selected = new Set(selectedIds).size;
  if (original === 0) throw new Error('invalid_input: originalTotal 为 0 无法计算覆盖率');
  return `${((selected / original) * 100).toFixed(1)}`;
}

function sha256Of(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * 构建 selection.json 对象（D6 OPTION C 字段集 + selectorHash）。
 * @param {Array} candidates 同 selectTopPercent
 * @param {number} percent
 * @returns {object} selection.json：
 *   { schemaVersion, requestedPercent, selectionRule, originalTotal,
 *     selectedSourceIds, selectorHash }
 *   （actualCoveragePercent / isFullCoverage 为覆盖事实，由 reduce 侧按
 *     selectedSourceIds 与 originalTotal 计算，不写入 selection.json。）
 */
export function buildSelection(candidates, percent) {
  const x = parsePercent(percent);
  const { selectedIds } = selectTopPercent(candidates, x);
  const originalIds = candidates.map((c) => String(c.sourceId ?? ''));
  const selection = {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    requestedPercent: x,
    selectionRule: selectionRuleFor(x),
    originalTotal: originalIds.length,
    selectedSourceIds: selectedIds,
  };
  // selectorHash：对规范化 selection 的确定性序列化（不含时间戳/路径）
  selection.selectorHash = sha256Of(JSON.stringify({
    schemaVersion: selection.schemaVersion,
    requestedPercent: selection.requestedPercent,
    selectionRule: selection.selectionRule,
    originalTotal: selection.originalTotal,
    selectedSourceIds: selection.selectedSourceIds,
  }));
  return selection;
}

/**
 * selection.json 结构校验（fail closed）。供 select.mjs 回读 / chunk.mjs / verify.mjs
 * / reduce.mjs 交叉校验使用。抛错即无效。
 * @param {unknown} sel
 * @returns {object} 校验通过的 selection 对象
 */
export function validateSelection(sel) {
  if (!sel || typeof sel !== 'object' || Array.isArray(sel)) {
    throw new Error('invalid_input: selection 必须是 JSON 对象');
  }
  if (sel.schemaVersion !== SELECTION_SCHEMA_VERSION) {
    throw new Error(`invalid_input: selection.schemaVersion 必须为 ${SELECTION_SCHEMA_VERSION}`);
  }
  const x = parsePercent(sel.requestedPercent);
  if (sel.requestedPercent !== x) {
    throw new Error(`invalid_input: requestedPercent 与合法 X 不一致: ${sel.requestedPercent}`);
  }
  if (sel.selectionRule !== selectionRuleFor(x)) {
    throw new Error(`invalid_input: selectionRule 不匹配文法: ${sel.selectionRule}`);
  }
  if (!Number.isSafeInteger(sel.originalTotal) || sel.originalTotal < 1) {
    throw new Error(`invalid_input: originalTotal 非法: ${sel.originalTotal}`);
  }
  if (!Array.isArray(sel.selectedSourceIds) || sel.selectedSourceIds.length === 0) {
    throw new Error('invalid_input: selectedSourceIds 必须为非空数组');
  }
  if (new Set(sel.selectedSourceIds).size !== sel.selectedSourceIds.length) {
    throw new Error('invalid_input: selectedSourceIds 存在重复');
  }
  if (sel.selectedSourceIds.length > sel.originalTotal) {
    throw new Error('invalid_input: selectedSourceIds 数量超过 originalTotal');
  }
  for (const sid of sel.selectedSourceIds) {
    if (typeof sid !== 'string' || sid.trim() === '') {
      throw new Error('invalid_input: selectedSourceIds 含非法 sourceId');
    }
  }
  // selectorHash 重算核验（防篡改 / 防陈旧）
  const expectedHash = sha256Of(JSON.stringify({
    schemaVersion: sel.schemaVersion,
    requestedPercent: sel.requestedPercent,
    selectionRule: sel.selectionRule,
    originalTotal: sel.originalTotal,
    selectedSourceIds: sel.selectedSourceIds,
  }));
  if (typeof sel.selectorHash !== 'string' || sel.selectorHash !== expectedHash) {
    throw new Error('invalid_input: selectorHash 与 selection 内容不匹配（selection 被篡改或陈旧）');
  }
  return sel;
}
