# P1 /toTicket Conformance Audit 01 — P1_TICKET_DECOMPOSITION_V1 vs SHADOW re-derivation

```text
DOCUMENT_ID = P1_TOTICKET_CONFORMANCE_AUDIT_01
STATUS = REVIEW_PENDING
AUTHORITY_CLASS = NON_AUTHORITATIVE_AUDIT_CANDIDATE
AUDIT_ROLE = P1 TOTICKET CONFORMANCE AUDITOR
REVIEWER = ChatGPT（本轮不 spawn 内置 reviewer）

REMOTE_MASTER_AT_AUDIT      = 12788ce60fed39be6436b62525d4ba4d206f2b61
BASE_CANDIDATE_HEAD         = 73b5caba45dff13e17123b22364beb17167e0768
PREVIOUS_REVIEWED_BASE      = 31cce41122515129cf2e18c0a70984851dec00e1
AUDIT_BRANCH                = audit/p1-toticket-conformance-01（自 BASE_CANDIDATE_HEAD 创建）

TOTICKET_ACTUALLY_INVOKED   = YES
TOTICKET_REAL_SKILL_NAME    = to-tickets（环境中真实安装名；与任务所写 /toTicket 存在连字符/
                              大小写差异，已按任务允许记录后使用）
TOTICKET_SKILL_PATH         = /Users/songshiyao/.workbuddy/skills/to-tickets/SKILL.md
TOTICKET_MODE               = SHADOW_GENERATION + STEP4_BATCH_VALIDATION
                              （该 skill 无独立 audit / validate / compare 模式）

CURRENT_TICKET_FILES_MODIFIED = NO
NO_GITHUB_ISSUES_CREATED      = YES
PROJECT_MEMORY_UPDATE_REQUIRED = NO
Date: 2026-08-29
```

---

## 0. Pre-audit remote gate

```text
git fetch origin（走仓库要求代理）
✓ origin/master                = 12788ce60fed39be6436b62525d4ba4d206f2b61（与期望一致）
✓ planning/p1-ticket-decomposition-01 tip = 73b5caba45dff13e17123b22364beb17167e0768（无 drift）
✓ merge-base --is-ancestor(12788ce, 73b5cab) = YES（candidate 合法 descendant of current master）
→ REVIEW_TARGET_DRIFT = NO；未执行任何 rebase / amend / merge / repair。
```

## 1. /toTicket invocation evidence（强制项）

真实 skill 名称：`to-tickets`（目录 `/Users/songshiyao/.workbuddy/skills/to-tickets`）。
本轮通过 Skill 工具实际调用，入参为：

```text
docs/specs/p1-cross-question-deep-research.md
+ docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01.md
— SHADOW decomposition for conformance audit only
  (do NOT publish to any tracker, do NOT modify docs/planning/ files; output to .scratch/ only)
```

调用返回证据：skill base directory = `/Users/songshiyao/.workbuddy/skills/to-tickets`，
完整 SKILL.md 已加载（title "To Tickets"；frontmatter `name: to-tickets`、
`disable-model-invocation: true`）。

**Skill 实际能力（据其定义原文）**：

- 输入：plan / spec / conversation（可带 spec path 参数，读取全文与 comments）；
- 步骤：1 gather context → 2 explore codebase（可选）→ 3 draft vertical slices（tracer bullet、
  每票声明 blocking edges）→ 4 **validate the batch** → 5 quiz the user → 6 publish to tracker；
- step 4 内含三类审计：**dependency audit**（拓扑序、每票仅凭 base state + 声明 blockers 的产出
  即可实现与独立验证；AC 不得依赖未声明的未来票）、**source-contract audit**（双向：每条 source
  需求有明确 disposition；每张 ticket 需求可溯源；不得发明阈值/策略/算法）、
  **constraint audit**（改动/产物/硬约束可同时满足）；
- 发布形态：本地文件 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，或真实 tracker
  （GitHub/Linear）+ `ready-for-agent` 标签。

