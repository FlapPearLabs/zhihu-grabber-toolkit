# 与 corpus-anthology 的衔接契约（handoff）

本 Skill 只负责**抓取并验证**知乎回答原始产物。当产物规模超出直接上下文读取能力时，通过结构化 JSON handoff 交给 `corpus-anthology` 处理（统计 / digest / archive）。

共享 schema：仓库级 `references/zhihu-corpus-handoff.schema.json`（两个 Skill 引用同一文件，不得各自维护不一致副本）。

## 1. handoff JSON 格式

```json
{
  "task": "digest",
  "sourceType": "zhihu-answers",
  "questionId": "123",
  "inputJson": "out/123/answers.json",
  "inputMarkdown": "out/123/answers.md",
  "verified": true,
  "answerCount": 247,
  "warnings": []
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `task` | `"digest"` / `"archive"` / `"inspect"` |
| `sourceType` | 固定 `"zhihu-answers"` |
| `questionId` | 问题 ID |
| `inputJson` | answers.json 相对路径 |
| `inputMarkdown` | answers.md 相对路径 |
| `verified` | 是否已通过 `verify-output.mjs`（`valid === true`） |
| `answerCount` | 已验证的回答数 |
| `warnings` | 验证过程中的警告（可为空数组） |

## 2. 本 Skill 的义务

- 只有 `verify-output.mjs` 返回 `valid: true` 时，`verified` 才能为 `true`。
- `answerCount` 必须等于验证通过后的实际回答数。
- 若验证失败，不产生 handoff；先修复产物问题。

## 3. 何时触发 handoff

抓取完成后先运行 `corpus-anthology/scripts/stats.mjs` 统计规模：

- 可安全直接读取（估算不超过上下文预算约 20%，或用保守回退阈值 ≤ 40KB）→ 直接读取。
- 超过阈值 → 生成上述 JSON，交给 `corpus-anthology`。

不得为生成 Top 3–5 总结而直接读取数十 MB 的 `answers.md`。

## 4. 边界划分

- 本 Skill 不负责大型语料摘要/归档（不复制 corpus-anthology 逻辑）。
- corpus-anthology 不负责网络抓取（不复制本 Skill 逻辑）。
- 两者仅通过上述 JSON handoff 连接。
