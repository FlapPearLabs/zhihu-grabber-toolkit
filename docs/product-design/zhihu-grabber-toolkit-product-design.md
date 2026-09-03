# Zhihu Grabber Toolkit：产品设计、关键决策与演进

> 面向产品 / AI 产品岗位的可读版设计文档。
>
> 这不是 Spec 的替代品，也不是实现细节汇总。它记录的是：这个产品为什么从“抓知乎回答”一步步演化到现在，过程中暴露了什么真实问题、做了哪些关键取舍、为什么没有选择更简单但不可靠的方案。

---

## 1. 产品起点：先把知乎回答稳定拿下来

Zhihu Grabber Toolkit 最初解决的是一个很直接的问题：

> 给定一个知乎问题，能不能把当前可访问回答稳定抓下来，保存成后续可以继续处理的数据？

最早的价值链很简单：

```text
Question
→ Answers
→ JSON / Markdown
```

这一阶段产品的核心价值不是“AI 研究”，而是**可靠的数据获取**。

但一旦把工具交给真实用户和 Agent 使用，问题很快就从“能不能抓”变成了“抓到的东西到底能不能信”。

---

## 2. 第一次转折：抓到不等于完成

### 2.1 真实问题

抓取脚本最容易犯的产品错误，是把“命令退出码为 0”当成“任务完成”。

真实场景里会出现：

- 分页是否真的走完；
- 中途断开后是否可以继续；
- 页面显示回答数和实际可访问回答数为什么不一致；
- metadata 失败是否应该让正文抓取失败；
- 什么时候 Agent 才能向用户说“已经完成”。

这说明一个产品状态必须拆开：

```text
captured
!=
verified
```

### 2.2 产品决策

抓取阶段只负责“把数据获取并落盘”。

验证阶段由独立的 deterministic verifier 判断这批数据是否满足后续消费合同。

Agent 不能因为“看起来差不多”就自己授予成功。

### 2.3 为什么这样做

这是一个看起来增加步骤、实际上降低用户不确定性的设计。

对于普通脚本，用户可能接受“尽力而为”；但当数据要继续进入 AI 分析时，一次不明确的抓取完成状态会在后面被放大成一个看起来很完整、实际缺失来源的总结。

因此，产品选择把不确定性暴露出来，而不是隐藏掉。

---

## 3. 第二次转折：知乎回答不是纯文本

### 3.1 真实问题

如果只保存一段 Markdown 文本，会丢掉很多对后续理解有价值的信息：

- 问题描述与 topics；
- 图片；
- 外链；
- 引用 / 脚注；
- 代码块；
- 回答的点赞、评论、时间信息；
- 某些场景下的热门评论。

所以“抓回答”不能只理解为抓正文字符串。

### 3.2 产品决策

逐步把有价值的内容结构保留下来，同时保持 canonical raw data 与人类阅读视图分离。

```text
Canonical Data
├── raw answer content
├── metadata
├── rich-content structure
└── source identity

Derived View
├── Markdown rendering
├── model projection
└── research synthesis
```

### 3.3 关键取舍

产品没有走“复制整个网页”的方向，也没有无限扩张成通用浏览器归档器。

保留的是对知乎回答理解和研究真正有价值的结构；不做视频、完整作者档案、全评论树、自动下载所有媒体等无边界扩张。

这体现了一个持续存在的产品原则：

> **功能扩展必须服务于研究与内容理解，不因为“技术上能抓”就把所有东西都抓下来。**

---

## 4. 第三次转折：目标用户从“人”变成“人 + Agent”

### 4.1 新问题不是 UI，而是信任边界

当抓下来的知乎内容开始直接交给 AI Agent 和 LLM，产品面对了一个普通数据工具不需要处理的问题：

> 用户数据里的自然语言，可能被模型误认为操作指令。

例如正文里的：

- “忽略之前指令”；
- 外链；
- 代码；
- 伪装成操作步骤的文本。

