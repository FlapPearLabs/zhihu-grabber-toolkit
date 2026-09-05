# Key Engineering Decisions

> 这不是一组“最佳实践清单”，而是 Zhihu Grabber Toolkit 在真实 dogfood、长语料处理和 Agent 使用过程中逐步形成的关键取舍。
>
> 记录方式：**问题 → 决策 → 为什么 → 代价 → 演进**。

## D01 — `captured != verified`

### 问题

最早的抓取工具很容易把“请求成功、文件已经写出来”理解成“任务完成”。但真实使用里，分页、回答数变化、中断恢复、metadata 缺失等都会让“已经抓到”与“可以可信使用”出现差异。

### 决策

```text
Capture authority != Verification authority
```

抓取阶段只产生 `captured` 状态；只有确定性的 `verify-output` 才能授予 verified 路径。

### 为什么

用户真正关心的不是“脚本有没有跑完”，而是“这批数据是否满足后续处理的合同”。让 Agent 或模型凭自身判断宣称完成，会把一个可机械检查的问题重新变成概率判断。

### 代价

- 多了一道显式 gate；
- CLI 流程比单脚本复杂；
- 出现 mismatch 时必须面对真实不确定性，而不是简单输出 success。

### 演进

这个决策后来成为 Research Orchestration 的基础：orchestrator 可以协调流程，但不能自己重新定义 valid，也不能手工伪造 verified handoff。

---

## D02 — Controller owns truth; Model owns semantics

### 问题

当系统开始用 LLM 做长语料分析时，一个危险的捷径是让模型同时输出摘要、`sourceId`、coverage 结论和 evidence mapping。这样实现很快，但模型既生成语义又证明自己看过哪些资料，事实边界会变得不可审计。

### 决策

```text
Controller owns truth and authority.
Model owns semantics.
```

Controller 掌握 canonical source identity、coverage、evidence lineage、IO、结构化验证和 fail-closed；模型只负责摘要、归纳、分类和 synthesis。

### 为什么

用户愿意接受“模型可能总结得不够好”，但不能接受“模型漏看了一半资料却声称自己全部看过”。

这也是项目的一条产品判断：**概率能力可以负责内容质量，不能负责完成事实。**

### 代价

- controller 需要保存更多结构化状态；
- map/reduce pipeline 不能只依赖一个漂亮 prompt；
- source identity、coverage 和 evidence 必须有额外实现与测试。

### 演进

真实审查中，模型生成的 source identity 被逐步移出模型输出合同，最终形成 controller-owned identity/lineage boundary。

---

## D03 — Canonical Data 与 Derived View 分离

### 问题

知乎回答需要转成 Markdown、projection、摘要和研究结果才能方便人或模型消费。但一旦把“处理后的文本”当成新的事实源，就很难区分原文、渲染损失和模型改写。

### 决策

`answers.json` 中的 canonical raw content 保持事实来源；Markdown、projection、map artifact、最终 synthesis 都是 derived view。

```text
Canonical source
├── human-readable rendering
├── model projection
├── semantic map
└── final synthesis
```

### 为什么

这让任何后续结果都可以回到原始回答核对，也避免模型加工结果污染下一轮分析。

### 代价

- 需要维护 canonical schema 与不同 view；
- rich-content renderer 不能直接“顺手修正文”；
- downstream 必须尊重 source identity。

---

## D04 — Full Coverage 与 Sampled Analysis 是两个产品模式

### 问题

抓到几百条回答之后，“只看高赞”非常诱人：成本低、速度快、往往也更好读。但它不能被包装成“整个问题的全量总结”。

### 决策

明确区分：

```text
FULL-COVERAGE DIGEST
!=
TOP-PERCENT / SAMPLED ANALYSIS
```

只有用户明确表达“只看高赞 / 前 X% / 快速看看”等意图时，才进入 sampled path，并披露 selected / total / actual coverage。

### 为什么

高赞代表平台反馈和讨论中心性，但不天然等于全部观点，也不天然等于“真理权重”。

用户之前的一个重要判断贯穿了这个设计：**优质、高价值来源应该更有权重，但不能因此假装低热度来源不存在。**

### 代价

- pipeline 需要维护 mode identity；
- full digest 成本更高；
- UI/结果必须解释 coverage，而不是只输出一篇看起来流畅的总结。

---

## D05 — Thin Orchestrator：编排已有 primitive，不重造 authority

### 问题

当 search、grab、verify、handoff、chunk、map、reduce 都成熟后，用户反而需要理解越来越多命令。

最直接的方案是重写一个“万能 Research Agent”，把所有逻辑塞进一个入口。但这样会复制已经验证过的抓取、验证和 corpus 规则。

### 决策

Research Orchestrator 只负责：

- sequence；
- inspect machine-readable results；
- decide next legal stage；
- persist/resume state；
- expose progress；
- stop on deterministic failure。

