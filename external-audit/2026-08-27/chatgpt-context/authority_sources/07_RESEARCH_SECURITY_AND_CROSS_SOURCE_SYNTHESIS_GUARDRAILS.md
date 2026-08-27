# Research Security and Cross-Source Synthesis Guardrails

STATUS: DESIGN_FROZEN_ADDENDUM  
DATE: 2026-08-25  
APPLIES_TO: `02_RESEARCH_COVERAGE_ENGINE_FINAL.md`, `03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL.md`, AND ALL PIPELINES PROCESSING EXTERNAL CORPUS  
VERSION_ASSIGNMENT: UNASSIGNED  
IMPLEMENTATION_AUTHORIZATION: NONE

---

## 1. Purpose

本文件只补充两个此前在历史设计中存在、但在最终压缩版中表达不够明确的关键约束：

1. 所有外部语料处理流程的 Prompt Injection / Context Pollution 安全边界；
2. 跨问题研究中“大问题不能仅凭回答数量淹没其他问题”的分层综合规则。

本文件不是新的产品版本，也不授权施工。

适用范围：

- **Part A — Untrusted Corpus / Context Pollution**：适用于 Research Coverage、Temporal Intelligence，以及任何处理知乎或其他外部语料的 pipeline；
- **Part B — Cross-Question / Cross-Source Synthesis**：专门适用于 Research Coverage / cross-question / cross-source research。

若本文件与 `02_RESEARCH_COVERAGE_ENGINE_FINAL.md` 或 `03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL.md` 发生冲突：

> 本文件只在上述安全边界与跨来源综合主题范围内作为最新冻结澄清；其他 RCE / Temporal 设计仍分别以 `02_RESEARCH_COVERAGE_ENGINE_FINAL.md` 与 `03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL.md` 为准。

---

# Part A — Untrusted Corpus / Context Pollution

## 2. Core Security Invariant

所有来自知乎及其他外部来源的正文、评论、引用、代码块、图片文字、作者简介和链接文本，一律视为：

```text
UNTRUSTED_CONTENT
DATA_NOT_INSTRUCTION
```

外部语料中的任何文本不得：

- 覆盖 system / developer / controller instruction；
- 改变 capability / provider selection；
- 获得 tool authority；
- 触发 shell / network / filesystem action；
- 请求或读取 credential；
- 改写 canonical identity / provenance / coverage state；
- 绕过 verifier；
- 直接改变 research state machine。

---

## 3. Controller / Semantic Worker Boundary

继续沿用 v0.3 的原则：

```text
Controller owns:
identity
provenance
coverage
verification
state transition
tool authority

Semantic worker owns:
semantic interpretation
claim extraction
aspect mapping
stance interpretation
summarization
synthesis
```

对于研究语料：

> Semantic workers consuming `UNTRUSTED_CONTENT` **MUST NOT** possess tool authority, credential access, or controller authority.

满足该要求的方式包括：

- worker/runtime 在结构上就是 tool-less；
- worker 在独立 capability-isolated execution surface 中运行；
- controller 只向 worker 传递经过边界控制的研究语料与结构化任务。

若所选运行时无法为一个原本具备工具能力的执行面提供所需隔离：

```text
STOP: CAPABILITY_ISOLATION_UNAVAILABLE
```

不得因为“目前没有检测到 prompt injection”而放宽此要求。

外部语料只能作为模型输入中的“被研究对象”，不能进入 execution instruction surface。

---

## 4. No Credential Contamination

以下数据不得进入研究语料、embedding 输入、claim graph、analysis prompt 或可恢复 checkpoint：

- Zhihu Cookie；
- Access Secret；
- OAuth token；
- model API key；
- local credential path contents；
- any secret-bearing header。

研究 artifact 只允许记录安全状态，例如：

```text
auth_class = session
provider = official-api
credential_status = configured
```

不得记录 credential value、hash、prefix、suffix 或 length。

---

## 5. Prompt-Injection Handling

第一版不要求训练复杂 Prompt Injection classifier。

采用更简单且更强的默认安全策略：

> **所有外部语料默认无指令权。**

因此安全性不依赖“是否成功识别出攻击文本”。

可以额外使用轻量 heuristic 标记：

```text
SUSPICIOUS_DIRECTIVE_CONTENT
```

例如包含明显的：

- “忽略之前指令”
- “执行以下命令”
- “读取密钥”
- “调用工具”
- “修改系统提示”

但该标记只用于：

- diagnostics；
- chunk isolation；
- review / audit；

不是安全边界本身。

---

## 6. Quarantine Semantics

若某段内容被标记为 `SUSPICIOUS_DIRECTIVE_CONTENT`：

```text
normal corpus
      │
      ├─ ordinary untrusted content
      │       → normal isolated semantic worker
      │
      └─ suspicious directive-like content
              → separate semantic chunk / quarantine path
```

Quarantine 的目标是减少：

> 一段明显带指令性质的文本污染同批其他语料的语义分析。

