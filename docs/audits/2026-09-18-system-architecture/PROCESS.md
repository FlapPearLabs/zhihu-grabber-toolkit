# 调查过程与证据索引

这是依据本任务实际工具调用与保存文件重建的操作记录，不是完整逐字会话或内部推理转录。日期为 2026-09-18，记录保留执行失败与未完成部分。

## 1. 授权与范围

原任务：独立 adversarial / failure-first、read-only/pre-change，审计系统现状、P1 regression、open Issues、#79，再提出两种设计；禁止修代码/Spec/规则、创建 Issue/PR、改参数。

后续用户明确授权将调查证据、过程、报告、测试上传远端供其审查。本发布分支仅新增审计包，未开始修复或合并。

## 2. Snapshot 与 authority

1. 读取用户附件、improve-codebase-architecture、code-review；历史 memory 仅用于定位已有 checkout，不作为当前事实。
2. 当前任务目录不是目标 repository checkout，且存在既有未跟踪研究文件；未处理它们。
3. 对已确认目标 origin 执行 `git fetch origin`，`git rev-parse origin/master`，`git ls-remote origin refs/heads/master`，均得到审计 SHA；原目标工作树前后 clean。
4. `git archive <audited-sha>` 导出临时快照；没有将工作区 HEAD 当远端 master。
5. 读取 AGENTS/RULES/CONTEXT、项目 memory、相关 Spec/product contract/planning/seam/architecture、CI 与入口。无 `.codegraph`，未创建索引。
6. `gh issue list --state open` 取得 #1/#53/#54/#55/#79；`gh issue view 48/32 --json ...comments` 核验最终验收/closeout；`gh run view 35095524359` 核验3平台 success。JSON原文仅路径脱敏后保留。
7. accepted product→current：`git diff 9444a33...4bea7b3`；5 commits、8 changed files，生产代码仅 claims prompt/comment delta。近期35提交热点用于选择审查范围。

## 3. 独立调查职责

| 工作流 | 任务 | 实际交付/局限 |
|---|---|---|
| Standards 子代理 | diff规范、安全投影/runtime合同 | projection script/result，focused 73 pass；最终消息因额度中断，未产生最终 PASS |
| Spec 子代理 | Spec delta、T13/T14语义关系与P1适用性 | spec script/result，focused 95 pass；不把直接伪造seam输入升级成production exploit |
| Architecture 子代理 | T06–T12/composer、恢复与生产可达性 | architecture script/result，4个反例 |
| 主审 Codex | refs/GitHub/CI、入口与产物、反例复跑、综合报告 | 核验实际源码与输出，不以子代理自述授予产品PASS |

先从需求与authority列 invariant，再比较实现；审计结论形成后使用 codebase-design。三个独立设计草案分别优化最小interface、外部独立证据、owner常见决策。第三稿归为A的手工起步切片，避免人为新增C方案。

未调用Claude Code实现：本轮职责为审计，未授权产品开发。使用 skills：improve-codebase-architecture、code-review、codebase-design/DESIGN IT TWICE；GitHub skill提供只读状态与后续证据发布流程。web-access仅阅读路由，实际Git/gh，无浏览器抓取、无外部research。

## 4. 测试与失败处理

- 临时快照安装 grabber dependencies，日志 `npm-grabber.log`；未安装/下载大型 embedding 模型，未调用付费模型。
- 首次完整研究套件：`research-tests.tap`，826 pass / 4 fail / 0 skip。四文件失败原因是 archive 没有 `.git`，real-seam helper 无法定位 repo root；不是产品测试断言失败。
- 在临时快照添加只读 Git 对象定位（用于历史 `git archive`）后，四文件重跑：`seam-rerun.tap`，5 pass / 0 fail / 9 skip。
- 完整重跑：`research-final.tap`，840 tests / 74 suites / 831 pass / 0 fail / 9 skip，exit 0。原日志Node v25.8.0，本地macOS；远端CI Node22。
- 独立 focused：`standards-tests.tap` 73 pass，`spec-focused-tests.log` 95 pass。
- 主审重新执行 Architecture 与 projection scripts，输出 `architecture-recheck.json` / `standards-recheck.json`。
- 首次主审重跑 Spec script 漏传 snapshot argument，发生 `ERR_MODULE_NOT_FOUND`，没有得到有效输出，留下0字节 `spec-recheck.stdout`。该错误stderr只在工具记录，未伪造日志文件。随后传入 snapshot root 得到 `spec-recheck.json`，与原result相同。
- snapshot tracked blob校验：`snapshot-integrity.json`，259 blobs、0 mismatches；测试未改变审计产品内容。
- 结束前重新确认 origin/master SHA与原目标工作树clean；本任务目录原有未跟踪文件仍在。

## 5. Reviewer-owned counterexamples

| Case | 脚本 | Expected | Observed |
|---|---|---|---|
| 换topic restart | architecture | 新plan或先拒绝旧plan | fetchCalls=0，仍发旧AI queries，新topic已持久化 |
| COMPLETE删plan/source | architecture | 不得复用缺依赖checkpoint | ok/reused/complete仍true |
| clarification | architecture | 一次合法选择可继续 | 两次clarification_required |
| 跨组相反main | spec | 保留冲突方向 | widely-shared且oppose为空 |
| 无关main被反对 | spec | 不制造无关关系 | 组内contradictory自动挂到每条main |
| 空cluster | spec | 无证据cluster拒绝 | 无sourceClaimIds的minority产物 |
| 伪造sourceRef | spec | 内部输入健壮性探针 | guard通过；生产可达性未证明，保留为风险 |
| raw HTML/code/URL | standards | 符合继承安全projection | fake fetch捕获raw内容；未暴露tools |

这些probe使用合成数据/依赖替身，能证明所述确定性路径，不证明历史真实run触发所有问题；没有真实模型质量测试、真实凭据读取或外部语料发送。

## 6. 发布变换与重新验证

- 原日志只替换本机绝对路径为标记，保留结果、skip、duration、failure文本其余部分。原/发布hash见provenance。
- 原三个probe保留脱敏文本；可执行副本只更改import/默认仓库定位和OS-temp输出目录，不修复产品。
- 依次执行 `node --check` 与三个发布probe，全部exit 0；输出 `published-*-replay.json`。与历史observed JSON做深比较。
- 报告增加发布时态说明，HTML本地绝对链接改为包内相对链接。没有把后来上传行为偷偷改写为原只读审计的一部分。
- 本目录之外无tracked改动；本次分支提交只用于审查。完整Git对象、raw corpus和凭据不复制到包中。

## 7. 未做事项

未修复finding；未跑线上canonical；未重演WorkBuddy/Windows文件消失；未测试断电或大stdout截断；未创建/关闭Issue、未改Tracker、未合并master。报告中的A/B为设计草案，NEXT_GATE是建议，不是施工授权。
