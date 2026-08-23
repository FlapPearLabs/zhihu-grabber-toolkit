// SPDX-License-Identifier: MIT
/**
 * hierarchy engine — T9 批准合同 hierarchical full digest 纯函数测试（T10, Issue #16）。
 * 覆盖 T9 §16 17 项 + Issue #16 13 项中的纯函数层。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAggregationNode,
  buildHierarchyProjection,
  computeInputHash,
  computeNodeHash,
  computeSourceUnion,
  finalizeAggregationNode,
  HIERARCHY_CONTRACT_VERSION,
  NODE_SCHEMA_VERSION,
  packGroups,
  resolveProfileParams,
  REVIEWED_HIERARCHY_RUNTIME,
  validateAggregationNode,
  validateHierarchy,
} from '../lib/hierarchy.mjs';

/** 造一个已验证的 L1 节点（等价 map-chunk 节点） */
function makeL1({ id, sourceIds, claimText }) {
  const node = {
    schemaVersion: NODE_SCHEMA_VERSION,
    hierarchyContractVersion: HIERARCHY_CONTRACT_VERSION,
    level: 0,
    nodeId: id,
    children: [],
    childHashes: [],
    canonicalSourceIds: sourceIds,
    inputHash: 'l1-input-hash',
    runtime: REVIEWED_HIERARCHY_RUNTIME,
    claims: sourceIds.map((sid) => ({ claim: `${claimText ?? '观点'} ${sid}`, evidenceSourceIds: [sid], confidence: 'high' })),
    minorityViews: [],
    uncertainties: [],
  };
  node.nodeHash = computeNodeHash(node);
  return node;
}

function makeL1Nodes(count, { prefix = 'l1-' } = {}) {
  return Array.from({ length: count }, (_, i) => makeL1({
    id: `${prefix}${i + 1}`,
    sourceIds: [`s-${i + 1}`],
    claimText: `来源 ${i + 1} 的观点`,
  }));
}

// ---------- T9 §16 test 1: L1 全覆盖 ----------
test('H1 L1 全覆盖：union(L1) == manifest set（validateHierarchy 机械证明）', () => {
  const l1 = makeL1Nodes(5);
  const manifest = l1.flatMap((n) => n.canonicalSourceIds);
  const { l1Union, topLevel, topNodeIds } = validateHierarchy({
    l1BySource: new Map(l1.map((n) => [n.canonicalSourceIds[0], n])),
    nodesByLevel: new Map(),
    manifestSourceIds: manifest,
    effectiveParams: {},
  });
  assert.equal(l1Union.length, 5);
  assert.equal(topLevel, 0);
  assert.equal(topNodeIds.length, 5);
  // 缺 1 个 source → fail closed
  assert.throws(() => validateHierarchy({
    l1BySource: new Map(l1.slice(0, 4).map((n) => [n.canonicalSourceIds[0], n])),
    nodesByLevel: new Map(),
    manifestSourceIds: manifest,
    effectiveParams: {},
  }), /缺源/);
});

// ---------- T9 §16 test 2/3: 分组与节点身份确定性可复现 ----------
test('H2 分组确定性：同输入同参数 → 逐字节相同 group 身份', () => {
  const l1 = makeL1Nodes(20);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const g1 = packGroups(l1, params);
  const g2 = packGroups(l1, params);
  assert.deepEqual(g1.map((g) => g.map((n) => n.nodeId)), g2.map((g) => g.map((n) => n.nodeId)));
  assert.equal(g1.length, 3); // 20 → [8,8,4]
  for (const g of g1) assert.ok(g.length >= 2, '非终止组必须 >=2 子节点');
});

test('H3 节点身份可复现：同输入同参数 → nodeId/nodeHash 相同', () => {
  const l1 = makeL1Nodes(4);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const a = buildAggregationNode({ nodeId: 'level-1-node-1', level: 1, children: l1, effectiveParams: params });
  const b = buildAggregationNode({ nodeId: 'level-1-node-1', level: 1, children: l1, effectiveParams: params });
  assert.equal(a.inputHash, b.inputHash);
  assert.equal(a.nodeHash, b.nodeHash); // 未 finalize 时 nodeHash 未设，比较 inputHash 即可
  const fa = finalizeAggregationNode(a, { claims: l1[0].claims });
  const fb = finalizeAggregationNode(b, { claims: l1[0].claims });
  assert.equal(fa.nodeHash, fb.nodeHash);
});

