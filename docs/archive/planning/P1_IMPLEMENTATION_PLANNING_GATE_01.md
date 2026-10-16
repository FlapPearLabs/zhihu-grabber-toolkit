# P1 Implementation Planning Gate 01 — OPEN_DECISION Classification & Ticketing Readiness

```text
DOCUMENT_ID = P1_IMPLEMENTATION_PLANNING_GATE_01
STATUS = REVIEW_PENDING
AUTHORITY_CLASS = NON_AUTHORITATIVE_PLANNING_CANDIDATE
REVIEWER = ChatGPT（外部独立 reviewer；本轮不 spawn 任何内置 reviewer subagent）
REVIEW_CYCLE = R1 REPAIR（BASE_REVIEWED_HEAD = 54a0841b93452cfd5ca37780ee03e70bffc82988；
              ChatGPT 判定 CHANGES_REQUESTED_NARROW：P0=0 / P1=3 / P2=2；
              实质性结论获 reviewer 认可：MUST_RESOLVE_BEFORE_TICKETING = empty、
              TICKETING_READY = YES；本 commit 仅修复 5 项 findings，不重开 Planning Gate）
BRANCH = planning/p1-implementation-gate-01
BASE_SHA = 279caf6141c26a38cf4a449b2b4cfbeba4357577（latest remote master at branch creation，已 fetch 验证）
SCOPE = 仅修改本文件与配套 REVIEW PACKET；不修改任何 Approved Spec / 治理文件 / 生产代码
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
Date: 2026-08-28（R1 repair）
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

远端其他分支（`audit/claude-external-review-2026-08-27`、`dg01-decision-grade-gate`、
`spec/p1-architecture-spec-prep-01` 等）均为审查树 / 历史 audit 分支，**不属于本轮 scope**。

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

- `src/official.js`：`searchQuestions(keyword, secret)` —— 官方开放平台唯一已实现 **retrieval** capability
  （源码注释明示"平台无按问题列回答接口"）；Bearer secret（`zhihu_secret.txt`），429/5xx 退避重试。
- `src/grabber.js grabAll()`：Session/Cookie（`z_c0`/`d_c0`，zhihu-cli login 或 `ZHIHU_COOKIE`）单问题
  pagination **capture primitive**（不是 retrieval ranking channel）；`src/verifier.js` 14 项校验 =
  唯一 validity authority；`scripts/make-handoff.mjs` 唯一 handoff 权威。
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
2. 全仓库只有 **一个** 已知 retrieval-ranked capability（Official Search）；Session/Cookie 是 capture
   primitive，不产生 retrieval ranking，不能充当 RRF 的 provider channel；
3. `bge-small-zh-v1.5` 不出现在任何 tracked authority / 生产文件中（仅存在于未导入 master 的
   external-audit 审查树）—— **Evidence Gate 用过它 != production model approved**；
4. 无 OAuth；无 browser-scraping 实现新增；无第二个 canonical content store；
5. SemanticRuntime 公开知乎默认 = `deepseek-api-tool-less`（Approved，R5），不再 OPEN。

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
| D-1 | production EmbeddingProvider / model | **B**（Discovery/Qualification = GATE-1） | BLOCKS：EmbeddingProvider adapter / dense layer **实现**；NOT blocking：ticket decomposition |
| D-2a | Provider seam + Official Search adapter（唯一已知 retrieval-ranked capability 的首段 adapter） | **C** | 无 blocking；NOT blocking ticketing |
| D-2b | 额外 retrieval-ranked provider / capability（满足 multi-query / **multi-provider** retrieval 合同所需） | **B**（GATE-3 = ADDITIONAL_RETRIEVAL_PROVIDER_CAPABILITY_DISCOVERY） | BLOCKS：宣称 multi-provider retrieval 能力 complete；仅 Official Search 存在时的 full P1 completion。NOT blocking：ticket decomposition / seam / Official Search adapter / 用确定性 fixtures 的 generic RRF |
| D-3 | Planner persisted schema / validation bounds | **C**（early interface-definition ticket 委派） | plan-contract ticket 必须位于 DAG 前部（interface ticket）；NOT blocking ticketing |
| D-4 | selector relevance/novelty weights + optional redundancy params | **C**（+ `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION`） | 无 blocking；禁止 planning 阶段拍权重 / 重跑 benchmark |
| D-5 | group floor / count / quota / anti-starvation numeric boundary | **C**（invariant-first anti-starvation + 实现验证） | 无 blocking；禁止重新引入 six hard quotas |
| D-6 | saturation thresholds / minimum rounds / budgets | **C**（+ `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION`） | 无 blocking；保持 simple deterministic saturation；saturation 为 feedback controller（§F [14]），阈值不冻结 |
| D-7 | embedding cache/storage profile + public-Zhihu egress route | **C**（cache/storage）+ **B 子门**（egress = GATE-2） | GATE-2 产出须经 security/contract governance + independent review 转化为显式 repository authority/evidence，才可 remote embedding 实现；NOT blocking ticketing |
| D-8 | global quality-score aggregation | **D**（DEFER_FROM_INITIAL_P1_BASELINE） | NO_TICKET_IN_INITIAL_DAG = YES；APPROVED_SPEC_DECISION_STATUS = REMAINS_OPEN；DEFAULT = DO_NOT_INTRODUCE。本 Gate 不 amend / 不 close Approved Spec |
| D-9 | provider-specific OAuth / Session credential behavior | **D**（lazy 原则保留） | 既有 Session/Cookie 边界不动；**若 GATE-3 选中的 provider 需要新 OAuth / Session credential 行为，D-9 立即升级为该 provider 的 scoped Discovery / Security prerequisite** |

```text
MUST_RESOLVE_BEFORE_TICKETING = （空集）
PRE_IMPLEMENTATION_DISCOVERY_GATES =
  GATE-1（D-1）  = EmbeddingProvider Qualification Discovery
  GATE-2（D-7b） = remote embedding egress authority（产出须经 governance + review 转为 repo authority）
  GATE-3（D-2b） = ADDITIONAL_RETRIEVAL_PROVIDER_CAPABILITY_DISCOVERY
