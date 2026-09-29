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

但这条规则在 BASE 上**没有任何可执行路径**（每条均为 BASE `3e4240fe…` 机械读出，非推测）：

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
| 按 hash 定位/取回 | `inspectCommittedArtifact({workDir, key, canonicalRel, expectedHash})` → `CANONICAL_MATCH` / `STAGED_MATCH` / `INVALID` / `UNBOUND` | `p1-runtime-composer.mjs:291` |
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
subphase.mjs:432  authorizeTargetedAction(...) 只在 `prior === null` 分支被调用

若 checkpoint 锚定的 ledger 版本可恢复 ⇒
  prior !== null  且  prior.status === ACTION_STATUS_AUTHORIZED
  ⇒ 走 subphase.mjs:378-384 的「plain safe re-run」分支直接执行
  ⇒ authorizeTargetedAction 根本不被调用 ⇒ E.6 dedupe 门不参与 ⇒ E.6 无需任何修改
```

**这是 owner 拒绝 B 选项的机械依据**：B 会改写冻结的 dedupe 不变式；A 在架构层彻底绕开它。

**必须诚实标出的边界**：CASE 2 的「安全重跑」执行时 `attempt` 会变化。但它**不是**「重新授权」——
`targetedActionId` 仍是 ledger 中那条 `AUTHORIZED` 记录的原 id，不新增 record、不新增 dedupeKey、
不进 dedupe 门。它是「同一条**已授权** action 的重跑」，不是「同一个 query 的第二次授权」。
两者在 F.5 / E.6 语义下不是同一件事。实现时必须保证 `targetedActionId` 不变（否则会踩 F.1 identity）。

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

**唯一新增风险 —— staging 清理**（已机械核实，结论 = 沿用既有先例，无需新机制）：

`cleanupStaging`（`:283`）在 resume materialize 流程里会删除 staging 字节
（`:1039`，但 `:1038` **显式排除** `CHECKPOINT_BINDING_COVERAGE_STATE`）。排除的理由由该处代码
自己写明：coverage ledger 是下游每个边界都消费的地基。action ledger 同属此类——它是
dedupe / lifecycle / completion 判定的唯一权威来源。**故实现时 action ledger 必须与 coverage
ledger 同等对待（保留仍被 `state.hashes[LEDGER_CHECKPOINT_KEY]` 锚定的那一版）**，沿用既有
排除机制即可，不新造 retention 策略。此项列为实现阶段强制检查点（§5 G3）。

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
