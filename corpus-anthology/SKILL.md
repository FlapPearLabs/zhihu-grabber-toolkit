---
name: corpus-anthology
description: 处理超出直接上下文读取能力的大型本地知乎回答语料（answers.json/answers.md），执行规模统计（inspect）、全覆盖分块摘要（digest）或机械归档（archive）；不用于单个小文件、普通问答、编辑或成书。
metadata:
  agent_created: true
---

# corpus-anthology

## 任务

对超出直接上下文读取能力的大型本地知乎回答语料（`zhihu-answer-grabber` 产出的 `answers.json` / `answers.md`）执行：规模统计、全覆盖分块摘要（digest）、或机械归档（archive）。不负责网络抓取，不做正文编辑，不生成来源中不存在的结论。

## 触发边界

**应当触发：**

- 用户明确要求对大型知乎回答语料做**全覆盖摘要**（"全部回答都要覆盖""做完整 digest"）。
- 用户明确要求把多份 `answers.md` **机械合并**成合集/分卷（archive）。
- 用户明确要求先**统计**这批抓取产物的规模（inspect）。
- 接收来自 `zhihu-answer-grabber` 的已验证 handoff（`verified: true`，见 `references/handoff-schema.md`）。

**不应触发：**

- 单个小文件（可直接读取，无需本 Skill）。
- 普通问答、一般文本总结（不涉及知乎语料管线）。
- 编辑、排版、改写、去重、成书、章节化完整版（**未实现，禁止声称支持**）。
- 网络抓取（属于 zhihu-answer-grabber）。
- 仅凭"太长了"一个词就触发——必须同时满足：输入是知乎抓取产物 + 规模确实超出直接读取能力。

## 上下文保护（硬性规则）

1. **先 stats 后动手**：任何模式前先运行 `scripts/stats.mjs` 评估总规模（字符/行/估算 token）。
2. **禁止一次性全读**：总规模 > 40KB（启发式阈值）时，不得用单个 Read 读取全部语料。
3. 无法获得上下文预算时，保守回退阈值：总字符 ≤ 40KB / ≈400 行以内才允许直接读取；超出必须走本 Skill 的脚本管线。
4. 阈值是启发式规则，不得伪装成精确 token 数。

## 模式（仅支持三种）

| 模式 | 用途 | 入口脚本 |
|---|---|---|
| `inspect` | 规模统计、分块建议 | `scripts/stats.mjs` |
| `digest` | 全覆盖分块摘要（map-reduce，带来源证据） | `scripts/chunk.mjs` → map → `scripts/verify.mjs` → `scripts/reduce.mjs` → `scripts/verify.mjs --final` |
| `archive` | 机械归档（脚本拼接，正文零改写） | `scripts/archive.mjs` |

**不支持（未实现，禁止声称）：** `edit` / `full` / 成书 / 深度编排 / 自动去重改写 / 章节化完整版。只有具备确定性工作流、状态文件、来源追踪、断点恢复、覆盖率验证、验收测试与完整成功样例后，未来才能重新加入。

## 输入范围（真实支持）

本 Skill 的脚本实际处理 **`answers.json` 与 `answers.md`**（zhihu-answer-grabber 产物）。**不得声称**支持所有文档、PDF、任意 Markdown 或任意文本。其他格式需先转换为上述两种格式。

## digest 工作流（全覆盖，可恢复）

```
建立 manifest
→ 对全部记录分块
→ 每块生成带来源的 map 结果
→ 验证覆盖率
→ reduce 合并
→ 验证最终引用
```

### 步骤

1. **建立 manifest 并分块**（确定性脚本）：

```bash
node scripts/chunk.mjs <answers.json 或目录> --work work/ --mode digest
```

   生成 `work/manifest.json` 与 `work/chunks/chunk-*.json`。分块规则、manifest schema、断点恢复见 `references/state-and-resume.md`。

2. **逐块生成 map 结果**（LLM 读取每个 chunk，按 `references/evidence-schema.md` 写出结构化结果）：

```bash
work/map-results/map-chunk-0001.json
```

   每块必须输出结构化 JSON：`chunkId / chunkHash / sourceIds / summary / claims（含 evidenceSourceIds 与 confidence）/ themes / uncertainties`。**禁止**输出无法追溯来源的自由文本。

3. **验证覆盖率**（确定性脚本）：

```bash
node scripts/verify.mjs --work work/
```

   校验项见 `references/verification.md`。以下条件全部为 0 才允许继续：

