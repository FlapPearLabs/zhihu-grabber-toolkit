# P1 Implementation Planning Gate 01 — OPEN_DECISION Classification & Ticketing Readiness

```text
DOCUMENT_ID = P1_IMPLEMENTATION_PLANNING_GATE_01
STATUS = REVIEW_PENDING
AUTHORITY_CLASS = NON_AUTHORITATIVE_PLANNING_CANDIDATE
REVIEWER = ChatGPT（外部独立 reviewer；本轮不 spawn 任何内置 reviewer subagent）
BASE_SHA = 279caf6141c26a38cf4a449b2b4cfbeba4357577（latest remote master，已 fetch 验证）
BRANCH = planning/p1-implementation-gate-01
SCOPE = 仅新增本文件与配套 REVIEW PACKET；不修改任何 Approved Spec / 治理文件 / 生产代码
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
Date: 2026-08-28
```

本文件是 **planning candidate，不是 authority**。它不授权生产实现、不拆 Ticket、不创建 Issue、
不修改 Approved Spec。即使 TICKETING_READY = YES，其唯一含义是：允许进入
P1 Ticket Decomposition 这一 **planning stage**；`IMPLEMENTATION_AUTHORIZATION` 保持 `NONE`。

---

## A. Remote / Authority Baseline

`git fetch origin` 已执行（走本地代理），以下全部以 fetch 后的 remote truth 为准。

```text
REMOTE_BASE_VERIFIED = YES
origin/master = 279caf6141c26a38cf4a449b2b4cfbeba4357577
REVIEWED_CANDIDATE_BRANCH origin/spec/p1-cross-question-research-approved-candidate = 279caf6（与 master 同 SHA → ff-only merge 证据）
ANCESTRY: 84534f5（前一 master tip，README v0.3）→ ce3cbe0（promote P1 spec candidate）→ 279caf6（repair per CONTRACT review R1）→ master tip
REMOTE_TIP == BASE_SHA == 279caf6141c26a38cf4a449b2b4cfbeba4357577
CONTRACT_DRIFT = NONE
```

P1 Approved Spec 生效状态核验：

- Spec 文件存在于 `docs/specs/p1-cross-question-deep-research.md`，在 `279caf6` 进入 remote master；
- Spec header 静态保留 `PRE_EFFECTIVE_STATUS = REVIEW_PENDING` —— 这是 conditional lifecycle 的
  **设计结果**（"永不要求 post-review STATUS edit"），**不构成** Spec 未获批的证据；
- 真实 approval 依据五条件序列（CONTRACT PASS + CONSISTENCY PASS on exact HEAD + legal ancestry +
  ff-only merge + remote re-fetch verify）。本轮机械化验证了其中三条（ancestry ✓ / ff-only ✓ /
  remote verify ✓）；**双 reviewer PASS 记录保存在外部审查会话（ChatGPT governance review），
  repo 端仅以 promote / repair commit 形式留痕**。该两条 PASS 的存在性列入 REVIEW PACKET
  "Exact questions for ChatGPT"，请独立 reviewer 一并确认。
- 本轮**未**为修改该静态字段而 amendment Approved Spec（遵守任务指令与 RULES §6.5）。

远端新出现的其他分支（`audit/claude-external-review-2026-08-27`、`dg01-decision-grade-gate`、
`spec/p1-architecture-spec-prep-01` 等）均为审查树 / 历史 audit 分支，**不属于本轮 scope**，
不导入、不清理、不依赖其本地副本。

已读取的 authority 文件（全部完整读取）：

- `RULES.md`
- `AGENTS.md`
- `docs/project-memory.md`（+ `docs/project-memory/decision-boundary-matrix.md` 参照）
- `docs/specs/p1-cross-question-deep-research.md`（本轮 subject Spec）
- `docs/specs/research-orchestration-scope.md`（P1 父级合同）
- `docs/specs/v0.3-product-scope.md`（§ 目录 + 决策 A–D / §7 四层能力 / §9 Non-goals）
- `docs/specs/v2-rich-content-fidelity.md`（baseline：canonical / projection isolation / capability isolation / trust boundary）
- `docs/product-behavior-contract.md`（§ 目录 + 3.14 credential boundary / 3.15–3.18 V0.3 归一化）
- `docs/architecture/runtime-strategy.md`（ACCEPTED ARCHITECTURE RECORD，全读）

