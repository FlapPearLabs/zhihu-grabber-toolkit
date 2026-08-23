# AGENTS.md — Agent 工作流程（Repository Governance）

> **状态说明**：本文件最初于 2026-08-09 由历史任务契约、多轮独立审查决策、仓库既有 `SKILL.md` / `references/security.md` / `references/verification.md` / Approved Specs 中已执行并验证的治理实践重建；2026-08-23 进一步归一化为 **repository-driven continuous goal execution + independent Subagent review**。本文件定义执行、分支、审查、合并、恢复与长任务工作流；不得覆盖 `RULES.md` 的硬约束或 Applicable Approved Specs 的产品合同。

## 1. Authority 与状态源

本仓库的长期连续性属于 **GitHub repository**，不属于某个 Agent、某个聊天窗口或某个 runtime memory。

职责划分：

- `RULES.md` —— **hard project / safety invariants**：凭据安全、canonical data、验证权威、scope / git 红线、Spec authority 等不可违反约束。
- Applicable Approved Specs —— **approved product requirements / contracts**。当前至少包括：
  - `docs/specs/v2-rich-content-fidelity.md`：baseline Approved Spec；
  - `docs/specs/v0.3-product-scope.md`：Approved additive amendment；对其明确 amendment targets 覆盖 V2 对应条款，其余 V2 合同继续有效。
- `docs/product-behavior-contract.md` —— 已批准产品合同与 CURRENT / TARGET 行为的可执行归一化视图；不得覆盖 Approved Specs。
- `docs/project-memory.md` —— **durable project memory**；不是运行状态、不是 changelog。
- GitHub Tracker + child Issues —— **durable execution state / dependency graph / current authorized ticket**。
- Git history + remote refs —— 已发生事实、exact-SHA review / merge identity 的权威记录。
- 本文件 —— **execution / branch / review / merge / recovery workflow**。
- `.workbuddy/memory/`、Codex thread、MiniMax context、其他 Agent 私有 memory —— runtime / working memory，**non-authoritative**。

裁决原则：

1. `RULES.md` 硬约束不得被流程性文字覆盖。
2. Applicable Approved Specs 的产品合同优先于本文件、Tracker、Issue 中的便利性描述。
3. V0.3 对明确 amendment targets 覆盖 V2；未明确 amendment 的 V2 合同继续有效。
4. 当前 ticket 只能授权自己的 scope，不能修改更高层 authority。
5. repo authority 内部出现无法按上述关系解决的真实冲突 → **STOP：`GOVERNANCE_CONFLICT` / `SPEC_CONFLICT`**，不得静默选方便的一方。
6. 对 Approved Spec / governance authority 的修改必须经过规定的独立 review quorum。

## 2. Bootstrap 与状态恢复

任何实现、审计、文档或治理任务开始前，Agent 必须读取或核验：

- [x] `AGENTS.md`
- [x] `RULES.md`
- [x] `docs/project-memory.md`
- [x] relevant Applicable Approved Specs
- [x] `docs/product-behavior-contract.md`（若任务涉及产品行为）
- [x] Tracker / execution graph（若当前版本使用 Tracker）
- [x] 当前 / 下一 child Issue
- [x] latest remote `master`
- [x] 当前 branch / reviewed HEAD / merge ancestry（如适用）

若 `AGENTS.md` 或 `RULES.md` 缺失 → **STOP：`GOVERNANCE_FILES_MISSING`**。
若 `docs/project-memory.md` 缺失 → **STOP：`PROJECT_MEMORY_MISSING`**。

每个 execution cycle 必须从 repo 重新推导，而不是依赖聊天记忆：

```text
CURRENT_MASTER
CURRENT_ACTIVE_TICKET
CURRENT_TICKET_STATUS
CURRENT_BRANCH
CURRENT_HEAD
DEPENDENCIES
START_GATE
REVIEW_STATUS
NEXT_LEGAL_ACTION
```

`remote truth > local assumption > conversation memory`。

