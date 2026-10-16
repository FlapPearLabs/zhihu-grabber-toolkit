# P2-ARI_READINESS_CODEX_FINAL_REVIEW

> **命名守卫（强制）**：本文中的 `P2-ARI` = `P2 / ADAPTIVE_RESEARCH_INTELLIGENCE`，指 #107–#112 这批
> adaptive-research-intelligence backlog。它**不是** 2026-08-25 Product Direction 中的
> `LEGACY P2 = AUTHOR / PERSONAL INTELLIGENCE`（用户历史内容研究 / 收藏研究 / 他人公开历史研究 /
> 作者主题·观点·写作·知识结构研究）。本文不修改、不重解释、不覆盖 LEGACY P2。
> 当前阶段描述一律写作 `P2-ARI` 或 `P2 / ADAPTIVE_RESEARCH_INTELLIGENCE`；历史引用需原样保留并显式标注
> `LEGACY P2`。禁止让裸写的 `P2` 造成历史语义漂移。
>
> **本命名守卫适用于整个 P2-ARI readiness audit packet（本文 §8 所列五个文件）**：这些文件中历史形成的裸写
> `P2` 一律读作 `P2-ARI`，不涉及 `LEGACY P2`。消歧通过本声明完成，**不**对既有文件做全局替换或改写。

> **产物溯源**：本文是 #107–#112 的 P2-ARI 架构就绪审计的**最终独立验收记录**，审计基线
> `9c60ae56610498f1cf782c0c36bfc9f8c0642051`。本文只持久化 fresh independent Codex 在同一 exact SHA 上
> 作出的最终裁定，**不是新审计、不是自审、不是第二次 readiness audit**：不重新分析 #108 的六个架构决策、
> 不重新设计 #109 / #111 / #112，也不重新 grill #107–#112。
> Codex 审查过程对仓库为只读（未写产品代码、未建 Spec / ADR 文件 / Ticket / PR、未修改 #107–#112）。
> 本机绝对路径已按 `RULES.md` §11 脱敏。

---

## 0. FINAL VERDICT

```text
REVIEWER_ROUTE =
EXTERNAL_CODEX_FRESH_REVIEW（fresh independent；非 HY4 自审，非 internal fallback）

REVIEWED_SHA =
9c60ae56610498f1cf782c0c36bfc9f8c0642051

REMOTE_MASTER_AT_REVIEW =
9c60ae56610498f1cf782c0c36bfc9f8c0642051

REMOTE_MASTER_CHANGED =
NO（审查期间 remote master 未移动）

AUDIT_TARGET_SHA_MATCH =
YES

FINAL_VERDICT =
PASS_WITH_NONBLOCKING_FINDINGS

P2_ARI_ARCHITECTURE_READINESS_GATE =
CLOSED
```

```text
ARCHITECTURE_DECISION_RECORD_MECHANISM =
SUFFICIENT_EXISTING_MECHANISM

GRILLING_COVERAGE =
SUFFICIENT

UNDER_DESIGN_FINDING =
NONE

OVER_DESIGN_FINDING =
NONE
```

---

## 1. AUTHORITY CHRONOLOGY（真实时序，不得改写）

```text
HY4 PRIMARY AUDIT
  ↓   （自著；按 RULES.md §8「SELF_REVIEW != INDEPENDENT_REVIEW」不构成 PASS）
HY4 FINDING-SCOPED GRILLING SUPPLEMENT
  ↓   （G-A1…G-A5；#109 依赖语义校正；ARCHITECTURE_DECISION_RECORD 术语归一）
INTERNAL FALLBACK REVIEW
  ↓   （职责隔离的内部 reviewer；PASS_WITH_NONBLOCKING_FINDINGS；不等同 Codex gate）
FRESH INDEPENDENT CODEX FINAL REVIEW
      （本文；PASS_WITH_NONBLOCKING_FINDINGS）
      → P2_ARI_ARCHITECTURE_READINESS_GATE = CLOSED
```

- HY4 自著审计**不得**被写成 independent PASS。
- internal fallback reviewer **不得**被冒充为 Codex。
- 不得删除或改写旧 wording 来“美化一致性”：凡旧文与本文冲突处，**由本文作为 later correcting authority 覆盖**，
  原文保持原样（append-only，历史不被静默改写）。
- 2026-08-28 固定 SHA `8102718776f3cec4161ae08e897e4180a37d1811` 的旧独立外部审计结论
  （`MORE_EVIDENCE_REQUIRED` / `ONE_MORE_EVIDENCE_GATE` / `SPEC_PREPARATION_GATE = NOT_READY`）是**历史 gate**。
  禁止用它重新阻断已完成的 P1；也禁止改写该历史。本次 authority 是「已完成的 P1 基线之上的 P2-ARI readiness gate」。

