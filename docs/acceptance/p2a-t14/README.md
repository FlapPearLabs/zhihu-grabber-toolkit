# P2A-T14 工程验收候选

最新执行来源为 `19c281d30bc076f2ddd8a5c0c2b474f138ae3d8e`，当前入口为 [LATEST-VALIDATION.json](LATEST-VALIDATION.json) 与 [evidence-19c281d](evidence-19c281d/scenario-manifest.json)。22 场景通过，严格矩阵仍为 9 PASS / 3 NOT_PROVEN，退出码 2；fresh 验收审查待运行。旧 `evidence-16f6b8f`、`candidate-validation.json` 和原 Standards/Spec 收据是历史支持记录，不是当前门禁。

本目录记录本次 #126 验收。§20-13 属于 T15/#127；此处不作研究质量或价值声明。

统一 driver 运行真实 `composeP1Research`。只替换外部 search/capture/semantic/embedding IO，内部 verifier、handoff producer、corpus verifier、诊断、授权、检索、RRF、canonical identity、commit/checkpoint、resolution 和最终工件均执行产品实现。`fetchImpl` 拒绝意外网络请求。

从仓库根目录运行：

```sh
export T14_OUT="$TMPDIR/p2a-t14-fresh"
node research-orchestration/scripts/p2a-t14/driver.mjs --out "$T14_OUT"
node research-orchestration/scripts/p2a-t14/package-evidence.mjs "$T14_OUT" "$TMPDIR/p2a-t14-package"
node research-orchestration/scripts/run-classified-research-suites.mjs guard
NODE_OPTIONS='--test-reporter=tap' node research-orchestration/scripts/run-classified-research-suites.mjs full-offline
```

输出目录必须尚未使用。driver在任何provider IO前拒绝已暂存、未暂存及未跟踪的候选改动，避免磁盘源码冒充HEAD。首次 fresh clone 按既有 lockfile 在 `zhihu-answer-grabber` 执行 `npm ci`，与仓库 CI 的依赖准备一致；不加载真实模型或私有凭据。当前本地运行 Node26；Node22 的最终证据由可用环境再验证。TAP 显式设置只用于兼容分类 runner 的计数格式。

每个command中的 `$T14_OUT` 是本次fresh campaign根目录；`outputDirectoryRef` 指向该根目录下的具体scenario，`workingDirectory` 是仓库根。命令保留真实child参数结构而不提交本机绝对路径。

退出码：0 表示运行断言和十二项工程矩阵全部通过，仍须独立 reviewer；1 表示失败；2 表示 `NOT_PROVEN`。`scenarioChecksVerdict` 只表示场景断言结果，不能替代 `campaign.verdict` 或矩阵门禁。

本次有 22 个互斥状态的独立 occurrence。crash-before/crash-after 子进程在真实提交窗口收到 SIGKILL；父进程直接 ordinary resume，不修改 checkpoint 伪造完成。提交前允许一次安全重跑（targeted IO 增量2），提交后 targeted IO 增量0。计划检索在提交后 resume 仍会运行4次，因为该窗口尚未锚定计划 pool；这不是“所有 provider IO 为零”。每条 target action 的 COMMIT 计数和 pool/hash/checkpoint 均机械检查。

§20-1、§20-6 与 §20-7 当前为 `NOT_PROVEN`。全局预算已在真实composer中拒绝后续gap，但per-gap实际上界挑战仍仅发生在controller边界。公开生产 guard 的未知类型、跨 diagnosisRound dedupe 和 per-gap bound 对照已执行，以当前真实 occurrence 的 checkpoint 锚定 ledger、计划与预算为输入；这些挑战只写 acceptance 工件，不写产品 authority ledger。`CONTROLLER_BOUNDARY_NEGATIVE_CONTROL` 不代表 composer 实际持久过未知 gap 或执行第二诊断轮。现有 composer 是单轮 MVP，新增该注入面或轮次需单独架构授权。

已复现并最小修复的既有P1：授权providerScope未控制真实调用；拒绝/无proposal/operational failure的gap终态未落盘；预算耗尽未按冻结T08终态披露；T10 block未接入最终工件；COMPLETE reuse未检查定向 pool、锚定ledger和resolution披露依赖。未新增terminal、identity、runtime/provider fallback或检索管线。

最终完成凭据保持 checkpoint。COMPLETE 先验证P1最终工件，再从 checkpoint 锚定action版本重建T10 block并比较最终披露。canonical action展示文件的篡改不能成为第二replay credential；resolution一致性检查只能拒绝变化，不能授予完成。不宣称resolution所有audit字节都已被此语义比较覆盖。

证据包中的 `scenario-manifest.json`、`lineage-index.json`、相对引用及SHA256、provider/controller traces、初/终快照和锚定ledger可机械复核。注入故障后的缺失/篡改有独立标签和故障前hash；大capture/corpus临时工件不进入仓库。

#126 在十二项全部PASS、同SHA独立review PASS、推送、fresh clone复验和远端SHA核对之前保持OPEN。master及#108 ENGINEERING_ACCEPTANCE均不得据场景绿色而推进。

修复后的 stale-action 从真实已提交 action 开始，仅以 TEST_FAULT 修改 checkpoint 的 occurrence context；生产 COMPLETE checker 明确拒绝且新增 IO=0。恢复原 checkpoint 字节后的普通 resume 为 REUSE、新增 IO=0，COMMIT 保持1。故障、恢复与原始 checkpoint 备份分别归档，故障值不冒充新真实 occurrence。矩阵同时核对实际 lineage/count/exit 字段与 stale 拒绝/恢复事实，保留旧 checks 的字段变异不能继续 PASS。

历史独立验收收据 reviews/acceptance-4cb4de6.md 为 RAW_REVIEW_ARCHIVAL_MIRROR；owner 只归档，不代签 reviewer。其原始临时引用保持原文，当前候选另有上方便携工件包；该旧否定收据不转授任何新 SHA。B2 matrix 与 B3 stale-action 修复已执行，是否闭合由新的 fresh reviewer 决定。

已知基线限制见 known-baseline-restart.json：显式 restart:true 创建新 occurrence 后会因旧 canonical action ledger 残留触发 CASE1b，冻结 master 与候选均复现。本票不宣称显式新 occurrence restart 已通过；§20-10 的同 occurrence 进程重启/ordinary resume 证据单独核验。
