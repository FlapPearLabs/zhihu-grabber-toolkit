# P2_ARCHITECTURE_READINESS_AUDIT

> **产物溯源**：本文是 #107–#112 的 P2 架构就绪审计产物，审计基线 `9c60ae56610498f1cf782c0c36bfc9f8c0642051`（remote master 实时值）。
> 审计过程为只读：未写产品代码、未创建 Spec / ADR 文件 / Ticket / PR、未修改 #107–#112、未修改 P1 历史事实。
> 本机绝对路径已按 `RULES.md` §11 脱敏。审计期间使用的 detached 工作树不进入本仓库。


> 仓库：`FlapPearLabs/zhihu-grabber-toolkit`
> 审计类型：READ-ONLY architecture readiness audit（不施工、不拆票、不改 written authority）
> 审计者角色：P2_ARCHITECTURE_READINESS_ORCHESTRATOR + SPEC_SEAM_ADR_AUDITOR + ANTI_OVERENGINEERING_REVIEWER

---

## 0. 审计环境事实（GIT / WORKTREE ISOLATION）

| 项 | 值 |
|---|---|
| AUDIT_BASE_SHA | `9c60ae56610498f1cf782c0c36bfc9f8c0642051` |
| REMOTE_MASTER_AT_START | `9c60ae56610498f1cf782c0c36bfc9f8c0642051` |
| REMOTE_MASTER_AT_END | `9c60ae56610498f1cf782c0c36bfc9f8c0642051` |
| REMOTE_MASTER_CHANGED | **NO** |
| WORKTREE_PATH | `AUDIT_WORKTREE（本机 detached 工作树 @ 9c60ae5，non-authoritative）`（fresh `--detach`，非用户开发工作树） |
| WORKTREE_CLEAN | **YES**（`git status --short` 输出 0 行） |
| REPOSITORY_MUTATION | **NONE** |
| BRANCH_REQUIRED / COMMIT / PUSH / PR / ISSUE_WRITE / PRODUCT_FILE_WRITE | 全部 NO，未发生 |

**治理旁注（non-blocking）**：用户当前活动工作树内的本地远程跟踪引用 `refs/remotes/origin/master` 处于 stale 状态（`1e711d0`，落后远程 2 个 commit 以上），且 `git fetch origin` 因已存在同名 ref 部分失败（输出 `reference already exists`）。本次审计以 `git ls-remote origin refs/heads/master` 的实时结果为准，并以 `git fetch --no-tags origin <exact SHA>` 取对象，因此审计基线使用的是**真实远程 master**，而非 stale 本地跟踪引用。建议在正常施工前做一次 ref 卫生处理（不属于本审计范围，未执行）。

---

## 1. 真实 P1 链路（以代码为准，非文档声称）

已用代码核实，**P1 不是 "pure embedding retrieval"**，其真实生产路径为：

```text
bin/research-p1.mjs
→ lib/p1-runtime-composer.mjs (composeP1Research)
→ lib/coverage-final-integration.mjs (CANONICAL_STAGE_ORDER)
    ├─ Planner            lib/planner.mjs proposeResearchPlan → validatePlanJson/persistPlan（LLM = deepseek-api-tool-less）
    ├─ Retrieval rounds   runRetrievalFeedbackLoop (coverage-final-integration.mjs:307)
    │                     → runMultiQueryRetrieval (retrieval.mjs:494)，每轮**同一 plan**
    │                     → channels = plannedRoutes.map(providerId)（composer:1085）
    ├─ Providers          lib/provider-seam.mjs (CAPABILITY_SEARCH) + official-search-provider.mjs
    │                     (PROVIDER_ZHIHU_OFFICIAL_SEARCH) + global-search-provider.mjs
    │                     (PROVIDER_ZHIHU_OPEN_PLATFORM)
    ├─ RRF                lib/rrf.mjs rrfFusion，RRF_K=60，确定性
    ├─ Candidate pool     retrieval-rounds/accumulated-pool.json（跨轮累积）
    ├─ Dense geometry     lib/dense-geometry.mjs computeDenseGeometry → relevance / redundancy / novelty / pairwise
    │                     embeddings: lib/embedding-provider.mjs（本地 bge-base-zh ONNX）+ embedding cache
    ├─ RCE selector       lib/rce-corpus-selector.mjs selectResearchCorpus({manifest, sourcesByGroup,
    │                     denseSignals, densePairwise, options}) → SEAM B selected-research-corpus
    ├─ Analysis           lib/per-group-claim-extraction.mjs runPerGroupAnalysis → per-group-claims.json（SEAM C）
    │                     safe projection: lib/safe-content-projection.mjs
    ├─ Synthesis          lib/cross-source-synthesis.mjs → cross-source-synthesis.json（SEAM D, V2）
    │                     guard: lib/pre-synthesis-guard.mjs
    ├─ CoverageState      lib/coverage-state.mjs ResearchCoverageState（canonical, persisted coverage-state.json）
    └─ Stop               lib/retrieval-round-controller.mjs evaluateRetrievalRound
                          → CONTINUE / SATURATED / BUDGET_STOP / PROVIDER_FAILURE
```

**对 P2 有直接影响的代码级事实：**

