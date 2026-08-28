# P1 Architecture Spec Preparation — Review Packet for ChatGPT

```text
DOCUMENT_ID = P1_ARCHITECTURE_SPEC_PREPARATION_REVIEW_PACKET_FOR_CHATGPT
TASK_ID = P1_ARCHITECTURE_SPEC_PREPARATION_01
BRANCH = spec/p1-architecture-spec-prep-01
BASE_SHA = 196db3d9775e33ff8cd6bf4e218ba4313630a923 (dg01-decision-grade-gate, frozen)
```

> 本 packet 是给独立 reviewer（ChatGPT）的完整审查交接材料。审查对象是
> `P1_CROSS_QUESTION_RESEARCH_ARCHITECTURE_SPEC_DRAFT_01.md`（同目录）。审查通过前的状态：
> `P1_ARCHITECTURE_SPEC_DRAFT_01 = REVIEW_PENDING`。

---

## A. Review Request

请对 P1 Architecture Spec Draft 01 做正式架构审查。审查问题（按优先级）：

1. **Authority 一致性**：Draft 的每个架构决策是否可回溯到 frozen authority（00/01/02/04/07/09 + Approved Specs）？有无越权拍板？
2. **Seam map 真实性**：§2 CURRENT_V0_3_SEAM_MAP 对 v0.3 代码的描述是否与实际代码一致（reviewer 可对照仓库源码核验）？
3. **Frozen selector 落位正确性**：§3 四组件 + §4 六维度 relocation 是否忠实于 09 amendment，无重新引入 six hard lanes / B2 as-is？
4. **边界完整性**：§5 A–M 十三个边界是否覆盖了 P1 架构的全部必要面？有无缺失或越界？
5. **Caveats 存活**：§7 七条 evidence caveats 是否完整、无弱化？
6. **OPEN_DECISION 纪律**：§9 九个 OPEN 决策是否恰当——有无本应 OPEN 却被拍板的？有无已被 authority 解决却仍标 OPEN 的？
7. **过度设计审计**：§6 排除清单与 §10 自审是否成立？

## B. Scope of This Review

**In scope**：架构 Draft 的正确性、authority 一致性、v0.3 seam 真实性、边界完整性、caveats 完整性、OPEN_DECISION 纪律、过度设计审计。

**Out of scope**（审查中请勿展开，也不构成授权）：

- production implementation（TARGET_STATUS = NOT_IMPLEMENTED）；
- selector 具体实现 / 参数选择；
- 新 benchmark / 新 Gold / 新实验设计；
- P2（Temporal）/ P3 的设计或实现；
- Ticket decomposition;
- PR merge / 版本号分配 / Approved Spec promotion。

## C. Authority Chain（审查时的事实基准）

| Level | Source（relative to repo root） | Role |
|---|---|---|
| 0 | `RULES.md`、`AGENTS.md` | hard invariants + workflow |
| 1 | `external-audit/2026-08-27/chatgpt-context/authority_sources/00_SOURCE_AUTHORITY_AND_STATUS.md` | authority 状态源 |
| 1 | 同目录 `01_PRODUCT_DIRECTION_FINAL.md` | 产品方向 / THIN-ADAPTER-REUSE / Controller-Model 分离 / Coverage 三分 |
| 1 | 同目录 `02_RESEARCH_COVERAGE_ENGINE_FINAL.md` | RCE 设计（selector/六维度部分被 09 覆盖） |
| 1 | 同目录 `03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL.md` | Temporal（P1 边界外，仅背景） |
| 1 | 同目录 `04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md` | 算法决策 A01-A08 / D01-D17（§8 被 09 更新） |
| 1 | 同目录 `07_RESEARCH_SECURITY_AND_CROSS_SOURCE_SYNTHESIS_GUARDRAILS.md` | 安全与跨源合成 guardrails |
| 1 | 同目录 `09_RCE_DESIGN_AMENDMENT_01.md` | **P1 selector frozen amendment（本 Draft 的核心 authority）** |
| 1 | `docs/specs/v2-rich-content-fidelity.md`（Approved） | 三层内容模型 / trust boundaries |
| 1 | `docs/specs/v0.3-product-scope.md`（Approved additive amendment） | v0.3 范围 |
| 1 | `docs/product-behavior-contract.md` | 行为归一化视图 |
| 1 | `docs/architecture/runtime-strategy.md`（Accepted record） | runtime/provider-neutral 架构记录 |
| 2 | `05`/`08` authority sources、`evidence-gate-01/` | evidence only |
| 3 | `06` authority source | 历史背景 |

