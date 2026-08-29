# P1 Ticket Decomposition V1 — Implementation Ticket DAG（Planning Only）

```text
DOCUMENT_ID = P1_TICKET_DECOMPOSITION_V1
STATUS = REVIEW_PENDING
AUTHORITY_CLASS = NON_AUTHORITATIVE_PLANNING_CANDIDATE
REVIEWER = ChatGPT（外部独立 reviewer；本轮不 spawn 任何内置 reviewer）
BASE_SHA = 12788ce60fed39be6436b62525d4ba4d206f2b61（latest remote master，已 fetch 核验，无 drift）
BRANCH = planning/p1-ticket-decomposition-01
SCOPE = 仅本文件 + P1_TICKET_GRAPH_V1.md；零代码 / 零 Spec / 零 governance 改动
TICKET_COUNT = 17（含 1 条 CONDITIONAL）
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
PROJECT_MEMORY_UPDATE_REQUIRED = NO
Date: 2026-08-29
```

**本文件只做 Ticket Decomposition（planning）。** 任何 ticket 的定义存在 ≠ 该 ticket 已被授权执行。
实现授权只发生在 Ticket Graph review / freeze / issue-creation workflow 依 repository authority
完成后。本文件不 reopen Planning Gate 的任何冻结结论。

---

## A. Authority baseline

- `git fetch origin` 已执行：`origin/master = 12788ce60fed39be6436b62525d4ba4d206f2b61`，
  与任务基线一致，`12788ce..origin/master` 零 delta → **无 CONTRACT_DRIFT**。
- Authority 全集已完整读取并核验（与 Planning Gate 执行时同一内容，master 无变化）：
  `RULES.md`、`AGENTS.md`、`docs/project-memory.md`、四份 Applicable Approved Specs
  （`v2-rich-content-fidelity.md` / `v0.3-product-scope.md` / `research-orchestration-scope.md` /
  `p1-cross-question-deep-research.md`）、`docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01.md`、
  `docs/product-behavior-contract.md`、`docs/architecture/runtime-strategy.md`。
- 生产 seams 已再次实测核验（`research-orchestration/` 单问题状态机与 checkpoint hash 校验、
  `zhihu-answer-grabber/` Official Search / Session capture / verifier / make-handoff、
  `corpus-anthology/` runtime additive 路由与 fail-closed；全仓无 embedding / 无 OAuth 代码）。
- 冻结输入（不重开）：Planning Gate 的 `TICKETING_READY = YES`、
  `MUST_RESOLVE_BEFORE_TICKETING = empty`、GATE-1/2/3 定义、D-3 early interface、
  D-4/D-5/D-6 数值 = implementation validation、D-8 `DEFER_FROM_INITIAL_P1_BASELINE`
  （`NO_TICKET_IN_INITIAL_DAG = YES`）、D-9 lazy + GATE-3 触发升级、双 selector 分离、
  CoverageState cross-cutting + saturation feedback。

## B. Decomposition principles

1. **每张 ticket = 一个真实 contract boundary**：可独立理解、可独立测试、可独立 merge；
   拒绝"一张大票实现 P1"，也拒绝 20 行微票。
2. **双 selector 永不合并**：Source-group Set Selection（§7，capture 前）与 RCE Corpus Selector
   （§3 frozen baseline，capture/verify 后）是不同 ticket（T08 vs T12）。
3. **CoverageState cross-cutting**：由 T07 定义模块与 retrieval-loop 反馈控制，T08/T12/T15 只消费
   update hooks；saturation 不是末端线性阶段。
4. **Security / discovery gates 显式成票**（T01/T02/T03），不藏在 code ticket 的 prose 里。
5. **数值不冻结**：D-4/D-5/D-6 的所有阈值/权重/预算在各实现 ticket 内以
   `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION` 方式验证。
6. **每个 ticket 继承全套既定不变量**：`captured != verified`、`UNKNOWN != PASS`、
   `FAIL_CLOSED`、`NO_SILENT_PROVIDER_FALLBACK`、`NO_SILENT_RUNTIME_FALLBACK`、
   `UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION`、credential 永不入 plan/state/manifest/events/
   cache identity/review artifacts、controller owns truth & authority / model owns semantics。
7. **Reviewer quorum 严格按 AGENTS.md**，不发明：CODE → 1×CODE_REVIEWER；
   DISCOVERY/EVIDENCE → 1×EVIDENCE_REVIEWER；SECURITY → SECURITY_REVIEWER +
   CODE_OR_CONTRACT_REVIEWER（同 exact HEAD）；DOGFOOD → 1×ACCEPTANCE_EVIDENCE_REVIEWER。
8. **统一 merge 纪律**（适用于全部 ticket，下文不再逐条重复）：scope-clean branch 自
   latest remote master 创建、required quorum 对 exact HEAD PASS、`git diff --check` clean、
   ff-only merge、push 后 remote verify；remote master 集成全局串行。

### Approved Spec requirement → ticket 覆盖矩阵

