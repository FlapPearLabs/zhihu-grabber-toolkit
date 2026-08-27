# Excerpt — Benchmark-first 决策

- **date**: 2026-08-26（Track B Benchmark Design 授权）
- **context**: 用户明确在实现 RCE 之前先建 benchmark，且多次强调 gate。
- **why included**: 解释"为什么 TARGET 至今未实现"——这是流程设计，不是拖延。

## 摘录

> 本轮允许为了验证 Benchmark：
> - 编写最小 benchmark fixture / metric evaluator / baseline selector / benchmark-only tests
> - 构造 6–8 个 pilot cases；使用已有 verified corpus
> - 必要时做少量新的只读数据采集
>
> 本轮明确不授权：
> - PRODUCTION_RCE_IMPLEMENTATION / PRODUCTION_PROVIDER_REFACTOR
> - CANONICAL_SCHEMA_MIGRATION / ARCHITECTURE_SPEC / PRODUCT_VERSION / PRODUCTION_MERGE

> VERSION_ASSIGNMENT = UNASSIGNED

## 后续强化

> 10. DO NOT ADD REAL EMBEDDING YET（D2 rerun 轮）：
> "这轮不实现 real embedding。原因：我们先需要回答 Gold 修正以后，现有 Pilot 的主要结论是否仍成立。
> Real Embedding 是下一 Gate，不是本轮顺手施工。"

## Why

展示用户对"先证明、后实现"的纪律；也是 05 决策表第 12 行的证据。
