# P1 Parallel Execution Contract V1 — READY Gates, DAG Reinterpretation, Integration Train

```text
DOCUMENT_ID = P1_PARALLEL_EXECUTION_CONTRACT_V1
STATUS = NON_AUTHORITATIVE_CANDIDATE
AUTHORITY_CLASS = PLANNING / GOVERNANCE CANDIDATE（待 ChatGPT external audit PASS + ff-only
                  integration 后生效）
BASE_SHA = 0287ba3ef33c29357c7f8306f9e51dcca2b41da0
BRANCH = planning/p1-contract-driven-parallel-workflow
REVISION = R1（2026-09-05，PREVIOUS_SHA = 9cbe5121d1c13b2d1cb70690f9df8d7494483f7c）
           F2  READY 语义修复：新增 ELIGIBLE_FOR_PARALLEL_START_GATE，IMPLEMENTATION_READY
               收紧为「START_GATE 已实际授予」——修复 R0 dry-run（IMPLEMENTATION_READY=YES）
               与 Issue 授权状态（PLANNED_NOT_AUTHORIZED）的矛盾
           F4  新增 contract test taxonomy（TYPE_A fixture / TYPE_B real-producer
               conformance）+ lifecycle 规则（§E2）
           —   Phase 10 PARALLEL_WAVE_CANDIDATE packet（§E3，仅备妥、不执行）
COMPANION = docs/planning/P1_SEAM_CONTRACTS_V1.md
SUPERSEDES = 无（本文件是对 P1_TICKET_GRAPH_V1 §G READY 语义的 additive 细分，不删除、
             不重写 Ticket Graph 任何既有边或字段）
Date: 2026-09-05
```

## A. Workflow gap 诊断（Phase 2 证据结论）

```text
CURRENT_CHAIN =
  Approved P1 Spec（§3–§10，语义级冻结；exact schema 有意 delegated）
  → P1_TICKET_DECOMPOSITION_V1（ticket 合同：IN_SCOPE/AC/TESTS/STOP）
  → P1_TICKET_GRAPH_V1（DIRECT-EDGE DAG + §G READY）
  → per-ticket START_GATE（AGENTS.md 流程）
  → TICKET_LANE_V2 实现

MISSING_MATT_LAYER =
  ① root CONTEXT.md（领域词汇 durable 层）——本 reform 已补；
  ② P1 专属 ADR（key-decisions.md 只覆盖到 D08，缺 manifest 派生性 / analyzed
     identity 单写者 / seam 沟通方式）——本 reform 已补 D09–D11；
  ③ pre-agreed seams（to-spec 第 2 步的 seam sketch）+ golden contract fixtures +
     contract tests——Spec 冻结的是语义，从未冻结"下游可对之实现的模块间可观察形状"。
     仓库现存的唯一 seam 是 T05 ZhihuDataProvider seam（provider 能力 seam），
     不覆盖 T09→T12→T13→T14→T15 数据 seam。

CURRENT_READY_SEMANTICS（P1_TICKET_GRAPH_V1 §G 原文）=
  READY(ticket) ⇔ 所有 BLOCKED_BY 已 merge 进 master 且 remote verified

WHY_PARALLELISM_IS_BLOCKED =
  §G 把「上游已集成（INTEGRATION_READY）」当作「下游可开工（IMPLEMENTATION_READY）」
  的唯一判据；而 Spec 对 exact schema 的 delegated 决定没有任何其他 artifact 承接
  "下游可以对着什么实现"，于是 implementation start 被机械地绑死在 integration 上。
  AGENTS.md §8 并发模型本就允许互不冲突 feature branch 并行施工——被阻塞的是
  ticket graph 语义层，不是 branch 层。

WHAT_MUST_REMAIN_SERIAL =
  ① remote master 集成（RULES §8 / AGENTS §8：全局串行，至多一个 Integrator）；
  ② 真实 producer-consumer 集成顺序（DAG 权威，见 §C）；
  ③ 未冻结 seam 的下游实现（CONTRACT_DEFINITION_DEPENDENCY 未满足）；
  ④ exact-SHA review / Repair Saturation / CI gate（Lane V2 全部保留）。

WHAT_CAN_SAFELY_BECOME_PARALLEL =
  在 seam contract + fixtures 冻结（CONTRACT_READY）且 ticket authority 冻结的前提下，
  下游 ticket 的 isolated implementation（独立 worktree/branch、对 fixtures 开发、
  fixture-based contract tests 全绿）——即 IMPLEMENTATION_READY 层。
  真实上游产物存在与否只决定 INTEGRATION_READY，不再决定可否开工。
```

