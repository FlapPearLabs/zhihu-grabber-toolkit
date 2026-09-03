# Zhihu Grabber Toolkit — 产品设计、关键决策与演进

> 本文是一份面向产品讨论、设计复盘和面试阅读的产品设计文档。
>
> 它解释“为什么这个产品一步步变成现在这样”，不是 Approved Spec，也不改变仓库中的产品合同。具体行为仍以 Applicable Approved Specs、`docs/product-behavior-contract.md`、`RULES.md` 和实际实现为准。

---

## 1. 产品起点：先把知乎回答稳定拿下来

Zhihu Grabber Toolkit 的起点并不复杂。

长期使用知乎时，一个很直接的需求是：

> 给定一个问题，能不能把当前可访问的回答完整、稳定地保存下来，方便归档、整理和后续分析？

最初的产品链路可以压缩成：

```text
Question
→ Answers
→ JSON / Markdown
```

这个阶段的核心价值就是**获取数据**：

- 能搜索到问题；
- 能抓回答；
- 能翻页；
- 能把结果保存下来。

如果产品只服务于偶尔手工导出，这已经足够。

但真正长期使用后，很快会发现：

> **“能搜索、能取内容”不等于“这些内容可以被可靠地使用”。**

这句话后来几乎决定了整个产品的演进方向。

---

## 2. 第一个问题：抓到了，什么时候才算“完成”？

### 2.1 用户看到的是结果，系统经历的是过程

一个抓取任务可能经历：

- 多页分页；
- 网络抖动；
- 中途退出；
- resume；
- metadata 获取失败；
- 部分回答写入成功；
- 输出文件存在但结构异常。

如果产品只用：

```text
exit code = 0
```

或者：

```text
answers.json exists
```

就告诉用户“已经完成”，这个“完成”其实非常模糊。

### 2.2 产品决策：Capture 与 Verification 分开

因此形成了一个很早、但后来持续影响整个系统的决定：

```text
captured != verified
```

抓取器负责把数据拿下来；独立 verifier 负责判断产物是否满足确定性验收条件。

```text
CAPTURE
   ↓
artifact on disk
   ↓
VERIFY
   ↓
verified artifact
```

这个决定表面看是工程设计，实际解决的是产品承诺问题：

> 当系统说“完成”时，到底愿意为这个词承担什么含义？

产品选择了更严格的一条路：**无法证明，就不把它包装成成功。**

这后来进一步变成：

```text
UNKNOWN != PASS
```

### 2.3 代价

这个决定让工作流多了一步，fail-closed 也意味着某些情况下系统会更“难用”。

但它换来了一个重要能力：后续 handoff、corpus pipeline 和 Research Orchestration 可以建立在一个清晰的 verified boundary 上，而不是继续猜测上游是否真的可靠。

---

## 3. 第二个问题：知乎回答不是一段纯文本

最初只关注正文，很快会遇到另一类损失：

一篇真正有价值的知乎回答经常不只靠文字表达。

它可能包含：

- 图片和截图；
- 论文或网站引用；
- 链接卡片；
- 引用 / 脚注；
- 代码；
- 公式推导；
- 问题描述和 topics；
- 与正文相关的热门评论。

如果只保留纯文本，很多回答“看起来还在”，但关键论证已经丢了。

因此产品目标从：

> 把文字抓下来

变成：

> **尽可能保留后续理解和研究真正需要的内容结构。**

这也是 rich-content fidelity 方向出现的原因。

### 产品思考

对高质量回答的判断也因此不能只看“字数”和“点赞”。一篇回答的价值可能来自：

- 具体例子；
- 数据来源；
- 图片证据；
- 论文引用；
- 可运行代码；
- 公式推导；
- 作者对该领域长期积累的专业背景。

换句话说，产品真正需要保存的不是“网页上的字符串”，而是**足够支持后续判断的证据结构**。

---

## 4. 第三个问题：人能读网页，不代表 Agent 能安全地读网页

