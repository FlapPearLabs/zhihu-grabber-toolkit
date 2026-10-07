# T14 B1 最小架构 / Seam amendment 候选

STATUS = REVIEW_PENDING；未授权实施此稿，须独立 ARCHITECTURE_SEAM_REVIEWER PASS。
SOURCE_HEAD = 054ef8d8aafa26372af5b695b0ddb54e766b507b。
AUTHORITY = Approved #108 Spec + Seam E/F/G/H；当前 owner 的 PARTIAL_ARCHITECTURE_AUTHORIZATION。
范围：§20-1 权威校正、§20-6/7 controller-owned bounded followup。

## A. 验收权威校正

撤回“unknown 必须成为合法 durable gap 并最终披露”。标记 ACCEPTANCE_OVERREACH_CORRECTED。
保留闭合三类型 GAP_TYPES；T01 兼容未知审计记录的能力不扩大为合法研究 gap。
新增 diagnosticCandidates[] 只作 composition 可驱动的诊断候选校验入口。
controller 用既有 normalizeGapType / gapTypeAllowsRetrievalAction 校验类型；未知仅记既有 appendEvent
的 UNKNOWN_GAP_TYPE 拒绝事件，不传 T01 persistLedger，不产生 action，不调用检索。
已知候选也不直接获 gap 身份：合法 gap 仍来自既有 T03 机械诊断，候选不拥有 subject / identity / authority。
既有合法 gap 的后续检索不被不相关的未知候选阻塞；unknown 专项用无合法 gap 的计划测增量 IO=0。
受控正对照使用闭合类型、真实 T03 可诊断的 plan subject，观察合法 action 的实际检索。

## B. 调用面与输入输出

caller = composeP1Research 的既有 opt-in targetedSubphase 分支，接入既有 runRetrievalFeedbackLoop。
新增 targetedOnContinue({ coverageState, pool }) 回调 seam，默认 null；每次 feedback-loop invocation 仅在首个 T07 已判 CONTINUE 的 planned round 中调用一次，后续 planned CONTINUE 不重复调度。
callee = runTargetedSubphase；内部继续调用 T03、T01、T04/T05、T06、唯一 runMultiQueryRetrieval、T08、T07。
回调只能返回 { pool, counts }，不能提供 STOP/CONTINUE/round/plan/occurrence 权威；composer 保持 spread-LAST 权威绑定。
不新增 stage、pipeline、scheduler 模块、authority store、依赖。
现有 policy 输入、plan/occurrence/checkpoint/seam 由 composer spread-LAST 绑定。
新增可选 proposeForDiagnosis({ diagnosisRound, gaps }) 候选生产回调；返回普通 proposals[]。
gaps 为 controller 产生的本轮合法记录副本；回调结果始终不受信，仍走现有 T04/T05。
既有 proposals[] 原样兼容、没有回调时只处理初始 pass，默认 #108-off 路径不变。
diagnosticCandidates[] 不携带有效 gapId/identity；只供上述类型校验。
输出保留现有 shape；gaps 包括本 occurrence 的全部合法 audit round 记录，counts 从 T07 重算。
可增加诊断/授权 event 日志以测量每 pass 的 provider delta，日志仅审计、从不作为权限依据。

## C. 确定性循环

初始 round=0：既有 T03 用实际 executedQueryProvenance，T01 持久化；按 gapId 升序。
每 pass 每 core 至多消费一个 proposal，不消费模型优先级；proposal 绑定本轮 controller gapId。
T04/T05 依次验证 plan-owned ref、scope、attempt(core)、dedupe(core/query/scope)、global budget。
AUTHORIZED 才进唯一检索路径；T06 原样 commit；T08 原样 evidence re-evaluation；T07 原样计数。
RESOLVED、FAILED_OPERATIONAL、REJECTED、无 proposal 的 core 本次调度退出。
未获证据解决的 core 可进入下一 pass，保留 T01 主语与 core；仅 gapId 的 audit suffix 改变。
下一 pass 再用当前累积 pool 调用 T03；保留已经诊断但 T08 尚未解决的合法 core，
避免成功执行一个查询就把 DUPLICATE_ONLY / one-sided / authority-unknown gap 当作已解决。
carry 是已有合法诊断的延续，不是内容归因的新生产设施。
用 T01 makeGapId + appendGapRecord/persistLedger 对同 core 追加本轮审计记录，旧记录不改写。
旧 action terminal 不重开；新 proposal 由当前 gapId 进入 T05。
达到 bound/global limit 的逻辑未解决 core 可消费一次 next proposal 做受控拒绝审计；
该拒绝不授权 action，不产生 IO，不重开旧 action，此后该 core 退出。
拒绝 round 的 gap 结论仍交 T08，用 core 上的真实 everAuthorized 与实际 terminationReason，
不能把前一 round 已付费的 gap 错当 never_authorized。
不对 resolution 的 closed vocabulary / predicates / basis 做修改。

## D. 终止性证明

合法 core 集合有界于 T03 的有限 plan material；无新自由主语/未知合法 gap。
每 core 的每次真实新 action 消耗 T05 固定 bound 中一个 attempt；预算按实际 scope channel 消耗。
等价 proposal 命中已有 core dedupe 并退出；无 proposal/不安全/operational/resolved 均退出。
每个耗尽 core 最多一个拒绝 pass，然后退出。有限 core × (maxAttemptsPerGap + 1) 为上界。
无需新 maxDiagnosisRounds authority、策略、priority、graph、learned policy。

## E. 崩溃与 resume

