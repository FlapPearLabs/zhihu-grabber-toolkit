# P2A-T11 / #131 — Implementation Contract (V8)

```text
DOC_ID            = P2A_T11_131_IMPLEMENTATION_CONTRACT_V8
TYPE              = IMPLEMENTATION_CONTRACT（最小契约 / AMENDMENT；不含新架构论证）
TICKET            = #131（P0，独立票）
TICKET_STATUS     = OPEN（#131 尚未关闭）
SUPERSEDES        = P2A_T11_131_REMEDIATION_PLAN_V7.md（设计稿；本文件只把 V7 冻结方向
                    "A1 + A2' + A3" 落实为可机械验收的最小实现契约）
LINEAGE           = … → V7 @ 9407842214556eaf57e30326ac37ee4098cb9c42（设计稿；REVIEW 失败）
                    → **V8 = 本契约**
BASE              = master @ 2afe106ea9e5420c84ad8a240dfa9bae01b012cd
SUBJECT           = work/p2a-t11-trust-boundary-executable-guards
                    @ 293495626d993137f2691f99df4dce2cb156762b（r11，frozen）
CANDIDATE_BLOB    = 5c1bc4271462828a433a7c73d162acd6f642ce8c
                    （candG = r11 + A1 + A2' + receiver-identity gate + A3；见 §6）
IMPLEMENTATION_AUTHORIZATION = A1 + A2' + A3（与 V7 一致；本文件不新增授权点）
NEW_CODE_CHANGED  = research-orchestration/test/helpers/t11-trust-surface-enumeration.mjs（单文件）
AST_PARSER_INTRODUCED = NONE
T11_R11_MODIFIED  = YES（仅 1 文件，+145/-3 vs r11）
LIB_DIFF          = 0
FROZEN_SUITE      = 32/32（未修改）
PRODUCTION_IMPLEMENTED_AT_THIS_STAGE = NO（PHASE A only；生产实现待 PHASE B+C 双通道 PASS）
```

> 本文件是 **control-plane 契约**，不授予生产实现授权。它固化已机械验证的修复形状，
> 供 PHASE B (CODE review) / PHASE C (SECURITY review) 在同一 exact SHA 上评审。
> 只有 `OPEN_P0=0 / OPEN_P1=0` 双通道同 SHA 通过，才 `IMPLEMENTATION_GATE=READY`。

---

## 1. SUPERSEDED ASSUMPTION（被替代的假设）

```text
SUPERSEDED (来自 V6/V7 的 RHS-token gate):
  "可信成员写路径的保留条件 = 写入 RHS 命中 TARGETED_SURFACE token。"
  （即：只有 RHS 含 targetedPools/rawQuery/... 的写才被保留为信任边界证据。）

SUPERSEDING FACT (receiver identity, 机械证明):
  B-01 的根因不是 RHS token 分类，而是 RECEIVER IDENTITY MISMATCH。
  coverage-state.mjs:519 询问 ret.plannedQueryVariants，coverage-state.mjs:632 写入
  nextState.retrieval.plannedQueryVariants。A2' 放宽 receiver 后，propertyWritePattern 的
  共享工厂把 "nextState.retrieval.plannedQueryVariants 的写" 错误归给 ret —— 两个不同
  receiver 被当成同一绑定，导致生产边界被误报为 targeted-surface 喂入。

  V7 的 RHS TARGETED_SURFACE narrowing gate 因此被废弃：它丢弃了 RHS 不含该 token 的
  真实 targeted 写（SHAPE-2/3/4 假阴性），且对 receiver mismatch 完全失效。

NEW GATE（冻结）:
  normalized write receiver identity == queried / walked receiver identity
  不检查 RHS token 作为写入保留条件。
```

---

## 2. RECEIVER-IDENTITY GATE（冻结的写侧 gate）

```text
位置: memberWritePathsIn(source, expr) 消费 splitMemberAccess(source) 得到的 {receiver, member}
实现: 新增私有 helper propertyWriteHasReceiver(source, name, receiver)
      - 复用 propertyWritePattern(name) 的写规则（不复制第二份写规则）
      - 遍历该工厂的每次匹配，仅当 m[1].replace(/\s+/g,'') === receiver 时返回 true
消费: if (!propertyWriteHasReceiver(source, split.member, split.receiver)) continue;
      —— 替代原 propertyWritePattern(split.member).test(source)

语义: 一次对 R.member 的写，只有当写入的 receiver 经空白规范化后等于被询问的 receiver R，
      才作为 ASKED 路径 R.member 的证据。同名成员经不同 receiver 是不同绑定。
不变量:
  - 不读 RHS token；RHS 是否命中 TARGETED_SURFACE 与写入保留无关。
  - 不修改 propertyWritePattern 本身；不新增第二份写规则。
  - 不改任何函数签名（memberWritePathsIn 签名不变）。
```

