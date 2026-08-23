# T7 Phase A — Top-percent Contract Decision Packet（OPEN-D2 + OPEN-D6）

> **STATUS: PHASE A — EVIDENCE + DECISION PACKET（非 APPROVED / ACCEPTED / FINAL CONTRACT）**
>
> 本文件是 T7 #13 Phase A 的证据基线与完整决策包，供 product-owner 逐项批准或修改。
> 在 product-owner 明确批准前，**不得**将其中任何推荐写成 APPROVED / ACCEPTED / FINAL。
> 不实现 T8；不关闭 #13；Issue #3 保持 OPEN。
>
> TICKET: #13 / T7（Phase A）；BASE: `ca2b91a594659745705d2f37431476f58563113e`
> 治理门：product-owner gate（本授权仅开启 Phase A 证据收集 + 决策包，非选项批准）

---

## 1. Current Evidence Baseline（以实际代码为准，非旧文档推断）

**验证事实（2026-08-23，master `ca2b91a`）：**

| 组件 | 实际行为（代码证据） | 与 top-percent 的相关性 |
|---|---|---|
| `references/zhihu-corpus-handoff.schema.json` | `task` 枚举仅 `["inspect","digest","archive"]`；`additionalProperties:false`；无 version 字段 | sampled 模式没有合法 task 标识（OPEN-D6 冲突源） |
| `zhihu-answer-grabber/scripts/make-handoff.mjs` | `--task` 三值校验（`inspect/digest/archive`），默认 digest；`verified:true` 强制 | 新增 sampled task 需改此处 + schema |
| `corpus-anthology/scripts/popular-sample.mjs` | 固定 Top N（默认 6，`--top` 1–100）；`voteupCount` 降序稳定排序；截断到 `--max-chars`（默认 1300）；纯 Markdown 视图；头部仅「(N 条回答)」；**无结构化披露元数据** | 现有「代表性样本」工作区（Issue #3 workaround）；不是结构化 sampled 模式 |
| `corpus-anthology/scripts/chunk.mjs` | 枚举 **全部** answers → manifest.inputs[] 记录 `voteupCount`；sourceId = `question-<qid>-answer-<id>`；无任何 selection/采样逻辑 | 选择可在 manifest 层做（voteupCount 已在 manifest） |
| `corpus-anthology/scripts/map.mjs`（T6） | **per-source**：每非空来源 1 次 tool-less 模型调用（短 token 投影 → controller 装配）；空/纯占位符来源由 controller 合成；任一来源失败 → 整 chunk fail closed | **模型调用数 = 选中来源数**（成本模型核心） |
| `corpus-anthology/scripts/verify.mjs` | 全量覆盖门：missingSources / failedChunks / malformedMaps / duplicateMaps / missingMappedSources / crossChunkEvidence / staleMaps；coverage.json 记 manifestHash/mapSetHash | sampled 模式需要「selection-scope 覆盖门」变体 |
| `corpus-anthology/scripts/reduce.mjs` | reduce-input + final.json：`schemaVersion:1`、`mode:'digest'`、`inputCount`、`chunkCount`、claims{text,evidenceSourceIds,confidence}、minorityViews、uncertainties | **无覆盖百分比/成本/selection 元数据**；final.json `mode` 是身份字段 |
| `corpus-anthology/references/modes.md` | 仅 inspect/digest/archive；popular-sample 是「高赞样本」脚本（非模式） | top-percent 需成为正式模式或保持脚本 |
| 成本计量 | **无** token/货币计量；仅 chunk `estimatedTokens` 启发式（chars/2.2–chars/1.4） | 成本分析只能 DERIVED/ESTIMATED |

**测试基线（MEASURED，今日运行）：** corpus-anthology `121 pass / 0 fail`；zhihu-answer-grabber `507 pass / 0 fail`；根 agent-pipeline `6 pass / 0 fail`。

**Issue #3 真实 dogfood 规模（MEASURED，Issue 记录）：** 226 / 538 / 98 / 75 / 38 条回答。全量 digest 成本随回答数线性上升（per-source 调用）。

