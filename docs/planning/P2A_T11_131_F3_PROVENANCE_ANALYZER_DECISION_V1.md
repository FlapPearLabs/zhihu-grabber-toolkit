# P2A-T11 / #131 — F.3 Provenance Analyzer 架构决策（V1）

```text
DOC_ID            = P2A_T11_131_F3_PROVENANCE_ANALYZER_DECISION_V1
TYPE              = ARCHITECTURE_DECISION + PLANNING
TICKET            = P2A-T11（#123）
FOLLOWUP          = #131（P0，独立票）
PARENT_FEATURE    = #108
BASE              = master @ 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
SUBJECT_SHA       = work/p2a-t11-trust-boundary-executable-guards @ 293495626d993137f2691f99df4dce2cb156762b（r11，frozen，本文件不改它）
IMPLEMENTATION_AUTHORIZATION = NONE
NEW_CODE_CHANGED            = NONE
LIB_TOUCHED                = NONE
T11_R11_MODIFIED           = NO
```

> 本文件**不是**第二份架构权威。它是 #131 的**证据沉淀 + 方案比较 + 推荐**，不覆盖
> `docs/specs/p2-ari-f02-targeted-requery.md`（Approved Spec，语义唯一权威）、`RULES.md`、
> `AGENTS.md`，也不改动 T11 r11 已冻结的实现。
> **本文件不授予实现授权。** 落地需另开 remediation ticket 并走独立授权。

---

## PART 0 — FRESH TRUTH（本轮实测，无历史 SHA 沿用）

```text
git ls-remote origin refs/heads/master                                  = 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
git ls-remote origin refs/heads/work/p2a-t11-trust-boundary-executable-guards = 293495626d993137f2691f99df4dce2cb156762b
local master                                                             = 2afe106ea9e5420c84ad8a240dfa9bae01b012cd  (= remote)
local work/p2a-t11-...                                                   = 293495626d993137f2691f99df4dce2cb156762b  (= remote)
git fetch --prune                                                        = EXIT 0
stale .git/*.lock                                                        = none
open PR                                                                  = []  (zero)
#123                                                                     = OPEN
#131                                                                     = OPEN, label [bug]
#108                                                                     = OPEN
remote branch count                                                      = 64
```

## PART 1 — T11 现状（r11 保持 frozen）

### 已解决的问题（r11 相对 r10）

r11 commit `2934956` 只含 **2 个 test 文件**（+511 / -11）：

- `test/helpers/t11-trust-surface-enumeration.mjs`（+209）
- `test/p2a-t11-trust-boundary-executable-guards.test.mjs`（+313）

已关闭的 r11 两个具名 P1：

| P1 | 内容 | r11 修法 |
|---|---|---|
| P1-1 | inline 表达式里的成员读被 `provenanceIdentifiersIn` 剥掉属性名 → 空 verdict = **fail-open** | 新导出 `memberWritePathsIn(source, expr)`，**只对模块真实存在 property write 的成员**做成员路由；抽出单一定义 `propertyWritePattern(name)` 供 `propertyWriteBindingsOf` 与 `memberWritePathsIn` 共用 |
| P1-2 | `localWalkerNames` 只匹配 `(?:const\|let\|var) NAME = IDENT` → `let w; w=…` / `const w=rrf.assertArtifactSafe;` / `.bind(null)` 站点从所有列表**消失**（非 unparsed） | 裸名直接比较 + 成员分裂双判定（`splitMemberAccess('assertArtifactSafe')` 返回 **null**，裸名不是成员访问）；fixpoint loop 经 mutation 证明冗余后**已删除** |

### 已有测试覆盖（本轮实跑）

```text
node --test test/p2a-t11-trust-boundary-executable-guards.test.mjs
→ 1..32 / # tests 32 / # pass 32 / # fail 0 / duration 1682 ms
```

新增 4 个回归测试：`r11 P1-1` / `P1-1b` / `P1-2`（7 文件合成 fixture）/ `P1-2b`（负控制）。
7 个 helper 级 mutation **M1–M7 全部被新测试 catch** → 当时判定测试非空洞。

### 已通过的 reviewer / 当前状态

| 项 | 状态 |
|---|---|
| r10 及更早轮次 CODE_REVIEW | 已通过（r6/r7 等修复记录在 commit 历史） |
| **r11 fresh SECURITY review** | **CHANGES_REQUESTED** |
| `OPEN_P0_P1` | **3**（P1-A / P1-B / P1-C） |
| integration / CI / closeout | **FORBIDDEN** |
| open PR | **0 个** |

### 三个 P1（本轮只复述，不在本文件解决）

- **P1-A**：`propertyWritePattern` 接收者正则是 `([A-Za-z_$][\w$]*)` —— **单个裸标识符**，
  故 `state.inner.trusted = …`（点号接收者）永不匹配 → 成员路由跳过 → 读作 CLEAN。
  已冻结实测：把真实 `targeted-requery-subphase.mjs:898` 改成点号接收者后套件 **32/32 全绿**。
