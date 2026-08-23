# T7 — Top-percent Contract — Approved Decision Record（OPEN-D2 + OPEN-D6）

> **STATUS: APPROVED（product-owner：MODIFY + APPROVE AS MODIFIED，2026-08-23）**
>
> 本文档是 T7 #13 的 **approved contract record**。产品方已对 Phase A 决策包逐项
> APPROVE / MODIFY，本版为归一化后的最终批准合同。Phase A 版中被取代的推荐
> （tie-inclusive selection、answerId 普通字符串序、X=100 时 isFullCoverage:false）
> **已删除 / 重写**。
>
> TICKET: #13 / T7；Phase B BASE: `4df69852cdbf9e93062f5e856bb1cfc21cc7e874`
> 合同状态：D2 + D6 均已 RESOLVED；T8 可在 T7 完整 merge 后开始；#3 保持 OPEN。

---

## 1. Evidence Baseline（Phase A 实测，仍有效）

| 组件 | 实际行为（代码证据） |
|---|---|
| `references/zhihu-corpus-handoff.schema.json` | `task` 枚举仅 `["inspect","digest","archive"]`；`additionalProperties:false`；无 version 字段 |
| `zhihu-answer-grabber/scripts/make-handoff.mjs` | `--task` 三值校验；`verified:true` 强制 |
| `corpus-anthology/scripts/popular-sample.mjs` | 固定 Top N（默认 6），`voteupCount` 降序稳定排序，截断；纯 Markdown 视图；无结构化披露 |
| `corpus-anthology/scripts/chunk.mjs` | 枚举全部 answers → manifest 记录 `voteupCount`；无 selection 逻辑 |
| `corpus-anthology/scripts/map.mjs`（T6） | per-source：每非空来源 1 次 tool-less 模型调用；空/纯占位符来源由 controller 合成 |
| `corpus-anthology/scripts/verify.mjs` | 全量覆盖门 + coverage.json（manifestHash/mapSetHash） |
| `corpus-anthology/scripts/reduce.mjs` | final.json `mode:'digest'`；无覆盖百分比/成本元数据 |
| 成本计量 | 无 token/货币计量；仅 chunk `estimatedTokens` 启发式 |

测试基线（MEASURED）：corpus 121 pass；zhihu 507 pass；pipeline 6 pass。
Issue #3 真实规模：226 / 538 / 98 / 75 / 38 条回答。

---

## 2. OPEN-D2 FINAL CONTRACT（D2.1–D2.8）

### D2.1 百分比取整 — APPROVED
```text
K = ceil(X / 100 * N)
N >= 1 且 X 合法时 K >= 1。
```

### D2.2 最低选中数 — APPROVED
```text
minimum = 1（N >= 1 时）。
```

### D2.3 有效 X — APPROVED
```text
X 必须是显式 safe integer ∈ [1,100]。
禁止：0；小数；负数；>100。
非法输入 → invalid_input。
```

### D2.4 百分比边界同赞 — MODIFIED（原 tie-inclusive 被 REJECT）
```text
REJECT: include entire tie group
APPROVE: STRICT COUNT —— 恰好选中前 K 条 canonical answers。

selectedAnswers = K 必须确定且有界。
理由：top-percent-analysis 是有界成本分析模式；tie-inclusive 在大量等赞语料中
可使 X=5/10% 意外逼近 100% 覆盖。
同赞完全由 D2.5 的确定性排序解决，不做 tie 扩展。
```

### D2.5 确定性排序 — MODIFIED / APPROVED（decimal answerId）
```text
主键: voteupCount DESC
次键: answerId 的 canonical decimal-integer ASC

禁止: 把 answerId 序定义为普通 JS 字符串字典序；禁止依赖 Number 转换。
确定性 decimal 比较定义:
  1. canonicalize 为十进制数字符串（去除前导零歧义：按十进制整数字面规范化）；
  2. 先比较归一化后的数字长度（位数多者数值大）；
  3. 长度相同则按位字典序比较（'0'-'9'）。
该比较规避语言数值精度依赖，同时保留直觉数值序。
result: 全序、确定、跨运行可复现（不依赖 capture order）。
```

