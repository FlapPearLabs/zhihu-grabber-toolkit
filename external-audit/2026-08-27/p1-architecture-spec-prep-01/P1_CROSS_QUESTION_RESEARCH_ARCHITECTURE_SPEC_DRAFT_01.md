# P1 Cross-Question Deep Research — Architecture Spec Draft 01

```text
DOCUMENT_STATUS = DRAFT
REVIEW_STATUS = REVIEW_PENDING
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
DOCUMENT_ID = P1_CROSS_QUESTION_RESEARCH_ARCHITECTURE_SPEC_DRAFT_01
BASE_SHA = 196db3d9775e33ff8cd6bf4e218ba4313630a923 (dg01-decision-grade-gate)
BRANCH = spec/p1-architecture-spec-prep-01
```

**Authority chain**（本 Draft 的每一条架构决策都必须能回溯到以下 authority；无法回溯的一律进入 §10 OPEN_DECISIONS，不得自行拍板）：

| Level | Source | Role |
|---|---|---|
| 0 | `RULES.md` / `AGENTS.md` | hard invariants + workflow |
| 1 | `external-audit/2026-08-27/chatgpt-context/authority_sources/00…09` | current frozen design（09 在其 amendment 范围内覆盖 02/04） |
| 1 | `docs/specs/v2-rich-content-fidelity.md`（Approved） | 三层内容模型 / trust boundaries |
| 1 | `docs/specs/v0.3-product-scope.md`（Approved additive amendment） | v0.3 产品范围 |
| 1 | `docs/product-behavior-contract.md` | 可执行行为归一化视图 |
| 2 | `05…08` authority sources、evidence-gate-01 产物 | evidence only |
| 3 | `06` authority source | 历史背景 |

**Evidence base**：P1 Evidence Gate 01（PASS_WITH_CAVEATS）+ RCE_DESIGN_AMENDMENT_01（DESIGN_FROZEN_AMENDMENT）。两个 real-domain cases、216 captured sources、四个 fair strategies（B0/B1/B2/B3）、47 labels 第二 adjudication。

---

## 1. Problem Statement（P1 是什么）

P1 = Cross-Question Deep Research：用户给出一个自然语言研究主题（topic），系统产出一份**有证据支撑的跨问题综合研究结论**，全链路为：

```text
natural-language topic
→ multi-query search（搜索规划）
→ 多个 Zhihu question / 多种文体候选（answers + comments）
→ Research Coverage Engine（选择 + 覆盖 + 合成）
→ Verified Research Corpus（captured + verified）
→ evidence-backed cross-source synthesis
```

与 v0.3 现状的本质差异只有两点：

1. **Question-level**：v0.3 research-orchestration 已实现 topic → search → select → capture → verify → handoff → analyze → render 全链，但 `selectCandidate` 是**单问题**确定性词面选择（auto / ambiguous / none 三 verdict，至多一次 clarification）。P1 需要**多问题**输入（Question/Source-group Preservation）。
2. **Selector-level**：v0.3 corpus-anthology 的 `select.mjs` 是 top-percent 确定性采样（voteupCount DESC 单键）。P1 需要四组件 selector（见 §3）。

其余能力——capture / verify / handoff / chunk / map / reduce / hierarchy / tool-less runtime / capability isolation / fail-closed 语义——**全部已存在且必须复用**（ADAPTER_FIRST / STRANGLER_FIRST / NO_REWRITE）。

---

## 2. CURRENT_V0_3_SEAM_MAP

> 本节是对现有 production code 的实际阅读结果（非设计想象）。Architecture 必须从这些 seam 长出来。

### 2.1 九个 seam 问题的回答

**Q1 — CLI / orchestration 从哪里进入？**

- 单问题工具链入口：`zhihu-answer-grabber/src/cli.js`（`zhigrab grab|batch|search|status`）。
- 研究编排入口：`research-orchestration/bin/research.mjs` → `lib/orchestrator.mjs` `createOrchestrator({workDir, topic, mode, percent, runtime, forceQuestionId, runner})`。orchestrator 是 thin deterministic controller：通过 `runner(name, args, opts)` 子进程调用既有 primitives（`zhihu-search` / `zhihu-grab` / `zhihu-verify` / `zhihu-handoff` / `corpus-chunk` / `corpus-select` / `corpus-map` / `corpus-verify-work` / `corpus-verify-final` / `corpus-reduce` / `corpus-render` / `deepseek-preflight` / `zhihu-preflight`），**从不重新实现** capture/verify/handoff/corpus 逻辑，从不让 LLM 决定 validity。

