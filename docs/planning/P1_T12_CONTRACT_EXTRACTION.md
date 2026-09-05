# P1-T12 CONTRACT_EXTRACTION — RCE Corpus Selector (Issue #44)

```text
TICKET_ID          = P1-T12 (GitHub Issue #44, parent #32)
TICKET_LANE        = V2 (HIGH-RISK; counterexample-first TDD applied)
UPSTREAM_SEAM      = T09_TO_T12_V1            （P1_SEAM_CONTRACTS_V1 §SEAM A）
CONTRACT_FIXTURE   = research-orchestration/test/fixtures/p1-seams/seam-a/
OUTPUT_SEAM        = T12_TO_T13_V1            （P1_SEAM_CONTRACTS_V1 §SEAM B）
OUTPUT_VALIDATOR   = research-orchestration/test/helpers/p1-seam-contracts.mjs
                     validateSelectedResearchCorpus (FROZEN ORACLE, read-only;
                     本实现不修改 validator / fixture / 任何共享文件)
INTEGRATION_STATUS = NOT_YET_REAL_UPSTREAM    （Lane V2 §G 绑定；T09 PR #68 未 merge）
MAX_REACHABLE_STATE = IMPLEMENTATION_REVIEWED （INTEGRATION_ACCEPTED 需真实上游组合过 seam contract）
CODEGRAPH_BASE_SHA = d1b458571518965ec7f08954b8fdf989c9655884
                     （本 session CodeGraph MCP 未 attach —— 按任务书改为直接读取
                     真实模块 grounding；BASE 即 worktree branch base）
DATE               = 2026-09-05
```

## 1. UPSTREAM 合同提取（SEAM A — T09_TO_T12_V1）

Input artifact = 真实 T09 producer `deriveResearchCorpusManifest` 输出
（producer-grounded R1，REVIEWED_T09_SHA = 4789382f36d179dc13957f2c23748f169875d7a2）：

- shape 逐字段：P1_SEAM_CONTRACTS_V1.md:85-115（OUTPUT_OBSERVABLE_SHAPE）；
- validator：test/helpers/p1-seam-contracts.mjs:154-226
  （type/schemaVersion/planHash/selectionIdentity/groups/accounting/manifestHash
  自校验重算 :127-130 + canonicalJsonForHash :111-118）；
- TYPE_B conformance 模式参照：test/p1-seam-a-producer-conformance.test.mjs。

本模块对 manifest 做 **最小前置校验**（rce-corpus-selector.mjs:175-193：
type/schemaVersion/planHash 格式/groups 非空 + group identity/refs）；
manifestHash 自校验与完整 SEAM A 校验归 frozen validator 所有，不在 lib 内复制
（单一权威，避免第二 validator 体系）。测试侧用 frozen validator 交叉验证。

### 关键 upstream 事实（驱动本设计）

| 事实 | 依据 | 对 T12 的后果 |
|---|---|---|
| SEAM A 是 **组级** 合同：只有 answersRel/answersHash，无逐 source 条目 | seam doc :98-104 + F1 审计（`selectedSourceCount` 被移除，seam doc :193） | eligible 的逐 source 分解（canonicalSourceId + contentHash）由调用方从 verified answers artifact 分解后传入；T12 不发明 source 级 seam 字段 |
| `verifiedArtifactRef`/`contentHash` 在 R1 已被更名为真实字段 | F1 审计表 seam doc :189 | SEAM B 输出的 `verifiedArtifactRef` 由 selector **专门从 manifest.answersRel 派生**（rce-corpus-selector.mjs:458-461）——mechanically 保证 verified-only（§SEAM B 不变量 5） |
| groupId == questionId（T08 权威格式，不冻结前缀） | seam doc :198（F1 审计移除 "q-" 前缀）+ multi-group-execution.mjs:240-263（T09 边界） | selector 原样透传 manifest groupId，不发明前缀（测试断言 groupId == questionId 同族） |
| 密集几何信号形状 `{id, relevance, redundancy, novelty}` + pairwiseSimilarity | dense-geometry.mjs:244-258, :191-259 | denseSignals 按 canonicalSourceId 键控消费；MMR 需要时消费 T11 pairwise {ids, matrix} |
| tie-break epsilon 权威 | dense-geometry.mjs:76（DENSE_SIMILARITY_EPSILON） | selector 导入消费，不发明新 epsilon |
| DENSE 不可用 → FAIL CLOSED；popularity-anchor-only 非法 | spec :608-617（§10.2） | 每个 eligible source 必须有 dense signal，缺失 → `RCE_DENSE_SIGNAL_MISSING`（无 popularity-only 降级路径） |

## 2. OUTPUT 合同实现（SEAM B — T12_TO_T13_V1）

- shape：P1_SEAM_CONTRACTS_V1.md:227-251；frozen validator：
  test/helpers/p1-seam-contracts.mjs:230-309（含 totals 交叉核对 :296-307、
  exclusion sum == eligible - selected :286-289、analyzed 全树禁用 :240-242）。