- **P1-B**：成员持有的信任集**构造后 `.add()`** 放宽漏检。根因 = 成员分支只走
  `propertyWriteBindingsOf` + `walk(receiver)`，**从不调 `bindingsOf(name)`**，而
  `.add/.delete/.clear` 的 receiver-mutation 规则住在 `bindingsOf` 里。
- **P1-C**：枚举层仍有调用点 **ABSENT**（逗号多声明链后续声明符 / 解构赋值 / `.bind` 嵌套括号 /
  `.call`/`.apply` 等）→ 连 `unparsed` 都不进，A1 不变绿 → C3 永不迭代。
  其中 5 项在 r10 **同样 ABSENT** → r11 是**部分修复**，非回归。

> **诚实标注**：P1-A 的「32/32 全绿」是**r11 冻结态下真实可复现的 fail-open**。
> 本文件不修它，也不改 r11；#131 与 P1-A 是**两个独立缺陷**，不应混为一票。

---

## PART 2 — 遗留 worktree 清理（已完成，零可达性损失）

`p2a-t11-verify`（detached HEAD `2c750ad`）本轮**重新机械验证**后删除。

| 前置条件 | 证据 |
|---|---|
| 1. 无独有内容 | 两个修改文件 blob 与 **r10 `9bcf63f` byte-identical**：helper `2a7f04d3…`、test `51ba2104…`；`git diff 9bcf63f -- <两文件>` 输出为空。旁证：内容**无** `memberWritePathsIn`，而 r11 有 3 处 → 确为 r10 之前状态 |
| 2. r10 内容已在本地 ref 保全 | `merge-base --is-ancestor 9bcf63f work/p2a-t11-…` = YES |
| 3. 已在远端 ref 保全 | fresh `ls-remote` 得远端 tip `2934956`；`is-ancestor 9bcf63f 2934956` = YES |
| 4. detached HEAD 亦非唯一 | `is-ancestor 2c750ad 2934956` = YES（`2c750ad..2934956` = 11 commits） |
| 5. 备份可反向验证 | `t11-verify-uncommitted-r11.patch` 235844 B，sha256 `973a50b06858b2572734e04eb64afbdaf534658651294f1514726ea60b0705e5`；`git apply --check --reverse` = OK |
| 6. 共享依赖未被波及 | `research-orchestration/node_modules` 是指向 `p2a-t09-r1` 的**符号链接**；先 `unlink` 符号链接本身，删除后复验 `p2a-t09-r1/…/node_modules` **仍存在** |

执行：`git worktree remove`（先试 `-d`，git 以 `contains modified or untracked files` 正确拒绝）
→ 满足上述六项后单次 `git worktree remove --force`，EXIT=0。
结果：worktree **26 → 21**；目录已不存在；`p2a-t11` 工作树与共享 `node_modules` 均完好。

> 本次删除是本机 §6 中**唯一**允许 `-D`/`--force` 的场景：`-d` 因内容非 master 祖先而拒绝，
> 但该内容被**另一显式保留的本地 ref 与远端 ref 同时保全** → 零可达性损失。
> 遗留物：备份 patch 与 spike 报告在 `~/WorkBuddy-Quarantine/zhihu-grabber-t11-20261002/`。

---

## PART 3 — #131 PROBLEM STATEMENT

### 问题**不在** enumeration layer

本轮实测（同一真实生产文件、同一 M7 变异）：

| 层 | 实测 | 结论 |
|---|---|---|
| `enumerateAssertArtifactSafeCallSurface` | **119–129 ms**，9 站点分类正常（`call-trusted@899`） | **不卡**。卡点不在 A1 枚举 |
| `resolveTrustSetProvenance` | **32 628 ms** | **卡在这里** |

→ **任何「先把枚举层改成 AST 就能修好 #131」的方案都修不到 P0。**

### 问题在 NAME dimension provenance resolution

真实生产文件 `lib/targeted-requery-subphase.mjs`（**46 042 B**），M7 形状：

```js
pool.__trusted = new Set([...trusted, ...pool.map((p) => p.channels[0].query)]);
const safety = assertArtifactSafe(pool, { trustedPlanStrings: pool.__trusted });
```

| root | 本轮实测 | #131 记录 | expressions | unresolvable |
|---|---|---|---|---|
| `trusted`（未变异对照） | **11 ms** | 5 ms | 2 | 0 |
| `pool.__trusted`（M7 变异） | **32 628 ms** | 27 440 ms | **294** | **5 702** |

→ expressions 与 unresolvable 计数与 #131 表格**完全一致**（294 / 5 702）；墙钟 32.6 s vs 27.4 s 属机器差异。
**P0 为真，且为 HEAD 既有缺陷**（`git diff 9bcf63f 2934956 -- research-orchestration/lib/` = 空）。

