# Algorithm Evidence & Engineering Decisions — Final

STATUS: DESIGN_FROZEN  
VERSION_ASSIGNMENT: UNASSIGNED  
IMPLEMENTATION_AUTHORIZATION: NONE

> **Terminology note:** `V1` / `V1 baseline` in this document means the first implementation baseline of this design only. It does **not** assign a product version. `VERSION_ASSIGNMENT` remains `UNASSIGNED`.

---

## 1. Purpose

本文件记录：

- 候选算法；
- 数学来源；
- 对应问题；
- 为什么采用；
- 为什么延期；
- 当前成熟度；
- 是否需要 Benchmark。

重要：

> 论文存在 ≠ 产品应该实现。

我们的选择标准是：

> 工程可用性 × 产品收益 × 稳定性 ÷ 复杂度

---

## 2. Mathematical Tool Map

| 数学/研究领域 | 对产品的作用 | V1 使用程度 |
|---|---|---|
| 线性代数 | Embedding、Cosine、相似度矩阵 | CORE |
| 信息检索 IR | Query expansion、RRF、MMR | CORE |
| 离散数学 / 组合优化 | Subset selection、去重、多样性 | LIGHT IN V1 |
| 图论 | Claim clusters / relations | LIGHT IN V1 |
| 概率统计 | 饱和度、变化检测、显著性 | SIMPLE IN V1 |
| 信息论 | 信息增益、JS divergence | FUTURE |
| 时间序列统计 | change-point | FUTURE |
| 机器学习 Ranking | trained LTR / expertise model | FUTURE |
| 强化学习 | Search-R1 / Stop-RAG 类策略 | DEFERRED |
| 拓扑数据分析 | embedding topology | DEFERRED |

结论：

> 第一版真正依赖的是线性代数 + IR + 轻量离散选择 + 简单统计。

不是“高等数学越多越好”。

---

## 3. Algorithms Selected for the First Baseline

### A01 — LLM Query / Aspect Expansion

SOURCE FAMILY:

- Generative Relevance Feedback with Large Language Models
- arXiv:2304.13157

FIELD:

> Information Retrieval / LLM Retrieval

PROBLEM:

用户一句自然语言 query 不足以覆盖完整研究空间。

USE:

- research aspects;
- alternative queries;
- terminology;
- entities;
- opposing framings.

WHY NOW:

- 高收益；
- 调用频率低；
- 无需训练；
- 很容易接入现有 Search。

RISK:

Planner 可能遗漏 aspect。

MITIGATION:

- multi-query;
- opposing framing;
- gap re-search;
- benchmark Aspect Recall.

---

### A02 — RRF

NAME:

Reciprocal Rank Fusion

SOURCE:

Cormack, Clarke, Büttcher, SIGIR 2009

FIELD:

> Information Retrieval / Rank Fusion

PROBLEM:

多个 Search Provider / Query 的 ranking score 不可直接比较。

USE:

> Candidate Fusion

WHY NOW:

- deterministic；
- no training；
- few parameters；
- implementation small；
- mature baseline。

STATUS:

> V1 CORE

---

### A03 — Dense Embedding + Cosine Similarity

SOURCE FAMILY:

Transformer Embeddings / Dense Retrieval

FIELD:

> Linear Algebra + Information Retrieval

PROBLEM:

大规模文本语义比较太慢、太随机。

USE:

- semantic relevance;
- redundancy;
- novelty;
- clustering;
- aspect similarity.

WHY NOW:

- 一次 embedding 可以缓存；
- 后续数值计算便宜；
- 非常适合 deterministic controller。

STATUS:

> V1 CORE

---

### A04 — Deterministic Expertise Features

SOURCE FAMILY:

Expert Finding in Community Question Answering: A Review  
arXiv:1804.07958

Towards Robust Expert Finding in Community Question Answering Platforms  
arXiv:2503.02674

FIELD:

> Expert Finding / Ranking / Recommendation

PROBLEM:

低赞专家内容不能因 popularity 被漏掉。

V1 USE:

- credential-topic match;
- employment-topic match;
- education-topic match;
- historical topic similarity;
- historical evidence density;
- topic consistency.

WHY NOT TRAIN:

当前数据不足。

STATUS:

> V1 FEATURES / NO LEARNED MODEL

---

### A05 — Deterministic Evidence Features

FIELD:

> IR / Evidence Retrieval / Structured Metadata

USE:

- official reference;
- paper/reference;
- chart;
- formula;
- code;
- quantitative evidence;
- experiment;
- explicit claim.

PROBLEM:

高身份作者不一定给高质量 evidence；
匿名用户也可能提供极强 evidence。

STATUS:

> V1 CORE FEATURE FAMILY

---

### A06 — MMR

NAME:

Maximal Marginal Relevance

SOURCE:

Carbonell & Goldstein, SIGIR 1998

FIELD:

> Information Retrieval / Diversification

PROBLEM:

高相关候选容易高度重复。

USE:

> Relevance + Redundancy control

WHY NOW:

- simple；
- deterministic；
- interpretable；
- easy baseline；
- easy to regression-test。

LIMIT:

不能单独保证 expert / fresh / long-tail。

因此必须：

> MMR + Multi-lane Exploration Constraints

STATUS:

> OPTIONAL_REDUNDANCY_MECHANISM

> **Amendment Note (RCE_DESIGN_AMENDMENT_01):** Based on P1 Decision-Grade Evidence Gate 01, MMR is demoted from V1 CORE to OPTIONAL_REDUNDANCY_MECHANISM. The selector baseline is now question/source-group preservation + popularity anchor + dense semantic relevance/novelty + optional lightweight redundancy control. MMR remains available as the optional redundancy component. See `09_RCE_DESIGN_AMENDMENT_01.md` §3 for details.

---

### A07 — Multi-lane Exploration

SOURCE FAMILY:

Active Learning / Exploration-Exploitation principles

REFERENCE:

A Survey of Active Learning for NLP  
arXiv:2210.10109

FIELD:

> Active Learning / Sampling / Decision Theory

V1 USE:

不实现完整 Active Learning。

只借思想：

- Mainstream
- Expert
- Evidence-rich
- Fresh
- Long-tail
- Contradictory

WHY:

防止 popularity feedback loop。

STATUS:

> RETRIEVAL_SIGNALS

> **Amendment Note (RCE_DESIGN_AMENDMENT_01):** Based on P1 Decision-Grade Evidence Gate 01, the six lanes are demoted from V1 DESIGN MECHANISM (hard selector constraints) to RETRIEVAL_SIGNALS. Their new roles are:
> - Mainstream → retrieval / soft popularity feature
> - Expert → retrieval signal + topic-conditioned soft feature
> - Evidence-rich → retrieval signal + soft feature
> - Fresh → retrieval/time policy + diagnostic
> - Long-tail → soft marginal-value / novelty feature
> - Contradictory → opposing-query generation + claim-stage diagnostic
> 
> The information dimensions remain part of the product contract; only their hard-quota selector role is removed from the first baseline. See `09_RCE_DESIGN_AMENDMENT_01.md` §4 for details.

---

### A08 — Simple Saturation Heuristics

FIELD:

> Statistics / Sequential Decision

V1 SIGNALS:

- new_aspect_rate
- new_claim_rate
- new_expert_rate
- new_contradiction_rate
- novelty_gain

WHY NOW:

- deterministic；
- easy to measure；
- no model training；
- enough to create first adaptive-depth baseline。

STATUS:

> V1 CORE

---

## 4. Algorithms Explicitly Deferred

### D01 — Matrix Factorization

SOURCE:

Expert Finding literature / arXiv:1804.07958

FIELD:

> Linear Algebra + Collaborative Filtering / Latent Factor Models

IDEA:

Author × Topic latent expertise.

WHY USEFUL:

长期可能比手工规则更好。

WHY DEFER:

- sparse matrix；
- cold start；
- supervision shortage；
- benchmark dependency；
- deterministic features already capture V1 value。

STATUS:

> FUTURE_CANDIDATE / DO_NOT_IMPLEMENT_NOW

---

### D02 — Trained Learning-to-Rank

SOURCE:

Feature Engineering in Learning-to-Rank for Community Question Answering Task  
arXiv:2309.07610

FIELD:

> Supervised Ranking

WHY USEFUL:

可以自动学习 metadata + semantic feature weights。

WHY DEFER:

- labeled dataset required；
- train/validation split；
- retraining；
- calibration；
- benchmark cost。

STATUS:

> FUTURE_CANDIDATE

---

### D03 — xQuAD

FIELD:

> Search Result Diversification

WHY USEFUL:

明确覆盖 query aspects。

WHY DEFER:

- requires stable Aspect Map；
- requires aspect probability / satisfaction model；
- V1 MMR + lanes already gives strong baseline。

STATUS:

> BENCHMARK_CANDIDATE

---

### D04 — DPP

REFERENCE:

Diverse Multi-Answer Retrieval with Determinantal Point Processes  
arXiv:2211.16029

FIELD:

> Probability / Linear Algebra / Diversity Modeling

WHY USEFUL:

天然联合 quality + diversity。

WHY DEFER:

- kernel design；
- matrix computation；
- hyperparameter calibration；
- benchmark needed against MMR/Submodular。

STATUS:

> BENCHMARK_CANDIDATE

---

### D05 — Submodular Facility Location / Complex Objective

REFERENCE:

A Class of Submodular Functions for Document Summarization  
Lin & Bilmes, ACL 2011

RELATED:

arXiv:1210.4871

