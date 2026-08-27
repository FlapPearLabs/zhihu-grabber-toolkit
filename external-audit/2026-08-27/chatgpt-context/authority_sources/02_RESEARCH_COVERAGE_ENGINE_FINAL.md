# Research Coverage Engine — Final Design

STATUS: DESIGN_FROZEN  
VERSION_ASSIGNMENT: UNASSIGNED  
IMPLEMENTATION_AUTHORIZATION: NONE  
STAGE: THEORY / BENCHMARK / IMPLEMENTATION-READY BASELINE DESIGN

> **Terminology note:** `V1` / `V1 baseline` in this document means the first implementation baseline of this design only. It does **not** assign a product version. `VERSION_ASSIGNMENT` remains `UNASSIGNED`.

---

## 1. Problem Definition

Research Coverage Engine 不是 Ranking Engine。

目标不是：

> 给所有知乎内容打一个 QualityScore，然后取 Top-K。

目标是：

> 给定自然语言研究问题和有限成本，
> 构造一个相关、全面、多样、低冗余，
> 同时尽量包含专家、证据、新内容、长尾和反方观点的可信 Corpus。

本质：

> SUBSET SELECTION UNDER CONSTRAINTS

而不是：

> INDIVIDUAL DOCUMENT RANKING

---

## 2. Why We Deliberately Keep V1 Simple

第一版不追求算法论文数量。

目标是：

- 高收益；
- 低工程复杂度；
- 低参数数量；
- 高可解释性；
- 高确定性；
- 易于写 regression；
- 易于 benchmark；
- 易于未来替换高级算法。

我们简化的是：

> Implementation Complexity

不是：

> Information Contract

因此第一版仍然保留：

- 多 Provider；
- 多 Query；
- 多文体；
- 多 lane；
- expertise；
- evidence；
- freshness；
- long-tail；
- contradiction；
- coverage；
- provenance；
- benchmark hooks。

未来复杂算法可以替换内部 selector，而不改变外部数据模型和证据合同。

---

## 3. V1 Core Pipeline

```text
Natural Language Question
        ↓
LLM Query / Aspect Expansion
        ↓
Multi-source / Multi-query Retrieval
        ↓
RRF Candidate Fusion
        ↓
Embedding + Cosine Geometry
        ↓
Deterministic Metadata Features
        ↓
MMR
+
Multi-lane Exploration Constraints
        ↓
Selected Batch
        ↓
Simple Claim / Aspect Clustering
        ↓
Simple Saturation Heuristics
        ↓
More Search? ── YES ──→ next retrieval round
        │
        NO
        ↓
Verified Research Corpus
        ↓
Existing v0.3 Research Kernel
```

V1 正式采用的算法/机制只有：

1. LLM Query / Aspect Expansion
2. RRF
3. Dense Embedding + Cosine Similarity
4. Deterministic Expertise / Evidence / Freshness / Popularity Features
5. MMR + Multi-lane Exploration Constraints
6. Simple Claim / Aspect Clustering
7. Simple Saturation Heuristics

没有训练型模型依赖。

---

## 4. Mathematical Foundations Used in V1

### 4.1 Linear Algebra

用于：

- embedding vectors；
- cosine similarity；
- query/content similarity matrix；
- aspect/content similarity matrix；
- cluster distance；
- novelty calculation。

核心思想：

> 把重复、昂贵的语义比较转换为可缓存的向量计算。

V1 不要求 PCA/SVD。

---

### 4.2 Information Retrieval

用于：

- query expansion；
- rank fusion；
- semantic relevance；
- diversification。

V1 使用：

- RRF
- MMR

---

### 4.3 Discrete Mathematics / Greedy Selection

MMR 本质上逐步选择：

> 当前最相关、同时最不重复的候选。

V1 暂不实现复杂 Submodular / DPP。

但 selector interface 必须保留未来替换能力。

---

### 4.4 Probability / Statistics

V1 不建立复杂概率模型。

仅用于：

- basic normalized statistics；
- batch novelty rate；
- new-claim rate；
- new-aspect rate；
- coverage diagnostics。

复杂 recall estimation 留待未来 benchmark。

---

### 4.5 Graph Theory

V1 仅使用轻量 claim relations / clusters。

不建立大型 graph engine。

SQLite relations 足够。

---

## 5. Research Planner

LLM 的主要前端职责：