**可复用面（Identify what can be reused）：**
- manifest 已枚举全部来源并带 `voteupCount` → selection 只需确定性排序 + 截取，无新枚举。
- T6 per-source tool-less map 完全可复用（选中来源子集上逐来源调用）。
- verify 的覆盖门逻辑可参数化（selection scope vs full scope）。
- reduce/render 可复用，仅 final.json `mode` + 披露字段差异。
- chunk 的断点续传/幂等（manifest 哈希比对）可直接沿用。

**真正仍 OPEN 的合同（Geniune gaps）：** selection 算法（D2.1–D2.7）、披露结构（D2.8）、sampled 模式身份与 handoff/schema 影响（D6）。

---

## 2. OPEN-D2 Option Matrix（D2.1–D2.8）

### D2.1 百分比取整（ceil / floor / round）

| 选项 | 定义 | 示例（N=3, X=10% → K） | 确定性 | 兼容性 | 披露影响 |
|---|---|---|---|---|---|
| **ceil** | `K = ceil(X/100 × N)` | ceil(0.3)=1 | 是 | 无 schema 影响 | actual ≥ X%（不谎报「少选」） |
| floor | `K = floor(X/100 × N)` | floor(0.3)=0 | 是 | 无 | actual ≤ X%；小 N 可为 0（与 D2.2 minimum 冲突） |
| round | `K = round(X/100 × N)` | round(0.3)=0 | **否**（.5 边界各实现分歧，banker's rounding 歧义） | 无 | 边界含糊 |

**RECOMMENDED: `ceil`。** 保证「至少达到目标比例」，永不静默少选；与 D2.2 `minimum 1` 天然一致；完全确定性。

### D2.2 最低选中数（minimum）

| 选项 | 行为 | 示例 |
|---|---|---|
| **minimum 1** | N≥1 且 X≥1 时至少选 1 条 | N=1, X=1% → 选 1（实际 100%） |
| strict（可为 0） | 严格按公式，可为 0 | N=3, X=1%（floor/round）→ 0 条空样本 |

**RECOMMENDED: `minimum 1`**（N≥1 且 X≥1）。配合 ceil 后自动满足，但显式声明作为防御（防未来取整策略变更）。极小语料下实际覆盖可能远超 X%，由披露字段如实反映。

### D2.3 有效 X 范围（整数/小数/边界）

| 选项 | 范围 | 示例 |
|---|---|---|
| **整数 1–100** | `X ∈ [1,100]` 整数；X<1 或 X>100 或小数 → 非法输入 | X=12.5 → invalid；X=0 → invalid |
| 0–100 | 允许 0（空样本） | 与 D2.2 minimum 1 矛盾 |
| 允许小数 | 如 12.5% | K=ceil(12.5%×8)=1；解析/UI 复杂，边际价值低 |

**RECOMMENDED: 整数 `X ∈ [1,100]`，禁止小数，禁止 0。** X=100 是合法值（路由见 D2.6）。解析严格：`Number.isSafeInteger` + 范围校验，非法 → `invalid_input`（与既有 CLI 失败语义一致）。

### D2.4 点赞相同落在百分比边界（strict count vs 全取 tie group）

| 选项 | 行为 | 示例（N=10, X=30% → K=3；votes=[100,100,90,90,90,50,50,50,50,10]） |
|---|---|---|
| strict count | 恰取 K 条；边界 tie 内任意截断（需 D2.5 tie-break 才确定） | 取 3 条（100,100,90-其一）→ 同一赞组被拆开 |
| **include entire tie group** | 选 `voteupCount ≥ V_K` 的全部（V_K = 第 K 位的 voteupCount） | V_3=90 → 选 5 条（100,100,90,90,90）→ actual 50% |

**RECOMMENDED: include entire tie group。** 避免任意拆开等赞回答；selection rule 语义干净（「赞数 ≥ 边界值」）；actualCoverage 可能超 X%，由披露如实反映。配合 D2.5 确定排序。

### D2.5 确定性 tie-break（排序字段）

| 选项 | 排序 | 确定性 | 可复现性 |
|---|---|---|---|
| capture order | 仅 voteupCount DESC；tie 保持 manifest 输入顺序 | 是（单次运行） | **否**——capture/resume 顺序可能跨运行变化 |
| **answerId ASC** | `(voteupCount DESC, answerId ASC)` 字典序 | 是 | **是**——answerId 是 canonical 稳定键 |
| answerId DESC | 同上但降序 | 是 | 是（但逆序反直觉） |

