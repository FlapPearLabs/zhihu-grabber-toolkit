# #107 Research Evaluation Harness MVP

只有四个主度量：重要方面发现、反方观点保存、关键证据目标发现、增量成本。
benchmark 为 `p2-f01-authored-curated-v1`，evaluator 为
`p2-f01-exact-supported-statements-v1`。五案覆盖城市空间、教育、家用设备、公共交通和园艺；
包含已知薄弱基线、低收益路线和完整基线控制。

全部材料是明确标注的 **synthetic authored-curated** 假设语料。
数字 question ID 只是 fixture identity，不能拿去查询真实知乎。
`simulated-direct-record` 仅表示合成情境中的直接记录角色，不证明现实权威。
`CURATED_TARGETS != OPEN_WORLD_COMPLETENESS`：命中全部 target 不证明 exhaustive research，
未列为 target 的发现也不自动视为无关。

## 运行与产物

先提交 source，再在仓库根目录运行：

```sh
node research-orchestration/evaluation/run.mjs \
  --expected-head <exact-40-character-code-SHA> \
  --out docs/acceptance/p2-f01/<fresh-campaign-directory>
```

普通命令只运行 Tier 1；无需模型、网络或 research-orchestration 的模型依赖。
需要先按现有锁文件安装 `zhihu-answer-grabber` 依赖，以运行真实 verifier/handoff。
output 必须 repo-relative 且未存在。每次生成独立 product directory，不使用 warm cache。
source guard 检查实际 HEAD 和代码、benchmark、产品包、Spec、治理、CI 的未提交状态。
产物目录变化不是产品源码变化。`campaign.repo_sha` 是实际执行代码提交；
后来保存 evidence 的文档提交不会追溯改写它。

五案每案两个 arm，各重复两次并交替执行次序。每个 pair 输出：

- `eval-case.json`、`run-manifest.json`；
- `baseline-result.json`、`candidate-result.json`；
- `comparison.json`、`human-readable-summary.md`；
- 两份完整、原样复制的产品产物树，用于核验 claims、来源和 checkpoint hashes。

输出引用 repo-relative；原产品产物内部保留 owner 定义的 work-relative 引用，
从其所在产品目录解析，不改写 canonical artifacts。
复跑比较 discovery metrics、provider/model 调用计数和材料规模；壁钟时延、时间戳、
occurrence UUID 与含这些值的 artifact hashes 明确属于 `DOCUMENTED_NONDETERMINISM`。

## 输入与 benchmark schema v1

`benchmark/benchmark.json`：`schema_version=1`、benchmark_version、scope、cases[]。
case descriptor 只有 case_id、product_input、evaluation_case 三个 repo-relative refs。
每案 `product-input.json` 的闭合字段集由 `input.mjs` 实际校验：

| 字段 | 合同 |
|---|---|
| schema_version | 1 |
| case_id / task / time_scope | 非空字符串 |
| plan | 既有 `validatePlanInput` 合同，未扩展 |
| corpus[] | 唯一数字 question_id、title、text；无任何 evaluator labels |
| routes | public query → corpus 内的 question ID 数组 |

`eval-case.json` 属于 evaluator-only，schema_version=1，绑定 case/version/domain/time scope、
完整 authored provenance、failure_family、targets、hidden_targets、evaluation_notes。
targets 的闭合三个 measurement families：

- important_aspects[] / counterpositions[]：target_id、label、非空 support_any_of[]。
  每项包含 question_id 和非空 accepted_statements[]，由 curator 冻结可接受的完整陈述。
- key_evidence[]：target_id、label、question_id、expected_text。必须是已定义来源与原文。

worker 收到且校验的只有 public input 文件及其真实 byte hash。
原 provider double 的 controller 可以读取冻结 corpus/route table；semantic double 只消费实际选中来源的安全围栏投影。
目标定义、gold labels、expected authority target、evaluation notes 从不送入产品 worker。
evaluator 在两个产品进程完成后才首次打开该案 evaluator-only 文件；产品不能调用 evaluator。
运行前只从冻结 repo SHA 读取 evaluator 文件的 Git blob OID 元数据，不读取隐藏内容。
两个 worker 完成后先核验读取字节的 blob OID，再 parse gold；字节不一致即拒绝该 campaign。
benchmark/public input 同样绑定已提交字节，hash 来自同一份已验证的快照，不在评分后重读文件冒充身份。
evaluator-only v1 schema 拒绝未知字段，强制相同 case/version/time scope；target、support statement、
expected document、hidden ID 与 provenance materials 必须实际对应 public frozen corpus，否则 INVALID，不能成为普通 miss。
worker 的字段白名单和父进程传入的 expected input hash 均 fail closed。
负控制把真实 hidden_targets 加入 candidate 输入，即使重新计算文件 hash，仍必须在任何产品 I/O 前拒绝。

