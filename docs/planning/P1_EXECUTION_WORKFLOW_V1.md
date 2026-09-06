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

## B. FINAL_TEST_POLICY（stage-final，每个 integration wave 恰好一次）

```text
runtime preflight（§C）
→ 一次 full research-orchestration regression（offline）
→ 一次 live whole-wave run（--test-concurrency=1，真实 runtime）
→ identity-chain 正向 + guard 负向探针（真实产物）
→ final exact-SHA review
→ governance reconciliation（§D）
```

**默认恰一次 live**；live 失败若为环境类签名（§C 分类）→ 修复环境后重跑 preflight +
live，禁止进入产品修复/评审循环（§C 饱和规则）。
**FINAL_DRY_RUN ≠ FINAL_ACCEPTANCE（机械可查，非 prose）**：不带 `--live` 的 stage-final
是 dry-run，其 ledger 记录 `finalAcceptanceEligible=false` /
`acceptanceVerdict=OFFLINE_DRY_RUN_NOT_ACCEPTANCE`；canonical P1 集成验收的唯一合格路径 =
`finalAcceptanceEligible=true`（live whole-wave=PASS）。

## C. RUNTIME_PREFLIGHT（mode-aware，强制前置）

任何 live 测试之前必须跑 `bin/integration-preflight.mjs --mode live`，检查：

1. runtime endpoint 健康（/v1/models，5s 超时）；
2. 所需 model id 在 served 列表（默认 `qwen/qwen3-1.7b`，env `P1_LMSTUDIO_MODEL`）；
3. **上下文容量**：经 `/api/v0/models` 的 `max_context_length` 对照 `P1_MIN_CONTEXT`
   （默认 32768）。不可验证 → `RUNTIME_CAPACITY_UNVERIFIABLE`（fail closed，不静默放行）；
   不足 → `RUNTIME_CONTEXT_INSUFFICIENT`（8192 事件已固化为测试 fixture）；
4. **依赖资格（live=FAIL 非 WARN）**：node_modules 缺失 → `DEPS_NODE_MODULES_MISSING`；
   `@xenova/transformers` 不可解析 → `DEPS_TRANSFORMERS_MISSING`（live embedding 门需要）；
5. 本地真实产物（final stage）：dogfood root + seam-{b,c,d}-real.json 可解析；
6. 所需 env 变量（P1_REAL_RUNTIME / P1_LMSTUDIO_BASE_URL / P1_LMSTUDIO_MODEL）。

**`--mode offline`（默认）**：显式离线 dry-run **不要求 runtime/依赖**——只检查本地产物
（final stage）。不检查 `@xenova/transformers` 的理由：离线套件已被证明在无 node_modules
的干净 worktree 上 657/657 通过（2026-09-05/06 实测）；离线要求它属于假门。执行模式必须
显式传入（或由 `stage-final --live` 推导），不得对离线执行静默套用 live 要求。

**ENV FAILURE SATURATION**：环境故障签名一旦被 preflight 分类并复现，禁止反复进入
产品修复/评审循环；修复动作仅限环境面（换实例/env/装依赖），随后重跑 preflight。

## D. GOVERNANCE_WRITE_POLICY（批量对账）

执行期间的状态记录进**本地 execution ledger**（harness 自动产出
`work/p1-wave-latest/execution-ledger.json`，schema `p1-execution-ledger/1`）。
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
# 中间 stage（例：T13；F2 并行 worker 输入模型——注意 base 是 worker 的评审基点，
# 不是当前 integration HEAD）
node research-orchestration/bin/p1-integration-harness.mjs stage-intermediate \
  --expected-head   <EXPECTED_INTEGRATION_HEAD（调用时 integration 分支 tip，必须精确相等）> \
  --worker-review-base <WORKER_REVIEW_BASE（worker 评审时的共同 base，如 d1b4585）> \
  --worker          <WORKER_REVIEWED_SHA（40-hex；其他 ref 会被立即冻结为 full SHA）> \
  --ticket p1-t13 \
  --focus 'test/p1-t13-group-representation-claims.test.mjs' \
  --gate  'test/p1-seam-c-real-conformance.test.mjs'
# 校验语义：HEAD===expected-head；review-base 是 reviewed sha 的祖先；
# merge-base(HEAD, reviewed)===review-base → merge --no-ff → reviewed sha 仍为精确祖先。

# final wave（offline dry-run；ledger 记录 FINAL_ACCEPTANCE_ELIGIBLE=NO——不构成验收）
node research-orchestration/bin/p1-integration-harness.mjs stage-final
# final wave（live，恰一次；唯一 acceptance-eligible 路径）
P1_REAL_RUNTIME=1 node research-orchestration/bin/p1-integration-harness.mjs stage-final --live

# 单独 preflight（mode-aware）
node research-orchestration/bin/integration-preflight.mjs --mode offline --stage final
node research-orchestration/bin/integration-preflight.mjs --mode live   --stage final
```

harness 特性：expected-head/merge-base 精确校验（不匹配即拒绝合并——MASTER_DRIFT 语义）、
reviewed ref 调用起点**一次性冻结**为 40-hex full SHA（F1）、幂等合并、分步计时、
机器可读 ledger（`p1-execution-ledger/1`，默认 `<repo>/work/p1-wave-latest/execution-ledger.json`，
cwd 无关——F5）、identity-chain 正向 + **named negative-guard probe**（真实 guard 模块 + 篡改
真实产物，F6）、FINAL_DRY_RUN≠FINAL_ACCEPTANCE（F3：ledger 机械记录
`finalAcceptanceEligible`，canonical 验收必须 live whole-wave=PASS）、
**永远拒绝更新 master**（master 更新 = 单独的、显式授权的 exact-SHA ff push）。

## G. 边界（本文件不改变）

TICKET_LANE_V2 全部门、exact-SHA 评审语义、Repair Saturation、TYPE_B 真实 producer
conformance、fail-closed 语义、final live dogfood、KNOWN_BASELINE_FAILURE ≠ PASS——
全部保持。本文件删除的只是**重复执行**与**环境盲目性**，不是任何质量门。
