# P2A-T14 / #126 独立验收审查收据

ROLE = ACCEPTANCE_EVIDENCE_REVIEWER
REVIEWED_HEAD = 96a4cc3b5b851e29589ecd80cc308baeae3356ca
BASE_MASTER = 854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
REVIEW_VERDICT = CHANGES_REQUESTED
ACCEPTANCE_VERDICT = NOT_PROVEN
P0_ACCEPTANCE_BLOCKERS = 0
P1_ACCEPTANCE_BLOCKERS = 1（B1，三项完整链缺口的同一根因）
B2_MATRIX_REPAIR = CLOSED_ON_THIS_EXACT_HEAD
B3_STALE_ACTION_EVIDENCE_REPAIR = CLOSED_ON_THIS_EXACT_HEAD
CLOSURE_GATE = BLOCKED
MASTER_INTEGRATION = NOT_ALLOWED
POST_GATE_MEMORY_UPDATE_REQUIRED = NO
QUALITY_CLAIM = OUT_OF_SCOPE / T15 #127

本收据只绑定上述 exact HEAD。reviewer 使用 fresh 独立上下文，从远端 full-history clone 检出 detached HEAD，确认候选 clean、master 与 BASE 相等、feature branch 与 HEAD 相等，再运行当前 HEAD。没有把 sourceSHA 19c281d 或任何祖先执行、执行者汇报、旧 review、Standards/Spec supporting review 当作本轮 PASS authority。最新入口保留 producing SHA；其 108 项 sourceInputs 与当前 HEAD 字节指纹相等，但本轮结论仍来自当前 HEAD 的独立执行。

已核对用户冻结请求、GitHub #126 正文与 issuecomment-6033310166 十二行矩阵、AGENTS/RULES、Approved P2 §3/§6/§9/§12/§19/§20、Approved P1 §4.3、Seam Map S1–S11、Seam Contract E/F/G/H 及真实 composition 实现。本轮不重做 START、不回 T10、不实施 #107 或 §20-13/T15。reviewer 未修复产品/harness、提交、推送、合并或关闭票；临时 source-dirty 负控结束后恢复 exact clean bytes。

## 本轮执行

