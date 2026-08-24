# Research Orchestration — Future-Scope Spec（研究编排未来范围）

> **STATUS: PROPOSED / NOT_IMPLEMENTED**
> **VERSION_ASSIGNMENT: UNASSIGNED**
> **IMPLEMENTATION_AUTHORIZATION: NONE**
> **ORIGIN: Issue #5**（`[Dogfood][F4] End-to-end research requires too many manual orchestration steps`）
> **PRODUCT_STAGE: FUTURE_SCOPE**
> **Branch:** `docs/research-orchestration-future-scope`
> **Author handle:** FlapPearLabs
> **Date:** 2026-08-24

本 Spec 明确声明：

```text
This Spec does not start a new milestone.       // 不是 V0.4；不创建任何 V0.4 产物
This Spec does not authorize implementation.    // IMPLEMENTATION_AUTHORIZATION: NONE
This Spec does not change current product behavior. // 不修改 Approved Specs / RULES.md / 产品代码 / 运行时 / 测试
```

本文件是 **PROPOSED FUTURE-SCOPE SPEC**，不是 APPROVED Spec。除非 product owner 后续明确批准并经过所需 independent review，本文件不获得任何 repository authority（`AGENTS.md` §1 / RULES.md §6）。本文件不构成对 `docs/specs/v2-rich-content-fidelity.md` 或 `docs/specs/v0.3-product-scope.md` 的任何 amendment，也不与它们争抢 authority。

---

## 1. Problem Statement

### 1.1 问题（来自 Issue #5，保持原意）

当前仓库的**确定性 primitives 已经可靠工作**，但一个正常的 end-to-end research 工作流仍要求用户**理解并人工编排大量步骤**：

```text
search
→ candidate selection
→ batch capture
→ verify
→ inspect scale/stats
→ sample or handoff
→ corpus processing
→ synthesis
```

该流程在 Production Dogfood 1 期间可行，但需要大量人工编排。用户意图通常只是「research this topic on Zhihu」，却必须理解并手动路由多个实现步骤。`ORCHESTRATION_COMPLEXITY` 是待解决的问题，**不是**：

- capture correctness；
- verifier correctness；
- 新 Agent runtime；
- 新模型能力；
- 新抓取机制；
- 新 canonical data model。

### 1.2 产品目标

把 orchestration complexity 从用户脑中**搬入一个薄的确定性 controller / orchestrator**，而不是重新实现底层 primitives。

### 1.3 核心原则（持久）

```text
ORCHESTRATE_EXISTING_PRIMITIVES        // 编排既有 primitives，不重建
DO_NOT_REIMPLEMENT_EXISTING_AUTHORITIES // 不重实现既有确定性权威（verifier / make-handoff / 验证 gate）
```

### 1.4 已核验的 CURRENT primitives（2026-08-24 现场核对 master 实现，非凭文件名）

**Zhihu 侧（zhihu-answer-grabber）：**

| primitive | 实现 / authority | CURRENT behavior |
|---|---|---|
| `search` | `src/cli.js cmdSearch` + `src/search-answer-count.js`（bounded enrichment） | 返回 candidates[]（含 `answerCount: number \| null`，additive optional；缺失 / `null` 优于虚构；失败不拖累 search） |
| `grab` / `batch` | `src/cli.js cmdGrab / cmdBatch` | capture：stage=`captured`、`verified: false`；resume-merge 语义；断点续传 |
| `verify-output` | `scripts/verify-output.mjs`（`src/verifier.js`，14 项校验） | 产物有效性唯一确定性权威；`valid === true` 唯一授予 verified 路径（`captured != verified`） |
| `make-handoff` | `scripts/make-handoff.mjs` | 确定性 handoff 权威；拒绝 `valid !== true` 产物；禁止手工构造 verified handoff |
| `status` | `src/cli.js cmdStatus` | capture / verification 状态查询 |

**Corpus 侧（corpus-anthology）：**