如果 Agent 自动访问、执行或信任这些内容，抓取工具就从“数据输入”变成了“潜在指令入口”。

### 4.2 产品决策

把用户内容视为 untrusted external content，并建立两类边界：

```text
User Data != Agent Instruction
Canonical Source != Model Projection
```

模型看到的是经过控制器构造和限制的 projection，而不是获得对原始环境的自由控制权。

### 4.3 更重要的一条原则

项目逐步形成：

```text
Controller owns truth and authority.
Model owns semantics.
```

模型可以做：

- 摘要；
- 分类；
- 提炼观点；
- synthesis。

但模型不能决定：

- 哪个 sourceId 才是真的；
- 哪些来源算已经覆盖；
- verifier 是否通过；
- 是否可以访问文件或网络；
- sampled 分析能否冒充 full coverage。

### 4.4 产品思考

这里的核心不是“防 prompt injection”这一个技术点，而是：

> **模型可以负责质量，不应该负责完成事实。**

用户可以接受一段总结不够精彩，但不能接受模型漏看 40% 的资料以后仍然告诉用户“已经完整分析”。

---

## 5. 第四次转折：抓得越成功，数据反而越难用

### 5.1 新问题来自规模

当一个问题只有十几条回答时，把全部文本交给模型并不困难。

当一个问题出现：

```text
79 answers
183 answers
318 answers
甚至 500+ answers
```

“全部放进 prompt”开始失效。

此时产品遇到三个互相冲突的目标：

1. 尽量不要漏观点；
2. 不要突破上下文 / 成本限制；
3. 最终仍然要知道到底分析了哪些来源。

### 5.2 曾经最诱人的方案：只看高赞

从产品角度看，高赞非常有价值：

- 是一种强 popularity signal；
- 高价值答主往往有持续输出高质量内容的惯性；
- 认证背景、专业身份、历史回答质量都可以提高优先级。

用户此前对此有很明确的判断：

> 高价值答主和高赞回答值得更高权重，但低粉、无认证来源仍然可能包含高质量观点，不能因为缺少身份信号就直接消失。

因此，“只看前 10% 高赞”适合成为一种**显式选择的快速分析模式**，但不能成为默认的“完整研究”。

### 5.3 产品决策：Full 和 Sampled 必须分开

```text
FULL-COVERAGE DIGEST
!=
TOP-PERCENT / SAMPLED ANALYSIS
```

如果用户明确说：

- 只看高赞；
- 快速看看；
- 前 X%；

那么系统可以做 deterministic selection，并告诉用户：

- total；
- selected；
- requested percent；
- actual coverage；
- 是否 full coverage。

但默认 full digest 不能在背后偷偷缩水。

### 5.4 大语料的正式解法

产品最终形成：

```text
Canonical Corpus
→ Chunk
→ Map
→ Coverage / Evidence Verification
→ Reduce
→ Final Result
```

更大语料继续使用 hierarchical reduce，在不一次吞下全部 map 结果的情况下继续保持来源 lineage。

这一步让项目从“抓取工具”自然进入“大语料处理工具链”。

---

## 6. 第五次转折：底层越成熟，用户越不应该理解底层

### 6.1 新的用户体验问题

当 primitive 逐步完整以后，一次研究可能要求：

```text
search
→ select
→ grab
→ verify-output
→ make-handoff
→ chunk
→ map
→ verify
→ reduce
→ render
```

从工程角度看，这是“模块化成功”；从产品角度看，这是“用户被迫理解内部实现”。

用户真正想做的是：

> “研究一下这个知乎话题。”

而不是：

> “请先执行第一个脚本，再检查 JSON，再执行第六个脚本。”

### 6.2 产品决策：加入 Thin Research Orchestrator

Orchestrator 负责把已有能力串起来：

```text
SEARCH
→ SELECT
→ CAPTURE
→ VERIFY
→ HANDOFF
→ ANALYZE
→ RENDER
```