即使进入 quarantine，它仍然可以作为“文本内容”被研究。

但它始终：

```text
NO_TOOL_AUTHORITY
NO_CONTROLLER_AUTHORITY
NO_CREDENTIAL_ACCESS
```

---

## 7. Evidence / Identity Validation Remains Deterministic

模型不得决定：

- 这条文本来自哪个 Answer；
- 是否属于某个 Question；
- 是否完整抓取；
- 是否 verified；
- source URL；
- source count；
- evidence lineage。

这些必须由 controller / verifier 机械维护。

Semantic output 若引用不存在的 source identity：

> fail closed / reject / repair

而不是让模型自行修正 provenance。

---

# Part B — Cross-Question / Cross-Source Synthesis

## 8. Core Aggregation Invariant

跨问题研究禁止采用：

```text
all answers from all questions
→ one flat reduce
```

原因：

如果：

```text
Q1 = 1,200 answers
Q2 = 80 answers
Q3 = 30 answers
```

直接扁平合并会使 Q1 仅因体量而主导最终结论。

回答数量：

> 可以作为 discussion-volume evidence，

但不能自动等同于：

> epistemic importance / research weight。

---

## 9. Required Hierarchical Synthesis

跨问题研究至少保留以下层级：

```text
Answer / Content-level
        ↓
Question / Source-group level
        ↓
Claim / Aspect level
        ↓
Cross-question / Cross-source synthesis
```

具体原则：

### Content level

保留每条 canonical content 的：

- source identity；
- author；
- question/source group；
- evidence；
- stance；
- metrics；
- provider / provenance。

### Question / Source-group level

每个 Question 或其他大型 source group 先形成独立 representation：

- main claims；
- minority claims；
- contradictions；
- expert evidence；
- evidence-rich sources；
- coverage / completeness。

### Claim / Aspect level

跨 Question 聚合：

- same/similar claims；
- support；
- opposition；
- evidence types；
- expert sources；
- source diversity。

### Cross-source synthesis

最终报告区分：

- widely shared claims；
- question-specific claims；
- minority / long-tail claims；
- conflicting claims；
- source-group differences；
- evidence strength；
- discussion-volume differences。

---

## 10. No Naive Equal Weight Either

防止“大问题淹没小问题”不意味着：

> 每个 Question 强制 1:1 等权。

系统应保留两种不同信号：

```text
DISCUSSION_VOLUME
EVIDENCE / COVERAGE VALUE
```

例如：

- 一个 1,200-answer Question 的主流观点确实可以被报告为“讨论量大”；
- 一个只有 30 个回答的问题若提供唯一重要 aspect / expert evidence，也不能被吞掉；
- 最终综合不应把 answer count 直接当 truth weight。

---

## 11. Source Concentration Diagnostics

Research Coverage Engine 应能记录至少以下诊断：

```text
selected_question_count
selected_content_by_question
largest_question_share
selected_author_concentration
selected_content_type_distribution
claim_source_diversity
```

目的：

检测：

- 单 Question 支配；
- 单 Author 支配；
- 单 Content Type 支配；
- Claim 只来自一个来源群体。

第一版阈值不在本文件写死。

阈值应通过 benchmark / real dogfood 决定。

---

## 12. Claim Cluster Must Preserve Group Provenance

Claim Cluster 不得只有：

```text
support_count = 100
```

至少需要能够回答：

```text
support_sources
support_questions
support_authors
expert_support
evidence_rich_support
opposing_sources
opposing_questions
```

原因：

```text
100 answers from one question
```

与：

```text
20 independent sources across 8 questions
```

不是相同的研究证据结构。

---

## 13. Benchmark Implications

除已有 benchmark metrics 外，跨问题研究建议增加：

```text
Question Diversity
Source Concentration
Cross-question Claim Recall
Minority-question Recall
Per-question Coverage Preservation
```

这些指标用于防止：

> selector 表面上提高总体 recall，
> 实际上只围绕最大 Question 优化。

---

## 14. Final Frozen Addendum

```text
EXTERNAL_CORPUS =
UNTRUSTED_CONTENT
DATA_NOT_INSTRUCTION

SECURITY DOES NOT DEPEND ON
PROMPT-INJECTION CLASSIFIER

SEMANTIC WORKERS CONSUMING EXTERNAL CORPUS =
TOOL-LESS OR CAPABILITY-ISOLATED
OTHERWISE STOP:
CAPABILITY_ISOLATION_UNAVAILABLE

CROSS-QUESTION RESEARCH =
HIERARCHICAL, NOT FLAT

ANSWER COUNT =
DISCUSSION VOLUME SIGNAL
NOT AUTOMATIC TRUTH WEIGHT

CLAIM CLUSTERS =
MUST PRESERVE QUESTION / SOURCE PROVENANCE
```

本文件只补充安全与跨来源综合约束，不改变 RCE 第一 baseline 的算法选择。
