# Research Orchestration — Approved Implementation Contract（研究编排批准实现合同）

> **STATUS: APPROVED**（产品合同已批准；2026-08-24 product-owner 决策 + CONTRACT/CONSISTENCY 双 independent review）
> **IMPLEMENTATION_STATUS: NOT_IMPLEMENTED**（功能尚未实现，不得宣传 feature 已存在）
> **VERSION_ASSIGNMENT: UNASSIGNED**（未分配版本号）
> **IMPLEMENTATION_AUTHORIZATION: MVP_AUTHORIZED**（仅授权 Research Orchestration MVP 实现；不自动创建 V0.4）
> **ORIGIN: Issue #5**（`[Dogfood][F4] End-to-end research requires too many manual orchestration steps`）
> **PRODUCT_STAGE: NEXT_STAGE / RESEARCH_ORCHESTRATION**
> **Author handle:** FlapPearLabs
> **Date:** 2026-08-24

本 Spec 明确声明：

```text
PRODUCT CONTRACT APPROVED      // 产品合同已批准：可作为后续 Research Orchestration 实现 authority
FEATURE NOT IMPLEMENTED        // 功能未实现：不得宣传 feature 已存在（IMPLEMENTATION_STATUS: NOT_IMPLEMENTED）
IMPLEMENTATION AUTHORIZED      // 未来 MVP 实现已被授权（IMPLEMENTATION_AUTHORIZATION: MVP_AUTHORIZED）
NO VERSION NUMBER ASSIGNED     // VERSION_ASSIGNMENT: UNASSIGNED
THIS DOES NOT AUTOMATICALLY CREATE V0.4  // 不自动创建 V0.4 / 不启动新 milestone
```

本文件是 **APPROVED implementation contract**（按 `AGENTS.md` §1 / RULES.md §6 语义成为 repository authority 的一部分，
覆盖本 Spec 定义的 Research Orchestration 范围）。它对未来 Research Orchestration MVP 实现**具有约束力**；
**不影响** `docs/specs/v2-rich-content-fidelity.md` / `docs/specs/v0.3-product-scope.md` 的既有合同
（未被本 Spec amendment 的条款继续有效），本 Spec **不构成**对它们的 amendment。

> **APPROVED SPEC != IMPLEMENTED FEATURE**
>
> 本 Spec 现在**可以约束未来实现**（Approved implementation contract），
> 但**不能宣传功能已经存在**（IMPLEMENTATION_STATUS: NOT_IMPLEMENTED）。
>
> 文中 MUST / MUST NOT / REQUIRED / acceptance / non-goal 措辞描述的是
> **已批准的 implementation contract**（对未来实现 ticket 有约束力），
> 不是「该功能已实现」的声明。实现 ticket 完成并验收前，任何对外声称
> 「research orchestration 可用」都是不成立的。
>
> 本 Spec 覆盖的范围内，它以 Approved Spec 身份约束实现。
>
> **Authority model**（按 `AGENTS.md` §1 / RULES.md §6 的真实模型，不发明新层级）：
>
> 1. `RULES.md` **hard invariants** 保持 binding（本 Spec 不得覆盖）。
> 2. 本 Spec 一旦 APPROVED，即作为 **Applicable Approved Spec** 参与产品需求 authority，
>    覆盖其**明确的 Research Orchestration scope**。
> 3. Applicable Approved Specs（V2 / V0.3 / 本 Spec）按**明确的 scope / amendment 关系共同解析**；
>    **不存在**「既有 / 更旧的 Approved Spec 自动压过本 Approved Spec」的规则。
> 4. `docs/product-behavior-contract.md` 是已批准产品行为的**归一化视图**，
>    **不得覆盖** Applicable Approved Specs。
> 5. 若真实 authority 冲突无法按明确 scope / amendment 关系解决 → **STOP：`CONTRACT_CONFLICT`**
>    （`SPEC_CONFLICT` / `GOVERNANCE_CONFLICT` 仅作 finding / reason category，不得静默选方便一方）。

---

## 1. Problem Statement