**RECOMMENDED: `(voteupCount DESC, answerId ASC)`。** 规范排序键 = 全序：主键 voteupCount 降序，次键 answerId 升序（稳定、跨运行可复现、不依赖 capture 顺序）。selection rule 字符串写明该规则。

### D2.6 X=100 路由（关键设计问题）

**问题：top 100% 是否等于 full digest？**

| 选项 | 行为 | 语义稳定性 | 未来兼容性 |
|---|---|---|---|
| 路由 full digest | X=100 → 自动切层 3（task=digest） | **差**——同一管线按参数静默切换身份；用户显式选 top-percent 却拿到 digest 身份输出 | 与 T9/T10 hierarchical digest 身份纠缠 |
| **保持 sampled 身份** | X=100 → 仍 top-percent sampled mode；selectedTotal 可等于 originalTotal，但 identity 不变 | **好**——identity 由 mode 决定，不随 X 漂移；「selection identity ≠ coverage identity」恒定成立 | top-percent 与 hierarchical full digest 永远身份可辨 |

**RECOMMENDED: 保持 sampled 身份。** 核心论断：**selection identity 与 coverage identity 必须保持分离**，即使 `selectedTotal == originalTotal`。X=100 是 sampled 模式的合法参数上限，其输出披露 `requestedPercent=100`、`actualCoveragePercent=100`、`isFullCoverage:false`、selection rule 显式声明「top-100%-by-voteupCount」——数值上覆盖全量，但身份上是 sampled 管线的退化情况，**不得**自称为 full coverage digest。这保证身份语义随 X 连续、无静默切换，并为 T9/T10 保留「full coverage 身份 = hierarchical/digest 管线」的唯一归属。

> **NOTE（对 PO 明示的分歧点）**：本推荐**逆转**了 V0.3 §16 OPEN-D2 D2.6 的既有倾向（原 RECOMMENDATION 为「X=100 自动路由 full digest」）。理由：身份应随 mode 而非参数决定，避免同一管线按 X 静默切换身份；数值全量 ≠ 身份全量（`SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST` 恒成立）。PO 可据此选择逆转后的推荐或维持原倾向（维持原倾向则需接受身份随 X 不连续的语义代价）。

### D2.7 默认 X（mandatory vs default）

| 选项 | 行为 | 风险 |
|---|---|---|
| **mandatory explicit** | top-percent 模式必须显式 `--percent X`；无默认 | 调用方多一个参数；披露的 selection rule 一定反映用户真实意图 |
| default 20% | 未指定时用 20% | 用户可能未察觉 X 被隐含决定；披露 rule 非用户所选 |

**RECOMMENDED: mandatory explicit X。** 披露不变量要求 selection rule 可审计；隐含默认值会制造「用户没选的 rule」。top-percent 入口强制 `--percent`，缺失 → `invalid_input`。

### D2.8 输出/披露结构

**已批准披露不变量（不变）：** sampled analysis 必须明确披露——不是全量、实际选了多少、实际覆盖比例/范围、selection rule。

**RECOMMENDED 字段（canonical final.json，`mode: 'top-percent-analysis'` 身份内）：**

```json
{
  "schemaVersion": 1,
  "mode": "top-percent-analysis",
  "totalAnswers": 538,
  "selectedAnswers": 54,
  "requestedPercent": 10,
  "actualCoveragePercent": "10.0",
  "selectionRule": "top-10%-by-voteupCount-answerId-asc-tie-inclusive",
  "selectedSourceIds": ["question-123-answer-42", "..."],
  "isFullCoverage": false,
  "claims": [{ "text": "...", "evidenceSourceIds": ["question-123-answer-42"], "confidence": "high" }],
  "minorityViews": [],
  "uncertainties": []
}
```

