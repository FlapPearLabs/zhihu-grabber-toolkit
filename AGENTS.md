# AGENTS.md — Agent 工作流程（Repository Governance）

> **状态说明**：本文件为治理资产迁移重建版（2026-08-09）。原仓库 git 历史中不存在同名文件；以下规则重建自历史任务契约、多轮独立审查决策、仓库既有 `SKILL.md` / `references/security.md` / `references/verification.md` / 已批准 V2 Spec 中实际执行并被验证的治理实践。只做必要路径/状态更新，不引入未经实践的新政策。
>
> **一致性说明**：本文件与同一治理迁移中首次重建的 `RULES.md` 做过交叉校验（`RULES.md` 不是历史既有文件，而是本次迁移新建）；两者职责互补，`AGENTS.md` 的流程性文字不得覆盖 `RULES.md` 的硬约束。

## 1. Authority 职责划分（冲突时的裁决方式）

各文件职责不同，不是简单叠加的优先级链：

- `RULES.md` —— **hard project / safety invariants**（凭据安全、契约权威、scope 红线等不可违反的约束）。
- 已批准的 Spec（`docs/specs/v2-rich-content-fidelity.md`，Status: APPROVED）—— **approved product requirements / contracts**（产品需求唯一事实来源）。
- `docs/project-memory.md` —— **durable project memory**（Git tracked 的长期项目知识；不是运行状态，不是 changelog）。
- `.workbuddy/memory/` —— **WorkBuddy runtime / working memory**（本地运行状态，自动产生，ignored，non-authoritative；只作参考输入，不得覆盖 Git tracked authority）。
- 本文件（`AGENTS.md`）—— **execution / branch / review workflow**（Agent 怎么干活、怎么过 gate）。
- 当前 task / ticket —— **current authorized execution scope**（本次任务范围）。

裁决原则：

- `RULES.md` 的硬约束优先于一切流程性文字；Approved Spec 的产品合同优先于本文件的流程性安排——**本文件的流程性文字不得覆盖 Approved Spec 的产品合同**。
- 低层级指示与高层级约束冲突时，**STOP**，报告 `GOVERNANCE_CONFLICT` / `SPEC_CONFLICT`，请示裁决，不得静默选择方便的一方。
- 任何对 APPROVED Spec 的修改必须经独立 DOCUMENT review 通过。

## 2. 任务开始前必读（bootstrap 合同）

任何代码修改之前，Agent **必须**先检查并读取：

- [x] `AGENTS.md`（本文件）
- [x] `RULES.md`
- [x] `docs/project-memory.md`（durable project memory）
- [x] 相关 approved Spec（`docs/specs/v2-rich-content-fidelity.md` 或任务指定的其他 Spec）
- [x] 当前 task / ticket 描述

若 `AGENTS.md` 或 `RULES.md` 缺失 → **STOP，报告 `GOVERNANCE_FILES_MISSING`**，不得以"文件不存在，所以继续实现"为由绕过。
若 `docs/project-memory.md` 缺失 → **STOP，报告 `PROJECT_MEMORY_MISSING`**，不得继续实现。

## 3. Project Memory Lifecycle

### 3.1 两种 memory 的主从关系

- `.workbuddy/memory/` = WorkBuddy runtime / working memory：自动产生、non-authoritative、ignored、可含临时上下文；**不得覆盖 GitHub 中的项目事实**。
- `docs/project-memory.md` = durable project memory：Git tracked、reviewed、portable、project-authoritative durable knowledge。
- GitHub master = repository sole authoritative source。
- 若 `.workbuddy` memory 与 `AGENTS.md` / `RULES.md` / Approved Spec / `docs/project-memory.md` / tracked code / tests 冲突：以 Git tracked authority 为准，不得用 runtime memory 覆盖 repo 内容；若 repo 内部自身冲突，**STOP 并报告 `GOVERNANCE_CONFLICT`**。

### 3.2 Memory Decision（按任务阶段）

每个会产生项目知识的 task 结束时，都必须执行**适用于其阶段**的 memory decision。task 类型包括：implementation / document / spec / fix / research / smoke / independent review。

**A. Pre-gate（普通实现 / 文档 / 修复 / research / smoke 任务）**

在 independent review 之前执行一次：

```text
PROJECT_MEMORY_UPDATE_REQUIRED: YES | NO
```

不能省略。

- **YES**：必须在**同一个 task branch** 中更新 `docs/project-memory.md`，并与本次任务内容一起进入 review。
- **NO**：不得为了"保持新鲜"而修改 project-memory；最终报告必须写明：

