# P2_ARCHITECTURE_READINESS_AUDIT_SUPPLEMENT

> **产物溯源**：本文是 #107–#112 的 P2 架构就绪审计产物，审计基线 `9c60ae56610498f1cf782c0c36bfc9f8c0642051`（remote master 实时值）。
> 审计过程为只读：未写产品代码、未创建 Spec / ADR 文件 / Ticket / PR、未修改 #107–#112、未修改 P1 历史事实。
> 本机绝对路径已按 `RULES.md` §11 脱敏。审计期间使用的 detached 工作树不进入本仓库。


> 类型：FINDING_SCOPED_SUPPLEMENT · READ_ONLY · NO_PRODUCT_IMPLEMENTATION · NO_TICKET_DECOMPOSITION · NO_REPO_MUTATION
> 基线锁定（未切换）：`AUDIT_BASE_SHA = 9c60ae56610498f1cf782c0c36bfc9f8c0642051`
> 本补充只修三处 finding（A / B / C）+ 一处术语归一（D）。原审计正文未被改写；凡与本文冲突处，**以本文为准**。

---

## A. Grill Execution Evidence

```text
GRILL_SPEC_SKILL_DISCOVERY = NOT_FOUND
EXACT_SKILL = NONE
SKILL_INSTRUCTIONS_READ = YES（读到的是 grill 家族真实说明，见下）
PREVIOUSLY_USED = NO
SUPPLEMENTAL_GRILL_EXECUTED = YES
NEW_GRILL_BLOCKER = NONE
```

### A.1 机械取证（不是凭记忆）

| 检查 | 命令/方式 | 结果 |
|---|---|---|
| 精确名 `grill-spec` 目录 | `ls -d ~/.workbuddy/skills/grill-spec` | `No such file or directory` |
| 精确名 `grill-ticket` 目录 | `ls -d ~/.workbuddy/skills/grill-ticket` | `No such file or directory` |
| 全盘 find `*grill*` / `*spec-review*` / `*ticket-review*` | `find ~/.workbuddy /Applications/WorkBuddy.app/.../plugins -maxdepth 6 -type d -iname "*grill*"` | 仅 4 个目录，无 `grill-spec` |
| 实际存在的 grill 家族 | `ls -d ~/.workbuddy/skills/*grill*` | `batch-grill-me`、`grill-me`、`grill-with-docs`、`grilling` |

```text
EXACT_SKILL_PATH（真实存在的 grill 原语）=
~/.workbuddy/skills/grilling/SKILL.md
EXACT_SKILL_PATH（包装器）=
~/.workbuddy/skills/grill-me/SKILL.md
~/.workbuddy/skills/grill-with-docs/SKILL.md
~/.workbuddy/skills/batch-grill-me/SKILL.md
```

### A.2 真实说明已读（`grilling/SKILL.md` 全文 13 行，关键指令）

- "Interview me relentlessly about every aspect of this until we reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one."
- "Ask the questions one at a time, waiting for feedback on each question before continuing."
- **"If a *fact* can be found by exploring the environment (filesystem, tools, etc.), look it up rather than asking me. The *decisions*, though, are mine — put each one to me and wait for my answer."**
- "Do not act on it until I confirm we have reached a shared understanding."

三个包装器均为 `disable-model-invocation: true`；其中 `grill-with-docs` 会在过程中**产出 ADR 与 glossary**（本次 §5 明令禁止创建 ADR 文件，故不得调用）；`grilling` 要求逐问等待用户作答（不适配自主只读审计）。

**因此本次的执行方式（不伪造流程、不越权）：**

1. 采用 `grilling` 原生方法的**事实分支**：凡"事实"一律自己去仓库里查（本次 5 项新事实全部落到 file:line，见下）。
2. 凡"决策"一律**不替 product owner 回答**，只作为 OPEN_DECISION 列出 —— 严格遵守 "The decisions are mine"。
3. **不调用** `grill-with-docs`（会写 ADR/glossary）、**不调用** `to-spec` / `to-tickets`（会写 tracker）。
4. grill ≠ architect：下文只产出 finding 与"必须进决策记录"的条目，**不提出新系统设计**。