1. `retrieval-round-controller.mjs` 文件头所有权声明明确写着 T07 **不实现** `Issue #53 targeted re-query` / `#54 escape probe` / `#55 advanced research loop`。→ #108 / #109 是对一个**有显式所有权边界**的模块的刻意扩展，不是"顺手加功能"。
2. **每轮用同一个 plan**（`runMultiQueryRetrieval({plan, ...})`，未见 `buildChannels`/per-round query override 实现）。轮次之间只重复执行同一 planned retrieval；`docs/project-memory.md:279` 与之一致："检索轮的合同内语义 = 重执行同一 planned retrieval（targeted re-query 属 #53，不在基线内）"。
3. **planHash 是全链路身份绑定键**：`resumeMultiGroupExecution` 绑定 `planHash + selectionIdentity + selectionDecisionHash`；CoverageState 按 planHash 创建/加载；v0.3 render 消费缝要求 `p1FinalCoveragePlanHash` 精确相等。→ 中途改变查询集合必然触碰身份绑定。
4. **CoverageState 是 ownership-pinned 状态机**：`OWNER_T06_RETRIEVAL / OWNER_RETRIEVAL_CONTROLLER / T08 / T09 / T12 / T13 / T14 / T15`，错误面含 `coverage_unauthorized_owner` / `coverage_illegal_write`。
5. **代码已存在 `SATURATION_SEMANTICS_DISCLAIMER`**，明示 saturation 意为"当前策略下边际增益下降"，并显式 non-goals：不意味全局完整 / 不意味最终研究完整。→ #109 所依赖的语义前提**已被代码承认**，缺的是"据此采取行动"。
6. **预算控制器只存在轮次/查询条数**（`maxRetrievalRounds=3`、`maxQueryBudget=10`、`saturationNoveltyGainThreshold=0.05`、`minRoundsBeforeSaturation=1`，`IMPLEMENTATION_DEFAULTS_RECORD.retrieval`）。**token / cost 预算控制器在代码中 NOT FOUND**（仅有非权威 `usageSink`）。
7. **RCE selector 的 denseSignals 是注入参数**，不是内部自算 → 可以在线下替换/增补信号而不改 selector 本体。
8. **仓库中不存在任何 evaluation / benchmark / experiment 目录**（`find` 全树无匹配；`scripts/` 仅 `run-classified-research-suites.mjs`）。
9. **仓库没有 ADR 机制**：无 `docs/adr/`，无模板/命名约定；`docs/architecture/key-decisions.md` 是叙事性决策日志（格式：问题 → 决策 → 为什么 → 代价 → 演进），其中已沉淀 D02 controller-owns-truth、D03 canonical raw、D09 manifest derived、D10 single-writer 等同类架构决策。
10. **Seam A/B/C/D 全部 FAIL_CLOSED**、带版本号（D 为 V2）、验证权威 `test/helpers/p1-seam-contracts.mjs`、语义权威 `docs/specs/p1-cross-question-deep-research.md`。
11. **CI 归类机制已存在且强制**：`suite-classification.json` 五分类（`fast-deterministic` / `full-offline` / `historical-compat` / `live-gated` / `private-canonical`），新增未登记 suite 会 CI 失败。→ #107 / #112 的实验套件**无需新建 CI 基础设施**，但必须登记。

**关键发现**：本次审计未在 docs 中发现任何"evaluation lane / experiment lane / bypass artifact / design-consumption rule"的现有授权（五份主要文档：P1_SEAM_CONTRACTS_V1.md、product-behavior-contract.md、research-orchestration-scope.md、architecture/key-decisions.md、AGENTS.md）。"何时可以消费一个设计"的规则目前**只存在于 P2 Issue 自身内部**，尚未进入仓库级 authority。

**grill skill 可用性核查**：本环境**不存在** `grill-spec` / `grill-ticket`。存在的是 mattpocock 系列的 `grilling` / `grill-me` / `grill-with-docs` / `batch-grill-me` / `to-spec` / `to-tickets`，且全部 `disable-model-invocation: true`（用户手动 slash 命令）。其中 `grilling` 是逐问等待用户作答的交互式访谈；`grill-with-docs` 会顺带产出 ADR 与 glossary；`to-spec` / `to-tickets` 会**发布到 issue tracker**。三者分别与"自主只读审计""不要为形式主义创建 ADR""本次 ISSUE_WRITE_ALLOWED = NO、不得提前拆票"冲突。因此本次**不使用这些 skill**，改为手工施加 grill 纪律（对抗性提问 + 更小机制检验），这符合"不要把 grill 当 architect、不要为了用 skill 而扩大任务"。另检出 `product-readiness-audit` skill（判断能否交付终端用户、BLOCK/PILOT/READY），与本次"架构就绪 + NEXT_GATE 分类"合同不同，**未加载**，避免把两套输出合同混用。

---

## 2. 总表

| Issue | Type | Product Evidence | Experiment Ready | ADR | Seam Map | Spec | Blocking Decision | NEXT_GATE |
| ----- | ---- | ---------------- | ---------------- | --- | -------- | ---- | ----------------- | --------- |
| **#107** Research Evaluation Harness | Evaluation infra (bypass) | 结构性缺口真实存在（P1 只能证明管线正确；仓库无任何 evaluation lane） | **YES** | NO | NO（仅新增只读消费面，登记现有 seam 约定即可） | NO（不需修改 Approved Spec） | 无 | **A. READY_FOR_EXPERIMENT** |
| **#108** Gap-aware Targeted Re-query | Production retrieval extension | 缺口合理但**无实测证据**；gap 的实际发生率未知 | NO（须先定 seam） | 实质需要冻结决策，**但不建议新建 ADR 机制**（见下） | **YES** | **YES**（amend 现有 P1 semantic authority，非新 Spec） | gap 是 derived 还是 canonical？planHash 绑定策略？轮次重入模型？cost 预算归属？ | **C. NEEDS_ARCHITECTURE_DECISION** |
| **#109** Pre-stop Escape Probe | Stop-boundary policy | 前提已被代码 `SATURATION_SEMANTICS_DISCLAIMER` 承认；无实测 false-saturation 率 | NO（依赖 #108 primitive） | 继承 #108，无需独立 ADR | 继承 #108 seam | 继承 | #108 的 retrieval primitive seam 未存在 | **H. BLOCKED_BY_OTHER_P2**（#108） |
| **#110** Adaptive Research Planner | Orchestration (future) | 无（需 #108/#109 真实运行后才有） | NO | NO | NO | NO | PROMOTION_GATE 未满足 | **G. DESIGN_ONLY** |
| **#111** Source Authority & Evidence Quality | Evidence model (derived MVP) | 缺口真实（relevance ≠ evidence strength），但消费路径未定 | **YES**（仅限 derived / off-path 变体） | NO（若仅 derived） | 仅当进入 claim layer / selector 才需要 | 仅当进入 claim layer / selector | derived metadata 还是 canonical evidence state？谁生成/谁消费？ | **A. READY_FOR_EXPERIMENT**（严格限定 derived 变体；进入 claim/selector 前触发 C） |
| **#112** Retrieval Signal Complementarity Experiment | Off-path causal experiment (E0/E1/E1-D) | 待验证的假设，本身不预设 PASS | **YES** | NO | NO | NO | 无（前提：冻结候选池 + E1-D 可今日开工） | **A. READY_FOR_EXPERIMENT** |

---

## 3. 逐 Issue 审计

### #107 — Research Evaluation Harness

