# Design History and Open Questions

STATUS: HISTORICAL_NON_AUTHORITATIVE  
DATE: 2026-08-25  
IMPLEMENTATION_AUTHORIZATION: NONE

---

## 1. Purpose

本文件只保存设计为什么收敛成现在这样。

它不是当前 Product Spec。

任何内容若与：

- `01_PRODUCT_DIRECTION_FINAL.md`
- `02_RESEARCH_COVERAGE_ENGINE_FINAL.md`
- `03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL.md`
- `04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md`
- `07_RESEARCH_SECURITY_AND_CROSS_SOURCE_SYNTHESIS_GUARDRAILS.md`

冲突：

> 以上 Current Frozen Design 为准。

---

## 2. Starting Point

项目 v0.3 的主要能力集中在：

> 单问题可信研究。

典型流程：

```text
natural-language question
→ search
→ select one Zhihu question
→ capture answers
→ verify
→ corpus analysis
→ evidence-backed synthesis
```

这证明了：

- CLI-first；
- verification；
- resume；
- long-corpus processing；
- evidence lineage；
- controller/model separation

是可行的。

但它尚不是：

> universal Zhihu data / intelligence platform。

---

## 3. Initial Expansion Ideas

早期讨论曾把下一阶段理解成六类平级功能：

1. QR 扫码获得 Cookie；
2. 集成开放平台 Secret 带来的能力；
3. 跨问题研究；
4. Pin / 想法；
5. 博主监控；
6. 自己/博主历史内容聚合分析。

随后设计认识到：

> 这六件事不是平级。

其中大量基础能力属于：

- data access；
- auth；
- provider；
- canonical model。

真正的产品差异主要是：

- Cross-Question Research；
- Author / Personal Intelligence；
- Continuous Intelligence。

---

## 4. Major Product Reframe

从：

> “继续给 Zhihu CLI 加越来越多命令”

收敛为：

> “数据层尽量复用，研究与 Intelligence 做厚。”

于是确定：

```text
THIN_DATA_LAYER
REUSE_FIRST
ADAPTER_FIRST
```

官方已有能力：

> 优先兼容/复用。

成熟 OSS 已经解决的基础读取能力：

> 先审许可证、稳定性、安全性，再 adapter / wrapper / reuse。

不把研发预算大量投入重复实现：

- comments；
- Pin；
- Article；
- QR；
- basic user profile；
- basic topic detail；

除非当前没有可靠可用实现。

---

## 5. Official CLI Discovery Changed the Route

早期曾倾向：

> 我们自己实现一个更完整的 Universal CLI。

后续调查发现知乎官方已经提供：

- official CLI；
- Skill；
- API；
- MCP；
- Access Secret；
- OAuth / user-data capability families。

因此路线调整：

> 不与官方竞争重做基础平台。

而是：

```text
Official capability
       ↓
Adapter / Compatibility
       ↓
Canonical Content / Capability Contract
       ↓
Our Research Kernel
```

---

## 6. Authentication Model Clarification

早期讨论容易把：

- Access Secret；
- API；
- CLI；
- Skill；
- MCP；
- OAuth；
- Cookie/Session

看成“多套知乎能力”。

后续明确：

- Access Secret = credential
- API = HTTP interface
- CLI = executable interface
- Skill = Agent usage/instruction layer
- MCP = structured tool protocol
- OAuth = delegated authorization
- Cookie/Session = Web login state

因此最终产品应该：

> capability-centric，而不是 transport-centric。

---

## 7. Monitoring / Webhook Correction

早期观点：

> “主动监控搞 Webhook 即可。”

后续调查没有确认知乎提供作者内容变更的 inbound webhook。

因此修订为：

```text
Zhihu side:
periodic sync / polling

Local:
SQLite snapshot / delta

Output:
our webhook / notification
```

“Webhook”保留为：

> 我们向外发送 intelligence event 的机制。

而不是当前发现知乎内容变化的来源。

---

## 8. “Full Site / Complete” Correction

