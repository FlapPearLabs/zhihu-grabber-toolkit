# P1 Ticket Graph V1 — Dependency DAG & Execution Policy（Planning Only）

```text
DOCUMENT_ID = P1_TICKET_GRAPH_V1
STATUS = REVIEW_PENDING
AUTHORITY_CLASS = NON_AUTHORITATIVE_PLANNING_CANDIDATE
REVIEW_CYCLE = R1 REPAIR（BASE_REVIEWED_HEAD = 31cce41122515129cf2e18c0a70984851dec00e1；
              ChatGPT CHANGES_REQUESTED：P0=0 / P1=5 / P2=2）
COMPANION = docs/planning/P1_TICKET_DECOMPOSITION_V1.md（ticket contracts 详定义）
BASE_SHA = 12788ce60fed39be6436b62525d4ba4d206f2b61
BRANCH = planning/p1-ticket-decomposition-01
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
Date: 2026-08-29（R1 repair）
```

## A. Graph status

```text
TICKET_COUNT = 18
UNCONDITIONAL = 16（T01, T03–T16, T18）
CONDITIONAL   = 2（P1-T02：iff T01 提议 remote；P1-T17：iff T03 结论冻结且无未决 D-9 amendment）
DAG_ACYCLIC = YES（自检见 §J；运行期 saturation 反馈是 runtime loop，不是 ticket 依赖环）
CRITICAL_PATH_LENGTH = 11 nodes
MASTER_INTEGRATION = SERIAL（全局任一时刻至多一个 Integrator）
```

## B. Dependency DAG

```text
[EVIDENCE LANE]
P1-T01 GATE-1 EmbeddingProvider Qualification
        │   （出网约束：T02 PASS 前对 remote embedding 只准 synthetic/neutral fixtures；
        │     真实知乎语料出网被禁；若无法回避 → 报告 REQUIRES_REMOTE_EGRESS_AUTHORITY 并 STOP）
        │
        ├── local 结局：report 含 NO_NEW_EGRESS = YES ──► 直接解锁 T10 local 路径
        └── remote 提议 ──► P1-T02 GATE-2 egress authority（CONDITIONAL，REMOTE ONLY）
                                  │
                                  ▼
P1-T10 EmbeddingProvider adapter + cache
        （LOCAL 路径：BLOCKED_BY = T01，evidence = T01 NO_NEW_EGRESS 记录；
          REMOTE 路径：BLOCKED_BY = T01 + T02，evidence = T02 authority）
        │
        ▼
P1-T11 Dense semantic geometry layer ◄── P1-T06（pool schema）
        │
        ▼
   （汇入 T12）

[DISCOVERY LANE]
P1-T03 GATE-3 Additional retrieval provider discovery
        │
        ├─（若需新 OAuth/Session → D-9 trigger → scoped Ticket Graph amendment
        │   → required Contract review → integration → 之后 T17 方可 READY；
        │   不静默向冻结 DAG 追加票）
        ▼
P1-T17 Additional retrieval adapter（CONDITIONAL）◄── P1-T05
        │
        ▼
   （汇入 T16）

[CORE LANE]
P1-T04 Research Plan contract（D-3 interface）
        │
        ▼
P1-T18 Research Planner Semantic Proposal
        （deepseek-api-tool-less；semantic proposal only → T04 validation → persisted plan → planHash）
        │
        ▼
P1-T06 Multi-query retrieval + RRF（single pass, fixtures）◄── P1-T05（seam + adapters）
        │
        ▼
P1-T07 ResearchCoverageState contract + update hooks + retrieval-round controller infrastructure
        │            ▲（运行期 feedback loop：completed round → CoverageState → saturation decision
        │             │  → 未饱和 → 回 T06 追加轮次；饱和 / budget stop → 释放 pool 下行。
        │             │  这是 runtime loop，不是 ticket 依赖边；DAG 无环）
        ▼            │
P1-T08 Source-group Set Selection / Ambiguity Gate（§7）
        │
        ▼
P1-T09 Multi-group Execution State + Per-group Capture/Verify/Handoff
        │        └─ Source Completeness updates → CoverageState（hook）
        ▼
P1-T12 RCE Corpus Selector（frozen baseline；selection accounting）◄── P1-T11（dense）
        │        └─ selection accounting updates → CoverageState（hook）
        ▼
P1-T13 Question/Source-group representation + per-group semantic claim extraction
        │        └─ per-group mapped/analyzed accounting + claim/contradiction 诊断 → CoverageState（hook）
        ▼
P1-T14 Cross-group Claim/Aspect aggregation + cross-source synthesis
        │        └─ aspect/claim/analyzed 诊断 updates → CoverageState（hook）
        ▼
P1-T15 CoverageState final integration + 100% analysis assertion + v0.3 integration + observability
        │        （唯一有权宣称"完整 saturation feedback wiring 完成"的 ticket）
        ▼
P1-T16 End-to-end dogfood acceptance ◄── P1-T03、P1-T17
```