| Spec 条款 | 覆盖 |
|---|---|
| §4 Research Plan（概念字段/authority/planHash/run identity） | T04 |
| §5.1 ZhihuDataProvider seam + official-first policy（冻结，不重开） | T05（首段 adapter）、T03/T17（额外 retrieval provider） |
| §5.2 SemanticRuntime（deepseek-api-tool-less 冻结 policy） | 继承既有实现；T14 消费（无新资格 ticket） |
| §5.3 EmbeddingProvider contract | T01（qualification）、T02（egress authority）、T10（adapter+cache）、T11（dense geometry） |
| §5.4 RRF boundary（query + provider retrieval rankings） | T06 |
| §6 multi-group execution / handoff / resume / manifest | T09 |
| §7 selection scope amendment（group set selection / ambiguity） | T08 |
| §3 frozen selector baseline + §3.1 preservation accounting | T12 |
| §8 logical hierarchy（group → claim/aspect → synthesis） | T13、T14 |
| §9 CoverageState 三覆盖 + saturation + §9.4 diagnostics | T07（模块+loop）、T09/T12/T15（update hooks / accounting） |
| §10 security & failure semantics | 全部 ticket STOP 条件；T02 显式 security gate |
| §1.1 corpus selection ≠ sampled analysis；mode identity | T15（assertion + 披露）；T12 输出 accounting |
| 100% Analysis Coverage assertion | T15 |
| multi-provider retrieval contract | T06（generic+fixtures）、T03（discovery）、T17（adapter）、T16（acceptance 前提） |
| 父级 §10 observability / stage progress | T15（research-level 披露），继承既有 stage 模型 |
| end-to-end acceptance | T16 |

**显式继承的既有能力（不新开 ticket）**：verify-output authority、make-handoff authority、
canonical `answers.json` schema、corpus chunk/hash/hierarchy 原语、
`lmstudio-local-tool-less` / `deepseek-api-tool-less` runtime 资格与路由、projection sanitization、
preflight 布尔凭据模式、runtime-strategy controller 模型。

## C. Complete Ticket Catalog（一览）

| ID | Title | Type | Risk | Ready-Priority | Blocked by |
|---|---|---|---|---|---|
| P1-T01 | EmbeddingProvider Qualification Discovery（GATE-1） | DISCOVERY/EVIDENCE | HIGH | HIGHEST | — |
| P1-T02 | Remote Embedding Egress Authority（GATE-2，CONDITIONAL） | SECURITY/CAPABILITY | HIGH | HIGH（激活时） | T01 |
| P1-T03 | Additional Retrieval Provider Capability Discovery（GATE-3） | DISCOVERY/EVIDENCE | HIGH | MEDIUM | — |
| P1-T04 | Minimum Persisted Research Plan Contract（D-3 interface） | CODE（interface-defining） | HIGH | HIGHEST | — |
| P1-T05 | ZhihuDataProvider seam + Official Search adapter + Session capture wrapper（D-2a） | CODE | HIGH | HIGH | — |
| P1-T06 | Multi-query retrieval + RRF candidate fusion（single pass，fixtures） | CODE | MEDIUM | MEDIUM | T04, T05 |
| P1-T07 | Retrieval loop + ResearchCoverageState + saturation feedback controller | CODE | HIGH | HIGH | T06 |
| P1-T08 | Source-group Set Selection / Ambiguity Gate（§7） | CODE | MEDIUM | MEDIUM | T07 |
| P1-T09 | Multi-group Execution State + Per-group Capture/Verify/Handoff composition | CODE | HIGH | HIGH | T08, T05 |
| P1-T10 | EmbeddingProvider adapter + cache | CODE | MEDIUM | MEDIUM | T01（+T02 if remote） |
| P1-T11 | Dense semantic geometry layer | CODE | MEDIUM | MEDIUM | T10, T06 |
| P1-T12 | RCE Corpus Selector（frozen baseline） | CODE | HIGH | HIGH | T09, T11 |
| P1-T13 | Question / Source-group logical representation layer | CODE | MEDIUM | MEDIUM | T12 |
| P1-T14 | Claim / Aspect representation + cross-source synthesis | CODE | MEDIUM | MEDIUM | T13 |
| P1-T15 | Analysis Coverage enforcement + v0.3 final synthesis integration + observability | CODE/INTEGRATION | MEDIUM | MEDIUM | T14, T07 |
| P1-T16 | End-to-end P1 research acceptance（dogfood） | DOGFOOD | MEDIUM | HIGH | T15, T03, T17 |
| P1-T17 | Additional retrieval provider adapter（CONDITIONAL，post GATE-3） | CODE | MEDIUM | LOW | T03, T05 |

## D. Ticket contracts

### P1-T01 — EmbeddingProvider Qualification Discovery（GATE-1）

- **TYPE**: DISCOVERY / EVIDENCE
- **GOAL**: 取得足以解锁 embedding 实现的独立资格证据：provider category（local vs remote）、
  具名候选 provider/model、identity/version 行为、vector dimension 与 validity contract、
  中文语义质量证据（P1 workload 适配度）、normalization identity、machine-readable failure identity、
  egress 影响。
- **WHY_NOW**: 最高不确定性 + 最长 evidence lead time；hardest-first 首选；解锁整个 dense 分支。
- **AUTHORITY**: Spec §5.3（EmbeddingProvider contract）、§10（isolation/egress）、§12（evidence
  caveats 随行）；V0.3 决策 C 逐 runtime 资格先例；Planning Gate GATE-1 定义。
- **IN_SCOPE**: 具名 runtime/provider 的 probe + 对抗 battery + 证据记录；local/remote 对比；
  候选排序建议。
- **OUT_OF_SCOPE**: production adapter 实现；cache schema；冻结 production model；
  执行 GATE-2；`bge-small-zh-v1.5` 不得因 harness 历史被默认批准。
- **BLOCKED_BY**: —；**BLOCKS**: T02、T10（并经 T10 → T11 → T12 影响 dense 支线）。
- **FILES_OR_COMPONENTS_EXPECTED**: `docs/planning/` 或 `docs/evidence/` 下 repo-tracked
  qualification report（runtime-scoped，含 probe/battery 结果与 caveat 复述）；探测脚本
  （discovery-only，不接入生产路径）。
