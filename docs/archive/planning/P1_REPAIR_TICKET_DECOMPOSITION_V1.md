# P1 Repair Ticket Decomposition V1 — 审计后限定修复候选

```text
DOCUMENT_ID = P1_REPAIR_TICKET_DECOMPOSITION_V1
STATUS = REVIEW_PENDING
AUTHORITY_CLASS = NON_AUTHORITATIVE_PLANNING_CANDIDATE
BASE_MASTER_SHA = e7a9a9e4a3be0ef4d3b07c37c9446d9a6b1512ab
BRANCH = planning/p1-repair-ticket-decomposition-v1
DATE = 2026-09-20
TICKET_COUNT = 10
IMPLEMENTATION_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
ISSUE_CREATION_AUTHORIZATION = NONE
PROJECT_MEMORY_UPDATE_REQUIRED = NO
NEXT_LEGAL_ACTION = INDEPENDENT_REPAIR_TICKET_GRAPH_REVIEW
```

本文件与 [Repair Ticket Graph](P1_REPAIR_TICKET_GRAPH_V1.md)共同定义一个待独立审查的 repair program，
不修改旧 P1 feature graph，不授予任何票开工权。编号是候选标识，不是已创建的 Issue。
产品语义取自已生效 authority；本候选不重开 owner 决策，不改变阈值、算法或产品版本。

## 1. Authority 与 provenance 必须分开

### 1.1 CURRENT AUTHORITY

本轮 fresh fetch 的 `origin/master` 与 BASE_MASTER_SHA 一致，无 master drift。
下列链接均指本候选 base 上的文件；后续 executor 必须 fresh-read 届时合法 master。

| 简称 | 当前来源与适用边界 |
|---|---|
| RULES / AGENTS | [RULES](../../RULES.md)、[AGENTS](../../AGENTS.md)：安全、scope、exact-SHA quorum、串行 ff-only 集成 |
| P1 | [P1 Spec](../specs/p1-cross-question-deep-research.md)：§0.2 amendment map；§4.3、§6.2、§7.3、§8、§9.4、§10、§11 |
| SEAMS | [Seam registry](P1_SEAM_CONTRACTS_V1.md)：A/B/C V1；D V2（semanticContractVersion=2）；required invariants、versioning、ownership |
| V2 | [V2](../specs/v2-rich-content-fidelity.md) §6、§9–9.2、§11–12：canonical / Agent View / capability 边界 |
| V0.3 | [V0.3](../specs/v0.3-product-scope.md) §5、§7：继承安全隔离、full/sampled 与 lineage |
| PARENT | [Research Orchestration](../specs/research-orchestration-scope.md) §3–11：thin controller、runtime、resume、失败与披露；被 P1 明确 amendment 的部分以 P1 为准 |
| BEHAVIOR / ADR | [Product Behavior](../product-behavior-contract.md) §3.9–3.10、§3.17；[Key Decisions](../architecture/key-decisions.md) D02/D03/D09/D10/D11：不改 grab resume-merge、canonical 原文、T13 单写者及 versioned seam |
| 导航与流程先例 | [project-memory](../project-memory.md)；[旧 decomposition](P1_TICKET_DECOMPOSITION_V1.md)、[旧 graph](P1_TICKET_GRAPH_V1.md)、[parallel contract](P1_PARALLEL_EXECUTION_CONTRACT_V1.md)：复用 schema、直接边和 START_GATE；旧 D V1 技术语义不覆盖 D V2 |

本轮 owner 明确确认 amendment 已完成同 exact-SHA 双审、ff-only 集成和远端核验。
本轮独立核验 remote master、提交历史及 Spec/Seam 内容；没有重新签发历史 reviewer receipt。
保留条件生效模板中的历史 `REVIEW_PENDING` 等文字，不把它们误读为要求重新设计或再次更新状态。

```text
FORMAL_CONTRACT_AMENDMENT = EFFECTIVE
P1_SPEC_AMENDMENT = APPLICABLE_APPROVED_AUTHORITY
SEAM_D_V2 = EFFECTIVE_CONTRACT
READY_TO_DECOMPOSE_REPAIR_TICKETS = YES
AUTHORITY_ACTIVATION_RECEIPT_SOURCE = OWNER_CONFIRMED_COMPLETED_LIFECYCLE
AUTHOR_INDEPENDENT_REVIEW_RECEIPT = NONE
```

### 1.2 HISTORICAL EXACT-SHA REPAIR EVIDENCE

| 简称 | Exact snapshot | 用途 |
|---|---|---|
| RP | [Scoped Repair Plan](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/blob/2387b9a9261b9830522e0da888b12ed990ee8b49/docs/audits/2026-09-19-scoped-repair-plan/SCOPED_REPAIR_PLAN.md) | F01–F08、六 lanes、root cause、§7–12、§13–17 测试与顺序输入 |
| OWNER | [Owner Contract Decisions](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/blob/2387b9a9261b9830522e0da888b12ed990ee8b49/docs/audits/2026-09-19-scoped-repair-plan/OWNER_CONTRACT_DECISIONS.md) | CD-A/B/C/D/F 历史决策来源；由 master P1 §0.2 明确引用 |
| AUDIT | [Architecture Audit](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/blob/eb02a660cdb3ada07ee08f742e2987bb7da8b9e8/docs/audits/2026-09-18-system-architecture/AUDIT_REPORT.md)及同目录 evidence/probes | 原始审计报告与反例；产品被审 SHA 为 `4bea7b30b3842a876e383977686a0abc0d68302f`，publication SHA 为 `eb02a660…`，二者不同 |

`2387b9a…` 与 `8919438…` 均不是 base master 祖先；两个 audit 目录不在 master tree。
已核验远端 owner-decision 分支指向 `2387b9a…`、audit publication 分支指向 `eb02a660…`。
这些是可远端恢复的 exact-SHA provenance，不是 merged current product authority，不复制入本分支。

```text
effective master Spec / Seam > RP / OWNER historical provenance > conversation navigation
```

RP 当时的 `READY_TO_DECOMPOSE_REPAIR_TICKETS=NO`、`CONTRACT_AMENDMENT_REQUIRED=YES`、
`NEXT_LEGAL_ACTION=INDEPENDENT_CONTRACT_AND_CONSISTENCY_REVIEW` 等 lifecycle 字段已被后续完成事实取代，
不导入本候选当前状态。RP 的 S2 历史备选也不导入。新候选自己的 implementation/issue authorization
仍为 NONE，原因是它尚未经过独立 graph review 与集成，而非复用 RP 的旧禁止状态。

审计中的 exit 0 表示成功复现坏行为，不是未来权威 regression PASS；历史 831/840、T16 数字和
live/private receipts 不作为当前修复证据。`4bea7b3..BASE` 只有正式 Spec/Seam 文档变化，
本轮按当前源码核对被指明 seams，没有重跑产品 probes、live 或全仓新审计。

## 2. 范围、切分与公共执行合同

六 lanes 冻结：A=F01/F02，B=F03/F06，C=F04，D=F05，E=F07，F=F08。
不新增 F09。RP §12 adjacent（legacy checkpoint、legacy stripHtml、断电事务性、Windows infra）
仅 `OUT_OF_SCOPE / FOLLOWUP`。#53/#54/#55 不开工；#79 仅 `POST_REPAIR_NEXT_CANDIDATE`，不在 DAG。

切分依据：

- A 的 occurrence/restart 是可独立验证的 F01 用户行为；完整闭包 F02 需要消费已落地的新版 T13/T14
  版本与真实产物，因此拆为 R02、R06，不让 R02 自称已完成 COMPLETE 闭包校验。
- B 的 executable contract expansion R03 能独立验证 V2 编码及 V1 历史隔离；生产切换 R05
  将 T14 proposal/assembly、diagnostics 与 T15 消费一次完成，不能拆成未兼容的 producer/consumer 两次 merge。
  F06 与 F03 共用同一 proposal/lineage 校验边界并入 R05；不另造几十行的空簇票。
- C 从 canonical loader 一路到真实 semantic adapter 请求并包含 metadata-only accounting，不能把 helper 与接线分票。
- D 复用 A 的完整 resume owner；E 先把已有 suites 纳入 CI，再核验最终集合，没有“以后补测试”票。
- F 独立，不阻塞核心修复；R10 是修复本身要求的最终 evidence/acceptance，不是第九个 finding 或 #79 实现。

### 2.1 所有票的 START_GATE

1. 本 graph 经独立 review PASS、exact-SHA ff-only 集成、fresh remote verify 后才是 frozen planning basis；
   再走 Issue/Tracker 授权。本轮不做这些动作，也不将候选标 ready-for-agent。
2. 开工 fresh fetch，检查 issue scope、current master、必要 blockers、输入 seam、owner 与 reviewer route。
   路径/函数是 base grounding，不是永久接口；executor fresh-confirm。未知新 shape/语义 → `STOP: CONTRACT_GAP`。
