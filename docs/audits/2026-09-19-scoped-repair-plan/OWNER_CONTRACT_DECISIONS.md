# OWNER CONTRACT DECISIONS — Scoped Repair Plan

```text
DATE = 2026-09-19
REPOSITORY = FlapPearLabs/zhihu-grabber-toolkit
PRODUCT_BASE_SHA = 4bea7b30b3842a876e383977686a0abc0d68302f
REPAIR_PLAN_REVIEWED_SHA = 8919438c0103feeebd723355cfd262f7dcee9dc3
DECISION_AUTHORITY = OWNER
OWNER_DECISIONS = FROZEN
CONTRACT_AMENDMENT_REQUIRED = YES
SPEC_UPDATED = NO
SEAM_CONTRACT_UPDATED = NO
IMPLEMENTATION_AUTHORIZATION = NO
TICKET_AUTHORIZATION = NO
REPAIR_PLAN_STATUS = READY_FOR_CONTRACT_CONSISTENCY_REVIEW
READY_TO_DECOMPOSE_REPAIR_TICKETS = NO
NEXT_REVIEW = INDEPENDENT_CONTRACT_AND_CONSISTENCY_REVIEW
```

## 决策来源、范围与层级

**DECISION AUTHORITY**：owner 在本次会话提供的《OWNER CONTRACT DECISION RECORDER + AUTHORITY CONSISTENCY PREPARER》提示词，§4 明确“本提示词本身就是 owner 对以下选择的明确批准”，§5–16 给出逐项选择。原提示词 UTF-8 文件 SHA256：`d5683b44e6578377d8997e04413d1cb189ae8a1cba42b819d6969a4d2cd8e9ec`。本文件将选择转录为仓库可审计记录，不替 owner 再做设计。

**SCOPE**：冻结 CD-B1/B2/B3/B4、CD-A1/A2/A3、CD-C1/C2、CD-D1，以及 CD-F1 的核心非阻塞决定；同步 [Repair Plan](SCOPED_REPAIR_PLAN.md)，只准备 authority consistency review。既有 S1 技术设计与 §10/17 验收要求保持，不实施 F01–F08，不拆票、不分派 agents、不创建 Issue/PR、不 merge。

本次 owner 同时提供前次 external review 结果：`F-RP-01=CLOSED, FINDING_SCOPED_REVIEW=PASS, UNRESOLVED_BLOCKERS=0`，仅绑定 REPAIR_PLAN_REVIEWED_SHA。**来源为 OWNER_PROVIDED_REVIEW_RESULT**；本次没有另行取得该 external reviewer 原始 receipt，不把历史 supporting/contract-rereview.md 或执行者 self-review 冒充该 receipt，也不将该 PASS 转移成当前候选的 Contract + Consistency 双审通过。F-RP-01 保持关闭。

| 层级 | 本记录能证明什么 | 不代表什么 |
|---|---|---|
| OWNER DECISION | owner 已明确选择，以下状态可记 OWNER_APPROVED / FROZEN | 所有 Approved Spec / frozen seam 已自动更新 |
| APPROVED SPEC / FORMAL SEAM CONTRACT | 仍以仓库现有文件及正式生效/版本规则为准；必要 amendment 待后续独立审查 | 本 decision record 不是替代 Spec，不授予新字段立即成为当前 product authority |
| IMPLEMENTED BEHAVIOR | 现有 master 的实现事实与历史审计仍按原时态记录；本轮无代码变化 | 已实现本记录的目标行为 |
| VALIDATED IMPLEMENTATION | 必须由未来 exact-SHA 测试、所需独立 review 与语义验收证明 | owner approval、计划 review、checksum 或本轮自检能授予产品 PASS |

下列 `AUTHORITY_UPDATE_REQUIRED` 是本次为独立 reviewer 准备的**authority impact 分类**，不是 owner 已批准某份尚不存在的 amendment。`YES` 项均为 `OWNER_DECISION=APPROVED + AUTHORITY_UPDATE_REQUIRED=YES + IMPLEMENTATION_AUTHORIZATION=NO`。`NO` 仅表示该选择不要求改变所列既有产品语义，不免除下一轮 review 或未来文档审查。

## OWNER_APPROVED DECISIONS

### CD-B1

