# P2A-T11 / #131 — Remediation Implementation Plan（V1）

```text
DOC_ID            = P2A_T11_131_REMEDIATION_IMPLEMENTATION_PLAN_V1
TYPE              = IMPLEMENTATION_PLAN（设计稿；不含实现）
TICKET            = #131（P0，独立票）
PARENT            = #123（P2A-T11，r11 FROZEN）
UPSTREAM_DECISION = docs/planning/P2A_T11_131_F3_PROVENANCE_ANALYZER_DECISION_V1.md
                    @ cd2e2241da67f99d0ad81b1f2e8934e3db91f550（已评审，errata 已附）
BASE              = master @ 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
SUBJECT           = work/p2a-t11-trust-boundary-executable-guards @ 293495626d993137f2691f99df4dce2cb156762b（r11，frozen）
IMPLEMENTATION_AUTHORIZATION = NONE
NEW_CODE_CHANGED            = NONE
AST_PARSER_INTRODUCED       = NONE（本 plan 不引入 acorn 或任何 parser）
T11_R11_MODIFIED            = NO
```

> 本文件**不授予实现授权**，也**不**引入 AST parser。它把已批准的架构决策转成可执行的
> 实施边界与验收条件，供 `START_GATE` 裁决。
> 权威顺序不变：`RULES.md` > Applicable Approved Specs > `docs/architecture/key-decisions.md` >
> 本文件。上游决策文档与本文件冲突时**以决策文档为准**并回来修本文件。

---

## PART 1 — FRESH TRUTH（本轮实测）

```text
git ls-remote origin refs/heads/master                                        = 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
git ls-remote origin refs/heads/work/p2a-t11-trust-boundary-executable-guards = 293495626d993137f2691f99df4dce2cb156762b
git ls-remote origin refs/heads/docs/p2a-t11-131-ast-decision                = cd2e2241da67f99d0ad81b1f2e8934e3db91f550
local master = local T11 = 同上（均与远端一致）
stale .git/*.lock        = none
main worktree            = clean（0 porcelain）
open PR                  = []（zero）
#131                     = OPEN, label [bug]
#123                     = OPEN
```

**r11 冻结态复验（本轮重跑，独占前台）**

```text
node --test test/p2a-t11-trust-boundary-executable-guards.test.mjs
→ 1..32 / # tests 32 / # pass 32 / # fail 0 / duration 1590 ms
git diff 9bcf63f 2934956 -- research-orchestration/lib/   → EMPTY（lib/ byte-identical）
```

---

## PART 2 — PROBLEM

### NAME dimension non-termination（#131 P0）

问题**不在** enumeration layer，而在 **NAME 维度的 provenance resolution**。

| 层 | M7 变异下实测 | 判定 |
|---|---|---|
| `enumerateAssertArtifactSafeCallSurface` | **92–129 ms**，9 站点正常分类（`call-trusted@899`） | **不卡** |
| `resolveTrustSetProvenance` | **30 316 – 32 628 ms** | **卡在这里 → P0** |

M7 形状（真实生产文件 `lib/targeted-requery-subphase.mjs`，**46 042 chars / 46 277 B UTF-8**）：

```js
pool.__trusted = new Set([...trusted, ...pool.map((p) => p.channels[0].query)]);
const safety = assertArtifactSafe(pool, { trustedPlanStrings: pool.__trusted });
```

| root | 实测（本轮） | expressions | unresolvable |
|---|---|---|---|
| `trusted`（未变异对照） | **11–12 ms** | 2 | 0 |
| `pool.__trusted`（M7 变异） | **31 153 – 32 628 ms** | **294** | **5 702** |

（另一等价形状 `pool.__t` + `pool.__t.add(targetedPools[0].rawQuery)` 亦复现：31 153 ms / 292 / 5 014。）

**根因**：walk 的有限性论证依赖**一个共享的 call-graph budget**，而该 budget 只约束**函数体**
（`resolveCallReturnProvenance` 的 `visited`）。**没有任何预算约束 name 维度的 fan-out**；
当一个成员的右值重读它自己的 receiver，walk 会以组合方式重走同一片地基。

**P0 定性**：不终止的守卫是它自己那一类 fail-open —— CI 永不结束 → 票永不落地 → 放宽在无挑战下发布，
而守卫在**所有会终止的输入上看起来都是绿的**。