### 两条反例（防止错误归因，必须随票保留）

1. **合成 fixture 不卡**：同一 M7 形状放进 5 行合成源码 → **15 ms / 14 表达式**。
   极小复现**不足以**作为验收测试；必须用 ≥46 KB 真实生产文件驱动，
   否则测试会在**错误的原因**上变绿（与 #131 中 `git archive` 归因无效的坑同源：
   抽出的树缺兄弟包 `zhihu-answer-grabber`，跨包 import `ERR_MODULE_NOT_FOUND`，~200 ms 假红）。
2. **枚举层绿 ≠ 安全**：枚举层在本变异下 119 ms 全绿，provenance 层却 32 s。
   两个数字必须**分别**记录，混用即失去归因能力。

### AST spike 观测（本轮复测）

`acorn` 安装成功；ESM 下 `NODE_PATH` 无效，须在含 `node_modules` 的目录内运行。

| 测量 | 结果 |
|---|---|
| 解析 46 KB 生产文件 | **5–12 ms**，`ecmaVersion 2024` OK，**2 735 nodes**（变异体 2 761） |
| 全 AST 遍历（member write 抽取） | **线性、无 fan-out**；`× 10 次 = 19 ms` |
| CONTROL | `memberWrites = 3`，`detects__trusted = false` |
| MUTATED | `memberWrites = 4`，**`detects__trusted = true`（`pool.__trusted`）** |

**决定性 A/B（同一文件、同一变异、同一 root）**

| 方案 | 结果 |
|---|---|
| 现有 regex / name-fan-out walk | **32 628 ms**，294 表达式 / 5 702 unresolvable |
| acorn AST 遍历 | **5 ms**，4 member write，**精确检出 `pool.__trusted`**，不产生那 5 702 条 |

### AST 解决什么 / **不**自动解决什么

> **禁止**在本票任何位置写「AST automatically solves everything」。

**AST SOLVES（syntax structure recognition）**

- 语法结构识别：`AssignmentExpression` / `MemberExpression` / `CallExpression` / `NewExpression` 等
  的**精确**边界与嵌套关系；
- property write 的**语法位置**：`pool.__trusted = …` 作为一个 Assignment 节点，**一次遍历即可定位**，
  代价与文件大小成线性，与 ground 组合数无关；
- 静态可判定的别名/重赋值/receiver 形态（如 `const w = a.b.c` 的成员链深度）；
- 计算键的**可见性判定**：`obj[k]` 中 `k` 是否为字面量 —— 不可静态判定时**可以明确说"不可判定"**，
  而不必用正则猜。

**AST DOES **NOT** AUTOMATICALLY SOLVE（必须另建，且本票不建）**

- **alias tracking**：赋值/传参/返回值/对象属性间的绑定传播，需自建 fixed-point 数据流；
- **runtime computed properties**：`obj[key]`、`Reflect.set`、`Object.assign`、`??=`、
  `Object.defineProperty`、模板计算键 —— 语法上存在，语义需运行时或保守处理；
- **inter-procedural data flow**：跨函数、跨模块、跨调用点的传播（现有 `resolveCallReturnProvenance`
  的 call-graph budget 正是为此存在，AST **不替代**它）；
- **别名到 property 的映射**：`a.b.c` 是否与 `pool.__trusted` 同一对象，需要 alias 分析而非语法匹配；
- **终止性保证本身**：AST 遍历是有限的，但**在其上构建的数据流分析仍可能不终止**——
  换解析器不自动获得 bounded runtime。

---

## PART 4 — ARCHITECTURE OPTIONS（三方案比较）

评估轴：correctness / security / false positive / false negative / implementation complexity /
maintenance cost / compatibility with existing T11 contract。

> 轴的口径说明（避免误读）：本守卫是**安全守卫**，其 FP/FN 的代价**不对称** ——
> **FN（漏掉一个真实放宽）= 安全边界失守**；FP（误报一个未放宽）= 噪声与人工裁决成本。
> 因此「FN 少」权重高于「FP 少」，但**任何方案 FN>0 且不可审计**都直接判不合格。

### OPTION A — 继续 regex / walk（在现有 `walk` 上加 NAME 维度共享预算）

| 轴 | 评价 |
|---|---|
| correctness | 维持现状语义。P0 的**根因**（NAME 维度无预算）被直接命中：加一个跨 `walk()` 共享的 name budget 后终止性可证 |
| security | 保留已知 FN：P1-B（`.add()` 构造后放宽）、P1-C（ABSENT 站点）**均不因此修复**。r11 已冻结态的 P1-A fail-open 也不因此修复 |
| false positive | 不变低。若预算截断，截断点必须报 unresolvable → **可能新增 FP**（更多 fail-closed 报告） |
| false negative | **不降**。正则仍看不见 alias / computed key / inter-procedural 传播 |
| implementation complexity | **最低**。#131「方向」段已给出形状：与现有 `maxDepth` 同构，helper 内部预算 plumbing |
| maintenance cost | 最低，但**技术债累积**：正则口径的语义需要注释长期维护（r11 已因口径漂移产生 P1-2 wiring mismatch） |
| 兼容性 | **最高**。不改 `lib/`、不改导出契约、r11 套件 32/32 不动 |