| primitive | 实现 / authority | CURRENT behavior |
|---|---|---|
| `archive` | `scripts/archive.mjs` | 机械拼接、零改写归档 |
| `popular-sample` | `scripts/popular-sample.mjs` | 按 voteupCount Top N 截断预览，明确标注「不代表整个语料」，非摘要、不进 coverage gate |
| `select` | `scripts/select.mjs` + `lib/top-percent-selector.mjs`（T8 #14） | top-percent 确定性选择 → `selection.json`（`selectorHash` 恒定）；K 合同 / 排序 / strict count 已批准（T7 #13） |
| `chunk` | `scripts/chunk.mjs` | 分块；`--mode top-percent-analysis --selection`、`--hierarchy` 等模式 |
| `map` | `scripts/map.mjs` + `lib/lmstudio-map-executor.mjs` / `lib/deepseek-tool-less.mjs` | per-source tool-less projection map；runtime 路由 additive（默认 `lmstudio-local-tool-less`，`--runtime deepseek-api-tool-less`；不支持 runtime → `capability_isolation_unavailable` fail closed）；任一来源失败 → 整 chunk fail closed |
| `verify` | `scripts/verify.mjs` | coverage / evidence gate（sourceCoverage 全覆盖、stale、cross-chunk evidence 等） |
| `reduce` | `scripts/reduce.mjs` | mode 身份（`digest` / `top-percent-analysis`）；披露块；final.json 消费合同 |
| `render-final` | `scripts/render-final.mjs` | 最终渲染 |
| hierarchical full digest | `scripts/map.mjs --hierarchy` + `lib/hierarchy.mjs`（T10 #16） | OPTION A additive explicit；hybrid lineage；递归覆盖不变量；flat digest 默认不变 |

**已接受的 runtime / controller 边界（`docs/architecture/runtime-strategy.md`，ACCEPTED ARCHITECTURE RECORD）：**

- **Controller owns truth and authority. Model owns semantics.**（controller 拥有 canonical source identity / source coverage / evidence lineage / projection / 结构化校验 / fail-closed / mode identity / disclosure 权威；模型只拥有语义生成）
- **Runtime is replaceable infrastructure, not product identity.**
- `CAPABILITY_ISOLATION_AVAILABLE[lmstudio-local-tool-less] = YES`（local，runtime-scoped）；
  `CAPABILITY_ISOLATION_AVAILABLE[deepseek-api-tool-less] = YES`（provider-specific；云出网仅限 V0.3 T11 公开知乎语料，**不得推广**到私密 / 敏感语料）。
- 无静默 runtime fallback；runtime routing / fallback 是独立产品 / 安全决策（见 §7）。
- `MODEL_QUALITY != RUNTIME_SECURITY`；unsupported / unqualified runtime 不得被静默启用。

---

## 2. Desired User Experience

### 2.1 概念上的未来目标体验（PRODUCT INTENT，非已批准实现）

```text
research <topic>
→ search
→ candidate presentation / selection
→ capture
→ verify
→ handoff
→ analysis pipeline
→ final rendered research result
```

### 2.2 默认用户交互目标（缩减到最少）

1. 输入研究主题；
2. 必要时选择 / 确认一个候选问题；
3. 获取最终结果。

### 2.3 边界：PRODUCT INTENT vs IMPLEMENTATION DETAIL

- 本节描述的是**产品意图**（用户应最少做什么），不是已批准的 CLI syntax / 命令名 / 参数契约。
- 具体用户面命令、参数、输出格式属于 **IMPLEMENTATION DETAIL**，未经 product-owner 批准不得在本 Spec 中武断确定（见 OPEN-R1）。
- 任何 orchestration 都必须保持「重要决策与失败对用户可见」（#5 Desired behavior 原文），不得把编排变成黑盒。

---

## 3. Thin Orchestrator Boundary

### 3.1 Orchestrator MAY（可做）

- sequence existing primitives（按顺序编排既有 primitives）；
- inspect their machine-readable results（读取并解析 primitives 的机器可读结果，优先 `--json` 契约，RULES §11）；
- determine legal next stage（根据结构化结果决定合法下一阶段）；
- maintain resumable orchestration state（维护可恢复的编排状态，见 §8）；
- expose progress（暴露进度）；
- stop on deterministic failures（确定性失败时停止，见 §9）。

### 3.2 Orchestrator MUST NOT（不可做）

- reimplement capture（不重实现抓取）；
- independently redefine valid/verified（不独立重定义 valid / verified 语义）；
- hand-build verified handoff（不手工构造 verified handoff；RULES §14）；
- bypass corpus verification（不绕过 corpus 验证 gate）；
- fabricate source coverage（不伪造 source coverage）；
- silently mutate canonical data（不静默修改 canonical 数据）；
- let an LLM replace deterministic verification authority（不允许 LLM 取代确定性验证权威）。

### 3.3 持久规则

```text
ORCHESTRATOR_COORDINATES   // orchestrator 只做编排与协调
VERIFIER_AUTHORITATES      // verifier（verify-output）是验证权威
```

