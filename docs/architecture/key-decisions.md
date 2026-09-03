# Key Engineering Decisions

> 这是一份面向贡献者、维护者和产品读者的决策记录。它解释“为什么这样设计”，不替代 Approved Specs、`RULES.md` 或 `docs/product-behavior-contract.md`。

项目没有从第一天就设计成现在的形态。很多边界来自真实 dogfood、失败案例和后续 review。这里沉淀的是已经反复出现、足以影响后续设计的核心决定。

---

## D01 — `captured != verified`

### Problem

抓取器最容易出现的误解是：

```text
请求成功
→ 文件写出来
→ “抓取完成”
```

但真实使用中，成功写文件并不证明：

- 分页完整；
- artifact 结构有效；
- resume 没有留下错误状态；
- 结果已经满足后续 handoff 的要求。

### Decision

把 capture 和 verification 分成两个明确状态：

```text
captured
  ↓ verify-output
verified
```

`verify-output` 是确定性 validity authority。只有 `valid === true` 才能进入 verified completion / handoff。

### Alternatives considered

1. grab 完成时直接写 `verified=true`；
2. 让 orchestrator 根据 exit code 判断成功；
3. 让模型检查输出并判断“看起来完整”。

### Why not

这些方案都把“执行成功”与“产物有效”混在了一起，而且模型判断无法成为确定性 artifact authority。

### Trade-offs

- 多了一道显式验证步骤；
- pipeline 更严格，失败时更容易 STOP；
- 但后续模块可以依赖一个清晰、机械可验证的边界。

### Durable lesson

> **完成不是一个文案，而应该有明确的可验证条件。**

---

## D02 — Controller owns truth; Model owns semantics

### Problem

让 LLM 同时负责：

- 生成摘要；
- 生成 sourceId；
- 声称自己分析了哪些来源；
- 判断 coverage；
- 决定 evidence lineage；

会产生一个根本问题：概率模型既在生成结论，又在证明自己的过程正确。

### Decision

```text
Controller owns truth and authority.
Model owns semantics.
```

Controller 拥有：

- canonical source identity；
- coverage；
- evidence lineage；
- filesystem / network IO；
- structured-output validation；
- mode identity；
- fail-closed semantics。

模型只负责需要语义理解和归纳的部分。

### Alternatives considered

1. 让模型直接生成完整 research JSON；
2. 让模型自己给每个结论分配 source identity；
3. 用 prompt 要求模型“不要漏来源”。

### Why not

Prompt 约束不是 deterministic authority，也不能证明模型没有漏掉或错误映射 source。

### Trade-offs

- controller 需要维护更多确定性 state；
- schema 与 validation 会更严格；
- 但结果可审计、可测试，也更容易替换模型。

### Durable lesson

> **模型应该负责它真正擅长的语义判断，而不是承担可以机械证明的系统真相。**

---

## D03 — Canonical data 与 Derived View 分离

### Problem

Markdown、摘要、model projection 都比原始 HTML 更适合阅读和分析，但它们已经经过转换。

如果 derived result 反向成为唯一事实来源：

- 转换 bug 会污染原始数据；
- 模型总结可能被误当原文；
- 后续无法重新验证或换一套 renderer。

### Decision

`answers.json` 中保存的原始回答内容保持 canonical；Markdown、projection、digest 和 research result 都是 derived view。

```text
Canonical Source
   ├── Human View
   ├── Agent Projection
   ├── Corpus Map
   └── Final Synthesis
```

### Alternatives considered

1. 只保存 Markdown；
2. 抓取后直接清洗并覆盖原内容；
3. 只保留模型最终摘要。

### Why not

这些方案都损失可重放、可验证和重新处理能力。

### Trade-offs

- 会保存更多 artifact；
- 数据 pipeline 更明确；
- 但可以安全地升级 renderer、projection 和模型，而不改变历史事实。

---

## D04 — Full Coverage 和 Sampled Analysis 是不同产品语义

### Problem

知乎的点赞排序很有价值。一个很自然的优化是：

> 只分析前 10% 或前 20% 高赞回答。

问题在于，如果最终仍然输出成“这个问题的整体观点总结”，用户很难知道长尾回答已经被排除。

### Decision

把两类 pipeline 明确分离：

```text
FULL-COVERAGE DIGEST
```

和：

```text
TOP-PERCENT / SAMPLED ANALYSIS
```

Sampled mode 必须披露 total / selected / requested percentage / actual coverage / `isFullCoverage` 等覆盖事实。

### Alternatives considered

1. 默认只读热门回答；
2. corpus 太大时自动降级到高赞 sample；
3. 只在最终文字里模糊写“主要观点”。

### Why not

这些方式会让成本优化静默改变产品语义。

### Trade-offs

- full digest 成本更高；
- sampled mode 的 disclosure 更繁琐；
- 但用户可以明确知道自己得到的是“全量研究”还是“高赞视图”。

### Durable lesson

> **优化可以改变计算量，但不能偷偷改变用户以为自己买到的东西。**

---

## D05 — Thin Orchestrator，复用已有 primitive

### Problem

当底层能力越来越多，用户需要手动理解：

```text
search
→ grab
→ verify
→ make-handoff
→ chunk
→ map
→ verify
→ reduce
→ render
```

这说明基础能力已经够用，但 orchestration complexity 转移给了用户。

### Decision

增加一个薄的 Research Orchestrator，只负责：

- sequence existing primitives；
- inspect machine-readable result；
- decide next legal stage；
- persist resumable state；
- expose progress；
- stop on deterministic failures。

它不重新实现 capture、verify、handoff 或 corpus verification。

