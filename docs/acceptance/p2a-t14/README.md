# P2A-T14 工程验收与复验

本目录保存 #126 的执行证据、有限架构审批和历史否定收据。最新执行来源及矩阵见
[LATEST-VALIDATION.json](LATEST-VALIDATION.json)；每份工件都保留来源 SHA，归档提交不继承 review。
最终集成凭据还须核对 [PR #132](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/pull/132) 当前 exact SHA
的三角色原始 review，以及 #126 的 fresh-clone/post-master 复验记录。历史 r96a 与 054 收据不转授新 SHA。

有限接线已得到负责人授权并经独立架构审批，范围见 [USER-DECISION.md](USER-DECISION.md)、
[ARCHITECTURE-APPROVALS.json](ARCHITECTURE-APPROVALS.json)。原“unknown 需成为合法 durable gap/最终披露”
要求已撤回为 ACCEPTANCE_OVERREACH_CORRECTED。unknown 仅经历真实 controller 校验与拒绝审计，合法 taxonomy
仍为三枚举。新 bounded followup 继续使用原授权/去重/预算/检索/终态；不实现通用 scheduler。

统一 driver 运行真实 composeP1Research，只替换外部 search/capture/semantic/embedding IO。
内部诊断、授权、RRF、canonical identity、checkpoint、resolution、final artifacts 均执行产品实现。
fetchImpl 拒绝意外网络。每条矩阵 principal/negative control 具有独立 occurrence、具体工件和可变负控字段。

在完整历史 clone 中按既有 lockfile 安装 zhihu-answer-grabber 依赖；从仓库根运行：

```sh
T14_SHA="$(git rev-parse HEAD)"
T14_OUT="$TMPDIR/p2a-t14-fresh"
node research-orchestration/scripts/p2a-t14/driver.mjs --expected-head "$T14_SHA" --out "$T14_OUT"
node research-orchestration/scripts/p2a-t14/package-evidence.mjs "$T14_OUT" "$TMPDIR/p2a-t14-package"
node research-orchestration/scripts/run-classified-research-suites.mjs guard
NODE_OPTIONS='--test-reporter=tap' node research-orchestration/scripts/run-classified-research-suites.mjs full-offline
```

输出目录必须未使用。expected-head 必须显式为 40 位 SHA，parent 与所有 child 都绑定它。
driver 在 provider IO 前拒绝 staged/unstaged/untracked source 及执行脚本与 HEAD 字节不一致。
退出 0 表示所有场景断言与十二项矩阵通过，仍须独立 reviewer；1 为 FAIL，2 为 NOT_PROVEN。
scenarioChecksVerdict 不能替代 campaign/matrix；只跑部分场景无法关闭完整矩阵。

真实 SIGKILL 覆盖提交前安全重跑及提交后零重复 targeted IO；尚未绑定的 planned pool 在恢复时仍可重跑。
G.1/G.4 原 prior/framing 输入由同 checkpoint 绑定的每 action 快照恢复；不能以新 planned provider 输出
替代原输入。快照仅供 T08，缺失/篡改/跨作用域明确失败。原 terminal 不重算，ordinary/COMPLETE 保留字节。
providerScope、预算 STOP、跨 pass core dedupe、实际 next action bound 拒绝均通过真实 composition 观察。
focused/full-offline/现有三平台 CI 属 supporting，不能代替统一 T14 或 exact-SHA review。

便携包使用相对引用、SHA256、provider/controller trace、原/终快照和 checkpoint-bound ledger/input。
故障后的缺失/篡改独立标记，故障前 hash 不能冒充还存在的原字节；大 capture/corpus 临时数据不进入仓库。
原始 reviewer 收据按原字节归档，其中临时路径仅是原始引用；便携证据的有效引用单独机械校验。
短目录保留 Windows 路径空间，不能以路径计算代替 Windows 真实 checkout/test。

12 PASS、同 SHA 三角色 PASS、remote master 核验及 fresh-clone T14 通过前，#126 不关闭、#108 不标 COMPLETE。
显式 restart:true 新 occurrence 的基线限制另见 known-baseline-restart.json，不把 ordinary resume 泛化为该 PASS。
§20-13 仍 OUT_OF_SCOPE：#107/#127/T15 的研究价值验收单独进行。
