# P2-ARI #108 — Gap-aware Targeted Re-query Spec Candidate V1

> **命名守卫**：本文 `P2-ARI` = `P2 / ADAPTIVE_RESEARCH_INTELLIGENCE`（#107–#112），
> 指 adaptive-research-intelligence backlog。它**不是** 2026-08-25 Product Direction 中的
> `LEGACY P2 = AUTHOR / PERSONAL INTELLIGENCE`。本文不修改、不重解释、不覆盖 LEGACY P2。

```text
DOCUMENT_ID   = P2_ARI_108_TARGETED_REQUERY_SPEC_CANDIDATE_V1
STATUS        = CANDIDATE
IMPLEMENTATION_AUTHORIZATION = NONE
TICKET_AUTHORIZATION = NONE
APPROVED      = NO（未经 independent review + 授权集成，不得被当作 Approved Spec 消费）
LOCATION_NOTE = 有意放 docs/planning/ 而非 docs/specs/：
                docs/specs/ 是 Applicable Approved Specs 的位置，
                CANDIDATE 不得与之同处以免被误读为已批准权威。
BASE_SHA      = 7915e84a20b62086c53d045549329111098ca11e
BRANCH        = spec/p2-ari-f02-targeted-requery
TARGET_ISSUE  = #108（P2-F02）
PHASE         = P2 / ADAPTIVE_RESEARCH_INTELLIGENCE
RELATION_TO_P1 = POST-P1 ADAPTIVE RETRIEVAL（复用，不重写）
EVALUATION_DEPENDENCY = #107 / P2-F01 Research Evaluation Harness
HISTORICAL_PREDECESSOR = #53（closed / not_planned；历史事实，不改写）
COMPANION     = P2_ARI_108_TARGETED_REQUERY_SEAM_MAP_V1.md
               P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1.md
               P2_ARI_108_ARCHITECTURE_GRILLING_RECORD_V1.md
DECISION_RECORD = docs/architecture/key-decisions.md D12
```

---

## 1. Purpose / user problem

P1 的反馈回路回答的是：

> 还要继续搜吗？

它不回答：

> 已经学到了这些之后，下一步**具体**该搜什么？

结果是一个研究运行可以知道自己覆盖很弱，却无法把"弱"转换成一次定向的下一步动作。
本特性要把一个**已诊断的证据缺口**转换成一次**有界、可审计、复用既有检索能力**的后续检索动作，
然后诚实地记录它是被解决了、还是没被解决。

明确不是：

```text
× 让 LLM 浏览到它自己觉得满意为止
× 让模型拥有 canonical 状态 / STOP / resolution 权威
```

## 2. Existing P1 behavior（BASE_SHA 代码事实）

```text
Planner（plan-contract schemaVersion 1，严格 schema）
  → 已验证 plan：queryVariants / aspects / entities / opposingFramings /
                  terminologyVariants / sourceGroupIntents
  → planHash（依赖身份；下游产物记录它，plan 变化即 stale）
  → retrieval：runMultiQueryRetrieval 执行 plan.queryVariants × 搜索通道
  → provider seam（providerId / capability / auth_class；无静默 fallback）
  → 确定性 RRF（k=60；canonical questionId 去重）
  → accumulated Candidate Pool（跨轮累积；best rrfScore 胜者）
  → dense geometry（T11）
  → RCE selection（T12；只消费 dense relevance / novelty / redundancy）
  → analysis（T13 claims）→ synthesis（T14）→ coverage / STOP（T15 / T07）
```

STOP 语义（既有，本特性不改动）：

```text
CONTINUE / SATURATED / BUDGET_STOP / PROVIDER_FAILURE
BUDGET_STOP 分母       = cumulativeAttemptsCount vs maxQueryBudget
SATURATED 前置分母     = cumulativeAttemptsCount vs plannedRoutes.length
                         （plannedRoutes 当前 = 搜索通道身份列表）
```

