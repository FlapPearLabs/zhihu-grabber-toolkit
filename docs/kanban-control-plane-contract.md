# Kanban Control Plane Contract

> **本文件是 CANDIDATE 阶段的控制面合同，尚未通过独立 review。**
> 在它被独立 reviewer 对某一 exact HEAD 判 PASS 并 ff-only 合并之前，不得被当作
> authority 引用，也不得据它宣称任何 gate 已通过。

```text
DOCUMENT_ID = KANBAN_CONTROL_PLANE_CONTRACT
STATUS = CANDIDATE
AUTHORITY_CLASS = ENGINEERING_CONTROL_PLANE_CONTRACT
BOARD = "Zhihu Engineering Control Board"  (GitHub Projects V2)
PROJECT_NUMBER = 1
PROJECT_ID = PVT_kwHOCQ5LDs4Bk2mX
PROJECT_URL = https://github.com/users/FlapPearLabs/projects/1
PROJECT_OWNER = FlapPearLabs
PROJECT_OWNER_TYPE = User          ← NOT an Organization
REPO = FlapPearLabs/zhihu-grabber-toolkit
HELPER = scripts/kanban-status-transition.mjs
PROJECT_IO_END_TO_END = VERIFIED   ← see §9
```

> **Owner-type 陷阱（本仓必须记住）**：`FlapPearLabs` 是 **User 账号**，不是 Organization
> （`gh api users/FlapPearLabs` → `type: "User"`；`gh api user/orgs` 为空；仓库 `owner_type` = `User`）。
> 因此任何沿组织语义写下的路径都会失败：
> - GraphQL **不得**用 `organization(login:...)` 解析该 owner；
> - 正确写法是 `repositoryOwner(login:...){ ... on ProjectV2Owner{ ... } }` ——
>   该 interface 由 `User` 与 `Organization` 共同实现，两种 owner 都能解析。
> - 反例：把 `organization(...)` 与 `user(...)` 作为**并列根字段**同时查询**不可行** ——
>   GraphQL 会同时执行两者，错误的那条返回 `Could not resolve to an Organization`，
>   而响应中只要存在 `errors` 数组，整个调用就会被误判为失败，尽管正确的分支已经解析成功。

---

## 1. 本合同的定位

GitHub Project 是**视图与执行控制面**，不是第二份架构权威。

```text
Approved Spec / Ticket Graph
        ↓
GitHub Issues
        ↓
GitHub Project fields / Kanban        ← 本文件只描述这一层
```

硬规则：

1. 项目字段**不得**覆盖 Issue / Ticket Graph / Approved Spec 的任何结论。
2. 移动卡片**永不**改变 DAG 边；依赖边只由 Ticket Graph 定义。
3. 控制面**不授予**任何实现授权；授权只来自 Issue 中记录的 START_GATE 结论。
4. 卡片状态与实际证据冲突时，**改卡片、不改 Issue**；若冲突无法机械消除 → 记录为
   `CONTROL_STATE_NEEDS_RECONCILIATION`，交 product-owner 裁决。

---

## 2. Status 词汇（唯一闭集）

```text
BACKLOG
READY
AUTHORIZED
IN PROGRESS
REVIEW
INTEGRATING / CI
BLOCKED
DONE
```

不得新增生命周期状态。闭集之外的取值一律视为配置错误。

---

## 3. 元数据字段

```text
Stage
Risk
Dependency
Authorization
Ticket
```

- **Risk**：`LOW` / `MEDIUM` / `HIGH` / `SECURITY`
- **Dependency**：`READY` / `BLOCKED` / `EXTERNAL_BLOCKED`
- **Authorization**：`NONE` / `AUTHORIZED`
- **Ticket**：ticket 标识（`P2A-T05` 形式）
- **Stage**：描述性阶段标签，不代表授权

不创建 SHA / branch / CI-run 字段：那些是 Issue 与 Git 证据，不是控制面状态。

### 3.1 授权唯一性（安全相关，不可放宽）

```text
ONLY_AUTHORIZATION_FIELD_GRANTS_AUTHORIZATION = YES
```

- 只有 `Authorization = AUTHORIZED` 表示已授权，且必须能回溯到 Issue 中的 START_GATE PASS 记录。
- **任何其他字段**（含 `Stage`、`Status`、`Dependency` 的自由文本取值）**一律不得**被读作授权。
- 控制面**不得**为了让卡片看起来整齐而写入 `AUTHORIZED`。
- 卡片不得成为授权的*来源*；它最多是授权*结果*的一次投影。

---

## 4. 生命周期事件 → Status 迁移

每个事件都是**幂等**的：若当前 Status 已等于目标值 → 不产生任何写入，判定 `NOOP`。