随着使用对象从“人自己看”扩展到 AI Agent，一个新的产品问题出现了。

对于人类来说，知乎正文就是资料。

对于 Agent 来说，一段自然语言同时可能看起来像：

```text
information
```

也可能看起来像：

```text
instruction
```

例如正文中可能出现：

- “忽略之前的要求”；
- shell command；
- 外部链接；
- 伪造配置说明；
- 要求读取本地文件的文本。

因此：

```text
人能使用
≠
Agent 能正确、安全地消费
```

### 产品决策：外部内容只是数据

系统持续强化一个边界：

```text
External Content
!=
Agent Instruction
```

并把：

```text
Canonical Source
```

和：

```text
Agent-facing Projection
```

分开。

正文、链接和代码默认都是 untrusted external content；危险能力不能因为 prompt 里写了一句“不要调用工具”就被认为已经安全隔离。

### 为什么这是产品问题，而不只是安全问题

因为目标用户已经从：

> “下载内容的人”

变成：

> “把这个工具交给 Agent，让 Agent 自主完成研究的人”。

当使用主体改变，产品的“可用”定义也必须改变。

---

## 5. 第四个问题：抓取成功以后，数据太多了

抓取能力越可靠，越容易制造一个新的问题：

> 一个问题下面有几百条回答，接下来怎么办？

最直接的方案是：

```text
all answers
→ concatenate
→ one prompt
```

这个方案简单，但很快遇到四个问题：

1. 上下文可能装不下；
2. 长尾来源容易被模型忽略；
3. 无法证明每个 source 是否真正进入了分析；
4. 最终结论很难回到明确来源。

因此系统开始形成 corpus pipeline：

```text
Verified Corpus
→ Chunk
→ Map
→ Verify Coverage / Evidence
→ Reduce
→ Render
```

大型 corpus 再进入 hierarchical reduce。

### 关键变化：从“模型能读多少”转向“系统能证明什么”

这次演进最重要的不是分块算法本身，而是产品问题发生了变化。

以前问的是：

> 模型能不能看完？

后来变成：

> 系统能不能证明选中的 source 确实被处理过？

于是 source coverage 和 evidence lineage 逐渐成为一等概念。

---

## 6. 第五个问题：高赞回答非常有价值，但不能偷偷代替全量语料

### 6.1 为什么会自然想到高赞采样

知乎是一个强社交排序平台。

点赞数本身携带大量群体筛选信息。很多情况下，高赞回答确实：

- 表达更完整；
- 更容易抓住问题核心；
- 有更强的信息密度；
- 更值得快速阅读。

因此“只看前 X% 高赞回答”是一个非常合理的产品模式。

### 6.2 问题在于语义漂移

假设一个问题有 500 条回答，只分析前 50 条。

如果最终仍然写：

> “这个问题下大家主要认为……”

用户很可能理解成系统分析了整个回答集合。

于是形成一个非常重要的边界：

```text
SAMPLED ANALYSIS
!=
FULL-COVERAGE DIGEST
```

高赞视图不是低配版 full digest，而是**另一种明确的产品模式**。

### 6.3 产品决策

Sampled mode 必须披露：

- 总回答数；
- 选中多少；
- 请求比例；
- 实际覆盖率；
- 是否 full coverage。

如果用户要的是全量研究，系统不能因为成本高、模型慢或者 corpus 大，就静默切成 sampled mode。

### 产品思考

这里逐渐形成了一个更一般的原则：

> **系统可以优化成本，但不能偷偷修改用户以为自己得到的产品语义。**

---

## 7. 第六个问题：底层能力越来越完整，用户却越来越不会用

当 capture、verify、handoff、chunk、map、verify、reduce、render 都稳定以后，出现了一个反直觉问题：

> 能力越多，用户需要记住的步骤越多。

一个完整任务可能变成：

```text
search
→ select question
→ grab
→ verify-output
→ make-handoff
→ inspect corpus scale
→ choose digest mode
→ chunk
→ map
→ verify
→ reduce
→ render
```