3. `BLOCKED_BY/BLOCKS` 只列直接集成边。准备/隔离开发按 parallel contract 的 CONTRACT_READY、
   ELIGIBLE_FOR_PARALLEL_START_GATE、IMPLEMENTATION_READY、INTEGRATION_READY 四层判定；有 frozen
   文本不等于有 executable fixtures，更不等于已获 START_GATE。不得用下游 fixture 宣称真实 producer 已验证。
4. scope-clean branch 从 latest remote master 创建；每个分支一个活跃写者。共享组件改动按图的交接矩阵协调。
5. 实质 CODE 依 AGENTS §18 进入 `/implement`、正确性行为进入 `/tdd`；静态→动态→self-review→push→
   CI/自动审查分类→独立 quorum；不虚构未配置 lint/typecheck。每票的回归及 CI 登记由该票负责。
6. required quorum 同 exact HEAD PASS 后才能串行 ff-only 集成与远端验证。drift 后 re-form + fresh review；
   不 amend/rebase reviewed history、不 force push、不用旧 PASS 代替组合后验证。

### 2.2 Review routing 与统一停止条件

每票的 route 字段为 **候选执行路由**：沿用 AGENTS §2.1.3 仓库默认 `INTERNAL_SUBAGENT`；
未来明确 Issue/START_GATE/owner 指定优先，其次 milestone route。当前 planning author 不分派任何 agent，
不自行批准 graph；本候选的下一步只有独立 Ticket Graph review。

CODE=1×CODE_REVIEWER；DOCUMENT=1×CONTRACT_REVIEWER；SECURITY=1×SECURITY_REVIEWER +
1×CODE_OR_CONTRACT_REVIEWER；DOGFOOD=1×ACCEPTANCE_EVIDENCE_REVIEWER。高风险是审查重点，不凭风险
自行增设 quorum。L2 live/contract evidence 不替代 L1 code quorum。需要改 Approved authority 则停止本票，
不得在 repair 中偷做 Contract+Consistency amendment。

每票继承 `CONTRACT_GAP / CONTRACT_CONFLICT / REVIEW_TARGET_DRIFT / PERMISSION_OR_TOOL_FAILURE`。
新 provider/runtime/egress、降阈值求绿、第二 analyzed writer、canonical 改写、scope 外实现均 STOP。
live/private 条件不足记 `NOT_RUN / UNAVAILABLE`，相关验收 BLOCKED，`SKIP != PASS`。

### 2.3 证据和版本交接

PRE-REPAIR 正确期望必须在该票合法 base 上失败（RED）；POST-REPAIR 同一断言在 candidate 上通过（GREEN）。
fixture/schema 新增用“正确 V2 输入应被识别、坏输入应拒绝”的 RED；F01/F02/F03/F04/F05/F06 必须另有
穿过生产 caller 的行为 RED，不能仅用 schema 不认识证明行为修复。历史 probes 只供改写测试意图。
F07 用当前未纳入文件/遗漏分类的正确覆盖断言失败，补全后通过。F08 不写镜像文案测试，做事实/diff 核对。

每票提交命令、exact base/head、执行文件、Node/OS、pass/fail/skip 与原因，以及正/边/负例。
R02 交接 occurrence/request/config binding；R03 交接 versioned executable validators/fixtures；
R04 交接 projector/prompt 的实际版本；R05 交接 semantic contract=2、实际 synthesis/prompt 身份及校验；
R06 消费它们，不能猜版本或把整仓 Git SHA 当所有阶段失效键；R07 再交接冻结 pending/resolution binding。
这些是输出义务，不在本候选发明 schema、函数名或数值版本号（Seam D=2 已由 authority 冻结）。

## 3. Ticket index 与 finding coverage

| ID | Lane | Title | Type | Risk | BLOCKED_BY |
|---|---|---|---|---|---|
| P1-R01 | E | 现有研究回归纳入持续 CI 与分类 | CODE/CI | MEDIUM | — |
| P1-R02 | A | 新 occurrence 隔离 restart 的旧研究状态 | CODE | HIGH | P1-R01 |
| P1-R03 | B | Seam D V2 executable contract 与历史验证隔离 | CODE/TEST_INFRA | HIGH | P1-R01 |
| P1-R04 | C | T13 生产安全投影与零 claim accounting | SECURITY/CODE | HIGH | P1-R01 |
| P1-R05 | B | 原子切换命题关系生产链与证据闭包 | CODE | HIGH | P1-R03 |
| P1-R06 | A | COMPLETE 与中断恢复的真实依赖闭包 | CODE | HIGH | P1-R02, P1-R04, P1-R05 |
| P1-R07 | D | 冻结歧义决策的生产澄清续跑 | CODE | HIGH | P1-R06 |
| P1-R08 | E | 最终修复集合的 CI 纳入与平台复核 | CODE/CI | MEDIUM | P1-R07 |
| P1-R09 | F | 校准 D2 当前文档与注释事实 | DOCUMENT | LOW | — |
| P1-R10 | A/B/C/D/E | 组合修复的 live semantic 与 canonical 验收 | DOGFOOD | HIGH | P1-R08 |

R08 的 R07 blocker 传递包含 R02/R03/R04/R05/R06，不重复写传递边。
R01 是 RP §14 E0：让后续票有已工作的 CI 登记/分类入口，而不是要求后续修复先存在。

| Finding | 修复 owner | 支撑/验收 | 状态边界 |
|---|---|---|---|
| F01 | P1-R02 | R06、R10 | restart 行为独立修复；闭包另验 |
| F02 | P1-R06 | R02/R04/R05 提供真实依赖；R10 | 不将 COMPLETE 存在性当 validity |
| F03 | P1-R05 | R03 executable contract；R10 live/canonical | fake runtime 不是语义验收 |
| F04 | P1-R04 | R06 version invalidation；R10 | 真实 loader→请求 body |
| F05 | P1-R07 | R06 occurrence/resume；R10 | 用户入口必须可达 |
| F06 | P1-R05 | R03 非法结构；R04 全无 claim；R10 | 非空及 lineage 与关系同 owner |
| F07 | P1-R01, P1-R08 | 各票登记自己的测试；R10 分类 evidence | CI 不能替代 live/private |
| F08 | P1-R09 | 独立 DOCUMENT review | NON_BLOCKING_FOR_CORE_REPAIR |

## 4. Ticket contracts

### P1-R01 — 现有研究回归纳入持续 CI 与分类

- **ID**: P1-R01
- **TITLE**: 现有研究回归纳入持续 CI 与分类
- **TYPE**: CODE/CI
- **RISK**: MEDIUM；改变回归执行面与平台依赖，不改产品算法。
- **FINDINGS**: F07
- **AUTHORITY**: AGENTS §12/§18；RULES §10；RP §10、§13 Lane E、§14 E0、§16。
- **GOAL**: 现有核心研究合同每次 PR/master 都实际执行，新增修复回归有显式登记路径，遗漏不会静默变绿。
- **ROOT_CAUSE**: 当前 workflow 只运行六个 research 文件，核心 suites 未持续纳入；不是“完全没有 CI”。
- **TARGET_CONTRACT**: fast deterministic / full offline / historical compatibility / live gated / private canonical 分开报告。
- **IN_SCOPE**: 现有 suites 清单、最小分类/纳入检查、CI 触发与平台准备、历史 Git 对象获取、明确 skip；保留既有 grabber/anthology/root gates。
- **OUT_OF_SCOPE**: 产品修复、替后续票写回归、新 CI 平台、普通 PR 自动调用付费模型或读取私有语料、批量 Action 升级。
- **PRODUCTION_ENTRYPOINT**: 无产品行为改动；执行入口为 GitHub PR/master push → `.github/workflows/ci.yml` → Node test runner。
- **PRODUCTION_CALLER**: workflow 的实际 test steps；保留 base 的六个 research gates 并扩展。
- **TEST_CALLER**: suite inventory 与真实 CI 执行文件对照；现有 research tests 调用各自真实产品 interfaces。
- **LIKELY_FILES_COMPONENTS**: `.github/workflows/ci.yml`；`research-orchestration/test/`；LIKELY_COMPONENT=最小 suite 分类/遗漏检查 runner（新路径由 executor 确认，不发明已有文件）。
- **OUTPUTS**: 可执行 CI 分类与纳入机制；base inventory、历史对象需求及实际执行 receipt。
- **BLOCKED_BY**: NONE
- **BLOCKS**: P1-R02, P1-R03, P1-R04
- **ACCEPTANCE_CRITERIA**:
  - [ ] PR fast contract 在 Ubuntu/macOS/Windows、Node 22 执行既有保护与指定核心集合；full offline 每 repair PR/master 至少 Ubuntu 执行；不把重型三平台 nightly/manual 候选误写为已完成。
  - [ ] 分类覆盖全部现有 research suite，未知/未登记新增核心文件使检查失败；不因 path filter 未跑 required gate 而 PASS。
  - [ ] historical Git 对象需求（如既有 T09 pinned producer）被满足，缺对象失败；private/live 缺席另列，不计 offline PASS。
  - [ ] 保留原保护；未知 skip 拒绝，已知平台限制逐项报告。required fast 核心无 skip，full offline fail=0；base failure 必须按 AGENTS §12 对照处理。
