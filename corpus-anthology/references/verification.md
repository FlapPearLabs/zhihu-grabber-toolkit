# 覆盖率与完整性验证

## 1. digest 覆盖率验证

```bash
node scripts/verify.mjs --work work/
```

校验项：

| # | 校验项 | 说明 |
|---|---|---|
| 1 | manifest 可解析 | 存在且为合法 JSON |
| 2 | 每个 manifest 输入进入某个 chunk | `chunkIds` 非空且 chunk 存在 |
| 3 | 无输入未处理 | `missingSources === 0` |
| 4 | 无重复分配 | `duplicateAssignments === 0`（每条记录恰好分配一次） |
| 5 | 每个 chunk 有 chunkHash | 缺 hash 的 chunk 计入失败 |
| 6 | 每个 map 结果对应真实 chunk | map 的 chunkId 存在，文件名与 chunkId 对应 |
| 7 | 同一 chunk 只允许一个 map | `duplicateMaps === 0` |
| 8 | map 的 chunkHash 与当前 chunk 一致 | `staleMaps === 0`（输入变化后旧 map 失效） |
| 9 | map 字段完整 | `malformedMaps === 0`（sourceIds/summary/claims/confidence 等） |
| 10 | map.sourceIds ⊆ 当前 chunk | `crossChunkEvidence` 计入（禁止跨 chunk 引用） |
| 11 | **map.sourceIds 覆盖当前 chunk 全部来源** | `missingMappedSources === 0`（全覆盖门：集合相等） |
| 12 | **sourceCoverage 逐来源覆盖** | `set(sourceCoverage.sourceId) === set(chunk.sourceIds)`；每条恰好一次、无重复、有 summary/disposition 处理痕迹（语义全覆盖门） |
| 13 | claim.evidenceSourceIds ⊆ 当前 chunk | `crossChunkEvidence` 计入 |
| 14 | 输入哈希未变化 | 与 manifest 记录一致（过期状态即失败） |
| 15 | 无失败 chunk | `failedChunks === 0` |
| 16 | 无未完成状态 | 每个 chunk 都有 map 结果（`missingMapResults === 0`） |

**只有以下条件全部成立，才能报告 digest 完成：**

```text
missingSources = 0
duplicateAssignments = 0
failedChunks = 0
invalidEvidenceRefs = 0
staleMaps = 0
crossChunkEvidence = 0
malformedMaps = 0
duplicateMaps = 0
missingMappedSources = 0
```

其中 `missingMappedSources` 是"全覆盖"关键门，含义分两层：

1. **ID 全覆盖**：`map.sourceIds` 必须与 `chunk.sourceIds` 集合相等（每个 chunk 的所有来源都必须被该 chunk 的 map 覆盖），不允许 map 只摘要 chunk 的一部分来源。
2. **语义全覆盖（sourceCoverage）**：每个来源还必须在 `map.sourceCoverage` 中有**恰好一条**结构化处理记录（`summary` 或 `disposition`），证明模型确实给每个来源都留下了处理痕迹，而不是只把 ID 列全。漏掉任何一条、重复、或空记录都会失败。

`claim.evidenceSourceIds` 才是子集（某条 claim 由哪些来源支持）。

输出 `work/coverage.json` 报告，含各项计数、失败明细，以及**不可变快照**：

```json
{
  "manifestHash": "sha256 of manifest.json",
  "mapSetHash": "sha256 of all map results (sorted)",
  "chunkHashByChunk": { "chunk-0001": "sha256:..." }
}
```

`reduce.mjs` 启动时会重算当前 `manifestHash` 与 `mapSetHash` 并比对——若 map 在 verify 之后被修改，reduce 拒绝执行。

## 2. 最终产物验证（final.json）

```bash
node scripts/verify.mjs --work work/ --final work/final/final.json
```

**`final.json` 是最终摘要的 canonical 产物**（由 `reduce.mjs` 生成，LLM 完善时编辑 final.json 而不是直接写 Markdown；`digest.md` 只是展示层，由 `scripts/render-final.mjs` 确定性渲染）：

```json
{
  "schemaVersion": 1,
  "mode": "digest",
  "claims": [
    { "text": "……", "evidenceSourceIds": ["question-123-answer-1"], "confidence": "high" }
  ],
  "minorityViews": ["……"],
  "uncertainties": ["……"]
}
```

