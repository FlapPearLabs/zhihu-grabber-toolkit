# CONTRACT 定向复核 — 2026-09-19

审查对象：`/tmp/zhihu-repair-plan-20260919/SCOPED_REPAIR_PLAN.md`。

实际读取并以 `shasum -a 256` 核验 SHA256：`849f08071c6b43065e2daa42b48d1fd0f79f44d4ed20ad0ee62dba638a8a82ff`，与请求一致。

范围：仅复核 `/tmp/repair-plan-contract-review-20260919.md` 的原有两个 finding，不重开系统审计，不授予产品 PASS 或 owner 批准。

| 原 finding | 定向复核结论 | 当前文档证据 |
|---|---|---|
| unresolved singleton 与 anchor 自关系矛盾 | CLOSED，保持关闭 | 129/139/143 行采用唯一响应格式；resolved families 与独立 unresolved records 构成不交完整分区；unresolved 不具有 anchor 自关系或 support/oppose。全 unresolved 完成政策仍明确由 CD-B2 裁决。 |
| semantic revalidation 缺正向能力失败条件 | CLOSED | 133 行冻结语义完整性义务；456 行把明确同向 same-family ASSERTS、明确反向 OPPOSES/conflicting 列为阻断 golden，singleton/split/all-unresolved 明确 FAIL；未知通过仅限预注册信息不足案例，新增三类退避负控制；默认明确 golden 全部命中，放宽阈值及分母须 owner 运行前批准。 |

原反例“全部 unresolved、结构全绿、无错误支持关系而通过 semantic acceptance”已被 456 行明确拒绝。与 454 行“结构证明不等于语义证明”、460 行三层验收边界一致。

本次只确认上述文档缺口已关闭。未评估尚不存在的实现、未运行真实模型或 canonical acceptance；未批准 CD-B1/B2/B3 等 owner 决策，未将草稿升级为 execution-ready。未改主稿、仓库、测试、Specs、规则、Issue 或 PR，仅写本临时复核记录。
