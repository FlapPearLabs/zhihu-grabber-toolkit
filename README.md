# ZhiHu CLI PRO

<p align="center">
  <img src="docs/assets/zhihu-cli-pro-cover.jpg" alt="ZhiHu CLI PRO — 知乎跨问题深度研究" width="640" />
</p>

简体中文 | [English](./README_EN.md)

面向知乎内容研究的 **CLI + Agent 工具链**：从问题搜索、可靠抓取、确定性验证、大语料处理，进一步扩展到 **跨问题深度研究（Cross-Question Deep Research）**。

它不只是“把知乎回答抓下来再交给模型总结”，而是把一个复杂主题拆成多个相关问题，分别检索、抓取、筛选和分析，在保留问题 / Source Group 边界、来源身份、覆盖范围和证据链的前提下，再进行跨问题综合。

```text
一个复杂主题
→ 多个相关问题 / Source Groups
→ 多路检索与抓取
→ 验证 + 筛选 + 去重
→ 分组分析
→ 跨问题综合
→ 可追溯研究结果
```

当前仓库也是 **ZhiHu CLI PRO 参赛版本**的完整工程底座；线上展示负责把研究过程做得直观，真正的抓取、验证、Research Coverage Engine、跨问题分析、安全边界和验收证据都在这个仓库里。

## 发给你的 Agent：一句话配置

把下面这句话直接发给任何**能执行本地命令的 Coding Agent**：

> 克隆 `https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git` 后，先阅读根目录 `README.md`、`AGENTS.md`、`zhihu-answer-grabber/SKILL.md` 与 `corpus-anthology/SKILL.md`，按仓库要求安装 Node.js 22+ 依赖并运行 preflight；优先检查本机已有的知乎登录态和认证配置，若本机已有 OpenCLI / Playwright / Chrome / Chromium / CDP 等能力则复用现有登录 session，未登录时再拉起浏览器让我本人完成扫码 / 短信 / 验证码；Cookie / Secret / API Key 都只能留在本机，不得输出到聊天、日志或 Git；配置完成后我直接用自然语言给研究任务，跨问题深度研究优先用 `research-orchestration/bin/research-p1.mjs`，单问题研究用 `research-orchestration/bin/research.mjs`。

配置好以后，你可以直接对 Agent 说：

```text
研究一下“AI 编程工具会不会取代程序员”，不要只看一个知乎问题，做跨问题深度研究，并告诉我共识、分歧、成立条件和证据来源。
```

---

## 为什么做这个项目

知乎的一个真实优势，也是普通“搜索一个问题然后总结”最容易丢掉的东西，是：**同一个现实问题往往被拆散在很多不同的问题、回答和讨论语境里。**

例如“AI 编程会不会取代程序员”并不只对应一个 Question。真正值得研究的内容会散落在：

- AI 编程工具当前到底能完成多少真实开发工作；
- 哪些程序员岗位正在发生变化；
- 企业为什么仍然需要工程师；
- 什么任务最容易被自动化；
- 复杂系统、责任边界、团队协作又带来了什么限制。

因此项目从最初的知乎抓取器，逐步演化成了一套研究工具链：

```text
可靠获取内容
→ 证明抓到了什么
→ 让大语料可处理
→ 记录来源与覆盖
→ 多问题 / 多来源组检索
→ 构造 selected research corpus
→ 分组分析
→ 只有满足完整性条件后才允许综合
```

这也是 P1 Cross-Question Deep Research 的核心：**研究对象不是一个“搜索结果页”，而是一份可验证、可追溯、带边界的研究语料集。**

---

## 核心能力

仓库目前由三个主要模块组成：

| 模块 | 作用 |
|---|---|
| [`zhihu-answer-grabber`](./zhihu-answer-grabber) | 搜索、单题 / 批量抓取、分页、断点续传、rich content、JSON / Markdown 输出、确定性验证 |
| [`corpus-anthology`](./corpus-anthology) | chunk / map、full digest、hierarchical digest、coverage / evidence verification、top-percent sampled analysis、archive |
| [`research-orchestration`](./research-orchestration) | 单问题 Research Orchestration + P1 跨问题深度研究：planning、multi-provider retrieval、source-group selection、RCE、分组分析、受控综合、coverage reconciliation |

### 1. 可靠抓取与验证

