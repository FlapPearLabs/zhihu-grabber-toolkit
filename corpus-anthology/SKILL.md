---
name: corpus-anthology
description: 大语料编排器。当有大量文本/回答/文档（十几篇以上、超长，一次性读取会塞爆上下文）需要处理时使用：自动按用户意图路由为 精简总结(summary) / 全量合集(archive) / 修改排版(edit) / 完整版(full)，通过脚本与 map-reduce 分块处理，避免上下文溢出。Trigger: 大合集、全部保存、每篇都要、十几篇回答、总结这些、太长了、整理排版、完整版、成书、语料太多、context too long、anthology、corpus。
agent_created: true
---

# corpus-anthology

## 用途

处理"语料多、文本长、一次性读会塞爆上下文"的场景（如一次抓了十几篇知乎回答、多份长文档）。核心是**先路由再处理**：根据用户意图选择输出模式，并用脚本/分块技术保证 LLM 上下文安全。

## 何时使用

- 语料总规模大（参考：总字符 > 40KB 或 > 400 行，或文件数 > 5 个），直接 Read 全部会占用过多上下文。
- 用户表达了不同输出意图（见路由表）。
- 用户要求"出一本大合集 / 把每一篇都保存下来"。

## 意图路由（第一步必须做）

从用户表述中识别模式，**先向用户确认模式（除非意图明确）**：

| 用户意图信号 | 模式 | 输出形态 | 处理方式 |
|---|---|---|---|
| "总结要点""太长了""提炼" | **summary** | 一篇精炼 md（≤2-3KB，含来源标注） | `digest.mjs` 出摘要 → LLM 归纳 |
| "全部保存""大合集""每篇都要""完整原文" | **archive** | 全量原文合集 md（脚本拼接，正文零改写） | `archive.mjs` 直接合并，LLM 不读正文 |
| "整理一下""排版""去重""加目录""改格式" | **edit** | 原文 + 排版优化后的合集 | 脚本合并 + LLM 只看索引/样本做排版决策 |
| "深度编排""完整版""成书""章节化" | **full** | 分章节、带导读/索引的长文档 | map-reduce 分块精读 + 分层合成 |

多意图叠加（如"先出精简版，再出完整大合集"）= 依次执行多个模式。

## 上下文保护（硬性规则）

1. **先 stats 后动手**：任何模式前先跑 `stats.mjs` 评估总规模（字符数/估算 token），据此决定模式与分块数。
2. **禁止一次性全读**：总规模 > 40KB 时，不得用单个 Read 读取全部语料。
3. **summary / full 用 map-reduce**：
   - map：把语料按文件或按 ≤30KB/≤800 行分块，每块单独 Read + 提炼要点（每块输出 ≤500 字要点）；
   - reduce：汇总各块要点，合成最终文档。
4. **archive / edit 用脚本，LLM 不读正文**：合并、复制、统计全部由 `archive.mjs` 完成；LLM 只读取脚本生成的目录索引（标题+字符数）用于确认结构与排版，正文在脚本层保留。
5. **输出分块写**：长文档先写骨架（标题/目录/章节空位），再逐章填充，避免单次生成超长内容。

## 工作流

1. 识别意图 → 确定模式（必要时用 AskUserQuestion 确认）。
2. 跑 `stats.mjs <语料目录>` 评估规模。
3. 按模式执行：
   - summary：`node scripts/digest.mjs <目录> --top 6 --max-chars 1300 --out digest.md` → Read digest.md → 归纳为最终总结（含每篇/每题来源）。
   - archive：`node scripts/archive.mjs <目录> --title "合集名" [--volume 30]` → 交付合集文件（用 present_files），无需读取正文。
   - edit：`archive.mjs` 合并 → Read 目录索引 → 在脚本输出基础上做排版决策（如统一标题、调整分卷）→ 重新生成。
   - full：分块 map-reduce 精读 → 设计章节结构 → 分章写入。
4. 交付：present_files 输出文件 + 简要说明（模式、篇数、规模、文件路径）。

## 脚本（scripts/）

| 脚本 | 模式 | 作用 |
|---|---|---|
| `stats.mjs` | 所有 | 统计文件/目录规模（字符/行/估算token），决定分块 |
| `digest.mjs` | summary | 按评分字段（默认 voteupCount）取 Top N，每条截断，生成摘要 md |
| `archive.mjs` | archive/edit | 把多篇 answers.md 合并为大合集，自动目录索引，支持 --volume 分卷 |

脚本用法与参数详见 `references/usage.md`。

## 边界

- 本 skill 负责**编排与输出形态**，不负责"抓取"（抓取用 zhihu-answer-grabber skill）。
- archive 模式不重写正文（保留原始内容与格式）；改正文属于 edit/full 模式，且必须分块。