```text
CURRENT_INTENT =
旁路评测基础设施：判断后续 P2 改动是否真的让研究变好。
不是 production 质量分，不是 Observatory / Dashboard / Shadow Researcher。

CURRENT_SYSTEM_TOUCHPOINT =
只读消费 P1 既有产物：
accumulated-pool.json / selected-research-corpus / per-group-claims.json /
cross-source-synthesis.json / coverage-state.json / coverage-final.json

REAL_EXISTING_SEAM =
无专属评测缝，但存在可直接复用的身份与产物事实：
- runIdentityHash(topic+mode+runtime)
- planHash + 逐产物 sha256 复用绑定（p1-reuse-closure）
- artifact identity binding 已覆盖 run / plan / selection / coverage
→ "exact run / code / benchmark identity" 大部分已存在，只需补齐 benchmark_version

NEW_SEAM_REQUIRED = NO
（仅需一个"只读评测消费面"约定：读哪些产物、按什么版本、hidden targets 存放位置）
注意：这不是新 canonical state，也不是新 source of truth。

ADR_REQUIRED = NO
SPEC_REQUIRED = NO（不修改 Applicable Approved Spec，不改 ")
产品行为）

EXPERIMENT_FIRST = YES

OPEN_DECISIONS =
1) hidden targets 的存放与隔离 hunter 规则：必须物理保证"product run 不可见"
   （建议：评测产物不进 product workDir；或进 workDir 但由评测 runner 独占读写）
2) 评测套件在 suite-classification.json 的归类：建议 live-gated（真实跑批）
   而非 fast-deterministic；deterministic 子集单独登记
```

**PRODUCTION Question（6 问）**

| 问 | 答 |
|---|---|
| ① 真实缺口还是假设？ | **真实但属"不可度量"型缺口**：P1 只能自证管线正确（`docs/project-memory.md` 已是 "100% Analysis Coverage" 双保险合同），仓库无任何评测面。<br>注意区分：这是**结构证据**（没有度量能力），**不是**"P1 效果差"的实测证据。不得因此声称"P1 质量不好"。 |
| ② 是否已有证据？ | 有结构证据，无实测质量证据。这正是本 Issue 要解决的问题，不构成循环论证。 |
| ③ 是否应先实验？ | 是。它本身就是别的 Issue 的实验前置。 |
| ④ 最小可验证版本？ | 5–8 个 curated case + 4 个主度量（aspect / counter-position / key-evidence / cost）+ baseline vs candidate + identity binding。Metric 数为 **4**，不是全文列出的 17 项。 |
| ⑤ 明确 deferred？ | 12+ case 集；跨域作为硬门；完整 metric vector；shadow researcher；expert-review workflow；production dashboard；continuous monitoring；universal quality score。 |
| ⑥ 更小机制（20%→80%）？ | **有**：先用 **5 个 case + 4 个度量 + 手工对比**，不要先做benchmark schema 通用化与多 runner 支持。 |

**SYSTEM FIT**：不引入 canonical state / source of truth / index / service / state machine / recovery surface。**不修改 `docs/project-memory.md` 的任何 P1 事实**。**唯一新增**是 CI suite 登记（已有机制）。失败语义：评测失败**不得**影响生产 run 的 `coverage-final` 或 coverage 断言。

**AUTHORITY（6 owner 问）**

| 项 | 回答 |
|---|---|
| semantic owner | 评测本体不使用 LLM 做结论；如需 LLM 打标，必须是 proposal，不是 authority |
| identity owner | controller（`runIdentityHash` / `planHash` 既有 owner 不变） |
| persistence owner | 评测 runner 独占目录；**不写 product workDir** |
| retry / resume owner | 评测本身无 resume 语义；套跑失败重跑是 runner 自己的事 |
| budget owner | 评测预算外置（caller 提供），**不进 `retrieval-round-controller` 合同** |
| STOP / transition authority | 评测**不拥有**任何 STOP 或产品转移权限；FAIL_OPEN_OFF_PRODUCT |

**SEAM（因不改变生产，只需最小集）**

```text
PRODUCER   = P1 canonical run（未改动）
CONSUMER   = evaluation runner（新增，只读）
INPUT      = 既有产物 + eval-case.json（含 hidden targets）
OUTPUT     = eval 产物目录：run-manifest / baseline-result / candidate-result / comparison / summary
SYNC/ASYNC = 离线异步评测（跑完后评），不与生产同进程
FAILURE    = 评测侧失败 → 评测 UNKNOWN/PARTIAL，绝不影响 production artifact
FAIL OPEN / FAIL CLOSED = FAIL_CLOSED（评测自身）；对生产 FAIL_OPEN（不阻断生产）
PRODUCTION_CALLER = NONE
TEST_CALLER = 新增评测 suite（须登记 suite-classification.json）
OBSERVABLE_PRODUCT_EFFECT = NONE
PRODUCTION_MUTATION = NONE
```

**ANTI-OVERENGINEERING**：VALUE 高 × EVIDENCE 中 × SYSTEM_FIT 高 ÷ COMPLEXITY 低 ⇒ **值得做**。主要风险是 metric 膨胀（把全文 17 项 metric 一次全做）与提前把 Observatory / Dashboard 建进来 → **禁止**。

```text
SMALLEST_VALID_NEXT_STEP =
定义只读评测消费面（读哪些产物 / 版本约定 / hidden targets 隔离） + 5–8 case + 4 度量 + 一个 live-gated suite

NEXT_GATE = A. READY_FOR_EXPERIMENT
条件：PRODUCTION_MUTATION = NONE；不得成为 canonical state 的生产消费者。
```

---

### #108 — Gap-aware Targeted Re-query

```text
CURRENT_INTENT =
把"研究缺口"转成一次 bounded、auditable 的定向重检索。
不是 LLM 自由浏览；不替代 planner；不让 LLM 持有 canonical state。

CURRENT_SYSTEM_TOUCHPOINT =
runRetrievalFeedbackLoop（coverage-final-integration.mjs:307）
+ evaluateRetrievalRound / applyRoundEvaluationToCoverageState
+ ResearchCoverageState（ownership-pinned）
+ planHash 全链路绑定 + p1-reuse-closure 恢复绑定

REAL_EXISTING_SEAM =
- provider-seam（检索执行，可复用，Issue §6 已要求复用）✔
- 但：**不存在**"轮中引入新 query"的缝
- retrieval-round-controller.mjs 文件头显式声明"不实现 #53 targeted re-query"

NEW_SEAM_REQUIRED = YES（round extension / targeted-query seam）

ADR_REQUIRED = NO（但决策必须被冻结 —— 见下方 <ADR 判断>）
SEAM_MAP_REQUIRED = YES
SPEC_REQUIRED = YES（amend 现有 P1 semantic authority，不新建 Spec）

EXPERIMENT_FIRST = YES（但先看/「更小机制」）
```

**Grill 结果（按用户指定的 10 个 grill 问逐条回答）**