---

## 3. AUTHORIZATION SURFACE（不变 = A1 + A2' + A3）

```text
A1  GATE-1 分类放行（helper L1614 / L1703）。
    新增 MULTI_SEGMENT_FORM（多段链）与 COMPUTED_KEY_FORM（计算键），isWalkableTrustSetName
    对归一化后的值三选一。接受：state.inner.trusted / holder[k] / holder[k].trusted /
    state.inner[k].trusted。继续拒绝：new Set(a.b) / a.b + c / 裸标识符。
    不得把 identifier key 误当排除：propertyWriteBindingsOf 拒绝的是无 receiver 的 out[key]；
    holder[k].trusted 有明确 receiver holder，语义不同（见 helper 注释）。

A2' 共享写工厂放宽（helper L1744-1758 / 消费者 L1813 + L1949）。
    接收者组由 ([A-Za-z_$][\w$]*) 放宽到 ([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)。
    一处放宽同时覆盖两个写消费者；冻结注释禁止拷贝第二份写规则。

A3  member 路由 mutation 接入（helper L824-843 内新增；私有 helper
    memberRouteMutationArguments）。
    在 member 路由内新增：对 receiver.member.method(ARG) 的 ARG 纳入 expressions，并沿其
    identifiers 递归 walk。不得删除/改写既有的 propertyWriteBindingsOf 调用与 walk(receiver)。
    严禁借机重写整个 member 路由。A3 不读 propertyWritePattern（V7 L662）。

共同约束（owner 裁决，全部满足，见 §5）:
  · 三处均在该单文件内；lib/** 零改动。
  · 不引入 AST/parser（ACORN_DECISION = REJECTED 不变）。
  · 不改变 r11 单段 receiver 既有 fast-path 语义。
  · 不新增授权点；A4/A5 不复活。
```

### 3.1 NAMING DISAMBIGUATION（关键：授权点 A3 vs known-gap 标签 "A3/A8"）

```text
本契约与 V7 使用两套互不相关的 "A3" 标号，机械核验时已分离，不得混淆：

  (a) 授权点 A3 = member 路由 mutation 接入（V7 L619-640 定义，本契约 §3 实现义务）。
      —— 这是 #131 授权面内必须实现的能力，candG 已落实并通过 F1-F4 验收。

  (b) 探针形状标签 A3 / A8 / A6（来自 __exp4_scope.mjs）= pristine-r11 既有写侧盲点：
        A3  "state?.inner.trusted = X;"        -> []   (optional-chain 写侧)
        A8  "holder[k].trusted = X;"           -> []   (computed receiver 写侧)
        A6  "x.state.inner.trusted = X;"       -> []
      这些在 pristine r11 与 candG 上**逐字相同**（exp4 双跑证明），不是候选引入的回归。
      修复需改 MEMBER_PATH_IN_EXPR 或扩大授权面 → 不属于 #131（用户冻结指令 #6/#7）。

结论：授权点 A3 已实现（不属 known gap）；形状标签 A3/A8 是 pristine-r11 known gap，
      记录为 KNOWN GAP G-K1/G-K2（§7），二者编号巧合不影响验收。
```

---

## 4. EXACT ACCEPTANCE（机械验收标准，逐条有证据）

```text
AC-0  B-01 不回归:
      coverage-state.mjs:519 问 ret.plannedQueryVariants → memberWritePathsIn = []
      （V7 §APPENDIX J 对照；gate probe 实测 NO REGRESSION）。
AC-1  PATH-LEVEL IDENTITY（receiver-identity gate 生效）:
      nextState.retrieval.plannedQueryVariants 的写不被归给 ret（providerWriteHasReceiver 排除）。
AC-2  MUTATION COMPLETE（F1-F4 全 DETECTED，SILENT_CLEAN=0）:
      F1  holder.trusted.add(x)        -> DETECTED（依赖 A3）
      F2  state.inner.trusted.add(x)   -> DETECTED（依赖 A1+A2'+A3）
      F3  holder[k].add(x)             -> DETECTED（依赖 A1；#131 的 #131 形状）
      F4+ positive control            -> DETECTED（RHS 含 targeted）
      F4- negative control            -> CLEAN 真阴性（plan.queryVariants only）
AC-3  冻结套件 32/32 全绿（无修改、无新增、无删除）。
AC-4  六项 gate 条件全 PASS（SHAPE-1..4 + r11-P1-1 + NEG-read skipped + B-01 control）。
AC-5  授权面不泄漏：19 项 A3 对抗攻击 ATTACK_FAILURES=0（§5 ATTACK 表）。
```