用户真正的意图却可能只有一句：

> “研究一下这个话题在知乎上大家是怎么讨论的。”

这说明产品的问题已经不再是缺 primitive，而是：

```text
ORCHESTRATION_COMPLEXITY
```

### 产品决策：增加 Thin Orchestrator

Research Orchestration 的目标不是再造一套抓取器，而是把用户脑中的步骤搬进一个可恢复 controller。

```text
User Intent
→ Search
→ Select
→ Capture
→ Verify
→ Handoff
→ Analyze
→ Render
```

### 为什么坚持“薄”

已经被验证的能力应该继续由原 authority 负责：

- grabber 继续负责 capture；
- verify-output 继续负责 artifact validity；
- make-handoff 继续负责 deterministic handoff；
- corpus verification 继续负责 coverage/evidence gate。

Orchestrator 只负责：

```text
coordinate
sequence
decide next legal stage
persist state
resume
stop
```

这体现了一个很重要的产品/工程判断：

> **改善用户体验，不等于必须重写底层系统。**

---

## 8. 第七个问题：模型是不是产品的一部分？

在真实 dogfood 中，模型 runtime 带来了一个很有价值的反例。

本地 runtime 可以做到很强的 capability isolation：

- 零工具面；
- controller-owned IO；
- corpus 留在本地。

但模型质量可能不足以稳定完成大型语料任务。

更强的云模型又可能带来：

- 数据出网；
- API 成本；
- credential；
- provider availability。

于是一个关键认知变得清晰：

```text
Capability Isolation
!=
Model Quality
```

### 产品决策：Runtime is replaceable infrastructure

最终产品不应该叫：

> DeepSeek Zhihu Research

也不应该叫：

> LM Studio Zhihu Research

它仍然是 Zhihu Grabber Toolkit。

Runtime 只是需要 qualification 的执行依赖：

```text
Trusted Controller
├── Local Runtime
└── Remote Runtime
```

无论选谁，都不应该改变：

- captured / verified；
- canonical identity；
- evidence lineage；
- coverage；
- full / sampled mode；
- fail-closed semantics。

### 产品思考

这也改变了产品验证顺序：

> 不应该为了“必须本地运行”过早把整个产品卡在弱模型上，除非隐私、离线、成本或部署条件真的要求本地化。

先用足够强的 runtime 验证真实产品行为，再根据实际约束做本地化或成本优化，会更有效率。

---

## 9. 当前最大的产品升级：从一个问题到跨问题研究

Single-question Research Orchestration 解决的是：

```text
一个自然语言研究请求
→ 找到一个最相关知乎问题
→ 抓取这个问题
→ 分析它的回答
```

它已经把“抓取器”推进成一个可自动使用的研究工作流。

但真实研究问题通常不会完美映射到一个知乎 Question。

例如：

> AI 会如何影响程序员就业？

知乎上的相关讨论可能分散在：

```text
Q1：程序员会被 AI 替代吗？
Q2：AI 编程工具已经到什么水平？
Q3：初级程序员还有机会吗？
Q4：企业是否真的减少了软件岗位招聘？
```

如果系统只选其中一个问题，就会把“搜索最相关问题”误当成“研究这个主题”。

### P1 的真正问题

跨问题研究不是：

```text
grab Q1
+ grab Q2
+ grab Q3
```

真正的问题是：

> 如何从多个 Question / Source-group 构造一个有代表性、可验证、不会被大问题吞掉小观点的 research corpus？

因此 P1 引入：

```text
Research Plan
→ Multi-query / Multi-provider Retrieval
→ Candidate Pool
→ Source-group Preservation
→ Corpus Selection
→ Per-group Capture + Verify
→ Verified Research Corpus
→ Cross-source Analysis
```

---

## 10. 为什么不能只按点赞排序

这是 P1 产品方向里一个很重要的思考。

点赞数非常有价值，但它不能解决所有问题。

### 10.1 热门不等于真理