- **ACCEPTANCE_CRITERIA**: 证据覆盖 GOAL 全部八项；结论 runtime/provider/profile-scoped、
  无跨 runtime 推导；显式给出去/留 egress 建议；`UNKNOWN != PASS`。
- **REQUIRED_TESTS**: probe/battery 脚本可复现（命令 + 期望布尔/结构化输出）；证据文件含
  exact 环境/版本/模型 identity（不含 credential 值）。
- **REQUIRED_EVIDENCE**: repo-tracked report + 可复现 probe 记录；sampled scope 显式标注。
- **FAIL_CLOSED / STOP_CONDITIONS**: 证据不足 → 结论 `UNKNOWN`（不 PASS 任何后续 ticket）；
  credential 值/哈希/前缀绝不入报告；发现需要新出网 → 移交 T02，不在本票内自我批准。
- **REVIEWER_QUORUM**: 1 × EVIDENCE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认（见 §B.8）。
- **PARALLELIZABLE_WITH**: T03、T04、T05、T06（master 集成仍串行）。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_PRO。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGHEST。

### P1-T02 — Remote Embedding Egress Authority（GATE-2，CONDITIONAL）

- **TYPE**: SECURITY / CAPABILITY
- **GOAL**: 若且仅若 T01 提议 remote embedding：将"公开知乎语料 → 具名 embedding provider"
  的出网决定转化为 **repo-tracked 显式 authority/evidence**（经适用 security/contract governance
  + independent review）。local embedding 路径则产出显式 `NO_NEW_EGRESS` 记录。
- **WHY_NOW**: 条件性激活（T01 结论触发）；必须在任何 remote embedding 实现（T10）之前完成。
- **AUTHORITY**: Spec §5.3 / §10；runtime-strategy §5（public egress ≠ private egress）；
  V0.3 T11 egress 先例（runtime-scoped、不得推广）；Planning Gate GATE-2 定义。
- **IN_SCOPE**: egress 决定记录（data class、destination provider identity、边界、reopen 条件）；
  `NO_NEW_EGRESS` 声明（local 路径）。
- **OUT_OF_SCOPE**: 私密/敏感语料出网批准；具体 ticket/review 形态的预先规定（Planning Gate
  已明示不预设）；任何代码实现。
- **BLOCKED_BY**: T01；**BLOCKS**: T10（仅 remote 路径）。
- **FILES_OR_COMPONENTS_EXPECTED**: repo-tracked decision record（e.g. `docs/evidence/`
  或既有 decision-record 惯例位置）。
- **ACCEPTANCE_CRITERIA**: 决定可被独立 reviewer 从 repo 验证（非聊天声明/executor note）；
  数据类别与边界明确；与 R5/T11 先例的一致性核对完成。
- **REQUIRED_TESTS**: 不适用（document/evidence 类）——以独立 review 为准。
- **REQUIRED_EVIDENCE**: repo-tracked authority record 本身。
- **FAIL_CLOSED / STOP_CONDITIONS**: 未取得 repo-tracked authority 前禁止任何 remote embedding
  实现；private/sensitive egress 一律 OUT，越界即 STOP。
- **REVIEWER_QUORUM**: SECURITY_REVIEWER + 1 × CODE_OR_CONTRACT_REVIEWER（同 exact HEAD）。
- **MERGE_REQUIREMENT**: 治理默认；双 reviewer 同 exact HEAD。
- **PARALLELIZABLE_WITH**: T03–T09（一旦激活）。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGH（激活时）。

### P1-T03 — Additional Retrieval Provider Capability Discovery（GATE-3）

- **TYPE**: DISCOVERY / EVIDENCE
- **GOAL**: 识别 / 资格确认**至少一个**额外 retrieval-ranked provider/capability，满足 Approved
  multi-query / multi-provider retrieval 合同（RRF channel = query + provider retrieval rankings；
  Session capture 不是 retrieval channel）。
- **WHY_NOW**: 长证据周期；不阻塞基础设施但阻塞 P1 完成宣称；早启动降低尾程风险。
- **AUTHORITY**: Spec §5.1（frozen official-first 顺序不重开）/ §5.4；Planning Gate GATE-3 /
  D-2b 定义。
- **IN_SCOPE**: 仅调查与初始 P1 真正相关的 capability；对候选 capability 的 contract 可行性、
  pagination/completeness 语义、failure identity 的证据。
- **OUT_OF_SCOPE**: 全 provider 大而全研究；任何 adapter 实现；OAuth/Session 新凭据设计
  （若选中 provider 需要 → 触发 D-9 升级为独立 provider-scoped prerequisite，另行成票）。
- **BLOCKED_BY**: —；**BLOCKS**: T17、T16（multi-provider completeness 前提）。
- **FILES_OR_COMPONENTS_EXPECTED**: repo-tracked discovery report（capability 候选、证据、
  推荐与 caveat）。
- **ACCEPTANCE_CRITERIA**: 至少一个候选具备可验证的 retrieval-ranking contract 证据；
  `UNKNOWN != PASS`；official-first 顺序未被重排。
- **REQUIRED_TESTS/EVIDENCE**: 可复现 probe；sampled scope 显式标注。
- **FAIL_CLOSED / STOP_CONDITIONS**: 无合格候选 → 保持 STOP（`BLOCKED_BY_EXTERNAL_EVIDENCE`），
  不得以 Session capture 冒充第二 channel。
- **REVIEWER_QUORUM**: 1 × EVIDENCE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01、T04–T12。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_PRO。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: MEDIUM。

### P1-T04 — Minimum Persisted Research Plan Contract（D-3 interface）