```text
PREVIOUSLY_USED = NO
证据：原审计 §1 明确记录"本环境不存在 grill-spec / grill-ticket …… 因此本次不使用这些 skill，
改为手工施加 grill 纪律"。即：原审计知道它们存在、并刻意未执行 → 不是"已执行但无记录"。
```

### A.3 补充 grill findings（范围严格限制 #108 / #109 / #111）

> 未 grill #107 / #112（当前只允许实验，且 #112 已限定 E0/E1/E1-D）；未 grill #110（DESIGN_ONLY）。

---

**FINDING_ID = G-A1**
**ISSUE = #108（连带 #109）**
**CLAIM =** 定向/探针查询字符串会落在既有产物安全信任边界之外，而该边界目前只信任"计划内查询原文"。
**REPO_EVIDENCE =**
- `rrf.mjs:642-651`：`trustedPlanStrings` 定义为"EXACT strings that are plan-owned content already validated by the T04 plan contract at ingestion (`validated.plan.queryVariants`)"，并明示"It is NOT a general caller-defined trust bypass"；任何其它字符串"is checked with the full provider-content lens"。
- `retrieval.mjs:759-762`：`trustedPlanStrings: new Set(validated.plan.queryVariants)`。
- `rrf.mjs:636-640`：持久化前对**整个 pool** 做 whole-artifact walk，防止 provider/caller-controlled 值进入产物。
- `retrieval.mjs:547`：检索只执行 `for (const query of validated.plan.queryVariants)`。
**WHY_CURRENT_CONTRACT_IS_INSUFFICIENT =** 现有信任分类只有两档：`plan-owned`（白名单精确匹配，且仍过 T04 复核）与 `provider-content`（默认不信任）。#108/#109 的动态查询字符串**两档都不是**：它不是 provider 返回的，也不是 `queryVariants` 成员。要么改 plan（→ planHash 变化，原审计已列为阻塞），要么新增"controller 授权的动态查询"信任档 —— 后者是与 T10 default-deny、T13 safe projection 同类的**安全/权威决策**，不能由施工 Agent 自行创设。
**SEVERITY = P1（不升 gate，但必须写进决策记录）**
**ACTION_REQUIRED =** 把"动态查询字符串的信任归类（plan-owned 扩展 / 新信任档 / 禁止）"列为 #108 决策记录的必答项；并在 seam contract 的 failure semantics 中写明：未归类字符串一律 fail closed，不得"假装已授权"。

---

**FINDING_ID = G-A2**
**ISSUE = #108（连带 #109）**
**CLAIM =** 预算与 saturation 判定都以"计划路由"为分母，动态路由会改动这个分母，而该语义无人定义。
**REPO_EVIDENCE =**
- `retrieval-round-controller.mjs:242`：`cumulativeAttemptsCount = 已执行路由 + 本轮路由 + 已发生失败 + 本轮失败`（跨轮累计）。
- `:288`：`cumulativeAttemptsCount >= maxQueryBudget(默认 10)` → `BUDGET_STOP / query_budget_exhausted`。
- `:305-306`：saturation 前置条件 `cumulativeAttemptsCount >= totalPlannedRoutes`，其中 `totalPlannedRoutes = coverageState.retrieval.plannedRoutes.length`。
- `coverage-final-integration.mjs:267`：`plannedQueryVariants` 一次性由 plan 生成。
**WHY_CURRENT_CONTRACT_IS_INSUFFICIENT =** 今天 `plannedRoutes` 是**一次性静态集合**。动态路由一旦存在，就必须回答：它是否计入 `plannedRoutes`？若计入，"全部计划路由已尝试"这个 saturation 前置条件会被动态路由永久推迟（可能永不 SATURATED）；若不计入，它消费的是否是同一个 `maxQueryBudget=10`？这两种选择都会直接改变 STOP 行为，而 STOP 权威属 controller，当前合同未定义。
**SEVERITY = P1（不升 gate，必答项）**
**ACTION_REQUIRED =** 决策记录必须写明：动态路由是否并入 `plannedRoutes`、是否共享 `maxQueryBudget`、是否有独立 reserve（#109 的"probe budget 已保留"触发条件依赖此答案）。