## 3. MVP scope

```text
1. 三种 gap：ASPECT_GAP / CONTRADICTION_GAP / AUTHORITY_GAP（封闭枚举）
2. 一条闭环：
   gap detected → 有界 query proposal → controller validation
   → 既有检索路径 → 新证据 → gap RESOLVED / UNRESOLVED
3. 有界重试：per-gap attempt bound + per-gap 归一化查询去重
4. 持久化：controller-owned gap / targeted action ledger + checkpoint binding
5. 可见性：未解决 gap 必须留在产物中
```

## 4. Explicit non-goals

```text
· 通用 Gap 框架 / 大 gap taxonomy
· 泛化 multi-policy scheduler
· 学到的查询策略 / RL
· 自治 planner（#110 仍是 DESIGN_ONLY）
· Escape Probe 作为通用 pre-stop 策略（#109，本 Spec 不实现）
· 独立 ADR 制度（docs/adr/）
· 第二检索子系统 / 新 provider 基础设施 / BM25 / FTS / vector DB
· token / money / provider 成本平台
· universal evidence / authority score（#111 未实现，不得伪造）
· 替换 P1 planner；赋予 LLM canonical 状态权威
· 任何"#108 提升了研究质量"的价值声明（见 §17）
```

## 5. Architecture decisions（D1–D6 全部决议）

### D1 — GAP STATE AUTHORITY

```text
GAP_SEMANTIC_OWNER      = CONTROLLER（模型只 proposal）
GAP_IDENTITY_OWNER      = CONTROLLER（gapId，见 SEAM E §E.2）
GAP_PERSISTENCE_OWNER   = CONTROLLER（独立于 ResearchCoverageState 的 ledger artifact）
GAP_RESOLUTION_OWNER    = CONTROLLER（证据绑定；模型永不 resolved）

derived vs canonical    = DERIVED（不是 canonical 事实源；
                          canonical source identity / provenance / coverage 仍在既有权威）
durable vs ephemeral    = DURABLE within occurrence（跨 crash/resume 持久；
                          不跨 occurrence 复用，不跨 planHash 复用）
与 ResearchCoverageState = 同级兄弟 artifact，由 planHash 锚定；
                          不写入其中（避免 COVERAGE_STATE_SCHEMA_VERSION 变更 = P1 权威变更）
mutation authority      = CONTROLLER 唯一写入者
最小解释评估结论         = "controller-owned derived orchestration state" 足够；
                          不需要新的全局真值系统

诊断依据                = provenance-based 查询覆盖，【不是】内容归因
                          （gap 成立判据：某个 plan-owned 字符串材料尚未出现在
                            任何已执行查询的 provenance 中；
                            不判断"某条 candidate 内容属于哪个 aspect"，
                            不引入任何文本/词典/embedding 归因器）
```

**候选选项对比（为什么不是别的）**

| 选项 | 结论 | 理由 |
|---|---|---|
| 嵌进 ResearchCoverageState | 拒绝 | 需 schemaVersion 变更 = P1 权威变更；且破坏既有 hook 所有权边界 |
| 模型拥有的 gap 真值 | 拒绝 | 违反 D02（Controller owns truth）与 Issue #108 §5 |
| 新建全局 gap 真值系统 | 拒绝 | 远超 MVP；无证据要求 |

### D2 — DYNAMIC QUERY IDENTITY

```text
DYNAMIC_QUERY_IDENTITY_MODEL = C — child targeted-retrieval action
```

