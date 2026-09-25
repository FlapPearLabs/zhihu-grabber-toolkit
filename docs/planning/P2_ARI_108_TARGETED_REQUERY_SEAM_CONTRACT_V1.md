# P2-ARI #108 Targeted Re-query — Seam Contract V1（SEAM E / F / G / H）

> **命名守卫**：本文 `P2-ARI` = `P2 / ADAPTIVE_RESEARCH_INTELLIGENCE`（#107–#112），
> 与 2026-08-25 Product Direction 的 `LEGACY P2 = AUTHOR / PERSONAL INTELLIGENCE` 无关。

```text
DOCUMENT_ID   = P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1
STATUS        = CANDIDATE
AUTHORITY_CLASS = PLANNING / ARCHITECTURE CANDIDATE
IMPLEMENTATION_AUTHORIZATION = NONE
TICKET_AUTHORIZATION = NONE
READY_TO_DECOMPOSE_TICKETS = NO
BASE_SHA      = 7915e84a20b62086c53d045549329111098ca11e
BRANCH        = spec/p2-ari-f02-targeted-requery
TARGET_ISSUE  = #108
SEAM_IDS      = E（GAP_TO_TARGETED_ACTION）/ F（TARGETED_ACTION_TO_RETRIEVAL）
                G（RETRIEVAL_RESULT_TO_GAP_REEVALUATION）/ H（STOP_INTERACTION）
VERSIONS      = E=1, F=1, G=1, H=1（P1 的 A/B/C/D 版本不受影响）
COMPANION     = P2_ARI_108_TARGETED_REQUERY_SEAM_MAP_V1.md
               P2_ARI_108_TARGETED_REQUERY_SPEC_CANDIDATE_V1.md
DECISION_RECORD = docs/architecture/key-decisions.md D12
SPEC_AUTHORITY_NOTE = 本文不发明新语义；与 P1 Approved Spec 冲突时 Spec 胜出
                      → STOP: CONTRACT_CONFLICT
```

---

## 0. 本文件是什么、不是什么

- 冻结 #108 引入的**跨模块可观察合同**，使实现 ticket 能在冻结面上做 contract test；
- **不**创建 P2 通用框架；**不**冻结私有函数名 / 文件布局 / 内部状态机实现；
- **不**改动 P1 SEAM A/B/C/D 的任何版本或字段；
- **不**授权实现（见 `IMPLEMENTATION_AUTHORIZATION = NONE`）。

### 代码事实基线（BASE_SHA 上机械读取，非推测）

```text
· runMultiQueryRetrieval 只执行 validated.plan.queryVariants，
  且 planHash(plan) 必须等于传入的 planHash（否则 RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH）。
· plannedRoutes = seam.listProviders().filter(capability === 'search')
                  .map(p => ({ providerId, capability }))    ← 通道身份列表，非 query×provider 全集
· cumulativeAttemptsCount = executedRoutes + providerFailures（跨轮累计）
· BUDGET_STOP：cumulativeAttemptsCount >= maxQueryBudget  →  stopReason = 'query_budget_exhausted'
· BUDGET_STOP：roundIndex >= maxRetrievalRounds            →  stopReason = 'max_rounds_reached'
· SATURATED 前置：roundIndex >= minRoundsBeforeSaturation
                  && providerFailuresThisRound.length === 0
                  && cumulativeAttemptsCount >= plannedRoutes.length
· assertArtifactSafe(value, { trustedPlanStrings })：
    成员 → isPlanBoundarySafeString（plan lens）
    非成员 → isBoundarySafeString（provider-content lens）
    ★ 两 lens 互不包含，"谁更严"的判断是错的（见 F.3）
    ★ 定向成员须同时过两 lens（交集门），见 F.3
· coverage-state 的 trustedPlanStrings 目前 = new Set(retrieval.plannedQueryVariants)
· 累积去重键 = canonical questionId（/^[1-9]\d*$/）；channel 键 = query::providerId::capability
· ResearchCoverageState schemaVersion = 1，canonicalize 输出固定键集
```

---

## SEAM E — GAP → TARGETED ACTION

```text
SEAM_ID   = GAP_TO_TARGETED_ACTION
VERSION   = 1
PRODUCER  = targeted-requery controller
CONSUMER  = targeted-requery controller（授权面）/ 最终产物（可见性面）
```

### E.1 MVP 允许的 gap 类型（封闭枚举）

