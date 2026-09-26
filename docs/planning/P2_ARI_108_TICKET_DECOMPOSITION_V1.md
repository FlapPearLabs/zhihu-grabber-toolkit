# P2-ARI #108 Ticket Decomposition V1 — Gap-aware Targeted Re-query（Planning Only）

> **命名守卫**：本文 `P2-ARI` = `P2 / ADAPTIVE_RESEARCH_INTELLIGENCE`（#107–#112），
> 指 adaptive-research-intelligence backlog。它**不是** 2026-08-25 Product Direction 中的
> `LEGACY P2 = AUTHOR / PERSONAL INTELLIGENCE`。本文不修改、不重解释、不覆盖 LEGACY P2。

```text
DOCUMENT_ID = P2_ARI_108_TICKET_DECOMPOSITION_V1
STATUS = APPROVED / INTEGRATED（15 票 P2A-T01…T15 与 19 条直接边语义冻结，
         语义 = 被审 SHA 1de3c5481d876fefc2c59f17206a65e0b62fcff8，未因提升而改写）
AUTHORITY_CLASS = AUTHORITATIVE_TICKET_PLAN（PLANNING / EXECUTION TICKET PLAN）
                  —— repository-native 等价词汇；参照 AGENTS.md §5.1
                  "Approved Spec / governance authority change" 的双 reviewer quorum
BASE_MASTER_SHA = 504021b8965956d19fe4a17a9181cfe2c6bba93f
BRANCH = planning/p2-ari-f02-ticket-decomposition
TARGET_ISSUE = #108（P2-F02 Gap-aware Targeted Re-query）
APPROVED_SPEC = docs/specs/p2-ari-f02-targeted-requery.md（STATUS = APPROVED；语义唯一权威）
SEAM_AUTHORITY = docs/planning/P2_ARI_108_TARGETED_REQUERY_SEAM_MAP_V1.md（S1–S11）
                 docs/planning/P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1.md（E/F/G/H = 1）
DECISION_AUTHORITY = docs/architecture/key-decisions.md D12（STATUS = APPROVED）
SCOPE = 仅本文件 + P2_ARI_108_TICKET_GRAPH_V1.md；零代码 / 零 Spec / 零 governance 改动
TICKET_COUNT = 15（P2A-T01 … P2A-T15）
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
ISSUE_CREATION_AUTHORIZATION = YES
  —— 仅授权按本文发布 15 张 #108 child Issue；
     Issue 创建授权 **≠** 实现授权（IMPLEMENTATION_AUTHORIZATION 仍为 NONE）
REVIEWED_PLANNING_SHA = 1de3c5481d876fefc2c59f17206a65e0b62fcff8
REVIEWED_PLANNING_BRANCH = planning/p2-ari-f02-ticket-decomposition
PROMOTION_BASE = 1de3c5481d876fefc2c59f17206a65e0b62fcff8（提升只改状态/权威元数据）
VERSION_ASSIGNMENT = UNASSIGNED
PROJECT_MEMORY_UPDATE_REQUIRED = NO
REVIEWED_CANDIDATE_SHA = 2e40724b6405d50e80737aa9a07a76f1b92fe601
Date: 2026-09-26
```

## 0. 本文件是什么、不是什么

- **是**：把**已批准**的 #108 架构 / seam 合同消费为实现 ticket 的边界划分（Architecture → Seam → Ticket）。
- **不是**：
  ```text
  × 重新设计 #108 架构（D1–D6 / D12-1..D12-8 一律不重开）
  × 新 seam、新语义、新 Spec 条款
  × 实现授权（IMPLEMENTATION_AUTHORIZATION = NONE）
  × GitHub child Issue 的**执行**授权（ISSUE_CREATION_AUTHORIZATION = YES 仅授权发布
    Issue 文本；每张 child Issue 初始状态 = PLANNED_NOT_AUTHORIZED，
    Problem statement 之外不得据此开工）
  × 产品价值声明（#108 是否提升研究质量依赖 #107，见 §9）
  ```
- 任何 ticket 的定义存在 **≠** 该 ticket 已被授权执行。实现授权发生在
  `TICKET_GRAPH_INTEGRATION_AND_ISSUE_CREATION_AUTHORIZATION` 之后的独立 gate。

---

## 1. Authority baseline（fresh remote truth）

| 项 | 值 / 结论 |
|---|---|
| `git ls-remote --refs origin refs/heads/master` | `504021b8965956d19fe4a17a9181cfe2c6bba93f`（与 `BASE_MASTER_SHA` 一致，无 drift） |
| Approved Spec | `docs/specs/p2-ari-f02-targeted-requery.md`（`STATUS = APPROVED`） |
| D12 | `docs/architecture/key-decisions.md`，`STATUS = APPROVED`；`TICKET_AUTHORIZATION = TICKET_DECOMPOSITION_ONLY`；`READY_TO_DECOMPOSE_TICKETS = YES` |
| Seam Map / Contract | `STATUS = APPROVED`；`VERSIONS = E=1, F=1, G=1, H=1` |
| 分解纪律先例 | `P1_TICKET_DECOMPOSITION_V1.md`、`P1_REPAIR_TICKET_DECOMPOSITION_V1.md`、`P1_REPAIR_TICKET_GRAPH_V1.md`、`P1_SEAM_CONTRACTS_V1.md`（**只复用纪律，不复制票数与形状**） |
| 治理硬约束 | `RULES.md` §6/§7/§8；`AGENTS.md` §5（review quorum 表）|
| 代码事实基线 | 机械读取自 `504021b`：`retrieval.mjs:494/547/761`、`retrieval-round-controller.mjs:167/242/288/306`、`coverage-final-integration.mjs:307/325/444`、`coverage-state.mjs:312/519/631`、`state.mjs`（`makeState`/`writeState`/`validateArtifactCheckpoint`/`occurrenceId`）、`p1-runtime-composer.mjs:1080` |

工作树：`/tmp/wt-p2ari-tickets`（`BASE_SHA_EXACT = YES`；用户活动工作树未触碰；`PRODUCT_CODE_CHANGE = NONE`）。

---

## 2. 分解原则

1. **Architecture Authority → Seam → Ticket**：每张票必须落在一个已冻结 seam 的一个真实实现边界上
   （producer / consumer / state owner / identity owner / persistence owner / retry owner /
   budget owner / integration seam / acceptance boundary）。绝不反向由 ticket 创设架构。
2. **单一写者**：任何可变字段只有一个票拥有写权（见 §4）。发现同字段双写者 → 停止分解并从 seam 裁决。
3. **既不大票也不微票**：拒绝"一张大票实现 #108"，也拒绝 10–20 行微票。
   合并判据 = 同一 authority surface；拆分判据 = 不同 owner 或不同可独立验证的失效语义。
4. **不预设票数**：票数由 seam 表面工程内聚性导出（本轮 = 15），不由并行度或对齐数字决定。
5. **DAG 无环**：运行时 `gap → query → retrieval → evidence → re-evaluate` 是**循环**，
   ticket 图必须保持**无环**；运行时反馈不得建模为 ticket 依赖环。

---

## 3. Seam → 实现表面清单（机械清单，先清单后聚类）

图例：`NEW_ARTIFACT` / `NEW_FIELD` / `NEW_PARAM` / `NEW_VALIDATION` / `NEW_PERSISTENCE` /
`NEW_TEST` / `NEW_WIRING`；`INHERITED` = 既有行为直接继承、无新代码。

| Seam | PRODUCER | CONSUMER | CURRENT_CODE_OWNER | FUTURE_CHANGE_SURFACE | 新增面 | 依赖 | 失效语义 |
|---|---|---|---|---|---|---|---|
| **S1** 状态 → GAP 诊断 | targeted controller（新） | GAP 诊断 | `coverage-final-integration.mjs`（pool）、`plan-contract.mjs`（plan） | 新诊断模块（只读 pool / plan / coverage） | ARTIFACT(gap ledger)、FIELD(diagnosedGaps)、VALIDATION(provenance coverage)、TEST | 需 plan + accumulated pool + 已执行查询 provenance | FAIL_CLOSED（状态不可读 → 不产出 gap） |
| **S2** gap → proposal | 语义 runtime（既有能力，不新建设施） | S3 校验 | `SemanticRuntime`（既有） | proposal 形状 + 解析 + 绑定校验 | FIELD(proposal 形状)、VALIDATION(binding)、TEST | 需 gapId 已存在 | FAIL_CLOSED（缺 gapId → 丢弃） |
| **S3** proposal → 授权 | targeted controller | S5 检索 | 无（新） | 授权门（结构性判定 + 信任门 + 边界判定） | FIELD(action 条目)、VALIDATION(E.5 九条)、PARAM(无外部)、TEST | 需 ledger + 剩余预算 + providerScope | FAIL_CLOSED → REJECTED + rejectionCode |
| **S4** action 状态推进 | targeted controller | 既有检索路径 | 无（新） | 状态机 + checkpoint binding | FIELD(status/hashes)、PERSISTENCE、VALIDATION、TEST | 需授权产物与检索产物 | FAIL_CLOSED（无证据不复用） |
| **S5** action → 既有检索 | 既有 T06 primitive | 既有 RRF / identity | `retrieval.mjs` | `runMultiQueryRetrieval` **additive 可选参数** | PARAM(`targetedQueries=null`)、VALIDATION、TEST | 需 provider seam、plannedRoutes | FAIL_CLOSED（沿用 T06 失败身份） |
| **S6** 结果 → RRF / identity | 既有 RRF | accumulated pool | `rrf.mjs` | **零改动**（INHERITED） | —（仅回归守卫 TEST） | — | INHERITED |
| **S7** RRF → accumulated pool | targeted controller（复用累积逻辑） | T08 起下游 | `coverage-final-integration.mjs`（累积） | 复用累积 + 重跑安全 walk | VALIDATION(safety walk)、TEST | 需 S6 输出 | FAIL_CLOSED（未过安全 walk 不持久化） |
| **S8** pool → 下游 | 既有各 stage | 最终产物 | T08/T12/T13/T14/T15（既有） | **零改动**（INHERITED） | —（仅位置约束 TEST） | — | INHERITED |
| **S9** 新证据 → gap 复评 | targeted controller | gap ledger | 无（新） | 复评与终态判定 | FIELD(resolution*)、VALIDATION(predicate)、TEST | 需 committed action + pool diff | FAIL_CLOSED（无谓词 → UNKNOWN/UNRESOLVED） |
| **S10** 终态 → 可见性 | targeted controller | 最终研究产物 | 产物组装（既有） | 产物中 gap 记录区块 | ARTIFACT(gap 区块)、TEST | 需终态 | FAIL_CLOSED（未解决不得消失） |
| **S11** CONTINUE/STOP | 既有 T07 + targeted controller | 检索阶段编排 | `retrieval-round-controller.mjs` | **additive** `targetedAttempts` 输入 | PARAM(targetedAttempts)、VALIDATION(两个分母)、TEST | 需 ledger 导出计数 | FAIL_CLOSED（沿用 T07） |