**关键结论（诚实记录）**：该 skill **没有**独立的 audit / validate / compare 模式，也没有
"对比已有 ticket 集"的能力。因此按任务允许的替代路径执行：
`Approved Spec + Planning Gate → /to-tickets → SHADOW decomposition → conformance diff`。
SHADOW 产物落 `.scratch/p1-shadow-toticket/issues/01..18-*.md`（**untracked，未提交**），
其结构与边集在本文件内复述；本轮**未**发布到任何 tracker、**未**创建 GitHub Issue、
**未**改动 `docs/planning/P1_TICKET_DECOMPOSITION_V1.md` 或 `P1_TICKET_GRAPH_V1.md`。

## 2. SHADOW decomposition（独立重推结果）

18 票 / 23 条边，编号即拓扑序（blocker 编号恒小 → 无环，已用 10 进制解析机械验证：
`non-forward edges: NONE -> ACYCLIC`）。

| Shadow | Ticket | Blocked by |
|---|---|---|
| 01 | Embedding provider qualification（GATE-1） | none |
| 02 | Additional retrieval provider capability discovery（GATE-3） | none |
| 03 | Minimum persisted research plan contract | none |
| 04 | ZhihuDataProvider seam + Official Search adapter + session capture wrapper | none |
| 05 | Research planner semantic proposal | 03 |
| 06 | Multi-query retrieval + RRF candidate fusion | 04, 05 |
| 07 | Research coverage state + retrieval round controller | 06 |
| 08 | Source-group set selection / ambiguity gate | 07 |
| 09 | Multi-group execution state + per-group capture/verify/handoff composition | 04, 08 |
| 10 | Remote embedding egress authority（GATE-2，conditional） | 01 |
| 11 | Embedding provider adapter + cache | 01（local）/ 01+10（remote） |
| 12 | Dense semantic geometry layer | 06, 11 |
| 13 | RCE corpus selector + selection accounting | 09, 12 |
| 14 | Per-group representation + per-group claim extraction | 13 |
| 15 | Cross-group claim/aspect aggregation + cross-source synthesis | 14 |
| 16 | Coverage reconciliation + final synthesis integration + observability | 07, 15 |
| 17 | Additional retrieval provider adapter（conditional） | 02, 04 |
| 18 | End-to-end P1 research acceptance | 02, 16, 17 |

### Conformance diff：SHADOW ↔ CURRENT CANDIDATE

映射：01→T01、02→T03、03→T04、04→T05、05→T18、06→T06、07→T07、08→T08、09→T09、
10→T02、11→T10、12→T11、13→T12、14→T13、15→T14、16→T15、17→T17、18→T16。

```text
23 条 shadow 边逐一比对候选的直接 BLOCKED_BY：
  06←{04,05} → T06←{T05,T18} ✓
  09←{04,08} → T09←{T05,T08} ✓
  12←{06,11} → T11←{T06,T10} ✓
  13←{09,12} → T12←{T09,T11} ✓
  16←{07,15} → T15←{T07,T14} ✓
  17←{02,04} → T17←{T03,T05} ✓
  18←{02,16,17} → T16←{T03,T15,T17} ✓
  05←{03} / 07←{06} / 08←{07} / 10←{01} / 14←{13} / 15←{14} → 全部 1:1 ✓
唯一差异（候选更精确，非 gap）：
  11←{01,10} → 候选 T10 拆为 LOCAL/REMOTE 双路径条件依赖（local 不依赖未激活的 T02）。
```

**独立重推收敛**：两份分解在票集与直接依赖上 1:1 对应，无缺失票、无孤儿票、无 shadow 独有票。
候选相对 shadow 的额外价值：仓库治理元数据（reviewer quorum / model class / risk / evidence /
STOP 条件）与更精确的条件依赖——这些是 repository authority 要求，非 invented governance。

## 3. Requirement coverage matrix（Approved Spec 实现义务 → ticket owner）