- **TYPE**: CODE（interface-defining）
- **GOAL**: 实现 minimum persisted plan artifact：query variants / aspects / entities / opposing
  framings / terminology variants / source-group intent / constraints 概念字段的 concrete schema、
  structured-output validation、planHash、与 stable run identity 的交互、invalid plan fail-closed、
  plan 变更时的 stale propagation boundary。
- **WHY_NOW**: 全部下游（retrieval/selection/execution）消费该接口；Planning Gate 指定的
  DAG 前部 interface ticket。
- **AUTHORITY**: Spec §4（概念字段冻结、plan authority、§4.3 identity 分离）；D-3 委派边界。
- **IN_SCOPE**: plan schema 模块 + validation + hashing + 失败语义 + focused tests。
- **OUT_OF_SCOPE**: universal research DSL；Planner 语义生成策略（后续实现票）；provider IO；
  任何 selection/verification authority。
- **BLOCKED_BY**: —；**BLOCKS**: T06、T08（以及经 T06 → 全部下游）。
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/lib/plan-contract.mjs`（或同级命名）、
  focused tests。
- **ACCEPTANCE_CRITERIA**: §4.1 六类概念字段全部可表达（未压缩为 `{queries[], aspects[]}`）；
  plan persisted + validated + hashed；invalid/unparseable → `planner_invalid` fail-closed；
  planHash 变更 → downstream 失效边界可测试；无 credential / machine-private path 入 plan。
- **REQUIRED_TESTS**: schema 往返、validation 边界、hash 稳定性、invalid fail-closed、
  stale propagation、run identity 不含 stochastic plan 输出。
- **REQUIRED_EVIDENCE**: focused tests 全绿 + 既有 suites 无回归。
- **FAIL_CLOSED / STOP_CONDITIONS**: 不得让自然语言自由文本当已验证 plan；不得把 planHash
  揉进 run identity 的随机部分。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01、T03、T05。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGHEST。

### P1-T05 — ZhihuDataProvider seam + Official Search adapter + Session capture wrapper（D-2a）

- **TYPE**: CODE
- **GOAL**: 实现 §5.1 最小 provider seam（provider_id / capability / auth_class / candidate or
  group identity / provenance / source_url / retrieved_at / completeness status / failure identity），
  并落地两个首段 adapter：Official Search（唯一已知 retrieval-ranked capability）+ 既有
  Session/Cookie capture primitive 的 capability wrapper（不重定义其 authority）。
- **WHY_NOW**: 检索与多组执行的公共底座；两 capability 均已存在，seam 是唯一新面。
- **AUTHORITY**: Spec §5.1（contract + frozen official-first policy）、§5.4；D-2a 委派边界。
- **IN_SCOPE**: seam contract 模块、两个 adapter、`NO_SILENT_PROVIDER_FALLBACK` 路由、
  focused tests。
- **OUT_OF_SCOPE**: 任何新 browser-scraping / Browser-Session data-access（仍需独立 Spec
  amendment）；OAuth；额外 retrieval provider（T17）；retrieval/selection 逻辑本身。
- **BLOCKED_BY**: —；**BLOCKS**: T06、T09、T17。
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/lib/provider-seam.mjs`（或同级）、
  adapter 模块、focused tests。
- **ACCEPTANCE_CRITERIA**: controller 可机械判断"哪个 provider/capability、哪个 candidate/group、
  是否分页完成、失败是什么"；completeness 不得猜测（complete/partial/unknown + evidence）；
  失败 machine-readable；unsupported capability → fail closed。
- **REQUIRED_TESTS**: seam contract 单测、双 adapter 契约测试、failure/completeness 语义、
  fallback 禁止断言。
- **REQUIRED_EVIDENCE**: focused tests + 既有 suites 无回归。
- **FAIL_CLOSED / STOP_CONDITIONS**: `UNKNOWN_PROVIDER_CONTRACT != PASS`；凭据不入 seam
  输出/日志。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01、T03、T04。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGH。

### P1-T06 — Multi-query retrieval + RRF candidate fusion（single pass，fixtures）

- **TYPE**: CODE
- **GOAL**: 按 plan 执行多 query 检索（经 provider seam retrieval channels），以确定性 RRF
  融合为 Candidate / Retrieval Pool；channel identity = query + provider/capability。
- **WHY_NOW**: T04/T05 就绪后的第一个消费级组合单元；generic RRF 用确定性 fixtures 即可验证，
  不依赖 GATE-3。
- **AUTHORITY**: Spec §5.4、§6.2（checkpoint 语义参照）；D-2a/D-2b 拆分结论。
- **IN_SCOPE**: 单轮 multi-query 检索编排、RRF 融合、pool artifact（含 provenance/channel 记录）、
  provider failure 传播。
- **OUT_OF_SCOPE**: 迭代 loop 与 saturation（T07）；group selection（T08）；第二 retrieval
  provider（T17）。
- **BLOCKED_BY**: T04, T05；**BLOCKS**: T07、T11。
- **FILES_OR_COMPONENTS_EXPECTED**: retrieval/RRF 模块（research-orchestration 侧）、
  fixture 测试集。
- **ACCEPTANCE_CRITERIA**: 同 query 多 channel 融合确定性可复现；provider 失败传播为
  machine-readable 且不静默降级；pool 记录每 candidate 的 channel provenance。
- **REQUIRED_TESTS**: RRF 确定性 fixtures（含 tie 语义）、failure 传播、provenance 完整性。
- **REQUIRED_EVIDENCE**: focused tests；fixtures 即证据（sampled scope 标注）。
- **FAIL_CLOSED / STOP_CONDITIONS**: 无有效 channel 结果 → fail（不虚构 pool）；
  `NO_SILENT_PROVIDER_FALLBACK`。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01/T02/T03（evidence 分支）。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T07 — Retrieval loop + ResearchCoverageState + saturation feedback controller

