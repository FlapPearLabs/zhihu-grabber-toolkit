# Excerpt — 首批评审失败（leakage / metrics / gold 结构）

- **date**: 2026-08-27（Pilot → Correction 轮）
- **context**: ChatGPT 对 Pilot 首轮结果的 CHANGES_REQUESTED 核心条款。
- **why included**: 这些条款是 08 失败清单 F1–F7 的直接证据；展示"独立评审发现问题"的模式。

## 摘录

> P0-1 — REMOVE GOLD LEAKAGE FROM B2
> 当前 B2 selector 禁止再读取：gold.expertise / gold.contradiction / gold.must_see /
> gold.long_tail / gold.aspect / 任何 evaluation gold。
> 建立严格边界：STRATEGY_FEATURES != EVALUATION_GOLD。
> 如果当前 expert/contradiction lane 没有独立 production-plausible signal：不要伪造。

> P0-2 — IMPLEMENT VALUE_UNITS FOR PER-QUESTION METRICS
> 当前 relevance.per_question source lists 不能作为 value-unit denominator。
> per_question_coverage(q) = covered scorable value units(q) / all scorable value units(q)
> 未选中整个 q：coverage(q) = 0。

> P0-3 — FIX MINORITY QUESTION METRICS
> largest reference Question：基于 frozen reference pool size 确定，不基于 selected set。
> 如果 reference case 只有 1 个 scorable question：minority_macro = N/A、minority_min = N/A。
> 修正现有错误 test：…… 正确：minority_macro = 0、minority_min = 0。不是 0.5。

> P0-4 — FIX NORMALIZED QUESTION DIVERSITY
> Q = number of SCORABLE REFERENCE QUESTIONS（不是 selected question count）。
> 例如 reference Q = 3、selected 全来自 Q1：normalized_question_diversity = 0（不是 N/A）。

> P0-5 — FIX ASPECT RECALL
> aspect_recall = number of reference aspects with >=1 selected primary supporting source /
> number of scorable reference aspects。…… 除非明确存在 separate critical-weighted diagnostic。

> P0-6 — FIX EVIDENCE / FRESHNESS AUTHORITY
> evidence_presence = MECHANICAL_CONFIRMED；evidence_quality = PROVISIONAL / HUMAN_ADJUDICATED。
> fresh_content_recall = PROVISIONAL until relevance adjudicated。
> 禁止把 fresh-but-off-topic source 计作 FINAL fresh relevant gold。

> P1-1 — RECLASSIFY NGRAM BASELINE
> 当前 char n-gram TF 不是冻结设计的 Dense Embedding。改 strategy 名称：
> B1_LEXICAL_NGRAM_PROXY / B2_MMR_NGRAM_PROXY。当前 D1 结果：HARNESS_SANITY_ONLY。

## Why

这 7 条是"评估泄漏 → 修复"循环的第一轮，全部被实施 + 测试化（详见 08 F1–F7 与 benchmark 测试套件）。
