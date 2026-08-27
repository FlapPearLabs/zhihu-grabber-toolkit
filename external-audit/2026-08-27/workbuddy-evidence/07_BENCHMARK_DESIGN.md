# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 07 BENCHMARK DESIGN

> 目的：完整呈现 Track B benchmark 的设计（供 Reviewer 独立评估设计质量）。
> 精确定义以代码为准：`benchmark/harness/lib/*.mjs`（metrics / selectors / value-units / case-loader）。

---

## 1. Benchmark 目标（三个问题）

```text
Q1. Gold / labels 能否稳定构造？
Q2. 指标能否区分 B0 / B1 / B2？
Q3. Benchmark 是否存在明显盲区，标注/计算/retrieval 成本是否可接受？
```

明确**不是**证明：RCE 成功 / TARGET 优于其他方法。

---

## 2. 分层定位

```text
Tier 0  selector sanity（同 pool 内选择器行为）
Tier 1  retrieval coverage（覆盖性指标）
Tier 2  end-to-end（研究问题 → 最终子集）
Tier 3  adaptive / stopping（何时停止抓取）—— pilot 无真实 Tier-3 fixture → false_stop_rate = NOT_RUN
```

---

## 3. Gold 构造原则

- **Human / 确定性 adjudication = authority**；LLM = ASSISTANT / PROPOSER（只能 PROPOSE，不能自封 FINAL）
- Gold 标注者盲于被测 strategy 输出（防 circular evaluation）—— ChatGPT 独立 adjudication 即此原则的落地
- 参考池 = multi-query sweep + 人工补充；dataset version 冻结（D1 → D2 机制）
- Label 双层：
  - OBJECTIVE / MECHANICAL（vote / time / credential metadata / URL / evidence markers / content type / code block / images）→ `MECHANICAL_CONFIRMED`
  - HUMAN / SEMANTIC（relevance / aspect / must-see / contradiction / evidence quality / expertise-topic match / long-tail contribution / historical authority）→ `PROVISIONAL` 或 `HUMAN_ADJUDICATED`
- UNRESOLVED：不计 num、不计 den、单独统计

---

## 4. 指标定义（21 项，最终批准版）

| 指标 | 定义要点 |
|---|---|
| must_see_recall | must_see gold sources 被选中比例 |
| aspect_recall | #aspects 有 ≥1 selected primary source / #scorable aspects（1/n 增量；4 aspects → {0,.25,.5,.75,1}） |
| aspect_source_recall_diagnostic | 旧 source-level per-aspect recall（诊断，非主指标） |
| expert_recall | expert gold（topic-conditioned）被选中比例；relevance gate 后 |
| long_tail_recall | unique long-tail contribution gold 被选中比例 |
| fresh_window_membership_recall | 机械：fresh-window 成员被选中比例（MECHANICAL_CONFIRMED） |
| fresh_content_recall | 语义：fresh **and relevant** gold 被选中比例（PROVISIONAL 直到 relevance adjudicated） |
| historical_authority_retention | 全部 UNRESOLVED → NOT_SCORABLE / N/A（D2 状态） |
| evidence_presence_recall | 机械：有 evidence markers（links 等）被选中比例 |
| evidence_rich_recall | 语义：evidence quality gold 被选中比例（PROVISIONAL 直到 adjudicated） |
| contradiction_claim_recall | claim-based（非 source-pair）；required stance sides 覆盖 |
| cross_question_claim_recall | required_provenance_groups[] 全覆盖（非任意 ≥1 source） |
| semantic_redundancy | mean(clamp(cosine,0,1)) over distinct unordered selected pairs；\|S\|<2 → N/A |
| claim_redundancy | pairs sharing ≥1 substantive claim cluster / all distinct pairs；\|S\|<2 → N/A |
| analysis_coverage | 闭环 pool 下=1 无区分度（已知盲区） |
| normalized_question_diversity | (1−Σp²)/(1−1/Q)，Q=#scorable reference questions；Q≤1 → N/A；3 ref Q 全选 Q1 → 0 |
| largest_question_share | 最大 reference question（按 frozen pool size）占 selected 比例 |
| minority_question_recall_macro | mean(per_question_coverage(q)) over NON-LARGEST scorable questions；单问题 → N/A |
| minority_question_recall_min | min(...same set...) |
| per_question_coverage_preservation | 按 value_units 计：covered scorable units(q) / all scorable units(q)；未选中 q → 0 |
| independent_source_diversity | 独立作者/域名多样性的诊断 |
| relative_compute_ops | embedding_calls + pairwise_similarity_calls + selection_ops（非生产成本） |
| jaccard_stability_mean/min | 全部 C(n,2) pairwise（deterministic selector → 重复运行一致） |
| false_stop_rate | NOT_RUN（无 Tier-3 fixture，未伪造） |

---

## 5. 策略（当前形态）

```text
B0_POPULARITY_TOP_K       voteupCount DESC + deterministic tie-break（source_id/canonical order）
B1_LEXICAL_NGRAM_PROXY    char n-gram TF + cosine Top-K；embedding 缓存；runtime identity 记录
B2_MMR_NGRAM_PROXY        MMR（relevance − λ·redundancy）+ mechanical lanes（Mainstream/Evidence/Fresh/Long-tail proxy；
                          Expert/Contradictory = 无独立信号 → 空）
B2_ORACLE_LANES           使用 gold lanes → UPPER_BOUND_DIAGNOSTIC_ONLY，excluded_from_fair_comparison=true
（TARGET 不存在）
```

---

## 6. Budget 公平性

- 同 case 同 pool 同 K 同 cutoff 下比较（B0 选 20 / B2 选 80 后比 recall 被硬禁止）
- Budget points：K_SMALL / K_MEDIUM / K_LARGE（case 相关：3/5/8、5/10/20、10/20/40 等）

---

## 7. 稳定性

- Selector 全部 deterministic → 重复运行结果一致（jaccard 1.0/1.0）
- 若未来引入 LLM/embedding 非确定性 → 多 run + C(n,2) jaccard mean/min
- **Stable ≠ Correct**（写入 README）

---

## 8. Dataset Version 冻结

```text
D1（agent provisional gold）→ SUPERSEDED
D2（ChatGPT adjudicated gold）→ CREATED（当前）
D2 corrected（namespace 修复）→ CURRENT_FINAL_PILOT_RESULT
版本 hash = sha256(corpus identity + gold + value_units + freshness policy)；前缀 d1-/d2-
Out-of-pool discovery → blind adjudication → 若进 gold → bump version（pilot 未触发）
```

---

## 9. 设计中的盲区（pilot 前已预判）

- freshness 参考 cutoff 无统一时钟源 → case-specific frozen window
- author identity 不可用 → BENCHMARK_AUTHOR_KEY 分层
- analysis_coverage 闭环 pool 下无区分度（预判，pilot 证实）
- small pool 饱和：K ≥ pool 时策略无区分度（预判，pilot 部分证实）
