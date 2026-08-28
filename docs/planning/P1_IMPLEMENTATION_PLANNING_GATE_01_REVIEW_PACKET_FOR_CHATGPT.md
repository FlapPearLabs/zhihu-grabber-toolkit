# P1_IMPLEMENTATION_PLANNING_GATE_01 — REVIEW PACKET FOR CHATGPT

```text
PURPOSE = 审查导航专用（不构成 authority）
REVIEWER = ChatGPT（外部独立 reviewer；本候选未经任何独立 review，不得自行批准）
STATUS = REVIEW_PENDING / NON_AUTHORITATIVE_PLANNING_CANDIDATE
Date: 2026-08-28
```

## REMOTE IS REVIEW SOURCE OF TRUTH

请直接从 remote 审查，不要依赖本地文件副本。

```text
REMOTE_BRANCH     = planning/p1-implementation-gate-01
BASE_SHA          = 279caf6141c26a38cf4a449b2b4cfbeba4357577   (= fetch 时 origin/master tip)
CONTENT_COMMIT    = （见 push 后本 packet 之 "Files changed / Checks" 实测值；
                     若本文件与 branch tip 间无额外 commit，则 CONTENT_COMMIT == REMOTE_TIP）
REMOTE_TIP        = planning/p1-implementation-gate-01 的 remote tip
                    （执行时为单 commit candidate；BASE_SHA 为其唯一 parent）

REVIEW_ENTRYPOINT = docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01.md
SUPPORTING_FILE   = docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01_REVIEW_PACKET_FOR_CHATGPT.md
```

Scope 声明：candidate 只新增 `docs/planning/` 两个文件；零代码改动、零 Spec 改动、
零 governance 文件改动。若 diff 显示其他变更 → 直接 CHANGES_REQUESTED。

## Authority files read（本轮完整读取）

- RULES.md
- AGENTS.md
- docs/project-memory.md（+ docs/project-memory/decision-boundary-matrix.md）
- docs/specs/p1-cross-question-deep-research.md（subject Spec）
- docs/specs/research-orchestration-scope.md（父级合同，全读）
- docs/specs/v0.3-product-scope.md（决策 A–D / 四层能力 / Non-goals）
- docs/specs/v2-rich-content-fidelity.md（baseline 合同）
- docs/product-behavior-contract.md（3.14 凭据边界 / 3.15–3.18 归一化）
- docs/architecture/runtime-strategy.md（全读）

## Production seams inspected（实测非猜测）

- research-orchestration：bin/research.mjs、lib/{orchestrator,state,runner,selection,intent}.mjs
  （单问题线性状态机 / checkpoint hash 校验已存在；无 multi-group / planner / RRF / embedding 代码）
- zhihu-answer-grabber：src/{official,grabber,verifier,search-answer-count}.js
  （Official Search = 唯一官方 capability，Bearer secret；Session/Cookie capture；无 OAuth）
- corpus-anthology：scripts/{map,verify,reduce,select,chunk}.mjs、lib/{hierarchy,top-percent-selector,
  deepseek-tool-less,lmsudio*}.mjs（runtime additive 路由 + fail-closed；preflight 布尔模式）
- 全仓库无 embedding/dense/vector 代码；bge-small-zh-v1.5 不在任何 tracked 文件中
  （仅存在于未导入 master 的 external-audit 树）

## D-1…D-9 summary

| ID | PRIMARY_CLASS | 一句话理由 |
|---|---|---|
| D-1 | B（Discovery/Qualification = GATE-1） | seam 已冻结；provider 选型需 egress+qualification 证据；blocks 实现，不 blocks ticketing |
| D-2 | C（首段 adapter 委派）+ lazy B | 首条 critical path 只需 Official Search + Session capture（均已实现）；其余 capability 按需 discovery |
| D-3 | C（DAG 前部 interface ticket） | 概念字段与 plan authority 已冻结；exact schema 可 TDD；作为共享接口须排在 DAG 前部 |
| D-4 | C + IMPLEMENTATION_VALIDATION | 数值调参；planning 不拍权重、不重跑 benchmark |
| D-5 | C（invariant-first） | anti-starvation 先表达为可测不变量；数值（若需要）由实现验证；拒绝 six hard quotas |
| D-6 | C + IMPLEMENTATION_VALIDATION | saturation 语义已冻结；thresholds/rounds/budgets 实现验证 |
| D-7 | C（cache/storage）+ B 子门（egress = GATE-2） | cache schema 不阻塞任何事；remote embedding egress 需显式 authority，blocks remote 实现仅 |
| D-8 | D（CLOSED_FOR_V1） | Spec 自带 minimum-correct default = 不引入；维持 OPEN 只是虚假 blocker |
| D-9 | D（lazy 触发 Discovery） | V1 critical path 无 OAuth 依赖；既有 Session/Cookie 边界冻结不动 |

## MUST_RESOLVE_BEFORE_TICKETING

```text
（空集）
```

## PRE_IMPLEMENTATION_DISCOVERY（可进入 Ticket DAG，不要求提前完成）

- GATE-1（D-1）：EmbeddingProvider Qualification Discovery
  （provider category local/remote、quality/identity evidence、failure identity；
  显式不冻结 bge-small-zh-v1.5 为 production model）
- GATE-2（D-7b）：public-Zhihu corpus → embedding provider egress authority
  （仅 remote 需要显式批准；local 须显式记录"无新增 egress"）
- GATE-3（lazy，D-2/D-9）：capability-scoped provider discovery，按 future ticket 依赖触发

## DELEGATED