- **REQUIRED_TESTS**: RED=用 base inventory 对照 workflow 发现真实遗漏并非零失败；GREEN=同一检查覆盖；反向移除一项登记/执行路由时检查仍能拒绝。真实 CI terminal receipt，不只 YAML 静态断言。
- **COUNTEREXAMPLES**: 新核心 test 未登记、浅 clone 缺历史对象、Windows 目录/glob 解释差异、live skip 混进离线通过率。
- **STOP_CONDITIONS**: 继承 §2.2；不能用修产品/删断言/跳过 required core 修 CI；基线失败先对照，不顺手修 F01–F06。
- **REVIEWER_QUORUM**: 1×CODE_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: CODE_REVIEWER（CI/平台执行证据）
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认；§2.2 优先级适用）
- **MODEL_RECOMMENDATION**: GPT-5.6 Sol medium；WORK_TYPE=CI 分类与执行证据；平台疑难升级 high。不改变产品 runtime。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 最小显式清单或分类 runner 足够，不建通用测试平台；只对 base 的已有 suites 许诺完成，未来 suites 的加入归其修复票。

### P1-R02 — 新 occurrence 隔离 restart 的旧研究状态

- **ID**: P1-R02
- **TITLE**: 新 occurrence 隔离 restart 的旧研究状态
- **TYPE**: CODE
- **RISK**: HIGH；跨请求状态身份和错题研究风险。
- **FINDINGS**: F01
- **AUTHORITY**: P1 §4.3/§6.2/§10.2；PARENT §8；RP §7、§10 restart_different_topic、§13 Lane A；OWNER CD-A1。
- **GOAL**: 用户显式 restart 始终建立新 execution occurrence，新题不会执行旧题 ResearchPlan 或下游派生阶段。
- **ROOT_CAUSE**: composer restart 跳过 state，但随后仍 `loadPlan(workDir)`；稳定 runId 也不表达新执行发生。
- **TARGET_CONTRACT**: normalized request + stable effective config 与 occurrence 分离；restart 不因 plan bytes 偶合而取消；canonical bytes 保留。
- **IN_SCOPE**: composer bootstrap、request/config/occurrence binding、Plan 与 derived state 的隔离、必要调用边界和版本记录；规范 runner 的 restart 路由回归。
- **OUT_OF_SCOPE**: R06 完整 COMPLETE 闭包、R07 澄清流程、全局 run registry、grab --fresh、删除旧 canonical、provider/selector 参数改变。
- **PRODUCTION_ENTRYPOINT**: `research-orchestration/bin/research-p1.mjs`；canonical wrapper `research-orchestration/bin/canonical-runner.mjs`。
- **PRODUCTION_CALLER**: `composeP1Research` → `loadPlan`/`proposeResearchPlan` → coverage stage chain；canonical runner 实际传 `--restart`。
- **TEST_CALLER**: `p1-t15-runtime-composition-wiring.test.mjs` 调真实 composer；`p1-canonical-runner.test.mjs` 验 dispatch；新增同目录跨题行为回归（名称待 executor 确认）。
- **LIKELY_FILES_COMPONENTS**: `research-orchestration/lib/p1-runtime-composer.mjs`、`lib/state.mjs`、`lib/plan-contract.mjs` 的 P1 binding 接缝；上述 bin/test（相对 research-orchestration）；共享 state 不改变 v0.3 语义。
- **OUTPUTS**: 最小 occurrence/binding 记录与验证接口、生产接线、RED/GREEN receipt、R01 分类中的本票回归。
- **BLOCKED_BY**: P1-R01
- **BLOCKS**: P1-R06
- **ACCEPTANCE_CRITERIA**:
  - [ ] 同 workDir AI 题完成后 restart 儿童近视题，旧 query 不被发出，旧 Plan/Coverage/Selection/Manifest/Claims/Synthesis 不当作新 occurrence 结果。
  - [ ] 同题 restart 也新 occurrence；相同新旧 planHash 不允许复用旧 derived research stages；不能靠删除全部 canonical 达成。
  - [ ] 进程重启的普通 resume 仍识别同 occurrence；有效 Plan/组级复用能力不被一刀切取消。完整跨阶段零重算由 R06 验收，本票不得声称 F02 已闭合。
  - [ ] request/effective config 漂移不能接受为原 run resume；secret 及其 hash 不入身份，served-model 字符串仍仅观测；无参数重新决策。
  - [ ] canonical runner 真正到达修复后 composer；v0.3/grab 合同保持；原 canonical bytes/hash 前后可比。
- **REQUIRED_TESTS**: PRE 同目录换题正确 query/Planner 期望在 base 失败（RED），POST 同断言通过（GREEN）；同题 restart、no-restart topic conflict、普通同绑定 Plan reuse、canonical runner 参数→CLI→composer 行为关联；登记 fast/offline。
- **COUNTEREXAMPLES**: 只清 state 留 plan；新 occurrence 读旧 T09 state；把 stochastic planHash 充当 runId；credential rotation 导致新研究；只测 runner 字符串而没有 composer 行为。
- **STOP_CONDITIONS**: 继承 §2.2；需要新 canonical schema/第二状态机/清空数据则停止；不得为通过本票偷实现 R06/R07。
- **REVIEWER_QUORUM**: 1×CODE_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: CODE_REVIEWER（状态/identity）
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认）
- **MODEL_RECOMMENDATION**: GPT-6 high/xhigh；WORK_TYPE=核心状态身份实现与失败边界；主工程负责人负责，不交机械 worker 决策。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 优先现有 workDir/最小 occurrence 记录；不预设文件名或持久 schema。R06 可复用本票 binding，不复制 CLI 判断。

### P1-R03 — Seam D V2 executable contract 与历史验证隔离

- **ID**: P1-R03
- **TITLE**: Seam D V2 executable contract 与历史验证隔离
- **TYPE**: CODE/TEST_INFRA
- **RISK**: HIGH；错误 validator 会将 V1 标签洗成 V2 authority。
- **FINDINGS**: F03, F06
- **AUTHORITY**: SEAMS §0、D OUTPUT/IDENTITY/INVARIANTS/FAIL_CLOSED/VERSIONING；P1 §8/§11；RP §6/§10/§17；parallel contract §E2 TYPE_A/TYPE_B。
- **GOAL**: V2 可观察合同有可执行正负例；V1 历史校验独立标识，不能冒充 V2 conformance，为下一票原子生产切换提供稳定验收边界。
- **ROOT_CAUSE**: 现有 `validateSynthesisOutput` 固定 seamVersion=1、四类别；fixture 与新 authority 不同版本。
- **TARGET_CONTRACT**: 明确 version-specific 验证；V1 仅历史通道，V2 不猜 defaults、不回填 lineage/关系；A/B/C V1 不变。
- **IN_SCOPE**: D V2 fixtures/validator、identity-chain 和 hash/partition 断言、显式历史 validator/测试路由；保留历史 bytes；登记测试分类。
- **OUT_OF_SCOPE**: 生产 T14 切换、模型 prompt、T15 产品行为、Spec/Seam 编辑、伪造当前 producer V2 PASS。
- **PRODUCTION_ENTRYPOINT**: 本票是 executable-contract 基础票，无新产品路径；当前真实 T14→T15 入口仍由 composer 驱动，切换归 R05。
- **PRODUCTION_CALLER**: 当前 `produceCrossSourceSynthesis` 仍输出 V1，须明确标为未完成 repair；不得从测试 helper 已支持 V2 推断生产已接入。
- **TEST_CALLER**: `research-orchestration/test/p1-seam-contracts.test.mjs` → versioned validator；历史真实 producer conformance 与新 V2 TYPE_A 分开；R05 必须新增当前 V2 TYPE_B。
- **LIKELY_FILES_COMPONENTS**: `research-orchestration/test/helpers/p1-seam-contracts.mjs`、`test/fixtures/p1-seams/seam-d/`、`test/p1-seam-contracts.test.mjs`；现有 conformance tests 的历史分类调用，仅必要修改。
- **OUTPUTS**: D V2 executable validation 与 Cases A–F/非法 fixtures；显式 V1 historical test route；可供 R05 使用的合同边界。
- **BLOCKED_BY**: P1-R01
- **BLOCKS**: P1-R05
- **ACCEPTANCE_CRITERIA**:
  - [ ] §5 的全部结构/identity/lineage 正负例进入 V2 TYPE_A；semantic goldens 的 fixture 输入/期望取自 authority，不声称 validator 自动判断自然语言。
  - [ ] V1/缺 semantic version/混合版本向 V2 validator 提交必拒绝；历史 validator 名称或显式参数区分用途，不用自动降级冒充 V2。
  - [ ] V2 hash 对 canonical payload 复算；关系/anchor/lineage/正交状态变化影响 identity，数组 emission order 无关；legacy view 不影响 canonical hash。
  - [ ] 保留 base 生产路径的明确 V1 历史验证直到 R05，所有适用既有测试不因默认 validator 偷切 V2 而破坏；不会出现 producer V2/validator V1 的中间状态。
  - [ ] 私有 real fixture 不存在则记 NOT_RUN；TYPE_A 完成可独立 merge，但 `CURRENT_PRODUCER_V2_CONFORMANCE=NOT_IMPLEMENTED`，不提前接受 F03/F06。
