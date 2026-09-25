# P2-ARI #108 Targeted Re-query — Seam Map V1

> **命名守卫**：本文 `P2-ARI` = `P2 / ADAPTIVE_RESEARCH_INTELLIGENCE`（#107–#112）。
> 与 2026-08-25 Product Direction 的 `LEGACY P2 = AUTHOR / PERSONAL INTELLIGENCE` 无关。

```text
DOCUMENT_ID   = P2_ARI_108_TARGETED_REQUERY_SEAM_MAP_V1
STATUS        = CANDIDATE
AUTHORITY_CLASS = PLANNING / ARCHITECTURE CANDIDATE
IMPLEMENTATION_AUTHORIZATION = NONE
TICKET_AUTHORIZATION = NONE
BASE_SHA      = 7915e84a20b62086c53d045549329111098ca11e
BRANCH        = spec/p2-ari-f02-targeted-requery
TARGET_ISSUE  = #108（P2-F02 Gap-aware Targeted Re-query）
COMPANION     = P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1.md
               P2_ARI_108_TARGETED_REQUERY_SPEC_CANDIDATE_V1.md
DECISION_RECORD = docs/architecture/key-decisions.md D12
CODE_AUTHORITY_AT_BASE_SHA =
  research-orchestration/lib/{plan-contract,planner,retrieval,rrf,provider-seam,
  coverage-state,retrieval-round-controller,coverage-final-integration,state,
  p1-runtime-composer,p1-reuse-closure}.mjs
```

---

## 0. 管线落点（为什么在这里）

```text
Planner → 已验证 plan（planHash）
   ↓
[ 既有 ] runRetrievalFeedbackLoop：round → runMultiQueryRetrieval（plan.queryVariants × channels）
   ↓
[ 既有 ] accumulated Candidate Pool（retrieval-rounds/accumulated-pool.json）
   ↓
★ #108 targeted sub-phase（本文）—— 位于 STAGE_SEARCH 内、T08 选组之前
   ↓
[ 既有 ] T08 source-group selection
   ↓
[ 既有 ] dense geometry → RCE selection → T13 analysis → T14 synthesis → T15 coverage/STOP
```

落点理由（代码事实）：

- `runRetrievalFeedbackLoop` 的每一轮都用**同一个 plan** 重跑 `runMultiQueryRetrieval`，
  其源码注释明确写着"targeted re-query（Issue #53）out of scope"。因此"新查询"无法塞进既有 round 语义；
- T08 之后一旦 `selectedCorpusSourceSet` 变化，`updateSelectionAccounting` 会**连带清空**
  mapped / analyzed source set 与 evidenceRefIssues 并复位 `is100PercentAnalysis`。
  把 targeted 检索放在 T08 之后，等于每次定向查询都要作废整个分析链；
- 放在 STAGE_SEARCH 内、T08 之前，是唯一既不改 P1 下游语义、又能让新证据进入既有 pool 的位置。

---

## 1. 主链路

```text
CURRENT VERIFIED RESEARCH STATE
        ↓  S1
GAP DIAGNOSIS
        ↓  S2
TARGETED QUERY PROPOSAL
        ↓  S3
CONTROLLER VALIDATION
        ↓  S4
AUTHORIZED TARGETED ACTION
        ↓  S5
EXISTING RETRIEVAL PROVIDER PATH
        ↓  S6
RRF / CANONICAL IDENTITY
        ↓  S7
ACCUMULATED CANDIDATE POOL
        ↓  S8
EXISTING DOWNSTREAM ANALYSIS（T08 → T12 → T13 → T14 → T15，零改动）
        ↓  S9
GAP RE-EVALUATION
        ↓  S10
RESOLVED / UNRESOLVED
        ↓  S11
CONTINUE / STOP AUTHORITY（既有 T07 round controller + P1 final STOP）
```

---

## 2. 逐 seam 归属

### S1 — CURRENT VERIFIED RESEARCH STATE → GAP DIAGNOSIS

