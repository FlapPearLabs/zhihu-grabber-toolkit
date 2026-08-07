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
| 11 | claim.evidenceSourceIds ⊆ 当前 chunk | `crossChunkEvidence` 计入 |
| 12 | 输入哈希未变化 | 与 manifest 记录一致（过期状态即失败） |
| 13 | 无失败 chunk | `failedChunks === 0` |
| 14 | 无未完成状态 | 每个 chunk 都有 map 结果（`missingMapResults === 0`） |

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
```

输出 `work/coverage.json` 报告，含各项计数、失败明细，以及**不可变快照**：

```json
{
  "manifestHash": "sha256 of manifest.json",
  "mapSetHash": "sha256 of all map results (sorted)",
  "chunkHashByChunk": { "chunk-0001": "sha256:..." }
}
```

`reduce.mjs` 启动时会重算当前 `manifestHash` 与 `mapSetHash` 并比对——若 map 在 verify 之后被修改，reduce 拒绝执行。

## 2. 最终引用验证

```bash
node scripts/verify.mjs --work work/ --final work/final/digest.md
```

- 扫描最终文档中的来源引用 `[sourceId]`，逐一核对是否存在于 manifest 输入。
- 发现无效引用即失败，报告具体 ID。
- **最终文档必须至少包含一个有效来源引用**（`hasEvidence === true`），0 引用也失败。

## 3. archive 完整性验证

```bash
node scripts/archive.mjs <srcDir> --verify <collection.md> [--manifest <manifest.json>]
```

- 生成时自动写出 sidecar manifest（`<out>.manifest.json` 或 `<prefix>.manifest.json`），记录每篇的 `bodySha256` / `bodyChars` 与分卷结构。
- `--verify` 逐篇重算输出 section 的正文 SHA-256，与输入文件计算值比对：
  - 输出前后篇数一致（输入 N 篇 → 输出 N 篇）；
  - **每篇正文 SHA-256 一致**（正文被改、截断、损坏都会失败）；
  - 输出不含绝对路径（来源均为相对路径）；
  - 分卷时按 manifest 的 volumes 结构逐卷核验。

## 4. handoff 输入验证

```bash
node scripts/verify.mjs --handoff <handoff.json>
```

完整执行共享 schema（`references/zhihu-corpus-handoff.schema.json`）约束：

- required 全字段：`task / sourceType / questionId / inputJson / inputMarkdown / verified / answerCount / warnings`
- `task` ∈ {inspect, digest, archive}；`sourceType === "zhihu-answers"`
- `questionId` 匹配 `^\d{1,20}$`；`verified === true`；`answerCount` 非负整数；`warnings` 数组
- 禁止额外字段（additionalProperties 拒绝）
- `inputJson` / `inputMarkdown` 必须是**相对路径**且文件存在
- `answerCount` 与 JSON 实际回答数一致

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