诊断已对照仓库证据核验：§G 原文、Spec §14 OPEN_DECISIONS 的 delegation 条目、
Decomposition 的 READY-SET PRIORITY 字段（调度优先级，非 gate）、T05 seam 的范围。
未盲信任务书给的概念诊断。

## B. READY 四 gate（R1-F2：替代单一 READY 的 additive 细分）

```text
CONTRACT_READY(seam)
  上游/下游可观察合同足以对之实现。要求：
  - 相关 domain 术语已定型（CONTEXT.md）；
  - 相关 ADR 决策已定型（key-decisions.md）；
  - seam contract 冻结（P1_SEAM_CONTRACTS_V1）；
  - contract fixture / validator 可用（如需）；
  - 无会使下游实现失效的未决 interface-shape 决策。
  未满足 → SEAM_NOT_FROZEN / BLOCKING_DECISION_REQUIRED 报告（seam 文档 §0）。

ELIGIBLE_FOR_PARALLEL_START_GATE(ticket)          【R1-F2 新增】
  ticket 已具备「START_GATE 现在可以在不等上游 merge 的情况下授予实现」的充分证据。要求：
  - ticket authority 冻结（Issue 合同完整：IN_SCOPE/AC/TESTS/STOP/quorum）；
  - 所需输入 seam CONTRACT_READY；
  - ownership 边界冻结；
  - 能对 contract fixtures 进行有意义的测试。
  关键：ELIGIBLE ≠ 已授权。它只声明「可被授权」，授权本身仍必须走既有 START_GATE /
  product-owner 流程。此层修复 R0 矛盾：R0 把「eligible」误标成了 IMPLEMENTATION_READY=YES。

IMPLEMENTATION_READY(ticket)
  START_GATE 已实际授予（Issue / product-owner 授权记录存在）
  + 所需输入 seam CONTRACT_READY
  + ownership 边界冻结
  + 能对 contract fixtures 进行有意义的测试。
  IMPLEMENTATION_READY 不要求任何上游实现已 merge；
  但不豁免 TICKET_LANE_V2 任何步骤（grounding / contract extraction / TDD /
  fresh review / third-party review / CI）。

INTEGRATION_READY(ticket)
  ticket 可对真实上游产物集成。要求：
  - 真实上游 blocker 实现已 review 并进入 integration baseline；
  - remote verified；
  - 真实 producer 产物通过冻结 seam contract（producer-consumer contract tests，
    含 TYPE_B conformance，§E2）；
  - consumer 通过 producer-consumer contract tests。
```

单一 `READY` 字段继续存在于 Ticket Graph §G，但**重解释**为 `INTEGRATION_READY`
（它原本的判据本来就是集成就绪）；CONTRACT / ELIGIBLE / IMPLEMENTATION 三层由本文件新增，
不机械改名既有字段（最小 churn）。

## C. DAG 重解释（不删边、不改图）

```text
P1_TICKET_GRAPH_V1 的 BLOCKED_BY / BLOCKS 默认重分类为：
  INTEGRATION_BLOCKED_BY（默认）——真实上游实现依赖，决定 INTEGRATION_READY 与集成顺序。

唯一能阻塞实现的第二类边：
  CONTRACT_DEFINITION_DEPENDENCY —— 输入合同未冻结 / authority 未决，
  即 IMPLEMENTATION_BLOCKED_BY。它由 seam contract 的冻结状态决定，不由上游 merge 决定。

DAG 新角色 = INTEGRATION_DEPENDENCY_DAG（真实集成的唯一顺序权威）；
并行实现的合法集合由 §B 三 gate 判定，两者正交。
```

对 T09→T12→T13→T14→T15 的逐边重分类：