- 主入口：`selectResearchCorpus({manifest, sourcesByGroup, denseSignals,
  densePairwise?, options?})` — lib/rce-corpus-selector.mjs:350。
- 自审计入口：`verifySelectedResearchCorpus(artifact)` — :515（selectResearchCorpus
  返回前自调用；测试用它对四个 SEAM_B_* fail-closed 码逐一反例验证）。
- identity：`selectedCorpusIdentity = "sha256:" + sha256(canonicalJson(
  {planHash, groups:[{groupId, selectedSourceRefs}]}))`，canonicalJson 与 frozen
  validator / T09 producer 同一 key-sorted 域（:135-147）；groups/refs 排序归一 →
  输入顺序无关、字节级可复现。

### Selection policy（frozen baseline, Spec §3）

1. **Question/Source-group Preservation**（§3.1）：逐组独立选择（结构性保证大组
   永远无法缩减小组的选择）；anti-starvation floor = 1 —— 组内全部 source 低于
   relevance floor 时保留 rank-1（记录于 accounting，不静默）；verified 组零
   eligible source → `RCE_PRESERVATION_UNREPRESENTABLE` fail closed（SEAM B
   selectedSourceRefs 非空要求下该组不可表达）。
2. **Popularity Anchor（非权威）**（§3.1/§3.2）：answerCount 不进入 score、排序、
   exclusion 决策与 corpus identity（测试：popularity 放置翻转 → 产物字节不变；
   popularity 无法改变 preservation 保源选择）。
3. **Dense Relevance/Novelty**：score = relevance + DEFAULT_NOVELTY_WEIGHT ×
   novelty；tie-break = DENSE_SIMILARITY_EPSILON 内并列 → canonicalSourceId ASC
   （消费 T11 语义）。
4. **Optional Lightweight Redundancy（MMR）**：默认 OFF（§3.2：MMR 仅 optional）。
   开启需显式 `options.mmr.enabled=true` 且**必须**提供 T11 pairwiseSimilarity
   （缺失 → `RCE_MMR_PAIRWISE_MISSING`，无静默降级）；greedy
   argmax(lambda·rel − (1−λ)·maxSim-to-selected)，maxSim ≥
   nearDuplicateSimilarity → 排除并记 `nearDuplicate`；开启时保持确定性 +
   identity 稳定（测试：双跑字节一致、输入乱序 identity 不变）。

### Exclusion reason vocabulary（V1）

`belowRelevanceFloor`（与 frozen fixture 词表一致）、`nearDuplicate`（frozen
fixture 词表）。新增 category = V1 兼容（seam doc :311-312）。

## 3. D-4/D-5 参数验证记录（REQUIRED_EVIDENCE）

按 Ticket Graph（P1_TICKET_GRAPH_V1.md:250）与 Planning Gate 01
（P1_IMPLEMENTATION_PLANNING_GATE_01.md:213-222） delegation，D-4/D-5 数值归
T12 implementation validation。以下默认值全部为**导出的具名 tunable**
（rce-corpus-selector.mjs:90-96），无 inline magic number：

| 常量 | 值 | 决定 | 状态 |
|---|---|---|---|
| `DEFAULT_RELEVANCE_FLOOR` | 0 | 非自然边界（要求非负语义相关度），非发明阈值 | D-5 provisional |
| `DEFAULT_NOVELTY_WEIGHT` | 0.25 | relevance/novelty 权重比（D-4 直接授权域） | D-4 provisional，待实现验证数据 |
| `DEFAULT_MMR_LAMBDA` | 0.7 | 经典 MMR trade-off（D-4 optional redundancy params） | D-4 provisional |
| `DEFAULT_NEAR_DUPLICATE_SIMILARITY` | 0.95 | 近重复判定门限（D-4） | D-4 provisional |

验证方式：参数以 option 覆盖并逐一路径测试（floor 触发 / MMR 开关 /
identity 稳定性）；未引入 six hard quotas、无 top-percent 规模控制（Spec §3.1
明文排除）。**DECISION_REQUIRED（非阻塞）**：D-4 权重/Lambda/门限的最终数值应在
真实双域数据上做实现验证后由 product-owner 确认；当前值是可运行 provisional
baseline，不 gate T13 消费的产物形状（P1_PARALLEL_EXECUTION_CONTRACT_V1.md:188）。

## 4. RELEVANT_SURFACE_MANIFEST（实际读取面，@ CODEGRAPH_BASE_SHA）

Upstream producers（只读，未修改）：
- research-orchestration/lib/multi-group-execution.mjs:149（selectionIdentity）,
  :537（deriveVerifiedGroupRefs valid-only）, :573-622（deriveResearchCorpusManifest,
  manifestHash 域）, :131-138（canonicalJson）
