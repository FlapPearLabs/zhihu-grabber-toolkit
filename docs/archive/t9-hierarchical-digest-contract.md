# T9 — Hierarchical Full Digest Contract (OPEN-D4) — Phase B Approved Contract

> **STATUS: PHASE B / APPROVED AS MODIFIED（2026-08-23 product-owner decision）**
> 本文档现为批准合同记录：Phase A 决策包 + product-owner MODIFY + APPROVE 明细 + 被取代措辞修正。
> Phase B 将把批准合同归一化进 authority docs（V0.3 Spec / PBC / project-memory / corpus docs）。
> **仍不授权 T10 生产实现**；T10 仅在 T9 完整 merge 且其 START_GATE 满足后开始。
> 关联：Issue #15（T9）、Issue #3（large-corpus，保持 OPEN）、V0.3 §7.3 / §15-E / OPEN-D4。

---

## 1. STATUS

```text
PHASE: B（approved contract normalization）
APPROVAL: APPROVED AS MODIFIED（product-owner, 2026-08-23；未修改推荐全部接受）
T10 CODE: 未授权（T10 在 T9 完整 merge 后单独解锁）
#15: OPEN（Phase B 完成后依 DONE 定义关闭）
#3:  OPEN（贯穿 T9/T10，不因本决策关闭）
```

## 2. Current Implementation Evidence Baseline（实测，非旧文档）

### 2.1 CURRENT_FULL_DIGEST_PIPELINE（T8 合并后 master 实况）

```text
verified canonical answers（manifest.inputs）
→ chunk.mjs --mode digest（机械分块；manifest + chunks + chunkHash）
→ map.mjs（T6 per-source：每非空来源 1 次 lmstudio-local-tool-less 调用，
           trusted controller 确定性装配 map-chunk-XXXX.json）
→ verify.mjs（full-coverage 门 + selection-scope 门仅在 top-percent 模式启用）
→ reduce.mjs（纯机械合并：themes/claims/minorityViews/uncertainties →
           reduce-input.json + final.json + render-final 渲染 digest.md）
→ verify.mjs --final（claim 证据引用验证）
```

关键事实（代码为准）：
- **map 是 per-source**（T6）：`lmstudio-map-executor.mjs runChunkMap` 逐来源调用 tool-less runtime，短 token 回显 + controller 映射回真实 sourceId；空正文/纯占位符来源由 controller 确定性合成（不调用模型）。
- **reduce 是纯机械合并**：不调用 LLM；产出 `reduce-input.json`（供 LLM 撰写最终文档的结构化输入）+ canonical `final.json` + 展示层 `digest.md`。
- **上下文压力点定位**：顶层「最终撰写」阶段——LLM 需一次性读取**整个 `reduce-input.json`**（全部 claims + sourceIndex + themes + minorityViews + uncertainties）来润色 final.json。该文件体积随语料规模**线性增长**，是 hierarchical 的主要优化目标。
- **identity**：digest 恒 `mode="digest"`；top-percent 恒 `mode="top-percent-analysis"`（T8，互不混淆）。
- **hash 体系**：manifest 记录每 source 的 sha256；chunk 有 chunkHash；map 必须回传 chunkHash（staleMaps 门）；coverage.json 记录 manifestHash/mapSetHash 快照；reduce 启动重校。

### 2.2 Issue #3 规模实证测量（合成确定性语料，digest 全量管线实测）

测量方法：对 38/75/98/226/538 条合成回答（内容长度分布模拟真实知乎），跑 chunk → mock map（满足 verify 契约）→ verify → reduce，统计体积。标注：**MEASURED**（本脚本实测）/ **DERIVED**（由实测推导）/ **ESTIMATED**（线性启发式）/ **UNKNOWN**（无计量）。

| N（canonical sources） | chunks | map-results 总字节 (MEASURED) | reduce-input 字节 (MEASURED) | reduce-input 字符 (MEASURED) | 顶层估算 token 上限 (ESTIMATED) | final.json 字节 (MEASURED) | L1 模型调用数 (DERIVED = 非空来源数) |
|---|---|---|---|---|---|---|---|
| 38 | 1 | 15.5 KB | 14.5 KB | 9.6 K | ~3.3 K | 7.1 KB | ~38 |
| 75 | 2 | 30.6 KB | 28.2 KB | 18.8 K | ~7.4 K | 13.9 KB | ~75 |
| 98 | 3 | 40.3 KB | 36.7 KB | 24.4 K | ~11.4 K | 18.1 KB | ~98 |
| 226 | 6 | 92.8 KB | 84.5 KB | 56.5 K | ~21.0 K | 41.7 KB | ~226 |
| 538 | 14 | 221.5 KB | **201.1 KB** | **134.7 K** | **~52-95 K** | 99.5 KB | ~538 |