---

## 4. Authority Preservation

未来 orchestrator 的任何设计 / 实现都必须保留以下既有权威与不变量（来自 RULES.md / Approved Specs / runtime-strategy.md）：

```text
captured != verified                                   // 抓取 ≠ 验收（RULES §4）
verify-output remains validity authority               // verify-output 是唯一确定性验收权威
make-handoff remains deterministic handoff authority   // make-handoff 是唯一确定性 handoff 权威
canonical source identity remains controller-owned     // canonical 源身份归 controller（runtime-strategy §2）
evidence lineage remains mechanically verifiable       // 证据 lineage 保持机械可验证（R10 / T9 hybrid lineage）
SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST               // 采样分析 ≠ 全量 digest（pipeline identity 分离，T7 APPROVED）
MODEL_QUALITY != RUNTIME_SECURITY                      // 模型质量限制不否定能力隔离（RULES §11.1）
unsupported/unqualified runtime must not be silently enabled // NO/UNKNOWN runtime 不得静默启用（V0.3 决策 C）
```

---

## 5. Candidate Selection Gate

> **标记：OPEN PRODUCT DECISION**（本 Spec 不假装已批准一种唯一算法；下列内容为需产品决策的清单与 PROPOSED 方向，不是 APPROVED 合同）

### 5.1 未来需要解决的问题

- search 返回多个 questions 时，**谁选择**（用户 / orchestrator / 模型推荐 / 组合）？
- **human confirmation 是否默认存在**？
- **auto-selection 是否可选**（作为显式 opt-in，而非默认）？
- `answerCount` 如何作为 **scale metadata** 使用（仅展示 / 参与排序 / 参与成本预估）？
- **relevance 与 scale 如何权衡**（搜索 relevance 与回答规模哪个优先）？
- **model recommendation 是否 non-authoritative**（模型只提供建议，不做最终选择）？
- **candidate selection 如何被记录**（selection 决策是否进入可验证状态 / 可回放）？

### 5.2 PROPOSED 方向（非 APPROVED）

```text
PROPOSED: 默认应允许 human-visible candidate selection（用户可见、可确认的候选选择）
PROPOSED: 未来 auto-select 必须是显式 approved behavior（默认不存在自动选择）
```

上述方向为 **PROPOSED / RECOMMENDED**，必须标记 **OPEN PRODUCT DECISION**，不得冒充 APPROVED。

---

## 6. Analysis Mode Selection

> 硬约束：不得因为 corpus 大就静默把 full digest 降成 sample。

### 6.1 必须保留的不变量

```text
SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST
```

- pipeline identity 保持分离：`mode` 是分析模式身份（`digest` / `top-percent-analysis`），覆盖事实（`isFullCoverage`）不得覆盖模式身份（T7 APPROVED 合同）。
- full-coverage 请求必须保持 **100% coverage** + evidence lineage，不得降级为 sample。

### 6.2 Spec 应定义（future implementation contract direction）

- **explicit user mode 优先**：用户显式选择的模式（full digest / top-percent / popular-sample）优先于任何默认路由；
- **full-coverage request 必须保持 100% coverage**：请求全量 digest 时不得静默改用采样路径；
- **sampled mode 必须明确 disclosure**：采样模式必须披露覆盖范围 / 选择规则 / 「不代表全量」；
- **top-percent 不得静默替代 full digest**：除非用户显式选择 top-percent；
- **runtime failure 不得自动改变分析语义**：分析模式选择不得因运行时失败被自动降级。

### 6.3 默认 routing policy

若未来需要「默认自动选择分析模式」，该 routing policy **尚未批准** → 标记 **OPEN PRODUCT DECISION**（见 OPEN-R4），不得在本 Spec 中预先批准。

---

## 7. Runtime Selection / Fallback

### 7.1 引用既有 runtime strategy

- `docs/architecture/runtime-strategy.md`（ACCEPTED ARCHITECTURE RECORD）：**Runtime is replaceable infrastructure, not product identity**。
- `RULES.md §11.1`：capable-runtime first；本地推理仅在已批准 / 实测约束（隐私 / 离线 / 成本 / 时延 / 可用性）下作为阻断性要求。
- `AGENTS.md §11.1` / V0.3 决策 C：capability isolation 逐 runtime 独立门控，NO / UNKNOWN → fail closed，禁止跨 runtime 推导。

### 7.2 未来 orchestrator 不得未经授权