- **REQUIRED_TESTS**: 正确 V2 fixture 在 base V1-only 验证下 RED，扩展后 GREEN；foreign/duplicate/missing claim、空 family、坏 anchor/stance/lineage/hash、V1 masquerade 均拒绝；历史 bytes/V1 有效性仅在历史路径保持。
- **COUNTEREXAMPLES**: 只检查 shape 不绑定真实 input claims；从 category 猜 breadth；validator 自算并覆盖坏 hash；同 source 两侧去重；把所有 skips 计 PASS。
- **STOP_CONDITIONS**: 继承 §2.2；required shape 与 Spec/Seam 冲突先 STOP，不以 fixture 修改 authority；不能将现有 `FUTURE_REQUIRED_CHANGE` 注释改成已实现的 Spec 文案。
- **REVIEWER_QUORUM**: 1×CODE_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: CODE_REVIEWER（executable contract/versioning）
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认）
- **MODEL_RECOMMENDATION**: GPT-6 high；WORK_TYPE=版本化验收边界；固定 fixture 数据可由轻量 executor 在既定合同内准备。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 这是 pre-agreed seam expansion，非“一票一文件”。helper 不必成为生产依赖；TYPE_B 在 R05 验证真实 producer，不能推迟到 R10。

### P1-R04 — T13 生产安全投影与零 claim accounting

- **ID**: P1-R04
- **TITLE**: T13 生产安全投影与零 claim accounting
- **TYPE**: SECURITY/CODE
- **RISK**: HIGH；untrusted corpus→semantic request 边界。
- **FINDINGS**: F04
- **AUTHORITY**: V2 §9.2.1–9.2.9；P1 §8.1/§10.1/§10.2；SEAMS C accounting/security；RP §8/§10/§13 C；OWNER CD-C1/C2。
- **GOAL**: 每个 selected source 经过 deterministic、inert、保结构的 Agent View 后才到 T13；metadata-only 来源合法分析后可记 analyzed。
- **ROOT_CAUSE**: real loader 返回 canonical raw content 是正确职责；T13 只加围栏，既有 identity isolation 断言不移除 HTML/code/URL。
- **TARGET_CONTRACT**: raw HTML/raw code body/full external image URL/file URI 不进 semantic request；canonical bytes/hash 不变；Seam C V1 identity/shape 不变。
- **IN_SCOPE**: 单一 HTML Agent projection owner、复用 parser/sanitizer、逐 source assert、T13 与 adapter 必需接线、safe metadata 与零 claim 结果、实际 projector/prompt version；必要接口元数据传递。
- **OUT_OF_SCOPE**: Human Markdown 当 Agent 输入、第二 parser/sanitizer 框架、legacy digest/map 全迁移、全局 DLP、下载/OCR/执行、放开代码正文、改 approved runtime。
- **PRODUCTION_ENTRYPOINT**: `research-orchestration/bin/research-p1.mjs` → `composeP1Research`。
- **PRODUCTION_CALLER**: `analyzeSelectedCorpus` → `buildRealSourceContentLoader` → `runPerGroupAnalysis`/`extractPerGroupClaims` → projection → `buildDeepSeekResearchRuntime().analyze`。
- **TEST_CALLER**: `p1-t13-group-representation-claims.test.mjs`、`p1-t15-runtime-composition-wiring.test.mjs`；必须从真实 canonical loader 和真实 runtime adapter fake fetch 截获请求 body。
- **LIKELY_FILES_COMPONENTS**: `research-orchestration/lib/per-group-claim-extraction.mjs`、`group-representation.mjs`、`rce-provenance-adapter.mjs`、`coverage-final-integration.mjs` 的必要 projection seam、`deepseek-research-runtime.mjs` 的 T13 prompt；`corpus-anthology/lib/lmstudio-projection.mjs`/`text.mjs` 仅必要底层复用。新 projector 路径由依赖/许可检查决定。
- **OUTPUTS**: 生产投影、accounting 回归、safe request body 证据、实际版本交接给 R06；新增/修改 suites 的 R01 分类登记。
- **BLOCKED_BY**: P1-R01
- **BLOCKS**: P1-R06
- **ACCEPTANCE_CRITERIA**:
  - [ ] 嵌套 pre/code、编码 URL/path、CJK 紧邻路径、伪造 SOURCE/BEGIN/END 围栏不泄漏或创建额外来源；语言/行数等 bounded metadata 保留。
  - [ ] 标题/段落/列表/blockquote 与适用 question/comments/asset context 按 V2 保留，不新增抓取；正常证据文字不被清空，source/token mapping 仍 controller 私有。
  - [ ] 原 canonical bytes/hash 不变；投影构建/断言失败在 semantic fetch 前拒绝；不访问语料链接、不执行代码、无工具能力扩张。
  - [ ] metadata-only selected source 实际走允许的 T13 semantic analysis，明确 `NO_EXTRACTABLE_CLAIM` 或现行等价合法空 claims 后才计 analyzed；不 skip、不静默 drop、不凭 metadata 编造 claim。
  - [ ] 全 selected sources 无合法 claim 时既有 T14_EMPTY_VERIFIED_INPUT 仍 fail closed，无 synthesis；Seam C accounting 与身份编码不改。
  - [ ] 真实 loader→projection→T13→真实 adapter 请求 body 满足安全断言；helper-only 测试不接受。报告投影信息损失，不承诺 prompt injection 永不成功。
- **REQUIRED_TESTS**: base 实际请求中 unsafe canary 使正确“不包含”断言 RED，candidate GREEN；正文正控制、metadata-only 调用计数/合法空结果、失败零 fetch、混合有 claim/无 claim accounting、全部零 claim synthesis 拒绝；R01 fast/offline 注册。
- **COUNTEREXAMPLES**: stripHtml 留代码、Human renderer 输出直接进模型、正文伪造 token、投影后空文本直接标 analyzed、仅注入同形 loader 代替 real loader。
- **STOP_CONDITIONS**: 继承 §2.2；检查依赖许可方向，不让 MIT 包未经审查依赖 AGPL renderer；需要新能力/semantic code body 则单独产品决策，不在本票。
- **REVIEWER_QUORUM**: 1×SECURITY_REVIEWER + 1×CODE_OR_CONTRACT_REVIEWER，同 exact HEAD
- **REQUIRED_REVIEWER_ROLE**: SECURITY_REVIEWER + CODE_OR_CONTRACT_REVIEWER
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（两个独立 review contexts；候选默认）
- **MODEL_RECOMMENDATION**: GPT-6 high/xhigh；WORK_TYPE=安全消费链与结构投影；低风险 fixture 准备不能替代安全 owner。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 复用既有解析/URL分类和单 source assertion；不修改 raw loader 的 canonical 含义，只在模型可见边界投影。

### P1-R05 — 原子切换命题关系生产链与证据闭包

