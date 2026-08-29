# P1 Ticket Graph V1 — Dependency DAG & Execution Policy（Planning Only）

```text
DOCUMENT_ID = P1_TICKET_GRAPH_V1
STATUS = REVIEW_PENDING
AUTHORITY_CLASS = NON_AUTHORITATIVE_PLANNING_CANDIDATE
COMPANION = docs/planning/P1_TICKET_DECOMPOSITION_V1.md（ticket contracts 详定义）
BASE_SHA = 12788ce60fed39be6436b62525d4ba4d206f2b61
BRANCH = planning/p1-ticket-decomposition-01
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
Date: 2026-08-29
```

## A. Graph status

```text
TICKET_COUNT = 17（16 unconditional + 1 conditional：P1-T02、P1-T17）
DAG_ACYCLIC = YES（自检见 §J）
CRITICAL_PATH_LENGTH = 10 nodes
MASTER_INTEGRATION = SERIAL（全局任一时刻至多一个 Integrator）
```

## B. Dependency DAG

```text
[EVIDENCE LANE]
P1-T01 GATE-1 EmbeddingProvider Qualification ──► P1-T02 GATE-2 egress authority（CONDITIONAL，
        │                                          仅当 T01 提议 remote）
        │                                                │
        ▼                                                ▼
P1-T10 EmbeddingProvider adapter + cache ◄───────────────┘（remote 时需 T02；local 需 NO_NEW_EGRESS 记录）
        │
        ▼
P1-T11 Dense semantic geometry layer ◄── P1-T06（pool schema）
        │
        ▼
   （汇入 T12）

[DISCOVERY LANE]
P1-T03 GATE-3 Additional retrieval provider discovery
        │
        ├─（若需新 OAuth/Session → D-9 升级：provider-scoped prerequisite 票，另行成票）
        ▼
P1-T17 Additional retrieval adapter（CONDITIONAL）◄── P1-T05
        │
        ▼
   （汇入 T16）

[CORE LANE]
P1-T04 Research Plan contract（D-3）──┐
P1-T05 Provider seam + Official Search adapter + Session capture wrapper（D-2a）──┤
                                      ▼
                          P1-T06 Multi-query retrieval + RRF（single pass, fixtures）
                                      │
                                      ▼
                          P1-T07 Retrieval loop + ResearchCoverageState + saturation feedback
                          │            ▲（feedback edge：未饱和 → 追加 retrieval round 回 T06；
                          │             │  饱和 / budget stop → 释放 pool 下行）
                          ▼            │
                          P1-T08 Source-group Set Selection / Ambiguity Gate（§7）
                                      │
                                      ▼
                          P1-T09 Multi-group Execution State + Per-group Capture/Verify/Handoff
                                      │
                                      ▼
                          P1-T12 RCE Corpus Selector（frozen baseline）◄── P1-T11（dense）
                                      │
                                      ▼
                          P1-T13 Question/Source-group representation
                                      │
                                      ▼
                          P1-T14 Claim/Aspect + cross-source synthesis
                                      │
                                      ▼
                          P1-T15 Coverage enforcement + v0.3 integration + observability
                                      │
                                      ▼
                          P1-T16 End-to-end dogfood acceptance ◄── P1-T03、P1-T17
```

CoverageState update hooks：T07 定义；T09（source completeness）、T12（selection accounting）、
T15（analysis coverage assertion）消费。

## C. blocked_by / blocks matrix

| Ticket | BLOCKED_BY | BLOCKS |
|---|---|---|
| P1-T01 | — | T02, T10（→T11→T12） |
| P1-T02 | T01 | T10（remote 分支） |
| P1-T03 | — | T17, T16 |
| P1-T04 | — | T06, T08 |
| P1-T05 | — | T06, T09, T17 |
| P1-T06 | T04, T05 | T07, T11 |
| P1-T07 | T06 | T08, T15 |
| P1-T08 | T07 | T09 |
| P1-T09 | T08, T05 | T12, T13 |
| P1-T10 | T01（+T02 if remote） | T11 |
| P1-T11 | T10, T06 | T12 |
| P1-T12 | T09, T11 | T13 |
| P1-T13 | T12 | T14 |
| P1-T14 | T13 | T15 |
| P1-T15 | T14, T07 | T16 |
| P1-T16 | T15, T03, T17 | —（completion） |
| P1-T17 | T03, T05（+D-9 prereq 若触发） | T16 |

自检：所有 BLOCKED_BY 均存在；图无环（core lane 单向 + evidence/discovery lane 仅单向汇入）。

## D. CRITICAL_PATH

```text
T04 → T06 → T07 → T08 → T09 → T12 → T13 → T14 → T15 → T16    （10 nodes，core lane）
```

Dense 分支 `T01 → (T02) → T10 → T11 → T12` 在 T12 汇入；T01 属最长证据周期，故虽不在
拓扑最长链上，仍是**调度意义上的全局关键路径**（hardest-first 首启动）。

## E. Parallel lanes

```text
LANE-1（evidence）  : T01 → T02 → T10 → T11
LANE-2（discovery） : T03 → (D-9 prereq?) → T17
LANE-3（core）      : T04 → T06 → T07 → T08 → T09 → T12 → T13 → T14 → T15
LANE-4（foundation）: T05（可与 T04 并行；T06/T09/T17 依赖它）
FINAL               : T16（汇聚 1/2/3）
```