- `totalAnswers` / `selectedAnswers`：精确整数（truth 源）。
- `actualCoveragePercent`：`(selected/total × 100)` 保留 1 位小数的字符串（确定性格式化，避免浮点表示歧义；例如 1/3 → "33.3"）。
- `selectionRule`：规范字符串，编码 X、排序、tie 策略（机器可读 + 人可读）。
- `selectedSourceIds`：选中来源的 canonical source ID 数组（provenance）。
- `isFullCoverage: false`：显式反全量标记（X=100 sampled 时仍为 false）。
- **`mode: 'top-percent-analysis'` 是身份字段**——任何消费方据此区分 sampled 与 `digest`（`mode:'digest'` 不变）。
- 展示层 `digest.md` 渲染时在头部输出⚠️ 披露块：「top-percent 样本分析（非全量 digest）：X%，selected/total，selection rule」。

**不得**把 sampled 输出写成 `mode:'digest'` / `task=digest` / 无披露的 Markdown。

---

## 3. OPEN-D6 Option Matrix（架构方向）

### OPTION A — 新增 canonical handoff task / schema identity

| 维度 | 评估 |
|---|---|
| 做法 | handoff schema `task` 枚举 += `"top-percent-analysis"`（additive enum member）；`make-handoff.mjs` 接受 `--task top-percent-analysis` |
| 兼容性 | **additive、非破坏**：旧值不变；旧消费方不受影响；但触碰共享 schema（V0.3 §10 要求独立兼容性 review） |
| schema migration | 无 version 字段；enum 扩展即变更点；grabber + corpus 双方需同步 |
| V1/V2 行为 | V1 不变；V2 digest 合同不变（digest 仍全量） |
| T6 集成 | T6 controller/map 完全复用（per-source）；仅 chunk 层按 selection 过滤 |
| source lineage | handoff 层带 selectedSourceIds 标识 → 强 provenance |
| 防止混淆 | **最强**：task 身份在抓取→语料交接层即分离 |
| T8 复杂度 | 需改 grabber（make-handoff）+ schema review；语料侧与 B 相同 |
| T9/T10 | digest 身份不变；无碰撞 |

### OPTION B — handoff 不变；corpus 侧独立可验证 selection scope

| 维度 | 评估 |
|---|---|
| 做法 | handoff schema 不动；top-percent 是 corpus 内部分析模式（输入已验证 answers.json）：`selection.json` 记录 `{schemaVersion, requestedPercent, selectionRule, originalTotal, selectedSourceIds, selectorHash}`；verify 以 selection-scope 门校验；final.json `mode:'top-percent-analysis'` + 披露块 |
| 兼容性 | **零共享 schema 变更**；V1/V2/既有消费方零影响 |
| schema migration | 无 |
| V1/V2 行为 | 不变 |
| T6 集成 | 复用 T6 per-source map（选中来源子集） |
| source lineage | selection.json（canonical source IDs + selectorHash）+ final.selectedSourceIds 双记录 |
| 防止混淆 | 强：final.json `mode` + `isFullCoverage:false` + 披露块；但 handoff 层无 sampled 身份（原始抓取 handoff 的 task 可能为 digest/inspect，不描述分析模式） |
| T8 复杂度 | **最低**：全在 corpus 侧；无 grabber/schema 改动 |
| T9/T10 | digest/hierarchical 身份不变；无碰撞 |

### OPTION C — 从当前实现发现的更好架构（推荐方向 = B 的实现细化）

当前实现洞察：manifest 已枚举全部来源带 voteupCount；T6 map 是 per-source；verify/reduce 可参数化。因此**top-percent 不是新管线，而是「同一 digest 管线在确定性选择子集上以 sampled 身份运行」**：

```
answers.json (verified)
  → 确定性 selector（manifest 层：voteupCount DESC, answerId ASC, tie-inclusive, ceil(X%·N), min 1）
  → selection.json（scope：originalTotal/selectedSourceIds/rule/percent/selectorHash）
  → chunk.mjs --mode top-percent-analysis（仅对选中来源分块）
  → map.mjs（T6 per-source，仅选中来源；复用 lmstudio-local-tool-less）
  → verify.mjs --mode top-percent-analysis（selection-scope 覆盖门：selectedSources 全覆盖、无跨 scope 引用）
  → reduce.mjs（mode:'top-percent-analysis' + 披露块 + selectedSourceIds）
  → final.json（身份 + 披露）→ digest.md（⚠️ 披露头部）
```