| 选项 | 对 planHash | 对 run/artifact 身份 | 对 checkpoint/resume | 对 provenance | 结论 |
|---|---|---|---|---|---|
| A. mutate 原 plan | **改变** → 下游全部 stale（`plan_hash_mismatch`；`loadCoverageState` 拒 `stale_plan_hash`） | 破坏 | 破坏 | 丢失"原计划是什么" | 拒绝 |
| B. plan amendment | 需新 schemaVersion（plan schema 严格拒绝未知字段） | 需新依赖身份语义 | 需新恢复规则 | 更重 | 拒绝（= C + 额外机制） |
| C. child targeted action | **不变** | 不变 | 由 action identity 兜住 | targetedActionId → gapId → planHash 显式 | **采纳** |
| D. 复用既有 round 语义 | 不变 | 不变 | — | — | 不成立：round = 用同一 plan 重跑，无法承载新查询 |

采纳理由（非优雅度，而是代码事实）：`planHash` 是 Spec §4.3 的依赖身份；
mutate 它等于把"加一条定向查询"升级为"作废所有下游产物"。
C 保住不可变原计划身份，且只新增一个引用型身份。

### D3 — DYNAMIC QUERY TRUST / AUTHORIZATION

```text
QUERY_SEMANTIC_OWNER        = 模型（只提出）；controller 拥有授权语义
QUERY_AUTHORIZATION_OWNER   = CONTROLLER（唯一）
QUERY_TRUST_CLASS           = PLAN_OWNED | TARGETED_CONTROLLER_AUTHORIZED（封闭枚举）
UNAUTHORIZED_QUERY_BEHAVIOR = FAIL_CLOSED：不产生检索 IO；记 REJECTED + rejectionCode；
                              父 gap 状态不变并保持可见；不得静默降级为"重跑原 plan"
```

最小机制判定 = **validated controller-owned `TargetedQueryAction`**（采纳）。
它不是"把 trustedPlanStrings 扩成任意字符串"：

```text
· 信任集第二个成员集合只能由 controller 已授权的 action ledger 确定性派生
  （沿用 rrf.mjs R11：trustedPlanStrings 不是 general caller-defined trust bypass）
· 每个成员仍被 plan-boundary 字符串门（更严）重新判定，与 plan-owned 同等待遇
· 模型文本、provider 内容、未授权 proposal 一律不并入
· LLM 文本不能自授权；未分类字符串 fail closed；授权必须绑定父 gap 溯源
· 授权必须 survive persistence/recovery：resume 后按 targetedActionId 重新校验
```

### D4 — ATTEMPT / ROUTE / STOP ACCOUNTING

```text
TARGETED_ATTEMPT_ACCOUNTING = 计入 budget 分母：
    attemptsBudgetCount = 计划 executedRoutes + 计划 providerFailures
                          + targetedExecutedCount + targetedFailedCount
                          → vs maxQueryBudget（BUDGET_STOP）

TARGETED_ROUTE_ACCOUNTING   = 独立 ledger 数组（targetedActions[]）；
                              plannedRoutes 永不被 targeted 改写

GLOBAL_BUDGET_INTERACTION   = 沿用既有 maxQueryBudget（默认 10）与 maxRetrievalRounds（默认 3）；
                              targeted action 不自增 retrievalRounds

SATURATION_INTERACTION      = targeted 尝试【不】进入 SATURATED 前置分母；
                              前置仍为 plannedCoverageCount vs plannedRoutes.length（P1 逐字不变）
```

计数粒度（明确，防止预算被悄悄放大）：

```text
1 个 targeted action × |providerScope| = 该 action 的通道级尝试数
maxAttemptsPerGap 约束【action 数】；通道级尝试数全额计入 attemptsBudgetCount
授权前检查的是"本动作通道尝试数"，不是 1
```

接入既有实现的方式（additive，默认零行为变化）：

```text
evaluateRetrievalRound 增加可选显式输入 targetedAttempts = { executed, failed }（默认 0/0）：
  attemptsBudgetCount  = executedRoutes + providerFailures + targeted 两者
  plannedCoverageCount = executedRoutes + providerFailures   ← 逐字等于旧 cumulativeAttemptsCount
缺省/未启用 #108 时两个计数与旧行为逐字相同。
禁止反向把 targeted 尝试写进 executedRoutes 来让它"被看见"（污染 saturation 前置 + 越权写账本）。
```