```text
PROJECT_MEMORY_UPDATE_REQUIRED: NO
reason: <为什么本任务没有产生长期项目知识>
```

**B. Post-gate（仅独立 reviewer 执行）**

gate-generated durable knowledge（如 final DOCUMENT / CODE gate conclusion、accepted historical checkpoint、reviewer 才确认的长期工程结论）只有 reviewer 才能产生。reviewer 必须报告：

```text
POST_GATE_MEMORY_UPDATE_REQUIRED: YES | NO
```

reviewer **不得**为写 memory 而修改正在审查的 branch（否则最新 HEAD 不再被刚给出的 PASS 覆盖，形成 review loop）。若 YES，走 §3.5 的 post-gate memory follow-up 流程；若 NO，说明依赖 Git history 保存纯版本控制事实，无需额外沉淀。

### 3.3 何时判 YES（durable knowledge 触发）

以下结果属于 durable project knowledge，由**对应阶段的判断方**（实现 Agent 或 reviewer）确认是否需要沉淀：

**Pre-gate 可确认（实现 / 文档 / 修复 / research / smoke 阶段）：**

- 用户明确批准的新架构决策
- Approved Spec / 合同产生的长期决策
- 新的长期 security invariant
- 新确认的 API / schema / compatibility contract
- 真实 smoke test 得出的可重复稳定事实
- 新的重要 failure mode
- 新的长期 non-goal
- 测试体系发生有意义的稳定变化
- 后续 Agent 不知道就容易重复踩坑的信息

**Gate-generated（仅 reviewer 产生，走 post-gate follow-up）：**

- 一个 Phase 最终通过 review 的稳定结果（DOCUMENT / CODE gate conclusion）
- accepted historical checkpoint
- reviewer 才确认的新通用 failure pattern / 工程陷阱

不要机械地每次都写；由对应判断方确认满足 durable 原则。纯 gate PASS / SHA / merge 状态由 Git history 保存，不必机械复制进 memory。

### 3.4 什么不能写入 project-memory

禁止写入：current HEAD / current master SHA（除非作为 historical approved checkpoint）/ 当前临时 branch 是否存在 / workspace path / 本机用户名 / backup path / 临时 blocker / 临时 task progress / 一次性命令输出 / scratch reasoning / 未经确认的猜测 / Cookie / Secret / Token / credential / private WorkBuddy runtime state / 个人隐私 / 临时测试失败 / Agent 内部计划。

原则：**durable + verified + project-level + long-lived + non-sensitive** 同时成立才适合沉淀。

### 3.5 更新必须被独立 review 覆盖

Agent 不允许在任务结束后偷偷更新 project-memory 并直接 push master。

**Pre-gate update**：随 task branch 一起 review：

```text
task branch → implementation/docs → memory decision → 如 YES 更新 project-memory → independent review → PASS → merge
```

**Gate-generated update（post-gate memory follow-up）**：reviewer 不得修改正在审的 branch，不得在给出 PASS 后直接改已审 branch 并把修改视为已通过（否则最新 HEAD 不再被该 PASS 覆盖）。若 `POST_GATE_MEMORY_UPDATE_REQUIRED: YES`：

1. reviewed task branch 保持不变；
2. 按 PASS 的 reviewed HEAD 正常 merge；
3. 从最新 master 新建最小 `docs/memory` follow-up branch；
4. 只更新 `docs/project-memory.md`（及确有必要的治理引用）；
5. 单独 independent review；
6. PASS 后 ff-only merge；
7. 删除 follow-up branch。

核心原则：不要为了把 gate PASS / SHA 写进 memory 而制造无限 review loop；纯版本控制事实（PASS、SHA、merge 状态）由 Git history 保存，project-memory 只沉淀真正影响后续决策的知识。

Reviewer 必须同时检查被审任务的 `PROJECT_MEMORY_UPDATE_REQUIRED` 判断是否合理：

- 若 YES：project-memory 是否准确、稳定、非敏感、没有 stale runtime state
- 若 NO：是否漏掉了明显应该长期沉淀的重要决策

### 3.6 project-memory 不是 changelog

`docs/project-memory.md` 不是 commit history / daily log / task log / review transcript / conversation archive；不要记录所有变化。只保存以后 Agent 做正确决策真正需要的 durable context。既有信息已失效时：优先更新为新的长期事实，或标注 historical checkpoint；不要无限向文件尾部堆日志。

### 3.7 防脏工作区

WorkBuddy 自动 memory 写入 `.workbuddy/` 可以发生（已 ignored）。`docs/project-memory.md` 只能在 `PROJECT_MEMORY_UPDATE_REQUIRED: YES` 且当前任务确实产生 durable knowledge 时修改。因此普通任务若判 NO，工作树仍应保持 clean。