FIELD:

> Discrete Optimization / Submodular Optimization

WHY USEFUL:

非常适合 coverage + representativeness + diminishing returns。

WHY DEFER FROM V1:

算法本身不一定难，
但完整 objective 容易产生：

- many weights；
- many constraints；
- continuous benchmark tuning。

V1 先建立 strong MMR baseline。

STATUS:

> HIGH-PRIORITY FUTURE BENCHMARK

---

### D06 — Full Active Learning

REFERENCE:

A Survey of Active Learning for NLP  
arXiv:2210.10109

FIELD:

> Machine Learning / Sampling

WHY USEFUL:

uncertainty + representativeness + diversity。

WHY DEFER:

- acquisition function；
- uncertainty calibration；
- batch strategy；
- feedback loop；
- adds research-program complexity。

STATUS:

> FUTURE_CANDIDATE

---

### D07 — PCA / SVD

FIELD:

> Linear Algebra / Dimensionality Reduction

WHY USEFUL:

降低 embedding storage / similarity compute。

WHY DEFER:

当前没有性能证据表明它是瓶颈。

额外成本：

- retained dimension benchmark；
- projection version；
- possible recall degradation。

STATUS:

> PERFORMANCE-TRIGGERED FUTURE CANDIDATE

---

### D08 — Chao Unseen-Species Estimator

REFERENCE:

Convergence of Chao Unseen Species Estimator  
arXiv:2001.04130

FIELD:

> Statistics / Ecology / Species Estimation

WHY USEFUL:

作为“是否还不断出现新 claim”的辅助诊断。

WHY NOT PRODUCTION AUTHORITY:

知乎 Search 不是 IID sampling。

STATUS:

> SATURATION_DIAGNOSTIC ONLY / FUTURE BENCHMARK

---

### D09 — Quant / QuantCI Stopping

REFERENCE:

Heuristic Stopping Rules for Technology-Assisted Review  
arXiv:2106.09871

FIELD:

> Statistics / Recall Estimation / Technology-Assisted Review

WHY USEFUL:

更严谨的 stopping rule。

WHY DEFER:

需要适配知乎 retrieval distribution 并 benchmark。

STATUS:

> FUTURE CANDIDATE

---

### D10 — InfoGain-RAG Online Scoring

REFERENCE:

InfoGain-RAG  
arXiv:2509.12765

FIELD:

> RAG / Information Gain

WHY USEFUL:

衡量加入下一篇文档的 marginal value。

WHY DEFER:

线上逐文档 LLM scoring：

- expensive；
- slow；
- unstable；
- conflicts with Semantic Compilation Principle。

POSSIBLE FUTURE USE:

> offline teacher signal

STATUS:

> FUTURE / OFFLINE RESEARCH

---

### D11 — Search-R1 / RL Retrieval

REFERENCE:

Search-R1  
arXiv:2503.09516

FIELD:

> Reinforcement Learning / Agentic Search

WHY USEFUL:

multi-round search/reason/search。

WHY DEFER:

- trajectory dataset；
- reward design；
- training；
- evaluation；
- massive engineering overhead。

STATUS:

> METHOD REFERENCE ONLY

---

### D12 — Stop-RAG / RL Stopping

REFERENCE:

Stop-RAG  
arXiv:2510.14337

FIELD:

> Reinforcement Learning / MDP / Retrieval Control

WHY USEFUL:

learn expected value of next retrieval round。

WHY DEFER:

- insufficient research trajectories；
- simple heuristics first；
- high research cost。

STATUS:

> FUTURE_CANDIDATE

---

### D13 — Persistent Homology / TDA

FIELD:

> Algebraic Topology / Topological Data Analysis

WHY POSSIBLY INTERESTING:

embedding manifold analysis。

WHY DEFER:

- low demonstrated product value；
- high conceptual complexity；
- simpler methods already solve immediate problems。

STATUS:

> LONG-TERM RESEARCH ONLY

---

### D14 — Advanced Graph Algorithms

FIELD:

> Graph Theory / Network Science

EXAMPLES:

- centrality；
- community detection；
- spectral clustering；
- graph embedding。

WHY DEFER:

V1 simple Claim Clusters + SQLite relations sufficient。

STATUS:

> FUTURE_CANDIDATE

---

### D15 — JS Divergence

FIELD:

> Information Theory

USE:

topic-distribution shift。

STATUS:

> FUTURE TEMPORAL CANDIDATE

WHY NOT V1 HARD DEPENDENCY:

basic distribution deltas can establish baseline first。

---

### D16 — Change-point Detection

REFERENCE:

Changepoint Analysis of Topic Proportions in Temporal Text Data  
arXiv:2112.00827

FIELD:

> Time-Series Statistics

WHY USEFUL:

find structural topic/activity changes。

WHY DEFER:

needs enough longitudinal data。

STATUS:

> FUTURE TEMPORAL CANDIDATE

---

### D17 — Permutation Test + FDR Semantic Shift

REFERENCE:

Statistically significant detection of semantic shifts using contextual word embeddings  
arXiv:2104.03776

FIELD:

> Statistical Hypothesis Testing / Multiple Testing

WHY USEFUL:

reduce false "opinion changed" alerts。

WHY DEFER:

- sample-size requirements；
- null-model design；
- multiple-testing pipeline；
- not required for first usable monitor。

STATUS:

> FUTURE TEMPORAL CANDIDATE

---

## 5. Why This Is Not Oversimplification

我们没有删掉：

- expertise；
- evidence；
- freshness；
- long-tail；
- contradiction；
- multi-query；
- multi-provider；
- adaptive depth；
- claim structure；
- provenance；
- coverage；
- benchmark。

我们只延期：

> 用更复杂的方法计算同一类信号。

例如：

```text
V1 Expertise:
deterministic features

Future Expertise:
MF / learned model
```

```text
V1 Diversity:
MMR + lanes

Future Diversity:
DPP / xQuAD / Submodular
```

```text
V1 Stopping:
simple saturation

Future Stopping:
Chao / Quant / RL
```

```text
V1 Monitoring:
delta heuristics

Future Monitoring:
JS / change-point / statistical significance
```

因此：

> SIMPLE FIRST ≠ SIMPLE FOREVER

而是：

> Preserve the contract, simplify the implementation.

---

## 6. Main Risks of V1 Simplicity

| 风险 | 简化可能造成的问题 | 保护机制 |
|---|---|---|
| Planner 漏 aspect | Retrieval coverage 不足 | multi-query + gap search |
| Embedding 偏差 | 长尾语义未命中 | lexical retrieval + multi-provider RRF |
| Expertise heuristic 偏认证用户 | 无认证专家被漏 | history/evidence/long-tail lanes |
| MMR 过度去重 | 主流关键观点证据不足 | mainstream lane + must-see recall |
| Lane quota 拍脑袋 | 资源分配失衡 | benchmark / no fixed permanent quota |
| Saturation 过早 | 研究停止太早 | minimum rounds + expert/contradiction checks |
| Simple claim clustering | 合并/拆分错误 | provenance preserved + re-clusterable |
| Temporal heuristic noise | 假变化提醒 | candidate vs confirmed distinction |

---

## 7. Benchmark Policy

复杂算法只有满足以下条件才可从 FUTURE_CANDIDATE 晋级：

1. 对明确 baseline 有稳定增益；
2. 增益在多个 topic domain 成立；
3. 不显著损害 Long-tail / Expert Recall；
4. 运行成本可接受；
5. run-to-run stability 不下降；
6. regression 可实现；
7. failure 可解释。

Benchmark metrics：

- Must-See Recall
- Aspect Recall
- Expert Recall
- Long-tail Recall
- Fresh-content Recall
- Evidence-rich Recall
- Contradiction Recall
- Redundancy
- Analysis Coverage
- Cost
- Run-to-run Stability
- Jaccard Stability

---

## 8. Final Engineering Decision

### V1 — Implement / Benchmark First

```text
LLM Query/Aspect Expansion
RRF
Embedding + Cosine
Deterministic Expertise Features
Deterministic Evidence Features
Freshness / Weak Popularity Signals
Question/Source-group Preservation
Popularity Anchor
Dense Semantic Relevance/Novelty
Optional Lightweight Redundancy Control (MMR available)
Simple Claim Clustering
Simple Saturation Heuristics
SQLite Historical State
```

### Future Candidate — Do Not Implement Now

```text
Matrix Factorization
Trained Learning-to-Rank
xQuAD
DPP
Complex Submodular Optimization
Full Active Learning
PCA/SVD
Chao as stopping authority
Quant/QuantCI production stopping
InfoGain-RAG online scoring
Search-R1 / RL retrieval
Stop-RAG / RL stopping
Persistent Homology / TDA
Advanced Graph Algorithms
JS Divergence as hard dependency
Change-point Detection
Permutation Test + FDR semantic shift
```

> **Amendment Note (RCE_DESIGN_AMENDMENT_01):** The V1 implementation list has been updated to reflect the revised selector baseline. MMR is now listed as "Optional Lightweight Redundancy Control (MMR available)" and multi-lane exploration is removed from the mandatory list. See `09_RCE_DESIGN_AMENDMENT_01.md` for details.

---

## 9. Core Principle

> 工程上先拿到 80%~90% 的明确价值，
> 再让 Benchmark 决定是否值得为剩余收益支付算法复杂度。

不是因为算法高级就上线。

也不是为了简单而牺牲研究质量。

最终目标是：

> 最少必要复杂度下的最大可验证研究价值。