```text
ASPECT_GAP        —— 某个已计划 aspect 缺少足够有用证据
CONTRADICTION_GAP —— 某个已计划 opposingFraming 一侧缺少证据
AUTHORITY_GAP     —— 现有 evidence 以评论/二手材料为主，期望更强的原始/权威证据
```

- 该枚举在 V1 内**封闭**。任何其他 gap 类型（`UNDERCOVERED_ASPECT` 之外的变体、
  `SOURCE_GROUP_UNDERCOVERED`、`CLAIM_SOURCE_DIVERSITY_LOW`、`TERMINOLOGY_GAP`、
  `EVIDENCE_DETAIL_GAP`、未知类型）一律记为 `UNKNOWN_GAP_TYPE`：
  **可记录，但不得转成检索动作**（Issue #108 §3 明确要求）。

### E.2 Gap identity

```text
gapId = sha256( 'p2-ari-gap/v1:' + canonicalJson({
          planHash,                 // 64hex，plan-contract 权威
          occurrenceId,             // state.mjs（P1-R02）——gap 不跨 occurrence 复用
          gapType,                  // E.1 枚举成员
          subjectKey,               // controller-mechanical 主语身份，见 E.3
          diagnosisRound            // 产生该诊断的检索轮 index（非负整数）
        }) )
```

- `gapId` 由 **controller** 计算与赋值；模型不得提供 `gapId`。
- 相同 `(planHash, occurrenceId, gapType, subjectKey)` 在**同一 diagnosisRound**内
  必须收敛为同一个 `gapId`（同 gap 不得被重复创建）。

**跨轮稳定身份（D12-8，交叉审查修复 RF-03）**：

```text
gapIdentityCore = sha256( 'p2-ari-gap-core/v1:' + canonicalJson({
                    planHash, occurrenceId, gapType, subjectKey }) )   // 不含 diagnosisRound
gapId           = gapIdentityCore + ':' + diagnosisRound               // 全身份，含轮次
```

- **所有去重与计数键一律用 `gapIdentityCore`**（E.6 dedupeKey、E.5(5) per-gap attempt
  上界）。`diagnosisRound` **只作审计字段**，不得进入任何去重 / 计数键。
- 反例（旧稿缺陷）：若把 `diagnosisRound` 留在键里，同一 gap 在下一轮会拿到新的
  `gapId`，等价查询可被再次授权，per-gap 上界也随之归零 —— C1 只被"同轮内"兜住，
  跨轮重复仅靠全局 `maxQueryBudget` 兜底。

### E.3 subjectKey（controller-mechanical 主语身份）

```text
ASPECT_GAP         → subjectKey = 'aspect:' + plan.aspects[i] 的规范化字符串
CONTRADICTION_GAP  → subjectKey = 'opposing:' + plan.opposingFramings[i] 的规范化字符串
AUTHORITY_GAP      → subjectKey = 'intent:' + plan.sourceGroupIntents[i].intent 的规范化字符串
                     （无对应 plan-owned intent 时：
                        subjectKey = 'intent-freeform:' + sha256(normalizedQueryIntent)，
                        其中 normalizedQueryIntent 由 controller 校验后的 expectedInformation
                        归一化而来；不得直接落为常数 'unknown'，
                        否则所有无 intent 的 AUTHORITY_GAP 会塌缩成同一个 gapId）
```

### E.3.1 诊断依据 = 查询覆盖（provenance-based），不是内容归因（content-attribution）

```text
MVP 的 gap 诊断【不】做内容归因，即：

× 不判断"某条 candidate 内容是否属于某个 aspect"
× 不引入任何文本匹配 / 词典 / embedding 归因器（那会是一条未授权的新生产设施）

MVP 判据是纯 provenance 的查询覆盖：

ASPECT_GAP 成立 ⟺ 存在 plan.aspects[i]，其派生的 plan-owned 查询材料
                   尚未出现在任何【已执行】查询的 provenance 中
CONTRADICTION_GAP 成立 ⟺ 存在 plan.opposingFramings[i]，其派生的 plan-owned
                   查询材料尚未出现在任何【已执行】查询的 provenance 中
AUTHORITY_GAP 成立 ⟺ 由模型 proposal 或 plan.sourceGroupIntents[i].intent 提出，
                   且 controller 校验通过（该类型无法用查询覆盖机械证明，
                   因此它永远是 proposal-driven，不是 coverage-driven）
```

理由：这正好落在 G-A3 指出的既有欠账上（plan 里有 `opposingFramings` / `terminologyVariants`
/ `entities` 等已验证字符串，基线检索只执行 `queryVariants`）。
"先执行已计划的 plan-owned 字符串"是远小于"自由生成探针查询"的机制，且完全可机检。

