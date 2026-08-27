收到 4 P0 + 6 P1 Metric/Gold Contract 修正。逐项处理，先更新工作日志：
所有修正项处理完毕。输出修正包。

---

# TRACK_B_METRIC_GOLD_CORRECTION_PACKET_FOR_CHATGPT

> 响应：CHANGES_REQUESTED — METRIC/GOLD CONTRACT ONLY（4 P0 + 6 P1）
> 范围：只修正 metric 定义 + gold 协议 + 受影响 machine-contract 字段 + pilot 规则；不重做 Track B、不重读全部 Project Sources、不开始 Pilot、不实现 harness、不抓新语料、不写 Spec、不改 canonical schema
> 状态（保持不变）：`TRACK_B_PILOT_EXECUTION = NOT_STARTED` / `SPEC_PREPARATION_GATE = NOT_READY` / `IMPLEMENTATION_AUTHORIZATION = NONE` / `VERSION_ASSIGNMENT = UNASSIGNED`

---

## 1. Corrected Metrics Only

### 1.1 P0-1 — ADD: Cross-question Claim Recall（新增正式 metric，填补 Reconciliation 声明与 F1–F18 的缺口）

```text
NAME: cross_question_claim_recall
PURPOSE: 测系统是否覆盖"跨问题/跨来源组"的 claim——防止只优化单个大 Question 内部的 claim 覆盖
UNIT: 0–1
GOLD DEFINITION:
  gold_cross_question_claim =
    claim whose support/provenance spans >= 2 questions / source groups
    OR whose support/opposition relationship crosses question boundaries
  scorable_gold_cross_question_claims = adjudicated gold 中符合上述定义、且非 disputed 的 claim 集
FORMULA_OR_PROCEDURE:
  cross_question_claim_recall =
    covered_gold_cross_question_claims / scorable_gold_cross_question_claims
  covered := selected corpus 中至少一个 source 与该 claim 关联（support 或 opposition）
REQUIRED_LABELS:
  claim_id / support_questions / support_sources / support_authors /
  opposing_questions / opposing_sources（07 §12 group provenance 完整保留）
AGGREGATION: case 级（G 类必报；A–F 类若存在跨问题 claim 也报）
FAILURE_MODE: selector 只在最大 Question 内找到支持源，跨问题 claim 的 minority side 被漏
INTERPRETATION: 高 = 跨问题证据结构被保留；与 question_diversity 一起看
DO_NOT_CLAIM: 不宣称"跨问题 claim 全量"；与 Contradiction Claim Recall 分开报告
  （若 gold claim 同时是 contradictory：cross_question_claim_recall 与 contradiction_claim_recall 各自独立计分，
   不合并、不互相抵消）
```

### 1.2 P0-2 — FIX: Redundancy Orientation（方向反转）

```text
NAME: semantic_redundancy（冻结主指标；方向修正）
PURPOSE: 度量 selected corpus 内部语义重复程度
UNIT: 0–1
FORMULA_OR_PROCEDURE:
  semantic_redundancy = mean_pairwise_similarity(selected distinct unordered pairs)
  （embedding cosine，fixture 层实现）
  —— 0 = LOW redundancy；1 = HIGH redundancy
  （冻结方向：HIGH = MORE REDUNDANT）
可选附加（不替换主指标）:
  semantic_diversity = 1 - semantic_redundancy
REQUIRED_LABELS: 机械（embedding 由模型 proposer 生成，确定性 controller 缓存）
AGGREGATION: case 级
FAILURE_MODE: 多抓同源/同 claim 重复 → semantic_redundancy 高
INTERPRETATION: 越低越好；与 recall 联合（不能靠多抓掩盖冗余）
DO_NOT_CLAIM: 不把 semantic_diversity 当冻结主指标；文本不重复 ≠ 证据独立

NAME: claim_redundancy（独立保留，方向与主指标一致）
FORMULA_OR_PROCEDURE: claim_redundancy = 1 - (unique_claim_clusters_covered / selected_sources)
  —— 0 = 每源独立 claim；接近 1 = 大量源聚到少数 claim cluster
  —— HIGH = MORE REDUNDANT（方向一致）
```

### 1.3 P0-3 — FIX: Disputed Gold Handling（annotation uncertainty 不得变成 strategy failure）

```text
规则（替换原 "disputed → 不计分子但仍计分母"）:
  ADJUDICATED GOLD   → scored（进入 numerator 与 denominator）
  DISPUTED / UNRESOLVED → 从 scored numerator 和 denominator 同时排除
                         → 单独报告，不进任何 recall 计算
新增输出字段（每 case 必报）:
  scorable_gold_count     = adjudicated gold 总数（可计分）
  unresolved_gold_count   = disputed/unresolved gold 数
  gold_dispute_rate       = unresolved_gold_count / (scorable_gold_count + unresolved_gold_count)
所有 recall metric（F1–F18 + cross_question_claim_recall）的 denominator 一律为 scorable gold，
不再包含 unresolved。
```