（token 上限 ESTIMATED：chunk `estimatedTokens.max` 合计 + reduce-input 按 chars/1.4-2.2 启发式；无真实 token 计量 → 货币/时延成本 **UNKNOWN**，T11 需加计量。）

**证据局限**：Issue #3 的真实 538-answer 抓取产物未在本仓库工作区（真实 corpus 不在仓库）；上表用合成语料按真实分布测量，结构性结论（reduce-input 线性增长、顶层压力点）不受合成影响，但绝对数值以真实语料为准（T10 验收时用真实 538 复测）。此外 map-results 字节为 **mock map** 实测（满足 verify 契约的结构化结果；真实 LLM map 的冗长程度可能不同），而 **reduce-input / final.json 为真实 `reduce.mjs` 产出**——顶层压力结论（基于 reduce-input）不受 mock 影响。

### 2.3 上下文压力量化结论

- L1 map 阶段：per-source，单次输入小（单 source 正文 + meta）——**无聚合压力**。
- **顶层撰写阶段：reduce-input 一次性全量进上下文**——38→538 时从 ~9.6K chars 涨到 ~134.7K chars（≈14×），对应 token ~3.3K→~52-95K，**超过常见本地模型单次上下文预算**。这是 hierarchy 要消除的重复上下文 / 顶层聚合压力。
- 重复开销：reduce-input 中 `sourceIndex`（每 source 的 questionId/answerId/relativePath/voteupCount）与 `sourceCoverage`（每 source summary）逐条复制，顶层并不需要全部明细，只需聚合后的主题/claim 与可追溯证据。

## 3. 兼容性架构对比（用户重点关注：保留既有 V0.2/V2 digest 行为）

| 维度 | OPTION A：additive hierarchical path（保留 flat digest 不变） | OPTION B：deterministic route large jobs into hierarchy（小任务走旧 flat） | OPTION C：replace flat final-reduce for all digest jobs |
|---|---|---|---|
| V0.2/V1/V2 兼容 | **最优**：flat digest 行为逐字节不变；hierarchy 是显式新入口（如 `digest --hierarchy` 或新 mode） | 兼容（小任务仍 flat），但需**已批准的规模阈值**（不得硬编码 10/20/50） | **破坏**：所有 digest 任务换执行结构，语义身份/恢复/验证链全部变动 |
| 既有 digest 输出兼容 | final.json/digest.md 消费合同不变（hierarchy 为 internal 结构） | 同 A（小任务）；大任务输出与 A 相同 | 需迁移 |
| 旧 CLI 行为 | 不变（默认 flat） | `digest` 无参数时行为随规模变化（**隐性行为切换**，审计难度高） | 全部变 |
| 既有测试 | 全部保留（flat 路径回归零改动） | 保留 + 需新增路由阈值测试 | 大面积重写 |
| 迁移风险 | 最低 | 中（路由判定 + 阈值审批） | 高 |
| 语义身份 | digest 身份不变 | digest 身份不变但执行路径隐变 | 身份仍 digest 但实现路径全换 |
| 可恢复性 | hierarchy 自带 level manifest + node 复用 | 同 A | 全量重设计 |
| 复杂度 | 中（新增一条路径） | 中高（路由 + 双路径共存） | 高 |
| 成本/上下文收益 | 大任务显式启用时收益相同 | 自动收益（需阈值） | 收益相同但代价最大 |

**RECOMMENDED：OPTION A**（additive hierarchical full-digest path，flat digest 行为不变）。
理由：最小爆炸半径（用户强偏好）；digest 消费合同（final.json/digest.md）保持兼容；既有 flat 回归套件（T8 merge 实测：corpus-anthology 143 + agent-pipeline 6 + zhihu-answer-grabber 507，`git diff --check` clean）零改动；hierarchy 是否启用由调用者显式决定（`--hierarchy`），无需未批准阈值自动路由；OPTION B 的确定性路由可作为**未来 product parameter**（需 PO 批准阈值）增量追加，不构成不可逆决策。

## 4. 层级架构对比（深度策略）

| 架构 | 说明 | 顶层输入 | 优点 | 缺点 |
|---|---|---|---|---|
| FLAT（现状） | L1 maps → final reduce | 全部 map 内容 | 零新增 | 顶层压力线性增长（§2.2） |
| TWO-LEVEL | L1 maps → 确定性组 → L2 group synthesis → final reduce | L2 组摘要（每组 ~M 条 claim） | 一层即可把 538 的顶层输入降到组级 | 超大规模单组仍可能超限（需组上限约束） |
| MULTI-LEVEL | L1 → L2 → L3… → final | 逐层收敛 | 任意规模可扩展 | 每层都需验证/身份/恢复，复杂度高 |
| ADAPTIVE | `while input 超限: 分组 → 验证 → 合成下一层`（深度由确定性输入规模推导，非固定） | 恒 ≤ 限制 | 深度随规模自适应；小任务不产生额外层（零开销）；不硬编码 10/20/50 | 循环终止性需由确定性上界保证（每层节点数单调减半/受限） |

