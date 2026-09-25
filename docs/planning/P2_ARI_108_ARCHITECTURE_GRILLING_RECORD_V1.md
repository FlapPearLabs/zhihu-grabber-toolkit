# P2-ARI #108 — Architecture / Spec Candidate Grilling Record V1

> **命名守卫**：本文 `P2-ARI` = `P2 / ADAPTIVE_RESEARCH_INTELLIGENCE`（#107–#112），
> 与 `LEGACY P2 = AUTHOR / PERSONAL INTELLIGENCE` 无关。

```text
DOCUMENT_ID   = P2_ARI_108_ARCHITECTURE_GRILLING_RECORD_V1
STATUS        = CANDIDATE（随候选分支一并送审）
TARGET        = #108 architecture + seam map + seam contract + spec candidate
MODE          = FINDING_SCOPED ADVERSARIAL REVIEW（不是第二次架构设计；只攻击并修复）
METHODOLOGY   = 仓库既有 grilling 方法（针对所有权 / 身份 / 持久化 / 重放 / 信任边界 /
                预算语义 / STOP 语义 / 生产 caller / 重复执行 / 第二管线 / 不必要抽象 逐项攻击）
IMPLEMENTATION_AUTHORIZATION = NONE
BASE_SHA      = 7915e84a20b62086c53d045549329111098ca11e
BRANCH        = spec/p2-ari-f02-targeted-requery
```

---

## 1. 攻击面与结论

| 攻击面 | 结果 |
|---|---|
| 所有权模糊（ownership ambiguity） | 1 处发现 → 已修复（F-02） |
| 身份模糊（identity ambiguity） | 1 处发现 → 已修复（F-01） |
| 持久化模糊（persistence ambiguity） | 1 处发现 → 已修复（F-03） |
| 重试 / 重放（retry / replay） | 1 处发现 → 已修复（F-04） |
| 信任边界（trust boundary） | 攻击未破（见 §3 A-1） |
| 预算语义（budget semantics） | 2 处发现 → 已修复（F-05 / F-06） |
| STOP 语义 | 1 处发现 → 已修复（F-07） |
| 生产 caller | 攻击未破（见 §3 A-2） |
| 重复执行 | 攻击未破（见 §3 A-3） |
| 第二管线风险 | 攻击未破（见 §3 A-4） |
| 不必要抽象 | 攻击未破（见 §3 A-5） |

---

## 2. 有效发现与修复

### F-01

```text
FINDING_ID = F-01
CLAIM      = "AUTHORITY_GAP 在没有对应 plan-owned intent 时 subjectKey = 'unknown'"
REPO_EVIDENCE =
  SEAM E §E.2 的 gapId = sha256(planHash + occurrenceId + gapType + subjectKey + diagnosisRound)。
  常数 subjectKey 会使所有无 intent 的 AUTHORITY_GAP 在同一轮内塌缩成同一个 gapId，
  令 E.5 的"gapId 必须存在"校验形同虚设，也让 §G.5 的"未解决 gap 可见"失去粒度。
WHY_CURRENT_SPEC_IS_INSUFFICIENT =
  塌缩后多条语义不同的 AUTHORITY_GAP 共享一个身份，per-gap attempt bound 会被它们
  共同消耗，等价于把一个 per-gap 界变成了一个 per-type 界 —— 预算语义被悄悄改变。
SEVERITY   = P1
REQUIRED_CORRECTION =
  subjectKey 必须以 controller 校验后的 expectedInformation 归一化哈希参与身份，
  不得落为常数。
DISPOSITION = REPAIRED（SEAM E §E.3 已改为 'intent-freeform:' + sha256(normalizedQueryIntent)）
```

### F-02

