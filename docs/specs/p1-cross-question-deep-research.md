# P1 Cross-Question Deep Research — Approved Spec Candidate

> **2026-09-19 repair amendment candidate**：本次明确变更范围与冻结决策来源见 §0.2。
> `OWNER_DECISIONS = FROZEN`；`FORMAL_CONTRACT_AMENDMENT = REVIEW_PENDING`。
> 下述原 Spec conditional approval 模板保留；本次 delta 必须对新的 exact candidate HEAD
> 重新满足全部五个生效条件，历史批准不自动转移。本次不声明修复已实现。

```text
DOCUMENT_STATUS = APPROVED_SPEC_CANDIDATE
PRE_EFFECTIVE_STATUS = REVIEW_PENDING
POST_EFFECTIVE_STATUS = APPROVED
APPROVAL_EFFECTIVE_ON =
  1. CONTRACT_REVIEWER PASS on this exact candidate HEAD
  2. CONSISTENCY_REVIEWER PASS on the same exact candidate HEAD
  3. candidate still has a legal current-master ancestry;
     if master drift requires re-form, old PASS does not transfer
  4. the exact reviewed HEAD is ff-only merged to remote master
  5. remote master is re-fetched and verified to contain the exact reviewed commit
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
DOCUMENT_ID = P1_CROSS_QUESTION_DEEP_RESEARCH
NEXT_GATE = FRESH_CONTRACT_PLUS_INDEPENDENT_CONSISTENCY_REVIEW
Author handle: FlapPearLabs
Date: 2026-08-28
```

> **Promotion basis（durable provenance，非 review commentary）**：本文件是已通过独立架构审查
> （`REVIEW_VERDICT = PASS`，`REVIEWED_HEAD = 68db44c829295803b0df655dbc090966236807e5`，
> 位于 `spec/p1-architecture-spec-prep-01` 分支 `external-audit/` 审查树，该树**不导入 master**）
> 的 P1 Cross-Question Deep Research 架构合同的 repository-native 提升候选。
> 本文件将该已审查架构**按原语义**转录为 repository-native Approved Spec candidate；
> 不复制 review packet、不复制 benchmark artifact、不复制 external-audit 树、不复制历史审查评论。
> 冻结的 P1 设计权威（00/01/02/04/07/09，位于 external-audit 审查树）的**实质**已在本文档内
> repository-native 表达（§3 selector baseline、§5.1 provider policy 等）；09 的 selector baseline
> 修订在此作为设计溯源保留（§3）。本文件在 **APPROVAL_EFFECTIVE_ON 五条件（见 header）全部满足之前
> 是 NON_AUTHORITATIVE_CANDIDATE**；五条件全部满足（含 review quorum PASS on the exact reviewed HEAD
> + 该 exact HEAD ff-only merge 到 remote master + 重新 fetch 验证）后才成为 Applicable Approved Spec /
> 实现合同。**review PASS 本身不激活 authority**，且整个 lifecycle **不需要**对本文件做任何 post-review
> STATUS edit（`PRE_EFFECTIVE_STATUS` 保持 `REVIEW_PENDING` 原样，approval 由外部 gate 序列生效）。

本文件是 **APPROVED_SPEC_CANDIDATE**，**不是** production implementation、ticket decomposition、
版本分配，也不是 self-approved Spec。它的 authority activation 由 conditional approval contract 决定
（见 header `APPROVAL_EFFECTIVE_ON`）：**review PASS 不能单独激活 authority**；只有五条件全部满足
（双 reviewer 对同一 exact HEAD PASS、candidate 仍有合法 current-master ancestry、exact reviewed HEAD
被 ff-only merge 到 remote master、remote master 重新 fetch 并验证包含该 exact commit）后，
本文件才成为 **APPLICABLE_APPROVED_SPEC**。整个过程中本文件**不需要任何 post-review STATUS edit**
——`PRE_EFFECTIVE_STATUS = REVIEW_PENDING` 字段保持不变，approval 由外部 gate 序列生效，
**不产生使旧 PASS 失效的新 commit**。

---

## 0. Authority Relationship（repository-native）

本 Spec 是 P1 Cross-Question Deep Research 的 **additive architecture amendment candidate**，
相对于 single-question Research Orchestration（`docs/specs/research-orchestration-scope.md`）。
未在本文件明确 amendment 的现有合同继续生效。本文件服从以下 repository-native authority：

| Level | Source | Binding role |
|---|---|---|
| 0 | `RULES.md`、`AGENTS.md` | hard invariants、scope、review / merge workflow；不得覆盖 |
| 1 | `docs/specs/v2-rich-content-fidelity.md` | canonical / Agent projection / capability-isolation / trust boundary baseline |
| 1 | `docs/specs/v0.3-product-scope.md` | sampled/full identity、hierarchical digest、runtime qualification amendments |
| 1 | `docs/specs/research-orchestration-scope.md` | **Applicable Approved Spec**：selection、full coverage、public-Zhihu semantic runtime、resume、failure semantics |
| 1 | `docs/product-behavior-contract.md` | 已实现行为的归一化视图；不得覆盖 Approved Specs；本 Spec 不得被写成 current behavior |
| 1 | `docs/architecture/runtime-strategy.md` | accepted controller/runtime boundary；不得覆盖 Approved Specs |
| 1 | 本文件 | P1 additive architecture（对明确 amendment targets 覆盖 research-orchestration-scope 对应条款；其余继续有效） |

解释规则：

1. P1 是对 single-question Research Orchestration 的 **additive architecture amendment candidate**；
   未在本文件明确 amendment 的现有合同继续生效。
2. 冻结 selector 方向（§3）不授权从 benchmark strategy 直接复制实现细节。
3. discovery/evidence 只能证明 capability lead；精确 endpoint、OAuth scope、CLI command、
   Session/Web pagination 或 completeness 均不得由本 Spec 冻结。
4. `UNKNOWN != PASS`；无法按 authority hierarchy 机械解决的冲突必须 `STOP: CONTRACT_CONFLICT`。

当前 authority state：

```text
P1_EVIDENCE_GATE = PASS_WITH_CAVEATS
ARCHITECTURE_REVIEW = PASS @ 68db44c（external-audit）
THIS_SPEC = APPROVED_SPEC_CANDIDATE
PRE_EFFECTIVE_STATUS = REVIEW_PENDING
POST_EFFECTIVE_STATUS = APPROVED（conditional；approval 五条件见 header APPROVAL_EFFECTIVE_ON）
BEFORE APPROVAL_EFFECTIVE_ON = NON_AUTHORITATIVE_CANDIDATE
AFTER APPROVAL_EFFECTIVE_ON  = APPLICABLE_APPROVED_SPEC
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
```

### 0.1 Parent Amendment Map（parent = `research-orchestration-scope.md`）

本文件对父级合同的 amendment 关系只限下表；表中未列出的父级条款继续有效。本表**不发明新产品合同**。