### 1.4 P1-1 — FIX: Contradiction Recall（主指标改为 claim-based）

```text
NAME: contradiction_claim_recall（冻结主指标；替换 source-pair 主分母）
FORMULA_OR_PROCEDURE:
  contradiction_claim_recall =
    # gold contradictory claims with >=1 valid support AND >=1 valid opposition selected
    / # scorable gold contradictory claims
  —— 以 claim 为计分单元；一个 claim 双侧各至少一个有效来源选中才算 covered
REQUIRED_LABELS: claim_id / stance / opposing_source_ids[] / support_source_ids[]（scorable）
AGGREGATION: case 级（B/F 类必报）
FAILURE_MODE: 主流高赞 side 全选但 opposition side 全漏 → 该 claim 不计为 covered
INTERPRETATION: 高 = 冲突证据结构被保留
DO_NOT_CLAIM: 不把"support×opposition source pair 覆盖率"当主指标
诊断（保留，非主指标）:
  contradiction_source_pair_coverage =
    # gold contradiction source-pairs with both sides selected / # gold pairs
  —— 只作诊断，不进主指标表
```

### 1.5 P1-2 — FIX: Question Diversity Normalization

```text
NAME: normalized_question_diversity（冻结主指标；可跨 case 比较）
FORMULA_OR_PROCEDURE:
  Q = scorable reference question count for the case
  raw_simpson_diversity = 1 - Σ_q (n_q / n)²   （n_q = selected sources in question q；n = selected total）
  normalized_question_diversity = raw_simpson_diversity / (1 - 1/Q)
  —— Q <= 1 时 metric = N/A（无跨问题多样性可测）
可选保留:
  raw_simpson_diversity（不归一化，作为 raw diagnostic）
REQUIRED_LABELS: 机械 questionId
AGGREGATION: case 级（G 类必报）
FAILURE_MODE: 单 Question 支配 → normalized 值低
INTERPRETATION: 归一化后跨 case 可比；与 recall 联合
DO_NOT_CLAIM: 不把 raw Simpson 当可跨 case 比较的主指标；Q<=1 不报数字
```

### 1.6 P1-3 — FIX: Per-question Coverage Denominator（value-bearing units，非 answer count）

```text
NAME: per_question_coverage_preservation（冻结；denominator 修正）
FORMULA_OR_PROCEDURE:
  per_question_value_units(q) = gold value units for question q，至少包括：
    - must-see sources（question 内）
    - critical-aspect coverage units（question 内贡献的 critical aspect 覆盖）
    - unique claims（question 内独有的 substantive claim）
    - required contradiction side（若 question 承载某个 contradictory claim 的必要一侧）
    - important expert / evidence source-groups（question 内）
  per_question_coverage_preservation =
    covered_value_units(q) / scorable_value_units(q)，report min + mean over selected questions
  —— 不奖励"抓越多 document 越好"：单位是 value units，不是 raw answer count
NAME: minority_question_recall（同步修正 denominator）
FORMULA_OR_PROCEDURE:
  minority_question_recall =
    covered_value_units(non-largest questions) / scorable_value_units(non-largest questions)
  —— 同样基于 value-bearing gold units，而非纯 answer count
REQUIRED_LABELS: value-unit 级 gold 标签（must_see / critical_aspect_unit / unique_claim /
                 required_contradiction_side / expert_group / evidence_group）
AGGREGATION: case 级（G 类必报）
FAILURE_MODE: 大 Question 的 value units 覆盖好，小 Question 的 value units 全漏
INTERPRETATION: min 低 = 某问题价值单元被整体跳过
DO_NOT_CLAIM: 不按 raw answer count 计分母；不宣称"每题全量"
```

### 1.7 P1-4 — FIX: Freshness Window（90 天降级为 pilot candidate）

```text
删除 canonical: "fresh = cutoff 前 90 天"
冻结定义:
  freshness_window_policy = case-specific / event-relative / pilot-calibrated
    - case-specific: 每 case 由标注者定义"新"的合理窗口（依据内容性质）
    - event-relative: E 类 case 以 event_date 为锚（如 event_date 后 X 天内发布）
    - pilot-calibrated: 窗口值由 pilot 证据校准
  PILOT_CANDIDATE_WINDOW = 90 days（仅 pilot 默认建议值，非 benchmark canonical threshold）
fresh_relevant_sources / historically_authoritative_sources 定义不变，
但窗口值来自 freshness_window_policy，不硬编码。
```

### 1.8 P1-5 — FIX: Run-to-run Stability（全部 pairwise，不锚 run1）

