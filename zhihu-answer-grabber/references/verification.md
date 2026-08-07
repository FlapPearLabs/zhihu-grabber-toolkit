# 产物验证与数量不一致处理

## 0. 状态语义（captured vs verified）

| 状态 | 含义 | 由谁授予 |
|---|---|---|
| `captured` | 抓取阶段结束：产物已写入磁盘 | `grab` / `batch` 写入后 |
| `verified` | 产物通过本文件全部校验项 | **只有 `verify-output.mjs`（`valid === true`）** |

- `progress.done === true` 只表示分页循环结束，**不等于 verified**。
- `grab` 输出 `stage: "captured"`、`verified: false`；只有 `verify-output` 才能授予 `verified: true`。
- `status` 分别报告 `captureStatus` 与 `verificationStatus`，两者互不替代。

## 1. 完成验证（每次抓取后必须执行）

```bash
node scripts/verify-output.mjs out/<问题ID>
```

输出结构化 JSON，例如：

```json
{
  "valid": true,
  "questionId": "123",
  "jsonQuestionId": "123",
  "done": true,
  "answers": 247,
  "capturedAnswerCount": 247,
  "reportedAnswerCount": 253,
  "countMismatch": true,
  "duplicates": 0,
  "jsonValid": true,
  "markdownPresent": true,
  "warnings": ["页面统计 253 与实际抓取 247 不一致（原因未知，仅提示，不设失败）"]
}
```

- `jsonQuestionId`：`answers.json.questionId` 字段；必须与 `questionId`（目录名）一致（P1-4 三方一致：目录名 = JSON = handoff）。
- `capturedAnswerCount` / `reportedAnswerCount` / `countMismatch`：页面/接口统计值与实际抓取数的对比（P2-3）；**仅提示，不设失败门**——统计值与 API 可获取数可能天然不一致，原因未知时不得据此判失败。

## 1b. 单一事实来源

验证逻辑实现在 `src/verifier.js` 的 `verifyOutput(questionDir)` 函数，以下入口全部复用同一实现，**禁止各自复制验证逻辑**：

- `scripts/verify-output.mjs`（CLI 薄壳）
- `status --json`（captured 产物的验收判定）
- `scripts/make-handoff.mjs`（handoff 生成前的必要门）

## 2. 校验项

| # | 校验项 | 说明 |
|---|---|---|
| 1 | 命令退出码 | 退出码为 0 |
| 2 | 输出目录存在 | `out/<问题ID>/` 存在 |
| 3 | `answers.json` 可解析 | 合法 JSON |
| 4 | `answers` 是数组 | 顶层或 `answers` 字段为数组 |
| 5 | 每条回答 ID 合法 | ID 为合法格式（数字字符串） |
| 6 | 回答 ID 无重复 | 无重复 ID |
| 7 | `.progress.json` 可解析 | 合法 JSON 对象 |
| 8 | `done === true` | 断点状态显示抓取完成 |
| 9 | **questionId 三方一致** | 输出目录名 === `answers.json.questionId`（handoff 侧由 corpus verify 校验） |
| 10 | Markdown 文件存在 | `answers.md` 存在且非空 |
| 11 | Markdown 与 JSON 记录数一致 | Markdown 回答条目数与 JSON 一致 |
| 12 | 输出非空 | 回答数 > 0 |
| 13 | 无损坏状态文件 | 无 `.corrupt-*` 备份或损坏状态 |
| 14 | 无中途失败记录 | progress 状态非失败 |

`valid === false` 时，**不得**向用户声称"抓取完成"。应：

1. 把 `warnings` 逐条列出。
2. 说明可能的下一步（重跑续传 / 检查错误处理表）。
3. 不猜测未经验证的原因。

## 3. 数量不一致处理

当 `reportedAnswerCount`（页面统计值）与 `capturedAnswerCount`（接口实际抓取数）不一致时，`verify-output` 输出 `countMismatch: true` 并附 warning——**这只是提示/元数据，不设失败门**（统计值与 API 可获取数可能天然不一致，原因未知）。

**正确输出：**

> 页面统计值与接口可获取数量不一致（countMismatch），原因尚未确认。页面统计 253，实际抓取 247。

**然后区分：**

- **已验证事实**：页面/接口统计值 = N；本次实际抓取到 = M。
- **可能原因**（候选，不得当作结论）：
  - 部分回答被折叠或仅关注者可见（未经证实）。
  - 接口分页限制。
  - 抓取过程中断（此时 `verify-output` 会显示 `done: false`）。
- **尚未确认事项**：为何不一致。

**禁止的表述：**

- "其余回答一定是被折叠或仅关注者可见。"（无证据归因）
- "接口侧不可见，属正常。"（武断）

## 4. 验证失败后的处置

1. 若 `done === false`：提示可重跑同命令续传。
2. 若 JSON 损坏：按错误处理表诊断；如遇 `.corrupt-*` 备份，提示用户检查备份文件。
3. 若 Markdown 缺失：重跑 `grab` 命令（会重新渲染）。
4. 只有验证通过后，才进入"统计规模 → 路由"阶段。