- **STATUS**：OWNER_APPROVED。
- **DECISION**：选择 S1：anchor proposition family + explicit claim stance（ASSERTS / OPPOSES / UNRESOLVED）；resolved families 与独立 unresolved records 按 Repair Plan §5 保留。不采用 S2 full pairwise matrix。Aspect ≠ Proposition，Proposition ≠ Claim，Claim kind ≠ Stance；不得从 main/minority/contradictory 自动推导跨组 support/opposition。
- **RATIONALE**：明确命题关系，保留来源，避免把同议题当同立场。
- **AFFECTED CONTRACT**：P1 Spec §8.1–8.3；Seam D 输出、identity、support/oppose；Repair Plan §5–6。
- **AUTHORITY_UPDATE_REQUIRED**：YES，P1 语义与 Seam D 正式更新，和 CD-B3/B4 一并审查。
- **IMPLEMENTATION_EFFECT**：未来实现须消费已正式更新的 S1 合同；当前授权 NO。
- **OUT_OF_SCOPE**：S2、claim graph、NLI、新 evaluator、T13 抽取体系重设计。

### CD-B2

- **STATUS**：OWNER_APPROVED。
- **DECISION**：允许显式 UNRESOLVED；关系无法可靠判断时保留独立 record，relationStatus=UNRESOLVED、supportBreadth=null，保留 original statement、sourceClaimId、sourceRef、groupId、authorRef 与完整 lineage（作者未知仍 null）。无 support/oppose，不转换成 group-specific、minority 或 SUPPORT_ONLY。不仅因关系未知自动 fail whole run，除非未来另有明确 contract。
- **RATIONALE**：未知需如实披露，不伪造关系或无条件拒绝有效出处记录。
- **AFFECTED CONTRACT**：P1 Spec §8.2–8.3 / §10.2，Seam D 的有效输出/fail-closed；Repair Plan §5、§17。
- **AUTHORITY_UPDATE_REQUIRED**：YES，正式表达 unresolved、输出兼容性及完成/语义验收边界；不能以本记录静默弱化 NO_SEMANTIC_DOWNGRADE。
- **IMPLEMENTATION_EFFECT**：未来仍须遵循 §17 semantic acceptance；all-unresolved 不自动获最终 COMPLETE，明确同向/反向 golden 全 unresolved、拆 family 或漏合并仍 FAIL。预注册为信息不足的 case 可按既有门判断，不能事后重标 ambiguous；当前授权 NO。
- **OUT_OF_SCOPE**：新建全局 abstention 阈值、改 golden 期望、放宽无 claim/坏 lineage 的 fail-closed。

### CD-B3

- **STATUS**：OWNER_APPROVED。
- **DECISION**：single mutually-exclusive category → proposition relation + relationStatus + supportBreadth + claim lineage，必须 SEMANTIC_CONTRACT_VERSION_BUMP。Seam D required observable semantics 必须 major version / formal contract update；具体版本号由后续 amendment 按现有规则确定，本轮不编造。旧 artifact=HISTORICAL_ONLY，不从旧 category 猜 relationStatus/supportBreadth；原始 lineage 完整可得时可 re-synthesis / re-evaluation，生成新版本 artifact，不称无损 migration。
- **RATIONALE**：新旧语义不等价，不能用历史标签伪造新合同合规性。
- **AFFECTED CONTRACT**：Seam 合同 §0、Seam D 版本规则、fixtures/validator 与下游消费审查；P1 §8；Repair Plan §6–7。
- **AUTHORITY_UPDATE_REQUIRED**：YES，semantic version 与 Seam D major/formal amendment；后续按批准合同同步 fixtures/validator/consumer，当前均不改。
- **IMPLEMENTATION_EFFECT**：未来版本隔离与重新综合必须可审计，旧产物不能直接满足新版有效性；当前授权 NO。
- **OUT_OF_SCOPE**：假定迁移、猜历史版本、删除原始 bytes、随意指定新版本号。

### CD-B4

- **STATUS**：OWNER_APPROVED。
- **DECISION**：relation/conflict、跨 source-group support breadth、group-local salience 保持正交。relationStatus=SUPPORT_ONLY / CONFLICTING / UNRESOLVED；supportBreadth=SINGLE_GROUP / MULTI_GROUP / null（仅 UNRESOLVED 不适用）。仅 ASSERTS 的 distinct groups 计支持广度；CONFLICTING 需同 anchor/可比 scope 下 validated ASSERTS 与 OPPOSES。main/minority/contradictory 只保留 source-claim lineage metadata，不新增 synthesis-level groupSalience。
- **RATIONALE**：同一命题可同时多组支持且存在反对，组内少数不是全局少数或共识。
- **AFFECTED CONTRACT**：P1 §8.1–8.3 / §9.4，Seam D output/diagnostics/legacy consumer；Repair Plan §5.3、§10、§17。
- **AUTHORITY_UPDATE_REQUIRED**：YES，与 CD-B1/B2/B3 一并正式更新；legacy policy 如下，不能仅通过改展示文本完成。
- **IMPLEMENTATION_EFFECT**：未来 controller 分别派生/校验两维；CONFLICTING + MULTI_GROUP 必须同时保留；广度不代表 truth/confidence/evidence independence/consensus；当前授权 NO。
- **OUT_OF_SCOPE**：全局 minority taxonomy、知识图谱、新 confidence/consensus 评分。