### 1.1 问题（来自 Issue #5，保持原意）

当前仓库的**确定性 primitives 已经可靠工作**，但一个正常的 end-to-end research 工作流仍要求用户**理解并人工编排大量步骤**：

```text
search
→ candidate selection
→ batch capture
→ verify
→ inspect scale/stats
→ sample or handoff
→ corpus processing
→ synthesis
```

该流程在 Production Dogfood 1 期间可行，但需要大量人工编排。用户意图通常只是「research this topic on Zhihu」，却必须理解并手动路由多个实现步骤。`ORCHESTRATION_COMPLEXITY` 是待解决的问题，**不是**：

- capture correctness；
- verifier correctness；
- 新 Agent runtime；
- 新模型能力；
- 新抓取机制；
- 新 canonical data model。

### 1.2 产品目标

把 orchestration complexity 从用户脑中**搬入一个薄的确定性 controller / orchestrator**，而不是重新实现底层 primitives。

### 1.3 核心原则（持久）

```text
ORCHESTRATE_EXISTING_PRIMITIVES        // 编排既有 primitives，不重建
DO_NOT_REIMPLEMENT_EXISTING_AUTHORITIES // 不重实现既有确定性权威（verifier / make-handoff / 验证 gate）
```

### 1.4 BASELINE SNAPSHOT AT SPEC CREATION（2026-08-24）

> This is historical baseline evidence, not a dynamic current-state authority.
> Any future implementation must re-observe repository truth before execution.
> （以下为 Spec 创建时的历史基线快照，非动态当前状态权威；未来任何实现执行前必须重新核对仓库真相。）

**Zhihu 侧（zhihu-answer-grabber）：**

| primitive | 实现 / authority | CURRENT behavior |
|---|---|---|
| `search` | `src/cli.js cmdSearch` + `src/search-answer-count.js`（bounded enrichment） | 返回 candidates[]（含 `answerCount: number \| null`，additive optional；缺失 / `null` 优于虚构；失败不拖累 search） |
| `grab` / `batch` | `src/cli.js cmdGrab / cmdBatch` | capture：stage=`captured`、`verified: false`；resume-merge 语义；断点续传 |
| `verify-output` | `scripts/verify-output.mjs`（`src/verifier.js`，14 项校验） | 产物有效性唯一确定性权威；`valid === true` 唯一授予 verified 路径（`captured != verified`） |
| `make-handoff` | `scripts/make-handoff.mjs` | 确定性 handoff 权威；拒绝 `valid !== true` 产物；禁止手工构造 verified handoff |
| `status` | `src/cli.js cmdStatus` | capture / verification 状态查询 |

**Corpus 侧（corpus-anthology）：**

| primitive | 实现 / authority | CURRENT behavior |
|---|---|---|
| `archive` | `scripts/archive.mjs` | 机械拼接、零改写归档 |
| `popular-sample` | `scripts/popular-sample.mjs` | 按 voteupCount Top N 截断预览，明确标注「不代表整个语料」，非摘要、不进 coverage gate |
| `select` | `scripts/select.mjs` + `lib/top-percent-selector.mjs`（T8 #14） | top-percent 确定性选择 → `selection.json`（`selectorHash` 恒定）；K 合同 / 排序 / strict count 已批准（T7 #13） |
| `chunk` | `scripts/chunk.mjs` | 分块；`--mode top-percent-analysis --selection`、`--hierarchy` 等模式 |
| `map` | `scripts/map.mjs` + `lib/lmstudio-map-executor.mjs` / `lib/deepseek-tool-less.mjs` | per-source tool-less projection map；runtime 路由 additive（默认 `lmstudio-local-tool-less`，`--runtime deepseek-api-tool-less`；不支持 runtime → `capability_isolation_unavailable` fail closed）；任一来源失败 → 整 chunk fail closed |
| `verify` | `scripts/verify.mjs` | coverage / evidence gate（sourceCoverage 全覆盖、stale、cross-chunk evidence 等） |
| `reduce` | `scripts/reduce.mjs` | mode 身份（`digest` / `top-percent-analysis`）；披露块；final.json 消费合同 |
| `render-final` | `scripts/render-final.mjs` | 最终渲染 |
| hierarchical full digest | `scripts/map.mjs --hierarchy` + `lib/hierarchy.mjs`（T10 #16） | OPTION A additive explicit；hybrid lineage；递归覆盖不变量；flat digest 默认不变 |

