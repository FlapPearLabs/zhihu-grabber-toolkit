# P2-ARI #108 — F.5 Checkpoint-Anchored Action Ledger — Bounded Architecture Amendment V1

> **命名守卫**：本文 `P2-ARI` = `P2 / ADAPTIVE_RESEARCH_INTELLIGENCE`（#107–#112），
> 与 2026-08-25 Product Direction 的 `LEGACY P2 = AUTHOR / PERSONAL INTELLIGENCE` 无关。
> 本文**不**修改、不重解释、不覆盖 LEGACY P2。

```text
DOCUMENT_ID   = P2_ARI_108_F5_CHECKPOINT_ANCHORED_LEDGER_AMENDMENT_V1
STATUS        = CANDIDATE（待独立 architecture/contract 审查；尚未批准）
PREVIOUS_STATUS = NONE（本文件为新文件；不改写任何既有权威的 STATUS）
AMENDS        = docs/planning/P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1.md §F.5
                docs/specs/p2-ari-f02-targeted-requery.md §12
                docs/architecture/key-decisions.md D12
TARGET_ISSUE  = #130（SEAM_NOT_FROZEN = F.5）→ 关闭后重新形成合法的 T09 repair candidate（#121）
OWNER_DECISION = A — ANCHOR_ACTION_LEDGER_IN_CHECKPOINT
                （记于 #130 comment，append-only；本文是该决定的架构落地）
BASE_SHA      = 3e4240fe841eed8c3239a2395c9a425fa5c2e7ed
REVIEWED_CODE = 3e4240fe841eed8c3239a2395c9a425fa5c2e7ed（master：lifecycle / authorization / state / composer）
                ∪ 60ee327a27eb59e3bc5389c35bbdbdf2482f76ac（T09 候选，未合入，从 3e4240fe 分叉：
                  targeted-requery-subphase.mjs **只存在于此分支**，不在 master 上）
SEMANTIC_AUTHORITY_UNCHANGED =
                docs/specs/p2-ari-f02-targeted-requery.md（本文不发明新语义，只解冻 F.5 的可执行性）
```

## 0. 本文是什么、不是什么

**是**：一份**有界**的架构修正案，只做一件事——让 F.5 已经写下的「安全重跑一次」在代码里
**真正可执行**：给 action ledger 一个 checkpoint 可恢复的不可变身份，并把它锚定进唯一信任根。

**不是**：

- **不**改 E.6 `dedupeKey` 字段集（`{gapIdentityCore, normalizedQuery, providerScope}`，刻意排除 `attempt`）——逐字冻结；
- **不**改 T06 `LEGAL_TRANSITIONS`（无 `committed → authorized` 路径）——逐字冻结；
- **不**引入 sidecar receipt / 第二信任根（F.5 诚实代价声明已判定此类为 P0）；
- **不**新建第二 checkpoint 系统（复用 `p1-runtime-composer.mjs` 的 content-addressed staging +
  `state.mjs` 的 `writeState` / `validateArtifactCheckpoint`）；
- **不**改 F.5 的产品语义，只补齐它的可执行性前提；
- **不**授权实现（`IMPLEMENTATION_AUTHORIZATION = NONE`，见 §6）。

## 1. 问题陈述：F.5 的「安全重跑一次」在当前代码下不可达

F.5 `DUPLICATE_REPLAY_RULE` 与 spec §12 都写下：

```text
hash 不匹配 / 产物缺失 → 视为未提交，安全重跑一次
```

但这条规则在当前代码上**没有任何可执行路径**。下表每条均为**机械读出，非推测**；
注意行 #3/#3b/#3c 引用的 `targeted-requery-subphase.mjs` **只存在于 T09 候选 `60ee327a…`**
（未合入，从 `3e4240fe…` 分叉），不在 master 上——这一区分是实质性的，不是引用格式问题：