**已批准 Legacy category policy（CD-B4 的组成部分）**：`LEGACY_CATEGORY=LEGACY_DERIVED_VIEW`。旧 widely-shared / group-specific / minority / conflicting 不再作为新版 canonical semantic authority。只允许 canonical state → legacy presentation；禁止 legacy category → canonical relation / breadth / support/opposition。保留 Repair Plan §5.3 的单向有损展示规则及两维披露要求：legacy conflicting 不能丢 MULTI_GROUP，新 synthesis 不生成全局 minority；旧 minority 仅 historical rendering 或 source-claim metadata。UNRESOLVED 不伪装为旧类别，旧四枚举必填接口须报告版本不兼容。diagnostics 也不得反读 legacy category；此为已选择的目标语义，旧 Seam D 仍待正式 amendment。

### CD-A1

- **STATUS**：OWNER_APPROVED。
- **DECISION**：restart=new execution occurrence；显式 restart 不复用旧 derived research stages。新 topic 不把旧 ResearchPlan、CoverageState、SelectionDecision、CorpusManifest、Claims、Synthesis 当成当前有效 derived state。旧 canonical source bytes 无需删除，不扩展为物理清空全部数据。
- **RATIONALE**：研究请求与执行绑定必须准确，旧研究产物不能冒充新研究。
- **AFFECTED CONTRACT**：P1 Spec §4.3 / §6.2 / §10.2；Repair Plan §7；product behavior contract §3.9–3.10 的 grab 边界保持。
- **AUTHORITY_UPDATE_REQUIRED**：YES，P1 research restart / occurrence 与普通 resume 的正式澄清；不修改 grab 的 resume-merge / 不支持 --fresh 决策。
- **IMPLEMENTATION_EFFECT**：未来隔离新研究执行的 derived state，保留 canonical 数据和普通 resume 的 valid sibling 复用；当前授权 NO。
- **OUT_OF_SCOPE**：删除 canonical、强制重抓原始回答、新 grab --fresh、通用状态引擎。

### CD-A2

- **STATUS**：OWNER_APPROVED。
- **DECISION**：依赖闭包无效 → REUSED_COMPLETE=FALSE；不能仅凭 resultHash/coverageFinalHash 返回 reusable COMPLETE。默认 fail closed for current reuse 并报告 earliest invalid boundary；需要 explicit restart 或未来明确授权恢复，不自动新增 network refetch / expensive rerun。
- **RATIONALE**：历史完成不证明当前依赖仍完整有效。
- **AFFECTED CONTRACT**：P1 §6.2 / §10.2 的 stale invalidation 与恢复；Repair Plan §7。
- **AUTHORITY_UPDATE_REQUIRED**：YES，正式澄清 stale COMPLETE 的 current-reuse 拒绝与恢复权限；与现有“invalidate and resume/re-run”措辞的组合交由 CONTRACT_REVIEW_REQUIRED。
- **IMPLEMENTATION_EFFECT**：未来 current reuse 拒绝后保留历史状态与 bytes，不自动恢复；普通中断 resume 的有效阶段复用不被取消；当前授权 NO。
- **OUT_OF_SCOPE**：自动联网、增加预算、强行重跑所有有效 sibling、删除历史 COMPLETE。

### CD-A3

- **STATUS**：OWNER_APPROVED。
- **DECISION**：legacy checkpoint 缺必要 semantic/config/prompt/projection version 或 provenance → DO NOT GUESS / DO NOT SILENTLY MIGRATE；当前 reuse=REFUSED，保留历史 bytes。未来迁移必须有可证明 provenance。
- **RATIONALE**：缺失的兼容性依据不能由实现者猜补。
- **AFFECTED CONTRACT**：P1 §4.3 / §6.2 / §10.2 的版本、依赖与复用；Repair Plan §7；CD-B3 新旧语义边界。
- **AUTHORITY_UPDATE_REQUIRED**：YES，正式记录 legacy missing-version 的复用拒绝规则及与新语义版本的绑定；不据此要求所有 seam major bump。
- **IMPLEMENTATION_EFFECT**：未来保留历史 artifact，拒绝把未知版本当当前有效 cache；当前授权 NO。
- **OUT_OF_SCOPE**：发明历史 provenance、无证据迁移、修改既有 canonical/verifier authority。