### E.8 确定性 gap 选择顺序

```text
同轮内多个 gap 竞争预算时，按 gapId 升序（十六进制字符串比较）确定性消费预算。
禁止按模型给出的 materiality / confidence 分数排序
—— 那会让模型输出影响预算分配，等于把预算权威部分让渡给模型（违反 D02）。
Issue #108 §4 的 materiality / confidence 字段在 MVP 内只作为【审计记录】，
不参与排序、不参与授权决策。
```

> 这是 G-A3 的最小机制落点：MVP 优先用**已计划、已验证、尚未被执行**的 plan-owned
> 字符串材料（`aspects` / `opposingFramings` / `sourceGroupIntents[].intent`）作为 gap 主语，
> 而不是让模型自由生成主语。基线检索只执行 `queryVariants`，这些字段是既有欠账，
> 复用它们不新增任何生产设施。

### E.4 Proposal 绑定

```text
TargetedQueryProposal（UNTRUSTED）必填：
  gapId                 必须与 E.2 已存在的 gapId 精确匹配
  queryText?            新字符串（可选）—— **MVP 内不得被授权**，见下方 MVP 约束
  planOwnedStringRef?   { field, index } 或精确字符串（可选）
  requestedProviderScope?  通道子集（可选；默认 = plannedRoutes 全通道）
  intent?               语义说明（可选，仅审计用）

约束：
  · queryText 与 planOwnedStringRef 二者至少存在一个；
  · 二者都存在时，controller 以 planOwnedStringRef 为准（更小机制优先）；
  · 缺失 gapId / gapId 不存在 → 丢弃 proposal（FAIL_CLOSED），不得推断、不得新建 gap。

MVP 约束（交叉审查修复 C2 / RF-04，对应 D12-3）：
  · **MVP 只授权 `planOwnedStringRef` 形式的 proposal**；
    `queryText`（模型自由文本）在 MVP 内一律 REJECTED，rejectionCode =
    `FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP`。
  · 理由：E.5 全部判定都是**结构性**判定，没有任何一条评估查询与 gap 的语义相关性；
    因此"字符串安全但与 gap 无关"的查询能通过全部判定 —— 反例 C2 在旧稿里只被
    **部分**机检兜住。解法不是造语义相关性判定器（与 E.3.1 禁止内容归因冲突，
    且属未授权的新生产设施），而是把授权面收窄到已计划、已验证的 plan-owned 材料
    （G-A3）：`aspects` / `opposingFramings` / `terminologyVariants` / `entities` /
    `sourceGroupIntents[].intent` 已足以覆盖 MVP 的全部 gap 类型。
  · 代价：无法表达 plan 之外的查询意图。该代价在 MVP 内被接受，
    留待 #107 产出评估证据后再议（DEFERRED，见 key-decisions D12 非决策条款）。
```

### E.5 Controller 校验（授权前必须通过的全部判定）

```text
1. gapId 存在且 gapType ∈ E.1 枚举
2. 目标字符串过 **双 lens 交集门**（D12-3）：
     isPlanBoundarySafeString(s) AND isBoundarySafeString(s)
   —— 只过 plan lens 的旧写法已被作废：两 lens 互不包含，且在既有代码里
      "列入信任集"是放宽（rrf.test.mjs:996-1008 F8 为机械证据）。
3. 信任类可判定，且 ∈ { PLAN_OWNED, TARGETED_CONTROLLER_AUTHORIZED }
4. 父 gap 溯源显式（targetedActionId → gapId 必填，不可为空）
5. per-gap attempt 未越界（attempt <= maxAttemptsPerGap，**以 gapIdentityCore 计数**）
6. 归一化查询在 (gapIdentityCore, providerScope) 内不重复（见 E.6）
7. 全局 budget 有剩余（attemptsBudgetCount + 本动作尝试数 <= maxQueryBudget）
8. providerScope ⊆ plannedRoutes（不得引入新 provider / 新 capability）
9. **MVP：proposal 必须以 planOwnedStringRef 形式给出**（E.4 MVP 约束）
```

任一不通过 → `status = REJECTED` + 稳定的 machine-readable `rejectionCode`。
**REJECTED 不是失败运行**：它是受控的、可审计的拒绝；不得重试直到输入改变。

### E.6 等价查询去重（可机检判据，满足 G-A5）