### OPTION B — 完全 AST rewrite（用 acorn 重写整个 helper）

| 轴 | 评价 |
|---|---|
| correctness | 潜力最高（语法精确），但**必须重实现并对齐** r11 起累积的全部语义：4 个修复轮次、7 类 mutation 防御、`localWalkerNames` fixpoint、trust-set 判定、call-graph budget。**语义等价性无法在本票证明** |
| security | **最危险**：重写期任何语义缺口 = FN。而 r11 现状是「32/32 绿但有已知 fail-open」，重写期的绿**不代表更安全** |
| false positive | 理论更少（语法精确），但**实际可能更多**：新实现未对齐的保守分支会大量报 unresolvable |
| false negative | 理论更少，但**迁移期最高** —— 旧口径的已知 FN 未必被逐条覆盖 |
| implementation complexity | **最高**。helper 已承载 11 个 commits 的语义沉淀；一次性替换风险不可控 |
| maintenance cost | 表面更低（不再维护正则口径），实际**更高**（需长期维护 AST 分析正确性 + 版本兼容） |
| 兼容性 | **最低**。违反「不改已 reviewed 实现」的冻结前提；r11 的 32 个测试全部需重写，**失去 regression 保护网** |

### OPTION C — AST-assisted bounded analyzer（fast path + targeted fallback）

| 轴 | 评价 |
|---|---|
| correctness | **增量且可证**：保留 r11 全部已验证语义作为 fast path；仅在**歧义形状**（member / property / computed key）上用 AST 取**语法事实**。每一步都能用现有 32 测试 + M1–M9 mutation 验证 |
| security | **可审计的增量**：AST 只提供「有没有 property write / 键是否字面量」这类**可陈述事实**，不自行下 widen 结论。截断方向与 `maxDepth` 一致（fail closed） |
| false positive | 可控。AST 事实可能**增加** unresolvable 报告（更多 fail closed），但每条都有精确行号与 AST 证据，**噪声可审计** |
| false negative | **实质下降**：P1-A（点号接收者）本质是「接收者正则只认裸标识符」，AST 取 `MemberExpression` 链后**天然覆盖**任意深度 receiver；P1-B 的 `.add()` 可由 AST 识别为 `CallExpression` on member |
| implementation complexity | **中**。新增一个只读分析器 + 在现有 resolver 的歧义分支接入；不删除任何现有路径 |
| maintenance cost | 中。新增一个 acorn 依赖（devDependency，测试侧）+ 一层「AST 事实 → 现有判定」的适配 |
| 兼容性 | **高**。不改 `lib/`、不改现有导出签名、r11 32 测试**继续作为回归保护网** |

### 对比小结

| | A（预算） | B（全量重写） | C（AST 辅助） |
|---|---|---|---|
| 修 #131 P0 非终止 | ✅ 直接 | ✅ | ✅（配合 A 的预算作为硬保证） |
| 修 P1-A 点号 receiver | ❌ | ✅ | ✅ |
| 修 P1-B `.add()` | ❌ | ✅ | ⚠️ 部分（识别 mutation 调用，判定仍需定义） |
| 修 P1-C ABSENT 站点 | ❌ | ✅ | ⚠️ 部分（需定义哪些形状进 fast path） |
| 保持 r11 32 测试有效 | ✅ | ❌ 需重写 | ✅ |
| 风险方向 | FN 不降 | **迁移期 FN 最高** | FN 降，且每步可验 |
| 与「frozen r11」相容 | ✅ | ❌ 违反 | ✅ |

---

## PART 5 — RECOMMENDATION

### 结论

**推荐 OPTION C（AST-assisted bounded analyzer），且必须以 OPTION A 的预算作为硬性兜底。**

**不推荐 OPTION B**，理由不是「技术不够先进」，而是与本项目的目标函数冲突。

### 为什么不是 B（这是 security/governance tooling，不是语言服务器）

本守卫的目标**不是**完整理解 JavaScript。目标是四条：

1. **fail closed** —— 不确定时拒绝，而不是猜；
2. **prevent trust boundary bypass** —— 拦住真实的信任放宽；
3. **bounded runtime** —— CI 必须能跑完，否则守卫等于不存在（#131 的 P0 判定正是据此）；
4. **auditable behavior** —— 每个判定要能指回**具体行与具体语法事实**。

对这四条逐一审视 OPTION B：

- **fail closed**：全量重写会产生大量「未对齐的保守分支」，短期内 FP 上升，而 FP 上升会**训练读者忽略告警**
  —— 这正是 r11 里已有的教训（「`no statically readable trustedPlanStrings member` 报在正确代码上，
  守卫就会教读者忽略它」）。
