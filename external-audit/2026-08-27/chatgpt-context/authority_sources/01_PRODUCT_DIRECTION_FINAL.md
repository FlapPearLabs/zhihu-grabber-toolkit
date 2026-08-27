# Zhihu CLI Pro — Product Direction

STATUS: DESIGN_FROZEN  
VERSION_ASSIGNMENT: UNASSIGNED  
IMPLEMENTATION_AUTHORIZATION: NONE  
DATE: 2026-08-25

---

## 1. Product Definition

Zhihu CLI Pro 不是新的知乎爬虫，也不是对知乎官方 CLI 的重新实现。

产品定位：

> 统一接入知乎官方能力、Web/Session 能力和成熟开源能力，
> 在此之上提供可信的跨问题研究、作者/个人历史研究与持续情报能力。

核心结构：

```text
Zhihu Data Access
        ↓
Canonical Verified Content
        ↓
Research Coverage / Temporal Intelligence
        ↓
Evidence-backed Research / Monitoring
```

---

## 2. Current Foundation

当前 v0.3 已经形成稳定的 Research Kernel：

- capture
- verification
- resumability
- provenance
- evidence lineage
- corpus processing
- hierarchical full-coverage synthesis
- sampled/full distinction
- controller/model authority separation
- natural-language single-question research orchestration

这些能力继续保留。

原则：

> 不为了新的平台架构重写已经验证过的 v0.3 内核。

采用 Adapter / Wrapper / Strangler Pattern 渐进扩展。

---

## 3. Product Priorities

真正投入研发资源的核心产品只有三类。

### P1 — Cross-Question Deep Research

自然语言问题  
→ 多路搜索  
→ 多问题/多文体候选  
→ Research Coverage Engine  
→ Verified Research Corpus  
→ Evidence-backed synthesis

### P2 — Author / Personal Intelligence

支持：

- 自己的历史内容研究；
- 收藏内容研究；
- 他人的当前可访问公开历史内容；
- 作者主题、观点、写作与知识结构研究。

### P3 — Continuous Intelligence

历史 baseline  
→ incremental sync  
→ delta detection  
→ significant-change analysis  
→ notification / webhook

---

## 4. Data Layer Strategy

数据能力层原则：

> THIN / ADAPTER-FIRST / REUSE-FIRST

优先级：

1. 知乎官方能力；
2. 官方 CLI / API / Skill / MCP；
3. OAuth；
4. Cookie / Session；
5. Browser Session reuse；
6. 已验证成熟 OSS；
7. 只有缺失能力才自行实现。

如果已有稳定实现能够复用或适配，则不重复制造：

- Question detail
- Answer detail
- Article
- Pin
- Comment
- User profile
- Topic
- Collection
- QR login
- Browser session reuse

---

## 5. Authentication Surfaces

目标支持：

### Official

- Access Secret
- Official CLI
- Official API
- Official Skill
- Official MCP

### User Authorization

- OAuth

### Web Session

- QR login
- secure Cookie import
- existing browser Session reuse

凭据来源必须可追踪。

禁止 silent credential/provider fallback。

---

## 6. Unified Content Boundary

未来研究层不直接消费不同 Provider 的原始 JSON。

> **Level 0 scope reconciliation (2026-08-26):** 当前 Applicable Approved Spec 已明确 `VIDEO_SUPPORT = DO_NOT_SUPPORT`。因此 Video 不属于当前 Zhihu CLI Pro canonical object / provider discovery scope；若未来需要支持，必须先经过独立 Approved Spec amendment。

统一转换为 canonical objects：

- User
- Question
- Answer
- Article
- Pin
- Comment
- Topic
- Collection
- Relation
- Evidence Source

所有对象保留：

- canonical identity
- provider
- source URL
- retrieval time
- auth class
- provenance
- verification state

---

## 7. Core Engineering Principle

### 7.1 Controller / Model Separation

> Controller owns identity, provenance, coverage and verification.  
> Model owns semantic interpretation and synthesis.

### 7.2 Semantic Compilation Principle

昂贵、随机的 LLM 不应反复成为全量语料裁判。

采用：

```text
自然语言 / 原始语料
        ↓
少量高价值语义处理
        ↓
Embedding / Aspect / Claim / Stance / Metadata
        ↓
Deterministic Numeric Layer
        ↓
Matrix / Ranking / Graph / Statistics / Constraints
        ↓
Selected Verified Evidence
        ↓
LLM final synthesis
```

目标：

- 降低重复模型调用；
- 提升 run-to-run stability；
- 让核心决策可测试；
- 让大规模研究可缓存和复用；
- 保留 provenance / coverage authority。

---

## 8. Engineering Trade-off Policy

我们的目标不是最大化算法复杂度，而是最大化：

> PRODUCT VALUE / ENGINEERING COST

因此遵循：

### Implement now

只采用：

- 能解决明确 P0/P1 问题；
- 无需训练大模型或大规模标注集；
- 参数少；
- 可解释；
- 可确定性测试；
- 失败时容易定位；
- 与现有 v0.3 能自然衔接。

### Preserve for future

对于：

- 需要大量 benchmark 才能合理调参；
- 需要训练数据；
- 需要 RL trajectory；
- 增加大量数学复杂度但首版收益未知；
- 有更简单 baseline 可以覆盖大部分收益；

统一标记：

> FUTURE_CANDIDATE / DO_NOT_IMPLEMENT_NOW

---

## 9. Coverage Language

禁止未经证明使用：

> 全站完整研究

统一拆分：

### Retrieval Coverage

在当前 Search / Query / Provider 条件下覆盖了多少研究空间。

通常不能证明 100%。

### Source Completeness

对于已经确定的一个可枚举数据源：

captured / currently-accessible enumerable total

可机械验证时才能声称 complete。

### Analysis Coverage

Verified Corpus 中有多少内容真正进入分析。

这里可以实现机械验证的 100%。

---

## 10. Non-Goals

当前不是核心研发目标：

- 重造知乎官方搜索；
- 重造官方 MCP；
- 重造成熟 QR 登录；
- 重造成熟 Pin / Article / Comment wrapper；
- 自建复杂服务端数据库；
- 为数学复杂度而数学复杂化；
- 训练自己的 RL Search Agent；
- 训练自己的 RL Stopping Agent；
- 一开始就建立大型知识图谱平台。

---

## 11. Product Differentiation

官方和 OSS 主要解决：

> 如何拿到知乎数据。

Zhihu CLI Pro 的核心价值是：

> 如何把大量、异构、长尾的知乎数据转化成
> 可验证、高覆盖、低冗余、可重复的研究结果与持续情报。

核心差异：

- Coverage
- Verification
- Evidence lineage
- Long-tail preservation
- Expertise-aware discovery
- Cross-question research
- Temporal intelligence

---

## 12. Current Freeze

```text
PRODUCT_DIRECTION = FROZEN
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED

NEXT_STEP =
Discovery / Capability Audit
+
Research Coverage Benchmark Design
```