- 搜索知乎问题，并尽量补充回答数；
- 单题抓取当前可访问回答；
- 多问题批量抓取；
- 分页与断点续传；
- 问题标题、描述、topics 等 metadata；
- 图片、外链、引用 / 脚注、代码块等 rich content；
- 可选热门评论 enrichment；
- `answers.json` + `answers.md`；
- `captured != verified`：脚本跑完不等于验收通过；
- `verify-output` 是确定性验收门。

### 2. 大语料处理

不会把数百条回答一次性塞进模型。

```text
Canonical Corpus
→ Chunk
→ Map
→ Coverage / Evidence Verification
→ Reduce / Hierarchical Reduce
→ Final Result
```

支持：

- **Full digest**：分析全部 selected canonical sources；
- **Hierarchical full digest**：map 结果过大时继续分层聚合；
- **Top-percent sampled analysis**：仅在用户明确要求“看高赞 / 前 X% / 快速看看”时启用，并披露真实覆盖比例；
- canonical source identity / coverage / evidence lineage 由 controller 管理，而不是让模型自行声明。

### 3. Cross-Question Deep Research

P1 的生产入口：

```bash
node research-orchestration/bin/research-p1.mjs "AI 编程工具会取代程序员吗"
```

它的实际 stage order 是：

```text
PLAN
→ MULTI-PROVIDER RETRIEVAL
→ SOURCE-GROUP SELECTION
→ MULTI-GROUP EXECUTION
→ DENSE GEOMETRY + RCE
→ PER-GROUP ANALYSIS
→ PRE-SYNTHESIS GUARD
→ CROSS-SOURCE SYNTHESIS
→ FINAL COVERAGE RECONCILIATION
→ RESULT
```

关键不是“多抓几个问题”，而是：

- 保留 Question / Source Group 身份；
- 避免单一大问题吞掉整个研究；
- 把相关度、去重、语义关联和 coverage 放在同一个 research corpus contract 中；
- 先分别分析每个问题，再做跨问题综合；
- 综合前机械检查 selected / mapped / analyzed source set identity；
- 任何关键条件无法证明时 fail closed，而不是静默缩小语料或伪造成功。

---

## 研究证据：P1 已完成一次 canonical 端到端验收

仓库保留了可复核、已脱敏的 canonical acceptance evidence：

- [`P1_T16_CANONICAL_ACCEPTANCE_EVIDENCE.md`](./docs/archive/planning/P1_T16_CANONICAL_ACCEPTANCE_EVIDENCE.md)
- [`P1_T16_CANONICAL_ACCEPTANCE_EVIDENCE.json`](./docs/archive/planning/P1_T16_CANONICAL_ACCEPTANCE_EVIDENCE.json)

固定研究主题：

```text
AI 编程工具会取代程序员吗
```

核心结果：

| 验收项 | Canonical run 结果 |
|---|---:|
| Source Groups | **4** |
| 实际调用 Retrieval Providers | **2** |
| Selected verified sources | **396** |
| Mapped sources | **396** |
| Analyzed sources | **396** |
| Analysis Coverage | **100% of selected corpus** |
| Groups Verified | **4 / 4** |
| Missing / duplicate / stale / invalid evidence refs | **0 / 0 / 0 / 0** |
| Largest group share | **0.429** |
| Acceptance rows | **17 / 17 PASS** |

最重要的一条不是“396 很多”，而是：

```text
Selected Verified Source Set
=
Mapped + Analyzed Source Set
=
396 sources
```

只有集合身份机械一致，pre-synthesis guard 才允许跨问题综合。

> **100% Analysis Coverage ≠ 100% Retrieval Coverage。** 当前验收只能证明 selected corpus 中的 396 条来源全部完成映射和分析；它不能、也不会声称“已经搜遍整个知乎”。Canonical run 的 retrieval completeness 仍按真实边界披露，而不是用分析覆盖率替代检索完整度。

这部分是项目刻意保留的研究证据，不是 README 里的营销数字。

---

## 快速开始

> 这个项目明确支持：把仓库发给一个能执行本地命令的 Agent，让 Agent 自己完成环境准备与认证检查。下面以 Agent 执行为首选路径；你作为用户只在“需要本人登录”的步骤介入。

### 1. 安装

需要：

- **Node.js 22+**
- **Git**

可选（不是硬依赖，但推荐让 Agent 优先复用）：

- **OpenCLI**
- **Playwright**
- **Chrome / Chromium**
- **Chrome DevTools Protocol / CDP**

这些浏览器能力不是运行 CLI 的必需条件。但如果 Agent 发现本机已经装有其中任意一种，应优先复用已有的知乎登录 session，而不是要求你重新登录。

