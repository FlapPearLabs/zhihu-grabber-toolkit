# 独立 CONTRACT 修复计划审查

结论：CHANGES_REQUESTED，仅针对规划草稿；不是产品 PASS，不授权实现、改 Spec 或建票。

审查输入：`/tmp/zhihu-repair-plan-20260919/SCOPED_REPAIR_PLAN.md`，2026-09-19 草稿；用户本轮附件；`<REPOSITORY_CHECKOUT>` 的 P1 Spec §8.1–8.3 / §10.2、SEAM V1 版本规则、已发布 reviewer probes 和现有 T14 聚合代码。master identity 按主审传入的 fresh `4bea7b30b3842a876e383977686a0abc0d68302f`，本 reviewer 不重复网络核验。未修改仓库/计划，只生成本临时 review。

## 1. CLOSED — unresolved singleton 与 anchor 自关系硬约束互相矛盾

位置：计划 129、133、137、141、145、149 行。

计划要求每个 family 有 anchor，anchor 自关系必须 ASSERTS；又要求 unresolved claim 剥离为 singleton，UNRESOLVED 不贡献 support/oppose。这使单条复合或条件不明 claim 的推荐路径无法同时满足规则。反例：唯一 claim 是“热缓存有益，但冷缓存更慢”，按 129 行不得拆解且应保留 unresolved；它一旦成为 singleton，唯一成员又必须作为 anchor 自 ASSERTS，145 行会把它变成 support。实现者只能自行选择拒绝、改写关系或偷偷例外，违背用户“下一位实现 Agent 无空间重解释”的要求。

最小文档修正：在 CD-B2 明确选择一种可表示的输出政策。例如将 unresolved 作为非 family 的 attributed-claim 条目，完整分区定义为 resolved families 加 unresolved claims 的不交并集；该类必须保留 statement/source lineage，禁止支持/反对和共识语义。也可明确将 claim 自我归因与跨 claim 关系不确定拆开，但必须逐字段定义其类别、support 含义、hash、consumer 行为与全 unresolved run 的完成条件。不要靠实现者猜测。保持 owner decision required。

复核：当前草稿 SHA256 `84532c678a03b81e53cf3761760ab7c00bca266dd911c8591befcd38f034f50b` 的 129/137/141/149 行已改为独立 unresolved records，与 resolved families 组成完整分区，无 anchor 自关系或 support/oppose。原矛盾关闭；CD-B2 完成政策、CD-B3 下游 schema/version/consumer 迁移仍是明示 owner 决策，不把这些已登记待决项重复报为缺陷。`category 至多 group-specific` 尚不宜作为执行 schema，但在明示 MORE_CONTRACT_WORK_REQUIRED 的草稿中可留给 CD-B2 精确冻结。

## 2. [P1] semantic revalidation 缺正向能力失败条件，全 unresolved 仍可能获得验收

位置：计划 149、245–253、454、458 行；CD-B2。

现行验收主要禁止伪共识/伪冲突/无引用，且说 UNKNOWN 不伪报命中，但没有明确“未命中是否阻塞验收”。反例：模型把所有明显同向和明显相反的原子 claims 都分成 unresolved singletons。没有任何错误 support/oppose、所有 source 完整、deterministic gate 全绿，也没有被列为重大伪共识/伪冲突；如果 owner 接受 unknown 披露，这个不再执行跨源综合的输出仍可能通过 458 行三层门。P1 §8.2 要求“跨 group 聚合相同/相反 claims”，不能只验证不犯错而完全丢失正向能力；§10.2 保持 NO_SEMANTIC_DOWNGRADE。

最小文档修正：执行前冻结正向 golden cases 的具体必须命中关系与分类，区分“在明确可判案例 abstain = semantic FAIL”与“预先指定 ambiguous 案例 unresolved = expected PASS”。预注册 family splitting / all-singleton / all-unresolved 负控制；若允许部分 abstention，则把具体最低成功条件及上限列为 owner 待决项，验收前解决，而不是结果出来后裁决。不需要新 judge 平台或大 benchmark。

## 已通过的规划边界检查

- S1 将 aspect 与有方向 proposition 区分，support/oppose 从显式关系及 controller-owned lineage 派生，可封住 F03 的既有机械错误路径；不承诺消除模型语义误判。
- F06 非空及 lineage closure 被明确保留，可先做 B0；不需为了空簇引入完整语义算法。
- 文本清楚区分结构验证与语义真值，模型不能授予 canonical identity、IO 或 coverage authority。
- CD-B3 与 §6 明示 semantic contract version、observable semantics/shape 变更 major bump、下游 re-review、旧产物不得默认补新标签；scope 与当前只读授权一致。
- 多 lane 分工、A/B/C 风险与 live/canonical 分层整体合理；两项修正均限文档合同，不要求实现或新增平台。

审核使用：独立 CONTRACT reviewer，code-review 的 Spec 轴；无实现代理、无新子代理、无 live 模型调用、无产品 tests 改动。验证为文档/源码交叉核对与上列新思想反例，不冒充可执行新实现测试。POST_GATE_MEMORY_UPDATE_REQUIRED = NO。规则、门禁、项目文档均未更新。