```text
DeepSeek fail → silent LM Studio fallback   // 云失败 → 静默切本地：禁止（未经批准）
local fail    → silent cloud egress         // 本地失败 → 静默云出网：禁止（未经批准）
```

Runtime routing / fallback 是**独立的产品 / 安全决策**，不在本 Spec 内批准。

### 7.3 当前 Spec 默认

```text
NO_SILENT_RUNTIME_FALLBACK
```

除非未来另有明确批准。私密 / 敏感 corpus 的云出网尤其**不能**从 V0.3 公共知乎 dogfood 推导授权（runtime-strategy §5 / #28 STOP conditions；`docs/project-memory.md` V0.3 Runtime Closeout：云出网批准仅限 V0.3 T11 公开知乎语料，不得推广到私密 / 敏感语料）。

---

## 8. Resumable State Machine

未来 orchestration 至少需要**可恢复的 checkpoint** 能力（中断后可继续，不重复已完成的确定性阶段）。

### 8.1 概念状态（可能的状态集；具体 schema / version 留 implementation design）

```text
SEARCHED
SELECTED
CAPTURED
VERIFIED
HANDED_OFF
ANALYZED
RENDERED
COMPLETE
```

### 8.2 持久约束（未来实现必须满足）

- **resume 只能从可验证 checkpoint 恢复**（例如 hash 校验的 stage artifact；`FILE EXISTS != VALID CACHE`，参照 T9 / T10 的 inputHash / childHashes 语义）；
- **stale artifact / incompatible hash 不得静默复用**（参照 T9 resume/stale 向上传播语义）；
- **credentials 不进入 orchestration state**（Cookie / Secret / API key 一律不进状态文件；RULES §1）；
- **machine-private path 不进入 portable public state**（无本机绝对路径 / 用户名；RULES §11 路径脱敏）；
- **state 不得成为新的 canonical source of truth**（canonical 事实仍归 `answers.json` / `selection.json` / final.json 等既有 authority；orchestration state 只是执行进度）。

---

## 9. Failure Semantics

### 9.1 默认原则

```text
FAIL_CLOSED
NO_SEMANTIC_DOWNGRADE
```

### 9.2 示例（确定性失败语义方向）

```text
search failure          → stop
capture failure         → stop / resumable（按既有 capture 断点续传合同）
verify valid=false      → stop（不得把 invalid 当 valid 继续）
handoff invalid         → stop（make-handoff 拒绝 valid !== true 产物）
runtime unavailable     → stop（capability_isolation_unavailable，无静默 fallback）
map/coverage/lineage failure → stop（corpus verify gate 不绕过）
```

### 9.3 明确禁止

```text
full digest failure → silently return sample        // 禁止：全量失败静默降级为采样
runtime failure     → silently change provider/security boundary // 禁止：运行时失败静默切换提供商 / 安全边界
```

---

## 10. Artifact / Observability Contract

未来 orchestration 至少需要让用户 / Agent 知道（**TARGET / OPEN DESIGN**，本 Spec 不无证据硬编码具体 JSON schema）：

- current stage（当前阶段）；
- selected question（所选问题）；
- analysis mode（分析模式）；
- coverage（覆盖范围 / 是否全量）；
- verification status（验证状态）；
- runtime identity where applicable（实际使用的 runtime 身份，参照 T11-R2 节点身份反映真实传输的教训）；
- completion / failure reason（完成 / 失败原因）；
- final artifact references（最终产物引用，relative path / artifact id，无绝对路径）。

具体字段结构、schema version、机器契约属于 OPEN DESIGN（见 OPEN-R6），未经批准不得写死。

---

## 11. Security / Privacy

保留所有既有 credential 边界（RULES §1 / product-behavior-contract §3.14 / runtime-strategy §5）：

```text
Cookie / Secret / API key 不进入 Git
不进入 run state
不进入 model projection
不进入 public logs
LLM 不拥有 controller IO authority（controller 唯一 IO；LLM NETWORK/SHELL/FS/TOOLS 全 DENY）
public Zhihu cloud egress precedent ≠ private corpus authorization
（V0.3 T11 公开知乎语料云出网批准不得推广到私密 / 敏感语料）
```

---

## 12. Non-goals

本 Spec 明确排除（长期约束，非临时建议；RULES §6.4）：

