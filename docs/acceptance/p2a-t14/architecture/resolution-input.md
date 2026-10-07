# T14 最小补充：恢复每 action 原有 T08 输入

STATUS = REVIEW_PENDING（独立 ARCHITECTURE_SEAM_REVIEWER PASS 才实施）。
BASE_HEAD = 054ef8d8aafa26372af5b695b0ddb54e766b507b。
PREVIOUS_AMENDMENT_SHA256 = 734658c03e7c8d5f50fc55cc5af5578967ad890dd842952ef15363c4c27d8b19。
范围仅补齐冻结 Seam G.1/G.4 的跨崩溃输入恢复；此前有限 followup / STOP 接线设计继续适用。

## 问题与最小材料

COMMITTED 后欠 T08 的恢复不能使用恢复后的 planned pool 代替原 action 执行前的 pool。
保存 controller-derived TargetedResolutionInput v1：严格字段 schemaVersion、type、targetedActionId、
planHash、occurrenceId、priorQuestionIds、declaredFraming、coveredFramings。
来源 ID 取原 workingPool 的候选，字符串化、去重并确定性排序；framing 沿用现有 defaultFramingForGap
或既有显式 framingForGap 的原输入，字符串数组仅去重排序，不改变 T08 的谓词。
非 CONTRADICTION gap 的 framing 输入为 null。所有字段走既有 assertArtifactSafe，trust set 仍仅
plan.queryVariants；不会把 targeted query 或新增 plan 材料加到信任集合。

## 调用面

caller = composeP1Research，callee = runTargetedSubphase。
composer 新增注入 stageResolutionInputBytes(actionId, bytes) 与 resolveResolutionInputBytes(actionId, sha)。
发布复用 stageArtifactBytes；读取复用 inspectCommittedArtifact，仅返回与 checkpoint hash 相同的字节。
机械键 targeted-resolution-input:<targetedActionId>，路径从原 actionId 派生，不能由 proposal 指定。
不添加 action record 字段，不改变 targetedActionId、gapIdentityCore、dedupeKey、planHash、occurrence。
快照仅存既有 content-addressed staging，不需要单独 canonical store；检查 helper 可接受同 action 下
resolution-input.json 的 canonical 路径作为已有通用校验接口参数，但文件存在本身不赋权。
stage/resolve 回调由 composer spread-LAST 注入，opt-in producer 不可替换它们。

## 原子顺序与恢复

新 action 已经通过既有 T04/T05：registerAuthorizedAction → 派生原输入并安全校验 → 发布快照字节 →
在 currentState.hashes 添加快照绑定 → stage 原 AUTHORIZED ledger → 既有 anchorLedgerVersion →
同一次原 writeState。任何 provider IO 都在这一次 checkpoint 之后。
发布之后、writeState 之前崩溃留下的孤立字节不具备权限；原 F.5 ledger/replay 仍作唯一支付判断。
after_targeted_execution / prepare / finalize 的既有窗口与 T06 retrieval commit point 不变。
AUTHORIZED-only 安全重跑读取原 checkpoint-bound 快照，不得以恢复时 pool 覆盖；缺少/损坏先 fail closed，
不重复 provider IO，不产生猜测的 RESOLVED。首次新 action 才允许创建快照。
COMMITTED/EVALUATED 欠 T08 时用有效快照 + 原有效 targeted 结果池调用既有 evaluateResolution，
之后再 merge targeted pool。已 terminal 结论原样保留，不因新快照或 provider 漂移重算。
绑定检查包含 actionId、planHash、occurrenceId、严格字段、canonical 数组和安全 walk；缺失、损坏、
scope 不一致明确 subphase failure，不降级为当前 pool 推测，不借快照支付或重授权。
旧已 terminal action 可以沿用原历史，无需伪造新输入；旧 pending action 缺失原输入只能诚实 fail closed。

## 同一根与材料存活

state.hashes 与原 writeState 仍是唯一 durable trust root；快照不被 decideTargetedReplay、T04/T05、
T07、round controller 或 STOP 消费。快照是 T08 输入材料，绝不是 completion credential。
targetedBindingsOf 在 ordinary resume 与 COMPLETE checkpoint rebuild 同时保留该固定派生 namespace 的
64-hex hash。原 stage-boundary materialize/cleanup 不包含 snapshot key，不删除其 staging 字节；
增加行为检查证明 after ordinary resume 与 COMPLETE snapshot 字节/绑定均仍在。
没有第二 authority store、检索路径、scheduler、回合/预算规则或身份语义。

## 终止性、STOP、预算

不增加任何循环或 provider IO。原 amendment 的有界 pass 证明不变。
STOP 后仍只复用 committed pool；快照读取不能改变 executionAllowed 或许可 AUTHORIZED-only 付费。
原 planned + targeted 预算及 terminal 判据保持；只恢复冻结 G.1 对“该 action 执行前”的定义。

## 先 RED 再 GREEN 与最终义务

真实 public composer / SIGKILL after_targeted_commit_finalize：原 prior 含300、targeted300，resumeplanned
去掉300，必须仍 DUPLICATE_ONLY/非RESOLVED且targeted IO增量0；现有 dirty 代码先实际 RED exit1。
反向原 prior 没有300而targeted300新增，resumeplanned加300，原新增判据仍保持。
contradiction framing 漂移、AUTHORIZED-only 原输入、missing/tamper/wrong action/wrong occurrence、
COMPLETE 与 ordinary resume 存活均回归；负控必须实际撤销 PASS。
单测 supporting 不能代替全统一 T14 campaign。新 exact SHA 仍须 CODE、ARCHITECTURE/SEAM conformance、
ACCEPTANCE_EVIDENCE quorum 后才能集成/close。

## Blast radius

实际 CodeGraph impact/callers/callees 已核对 stageArtifactBytes、stagingKeysAnchoredByCheckpoint 及
runTargetedSubphase / composer；affected 包括 T09/T11、P1 runtime/occurrence/reuse、provider/RRF。
不改变 stageArtifactBytes、inspectCommittedArtifact 的契约；新增 resolver 只是使用它们。
修改仅 subphase、composer 的上述接线与相关 T09/T11 helper 和有负载的恢复测试。