一个全新的 Codex / MiniMax / Claude Code / 其他 Agent 会话，应能仅凭 repo + GitHub state 恢复到正确下一步；如果做不到，说明 durable execution state 不完整，应先修状态而不是依赖旧聊天。

## 3. Continuous Goal Execution

当用户授权某版本 / milestone（例如 V0.3）进行连续施工时，默认采用 **CONTINUOUS GOAL MODE**：

```text
OBSERVE
→ READ AUTHORITY
→ DERIVE NEXT LEGAL TICKET
→ CHECK START_GATE
→ EXECUTE
→ VERIFY
→ SELF-REVIEW
→ COMMIT / PUSH
→ INDEPENDENT REVIEW
→ REPAIR / FRESH RE-REVIEW（如需要）
→ EXACT-SHA PASS
→ FF-ONLY MERGE
→ REMOTE VERIFY
→ CLOSE / TRACKER UPDATE
→ RE-OBSERVE
→ NEXT TICKET
```

不得因为以下普通事件停止：

- 一个子步骤完成；
- tests green；
- 一个 commit 完成；
- 一个 Issue 更新完成；
- reviewer 提出可修复 findings；
- 一个 ticket PASS / merge 完成。

除非当前 ticket / Spec 明确要求人工 gate，否则连续执行到真正 hard stop。

允许的人类停止状态：

```text
USER_DECISION_REQUIRED
CONTRACT_CONFLICT
BLOCKED_BY_EXTERNAL_EVIDENCE
CAPABILITY_ISOLATION_UNAVAILABLE   # 仅当当前 Spec/Issue 将其定义为 hard gate
PERMISSION_OR_TOOL_FAILURE
V0_3_EXECUTION_COMPLETE            # 或当前 milestone 的等价最终状态
```

不得自动进入当前 Approved Scope 明确排除的 NEXT_STAGE。

## 4. Agent Roles

连续模式包含四个逻辑职责；可由一个 Orchestrator 调度多个 Subagent，但 final review 必须职责隔离。

### 4.1 Orchestrator

负责：

- 从 GitHub 重建 current state；
- 选择 next legal ticket；
- 调度 Executor / Reviewer；
- 处理 reviewer findings；
- exact-SHA / ancestry / ff-only merge gate；
- close Issue / update Tracker；
- 自动进入下一合法 ticket；
- 遇到真正 human stop 时生成最小充分决策包。

Orchestrator **不能以自己的 self-review 替代独立 reviewer PASS**。

### 4.2 Executor

可以：

- 读取 authority；
- 修改当前 ticket 授权文件；
- 运行测试 / evidence collection；
- self-review；
- 修复自己发现的同 scope 缺陷；
- commit / push。

不能：

- 为自己的 candidate HEAD 产生最终 independent `PASS`；
- 在未满足 review quorum 前 merge；
- 将未来 ticket 可见需求当作当前授权。

### 4.3 Reviewer Subagent

Reviewer 必须使用**独立 review context**重新构建结论。Executor summary 只能作为导航，不能作为事实证据。

Reviewer 默认是 review-only：

- 可读取 repo / Issue / Tracker / Spec / diff；
- 可运行测试、检查源码、搜索证据；
- 不得修改 reviewed branch；
- 不得 commit / amend / rebase / merge；
- 不得 close Issue / 标记 Tracker DONE。

Reviewer 必须明确：

```text
REVIEW_VERDICT: PASS | CHANGES_REQUESTED
REVIEWED_HEAD: <exact SHA>
FINDINGS: <P0/P1/P2 as applicable>
POST_GATE_MEMORY_UPDATE_REQUIRED: YES | NO
```

`SELF_REVIEW != INDEPENDENT_REVIEW`。

### 4.4 Integrator

仅在 required reviewer quorum 对**同一个 exact HEAD** PASS 后执行：

- pre-merge remote identity / drift check；
- ff-only merge；
- push；
- remote verify；
- close / Tracker update；
- branch cleanup（若 policy 允许）。