```text
PRODUCER        = 检索阶段 controller（targeted-requery controller）
CONSUMER        = GAP_DIAGNOSIS
SEMANTIC_OWNER  = controller
IDENTITY_OWNER  = controller（planHash + occurrenceId）
PERSISTENCE_OWNER = controller（work-dir artifact）
RETRY_OWNER     = N/A（读取既有状态，无副作用）
BUDGET_OWNER    = N/A
STOP_OWNER      = N/A

INPUT_CONTRACT  = accumulated Candidate Pool（已有 accumulated-pool.json）
                  + 已验证 plan（aspects / opposingFramings / entities /
                    terminologyVariants / sourceGroupIntents）
                  + ResearchCoverageState.retrieval（只读）
OUTPUT_CONTRACT = TargetedRequeryLedger.diagnosedGaps[]（controller-mechanical 部分）

SYNC / ASYNC    = SYNC
LEGAL_STATES    = READ_ONLY_INPUT
ILLEGAL_STATES  = 诊断阶段写回 pool / coverage / plan
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED（状态不可读 → 不产出 gap，不静默继续）
MUST            = 只读既有已验证状态；诊断依据必须可机械重算
MUST_NOT        = 不得从模型自由文本直接得出 controller-mechanical gap 结论

PRODUCTION_CALLER = research-orchestration 检索阶段编排（STAGE_SEARCH 内）
TEST_CALLER       = research-orchestration/test/（本阶段不写测试；测试属实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = 新增 controller-owned gap ledger artifact（不改动任何 P1 产物）
```

### S2 — GAP DIAGNOSIS → TARGETED QUERY PROPOSAL

```text
PRODUCER        = 语义模型（semantic runtime）
CONSUMER        = CONTROLLER VALIDATION（S3）
SEMANTIC_OWNER  = 模型（只拥有语义）
IDENTITY_OWNER  = N/A（proposal 无权威身份）
PERSISTENCE_OWNER = controller（原样记录 proposal，仅供审计）
RETRY_OWNER     = N/A
BUDGET_OWNER    = N/A
STOP_OWNER      = N/A

INPUT_CONTRACT  = { gapId, gapType, expectedInformation, 候选查询材料 }
OUTPUT_CONTRACT = TargetedQueryProposal（UNTRUSTED）
                  { gapId, queryText?, planOwnedStringRef?, requestedProviderScope?, intent? }

SYNC / ASYNC    = SYNC
LEGAL_STATES    = PROPOSED
ILLEGAL_STATES  = 任何自称 AUTHORIZED / RESOLVED 的 proposal
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED（不可解析 / 缺 gapId → 丢弃 proposal）
MUST            = proposal 必须绑定已存在的 gapId
MUST_NOT        = 不得自行赋信任类、不得自行授权、不得自行判定 gap 已解决

PRODUCTION_CALLER = 检索阶段 controller 调用语义 runtime
TEST_CALLER       = 同上（实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = 一条 PROPOSED 记录（不触发任何检索 IO）
```

### S3 — TARGETED QUERY PROPOSAL → CONTROLLER VALIDATION → AUTHORIZED TARGETED ACTION