| Parent contract element | P1 relationship |
|---|---|
| single-question selected object（`selectedQuestionId` / `selectedQuestion`） | **AMENDED**：`SelectedSourceGroups[]`（§7.2） |
| single linear execution state | **ADDITIVE AMENDMENT**：per-group state / composition（§6） |
| per-question verify / handoff authority | **INHERITED**（§2.2 / §6.3） |
| sampled/full identity（`SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST`） | **INHERITED**（§1.1） |
| public-Zhihu semantic runtime policy（默认 `deepseek-api-tool-less`） | **INHERITED**（§5.2） |
| fail-closed / no semantic downgrade | **INHERITED**（§10.2） |
| browser scraping non-goal | **NOT AMENDED**（§5.1 Browser/Session authority boundary） |
| credential / capability-isolation boundary | **INHERITED**（§10 / §5.3） |
| version assignment | **UNASSIGNED** |
| P1 implementation authorization | **NONE** |

### 0.2 Repair amendment（2026-09-19，conditional candidate）

```text
AMENDMENT_STATUS = AMENDMENT_CANDIDATE
PRE_EFFECTIVE_STATUS = REVIEW_PENDING
OWNER_DECISIONS = FROZEN
OWNER_DECISION_SOURCE_SHA = 2387b9a9261b9830522e0da888b12ed990ee8b49
BASE_MASTER_SHA = 4bea7b30b3842a876e383977686a0abc0d68302f
IMPLEMENTATION_AUTHORIZATION = NONE
TICKET_AUTHORIZATION = NONE
READY_TO_DECOMPOSE_REPAIR_TICKETS = NO
NEXT_LEGAL_ACTION = INDEPENDENT_CONTRACT_AND_CONSISTENCY_REVIEW
```

直接决策来源为同一 exact SHA 的
[Owner Contract Decisions](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/blob/2387b9a9261b9830522e0da888b12ed990ee8b49/docs/audits/2026-09-19-scoped-repair-plan/OWNER_CONTRACT_DECISIONS.md)
与 [Scoped Repair Plan](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/blob/2387b9a9261b9830522e0da888b12ed990ee8b49/docs/audits/2026-09-19-scoped-repair-plan/SCOPED_REPAIR_PLAN.md)
§5–9、§17。Owner 提供该 SHA 已通过 Contract + Consistency Review 的结果；这是
`OWNER_PROVIDED_REVIEW_RESULT`，不是本 amendment 的独立审查 receipt 或 PASS。

本 delta 只 amend 下表范围；未改条款及已生效的旧合同在本 delta 生效前继续适用。
激活仍需 header 的全部五条件：同一 exact HEAD 的 CONTRACT_REVIEWER PASS +
CONSISTENCY_REVIEWER PASS、合法 current-master ancestry、exact reviewed HEAD ff-only
集成、fresh remote verify。无需 post-review STATUS edit；re-form 后旧 PASS 不转移。
Owner 冻结、正式 authority 生效、实现授权、实现验收是四个不同事实。

| Owner decision | Existing authority | Amendment action | Conflict? |
|---|---|---|---|
| CD-B1 | P1 §8.2；Seam D V1 | §8.2 S1 命题族与立场；Seam D V2 | 差异由 candidate 明确处理，待双审/生效 |
| CD-B2 | P1 §8/§10；Seam D V1 | 独立 unresolved、有效输出与语义验收边界 | 同上；不放宽坏 lineage / 空输入失败 |
| CD-B3 | Seam §0 / D version rule | D major 1→2，语义版本绑定，旧产物历史隔离 | V1/V2 明确不兼容，待生效 |
| CD-B4 | P1 §8.3/§9.4；Seam D V1 | 正交状态；legacy 单向展示；诊断读 canonical | 旧互斥 canonical taxonomy 被 candidate 替换 |
| CD-A1/A2/A3 | P1 §4.3/§6.2/§10.2 | occurrence、闭包复用判断、legacy 缺版本拒绝 | 操作语义澄清，待双审/生效 |
| CD-C1 | P1 §8.1/§9.3；Seam C；T13 extraction | 合法分析后的零 claim accounting；C shape/identity/version 不变 | 无 shape gap；语义澄清待生效 |
| CD-C2 | V2 §9.2 | §10.1 inherited by reference | none；安全合同不变 |
| CD-D1 | P1 §7 | 一次成功 resolution、冻结 pending 与幂等重试 | 计数/恢复语义澄清，待双审/生效 |
| CD-F1 | documentation fact alignment | NO_PRODUCT_AUTHORITY_CHANGE | none；NON_BLOCKING_FOR_CORE_REPAIR |

[Seam 合同](../planning/P1_SEAM_CONTRACTS_V1.md)沿用同一文件、各 seam 独立版本：
A/B/C 仍 V1，D 候选 V2。新增 required observable semantics 是 §0 所定义的 major change；
整数 `VERSION = 1` 的直接 major successor 为 `2`。D 的 `semanticContractVersion = 2`
与该 major 同步绑定，不另开产品版本线；本文 `VERSION_ASSIGNMENT = UNASSIGNED` 的产品版本含义不变。

