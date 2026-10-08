# P2A-T15 / #127 — #108 产品价值评估

DATE = 2026-10-08
TYPE = EVIDENCE / DOGFOOD
PRODUCT_IMPLEMENTATION = NONE
AUTHORITY = docs/specs/p2-ari-f02-targeted-requery.md §17 / §20-13；Issue #108 §9；用户本轮授权
FINAL_107_SHA = f2572870b78a2dc521afdf1188c8dd779503150c
ARCHIVED_CAMPAIGN_CODE_SHA = 416a153b5976c326a0656ce8f592c063a3029614
BENCHMARK_VERSION = p2-f01-authored-curated-v1
EVALUATOR_VERSION = p2-f01-exact-supported-statements-v1
PROJECT_MEMORY_UPDATE_REQUIRED = NO

## 结论

VALUE_CLAIM = UNKNOWN
VALUE_INTERPRETATION = INCONCLUSIVE / MIXED_BY_CASE
COST_ACCEPTABILITY = UNKNOWN
OPEN_WORLD_RESEARCH_QUALITY = UNKNOWN

在本次合成冻结语料、公开固定 plan、确定性 provider/embedding/逐字语义 double、显式注入既有 #108 targetedSubphase 的条件下，两案发现目标增加、两案无可测增益，一案两arm均因 clarification_required 为 INVALID。所有案的检索和处理成本增加。该证据没有足够依据判断真实研究中是否以可接受成本关闭更多 material gap，因此不授予 DEMONSTRATED，也不能从 Tier1 推断普遍无效。UNKNOWN 是价值未获证明；T15 的证据与结论记录可以完成，不代表质量 PASS。

## 完整范围与身份

[完整20-run campaign](../p2-f01/campaign-bound/campaign.json)、[人读报告](../p2-f01/campaign-bound/human-readable-summary.md)、[评估定义与隔离](../../../research-orchestration/evaluation/README.md)、[修复与原始失败](../p2-f01/REVIEW_REPAIRS.md) 与 [当前收据](../p2-f01/CURRENT.md)。五案全部保留，每arm各10次（每案两次），没有仅选赢家、删失败、改targets、改权重、candidate多跑或换更强模型。归档执行416a153；最终f2572870只有证据归档/docs变化，产品/评估源码与冻结输入相同；远端fresh clone执行20次并核验678产品hash、40结果hash、16有效closure的最终收据见#107关闭记录。运行的身份、时间、配置、hash与repo-relative refs以每案每次run-manifest和result为准。

Tier1全部5案；其中4案有有效质量比较、1案INVALID。Tier2现实dogfood=NOT_RUN，case_count/run_count=0，canonical semantic credential/cookie/search secret预检均不可用；runtime/model/provider identity、timestamps、每次成本与壁钟已记录，现实variance/research_quality=UNKNOWN。实际外部provider与模型调用均0，contract runtime/model pin只满足production seam；不是DeepSeek实际推理证据。默认CLI targeted re-query仍未开启，本实验显式注入既有产品seam；没有改变candidate决策来适配gold。

## 四主指标：逐案，不合成总分

| case | aspect baseline→candidate / total | counterposition baseline→candidate / total | key evidence baseline→candidate / total | retrieval baseline→candidate | 解释 |
|---|---|---|---|---|---|
| ASPECT-01 | 1→3 / 3（+2） | 0→1 / 1（+1） | 0→1 / 1（+1） | 4→8（+4） | GAIN_ON_CURATED_TARGETS |
| COUNTER-02 | 2→3 / 3（+1） | 0→2 / 2（+2） | 0→1 / 1（+1） | 4→8（+4） | GAIN_ON_CURATED_TARGETS |
| AUTHORITY-03 | UNKNOWN / 3 | UNKNOWN / 1 | UNKNOWN / 1 | 4→10（+6） | 两arm INVALID / clarification_required |
| LOWGAIN-04 | 1→1 / 2（0） | 0→0 / 1（0） | 0→0 / 1（0） | 4→8（+4） | NO_MEASURABLE_GAIN |
| CONTROL-05 | 2→2 / 2（0） | 1→1 / 1（0） | 1→1 / 1（0） | 4→8（+4） | baseline已好；额外量无目标增益 |

ASPECT_DELTA = ASPECT +2、COUNTER +1、LOWGAIN/CONTROL 0、AUTHORITY UNKNOWN。
CONTRADICTION_DELTA = ASPECT +1、COUNTER +2、LOWGAIN/CONTROL 0、AUTHORITY UNKNOWN。
KEY_EVIDENCE_DELTA = ASPECT/COUNTER +1、LOWGAIN/CONTROL 0、AUTHORITY UNKNOWN。
CASE_LEVEL_VARIANCE = 两案增益、两案平、一案无法评定；各案重复两次的冻结执行identity、指标、失败状态、非时延成本稳定，无无法解释漂移。

