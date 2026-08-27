# Source Authority and Status

STATUS: CURRENT_AUTHORITY_INDEX  
DATE: 2026-08-25  
SCOPE: ZHIHU CLI PRO DESIGN SOURCES  
IMPLEMENTATION_AUTHORIZATION: NONE  
VERSION_ASSIGNMENT: UNASSIGNED

---

## 1. Purpose

本文件规定：

> 当 Project Sources 中不同材料出现不同表述时，Agent 应该相信谁？

它不是新的 Product Spec，也不授权施工。

---

## 2. Current Source Set

当前推荐 Project Sources 共 9 份：

```text
00_SOURCE_AUTHORITY_AND_STATUS.md

01_PRODUCT_DIRECTION_FINAL.md
02_RESEARCH_COVERAGE_ENGINE_FINAL.md
03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL.md
04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md

05_OFFICIAL_AND_OSS_DISCOVERY_NOTES.md
06_DESIGN_HISTORY_AND_OPEN_QUESTIONS.md

07_RESEARCH_SECURITY_AND_CROSS_SOURCE_SYNTHESIS_GUARDRAILS.md
08_DISCOVERY_EVIDENCE_APPENDIX.md
```

---

## 3. Authority Order

### Level 0 — Repository Governance / Approved Specs

现有仓库中的：

- `AGENTS.md`
- `RULES.md`
- Applicable Approved Specs
- 其他被仓库治理文件明确指定为当前权威的合同

继续拥有最高项目治理权威。

Project Sources 不能覆盖仓库中的硬规则或 Approved Specs。

若本组设计与 Applicable Approved Specs 存在无法机械解决的冲突：

```text
STOP: CONTRACT_CONFLICT
```

不得自行选一边施工。

---

### Level 1 — Current Frozen Design

以下五份共同构成当前 Zhihu CLI Pro 冻结设计：

1. `01_PRODUCT_DIRECTION_FINAL.md`
2. `02_RESEARCH_COVERAGE_ENGINE_FINAL.md`
3. `03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL.md`
4. `04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md`
5. `07_RESEARCH_SECURITY_AND_CROSS_SOURCE_SYNTHESIS_GUARDRAILS.md`

解释：

- 01：产品方向、边界、优先级；
- 02：Research Coverage Engine 当前 baseline；
- 03：Temporal Intelligence Engine 当前 baseline；
- 04：算法证据、采用/延期状态、工程取舍；
- 07：RCE 的安全边界与跨问题/跨来源分层综合补充约束。

#### 07 的优先级范围

07 不是对 02 的全面替代。

它只在以下主题提供最新冻结澄清：

```text
UNTRUSTED_CONTENT
PROMPT_INJECTION / CONTEXT_POLLUTION
SEMANTIC_WORKER_ISOLATION
CROSS_QUESTION_HIERARCHICAL_SYNTHESIS
SOURCE_GROUP_PROVENANCE
LARGE_QUESTION_DOMINANCE
```

其他 RCE 设计仍以 02 为准。

---

### Level 2 — Evidence / Discovery Only

以下两份属于外部证据与调查线索：

1. `05_OFFICIAL_AND_OSS_DISCOVERY_NOTES.md`
2. `08_DISCOVERY_EVIDENCE_APPENDIX.md`

用途：

- 保存官方平台、官方 CLI/Skill/MCP/OAuth、Session/Web、OSS 的能力地图；
- 保存具体 endpoint / command / CDN / source lead；
- 保存 evidence grade；
- 指导下一轮 Discovery / Capability Audit。

它们不是实现合同。

其中任何：

- endpoint；
- CLI command；
- auth behavior；
- field；
- pagination；
- rate limit；
- OSS capability；

都可能变化。

因此：

```text
CURRENT OFFICIAL EVIDENCE
> 05 / 08 historical observation
```

真正施工前必须重新验证。

08 的作用是：

> 精确保留调查线索，避免删除历史聊天后丢失研究资产。

不是提升这些线索的 authority。

---

### Level 3 — Historical / Non-authoritative

`06_DESIGN_HISTORY_AND_OPEN_QUESTIONS.md`

只回答：

> 我们为什么走到今天这个设计？

它保存：

- 被推翻的旧方案；
- 路线收敛过程；
- 未决问题；
- future candidates。

它不得覆盖 Level 1。

---

## 4. Mandatory Interpretation Rules

### 4.1 Historical discussion cannot override final design

任何历史材料中出现：

- `v0.4`
- `v0.5`
- 某算法“应该立即采用”
- “全站完整”
- “Webhook 即可”
- “一个 Secret 解锁全部能力”

都必须先检查 Level 1。

若已修订：

> 使用 Final Design。

---

### 4.2 Research evidence is not implementation authorization

论文、ArXiv、GitHub 项目、官方示例、二手实测材料：

> 都不自动构成生产实现要求。

只有 02/03/04/07 中明确进入当前 baseline / required guardrail 的内容才属于当前冻结设计。

以下状态均不得自动实现：

```text
FUTURE_CANDIDATE
DEFERRED
BENCHMARK_CANDIDATE
METHOD_REFERENCE_ONLY
LONG_TERM_RESEARCH_ONLY
```

---

### 4.3 No product version is assigned