```text
FINDING_ID = F-02
CLAIM      = "ASPECT_GAP = 某个 aspect 缺少足够有用证据"
REPO_EVIDENCE =
  仓库内不存在任何把 candidate 内容归因到 aspect 的已验证设施。
  要判定"证据属于哪个 aspect"，必须新建文本/词典/embedding 归因器 ——
  那是一条未授权的语义生产设施，且与 #112 的"E0/E1/E1-D only、不引入生产检索设施"冲突。
WHY_CURRENT_SPEC_IS_INSUFFICIENT =
  原表述让实现者只能自己发明归因器，等于把未经授权的语义生产设施塞进 MVP；
  同时"足够"没有机检阈值，会让每个 aspect 都成为 gap，预算瞬间耗尽。
SEVERITY   = P0
REQUIRED_CORRECTION =
  诊断改为 provenance-based 查询覆盖：某个 plan-owned 字符串材料尚未出现在任何
  已执行查询的 provenance 中，即构成 gap；明确禁止内容归因。
DISPOSITION = REPAIRED（新增 SEAM E §E.3.1；Spec §6 同步）
```

### F-03

```text
FINDING_ID = F-03
CLAIM      = "CONTRADICTION_GAP 的'另一侧'由 controller 与候选内容的确定性匹配得出"
REPO_EVIDENCE =
  仓库无 stance / 立场分类器。该表述与 F-02 同类，且更危险：
  它会让"另一侧"变成一个由实现者自选匹配器得出的伪确定性结论，
  而 CONTRADICTION_GAP 的反例 C7 恰好就是"又取到同一侧必须保持 UNRESOLVED"。
WHY_CURRENT_SPEC_IS_INSUFFICIENT =
  用一个不存在的分类器去满足一条 MUST_NOT 反例，等于把反例变成口号。
SEVERITY   = P0
REQUIRED_CORRECTION =
  "另一侧"改为【授权期声明】：action 的 subjectKey 与 query 在授权时即绑定某一 plan-owned
  framing，侧别是声明事实不是推断结论；禁止引入 stance/立场/情感分类器；
  无法机械判定侧别时一律 UNKNOWN → UNRESOLVED。
DISPOSITION = REPAIRED（SEAM G §G.4）
```

### F-04

```text
FINDING_ID = F-04
CLAIM      = "commit point 之前崩溃 → 安全重试一次"
REPO_EVIDENCE =
  P1-R06（#94）已判定：sidecar receipt 一类"未锚定的第二凭证"是 P0 级未锚定信任源，
  整体撤销。checkpoint 是唯一信任根。
WHY_CURRENT_SPEC_IS_INSUFFICIENT =
  原文只说"安全重试"，未声明这条路径【可能重复付费一次】。
  沉默会让后续实现者误以为存在 exactly-once 保证，从而去发明第二凭证来"修复"它，
  正好撞上 P1-R06 已经撤销的做法。
SEVERITY   = P1
REQUIRED_CORRECTION =
  显式声明 pre-commit 崩溃可能重复付费一次，是 UNKNOWN != PASS 的必然代价；
  并显式禁止为消除该代价引入未锚定第二凭证。
DISPOSITION = REPAIRED（SEAM F §F.5；Spec §12 同步）
```

### F-05

```text
FINDING_ID = F-05
CLAIM      = "targeted 尝试计入 attemptsBudgetCount（vs maxQueryBudget）"
REPO_EVIDENCE =
  retrieval-round-controller.mjs 的 cumulativeAttemptsCount 只由
  coverageState.retrieval.executedRoutes 与 providerFailures 两个数组算出。
  若 targeted 尝试留在独立 ledger 且不进 coverageState，round controller 根本看不到它们，
  于是 BUDGET_STOP 也看不到 —— 该条款在机械上不可实现。
WHY_CURRENT_SPEC_IS_INSUFFICIENT =
  合同要求一个现有实现无法观测的量，实现者只有两条路可走：
  (a) 把 targeted 写进 executedRoutes（污染 SATURATED 前置 + 越权写 P1 账本）；
  (b) 静默忽略（预算条款失效）。两条都违反本 Spec。
SEVERITY   = P0
REQUIRED_CORRECTION =
  指定唯一 additive 接入方式：evaluateRetrievalRound 增加可选显式输入
  targetedAttempts = { executed, failed }（默认 0/0）；
  并显式禁止把 targeted 写进 executedRoutes。
DISPOSITION = REPAIRED（新增 SEAM F §F.6.1；Spec §D4 同步）
```