**RECOMMENDED：ADAPTIVE（APPROVED，收敛不变量强化）**。深度不由 corpus answer count 硬编码，而由确定性判据推导：

```text
while currentLevel.nodeCount > 1 AND currentLevel_input 超限（节点数 或 序列化字节 或 估算 token 信封 超过有效 profile limit）:
→ deterministic group（controller-owned，§5）
→ validate groups（fail-closed）
→ synthesize next level（每组合成 1 个聚合节点，仅经 approved runtime）
→ 递归至顶层输入不超限 或 currentLevel.nodeCount == 1 → final reduce
```

**批准收敛不变量（APPROVED，强化）**：
- `if currentLevel.nodeCount == 1: hierarchy terminates`。
- 每个非终止聚合节点必须满足 **`2 <= childCount <= MAX_CHILDREN_PER_NODE`**；**禁止 synthetic single-child 聚合节点**（一个子节点的「聚合」无收敛意义，禁止）。
- 因此对每个生成的聚合层：**`nextLevel.nodeCount < currentLevel.nodeCount`**（严格递减 → 必然终止）。
- 若一组**合法（≥2 子节点）**无法装进 reviewed runtime input envelope → **FAIL CLOSED: `hierarchy_input_too_large`**；不得绕过预算、不得制造无限 single-child 层级。
- 不硬编码固定 two-level / three-level 架构（深度自适应）。

LIMIT 参数为 **reviewed runtime/execution profile parameters**（§5）：`MAX_CHILDREN_PER_NODE`（≥2 整数）与 `MAX_PROJECTED_INPUT_BUDGET`（与 approved runtime context envelope 兼容的正确定性上限）。T10 可从实际 qualified runtime/model 配置与实测投影序列化行为推导 safe defaults；有效参数必须显式记录、可复现、执行前验证、纳入 hierarchy manifest、直接或间接纳入 node inputHash、变化时使 stale 节点失效。若 runtime input/context budget 无法可靠建立 → **FAIL CLOSED: `hierarchy_runtime_budget_unknown`**（不猜测）。

## 5. Deterministic Grouping Contract（controller-owned，LLM 零裁决权，APPROVED）

- **group 输入顺序**：canonical chunk/节点顺序（chunk.mjs 已按 manifest.inputs 确定性顺序分块；chunkIds 稳定）。同输入同顺序同参数 → 同 group 身份。
- **批准分组算法（APPROVED）**：
  1. 取已验证子节点，按 canonical 确定性顺序排列；
  2. **left-to-right greedy packing**：仅当 **同时满足** `childCount <= MAX_CHILDREN_PER_NODE` 且 `projected serialized input size <= MAX_PROJECTED_INPUT_BUDGET` 时才加入下一个子节点；
  3. 加入下一个子节点将违反任一约束 → **关闭当前组，开启下一组**；
  4. 每个完成的非终止组必须**至少含 2 个子节点**（无 single-child 组）。
- **禁止**：LLM 选择 source 归属 / 节点去留 / 子节点省略；任何分组逻辑不得包含非确定性输入（时间戳、随机、LLM 输出）。
- **不变量**：`same inputs + same ordering + same parameters + same hierarchy contract version = same group identities`（跨运行逐字节可复现）。

## 6. Intermediate Node Identity / Hash Contract（APPROVED 概念）

节点最小充分结构（语义 APPROVED；精确序列化可由 Phase B/T10 归一化，但语义不变）：

```json
{
  "schemaVersion": 1,
  "hierarchyContractVersion": 1,
  "level": 1,
  "nodeId": "level-1-node-0001",
  "nodeHash": "sha256(规范化 node 内容 + children hashes + 契约版本)",
  "children": ["level-0-node-0002", "level-0-node-0007"],
  "childHashes": ["<child nodeHash>", "..."],
  "canonicalSourceIds": ["question-q-answer-1", "..."],
  "inputHash": "sha256(本节点输入投影的确定性序列化)",
  "runtime": "lmstudio-local-tool-less",
  "claims": [...],
  "minorityViews": [...],
  "uncertainties": [...]
}
```

- `nodeHash` 输入（精确）：`nodeId | level | schemaVersion | hierarchyContractVersion | children | childHashes | canonicalSourceIds | inputHash | runtime | claims | minorityViews | uncertainties` 的规范化 JSON 序列化 SHA-256。
- node identity/hash **必须至少检测**：changed child content/hash / changed child membership / changed ordering（order 规范处）/ changed grouping parameters（有效 profile 参数变化） / changed hierarchy contract version / changed projection/controller/runtime semantic identity（相关处）。
- 顶层节点（level=0 等价物）即现有 `map-chunk-*.json`（已带 chunkHash）；level ≥ 1 为新增合成节点。

