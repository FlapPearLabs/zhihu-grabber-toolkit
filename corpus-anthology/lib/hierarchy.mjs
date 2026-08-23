// SPDX-License-Identifier: MIT
/**
 * hierarchy — T9 批准合同的 hierarchical full digest engine（T10, Issue #16）。
 *
 * 批准合同（docs/t9-hierarchical-digest-contract.md，MODIFY + APPROVE 2026-08-23）:
 *   - OPTION A additive explicit（flat digest 行为不变；hierarchy 显式启用；V0.3 不自动路由）
 *   - ADAPTIVE 深度：if nodeCount==1 terminate；每个非终止聚合节点
 *     2 <= childCount <= MAX_CHILDREN_PER_NODE；禁止 single-child；
 *     nextLevel.nodeCount < currentLevel.nodeCount（严格递减）
 *   - 分组：controller-owned left-to-right greedy packing（childCount + projected size 双约束）
 *   - 节点身份：{ schemaVersion, hierarchyContractVersion, level, nodeId, nodeHash, children,
 *     childHashes, canonicalSourceIds, inputHash, runtime, claims, minorityViews, uncertainties }
 *   - HYBRID lineage：node.canonicalSourceIds == deterministic union(children.canonicalSourceIds)
 *     （LLM 不得发明/修改 union）；COVERAGE ≠ CLAIM EVIDENCE
 *   - 每层递归覆盖不变量：union(children)==parent；L1 union == manifest set
 *   - fail-closed 验证；resume/stale：FILE EXISTS != VALID CACHE（全 hash/version/runtime 匹配才复用）
 *   - stale 向上传播：child/input 变化 → 路径上所有依赖祖先失效；无关 sibling 子树可复用
 *   - 有效 profile 参数：MAX_CHILDREN_PER_NODE（>=2 整数）/ MAX_PROJECTED_INPUT_BUDGET（正、
 *     与 approved runtime context envelope 兼容）；T10 从 qualified runtime 推导 safe defaults
 *   - FAIL CLOSED 码：hierarchy_input_too_large / hierarchy_runtime_budget_unknown
 *
 * 本模块为纯函数（无 IO），供 scripts/map.mjs（--hierarchy）与测试复用。
 */
import crypto from 'node:crypto';
import { sanitizeProjectionText } from './lmstudio-projection.mjs';

/** 当前 hierarchy contract 版本（T9 批准合同语义；变化时全部节点失效） */
export const HIERARCHY_CONTRACT_VERSION = 1;

/** 节点 schema 版本 */
export const NODE_SCHEMA_VERSION = 1;

/** 有效 runtime（repository truth：唯一 CAPABILITY_ISOLATION_AVAILABLE=YES runtime） */
export const REVIEWED_HIERARCHY_RUNTIME = 'lmstudio-local-tool-less';

/** level 0 = L1 map 节点（现有 map-chunk-*.json 的等价物）；聚合节点 level >= 1 */
export const L1_LEVEL = 0;

/**
 * 推导有效 profile 参数（T9 §5：runtime/execution profile parameters）。
 * T10 从 qualified runtime/model 配置推导 safe defaults；调用方（CLI）可覆盖。
 * @param {object} [overrides]
 * @param {number} [overrides.maxChildren] 默认 16（>=2）
 * @param {number} [overrides.maxProjectedBytes] 默认 32_000（与本地 1.7B 上下文预算兼容的正数）
 * @returns {{maxChildren: number, maxProjectedBytes: number}}
 * @throws {Error} hierarchy_runtime_budget_unknown（若参数非法/预算无法建立）
 */
export function resolveProfileParams({ maxChildren = 16, maxProjectedBytes = 32_000 } = {}) {
  const mc = Number(maxChildren);
  const mb = Number(maxProjectedBytes);
  if (!Number.isSafeInteger(mc) || mc < 2) {
    throw new Error('hierarchy_runtime_budget_unknown: MAX_CHILDREN_PER_NODE 必须是 >= 2 的整数');
  }
  if (!Number.isFinite(mb) || mb <= 0) {
    throw new Error('hierarchy_runtime_budget_unknown: MAX_PROJECTED_INPUT_BUDGET 必须是正数');
  }
  return { maxChildren: mc, maxProjectedBytes: mb };
}

