# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 03 CURRENT RCE DESIGN

> 目的：精确描述"如果实现 RCE，当前设计是什么"。设计来源 = Level 1 冻结要求 + Track B benchmark 中验证过的 selector 形态。
> 重要：**TARGET（完整 RCE）未实现**。本文描述的是设计蓝图 + benchmark 中已验证的部分组件。

---

## 1. RCE 定义（Level 1 冻结）

```text
input:  (research_question, budget {K | max_tokens, ...})
output: selected_source_ids + provenance
约束:   subset selection（非 ranking）
```

Provider-neutral 契约：`(research question, budget) → selected_source_ids + provenance`。
provider（知乎 API / embedding 运行时）为内部实现、可替换。

---

## 2. V1 pipeline 七机制（设计蓝图，未全部实现）

| # | 机制 | 状态（组装时点） | 说明 |
|---|---|---|---|
| 1 | Expansion | 未实现 | research question → 多查询扩展 |
| 2 | RRF | 未实现 | 多路检索结果融合 |
| 3 | Embedding | **NOT_IMPLEMENTED** | benchmark 用 char n-gram 代理 |
| 4 | Deterministic Features | 部分（benchmark 机械特征） | vote / time / evidence markers / content type |
| 5 | MMR | benchmark 有（B2） | relevance − λ·redundancy |
| 6 | Multi-lane | benchmark 有（B2 mechanical lanes） | Mainstream / Evidence / Fresh / Long-tail / Expert / Contradictory |
| 7 | Simple Clustering + Simple Saturation | 未实现 | 覆盖聚类 / 停止条件 |

---

## 3. Benchmark 中已验证的组件（B0/B1/B2）

### B0 — Popularity Top-K（baseline）
- 排序：`voteupCount DESC`
- tie-break：source_id / canonical order（确定性）
- 允许记录 commentCount，不构造 QualityScore
- **Popularity ≠ Quality**（明确定位为 baseline）

### B1 — Lexical N-gram Proxy（**非 real embedding**）
- query/content char n-gram TF 向量 + cosine Top-K
- 缓存：相同 canonical content embedding 只算一次（cache hits 记录）
- 运行时身份：`LEXICAL_NGRAM_PROXY`（见 `benchmark/lib/runtime.mjs`）
- 待 real embedding adapter 落地后才可更名为 `B1_SEMANTIC_TOP_K`

### B2 — MMR + Multi-lane（mechanical lanes）
- MMR：`relevance − λ · redundancy`，λ 为 pilot 配置参数（非 production default）
- Lanes：Mainstream / Evidence-presence / Fresh-window / Long-tail-proxy（mechanical 信号）
- **Expert / Contradictory lanes = 无独立 production-plausible signal → 空（不伪造）**
- 曾存在 gold-lane 版本 → 已隔离为 `B2_ORACLE_LANES`（UPPER_BOUND_DIAGNOSTIC_ONLY，不进 fair comparison）

### 关键设计边界（本轮修正中固化）
- **STRATEGY_FEATURES ≠ EVALUATION_GOLD**：fair selector 不得读取 evaluation gold
- 所有 label 中 semantic 部分为 PROVISIONAL / HUMAN_ADJUDICATED；mechanical 部分为 MECHANICAL_CONFIRMED

---

## 4. Gold / Value-Unit 设计（已实现并 adjudicated）

- Gold unit = `case_id × source_id`（case-scoped，无跨 case 传播）
- relevance gate：must-see / aspect / expert / long-tail / evidence / stance / historical 进入 scored Gold 前必须 `relevance == true`
- UNRESOLVED：不计 numerator、不计 denominator、单独统计（不得 UNRESOLVED→false）
- value_units[]：must_see / critical_aspect / unique_claim / required_contradiction_side / expert_source_group / evidence_source_group；`per_question_coverage(q) = covered scorable units(q) / all scorable units(q)`
- claim stance 只来自 explicit contradiction stance lists 或 human adjudication；provenance membership 不自动生成 stance

---

## 5. 指标清单（21 项，当前实现）

```text
must_see_recall / aspect_recall / aspect_source_recall_diagnostic / expert_recall
long_tail_recall / fresh_window_membership_recall / fresh_content_recall
historical_authority_retention / evidence_presence_recall / evidence_rich_recall
contradiction_claim_recall / cross_question_claim_recall
semantic_redundancy / claim_redundancy / analysis_coverage
normalized_question_diversity / largest_question_share
minority_question_recall_macro / minority_question_recall_min
per_question_coverage_preservation / independent_source_diversity
relative_compute_ops / wall_clock_ms / jaccard_stability_mean / jaccard_stability_min
false_stop_rate（无 Tier-3 fixture → NOT_RUN，未伪造）
```

精确定义见 `benchmark/lib/metrics.mjs` 与 07 文档。

---

## 6. 设计中的已知 open 项

1. **Embedding 缺失**：所有 B1/B2 结论建立在 ngram 代理上，可能不迁移到真实 embedding。
2. **λ 未定**：MMR λ 是 pilot 参数，无 production 依据。
3. **Lane 配额与 relevance gate 关系**：K_LARGE 时 fresh lane 曾选入 off-topic 噪音源（487214224 的石勒回答），证明 lane 需要 relevance gate（未实现）。
4. **Question-level coverage**：lane 配额保护 lane 不保护小 question（cross case 3 答小问题 minority min=0）。
5. **critical-aspect value-unit 链**：`critical_aspect → question_id → per_question_coverage → minority recall` 的语义正确性待 Reviewer 判定（11 文档专项问题）。
