# Kanban Control Plane Contract

> **本文件是 CANDIDATE 阶段的控制面合同，尚未通过独立 review。**
> 在它被独立 reviewer 对某一 exact HEAD 判 PASS 并 ff-only 合并之前，不得被当作
> authority 引用，也不得据它宣称任何 gate 已通过。

```text
DOCUMENT_ID = KANBAN_CONTROL_PLANE_CONTRACT
STATUS = CANDIDATE
AUTHORITY_CLASS = ENGINEERING_CONTROL_PLANE_CONTRACT
BOARD = FlapPearLabs / "Zhihu Engineering Control Board"  (GitHub Projects V2)
REPO = FlapPearLabs/zhihu-grabber-toolkit
HELPER = scripts/kanban-status-transition.mjs
```

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
- Helper 的**真实 project I/O 路径**必须在目标 Project 存在且 token 具备
  `read:project` / `project` 后单独验证；在此之前该路径为 `UNVERIFIED`。
- 本文件不授予任何实现授权，也不改变任何 ticket 的授权状态。
- 把本合同的稳定条款提升进 `AGENTS.md`（`AGENTS.md` §2.1.8 的 workflow governance 路径）
  属于 governance authority change，需要
  `CONTRACT_REVIEWER + CONSISTENCY_REVIEWER` 同 exact HEAD PASS，不在本次范围内。