- **TYPE**: CODE
- **GOAL**: 定义并实现 **cross-cutting ResearchCoverageState**（Retrieval Coverage / Source
  Completeness / Analysis Coverage 三账目 + §9.4 diagnostics）与 **saturation feedback controller**：
  未饱和 → 追加 retrieval round（回到 T06）；饱和 / budget stop → 释放 pool 下行。
- **WHY_NOW**: 控制流骨架决定 T08–T15 的挂接点；architecture-sensitive。
- **AUTHORITY**: Spec §9（coverage 模型、simple deterministic saturation、语义边界）、§6.2；
  D-6 委派（阈值实现验证）。
- **IN_SCOPE**: CoverageState 模块 + update-hook 接口（供 T09/T12/T15 挂接）、round loop、
  saturation/budget 停止条件（默认值 + 实现验证）、§9.4 计数。
- **OUT_OF_SCOPE**: 冻结任何阈值；group selection；per-group 状态（T09 自有 artifact）。
- **BLOCKED_BY**: T06；**BLOCKS**: T08、T15（analysis assertion 消费）。
- **FILES_OR_COMPONENTS_EXPECTED**: coverage-state 模块 + loop controller + focused tests。
- **ACCEPTANCE_CRITERIA**: 反馈边可测试（未饱和确实再轮、budget 确实停止）；saturation 仅声明
  "当前策略下新信息增益趋缓"，不得宣称全站 coverage；诊断计数与 Spec §9.4 一致；默认值有
  implementation validation 记录。
- **REQUIRED_TESTS**: loop 迭代/停止、hook 更新语义、diagnostics、stale 传播。
- **REQUIRED_EVIDENCE**: focused tests + 阈值验证记录。
- **FAIL_CLOSED / STOP_CONDITIONS**: coverage 账目不可证 → 不得放行下游宣称 coverage。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01/T02/T03 分支。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGH。

### P1-T08 — Source-group Set Selection / Ambiguity Gate（§7）

- **TYPE**: CODE
- **GOAL**: 实现 selector **A**：Candidate/Retrieval Pool → `SelectedSourceGroups[]`。
  clear best group set → auto（可见/可记录）；material ambiguity → 至多一次 clarification；
  no valid group set → fail closed。
- **WHY_NOW**: selection 结果是 per-group capture 的输入；§7 amendment 的直接实现。
- **AUTHORITY**: Spec §7（inherited behavior + additive amendment）；父级 §5 candidate gate。
- **IN_SCOPE**: group set 构造、ambiguity 判定与 clarification 协议（≤1 次）、auto 决策记录、
  与 plan intent/constraints 的一致性校验。
- **OUT_OF_SCOPE**: RCE corpus selection（T12）；组内 top-percent 规模控制；verification。
- **BLOCKED_BY**: T07；**BLOCKS**: T09。
- **FILES_OR_COMPONENTS_EXPECTED**: selection 模块 + focused tests（参照既有
  `lib/selection.mjs` / decision-boundary matrix 方法）。
- **ACCEPTANCE_CRITERIA**: 三分支行为逐一可测；auto 决策可见/可记录；歧义绝不静默猜；
  selection artifact 含 planHash dependency。
- **REQUIRED_TESTS**: clear-best / ambiguity / no-valid 三态 + 决策记录 + planHash 依赖。
- **REQUIRED_EVIDENCE**: focused tests。
- **FAIL_CLOSED / STOP_CONDITIONS**: 无有效 group set → fail closed；不得把 clarification
  变成多次追问。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01/T02/T03/T10。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T09 — Multi-group Execution State + Per-group Capture/Verify/Handoff composition

- **TYPE**: CODE
- **GOAL**: 实现 §6 multi-group 执行：`SelectedSourceGroups[]` 消费、`PerGroupExecutionState`
  （逐组 capture/verify/handoff 状态、artifact 引用、hash/version、failure identity、resume
  boundary）、`VerifiedGroupRefs[]`（仅 valid）、`ResearchCorpusManifest`（仅从 verified refs
  + selector 输出确定性派生）；逐组复用既有 grabAll / verifier / make-handoff（经 T05 wrapper）。
- **WHY_NOW**: P1 与单问题 MVP 的核心差异面；checkpoint/hash 语义已有既有实现可扩展。
- **AUTHORITY**: Spec §6（全部 execution semantics）、§2.2（per-group authority 不变）；
  父级 §3（ORCHESTRATE_EXISTING_PRIMITIVES）。
- **IN_SCOPE**: 多组状态机扩展、逐组 capture/verify/handoff 编排、manifest 派生、resume /
  stale 传播、partial state 报告。
- **OUT_OF_SCOPE**: 新 handoff schema（§6.3 若需另行合同化）；verify 语义重实现；semantic 分析。
- **BLOCKED_BY**: T08, T05；**BLOCKS**: T12、T13。
- **FILES_OR_COMPONENTS_EXPECTED**: state/composition 模块扩展 + focused tests。
- **ACCEPTANCE_CRITERIA**: 每组独立 capture/verify（`captured != verified` 逐组）；一组完成不标
  其他组；中断恢复复用仍 valid 的完成组；stale/identity 变更 → 该组及依赖 artifact 失效；
  `FILE EXISTS != VALID CACHE`；manifest 非第二 canonical store；partial 不得渲染为 complete。