## 7. Canonical Lineage Contract（T9 最重要决策）

三种候选（用户 §9）：

| | A：中间 claim 直接存 canonical evidenceSourceIds | B：claim 引用 child node IDs，verify 递归解析 | C（hybrid）：child refs + 确定性 materialized canonical source union |
|---|---|---|---|
| 机械验证 | 直接（每条 claim 的 ids ⊆ 本节点 union） | 需递归遍历（每层验证成本 O(depth×claims)） | 直接（union 已 materialized）+ 可抽查递归一致 |
| 文件体积 | 大（每条 claim 重复存储 source id 集合） | 最小（只存 node 引用） | 中（union 每节点一份，claims 不重复存） |
| 重复 source-ID 开销 | 高（高扇出 claim 反复复制） | 低 | 低 |
| stale 检测 | 节点 hash 覆盖 | 依赖子节点 hash 链（断链即失效） | 双保险（union + childHashes） |
| resume | 同 C | 同 C | 同 C |
| 腐坏风险 | 中（id 字符串易被模型幻觉） | 低（引用是结构化字段） | 低（union 由 controller 确定性 materialized，非模型生成） |
| 最终 traceback | 直接 | 递归展开 | 直接（union 即最终证据集合） |

**RECOMMENDED：OPTION C（hybrid）**：
- 每个中间节点由 controller 确定性计算并写入 `canonicalSourceIds = union(children.canonicalSourceIds)`（**非模型生成**——防模型幻觉 id；机械可验证）。
- claim 的 `evidenceSourceIds ⊆ canonicalSourceIds`（本节点 union）——LLM 只能从 union 中引用。
- verify 每层校验 `union(children.canonicalSourceIds) == parent.canonicalSourceIds`（递归不变量）→ 最终可**直接**追溯到 canonical source IDs，无需递归展开。
- **任何 summary 文本本身不得成为权威证据**；canonical source IDs 恒为 evidence root（R10 不变量 + V0.3 §7.3）。

## 8. Upper-Level Claim Rule（SOURCE COVERAGE ≠ CLAIM EVIDENCE）

- **SOURCE COVERAGE（层级事实）**：`union(所有 L1 canonicalSourceIds) == canonical manifest source set`（100%，硬门）；每层 `union(children sets) == parent set`（递归不变量）。
- **CLAIM EVIDENCE（声明证据）**：`parent.evidenceSourceIds ⊆ union(children.canonicalSourceIds)`（**必须**是已验证子集的子集/并集）；父 claim 不得发明 lineage。
- 父 claim 的每条 `evidenceSourceId` 必须已在**至少一个相关子 claim** 中作为证据出现（否则该 source 未对该父陈述提供支撑）→ 实现为：父 claim 证据 ⊆ union(子 claims 的 evidenceSourceIds)。这是「每声称的 source 必须被至少一个相关子 claim 代表」的机械形式。
- **结论**：不是每个最终 claim 都需要引用每个 source；但所有 canonical sources 必须被 hierarchy 覆盖，且每个最终 claim 的证据必须可追溯到其实际支撑来源。

## 9. Intermediate Validation（fail-closed，上层只消费已验证下层）

上层模型调用前，控制器必须 fail-closed 拒绝：
malformed node / duplicate node（同 nodeId 出现两次）/ missing child（children 或 childHashes 缺失）/ unexpected child（未声明）/ child hash mismatch（childHashes ≠ 实际子节点 nodeHash）/ node hash mismatch / source lineage escaping child union（parent.union ≠ union(children)）/ missing canonical source coverage（union 缺源）/ duplicate source ownership（同 source 出现在同级多个组——**顺序分批下天然不可能**，仍校验）/ stale generation（inputHash 过期）/ unsupported schema version / unsupported runtime（非 lmstudio-local-tool-less）/ invalid evidenceSourceIds（∉ union）/ interrupted partial level（level manifest 未闭合）。

**没有任何上层模型调用可在无效下层证据上继续**——任一失败 → 该层级生成中断，报告 `capability_isolation_unavailable` 或明确层级错误，不得产出部分「full」digest。

## 10. Coverage Accounting（机械可验证的 full-coverage 证明）

- 系统必须能证明 `union(all validated L1 canonicalSourceIds) == canonical manifest source set`。
- **每层强校验递归不变量**：`union(children source sets) == parent canonical source set`（集合相等，非仅包含）——任一节点违反即失败。
- 顶层（final）`union(final level nodes) == manifest source set` 成立后，才允许报告 `mode=digest` + full coverage。

## 11. Resume / Stale Semantics（APPROVED，stale 传播方向修正）