CoverageState 所有权（R1）：**T07** = contract + hooks + round controller infrastructure；
**T09** = Source Completeness 更新；**T12** = selection accounting 更新；
**T13/T14** = aspect/claim/contradiction/analyzed 诊断更新；**T15** = 最终 cross-cutting 集成 +
完整 saturation feedback wiring + 100% analysis assertion。

## C. blocked_by / blocks matrix

| Ticket | BLOCKED_BY | BLOCKS |
|---|---|---|
| P1-T01 | — | T02（conditional）, T10 |
| P1-T02 | T01（且 iff T01 提议 remote 才激活） | T10（remote 分支） |
| P1-T03 | — | T17, T16 |
| P1-T04 | — | T18, T08 |
| P1-T05 | — | T06, T09, T17 |
| P1-T06 | T18, T05 | T07, T11 |
| P1-T07 | T06 | T08, T15 |
| P1-T08 | T07 | T09 |
| P1-T09 | T08, T05 | T12, T13 |
| P1-T10 | LOCAL: T01 ｜ REMOTE: T01+T02 | T11 |
| P1-T11 | T10, T06 | T12 |
| P1-T12 | T09, T11 | T13 |
| P1-T13 | T12 | T14 |
| P1-T14 | T13 | T15 |
| P1-T15 | T14, T07 | T16 |
| P1-T16 | T15, T03, T17 | —（completion） |
| P1-T17 | T03, T05（+ D-9 amendment 产出票若触发） | T16 |
| P1-T18 | T04 | T06 |

自检：所有 BLOCKED_BY 均存在（T01..T18 封闭）；core lane 单向 + evidence/discovery lane 仅单向
汇入 + T18 单向插入 T04→T06 之间 → **无环**。Plan 生成者（T18）先于一切消费者（T06、经管线
至 T08）；无 path 消费无人生成的 Plan。

## D. CRITICAL_PATH

```text
T04 → T18 → T06 → T07 → T08 → T09 → T12 → T13 → T14 → T15 → T16    （11 nodes，core lane）
```

Dense 分支 `T01 → (T02) → T10 → T11` 在 T12 汇入；T01 属最长证据周期，调度意义上是全局
关键起点（hardest-first 首启动）。local embedding 路径（T01 → T10）不经过 T02。

## E. Parallel lanes

```text
LANE-1（evidence）  : T01 → (T02 iff remote) → T10 → T11
LANE-2（discovery） : T03 → (D-9 amendment?) → T17
LANE-3（core）      : T04 → T18 → T06 → T07 → T08 → T09 → T12 → T13 → T14 → T15
LANE-4（foundation）: T05（可与 T04 并行；T06/T09/T17 依赖它）
FINAL               : T16（汇聚 1/2/3）
```

可并行实例（按依赖核验）：t0 = T01 ∥ T03 ∥ T04 ∥ T05；T04 完成后 T18 入 ready set（与
T06 前置并行推进的 evidence/discovery lane 互不阻塞）；master 集成全局串行。

## F. Dependency-constrained hardest-first policy

```text
HARDEST_READY_FIRST_ORDER（t0 时刻）：
  1. P1-T01  （HIGH / HIGHEST：最高不确定性 + 最长证据周期，全局调度关键）
  2. P1-T04  （HIGH / HIGHEST：接口定义决定全部下游形状，含 T18）
  3. P1-T05  （HIGH / HIGH：公共底座 seam）
  4. P1-T03  （HIGH / MEDIUM：并行 discovery）
T04 完成后：T18 进入 ready set（HIGH / HIGH——架构敏感的语义生成，且解锁 T06 链）。
t0 之后：在每一步 ready set 内取 RISK_CLASS 最高者；同分取 out-degree 与证据 lead time。
```

规则：**不得**为"下游看起来更难"而违反 DAG 依赖；难度只在 ready set 内参与排序。

## G. Ready-set priority rules

```text
READY(ticket) ⇔ 所有 BLOCKED_BY 已 merge 进 master 且 remote verified（CONDITIONAL 依赖按
实际激活路径判定：T10 local 路径只需 T01；remote 路径需 T01+T02）。
CONDITIONAL ticket 不在其触发条件满足前进入 ready set：
  T02 ⇐ T01 提议 remote；T17 ⇐ T03 结论冻结 且 无未决 D-9 amendment。
PRIORITY 排序键：RISK_CLASS → EXECUTION_PRIORITY_WITHIN_READY_SET → out-degree → 证据 lead time。
风险/优先级见 DECOMPOSITION_V1 §C 表。
```

