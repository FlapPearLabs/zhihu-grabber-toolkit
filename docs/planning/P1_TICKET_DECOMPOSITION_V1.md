# P1 Ticket Decomposition V1 — Implementation Ticket DAG（Planning Only）

```text
DOCUMENT_ID = P1_TICKET_DECOMPOSITION_V1
STATUS = REVIEW_PENDING
AUTHORITY_CLASS = NON_AUTHORITATIVE_PLANNING_CANDIDATE
REVIEWER = ChatGPT（外部独立 reviewer；本轮不 spawn 任何内置 reviewer）
REVIEW_CYCLE = R1 REPAIR（BASE_REVIEWED_HEAD = 31cce41122515129cf2e18c0a70984851dec00e1；
              ChatGPT 判定 CHANGES_REQUESTED：P0=0 / P1=5 / P2=2；本 commit 仅修复
              findings，不重开 Approved Spec / Planning Gate / 冻结结论）
BASE_SHA = 12788ce60fed39be6436b62525d4ba4d206f2b61（branch 的 master base）
BRANCH = planning/p1-ticket-decomposition-01
SCOPE = 仅本文件 + P1_TICKET_GRAPH_V1.md；零代码 / 零 Spec / 零 governance 改动
TICKET_COUNT = 18（UNCONDITIONAL = 16；CONDITIONAL = 2：P1-T02、P1-T17）
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
PROJECT_MEMORY_UPDATE_REQUIRED = NO
Date: 2026-08-29（R1 repair）
```

**本文件只做 Ticket Decomposition（planning）。** 任何 ticket 的定义存在 ≠ 该 ticket 已被授权执行。
实现授权只发生在下述 governance 顺序完成后。本文件不 reopen Approved Spec / Planning Gate 的任何
冻结结论。

---

## A. Authority baseline

- `git fetch origin` 已执行：`origin/master = 12788ce60fed39be6436b62525d4ba4d206f2b61`
  无 drift；branch tip = `31cce41`（BASE_REVIEWED_HEAD，R0 已获 ChatGPT 独立 Ticket Graph
  review，判定 CHANGES_REQUESTED）。
- Authority 全集完整读取核验（内容与本 session 前序任务一致，master 无变化）：`RULES.md`、
  `AGENTS.md`、`docs/project-memory.md`、四份 Applicable Approved Specs、
  `docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01.md`（已 INTEGRATED）、
  `docs/product-behavior-contract.md`、`docs/architecture/runtime-strategy.md`。
- 生产 seams 已实测核验（单问题状态机 / checkpoint hash / Official Search / Session capture /
  verifier / make-handoff / corpus runtime 路由；全仓无 embedding / 无 OAuth 代码）。
- 冻结输入（不重开）：`TICKETING_READY = YES`、`MUST_RESOLVE_BEFORE_TICKETING = empty`、
  GATE-1/2/3 定义、D-3 early interface、D-4/D-5/D-6 数值 = implementation validation、
  D-8 `DEFER_FROM_INITIAL_P1_BASELINE`（`NO_TICKET_IN_INITIAL_DAG = YES`）、
  D-9 lazy + GATE-3 触发升级、双 selector 分离、CoverageState cross-cutting + saturation feedback。

## B. Decomposition principles

1. **每张 ticket = 一个真实 contract boundary**：可独立理解、可独立测试、可独立 merge；
   拒绝"一张大票实现 P1"，也拒绝 20 行微票。
2. **双 selector 永不合并**：Source-group Set Selection（§7，capture 前）与 RCE Corpus Selector
   （§3 frozen baseline，capture/verify 后）是不同 ticket（T08 vs T12）。
3. **Planner 与 Plan contract 分离**：T04 = persisted plan contract / validation / planHash
   （interface）；T18 = Planner 语义生成（SemanticRuntime 消费者）。Planner 只拥有 semantic
   proposal；不拥有 provider IO / canonical identity / source validity / selection authority /
   verification authority。
4. **CoverageState cross-cutting + 所有权显式拆分**（R1）：T07 = contract + update hooks +
   retrieval-round controller infrastructure；T09 = Source Completeness 更新；T12 = selection
   accounting；T13/T14 = aspect/claim/contradiction/analyzed 诊断；T15 = 最终 cross-cutting
   集成 + 完整 saturation feedback wiring + 100% analysis assertion。运行期反馈边
   （round → CoverageState → saturation → 再检索 / 下行）是 **runtime loop，不是 ticket 依赖环**；
   Ticket DAG 保持无环。
5. **Security / discovery gates 显式成票**（T01/T02/T03），不藏在 code ticket 的 prose 里；
   GATE-1 不得绕过 GATE-2（真实知乎语料出网禁令，见 T01）。
6. **数值不冻结**：D-4/D-5/D-6 的所有阈值/权重/预算在各实现 ticket 内以
   `DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION` 方式验证。
7. **每个 ticket 继承全套既定不变量**：`captured != verified`、`UNKNOWN != PASS`、
   `FAIL_CLOSED`、`NO_SILENT_PROVIDER_FALLBACK`、`NO_SILENT_RUNTIME_FALLBACK`、
   `UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION`、credential 永不入 plan/state/manifest/events/
   cache identity/review artifacts、controller owns truth & authority / model owns semantics。
8. **Reviewer quorum 严格按 AGENTS.md**，不发明：CODE → 1×CODE_REVIEWER；
   DISCOVERY/EVIDENCE → 1×EVIDENCE_REVIEWER；SECURITY → SECURITY_REVIEWER +
   CODE_OR_CONTRACT_REVIEWER（同 exact HEAD）；DOGFOOD → 1×ACCEPTANCE_EVIDENCE_REVIEWER。
9. **统一 merge 纪律**（适用于全部 ticket，下文不再逐条重复）：scope-clean branch 自
   latest remote master 创建、required quorum 对 exact HEAD PASS、`git diff --check` clean、
   ff-only merge、push 后 remote verify；remote master 集成全局串行。

### Approved Spec requirement → ticket 覆盖矩阵

