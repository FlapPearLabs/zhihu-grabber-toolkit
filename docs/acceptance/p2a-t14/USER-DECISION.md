# T14 完整链缺口：待产品负责人决定

STATUS = USER_DECISION_REQUIRED（候选；正式独立验收审查仍须核对）
CURRENT_TASK = P2A-T14 / #126
BASE_MASTER = 854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
EXECUTABLE_CANDIDATE = 19c281d30bc076f2ddd8a5c0c2b474f138ae3d8e
MASTER_INTEGRATION = NOT_AUTHORIZED_BY_ACCEPTANCE_GATE
ISSUE_CLOSE = NOT_ALLOWED

## 已完成授权范围

真实 composition 的诊断、持久gap、授权、既有检索、融合/身份/血缘、commit/checkpoint、resolution与最终披露已运行。本次22个互斥场景各有具体occurrence，SIGKILL/replay与缺失/篡改负控使用真实产品工件。缺失gap可见性、scope执行偏差、终态落盘与COMPLETE依赖闭包P1已按既有冻结语义最小修复。Standards审查发现的staged-source身份P2也已修复，并在三个隔离clone独立验证。

## 三项未闭合义务

| 条款 | 已证实 | 缺失的完整链证据 |
|---|---|---|
| §20-1 | T01未知类型规范化与生产controller拒绝、放宽类型的正控、zero额外IO | composer真实持久未知gap并走到最终披露 |
| §20-6 | 从本次checkpoint锚定ledger推导的跨diagnosisRound去重/per-gap拒绝及正控 | composer实际调度第二诊断轮/下一proposal，持久化真实拒绝 |
| §20-7 | 全局预算包含planned+targeted，真实后续gap预算拒绝；预算终态诚实 | composer真实触发per-gap下一动作并拒绝；终态存在不能替代实际上界负控 |

当前 `diagnoseGaps` 只生产三种已知MVP类型；`runTargetedSubphase` 固定diagnosisRound=0，每gap只消费一个proposal；composer只在planned loop后调用一次子阶段。ordinary resume先走checkpoint replay，不重新授权。直接调用公开guard虽可验证局部保护，却没有产品持久化的未知gap或第二轮全链。

这些缺口未被证明是产品P0/P1。为了满足完整链新增未知诊断生产入口、轮次调度或proposal消费语义，已超出本票默认evidence授权。不能把内部authority mock、手改durable JSON、或guard-only对照升级为完整T14 PASS。

## 建议授权范围

建议产品负责人授权一份小型架构/Seam amendment，供独立architecture reviewer审批后实施：

1. 定义controller拥有的诊断生产接缝，使合法未知记录能按T01规范化、持久化、拒绝检索并最终披露；未经controller验证的外部字段不能成为gap authority。
2. 定义同occurrence内有界的诊断/后续proposal调度，让跨轮等价proposal和达到per-gap上限后的下一proposal真实经过既有T04/T05并持久拒绝。调度上限与STOP优先级必须明确，不能把targeted动作算作P1 retrieval round。
3. 保持现有T01 gapIdentityCore、T05 dedupeKey/actionId、T06 checkpoint唯一authority、T07计数、T08 terminal集合与谓词、runtime/provider白名单和唯一retrieval路径。改变这些更高层合同必须另行明确裁决，不能夹带。
4. 新接缝先有RED对照，再实现最小接线；同一统一driver重跑三项缺口及全部受影响场景，最终fresh exact-SHA审查后才可推进#126。

授权不等于当前草案已批准，也不意味着立即合入产品。具体API、持久化和crash窗口需形成可审查Seam差异并通过独立architecture quorum；本候选没有实施上述新增行为。

## 不改变验收标准

保留当前九项候选PASS、三项NOT_PROVEN；#126保持OPEN，#108 ENGINEERING_ACCEPTANCE不能标COMPLETE。#107/#127仍不开始。若负责人选择暂不授权扩展，候选修复和证据保存在分支与draft PR，继续保持T14未完成，不宣称价值改善。

触发来源是本轮用户请求的Product Code Change Policy与Operating Mode：“architecture change”“product semantics change”“identity/authority boundary change”需USER_DECISION_REQUIRED。这里请求的是新增组合接缝/调度的架构授权，不是重复询问已授权的测试、P2修复、模型替代或提交工作。

普通修复状态：4cb4de6 独立审查指出的 matrix false-PASS 与 stale-action 空场景已在 19c281d 修复并执行统一整链，新的 fresh quorum 尚待核对。只有这两组普通修复闭合后，才把本文的三项有限架构缺口作为最终 USER_DECISION_REQUIRED；本文件不降低任何验收条件。
