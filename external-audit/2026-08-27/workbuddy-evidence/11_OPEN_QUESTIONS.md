# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 11 OPEN QUESTIONS

> 组装者列出开放问题，**不提供答案**。外部 Reviewer 是这些问题的主要回答者。
> §1 是任务书指定的专项问题（critical aspect chain），必须回答。

---

## 1. 【任务书指定】Critical Aspect Chain 专项问题

**检查目标**：

```text
critical_aspect value units
→ question_id assignment
→ per_question_coverage
→ minority_question_recall
```

**事实背景**：
- D2 修正后 cross-lowcode 恢复 6 个 case 级 aspects（`case-cross-lowcode:asp-*`）。
- 但**只有 aspect_recall 移动了**；per-question / minority / diversity 未受影响。
- 原因（当前实现）：case 级 aspect（如 `asp-criteria`）的 value unit `question_id = null`（属于 case 而非单个 question），因此不进入 per-question coverage 的分子分母。

**Reviewer 必须判定**：
1. 这是**正确设计**（case 级 aspect 本就不属于单题）？
2. 还是 **case-level units 的 artifact**（aspect 本应对应到 question 却丢失了归属）？
3. 还是**另一个隐藏的 metric-model 问题**（aspect 覆盖没有正确传导到 minority/coverage 指标）？

相关代码：`benchmark/harness/lib/value-units.mjs`（question_id 赋值逻辑）、`benchmark/harness/lib/metrics.mjs`（per_question_coverage / minority 实现）。

---

## 2. 数据 / 证据缺口

| # | 缺口 | 影响 | 需要什么 |
|---|---|---|---|
| 1 | Real embedding 未实现 | B1/B2 全部结论基于 ngram proxy；可能不迁移 | 最小 real embedding adapter + cache（明确推迟到下一 Gate） |
| 2 | Tier-3（adaptive stopping）无 fixture | false_stop_rate = NOT_RUN；停止机制未验证 | Tier-3 batch fixture（未授权构建） |
| 3 | Author identity 弱 | expert 归因受限（name string only） | 会话/Web 补充 author_id 或 fixture 层标注 |
| 4 | Freshness 弱 | 3/5 真实 case N/A；唯一 fresh source 是 off-topic 噪音 | 新鲜语料（需新抓取，未授权） |
| 5 | 小 case 饱和 | relevant=1/2 的 case 无区分度 | 更大 relevant gold 或更大 pool |
| 6 | 语料域单一 | 全部真实 case = 低代码/企业管理选型 | 其他域 case（未授权新增） |
| 7 | Level 1 原件（00-08）本机缺失 | Reviewer 无法核对 Level 1 原文 | 向 ChatGPT 会话索取 |

---

## 3. 方法 / 模型问题

1. **B2 的 lane 机制是否值得保留**：真实 case 上 B2 未证明优于 B1/B0；lane 的价值只在合成 case 显现。MMR 成本（pairwise 全量）是否可接受未评估。
2. **MMR λ 与 lane 配额**：均为 pilot 参数，无 production 依据；是否存在一个配置使 B2 在真实 case 上全面占优，未探索（禁止 full factorial）。
3. **Fresh lane 的 relevance gate**：K_LARGE 时 fresh lane 曾选入 off-topic 噪音（石勒回答）——lane 配额是否需要 relevance gate（未实现）。
4. **Question-level coverage 显式约束**：lane 配额保护 lane 不保护小 question（cross 3 答小问题 minority min=0）。显式 per-question 约束机制未设计。
5. **分析覆盖 vs 检索覆盖**：analysis_coverage 闭环 pool 无区分度——指标是否有存在意义，还是应删除/重定义。
6. **Popularity 基线意外强势**：真实 case 上 B0 的 must_see/xq_recall 最高——这是知乎语料的特性（高赞=信息量高），还是 gold 的 popularity bias 残留（adjudication view 已隐藏 popularity，但 ChatGPT 可能仍受内容本身质量影响）。

---

## 4. 流程 / 治理问题

1. **Single-authority 风险**：Semantic Gold 由 ChatGPT 独立裁定，无第二方核验；若裁定有系统性偏差（如 popularity bias、vendor 判定过宽），D2 全部结论受影响。是否需要 Claude 外部审查覆盖 gold 质量（本包即为该审查而组装）。
2. **逐轮 CHANGES_REQUESTED 的成本**：6 轮修正中大量失败由评审发现（见 08），每轮都需重跑/重构建；这种迭代成本是否可持续，是否需要在下一阶段更早引入独立审查。
3. **Benchmark 与生产脱节风险**：harness 是隔离的；将来 TARGET 实现时，selector/metric 的 benchmark 契约是否直接复用，还是需要生产化重写。

---

## 5. 方向性问题（留给 Reviewer，组装者不回答）

```text
PROCEED  → 进入 real embedding gate / TARGET 实现？
SIMPLIFY → B0/B1 是否已足够？B2 的复杂度和成本是否值得？
RETHINK  → 覆盖性选择是否是正确的产品问题？知乎内容特性是否让 popularity baseline 已足够？
```

组装者唯一声明：`EXTERNAL_AUDIT_PACK_STATUS = READY_FOR_EXTERNAL_REVIEW`。