- **prevent bypass**：重写**不自动**修 P1-B / P1-C；它只是换了一个更容易写错的地方。P1-A 用 AST 修只需
  改一处正则，**不需要重写 11 个 commits 的语义**。
- **bounded runtime**：AST 遍历有界，但**在其上构建的数据流分析仍可能不终止**。全量重写把
  「一个已知不终止的 resolver」换成「一个尚未证明不终止的新 resolver」——在 P0 上下文里这是**倒退**。
- **auditable**：全量重写期间，任何一次绿都无法区分「真的更对」与「口径又漂移了一次」。r11 的 P1-2
  （分类器与 resolver 分支口径不一致导致 C3 分支永不可达）就是这种漂移的**已实证样本**。

### 推荐的架构：fast path + fallback + 硬预算

```text
                    ┌─────────────────────────────────────────┐
   信任集 root ───▶ │  FAST PATH：现有 r11 resolver（不变）      │
   (例：trusted)    │  · 已验证语义，逐条有测试与 mutation 支撑  │
                    │  · 结果可直接采信                          │
                    └───────────────┬─────────────────────────┘
                                    │ 仅当 root 是 member / property 歧义形状
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │  FALLBACK：AST-assisted bounded analyzer │
                    │  · acorn 解析（单次，线性）              │
                    │  · 只回答语法事实：                      │
                    │     - 有无 property write（含任意深度 receiver）
                    │     - 计算键是否字面量                    │
                    │     - 是否存在构造后 mutation（.add/.delete/.clear）
                    │  · 不自行判定「是否被放宽」               │
                    └───────────────┬─────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │  硬保证（OPTION A 的预算，缺一不可）        │
                    │  · NAME 维度跨 walk() 共享预算            │
                    │  · 与 maxDepth 同向：截断 = fail closed   │
                    │  · 截断必须【报告】，不得静默缩窄 scope    │
                    │  · 解析失败 = fail closed，不得跳过文件     │
                    └─────────────────────────────────────────┘
```

**为什么 AST 只能做 fallback 而不是主路径**：

- r11 的 fast path 已被 32 个测试 + 7 个 mutation 证明**在它覆盖的形状上是对的**。
  把已验证路径换成未验证路径，是用「已知的部分正确」换「未知的整体」——**在安全守卫上这笔交易不划算**。
- AST 在本 spike 中表现最好的地方，恰好是**语法事实提取**（3 → 4 个 member write，5 ms），
  而不是语义判定。把语义判定继续留在 r11 已验证的 resolver 里，AST 只补它最擅长的那一层。

**预算不可省**：即使采用 C，若不同时引入 NAME 维度共享预算，任何**未来的** AST 之上数据流增强
都会重新引入同类不终止。#131「方向」段已指出：precedent 是 `maxDepth` 报
`… max depth 8 exceeded` 为 unresolvable（**fail closed**），且「两个预算不得对失败方向不一致」。
→ **C 必须内含 A 作为硬兜底**，二者不是二选一。

### 该推荐**不**主张的事（防止被误读为授权）

- 不主张 `lib/` 需要任何改动 —— #131 已明确「无 `lib/` 字节需要改，也不应改」，本文件同意。
- 不主张解除 r11 的 integration 禁止 —— P1-A/B/C 仍 OPEN。
- 不主张现在就实现 —— `IMPLEMENTATION_AUTHORIZATION = NONE`。
- 不主张 AST 能修 P1-B / P1-C —— 见 PART 4 的「⚠️ 部分」。

---

## PART 6 — FUTURE IMPLEMENTATION PLAN（设计稿，未实现）

> 以下是**为 #131 remediation ticket 准备的设计**，不是实现，也不构成授权。
> 建议 ticket 标题：`[P2A-T11-FOLLOWUP] #131 remediation: bound the F.3 NAME dimension and add AST-assisted resolution for member/property shapes`

### 6.1 SCOPE

| 项 | 内容 |
|---|---|
| IN | NAME 维度共享预算（PART 5 硬保证）；AST-assisted fallback analyzer（新增，只读）；`maxDepth` 与新预算的**失败方向一致性**；截断与解析失败的显式报告 |
| OUT | 任何 `lib/` 字节改动；改动 r11 已冻结的 fast path 语义；P1-A/B/C 的**修复**（应各自独立成票或明确列入本票范围后再实现）；删除现有 regex 路径 |
| 不做 | 「完整 JS 理解」；跨模块 inter-procedural 分析的重写；引入 type checker / linter 体系 |

### 6.2 FILES LIKELY TOUCHED

| 文件 | 变更性质 |
|---|---|
| `research-orchestration/test/helpers/t11-trust-surface-enumeration.mjs` | 主要改动：NAME 维度预算 plumbing；AST fallback 接入；截断/解析失败报告。**不删现有 fast path** |
| `research-orchestration/package.json` | 新增 `acorn` 作为 **devDependency**（测试侧工具，不进产品运行时） |
| `research-orchestration/test/p2a-t11-trust-boundary-executable-guards.test.mjs` | 新增测试（见 6.3），**r11 现有 32 个测试全部保留不改** |