### CD-C1

- **STATUS**：OWNER_APPROVED。
- **DECISION**：安全投影后仅剩 safe metadata 的 source，仍按 T13 合法 analysis accounting 处理；经过允许的 semantic analysis path 且明确 no extractable claim 后才计 analyzed。禁止 skip model/semantic stage → 直接标 analyzed，禁止从 metadata 发明 claim。全体最终无 claim 继续现有 fail-closed。
- **RATIONALE**：语义分析完成与能否抽到 claim 是两件事，不能伪造分析覆盖。
- **AFFECTED CONTRACT**：P1 §3.1 / §8.1 / §10.1–10.2，Seam C accounting、T13 单写者；V2 §9.2.3–9.2.6；Repair Plan §8。
- **AUTHORITY_UPDATE_REQUIRED**：YES，P1/T13 metadata-only accounting 的正式澄清；不改变 T13 唯一 analyzed writer 或现有集合身份。本项是否需 seam 文本同步及其版本影响由下一轮 review 核对，不预设 Seam C major bump。
- **IMPLEMENTATION_EFFECT**：未来仅在合规 analysis 结果后计入 analyzed；不能用旧 digest/map 对空正文的处理替代 P1-T13 规则；当前授权 NO。
- **OUT_OF_SCOPE**：改 legacy digest/map、伪造 claim、静默丢 source、第二 analyzed 计数体系。

### CD-C2

- **STATUS**：OWNER_APPROVED。
- **DECISION**：当前 Agent safe projection DEFAULT OMIT raw code body；可按既有安全合同保留语言、有限结构 metadata。不得静默将 raw code body、完整外部图片 URL、file URI 重新送入 semantic request。研究代码正文语义的未来能力必须另走 PRODUCT / SPEC / SECURITY DECISION。
- **RATIONALE**：恢复既有 Agent View 安全边界，不借 F04 修复扩大能力。
- **AFFECTED CONTRACT**：V2 §9.2.4–9.2.6、P1 §10.1、product behavior contract §3.17；Repair Plan §8。
- **AUTHORITY_UPDATE_REQUIRED**：NO（当前选择重申既有 DEFAULT OMIT 与安全约束）；未来放开正文则 YES，需另行产品/Spec/安全决策与所需审查，本轮没有该授权。
- **IMPLEMENTATION_EFFECT**：未来修复遵循既有安全语义并保留 canonical raw bytes；当前授权 NO。
- **OUT_OF_SCOPE**：代码执行/安装、完整 URL/文件 URI 暴露、OCR/下载、模型权限扩张。

### CD-D1

- **STATUS**：OWNER_APPROVED。
- **DECISION**：一次 clarification 以 one successful resolution 为主要消费单位。非法输入不消耗成功机会，pending decision 冻结、不生成新问题、不新 retrieval；同一已成功答案可幂等重试；第二个不同 successful selection 必须 REJECT，进程重启不能重置限制。
- **RATIONALE**：允许纠正非法提交，同时维持一次澄清与冻结选择的边界。
- **AFFECTED CONTRACT**：P1 Spec §7.1–7.2 的 at most one clarification、selection continuation；Repair Plan §9。
- **AUTHORITY_UPDATE_REQUIRED**：YES，正式澄清成功解析计数、重试和持久化语义；不改变 candidate selection 算法或启动第二轮澄清。
- **IMPLEMENTATION_EFFECT**：未来 continuation 使用同一 frozen decision/pool，非法输入零新检索；当前授权 NO。
- **OUT_OF_SCOPE**：新问题、重检索、聊天系统、选择阈值修改、次数绕过。

### CD-F1

- **STATUS**：NON_BLOCKING_FOR_CORE_REPAIR（OWNER_DECISION=APPROVED）。
- **DECISION**：D2_CURRENT_IMPLEMENTATION=VERIFIED；D2_ORIGINAL_APPROVAL_RECEIPT=NOT_LOCATED。F08 不得阻塞 Lane A/B/C/D/E 或其核心集成，Lane F 可独立推进。以后对 current navigation/comments 做窄事实校准，标明 CURRENT IMPLEMENTED BEHAVIOR 与 ORIGINAL APPROVAL RECEIPT=NOT_LOCATED；不把 merged implementation + tests 冒充历史 owner approval，也不继续写已知错误的 current 行为。
- **RATIONALE**：事实校准与追认历史 authority 分开，不以旧 receipt 缺席阻塞核心修复。
- **AFFECTED CONTRACT**：Repair Plan §11、Lane F、DAG/Wave；RULES §6/10/12 与 product behavior contract 的 authority 分层保持。
- **AUTHORITY_UPDATE_REQUIRED**：NO（不改变产品 Spec/seam 或追认历史批准）；后续 current 导航/注释校准仍需独立授权范围与 DOCUMENT review，本轮不写这些文件。
- **IMPLEMENTATION_EFFECT**：无产品代码影响；本轮仅消除计划中的 F→核心集成阻塞边，不授权 F08 文档修复立即执行。
- **OUT_OF_SCOPE**：伪造 D2 历史 receipt、改 RRF 算法、重写 project-memory、将 F08 标为已修复。