- **身份分离**：final.json `mode` 是唯一身份真源；`isFullCoverage:false` 反全量标记；selection scope 独立可验证（selectorHash）。
- **防混淆硬保证**：任何消费方读取 `mode` 即可分辨；sampled 输出**无法**静默呈现为 `task=digest`（身份字段不同 + 披露块 + 反全量标记三重）。
- **成本复用**：`map.mjs` 调用数 = 选中来源数（现有 per-source 设计），选择子集即降本。

**RECOMMENDED: OPTION C（即 Option B 的细化实现；拒绝在 Phase A 触碰共享 handoff schema）。**
理由：零共享 schema 变更、T8 复杂度最低、身份/披露/反混淆三重保证在 corpus 内即可完成；若未来产品确需 handoff 层身份，可再 additive 增加 task enum（OPTION A 作为可增量后补项），不构成不可逆决策。

---

## 4. Real Examples（N / X / 选择位置 / 披露元数据）

**规则（推荐包）：** `K = max(1, ceil(X/100 × N))`；排序 `(voteupCount DESC, answerId ASC)`；选中 = `voteupCount ≥ V_K`（tie-inclusive）。

| N | X | K | votes（示意） | 选中位置（sourceIds by rank） | selectedAnswers | actualCoveragePercent | 说明 |
|---|---|---|---|---|---|---|---|
| 3 | 10% | ceil(0.3)=1 | [100, 50, 10] | rank1（V_1=100 → 赞≥100：1 条） | 1 | "33.3" | ceil 超选（10%→33.3%）如实披露 |
| 8 | 25% | ceil(2.0)=2 | [90,80,70,60,50,40,30,20] | rank1-2（赞≥80） | 2 | "25.0" | 精确 |
| 101 | 10% | ceil(10.1)=11 | 单调递减 | rank1-11 | 11 | "10.9" | ceil 微超 |
| 500 | 5% | ceil(25)=25 | 单调递减 | rank1-25 | 25 | "5.0" | 精确 |
| 500 | 10% | ceil(50)=50 | 单调递减 | rank1-50 | 50 | "10.0" | 精确 |
| 500 | 100% | ceil(500)=500 | 任意 | 全部 | 500 | "100.0" | **identity 仍 sampled**：`requestedPercent=100`、`isFullCoverage:false`、rule=top-100%-by-voteupCount |
| **tie 示例** | 10 | 30% | ceil(3)=3 | [100,100,90,90,90,50,50,50,50,10] | V_3=90 → 赞≥90：5 条（rank1-5） | 5 | "50.0" | tie 全取；requestedPercent=30 与 actual=50 明确分离 |

披露块对每个示例均输出：`mode:'top-percent-analysis'`、`requestedPercent=X`、`totalAnswers=N`、`selectedAnswers`、`actualCoveragePercent`、`selectionRule`、`selectedSourceIds`、`isFullCoverage:false`。

---

## 5. Compatibility Analysis（推荐包）

| 维度 | 影响 |
|---|---|
| 共享 handoff schema | **零变更**（Option B/C）——`task` 枚举保持 `inspect/digest/archive`；`additionalProperties:false` 不变 |
| V1 对外合同 | 不变 |
| V2 digest 合同（§9.2.3 full coverage） | 不变——digest 管线与身份原样保留；top-percent 是独立 mode |
| T6 lmstudio-local-tool-less | 复用；map.mjs 增加 mode 参数（选中子集），controller/投影/校验逻辑零改动 |
| verify 语义 | digest = full-coverage 门（不变）；top-percent = selection-scope 门（新，参数化复用现有校验器） |
| reducer 语义 | final.json `mode` 字段区分；digest 输出结构不变；top-percent 追加披露块 + selectedSourceIds |
| 既有消费方（verify.mjs --final、render-final） | digest 路径不变；top-percent 由新 mode 分支消费 |
| `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST` | 三重保证：`mode` 身份字段 + `isFullCoverage:false` + 披露块；**sampled 输出无法静默呈现为 task=digest / full coverage** |