```text
PRODUCER        = controller（唯一授权者）
CONSUMER        = 既有检索路径（S5）
SEMANTIC_OWNER  = controller
IDENTITY_OWNER  = controller（targetedActionId）
PERSISTENCE_OWNER = controller
RETRY_OWNER     = controller
BUDGET_OWNER    = controller（扣减 per-gap attempt 与全局 budget）
STOP_OWNER      = controller（可因 budget 拒绝授权）

INPUT_CONTRACT  = TargetedQueryProposal + gap ledger + 剩余预算 + 已授权查询集合
OUTPUT_CONTRACT = TargetedQueryAction
                  { targetedActionId, planHash, runId, occurrenceId, gapId, attempt,
                    query, queryTrustClass, providerScope, status: AUTHORIZED }
                  或 { status: REJECTED, rejectionCode }

SYNC / ASYNC    = SYNC
LEGAL_STATES    = AUTHORIZED / REJECTED
ILLEGAL_STATES  = 未授权即进入检索；信任类缺失；gapId 不存在；
                  同一 (gapId, normalizedQuery, providerScope) 重复授权；
                  超出 per-gap attempt bound；超出全局 maxQueryBudget
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED
MUST            = 逐条过**双 lens 交集**字符串门（isPlanBoundarySafeString AND
                  isBoundarySafeString，见 SEAM F.3 / key-decisions D12-3 —— 单写
                  "plan-boundary 门"是不完整表述）；写清父 gap 溯源；分配 deterministic identity
MUST_NOT        = 不得把 trustedPlanStrings 扩成任意集合；不得让模型文本自授权；
                  不得为同一 gap 反复授权等价查询

PRODUCTION_CALLER = 检索阶段 controller
TEST_CALLER       = 同上（实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = 一条 AUTHORIZED action（尚未产生检索 IO）
```

### S4 — AUTHORIZED TARGETED ACTION（状态推进）

```text
PRODUCER        = controller
CONSUMER        = 既有检索 provider 路径
SEMANTIC_OWNER  = controller
IDENTITY_OWNER  = controller（targetedActionId，重放键）
PERSISTENCE_OWNER = controller（checkpoint binding）
RETRY_OWNER     = controller
BUDGET_OWNER    = controller
STOP_OWNER      = controller

INPUT_CONTRACT  = TargetedQueryAction（AUTHORIZED）
OUTPUT_CONTRACT = TargetedQueryAction（COMMITTED | EVALUATED | 终态）
SYNC / ASYNC    = SYNC
LEGAL_STATES    = PROPOSED → AUTHORIZED → COMMITTED → EVALUATED
                  → { RESOLVED | UNRESOLVED | EXHAUSTED_WITHIN_BUDGET }
                  另有两个非推进终态：REJECTED（授权阶段）、FAILED_OPERATIONAL
ILLEGAL_STATES  = PROPOSED 直达检索；COMMITTED 被静默重跑；
                  EVALUATED 之前出现 RESOLVED；FAILED_OPERATIONAL 被写成 RESOLVED
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED
MUST            = 每个状态推进都留下可机检证据（identity + binding hash）
MUST_NOT        = 不引入"executing"这类无法证成的持久化中间态

PRODUCTION_CALLER = 检索阶段 controller
TEST_CALLER       = 同上（实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = ledger 状态推进 + 一条 checkpoint binding
```

> 状态集说明：Issue 原文列出的 `executing` **不**成为持久化状态。
> 理由：`executing` 只能由"AUTHORIZED 且尚无 COMMITTED 证据"推出，
> 持久化它不会带来任何重放保护，反而制造一个崩溃后无法解释的悬挂态（R06 教训）。

### S5 — AUTHORIZED TARGETED ACTION → EXISTING RETRIEVAL PROVIDER PATH

