# P2A-T11 / #131 — Remediation Implementation Plan（V6）

```text
DOC_ID            = P2A_T11_131_REMEDIATION_PLAN_V6
TYPE              = IMPLEMENTATION_PLAN（设计稿；不含实现）
TICKET            = #131（P0，独立票）
TICKET_STATUS     = OPEN（#131 尚未关闭）
SUPERSEDES        = docs/planning/P2A_T11_131_REMEDIATION_PLAN_V5.md
                    @ b8b3e92143ad6d8822977f3567f29a602bd0890b（**历史保留，不修改**）
                    （V5 被 fresh independent reviewer 评 MODIFY：
                      OPEN_P0 = 0 / OPEN_P1 = 1 / OPEN_P2 = 2；
                      该评审的唯一 OPEN_P1 = **F3 取证路径错误**（helper-direct
                      被当作 production evidence），已在 V6 重做；
                      2 条 P2 已在 V6 修）
LINEAGE           = V1 @ da2a1a6 → V2 @ 07b11db（+errata @ 55cc01e）
                              → V3 @ 4dfeca6（REJECT）→ V4 @ 7e27b3b（MODIFY）
                              → V5 @ b8b3e92（MODIFY）→ **V6 = 本文件**
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
V5_REVIEW_VERDICT          = MODIFY（OPEN_P0 = 0 / OPEN_P1 = 1 / OPEN_P2 = 2）
ARCHITECTURE               = UNCHANGED_FROM_V2（path identity + bounded traversal；
                              V6 仍不重写架构，只修 F3 取证契约 / 授权面表述 / 行号锚点）
AUTHORIZATION_SURFACE      = A1 + A2' + A3（与 V5 相同；V6 **不新增授权点**，
                              A4 / A5 仍删除）
```

> 本文件**不授予实现授权**。V1 / V2 / V3 / V4 / V5 保留为历史记录（append-only 纪律：已评审内容不得静默改写）。
> V6 是**当前实施契约**，与 V1–V5 冲突处**以 V6 为准**；V5 及其之前的版本仅作历史追溯，不读例外。
> 权威顺序不变：`RULES.md` > Applicable Approved Specs > `docs/architecture/key-decisions.md` > 本文件。
>
> **V6 的修订范围（owner 明确约束，2026-10-02）**：V6 只修 V5 评审的**唯一 OPEN_P1**
> 与 **2 条 P2**，**不重写架构**、**不新增授权点**（仍为 A1 + A2' + A3）：
> **（a）F3 取证契约**（F3 必须按**真实 C3 路径**取证；helper-direct 结果
> **不得**作为 production evidence）、**（b）F3 当前真实行为与 post-fix 终态**
> （钉死；computed receiver **不得** silent CLEAN，必须 DETECTED 或 FAIL_CLOSED）、
> **（c）A2' 表述**（「必然不可共存」降为授权声明）、**（d）行号锚点**（L1869 → L1871）。
> 架构命题 P0-1…P0-5、PART 2 的 DEFECT-A/B/C、AC-1/AC-2/AC-3 的目标与形状集、
> AC-4.1a/AC-4.1b 的拆分**均不变**。授权面、AC 严格度、14 个导出、r11 32 测试、
> `lib/` 零改动、ACORN_DECISION = REJECTED 全部不变。
>
> ⚠️ **V6 的核心诚实性修正（必须先读）**：V5 把 F3 的「当前值」写成
> expressions 含 `targetedPools[0].rawQuery`、unresolvable = `[k, plan, targetedPools]`，
> V6 已证明那是 **helper 直调**（把 `holder[k]` 直接当 root 传入）的产物，
> **不是生产 C3 路径的行为**。真实 C3 路径上 F3 当前是
> **`violations = []` 且 `unresolvable = []`（silent CLEAN / fail-open）** ——
> 这比 V5 声称的更严重，V6 已按真实值重钉（见 PART 3.4 与 AC-2 F3）。
>
> **owner 对 P0-1 的裁决（2026-10-02）**：选择**扩授权面**，且授权扩展必须
> **最小、显式、可枚举** —— 仅覆盖 AC-2/F1/F2 已机械证明必须触及的位置；
> **不得**以「顺便统一」为理由重构整个 analyzer；**不新增** AST/parser；
> **不改变** r11 既有 fast path 语义。V4 必须逐条列出新增授权点及**为什么每一个都是必要的**。
> **reviewer 再发现缺口时，不得通过降低 AC 等级来换 PASS。**
>
> **owner 对 P0-2 的裁决（2026-10-02）**：按原验收标准修，**不降级、不拆票**，
> 除非出现新的架构级冲突。AC-4.1 必须拆为 AC-4.1a / AC-4.1b，并把
> **fixture 语义 / expected verdict / exit expectation** 三者分别钉死。
> **TERMINATES ≠ PASSES** —— 终止性与安全判定是两个独立验收维度。

---

## PART 0 — FRESH TRUTH（2026-10-02）

> ⚠️ 下方第一块是 **V5 轮**的 fresh truth，逐字保留（append-only）。
> **V6 轮**的最新 fresh truth 见紧随其后的「V6 轮复验」块 —— 冲突处以 V6 块为准。

```text
［V5 轮复验］
git ls-remote origin refs/heads/master                                       = 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
git ls-remote origin refs/heads/work/p2a-t11-trust-boundary-executable-guards  = 293495626d993137f2691f99df4dce2cb156762b
git ls-remote origin refs/heads/docs/p2a-t11-131-remediation-plan            = 7e27b3bc2af3f1683faa9d027c29bbee9cde561b（V4）
main worktree = master @ 2afe106，clean（porcelain 0 / untracked 0）
docs worktree = docs/p2a-t11-131-remediation-plan @ 7e27b3b，clean（V5 产出前）
r11 套件      = 32 tests / 32 pass / 0 fail（本轮未重跑；见 §0.1）
r11 lib blob  = 8ac163e72134dad11bb83b2781b2952538c6dd9f
r10 → r11 diff -- research-orchestration/lib/ = EMPTY（0 行）

★ V5 轮**新**增两项机械实测（用于 P2-1 计数口径钉死）:
  trusted callsite 数 = **5**（enumerateAssertArtifactSafeCallSurface(LIB_DIR).trusted.length）
  unparsed  数 = **0**
  lib/*.mjs 模块数   = **42**（扫描语料规模；≠ 被断言的 callsite 数）
  逐条 callsite 清单见 §4.A「计数口径」。
```

```text
［V6 轮复验］（2026-10-02）
git ls-remote origin refs/heads/master                                       = 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
git ls-remote origin refs/heads/work/p2a-t11-trust-boundary-executable-guards  = 293495626d993137f2691f99df4dce2cb156762b
git ls-remote origin refs/heads/docs/p2a-t11-131-remediation-plan            = b8b3e92143ad6d8822977f3567f29a602bd0890b（V5）
r11 worktree HEAD == 293495626d993137f2691f99df4dce2cb156762b（frozen，未变）
r11 lib blob == 8ac163e72134dad11bb83b2781b2952538c6dd9f（未变）
r11 套件 SHA256 = 2ba32b57cbceb043fbd04bf42bc84ad933b1a71b93606c6acce003567dec4bae（未变）
helper  SHA256 = 57ef8797e5eaf40ebc0c818b3831cb5ff171c6f1703b59b0ee8dcf6ccb070ef0（未变）
lib/ diff vs worktree HEAD = EMPTY（0 行）
★ V6 轮**新**增：真实 C3 路径取证（取代 V5 的 helper-direct 证据）；
  实测结论 F1/F2/F3 当前**全部 silent CLEAN（V=[] U=[]）**；模拟 A1 放宽后
  F3 → DETECTED（V=4），冻结套件仍 32/32 全绿、负向对照 0/0。
  完整方法与数据见 **§3.5**。
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

## PART 3 — BASELINE EVIDENCE（V3 重写，V4/V5 沿用：V2 数字已由其 APPENDIX D 全部撤回）

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

V4 的措辞（与 AC-4.1a 统一，消除 V3 的自相矛盾）:
  · **安全判定**（AC-4.1b）**不含任何时间门** —— 它只判定「检出 / 未检出」。
  · **终止性**（AC-4.1a）含一个**先验**时间上界 5 000 ms，
    但它的判据是「产出完整 TAP summary」（能结束），**不是**「跑得够快」。
    即：5 000 ms 是「不得 hang」的工程上界，**不是**性能门限。
  · 因此本节与 AC-4.1a **不再矛盾**：本节说「不给性能门限」，
    AC-4.1a 给的是「防挂起的上界」，两者不是同一类断言。
  · AC-4.5（性能护栏）**不给毫秒数**，由 Phase 1 实测后写回（见 PART 4 AC-4.5）。
```

### 3.5 ★ V6 新增：F3 的**真实 C3 路径**取证（取代 V5 的 helper-direct 证据）

> **本节是 V6 的核心修正。** V5 评审的唯一 OPEN_P1 指出：V5 记录的 F3「当前值」
> 来自 **helper 直调**（把 `holder[k]` 直接当 root 传给 `resolveTrustSetProvenance`），
> 而生产 C3 路径**永远不会**这样调用。V6 在 r11 HEAD `2934956` 上按真实 C3 路径重取证。

**取证方法（可复现；不修改 r11）**

```text
方法: 把 research-orchestration/ 原样镜像到 /tmp（含同级 zhihu-answer-grabber 与
      corpus-anthology，使相对 import 可解析），镜像文件与冻结源 SHA256 逐字节相同：
        helper  57ef8797e5eaf40ebc0c818b3831cb5ff171c6f1703b59b0ee8dcf6ccb070ef0
        suite   2ba32b57cbceb043fbd04bf42bc84ad933b1a71b93606c6acce003567dec4bae
      然后在镜像里**追加**一个探针 test（原函数不改、不删、不替换），
      直接调用**真实的** c3TrustSurfaceVerdict / trustSetRootsOf / classifyTrustSetValue。
      冻结仓库零改动（镜像用完即弃）。
```

**F1 / F2 / F3 在真实 C3 路径上的当前行为（V6 实测，未变异）**

```text
fixture（函数作用域，callText = assertArtifactSafe(pool, { trustedPlanStrings: <root> })）:

  形状            classifyTrustSetValue(root)      trustSetRootsOf   C3 verdict
  ─────────────────────────────────────────────────────────────────────────────
  F1  holder.trusted        "holder.trusted"          ["holder.trusted"]        V=[] U=[]
  F2  state.inner.trusted   "__expr__state.inner…"    ["__expr__state.inner…"]  V=[] U=[]
  F3  holder[k]             "__expr__holder[k]"       ["__expr__holder[k]"]     V=[] U=[]
                                            ⚠️ V=[] 且 U=[] ⇒ **silent CLEAN**

判定（机械，无歧义）:
  · F1 当前也是 silent CLEAN —— 与 V5/V4 一致（缺陷成立，AC-2 F1 的负向对照有效）。
  · F3 当前是 **silent CLEAN**，**不是** V5 声称的「unresolvable=[k,plan,targetedPools]」。
    ⇒ V5 的 F3「当前值」是 helper-direct 假象；真实缺陷比 V5 描述的**更严重**
      （不是「分类待定」，而是**完全未被检出**）。
```

**F3 的 silent CLEAN 机制（逐步机械确认）**