DELEGATED = D-2a、D-3、D-4、D-5、D-6、D-7（cache/storage）
DEFERRED  = D-8、D-9（lazy，含 GATE-3 触发的 provider-scoped 升级规则）
```

## D. Rationale per decision（六问检验）

六问：①架构形状 ②安全/出网/凭据边界 ③实现 ticket 能否安全自选 ④数值调参 ⑤V1 是否需要 ⑥既有证据是否充分。

### D-1 production EmbeddingProvider / model → B（GATE-1）

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

### D-2 ZhihuDataProvider capability routing → 拆分为 D-2a（C）+ D-2b（B = GATE-3）

**R1 修正（对应 reviewer P1-1）**：R0 版本曾把 "Official Search + Session capture" 并列为首条
multi-provider retrieval 的充分条件——这是**错误的**。Approved Spec 要求的是
**multi-query / multi-provider retrieval**，且 RRF 的 channel identity = query +
**ZhihuDataProvider/capability retrieval rankings**（Spec §5.4）。Session/Cookie capture 是 capture
primitive，不产生 retrieval ranking，**不能**充当 RRF 的 provider channel。当前仓库真实只有
**一个** retrieval-ranked capability（Official Search）。

**D-2a：Provider seam + Official Search adapter → C**

- ①：provider seam 最小 contract 已冻结（§5.1：provider_id / capability / auth_class / candidate
  identity / provenance / completeness status / failure identity）；Official Search 是唯一已知
  retrieval-ranked capability，adapter 属包装既有实现，不改变 seam 形状。
- ③：seam + Official Search adapter 可由实现 ticket 在冻结 contract 内 TDD 定义。
- 无 blocking；ticket decomposition / seam / Official Search adapter 均不受 GATE-3 阻塞。

**D-2b：额外 retrieval-ranked provider / capability → B（GATE-3）**

- Approved multi-provider retrieval 合同意味着：仅凭 Official Search 单 channel，无法宣称
  multi-provider retrieval 能力 complete，也无法完成完整 P1。至少还需一个额外的
  retrieval-ranked provider/capability，且其选择涉及 provider 路由优先级与 qualification 证据
  （同 D-1 逻辑：不能由实现 ticket 拍板，需真实 provider evidence）。
- **GATE-3 = ADDITIONAL_RETRIEVAL_PROVIDER_CAPABILITY_DISCOVERY**：
  - 目的：识别 / 资格确认至少一个额外 retrieval-ranked provider/capability，
    以满足 Approved multi-provider retrieval 合同；
  - 范围约束：只调查与 P1 首个 implementation 真正相关的 capability；**不做全 provider 大而全研究；
    本 Gate 现在不执行该 discovery**；
  - **GATE-3 不阻塞**：Ticket Decomposition；generic ZhihuDataProvider seam；Official Search
    adapter；使用确定性 fixtures 的 generic RRF 实现；
  - **GATE-3 阻塞**：宣称 multi-provider retrieval capability complete；在只有 Official Search 的
    情况下宣称 full P1 implementation completion。
- 冻结不动：高层 provider 偏好顺序 official-first / `THIN / ADAPTER_FIRST / REUSE_FIRST`（§5.1），
  D-2 的任何部分都不重开该顺序。

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
- **控制流定位（R1 修正，对应 reviewer P1-3）**：saturation 不是流水线末端的一个阶段，而是
  **feedback controller**：`ResearchCoverageState → saturation decision → 未饱和 → 追加 retrieval
  round（回到 [3]）；饱和 / budget stop → 继续走向 final synthesis`。该反馈边在 §F 图中显式存在。
  `ResearchCoverageState` 是 **cross-cutting controller state**，从 retrieval 起持续更新
  （见 §F [13]）。
- ③：thresholds / minimum rounds / query-group budgets 仍全部 delegated + implementation validation，
  本 Gate 不冻结任何阈值。

### D-7 embedding cache/storage + public-Zhihu egress → C + B 子门（必须拆开）

**(a) CACHE IMPLEMENTATION DETAIL → C**：§5.3 已冻结 cache identity 组成（canonical input hash +
provider/model + embedding version + normalization version），精确 schema/storage delegated。
凭据/credential path 内容永不进入 cache identity（§6.2 已冻结）。**cache schema 未定不阻塞任何事。**

**(b) SECURITY / PUBLIC EGRESS AUTHORITY → B 子门（GATE-2）**：若 D-1 qualification 选出 remote
embedding provider，则公开知乎语料内容将出网到新第三方。现有 approved egress
（公开知乎语料 → DeepSeek）是 runtime-scoped 先例，**不得推广**。

**GATE-2 governance 要求（R1 强化，对应 reviewer P2-2）**：GATE-2 的结论（批准或拒绝该出网路由）
必须通过适用的 security / contract governance 流程与 independent review，**转化为显式的
repository authority / evidence**（即：落在 repo-tracked authority 载体上，可被独立验证）之后，
才允许实现任何 remote embedding。**仅有聊天声明或 executor note 不足以构成 authority。**
本 Gate 不预设 GATE-2 未来采用的具体 ticket / review 类型。

若 D-1 选出 local provider，本子门自动满足（无新出网），仍须在 qualification 记录中显式声明
"无新增 egress"。

**Blocking relationship：GATE-2 blocks remote-embedding implementation only；不阻塞 ticketing**
（ticket decomposition 可包含该 authority gate 作为 discovery/decision ticket）。

### D-8 global quality-score aggregation → D（DEFER_FROM_INITIAL_P1_BASELINE）

**R1 修正（对应 reviewer P2-1）**：R0 版本使用 "CLOSED_FOR_V1" 表述不当——本 planning artifact
**无权关闭** Approved Spec 中的 OPEN decision。修正为：

```text
D-8 = DEFER_FROM_INITIAL_P1_BASELINE
NO_TICKET_IN_INITIAL_DAG = YES
APPROVED_SPEC_DECISION_STATUS = REMAINS_OPEN
DEFAULT = DO_NOT_INTRODUCE
```

- ⑤：初始 P1 baseline 不需要它。Spec §14 自带 minimum-correct default = 不引入；frozen selector
  baseline 与 100% analysis coverage 均不消费 global quality score；§11 已排除 trained LTR /
  复杂聚合。初始 ticket DAG 中**不出现**任何消费 D-8 的 ticket。
- 本 Gate 不 amend、不 close Approved Spec 的 D-8；其未来裁决仍归 Approved Spec 既有流程。
- ①：defer 无架构代价 —— 它是 additive aggregation 概念，不在任何 critical path 上。

### D-9 OAuth / Session credential behavior → D（lazy 原则保留 + GATE-3 触发规则）

- ⑤：P1 第一版 critical path = Official Search（唯一已知 retrieval capability）+ 既有
  Session/Cookie capture primitive，**不需要 OAuth**。既有 Session/Cookie 行为已实现且边界冻结
  （RULES §1、contract §3.14），P1 不修改既有 credential boundary（Spec §14 D-9 明示）。
- ②：凭据行为属安全关键面 —— 但需要防的是**新增** provider 的凭据设计，不是既有边界。
  提前设计 OAuth 登录平台 = 为尚不存在的 provider 做超前工程。
- **GATE-3 触发规则（R1 修正）**：D-9 的 lazy 原则保留，但若 **GATE-3 选中的额外
  retrieval-ranked provider 需要新的 OAuth / Session credential 行为**，D-9 **立即升级**为该
  provider 的 scoped Discovery / Security prerequisite，必须先完成才能实现该 provider。
  既有 Session/Cookie primitive 的包装复用不触发该升级（边界不重定义）。
- 结论：PRIMARY = D（lazy）；触发升级规则显式记录如上。**不阻塞 ticketing。**

## E. Blocking relationships（汇总视图）

```text
TICKET DECOMPOSITION 阻塞物：        无（空集）