```text
PRODUCER        = 既有 T06 retrieval primitive（复用，不重写）
CONSUMER        = 既有 RRF / canonical identity
SEMANTIC_OWNER  = controller（planHash 绑定、channel 解析）
IDENTITY_OWNER  = controller + 既有 provider seam（providerId / capability / auth_class）
PERSISTENCE_OWNER = controller（targeted round work-dir）
RETRY_OWNER     = controller（按 action identity 幂等）
BUDGET_OWNER    = controller
STOP_OWNER      = controller

INPUT_CONTRACT  = { 原 plan（不可变，planHash 绑定保持为原 plan）
                    + targetedQueries（additive 可选，缺省 null）
                    + channels ⊆ plannedRoutes 通道 }
OUTPUT_CONTRACT = 既有 `runMultiQueryRetrieval` 的真实返回形状
                  { ok: true, pool, poolHash, file }（retrieval.mjs:492 / :798）
                  ※ 旧稿写的 { channels[], ok, itemCount, ... } 是 channel record 形状，已更正

SYNC / ASYNC    = SYNC
LEGAL_STATES    = 复用既有 T06 输出形状（第二检索子系统 = 非法）
ILLEGAL_STATES  = 新 provider 基础设施；绕过 provider seam；静默 provider fallback；
                  在 runMultiQueryRetrieval 之外另行组合 seam.retrieve + rrfFusion
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED（沿用既有 T06 / seam 的失败身份）
MUST            = 走既有 provider adapter + seam；走唯一入口 `runMultiQueryRetrieval`
                  （以 targetedQueries 参数调用，缺省与今天逐字等价）；
                  planHash 绑定保持为原 plan；结果经既有安全投影与 `assertArtifactSafe`
MUST_NOT        = 不得新建搜索子系统；不得新建第二个检索入口；不得改 plan artifact；
                  不得绕过 RRF；不得在唯一入口之外复制 channel 构建 / 融合 / 池写入

PRODUCTION_CALLER = 检索阶段 controller → `runMultiQueryRetrieval`（唯一入口）
                    （contract F.7 冻结：参数化既有 primitive，而非另起组合路径）
TEST_CALLER       = 同上（实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = 一次真实 provider 检索（付费/限速消耗）+ targeted round 产物
```

### S6 — RETRIEVAL RESULT → RRF / CANONICAL IDENTITY

```text
PRODUCER        = 既有 RRF fusion
CONSUMER        = accumulated Candidate Pool
SEMANTIC_OWNER  = 既有 T06（不新增语义）
IDENTITY_OWNER  = 既有 canonical questionId 规则（/^[1-9]\d*$/）
PERSISTENCE_OWNER = controller
RETRY_OWNER     = controller
BUDGET_OWNER    = N/A
STOP_OWNER      = N/A

INPUT_CONTRACT  = 既有 channel rankings
OUTPUT_CONTRACT = 既有 candidate 形状（identity.questionId + rrfScore + provenance）
SYNC / ASYNC    = SYNC
LEGAL_STATES    = 与既有 fusion 完全一致
ILLEGAL_STATES  = 为 targeted 结果另设打分通道或排序规则
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED
MUST            = targeted 结果与计划轮结果用同一套 RRF 与 identity 规则
MUST_NOT        = 不得给 targeted 结果加权、提权或单独排序

PRODUCTION_CALLER = 既有 RRF
TEST_CALLER       = 既有 RRF 测试
OBSERVABLE_PRODUCTION_EFFECT = 无新语义（既有 fusion 被复用）
```

### S7 — RRF OUTPUT → ACCUMULATED CANDIDATE POOL

```text
PRODUCER        = controller（复用既有累积逻辑）
CONSUMER        = 既有下游分析（T08 起）
SEMANTIC_OWNER  = controller
IDENTITY_OWNER  = controller（accumulated-pool.json，planHash 绑定）
PERSISTENCE_OWNER = controller
RETRY_OWNER     = controller
BUDGET_OWNER    = N/A
STOP_OWNER      = N/A

INPUT_CONTRACT  = targeted round 的 fused candidates
OUTPUT_CONTRACT = 更新后的 accumulated pool；新证据 = 此前未出现的 canonical questionId
SYNC / ASYNC    = SYNC
LEGAL_STATES    = 与既有累积规则一致（questionId → best rrfScore 胜者；
                  channel triple 首个产生者胜）
ILLEGAL_STATES  = 重复 questionId 被计为新证据；未重跑 `assertArtifactSafe` 就持久化
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED
MUST            = 复用既有去重（canonical questionId）；池重持久化前重跑安全 walk
MUST_NOT        = 不得把"查询返回了结果数量"当作新证据

PRODUCTION_CALLER = 检索阶段 controller
TEST_CALLER       = 同上（实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = accumulated-pool 内容增加（仅新增 canonical questionId 计入）
```

### S8 — ACCUMULATED CANDIDATE POOL → EXISTING DOWNSTREAM ANALYSIS