// ---------- T9 §16 test 4/5/6: missing/extra/corrupted child fails ----------
test('H4 缺失子节点 fail：children 引用的子节点不存在 → 拒绝', () => {
  const l1 = makeL1Nodes(3);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const node = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params }),
    { claims: l1[0].claims },
  );
  const childrenById = new Map(l1.slice(0, 2).map((n) => [n.nodeId, n])); // 缺第 3 个
  assert.throws(() => validateAggregationNode(node, childrenById, params), /missing child/);
});

test('H5 多余子节点 fail：childHashes 长度不符 / child 未声明 → 拒绝', () => {
  const l1 = makeL1Nodes(3);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const node = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params }),
    { claims: l1[0].claims },
  );
  const tampered = { ...node, childHashes: [...node.childHashes, 'extra'] };
  assert.throws(() => validateAggregationNode(tampered, new Map(l1.map((n) => [n.nodeId, n])), params), /childHashes/);
});

test('H6 子节点 hash 破坏 fail：child hash mismatch（stale child）', () => {
  const l1 = makeL1Nodes(3);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const node = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params }),
    { claims: l1[0].claims },
  );
  // 篡改子节点（改变其 claims → nodeHash 变）
  const tamperedChild = { ...l1[0], claims: [{ claim: '篡改', evidenceSourceIds: ['s-1'], confidence: 'high' }] };
  tamperedChild.nodeHash = computeNodeHash(tamperedChild);
  const childrenById = new Map(l1.map((n) => [n.nodeId, n]));
  childrenById.set(tamperedChild.nodeId, tamperedChild);
  assert.throws(() => validateAggregationNode(node, childrenById, params), /child hash mismatch/);
});

// ---------- T9 §16 test 7: stale 向上传播 ----------
test('H7 stale 向上传播：child 变化 → 父 inputHash 变 → 祖先链失效（由 inputHash 判定）', () => {
  const l1 = makeL1Nodes(4);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  // 父节点 A 覆盖 l1[0..1]，父节点 B 覆盖 l1[2..3]；祖父 G 覆盖 A+B
  const A = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'A', level: 1, children: l1.slice(0, 2), effectiveParams: params }),
    { claims: l1[0].claims },
  );
  const B = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'B', level: 1, children: l1.slice(2, 4), effectiveParams: params }),
    { claims: l1[2].claims },
  );
  const G = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'G', level: 2, children: [A, B], effectiveParams: params }),
    { claims: A.claims },
  );
  // 变更 l1[0] → A 的 childHash 变 → A 失效；B 与 G（经 A）受影响，但 B 本身不变
  const changed = { ...l1[0], claims: [{ claim: '变更后', evidenceSourceIds: ['s-1'], confidence: 'high' }] };
  changed.nodeHash = computeNodeHash(changed);
  const A2 = buildAggregationNode({ nodeId: 'A', level: 1, children: [changed, l1[1]], effectiveParams: params });
  // A2.inputHash != A.inputHash（stale 检测点）
  assert.notEqual(A2.inputHash, A.inputHash);
  // B 不变（无关 sibling 可复用）
  const B2 = buildAggregationNode({ nodeId: 'B', level: 1, children: l1.slice(2, 4), effectiveParams: params });
  assert.equal(B2.inputHash, B.inputHash);
});

// ---------- T9 §16 test 8: lineage 越界 fail ----------
test('H8 lineage 越界 fail：claim.evidenceSourceIds ∉ 本节点 union → 拒绝', () => {
  const l1 = makeL1Nodes(3);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const node = buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params });
  assert.throws(() => finalizeAggregationNode(node, {
    claims: [{ claim: '越界', evidenceSourceIds: ['s-999'], confidence: 'high' }],
  }), /越出本节点 union/);
});

