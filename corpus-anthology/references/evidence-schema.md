# chunk 与 map 结果 schema

## 1. chunk 文件结构（chunk.mjs 生成，`work/chunks/chunk-XXXX.json`）

```json
{
  "chunkId": "chunk-0001",
  "sourceIds": ["question-123-answer-456", "question-123-answer-457"],
  "sources": [
    {
      "sourceId": "question-123-answer-456",
      "questionId": "123",
      "answerId": "456",
      "author": "某用户",
      "relativePath": "123/answers.json",
      "voteupCount": 1234
    }
  ],
  "text": "……（回答正文纯文本，多个回答用分隔行隔开）",
  "chars": 3200,
  "estimatedTokens": { "min": 1455, "max": 2286 }
}
```

- `sourceIds` 必须与 `sources[].sourceId` 一一对应。
- `text` 为 stripHtml 后的纯文本；同一 chunk 含多个回答时，回答之间用 `\n\n---\n\n` 分隔，且每个回答开头标注 `[sourceId]`。
- `estimatedTokens` 是启发式估算区间，不是精确值。

## 2. map 结果结构（LLM 生成，`work/map-results/map-chunk-XXXX.json`）

每个 chunk 必须产出一个 map 结果。schema：

```json
{
  "chunkId": "chunk-0001",
  "sourceIds": ["question-123-answer-456"],
  "summary": "……本 chunk 内容的忠实概括（≤300 字）……",
  "claims": [
    {
      "claim": "……可验证的陈述……",
      "evidenceSourceIds": ["question-123-answer-456"],
      "confidence": "high"
    }
  ],
  "themes": ["主题A", "主题B"],
  "uncertainties": ["……本 chunk 中无法确认的推断……"]
}
```

字段约束：

- `chunkId` 必须与文件名对应（`map-chunk-0001.json` → `chunk-0001`）。
- `sourceIds` 必须 ⊆ 该 chunk 的 `sourceIds`。
- 每个 `claim.evidenceSourceIds` 必须存在于 manifest 的输入 sourceId 集合中（verify 会校验）。
- `confidence` 取值：`high` / `medium` / `low`。
- `uncertainties`：记录 chunk 中表达不明确、无法核实的内容；**不得**在 summary/claims 中把未验证推断写成事实。
- 禁止输出无法追溯来源的 500 字自由文本。

## 3. 生成规范

- 只依据 chunk 文本与 `sources` 元数据生成。
- 高赞（voteupCount 高）只说明传播度，**不等于真实性**；需要标注"高赞来源"时在 claim 旁注明，不得据此提升 confidence。
- 每个 chunk 的 map 结果独立生成，不跨 chunk 引用。