### 两条必须随票保留的反例

1. **合成 fixture 不复现**：同一形状放进 5 行合成源码 → **15 ms / 14 表达式**。
   → 验收测试**必须**用 ≥46 KB 真实生产文件驱动，否则会在**错误的原因**上变绿。
2. **枚举层绿 ≠ 安全**：枚举层在同一变异下 ~100 ms 全绿，provenance 层 ~31 s。
   两个数字必须**分别**记录，混用即失去归因能力。

---

## PART 3 — ARCHITECTURE（承接已批准决策）

**采用：AST-assisted bounded analyzer = fast path（现有 r11 resolver）+ targeted AST fallback + 硬预算。**

### 明确禁止

| 禁止 | 原因 |
|---|---|
| **full AST rewrite**（用 acorn 重写整个 helper） | 违反冻结前提；重写期任何语义缺口都是 FN；期间绿无法区分「更对」与「口径漂移」；r11 的 P1-2 已是该漂移的实证样本 |
| **unbounded semantic inference**（在 AST 上做无预算数据流分析） | 换解析器**不自动获得** bounded runtime。AST 遍历有界，但**其上的数据流分析仍可能不终止** —— 这正是 #131 的原始教训 |
| 删除现有 regex / fast path | 已由 32 测试 + mutation 证明在其覆盖形状上是对的；换成未验证路径是「已知的部分正确」换「未知的整体」 |
| 任何 `lib/` 字节改动 | #131 已明确不需要；`lib/` byte-identical 是本 plan 的不变量 |
| 静默截断 / 静默跳过文件 | 违反 fail closed |

### AST 的能力边界（不得夸大）

**AST SOLVES**：语法结构识别 —— `AssignmentExpression` / `MemberExpression` / `CallExpression` 的精确
边界与嵌套；property write 的**语法位置**（`pool.__trusted = …` 一次遍历即定位，代价线性）；
计算键**是否字面量**（不可判定时可明确说「不可判定」，而非用正则猜）。

**AST DOES **NOT** SOLVE**（须另建，本 plan 不建）：alias tracking（别名传播）；
runtime computed properties（`obj[key]` / `Reflect.set` / `Object.assign` / `??=`）；inter-procedural
data flow（跨函数/跨模块 —— 现有 call-graph budget 正为此存在，AST **不替代**它）；
以及**终止性保证本身**。

**度量口径纪律**：AST spike 只做 member-write 检测，**不计算 provenance**，
因此它**结构上不可能**产出 `expressions` / `unresolvable`。不得把「AST 5 ms 检测」与
「resolver 31 s 解析」写成 verdict 等价。

---

## PART 4 — IMPLEMENTATION BOUNDARY

### A. AST parsing boundary

| 项 | 规定 |
|---|---|
| 位置 | **仅**在歧义形状（member / property / computed key）上调用；**fast path 不得触发解析** |
| 输入 | 单个 `lib/*.mjs` 源文件字符串 |
| 产出 | **仅语法事实**：是否存在 property write（含任意深度 receiver）、计算键是否字面量、是否存在构造后 mutation 调用（`.add` / `.delete` / `.clear`） |
| **禁止** | AST 组件**自行**判定「是否被放宽」或**产出任何 verdict** —— 判定权仍在现有 resolver |
| 解析失败 | **fail closed**：计为 `unresolvable` 并携带原因；**禁止**静默跳过文件 |
| 依赖 | `acorn` 作为 **devDependency**（测试侧工具，**不进产品运行时**）。**若 owner 裁决不接受新依赖 → 退化为纯预算方案（只做 C 项），仍能修 P0，但修不了 A 的 P1-A** |
| 解析成本 | 单文件 parse + 线性遍历，预算内（本轮实测 5–12 ms / 2 735 nodes） |

### B. Existing resolver compatibility

| 项 | 规定 |
|---|---|
| 导出签名 | **不得**删除或改名任何现有导出（含 `resolveTrustSetProvenance` / `memberWritePathsIn` / `enumerateAssertArtifactSafeCallSurface` 等 14 个） |
| fast path 语义 | **不变**。已验证路径不得因引入 AST 而改变行为 |
| r11 回归网 | r11 现有 **32 个测试全部保留、逐条不改断言**。它们是本票的**回归保护网**，不是可调整的旧代码 |
| `lib/` | **零改动**（`git diff <r10> <r11> -- research-orchestration/lib/` 必须保持 EMPTY） |
| 判定归属 | AST 事实须经**显式适配层**转为现有 resolver 的输入；不得旁路产生新判定分支 |