function sha256Of(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** 规范化 JSON 序列化（确定性：键排序 + 无多余空白） */
export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 左到右贪婪分组（T9 §5 APPROVED）：
 * 1. 按 canonical 顺序取已验证子节点；
 * 2. 仅当 childCount <= maxChildren 且 projected serialized size <= maxProjectedBytes 时加入下一子节点；
 * 3. 违反任一约束 → 关闭当前组，开启下一组；
 * 4. 每个完成的非终止组必须至少含 2 个子节点（无 single-child）。
 * @param {Array<object>} nodes 已验证子节点（含 nodeId / nodeHash / canonicalSourceIds）
 * @param {{maxChildren: number, maxProjectedBytes: number}} params
 * @returns {Array<Array<object>>} 分组结果（每组 >= 2 节点；不足 2 的尾部也返回但由调用方 fail closed）
 */
export function packGroups(nodes, params) {
  const { maxChildren, maxProjectedBytes } = resolveProfileParams(params);
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const groups = [];
  let current = [];
  for (const node of nodes) {
    if (typeof node?.nodeId !== 'string' || typeof node?.nodeHash !== 'string') {
      throw new Error('capability_isolation_unavailable: 子节点缺少 nodeId/nodeHash（未验证节点不得分组）');
    }
    // 预算按「模型投影文本」计（MAX_PROJECTED_INPUT_BUDGET 语义 = 投影输入预算）
    const projectedBytes = buildHierarchyProjection({
      token: 'x', nodeId: 'x', children: current.concat(node),
    }).text.length;
    if (current.length > 0 && (current.length >= maxChildren || projectedBytes > maxProjectedBytes)) {
      groups.push(current);
      current = [];
    }
    current.push(node);
  }
  if (current.length > 0) groups.push(current);
  // 非终止场景禁止 single-child（T9 §3）：节点总数 > 1 时，任何组（含中间组）长度 == 1
  // → 该子节点无法与任何其他节点组成合法 >=2 组 → fail closed
  if (nodes.length > 1 && groups.some((g) => g.length === 1)) {
    throw new Error('hierarchy_input_too_large: 存在仅含 1 个子节点的组（禁止 single-child 聚合；该子节点无法装入任何合法 >=2 组）');
  }
  return groups;
}

/**
 * 确定性计算子节点 canonical source union（controller-owned；LLM 不得发明/修改）。
 * @param {Array<object>} children
 * @returns {string[]} 有序去重 union（按子节点顺序 + 各自数组顺序）
 */
export function computeSourceUnion(children) {
  const seen = new Set();
  const union = [];
  for (const child of children) {
    for (const sid of child.canonicalSourceIds ?? []) {
      if (typeof sid !== 'string' || sid.trim() === '') {
        throw new Error('capability_isolation_unavailable: 子节点含非法 canonicalSourceIds');
      }
      if (!seen.has(sid)) {
        seen.add(sid);
        union.push(sid);
      }
    }
  }
  return union;
}

/**
 * 节点投影输入（供 L2+ 合成模型调用）——**T6 控制器兼容（恰好 3 键）**：
 * kind='deterministic-analysis-projection' + 单 token sourceIds + `[SOURCE <token>]` 头；
 * body（子节点 claims + union + meta）先经 sanitizeProjectionText 消毒
 * （防 URL/路径/方括号注入；sanitizer 中和 `[SOURCE` 保证唯一 source tag）。
 * 模型只能回显 token；token 由 controller 映射回 nodeId。
 * 注意：返回对象必须恰好 {kind, sourceIds, text}（assertProjection hasExactKeys）。
 * nodeId / union 由调用方从聚合节点（agg）持有，不进入投影对象。
 * @param {object} param0
 * @param {string} param0.token 短不透明 token（模型回显目标）
 * @param {string} param0.nodeId 真实聚合节点 ID（仅用于文本标注，不进投影对象）
 * @param {Array<object>} param0.children 已验证子节点
 * @param {string} [param0.meta]
 * @returns {{kind: string, sourceIds: string[], text: string}}
 */
export function buildHierarchyProjection({ token, nodeId, children, meta = '' }) {
  if (typeof nodeId !== 'string' || nodeId.trim() === '' || !Array.isArray(children) || children.length === 0) {
    throw new Error('capability_isolation_unavailable: 合成投影缺少 nodeId/children');
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(token)) {
    throw new Error('capability_isolation_unavailable: 合成投影 token 非法');
  }
  const union = computeSourceUnion(children);
  const rawLines = [];
  if (meta) rawLines.push(meta);
  children.forEach((child, i) => {
    rawLines.push(`子节点 ${i + 1}: ${child.nodeId}（覆盖 ${(child.canonicalSourceIds ?? []).length} 个来源）`);
    for (const claim of child.claims ?? []) {
      const text = String(claim?.claim ?? '').trim();
      if (text) rawLines.push(`- ${text}`);
    }
  });
  rawLines.push(`覆盖来源（union）: ${union.join(', ')}`);
  const sanitizedBody = sanitizeProjectionText(rawLines.join('\n'));
  const text = `[SOURCE ${token}]\n${sanitizedBody}`;
  // 恰好 3 键（T6 控制器 assertProjection hasExactKeys 契约）
  return {
    kind: 'deterministic-analysis-projection',
    sourceIds: [token],
    text,
  };
}

/**
 * 计算节点 inputHash（本节点输入投影的确定性序列化）。
 * 用于复用判定：canonical input / children / grouping params / contract / runtime 变化 → inputHash 变。
 * @param {object} param0
 * @param {number} param0.level
 * @param {string[]} param0.children
 * @param {string[]} param0.childHashes
 * @param {string[]} param0.canonicalSourceIds
 * @param {{maxChildren: number, maxProjectedBytes: number}} param0.effectiveParams
 * @param {string} param0.projectionText
 */
export function computeInputHash({ level, children, childHashes, canonicalSourceIds, effectiveParams, projectionText }) {
  return sha256Of(canonicalJson({
    level,
    children,
    childHashes,
    canonicalSourceIds,
    effectiveParams,
    projectionText,
    hierarchyContractVersion: HIERARCHY_CONTRACT_VERSION,
  }));
}

/**
 * 计算节点 nodeHash（nodeId | level | schemaVersion | contract | children | childHashes |
 * canonicalSourceIds | inputHash | runtime | claims | minorityViews | uncertainties）。
 * 检测：stale child / membership / ordering / grouping params / contract version / runtime。
 * @param {object} node 不含 nodeHash 的节点
 * @returns {string}
 */
export function computeNodeHash(node) {
  return sha256Of(canonicalJson({
    schemaVersion: node.schemaVersion,
    hierarchyContractVersion: node.hierarchyContractVersion,
    level: node.level,
    nodeId: node.nodeId,
    children: node.children,
    childHashes: node.childHashes,
    canonicalSourceIds: node.canonicalSourceIds,
    inputHash: node.inputHash,
    runtime: node.runtime,
    claims: node.claims,
    minorityViews: node.minorityViews,
    uncertainties: node.uncertainties,
  }));
}

/**
 * 构建聚合节点（不含模型合成结果时由调用方填 claims 后调用 finalize 计算 nodeHash）。
 * @param {object} param0
 * @param {string} param0.nodeId
 * @param {number} param0.level
 * @param {Array<object>} param0.children 已验证子节点
 * @param {{maxChildren: number, maxProjectedBytes: number}} param0.effectiveParams
 * @returns {{schemaVersion, hierarchyContractVersion, level, nodeId, children, childHashes,
 *   canonicalSourceIds, inputHash, runtime, claims: [], minorityViews: [], uncertainties: []}}
 */
export function buildAggregationNode({ nodeId, level, children, effectiveParams, runtime = REVIEWED_HIERARCHY_RUNTIME }) {
  const params = resolveProfileParams(effectiveParams);
  const childHashes = children.map((c) => c.nodeHash);
  const canonicalSourceIds = computeSourceUnion(children);
  const projection = buildHierarchyProjection({ token: nodeId, nodeId, children });
  const inputHash = computeInputHash({
    level,
    children: children.map((c) => c.nodeId),
    childHashes,
    canonicalSourceIds,
    effectiveParams: params,
    projectionText: projection.text,
  });
  return {
    schemaVersion: NODE_SCHEMA_VERSION,
    hierarchyContractVersion: HIERARCHY_CONTRACT_VERSION,
    level,
    nodeId,
    children: children.map((c) => c.nodeId),
    childHashes,
    canonicalSourceIds,
    inputHash,
    runtime,
    claims: [],
    minorityViews: [],
    uncertainties: [],
  };
}

/** 完成节点：填入合成结果并计算 nodeHash（fail-closed：claims 非法即拒） */
export function finalizeAggregationNode(node, { claims, minorityViews = [], uncertainties = [] }) {
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new Error('capability_isolation_unavailable: 聚合节点缺少合法 claims（无输出可装配）');
  }
  const union = new Set(node.canonicalSourceIds);
  for (const [i, claim] of claims.entries()) {
    if (!claim || typeof claim !== 'object'
      || typeof claim.claim !== 'string' || claim.claim.trim() === ''
      || !Array.isArray(claim.evidenceSourceIds) || claim.evidenceSourceIds.length === 0
      || !['high', 'medium', 'low'].includes(claim.confidence)) {
      throw new Error(`capability_isolation_unavailable: claims[${i}] 非法`);
    }
    // 父 claim 证据必须 ⊆ 本节点 union（COVERAGE 边界）
    for (const ev of claim.evidenceSourceIds) {
      if (!union.has(ev)) {
        throw new Error(`capability_isolation_unavailable: claim 证据越出本节点 union: ${ev}`);
      }
    }
  }
  const full = {
    ...node,
    claims,
    minorityViews: Array.isArray(minorityViews) ? minorityViews : [],
    uncertainties: Array.isArray(uncertainties) ? uncertainties : [],
  };
  full.nodeHash = computeNodeHash(full);
  return full;
}