| 问 | 证据支撑的答案 |
|---|---|
| gap 谁产生？ | 未定。可行候选：(a) 由 T13 claim/coverage artifacts 确定性派生；(b) 由 semantic model 做语义提议 + controller 验证。Issue §5 明确"模型可提议" ⇒ 倾向于 (b)，但 (b) 需要 deterministic validator 存在，目前**无证据表明有**。 |
| gap 是 derived 还是 canonical？ | **未定 —— blocking**。Issue §4 要求 gap 是"durable object"（`gap_id/status/created_at_round/resolved_at_round`）→ 语义上偏 canonical。而 CoverageState 是 ownership-pinned canonical store（新增需新 owner token + `COVERAGE_ERROR_UNAUTHORIZED_OWNER` 面）。这是**新的 canonical 表示**，属典型需冻结决策。 |
| 谁持久化？ | 若 canonical：CoverageState owner 扩展（新增 owner token）。若 derived：不持久化，或从既有 artifacts 重算。UNKNOWN。 |
| 谁负责 resolution？ | controller，非 LLM（Issue §8 明确"不得假关闭"）。但"material evidence added" 的判定需要一个 determinate/verifiable 信号；目前 **signal 未定义**。 |
| query proposal 谁生成？ | LLM proposal + controller validation（已有先例：`validatePlanJson` / `pre-synthesis-guard`）。可复用既有 pattern。 |
| controller 谁批准？ | `retrieval-round-controller` 或新的 round-extension owner —— **所有权扩展需决策**。 |
| 如何进入现有 retrieval round？ | **核心 blocking**。代码事实：每轮执行同一 plan；`channels` 来自 `plannedRoutes`。两条路：(1) 修改/追加 plan ⇒ **planHash 变化 ⇒ 使已持久化的 selection identity / coverage 绑定 / seam 产物失效**；(2) 引入 plan 之外的 query source ⇒ **打破"查询来自 plan"的单一事实源**。两者都必需 ADR 级决策。 |
| budget 如何变化？ | **blocking**。Issue §7 要求 `query_budget/provider_budget/cost_budget/round_budget`。代码内**只有** `maxRetrievalRounds=3` 与 `maxQueryBudget=10`；**cost/token budget controller 不存在**。→ 要么新增 cost accounting 权威（新依赖面），要么先只用 existing round/query budget（更小）。 |
| CoverageState 如何更新？ | 新增 gap 段 ⇒ 新增 owner token + ownership 语义 + hash 参与方式。UNKNOWN。 |
| resume / crash 如何避免 duplicate re-query？ | 必须扩展 `CHECKPOINT_BINDING_*` 内容哈希绑定集（现有：ACCUMULATED_POOL / SELECTION_DECISION / COVERAGE_STATE）→ **新增 recovery surface，必须显式声明**。 |
| STOP 重新开放的规则？ | 本 Issue 主要不涉及（属 #109）；但若 gap 驱动新检索，则"已 SATURATED 后能否再进一轮"由本 seam 决定 ⇒ 与 #109 共享同一 AIXT decision。 |

**AUTHORITY**

| 项 | 回答 |
|---|---|
| semantic owner | LLM proposal（gap 诊断语义）= 允许 |
| identity owner | controller（canonical source identity / planHash 不变） |
| persistence owner | **UNKNOWN**（取决于 derived vs canonical 决策） |
| retry / resume owner | **UNKNOWN**（需扩展 p1-reuse-closure 绑定） |
| budget owner | **UNKNOWN**（cost 预算 controller 不存在） |
| STOP / transition authority | **UNKNOWN**（取决于是否允许 SATURATED 后重入） |

四个 UNKNOWN ⇒ 该 Issue **不得**进入 Ticket decomposition。

**SEAM（半成品 —— 正因为空缺才被阻塞）**

```text
PRODUCER   = UNKNOWN（claim/coverage analyzer? g controller diagnostics?）
CONSUMER   = runRetrievalFeedbackLoop（round extension）
INPUT      = UNKNOWN（gap object 是否为 canonical state?）
OUTPUT     = new channels / new candidates → existing accumulated pool
SYNC/ASYNC = UNKNOWN（round 内同步? anchor round 后异步?）
FAILURE SEMANTICS = 未定义（gap → provider failure → 是否等同 round failure?）
LEGAL/ILLEGAL STATES = 未定义（尤ookup SATURATED-after-revoke）
FAIL OPEN / FAIL CLOSED = 必须 FAIL_CLOSED（现有所有 seam 均 FAIL_CLOSED）
PRODUCTION_CALLER = UNKNOWN（谁允许抬起一轮？）
TEST_CALLER = UNKNOWN
OBSERVABLE_PRODUCT_EFFECT = 会改变最终 selection / claims / synthesis ⇒ 直接可见，**非旁路**
```

**<ADR 判断> —— 本报告与 Issue 预期的一处刻意分歧**

Issue §6 预期 #108 "最可能需要 ADR + Seam Map + Spec"。我的结论：

- **决策本身确实必须冻结**（未来 Agent 不得自行重选：derived vs canonical、planHash 绑定策略、重入模型、cost 预算归属）。
- **但本仓库没有 ADR 机制**，且**无需为它新建 ADR 机制**：`docs/architecture/key-decisions.md` 已用"问题 → 决策 → 为什么 → 代价 → 演进"沉淀了同级决策（D02 controller-owns-truth、D03 canonical raw、D09 manifest derived、D10 single-writer）。
- 新建一个 ADR 目录/模板/命名约定 = **新的 governance surface**，按 RULES §9/§15 本身就需要 Contract + Consistency 双 reviewer quorum，而这恰恰是"为形式主义增加治理面"。
- 因此：**NO_NEW_ADR**，决策冻结的最小载体 = 现有 `key-decisions.md` 条目 + seam map/contract 条目。
- 若 product owner 明确要求引入正式 ADR 制度，这应当作为**独立的 governance 决策**处理，不应被 #108 夹带。

```text
ADR_REQUIRED = NO（在"新建 ADR 机制"意义上）
               —— 但"决策冻结"本身必需，落点在现有 key-decisions.md
SEAM_MAP_REQUIRED = YES
SPEC_REQUIRED = YES（amend docs/specs/p1-cross-question-deep-research.md，不新建 Spec）
```

**ANTI-OVERENGINEERING**