- **resume**：每节点独立文件 + 原子写（tmp+rename）；level manifest 记录 `{level, nodeIds, inputHashes, schemaVersion, hierarchyContractVersion, effectiveGroupingParams, runtime}`；节点 `inputHash` 允许仅 hash 匹配时复用。
- **复用条件（全部匹配才复用）**：`inputHash + childHashes + schemaVersion + hierarchyContractVersion + effective grouping parameters + required runtime/projection identity`；**「文件存在」不是有效缓存判据（FILE EXISTS != VALID CACHE）**。
- **stale 传播方向（修正 Phase A 措辞）**：若某 child/input 节点变化 → **使从该节点到 root 路径上的每个依赖 ANCESTOR 失效**（向上传播）；**未变化的 sibling 子树在其完整 identity/hash 契约仍验证通过时可复用**。示例：changed L1-A → 其 L2 parent stale → 该 parent 的 L3 parent stale → root stale；但无关的 L2 sibling 子树保持可复用。
- **部分层级中断**：中断于层级中间 → 重跑只生成缺失/失效节点（按 §6 hash 判定）；顶层 final reduce **不得**在整个 required level 验证通过前执行。
- **stale 定义（精确失效条件）**：canonical input 变化（inputHash）/ child 节点变化（childHashes）/ grouping 参数变化（effective params 进契约）/ schema version 变化 / hierarchy contract version 变化 / runtime identity 变化（若语义需要）/ projection/controller contract 变化（若相关）。nodeHash 输入集即上述的机械编码（§6）。

## 12. Capability Isolation Interaction（继承 T6，不新增 runtime）

- 任何 LLM 派生的中间合成只允许使用 **lmstudio-local-tool-less**（repository truth：唯一 `CAPABILITY_ISOLATION_AVAILABLE=YES` runtime）。
- **不添加**新 runtime；**不弱化**投影 sanitizer / controller 边界（T6 `lmstudio-projection.mjs` / `lmstudio-tool-less.mjs` 不变）。
- 每个 hierarchical 模型调用只接收**确定性、已验证、为该节点所需**的投影数据（子节点 claims + union + meta），无原始 fs/network/shell 能力。
- 每组 L2 合成的投影同样过 T6 fail-closed 控制器（tools:[] / tool_choice:none / json_schema / MODEL_VISIBLE_TOOL_COUNT=0）。

## 13. Model Quality vs Security（不混淆）

- Qwen3 1.7B 已演示偶发质量失败（confidence 越界等，T8 live smoke 实证 fail-closed 正确拒绝）——**MODEL_QUALITY ≠ CAPABILITY_ISOLATION**。
- T9 定义产品合同**不假装 1.7B 足以支撑 538-answer 生产合成**；L2 合成节点数量级更小（组级），质量压力低于单次全量顶层。
- 若需要 model-routing 灵活性：specify runtime/model 边界，**不硬编码 vendor/model**（除非技术要求）；任何 model 仍须经 approved capability-isolated runtime。

## 14. Final Output Compatibility（APPROVED with clarification）

- **APPROVED**：既有 flat digest 实现行为**保持不变**；public/canonical digest 消费身份对 flat 与 hierarchical 均为 `mode="digest"`；既有 public digest schema/consumer contract 保持兼容。
- **「Preserved」定义（批准澄清）**：① 旧 flat 路径原样保留；② 既有调用方有效；③ 既有 public digest 字段语义保留；④ hierarchy **不静默重定义** digest 的 coverage/evidence 行为。**不要求** hierarchical 语义输出与 flat 模型合成结果 byte-for-byte 相同。
- **internal hierarchy artifacts**（node 文件 / level manifests / hashes / lineage / execution metrics）为内部结构，**不要求**成为 public final.json 合同字段；任何新 public final.json 字段须在实现前做 **explicit additive compatibility 分类**（additive/required/breaking）。
- 顶层撰写输入从「全部 reduce-input」变为「顶层节点 claims + 披露/provenance」，输出仍写入同一 final.json schema。

## 15. Relation to Top-percent（identity 严格分离，APPROVED）

- `top-percent-analysis != digest`；hierarchical digest 是 **100% full coverage digest 的实现策略**。
- hierarchy **不得**继承 requestedPercent / selected-subset / sampled identity；不触碰 T8 代码与行为（T9 不改 T8，T10 也不得改 T8——除非未来 ticket 显式创建共享原语）。
- `mode` 判定：hierarchy 路径产出 `mode="digest"`（与 flat 相同）；top-percent 路径恒 `mode="top-percent-analysis"`。

## 15.5 Failure Semantics（APPROVED）