关键问题回答：**targeted action 是否被算作 P1 `plannedRoutes` 的变更？**
= **否**。理由：

1. `plannedRoutes` 当前由 provider registry 派生（通道身份列表），不是 query×provider 全集；
2. 改它会静默重写 P1 saturation 语义——让少量定向查询机械"证明"计划空间已覆盖，
   直接违反 `SATURATION_SEMANTICS_DISCLAIMER`；
3. 独立 action class 是更小、且不改写既有语义的机制。

### D5 — DURABLE COMMIT / RETRY / RESUME

```text
TARGETED_ACTION_IDENTITY = sha256('p2-ari-targeted-action/v1:' + canonicalJson({
                             runId, occurrenceId, planHash, gapId,
                             attempt, normalizedQuery, providerScope }))

COMMIT_POINT = checkpoint-first：
   action 的持久化 round 产物字节先落盘 + fsync，其 hash 写入 state.hashes，
   然后 writeState 提交。checkpoint 是唯一信任根（P1-R06 教训）。

RETRY_OWNER    = CONTROLLER（targeted-requery controller）
RESUME_OWNER   = 既有 composition owner（p1-runtime-composer / reuse closure），
                 通过 validateArtifactCheckpoint 校验 binding hash
DUPLICATE_REPLAY_RULE =
   已 committed 且 binding hash 校验通过 → 绝不重复付费检索；
   仅 AUTHORIZED（未 committed）或 hash 不匹配 → 安全重跑一次（幂等由 identity 保证）
```

**持久化状态集（只保留必要状态）**

```text
PROPOSED → AUTHORIZED → COMMITTED → EVALUATED → { RESOLVED | UNRESOLVED | EXHAUSTED_WITHIN_BUDGET }
旁支终态：REJECTED（授权拒绝） / FAILED_OPERATIONAL（operational failure，非证据结论）

不设 "executing" 持久化状态：它只能由"AUTHORIZED 且尚无 COMMITTED 证据"推出，
持久化它不带来任何重放保护，反而制造崩溃后无法解释的悬挂态。
```

诚实代价声明：commit point **之前**崩溃，可能已发生一次真实 provider IO 但无持久完成证据，
恢复方按合同安全重跑一次 —— **承认可能重复付费一次**。这是 `UNKNOWN != PASS` 的必然代价，
也是 commit point 必须紧贴 IO 之后的原因。
**禁止**为消除该代价引入"未锚定的第二凭证"（sidecar receipt 等）：
P1-R06 已判定此类凭证为 P0 级未锚定信任源，整体撤销。

确定性 gap 选择顺序：同轮多 gap 竞争预算时按 `gapId` 升序消费预算；
Issue #108 §4 的 `materiality` / `confidence` 在 MVP 内**只作审计记录**，
不参与排序与授权决策（否则等于把预算权威部分让渡给模型，违反 D02）。

### D6 — BUDGET

```text
MVP_BUDGET_MODEL =
   既有全局限制（maxQueryBudget=10 默认、maxRetrievalRounds=3 默认）
 + 最小 per-gap 界：maxAttemptsPerGap（默认 2）
 + 最小去重：per-gap 归一化查询 dedupeKey

NEW_COST_CONTROLLER_REQUIRED = NO
```

Issue #108 §7 列出的四项预算逐项处置：

```text
query_budget     → 复用既有 maxQueryBudget（不新建）
provider_budget  → 不新建维度；以 providerScope ⊆ plannedRoutes 表达（复用既有通道集合）
cost_budget      → 不新建。代码层不存在通用 token/money 成本控制器；
                    MVP 无证据要求它；更小机制（query budget + per-gap bound）已能防循环/超支
round_budget     → 不新建。targeted action 不是 P1 round，不自增 retrievalRounds
```