```bash
git clone https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git
cd zhihu-grabber-toolkit

cd zhihu-answer-grabber
npm ci --registry=https://registry.npmjs.org
node scripts/preflight.mjs --json

cd ../research-orchestration
npm ci --registry=https://registry.npmjs.org
```

`corpus-anthology` 没有第三方依赖，无需安装。

### 2. 先让 Agent 检查当前环境

进入模块目录后，先运行 preflight：

```bash
cd zhihu-answer-grabber
node scripts/preflight.mjs --json
```

然后 Agent 应按顺序检查：

1. 环境变量 `ZHIHU_COOKIE` / `ZHIHU_SECRET` 是否已存在；
2. 本地文件 `zhihu_cookie.txt` / `zhihu_secret.txt` 是否已存在；
3. 本机是否存在可用的 OpenCLI / Playwright / Chrome / Chromium / CDP；
4. 若存在浏览器能力，检查当前浏览器是否已经登录 `zhihu.com`；
5. 已有可复用登录态时，优先复用，不要重复要求你登录。

> 这里只检查“是否存在 / 是否可用”。Agent 不得在终端、聊天、日志或 Markdown 里打印任何凭据内容——包括值、长度、前缀、哈希或截断值。POSIX 系统下 `zhihu_cookie.txt` / `zhihu_secret.txt` 应为 `0600` 权限，否则 loader 会拒绝读取（详见 [`zhihu-answer-grabber/references/security.md`](./zhihu-answer-grabber/references/security.md)）。

### 3. 如果知乎已经登录

如果当前 Chrome / Chromium 已经登录知乎，Agent 应优先复用现有 session：

```text
已有浏览器登录态
→ 验证 zhihu.com session 是否有效
→ 在本机完成 CLI 所需认证准备
→ 再次运行 preflight
→ 开始研究
```

- 不要要求你把 Cookie 手工贴进聊天。
- 不要声称本项目已经提供正式的“从浏览器自动导入 Cookie”命令——这类能力如果尚未落地，只能描述 Agent workflow，不能写成产品内置功能。

### 4. 如果知乎没有登录

如果 Agent 具备 OpenCLI / Playwright / CDP 等本地能力：

- 打开知乎登录页面；
- 保持浏览器窗口可见；
- 若知乎要求扫码、短信或验证码，**由你本人完成**；
- 等待登录成功；
- 在本机完成认证配置；
- 再次运行 `node scripts/preflight.mjs --json`。

如果本机存在可用的终端二维码登录工具，可以复用；但不要虚构仓库原生命令。

> 项目不绕过验证码、不绕过登录权限。需要本人认证的步骤必须由你本人完成。

### 5. Secret 单独处理

知乎 Cookie 与知乎开放平台 Access Secret 是**两套**认证：

- `zhihu_cookie.txt`（或 `ZHIHU_COOKIE`）：抓回答需要；
- `zhihu_secret.txt`（或 `ZHIHU_SECRET`）：搜索问题需要。

普通 `zhihu.com` 登录成功，**不代表** `ZHIHU_SECRET` 已经存在。Agent 应分别检查：

- `ZHIHU_SECRET` 是否已设置；
- `zhihu_secret.txt` 是否已存在。

如果都没有：引导你从知乎开放平台获取，并只保存在本机。不要把 Secret 发到聊天。

### 6. 最终以 preflight 为准

认证准备完成后，再次运行：

```bash
node scripts/preflight.mjs --json
```

只有 preflight 确认相关能力可用，Agent 才继续抓取 / 搜索 / 研究。preflight 可能输出如下字段（只含布尔值与错误类型，不含任何凭据）：

```text
cookie_configured
cookie_usable
secret_configured
secret_usable
```

### 常用 CLI

在 `zhihu-answer-grabber/`：

```bash
# 搜索知乎问题
node scripts/zhigrab.mjs search "关键词" --json

# 单题抓取
node scripts/zhigrab.mjs grab <QUESTION_ID> --json

# 可选热门评论 enrichment
node scripts/zhigrab.mjs grab <QUESTION_ID> --comments --json

# 批量抓取
node scripts/zhigrab.mjs batch batch.txt --json

# 查看状态
node scripts/zhigrab.mjs status --json

# 确定性验证
node scripts/verify-output.mjs out/<QUESTION_ID>

# verified 后生成 corpus handoff
node scripts/make-handoff.mjs out/<QUESTION_ID> --task digest
```

### 单问题研究