| Obligation | Owner | 判定 |
|---|---|---|
| Research Planner（语义生成） | T18 | ✓（R1 已补；T04 仅 contract，未冒充生成器） |
| Research Plan contract / planHash / validation | T04 | ✓ |
| ZhihuDataProvider seam | T05 | ✓ |
| multi-query / multi-provider retrieval | T06 + T03/T17 | ✓（generic 用 fixtures；multi-provider 由 GATE-3/T17 闭环） |
| RRF candidate fusion | T06 | ✓ |
| EmbeddingProvider contract | T01 / T02 / T10 | ✓ |
| dense geometry | T11 | ✓ |
| source-group set selection（§7） | T08 | ✓（与 T12 分离） |
| multi-group execution / resume / manifest | T09 | ✓ |
| capture / verify / handoff composition | T09（经 T05 wrapper） | ✓（既有权威未重实现） |
| ResearchCoverageState | T07（contract/hooks/round infra） | ✓ |
| saturation feedback | T07（mechanics）+ T15（完整 wiring） | ✓ |
| RCE corpus selector（frozen baseline） | T12 | ✓ |
| Question/Source-group representation | T13 | ✓ |
| per-group claim extraction | T13 | ✓（R1 已明确生产者） |
| cross-group Claim/Aspect aggregation | T14 | ✓ |
| cross-source synthesis | T14 | ✓ |
| 100% Analysis Coverage assertion | T15 | ✓（但见 F-2：synthesis 前缺少前置 guard） |
| observability / diagnostics | T07（diagnostics）+ T15（research-level 披露） | ✓ |
| end-to-end acceptance | T16（DOGFOOD） | ✓ |

**无遗漏**：未发现"仅因 prose 写'继承'而漏掉的新 capability"——继承项（verify-output、
make-handoff、canonical schema、chunk/hash/hierarchy、runtime 路由、projection sanitization）
在候选 §B 中显式列为 inherited capability 且确已在生产代码实现。

## 4. Producer → artifact → consumer audit（机械链）

| Chain | Producer | Artifact / interface | Consumer | BLOCKED_BY edge | AC 落点 |
|---|---|---|---|---|---|
| T04 → T18 → T06 | T04 plan contract → T18 语义 proposal | persisted plan + planHash | T06 多 query 检索 | T18←T04；T06←T18 ✓ | T18: 提案经 validation 才成 plan；T06: 按 plan 执行、记录 channel provenance |
| T06 → T07 → T08 | T06 pool | Candidate/Retrieval Pool + provenance | T07 round controller → T08 选择 | T07←T06；T08←T07 ✓ | T07: hooks + round 机制 fixtures；T08: 三分支可测 |
| T08 → T09 | T08 选择 | SelectedSourceGroups[] | T09 逐组执行 | T09←T08 ✓ | T09: 逐组 captured!=verified、resume、manifest 派生 |
| T01/T02 → T10 → T11 → T12 | T01 资格报告（+T02 authority） | 具名 provider/profile + cache identity | T10 adapter → T11 几何 → T12 选择 | T10←T01(+T02)；T11←T10,T06；T12←T11 ✓ | T10: contract 字段 + cache identity；T11: 确定性；T12: 消费几何 |
| T09 + T11 → T12 | T09 verified pool + T11 geometry | selection accounting + corpus identity | T12 产出 Selected Verified Research Corpus | T12←T09,T11 ✓ | T12: preservation + accounting |
| T12 → T13 → T14 → T15 | T12 corpus → T13 表示+claims → T14 聚合+synthesis | group representation / claims / synthesis | T15 对账 + 断言 + 集成 | T13←T12；T14←T13；T15←T14 ✓ | 见 F-2 / F-3 |
| T15 → T16 | T15 完整管线 | 断言 + 披露 + render | T16 dogfood | T16←T15 ✓ | T16: 真实运行机械验证 |

**结论**：每条链均有 producer / artifact / consumer / edge / AC 五要素；无"某 artifact 无人生成"
（Plan 由 T18 生成，T18 已入图）。