`SMALLER_MECHANISM_TEST` 结论：**是**，MVP 可安全只依赖既有全局限制 + per-gap attempt bound。

## 6. Gap semantics

见 SEAM E：gapId / subjectKey / 封闭 gapType 枚举 / proposal 绑定 / controller 校验 /
未授权行为。补充语义约束：

```text
· Gap 必须绑定到"已验证研究状态"中的具体对象（aspect / opposingFraming / sourceGroupIntent）
· 未知 gap 类型可记录，【不得】转成检索动作
· 同 gap 在同一 diagnosisRound 内必须收敛为同一 gapId（不得重复创建）
· 不得从同一未解决状态无限生成新 gap：per-gap attempt bound + dedupeKey 双重约束
```

## 7. Targeted-query identity

见 SEAM F §F.1 / §F.6 与 D2 / D5。要点：

```text
· 原 plan artifact 与 planHash 永不改变
· 动态查询只以 targetedActionId 被引用
· 重放保护键 = targetedActionId（含 runId + occurrenceId + planHash + gapId + attempt
  + normalizedQuery + providerScope）
```

## 8. Controller / model authority

```text
CONTROLLER 独占：gap 真值 / gap 身份 / gap 持久化 / gap resolution /
                 查询授权 / 信任分类 / budget / STOP / 检索执行与接受 /
                 provenance / canonical identity / coverage
模型只拥有：     语义（proposal、intent、expectedInformation 的自然语言表达）
模型永不拥有：   canonical source identity / provider IO / coverage 真值 /
                 provenance 真值 / gap resolution 真值 / 检索接受 / STOP
```

## 9. Retrieval reuse

```text
复用：provider adapters / provider seam / RRF / canonical identity /
      accumulated candidate pool / 安全投影 / 持久化 walk / coverage hook
不新增：provider、capability、排序规则、索引、向量库、第二搜索子系统

targeted 结果进入【同一个】 accumulated pool，用【同一套】RRF 与 canonical questionId 去重，
下游 T08/T12/T13/T14/T15 零改动消费一个更大的 pool。
```

## 10. Trust / security

```text
· 目标字符串必须过 plan-boundary 字符串门（与 plan 验证同一合同）
· 信任类封闭枚举：PLAN_OWNED / TARGETED_CONTROLLER_AUTHORIZED / UNCLASSIFIED（fail closed）
· 信任集第二成员集合只能由 controller 已授权 ledger 派生；成员仍被重新判定
· 禁止把 trustedPlanStrings 扩成任意 caller 字符串集合（rrf.mjs R11 约束）
· provider 结果沿用既有安全投影与 assertArtifactSafe；无静默 provider fallback
· 凭据/机器私有路径：沿用既有 CREDENTIAL_SHAPE / PRIVATE_PATH_SHAPE 门，不新建、不削弱
· 结果产物仍不得泄漏机器绝对路径（RULES.md §11）
```

## 11. Budget

见 D6 与 SEAM H §H.1。补充：

```text
· 一个 gap 不得饿死其他研究：per-gap attempt bound + 全局 maxQueryBudget 双重约束
· 不得静默超出全局预算：attemptsBudgetCount 必须看到 targeted 尝试
· 预算结束时未解决 gap 必须被诚实记录（见 §13）
```

## 12. Persistence / retry / resume

见 D5 与 SEAM F §F.5。补充：

```text
· ledger 与 checkpoint 均 work-dir 相对路径，不泄漏机器绝对路径
· 已提交 action 的审计痕迹 append-only（历史不被静默改写）
· resume 校验失败（hash 不匹配 / 产物缺失）→ 安全重跑一次，不得猜测复用
· targeted sub-phase 位于 STAGE_SEARCH 内、T08 选组之前
  （T08 之后改 selectedCorpusSourceSet 会连带清空 mapped/analyzed 与 evidenceRefIssues）
```

## 13. STOP interaction