IMPLEMENTATION / COMPLETION 阻塞物（非 ticketing）：
  GATE-1 (D-1)  EmbeddingProvider Qualification Discovery
                └─ blocks → EmbeddingProvider adapter + Dense Semantic Layer 实现
  GATE-2 (D-7b) remote embedding egress authority
                （产出必须经 security/contract governance + independent review
                  转化为显式 repository authority/evidence）
                └─ blocks → 仅 remote embedding 实现（local provider 须显式记录"无新增 egress"）
  GATE-3 (D-2b) ADDITIONAL_RETRIEVAL_PROVIDER_CAPABILITY_DISCOVERY
                ┌─ NOT blocking：Ticket Decomposition / generic ZhihuDataProvider seam /
                │             Official Search adapter / 确定性 fixtures 的 generic RRF
                └─ blocking：宣称 multi-provider retrieval capability complete；
                             仅 Official Search 存在时的 full P1 implementation completion
  D-9 升级规则   若 GATE-3 选中 provider 需要新 OAuth/Session credential 行为
                └─ blocks → 该 provider 的实现（scoped Discovery / Security prerequisite 先行）

DAG 排序约束（非阻塞）：
  D-3 minimum persisted Plan contract ticket 必须先于所有消费 plan 的下游 ticket。
```

## F. MINIMUM_IMPLEMENTATION_CRITICAL_PATH（COMPONENT_DEPENDENCY_GRAPH，component level，非 Ticket DAG）

**R1 修正（对应 reviewer P1-2 / P1-3）**：图现在显式区分**两个不同的 selector**——
(A) Source-group Set Selection（Approved §7 合同，发生在 per-group capture **之前**）与
(B) RCE Corpus Selector（frozen 四组件 baseline，发生在 per-group capture / verify **之后**）；
二者不得合并。`ResearchCoverageState` 为 **cross-cutting controller state**（[13]），
saturation 为 **feedback controller**（[14]，显式反馈边回到 [3]）。

```text
[1] Research Plan contract
    persisted plan artifact + structured-output validation + planHash + run identity
    （normalized user request + stable configuration identity；扩展 state.mjs 线性状态机）
      │
      ▼