一个回答高赞可能说明：

- 更符合主流经验；
- 表达更好；
- 发布时间更早；
- 问题流量更大；
- 更容易被看见。

但它不能机械证明回答更正确。

### 10.2 专家信号有价值，但也不能做硬门槛

知乎很多答主具有认证：

- 企业工程师；
- 高校硕博；
- 医生、律师、研究人员等专业身份。

当问题与其专业领域高度相关时，这种背景显然值得作为质量信号。

同时也必须承认：

> 低粉丝、无认证的答主一样可能写出非常高质量的回答。

因此更合理的方向不是：

```text
认证作者 > 普通作者
```

而是把作者背景看成一个**软信号**，与内容本身的证据质量共同判断。

### 10.3 高质量回答通常还会留下“内容证据”

例如：

- 图片示例；
- 论文；
- 官方网站引用；
- 代码；
- 公式推导；
- 可核验的数据或案例。

这些信号未来可以帮助系统判断信息密度、专业度与研究价值，但不应该未经验证就变成一套复杂的硬评分系统。

### 当前冻结方向

P1 selector 当前更克制：

```text
Question / Source-group Preservation
+ Popularity Anchor
+ Dense Semantic Relevance / Novelty
+ Optional Lightweight Redundancy Control
```

也就是说：

- 不抛弃 popularity；
- 不把 popularity 升格成 truth；
- 不让一个超大热门问题静默吞掉其他相关 source-group；
- 用 semantic relevance / novelty 保护真正与研究主题相关、但不一定最热门的资料。

这是“先最小正确，再根据真实 evidence 增加复杂度”的体现。

---

## 11. Coverage：最容易被产品文案滥用的词

跨问题研究以后，一个危险表达会越来越常见：

> “覆盖率 100%。”

问题是：100% of what？

P1 因此明确拆成三层。

### 11.1 Retrieval Coverage — 找了多广？

```text
当前 Research Plan
+ 当前 Queries
+ 当前 Providers
```

共同定义了当前检索边界。

系统可以说：

> 当前计划中的 provider / query 已经按策略充分尝试，新增信息边际下降。

但不能轻易说：

> 已经找到了知乎上关于这个主题的全部资料。

### 11.2 Source Completeness — 选中的资料抓完整了吗？

当一个 Question / Source-group 已经被选中后，才进入另外一个问题：

- pagination 完整吗？
- capture 成功吗？
- verify 通过吗？
- 是否 partial / failed？

这是 source completeness。

### 11.3 Analysis Coverage — 选中的资料真的全部分析了吗？

第三个问题是：

> selected verified corpus 里已经存在的 source，有多少真正进入了 downstream analysis？

P1 默认要求 selected corpus 的 Analysis Coverage = 100%。

但这个 100% 不能向上偷换成 Retrieval Coverage = 100%。

### 产品意义

这三个概念让最终结果可以更诚实地告诉用户：

```text
我找了多广
我抓得多完整
我真正分析了多少
```

而不是用一个“100%”掩盖不同阶段的不确定性。

---

## 12. 产品路线：每一步都来自上一步成功后的新问题

Zhihu Grabber Toolkit 的路线不是先规划一个巨大平台，再逐个填功能。

它更像一条不断暴露新瓶颈的链：

```text
Grab
↓
“中断和分页怎么办？”
↓
Reliable Capture
↓
“网页不是纯文本。”
↓
Rich Content
↓
“抓到就算完成吗？”
↓
Verification
↓
“几百条回答怎么处理？”
↓
Corpus Anthology
↓
“只看高赞是不是全量？”
↓
Full / Sampled Identity
↓
“用户为什么要理解这么多 CLI？”
↓
Research Orchestration
↓
“真实研究为什么只能选一个 Question？”
↓
Cross-Question Deep Research
```

这是这个项目最重要的产品演进方式：

> **不是提前发明复杂度，而是让真实使用不断告诉产品下一层问题在哪里。**

---

## 13. 当前产品边界