- **无静默 fallback**：hierarchical full digest 不得静默降级为 sampled / partial hierarchy / missing-node hierarchy / unverified summaries / best-effort full digest。
- **若 hierarchy 被显式请求且无法满足其合同 → FAIL CLOSED**；**不得**静默切到 flat 只为产出答案。
- caller 可在 hierarchy 失败后**显式单独重试 flat digest**（flat 是独立保留路径）。
- 关键 failure 状态码（Phase B 归一化）：`hierarchy_input_too_large`（合法 ≥2 子组无法装进 envelope）、`hierarchy_runtime_budget_unknown`（runtime budget 无法可靠建立）。

## 16. T10 Acceptance Test Contract（实现前定义，Phase B 批准后写入 T10）

基于用户 §20 模板细化（编号对应）：

1. **L1 全覆盖**：每个 canonical source 恰好出现在所需 L1 覆盖中（union(L1) == manifest set，无重复无缺失）。
2. **分组确定性可复现**：同输入同参数两次分组 → 逐字节相同 group 身份。
3. **节点身份可复现**：同输入同参数 → nodeId/nodeHash 相同。
4. **缺失子节点 fail**：任一子节点缺失 → 父合成 fail closed，无部分输出。
5. **多余子节点 fail**：未声明子节点出现 → fail。
6. **子节点 hash 破坏 fail**：篡改子节点 → childHashes 不匹配 → fail。
7. **stale 节点失效/重生成（向上传播）**：canonical input 变化 → 该节点到 root 路径上的每个依赖祖先失效（inputHash/childHashes 变），无关 sibling 子树保持可复用。
8. **lineage 越界 fail**：claim.evidenceSourceIds ∉ 本节点 union → fail。
9. **最终 claim 追溯**：final claims 的每个 evidenceSourceId ∈ manifest set。
10. **中断恢复**：层级中间中断 → 重跑只补缺失/失效节点。
11. **flat 兼容**：既有 flat digest 输出/行为逐字节不变（回归套件）。
12. **top-percent 不变**：T8 行为与测试零改动。
13. **capability isolation 保持**：所有层级模型调用经 lmstudio-local-tool-less + 控制器（tools:[]/tool_choice:none/json_schema）。
14. **缺 1 个 L1 source 不得声称 full coverage**：union 缺源 → `mode=digest`/full coverage 不可达（fail closed）。
15. **幂等复用**：unchanged 输入重复运行复用有效节点（0 新增模型调用）。
16. **定向失效**：改一个子节点只使受影响祖先失效（可行处）。
17. **规模行为**：50 / 200 / 500-source 合成或真实语料（T10 用 Issue #3 真实 538 复测 §2.2 测量）。

## 17. Unresolved Risks

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 分组上限参数（MAX_CHILDREN_PER_NODE / MAX_PROJECTED_INPUT_BUDGET）具体数值 | **APPROVED 澄清**：数值是 reviewed **runtime/execution profile parameters**（非 product semantics）；T10 从实际 qualified runtime/model 配置与实测投影序列化推导 safe defaults；约束为 MAX_CHILDREN_PER_NODE ≥ 2 整数、MAX_PROJECTED_INPUT_BUDGET 与 approved runtime context envelope 兼容；有效参数必须显式记录/可复现/执行前验证/进 manifest/进 inputHash/变化时失效 |
| R2 | L2 合成质量（1.7B 对组级聚合的忠实度）未知 | §13：不假装质量；T10/T11 dogfood 用真实语料评估；T10 验收含 500-source 规模测试 |
| R3 | 递归覆盖不变量在超大语料下的验证成本 | 每层 union 由 controller 确定性计算（O(children)），非模型生成；验证与合成同阶 |
| R4 | hierarchy 内部结构复杂度 | OPTION A（additive）隔离；flat 路径零改动；hierarchy 仅显式启用 |
| R5 | final.json 兼容性漂移 | §14：hierarchy 为 internal；flat 行为/消费合同不变；新 public 字段需 additive 分类 + PO 批准 |
| R6 | 无 token 计量 → 成本仅 ESTIMATED | T11 加真实计量校准（与 T7 R3 一致） |
| R7 | real 538 corpus 不在仓库 → 绝对数值为合成测量 | T10 验收时用真实 538 复测；结构性结论不受影响 |
| R8 | runtime context budget 无法可靠建立 | FAIL CLOSED: `hierarchy_runtime_budget_unknown`（不猜测） |

## 17.5 决策包速览（STOP format — 已批准版本，含 MODIFY 修正）