**Q2 — Search / capture / verify 在哪里？**

- Search：`zhihu-answer-grabber/src/official.js` `searchQuestions()`（developer.zhihu.com 官方 API，Bearer secret）+ `src/search-answer-count.js` bounded question-info enrichment（OPEN-D1 合同：每候选 ≤1 次 HTTP、失败降级 null、search 本身不失败）。
- Capture：`src/grber.js`（文件名 `grabber.js`）`grabAll()`：分页循环 + `MAX_PAGES=300` 安全阈值 + 页面指纹防重复分页 + `is_end===true` 完成合同 + atomic write（tmp+rename）+ `QuestionMetadataIdentityError` 身份门。
- Verify：`src/verifier.js` `verifyOutput()`：14 项校验的**单一事实来源**（目录=JSON=handoff 三方一致、fence-aware 帧计数等）；`captured != verified`，只有 verify-output 可授予 verified。

**Q3 — canonical / source identity 当前如何表示？**

- Capture 层：`questionId`（1-20 位数字，`validateQuestionId` 白名单）+ answer `id`（string）；产物目录 `<outDir>/<qid>/answers.json`，JSON 内 `questionId` 必须与目录名一致（三方一致 invariant）。
- Corpus 层：`sourceId = question-<qid>-answer-<answerId>`（`chunk.mjs` / `select.mjs` 一致规则）；`claim.evidenceSourceIds ⊆ chunk.sourceIds`（禁止跨 chunk 引用）；hierarchy 节点 `canonicalSourceIds` 是 controller-owned deterministic union（LLM 不得发明/修改）。
- **关键既有事实**：source identity 已经是 controller-owned（T11-R1 起 model 不输出 sourceId）——P1 的 Question/Source-group Preservation 直接继承这一 invariant，只需把 group 概念从「单 question 隐式分组」升级为「显式 question→answers 分组」。

**Q4 — resume / checkpoint 如何工作？**

- Capture 层：`ProgressStore`（`.progress.json`，offset+done，损坏→改名备份并抛错）+ `loadExistingAnswers`（seen-set 去重续传）。
- Corpus 层：chunk 幂等（输入 sha256 + chunkConfig 未变则复用；变化则整个 digest cache 全失效）；map 幂等（chunkHash 匹配才复用）；hierarchy 幂等（inputHash+childHashes+版本+runtime 全匹配才复用；FILE EXISTS != VALID CACHE；stale 向上传播）。
- Orchestration 层：`state.mjs` `orchestration-state.json` + `events.jsonl`；run identity = hash(topic, mode, percent, runtime)；resume 只从 validated checkpoint；stale/不兼容 artifact 从 resume 点起全部丢弃重跑。

**Q5 — corpus analysis 如何进入？**

- 人工链路：`make-handoff.mjs`（verify-output valid=true 门）→ `corpus-anthology/scripts/chunk.mjs`（manifest + chunks；digest / top-percent-analysis 两 mode）→ `map.mjs`（flat 或 --hierarchy；runtime 路由 `lmstudio-local-tool-less` / `deepseek-api-tool-less`，unsupported → `capability_isolation_unavailable` fail-closed）→ `verify.mjs`（coverage / final 引用 / handoff 三种验证）→ `reduce.mjs` → `render-final.mjs`。
- 编排链路：orchestrator `stageAnalyze()` 以子进程按上述顺序驱动，gate 结果经 `assertGateValid`（parse first → evaluate valid → fail outside try/catch，区分 VALID_FALSE / UNPARSEABLE / EXIT_FAILURE 三种失败身份）。

**Q6 — evidence lineage 如何维护？**

- `manifest.json`（输入身份）→ `chunk.chunkHash`（map 必须回传相同 hash 才通过 verify）→ `map.sourceIds` / `claim.evidenceSourceIds`（⊆ chunk.sourceIds）→ hierarchy `canonicalSourceIds`（deterministic union，逐层不变量 union(children)==parent，L1 union == manifest set）→ `coverage.json`（manifestHash + mapSetHash，reduce 启动时重校验，不信任旧 coverage）→ final digest（保留来源 ID、少数观点、反对意见；不生成来源中不存在的结论）。
- COVERAGE ≠ CLAIM EVIDENCE（hierarchy 合同显式区分）。