## 四个主度量的冻结定义

1. **IMPORTANT_ASPECT_DISCOVERY**：target 的至少一个已定义来源实际被 verify/handoff 权威接受，
   位于 selected/analyzed set，而且最终 synthesis 的 source claim 引用该来源。
   claim statement 必须等于 curator 冻结的一个完整支持陈述，原来源正文也必须包含该陈述。
2. **COUNTERPOSITION_DISCOVERY**：同样核验已定义反方内容实际进入最终 research state。
   这是反方观点保存，不凭 query/标签推断语义矛盾或自动给予 OPPOSES。
3. **KEY_EVIDENCE_DISCOVERY**：已定义来源与 expected_text 精确匹配，且来源进入 verified、selected、analyzed corpus。
   不用机构名、点赞、作者外观或生产 `gap.status` 代理 authority hit。
4. **INCREMENTAL_COST**：分别报告 retrieval calls/attempts、provider adapter calls、外部 provider calls、
   实际 model invocations、semantic adapter invocations、壁钟毫秒、selected source 数和材料字符数。
   Tier 1 外部 provider/model calls 均为 0；token/money 为 UNKNOWN。

完整陈述匹配是保守的内容检验，对等价改写可能漏计；它不是通用语义质量 judge。
不能将本版本直接用于 live paraphrased claims 后宣称语义 recall 完整。
改变匹配语义或 benchmark version 必须独立 review；不得为 candidate 获胜而修改冻结 case。
四个指标独立报告，无权重、总质量分或自动价值 PASS。
无 target 的 family 输出 UNKNOWN。非法/空支持集、identity mismatch、source hash/closure 失败均拒绝。
产品停在澄清或执行失败时，保留其原始产物、原因和实际调用成本；该 result/pair 为 INVALID，
质量 hits/ratio 为 UNKNOWN，不能写零增益或 PASS。进程崩溃、缺失执行记录等 harness 故障仍使命令失败。

## 公平性、复用和边界

baseline：既有 `composeP1Research`，targetedSubphase=null。
candidate：同一 composer，显式注入既有 targetedSubphase seam，公开计划中第一个合法引用的固定 proposal policy。
配置、任务、corpus、计划、provider、语义替身、embedding 替身、预算和 evaluator 均相同。
唯一实验差异是 #108 开关和其声明的 proposal policy。
当前生产 CLI 默认 **未启用** #108；本实验不是默认 CLI 效果声明。

直接复用既有 runId/occurrenceId/planHash、sha256File/canonicalJson、provider seam、
defaultRunner、真实 verifier/make-handoff、production composition、dependency closure、
source identity 与 CI suite classification。没有第二套 product identity、provenance 或 provider 管线。
mockVector768 与 verbatim semantic double 明确标记 `DETERMINISTIC_DOUBLE`；
product 中的 DeepSeek runtime/model 字段只是生产 seam pin，实际调用模型为 NONE。

evaluator 在独立进程只读产品目录，另写自己的输出目录。读取前后逐文件 hash 比较；
不改 planner、retrieval/gap/coverage、final answer、STOP 或产品 decisions。
degraded control 只删改 evaluator snapshot 的副本，不动 canonical product tree，也不计为额外产品价值样本。
Known-weak 必须由实际 baseline metrics 证明，不能由 case 设计推断。
低收益与 control case 始终保留；增加检索/文档不会自动得分。

## Tier 2 与 CI

Tier 2 是真实 provider/model dogfood，必须独立保存真实运行次数、模型/provider、时间和 variance。
本次 preflight 只通过已有脚本读取布尔可用性；缺凭据为 NOT_RUN / UNKNOWN，不能当 PASS。
Tier 1 的稳定性不得转述为开放世界研究质量。
真实 dogfood 应先用原 canonical runtime/provider/embedding 完成成对运行，再只读观察其产物；
真实来源、curated accepted statements 与 provenance 必须独立冻结，不使用本文件的假设 question ID。
这是后续 live evaluation 的证据要求，不新增 live executor 或扩大本 MVP。

普通 CI 在既有 `full-offline` 分类执行一个真实 composition pair 加廉价 evaluator 反例，
约数秒，证明 **HARNESS_INTEGRITY**。live provider、付费模型、大规模 benchmark 不进入普通 CI。

T15 的价值结论另记于 #127；#107 本票只交付可审计的比较证据。
