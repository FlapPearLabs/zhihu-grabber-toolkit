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

## 模式（仅支持四种）

| 模式 | 用途 | 入口脚本 |
|---|---|---|
| `inspect` | 规模统计、分块建议 | `scripts/stats.mjs` |
| `digest` | 全覆盖分块摘要（map-reduce，带来源证据） | `scripts/chunk.mjs` → map → `scripts/verify.mjs` → `scripts/reduce.mjs` → `scripts/verify.mjs --final` |
| `top-percent-analysis` | 前 X% 高赞采样分析（完整正文、有界成本，非全量摘要） | `scripts/select.mjs` → `scripts/chunk.mjs --mode top-percent-analysis` → map → `scripts/verify.mjs` → `scripts/reduce.mjs` → `scripts/verify.mjs --final` |
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

2. **逐块生成 map 结果**（受支持 runtime：`lmstudio-local-tool-less`——LM Studio 本地服务器 + 本地 Qwen3 1.7B；`scripts/map.mjs` 逐来源调用 tool-less runtime，由 trusted controller 确定性装配 `references/evidence-schema.md` 的结构化结果）：

```bash
node scripts/map.mjs --work work/            # 受支持 runtime 路径（需本地 LM Studio 服务器运行于 127.0.0.1:1234 且 qwen/qwen3-1.7b 已加载）
```

   前置可用性验证（fail closed）：`node scripts/qualify-lmstudio-runtime.mjs` 必须 exit 0（`valid:true` / `allSafe:true`）才允许执行 map；任一来源请求失败 → 该 chunk 不写 map 并整体 fail closed（`capability_isolation_unavailable`），禁止 prompt-only 降级或静默跳过。空正文来源由 controller 确定性合成"来源正文为空"条目（不调用模型），保持全覆盖。**未获 `CAPABILITY_ISOLATION_AVAILABLE=YES` 的 runtime（如 llama.cpp / Codex-ChatGPT / 未具名 YAML host）不得用于 map 步骤。** 输出结构化 JSON：`chunkId / chunkHash / sourceIds / summary / claims（含 evidenceSourceIds 与 confidence）/ themes / uncertainties`。**禁止**输出无法追溯来源的自由文本。

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
crossChunkEvidence = 0   # map/claim 引用本 chunk 之外的来源
malformedMaps = 0        # map 字段缺失/非法
duplicateMaps = 0        # 同一 chunk 多个 map
missingMappedSources = 0 # map.sourceIds 未覆盖本 chunk 的全部来源（全覆盖门）
```

   其中 `missingMappedSources` 是"全覆盖"关键门，分两层：**ID 全覆盖**（map.sourceIds 与 chunk.sourceIds 集合相等）与**语义全覆盖**（sourceCoverage 对每个来源有恰好一条结构化处理记录，证明不是只把 ID 列全）；`claim.evidenceSourceIds` 才是子集。只有全部满足，digest 的输入侧才算完整；随后 coverage.json 记录 manifestHash / mapSetHash 快照，供 reduce 校验当前状态。

4. **reduce 合并**（确定性脚本）：

```bash
node scripts/reduce.mjs --work work/ --out work/final/digest.md
```

   reduce 启动时**重新校验当前 map 集合**（重算 manifestHash / mapSetHash 与 coverage 快照比对），不一致则拒绝；损坏的 map 结果视为失败，不得静默跳过。reduce 只基于已验证的 map 结果、manifest、coverage 报告，**不得重新读取全部原文**。它输出 **canonical `work/final/final.json`**（结构化 claims + evidenceSourceIds + minorityViews/uncertainties 分离）与展示层 `digest.md`。规则见 `references/verification.md`。

5. **完善最终产物**（编辑 final.json，不是 Markdown）：在 `final.json` 中润色/分组 claims，**保留每条 claim 的 evidenceSourceIds，不得删减证据**；然后重新渲染展示层：

```bash
node scripts/render-final.mjs --final work/final/final.json --out work/final/digest.md
```

6. **验证最终产物**：

```bash
node scripts/verify.mjs --work work/ --final work/final/final.json
```

   校验：每条 claim 必须有非空文本且**至少一个合法证据引用**（任一 claim 缺证据即失败，不是"整篇有 1 个引用就过"）；引用无效 sourceId 失败。全部通过后，才能报告 digest 完成。

### 中断恢复

- 任意步骤中断后重跑同命令即可续跑：chunk 幂等（manifest 哈希比对），map 结果按 chunkId 增量补齐，verify/reduce 只消费已完成状态。
- 输入文件变化时通过 sha256 发现，**不得静默复用过期中间结果**（见 `references/state-and-resume.md`）。

## top-percent-analysis 工作流（前 X% 高赞采样分析，有界成本）

**这是采样分析，不是 full-coverage digest。** 合同见 `docs/t7-top-percent-contract-decision.md`（T7 #13 批准）：按 canonical `voteupCount` 降序 + canonical decimal `answerId` 升序取前 `K = max(1, ceil(X/100 × N))` 条（strict count，无 tie 扩展），使用**完整正文**（非 popular-sample 截断），仅对选中来源调用模型。

```
verified canonical answers
→ select.mjs（确定性 selector → selection.json）
→ chunk.mjs --mode top-percent-analysis --selection（仅选中来源分块）
→ map.mjs（复用 T6 lmstudio-local-tool-less per-source）
→ verify.mjs（selection-scope 门）
→ reduce.mjs（mode="top-percent-analysis" + 披露块）
→ verify.mjs --final
```

### 步骤

1. **确定性选择**（必填 `--percent X`，X ∈ [1,100] 整数，无默认值；非法输入 → `invalid_input` fail closed）：

```bash
node scripts/select.mjs <answers.json 或目录> --work work/ --percent 10
```

   生成 `work/selection.json`：`schemaVersion / requestedPercent / selectionRule / originalTotal / selectedSourceIds / selectorHash`。selectionRule 机器表示 `top-<X>-pct-voteup-desc-answerid-dec-asc-strict`。selectorHash 对规范化内容确定性计算，同输入同 X 恒等。

2. **仅对选中来源分块**：

```bash
node scripts/chunk.mjs <answers.json 或目录> --work work/ --mode top-percent-analysis --selection work/selection.json
```

   manifest.mode='top-percent-analysis' 并记录 selectionHash；输入数量与 selection.originalTotal 不一致（输入已变）→ fail closed，须重跑 select。

3. **map**（与 digest 相同）：`node scripts/map.mjs --work work/` —— 仅处理选中来源的 chunk，T6 per-source tool-less runtime，前置 qualification 同 digest。

4. **selection-scope verify**：

```bash
node scripts/verify.mjs --work work/
```

   除 digest 全部覆盖门（在选中子集上执行）外，还交叉校验 selection-scope：`selection.json` 必须合法、`manifest.selectionHash == selection.selectorHash`、selection.selectedSourceIds 与 manifest 输入集合完全一致（scope 外来源混入 / 选中来源缺失 → `selectionScopeIssues > 0` → fail）。

5. **reduce + 披露**：

```bash
node scripts/reduce.mjs --work work/ --out work/final/digest.md
```

   final.json `mode="top-percent-analysis"`（**恒为采样身份**）+ 披露块：`totalAnswers / selectedAnswers / requestedPercent / actualCoveragePercent(1位小数) / selectionRule / selectedSourceIds / isFullCoverage` + `claims / minorityViews / uncertainties`。`isFullCoverage` 是**覆盖事实**（选中集==原集时为 true，如 X=100），**不是** mode identity。digest.md 头部 ⚠️ 披露块 7 项：采样分析非全量、请求比例、选中/总数、实际覆盖、选择规则、覆盖是否恰好完整、即使 100% 也不是 canonical full-digest 管线。

6. **验证最终产物**：`node scripts/verify.mjs --work work/ --final work/final/final.json`（同 digest）。

**硬不变量 `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST`：** top-percent 输出**永远不得**呈现为 `task=digest` / full coverage 身份；`mode` 由管线身份决定，不随 X 改变（X=100 时 isFullCoverage=true 但 mode 仍为 top-percent-analysis）。

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
- 单篇读入计算 canonical body，输出流按块写入（不把全部语料同时驻留内存）。
- 来源使用相对路径，不泄漏绝对路径；stdout/stderr 路径相对当前工作目录。
- 按体积（`--max-volume-chars`，按正文字符数）或篇数（`--volume`）分卷，二者互斥。
- 生成时自动写出 sidecar manifest（**实际记录**每篇 `bodySha256` / `bodyChars` 与分卷结构）。
- 完成后**必须核验完整性**：

```bash
# 推荐：manifest 驱动逐卷核验（支持分卷）
node scripts/archive.mjs <srcDir> --verify --manifest <manifest.json>