| Contract | PRODUCER | CONSUMER | 新增面 | 依赖 | 失效语义 |
|---|---|---|---|---|---|
| **E.1** gap 枚举 | controller | 诊断/授权 | FIELD(enum + UNKNOWN_GAP_TYPE)、VALIDATION、TEST | — | 未知类型可记录、不得转检索动作 |
| **E.2** gap identity | controller | 全部 | FIELD(gapIdentityCore/gapId)、VALIDATION、TEST | planHash + occurrenceId | 双公式已作废，只保留唯一定义 |
| **E.3** subjectKey | controller | E.2 | FIELD(subjectKey)、VALIDATION、TEST | plan 字符串材料 | 无 intent 时不得塌缩为常数 |
| **E.3.1** 诊断依据 | controller | E.1 记录 | VALIDATION(provenance coverage)、TEST | 已执行查询 provenance | 禁止内容归因 |
| **E.4** proposal 绑定 | 语义 runtime/controller | E.5 | FIELD(proposal)、VALIDATION、TEST | gapId | MVP：`queryText` 一律 REJECTED |
| **E.5** 授权九判定 | controller | S4/S5 | VALIDATION、FIELD(rejectionCode)、TEST | ledger + 预算 + 字符串门 | 任一不通过 → REJECTED |
| **E.6** dedupeKey | controller | E.5(6) | FIELD(dedupeKey index)、VALIDATION、TEST | gapIdentityCore | 同 occurrence 内只授权一次 |
| **E.7** REJECTED 行为 | controller | 产物 | FIELD(audit 副本)、TEST | — | 无 IO、不改父 gap 状态 |
| **E.8** 确定性排序 | controller | 预算消费 | VALIDATION(gapId 升序)、TEST | ledger | 禁止按 materiality/confidence 排序 |
| **F.1** action identity | controller | F.5 | FIELD(targetedActionId)、VALIDATION、TEST | runId/occurrenceId/planHash/gapId/attempt/query/scope | 重放键；禁时间戳/随机数 |
| **F.2** providerScope | controller | S5 | VALIDATION(⊆ plannedRoutes)、TEST | plannedRoutes | 禁新 provider / 新 capability / 静默 fallback |
| **F.3** 信任类 + 双 lens | controller | E.5(2)(3) | VALIDATION(交集门)、TEST | `plan-contract.mjs:130` + `rrf.mjs:421` | UNCLASSIFIED/任一 lens 失败 → FAIL_CLOSED |
| **F.3(信任集)** 四处调用点 | — | — | **零改动**（INHERITED）+ 守卫 TEST | — | 禁扩 trustedPlanStrings；禁写 `plannedQueryVariants` |
| **F.4** provenance 溯源 | controller | G / 产物 | FIELD(溯源字段)、VALIDATION、TEST | targetedActionId | 血缘可机械回溯 |
| **F.5** commit/replay | controller | resume | PERSISTENCE(checkpoint binding)、VALIDATION、TEST | `state.mjs` writeState/hashes | 已 commit + hash 通过 → 绝不重跑 |
| **F.6/F.6.1** 计数 | controller | `evaluateRetrievalRound` | PARAM(targetedAttempts)、VALIDATION(两分母)、TEST | ledger 导出 | 缺省与旧行为逐字相同 |
| **F.7** 执行路径 | controller | `runMultiQueryRetrieval` | PARAM(targetedQueries)、VALIDATION(单入口)、TEST | retrieval.mjs | 禁第二管线 |
| **G.1–G.5.1** 复评/终态 | controller | S10 | FIELD(newEvidenceIds/resolutionBasis)、VALIDATION、TEST | committed action + pool diff | 无谓词 → UNKNOWN；禁热度代理 |
| **H.1–H.8** STOP 交互 | T07 + controller | 编排/产物 | PARAM、VALIDATION、TEST | 计数 + 终态 | 禁 targeted 制造 SATURATED；禁预算耗尽伪装饱和 |

---

## 4. 单一写者矩阵（ownership，无冲突）

```text
MUTABLE_SURFACE                                  唯一写者票
gap ledger artifact 文件 IO / schema / 校验       P2A-T01（持久化原语 + 身份；唯一文件写者）
  diagnosedGaps[] 记录                            P2A-T03
  targetedActions[] 授权字段（id/类/scope/dedupe） P2A-T05
  targetedActions[] 提交/执行字段（status 推进）   P2A-T06
  targetedActions[] 复评字段（resolution*）        P2A-T08
state.hashes / checkpoint binding                 P2A-T06（唯一提交点写者）
retrieval.mjs（targetedQueries）                  P2A-T02
retrieval-round-controller.mjs（targetedAttempts）P2A-T07
coverageState.*                                   无票可写（P1 语义零改动；由 P2A-T11 断言）
targeted round pool（round work-dir 产物）         P2A-T02（唯一；经 retrieval.mjs:761 安全 walk）
accumulated pool（accumulated-pool.json）          P2A-T09（唯一写者，位于 coverage-final-
                                                  integration.mjs；T02 只产出 round pool 交其累积）
最终产物 gap 区块                                 P2A-T10
```

```text
TARGETED_ATTEMPT_COUNTER_OWNER     = P2A-T07（从 ledger 确定性导出，唯一）
GLOBAL_BUDGET_INTEGRATION_OWNER    = P2A-T07（唯一接触 evaluateRetrievalRound 的票）
SATURATION_INTERACTION_OWNER       = P2A-T07（plannedCoverageCount 语义）+ P2A-T13（守卫）
GAP_RESOLUTION_OWNER               = P2A-T08
FINAL_FEEDBACK_LOOP_OWNER          = P2A-T09
IDENTITY_OWNER(gap)                = P2A-T01
IDENTITY_OWNER(action)             = P2A-T05
PERSISTENCE_OWNER                  = P2A-T01（原语）/ P2A-T06（提交点）
RETRY_OWNER                        = P2A-T06
TRUST_GATE_OWNER                   = P2A-T04（纯判定）+ P2A-T11（可执行守卫）
```

---

## 5. Tickets

> 每张票的 `IMPLEMENTATION_AUTHORIZATION = NONE`。`FILES_OR_COMPONENTS_EXPECTED` 是**预期**，
> 不是冻结的文件布局（Seam Contract §0 明确不冻结私有函数名 / 文件布局）。

### P2A-T01 — Gap ledger artifact + gap identity（E.1/E.2/E.3/E.8 的身份与持久化面）

- **TYPE**: CODE（state/persistence-defining）
- **RISK**: HIGH
- **GOAL**: 建立 controller-owned、独立于 `ResearchCoverageState` 的 gap/targeted-action ledger
  artifact：封闭 gapType 枚举（含 `UNKNOWN_GAP_TYPE` 可记录但不可转检索动作）、`subjectKey`
  规范化、`gapIdentityCore`（不含 `diagnosisRound`）与 `gapId`（`= core + ':' + diagnosisRound`）、
  `diagnosisRound` 仅作审计字段、确定性 `gapId` 升序选择序（E.8）、ledger 读写原语与 schema 校验、
  由 `planHash` + `occurrenceId` 锚定。**本票只提供持久化原语与状态集合法性校验，不决定任何状态推进。**
- **WHY_THIS_IS_ONE_TICKET**: 身份与持久化是同一个 authority surface（IDENTITY_OWNER +
  PERSISTENCE_OWNER 同为 controller，且 `gapIdentityCore` 的确定性直接决定 ledger 键结构）；
  拆开会产生"身份公式"与"存储键"两个互相漂移的真相。
- **AUTHORITY**: Spec §5 D1、§6；Seam Map S1/S4；Seam Contract E.1/E.2/E.3/E.8；key-decisions D12-1、D12-8。
- **IN_SCOPE**: ledger 模块、schema、gapType 枚举、`subjectKey` 三种构造 + `intent-freeform` 分支、
  `gapIdentityCore` / `gapId` 计算、ledger 读写原语、work-dir 相对路径、append-only 审计写入、
  确定性排序比较器、focused tests。
- **OUT_OF_SCOPE**: 诊断逻辑（T03）、授权判定（T05）、状态推进与 checkpoint（T06）、
  复评终态（T08）、任何 `ResearchCoverageState` 字段或 schemaVersion 变更、任何检索 IO。
- **PRODUCER**: targeted-requery controller（ledger 模块）
- **CONSUMER**: T03（写 gap 记录）、T05（写 action 授权字段）、T06（写状态推进）、
  T07（导出计数）、T08（写复评字段）、T10（读终态）