可并行实例（已按依赖核验）：T01 ∥ T03 ∥ T04 ∥ T05（t0 ready set）；T06–T09 core 推进期间
T02/T10/T11（evidence lane）与 T17（一旦 T03 完成）并行。**remote master 集成仍全局串行**：
每票一 branch、一 exact reviewed HEAD、ff-only、remote verify。

## F. Dependency-constrained hardest-first policy

```text
HARDEST_READY_FIRST_ORDER（t0 时刻）：
  1. P1-T01  （HIGH 风险 / HIGHEST 优先：最高不确定性 + 最长证据周期，全局调度关键）
  2. P1-T04  （HIGH / HIGHEST：接口定义决定全部下游形状）
  3. P1-T05  （HIGH / HIGH：公共底座 seam）
  4. P1-T03  （HIGH / MEDIUM：并行 discovery，非基础设施阻塞）
t0 之后：在每一步的 ready set 内取 RISK_CLASS 最高者；同分时取能解锁最多后继者（out-degree）
与证据周期最长者。
```

规则：**不得**为"下游看起来更难"而违反 DAG 依赖；难度只在 ready set 内参与排序。

## G. Ready-set priority rules

```text
READY(ticket) ⇔ 所有 BLOCKED_BY 已 merge 进 master 且 remote verified；
CONDITIONAL ticket（T02/T17）在其触发条件满足前不进入 ready set
（T02 ⇐ T01 提议 remote；T17 ⇐ T03 结论冻结）。
PRIORITY 排序键：RISK_CLASS（CRITICAL>HIGH>MEDIUM>LOW）
              → EXECUTION_PRIORITY_WITHIN_READY_SET（HIGHEST>HIGH>MEDIUM>LOW）
              → out-degree → 证据 lead time。
风险/优先级已在 DECOMPOSITION_V1 §C 表逐票给定。
```

## H. Merge / review order

1. 任何 ticket：scope-clean branch 自 **latest remote master**（开工时 fetch 核验）。
2. required quorum 对 **exact HEAD** PASS（quorum 见 DECOMPOSITION_V1 各票；治理表：
   CODE→1×CODE_REVIEWER；DISCOVERY/EVIDENCE→1×EVIDENCE_REVIEWER；SECURITY→
   SECURITY_REVIEWER+CODE_OR_CONTRACT_REVIEWER 同 HEAD；DOGFOOD→
   ACCEPTANCE_EVIDENCE_REVIEWER）。
3. `git diff --check` clean；ff-only merge；push；remote verify；Tracker/Issue 更新
   （issue-creation workflow 另行授权后）。
4. **master 集成串行**；merge 前 re-fetch 核验 master 未 drift，drift → 旧 PASS 不转移，
   re-form + fresh review。
5. 依 hardest-first policy 在 ready set 中择下一票（不强制全序）。

## I. Gate-to-ticket mapping

| Planning Gate / 冻结项 | Ticket |
|---|---|
| GATE-1（EmbeddingProvider Qualification Discovery） | **P1-T01** |
| GATE-2（remote embedding egress authority；local 须 `NO_NEW_EGRESS` 记录；结论须转 repo-tracked authority/evidence） | **P1-T02**（conditional） |
| GATE-3（Additional Retrieval Provider Capability Discovery；Session capture ≠ retrieval channel） | **P1-T03** |
| D-3（minimum persisted Research Plan contract = early interface ticket） | **P1-T04** |
| D-4/D-5/D-6（数值 = implementation validation） | T12（D-4/D-5）、T07（D-6） |
| D-8（DEFER_FROM_INITIAL_P1_BASELINE） | **无 ticket** |
| D-9（lazy credential discovery；GATE-3 触发升级） | T03→T17 边上的条件 prerequisite 规则 |

## J. STOP conditions（graph 级）

```text
MASTER_DRIFT                       # merge 前发现 master 前进 → 旧 PASS 不转移，re-form + fresh review
REVIEW_TARGET_DRIFT                # branch tip != reviewed HEAD → STOP
CONTRACT_DRIFT_REQUIRES_CHATGPT    # master 变更触碰 Spec/Gate 语义
BLOCKED_BY_EXTERNAL_EVIDENCE       # T01/T03 证据 UNKNOWN/不足 → 后继票保持 BLOCKED
PERMISSION_OR_TOOL_FAILURE
USER_DECISION_REQUIRED             # 含：T02 裁决若 governance 要求 product-owner 正面批准
禁止：降级阈值换绿灯 / captured 冒充 verified / UNKNOWN 当 PASS / 静默 provider·runtime fallback
```

## K. Exact next governance stage

```text
NEXT_GATE = CHATGPT_INDEPENDENT_TICKET_GRAPH_REVIEW
（PASS 后）→ Ticket Graph freeze → issue-creation workflow（另行授权，本任务未创建任何 Issue）
          → 逐票执行（IMPLEMENTATION_AUTHORIZATION 仍 NONE，直至该 workflow 授予）
保持：TARGET_STATUS = NOT_IMPLEMENTED / IMPLEMENTATION_AUTHORIZATION = NONE /
      VERSION_ASSIGNMENT = UNASSIGNED
```
