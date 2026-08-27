# Excerpt — 跨问题 pivot

- **date**: 2026-08-26（Track B Benchmark Design）→ 2026-08-27（pilot §10 cross-question case 强制）
- **context**: 从单题抓取转向跨问题研究。
- **why included**: 这是产品方向最关键的一次 pivot（05 决策表第 2 行）；也是 benchmark 中最复杂的 case 类型。

## 摘录

> （Benchmark Design）ZHIHU_RESEARCH_BENCHMARK_SET：pilot 6–8 case / full 24–32 case，A–H 八类研究形态。
> 07 Part B 跨问题：hierarchical not flat；No naive equal weight；
> Claim Cluster 必须保留 group provenance（support_questions/authors/expert_support/evidence_rich_support/opposing_questions）。

> （Pilot 任务书 §10 CROSS-QUESTION CASE IS REQUIRED）
> 至少 1 个 case 必须是：
> Natural Language Research Question → >= 3 Zhihu Questions → multiple answers/content
> 并显式测试：largest_question_share / normalized_question_diversity /
> minority_question_recall_macro / minority_question_recall_min /
> per_question_coverage_preservation / cross_question_claim_recall
> 必须能发现：1000-answer big Question 压死 30-answer / 50-answer smaller Question 这种失败模式。

## 落地

cross-lowcode case：6 个真实低代码选型问题 / 75 源 / 含 3 答小问题；
synth-dominance fixture：1000/50/30 支配形状（B0 largest_share=1.0、B2=0.4 的区分即来自此）。