[2] ZhihuDataProvider seam
    （§5.1 最小 contract；adapter-first；凭据不进 state）
      │
      ▼
[3] Multi-query / multi-provider retrieval + RRF
    （channel identity = query + provider/capability retrieval rankings，§5.4；
     首段 = Official Search adapter [D-2a]；额外 retrieval-ranked provider 依赖 [GATE-3]）
      ▲                                                    │
      │ [14] saturation feedback                            ▼
      │ （未饱和 → 追加 retrieval round；            Candidate / Retrieval Pool
      │   饱和 / budget stop → 继续下游）                    │
      │                                                     ▼
      │                                    [4] Source-group Set Selection / Ambiguity Gate
      │                                        （Approved §7 合同：clear best group set → auto；
      │                                          material ambiguity → 至多一次 clarification；
      │                                          no valid group set → fail closed）
      │                                                     │
      │                                                     ▼
      │                                        SelectedSourceGroups[]
      │                                                     │
      │                                                     ▼
      │                                    [5] Multi-group Execution State
      │                                        （PerGroupExecutionState / VerifiedGroupRefs[] /
      │                                          ResearchCorpusManifest；复用/扩展
      │                                          validateCheckpoint hash 语义）
      │                                                     │
      │                                                     ▼
      │                                    [6] Per-group Capture / Verify / Handoff composition
      │                                        （逐组包装既有 grabAll / verifier / make-handoff；
      │                                          captured != verified 逐组成立；composition 只引用
      │                                          已验证 group refs）
      │                                                     │
      │                                                     ▼
      │                                        Verified candidate source pool
      │                                                     │
      ├────────────────────────────────────────────────────┤
      │                                                     │