**本文因此覆盖的前序表述**（原文不改，仅声明被覆盖）：
`docs/planning/P2_READINESS_REVIEW_PACKET.md` 中的 `CODEX_FINAL_GATE = PENDING` 自本文起为
`CLOSED`；`docs/planning/P2_ARCHITECTURE_READINESS_AUDIT_SUPPLEMENT.md` §D 的
`CODEX_FINAL_GATE = PENDING_BLOCKED` 同理。

---

## 2. 逐 Issue 最终裁定（#107–#112）

| Issue | FINAL VERDICT | 限定条件 |
|---|---|---|
| **#107** Research Evaluation Harness | `READY_FOR_EXPERIMENT` | 实验产物不进入生产；不得预设实验结果为 PASS（`UNKNOWN != PASS`） |
| **#108** Gap-aware Targeted Re-query | `NEEDS_ARCHITECTURE_DECISION` | 决策记录机制 = 既有 `docs/architecture/key-decisions.md`（不新建 ADR 制度） |
| **#109** Pre-stop Escape Probe | `WAIT_FOR_108_ARCHITECTURE` | `TECHNICALLY_HARD_BLOCKED_BY_108 = NO`；`ARCHITECTURALLY_PREFERRED_DEPENDENCY = #108` |
| **#110** Adaptive Research Planner | `DESIGN_ONLY` | 不得推进 Spec / Ticket / 状态机设计落地 |
| **#111** Source Authority & Evidence Quality | `READY_FOR_EXPERIMENT` + `DERIVED_REPORT_ONLY_ONLY` | 仅 derived / off-path 变体；进入 claim layer 或 selector 即重回 `NEEDS_ARCHITECTURE_DECISION` |
| **#112** Retrieval Signal Complementarity Experiment | `READY_FOR_EXPERIMENT` + `E0_E1_E1D_ONLY` | 冻结池 + 注入 signals 的离线因果比较；不得推进 E2/E3 |

---

## 3. CRITICAL FINDING VERIFICATION（G-A1 … G-A5）

```text
G-A1 = CONFIRMED
G-A2 = PARTIAL
G-A3 = CONFIRMED
G-A4 = CONFIRMED
G-A5 = CONFIRMED
```

- `G-A1`（动态查询字符串 vs 既有产物安全信任集）：**CONFIRMED**。现有信任分类只有
  `plan-owned`（白名单精确匹配，仍过 T04 复核）与 `provider-content`（默认不信任）两档；动态查询字符串两档都不是，
  其信任归类必须由 #108 决策记录回答，不得由施工 Agent 自行创设。
- `G-A2`（saturation / budget 分母）：**PARTIAL**。finding 成立，但原表述过宽，见 §4 的收窄修正。
- `G-A3`（已计划但未执行的查询字段）：**CONFIRMED**。plan 含 `opposingFramings` / `terminologyVariants`
  等字段，而检索只执行 `queryVariants`；「先执行已计划的 plan-owned 字符串」是远小于「自由生成探针查询」的机制。
- `G-A4`（作者身份载体 `authorRef`）：**CONFIRMED**。见 §5 的限制。
- `G-A5`（「不得无限重复语义等价查询」与现有轮次语义冲突）：**CONFIRMED**。需给出可机检判据，而非一句口号。

---

## 4. G-A2 CORRECTION（收窄后的权威表述）

HY4 原补充中 G-A2 的分母表述过宽。收窄后的正确事实是**两个不同分母**：

```text
BUDGET_STOP：
    cumulativeAttemptsCount  vs  maxQueryBudget
    （预算跨轮累计，触达 maxQueryBudget → BUDGET_STOP / query_budget_exhausted）

SATURATED 前置条件：
    cumulativeAttemptsCount  vs  plannedRoutes.length
    （totalPlannedRoutes = coverageState.retrieval.plannedRoutes.length）
```

因此：

- **禁止**再写「预算以 `plannedRoutes` 为分母」——这是错误的。
- 真正未决的架构问题是：

> 动态 query / dynamic route 被引入后，它如何影响
> `attempts accounting`、`plannedRoutes`、`budget`、`saturation` 和 `STOP`？

- 该问题属 #108 决策记录必答项。**#108 的 gate 不变**，仍为 `NEEDS_ARCHITECTURE_DECISION`。

---

## 5. G-A4 / `authorRef` CORRECTION（限制必须保留）

```text
same authorRef
  → may indicate same derived author display identity

different authorRef  !=  independent evidence
same authorRef       !=  verified real-world identity

authorRef  !=  expertise
authorRef  !=  authority
authorRef  !=  correctness
```

- 任何没有独立证据支持的质量字段一律 `UNKNOWN`。**禁止推测**。
- 禁止让模型生成权威性 / 专业性标签后写进 canonical claim。
- derived 变体只做确定性可做的事：用 `authorRef` 做同源重复 / 独立性判定（即「十篇转载不算十次独立佐证」的确定性子集）。