| 边 | 类型 | CONTRACT_DEFINITION 依据 |
|---|---|---|
| T09 → T12 | INTEGRATION_BLOCKED_BY | SEAM A（T09_TO_T12_V1） |
| T12 → T13 | INTEGRATION_BLOCKED_BY | SEAM B（T12_TO_T13_V1） |
| T13 → T14 | INTEGRATION_BLOCKED_BY | SEAM C（T13_TO_T14_V1） |
| T14 → T15 | INTEGRATION_BLOCKED_BY | SEAM D（T14_TO_T15_V1） |
| T09 → T12（T11 dense 输入） | INTEGRATION_BLOCKED_BY | T11 产物经 T12 输入面；dense 输入形状未单独建模（T11↔T12 为同仓模块间内部输入，未冻结 seam → 不授权 T12 在无 T11 时宣称可集成） |

无任何一条 T12–T15 入边是 CONTRACT_DEFINITION_DEPENDENCY（seam 冻结后）；
若 audit 推翻某个 seam 的冻结性，该边自动降级为 IMPLEMENTATION_BLOCKED_BY。

## D. 预期并行模型（Phase 12；以 §E 审计结果为准，不硬编码）

```text
             FROZEN DOMAIN / ADR / SEAMS
                        |
         +--------------+--------------+
         |              |              |
        T12            T13            T14
     isolated        isolated        isolated
     worktree        worktree        worktree
         |              |              |
      fixture        fixture        fixture
       tests           tests           tests
         +--------------+--------------+
                        |
                INTEGRATION TRAIN（串行）
                        |
                     T12 real
                        |
                producer-consumer
                        |
                     T13 real
                        |
                producer-consumer
                        |
                     T14 real
                        |
                     T15 wiring
                        |
                 final P1 dogfood（T16）
```

T15 是 integration/wiring 性质 ticket（Issue #47 TYPE = CODE / INTEGRATION），
本身不参与并行实现集合。

## E. 当前 P1-T12/T13/T14/T15 并行化 dry-run 审计（R1-F2 修正版）

前提事实（fresh 核验 @ 2026-09-05，origin/master = 0287ba3）：
T09（#41）OPEN，PR #68 OPEN/MERGEABLE（head d621273，REVIEWED_CODE_SHA 4789382），
**未 merge**；T12/T13/T14/T15（#44–#47）均 OPEN / **PLANNED_NOT_AUTHORIZED**。

R1-F2 修正说明：R0 把「合同/所有权证据已备」误标为 IMPLEMENTATION_READY=YES，与 Issue 的
PLANNED_NOT_AUTHORIZED 状态直接矛盾。现按 §B 四态模型重列——**授权证据充足记为
ELIGIBLE_FOR_PARALLEL_START_GATE=YES；IMPLEMENTATION_READY 在 START_GATE 实际授予前一律
NO**。本审计不授予任何 START_GATE。