- **OWNED_STATE_OR_SURFACE**: `TargetedRequeryLedger` artifact、gap identity、ledger 文件 IO
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/lib/` 下 targeted-requery ledger 模块
  （命名不冻结）+ focused tests + ledger fixtures
- **BLOCKED_BY**: —；**BLOCKS**: P2A-T03、P2A-T05、P2A-T07
- **ACCEPTANCE_CRITERIA**:
  1. `ASPECT_GAP` / `CONTRADICTION_GAP` / `AUTHORITY_GAP` 封闭枚举存在；其它一律
     `UNKNOWN_GAP_TYPE`，可记录、**不产生**检索动作；
  2. 相同 `(planHash, occurrenceId, gapType, subjectKey)` **跨 diagnosisRound** 收敛为同一
     `gapIdentityCore`（机械证明：不同 `diagnosisRound` 输入 → 同一 core、不同 gapId）；
  3. `gapId = gapIdentityCore + ':' + diagnosisRound`，`diagnosisRound` 不进任何去重/计数键；
  4. `AUTHORITY_GAP` 无对应 plan-owned intent 时 `subjectKey` 不得塌缩为常数；
  5. `ResearchCoverageState.schemaVersion` 与 `canonicalizeCoverageState` 输出键集**逐字未变**；
  6. ledger 路径全部 work-dir 相对，不泄漏机器绝对路径。
- **REQUIRED_TESTS**: 身份收敛（跨轮）、枚举封闭性、subjectKey 三分支 + 无 intent 分支、
  排序确定性、schema 往返与非法输入 fail-closed、planHash 变更 → ledger 不可复用、
  coverage state 键集未变（回归断言）。
- **COUNTEREXAMPLES**: 同逻辑 gap 在 round 2 再次出现 → 同一 `gapIdentityCore`（C1 前置）；
  未知 gapType → 记录但零检索动作；两个不同无-intent AUTHORITY_GAP → 两个不同 gapId。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得为身份引入时间戳/随机数/未绑定产物；
  不得把 gap 状态写进 `ResearchCoverageState`；发现需要新 coverage 账本字段 → STOP。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认（ff-only + exact-SHA review PASS）
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T02 — `runMultiQueryRetrieval` additive `targetedQueries` 执行接缝（F.7 / D12-7 / S5 / S6 / S7）

- **TYPE**: CODE（frozen-path modification）
- **RISK**: HIGH
- **GOAL**: 在既有**唯一**检索入口 `runMultiQueryRetrieval`（`retrieval.mjs:494`）上增加
  **additive 可选参数** `targetedQueries`（缺省 `null`）：缺省时逐字执行今天的
  `for (const query of validated.plan.queryVariants)`（`:547`）；非缺省时只以
  `targetedQueries × providerScope` 通道执行一次，`plan` / `planHash` 绑定仍为**原 plan**，
  返回形状仍为 `{ ok:true, pool, poolHash, file }`；结果经既有 `rrfFusion` → 累积 →
  `assertArtifactSafe` 路径；**artifact-walk 调用点零改动**。
- **WHY_THIS_IS_ONE_TICKET**: 它是"无第二检索子系统"这条冻结约束的**唯一机械落点**；
  把参数化与"禁止在入口外另组 seam.retrieve+rrfFusion+pool merge"放在同一票内审，
  才能一次判定管线唯一性。
- **AUTHORITY**: Spec §9（Retrieval reuse）、D12-7；Seam Map S5/S6/S7、§3 反第二管线；
  Seam Contract F.7、F.2、F.3（信任集零改动）。
- **IN_SCOPE**: `retrieval.mjs` 的 additive 参数与分支、providerScope 通道构造（复用既有
  `resolveChannels`）、planHash 绑定不变、返回形状不变、既有安全投影复用、
  **本票只负责 `retrieval.mjs:761` 的 round-pool 安全 walk（`assertArtifactSafe`，既有调用点零改动）**；
  accumulated-pool 的安全 walk 与持久化由 P2A-T09 负责（该文件面独占），
  本票**不得改动 `coverage-final-integration.mjs`**；本票自身的 focused tests 不受此限制。
- **OUT_OF_SCOPE**: 新 provider / 新 capability / 新排序规则 / 新 canonical identity 规则 /
  第二入口 / 在入口外复制融合逻辑 / 改 plan artifact / 任何 `trustedPlanStrings` 变更。
- **PRODUCER**: 既有 T06 retrieval primitive（参数化后）
- **CONSUMER**: P2A-T09（子阶段编排）；下游 T08/T12/T13/T14/T15 零改动消费更大的 pool
- **OWNED_STATE_OR_SURFACE**: `retrieval.mjs` 的 `runMultiQueryRetrieval`；targeted round work-dir 产物
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/lib/retrieval.mjs` + focused tests
- **BLOCKED_BY**: —；**BLOCKS**: P2A-T09
- **ACCEPTANCE_CRITERIA**:
  1. `targetedQueries === null` → 与今天的执行序列**逐字等价**（含通道顺序、返回形状）；
  2. `targetedQueries = [...]` → 只以给定查询 × providerScope 执行；`planHash` 仍为原 plan
     （传错 → 既有 `RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH`）；
  3. 返回形状 `{ ok:true, pool, poolHash, file }` 不变；
  4. targeted 结果走**同一套** RRF 与 canonical questionId 去重，不加权、不提权、不单独排序；
  5. `assertArtifactSafe` 生产调用点零改动（由 T11 机械断言）；
  6. 无新 provider adapter、无新检索入口。
- **REQUIRED_TESTS**: 缺省等价性（与基线逐字对照）、参数化路径、planHash 不匹配 fail-closed、
  返回形状、融合与去重等价性、空结果与非零结果边界、providerScope ⊆ plannedRoutes 校验。
- **COUNTEREXAMPLES**: 传入不在 `plan.queryVariants` 的查询 → 正常执行且不改 plan；
  传入 providerScope 外的 provider → fail-closed；伪造第二入口 → 由测试断言不存在。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得新增第二个检索入口；不得在唯一入口之外组合
  `seam.retrieve + rrfFusion + pool merge`；不得静默 provider fallback。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T03 — Gap 诊断（provenance-coverage only，不做内容归因）（S1 / E.3.1 / D1）

- **TYPE**: CODE
- **RISK**: MEDIUM
- **GOAL**: 只读既有已验证状态（accumulated pool、已验证 plan、已执行查询 provenance、
  `ResearchCoverageState.retrieval` 只读），产出 `diagnosedGaps[]`：
  `ASPECT_GAP` / `CONTRADICTION_GAP` 由**查询覆盖**机械判定（某 plan-owned 字符串材料尚未出现在
  任何已执行查询的 provenance 中）；`AUTHORITY_GAP` 由 `plan.sourceGroupIntents[].intent`
  或模型 proposal 提出且经 controller 校验（该类型永远 proposal-driven）。
  诊断依据必须可机械重算；状态不可读 → 不产出 gap（FAIL_CLOSED）。
- **WHY_THIS_IS_ONE_TICKET**: 诊断是"controller 机械 vs 模型语义"这条边界的第一个分水岭，
  也承载"禁止内容归因"这条硬禁令；与身份/持久化（T01）和授权（T05）是不同 owner。
- **AUTHORITY**: Seam Map S1；Seam Contract E.3.1、E.1、E.3；Spec §5 D1、§6；key-decisions D12-1。
- **IN_SCOPE**: 诊断模块、provenance 覆盖计算、三类 gap 的判据、候选 plan-owned 字符串材料输出、
  只读保证、FAIL_CLOSED、focused tests。
- **OUT_OF_SCOPE**: 任何文本匹配 / 词典 / embedding 归因器；任何"某条内容属于哪个 aspect"的判断；
  写回 pool / coverage / plan；授权判定（T05）；检索 IO。
- **PRODUCER**: targeted-requery controller（诊断）
- **CONSUMER**: P2A-T09（把诊断出的 gap 交给授权门）
- **OWNED_STATE_OR_SURFACE**: `TargetedRequeryLedger.diagnosedGaps[]`（唯一写者）
- **FILES_OR_COMPONENTS_EXPECTED**: targeted-requery 诊断模块 + focused tests
- **BLOCKED_BY**: P2A-T01；**BLOCKS**: P2A-T09
- **ACCEPTANCE_CRITERIA**:
  1. 判据 = 已执行查询 provenance 覆盖，**无**任何内容/semantic 归因设施；
  2. `AUTHORITY_GAP` 明确走 proposal-driven，不被伪装成 coverage-driven；
  3. 输入状态不可读/不合法 → 不产出 gap，不静默继续；
  4. 只读：诊断期间不写 pool / coverage / plan（机械断言）；
  5. 诊断结果可机械重算（同输入 → 同输出）。
- **REQUIRED_TESTS**: provenance 覆盖命中/未命中、三类 gap 各一例、只读断言、
  不可读状态 fail-closed、可重算性、未知类型不进入诊断输出。
- **COUNTEREXAMPLES**: plan 中已有但从未执行的 `opposingFramings[i]` → CONTRADICTION_GAP 成立；
  已执行过的材料 → 不再诊断；诊断模块内出现任何文本/embedding 归因 → 测试失败。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得从模型自由文本直接得出 controller-mechanical gap 结论；
  诊断阶段写任何 P1 产物 → 失败。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER`
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T04 — 信任与字符串安全门（proposal 绑定 + 双 lens 交集 + 信任类 + MVP 授权面）（S2 / E.4 / E.5(1)(2)(3)(9) / F.3）

- **TYPE**: CODE（security / trust boundary）
- **RISK**: HIGH
- **GOAL**: 实现授权前的**纯字符串/信任判定面**：`TargetedQueryProposal` 解析与绑定校验
  （必填 `gapId`、与已存在 gapId 精确匹配、缺失即丢弃）、MVP 授权面 =
  `planOwnedStringRef` only（`queryText` 一律 `REJECTED`，
  `rejectionCode = FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP`）、`PLAN_OWNED` 字符串解析
  （取自 `queryVariants` / `opposingFramings` / `entities` / `terminologyVariants.term|.variants` /
  `sourceGroupIntents.intent|.constraints`）、**双 lens 交集门**
  `isPlanBoundarySafeString(s) AND isBoundarySafeString(s)`、信任类封闭枚举与
  `UNCLASSIFIED` fail closed、稳定 machine-readable `rejectionCode`。
  **本票是无状态判定面**：不写 ledger、不做去重/计数/预算判定、不产生任何检索 IO。
- **WHY_THIS_IS_ONE_TICKET**: 这是 D12-3 / F.3 的唯一机械落点，也是本特性唯一的
  安全信任边界；把它做成无状态纯函数票，可以让安全 quorum 在一处审完"字符串如何被准入"，
  而不必阅读预算/去重/状态机代码。
- **AUTHORITY**: Spec §10、§5 D3；Seam Map S2/S3；Seam Contract E.4、E.5(1)(2)(3)(9)、F.3；
  key-decisions D12-3；`rrf.mjs` R11 约束。
- **IN_SCOPE**: proposal 形状与解析、gapId 绑定（经注入的 gap 存在性解析器）、
  plan-owned 字符串解析、双 lens 交集门、信任类判定、rejectionCode 集合、focused tests。
- **OUT_OF_SCOPE**: `trustedPlanStrings` 的任何扩展（四处调用点零改动由 T11 断言）、
  dedupeKey / attempt bound / 预算（T05）、`targetedActionId`（T05）、任何检索 IO、
  任何 provider 内容进入信任面。
- **PRODUCER**: targeted-requery controller（信任门）
- **CONSUMER**: P2A-T05（授权策略）
- **OWNED_STATE_OR_SURFACE**: 信任判定函数集合（无可变状态）+ `rejectionCode` 枚举
- **FILES_OR_COMPONENTS_EXPECTED**: targeted-requery 信任/校验模块 + focused tests
- **BLOCKED_BY**: —；**BLOCKS**: P2A-T05
- **ACCEPTANCE_CRITERIA**:
  1. `admit(s) ⟺ isPlanBoundarySafeString(s) AND isBoundarySafeString(s)`（**交集**，非择一）；
  2. `queryText` 形式在 MVP 内 100% → `REJECTED` + `FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP`，零 IO；
  3. `UNCLASSIFIED` → fail closed；
  4. `PLAN_OWNED` 材料逐条仍被**重新判定**（不因"来自 plan"而豁免）；
  5. 缺 `gapId` / `gapId` 不存在 → 丢弃 proposal，不推断、不新建 gap；
  6. **不向** `assertArtifactSafe` 任何既有调用点传入扩展 `trustedPlanStrings`。
- **REQUIRED_TESTS**: 双 lens 各侧单过/双过矩阵、plan-owned 安全样本通过、
  "看起来像 plan-owned 但不安全"的样本 fail closed、自由文本一律拒绝、
  UNCLASSIFIED fail closed、rejectionCode 稳定性、零 IO 断言。
- **COUNTEREXAMPLES**: C2（似是而非的无关查询 → 因 MVP 只授权 planOwnedStringRef 被拒）、
  C3（含 provider-like 不可信内容 → 任一 lens 判不安全即拒）。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得把 `trustedPlanStrings` 扩成任意 caller 字符串集合；
  不得让模型文本自授权；单 lens 实现 = 直接失败。
- **REVIEWER_QUORUM**: 1 × `SECURITY_REVIEWER` + 1 × `CODE_OR_CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认；安全票不得 self-review 通过
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T05 — 有界授权策略与 action 身份（E.5(4)(5)(6)(7)(8) / E.6 / E.7 / E.8 / F.1 / F.2 / F.4）