**已接受的 runtime / controller 边界（`docs/architecture/runtime-strategy.md`，ACCEPTED ARCHITECTURE RECORD）：**

- **Controller owns truth and authority. Model owns semantics.**（controller 拥有 canonical source identity / source coverage / evidence lineage / projection / 结构化校验 / fail-closed / mode identity / disclosure 权威；模型只拥有语义生成）
- **Runtime is replaceable infrastructure, not product identity.**
- `CAPABILITY_ISOLATION_AVAILABLE[lmstudio-local-tool-less] = YES`（local，runtime-scoped）；
  `CAPABILITY_ISOLATION_AVAILABLE[deepseek-api-tool-less] = YES`（provider-specific；云出网仅限 V0.3 T11 公开知乎语料，**不得推广**到私密 / 敏感语料）。
- 无静默 runtime fallback；runtime routing / fallback 是独立产品 / 安全决策（见 §7）。
- `MODEL_QUALITY != RUNTIME_SECURITY`；unsupported / unqualified runtime 不得被静默启用。

---

## 2. Desired User Experience

### 2.1 概念上的目标体验（PRODUCT INTENT，已批准；exact 实现形态为 IMPLEMENTATION DETAIL）

```text
research <topic>
→ search
→ candidate presentation / selection
→ capture
→ verify
→ handoff
→ analysis pipeline
→ final rendered research result
```

### 2.2 默认用户交互目标（缩减到最少）

1. 输入研究主题；
2. 必要时选择 / 确认一个候选问题；
3. 获取最终结果。

### 2.3 边界：PRODUCT INTENT vs IMPLEMENTATION DETAIL

- 本节描述的是**产品意图**（用户应最少做什么）；概念上的 `research <topic>` entrypoint 已批准（R1），但 **exact CLI syntax / 函数名 / 文件名属 IMPLEMENTATION DETAIL**，不由本 Spec 锁死。
- 任何 orchestration 都必须保持「重要决策与失败对用户可见」（#5 Desired behavior 原文），不得把编排变成黑盒。

---

## 3. Thin Orchestrator Boundary

### 3.1 Orchestrator MAY（可做）

- sequence existing primitives（按顺序编排既有 primitives）；
- inspect their machine-readable results（读取并解析 primitives 的机器可读结果，优先 `--json` 契约，RULES §11）；
- determine legal next stage（根据结构化结果决定合法下一阶段）；
- maintain resumable orchestration state（维护可恢复的编排状态，见 §8）；
- expose progress（暴露进度）；
- stop on deterministic failures（确定性失败时停止，见 §9）。

### 3.2 Orchestrator MUST NOT（不可做）

- reimplement capture（不重实现抓取）；
- independently redefine valid/verified（不独立重定义 valid / verified 语义）；
- hand-build verified handoff（不手工构造 verified handoff；AGENTS.md §14）；
- bypass corpus verification（不绕过 corpus 验证 gate）；
- fabricate source coverage（不伪造 source coverage）；
- silently mutate canonical data（不静默修改 canonical 数据）；
- let an LLM replace deterministic verification authority（不允许 LLM 取代确定性验证权威）。

### 3.3 持久规则

```text
ORCHESTRATOR_COORDINATES   // orchestrator 只做编排与协调
VERIFIER_AUTHORITATES      // verifier（verify-output）是验证权威
```

---

## 4. Authority Preservation

未来 orchestrator 的任何设计 / 实现都必须保留以下既有权威与不变量（来自 RULES.md / Approved Specs / runtime-strategy.md）：