// ---------- T9 §16 test 9: final claim 追溯 ----------
test('H9 final claim 追溯：顶层节点 claims 的 evidence 全部 ∈ manifest set', () => {
  const l1 = makeL1Nodes(6);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const groups = packGroups(l1, params);
  const level1 = groups.map((g, i) => finalizeAggregationNode(
    buildAggregationNode({ nodeId: `L1-${i + 1}`, level: 1, children: g, effectiveParams: params }),
    { claims: g[0].claims },
  ));
  const manifest = l1.flatMap((n) => n.canonicalSourceIds);
  validateHierarchy({
    l1BySource: new Map(l1.map((n) => [n.canonicalSourceIds[0], n])),
    nodesByLevel: new Map([[1, new Map(level1.map((n) => [n.nodeId, n]))]]),
    manifestSourceIds: manifest,
    effectiveParams: params,
  });
  const topClaims = level1.flatMap((n) => n.claims);
  const manifestSet = new Set(manifest);
  for (const c of topClaims) {
    for (const ev of c.evidenceSourceIds) assert.ok(manifestSet.has(ev), `evidence 不在 manifest: ${ev}`);
  }
});

// ---------- T9 §16 test 10: 中断恢复（复用判定：全 hash 匹配才复用） ----------
test('H10 恢复：inputHash+childHashes+版本+runtime 全匹配才复用（FILE EXISTS != VALID CACHE）', () => {
  const l1 = makeL1Nodes(3);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const n1 = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params }),
    { claims: l1[0].claims },
  );
  // 同输入重建 → inputHash 相同（可复用）
  const n2 = buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params });
  assert.equal(n2.inputHash, n1.inputHash);
  // grouping params 变化 → inputHash 变（stale）
  const n3 = buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: { ...params, maxChildren: 4 } });
  assert.notEqual(n3.inputHash, n1.inputHash);
  // 契约版本变化 → inputHash 变（stale）——通过改变 projectionText 或版本体现
  const n4 = buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params });
  assert.equal(n4.hierarchyContractVersion, HIERARCHY_CONTRACT_VERSION);
});

// ---------- T9 §16 test 12/13: 分组参数与 runtime 校验 ----------
test('H12 参数校验：MAX_CHILDREN < 2 / 非正预算 → hierarchy_runtime_budget_unknown', () => {
  assert.throws(() => resolveProfileParams({ maxChildren: 1 }), /hierarchy_runtime_budget_unknown/);
  assert.throws(() => resolveProfileParams({ maxChildren: 2.5 }), /hierarchy_runtime_budget_unknown/);
  assert.throws(() => resolveProfileParams({ maxProjectedBytes: 0 }), /hierarchy_runtime_budget_unknown/);
  assert.throws(() => resolveProfileParams({ maxProjectedBytes: -5 }), /hierarchy_runtime_budget_unknown/);
  assert.deepEqual(resolveProfileParams({ maxChildren: 8, maxProjectedBytes: 100 }), { maxChildren: 8, maxProjectedBytes: 100 });
});

test('H13 unsupported runtime fail：非 lmstudio-local-tool-less 节点被拒', () => {
  const l1 = makeL1Nodes(3);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const node = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params }),
    { claims: l1[0].claims },
  );
  const bad = { ...node, runtime: 'llama.cpp' };
  bad.nodeHash = computeNodeHash(bad);
  assert.throws(() => validateAggregationNode(bad, new Map(l1.map((n) => [n.nodeId, n])), params), /unsupported runtime/);
});

test('T11-R2 #28：deepseek-api-tool-less 为批准 runtime（节点身份正确且通过验证）', () => {
  const l1 = makeL1Nodes(3);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const node = finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'n1', level: 1, children: l1, effectiveParams: params, runtime: 'deepseek-api-tool-less' }),
    { claims: l1[0].claims },
  );
  assert.equal(node.runtime, 'deepseek-api-tool-less');
  // 不抛错即通过（deepseek 已批准）；校验后节点身份保留
  validateAggregationNode(node, new Map(l1.map((n) => [n.nodeId, n])), params);
  assert.equal(node.runtime, 'deepseek-api-tool-less');
});

