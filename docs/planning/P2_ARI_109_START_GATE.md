# #109 / P2-F03 — Escape Probe START GATE

DATE = 2026-10-08
GATE_SCOPE = START_GATE_ONLY
#109_START_GATE = NOT_YET_JUSTIFIED
IMPLEMENTATION_AUTHORIZATION = NONE
PRODUCT_MUTATION = NONE
SPEC_OR_AUTHORITY_AMENDMENT = NONE
PROJECT_MEMORY_UPDATE_REQUIRED = NO
CURRENT_MASTER_AT_GATE = e9a94f652c1c376face7b77acf82750b244f2d50
UPSTREAM_STATE = #107 / #127 / #108 CLOSED / COMPLETED
T15_VALUE_ACCEPTANCE = UNKNOWN / INCONCLUSIVE

本 gate 依据已完成 #107 的全部 case 与 #108/T15 真实价值结论作是否开工判断，未实现 #109。证据见 [#107完整campaign](../acceptance/p2-f01/campaign-bound/campaign.json)、[T15价值记录](../acceptance/p2a-t15/P2A_T15_VALUE_EVALUATION.md) 和 [#108最终状态](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/issues/108)。#108 工程完成，价值为 UNKNOWN / INCONCLUSIVE；两案合成target增益、两案无增益、一案INVALID，现实dogfood未运行。没有通过roadmap顺序推断READY。

## 五个问题

1. **false saturation 是否真实出现？** 在LOWGAIN-04冻结合成轨迹中，STOP=zero_new_candidates，aspect仅1/2、counter/key均0/1，重复率candidate=.8125，相关缺口未解决；证明该人工curated trajectory仍漏目标。关键4403在全部公开routes不可达，没有真实用户研究或可达逃逸route证据，不能据此证明现实false-stop，不能证明一个escape round能找回目标。AUTHORITY-03是selector clarification_required的运行未完成，不是饱和STOP证据；不得触发escape处理操作失败。

2. **#108是否已解决大部分相关失败？** UNKNOWN。它在ASPECT/COUNTER提高curated发现，在LOWGAIN增加4次检索仍无目标增益。样本是固定公开plan+合成double，没有真实失败分布的分母，因此不能说“大部分已解决”，也不能说“大部分未解决”。生产gap未从这些metric hit变成RESOLVED。

3. **ONE_ESCAPE_ROUND仍是最小充分方案？** 最小有界候选假设可以保留，但充分性NOT_PROVEN。没有实际probe run、stop reversal、material gain或额外成本对照。若未来取得promotion evidence，先比较不超过一round/三种intent的简单策略；本轮不创建probe schema、reserved-budget状态或修改STOP。若计划外自由query是唯一可达路径，将需要后续独立字符串信任与授权论证，不能借此gate绕过当前plan-owned边界。

4. **哪些#108 primitives可复用？** Approved Spec §18要求复用TargetedQueryAction身份与授权。既有[authorization](../../research-orchestration/lib/targeted-requery-authorization.mjs) 提供query归一化、dedupeKey、targetedActionId、providerScope/per-gap/global preflight；[ledger](../../research-orchestration/lib/targeted-requery-ledger.mjs) 提供plan/occurrence/gap/action身份；[attempts](../../research-orchestration/lib/targeted-requery-attempts.mjs) 与 [subphase](../../research-orchestration/lib/targeted-requery-subphase.mjs) 与[lifecycle](../../research-orchestration/lib/targeted-requery-lifecycle.mjs) 提供预算执行、durable action/lineage、重启不重放；既有controller/provider seam/fusion、source identity、verification、selected/analyzed/research reuse closure与unresolved记录面继续消费。它们是可复用mechanism，不是已有escape policy：当前closed gap/authorization契约不自动接纳新probe family或STOP candidate；未来policy触发和material-gain判定须有单独冻结语义与独立review。不得另建search/run/hash/provenance框架或给模型STOP/IO/identity authority。

5. **真实promotion evidence是否存在？** NO / NOT_PROVEN。没有现实false-stop复现、可达alternative route恢复关键来源、或真实probe改变final synthesis的证据。合成LOWGAIN缺口与#108无增益值得保留作下一次研究假设，但不构成生产开工授权。

## 结论与下一最小行动

NOT_YET_JUSTIFIED，不判NEEDS_SCOPE_REDUCTION：当前ONE_ESCAPE_ROUND/最多三intent的scope已足够小，缺的是经验证的promotion evidence。建议先收集少量可冻结真实dogfood，保留真实来源provenance与同配置baseline/candidate、饱和STOP依据、可达alternative route和material evidence/final support，再经#107复现失败与成本；凭据不可用时保持现实结论UNKNOWN。不要修改本次冻结routes或删LOWGAIN来制造优势。

未来若重新进入gate，只考虑由saturation/low marginal gain产生且还有预算的STOP candidate。credential/provider failure、user cancel、硬预算耗尽、非法provenance或产品invariant失败不得作为饱和；材料增益不能用候选数/查询量替代。未来probe最多一round，找到material evidence才由controller撤销STOP，否则只记录该预算内未发现新材料，不声称全局完备。

#109保持OPEN，只有START_GATE完成；#110=DESIGN_ONLY / IMPLEMENT_NOW=NO，#111/#112仅roadmap。本轮没有新增产品实现、Spec、Ticket Graph、STOP或authority变更。