| # | 冻结事实 | 机械证据 | 后果 |
|---|---|---|---|
| 1 | ledger 是**单文件原地覆盖** | `targeted-requery-lifecycle.mjs:253` `ACTIONS_FILENAME = 'targeted-requery-actions.json'`；`:641-670` `persistActionsArtifact` = temp + **in-place** rename | 新 COMMITTED 版本覆盖旧字节；仅「给该文件加一个 `state.hashes` 条目」**挡不住** owner 警告的失效点 |
| 2 | commit 顺序把 ledger 写在 checkpoint **之前** | `:995-1052` `prepareTargetedCommit`：(a) `stageTargetedArtifact` fsync → (b) `advanceActionStatus(COMMITTED)` + `persistActionsArtifact` → (c) binding hash 进**内存** `state.hashes` → (d) `writeState` | 崩在 (b)~(d) ⇒ ledger 已是 COMMITTED、checkpoint 无 binding ⇒ 无完成证据 |
| 3 | **授权路径当前不写 checkpoint** | `targeted-requery-subphase.mjs:462-463` `registerAuthorizedAction` + `persistActionsArtifact`，**无 `writeState`** | owner constraint #5「checkpoint 仍指向之前的 AUTHORIZED ledger version」**当前不成立** |
| 3b | 由此 REUSE 分支**永远不可达** | `subphase.mjs:357` `decideTargetedReplay` 要求 `state.hashes[bindingKey]` 为 64-hex；`lifecycle:1122-1126` 无 hash ⇒ `RERUN` | 这是 #130 那个 P1 的一半 |
| 3c | 而 RERUN 只能靠未锚定凭据「复用」 | `subphase.mjs:419` `readBoundTargetedPool(workDir, prior.artifactRel, prior.artifactHash)` 用 `record.artifactHash`（存于**未入 checkpoint** 的 ledger 文件） | 正是 P1-R06 判定的 P0 级未锚定第二凭据 |
| 4 | 但「重新授权一次」同样不可达 | `dedupeKey` 排除 `attempt` ⇒ 同一 query 重新授权得同一 key ⇒ `EQUIVALENT_QUERY_ALREADY_AUTHORIZED`（`targeted-requery-authorization.mjs:204`） | F.5 的补笔**两个方向都堵死** |

**结论**：`prior.status === AUTHORIZED` 时走既有「plain safe re-run」分支（`subphase.mjs:378-384`）是
唯一**合法**的重跑路径——它不进 dedupe 门。而要让 resume 看见 `AUTHORIZED`，checkpoint 必须锚定
**授权时刻那一版**的 ledger。这就是本修正案的唯一目标。

## 2. 决策：给 ledger 一个 checkpoint 可恢复的不可变身份

**决策**：ledger 每次权威性变化时，先把新字节写入 **content-addressed staging 路径**，再把该字节的
sha256 写入 checkpoint 的一个**专用 key**；resume 只把 checkpoint 锚定的那一版当作权威。

```text
LEDGER_CHECKPOINT_KEY = 'targeted-action-ledger'
LEDGER_STAGING_KEY    = 'targeted-action-ledger'   （复用既有 COMMIT_STAGING_DIR 命名空间）
LEDGER_CANONICAL_REL  = 'targeted-requery-actions.json'   （T06 的 ACTIONS_FILENAME，逐字不动）

AUTHORITY_RULE =
  ledger 的权威版本 = state.hashes['targeted-action-ledger'] 指向的那一版字节
  · 该 key 缺失 ⇒ 无权威 ledger ⇒ 不得以「canonical 文件存在」为权威（fail-closed，不猜）
  · canonical 路径上存在更新但未被 checkpoint 锚定的字节
    → 【不得】参与 dedupe / lifecycle / completion 判断（owner constraint #4）
```

### 2.1 复用既有 primitive（owner constraint #2 的机械证据）

| 需要的能力 | 复用的既有 primitive | 位置 |
|---|---|---|
| content-addressed 字节暂存 | `stageArtifactBytes(workDir, key, bytes)` → `.p1-commit-staging/<key>/<sha>.json` | `p1-runtime-composer.mjs:258` |
| 按 hash 定位/取回 | `inspectCommittedArtifact({workDir, key, canonicalRel, expectedHash})` → `CANONICAL_MATCH` / `STAGED_MATCH` / `INVALID` / `UNBOUND` | `p1-runtime-composer.mjs:293` |
| checkpoint 唯一提交点 | `writeState(workDir, state)` | `state.mjs:238` |
| 字节校验 | `validateArtifactCheckpoint(workDir, rel, expectedHash)` | `state.mjs:311` |
| 文件替换协议 | fsync → temp → rename（`persistActionsArtifact` 已用同一协议） | `targeted-requery-lifecycle.mjs:641` |