它不重新实现 capture、verifier、handoff 或 corpus verification。

### 为什么

这是一个产品体验问题，不是底层能力缺失问题。

用户的目标应该从：

```text
“请依次运行八条 CLI”
```

变成：

```text
“研究一下这个主题”
```

但“更简单的用户体验”不应该以牺牲已经可靠的底层 authority 为代价。

### 代价

- orchestrator 要处理多个 primitive 的状态与失败；
- 一些接口必须保持机器可读；
- 不能用一个大模型 prompt 快速掩盖 orchestration complexity。

---

## D06 — Runtime 是可替换基础设施，不是产品身份

### 问题

早期 local runtime 的 capability isolation 很重要，但真实 dogfood 暴露了另一个事实：

```text
capability isolation != model quality
```

一个 runtime 可以非常安全，却因为模型质量、输出稳定性或上下文能力不足而不适合某个 workload。

### 决策

Runtime 负责执行语义能力，但产品合同不绑定特定模型或 provider。

```text
Trusted Controller
├── qualified local runtime
└── qualified remote runtime
```

更换 runtime 不得静默改变 verification、canonical identity、coverage、evidence lineage、full/sampled identity 和 fail-closed semantics。

### 为什么

这里的产品思考是：**先验证真正的用户价值，再根据隐私、成本、延迟和部署约束优化 runtime；不要让一个较弱的本地模型提前成为整个产品验证的 blocker。**

### 代价

- runtime 需要单独 qualification；
- local / cloud 各自有隐私、成本、质量和运维 trade-off；
- 不能把“OpenAI-compatible”简单等价成“已经支持”。

---

## D07 — 跨问题研究必须拆分三种 Coverage

### 问题

Single-question research 可以清楚地说“这个问题下哪些回答被抓取、哪些被分析”。跨多个 Question / Source-group 后，“coverage 100%”很容易变成没有语义的营销数字。

真实研究还会遇到一个更难的问题：大问题、高赞回答、认证答主都应该成为重要信号，但不能让它们把小而相关的来源静默吞掉。

### 决策

P1 将 coverage 明确拆成：

1. **Retrieval Coverage** — 当前 research plan、query、provider 边界下探索了多少研究空间；
2. **Source Completeness** — 已选 source group 的 capture / pagination / verify 是否完整；
3. **Analysis Coverage** — selected verified corpus 中有多少 canonical source 真正进入分析。

默认路径要求 selected verified corpus 的 Analysis Coverage = 100%，但不会宣称“全知乎 Retrieval Coverage = 100%”。

### 为什么

这反映了项目从“抓数据”走向“做研究”以后最重要的产品约束：

> **搜索得广、抓得完整、分析得完整，是三件不同的事。**

用户此前对精选与高质量回答的思考也影响了这一方向：认证、专业背景、历史高质量输出、赞同等可以作为 soft signal，但不能简单变成排除低粉或少数观点的硬门槛。

### 代价

- state 和 diagnostics 更复杂；
- 需要 per-group accounting；
- selector 必须同时考虑 relevance、popularity、group preservation、novelty/redundancy，而不能只按点赞排序。

---

## D08 — 简单、机械、可验证优先于“聪明的自动化”

### 问题

Agent 与 LLM 系统非常容易为了未来扩展提前引入复杂 abstraction、自动 fallback、隐藏状态和多层 routing。短期看起来“智能”，长期却难以知道是谁改变了事实。

### 决策

项目持续偏好：

- 最小正确架构；
- 明确 owner；
- fail-closed；
- frozen decision 机械消费；
- counterexample test；
- static verification 先于 model review；
- exact-SHA independent review。

### 为什么

用户对工程过程的长期要求很明确：**宝贵的模型分析应该处理困难问题，而不是被低级语法、类型、LSP 或明显契约错误拖住。**

因此 repository governance 逐步形成了：

```text
/implement
→ contract-driven TDD
→ static / mechanical verification
→ dynamic tests
→ adversarial self-review
→ independent exact-SHA review
```

### 代价

- 开发流程比“模型直接改完就 merge”慢一些；
- 每个 PASS 都要绑定证据和 exact SHA；
- repair 后必须重新 review。

但收益是 Agent 可以换、会话可以丢、runtime 可以变，仓库仍能恢复真实状态。

---

## D09 — ResearchCorpusManifest 是派生组合产物，不是第二 canonical store

### 问题

Multi-group composition 天然诱人"顺手"把各组回答内容复制进一份研究级 manifest：下游分析、
渲染、resume 都会变得"方便"。但一旦 manifest 持有内容，它就会与各组 `answers.json` 漂移，
"哪个才是事实"变成不可审计的问题。

### 决策

`ResearchCorpusManifest` 只从 valid `VerifiedGroupRefs[]` + selector output **确定性派生**，
记录 selected source composition / group provenance / dependent hashes；canonical content
永远留在各组 `answers.json`，verified 状态永远归 verifier / handoff authority。