校验规则：

- `claims` 非空数组；每条 claim 必须有非空 `text`。
- **每条 claim 必须至少有一个合法 `evidenceSourceId`**（存在于 manifest 输入）——`claimsWithoutEvidence` 计入失败。任何一条无证据的 claim 都会让验证失败（不是"整篇有 1 个引用就过"）。
- 引用不存在的 sourceId → 失败并报告具体 ID。
- 不再对 Markdown 做正则猜测：展示层 `digest.md` 由 `render-final.mjs` 从已通过验证的 `final.json` 渲染。

## 3. archive 完整性验证

```bash
# 推荐：manifest 驱动逐卷核验（支持分卷）
node scripts/archive.mjs <srcDir> --verify --manifest <manifest.json>

# 兼容：单卷直接核验（不传 manifest 时对单个 collection 校验全部输入）
node scripts/archive.mjs <srcDir> --verify <collection.md>
```

- 生成时自动写出 sidecar manifest（`<out>.manifest.json` 或 `<prefix>.manifest.json`），**实际记录**每篇的 `bodySha256` / `bodyChars` 与分卷结构（`volumes[].entries[]`）。
- `--verify --manifest`：读取 manifest → 遍历 volumes → 仅验证每卷自己的 `sources` 与 `entries`，用记录的 `bodySha256` 与输出 section 逐篇比对：
  - 每卷篇数一致（卷内来源齐全）；
  - **每篇正文 SHA-256 与 manifest 快照一致**（正文被改、截断、损坏都会失败）；
  - 输出不含绝对路径（来源均为相对路径）；
  - 所有卷 valid 才 overall valid。
- 单卷模式（`--verify <collection.md>`）行为同上，但对整个输入集校验。
- 正文 framing：每篇正文以 `<!-- ARCHIVE_SOURCE_BEGIN --> <source>` / `<!-- ARCHIVE_SOURCE_END -->` 机器标记包裹，并在正文前写入 `<!-- ARCHIVE_BODY_CHARS: N -->` 长度头；verify 按 N 个字符**精确切分**正文，因此正文即使包含 marker 文本、Markdown H1 或 `> 来源:` 行也不会被误判为 section 边界。

## 4. handoff 输入验证

```bash
node scripts/verify.mjs --handoff <handoff.json> [--source-root <dir>]
```

**共享 schema 是唯一事实来源**：validator 直接读取并执行 `references/zhihu-corpus-handoff.schema.json` 的约束（mini JSON Schema 解释器，零依赖），不再手写重复约束——schema 修改后 validator 自动跟随，永不漂移。

- 结构约束由 schema 执行：required 全字段 / `task` enum / `sourceType` const / `questionId` type+pattern / `verified` const / `answerCount` type+minimum / `warnings` items type / additionalProperties 拒绝
- 业务/IO 校验（schema 无法表达）：
  - **路径 containment**：`inputJson` / `inputMarkdown` 必须是相对路径，且 `realpath` 必须位于可信 `--source-root` 内（默认 = handoff 文件所在目录）。`../` 越界与 symlink 逃逸都会被拒绝——防止 handoff 读取工作区之外的文件。
  - `answerCount` 与 JSON 实际回答数一致。
  - **questionId 三方一致**：`handoff.questionId === answers.json.questionId`（目录侧 `===` 由 verify-output.mjs 校验）。
- 若共享 schema 缺失（skill 被单独拷贝出仓库），verify 明确报错并拒绝继续

不满足则拒绝继续，返回需由抓取 Skill 修复的具体问题。

## 5. 验证失败处理

- 任一验证失败：**不得报告 digest/archive 完成**。
- 按失败类别处理：
  - 缺失/损坏 map 结果 → 重新生成对应 chunk 的 map（损坏的不能静默跳过）。
  - 重复分配/重复 map → 重建受影响的 chunk（`chunk.mjs` 幂等重跑）。
  - 哈希变化 → 输入已变，`chunk.mjs` 会清除整个 digest cache 后重建。
  - 过期 map（chunkHash 不匹配）→ 按新 chunk 重新生成 map。
  - 跨 chunk evidence → 修正 map 结果中的来源引用，只引用本 chunk。
- 修复后重新运行对应验证脚本，直至通过。