**BREAKING_CHANGE: NO（推荐包）。SCHEMA_VERSION_CHANGE: NO（推荐包，共享 schema 不变）。**
> 若 product-owner 改为 OPTION A（handoff task enum 扩展），则 SCHEMA_VERSION_CHANGE: YES（additive、非破坏，需 V0.3 §10 独立兼容性 review）。

---

## 6. Cost / Coverage Analysis

**成本模型（DERIVED from T6 实现）：** `map.mjs` per-source 设计 → **模型调用数 = 选中来源数**（非空来源 1 次调用；空/纯占位符来源由 controller 合成不调用）。full digest 调用数 ≈ 回答总数 N。

| 场景（Issue #3 真实规模） | Full digest 调用数（DERIVED） | Top-percent 调用数（DERIVED） | 相对降幅（DERIVED） |
|---|---|---|---|
| 538 answers, X=10% | ~538 | ~54（+tie 超选） | **~10×** |
| 538 answers, X=5% | ~538 | ~27 | **~20×** |
| 226 answers, X=10% | ~226 | ~23 | ~10× |
| 98 answers, X=10% | ~98 | ~10 | ~10× |

**标注：**
- **MEASURED：** 测试套件数（121/507/6）；T6 smoke 实测「3 来源 chunk → 2 次模型调用（1 空源合成）」——验证 per-source 调用模型。
- **DERIVED：** 调用数 = 选中来源数（由 T6 代码结构推导，非测量 token）。
- **ESTIMATED：** token/成本降幅 ≈ X/100（无 token 计量，仅按调用数与来源文本量线性估计；tie 超选会略增）。
- **UNKNOWN：** 实际 token 数、时延、货币成本（管线**无**任何计量；chunk `estimatedTokens` 为启发式，非真实 token）。T11 dogfood 应加入计量后再校准。

---

## 7. Recommended COMPLETE D2 + D6 Package（供批准或修改）

```text
=== OPEN-D2（selection contract）===
D2.1 取整:          ceil（K = max(1, ceil(X/100 × N))）
D2.2 最低选中:      minimum 1（N≥1 且 X≥1 时）
D2.3 X 范围:        整数 X ∈ [1,100]；禁止小数/0/越界（非法 → invalid_input）
D2.4 边界同赞:      include entire tie group（选中 voteupCount ≥ V_K 的全部）
D2.5 tie-break:     (voteupCount DESC, answerId ASC) 字典序
D2.6 X=100 路由:    保持 sampled 身份（selectedTotal==originalTotal 时 identity 仍 top-percent-analysis，
                    isFullCoverage:false；不自动切 full digest）
D2.7 X 默认:        mandatory explicit（--percent 必填，无默认）
D2.8 披露结构:      final.json: mode='top-percent-analysis' + totalAnswers / selectedAnswers /
                    requestedPercent / actualCoveragePercent(1位小数) / selectionRule /
                    selectedSourceIds / isFullCoverage:false；digest.md 头部 ⚠️ 披露块

=== OPEN-D6（mode / pipeline identity）===
架构:               OPTION C（= Option B 细化）——共享 handoff schema 零变更
入口:               corpus 侧 top-percent 模式（输入已验证 answers.json）
selection scope:    selection.json {schemaVersion, requestedPercent, selectionRule, originalTotal,
                    selectedSourceIds, selectorHash}，独立可验证
管线:               selector → chunk(--mode top-percent-analysis, 选中子集) → map(T6 per-source,
                    复用 lmstudio-local-tool-less) → verify(--mode top-percent-analysis,
                    selection-scope 覆盖门) → reduce(mode='top-percent-analysis' + 披露块)
身份/反混淆:        final.json mode 唯一身份真源 + isFullCoverage:false + 披露块；
                    sampled 输出永不呈现为 task=digest / full coverage
handoff schema:     不变（task 枚举保持 inspect/digest/archive）
```

---

## 8. Unresolved Risks