[13] ResearchCoverageState（cross-cutting controller state）│
     从 [3] retrieval 开始持续更新，贯穿：                   │
     · retrieval / provider routes（planned vs executed、   │
       failures、unknown completeness）                     │
     · source-group selection（[4] 输出）                   │
     · capture / verification（[6] per-group 状态）         │
     · RCE selection（[10] per-group accounting）           │
     · claim/aspect analysis（[12] mapped set）             │
     同时追踪三覆盖：Retrieval Coverage / Source            │
     Completeness / Analysis Coverage                       │
      │（[13] → [14] saturation decision）                  │
      ├────────────── [14] feedback ──────────►（回到 [3]）  │
                                                            ▼
                          [GATE-1] EmbeddingProvider Qualification Discovery（D-1）
                          可与 [1]–[7] 并行推进；输出 provider category / evidence
                          └─ [GATE-2] egress authority（若 remote；经 governance + review
                             转为 repo authority/evidence）
                                                            │
                                                            ▼
                          [8] EmbeddingProvider adapter + cache
                              （§5.3 contract；cache identity 组成已冻结；
                               凭据不进 cache identity；fail-closed）
                                                            │
                                                            ▼
                          [9] Dense semantic layer
                              （relevance / novelty geometry over candidate pool；
                               DENSE unavailable → FAIL_CLOSED）
                                                            │
                                                            ▼
[7] Verified candidate source pool ────────────► [10] RCE Corpus Selector
    （verified sources/groups                        （frozen baseline：Question/Source-group
     + metadata + dense geometry）                    Preservation + Popularity Anchor +
                                                      Dense Relevance/Novelty + optional
                                                      lightweight redundancy；
                                                      逐组 eligible/selected/verified/analyzed
                                                      计量 + exclusion reason；
                                                      D-4/D-5 不变量在此实现验证）
                                                            │
                                                            ▼
                                        Selected Verified Research Corpus
                                                            │
                                                            ▼
                          [11] Question / Source-group logical representation layer
                              （独立于物理 chunk packing；selected/verified/analyzed
                               accounting、main/minority/contradictory claims、
                               expert/evidence-rich refs、coverage state）
                                                            │
                                                            ▼
                          [12] Claim / Aspect representation + cross-source synthesis
                              （跨 group 聚合 supporting/opposing sources；禁止 flat reduce /
                               naive equal weight；SemanticRuntime = deepseek-api-tool-less，
                               Approved policy 不重开）
                                                            │
                                                            ▼
                          [15] v0.3 final synthesis integration
                              （100% analysis coverage assertion 仅当 selected set ==
                               analyzed set 机械相等；render / observability / mode identity
                               继承 SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST）