## 4. Branch Workflow

- 所有开发在**独立 feature 分支**进行，命名 `feat/<scope>` / `fix/<scope>` / `chore/<scope>`。
- 分支必须基于**最新 remote master**（先 `git pull --ff-only origin master` 再切分支）。
- **禁止直接在 master 上写开发代码。**
- 合并仅允许 **ff-only**（`git merge --ff-only`）或经明确审查的等价流程；禁止 `reset --hard` / `clean -fd` / 改写已推送历史。
- 分支收口（merge + 删除本地/远程分支）只发生在对应 gate PASS 之后。
- 一个任务 = 一个分支 = 一组干净 commit；Compare（`master...HEAD`）应只包含该任务范围的文件。

## 5. DOCUMENT / CODE Gate

- **DOCUMENT gate**：任何 Spec / 合同文档（如 V2 Spec）须经独立 reviewer 明确返回 `VERDICT: PASS`（或 `PASS with notes`）且无 blocking findings，才可标记 APPROVED 并作为实现依据。`CHANGES_REQUESTED` 时修复后重审，不得带 blocker 进入实现。
- **CODE gate**：feature 实现完成后，由独立 reviewer 审查；**reviewer 明确返回 `VERDICT: PASS` 且无 blocking findings** 后才允许 ff-only 合并 master。reviewer 明确标注为 `NON_BLOCKING` 的 note（如 P2 级备注）不自动成为 merge blocker。
- 审查基准：`git diff master...HEAD`；审查者需能访问完整源码（公开仓库直读或打包 bundle）。

### Implementation completion ≠ Gate acceptance

两个状态必须区分：

- **允许**（实现任务执行结束即可报告）：
  ```text
  RESULT: COMPLETED
  REVIEW_STAGE: CODE / DOCUMENT
  REVIEW_STATUS: PENDING
  NEXT_GATE: Independent review
  ```
  此处的 `COMPLETED` 只表示"当前实现任务执行结束"，**不表示** Phase accepted / merge approved / released / final PASS。
- **禁止在 reviewer 明确 PASS 前声称**：
  ```text
  PHASE ACCEPTED / MERGE APPROVED / RELEASED / FINAL PASS
  ```

Gate PASS 前禁止：merge master、删除分支、宣称 Phase accepted / merge approved / released / final PASS。

## 6. Scope Control

- 严格按当前 task / Spec 的阶段（Phase）范围实现；**禁止擅自扩大 Phase scope**。
- 未授权不引入新依赖（runtime dependency 每新增一个都要记录理由并过审查）。
- "顺手修"其他文件 = scope violation，除非任务明确允许。

## 7. 测试要求

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

## 8. Commit / Push 规则

- commit message 遵循 Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `refactor:`。
- 只 commit 任务范围内的文件；凭据、本地产物、临时文件一律不 commit（见 `RULES.md` 与 `.gitignore`）。
- push 使用普通 push；**禁止 force push**（除非用户明确批准的特殊情况）。
- 合并 master 必须满足：对应 gate PASS + ff-only。

## 9. Handoff

- 产物交接（Skill → corpus-anthology）只允许通过确定性脚本：`make-handoff.mjs` 生成，`verify.mjs --handoff` 校验。
- **禁止手工构造 handoff 字段**；`verified` 只能由 `verify-output` 授予。
- 交接前产物必须通过 `verify-output`（`valid === true`）。

## 10. SPEC_CONFLICT 处理

- 实现中发现 Spec 与实际行为冲突 → **停止**，记录冲突点，向用户报告，等待裁决（修订 Spec 走 DOCUMENT gate 或调整实现）。
- 不得擅自修改 APPROVED Spec 的合同条款来迁就实现。
- 不确定语义时以 Spec 文本为准（Spec 是已批准的唯一需求事实来源），实现不得擅自解释。

## 11. 停止条件

- 实现任务执行结束后：报告 `RESULT: COMPLETED` + `REVIEW_STATUS: PENDING` + `NEXT_GATE: Independent review`，附证据（测试输出、`git diff --check`、branch 状态、Compare）。
- **COMPLETED 只表示实现任务执行结束**，不表示 Phase accepted / merge approved / released / final PASS；这些状态只有在 reviewer 明确 PASS 后才有资格被声称。
- gate 未过 / 环境异常（如 git refs 损坏）→ 按 `RULES.md` 恢复流程处理，**不得用破坏性操作跳过**。
- **任务明确的"下一步 gate"未完成前，不得自行开始下一阶段（如 V2 Phase 2）。**
