# P2A-T11 / #131 — Remediation Implementation Plan（V3）

```text
DOC_ID            = P2A_T11_131_REMEDIATION_PLAN_V3
TYPE              = IMPLEMENTATION_PLAN（设计稿；不含实现）
TICKET            = #131（P0，独立票）
TICKET_STATUS     = OPEN（#131 尚未关闭）
SUPERSEDES        = docs/planning/P2A_T11_131_REMEDIATION_PLAN_V2.md
                    @ 55cc01e8e878a6d68562e6c239779d561ae46b3a（**历史保留，不修改**）
                    （该 V2 含 APPENDIX D errata；V2 正文 §3 与 §4-AC-4 已被其自身
                      APPENDIX D 撤回 —— 见本文件 PART 3 / AC-4 / APPENDIX E）
DESIGN_AUTHORITY  = T11_REMEDIATION_ARCHITECTURE_REDESIGN_REPORT
                    （Codex 架构重设计，本轮机械核验；见 APPENDIX C 的 SHA 绑定）
BASE              = master @ 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
SUBJECT           = work/p2a-t11-trust-boundary-executable-guards
                    @ 293495626d993137f2691f99df4dce2cb156762b（r11，frozen）
IMPLEMENTATION_AUTHORIZATION = NONE
NEW_CODE_CHANGED            = NONE
AST_PARSER_INTRODUCED       = NONE
ACORN_DECISION              = REJECTED（deferred，非永久否决）
T11_R11_MODIFIED            = NO
ARCHITECTURE               = UNCHANGED_FROM_V2（path identity + bounded traversal；
                              本文件只修复证据契约 / 符号 / 验收准则，不重写架构）
```

> 本文件**不授予实现授权**。V1 与 V2 保留为历史记录（append-only 纪律：已评审内容不得静默改写）。
> V3 是**新的实施契约**，与 V1/V2 冲突处**以 V3 为准**，并须在实现期回头关闭前序错误结论。
> 权威顺序不变：`RULES.md` > Applicable Approved Specs > `docs/architecture/key-decisions.md` > 本文件。
>
> **V3 的修订范围（owner 明确约束）**：V3 把 V2 的 REJECT 作为**输入**，**不重写架构**。
> 只修复三类东西：**（a）证据契约**（基线数字口径、测量方法）、**（b）符号**
> （行号引用、函数名、fixture 命名）、**（c）验收准则**（AC 门限与失败方向）。
> 架构命题 P0-1…P0-5、PART 2 的两个 DEFECT、AC-1/AC-2/AC-3 的目标与形状集不变。

---

## PART 0 — FRESH TRUTH（2026-10-02，V3 修订轮复验）

```text
git ls-remote origin refs/heads/master                                       = 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
git ls-remote origin refs/heads/work/p2a-t11-trust-boundary-executable-guards  = 293495626d993137f2691f99df4dce2cb156762b
git ls-remote origin refs/heads/docs/p2a-t11-131-remediation-plan            = 55cc01e8e878a6d68562e6c239779d561ae46b3a（V2+errata）
main worktree = master @ 2afe106，clean（porcelain 0 / untracked 0）
r11 套件      = 32 tests / 32 pass / 0 fail（本轮未重跑；见 §0.1）
r11 lib blob  = 8ac163e72134dad11bb83b2781b2952538c6dd9f
r10 → r11 diff -- research-orchestration/lib/ = EMPTY（0 行）
```

**§0.1 r11 冻结态（继承 V2 实测，本轮以 blob 与 diff 复核，未重跑套件）**

```text
node --test test/p2a-t11-trust-boundary-executable-guards.test.mjs
→ # tests 32 / # pass 32 / # fail 0（@ 2934956，本轮未变更该分支，故沿用）
git diff 9bcf63f 2934956 -- research-orchestration/lib/   → EMPTY
本轮 V3 复验：r11 worktree HEAD == 2934956；lib/ 无 diff；blob == 8ac163e7
```

**§0.2 本文件所引用的全部源码锚点（V3 逐条机械核验于 r11 HEAD 2934956）**