```text
captured != verified                                   // 抓取 ≠ 验收（RULES §4）
verify-output remains validity authority               // verify-output 是唯一确定性验收权威
make-handoff remains deterministic handoff authority   // make-handoff 是唯一确定性 handoff 权威
canonical source identity remains controller-owned     // canonical 源身份归 controller（runtime-strategy §2）
evidence lineage remains mechanically verifiable       // 证据 lineage 保持机械可验证（R10 / T9 hybrid lineage）
SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST               // 采样分析 ≠ 全量 digest（pipeline identity 分离，T7 APPROVED）
MODEL_QUALITY != RUNTIME_SECURITY                      // 模型质量限制不否定能力隔离（AGENTS.md §11.1）
unsupported/unqualified runtime must not be silently enabled // NO/UNKNOWN runtime 不得静默启用（V0.3 决策 C）
```

---

## 5. Candidate Selection Gate

> **决策状态：APPROVED**（R2 + R3，2026-08-24 product-owner 批准；selection 属 orchestration decision，不是 verification fact）

### 5.1 APPROVED 合同（R2 + R3）

系统**允许自动选择最相关的知乎问题**。默认行为：

- 候选问题与用户研究意图之间存在**足够明确的最佳匹配** → **自动选择**；selection 决策必须对用户可见 / 可记录；**不为形式强制用户确认**。
- 存在 **MATERIAL AMBIGUITY**（多个候选分别代表明显不同的研究问题，且自动选一个可能改变用户原始研究意图）→ **最多进行一次**用户 clarification / confirmation；用户确认后继续。

禁止：

- **每次**都强制用户手工选题；
- 模型低置信度时**静默猜测**；
- 为追求自动化而**改变用户研究问题**。

Agent / model 可以参与 relevance 判断，但**不得取得 canonical data / verification authority**。
Candidate selection 属 orchestration decision，不是 verification fact。

---

## 6. Analysis Mode Selection

> 硬约束：不得因为 corpus 大就静默把 full digest 降成 sample。

### 6.1 必须保留的不变量

```text
SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST
```

- pipeline identity 保持分离：`mode` 是分析模式身份（`digest` / `top-percent-analysis`），覆盖事实（`isFullCoverage`）不得覆盖模式身份（T7 APPROVED 合同）。
- full-coverage 请求必须保持 **100% coverage** + evidence lineage，不得降级为 sample。

### 6.2 Spec 定义（Approved implementation contract）

- **explicit user mode 优先**：用户显式选择的模式（full digest / top-percent / popular-sample）优先于任何默认路由；
- **full-coverage request 必须保持 100% coverage**：请求全量 digest 时不得静默改用采样路径；
- **sampled mode 必须明确 disclosure**：采样模式必须披露覆盖范围 / 选择规则 / 「不代表全量」；
- **top-percent 不得静默替代 full digest**：除非用户显式选择 top-percent；
- **runtime failure 不得自动改变分析语义**：分析模式选择不得因运行时失败被自动降级。

### 6.3 默认 routing policy（APPROVED，R4）

默认研究语义 = **FULL-COVERAGE RESEARCH**：

- 用户仅表达「帮我研究 / 看看大家怎么讨论 / 综合分析这个问题」→ **默认保留 full coverage 语义**；
- 大 corpus **优先复用现有 hierarchical full digest**，不静默降级为 sample；
- 仅当用户**明确表达 sampled 意图**（「快速看看 / 只看高赞 / 看前 X% / 给我一个 sampled view / 不需要全量」）→ 才可进入 top-percent / popular-sample 等 sampled path；
- full coverage 无法完成 → **fail closed / report reason**，不得冒充完成。

硬不变量保持：`SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST`。
禁止：full digest 因成本 / runtime failure / corpus size → silent sampled downgrade。

---

## 7. Runtime Selection / Fallback

### 7.1 引用既有 runtime strategy