- VALUE × EVIDENCE × SYSTEM_FIT ÷ COMPLEXITY：VALUE 高，**EVIDENCE 低**（无证据表明 gap 真实发生 / MVP 三类型能覆盖真实失败），COMPLEXITY **高**（触碰 canonical state + identity + recovery + budget）。
- **SMALLER_MECHANISM_TEST = YES**：存在明显的 20%→80% 更小设计 —— **离线 gap 诊断器（report-only）**：用既有 `per-group-claims.json` + `coverage-state.json` 确定性诊断三类 MVP gap（ASPECT / CONTRADICTION / AUTHORITY），**不触发任何检索**。它回答最高价值的前置问题："gap 能否被确定性诊断？三类是否覆盖了真实失败？" ——而这正是 #108 全链路成立的前提。成本：不改 seam、不改 planHash、不改 recovery、不定 budget owner。
- **DESIGN_CONSUMPTION_RULE**：在"在线定向检索"被 evidence 支持前，**只消费离线诊断部分**。

```text
SMALLEST_VALID_NEXT_STEP =
(a) 先做 offline gap diagnosis report-only 实验（需要 #107 或等价ienne /label，但不触碰生产）；
(b) 同步进行：就 4 个 blocking decision 产出 architecture decision record
    + 补充 round-extension seam map/contract
    + amend P1 semantic authority。

NEXT_GATE = C. NEEDS_ARCHITECTURE_DECISION
prerequisite = ADR-in-substance decision record（Existing key-decisions.md）
             + Seam Map + Seam Contract
             + Approved Spec amendment（现有 P1 Spec，不新建）
额外说明：它同时**evaluation-gated**（Issue 自身声明 EVALUATION_DEPENDENCY = #107），
但那是"生产提升"的门槛，不是"架构就绪"的门槛 —— 架构决策可与 #107 实验并行。
```

---

### #109 — Pre-stop Escape Probe

```text
CURRENT_INTENT =
在"即将因 saturation/低边际增益而 STOP"之前，做一次 bounded 的 deliberate challenge。
一次受限挑战（bounded challenge），不是新检索子系统。

CURRENT_SYSTEM_TOUCHPOINT =
lib/retrieval-round-controller.mjs evaluateRetrievalRound 返回 SATURATED
→ runRetrievalFeedbackLoop 返回 → 后续 Selection/Multi-group/RCE/Analysis/Synthesis
即：STOP boundary 位于 "SATURATED decision → 后续阶段" 之间

REAL_EXISTING_SEAM =
- 代码已存在 SATURATION_SEMANTICS_DISCLAIMER（明示 saturation ≠ global completeness）
  ⇒ Issue §1 的语义前提已被代码承认
- 但：**无** STOP_CANDIDATE 对象；**无** "STOP 后可重开" 路径

NEW_SEAM_REQUIRED = UNKNOWN-as-of-today → 取决于 #108
（Issue §6 明确要求"escape probe 复用 #108 的 retrieval 执行与 lineage primitive"，
而"禁止第二套 retrieval subsystem"。在 #108 seam 存在之前，#109 只有三个选择：
 1) 自建 primitive（被自己的 Non-goals 与用户合同明令禁止）
 2) 等 #108 seam（推荐）
 3) 只做 mock/离线 policy（见更小机制））
```

**Grill 结果**

| 问 | 答案 |
|---|---|
| 在哪个 STOP boundary 插入？ | 明确：`DECISION_SATURATED` 产出后、CoverageState 最终化前。不得插入 `PROVIDER_FAILURE` / `BUDGET_STOP` / 硬失败路径（Issue §4 已给 6 类 SHOULD NOT run）。 |
| 谁产生 STOP_CANDIDATE？ | `evaluateRetrievalRound`；但当前只有 decision + stopReason，**无对象化 STOP_CANDIDATE id** → 需新增（小），并由 #108 seam 归属统一处理。 |
| 是否复用 #108 primitive？ | **必须**（Issue §6）。⇒ 依赖成立。 |
| 谁判断 material gain？ | controller。**material-gain truth 不得属 LLM**（Issue §5 已列 MUST NOT）。判定信号（new aspect / new claim cluster / new contradiction / ...）需确定性化，当前**未定义**。 |
| probe 后 STOP 还是 RESUME？ | 需显式 transition rule：`material gain → revoke stop candidate 并回到既有流程`；`low gain → 保持 STOP，携带 probe 证据`。**当前无任何 reopen 路径**，属新增 transition authority。 |
| 是否新增 state？ | 是（probe record + material-gain assessment；可能需 STOP_CANDIDATE id）。规模小于 #108，但类别相同 ⇒ 建议与 #108 用同一 owner/state 决策包处理，避免双份。 |
| crash / resume？ | 需绑定既有 `CHECKPOINT_BINDING_*`（与 #108 同集合扩展）；Issue §10 已列"resume/restart 不得 replay 已付费 probe"。 |
| 是否创建第二套检索子系统？ | 禁止。这正是推荐等待 #108 的根据。 |

**AUTHORITY**：全部继承 #108 的 owner 决策（semantic owner 仍为 LLM proposal；STOP authority 仍属 controller，不因 probe 转移）。单独回答会与 #108 冲突 ⇒ 一并冻结。

**ANTI-OVERENGINEERING**

- 7 个 probe families 是 design map；MVP 只需 3 个 intents（counterargument / alternative terminology / missing stakeholder）× 1 轮。
- **SMALLER_MECHANISM_TEST = YES**：可用冻结 `accumulated-pool.json` 做**离线 false-saturation 政策研究**（"当时若触发 probe，三类 intent 会命中什么？"），并入 #107 的 case 集；这不需要任何新 seam。
- OVERENGINEERING_RISK：**MEDIUM**（若不等 #108 而自建 primitive，则升 HIGH）。

```text
SMALLEST_VALID_NEXT_STEP =
(a) 今日可行：把"local saturation cost"作为 #107 harness 的一个metric 面（离线，用冻结池 + hidden targets）；
(b) #108 seam/owner 冻结后：在此 seam 上定义 probe policy + STOP transition rule（继承 #108 的 authority record，无需独立 ADR）。

NEXT_GATE = H. BLOCKED_BY_OTHER_P2  （被 #108 阻塞）
```

---

### #110 — Adaptive Research Planner

```text
CURRENT_INTENT = 产品方向与设计包络，明确 DESIGN_ONLY。
CURRENT_SYSTEM_TOUCHPOINT = 未来：在 planner 之上加一层 next-action proposal layer。
REAL_EXISTING_SEAM = 现有 planner（lib/planner.mjs T18）产出一次性静态 plan
                     （queryVariants/aspects/entities/opposingFramings/terminologyVariants/sourceGroupIntents），
                     持久化后 planHash 绑定全链路。
NEW_SEAM_REQUIRED = 尚不可判定（promotion gate 未满足）
ADR_REQUIRED = NO   SPEC_REQUIRED = NO   EXPERIMENT_FIRST = NO
```