- research-orchestration/lib/dense-geometry.mjs:76（EPSILON）, :191-259
  （computeDenseGeometry signals/pairwise）, :271-289（pool adapter）
- research-orchestration/lib/source-group-selection.mjs:434（isCanonicalQuestionId,
  T08 identity 权威——经 T09 :250 间接消费）
- research-orchestration/lib/coverage-state.mjs:61（OWNER_T12_SELECTION）,
  :739-797（Hook 3 updateSelectionAccounting —— T12 对 CoverageState 的唯一写
  面；本票 IN_SCOPE 的 "selection accounting 更新经 T07 hook" 由此 hook 承接，
  runtime wiring 归集成阶段，本模块输出 accounting 字段即其数据源）

Frozen oracle / contracts（只读）：
- test/helpers/p1-seam-contracts.mjs:111-130（canonical hash 域）, :154-226
  （SEAM A validator）, :230-309（SEAM B validator）
- test/p1-seam-contracts.test.mjs:113-151（SEAM B golden fixtures 语义）
- test/p1-seam-a-producer-conformance.test.mjs（TYPE_B 模式参照）
- docs/planning/P1_SEAM_CONTRACTS_V1.md §SEAM A/§SEAM B
- docs/planning/P1_PARALLEL_EXECUTION_CONTRACT_V1.md §E3/§F/§G/§I
- docs/specs/p1-cross-question-deep-research.md §3/§7.2/§9.2/§10.2/§14（D-4/D-5）
- docs/planning/P1_TICKET_GRAPH_V1.md:250（D-4/D-5 delegation）

Produced（本票所有权内）：
- research-orchestration/lib/rce-corpus-selector.mjs
- research-orchestration/test/p1-t12-rce-corpus-selector.test.mjs

## 5. 合同偏差与决策记录

1. **无 frozen seam 冲突**：输出通过 frozen `validateSelectedResearchCorpus`
   （测试逐场景断言），未触发 FIXTURE_PRODUCER_DRIFT；未修改任何共享文件
   （coverage-state / multi-group-execution / seam validator / fixtures /
   package.json 均只读）。
2. **eligible 来源**（新发现的理解点）：SEAM A 为组级合同，不含逐 source 分解；
   T12 的 eligible 输入面（sourcesByGroup）属 caller-owned 分解责任。seam 文档
   未显式声明该输入面 —— 集成阶段需要 caller adapter（从 verified answers.json
   分解 source + hash + T11 信号注入）。本票范围内不发明该 adapter（避免猜测
   answers.json schema 之外的合同），已留作集成训练工作量。
3. **T07 hook wiring**：Issue #44 IN_SCOPE 含 "向 CoverageState 提供 selection
   accounting 更新（经 T07 hook）"。Hook 3（coverage-state.mjs:739）接受
   selectedCorpusSourceSet / selected_source_group_count / largest_group_share /
   per_group_selection_coverage 等，均可由本模块输出的 corpus accounting 机械
   派生。但 wiring 属 orchestration 组装层（需要真实 CoverageState 实例与 run
   流程），隔离实现票只产出 accounting 数据面 + 上面 2 的同一 caller adapter
   边界；未写 hook 调用路径，避免在无真实 upstream 的分支上发明第二 runner。
   **DECISION_REQUIRED（集成阶段）**：确认 buildSelectionAccountingUpdate 薄适配
   层的归属票（T12 集成 follow-up vs T15 wiring）。
4. **canonicalSourceId 编码**：合同 delegated（seam doc :253-255）。测试 fixture
   惯例 `<questionId>-a-<n>`；selector 不校验内部编码，只要求 stable identity +
   sha256 contentHash 配对（合同原样）。**全局唯一性（reviewer round 1, F1）**：
   canonicalSourceId 必须全局唯一 —— denseSignals 按 canonicalSourceId 全局键控，
   跨组重复会静默共享同一 dense signal；selector 现已机械强制（跨组重复 →
   `RCE_DUPLICATE_CANONICAL_SOURCE_ID` fail closed）。
5. 未新增 npm 依赖、未改 package.json、无 playwright/browser 代码、无网络调用。
6. **verified accounting 语义（reviewer round 1, F2）— DECISION_REQUIRED
   （product owner）**：§SEAM B 允许 selected ≤ verified ≤ eligible，存在两种
   同样合法的读法：(a) **verified := selected**（verified-only：仅被选中的
   source 计入 verified —— 当前实现的 pinned reading，赋值处已注释说明，并有
   pinning 测试锁定 `accounting.verified === accounting.selected`）；(b)
   **verified := eligible**（每个 eligible candidate 都从 verified group
   artifact 分解而来，故全部计入 verified）。该措辞直接决定 T07/T15 的
   reconciliation 语义，需 product-owner 明确后冻结；在决定前保持读法 (a)，
   任何静默切换都会被 pinning 测试拦截（见测试
   "accounting.verified is PINNED to accounting.selected"）。