内容hit要求verified+selected+analyzed来源，并由final research claim支持已定义statement；仅查query、多aspect名称不能算hit。key要求定义的完整source text实际进入verified/selected/analyzed corpus。权威材料均为作者编制的模拟直接记录，不能视作现实权威证据；AUTHORITY本案没有有效完成质量输出，也未证明AUTHORITY_GAP解决。curated目标发现与production gap RESOLVED是不同事实；本次有效candidate最终gap仍全部UNRESOLVED。

## 成本与壁钟

| case | provider calls baseline→candidate | semantic double调用 | selected sources | downstream chars | baseline壁钟范围 ms | candidate壁钟范围 ms |
|---|---|---|---|---|---|---|
| ASPECT-01 | 6→12 | 3→5 | 2→4 | 82→179 | 396.58–405.15 | 900.28–903.72 |
| COUNTER-02 | 6→12 | 3→5 | 2→4 | 88→183 | 370.80–389.57 | 822.97–831.15 |
| AUTHORITY-03 | 4→10 | 0→0 | 0→0 | 0→0 | 33.44–34.11 | 249.93–253.52 |
| LOWGAIN-04 | 6→11 | 3→4 | 2→3 | 85→136 | 376.72–387.83 | 690.71–701.32 |
| CONTROL-05 | 6→11 | 3→4 | 2→3 | 95→138 | 368.22–489.96 | 659.50–700.01 |

retrieval attempts与calls一致；COST_DELTA分别为+4/+4/+6/+4/+4检索、+6/+6/+6/+5/+5 provider calls、+2/+2/0/+1/+1语义double调用、+97/+95/0/+51/+43字符。实际模型与外部provider调用增量0；token/money=UNKNOWN。壁钟为真实compose执行（含真实verifier/handoff子进程），不含stage拷贝/评估/CI开销；同host交替arm顺序、冷独立目录，壁钟未承诺稳定或代表现实网络时延。没有定义或实测付费成本可接受阈值，不能把+4查询写成“低廉可接受”。

## Spec §17 / §20-13 支持项与未知

| 要求 | 实际记录 |
|---|---|
| important aspect / contradiction / authority-source discovery | 上方逐案primary vector；key仅模拟target、现实authority UNKNOWN |
| hidden-target discovery | 所有已定义hidden IDs逐项hit/proof见各result.metrics.targets；ASPECT 1→5/5、COUNTER 2→6/6、LOWGAIN 1→1/4、CONTROL 4→4/4；AUTHORITY全UNKNOWN。这是既有target的附加标记，不是第五主指标或quality总分 |
| duplicate ratio | 各baseline .75；candidate ASPECT/COUNTER .75，LOWGAIN/CONTROL .8125，AUTHORITY .8 |
| total retrieval cost / latency | 每次result成本与上表两次范围；token/money UNKNOWN |
| new materially useful sources per targeted round | UNKNOWN；未从整体source/target增益反推每round materiality或生产resolution |
| unresolved-gap rate | 有效candidate 1；baseline UNKNOWN；AUTHORITY两arm UNKNOWN |
| targeted action count / selected corpus / STOP | 有效baseline 0、candidate2；AUTHORITY最终lineage计数UNKNOWN，原candidate动作ledger实际3保留。selected sources上表；有效STOP=zero_new_candidates，AUTHORITY=clarification_required |

## 验证与限制

known-weak baseline实际检测；已hit来源从只读副本移除后REGRESSION；故意混入hidden字段在product IO前拒绝；hidden内容两arm完成后首次读取，同bytes绑定Git blob/hash/schema。产品执行目录只包含所需代码/shared schema/helper和公开input，没有gold/evaluator/.git/acceptance或回原repo链接；父/子Node正常relative hidden访问ENOENT。该文件存放边界不宣称host/OS hostile-code sandbox。

KNOWN_LIMITATIONS：5案19份作者编制合成材料、固定公开planner、逐字double有同义改写false-negative；不代表开放世界难度、现实权威、实际模型行为或实际付费provider性能。LOWGAIN的4403目标在所有公开routes中不可达，只证明人工冻结缺口保留；没有实际逃逸动作或真实dogfood promotion evidence。AUTHORITY selector需用户选择，不能替产品自动选择来刷分。CURATED_TARGETS != OPEN_WORLD_COMPLETENESS；全hit不证明exhaustive，target之外内容不自动irrelevant。没有通用quality分数或更改primary语义。

本文件只记录评估结论。#127可在独立ACCEPTANCE_EVIDENCE_REVIEWER确认证据存在、全case无挑选、成本/负结果/限制完整后completed；#108可标ENGINEERING_ACCEPTANCE=COMPLETE、VALUE_ACCEPTANCE=UNKNOWN并completed。真实运行价值未获证明；#109仅START GATE，#110 DESIGN_ONLY、#111/#112仍roadmap。