**是否存在与现有 P1/P2 authority 冲突？—— 结论：目前无（另有 2 处需盯）**

| 检查项 | 结论 |
|---|---|
| LLM vs controller 边界 | **一致**：Issue §6 的 MUST NOT 清单与 `key-decisions D02` / `research-orchestration-scope §11` 一致（model = semantic proposal，controller = canonical authority）。 |
| 是否偷偷重写 plan 所有权 | **需盯**：现有 plan 是**一次性冻结事实**，planHash 绑定下游一切。若 Adaptive Planner 变成"反复修改 plan"的层，将与"单遍无环收敛序 + planHash 身份"冲突。Issue 当前表述为"propose next action"，不是改 plan ⇒ 当前无冲突，promotion 时必须重新裁决。 |
| STOP 权威 | Issue 允许 `PROPOSE_STOP` 作为 proposal ⇒ 不夺 controller 权威，OK。 |
| 是否要 impact #53/#54 历史 | 否；#110 自身无 historical predecessor，未重写 P1 历史。 |

```text
OPEN_DECISIONS = （全部属于 promotion gate 之后，现在不必答）
· action vocabulary 是否真的需要一个轮次驱动的 state machine？
· planner state machine 与现有"严格单遍无环收敛序"如何共存？
· plan 是否会被 revision？planHash 语义如何演化？

OVERENGINEERING_RISK = 若现在解冻 → HIGH；保持 DESIGN_ONLY → LOW
NEXT_GATE = G. DESIGN_ONLY
硬约束：不得推进 Spec / Ticket；不得仅因为设计写得完整而开工。
```

---

### #111 — Source Authority & Evidence Quality Hierarchy

```text
CURRENT_INTENT = lightweight MVP：把"普通观点"与"明显更强的证据"区分开。
CURRENT_SYSTEM_TOUCHPOINT = 取决于消费点：
  (a) claim layer（per-group-claims.json / SEAM C）  ← 影响面大
  (b) selector（RCE input：denseSignals / rce-input-adapter）  ← 影响 canonical selection identity
  (c) 仅后置分析信号（off-path derived metadata）  ← 影响面最小
REAL_EXISTING_SEAM = SEAM C（claims per group，frozen kinds）+ SEAM B selection artifacts
NEW_SEAM_REQUIRED = NO（若 derived） / YES（若进 claim layer 或 selector）
```

**关键判断：derived metadata 还是 canonical evidence state？**

| 变体 | 证据 / 影响 | 判定 |
|---|---|---|
| **(c) derived metadata（推荐起手）** | 由既有产物离线派生，写入**独立 evidence-quality artifact**，仅供 reporting / #108 authority-gap 信号。不改 SEAM C/B，不改 `selectedCorpusIdentity`，不改 100% coverage 断言，不改 discovery hashes。 | **READY_FOR_EXPERIMENT** |
| **(a) 进 claim layer** | SEAM C 的 claim kinds 是 frozen contract ⇒ 需版本/结构变更 + T13 owner 参与；且"证据类别"本身是语义判断（model proposal），放进 canonical claim artifact 需要与现有"controller 拥有 verification truth"边界做裁决。 | 需先决 Architecture Decision |
| **(b) 进 selector** | RCE `selectResearchCorpus` 的 denseSignals 是注入参数 ⇒ 技术上可注入；但会改变 `selectedCorpusIdentity` ⇒ 影响 selection accounting、CoverageState `updateSelectionAccounting(T12)`、resume 绑定、100% analysis coverage 双保险。 | 需先决 Architecture Decision + Seam Map |

**AUTHORITY（MVP derived 变体）**

| 项 | 回答 |
|---|---|
| semantic owner | LLM 可**提议** evidence class / claim relation（属 semantic judgment） |
| identity owner | controller（`canonicalSourceId` 既有 owner 不变；external cited evidence 的 identity/provenance 也归 controller） |
| persistence owner | 独立 evidence-quality artifact owner（新，但**非 canonical**） |
| retry / resume owner | 无 resume 语义（每轮重算或缓存命中判定） |
| budget owner | 无（不触发 provider/检索预算扩展） |
| STOP / transition authority | 无（不持有任何 STOP 权限） |

注意：**Issue §10 安全边界可直接复用**现有 untrusted external content 边界合同（untrusted external content = data，非 instruction），无需新建。

**ANTI-OVERENGINEERING**

- MVP 严格 4 类（PRIMARY / EXPERT_ANALYSIS / FIRST_HAND / OPINION）× 4 关系（DIRECT_SUPPORT / INDIRECT_SUPPORT / CONTRADICTORY / UNKNOWN）；**全文 8 类 / 7 维 / 12 维质量 vector 是 design map，属 deferred**。
- 明确禁止初版做：methodological scoring、COI scoring、citation dependency graph、global expertise model、learned ranking、"truth score"。
- **SMALLER_MECHANISM_TEST = YES**：先只做 **derived + report-only**，回答"这 4 类 + 4 关系是否足以把 strong claim evidence 从 ordinary opinion 里分出来？" —— 这不需要碰任何 seam。
- OVERENGINEERING_RISK：**MEDIUM**（若直取 selector/claim 集成）→ **LOW**（derived 变体）。

```text
OPEN_DECISIONS =
1) external cited evidence 的独立 identity/provenance 如何绑定？（Issue §9）——MVP 可 deferred
2) corroboration / independence：用什么 deterministic signal 区分"重复同源"与"独立佐证"？
   MVP 可只做 UNKNOWN，但必须**不假装有信号**。

AUTHORITY_GAPS = （derived 变体下）无；
                 （claim/selector 变体下）persistence owner / selection identity owner / T13 边界均为 UNKNOWN。

SMALLEST_VALID_NEXT_STEP =
以 granted 的形式实现 derived evidence-quality labeling：
专为既有 artifact 打 4 类 + 4 关系标签 → 独立产物 → 用 #107 评估是否有用。
明确记录：本阶段**不被** selector 或 claim artifact 消费。

NEXT_GATE = A. READY_FOR_EXPERIMENT
强约束：一旦要进入 claim layer 或 selector，立即转为 C. NEEDS_ARCHITECTURE_DECISION + Seam Map。
```

---

### #112 — Retrieval Signal Complementarity Experiment