见 SEAM H。最高级约束复述：

```text
· 模型 MUST NOT own STOP
· operational failure MUST NOT 变成：gap resolved / saturation / 成功的"无结果证据"
· plannedRoutes 永不被 targeted 改写
· SATURATED 前置分母不含 targeted 尝试；BUDGET_STOP 分母含
· targeted action 既不能制造也不能阻止 SATURATED
· run 层 STOP 发生时，所有非终态 gap 显式写为 UNRESOLVED / EXHAUSTED_WITHIN_BUDGET 并保持可见
· SATURATION_SEMANTICS_DISCLAIMER 继续完整有效，不被 #108 扩展或削弱
```

## 14. Failure semantics

```text
REJECTED（授权拒绝）      —— 受控拒绝；无 IO；可审计；父 gap 状态不变
FAILED_OPERATIONAL       —— provider/IO 失败；不是证据结论；不计入 resolved，
                            也不得解释为 saturation
POOL_SAFETY_VIOLATION    —— 持久化安全 walk 失败 → fail closed，不写产物
BUDGET_EXHAUSTED         —— gap 转 EXHAUSTED_WITHIN_BUDGET，诚实可见
IDENTITY_REPLAY_CONFLICT —— resume 期间发现同 id 不同内容 → 保守重跑，保留旧审计痕迹

通用原则：UNKNOWN != PASS；不得伪造证据；不得把失败洗白为成功或饱和。
```

## 15. Seam map

见 `P2_ARI_108_TARGETED_REQUERY_SEAM_MAP_V1.md`（S1–S11，逐 seam 归属）。

## 16. Contracts

见 `P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1.md`（SEAM E / F / G / H，V1）。

## 17. Evaluation dependency（#107）

```text
IMPLEMENTATION_AUTHORIZATION = NONE

· #107（Research Evaluation Harness）是评估依赖，当前 OPEN
· 本 Spec 可以先于 #107 完成而设计，但：
    - 不得因架构通过而被当作实现授权
    - 不得在无 #107 或等价评估证据的情况下宣称"#108 提升了研究质量"
· 未来评估最低度量（Issue #108 §9）：
    important aspect discovery / hidden-target discovery / contradiction discovery /
    authority-source discovery / duplicate ratio / total retrieval cost / latency /
    new materially useful sources per targeted round / unresolved-gap rate
· 成功定义：material gaps 更常以可接受的增量成本被关闭，
  【不是】"跑了更多查询"
```

## 18. Interaction with #109 / #110 / #111 / #112

```text
#109（Pre-stop Escape Probe）
  同为"观察证据之后产生的新查询"，必须复用本 Spec 的 TargetedQueryAction
  身份与授权机制，不得另建一套。#109 当前 WAIT_FOR_108_ARCHITECTURE；
  本 Spec 不实现 #109，也不解锁 #109 的 Spec/Ticket 分解。

#110（Adaptive Research Planner）
  仍为 DESIGN_ONLY。本 Spec 明确【不】推进它；
  "controller 授权、有界、可审计"的约束同样会是 #110 的先决条件，但本 Spec 不为它做设计。

#111（Source Authority & Evidence Quality）
  未实现。MVP 的 AUTHORITY_GAP 因此 resolutionPredicateRef = NONE_REGISTERED，
  默认终态 UNRESOLVED（resolutionBasis = UNKNOWN_NO_AUTHORITY_PREDICATE）。
  不得用 authorRef / 热度 / 点赞 / 认证外观代理权威性。
  未来 #111 注册 AUTHORITY_PREDICATE_V1 后，本 Spec 其余字段与流程不变。

#112（Retrieval Signal Complementarity Experiment）
  冻结池 + 注入 signals 的离线因果比较；E0/E1/E1-D only。
  本 Spec 不引入 lexical 信号、不授权 BM25/FTS/持久索引/向量库，
  也不把任何 lexical score 当 dense relevance 使用。
```