```text
normalizedQuery = 目标字符串
                  → trim
                  → Unicode NFC
                  → 连续空白折叠为单个空格
                  → 大小写折叠（casefold）

dedupeKey = sha256( canonicalJson({ gapIdentityCore, normalizedQuery, providerScope }) )
```

- 同一 `dedupeKey` 在**同一 occurrence 内**（不是"同一轮内"）**只允许授权一次**
  （覆盖 C1：同一 gap 反复触发等价查询，含跨轮重复）。
  键中使用 `gapIdentityCore`（不含 diagnosisRound）是 D12-8 的强制要求。
- 该判据是**字符串等价**判据，不是语义相似度判据：
  本文**不**授权 embedding 相似度去重（那属于 #112 实验范围，且会带来新的生产设施）。

### E.7 未授权 proposal 的行为

```text
· 不产生任何检索 IO；
· 记录为 REJECTED，含 rejectionCode 与 proposal 原样副本（审计用，不经安全门提升信任）；
· 不得静默降级为"用原 plan 再跑一轮"；
· 不得把 REJECTED 计入 gap resolved，也不得计入 saturation；
· 父 gap 保持其既有状态（OPEN / UNRESOLVED），并在产物中保持可见。
```

---

## SEAM F — TARGETED ACTION → RETRIEVAL

```text
SEAM_ID   = TARGETED_ACTION_TO_RETRIEVAL
VERSION   = 1
PRODUCER  = targeted-requery controller
CONSUMER  = 既有 T06 retrieval primitive（复用；不重写）
```

### F.1 Targeted action identity（重放键）

```text
targetedActionId = sha256( 'p2-ari-targeted-action/v1:' + canonicalJson({
                     runId,            // state.mjs runIdentityHash（topic/mode/percent/runtime）
                     occurrenceId,     // state.mjs（P1-R02）
                     planHash,         // 原 plan，永不因 targeted 改变
                     gapId,            // SEAM E
                     attempt,          // 该 gap 内的第几次尝试（从 1 开始）
                     normalizedQuery,  // E.6
                     providerScope     // 规范化后的通道列表（顺序无关，排序后参与哈希）
                   }) )
```

只使用当前仓库合同已证成的字段；不使用时间戳、随机数或未绑定产物。

### F.2 Provider scope

```text
providerScope ⊆ plannedRoutes = [{ providerId, capability: 'search' }]
· 默认 = plannedRoutes 全通道（与计划轮一致，保证 fusion 形状一致）
· capability 只允许 'search'（CAPABILITY_SEARCH）
· 不得新增 provider、不得新增 capability、不得绕过 provider seam
· 不得静默 provider fallback（沿用既有 SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK）

尝试计数粒度（明确，避免预算被悄悄放大）：
  1 个 targeted action × providerScope 长度 = 该 action 的通道级尝试数
  · maxAttemptsPerGap 约束的是【action 数】，不是通道尝试数
  · 通道级尝试数全额计入 attemptsBudgetCount（vs maxQueryBudget）
  · 因此一个 gap 在最坏情况下消耗 = maxAttemptsPerGap × |providerScope| 个预算单位；
    该上限在授权前必须被检查（E.5(7) 用的是"本动作通道尝试数"，不是 1）
```

### F.3 Trust class（封闭枚举）

```text
PLAN_OWNED                     —— 字符串精确取自已验证 plan 的字符串材料
                                  （queryVariants / opposingFramings / entities /
                                    terminologyVariants.term / .variants /
                                    sourceGroupIntents.intent / .constraints）
TARGETED_CONTROLLER_AUTHORIZED —— 新字符串，经 E.5 全部判定后由 controller 授权
                                  **MVP 内不开放**（E.4 MVP 约束）
UNCLASSIFIED                   —— 其余一切（FAIL_CLOSED，不得执行）
```

信任门 = **授权时**的双 lens 交集（**这是 D12-3 的机械落点**）：

```text
admit(s)  ⟺  isPlanBoundarySafeString(s)   // plan 边界，plan-contract.mjs:130
          AND isBoundarySafeString(s)      // provider-content 边界，rrf.mjs:421
```

代码事实（两 lens 互不包含，**不存在谁更严**）：

```text
· rrf.mjs:271  PRIVATE_PATH_SHAPE 拒绝任意 ≥2 段绝对路径 + 盘符根 + ~
  plan-contract.mjs:106 只拒绝 profile 根（/Users /home C:\Users ~）
· plan lens 无 URL 分支；provider lens 对 URL 走 https-only / no-userinfo / 多层编码凭据检查
· 机械证据（仓库自带测试，非推断）rrf.test.mjs:996-1008（F8）：
    '/etc/hosts 文件的作用' 未列入 → unsafe_string；列入 trustedPlanStrings → ok:true
```