## 5. Conditional dependency audit

```text
✓ T02 = REMOTE ONLY，iff T01 提议 remote EmbeddingProvider（候选 §D T02 / T10 已改）
✓ T10 LOCAL : BLOCKED_BY = T01，REQUIRED_EVIDENCE = T01 之 NO_NEW_EGRESS = YES 记录
✓ T10 REMOTE: BLOCKED_BY = T01 + T02，REQUIRED_EVIDENCE = T02 remote egress authority
✓ T01 local 结局须含 repo-tracked NO_NEW_EGRESS = YES
✓ T17 : BLOCKED_BY = T03 + T05（+ D-9 触发后的 scoped Ticket Graph amendment 产出票）
✓ 未激活的 T02 不阻塞合法 local 路径（矩阵与 DAG 均一致）
✓ D-9 触发路径不静默向冻结 DAG 追加票（走 amendment + Contract review + integration）
→ 无 impossible conditional completion。
```

## 6. Security / egress audit

```text
✓ T02 PASS 前，T01 对 remote embedding 只准 synthetic / handcrafted P1-like / neutral / 非敏感
  benchmark fixtures；禁止真实知乎语料、本产品检索源文本、真实 EXTERNAL_CORPUS 出网
✓ 无法代表性 qualification → 报告 REQUIRES_REMOTE_EGRESS_AUTHORITY 并 STOP 该 probe
  （禁止 egress-first / approve-later）
✓ T02 结论须转 repo-tracked authority/evidence（governance + independent review；
  聊天声明/executor note 不足）
✓ credential 不入 plan / state / manifest / events / cache identity / review artifacts（跨票一致）
✓ NO_SILENT_PROVIDER_FALLBACK / NO_SILENT_RUNTIME_FALLBACK / UNTRUSTED_CONTENT /
  DATA_NOT_INSTRUCTION / FAIL_CLOSED / UNKNOWN != PASS 全套继承
✓ 新 browser-scraping / Browser Session platform 无票（T05 明示 OUT_OF_SCOPE）
→ 安全面无 P0/P1 finding。
```

## 7. Ticket-size audit（T09 / T13 / T14 / T15 重点）

| Ticket | 评估 | 判定 |
|---|---|---|
| T09 | 多组状态机 + 逐组 capture/verify/handoff + manifest + resume，内容大，但同属 Spec §6 **一个**执行语义契约边界；拆开会让 "captured != verified 逐组 + checkpoint 复用" 的联合不变式无法在一个 review 单元内验证 | 接受（非 TOO_LARGE，因契约单一）。建议：实现时若单票上下文过大，可由 executor 在票内分行 stage，但**不**拆票 |
| T13 | 逻辑表示 + per-group claim extraction：两个动作但同一 per-group、同一 runtime 调用契约（§8.1 + §5.2），且 T14 强依赖其输出 | 接受（非 MIXED_CONCERNS，理由：同输入、同 runtime、同失败语义） |
| T14 | 跨组聚合 + cross-source synthesis：§8.2 与 §8.3 连续语义契约，聚合是综合的直接前置 | 接受（无一方可独立成票而不产生半成品契约） |
| T15 | coverage 对账 + 100% 断言 + v0.3 集成 + observability：三者相互消费（断言需对账、披露需断言），是唯一有权宣称完整 wiring 的收口票 | 接受（**收口票**，非 HIDDEN_SUBPROJECT）。若未来 review 认为过重，唯一合理切分是"observability/披露"独立成票，但须先证明其可在无断言的情况下独立验收——当前不成立 |

**无 TOO_SMALL / 无微票化**：最小票（T02、T17）为条件性 discovery/adapter 票，其粒度由
外部证据周期与 security quorum 决定，非机械切分结果。

## 8. Acceptance-criteria audit