**没有新造第二 checkpoint 系统**：`LEDGER_CHECKPOINT_KEY` 是 `state.hashes` 里的一个新 key，
`LEDGER_STAGING_KEY` 是既有 staging 目录下的一个新子目录。两者都是既有机制的参数，不是新机制。

### 2.2 恢复时序（逐 crash 窗口）

```text
CASE 1 — crash BEFORE commit
  durable: 旧 ledger 字节（仍被 checkpoint 锚定）
  checkpoint: 指向旧 ledger hash
  resume: 读到旧 ledger ⇒ 该 action 状态 = 旧值（通常 AUTHORIZED 或更早）
          → 走既有 AUTHORIZED「plain safe re-run」分支 ⇒ 安全重跑，不进 dedupe
  ✅ 满足 owner constraint #5；E.6 逐字不动

CASE 1b — crash DURING ANCHOR 1（授权已 persist，writeState 未完成）  ← 首轮审查补入
  durable: 新的 AUTHORIZED ledger 字节（canonical + staging 都有）
  checkpoint: 仍指向【旧】ledger 版本
  resume: 只读锚定版 ⇒ 看到的是该 action 授权【之前】的 ledger
          · 已有旧版本 → 走既有路径，下一轮重新授权（安全；授权在 IO 之前，无重复付费）
          · 首次授权、checkpoint 无该 key → fail-closed，UNKNOWN 上浮
  ✅ 不产生虚假完成证据，不违反 constraint #5
  ⚠️ 诚实的行为变化：当前实现用 canonical 读取，首次授权崩溃后仍能恢复该 AUTHORIZED 记录；
     本修正案要求只认锚定版，故此窗口从「可恢复」变为「fail-closed / 重新授权」。
     这是「不猜」的代价，属 owner constraint #4 的必然结果。

CASE 2 — crash BETWEEN (b) and (d)  ← #130 的核心 crash window
  durable: 新 ledger 字节（COMMITTED），staging 里有 content-addressed 副本
  checkpoint: 仍指向【旧】ledger hash
  resume: 只读 checkpoint 锚定的那一版 ⇒ 看到的是 AUTHORIZED，不是 COMMITTED
          → 走 AUTHORIZED 分支 ⇒ 安全重跑一次（承认可能重复付费一次 = F.5 诚实代价）
  ✅ 这正是 F.5 原文写下的行为，且【不】复用任何未锚定凭据
  ⚠️ staging 里已存在的 COMMITTED 版本：【不】参与判断（constraint #4）

CASE 3 — crash AFTER (d) / 正常运行
  durable: round artifact + 新 ledger 字节均 durable
  checkpoint: 锚定【新】ledger hash + 每个 COMMITTED action 的 binding hash
  resume: 读到 COMMITTED 且 binding hash 有效 ⇒ REUSE（绝不重新付费）
  ✅ 这使 F.5 的 REUSE 分支第一次真正可达

CASE 3b — checkpoint 锚定的 ledger 版本字节已丢失
  checkpoint: 锚定了一个已不存在的 hash
  resume: 【fail-closed】anchored ledger version unrecoverable
  ✅ 守护 UNKNOWN != PASS（UNKNOWN 必须 surface，不得洗成干净结果）
```

### 2.3 为什么这让 E.6 逐字不需要改

```text
subphase.mjs:438  authorizeTargetedAction(...) 只在 `prior === null` 分支被调用

若 checkpoint 锚定的 ledger 版本可恢复 ⇒
  prior !== null  且  prior.status === ACTION_STATUS_AUTHORIZED
  ⇒ 走 subphase.mjs:378-384 的「plain safe re-run」分支直接执行
  ⇒ authorizeTargetedAction 根本不被调用 ⇒ E.6 dedupe 门不参与 ⇒ E.6 无需任何修改
```