- **ID**: P1-R05
- **TITLE**: 原子切换命题关系生产链与证据闭包
- **TYPE**: CODE
- **RISK**: HIGH；伪共识/伪冲突、无来源结论与下游错误披露。
- **FINDINGS**: F03, F06
- **AUTHORITY**: P1 §8.1–8.4/§9.4/§10.2/§11；SEAMS C→D V2 全合同；RP §5/§6/§10/§17；OWNER CD-B1–B4。
- **GOAL**: 真实 P1 生产链输出带原始 claim lineage 的 proposition families/独立 unresolved，T15 和 diagnostics 消费同一 canonical state。
- **ROOT_CAUSE**: aggregation 将 contradictory 自动挂到所有 main；T14 runtime 只输出 aspect partition，assembly union support/category；空 cluster 漏验证。
- **TARGET_CONTRACT**: effective S1 + D V2；kind 仅组内 metadata，关系与 breadth 正交；完整输入分区、非空 family、controller-owned identities。
- **IN_SCOPE**: T14 runtime proposal/prompt、aggregation/validation/assembly/hash、5 个 T14-owned diagnostics；同步 T15 版本/guard/披露消费和真实 producer conformance；必要 legacy 单向展示；迁移受影响 mocks/fixtures/test callers。
- **OUT_OF_SCOPE**: T13 抽取体系重设计、第二 analyzed writer、T15 重建关系、S2/pairwise/NLI/KG、通用 evaluator、自动猜 V1 migration、新 metric/阈值、R04 投影实现。
- **PRODUCTION_ENTRYPOINT**: `research-orchestration/bin/research-p1.mjs` → `composeP1Research`。
- **PRODUCTION_CALLER**: `produceSynthesisWithCoverage` → `produceCrossSourceSynthesis` → runtime.synthesize；返回经 `finalizeResearchCoverage`/`buildFinalDisclosure` 至 research result；T14 diagnostics 经 `updateSynthesisDiagnostics`。
- **TEST_CALLER**: `p1-t14-cross-group-synthesis.test.mjs`、`p1-t14-async-runtime-seam.test.mjs`、`p1-t15-coverage-final-integration.test.mjs`、`p1-t15-runtime-composition-wiring.test.mjs`、D conformance tests。
- **LIKELY_FILES_COMPONENTS**: `research-orchestration/lib/cross-group-aggregation.mjs`、`cross-source-synthesis.mjs`、`pre-synthesis-guard.mjs`、`deepseek-research-runtime.mjs` T14 分支、`coverage-final-integration.mjs`；R03 helper/fixtures 的必要 current producer 接线；限定搜索出的其他消费者。
- **OUTPUTS**: D V2 实际 producer/consumer、当前 TYPE_B conformance、生产反例 RED/GREEN、semantic/prompt/identity 版本交接；CI 登记。
- **BLOCKED_BY**: P1-R03
- **BLOCKS**: P1-R06
- **ACCEPTANCE_CRITERIA**:
  - [ ] §5 Cases A–F、partition/lineage/identity/legacy/diagnostic 全部适用断言通过真实 producer；F03 的同条件相反主张不能共同 support，组内 contradictory 不自动反对无关 main。
  - [ ] 非空整体中的空 family、foreign/duplicate/missing IDs、坏 anchor/stance/source lineage 均 fail closed；零合法输入仍 T14_EMPTY_VERIFIED_INPUT；guard PASS 不替代这些检查。
  - [ ] 同一 merge candidate 同时完成 V2 producer、实际异步 adapter proposal、R03 V2 validator 接线及受影响 T15/披露消费者；当前 conformance 默认验证 V2，V1 仅显式历史路径。
  - [ ] T15 拒绝不兼容/缺版本产物，不重建关系、不写 analyzed identity；最终 coverage 对账与 pre-synthesis guard 两层保留。合法未知可披露，但结构通过不授予 semantic acceptance。
  - [ ] diagnostics 只由 canonical relation/lineage 派生，保持冻结五键与 T07 所有权；novelty_gain 不归 T14。旧 artifact 不被自动重写成 V2；重新综合只在完整原 lineage 重新验证且显式执行权限内。
  - [ ] 无只改测试 helper 的接线缺口；既有 async rejected promise 与 malformed resolved output 的错误身份仍可区分，runtime/model pin 不改。
  - [ ] 本票 L0/L1 可独立交付；L2/live 与 full canonical 明确由 R10 承担最终 program gate，不用本票 fake runtime 绿灯宣称已最终语义验收。
- **REQUIRED_TESTS**: PRE 用相同语义正确期望在原 V1 proposal 可表达的 audit 输入上复现 F03/F06 RED，POST 用新合法 proposal 路径证明同一行为期望 GREEN（记录 proposal schema 必要变化，不替换期望）；R03 TYPE_A、当前真实 producer TYPE_B、真实 async adapter fake fetch→T14→T15，§5 全矩阵；所有修改测试及时 CI 登记。
- **COUNTEREXAMPLES**: Case B 被单一 conflicting 丢 breadth；Case D minority 变全局少数；same source 去掉一侧；全 singleton/全 unresolved 躲 golden；改 category 改 diagnostics；V1 缺版本获默认值。
- **STOP_CONDITIONS**: 继承 §2.2；跨版本中间生产不兼容不得 merge；若 executor 发现无法在单一可审上下文完成，应报告 ticket sizing finding 给 graph reviewer，不自行拆出非法中间 master。
- **REVIEWER_QUORUM**: 1×CODE_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: CODE_REVIEWER（语义合同/lineage/集成）；L2 在 R10 另需独立 semantic adjudication
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认；live evidence 不能由执行者 self-approve）
- **MODEL_RECOMMENDATION**: GPT-6 xhigh；WORK_TYPE=高风险 S1 生产合同、identity 与原子消费迁移。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 这些改动共享一个 D V2 可观察边界，故合票；没有独立图算法/UI/新框架。R03 已把编码验证工作抽离，降低本票负担。

### P1-R06 — COMPLETE 与中断恢复的真实依赖闭包

- **ID**: P1-R06
- **TITLE**: COMPLETE 与中断恢复的真实依赖闭包
- **TYPE**: CODE
- **RISK**: HIGH；虚假 COMPLETE、过度失效与隐式昂贵重跑。
- **FINDINGS**: F02
- **AUTHORITY**: P1 §4.3/§6.2/§10.2/§11；SEAMS B/C/D identity/version；RP §7/§10/§13 A；OWNER CD-A2/A3。
- **GOAL**: 每次复用依据真实依赖闭包；拒绝 stale COMPLETE 且不联网，普通中断保留有效阶段与 siblings。
- **ROOT_CAUSE**: COMPLETE 只验 result/coverage-final 两个 hash；普通恢复重新初始化 retrieval chain；跨阶段 provenance 未集中判定。
- **TARGET_CONTRACT**: historical COMPLETE ≠ currently reusable COMPLETE；validation 无 network/canonical mutation，最早失效边界可解释；缺版本/provenance 拒绝，不猜。
- **IN_SCOPE**: composer 跨阶段统一复用判定、调用现有 owner validators、最小 dependency refs/hash/version record、真实已落地 R02/R04/R05 身份绑定、必要 stage resume 接线。
- **OUT_OF_SCOPE**: 新状态引擎/第二 canonical store、v0.3 checkpoint adjacent 修复、文件系统事务重构、自动 stale COMPLETE refetch、全仓 SHA 失效策略、R07 pending UX。
- **PRODUCTION_ENTRYPOINT**: `research-orchestration/bin/research-p1.mjs`；canonical runner 新执行路径作交叉回归。
- **PRODUCTION_CALLER**: `composeP1Research` 的 COMPLETE/interrupt 分支 → plan/coverage/T09/T13/T14 owners；组级有效性沿 `resumeMultiGroupExecution`，不另写 planHash-only 组复用逻辑。
- **TEST_CALLER**: `p1-t15-runtime-composition-wiring.test.mjs` + `p1-t15-coverage-final-integration.test.mjs`；T09 resume 现有 tests；真实 composer 持久化再删除/篡改依赖的跨调用测试。
- **LIKELY_FILES_COMPONENTS**: `research-orchestration/lib/p1-runtime-composer.mjs`、`coverage-final-integration.mjs`、`multi-group-execution.mjs` 的必要 owner 接缝、`state.mjs` P1 记录；R04/R05 版本/验证接口；不虚构现有 corpus.json。
- **OUTPUTS**: 可审计闭包验证/最早边界与最小依赖记录、ordinary resume 接线、有效/失效两类生产证据；R07 可消费的同 occurrence 恢复能力。
- **BLOCKED_BY**: P1-R02, P1-R04, P1-R05
- **BLOCKS**: P1-R07
- **ACCEPTANCE_CRITERIA**:
  - [ ] 校验 request/config/versions→bound Plan→frozen pool/selection→T09 answers/handoff/manifest→selected refs/hash→T13 claims/identity→T14 V2 relation/guard/hash→T15 result/coverage/run binding 全闭包。
  - [ ] 分别删除 Plan、canonical answers、handoff、claims、synthesis 或 coverage/result，或同 count 改内容/identity，均拒绝 reused COMPLETE 并报告最早失效边界；保留历史 bytes/state，不自动 planner/retrieval/capture/model。
  - [ ] 新版完整且有效 COMPLETE 在第二次调用复用，零外部调用；legacy 缺版本/config/projection/prompt/provenance 拒绝 current reuse，原 V1 synthesis 不能因文件 hash 自洽变 V2。
  - [ ] 普通中断从适当边界继续；仍有效的已完成阶段/无依赖 siblings 不重做。planner 变化从 PLAN、T13 version 从 claims、T14 version 从 synthesis 局部失效；失效与待执行阶段不能混成旧 COMPLETE 自动 rerun。
  - [ ] 日志/展示/注释/credential rotation 不触发无关语义重算；served-model 仅观测；version 来自 R04/R05 实际 owner，而非猜未来常量。
  - [ ] 校验本身零网络、零 canonical 写；失败不能重算被篡改文件 hash 然后接受；不取消 verify-output/handoff authority 或 T13 单写者。