```text
manifest = derived composition artifact
canonical content = per-group answers.json
verified status   = verify-output authority
```

### 为什么

这是 D03（canonical 与 derived view 分离）在跨问题研究层的直接延伸：组合层一旦变成第二
事实源，stale 传播、coverage 对账和 evidence lineage 全部失效。

### 代价

- manifest 必须可确定性重建并携带 dependent hashes；
- 任何下游都不能从 manifest"抄近路"拿内容；
- stale 组必须连带失效所有依赖它的 corpus/analysis artifact。

### 演进

来源：P1 Spec §6.1 / §11（no second canonical content store）；T09 Issue #41 验收项
（manifest 非第二 canonical store）。

---

## D10 — Analyzed source-set identity 唯一写入者 = P1-T13

### 问题

Coverage 数字在多个 stage "顺手重算"是渐进腐蚀的开端：T14 聚合时算一遍、T15 集成时再算
一遍，两套数字一旦不同，"100% Analysis Coverage"就失去可审计性。

### 决策

per-group mapped/analyzed source-set identity 与 controller-derived aggregate identity
由 **P1-T13 唯一写入**（经 T07 hooks 进入 CoverageState）；T14 只消费 aggregate identity
并在 synthesis 前执行机械 guard
（`selected_verified_source_set_identity == mapped_analyzed_source_set_identity`，
不等 → FAIL_CLOSED 且无 synthesis artifact）；T15 只做最终对账 / 比较 / 断言 / 披露，
不重算、不第二写入。

### 为什么

"100% analysis assertion" 是产品合同（两集合机械相等才可断言）。多个写入者会让相等性
变成口号；单一写入者 + 机械比较才让它成为可测试事实。

### 代价

- T13 必须让 aggregate identity 可机械导出；
- T14/T15 的实现里禁止任何"看起来等价"的重算路径（有负向测试看守）；
- 聚合前多了 guard 分支（不等即 fail closed，无部分产出）。

### 演进

来源：Ticket Graph V1 §B 所有权规则（R2 F-4 + R3 P2）；Issues #45/#46/#47 单一 owner、
PRE-SYNTHESIS GUARD 与双保险条款。

---

## D11 — P1 跨模块数据流经 versioned observable seam contracts 沟通

### 问题

P1 管线 T09→T12→T13→T14→T15 的依赖边如果只表达"上游已 merge 才能开工"，下游实现就永远
串行；而如果没有任何冻结的接口，"并行开工"又会退化成各写各的、集成时爆炸。

### 决策

下游模块对上游的依赖表达为 **versioned observable seam contract**（`P1_SEAM_CONTRACTS_V1`）
+ golden contract fixtures + contract tests：冻结的是模块间可观察产物（identity fields、
invariants、fail-closed、ownership），不是私有函数名或内部实现。下游 ticket 在上游实现
merge 之前，可以对着冻结 seam 的 fixtures 做 isolated implementation；真实集成仍按 DAG
顺序串行执行并跑 producer-consumer contract tests。

### 为什么

单一 READY 语义把"合同已冻结"与"上游已集成"混为一谈，是 P1 并行度被阻塞的根因。seam
contract 把两者拆开后，AGENTS.md §8 本就允许的跨分支并行施工才有安全落点。

### 代价

- 需要维护 seam 版本与 fixtures（上游产物演进必须走 seam amendment，不能静默改）；
- 契约测试是一等公民，不是装饰；
- 存在"fixture 与真实上游产物漂移"的风险，由集成期 producer-consumer gate 兜底。

### 演进

来源：P1 Workflow Reform（planning/p1-contract-driven-parallel-workflow）；与 D08 的
"frozen decision 机械消费"一脉相承——seam contract 是它的跨模块形态。

---

## 决策之间的关系

这些决策并不是孤立规则：

```text
captured != verified
        ↓
canonical truth stays deterministic
        ↓
Controller owns truth; Model owns semantics
        ↓
large corpus needs mechanical coverage/evidence
        ↓
full and sampled must remain distinct
        ↓
thin orchestrator coordinates existing authorities
        ↓
runtime can stay replaceable
        ↓
cross-question research can scale without losing truth boundaries
        ↓
manifest stays derived; analyzed identity has one writer;
cross-module data flows through versioned seam contracts
```

这也是 Zhihu Grabber Toolkit 从抓取脚本逐步演化为完整工具链的主线。

## Related Documents

- [`Architecture Overview`](./overview.md)
- [`Runtime Strategy`](./runtime-strategy.md)
- [`Product Design & Evolution`](../product-design/zhihu-grabber-toolkit-product-design.md)
- [`Research Orchestration Spec`](../specs/research-orchestration-scope.md)
- [`P1 Cross-Question Deep Research`](../specs/p1-cross-question-deep-research.md)
- [`AGENTS.md`](../../AGENTS.md)
- [`RULES.md`](../../RULES.md)