### F-06

```text
FINDING_ID = F-06
CLAIM      = "maxAttemptsPerGap 约束每个 gap 的尝试次数"
REPO_EVIDENCE =
  一个 targeted action 默认 providerScope = plannedRoutes 全通道，
  即一次 action = |providerScope| 次真实 provider 调用。
  "attempt" 若被读作 action，则单 gap 实际消耗 = maxAttemptsPerGap × 通道数，
  预算条款与记账条款使用了不同粒度。
WHY_CURRENT_SPEC_IS_INSUFFICIENT =
  粒度不一致会让 E.5(7) 的授权前预算检查少算通道数，从而突破 maxQueryBudget。
SEVERITY   = P1
REQUIRED_CORRECTION =
  明确：maxAttemptsPerGap 约束 action 数；通道级尝试数全额计入 budget；
  授权前检查必须按"本动作通道尝试数"计算。
DISPOSITION = REPAIRED（SEAM F §F.2；Spec §D4 同步）
```

### F-07

```text
FINDING_ID = F-07
CLAIM      = "run 层 STOP 到来时，非终态 gap 写为 UNRESOLVED 或 EXHAUSTED_WITHIN_BUDGET"
REPO_EVIDENCE =
  两个终态语义不同（一个是"没找到"，一个是"没钱再找"），
  而 SATURATED 与 PROVIDER_FAILURE 都不是预算事实。
WHY_CURRENT_SPEC_IS_INSUFFICIENT =
  原表述给了实现者自由选择权；一旦把 SATURATED 导致的未解决写成
  EXHAUSTED_WITHIN_BUDGET，就把"策略边际衰减"伪装成了"预算耗尽"，
  正是本 Spec §13 与 G-A2 要禁止的那类洗白。
SEVERITY   = P1
REQUIRED_CORRECTION =
  给出确定判定规则：仅当终止原因确为 per-gap bound 或预算触达时为 EXHAUSTED；
  SATURATED / PROVIDER_FAILURE / FAILED_OPERATIONAL / 从未授权 一律 UNRESOLVED
  并记录真实 resolutionBasis。
DISPOSITION = REPAIRED（新增 SEAM G §G.5.1）
```

---

## 3. 攻击未破（记录以免后续重复质疑）

### A-1 — 信任边界："把 targeted 字符串加入 trustedPlanStrings 就是开了后门"

~~不成立。~~ **本条 A-1 的原始论证已被独立交叉审查推翻，见 §6.1。**

修订后结论（以 §6.1 为准）：合同要求该集合**只能**由 controller 已授权 action ledger 派生这一条成立；
但"走 plan 边界就等于更严"**不成立** —— 两 lens 互不包含，且 `rrf.test.mjs:996-1008`
机械证明"列入信任集"在既有代码里是**放宽**（同一字符串未列入 = `unsafe_string`，列入 = `ok:true`）。
因此信任门改为**双 lens 交集** `isPlanBoundarySafeString(s) AND isBoundarySafeString(s)`。
`rrf.mjs` R11 的"`trustedPlanStrings` 不是 general caller-defined trust bypass"约束被逐字保留，
且新增约束：信任集**不用于** artifact-walk 扩展。

### A-2 — 生产 caller 缺失

不成立。每个 seam 的 `PRODUCTION_CALLER` 均指向既有真实模块
（`runMultiQueryRetrieval` / RRF / provider seam / `coverage-state` hooks /
`p1-runtime-composer` / `state.mjs` checkpoint），未指向任何虚构组件。

### A-3 — 重复执行