- **REQUIRED_TESTS**: 多组状态机全语义（A/B/C/D resume / stale / partial / manifest 派生）。
- **REQUIRED_EVIDENCE**: focused tests（含中断注入）。
- **FAIL_CLOSED / STOP_CONDITIONS**: captured group 进入 VerifiedGroupRefs → 直接 fail；
  credential 入 state → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01/T02/T03/T10/T11。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGH。

### P1-T10 — EmbeddingProvider adapter + cache

- **TYPE**: CODE
- **GOAL**: 按 §5.3 contract 实现具名 EmbeddingProvider adapter（T01 选出的 provider/category）
  与 cache：cache identity = canonical input hash + provider/model + embedding version +
  normalization version；vector validity 由 controller 校验；machine-readable failure identity；
  egress policy identity 记录。
- **WHY_NOW**: GATE-1（+remote 时 GATE-2）解锁后的直接实现单元。
- **AUTHORITY**: Spec §5.3、§10；D-7(a) 委派（cache schema）；T01/T02 结论为 authority 输入。
- **IN_SCOPE**: adapter、cache 持久化（flat-file 即可）、preflight（布尔模式，参照
  `preflight-deepseek.mjs`）、fail-closed。
- **OUT_OF_SCOPE**: vector database；dense 语义计算（T11）；runtime routing 变更；
  `DENSE_CAPABILITY_UNAVAILABLE` 之外的 degraded mode（需未来 Spec authority）。
- **BLOCKED_BY**: T01（+T02 if remote）；**BLOCKS**: T11。
- **FILES_OR_COMPONENTS_EXPECTED**: embedding adapter 模块 + cache 模块 + preflight + tests。
- **ACCEPTANCE_CRITERIA**: §5.3 八项 contract 字段全部落地；credential 值/路径内容不入
  cache identity；invalid vector → fail closed；cache 复用语义确定性可测。
- **REQUIRED_TESTS**: contract 字段、cache identity/reuse/stale、failure identity、preflight。
- **REQUIRED_EVIDENCE**: focused tests；local 路径须引用 T02 的 `NO_NEW_EGRESS` 记录。
- **FAIL_CLOSED / STOP_CONDITIONS**: 无 T02 authority 时实现 remote 路径 → STOP；
  embedding unavailable → `DENSE_CAPABILITY_UNAVAILABLE`（fail closed）。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T06–T09。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T11 — Dense semantic geometry layer

- **TYPE**: CODE
- **GOAL**: 在 Candidate/Retrieval Pool 上实现 dense geometry：relevance / novelty /
  redundancy 候选信号计算（供 T12 消费），含 normalization、批量/embedding 版本一致性校验。
- **WHY_NOW**: RCE selector 的核心几何输入；adapter 就绪后即可独立构建与测试。
- **AUTHORITY**: Spec §3.2（dense 为核心 semantic geometry；Top-K 弱 ≠ dense 弱）、§5.3。
- **IN_SCOPE**: geometry 计算模块 + 接口（供 selector 消费）+ tests。
- **OUT_OF_SCOPE**: selector 权重决策（T12，D-4）；训练任何模型；PCA/SVD 等排除项。
- **BLOCKED_BY**: T10, T06；**BLOCKS**: T12。
- **FILES_OR_COMPONENTS_EXPECTED**: dense-layer 模块 + tests。
- **ACCEPTANCE_CRITERIA**: 输出确定性可复现（同 input+model+version）；vector 缺失/无效 →
  fail closed（不静默降级为 popularity-only）。
- **REQUIRED_TESTS**: 几何计算确定性、failure 语义、版本一致性。
- **REQUIRED_EVIDENCE**: focused tests。
- **FAIL_CLOSED / STOP_CONDITIONS**: dense 不可用 → `DENSE_CAPABILITY_UNAVAILABLE` fail closed
  （`popularity-anchor-only` 不是合法 peer option）。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T08/T09。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T12 — RCE Corpus Selector（frozen baseline）

- **TYPE**: CODE
- **GOAL**: 实现 selector **B**：输入 verified candidate sources/groups + metadata + dense
  geometry，输出 Selected Verified Research Corpus。Frozen baseline：Question/Source-group
  Preservation + Popularity Anchor + Dense Relevance/Novelty + optional lightweight redundancy
  （MMR 仅 optional）。逐组 eligible/selected/verified/analyzed 计量 + exclusion reason category。
- **WHY_NOW**: corpus 构造的核心合同；D-4/D-5 的实现验证落点。
- **AUTHORITY**: Spec §3（frozen baseline + §3.1 preservation contract / 不冻结清单）、§1.1
  （corpus selection ≠ sampled analysis）；D-4/D-5 委派。
- **IN_SCOPE**: selector 实现、preservation 不变量、popularity anchor（非真理权威）、
  optional redundancy、per-group accounting、weights/floors 的 implementation validation。
- **OUT_OF_SCOPE**: six hard quotas；trained LTR / xQuAD / DPP 等 §11 排除项；
  group set selection（T08）；verification authority。
- **BLOCKED_BY**: T09, T11；**BLOCKS**: T13。
- **FILES_OR_COMPONENTS_EXPECTED**: rce-selector 模块 + tests（可参照 T8
  `top-percent-selector.mjs` 的确定性/validate/hash 工程模式，不复制其语义）。
- **ACCEPTANCE_CRITERIA**: 相关/少数派 group 不得无记录地零代表；answer count 不自动成为
  truth weight；选择输出 accounting 完整（eligible/selected/verified/analyzed + exclusion
  reasons）；不把 corpus construction 伪装为 `top-percent-analysis`；baseline 与
  `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST` 不冲突。
- **REQUIRED_TESTS**: preservation 不变量、accounting 完整性、anchor 非权威、MMR-optional
  语义、exclusion reasons。