```text
RECOMMENDED_ARCHITECTURE:
  OPTION A — additive hierarchical full-digest path；flat digest 行为不变；
  hierarchy 为 internal execution structure（显式启用，如 --hierarchy）；
  V0.3 不自动路由大任务进 hierarchy（OPTION B 仅在 T11 50/200/500 dogfood 出证据后重估）

HIERARCHY_DEPTH_POLICY（APPROVED 强化）:
  ADAPTIVE —— while currentLevel.nodeCount > 1 AND 超限: deterministic group → validate
  → synthesize next level；if nodeCount == 1: terminate；每个非终止聚合节点
  2 <= childCount <= MAX_CHILDREN_PER_NODE（禁止 single-child）；nextLevel.nodeCount
  < currentLevel.nodeCount（严格递减）；合法 ≥2 子组无法装进 envelope → FAIL CLOSED
  hierarchy_input_too_large

GROUPING_POLICY（APPROVED）:
  controller-owned left-to-right greedy packing（canonical 顺序）；加入下一子节点仅当
  childCount <= MAX_CHILDREN_PER_NODE AND projected serialized input <=
  MAX_PROJECTED_INPUT_BUDGET；违反任一约束 → 关组开新组；每个非终止组 ≥2 子节点；
  LLM 零分组裁决权；同 inputs+ordering+parameters+contract version → 同 group 身份

INTERMEDIATE_NODE_IDENTITY（APPROVED 概念）:
  { schemaVersion, hierarchyContractVersion, level, nodeId, nodeHash, children,
    childHashes, canonicalSourceIds, inputHash, runtime, claims, minorityViews,
    uncertainties }；nodeHash 输入含 childHashes + canonicalSourceIds + 契约版本 +
  有效分组参数 → 检测 stale/membership/order/grouping/version/runtime 变化

LINEAGE_POLICY（APPROVED）:
  HYBRID —— child refs + controller 确定性 materialized canonical source union；
  node.canonicalSourceIds == union(children.canonicalSourceIds)（LLM 不得发明/修改）；
  COVERAGE（node.canonicalSourceIds）≠ CLAIM EVIDENCE（claim.evidenceSourceIds ⊆
  被消费子 claims 的 validated evidence union）；summary 不是权威证据；
  canonical source IDs 恒为 evidence root（R10）

VALIDATION_POLICY（APPROVED）:
  每层 fail-closed（malformed/duplicate/missing/unexpected child、child/node hash
  mismatch、lineage escape、coverage miss、stale、unsupported schema/contract
  version/runtime、invalid evidence、interrupted level）；无上层模型调用可在无效
  下层证据上继续

RESUME_STALE_POLICY（APPROVED，传播方向修正）:
  节点独立文件 + 原子写 + level manifest + inputHash；inputHash+childHashes+
  schemaVersion+hierarchyContractVersion+effective grouping params+runtime 全匹配
  才复用（FILE EXISTS != VALID CACHE）；child/input 变化 → 向上使路径上所有依赖祖先
  失效（无关 sibling 子树保持可复用）；顶层 final 需整个 required level 验证通过

FINAL_OUTPUT_COMPATIBILITY（APPROVED with clarification）:
  flat digest 行为不变；public/canonical 消费身份 mode="digest"（flat 与 hierarchical 一致）；
  既有 public digest schema/consumer contract 兼容；「Preserved」= 行为+消费合同稳定，
  非 byte-identical 模型输出；internal hierarchy artifacts 不进 public final.json；
  新 public 字段需 additive 分类 + PO 批准；无 schema migration

EXISTING_FLAT_DIGEST: PRESERVED（默认 flat；hierarchy 显式启用；无静默 fallback）

BREAKING_CHANGE: NO（批准包；flat 行为/消费合同不变）

SCHEMA_VERSION_CHANGE: NO（批准包；共享 handoff schema / final.json 消费合同不变）

EXPECTED_COST_CONTEXT_EFFECT:
  DERIVED（结构性）：顶层撰写输入从「全部 reduce-input」（538: ~135K chars）降为
  「顶层节点 claims + 披露」；L1 调用数不变（= 非空来源数）；
  ESTIMATED：顶层 token 压力随层数收敛；UNKNOWN：真实 token/时延/货币（T11 校准）

ALTERNATIVES_REJECTED:
  OPTION B（自动路由）—— REJECT（V0.3）：需已批准阈值，隐性行为切换；T11 dogfood 后重估
  OPTION C（全部任务换 hierarchy）—— REJECT：V0.2/V2 兼容与迁移风险高
  FLAT（不引入 hierarchy）—— REJECT（作为目标）：538 顶层 ~135K chars 超出本地上下文（实测）
  固定 two-level/three-level —— REJECT：深度硬编码不必要；ADAPTIVE 严格收敛
  single-child 聚合节点 —— REJECT：无收敛意义，禁止
  Lineage A（每 claim 直接存 canonical ids）—— REJECT：体积/重复开销大
  Lineage B（仅 child 引用递归解析）—— REJECT：验证成本高、traceback 复杂

UNRESOLVED_RISKS:
  R1 有效 profile 参数数值 → T10 从 qualified runtime 推导 safe defaults（约束见 §5/§17 R1）
  R2 L2 合成质量（1.7B 组级聚合忠实度）→ T10/T11 dogfood 真实语料评估，不假装质量
  R3 递归覆盖不变量验证成本 → union 由 controller 计算（O(children)），与合成同阶
  R4 hierarchy 内部复杂度 → OPTION A additive 隔离，flat 零改动
  R5 final.json 兼容漂移 → §14 消费合同不变 + additive 分类另批
  R6 无 token 计量 → T11 加计量校准
  R7 real 538 corpus 不在仓库 → T10 用真实 538 复测；绝对数值为合成测量
  R8 runtime budget 无法可靠建立 → FAIL CLOSED hierarchy_runtime_budget_unknown

WHY_THIS_PACKAGE:
  1. 最小爆炸半径：flat digest 行为/消费合同/测试不变（OPTION A + PRESERVED）；
  2. 精确打击实测压力点（顶层 reduce-input 线性增长），非猜测；
  3. 完全确定性：分组/节点身份/lineage union 全 controller-owned，LLM 零裁决权；
  4. 机械可验证：递归覆盖不变量 + nodeHash/childHashes/inputHash 全链 hash；
  5. 安全继承 T6：只 lmstudio-local-tool-less，投影/控制器边界不弱化；
  6. 身份严格隔离：hierarchy 产出 mode="digest"（full），top-percent 不受影响；
  7. 不硬编码任意阈值：LIMIT 为 reviewed runtime/execution profile parameters，
     T10 从 qualified runtime 推导 safe defaults（约束见 §5）。
```