```text
GATE-1  SINGLE_SEGMENT_FORM            helper L1614   （isWalkableTrustSetName L1703 使用）
GATE-2  propertyWritePattern 单接收者锚  helper L1745
        resolveTrustSetProvenance 签名   helper L602   （source, rootVar, {maxDepth=8, budget}）
        member 分支 seen key             helper L831   （`member:${receiver}.${member}`）
        bindingsOf 内 receiver-mutation  helper L745   （`\bNAME\s*\.\s*ident\s*\(`）
        bindingsOf 定义                  helper L634
        propertyWriteBindingsOf 定义     helper L1824
        memberWritePathsIn 定义          helper L1800
        splitMemberAccess 定义           helper L1658
        test 内 C3 共享 budget           test    L810
        test 内 stripComments            test    L1141
        test 内 classifyTrustSetValue    test    L1083
        test 内 .add() 既有用例（裸变量） test    L1173 / L1249 / L1271
        coverage-final-integration.mjs:461（噪声对照锚点）  lib/
```

---

## PART 1 — 已确认结论（Codex 验证，本轮复验，直接继承）

```text
[P0-1] #131 P0 CONFIRMED
       NAME 维度病态展开真实存在，非虚构、非仅理论。

[P0-2] T11 r11 FROZEN
       2934956 不可变；32/32 pass；lib/ 与 r10 byte-identical。

[P0-3] NO FULL AST REWRITE
       语法层重写整个 helper 被禁止：绿无法区分「更对」与「口径漂移」。

[P0-4] AST IS NOT SEMANTIC AUTHORITY
       任何 AST 组件不得自行判定 trust verdict；判定权保留在现有 r11 守卫。
       AST（若引入）最多是「拼写枚举」的次级 fallback 提取器。

[P0-5] PATH IDENTITY IS THE CORE
       真正的缺陷不是「解析能力不足」，而是**信任身份在 NAME 维度坍缩**。
       `state.inner.__trusted` 被当作 `state` 处理 → 绕过成员写判定。
```

---

## PART 2 — 被修正的失败假设（V1 的错误，此处显式作废）

### 2.1 作废的假设

```text
V1 主张（已证伪）:
  "AST solves dotted receiver detection"
  "regex/name 提取 → AST 提取 → 现有 trust gate"

V1 隐含模型 = 缺少提取能力，加 AST 即可补上。
```

### 2.2 机械证伪（关键，**V1 与 START_GATE 均未预见**）

`splitMemberAccess` **早已支持任意深度成员链**：

```text
实测（真实 r11 helper，r11 HEAD）:
  splitMemberAccess("state.inner.__trusted")
    = { receiver: "state.inner", member: "__trusted" }     ← 任意深度链早已可得

  splitMemberAccess("holder[k]")  = null
  isWalkableTrustSetName("state.inner.__trusted") = false ← 这才是 C3 分类器的门
```

**结论：路径抽取能力已存在，无处可「加」。**
若照 V1 修法（「从 AST 取任意深度成员链」）实施，会得到
**「改了但没修」的假 GREEN** —— 这是 START_GATE 判定 V1 不可实施的直接原因。

### 2.3 修正后的命题（新的实施契约基础）

```text
CORRECTED:
  existing syntax extraction is sufficient;
  missing abstraction is PATH-LEVEL IDENTITY and BOUNDED TRAVERSAL.
```

即：缺的不是「把名字解析成路径」的能力，而是
**（a）让信任身份以完整路径参与匹配，不坍缩到 receiver**，
**（b）让遍历在任何维度上都是有界的**。

### 2.4 根因：两个独立缺陷（不是「组合爆炸」）

```text
DEFECT-A  AMPLIFICATION（放大）
  seen 按**裸名**去重。同文件区域在不同路径下被反复重扫。
  已确认存在（机制 + 生产路径不终止的实测，见 PART 3）。
  ⚠️ V2 的「~110.7 次」「42 279 names」等具体倍数/数量**已撤回**
     （D.5：分母来源不可追溯；D.1：输入口径错误）。本文件不引用任何百分比或倍数。

DEFECT-B  PATH COLLAPSE（路径坍缩）
  provenanceIdentifiersIn 按设计剥离属性名 ⇒
  `state.inner.__trusted` 的信任身份坍缩为其根 `state`
  已确认存在（splitMemberAccess 任意深度可用，但 isWalkableTrustSetName 拒绝之）

DEFECT-C  EXPENSIVE FAIL-CLOSED（昂贵的失败闭合）
  名字若有导入/绑定等任何出处 ⇒ 当前代码**先**调 resolveCallReturnProvenance
  重读包含该名的整个函数体，**然后**才得出结论。正确结论被正确得出，但代价极高。
  已确认机制上成立；⚠️ **占比未知**（D.5 撤回 V2 的「~31%」）。
  本文件不写任何百分比归因。
```

**实测排除（保留）**：增长曲线平坦（M7 副本 n=1..4 恒为 293 expr / 1 895 unres），
RHS 形状无关（`pool.__trusted = pool` 仍同量级），
全文件正则单次扫描仅 0.25 ms ⇒ **不是组合爆炸，不是解析成本**。

---

## PART 3 — BASELINE EVIDENCE（V3 重写：V2 数字已由其 APPENDIX D 全部撤回）

> **本节整节替换 V2 §3.1–§3.4。** V2 的基线数字不是「精度不足」，而是**口径错误**
> （详见 V2 APPENDIX D.1：手写 `stripComments` 有损、`budget` 参数未测、
> 且从未走真实 C3 路径）。本节只保留**已证事实**，不保留任何 V2 数字。

### 3.1 输入类型必须显式标注（V1 混用、V2 误标，本节钉死）

```text
RAW      = 保留注释的源码文本。仅用于**诊断**（读代码、定位形状）。
STRIPPED = 经生产 stripComments（test L1141）处理后的文本。
           **这才是 C3 的真实输入**，一切验收断言必须以 STRIPPED 为准。

实测（V3 复核，真实实现 = 两条 regex replace，注释→空格，长度保持）:
  lib/targeted-requery-subphase.mjs
    raw.length      = 46 042
    stripped.length = 46 042        ← 不变（V2 的「stripped 更短」前提不成立）
    非空白字符        : 37 097 → 18 045
⇒ RAW 与 STRIPPED 的差别是**注释文本是否存在**，不是长度。
```

### 3.2 已证事实（唯一有效的生产路径证据）

```text
实验：真实 r11 套件 + M7 变异，施加于 lib/targeted-requery-subphase.mjs
     （在完整 worktree 上跑，非 /tmp 抽树；事后已还原，blob 回到 8ac163e7）

结果：node --test test/p2a-t11-trust-boundary-executable-guards.test.mjs
     → timeout 600 ⇒ EXIT=137 (SIGTERM)，无任何 TAP summary

⇒ 结论（PROVEN，生产路径）：#131 P0「不终止」成立。
   这就是 #131 P0 的**唯一**直接证据，也是本票存在的理由。

对照（必须记录，否则归因会再次走偏）:
  control（未变异，root=trusted）→ 立即完成，expressions=2，unresolvable=0
  ⇒ 挂起**不是**套件本身慢，而是 M7 变异触发的病态展开。
```

### 3.3 helper 直调数字：降级为「实现期回归参照」，不得作门限

```text
⚠️ 以下数字来自**直接调用 helper**，不是生产 C3 路径：

  RAW   + M7 appended,  budget=YES → 12 053 – 12 739 ms / 293 expr / 1 895 unres
  RAW   + M7 appended,  budget=NO  → 35 492 – 36 781 ms / 298 expr / 6 410 unres
  STRIP + M7 appended,  budget=YES →  4 647 –  5 110 ms / 266 expr /   374 unres
  STRIP + M7 inserted,  budget=YES →  4 583 –  4 817 ms / 266 expr /   374 unres
  control root=trusted              →         5 ms /   2 expr /     0 unres

为什么不可作门限（三条，各自独立成立）:
  (1) 生产 C3 在 test L810 声明 `const budget = { visited: new Set() }`
      并**共享**给每个路由；直调每次传**新** budget ⇒ 口径不同。
  (2) helper 直调绕过了 stripComments / trustSetRootsOf / classifyTrustSetValue /
      memberWritePathsIn / 跨模块路由。
  (3) M7 是「append」还是「insert」也改变结果（虽在直调口径下二者接近）。
⇒ 纪律（V1 §B.6 早已写下，本轮第三次复发，必须固化）:
  **禁止**用直接 helper 调用替代 C3 路径取证。
```

### 3.4 验收门限：V2 的「修复前基线 + 余量」推导法作废

```text
V2 的推导：观测最差 3 652 ms ⇒ 门限 5 000 ms ⇒ 1.37× 余量。
作废理由：不存在「修复前 4.6 s / 3.7 s」这个参照系 —— 生产路径根本不终止。
⇒ 「修复后应该多快」在本轮**无经验值**（本轮无实现）。
⇒ 本文件（V3）**不给出**任何时间门限作为 AC 门。
   AC-4 的门是**终止性 + 有界性**（见 PART 4 AC-4 / PART 5），不是毫秒数。
   若 owner 希望保留一个时间护栏，见 AC-4.5（明标为先验值、无经验支撑）。
```

---

## PART 4 — ACCEPTANCE CRITERIA（V2 重写，AC 语义与 V1 不同）

> **AC 编号语义已变更** —— V1 的 AC-1/AC-2/AC-3 与 V2 不可混用。
> 实现期若引用旧编号即视为契约漂移。

### AC-1 — PATH-LEVEL IDENTITY（V3 修订：显式授权 GATE-1 / GATE-2；canonicalKey 定义修正）

```text
目标：
  信任匹配以完整 canonical path 进行，不得坍缩到 receiver。

规范表示（canonical path representation）:
  state.inner.__trusted          ← 必须保留完整 receiver 链
  不能坍缩为:
  state                          ← 这是 V1 时代的行为，构成 silent fail-open

必须定义并实现:
  canonicalPathOf(expr, source) → { receiverPath, property, … }，保留完整链
  canonicalKey = `${root}@${depth}`        ← V3 修正（见下方 D.6 对应说明）
    · 不含 file:line：resolveTrustSetProvenance(source, rootVar, {…})
      （helper L602）内部**拿不到 file**，加 file:line 必须改导出签名，
      而当前 scope **未授权**改该签名（D.6）。
    · 若实现期判定 file:line 必需 ⇒ 须在 Phase 1 显式申请签名变更并列入 scope。
  root 保留完整 receiver 链，属性名不剥离

硬不变量（纳入测试）:
  INV-1  canonicalPathOf(v) 保留完整链；
        若任何代码路径把它降级为 receiver ⇒ 抛错，**禁止静默**
  INV-2  receiverPath 不同的两条 IR ⇒ canonicalKey 必须不同
        （禁止两条路径静默合并成一条）
        ⚠️ V3 注意：key = `${root}@${depth}` 下，两条**同深度同根**但
        receiverPath 不同的 IR 会得到**相同** key ⇒ INV-2 必须改用
        receiverPath（而非 key）作为唯一性判据。V2 的 INV-2 表述有缺陷。
  INV-3  writeKind = unknown ⇒ 下游必须 unresolvable（fail closed），禁止 CLEAN
  INV-4  IR 的 confidence 只能是 syntax-structural | spelling-only；
        **禁止**出现 "resolved"（解析是 L2 职责，IR 不做判定）
```

**V3 新增：GATE-1 / GATE-2 的点名授权（V2 §6-B「fast path 语义不变」与 AC-1 冲突）**

```text
V2 的冲突：§6-B 写「fast path 语义不变」，实现者会读作**禁止**放宽，
          而放宽 GATE-1/GATE-2 恰是 AC-1 必须做的事 ⇒ 契约自相矛盾。

V3 的精确化（消除歧义）:
  「fast path 语义不变」的定义 = **单段 receiver（形如 a.b）的判定结果不变**。
  多段 receiver（a.b.c 及更深）属**新增覆盖**，不在「不变」范围内。

本 AC **显式授权**修改且**仅**授权以下两处既有谓词:
  GATE-1  isWalkableTrustSetName → SINGLE_SEGMENT_FORM（helper L1614，L1703 使用）
          现状：只接受「裸标识符 + 至多一级属性」；`a.b.c` 不满足 ⇒ 归为 __expr__
          授权：放宽为接受多段成员链
  GATE-2  propertyWritePattern 的单接收者锚（helper L1745）
          现状：`(?<![.\w$])([A-Za-z_$][\w$]*)` ⇒ 任何 `.X.__trusted =` 恒不匹配
          授权：放宽为接受多段 receiver
  其余谓词**不得改动**（含 splitMemberAccess / memberWritePathsIn /
  propertyWriteBindingsOf / bindingsOf / provenanceIdentifiersIn 的既有语义）。

噪声对照（放宽不得引入新噪声，r10 P1-2 回归面）:
  放宽后，coverage-final-integration.mjs:461 的
  `Array.isArray(plan.queryVariants) ? plan.queryVariants : []`
  **不得**新增 unresolvable —— 即放宽只对**确有属性写**的多段路径生效。
```

**为什么 V1 的 AC-1 不成立**：V1 写「`memberWritePathsIn(dotted)` = `[]` → 缺口确认」。
实测该结论**只在 fixture 内另有**一个一级 `.trusted =` 写入时成立 —— 而那是非空
**false positive**，不是检出：

```text
fixture（仅 dotted 写，生产形态）  memberWritePathsIn → []      ← 真正的缺口
fixture（一级 + dotted 混合）      memberWritePathsIn → ["state.inner.trusted"]
                                  ← 来自那个一级写入的误报，非检出
真实 lib/targeted-requery-subphase.mjs（46 042 chars）→ 全部 []
```

根因：`propertyWritePattern` 锚定**单裸标识符接收者**（`(?<![.\w$])([A-Za-z_$][\w$]*)`），
所以任何 `.X.__trusted =` 恒不匹配。**fixture 混入一级写会掩盖真实缺口**。

### AC-2 — TRUST MUTATION COMPLETENESS（V3 修订：F1–F4 全部钉死；V2 覆盖表作废）

```text
目标：
  成员持有的信任集，构造后 mutation 必须被纳入 provenance。

V1 的错误结论已作废:
  V1 曾写「未复现为漏检，若不复现则记 NOT_REPRODUCIBLE 并关闭本 AC」
  ⇒ 该处置会关闭一个**真实且可复现的 silent fail-open**，已作废。
```

**V2 的覆盖表错误（V3 明确作废）**

```text
V2 §4 AC-2 写「holder.trusted + .add(rawQuery) → DETECTED（12 violations）」。
⚠️ 该表项经评审与本方复跑双重确认**为错误，已作废**：

  真实 C3 路径实测（r11 HEAD 2934956）:
    holder.trusted = new Set(plan.queryVariants)
      + holder.trusted.add(targetedPools[0].rawQuery)  → violations=0, unresolvable=0  ← 漏检
    换 .delete                                            → 0/0
    换参数拼写（rawQuery / proposals[0].queryText）        → 0/0
    mutation 放在 write 之前                              → 0/0
    仅当写入的 RHS 本身含 targeted 词                      → 18 violations / 7 unres
      且**加不加 .add() 结果完全相同**（18/7）
  ⇒ V2 的「12 violations」来自 RHS，不来自 .add()。
  ⇒ r11 套件中**没有任何**断言成员 `.add()` 被检出的测试
     （现有 .add() 用例全是裸变量：test L1173 / L1249 / L1271）。
```

**机制（这是 silent fail-open 的根因，V3 已钉死）**

```text
bindingsOf 的 receiver-mutation 规则（helper L745）:
  \bNAME\s*\.\s*[A-Za-z_$][\w$]*\s*\(        ← 要求 receiver 是**裸名**
  对 `holder.trusted.add(` **不匹配**（trusted 后面跟的是 `.add(` 而非 `(`）
propertyWriteBindingsOf（helper L1824）只处理 `R.x = RHS`，**不含 `.add()`**
⇒ 成员级 mutation **结构性未覆盖**。
```

**V3 必测 fixture（F1–F4 全部，无一例外；必须逐字钉死源码，禁止语义描述）**

```text
F1  holder.trusted      = RHS  +  holder.trusted.add(x)
    期望 DETECTED（violations > 0）
    —— 当前实测 0/0 ⇒ 这是 silent fail-open，修复后必须 > 0

F2  state.inner.trusted = RHS  +  state.inner.trusted.add(x)
    期望 DETECTED（violations > 0）
    —— 多段 receiver，走 AC-1 的 path-level 匹配，禁止因身份坍缩而 0/0

F3  holder[k]           = RHS  +  holder[k].add(x)
    期望 unresolvable（fail closed）
    —— 计算键 writeKind=unknown；**判 CLEAN 即 P0**

F4  holder.trusted      = RHS（内联，无 .add）    期望 DETECTED（已成立，作对照）
```

**失败方向（V3 显式化）**

```text
F1 漏检（violations=0）          = P0
F2 漏检（violations=0）          = P0
F3 判 CLEAN（而非 unresolvable） = P0
F4 漏检                          = P0（说明连已有能力都退化）
```

### AC-3 — ABSENT SPELLING NORMALIZATION（继承，形状集已钉死）

```text
目标：
  信任集 walker 的所有局部拼写必须被枚举，
  不得从 trusted / untrusted / unparsed 任一列表中 ABSENT
  （ABSENT → A1 不变绿 → C3 永不迭代 → fail-open）

V2 复验（真实枚举器，10 形状）:
  s1 逗号首声明符（r11 自身形状）           → trusted
  s2 alias 后调用（const a=F, b=a; b()）      → ABSENT
  s3 walker 作逗号第二声明符                  → ABSENT
  s4 .call(null, …)                          → ABSENT
  s5 .apply(null, […])                       → ABSENT
  s6 解构 import（as w）                      → trusted
  s7 .bind(null) 后调用                       → trusted
  s8 解构赋值到成员                           → trusted
  s9 计算键 pool[k] = …                       → trusted
  s10 裸变量对照                             → trusted
  ⇒ 4 个 ABSENT = s2 / s3 / s4 / s5

关键结论（V1 未验证）:
  AC-3 **不是 parser 任务**。实测:
    s4 (.call) / s5 (.apply) → 纯词法，regex 可恢复
    s2 / s3 (alias / 逗号链) → 属 localWalkerNames 的 alias 近似问题，
                              已在枚举器内部解决，无需 parser
  ⇒ 不引入 parser 即可修 AC-3
```

### AC-4 — BOUNDED TRAVERSAL（V3 修订：门从「毫秒数」改为「终止性 + 有界性」）

> V2 把 termination 提升为独立 AC（对），但把门限写成毫秒数（错 —— 无参照系）。
> V3 的门是**终止性 + 有界性**。毫秒数护栏降级为 AC-4.5（先验值，无经验支撑）。

```text
AC-4.1  终止性（首要门）：真实 r11 套件 + M7 变异，必须在 < 5 000 ms 内
        产出**完整 TAP summary**（# tests / # pass / # fail）且 EXIT=0。
        判据是「跑完」，不是「跑得快」。
        ⚠️ 5 000 ms 是**先验设定**：本轮无实现，无法给出「修复后应多快」的经验值。
           若实现后仍 > 5 000 ms ⇒ 报告实测值 + 归因，**不得放宽门限**.
AC-4.2  截断可审计：任何预算/深度截断必须产生显式 unresolvable + 原因；
        **禁止**返回空 expressions（fail-open）；**禁止**计入 call-untrusted.
AC-4.3  全量有界：42 个 lib/*.mjs 的 full-offline 枚举 + C3 全部有界终止.
AC-4.4  CI 全量跑不挂起（历史证据：M7 变异后套件 SIGTERM 137 / EXIT=137）.
AC-4.5  性能护栏（**非门限**，仅回归护栏）：修复后 helper 直调 M7 ≤ 5 000 ms
        （当前参照 4 647 – 5 110 ms）⇒ 该护栏**只有 ~0% 余量**，
        故必须先测实现后的稳定带再定，**不得**直接沿用 5 000。
```

### AC 汇总（V3 修订）

| AC | 目标 | 状态（V3 口径） | 阻塞性 |
|---|---|---|---|
| AC-1 | path-level identity | 缺口已机械确认（GATE-1/GATE-2 已点名） | P0 |
| AC-2 | mutation completeness | **silent fail-open 已确认**（F1 当前 0/0） | P0 |
| AC-3 | absent spelling | 4/10 形状 ABSENT 已确认（P2-6 残余风险） | P1 |
| AC-4 | bounded traversal | **生产路径不终止已确认**（EXIT=137） | **P0（#131 本体）** |

---

## PART 5 — TERMINATION MODEL（V3 重写：D2 论证撤回；D3/D4 耦合约束显式化）

> 要求（owner）：**任何 fan-out 必须 bounded。**
> V1 只提「NAME 维度共享预算」，遗漏了路径键维度与 maxDepth 交互。

### 5.1 四个必须分别有界的维度

| # | 维度 | 当前状态 | 要求 |
|---|---|---|---|
| D1 | **maxDepth**（深度） | `maxDepth = 8`，已存在（helper L602） | 保留；截断 → `unresolvable`，fail closed |
| D2 | **seen key**（身份维度） | 裸名分支按**裸名**去重 → 路径坍缩 + 放大 | 裸名分支键改为 **canonicalKey**；成员分支已具备路径粒度（helper L831 `member:${receiver}.${member}`），**不在 D2 范围** |
| D3 | **NAME budget**（名称预算） | **不存在** | 新增：跨 `walk()` 共享，每 name 每次顶层 walk 至多解析一次 |
| D4 | **path budget**（路径预算） | **不存在** | 新增：单次 walk 内 canonicalKey 扩展数上限 |

### 5.2 D2 的论证：V2 的版本已撤回（V3 修正）

```text
⚠️ V2 §5.2 写「path 键 230 < 名键 253 ⇒ 不增加工作量」。**该论证撤回**：
  (a) V2 把 D2 的键定义为 canonicalKey = ${root}@${file}:${line}（**更细**的键）
      ⇒ 按定义只会**减少去重、增加条目**，与「不增加工作量」矛盾；
  (b) 「230 < 253」的**输入与作用域未标注** —— 正是 RAW/STRIPPED 混用陷阱；
  (c) canonicalKey 含 file:line，但 resolveTrustSetProvenance（helper L602）
      内部**拿不到 file** ⇒ 加 file:line 须改导出签名，V2 未提及；
  (d) 「seen 按裸名去重」只对**裸名分支**成立；成员分支已用路径粒度
     （helper L831）⇒ V2 对「新工作」的描述不准确。

V3 的处置:
  1. canonicalKey **降级**为 `${root}@${depth}`（不含 file:line，避免改签名）；
     若实现期认为 file:line 必需 ⇒ Phase 1 显式申请签名变更并列入 scope.
  2. D2 的「新工作」精定义 = **裸名分支**的键从 name 改为 canonical path；
     成员分支已具备路径粒度，不在范围。
  3. **不得**声称 D2「不增加工作量」；若要主张，须同输入、同作用域、显式标注后重测，
     并接受「更细的键可能增加工作量」的结论 —— 此时 D3/D4 才是补偿手段。
```

### 5.3 D3 / D4 耦合约束（V2 缺失，V3 新增；AC-4 的核心可行性风险）

```text
预算 N 必须同时满足两个不等式:

  (1) N  ≥  合法 walk 的最大函数体读取数
        否则截断**合法**的深路径 ⇒ 假阴性 ⇒ fail-open（P1 级）
  (2) N × 单次体读取成本  ≤  AC-4.1 门限
        否则门限不可达

本轮已测的体读取成本（helper 直调口径，非生产路径）:
  M7（生产文件）= 4 647 – 5 110 ms；control = 5 ms
  ⇒ 二者相差约 1 000×，而「合法 walk 的最大体读取数」**未知**
     （因生产路径不终止，无法在修复前测出该值）

⇒ 结论：**可行窗口可能很窄，甚至为空**。这不是可推迟的细节，
   而是 AC-4 的**核心可行性风险**。V3 处置:
  1. Phase 1 必须**先测** (1) 的值（在 42 模块真实语料上跑未变异的 C3，
     记录最大体读取数），再定 N；
  2. 若 (1) 与 (2) 无交集 ⇒ **不得**靠放宽门限解决，须回 PART 2 重新设计
     （候选：把 DEFECT-C 的廉价 blind-spot 路径作为**先决条件**，
     先把体读取数降下来，再谈预算 N）;
  3. 该可行性检查须作为 Phase 1 的**出口条件**，写进 Phase 2 的前置。
```

### 5.4 三个预算的失败方向必须一致

```text
D1 maxDepth 截断  → unresolvable + "max depth N exceeded"      （已存在）
D3 NAME 预算耗尽  → unresolvable + "NAME_BUDGET_EXHAUSTED"     （新增，方向须与 D1 一致）
D4 path 预算耗尽  → unresolvable + "PATH_BUDGET_EXHAUSTED"     （新增，方向须与 D1 一致）

禁止：任一预算耗尽时返回空 expressions
     （空 verdict = fail-open，P1-1 教训）
禁止：任一预算耗尽时计入 call-untrusted
     （P1-2 教训：分类器与 resolver 口径不一致使分支永不可达）
```

### 5.5 终止性机械验收

```text
AC-4.1  M7 on STRIPPED（真实生产文件，钉死输入）
        → 完整 TAP summary + EXIT=0，且 < 5 000 ms（先验门限，见 AC-4.1 注）
AC-4.2  42 个 lib/*.mjs 全量 full-offline 枚举 + C3 全部有界终止
AC-4.3  每个预算耗尽都产生显式 unresolvable + 原因
AC-4.4  CI 全量跑不挂起（历史：变异后套件 SIGTERM 137）
AC-4.5  helper 直调 M7 ≤ 5 000 ms（**护栏，非门限**；~0% 余量，须先测稳定带）
```

---

## PART 6 — IMPLEMENTATION BOUNDARY（不写代码）

```text
A. 路径身份层（新增）
   - canonicalPathOf(expr, source) → 完整路径，永不坍缩
   - canonicalKey = `${root}@${depth}`      ← V3 修正（去掉 file:line，见 AC-1 / §5.2）
   - 消费 IR：root / receiverPath / property / accessKind / writeKind /
             confidence / sourceLocation / canonicalKey
   - 判定权：IR 层 NONE；保留在现有 r11 守卫
   - ⚠️ 本项**未授权**改 resolveTrustSetProvenance 的导出签名（helper L602）；
     若 file:line 必需 ⇒ Phase 1 显式申请并列入 scope

B. 现有 resolver 兼容
   - 14 个现有导出**不得**删除或改名
   - **「fast path 语义不变」= 单段 receiver（形如 a.b）的判定结果不变**；
     多段 receiver（a.b.c 及更深）属**新增覆盖**，不在「不变」范围内（V3 精确化）
   - r11 现有 32 测试**全部保留、逐条不改断言**（回归保护网）

C. 廉价 fail-closed 路径（DEFECT-C 主修复）
   - 全文件符号表**一次性**查表；无绑定即直接报 blind spot
   - **不读函数体**（当前行为：读最大函数体后才报同一结论）
   - 注意：blind-spot 过滤须**先排除** isLibRelativeImport 名，否则漏真实跨模块 trust
   - ⚠️ D.9 的可行性结论：DEFECT-C 可能是 AC-4 的**先决条件**（先降体读取数，再谈预算 N）

D. 预算 backstop（D1–D4）
   - 数值先测后定，记录测量过程
   - 必须满足 §5.3 的**两个不等式**：(1) N ≥ 合法 walk 最大体读取数；(2) N × 单次成本 ≤ AC-4.1

E. 对抗语料（fixture 逐字钉死，禁止实现者自造）
   - A 简单成员写：holder.trusted
   - B 嵌套成员写：state.inner.trusted      ← **fixture 仅含 dotted 写，禁混入一级写**
   - C 计算属性：holder[k]
   - D 别名：const a=F, b=a; b()
   - E 解构：import { F as w } / ({t: h.trusted} = obj)
   - F 生产文件 STRIPPED：root=trusted ≤ 50 ms / expr=2 / unres=0
   - G 大规模语料：42 模块 full-offline
   - H 终止压力：M7 on STRIPPED → **完整 TAP summary + EXIT=0**（不再以 ms 为门）

E2. AC-2 专项 fixture（V3 新增，与 PART 4 的 F1–F4 同一组，见 AC-2）
   - F1 holder.trusted.add(x)      → violations > 0（当前 0/0 = silent fail-open）
   - F2 state.inner.trusted.add(x) → violations > 0（多段 receiver）
   - F3 holder[k].add(x)           → unresolvable（判 CLEAN 即 P0）
   - F4 holder.trusted = RHS（无 .add，对照）→ violations > 0
   ⚠️ 与 E 组命名冲突已消解：AC-2 用 F1–F4，PART 6-E 语料用 A–H（互不复用）。

F. Mutation tests（每个必须被某测试 catch）
   - N1 预算耗尽改为「返回空 expressions」→ 被终止性测试 catch（防空 verdict）
   - N2 canonicalPathOf 降级为 receiver       → 被 AC-1 测试 catch（= 重新引入路径坍缩）
   - N3 廉价 blind-spot 误吞 import 名          → 被 AC-4 测试 catch（边界项 C，见下方映射）
   - N4 D3/D4 与 D1 失败方向调反               → 被预算方向一致性测试 catch
   - N5 unresolvable 计入 call-untrusted        → 被分类器/resolver 口径一致性测试 catch
   - N6 任意深度检出改回只认裸标识符            → 被 B 用例 catch

G. 安全评审要求
   - Quorum：1 × CODE_REVIEWER + 1 × SECURITY_REVIEWER，同 exact HEAD，优先异模型
   - 禁止 self-review；executor 不得派生 reviewer
   - 模型优先级：DeepSeek V4.1 Flash → GLM 5.3 → DeepSeek V4 Pro
     （fallback 仅限 MODEL_UNAVAILABLE / RATE_LIMIT / QUOTA / TOOL_FAILURE /
      CONTEXT_CREATION_FAILURE；reviewer 给 findings 不是换模型理由）
   - 每 review 留 receipt：MODEL_REQUESTED / MODEL_ACTUAL / FALLBACK_USED /
     FALLBACK_REASON / REVIEWED_EXACT_SHA / VERDICT / OPEN_P0_P1
   - 归因方法：涉跨包 import 的套件**必须**用完整 worktree 或 node_modules 符号链接；
     **禁止**裸 git archive 抽树（缺兄弟包 → ERR_MODULE_NOT_FOUND 假红）
   - OPEN_P0_P1 > 0 ⇒ 禁止 integration / CI / closeout
```

### AC ↔ 边界映射（V3 修正 N3 归属；可机械核对）

```text
AC ↔ 边界映射:
  AC-1 path identity      → A（IR / canonicalPathOf）, B（resolver 兼容）,
                            GATE-1 / GATE-2 放宽（AC-1 已点名授权）
                            tests B, N2, N6
  AC-2 mutation complete  → A（writeKind 分类）
                            tests F1, F2, F3, F4
  AC-3 absent spelling    → E（枚举器拼写）
                            tests D, E, N3
  AC-4 bounded traversal  → C（廉价 fail-closed）, D（预算 D1–D4）
                            tests F, G, H, N1, N4, N5

N3 归属澄清（V2 把它映射给 AC-3，V3 修正）:
  N3 针对边界项 **C**（廉价 fail-closed 路径），
  但它保护的是 **AC-3 的 import 形状**不被 C 误吞
  ⇒ 主归属 AC-4（因为 C 是 AC-4 的修复手段），交叉引用 AC-3。
  两侧均须断言，**不得只测其一**。

Phase 文件清单（V3 修正；P2-4 的遗漏已补）:
  Phase 1/3 helper      : research-orchestration/test/helpers/t11-trust-surface-enumeration.mjs
                          （含 GATE-1 isWalkableTrustSetName L1703 / L1614 常量，
                            GATE-2 propertyWritePattern L1735，receiver-mutation L745）
  Phase 1/3 测试层       : research-orchestration/test/p2a-t11-trust-boundary-executable-guards.test.mjs
                          （含 classifyTrustSetValue L1083 / c3TrustSurfaceVerdict /
                            trustSetRootsOf / C3 共享 budget L810 / stripComments L1141）
  Phase 2 新套件         : research-orchestration/test/p2a-t11-131-remediation.test.mjs
  lib/                  : **零改动**
                          （锚点 8ac163e72134dad11bb83b2781b2952538c6dd9f 是
                            lib/targeted-requery-subphase.mjs **单文件**的 blob，
                            **不是 lib/ 目录**的 hash —— V2 措辞已精确化）
  ⚠️ 本清单**未授权**改 resolveTrustSetProvenance 的导出签名（helper L602）
```

---

## PART 7 — DEPENDENCY DECISION

```text
ACORN_DECISION = REJECTED（deferred，非永久否决）
TYPE = devDependency（若未来接受）—— **绝不** runtime dependency
```

**理由（三重，按优先级）**

1. **CI 不可解析（硬 blocker）**
```text
ci.yml `test` job                     → 只 npm ci zhihu-answer-grabber
ci.yml `research-classification` job  → **无任何 install 步骤**
run-classified-research-suites.mjs   → 无 npm 调用（requires.npmInstall 现为 NONE）
master suite-classification.json      → **无 t11 条目**（r11 分支有 1 条，full-offline）
research-orchestration/package-lock.json → 81 包，无 acorn 条目
实测：node -e "require('acorn')" → MODULE_NOT_FOUND（未被任何已安装树提供）
⇒ devDependency 在 CI 上不会被安装 → 套件 ERR_MODULE_NOT_FOUND 或静默 NOT_RUN
   （**SKIP ≠ PASS**）
```

2. **当前修复无需 parser**
```text
AC-1 路径身份   → lexical / 现有 splitMemberAccess 已足够（§2.2 已证 AST 无增量）
AC-2 变异覆盖   → writeKind 分类，不需语法树
AC-3 拼写归一   → s4/s5 纯 regex；s2/s3 属枚举器内部 alias 近似（实测，非 parser 任务）
AC-4 有界遍历   → 预算与键维度，与 parser 无关
```

3. **parser 不能解决 semantic gate 问题**
```text
parser 提供的是 SYNTAX FACTS，不是 SEMANTIC VERDICT。
- alias 传播（s2/s3）是数据流问题 → parser 结构上不提供
- 计算键（holder[k]）运行时才定 → parser 只能标记「不可静态判定」
- 跨模块/跨函数 provenance → 现有 call-graph budget 正为此存在，parser 不替代
实测对照（acorn 8.18.0，同一 fixture）:
  member-writes 输出与 regex 同构，仅 `state.inner.__trusted` 多给一级路径；
  对 `const b = assertArtifactSafe; b(...)` 输出 []（alias 仍不解决）
⇒ parser 修不了 semantic gate，只是把同一事实换个来源说
```

**重新评估的触发条件（三者须同时满足）**
```text
1. 对抗语料证明 L1 词法拼写枚举**不稳定**（不是「可以更简洁」）
2. ci.yml **同时**新增 research-orchestration 的 install 步骤
3. suite-classification.json + package-lock.json 同步更新
且即便如此，acorn 输出**仅并回 IR**（L1），**永不**持有 L2 判定权。
```

---

## PART 8 — 分阶段实施与回滚

| Phase | 范围 | 预计文件 | 回滚策略 |
|---|---|---|---|
| **0** 计划修正 | **本文件（V3）**；V1 与 V2 保留不改 | `docs/planning/P2A_T11_131_REMEDIATION_PLAN_V3.md` | 文本 revert |
| **0.5** 独立评审 | fresh independent review（CODE + SECURITY，同 exact SHA） | 无代码 | 未通过 ⇒ 追加 errata 或产出 V4，**不得**进入 Phase 1 |
| **1** 最小原型 | canonicalPathOf + canonicalKey + 廉价 blind-spot；**先测 §5.3 不等式 (1)**，再定 N | 仅 `test/helpers/t11-trust-surface-enumeration.mjs` | 分支未合入 → `git branch -D`，零可达性损失 |
| **2** 测试 | 钉死 fixture 的 A–H **与 F1–F4**；M7 真实文件；预算耗尽断言 | 新增 `test/p2a-t11-131-remediation.test.mjs` | revert commit；r11 32 测试逐条不动 |
| **3** 集成 | IR 接入 resolveTrustSetProvenance / classifyTrustSetValue / memberWritePathsIn | 同 Phase 1 helper + 测试层 | revert；**`lib/targeted-requery-subphase.mjs` blob 须保持 `8ac163e7` == r10** |
| **4** 安全评审 | CODE_REVIEWER + SECURITY_REVIEWER，同 exact SHA | 无代码 | 分支保持 unmerged |

**分支纪律**
```text
#131 remediation = NEW WORK（独立分支；不在 r11 分支上施工）
BASE_FOR_IMPLEMENTATION = r11 2934956（append-only；禁止 amend/rebase/squash）
INTEGRATION_AUTHORIZATION = NONE
IMPLEMENTATION_AUTHORIZATION = NONE
```

### Scope creep 防线（明确不在本票内）

```text
- 任何 lib/ 改动
- r11 fast path 的语义重写
- 删除或改名现有 14 个导出
- full AST rewrite / 引入 parser / type checker / linter
- P2 类形状（Object.assign / Reflect.set / defineProperty / ??= / 模板计算键）
  若要**修复** → 各自独立成票；本票仅要求它们 fail closed，不要求检出
- TypeScript / Babel / 跨文件分析项目化
- 顺便修复任何未授权问题
```

---

## PART 9 — 残余风险

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 预算数值过小 → 截断合法但深的 walk → 假阴性（fail-open） | P1 | 数值先在 42 模块真实语料上测「合法 walk 最大体读取数」再定；截断带原因可审计；**须同时满足 §5.3 两个不等式** |
| R2 | 路径键改变截断串分布 → 可能丢失真实盲点 | P1 | Phase 2 加对照：修复后 unresolvable 集合必须是修复前的**超集** |
| R3 | 廉价 blind-spot 误吞 import 名 → 漏真实跨模块 trust | P1 | 过滤须先排除 isLibRelativeImport 名；Phase 2 加 import 对照 fixture（N3） |
| R4 | 实现者照 V1 的错误 fixture（混入一级写）→ 得到 false positive 而非检出 | P1 | PART 6-E 已钉死 B「仅含 dotted 写」；变异 N6 |
| R5 | RAW / STRIPPED 数字再次被混用 | P2 | PART 3.1 已显式标注输入类型 + 真实 stripComments 口径；CI 报告附输入类型 |
| R6 | **本文件（V3）未经独立评审** | P1 | **Phase 1 前必须 fresh independent review**；未通过不得进入 implementation |
| R7 | V1 / V2 仍在仓库中被误读为有效契约 | P1 | 本文件首部已声明 SUPERSEDES V1 与 V2；实现期引用 V1/V2 即视为契约漂移 |
| R8 | **AC-4.1 的 5 000 ms 是先验值，无经验支撑**（修复前生产路径不终止，无参照系） | P1 | AC-4.1 以「跑完 + EXIT=0」为首要判据；若超时 ⇒ 报告实测值 + 归因，**不得放宽门限** |
| R9 | **§5.3 可行窗口可能为空**（(1) 与 (2) 无交集） | P0 | Phase 1 出口条件必须先测 (1)；若无交集 ⇒ 不得放宽门限，须回 PART 2 重设计（DEFECT-C 优先） |
| R10 | AC-3 的 10 形状 / 4 个 ABSENT **未**用独立 fixture 复验（V2 P2-6 残余风险） | P2 | 实现期重测；AC-3 已是 AC 之一，两侧（N3 交叉引用）均须断言 |

---

## APPENDIX C — 本轮机械核验（DESIGN ONLY；repo 零改动）

> ⚠️ **V3 读前必读**：本附录继承自 V2，其**部分数字已被 V2 自身的 APPENDIX D 撤回**
> （根因：手写 `stripComments` 有损 + `budget` 参数未测 + 从未走真实 C3 路径）。
> 下方每条标注 **[WITHDRAWN]** 者**不得**在实现期或评审中引用。
> 有效证据只有 PART 3.2 的**生产路径不终止**（EXIT=137）与其对照。

**核验环境**：`/tmp/t11-redesign`（仓库只读副本）；`resolveTrustSetProvenance` 直接调用，helper 未改。

```text
[E1] 增长曲线：M7 副本 n=1..4 → 恒 293 expr / 1 895 unres
     ⇒ 非组合爆炸；是该文件上的固有限度          [口径受限：helper 直调]
[E2] RHS 形状无关：pool.__trusted = pool（最小 RHS）仍同量级
     ⇒ 成本不在 RHS                              [口径受限：helper 直调]
[E3] 全文件正则单次扫描 = 0.25 ms ⇒ 非解析成本
[E4] [WITHDRAWN — D.5] 42 279 names / ~110.7 次
     作废：分母来源不可追溯
[E5] [WITHDRAWN — D.5] body-route 模型 10.8 s / 误差 1.1×
     作废：实际算得 14.6 s，对 11.5 s 误差 1.27×，且分母（3.6 s）已被 D.1 推翻
[E6] [WITHDRAWN — D.1] 生产路径 3 517–3 652 ms / 266 / 374
     作废：非生产路径；生产路径实测为**不终止**（EXIT=137，见 PART 3.2）
[E7] [WITHDRAWN — D.6] path 键 230 < 名键 253 ⇒ 不增工作量
     作废：比较口径未标注 + canonicalKey 定义自相矛盾（见 §5.2）
[E8] 截断串占 374 unres 中的 262，且 262 个 receiver **互不相同**
     ⇒ DEFECT-A 放大在截断路径上体现              [口径受限：依赖 E6 的输入]
[E9] [WITHDRAWN — D.5] 31 blind × 1 064 × 0.0325 ms ≈ 1.1 s（~31%）
     作废：占比归因不可追溯；机制成立但**占比未知**
[E10] splitMemberAccess 已支持任意深度（§2.2 的直接证伪）★ 仍然有效
[E11] acorn 8.18.0：解析 46 KB = 10 ms；member-writes 与 regex 同构；
     对 alias 调用输出 [] ⇒ 不解决 semantic gate  ★ 仍然有效（支持 PART 7）
```

**V1 结论的处置（append-only）**

```text
V1 @ da2a1a6 保留为历史记录，**不修改**。
其被本文件取代的结论：
  PART 2 基线数字        → 由 PART 3 取代（口径必须标输入类型）
  PART 4-A 依赖 acorn     → 由 PART 7 取代（REJECTED）
  PART 5 AC-1 证据        → 由 PART 4 AC-1 取代（需 fixture 前置条件）
  PART 5 AC-2「未复现」处置 → 作废（会关闭真实 silent fail-open）
  PART 4-C 单点 termination → 由 PART 5 四维度取代
  「AST 取任意深度成员链」修法 → 作废（能力已存在，照做假 GREEN）
```

**SHA 绑定**

```text
DESIGN_AUTHORITY 报告路径（隔离区，非仓库）:
  /Users/songshiyao/WorkBuddy/Quarantine/zhihu-grabber-t11-20261002/
    T11_REMEDIATION_ARCHITECTURE_REDESIGN_REPORT.md
SHA-256（交付时）: 见提交说明
本文件自身的 SHA: 由 git commit 产出；评审须针对该 exact commit SHA
```

---

## APPENDIX D — 独立评审 REJECT 的处置（append-only；不修改上方任何已提交内容）

```text
APPENDIX_D_APPENDED_AT = 07b11db755e1adab3c333b5b70350dfa950a9219（被评审的那一版，保持不变）
REVIEWED_EXACT_SHA     = 07b11db755e1adab3c333b5b70350dfa950a9219
REVIEWER               = fresh independent reviewer（deepseek-v4.1-flash）
MODEL_REQUESTED        = deepseek-v4.1-flash
MODEL_ACTUAL           = deepseek-v4.1-flash
FALLBACK_USED          = NO
VERDICT_BEFORE         = REJECT（OPEN_P0 = 2 / OPEN_P1 = 3 / OPEN_P2 = 7）
```

本附录**不修改**上方正文。被评审的 exact SHA 是 `07b11db7`；上方任何数字与措辞**保持原样**。
以下每条都经**本方独立复跑**确认，其中 **D.1 是本方探针的缺陷，已实测推翻自评 V2 结论**。

### D.0 —— 处置结论

```text
VERDICT_AFTER = MODIFY（仍不通过 implementation gate）
IMPLEMENTATION_AUTHORIZATION = NONE

已确认成立并保留：V2 的方向（证伪成立 / path identity / bounded traversal / acorn 拒绝）
已推翻并须重写：V2 PART 3 的全部基线数字、AC-2 的覆盖表、E4/E5 算术、D2 论证
```

### D.1 —— P0-1【已实测推翻自评 V2】：基线数字错，根因是本方探针的两个缺陷

评审报告 V2 的基线「不可复现」。**该批评成立**，且根因比评审所述更严重 ——
**是本方探针有 bug，不是数字精度问题**。两个缺陷：

**缺陷 1：`stripComments` 复刻错误（有损 vs 长度保持）**

```text
V2 探针用的是手写字符扫描器 ⇒ 46 042 → 32 728 chars（有损，丢 28.9%）
真实实现（test L1141-1145）= 两条 regex replace，注释→空格 ⇒ **长度保持**
  raw.length      = 46 042
  stripped.length = 46 042   ← 不变！
  非空白字符        : 37 097 → 18 045（移除 19 052 字符的注释文本）
⇒ V2 一切「stripped 更短」的推论前提不成立；RAW 与 STRIPPED 的差别是
   **注释文本的存在**，不是长度。
```

**缺陷 2：`budget` 参数是决定性的，而本方从未测它**

```text
同一 M7 变异，唯一变量 = 是否传共享 budget：

  RAW   + appended, budget=YES → 12 053–12 739 ms / 293 expr / 1895 unres  (5/5 稳定)
  RAW   + appended, budget=NO  → 35 492–36 781 ms / 298 expr / 6410 unres  (2/2 稳定)
  STRIP + appended, budget=YES →  4 647–5 110 ms / 266 expr /  374 unres  (5/5 稳定)
  STRIP + inserted, budget=YES →  4 583–4 817 ms / 266 expr /  374 unres  (5/5 稳定)
  control root=trusted         →        5 ms / 2 expr / 0 unres
```

**更关键：本方测的根本不是生产路径。**
真实 C3 在 test L811 上方声明 `const budget = { visited: new Set() }`
并**共享**给每个 member/identifier 路由。本方探针每次传**新** budget，
因此**不能**用来推断 C3 的行为 —— 这正是 V1 §B.6 已经写下的
「不得用直接 helper 调用替代 C3 路径取证」这条纪律的**第三次复发**。

**决定性实验：真实 r11 套件 + M7 变异（在完整 worktree 上，非 /tmp 抽树）**

```text
M7 施加于 lib/targeted-requery-subphase.mjs（临时，事后已还原）
→ node --test test/p2a-t11-trust-boundary-executable-guards.test.mjs
→ timeout 600 ⇒ EXIT=137 (SIGTERM)
→ 无任何 TAP summary ⇒ 套件未跑完
⇒ #131 P0「不终止」在生产路径上确实成立（这是 P0 的直接证据）

恢复验证：lib/ diff = 0 行；blob 8ac163e72134dad11bb83b2781b2952538c6dd9f == HEAD
          r11 复跑 32 tests / 32 pass / 0 fail
```

**对照实验（假红，必须记录以免复发）**

```text
cp -R research-orchestration /tmp/… ⇒ 套件 209 ms 即失败
  ERR_MODULE_NOT_FOUND: /tmp/…/zhihu-answer-grabber/src/markdown-security.js
  被 lib/rrf.mjs 跨包 import 触发
⇒ 这不是 #131 的证据，只是缺兄弟包。归因必须用完整 worktree。
```

**D.1 处置**：**PART 3 的全部数字作废**（包括 V2 §3.2 的 3 517–3 652 ms 与
§3.4 的「1.37× 余量」）。**新基线只有一个已证事实**：

```text
PRODUCTION PATH (真实 C3, 真实 r11 套件, M7 变异) = 不终止，600 s 内未完成
helper 直调数字（293/1895、266/374 等）= 仅作**实现期回归参照**，
  **不得**作为验收门限的依据，也不得推断 C3 行为。
```

**因此 AC-4.1 的门限必须整体重写**（见 D.2）。
V2 §3.4「V1 的 <5s 等于允许 8 倍回归」这一对 V1 的批评**撤回**：
在生产路径不终止的前提下，V1 与 V2 的时间数字**都**不构成有效验收口径。

### D.2 —— P0-1 续：AC-4 门限必须由「终止性」改为「终止性 + 上界」双条件

```text
原 V2 AC-4.1：M7 on STRIPPED → < 5 000 ms
  作废理由：不存在「修复前 4.6 s」这个参照系（生产路径根本不终止）

新 AC-4 形态（须实现期与评审共同确认）：
  AC-4.1 终止性（首要）：真实 r11 套件 + M7 变异必须在 < 5 000 ms 内
         产出完整 TAP summary（# tests / # pass / # fail），EXIT=0。
         判据是「跑完」，不是「跑得快」。
  AC-4.2 截断可审计：任何预算/深度截断必须产生显式 unresolvable + 原因，
         禁止空 expressions（fail-open）。
  AC-4.3 全量有界：42 个 lib/*.mjs 的 full-offline 枚举 + C3 全部有界终止。
  AC-4.4 性能上界（次要，仅作回归护栏，非门限）：
         修复后 M7 helper 直调 ≤ 5 000 ms（当前参照 4 647–5 110 ms）。
         ⇒ 该护栏**只有 ~0% 余量**，故必须先测实现后的稳定带再定，
         不得直接沿用 5 000。
```

**诚实声明**：AC-4.1 的 5 000 ms 同样是**先验设定**，本轮无法给出
「修复后应该多快」的经验值（本轮无实现）。它的作用是
**给实现一个可证伪的靶子**，而非承诺该数字可达。
若实现后仍 > 5 000 ms，正确处置是**报告实测值 + 归因**，不得放宽门限。

### D.3 —— P0-2：AC-2 的覆盖表错误，一级成员 `.add()` 也是 silent fail-open

V2 §4 AC-2 写「V1 `holder.trusted + .add(rawQuery)` → DETECTED（12 violations）」。
**该表项经评审实测为错误，已作废**：

```text
真实 C3 路径实测（r11 HEAD 2934956）:
  holder.trusted = new Set(plan.queryVariants)
    + holder.trusted.add(targetedPools[0].rawQuery)     → violations=0, unresolvable=0  ← 漏检
  换 .delete                                              → 0/0
  换参数拼写（rawQuery / proposals[0].queryText）           → 0/0
  mutation 放在 write 之前                                → 0/0
  仅当写入的 RHS 本身含 targeted 词                        → 18 violations / 7 unres
    且**加不加 .add() 结果完全相同**（18/7）
⇒ V2 的「12 violations」来自 RHS，不来自 .add()。
⇒ r11 套件中**没有任何**断言成员 `.add()` 被检出的测试
   （现有 .add() 用例全是裸变量，见 test :1173 / :1249 / :1271）。
```

**机制**：`bindingsOf` 的 receiver-mutation 规则是 `\bNAME\s*\.\s*ident\s*\(`（helper L745），
对 `holder.trusted.add(` **不匹配**（`trusted` 后面跟的是 `.add(` 而非 `(`）；
而 `propertyWriteBindingsOf`（helper L1824+）只处理 `R.x = RHS`，**不含 `.add()`**。
故成员级 mutation **结构性未覆盖**。

**D.3 处置**：

```text
1. 作废 V2 §4 AC-2 的「已被覆盖的形状」表项。
2. AC-2 的必测 fixture 扩展为【全部四个，无一例外】：
     F1  holder.trusted        = RHS  + holder.trusted.add(x)      期望 DETECTED
     F2  state.inner.trusted   = RHS  + state.inner.trusted.add(x) 期望 DETECTED（非 0/0）
     F3  holder[k]             = RHS  + holder[k].add(x)           期望 unresolvable（fail closed）
     F4  holder.trusted        = RHS（内联，无 .add）              期望 DETECTED（已成立，作对照）
   全部必须**逐字钉死源码**，禁止语义描述（V2 §4 已对 AC-1 提出此要求，
   但 AC-2 自身未做到 —— 这是 V2 的内部不一致）。
3. AC-2 的失败方向显式化：F1/F2/F4 漏检 = P0；F3 判 CLEAN = P0。
```

### D.4 —— P1-1：AC-1 必须**点名**授权修改两处既有谓词

评审指出 V2 §6-B「fast path 语义不变」会被实现者读作**禁止**放宽，
而那恰是 AC-1 必须做的。**该冲突成立**。两处真正的门：

```text
GATE-1  isWalkableTrustSetName → SINGLE_SEGMENT_FORM (helper L1614)
       只接受「裸标识符 + 至多一级属性」；a.b.c 不满足 → 归为 __expr__
GATE-2  propertyWritePattern 的单接收者锚 (helper L1745)
       (?<![.\w$])([A-Za-z_$][\w$]*)  ⇒ 任何 .X.__trusted = 恒不匹配
```

**D.4 处置**：

```text
1. AC-1 显式授权修改 GATE-1 与 GATE-2（**仅此两处**，其余谓词不得动）。
2. 消除与 §6-B 的字面冲突：§6-B「fast path 语义不变」精确定义为
   「单段 receiver（a.b）的判定结果不变」；多段 receiver 属**新增**覆盖，
   不在「不变」范围内。
3. 新增**噪声对照断言**（r10 P1-2 回归面）：放宽后
   coverage-final-integration.mjs:461 的 `Array.isArray(plan.queryVariants)`
   不得新增 unresolvable —— 即放宽只对**确有属性写**的多段路径生效。
```

### D.5 —— P1-2：E4 / E5 算术不自洽，已重算

```text
V2 E4（:120/:549）错误：42 279 ÷ 1 894 = 22.3，V2 写「~110.7 次」
  ⇒ 110.7 需要分母 ≈ 382。V2 未给出该分母来源。
V2 E5（:550）错误：147 × 3 054 × 0.0325 ms = 14 590 ms ≈ 14.6 s，
  V2 写「10.8 s，误差 1.1×」；实际相对 11.5 s 误差 1.27×。
V2 §3.3（:176）31 × 1 064 × 0.0325 ≈ 1.1 s 内部自洽，
  但其分母（3.6 s）已被 D.1 推翻 ⇒ 「DEFECT-C 是生产路径主因」失去依据。
```

**D.5 处置**：上述三处数字**全部作废**，不得在实现期引用。
保留**定性**结论（已由 D.1 的生产路径实验独立支持）：

```text
保留：DEFECT-A（放大）存在 —— 生产路径不终止是它的后果；
保留：DEFECT-B（路径坍缩）存在 —— splitMemberAccess 已任意深度，
      而 isWalkableTrustSetName 拒绝之（P1-1 已复现）；
保留：DEFECT-C（昂贵 fail-closed）存在 —— 机制上成立，
      但**占比未知**，不得再写「~31%」。
删除：一切百分比归因。
```

### D.6 —— P1-3：D2 的论证与其机制自相矛盾

```text
V2 §5.2（:326/:332/:554）称「path 键 230 < 名键 253 ⇒ 不增加工作量」。
问题：
  (a) D2 把键改为 canonicalKey = ${root}@${file}:${line}（:198/:329），
      这是**严格更细**的键，按定义只会减少去重、增加条目；
  (b) 「230 < 253」这一比较的**输入与作用域未标注** ——
      正是 V2 自己 R5 警告的「RAW/STRIPPED 混用」陷阱；
  (c) canonicalKey 含 file:line，但 resolveTrustSetProvenance(source, rootVar, {...})
      (helper L602) 内部**拿不到 file**，加 @file:line 须改签名或穿参，
      V2 未提及；
  (d) 「seen 按裸名去重」只对**裸名分支**成立；成员分支已用
      member:${receiver}.${member}（helper L831）⇒ D2 的「新工作」描述不准确。
```

**D.6 处置**：

```text
1. 撤回「path 键 < name 键 ⇒ 不增加工作量」这一论证（比较口径不可追溯）。
2. 如仍要用该论证，必须**同输入、同作用域、显式标注**后重测，并接受
   「更细的键可能增加工作量」这一结论 —— 此时 D3/D4 才是补偿手段。
3. canonicalKey 的定义**降级**为 `${root}@${depth}`（不需要 file:line，
   避免改签名）；若实现期认为 file:line 必需，则须在 Phase 1 明确
   签名变更，并把它列入 scope（当前 scope 未授权改 resolveTrustSetProvenance 签名）。
4. 精确定义 D2 的「新工作」= **裸名分支**的键从 name 改为 canonical path；
   成员分支已具备路径粒度，不在 D2 范围内。
```

### D.7 —— P2：7 项逐条处置

| # | 评审指出 | 处置 |
|---|---|---|
| P2-1 | N3 映射错：N3 是边界项 C（廉价 blind-spot），表里却映射给 AC-3；AC↔边界表把 C 归 AC-4 | **已修**：AC↔边界映射表见 D.8 |
| P2-2 | fixture 命名不一致：`state.inner.__trusted` vs `state.inner.trusted` | **已修**：统一为 `state.inner.trusted`（F2），`__trusted` 仅用于 M7 变异形状 |
| P2-3 | 标签冲突：AC-2 用 V1/V2/V3/V4，与文档版本 V1/V2 同名 | **已修**：AC-2 形状重命名为 F1–F4（见 D.3） |
| P2-4 | Phase 3 列出 `classifyTrustSetValue`，但它在**测试文件**（test :1083），而 Phase 1/3 文件清单只列 helper | **已修**：见 D.8 的文件清单 |
| P2-5 | `8ac163e7` 只是 `lib/targeted-requery-subphase.mjs` **单文件**的 blob，不是 `lib/` 目录 | **已修**：措辞已在本附录 D.1 精确化；Phase 3 回滚条件保留单文件表述 |
| P2-6 | AC-3 的 10 形状 / 4 个 ABSENT 未被独立复验 | **接受为残余风险**：本方已用真实枚举器复测（trusted=6 / ABSENT=4 = s2,s3,s4,s5），但**未**用评审的独立 fixture；实现期须重测（AC-3 已是 AC 之一） |
| P2-7 | D3/D4 未写耦合约束 | **已修**：见 D.9 |

### D.8 —— P2-1 / P2-4 修正后的 AC ↔ 边界映射与文件清单

```text
AC ↔ 边界映射（修正 N3 归属）:
  AC-1 path identity      → A（IR/canonicalPathOf）, B（resolver 兼容）, GATE-1/GATE-2 放宽
                            tests B, N2, N6
  AC-2 mutation complete  → A（writeKind 分类）
                            tests F1, F2, F3, F4
  AC-3 absent spelling    → E（枚举器拼写）
                            tests D, E, N3
  AC-4 bounded traversal  → C（廉价 fail-closed）, D（预算 D1–D4）
                            tests F, G, H, N1, N4, N5

  N3（廉价 blind-spot 误吞 import 名）归属澄清：
    N3 针对边界项 **C**（廉价 fail-closed 路径），
    但它保护的是 **AC-3 的 import 形状**不被 C 误吞 ⇒ 主归属 AC-4，
    交叉引用 AC-3。两侧均须断言，不得只测其一。

Phase 文件清单（修正 P2-4）:
  Phase 1/3 helper      : research-orchestration/test/helpers/t11-trust-surface-enumeration.mjs
                          （含 GATE-1 isWalkableTrustSetName / GATE-2 propertyWritePattern）
  Phase 1/3 测试层       : research-orchestration/test/p2a-t11-trust-boundary-executable-guards.test.mjs
                          （含 classifyTrustSetValue / c3TrustSurfaceVerdict / trustSetRootsOf）
  Phase 2 新套件         : research-orchestration/test/p2a-t11-131-remediation.test.mjs
  lib/                  : **零改动**（blob 8ac163e7… 为单文件锚点，非目录）
  ⚠️ 本清单**未授权**改 resolveTrustSetProvenance 的导出签名（见 D.6.3）
```

### D.9 —— P2-7：D3 / D4 的耦合约束（新增，V2 缺失）

```text
预算 N 必须同时满足两个不等式：

  (1) N  ≥  合法 walk 的最大函数体读取数
        否则截断**合法**的深路径 → 假阴性 → fail-open（P1 级）
  (2) N × 单次体读取成本  ≤  AC-4.1 门限
        否则门限不可达

本轮已测的单次体读取成本（生产路径口径，STRIPPED + budget=YES）:
  M7 helper 直调 = 4 647 – 5 110 ms
  control        =        5 ms
  ⇒ 二者相差约 1 000×，而「合法 walk 的最大体读取数」**未知**
     （因生产路径不终止，无法在修复前测出该值）

⇒ 结论：**可行窗口可能很窄，甚至为空**。这不是可以推迟的细节，
   而是 AC-4 的**核心可行性风险**。处置：
  1. Phase 1 必须**先测** (1) 的值（在 42 模块真实语料上跑未变异的 C3，
     记录最大体读取数），再定 N；
  2. 若 (1) 与 (2) 无交集 ⇒ 不得靠放宽门限解决，须回到 PART 2 重新设计
     （候选：把 DEFECT-C 的廉价 blind-spot 路径作为**先决条件**，
     先把体读取数降下来，再谈预算 N）；
  3. 该可行性检查须作为 Phase 1 的**出口条件**，写进 Phase 2 的前置。
```

### D.10 —— 修正后仍须由 fresh reviewer 复审

```text
本附录处置了 5 个 P0/P1 中的全部条目，但：
  - D.1 推翻了 V2 PART 3 的全部数字 ⇒ 上方正文 §3 已是历史文本，
    **必须**按 D.1 / D.2 重写后再评审，不可只审附录；
  - D.2 的 AC-4.1 门限是先验值，无经验支撑（D.2 已如实声明）；
  - P2-6（AC-3 独立复验）作为残余风险带入实现期。

⇒ NEXT_ACTION = 产出 V3（重写 §3 与 §4-AC-4，纳入 D.1–D.10），
   再提交 fresh independent review。
   在 V3 通过独立评审前，IMPLEMENTATION_AUTHORIZATION 恒为 NONE。
```

---

## APPENDIX D（继承自 V2）— 独立评审 REJECT 的处置（历史；结论已并入 V3 正文）

> **V3 中本附录的处置**：V2 的 APPENDIX D 是对 V2 exact SHA `07b11db` 的
> append-only errata。V3 **已把其中 D.1–D.10 的处置结论写进正文**：
> D.1→PART 3、D.2→AC-4、D.3→AC-2 F1–F4、D.4→AC-1 GATE 授权、
> D.5→PART 2.4 + APPENDIX C 标注、D.6→§5.2、D.7/D.8→PART 6 映射与清单、
> D.9→§5.3、D.10→本附录 E。
> 下方文本**逐字保留 V2 的 errata 原文**（append-only），未作修改；
> 其中的"V3 应产出"等未来时表述**以本文件 V3 的实际内容为准**。


---

## APPENDIX E — V3 修订映射与评审 gate

### E.1 owner 约束（本轮修订的边界）

```text
V3 把 V2 的 REJECT 作为**输入**，**不重写架构**。
只修复三类东西：
  (a) 证据契约 —— 基线数字口径、测量方法、已证/未证的边界
  (b) 符号       —— 行号引用、函数名、fixture 命名、canonicalKey 定义
  (c) 验收准则   —— AC 门限与失败方向

**未改动**（刻意保留，避免借修文档之名改架构）:
  - PART 1 的 P0-1 … P0-5 五条架构命题
  - PART 2.2 的机械证伪（splitMemberAccess 已任意深度）
  - PART 2.3 的 CORRECTED 命题
  - PART 2.4 的 DEFECT-A / B / C 三缺陷的存在性（仅撤数字与百分比）
  - AC-1 / AC-2 / AC-3 的目标与形状集（仅改证据与 fixture 定义）
  - PART 7 的 ACORN_DECISION = REJECTED
  - PART 6 的 14 个导出不得删改、r11 32 测试逐条不动、lib/ 零改动
```

### E.2 逐条修订映射（V2 APPENDIX D 的 D.1–D.10 → V3 位置）

| errata | 评审问题 | V3 处置位置 | 修订要点 |
|---|---|---|---|
| D.1 | P0-1 基线不可复现（探针两缺陷） | **PART 3 整节重写** | 只保留「生产路径不终止（EXIT=137）」为已证事实；helper 直调数字降级为回归参照；撤回 V2 全部时间数字 |
| D.2 | P0-1 AC-4 门限无参照系 | **AC-4.1–AC-4.5 + §5.5** | 门从毫秒数改为「终止性 + 有界性」；ms 降级为 AC-4.5 护栏且明标先验 |
| D.3 | P0-2 一级成员 `.add()` 也是 silent fail-open | **AC-2 全节重写** | 作废 V2 覆盖表；F1–F4 四个 fixture 钉死；失败方向显式化（F1/F2/F4 漏检 = P0，F3 判 CLEAN = P0） |
| D.4 | P1-1 AC-1 未点名授权改两处门 | **AC-1「GATE-1/GATE-2 点名授权」+ PART 6-B** | 显式授权仅 isWalkableTrustSetName(L1703) 与 propertyWritePattern(L1745)；「fast path 不变」精确化为「单段 receiver 不变」 |
| D.5 | P1-2 E4/E5 算术不自洽 | **PART 2.4 + APPENDIX C 标注 [WITHDRAWN]** | 撤回百分比/倍数归因；保留三缺陷存在性 |
| D.6 | P1-3 D2 论证自相矛盾 | **§5.2 重写 + AC-1 canonicalKey 降级** | 撤回「path 键 < name 键」；canonicalKey = `${root}@${depth}`（去 file:line，避免改签名）；D2 范围收窄到裸名分支 |
| D.7 | P2-1..P2-7 七项 | **PART 6 映射表 + AC-2 命名 + PART 6 文件清单 + PART 9 R10** | 全部处置；P2-6 转为残余风险 R10 |
| D.8 | P2-1/P2-4 映射与清单 | **PART 6「AC ↔ 边界映射」+ 文件清单** | N3 主归属改为 AC-4（交叉引用 AC-3）；清单补测试层 |
| D.9 | P2-7 D3/D4 无耦合约束 | **§5.3 新增** | 显式两个不等式；可行窗口可能为空 → 列为 R9（P0）；Phase 1 出口条件必须先测 (1) |
| D.10 | 要求产出 V3 | **本 APPENDIX E** | 即本文件 |

### E.3 V3 自引入的新缺陷风险（诚实声明）

```text
1. §5.2 把 canonicalKey 降级为 ${root}@${depth} 后，AC-1 的 INV-2
   （receiverPath 不同的两条 IR ⇒ key 必须不同）在同深度同根时会**不成立**。
   V3 已修正 INV-2 的判据为「以 receiverPath 为唯一性依据，key 仅作去重键」，
   但这**削弱**了 key 的唯一性保证 —— 若评审认为不可接受，
   唯一出路是 Phase 1 申请改 resolveTrustSetProvenance 签名以引入 file:line。
   本文件不隐藏这个代价。

2. AC-4.1 的 5 000 ms 是**先验值**，无经验支撑（修复前不终止 ⇒ 无参照系）。
   已列为 R8。若实现后超时，处置是「报告实测 + 归因」，**不得放宽门限**。

3. AC-2 的 F1（holder.trusted.add）当前实测 0/0。若修复后 F1 仍 0/0，
   说明「成员级 mutation 纳入 provenance」需要改 bindingsOf 的 receiver-mutation
   规则（helper L745），而该文件**不在** AC-1 的授权面（GATE-1/GATE-2）内
   ⇒ 实现期可能需要追加授权。本文件提前暴露该缺口，不预先授权。

4. PART 3.2 的「不终止」证据来自 M7 变异。变异本身是否等价于真实攻击面，
   属 #131 的定义问题（本票未裁定）。若评审认为 M7 不代表真实路径，
   则 P0 证据需重新构造 —— 这会**影响整票的存废**，必须由 owner 裁定。
```

### E.4 独立评审 gate（V3 生效条件）

```text
IMPLEMENTATION_AUTHORIZATION = NONE（V3 不改变这一点）

进入 Phase 1 的**全部**前置条件:
  1. fresh independent review 覆盖 V3 的 exact commit SHA（非 V2、非 07b11db）
  2. Quorum = CODE_REVIEWER + SECURITY_REVIEWER，同 exact SHA，优先异模型
  3. OPEN_P0_P1 = 0
  4. E.3 的 4 条风险已被 reviewer 明确接受或要求修订
  5. owner 对 E.3.4（M7 是否代表真实路径）的裁定已记录

模型优先级: DeepSeek V4.1 Flash → GLM 5.3 → DeepSeek V4 Pro
  （fallback 仅限 MODEL_UNAVAILABLE / RATE_LIMIT / QUOTA / TOOL_FAILURE /
    CONTEXT_CREATION_FAILURE；reviewer 给 findings **不是**换模型理由）

每 review 留 receipt:
  MODEL_REQUESTED / MODEL_ACTUAL / FALLBACK_USED / FALLBACK_REASON /
  REVIEWED_EXACT_SHA / VERDICT / OPEN_P0_P1 / OPEN_P2
```

```text
VERDICT_OF_V3_AUTHOR = 未评审（等待 fresh independent reviewer）
IMPLEMENTATION_AUTHORIZATION = NONE
NEXT_ACTION = 对 V3 的 exact commit SHA 启动 fresh independent review
```