```text
PRODUCER        = 检索阶段 controller
CONSUMER        = 既有 T08 / T12 / T13 / T14 / T15
SEMANTIC_OWNER  = 既有各 stage owner（不变）
IDENTITY_OWNER  = 既有各 stage owner（不变）
PERSISTENCE_OWNER = 既有各 stage owner（不变）
RETRY_OWNER     = 既有 composition owner（不变）
BUDGET_OWNER    = N/A
STOP_OWNER      = 既有 T07 / T15

INPUT_CONTRACT  = 既有 accumulated pool（内容可能更多）
OUTPUT_CONTRACT = 既有各 stage 产物（形状不变）
SYNC / ASYNC    = SYNC
LEGAL_STATES    = targeted sub-phase 在 T08 之前结束
ILLEGAL_STATES  = targeted 检索发生在 T08 之后；为 targeted 修改下游 selector 输入语义
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED（沿用既有 stage 语义）
MUST            = 下游零改动消费一个更大的 pool
MUST_NOT        = 不得为 #108 改动 dense geometry / RCE selection / claim / synthesis 语义

PRODUCTION_CALLER = 既有 composition owner（p1-runtime-composer）
TEST_CALLER       = 既有 P1 suites
OBSERVABLE_PRODUCTION_EFFECT = 无（下游按既有语义运行）
```

### S9 — NEW EVIDENCE → GAP RE-EVALUATION

```text
PRODUCER        = controller
CONSUMER        = gap ledger
SEMANTIC_OWNER  = controller
IDENTITY_OWNER  = controller（gapId + resolutionPredicateRef）
PERSISTENCE_OWNER = controller（checkpoint binding）
RETRY_OWNER     = controller
BUDGET_OWNER    = controller（per-gap attempt 递增）
STOP_OWNER      = controller

INPUT_CONTRACT  = { gapId, 新增 canonical questionId 集合, resolutionPredicateRef, attempt }
OUTPUT_CONTRACT = { status: RESOLVED | UNRESOLVED | EXHAUSTED_WITHIN_BUDGET,
                    resolutionEvidence[], resolutionBasis }

SYNC / ASYNC    = SYNC
LEGAL_STATES    = 由 EVALUATED 推进到终态；未满足谓词即保持 UNRESOLVED
ILLEGAL_STATES  = "查询执行了"即 RESOLVED；"返回了重复来源"即 RESOLVED；
                  "provider 失败"即 RESOLVED / SATURATED；模型断言即 RESOLVED
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED
MUST            = resolution 必须与 gap 的 expectedInformation 机械绑定；
                  无已注册谓词（AUTHORITY_GAP in MVP）→ resolutionBasis = UNKNOWN 且保持 UNRESOLVED
MUST_NOT        = 不得用热度 / 点赞 / 流行度代理权威性；
                  不得把 operational failure 写成证据性结论

PRODUCTION_CALLER = 检索阶段 controller
TEST_CALLER       = 同上（实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = gap 终态写入 ledger；未解决 gap 对最终产物可见
```

### S10 — GAP RE-EVALUATION → RESOLVED / UNRESOLVED

```text
PRODUCER        = controller
CONSUMER        = 最终研究产物 / 评估（#107）
SEMANTIC_OWNER  = controller
IDENTITY_OWNER  = controller（gapId）
PERSISTENCE_OWNER = controller
RETRY_OWNER     = N/A
BUDGET_OWNER    = N/A
STOP_OWNER      = N/A

INPUT_CONTRACT  = gap 终态集合
OUTPUT_CONTRACT = 逐条可见的 gap 记录（含 UNRESOLVED / EXHAUSTED_WITHIN_BUDGET）
SYNC / ASYNC    = SYNC
LEGAL_STATES    = RESOLVED / UNRESOLVED / EXHAUSTED_WITHIN_BUDGET / UNKNOWN_AUTHORITY
ILLEGAL_STATES  = gap 静默消失；未解决被写成已解决；预算耗尽被写成 SATURATED
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED
MUST            = 未解决 gap 必须留在产物里并保持可见
MUST_NOT        = 不得用 "SATURATED" 覆盖 unresolved gap 的真值

PRODUCTION_CALLER = 检索阶段 controller / 最终产物组装
TEST_CALLER       = 同上（实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = 产物中出现 gap 记录区块
```