---

**FINDING_ID = G-A3（更小机制）**
**ISSUE = #109（连带 #108）**
**CLAIM =** #109 的两个核心探针族（COUNTER_THESIS / ALTERNATIVE_TERMINOLOGY）已由 planner 产出，但**基线从未把它们当查询执行**；先执行"已计划但未执行"的字符串，是远小于"自由生成探针查询"的机制。
**REPO_EVIDENCE =**
- `plan-contract.mjs:85-94`：plan 含 `queryVariants / aspects / entities / opposingFramings / terminologyVariants / sourceGroupIntents`；`planner.mjs:197-208` 的 schema 说明中 `opposingFramings` 示例为"Agent 仍不成熟"，`terminologyVariants` 示例为 `{term: "Agent", variants: ["智能体"]}`。
- `retrieval.mjs:547`：**只有** `queryVariants` 被执行为查询。
**WHY_CURRENT_CONTRACT_IS_INSUFFICIENT =** #109 的 MVP 描述默认"生成新的探针查询"，但仓库事实是：反方表述与术语变体**已在 plan 里、已过 T04 校验、只是没被执行**。走这条路可以把 G-A1 的信任问题缩小为"把 `trustedPlanStrings` 从 `queryVariants` 扩展到其它 plan-owned 字符串字段"（plan-owned 档内部扩展），而不是"为自由文本创设新信任档"。
**SEVERITY = P2（更小机制发现，非阻塞）**
**ACTION_REQUIRED =** 在实现自由文本探针生成之前，先评估"执行已计划的 opposingFramings / terminologyVariants"这一变体；它同时也是 #109 不必被 #108 硬阻塞的技术依据（见 B 节）。

---

**FINDING_ID = G-A4**
**ISSUE = #111**
**CLAIM =** 已存在 controller-owned 的作者身份载体 `authorRef`，#111 的 derived 变体应挂靠它，而不是新建身份面；但它只承载"同一作者"，不承载专业性/权威性。
**REPO_EVIDENCE =**
- `rce-provenance-adapter.mjs:246-260`：`authorRef = 'author-' + sha256('zhihu-author:' + 去空格作者串)[:16]`；缺失 → `null`（"DISCLOSED unresolvable identity — never fabricated"）。
- `:263-288`：`buildRealAuthorRefResolver` 由 controller 注入；未知 canonicalSourceId → fail closed；值在 claim 装配处再次 shape-check。
- `:44-46`：**模型永不创建 authorRef**（runtime schema 拒绝该 key）。
- `cross-group-aggregation.mjs:83-87,121`：`authorRef` 已作为 claim 的 controller-owned carrier 参与聚合；`coverage-final-integration.mjs:690` 注入 resolver。
**WHY_CURRENT_CONTRACT_IS_INSUFFICIENT =** `authorRef` 只解决"同一作者/不同作者"的身份同一性，**不含** AUTHOR_TOPIC_EXPERTISE、topic-conditioned expertise、机构权威性、新鲜度等语义。#111 MVP 若把"权威性"从 `authorRef` 推出，等于把身份当权威（正是 Issue §5 禁止的"popularity ≠ expertise"同类错误）。
**SEVERITY = P2**
**ACTION_REQUIRED =** derived 变体只应做两件确定性可做的事：(a) 用 `authorRef` 做同源重复/独立性判定（这正是 Issue §7 "十篇转载不算十次独立佐证"的确定性子集）；(b) 专业性/权威性一律输出 `UNKNOWN`，直到出现确定性信号。禁止让模型生成权威性标签后写进 canonical claim。

---