### C. Termination budget

| 项 | 规定 |
|---|---|
| 预算位置 | **跨 `walk()` 共享**的单一 **NAME 维度**预算；每个 name 每次顶层 walk **最多解析一次** |
| 失败方向 | 与既有 `maxDepth` **一致**：截断 → 计为 `unresolvable`，**fail closed**。两个预算**不得**对「截断」的方向不一致 |
| 报告义务 | 截断必须**显式出现在 unresolvable 列表**（含原因与预算值），措辞对齐既有 `… max depth 8 exceeded` 形状 |
| 禁止 | 用「只对部分 root 施加预算」让测试变绿 —— 那是**缩窄 scope**，不是修复 |
| 机械验收 | A1（M7 真实文件）**< 5 s** 完成并仍产出 verdict；A8（循环引用）有界终止；CI 全量不挂起 |

### D. Fail-closed behavior

| 场景 | 要求 |
|---|---|
| NAME 预算耗尽 | `unresolvable` + 原因，**禁止**返回空 `expressions`（空 verdict = fail-open，P1-1 教训） |
| AST 解析失败 | `unresolvable` + 原因，**禁止**跳过文件 |
| 计算键非字面量 | `unresolvable`（无法静态判定 → 拒绝，不猜） |
| alias / 跨模块传播无法解析 | `unresolvable` |
| 任一歧义形状未覆盖 | `unresolvable`，并**禁止**计入 `call-untrusted`（第五轮 review 的 P1-2 教训：分类器与 resolver 口径不一致会使分支永不可达） |
| 报告可审计性 | 每条 `unresolvable` 须可指回**具体文件 + 行号 + 语法事实** |

### E. Adversarial corpus

每类至少 1 例；**A1 / A8 必须用真实生产文件副本驱动**（合成 fixture 仅作辅助）：

| # | 形状 | 期望 | 本轮复现状态 |
|---|---|---|---|
| A1 | `pool.__trusted = new Set([...trusted, ...pool.map(...)])`（#131 原例） | 有界终止 + verdict | **P0 已复现**（31 s / 294 / 5 702） |
| A2 | `state.inner.trusted = …`（点号 receiver，P1-A） | 检出 | **已确认缺口**（见 PART 5） |
| A3 | `holder.trusted.add(x)`（构造后 mutation，P1-B） | 检出或明确 unresolvable | **本轮未复现为漏检**（见 PART 5） |
| A4 | `holder[key] = …`（非字面量计算键） | fail closed | 已确认 `unresolvable` |
| A5 | `Object.assign` / `Object.defineProperty` / `Reflect.set` | fail closed | 待实现期覆盖 |
| A6 | `??=` / 解构赋值到成员 / 模板计算键 | fail closed | 解构赋值→成员：**枚举层已 `call-trusted`** |
| A7 | 逗号多声明链 / 解构 import / `.bind` / `.call` / `.apply`（P1-C） | 不 ABSENT | **2 项仍 ABSENT**（见 PART 5） |
| A8 | 循环引用（`a.x = b; b.x = a;`） | 有界终止 + fail closed | 待实现期覆盖 |

**A1 与 A8 是终止性用例；A2–A7 是检出/fail-closed 用例。两者不可互相替代。**

### F. Mutation tests

- 复用 r11 的 **M1–M7**（**须随票发布为可复现产物** —— 见 PART 6 待补项）。
- 新增针对新代码的变异，**每个必须被某测试 catch**：

| # | 变异 | 必须被谁 catch |
|---|---|---|
| N1 | NAME 预算超限时改为「返回空 `expressions`」 | 终止性测试（防空 verdict fail-open） |
| N2 | AST `parse error` 改为「跳过该文件」 | fail-closed 测试 |
| N3 | 任意深度 receiver 检出改回只认裸标识符 | A2（= 重新引入 P1-A） |
| N4 | NAME 预算与 `maxDepth` 失败方向调反 | 预算方向一致性测试 |
| N5 | 把 `unresolvable` 计入 `call-untrusted` | 分类器/resolver 口径一致性测试（P1-2 回归） |