- clarify user research intent;
- decompose topic;
- identify important research aspects;
- generate alternative queries;
- identify entities;
- identify likely opposing framings;
- generate terminology variants.

LLM 不拥有：

- canonical source authority;
- coverage authority;
- retrieval identity;
- verification authority.

Planner 输出必须结构化并持久化。

---

## 6. Multi-query Retrieval

不能只执行用户原始 query。

候选来源包括：

- Official Zhihu Search
- Session/Web Search
- Topics
- Questions
- Articles
- Pins
- relevant author content
- optional global search

目标先建立：

> HIGH-RECALL CANDIDATE POOL

而不是直接得到最终 Top-K。

---

## 7. RRF — V1 Rank Fusion

多个 Provider / Query 的 score 往往不可直接比较。

V1 使用 Reciprocal Rank Fusion。

选择原因：

- deterministic；
- 无训练；
- 参数极少；
- 对不同 retrieval channel 友好；
- 不要求 score calibration；
- 实现与测试成本低。

RRF 负责：

> Candidate Fusion

不负责：

> Final Corpus Selection

---

## 8. Embedding + Cosine Geometry

每条 Content 一次生成 embedding 并缓存。

主要用途：

- semantic relevance；
- redundancy；
- novelty；
- aspect relevance；
- clustering。

不允许每轮都重新 embedding 相同 canonical content。

---

## 9. Optional SVD / PCA

```text
STATUS = FUTURE_CANDIDATE
IMPLEMENT_NOW = NO
```

原因：

- 当前候选规模未证明需要降维；
- 降维会新增 retained-dimension benchmark；
- 会引入 projection versioning；
- 可能损伤 Long-tail / Expert Recall。

只有性能 profiling 证明 embedding 维度已成为真实瓶颈时再研究。

---

## 10. Content Feature Families

### Semantic

- question relevance
- aspect relevance

### Evidence

第一版只用可解释的 deterministic features：

- official reference
- paper/reference link
- external citation
- chart
- formula
- code
- quantitative data
- experiment / benchmark
- explicit claim

### Author Expertise

第一版：

- verified credential ↔ topic match
- employment ↔ topic match
- education ↔ topic match
- historical topic similarity
- historical evidence density
- historical topic consistency

### Freshness

保护刚发布、尚未积累互动的内容。

### Social Validation

- vote count
- comment count
- historical engagement

原则：

> Popularity != Quality

大尺度 vote 推荐使用：

> log(1 + vote)

而不是原始值。

---

## 11. Author Expertise

必须采用：

> Topic-conditioned Expertise

禁止：

> Global Authority Score

例如：

```text
NVIDIA engineer × GPU
→ strong expertise prior possible

NVIDIA engineer × oncology
→ little/no expertise prior
```

### Matrix Factorization

```text
STATUS = FUTURE_CANDIDATE
IMPLEMENT_NOW = NO
```

原因：

- Author × Topic matrix 高度稀疏；
- 冷启动严重；
- 需要真实 benchmark / supervision；
- deterministic features 已覆盖 V1 大部分收益。

---

## 12. Multi-lane Inclusion

Discovery / Inclusion 与最终排序分离。

必须保留：

- Mainstream
- Expert
- Evidence-rich
- Fresh
- Long-tail / Novel
- Contradictory

目的：

防止：

> Popularity feedback loop

V1 不要求固定比例。

具体 lane quota 必须通过 benchmark 或安全上限约束确定。

---

## 13. MMR — V1 Main Selector

V1 用 MMR 作为核心选择基线。

原因：

- relevance + redundancy 两个目标直接；
- 无训练；
- 易解释；
- 易实现；
- 易 regression；
- 容易与 future selector A/B。

MMR 不负责保护所有长尾。

因此必须叠加：

> Multi-lane Exploration Constraints

---

## 14. Algorithms Explicitly Deferred From V1

以下不是被否定，而是：

> FUTURE_CANDIDATE

### DPP

Deferred because:

- kernel design；
- quality/similarity calibration；
- numerical complexity；
- 需要与 MMR/Submodular benchmark 才知道真实增益。

### xQuAD

Deferred because:

- 强依赖稳定 Aspect Map；
- 需要 aspect probability / coverage model；
- V1 的 MMR + lanes 已能覆盖大量收益。

### Complex Submodular Optimization

Deferred because:

- objective 容易演变成大量权重调参；
- benchmark 成本高；
- V1 先建立强 baseline。