- 不重写 grabber；
- 不重写 verifier；
- 不重写 corpus pipeline；
- 不新增 canonical corpus source；
- 不新增 model / provider qualification（runtime 资格走独立 evidence / qualification ticket，V0.3 决策 C 门控不变）；
- 不做 arbitrary runtime routing（未授权不得自动路由 / fallback）；
- 不重新打开 video（`VIDEO_SUPPORT = DO_NOT_SUPPORT`，V0.3 决策 B 不变）；
- 不实现 browser scraping（V2 / V0.3 既有立场不变）；
- 不启动 V0.4（本 Spec 不创建 V0.4，V0.3 Spec §9 / #6 Tracker 均锁定 NEXT_STAGE 未经授权不得开始）；
- 不在本 ticket 写 production code（本 Spec 是纯 DOCUMENT / FUTURE-SCOPE 产物）。

---

## 13. Acceptance Direction for Future Implementation

> 以下为 **FUTURE IMPLEMENTATION ACCEPTANCE**（未来实现 ticket 的验收方向），**不是**当前 Spec ticket 的 DONE 证明。未来声称「#5 描述的产品问题已解决」之前，实现必须满足以下全部方向：

- **A.** 用户无需理解内部 8–10 个 primitive steps（编排细节对用户透明）。
- **B.** 普通 happy path 目标为：`topic input → at most one necessary candidate-selection gate → final research result`。
- **C.** existing deterministic authorities remain unchanged（verify-output / make-handoff / corpus verify gates 权威不变）。
- **D.** failure / resume semantics mechanically testable（失败与恢复语义可机械测试，不是口头声明）。
- **E.** no hidden sampled/full semantic downgrade（无隐藏的 sample/full 语义降级）。
- **F.** full digest retains 100% canonical source coverage + evidence lineage（全量 digest 保持 100% 覆盖与证据链）。
- **G.** real dogfood demonstrates meaningful reduction in manual orchestration（真实 dogfood 证明人工编排步骤实质性减少）。
- **H.** credentials / security boundaries preserved（凭据 / 安全边界保持）。

---

## 14. Open Product Decisions

以下行为**尚未批准**，本 Spec 不偷偷解决；product owner 后续须显式决策（经相应 independent review）后方可成为合同：

```text
OPEN-R1: exact user-facing command / interface        // 用户面命令 / 接口形态
OPEN-R2: default candidate-selection behavior         // 默认候选选择行为（human 默认？）
OPEN-R3: auto-select policy                           // 自动选择策略（是否允许 / 何时允许）
OPEN-R4: default analysis mode                        // 默认分析模式 / routing policy
OPEN-R5: runtime selection / fallback policy          // 运行时选择 / 回退策略
OPEN-R6: persistent run-state schema                  // 持久化 run-state schema / version
OPEN-R7: progress / cancellation UX                   // 进度 / 取消交互
```

---

## 15. Relationship to Issue #5

- **Issue #5 是最早的 loose product-problem record**：`[Dogfood][F4] End-to-end research requires too many manual orchestration steps`（OPEN，label: enhancement，P3 — workflow ergonomics）。
- **本 Spec 是其规范化 successor**：把 #5 描述的 ORCHESTRATION_COMPLEXITY 问题正式化为可审查、未授权实现的 future-scope Spec。
- **Spec merge 后**，#5 **MAY be closed as**：

```text
NOT_PLANNED / SUPERSEDED_BY_SPEC
```

**而不是 `COMPLETED`**。理由：需求没有被实现；只是从 loose Issue 迁移到正式 future-scope Spec。

- **Future implementation ticket(s) must reference this Spec** 并在声称 feature 存在前满足 §13 的 acceptance direction。
- 在当前阶段：#5 **保持 OPEN**，直到本 Spec 的 review / merge 决策完成。

---

## 附录 A：本 Spec 的 authority 边界（PHASE 4）

本文件当前仅为：

```text
PROPOSED FUTURE-SCOPE SPEC
```

- **不是 APPROVED**；不携带任何 repository authority；
- 不修改 existing Approved Specs（V2 / V0.3）；
- 不修改 RULES.md；
- 不修改 product behavior implementation / runtime code / source / tests；
- 不修改 `docs/project-memory.md`（其中 #5 / NEXT_STAGE 相关记录当前准确：`研究流程自动化（research pipeline automation）：NEXT_STAGE，非当前 V0.3 范围`；无 stale / conflicting durable state 需要修复）。

若 product owner 后续明确批准，并经过所需 independent review（Approved Spec / governance authority change 需 `CONTRACT_REVIEWER + CONSISTENCY_REVIEWER` 同 exact HEAD PASS，AGENTS.md §5.1），本文件才可升级为 APPROVED 并进入未来实现 ticket 分解。
