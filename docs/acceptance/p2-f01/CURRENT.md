# #107 当前候选收据

EVIDENCE_CODE_SHA = 43817dd085e5c816eea0b639908c849781db8ce3
BASE_SHA = 880862566478f9885b9a3c5bf25581529edd2a28
BENCHMARK_VERSION = p2-f01-authored-curated-v1
EVALUATOR_VERSION = p2-f01-exact-supported-statements-v1
PROJECT_MEMORY_UPDATE_REQUIRED = NO
PRODUCTION_MUTATION = NONE

当前证据：[campaign-bound](campaign-bound/human-readable-summary.md)、[manifest](campaign-bound/campaign.json)。五案、两个arm、各两次重复，20次实际运行。四个case每次有效，AUTHORITY两arm均INVALID；known-weak、leakage/degraded控制、全部质量与非时延成本重复稳定已实际核验。该收据不授予merge PASS，最终CI/fresh clone/exact-SHA独立review与集成终态记录在PR/#107。

历史campaign-final与campaign-corrected及 [IMPLEMENTATION](IMPLEMENTATION.md) 均不是当前验收身份。原 [initial-failure](initial-failure.json) 与每案失败不删除。原找错SHA、负控制、F1/F2/F3/F4、修复范围完整记录在 [REVIEW_REPAIRS](REVIEW_REPAIRS.md)。primary定义、case、corpus、route、targets自首次源码提交保持原样。

所有result planHash复用production loadPlan owner；非法计划拒绝。INVALID最终lineage计数UNKNOWN，raw candidate的3个动作、检索4→10仍留存。隐藏输入在worker前只绑定Git blob元数据；两worker完成后首次读取hidden单一buffer、校验blob、校验closed schema/target-corpus/time_scope，再评分与保存同bytes hash。该过程不向product提供gold，不改任何canonical product artifact/决策。

focused9/9通过（廉价actual composition pair、实际incomplete-worker、curator错误和hidden文件变化控制），静态node --check/git diff --check通过。既有广回归结果见历史收据，当前head CI执行完整套件；最终fresh clone复跑全部20次后再核验metrics/status/failure/supporting/非latency cost与raw hashes。

actual model=NONE，external provider calls=0，token/money=UNKNOWN。Tier2 credential preflight NOT_RUN、run_count=0、variance=UNKNOWN。两案target增益、两案NO_MEASURABLE_GAIN、一案INVALID；default CLI targeted disabled。无现实权威、通用quality/exhaustive研究或paid成本可接受声明。本票不替T15裁定#108价值。

只改evaluation目录、新增focused测试及既有CI分类登记；没有新runtime依赖、生产实现、治理、Spec、project-memory修改。实际使用scanner/doc drafter、/implement、/tdd、CodeGraph、code-review方法和GitHub workflow。review按实际finding迭代，每次修复后fresh context审最新SHA；没有默认三角色quorum。