```text
missingSources = 0
duplicateAssignments = 0
failedChunks = 0
invalidEvidenceRefs = 0
staleMaps = 0            # map 的 chunkHash 与当前 chunk 不一致（过期 map）
crossChunkEvidence = 0   # claim 引用本 chunk 之外的来源
malformedMaps = 0        # map 字段缺失/非法
duplicateMaps = 0        # 同一 chunk 多个 map
```

   只有全部满足，digest 的输入侧才算完整；随后 coverage.json 记录 manifestHash / mapSetHash 快照，供 reduce 校验当前状态。

4. **reduce 合并**（确定性脚本）：

```bash
node scripts/reduce.mjs --work work/ --out work/final/digest.md
```

   reduce 启动时**重新校验当前 map 集合**（重算 manifestHash / mapSetHash 与 coverage 快照比对），不一致则拒绝；损坏的 map 结果视为失败，不得静默跳过。reduce 只基于已验证的 map 结果、manifest、coverage 报告，**不得重新读取全部原文**。规则见 `references/verification.md`。

5. **验证最终引用**：

```bash
node scripts/verify.mjs --work work/ --final work/final/digest.md
```

   确认最终文档中的来源 ID 全部有效，且**至少包含一个来源引用**（0 引用视为缺证据，失败）。全部通过后，才能报告 digest 完成。

### 中断恢复

- 任意步骤中断后重跑同命令即可续跑：chunk 幂等（manifest 哈希比对），map 结果按 chunkId 增量补齐，verify/reduce 只消费已完成状态。
- 输入文件变化时通过 sha256 发现，**不得静默复用过期中间结果**（见 `references/state-and-resume.md`）。

## popular-sample（高赞样本，不是摘要）

当用户只想看"最高赞的几个回答样本"时，使用：

```bash
node scripts/popular-sample.mjs <answers.json 或目录> [--top 6] [--max-chars 1300] [--out sample.md]
```

**这是 popular-sample（高赞样本），不是 digest。** 它按点赞数取 Top N 并截断开头，**不能代表整个语料**。交付时必须在输出与说明中标注"高赞样本（popular-sample）"，不得称为"完整摘要/精华摘要/语料总结"。

## archive 工作流

**archive 是归档，不是摘要，也不是编辑。**

```bash
node scripts/archive.mjs <srcDir> [--out collection.md] [--title "合集标题"] [--volume N|--max-volume-chars M] [--name 前缀] [--manifest <file>]
```

- 机械拼接，正文零改写。
- 流式处理（StringDecoder 保证多字节 UTF-8 不被切坏），超大文件不全部驻留内存。
- 来源使用相对路径，不泄漏绝对路径。
- 按体积（`--max-volume-chars`，按正文字符数）或篇数（`--volume`）分卷，二者互斥。
- 生成时自动写出 sidecar manifest（记录每篇 `bodySha256` 与分卷结构）。
- 完成后**必须核验完整性**：

```bash
node scripts/archive.mjs <srcDir> --verify <collection.md> [--manifest <manifest.json>]
```

   校验：输出前后篇数一致、**逐篇正文 SHA-256 一致**（正文被改/截断/损坏都会失败）、无绝对路径泄漏、分卷按 manifest 逐卷核验。验证通过才能交付。

## 与 zhihu-answer-grabber 的衔接

只接受**已验证**的 handoff（共享 schema：仓库级 `references/zhihu-corpus-handoff.schema.json`，见 `references/handoff-schema.md`）。

接收时先运行 `node scripts/verify.mjs --handoff <handoff.json>`，完整执行共享 schema 约束：

- `verified === true`；
- 全字段存在（task/sourceType/questionId/inputJson/inputMarkdown/verified/answerCount/warnings）；
- `task` 枚举合法、`questionId` 为 1-20 位数字、`warnings` 为数组、无额外字段；
- `inputJson` / `inputMarkdown` 为相对路径且文件存在；
- JSON 可解析，`answerCount` 与 JSON 实际回答数一致。

**若输入未验证，必须拒绝继续**，并返回需要由 zhihu-answer-grabber 修复的具体问题（如：重新运行 `verify-output.mjs`、修复产物）。不得绕过验证直接处理。

## 参考

- `references/modes.md` — 三种模式详解
- `references/state-and-resume.md` — manifest / 分块 / 断点恢复 / 状态目录
- `references/evidence-schema.md` — chunk 与 map 结果 schema
- `references/verification.md` — 覆盖率与完整性验证
- `references/handoff-schema.md` — 与抓取 Skill 的衔接契约

## 边界

- 不负责网络抓取。
- 不做正文编辑、去重改写、成书。
- archive 不改写正文；digest 不生成来源中不存在的结论。
- 不输出本机绝对路径；一切产物路径为相对路径。