- `docs/architecture/runtime-strategy.md`（ACCEPTED ARCHITECTURE RECORD）：**Runtime is replaceable infrastructure, not product identity**；§6 Runtime-selection engineering rule：capable-runtime first for product validation，本地优化仅在实测 / 批准约束之后。
- `AGENTS.md §11.1`（MODEL / RUNTIME SELECTION）：capable-runtime first；本地推理仅在已批准 / 实测约束（隐私 / 离线 / 成本 / 时延 / 可用性）下作为阻断性要求；持久原则含 `MODEL_QUALITY != RUNTIME_SECURITY`（模型质量限制不否定能力隔离）。
- V0.3 Spec §5（决策 C）：capability isolation 逐 runtime 独立门控，NO / UNKNOWN → fail closed，禁止跨 runtime 推导。

### 7.2 MVP runtime policy（APPROVED，R5）

对于 **PUBLIC ZHIHU RESEARCH**，初始默认已资格通过的语义 runtime 为：

```text
deepseek-api-tool-less
```

原因（不是把 DeepSeek 写成 product identity）：

- 已取得 runtime-scoped capability isolation qualification（`CAPABILITY_ISOLATION_AVAILABLE[deepseek-api-tool-less] = YES`）；
- V0.3 real dogfood 已验证该 workload 可用（79 / 183 / 318 回答带全验证通过）；
- 当前目标是先验证产品 workflow，而不是重新优化 runtime。

保持：

```text
Runtime is replaceable infrastructure, not product identity.
MODEL_QUALITY != RUNTIME_SECURITY
NO_SILENT_RUNTIME_FALLBACK
```

明确禁止：

```text
DeepSeek failure   → silent LM Studio fallback   // 禁止（未经批准）
LM Studio failure  → silent cloud fallback       // 禁止（未经批准）
```

runtime / provider 切换未来必须经过**明确批准的 routing policy**。

### 7.3 Egress 边界（APPROVED，R5 限定）

```text
PUBLIC ZHIHU cloud egress approval != PRIVATE / SENSITIVE CORPUS cloud egress approval
```

本批准**仅适用**于公开知乎研究语料。**不得推广**到：

- 用户私有文档；
- 私密知识库；
- 敏感 corpus；
- 未经授权的第三方数据。

（runtime-strategy §5 / #28 STOP conditions / `docs/project-memory.md` V0.3 Runtime Closeout：V0.3 T11 公开知乎语料云出网批准不得推广到私密 / 敏感语料。）

---

## 8. Resumable State Machine

> **决策状态：DELEGATED_IMPLEMENTATION_DESIGN**（R6，2026-08-24 委派；不是 OPEN PRODUCT DECISION）
> 产品要求已足够明确（见 §8.2 约束）；最小 schema / 文件布局由工程实现自行决定，本轮不设计具体 JSON schema。

未来 orchestration **必须**具有**最小可恢复 orchestration state**（中断后可继续，不重复已完成的确定性阶段）。

### 8.1 概念状态（可能的状态集；具体 schema / version 留 implementation design）

```text
SEARCHED
SELECTED
CAPTURED
VERIFIED
HANDED_OFF
ANALYZED
RENDERED
COMPLETE
```

### 8.2 约束（未来实现必须满足；Approved implementation contract）

- **resume 只能从可验证 checkpoint 恢复**（例如 hash 校验的 stage artifact；`FILE EXISTS != VALID CACHE`，参照 T9 / T10 的 inputHash / childHashes 语义）；
- **stale artifact / incompatible hash 不得静默复用**（参照 T9 resume/stale 向上传播语义）；
- **credentials 不进入 orchestration state**（Cookie / Secret / API key 一律不进状态文件；RULES §1）；
- **machine-private path 不进入 portable public state**（无本机绝对路径 / 用户名；RULES §11 路径脱敏）；
- **state 不得成为新的 canonical source of truth**（canonical 事实仍归 `answers.json` / `selection.json` / final.json 等既有 authority；orchestration state 只是执行进度）；
- **canonical artifact / hash authority 继续属于既有 primitives**。

---

## 9. Failure Semantics

### 9.1 默认原则

```text
FAIL_CLOSED
NO_SEMANTIC_DOWNGRADE
```

### 9.2 示例（确定性失败语义方向）

