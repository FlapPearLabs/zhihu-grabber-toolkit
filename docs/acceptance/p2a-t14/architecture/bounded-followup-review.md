# ARCHITECTURE / SEAM REVIEW — 修订稿复审

REVIEWED_DOCUMENT = /tmp/p2a-t14-amendment-20261007/AMENDMENT-V1.md
REVIEWED_DOCUMENT_SHA256 = 734658c03e7c8d5f50fc55cc5af5578967ad890dd842952ef15363c4c27d8b19
SOURCE_HEAD = 054ef8d8aafa26372af5b695b0ddb54e766b507b
BASE = 854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
ROLE = independent ARCHITECTURE_SEAM_REVIEWER
VERDICT = PASS
P0 = 0
P1 = 0
P2 = 0
IMPLEMENT_GATE = OPEN（仅此 reviewed hash 的有限设计，受 owner 原授权和RED-FIRST约束）
USER_DECISION_REQUIRED = NO
PRODUCT_IMPLEMENTATION_REVIEW = NOT_PERFORMED（产品未改；此PASS不能替代新SHA三角色review）

## 修复验收

V1 P1 已闭合。E:72-79 与 F:99-101 明确无CONTINUE也先从checkpoint锚定ledger读取已有action，T06检查绑定pool，恢复已提交证据与合法历史诊断，补欠T08后finalize；STOP模式禁止新授权/IO，AUTHORIZED-only不得借恢复绕过STOP。此路径修正已提交付费证据因callback不执行而丢失的问题，无需新completion credential。

V1 P2 已闭合。B:22改为每次feedback-loop invocation首个真实CONTINUE仅调用一次，后续plannedCONTINUE不再调度；E:73,78-79明确从已有锚定action按auditround重建并重放，audit本身不作replay credential。一次invocation内的bounded诊断loop终止后不会在后续plannedround再重置gapId:0调度。

## 各契约面结论

1. **输入输出/调用面**：composer接runRetrievalFeedbackLoop的controller-owned回调；policy只给不可信proposal，身份、plan、occurrence、checkpoint、providerseam由composer spread-LAST。输出pool与锚定T07counts不产生STOP权威。无新runtime方法、provider、scheduler框架。
2. **unknown合法边界**：diagnosticCandidates只normalize/拒绝/audit，未知不入合法gapledger、不产生TargetedQueryAction和检索IO；§20-1额外durableunknown/finaldisplay已撤回。三种MVPgap完整保留。
3. **身份/状态**：carry既有合法core并仅变audit suffix，dedupe/attempt按core；旧actionterminal不重开，RESOLVED/operational/rejected/no-proposal退出本次调度，core上everAuthorized保证预算终态真实。未改T01/T05/T06/T07/T08 vocabulary/predicates。
4. **终止**：有限plan材料×(maxAttemptsPerGap+1)上界；每core每pass最多一个nextproposal、每个耗尽core最多一次拒绝审计，拒绝/无proposal/resolved/operational退出；无新maxDiagnosisRounds权限。
5. **同round二次评估**：两次evaluate使用同一coverageBefore、roundIndex、plannedroutes/failures/novelty/total，第二次仅变targetedcounts。strict roundIndex规则不需改；最终apply只对coverageBefore一次，live snapshot只供当前预算读数，不能作为第二次eval或apply的基底。#108-off默认null保持行为。
6. **STOP**：首次真实T07STOP立即禁targetedIO；只有CONTINUE可执行。targeted结果不进plannednoveltymap，不能阻止/制造SATURATED；targetedcounts仅进入budget分母，达到预算后不给下一plannedround付费窗口。STOP-only恢复只读已提交证据与T08终态，不开启retrieval。
7. **预算**：min(P1config预算,opt-inpolicy预算)，实际scope通道全计，plannedfacts不改；nextproposal仍真实经过既有T04/T05 bound/dedupe/global检查，拒绝增量IO=0。
8. **崩溃/resume**：checkpoint为唯一trustroot。只有T06合法REUSE可读已提交池；未锚定gapledger/round计数/callback均不作权限。已terminal结论原样保留；缺产物/hash mismatch遵从既有T06fail-closed/允许重跑及STOP优先，不制造新凭证。
9. **检索/最终pool**：唯一runMultiQueryRetrieval路径；最终复用并export augmentAccumulatedPool，保留相同RRF/canonicalidentity与仅plan.queryVariants安全信任集，无第二管线。

## 实施必须落实的原契约细节（不是新增权限）

- 零IO复用已提交action不依赖“新proposal是否存在”。resume先处理既有授权/提交事实，再考虑新proposal。
- 补欠T08时按audit/action顺序重建working pool，G.1 priorQuestionIds必须是该action执行前集合；先评估该action的新证据，再merge其结果。不得先merge全部targeted结果后把它们当prior，从而把本来新证据误写DUPLICATE_ONLY。terminal历史不可重新推导改写。
- 暂存livecoveragesnapshot不能成为新的retrieval完成凭证；ordinaryresume仍仅认可现有checkpoint绑定。若尚未最终composer checkpoint，合法重建仍要读取锚定targeted结果，不能因priorcounts令planned首轮STOP而漏失目标结果。
- 若合法模板无法与锚定actioncore确定性匹配，failclosed，不能猜测新subject或制造gapidentity。

上述均直接来自Spec §6/§12、Seam E/F/G/H与此稿，不要求扩大闭合taxonomy、identity、checkpointroot、terminal、P1STOP或runtimeauthority。

## 后续验收门禁

先建立真实composer负载路径RED（跨diagnosisround等价proposal、达到bound后的真实nextproposal），再实现。统一T14全12项重跑及负对照；新增重点覆盖：首评SATURATED/BUDGET_STOP/PROVIDER_FAILURE零targetedIO、同round二次eval无双计、targetbudget耗尽后零下一plannedIO、commit后/pre-composercheckpoint同occurrence恢复零重复付费且池/血缘不丢、UNKNOWN拒绝与合法类型正对照。最后对新exactSHA执行CODE、ARCHITECTURE/SEAM conformance、ACCEPTANCE_EVIDENCE三个角色审查。本设计PASS不宣称产品或researchvalue已验收。

SKILL_USED = code-review（问题本质 → 盲设计 → cross-check；独立架构角色）
SUBAGENTS_USED = NONE（本agent自身为root调度的独立reviewer）
PRODUCT/REPO/REF/REMOTE_MUTATION = NONE
POST_GATE_MEMORY_UPDATE_REQUIRED = NO