### D2.6 X=100 — MODIFIED / APPROVED（sampled identity + truthful coverage）
```text
DO NOT 自动把 X=100 路由到 digest。identity 恒为 mode="top-percent-analysis"。

但 coverage identity 必须如实:
若选中的 canonical source set == 原始 canonical source set:
  isFullCoverage = true

因此正常 X=100 输出为:
  mode = "top-percent-analysis"
  requestedPercent = 100
  selectedAnswers = originalTotal
  actualCoveragePercent = "100.0"
  isFullCoverage = true

这不会使输出成为 digest。硬语义区分:
  analysis identity != coverage fact
  mode=="top-percent-analysis" → 该结果由 top-percent 分析模式产生
  isFullCoverage==true       → 选中集恰好覆盖完整原始集（覆盖事实）
  仅 mode=="digest"           → 全量 digest 管线身份
因此 SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST 保持，同时覆盖元数据不被伪造。
```

### D2.7 默认 X — APPROVED
```text
无默认值。--percent X 必填（mandatory explicit）。
```

### D2.8 披露结构 — APPROVED（含修改后的 isFullCoverage 语义）
```text
canonical top-percent 结果含:
  mode = "top-percent-analysis"
  totalAnswers
  selectedAnswers
  requestedPercent
  actualCoveragePercent
  selectionRule
  selectedSourceIds
  isFullCoverage
  claims
  minorityViews
  uncertainties

isFullCoverage 定义 = 选中 canonical source set 恰等于原始 canonical source set。
它是 coverage metadata，不是 mode identity。

人类可读 digest/渲染输出必须明确披露:
  1. 这是 top-percent analysis；
  2. requested percent；
  3. selected / total；
  4. actual coverage；
  5. selection rule；
  6. canonical-source 覆盖是否恰好完整；
  7. 即使 coverage=100%，也不是 canonical full-digest 管线。
```

---

## 3. Canonical Selection Algorithm（APPROVED）

```text
1. 校验整数 X ∈ [1,100]（非法 → invalid_input）；
2. 枚举 canonical candidate answers；
3. 排序:
   a. voteupCount DESC
   b. canonical decimal answerId ASC（D2.5 比较法）
4. K = max(1, ceil(X / 100 * N))
5. 恰好选中前 K 条。

无 tie 扩展。selectionRule 表示必须编码上述精确行为，不得保留 "tie-inclusive" 标识。
```

**selectionRule 稳定机器表示（Phase B 定义）：**

```text
文法: top-<X>-pct-voteup-desc-answerid-dec-asc-strict
示例: top-10-pct-voteup-desc-answerid-dec-asc-strict
语义: 按 (voteupCount DESC, canonical decimal answerId ASC) 排序，取前 max(1,ceil(X/100*N)) 条，strict count 无 tie 扩展。
```

---

## 4. OPEN-D6 FINAL CONTRACT — OPTION C（APPROVED）

```text
架构: OPTION C（= Option B 细化）
共享 handoff schema: 不变（task 枚举保持 inspect/digest/archive）
V0.3 不新增 top-percent handoff task

top-percent 是 corpus 侧分析模式，作用于已 verified canonical answers。

管线身份:
  verified canonical answers
  → deterministic selector
  → selection.json
  → selected-source chunking
  → 既有 T6 per-source isolated map
  → selection-scope verify
  → reduce with mode="top-percent-analysis"
  → explicit disclosure

selection.json 必须确定性记录至少:
  schemaVersion
  requestedPercent
  selectionRule
  originalTotal
  selectedSourceIds
  selectorHash

selectedSourceIds 必须使用 canonical source IDs。
```

---

## 5. Identity Invariants（APPROVED，不可混淆）

```text
1. PIPELINE / ANALYSIS IDENTITY  →  mode
2. COVERAGE FACT                 →  selected source set vs original canonical source set

以下状态均合法:
  mode = "top-percent-analysis", isFullCoverage = false
  mode = "top-percent-analysis", isFullCoverage = true

但 top-percent 结果绝不能因 X=100 而静默变成 mode="digest"。

SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST
  = pipeline identity 保持分离
  ≠ top-percent 的选中集永远不能在数值上覆盖所有 source
```

