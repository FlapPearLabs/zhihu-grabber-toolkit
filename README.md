# Zhihu Grabber Toolkit

简体中文 | [English](./README_EN.md)

**知乎内容抓取、验证与大语料处理工具链。**

支持从知乎搜索问题、抓取当前可访问回答、断点续传、结果验证，到数百条回答的大语料处理与 Agent Research Orchestration。

```text
Search → Grab → Verify → Process Corpus → Research
```

适合：

- 知乎内容归档与数据整理；
- AI Agent / LLM 获取知乎资料；
- 大规模回答语料分析；
- 基于知乎内容的可恢复研究工作流。

> 项目首先是一个 **Zhihu Grabber Toolkit**。Research Orchestration、coverage、evidence lineage 等能力，是在真实使用中为解决“抓下来之后，Agent 如何可靠地使用这些数据”逐步增加的，而不是把抓取器包装成另一个通用 Deep Research 产品。

**快速入口：** [快速开始](#快速开始) · [功能](#功能) · [文档中心](./docs/README.md) · [系统设计](./docs/architecture/overview.md) · [关键设计决策](./docs/architecture/key-decisions.md)

---

## 为什么做这个项目

把一个知乎问题的回答保存成 JSON 并不难。真正进入长期使用后，问题会很快变成：

- 分页是否真的抓完整？
- 中断后能不能安全继续？
- “抓到了”什么时候才可以被认为“验证通过”？
- 图片、引用、代码、外链等富内容怎样保留下来？
- 数百条回答怎样交给模型，而不是一次性塞满上下文？
- 只看高赞回答时，如何避免把“采样分析”说成“全量总结”？
- Agent 如何知道哪些是数据、哪些不是可以执行的指令？
- 当研究问题分散在多个知乎问题里时，怎样构建一个可追踪、不会被单一热门问题支配的研究语料？

因此项目逐步从：

```text
Question → Answers → JSON / Markdown
```

演进为：

```text
Research Question
      ↓
Search / Select
      ↓
Capture
      ↓
Deterministic Verification
      ↓
Verified Corpus
      ↓
Coverage-aware Processing
      ↓
Evidence-backed Result
```

其中底层仍然是明确、可单独使用的抓取与语料处理 CLI；Research Orchestration 只是对既有 primitive 的薄编排。

---

## 功能

仓库目前由三层组成：

| 模块 | 作用 |
|---|---|
| [`zhihu-answer-grabber`](./zhihu-answer-grabber) | 搜索问题、单题/批量抓取、分页、断点续传、rich content、JSON/Markdown 输出、结果验证。 |
| [`corpus-anthology`](./corpus-anthology) | 分块、map、coverage/evidence 验证、全量摘要、层级全量摘要、top-percent 分析、原文归档。 |
| [`research-orchestration`](./research-orchestration) | 自然语言研究请求 → 搜索 → 选择 → 抓取 → 验证 → handoff → 分析 → 渲染；支持恢复与 fail-closed。 |

### 抓取层

- 搜索知乎问题，并尽量补充回答数；
- 单问题持续分页抓取当前可访问回答；
- 多问题批量抓取，一个失败不影响其他项继续执行；
- 中断后断点续传；
- 输出 `answers.json` 与便于阅读的 `answers.md`；
- 保存标题、描述、topics、回答正文、点赞数、评论数、时间等信息；
- 提取图片、外链、引用/脚注、代码块等 rich content；
- 显式 `--comments` 时提供受限的热门评论 enrichment；
- 不做验证码绕过、代理池、高频抓取或规避检测。

### 验证层

项目明确区分：

```text
captured != verified
```

抓取完成只表示数据已经落盘；只有 `verify-output` 的确定性验证通过，产物才可以进入 verified handoff 和后续语料处理流程。

### 大语料层

回答很多时，不会直接把所有正文拼接后一次性发送给模型。

```text
Canonical Corpus
      ↓
Chunk
      ↓
Map
      ↓
Coverage / Evidence Verification
      ↓
Reduce / Hierarchical Reduce
      ↓
Final Result
```

当前主要模式：

- **Full digest**：覆盖全部 canonical sources；
- **Hierarchical full digest**：为大型 corpus 分层聚合，同时保持 canonical source coverage；
- **Top-percent analysis**：确定性选取前 X% 高赞回答，并强制披露真实覆盖率；
- **Archive**：整理原文，不改写 canonical 内容。

### Research Orchestration

当前已实现的单问题研究入口：

```bash
node research-orchestration/bin/research.mjs "人工智能会如何影响教育？"
```

默认流程：

```text
SEARCH
→ SELECT
→ CAPTURE
→ VERIFY
→ HANDOFF
→ ANALYZE
→ RENDER
→ COMPLETE
```

系统会搜索候选知乎问题，在最佳匹配足够明确时自动选择；存在实质歧义时最多请求一次 clarification。默认使用 full-coverage digest；只有用户明确要求“快速看看 / 只看高赞 / 前 X% / sampled view”时才进入 sampled analysis。

**当前稳定边界仍然是单问题 Research Orchestration。** 跨多个 Question / Source-group 的 Deep Research 正在作为独立 P1 scope 施工，不把未来能力宣传成已经实现的功能。

---

## 快速开始

需要 **Node.js 22+**。

```bash
git clone https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git
cd zhihu-grabber-toolkit/zhihu-answer-grabber
npm ci --registry=https://registry.npmjs.org
node scripts/preflight.mjs --json
```

登录凭据只在本机配置，Agent 不应要求把它们粘贴到聊天里：

- `zhihu_cookie.txt`：抓回答需要；
- `zhihu_secret.txt`：搜索问题需要；
- DeepSeek API credential：只在使用默认 DeepSeek 语义分析 runtime 时需要，不是基础抓取 CLI 的前置条件。

`preflight.mjs` 只报告“是否可用”和错误类型，不输出凭据值。

### 常用命令

在 `zhihu-answer-grabber/` 目录执行：

```bash
# 检查配置
node scripts/preflight.mjs --json

# 搜索问题
node scripts/zhigrab.mjs search "关键词" --json

# 单题全量抓取
node scripts/zhigrab.mjs grab <QUESTION_ID> --json

# 可选：热门评论 enrichment
node scripts/zhigrab.mjs grab <QUESTION_ID> --comments --json

# 批量抓取
node scripts/zhigrab.mjs batch batch.txt --json

# 查看状态
node scripts/zhigrab.mjs status --json

# 权威验收门
node scripts/verify-output.mjs out/<QUESTION_ID>

# 验证后生成 handoff
node scripts/make-handoff.mjs out/<QUESTION_ID> --task digest
```

<details>
<summary><strong>把仓库直接交给 Agent</strong></summary>

如果使用 WorkBuddy、Codex、Claude Code、Hermes 或其他能执行本地命令的 Agent，可以让它先读取：

```text
README.md
AGENTS.md
RULES.md
zhihu-answer-grabber/SKILL.md
corpus-anthology/SKILL.md
```

建议给 Agent 的最小约束：

```text
自主完成安装、配置检查和知乎研究任务。
不要读取、展示或要求我把 Cookie / Secret / API Key 粘贴到聊天里。
抓取后必须先运行 verify-output，只有 valid=true 才能继续。
回答很多时使用 corpus-anthology，不要一次性把全文塞进上下文。
如果用户给的是自然语言研究问题，优先考虑 research-orchestration。
```

CLI 本身不绑定某个 Agent 或某个模型。

</details>

---

## 为什么这样设计

随着项目从抓取走向 Agent 使用和长语料研究，一些决定逐渐变成稳定的产品/工程边界：

| 决策 | 核心原因 |
|---|---|
| **`captured != verified`** | 抓到数据不代表已经机械验收通过。 |
| **Controller owns truth; Model owns semantics** | 不让概率模型掌握 canonical source identity、coverage、evidence lineage 或 verifier 权威。 |
| **Canonical data 与 derived view 分离** | 原始事实不能被 Markdown、摘要或模型输出覆盖。 |
| **Full coverage ≠ sampled analysis** | 只看一部分高赞回答，不能宣称分析了整个 corpus。 |
| **Thin Orchestrator** | 编排已经可靠的 primitive，而不是重新实现 grab / verify / corpus pipeline。 |
| **Runtime is replaceable infrastructure** | 产品语义不绑定 DeepSeek、LM Studio 或任意单一模型。 |
| **Retrieval / Source / Analysis Coverage 分离** | “100% coverage”必须说明究竟覆盖了检索空间、抓取完整性还是已选语料的分析范围。 |

完整的背景、备选方案、trade-off 和演进记录见：

- [`docs/architecture/key-decisions.md`](./docs/architecture/key-decisions.md)
- [`docs/architecture/overview.md`](./docs/architecture/overview.md)
- [`docs/product-design/zhihu-grabber-toolkit-product-design.md`](./docs/product-design/zhihu-grabber-toolkit-product-design.md)

---

## 一些产品思考

这个项目的很多边界来自长期真实使用，而不是先画一套“大而全”的架构。

### 高赞不等于高质量，但热度仍然有价值

高赞是一个强信号，却不能成为唯一的 truth weight。一个有质量的回答往往还会体现：

- 具体例子与可验证证据；
- 图片、论文、网站引用；
- 代码或公式推导；
- 与问题领域匹配的专业背景。

作者认证、职业/教育背景和长期高质量输出惯性可以成为软信号，但不应该把“低粉丝、无认证”直接判为低质量。跨问题研究中的 selector 因此更适合把 popularity 当作 anchor，再结合语义相关性、source-group preservation、novelty 等信号，而不是简单做“点赞榜抓取”。

### 数据越多，不代表研究越好

真正的问题不是把最多的回答塞给模型，而是清楚回答：

1. 找到了哪些资料？
2. 选中了哪些资料，为什么？
3. 选中的资料是否抓完整？
4. 最终到底分析了多少？
5. 结论能否回到对应来源？

这也是项目从 grabber 继续演进到 verification、corpus anthology 和 cross-question research 的原因。

---

## 安全与正确性边界

知乎回答、链接和代码始终视为**不可信外部资料**，不是给 Agent 的操作命令。

核心约束：

- Cookie / Secret / Token 不进入 repo、log、state、Markdown 报告或聊天；
- `answers.json` 中的原始 HTML 是 canonical source，渲染结果只是 derived view；
- `verify-output` 是产物有效性的确定性权威；
- 模型不能自己授予 `verified`；
- 不自动执行正文代码，不默认自动访问正文外链；
- runtime / provider 失败时不静默 fallback 成另一个产品语义；
- `UNKNOWN != PASS`；无法证明的状态不能包装成成功；
- 不绕过验证码、访问控制、频率限制，也不做 stealth / anti-detection。

项目不宣称已经解决所有自然语言 prompt-injection 风险，因此保持 capability isolation 与 fail-closed 设计。

---

## 当前状态与路线

当前公开实现可以简化为：

```text
Grab
 ↓
Reliable Capture
 ↓
Rich Content
 ↓
Verified Corpus
 ↓
Large-Corpus Processing
 ↓
Single-Question Research Orchestration
 ↓
Cross-Question Deep Research   ← active P1 work
```

当前功能里程碑仍为 **v0.3.0**。Research Orchestration 与后续 P1 work 不因为存在于 master / development branch 就自动创建新的版本号。

P1 的目标不是“多调用几次 grab”，而是在明确检索边界下建立跨多个 Question / Source-group 的 Verified Research Corpus，并区分：

- **Retrieval Coverage**：当前 plan / query / provider 下探索了多广；
- **Source Completeness**：已选 source group 是否抓取、分页、验证完整；
- **Analysis Coverage**：selected verified corpus 中有多少 source 真正进入分析。

默认可以要求 selected corpus 的 Analysis Coverage = 100%，但不会因此声称“整个知乎检索空间 100% 覆盖”。

---

## Development

本仓库本身也使用 repository-driven Agent workflow。稳定规则存放在 repo，而不是依赖某个聊天窗口的记忆。

对于 correctness-bearing CODE ticket，当前执行链要求：

```text
/implement
→ contract-driven TDD
→ static / mechanical verification
→ dynamic tests
→ adversarial self-review
→ remote CI / automated review
→ independent exact-SHA review
```

其中几个长期约束：

- `tests green != task complete`；
- self-review 不等于 independent review；
- reviewer PASS 只绑定同一个 exact reviewed SHA；
- 同一 branch 同时只允许一个 active writer；
- remote master 集成串行、默认 ff-only。

详细治理规则见 [`AGENTS.md`](./AGENTS.md) 与 [`RULES.md`](./RULES.md)。这些规则服务于仓库可恢复性和多人/多 Agent 协作，不是产品 runtime 的一部分。

---

## 文档

如果只想使用工具，README + 对应模块的 `SKILL.md` 通常足够；如果想理解产品和设计，可以从文档中心进入。

### Start Here

- [文档中心](./docs/README.md)
- [Architecture Overview](./docs/architecture/overview.md)
- [Key Engineering Decisions](./docs/architecture/key-decisions.md)
- [产品设计与演进](./docs/product-design/zhihu-grabber-toolkit-product-design.md)

### Product / Specs

- [Product Behavior Contract](./docs/product-behavior-contract.md)
- [V0.3 Product Scope](./docs/specs/v0.3-product-scope.md)
- [Research Orchestration Scope](./docs/specs/research-orchestration-scope.md)
- [P1 Cross-Question Deep Research](./docs/specs/p1-cross-question-deep-research.md)

### Module Docs

- [`zhihu-answer-grabber/SKILL.md`](./zhihu-answer-grabber/SKILL.md)
- [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md)
- [`research-orchestration/`](./research-orchestration)

详细 qualification、evidence、planning 和历史设计材料统一从 [`docs/README.md`](./docs/README.md) 进入，避免 README 被内部文件列表淹没。

---

## Repository Layout

```text
zhihu-answer-grabber/    # 搜索、抓取、验证
corpus-anthology/        # 大语料处理、coverage/evidence pipeline
research-orchestration/  # 研究编排
references/              # 共享 schema / references
docs/                    # 产品、架构、Specs、证据与规划
```

---

## 明确不做

- 完整作者档案抓取；
- 完整评论区及所有子评论抓取；
- 自动下载全部图片文件；
- 视频抓取；
- 点赞、评论、关注等写操作；
- 验证码 / 权限控制绕过；
- 代理池、高频抓取、stealth / anti-detection；
- 把某一个模型或 provider 变成产品身份；
- 把 sampled analysis 包装成 full coverage；
- 宣称可以穷尽整个知乎的所有相关资料。

---

## License

- `zhihu-answer-grabber`：**AGPL-3.0-only**；
- `corpus-anthology`：**MIT**。