不成立。`targetedActionId` 只由当前仓库已证成的字段构成（runId / occurrenceId /
planHash / gapId / attempt / normalizedQuery / providerScope），
且 `DUPLICATE_REPLAY_RULE` 以 `validateArtifactCheckpoint` 的 binding hash 校验为判据，
C4 / C5 / C12 三条反例各有独立落点。

### A-4 — 第二管线

不成立。SEAM MAP §3 逐项列出：无新 provider、无新检索入口、无新打分/排序、
无新 identity 规则、无索引/向量库、无 coverage 字段增改。
targeted 结果进入**同一个** accumulated pool，走**同一套** RRF 与 canonical questionId 去重。

### A-5 — 不必要抽象

不成立。相对 Issue #108 原文，本候选**主动删掉**了：
通用 gap 框架、多策略调度器、materiality/confidence 参与决策、cost/provider/round 三种预算维度、
`executing` 持久化状态。保留的每一个新概念（gapId、targetedActionId、dedupeKey、
attemptsBudgetCount/plannedCoverageCount 双计数）都能追溯到一条具体反例或一条代码事实。

---

## 4. 反过度工程闸门（逐项判定）

```text
泛化 adaptive planner           —— 需求方 = 无 MVP 不变量 → 拒绝（#110 仍 DESIGN_ONLY）
通用 workflow engine             —— 无 → 拒绝
独立搜索系统                     —— 无 → 拒绝
新向量库                         —— 无 → 拒绝
BM25 / FTS                       —— 无 → 拒绝（且 #112 明确不授权生产设施）
新 provider 基础设施              —— 无 → 拒绝
学到的查询策略 / RL               —— 无 → 拒绝
通用策略调度器                    —— 无 → 拒绝（gap 顺序 = gapId 升序，确定性）
universal evidence score          —— 无 → 拒绝（#111 未实现，UNKNOWN 保持 UNKNOWN）
全局货币成本平台                  —— 无 → 拒绝（SMALLER_MECHANISM_TEST 通过）
通用 event-sourcing 框架           —— 无 → 拒绝（复用既有 checkpoint + ledger）
新 ADR 制度                      —— 无 → 拒绝（用 key-decisions.md D12）
```

`VALUE × EVIDENCE × SYSTEM_FIT ÷ ADDED_COMPLEXITY`：
本候选真正新增的机械部件只有 4 个（gapId / targetedActionId / dedupeKey / 双计数），
每一个都直接对应一条反例或一条现有代码无法绕过的约束；
其余全部是对既有 primitive 的复用 —— 符合"20% 机制换 80% 价值"。

---

## 5. 闸门结论

```text
GRILLING = FINDINGS_FOUND_AND_REPAIRED
FINDINGS_TOTAL = 7（P0 ×3，P1 ×4）
UNREPAIRED = 0
NEW_PRODUCT_SCOPE_INTRODUCED = NO
P1_AUTHORITY_CHANGE_REQUIRED = 否（唯一 P1 接触面是 additive 默认 0 的显式输入）
USER_DECISION_REQUIRED = NONE
CONTRACT_CONFLICT = NONE
NEXT_LEGAL_ACTION = FRESH INDEPENDENT REVIEW（exact candidate SHA）
```

---

## 6. 独立交叉审查（ROUND 1）→ finding-scoped 修复

```text
REVIEWED_HEAD   = e18a3f16285ad3ba930d65f65c06d9c94d77bd6f
CHANNELS        = ① CLAUDE_OPUS_4_6_EFFORT_MAX  ② WORKBUDDY_DEEPSEEK_V4_1_FLASH
                  （原定新鲜 Codex 通道因账户级配额耗尽不可用，经用户授权改道；
                   两条通道均 READ_ONLY / EXACT_SHA / 未参与本候选起草）
VERDICTS        = ① CHANGES_REQUESTED / BLOCKERS = NONE
                  ② CHANGES_REQUESTED / BLOCKERS = NONE
```