## 5. Review Quorum 与 PASS Contract

### 5.1 Reviewer 类型

按 ticket TYPE 选择最低 quorum：

| Ticket 类型 | Required reviewer quorum |
|---|---|
| 普通 CODE | 1 × `CODE_REVIEWER` |
| DOCUMENT | 1 × `CONTRACT_REVIEWER` |
| DISCOVERY / EVIDENCE | 1 × `EVIDENCE_REVIEWER` |
| DOGFOOD | 1 × `ACCEPTANCE_EVIDENCE_REVIEWER` |
| SECURITY / capability isolation | 1 × `SECURITY_REVIEWER` + 1 × `CODE_OR_CONTRACT_REVIEWER`，同 exact HEAD |
| Approved Spec / governance authority change | 1 × `CONTRACT_REVIEWER` + 1 × `CONSISTENCY_REVIEWER`，同 exact HEAD |

若一个 reviewer PASS、另一个 `CHANGES_REQUESTED`，overall verdict = `CHANGES_REQUESTED`。

默认不要过度 spawn reviewer；普通票 1 个 reviewer 足够。安全 / Spec / governance 才要求双 reviewer。

### 5.2 Universal PASS Contract

Reviewer 只有在所有 applicable 条件满足时才能 PASS：

**Identity**
- Issue / task 正确；
- BASE / HEAD exact；
- remote branch 指向被审 HEAD；
- review scope 无歧义。

**Scope**
- changed files 在 ticket 授权内；
- 无 unrelated refactor / cleanup；
- 无 future-ticket implementation；
- 无 credential / schema / Spec scope 偷扩。

**Requirements / Contract**
- Goal / Acceptance / Required Evidence 满足；
- STOP_CONDITIONS 未违反；
- Applicable Approved Specs / Product Behavior Contract 保持；
- `UNKNOWN != PASS`；
- `captured != verified`；
- sampled evidence 不得升级成 global claim；
- sampled analysis 不得冒充 full coverage；
- prompt-only guard 不得冒充 capability isolation。

**Correctness / Failure semantics**
- happy path 与相关 failure path 均检查；
- valid / fail-closed / warning semantics 未被偷改；
- backward compatibility / canonical data / schema 约束保持。

**Tests / Evidence**
- required tests 真正覆盖目标合同，不是 tautology；
- evidence 支持所声明范围；
- pre-existing failure 必须有 base 对照证据，不能只靠口头声明。

**Docs / Memory**
- current-state docs 与实现一致；
- historical / current / candidate 状态不混写；
- `PROJECT_MEMORY_UPDATE_REQUIRED` 判断合理；
- memory 无 transient SHA / branch / machine-private 信息。

**Security / Privacy**
- 无凭据 / secrets / 本机隐私路径泄漏；
- 无未经批准能力扩张；
- untrusted content boundary 保持。

**Findings**
- 无 unresolved P0；
- 无 unresolved P1；
- 无 meaningful correctness / contract P2 blocker。

纯 cosmetic / style note 可标 `NON_BLOCKING`，但 reviewer 必须清楚说明不影响 contract / correctness。

## 6. Review → Repair → Fresh Review Loop

Candidate HEAD push 后，Orchestrator 启动 required Reviewer Subagent。

若：

```text
REVIEW_VERDICT: CHANGES_REQUESTED
```

则：

1. 把 findings 交给 Executor；
2. 只修 reviewer 指出的 blocker，以及同 scope 明确发现的真实缺陷；
3. **追加 repair commit**；
4. 禁止 amend reviewed commit；
5. 禁止 rebase reviewed history；
6. 禁止 force push；
7. push 新 exact HEAD；
8. 启动 **fresh Reviewer Subagent** 重新审查新 HEAD；
9. 重复直到 quorum PASS。

普通 review findings 不需要停下来找用户。

## 7. Exact-SHA Review 与 Merge

PASS 只绑定：

```text
REVIEWED_HEAD = exact commit SHA
```