- **TYPE**: CODE
- **RISK**: HIGH
- **GOAL**: 实现"**是否授权**"的有界策略与权威身份：父 gap 溯源必填
  （`targetedActionId → gapId`）、per-gap attempt 上界（以 `gapIdentityCore` 计数，
  `attempt <= maxAttemptsPerGap`）、`normalizedQuery`（trim → NFC → 空白折叠 → casefold）与
  `dedupeKey = sha256(canonicalJson({ gapIdentityCore, normalizedQuery, providerScope }))`
  同 occurrence 内只授权一次、全局预算预检（`attemptsBudgetCount + 本动作通道尝试数 <= maxQueryBudget`，
  用**通道尝试数**而非 1）、`providerScope ⊆ plannedRoutes`（默认全通道、capability 只允许 `search`）、
  `targetedActionId = sha256('p2-ari-targeted-action/v1:' + canonicalJson({ runId, occurrenceId,
  planHash, gapId, attempt, normalizedQuery, providerScope }))`、provenance 溯源字段、
  `gapId` 升序确定性消费预算（E.8）、`AUTHORIZED` / `REJECTED` 输出与 E.7 行为
  （无 IO、不改父 gap 状态、不得降级为"用原 plan 再跑一轮"）。
- **WHY_THIS_IS_ONE_TICKET**: "有界"（bound）是防循环/超支的**唯一机制**，它同时需要
  dedupe 键、per-gap 计数与预算预检三者一致；拆开会产出三个各自漂移的"界"。
  identity 归属本票是因为 `targetedActionId` 的字段集就是授权判定的字段集。
- **AUTHORITY**: Spec §5 D2/D3/D6、§11；Seam Map S3；Seam Contract E.5(4)(5)(6)(7)(8)、E.6、E.7、E.8、
  F.1、F.2、F.4；key-decisions D12-2、D12-3、D12-6、D12-8。
- **IN_SCOPE**: 授权策略模块、归一化与 dedupeKey、per-gap 计数递增、预算预检、
  providerScope 校验、action identity、provenance 字段、rejectionCode 组合、focused tests。
- **OUT_OF_SCOPE**: 字符串安全判定（T04）、状态推进与 checkpoint（T06）、
  全局计数接入 `evaluateRetrievalRound`（T07）、任何 `executing` 持久化状态。
- **PRODUCER**: targeted-requery controller（授权）
- **CONSUMER**: P2A-T06（生命周期）、P2A-T09（编排）
- **OWNED_STATE_OR_SURFACE**: `targetedActions[]` 的授权字段（id / trustClass / scope / dedupeKey /
  attempt / 溯源）+ per-gap 计数索引（唯一写者）
- **FILES_OR_COMPONENTS_EXPECTED**: targeted-requery 授权模块 + focused tests + 边界 fixtures
- **BLOCKED_BY**: P2A-T01、P2A-T04；**BLOCKS**: P2A-T06
- **ACCEPTANCE_CRITERIA**:
  1. 同 `(gapIdentityCore, normalizedQuery, providerScope)` 在同一 occurrence 内**跨轮**只授权一次；
  2. `maxAttemptsPerGap` 约束的是 **action 数**，通道级尝试数全额计入预算；
  3. 预算预检使用"本动作通道尝试数"，不是 1；
  4. `providerScope` 引入新 provider / 新 capability → REJECTED；
  5. `targetedActionId` 只由合同已证成字段计算（无时间戳、无随机数、无未绑定产物）；
  6. REJECTED 零 IO、父 gap 状态不变、不计入 resolved / saturation；
  7. 同轮多 gap 按 `gapId` 升序消费预算，**不**使用 materiality / confidence 排序。
- **REQUIRED_TESTS**: 归一化等价类（大小写/空白/Unicode）、dedupe 跨轮命中、attempt 上界边界、
  预算预检边界（通道数展开）、providerScope 越界、identity 稳定性与字段敏感性、
  REJECTED 零 IO、确定性排序。
- **COUNTEREXAMPLES**: C1（同一 gap 跨轮触发等价查询 → dedupeKey 命中 → REJECTED）；
  C2（自由文本 → T04 拒，本票不产生 IO）；C12（resume 看到的重放 action → identity 相同不得再授权）。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得为同一 gap 反复授权等价查询；
  不得把 targeted 尝试反向写进 `executedRoutes`；不得授权 `plannedRoutes` 之外的通道。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T06 — Action 生命周期、durable commit 与 replay 保护（S4 / F.5 / D5）

- **TYPE**: CODE（crash-boundary）
- **RISK**: HIGH
- **GOAL**: 实现 `PROPOSED → AUTHORIZED → COMMITTED → EVALUATED → { RESOLVED | UNRESOLVED |
  EXHAUSTED_WITHIN_BUDGET }` 的状态推进，外加非推进终态 `REJECTED` / `FAILED_OPERATIONAL`；
  **checkpoint-first** 提交点（action 的持久化 round 产物字节先落盘 + fsync，其 hash 写入
  `state.hashes`，然后 `writeState` 提交）；复用既有 `validateArtifactCheckpoint` 做
  `DUPLICATE_REPLAY_RULE`；`IDENTITY_REPLAY_CONFLICT` 保守重跑并保留旧审计痕迹；
  **不引入** `executing` 持久化状态；每次推进留下可机检证据。
- **WHY_THIS_IS_ONE_TICKET**: commit point 与 replay 是同一个 crash-boundary 的两半；
  分开会产生"提交语义"与"恢复语义"两个互相矛盾的真相（P1-R06 教训）。
- **AUTHORITY**: Spec §5 D5、§12、§14；Seam Map S4；Seam Contract F.5、F.1；key-decisions D12-5；
  P1-R06 冻结结论（checkpoint 为唯一信任根；禁止未锚定的第二凭证）。
- **IN_SCOPE**: 状态机（推进操作 + 合法/非法态校验）、checkpoint-first staging 与提交、
  `state.hashes` binding key、resume 重算 `targetedActionId` 与 replay 决策、
  append-only 审计、失败语义、focused tests。
- **OUT_OF_SCOPE**: 授权判定（T05）、复评终态判定（T08）、任何 sidecar receipt / 第二凭证、
  任何新 checkpoint 机制（复用既有 `writeState` / `validateArtifactCheckpoint`）。
- **PRODUCER**: targeted-requery controller（生命周期）
- **CONSUMER**: P2A-T08（复评）、P2A-T09（编排）、P2A-T07（计数导出）
- **OWNED_STATE_OR_SURFACE**: `targetedActions[]` 的 status / 提交字段（唯一写者）+
  `state.hashes` targeted binding（唯一写者）
- **FILES_OR_COMPONENTS_EXPECTED**: targeted-requery 生命周期模块 + `state.mjs` 复用
  （不改语义）+ focused tests
- **BLOCKED_BY**: P2A-T05；**BLOCKS**: P2A-T08
- **ACCEPTANCE_CRITERIA**:
  1. 无 `executing` 持久化状态；
  2. 已 COMMITTED 且 binding hash 校验通过 → **绝不**重复执行检索；
  3. 仅 AUTHORIZED（未 COMMITTED）或 hash 不匹配 / 产物缺失 → 安全重跑一次；
  4. 同 id 不同内容 → `IDENTITY_REPLAY_CONFLICT`，保守重跑并保留旧审计痕迹（append-only）；
  5. 提交点 = 产物字节落盘 + fsync + hash 入 `state.hashes` + `writeState` 的顺序；
  6. 诚实代价声明在代码/文档中显式保留（commit point 前崩溃可能重复付费一次）。
- **REQUIRED_TESTS**: 状态推进矩阵、非法态拒绝、commit point 顺序、resume 三类分支
  （committed / authorized-only / hash 不匹配）、崩溃注入（commit 前/后）、append-only 审计。
- **COUNTEREXAMPLES**: C4（commit point **之后**崩溃 → 不重复付费检索）；
  C5（commit point **之前**崩溃 → 按合同安全重跑一次）；
  C12（resume 看到陈旧/重放 action → identity 阻止意外重复执行）。
- **FAIL_CLOSED / STOP CONDITIONS**: 严禁引入 sidecar receipt 等未锚定第二凭证；
  无持久完成证据不得复用（UNKNOWN != PASS）；`FAILED_OPERATIONAL` 不得写成 `RESOLVED`。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T07 — Targeted attempt 计数与全局预算/STOP 接入（F.6 / F.6.1 / H-1…H-5 / D4 / D6）

- **TYPE**: CODE（frozen-accounting integration）
- **RISK**: HIGH
- **GOAL**: 在既有 `evaluateRetrievalRound`（`retrieval-round-controller.mjs:167`）上增加
  **additive 可选显式输入** `targetedAttempts = { executed, failed }`（缺省 `{0,0}`），并定义：
  `attemptsBudgetCount = executedRoutes + providerFailures + targeted.executed + targeted.failed`
  （→ vs `maxQueryBudget`，BUDGET_STOP）；
  `plannedCoverageCount = executedRoutes + providerFailures`（**逐字等于**旧
  `cumulativeAttemptsCount`，→ vs `plannedRoutes.length`，SATURATED 前置，不含 targeted）。
  导出函数从 ledger 确定性计算 `targetedExecutedCount` / `targetedFailedCount`。
- **WHY_THIS_IS_ONE_TICKET**: 这是 `GLOBAL_BUDGET_INTEGRATION_OWNER` 与
  `SATURATION_INTERACTION_OWNER` 的唯一落点；STOP 语义不得散落多票（任务 §10）。
- **AUTHORITY**: Spec §5 D4/D6、§11、§13；Seam Map S11；Seam Contract F.6、F.6.1、H.1（H-1…H-5）；
  key-decisions D12-4、D12-6。
- **IN_SCOPE**: `evaluateRetrievalRound` 的 additive 输入与两个分母语义、ledger → 计数的确定性导出、
  缺省等价性回归、focused tests。
- **OUT_OF_SCOPE**: 写 `executedRoutes`（明令禁止）、改 `plannedRoutes`、新增 cost/token/money
  控制器、新增 round 语义（targeted 不自增 `retrievalRounds`）、`SATURATION_SEMANTICS_DISCLAIMER` 任何改动。