**09 覆盖关系**：09 在 selector baseline / Question-Source-group preservation / Popularity role / Dense semantic role / Redundancy-control role / Six-lane relocation 范围内覆盖 02/04 的对应条款。

## D. Current Authority State（from 00）

```text
P1_EVIDENCE_GATE = PASS_WITH_CAVEATS
RCE_DESIGN_AMENDMENT_01 = DESIGN_FROZEN_AMENDMENT
ARCHITECTURE_SPEC_PREPARATION = AUTHORIZED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
```

## E. Frozen P1 Selector Baseline（from 09）

```text
Question/Source-group Preservation
+ Popularity Anchor
+ Dense Semantic Relevance / Novelty
+ Optional Lightweight Redundancy Control
```

禁止：six hard selector quotas；ship B2 as-is。

## F. Six Information Dimensions Relocation（from 09）

Mainstream → retrieval/soft popularity；Expert → retrieval + topic-conditioned soft；Evidence-rich → retrieval + soft；Fresh → retrieval/time policy + diagnostic；Long-tail → soft marginal-value/novelty；Contradictory → opposing-query generation + claim-stage diagnostic。**Relocated, not deleted.**

## G. Evidence Gate Summary（from 09, caveats 全文见 Draft §7）

- 两个 real-domain cases、216 captured sources、B0/B1/B2/B3 四策略、47 labels 第二 adjudication。
- OUTCOME A（PROCEED_WITH_SIMPLIFICATION）：B2（anchor+preservation 型）相对优势成立——must-see 3/13 vs B3 4/13、aspect .857 vs .714、minority min .050 vs .000、redundancy .852 vs .825、relative ops 380 vs 8445。
- 但 medical must-see 上 B3 占优、partial blinding 污染、two-case 局限等 caveats 必须存活。

## H. Current v0.3 Execution State（代码事实，reviewer 可核验）

- `zhihu-answer-grabber`：grab/batch/search/status CLI；captured!=verified；verify-output 单一事实门；V2 rich content（render/rich-renderer/markdown-security/asset-extractor）已 merge。
- `corpus-anthology`：chunk/map/verify/reduce/render-final + top-percent selector + hierarchical digest（T9 合同）+ tool-less runtimes（lmstudio / deepseek）。
- `research-orchestration`：thin deterministic orchestrator（SEARCH→SELECT→CAPTURE→VERIFY→HANDOFF→ANALYZE→RENDER），单问题词面选择 + checkpoint/resume + fail-closed。
- V0.3 T0-T11 ticket 治理已完成主体（T7/T9 合同文档在 `docs/`）。

## I. What Was Actually Done in This Preparation Task

1. 从 frozen BASE `196db3d` 创建 `spec/p1-architecture-spec-prep-01` 分支（无代码改动）。
2. 完整读取 authority 文档（00/01/02/03/04/07/09 + Approved Specs + product-behavior-contract + runtime-strategy）。
3. 实际阅读 v0.3 production code（zhihu-answer-grabber 13 个 src 文件、corpus-anthology 全部 scripts/lib、research-orchestration 全部 lib/bin），建立 CURRENT_V0_3_SEAM_MAP（Draft §2，九问齐全）。
4. 撰写 Architecture Spec Draft（A-M 边界、caveats、OPEN_DECISIONS、overengineering audit）。
5. 本 Review Packet。

**未做**（prohibitions 全部遵守）：无 production implementation、无 selector coding、无新 benchmark/Gold/实验、无 P2/P3 内容、无 ticket 分解、无 PR merge、无版本分配、无 Approved Spec promotion。

## J. Deliverables

| File | 说明 |
|---|---|
| `external-audit/2026-08-27/p1-architecture-spec-prep-01/P1_CROSS_QUESTION_RESEARCH_ARCHITECTURE_SPEC_DRAFT_01.md` | 审查对象（Draft） |
| `external-audit/2026-08-27/p1-architecture-spec-prep-01/P1_ARCHITECTURE_SPEC_PREPARATION_REVIEW_PACKET_FOR_CHATGPT.md` | 本 packet |

## K. Seam Map 摘要（Draft §2 的浓缩，便于审查切入）