```

**15 组件终检清单**（对应 review "CRITICAL PATH FINAL CHECK"）：

| # | Component | 图中位置 |
|---|---|---|
| 1 | Research Plan | [1] |
| 2 | ZhihuDataProvider seam | [2] |
| 3 | multi-query / multi-provider retrieval | [3] |
| 4 | Source-group Set Selection / Ambiguity Gate | [4]（capture 前，与 [10] 严格分离） |
| 5 | Multi-group Execution State | [5] |
| 6 | Per-group Capture / Verify / Handoff | [6] |
| 7 | Verified candidate source pool | [7] |
| 8 | EmbeddingProvider | [8]（前置 GATE-1/GATE-2） |
| 9 | Dense semantic layer | [9] |
| 10 | RCE Corpus Selector | [10]（capture/verify 后，与 [4] 严格分离） |
| 11 | Question / Source-group representation | [11] |
| 12 | Claim / Aspect synthesis | [12] |
| 13 | ResearchCoverageState as cross-cutting state | [13]（非流水线末端阶段） |
| 14 | Saturation feedback → retrieval | [14]（显式反馈边 [13]→[3]） |
| 15 | final v0.3 synthesis integration | [15] |

依赖要点：

- [4] 与 [10] 是**两个不同的 selector**，输入/输出/时点/合同均不同，禁止合并（§7 vs §3）。
- [13] 不是 late linear stage：从 [3] 起始，随每个阶段更新；[14] 的反馈使 [3]–[7] 构成
  受饱和决策控制的迭代回路；[15] 的 100% analysis assertion 消费 [13] 的 Analysis Coverage 账目。
- [GATE-1]（及其 [GATE-2] egress 子门）与 [1]–[7] **可并行**：dense 层 fail-closed 语义允许
  pipeline 骨架先建，但**完整 P1** 在 dense 可用前不得宣称完成
  （`DENSE_CAPABILITY_UNAVAILABLE → FAIL_CLOSED`）。
- [GATE-3] 挂接 [3]：Official Search adapter 即刻可用，seam / RRF（fixtures）不受阻；
  multi-provider completeness 依赖 GATE-3 完成。
- D-3 的 plan contract ticket = [1]；D-4/D-5 的实现验证在 [10]；D-6 的实现验证在 [13]/[14]。

## G. Pre-ticket discovery gates

| Gate | 决策来源 | 内容 | 阻塞对象 | 非阻塞对象 |
|---|---|---|---|---|
| GATE-1 | D-1 | EmbeddingProvider Qualification Discovery：provider category（local vs remote）、quality/identity/normalization evidence、failure identity 证据；显式声明 `bge-small-zh-v1.5` 证据仅为 harness 方向性参考 | EmbeddingProvider adapter / Dense layer **实现** | ticket decomposition；[1]–[7] |
| GATE-2 | D-7(b) | public-Zhihu corpus → embedding provider egress authority（仅当选 remote）。**产出必须经适用的 security / contract governance + independent review 转化为显式 repository authority/evidence；聊天声明或 executor note 单独不足。本 Gate 不预设具体 ticket/review 类型。** | remote embedding **实现** | ticket decomposition；local embedding（须显式记录"无新增 egress"） |
| GATE-3 | D-2b | ADDITIONAL_RETRIEVAL_PROVIDER_CAPABILITY_DISCOVERY：识别/资格确认至少一个额外 retrieval-ranked provider/capability，满足 multi-provider retrieval 合同；只调查 P1 首个 implementation 真正相关的 capability；本 Gate 现在不执行该 discovery，不做全 provider 研究 | 宣称 multi-provider retrieval complete；仅 Official Search 时的 full P1 completion | ticket decomposition；seam；Official Search adapter；确定性 fixtures 的 generic RRF |
| D-9 触发 | D-9 | 若 GATE-3 选中 provider 需要新 OAuth/Session credential 行为 → 该 provider 的 scoped Discovery / Security prerequisite | 该 provider 的实现 | 既有 Session/Cookie primitive 的包装复用 |

GATE-1/GATE-2/GATE-3 可作为 discovery ticket **进入** Ticket Decomposition，
不要求在拆 DAG 前完成。

## H. Delegated implementation decisions（汇总）

- **D-2a**：Provider seam + Official Search adapter 的 exact routing / adapter 形态；
- **D-3**：minimum persisted Plan schema / validation bounds / planHash 编码（DAG 前部 interface ticket）；
- **D-4**：selector relevance/novelty weights + optional redundancy params（implementation validation）；
- **D-5**：anti-starvation 以可测不变量表达；floor/count/quota 数值（若需要）同上；
- **D-6**：saturation thresholds / minimum rounds / query-group budgets（implementation validation；
  saturation 控制流定位为 feedback controller，见 §F [14]）；
- **D-7(a)**：embedding cache/storage 精确 schema（identity 组成已冻结，不得降维）。

委派约束：所有委派 ticket 的 Acceptance Criteria 必须直接引用 Spec 冻结条款
（§4 / §5 / §6 / §7 / §9 / §10），不得通过改写 Spec 语义来"简化"实现；`UNKNOWN != PASS`、
`captured != verified`、fail-closed 全套语义逐 ticket 适用。

## I. V1 deferred decisions（汇总）

- **D-8** global quality-score aggregation → `DEFER_FROM_INITIAL_P1_BASELINE`；
  `NO_TICKET_IN_INITIAL_DAG = YES`；`APPROVED_SPEC_DECISION_STATUS = REMAINS_OPEN`；
  `DEFAULT = DO_NOT_INTRODUCE`。本 Gate 不 amend / 不 close Approved Spec。
- **D-9** 新 provider OAuth / Session 行为设计 → DEFER（lazy 原则保留；GATE-3 触发的
  provider-scoped 升级规则见 §D / §G）。
- 既有 Spec §11 / §13 排除项继续有效（Matrix Factorization、trained LTR、xQuAD、DPP、
  P2/P3 预建 SQLite history 等）——本轮无需重复枚举，仅声明不重开。

## J. Security-critical gates（不得被偷偷委派）

1. **GATE-2（D-7b）**：公开知乎语料 → 新 embedding provider 的出网 authority。现有 R5 egress 批准
   仅限 DeepSeek semantic runtime；embedding egress 是独立决定。**GATE-2 结论必须经适用的
   security / contract governance + independent review 转化为显式 repository authority/evidence
   后才可实现 remote embedding；聊天声明 / executor note 单独不足以构成 authority。**
   **本 Gate 将其显式命名，防止被藏进 cache schema 实现细节里静默通过。**
2. **GATE-3（D-2b）**：额外 retrieval-ranked provider 的识别/资格确认涉及 provider 路由与
   qualification 证据；其结论同样须以可独立验证的 evidence 记录（`UNKNOWN != PASS`）。
3. **D-1 qualification 的隔离要求**：无论 local/remote，EmbeddingProvider 不得持有知乎 provider
   credential；external corpus 送入 embedding worker 受 UNTRUSTED_CONTENT / capability isolation
   约束（§5.3 / V2 trust boundary）；credential 值不进 cache identity。
4. **D-9 升级规则**：GATE-3 选中 provider 若需新 OAuth/Session credential 行为 → 先 scoped
   Discovery / Security prerequisite 后实现（V0.3 决策 C 先例）；新 browser-scraping /
   Browser-Session data-access 仍需独立 Approved Spec amendment（§5.1 冻结）。
5. 既有不变量全程适用：FAIL_CLOSED / NO_SEMANTIC_DOWNGRADE / NO_SILENT_PROVIDER_FALLBACK /
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
| global quality score（D-8） | DEFER_FROM_INITIAL_P1_BASELINE；APPROVED_SPEC_DECISION_STATUS = REMAINS_OPEN；DEFAULT = DO_NOT_INTRODUCE |
| trained ranking model / complex active learning / advanced stopping theory | §11 明确排除 |
| hard six-lane quotas | §3.2：six dimensions relocated, not deleted；不得回归 hard quotas |
| MMR as mandatory selector | §3.2：仅 optional lightweight redundancy control |
| universal research DSL（D-3 超集 schema） | §4 冻结最小概念字段；exact schema delegated |
| 第二 canonical content store | §6.1：manifest 只是 derived composition |
| 把 `bge-small-zh-v1.5` 冻结为 production model | Evidence Gate 证据 ≠ production approval；走 GATE-1 |
| runtime/provider routing 扩张 | frozen policy 不重开；`NO_SILENT_*_FALLBACK` 不变 |
| 为 planning 重跑 selector benchmark | 无证据表明 decomposition 被阻塞；§12 caveats 随行即可 |
| 把 Source-group Set Selection 与 RCE Corpus Selector 合并 | §7 选择合同与 §3 frozen baseline 是两个不同时点/输入/输出的 selector（R1 P1-2） |
| 为 planning 执行 GATE-3 全 provider 大而全研究 | GATE-3 只调查 P1 首个 implementation 真正相关的 capability（R1 P1-1） |

## L. Ticketing Readiness verdict

```text
TICKETING_READY = YES
```

七项最低条件逐项核验：

1. **Approved Spec 已生效** ✓（remote master `279caf6`；条件 3/4/5 机械化验证通过；条件 1/2 的双
   reviewer PASS 记录在外部审查会话，已列入待 ChatGPT 确认项）；
2. **architecture-shaping uncertainty 已解决或有独立 pre-ticket discovery gate** ✓ ——
   三个 seam（ZhihuDataProvider / SemanticRuntime / EmbeddingProvider）contract 均已冻结；
   multi-group 状态概念、两个 selector 的分离定位、logical hierarchy、coverage 三覆盖、
   saturation feedback controller 语义均已冻结/显式化；剩余不确定性全部为
   qualification/discovery 形态，已具名为 GATE-1/GATE-2/GATE-3；
3. **security-critical unknown 未被偷偷委派** ✓ —— D-7 egress 子门显式命名（GATE-2）并强化了
   "结论须转为 repo authority/evidence"的 governance 要求；D-9 lazy + GATE-3 触发升级规则显式记录；
   UNTRUSTED_CONTENT / isolation 约束随 D-1 资格门走；
4. **numeric tuning 未被误升为 architecture blocker** ✓ —— D-4/D-5/D-6 全部 C 类 +
   `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION`；
5. **V1 non-essential complexity 已显式 deferred** ✓ —— D-8 DEFER_FROM_INITIAL_P1_BASELINE
   （Spec 侧 REMAINS_OPEN）；D-9 与额外 retrieval provider discovery（GATE-3）显式定位；
6. **minimum implementation critical path 可画出** ✓ —— §F 15 组件依赖图（含 cross-cutting
   coverage state 与 saturation feedback 边），基于实测 seams；
7. **implementation ticket 可在不修改 Approved Spec 前提下定义 Acceptance Criteria** ✓ ——
   每类 ticket 的 AC 均可引用已冻结条款（§4 Plan authority / §5 seam contracts / §6 execution
   semantics / §7 selection contract / §9 coverage / §10 failure semantics / §3 preservation）。

结论：**MUST_RESOLVE_BEFORE_TICKETING = 空集**。R1 repair 修复了 reviewer 指出的 D-2 拆分、
双 selector 分离、coverage/saturation 控制流与两处表述问题，**不改变** readiness 实质结论。

## M. Exact next legal stage

```text
NEXT_LEGAL_STAGE = P1_TICKET_DECOMPOSITION
生效前提：本 R1 repair 通过 ChatGPT delta re-review PASS。