在仓库根目录：

```bash
node research-orchestration/bin/research.mjs "人工智能会如何影响教育？"
```

如果存在实质歧义，orchestrator 最多要求一次 clarification；否则自动继续。

### 跨问题深度研究

```bash
node research-orchestration/bin/research-p1.mjs "AI 编程工具会取代程序员吗"
```

完成后，工作目录（默认 `./work/research-p1`）里会有一份可读的 `report.md`：按议题列出支持和反对的观点、各问题组的观点、覆盖说明，每条观点都附有原回答链接。命令行会打印议题摘要和报告路径。`report.md` 由研究结果派生，权威数据仍是同目录的 JSON 文件。

机器可读输出（JSON 中的 `report` 字段给出报告文件名）：

```bash
node research-orchestration/bin/research-p1.mjs "AI 编程工具会取代程序员吗" --json
```

如果存在实质歧义，P1 会返回结构化 clarification，而不是自行猜测用户意图。

默认（`--analysis single`）每个问题组的全部回答在一次模型调用里分析，每条观点只引用一条代表性回答，主要观点最多 3 条；回答数上千的热门问题可能装不下。可以用 `--max-group-answers <n>` 让回答数超过 n 的问题不参与选择（以检索结果报告的回答数为准；没有报告回答数的问题照常参与）。被排除的问题会写进 report.md。

`--analysis chunked` 把每组回答分批（每批最多 40 条、6 万字符）抽取观点，多批时再归并：观点数不设上限，每条观点引用所有表达它的回答，报告里会列出全部链接。模型调用数随回答数增长（约每 40 条一次，加上每组一次归并）。换分析模式等于换配置，同一个工作目录不会复用另一种模式的结果，需要 `--restart` 或换目录。

这两个参数默认不启用，在评估后决定去留（见 [`docs/default-off.md`](./docs/default-off.md)）。

模型的归类输出（以及 chunked 模式的分批抽取和归并输出）不符合约定时，例如漏掉了观点、引用了不存在的回答，这次输出会被整个丢弃，并用同一个模型重问一次；第二次仍不合格，运行失败并给出原因。重问记录在工作目录的 `events.jsonl` 里，评估脚本会显示次数。

### 评估一次运行

```bash
# 自动指标：引用覆盖率、观点数、多来源观点、模型用量、耗时
node research-orchestration/evaluation/score-run.mjs work/research-p1

# 对照黄金集生成人工评分表；填完后用 --sheet 计分
node research-orchestration/evaluation/score-run.mjs work/research-p1 --gold research-orchestration/evaluation/goldset/t1-ai-programmers.json

# 检索台账：每个候选问题的去向，以及预期来源丢在了哪一步
node research-orchestration/evaluation/retrieval-ledger.mjs work/research-p1
```

这三个命令都只读取已有的运行文件，不会重新运行。详见 [`research-orchestration/evaluation/README.md`](./research-orchestration/evaluation/README.md)。

### 选择模型

规划、观点抽取、跨问题综合用同一个模型，默认 `deepseek/deepseek-v4-pro`。模型接入基于 [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai)，用 `--model <provider>/<model-id>` 切换：

```bash
# pi-ai 内置的任意 provider（Kimi、智谱、通义、OpenAI、Anthropic、Gemini、OpenRouter 等）
node research-orchestration/bin/research-p1.mjs "主题" --model moonshotai-cn/kimi-k2.6

# 任意 OpenAI 兼容接口（本机代理、Ollama、LM Studio、vLLM 等），provider 名字可任取
node research-orchestration/bin/research-p1.mjs "主题" \
  --model antigravity/claude-sonnet-4-6 --base-url http://127.0.0.1:8045/v1
```

API key 只从本机读取，不会出现在提示词、产物、日志或错误信息里：

- `RESEARCH_MODEL_API_KEY` 环境变量，或 0600 权限的 `.model_api_key` 文件（当前目录或仓库根目录）；
- DeepSeek 仍可用 `DEEPSEEK_API_KEY` / `.deepseek_api_key`；
- 其他内置 provider 也认各自的标准环境变量，如 `OPENAI_API_KEY`、`MOONSHOT_API_KEY`。

`--base-url` 只允许 https，或本机地址上的 http。换模型就是换一次研究：不同模型的运行不会复用彼此的 checkpoint。模型不可用时直接失败，不会悄悄换成别的模型。

---

## 与知乎社区生态的契合点

