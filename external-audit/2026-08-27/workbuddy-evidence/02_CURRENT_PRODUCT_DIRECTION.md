# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 02 CURRENT PRODUCT DIRECTION

> 来源：Level 1 文档读取记录浓缩（00/01/02/04/07，2026-08-26 读取）+ 仓库 Level 0（AGENTS/RULES/docs）。
> Level 1 原件当前本机不可用（见 00 §5 与 `evidence/LEVEL1_AUTHORITY_DOCS_STATUS.md`）；本文为浓缩，非 exact copy。

---

## 1. 产品方向一句话

构建一个**知乎研究覆盖引擎（Research Coverage Engine, RCE）**：
给定一个研究问题与预算，从知乎多问题/多回答中**选择**一个有覆盖性的 source 子集
（覆盖权威/反方/证据/长尾/新鲜/专家），而不是简单返回人气最高的回答列表。

RCE 被明确定义为 **SUBSET SELECTION UNDER CONSTRAINTS**（子集选择），**不是 ranking**。

---

## 2. 关键方向性决策（Level 1 冻结）

| 决策 | 内容 |
|---|---|
| RCE 本质 | Subset selection under constraints（预算 K / token / 覆盖要求） |
| V1 pipeline 七机制 | Expansion / RRF / Embedding / Deterministic Features / MMR / Multi-lane / Simple Clustering + Simple Saturation |
| Baselines（Track B） | B0 Popularity Top-K · B1 Semantic Top-K · B2 MMR + multi-lane · TARGET = V1 |
| 复杂算法状态 | xQuAD / DPP = BENCHMARK_CANDIDATE；Submodular = HIGH-PRIORITY FUTURE BENCHMARK；MF / LTR / Active Learning / Search-R1 / Stop-RAG / TDA = FUTURE / DEFERRED |
| Expertise | Topic-conditioned（禁止 Global Authority 名望替代） |
| Evidence | Presence（机械）与 Quality（语义）分离 |
| Freshness | 保护"刚发布未积累互动"的新内容；弱 popularity 信号不惩罚新内容 |
| Long-tail | low-distribution + unique contribution（≠ 低赞） |
| Contradiction | claim_id / stance / opposing_source_ids 结构化 |
| Cross-question | Hierarchical（非 flat）；不搞 naive equal weight；Claim Cluster 保留 group provenance |
| Coverage 语言 | 三分：Retrieval Coverage / Source Completeness / Analysis Coverage；禁"全站完整研究" |

---

## 3. 产品成熟度（组装时点）

```text
工具层（已有，production）：
  zhihu-answer-grabber — 官方 OpenAPI + Session/Web 抓取、rich render、verified handoff
  research-orchestration — state/selection/intent/orchestrator/runner MVP（deterministic lexical selection）

RCE 层（目标，未实现）：
  Research Coverage Engine — NOT_IMPLEMENTED
  唯一接近的实现 = benchmark harness 中的 B0/B1/B2 selectors（pilot 用，非生产）

Spec 层：
  SPEC_PREPARATION_GATE = NOT_READY（Benchmark 证明价值前不写 Spec）
```

---

## 4. 为什么 Benchmark 先于实现（用户既定节奏）

1. RCE 的"正确"定义不显然——must-see ≠ top votes、long-tail ≠ low votes、fresh ≠ newest、
   contradiction ≠ 情绪相反；需要 benchmark 把"什么值得选"变成可测量对象。
2. 存在多个候选算法族（MMR / xQuAD / DPP / Submodular / LTR…），
   在真实数据上证明基线价值之前，选择实现哪一个是赌博。
3. 用户流程：Track A 发现 → Track B benchmark → **独立审查** → 才谈 Spec/实现。

---

## 5. 当前产品方向的已知弱点（中立）

- **无 TARGET 实现**：pilot 的"最佳策略"结论尚未有真实实现来兑现。
- **无 real embedding**：B1/B2 是 ngram proxy，语义能力未经真实 embedding 验证。
- **无 Tier-3（adaptive stopping）**：何时停止抓取的机制未验证（false_stop_rate = NOT_RUN）。
- **author identity 弱**：canonical schema 无 author_id，只有 name string → expert 归因受限。
- **freshness 弱**：3/5 真实 case 语料过旧，fresh window 内无内容 → N/A。
- **小 case 饱和**：relevant gold 缩小后（485463474→2、487214224→1）recall 饱和，区分度下降。

这些弱点都在 11_OPEN_QUESTIONS.md 展开。