- **REQUIRED_EVIDENCE**: focused tests + D-4/D-5 参数验证记录。
- **FAIL_CLOSED / STOP_CONDITIONS**: 大组静默吞小组 / 无记录 starving → fail；
  冒充 sampled mode → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —（dense/execution 汇合点）。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGH。

### P1-T13 — Question / Source-group logical representation layer

- **TYPE**: CODE
- **GOAL**: 为 selected corpus 中每组构建显式逻辑表示（独立于物理 chunk packing）：canonical
  group identity / provenance、selected/verified/analyzed accounting、main/minority/contradictory
  claims、expert / evidence-rich source refs、completeness & coverage state、discussion volume
  独立信号。
- **WHY_NOW**: §8 明确"现有 chunk/hierarchy = REUSABLE_AGGREGATION_INFRASTRUCTURE，
  逻辑层必须新增"。
- **AUTHORITY**: Spec §8.1、§2.3；§6.1（manifest 非 canonical）。
- **IN_SCOPE**: group representation 模块（可复用 corpus-anthology 聚合原语作 transport）+ tests。
- **OUT_OF_SCOPE**: 用 `canonicalSourceIds` union 冒充逻辑层；claim 级聚合（T14）。
- **BLOCKED_BY**: T12；**BLOCKS**: T14。
- **FILES_OR_COMPONENTS_EXPECTED**: group-representation 模块 + tests。
- **ACCEPTANCE_CRITERIA**: §8.1 字段全部可表达且可机械校验；与 manifest/canonical 数据一致性
  可验证。
- **REQUIRED_TESTS**: 表示完整性、与 canonical/manifest 一致性、minority/contradictory 保留。
- **REQUIRED_EVIDENCE**: focused tests。
- **FAIL_CLOSED / STOP_CONDITIONS**: 表示层与 canonical 事实冲突 → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T14 — Claim / Aspect representation + cross-source synthesis

- **TYPE**: CODE
- **GOAL**: 跨 group 聚合 claim/aspect（supporting/opposing sources、questions/groups、authors、
  expert/evidence-rich support；禁止只留 `support_count`），并产出 evidence-backed cross-source
  synthesis（widely shared / group-specific / minority / conflicting / source-group differences /
  evidence strength / discussion-volume 差异）。SemanticRuntime = `deepseek-api-tool-less`
  （Approved policy，不重开）；controller-owned identity/lineage，projection 隔离沿用既有实现。
- **WHY_NOW**: 逻辑层的直接消费者；P1 产品价值的核心输出面。
- **AUTHORITY**: Spec §8.2/§8.3、§5.2、§10.1（EXTERNAL_CORPUS 处理）；父级 R5 runtime policy。
- **IN_SCOPE**: claim/aspect 聚合模块、synthesis 编排、runtime 调用（经既有 tool-less 通道）、
  fail-closed。
- **OUT_OF_SCOPE**: 新 runtime qualification；flat reduce / naive equal weight；
  runtime fallback；P2/P3。
- **BLOCKED_BY**: T13；**BLOCKS**: T15。
- **FILES_OR_COMPONENTS_EXPECTED**: claim/aspect + synthesis 模块 + tests。
- **ACCEPTANCE_CRITERIA**: §8.2/§8.3 禁止项全部有负向测试；runtime 身份如实记录（节点身份
  反映真实传输）；runtime unavailable → fail（`NO_SILENT_RUNTIME_FALLBACK`）。
- **REQUIRED_TESTS**: 聚合语义（supporting/opposing/expert）、禁止项负向、failure 语义、
  runtime 身份记录。
- **REQUIRED_EVIDENCE**: focused tests；UNTRUSTED_CONTENT 投影安全断言。
- **FAIL_CLOSED / STOP_CONDITIONS**: projection/隔离不可用 → fail closed；coverage/lineage
  invalid → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T15 — Analysis Coverage enforcement + v0.3 final synthesis integration + observability

- **TYPE**: CODE / INTEGRATION
- **GOAL**: 100% Analysis Coverage enforcement（selected set == analyzed set 机械相等才可断言）；
  与既有 v0.3 final synthesis / render 路径集成；research-level observability（stage / mode
  identity / coverage / runtime identity / failure reason / final artifact refs，work-relative）；
  mode identity 继承 `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST`。
- **WHY_NOW**: 把 P1 管线接回既有产品出口；coverage assertion 是产品合同（§1 / §9.3）。
- **AUTHORITY**: Spec §1、§9.3、§15（status discipline）；父级 §10（observability）、§6。
- **IN_SCOPE**: coverage assertion、render/report 集成、披露块、事件/进度（research 级）、
  exit-code/失败语义对齐。
- **OUT_OF_SCOPE**: 新 GUI/dashboard；sampled 路径变更（既有合同不动）；版本分配。
- **BLOCKED_BY**: T14, T07；**BLOCKS**: T16。
- **FILES_OR_COMPONENTS_EXPECTED**: integration 模块 + render/披露扩展 + tests。
- **ACCEPTANCE_CRITERIA**: 两集合机械相等才输出 100% assertion（否则 fail/披露缺口）；
  partial 不渲染为 complete；observability 字段满足父级 §10 最低集；无 machine-private path。
- **REQUIRED_TESTS**: assertion 相等/不等两分支、披露完整性、失败语义、回归（v0.3 既有
  render/consumer 合同不变）。
- **REQUIRED_EVIDENCE**: focused tests + 既有 suites 回归。
- **FAIL_CLOSED / STOP_CONDITIONS**: 缺口冒充 full → fail；降级阈值放行 → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T16 — End-to-end P1 research acceptance（dogfood）