---

## 6. Real Examples（按批准合同重算）

**规则：** `K = max(1, ceil(X/100 × N))`；排序 `(voteupCount DESC, canonical decimal answerId ASC)`；strict count 取前 K。

| N | X | K | votes（示意） | 选中（前 K 条，strict） | selectedAnswers | actualCoveragePercent | isFullCoverage |
|---|---|---|---|---|---|---|---|
| 3 | 10% | ceil(0.3)=1 | [100,50,10] | rank1 | 1 | "33.3" | false |
| 8 | 25% | ceil(2.0)=2 | [90,80,70,60,50,40,30,20] | rank1-2 | 2 | "25.0" | false |
| 101 | 10% | ceil(10.1)=11 | 单调递减 | rank1-11 | 11 | "10.9" | false |
| 500 | 5% | ceil(25)=25 | 单调递减 | rank1-25 | 25 | "5.0" | false |
| 500 | 10% | ceil(50)=50 | 单调递减 | rank1-50 | 50 | "10.0" | false |
| 500 | 100% | ceil(500)=500 | 任意 | 全部 | 500 | "100.0" | **true**（identity 仍 sampled） |
| **tie 示例** | 10 | 30% | ceil(3)=3 | [100a,100b,90c,90d,90e,50f,50g,50h,50i,10j]（a…j=answerId 升序） | 恰 3 条：voteup≥100 按 answerId asc → a,b；第 3 条 = 90c（90 组内按 answerId asc 取首个） | 3 | "30.0" | false |

**tie 示例说明（D2.4 strict count）：** votes 相同（90c/90d/90e）时**不做 tie 扩展**；按 canonical decimal answerId ASC 取前 K 中的剩余名额（第 3 条 = 90c）。selectedAnswers 恒等于 K=3，有界确定。

每个示例披露块均输出：`mode='top-percent-analysis'`、`requestedPercent=X`、`totalAnswers=N`、`selectedAnswers=K`、`actualCoveragePercent`、`selectionRule`、`selectedSourceIds`、`isFullCoverage`。

---

## 7. Compatibility Analysis（APPROVED）

| 维度 | 结论 |
|---|---|
| 共享 handoff schema | **零变更**（OPTION C）——`task` 枚举保持 `inspect/digest/archive` |
| V1 对外合同 | 不变 |
| V2 digest 合同（§9.2.3 full coverage） | 不变——digest 管线与身份原样保留 |
| T6 lmstudio-local-tool-less | 复用；map.mjs 增加 mode 参数（选中子集），controller/投影/校验零改动 |
| verify 语义 | digest = full-coverage 门（不变）；top-percent = selection-scope 门（参数化复用） |
| reducer 语义 | final.json `mode` 区分；digest 结构不变；top-percent 追加披露块 + selectedSourceIds |
| `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST` | `mode` 身份 + `isFullCoverage` 覆盖事实 + 披露块三重保证；sampled 永不呈现为 task=digest |

```text
BREAKING_CHANGE: NO
SHARED_HANDOFF_SCHEMA_CHANGE: NO
SHARED_SCHEMA_VERSION_CHANGE: NO
既有 inspect / digest / archive / popular-sample / V1 / V2 合同保持行为兼容
（除非已批准 amendment 明确另说）。
```

---

## 8. Cost / Coverage Analysis

**成本模型（DERIVED from T6）：** 模型调用数 = 选中来源数（per-source）。strict count → **调用数 = K = ceil(X/100 × N)（有界、精确）**。

| 场景（Issue #3 规模） | Full digest 调用数 | Top-percent 调用数（=K） | 相对降幅 |
|---|---|---|---|
| 538 answers, X=10% | ~538 | 54 | ~10× |
| 538 answers, X=5% | ~538 | 27 | ~20× |
| 226 answers, X=10% | ~226 | 23 | ~10× |
| 98 answers, X=10% | ~98 | 10 | ~10× |