本次生效后，[T14 extraction](../planning/P1_T14_CONTRACT_EXTRACTION.md) 的旧类别优先级、
kind→opposition、category-based contradiction、仅 claimIds 派生 identity 等描述只作 V1 历史证据，
不能覆盖 §8/§9.4 或 Seam D V2。其未冲突的 guard、lineage、所有权与 fail-closed 合同继续继承。
[T13 extraction](../planning/P1_T13_CONTRACT_EXTRACTION.md) 的 ownership / identity 保持；
C1 由 §8.1 明确，不将旧 empty-content 实现描述当成跳过 P1 分析的授权。
T15 的最终集合对账与独立 100% assertion 保持（[Issue #47](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/issues/47)），不重算 T13 identity 或建立第二套 T14 关系。

`FUTURE_REQUIRED_CHANGE`：authority 生效并另获实施授权后，fixtures/validator、T14 producer、
T15 与其他消费者须按 D V2 同步并重新审查。现有可执行 V1 fixture/validator 不证明 V2 合规；
本轮不修改它们，不授权实现或拆票。

`NONBLOCKING_FOLLOWUP = product-behavior-contract authority index may require later document synchronization`。
该索引未列 P1 不改变 Applicable Specs 的 scope/amendment 层级，不是形成本 candidate 的必要修订；
本轮不改 Product Behavior Contract、F08/RRF/D2、project-memory 或历史审计证据。

---

## 1. Product and Coverage Contract

P1 = **Cross-Question Deep Research**：用户提交自然语言研究请求，系统在明确检索边界下建立
跨多个 Question / Source-group 的 Verified Research Corpus，并对该选中 corpus 做可验证的
100% Analysis Coverage，再产出 evidence-backed cross-source synthesis。

```text
USER_REQUEST
→ persisted Research Plan
→ multi-query / multi-provider retrieval
→ fused Candidate / Retrieval Pool
→ SelectedSourceGroups[]
→ per-group capture + verify
→ RCE-selected Verified Research Corpus
→ 100% Analysis Coverage of that selected corpus
→ Question/Source-group → Claim/Aspect → Cross-source synthesis
```

必须区分三种覆盖：

- **Retrieval Coverage**：在当前 plan / query / provider 条件下探索了多少研究空间；通常不能声称全站 100%。
- **Source Completeness**：对每个已选、可枚举 source group 的 capture / pagination / verify 完整性。
- **Analysis Coverage**：Verified Research Corpus 中有多少 selected canonical sources 真正进入分析；P1 默认必须为 100%。

### 1.1 Corpus construction selection != sampled analysis

以下两件事不是同一产品语义：

1. RCE 从 candidate/retrieval pool 构造 **selected Verified Research Corpus**；
2. downstream 对一个 canonical corpus 只分析 top X% 的 **explicit sampled analysis**。

P1 默认路径属于 1，并对其 selected corpus 保持 100% Analysis Coverage。`top-percent-analysis` /
`popular-sample` 只允许在用户明确请求 sampled view 时进入；不得因为候选多、成本高、runtime 失败
或规模控制而把它当 P1 默认路径。

```text
P1 default:
candidate pool
→ RCE corpus selection
→ selected verified corpus
→ analyze every selected source

Explicit sampled request only:
canonical corpus
→ top-percent-analysis / popular-sample
→ sampled disclosure + distinct mode identity
```

`isFullCoverage` 只是覆盖事实；`mode` 才是 pipeline identity。现有 `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST` 合同完整继承。

---

## 2. Current v0.3 Seam Map — What Exists and What Does Not

### 2.1 Existing single-question orchestration

真实入口为 `research-orchestration/bin/research.mjs` → `lib/orchestrator.mjs`。controller 通过 runner
顺序调用既有 primitives，当前状态模型明确是单问题：

- `selectedQuestionId` / `selectedQuestion`；
- 一份 CAPTURE artifact/hash；
- 一份 VERIFY result；
- 一份 `handoff.json`；
- `stageAnalyze()` 只把一个 `answers.json` 交给 corpus pipeline；
- run identity 当前是 `topic + mode + percent + runtime` 的 hash；
- `orchestration-state.json` 按单一线性 stage checkpoint 恢复。

因此 P1 **不能**被描述为"把 capture 调 K 次，其余 state/resume/handoff 不变"。P1 需要 additive
multi-group execution contract，见 §6。

### 2.2 Existing capture / verify / handoff authority

- Search：当前 `official.js searchQuestions()` 是已知、已实现的 Official Search capability；bounded `answerCount` enrichment 失败时为 `null`，不是 completeness proof。
- Capture：`grabber.js grabAll()` 维持单 Question pagination / progress / identity / atomic-write 合同。
- Verify：`verifier.js verifyOutput()` 仍是 per-question 唯一 validity authority；`captured != verified`。
- Handoff：`make-handoff.mjs` 只从一个 verified question directory 生成一个 handoff；Agent 不手工构造 verified handoff。

P1 复用这些 per-group primitives，但必须在其上增加可验证的 group composition；不修改单问题 canonical schema。

### 2.3 Existing corpus hierarchy is physical aggregation infrastructure

`corpus-anthology` 已能递归收集多个 `answers.json`，sourceId 也包含 questionId；现有 hierarchy 提供
chunk/node packing、canonical source union、hash/cache/stale propagation。

但是它当前不是显式的 Question / Source-group representation layer。物理 chunk 可能只是 transport /
token packing，不自动满足：

```text
Content
→ Question / Source-group representation
→ Claim / Aspect
→ Cross-source synthesis
```

因此：

```text
existing hierarchy = REUSABLE_AGGREGATION_INFRASTRUCTURE
P1 new requirement = EXPLICIT_QUESTION_SOURCE_GROUP_REPRESENTATION_LAYER
```

### 2.4 Reuse / adapter / new-capability boundary

**Reuse without changing authority semantics**：单问题 capture、verify、make-handoff、canonical
`answers.json`、safe projection、tool-less map runtimes、source identity / evidence lineage、
existing chunk/hash/hierarchy primitives。

**Adapter work required**：multi-group controller/state、provider routing seam、group
composition/handoff aggregation、logical group representation、RCE selector integration、
research-level render/observability。

**New P1 capabilities**：Research Planner、multi-query/provider RRF、EmbeddingProvider / dense
geometry、four-component selector、ResearchCoverageState、explicit Question/Source-group → Claim/Aspect
synthesis layer。

任何"v0.3 零改动即可完成 P1"的表述都不成立。

---

## 3. Frozen Selector Direction and Preservation Semantics

冻结的第一 baseline（源自 RCE_DESIGN_AMENDMENT_01，此处 repository-native 表达）：

```text
Question / Source-group Preservation
+ Popularity Anchor
+ Dense Semantic Relevance / Novelty
+ Optional Lightweight Redundancy Control
```

### 3.1 Preservation contract

Question / Source-group Preservation 只冻结以下语义：

- group identity preserved；
- group provenance preserved；
- relevant or minority group cannot be silently starved；
- per-group selection and coverage must be measurable；
- answer count 可报告 discussion volume，但不能自动成为 truth weight。

它**不**冻结：

- "所有入选 Question 的回答永远是不可分割 selector atom"；
- "入组即必须保留该组每一条 captured source"；
- 固定 floor / count / quota；
- group 内 top-percent 作为 P1 默认规模控制。

RCE 可以在保留 group representation 的同时选择组内 sources，但必须记录每组 eligible / selected /
verified / analyzed 数量及 exclusion reason category；不得让一个大 Question 静默吞掉小组，也不得把
corpus construction 伪装为 `top-percent-analysis`。精确 floor、count、quota 属 `OPEN_DECISION D-5`。

### 3.2 Other frozen components

- Popularity 是 anchor / soft feature，不是真理权威。
- Dense embedding 是 relevance / novelty / redundancy / clustering / aspect matching 的核心 semantic geometry。
- Dense Top-K 单独表现弱，不等于 dense embedding 弱。
- MMR 仅是 optional lightweight redundancy control，不是 mandatory selector。
- Six dimensions relocated, not deleted：Mainstream、Expert、Evidence-rich、Fresh、Long-tail、Contradictory 进入 retrieval / soft features / diagnostics / opposing-query / claim-stage，而非 hard selector quotas。

---

## 4. Research Plan and Identity

### 4.1 Minimum planner output

Research Planner 的最小概念输出必须保留：

- query variants；
- aspects；
- entities；
- opposing framings；
- terminology variants；
- source-group intent / constraints（where applicable）。

精确字段名、JSON schema、文件名可以 delegated，但不能把这些概念压缩回仅 `{queries[], aspects[]}`。

### 4.2 Plan authority

- Planner 只拥有 semantic proposal，不拥有 provider IO、canonical identity、selection authority 或 verification authority。
- Planner output 必须 persisted、structured-output validated、hashed。
- Controller owns the plan artifact identity and `planHash`。
- invalid / unparseable plan fail closed；不得把自然语言自由文本当已验证 plan。

### 4.3 Stable run identity vs plan artifact identity

禁止把 stochastic planner output 直接揉进 run identity。

```text
run identity
= normalized user request
+ stable configuration identity

research-plan artifact identity
= planHash
```

stable configuration identity 至少概念上覆盖 product mode、approved semantic-runtime policy identity、
provider-route configuration identity、selector/config version；不含 credential value。

下游 PLAN 之后的 retrieval / selection / capture composition / analysis 都依赖 `planHash`。持久化且有效
的 plan 仅在同一 execution occurrence 且满足 §6.2 依赖闭包校验时可复用；若 plan 被重新生成且 hash 改变，则必须从 PLAN/RETRIEVAL 边界使 downstream artifact
失效，不能静默沿用旧候选、旧 group set 或旧 corpus。

稳定 research identity 与 execution occurrence 分开：显式 `restart = new execution occurrence`，
不因 topic/config 或 plan bytes 恰好相同而复用旧 derived research stages。新 topic 必须从 PLAN
重新开始，不能将旧 ResearchPlan、CoverageState、SelectionDecision、CorpusManifest、Claims、
Synthesis 作为当前有效状态；同 topic 的显式 restart 亦然。occurrence 须可区分，不要求全局
run registry 或第二状态机。canonical source bytes 保留，既有 verifier/handoff 权威不变；
P1 research restart 不等于 `grab --fresh`，不修改 grab resume-merge 或强制重新抓取语义。

---

## 5. Three Independent Provider / Runtime Seams

以下三个 seam 必须分开建模，禁止再使用一个笼统 `provider/runtime D-2`：

### 5.1 ZhihuDataProvider / CapabilityProvider

职责：访问知乎 capability、产生 candidate / source-group identity 与 retrieval/capture provenance。最小概念 contract：

| Field / result | Required meaning |
|---|---|
| `provider_id` | 稳定 provider identity |
| `capability` | 本次使用的 capability identity |
| `auth_class` | official-secret / oauth / session 等分类；不含 credential value |
| candidate / source-group identity | controller 可验证的 canonical candidate/group reference |
| `provenance` | provider + retrieval route / rank origin |
| `source_url` | 经过边界校验的来源 URL |
| `retrieved_at` | retrieval time |
| pagination / completeness status | complete / partial / unknown 及其 provider evidence；不得猜测 |
| failure identity | machine-readable failure code / class |

精确函数名可以 delegated；任何 adapter 至少必须让 controller 判断"使用了哪个 provider/capability、
拿到哪个 candidate/group、是否分页完成、失败是什么"。

硬规则：

```text
NO_SILENT_PROVIDER_FALLBACK
UNKNOWN_PROVIDER_CONTRACT != PASS
```

当前 `searchQuestions()` / Official Search 是 **first adapter / current known capability**，不是
architecture 本身。当前 Session/Cookie 单问题 capture primitive 可被 adapter 包装复用，但长期
provider identity、官方 CLI parity、OAuth scope、Session/Web pagination 与 completeness 均保持
`OPEN / DISCOVERY_REQUIRED`，施工前重新验证。不得在本 Spec 冻结 exact endpoint、OAuth scope、
CLI command 或 Session/Web pagination。

**已冻结的 provider policy（约束 D-2，不得重开）**：数据能力层遵循已冻结的
`THIN / ADAPTER_FIRST / REUSE_FIRST`，且 provider 偏好顺序为 official-first：

```text
1. 知乎官方能力
2. 官方 CLI / API / Skill / MCP
3. OAuth
4. Cookie / Session
5. Browser Session reuse
6. 已验证成熟 OSS
7. 只有缺失能力才自行实现
```

exact per-capability provider routing / priority 仍为 `OPEN / DISCOVERY_REQUIRED`（见 §14 D-2），
但这**不是**重新打开上面的高层 provider 偏好顺序；该顺序保持冻结。

**Browser / Session authority boundary（与父级 non-goal 的显式 reconcile）**：

- 父级 Applicable Approved Spec `docs/specs/research-orchestration-scope.md` 明确
  browser scraping = **NON-GOAL**；本 Spec **不** amend 该 non-goal。
- 已存在 / 已批准的 Session / Cookie 单问题 capture primitive（v0.3 现状）可以被 provider seam
  包装复用，**不重新定义其 authority**。
- 任何超出既有 Approved behavior 的**新** browser-scraping 或 Browser-Session data-access 实现，
  必须**先**取得单独的 explicit Approved Spec amendment / capability contract，才能实现。
- Browser Session reuse 在长期 provider 偏好顺序中的位置**保持**（不删除），但**当前没有
  implementation authority**——它只是 future provider position，不是被本 Spec 授权的实现。

### 5.2 SemanticRuntime

职责：Planner、claim extraction、aspect mapping、map/reduce/synthesis 等语义生成。它不读取知乎
provider credential，不拥有 canonical identity / IO / validity authority。

**CURRENT APPROVED POLICY**：对 public Zhihu research，`docs/specs/research-orchestration-scope.md`
已批准默认 semantic runtime 为 `deepseek-api-tool-less`；`NO_SILENT_RUNTIME_FALLBACK`、
runtime-scoped qualification、public egress ≠ private/sensitive egress 全部继承。该 policy 不能在
P1 中被无条件重新标 OPEN。

未来替换 / routing 仍可经独立 authority 扩展；当前本地 `lmstudio-local-tool-less` 的资格事实继续存在，
但不会自动改变 public-Zhihu 默认 policy。

### 5.3 EmbeddingProvider

职责：text-in → vector-out 的 dense geometry provider。它既不等于 SemanticRuntime，也不通过
`map.mjs` runtime routing 绑定。

EmbeddingProvider contract 至少包含：

- provider identity；
- model identity；
- embedding version；
- input normalization version；
- cache key / reuse semantics；
- vector result（dimension / numeric validity 由 controller 校验）；
- machine-readable failure identity；
- data-egress / security policy identity。

建议的 cache identity 由 canonical input hash + provider/model + embedding version + normalization
version 构成；精确 schema delegated。production embedding provider/model 仍为 `OPEN_DECISION D-1`，
不得在本 Spec 冻结。

外部 corpus 送入 embedding provider 时仍受 UNTRUSTED_CONTENT、capability isolation 和 egress
authority 约束。Embedding unavailable 对完整 P1 的默认语义见 §10：fail closed。

### 5.4 RRF boundary

RRF 融合的是 **query/provider retrieval rankings**。它的 channel identity 来自 query +
ZhihuDataProvider/capability，不包含 SemanticRuntime 或 EmbeddingProvider。RRF 负责 Candidate
Fusion，不负责最终 corpus selection。

---

## 6. Multi-group Execution, Handoff and Resume

P1 在现有线性 single-question state 上增加最小概念结构；不在本 Spec 锁具体 JSON filename / exact schema。

### 6.1 Required logical state

```text
SelectedSourceGroups[]
PerGroupExecutionState
VerifiedGroupRefs[]
ResearchCorpusManifest (or equivalent derived composition)
```

`SelectedSourceGroups[]` 由 controller-owned selection artifact 确定；每项保留 group identity、
provider/capability provenance、selection rationale reference 与 planHash dependency。

`PerGroupExecutionState` 至少可表达每组 capture / verify / handoff 的状态、artifact reference、
hash/version、failure identity 和 resume boundary。

`VerifiedGroupRefs[]` 只能引用 per-group verify authority 已判 valid 的 artifacts；captured group
不能进入该集合。

`ResearchCorpusManifest` 只从 valid `VerifiedGroupRefs[]` + selector output 确定性派生，记录 selected
source composition / group provenance / dependent hashes。它是 execution/composition artifact，**不得
成为第二 canonical source of truth**；canonical content 仍在各组 `answers.json`，verified 状态仍归
verifier / handoff authority。

### 6.2 Required execution semantics

- 每组独立 capture；一组完成不把其他组标 completed。
- 每组独立 verify；`captured != verified` 逐组成立。
- 现有 per-question handoff authority 保持；研究级 composition 只能引用已验证的 per-group handoff/artifact，不能手工升级 validity。
- 每组 checkpoint 必须由 artifact hash/version 验证；`FILE EXISTS != VALID CACHE`。
- 中断发生在部分组完成后，resume 必须复用仍 valid 的完成组并继续未完成组。
- 某组 artifact stale / identity changed 时，只能复用无依赖且仍 valid 的 sibling；该组及所有依赖它的 corpus/analysis artifact 必须失效。
- planHash 或 SelectedSourceGroups[] identity 改变时，从 PLAN/RETRIEVAL/selection 的适当边界失效 downstream；不得静默把旧 group artifact 拼进新 research run。
- credentials / secret-bearing header / credential path contents 永不进入 state、event、manifest、plan 或 embedding cache identity。
- partial state 可以被报告和恢复，但不得渲染成"P1 research complete"。

**Current reuse validation（CD-A2/A3）**：`COMPLETE` 记录 historically completed；
`currently reusable` 是每次调用的 validation judgment，不新建第二套持久状态机。
复用必须验证当前 request/effective config/contract versions、被记录输入/输出及传递依赖：

```text
request / effective config / versions
→ bound persisted plan → frozen retrieval pool + selection
→ valid per-group answers / handoff / derived manifest
→ selected refs + content hashes / corpus identity
→ T13 claims + mapped/analyzed identity
→ T14 relation / synthesis / guard
→ T15 coverage-final + result bytes / run-plan bindings
```

仅 `resultHash` / `coverageFinalHash` 相等不能证明该闭包有效。闭包失效则
`REUSED_COMPLETE = FALSE`，拒绝 current reuse、报告 earliest invalid boundary、保留历史状态和
bytes；默认不自动 network refetch 或 expensive rerun，等待显式 restart 或未来明确授权恢复。
该限制针对 stale COMPLETE 的当前复用请求；普通 interrupted resume 继续复用仍有效的完成阶段/
无依赖 siblings，并从适当边界继续未完成工作。复用校验本身不联网、不改写 canonical。

必要 contract/semantic version、effective config identity、prompt/profile/projection version 或
required provenance 缺失的 legacy checkpoint：`REUSE REFUSED`，不得猜旧值、静默迁移，历史
bytes 保留。配置变化按实际依赖局部失效：planner 影响 PLAN 起，T13 影响 claims 起，T14 影响
synthesis 起；不是因任意仓库提交使所有阶段失效。日志、展示格式、无行为注释、凭据轮换不触发
无关语义重算；secret 及其 hash 不进入 identity。provider 实际 served-model 字符串仍仅作观测，
不新增精确匹配门，也不引入联网 freshness 检查。

### 6.3 Handoff compatibility

不修改现有单 handoff schema。P1 采用 additive composition：多个 per-group verified handoff/reference
→ controller-derived research composition → corpus input。是否最终需要一个新的 research-level public
handoff schema，必须另行合同化；本 Spec 不以手工数组替代既有 validator。

---

## 7. Selection and Candidate Ambiguity Contract

现有 Approved single-question selection 合同继续生效，但 P1 明确 amendment 其 selection **scope**：

### 7.1 Inherited behavior

- clear best → auto-select；
- material ambiguity → at most one clarification；
- no valid candidate → fail / report；
- selection 对用户可见 / 可记录；
- model 不拥有 canonical / verification authority。

### 7.2 P1 additive amendment

P1 的选择结果不再是单个 `selectedQuestionId`，而是满足 Research Plan 的 `SelectedSourceGroups[]`。

- **clear best**：存在一个可解释的最佳 group set / research-scope interpretation，controller 可自动选择多个 source groups；"auto"不再等于"只能选一个问题"。
- **material ambiguity**：候选 group sets 对应明显不同的研究意图，自动选其中一组会改变 normalized user request 时，最多进行一次 clarification。
- **no valid**：没有任何 group set 满足 provider contract、plan constraints 或 minimum validity 时 fail closed。

P1 不强制每个 query 选一个 group，也不把所有检索命中全部纳入。exact set construction algorithm、
minimum group floor / quotas 与 numeric boundary 属 OPEN decisions；不得用"selectCandidate contract
unchanged"掩盖 scope amendment。

### 7.3 Clarification resolution / continuation（CD-D1）

`at most one clarification` 的计数单位为 **one successful clarification resolution**，
且只允许原来的一次问题。非法输入不消耗成功机会：pending decision 保持冻结，不生成第二问题，
不重启 retrieval、不重新生成 candidate pool，也不开始 capture/model/provider 调用。
同一已成功答案允许幂等重试并复用已验证 resolved decision；第二个不同成功选择必须拒绝。
进程重启不能重置成功计数或 pending binding。

continuation 绑定同一 run/occurrence、planHash、pool bytes identity、selector effective
config/version、pending decision hash 与 coverage ledger；单有 poolPlanHash 不足。
STOP 前持久化失败则 fail closed；pool 缺失/变化、config 漂移或 binding 不符时拒绝旧澄清，
不能重检索后假装继续原选择。恢复沿用既有 T08 合法选择校验，展示 required groups、remaining
slots 与 boundary options；不重新设计 selection 算法、阈值或允许自由文本改 plan。

---

## 8. Logical Hierarchy and Cross-source Synthesis

P1 的逻辑表示必须独立于物理 chunk packing：

```text
Canonical Content
→ Question / Source-group Representation
→ Claim / Aspect Representation
→ Proposition Family + explicit Claim Stance
→ Canonical Cross-source Synthesis State（relationStatus / supportBreadth / lineage）
```

### 8.1 Question / Source-group representation

每个 group 在进入跨源综合前形成可验证 representation，至少保留：

- canonical group identity / provider provenance；
- selected / verified / analyzed source accounting；
- main / minority / contradictory claims；
- expert / evidence-rich source references；
- completeness and coverage state；
- discussion volume as a separate signal。

现有 chunk/hierarchy 可承担 transport 和聚合计算，但不能用 `canonicalSourceIds` union 代替这一逻辑层。

**Metadata-only accounting（CD-C1）**：安全投影后仅剩 safe metadata 的 selected source，
仍必须经过允许的 T13 semantic analysis path，明确得到 `NO_EXTRACTABLE_CLAIM` 或现行等价
合法结果后才计 analyzed。`no claim != not analyzed`；禁止跳过语义分析后标 analyzed，禁止从
metadata 发明 claim 或静默丢 source。analyzed source-set identity 仍由 T13 唯一写入。
Seam C 现有 accounting、各 kind 的 claims 数组与 aggregate identity 能表达这种状态，
无 required shape/identity 变化、无 major bump。全体 selected sources 最终无合法 claim，
仍按 §10.2 fail closed。此条只适用于 P1-T13，不扩展为 legacy digest/map 行为修改。

### 8.2 Claim / Aspect → Proposition Family → Claim Stance（S1）

Aspect 是讨论维度，不是带方向与适用范围的 proposition；claim 是从某来源抽出的具体断言实例，
不是全局事实。proposition family 是本 run 内、同一比较问题与可比条件下可判断方向的局部分组，
不是 ontology。采用已有 claim 作为 anchor，其原 statement 定义被支持/反对的定向命题，
不让模型另造自由文本结论改变 anchor。Claim kind（main/minority/contradictory）≠ stance。

模型只用 controller 提供的 opaque claim tokens 提出 family、anchor 和 stance；canonical
claim/source/group/author identity 与引用映射归 controller。唯一合法表示为：

- **resolved families**：每个 family 非空，anchor 属于其中且自关系 `ASSERTS`；members 仅为
  `ASSERTS`（同可比条件下支持 anchor）或 `OPPOSES`（同条件下明确否定/方向不相容）。
- **independent unresolved records**：无法可靠归属/建立关系的输入 claim 单独保留，
  `stance = UNRESOLVED`、`relationStatus = UNRESOLVED`、`supportBreadth = null`；
  无 anchor、自 ASSERTS、support 或 oppose，不作为 family member。保留原 statement 与全部 lineage。

两者对全部输入 claims 构成不重不漏的完整分区；不接受 family 内嵌 UNRESOLVED 的第二编码。
不可通过空 family、补默认 stance、未知/重复 claim IDs 或任意拆分复合 claim 修补坏 proposal；
结构错误 fail closed。无法建立原子关系的复合 claim 保留 unresolved，不自造新事实。

同条件下能判定等价或相反的 claims 必须归入同一 family；不能全拆 singleton 绕过冲突。
如同负载/指标/时间窗口下“缓存降低延迟”与“缓存增加延迟”应保留相反 stance；热缓存 P50
与冷缓存 P99 条件不同，不因 aspect 相同制造冲突，应分开或保留 unresolved。
不能从组内 contradictory 推导反对所有 main，也不得传播“反对反对即支持”。

每个 source claim 保留 `sourceClaimId / original statement / kind / sourceRef / groupId /
authorRef` lineage，sourceRefs 非空、来自当前有效 analyzed claim；作者未知保持 null。
T14 验证 proposal 并从 claim lineage 装配两侧：ASSERTS→support，OPPOSES→oppose。
同 source 的 c1 ASSERTS 与 c2 OPPOSES 必须在两侧各保留 claim lineage，不能跨两侧按 sourceRef
去重，不宣称它们是独立来源。expert/evidence-rich support 只来自支持侧真实标记；禁止只留计数。

controller 验证 identity、完整分区、非空 family、anchor 自关系、合法枚举、出处归属及 hash；
这些不能证明自然语言关系正确：**hash != semantic proof**。T13 仍唯一写 analyzed identity；
T14 唯一装配关系/状态/synthesis identity；T15 比较、对账、披露，不重建第二套关系。

### 8.3 Canonical synthesis state 与 legacy presentation

以下三维正交，不维护互斥 canonical category taxonomy：

| 维度 | Canonical contract | 禁止含义 |
|---|---|---|
| `relationStatus` | resolved family 有 ASSERTS 且无 OPPOSES → `SUPPORT_ONLY`；两者非空 → `CONFLICTING`；独立未知记录 → `UNRESOLVED` | kind/aspect 不授予 stance；SUPPORT_ONLY 不声称外界无人反对 |
| `supportBreadth` | 只计 ASSERTS 的 distinct groups：1→`SINGLE_GROUP`，≥2→`MULTI_GROUP`；UNRESOLVED→null | 不计反对/未知组，不等于 truth/confidence/证据独立性/consensus |
| group-local salience | main/minority/contradictory 只在 source-claim lineage metadata 保留 | 不新增 synthesis-level groupSalience 或 global minority taxonomy |

前两维由 controller 从接受后的关系与 lineage 分别派生/校验，不能直接信任模型或 legacy label。
持久化值与重算值不符则拒绝，不能互相覆盖；anchor 自 ASSERTS 意味着 resolved 支持组不能为零。
报告必须保留 source-group differences、evidence strength 与 discussion-volume differences；
禁止 flat reduce、naive equal weight，answer count 不自动成为 epistemic weight。

| Case | evidence（A–D/F 条件可比） | relationStatus | supportBreadth | 必须保留 |
|---|---|---|---|---|
| A | A/B/C support P，无 opposition | SUPPORT_ONLY | MULTI_GROUP | 三个支持组 |
| B | A/B/C support P，D/E oppose P | CONFLICTING | MULTI_GROUP | 两维同时存在，不可二选一 |
| C | only A supports P，无 opposition | SUPPORT_ONLY | SINGLE_GROUP | 单组出处 |
| D | A 与 B 各一条 minority claim supports P | SUPPORT_ONLY | MULTI_GROUP | 两条 minority 仅留 lineage |
| E | 单条 claim 关系无法可靠确定 | UNRESOLVED | null | 独立 record、原 statement/完整出处，无伪 support |
| F | A 的同一 source：c1 ASSERTS P、c2 OPPOSES P | CONFLICTING | SINGLE_GROUP | 两侧各自 claim lineage，不能 sourceRef 去重丢一侧 |

旧 `widely-shared / group-specific / minority / conflicting` 仅为 `LEGACY_DERIVED_VIEW`：
新 resolved family 可单向有损展示 CONFLICTING→conflicting；否则 MULTI_GROUP→widely-shared；
否则 SINGLE_GROUP→group-specific。展示仍必须携带两项 canonical state，尤其 Case B 不能丢 breadth。
新 synthesis 不生成 global minority；旧 minority 只用于历史渲染或逐 claim metadata。
UNRESOLVED 不产生 legacy category；旧接口强制四选一则 `VERSION_INCOMPATIBLE / FAIL`，不得填默认值。

所有新语义消费者与 diagnostics 禁止 legacy category→relationStatus/supportBreadth/support/
oppose/semantic truth 反推。改/删 legacy 视图只能触发视图重算或不一致拒绝，不能改变 canonical
state、identity、两侧引用或 diagnostics；独立视图文件的 bytes hash 不反向定义语义 identity。

### 8.4 Semantic acceptance 不可由结构通过代替

关系未知可如实报告，不因 UNRESOLVED 自动 fail whole run；all-unresolved 不自动获得最终
COMPLETE 或语义验收。明确同条件同向 golden 必须同 family 且 ASSERTS，两个以上支持组必须
MULTI_GROUP；明确反向 golden 必须保留 OPPOSES 和 CONFLICTING，包括 Case B 的三支持组+
两反对组同时 MULTI_GROUP。全 singleton、拆 family、全 UNRESOLVED 即使结构合法仍为验收 FAIL。
只有预注册的信息不足 case 可将 UNKNOWN 作为期望，不得事后重标 ambiguous；任何允许明确案例
abstention 的阈值/分母都需运行前另行 owner 批准，默认明确 goldens 全部命中。
冻结 Repair Plan §17 的 deterministic、live semantic revalidation、full canonical acceptance
三层义务继续适用；fake runtime/hash PASS 不能替代 live 语义证据，本 amendment 不声称已执行验收。

---

## 9. ResearchCoverageState and Saturation

最小 `ResearchCoverageState` 必须同时表达：

### 9.1 Retrieval Coverage

- planHash；
- planned vs executed query variants / provider-capability routes；
- fused unique candidate/group counts；
- provider failures / unknown completeness；
- retrieval rounds and stop reason。

### 9.2 Source Completeness

- per-group captured / verified / partial / failed status；
- pagination / completeness status and evidence；
- selected / verified source counts by group；
- `captured != verified` diagnostics。

### 9.3 Analysis Coverage

- selected Verified Research Corpus source set identity；
- mapped/analyzed source set identity；
- missing / duplicate / stale / invalid evidence refs；
- 100% analysis assertion only when the two sets are mechanically equal。

### 9.4 Simple diagnostics

至少保留：

```text
new_aspect_rate
new_claim_rate
new_expert_rate
new_contradiction_rate
novelty_gain
```

`new_contradiction_rate` 的分子仅为 canonical `relationStatus = CONFLICTING` 的 family 数，
分母为全部输出记录数（resolved families + independent unresolved records）；空集口径为 0，
但不授权空 claims 合成成功。UNRESOLVED 单独披露；比例不证明无冲突或共识。
禁止从 legacy category == conflicting 计算新语义诊断。其余既有诊断所有权与键集不变，
不引入 #79 metrics 平台。

以及 source-group representation / concentration diagnostics：

```text
selected_source_group_count
selected_content_by_group
largest_group_share
selected_author_concentration
selected_content_type_distribution
claim_source_diversity
per_group_selection_coverage
```

第一 baseline 可用 simple deterministic saturation；threshold、minimum rounds、default budgets 不在本 Spec 冻结：

```text
DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION
```

阈值与默认值属于 `OPEN_DECISION D-6`。saturation 只能说明当前检索策略下的新信息增益趋缓，不是全站 coverage proof。

---

## 10. Security and Failure Semantics

### 10.1 Input classes

安全处理必须区分：

| Input class | Required handling |
|---|---|
| `USER_REQUEST` | normal input validation：length / encoding / schema / normalized identity boundaries；不是 `UNTRUSTED_CORPUS`，不机械套 `sanitizeProjectionText` |
| `MODEL_GENERATED_PLAN` | structured-output schema validation、bounds、dedupe、controller-owned hashing；无 IO/identity authority |
| `EXTERNAL_CORPUS` | `UNTRUSTED_CONTENT` / `DATA_NOT_INSTRUCTION`；projection sanitization；tool-less or capability-isolated worker；no credential access |

User request 可能包含任意文本，但它的身份是用户请求，不是外部知乎语料；Planner 结果也不是 canonical
fact。只有外部 corpus 进入 semantic/embedding worker 时适用 V2 projection isolation / sanitization contract。

**CD-C2 = INHERITED_UNCHANGED**：P1 Agent View 继承
[V2 §9.2](v2-rich-content-fidelity.md)
的 structure-preserving inert projection、raw code body DEFAULT OMIT 与 bounded metadata 规则，
以及既有 URL/path 安全边界；不得静默发送完整外部图片 URL 或 file URI。
不在 P1 复制第二套安全合同。未来代码正文语义能力须单独 Product + Spec + Security decision，
不能用本 amendment 或 prompt 授权。

### 10.2 Default failure contract

```text
FAIL_CLOSED
NO_SEMANTIC_DOWNGRADE
NO_SILENT_PROVIDER_FALLBACK
NO_SILENT_RUNTIME_FALLBACK
```

至少包括：

- invalid/unparseable plan → `planner_invalid` / fail；
- provider contract unknown → fail for that required route；
- no valid group set → fail；
- any required group unverified → research corpus cannot be declared complete；
- stale group/manifest/plan dependency → invalidate current reuse + identify earliest invalid boundary；stale COMPLETE 不自动 refetch/rerun，恢复权限与 ordinary interrupted resume 区别见 §6.2；
- semantic runtime unavailable → fail，不能 silent provider/runtime switch；
- embedding provider unavailable / invalid vector → `dense_layer_unavailable` / fail；
- corpus coverage / hierarchy / evidence lineage invalid → fail；
- legacy 缺必要版本/config identity/provenance → refuse current reuse，不猜测、不静默迁移（§6.2）；
- malformed relation proposal / empty family / 无来源 claim → fail，不默认套旧类别；
- 所有 selected sources 经合法 T13 分析后均无 claim → `T14_EMPTY_VERIFIED_INPUT`，无 synthesis artifact；
- 有完整 lineage 的合法 UNRESOLVED → §8 的显式未知报告，不等于坏 lineage、空输入或自动语义验收 PASS；
- VALID_FALSE、UNPARSEABLE、EXIT_FAILURE 保持不同 machine-readable identity。

Dense embedding 是完整 P1 baseline 的 core geometry。因此当前合同默认：

```text
DENSE_CAPABILITY_UNAVAILABLE
→ FAIL_CLOSED
```

`popularity-anchor-only` 不是已经合法的 peer option。未来若产品需要 degraded mode，必须满足：

```text
REQUIRES_EXPLICIT_SPEC_AUTHORITY
+ DISTINCT_MODE_IDENTITY
+ explicit disclosure / acceptance contract
```

在该 authority 出现前，`D-7 fail-closed vs degraded` 不再是本 Spec 的开放二选一。

---

## 11. Compatibility and Minimum-correct Architecture

- P1 是 additive path；v0.3 single-question orchestration 行为不被静默迁移。
- 本次 S1 正交语义要求 semantic contract version bump 与 Seam D major 1→2；V1 artifact
  `HISTORICAL_ONLY`，可历史展示但不能直接通过 V2 validator。禁止从旧 category 猜新关系/广度；
  仅完整原始 lineage 可取回并重新验证时，按 V2 re-evaluate/re-synthesize 产生新版本 artifact
  与新 identity，不称无损 migration。缺 lineage 不转换；原 bytes 保留。
- per-question `answers.json` / `answers.md` / `handoff.json` schema 不变。
- verify-output、make-handoff、corpus verification、controller-owned identity/lineage 权威不变。
- existing physical hierarchy 复用，但 P1 logical group representation 必须新增。
- no second canonical content store；research manifest 只做 derived composition。
- no provider endpoint / auth behavior speculation；adapter qualification 独立进行。
- no new benchmark / Gold / experiment in this Spec。
- browser scraping non-goal 不变（§5.1）：本 Spec **不授权**任何新的 browser-scraping /
  Browser-Session data-access 实现；既有 Session/Cookie primitive 只能经 provider seam 包装复用。

明确不进入 P1：Matrix Factorization、trained LTR、xQuAD、DPP、complex submodular、full active
learning、PCA/SVD、Chao/Quant production authority、InfoGain-RAG online scoring、Search-R1 / Stop-RAG、
TDA、large KG、advanced graph/statistical stopping。

---

## 12. Evidence Caveats

以下必须随任何后续 Spec / implementation / product claim 存活：

1. selector evidence 仅来自 two real-domain cases；不是跨领域普遍证明。
2. medical second adjudication 存在 partial blinding contamination。
3. `relative_compute_ops` 是 harness-relative proxy，不是 production cost。
4. B3 在 medical must-see 与 K24 cross-question 上仍有优势。
5. Dense Top-K weakness 不否定 dense embeddings。
6. Six dimensions relocated, not deleted。
7. P2 **Author / Personal Intelligence** 与 P3 **Continuous Intelligence** 仍为 design-only；P1 gate 不授权其实现。

---

## 13. P2 / P3 Boundary and Temporal Intelligence

- P1 = Cross-Question Deep Research。
- P2 = Author / Personal Intelligence。
- P3 = Continuous Intelligence。
- Temporal Intelligence 是服务 P2/P3 的 shared engine/design，不是 P2 的同义词。

P1 只保留 canonical identity / retrievedAt / provenance 等自然可复用事实，不为 P2/P3 预建 SQLite
history、incremental sync、watcher、delta detector 或 alerting。任何此类实现均超出本 Spec。

---

## 14. OPEN_DECISIONS

| ID | Decision | Current status / boundary |
|---|---|---|
| D-1 | production EmbeddingProvider / model | OPEN；需 identity、quality、egress、failure qualification |
| D-2 | ZhihuDataProvider capability routing / priority | OPEN / DISCOVERY_REQUIRED；Official Search 只是 first known adapter；禁止 silent fallback。**Clarification（本轮唯一 wording 澄清，不重开决策）**：exact per-capability provider routing / priority 仍 OPEN / DISCOVERY_REQUIRED，但它受已冻结的 `THIN / ADAPTER_FIRST / REUSE_FIRST` / official-first provider policy（§5.1）约束；D-2 **不得**被解释为重新打开高层 provider 偏好顺序 |
| D-3 | Planner 精确 persisted schema / validation bounds | OPEN；§4 概念字段已冻结，exact names delegated |
| D-4 | selector relevance/novelty weights、optional redundancy params | OPEN；`DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION` |
| D-5 | group floor / count / quota / anti-starvation numeric boundary | OPEN；preservation semantics 已冻结，数值未冻结 |
| D-6 | saturation thresholds、minimum rounds、query/group budgets | OPEN；`DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION` |
| D-7 | embedding cache/storage profile and public-Zhihu egress route | OPEN；不得弱化 §5.3 contract / current egress authority |
| D-8 | 是否引入 global quality-score aggregation | OPEN；minimum-correct default = 不引入 |
| D-9 | provider-specific OAuth / session credential behavior | OPEN / DISCOVERY_REQUIRED；P1 不修改现有 credential boundary |

不再 OPEN：

- public-Zhihu `SEMANTIC_RUNTIME_POLICY`：已由 Approved Research Orchestration 规定默认 `deepseek-api-tool-less`；
- Dense unavailable 的默认失败语义：`FAIL_CLOSED`；degraded mode 需未来 explicit Spec authority + distinct identity；
- 高层 provider 偏好顺序（THIN / ADAPTER_FIRST / REUSE_FIRST / official-first）：已冻结，D-2 不重开；
- sampled/full identity：现有 Approved contract 已冻结。

---

## 15. Status Discipline and Final State

本文件是 **APPROVED_SPEC_CANDIDATE**，不自行标记 APPROVED。本文件已逐项审计关键词：`provider`、
`runtime`、`embedding`、`sample`、`full`、`top-percent`、`source-group`、`questionId`、`hierarchy`、
`handoff`、`resume`、`P2`、`P3`、`Temporal`、`OPEN_DECISION`。

结论：

- ZhihuDataProvider / SemanticRuntime / EmbeddingProvider 已拆分；
- RCE corpus selection / explicit sampled analysis 已拆分；
- current Approved semantic-runtime policy 未重新 OPEN；
- Question/source-group logical hierarchy 已真实进入 architecture；
- multi-group execution/state/handoff/resume 已明确定义为 additive work；
- user request / model plan / external corpus 安全类型已拆分；
- exact schema / filename / threshold / provider endpoint 未被越权冻结；
- 高层 provider 偏好顺序保持冻结，D-2 仅作 wording 澄清；
- conditional approval lifecycle 已显式表达：review PASS 不单独激活 authority；无 post-review
  STATUS edit 设计；master drift 时旧 PASS 不转移；
- browser scraping non-goal 未被本 Spec amend；Browser Session reuse 保留为无 implementation
  authority 的 future provider position。

```text
DOCUMENT_STATUS = APPROVED_SPEC_CANDIDATE
PRE_EFFECTIVE_STATUS = REVIEW_PENDING
POST_EFFECTIVE_STATUS = APPROVED
APPROVAL_EFFECTIVE_ON =
  1. CONTRACT_REVIEWER PASS on this exact candidate HEAD
  2. CONSISTENCY_REVIEWER PASS on the same exact candidate HEAD
  3. candidate still has a legal current-master ancestry;
     if master drift requires re-form, old PASS does not transfer
  4. the exact reviewed HEAD is ff-only merged to remote master
  5. remote master is re-fetched and verified to contain the exact reviewed commit
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
NEXT_GATE = FRESH_CONTRACT_PLUS_INDEPENDENT_CONSISTENCY_REVIEW
```

本文件在 **APPROVAL_EFFECTIVE_ON 五条件全部满足之前**是 **NON_AUTHORITATIVE_CANDIDATE**：
不授权 production implementation，`TARGET_STATUS = NOT_IMPLEMENTED` 不变。五条件全部满足后，
本文件成为 **APPLICABLE_APPROVED_SPEC**（实现合同），但**仍不**改变
`TARGET_STATUS = NOT_IMPLEMENTED`（实现须经独立 implementation ticket）。

**本文件永不要求 post-review STATUS edit**：`PRE_EFFECTIVE_STATUS = REVIEW_PENDING` 字段在合并到
master 后保持原样；approval 由外部 gate 序列（review PASS on exact reviewed HEAD → ff-only merge →
remote master re-fetch verify）生效，**不会**产生"review PASS → 编辑 STATUS → 新 commit"这种使旧
PASS 失效的流程。review PASS alone 不激活 authority；master drift 导致 re-form 时，旧 PASS 不转移。