```text
✓ 每票 AC 为可观察/可测试/证据可验证（无"executor 自我声明即通过"类 AC）
✓ 失败语义处均 fail-closed（plan invalid、dense unavailable、runtime unavailable、
  no valid group set、verification 缺失、selection starving 等）
✓ UNKNOWN != PASS 显式写入 T01 / T03，并被 T10 / T17 的 evidence 要求继承
✓ 数值类（D-4/D-5/D-6）AC 表述为"实现验证 + 记录"，未发明阈值（符合 source-contract audit：
  source 说 measure/validate，ticket 未升级为 invented threshold）
△ T16（DOGFOOD）AC 依赖真实运行 evidence——由 ACCEPTANCE_EVIDENCE_REVIEWER 核验，合理
→ AC 面无 P0/P1 finding（T14 的前置 guard 缺口记入 F-2，属覆盖时序而非 AC 质量）。
```

## 9. Review-boundary / forbidden-regression audit

```text
Reviewer quorum：CODE→1×CODE_REVIEWER；DISCOVERY/EVIDENCE→1×EVIDENCE_REVIEWER；
SECURITY→SECURITY_REVIEWER + CODE_OR_CONTRACT_REVIEWER（同 exact HEAD）；
DOGFOOD→1×ACCEPTANCE_EVIDENCE_REVIEWER —— 与 AGENTS.md §5 一致，无 invented governance。
（to-tickets 模板本身不含 quorum 概念；候选补充的 quorum/risk/model-class 属仓库 authority 要求。）

Forbidden regression 扫描：
  six hard lanes …… 无票 ✓
  mandatory MMR …… 无（T12 仅 optional lightweight redundancy）✓
  global quality score …… 无票（D-8 DEFER_FROM_INITIAL_P1_BASELINE）✓
  vector database …… 无票（cache = flat-file，identity 组成冻结）✓
  universal provider framework / plugin platform …… 无票 ✓
  browser scraping / new Browser Session platform …… 无票 ✓
  P2/P3 …… 无票 ✓
  advanced stopping / xQuAD / DPP / Submodular / LTR …… 无票 ✓
  version assignment …… 无（VERSION_ASSIGNMENT = UNASSIGNED 全程保持）✓
```

## 10. Findings

### F-1（P1）— D-1 决策交接不机械：T01 "候选排序建议" → T10 "T01 选出的 provider" 之间缺少 accepted decision 记录

- 现象：Planning Gate 明确"production EmbeddingProvider / model 不得由 implementation ticket
  自行拍板"；候选 T01 的 IN_SCOPE 写"候选排序建议"、OUT_OF_SCOPE 写"冻结 production model"，
  而 T10 消费的是"**T01 选出的 provider/category**"。
- 风险：GATE-1 evidence → 最终 production provider/model/profile 决定的**决策主体与载体**未具名；
  T10 可能自行从 T01 的排序中挑选，等于把 D-1 决策权下移到 implementation ticket。
- 判定：`GATE-1 evidence → implementation-qualified provider decision → T10 consumer` 链条
  **不够机械**（缺少可独立验证的 decision artifact）。
- 最小修复建议（不自行改票）：① 在 T01 增加一项输出——`accepted provider/model/profile decision
  record`（或明确其 governance 接受主体与 artifact 位置）；② 将 T10 的
  "T01 选出的 provider/category" 改为"T01 accepted decision record 指定的
  provider/model/profile"；③ 该 decision record 与 T02（remote 时）并列为 T10 的
  REQUIRED_EVIDENCE。

### F-2（P1）— T14 缺少 PRE-SYNTHESIS mechanical coverage guard

- 现象：Approved Spec 顺序为 Selected Verified Research Corpus → 100% Analysis Coverage →
  logical group/claim 处理 → final cross-source synthesis。候选把"最终对账 + 断言"放在 **T15**
  （synthesis 之后），而 T14（cross-source synthesis）的 AC 中**没有**要求 synthesis 前先做
  `selected set identity == mapped/analyzed set identity` 的机械 guard。
- 风险：可能在 coverage 未闭合的情况下先产出综合结论，把硬产品合同（100% analysis coverage）
  降级为事后检查；且 T15 事后断言即使失败，综合产物已生成。