**标注：** MEASURED = 测试/调用数实测；DERIVED = 调用数 = 选中来源数（strict count 下等于 K）；ESTIMATED = token/成本降幅 ≈ X/100（无计量，线性估计）；UNKNOWN = 真实 token/时延/货币成本（管线无计量；T11 需加计量后校准）。

**strict count 的成本优势（相对 Phase A tie-inclusive 方案）：** 调用数恒等于 K，杜绝 tie 超选导致的意外成本上界突破。

---

## 9. Unresolved Risks

| # | 风险 | 缓解 |
|---|---|---|
| R1 | strict count 在等赞边界会「任意」选中 tie 内前几个（但由 D2.5 decimal answerId 确定性决定，非随机） | D2.5 全序保证确定性与可复现；selectionRule 编码该序，可审计 |
| R2 | decimal answerId canonicalize 的边界（如 answerId 含非数字字符） | T8 实现时：非法/非纯数字 answerId 的 canonical 化规则 + 测试锁定（fail closed 或明确 fallback） |
| R3 | 无 token 计量 → 成本仅 ESTIMATED | T11 dogfood 加真实计量后校准 |
| R4 | X=100 时 isFullCoverage=true 可能被误读为 full digest | 披露块第 7 项显式声明「即使 coverage=100% 也不是 canonical full-digest 管线」；mode 身份恒定 |
| R5 | selection-scope verify 需新 mode 分支，避免误用 full-coverage 门 | T8 门禁参数化 + 反例测试（scope 外引用/缺失 source 必须 fail） |
| R6 | selectionRule 字符串的机器可解析性 | 文法已定义（`top-<X>-pct-voteup-desc-answerid-dec-asc-strict`），T8 实现 + 测试锁定 |

---

## 10. PRODUCT_OWNER_DECISION RECORD

```text
DECISION: MODIFY + APPROVE AS MODIFIED（2026-08-23）
修改项:
  D2.4  tie-inclusive → STRICT COUNT（有界成本；同赞由 D2.5 解决）
  D2.5  answerId 序 → canonical decimal 比较（非 JS 字符串序 / 非 Number 转换）
  D2.6  X=100 保持 sampled identity，且 isFullCoverage 在选中集==原集时为 true
        （coverage fact ≠ mode identity）
  D2.8  isFullCoverage 定义为覆盖事实语义；人类输出披露 7 项
批准未改项: D2.1 ceil / D2.2 minimum 1 / D2.3 X∈[1,100] 整数 / D2.7 mandatory X
D6:      OPTION C 批准（共享 handoff schema 不变；corpus 侧 selection.json scope）
兼容性:  BREAKING_CHANGE=NO；SHARED_HANDOFF_SCHEMA_CHANGE=NO；SHARED_SCHEMA_VERSION_CHANGE=NO

Phase B 归一化目标（本分支）:
  - 本决策文档（记录批准 + 重写被取代推荐）✅
  - V0.3 Spec §7.2 / §10 / §14-E / §16 OPEN-D2 / OPEN-D6 / §17 T7-T8
  - Product Behavior Contract §3.18
  - project-memory
  - corpus reference/mode 文档（仅在表达批准合同所必需时）
不实现: T8 生产/运行逻辑；共享 handoff schema；digest/popular-sample 运行行为。
```

---

## 附录 A — T8 实现前提（README for T8）

- T8 仅在 T7 完整（本批准 + authority 归一化 + exact reviewed SHA PASS + ff-only merge + #13 关闭）后开始。
- T8 必须实现：selector（D2.1-D2.5 算法 + selection.json + selectorHash）→ chunk(--mode top-percent-analysis) → map（T6 per-source 复用）→ verify(--mode selection-scope) → reduce（mode='top-percent-analysis' + 披露块）。
- `selectionRule` 使用机器表示 `top-<X>-pct-voteup-desc-answerid-dec-asc-strict`。
- `isFullCoverage` 按覆盖事实计算；`mode` 恒为 `top-percent-analysis`（X=100 时也是）。
- 披露块 7 项必须齐全；`SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST` 恒定成立。
- Issue #3 保持 OPEN（top-percent 只是对 large-corpus 成本问题的部分响应）。