**这是 owner 拒绝 B 选项的机械依据**：B 会改写冻结的 dedupe 不变式；A 在架构层彻底绕开它。

**必须诚实标出的边界（2026-09-29 首轮审查后更正）**：重跑**复用原记录**——
`subphase.mjs:378-384` 是 `action = prior`，`attempt` 与 `targetedActionId` **均不变**。
这正是它「不是第二次授权」的原因，而不是「attempt 会变但 id 不变」。

更正理由：F.1 的 `TARGETED_ACTION_ID_FIELDS` **包含 `attempt`**
（`targeted-requery-authorization.mjs:385-393`），`computeTargetedActionId` 对其取哈希。
若 `attempt` 真的变化，`targetedActionId` 必然随之变化 —— 那就构成新身份、新 record、
新 dedupeKey，反而正是被 E.6 拒绝的那件事。故「attempt 变而 id 不变」在 F.1 下自相矛盾，
本文原表述已作废。正确表述更强也更干净：重跑不新增任何身份，因此不进 dedupe 门、
不重复计入 F.6 预算（`findRecord` 是 `findIndex`，每个 id 至多一条 record；
`computeTargetedAttemptCounts` 按 record 计数）。

仍需实现阶段保证的只有一条：**不得**在重跑路径上调用 `registerAuthorizedAction`
或以任何方式新增 record —— 那会把重跑变成第二次授权并踩 E.6。

### 2.4 两处 checkpoint 锚点（owner constraint #6 的落点）

```text
ANCHOR 1 — AUTHORIZE 时
  registerAuthorizedAction → persistActionsArtifact(新字节)
    → stageArtifactBytes(LEDGER_STAGING_KEY, 新字节) → 把 sha256 写入 state.hashes[LEDGER_CHECKPOINT_KEY]
    → writeState          ← 新增的第 1 个 commit point
  语义: 授权是「值得付费的决定」，必须 checkpoint-anchored，否则 resume 无法证明它被授权过

ANCHOR 2 — targeted commit point（既有 writeState，不新增 commit point）
  prepareTargetedCommit (a) round artifact bytes fsync
              (b) advanceActionStatus(COMMITTED) + persistActionsArtifact
                  + stageArtifactBytes(LEDGER_STAGING_KEY, 新字节)
                  + state.hashes[LEDGER_CHECKPOINT_KEY] = 新 sha256
                  + state.hashes[bindingKey]            = round artifact sha256
              (c) ↑ 全部仍只在内存
              (d) finalizeTargetedCommit = writeState  ← 唯一 commit point（语义不变）
  语义: 两个 hash + action binding 进入【同一个】checkpoint state，原子可见
```

**唯一 commit point 仍只有 `writeState`**。ANCHOR 1 是**授权**这个独立决定的 commit point，
与 targeted commit 是两个不同的原子事件；anchor 2 不新增任何 commit point。

### 2.5 爆炸半径

```text
需要改动的 surface:
  · targeted-requery-lifecycle.mjs   —— 暴露 ledger 字节的 content-addressed 暂存 + 锚点 key
  · targeted-requery-subphase.mjs    —— 授权后锚定；resume 改读 checkpoint 锚定版本
  · p1-runtime-composer.mjs          —— 终态重建 / resume 时携带 LEDGER_CHECKPOINT_KEY
  · state.mjs                        —— 不改（复用 writeState / validateArtifactCheckpoint）

【不需要】改动:
  · E.6 dedupeKey 字段集            —— 逐字不动
  · T06 LEGAL_TRANSITIONS            —— 逐字不动
  · F.5 / spec §12 的产品措辞         —— 逐字不动（本文只补可执行性前提）
  · round artifact 布局               —— T09 已用 per-action 路径
                                      （`subphase.mjs:503` `action-<id>/retrieval-pool.json`），
                                      天然不可变，无需改动
```

## 2.6 SEAM_NOT_FROZEN 自检（owner constraint #8）

> 若现有仓库机制无法保留/恢复 checkpoint 所指向的上一 ledger 版本，SEAM_NOT_FROZEN，停止并报告。