### S11 — CONTINUE / STOP AUTHORITY

```text
PRODUCER        = 既有 T07 round controller（CONTINUE / SATURATED / BUDGET_STOP /
                  PROVIDER_FAILURE）+ targeted controller（gap 层面的 bounded 停止）
CONSUMER        = 检索阶段编排
SEMANTIC_OWNER  = controller（模型永不拥有 STOP）
IDENTITY_OWNER  = controller
PERSISTENCE_OWNER = controller
RETRY_OWNER     = controller
BUDGET_OWNER    = controller
STOP_OWNER      = controller（唯一）

INPUT_CONTRACT  = { coverageState, roundIndex, attemptsBudgetCount, plannedCoverageCount,
                    gap ledger 终态, config }
OUTPUT_CONTRACT = 既有 T07 decision 集合（语义不变）+ targeted 层面的 bounded 终止
SYNC / ASYNC    = SYNC
LEGAL_STATES    = CONTINUE / SATURATED / BUDGET_STOP / PROVIDER_FAILURE
                  + targeted: EXHAUSTED_WITHIN_BUDGET（gap 层，非 run 层）
ILLEGAL_STATES  = 模型拥有 STOP；targeted 尝试进入 SATURATED 前置分母；
                  operational failure 变成 SATURATED 或 gap resolved
FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED
MUST            = SATURATED 前置分母仍为 plannedCoverageCount vs plannedRoutes.length；
                  BUDGET_STOP 分母仍为 maxQueryBudget（G-A2 收窄表述）
MUST_NOT        = 不得让 targeted 制造 saturation；不得让预算耗尽伪装成饱和

PRODUCTION_CALLER = 既有 T07 + 检索阶段 controller
TEST_CALLER       = 既有 P1 controller tests + 新增 gap 层 tests（实现授权后）
OBSERVABLE_PRODUCTION_EFFECT = 既有 STOP 语义零变化；gap 层多一条 bounded 终止记录
```

---

## 3. 反第二管线检查（ANTI-SECOND-PIPELINE）

```text
新增 provider adapter           = NO
新增检索入口                     = NO（既有**唯一**入口 `runMultiQueryRetrieval`
                                   以 additive 可选参数 `targetedQueries` 被调用；
                                   不存在第二个入口、也不存在第二个
                                   seam.retrieve+rrfFusion 组合点）
新增排序 / 打分规则               = NO（复用既有 RRF）
新增 canonical identity 规则      = NO（复用既有 questionId 规则）
新增 corpus / 索引 / 向量库       = NO
新增 coverage 账本字段            = NO（独立于 ResearchCoverageState）
新增 trustedPlanStrings 通道      = NO（只从 controller 已授权 ledger 派生信任集成员）

#108 唯一新增的"为什么存在这条查询"的语义载体 = TargetedQueryAction
```

---

## 4. 明确不存在的 seam（防止施工期臆造）

```text
· GAP → 直接检索           —— 不存在（必须经 S3 授权）
· 模型 → trustedPlanStrings —— 不存在
· targeted → plannedRoutes 写入 —— 不存在（plannedRoutes 只由 provider registry 决定）
· targeted → coverageState.retrieval.plannedQueryVariants 写入 —— 不存在
  （唯一可运行时改写 + 单 plan lens 的信任集来源 = coverage-state.mjs:519；
    写入会重新打开 R1 要关闭的放宽向量。详见 SEAM F.3 / key-decisions D12-3）
· targeted → SATURATED     —— 不存在
· targeted → retrievalRounds 自增 —— 不存在（targeted action 不是 P1 round）
```