> 若 AST 依赖引入方式有争议（例如禁止任何新依赖），需**显式决策**而非默默引入 ——
> 届时 fallback 方案退化为 OPTION A（纯预算），仍能修 P0，只是修不了 P1-A。

### 6.3 TESTS REQUIRED

1. **终止性测试（P0 回归，最高优先）**
   - M7 形状在**真实生产文件**（`lib/targeted-requery-subphase.mjs`，≥46 KB 副本）上
     **在有界时间内完成并仍产出 verdict**；时间上限须机械断言（如 `< 5 s`）。
   - **禁止**用小合成 fixture 作为该测试主体（PART 3 反例 1：5 行 fixture 15 ms 通过，
     会在错误原因上变绿）。
2. **截断方向一致性测试**
   - 构造超过 NAME 预算的输入 → 断言产出 `unresolvable` 且**携带截断原因**
     （对齐 `… max depth 8 exceeded` 的既有措辞形状）。
   - 断言 NAME 预算与 `maxDepth` 对「截断」的方向一致（不出现一个 fail closed 一个 fail open）。
3. **AST 事实提取测试**
   - 任意深度 receiver 的 property write 被检出（含 `a.b.c.trusted = …`，P1-A 形状）。
   - 计算键字面量 / 非字面量分别给出确定判定；非字面量必须 **fail closed**。
   - AST 解析失败（故意注入语法错误文件）→ **fail closed**，不得静默跳过。
4. **fast path 不回归**：r11 现有 32 个测试**逐条保持通过**（不得为了新行为改写旧断言）。
5. **fail-closed 断言**：任何无法静态判定的形状 → `unresolvable`，**不得**返回空 `expressions`
   （空 verdict = fail-open，是 P1-1 的教训）。

### 6.4 ADVERSARIAL CORPUS（每类至少 1 例，必须真实文件驱动）

| # | 形状 | 期望 |
|---|---|---|
| A1 | `pool.__trusted = new Set([...trusted, ...pool.map(...)])`（M7 / #131 原例） | 有界终止 + verdict |
| A2 | `state.inner.trusted = …`（点号 receiver，P1-A） | 检出 |
| A3 | `holder.trusted.add(x)`（构造后 mutation，P1-B） | 检出或明确 unresolvable |
| A4 | `holder[key] = …`（非字面量计算键） | fail closed |
| A5 | `Object.assign(holder, {trusted})` / `Object.defineProperty` / `Reflect.set`（P2 类） | fail closed |
| A6 | `??=` / 解构赋值到成员 / 模板计算键（P2 类） | fail closed |
| A7 | 逗号多声明链 `const a=…,b=a,c=b` / 解构赋值 / `.bind` 嵌套括号 / `.call`/`.apply`（P1-C） | 不 ABSENT |
| A8 | 循环引用（`a.x = b; b.x = a;`） | 有界终止 + fail closed |

> A1 与 A8 是**终止性**用例；A2–A7 是**检出/fail-closed** 用例。两者不可互相替代。

### 6.5 TERMINATION BUDGET

| 维度 | 要求 |
|---|---|
| 预算位置 | **跨 `walk()` 共享**的单一 NAME 维度预算，**每个 name 每次顶层 walk 最多解析一次** |
| 失败方向 | 与 `maxDepth` **一致**：截断 → 计为 `unresolvable`，**fail closed** |
| 报告义务 | 截断必须**显式出现在 unresolvable 列表**（含原因与预算值），**禁止**静默缩窄 scope |
| 机械验收 | A1 在真实文件上 `< 5 s` 完成；A8 有界终止；CI 全量不挂起 |
| 禁止 | 用「只对部分 root 施加预算」的方式让测试变绿 —— 那是缩窄 scope，不是修复 |

### 6.6 MUTATION TESTS

- 复用 r11 的 **M1–M7**，**外加**针对新代码的变异：
  - 把 NAME 预算改成「超限即返回空 `expressions`」→ 终止性测试必须 **catch**（防空 verdict fail-open）；
  - 把 AST fallback 的 `fail closed on parse error` 改成 `skip file` → 必须 catch；
  - 把任意深度 receiver 检出改回只认裸标识符 → 必须 catch（= 重新引入 P1-A）；
  - 让 NAME 预算与 `maxDepth` 失败方向相反 → 必须 catch。
- 沿用既有纪律：**独占、干净重跑**（`pkill -f "node --test"` 后前台跑）。并发跑会产出大量假红，
  曾导致 62 fail 的误读（真实净差为 0）。

### 6.7 SECURITY REVIEW REQUIREMENTS