```text
search failure          → stop
capture failure         → stop / resumable（按既有 capture 断点续传合同）
verify valid=false      → stop（不得把 invalid 当 valid 继续）
handoff invalid         → stop（make-handoff 拒绝 valid !== true 产物）
runtime unavailable     → stop（capability_isolation_unavailable，无静默 fallback）
map/coverage/lineage failure → stop（corpus verify gate 不绕过）
```

### 9.3 明确禁止

```text
full digest failure → silently return sample        // 禁止：全量失败静默降级为采样
runtime failure     → silently change provider/security boundary // 禁止：运行时失败静默切换提供商 / 安全边界
```

---

## 10. Artifact / Observability Contract

> **决策状态：DELEGATED_IMPLEMENTATION_DESIGN**（R7；具体 UX / stdout / JSON event schema 留实现设计，不是 product-owner blocker）

未来 orchestration 至少需要让用户 / Agent 知道（Approved requirement；具体 schema 不硬编码）：

- current stage（当前阶段）；
- selected question（所选问题）；
- analysis mode（分析模式）；
- coverage（覆盖范围 / 是否全量）；
- verification status（验证状态）；
- runtime identity where applicable（实际使用的 runtime 身份，参照 T11-R2 节点身份反映真实传输的教训）；
- completion / failure reason（完成 / 失败原因）；
- final artifact references（最终产物引用，relative path / artifact id，无绝对路径）。

MVP 产品要求：至少暴露当前 stage / progress（SEARCH / SELECT / CAPTURE / VERIFY / ANALYZE / RENDER）；
支持 graceful stop 与后续 resume。
MVP **不要求**：GUI progress bar / rich dashboard / streaming animation / complex cancellation UI / background job platform。

具体字段结构、schema version、机器契约属于 **IMPLEMENTATION DETAIL / OPEN DESIGN**（R6 / R7 DELEGATED），不由本 Spec 锁死。

---

## 11. Security / Privacy

保留所有既有 credential 边界（RULES §1 / product-behavior-contract §3.14 / runtime-strategy §5）：

```text
Cookie / Secret / API key 不进入 Git
不进入 run state
不进入 model projection
不进入 public logs
LLM 不拥有 controller IO authority（controller 唯一 IO；LLM NETWORK/SHELL/FS/TOOLS 全 DENY）
public Zhihu cloud egress precedent ≠ private corpus authorization
（V0.3 T11 公开知乎语料云出网批准不得推广到私密 / 敏感语料）
```

---

## 12. Non-goals

本 Spec 明确排除以下范围（**Approved MVP 实现范围之外**；本文件现在具约束力，见顶部 APPROVED SPEC != IMPLEMENTED FEATURE）：

其中部分排除项同时受既有 Approved authority 约束（例如 RULES.md §6.4「Spec Non-goals 是长期约束，不是临时建议」适用于已批准 Spec 的 non-goals；V2 / V0.3 的既有 Non-goals 继续有效）。这些约束具有约束力，是因为**既有 authority 本身存在**，且本 Approved Spec 的 non-goals 作为已批准合同继续生效。

**Approved MVP 实现范围**限定为：

```text
Natural-language research intent
→ search
→ candidate selection
→ capture
→ verify
→ handoff
→ full/sampled analysis according to approved semantics（R4）
→ final rendered research result
```

允许：thin orchestration layer / minimal resumable state / stage progress / graceful stop-resume。

**不包含**：

- 不重写 grabber；
- 不重写 verifier；
- 不重写 corpus pipeline；
- 不新增 canonical corpus source；
- 不新增 model / provider qualification（runtime 资格走独立 evidence / qualification ticket，V0.3 决策 C 门控不变）；
- 不做 arbitrary runtime routing（未授权不得自动路由 / fallback；R5 仅批准公开知乎研究默认 runtime）；
- 不重新打开 video（`VIDEO_SUPPORT = DO_NOT_SUPPORT`，V0.3 决策 B 不变）；
- 不实现 browser scraping（V2 / V0.3 既有立场不变）；
- 不做 OCR / image understanding；
- 不做 private / sensitive cloud workflow（R5 egress 边界）；
- 不做 GUI / web app / background queue platform / multi-user system / account system / database migration / recommender system / autonomous daily topic discovery / social-media publishing；
- VERSION_ASSIGNMENT / milestone creation 属**本 Spec 之外**：本 Spec 本身**不创建、不命名 V0.4**，也不分配任何版本号；
  `VERSION_ASSIGNMENT` 保持 `UNASSIGNED`，直至**另行单独授权**。