- **作废的旧表述**：本文件早期版本称定向成员"走 plan 边界（更严），与既有
  plan-owned 成员同等待遇"。该表述**已作废** —— 在既有代码里列入信任集是**放宽**
  （见上）；只走 plan lens 会把这条既有放宽扩展到新字符串。
- 双 lens 交集使任一字符串的被接受集合 **⊆ 未信任基线**的被接受集合，
  因此不引入任何放宽；这仍不是"general caller-defined trust bypass"
  （沿用 `rrf.mjs` R11 约束）：准入是机械门，不是调用方任意传集合。

**信任集不用于 artifact walk 扩展（与旧稿的实质差异）**：

```text
MVP 不向 assertArtifactSafe 的既有调用点传入任何扩展 trustedPlanStrings。
retrieval.mjs / coverage-final-integration.mjs / source-group-selection.mjs
三处既有调用点逐字不变；trustedPlanStrings 仍 = 既有 plan.queryVariants 集合。
定向字符串若出现在 provider 结果中 → 按 provider-content 判定（= 基线处理，
FAIL_CLOSED；代价已在 key-decisions D12「代价」中声明，可归因、可审计、不静默）。
```

- **禁止**把模型文本、provider 内容或未授权 proposal 的字符串并入任何信任集合。

### F.4 Provenance（到父 gap 的显式溯源）

每个 targeted channel record 必须可机检地回溯到：

```text
targetedActionId → gapId → gapType + subjectKey → planHash
```

且 targeted 结果进入 accumulated pool 时保留既有 provenance 字段
（`channel.query / providerId / capability`、`auth_class`、`source_url.securityClass`）。

### F.5 Retry / replay 身份与规则

```text
COMMIT_POINT =
  记录 targeted action binding 的 checkpoint 写入（writeState）之前，
  该 action 的持久化 round 产物字节已落盘并 fsync，其 hash 已写入 state.hashes。
  → checkpoint-first：checkpoint 是唯一信任根（P1-R06 教训）。

诚实代价声明（不得被实现抹掉）：
  commit point 之前崩溃 → 可能已发生【一次】真实 provider IO，
  但由于没有任何持久完成证据，恢复方无法证明它，因此按合同安全重跑一次
  = 承认可能重复付费一次。这是"无证据不复用"（UNKNOWN != PASS）的必然代价，
  也是 commit point 必须尽可能紧贴 IO 之后的原因。
  【不得】为了消除该代价而引入"未锚定的第二凭证"（sidecar receipt 等）
  —— P1-R06 已判定此类凭证为 P0 级未锚定信任源。

DUPLICATE_REPLAY_RULE =
  resume 时对候选 action 重算 targetedActionId：
    · ledger 中存在该 id 且 status ∈ { COMMITTED, EVALUATED, RESOLVED, UNRESOLVED,
        EXHAUSTED_WITHIN_BUDGET }
      且 validateArtifactCheckpoint(workDir, rel, state.hashes[bindingKey]) 通过
        → 绝不重新执行检索（复用已提交结果）
    · ledger 中存在该 id 且 status ∈ { AUTHORIZED }（未 COMMITTED）
        → 安全重跑一次（无已提交证据，未付费证据不存在）
    · hash 不匹配 / 产物缺失
        → 视为未提交，安全重跑一次；旧记录按 append-only 保留审计痕迹
```

### F.6 Attempt accounting（SEAM F → SEAM H 的计数契约）

```text
targetedExecutedCount   = status ∈ { COMMITTED, ... } 的 action 数（按 providerScope 展开的通道尝试计）
targetedFailedCount     = operational failure 的 targeted 通道尝试数

attemptsBudgetCount     = 计划 executedRoutes + 计划 providerFailures
                          + targetedExecutedCount + targetedFailedCount
                          → 用于 vs maxQueryBudget（BUDGET_STOP）

plannedCoverageCount    = 计划 executedRoutes + 计划 providerFailures
                          → 用于 vs plannedRoutes.length（SATURATED 前置）
                          → targeted 尝试【不】进入该计数（P1 语义零改动）
```

#### F.6.1 与既有 P1 记账实现的接入方式（additive，默认不改变行为）