```text
CURRENT_INTENT = 一个**最小因果实验**：E0（现 P1 基线）vs E1（便宜的确定性 lexical rescue）+ E1-D（分布/分歧诊断）。
CURRENT_SYSTEM_TOUCHPOINT = 冻结的 Candidate Pool（retrieval-rounds/accumulated-pool.json）
                            + RCE selector 的注入式 denseSignals 接口
REAL_EXISTING_SEAM = accumulated-pool artifact + rce-corpus-selector 的参数化 signals 输入
                     （两者都是现有 seam，无需新增）
NEW_SEAM_REQUIRED = NO
ADR_REQUIRED = NO
SPEC_REQUIRED = NO
```

**能否完全旁路 production？—— 能。证据：**

1. `retrieval-rounds/accumulated-pool.json` 是**已持久化**的跨轮候选产物（`ACCUMULATED_POOL_FILENAME`，由 `coverage-final-integration.mjs:449-450` 写出） ⇒ 可"frozen candidate pool"读取。
2. `selectResearchCorpus({ manifest, sourcesByGroup, denseSignals, densePairwise, options })`（`rce-corpus-selector.mjs:354-363`）的 **signals 是注入参数** ⇒ 可在**不改 selector 本体**的前提下，离线读取冻结的 `manifest` + `sourcesByGroup` + `accumulated-pool`，只替换注入的 signals，比较选择结果.
3. embedding cache 已存在（`embedding-cache.test.mjs`）且按 identity 复用 ⇒ E0/E1 的 cost/latency 对比有现成的身份边界参照。
4. Issue §23 要求的"no silent fallback"在实验里是**实验内部规则**，不需上升为生产 authority。

```text
PRODUCTION_MUTATION = NONE
P1_BEHAVIOR_CHANGE  = NONE
PRODUCTION_CALLER   = NONE
TEST_CALLER         = 实验 runner（离线；或登记为 full-offline / live-gated suite）
OBSERVABLE_PRODUCT_EFFECT = NONE
```

| 必需确认项 | 结论 |
|---|---|
| 是否需要 BM25 / FTS / vector DB / index service？ | **NO**。E1 只需 EXACT_PHRASE / ENTITY_MATCH / IDENTIFIER_MATCH / VERSION-NUMBER_MATCH / RARE_TOKEN / TITLE_MATCH 这类廉价确定性信号。 |
| E2 / E3 现在可否推进？ | **NO**。Issue §21 明确：只有 E1 产生可重复的物质价值后才可提出 E2（BM25/FTS）；只有选择级实验证明"候选发现"受限后才可提出 E3（新 candidate-generation channel）。 |
| 是否需要钩子测量？ | 是 —— 但可用 #107 MVP case set；在 #107 落地前，E1-D（通道分歧诊断）**今日即可用冻结池开工**，零新 authority。 |
| cache / index staleness 怎么办？ | 实验内部按 Issue §12/§13 的 identity 契约处理（`INDEX_IDENTITY_MISMATCH → FAIL / REBUILD / EXPLICIT DEGRADE`），**不上升为生产策略**。 |

**ANTI-OVERENGINEERING**

- 该 Issue 全文 1200+ 行是 design/threat map，**不是** implementation checklist。判定依据：`CURRENT_IMPLEMENTATION_SCOPE = MINIMAL_CAUSAL_EXPERIMENT_ONLY`。
- **SMALLER_MECHANISM_TEST = YES**：全文最小标注路径就是 E0 vs E1 + E1-D —— 该 Issue 的 Delivery Boundary 已经自己做完这一步，无需再压。
- OVERENGINEERING_RISK：**LOW**（只要严格遵守 E0/E1 边界）→ 若滑向"顺手接 BM25 / 建 index lifecycle / 引入 vector DB"则升 **HIGH**。
- **DESIGN_CONSUMPTION_RULE**：不得把实验结果预设为 PASS；`UNKNOWN != PASS`。

```text
SMALLEST_VALID_NEXT_STEP =
取若干真实 P1 run 的冻结 accumulated-pool，在其上跑：
E0 = 现有 signals → selectResearchCorpus → selected set
E1 = 现有 signals + deterministic lexical rescue → selected set
E1-D = provider / lexical / dense 三方重叠 + 分歧 + unique important hits（diagnostic only）
输出对比产物；不写产品代码。

NEXT_GATE = A. READY_FOR_EXPERIMENT
前置（scheduling，非 gate）：#107 MVP case set（或等价的、独立可评审的最小 5-case 标注）
补充注意：E1-D 不依赖 #107，可先行。
```

---

## 4. CROSS-ISSUE SEAM MAP（#107–#112 与当前 P1 的关系）

```
                  ┌────────────── PRODUCTION CANONICAL PATH (P1) ──────────────┐
                  │                                                            │
  Planner ─► Retrieval rounds ─► provider rankings ─► RRF ─► Candidate Pool    │
  (T18)        (round ctrl)       (provider-seam)      (rrf)   (accumulated)   │
                  │                                          │                 │
                  │                                          ▼                 │
                  │                                   Dense Geometry           │
                  │                                   (relevance/novelty/      │
                  │                                    redundancy)             │
                  │                                          │                 │
                  │                                          ▼                 │
                  │                                   RCE Selector ──► SEAM B  │
                  │                                                            │
                  ├─► CoverageState ◄──── Analysis (SEAM C) ◄──────────────────┤
                  │     (canonical,          claims / extraction               │
                  │      ownership-pinned)        │                            │
                  │                               ▼                            │
                  └─► STOP (CONTINUE / SATURATED / BUDGET_STOP / PROVIDER_FAIL)│
                                     │           ▼                             │
                                     │   Synthesis (SEAM D V2) ─► coverage-final
                                     │                                         │
                                     └──► v0.3 render (planHash-bound)          │
                                                                               │
                  └───────────────────────────────────────────────────────────┘

  ── OFF-PATH / READ-ONLY (today, zero production mutation) ──────────────────
   #107  Evaluation Harness ...... 只读消费所有上游产物 → eval artifacts
                                   (isolated eval dir；read-only)
   #112  E0/E1/E1-D experiment ... 只读冻结 Candidate Pool → 只替换注入的 signals
                                   → 比较 selection 输出；SELECTOR 本体不改
   #111  derived variant ......... 只读 claims/coverage → 独立 evidence-quality artifact
                                   (report-only；不进 claim/selector)
   #109  cheaper evidence step ... 冻结池上的 false-saturation / material-gain 政策研究
                                   (并入 #107 harness)
   #108  smaller mechanism ....... 离线 gap diagnosis (report-only, no retrieval)

  ── REQUIRES NEW AUTHORITY (not today) ───────────────────────────────────────
   #108 round-extension seam ───► 插入 Retrieval rounds
                                  (触碰：planHash 绑定 / CoverageState owner
                                        / budget owner / recovery binding)
        ⚠ NEW SEAM + DECISION RECORD + SEAM CONTRACT + SPEC AMENDMENT
   #109 stop-boundary policy ───► 插入 STOP (SATURATED → decision) 之后
                                  (必须复用 #108 primitive ⇒ BLOCKED BY #108)

  ── FUTURE ONLY (do not draw into current production) ───────────────────────
   #110 Adaptive Planner ........ 虚线：未来可能位于 Planner 之上
                                  DESIGN_ONLY；不进当前 production 图
```