| # | 风险 | 缓解 |
|---|---|---|
| R1 | tie 超选使 actual coverage 显著超 X%（极端：N=500 全同赞, X=5% → 选 500） | 披露块如实显示 actualCoveragePercent；tie-inclusive 是产品选择（不拆同赞组）；若产品不能接受，改 strict count（需 D2.5 tie-break 配合） |
| R2 | 无 token 计量 → 成本降幅仅 ESTIMATED | T11 dogfood 加入真实计量后校准；T7 决策不依赖精确数值 |
| R3 | X=100 sampled 身份可能让用户困惑（数值全量但标签非 full） | 披露块显式说明「数值覆盖 100%，但这是 top-percent 管线的退化情形，非 hierarchical full digest」；语义稳定性优先 |
| R4 | selection rule 字符串的机器可解析性 | 定义为规范文法（`top-<int>%-by-voteupCount-answerId-asc-tie-inclusive`），T8 实现 + 测试锁定 |
| R5 | verify selection-scope 门需要新 mode 分支，避免误用 full-coverage 门 | T8 实现时门禁参数化 + 反例测试（scope 外引用/缺失 source 必须 fail） |
| R6 | 若未来产品要 handoff 层身份（OPTION A） | 可 additive 后补 task enum + 独立兼容性 review；本包不阻塞 |

---

## 9. PRODUCT_OWNER_DECISION_REQUIRED

```text
STATUS: PHASE A COMPLETE — 等待 product-owner 决策

请对下列完整包逐项 APPROVE / MODIFY / REJECT（可整体或逐项）：

RECOMMENDED_D2_PACKAGE:
  D2.1 ceil
  D2.2 minimum 1
  D2.3 X ∈ [1,100] 整数（禁小数/0）
  D2.4 include entire tie group
  D2.5 (voteupCount DESC, answerId ASC)
  D2.6 X=100 保持 sampled 身份（isFullCoverage:false）
  D2.7 mandatory explicit X（无默认）
  D2.8 mode='top-percent-analysis' + totalAnswers/selectedAnswers/requestedPercent/
      actualCoveragePercent/selectionRule/selectedSourceIds/isFullCoverage:false + ⚠️ 展示层披露块

RECOMMENDED_D6_PACKAGE:
  架构 = OPTION C（Option B 细化）：共享 handoff schema 零变更；corpus 侧 selection.json
  scope（独立可验证）+ 同一 digest 管线以 sampled 身份运行选中子集；final.json mode 身份 +
  isFullCoverage:false + 披露块三重防混淆；SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST 恒定成立。

ALTERNATIVES_REJECTED:
  - D2.1 floor/round（floor 可致空样本；round .5 边界非确定）
  - D2.4 strict count（任意拆同赞组）
  - D2.6 X=100 路由 full digest（身份随参数静默切换，破坏语义稳定性）
  - D2.7 默认 X（隐含 selection rule 不可审计）
  - D6 OPTION A 作为本次主选（触碰共享 schema，需 §10 review；可作未来 additive 后补）

BREAKING_CHANGE: NO
SCHEMA_VERSION_CHANGE: NO（共享 handoff schema 不变；若改 OPTION A 则 YES——additive、需独立兼容性 review）

WHY_THIS_PACKAGE:
  1. 零共享 schema 变更、零 V1/V2 破坏 → 最小爆炸半径；
  2. 身份由 mode 决定而非 X → X=100 也保持 sampled 身份，SAMPLED != FULL 恒成立；
  3. tie-inclusive + (voteupCount, answerId) 全序 → 完全确定性、跨运行可复现；
  4. 披露块三重反混淆 → sampled 输出结构上无法冒充 full digest；
  5. 复用 T6 per-source 管线 → T8 实现面最小，成本随选中子集线性下降（DERIVED ~10× @10%）。

PRODUCT_OWNER_DECISION_REQUIRED: APPROVE / MODIFY / REJECT
```

---

## 附录 A — 本文件的效力边界

- 本文件仅记录 **Phase A 证据与决策包**；不构成 APPROVED / ACCEPTED / FINAL CONTRACT。
- product-owner 批准后进入 **Phase B**（仅更新 authority 文档，如 V0.3 Spec / PBC / project-memory，不实现运行逻辑）。
- T8 仅在 T7 完整（Phase A 批准 + Phase B 归一化 + exact reviewed SHA PASS + ff-only merge）后开始。
- Issue #3 保持 OPEN（top-percent 只是对 large-corpus 成本问题的部分响应，不证明问题已解决）。
- Issue #13 保持 OPEN（Phase A 不关闭）。