## AUTHORITY IMPACT / 后续正式更新范围

以下事项统一标为 **CONTRACT_REVIEW_REQUIRED**；本轮只记录，不修改或自行宣告现有 Spec/seam 冲突已解决。

| 决策 | 现有 authority 与需要处理的差异 | 后续动作 |
|---|---|---|
| B1/B2/B3/B4 + legacy | P1 §8.2–8.3 要求相同/相反聚合和报告类别；Seam D 冻结四类别、可观察 shape 与版本规则。新 required 正交状态及 unresolved 不可伪装成旧 V1 | P1 §8 与必要 §9.4/§10.2 正式 semantic amendment；Seam D major/formal update，具体版本号留待该阶段；随后 fixtures/validator 与下游 consumer 同步/re-review。保留 §17 正向能力验收 |
| A1/A2/A3 | P1 §4.3/§6.2/§10.2 已要求有效依赖、版本及失效；restart occurrence、stale COMPLETE 不自动重跑、legacy 缺版本拒绝的操作语义需精确归档 | 正式 P1 reuse/restart/legacy policy 澄清；reviewer 核对是否存在相反条款。不可把“invalidate and resume/re-run”静默解释成必须自动联网，也不可取消 ordinary resume valid sibling 复用 |
| C1 | P1 accounting / Seam C 的 T13 单写者已存在，metadata-only 的成功分析后计入规则需要明确；product behavior contract §3.17 的 legacy digest/map 空正文处理有不同适用面 | 正式 P1/T13 accounting 澄清；核对 seam 文本同步需要，不预设 identity/shape 改动或 major bump；不推广到旧 digest/map |
| D1 | P1 §7 只写 at most one clarification，未完整定义非法提交与成功重试计数 | 正式 clarification 语义澄清，保留一次问题、冻结 pool 与不得重检索；不自行宣称与任意旧解释已兼容 |
| C2 / F1 | C2 沿用 V2 Agent View 约束；F1 只改变修复依赖/后续事实校准流程 | 不需更改上述 Spec/seam 产品语义；F1 文档后续 review 与 C2 未来能力变更 gate 仍保留 |

`AUTHORITY_UPDATE_REQUIRED=YES` 包括已有原则下需要正式写清的行为细节，不全部等同于“已发现现行 Spec 明文冲突”。明确的新旧不兼容面是 B 系列与旧 Seam D；其余按上述边界交下一轮独立判断，不在此宣布全部无冲突。

P1 research restart 不等于 grab clean-restart：product behavior contract §3.9–3.10 的 resume-merge / 不支持 --fresh 保持。`canonical semantic state` 仅指 synthesis 内语义权威，不改变 D03/D09 中 `answers.json` 为 canonical raw content 的事实。D02 controller-owned identity/lineage、D10 T13 analyzed 单写者、D11 versioned seam 仍保持。AGENTS §5 与 RULES §7/9 的正式 authority 变更/同 SHA review 要求不变。

## IMPLEMENTATION / TICKET AUTHORIZATION / NEXT REVIEW

本轮 IMPLEMENTATION_AUTHORIZATION=NO、TICKET_AUTHORIZATION=NO；不创建 Issue/implementation ticket/PR，不分派 agents，不生成实施 prompts。OWNER_DECISIONS=FROZEN 不等于 APPROVED_SPEC_UPDATED、IMPLEMENTED_BEHAVIOR 或 VALIDATED_IMPLEMENTATION。

下一动作仅为 **INDEPENDENT_CONTRACT_AND_CONSISTENCY_REVIEW**，由独立 CONTRACT_REVIEWER 与 CONSISTENCY_REVIEWER 对发布后的同一 exact candidate SHA 检查决策转录、计划同步和 authority impact。本轮只做窄 self-consistency check，不派发或代替这两位 reviewer。所需正式 amendment、版本号、后续执行授权仍是独立后续步骤；READY_TO_DECOMPOSE_REPAIR_TICKETS=NO。