代码事实：`retrieval-round-controller.mjs` 的 `cumulativeAttemptsCount` **只**由
`coverageState.retrieval.executedRoutes` 与 `providerFailures` 两个数组算出，
无法看到独立 ledger 里的 targeted 尝试。因此本 seam 要求且仅要求一处 **additive** 接入：

```text
evaluateRetrievalRound 增加一个可选显式输入：
    targetedAttempts = { executed: <非负整数>, failed: <非负整数> }   默认 { executed: 0, failed: 0 }

则：
    attemptsBudgetCount  = executedRoutes.length + providerFailures.length
                           + targetedAttempts.executed + targetedAttempts.failed
    plannedCoverageCount = executedRoutes.length + providerFailures.length
                           （逐字等于旧的 cumulativeAttemptsCount）

· 缺省 / 未启用 #108 时，两个计数与旧行为【逐字相同】→ P1 语义零回归；
· 该输入由 controller 从 targeted ledger 确定性导出，不由 caller 任意提供；
· 不得反向把 targeted 尝试写进 executedRoutes 来"顺手"让它被看见
  （那会污染 plannedCoverageCount 与 saturation 前置，并跨越既有 hook 所有权边界）。
```

### F.7 Execution path（交叉审查修复 F-01；D12-7 的机械落点）

旧稿只写了"复用既有 T06 retrieval primitive（复用，不重写）+ 新增检索入口 = NO"，
但**没有点名执行路径**，而 targeted 查询按定义不在 `plan.queryVariants` 里 ——
`runMultiQueryRetrieval` 无法执行它（retrieval.mjs:547）。施工方只有三条路，
其中两条与既有冻结条款冲突。本节冻结唯一解法：

```text
唯一入口 = runMultiQueryRetrieval（retrieval.mjs:494），以 additive 可选参数调用：

  runMultiQueryRetrieval({
    plan, planHash, seam, channels, workDir,
    targetedQueries = null          // ← 新增，缺省 null
  })

· targetedQueries === null（缺省）
    → 逐字执行今天的  for (const query of validated.plan.queryVariants)（:547）
· targetedQueries = [q1, q2, ...]
    → 只以这些查询 × providerScope 通道执行一次
    → plan / planHash 绑定仍为【原 plan】（plan artifact 不可变，planHash 不变）
    → 返回形状仍为 { ok: true, pool, poolHash, file }（JSDoc :492 / return :798）
```

```text
MUST     = 只走这一个入口；结果经既有 rrfFusion → pool → assertArtifactSafe 路径
MUST_NOT = ① 在 runMultiQueryRetrieval 之外另行组合
             seam.retrieve + rrfFusion + pool merge + assertArtifactSafe
             （= 第二管线，与「无第二检索子系统」直接冲突，且两份实现必然漂移）
           ② 新建第二个检索入口
           ③ 改写 plan artifact 或 planHash 绑定
```

**OUTPUT_CONTRACT 更正**：旧稿写的
`{ channels[], ok, itemCount, retrievedAt, completeness, auth_class }` 是 **channel
record** 的形状，**不是** `runMultiQueryRetrieval` 的返回形状。真实返回 =
`{ ok: true, pool, poolHash, file }`（`retrieval.mjs:492` JSDoc、`:798` return）。
旧稿此处属实为错，已更正；seam map S5 同步更正。

**由此确定的 P1 接触面（两处，均为 additive 且缺省保行为不变）**：

```text
(1) retrieval-round-controller.mjs：targetedAttempts = { executed, failed }，缺省 0/0
(2) retrieval.mjs：runMultiQueryRetrieval 的 targetedQueries，缺省 null
artifact-walk 调用点 = 零改动；trustedPlanStrings = 零改动（见 F.3）
```

---

## SEAM G — RETRIEVAL RESULT → GAP RE-EVALUATION

```text
SEAM_ID   = RETRIEVAL_RESULT_TO_GAP_REEVALUATION
VERSION   = 1
PRODUCER  = targeted-requery controller
CONSUMER  = gap ledger / 最终产物
```

### G.1 Evidence linkage（什么算"新证据"）

```text
newEvidenceIds = { canonical questionId }
                 ∩ （targeted round fused candidates）
                 \ （该 targeted action 执行前 accumulated pool 已存在的 questionId）
```

- 判据是 **canonical questionId  novelty**（既有去重键），不是返回条数、不是文本相似度；
- `newEvidenceIds.length === 0` 时，gap **不**因本次 action 变为 RESOLVED。

### G.2 Duplicate handling