```text
NAME: run_to_run_stability（冻结；统计修正）
FORMULA_OR_PROCEDURE:
  n runs → 计算全部 C(n,2) 个 pairwise Jaccard(selected_ids)
  输出至少:
    jaccard_stability_mean = mean over all pairs
    jaccard_stability_min  = min over all pairs
  —— 不再以 run1 为 anchor
REQUIRED_LABELS: 无（重复运行）
AGGREGATION: case 级
FAILURE_MODE: 任一对运行显著漂移 → min 低
INTERPRETATION: mean 反映典型稳定性，min 反映最坏一致性；稳定 ≠ 正确
DO_NOT_CLAIM: 不单用 run1-anchor；不把 stability 当 quality
（jaccard_stability 保持为通用集合重叠度量，跨 strategy 比较用同一定义）
```

### 1.9 P1-6 — FIX: Annotator Agreement Threshold（删除硬编码 60%）

```text
删除: "2 标注者初始 agreement >= 60%，否则 HARD 或剔除"
冻结规则:
  pilot 先记录（每 case）:
    raw_agreement                 （简单一致性：一致标签 / 总标签）
    chosen_inter_annotator_statistic（选择一个简单可靠的 statistic，如 Cohen's kappa
                                     或 raw agreement；由 pilot 数据后选定，不预先双轨）
    gold_dispute_rate             （= unresolved / (scorable + unresolved)，见 P0-3）
  case 的 inclusion/exclusion acceptance threshold 由 pilot evidence 后确定
  —— 不预先硬编码阈值；避免过度工程化，只选一个统计量
```

---

## 2. Corrected Gold Freeze Protocol（P0-4）

```text
DATASET_VERSION D1 冻结流程:
  1. 构造 dataset_version D1（reference_pool D1 + gold D1 + label-schema D1）
  2. FREEZE：D1 内 reference_pool 与 gold 不再修改
  3. 所有 compared strategies 对同一个 D1 运行（同一 pool、同一 gold、同一 budget）
  4. 禁止在同一 dataset_version 中边运行 strategy 边修改 gold

OUT_OF_POOL_DISCOVERY（某 strategy 发现 pool 外候选）:
  1. 记录为 out_of_pool_discovery（provenance 保留）
  2. 该候选进入 blind human adjudication（标注者不知道来源策略）
  3. 若判定"不应进入 reference/gold" → 记为 rejected_extra_candidate（不进 gold，也不惩罚）
  4. 若判定"应进入 reference/gold" →
       a. 冻结的 D1 结果对该 case 标记: STALE / INVALID_FOR_FINAL_COMPARISON
       b. 创建 dataset_version D2（reference_pool D2 = D1 ∪ 新来源；gold D2 重标增量）
       c. 所有 compared strategies 必须在 D2 重新计分（同 D1 一样全量重跑）
       d. D1 结果保留为历史快照，但不用于最终比较

比较规则:
  FINAL_COMPARISON 只允许在同一 dataset_version 内进行
  跨版本结果不混用（D1 vs D2 不得并排作为同一次比较）
```

**同步更新位置**：Gold Protocol（§D1.2 回流规则替换为上述冻结流程）→ Machine Contract（新增 dataset_version 状态字段，见 §3）→ Pilot Protocol（见 §4）。

---

## 3. Affected Machine-Contract Fields

在原 §K contract 基础上增改：

```json
{
  "dataset_version": "dset-2026-08-26-v1",
  "dataset_version_status": "frozen | stale_invalid_for_final | superseded_by_D2",
  "gold_stats": {
    "scorable_gold_count": 42,
    "unresolved_gold_count": 3,
    "gold_dispute_rate": 0.066
  },
  "out_of_pool_discoveries": [
    { "source_id": "question-X-answer-Y", "adjudication": "rejected_extra | promoted_to_D2" }
  ],
  "metric_results": {
    "must_see_recall": 0.8,
    "aspect_recall_critical": 0.75,
    "expert_recall": 0.6,
    "long_tail_recall": 0.5,
    "fresh_content_recall": 0.0,
    "evidence_rich_recall": 0.7,
    "contradiction_claim_recall": 0.5,
    "contradiction_source_pair_coverage": 0.33,
    "cross_question_claim_recall": 0.4,
    "semantic_redundancy": 0.35,
    "claim_redundancy": 0.28,
    "analysis_coverage": 0.0,
    "normalized_question_diversity": 0.71,
    "source_concentration": { "largest_question_share": 0.52, "author_herfindahl": 0.18 },
    "minority_question_recall": 0.44,
    "per_question_coverage_preservation": { "min": 0.4, "mean": 0.66 },
    "independent_source_diversity": 0.55,
    "false_stop_rate": null
  },
  "stability": {
    "run_count": 3,
    "jaccard_stability_mean": 0.88,
    "jaccard_stability_min": 0.81
  },
  "freshness": {
    "policy": "case-specific",
    "window_days": null,
    "pilot_candidate_window_days": 90
  },
  "annotator": {
    "raw_agreement": 0.72,
    "inter_annotator_statistic": "cohens_kappa",
    "statistic_value": 0.55
  }
}
```