---

## 13. Acceptance Contract（Approved Implementation Acceptance）

> 以下为 **APPROVED IMPLEMENTATION ACCEPTANCE**（已批准的实现验收合同）：未来实现 ticket 声称「#5 描述的产品问题已解决」之前，
> 必须满足以下全部方向（A–L）。**Approved ≠ Implemented**：本 Spec 批准不改变 `IMPLEMENTATION_STATUS: NOT_IMPLEMENTED`。

- **A.** 用户无需理解内部 8–10 个 primitive steps（编排细节对用户透明）。
- **B.** 普通 happy path 目标为：`natural-language topic → zero or at most one necessary clarification → final research result`。
- **C.** existing deterministic authorities remain unchanged（verify-output / make-handoff / corpus verify gates 权威不变）。
- **D.** failure / resume semantics mechanically testable（失败与恢复语义可机械测试，不是口头声明）。
- **E.** no hidden sampled/full semantic downgrade（无隐藏的 sample/full 语义降级）。
- **F.** full digest retains 100% canonical source coverage + evidence lineage（全量 digest 保持 100% 覆盖与证据链）。
- **G.** real dogfood demonstrates meaningful reduction in manual orchestration（真实 dogfood 证明人工编排步骤实质性减少）。
- **H.** credentials / security boundaries preserved（凭据 / 安全边界保持）。
- **I.** **AUTO-SELECTION correctness / ambiguity handling 必须有 focused tests**：
  - clear best candidate → auto-select；
  - material ambiguity → clarification required；
  - no valid candidate → fail / report（不能乱选）。
- **J.** **default full-coverage semantics 必须有 regression**：generic research request 不得默认进入 sampled mode（R4）。
- **K.** **runtime policy test**：public Zhihu 默认使用 approved runtime policy（R5 = deepseek-api-tool-less）；runtime failure 不得 silent fallback。
- **L.** **orchestration state 必须证明**：interruption + resume 不会重复合法完成阶段，也不会复用 stale artifact（R6）。

---

## 14. Product Decision Ledger（R1–R7）

以下决策已由 product owner **明确批准或委派**（2026-08-24）；**不再作为 OPEN PRODUCT DECISION / USER_DECISION_REQUIRED**：

```text
R1: APPROVED                            // 自然语言研究意图 + 概念 research <topic> entrypoint；
                                        //   exact CLI syntax / 函数名 / 文件名 = IMPLEMENTATION DETAIL（不锁死）
R2: APPROVED                            // 允许自动选择最相关问题；selection 可见 / 可记录；
                                        //   MATERIAL AMBIGUITY → 最多一次 clarification
R3: APPROVED                            // auto-select 默认允许（非强制人工选题）；
                                        //   模型低置信度不得静默猜测；模型不拥有 canonical / verification authority
R4: APPROVED                            // 默认 FULL-COVERAGE RESEARCH（大 corpus 用 hierarchical full digest）；
                                        //   sampled 仅当用户显式表达 sampled 意图；full 失败 fail closed
R5: APPROVED                            // 公开知乎研究默认 runtime = deepseek-api-tool-less（资格已过）；
                                        //   无静默 fallback；PUBLIC Zhihu egress != PRIVATE corpus egress
R6: DELEGATED_IMPLEMENTATION_DESIGN     // 最小可恢复 orchestration state；schema / 文件布局由实现决定，
                                        //   约束见 §8.2（可验证 checkpoint / FILE EXISTS != VALID CACHE / 凭据不入 state 等）
R7: DELEGATED_IMPLEMENTATION_DESIGN     // 至少暴露 stage / progress + graceful stop + resume；
                                        //   GUI / dashboard / streaming / 复杂 cancel UI 不要求；
                                        //   具体 UX / stdout / JSON event schema 留实现设计
```