**FINDING_ID = G-A5**
**ISSUE = #108**
**CLAIM =** "不得无限重复语义等价查询"这条要求与**现有轮次语义直接冲突**，需要显式区分。
**REPO_EVIDENCE =** `runRetrievalFeedbackLoop` 每轮用同一 plan 调 `runMultiQueryRetrieval`（`coverage-final-integration.mjs:307-325`），即**基线本身就在每轮重复执行完全相同的查询**；去重只在结果侧（`accumulated` 按 questionId 取最优 rrfScore，`:315-316`）。
**WHY_CURRENT_CONTRACT_IS_INSUFFICIENT =** 现有合同"允许计划内重复执行"，但完全没有"定向查询重复"的概念。若照搬 #108 §7 的文字，施工 Agent 无法判断：同一 gap 第二次触发同一 query 属于"计划内重复"（合法）还是"必须收敛的重复"（违规）。
**SEVERITY = P2**
**ACTION_REQUIRED =** 决策记录需给出一条可机检的判据（例如：以 gap_id + query 归一化串 + 已尝试次数为键的有界重试上限），而不是一句"不要无限重复"。

---

```text
NEW_GRILL_BLOCKER = NONE
理由：G-A1 / G-A2 是 #108 决策记录里**新增的必答项**，而 #108 的 gate 已经是
C. NEEDS_ARCHITECTURE_DECISION —— gate 不变，只是决策清单变长。
G-A3 是更小机制（支持 B 节结论，不升 gate）；G-A4 / G-A5 是范围澄清（不升 gate）。
没有一项把 #108 / #109 / #111 推向新的 gate。
```

---

## B. #109 Dependency Correction

```text
TECHNICALLY_HARD_BLOCKED_BY_108 = NO
ARCHITECTURALLY_PREFERRED_DEPENDENCY = #108
REVISED_NEXT_GATE = H. BLOCKED_BY_OTHER_P2
  ├─ 语义限定 = ARCHITECTURAL_PREFERRED_DEPENDENCY（WAIT_FOR_108_ARCHITECTURE）
  └─ 不是 TECHNICAL_HARD_DEPENDENCY
```

### 为什么不是技术硬依赖（证据）

1. **检索执行原语已存在且可复用**：`lib/provider-seam.mjs`（`CAPABILITY_SEARCH`）+ `official-search-provider.mjs` / `global-search-provider.mjs` + `runMultiQueryRetrieval`。#109 只需在 STOP 边界多跑一组路由，不需要 #108 的 gap object / gap 状态机。
2. **探针意图可来自 plan 已有字段**（G-A3）：`opposingFramings` / `terminologyVariants` 已是 plan-owned、已过 T04 校验的字符串 → 无需 #108 的"gap → query proposal"链路即可表达 COUNTER_THESIS / ALTERNATIVE_TERMINOLOGY。
3. **融合/去重/RRF 都可原样复用**，#109 不触碰 SEAM A–D。

### 为什么仍是架构上应当等 #108（证据）

若 #109 先做，它必须**先自行定义**下面这些语义，而它们恰恰是 #108 必须一次性建立的东西：

| 语义 | 若 #109 自创的后果 |
|---|---|
| 动态查询字符串信任归类（G-A1） | 与 #108 后来定的分类不一致 → 双重分类 |
| 动态路由是否并入 `plannedRoutes` / 预算（G-A2） | 两套 STOP 语义、两套预算口径 |
| lineage 与 resume 绑定（`CHECKPOINT_BINDING_*` 扩展） | 两套恢复闭包 |
| "material new evidence" 的判定信号 | 两套 material-gain 真相源 |
| STOP 可重开（revoke）转移规则 | 两套 transition authority |

这正是用户给出的候选结论：

```text
REASON =
implementing #109 first risks independently inventing
dynamic query execution / lineage / budget / resume semantics
that #108 should establish once and reuse.
```

**该结论成立**，且与 Issue 自身一致：#109 §6 "Escape Probe should reuse #108 retrieval execution and lineage primitives"；#109 §12 Non-goals 明列"a second retrieval/fusion pipeline"。

### 关于 gate 命名的精确化