- **PRODUCER**: targeted-requery controller（计数导出）+ 既有 T07（评估）
- **CONSUMER**: P2A-T09（编排）、P2A-T13（守卫）
- **OWNED_STATE_OR_SURFACE**: `retrieval-round-controller.mjs` 的计数输入（唯一接触者）
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/lib/retrieval-round-controller.mjs`
  + targeted 导出函数 + focused tests
- **BLOCKED_BY**: P2A-T01；**BLOCKS**: P2A-T09
- **ACCEPTANCE_CRITERIA**:
  1. 缺省 / 未启用 #108 → 两个计数与旧行为**逐字相同**（机械对照）；
  2. `plannedCoverageCount` **不含** targeted 尝试；
  3. `attemptsBudgetCount` **含** targeted 尝试；
  4. `plannedRoutes` 永不被 targeted 改写（断言 `plannedRoutes` 长度/内容不变）；
  5. targeted 不自增 `retrievalRounds`；
  6. 计数由 controller 从 ledger 确定性导出，不由 caller 任意提供。
- **REQUIRED_TESTS**: 缺省等价性、两分母分离、预算边界、saturation 前置不变、
  plannedRoutes 非改写断言、round 不自增、导出确定性。
- **COUNTEREXAMPLES**: C9（全局预算耗尽 → 剩余 gap 诚实 unresolved / exhausted）；
  C11（saturation 评估期间存在 targeted action → 前置分母不变、BUDGET_STOP 更可能先发生）。
- **FAIL_CLOSED / STOP CONDITIONS**: 禁止反向把 targeted 写进 `executedRoutes`；
  禁止让 targeted 制造或阻止 SATURATED；不得新建成本控制器。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T08 — Gap 复评、resolution 谓词与终态语义（S9 / S10 的判定面 / G.1…G.5.1 / H-6 / H-7 / H-8）

- **TYPE**: CODE
- **RISK**: HIGH
- **GOAL**: 实现 `newEvidenceIds = { canonical questionId } ∩ targeted fused candidates \
  (action 执行前 pool 已有 questionId)`（canonical questionId novelty，**不是**返回条数、
  不是文本相似度）；`newEvidenceIds.length === 0` → 不 RESOLVED；重复来源 → `DUPLICATE_ONLY`；
  `ASPECT_GAP` / `CONTRADICTION_GAP` 谓词（`ASPECT_MIN_NEW_SOURCES_V1` /
  `OPPOSING_SIDE_NEW_SOURCES_V1`，"另一侧"由**授权时** provenance 声明、不得由内容推断）；
  `AUTHORITY_GAP` → `resolutionPredicateRef = NONE_REGISTERED`、默认
  `UNRESOLVED` + `resolutionBasis = UNKNOWN_NO_AUTHORITY_PREDICATE`；
  `EXHAUSTED_WITHIN_BUDGET` vs `UNRESOLVED` 的 G.5.1 判定规则；H-6/H-7/H-8
  （operational failure ≠ resolved ≠ saturation ≠ "成功但无结果"；模型不得产出
  CONTINUE/STOP/SATURATED/RESOLVED；run 层 STOP 时非终态 gap 显式落定并保持可见）。
- **WHY_THIS_IS_ONE_TICKET**: `GAP_RESOLUTION_OWNER` 唯一；resolution 谓词、重复处理、
  终态判定规则是同一条"证据 → 结论"链的连续三段，拆开会出现"谓词说 RESOLVED、
  终态说 UNRESOLVED"的不可判定态。
- **AUTHORITY**: Spec §13、§14、§18（#111 处置）；Seam Map S9；Seam Contract G.1–G.5.1、H-6/H-7/H-8。
- **IN_SCOPE**: 复评模块、三种谓词（含 `NONE_REGISTERED`）、resolutionBasis 集合、
  G.5.1 判定规则、H-8 落定规则、focused tests。
- **OUT_OF_SCOPE**: **#111 的任何 authority 谓词实现**（明令排除）；热度/点赞/认证外观/authorRef
  作为权威性代理；stance/sentiment/立场分类器或任何文本归因器；产物可见性渲染（T10）。
- **PRODUCER**: targeted-requery controller（复评）
- **CONSUMER**: P2A-T10（可见性）、P2A-T09（编排）
- **OWNED_STATE_OR_SURFACE**: `targetedActions[]` / gap 记录的 resolution 字段（唯一写者）
- **FILES_OR_COMPONENTS_EXPECTED**: targeted-requery 复评模块 + focused tests
- **BLOCKED_BY**: P2A-T06；**BLOCKS**: P2A-T09、P2A-T10
  （T09 直接需要"已提交 action + 复评终态"才能完成子阶段编排；T05 经 T06→T08 传递影响 T09，记为
  `TRANSITIVE_AFFECTS`，不编码为直接边）
- **ACCEPTANCE_CRITERIA**:
  1. 判据 = canonical questionId novelty；返回条数 / 文本相似度一律不作证据；
  2. `AUTHORITY_GAP` 在 MVP 内默认 `UNRESOLVED` + `UNKNOWN_NO_AUTHORITY_PREDICATE`，
     不得用 `authorRef` / 热度 / 点赞 / 认证外观代理；
  3. "另一侧"来自授权期声明，不含任何内容归因设施；
  4. `EXHAUSTED_WITHIN_BUDGET` **不**由 SATURATED / PROVIDER_FAILURE 触发（G.5.1 规则）；
  5. `FAILED_OPERATIONAL` 永不写成 `RESOLVED` / `SATURATED`；
  6. 模型输出中出现 CONTINUE/STOP/SATURATED/RESOLVED 断言 → 不被采纳（机械拒绝）。
- **REQUIRED_TESTS**: novelty 判据、重复来源、三类 gap 谓词各正/负例、
  AUTHORITY_GAP 默认终态、G.5.1 三类分支、operational failure 不洗白、无归因设施断言。
- **COUNTEREXAMPLES**: C6（只返回重复来源 → UNRESOLVED / DUPLICATE_ONLY）；
  C7（CONTRADICTION_GAP 再次取到同一侧 → UNRESOLVED）；
  C8（AUTHORITY_GAP 只找到热门评论 → UNRESOLVED，不伪造权威证据）；
  C10（provider 失败 → operational failure ≠ saturation ≠ resolved）。
- **FAIL_CLOSED / STOP CONDITIONS**: 无已注册谓词 → UNKNOWN → UNRESOLVED，不得猜测；
  不得把预算耗尽写成 SATURATED。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T09 — Targeted 子阶段编排集成（S5/S8 位置 / D12-7 两处接触面闭环 / 反第二管线）

- **TYPE**: INTEGRATION
- **RISK**: HIGH
- **GOAL**: 把 T02–T08 组装成一个位于 **STAGE_SEARCH 内、T08 选组之前**的 targeted 子阶段：
  每轮按 `gapId` 升序确定性选 gap → 诊断（T03）→ 授权（T05，含 T04 门）→
  经 `runMultiQueryRetrieval(targetedQueries)`（T02）执行 → 提交（T06）→ 复评（T08）→
  把计数喂给 `evaluateRetrievalRound`（T07）；保证
  **P1 接触面恰为两处 additive（缺省保行为不变）**、artifact-walk 调用点零改动、
  既有 `runRetrievalFeedbackLoop` 之外不另起循环、checkpoint 顺序与 crash 边界正确。
- **WHY_THIS_IS_ONE_TICKET**: `FINAL_FEEDBACK_LOOP_OWNER` 唯一；编排位置（T08 之前）与
  checkpoint 顺序是只有集成层能证明的两件事，且它是"无第二管线"的最终机械检查点。
- **AUTHORITY**: Spec §9、§12；Seam Map §0（落点理由）、S5、S8；Seam Contract F.7（两处接触面）；
  key-decisions D12-7。
- **IN_SCOPE**: `coverage-final-integration.mjs` / `p1-runtime-composer.mjs` 的 additive 编排点、
  子阶段位置、每轮循环边界、checkpoint 顺序、crashAt 边界（沿用既有机制）、集成测试。
- **OUT_OF_SCOPE**: 下游 T08/T12/T13/T14/T15 语义改动；第二检索入口；新 stage；
  任何 `ResearchCoverageState` 写入；任何 P1 STOP 语义改动。
- **PRODUCER**: targeted-requery controller（子阶段）
- **CONSUMER**: 既有 T08 source-group selection 及其后全部下游（零改动）；最终产物
- **OWNED_STATE_OR_SURFACE**: STAGE_SEARCH 内 targeted 子阶段的执行顺序与 checkpoint 顺序
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/lib/coverage-final-integration.mjs`
  与/或 `p1-runtime-composer.mjs` 的 additive 编排点 + 集成测试
- **BLOCKED_BY**: P2A-T02、P2A-T03、P2A-T07、P2A-T08；**BLOCKS**: P2A-T11、P2A-T12、P2A-T13
- **ACCEPTANCE_CRITERIA**:
  1. targeted 子阶段严格位于 STAGE_SEARCH 内、T08 选组之前（机械断言）；
  2. 未启用 #108 时编排路径与今天**逐字等价**；
  3. P1 接触面 = 两处 additive（`retrieval.mjs` `targetedQueries` 缺省 null、
     `evaluateRetrievalRound` `targetedAttempts` 缺省 0/0），无第三处；
  4. artifact-walk 调用点零改动；
  5. checkpoint-first 顺序在集成层成立（产物字节 → hash → writeState）；
  6. 下游零改动消费更大的 accumulated pool。
- **REQUIRED_TESTS**: 位置断言、缺省等价性（全链路对照）、两处接触面枚举断言、
  集成序列 happy path、targeted 结果进入同一 pool 的等价性、crash 边界注入。
- **COUNTEREXAMPLES**: targeted 检索发生在 T08 之后 → 测试失败；
  出现第二处 `seam.retrieve + rrfFusion + pool merge` 组合 → 测试失败。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得为 #108 改动 dense geometry / RCE / claim / synthesis；
  不得新建 stage 或第二循环。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认；本票为 INTEGRATION_BARRIER，串行集成
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T10 — Gap 终态在最终产物中的可见性（S10 / Spec §20-9 / §20-11 / H-8）

- **TYPE**: CODE
- **RISK**: MEDIUM
- **GOAL**: 把 gap 终态集合（含 `UNRESOLVED` / `EXHAUSTED_WITHIN_BUDGET` /
  `UNKNOWN_NO_AUTHORITY_PREDICATE`）以逐条可见的形式写入最终研究产物，并使
  `gap → action → query → retrieval → result` 血缘可审计（F.4）。
  未解决 gap 不得静默消失；不得用 `SATURATED` 覆盖 unresolved 真值。
- **WHY_THIS_IS_ONE_TICKET**: 产物组装是独立于"判定"的 authority surface
  （判定在 T08，渲染/可见性在此），且它是"诚实可见性"这条产品约束的唯一落点。