以 Node v26.10.0 执行；依赖按既有 lockfile 离线安装。命令中的变量代表独立临时根，不是 repo 中的绝对路径：

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund # cwd: zhihu-answer-grabber
node research-orchestration/scripts/p2a-t14/driver.mjs --out "$T14_OUT"
node research-orchestration/scripts/p2a-t14/package-evidence.mjs "$T14_OUT" "$T14_PACKAGE"
node research-orchestration/scripts/run-classified-research-suites.mjs guard
node reviewer-negatives-96a4cc3.mjs
python3 reviewer-independent-audit-96a4cc3.py
node reviewer-restart-96a4cc3.mjs
```

依赖准备 exit=0；driver exit=2，22/22 scenario checks PASS、十二行工程矩阵 9 PASS / 0 FAIL / 3 NOT_PROVEN；包装 exit=0、STRUCTURAL_CHECKS_OK；guard exit=0；独立负控/audit/restart 脚本 exit=0。这些脚本成功只代表记录的观察，不将 NOT_PROVEN 升为 PASS。未在不可用 Node22 上宣称通过。

## 十二行 reviewer verdict

每项下述 PASS 来自本轮具体 occurrence 的产品链；原始 evidence.json 记录 exact SHA、run/occurrence/plan/generation、child command/exit、输入输出 hash、provider 计数与正负对照。不同互斥状态使用独立 occurrence，未跨历史 suite 拼接。

| 冻结条款 | 独立结果 | 本轮观察与限制 |
|---|---|---|
| §20-1 | NOT_PROVEN | unknown-gap occurrence 的 composer 实际 durable gap 仍为已知 ASPECT 类型、targeted IO=2。未知类型只在锚定事实派生的 controller-boundary challenge 中被拒绝，缺产品未知 durable gap→拒绝→最终披露整链。 |
| §20-2 | PASS | canonical final gap→action→query/scope→pool/result 与反向 join 完整；每次 targeted provider callback 已能读取 durable gap 与唯一 AUTHORIZED action。 |
| §20-3 | PASS | free-form 与 unsafe-plan-owned 真实 composer 记录拒绝、targeted IO=0；授权与 durable gap 在 targeted provider callback 前存在。 |
| §20-4 | PASS | subphase 调用既有 runMultiQueryRetrieval，provider seam/RRF/canonical questionId/provenance/accumulated pool 均执行真实实现。result300/301的渠道与 RRF 数值机械对账，无第二管线。 |
| §20-5 | PASS | provider-scope 只有被授权渠道的一次 targeted IO；canonical 与 all-provider-failed 保持声明的 runtime/provider 身份；全 provider 失败记录 FAILED_OPERATIONAL/UNRESOLVED，无静默替代。 |
| §20-6 | NOT_PROVEN | completed replay 无额外 IO 已证实；跨 diagnosisRound 等价拒绝与 per-gap 下一动作拒绝仍仅在 guard 输入挑战发生，未由 composer 调度并持久化真实第二轮/后续 proposal。 |
| §20-7 | NOT_PROVEN | global-budget 实际 4 planned＋2 targeted，后续 gap 被 GLOBAL_QUERY_BUDGET_EXCEEDED 拒绝；EXHAUSTED_WITHIN_BUDGET 诚实可见。per-gap 达上限后的真实下一动作完整链仍缺。 |
| §20-8 | PASS | canonical 根据新证据300/301 RESOLVED/NEW_EVIDENCE_ATTRIBUTED；duplicate-only、contradiction-one-side、authority-unavailable 均 UNRESOLVED，未用执行查询量或模型自述授予 resolution。 |
| §20-9 | PASS | 每个 durable gap 在 coverage-final.json 与 research-result.json 的同一 targetedResearchGaps block 可见；无 silent drop，预算耗尽未被 SATURATED 覆盖。 |
| §20-10 | PASS | 两个真实 SIGKILL窗口后 ordinary resume保持同 occurrence；commit前 targeted增量2（两个渠道各合法重跑一次），commit后增量0；每 action COMMIT=1、pool/hash/checkpoint一致。见下文显式 restart 限制。 |
| §20-11 | PASS | 独立双向 mechanical join 与 checkpoint锚定版本逐字节hash成立；889个本轮输入输出hash引用一致，其中canonical44个；零 orphan/cross-gap，便携包装扫描零机器绝对路径。 |
| §20-12 | PASS | stale-action 已从真实 committed action 出发，经生产 COMPLETE identity checker明确拒绝；原checkpoint字节恢复后的正控真实 REUSE、零IO、COMMIT1。池/绑定/披露篡改、complete replay与canonical非权威文件漂移controls方向亦通过。 |

§20-13 = OUT_OF_SCOPE；不作研究质量改善/价值声明。整体仍不满足 all twelve PASS。

## B2 / B3 修复的独立结论

B2 闭合：保留全部原 checks 与 scenario.verdict 后，删除 canonical.lineage 令 §20-2/4/8/9/11 NOT_PROVEN；lineage.valid=false 或 joins=[] 令这些行 FAIL；provider observed=999、targeted observed=999、普通 child exit=1 令相关行 FAIL；缺 run/input/output 或 sourceDirty 非空不再 PASS。额外 stale evidence 字段正负变异（fault.ok、fault IO delta、restoration reused、原hash、COMMIT次数）全部令 §20-12 FAIL。§20-5 的 route/runtime结论不依赖 canonical lineage有效性，该行在单纯 lineage-invalid 控制中保持 PASS 不属于上述 lineage 负控声称范围。完整变异输出保留，不隐藏该范围差异。

B3 闭合：本轮 stale-action initial 为真实 COMPLETE occurrence，含一个实际 committed/resolved action、2次targeted IO。故障只改 checkpoint.occurrenceId，runId/planHash/action ledger/pool/final artifact仍来自原运行。生产返回 ok=false、code=state_invalid、具体 reason 为“completed targeted action ledger is not checkpoint-bound to this occurrence”，fault provider delta=0。恢复原checkpoint备份字节后 ordinary compose 返回 ok=true/reused=true，provider delta=0、original/restored COMMIT均1，checkpoint before/restored hash相等且与fault hash不同。故障 context不当作新的真实 occurrence；control/audit/backup不授予产品 completion authority。

source identity负控：unstaged、staged、untracked各 exit1/T14_EXACT_SOURCE_DIRTY、输出未创建；另外复制当前HEAD四个harness，仅分别改动driver/fixtures/matrix/package-evidence一个文件，再以 --repo 指向 cleanHEAD，各 exit1/执行harness differs from HEAD、输出未创建。所有拒绝均发生在provider IO前；候选clone最终clean。

## 剩余 P1 acceptance blocker B1 与有限 USER_DECISION_REQUIRED

B1 是 §20-1/6/7 的完整 composition evidence 缺口，不能由绿色 guard-only observation替代。独立读取证实：diagnoseGaps只产生三种冻结MVP已知类型；runTargetedSubphase把 diagnosisRound固定0、对每gap使用proposals.find一次；composer只在planned loop之后调用一次 subphase；ordinary resume先走checkpoint replay而非第二轮授权。本次 controller controls明确 productionSecondDiagnosisRound=false、authorityLedgerWritten=false，生产authority文件hash未变。

现有允许外部 search/capture/semantic/embedding doubles、proposals/policy/framing接缝不能让实际诊断持久化未知类型，也不能产生第二诊断轮或在已有同gap action后消费新proposal：重复调用composer会走REUSE，调用guard或手改durable JSON则不满足冻结同occurrence完整链。把内部diagnosis输出替换成测试authority，或把额外调用guard装配成产品链，不能闭合本票。

因此，仅“controller-owned诊断生产接缝＋同occurrence有界后续proposal/诊断调度”这一有限架构/调度决定确实需要owner授权；不批准候选USER-DECISION.md中具体API，不修改冻结Spec，不要求扩展终态、identity权威或checkpoint信任根。B2/B3为普通harness修复且本轮已闭合，没有把它们夹进USER_DECISION_REQUIRED。本轮无其他未闭合普通harness/P2修复项；没有新增证据证明产品P0/P1。

## crash / restart 范围

crash-before initial exit137/SIGKILL、锚定action=AUTHORIZED、无targeted完成binding；replay=RERUN，targeted2→4，随后两次ordinary resume exit0、COMMIT1。crash-after initial exit137/SIGKILL、锚定action=COMMITTED且pool完成binding成立；replay=REUSE，targeted2→2，随后两次ordinary resume exit0、COMMIT1。commit后第一次resume仍付4次planned IO，因为该窗口尚未锚定planned pool；本收据不称“所有provider IO零增量”。

对显式 restart:true 的独立base/candidate对照均：initial完成且6次provider IO；restart创建新occurrence、4次planned IO、0次targeted IO后p1_compose_aborted/F.5.1 CASE1b，原因是旧canonical action ledger未被新checkpoint锚定。不是仅凭“既存”忽略：Approved P1 §4.3明确显式restart=new execution occurrence、新occurrence不得复用旧derived research stages；P2 §7/F.1的action identity含occurrence，§12/F.5同action committed replay义务按该identity判断。本轮冻结“已durable committed→resume不重复targeted”由同occurrence进程重启满足，该不同occurrence失败不推翻已证实的§20-10 replay义务，也未新增重复targeted IO。它仍是实际既存显式restart可用性缺陷，不宣称显式restart PASS，不据此改identity/authority合同。若要求验收显式新occurrence restart的整体可用性，应独立界定其恢复/旧ledger保留范围；本票没有证明该行为一般可用。

## 工件定位

以下均相对本receipt所在的临时证据根；归档时保持相对引用并只取便携文件，不直接迁入含机器调用栈的raw日志。

- reviewer-run-96a4cc3/campaign.json、matrix.json与各scenario/evidence.json：本轮exactHEAD、22个occurrence、命令/exit、计数、hash与controls。
- reviewer-package-96a4cc3/：portable manifest、lineage index及选取的真实产品字节。
- reviewer-matrix-negative-96a4cc3.json：保留checks的负控完整结果。
- reviewer-source-negative-96a4cc3.json：三类dirty、四个external harness漂移、clean恢复结果。
- reviewer-independent-audit-96a4cc3.json：独立889引用hash、canonical双向join、crash与stale实际复核。
- reviewer-restart-control-96a4cc3.json：fresh base/candidate explicit restart对照。
- reviewer-validation-summary-96a4cc3.json、reviewer-hashes-96a4cc3.json：便携summary与完整hash索引。

本轮canonical runId=1f9f4cff28ea450bdf88493ff11cf464ffd71eb836ff194428f9d1e2a6b2a699；occurrence/generation=1047508c-0bd2-47b7-899d-8cf30d4efe25；planId=39f4096876cbace36fbf65576177964f0f689f678b7a48b59ab577ecf5f63f4b。所有sourceInputs及各场景原始hash由索引定位，不将祖先生产SHA执行结果授予本HEAD。

#126不得close completed，#108 ENGINEERING_ACCEPTANCE不得COMPLETE，master不得集成。新SHA须fresh独立审查，本收据不转授。reviewer未调用子代理或Skill；使用独立Subagent上下文、GitHub只读connector、Git隔离clone、Node/Python本轮运行。未更新规则、门禁或产品文档，只生成审查receipt与临时复核工件。