## B. Current production seam summary（实测，非 Spec 猜测）

**research-orchestration/**（MVP 已实现，#30 merged @ a9dcd4f）：

- `bin/research.mjs` thin controller；`lib/state.mjs` 单问题线性状态机
  `SEARCH→SELECT→CAPTURE→VERIFY→HANDOFF→ANALYZE→RENDER→COMPLETE/FAILED`（`STATE_SCHEMA_VERSION=1`，
  `selectedQuestionId` 单值）；`validateCheckpoint()` 已实现 stage-artifact hash 校验
  （`FILE EXISTS != VALID CACHE` 语义已存在，可被 multi-group 复用/扩展）。
- 候选选择：确定性词法相关性（`lib/selection.mjs`）；意图分类：decision-boundary matrix（`lib/intent.mjs`）。
- **没有任何 multi-group / planner / RRF / embedding 代码。**

**zhihu-answer-grabber/**：

- `src/official.js`：`searchQuestions(keyword, secret)` —— 官方开放平台唯一已实现 capability
  （源码注释明示"平台无按问题列回答接口"）；Bearer secret（`zhihu_secret.txt`），429/5xx 退避重试。
- `src/grabber.js grabAll()`：Session/Cookie（`z_c0`/`d_c0`，zhihu-cli login 或 `ZHIHU_COOKIE`）单问题
  pagination capture；`src/verifier.js` 14 项校验 = 唯一 validity authority；`scripts/make-handoff.mjs`
  唯一 handoff 权威。
- `src/search-answer-count.js`：bounded question-info enrichment（V0.3 决策 A）。
- **全仓库（zhihu/corpus/research 三包）无任何 OAuth 代码** —— OAuth 纯属未来 provider 能力。

**corpus-anthology/**：

- `scripts/`：archive / popular-sample / select（T8 top-percent selector）/ chunk / map / verify /
  reduce / render-final / stats / preflight-* / qualify-*；`lib/hierarchy.mjs`（T10 hierarchical full digest）。
- `scripts/map.mjs resolveMapRuntime()`：additive runtime 路由，仅 `lmstudio-local-tool-less`（默认）与
  `deepseek-api-tool-less`，其余 → `capability_isolation_unavailable` fail closed；节点身份反映真实传输。
- `lib/deepseek-tool-less.mjs`：endpoint 固定校验 `https://api.deepseek.com/chat/completions`；
  `preflight-deepseek.mjs` 仅输出布尔凭据状态（RULES §1 合规模式，可作为未来 EmbeddingProvider
  preflight 的先例模式）。

**关键否定性事实**：

1. 全仓库无任何 embedding / dense / vector 代码 —— EmbeddingProvider 是 greenfield；
2. `bge-small-zh-v1.5` 不出现在任何 tracked authority / 生产文件中（仅存在于未导入 master 的
   external-audit 审查树）—— **Evidence Gate 用过它 != production model approved**；
3. 无 OAuth；无 browser-scraping 实现新增；无第二个 canonical content store；
4. SemanticRuntime 公开知乎默认 = `deepseek-api-tool-less`（Approved，R5），不再 OPEN。

## C. D-1…D-9 classification table

每项归入且仅归入一个 PRIMARY_CLASS：

```text
A = MUST_RESOLVE_BEFORE_TICKETING
B = REQUIRES_SEPARATE_DISCOVERY_OR_QUALIFICATION
C = CAN_DELEGATE_TO_IMPLEMENTATION_TICKET
D = DEFER_FROM_V1
```

| ID | Decision | PRIMARY_CLASS | Blocking relationship |
|---|---|---|---|
| D-1 | production EmbeddingProvider / model | **B**（Discovery/Qualification） | BLOCKS：dense-layer / EmbeddingProvider adapter **实现**；NOT blocking：ticket decomposition |
| D-2 | ZhihuDataProvider exact capability routing / priority | **C**（第一条 critical path 的 adapter 委派） | additional capabilities → 按需 capability-scoped Discovery（lazy B）；NOT blocking ticketing |
| D-3 | Planner persisted schema / validation bounds | **C**（early interface-definition ticket 委派） | plan-contract ticket 必须位于 DAG 前部（interface ticket）；NOT blocking ticketing |
| D-4 | selector relevance/novelty weights + optional redundancy params | **C**（+ `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION`） | 无 blocking；禁止 planning 阶段拍权重 / 重跑 benchmark |
| D-5 | group floor / count / quota / anti-starvation numeric boundary | **C**（invariant-first anti-starvation + 实现验证） | 无 blocking；禁止重新引入 six hard quotas |
| D-6 | saturation thresholds / minimum rounds / budgets | **C**（+ `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION`） | 无 blocking；保持 simple deterministic saturation |
| D-7 | embedding cache/storage profile + public-Zhihu egress route | **C**（cache/storage）+ **B 子门**（egress authority） | egress 子门 BLOCKS **remote** embedding 实现；NOT blocking ticketing |
| D-8 | global quality-score aggregation | **D**（DEFER_FROM_V1 / CLOSED_FOR_V1） | 无 blocking；消除虚假 active blocker |
| D-9 | provider-specific OAuth / Session credential behavior | **D**（DEFER_FROM_V1 + lazy 触发 Discovery） | V1 critical path 无依赖；未来依赖该 provider 的 ticket 触发 scoped Discovery |

```text
MUST_RESOLVE_BEFORE_TICKETING = （空集）
PRE_IMPLEMENTATION_DISCOVERY_GATES = GATE-1（D-1）、GATE-2（D-7 egress 子门）
DELEGATED = D-2（首段）、D-3、D-4、D-5、D-6、D-7（cache/storage）
DEFERRED = D-8、D-9（+ D-2 非首段 capabilities 的 lazy discovery 触发规则）
```

## D. Rationale per decision（六问检验）

六问：①架构形状 ②安全/出网/凭据边界 ③实现 ticket 能否安全自选 ④数值调参 ⑤V1 是否需要 ⑥既有证据是否充分。

### D-1 production EmbeddingProvider / model → B

- ①：**不影响架构形状**。EmbeddingProvider seam contract 已冻结（Spec §5.3：provider/model/
  embedding version/normalization version/cache key/vector result/failure identity/egress policy identity）。
  换哪个 model 不改变 seam。
- ②：**影响 egress 边界**。若选 remote embedding，公开知乎语料内容将出网到 DeepSeek 之外的新第三方 ——
  现有 approved egress 仅限"公开知乎语料 → DeepSeek semantic runtime"（V0.3 T11，runtime-scoped，
  明文不得推广）。该新出网路由需要独立 authority/evidence。若选 local embedding 则无新出网，
  但本地模型对中文 embedding 的质量/身份证据同样缺失。
- ③：**不能**由实现 ticket 拍板。provider 选型牵涉 egress authority + runtime/provider-scoped
  qualification；本仓库既定先例（V0.3 决策 C、T5 系列）要求逐 runtime 独立资格证据，
  `UNKNOWN != PASS`、不得跨 runtime 推导。
- ⑥：既有证据仅覆盖"该类 dense geometry 在 evidence harness 中方向有效"（§12 caveats：
  两真实域案例、harness-relative proxy）。`bge-small-zh-v1.5` 仅是 harness 实验模型，
  任何"直接冻结为 production model"的提议都被拒绝。
- 结论：必须先有**独立的 EmbeddingProvider Qualification Discovery**（GATE-1），输出
  provider category（local vs remote）、capability/quality/identity evidence、egress 路由建议。
  但按任务 §10 的关键区分：**block implementation，not ticket decomposition** —— DAG 中可先拆
  `EmbeddingProvider Qualification → Adapter → Dense Semantic Layer` 依赖链。

### D-2 ZhihuDataProvider capability routing → C（+ lazy B）

- 已冻结不得重开：高层 provider 偏好顺序 official-first / `THIN / ADAPTER_FIRST / REUSE_FIRST`（§5.1）。
- ①：provider seam 最小 contract 已冻结（provider_id / capability / auth_class / candidate identity /
  provenance / completeness status / failure identity）。exact per-capability routing 不改变 seam 形状。
- ⑤：第一条 implementation critical path 真正需要的 capability 只有两个：
  **Official Search**（已实现）与 **Session capture**（已实现 primitive，可被 adapter 包装复用，
  不重定义其 authority）。两者均无新 discovery 需求。
- ③：首段 capability 的 adapter 路由可由实现 ticket 在 seam contract 内安全定义。
- 其余 capability（OAuth / Browser / OSS 等）：采用 **CAPABILITY-BY-CAPABILITY + lazy discovery** ——
  只有当某个具体 future ticket 真正依赖该 capability 时，才为该 capability 开 scoped Discovery。
  不做"一次研究完五类 provider"的大而全 discovery（任务 §7 明确拒绝）。
- 结论：PRIMARY = C；additional capabilities 触发规则 = lazy scoped B。**不阻塞 ticketing。**

### D-3 Planner persisted schema → C（early interface ticket）

- ①：概念字段已冻结（§4.1：query variants / aspects / entities / opposing framings / terminology
  variants / source-group intent）；plan authority 已冻结（persisted、structured-output validated、
  hashed、controller-owned planHash、invalid fail-closed）。缺的只是 exact JSON schema / bounds。
- ③：schema 可由实现 ticket TDD 定义，不改变 Spec 语义 —— 与父级 R6（orchestration state schema
  DELEGATED_IMPLEMENTATION_DESIGN）同构。
- 但 Plan 是 Planner→Retrieval→Selection 多个下游 ticket 的**共享接口**：ticket decomposition 时
  必须把"minimum persisted Plan contract"作为**early interface-definition ticket**排在 DAG 前部，
  下游 ticket 引用它，避免各下游各自发明期望导致接口漂移。这是 DAG 排序约束，不是 pre-ticketing gate。
- 显式拒绝：universal research DSL / 超集 schema 提前设计。

### D-4 selector weights → C（+ DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION）

- ④：数值调参 —— planning 阶段不拍 magic number（任务 §6.4 默认）。
- ①：selector baseline 结构已冻结（Preservation + Popularity Anchor + Dense Relevance/Novelty +
  optional lightweight redundancy）；调权重不改变该结构。
- ③：可由 RCE selector 实现 ticket 在 TDD / implementation validation 中确定，
  并以 Evidence Gate 结果为方向性参考（§12 caveats 必须随行）。
- 显式拒绝：为 planning 重跑 selector benchmark —— 无证据表明 ticket decomposition 被它阻塞。

### D-5 group floor / quota / anti-starvation → C（invariant-first）

- 冻结的是 preservation 语义（§3.1），未冻结的是数值。
- anti-starvation 的正确表达是**接口不变量**而非提前拍数字：
  - 选择输出必须逐组记录 eligible / selected / verified / analyzed 数量与 exclusion reason category；
  - 相关或有 minority 内容的 group 不得在无记录原因的情况下零代表；
  - per-group selection/coverage 必须可测量。
- ④：floor/count/quota 若最终需要具体数值，由实现 ticket 以不变量测试 + implementation validation
  确定（先证明不变量可测试，再看是否还需要额外数值下限）。
- 显式拒绝：six hard quotas / "入组即整组保留" / group 内 top-percent 作为 P1 默认规模控制（§3.1 已排除）。

### D-6 saturation / rounds / budgets → C（+ DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION）

- ④：数值调参；§9 已冻结 saturation 的语义边界（"只能说明当前检索策略下新信息增益趋缓，
  不是全站 coverage proof"）与 simple deterministic saturation baseline。
- ③：thresholds / minimum rounds / query-group budgets 由实现 ticket 在 ResearchCoverageState
  与 retrieval-loop ticket 中以实现验证确定。
- ①：不改 ResearchCoverageState 形状（§9.1–9.4 已冻结最小字段集，含 §9.4 诊断计数）。

### D-7 embedding cache/storage + public-Zhihu egress → C + B 子门（必须拆开）

**(a) CACHE IMPLEMENTATION DETAIL → C**：§5.3 已冻结 cache identity 组成（canonical input hash +
provider/model + embedding version + normalization version），精确 schema/storage delegated。
凭据/credential path 内容永不进入 cache identity（§6.2 已冻结）。**cache schema 未定不阻塞任何事。**

**(b) SECURITY / PUBLIC EGRESS AUTHORITY → B 子门（GATE-2）**：若 D-1 qualification 选出 remote
embedding provider，则公开知乎语料内容将出网到新第三方。现有 approved egress
（公开知乎语料 → DeepSeek）是 runtime-scoped 先例，**不得推广**。该新 egress 路由在实现任何
remote embedding 前必须取得显式 authority（product-owner 批准 + 安全边界记录，参照 R5 egress
边界的批准形态）。若 D-1 选出 local provider，本子门自动满足（无新出网），仍须在 qualification
记录中显式声明"无新增 egress"。

**Blocking relationship：GATE-2 blocks remote-embedding implementation only；不阻塞 ticketing**
（ticket decomposition 可包含该 authority gate 作为 discovery/decision ticket）。

### D-8 global quality-score aggregation → D（DEFER_FROM_V1 / CLOSED_FOR_V1）

- ⑤：V1 不需要。Spec §14 自带 minimum-correct default = 不引入；frozen selector baseline 与
  100% analysis coverage 均不消费 global quality score；§11 已排除 trained LTR / 复杂聚合。
- 维持 OPEN 只会制造虚假 active blocker。建议在 Ticket Decomposition 中**显式记录**
  `D-8 = CLOSED_FOR_V1`（reopen 条件：未来明确产品需求 + 独立 Spec authority），而非保留开放状态。
- ①：推迟无架构代价 —— 它是 additive aggregation 概念，不在任何 critical path 上。

### D-9 OAuth / Session credential behavior → D（lazy 触发 Discovery）

- ⑤：P1 第一版 critical path = Official Search + 既有 Session/Cookie capture primitive，
  **不需要 OAuth**。既有 Session/Cookie 行为已实现且边界冻结（RULES §1、contract §3.14），
  P1 不修改既有 credential boundary（Spec §14 D-9 明示）。
- ②：凭据行为属安全关键面 —— 但需要防的是**新增** provider 的凭据设计，不是既有边界。
  提前设计 OAuth 登录平台 = 为尚不存在的 provider 做超前工程（任务 §7 明确拒绝）。
- 结论：DEFER_FROM_V1；触发规则：任何真正依赖某个具名 provider OAuth/Session 行为的 future ticket，
  必须先为该 provider 跑 capability-scoped Discovery/Qualification（同 V0.3 决策 C 逐 runtime 门控
  先例），才可实现。

## E. Blocking relationships（汇总视图）

```text
TICKET DECOMPOSITION 阻塞物：        无（空集）

IMPLEMENTATION 阻塞物（非 ticketing）：
  GATE-1 (D-1)  EmbeddingProvider Qualification Discovery
                └─ blocks → EmbeddingProvider adapter + Dense Semantic Layer 实现
  GATE-2 (D-7b) public-Zhihu → embedding-provider egress authority
                └─ blocks → 仅 remote embedding 实现（local provider 须显式记录"无新增 egress"）
  GATE-3 (D-2/D-9 lazy) capability-scoped provider discovery
                └─ blocks → 对应 future provider capability 的实现（按需触发）

DAG 排序约束（非阻塞）：
  D-3 minimum persisted Plan contract ticket 必须先于所有消费 plan 的下游 ticket。
```

## F. MINIMUM_IMPLEMENTATION_CRITICAL_PATH（COMPONENT_DEPENDENCY_GRAPH，component level，非 Ticket DAG）

依据真实 repo seams（§B）与 Spec 冻结边界推导；不编号 ticket、不指派 Issue。

```text
[1] Research Plan contract
    persisted plan artifact + structured-output validation + planHash + run identity
    （normalized user request + stable configuration identity；扩展 state.mjs 线性状态机）
      │
      ├──────────────────────────────┐
      ▼                              ▼
[2] ZhihuDataProvider seam     [4] Multi-group execution state
    （adapter-first：              SelectedSourceGroups[] / PerGroupExecutionState /
     Official Search adapter       VerifiedGroupRefs[] / ResearchCorpusManifest
     + Session capture wrapper，   （复用/扩展 validateCheckpoint hash 语义）
     复用既有 primitives，             │
     不重定义其 authority）            ▼
      │                        [5] Per-group capture + verify + handoff composition
      ▼                            （逐组包装既有 grabAll / verifier / make-handoff；
[3] Multi-query retrieval +         composition 只引用已验证 group refs）
    RRF fusion
    （Candidate / Retrieval Pool；      │
     channel = query + provider）       │
      │                                 │
      └──────────┬──────────────────────┘
                 ▼
[GATE-1] EmbeddingProvider Qualification Discovery（D-1；可与 [1]–[5] 并行推进）
    provider category / quality / identity evidence；[GATE-2] egress authority（若 remote）
                 │
                 ▼
[6] EmbeddingProvider adapter + cache
    （§5.3 contract；cache identity 组成已冻结，schema delegated；fail-closed）
                 │
                 ▼
[7] Dense semantic layer
    （relevance / novelty geometry over candidate pool；DENSE unavailable → FAIL_CLOSED）
                 │
                 ▼
[8] RCE selector
    （Preservation + Popularity Anchor + Dense Relevance/Novelty
     + optional lightweight redundancy；逐组 eligible/selected/verified/analyzed
     计量 + exclusion reason；D-4/D-5 不变量在此实现验证）
                 │
                 ▼
[9] Question / Source-group logical representation layer
    （独立于物理 chunk packing；selected/verified/analyzed accounting、
     main/minority/contradictory claims、expert/evidence-rich refs、coverage state）
                 │
                 ▼
[10] Claim / Aspect representation + cross-source synthesis
    （跨 group 聚合 supporting/opposing sources；禁止 flat reduce / naive equal weight；
     SemanticRuntime = deepseek-api-tool-less，Approved policy 不重开）
                 │
                 ▼
[11] ResearchCoverageState + saturation + retrieval rounds
    （retrieval coverage / source completeness / analysis coverage 三覆盖账目；
     simple deterministic saturation；D-6 数值在此实现验证）
                 │
                 ▼
[12] v0.3 final synthesis integration
    （100% analysis coverage assertion 仅当 selected set == analyzed set 机械相等；
     render / observability / mode identity 继承 SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST）
```

依赖要点：

- [GATE-1]（及其 egress 子门 [GATE-2]）与 [1]–[5] **可并行**：dense 层 fail-closed 语义允许
  pipeline 骨架先建，但**完整 P1** 在 dense 可用前不得宣称完成（`DENSE_CAPABILITY_UNAVAILABLE → FAIL_CLOSED`）。
- [2] 的两个首段 adapter 无需新 discovery（两 capability 均已实现，seam 只是新包装）。
- [8] 依赖 [3]+[4]+[7]；[9] 依赖 [8] 的 selected corpus + [5] 的 verified refs；
  [10] 依赖 [9]；[11] 横切 [3]–[8] 的计量并消费于 [8] 的 rounds/stop 与 [12] 的 coverage assertion。
- D-3 的 plan contract ticket = [1]；D-4/D-5/D-6 的实现验证分别在 [8]/[8]/[11]。

## G. Pre-ticket discovery gates

| Gate | 决策来源 | 内容 | 阻塞对象 |
|---|---|---|---|
| GATE-1 | D-1 | EmbeddingProvider Qualification Discovery：provider category（local vs remote）、quality/identity/normalization evidence、failure identity 证据；显式声明 `bge-small-zh-v1.5` 证据仅为 harness 方向性参考 | EmbeddingProvider adapter / Dense layer **实现** |
| GATE-2 | D-7(b) | public-Zhihu corpus → embedding provider egress authority（仅当选 remote）；local 则显式记录"无新增 egress" | remote embedding **实现** |
| GATE-3（lazy） | D-2 / D-9 | capability-scoped provider discovery，仅当某 future ticket 真正依赖该 provider capability 时触发 | 对应 capability 实现 |

GATE-1/GATE-2 可作为 discovery ticket **进入** Ticket Decomposition，不要求在拆 DAG 前完成。

## H. Delegated implementation decisions（汇总）

- **D-2（首段）**：Official Search adapter + Session capture wrapper 的 exact routing；
- **D-3**：minimum persisted Plan schema / validation bounds / planHash 编码（DAG 前部 interface ticket）；
- **D-4**：selector relevance/novelty weights + optional redundancy params（implementation validation）；
- **D-5**：anti-starvation 以可测不变量表达；floor/count/quota 数值（若需要）同上；
- **D-6**：saturation thresholds / minimum rounds / query-group budgets（implementation validation）；
- **D-7(a)**：embedding cache/storage 精确 schema（identity 组成已冻结，不得降维）。

委派约束：所有委派 ticket 的 Acceptance Criteria 必须直接引用 Spec 冻结条款
（§4 / §5 / §6 / §9 / §10），不得通过改写 Spec 语义来"简化"实现；`UNKNOWN != PASS`、
`captured != verified`、fail-closed 全套语义逐 ticket 适用。

## I. V1 deferred decisions（汇总）

- **D-8** global quality-score aggregation → CLOSED_FOR_V1（reopen：未来产品需求 + 独立 Spec authority）；
- **D-9** 新 provider OAuth / Session 行为设计 → DEFER_FROM_V1（lazy 触发 scoped Discovery）；
- **D-2** 非首段 provider capabilities（OAuth / Browser / OSS 路由等）→ 不预研，lazy 触发；
- 既有 Spec §11 / §13 排除项继续有效（Matrix Factorization、trained LTR、xQuAD、DPP、
  P2/P3 预建 SQLite history 等）——本轮无需重复枚举，仅声明不重开。

## J. Security-critical gates（不得被偷偷委派）

1. **GATE-2（D-7b）**：公开知乎语料 → 新 embedding provider 的出网 authority。现有 R5 egress 批准
   仅限 DeepSeek semantic runtime；embedding egress 是独立决定，须显式批准 + 安全边界记录。
   **本 Gate 将其显式命名，防止被藏进 cache schema 实现细节里静默通过。**
2. **D-1 qualification 的隔离要求**：无论 local/remote，EmbeddingProvider 不得持有知乎 provider
   credential；external corpus 送入 embedding worker 受 UNTRUSTED_CONTENT / capability isolation
   约束（§5.3 / V2 trust boundary）；credential 值不进 cache identity。
3. **D-9 lazy 触发**：未来任何 OAuth/Session 新行为先 Discovery/Qualification 后实现（V0.3 决策 C 先例）；
   新 browser-scraping / Browser-Session data-access 仍需独立 Approved Spec amendment（§5.1 冻结）。
4. 既有不变量全程适用：FAIL_CLOSED / NO_SEMANTIC_DOWNGRADE / NO_SILENT_PROVIDER_FALLBACK /
   NO_SILENT_RUNTIME_FALLBACK；public egress ≠ private/sensitive egress。

## K. OVERENGINEERING_REJECTION_LIST

以下提议默认拒绝，除非未来真实 P1 需求 + repository evidence 能证明必要：

| 提议 | 拒绝理由 |
|---|---|
| universal provider framework / plugin platform | 违反 THIN / ADAPTER_FIRST；seam 最小 contract 已冻结 |
| vector database | cache identity 组成已冻结，flat-file 持久化即可；无任何证据需要向量索引服务 |
| knowledge graph / large KG | §11 明确排除；logical hierarchy 已由 §8 层表达 |
| microservices / event bus / workflow engine / distributed task queue | 单机 thin controller 架构已验证（#30）；无规模证据 |
| SQLite history platform for P2/P3 | §13 明确排除（P1 只保留自然可复用事实） |
| automatic browser platform / 新 browser-scraping | 父级 NON-GOAL 未 amend；新实现需独立 Spec amendment（§5.1） |
| global quality score（D-8） | CLOSED_FOR_V1（§14 minimum-correct default） |
| trained ranking model / complex active learning / advanced stopping theory | §11 明确排除 |
| hard six-lane quotas | §3.2：six dimensions relocated, not deleted；不得回归 hard quotas |
| MMR as mandatory selector | §3.2：仅 optional lightweight redundancy control |
| universal research DSL（D-3 超集 schema） | §4 冻结最小概念字段；exact schema delegated |
| 第二 canonical content store | §6.1：manifest 只是 derived composition |
| 把 `bge-small-zh-v1.5` 冻结为 production model | Evidence Gate 证据 ≠ production approval；走 GATE-1 |
| runtime/provider routing 扩张 | frozen policy 不重开；`NO_SILENT_*_FALLBACK` 不变 |
| 为 planning 重跑 selector benchmark | 无证据表明 decomposition 被阻塞；§12 caveats 随行即可 |

## L. Ticketing Readiness verdict

```text
TICKETING_READY = YES
```

七项最低条件逐项核验：

1. **Approved Spec 已生效** ✓（remote master `279caf6`；条件 3/4/5 机械化验证通过；条件 1/2 的双
   reviewer PASS 记录在外部审查会话，已列入待 ChatGPT 确认项）；
2. **architecture-shaping uncertainty 已解决或有独立 pre-ticket discovery gate** ✓ ——
   三个 seam（ZhihuDataProvider / SemanticRuntime / EmbeddingProvider）contract 均已冻结；
   multi-group 状态概念、logical hierarchy、coverage 三覆盖、saturation 语义均已冻结；
   剩余不确定性全部为 qualification/discovery 形态，已具名为 GATE-1/GATE-2；
3. **security-critical unknown 未被偷偷委派** ✓ —— D-7 egress 子门显式命名（GATE-2）；
   D-9 lazy 触发规则显式记录；UNTRUSTED_CONTENT / isolation 约束随 D-1 资格门走；
4. **numeric tuning 未被误升为 architecture blocker** ✓ —— D-4/D-5/D-6 全部 C 类 +
   `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION`；
5. **V1 non-essential complexity 已显式 deferred** ✓ —— D-8 CLOSED_FOR_V1；D-9 与非首段
   provider capabilities lazy/deferred；
6. **minimum implementation critical path 可画出** ✓ —— §F 十二组件依赖图，基于实测 seams；
7. **implementation ticket 可在不修改 Approved Spec 前提下定义 Acceptance Criteria** ✓ ——
   每类 ticket 的 AC 均可引用已冻结条款（§4 Plan authority / §5 seam contracts / §6 execution
   semantics / §9 coverage / §10 failure semantics / §3 preservation）。

结论：**MUST_RESOLVE_BEFORE_TICKETING = 空集**。所有 OPEN_DECISION 要么已有足够冻结边界可委派，
要么是 discovery/qualification 形态（可进入 DAG），要么 V1 不需要（显式 defer）。
无任何 decision 处于"不知道该归哪类"或"被错误当作 ticketing 阻塞"的状态。

## M. Exact next legal stage

```text
NEXT_LEGAL_STAGE = P1_TICKET_DECOMPOSITION

前提（由本 Gate 提出、待 ChatGPT independent review 确认）：
  1. 本文件（planning candidate）通过独立 review；
  2. Ticket Decomposition 产物必须包含：GATE-1 / GATE-2 作为 discovery/decision ticket、
     D-3 plan contract 作为 DAG 前部 interface ticket；
  3. 委派类 ticket 的 AC 引用 Spec 冻结条款，不重写语义。

持续保持：
  TARGET_STATUS = NOT_IMPLEMENTED
  IMPLEMENTATION_AUTHORIZATION = NONE
  VERSION_ASSIGNMENT = UNASSIGNED

仍被禁止（任务 §17 全清单继续有效）：
  production implementation / 修改 Approved Spec / 创建 GitHub Issues / selector coding /
  embedding integration / provider integration / 新 benchmark / 新 Gold / P2/P3 design /
  version assignment / merge master / 自动 reviewer loop
```

---

*本文件由 planning gate executor 产出，未经独立 review 前不构成任何 authority。
最终审查者：ChatGPT（外部）。SELF_REVIEW != INDEPENDENT_REVIEW。*
