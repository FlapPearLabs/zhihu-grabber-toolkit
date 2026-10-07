# SPEC_VS_T14_ACCEPTANCE_REVIEW

REVIEWED_HEAD = 054ef8d8aafa26372af5b695b0ddb54e766b507b
BASE = 854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
ROLE = independent ARCHITECTURE_SEAM_REVIEWER / SPEC_VS_T14_ACCEPTANCE_REVIEW
AUTHORITY_REVIEW_VERDICT = PASS
P0 = 0
P1 = 0
ACCEPTANCE_OVERREACH_CORRECTED = YES
IMPLEMENTATION_AMENDMENT_REVIEW = PENDING (未收到最小设计稿，不构成实现前架构 PASS)

## 问题本质与冻结约束

本审查独立先读当前用户授权全文、Approved Spec、SEAM E/F/G/H、seam map、AGENTS.md、RULES.md、CONTEXT.md 和项目 memory；未看 USER-DECISION.md 或产品实现 diff。AGENTS.md:24-29 明确 Approved Spec 优于便利性票据描述；Spec:23-25 明确语义唯一权威是 Spec。

§20-1 的工程目标是封闭类型枚举和未知类型不得触发检索；§20-9 的工程目标是合法未解决 gap 的可见性。这两个目标不能合并为“未知类型必须成为合法持久化 gap，再在最终研究披露中展示”。

## 权威判定

**无 Approved 权威要求 unknown 成为合法 durable gap 并走最终披露。该额外验收条件应撤回，记 ACCEPTANCE_OVERREACH_CORRECTED。**

证据：

- `docs/specs/p2-ari-f02-targeted-requery.md:119-125`：MVP 仅 ASPECT_GAP / CONTRADICTION_GAP / AUTHORITY_GAP（封闭枚举）；未解决 gap 可见性与持久 ledger 要求均在这个 MVP 定义内。
- 同文件 `365-369`：未知类型“可记录，【不得】转成检索动作”；“可”不是强制 durable research gap。
- 同文件 `564`：§20-1 只要求显式枚举及未知类型不产生检索动作。
- 同文件 `572`：§20-9 要求未解决 gap 最终可见，不能借此扩大 §20-1 的类型集合。
- `docs/planning/P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1.md:75-86`：封闭三类型；其他类型一律 UNKNOWN_GAP_TYPE，可记录而不得变检索动作。
- 同文件 `91-99`：gapIdentityCore 的 gapType 限 E.1 枚举成员，diagnosisRound 仅审计；该 identity 合同不能用于发明第四类有效 gap。
- 同文件 `172-182,201`：有效 targeted proposal 必须引用已存在 gapId；授权要求 gapType 属枚举。
- Spec `149-168,386-391`：模型只 proposal，controller 唯一拥有状态、身份、授权、IO、resolution 等权威。

T01 的 unknown compatibility / audit rejection 记录可以继续保存既有兼容性证据。它证明拒绝边界，不自动赋予 canonical legitimate gap 身份。合法 durable gap 的身份、checkpoint 持久化和最终未解决披露仍必须用三种枚举类型分别验证；“recordable unknown”与“合法研究 gap”必须分开。

## Blind design：合法最小 diagnostic ingress

干净设计先将诊断候选和已通过 controller 校验的合法 gap 分开。composition 可将 unknown diagnostic candidate 送进 controller-owned validation；controller 首先校验枚举，返回 UNKNOWN_GAP_TYPE 或等价 fail-closed 决定。unknown 不获得有效 gapId、不调用合法 gap ledger 插入、不构造 TargetedQueryAction、不调用 retrieval/provider。已有 rejection audit 若能表达该拒绝则复用；不得造 durable UNKNOWN object。

允许的真实组合证据链是：unknown diagnostic candidate → composer 驱动 controller-owned validation → 明确拒绝 → TargetedQueryAction 增量 0 → provider IO 增量 0。应同时核验合法 durable gap ledger 无 unknown 成员、无新增 identity/状态词、planHash/occurrence/P1 round/checkpoint 语义不变。不得以单元调用 validator 替代 composition 证据；不得绕过未知类型门向下游注入伪造合法 gap。

最小诊断入口必须是数据入口、由现有 controller 重新校验，不能是让 caller 提供任意已授权 action 或绕过预算的执行钩子。它只解决现有 composition 未能驱动真实拒绝缝的可观测性，不能更改 MVP 诊断成立规则（provenance-based、无内容归因）。若引入模型参与诊断，只能通过已授权 runtime 且输出仍属不可信 proposal；本阶段未批准新的 runtime 方法或 whitelist。

## Cross-check 与下一门禁

冻结 Spec 与本次用户授权对此一致，未见必须请求更大产品权威的冲突。§20-1 matrix 应去掉“真实持久未知 gap → final disclosure”的要求，并保留组合 fail-closed / 零 action / 零 provider IO。当前没有阅读或认定任何旧 B1 finding 为 Spec 权威。

后续收到最小 amendment 后，另行审 caller/callee/input/output/state transition/termination/crash/budget/STOP/resume/no-new-authority。**本报告 PASS 仅为 acceptance authority correction PASS；不能作为未见设计稿的 ARCHITECTURE_SEAM_REVIEWER 实现许可。**

POST_GATE_MEMORY_UPDATE_REQUIRED = NO（该审查属于本任务临时权威校正证据，不修改被审仓库或全局 memory）
PRODUCT/REPO/REF/REMOTE_MUTATION = NONE

## 实施前 STOP 解释预审（收到 root 的设计问题后；仍非完整 amendment PASS）

不可将 `runRetrievalFeedbackLoop` 已返回的 `SATURATED` 重新定义为“仅 planned-loop 控制”：Spec:466-477 的 run STOP 语义、Seam Contract H.1:665-671/H.2:679-682 明确 targeted 不得阻止 SATURATED，T07 返回 SATURATED 时 run 停止。Seam Map:391-416 的 STOP producer 就是既有 T07，效果要求 STOP 语义零变化。Spec:454-455 的 STAGE_SEARCH/T08 前边界没有给 STOP 后执行 IO 的授权。

若把 bounded repeat 留在当前已返回 STOP 的 composer 子阶段而继续执行 provider，则为 STOP 合同实质越界（P1），不能架构 PASS。简单将 targeted 调度移至当前本来会 STOP 的最终 evaluate 之前也可能推迟 STOP、抢先执行 IO，必须防止该行为。

合法最小方向：在同一 planned round 的既有 T07 评估返回 CONTINUE 后、下一 planned round 之前提供 controller-owned targeted 子阶段调用缝；若返回任一 run STOP 就不执行定向 IO，按 H-8 终结 gap。targeted 不新增 round，不改计划评估输入/判据，不用 targeted pool novelty 重写当前 planned saturation 结论；每次动作继续经 T04/T05 的预算/去重准入，动作后全局耗尽由controller停止。若此方向实现不满足原调用生命周期，需在设计稿明确重排而不是静默绕过 STOP。若任务要求“已 SATURATED 仍定向 IO”，属于 USER_DECISION_REQUIRED。
