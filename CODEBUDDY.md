# CODEBUDDY.md — WORKBUDDY_BOOTSTRAP_POINTER

> **本文件不是新的权威层。** 它只是 WorkBuddy 首轮自动注入的短引导指针。
> 它**不覆盖、不替代、不解释**以下任何一项：
> `RULES.md`、Applicable Approved Specs、`AGENTS.md`、`docs/project-memory.md`、
> 当前 ticket / Issue 授权、GitHub Tracker。

## 为什么存在

**以下为「profile / 版本观测」事实（WorkBuddy 5.5.3，app.asar sha256 `f9a3803e…`，2026-09-04），
不是跨版本普适常数。** 运行时若变更，本文件与
`scripts/validate-codebuddy-bootstrap.mjs` 内的对应常量必须一并复核。

该 profile 下：`GUIDANCE_FILES` 只在 `CODEBUDDY.md` / `.codebuddy/CODEBUDDY.md` / `AGENTS.md`
中**取第一个存在者**注入，且 project guidance 在 `MAX_GUIDANCE_CHARS`（该版本 = 8000，
按 JS string length 计量，非 UTF-8 字节数）处**截断**。
`AGENTS.md` 全文远长于该上限；`RULES.md` 根本不在该清单内。

因此本文件的唯一职责是：**在首轮就告诉 Agent「完整权威在仓库里，先读完再动手」**。

```text
FIRST_TURN_AUTO_INJECTION  !=  FULL_GOVERNANCE_DELIVERY
FILE_EXISTS_IN_REPO        !=  CONSUMED_AT_RUNTIME
```

## 开工前必须执行（工程任务）

在任何实质工程工作之前：

1. 建立**新鲜 remote truth**：`git fetch` 后用 `git ls-remote origin master` 核对 exact SHA，
   并核验当前 branch / reviewed HEAD / merge ancestry；不依赖本地 stale ref、旧聊天或旧 handoff。
2. **完整读取**（不是摘要、不是引用）：`AGENTS.md`、`RULES.md`、`docs/project-memory.md`。
3. 读取适用的 Applicable Approved Specs、`docs/product-behavior-contract.md`
   （产品行为任务适用时），以及当前 ticket / Issue 授权。
4. 读取当前 Issue / GitHub Tracker / Ticket Graph，确认当前合法 ticket。
5. 从 repo + GitHub 重建（字段集以 `AGENTS.md` §2 为准）：
   `CURRENT_MASTER` / `CURRENT_ACTIVE_TICKET` / `CURRENT_TICKET_STATUS` / `CURRENT_BRANCH` /
   `CURRENT_HEAD` / `DEPENDENCIES` / `START_GATE` / `REVIEW_STATUS` / `NEXT_LEGAL_ACTION`。
6. **按完整 `AGENTS.md` 执行**——本文件被注入**不**意味着只执行本文件；
   上述清单若有遗漏，以 `AGENTS.md` §2 的清单为准。
7. 按完整 `AGENTS.md` §18 调用所需 skill。可用调用名以其本机 `SKILL.md`
   frontmatter `name` 为准（例如 `/implement`、`/tdd`、`/simplify-code`、`/code-review`）；
   **不要**假设某个文档里的斜杠名一定存在。
8. 对话记忆与 runtime memory（`.workbuddy/memory/` 等）**不得**被当作高于仓库真相的权威。

## 回执（开工证据，非每轮输出）

完成步骤 1–5 后，在该工程任务的**首次实质输出**中给出：

```text
BOOTSTRAP_RECEIPT
REMOTE_MASTER =
AGENTS_FULL_READ = YES
RULES_FULL_READ = YES
PROJECT_MEMORY_READ = YES
APPLICABLE_SPEC_READ = YES / N/A
CURRENT_ISSUE_READ = YES / N/A
NEXT_LEGAL_ACTION =
```

**不要**在每次普通回答里重复打印本回执。它是**开工证据**，不是输出装饰。

## 与权威的关系

**冲突裁决以 `AGENTS.md` §1（裁决原则 1–6）与 `RULES.md` §6 为准。**
下表只是角色清单，按 `AGENTS.md` §1 的列举顺序复述，**不定义新优先级、不改动任何一层**。

| 权威 | 角色（按 `AGENTS.md` §1 口径） |
|---|---|
| `RULES.md` | hard project / safety invariants |
| Applicable Approved Specs | approved product requirements / contracts |
| `docs/product-behavior-contract.md` | 已批准产品合同的可执行归一化视图；不得覆盖 Approved Specs |
| `docs/project-memory.md` | durable project memory |
| GitHub Tracker + child Issues | durable execution state / 当前授权 ticket |
| Git history + remote refs | 已发生事实、exact SHA 与 merge identity 的权威记录 |
| `AGENTS.md` | execution / branch / review / merge / recovery workflow |
| `.workbuddy/memory/` 及其他 runtime memory | runtime working memory，**non-authoritative** |
| **`CODEBUDDY.md`（本文件）** | **仅首轮引导指针；零权威** |

本文件不授予任何权限、不改变任何自动模式、不定义任何例外、不豁免任何 gate。

## 术语（不得混用）

```text
FIRST_TURN_AUTO_INJECTION_COVERAGE  !=  FULL_GOVERNANCE_REACHABILITY
FULL_GOVERNANCE_REACHABILITY        !=  FULL_GOVERNANCE_AUTOMATIC_DELIVERY
AUTO_INJECTION                      !=  FULL_GOVERNANCE_DELIVERY
FILE_EXISTS_IN_REPO                 !=  CONSUMED_AT_RUNTIME
SKILL_INSTALLED                     !=  SKILL_INVOKED
UNKNOWN                             !=  PASS
```

维护契约：本文件长度与结构受 `scripts/validate-codebuddy-bootstrap.mjs` 保护。
**不得**把它扩写成第二份 `AGENTS.md`，也不得为了迁就注入上限而删减 `AGENTS.md` 的成熟治理语义。