PASS 不自动转移给：

- amend 后 SHA；
- rebase 后 SHA；
- repair child commit；
- force-pushed branch；
- “看起来等价”的新 commit。

merge 前必须：

1. fetch remote；
2. `origin/<feature-branch> == REVIEWED_HEAD`；
3. 核验 current remote master / merge-base；
4. 若 master drift 导致 candidate 不再可合法 ff-only merge，旧 PASS 不得静默转移；按治理规则重新形成 candidate 并 fresh review；
5. 使用 ff-only merge；
6. push；
7. remote verify；
8. 只有 remote verify 后才能 close Issue / Tracker DONE。

禁止 squash / merge commit / rebase-after-review（除非某 Approved workflow 明确另有要求并经过同等级 review）。

## 8. Branch Workflow

- 所有开发 / document / audit / governance change 在独立 feature branch 进行。
- branch 基于最新 remote master。
- 禁止直接在 master 上施工。
- 一个 ticket = 一个 branch = scope-clean commits（除明确 follow-up governance / memory ticket 外）。
- `master...HEAD` 或明确 `BASE..HEAD` Compare 应只包含该 ticket 范围。
- reviewer 开始后 reviewed history 不改写。
- branch cleanup 仅发生在 exact-SHA PASS + verified merge 后。

## 9. Tracker / Issue Execution Ledger

GitHub Tracker + child Issues 是 durable execution ledger，不是 reviewer 本身。

在每个 meaningful gate，状态必须足够让 fresh Agent 回答：

- 什么已完成？
- 当前合法 ticket 是什么？
- dependency 是否满足？
- 哪个 exact HEAD 正在 review / 已 PASS？
- 下一 gate 是什么？

Issue STATUS 不能单独作为事实；必须与 remote refs / Git history / Tracker / dependencies 交叉核验。

票序有 sequential policy 时，不得并行施工后续 ticket。能并行的仅限不会造成 scope / branch 冲突的内部读取、测试分析或证据搜集。

## 10. Project Memory Lifecycle

### 10.1 两种 memory

- `.workbuddy/memory/` 或其他 Agent runtime memory：non-authoritative、可丢失、不得覆盖 repo truth。
- `docs/project-memory.md`：Git tracked durable project knowledge。

### 10.2 Pre-gate decision

每个可能产生长期知识的 task 在 independent review 前必须报告：

```text
PROJECT_MEMORY_UPDATE_REQUIRED: YES | NO
```

YES：在同一 task branch 中做最小 durable update，随 candidate HEAD 一起 review。
NO：不得为了“保持新鲜”机械修改。

适合进入 memory：

- approved architecture / product decisions；
- stable API / schema / compatibility contracts；
- durable security invariants；
- repeatable real smoke / runtime evidence；
- important failure modes / non-goals；
- 后续 Agent 不知道会重复踩坑的长期事实。

不得进入 memory：

- current HEAD / temporary branch / review progress；
- machine path / username / backup path；
- credentials / secrets；
- scratch reasoning；
- 临时测试失败；
- conversation transcript / changelog。

### 10.3 Post-gate knowledge

Reviewer 必须报告：

```text
POST_GATE_MEMORY_UPDATE_REQUIRED: YES | NO
```

Reviewer 不得为了写 memory 修改正在审查的 HEAD。

若 YES：

1. 正常 merge reviewed task；
2. 从最新 master 建最小 `docs/memory` follow-up branch；
3. 只修改 durable memory 所需内容；
4. 按 DOCUMENT reviewer gate 独立 review；
5. PASS 后 ff-only merge。

纯 PASS / SHA / merge 状态由 Git history 保存，不机械写进 memory。

## 11. Scope Control

- 严格按当前 ticket / Applicable Specs 的 scope 实现。
- 未授权不新增 runtime dependency。
- “顺手修”无关文件 = scope violation。
- audit / discovery ticket 不得偷变 implementation；document ticket 不得偷改 runtime behavior。
- future requirement visible ≠ current requirement authorized。