**Q7 — 哪些模块可直接复用（P1 零改动）？**

- `grabber.js` / `http.js` / `signer.js` / `config.js` / `official.js` / `search-answer-count.js`（multi-question capture 只是**多次调用** grabAll，每次单 question 合同不变）。
- `verifier.js` / `machine-paths.js`（per-question 验证合同不变）。
- `render.js` / `rich-renderer.js` / `markdown-security.js` / `asset-extractor.js`（per-question 渲染合同不变）。
- `corpus-anthology` 的 chunk/verify/reduce/render-final（多问题输入 = 多份 answers.json，**现有目录递归收集已天然支持多 question**：`collectJsonFiles` 递归收集所有 `answers.json`，sourceId 已含 qid 维度）。
- `lmstudio-tool-less.mjs` / `deepseek-tool-less.mjs` / `lmstudio-projection.mjs` / `hierarchy.mjs`（tool-less runtime 与 hierarchical synthesis 合同与 question 数量正交）。
- `intent.mjs` / `state.mjs`（模式判定与 checkpoint 机制正交）。

**Q8 — 哪些只需要 adapter（改接入方式不改本体）？**

- `orchestrator.mjs`：`stageSelect()` 从「选 1 个 question」改为「选 K 个 question」（选择策略由 §3 selector 取代词面单选）；`stageCapture()` 从 1 次 grab 循环为 K 次；`stageRender()` 的 research-result 投影增加 question-group 维度。stage 机 / gate 校验 / resume / fail-closed 语义不动。
- `select.mjs` + `top-percent-selector.mjs`：新增 selector 模式（四组件），现有 top-percent 逻辑作为 Popularity Anchor 的确定性基础保留（不删除，strangler 共存）。
- `map.mjs` runtime 路由：如需新 embedding runtime，走既有 `resolveMapRuntime` 模式（additive runtime id，unsupported → fail-closed）。

**Q9 — 哪些确实是 P1 新增能力（v0.3 不存在）？**

1. **Research Planner / 多路搜索规划**（A01 已批准方向：LLM query/aspect expansion，tool-less 语义 worker 执行）：topic → 多 query 集 + 方面框架。v0.3 只有单 keyword 直传 `searchQuestions`。
2. **候选融合（RRF）**：多 query 的 search 结果 + 多问题的 answers 候选合流。v0.3 无跨 query 融合。
3. **Dense Semantic Layer**：embedding + cosine 的 relevance / novelty / redundancy / clustering / aspect matching。v0.3 完全无 embedding 代码（evidence-gate-01 的 benchmark 脚本是 evidence，不是 production）。
4. **四组件 Selector**（§3）：Question/Source-group Preservation、Popularity Anchor、Dense Semantic Relevance/Novelty、Optional Lightweight Redundancy Control。
5. **Coverage State / Saturation**（跨问题研究级）：v0.3 的 coverage 是 corpus 完整性（map 覆盖 chunk），不是研究维度的 coverage state。
6. **跨问题 Claim/Aspect 层**：v0.3 hierarchy 的 claim/minorityViews/uncertainties 已存在，但 aspect 框架（研究问题分解）与跨 question 的 claim 归并是新层。

### 2.2 现有分层与 P1 生长点（strangler 视图）

```text
┌─ research-orchestration (thin controller)  ← P1 主要生长点 A/B/C
│    topic → [SEARCH] → [SELECT] → [CAPTURE] → [VERIFY] → [HANDOFF] → [ANALYZE] → [RENDER]
│                              ↑ 单问题词面选择 → P1 多问题 + 四组件 selector
├─ zhihu-answer-grabber (v0.3 Research Kernel) ← 零改动复用
│    grab/search/verify/handoff/render + security + credentials
├─ corpus-anthology (corpus pipeline)  ← adapter 级改动
│    select / chunk / map / verify / reduce / render-final
│    + tool-less runtimes + hierarchy + projection sanitization
└─ (P1 新增) Dense Semantic Layer / Research Planner / RRF / Coverage State ← 全新模块
```

---

## 3. Frozen P1 Selector Authority