但它不重新实现抓取、verifier、handoff 和 corpus pipeline。

### 6.3 为什么不做“万能 Agent”

因为这个阶段缺的不是新的智能能力，而是 orchestration complexity 的转移。

所以决定：

```text
ORCHESTRATE_EXISTING_PRIMITIVES
DO_NOT_REIMPLEMENT_EXISTING_AUTHORITIES
```

产品体验变简单，但底层可信边界不变。

### 6.4 用户交互的目标

理想状态变成：

1. 用户输入研究主题；
2. 只有候选存在实质歧义时才进行一次 clarification；
3. 系统自动完成后续 pipeline；
4. 关键选择、失败和覆盖情况仍然对用户可见。

这避免了两种极端：

- 每次都逼用户做机械确认；
- 为了“全自动”而静默猜错研究对象。

---

## 7. 第六次转折：本地模型不是产品本身

### 7.1 一开始的合理关注

当模型处理知乎语料时，本地运行天然有吸引力：

- 数据不出机器；
- 没有按请求收费；
- 可以离线；
- 能做更强的 capability isolation。

因此项目认真验证过本地 tool-less runtime。

### 7.2 Dogfood 带来的新认识

真实大语料 workload 暴露：

```text
Capability Isolation
!=
Model Quality
```

一个 runtime 可以安全边界完全正确，但模型本身在长输出、结构化输出、复杂 synthesis 上不够稳定。

如果为了“必须本地”而让较弱模型成为产品验证 blocker，团队会开始围绕模型缺陷设计大量 workaround，反而看不清真正的产品逻辑是否成立。

### 7.3 产品决策

Runtime 被降级为 replaceable infrastructure：

```text
Trusted Controller
├── local qualified runtime
└── remote qualified runtime
```

产品不绑定 DeepSeek，也不绑定 LM Studio。

选择顺序变成：

1. 先用足够强的 runtime 验证真实产品行为；
2. 在真实 workload 上测质量、延迟、成本和可靠性；
3. 只有存在隐私、成本、离线、延迟或部署约束时，再把 local optimization 变成 blocking requirement。

### 7.4 这里的产品思考

> **不要提前优化一个还没有证明成立的产品。**

这条原则后来也影响了其他设计：避免为了极低概率未来需求提前堆抽象；只有真实风险和当前需求证明必要时才增加复杂度。

---

## 8. 当前最大的产品升级：从一个问题走向多个问题

### 8.1 Single-question Research 的边界

当前已实现的 Research Orchestration 能够：

```text
自然语言主题
→ 搜索多个候选问题
→ 选择最相关的一个
→ 抓取并验证这个问题
→ 分析其回答语料
```

这已经显著降低了用户使用成本。

但真实研究问题往往不会完美映射成知乎上的一个 Question。

例如：

> “AI 会如何影响程序员就业？”

可能分散在：

```text
Q1：程序员会被 AI 替代吗？
Q2：AI 编程工具现在到底到了什么水平？
Q3：初级程序员未来还有机会吗？
Q4：企业是否真的在减少初级开发岗位？
```

如果只选一个问题，研究结果会天然受到这个 Question framing 的限制。

### 8.2 错误的升级方式：多抓几个问题

最容易想到的是：

```text
Q1 grab
+ Q2 grab
+ Q3 grab
→ 全部拼起来
```

但这没有解决：

- 哪些 Question 真正相关；
- 一个超大 Question 会不会吞掉小 Question；
- 重复观点怎么办；
- 高赞和专业身份应该如何参与排序；
- 哪些来源最终真的进入分析；
- 怎样证明“没漏掉 selected corpus 中的某一组”。

因此跨问题研究不是简单的 batch capture，而是新的 corpus construction 问题。

---

## 9. P1：Cross-Question Deep Research

### 9.1 产品目标

P1 的目标是：

> 从多个 Question / Source-group 构造一个可验证的 Selected Research Corpus，并对这个 selected corpus 做完整分析，再进行跨来源 synthesis。

