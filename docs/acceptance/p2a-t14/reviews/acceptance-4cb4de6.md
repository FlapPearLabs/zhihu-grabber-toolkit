# P2A-T14 / #126 独立验收审查收据

ROLE = ACCEPTANCE_EVIDENCE_REVIEWER
REVIEWED_HEAD = 4cb4de6100e6038f6975112158c8fffb2c923194
BASE_MASTER = 854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
REVIEW_VERDICT = CHANGES_REQUESTED
ACCEPTANCE_VERDICT = NOT_PROVEN
P0_ACCEPTANCE_BLOCKERS = 0
P1_ACCEPTANCE_BLOCKERS = 3（下文 B1–B3，按根因分组）
PROVEN_PRODUCT_P0_P1 = 0（本次新审查未额外证明产品缺陷；不表示全仓无缺陷）
CLOSURE_GATE = BLOCKED
MASTER_INTEGRATION = NOT_ALLOWED
POST_GATE_MEMORY_UPDATE_REQUIRED = NO
QUALITY_CLAIM = OUT_OF_SCOPE / T15 #127

本收据仅绑定上述 exact HEAD。reviewer 从远端 full-history clone 独立检出 detached HEAD，确认 source clean、origin/master 与 BASE 相等、origin/codex/p2a-t14-acceptance 与 HEAD 相等，再执行当前 HEAD。未以祖先 16f6b8f 的执行结果、Standards/Spec supporting review 或执行者自述代替冻结 quorum。取证期间未修改 reviewed 产品/driver、提交、推送、合并或关闭 Issue。

已核对 #126 正文及已发布十二行矩阵（issuecomment-6033310166）、本轮用户冻结请求、AGENTS/RULES、Approved Spec §20、Seam Contract E/F/G/H、Seam Map、composer 与 subphase 实现。独立执行使用 Node v26.10.0，依赖按既有 lockfile 离线 npm ci 准备。环境可运行；未把环境阻塞计作 PASS。