- **执行纪律**（本机已验证）：跑全量 suite 必须**独占、干净重跑**（先 `pkill -f "node --test"`）。
  并发会产生大量假红 —— 曾致 62 fail 的误读，而真实净差为 0。

### G. Security review requirements

| 项 | 要求 |
|---|---|
| Quorum | `1 × SECURITY_REVIEWER` + `1 × CODE_REVIEWER`，**同 exact HEAD**；优先**异模型** |
| 禁止 | self-review；executor 不得派生 reviewer |
| 模型优先级 | DeepSeek V4.1 Flash → GLM 5.3 → DeepSeek V4 Pro（fallback 仅限 MODEL_UNAVAILABLE / RATE_LIMIT / QUOTA / TOOL_FAILURE / CONTEXT_CREATION_FAILURE） |
| 记录 | 每个 review 留 receipt：`MODEL_REQUESTED` / `MODEL_ACTUAL` / `FALLBACK_USED` / `FALLBACK_REASON` / `REVIEWED_EXACT_SHA` / `VERDICT` / `OPEN_P0_P1` |
| 独立复核项 | ① P0 在真实生产文件上确已终止；② 截断方向与 `maxDepth` 一致；③ 解析失败 fail closed；④ r11 32 测试未被改写；⑤ **AST 结论未被夸大**；⑥ **P1-A/B/C 三项验收标准逐条被独立验证**（尤其 P1-B 的诚实标签，见 PART 5） |
| 归因方法 | 涉及跨包 import 的套件**必须**用完整 `git worktree`（含兄弟包 `zhihu-answer-grabber`）或 `node_modules` 符号链接；**禁止**裸 `git archive` 抽树（缺兄弟包 → `ERR_MODULE_NOT_FOUND` 假红） |
| 阻塞 | `OPEN_P0_P1 > 0` → **禁止** integration / CI / closeout |

---

## PART 5 — P1-A / P1-B / P1-C AS ACCEPTANCE CRITERIA（不拆票）

按 owner 裁决，**不**拆成独立 tickets，作为 #131 remediation 的验收标准。
**但每条必须标注本轮实测的真实状态 —— 不得把未复现的项写成「已确认漏检」。**

### AC-1 — dotted receiver coverage（P1-A）

| 项 | 内容 |
|---|---|
| 验收 | 任意深度 receiver 的 property write 必须被检出；`state.inner.trusted` **不得**读作 CLEAN |
| 本轮证据 | `memberWritePathsIn(dotted)` = **`[]`**（路由被跳过）；`memberWritePathsIn(bare)` = `["state.trusted"]` → **缺口确认存在** |
| 修法 | **从 AST 取任意深度成员链**，绕开 `propertyWritePattern` 的「单裸标识符接收者」口径。**r11 的正则保持原样** |
| 必测 | A2 用例；变异 N3 必须被 catch |

⚠️ **口径澄清（防误判）**：`resolveTrustSetProvenance` 对 dotted root 仍返回
`expressions=1 / unresolvable=0`（有非空输出，非空 verdict）。真正的 fail-open 在
**枚举/路由层**（`memberWritePathsIn` 返回空 → 该形状不进入成员路由）。
本 AC 针对**路由层**，验收断言应打在 `memberWritePathsIn` / 枚举分类上，
**不是**打在「`expressions` 是否为空」上。

### AC-2 — member-held mutation coverage（P1-B）

| 项 | 内容 |
|---|---|
| 验收 | 成员持有的信任集**构造后 mutation**（`.add` / `.delete` / `.clear`）必须被纳入 provenance |
| **本轮实测结论** | **在 r11 HEAD 上未复现为漏检**。四种变体（`add` / spread+`add` / `delete` / 内联 `pool[0].rawQuery`）**均被检出**（`contains_extra=true` / `contains_rawQuery=true`）；**r10 `9bcf63f` 上同样检出** |
| 诚实标注 | r11 评审记录称此为 P1-B。**本轮未能复现该漏检**。可能原因（**未验证，不作结论**）：评审的复现形状与本轮所用形状不同，或该问题已被 r11 的 `memberWritePathsIn` 改动间接覆盖 |
| 处置 | **AC 保留**（owner 已裁决不拆票），但实现期**第一步就是用评审原始形状复现**；若仍不复现 → **记录为 `NOT_REPRODUCIBLE` 并关闭该 AC**，**不得**为了「完成 AC」而制造一个假漏检 |
| 必测 | A3 用例 + 真实文件变体（该形状会触发 P0：31 153 ms / 292 / 5 014） |