| Spec 条款 | 覆盖 |
|---|---|
| §4 Research Plan（概念字段/authority/planHash/run identity） | T04（contract/validation/hash）、T18（语义生成） |
| §5.1 ZhihuDataProvider seam + official-first policy（冻结，不重开） | T05（首段 adapter）、T03/T17（额外 retrieval provider） |
| §5.2 SemanticRuntime（deepseek-api-tool-less 冻结 policy） | T18（Planner）、T13（per-group claim extraction）、T14（synthesis）消费；无新资格 ticket |
| §5.3 EmbeddingProvider contract | T01（qualification）、T02（remote egress authority，conditional）、T10（adapter+cache）、T11（dense geometry） |
| §5.4 RRF boundary（query + provider retrieval rankings） | T06 |
| §6 multi-group execution / handoff / resume / manifest | T09 |
| §7 selection scope amendment（group set selection / ambiguity） | T08 |
| §3 frozen selector baseline + §3.1 preservation contract | T12（selection accounting / preservation invariants） |
| §8.1 logical group representation + per-group claims | T13（representation + per-group semantic claim extraction） |
| §8.2/§8.3 claim/aspect aggregation + cross-source synthesis | T14 |
| §9 CoverageState 三覆盖 + saturation + §9.4 diagnostics | T07（contract+hooks+round controller）、T09（source completeness）、T12（selection accounting）、T13/T14（aspect/claim/contradiction/analyzed 诊断）、T15（最终集成 + 完整 feedback wiring） |
| §10 security & failure semantics | 全部 ticket STOP 条件；T01（出网禁令）、T02 显式 security gate |
| §1.1 corpus selection ≠ sampled analysis；mode identity | T15（assertion + 披露）；T12 输出 selection accounting |
| 100% Analysis Coverage assertion（selected set == mapped/analyzed set 机械相等） | T15 |
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
| P1-T02 | Remote Embedding Egress Authority（GATE-2，CONDITIONAL，REMOTE ONLY） | SECURITY/CAPABILITY | HIGH | HIGH（激活时） | T01 |
| P1-T03 | Additional Retrieval Provider Capability Discovery（GATE-3） | DISCOVERY/EVIDENCE | HIGH | MEDIUM | — |
| P1-T04 | Minimum Persisted Research Plan Contract（D-3 interface） | CODE（interface-defining） | HIGH | HIGHEST | — |
| P1-T05 | ZhihuDataProvider seam + Official Search adapter + Session capture wrapper（D-2a） | CODE | HIGH | HIGH | — |
| P1-T06 | Multi-query retrieval + RRF candidate fusion（single pass，fixtures） | CODE | MEDIUM | MEDIUM | T18, T05 |
| P1-T07 | ResearchCoverageState contract + update hooks + retrieval-round controller infrastructure | CODE | HIGH | HIGH | T06 |
| P1-T08 | Source-group Set Selection / Ambiguity Gate（§7） | CODE | MEDIUM | MEDIUM | T07 |
| P1-T09 | Multi-group Execution State + Per-group Capture/Verify/Handoff composition | CODE | HIGH | HIGH | T08, T05 |
| P1-T10 | EmbeddingProvider adapter + cache（LOCAL/REMOTE 双路径依赖见合同） | CODE | MEDIUM | MEDIUM | LOCAL: T01 ｜ REMOTE: T01+T02 |
| P1-T11 | Dense semantic geometry layer | CODE | MEDIUM | MEDIUM | T10, T06 |
| P1-T12 | RCE Corpus Selector（frozen baseline；selection accounting） | CODE | HIGH | HIGH | T09, T11 |
| P1-T13 | Question/Source-group representation + per-group semantic claim extraction | CODE | MEDIUM | MEDIUM | T12 |
| P1-T14 | Cross-group Claim/Aspect aggregation + cross-source synthesis | CODE | MEDIUM | MEDIUM | T13 |
| P1-T15 | CoverageState final integration + 100% analysis assertion + v0.3 integration + observability | CODE/INTEGRATION | MEDIUM | MEDIUM | T14, T07 |
| P1-T16 | End-to-end P1 research acceptance（dogfood） | DOGFOOD | MEDIUM | HIGH | T15, T03, T17 |
| P1-T17 | Additional retrieval provider adapter（CONDITIONAL，post GATE-3） | CODE | MEDIUM | LOW | T03, T05（+D-9 amendment 若触发） |
| P1-T18 | Research Planner Semantic Proposal | CODE | HIGH | HIGH（T04 后） | T04 |

```text
机械核对：TICKET_COUNT = 18；UNCONDITIONAL = 16（T01,T03–T16,T18）；CONDITIONAL = 2（T02,T17）；
Ticket ID 空间 = T01..T18 恰好连续，无重编号。
```

## D. Ticket contracts

### P1-T01 — EmbeddingProvider Qualification Discovery（GATE-1）

- **TYPE**: DISCOVERY / EVIDENCE
- **GOAL**: 取得足以解锁 embedding 实现的独立资格证据：provider category（local vs remote）、
  具名候选 provider/model、identity/version 行为、vector dimension 与 validity contract、
  中文语义质量证据（P1 workload 适配度）、normalization identity、machine-readable failure identity、
  egress 影响。
- **WHY_NOW**: 最高不确定性 + 最长 evidence lead time；hardest-first 首选；解锁整个 dense 分支。
- **AUTHORITY**: Spec §5.3、§10、§12（evidence caveats 随行）；V0.3 决策 C 逐 runtime 资格先例；
  Planning Gate GATE-1 定义。
- **IN_SCOPE**: 具名 runtime/provider 的 probe + 对抗 battery + 证据记录；local/remote 对比；
  候选排序建议。
  **出网约束（R1，P1-3）**：在 T02 remote-egress authority PASS 之前，T01 对任何 remote
  EmbeddingProvider 的 qualification **只允许**使用 synthetic Chinese fixtures / handcrafted
  P1-like fixtures / 非敏感 benchmark / neutral text；**禁止**发送：真实知乎语料、本产品检索到的
  知乎源文本、任何真实 EXTERNAL_CORPUS。
- **OUT_OF_SCOPE**: production adapter 实现；cache schema；冻结 production model；执行 GATE-2；
  `bge-small-zh-v1.5` 不得因 harness 历史被默认批准。
- **BLOCKED_BY**: —；**BLOCKS**: T02（conditional）、T10。
- **FILES_OR_COMPONENTS_EXPECTED**: repo-tracked qualification report（runtime-scoped）+ 可复现
  probe 脚本（discovery-only，不接入生产路径）。