/**
 * 验证聚合节点（fail-closed；上层只消费已验证节点）。
 * 校验：schemaVersion / hierarchyContractVersion / level / nodeId / children / childHashes /
 * canonicalSourceIds（递归不变量 union(children)==parent）/ inputHash / nodeHash / runtime。
 * @param {object} node
 * @param {Map<string, object>} childrenById
 * @param {{maxChildren: number, maxProjectedBytes: number}} effectiveParams
 * @returns {object} 验证通过的节点
 * @throws {Error} capability_isolation_unavailable: <原因>
 */
export function validateAggregationNode(node, childrenById, effectiveParams) {
  const params = resolveProfileParams(effectiveParams);
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('capability_isolation_unavailable: malformed node');
  }
  if (node.schemaVersion !== NODE_SCHEMA_VERSION) {
    throw new Error(`capability_isolation_unavailable: unsupported schema version ${node.schemaVersion}`);
  }
  if (node.hierarchyContractVersion !== HIERARCHY_CONTRACT_VERSION) {
    throw new Error(`capability_isolation_unavailable: unsupported hierarchy contract version ${node.hierarchyContractVersion}`);
  }
  if (typeof node.level !== 'number' || node.level < 1) {
    throw new Error('capability_isolation_unavailable: invalid level');
  }
  if (typeof node.nodeId !== 'string' || node.nodeId.trim() === '' || typeof node.nodeHash !== 'string') {
    throw new Error('capability_isolation_unavailable: nodeId/nodeHash missing');
  }
  // T11-R2 #28：approved runtimes（CAPABILITY_ISOLATION_AVAILABLE=YES 的 runtime-scoped 集合）
  if (node.runtime !== 'lmstudio-local-tool-less' && node.runtime !== 'deepseek-api-tool-less') {
    throw new Error(`capability_isolation_unavailable: unsupported runtime ${node.runtime}`);
  }
  if (!Array.isArray(node.children) || node.children.length < 2) {
    throw new Error('capability_isolation_unavailable: 聚合节点必须 >=2 子节点（禁止 single-child）');
  }
  if (node.children.length > params.maxChildren) {
    throw new Error('capability_isolation_unavailable: 子节点数超 MAX_CHILDREN_PER_NODE');
  }
  if (!Array.isArray(node.childHashes) || node.childHashes.length !== node.children.length) {
    throw new Error('capability_isolation_unavailable: childHashes 缺失/不匹配');
  }
  // 子节点存在性 + hash 匹配（stale child 检测）
  const seen = new Set();
  node.children.forEach((cid, i) => {
    if (seen.has(cid)) throw new Error(`capability_isolation_unavailable: duplicate child ${cid}`);
    seen.add(cid);
    const child = childrenById.get(cid);
    if (!child) throw new Error(`capability_isolation_unavailable: missing child ${cid}`);
    if (child.nodeHash !== node.childHashes[i]) {
      throw new Error(`capability_isolation_unavailable: child hash mismatch ${cid}（stale child）`);
    }
  });
  // 递归覆盖不变量：union(children.canonicalSourceIds) == parent.canonicalSourceIds
  const expectedUnion = computeSourceUnion(node.children.map((cid) => childrenById.get(cid)));
  const actual = new Set(node.canonicalSourceIds ?? []);
  if (expectedUnion.length !== actual.size || expectedUnion.some((sid) => !actual.has(sid))) {
    throw new Error('capability_isolation_unavailable: source lineage 越出 child union 或 union 缺源');
  }
  // nodeHash 重算
  if (node.nodeHash !== computeNodeHash(node)) {
    throw new Error('capability_isolation_unavailable: node hash mismatch');
  }
  // claims 边界
  const unionSet = new Set(node.canonicalSourceIds);
  for (const claim of node.claims ?? []) {
    for (const ev of claim.evidenceSourceIds ?? []) {
      if (!unionSet.has(ev)) throw new Error('capability_isolation_unavailable: invalid evidenceSourceIds');
    }
  }
  return node;
}