来自 `09_RCE_DESIGN_AMENDMENT_01.md`（EVIDENCE_SUPPORTED_ARCHITECTURE_OUTCOME = OUTCOME A，PROCEED_WITH_SIMPLIFICATION）。此为**冻结决策**，本 Spec 只做架构落位，不做重新设计：

```text
SELECTOR_BASELINE (P1, frozen)
= Question/Source-group Preservation
+ Popularity Anchor
+ Dense Semantic Relevance / Novelty
+ Optional Lightweight Redundancy Control
```

各组件的架构落位：

| 组件 | 架构位置 | 确定性归属 | 说明 |
|---|---|---|---|
| Question/Source-group Preservation | Controller（Selector Contract 层） | deterministic | 每个入选 question 的回答**整组**进入 corpus（不逐 answer 跨组裁剪）；组身份 = questionId；group 内 provenance 不可拆散。继承「source identity is controller-owned」invariant。 |
| Popularity Anchor | Controller | deterministic | 以 voteupCount 为锚的高赞保留通道（top-percent 逻辑的推广），保证主流可见观点进入 corpus；防 dense 单一维度失衡。 |
| Dense Semantic Relevance / Novelty | Dense Semantic Layer | deterministic 数值计算（embedding 推理本身是模型调用，但**选择决策是确定性数值规则**） | relevance = 与研究 topic/aspect 的 cosine；novelty = 与已选集合的语义距离。 |
| Optional Lightweight Redundancy Control | Controller | deterministic | MMR 或等价轻量机制，**OPTIONAL**（02 的 MMR 已被 04 A06 降级为 OPTIONAL_REDUNDANCY_MECHANISM，09 维持）。可关闭，不作为硬约束。 |

**禁止项**（frozen）：

- 禁止 six hard selector quotas（六维度硬配额 lane）；
- 禁止 ship B2 as-is（B2 是 evidence baseline 不是产品架构）；
- 禁止把 B3（medical must-see 4/13、K24 XQ 优势、relative ops 8445）当作否定 dense embedding 的依据。

## 4. Six Information Dimensions（relocated, not deleted）

按 09 的 lane relocation 表，六维度从 selector hard quota 重新定位为**检索信号 / 软特征 / 诊断**：

| Dimension | 新位置 |
|---|---|
| Mainstream | retrieval / soft popularity feature |
| Expert | retrieval signal + topic-conditioned soft feature |
| Evidence-rich | retrieval signal + soft feature |
| Fresh | retrieval / time policy + diagnostic |
| Long-tail | soft marginal-value / novelty feature |
| Contradictory | opposing-query generation + claim-stage diagnostic |

架构含义：六维度**不出现**在 Selector Contract 的硬性接口里；它们体现在 Research Planner 的 query 生成（opposing-query、expert-oriented query）、检索策略与 claim-stage 诊断中。Selector 只见四个组件（§3）。

---

## 5. Architecture Boundaries（A–M）

### A. Research Request / Planner

- 输入：natural-language topic（`intent.mjs` `normalizeTopic` 复用）。
- Research Planner 是**语义工作**（A01：LLM query/aspect expansion），必须走 tool-less semantic worker（与 map 相同的 capability isolation 合同）；产出的 query 集与 aspect 框架是**结构化建议**，经 controller 确定性校验（非空、去重、长度上限）后进入检索编排。
- Planner 不拥有：question 选择决定权、任何 IO、任何 identity。
- **边界**：Planner 输出 = {queries[], aspects[]}（schema 待 T6 式合同化，OPEN_DECISION D-3）。

### B. Retrieval Orchestration

- 多 query → 每 query 调用现有 `searchQuestions`（官方 API）+ 可选的 opposing-query / expert-oriented query 变体（六维度 relocation 的落点）。
- 跨 query 候选融合用 **RRF**（A02 已批准）；融合产物 = question-level 候选集（questionId + title + answerCount + 检索信号）。
- 每个 candidate question 的 capture 走现有 `grabAll`（整组捕获），humanDelay / retries / MAX_PAGES 合同逐 question 不变。
- **边界**：Retrieval Orchestration 是 controller-owned 确定性编排；不调用 LLM。

### C. Provider / Capability Seam