| 项 | 要求 |
|---|---|
| Quorum | `1 × SECURITY_REVIEWER` + `1 × CODE_REVIEWER`，**同 exact HEAD**；quorum 优先异模型 |
| 禁止 | self-review；executor 不得派生 reviewer |
| 必须独立复核 | ① P0 在真实文件上确已终止；② 截断方向与 `maxDepth` 一致；③ 解析失败 fail closed；④ r11 32 测试未被改写；⑤ **AST 结论未被夸大**（不得声称 AST 解决 alias / computed property / inter-procedural） |
| 归因方法 | 涉及跨包 import 的套件**必须**用完整 `git worktree`（含兄弟包 `zhihu-answer-grabber`）或 `node_modules` 符号链接；**禁止**用裸 `git archive` 抽树（缺兄弟包 → `ERR_MODULE_NOT_FOUND` 假红） |
| 独立性 | 本文件（决策）**必须**经 fresh independent reviewer 复核后方可作为 ticket 输入 |

### 6.8 未来 TICKET 门禁（当前均未满足）

```text
IMPLEMENTATION_AUTHORIZATION = NONE
需先满足：
  1. 本决策文档经 fresh independent review 且 verdict 非 CHANGES_REQUESTED
  2. #131 remediation ticket 正式创建并被授权
  3. 独立分支/worktree（不得在 r11 分支或 feat/cross-question-web-demo 上施工）
  4. 范围确认：P1-A/B/C 是否并入本票，或各自独立成票（当前建议：独立，避免 scope 扩张）
```

---

## PART 7 — 约束遵守自检

| 约束 | 状态 |
|---|---|
| 不直接实现 AST 替换 | ✅ 只写决策与设计稿；`NEW_CODE_CHANGED = NONE` |
| 不修改 T11 r11 | ✅ `2934956` 未改；r11 套件本轮重跑 **32/32 pass**；`lib/` 与 r10 byte-identical |
| 不创建 implementation branch | ✅ 仅建 `docs/p2a-t11-131-ast-decision`（docs-only worktree，基于 master） |
| r11 frozen / 不回滚 / 不 merge | ✅ |
| #131 独立 | ✅ 未把 P0 折叠进 #123；P1-A/B/C 与 #131 明确分列 |
| T11 integration forbidden | ✅ 保持（open PR = 0） |
| 不用 outage 前 SHA 作 authority | ✅ 全部 SHA 来自本 turn `ls-remote` / 实测 |
| 不写「AST solves everything」 | ✅ PART 3 显式分列 SOLVES / DOES NOT |
| 不为技术先进而选 AST | ✅ PART 5 明确拒绝 OPTION B 并给出四条目标函数论证 |

## PART 8 — 遗留物与待裁决

- spike 脚本（只读，未进 repo）：`/tmp/parserprobe/{spike1,spike2,spike3,remeasure}.mjs`
- 备份 patch + 前序 spike 报告：`~/WorkBuddy-Quarantine/zhihu-grabber-t11-20261002/`
- **待裁决**：`acorn` 作为 devDependency 是否可接受（若否 → 退化为 OPTION A，仍能修 P0）；
  P1-A/B/C 是否并入 #131 remediation 或各自独立成票。

---

## APPENDIX A — ERRATA（append-only；不修改上方任何已评审内容）

```text
ERRATA_APPENDED_AT_DOC_COMMIT = 0ba5f9253ddaf37b9a950aade00aab52c1b4589e（被评审的那一版，保持不变）
ERRATA_AUTHOR                 = fresh independent reviewer (deepseek-v4.1-flash) + orchestrator 复核
ERRATA_VERDICT_BEFORE         = MODIFY（OPEN_P0 = 0 / OPEN_P1 = 1 / OPEN_P2 = 7）
```

本附录**不修改**上方正文。评审针对的 exact SHA 是 `0ba5f925`；上方任何数字与措辞**保持原样**，
以便日后按 SHA 取证的读者看到当时被评审的原文。以下为**已机械复核确认**的勘误。

### A.1 — P1-1（唯一 OPEN_P1）：「决定性 A/B」表被读成 verdict 等价（PART 3）

评审指出的问题**成立**。原表把「AST member-write 检测 5 ms」与「resolver 32 628 ms」并列，
并写「不产生那 5 702 条 unresolvable」。该表述可被读成「AST 在 5 ms 内给出了与 resolver 等价的结论」。
**这是不成立的**：spike 函数**只做 member-write 检测，完全不计算 provenance**，
因此它**结构上不可能**产出 `expressions` / `unresolvable`。已复核：

```text
AST member-write detection: mw=3 -> emits NO expressions/unresolvable (computes no provenance)
```

**正确的读法**（应以此为准）：

| 指标 | 现有 resolver | AST spike（仅检测） |
|---|---|---|
| 性质 | 语义 provenance 解析 | **仅语法事实检测** |
| 耗时 | 32 628 ms | 5 ms |
| 产出 | 294 expressions / 5 702 unresolvable | **无**（不产出 verdict） |
| 证明了什么 | P0 非终止**为真** | **member write 可被线性定位** |