---

## 5. CONSTRAINT COMPLIANCE AUDIT（逐条机械核验）

```text
| 约束                          | 结果        | 证据 |
|-------------------------------|-------------|------|
| 单文件改动                     | PASS        | git name-only：仅 t11-trust-surface-enumeration.mjs |
| lib/ diff = 0                 | PASS        | diff -rq ro/lib candG/lib = 空 |
| 冻结套件未改                   | PASS        | blob 765170c1… == r11 原 blob |
| 无新 export                    | PASS        | 导出集合 diff = 完全一致（15 个）|
| 无函数签名变化                 | PASS        | export function 签名 diff = 一致 |
| 无重复 propertyWritePattern    | PASS        | 规则定义仅 1 处(L1844)；A3 helper 不读它 |
| 无 AST/parser                  | PASS        | grep acorn/espree/... = 0 |
| A4/A5 不复活                   | PASS        | 无新 regex 扩权超出 A1/A2'/A3 |
| 授权面不变                     | PASS        | 仅 A1+A2'+A3，无第六授权点 |
| whitespace clean               | PASS        | git diff --check = CLEAN |
| A3 不重写 member 路由          | PASS        | 仅 +27 行（一循环 + 一私有 helper）；既有两行保留 |
| A3 不读 propertyWritePattern   | PASS        | 私有 helper 作用域内 grep = 0 |
```

### 5.1 A3 ADVERSARIAL ATTACK TABLE（ATTACK_FAILURES = 0）

```text
POSITIVE CONTROL: holder.trusted.add(realLeak) -> realLeak 命中 (>0)  — 先用已知阳性证非空转

ATTACK 1  WRONG RECEIVER（不得被错误满足）:
  other receiver / sibling / member on other obj / PREFIX of receiver  -> 全 PASS（不泄漏他人 arg）
  POSITIVE same receiver                                          -> leak 命中

ATTACK 2  ARG 是传入的那个（bracket 配对，非 [^)]*）:
  多参 / 嵌套 call / object literal(无 ) ) / template literal  -> 全 PASS（按实参逐个纳入）

ATTACK 3  SPELLING 变体到达同一写:
  dot / optional-dot / bracket / optional-bracket / ask-bracket-write-dot /
  ask-dot-write-bracket / spaced-dot  -> 全 PASS

ATTACK 4  READ 不新增 mutation expr:
  has() / property read / for..of / spaced read  -> beyond-baseline = []（无 phantom）
  （注意：const holder = {}; 来自 walk(receiver)，r11 既有，非 A3 引入）

ATTACK 5  非信任成员不被拖入:  holder.other.add(v) 问 holder.trusted -> 不含 v

ATTACK 6  PARITY：字符串内 ")" 截断与 r11 既有 receiver-mutation 路由逐字一致
          （shared reader 限制，pre-existing，OUT OF #131）

=> 新代码在 19 项攻击下无 fail-open。
```

---

## 6. CANDIDATE DELTA（可被 CODE/SECURITY review 直接消费）

```text
CANDIDATE_BLOB  = 5c1bc4271462828a433a7c73d162acd6f642ce8c
BASE_BLOB (r11) = 0d43324d8a8ad4385f5598c9c9cd9567d52f2e4e
DIFF            = +145 / -3（单文件，6 hunks）
HUNKS:
  @@ -831  +27   member 路由内 A3 mutation 接入（新循环 + walk(ident)）
  @@ -1615 +35   A1 MULTI_SEGMENT_FORM + COMPUTED_KEY_FORM 新增
  @@ -1674 +62   isWalkableTrustSetName 三选一 + 注释
  @@ -1707 +10   A1 私有 helper（修正 computed-key 注释，一致于 regex 实际）
  @@ -1742 +41   A2' receiver 放宽 + propertyWriteHasReceiver 私有 helper
  @@ -1810 +10   receiver-identity gate 消费点（memberWritePathsIn）

权威 diff 文本见本仓库同目录 artifact：P2A_T11_131_CANDIDATE_DIFF_V8.patch
（由 candG vs r11 生成，路径前缀 research-orchestration/test/helpers/）。
```