```text
TICKET = P1-T12（#44）
CONTRACT_READY        = YES   （SEAM A 已 producer-grounded：TYPE_B conformance PASS @ 4789382；
                               SEAM B 冻结为 candidate；D-4/D-5 数值是 selection 算法参数，
                               不 gate T13 消费的产物形状）
ELIGIBLE_FOR_PARALLEL_START_GATE = YES   （authority 冻结 + 输入 seam CONTRACT_READY + fixture 可测）
IMPLEMENTATION_READY  = NO    （START_GATE 未授予：#44 PLANNED_NOT_AUTHORIZED）
INTEGRATION_READY     = NO    （T09 未 merge；T11 dense 输入未集成）
UNRESOLVED_CONTRACT_BLOCKERS = [无 BLOCKING_DECISION_REQUIRED；canonicalSourceId 具体编码
                               由 producer 权威决定（delegated），T11 dense 输入面未单独建模
                               → 见 UNSAFE_TO_PARALLELIZE_YET 的集成侧约束]
CAN_IMPLEMENT_IN_PARALLEL_WITH = [T13, T14]（若各自 START_GATE 获授）
MUST_WAIT_FOR_REAL_UPSTREAM_BEFORE = [真实集成（T09+T11 产物过 SEAM A / dense 输入面）]

TICKET = P1-T13（#45）
CONTRACT_READY        = YES   （SEAM B/C 冻结为 candidate；claims 绑定 T12 fixture 已机械演示）
ELIGIBLE_FOR_PARALLEL_START_GATE = YES
IMPLEMENTATION_READY  = NO    （START_GATE 未授予）
INTEGRATION_READY     = NO    （T12 未实现/未集成）
UNRESOLVED_CONTRACT_BLOCKERS = []
CAN_IMPLEMENT_IN_PARALLEL_WITH = [T12, T14]（若各自 START_GATE 获授）
MUST_WAIT_FOR_REAL_UPSTREAM_BEFORE = [真实集成（T12 产物过 SEAM B）]

TICKET = P1-T14（#46）
CONTRACT_READY        = YES   （SEAM C/D 冻结为 candidate；R1-F3 后 diagnostics 键集 =
                               T14 hook 可写集，所有权边界机械可见；guard 两分支已机械演示）
ELIGIBLE_FOR_PARALLEL_START_GATE = YES
IMPLEMENTATION_READY  = NO    （START_GATE 未授予）
INTEGRATION_READY     = NO    （T13 未实现/未集成）
UNRESOLVED_CONTRACT_BLOCKERS = []
CAN_IMPLEMENT_IN_PARALLEL_WITH = [T12, T13]（若各自 START_GATE 获授）
MUST_WAIT_FOR_REAL_UPSTREAM_BEFORE = [真实集成（T13 产物过 SEAM C + guard 真值）]

TICKET = P1-T15（#47）
CONTRACT_READY        = PARTIAL（T15 消费面 = 全链 CoverageState 汇聚 + v0.3 render 集成 +
                                 观测面；其中跨 ticket 汇聚形状未逐一建模为 seam——T15
                                 本质是 integration ticket，其"合同"即 DAG 集成顺序本身）
ELIGIBLE_FOR_PARALLEL_START_GATE = NO    （wiring 性质：对 fixtures 的"隔离实现"没有意义；
                               D-6 saturation 默认值仍 OPEN——按 Ticket Graph §I 属
                               implementation validation，不是阻塞实现的 interface 决策）
IMPLEMENTATION_READY  = NO
INTEGRATION_READY     = NO    （T14/T07 均未就绪）
UNRESOLVED_CONTRACT_BLOCKERS = [T15 无独立 seam；其验收以真实上游链 + dogfood 为准]
CAN_IMPLEMENT_IN_PARALLEL_WITH = []
MUST_WAIT_FOR_REAL_UPSTREAM_BEFORE = [全部真实上游（T14 + T07 hooks）]

SAFE_PARALLEL_IMPLEMENTATION_SET = [T12, T13, T14]（ELIGIBLE；隔离实现须各自经 START_GATE
                                    授权后进行；独立 worktree/branch；单分支单写者 AGENTS §8.1）
UNSAFE_TO_PARALLELIZE_YET = [T15 实现；任何真实集成；任何未过 audit 的 seam 消费]
WHY = 四个 seam 的语义全部可溯源到 Spec/Issue/真实 producer 且无未决 BLOCKING_DECISION；
      R1 后 SEAM A 更有真实 reviewed producer 的 TYPE_B conformance PASS。真正的串行约束
      只剩「START_GATE 授权、集成顺序、Lane V2 评审纪律」。T15 除外：它是汇聚点，提前
      实现只会制造对不存在产物的猜测。
```

本审计**不启动** T12/T13/T14/T15：开工仍需各自 Issue 的 START_GATE 授权（本分支只授权
治理层）。seam 文档 STATUS 生效前（audit PASS + merge），上表 CONTRACT_READY=YES
应读作 **FROZEN_CANDIDATE**。

## E2. Contract test taxonomy（R1-F4 新增）