### 6.1 两 reviewer 冲突的唯一裁定：字符串信任门（lens 强弱）

两位 reviewer 对同一处给出**方向相反**的判断：

```text
CLAUDE   F-03（P2）：措辞不准 —— 旧稿称"列入 trustedPlanStrings 后更严"
DEEPSEEK RF-01（P1）：判断倒置 —— plan lens 实际【更弱】，列入信任集是【放宽】
```

作者回代码自证（CODE IS AUTHORITY）：

```text
rrf.mjs:271           PRIVATE_PATH_SHAPE      拒绝任意 ≥2 段绝对路径 / 盘符根 / ~
plan-contract.mjs:106 PRIVATE_PATH_SHAPE      只拒绝 profile 根（/Users /home C:\Users ~）
plan-contract.mjs:130 isPlanBoundarySafeString 无 URL 分支
rrf.mjs:444           isBoundarySafeUrlString  https-only / no-userinfo / 多层编码凭据检查
rrf.test.mjs:996-1008 F8 机械证据：
                      '/etc/hosts 文件的作用'
                        → 未列入 trustedPlanStrings  = unsafe_string（拒绝）
                        → 列入 trustedPlanStrings    = ok:true      （放行）
```

→ **裁定：DeepSeek RF-01 成立，Claude F-03 偏轻。**
旧稿"更严、不是放宽"的表述**整条作废**。修复后的信任门 = **双 lens 交集**
（`isPlanBoundarySafeString(s) AND isBoundarySafeString(s)`），任一 lens 判不安全即 REJECTED。
补充约束：信任集**不用于** artifact-walk 扩展，三处调用点零改动。

### 6.2 修复清单（6 条，全部 finding-scoped）

| # | 来源 | 修复 |
|---|---|---|
| 1 | F-03 / RF-01 | 信任门改双 lens 交集 + 作废声明（key-decisions D12-3、SEAM F.3、SPEC §D3） |
| 2 | F-01 / RF-02 | 新增 **D12-7 / SEAM F.7**：点名唯一入口 `runMultiQueryRetrieval`（retrieval.mjs:494）+ additive 可选参数 `targetedQueries`（缺省 null）；禁止另起 `seam.retrieve + rrfFusion` 组合；OUTPUT_CONTRACT 更正为真实形状 `{ok,pool,poolHash,file}`（:492/:798） |
| 3 | F-01 / RF-02 | P1 接触面由"一处"更正为**两处 additive**：round controller `targetedAttempts`、retrieval.mjs `targetedQueries` |
| 4 | F-02 / RF-04 | MVP 授权面收窄为 **`planOwnedStringRef` only**；`queryText` 一律 REJECTED（`FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP`） |
| 5 | RF-03 | 新增 **D12-8**：去重/attempt 作用域 = OCCURRENCE，键 = `gapIdentityCore`（不含 `diagnosisRound`）；`diagnosisRound` 仅审计 |
| 6 | RF-05 | C4 措辞由"付费检索后崩溃"改为"**commit point 之后**崩溃"（不再夸大覆盖范围） |

### 6.3 闸门结论（修复后）

```text
ROUND_1_REPAIR = FINDINGS_FOUND_AND_REPAIRED
FINDINGS_TOTAL = 6（P0 ×0，P1 ×5，P2 ×1；其中 1 条为 reviewer 冲突裁定）
UNREPAIRED = 0
NEW_PRODUCT_SCOPE_INTRODUCED = NO（反而收窄：自由文本 queryText 被移除出 MVP）
P1_AUTHORITY_CHANGE_REQUIRED = 否（接触面仍为两处 additive、缺省保行为不变）
USER_DECISION_REQUIRED = NONE
CONTRACT_CONFLICT = NONE
NEXT_LEGAL_ACTION = FINDING_SCOPED RE-REVIEW（新 exact SHA）→ PASS → STOP
```