```text
  holder[k]
    → classifyTrustSetValue(value)          test L1083
        return isWalkableTrustSetName(value) ? value : `__expr__${value}`;
    → isWalkableTrustSetName("holder[k]")   helper L1703 → SINGLE_SEGMENT_FORM
        实测 = **false**（计算键不是「名字」）
    ⇒ classifyTrustSetValue 返回 **"__expr__holder[k]"**
    → trustSetRootsOf 产出 root = "__expr__holder[k]"   （实测）
    → c3TrustSurfaceVerdict 走 __expr__ 分支（test L961-966）:
        if (!classifyTrustSetValue(root).startsWith('__expr__')) { …walk… continue; }
        followInto(root, root);            ← 只把 root 本身当**文本**测试
    ⇒ **从不调用 bindingsOf**，从不解析 holder[k] 的写侧，`.add(` 的参数永不可见
    ⇒ violations=[] 且 unresolvable=[] ⇒ **silent CLEAN（fail-open，P0 级）**

  旁证（真实 C3 路径的对照实验，均 V6 实测）:
    · holder 未定义（更盲的局部变量）同样 V=[] U=[] ⇒ 该分支**不会**因缺绑定而报错。
    · inline 表达式 root（含 targeted 文本）**会**被检出：
        root = new Set(targetedPools[0].rawQuery) ⇒ V=2（含 targetedPools）
      ⇒ 证明 C3 的文本分支本身有效；F3 漏检的**根因是分类把它判成表达式**，
        不是文本分支不工作。
```

**post-fix 可达性证明（在 A1 + A2' + A3 内，无新增授权点）**

```text
实验（仅在 /tmp 镜像上做「模拟 A1 放宽」，冻结仓库零改动）:
  把 isWalkableTrustSetName 的返回改为「SINGLE_SEGMENT_FORM 命中 **或** 计算键 a[b] 命中」
  —— 这**正是 A1 授权范围内的放宽**（A1 = 放宽「什么算 walkable 名字」的判定点）。

  结果:
    ① 冻结套件 **32 tests / 32 pass / 0 fail**（约 1.59 s）
       ⇒ A1 的放宽**不回归**既有 32 项，**不制造**新的 blind spot
       （这是 r9「18 个假 blind spot」回归风险已被挡住的机械证据）。
    ② F3（holder[k]）在该模拟下变为 **DETECTED**：V=4
       —— targetedPools[0].rawQuery 与 targetedPools 进入了 expressions。
    ③ 负向对照（benign plan-only trust set）仍 V=0 U=0
       ⇒ 无假阳性。
    ④ F1（holder.trusted，含 .add()）与 F2（state.inner.trusted，含 .add()）
       在**仅**放宽 A1 时**仍为 silent CLEAN**
       ⇒ 它们分别依赖 A3（member 路由 mutation）与 A1+A2'（多段 + 写侧匹配），
         这与 §4.A 的三点必要性证明一致（互不替代），且说明三点缺一不可。

  ⇒ 结论: **F3 的 post-fix 契约在 A1 + A2' + A3 内即可达成**，
    computed receiver **不必** silent CLEAN，
    **无需**新授权点、**无需**另开 ticket（本条为「不得静默降级」的机械依据）。
```

---

## PART 4 — ACCEPTANCE CRITERIA（V2 重写，AC 语义与 V1 不同）

> **AC 编号语义已变更** —— V1 的 AC-1/AC-2/AC-3 与 V2 不可混用。
> 实现期若引用旧编号即视为契约漂移。

### AC-1 — PATH-LEVEL IDENTITY（V6 沿用：授权面 = A1 + A2' + A3，不新增；canonicalKey 与 INV-2 精确定义）

```text
目标：
  信任匹配以完整 canonical path 进行，不得坍缩到 receiver。

规范表示（canonical path representation）:
  state.inner.__trusted          ← 必须保留完整 receiver 链
  不能坍缩为:
  state                          ← 这是 V1 时代的行为，构成 silent fail-open

必须定义并实现:
  canonicalPathOf(expr, source) → { receiverPath, property, … }，保留完整链
  构成（V4 逐项钉死，禁止实现期自行解释）:
    receiverPath : 完整 receiver 链的**规范化字符串**，**属性名不剥离**。
                   例: `state.inner` / `holder` / `pool`
                   多段以 `.` 连接；计算键写 `__computed__`（不猜测实际键）。
    property     : 最末段的属性名（`trusted` / `__trusted`）；裸名则为空串。
    root         = receiverPath 的**最左段**（`state.inner` → `state`；`holder` → `holder`）。
    depth        = **walk 递归深度**（根调用 = 0），不是段数、不是属性层数。

  canonicalKey —— 明确定义为**去重键**，用途**仅限** seen 集合:
    canonicalKey = `${root}@${depth}`
    · **不含** file:line：resolveTrustSetProvenance(source, rootVar, {…})
      （helper L602）内部**拿不到 file**；加 file:line 必须改导出签名，
      而当前 scope **未授权**改该签名。
    · **不含** receiverPath 的非首段、不含 property
      ⇒ 它**天然不是**唯一标识（V4 明确承认这一点，见 INV-2）。

  ⚠️ **P2-6 适用范围钉死（V5 新增）：canonicalKey 仅适用于「裸名」分支的 seen 去重**。
  canonicalKey **不是**通用的 IR 身份标识，也**不**适用于成员访问分支：
    · **裸名分支**（root 是裸标识符，如 `trusted` / `pool`）
      seen 键 = canonicalKey = `${root}@${depth}`。
      这是 D2 的改造对象，也是 D4（path budget）的计数对象（见 §5.3）。
    · **成员分支**（receiver 是路径，如 `holder.trusted` / `state.inner.trusted`）
      seen 键 = `member:${receiver}.${member}`（helper L831，**现状已足够**）。
      该分支**保持现状**，**不得**换成 canonicalKey、也**不计入** D2 / D4。
      成员分支的身份由该完整成员路径（receiver+member）承载，天然无坍缩问题。
  ⇒ AC-1 INV-2 的唯一性判据（`receiverPath + property` 二元组）对**两个分支**都成立，
    但 canonicalKey 只对裸名分支承担去重职责；两分支的 seen 键不可混用、不可互换。
  （本条仅**澄清适用范围**，不改 canonicalKey 的定义、不改 L831 现状、不新增授权点。）

硬不变量（纳入测试）:
  INV-1  canonicalPathOf(v) 保留完整链；
        若任何代码路径把它降级为 receiver ⇒ 抛错，**禁止静默**
  INV-2  **唯一性判据 = `receiverPath + property` 二元组**（V4 修正）：
        两条 IR 若该二元组不同 ⇒ 必须是两条独立记录，
        即使它们的 canonicalKey 相同（同根同深）。
        禁止因 canonicalKey 相同而把两条不同路径静默合并成一条。
        （V2/V3 的「canonicalKey 必须不同」在 V4 的键定义下**不可满足** ——
         canonicalKey 只含 root@depth，不含路径其余部分。
         故必须改判据：这不是放宽，而是把**不可满足的断言**
         改成**可机械验证的断言**。唯一性由 receiverPath+property 保证，
         canonicalKey 仅作去重启发式，两者是**不同**的职责。）
  INV-3  writeKind = unknown ⇒ 下游必须 unresolvable（fail closed），禁止 CLEAN
  INV-4  IR 的 confidence 只能是 syntax-structural | spelling-only；
        **禁止**出现 "resolved"（解析是 L2 职责，IR 不做判定）
```

### 4.A 授权面（V5 收敛为 A1 + A2' + A3；**V6 沿用，不新增授权点**）

V6 的 AC-1 授权面 = **三处（A1 + A2' + A3）**，全部在
`research-orchestration/test/helpers/t11-trust-surface-enumeration.mjs` 与
`research-orchestration/test/p2a-t11-trust-boundary-executable-guards.test.mjs` 之内。

**收敛来源（V4 评审处置，见 APPENDIX G）**：
V4 曾为 **A1–A5 五处**。V4 评审的两条 P1 证明其中两处不成立：
- **P1-1（A4 非必要）**：F3 当前已由裸名路由既有的 receiver-mutation 规则覆盖
  ⚠️ **V6 修正**：上面这条依据中的「F3 已由裸名路由的 receiver-mutation 规则覆盖」
  是 **helper 直调假象**（把 `holder[k]` 直接当 root 传入）。真实 C3 路径上
  F3 当前是 **silent CLEAN**（V=[] U=[]），因为它被分类为 `__expr__holder[k]`
  而**从不进 bindingsOf**（完整机制与实测见 §3.5）。
  ⇒ **A4 删除的结论仍然成立，但依据已换**（见下方「A4 删除的 V6 依据」）。
- **P1-2（A2 与 A5 不能同时成立）**：`propertyWritePattern` 是**单一共享工厂**
  （helper L1735-1748），被 `memberWritePathsIn`（L1813）与 `propertyWriteBindingsOf`
  （L1868）**共用**；helper L1713-1730 的冻结注释**禁止拷贝第二份写规则**。
  V5 曾把这点写成代码层面的「**必然**不可共存」—— V6 修正为**授权声明**：
  > 本授权面规定：对该共享工厂的放宽**无条件适用于其全部消费者**
  > （`memberWritePathsIn` + `propertyWriteBindingsOf`），且**禁止**新增第二份写规则。
  > 这是一条**授权约束**（实现者不得只改一边、不得分叉规则），
  > **不是**「单一工厂在结构上无法只驱动一个消费者」的强断言 ——
  > 后者并非事实（给工厂加一个参数即可只驱动一侧），故 V6 撤回该强断言。
- **A4 删除的 V6 依据（替代上面的 helper-direct 依据）**:
  A4 作用于 `bindingsOf` 的 receiver-mutation 规则（helper L745）。
  V6 机械证明：**在 A1 + A2' + A3 三点全部落实后，F3 即为 DETECTED（V=4），
  且 L745 全程未被改动**（§3.5 实测：模拟 A1 放宽 + 未触碰 L745）。
  ⇒ F3 的修复**不需要**改动 L745 ⇒ **A4 依然删除**，无需新授权点。
  ⇒ 且 A4 对 F1 净贡献为 0（F1 先命中 member 路由 A3，不走裸名 `bindingsOf`）。

**owner 约束（必须逐条满足）**：最小、显式、可枚举；**不得**以「顺便统一」为理由
重构整个 analyzer；**不新增** AST/parser；**不改变** r11 既有 fast path 语义。

#### 授权点 A1 — GATE-1 `isWalkableTrustSetName` / `SINGLE_SEGMENT_FORM`（helper L1703 / L1614）

```text
必要性（F2 + F3 机械证据）:
  (a) F2: 实测 isWalkableTrustSetName('state.inner.trusted') = false
      ⇒ F2 在分类阶段即被降为 __expr__，后续一切 provenance 逻辑都不执行。
      这是 F2 漏检的**第一道**闸门；不放开则 F2 永远不可达。
  (b) F3: 实测 isWalkableTrustSetName('holder[k]') = false
      ⇒ classifyTrustSetValue → "__expr__holder[k]" → C3 走 text-only 分支
      ⇒ **F3 当前 silent CLEAN**（V=[] U=[]，P0 级 fail-open，见 §3.5）。
      不放开则计算键永远不被解析，AC-2 的 F3 契约**无法达成**。
为什么是这一处而不是别处:
  它是「什么名字算 walkable 路径」的唯一判定点；
  splitMemberAccess（L1658）已支持任意深度（§2.2 已证），无需改动。
授权范围: 放宽「接受多段成员链」**以及**「接受计算键 receiver（形如 holder[k]）」。
          ⚠️ V5 曾写「不得改变对计算键的判定，计算键必须仍被判为不可静态判定」，
          **该限制已被 V6 撤回**：真实取证表明正是这道判定把 F3 变成 silent CLEAN；
          保留它就等于保留一个 P0 级 fail-open。
          计算键进入 walk 后，其不可静态判定性由 **AC-2 的 F3 post-fix 契约**
          （DETECTED 或 FAIL_CLOSED，**不得** silent CLEAN）承载，
          **不依赖**分类阶段的拒绝。
不得改动: SINGLE_SEGMENT_FORM 的既有拼写集合（. / ?. / ['x'] / ?.['x']）；
          r11 既有 fast path 语义（放宽后冻结套件必须仍 32/32 —— V6 已实测）。
```

#### 授权点 A2' — GATE-2 `propertyWritePattern` 共享工厂的接收者放宽（helper L1735-1748，消费者 L1813 / L1868）

```text
必要性（F2 机械证据 + 单一共享工厂事实）:
  现状 propertyWritePattern 是**单一工厂**（L1735-1748），单接收者锚
  `(?<![.\w$])([A-Za-z_$][\w$]*)`（L1745），被两个消费者共用：
    · memberWritePathsIn        L1813  `if (!propertyWritePattern(split.member).test(source)) continue;`
    · propertyWriteBindingsOf   L1868  `const assign = propertyWritePattern(name);`
                                L1871  `if (receiver === name) continue;`
      （⚠️ V6 行号修正：V4/V5 曾把 `if (receiver === name) continue;` 写成 L1869；
         r11 HEAD 2934956 实测在 **L1871** —— L1869 是 `for (let m = assign.exec(source); …)`。）
  ⇒ 任何 `.X.__trusted =` / `.X.Y.trusted =` 恒不匹配（两消费者皆 false）。
    不放开则写侧完全看不见多段路径的赋值，F2 仍漏检。
授权声明（V6 修正措辞，**不作强结构断言**）:
  本授权面**规定**：对 `propertyWritePattern` 这一共享工厂的放宽
  **无条件适用于其全部消费者**（`memberWritePathsIn` L1813 +
  `propertyWriteBindingsOf` L1868），并**禁止**为其新增第二份写规则
  （helper L1713-1730 冻结注释）。
  ⚠️ 这是**授权约束**，**不是**「单一工厂在结构上无法只驱动一个消费者」的代码事实
  —— V4/V5 曾用「必然不可共存」表述，属过强断言（给工厂加参数即可只驱动一侧），
  **V6 已撤回该强断言**；保留的是「必须两边一起改、不得分叉」的授权纪律。
授权范围: 仅放宽**该共享工厂**的接收者锚，使其可含多段成员链；
          分隔符的四种既有拼写（. / ?. / ['x'] / ?.['x']，见 L1836-1841 注释）不得改动。
          其**计算键处理**（L1848 注释「裸计算键刻意不算 member 写」）**不得改动**
          —— 改它会破坏 AC-2 的 F3 fail-closed 要求。
对照断言（★ 防假阳性，V5 新增；回应「为什么 V1 的 AC-1 不成立」）:
  ⚠️ 调用签名（V5 实测钉死，**实现者须按此调用，否则断言无效**）:
     memberWritePathsIn(source, expr) —— **两个参数**：
       source = 被扫描的源码文本；expr = 待检查的表达式（其中的 member path 才是对象）。
     （V4 及更早曾按单参数 `memberWritePathsIn(dotted)` 书写，属**错误签名**；
       V5 已据 r11 HEAD 2934956 的真实定义 L1800 纠正。）

  V5 基线实测（r11 HEAD 2934956，未变异，helper 直调口径）:
      memberWritePathsIn("state.inner.trusted = x;", "state.inner.trusted")  = []
        ← **当前缺口**：fixture 仅含 dotted 写时返回空
      memberWritePathsIn("state.inner.trusted = x; state.trusted = y;",
                         "state.inner.trusted")                                = ["state.inner.trusted"]
        ← 来自混入的一级写的**误报**，**不是**检出（V4 已指出，V5 复核确认）
      memberWritePathsIn("const a = b.c;", "b.c")                              = []
        ← 纯读不产生 member 写（既有语义，放宽后**必须保持**）
      memberWritePathsIn("state.trusted = x;", "state.trusted")                = ["state.trusted"]
        ← 一级单写 = r11 既有 fast path（放宽后**必须保持**）
      memberWritePathsIn(<真实 lib/targeted-requery-subphase.mjs>, "pool.__trusted") = []
        ← 真实生产文件当前全空

  ⇒ post-fix 期望（Phase 2 **必须**逐条断言）:
      ① dotted-only（source "state.inner.trusted = x;" / expr "state.inner.trusted"）
         ⇒ **必须命中**该 dotted 路径，且返回值集合**恰为** ["state.inner.trusted"]
           —— **不得**多出任何非预期条目（防假阳性）。
      ② 纯读（"const a = b.c;"）⇒ 仍为 []（放宽不得把纯读误判为 member 写）。
      ③ 一级单写（"state.trusted = x;"）⇒ 仍为 ["state.trusted"]
         （r11 既有 fast path 语义不变 —— 这是「不改变 r11 fast path」的机械落点）。
      ④ 真实生产文件 ⇒ 放宽后**不得**新增非预期 member 写路径（与对照 1–3 联动）。
  ⇒ 该对照与 PART 6-E 的 FX-B（「仅含 dotted 写」）共用同一 fixture。
  ⇒ **A2' 的对称义务**：既然放宽共享工厂会**同时**改变 memberWritePathsIn 与
     propertyWriteBindingsOf，则**两个**消费者的 post-fix 行为都必须被断言；
     只断言其一 ⇒ 授权面的一半未被验收（视为 AC-1 失败）。
```

#### 授权点 A3 — member 路由的 mutation 接入点（helper L824-843）★ V4 新增，V5 保留

```text
必要性（F1/F2 机械证据 —— 这是结构性根因，不是「顺带修」）:
  实测 member 路由（L824-843）只做两件事:
      (1) propertyWriteBindingsOf(source, member)  ← 只处理 R.x = RHS
      (2) walk(receiver, depth+1)                  ← 沿 receiver 递归
  它**从无任何 mutation 规则** ⇒ `holder.trusted.add(x)` 的参数
  永远不会进入 expressions。
  实测 F1 fixture：expressions = ["holder.trusted = new Set(plan.queryVariants)",
                                  "const holder = {};","holder"]
                                —— `.add(targetedPools[0].rawQuery)` 的参数完全缺席。
  实测 GATE-1 对 F1 贡献为 0：isWalkableTrustSetName('holder.trusted') 已 = true。
  实测 A2' 对 F1 贡献为 0：propertyWritePattern 是赋值模式
                                `...=(?!=)([^;]+);`，结构性无法匹配 `.add(`。
  ⇒ 结论：**只改 A1 / A2' 对 F1 的净贡献为 0**。
  ★ V6 复核：模拟「仅放宽 A1」后 F1 仍 silent CLEAN（§3.5 实测）
    —— 与「A3 是 F1 的唯一必要改动」一致。
授权范围: 在 member 路由内**新增**一条 mutation 接入（形如
          receiver.member.method(ARG) 的 ARG 纳入 expressions），
          不得删除或改写既有的 propertyWriteBindingsOf 调用与 walk(receiver) 递归。
          严禁借机把整个 member 路由重写。
```

#### 授权面三态证明（必要 / 非冗余 / 不可由另外两者单独替代 —— owner 要求逐项成立）

```text
A1（GATE-1 分类放行：多段链 + 计算键 receiver）:
  · 必要：F2（多段 state.inner.trusted）与 F3（计算键 holder[k]）都被 GATE-1
          判为 __expr__ ⇒ 后续 provenance 全不执行、C3 走 text-only 分支。
          GATE-1 不放开则 F2 不可达、F3 永远 silent CLEAN（§3.5 实测）。
  · 非冗余：A2'（写模式匹配）与 A3（mutation 接入）都运行在「已分类为 walkable」之后；
            GATE-1 拒绝的名字，A2'/A3 无从重新接纳。
  · 不可由 A2'/A3 替代：A2' 只改写侧匹配、A3 只改 member 路由 mutation，
            二者都不触及「名字是否算 walkable 路径」这一分类闸门。

A2'（共享写工厂放宽，同时影响 memberWritePathsIn + propertyWriteBindingsOf）:
  · 必要：写侧对 `.X.__trusted =` 结构性不匹配，A1 只放行分类、不改造写匹配，
           故 F2 的写侧漏检只能由放宽该工厂解决。
  · 非冗余：一处放宽即同时覆盖两个写消费者（L1813 + L1868），无第二处可省；
           且冻结注释禁止拷贝第二份写规则（P1-2）。
  · 不可由 A1/A3 替代：A1 不碰写模式；A3 只把 `.add(ARG)` 参数纳入 expressions，
           不改变 `R.x = RHS` 的赋值匹配（A3 不读 propertyWritePattern）。

A3（member 路由 mutation 接入）:
  · 必要：F1 的 `.add()` 参数永不进入 expressions（member 路由无 mutation 规则）；
           且 GATE-1 对 F1 贡献 0（holder.trusted 已 walkable）、A2' 对 F1 贡献 0
           （赋值模式不匹配 `.add(`）。
  · 非冗余：A1 只放行分类、A2' 只改写侧匹配，二者都不把 `.add(ARG)` 纳入 expressions。
  · 不可由 A1/A2' 替代：同「必要性」—— 只有新增 member 路由 mutation 接入能纳入该参数。

⇒ 三者构成**最小覆盖**：任一缺失 ⇒ F1 / F2 / F3 至少之一仍漏检或 silent CLEAN；
  任一可由另两者替代的假设均被上述机械证据否定。
  无第 4 处授权点（V4 的 A4/A5 已删除；A4 的 V6 依据见上，A5 由 A2' 吸收）。

★ V6 独立验证（模拟实验，冻结仓库零改动，详见 §3.5）:
  · 仅放宽 A1 ⇒ F3 由 silent CLEAN 变为 **DETECTED**（V=4），冻结套件仍 32/32 全绿。
  · 仅放宽 A1 ⇒ F1 / F2 **仍为 silent CLEAN**（F1 需 A3、F2 需 A1+A2'+A3）。
  ⇒ 实验与三态证明一致：三点互不替代，缺一不可。
```

#### 授权面小结（可机械核对）

```text
授权点  文件位置                          覆盖的 fixture   不改动的相邻语义
A1      helper L1614 / L1703             F2              计算键仍不可静态判定
A2'     helper L1735-1748（共享工厂）      F2              同时影响 L1813 + L1868；
       消费者 L1813 / L1868                               四种分隔符拼写不变；计算键「不算 member 写」不动
A3      helper L824-843（member 路由）    F1, F2          propertyWriteBindingsOf 调用 + walk(receiver) 不动

共同约束（owner 裁决）:
  · 3 个点均在上述两个文件内，**不得**触碰 research-orchestration/lib/**
  · **不得**新增 AST/parser（PART 7 ACORN_DECISION 不变）
  · **不得**改变 r11 既有 fast path 语义（「单段 receiver 判定结果不变」）
  · 放宽只对**确有属性写 / mutation**的多段路径生效（噪声对照见下）
  · 若实现发现还需要第 4 个点 ⇒ **必须回本文件追加授权并重审**，
    **禁止**在实现期默默扩权，也**禁止**用「顺便统一」重构代替授权
```

**噪声对照（放宽不得引入新噪声；r10 P1-2 与 r9 回归面）**

```text
对照 1  coverage-final-integration.mjs:461（5 个 trusted callsite 之一，见 P2-1）
        `Array.isArray(plan.queryVariants) ? plan.queryVariants : []`
        放宽后**不得**新增 unresolvable —— 即放宽只对确有属性写的多段路径生效。
对照 2  retrieval.mjs:800（5 个 trusted callsite 之一；V3 遗漏，reviewer P1-4 提出）
        helper 自身的冻结注释记载：在这带改谓词曾把 `validatePlanInput`
        整段函数体拖进 provenance，产生 **18 个假 blind spot**（r9 F.3 冻结行）。
        ⇒ 放宽后 retrieval.mjs:800 不得新增 unresolvable。必须设为具名对照。
对照 3  r11 全局 C3 / C3c 断言（test L563-574、L1786+）：
        C3 在 **5 个 trusted callsite** 处断言 violations === [] 且 unresolvable === []；
        C3 的**扫描语料**是 **42 个 lib/*.mjs 模块**（两者是不同计数，见 P2-1，不得混用）。
        ⇒ 放宽后 r11 必须 32/32 全绿，且这两项断言仍为 []。
        （V3 只说「32 测试逐条不改断言」= 不许改测试，
          **不等于**改完谓词后测试仍须绿 —— 这是两件事，V4 补上，V5 沿用。）
```

**计数口径（P2-1 钉死，两个数字是不同对象，严禁混用 —— V5 实测）**

```text
「5」= trusted callsite 数量（enumerateAssertArtifactSafeCallSurface(LIB_DIR).trusted.length）
     V5 在 r11 HEAD 2934956 机械实测 = **5**，unparsed = **0**。
     逐条（file:line + 调用文本，V5 实测输出）:
       1  coverage-final-integration.mjs:461
          assertArtifactSafe(accumulatedPool, { trustedPlanStrings: new Set(Array.isArray(plan.queryVariants) ? …) })
       2  coverage-state.mjs:519
          assertArtifactSafe(state, { trustedPlanStrings: new Set(ret.plannedQueryVariants) });
       3  retrieval.mjs:800
          assertArtifactSafe(pool, { trustedPlanStrings: new Set(validated.plan.queryVariants), })
       4  source-group-selection.mjs:1110
          assertArtifactSafe(plainDecision, { trustedPlanStrings });
       5  targeted-requery-subphase.mjs:898
          assertArtifactSafe(pool, { trustedPlanStrings: trusted });
     ⇒ C3 / C3c 的断言是**对这 5 个 callsite 逐一求 verdict 后**断言
       violations === [] 且 unresolvable === []（test L556-574 循环 + L563-574 断言）。
     ⇒ C3c 自身的注释亦印证「four of the **five** audited sites」（test L1786+）。

「42」= research-orchestration/lib/ 下的 .mjs 模块数（= C3 枚举器的**扫描语料**规模，
       即 enumerateAssertArtifactSafeCallSurface 遍历目录所看到的模块总量）。
     V5 实测 = **42**（`ls research-orchestration/lib/*.mjs | wc -l`）。
     ⇒ **42 是语料规模，不是被断言的 callsite 数**；两者相差悬殊（5 vs 42），
       因为绝大多数模块**不含** trust-set callsite。

⚠️ 纪律（V4 把二者混为一谈，是 P2-1 的根因）:
  · 凡写「C3 对全部 42 个 lib/ 模块断言 violations === []」= **错误表述**，禁止使用；
  · 正确表述 = 「C3 对 **5 个 trusted callsite** 求 verdict 并断言 violations/unresolvable 皆 []；
    枚举器在 **42 个 lib 模块**语料上扫描以发现这些 callsite」；
  · 引用该计数时必须标明取哪一种（口径），否则不可机械核对。
  · 对照 1（coverage-final-integration.mjs:461）与对照 2（retrieval.mjs:800）
    是**上述 5 个 callsite 中的 2 个**（编号 1 与 3），不得表述为「42 个模块之一」。
```

**为什么 V1 的 AC-1 不成立**：V1 写「`memberWritePathsIn(dotted)` = `[]` → 缺口确认」。
⚠️ V5 已据 r11 HEAD 2934956 的真实定义（L1800，**两参数** `memberWritePathsIn(source, expr)`）
复核：该结论**成立**，但 V1/V4 的书写省略了第二个参数 `expr`，属**签名书写错误**。
真正的缺口是：**fixture 仅含 dotted 写**时返回 `[]`；而一旦 fixture 内另有**一个一级**
`.trusted =` 写入，就返回非空 —— 而那是非空 **false positive**，不是检出：

```text
fixture（仅 dotted 写，生产形态）  memberWritePathsIn → []      ← 真正的缺口
fixture（一级 + dotted 混合）      memberWritePathsIn → ["state.inner.trusted"]
                                  ← 来自那个一级写入的误报，非检出
真实 lib/targeted-requery-subphase.mjs（46 042 chars）→ 全部 []
```

根因：`propertyWritePattern` 锚定**单裸标识符接收者**（`(?<![.\w$])([A-Za-z_$][\w$]*)`），
所以任何 `.X.__trusted =` 恒不匹配。**fixture 混入一级写会掩盖真实缺口**。
（逐条实测数值见 §4.A 授权点 A2' 的「V5 基线实测」块。）

### AC-2 — TRUST MUTATION COMPLETENESS（V3 重写，V4 补 F3 当前值：F1–F4 全部钉死）

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

**必测 fixture（F1–F4 全部，无一例外；必须逐字钉死源码，禁止语义描述）**

⚠️ **V6 取证纪律（owner 明令）**：所有 F1–F4 的「当前值」**必须**来自
**真实 C3 路径**（调用未改动的 `c3TrustSurfaceVerdict` + `trustSetRootsOf` +
`classifyTrustSetValue`，即 r11 套件本身的三个函数），
**禁止**引用 helper 直调（把某个字符串直接当 root 传给 `resolveTrustSetProvenance`）
的结果作为 production evidence —— 那种调用方式生产路径**从不采用**，
且其结论已被证明与生产行为**相反**（见 §3.5）。

**逐字钉死的 fixture 源码（F1–F4；函数作用域，禁止语义描述）**

```text
  F1_SRC =                                  F2_SRC =
    export function walk(plan, tp) {           export function walk(plan, tp) {
      const holder = {};                        const state = { inner: {} };
      holder.trusted = new Set(plan.queryVariants);
      state.inner.trusted = new Set(plan.queryVariants);
      holder.trusted.add(tp[0].rawQuery);       state.inner.trusted.add(tp[0].rawQuery);
      assertArtifactSafe(pool, {                assertArtifactSafe(pool, {
        trustedPlanStrings: holder.trusted });     trustedPlanStrings: state.inner.trusted });
    }                                           }

  F3_SRC =
    export function walk(plan, tp, k) {
      const holder = {};
      holder[k] = new Set(plan.queryVariants);
      holder[k].add(tp[0].rawQuery);
      assertArtifactSafe(pool, { trustedPlanStrings: holder[k] });
    }

  其中 tp = targetedPools（真实名，见 §4.A「计数口径」的 callsite #5）。
  callText = 从 `assertArtifactSafe` 起至该行第一个 `;` 止的原文。
```

```text
F1  root = holder.trusted        （dotted，单段 receiver + .add）
    期望 DETECTED（violations > 0）
    —— V6 真实 C3 路径实测当前 = **V=[] U=[]（silent CLEAN）**
       classify = "holder.trusted"（walkable → 走 member 路由）
    ⇒ 这是 silent fail-open，修复后必须 > 0。
    ⇒ 依赖 **A3**（member 路由 mutation 接入）：V6 模拟「仅放宽 A1」时 F1 仍 0/0。

F2  root = state.inner.trusted   （dotted，多段 receiver + .add）
    期望 DETECTED（violations > 0）
    —— V6 真实 C3 路径实测当前 = **V=[] U=[]（silent CLEAN）**
       classify = "__expr__state.inner.trusted"（多段被判表达式）
    ⇒ 依赖 **A1 + A2' + A3**（多段放行 + 写侧匹配 + mutation 接入）。

F3  root = holder[k]             ★ V6 重做（本条是 V6 的核心修正）
    期望 = **DETECTED 或 FAIL_CLOSED；不得 silent CLEAN**
    —— V6 真实 C3 路径实测当前 = **V=[] U=[]（silent CLEAN / fail-open，P0 级）**
       classify = "__expr__holder[k]" → __expr__ 分支只作文本测试
       → **从不进 bindingsOf**，`.add(` 的参数永不可见（完整机制见 §3.5）
    ⇒ ⚠️ V5 写的「当前 unresolvable=[k,plan,targetedPools]、expressions 含 rawQuery」
      是 **helper 直调假象**；据此写的「部分成立、分类待定」**已撤回**。
    ⇒ V6 的真实结论更强也更简单：**F3 当前完全未被检出**。

    ⚠️ **V6 post-fix 契约（钉死，不可再「待定」）**:
       post-fix F3 必须满足**二者之一**，且**必须**由 Phase 2 在**真实 C3 路径**上断言：
         (A) DETECTED    —— violations > 0（targeted 表面进入 expressions）；**或**
         (B) FAIL_CLOSED —— unresolvable 非空（把计算键记为 blind spot）
       **硬约束（owner 明令「不得静默降级」）**:
         · **不得** V=[] 且 U=[]（silent CLEAN）—— post-fix 出现即 AC-2 失败（P0）
         · **不得**为凑 DETECTED 而把 holder[k] 误判为命中（false positive，违反 INV-3）
         · 选 (A) 时：violations > 0，unresolvable 可为 0
         · 选 (B) 时：unresolvable 非空，violations 可为 0，但**必须**显式说明
                      为何该形状无法静态判定（计算键的值在运行时才确定）
       ⇒ **V6 已机械证明 (A) 在 A1 + A2' + A3 内可达**：模拟 A1 放宽后
          F3 变为 DETECTED（V=4），**冻结套件仍 32/32 全绿**、负向对照仍 0/0
          （完整证据见 §3.5「post-fix 可达性证明」）。
       ⇒ 因此**不需要**新增授权点、**不需要**另开 ticket。
       ⇒ 实现者若发现 A1+A2'+A3 不足以达成 (A) 或 (B) ⇒ **必须回本文件报告**，
          **禁止**自行扩权、**禁止**静默把 F3 降级为「已知残余风险」。

F4  root = holder.trusted，两条 RHS 并列（内联，无 .add）—— 正/负对照
    ⚠️ **P2-2 钉死具体 RHS 与 expected result（V5 引入，V6 沿用）**:
       · 正向（期望 DETECTED）：RHS = `new Set(targetedPools[0].rawQuery)`
         —— RHS 含 targeted 词，守卫应命中。
       · 负向（期望**不**检出，且**不得**误判为缺陷）：RHS = `new Set(plan.queryVariants)`
         且不含 targeted 词 ⇒ violations = 0 且 unresolvable = 0。
         这是「检测由内容驱动」的正确行为，**不是** silent fail-open；
         若实现把负向对照也报为 DETECTED ⇒ false positive，违反 INV-3/INV-4。
       · 两条 RHS 必须**同时**写入 Phase 2 的 F4 fixture 并分别断言，不得只取其一。
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

### AC-4 — BOUNDED TRAVERSAL（V4 修订：AC-4.1 拆为两个**独立**验收维度）

> **owner 裁决（2026-10-02）**：AC-4.1 必须拆为 **AC-4.1a TERMINATION** 与
> **AC-4.1b SECURITY DETECTION**。
> **TERMINATES ≠ PASSES** —— 终止性与安全判定是两个**独立**验收维度，
> 各自有独立的 fixture、独立的 expected verdict、独立的 exit expectation。
> 不得只改 EXIT 文案；不得以「为了终止性」把 violations / unresolved 清空来换 GREEN。

#### 先决事实（V4 实测，钉死 fixture 语义）

```text
r11 对**未变异**真实 lib/ 的断言（test L563-574，helper 直调复算一致）:
  violations === []   且   unresolved === []
  ⇒ 未变异状态：GREEN 是契约，EXIT=0 成立。

M7 变异的语义（owner 定义 = widening mutation）:
  pool.__trusted = new Set([...trusted, ...pool.map((p) => p.channels[0].query)]);
  其 RHS 含 pool.map / channels / query，而 TARGETED_SURFACE（test L605）
  明确包含 channels、query、pool 相关标识符
  ⇒ M7 **是一个真实的信任面 widening**，不是良性变异。
  ⇒ 守卫**应当**检出它。

历史证据（修复前）: M7 注入后 r11 套件 600 s 不终止（EXIT=137，无 TAP summary）。
  该挂起是 #131 P0 的直接证据。
```

#### AC-4.1a — TERMINATION（能结束；**不要求** widening mutation 通过）

```text
fixture 语义:     M7 widening 形状 + 同类高 fan-out 形状（multi-copy M7 ×1..4）
expected verdict: **不指定**。可能 GREEN（若该形状在本就无 targeted 表面）
                  也可能 RED（若检出）—— 两者都算通过 AC-4.1a。
exit expectation: **不指定**。必须非零退出**或**零退出，但**禁止**：
                  hang / timeout / SIGTERM / 无限 fan-out。
判据:             在有界时间内完成分析并产出**完整** TAP summary
                  （含 # tests / # pass / # fail 三个数字，缺一不算）。
                  有界 = ≤ 5 000 ms（先验值，见下方 P1-3 处置与 R8）。
为什么单独成条:   原 V3 的「EXIT=0」把终止性与安全判定绑在一起，
                  等于要求守卫对已知 widening 变绿 —— 那是 fail-open 的验收契约。
                  修复后 M7 应当 RED（见 AC-4.1b），与本条不冲突。
```

#### AC-4.1b — SECURITY DETECTION（真实 widening 必须被检出并 RED）

```text
fixture 语义:     真实含 TARGETED_SURFACE 的 M7 widening mutation
                  （即 M7 原样；其 RHS 命中 TARGETED_SURFACE，test L605）
expected verdict: **必须被检出**，即至少满足其一，且必须指名具体 test：
                  (i ) violations 非空（点名是哪一个 targeted surface 被命中）
                  (ii) unresolved 非空（点名是哪一个 blind spot）
                  —— 两者都不为 [] 时，**同时**记录两者。
exit expectation: **RED / non-zero**。若该变异使套件变绿 ⇒ AC-4.1b 失败。
禁止:             **不得**以「为了终止性」把 violations / unresolved 清空来换 GREEN。
                  任何此类清空都是 fail-open 实现，必须被 AC-4.1b 判失败。
与未变异的关系:   未变异真实 lib/ 仍须 violations === [] 且 unresolved === []
                  （r11 test L563-574 既有断言，逐条不改）。
                  ⇒ 「变异后 RED」与「未变异 GREEN」**必须同时成立**。
                  若实现后出现「变异后仍 GREEN」，那不是 bug，是守卫失能。
```

#### AC-4.1 的其余项（编号已统一，本节为唯一权威定义）

```text
AC-4.2  截断可审计：任何预算/深度截断必须产生显式 unresolvable + 原因；
        **禁止**返回空 expressions（fail-open）；**禁止**计入 call-untrusted。
AC-4.3  全量有界：**42 个 lib/*.mjs 的 full-offline 枚举**（= 扫描语料规模）
        + C3 全部有界终止。
        ⚠️ 口径（P2-1）：此处 42 = **语料模块数**，**不是**被断言的 callsite 数
           （后者 = 5 个 trusted callsite，见 §4.A「计数口径」）。两者不得混用。
AC-4.4  CI 全量跑不挂起（历史证据：M7 变异后套件 SIGTERM 137 / EXIT=137）。
AC-4.5  性能护栏（**非门限**）：修复后 helper 直调 M7 的稳定带须先测再定。
        ⚠️ V4 撤回 V3 的「≤ 5 000 ms（当前参照 4 647 – 5 110 ms，~0% 余量）」——
        该护栏与 AC-4.1a 的 5 000 ms 是同一数字却无语义关系，属契约漂移。
        V4 的处置：AC-4.5 只要求「记录实测稳定带 + 该带不随修复而劣化」，
        **不给具体毫秒数**。数值由 Phase 1 实测后写回本文件（追加 errata）。
```

#### 终止性 / 检测性的分离如何被机械验证（防「假终止」）

```text
T-N1  变异 fixture 被改成「永远 hang」          → AC-4.1a 失败（无 TAP summary）
T-N2  变异 fixture 被改成「快速返回空 violations/unresolved」
      ⇒ AC-4.1b 失败（检出被清空 = fail-open）
      这**必须**是一个独立的 mutation test，不能只靠 AC-4.1a 覆盖。
T-N3  未变异 fixture 被改成「返回非空 violations」
      ⇒ r11 既有断言失败（test L563-574），即回归保护网生效。
```

### AC 汇总（V5 更新：AC-2 的 F1/F2 依赖 A1 + A2' + A3 三点，缺一即漏检）

| AC | 目标 | 状态（V3 口径） | 阻塞性 |
|---|---|---|---|
| AC-1 | path-level identity | 缺口已机械确认（GATE-1/GATE-2 已点名） | P0 |
| AC-2 | mutation completeness | **silent fail-open 已确认**（F1 当前 0/0） | P0 |
| AC-3 | absent spelling | 4/10 形状 ABSENT 已确认（P2-6 残余风险） | P1 |
| AC-4 | bounded traversal | **生产路径不终止已确认**（EXIT=137） | **P0（#131 本体）** |

---

## PART 5 — TERMINATION MODEL（V3 重写，V4 修正单位：见 §5.3）

> 要求（owner）：**任何 fan-out 必须 bounded。**
> V1 只提「NAME 维度共享预算」，遗漏了路径键维度与 maxDepth 交互。

### 5.1 四个必须分别有界的维度

| # | 维度 | 当前状态 | 要求 |
|---|---|---|---|
| D1 | **maxDepth**（深度） | `maxDepth = 8`，已存在（helper L602） | 保留；截断 → `unresolvable`，fail closed |
| D2 | **seen key**（身份维度） | 裸名分支按**裸名**去重 → 路径坍缩 + 放大 | 裸名分支键改为 **canonicalKey**；成员分支已具备路径粒度（helper L831 `member:${receiver}.${member}`），**不在 D2 范围** |
| D3 | **NAME budget**（名称预算） | **不存在** | 新增：跨 `walk()` 共享，每 name 每次顶层 walk 至多解析一次 |
| D4 | **path budget**（路径预算） | **不存在** | 新增：单次 walk 内 canonicalKey 扩展数上限（机械约束见 §5.3 不等式 (3)(4)） |

### 5.2 D2 的论证：V2 的版本已撤回（V3 撤回，V4 补净效果说明）

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

### 5.3 D3 / D4 耦合约束（V2 缺失，V3 新增，V4 修正单位错置，V5 补 D4 不等式）

```text
D3（NAME 预算，单一 N）与 D4（path 预算，单一 P）是**两个独立预算**，
各自有独立的不等式，不得混淆。

— D3 / NAME budget（N）——
  (1) N  ≥  LEGAL_BODY_READS
        其中 LEGAL_BODY_READS = 一次合法 walk 中「函数体读取」的**最大次数**
        （在 42 模块真实语料上跑**未变异**的 C3 实测得到，不是估算）
        否则截断**合法**的深路径 ⇒ 假阴性 ⇒ fail-open（P1 级）

  (2) N × UNIT_COST  ≤  AC-4.1a 的时间上界
        其中 **UNIT_COST = 单次函数体读取的成本**，
        定义为**一次 `resolveCallReturnProvenance` 调用处理一个函数体的中位耗时**
        —— 单位 = ms/次。
        ⚠️ V3 在此处**单位错置**：它把「整次 `resolveTrustSetProvenance` 调用的
        总耗时」（4 647 – 5 110 ms，该调用内部本就包含**多次**体读取）
        当成「单次」体读取成本，代入 (2) 得 N ≤ 5 000 / 4 700 ≈ 1，
        与 (1)「N ≥ 合法 walk 最大体读取数」处处矛盾。
        ⇒ V3 由此推出的「可行窗口可能为空」**只是单位错置的产物**，已撤回。
        V4 的正确读法：UNIT_COST 是**远小于**整次调用耗时的量
        （整次调用 = 多次体读取的累积），故 (2) 通常比 V3 声称的宽松得多。

— D4 / path budget（P）★ V5 新增机械约束（P2-5）——
  D4 = 单次 walk 内 **canonicalKey 扩展数上限**（仅计数裸名分支 seen 键的新增，
       见 P2-6；成员分支走独立的 `member:${receiver}.${member}` 键，不计入 P）。
  (3) P  ≥  LEGAL_PATH_EXPANSIONS
        其中 LEGAL_PATH_EXPANSIONS = 一次合法 walk 中 canonicalKey 扩展
        （裸名分支 seen 键新增）的**最大次数**
        （在 42 模块真实语料上跑**未变异**的 C3 实测得到，不是估算）
        否则截断**合法**的深路径 ⇒ 假阴性 ⇒ fail-open（P1 级）
  (4) P × UNIT_PATH_COST  ≤  AC-4.1a 的时间上界
        其中 **UNIT_PATH_COST = 单次 canonicalKey 扩展的成本**（单位 ms/次）
        —— 实测量级应**远小于** UNIT_COST：canonicalKey 扩展是查表 +
          字符串拼接（`${root}@${depth}`），非函数体读取。
        ⇒ D4 的可行窗口通常比 D3 更宽松；若 D3 窗口存在，D4 几乎必然存在，
          但两者**都必须**实测，不得因 D3 成立而跳过 D4 测量（P2-5）。

⇒ V5 的可行性判定（可证伪；D3 与 D4 分别判定）:
  1. Phase 1 必须实测四个量并记录测量方法：
       LEGAL_BODY_READS（(1) 右项）   UNIT_COST（(2) 右项，ms/次）
       LEGAL_PATH_EXPANSIONS（(3) 右项）  UNIT_PATH_COST（(4) 右项，ms/次）
  2. D3 窗口存在 ⟺ LEGAL_BODY_READS × UNIT_COST ≤ AC-4.1a 时间上界。
     D4 窗口存在 ⟺ LEGAL_PATH_EXPANSIONS × UNIT_PATH_COST ≤ AC-4.1a 时间上界。
     两者都是**可判定的乘法**，不是「可能为空」的定性猜测。
  3. 任一乘法不成立 ⇒ 处置顺序（不得跳步）：
       (a) 先降对应成本（D3→UNIT_COST：DEFECT-C 廉价 fail-closed 路径，不读函数体；
           D4→UNIT_PATH_COST：优化 canonicalKey 查表/拼接）；
       (b) 再考虑调 AC-4.1a 的时间上界，且**必须**报告实测值 + 归因，不得静默放宽；
       (c) 仍不成立 ⇒ 回 PART 2 重设计（**架构级**，须 owner 裁定）。
  4. 该检查是 Phase 1 的**出口条件**，写进 Phase 2 的前置。
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

### 5.5 终止性机械验收（V4：编号已与 PART 4 统一；**本节不重复定义**）

```text
⚠️ AC-4.1a / AC-4.1b / AC-4.2 / AC-4.3 / AC-4.4 / AC-4.5 的**唯一权威定义在 PART 4**。
   V2 曾把 AC-4.x 定义在多处且互相矛盾（V3 未完全对齐），
   V4 统一为：PART 4 = 定义处；本节 = 交叉引用，不复述。

终止性的机械验收（引用 PART 4 的编号，不新增编号）:
  AC-4.1a  M7 与同类高 fan-out 形状 → 有界时间内产出完整 TAP summary；
           禁止 hang / timeout / SIGTERM；**不规定** exit code。
  AC-4.1b  真实含 TARGETED_SURFACE 的 M7 → 必须被检出（violations 或 unresolved 非空）
           且 RED / non-zero；**禁止**清空检出以换 GREEN。
  AC-4.2   每个预算/深度耗尽 → 显式 unresolvable + 原因；禁止空 expressions。
  AC-4.3   42 个 lib/*.mjs 全量 full-offline 枚举 + C3 全部有界终止。
  AC-4.4   CI 全量跑不挂起。
  AC-4.5   性能稳定带：Phase 1 实测后写回 PART 4（**当前不给毫秒数**）。
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
   - **14 个**（口径：**r11 测试实际从 helper 导入的** 14 个，test L68-83）
     现有导出**不得**删除或改名。
     （helper 文件本身有 **15 个** `export`，多出的是 `importOriginOf` @ L1900，
       r11 测试未导入它。V2/V3 只写「14 个」而未说明口径 —— V4 钉死。
       两个数字都不算错，但**必须**标明取哪一种，否则不可机械核对。）
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
   ⚠️ **V4 改名（修 P2-2）**：fixture 原用 A–H，与本节的**边界项** A–G 同名，
      导致 AC↔边界映射表里 "tests D, E" 的 D/E/E 既可指 fixture 也可指边界项。
      V4 给 fixture 统一加前缀 **FX-**，与边界项 A–G 彻底分离。

   - FX-A 简单成员写：holder.trusted
   - FX-B 嵌套成员写：state.inner.trusted     ← **fixture 仅含 dotted 写，禁混入一级写**
   - FX-C 计算属性：holder[k]
   - FX-D 别名：const a=F, b=a; b()
   - FX-E 解构：import { F as w } / ({t: h.trusted} = obj)
   - FX-F 生产文件 STRIPPED 对照：root=trusted（未变异）。
         ⚠️ V4 修正（P2-3）：V2/V3 此处写「≤ 50 ms」而 APPENDIX C 写「5 ms」，
         相差 10×。V4 **统一取实测值 5 ms**（未变异 control，helper 直调口径）
         并标注口径；「≤ 50 ms」作为上界亦成立，但**不得**与 5 ms 混用。
   - FX-G 大规模语料：42 模块 full-offline
   - FX-H 终止压力：M7 on STRIPPED → 见 **AC-4.1a / AC-4.1b**（不单写 exit 期望）

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

### AC ↔ 边界映射（V5 更新：fixture 改 FX- 前缀、授权面收敛为 A1 + A2' + A3）

```text
AC ↔ 边界映射:
  AC-1 path identity      → A（IR / canonicalPathOf）, B（resolver 兼容）,
                            授权点 A1 + A2' + A3（AC-1 §4.A）
                            tests FX-B, N2, N6, 对照 1–3
  AC-2 mutation complete  → A（writeKind 分类）, 授权点 A1 + A2' + A3
                            tests F1, F2, F3, F4（F3/F4 含 post-fix 终态断言）
  AC-3 absent spelling    → E（枚举器拼写）
                            tests FX-D, FX-E, N3
  AC-4 bounded traversal  → C（廉价 fail-closed）, D（预算 D1–D4）
                            tests FX-F, FX-G, FX-H, T-N1, T-N2, T-N3, N1, N4, N5

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
| **0** 计划修正 | **本文件（V6）**；V1–V5 保留不改 | `docs/planning/P2A_T11_131_REMEDIATION_PLAN_V6.md` | 文本 revert |
| **0.5** 独立评审 | fresh independent review（CODE + SECURITY，同 exact SHA） | 无代码 | 未通过 ⇒ 追加 errata 或产出 V7，**不得**进入 Phase 1 |
| **1** 最小原型 | canonicalPathOf + canonicalKey + 廉价 blind-spot；**先实测 §5.3 的 LEGAL_BODY_READS / UNIT_COST / LEGAL_PATH_EXPANSIONS / UNIT_PATH_COST**，再定 N 与 P | 仅 `test/helpers/t11-trust-surface-enumeration.mjs`（授权点 A1 + A2' + A3） | 分支未合入 → `git branch -D`，零可达性损失 |
| **2** 测试 | 钉死 fixture 的 **FX-A–FX-H** 与 **F1–F4**；AC-4.1a/4.1b 两个独立断言；T-N1/T-N2/T-N3；对照 1–3 | 新增 `test/p2a-t11-131-remediation.test.mjs` | revert commit；r11 32 测试逐条不动 |
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
- 删除或改名上述 14 个（r11 测试实际导入的）导出
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
| R6 | **本文件（V6）未经独立评审** | P1 | **Phase 1 前必须 fresh independent review**；未通过不得进入 implementation |
| R7 | V1 / V2 仍在仓库中被误读为有效契约 | P1 | 本文件首部已声明 SUPERSEDES V1 与 V2；实现期引用 V1/V2 即视为契约漂移 |
| R8 | **AC-4.1a 的 5 000 ms 是先验值，无经验支撑**（修复前生产路径不终止，无参照系） | P1 | 5 000 ms 是**防挂起上界**，非性能门限；AC-4.1b 的安全判定**不含时间门**；AC-4.5 不给毫秒数，Phase 1 实测后写回 |
| R9 | ~~§5.3 可行窗口可能为空~~ **V4 撤回**：该结论是 P1-3 单位错置的产物 | — | V4 已把 (2) 的单位钉死为 ms/次（单次体读取），窗口判定改为**可乘法的可判定条件**；见 §5.3 |
| R10 | AC-3 的 10 形状 / 4 个 ABSENT **未**用独立 fixture 复验（V2 P2-6 残余风险） | P2 | 实现期重测；AC-3 已是 AC 之一，两侧（N3 交叉引用）均须断言 |
| R11 | **授权面扩大后的「静默扩权」风险**：A3 是新增授权点、A2' 放宽共享工厂，实现者可能顺手改相邻逻辑 | P1 | §4.A 已逐条列「授权范围 + 不得改动的相邻语义」；每个授权点须有独立测试证明其**只**做所述改动；Phase 2 加 mutation test 覆盖「越界改动」 |
| R12 | **A2'（放宽共享写工厂）可能引入新噪声**：写侧匹配面同时变大，**且因共享工厂会同时波及 memberWritePathsIn + propertyWriteBindingsOf 两个消费者**（这是 V4 评审 P1-2 的直接后果） | P1 | 对照 1–3（coverage-final-integration.mjs:461 / retrieval.mjs:800 / r11 全局 C3 断言）必须同时成立；任一新增 unresolvable 即失败；**A2' 内置对照断言**（fixture 仅含 dotted 写 ⇒ memberWritePathsIn 新行为须与 V5 预期完全一致、不得假阳性）必须同时成立 |
| R13 | **AC-4.1a 与 AC-4.1b 的 fixture 若共用同一条 M7**，可能把「终止」误判为「检出」 | P1 | 两者**必须**是两个独立断言（不同 test、分别指名）；T-N1/T-N2/T-N3 三个 mutation test 专门防止二者混淆 |
| R14 | **F3（计算键 receiver）当前完全未检出**（V6 真实 C3 路径实测 = silent CLEAN，V=[] U=[]） | P1 | V6 已把 F3 契约钉死为 **(A) DETECTED 或 (B) FAIL_CLOSED，不得 silent CLEAN**（AC-2 F3 块）；§3.5 机械证明 (A) 在 A1+A2'+A3 内可达（模拟 A1 后 F3 → DETECTED V=4，套件 32/32 全绿）。⚠️ 原 R14 的「分类待定」表述基于 helper 直调假象，**已撤回** |

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
[E8] [WITHDRAWN — 依赖已撤回的 E6] 截断串占 374 unres 中的 262…
     374 与 262 两个数字**均出自 E6 的输入口径**，而 E6 已撤回
     ⇒ 本项的结论数字（262 / 70%）**同样无效**，不得引用。
     若需该结论 ⇒ 按 STRIPPED 口径在 42 模块真实语料上**重测**后重写。
     （V3 仅标注「口径受限」而保留结论数字，属证据契约缺陷 —— V4 撤回。）
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

## APPENDIX D（继承自 V2，**全文见上方 APPENDIX D 节**）— 历史errata 索引

> **V4 修 P2-1（重复标题 + 悬空引用）**：V3 曾在本处重复一个 `## APPENDIX D`
> 标题，并声明「下方文本逐字保留」，但其下**并无正文** ⇒ 悬空引用。
> V4 把此处改为**纯索引**：V2 的 errata 全文已在**上方** APPENDIX D 节
> （自「APPENDIX D（继承自 V2）」标题起至 APPENDIX E 前的完整保留文本）。
>
> 索引（V2 errata D.1–D.10 → V4 中的位置）:
>   D.1 基线口径        → PART 3（V3 已重写，V4 沿用）
>   D.2 AC-4 门限       → PART 4 AC-4.1a / AC-4.1b（**V4 拆为两条**）
>   D.3 AC-2 `.add()`   → PART 4 AC-2 F1–F4（V3 已重写，V4 补 F3 当前值）
>   D.4 GATE 授权       → PART 4 AC-1 §4.A（**V4 扩为 A1–A5**）
>   D.5 算术            → PART 2.4 + APPENDIX C [WITHDRAWN]
>   D.6 D2 论证         → §5.2 + AC-1 canonicalKey 精确定义（**V4 修正 INV-2 判据**）
>   D.7 / D.8 P2 项     → PART 6 映射与清单（V4 另修 P2-2/3/4）
>   D.9 D3/D4 耦合      → §5.3（**V4 修正单位错置**）
>   D.10 要求产出 V3    → 已完成；V3 的 REJECT 处置见 APPENDIX F
>
> 上方 APPENDIX D 的正文是 **V2 的历史 errata，逐字保留、append-only、未修改**。
> 其中「V3 应产出…」等未来时表述**以本文件 V4 的实际内容为准**。


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

---

## APPENDIX F — V3 独立评审 REJECT 的处置（append-only）

```text
APPENDIX_F_APPENDED_AT = V4（对 V3 exact SHA 的评审处置）
REVIEWED_EXACT_SHA     = 4dfeca6d8900a274a909a4488a81fd549254acd4（V3）
REVIEWER               = fresh independent reviewer
MODEL_REQUESTED        = deepseek-v4.1-flash
MODEL_ACTUAL           = deepseek-v4.1-flash
FALLBACK_USED          = NO
VERDICT_BEFORE         = REJECT（OPEN_P0 = 2 / OPEN_P1 = 5 / OPEN_P2 = 6）
```

### F.0 — 处置结论

```text
VERDICT_AFTER = MODIFY（V4 已处置全部 P0/P1，仍不通过 implementation gate）
IMPLEMENTATION_AUTHORIZATION = NONE

已确认成立并保留：V3 的方向（path identity / bounded traversal / acorn 拒绝）
已推翻并须重写：AC-1 授权面（2 处不足）、AC-4.1 的 EXIT 语义、canonicalKey 判据、
                  AC-4.x 编号、§5.3 单位、AC-1 噪声对照、E8
```

### F.1 — P0 处置（owner 已裁决方向）

| ID | 评审问题 | owner 裁决 | V4 处置位置 |
|---|---|---|---|
| P0-1 | AC-2 的 F1/F2 在 V3 授权面内**不可达**；AC 集自我阻塞 | **扩授权面**（最小、显式、可枚举） | PART 4 AC-1 §4.A：**授权点 A1–A5**，逐条给出机械必要性证据 |
| P0-2 | AC-4.1 的 `EXIT=0` 与 AC-4.2 + r11 断言不可同时成立 | **拆成两条**（AC-4.1a / AC-4.1b），不降级不拆票 | PART 4 AC-4：AC-4.1a TERMINATION + AC-4.1b SECURITY DETECTION；fixture 语义 / expected verdict / exit expectation 三者分别钉死 |

### F.2 — P1 处置

| ID | 评审问题 | V4 处置位置 |
|---|---|---|
| P1-1 | canonicalKey 定义不完整；D2 在该定义下退化为 no-op | AC-1 构成逐项钉死（receiverPath / property / root / depth 定义）；INV-2 判据改为 `receiverPath + property` 二元组；§5.2 补 D2 净效果说明 |
| P1-2 | AC-4.x 编号定义三次且矛盾 | §5.5 改为「唯一权威定义在 PART 4，本节仅交叉引用」；AC-4.1 拆 a/b；AC-4.5 不再给毫秒数 |
| P1-3 | §5.3 单位错置；AC-4.1 措辞与 §3.4 矛盾 | §5.3 单位钉死为 ms/次（单次体读取），窗口判定改为可乘法条件；§3.4 与 AC-4.1a 措辞统一 |
| P1-4 | AC-1 缺「放宽后 r11 全局仍绿」出口条件 | AC-1 §4.A **对照 1–3**：coverage-final-integration.mjs:461、retrieval.mjs:800、r11 全局 C3 断言 |
| P1-5 | APPENDIX C 的 E8 依赖已撤回的 E6 却仍给结论数字 | APPENDIX C E8 标 [WITHDRAWN — 依赖已撤回的 E6] |

### F.3 — P2 处置

| ID | 评审问题 | V4 处置 |
|---|---|---|
| P2-1 | 重复 `## APPENDIX D` 标题 + 悬空引用 | 重复标题改为「历史 errata 索引」，指向正文 APPENDIX D |
| P2-2 | fixture A–H 与边界项 A–G 同名 | fixture 统一加 **FX-** 前缀，与边界项分离 |
| P2-3 | FX-F 耗时口径不一致（≤50ms vs 5ms） | 统一取实测值 5 ms 并标口径 |
| P2-4 | 「14 个导出」口径不明 | 钉死为「r11 测试实际导入的 14 个」（helper 本身 15 个，多出 importOriginOf） |
| P2-5 | helper 直调 M7 数字来源未钉死 | 保留但标注「helper 直调口径、非生产路径」（PART 3.3 已明示） |
| P2-6 | AC-1 INV-2 / AC-4 跨引用指向 APPENDIX D 同名节 | 引用改为「APPENDIX D（V2 errata 历史）」并在本索引中给出 D.x → V4 位置映射 |

### F.4 — 评审员 NOTES 中本方采纳的补充（非 P0/P1）

```text
1. **F3 当前值已补记**（评审员指出本方未记录）。V4 已补：F3 当前 expressions
   含 rawQuery、unresolvable = [k, plan, targetedPools] ⇒ 部分成立、分类待定，
   不可写成 NOT_REPRODUCIBLE。（见 AC-2 F3。）
   ⚠️ **V6 批注（append-only，上方 V4 原文不改）**：上述 F3「当前值」是 **helper 直调
      假象**（把 `holder[k]` 直接当 root 传入），**不是**生产 C3 路径的行为。
      V6 在 r11 HEAD `2934956` 上按**真实 C3 路径**重取证：F3 当前 = **silent CLEAN
      （V=[] U=[]）**，比 V4 描述的更严重（不是「部分成立」，而是**完全未检出**）。
      ⇒ V4 的「部分成立、分类待定」与 V5 沿用的 helper-direct 值**均已撤回**，
      以 **§3.5** 与 AC-2 F3 块为准。
2. **AC-4.1a 的 5 000 ms 在量级上并非不可能**：未变异套件实测 ~1.63 s。
   问题不在数值大小，而在出处、措辞、单位 —— V4 已逐项处置。
3. **Phase 3「接入 memberWritePathsIn」与 AC-1 冻结其语义的潜在冲突**：
   V4 已把 memberWritePathsIn 的既有语义列入「不得改动」清单（授权点 A5
   只放宽 propertyWriteBindingsOf 的接收者解析，不含 memberWritePathsIn）。
   ⚠️ **V5 批注（append-only，上方 V4 原文不改）**：该处置**已被 V5 推翻**。
      V4 评审 P1-2 证明：`propertyWritePattern` 是**单一共享工厂**（L1735-1748），
      冻结「memberWritePathsIn 不变」与「让 propertyWriteBindingsOf 看见多段写」
      **在同一共享工厂下互相牵制**（且 helper L1713-1730 禁止拷贝第二份写规则）。
      ⇒ V6 进一步澄清：此处**不是**代码层面的「必然不可共存」强断言
      （给工厂加参数即可只驱动一侧），而是**授权纪律** —— 见下方 A2' 与 §4.A。
      ⇒ V5 以 **A2'** 取代 A5：显式授权放宽该共享工厂，
      **同时**影响 memberWritePathsIn(L1813) + propertyWriteBindingsOf(L1868)，
      并**新增对照断言**防假阳性（fixture 仅含 dotted 写时，
      memberWritePathsIn 的新行为须与 V5 预期完全一致）。
      ⇒ 上方「memberWritePathsIn 不得改动」的表述**已过期**，以 §4.A 授权点 A2' 为准。
```

### F.5 — V4 自引入的新风险

见 PART 9 的 R11 / R12 / R13 / R14（授权面扩大的静默扩权风险、A4 噪声风险、
AC-4.1a/1b fixture 混淆风险、F3 分类待定风险）。
⚠️ **V5 批注（append-only）**：其中「A4 噪声风险」在 V5 中已改由
**R12（A2' 噪声风险，因共享工厂同时波及两个消费者）** 承接，A4 已删除。
⚠️ **V6 批注（append-only）**：上述「F3 分类待定风险」的表述**已过期** ——
V6 按真实 C3 路径取证后，F3 当前 = **silent CLEAN（完全未检出）**，
不再是「分类待定」；R14 已据此改写为「F3 当前完全未检出 + 契约钉死为
DETECTED 或 FAIL_CLOSED」。以 **PART 9 R14** 与 **§3.5** 为准。

### F.6 — 评审 gate（V4 生效条件，不变）

```text
IMPLEMENTATION_AUTHORIZATION = NONE（V4 不改变这一点）

进入 Phase 1 的**全部**前置条件:
  1. fresh independent review 覆盖 V4 的 exact commit SHA（非 V3 的 4dfeca6）
  2. Quorum = CODE_REVIEWER + SECURITY_REVIEWER，同 exact SHA，优先异模型
  3. OPEN_P0_P1 = 0
  4. 本附录 F 处置的每一条均有对应正文位置
```

```text
VERDICT_OF_V4_AUTHOR = 未评审（等待 fresh independent reviewer）
IMPLEMENTATION_AUTHORIZATION = NONE
NEXT_ACTION = 对 V4 的 exact commit SHA 启动 fresh independent review

⚠️ V5 批注（append-only，不改上方 V4 原文）：上述 NEXT_ACTION **已执行** ——
  V4 exact SHA 7e27b3b 已获 fresh independent review，结论 = **MODIFY**
  （OPEN_P0 = 0 / OPEN_P1 = 2 / OPEN_P2 = 6）。V4 的评审处置见 **APPENDIX G**。
  当前有效 gate = **APPENDIX H**（针对 V5 exact SHA），本块仅作历史记录。
```

---

## APPENDIX G — V4 独立评审（MODIFY）的处置（append-only）

```text
APPENDIX_G_APPENDED_AT = V5（对 V4 exact SHA 的评审处置）
REVIEWED_EXACT_SHA     = 7e27b3bc2af3f1683faa9d027c29bbee9cde561b（V4）
REVIEWER               = fresh independent reviewer
MODEL_REQUESTED        = deepseek-v4.1-flash
MODEL_ACTUAL           = deepseek-v4.1-flash
FALLBACK_USED          = NO
VERDICT_BEFORE         = MODIFY（OPEN_P0 = 0 / OPEN_P1 = 2 / OPEN_P2 = 6）
```

### G.0 — 处置结论

```text
VERDICT_AFTER = MODIFY（V5 已处置全部 P1 与 P2，仍不通过 implementation gate）
IMPLEMENTATION_AUTHORIZATION = NONE

已确认成立并保留：V4 的方向（AC-4.1a/1b 拆分、canonicalKey 判据、AC-4.x 编号统一、
                            §5.3 单位修正、对照 1–3、E8 [WITHDRAWN]）
已推翻并须收敛：授权面 A1–A5 → A1 + A2' + A3（A4/A5 冗余，见 G.1）
已补齐（P2）  ：计数口径 / F3 post-fix 终态 / F4 具体 RHS / D4 不等式 /
                canonicalKey 适用范围 / V3-V4 自指清理
```

### G.1 — P1 处置（2 条；owner 裁决 = 方案 α）

| ID | 评审问题 | 独立复验证据 | V5 处置位置 |
|---|---|---|---|
| P1-1 | **A4 非必要**，违反最小约束：F3 已被裸名路由既有 receiver-mutation 规则覆盖；F1 先命中 member 路由（A3），不走裸名 `bindingsOf` | 实测 F3：expressions 含 rawQuery、unresolvable=[k,plan,targetedPools] ⇒ 裸名路由**已**匹配 `holder[k].add(`；F1 的 `holder.trusted` 已 walkable（GATE-1 贡献 0）⇒ 不经 A4 | **删除 A4**。授权面由 A1–A5 收敛为 **A1 + A2' + A3**（§4.A）。§4.A 增「授权面三态证明」逐条论证 |
| P1-2 | **A2 与 A5 不能同时成立**：`propertyWritePattern` 是单一共享工厂，放宽它必然同时影响 `memberWritePathsIn`(L1813) 与 `propertyWriteBindingsOf`(L1868)；A5 想只放后者、保持前者不变，在单一定义下不可实现 | 实测：L1813 `if (!propertyWritePattern(split.member).test(source)) continue;` 与 L1868 `const assign = propertyWritePattern(name);` 共用 L1735-1748 工厂；helper L1713-1730 冻结注释**禁止拷贝第二份写规则** | **方案 α**：**删除 A5**，改设 **A2'** —— 授权放宽唯一共享工厂，并**显式声明其同时影响两个消费者**；禁复制第二份写规则；**新增对照断言**（fixture 仅含 dotted 写 ⇒ `memberWritePathsIn` 新行为须与 V5 预期完全一致、不得假阳性）。见 §4.A 授权点 A2' |

### G.2 — P2 处置（6 条，全部已修）

| ID | 评审问题 | V5 处置位置 | 修订要点 |
|---|---|---|---|
| P2-1 | C3/C3c 断言「覆盖 42 模块」不成立 —— 把**语料规模**（42 个 lib 模块）与**被断言的 callsite 数**混为一谈 | §4.A 新增「计数口径」块 + PART 0 新增实测 + AC-4.3 加口径注 | V5 在 r11 HEAD 2934956 **机械实测**：trusted callsite = **5**（unparsed = 0），lib/*.mjs 模块 = **42**。逐条列出 5 个 callsite（file:line + 调用文本）。钉死正确表述；「C3 对全部 42 个模块断言」列为**禁用表述**；对照 1/2 明确为 5 个 callsite 中的 2 个 |
| P2-2 | F4 未钉死具体 RHS 与 expected result | AC-2 F4 | 钉死**两条** RHS 并分别断言期望：正向 `new Set(targetedPools[0].rawQuery)` ⇒ DETECTED；负向 `new Set(plan.queryVariants)`（不含 targeted 词）⇒ violations=0/unresolvable=0 且**不得**误判为缺陷。两条须同时写入 Phase 2 |
| P2-3 | F3 缺 post-fix expected classification | AC-2 F3 | 钉死 post-fix **强制终态** = fail-closed：verdict=UNRESOLVABLE（不得 CLEAN）、unresolvable ⊇ {k}、violations=0（不得误报）。post-fix 若为 CLEAN ⇒ AC-2 失败（P0） |
| P2-4 | 存在 V3/V4 自指与过期路径（误导实现者） | 全文清理 | 顶栏「以 V3 为准」→「以 V5 为准」；PART 8 Phase 0「本文件（V3）」→「（V5）」；PART 9 R6 同改；PART 0/3 版本标签更新为 V5 轮；APPENDIX F 的过期 NEXT_ACTION 加「已执行」批注（append-only，不改 V4 原文） |
| P2-5 | D4（path budget）无机械约束 | §5.3 新增 D4 不等式 (3)(4) + §5.1 D4 行 | D4 独立预算 P 须满足 (3) P ≥ LEGAL_PATH_EXPANSIONS（防假阴性）、(4) P × UNIT_PATH_COST ≤ AC-4.1a 上界。Phase 1 出口条件从 2 个量扩为 **4 个量**（加测 LEGAL_PATH_EXPANSIONS / UNIT_PATH_COST） |
| P2-6 | canonicalKey 适用范围未说明（是否适用于 member 分支？） | AC-1 新增「P2-6 适用范围钉死」 | canonicalKey **仅**适用**裸名分支** seen 去重（也是 D4 计数对象）；**member 分支** seen 键 = `member:${receiver}.${member}`(L831)，保持现状、不换 canonicalKey、不计入 D2/D4。两分支 seen 键不可混用。仅澄清，不改定义、不改 L831、不新增授权点 |

### G.3 — 授权面收敛的净效果（V4 A1–A5 → V5 A1 + A2' + A3）

```text
V4 五点 → V5 三点（每点给出必要 / 非冗余 / 不可由另外两者单独替代的机械证明）:
  A1  保留（分类放行；F2 的第一道闸门）
  A2  →  A2'（放宽唯一共享工厂，显式同时影响 memberWritePathsIn + propertyWriteBindingsOf；
             禁复制第二份写规则；+ 对照断言防假阳性）    ← 吸收原 A5 的意图
  A3  保留（member 路由 mutation 接入；F1 的唯一必要改动）
  A4  删除（冗余：F3 已覆盖、F1 不经此路由）
  A5  删除（与 A2 在单一工厂下不可共存；意图由 A2' 吸收）

不可由另外两者单独替代（§4.A 三态证明的核心）:
  A1  触及「是否 walkable」的分类闸门 —— A2'/A3 都在分类之后，无法重新接纳被拒名字
  A2' 触及写侧赋值匹配 —— A1 不碰写模式，A3 只接 `.add(ARG)` 不读 propertyWritePattern
  A3  触及 `.add(ARG)` 纳入 expressions —— A1/A2' 均不纳入该参数
⇒ 三点构成最小覆盖；无第 4 处授权点。
```

### G.4 — V5 未变更（显式声明，防止借修文档之名改架构）

```text
未改动（与 V4/V3/V2 一致）:
  - PART 1 的 P0-1…P0-5 架构命题
  - PART 2.2 机械证伪 / PART 2.3 CORRECTED / PART 2.4 DEFECT-A/B/C 存在性
  - AC-1/AC-2/AC-3 的目标与形状集（仅改授权面与证据口径）
  - AC-4.1a TERMINATION 与 AC-4.1b SECURITY DETECTION 的拆分（V4 已拆，V5 沿用，未降级）
  - PART 7 ACORN_DECISION = REJECTED
  - PART 6 的 14 个导出不得删改、r11 32 测试逐条不动、lib/ 零改动
  - 授权面 owner 约束：最小/显式/可枚举、不新增 AST/parser、不改 r11 fast path 语义
  - IMPLEMENTATION_AUTHORIZATION = NONE

⚠️ AC 未降级声明（owner 明令「不得通过降低 AC 等级来换 PASS」）:
  V5 未下调任何 AC 的严格度；A4/A5 的删除是**证伪其冗余**后的收敛，
  非为通过评审而放宽验收。A2' 反而**增加**了对照断言（更严）。
```

---

## APPENDIX H — V5 独立评审 gate（V5 生效条件）

```text
IMPLEMENTATION_AUTHORIZATION = NONE（V5 不改变这一点）

进入 Phase 1 的**全部**前置条件:
  1. fresh independent review 覆盖 **V5 的 exact commit SHA**（非 V4 的 7e27b3b）
  2. Quorum = CODE_REVIEWER + SECURITY_REVIEWER，同 exact SHA，优先异模型
  3. **OPEN_P0_P1 = 0**（V4 遗留的 2 条 P1 已在 §4.A 收敛处置，但须由
     针对 V5 的 fresh review 独立确认，不得由本方自证）
  4. APPENDIX G 处置的每一条均有对应正文位置（可机械核对）
  5. AC-4.1a / AC-4.1b 未被降级（终止性与安全检测仍是两个独立维度）

模型优先级: DeepSeek V4.1 Flash → GLM 5.3 → DeepSeek V4 Pro
  （fallback 仅限 MODEL_UNAVAILABLE / RATE_LIMIT / QUOTA / TOOL_FAILURE /
    CONTEXT_CREATION_FAILURE；reviewer 给 findings **不是**换模型理由）

每 review 留 receipt:
  MODEL_REQUESTED / MODEL_ACTUAL / FALLBACK_USED / FALLBACK_REASON /
  REVIEWED_EXACT_SHA / VERDICT / OPEN_P0_P1 / OPEN_P2
```

```text
VERDICT_OF_V5_AUTHOR = 未评审（等待 fresh independent reviewer）
IMPLEMENTATION_AUTHORIZATION = NONE
NEXT_ACTION = 对 V5 的 exact commit SHA 启动 fresh independent review
              （优先 DeepSeek V4.1 Flash；要求 OPEN_P0_P1 = 0 方可进入 implementation gate）

⚠️ V6 批注（append-only，不改上方 V5 原文）：上述 NEXT_ACTION **已执行** ——
  V5 exact SHA b8b3e92 已获 fresh independent review，结论 = **MODIFY**
  （OPEN_P0 = 0 / OPEN_P1 = 1 / OPEN_P2 = 2）。V5 的评审处置见 **APPENDIX I**。
  当前有效 gate = **APPENDIX I.4**（针对 V6 exact SHA），本块仅作历史记录。
```

---

## APPENDIX I — V5 独立评审（MODIFY）的处置 + V6 生效 gate（append-only）

```text
APPENDIX_I_APPENDED_AT = V6（对 V5 exact SHA 的评审处置）
REVIEWED_EXACT_SHA     = b8b3e92143ad6d8822977f3567f29a602bd0890b（V5）
REVIEWER               = fresh independent reviewer
MODEL_REQUESTED        = deepseek-v4.1-flash
MODEL_ACTUAL           = deepseek-v4.1-flash
FALLBACK_USED          = NO
VERDICT_BEFORE         = MODIFY（OPEN_P0 = 0 / OPEN_P1 = 1 / OPEN_P2 = 2）
THREE_WAY_PROOF_HOLDS  = YES
A4_DELETION_JUSTIFIED  = YES
AC_DOWNGRADED_BEFORE   = NO
```

### I.1 — OPEN_P1 处置（1 条，owner 裁决 = 按真实 C3 路径重取证）

| ID | 评审问题 | V6 处置 | 机械证据位置 |
|---|---|---|---|
| P1 | F3 的「当前值」是 **helper 直调产物**，被当作 production evidence；真实 C3 路径从不这样调用，且结论与生产行为**相反** | V6 在 r11 HEAD 2934956 上按**真实 C3 路径**重新取证（镜像到 /tmp，追加探针 test，直接调用未改动的 `c3TrustSurfaceVerdict`/`trustSetRootsOf`/`classifyTrustSetValue`）。真实结论：F3 当前 = **silent CLEAN（V=[] U=[]）**，比 V5 声称的更严重。V5 的 helper-direct「当前值」与「分类待定」**已撤回** | **§3.5**（取证方法 + F1/F2/F3 三形状实测表 + silent CLEAN 机制 + post-fix 可达性证明）；AC-2 的 F3 块 |

```text
V6 对 P1 的完整回答（owner 要求的三点，逐条落位）:
  ① 禁止再引用 helper-direct 作为 production evidence
     ⇒ AC-2 fixture 块首条「V6 取证纪律」明确禁令；§3.5 给出合规取证方法。
  ② 明确 F3 当前真实行为（holder[k] → classifyTrustSetValue → __expr__holder[k]
     → text-only branch → does not enter bindingsOf）
     ⇒ §3.5「silent CLEAN 机制」逐步钉死；AC-2 F3 块顶部逐字复述该链。
  ③ 钉死 F3 post-fix contract（优先在 #131 scope 内；不得 silent CLEAN；
     必须 DETECTED 或 FAIL_CLOSED；仅当机械证明会显著扩大架构面才允许单独 ticket）
     ⇒ AC-2 F3 块给出 (A)/(B) 二选一硬契约 + 「不得静默降级」；
       §3.5「post-fix 可达性证明」机械证明 (A) 在 A1+A2'+A3 内即可达成
       （模拟 A1 后 F3 → DETECTED V=4，冻结套件 32/32 全绿，负向对照 0/0）
       ⇒ **不需要**新授权点、**不需要**另开 ticket（本条为「不得静默降级」的依据）。
```

### I.2 — P2 处置（2 条，全部已修）

| ID | 评审问题 | V6 处置位置 | 修订要点 |
|---|---|---|---|
| P2-1 | A2' 把「放宽共享工厂**必然**同时影响两个消费者 / 不可共存」写成**代码事实**，实为过强断言（加参数即可只驱动一侧） | §4.A 授权点 A2' | 改为**授权声明**：「本授权面**规定**对该共享工厂的放宽无条件适用于全部消费者，且禁止新增第二份写规则」—— 这是授权纪律，**不是**结构性不可能。明确标注 V6 已撤回 V4/V5 的强断言 |
| P2-2 | 行号 off-by-two：`if (receiver === name) continue;` 并非 L1869 | §4.A 授权点 A2' | 修正为 **L1871**；并说明 L1869 实为 `for (let m = assign.exec(source); …)`。经 r11 HEAD 2934956 复核确认 |

### I.3 — V6 未变更（显式声明）

```text
未改动（与 V5/V4/V3/V2 一致）:
  - PART 1 的 P0-1…P0-5 架构命题
  - PART 2.2 机械证伪 / PART 2.3 CORRECTED / PART 2.4 DEFECT-A/B/C 存在性
  - AC-1/AC-2/AC-3 的目标与形状集；AC-4.1a/AC-4.1b 的拆分
  - PART 7 ACORN_DECISION = REJECTED
  - PART 6 的 14 个导出不得删改、r11 32 测试逐条不动、lib/ 零改动
  - 授权面 owner 约束：最小/显式/可枚举、不新增 AST/parser、不改 r11 fast path 语义
  - **授权面 = A1 + A2' + A3**（V6 **不新增授权点**；A4 / A5 仍删除）
  - IMPLEMENTATION_AUTHORIZATION = NONE

⚠️ AC 未降级声明（owner 明令「不得通过降低 AC 等级来换 PASS」）:
  V6 未下调任何 AC 的严格度。相反，V6 把 F3 的契约**收紧**：
    · 当前值由 V5 的「部分成立、分类待定」→ V6 的「**silent CLEAN（fail-open）**」
      （更严重的事实）
    · post-fix 由 V5 的「必须 fail-closed」→ V6 的「**DETECTED 或 FAIL_CLOSED，
      不得 silent CLEAN**」（可 DETECTED，但**任何** silent CLEAN 都判 P0 失败）
  A5 的删除是**证伪其冗余**后的收敛；A2' 保留了对照断言（未放宽验收）。
  A1 的授权范围**扩大**（新增接受计算键 receiver）—— 这是**为消除一个 P0 级
  fail-open** 所必需，且 V6 已机械证明它**不回归**冻结套件（32/32）与负向对照（0/0）。
```

### I.4 — V6 生效 gate

```text
IMPLEMENTATION_AUTHORIZATION = NONE（V6 不改变这一点）

进入 Phase 1 的**全部**前置条件:
  1. fresh independent review 覆盖 **V6 的 exact commit SHA**（非 V5 的 b8b3e92）
  2. Quorum = CODE_REVIEWER + SECURITY_REVIEWER，同 exact SHA，优先异模型
  3. **OPEN_P0 = 0 且 OPEN_P1 = 0**（owner 2026-10-02 明令：两项都必须为 0）
  4. APPENDIX I 处置的每一条均有对应正文位置（可机械核对）
  5. AC-4.1a / AC-4.1b 未被降级
  6. F3 契约（§3.5 + AC-2 F3）经 fresh reviewer 独立复核后仍成立

模型优先级: DeepSeek V4.1 Flash → GLM 5.3 → DeepSeek V4 Pro
  （fallback 仅限 MODEL_UNAVAILABLE / RATE_LIMIT / QUOTA / TOOL_FAILURE /
    CONTEXT_CREATION_FAILURE；reviewer 给 findings **不是**换模型理由）

每 review 留 receipt:
  MODEL_REQUESTED / MODEL_ACTUAL / FALLBACK_USED / FALLBACK_REASON /
  REVIEWED_EXACT_SHA / VERDICT / OPEN_P0_P1 / OPEN_P2
```

```text
VERDICT_OF_V6_AUTHOR = 未评审（等待 fresh independent reviewer）
IMPLEMENTATION_AUTHORIZATION = NONE
NEXT_ACTION = 对 V6 的 exact commit SHA 启动 fresh independent review
              （优先 DeepSeek V4.1 Flash；要求 OPEN_P0 = 0 且 OPEN_P1 = 0
                方可进入 implementation gate）
```
