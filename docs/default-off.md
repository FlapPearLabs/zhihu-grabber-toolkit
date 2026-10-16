# 默认关闭代码登记表

登记规则见 `AGENTS.md` 第 4 节。默认关闭的代码有三种：

- 有开关但默认不启用；
- 已实现但没接入主流程；
- 只被测试或资格脚本使用。

决定日期到期时二选一：

- 有评估证据支持，就默认启用；
- 否则删除。

延期最多一次，并且需要 product owner 在负责的 Issue 里写明理由。

| 代码 | 开关 / 入口 | 负责 Issue | 决定日期 | 到期怎么判 |
|---|---|---|---|---|
| P2A 定向补检子阶段（targeted requery）：`research-orchestration/lib/targeted-requery-*.mjs` | `composeP1Research({ targetedSubphase })`，默认 `null`（关闭）；CLI 不暴露 | #108 | 2026-12-11 | 在 gold set 上对比新分析层「开 / 关」两组：引用覆盖率或人工质量分有可测提升，就接入 CLI 并默认开启；否则删除 |
| corpus-anthology 的模型运行时适配器：`lib/deepseek-tool-less.mjs`、`lib/lmstudio-*.mjs`、`lib/openai-responses-tool-less.mjs`、`scripts/qualify-*-runtime.mjs` | 只被单问题路径（`research.mjs` → `orchestrator.mjs`）和资格脚本使用；`openai-responses` 只被它自己的测试使用 | 单问题路径并入 P1 的 PR | 2026-12-11 | 单问题路径并入 P1 后删除；模型调用统一走 `model-runtime.mjs` |
| `--max-group-answers <n>`：检索结果报告的回答数超过 n 的问题组不参与选择（`lib/source-group-selection.mjs`），排除记录在选择决定里，并在 report.md 中披露 | `research-p1.mjs --max-group-answers <n>` / `composeP1Research({ maxGroupAnswers })`，默认不限 | P4 分析层改造 | 2026-12-11 | P4 的分块 map 能分析数千条回答的组后：删除，或者在没有替代方案时改为默认开启并写进 Spec |
