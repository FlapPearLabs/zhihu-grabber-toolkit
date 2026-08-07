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

## 4. 生成约束（producer 侧）

- **handoff 由确定性代码生成**：`node scripts/make-handoff.mjs out/<问题ID> --task digest|archive|inspect`。
- 所有 `inputJson` / `inputMarkdown` 必须是**相对路径**（相对 handoff 文件所在目录 = question 输出目录），不写绝对路径；且文件必须位于 handoff 所在目录内（corpus 侧 `--source-root` containment 会拒绝 `../` 越界与 symlink 逃逸，生成侧不得依赖越界文件）。
- `task` 只允许 `inspect` / `digest` / `archive`。
- `verified` 必须严格等于 `verify-output.mjs` 的 `valid` 结果（**不得手工伪造为 true**；`make-handoff` 只在 `valid === true` 时生成）。
- `answerCount` 必须等于 JSON 中 `answers` 数组实际长度（由代码读取）。
- `questionId` 必须等于 `answers.json.questionId`（三方一致：目录名 = JSON = handoff；由 verifier 校验后写入）。

**Agent 禁止手工构造 handoff 的事实字段**（`verified` / `answerCount` / `questionId` / 路径）。这些字段只能由 `make-handoff.mjs` 从已验证产物生成。

> 准确表述：Agent 契约**禁止**手工构造 verified handoff；标准路径只能使用 `make-handoff.mjs`。这**不是密码学意义上的不可伪造**（handoff 是普通 JSON，corpus 侧不重跑 upstream 的完整 verifyOutput 规则），而是流程/契约层面的强制约束。不要为"防伪造"引入签名、哈希证明或 provenance 系统——那属于过度工程化。

corpus-anthology 会通过 `node scripts/verify.mjs --handoff <handoff.json> [--source-root <dir>]` 完整校验这些约束；生成侧使用同一共享 schema 自检。

## 5. 边界划分

- 本 Skill 不负责大型语料摘要/归档（不复制 corpus-anthology 逻辑）。
- corpus-anthology 不负责网络抓取（不复制本 Skill 逻辑）。
- 两者仅通过上述 JSON handoff 连接。