## H. Merge / review order & post-review governance（R1，P2-2）

1. 任何 ticket：scope-clean branch 自 **latest remote master**（开工时 fetch 核验）。
2. required quorum 对 **exact HEAD** PASS（CODE→1×CODE_REVIEWER；DISCOVERY/EVIDENCE→
   1×EVIDENCE_REVIEWER；SECURITY→SECURITY_REVIEWER+CODE_OR_CONTRACT_REVIEWER 同 HEAD；
   DOGFOOD→ACCEPTANCE_EVIDENCE_REVIEWER）。
3. `git diff --check` clean；ff-only merge；push；remote verify。
4. **master 集成串行**；merge 前 re-fetch 核验 master 未 drift，drift → 旧 PASS 不转移。
5. 依 hardest-first policy 在 ready set 中择下一票。

**Post-review governance order（本 Ticket Graph 自身的归宿，R1 修正）**：

```text
ChatGPT exact-SHA PASS
→ ff-only integration of the exact reviewed Ticket Graph candidate
→ push
→ remote master verification
→ Ticket Graph 成为 durable frozen planning basis
→ issue / Tracker creation workflow（依 repository authority；本任务未创建任何 Issue）
→ per-ticket START_GATE

IMPLEMENTATION_AUTHORIZATION = NONE 一直保持，直至 authorized issue/freeze workflow 授予执行。
D-9 动态前置：T03 选中 provider 需新 OAuth/Session → 不得静默向冻结 DAG 追加 ticket；
  scoped Ticket Graph amendment → required Contract review → integration → T17 方可 READY。
```

## I. Gate-to-ticket mapping

| Planning Gate / 冻结项 | Ticket |
|---|---|
| GATE-1（EmbeddingProvider Qualification Discovery；含 P1-3 出网禁令与 local `NO_NEW_EGRESS` 义务） | **P1-T01** |
| GATE-2（remote embedding egress authority；REMOTE ONLY，iff T01 提议 remote；结论须转 repo-tracked authority/evidence） | **P1-T02**（conditional） |
| GATE-3（Additional Retrieval Provider Capability Discovery） | **P1-T03** |
| D-3（minimum persisted Research Plan contract = early interface ticket） | **P1-T04** |
| Research Planner semantic proposal（§4.2 / §5.2，R1 新增） | **P1-T18** |
| D-4/D-5/D-6（数值 = implementation validation） | T12（D-4/D-5）、T07（D-6，含 T15 wiring） |
| D-8（DEFER_FROM_INITIAL_P1_BASELINE） | **无 ticket** |
| D-9（lazy credential discovery；触发 → scoped Ticket Graph amendment，不静默追加） | T03→T17 边上的 amendment 规则 |

## J. STOP conditions（graph 级）

```text
MASTER_DRIFT                       # merge 前发现 master 前进 → 旧 PASS 不转移，re-form + fresh review
REVIEW_TARGET_DRIFT                # branch tip != reviewed HEAD → STOP
CONTRACT_DRIFT_REQUIRES_CHATGPT    # master 变更触碰 Spec/Gate 语义
REQUIRES_REMOTE_EGRESS_AUTHORITY   # T01 代表性 qualification 无法回避真实知乎出网 → 该 probe STOP，移交 T02
BLOCKED_BY_EXTERNAL_EVIDENCE       # T01/T03 证据 UNKNOWN/不足 → 后继票保持 BLOCKED
PERMISSION_OR_TOOL_FAILURE
USER_DECISION_REQUIRED
禁止：降级阈值换绿灯 / captured 冒充 verified / UNKNOWN 当 PASS / 静默 provider·runtime fallback /
      先出网后补批准 / 向冻结 DAG 静默追加 ticket
```

## K. Exact next governance stage

```text
NEXT_GATE = CHATGPT_FRESH_TICKET_GRAPH_DELTA_REVIEW
（PASS 后，按 §H governance order）：
  exact-SHA PASS → ff-only integration → push → remote master verify
  → Ticket Graph 成为 durable frozen planning basis
  → issue / Tracker creation workflow → per-ticket START_GATE
保持：TARGET_STATUS = NOT_IMPLEMENTED / IMPLEMENTATION_AUTHORIZATION = NONE /
      VERSION_ASSIGNMENT = UNASSIGNED
```