- 在既有 8 类 taxonomy 内，唯一表达依赖关系的门是 **H**。
- 但 H 的字面（BLOCKED）会被读成"技术上做不了"。**正确读法是 `WAIT_FOR_108_ARCHITECTURE`**，即：可以做，但先做会造成语义重复与第二条管道。
- 因此本补充给出：**REVISED_NEXT_GATE = H**，并附带 `DEPENDENCY_SEMANTICS = ARCHITECTURAL_PREFERRED`（非 TECHNICAL_HARD）。
- 若希望在 taxonomy 里让这个区别可见，应把 `WAIT_FOR_108_ARCHITECTURE` 登记为 H 的具名子状态 —— 这属于 governance 措辞变更，需按 RULES §9/§15 走独立 review，**本补充不擅自改 taxonomy**。
- 另：**#109 应与 #108 在同一份决策记录里一并冻结**（见 D 节），因此它不需要一个独立的 C 门。

---

## C. Architecture Decision Record Semantics（ADR 术语归一）

统一概念：**`ARCHITECTURE_DECISION_RECORD_REQUIRED`**（不是 `ADR_DIRECTORY_REQUIRED`）。
判定标准：**这个决定以后是否不应该让 Agent 自行重新发明？** 只有 YES 才需要 durable record。
仓库当前可接受的载体：**`docs/architecture/key-decisions.md`**（叙事决策日志：问题 → 决策 → 为什么 → 代价 → 演进；已有 D02 controller-owns-truth、D03 canonical raw、D09 manifest derived、D10 single-writer 等同级先例）。不新建 ADR 目录/模板/命名约定。

| Issue | ARCHITECTURE_DECISION_RECORD_REQUIRED | AUTHORITY_VEHICLE | WHY |
|---|---|---|---|
| **#108** | **YES** | `key-decisions.md` + `docs/planning/P1_SEAM_CONTRACTS_V1.md`（新增 seam/contract 条目）+ `docs/specs/p1-cross-question-deep-research.md`（amend，非新 Spec） | 至少有 6 项未来 Agent 不得自行重选：gap derived/canonical、CoverageState owner 扩展、planHash 绑定策略、轮次重入模型、**动态查询信任归类（G-A1）**、**动态路由与 plannedRoutes/预算关系（G-A2）**；另加 cost 预算归属与 recovery 绑定扩展。 |
| **#109** | **YES（与 #108 合并进同一份记录）** | 同上（与 #108 同一条记录，不单独成篇） | 它自己的必答项（STOP_CANDIDATE 对象化、material-gain 判定信号、probe 撤回转移规则、probe budget reserve）与上表 6 项高度重叠；单独成篇会产生两份互相漂移的语义。 |
| **#111** | **NO（derived 变体）** | 无需新记录；产物为非 canonical 的独立 artifact | derived 变体不改 SEAM B/C、不改 `selectedCorpusIdentity`、不改 owner、可复用既有 `authorRef` carrier → 没有需要冻结的权威选择。 |
| **#111** | **YES（一旦被 claim layer 或 selector 消费）** | 现有 seam contract（SEAM C / SEAM B）+ 相应 Spec（**不是** key-decisions.md 单独承载） | 消费即意味着：claim 结构变更（frozen kinds）、`selectedCorpusIdentity` 与 T12 selection accounting 变更、resume 绑定变更 → 属 canonical 表示与 owner 变更，必须冻结。 |

补充一句以防误解：**#108/#109 需要的是"决策被冻结"，不是"新增 ADR 制度"**。原审计的这一判断维持不变，且已作为待 product owner 确认项列出。

---

## D. Review Status（真实性校正）

```text
HY4_PRIMARY_AUDIT = COMPLETE_SELF_AUTHORED（不得写 PASS）
INTERNAL_FALLBACK_REVIEW = PASS_WITH_NONBLOCKING_FINDINGS（不得冒充 Codex gate）
CODEX_FINAL_GATE = PENDING_BLOCKED
REVIEWED_SHA = 9c60ae56610498f1cf782c0c36bfc9f8c0642051
```