- **REQUIRED_TESTS**: PRE missing-plan/missing-answers 正确拒绝断言 RED；POST 同断言 GREEN；完整新版 closure 正控制、逐边篡改、same-count mutation、valid sibling 与 interrupted stage 调用计数、legacy missing-version、配置正负控制；从真实入口关联到同验证 owner，R01 登记。
- **COUNTEREXAMPLES**: 只验末端 hash；同 planHash 不同 selection；完整新产物被自己拒绝；所有中断都全量重抓；stale COMPLETE 自动付费重跑；第二 analyzed writer。
- **STOP_CONDITIONS**: 继承 §2.2；若闭包无法由 refs/hash/version 证明，不补猜 provenance；不让尚未落地 B/C 数据结构成为 hidden dependency（已显式列 R04/R05）。
- **REVIEWER_QUORUM**: 1×CODE_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: CODE_REVIEWER（跨阶段状态/依赖正确性）
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认）
- **MODEL_RECOMMENDATION**: GPT-6 xhigh；WORK_TYPE=核心恢复、version/provenance 闭包与局部失效。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 集中组合判定，委派既有 owners；闭包读取可复用单次快照，不构建 cache/proof 平台。未声明解决任意并发写或断电事务性。

### P1-R07 — 冻结歧义决策的生产澄清续跑

- **ID**: P1-R07
- **TITLE**: 冻结歧义决策的生产澄清续跑
- **TYPE**: CODE
- **RISK**: HIGH；跨进程绑定/幂等与 production reachability，虽接线窄仍不能仅按 LOC 降风险。
- **FINDINGS**: F05
- **AUTHORITY**: P1 §7.1–7.3/§4.3/§6.2；PARENT §5；RP §9/§10/§13 D；OWNER CD-D1。
- **GOAL**: ambiguity STOP 后用户用一次明确选择在原 frozen pool 上继续 T08/T09；进程重启不重置机会。
- **ROOT_CAUSE**: CLI/composer 无 clarification 参数通路；poolPlanHash 不代表 pool bytes；integration 未处理 selection 持久化返回结果。
- **TARGET_CONTRACT**: 同 run/occurrence、planHash、pool bytes identity、selector effective config/version、pending decision hash、coverage ledger；one successful resolution。
- **IN_SCOPE**: CLI 解析/机器与人类提示、composer continuation、pending/resolved 持久化与幂等、T08 既有校验接线；复用 R06 状态基础。
- **OUT_OF_SCOPE**: 新 planner/retrieval/pool、自由文本改 plan、第二轮问题、重设计 T08 selector/阈值、聊天平台。
- **PRODUCTION_ENTRYPOINT**: `research-orchestration/bin/research-p1.mjs` 的显式用户选择入口（具体 CLI flag 为实现细节，不声称已有）。
- **PRODUCTION_CALLER**: `composeP1Research` → `applySourceGroupSelection` → `selectSourceGroups` 的既有 clarification/forceGroupIds 校验 → `executeSelectedGroups`。
- **TEST_CALLER**: CLI parser/子进程测试 + 真实 composer 两次调用/进程重启测试；`source-group-selection.test.mjs`、T15 integration/wiring suites。
- **LIKELY_FILES_COMPONENTS**: `research-orchestration/bin/research-p1.mjs`、`lib/p1-runtime-composer.mjs`、`coverage-final-integration.mjs`、`source-group-selection.mjs` 的必要 persistence seam；测试与 CI 登记。
- **OUTPUTS**: 可执行续跑入口、完整 pending/resolved binding 与返回提示、同 pool 零新检索/幂等 receipt。
- **BLOCKED_BY**: P1-R06
- **BLOCKS**: P1-R08
- **ACCEPTANCE_CRITERIA**:
  - [ ] ambiguity 先成功持久化冻结状态再 STOP，展示 requiredGroups、remainingSlots、boundary options 与 binding；落盘失败 fail closed。
  - [ ] 合法明确选择验证同一 frozen state，沿既有 T08 规则继续 T09；从恢复到 selection 不调用 planner/retrieval、不新 pool，之后未完成 capture/analysis 可按合同执行。
  - [ ] 非法/重复/foreign IDs、缺 required groups、slots 不符：不消费成功机会、pending 不变、无第二问题且零 capture/model/provider 调用。
  - [ ] 同成功答案重试复用已验证 resolved decision，从未完成边界续跑，不重复有效已完成 capture；第二个不同成功答案拒绝。
  - [ ] process relaunch 仍同 occurrence；显式 restart 才新 occurrence；pool 缺失/篡改、同 plan 不同 pool、config/pending/ledger binding 变化拒绝旧答案。
  - [ ] 真实 CLI 输入能到达 resolver 并进入 capture；只证明底层 resolver 可用不接受；失败码/机器 JSON 保持可区分。
- **REQUIRED_TESTS**: PRE 正确“合法输入继续”在 base 生产调用 RED，POST 同期望 GREEN；真实 CLI→composer 路由 + async/离线 transport spy，跨进程持久化、重试、pool tamper、落盘失败、不同答案与 clear-best 禁 force；R01 登记。
- **COUNTEREXAMPLES**: 再 retrieval 后接受旧答案；只比较 planHash；非法输入计成功；重启重置次数；重复有效答案重复 capture；仅 mock composeP1Research 所有行为。
- **STOP_CONDITIONS**: 继承 §2.2；不能创建第二 resume policy 或第二选择算法；需改变一次澄清语义则 CONTRACT_GAP。
- **REVIEWER_QUORUM**: 1×CODE_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: CODE_REVIEWER（CLI/持久化/集成）
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认）
- **MODEL_RECOMMENDATION**: GPT-5.6 Sol high；WORK_TYPE=窄生产接线；occurrence/恢复关键判断由核心 owner 验收。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 复用已存在的 forceGroupIds 概念和 T08 validation；不预设新协议或 UI。

### P1-R08 — 最终修复集合的 CI 纳入与平台复核

- **ID**: P1-R08
- **TITLE**: 最终修复集合的 CI 纳入与平台复核
- **TYPE**: CODE/CI
- **RISK**: MEDIUM；防修复后 suites 新增造成再次遗漏。
- **FINDINGS**: F07
- **AUTHORITY**: AGENTS §12/§18；RP §10/§14 E2/§16–17。
- **GOAL**: 对已集成 A–D 的实际套件集合证明持续 CI 未漏项，三平台 fast、full offline 与外部门分栏可审。
- **ROOT_CAUSE**: 仅在起点清点旧文件无法证明后来新增 tests 被运行。
- **TARGET_CONTRACT**: R01 已工作机制的最终核对；不延后修复票测试，不将历史 probe/skip 当绿灯。
- **IN_SCOPE**: 最终 manifest/分类与 workflow 的必要窄补齐、执行证据、current exact SHA gate 汇总；按 R01 机制捕捉遗漏。
- **OUT_OF_SCOPE**: 代写各票缺失行为测试、修产品失败、live 模型自动付费、新指标/测试平台。
- **PRODUCTION_ENTRYPOINT**: 无产品改动；GitHub PR/master workflow → Node test runner。
- **PRODUCTION_CALLER**: 最终 `.github/workflows/ci.yml` 与 suite 分类执行器。
- **TEST_CALLER**: 当前真实 A–D tests 全集及 repository suites；inventory 对照实际 job/step 执行文件和结果。
- **LIKELY_FILES_COMPONENTS**: R01 已建立的 CI/manifest runner；`.github/workflows/ci.yml`；脱敏 CI evidence。允许无功能代码 delta 的证据交付，不为造 diff 重写 runner。
- **OUTPUTS**: current exact integrated code 对应的静态/fast/full/historical/platform receipt 与未跑 live/private 清单。
- **BLOCKED_BY**: P1-R07
- **BLOCKS**: P1-R10
- **ACCEPTANCE_CRITERIA**:
  - [ ] R02–R07 所有实际新增/修改 suites 在本票合法 base 已有回归与登记；缺行为断言退回原 owner，不把缺测掩成 R08 待补。
  - [ ] suite inventory、Node 命令、job 执行清单一致；fast 三平台 Node22、full offline Ubuntu PR/master、historical 对象需求满足；required fast 零 skip，未知 skip 阻断。
  - [ ] 当前 exact HEAD 适用 CI terminal；每个 skip/NOT_RUN 有类别与原因；不能称 full canonical/live PASS。configured automated review 状态按 AGENTS §18.6 分类。
  - [ ] 对每条 production reachability/RED→GREEN receipt 做路径核对；若组合后失败，在相应 owner scope 修复并 fresh review，R08 不扩权。