- **AUTHORITY**: Seam Map S10；Seam Contract F.4、G.5、H-8；Spec §13、§20-9、§20-11。
- **IN_SCOPE**: 产物 gap 记录区块、血缘字段输出、可见性断言测试。
- **OUT_OF_SCOPE**: 终态判定（T08）、任何渲染/UI 重构、任何价值声明。
- **PRODUCER**: targeted-requery controller（可见性输出）
- **CONSUMER**: 最终研究产物 / 评估（#107）
- **OWNED_STATE_OR_SURFACE**: 最终产物中的 gap 记录区块（唯一写者）
- **FILES_OR_COMPONENTS_EXPECTED**: 产物组装模块（既有）additive 区块 + focused tests
- **BLOCKED_BY**: P2A-T08；**BLOCKS**: P2A-T14
- **ACCEPTANCE_CRITERIA**:
  1. 每条非 RESOLVED gap 在产物中逐条可见，含终态与 `resolutionBasis`；
  2. 血缘 `targetedActionId → gapId → query → providerId/capability → 结果` 可机械回溯；
  3. 产物不泄漏机器绝对路径；
  4. 未解决 gap 不因 run 层 STOP 而消失。
- **REQUIRED_TESTS**: 终态可见性矩阵、血缘回溯、路径安全、STOP 后仍在产物中。
- **COUNTEREXAMPLES**: 预算耗尽 → 产物中记为 `EXHAUSTED_WITHIN_BUDGET` 而非 `SATURATED`；
  模型断言"已解决" → 不出现在产物的 resolved 集合中。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得用 SATURATED 措辞覆盖 unresolved 真值；
  gap 静默丢弃 = 失败。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER`
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T11 — 信任边界可执行守卫套件（F.3 / 任务 §8；**不是散文验收**）

- **TYPE**: TEST / EVIDENCE
- **RISK**: HIGH
- **GOAL**: 用**可执行测试**证明四条信任边界事实（任务 §8 要求）：
  1）`assertArtifactSafe` 传 `trustedPlanStrings` 的**四处**生产调用点**逐字未改**
     （`retrieval.mjs:761`、`coverage-final-integration.mjs:444`、
     `source-group-selection.mjs:1110`、`coverage-state.mjs:519`）；
  2）targeted 字符串**未**被加入任何既有 `trustedPlanStrings`；
  3）targeted 字符串**不能**被写入 `coverageState.retrieval.plannedQueryVariants`；
  4）`PLAN_OWNED` targeted 材料**仍**过双 lens；"看起来像 plan-owned 但不安全"的字符串 fail closed。
- **WHY_THIS_IS_ONE_TICKET**: 信任边界的守卫必须**独立于**实现它的票（T04/T05）才有效；
  它是历史审查中真实出过缺陷的地方，不能只靠开发者自测。
- **AUTHORITY**: Seam Contract F.3（含四处调用点清单与 (4) 的单 lens 风险）；
  Spec §5 D3、§10；key-decisions D12-3；`rrf.test.mjs:996-1008`（F8）既有机械证据。
- **IN_SCOPE**: 守卫测试套件、调用点枚举断言（机械遍历 `lib/`）、负例 fixtures。
- **OUT_OF_SCOPE**: 修改四处调用点的权威（明令"不得随意改动"）；任何新信任设施。
- **PRODUCER**: 测试套件
- **CONSUMER**: 仓库信任边界（跨 T02/T05/T09 的横切守卫）
- **OWNED_STATE_OR_SURFACE**: 测试文件与 fixtures（不写产品状态）
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/test/` 下 targeted 信任守卫套件
- **BLOCKED_BY**: P2A-T09；**BLOCKS**: P2A-T14
- **ACCEPTANCE_CRITERIA**: 四条全部由**可执行断言**覆盖；调用点枚举是遍历式而非手写清单
  （新增第五处传信任集的调用点 → 测试失败并需回到 T04/T05 裁决）。
- **REQUIRED_TESTS**: 调用点快照/枚举断言、信任集成员断言、plannedQueryVariants 非写入断言、
  双 lens 正/负样本矩阵、UNCLASSIFIED fail closed。
- **COUNTEREXAMPLES**: C3；"定向字符串出现在 provider 结果中 → 按 provider-content 判定
  （基线处理，FAIL_CLOSED，不静默）"；尝试把定向字符串写入
  `coverageState.retrieval.plannedQueryVariants` → 测试失败。
- **FAIL_CLOSED / STOP CONDITIONS**: 若实现期发现必须扩展 `trustedPlanStrings` →
  STOP（不得在 ticket 层放宽安全边界）。
- **REVIEWER_QUORUM**: 1 × `SECURITY_REVIEWER` + 1 × `CODE_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T12 — 身份 / 重放 / 崩溃边界反例套件（E.2 / E.6 / F.1 / F.5；任务 §9）

- **TYPE**: TEST / EVIDENCE
- **RISK**: HIGH
- **GOAL**: 用可执行反例证明（任务 §9）：
  同一逻辑 gap **跨轮** → 同一 `gapIdentityCore`（`diagnosisRound` 只审计）；
  同一 gap + 等价查询 → 有界 dedupe；
  同一 `targetedActionId` + 不同内容 → fail closed（保守重跑）；
  resume 时已提交 action → **不**重复检索；
  未提交 action → 按合同安全重跑一次。
- **WHY_THIS_IS_ONE_TICKET**: 这些反例横跨 T01/T05/T06 但**不能**由任一实现票自己证明；
  集中一票才能一次断言"身份 = 身份，审计 = 审计"的分离。
- **AUTHORITY**: Seam Contract E.2、E.6、F.1、F.5；Spec §19 C1/C4/C5/C12；key-decisions D12-8。
- **IN_SCOPE**: 反例测试套件与崩溃注入 fixtures。
- **OUT_OF_SCOPE**: 实现代码；任何新身份机制。
- **PRODUCER**: 测试套件
- **CONSUMER**: T01/T05/T06 的合并门禁（作为回归守卫）
- **OWNED_STATE_OR_SURFACE**: 测试文件与 fixtures
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/test/` 下 targeted 身份/重放套件
- **BLOCKED_BY**: P2A-T09；**BLOCKS**: P2A-T14
- **ACCEPTANCE_CRITERIA**: 五类反例全部可执行；崩溃注入点覆盖 commit point 前/后。
- **REQUIRED_TESTS**: 跨轮 gapIdentityCore 稳定性、等价查询 dedupe（含归一化等价类）、
  同 id 不同内容 fail closed、resume 三分支、崩溃注入前后。
- **COUNTEREXAMPLES**: C1、C4、C5、C12。
- **FAIL_CLOSED / STOP CONDITIONS**: 任何"靠时间戳/随机数产生身份"的实现 → 失败；
  任何"未提交即复用"的实现 → 失败。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T13 — STOP / 预算非干扰回归与反例矩阵收口（H-1…H-8 / C9 / C10 / C11）

- **TYPE**: TEST / EVIDENCE
- **RISK**: HIGH
- **GOAL**: 用可执行回归证明：`plannedRoutes` 不被改写；SATURATED 前置分母不含 targeted；
  BUDGET_STOP 分母含 targeted；targeted 不自增 `retrievalRounds`；
  targeted 既不能制造也不能阻止 SATURATED；operational failure ≠ saturation ≠ resolved；
  `SATURATION_SEMANTICS_DISCLAIMER` 完整有效；并把 C1–C12 全量反例矩阵收口为一次可运行门禁。
- **WHY_THIS_IS_ONE_TICKET**: STOP 语义是 #108 最容易静默污染 P1 的地方，
  必须有一个**不参与实现**的票来做全量回归收口。