这个项目不是把知乎当成普通网页集合，而是把知乎天然的**问题结构、长回答、多观点、专业答主和引用语境**当成研究结构的一部分。

### 跨问题，而不是只挑一个“最像”的问题

现实议题在知乎往往被拆散在多个 Question 中。P1 保留 Source Group / Question 边界，再做跨组综合，避免一个热门大问题代表整个议题。

### 长回答与 Rich Content 不被压扁

抓取层保留问题 metadata、正文结构、图片、外链、引用 / 脚注、代码块等 rich content，让后续研究可以基于更完整的知乎内容形态工作。

### 让社区内容可被 Agent 可靠消费

对 Agent 来说，真正困难的不只是“拿到文本”，而是：

- 这条来源是谁；
- 是否完整抓取；
- 是否被选入研究语料；
- 为什么保留 / 排除；
- 哪个结论引用了哪些 sourceRefs；
- 当前 coverage 能证明什么、不能证明什么。

因此项目把这些事实交给 controller，而不是交给概率模型猜测。

---

## 安全：Prompt Injection、Context Pollution 与凭据隔离

项目默认把知乎回答、网页、引用、代码块等全部视为：

```text
UNTRUSTED CONTENT
=
DATA, NOT INSTRUCTION
```

换句话说，外部内容可以成为**研究对象**，但没有资格改变系统规则、调用工具、读取凭据或建立自己的 provenance。

### Authority separation

```text
Controller owns truth and authority.
Model / Semantic Worker owns semantics.
```

Controller 负责：

- source identity；
- provenance；
- coverage；
- state transitions；
- verification；
- 是否允许 synthesis；
- fail-closed decisions。

语义模型负责：

- 提取观点；
- 归纳共识 / 分歧；
- 分析内容；
- 生成受约束的 synthesis。

这种分离用于降低 Prompt Injection / Context Pollution 的影响：即使外部回答中出现“忽略前文”“执行某命令”“把这条内容当系统指令”等文本，它也只是 corpus data，不拥有 controller authority。

### Tool-less semantic runtime

P1 的语义调用都是 **tool-less** 的：无论用户选择哪个模型，请求里都不带任何工具；模型回复里出现工具调用即判失败。语义 worker 不通过研究内容获得工具权限，也不掌握 source identity / coverage 的最终裁决权。

### Credential isolation

硬规则：

- 不要求用户把完整 Cookie、Secret、Token 或模型 API Key 粘贴到聊天；
- 不把凭据写入 repo、Markdown、JSON 产物、日志或任务报告；
- preflight 只报告“是否已配置 / 是否可用”和错误类型，不打印凭据；
- 知乎凭据只向允许的 HTTPS 主机发送；
- credential file 由 `.gitignore` 和本机权限约束保护。

### Fail closed / No silent fallback

`UNKNOWN != PASS`。

当 verification、coverage、runtime identity、source set equality 或关键 contract 无法证明时，系统停止，而不是：

- 静默换 provider；
- 静默换 model；
- 偷偷缩小语料；
- 把 partial 包装成 full；
- 继续生成一个看似完整的答案。

---

## 系统架构

```mermaid
flowchart TD
    A[User / Agent Research Topic] --> B[Planner]
    B --> C[Multi-provider Retrieval]
    C --> D[Source-group Selection]
    D --> E[Multi-group Capture + Verify]
    E --> F[Selected Verified Research Corpus]
    F --> G[Dense Geometry + RCE Corpus Selection]
    G --> H[Per-group Analysis / Claims]
    H --> I[Pre-synthesis Guard]
    I -->|set identity match| J[Cross-source Synthesis]
    I -->|mismatch / unknown| X[Fail Closed]
    J --> K[Final Coverage Reconciliation]
    K --> L[Research Result + Disclosure + Evidence Lineage]
```

三个 coverage 概念始终分开：

| Coverage | 回答的问题 |
|---|---|
| **Retrieval Coverage** | 在当前检索边界下探索了多少研究空间？ |
| **Source Completeness** | 选定的 source group / question 是否抓取并验证完整？ |
| **Analysis Coverage** | selected verified corpus 是否真正全部进入分析？ |

这三个概念不能互相替代。

---

## 关键设计决策