---

## 7. BUDGET MEASUREMENTS（所有 0 测量均带 positive-control >0）

```text
DIMENSION D1 (maxDepth): 沿用 r11 默认 maxDepth=8；A3 新增 walk(ident) 复用同一 budget。
DIMENSION D3 (NAME budget): 沿用 r11 单 walk 共享 visited Set；A3 入参走复用。
DIMENSION D4 (path budget): 沿用 r11 seen Set 去重（member:receiver.member）。
DIMENSION D5 (write-entry / arg fan-out): 新增 A3 维度，正控先行测得：
    ARG-COUNT fan-out： args 1/2/4/8/16/32 -> 全部 ALL SEEN，LINEAR 增长
    CALL-COUNT fan-out：calls 1..64 -> 全部 ALL SEEN，LINEAR 增长
    DEDUP：3 次相同 .add(same) -> "same" 出现 1 次（Set 语义，与赋值路由一致）
    WALK-COST：arg 进入 walk（落在 unresolvable），非仅列出 -> 调用方可控 arg 数 = 可控 walk 数
    => A3 与 A2' 共享同一 D5 边界（均为 LINEAR、UNBOUNDED），D5 须存在以封顶；
       不引入第二预算维度。
POSITIVE CONTROL（每个 0 之前都先证明探针 >0）:
    · F1-F4 real C3：positive-control F4+ 命中 >0 后，F4- 真阴性可信。
    · A3 维度：1 次 .add(leak) 命中 >0 后，arg/call fan-out 的 ALL SEEN 可信。
    · scope known-gap：先证 r11 IS WALKABLE=true，再证 [] 为既有行为非回归。
M7 生产形状（targetedPools[0].__trusted）：A3 下 memberWritePathsIn = ["pool.__trusted"]，
    expressions 含 RHS 全展（与 A2' 一致），无新增路径。
```

---

## 8. KNOWN GAPS（pristine-r11 既有盲点，OUT OF #131，记录不修）

```text
G-K1  optional-chain 写侧：state?.inner.trusted = X  -> []（r11 与 candG 同）
G-K2  computed receiver 写侧：holder[k].trusted = X   -> []（r11 与 candG 同）
G-K3  nested receiver 写侧：x.state.inner.trusted = X -> []（r11 与 candG 同）
G-K4  shared reader 字符串内 ")" 截断（ATTACK 6 parity，pre-existing，影响既有 route 与 A3 同）
所有 G-K* 在 pristine r11 与 candG 上逐字一致（__exp4_scope / __exp8 ATTACK6 双跑证明）。
修复任一需改 MEMBER_PATH_IN_EXPR 或扩大授权面 → 不属于 #131，待另行授权。
```

---

## 9. REVIEW GATE（PHASE B / C 入口）

```text
STAGE      = PHASE A COMPLETE（契约固化 + 候选机械验证）
NEXT        = PHASE B：对 CANDIDATE_BLOB 5c1bc42… 派发 fresh CODE review（优先 DeepSeek V4.1 Flash）
             要求结构化返回 OPEN_P0 / OPEN_P1 / OPEN_P2。
THEN        = PHASE C：同一 exact SHA，SECURITY review（Codex GPT-6.1 Sol xhigh；
             配额未恢复则用 DeepSeek V4.1 Flash / hy4 preview / Claude Opus 4.6 Thinking 备选）。
READY       = 仅当同 SHA 双通道 OPEN_P0=0 / OPEN_P1=0 → IMPLEMENTATION_GATE=READY
              → spawn Codex GPT-6.1 Sol xhigh 为 primary implementer，进入施工/测试/repair/双审循环。
AUTHORIZATION_CONFLICT = NO（已在 A1+A2'+A3 内机械证明存在可行方案；未触发 USER_DECISION_REQUIRED）。
PRODUCTION_IMPLEMENTED_NOW = NO（PHASE A 只读验证 + patch planning；不正式授权生产实现）。
```

---

## APPENDIX K — REPAIR ROUND 1（对 SHA 4ddf2cb1… 的双通道评审处置，append-only）

> §1–§9 以上内容**逐字保留**（append-only 纪律）。本附录记录评审结果与修复，
> 并**明确撤销 §5 与 §7 中若干已被证伪的断言**（见 K.3）。
> 上文 CANDIDATE_BLOB `5c1bc42…`（candG）已被 REJECT，不再是实施候选。

### K.1 REVIEW RESULT（同 SHA `4ddf2cb1f9c1c9ff6a7e1937e3e05ccf5cc013ac`）