```text
· 与既有 pool 重复的 questionId → 不是新证据（覆盖 C6）
· 同一 action 内部重复 → 折叠为一次
· "返回了很多结果但全是重复来源" → 明确记为 UNRESOLVED，resolutionBasis = DUPLICATE_ONLY
```

### G.3 不算 resolution 的情形（封闭清单）

```text
× 查询被执行了
× provider 返回了非零条数
× 返回的都是重复来源
× CONTRADICTION_GAP 再次只取到同一侧（覆盖 C7）
× AUTHORITY_GAP 只找到高热度评论/二手讨论（覆盖 C8；热度 ≠ authority）
× 模型的自然语言断言"已找到权威来源"
× operational failure（provider 失败 / 超时）被解释为"没有更多证据"
```

### G.4 Resolution predicates（MVP）

```text
ASPECT_GAP
  resolutionPredicateRef = ASPECT_MIN_NEW_SOURCES_V1
  RESOLVED ⟺ newEvidenceIds.length >= 1 且新证据可归因到该 aspect 的 subjectKey

CONTRADICTION_GAP
  resolutionPredicateRef = OPPOSING_SIDE_NEW_SOURCES_V1
  "另一侧"由【授权时的 action provenance 声明】，不由内容推断：
      · TargetedQueryAction 在授权时即绑定 subjectKey = 'opposing:<framing>'，
        其 query 取自该 plan-owned framing 字符串；
      · 因此"这一侧 vs 另一侧"是授权期已固定的声明事实，
        不是检索后由内容重新推断的结论。
  RESOLVED ⟺ newEvidenceIds.length >= 1
            且该 action 声明的 framing 与既有已覆盖侧【不同】
            （既有覆盖侧同样来自已执行查询的 provenance，不是内容归因）
  【明确禁止】为判定"另一侧"引入 stance / sentiment / 立场分类器或文本归因器：
     · 仓库内不存在此类已验证设施；
     · 引入它即等于新建一条未授权的语义生产设施；
     · 无法机械判定侧别时一律 UNKNOWN → UNRESOLVED，不得猜测。

AUTHORITY_GAP
  resolutionPredicateRef = NONE_REGISTERED（#111 未实现）
  默认终态 = UNRESOLVED，resolutionBasis = UNKNOWN_NO_AUTHORITY_PREDICATE
  · 不得用 authorRef、热度、点赞、认证外观代理权威性（G-A4）
  · authorRef 只承载身份同一性，不等于 expertise / authority / correctness
  · 未来 #111 注册 AUTHORITY_PREDICATE_V1 后，本 seam 的其余字段与流程【不变】
```

### G.5 Unresolved / exhausted 语义

```text
UNRESOLVED               —— 已尝试但有界终止，且未满足 resolution predicate
EXHAUSTED_WITHIN_BUDGET  —— 因 per-gap attempt bound 或全局 budget 无法继续尝试
                            而仍未满足 predicate；必须显式记录，不得写成 SATURATED
UNKNOWN_AUTHORITY        —— AUTHORITY_GAP 在无已注册 predicate 时的诚实终态
                            （是 UNRESOLVED 的 resolutionBasis 标记，不是独立成功态）
```

> `EXHAUSTED_WITHIN_BUDGET` **不是** "已饱和"的同义词。
> 两者不同：前者是"我们没找到且没钱再找"，后者是"在当前检索策略下边际增益已衰减"。
> 混淆二者会把预算事实伪装成覆盖事实。

#### G.5.1 run 层 STOP 到来时，UNRESOLVED 与 EXHAUSTED_WITHIN_BUDGET 的判定规则

```text
该 gap 已获得 ≥1 次 AUTHORIZED，且终止原因是以下之一
    → per-gap attempt bound 用尽
    → 授权阶段因 attemptsBudgetCount 已触达 maxQueryBudget 被拒
    → run 层 BUDGET_STOP（query_budget_exhausted / max_rounds_reached）
  ⇒ EXHAUSTED_WITHIN_BUDGET

该 gap 从未获得 AUTHORIZED（REJECTED 或从未被选中），或终止于
    → run 层 SATURATED
    → run 层 PROVIDER_FAILURE
    → targeted action 的 FAILED_OPERATIONAL
  ⇒ UNRESOLVED（并在 resolutionBasis 记录真实原因：
       never_authorized / run_saturated / operational_failure）

禁止：把 SATURATED 或 PROVIDER_FAILURE 导致的未解决写成 EXHAUSTED_WITHIN_BUDGET
      —— 那会把"策略边际衰减"或"故障"伪装成"预算事实"。
```