概念流程：

```text
User Request
→ Research Plan
→ Multi-query / Multi-provider Retrieval
→ Candidate Pool
→ Selected Source Groups
→ Capture + Verify per Group
→ Research Corpus Selection
→ 100% Analysis Coverage of Selected Corpus
→ Claim / Aspect Representation
→ Cross-source Synthesis
```

### 9.2 为什么不是“按点赞排序”

点赞是重要信号，但不应该变成唯一选择器。

最终冻结的第一版 selector 方向是：

```text
Question / Source-group Preservation
+ Popularity Anchor
+ Dense Semantic Relevance / Novelty
+ Optional Lightweight Redundancy Control
```

背后的产品判断是：

- 高赞应该提高重要性，但不是 truth score；
- 专业身份 / 高价值答主可以成为 soft signal，但不能成为绝对准入；
- relevant minority group 不能被大组静默饿死；
- 重复高赞观点不应该无限挤占 corpus；
- 低热度但带来新 aspect / contradiction 的来源仍然可能非常重要。

这与用户最初讨论“精选”时的思考是一致的：**质量判断应该结合话题价值、回答内容、答主专业性和历史质量惯性，但不能把低粉或无认证直接当成低质量。**

---

## 10. 为什么 Coverage 必须拆成三层

跨问题以后，“Coverage = 100%”已经不够表达产品事实。

### 10.1 Retrieval Coverage — 找得多广

它回答：

> 在当前 research plan、query 和 provider 边界下，我们探索了多少研究空间？

它通常不可能证明“知乎全站 100%”。

### 10.2 Source Completeness — 选中的组抓完整了吗

它回答：

> 对已经选中的 Question / Source-group，capture、pagination、verify 是否完整？

### 10.3 Analysis Coverage — 选中的资料真的都分析了吗

它回答：

> Selected Verified Research Corpus 中的 canonical sources，有多少真正进入分析？

P1 默认要求：

```text
Analysis Coverage = 100%
of the selected verified corpus
```

这不等于：

```text
Retrieval Coverage = 100% of Zhihu
```

### 10.4 产品价值

这种拆分看起来更复杂，但它让用户真正知道“100%”是什么意思。

它也避免了 AI Research 产品里非常常见的一种错觉：

> 搜索了几个结果、读了几篇资料，然后用一个漂亮的进度条暗示“研究完整度 100%”。

---

## 11. 八个核心产品 / 工程决策

| 决策 | 产品意义 |
|---|---|
| `captured != verified` | 不把“脚本跑完”伪装成“数据可信” |
| Controller owns truth; Model owns semantics | 模型负责质量，不负责证明自己完成 |
| Canonical 与 Derived View 分离 | AI 加工结果永远可以回溯原始来源 |
| Full != Sampled | 快速分析不能冒充完整研究 |
| Thin Orchestrator | 简化用户体验，但不破坏已有可靠 authority |
| Runtime replaceable | 产品能力不绑定模型供应商或执行位置 |
| 三层 Coverage | 把“找得广、抓得全、分析得全”分开 |
| Simple / Mechanical / Verifiable first | 复杂自动化必须由真实问题证明必要性 |

详细 trade-off 见 [`../architecture/key-decisions.md`](../architecture/key-decisions.md)。

---

## 12. AI-assisted Engineering 也是产品的一部分

这个项目的另一个长期实验，是如何让 AI Agent 参与一个持续数周、跨多个 Spec / Ticket 的真实软件项目，而不是只做一次性代码生成。

用户对此有一个很明确的工程要求：

> 静态检查、LSP、typecheck、lint 这些能机械发现的问题先解决；宝贵的模型分析应该处理困难问题，而不是被低级错误拖住。

因此仓库逐步形成 repository-driven governance：

```text
Issue / Spec defines contract
        ↓
/implement
        ↓
contract-driven TDD
        ↓
static / mechanical verification
        ↓
dynamic tests
        ↓
adversarial self-review
        ↓
independent exact-SHA review
```