## 19. Counterexamples

| ID | 反例 | 期望 |
|---|---|---|
| C1 | 同一 gap 反复触发等价查询 | dedupeKey 有界去重；不无限重复 |
| C2 | 模型提出似是而非的无关查询 | controller 拒绝（REJECTED），无 IO |
| C3 | targeted 字符串含 provider-like 不可信内容 | 不得自动获得 trusted-plan 状态；UNCLASSIFIED fail closed |
| C4 | 付费检索后、后续分析前崩溃 | 已达 commit point → 持久完成证据阻止重复付费检索 |
| C5 | commit point 之前崩溃 | 按显式合同安全重试 |
| C6 | 查询只返回重复来源 | 不解决 gap（DUPLICATE_ONLY） |
| C7 | CONTRADICTION_GAP 再次只取到一侧 | 保持 UNRESOLVED |
| C8 | AUTHORITY_GAP 只找到热门评论 | 不伪造权威证据；保持 UNRESOLVED |
| C9 | 全局 query budget 耗尽 | 剩余 gap 诚实保持 unresolved / exhausted-within-budget |
| C10 | provider 失败 | operational failure ≠ saturation ≠ gap resolved |
| C11 | saturation 评估期间存在 targeted action | STOP 行为遵循冻结记账合同 |
| C12 | resume 看到陈旧/重放 action | deterministic identity 阻止意外重复执行 |

## 20. Acceptance criteria

```text
1.  显式 gap 类型枚举存在，且未知类型不产生检索动作
2.  每条 targeted query 绑定到一个或多个持久 gap（targetedActionId → gapId）
3.  controller 在检索前校验模型 proposal
4.  复用既有 provider / fusion / identity / provenance 路径（无第二管线）
5.  无静默 runtime / provider fallback
6.  存在 repeat / infinite-loop 保护（dedupeKey + per-gap attempt bound）
7.  全局预算 + per-gap 预算均被执行
8.  gap resolution 基于证据，而非基于"查询执行了"
9.  未解决 gap 在最终产物中保持可见
10. resume/restart 不重复已提交的 targeted 检索
11. query → gap → result 的血缘可审计
12. 回归测试覆盖 stale / replayed action
13. 评估显示质量是否相对基线改善（依赖 #107；无证据不得宣称）
```

## 21. Deferred design

```text
· 其余 gap 类型（SOURCE_GROUP_UNDERCOVERED / CLAIM_SOURCE_DIVERSITY_LOW /
  TERMINOLOGY_GAP / EVIDENCE_DETAIL_GAP …）—— 需真实运行证明三种 MVP 类型无法表达
· 语义相似度去重（embedding-based）—— 属 #112 实验范围，不授权生产设施
· 跨 occurrence 的 gap 复用 / 长期 gap 知识库
· 动态 provider 选择策略（当前固定为 plannedRoutes 子集）
· 成本模型（token / money）
· 泛化调度器与策略学习
```

## 22. Implementation authorization state

```text
SPEC_STATUS                = CANDIDATE
APPROVED                   = NO
IMPLEMENTATION_AUTHORIZATION = NONE
TICKET_AUTHORIZATION       = NONE
READY_TO_DECOMPOSE_TICKETS = NO
PRODUCT_CODE_CHANGE         = NONE
TEST_BEHAVIOR_CHANGE        = NONE
ISSUE_CHANGE                = NONE
NEXT_LEGAL_ACTION           = INDEPENDENT_REVIEW（exact SHA）→ PASS
                              → 另行授权的 SPEC_INTEGRATION_AND_APPROVAL
                              → 之后才允许 ticket 分解
```

> 架构通过 **不等于** 生产价值证明，也 **不等于** 实现授权。
> 正确序列：
> `Architecture Decision → Seam Map / Contract → Spec Candidate → Grilling
>   → Independent Review → PASS → STOP`