早期愿景中出现过：

- “全量知乎”
- “全站完整内容”
- “全量解锁”

后续为了证据合同，统一拆成：

```text
Retrieval Coverage
Source Completeness
Analysis Coverage
```

原因：

> Search 并不是可证明枚举全站相关内容的数据库扫描。

因此最终设计禁止无依据声称：

> “100% 找到了知乎所有相关内容。”

---

## 9. Research Problem Reframe

早期问题：

> 前 50 条还是前 100 条？是不是抓高赞？

后续认识到：

> 核心不是单条 Ranking，而是构造一个 Research Corpus。

于是问题改写为：

> 在有限抓取、时间和 token 预算下，如何选择一个相关、全面、多样、低冗余，同时不漏专家、新内容、低赞高价值内容和反方观点的集合？

命名收敛为：

> Research Coverage Engine

而不是：

> Ranking Engine

---

## 10. Popularity Is Not Quality

确定：

```text
votes / comments / followers
```

只能作为：

> popularity / social validation signal

不能直接等同：

> quality / expertise / research importance。

原因：

- 新内容尚未积累点赞；
- 高质量长尾可能没有分发；
- 热门内容可能只是符合社区情绪；
- 高赞内容可能彼此高度重复。

因此形成：

> Discovery / Inclusion ≠ Ranking

并引入多个 lane。

---

## 11. Topic-conditioned Expertise

用户提出的重要方向：

> 作者的真实专业背景应该影响技术类问答的研究价值。

后续收敛为：

> Topic-conditioned Expertise

而不是全局权威分。

例：

```text
NVIDIA engineer × GPU
→ expertise prior

NVIDIA engineer × unrelated medical topic
→ no comparable expertise prior
```

信号来源包括：

- credential-topic match；
- employment；
- education；
- historical topic evidence；
- historical evidence richness；
- topic consistency；
- weak community reputation。

身份是：

> prior / evidence

不是：

> authority license。

---

## 12. Mathematical Exploration Phase

曾系统研究过：

- Linear Algebra
- Matrix Factorization
- SVD/PCA
- MMR
- RRF
- xQuAD
- DPP
- Submodular Optimization
- Facility Location
- Active Learning
- Information Gain
- Chao / unseen species
- Quant / QuantCI
- Search-R1
- Stop-RAG
- Claim Graph
- JS divergence
- Change-point Detection
- Permutation Test / FDR
- Persistent Homology / TDA

关键结论：

> 数学不是为了显得高级，而是把重复、随机、昂贵的语义判断压缩成稳定、可缓存、可测试的数值计算。

由此形成：

> Semantic Compilation Principle

---

## 13. Why the Algorithm Plan Was Simplified

最初算法探索曾倾向：

- Submodular as core；
- DPP diversity；
- MF expertise；
- statistical stopping；
- advanced temporal shift testing。

随后根据工程收益重新收缩。

原因：

### Matrix Factorization

问题：

- sparse Author × Topic matrix；
- cold start；
- supervision shortage。

决定：

> Future Candidate。

---

### DPP

问题：

- kernel design；
- calibration；
- matrix/numerical complexity；
- real gain requires benchmark。

决定：

> Future Benchmark Candidate。

---

### xQuAD

问题：

- depends on stable Aspect Map；
- aspect satisfaction/probability model。

决定：

> Future Benchmark Candidate。

---

### Complex Submodular

问题不是贪心算法本身，而是：

- objective design；
- many weights；
- many constraints；
- benchmark tuning burden。

决定：

> High-priority future benchmark, not first baseline。

---

### Trained Learning-to-Rank

需要：

- labeled data；
- train/validation；
- recalibration；
- retraining。

决定：

> Future Candidate。

---

### Active Learning Framework

需要：

- uncertainty calibration；
- acquisition strategy；
- feedback loop。

决定：

> 只借 exploration 思想，不做完整系统。

---

### Search-R1 / Stop-RAG

需要：