- **ACCEPTANCE_CRITERIA**: 证据覆盖 GOAL 全部八项；结论 runtime/provider/profile-scoped、
  无跨 runtime 推导；`UNKNOWN != PASS`。
  **local 结局（R1，P1-2）**：report 必须含 repo-tracked `NO_NEW_EGRESS = YES` 记录，
  供 T10 local 路径直接引用。
  **remote 结局（R1）**：report 须声明 qualification 仅用 fixtures/neutral text；若代表性
  qualification 无法在不使用真实公开知乎语料出网的情况下完成 → report 记录
  `REQUIRES_REMOTE_EGRESS_AUTHORITY` 并 **STOP 该 probe**——不得先行出网再补批准。
- **REQUIRED_TESTS/EVIDENCE**: 可复现 probe/battery（命令 + 期望输出）；fixture 来源与范围
  显式标注；无 credential 值/哈希/前缀。
- **FAIL_CLOSED / STOP_CONDITIONS**: 证据不足 → `UNKNOWN`；触发
  `REQUIRES_REMOTE_EGRESS_AUTHORITY` → 该 probe STOP，移交 T02。
- **REVIEWER_QUORUM**: 1 × EVIDENCE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认（见 §B.9）。
- **PARALLELIZABLE_WITH**: T03、T04、T05、T18（master 集成仍串行）。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_PRO。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGHEST。

### P1-T02 — Remote Embedding Egress Authority（GATE-2，CONDITIONAL，REMOTE ONLY）

- **TYPE**: SECURITY / CAPABILITY
- **GOAL（R1，P1-2）**: 本票 **仅覆盖 remote 路径**，且 **iff T01 提议 remote EmbeddingProvider**
  时激活：将"公开知乎语料 → 具名 remote embedding provider"的出网决定转化为 **repo-tracked
  显式 authority/evidence**（经适用 security/contract governance + independent review）。
- **WHY_NOW**: 条件性激活；必须在任何 remote embedding 实现（T10 remote 分支）之前完成。
- **AUTHORITY**: Spec §5.3 / §10；runtime-strategy §5；V0.3 T11 egress 先例；Planning Gate GATE-2。
- **IN_SCOPE**: remote egress 决定记录（data class、destination provider identity、边界、reopen 条件）。
- **OUT_OF_SCOPE**: local 路径的 `NO_NEW_EGRESS` 记录（归 T01 report，不在本票）；私密/敏感
  语料出网；任何代码实现。
- **BLOCKED_BY**: T01；**BLOCKS**: T10（仅 remote 分支）。
- **FILES_OR_COMPONENTS_EXPECTED**: repo-tracked decision record。
- **ACCEPTANCE_CRITERIA**: 决定可被独立 reviewer 从 repo 验证（非聊天声明/executor note）；
  数据类别与边界明确；与 R5/T11 先例一致性核对完成。
- **REQUIRED_TESTS**: 不适用（document/evidence 类）。
- **REQUIRED_EVIDENCE**: repo-tracked authority record 本身。
- **FAIL_CLOSED / STOP_CONDITIONS**: 未取得本票 authority 前禁止任何 remote embedding 实现；
  private/sensitive egress 一律 OUT，越界即 STOP。
- **REVIEWER_QUORUM**: SECURITY_REVIEWER + 1 × CODE_OR_CONTRACT_REVIEWER（同 exact HEAD）。
- **MERGE_REQUIREMENT**: 治理默认；双 reviewer 同 exact HEAD。
- **PARALLELIZABLE_WITH**: T03–T09、T18（一旦激活）。
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
- **IN_SCOPE**: 仅调查与初始 P1 真正相关的 capability；contract 可行性、pagination/completeness
  语义、failure identity 证据。
- **OUT_OF_SCOPE**: 全 provider 大而全研究；任何 adapter 实现；OAuth/Session 新凭据设计
  （若选中 provider 需要 → 触发 D-9 **scoped Ticket Graph amendment**，见 §H）。
- **BLOCKED_BY**: —；**BLOCKS**: T17、T16（multi-provider completeness 前提）。
- **FILES_OR_COMPONENTS_EXPECTED**: repo-tracked discovery report。
- **ACCEPTANCE_CRITERIA**: 至少一个候选具备可验证的 retrieval-ranking contract 证据；
  `UNKNOWN != PASS`；official-first 顺序未被重排。
- **REQUIRED_TESTS/EVIDENCE**: 可复现 probe；sampled scope 显式标注。
- **FAIL_CLOSED / STOP_CONDITIONS**: 无合格候选 → 保持 STOP（`BLOCKED_BY_EXTERNAL_EVIDENCE`），
  不得以 Session capture 冒充第二 channel。
- **REVIEWER_QUORUM**: 1 × EVIDENCE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01、T04、T05、T18、T06–T15。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_PRO。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: MEDIUM。

### P1-T04 — Minimum Persisted Research Plan Contract（D-3 interface）

- **TYPE**: CODE（interface-defining）
- **GOAL**: 实现 minimum persisted plan artifact：query variants / aspects / entities / opposing
  framings / terminology variants / source-group intent / constraints 概念字段的 concrete schema、
  structured-output validation、planHash、与 stable run identity 的交互、invalid plan fail-closed、
  plan 变更时的 stale propagation boundary。
- **WHY_NOW**: Planner（T18）与全部下游消费该接口；Planning Gate 指定的 DAG 前部 interface ticket。
- **AUTHORITY**: Spec §4（概念字段冻结、plan authority、§4.3 identity 分离）；D-3 委派边界。
- **IN_SCOPE**: plan schema 模块 + validation + hashing + 失败语义 + focused tests。
- **OUT_OF_SCOPE**: universal research DSL；Planner 语义生成（T18）；provider IO；任何
  selection/verification authority。