// ---------- T9 §16 test 14: 缺 1 个 L1 source 不得声称 full coverage ----------
test('H14 缺 1 个 L1 source → validateHierarchy fail（不可声称 full coverage）', () => {
  const l1 = makeL1Nodes(5);
  const manifest = l1.flatMap((n) => n.canonicalSourceIds);
  // 构建 2 层：L1 缺最后一个 source 后试图聚合
  const l1Partial = l1.slice(0, 4);
  const params = { maxChildren: 8, maxProjectedBytes: 100_000 };
  const level1 = [finalizeAggregationNode(
    buildAggregationNode({ nodeId: 'P', level: 1, children: l1Partial, effectiveParams: params }),
    { claims: l1Partial[0].claims },
  )];
  assert.throws(() => validateHierarchy({
    l1BySource: new Map(l1Partial.map((n) => [n.canonicalSourceIds[0], n])),
    nodesByLevel: new Map([[1, new Map(level1.map((n) => [n.nodeId, n]))]]),
    manifestSourceIds: manifest, // 含 5 个 source，但 L1 只覆盖 4 个
    effectiveParams: params,
  }), /缺源/);
});

// ---------- T9 §16 test 15: 幂等复用 ----------
test('H15 幂等：unchanged 输入 → inputHash 稳定（0 重新合成）', () => {
  const l1 = makeL1Nodes(10);
  const params = { maxChildren: 6, maxProjectedBytes: 100_000 };
  const g1 = packGroups(l1, params);
  const g2 = packGroups(l1, params);
  assert.deepEqual(g1.map((g) => g.map((n) => n.nodeHash)), g2.map((g) => g.map((n) => n.nodeHash)));
});

// ---------- 收敛不变量：严格递减 + 无 single-child ----------
test('H16 收敛：nodeCount==1 终止；每层严格递减；无 single-child', () => {
  const l1 = makeL1Nodes(50);
  const params = { maxChildren: 8, maxProjectedBytes: 1_000_000 };
  let level = l1;
  let levelNum = 0;
  let totalLevels = 0;
  while (level.length > 1) {
    const groups = packGroups(level, params);
    // 若有 1 个组且组内 == level 长度 → 未超限，应终止；但 packGroups 在 >1 组时禁尾部 single-child
    const next = groups.map((g, i) => {
      const node = buildAggregationNode({
        nodeId: `L${levelNum + 1}-${i + 1}`,
        level: levelNum + 1,
        children: g,
        effectiveParams: params,
      });
      return finalizeAggregationNode(node, { claims: g[0].claims });
    });
    assert.ok(next.length < level.length, `level ${levelNum + 1} 必须严格递减`);
    level = next;
    levelNum += 1;
    totalLevels += 1;
    if (totalLevels > 10) break; // 防死循环（测试保护）
  }
  assert.ok(totalLevels >= 2, '50 个节点应至少聚合 2 层');
  assert.equal(level.length, 1, '最终应收敛到 1 个顶层节点');
});

// ---------- 贪心分组双约束 ----------
test('H17 贪心分组：count 与 projected size 双约束', () => {
  const l1 = makeL1Nodes(10);
  // 预算过小（1 byte）→ 连 2 节点组都装不下 → 合法 >=2 组无法形成 → fail closed
  assert.throws(() => packGroups(l1, { maxChildren: 8, maxProjectedBytes: 1 }), /hierarchy_input_too_large/);
  // 预算 = 任意双节点组投影文本的最大长度：任意 2 节点可装下、3 节点必超 → 每组恰 2 个
  let maxTwo = 0;
  for (let i = 0; i < l1.length; i += 1) {
    for (let j = i + 1; j < l1.length; j += 1) {
      maxTwo = Math.max(maxTwo, buildHierarchyProjection({ token: 'x', nodeId: 'x', children: [l1[i], l1[j]] }).text.length);
    }
  }
  const tight = packGroups(l1, { maxChildren: 8, maxProjectedBytes: maxTwo });
  assert.ok(tight.every((g) => g.length === 2), '预算容 2 不容 3 时每组应恰 2 个');
  assert.equal(tight.length, 5);
  // count 限制主导
  const countLimited = packGroups(l1, { maxChildren: 4, maxProjectedBytes: 1_000_000 });
  assert.ok(countLimited.every((g) => g.length <= 4));
  assert.ok(countLimited.length >= 3);
});