# 兼容：单卷直接核验
node scripts/archive.mjs <srcDir> --verify <collection.md>
```

   校验：每卷篇数一致、**逐篇正文 SHA-256 与 manifest 快照一致**（正文被改/截断/损坏都会失败）、无绝对路径泄漏、正文 framing 用机器标记 + 字符数长度头（正文中的 H1/来源行/marker 文本都不会被误判为边界）。验证通过才能交付。

## 与 zhihu-answer-grabber 的衔接

只接受**已验证**的 handoff（共享 schema：仓库级 `references/zhihu-corpus-handoff.schema.json`，见 `references/handoff-schema.md`）。

接收时先运行 `node scripts/verify.mjs --handoff <handoff.json>`。**共享 schema 是唯一事实来源**：validator 直接读取并执行 schema 的结构约束（required/task enum/sourceType const/questionId type+pattern/verified const/answerCount minimum/warnings items/additionalProperties），schema 修改后自动跟随、永不漂移；其余为业务校验：

业务校验（schema 无法表达的部分）：

- `inputJson` / `inputMarkdown` 为相对路径且 `realpath` 位于可信 `--source-root` 内（默认 = handoff 文件所在目录；`../` 越界与 symlink 逃逸一律拒绝）；
- JSON 可解析，`answerCount` 与 JSON 实际回答数一致；
- **questionId 三方一致**：`handoff.questionId === answers.json.questionId`（目录名侧由 verify-output.mjs 校验）。

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