→ 二者**不可比**。本文件其余部分（PART 3「AST DOES NOT」段、PART 5）对这一点的表述是正确的；
需修正的只是这张表的标题与「不产生 5 702 条」这句比较。**结论不变**：AST 值得作为 fallback 引入，
但它**替代**的是「歧义形状的语法事实提取」，**不是** provenance 判定本身。

### A.2 — P2 勘误（数值/事实）

| # | 位置 | 原写 | 复核结果 | 处理 |
|---|---|---|---|---|
| P2-1 | PART 3 | `46 042 B` | `46 042` 是 **JS 字符数**（`.length`）；UTF-8 字节为 **46 277 B** | 标注为 `46 042 chars / 46 277 B UTF-8` |
| P2-2 | PART 2 | `2c750ad..2934956` = 11 commits | `git rev-list --count 2c750ad..2934956` = **10**（11 只在含 base 时成立） | 改为 10 |
| P2-3 | PART 0 | `remote branch count = 64` | 评审时为 **65**（本分支 push 后 +1）。PART 0 测量**早于**本分支 push | 标注测量时点，明确 64 为 push 前值 |
| P2-4 | PART 2 / PART 8 | 「备份 patch + **spike 报告**」在同一目录 | **确认不实**：备份 patch 在 `~/WorkBuddy-Quarantine/zhihu-grabber-t11-20261002/`，而 spike 报告被写到了**另一个**路径 `/Users/songshiyao/WorkBuddy/WorkBuddy-Quarantine/zhihu-grabber-t11-20261002/`（两处目录名相近，笔误）。本 turn 已把 spike 报告**复制**到备份目录，两者现已同址 | 已修正声明；**笔误已记录**，不掩盖 |
| P2-5 | PART 3 | 「AST SOLVES」含「静态可判定的**别名**」，「DOES NOT」含「alias tracking」 | 「别名」同时出现在两栏，虽有「静态可判定」限定，仍易被误读 | 已在 A.3 给出明确划界 |
| P2-6 | PART 5 | 「P1-A 用 AST 修只需改**一处正则**」 | 措辞把 AST 路径与「改正则」混同；本设计是**从 AST 取成员链**，不改 `propertyWritePattern` | 已在 A.3 更正 |
| P2-7 | PART 1 / PART 3 | 「M1–M7 全部 catch」「合成 fixture 15 ms / 14 表达式」 | 数字本身未被推翻（评审**独立确认**了「合成快、真实文件慢」这一定性结论），但这些数字**未随票发布**，故**不可独立复现** | 已在 A.4 标注可复现性边界 |

### A.3 — 措辞更正（AST 能力边界，消除误读空间）

- **别名 / alias**：AST **能**静态判定的是**语法层的成员链形状**（如 `a.b.c` 的深度、
  `const w = a.b.c` 的绑定形态），**不是**别名等价类。**别名传播（alias tracking）仍属
  "DOES NOT"**：本文件上文两处「别名」用词应按此划界读。
- **P1-A 的修法**：本设计**不是**「改一处正则」，而是**从 AST 取任意深度的 receiver 成员链**，
  绕开 `propertyWritePattern` 的「单裸标识符接收者」口径缺陷。r11 的正则**保持原样**。
- **r11 frozen 的确切含义**（评审 NOTES 7 指出）：**frozen 指的是 commit `2934956` 不可变**，
  **不是**指 `t11-trust-surface-enumeration.mjs` 这个文件此后不能被改。6.2 的主要编辑目标正是该
  helper 文件 —— 这是「在 r11 之上继续修」而非「篡改 r11」。为避免日后被过度解读，
  此处显式声明该区分。

### A.4 — 可复现性边界（诚实标注）

- 评审**独立复现**并逐位吻合的：294 / 5 702、2735 / 2761 nodes、memberWrites 3 → 4、
  `detects __trusted = true`、control 2 / 0、enum 层 92–129 ms 不卡、r11 32/32、
  `lib/` byte-identical、backup sha256。
- 仅墙钟时间不同（resolver 30 316 / 32 628 ms；AST ×10 = 19 / 34 ms）—— 属机器差异，
  原文已注明。
- **不可独立复现**（未随票发布）：`M1–M7` 的具体 mutation 矩阵、5 行合成 fixture 的
  **精确 14 表达式**。这两项应作为 #131 remediation ticket 的**入库产物**补齐
  （见 6.3「终止性测试」—— 须用真实生产文件驱动，合成 fixture 仅作辅助）。
- 评审**额外独立复现**了本文件未主张的主张：P1-A 的**机制**（点号 receiver → CLEAN fail-open）
  及其**套件级表现**（变异后 r11 仍 32/32 全绿）→ 本文件对 P1-A 的诚实标注**成立**。