以下仍属 **IMPLEMENTATION DETAIL**（不是 product-owner blocker / 不是 `USER_DECISION_REQUIRED`）：

- exact CLI filename / 函数名 / 命令参数（R1）；
- persistent run-state JSON schema（R6）；
- progress event schema / stdout 格式（R7）。

---

## 15. Relationship to Issue #5

- **Issue #5 是最早的 loose product-problem record**：`[Dogfood][F4] End-to-end research requires too many manual orchestration steps`。
- **#5 GitHub 状态（HISTORICAL，保持不变）：CLOSED / state_reason = not_planned**。
  这是在本 Spec 获得批准**之前**记录的**历史 issue-close 分类**；`not_planned` **不得被解释为当前实现禁止**。
  （历史 closeout 时刻，需求仅作为「proposed future scope」保留——该表述在 closeout 时刻为真，现为历史事实。）
- **当前 authority（CURRENT，2026-08-24 本 Spec 获批后）：**

  ```text
  STATUS: APPROVED
  IMPLEMENTATION_STATUS: NOT_IMPLEMENTED
  IMPLEMENTATION_AUTHORIZATION: MVP_AUTHORIZED
  PRODUCT_STAGE: NEXT_STAGE / RESEARCH_ORCHESTRATION
  ```

  本 Spec 已获显式批准，**现授权 Research Orchestration MVP 实现**；因此 #5 的 `not_planned` 关闭
  **不构成**当前实现禁令，#5 也**不需要**因实现现已授权而重新打开。
  未来实现通过**新的 implementation ticket** 进行，该 ticket 必须引用本 Approved Spec 并满足 §13 acceptance（A–L）。
  #5 的关闭分类（`not_planned`）保持不变；**不得**声称 #5 为 `COMPLETED` / `FIXED` / `implemented`——需求当时未被实现。
- **本 Spec 是其规范化 successor**：把 #5 描述的 ORCHESTRATION_COMPLEXITY 问题正式化为可审查、已批准的 implementation contract。
- **本 Spec 批准后**：未来实现 ticket **必须引用本 Spec** 并满足 §13 acceptance contract（A–L），才能声称「research orchestration feature 存在」。本 Spec 是 feature 尚未实现的 Approved 合同。
- 本 Spec 的批准不改变 #5 的关闭分类（`not_planned`），也不重新打开 #5。

---

## 附录 A：本 Spec 的 authority 边界

本文件当前状态：

```text
STATUS: APPROVED
IMPLEMENTATION_STATUS: NOT_IMPLEMENTED
VERSION_ASSIGNMENT: UNASSIGNED
IMPLEMENTATION_AUTHORIZATION: MVP_AUTHORIZED
PRODUCT_STAGE: NEXT_STAGE / RESEARCH_ORCHESTRATION
```

- 本文件是 **Approved implementation contract**（覆盖 Research Orchestration 范围，对未来实现有约束力）；
- **不修改** existing Approved Specs（V2 / V0.3）；
- **不修改** RULES.md / AGENTS.md（现有通用治理已足够，本轮 NO CHANGE）；
- **不修改** product behavior implementation / runtime code / source / tests（历史执行事实：本批准归一化 candidate 本身不含 production code——**The approval-normalization candidate itself contained no production code; implementation proceeds through a separate implementation ticket**）。
- **不修改** `docs/project-memory.md`（如有 durable 知识沉淀，走 post-gate memory follow-up 独立 review，不混入本 candidate commit）。

产品行为合同（`docs/product-behavior-contract.md`）当前只记录**已实现行为**；本 Spec 的 Research Orchestration 能力
仍为 NOT_IMPLEMENTED，**不得**被写成 current product behavior。实现落地并通过验收后，再按既有流程评估是否需要
product-behavior-contract 同步。