并明确：

- `tests green != task complete`；
- self-review != independent review；
- reviewer PASS 只绑定 exact SHA；
- 同一个 branch 同时只有一个 active writer；
- conversation memory 不是真实状态源，repo / GitHub 才是。

这不是为了让流程显得复杂，而是为了让模型可以更换、会话可以中断、Agent 可以并行，项目仍然能够恢复事实和责任边界。

---

## 13. 明确的 Non-goals

Zhihu Grabber Toolkit 不是：

- 通用搜索引擎；
- 知乎全站镜像；
- CAPTCHA / 权限控制绕过工具；
- 代理池 / 高频 scraping 框架；
- 通用网页浏览 Agent；
- 绑定 DeepSeek 或某个 LLM 的 AI 应用；
- 一个声称已经解决“全网 Deep Research”的产品。

项目始终保持低频、权限边界和 fail-closed，优先解决“当前可访问知乎内容如何可靠获取和使用”。

---

## 14. 产品路线：能力为什么一步步长成现在这样

```text
知乎回答抓取
      ↓
Reliable Capture
      ↓
Rich Content Fidelity
      ↓
Deterministic Verification
      ↓
Agent-safe Canonical Corpus
      ↓
Large-Corpus Processing
      ↓
Single-Question Research Orchestration
      ↓
Cross-Question Deep Research
```

这条路线不是一开始设计出来的“大架构”。

它更像一个连续的产品推导：

```text
每解决一个真实问题
→ 才暴露下一个真正值得解决的问题
```

这也是整个项目最重要的思考方式。

---

## 15. 当前状态与下一步

### 已稳定存在

- 搜索与单题 / 批量抓取；
- 分页、断点续传；
- rich-content structured output；
- deterministic verifier；
- verified handoff；
- corpus chunk / map / coverage / evidence pipeline；
- full / hierarchical digest；
- explicit top-percent sampled analysis；
- single-question Research Orchestration；
- qualified local / remote tool-less runtime strategy。

### 当前演进方向

- P1 Cross-Question Deep Research；
- 多 Question / Source-group corpus construction；
- retrieval / source / analysis coverage accounting；
- relevance + popularity + preservation + novelty 的 selector；
- Question / Source-group → Claim / Aspect → synthesis。

### 保持克制的未来

更复杂的 selector、自动 re-query、escape probe、学习排序或更复杂的 research loop 只有在 P1 基础能力和真实 dogfood 证明需要时才引入。

不会因为“以后可能有用”就提前把所有研究算法塞进第一版。

---

## 16. 这份项目最想证明什么

如果只看功能列表，这个项目可以被概括成：

> 一个知乎抓取、验证和大语料分析工具。

但真正长期沉淀下来的，是三种能力：

### 产品判断

能区分“用户真正的问题”与“实现表面的方便”，例如：

- 用户要的是研究，不是十条 CLI；
- 高赞重要，但高赞不等于全量；
- 100% coverage 必须先定义“什么的 100%”；
- 本地部署是约束，不应该先于产品价值本身。

### 系统边界

能把概率能力和确定性 authority 分开：

```text
Model can reason.
Controller must prove.
```

### AI 工程

能让 AI Agent 参与持续工程，同时不把代码质量、review authority 和项目状态交给一次聊天上下文。

---

## 17. Related Documents

- [`Architecture Overview`](../architecture/overview.md)
- [`Key Engineering Decisions`](../architecture/key-decisions.md)
- [`Runtime Strategy`](../architecture/runtime-strategy.md)
- [`Product Behavior Contract`](../product-behavior-contract.md)
- [`Research Orchestration Spec`](../specs/research-orchestration-scope.md)
- [`P1 Cross-Question Deep Research`](../specs/p1-cross-question-deep-research.md)
- [`AGENTS.md`](../../AGENTS.md)
- [`RULES.md`](../../RULES.md)