前提（由本 Gate 提出）：
  1. Ticket Decomposition 产物必须包含：GATE-1 / GATE-2 / GATE-3 作为 discovery/decision ticket、
     D-3 plan contract 作为 DAG 前部 interface ticket；
  2. 初始 DAG 不得包含消费 D-8 的 ticket（NO_TICKET_IN_INITIAL_DAG = YES）；
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

## 附：R1 REPAIR RECORD（响应 ChatGPT CHANGES_REQUESTED_NARROW，P0=0 / P1=3 / P2=2）

| Finding | 修复位置 | 内容 |
|---|---|---|
| P1-1 | §C / §D-D2 / §E / §F[3] / §G / §K | D-2 拆分 D-2a（C：seam + Official Search adapter）/ D-2b（B = GATE-3）；显式更正 R0 错误（Session capture ≠ retrieval ranking channel；RRF channel = query + provider retrieval rankings）；GATE-3 重定义为 ADDITIONAL_RETRIEVAL_PROVIDER_CAPABILITY_DISCOVERY，含完整 blocking / non-blocking 语义；D-9 增加 GATE-3 触发升级规则 |
| P1-2 | §F / §B / §K | 图重画为 15 组件链：显式加入 [4] Source-group Set Selection / Ambiguity Gate（Approved §7 合同，capture 前）并与 [10] RCE Corpus Selector（§3 baseline，capture/verify 后）严格分离，禁止合并 |
| P1-3 | §F[13][14] / §D-D6 | ResearchCoverageState 改为 cross-cutting controller state（自 [3] 起持续更新，贯穿 retrieval / provider routes / group selection / capture-verify / RCE / claim-aspect，追踪三覆盖）；saturation 表达为显式 feedback controller（[13]→[14]→[3] 迭代回路 / budget stop → 下游）；阈值不冻结，D-6 分类不变 |
| P2-1 | §C / §D-D8 / §I / §K | D-8 表述改为 DEFER_FROM_INITIAL_P1_BASELINE / NO_TICKET_IN_INITIAL_DAG=YES / APPROVED_SPEC_DECISION_STATUS=REMAINS_OPEN / DEFAULT=DO_NOT_INTRODUCE；删除 R0 的 "CLOSED_FOR_V1"（planning artifact 无权关闭 Approved Spec decision） |
| P2-2 | §D-D7(b) / §G / §J | GATE-2 增加 governance 要求：结论必须经 security/contract governance + independent review 转化为显式 repository authority/evidence；聊天声明 / executor note 单独不足；不预设具体 ticket/review 类型 |

PRESERVE 确认：D-1 / D-3 / D-4 / D-5 / D-6 / D-7 cache-egress 拆分 / D-9 lazy 原则 / 四组件
selector baseline / six-dimension relocation / 安全模型 / overengineering rejection list /
TICKETING_READY = YES / MUST_RESOLVE_BEFORE_TICKETING = empty 全部保持不变。

---

*本文件由 planning gate executor 产出，未经独立 review 前不构成任何 authority。
最终审查者：ChatGPT（外部）。SELF_REVIEW != INDEPENDENT_REVIEW。*
