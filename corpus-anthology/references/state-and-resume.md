# manifest、分块与断点恢复

## 1. 状态目录

digest 模式的所有中间状态放在 `--work` 指定的目录（默认 `work/`）：

```text
work/
├── manifest.json        # 输入清单：来源、哈希、chunk 配置、chunk 分配、状态
├── chunks/              # 分块结果 chunk-0001.json ...（每个 chunk 带 chunkHash）
├── map-results/         # LLM 生成的 map 结果 map-chunk-0001.json ...（必须回传 chunkHash）
├── coverage.json        # verify.mjs 生成的覆盖率报告（含 manifestHash / mapSetHash 快照）
├── reduce-input.json    # reduce.mjs 的输入合并视图
└── final/               # reduce 输出的最终文档
    └── digest.md
```

## 2. manifest.json 结构

`scripts/chunk.mjs` 生成。示例：

```json
{
  "schemaVersion": 1,
  "createdAt": "2026-08-06T12:00:00.000Z",
  "sourceRoot": ".",
  "mode": "digest",
  "chunkConfig": { "maxChars": 24000, "maxAnswers": 40 },
  "inputs": [
    {
      "sourceId": "question-123-answer-456",
      "relativePath": "123/answers.json",
      "questionId": "123",
      "answerId": "456",
      "chars": 3200,
      "voteupCount": 1234,
      "sha256": "ab12...",
      "chunkIds": ["chunk-0001"],
      "status": "pending"
    }
  ]
}
```

要求：

- 所有路径为**相对路径**（相对 sourceRoot），不记录用户主目录或绝对路径。
- 每条输入有稳定 `sourceId`（`question-<qid>-answer-<id>`）。
- 每个 chunk 可追溯到原始回答（chunk 内 `sources` 数组记录 questionId/answerId/author/relativePath/voteupCount）。
- 每条记录必须恰好被分配一次（`chunkIds` 非空且不重叠；大回答可拆多个 chunk，但每条文本只出现一次）。
- `chunkConfig` 记录分块参数，并参与幂等比对（改变 `--max-chars`/`--max-answers` 也会触发重建）。
- `status`：`pending`（待 map）/ `mapped`（已有 map 结果）。

## 3. 分块规则（chunk.mjs）

- 不在 UTF-8 字符中间切断（按代码点边界切）。
- 优先按段落、句子或回答边界切分。
- 不把不同回答混在一起——除非 chunk 元数据明确记录多个 `sourceIds`（合并小回答时可多来源，但必须显式记录）。
- **正文每个回答开头标注 `[SOURCE <sourceId>]` 行**，来源与正文局部绑定。
- 每块保留 question ID、answer ID、作者、原路径。
- 大小由 **`--max-chars`（默认 24000 字符）与 `--max-answers`（默认 40 条）** 两个启发式阈值控制；`estimatedTokens` 只是输出元数据（按 1.4–2.2 字符/token 估算），**不是**分块判定依据，也不得伪装成精确 token 数。
- 所有输入记录必须被覆盖，不得重复覆盖。
- 每个 chunk 计算 `chunkHash`（对 chunk 内容序列化的 SHA-256）。

## 4. 断点恢复与失效

- chunk.mjs 幂等：重跑时先读现有 `manifest.json`，用输入文件 sha256 + `chunkConfig` 比对。
  - 哈希与配置全部一致 → 复用现有 chunks，不重建。
  - **任一输入哈希变化或 `chunkConfig` 变化 → 整个 digest cache 全失效**：`chunks/`、`map-results/`、`coverage.json`、`reduce-input.json`、`final/` 一并清除后重建。**不得静默复用任何过期中间结果**（包括旧 map 结果）。
- map 阶段中断后：已生成的 `map-results/map-chunk-*.json` 保留（其 chunkHash 与当前 chunk 一致时有效），只需对缺失的 chunk 补生成。
- verify.mjs 会检测：缺失 chunk、未处理输入、重复分配、过期哈希、**过期 map（chunkHash 不匹配）**、**跨 chunk 证据引用**、**map 字段缺失/损坏**、**同一 chunk 多个 map**、失败 chunk、未完成状态。

## 5. 输入验证（handoff 入口）

接收 zhihu-answer-grabber 的 handoff 时（见 handoff-schema.md），先执行：

```bash
node scripts/verify.mjs --handoff <handoff.json>
```

该命令完整执行共享 schema 约束（required 全字段、task enum、sourceType const、questionId pattern、verified===true、answerCount 非负整数、warnings 数组、additionalProperties 拒绝、路径为相对路径且文件存在、answerCount 与 JSON 实际回答数一致）。不满足则拒绝继续并报告需修复项。