```text
TYPE_A_FIXTURE_CONTRACT_TEST
  Golden fixture → seam validator。
  目的：在真实 producer 存在之前，让下游对着冻结合同 + fixtures 做隔离实现。
  载体：test/p1-seam-contracts.test.mjs + test/fixtures/p1-seams/。

TYPE_B_PRODUCER_CONFORMANCE_TEST
  真实 producer 输出 → seam validator。
  目的：证明真实已存在的 producer 满足冻结 seam（fixture↔validator 自洽不构成此证明）。
  硬性要求：使用真实生产模块（不复制、不改写其逻辑）；pin 具体 reviewed SHA。
  载体：test/p1-seam-a-producer-conformance.test.mjs
       （pin REVIEWED_T09_SHA = 4789382f36d179dc13957f2c23748f169875d7a2，git archive
        只读物化真实 producer 模块树后以公共 API 构造确定性状态）。

当前 per-seam 状态（lifecycle 规则）：
  SEAM A：TYPE_A = REQUIRED（在位）；TYPE_B = REQUIRED（在位，PASS）——T09 已存在。
  SEAM B：TYPE_A = REQUIRED（在位）；TYPE_B = DEFERRED_UNTIL_T12_EXISTS。
  SEAM C：TYPE_A = REQUIRED（在位）；TYPE_B = DEFERRED_UNTIL_T13_EXISTS。
  SEAM D：TYPE_A = REQUIRED（在位）；TYPE_B = DEFERRED_UNTIL_T14_EXISTS。

LIFECYCLE RULE：每个 producer 实现完成并通过评审后，其 seam 的 TYPE_B conformance test
即成为 INTEGRATION_READY 的强制前置 gate（不跑不过、不 pin SHA 不过）；TYPE_B 发现真实
产物与冻结合同不符 → STOP: FIXTURE_PRODUCER_DRIFT（seam 适配 producer 或 major bump，
不得改 producer 迁就 seam）。此规则并入 §F integration train 第 6 条的 seam 过渡点检查。
```

## E3. PARALLEL_WAVE_CANDIDATE packet（Phase 10：仅备妥，不执行）

前提（Phase 9 复审）：T12/T13/T14 全部 CONTRACT_READY = YES 且
ELIGIBLE_FOR_PARALLEL_START_GATE = YES → 按规程备妥下述 packet。**本 packet 不构成
START_GATE、不创建实现分支、不修改 Issue 状态、不启动 worker；wave 由外部 ChatGPT
parallel-workflow audit 授权后方可逐票走既有 START_GATE。**

```text
PARALLEL_WAVE_CANDIDATE = [T12, T13, T14]

T12（#44）:
  UPSTREAM_SEAM            = T09_TO_T12_V1
  CONTRACT_FIXTURE         = research-orchestration/test/fixtures/p1-seams/seam-a/
  REAL_UPSTREAM_REQUIRED_FOR_INTEGRATION = T09 真实产物（PR #68 exact-SHA merge 后）过
                             SEAM A（TYPE_B 已就绪）+ T11 dense 输入面
  MODEL_RECOMMENDATION     = GLM_5_3_FLASH_EXTREME（Issue #44 IMPLEMENTATION_MODEL_CLASS）
  RISK_CLASS               = HIGH（Issue #44；Lane V2 HIGH-RISK 流程全程适用）

T13（#45）:
  UPSTREAM_SEAM            = T12_TO_T13_V1
  CONTRACT_FIXTURE         = research-orchestration/test/fixtures/p1-seams/seam-b/
  REAL_UPSTREAM_REQUIRED_FOR_INTEGRATION = T12 真实产物过 SEAM B（届时 T12 TYPE_B 必过）
  MODEL_RECOMMENDATION     = DEEPSEEK_V4_FLASH（Issue #45 IMPLEMENTATION_MODEL_CLASS）
  RISK_CLASS               = MEDIUM（Issue #45）

T14（#46）:
  UPSTREAM_SEAM            = T13_TO_T14_V1
  CONTRACT_FIXTURE         = research-orchestration/test/fixtures/p1-seams/seam-c/
  REAL_UPSTREAM_REQUIRED_FOR_INTEGRATION = T13 真实产物过 SEAM C（届时 T13 TYPE_B 必过）
                             + guard 真值双分支证据
  MODEL_RECOMMENDATION     = DEEPSEEK_V4_FLASH（Issue #46 IMPLEMENTATION_MODEL_CLASS）
  RISK_CLASS               = MEDIUM（Issue #46）

Lane V2 绑定（§G）：每票 CONTRACT_EXTRACTION 必须具名 UPSTREAM_SEAM / CONTRACT_FIXTURE /
INTEGRATION_STATUS = NOT_YET_REAL_UPSTREAM；最多到达 IMPLEMENTATION_REVIEWED；
INTEGRATION_ACCEPTED 等真实上游组合通过 seam contract 后方可宣称。
```

