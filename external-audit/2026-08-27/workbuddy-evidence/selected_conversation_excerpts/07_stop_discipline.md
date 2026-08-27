# Excerpt — STOP 纪律与输入缺失处理

- **date**: 2026-08-27（D2 Gold Builder 两次尝试，第一次输入缺失）
- **context**: adjudication 输入文件不在本机时，执行 Agent 选择 STOP 而非猜测。
- **why included**: 展示执行纪律——在唯一 authority 缺失时拒绝编造；Reviewer 可评估这种纪律的可信度（也佐证 Level 1 文档缺失时本包同样不伪造）。

## 摘录（首次尝试，输入缺失）

> # STOP — ADJUDICATION_INPUT_MISSING
> 输入文件 TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json 在本机任何位置均未找到。
> 任务书契约明确："ChatGPT adjudication 是本轮唯一 Semantic Gold authority"——我没有权限重新 adjudicate。
> 若我现在硬造一份 D2 gold，产出的将不是 "ChatGPT adjudication 的机械转换"，而是我的猜测——比 STOP 更严重地违反本轮授权边界。

## 摘录（用户提供文件后）

> 对，WorkBuddy 这次 STOP 是正确的。问题不是 D2 设计，而是我上一轮生成的 adjudication 文件存在于 ChatGPT 当前会话的沙箱里，不会自动出现在你 Windows / WorkBuddy 的磁盘上。
> 把下面这个文件下载后放进它的 Benchmark Pilot 工作区即可。

## 后续

文件经用户下载 → 归档至 `benchmark/adjudication/` → D2 build 完成（16/16 validation）→ corrected rerun。

## Why

1. 证明"输入缺失时 STOP 而非猜测"是实际发生过的行为（可审计）。
2. 解释 D2 轮为何有一次空转——文件在 ChatGPT 沙箱，不在本机。
3. 与 Level 1 文档缺失处理一致（本包 `evidence/LEVEL1_AUTHORITY_DOCS_STATUS.md` 同样不伪造）。
