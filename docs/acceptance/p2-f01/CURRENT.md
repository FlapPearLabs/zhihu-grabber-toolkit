# #107 当前候选收据

EVIDENCE_CODE_SHA = 72bc934d4c57ef0f1674913e086d75c1968b0c0e
BASE_SHA = 880862566478f9885b9a3c5bf25581529edd2a28
BENCHMARK_VERSION = p2-f01-authored-curated-v1
EVALUATOR_VERSION = p2-f01-exact-supported-statements-v1
PROJECT_MEMORY_UPDATE_REQUIRED = NO
PRODUCTION_MUTATION = NONE

当前证据：[campaign-corrected](campaign-corrected/human-readable-summary.md)、[manifest](campaign-corrected/campaign.json)。五案、两个arm、各两次重复，全部20次实际运行。known-weak/leakage/degraded controls和重复稳定性已实际检查。四个case每次有效，AUTHORITY的两arm均INVALID，仍保留原始成本与UNKNOWN质量。

旧 [IMPLEMENTATION](IMPLEMENTATION.md) / campaign-final 是 71e4ae1 的历史执行收据，**未获验收**，不能用于当前 exact identity gate。原始 [initial-failure](initial-failure.json) 与失败case不删除。完整旧独立审查 finding 见 [REVIEW_REPAIRS](REVIEW_REPAIRS.md)。

修复后，20个结果的planHash均与既有loadPlan owner相等；678产品hash和40 manifest result hashes逐项一致。INVALID的最终lineage action count为UNKNOWN；raw candidate ledger仍保留3个动作，检索4→10。case、route、target、指标匹配定义未改变；仅复用错误的identity reporting和未知值报告得到修复。

静态检查与受影响focused7/7通过，新增真实incomplete-worker回归检查：实际3个targeted actions，澄清failure，owner planHash相等，UNKNOWN lineage与产品目录不变。早期广回归结果见历史收据；修复后最终PR CI重新执行全套，并对最终exact HEAD fresh clone、20次复跑和fresh独立review。当前candidate收据本身不授予merge PASS，终态记录在PR/#107。

actual model=NONE，external provider calls=0，token/money=UNKNOWN。Tier2 canonical credential preflight NOT_RUN，run_count=0，variance=UNKNOWN。两案target gain、两案NO_MEASURABLE_GAIN、一案INVALID。default CLI targeted disabled。本票不裁定#108最终产品价值，不宣称现实权威、语义矛盾识别、通用质量或exhaustive research。

只新增既有CI分类的一份廉价测试；不改生产源码、治理、Spec或project-memory。实际使用scanner/doc drafter、/implement、/tdd、CodeGraph、code-review方法和GitHub workflow。最终评估review仅一位fresh context reviewer，先前CHANGES_REQUESTED不跨SHA转移。