---

## 6. #112 EXPERIMENT CORRECTION（lexical signal identity）

当前 RCE selector 消费的是：

```text
dense relevance
dense novelty
dense redundancy
```

它**没有 lexical rescue input**。因此 E1 实验：

- **禁止**把 lexical score 伪装成 dense relevance；
- 必须单独保留 `LEXICAL_SIGNAL_IDENTITY`（lexical 信号作为独立、可辨识的信号通道参与比较）；
- 必须冻结：`manifest`、`sourcesByGroup`、Candidate Pool、baseline selector inputs、baseline dense signals；
- E0 / E1 / E1-D 必须是**可解释的 causal comparison**，而不是把新信号混进 dense 通道后看结果变好。

该修正**不授权**以下任何一项：

```text
BM25 production · FTS production · persistent lexical index ·
new retrieval provider · vector DB · ColBERT · SPLADE · xQuAD · DPP · LTR · RL
```

实验仍严格限定为 `E0_E1_E1D_ONLY`、`PRODUCTION_MUTATION = NONE`。

---

## 7. CLOSEOUT STATE

```text
AUDIT_PACKET_COMPLETE            = YES（见 §8）
CODEX_FINAL_VERDICT_PERSISTED    = YES（本文）
DOCS_ONLY                        = YES（审计分支与本次收口仅新增 docs/planning 文档）
PRODUCT_CODE_CHANGE              = NONE
RUNTIME_CHANGE                   = NONE
TEST_BEHAVIOR_CHANGE             = NONE
ISSUE_CHANGE                     = NONE
SPEC_CHANGE                      = NONE
TICKET_CHANGE                    = NONE
```

---

## 8. PACKET COMPLETENESS（P2-ARI readiness audit packet）

| 文件 | 角色 |
|---|---|
| `docs/planning/P2_ARCHITECTURE_READINESS_AUDIT.md` | PRIMARY_AUDIT（HY4 主审计） |
| `docs/planning/P2_ARCHITECTURE_READINESS_AUDIT_SUPPLEMENT.md` | SUPPLEMENT（finding-scoped grilling 补充） |
| `docs/planning/P2_READINESS_INDEPENDENT_REVIEW_VERDICT.md` | FALLBACK_REVIEW（internal fallback，非 Codex） |
| `docs/planning/P2_READINESS_REVIEW_PACKET.md` | REVIEW_PACKET（索引 + 复跑指令 + Codex review prompt） |
| `docs/planning/P2_READINESS_CODEX_FINAL_REVIEW.md` | CODEX_FINAL_REVIEW（本文） |

**冲突优先级**：`CODEX_FINAL_REVIEW` > `SUPPLEMENT` > `PRIMARY_AUDIT`（仅对本文明示覆盖的条目生效，其余不变）。

---

## 9. NOT AUTHORIZED（本 gate 明确未授权）

关闭 readiness gate **不等于**授权下列任何一项：

```text
· 创建 #108 architecture design / 决策答案
· 修改 docs/architecture/key-decisions.md 中 #108 相关条目
· 创建 Seam Map / Seam Contract / P2-ARI Spec / Ticket
· 实现 #107 / #108 / #109 / #111；推进 #110；运行 #112 实验
· 引入 BM25 / FTS / persistent lexical index / vector DB 等生产检索设施
· 修改 production code / runtime / test behavior
· 重新审 P1；重开 2026-08-28 evidence gate
· 修改历史 Product Direction；把 LEGACY P2 与 P2-ARI 合并
```

---

## 10. NEXT AUTHORIZED ARCHITECTURE STAGE（仅记录，不在本阶段执行）

```text
NEXT_AUTHORIZED_ARCHITECTURE_STAGE =
P2-ARI_F02_#108_ARCHITECTURE_DECISION_AND_SPEC_PREPARATION
```

未来该阶段需要解决（**本文不回答**）：

```text
1. GAP STATE               derived vs canonical
2. DYNAMIC QUERY IDENTITY  plan mutation / amendment / child action / other
3. DYNAMIC QUERY TRUST     controller authorization boundary
4. ROUTE / ATTEMPT ACCOUNTING  plannedRoutes / attempts / saturation / STOP
5. DURABLE COMMIT / RESUME replay-safe targeted retrieval
6. BUDGET                  existing limits vs new MVP budget semantics
```

---

*本文为 docs-only governance 产物：未写产品代码、未创建 Spec / ADR 文件 / Ticket / PR、未修改 #107–#112、
未修改 P1 历史事实、未预判实验结果为 PASS。本文关闭的是 **P2-ARI** readiness gate，与 LEGACY P2 无关。*
