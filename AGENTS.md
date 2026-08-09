# AGENTS.md — Agent 工作流程（Repository Governance）

> **状态说明**：本文件为治理资产迁移重建版（2026-08-09）。原仓库 git 历史中不存在同名文件；以下规则重建自历史任务契约、多轮独立审查（DOCUMENT / CODE gate）与仓库既有 `RULES.md` / `SKILL.md` / `docs/specs/v2-rich-content-fidelity.md` 中实际执行并被验证的治理实践。只做必要路径/状态更新，不引入未经实践的新政策。

## 1. Authority Priority（冲突时的裁决顺序）

从高到低：

1. `RULES.md` —— 项目不可违反的硬约束（凭据安全、契约权威等）。
2. 本文件（`AGENTS.md`）—— Agent 工作流程与 gate 要求。
3. 已批准的 Spec（`docs/specs/v2-rich-content-fidelity.md`，Status: APPROVED）—— 产品需求与合同。
4. 当前 task / ticket —— 本次任务的明确范围。

低层级指示与高层级冲突时，**停止并请示**，不得自行裁决后静默执行。任何对 APPROVED Spec 的修改必须经独立 DOCUMENT review 通过。

## 2. 任务开始前必读（bootstrap 合同）

任何代码修改之前，Agent **必须**先检查并读取：

- [x] `AGENTS.md`（本文件）
- [x] `RULES.md`
- [x] 相关 approved Spec（`docs/specs/v2-rich-content-fidelity.md` 或任务指定的其他 Spec）
- [x] 当前 task / ticket 描述

若 `AGENTS.md` 或 `RULES.md` 缺失 → **STOP，报告 `GOVERNANCE_FILES_MISSING`**，不得以"文件不存在，所以继续实现"为由绕过。

## 3. Branch Workflow

- 所有开发在**独立 feature 分支**进行，命名 `feat/<scope>` / `fix/<scope>` / `chore/<scope>`。
- 分支必须基于**最新 remote master**（先 `git pull --ff-only origin master` 再切分支）。
- **禁止直接在 master 上写开发代码。**
- 合并仅允许 **ff-only**（`git merge --ff-only`）或经明确审查的等价流程；禁止 `reset --hard` / `clean -fd` / 改写已推送历史。
- 分支收口（merge + 删除本地/远程分支）只发生在对应 gate PASS 之后。
- 一个任务 = 一个分支 = 一组干净 commit；Compare（`master...HEAD`）应只包含该任务范围的文件。

## 4. DOCUMENT / CODE Gate

- **DOCUMENT gate**：任何 Spec / 合同文档（如 V2 Spec）须经独立 reviewer 给出 `PASS`（或 `PASS with notes`）才可标记 APPROVED 并作为实现依据。`CHANGES_REQUESTED` 时修复后重审，不得带 blocker 进入实现。
- **CODE gate**：feature 实现完成后，由独立 reviewer 审查，`VERDICT: PASS`（P0/P1/P2 全 0）后才允许 ff-only 合并 master。
- 审查基准：`git diff master...HEAD`；审查者需能访问完整源码（公开仓库直读或打包 bundle）。
- **未通过 gate 前禁止：merge master、删除分支、声明"完成"。**

## 5. Scope Control

- 严格按当前 task / Spec 的阶段（Phase）范围实现；**禁止擅自扩大 Phase scope**。
- 未授权不引入新依赖（runtime dependency 每新增一个都要记录理由并过审查）。
- "顺手修"其他文件 = scope violation，除非任务明确允许。

## 6. 测试要求

- 任何代码改动必须运行现有测试且满足 `fail = 0`：

```bash
cd zhihu-answer-grabber && npm test
cd ../corpus-anthology && node --test
cd .. && node --test test/agent-pipeline.test.mjs
```

- 新行为必须有对应测试（Spec 对抗类别 / 反例覆盖，参照 `test/markdown-security.test.js`、`test/rich-renderer.test.js`）。
- skip 仅允许既有平台限制（Windows symlink 等），新 skip 需说明理由。
- `git diff --check` 必须 clean。
- 测试断言避免依赖 renderer/输出内部结构细节，防脆弱。

## 7. Commit / Push 规则

- commit message 遵循 Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `refactor:`。
- 只 commit 任务范围内的文件；凭据、本地产物、临时文件一律不 commit（见 `RULES.md` 与 `.gitignore`）。
- push 使用普通 push；**禁止 force push**（除非用户明确批准的特殊情况）。
- 合并 master 必须满足：对应 gate PASS + ff-only。

## 8. Handoff

- 产物交接（Skill → corpus-anthology）只允许通过确定性脚本：`make-handoff.mjs` 生成，`verify.mjs --handoff` 校验。
- **禁止手工构造 handoff 字段**；`verified` 只能由 `verify-output` 授予。
- 交接前产物必须通过 `verify-output`（`valid === true`）。

## 9. SPEC_CONFLICT 处理

- 实现中发现 Spec 与实际行为冲突 → **停止**，记录冲突点，向用户报告，等待裁决（修订 Spec 走 DOCUMENT gate 或调整实现）。
- 不得擅自修改 APPROVED Spec 的合同条款来迁就实现。
- 不确定语义时以 Spec 文本为准（Spec 是已批准的唯一需求事实来源），实现不得擅自解释。

## 10. 停止条件

- 任务完成后：报告结果与证据（测试输出、`git diff --check`、branch 状态、gate 结论）。
- gate 未过 / 环境异常（如 git refs 损坏）→ 按 `RULES.md` 恢复流程处理，**不得用破坏性操作跳过**。
- **任务明确的"下一步 gate"未完成前，不得自行开始下一阶段（如 V2 Phase 2）。**