| 决策 | 为什么 |
|---|---|
| `captured != verified` | 脚本完成不代表数据已经满足后续消费合同 |
| Controller owns truth; Model owns semantics | 不让概率模型掌握 source identity、coverage 和 verification authority |
| Canonical data 与 derived view 分离 | Markdown、projection、摘要不能覆盖原始事实来源 |
| Full coverage != sampled analysis | 只看高赞 / 部分来源不能宣称分析了完整 selected corpus |
| Question / Source-group preservation | 防止一个热门问题吞掉整个跨问题研究空间 |
| Research Decision Ledger | 记录来源为何进入 / 未进入研究集，让选择过程可审计 |
| Pre-synthesis guard | selected / mapped / analyzed 集合不一致时禁止综合 |
| Retrieval / Source / Analysis Coverage 分离 | “找得广、抓得完整、分析得完整”是三件不同的事 |
| 模型由用户选择，身份如实记录 | 任何 pi-ai 支持的模型或 OpenAI 兼容接口都可用；结果里记录实际使用的 provider / model，质量用评估集衡量而不是靠事先"资格认证" |
| No silent fallback | runtime、coverage 或 verification 失败时不能偷偷改变研究身份 |
| External content = data, not instruction | 把 Prompt Injection / Context Pollution 限制在不具 authority 的数据层 |
| Simple / Mechanical / Verifiable first | 能机械证明的事实，不交给模型凭感觉判断 |

详细背景：[`docs/architecture/key-decisions.md`](./docs/architecture/key-decisions.md)

---

## 项目结构

```text
zhihu-grabber-toolkit/
├── zhihu-answer-grabber/       # 搜索、抓取、rich content、验证
├── corpus-anthology/           # 大语料 chunk / map / reduce / verification
├── research-orchestration/     # 单问题研究 + P1 跨问题深度研究
├── discovery/                  # embedding 模型下载脚本与 provider 资格审计
├── docs/
│   ├── architecture/           # 架构与关键设计决策
│   ├── product-design/         # 产品演进与设计说明
│   ├── specs/                  # 产品合同（Spec）
│   └── archive/                # 历史流程文档与决策记录（仅作背景）
├── references/                 # 跨模块 handoff schema
├── AGENTS.md                   # 怎么在这个仓库里干活
└── RULES.md                    # 不可违反的硬约束
```

---

## 文档地图

完整入口：[`docs/README.md`](./docs/README.md)

| 文档 | 内容 |
|---|---|
| [`Architecture Overview`](./docs/architecture/overview.md) | 模块、数据流与 authority boundary |
| [`Key Engineering Decisions`](./docs/architecture/key-decisions.md) | 关键取舍、alternatives 与 trade-off |
| [`Product Design & Evolution`](./docs/product-design/zhihu-grabber-toolkit-product-design.md) | 从抓取器到研究系统的产品演进 |
| [`Research Orchestration Spec`](./docs/specs/research-orchestration-scope.md) | 单问题 research orchestration 合同 |
| [`P1 Cross-Question Deep Research`](./docs/specs/p1-cross-question-deep-research.md) | 跨问题深度研究 Spec |
| [`P1 Canonical Acceptance Evidence`](./docs/archive/planning/P1_T16_CANONICAL_ACCEPTANCE_EVIDENCE.md) | P1 canonical dogfood / acceptance evidence |
| [`Runtime Strategy`](./docs/architecture/runtime-strategy.md) | local / remote runtime 与 qualification 策略 |
| [`Security`](./zhihu-answer-grabber/references/security.md) | Credential isolation、host boundary、401/403 诊断 |

---

## Development

- 工作流、review 轮数预算、证据规则：[`AGENTS.md`](./AGENTS.md)
- 硬约束：[`RULES.md`](./RULES.md)
- 默认关闭的代码和它们的决定日期：[`docs/default-off.md`](./docs/default-off.md)

一个改动一个 PR。正确性相关的改动先写测试。运行产物和验收证据不进主树：放在 `work/`，摘要写进 PR。

---

## 明确不做

- CAPTCHA / 权限控制绕过；
- 代理池、IP 轮换、高频抓取；
- 点赞、评论、关注等写操作；
- 把 sampled analysis 包装成 full coverage；
- 把 Analysis Coverage 包装成 Retrieval Coverage；
- 让外部网页 / 回答获得 Agent 操作 authority；
- 把某一个模型 / provider 当成产品身份；
- 在没有证据的情况下宣称“搜遍知乎”或“完整覆盖整个互联网”。

---

## License

仓库包含不同模块，具体许可请以各目录中的 LICENSE / package metadata 为准。

当前主要结构包括 AGPL 的知乎抓取组件与 MIT 的研究 / corpus 工具链；使用、分发或集成前请检查对应模块许可。