| 项 | 真实状态 |
|---|---|
| HY4_PRIMARY_AUDIT | 已交付。按 `RULES.md` §8「`SELF_REVIEW != INDEPENDENT_REVIEW`」与 §9，**自审不构成 PASS**；只能记为 COMPLETE（自著），等待独立 gate。 |
| INTERNAL_FALLBACK_REVIEW | 由职责隔离的 INTERNAL_INDEPENDENT_REVIEWER 在同一 exact SHA 上 fresh-read 完成，结论 `PASS_WITH_NONBLOCKING_FINDINGS`，六张票全部 AGREE、12 项代码级声称全部 CONFIRMED。**它是合理 fallback，但不等同 Codex gate。** |
| CODEX_FINAL_GATE | **PENDING_BLOCKED**。外部 Codex 路由共失败 3 次（2 次正式 `codex exec` + 1 次可用性探测，探测时间 2026-09-24 12:47 本地），均返回 `usage limit ... try again at 1:15 PM`，退出码非 0。 |
| CODEX_FINAL_VERDICT | **不得写 PASS**。只有 Codex 真正在 `9c60ae5...` 上完成 fresh review 后，才可由其产出 `CODEX_FINAL_VERDICT`。 |

### 额度恢复后如何补做（无需重做本审计）

保留 `codex-review-prompt.md`（自包含、已含全部 load-bearing claims 与输出格式）。恢复后直接执行：

```bash
cd ~/WorkBuddy/p2-readiness-audit-scratch
codex exec -s read-only \
  -C ~/WorkBuddy/p2-readiness-audit-scratch \
  --skip-git-repo-check "$(cat codex-review-prompt.md)" > codex-run.log 2>&1
```

需在 prompt 中追加一句（本补充新增事实，未写入原文件）：请 Codex 额外核验 G-A1（`rrf.mjs:642-651`、`retrieval.mjs:759-762`）、G-A2（`retrieval-round-controller.mjs:242/288/305-306`）、G-A3（`retrieval.mjs:547` vs `plan-contract.mjs:85-94`）、G-A4（`rce-provenance-adapter.mjs:246-288`）。

---

## E. Revised Readiness Table

原结论**无变化**。本次唯一改动的单元格是 #109 的**语义限定**（gate 字母不变）：

| Issue | Type | NEXT_GATE | 本次补充 |
| ----- | ---- | --------- | -------- |
| #107 | Evaluation infra (bypass) | **A. READY_FOR_EXPERIMENT** | 不变（本次未 grill） |
| #108 | Production retrieval extension | **C. NEEDS_ARCHITECTURE_DECISION** | 不变；决策清单 +2（G-A1 动态查询信任归类、G-A2 路由/预算与 plannedRoutes 关系）+1 澄清（G-A5 重复判据） |
| #109 | Stop-boundary policy | **H. BLOCKED_BY_OTHER_P2** | gate 不变；语义校正为 `ARCHITECTURAL_PREFERRED_DEPENDENCY`（WAIT_FOR_108_ARCHITECTURE），**非**技术硬依赖（依据：G-A3 + provider-seam 可复用） |
| #110 | Orchestration (future) | **G. DESIGN_ONLY** | 不变（本次未 grill） |
| #111 | Evidence model | **A. READY_FOR_EXPERIMENT**（严格限定 derived 变体） | 不变；新增 derived 变体的落地方式：挂靠既有 controller-owned `authorRef`（G-A4），权威性/专业性一律 UNKNOWN |
| #112 | Off-path causal experiment | **A. READY_FOR_EXPERIMENT** | 不变（本次未 grill） |

原表 "ADR" 列请统一读作 `ARCHITECTURE_DECISION_RECORD`；取值与载体见 C 节。

---

## STOP

本补充到此停止。**未**创建 Spec / ADR 文件 / Ticket / branch / PR，**未**写产品代码，**未**推进 #110，**未**推进 #112 的 BM25/FTS，**未**把 grill 提出的问题升格为新的 gate。
等待 product-owner 下一步授权。