### Alternatives considered

1. 写一个全新的“万能 research agent”；
2. 把所有 primitive 合成一个巨型 CLI；
3. 保持手工工作流，把复杂度交给 prompt。

### Why not

第一种会重复已经验证的 authority；第二种让模块边界变重；第三种让可靠性依赖每次对话是否正确记住步骤。

### Trade-offs

- orchestrator 需要理解多个 primitive 的状态；
- 但底层能力仍然可以独立使用和测试；
- product UX 改善不会破坏成熟实现。

### Durable lesson

> **当 primitive 已经可靠，优先编排它们，而不是为了“统一”重写它们。**

---

## D06 — Runtime 是可替换基础设施，不是产品身份

### Problem

真实 dogfood 暴露了两个不同问题：

```text
Capability Isolation
```

和：

```text
Model Quality
```

一个本地 runtime 可以满足零工具面和数据本地化要求，但模型质量可能不足以稳定完成大型 workload；更强的 cloud runtime 又带来 egress、成本和 availability 依赖。

### Decision

Runtime 是 execution dependency，而不是产品身份。

```text
Trusted Controller
├── Qualified Local Runtime
└── Qualified Remote Runtime
```

无论 runtime 怎么换，都不能静默改变 canonical identity、verification、coverage、evidence、full/sampled identity 或 fail-closed semantics。

### Alternatives considered

1. 产品固定绑定本地模型；
2. 产品固定绑定 DeepSeek；
3. 任何 OpenAI-compatible provider 都直接视为等价。

### Why not

这些方案分别把“部署位置”“某个 provider”“API 兼容性”错误提升成产品语义。

### Trade-offs

- 每个新 runtime 需要独立 qualification；
- provider routing 不能随意 fallback；
- 但产品可以持续升级模型，而不用重写核心合同。

### Durable lesson

> **Capability isolation 与 model quality 是两个维度；先验证产品，再针对真实约束优化 runtime。**

---

## D07 — Coverage 必须拆开定义

### Problem

“Coverage = 100%”听起来很漂亮，但跨问题研究至少包含三个完全不同的问题：

1. 检索空间找了多广？
2. 已经选中的 source group 抓完整了吗？
3. 已经选进 corpus 的 source 真正全部分析了吗？

把它们混成一个数字，会制造虚假的确定性。

### Decision

P1 将 coverage 分成：

```text
Retrieval Coverage
Source Completeness
Analysis Coverage
```

#### Retrieval Coverage

当前 plan / query / provider 条件下探索了多广。通常不能宣称“全知乎 100%”。

#### Source Completeness

对于已经选中的 Question / Source-group，capture / pagination / verify 是否完整。

#### Analysis Coverage

selected verified corpus 中有多少 canonical source 真正进入分析。

P1 默认要求 selected corpus 的 Analysis Coverage = 100%，但不把这个结论推广成 Retrieval Coverage = 100%。

### Alternatives considered

1. 一个统一 coverage percentage；
2. 只报告抓取回答数；
3. 让最终模型自己写“已覆盖主要观点”。

### Why not

这些方案都把不同阶段的完整性问题混在一起。

### Trade-offs

- state 和 diagnostics 更复杂；
- 用户看到的指标需要解释；
- 但系统不会用一个漂亮数字掩盖不确定性。

### Durable lesson

> **所有“100%”都必须先回答：100% of what?**

---

# Additional Product Decisions

## Popularity is an anchor, not truth weight

高赞回答通常值得优先关注，因此 popularity 是合理的强 prior。但产品不把点赞数当成“正确度”。

一个高质量回答还可能体现：

- 可验证实例；
- 论文、网站或其他引用；
- 图片与数据；
- 代码与公式推导；
- 与主题真正相关的专业背景。

作者认证、职业/教育背景以及过去持续输出优质内容的惯性可以作为软信号，但不能形成简单的硬过滤器。低粉丝、无认证作者仍可能给出关键答案。

因此跨问题 selector 的冻结方向是：

```text
Question / Source-group Preservation
+ Popularity Anchor
+ Dense Semantic Relevance / Novelty
+ Optional Lightweight Redundancy Control
```

而不是：

```text
sort by voteupCount desc
→ take top N
```

---

## Data volume is not research quality

抓得更多只是能力，不自动等于更好的结果。

产品真正需要回答：

```text
找到什么？
选了什么？
为什么选？
抓完整了吗？
真正分析了多少？
结论能回到哪里？
```

这也是整个项目从 grabber 继续发展 verification、corpus pipeline 和 Research Orchestration 的核心原因。

---

# Decision Process

未来新增稳定设计规则时，优先使用以下问题判断是否值得沉淀：

1. 这是一次临时 workaround，还是以后会反复影响设计？
2. 它解决的是产品语义、安全边界、可靠性还是纯实现细节？
3. 是否有真实 dogfood / failure / review 证明这个问题存在？
4. 是否考虑过更简单方案？
5. 新规则是否会增加长期复杂度？

项目默认倾向：

```text
minimum correct architecture
→ clear boundary
→ testable contract
→ only add complexity when real evidence requires it
```

---

# Related Documents

- [`overview.md`](./overview.md)
- [`runtime-strategy.md`](./runtime-strategy.md)
- [`../product-design/zhihu-grabber-toolkit-product-design.md`](../product-design/zhihu-grabber-toolkit-product-design.md)
- [`../product-behavior-contract.md`](../product-behavior-contract.md)
- [`../specs/research-orchestration-scope.md`](../specs/research-orchestration-scope.md)
- [`../specs/p1-cross-question-deep-research.md`](../specs/p1-cross-question-deep-research.md)