### AC-3 — absent spelling normalization（P1-C）

| 项 | 内容 |
|---|---|
| 验收 | 信任集 walker 的**所有局部拼写**必须被枚举，**不得**从 `trusted` / `untrusted` / `unparsed` 任一列表中 **ABSENT**（ABSENT → A1 不变绿 → C3 永不迭代） |
| 本轮证据 | 6 个形状实测：`c3-call`（`.call`）= **ABSENT**；`c6-comma-chain`（逗号多声明链调用）= **ABSENT**；其余 4 项（解构 import / `.bind` / 解构赋值到成员 / 计算键）= `call-trusted` |
| 必测 | A7 全部 6 形状 + 变异 N5（分类器/resolver 口径一致性） |

### AC 汇总

| AC | 目标 | 本轮状态 | 阻塞性 |
|---|---|---|---|
| AC-1 | dotted receiver | **缺口已确认** | P1 |
| AC-2 | member-held mutation | **未复现为漏检**（诚实标注） | P1（需先复现） |
| AC-3 | absent spelling | **2/6 形状 ABSENT 已确认** | P1 |

> **scope 提示（诚实，不阻塞）**：把 AC-1/2/3 合并进 #131 使其**范围显著大于**纯 P0 修复
> （P0 只是终止性；AC 还要求修既有漏检）。这**提高**了实现期误判「AC 已达成」的风险 ——
> 尤其 AC-2 当前**无复现证据**。owner 已裁决不拆票，本 plan 遵从；
> 建议实现期**逐 AC 独立取证**，任一 AC 无法取证即报 `AC_UNPROVEN` 而非默认通过。

---

## PART 6 — DEPENDENCY / 边界声明

```text
T11 r11                              = FROZEN（commit 2934956 不可变；32/32 pass；lib/ byte-identical to r10）
#131 remediation                      = NEW WORK（独立分支/worktree；不在 r11 分支上施工）
INTEGRATION_AUTHORIZATION             = NONE
IMPLEMENTATION_AUTHORIZATION          = NONE
BRANCH_DISCIPLINE                    = 独立分支；不得在 work/p2a-t11-… 或 feat/cross-question-web-demo 上施工
BASE_FOR_IMPLEMENTATION               = r11 2934956（在其之上追加 commit，append-only；禁止 amend/rebase/squash）
```

**Scope creep 防线（明确不在本票内）**

- 任何 `lib/` 改动；
- r11 fast path 的语义重写；
- 删除或改名现有导出；
- **P2 类**（`Object.assign` / `Object.defineProperty` / `Reflect.set` / `??=` / 模板计算键）
  若要**修复** → 各自独立成票；本票仅要求它们 **fail closed**（A5 / A6），**不要求检出**；
- 引入 type checker / linter / 完整 JS 理解；
- P1-R04 等其他票的既有 fail。

**待补产物（实现期必须入库，否则不可复现）**

1. r11 **M1–M7** mutation 矩阵的具体定义与期望；
2. 5 行合成 fixture 的**精确 14 表达式**基线（本轮仅确认「合成快、真实文件慢」这一定性结论）；
3. 本 plan 未发布的探针脚本（建议落 `research-orchestration/test/helpers/` 附近，**不**进 `lib/`）。

---

## PART 7 — 待 owner 裁决

| # | 问题 | 影响 |
|---|---|---|
| 1 | `acorn` 作为 devDependency 是否可接受？ | 若否 → 退化为**纯预算方案**（只做 PART 4-C），**仍能修 P0**，但 AC-1（dotted receiver）无法修 |
| 2 | AC-2（P1-B）**本轮未复现** —— 是接受「实现期先复现、否则记 NOT_REPRODUCIBLE」，还是要调整该 AC？ | 决定 AC-2 的处置方式 |
| 3 | 三个 AC 合并的**范围风险**已如实标注 —— 是否维持不拆票的裁决？ | 影响 `START_GATE` 判定 |