---

## 5. ARCHITECTURE_WORK_REQUIRED 汇总

| Issue | ADR | Seam Map | Seam Contract | Spec | 备注 |
|---|---|---|---|---|---|
| #107 | NO | NO | 最小只读消费面约定 | NO | CI suite 须登记（现有机制） |
| #108 | 决策冻结必需 —— **载体 = 现有 key-decisions.md，不新建 ADR 机制** | **YES** | **YES**（PRODUCER/CONSUMER/FAIL_CLOSED/ recovery binding） | **YES**（amend 现有 P1 semantic authority；非新 Spec） | 4 个 UNKNOWN owner 问题必须先解 |
| #109 | 继承 #108 | 继承 #108 | 继承 #108 + STOP transition 条款 | 继承 #108 | 前提是 #108 seam 存在 |
| #110 | NO | NO | NO | NO | DESIGN_ONLY |
| #111 | NO（derived 变体） | 仅 claim/selector 变体需要 | 同左 | 同左 | 一旦要消费 → 触发 C 类重审 |
| #112 | NO | NO | NO（实验内部规则） | NO | 同上 |

---

## 6. 实验准备建议（针对 READY_FOR_EXPERIMENT 三张票；另含 #108/#109 的更小机制建议；均不施工）

**共同前置条件（必须先满足，否则实验结论不可信）：**

1. 明确 `PRODUCTION_MUTATION = NONE` 并可在事后机器验证（worktree clean / 产品产物 hash 不变）。
2. 实验产物**不进 product workDir**：独立输出目录 + 独立 suite 登记。
3. identity binding 复用既有事实：`runIdentityHash` / `planHash` / 逐产物 sha256；外加 `benchmark_version`。
4. `UNKNOWN != PASS`：无信号的度量必须输出 UNKNOWN，禁止造数。
5. 结论不得升级为 universal claim（跨域、跨专家、所谓"普适质量提升"）。

**#107**：先做 5 case / 4 度量 / 单次 baseline vs candidate；明确 hidden targets 隔离规则；套件归类建议 `live-gated`，deterministic 子集另登记。
**#112**：先在冻结 `accumulated-pool.json` 上做 **E1-D 分歧诊断**（今日零新 authority）；完整 E0/E1 需 #107 MVP case set 或等价最小标注。
**#111 (derived)**：只读 claims/coverage → 独立 artifact，严禁被 selector/claim 消费，直到走完决策门。
**#108 (smaller mechanism)**：离线 gap diagnosis report-only，回答"gap 可否确定性诊断"这一最高价值前置问题。
**#109 (cheaper evidence)**：并入 #107 harness 的 false-saturation 面。

---

## 7. 后续：独立 CODEX 验收

本审计的结论须交由 fresh Codex reviewer 在**同一 exact SHA**上做独立只读验收。要求核对：

1. 是否漏 seam / ADR / owner / production caller；
2. 是否发生过度工程化；
3. 是否错误推进 #110 / #112；
4. 是否把 grill 当 architect；
5. NEXT_GATE 是否有证据支持。

结论见：`CODEX_FINAL_VERDICT.md`。

---

*本审计为只读架构就绪评估：未写产品代码、未修改产品行为、未创建 PR、未拆实施票、未修改 P1 历史事实、未预判实验结果为 PASS。*

---

## 8. 独立验收结果与采纳情况

| 项 | 值 |
|---|---|
| REVIEWER_ROUTE | INTERNAL_INDEPENDENT_REVIEWER（Codex 外部路由被账户用量上限阻断至 13:15，两次尝试均失败 → 属 `PERMISSION_OR_TOOL_FAILURE` 外部 gate） |
| REVIEWED_SHA | `9c60ae56610498f1cf782c0c36bfc9f8c0642051`，与 AUDIT_BASE_SHA 一致 |
| REMOTE_MASTER_AT_END | 同上 ⇒ REMOTE_MASTER_CHANGED = NO |
| VERDICT | **PASS_WITH_NONBLOCKING_FINDINGS** |
| 六张票 NEXT_GATE | 全部 **AGREE** |
| SPOT_CHECK | 12 项代码级关键声称全部 CONFIRMED（含 line 级证据） |
| OVERENGINEERING_CHECK | NO |
| wrongful_promotion_110 / 112 | NO / NO |
| GRILL_AS_ARCHITECT | NO |

**采纳的 P2 finding（不阻塞，不改变 NEXT_GATE）：**

1. **#112 证据引用补全**（已合回本节之上）：`PRODUCTION_MUTATION = NONE` 的可行性现在显式引用 `rce-corpus-selector.mjs:354-363` 的四个入参与 `coverage-final-integration.mjs:449-450` 的池持久化位置，并把"离线还需读冻结的 `manifest` + `sourcesByGroup`"写进实验步骤。
2. **仓库级——没有 evaluation / experiment lane，也没有"何时可以消费一个设计"的规则**：验收确认这是真实治理缺口，但**不构成 A 类实验的阻塞**（实验本身不需要消费规则）。按验收建议，这条应走**独立 governance 决策**，不得夹带进 #108。
3. **#108 的"不新建 ADR 机制、复用 key-decisions.md"本身是一个替 product owner 做的治理选择**：证据支持它是可辩护的（仓库无 ADR 制度，同级决策已有先例），但**需要 product owner 确认**。若确要正式 ADR 制度，应作为独立 governance 票处理，不在 #108 内解决。

**未修改的部分**：六张票的 NEXT_GATE、#108 的四个 UNKNOWN owner 问题、#110 的 DESIGN_ONLY 判定、#111 的 derived 限定，均维持原结论。

完整验收记录见：`INDEPENDENT_REVIEW_VERDICT.md`。