## 12. 测试与 Baseline Failure 规则

代码改动应运行 ticket 要求的 focused tests + relevant regression；通常也应运行现有主要 suites：

```bash
cd zhihu-answer-grabber && npm test
cd ../corpus-anthology && node --test
cd .. && node --test test/agent-pipeline.test.mjs
```

默认目标：`fail = 0`。

若 suite 不能达到 `fail = 0`，不得简单写“pre-existing”后 PASS，必须：

1. 在 clean BASE / master 对照重现；
2. 记录 base 与 candidate 的 pass / fail / skip 差异；
3. 证明 candidate 没有新增相关 failure；
4. 区分 dependency / environment / platform incident 与代码回归；
5. focused required tests 必须满足 ticket contract；
6. Reviewer 明确判断 residual baseline failures 是否阻塞。

禁止通过新增 skip、删除 assertion、缩小测试范围来伪造绿灯，除非 ticket 明确授权且 reviewer 接受。

其他要求：

- 新行为必须有对应反例 / contract tests；
- skip 仅允许已知平台限制，新 skip 必须解释；
- `git diff --check` 必须 clean；
- test 必须真正触达目标 behavior，避免 tautological assertion。

## 13. Commit / Push

- Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:` / `test:` / `refactor:`。
- 仅提交当前 scope；凭据 / 临时产物 / runtime memory 不提交。
- 普通 push；禁止 force push（除用户明确批准的特殊恢复场景且不破坏 reviewed history）。
- 不得使用破坏性 `reset --hard` / `clean -fd` 绕过异常。

## 14. Handoff / Verification Authority

- Skill → corpus-anthology 的产物交接只能走确定性 `make-handoff.mjs`，并按现有 verifier / schema 校验。
- 禁止手工构造 verified handoff。
- `verified` 只能由 verify-output authority 授予。
- `captured != verified`。

## 15. SPEC / GOVERNANCE CONFLICT

发现实现与 Applicable Approved Specs 冲突：

- STOP 当前实现扩张；
- 定位 exact conflicting clauses；
- 若可通过明确 authority hierarchy 解决，按 hierarchy 执行并记录；
- 若无法解决 → `SPEC_CONFLICT` / `CONTRACT_CONFLICT`，请求 product-owner 裁决；
- 不得擅自修改 Approved Spec 迁就实现。

Approved Spec / governance authority change 属高风险文档 gate，要求 `CONTRACT_REVIEWER + CONSISTENCY_REVIEWER` 同 exact HEAD PASS。

## 16. Human Fallback / External Handoff

Subagent review 是默认 internal gate；**不再要求用户为每个普通 ticket 手工复制 `NEXT_REVIEW_PROMPT` / `NEXT_AGENT_PROMPT`**。

只有以下情况需要 external human / ChatGPT handoff：

- runtime 没有可用的独立 Subagent review 能力；
- 用户明确要求 external review；
- `USER_DECISION_REQUIRED`；
- authority conflict；
- external evidence / permission blocker；
- 当前 Issue / Spec 明确要求人工 reviewer。

若进入 external handoff，必须提供可复制 review packet / verdict packet，至少包含：repository、Issue、BASE、HEAD、Compare、authority、objective、scope、tests/evidence、known caveats、acceptance、要求的 verdict schema。

## 17. Ticket Completion 与停止条件

Implementation complete ≠ accepted。

票内完成流程：

```text
IMPLEMENTED
→ REVIEWED
→ required quorum PASS on exact SHA
→ ff-only MERGED
→ remote verified
→ Issue CLOSED / Tracker DONE
```

只有完成上述序列，当前 ticket 才是 DONE。

连续 Goal Mode 下，ticket DONE 后自动 re-observe 并进入 next legal ticket；不得停下来问“是否继续”。

真正允许停止的状态见 §3。最终 milestone 完成后只报告已授权 milestone 的完成，不自动进入明确排除的下一阶段。