- **REQUIRED_TESTS**: 复用 R01 omission RED/GREEN 测试并以最终 inventory 验证；故意遗漏新 suite 的临时反例被拒绝；真实 remote CI + offline/full 结果，不仅重跑一条 focused suite。
- **COUNTEREXAMPLES**: 只记录 test 总数；platform skip 隐去；历史 real test 的本地 LM Studio 路由冒充当前 canonical DeepSeek；未触发 job 当 PASS。
- **STOP_CONDITIONS**: 继承 §2.2；产品回归退原 owner；未终态 CI 不交最终 evidence gate。
- **REVIEWER_QUORUM**: 1×CODE_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: CODE_REVIEWER（CI/组合回归 evidence）
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认）
- **MODEL_RECOMMENDATION**: GPT-5.6 Sol medium/high；WORK_TYPE=CI 对账与平台核验。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: R07 已传递集成所有核心依赖，故不重复加 R02–R06 direct edges；F 文档票不入此 gate。

### P1-R09 — 校准 D2 当前文档与注释事实

- **ID**: P1-R09
- **TITLE**: 校准 D2 当前文档与注释事实
- **TYPE**: DOCUMENT
- **RISK**: LOW；仅事实文案，越权追认历史批准则立即停止。
- **FINDINGS**: F08
- **AUTHORITY**: RULES §6/§10/§12、AGENTS §10；RP §11/§13 F；OWNER CD-F1（P1 §0.2 NO_PRODUCT_AUTHORITY_CHANGE）。
- **GOAL**: current navigation 不再描述 obsolete duplicate fatality，同时保留历史批准 receipt 未找到这一事实。
- **ROOT_CAUSE**: D2 已实现最低显式 rank 一次贡献，但 memory/当前注释仍写同 channel duplicate 一律 fatal。
- **TARGET_CONTRACT**: `D2_CURRENT_IMPLEMENTATION=VERIFIED`、`D2_ORIGINAL_APPROVAL_RECEIPT=NOT_LOCATED`；`NON_BLOCKING_FOR_CORE_REPAIR`。
- **IN_SCOPE**: RP §11 所列陈旧 current 句子/注释及必要导航链接；最小事实校准。
- **OUT_OF_SCOPE**: RRF 算法/duplicate runtime、历史审计/旧 receipt、兼容常量清理、整份 memory 重写、Spec/AGENTS/RULES 改动、历史 owner approval 追认。
- **PRODUCTION_ENTRYPOINT**: 不变；生产 retrieval→RRF 仅作事实核对。
- **PRODUCTION_CALLER**: `research-orchestration/lib/rrf.mjs` 当前 duplicate resolution；本票不改变执行语句。
- **TEST_CALLER**: 现有 `rrf.test.mjs` D2 cases、`retrieval.test.mjs`、`global-search-provider.test.mjs` 作行为对照；不新增镜像文案 tests。
- **LIKELY_FILES_COMPONENTS**: `docs/project-memory.md` 的指定 D2 段；`research-orchestration/lib/rrf.mjs`、`retrieval.mjs`、`global-search-provider.mjs` 的相关注释。
- **OUTPUTS**: 窄文档/comment diff、current/historical 分类与既有行为证据。此处描述未来票允许范围，不是本 planning author 的写权限。
- **BLOCKED_BY**: NONE
- **BLOCKS**: NONE
- **ACCEPTANCE_CRITERIA**:
  - [ ] 同 channel/question 最低 explicit rank 贡献一次；equal-best 等价折叠，冲突 FUSION_DUPLICATE_CONFLICT；非法 rank 仍 fail、跨 channel 各自贡献的文案准确。
  - [ ] adapter 原样透传、不自行去重仍保留；不误写“所有重复都接受”。current implementation 证据不充当历史批准 receipt。
  - [ ] 仅限定文案/注释；运行时语句与行为不变；独立 CONTRACT_REVIEWER 通过，F 不阻塞 A–E/核心验收。
- **REQUIRED_TESTS**: 文案/源码/现有 D2 正负例核对与 diff --check；已有测试适用运行，记录结果。不要求人为制造产品 RED，因本票无行为修复。
- **COUNTEREXAMPLES**: 删除历史记录、称原 owner approval 已证、把 equal-best 冲突也写成可折叠、借文案改回 fatal。
- **STOP_CONDITIONS**: 继承 §2.2；若需改变 authority/runtime，停止当前 document scope；不把 receipt 缺失变 A–E blocker。
- **REVIEWER_QUORUM**: 1×CONTRACT_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: CONTRACT_REVIEWER
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认）
- **MODEL_RECOMMENDATION**: GPT-5.6 Terra medium 或 Sol medium；WORK_TYPE=限定事实文案；语义由 reviewer 核对。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 无 outgoing edge；可单独交付。程序最终八 finding 全关闭需报告 F08 状态，但不能用它卡核心修复/验收。

### P1-R10 — 组合修复的 live semantic 与 canonical 验收

- **ID**: P1-R10
- **TITLE**: 组合修复的 live semantic 与 canonical 验收
- **TYPE**: DOGFOOD
- **RISK**: HIGH；结构通过与真实语义正确混淆、线上证据及费用边界。
- **FINDINGS**: F01, F02, F03, F04, F05, F06, F07
- **AUTHORITY**: P1 §8.4/§9.3/§10；SEAMS D hash≠semantic proof；RP §17；AGENTS §5 DOGFOOD/§12。
- **GOAL**: 在最终 exact integrated code/config/prompt/projection 组合上提供独立可复验的 L0/L1/L2 与 full canonical acceptance，范围明确。
- **ROOT_CAUSE**: 历史结构测试/旧 T16 场景不能证明当前修复的关系语义和真实 production correctness。
- **TARGET_CONTRACT**: deterministic + live semantic revalidation + full canonical acceptance 三层都满足才有相应范围声明；UNKNOWN 不洗成 PASS。
- **IN_SCOPE**: 授权公开/合成样本的预注册、holdout、原请求/proposal/产物 evidence、实际 canonical chain、脱敏 receipt 与独立 adjudication；只运行现有验证入口，不修代码。
- **OUT_OF_SCOPE**: #79 evaluator/observatory 平台、调参数/改 golden、私有语料未授权出网、新 runtime/provider、自动扩大预算或替代缺失 evidence。
- **PRODUCTION_ENTRYPOINT**: `research-orchestration/bin/canonical-runner.mjs` → `bin/research-p1.mjs`；澄清场景通过 R07 的真实用户入口。
- **PRODUCTION_CALLER**: 当前真实 composer→retrieval/capture/verify/handoff/dense/T13/T14/T15；不是私有 historical conformance 的旧 runtime 旁路。
- **TEST_CALLER**: R08 集成 suites；现有 canonical-runner/集成 harness；R04/R05 真实 adapter 与预注册 live cases；private/canonical gates 按实际能力分别报告。
- **LIKELY_FILES_COMPONENTS**: 未来专门的脱敏 repair acceptance evidence 目录（路径由获授权 START_GATE 确认）；现有 runner/harness 只读执行。无产品代码/test/CI 修复权限。
- **OUTPUTS**: exact tested product SHA、evidence commit SHA、版本/config、命令、原始证据 refs/hash、pass/fail/skip、费用与授权范围、独立 acceptance verdict。
- **BLOCKED_BY**: P1-R08
- **BLOCKS**: NONE
- **ACCEPTANCE_CRITERIA**:
  - [ ] L0=最终组合 deterministic/production-reachable regressions；L1=required code/security quorums 已绑定相应 exact HEAD，组合后 fresh independent review/receipt 不直接继承单 lane 旧 PASS。
  - [ ] L2 在运行前固定 §5 与 RP §17 case expectations、公开/合成出网材料、重复次数/预算及至少每 case 族一个独立 holdout；owner 接受执行预算。缺授权/模型/材料保持 BLOCKED，不发明数值。
  - [ ] 同条件同向/相反、不同 scope(P50/P99)、无关 contradictory、未变化/多方向、明确 unknown、code omitted 正文保留、metadata-only 的真实请求/proposal/关系/lineage 逐例独立核对；Cases A–F 全覆盖。
  - [ ] 明确 goldens 全命中，all-singleton/family-splitting/all-unresolved 负控制被验收拒绝；只预注册信息不足 case 可 UNKNOWN，重大伪共识/伪冲突/无引用 FAIL。
  - [ ] live gate 通过后 full canonical 实际执行完整链；bytes 可取回、绑定可独立复算、selected=mapped=analyzed、方向/反面 lineage 审核、无 silent fallback。历史 396/14/2 不是目标值。
  - [ ] 同 exact tested code 与实际 config/projection/prompt/runtime 记录；新增 evidence commit 明确不改变 tested product tree。raw 私有/credential/宿主路径不入公开 repo；脱敏不冒充原 bytes 校验。
  - [ ] 未跑 live→CURRENT_SEMANTIC_REVALIDATION_REQUIRED；未跑 canonical→不能声明 FULL_CANONICAL_ACCEPTANCE；样本 PASS 不推广普遍语义正确。owner 接受 receipt 后才能声明该场景验收。