执行命令（仓库根目录；`$T14_OUT` 表示隔离 campaign 输出目录）：

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund # cwd: zhihu-answer-grabber
node research-orchestration/scripts/p2a-t14/driver.mjs --out "$T14_OUT"
node research-orchestration/scripts/p2a-t14/package-evidence.mjs "$T14_OUT" "$T14_PACKAGE"
```

依赖准备 exit=0；统一 driver exit=2，22 场景 checks PASS，工程矩阵输出 9 PASS / 3 NOT_PROVEN；包装 exit=0、STRUCTURAL_CHECKS_OK。包装成功不授予工程 PASS。

## 十二行独立结果

下表 PASS 表示 reviewer 已核对本次 occurrence 的对应产品 observation，整体仍受 B2 证据编译器门禁阻断。§20-12 的独立结论比候选矩阵更严格。

| 冻结条款 | 独立结果 | 本次观察与限制 |
|---|---|---|
| §20-1 | NOT_PROVEN | unknown-gap occurrence 的真实 composer 仍产生已知 gap、targeted IO=2；未知记录只在 runControllerControls 的只读输入中生成并被拒绝，未进入产品 durable gap 与最终披露链。 |
| §20-2 | PASS | canonical 同 occurrence 的 final gap/action/query/provider/pool/checkpoint 全量 join，零 orphan/cross-gap；不是历史 suite 拼接。 |
| §20-3 | PASS | free-form、unsafe-plan-owned 真实 composer 拒绝并落盘，targeted IO=0；provider callback 读取到此前持久 gap 与唯一 AUTHORIZED action。 |
| §20-4 | PASS | subphase 真实复用 runMultiQueryRetrieval；rank channel、providerScope、canonical questionId、RRF 与工件 hash 对账；未建第二管线。 |
| §20-5 | PASS | provider-scope 仅支付被授权的一个渠道；all-provider-failed 显式 FAILED_OPERATIONAL、gap UNRESOLVED；离线 runtime 身份与预定配置一致。 |
| §20-6 | NOT_PROVEN | complete resume 零新增 IO已证实；跨 diagnosisRound dedupe/per-gap 拒绝仍只在 controller-boundary 输入挑战中发生，非产品实际第二轮/后续 proposal。 |
| §20-7 | NOT_PROVEN | global-budget 实际 4 planned + 2 targeted、拒绝后续 gap；终态 EXHAUSTED_WITHIN_BUDGET。per-gap 到上限后真实下一动作拒绝尚无完整链。 |
| §20-8 | PASS | canonical 以结果300/301证据 RESOLVED；duplicate-only、contradiction-one-side、authority-unavailable 保持 UNRESOLVED。未以 query执行量或模型自述当 resolution。 |
| §20-9 | PASS | 全部 durable gap逐条进入 coverage-final.json 与 research-result.json 的相同block；未解决/预算耗尽终态可见，未被 SATURATED 覆盖。 |
| §20-10 | PASS | 两个真实 SIGKILL 窗口、ordinary resume：commit前 targeted增量2（两个provider各执行一次），commit后增量0；各 action COMMIT=1，checkpoint/pool hash一致。 |
| §20-11 | PASS | 独立前向/反向机械join核验，canonical 44个input/output引用逐字节SHA256相等；锚定ledger内容hash成立，便携工件引用无绝对机器路径。 |
| §20-12 | NOT_PROVEN | 池/绑定/披露篡改与完整 replay方向确实生效；stale-action 样本却未真正调用陈旧action校验，缺少冻结陈旧plan/action occurrence身份挑战。 |

§20-13 OUT_OF_SCOPE；没有研究质量改善声明。

## P1 acceptance blockers

B1 — §20-1/6/7 缺少完整组合链（根因组）。`runTargetedSubphase` 固定 SUBPHASE_DIAGNOSIS_ROUND=0，`diagnoseGaps` 只生成三种已知类型，composer planned loop 后只调用一次定向子阶段；每 gap 只选一个匹配 proposal。`runControllerControls` 自己标明 productionSecondDiagnosisRound=false、authorityLedgerWritten=false。public guard 对照确实 load-bearing，但不能冒充 composer 实际 persistence/round-trip。保持 NOT_PROVEN。

B2 — matrix 编译器可输出缺证据/相矛盾的 PASS，TEST/HARNESS_BUG。`research-orchestration/scripts/p2a-t14/matrix.mjs:25–34` 未要求 LINEAGE_JOIN；`passed`只读取旧check.pass。用本次真实campaign逐项故障注入：删除 canonical.lineage 后 §20-2/4/8/9/11 仍 PASS，同时 principalRun.lineage=NOT_PROVEN；令 lineage.valid=false/joins=[]、观察provider计数=999、正常child exitCode=1，也仍输出上述 PASS。缺SHA/runId/commands/input/output/计数字段会降为 NOT_PROVEN，这部分负控通过。修复需把必填及具体观察一致性纳入负载门禁，不能只信自述 checks。属于已授权的普通 harness 修复，无需用户架构决定。

B3 — stale-action 场景未执行陈旧action身份回归，TEST/HARNESS_EVIDENCE_GAP。`fixtures.mjs:152`把 proposal.gapId 改成全零；subphase `proposals.find(p.gapId===gap.gapId)`找不到，直接走 no-proposal continue。原始观察 action=0、rejected=0、replay=null、targetedIO=0；这是没有可消费proposal，不能证明 stale action验证阻止执行。driver还豁免该场景的 rejected proposal recorded，而 matrix §20-12 未引用它。需要让当前 occurrence 真实产生的 action/ledger 在既有 fault/replay 接缝中受到 stale plan/action occurrence/binding 挑战并检查可执行方向。属于普通 evidence补齐；不得以架构STOP搁置。

## 负控、lineage 与崩溃复核

- source dirty：unstaged、staged、untracked分别退出1，命中T14_EXACT_SOURCE_DIRTY；输出目录未创建，provider IO未发生。恢复后clone仍clean。
- corpus/capture/semantic/embedding仅外部IO使用deterministic doubles；内部 verifier、composition、diagnosis/authorization、retrieval/fusion、commit/resolution/finalization均真实执行。没有旧focused-suite拼接。
- canonical ledger锚定hash、action artifactHash、checkpoint binding及pool字节hash全部一致。action/result/final gap一一对应，result300/301均反向回到同一action/gap/final artifact。
- crash-before：initial SIGKILL=137，checkpoint仅AUTHORIZED，无targeted完成binding；RERUN，targeted从2到4；两次ordinary resume exit=0，第二次无IO增量。
- crash-after：initial SIGKILL=137，checkpoint COMMITTED、pool hash有完成binding；REUSE，targeted从2到2；两次ordinary resume exit=0。planned pool未在该window锚定，第一次resume仍发生4次planned IO，不能称所有provider IO零增量。
- tampered-pool/stale-binding/missing-resolution/tampered-resolution/foreign-resolution均拒绝reuse且无新增provider IO；canonical-ledger-drift修改展示文件不能成为第二replay credential，仍从checkpoint锚定版本复用。
- guard正负对照在unknown/dedupe/per-gap限制上改变仅相应上下文输入，生产authority文件hash不变。这可证明局部guard存在，不能授予B1全链PASS。

## USER_DECISION_REQUIRED 独立判断

对 B1 的缺失 composer未知诊断生产与同occurrence第二诊断/后续proposal调度，现有允许接缝没有可直接闭合的入口。将这些输入纳入产品authority、改变单次消费/轮次调度，确实涉及架构与调度语义决定；不能用内部authority mock、手写durable JSON、guard-only链替代用户冻结的产品组合链。就这一有限范围，USER_DECISION_REQUIRED成立。

这不批准候选 USER-DECISION 文档中的具体API或设计，也不授权修改Spec。尤其 B2/B3 已有可行的普通验收修复路径，应先完成；不能把全部任务立即停给用户。待普通修复完成并fresh review后，才将仍存在的B1最小架构决策包交由owner裁决。没有证据要求修改终态集合、identity权威或checkpoint唯一信任根。

## 证据定位与绑定

本次 canonical runId=1f9f4cff28ea450bdf88493ff11cf464ffd71eb836ff194428f9d1e2a6b2a699；occurrenceId=c91a9693-76ac-46fd-ac17-4ecb5d3ba37f；planId=39f4096876cbace36fbf65576177964f0f689f678b7a48b59ab577ecf5f63f4b；generation=c91a9693-76ac-46fd-ac17-4ecb5d3ba37f。

以下引用相对本收据所在的隔离 evidence 根；迁入仓库前应连同必需工件按相对结构归档，不含秘密或机器路径：

| 工件 | SHA256 |
|---|---|
| reviewer-run-4cb4de6/campaign.json | 7a53f3ef67194bcdddcaf5f64e8d6d7221e122279f827a8a8114a4049cee986f |
| reviewer-run-4cb4de6/matrix.json | aee275c344a4cbcb064df49d61d49477eeff8b8d82456278e9cb7349aca678e0 |
| reviewer-matrix-negative.json | 40cc5350de4344a3f1f54bf46be96651e6bc75426bf2ffef043fc31a350761ff |
| reviewer-dirty-negative.json | fb98568688ea8f11dc2c93f59d90f5e637dc146b878af7d9c05085b58e16e9bc |
| reviewer-lineage-hash-summary.json | 0a760f094b3fd48f2c0b7bbb2950b50d714f6ccff72183b13b8288f2ea535570 |

portable实际产品工件包：reviewer-package-4cb4de6/；每scenario的evidence-record、manifest、artifact SHA256、initial/final summary可机械复核。原始运行：reviewer-run-4cb4de6/各scenario/work、stdout/stderr、initial/final-observation与evidence.json。负控原始日志仅保留隔离临时区，不直接提交包含机器调用栈的文件。

#126 不得close completed；#108 ENGINEERING_ACCEPTANCE不得COMPLETE；master不得集成。全部十二条PASS、同exactSHA独立quorum PASS、证据推送、fresh clone复验和live远端SHA核验均满足后才可解除。任何修复新SHA都必须fresh independent review，本收据绝不转授。

本reviewer未调用子代理或Skill；使用独立Subagent上下文、GitHub只读connector、隔离clone与离线运行。未更新规则/门禁/产品文档；只生成本否定审查收据和临时原始复核产物。