- **入口**：`research-orchestration/bin/research.mjs` → orchestrator（thin controller，子进程驱动 primitives，LLM 无 validity 决定权）。
- **Search**：`official.js`（官方 API）+ bounded enrichment（OPEN-D1）。
- **Capture**：`grabber.js` `grabAll`（分页/断点/身份门/atomic write）。
- **Verify**：`verifier.js` 14 项单一事实门。
- **Identity**：qid + `question-<qid>-answer-<aid>` sourceId，controller-owned（T11-R1 起 model 不输出 sourceId）。
- **Resume**：三层（ProgressStore / chunk-map-hierarchy 幂等 hash / orchestration run-identity checkpoint）。
- **Corpus analysis 进入**：make-handoff（verify 门后）→ chunk → map（flat/hierarchy，runtime 路由 fail-closed）→ verify → reduce → render。
- **直接复用**：grabber/http/signer/config/official/search-answer-count/verifier/machine-paths/render/rich-renderer/markdown-security/asset-extractor + corpus chunk/verify/reduce/render-final + tool-less runtimes + hierarchy + projection + intent/state。
- **只需 adapter**：orchestrator（多问题循环 + 新 selector 接入）、select.mjs（四组件模式 additive）、map runtime 路由。
- **P1 新增**：Research Planner / RRF 融合 / Dense Semantic Layer / 四组件 Selector / 研究级 Coverage State / 跨问题 Claim-Aspect 层。

## L. Key Architecture Decisions in the Draft（供审查聚焦）

1. 多问题 = orchestrator 层循环调用现有单问题合同（per-question verify 门不放松）。
2. Source-group Preservation 落位为 question 粒度整组保留 + 组身份继承 controller-owned identity invariant。
3. Popularity Anchor 由现有 top-percent 确定性逻辑推广（strangler 共存，不删除）。
4. Dense Semantic Layer 为独立 thin 模块，需走 T5 式 qualification 才可用于 production。
5. Planner 输出（queries/aspects）是结构化建议，controller 确定性校验后使用；Planner 无 IO、无选择决定权。
6. Dense Layer 不可用时：fail-closed 或**显式披露的**降级模式二选一（OPEN_DECISION D-7），静默降级被禁止。
7. v0.3 单问题路径零变更（additive 新 mode）。

## M. OPEN_DECISIONS Register（Draft §9）

D-1 production embedding model/provider；D-2 runtime priority；D-3 Planner schema 合同；D-4 selector 参数（MMR lambda 等）；D-5 question floor 等数值边界；D-6 adaptive depth/saturation 产品化；D-7 dense 不可用时 fail-closed vs 显式降级；D-8 全局质量分数；D-9 凭据/OAuth 行为。

## N. Known Weak Points（作者自查，请审查时重点关注）

1. Draft §5-F 的「组件管道序」措辞可能被误读为优先级声明——需要 reviewer 判断是否应更明确地声明这只是实现顺序而非权重声明。
2. §5-E 中「组内 sampled 裁剪沿用组内确定性规则」与 09 的 Question/Source-group Preservation 是否存在张力（ Preservation 是否允许组内裁剪？我们的解读：Preservation 约束的是跨组不拆散 + 组身份不可拆，组内规模控制是另一维度且需披露——**这个解读需要独立确认**）。
3. §5-I Retrieval Coverage 的最小定义（漏斗计数）是否足够「最小正确」，还是引入了不必要的结构。
4. Planner topic 侧输入的消毒边界（§5-K 最后一点）描述较简——topic 是用户输入（trusted-ish），但 aspect 回注路径的消毒合同可能需要更精确的表述。
5. D-7 的两个选项是否真的穷尽了合法空间（是否存在第三种被 authority 允许的形态）。

## O. Verification Commands（reviewer 核验用）

```bash
git ls-remote origin refs/heads/spec/p1-architecture-spec-prep-01   # REMOTE_TIP
git ls-remote origin refs/heads/dg01-decision-grade-gate            # BASE_SHA 196db3d...
git diff --name-only 196db3d9775e33ff8cd6bf4e218ba4313630a923...origin/spec/p1-architecture-spec-prep-01
# 应只出现本 packet 目录下两个 .md 文件
```

## P. Review Output Format（期望的审查结论形态）

```text
REVIEW_VERDICT: PASS | CHANGES_REQUESTED
REVIEWED_HEAD: <exact SHA>
FINDINGS: <P0/P1/P2 分级，每条附 Draft 章节定位>
```

## Q. Post-Review Path（审查后的合法下一步，均需独立决策，本任务不执行）

- CHANGES_REQUESTED → 修复 → 新 commit → re-review（delta-only）；
- PASS → 走治理流程决定是否提升为 Approved Spec（本任务不执行 promotion）。

## R. Final State

```text
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
P1_ARCHITECTURE_SPEC_DRAFT_01 = REVIEW_PENDING
```