---

## SEAM H — STOP INTERACTION

```text
SEAM_ID   = STOP_INTERACTION
VERSION   = 1
PRODUCER  = 既有 T07 round controller + targeted-requery controller
CONSUMER  = 检索阶段编排 / 最终产物
STOP_OWNER = controller（唯一）；模型永不拥有 STOP
```

### H.1 冻结规则

```text
H-1  plannedRoutes 永不被 targeted action 改写。
H-2  SATURATED 前置分母 = plannedCoverageCount vs plannedRoutes.length（P1 逐字不变，
     不含 targeted 尝试）。
H-3  BUDGET_STOP 分母 = attemptsBudgetCount vs maxQueryBudget（G-A2 收窄表述；
     targeted 尝试计入）。
H-4  targeted action 不自增 retrievalRounds；它不是 P1 round。
H-5  targeted action 既不能制造 SATURATED，也不能阻止 SATURATED。
H-6  operational failure ≠ gap resolved ≠ saturation ≠ "成功但无结果的证据"。
H-7  模型不得产出 CONTINUE / STOP / SATURATED / RESOLVED 中的任何一个。
H-8  run 层 STOP（SATURATED / BUDGET_STOP / PROVIDER_FAILURE）发生时，
     所有非终态 gap 必须被显式写为 UNRESOLVED 或 EXHAUSTED_WITHIN_BUDGET，
     并保持可见；不得静默丢弃。
```

### H.2 C11 情形（targeted action 存在于 P1 saturation 评估期间）

```text
· P1 round controller 的评估输入不变（它看不到 targeted 尝试对 saturation 前置的贡献）；
· targeted 尝试只影响 attemptsBudgetCount（即 BUDGET_STOP 更可能先发生）；
· 若 T07 返回 SATURATED：run 停止；未终态 gap → EXHAUSTED_WITHIN_BUDGET（如因预算）
  或 UNRESOLVED（如因未满足 predicate），不得借用 SATURATED 措辞；
· 若 T07 返回 BUDGET_STOP：同上，且必须记录"预算耗尽"而非"证据已覆盖"；
· 若 T07 返回 PROVIDER_FAILURE：运行 fail closed；gap 不得被标记为任何成功态。
```

### H.3 与既有 STOP 语义的一致性声明

```text
SATURATION_SEMANTICS_DISCLAIMER（retrieval-round-controller.mjs）继续完整有效：
SATURATED 只表示"当前检索策略下边际信息增益已衰减"，
不表示"所有相关信息已找到" / "全局搜索完备" / "不存在未发现来源"。
#108 不扩展、不削弱该声明。
```

---

## 5. 反例契约索引（实现期必须可机械复现）

| ID | 反例 | 合同落点 |
|---|---|---|
| C1 | 同一 gap 反复触发等价查询（**含跨轮**） | E.6 dedupeKey（键 = gapIdentityCore）+ E.5(6) |
| C2 | 模型提出似是而非的无关查询 | E.4 MVP 约束（只授权 planOwnedStringRef）+ E.5(9) + E.7 REJECTED |
| C3 | targeted 字符串含 provider-like 不可信内容 | F.3 双 lens 交集门 + UNCLASSIFIED FAIL_CLOSED |
| C4 | **commit point 之后**、后续分析前崩溃 | F.5 COMMIT_POINT + DUPLICATE_REPLAY_RULE |
| C5 | commit point 之前崩溃 | F.5 安全重跑一次 |
| C6 | 查询只返回重复来源 | G.1 + G.2 |
| C7 | CONTRADICTION_GAP 再次取到同一侧 | G.3 + G.4 |
| C8 | AUTHORITY_GAP 只找到热门评论 | G.3 + G.4（NONE_REGISTERED） |
| C9 | 全局 query budget 耗尽 | H.1/H-8 + G.5 EXHAUSTED_WITHIN_BUDGET |
| C10 | provider 失败 | H-6 + G.3 |
| C11 | saturation 评估期间存在 targeted action | H.2 |
| C12 | resume 看到陈旧/重放的 action | F.1 identity + F.5 |

---

## 6. SEAM_NOT_FROZEN procedure

任何一方发现合同要求一个**无 approved authority 依据**的字段/语义：

```text
SEAM_NOT_FROZEN = <SEAM_ID>
BLOCKING_DECISION_REQUIRED = <exact missing decision + authority pointer>
```

并 `STOP`，不得以 fixture 先行倒逼产品语义。