- **AUTHORITY**: Seam Contract H.1–H.8、§5 反例契约索引（C1–C12）；Spec §13、§19；key-decisions D12-4。
- **IN_SCOPE**: STOP/预算回归套件、C1–C12 全量矩阵门禁。
- **OUT_OF_SCOPE**: 实现代码；任何 STOP 语义改动。
- **PRODUCER**: 测试套件
- **CONSUMER**: 全 DAG 的合并门禁
- **OWNED_STATE_OR_SURFACE**: 测试文件与 fixtures
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/test/` 下 targeted STOP/预算回归套件
- **BLOCKED_BY**: P2A-T09；**BLOCKS**: P2A-T14
- **ACCEPTANCE_CRITERIA**: C1–C12 每条至少一个可执行断言；`plannedRoutes` 与
  `SATURATION_SEMANTICS_DISCLAIMER` 有显式不变式断言。
- **REQUIRED_TESTS**: 两分母分离、plannedRoutes 不变、round 不自增、
  SATURATED 不被制造/阻止、C9/C10/C11 场景、disclaimer 文本/语义不变断言。
- **COUNTEREXAMPLES**: C9、C10、C11 + C1–C8、C12 全量。
- **FAIL_CLOSED / STOP CONDITIONS**: 出现"targeted 制造 saturation"或
  "预算耗尽伪装成饱和" → 合并门禁失败。
- **REVIEWER_QUORUM**: 1 × `CODE_REVIEWER` + 1 × `CONTRACT_REVIEWER`（同 exact HEAD）
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T14 — #108 端到端工程验收与血缘审计（Spec §20-1…§20-12）

- **TYPE**: EVIDENCE / DOGFOOD
- **RISK**: MEDIUM
- **GOAL**: 在真实 or 高保真运行上证明 Spec §20 的**工程**验收项 1–12：
  枚举存在且未知类型不产生检索动作；每条 targeted query 绑定到持久 gap；
  controller 检索前校验；复用既有 provider/fusion/identity/provenance（无第二管线）；
  无静默 runtime/provider fallback；repeat/infinite-loop 保护生效；全局与 per-gap 预算均被执行；
  resolution 基于证据而非"查询执行了"；未解决 gap 在最终产物中可见；
  resume/restart 不重复已提交检索；血缘可审计；回归测试覆盖 stale/replayed action。
  **本票不得产出任何"研究质量改善"的价值声明**（那是 T15）。
- **WHY_THIS_IS_ONE_TICKET**: 端到端验收需要跨全部实现票的运行证据，
  与单票 focused tests 是不同的证据类（`ACCEPTANCE_EVIDENCE_REVIEWER`）。
- **AUTHORITY**: Spec §20 验收 1–12；Seam Map S1–S11 全链；任务 §11（工程验收 ≠ 价值声明）。
- **IN_SCOPE**: 端到端运行、产物检查、血缘审计、验收矩阵记录。
- **OUT_OF_SCOPE**: 任何质量改善/价值声明（T15）；#107 harness 本身；实现代码。
- **PRODUCER**: 端到端运行证据
- **CONSUMER**: P2A-T15（价值声明 gate）；仓库验收记录
- **OWNED_STATE_OR_SURFACE**: 验收记录（不写产品状态）
- **FILES_OR_COMPONENTS_EXPECTED**: 验收记录（repo-native planning/evidence 位置）
- **BLOCKED_BY**: P2A-T10、P2A-T11、P2A-T12、P2A-T13；**BLOCKS**: P2A-T15
- **ACCEPTANCE_CRITERIA**: §20-1…§20-12 逐条有可核验记录；§20-13 明确标记为"本票不覆盖，转 T15"。
- **REQUIRED_TESTS**: 端到端运行 + 逐条验收矩阵。
- **COUNTEREXAMPLES**: 任一项验收无证据 → 本票不 PASS。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得把"跑了更多查询"写成成功；
  不得在无 #107 证据时声明质量改善。
- **REVIEWER_QUORUM**: 1 × `ACCEPTANCE_EVIDENCE_REVIEWER`
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

### P2A-T15 — #108 产品价值声明 gate（依赖 #107；Spec §17 / §20-13）

- **TYPE**: EVIDENCE / DOGFOOD（value-claim gate，无工程实现）
- **RISK**: MEDIUM（声誉/诚实性风险高，工程风险低）
- **GOAL**: **只有在本票**，才允许在 #107（Research Evaluation Harness）或等价评估证据齐备后，
  就 Spec §20-13 / §17 的最小度量集（important aspect discovery、hidden-target discovery、
  contradiction discovery、authority-source discovery、duplicate ratio、total retrieval cost、
  latency、new materially useful sources per targeted round、unresolved-gap rate）
  给出"#108 提升了研究质量"的**有证据**结论，或明确给出
  `UNKNOWN / NOT_DEMONSTRATED` 的诚实结论。
- **WHY_THIS_IS_ONE_TICKET**: 任务 §11 要求"价值声明"与"架构实现"分离；
  一个专用 gate 票使"无 #107 不得声明"成为可机检的 DAG 事实，而不是散文。
- **AUTHORITY**: Spec §17（EVALUATION_DEPENDENCY = #107 OPEN）、§20-13；Issue #108 §9 度量集。
- **IN_SCOPE**: 评估证据收集与结论记录（或明确的 `NOT_DEMONSTRATED` 记录）。
- **OUT_OF_SCOPE**: 任何工程实现；任何无证据的价值声明；#107 harness 的实现。
- **PRODUCER**: 评估证据（依赖 #107）
- **CONSUMER**: 产品/roadmap 结论
- **OWNED_STATE_OR_SURFACE**: 结论记录（不写产品状态）
- **FILES_OR_COMPONENTS_EXPECTED**: 结论记录（repo-native）
- **BLOCKED_BY**: P2A-T14；**EXTERNAL_BLOCKING_DEPENDENCY**: Issue #107 / P2-F01
  （**不是** DAG 节点；不因此阻塞 T01–T14 的任何工程票）
- **BLOCKS**: —
- **ACCEPTANCE_CRITERIA**: 结论要么附 #107/等价证据，要么显式写
  `VALUE_CLAIM = NOT_DEMONSTRATED / UNKNOWN`；`UNKNOWN != PASS`。
- **REQUIRED_TESTS**: 证据存在性检查（无证据 → gate 不通过）。
- **COUNTEREXAMPLES**: 无 #107 证据却出现"#108 提升了研究质量" → gate 失败。
- **FAIL_CLOSED / STOP CONDITIONS**: 不得用"跑了更多查询"作为价值证据。
- **REVIEWER_QUORUM**: 1 × `ACCEPTANCE_EVIDENCE_REVIEWER`
- **MERGE_REQUIREMENT**: 治理默认
- **IMPLEMENTATION_AUTHORIZATION**: NONE

---

## 6. Spec → Ticket 覆盖矩阵（任务 §7 要求项，逐条）

| 要求项 | 归属 | 说明 |
|---|---|---|
| Gap ledger | T01 | artifact + 持久化原语 |
| `gapId` / `gapIdentityCore` | T01 | 唯一定义；跨轮收敛由 T12 断言 |
| MVP gap 枚举 | T01 | 封闭枚举 + `UNKNOWN_GAP_TYPE` |
| TargetedAction contract | T05 | 授权字段与身份 |
| `targetedActionId` | T05 | F.1 |
| `dedupeKey` | T05 | E.6（跨轮命中由 T12 断言） |
| attempt identity | T05（attempt 计数）+ T06（状态推进） | 单一写者 |
| PLAN_OWNED 字符串引用解析 | T04 | 解析 + 双 lens |
| 双 lens 信任校验 | T04（判定）+ T11（守卫） | 交集门 |
| `FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP` | T04 | MVP 授权面收窄 |
| `runMultiQueryRetrieval` additive `targetedQueries` | T02 | F.7 |
| round-controller `targetedAttempts` 记账 | T07 | F.6/F.6.1 |
| `maxQueryBudget` 交互 | T07（全局）+ T05（预检） | 两分母分离 |
| `plannedRoutes` non-mutation | T07（断言）+ T13（回归） | H-1 |
| SATURATED non-interference | T07 + T13 | H-2/H-5 |
| durable commit binding | T06 | F.5 checkpoint-first |
| checkpoint/resume | T06 | 复用 `validateArtifactCheckpoint` |
| replay protection | T06（实现）+ T12（反例） | C4/C5/C12 |
| gap resolution / unresolved / exhausted | T08 | G.4/G.5/G.5.1 |
| duplicate-result handling | T08（`DUPLICATE_ONLY`）+ T02（pool 去重） | G.1/G.2 |
| provider failure semantics | T08（`FAILED_OPERATIONAL`）+ T13 | H-6 |
| lineage gap → action → query → retrieval → result | T05（溯源字段）+ T10（可见/审计） | F.4 |
| observability | T10（产物可见）+ T13（回归） | S10 |
| integration into existing feedback loop | T09 | 子阶段位置 + 两处接触面 |
| negative/counterexample tests | T11、T12、T13 | C1–C12 全量 |
| end-to-end acceptance | T14（工程）+ T15（价值声明） | §20-1…§20-13 |

**继承的既有行为（无 ticket）**：S6（RRF/canonical identity）、S8（下游零改动）、
四处 `assertArtifactSafe` 调用点的权威、`SATURATION_SEMANTICS_DISCLAIMER`、
provider seam / 安全投影 / 持久化 walk —— 全部由 T11/T13 的**不变式断言**守卫。

**显式 deferred / non-goal（无 ticket）**：通用 gap 框架、额外 gap 类型、
泛化调度器与策略学习、跨 occurrence gap 复用、语义相似度去重、成本模型、
动态 provider 选择策略、模型自由文本 `queryText`（Spec §21）。

## 7. Seam Contract MUST / MUST_NOT → Ticket 映射

| Contract 条款 | MUST / MUST_NOT | Ticket |
|---|---|---|
| S1 | 只读既有已验证状态；诊断依据可机械重算 / 不得由模型自由文本直接得出 mechanical 结论 | T03 |
| S2 | proposal 必须绑定已存在 gapId / 不得自赋信任类、自授权、自判 resolved | T04 |
| S3 | 逐条过双 lens 交集门；写清父 gap 溯源；分配 deterministic identity / 不得扩 trustedPlanStrings、不得模型文本自授权、不得同 gap 反复授权等价查询 | T04（门）+ T05（溯源/identity/界）+ T11（守卫） |
| S4 | 每次推进留可机检证据 / 不引入 `executing` 持久化态 | T06 |
| S5 | 走既有 adapter+seam；唯一入口 `runMultiQueryRetrieval`；planHash 绑定为原 plan；结果经既有安全投影与 `assertArtifactSafe` / 不得新建子系统、第二入口、改 plan artifact、绕过 RRF、在入口外复制 | T02 + T09 |
| S6 | 同一套 RRF 与 identity / 不得加权提权单独排序 | INHERITED（T02 断言）+ T13 |
| S7 | 复用既有去重；池重持久化前重跑安全 walk / 不得把返回条数当新证据 | T02 + T08 |
| S8 | 下游零改动 / 不得改 dense/RCE/claim/synthesis | INHERITED（T09 位置断言） |
| S9 | resolution 与 expectedInformation 机械绑定；无谓词 → UNKNOWN 且 UNRESOLVED / 不得热度代理、不得把 operational failure 写成证据结论 | T08 |
| S10 | 未解决 gap 留在产物并保持可见 / 不得用 SATURATED 覆盖 unresolved 真值 | T10 |
| S11 | SATURATED 前置 = plannedCoverageCount；BUDGET_STOP 分母 = maxQueryBudget / 不得让 targeted 制造 saturation、不得让预算耗尽伪装成饱和 | T07 + T13 |
| E.1 | 封闭枚举；未知类型可记录但不得转检索动作 | T01 |
| E.2 | 唯一 `gapId` 定义；`gapIdentityCore` 不含 `diagnosisRound`；跨轮收敛 | T01 + T12 |
| E.3 | subjectKey 三分支；无 intent 时不得塌缩为常数 | T01 |
| E.3.1 | 诊断 = provenance 覆盖；禁止内容归因器 | T03 |
| E.4 | proposal 必填 gapId；MVP 只授权 `planOwnedStringRef`；`queryText` 一律 REJECTED | T04 |
| E.5(1)(2)(3)(9) | gapId 存在且类型合法；双 lens 交集；信任类可判定；MVP planOwnedStringRef | T04 |
| E.5(4)(5)(6)(7)(8) | 父 gap 溯源；per-gap 上界；dedupe；全局预算；providerScope ⊆ plannedRoutes | T05 |
| E.6 | dedupeKey 以 `gapIdentityCore` 为键；同 occurrence 只授权一次；禁止 embedding 去重 | T05 + T12 |
| E.7 | REJECTED 无 IO；不改父 gap；不降级重跑；不计 resolved/saturation | T05 |
| E.8 | gapId 升序确定性；禁止 materiality/confidence 排序 | T05 |
| F.1 | action identity 字段集；禁时间戳/随机数 | T05 |
| F.2 | providerScope ⊆ plannedRoutes；capability 只允许 search；禁静默 fallback | T05 + T02 |
| F.3 | 双 lens 交集；信任类封闭；禁扩 trustedPlanStrings；禁写 `coverageState.retrieval.plannedQueryVariants` | T04 + T11 |
| F.4 | `targetedActionId → gapId → gapType + subjectKey → planHash` 可机检；保留既有 provenance 字段 | T05 + T10 |
| F.5 | checkpoint-first；DUPLICATE_REPLAY_RULE；禁 sidecar receipt | T06 + T12 |
| F.6/F.6.1 | 两分母定义；additive `targetedAttempts`；禁反向写 `executedRoutes` | T07 |
| F.7 | 唯一入口 + `targetedQueries`；P1 接触面恰两处；禁第二管线 | T02 + T09 |
| G.1 | newEvidenceIds = canonical questionId novelty | T08 |
| G.2 | 重复不是新证据；`DUPLICATE_ONLY` | T08 |
| G.3 | 不算 resolution 的封闭清单 | T08 |
| G.4 | 三谓词；AUTHORITY_GAP `NONE_REGISTERED`；禁 stance/立场分类器 | T08 |
| G.5/G.5.1 | UNRESOLVED / EXHAUSTED / UNKNOWN_AUTHORITY 判定规则 | T08 |
| H-1…H-5 | plannedRoutes、两分母、不自增 round、不制造/阻止 SATURATED | T07 |
| H-6/H-7 | operational failure ≠ resolved/saturation；模型不得产出 CONTINUE/STOP/SATURATED/RESOLVED | T08 |
| H-8 | run 层 STOP → 非终态 gap 显式落定并保持可见 | T08 + T10 |
| §5 反例索引 C1–C12 | 全部可机械复现 | T11 / T12 / T13 |

### 7.1 SEAM H 逐条落点（H-1…H-8，便于机检）

上表对 SEAM H 先给范围行（`H-1…H-5` / `H-6/H-7` / `H-8`），此处逐条展开，避免
`H-3` / `H-4` 只以范围出现：

| 条款 | 内容 | Ticket |
|---|---|---|
| H-1 | `plannedRoutes` 永不被 targeted action 改写 | T07（断言）+ T13（回归） |
| H-2 | SATURATED 前置分母 = `plannedCoverageCount` vs `plannedRoutes.length`（不含 targeted） | T07 |
| H-3 | BUDGET_STOP 分母 = `attemptsBudgetCount` vs `maxQueryBudget`（**含** targeted） | T07 |
| H-4 | targeted action 不自增 `retrievalRounds` | T07 |
| H-5 | targeted 既不能制造 SATURATED，也不能阻止 SATURATED | T07 + T13 |
| H-6 | operational failure ≠ gap resolved ≠ saturation ≠ "成功但无结果的证据" | T08 + T13 |
| H-7 | 模型不得产出 CONTINUE / STOP / SATURATED / RESOLVED 中的任何一个 | T08 |
| H-8 | run 层 STOP 时非终态 gap 显式落定并保持可见 | T08 + T10 |

## 8. 反例 → 可执行测试归属

| 反例 | 归属票 |
|---|---|
| C1 同 gap 跨轮等价查询 | T05（实现）+ T12（反例断言） |
| C2 似是而非的无关查询 | T04（MVP 收窄）+ T11 |
| C3 provider-like 不可信字符串 | T04 + T11 |
| C4 commit point 之后崩溃 | T06 + T12 |
| C5 commit point 之前崩溃 | T06 + T12 |
| C6 只返回重复来源 | T08 |
| C7 CONTRADICTION 再取同侧 | T08 |
| C8 AUTHORITY 只找到热门评论 | T08 |
| C9 全局预算耗尽 | T07 + T13 |
| C10 provider 失败 | T08 + T13 |
| C11 saturation 期间存在 targeted | T07 + T13 |
| C12 resume 看到陈旧/重放 action | T06 + T12 |

---

## 9. #107 依赖模型（任务 §11）

```text
#107 / P2-F01 Research Evaluation Harness = OPEN（外部依赖，非本 DAG 节点）

