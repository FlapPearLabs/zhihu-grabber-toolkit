# 与 zhihu-answer-grabber 的衔接契约（handoff）

本 Skill 只处理**已验证的**知乎抓取产物。接收来自 `zhihu-answer-grabber` 的 handoff 时必须先验证，未验证则拒绝。

共享 schema：仓库级 `references/zhihu-corpus-handoff.schema.json`（两个 Skill 引用同一文件，不得各自维护不一致副本）。

## 1. handoff JSON 格式（接收侧校验）

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

## 2. 接收侧硬性检查（缺一不可）

1. `verified === true`；
2. `inputJson` 文件存在；
3. `inputJson` 可解析为 JSON，且含 `answers` 数组；
4. `answerCount` 与 JSON 中实际回答数一致；
5. `inputMarkdown` 文件存在（digest 可选，archive 必需）。

可通过 `node scripts/verify.mjs --handoff <handoff.json>` 自动校验。

**若任何一项不满足：**

- 拒绝继续处理。
- 返回需要由 zhihu-answer-grabber 修复的具体问题（例如："verified 为 false，请先运行 verify-output.mjs 修复产物后再交接"）。
- 不得绕过验证直接处理，不得静默降级。

## 3. 本 Skill 的义务

- 处理完成后，在交付说明中回传：模式、覆盖/归档的篇数、产物路径（相对路径）、验证结果。
- 若 digest 覆盖率未达标或 archive 完整性核验失败，不得声称处理完成。

## 4. 边界划分

- 本 Skill 不负责网络抓取（不复制 zhihu-answer-grabber 逻辑）。
- zhihu-answer-grabber 不负责大型语料摘要/归档（不复制本 Skill 逻辑）。
- 两者仅通过上述 JSON handoff 连接。
