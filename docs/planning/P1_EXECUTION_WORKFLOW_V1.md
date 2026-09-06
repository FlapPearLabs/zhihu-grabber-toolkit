# P1 Execution Workflow V1 — Efficiency Repair (2026-09-06)

来源：WORKFLOW EFFICIENCY ROOT-CAUSE AUDIT（P1 WAVE 01 integration train 用时 3h15m 的
forensic 复盘，2026-09-06）。本文件只约束**执行工作流**，不改变任何 P1 产品语义、
T12/T13/T14 实现语义、TICKET_LANE_V2 质量门、exact-SHA 评审、Repair Saturation、
fail-closed 或 final live dogfood 要求。作者：FlapPearLabs。

## 0. Forensic 结论摘要（细节见 audit 报告）

- 最大可避免成本 = **在中间集成阶段于 worker agent 内部运行 live runtime**（T13 worker
  83 分钟，其中含 LM Studio 上下文容量的现场发现与绕过；该环境知识未被持久化，
  Phase 6 同一问题再次出现并被再次诊断——同一环境故障支付了两次）。
- 次级成本 = 无 runtime/环境 preflight、env 资格工作（npm/sharp/模型下载）reactive 地
  发生在 worker 内部、治理写册跨 turn 分散、tool 不可靠（grep BRE / edit-verify）。
- 明确低权重（诚实量化）：完整套件本身在本仓库极快（3.6–30s），tiering 节省的主要是
  agent-turn 开销而非套件墙钟——tiering 的价值在可扩展性，不在本次数字。

### 0.1 时间估计对账（PR #72 评审 F7 修正）

| 量 | 观测/目标 |
|---|---|
| IMPLEMENTATION_WAVE_DURATION（三 worker 并行） | 观测 ≈50m（17:46→18:35，2026-09-05） |
| IMPLEMENTATION_REVIEW_GATES（每票 fresh+adversarial+repairs+re-review） | 观测 ≈110m（评审门波 18:40→20:30） |
| INTEGRATION_TRAIN_DURATION | 观测 195m（3h15m）→ 修复后目标 **45–70m** |
| END_TO_END_WAVE_DURATION（implementation + review gates + train） | 观测 ≈5h+ → 规划目标 **100–140m**，以待下一次真实 timing ledger 为准 |

**撤销**此前报告中的 "60–90m" 表述——其与 INHERENT_COST（实现 70m + 评审 35m ≈ 105m）不自洽。
不做数字化妆；以上全部以待真实 ledger 校准。

## A. INTERMEDIATE_TEST_POLICY（每个 stage-intermediate）

中间集成 stage（merge 一票 reviewed SHA + 该票 integration 补丁）默认**不跑全量套件**：

```text
merge --no-ff reviewed SHA（harness 校验 base/worker/merge-base 精确性）
→ focused ticket tests
→ 受影响 seam 的 TYPE_B gate（offline variant；skip-safe）
→ targeted integration review（仅新 delta）
```

全量回归只在 FINAL stage 跑（见 §B）。理由：全量套件在中间阶段提供的新信息
（≈0——三票文件零交集 + 冻结 validator 不受未触碰文件影响）不抵 agent-turn 成本；
`node --test test/*.test.mjs` 的最终一次全量足够兜底。

## B. FINAL_TEST_POLICY（stage-final；F8 三模式验收机制）