**结论：机制充分，不触发 SEAM_NOT_FROZEN。** 证据：`stageArtifactBytes`（`p1-runtime-composer.mjs:258`）
写入 `.p1-commit-staging/<key>/<sha>.json`，路径由内容 hash 决定、旧版本不会被覆盖；
`inspectCommittedArtifact`（`:291`）在 canonical 不匹配时正是去 staging 按 hash 找
（返回 `STAGED_MATCH`）。这与 P1-R06 已在生产中使用的 coverage ledger / accumulated pool
恢复机制**完全同构**（`p1-runtime-composer.mjs:470-556` 的 materialize 流程）。

**唯一新增风险 —— staging 清理**（已机械核实；结论 = 必须改一行代码，不是零成本）：

`cleanupStaging`（`:283`）在 resume materialize 流程里会删除 staging 字节。`:1038` 的排除是
**硬编码单个 key** 的比较：

```js
if (item.key !== CHECKPOINT_BINDING_COVERAGE_STATE) { cleanupStaging(item.stagedPath); }
```

action ledger 若以新 key `targeted-action-ledger` 暂存，`'targeted-action-ledger' !==
CHECKPOINT_BINDING_COVERAGE_STATE` 为真 ⇒ 该循环会**删掉仍被 checkpoint 锚定的那一版**
⇒ 触发 CASE 3b fail-closed。故实现**必须**把 `:1038` 扩为同时排除 `LEDGER_CHECKPOINT_KEY`。
这是**必需的一行代码改动**，不是「沿用既有机制即可」的零成本参数。列为强制检查点（§5 G3）。

## 3. 对既有权威的最小修改（append-only，不改写历史）

```text
1. docs/planning/P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1.md §F.5
   追加 F.5.1「ledger 权威版本判定」，逐字保留 F.5 原文
   → 新增: AUTHORITY_RULE + 四种 crash 窗口的恢复行为（§2.2）
   → 不改: COMMIT_POINT 措辞、E.6、LEGAL_TRANSITIONS

2. docs/specs/p2-ari-f02-targeted-requery.md §12
   追加一行: ledger 权威版本 = checkpoint 锚定版本（引用 F.5.1）
   → §12「安全重跑一次」原文逐字保留

3. docs/architecture/key-decisions.md D12
   追加 D12 修正段落: LEDGER_ANCHORED_IN_CHECKPOINT
   → D12 STATUS = APPROVED 不变；本次只追加决策内容
```

## 4. 与 owner 保留的两项 P2 的关系

以下两项属 T09 自身 scope，**不被本修正案阻塞**，待 blocker 解除后与 finding-scoped repair 一并做：

```text
P2-1  persist the controller-owned gap ledger（S1 / F.4）
P2-2  global budget preflight 必须覆盖 planned attempts + targeted attempts（F.6 / §11）
```

本文**不**顺带修这两项，也**不**为其扩授权。

## 5. 实现阶段的强制检查点（授权扩大后才生效）

```text
G1  E.6 dedupeKey 字段集逐字未变（source-level assertion）
G2  T06 LEGAL_TRANSITIONS 逐字未变（source-level assertion）
G3  cleanupStaging 不得删除仍被 state.hashes[LEDGER_CHECKPOINT_KEY] 锚定的版本
G4  四个 crash 窗口各有一个真实测试（不得用 crashPoint 手工抛错冒充 SIGKILL，
    不得用源码正则冒充 resume —— 参见 T09 已踩过的两个测试保真度缺陷）
G5  resume 后每个 targetedActionId 恰好一次 COMMIT
G6  CASE 2 断言 dedupe 门【未被调用】（证明 E.6 绕开而非放宽）
```

## 6. 授权状态

```text
IMPLEMENTATION_AUTHORIZATION = NONE
本文 STATUS = CANDIDATE —— 尚未批准，不授权任何实现

NEXT = 独立 architecture/contract review（fresh independent reviewer；executor ≠ reviewer）
PASS 后才可扩大实现授权（届时另行记录授权范围，覆盖 T06-owned checkpoint surface）
```