| 事件 | 目标 Status | 允许的前置 Status |
|---|---|---|
| `DEPENDENCY_RECOMPUTED_READY` | `READY` | `BACKLOG`, `BLOCKED` |
| `START_GATE_PASS` | `AUTHORIZED` | `READY`, `BLOCKED` |
| `IMPLEMENTATION_LANE_CREATED` | `IN PROGRESS` | `AUTHORIZED` |
| `REMOTE_CANDIDATE_PUSHED` | `REVIEW` | `IN PROGRESS` |
| `EXACT_SHA_QUORUM_PASS` | `INTEGRATING / CI` | `REVIEW` |
| `INTEGRATION_COMPLETE` | `DONE` | `INTEGRATING / CI` |
| `BLOCKER_DISCOVERED` | `BLOCKED` | `BACKLOG`, `READY`, `AUTHORIZED`, `IN PROGRESS`, `REVIEW`, `INTEGRATING / CI` |

规则：

1. 上表是**闭集**。未列出的 (事件, 前置) 组合一律拒绝（fail closed），不得就近猜测。
2. `DONE` 是终态，没有出边。重新打开必须走 Issue 层决策，不接受控制面事件。
3. `INTEGRATION_COMPLETE` 的语义是合取：
   `MERGED && REMOTE_VERIFIED && CI_PASS && ISSUE_CLOSED`。
   任一条件不成立时不得调用该事件。
4. `BLOCKER_DISCOVERED` 只记录阻塞事实，不判定阻塞原因、不授予解除权限。
5. 事件是**输入**，不是结论。调用者必须先拥有该事件成立的真实证据。

---

## 5. 依赖就绪 ≠ 授权

```text
Dependency = READY  ⇏  Authorization = AUTHORIZED
```

因此以下组合是**合法且常见**的：

```text
Status        = READY
Dependency    = READY
Authorization = NONE
```

控制面必须能表达这种状态。任何把「依赖就绪」渲染成「可以开工」的字段或视图都是缺陷。

---

## 6. 对账（reconciliation）

发生下列情况时，**不要**据卡片改写 Issue：

- 卡片 Status 与 Issue 记录不一致；
- 存在未被 Issue 记录的实现活动（例如提前出现的实现分支 / worktree）；
- 依赖状态与 Ticket Graph 推导不一致。

处置：

1. 保留 Issue 为事实源，不动 Issue 授权结论；
2. 在控制面把不一致**显式标出**，而不是抹平；
3. 若不一致无法由机械规则消解 → `CONTROL_STATE_NEEDS_RECONCILIATION`，
   由 product-owner 裁决，不在本合同的授权范围内自行判定。

同时存在的独立施工 lane **不构成**控制面阻塞：另一个 ticket 的施工状态是**观察项**，
不是本控制面自身的 blocker。

```text
TICKET_CONTROL_STATE_ANOMALY  !=  CONTROL_PLANE_BLOCKER
```

---

## 7. Helper 合同

```text
scripts/kanban-status-transition.mjs
```

```bash
# 纯离线：校验事件→Status 映射表（无网络、无凭据、无 gh 调用）
node scripts/kanban-status-transition.mjs --self-test

# 只计算并打印将要执行的迁移，不写入
node scripts/kanban-status-transition.mjs --issue 117 --event START_GATE_PASS --dry-run

# 应用迁移（写入后重新读取并核验）
node scripts/kanban-status-transition.mjs --issue 117 --event START_GATE_PASS
```

退出码：`0` = 已应用或幂等 NOOP；`1` = 合同违规（未知事件 / 非法迁移 / 参数错误）；
`2` = 环境失败（gh 缺失、缺 `read:project` / `project` scope、project 或 item 未找到）。

**Helper 只做一件事**：

```text
issue number + lifecycle event  →  经校验的 Status 字段迁移
```

它**不得**：

```text
决定授权
修改 Issue 状态或授权记录
改变 DAG / 依赖边
推断架构语义
创建分支 / worktree 或启动任何实现
写入 Status 之外的任何字段
```

若现有工具已能完成该能力，应复用而不是新增第二个系统。

---

## 8. 本文件不证明什么

```text
CONTRACT_EXISTS          !=  CONTRACT_ENFORCED
HELPER_SELF_TEST_PASS    !=  PROJECT_IO_VERIFIED
BOARD_FIELD_SET          !=  BOARD_STATE_CORRECT
```

- `--self-test` 只校验映射表与迁移闭包，不接触 GitHub。
- Helper 的**真实 project I/O 路径**已在 `read:project` / `project` 到位后单独验证（见 §9）；
  验证结论只对**被验证的 exact HEAD 与被观察的 board 状态**成立，不自动继承到后续修改。
- 本文件不授予任何实现授权，也不改变任何 ticket 的授权状态。
- 把本合同的稳定条款提升进 `AGENTS.md`（`AGENTS.md` §2.1.8 的 workflow governance 路径）
  属于 governance authority change，需要
  `CONTRACT_REVIEWER + CONSISTENCY_REVIEWER` 同 exact HEAD PASS，不在本次范围内。

---

## 9. 看板配置与验证记录

### 9.1 字段