- **TYPE**: DOGFOOD
- **GOAL**: 真实端到端 P1 研究运行验收：多 Question/Source-group、multi-provider retrieval
  （GATE-3 完成）、100% analysis coverage assertion、双 selector 行为、resume 场景、披露完整。
- **WHY_NOW**: AGENTS.md DOGFOOD 票型；P1 完成宣称的唯一合法证据来源。
- **AUTHORITY**: Planning Gate / 本 DAG 的 acceptance 语义；父级 §13（G: real dogfood）先例；
  Spec §12 caveats 随行。
- **IN_SCOPE**: 真实运行记录、evidence 收集、验收结论（PASS/FAIL + reasons）。
- **OUT_OF_SCOPE**: 新 benchmark / 新 Gold 集（非本票发明）；降级阈值换取绿灯。
- **BLOCKED_BY**: T15, T03, T17；**BLOCKS**: —（P1 completion claim）。
- **FILES_OR_COMPONENTS_EXPECTED**: dogfood evidence（repo-tracked，脱敏，work-relative）。
- **ACCEPTANCE_CRITERIA**: 全链路真实运行 + 机械验证通过；coverage/saturation/披露与合同一致；
  失败场景至少一组真实记录。
- **REQUIRED_TESTS**: 不适用（acceptance evidence 类）。
- **REQUIRED_EVIDENCE**: repo-tracked dogfood 记录 + exact run identity。
- **FAIL_CLOSED / STOP_CONDITIONS**: 任一硬门（coverage/mode identity/披露/失败语义）不满足
  → 验收 FAIL，不得降级放行。
- **REVIEWER_QUORUM**: 1 × ACCEPTANCE_EVIDENCE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —（终局票）。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: HIGH。

### P1-T17 — Additional retrieval provider adapter（CONDITIONAL，post GATE-3）

- **TYPE**: CODE（CONDITIONAL — 具体范围在 T03 结论后按其报告 freeze，需 reviewer 接受）
- **GOAL**: 将 GATE-3 选中/资格确认的 retrieval-ranked capability 实现为 provider seam 下的
  第二 retrieval adapter，使 multi-provider RRF 成为真实能力。
- **WHY_NOW**: multi-provider retrieval 合同的实现侧闭环；full P1 completion 的必要条件。
- **AUTHORITY**: Spec §5.1/§5.4；T03 evidence；D-9 触发规则（若需新 OAuth/Session → 先独立
  provider-scoped prerequisite 票，本票自动 BLOCKED）。
- **IN_SCOPE**: 单个具名 capability 的 adapter + tests（fixtures + 真实 capability smoke）。
- **OUT_OF_SCOPE**: universal provider framework；更多 provider；browser scraping（仍需
  independent Spec amendment）；OAuth 设计（触发时另票）。
- **BLOCKED_BY**: T03, T05（+ D-9 prerequisite 若触发）；**BLOCKS**: T16。
- **FILES_OR_COMPONENTS_EXPECTED**: adapter 模块 + tests。
- **ACCEPTANCE_CRITERIA**: §5.1 seam contract 全字段满足；completeness/failure 语义不猜测；
  与 Official Search 在 RRF fixtures 中并行可测。
- **REQUIRED_TESTS**: adapter 契约 + RRF 双 channel fixtures。
- **REQUIRED_EVIDENCE**: focused tests + T03 report 引用。
- **FAIL_CLOSED / STOP_CONDITIONS**: capability 证据 `UNKNOWN` → 不得实现；
  `NO_SILENT_PROVIDER_FALLBACK`。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T07–T15（一旦解锁）。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: LOW。

## E. Discovery / security tickets

汇总：**T01（GATE-1，DISCOVERY）**、**T02（GATE-2，SECURITY，conditional on T01 提议 remote）**、
**T03（GATE-3，DISCOVERY）**。三个 gate 均可进入初始 DAG 并行启动/等待；每个 gate 的消费者：
T01 → T10/T11；T02 → T10（remote 分支）；T03 → T17/T16。D-9 触发升级规则挂在 T03 → T17 边上。

## F. Integration tickets

- **T15**：coverage enforcement + v0.3 render/synthesis 集成 + research observability；
- **T16**：端到端 dogfood 验收（DOGFOOD 票型，ACCEPTANCE_EVIDENCE_REVIEWER）。

## G. Deferred / explicitly absent tickets

- **D-8（global quality-score aggregation）**：初始 DAG **无 ticket**（`NO_TICKET_IN_INITIAL_DAG
  = YES`）；`APPROVED_SPEC_DECISION_STATUS = REMAINS_OPEN`；`DEFAULT = DO_NOT_INTRODUCE`。
- **D-9 OAuth/Session 新凭据设计**：无预置票；仅 T03 选中 provider 需要时另立
  provider-scoped prerequisite。
- **新 browser-scraping / Browser Session platform**：无票（非 goal，需独立 Spec amendment）。
- **Overengineering hard-ban 全清单**（universal provider framework / plugin platform / vector
  database / knowledge graph / microservices / event bus / workflow engine / distributed task
  queue / P2/P3 SQLite history / automatic browser platform / global quality score / trained
  ranking model / active learning / advanced stopping theory / six hard lanes / mandatory MMR /
  universal research DSL）：**均无 ticket**。
- **P2/P3 任何工作**：无票。

## H. Implementation authorization status

```text
本 decomposition = PLANNING ONLY
TICKET 定义存在 ≠ 授权执行
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
实现授权路径：ChatGPT 独立 Ticket Graph review PASS → freeze → issue-creation workflow
（依 repository authority 另行执行）→ 逐票 START_GATE。
```