## F. Integration train 政策（Phase 13）

```text
1. Worker branches 保持隔离；每个 ticket 一个 branch（AGENTS §8），单分支单活跃写者（§8.1）。
2. 不为追平移动的 master 而改写已 reviewed worker SHA（不 rebase reviewed history）。
3. 已 reviewed 的 worker commit 原 SHA 必须原样保留（exact-SHA 评审语义）。
4. 专用 integration branch 可按依赖顺序组合 reviewed worker 分支：
   - 若组合需要 merge commit（保真保留双方 reviewed history）→ 这是与 RULES §8
     「合并默认只允许 ff-only」的显式 GOVERNANCE_CONFLICT 点，必须取得 product-owner
     对本 integration-train 模式的明示授权后方可使用 merge commit；未获授权 → 走 5。
   - master 边界保持 ff-only：integration branch 基于当时 master 构建，最终推进
     master 仍是一次 ff（master 视角无 merge commit）。
5. 免授权替代路径（串行 re-form）：按依赖顺序逐票在最新 master 上 re-form worker
   变更为新的 candidate commits + fresh review 后 ff-only 集成。代价是重审，收益是
   零治理冲突。
6. 集成即使实现并行也严格串行；每个 seam 过渡点必须跑 producer-consumer contract
   tests（真实产物 vs 冻结 validator）。
7. Integration-only fixes 单独成 commit / branch，独立可评审；不得混入 worker 修复。
8. 最终 master 更新受控 + remote verified（ls-remote 实时核验），维持
   「master 集成全局串行、至多一个 Integrator」。
```

## G. 与 TICKET_LANE_V2 的关系（Phase 14）

Lane V2 保持全部既有纪律（exact SHA、CodeGraph grounding、RELEVANT_SURFACE_MANIFEST、
contract extraction、counterexample-first TDD、fresh review、third-party review、
Repair Saturation、CI、post-CI review）。**本 reform 不弱化其中任何一步。**

新增最小字段约定：当下游 ticket 对着冻结上游 fixture 实现时，其 CONTRACT_EXTRACTION
必须具名 seam 版本与 fixture：

```text
UPSTREAM_SEAM      = T12_TO_T13_V1        （例）
CONTRACT_FIXTURE   = research-orchestration/test/fixtures/p1-seams/seam-b/…
INTEGRATION_STATUS = NOT_YET_REAL_UPSTREAM
```

此类 ticket 最多到达 `IMPLEMENTATION_REVIEWED`（隔离实现的评审终点）；
`INTEGRATION_ACCEPTED` 必须等真实上游组合通过 seam contract 后方可宣称。
Issue / Tracker 状态机新增这两个状态的映射由后续 governance follow-up 承接，
本分支不修改任何 Issue。

## H. 不建第二治理宇宙（Phase 15）

- 不新增 ticket 系统 / severity 模型 / review 政策 / 架构 spec；
- Matt 概念只落为：CONTEXT.md（glossary）、key-decisions.md D09–D11（ADR）、
  P1_SEAM_CONTRACTS_V1（pre-agreed seams）——连接到既有 Spec/Ticket Graph/Lane V2；
- 执行严格性 = TICKET_LANE_V2；收敛 = Repair Saturation；产品权威 = P1 Spec；
- 与 AGENTS/RULES 冲突处已在 §F 显式标为 GOVERNANCE_CONFLICT 点（merge commit 授权），
  未静默绕过。

## I. STOP conditions（本 contract 级）

```text
SEAM_NOT_FROZEN                # 发现无 authority 依据的合同需求 → CONTRACT_GAP + 报告
FIXTURE_PRODUCER_DRIFT         # 真实 producer 产物未通过冻结 seam validator（含 SEAM A
                               #  manifestHash 重算自校验 / TYPE_B conformance）→ seam 适配
                               #  producer 或 major bump，不得改 producer 迁就 seam
IDENTITY_ENCODING_MISMATCH     # B/C/D identity 编码不一致使 guard 比较失效
GOVERNANCE_CONFLICT            # integration train 需要 merge commit 而未获 product-owner 授权
MASTER_DRIFT                   # 既有语义不变：re-form + fresh review，旧 PASS 不转移
```
