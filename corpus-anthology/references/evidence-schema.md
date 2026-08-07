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
  "text": "[SOURCE question-123-answer-456]\n……回答正文……\n\n---\n\n[SOURCE question-123-answer-457]\n……回答正文……",
  "chars": 3200,
  "estimatedTokens": { "min": 1455, "max": 2286 },
  "chunkHash": "sha256:……"
}
```

- `sourceIds` 必须与 `sources[].sourceId` 一一对应。
- `text` 为 stripHtml 后的纯文本；**每个回答开头必须标注 `[SOURCE <sourceId>]` 行**，同一 chunk 含多个回答时用 `\n\n---\n\n` 分隔。正文与来源的局部绑定是显式的，不依赖数组顺序猜测。
- `chunkHash`：对 chunk 内容（chunkId/sourceIds/sources/text/chars）的 SHA-256。**map 结果必须回传相同 `chunkHash`**，verify 会强制比对——输入变化重建后，旧 map 因 hash 不匹配而失效。
- `estimatedTokens` 是启发式估算区间，不是精确值。

## 2. map 结果结构（LLM 生成，`work/map-results/map-chunk-XXXX.json`）

每个 chunk 必须产出一个 map 结果。schema：

```json
{
  "chunkId": "chunk-0001",
  "chunkHash": "sha256:……（必须与对应 chunk 的 chunkHash 一致）",
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
  "uncertainties": ["……本 chunk 中无法确认的推断……"],
  "minorityViews": ["……少数人的不同观点（可选）……"],
  "sourceCoverage": [
    {
      "sourceId": "question-123-answer-456",
      "summary": "该回答主要认为……",
      "disposition": "substantive"
    }
  ]
}
```

字段约束（verify.mjs 强制校验）：

- `chunkId` 必须与文件名对应（`map-chunk-0001.json` → `chunk-0001`），且一个 chunk 只允许一个 map 结果。
- `chunkHash` 必须等于对应 chunk 的 `chunkHash`（过期/错位 map 一律失败）。
- **`sourceIds` 必须与当前 chunk 的 `sourceIds` 集合相等**（全覆盖门：map 必须覆盖本 chunk 的全部来源，不允许只摘要一部分；`missingMappedSources` 计入失败）。
- **`sourceCoverage` 是逐来源覆盖记录（语义全覆盖门，P1）**：`set(sourceCoverage[].sourceId)` 必须等于当前 chunk 的 `sourceIds`；每条来源**恰好一条**记录、不允许重复；**`summary` 必填且非空（trim 后）**——必须留下该回答的真实语义处理痕迹（如"该回答认为……"）；`disposition`（`substantive`/`duplicate`/`unclear`）只是**可选**的额外分类，**不能替代 summary**——即使标记 `duplicate` 也要说明重复了什么，标记 `unclear` 也要说明为何无法提取观点。缺失、漏覆盖、重复、空 summary、仅 disposition 无 summary、引用非本 chunk 来源都会失败。
- 每个 `claim.evidenceSourceIds` 必须 ⊆ **当前 chunk** 的 `sourceIds`（claim 证据可以是子集，但不得跨 chunk 引用）。
- `summary` 非空字符串；`claims`/`themes`/`uncertainties` 必须是数组；`minorityViews`（可选）若存在必须是字符串数组。
- 每个 claim 必须有非空文本、非空 `evidenceSourceIds`，且 `confidence` ∈ {`high`, `medium`, `low`}。
- `uncertainties`：记录 chunk 中表达不明确、无法核实的内容；**不得**在 summary/claims 中把未验证推断写成事实。
- `minorityViews` 与 `uncertainties` 语义不同：前者是少数人的不同观点，后者是"不确定/无法核实"。两者分别输出，reduce 分别合并。
- 禁止输出无法追溯来源的 500 字自由文本。

## 3. 生成规范

- 只依据 chunk 文本与 `sources` 元数据生成，**不得引用本 chunk 之外的来源**。
- 高赞（voteupCount 高）只说明传播度，**不等于真实性**；需要标注"高赞来源"时在 claim 旁注明，不得据此提升 confidence。
- 每个 chunk 的 map 结果独立生成，不跨 chunk 引用。