- 沿用 v0.3 已验证的 runtime 架构（`docs/architecture/runtime-strategy.md`）：`lmstudio-local-tool-less` / `deepseek-api-tool-less` 为 Approved qualified runtimes；controller 唯一 IO；`MODEL_VISIBLE_TOOL_COUNT = 0`；fail-closed，无静默 fallback。
- Dense Semantic Layer 需要的 embedding runtime 是**新的 runtime 候选**，必须走与 T5 系列相同的 qualification 流程（capability isolation 证明 + structured output 合同 + evidence），**不得 self-declared**；qualification 未通过前该能力 UNRESOLVED / 不可用 → 对应 selector 组件降级语义见 M。
- **边界**：provider 优先级、production embedding model 选择 = OPEN_DECISION（D-1/D-2），本 Spec 不拍板。

### D. Canonical Research Input

- 研究级输入身份 = {topic, runIdentity}（复用 `runIdentityHash` 模式，扩为含 planner query 集 hash）。
- Question 级 canonical input = 现有 per-question 产物合同（`answers.json` + `questionId` 三方一致 + verify-output PASS 后的 `handoff.json`）。**多 question 研究的每个 question 都必须独立通过 verify 门**，才进入 corpus 阶段——这条不变量直接复用，无新设计。

### E. Candidate / Source-group Model

- 候选模型两层：question-level 候选（search 产物 + enrichment）→ source-group（每 question 的全部 answers，`grabAll` 产物）。
- Source-group 的组身份 = questionId；组内成员 = `question-<qid>-answer-<aid>` sourceId（现有格式，零改动）。
- **Question/Source-group Preservation 的最小实现形态**：selector 在 question 粒度做「整组保留/整组不保留」决定，组内不再跨组裁剪单条 answer；组内如需 top-percent 型裁剪（规模控制），沿用组内确定性规则并显式记录为 sampled（不冒充全量）。

### F. Selector Contract

- 输入：question-level 候选（含检索信号、answerCount）+ source-group 元数据（voteupCount 分布等）+ dense 特征（如可用）。
- 输出：入选 question 集 + 每组的组内选择披露（full / sampled + 规则）+ 决策审计记录（deterministic，可重放）。
- 组件顺序（架构上的管道序，非优先级声明）：Preservation 判定 → Popularity Anchor → Dense Relevance/Novelty → Optional Redundancy Control。组件参数（MMR lambda 等）= OPEN_DECISION（D-4/D-5）。
- 现有 `selectCandidate`（auto/ambiguous/none + 至多一次 clarification）的**人机合同保留**：material ambiguity 时停下要 clarification，不静默选择。

### G. Dense Semantic Layer

- 职责：embedding 推理 + cosine 数值计算（relevance / novelty / redundancy / clustering / aspect matching 的几何部分）。
- 形态：独立模块（新增），接口 = text-in → vector-out（thin，provider-neutral），调用方式对齐现有 tool-less runtime 的 controller 模式。
- 既有证据：evidence-gate-01 benchmark 已验证 dense 方向（含 Dense Top-K 单独使用的弱点 caveat）；**benchmark 脚本不等于 production 实现**，production 化需 qualification（C）。
- 不可用时：见 M 的 fail-closed/降级语义。

### H. Claim / Aspect Layer

- 沿用 corpus-anthology 现有 map 产物 schema（claims / minorityViews / uncertainties + evidenceSourceIds）。
- Aspect 框架（来自 Planner）作为 claim 归并的**组织维度**注入 reduce/hierarchy 阶段：claim 聚类到 aspect，aspect 覆盖情况进入 Coverage State。
- Hierarchical synthesis 合同（07 Part B）不变：Content → Question/Source-group → Claim/Aspect → Cross-source；禁止 flat reduce；claim cluster 保留 group provenance；no naive equal weight。

### I. Coverage State

- 三分语言（01 authority）：Retrieval Coverage（检索覆盖了多少候选问题/查询路径）、Source Completeness（入选组的 capture/verify 完整性）、Analysis Coverage（map/claim 层对 corpus 的覆盖）。
- v0.3 已有 Source Completeness（verify-output + coverage.json）与 Analysis Coverage（map 覆盖 chunk）；P1 新增 Retrieval Coverage 的状态记录（query 集 → 命中 → 融合 → 入选的漏斗计数，纯确定性审计数据）。
- **边界**：Coverage State 是诊断/审计，不自动触发新的检索轮次（adaptive depth 属 V1 stopping heuristic 范畴，见 02，其产品化 = OPEN_DECISION D-6）。