### Trained Learning-to-Rank

Deferred because:

- 需要标注集；
- 需要 train/validation split；
- 需要长期 recalibration；
- 容易拖入模型训练工程。

### Full Active Learning

Deferred because:

- uncertainty calibration；
- acquisition functions；
- batch selection；
- dynamic policy；
- 会把产品开发变成研究项目。

### InfoGain-RAG Online Scoring

Deferred because:

- 逐文档 LLM scoring 昂贵；
- 不稳定；
- 与“减少重复语义调用”的目标相冲突。

### Search-R1 / RL Retrieval

Deferred because:

- 需要 trajectory；
- 需要 reward；
- 训练和评估成本高。

### Stop-RAG / RL Stopping

Deferred because:

- 当前没有足够历史 trajectory；
- simple stopping 已能先建立 usable baseline。

### Persistent Homology / TDA

Deferred because:

- 工程复杂；
- 当前产品增益不明确。

---

## 15. Simple Claim / Aspect Clustering

V1 不建立复杂 Knowledge Graph。

只需要轻量结构：

```text
claim_id
canonical_claim
source_ids[]
supporting_sources[]
opposing_sources[]
authors[]
expert_sources[]
evidence_sources[]
```

SQLite relations 即可。

避免：

> 100 个重复回答 = 100 个独立观点

目标：

> 100 个来源可以聚合到一个 Claim Cluster。

---

## 16. Adaptive Depth

V1 不固定：

- Top 50
- Top 100
- Top 500

默认：

> ADAPTIVE_DEEP

逐批抓取并计算：

- new_aspect_rate
- new_claim_cluster_rate
- new_expert_rate
- new_contradiction_rate
- novelty_gain

---

## 17. V1 Stopping Heuristic

V1 不直接上线：

- Chao
- Quant/QuantCI
- Stop-RAG
- MDP

V1 只使用 deterministic saturation heuristics。

例如连续若干 batch：

- 几乎无新 aspect；
- 几乎无新 claim；
- 无新 expert；
- 无新 contradiction；
- novelty 很低；

则标记：

> SATURATION_CANDIDATE

最终阈值必须 benchmark。

---

## 18. Future Stopping Candidates

### Chao / Unseen Species

```text
ROLE = SATURATION_DIAGNOSTIC
NOT = RETRIEVAL_COVERAGE_PROOF
```

### Quant / QuantCI

用于 future recall-aware stopping benchmark。

### Value-based / RL Stopping

只有积累足够真实研究 trajectory 后再考虑。

---

## 19. Risk of Being Too Simple

V1 简化后仍存在五类风险。

### Risk A — Planner misses aspects

Mitigation:

- multiple query variants；
- opposing framing；
- gap re-query；
- benchmark Aspect Recall。

### Risk B — Embedding blind spots

Mitigation:

- preserve lexical retrieval；
- RRF merges multiple channels；
- do not use embedding as sole admission gate。

### Risk C — Expertise heuristics favor credentialed users

Mitigation:

- historical topic evidence；
- evidence-rich lane；
- long-tail lane；
- credential only as prior。

### Risk D — MMR over-diversifies

Mitigation:

- preserve Mainstream lane；
- allow multiple strong sources for same key claim；
- measure Must-See Recall。

### Risk E — Saturation stops too early

Mitigation:

- minimum retrieval rounds；
- contradiction/expert/freshness checks；
- gap critic；
- benchmark false-stop cases。

Conclusion:

> V1 is intentionally simple, but not simplistic.

我们删除的是不必要的算法复杂度，
没有删除关键的信息维度和未来升级接口。

---

## 20. Benchmark

复杂算法不得直接上线。

Zhihu Research Retrieval Benchmark 至少测：

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

对照：

```text
Baseline 0: Popularity Top-K
Baseline 1: Semantic Top-K
Baseline 2: MMR + lanes

Future Candidate:
xQuAD
DPP
Submodular
trained LTR
```

只有 benchmark 明显证明收益，复杂算法才晋级生产。

---

## 21. Freeze

```text
RCE_V1 =
Query/Aspect Expansion
+ RRF
+ Embedding/Cosine
+ Deterministic Features
+ MMR
+ Multi-lane Exploration
+ Simple Claim Clustering
+ Simple Saturation

ALL_COMPLEX_ALGORITHMS =
FUTURE_CANDIDATE
```