- trajectory；
- reward；
- RL training。

决定：

> method reference only / future candidate。

---

### TDA / Persistent Homology

数学复杂但当前产品增益没有证明。

决定：

> long-term research only。

---

## 14. Final First-Baseline Choice

最终选择非常克制：

```text
LLM Query / Aspect Expansion
RRF
Dense Embedding + Cosine
Deterministic Expertise Features
Deterministic Evidence Features
Freshness + weak Popularity
MMR
Multi-lane Exploration
Simple Claim Clustering
Simple Saturation Heuristics
```

目标：

> 先拿到 80%~90% 的明确价值，
> 再让 Benchmark 决定是否值得支付剩余复杂度。

---

## 15. Why This Is Not “Simple for Simplicity”

被延期的是：

> 更复杂的计算方法。

没有被删除的是：

- Expertise；
- Evidence；
- Freshness；
- Long-tail；
- Contradiction；
- Multi-query；
- Multi-provider；
- Adaptive depth；
- Claim structure；
- Provenance；
- Coverage；
- Benchmark hooks。

因此可以未来：

```text
deterministic expertise
→ learned expertise / MF

MMR
→ DPP / xQuAD / Submodular

simple saturation
→ Quant / Chao diagnostics / learned stopping

simple temporal delta
→ JS / changepoint / significance testing
```

而不重写产品合同。

---

## 16. Temporal Intelligence Route

作者分析和监控最终被视为同一套历史模型的不同入口。

### Author Research

```text
historical enumerable content
→ canonical corpus
→ topic / claim / stance / style / activity
→ timeline analysis
```

### Monitoring

```text
baseline
→ incremental sync
→ delta
→ change candidate
→ evidence-backed interpretation
→ notification
```

第一版不直接声称：

> “作者观点已经改变。”

先输出：

> STANCE_SHIFT_CANDIDATE / STYLE_SHIFT_CANDIDATE

复杂统计验证留未来。

---

## 17. Versioning History Correction

历史讨论曾出现：

```text
v0.4 Unified Foundation
v0.5 Multi-Question Research
v0.6 Creator Intelligence
v0.7 Monitoring
```

这些只是当时的路线草案。

当前已经明确：

```text
VERSION_ASSIGNMENT = UNASSIGNED
IMPLEMENTATION_AUTHORIZATION = NONE
```

因此这些历史版本号：

> NON-AUTHORITATIVE

不得用于创建 milestone / Spec / branch scope。

---

## 18. Current Open Questions

真正下一阶段需要实证消除的问题主要是：

### Official / Provider

- 官方 CLI 当前真实 command/capability tree；
- Access Secret 当前账号真实权限；
- API / CLI / Skill / MCP parity；
- OAuth scope / token behavior；
- current pagination semantics；
- provider stability。

### Web / Content

- Pin / Article / Video exact current fields；
- comment tree completeness；
- Topic fields；
- Poll results；
- public user history completeness；
- browser session reuse best security design。

### Research Coverage

- Query/Aspect planner baseline quality；
- lexical + dense retrieval combination；
- RRF configuration；
- MMR baseline；
- lane policy；
- simple saturation thresholds；
- Claim clustering baseline；
- benchmark dataset design。

### Temporal Intelligence

- minimum history needed for meaningful change detection；
- default monitoring windows；
- false-positive control；
- when advanced JS/changepoint/statistical tests become worthwhile。

---

## 19. Current State

历史讨论最终收敛为：

```text
PRODUCT:
Zhihu CLI Pro

DATA:
reuse / adapter / canonicalize

CORE DIFFERENTIATION:
Research Coverage
Author / Personal Intelligence
Continuous Intelligence

RCE FIRST BASELINE:
simple deterministic-first stack

TEMPORAL FIRST BASELINE:
SQLite + delta + simple change candidates

ADVANCED ALGORITHMS:
future candidates

VERSION:
unassigned

IMPLEMENTATION:
not authorized by these design sources
```

这就是当前 Final Design 的背景。