Zhihu Grabber Toolkit 不是：

- 全站爬虫；
- 知乎搜索引擎替代品；
- 通用 Deep Research 平台；
- 知乎官方 API 的替代；
- 自动规避风控的 scraping framework；
- 绑定某一个大模型的 AI 应用。

当前产品更准确的定义是：

> **一套让开发者和 AI Agent 能够稳定抓取、验证、组织并进一步分析知乎公开可访问内容的工具链。**

Research 能力建立在这个抓取工具链之上，而不是覆盖它的产品身份。

---

## 14. 当前仍然有意保留的开放问题

### 14.1 什么才是“高质量回答”？

Popularity、作者背景、引用质量、信息密度、语义相关性都可能提供信号，但不应该在证据不足时过早冻结成一个复杂 scoring model。

### 14.2 跨问题研究应该找多广？

Retrieval saturation 可以描述“当前策略下边际收益下降”，但它不是全站 completeness proof。

### 14.3 成本和覆盖如何权衡？

默认 full analysis 能提供更强保证，但真正产品化以后，用户可能有成本、速度、实时性等不同目标。任何优化都必须保持 mode identity 和 disclosure，而不能静默降低覆盖。

### 14.4 专业作者信号如何使用？

认证和专业背景可以增强某些问题下的 prior，但需要避免权威偏见，也必须给无认证高质量内容留下进入 corpus 的路径。

这些问题适合通过真实研究任务继续 dogfood，而不是在 Spec 里提前设计完所有答案。

---

## 15. 产品与工程共同形成的七个长期决策

| 决策 | 解决的问题 |
|---|---|
| `captured != verified` | “完成”必须有明确验收语义。 |
| Controller owns truth; Model owns semantics | 不让概率模型证明自己的过程正确。 |
| Canonical data / Derived view 分离 | 摘要和渲染不能覆盖原始事实。 |
| Full coverage ≠ Sampled analysis | 成本优化不能静默改变产品语义。 |
| Thin Orchestrator | 改善 UX 不重写已经可靠的 authority。 |
| Runtime is replaceable infrastructure | 模型选择不是产品身份。 |
| Retrieval / Source / Analysis Coverage 分离 | 所有“100%”必须说明覆盖对象。 |

详细工程背景见 [`../architecture/key-decisions.md`](../architecture/key-decisions.md)。

---

## 16. 设计方法：先收敛，再扩展

整个项目逐渐形成了一套很克制的设计习惯：

```text
真实问题
→ 最小正确边界
→ 可测试合同
→ dogfood
→ 找反例
→ 再增加复杂度
```

而不是：

```text
看到未来可能需要
→ 先做抽象
→ 先做通用框架
→ 等需求出现
```

这也是为什么 P1 没有直接引入 MMR、xQuAD、DPP、复杂 learning-to-rank 或 Claim Graph 等所有可能技术，而是先冻结最小 selector baseline，再让真实 evidence 决定下一步。

产品层面的对应原则是：

> **用户真正遇到的问题，优先级高于架构想象中的未来。**

---

## 17. 结语

Zhihu Grabber Toolkit 最初解决的是一个很具体的问题：

> 把知乎回答稳定抓下来。

它后来不断增加 verification、rich content、corpus pipeline、Agent safety 和 Research Orchestration，并不是因为产品想变成“万能 AI 研究平台”，而是因为每一次更可靠的抓取都会暴露下一层真实问题。

今天这个项目仍然可以只当一个知乎抓取工具使用。

但如果把它交给 Agent、让它处理数百条回答、要求结果可验证、再把研究范围扩展到多个 Question，系统已经有一条清晰的演进路径：

```text
获取内容
→ 证明内容可用
→ 组织大量内容
→ 证明分析覆盖
→ 自动编排
→ 跨来源研究
```

这条路径比“加入更多 AI 功能”更重要：它持续在回答同一个产品问题——

> **怎样让抓下来的信息不仅存在，而且值得被相信、被使用、被继续研究。**