不新增 completion credential；checkpoint 锚定的 action ledger 是唯一动作/支付/重放权威。
每一次 AUTHORIZED、COMMITTED、terminal/rejection 仍使用既有 stageLedgerBytes + anchor + writeState。
保持原 after_targeted_execution / after_targeted_commit_prepare / after_targeted_commit_finalize 窗口。
未 committed 的同 action 依 T06 安全重跑；已 committed 只复用 checkpoint 绑定产物。
恢复按确定性的 round 顺序重放调度，先 replay 当前 round 的既有 action 再考虑下一 proposal；
不得把上一 round 的 latestActionForGap(core) 当作新 proposal 的权限或永久复用障碍。
每 pass 的 gap ledger 是可重新生成的审计记录，磁盘原文不被读作权限；不得用未锚定 ledger 计数。
恢复时若 pool 已被目标检索扩充，原合法 diagnosis 必须由 plan / checkpoint 绑定事实恢复，
不能因目标查询已在 provenance 中而丢掉已付款 gap；不可直接信任磁盘 gap ledger。
具体恢复路径：T03 以当前 Approved plan 的全部有限材料机械生成可验证 subject/core 模板（空 executed provenance），
只选与 checkpoint-anchored action.core 匹配的模板；以 T01 makeGapId 恢复该 action 已有 audit round，
再与本次真实 T03 新诊断记录并集，不以原磁盘 gap ledger 赋权。
已锚定动作无论有无 CONTINUE 窗口都先走 T06 decideTargetedReplay；COMMITTED 集合只读 checkpoint-bound pool，
merge 全部已付费证据并补齐欠缺的既有 T08 re-evaluation，禁止新授权/IO（STOP 优先）。
AUTHORIZED-only 无完成凭证；若 STOP 已发生，不借恢复绕过 STOP 付费重跑；保留历史并诚实 fail closed，
仅在 CONTINUE 窗口可按原 F.5 进行安全重跑。resume 的 diagnosis pass 从0按锚定实际 action确定性重放，
不能由 round计数、原 gap ledger 或回调提供 replay credential。
COMPLETE ordinary resume 沿用既有 composer closure/reuse；不把新 occurrence restart 声称为同 occurrence replay。

## F. Budget / P1 / STOP

planned count 仍从 computePlannedAttemptCount(coverageState) 读取；targeted 从 T07 锚定 ledger 读取。
global preflight 保持 planned + targeted executed + targeted failed，不复写 executedRoutes / plannedRoutes。
diagnosisRound 仅审计，不增 P1 retrievalRounds、不改 planHash/occurrence/checkpoint root。
run 层 STOP 优先于后续 IO：STOP 来临必须已有 T08 honest terminal；不伪造/阻止 SATURATED。
撤销现有 T09 在 planned-loop 已返回 STOP 后才开始检索的 placement；该已有行为不是权威。
同一 planned round：保留该 round 的原 coverageBefore、实际 planned routes/failures、planned novelty/total。
先按原输入纯调用既有 evaluateRetrievalRound。若结果 STOP，绝不调用 targetedOnContinue。
若 CONTINUE，按该结果形成 live coverage snapshot（planned attempt 已计入），persist 并调用 targetedOnContinue 一次。
callback 的 T07 counts 返回后，从 SAME coverageBefore + SAME 本轮 planned facts + 新 targeted counts
再次纯调用既有 evaluateRetrievalRound；roundIndex 与 planned novelty 分母完全相同，不重复计 planned routes。
应用该最终 evaluation 一次；若变为预算 STOP，立即退出，绝不付费下一 planned round。
targeted 的新 candidate 不注入 planned accumulated map，因此不改变后续 planned novelty/saturation 判据。
下游最终 pool 通过既有 augmentAccumulatedPool 合并最终 planned pool 与 targeted pool；复用并 export 该 helper，
不复制 RRF/identity/provenance 实现，不另建 pipeline。
targeted 有效 global budget = min(既有 config 的 maxQueryBudget, opt-in policy 的 maxQueryBudget)，不能超过 P1 上限。
无 CONTINUE 窗口时仍须以禁止执行模式先恢复全部 checkpoint-anchored 已提交目标池/合法历史诊断及T08结论，
然后产生其余合法 gap 的 T08 诚实可见终态，但不得新授权 action/IO。
该模式复用 T06 REUSE + diagnosis / terminal，以已有 run STOP reason 调 T08；不把预算 STOP当 SATURATED，反之亦然。
普通旧单轮 proposals 也迁入同一合法窗口；#108-off 的 default null 行为逐字不变。

## G. 验证义务

先真实 composer RED：第二 pass 等价 proposal 不发生、limit 后 next proposal 未进 controller。
GREEN：同 occurrence/core，不同 audit round；真实持久 REJECTED；provider 增量零；COMMIT 不重复。
全 12 项统一 T14 campaign 重跑，不拼历史 nine PASS 与局部新测。
保留 global budget、STOP accounting、operational failure、crash before/after、tamper、bidirectional lineage。
负对照必须能撤销对应 PASS；旧 focused suites 仅 supporting。
新 exact SHA 经 CODE + ARCHITECTURE/SEAM conformance + ACCEPTANCE_EVIDENCE_REVIEWER。
P0=0/P1=0/12 PASS 才 ready、ff-only、remote verify、fresh clone/post-master、close #126。
§20-13 仍 out of scope，无质量改善声明。

## H. Blast radius

CodeGraph 已实测 impact/callers/callees/affected：subphase→composer→research-p1；相关 T09/T11、
P1 occurrence/complete-reuse/runtime-composition、provider/RRF tests。
STOP placement 触及 coverage-final-integration.runRetrievalFeedbackLoop；实施前另做其 impact/callers/callees/affected。
不改 T01/T05/T06/T07/T08 模块契约，不改 Approved Spec/Seam Contract 原文以迁就实现。