/**
 * 验证整个层级（L1 union == manifest set；每层递归不变量；stale 向上传播由 inputHash 检测）。
 * @param {object} param0
 * @param {Map<string, object>} param0.l1BySource  L1 节点（按 sourceId 聚合的 map-chunk 等价物）
 * @param {Map<string, object>} param0.nodesByLevel 每层节点（level -> nodeId -> node）
 * @param {string[]} param0.manifestSourceIds
 * @param {{maxChildren: number, maxProjectedBytes: number}} param0.effectiveParams
 * @returns {{l1Union: string[], topLevel: number, topNodeIds: string[]}}
 */
export function validateHierarchy({ l1BySource, nodesByLevel, manifestSourceIds, effectiveParams }) {
  const params = resolveProfileParams(effectiveParams);
  // L1 union == manifest set
  const l1Union = [];
  {
    const seen = new Set();
    for (const node of l1BySource.values()) {
      for (const sid of node.canonicalSourceIds ?? []) {
        if (!seen.has(sid)) {
          seen.add(sid);
          l1Union.push(sid);
        }
      }
    }
    const manifestSet = new Set(manifestSourceIds);
    if (l1Union.length !== manifestSet.size || l1Union.some((sid) => !manifestSet.has(sid))) {
      throw new Error('capability_isolation_unavailable: L1 union != canonical manifest source set（缺源）');
    }
  }
  // 每层聚合节点验证
  for (const [level, nodes] of nodesByLevel.entries()) {
    const childrenById = new Map();
    if (level > 1) {
      for (const child of nodesByLevel.get(level - 1)?.values() ?? []) childrenById.set(child.nodeId, child);
    } else {
      for (const node of l1BySource.values()) childrenById.set(node.nodeId, node);
    }
    for (const node of nodes.values()) validateAggregationNode(node, childrenById, params);
  }
  // 顶层：nodesByLevel 最高层（若为空 → 无聚合，flat）
  const topLevel = nodesByLevel.size === 0 ? L1_LEVEL : Math.max(...nodesByLevel.keys());
  const topNodeIds = topLevel === L1_LEVEL
    ? [...new Set([...l1BySource.values()].map((n) => n.nodeId))]
    : [...nodesByLevel.get(topLevel).values()].map((n) => n.nodeId);
  return { l1Union, topLevel, topNodeIds };
}