D-2 首段（Official Search adapter + Session capture wrapper routing）、
D-3（minimum persisted Plan schema + planHash，DAG 前部）、
D-4（selector weights + optional redundancy params）、
D-5（anti-starvation 不量化 + optional floor/count/quota 数值）、
D-6（saturation thresholds / minimum rounds / budgets）、
D-7a（embedding cache/storage exact schema）。

全部附 `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION` 约束（适用者）与"AC 引用冻结条款"要求。

## DEFERRED

D-8（CLOSED_FOR_V1，reopen 需未来产品需求 + 独立 Spec authority）、
D-9（新 provider OAuth/Session 设计）、
D-2 非首段 capabilities 的预研。

## Critical Path（十二组件，component level）

[1] Research Plan contract → [2] ZhihuDataProvider seam（adapter-first）→ [3] Multi-query retrieval + RRF
→ [4] Multi-group execution state → [5] Per-group capture/verify/handoff composition
（[GATE-1]→[GATE-2] 与 [1]–[5] 并行）→ [6] EmbeddingProvider adapter + cache → [7] Dense semantic layer
→ [8] RCE selector（D-4/D-5 验证点）→ [9] Question/Source-group representation
→ [10] Claim/Aspect + cross-source synthesis → [11] ResearchCoverageState + saturation（D-6 验证点）
→ [12] v0.3 final synthesis integration（100% analysis coverage assertion）。

完整依赖要点见 REVIEW_ENTRYPOINT §F。

## TICKETING_READY

```text
TICKETING_READY = YES
MUST_RESOLVE_BEFORE_TICKETING = 空集
NEXT_LEGAL_STAGE（若本候选通过 review） = P1_TICKET_DECOMPOSITION
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
```

七项 readiness 条件逐项核验见 REVIEW_ENTRYPOINT §L。

## Remaining blockers

```text
（无 ticketing blocker）

非 ticketing blocker（已在 DAG 中具名）：
  - GATE-1 未完成前，不得实现 EmbeddingProvider adapter / Dense layer；
  - GATE-2 未通过前，不得实现任何 remote embedding；
  - GATE-3 触发规则：future ticket 真正依赖某 provider capability 时先 discovery。
```

## Files changed

```text
docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01.md                    （新增）
docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01_REVIEW_PACKET_FOR_CHATGPT.md （新增，本文件）
```

## Checks（执行时实测）

```text
git fetch origin                        # 已执行（走本地代理），origin/master = 279caf6（与提示基线一致）
REMOTE_BASE_VERIFIED = YES              # candidate branch 自 origin/master = 279caf6 建立
branch ancestry                         # BASE_SHA 为 candidate 单 commit 之唯一 parent（legal ancestry）
git diff --check                        # clean
scope audit                             # 仅 docs/planning/ 两个新文件；无代码 / Spec / governance 改动
REMOTE_TIP == CONTENT_COMMIT            # push 后已验证（以 remote rev-parse 为准）
```

（若 reviewer 拉取后发现本节与 remote 事实不符，以 remote 为准并记 finding。）

## Exact questions for ChatGPT

1. **Approval provenance 确认**：P1 Approved Spec 的五条件中，CONTRACT_REVIEWER PASS 与
   CONSISTENCY_REVIEWER PASS（on exact HEAD `279caf6`）的记录保存在外部审查会话，repo 端仅有
   promote（ce3cbe0）/ repair（279caf6）commit 留痕。请确认该双 PASS 记录存在且确系针对 `279caf6`；
   若不存在 → 本 Gate 的 authority 基线失效，全部结论需重估。
2. **D-1 分类是否正确**：将 production EmbeddingProvider/model 归为 B（GATE-1 Discovery）而非
   A（pre-ticketing 必决）是否成立？关键论据：seam contract 已冻结（§5.3），选型不改变架构形状，
   按"§10 区分"blocks implementation 而非 ticket decomposition。是否存在被忽略的
   architecture-shaping 残留？
3. **GATE-2 的定位是否充分**：把"public-Zhihu 语料 → 新 embedding provider 出网"作为 D-7 的
   B 子门（而非独立 A 类）是否足以防止其被"偷偷委派"？是否需要升级为 pre-ticketing 决策？
4. **D-2 的 lazy discovery 触发规则**是否与 frozen official-first policy（§5.1）完全一致？
   是否存在某 capability 必须在 ticketing 前预研的遗漏场景？
5. **D-3 的 DAG 排序约束**（plan contract 作为前部 interface ticket）是否足以防止下游接口漂移，
   还是需要更强的 pre-ticketing interface freeze？
6. **D-8 CLOSED_FOR_V1** 的表达是否恰当（相对保留 OPEN + default=不引入）？
7. **Critical Path**（§F）依赖关系是否与真实 repo seams 一致？是否有缺失组件或错误依赖方向？
8. **OVERENGINEERING_REJECTION_LIST** 是否有遗漏应拒绝项，或误拒项？
9. **TICKETING_READY = YES** 是否同意？若不同意，请给出确切 BLOCKING_PRE_TICKET_GATES 清单。
10. NEXT_LEGAL_STAGE = P1_TICKET_DECOMPOSITION 之后，Ticket Decomposition 产物应要求包含
    GATE-1/GATE-2/D-3-interface 三类 ticket 的硬性约束是否正确？

---

*REMOTE IS REVIEW SOURCE OF TRUTH。本 packet 与 REVIEW_ENTRYPOINT 均为 NON_AUTHORITATIVE
planning candidate；SELF_REVIEW != INDEPENDENT_REVIEW。*