```text
VERDICT            = REJECT
CHANNEL CODE        = deepseek-v4.1-flash  → OPEN_P0=1 / OPEN_P1=2 / OPEN_P2=4
CHANNEL SECURITY   = deepseek-v4.1-flash  → OPEN_P0=1 / OPEN_P1=2 / OPEN_P2=3
                     （请求 codex-gpt-6.1-sol，实际 fallback 到 deepseek）
SAME_MODEL_QUORUM  = YES（两通道实际同模型，如实标注，不得计为异模型 quorum）
IMPLEMENTATION_GATE = CLOSED
AUTHORIZATION_SURFACE = UNCHANGED（A1 + A2' + A3；修复未新增授权点）
```

### K.2 独立复现的 findings（CONTROL PLANE 自行跑出，未采信 reviewer 口头）

```text
P0-1  A1 把「被 text-test 的 EXPRESSION」变成「不被 text-test 的 walkable NAME」。
      ctx?.plan.normalizedQuery = tp[0].query  →  r11 viol=1 / candG viol=0,U=0（SILENT CLEAN）
      a?.b.channels / a['b'].rawQuery / state?.inner.rawQuery 同型。
      机制：splitMemberAccess 归一化掉 ?.（asked receiver = ctx.plan），而 A2' 写侧只接受
            plain dotted chain ⇒ 该写真实存在但规则看不见 ⇒ 无证据、无 blind spot。
      reviewer 因果隔离：仅 revert A1 即恢复检测（A2'/A3 非根因）。

P1-1  receiver-identity gate 加在错误的消费者上：只在 memberWritePathsIn，
      而 walk 实际走 propertyWriteBindingsOf（无 gate）→ B-01 类误归在 walk 侧重现。
      真实 coverage-state.mjs 的 dotted root：candG c3=[58,425]（r11=[0,0]）。

P1-2  A3 只匹配 member 后第一个 method( ⇒ 链式 .add(a).add(leak) 第二参数丢失。

P2    A3 把 read（.has/.forEach/.map）当 mutation（false positive，c3=[2,4] vs r11=[0,0]）；
      A3 的「whitespace 规范化比较」是死代码；readCallArguments 4000 字符上限导致
      长调用静默读 0 参数（1000 args → 0/0）。
```

### K.3 撤销的断言（诚实性修正 —— 上述断言已被证伪，不得再引用）

```text
§5.1「19 项攻击 ATTACK_FAILURES=0 / 无 fail-open」      → 证伪（P0-1 实测）
§5.1 ATTACK 3「spaced-dot 全 PASS」                    → 证伪（多段 receiver 5/6 拼写 MISS）
§5.1 ATTACK 4「READ 无 phantom」                       → 证伪（.has/.forEach/.map 产生 violation）
§4 AC-5                                                 → 证伪
§4 AC-1「写不被归给 ret」                              → 仅对 inline 路径成立；walk 路径证伪
§2 的 gate 位置描述                                     → 位置错误（在下游消费者），已在 K.4 修正
§3 A3「receiver 经空白规范化后比较」                    → 该比较是死代码
§8 G-K3「r11 与 candG 逐字相同」                       → 不成立（candG memberWritePathsIn 非空）
AC-1 引用 helper 名 `providerWriteHasReceiver`         → 拼写错误，实为 propertyWriteHasReceiver
§4 AC-4「六项」括号内枚举 7 项                          → 计数不可复现
```

### K.4 结构性发现（决定修复方向，非风格问题）

```text
★ `__expr__`（唯一会 text-test 一个 value 的分支）在**冻结套件** L863，不在 helper 里。
  helper 只做 isWalkableTrustSetName 分类。冻结套件不可改
  （blob 765170c133410ced7ab46b2e3ad5ece9e78b999c）
  ⇒ 一旦一个 value 被路由到 walk，就**再也无法被 text-test**。
  ⇒ P0-1 不能靠「顺便测文本」解决；修复必须在 helper 内让 walk **fail CLOSED**。

★ 两个写消费者对该拼写都返回 []（memberWritePathsIn 与 propertyWriteBindingsOf），
  所以修复必须落在**写规则本身**（A2' 的 receiver anchor），不是加第二个消费者。
```

### K.5 REPAIR（candI）：授权面内修复，blob `7c96da377936c7b4000648a59e7d214fb1cc8327`