```text
MODE = offline | smoke | canonical   （stage-final --mode；默认 offline）

offline  = FINAL_DRY_RUN：preflight(offline) → 一次全量离线回归 → identity-chain +
           negative-guard 探针；ledger 机械记录 runtimeClass=OFFLINE_DRY_RUN、
           finalAcceptanceEligible=false、acceptanceVerdict=OFFLINE_DRY_RUN_NOT_ACCEPTANCE。
smoke    = LOCAL_NONCANONICAL_SMOKE：preflight(smoke：本地 runtime 健康/容量/依赖) →
           一次全量离线回归 → 本地 runtime whole-wave（--test-concurrency=1）→ 探针；
           **显式 NONCANONICAL —— 无论步骤是否全过，finalAcceptanceEligible 恒为 false**
           （acceptanceVerdict=LOCAL_NONCANONICAL_SMOKE_NOT_ACCEPTANCE）。
canonical= CANONICAL_ACCEPTANCE（F8b：声明驱动，非 env 驱动）：preflight(canonical：
           声明有效性 + canonical 凭据存在性 [只查存在、不读取/不传输] + 依赖 + 产物)
           → canonical.runner：解析项目声明中的 canonical runner（项目所有的 gate 命令/
           适配器）；**声明无 runner 或文件缺失 → CANONICAL_SUITE_NOT_WIRED，fail closed**；
           执行该 runner，要求其机器可读 PASS 证据绑定 ①声明的 canonical runtimeId
           ②声明的 canonical model ③实际 canonical 执行（executionClass=CANONICAL +
           非空 evidence 块）；**仅该验证通过可置 finalAcceptanceEligible=true**
           （CANONICAL_ACCEPTANCE_PASS）；任何失败 fail closed（CANONICAL_ACCEPTANCE_NOT_PASSED），
           **绝不回退到本地 smoke runtime**。**环境 boolean（如旧的 suite-ready 开关）
           对 canonical 验收机械无效**——接线 = 修改项目声明（声明 runner），不是设置 env。
           smoke/offline 的执行证据永远无法满足 canonical 证据契约（executionClass 绑定）。

env-failure saturation（§C）适用于所有模式。canonical 模式在 env 层即不携带任何
smoke runtime 键（wholeWaveEnvFor 机械保证）——回退禁令不是 prose，是可测试的机制。

## C. RUNTIME_PREFLIGHT（mode-aware，强制前置；模式必须显式传入）

`bin/integration-preflight.mjs --mode <offline|smoke|canonical> [--stage final]`

1. offline：仅本地产物（final stage）。**runtime 与依赖刻意不检查**（离线套件已在裸
   worktree 上 657/657 实测通过；对离线要求依赖属于假门——文档化 non-check）。
2. smoke：本地 runtime endpoint 健康、model served、上下文容量
   （RUNTIME_CONTEXT_INSUFFICIENT / _UNVERIFIABLE fail-closed）、依赖（缺失=FAIL）、产物。
3. canonical：声明有效性、**canonical 凭据存在性**（declared env 非空或 0600 文件存在；
   只查存在——preflight 不读取/不打印/不传输凭据值）、依赖（缺失=FAIL）、产物（final）。
   **无 endpoint 探测、无本地 runtime 探测**——canonical 模式完全不接触 smoke runtime。
   运行时可达性由 runtime authority 模块在真实 canonical 运行时验证。

**ENV FAILURE SATURATION**：环境故障签名一旦被 preflight 分类并复现，禁止反复进入
产品修复/评审循环；修复动作仅限环境面，随后重跑 preflight。

## D. GOVERNANCE_WRITE_POLICY（批量对账）

执行期间的状态记录进**本地 execution ledger**（harness 自动产出
`work/p1-wave-latest/execution-ledger.json`，schema `wf-execution-ledger/1`）。
durable 写册（issue 登记、handoff packet、memory）合并为**一次对账 pass**，
在 wave 的 terminal state（push 完成或 STOP 点）执行。**例外**（必须即时持久化）：
状态变更操作本身（activation/ff push、branch push）与其 freshness 核验；USER_DECISION_REQUIRED
STOP 点的停止声明。

## E. EDIT_VERIFICATION_POLICY（写后即验）

文件写入/编辑后**立即**验证实际落盘内容（`git diff --stat` / 定点 re-read），
再进入下一步；不信任工具的 success 报告本身。shell 搜索使用 portable 语义
（`grep -E` 显式 alternation，不依赖 BRE `\|`；路径含空格/引号一律双引号包裹；
git 查询一律 `--no-pager`）。长输出命令禁止假设完整回显，关键结论用定点重读确认。

## F. 工具

```bash
# 中间 stage（并行 worker 输入模型：expected-head 是调用时的 integration tip，
# worker-review-base 是该 worker 评审时的共同 base——两者通常不同）
node research-orchestration/bin/integration-harness.mjs stage-intermediate \
  --expected-head     <EXPECTED_INTEGRATION_HEAD（必须与当前 HEAD 精确相等）> \
  --worker-review-base <WORKER_REVIEW_BASE（reviewed sha 的祖先）> \
  --worker            <WORKER_REVIEWED_SHA（40-hex；其他 ref 立即冻结为 full SHA）> \
  --ticket <id> --focus 'test/<focused>.test.mjs' --gate 'test/<seam-gate>.test.mjs'