```text
Status        = PVTSSF_lAHOCQ5LDs4Bk2mXzhjloGo   (8 值闭集；由 GitHub 默认 Status 就地改写，字段 ID 未变)
Stage         = PVTSSF_lAHOCQ5LDs4Bk2mXzhjloVw   DESIGN_ONLY / EXPERIMENT_READY / ACTIVE_FEATURE /
                                                 EXTERNAL_DEPENDENCY / IMPLEMENTATION
Risk          = PVTSSF_lAHOCQ5LDs4Bk2mXzhjloXk   LOW / MEDIUM / HIGH / SECURITY
Dependency    = PVTSSF_lAHOCQ5LDs4Bk2mXzhjloXo   READY / BLOCKED / EXTERNAL_BLOCKED
Authorization = PVTSSF_lAHOCQ5LDs4Bk2mXzhjloXs   NONE / AUTHORIZED
Ticket        = PVTF_lAHOCQ5LDs4Bk2mXzhjloXw     文本（T01…T15）
```

未创建任何 SHA / branch / CI-run 字段 —— 那些属于 Issue 与 Git 证据。

### 9.2 视图

视图由 GraphQL `createProjectV2View` + `updateProjectV2View` 程序化创建；
CLI 的 `gh project` **没有** view 子命令，`createProjectV2View` 的 `configuration`
也只接受 `visibleFieldIds`，**filter 只能在 `updateProjectV2View` 阶段设置**。

| # | 名称 | layout | filter |
|---|---|---|---|
| 2 | `CURRENT STAGE` | BOARD | `-status:BACKLOG -status:DONE` |
| 3 | `P2-ARI ROADMAP` | TABLE | *(空 — 项目内即 #107–#127)* |
| 4 | `BLOCKED` | TABLE | `dependency:BLOCKED,EXTERNAL_BLOCKED` |
| 5 | `DONE` | TABLE | `status:DONE` |

创建项目时自动生成的空白默认视图 `View 1` 已删除。

未知项：filter 字符串由 GraphQL 接受并原样存回，但**其语义正确性未经独立验证**
（API 不做过滤校验）。首次人工打开视图时应目视核对命中集合。

### 9.3 初始化状态（2026-09-27，基于当时的 fresh 证据）

```text
DONE                  = T01 #113, T04 #116
REVIEW                = T05 #117          (授权 + 分支已推送 + PR #128 OPEN)
READY (未授权)        = T02 #114, T03 #115, T07 #119
BACKLOG / Dep=BLOCKED = T06 #118, T08 #120 … T14 #126
BACKLOG / Dep=EXTERNAL_BLOCKED = T15 #127（#107 为非 DAG 外部依赖）
顶层特征 #107–#112     = BACKLOG，Stage 描述性，Authorization = NONE
```

证据来源：Ticket Graph V1 `§3` 直接边与 `§5` RISK 表（@origin/master）、各 Issue 正文的
`IMPLEMENTATION_AUTHORIZATION`、#117 的 **START GATE 评论**（`GATE_RESULT = PASS`，
`IMPLEMENTATION_AUTHORIZATION = SCOPED_TO_P2A_T05_ONLY`）、远端分支
`work/p2a-t05-bounded-authorization-action-identity` 与 PR #128。

> 教训：`#117` 的 START GATE 结论**不在 Issue 正文里，而在评论里**。
> 只读 Issue body 会得出"该票未授权"的错误结论。判定授权**必须同时读评论**。

### 9.4 Helper I/O 验证（对 candidate HEAD 实测）

```text
read  路径：--issue 117 --event REMOTE_CANDIDATE_PUSHED --dry-run  → NOOP (status 已 = REVIEW)   exit 0
read  路径：同上去掉 --dry-run                                     → NOOP (未写入)               exit 0
写入  路径：先将 #114 故意扰动为 BACKLOG，再调用
            --issue 114 --event DEPENDENCY_RECOMPUTED_READY         → APPLIED BACKLOG -> READY    exit 0
            re-read 核验 status=READY / authorization=NONE / dependency=READY（Authorization 未被触碰）
拒绝  路径：--issue 113 --event IMPLEMENTATION_LANE_CREATED --dry-run
            → REFUSED，reason = TERMINAL_STATUS_HAS_NO_OUT_EDGE（DONE 无出边）                     exit 1
```

### 9.5 运行前提（否则 helper 会以 exit 2 失败）

```text
- token 需具备 `project`（含读）；缺失时 helper 报 ENVIRONMENT_FAILURE 并给出修复命令。
- 环境中的 GH_TOKEN 若存在但失效，会**遮蔽** keyring 凭据并让所有调用 401；
  helper 继承父进程环境，因此调用前必须确保 GH_TOKEN 指向有效凭据或已 unset。
```

### 9.6 授权语义（防误读）

`Authorization` 只写 `NONE` / `AUTHORIZED`，且 `AUTHORIZED` 必须能回溯到 Issue（含评论）中的
START GATE PASS 记录。T05 的授权来自 #117 的 START GATE 评论，因此其为 `AUTHORIZED`；
若将来发现卡片与 Issue 证据冲突，按 §6 处理，**不得**为整卡观感改写授权字段。