## 18. PRODUCT_OWNER_DECISION RECORD（2026-08-23）

```text
DECISION: MODIFY + APPROVE AS MODIFIED（product-owner, 2026-08-23）
修改项:
  M1  架构 OPTION A 批准（additive explicit；V0.3 不自动路由大任务进 hierarchy；
      自动路由仅在 T11 50/200/500 dogfood 出证据后重估）
  M2  收敛不变量强化：if nodeCount==1: terminate；每个非终止聚合节点
      2 <= childCount <= MAX_CHILDREN_PER_NODE；禁止 synthetic single-child；
      nextLevel.nodeCount < currentLevel.nodeCount（严格递减）；
      合法 ≥2 子组无法装进 envelope → FAIL CLOSED hierarchy_input_too_large
  M3  分组算法明确：left-to-right greedy packing（childCount + projected size 双约束）
  M4  LIMIT 数值降级：MAX_CHILDREN_PER_NODE / MAX_PROJECTED_INPUT_BUDGET 是 reviewed
      runtime/execution profile parameters（非 product semantics）；T10 从 qualified
      runtime 推导 safe defaults；有效参数必须显式记录/可复现/执行前验证/进 manifest/
      进 inputHash/变化时失效；runtime budget 不可靠 → FAIL CLOSED hierarchy_runtime_budget_unknown
  M5  节点身份 + hierarchyContractVersion；nodeHash 输入扩展（分组参数、契约版本等）
  M6  Lineage 批准为 HYBRID；COVERAGE（node.canonicalSourceIds）≠ CLAIM EVIDENCE
      （parent claim evidence ⊆ 被消费子 claims 的 validated evidence union）；
      LLM 不得发明/修改 source union
  M7  stale 传播方向修正：child/input 变化 → 向上使路径上所有依赖祖先失效；
      无关 sibling 子树保持可复用（非「重算后代」）
  M8  final-output 澄清：flat 行为/消费合同稳定（非 byte-identical 模型输出）；
      internal hierarchy artifacts 不进 public final.json；新 public 字段需 additive 分类
  M9  无静默 fallback：hierarchy 显式请求且无法满足合同 → FAIL CLOSED；
      caller 可显式单独 retry flat
批准未改项:
  full-coverage 不变量（100% / final claim 追溯 / lineage 不切断）
  每层递归覆盖不变量 union(children)==parent；L1 union == manifest set
  validation fail-closed 清单；capability 仅 lmstudio-local-tool-less；
  MODEL_QUALITY != RUNTIME_SECURITY；top-percent 隔离；T10 acceptance 17 项
兼容性:  BREAKING_CHANGE = NO；SCHEMA_VERSION_CHANGE = NO（批准包）
```

## 19. PHASE B 归一化范围（本分支执行）

- 本决策文档（记录批准 + 修正被取代措辞）✅
- V0.3 Spec §7.3 / §15-E / §16 OPEN-D4 / §17 T9-T10
- Product Behavior Contract §3.18
- project-memory（durable D4 合同，无 accepted 前不写——本分支仅记录已批准事实）
- corpus reference/mode docs（仅在表达批准合同所必需时）
- 不实现 T10 生产代码；不改 T8 行为；不改共享 handoff schema