# final wave 三模式
node research-orchestration/bin/integration-harness.mjs stage-final --mode offline
node research-orchestration/bin/integration-harness.mjs stage-final --mode smoke
P1_RUNTIME_MODE 相关凭据就绪后：
node research-orchestration/bin/integration-harness.mjs stage-final --mode canonical

# 单独 preflight（mode-aware）
node research-orchestration/bin/integration-preflight.mjs --mode <mode> [--stage final]
```

harness 特性：expected-head/merge-base 精确校验（不匹配即拒绝合并）、reviewed ref 一次性
冻结为 40-hex（F1）、幂等合并、分步计时、机器可读 ledger（`wf-execution-ledger/1`，默认
`<repo>/<declaration.ledger.dir>/execution-ledger.json`，cwd 无关——F5）、identity-chain +
named negative-guard probe（F6）、F8 三模式验收机制（见 §B）、**永远拒绝更新 master**。

**运行时权威声明**：所有 runtime/model/凭据/env/ledger 路径绑定位于
`research-orchestration/bin/runtime-authority.json`（项目所有）；generic harness 与
preflight 不含任何 vendor/项目/ticket 名称——由静态抽取边界测试机械强制（见 §H）。

## G. 边界（本文件不改变）

TICKET_LANE_V2 全部门、exact-SHA 评审语义、Repair Saturation、TYPE_B 真实 producer
conformance、fail-closed 语义、final live dogfood、KNOWN_BASELINE_FAILURE ≠ PASS——
全部保持。本文件删除的只是**重复执行**与**环境盲目性**，不是任何质量门。

## H. 抽取边界（EXTRACTION BOUNDARY，F8）

PR #72 是 proving ground；generic harness 概念必须可抽取进开发模板仓库：

- **generic（可抽取）**：`bin/integration-harness.mjs`、`bin/integration-preflight.mjs`、
  `bin/runtime-authority.mjs`（loader）——三文件内容零 vendor/项目/ticket 名称
  （静态测试机械强制：scan `/deepseek|lmstudio|qwen|zhihu|p1|t1[2-7]/i` 必须零命中）；
  模式分类学（offline/smoke/canonical）、验收判定、ledger schema、exact-SHA 合并语义、
  tier plan、identity/negative 探针框架。
- **project-owned（留在本仓库）**：`bin/runtime-authority.json`（canonical runtimeId/model/
  凭据绑定、local smoke 绑定、env/ledger/产物路径、**canonical runner 声明**）、项目所有的
  canonical runner 脚本、真实产物、gate 测试、全部产品语义。
- 抽取动作 = 复制三个 generic 文件 + 为目标项目写一份新的 runtime-authority 声明
  （含该项目的 canonical runner）。

## I. FINAL_REPORT_SHA_POLICY（报告 SHA 来源纪律，2026-09-06 事故修复）

任何最终报告中引用的 full SHA 必须**逐字符复制自同一 turn 内 fresh 执行的
`git ls-remote --refs origin` 输出**（远端真值行），禁止来自本地 rev-parse 回显、
终端 scrollback、历史消息或记忆复述。事故案例：round-2 报告引用的 NEW_SHA 尾段
与远端真值不符（`64261ebdec…` vs 远端 `64261eb9bb…`）——短 SHA 相同掩盖了 full SHA
错误。执行规则：push 后立即 `git ls-remote --refs origin <ref>`，报告中的
NEW_SHA 字段直接粘贴该命令输出中的对应行值；若报告与 push 不在同一 turn，
重新执行 ls-remote 再引用。