- 最小修复建议：为 T14 增加一条 AC——"在跨源综合前，必须消费 T13 的 per-group
  mapped/analyzed accounting，对 selected set identity 与 mapped/analyzed set identity 做
  机械相等校验；不等则 fail closed，不产出 synthesis"。T15 仍保留最终对账与断言（双保险，
  但不是唯一防线）。

### F-3（P2）— BLOCKS / BLOCKED_BY 语义不一致（直接边 vs 传递关系混用）

- 现象：`BLOCKED_BY` 列基本为**直接边**；但 `BLOCKS` 列混入传递关系：
  `T04 BLOCKS "T18, T08"`（T08 的直接 blocker 是 T07，T04→T08 为传递）、
  `T09 BLOCKS "T12, T13"`（T13 的直接 blocker 是 T12）、`T01 BLOCKS "T02, T10"`（未列传递的
  T11/T12）。
- 风险：读者无法机械判定边集性质；后续自动化/审计易误判依赖深度。
- 最小修复建议：在两文件顶部声明 `BLOCKED_BY / BLOCKS = DIRECT EDGES ONLY`，并移除传递项
  （T04→T08、T09→T13）；如确需表达传递影响，另加 `TRANSITIVE_AFFECTS` 字段或明确标注。

### F-4（P2）— analyzed accounting 的单一所有权表述不足

- 现象：T13 负责"per-group mapped/analyzed accounting 更新"，T14 负责"aspect/claim/
  contradiction/**analyzed** 诊断更新"，T15 负责最终对账——"analyzed 集合身份"在 T13/T14 均有
  写入语义，未明确谁是唯一 source of truth。
- 风险：两个 ticket 各自维护 analyzed 状态 → 双重 authority（审计问题 7 点名检查项）。
- 最小修复建议：明确 T13 拥有 **per-group mapped/analyzed set identity**（唯一写入者），
  T14 **只发出诊断信号**（不维护独立 analyzed 集合），T15 仅做最终对账与断言。

## 11. Verdict

```text
VERDICT = CHANGES_REQUESTED

P0 = 0
P1 = 2   （F-1 D-1 决策交接；F-2 T14 pre-synthesis coverage guard）
P2 = 2   （F-3 BLOCKS/BLOCKED_BY 语义；F-4 analyzed accounting 单一所有权）

结构面结论（供 reviewer 参考）：
  - SHADOW 重推与当前 18 票候选在票集与 23 条直接边上 1:1 收敛 → 分解结构本身 CONFORMANT；
  - requirement coverage / producer-consumer / conditional / security-egress /
    ticket-size / quorum / forbidden-regression 七面均无 P0/P1；
  - 两项 P1 均为**最小措辞/契约补丁**（新增一个 decision-record 交接受体、新增一条 T14 前置
    guard AC），不需要重构票集、不重开 Spec、不重开 Planning Gate。

CURRENT_TICKET_GRAPH_MODIFIED = NO
NO_TICKET_REWRITE_REQUIRED = 不适用（因 VERDICT = CHANGES_REQUESTED，不得声明
  CURRENT_18_TICKET_GRAPH = TOTICKET_CONFORMANT / NO_TICKET_REWRITE_REQUIRED = YES）
```

最小修复建议汇总（供下一轮 repair，本轮**未**执行）：

1. T01 增加 accepted provider/model/profile decision record 输出；T10 改为消费该 record（F-1）。
2. T14 增加 pre-synthesis `selected == mapped/analyzed` 机械 guard + fail closed（F-2）。
3. 两文件声明 `BLOCKED_BY / BLOCKS = DIRECT EDGES ONLY` 并移除传递项（F-3）。
4. 明确 analyzed set identity 唯一写入者 = T13，T14 仅发诊断（F-4）。

---

*本文件为 audit candidate，未经独立 review 前不构成 authority。SELF_REVIEW != INDEPENDENT_REVIEW。*