删除字段：原 `disputed` 进入 recall 分母的语义（不再存在）；原 `run_to_run` 单锚字段（替换为 mean/min）；原 `fresh_content_recall` 的固定 90 天注解（替换为 policy 字段）。

---

## 4. Affected Pilot Rules

| Pilot 规则 | 原值 | 修正值 |
|---|---|---|
| Gold freeze | 回流规则（§D1.2） | **dataset freeze**：D1 freeze → 全部 strategy 对同一 D1 运行；out-of-pool discovery → blind adjudication → 必要时 D2 重建 + 全量重计（§2） |
| 标注者 agreement | 硬编码 ≥60% 否则剔除 | pilot 记录 raw_agreement + chosen statistic + gold_dispute_rate；threshold pilot 后定（P1-6） |
| Freshness | 固定 90 天 | PILOT_CANDIDATE_WINDOW = 90 天；policy = case-specific/event-relative（P1-4） |
| Stability | 3 次运行锚 run1 | 3 次运行 → 全部 C(3,2)=3 对 pairwise Jaccard → mean + min（P1-5） |
| Case inclusion | agreement 门槛 | 移除硬编码门槛；case 难度标注保留（EASY/MEDIUM/HARD），阈值 pilot 后定 |
| metric 表 | F1–F18（无 cross-question claim recall；redundancy 方向为 diversity） | 新增 cross_question_claim_recall；redundancy 方向 HIGH=more redundant（P0-1/P0-2） |
| 新指标口径 | — | contradiction 主指标 = claim-based；source-pair 仅诊断（P1-1） |
| per-question / minority 分母 | answer count | **value units**（must-see / critical-aspect / unique claim / required contradiction side / expert / evidence group）（P1-3） |

Pilot 输出表增加：每 case 的 `scorable_gold_count` / `unresolved_gold_count` / `gold_dispute_rate`（P0-3），以及 cross-question 指标行（G 类）。

**OPTIONAL — 未来 ablation 记录（不执行）**：Pilot Plan 增加 future optional ablations 备注：`TARGET - Query Expansion` / `TARGET - RRF` / `TARGET - Metadata Features` / `TARGET - Multi-lane`——目的为确认 TARGET 复杂度增量的价值；**禁止 full factorial search**。当前不运行。

---

## 5. Final Consistency Audit

| 检查项 | 状态 |
|---|---|
| Reconciliation 声明的 07 §13 五指标全部有正式 metric（Question Diversity / Source Concentration / **Cross-question Claim Recall（新增）** / Minority-question Recall / Per-question Coverage Preservation） | ✅ |
| Redundancy 方向全链路一致（semantic_redundancy + claim_redundancy 均 HIGH=more redundant；INTERPRETATION/FAILURE_MODE 同步） | ✅ |
| Disputed gold 语义全链路一致（所有 recall denominator = scorable；unresolved 单独报告） | ✅ |
| Contradiction 主指标 = claim-based；source-pair 降级诊断 | ✅ |
| Question diversity 归一化可跨 case 比较；Q≤1 → N/A | ✅ |
| Per-question / minority denominator = value units（非 answer count） | ✅ |
| Freshness 无 canonical 阈值；90 天仅 pilot candidate | ✅ |
| Stability 全 pairwise（mean+min），无 run1 锚 | ✅ |
| Annotator threshold 无硬编码；pilot 记录三项统计 | ✅ |
| Gold freeze：禁止同 dataset_version 边跑边改 gold；D2 重建 + 全量重计 | ✅ |
| 未改动：Tier / Dataset Taxonomy / Baseline Direction / 复杂算法状态 / 授权 / 版本 | ✅（本轮范围外） |

---

```text
TRACK_B_METRIC_GOLD_CORRECTION = COMPLETE
TRACK_B_DESIGN                 = COMPLETE（维持；本轮为 contract 修正，不重做）
TRACK_B_PILOT_EXECUTION        = NOT_STARTED
SPEC_PREPARATION_GATE          = NOT_READY
IMPLEMENTATION_AUTHORIZATION   = NONE
VERSION_ASSIGNMENT             = UNASSIGNED
THIS_ROUND_EDITS               = NONE（production read-only；仅 .workbuddy/memory/ 日志）
```

等待 ChatGPT 对本修正包复核。在收到进一步指令前 **STOP**。