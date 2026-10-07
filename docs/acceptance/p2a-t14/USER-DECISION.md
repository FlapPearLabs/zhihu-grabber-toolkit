# T14 有限架构授权与验收权威校正

STATUS = PARTIAL_ARCHITECTURE_AUTHORIZATION_GRANTED
CURRENT_TASK = P2A-T14 / #126，B1：§20-1 / §20-6 / §20-7
BASE_MASTER = 854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
PR = #132；新实现不能继承旧 SHA 的 review。

负责人已批准有限 controller-owned bounded followup 接线，并明确要求先独立设计审查、真实 RED，再实施。
批准的是本文列出的边界，原本的 USER-DECISION.md 建议不被逐句追认。
设计和独立原始审批收据见 [ARCHITECTURE-APPROVALS.json](ARCHITECTURE-APPROVALS.json)。

## ACCEPTANCE_OVERREACH_CORRECTED

“unknown 必须成为合法 durable gap 并进入最终研究披露”没有冻结 Approved Spec/Seam 权威，已撤回。
MVP 合法 gap 仍仅 ASPECT_GAP、CONTRADICTION_GAP、AUTHORITY_GAP。
§20-1 的整链义务为 unknown diagnostic candidate → controller 类型校验 → UNKNOWN_GAP_TYPE 拒绝审计 →
零 TargetedQueryAction、零 targeted provider IO。unknown 不进入合法 gap ledger；合法类型另有正对照。
旧 9/3 否定收据保持历史原文；本校正不把旧结果改写为新候选 PASS。

## 已批准的最小设计

每个 diagnosis pass 仅处理 eligible unresolved core，每 gap 至多一个 proposal，继续经过原 T04/T05。
同 occurrence 的跨 pass 等价 proposal 由原 core dedupe 拒绝；达到原 per-gap bound 后的实际 next proposal
由原 controller 拒绝。global budget、既有 T08 re-evaluation、terminal 与 STOP 共同保证有界退出。
diagnosisRound 仅审计；不改变 core、dedupe、actionId、planHash、occurrence、P1 retrieval round。

targeted IO 只能发生于首个真实 T07 CONTINUE 窗口；callback 后用同一 coverageBefore 和同一 planned facts
再次纯评估更新 targeted budget，最终 apply 一次。targeted candidates 不影响 planned novelty/saturation。
STOP-only 恢复只能读取 checkpoint-bound 已提交池并补齐 T08，不能新授权或付费。

冻结 G.1/G.4 输入按 action 执行前保存：controller-derived resolution-input 在原 AUTHORIZED writeState
中与 ledger 一起锚定；安全重跑不覆盖，欠 T08 恢复只消费原快照。快照只供 T08，不作授权、replay、预算或
STOP 权限。旧 terminal 保留；缺少/损坏的 pending 输入诚实 fail closed，不用当前 pool 猜测 RESOLVED。
默认严格安全检查不带信任豁免；staging 使用固定短目录和完整快照 hash，checkpoint 仍逐 action 绑定。

不新增 generic scheduler、arbitrary action graph、adaptive planner、priority engine、learned policy、#110
行为或第二 retrieval pipeline。T01/T05/T06/T07/T08、P1 STOP、provider/runtime 权限均保持冻结。

## 最终门禁

真实 RED 证明旧实现无法调度第二 pass/limit 后 next proposal；双向 planned-provider 漂移的真实 SIGKILL
反例证明原输入恢复问题。新候选须统一重跑所有 §20-1…§20-12 及受影响场景，不能拼旧九项与三个局部测试。
新 exact SHA 必须 CODE、ARCHITECTURE/SEAM conformance、ACCEPTANCE_EVIDENCE 三角色 PASS，P0=0/P1=0、
12 PASS、ACCEPTANCE_BLOCKERS=0 后，才可 PR ready、ff-only、远端 master 相等、fresh clone T14 重跑、close #126。
普通实现、测试、fixture、P2、模型 fallback 自主推进；只有突破上述冻结权限才 USER_DECISION_REQUIRED。
§20-13 仍属于 #107 + #127 / T15；本票只作 ENGINEERING_ACCEPTANCE，不声明研究质量改善。