- **BLOCKED_BY**: —；**BLOCKS**: T18、T08。
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/lib/plan-contract.mjs`（或同级命名）、
  focused tests。
- **ACCEPTANCE_CRITERIA**: §4.1 六类概念字段全部可表达；plan persisted + validated + hashed；
  invalid/unparseable → `planner_invalid` fail-closed；planHash 变更 → downstream 失效边界可测试；
  无 credential / machine-private path 入 plan。
- **REQUIRED_TESTS**: schema 往返、validation 边界、hash 稳定性、invalid fail-closed、
  stale propagation、run identity 不含 stochastic plan 输出。
- **REQUIRED_EVIDENCE**: focused tests 全绿 + 既有 suites 无回归。
- **FAIL_CLOSED / STOP_CONDITIONS**: 不得让自然语言自由文本当已验证 plan；planHash 不进
  run identity 的随机部分。
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
- **AUTHORITY**: Spec §5.1、§5.4；D-2a 委派边界。
- **IN_SCOPE**: seam contract 模块、两个 adapter、`NO_SILENT_PROVIDER_FALLBACK` 路由、
  focused tests。
- **OUT_OF_SCOPE**: 任何新 browser-scraping / Browser-Session data-access（仍需独立 Spec
  amendment）；OAuth；额外 retrieval provider（T17）；retrieval/selection 逻辑本身。
- **BLOCKED_BY**: —；**BLOCKS**: T06、T09、T17。
- **FILES_OR_COMPONENTS_EXPECTED**: `research-orchestration/lib/provider-seam.mjs`（或同级）、
  adapter 模块、focused tests。
- **ACCEPTANCE_CRITERIA**: controller 可机械判断"哪个 provider/capability、哪个 candidate/group、
  是否分页完成、失败是什么"；completeness 不猜测；失败 machine-readable；unsupported
  capability → fail closed。
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

### P1-T18 — Research Planner Semantic Proposal（R1 新增）

- **TYPE**: CODE
- **GOAL**: `USER_REQUEST → approved SemanticRuntime（deepseek-api-tool-less，Approved policy）
  → semantic plan proposal → T04 structured validation → persisted Research Plan → planHash`。
  Planner 输出必须保留 §4.1 六类概念字段：query variants / aspects / entities / opposing
  framings / terminology variants / source-group intent / constraints。
- **WHY_NOW**: Approved Spec 将 Research Planner 列为 NEW P1 capability；R0 仅实现了 plan
  contract 而无人生成 plan（reviewer P1-1）。T04 合并后即解锁。
- **AUTHORITY**: Spec §4（Planner 只拥有 semantic proposal；§4.2 authority 限制）、§5.2
  （public-Zhihu SemanticRuntime = deepseek-api-tool-less，不重开）；父级 R5；NO_SILENT_RUNTIME_FALLBACK。
- **IN_SCOPE**: Planner 调用编排（经既有 tool-less runtime 通道）、prompt/projection 构造
  （沿用既有隔离实现）、输出交 T04 validation、失败语义、focused tests。
- **OUT_OF_SCOPE**: provider IO；canonical identity；source validity；selection authority；
  verification authority；universal research DSL；runtime fallback；新 runtime qualification。
- **BLOCKED_BY**: T04；**BLOCKS**: T06。
- **FILES_OR_COMPONENTS_EXPECTED**: planner 编排模块（research-orchestration 侧）+ focused tests。
- **ACCEPTANCE_CRITERIA**: 输出经 T04 validation 才成为 persisted plan（不绕过）；invalid/
  unparseable → `planner_invalid` FAIL_CLOSED；runtime unavailable → FAIL_CLOSED +
  `NO_SILENT_RUNTIME_FALLBACK`；runtime 身份如实记录；credential 不入 prompt/输出/state。
- **REQUIRED_TESTS**: 语义 proposal → validation 往返、六类字段保留、invalid fail-closed、
  runtime 失败传播、身份记录。
- **REQUIRED_EVIDENCE**: focused tests；fixtures 驱动（真实 runtime smoke 可选）。
- **FAIL_CLOSED / STOP_CONDITIONS**: Planner 不得获得任何 IO/identity/selection/verification
  权限；越权即 STOP。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01/T02/T03（evidence 分支）、T05。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGH。

### P1-T06 — Multi-query retrieval + RRF candidate fusion（single pass，fixtures）

- **TYPE**: CODE
- **GOAL**: 按 persisted plan（T18 生成、T04 validated）执行多 query 检索（经 provider seam
  retrieval channels），以确定性 RRF 融合为 Candidate / Retrieval Pool；channel identity =
  query + provider/capability。
- **WHY_NOW**: T18/T05 就绪后的第一个消费级组合单元；generic RRF 用确定性 fixtures 即可验证，
  不依赖 GATE-3。
- **AUTHORITY**: Spec §5.4、§6.2；D-2a/D-2b 拆分结论。
- **IN_SCOPE**: 单轮 multi-query 检索编排、RRF 融合、pool artifact（含 provenance/channel 记录）、
  provider failure 传播。
- **OUT_OF_SCOPE**: 迭代 round 机制（T07 infrastructure）；saturation 决策（T07 contract +
  T15 wiring）；group selection（T08）；第二 retrieval provider（T17）。
- **BLOCKED_BY**: T18, T05；**BLOCKS**: T07、T11。
- **FILES_OR_COMPONENTS_EXPECTED**: retrieval/RRF 模块、fixture 测试集。
- **ACCEPTANCE_CRITERIA**: 同 query 多 channel 融合确定性可复现；provider 失败传播
  machine-readable 且不静默降级；pool 记录每 candidate 的 channel provenance。
- **REQUIRED_TESTS**: RRF 确定性 fixtures（含 tie 语义）、failure 传播、provenance 完整性。
- **REQUIRED_EVIDENCE**: focused tests；fixtures 即证据（sampled scope 标注）。
- **FAIL_CLOSED / STOP_CONDITIONS**: 无有效 channel 结果 → fail；`NO_SILENT_PROVIDER_FALLBACK`。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01/T02/T03（evidence 分支）。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T07 — ResearchCoverageState contract + update hooks + retrieval-round controller infrastructure

- **TYPE**: CODE
- **GOAL（R1，P1-4 所有权修复）**: 实现 **ResearchCoverageState contract**（Retrieval Coverage /
  Source Completeness / Analysis Coverage 三账目 schema + §9.4 diagnostics 计数）、**update-hook
  接口**（供 T09/T12/T13/T14/T15 挂接）与 **retrieval-round controller infrastructure**
  （round 循环机制；saturation decision 的 retrieval 级机制可用 fixtures 测试）。
- **WHY_NOW**: 控制流骨架决定 T08–T15 的挂接点；architecture-sensitive。
- **AUTHORITY**: Spec §9、§6.2；D-6 委派（阈值实现验证）。
- **IN_SCOPE**: CoverageState 模块、hook 接口、round 循环机制、D-6 默认值（implementation
  validation 记录）。
- **OUT_OF_SCOPE / 所有权边界（R1）**: 本票**不得**宣称"完整 P1 saturation 集成完成"——
  完整 feedback wiring 是 **T15**；Source Completeness 更新归 **T09**；selection accounting 归
  **T12**；aspect/claim/contradiction/analyzed 诊断归 **T13/T14**。运行期反馈
  （round → CoverageState → saturation decision → 未饱和 → 回 T06 再检索；饱和 / budget stop →
  下行）是 runtime loop，**不是 ticket 依赖环**。
- **BLOCKED_BY**: T06；**BLOCKS**: T08、T15（最终集成时消费）。
- **FILES_OR_COMPONENTS_EXPECTED**: coverage-state 模块 + hook 接口 + round controller + tests。
- **ACCEPTANCE_CRITERIA**: 三账目 schema 与 §9 一致；hook 契约可独立测试；round 机制确定性；
  饱和语义不越界（仅"当前策略下新信息增益趋缓"）；阈值不冻结、有 implementation validation 记录。
- **REQUIRED_TESTS**: hook 契约、round 机制、diagnostics、stale 传播、阈值验证记录。
- **REQUIRED_EVIDENCE**: focused tests。
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
- **AUTHORITY**: Spec §7；父级 §5 candidate gate。
- **IN_SCOPE**: group set 构造、ambiguity 判定与 clarification 协议（≤1 次）、auto 决策记录、
  与 plan intent/constraints 一致性校验。
- **OUT_OF_SCOPE**: RCE corpus selection（T12）；组内 top-percent 规模控制；verification。
- **BLOCKED_BY**: T07；**BLOCKS**: T09。
- **FILES_OR_COMPONENTS_EXPECTED**: selection 模块 + focused tests。
- **ACCEPTANCE_CRITERIA**: 三分支行为逐一可测；auto 决策可见/可记录；歧义绝不静默猜；
  selection artifact 含 planHash dependency。
- **REQUIRED_TESTS**: clear-best / ambiguity / no-valid 三态 + 决策记录 + planHash 依赖。
- **REQUIRED_EVIDENCE**: focused tests。
- **FAIL_CLOSED / STOP_CONDITIONS**: 无有效 group set → fail closed；clarification ≤1 次。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01/T02/T03/T10。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T09 — Multi-group Execution State + Per-group Capture/Verify/Handoff composition

- **TYPE**: CODE
- **GOAL**: 实现 §6 multi-group 执行：`SelectedSourceGroups[]` 消费、`PerGroupExecutionState`、
  `VerifiedGroupRefs[]`（仅 valid）、`ResearchCorpusManifest`（仅从 verified refs + selector
  输出确定性派生）；逐组复用既有 grabAll / verifier / make-handoff（经 T05 wrapper）。
  **同时（R1，P1-4）**：向 CoverageState 提供 **Source Completeness 更新**（经 T07 hook）。
- **WHY_NOW**: P1 与单问题 MVP 的核心差异面；checkpoint/hash 语义已有既有实现可扩展。
- **AUTHORITY**: Spec §6、§2.2、§9.2；父级 §3。
- **IN_SCOPE**: 多组状态机扩展、逐组 capture/verify/handoff 编排、manifest 派生、resume /
  stale 传播、partial 报告、Source Completeness hook 更新。
- **OUT_OF_SCOPE**: 新 handoff schema（§6.3 若需另行合同化）；verify 语义重实现；semantic 分析。
- **BLOCKED_BY**: T08, T05；**BLOCKS**: T12、T13。
- **FILES_OR_COMPONENTS_EXPECTED**: state/composition 模块扩展 + focused tests。
- **ACCEPTANCE_CRITERIA**: 每组独立 capture/verify（`captured != verified` 逐组）；resume 复用
  仍 valid 完成组；stale/identity 变更 → 该组及依赖 artifact 失效；`FILE EXISTS != VALID CACHE`；
  manifest 非第二 canonical store；partial 不得渲染为 complete；per-group 完整性经 hook 如实
  进入 CoverageState。
- **REQUIRED_TESTS**: 多组状态机全语义 + hook 更新断言。
- **REQUIRED_EVIDENCE**: focused tests（含中断注入）。
- **FAIL_CLOSED / STOP_CONDITIONS**: captured group 进入 VerifiedGroupRefs → 直接 fail；
  credential 入 state → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T01/T02/T03/T10/T11。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGH。

### P1-T10 — EmbeddingProvider adapter + cache（LOCAL/REMOTE 双路径依赖）

- **TYPE**: CODE
- **GOAL**: 按 §5.3 contract 实现具名 EmbeddingProvider adapter（T01 选出的 provider/category）
  与 cache：cache identity = canonical input hash + provider/model + embedding version +
  normalization version；vector validity 由 controller 校验；failure identity；egress policy
  identity 记录。
- **WHY_NOW**: GATE-1 解锁后的直接实现单元。
- **AUTHORITY**: Spec §5.3、§10；D-7(a) 委派；T01 report / T02 authority 为条件输入。
- **IN_SCOPE**: adapter、cache 持久化（flat-file 即可）、preflight（布尔模式）、fail-closed。
- **OUT_OF_SCOPE**: vector database；dense 计算（T11）；runtime routing 变更；degraded mode。
- **BLOCKED_BY（R1，P1-2 条件依赖）**:
  - **LOCAL 路径**: `BLOCKED_BY = T01`；`REQUIRED_EVIDENCE = T01 report 之 NO_NEW_EGRESS = YES
    记录`（不要求未激活的 T02）。
  - **REMOTE 路径**: `BLOCKED_BY = T01 + T02`；`REQUIRED_EVIDENCE = T02 remote egress authority`。
- **BLOCKS**: T11。
- **FILES_OR_COMPONENTS_EXPECTED**: embedding adapter 模块 + cache 模块 + preflight + tests。
- **ACCEPTANCE_CRITERIA**: §5.3 八项 contract 字段全部落地；credential 值/路径内容不入 cache
  identity；invalid vector → fail closed；cache 复用语义确定性可测；egress policy identity 与
  实际路径一致（local 无新出网 / remote 有 T02 authority）。
- **REQUIRED_TESTS**: contract 字段、cache identity/reuse/stale、failure identity、preflight、
  路径一致性。
- **REQUIRED_EVIDENCE**: focused tests + 相应路径 evidence（T01 NO_NEW_EGRESS 记录或 T02 authority）。
- **FAIL_CLOSED / STOP_CONDITIONS**: remote 路径无 T02 authority → STOP；
  `DENSE_CAPABILITY_UNAVAILABLE` → fail closed。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T06–T09、T18。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T11 — Dense semantic geometry layer

- **TYPE**: CODE
- **GOAL**: 在 Candidate/Retrieval Pool 上实现 dense geometry：relevance / novelty / redundancy
  候选信号计算（供 T12 消费），含 normalization、embedding 版本一致性校验。
- **WHY_NOW**: RCE selector 的核心几何输入；adapter 就绪后即可独立构建与测试。
- **AUTHORITY**: Spec §3.2、§5.3。
- **IN_SCOPE**: geometry 计算模块 + 接口 + tests。
- **OUT_OF_SCOPE**: selector 权重决策（T12，D-4）；训练任何模型；§11 排除项。
- **BLOCKED_BY**: T10, T06；**BLOCKS**: T12。
- **FILES_OR_COMPONENTS_EXPECTED**: dense-layer 模块 + tests。
- **ACCEPTANCE_CRITERIA**: 输出确定性可复现；vector 缺失/无效 → fail closed（不静默降级为
  popularity-only）。
- **REQUIRED_TESTS**: 几何确定性、failure 语义、版本一致性。
- **REQUIRED_EVIDENCE**: focused tests。
- **FAIL_CLOSED / STOP_CONDITIONS**: dense 不可用 → `DENSE_CAPABILITY_UNAVAILABLE` fail closed。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T08/T09。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T12 — RCE Corpus Selector（frozen baseline；selection accounting）

- **TYPE**: CODE
- **GOAL**: 实现 selector **B**：输入 verified candidate sources/groups + metadata + dense
  geometry，输出 Selected Verified Research Corpus（含 corpus identity）。Frozen baseline：
  Question/Source-group Preservation + Popularity Anchor + Dense Relevance/Novelty + optional
  lightweight redundancy（MMR 仅 optional）。
- **WHY_NOW**: corpus 构造的核心合同；D-4/D-5 的实现验证落点。
- **AUTHORITY**: Spec §3、§1.1、§9.2（selected/verified 计量）；D-4/D-5 委派。
- **IN_SCOPE（R1，P1-5A 计数所有权）**: 本票发生在分析之前，拥有：**eligible 计数、selected
  计数、verified 计数、exclusion reason categories、Selected Verified Research Corpus identity、
  selection accounting / preservation invariants**；并向 CoverageState 提供 **selection
  accounting 更新**（经 T07 hook）。
- **OUT_OF_SCOPE**: **最终 `analyzed` 计数**（归 T13/T14 更新、T15 终审）；six hard quotas；
  trained LTR 等排除项；group set selection（T08）；verification authority。
- **BLOCKED_BY**: T09, T11；**BLOCKS**: T13。
- **FILES_OR_COMPONENTS_EXPECTED**: rce-selector 模块 + tests。
- **ACCEPTANCE_CRITERIA**: 相关/少数派 group 不得无记录地零代表；answer count 不自动成为
  truth weight；eligible/selected/verified + exclusion reasons 完整且可测；selection 不伪装为
  `top-percent-analysis`；与 `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST` 不冲突。
- **REQUIRED_TESTS**: preservation 不变量、selection accounting 完整性、anchor 非权威、
  MMR-optional 语义、exclusion reasons。
- **REQUIRED_EVIDENCE**: focused tests + D-4/D-5 参数验证记录。
- **FAIL_CLOSED / STOP_CONDITIONS**: 大组静默吞小组 / 无记录 starving → fail；冒充 sampled
  mode → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —（dense/execution 汇合点）。
- **IMPLEMENTATION_MODEL_CLASS**: GLM_5_3_FLASH_EXTREME。
- **RISK_CLASS**: HIGH；**READY-SET PRIORITY**: HIGH。

### P1-T13 — Question/Source-group representation + per-group semantic claim extraction（R1 所有权修复）

- **TYPE**: CODE
- **GOAL**: 为 selected corpus 中每组构建显式逻辑表示（§8.1），并执行 **per-group semantic
  claim extraction**（SemanticRuntime = `deepseek-api-tool-less`，在既有 tool-less /
  UNTRUSTED_CONTENT 隔离下）：main claims / minority claims / contradictory claims /
  expert & evidence-rich source refs / discussion-volume 独立信号。
- **WHY_NOW**: per-group claims 是 T14 跨组聚合的直接生产者；R0 中该语义处理无明确所有权
  （reviewer P1-5B）。
- **AUTHORITY**: Spec §8.1、§5.2、§10.1（EXTERNAL_CORPUS）；§6.1（manifest 非 canonical）。
- **IN_SCOPE**: group representation 模块 + per-group claim extraction 编排 + 输出：
  canonical group identity / provenance、selected/verified accounting、**per-group
  mapped/analyzed accounting 更新**（经 T07 hook）、main/minority/contradictory claims、
  expert/evidence-rich refs、completeness/coverage state、discussion-volume 信号。
- **OUT_OF_SCOPE**: 跨组聚合（T14）；用 `canonicalSourceIds` union 冒充逻辑层；runtime fallback。
- **BLOCKED_BY**: T12；**BLOCKS**: T14。
- **FILES_OR_COMPONENTS_EXPECTED**: group-representation + per-group extraction 模块 + tests。
- **ACCEPTANCE_CRITERIA**: §8.1 字段全部可表达且可机械校验；claims 经 controller 校验 /
  controller-owned identity（模型只回短 token / 语义，不拥有 sourceId）；runtime unavailable →
  fail closed；任一来源失败 → 该组 fail closed（无部分结果冒充）；runtime 身份如实记录。
- **REQUIRED_TESTS**: 表示完整性、claims 抽取契约、隔离/投影安全、失败语义、accounting 更新。
- **REQUIRED_EVIDENCE**: focused tests。
- **FAIL_CLOSED / STOP_CONDITIONS**: 表示层与 canonical 冲突 → fail；投影/隔离不可用 → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T14 — Cross-group Claim/Aspect aggregation + cross-source synthesis（R1 所有权修复）

- **TYPE**: CODE
- **GOAL**: 消费 T13 的 per-group representations，执行 **跨 group Claim/Aspect 聚合**
  （supporting/opposing sources、questions/groups/authors、expert/evidence-rich support；
  禁止只留 `support_count`）并产出 cross-source synthesis（widely shared / group-specific /
  minority / conflicting claims / source-group differences / evidence strength /
  discussion-volume 差异）。
- **WHY_NOW**: T13 输出的直接消费者；P1 产品价值的核心输出面。
- **AUTHORITY**: Spec §8.2/§8.3、§5.2、§10.1；父级 R5。
- **IN_SCOPE**: claim/aspect 跨组聚合模块、synthesis 编排、aspect/claim/contradiction/
  analyzed 诊断更新（经 T07 hook）、fail-closed。
- **OUT_OF_SCOPE**: per-group claim 抽取（T13）；新 runtime qualification；flat reduce /
  naive equal weight；runtime fallback；P2/P3。
- **BLOCKED_BY**: T13；**BLOCKS**: T15。
- **FILES_OR_COMPONENTS_EXPECTED**: 聚合 + synthesis 模块 + tests。
- **ACCEPTANCE_CRITERIA**: §8.2/§8.3 禁止项全部有负向测试；lineage controller-owned；
  runtime unavailable → fail；诊断经 hook 如实更新。
- **REQUIRED_TESTS**: 聚合语义、禁止项负向、failure 语义、hook 更新。
- **REQUIRED_EVIDENCE**: focused tests；UNTRUSTED_CONTENT 投影安全断言。
- **FAIL_CLOSED / STOP_CONDITIONS**: coverage/lineage invalid → fail；降级 → fail。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: MEDIUM。

### P1-T15 — CoverageState final integration + 100% analysis assertion + v0.3 integration + observability

- **TYPE**: CODE / INTEGRATION
- **GOAL（R1，P1-4/P1-5A 所有权收敛）**: **最终 cross-cutting CoverageState 集成与完整
  saturation feedback wiring**（唯一有权宣称"完整 P1 saturation 集成完成"的 ticket）；**最终
  selected set identity vs mapped/analyzed set identity 对账**与 **100% Analysis Coverage
  assertion**（两集合机械相等才可断言）；与既有 v0.3 final synthesis / render 路径集成；
  research-level observability（stage / mode identity / coverage / runtime identity / failure
  reason / final artifact refs，work-relative）；mode identity 继承
  `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST`。
- **WHY_NOW**: 把 P1 管线接回既有产品出口；coverage assertion 是产品合同（§1 / §9.3）。
- **AUTHORITY**: Spec §1、§9.3、§15；父级 §10、§6。
- **IN_SCOPE**: 最终 hook 汇聚与 feedback wiring（round → CoverageState → saturation → 再检索 /
  budget stop → synthesis 的完整运行期闭环）、集合对账、assertion、render/披露扩展、事件/进度。
- **OUT_OF_SCOPE**: 新 GUI/dashboard；sampled 路径变更；版本分配；阈值冻结（D-6 仍委派）。
- **BLOCKED_BY**: T14, T07；**BLOCKS**: T16。
- **FILES_OR_COMPONENTS_EXPECTED**: integration 模块 + render/披露扩展 + tests。
- **ACCEPTANCE_CRITERIA**: 全部下游 hook 更新汇聚后，两集合机械相等才输出 100% assertion
  （否则 fail/披露缺口）；partial 不渲染为 complete；运行期 feedback 边可测试且 DAG 无环；
  observability 满足父级 §10 最低集；无 machine-private path。
- **REQUIRED_TESTS**: assertion 相等/不等两分支、feedback wiring 闭环、披露完整性、失败语义、
  v0.3 回归。
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
- **AUTHORITY**: 本 DAG acceptance 语义；父级 §13（G）先例；Spec §12 caveats 随行。
- **IN_SCOPE**: 真实运行记录、evidence 收集、验收结论。
- **OUT_OF_SCOPE**: 新 benchmark / 新 Gold；降级阈值换绿灯。
- **BLOCKED_BY**: T15, T03, T17；**BLOCKS**: —（P1 completion claim）。
- **FILES_OR_COMPONENTS_EXPECTED**: repo-tracked dogfood evidence（脱敏，work-relative）。
- **ACCEPTANCE_CRITERIA**: 全链路真实运行 + 机械验证通过；coverage/saturation/披露与合同一致；
  失败场景至少一组真实记录。
- **REQUIRED_TESTS**: 不适用（acceptance evidence 类）。
- **REQUIRED_EVIDENCE**: repo-tracked dogfood 记录 + exact run identity。
- **FAIL_CLOSED / STOP_CONDITIONS**: 任一硬门不满足 → 验收 FAIL，不得降级放行。
- **REVIEWER_QUORUM**: 1 × ACCEPTANCE_EVIDENCE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: —（终局票）。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: HIGH。

### P1-T17 — Additional retrieval provider adapter（CONDITIONAL，post GATE-3）

- **TYPE**: CODE（CONDITIONAL — 具体范围在 T03 结论后按其报告 freeze，需 reviewer 接受）
- **GOAL**: 将 GATE-3 选中/资格确认的 retrieval-ranked capability 实现为 provider seam 下的
  第二 retrieval adapter。
- **WHY_NOW**: multi-provider retrieval 合同的实现侧闭环；full P1 completion 必要条件。
- **AUTHORITY**: Spec §5.1/§5.4；T03 evidence；D-9 动态 amendment 规则（见 §H）。
- **IN_SCOPE**: 单个具名 capability 的 adapter + tests（fixtures + 真实 capability smoke）。
- **OUT_OF_SCOPE**: universal provider framework；更多 provider；browser scraping；OAuth 设计
  （触发时走 Ticket Graph amendment 另票）。
- **BLOCKED_BY**: T03, T05（+ D-9 amendment 产出票若触发）；**BLOCKS**: T16。
- **FILES_OR_COMPONENTS_EXPECTED**: adapter 模块 + tests。
- **ACCEPTANCE_CRITERIA**: §5.1 seam contract 全字段满足；completeness/failure 语义不猜测；
  与 Official Search 在 RRF fixtures 中并行可测。
- **REQUIRED_TESTS**: adapter 契约 + RRF 双 channel fixtures。
- **REQUIRED_EVIDENCE**: focused tests + T03 report 引用。
- **FAIL_CLOSED / STOP_CONDITIONS**: capability 证据 `UNKNOWN` → 不得实现；
  `NO_SILENT_PROVIDER_FALLBACK`。
- **REVIEWER_QUORUM**: 1 × CODE_REVIEWER。
- **MERGE_REQUIREMENT**: 治理默认。
- **PARALLELIZABLE_WITH**: T07–T15、T18（一旦 READY）。
- **IMPLEMENTATION_MODEL_CLASS**: DEEPSEEK_V4_FLASH。
- **RISK_CLASS**: MEDIUM；**READY-SET PRIORITY**: LOW。

## E. Discovery / security tickets

汇总：**T01（GATE-1，DISCOVERY；含 P1-3 出网禁令与 local `NO_NEW_EGRESS` 记录义务）**、
**T02（GATE-2，SECURITY，REMOTE ONLY，iff T01 提议 remote）**、**T03（GATE-3，DISCOVERY）**。
消费者：T01 → T10（双路径）/T02；T02 → T10（remote 分支）；T03 → T17/T16。
D-9 动态前置：T03 选中 provider 需新 OAuth/Session → **scoped Ticket Graph amendment**
（见 §H），不得静默向冻结 DAG 追加票。

## F. Integration tickets

- **T15**：CoverageState final integration + 100% assertion + v0.3 集成 + observability；
- **T16**：端到端 dogfood 验收（ACCEPTANCE_EVIDENCE_REVIEWER）。

## G. Deferred / explicitly absent tickets

- **D-8（global quality-score aggregation）**：初始 DAG **无 ticket**；
  `APPROVED_SPEC_DECISION_STATUS = REMAINS_OPEN`；`DEFAULT = DO_NOT_INTRODUCE`。
- **D-9 OAuth/Session 新凭据设计**：无预置票；触发时走 **scoped Ticket Graph amendment**
  （P2-2 修复：不静默追加），amendment 经 required Contract review + integration 后 T17 方可 READY。
- **新 browser-scraping / Browser Session platform**：无票（非 goal，需独立 Spec amendment）。
- **Overengineering hard-ban 全清单**（universal provider framework / plugin platform / vector
  database / knowledge graph / microservices / event bus / workflow engine / distributed task
  queue / P2/P3 SQLite history / automatic browser platform / global quality score / trained
  ranking model / active learning / advanced stopping theory / six hard lanes / mandatory MMR /
  universal research DSL）：**均无 ticket**。
- **P2/P3 任何工作**：无票。

## H. Implementation authorization status & post-review governance order（R1，P2-2）

```text
本 decomposition = PLANNING ONLY
TICKET 定义存在 ≠ 授权执行
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED

Post-review governance order（R1 修正）：
  ChatGPT exact-SHA PASS
  → ff-only integration of the exact reviewed Ticket Graph candidate
  → push
  → remote master verification
  → Ticket Graph 成为 durable frozen planning basis
  → issue / Tracker creation workflow（依 repository authority）
  → per-ticket START_GATE

D-9 动态前置（R1 修正）：若 T03 选中 provider 需要新 OAuth/Session credential 行为，
  不得向已冻结的 DAG 静默追加 ticket；正确顺序：
  D-9 trigger → scoped Ticket Graph amendment → required Contract review → integration
  → 之后 T17 方可 READY。
```

## 附：R1 REPAIR RECORD（响应 ChatGPT CHANGES_REQUESTED，P0=0 / P1=5 / P2=2）

| Finding | 修复位置 | 内容 |
|---|---|---|
| P1-1 | 新增 T18 / §B 矩阵 / §C / DAG / critical path / lanes | P1-T18 Research Planner Semantic Proposal（deepseek-api-tool-less；planner 仅 semantic proposal；`planner_invalid` / runtime fail-closed / NO_SILENT_RUNTIME_FALLBACK；T18 BLOCKED_BY T04、BLOCKS T06）；不重编号 T01–T17 |
| P1-2 | T01 / T02 / T10 合同 | T01 local 结局含 repo-tracked `NO_NEW_EGRESS = YES`；T02 改为 REMOTE ONLY（iff T01 提议 remote）；T10 双路径依赖：LOCAL=T01（evidence=NO_NEW_EGRESS 记录），REMOTE=T01+T02（evidence=T02 authority）；local 路径不依赖未激活 T02 |
| P1-3 | T01 IN_SCOPE / AC / STOP | T02 PASS 前 T01 对 remote embedding 只准用 synthetic/neutral fixtures；禁止真实知乎语料 / 检索源文本 / 真实 EXTERNAL_CORPUS 出网；无法回避时报告 `REQUIRES_REMOTE_EGRESS_AUTHORITY` 并 STOP 该 probe；禁止先出网后补批准 |
| P1-4 | T07 / T09 / T15 / GRAPH | T07 = contract + hooks + round controller infrastructure（不得单独宣称完整 saturation 集成）；T09=Source Completeness、T12=selection accounting、T13/T14=claim/aspect/contradiction/analyzed 诊断、T15=最终集成 + 完整 feedback wiring；运行期反馈边是 runtime loop 而非 ticket 依赖环，DAG 无环 |
| P1-5 | T12 / T13 / T14 / T15 合同 | T12 仅拥有 eligible/selected/verified 计数 + exclusion reasons + corpus identity（不得要求最终 analyzed 计数）；T13 = representation + per-group semantic claim extraction（deepseek-api-tool-less）+ mapped/analyzed 更新；T14 = 跨组聚合 + synthesis（消费 T13）；T15 = 集合对账 + 100% assertion |
| P2-1 | 头部 / §C / GRAPH | TICKET_COUNT = 18；UNCONDITIONAL = 16；CONDITIONAL = 2（T02、T17）；已机械核对 |
| P2-2 | §H / GRAPH §H·§K | 治理顺序改为：ChatGPT exact-SHA PASS → ff-only integration → push → remote master verify → durable frozen planning basis → issue/Tracker creation workflow → per-ticket START_GATE；D-9 动态前置走 scoped Ticket Graph amendment，不静默追加 |

PRESERVE 确认：GATE-1/2/3、T04 plan contract、T05 seam、T06 RRF、T08 group selector、T09
multi-group、T10/T11 拆分、T12 frozen baseline、D-4/D-5/D-6 委派、D-8 NO_TICKET、无 browser
scraping、无 global quality score、无 six hard lanes、无 mandatory MMR、无 vector DB、无 P2/P3、
quorum 政策、hardest-first、串行 master 集成——全部未变；GATE-1/2/3 均未执行。

---

*本文件由 planning executor 产出，未经独立 review 前不构成任何 authority。
最终审查者：ChatGPT（外部）。SELF_REVIEW != INDEPENDENT_REVIEW。*