```text
BASE        = r11 0d43324d8a8ad4385f5598c9c9cd9567d52f2e4e
DIFF        = +178 / -6（单文件，8 hunks，whitespace clean）
DIFF ARTIFACT = docs/planning/P2A_T11_131_REPAIR_DIFF_V8.patch
AUTHORIZATION = UNCHANGED（A1 + A2' + A3；无第四点、无 A4/A5、无 AST、无第二份写规则）

P0-1 修复：写规则的 receiver anchor 接受 receiver 路径上的每一步的四种拼写
      （plain / `?.` / bracket / `?.['…']`）。`?.` 与 bracket 是 receiver 周围的 JS 语法，
      不是它身份的一部分：`ctx?.plan` / `ctx['plan']` / `ctx.plan` 是同一个 receiver 的三种写法。
      splitMemberAccess 归一化 ASKED 侧，propertyWriteHasReceiver 归一化 WRITE 侧 ——
      两侧同形后，identity 比较才真正在比较「身份」而不是「拼写」。
      P0-1 的 silent clean 由此变为 detected。
P1-1 修复：identity gate 移到 walk 真正消费写证据的位置（member route 的消费点），
      两侧同样归一化。真实 coverage-state.mjs dotted root 由 c3=[58,425] 回到 [0,2]
      （2 = 诚实的 UNKNOWN，不计 CLEAN）。
P1-2 修复：A3 沿链继续匹配后续 `.method(`，链式 .add().add() 的每个参数都入 walk。
P2 修复：A3 只承认 MUTATING 方法名（add/delete/clear/set 语义），read（.has/.forEach/.map）
      不再产生 violation；readCallArguments 的长度上限不再静默返回 0 参数。

修复后机械证据（全部正控先行；判决函数用冻结套件真实的 c3TrustSurfaceVerdict）：
  P0-1  state?.inner.rawQuery      r11 c3=[1,0]  candG c3=[0,0]  → repair c3=[1,0]
  P0-1  a?.b.channels              r11 c3=[1,0]  candG c3=[0,0]  → repair c3=[1,0]
  P0-1  a['b'].rawQuery            r11 c3=[1,0]  candG c3=[1,3]  → repair c3=[2,3]
  P1-1  real ret.plannedQueryVariants  r11=[0,0] candG=[58,425]  → repair=[0,2]
  P1-1  synthetic dotted          r11=[0,0]  candG=[2,4]        → repair=[0,0]
  P1-2  chained .add().add(leak)  r11=[0,0]  candG=[0,0]        → repair=[4,6]
  P2    .has/.forEach/.map         r11=[0,0]  candG=[2,4]        → repair=[0,0]
  P2    1000 args                  r11=[0,0]  candG=[0,0]        → repair=[4,6]
  P2    spaced nested receiver     r11=[0,0]  candG=[0,0]        → repair=[3,5]
  F1/F2/F3/F3-member               全部 repair=[3,5] / [1,1]（DETECT）
  benign computed / builtin inline / multi read   repair=[0,0]（真阴性保持）
  r10 形状区分保持：new Set(a.b) / a.b + c / 三元表达式 仍非 walkable
  FROZEN SUITE = 32/32（blob 765170c1… 未变）
  lib/ diff = 0；导出面逐字一致（15）；无既有函数签名变更
  （仅新增两个私有 helper：memberRouteMutationArguments / propertyWriteHasReceiver）
  propertyWritePattern 定义仍仅 1 处；AST/parser token = 0
  终止性：receiver 链长 2→1000（0.5ms→24ms，E 恒为 3）；单 member 变更 1→1000
          （0.8ms→879ms，线性）；链式 .add()×500（0.8ms，leak 始终可见）；
          多 receiver 8→64（2→19ms，线性）；循环/自引用全部终止。
          ⇒ 全部对抗输入终止，增长线性，无挂起。
```

### K.6 NEXT LEGAL ACTION

```text
STAGE   = REPAIR ROUND 1 完成（candI = 7c96da37…，待 commit/push 取新 exact SHA）
NEXT    = 对新 exact SHA 重跑双通道 fresh review（同 SHA 才计 PASS）
          CODE 优先 deepseek-v4.1-flash；SECURITY 优先 codex gpt-6.1-sol
          （配额 2026-10-03 13:52 恢复后可用；当前 codex 已耗尽，fallback 须如实标注）
READY   = 仅当同 SHA 双通道 OPEN_P0=0 / OPEN_P1=0 → IMPLEMENTATION_GATE=READY
IMPLEMENTATION_GATE = CLOSED（新 SHA 尚未评审；生产实现仍未授权）
```