- **REQUIRED_TESTS**: 消费各票 RED/GREEN 而不重复实现；重跑组合所需 L0；live registered+holdout+负控制；真实 canonical 与失效依赖/澄清重试验证（破坏性变更仅合成副本）；保留原始结果，不改期望求绿。
- **COUNTEREXAMPLES**: fake runtime 全绿即收口；all-unresolved 自动 semantic PASS；历史本地 runtime 换当前 DeepSeek；partial/accounting count 相等即全链有效；缺 raw 仅 hash 摘要自证。
- **STOP_CONDITIONS**: 继承 §2.2；外部 evidence/预算缺失 BLOCKED_BY_EXTERNAL_EVIDENCE；发现修复缺陷退对应 owner 的 finding-scoped 修复与 fresh review，不在此票实现。
- **REVIEWER_QUORUM**: 1×ACCEPTANCE_EVIDENCE_REVIEWER
- **REQUIRED_REVIEWER_ROLE**: ACCEPTANCE_EVIDENCE_REVIEWER（独立 semantic/contract evidence adjudication；不替代此前安全双审）
- **REVIEWER_ROUTE**: INTERNAL_SUBAGENT（候选默认；若 START_GATE 指定 EXTERNAL_CHATGPT，按 AGENTS terminal barrier 交接）
- **MODEL_RECOMMENDATION**: GPT-6 xhigh；WORK_TYPE=独立证据核验/语义裁决；executor 模型与产品批准 runtime 完全分离。
- **IMPLEMENTATION_NOTES_NON_AUTHORITY**: 不造新 judge 平台或全局正确率阈值；R09 无前置边。核心通过后仍单独报告 F08，未获新授权不启动 #79/#53/#54/#55。

## 5. Lane B 必须保留的验收矩阵（R03 编码，R05 生产，R10 live）

| Case | 冻结输入/期望 | 验证责任 |
|---|---|---|
| A | 三 ASSERTS 组、无 OPPOSES → SUPPORT_ONLY + MULTI_GROUP | R03/R05；R10 同向 golden |
| B | 三支持组 + 两反对组 → CONFLICTING + MULTI_GROUP 同时保留 | R03/R05/R10，不允许 legacy conflicting 丢 breadth |
| C | 单支持组 → SUPPORT_ONLY + SINGLE_GROUP | R03/R05/R10 |
| D | 两组 local minority 支持同命题 → SUPPORT_ONLY + MULTI_GROUP；kind lineage 保留 | R03/R05/R10 |
| E | 独立 UNRESOLVED → null breadth，无 familyKey/anchor/relationships/support/oppose/legacy category | R03/R05/R10（预注册信息不足） |
| F | 同 source c1 ASSERTS / c2 OPPOSES → CONFLICTING + SINGLE_GROUP，两侧 lineage 都在 | R03/R05/R10；新增第二支持组仅改变 breadth |
| scope | 热缓存 P50 vs 冷缓存 P99 不制造 false conflict | R05 proposal 控制断言；R10 真实判断 |
| 不逃避 | 明确 goldens 不得全 singleton、拆 family、全 unresolved | R05 验收负控制；R10 live 阻断；结构合法本身不够 |

结构/出处负例：空 family；无 claims 全输入；foreign/duplicate/missing IDs；family 与 unresolved 交叠；
anchor 非 member/自 stance 非 ASSERTS；非法 stance 或内嵌 UNRESOLVED；sourceClaims 与 relationships 不等；
丢任一原 source ref/statement/kind/group/author；伪造 sourceRef/author（未知仍 null）；support/oppose 不等于
对应 stance 的全部 refs；expertEvidenceRichSupport 从反对侧授予；坏 B/C/D identity chain；缺 guard；
count-only；缺保留 sections/diagnostic keys；未知 diagnostic key；不一致 relation/breadth；V1/缺版本。
这些分别在 R03 TYPE_A 与 R05 当前 producer/T15 负例验证，不能只验 fixture 没有真实输入 lineage。

identity/metamorphic：固定 proposal 的集合 emission order 置换结果稳定；anchor、方向、成员、原 statement、
kind、任一 lineage 或 canonical state 改变应改变相应 identity；hash payload 含版本/plan/guard 与完整 canonical
synthesis，不含自身 hash 和 legacy view。T14 记录全部输入 claim 的恰一次分区，不能模型自造 canonical ID。

兼容：V1=HISTORICAL_ONLY，原 bytes 保留；category 不猜关系，缺 lineage 不转换；完整 lineage 可在授权新执行
重新验证/综合成新 artifact，不称无损迁移。LEGACY_DERIVED_VIEW 仅 canonical→presentation，改/删它只能重算
视图或拒绝不一致，不改变 canonical identity/引用/diagnostics；新 synthesis 无 global minority。

diagnostics：`new_contradiction_rate = CONFLICTING family 数 / (families 数 + unresolved 数)`；空集口径 0
不授权空输入成功。其余冻结 keys/ownership/prior-baseline 规则保持；UNRESOLVED 独立披露。`hash != semantic proof`。

## 6. Source-contract 双向 disposition

| Normative source / obligation | Disposition |
|---|---|
| P1 §4.3 / CD-A1，restart、新 topic、config/occurrence | R02；R06 验闭包；不改 grab |
| P1 §6.2 / CD-A2/A3，完整依赖、局部失效、legacy拒绝、无自动 IO | R06；R04/R05 实际版本作为直接 blockers |
| P1 §7.3 / CD-D1，冻结绑定、一次成功/幂等、CLI 可达 | R07；继承 R06，不复制 owner |
| P1 §8.1 / Seam C CD-C1，metadata-only 分析后 accounting | R04；全零 claim fail 由 R05 保持，R10 组合验 |
| P1 §10.1 / V2 §9.2 / CD-C2，安全投影、canonical 不变 | R04；R06 投影版本失效；R10 live 信息损失验证 |
| P1 §8.2–8.3 / D V2 / CD-B1–B4，S1全部 required encoding/invariants | R03 可执行边界，R05 真实生产消费；§5逐例 |
| P1 §9.4 / D diagnostics，正交与 one-way legacy | R05，R03结构/identity 反例；无新 metric |
| P1 §8.4 / RP §17，goldens/holdout/live/full canonical | R05 自有 L0 + R10 L2/canonical；外部条件显式，不以 NOT_RUN 通过 |
| P1 §11 / D versioning，V1历史隔离/无猜迁移 | R03 expansion、R05 cutover、R06 reuse 拒绝 |
| RP §10/§16 / F07，逐票 RED/GREEN + 连续 CI | 各 repair 票自有测试和登记；R01 起始机制，R08 final inventory |
| CD-F1 / RP §11 / F08，current事实与历史receipt | R09；NON_BLOCKING_FOR_CORE_REPAIR |
| RULES canonical/credential、ADR D02/D03/D09/D10 | 继承且每票回归守护；不新增 authority，不改 canonical/第二 analyzed writer |
| owner决策、Spec amendment、Seam D V2 生效 | ALREADY_SATISFIED authority prerequisite，不再拆实施票；历史状态不导入 |
| old feature tickets、embedding/provider再选型、#53–55/#79、RP adjacent | OUT_OF_SCOPE / FOLLOWUP；不以 future convenience 增加实现或日志 |

每票 AUTHORITY 均能回到以上来源；新增 policy/threshold/schema decision 不在票内冻结。
R03 属 executable seam 支撑，R10 属已要求 evidence，两者没有新增 finding。

## 7. 本轮 author 自检与交付边界

自检检查了重复/过大/微票、source-contract 双向覆盖、direct-edge reciprocity、无环、production caller、
每修复票自己的 RED/GREEN、V1→V2 合法中间态、F 核心非阻塞、review routing 与 #79 排除。
机械结果和运行方法见 companion graph；PASS 仅表示 author candidate 自检，不是独立图审查或产品验收。

本轮只使用 to-tickets 形成候选、GitHub skill 做远端核验/提交推送；无 subagent/Claude Code 分派，
无 implementation/TDD skill 使用声明。规则、门禁、Spec/Seam、产品、tests、CI 与 project-memory 未修改。
没有新产品结论需要写 project-memory；F08 的未来文档校准已单独归 R09。