### J. Saturation

- 02 的 V1 Stopping Heuristic（simple saturation heuristics，A08）在 P1 的架构位置：Research Planner 的 query 预算与 Retrieval Orchestration 的停止条件。
- 最小正确实现：静态预算（query 数上限、question 数上限）+ 启发式饱和信号（新 query 的候选增量低于阈值 → 停）。参数 = 实验参数，`DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION`，不进产品合同（OPEN_DECISION D-6）。

### K. Security Boundary

全量继承，零弱化：

- UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION（07 Part A）：外部语料一律数据；SUSPICIOUS_DIRECTIVE_CONTENT 只做诊断不做安全边界。
- Controller / Semantic Worker 边界：controller 拥有 identity / provenance / coverage / verification / state transition / tool authority / IO；semantic worker（Planner、map、embedding）TOOL-LESS OR CAPABILITY-ISOLATED，否则 STOP: `CAPABILITY_ISOLATION_UNAVAILABLE`。
- No Credential Contamination：凭据只在 `config.js`/`http.js` 边界内；orchestration state 永不含凭据；Dense Semantic Layer 不得接触凭据。
- 投影消毒：`sanitizeProjectionText` 合同（URL/路径/协议/source-tag 中和）适用于**一切**进入 semantic worker 的不可信文本——包括 Planner 的 topic 侧输入（topic 本身可信度高于语料，但 aspect 框架生成后回注 corpus 的路径必须走同一消毒）。
- Evidence/Identity Validation Remains Deterministic：LLM 输出永远不作为 validity 依据。

### L. Failure Semantics

- 既有 fail-closed 语义全量保留：`captured != verified`、`capability_isolation_unavailable`（无静默 runtime fallback）、`QUESTION_METADATA_IDENTITY_CONFLICT`（身份冲突不降级）、corrupt 文件不静默当空、`hierarchy_input_too_large` 等。
- P1 新增失败身份（架构级定义，具体 error code 实现时合同化）：
  - `planner_unavailable`：Planner semantic worker 不可用 → 停（不静默降级为单 keyword——降级会静默改变研究范围）。
  - `dense_layer_unavailable`：见 M。
  - `no_question_selected`：selector 空结果 → 报告并停（复用 no_valid_candidate 语义）。
- VALID FALSE ≠ UNPARSEABLE ≠ EXIT FAILURE 的三身份区分（orchestrator `assertGateValid` 模式）适用于一切新 gate。

### M. v0.3 Compatibility（STRANGLER_FIRST）

- v0.3 单问题研究链路（`research.mjs` 现行为）**不迁移不破坏**：P1 是 additive 新路径（新 mode / 新入口），旧路径与产物合同零变更。
- per-question 产物（answers.json/answers.md/handoff.json）schema 零变更；corpus 层多 question 输入已被现有递归收集支持。
- **Dense Layer 不可用时的语义**（关键设计点）：四组件中 Dense Semantic Relevance/Novelty 不可用时，**不得静默把 selector 降级为 popularity-only 还声称同一产品语义**。两个合法选项：
  1. FAIL-CLOSED：研究请求失败，报 `dense_layer_unavailable`；
  2. 显式降级模式：selector 以「popularity-anchor-only（明示 degraded）」运行，输出产物显式标注 selector 组件缺失（如同 top-percent 的 disclosure 块）。
  选择哪个 = 产品决策，**OPEN_DECISION（D-7）**，本 Spec 不拍板；但「静默降级 + 不披露」被禁止。

---

## 6. Minimum-Correct Architecture（拒绝过度设计）

本 Spec 只包含 P1 必需构件。以下明确**不进入** P1 架构（来自 04 D01-D17 deferred + 05 rejected + 09 caveats）：

- Matrix Factorization / trained LTR / xQuAD / DPP / submodular / active learning（D01-D05）
- PCA/SVD 降维、Chao 估计、quant 采样族、InfoGain-RAG、Search-R1、Stop-RAG、TDA、advanced graph、JS divergence、change-point、permutation test（D07-D17）
- Six hard selector lanes（09 明确废除）
- B2 as-is shipping（09 明确禁止）
- 任何「全局质量分数」聚合（新聚合维度 = OPEN_DECISION D-8）
- Temporal Intelligence Engine（03 是 P1 边界外的能力，架构上仅预留 seam：sourceId 已含时间可溯的 canonical 数据，无新增耦合）