工程实现票 P2A-T01 … P2A-T14：NOT BLOCKED BY #107
  —— Approved Spec 并未要求以 #107 作为 #108 架构/合同实现的前提；
     Spec §17 只禁止"因架构通过而被当作实现授权"与"无证据宣称质量改善"。

价值声明票 P2A-T15：BLOCKED_BY P2A-T14 + EXTERNAL_BLOCKING_DEPENDENCY = Issue #107
  —— 只有这一个 gate 允许产出"#108 提升了研究质量"的结论，且必须附 #107/等价证据；
     否则显式写 VALUE_CLAIM = NOT_DEMONSTRATED / UNKNOWN（UNKNOWN != PASS）。

不发明更强的依赖：不把 T01–T14 任何一票标记为 #107 blocked。
```

## 10. 范围泄漏防护（任务 §17）

| 风险 | 防护 |
|---|---|
| #109 Escape Probe 实现 | 无票实现 pre-stop probe；T09 的编排只服务 gap-driven targeted action；任何 Escape Probe 逻辑 → 越权 |
| #110 自适应 planner | 无票改动 planner / plan schema；`planHash` 与 plan artifact 全程不可变（T01/T02/T05 断言） |
| #111 权威评分 | T08 显式实现 `resolutionPredicateRef = NONE_REGISTERED` → `UNRESOLVED`；**不实现**任何 authority 谓词；禁 `authorRef`/热度/点赞/认证外观代理 |
| #112 BM25/FTS | 无票引入 lexical 信号 / 索引 / 向量库；dedupe 是**字符串等价**（T05），不是语义相似度；T13 断言无新检索设施 |
| 自由文本定向查询 | T04 的 MVP 授权面 = `planOwnedStringRef` only；`queryText` 一律 REJECTED（T11 断言） |
| 第二检索子系统 | T02 唯一入口 + T09 两处接触面 + T13 断言 |

## 11. 自一致性检查（TICKET_DECOMPOSITION_CONFORMANCE_GATE）

### 11.1 机械校验输出（脚本解析本文档 + 图文档，非人工声明）

```text
TICKETS                            = 15（P2A-T01 … P2A-T15）
PARSED_EDGES_FROM_DECOMPOSITION    = 19
MERMAID_EDGES                      = 19
TABLE_EDGES                        = 19
MERMAID == TABLE                   = true
DECOMPOSITION == TABLE             = true
RECIPROCITY（A BLOCKS B ⟺ B BLOCKED_BY A）= OK
DAG_ACYCLIC                        = YES
TRANSITIVE_REDUNDANT_DIRECT_EDGES  = NONE（19 条直接边无一被其它路径隐含）
SEMANTIC_DEPENDENCY_COVERAGE       = COMPLETE（12 组语义依赖全部被直接边或传递闭包覆盖）
REQUIRED_FIELDS                    = ALL_PRESENT（20 个必填字段 × 15 票；含
                                     IMPLEMENTATION_AUTHORIZATION = NONE）
SEAM_COVERAGE                      = COMPLETE（S1–S11、E.1–E.8、F.1–F.7、G.*、H-1…H-8 全部出现）
COUNTEREXAMPLE_COVERAGE            = COMPLETE（C1–C12 全部出现）
GUARD_#109 / #110 / #111 / #112    = PRESENT ×4
GUARD_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP = PRESENT
```

> R1 finding-scoped repair（独立 ticket-graph 审查 `59c7a7e` 的 3 条非阻塞 finding）后
> 已**重跑**同一脚本：上述全部指标不变（15 票 / 19 边 / 互逆 OK / 无环 / 无传递直边 /
> 语义依赖闭包 COMPLETE / 必填字段 ALL_PRESENT）。R2 复审又指出 2 条非阻塞残留
> （§7 的 H 细表切断 GFM 表格；T02 IN_SCOPE 措辞与自身 focused tests 冲突），已一并修
> 正：H 细表移到 §7.1 独立小节；T02 措辞限定为"不得改动 `coverage-final-integration.mjs`"；
> §4 单一写者矩阵把 `accumulated pool` 明确为 **T09 唯一写者**，T02 只写 targeted round pool。

### 11.2 逐条结论

- **覆盖**：§6/§7/§8 无静默缺口；§7 逐条映射了 Seam Contract 的每条 MUST / MUST_NOT。
- **producer / consumer**：§3 与每票字段一致；每个新 artifact 有 producer
  （ledger ← T01、gap 记录 ← T03、action 授权字段 ← T05、提交字段 ← T06、复评字段 ← T08、
  产物 gap 区块 ← T10、测试套件 ← T11/T12/T13），每个产物至少有一个真实 consumer
  （ledger → T03/T05/T06/T07/T08/T10；targeted pool → 下游 T08/T12/T13/T14/T15；
  终态 → T10 → T14 → T15）。
- **ownership**：§4 单一写者矩阵无冲突；`coverageState.*` 无票可写（由 T11 断言）。
- **依赖**：无环；直接边互逆；无传递边被重复编码（见 §11.1）。
- **票规模**：无"一张大票实现 #108"；最小票（T10）也承载独立 authority surface（产物可见性）。
- **验收**：每票有可执行断言；信任（T11）与重放（T12）是可执行套件，不是散文。
- **resume**：T06 + T12 覆盖 commit point 前/后崩溃边界反例。
- **范围**：§10 四项（#109/#110/#111/#112）与自由文本定向查询全部有显式防护。

## 12. 状态与下一 gate

```text
STATUS = APPROVED / INTEGRATED
AUTHORITY_CLASS = AUTHORITATIVE_TICKET_PLAN
IMPLEMENTATION_AUTHORIZATION = NONE
ISSUE_CREATION_AUTHORIZATION = YES
NEXT_LEGAL_ACTION = 按本文发布 15 张 #108 child Issue（文本一致性源自本文档集成版本）
NEXT_GATE = P2A_INITIAL_START_GATE（单独授权；dependency-ready ≠ implementation-authorized）
```

> 架构批准 **不等于** 实现授权，也 **不等于** 产品价值已证明（#107 OPEN）。
> 本文不启动 #109/#110/#111/#112。

## 12.1 提升（promotion）provenance

```text
REVIEWED_PLANNING_SHA   = 1de3c5481d876fefc2c59f17206a65e0b62fcff8
REVIEWED_PLANNING_BRANCH = planning/p2-ari-f02-ticket-decomposition
BASE_MASTER_SHA         = 504021b8965956d19fe4a17a9181cfe2c6bba93f
PROMOTION_DELTA         = 仅本文档 + P2_ARI_108_TICKET_GRAPH_V1.md 的
                          状态 / 权威 / provenance 元数据（ticket 正文零改写）
PROMOTION_SEMANTIC_CHANGE = NONE（15 票、19 直接边、互逆、无环、所有权矩阵全部不变）
PROMOTION_REVIEW_QUORUM = AGENTS.md §5.1「Approved Spec / governance authority change」
                          = 1 × CONTRACT_REVIEWER + 1 × CONSISTENCY_REVIEWER，同 exact HEAD
PROMOTION_REVIEW_VERDICT = 见 §12.2（append-only 补全）
ISSUE_CREATION_AUTHORIZATION_USED_AFTER_INTEGRATION = 待发布后回填
DEPENDENCY_READY_SET    = { P2A-T01, P2A-T02, P2A-T04 }（记录用，**未**授权启动）
INVARIANT               = Issue 创建授权 ≠ 实现授权；
                          #107 只外部阻塞 P2A-T15；T01–T14 NOT BLOCKED BY #107
```

提升前的 CANDIDATE 阶段闸门史实（`REVIEW_PENDING` + `NEXT_GATE =
TICKET_GRAPH_INTEGRATION_AND_ISSUE_CREATION_AUTHORIZATION`）保留在 git history
（`planning/p2-ari-f02-ticket-decomposition` @ `1de3c54`）中，不在本文内静默改写。