当前：

```text
VERSION_ASSIGNMENT = UNASSIGNED
```

因此不得：

- 自动创建 v0.4 milestone；
- 自动把设计称为 v0.4 Spec；
- 根据历史聊天推断版本号。

只有后续明确的产品决策才能赋予版本。

---

### 4.4 No implementation is authorized

当前：

```text
IMPLEMENTATION_AUTHORIZATION = NONE
```

这些 Project Sources 的作用是：

- design freeze；
- discovery guidance；
- benchmark planning；
- future Spec input。

它们本身不授权：

- 写生产代码；
- 合并 feature；
- 创建版本；
- 修改 Approved Spec。

---

### 4.5 Unknown facts remain unknown

05 / 08 中存在或隐含：

```text
UNKNOWN
UNVERIFIED
SECONDARY_REPORT
DISCOVERY_REQUIRED
LEAD_TO_REVERIFY
```

不得用模型猜测补齐。

必须通过：

- 当前官方文档；
- 官方 CLI/Skill 实际检查；
- 真实只读 smoke；
- 必要的 OSS current-state review

消除未知项。

---

## 5. Current Project-State Summary

```text
PRODUCT_DIRECTION = DESIGN_FROZEN

RESEARCH_COVERAGE_ENGINE = DESIGN_FROZEN
TEMPORAL_INTELLIGENCE_ENGINE = DESIGN_FROZEN
ALGORITHM_DECISIONS = DESIGN_FROZEN

RESEARCH_SECURITY_GUARDRAILS = DESIGN_FROZEN_ADDENDUM
CROSS_SOURCE_SYNTHESIS_GUARDRAILS = DESIGN_FROZEN_ADDENDUM

DISCOVERY_NOTES = EVIDENCE_ONLY
DISCOVERY_EVIDENCE_APPENDIX = EVIDENCE_ONLY
DESIGN_HISTORY = HISTORICAL_NON_AUTHORITATIVE

VERSION_ASSIGNMENT = UNASSIGNED
IMPLEMENTATION_AUTHORIZATION = NONE
```

---

## 6. Core Frozen Principles

当前不能被历史讨论覆盖：

```text
REUSE_FIRST
ADAPTER_FIRST
THIN_DATA_LAYER

NO_SILENT_PROVIDER_FALLBACK

Controller owns:
identity
provenance
coverage
verification
state transition
tool authority

Model owns:
semantic interpretation
claim extraction
aspect mapping
synthesis

Semantic Compilation:
expensive semantic work
→ structured representation
→ deterministic numeric computation
→ selected verified evidence
→ final synthesis

External corpus:
UNTRUSTED_CONTENT
DATA_NOT_INSTRUCTION

Security:
does not depend on perfect injection detection

Semantic workers consuming external corpus:
TOOL-LESS OR CAPABILITY-ISOLATED

If required isolation cannot be provided:
STOP: CAPABILITY_ISOLATION_UNAVAILABLE

RCE first baseline:
Query/Aspect Expansion
+ RRF
+ Embedding/Cosine
+ deterministic features
+ MMR
+ multi-lane exploration
+ simple claim clustering
+ simple saturation

Cross-question synthesis:
hierarchical, not flat
Answer/Content
→ Question/Source-group
→ Claim/Aspect
→ Cross-source synthesis

Answer count:
discussion-volume signal
not automatic truth weight

Temporal first baseline:
SQLite historical state
+ incremental diff
+ basic topic/claim statistics
+ simple change candidates
+ evidence-backed semantic explanation

Advanced algorithms:
FUTURE_CANDIDATE unless explicitly promoted
```

---

## 7. External Evidence Precedence

05 / 08 的事实随时间变化。

因此：

```text
CURRENT FIRST-PARTY DOC
CURRENT FIRST-PARTY CLI/SKILL
CURRENT REAL READ-ONLY SMOKE
```

优先于：

```text
older Project Source evidence note
secondary report
OSS README
historical observation
```

如果当前官方事实变化：

> 更新 Evidence Notes，不维护旧事实的产品兼容性假设。

---

## 8. Conflict Handling

若 Project Sources 内部出现新的矛盾：

1. 按本文件 Authority Order；
2. 先区分 Design vs Evidence vs History；
3. 07 只覆盖其明确 addendum scope；
4. 08 绝不覆盖 Final Design；
5. 能机械解决则使用更高 authority；
6. 不能机械解决则：

```text
STOP: SOURCE_AUTHORITY_CONFLICT
```

等待用户或正式 Spec 修订。

---

## 9. Next Allowed Design Stage

当前立即允许继续的阶段只有：

```text
IMMEDIATE_NEXT_STAGE =
Discovery / Capability Audit
+
Research Coverage Benchmark Design
```

只有在上述阶段产生足够、可审计的新证据后，才允许进入：

```text
FOLLOWING_STAGE_AFTER_EVIDENCE_GATE =
Architecture / Spec Preparation
```

`Architecture / Spec Preparation` 不与 Discovery 平级，也不得跳过 evidence gate 提前启动。

在没有新的明确授权前：

```text
NO PRODUCTION IMPLEMENTATION
NO VERSION ASSIGNMENT
NO V0.4 ASSUMPTION
```