---

## 7. Evidence Caveats（必须随 Spec 存活）

以下 7 条来自 09，**任何后续实现/宣传不得弱化**：

1. **Two real-domain cases**：证据只覆盖两个真实领域 case，不是跨领域普遍结论。
2. **Partial blinding contamination**：evaluation 存在 partial blinding 污染，数字解读需保守。
3. **relative_compute_ops 不是生产成本**：B2 380 vs B3 8445 是相对操作数，不是生产成本度量。
4. **B3 medical must-see / K24 XQ advantages**：B3 在 medical must-see（4/13）与 K24 XQ 上有优势，dense 路线不能宣称全面胜出。
5. **Dense Top-K weakness 不否定 dense embeddings**：Top-K 单独使用的弱点 ≠ dense 特征本身无效。
6. **Six dimensions relocated, not deleted**：六维度重新定位，不是被删除或证伪。
7. **P2/P3 remain design-only**：P2（Temporal）/P3 超范围，仅设计存在，无实现承诺。

---

## 8. P2 / P3 Future Seams（OUT_OF_SCOPE 声明）

- P2 Temporal：与 P1 的唯一架构接缝 = canonical source identity 稳定（sourceId + capture 时间戳已在 canonical 数据中）。P1 不为 P2 预建任何机制。
- P3（更远期）：无接缝声明。
- 本 Spec 中任何为 P2/P3 预建的机制 = scope violation。

---

## 9. OPEN_DECISIONS（未经 authority 解决，禁止自行拍板）

| ID | 决策点 | 状态 | 备注 |
|---|---|---|---|
| D-1 | production embedding model / provider | OPEN | 证据只到方向（dense 有效），未到具体模型；需 qualification 流程 |
| D-2 | runtime/provider priority（local vs API 优先序） | OPEN | v0.3 runtime-strategy 只确立了 provider-neutral 原则 |
| D-3 | Planner 输出 schema 合同（queries/aspects 的精确字段） | OPEN | 需 T6 式合同审查 |
| D-4 | selector 组件参数（MMR lambda、relevance/novelty 权重） | OPEN | 实验参数，DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION |
| D-5 | question floor（最少入选问题数）等 selector 数值边界 | OPEN | 同上 |
| D-6 | adaptive depth / saturation 参数产品化 | OPEN | V1 heuristic 是工程默认不是产品合同 |
| D-7 | Dense Layer 不可用时 fail-closed vs 显式降级模式 | OPEN | §5-M 两个合法选项，产品决策 |
| D-8 | 是否引入全局质量分数聚合维度 | OPEN | 默认不引入（minimum-correct） |
| D-9 | OAuth / 凭据行为变更 | OPEN | P1 不动凭据体系（K 已冻结），任何变更需新 authority |

---

## 10. Overengineering Audit（本 Spec 自审）

| 检查项 | 结论 |
|---|---|
| 是否引入 v0.3 已有机制的第二套实现？ | 否——检索/捕获/验证/分析/合成全部复用现有 primitives，仅 additive 新增 Planner/RRF/Dense/Selector 四模块 |
| 是否为未来能力预建机制？ | 否——P2/P3 零预建（§8）；六维度只在现有层内 relocation |
| 是否把实验参数写成产品合同？ | 否——D-4/D-5/D-6 全部 OPEN_DECISION + DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION |
| 是否超出 frozen selector authority？ | 否——四组件逐字对齐 09；六维度 relocation 逐字对齐 |
| 是否重新引入 six hard lanes / B2 as-is？ | 否（§3 禁止项 + §6 排除清单） |
| 是否破坏 v0.3 行为？ | 否——§5-M strangler 声明：旧路径零变更 |
| 是否静默降级？ | 否——§5-L/M 全部 fail-closed 或显式披露降级 |

---

## 11. Final State

```text
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
P1_ARCHITECTURE_SPEC_DRAFT_01 = REVIEW_PENDING
```

本 Draft 通过独立审查（ChatGPT）并被正式提升为 Approved Spec 之前，不授权任何实现工作。实现 ticket 分解、benchmark、Gold 扩充均不在本文件授权范围内。
