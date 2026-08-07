# 覆盖率与完整性验证

## 1. digest 覆盖率验证

```bash
node scripts/verify.mjs --work work/
```

校验项：

| # | 校验项 | 说明 |
|---|---|---|
| 1 | manifest 可解析 | 存在且为合法 JSON |
| 2 | 每个 manifest 输入进入某个 chunk | `chunkIds` 非空 |
| 3 | 无输入未处理 | `missingSources === 0` |
| 4 | 无重复分配 | `duplicateAssignments === 0`（每条记录恰好分配一次） |
| 5 | 每个 map 结果对应真实 chunk | map 的 chunkId 存在于 chunks |
| 6 | 每个 claim 的 evidenceSourceIds 有效 | 全部存在于 manifest 输入 |
| 7 | 输入哈希未变化 | 与 manifest 记录一致（过期状态即失败） |
| 8 | 无失败 chunk | `failedChunks === 0` |
| 9 | 无未完成状态 | 每个 chunk 都有 map 结果（或标记为显式跳过） |

**只有以下条件全部成立，才能报告 digest 完成：**

```text
missingSources = 0
duplicateAssignments = 0
failedChunks = 0
invalidEvidenceRefs = 0
```

输出 `work/coverage.json` 报告，含各项计数与失败明细。

## 2. 最终引用验证

```bash
node scripts/verify.mjs --work work/ --final work/final/digest.md
```

- 扫描最终文档中的来源引用 `[sourceId]`，逐一核对是否存在于 manifest 输入。
- 发现无效引用即失败，报告具体 ID。

## 3. archive 完整性验证

```bash
node scripts/archive.mjs <srcDir> --verify <collection.md>
```

校验项：

- 输出前后篇数一致（输入 N 篇 → 输出 N 篇）。
- 每篇正文哈希/字符数量与输入一致（可核验）。
- 输出不含绝对路径（来源均为相对路径）。
- 超大体量分卷时逐卷核验。

## 4. handoff 输入验证

```bash
node scripts/verify.mjs --handoff <handoff.json>
```

- `verified === true`
- 文件存在
- JSON 可解析
- `answerCount` 一致

不满足则拒绝继续，返回需由抓取 Skill 修复的具体问题。

## 5. 验证失败处理

- 任一验证失败：**不得报告 digest/archive 完成**。
- 按失败类别处理：
  - 缺失 map 结果 → 补齐对应 chunk 的 map。
  - 重复分配 → 重建受影响的 chunk（`chunk.mjs` 幂等重跑）。
  - 哈希变化 → 输入已变，重建 manifest 与 chunks。
  - 无效 evidence → 修正 map 结果中的引用。
- 修复后重新运行对应验证脚本，直至通过。
