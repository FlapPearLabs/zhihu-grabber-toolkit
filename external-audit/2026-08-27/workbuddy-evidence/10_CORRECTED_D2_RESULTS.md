# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 10 CORRECTED D2 RESULTS

> **CURRENT_FINAL_PILOT_RESULT**（`benchmark/results/runs-corrected-d2/` 96 runs + `summary.json`）。
> 全部数字可直接从 `benchmark/results/summary.json` 核验。
> 状态：`HARNESS_SANITY_ONLY`（B1/B2 为 ngram proxy，非 real embedding）。

---

## 1. 运行规模

```text
8 cases × 3 fair strategies × 3 budgets = 72 fair runs
+ 24 oracle runs（B2_ORACLE_LANES，UPPER_BOUND_DIAGNOSTIC_ONLY，不进 fair comparison）
= 96 runs，全部 deterministic（jaccard_stability_mean=1.0, min=1.0）
schema_version = 3.0.0-d2；dataset_status = D2；result_status = HARNESS_SANITY_ONLY
```

---

## 2. 关键结果（fair，K_MEDIUM 为主；数字四舍五入）

### 2.1 case-synth-dominance（1000/50/30 三问支配形状；FIXTURE_MECHANICAL gold）

| strategy | K | must_see | aspect | expert | diversity | xq_recall | semRed | cost(ops) |
|---|---|---|---|---|---|---|---|---|
| B0 | 10 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.45 | ~7.5k |
| B0 | 20 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.48 | ~7.5k |
| B0 | 40 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.50 | ~7.5k |
| B1 | 10 | 0.000 | 0.333 | 0.000 | 0.000 | 0.000 | 0.80 | 2.2k |
| B1 | 20 | 0.000 | 0.333 | 0.000 | 0.000 | 0.000 | 0.64 | 2.2k |
| B1 | 40 | 0.083 | 0.667 | 0.000 | 0.609 | 0.000 | 0.43 | 2.2k |
| B2 | 10 | 0.083 | 1.000 | 0.200 | 0.960 | 1.000 | 0.27 | 27k |
| B2 | 20 | 0.167 | 1.000 | 0.600 | 0.960 | 1.000 | 0.28 | 76k |
| B2 | 40 | 0.167 | 1.000 | 0.600 | 0.962 | 1.000 | 0.30 | 276k |

**解读（中性）**：合成 case 上 B2 对"大问题碾压小问题"的失败模式有强区分能力（diversity 0→0.96、expert 0→0.6、xq 0→1.0）。但这是**构造 fixture**，不是生产证明。

### 2.2 case-cross-lowcode（6 真实问 / 75 源；HUMAN_ADJUDICATED gold）

| strategy | K | must_see | aspect | expert | diversity | xq_recall | semRed | cost(ops) |
|---|---|---|---|---|---|---|---|---|
| B0 | 5 | 0.200 | 0.333 | 0.125 | 0.384 | 0.250 | 0.28 | 325 |
| B0 | 10 | 0.400 | 0.833 | 0.188 | 0.696 | 0.500 | 0.28 | 325 |
| B0 | 20 | 0.533 | 1.000 | 0.344 | 0.864 | 1.000 | 0.26 | 325 |
| B1 | 5 | 0.133 | 0.333 | 0.094 | 0.672 | 0.000 | 0.25 | 151 |
| B1 | 10 | 0.200 | 0.667 | 0.094 | 0.792 | 0.000 | 0.26 | 151 |
| B1 | 20 | 0.267 | 0.667 | 0.219 | 0.792 | 0.250 | 0.29 | 151 |
| B2 | 5 | 0.133 | 0.333 | 0.094 | 0.384 | 0.000 | 0.26 | 707 |
| B2 | 10 | 0.200 | 0.833 | 0.156 | 0.768 | 0.000 | 0.25 | 1.7k |
| B2 | 20 | 0.400 | 1.000 | 0.250 | 0.924 | 0.500 | 0.24 | 5.8k |

**解读（中性）**：
- B0（popularity）在真实 case 上 **must_see 最高**（0.4@K10 vs B1/B2 0.2），cross-question claim recall 也最高（0.5@K10）——**人气基线在真实数据上不是最差**。
- B2 的 aspect/diversity 改善伴随 4–38× 成本；must_see 未超过 B0。
- **B2 优于 B1：未证实**（must_see 相等；xq_recall B1 在 K5/K10 为 0）。

### 2.3 case-439521858（17 源单题；HUMAN_ADJUDICATED gold）

| strategy | K=3 | K=5 | K=8 | 备注 |
|---|---|---|---|---|
| B0 must_see | 0.500 | 0.750 | 1.000 | expert 0.5→0.75 |
| B1 must_see | 0.500 | 0.750 | 1.000 | expert 0.25→0.5 |
| B2 must_see | 0.250 | 0.500 | 0.750 | expert 0.25→0.5；cost 82→308 |

**解读**：K=3/5 时 B2 must_see **低于 B0**；K=8 才追平。B2 无优势。

### 2.4 case-synth-expert（40 源专家保留 fixture；FIXTURE_MECHANICAL gold）

| strategy | K=5 expert | K=10 expert | semRed@K10 |
|---|---|---|---|
| B0 | 0.000 | 0.000 | 0.40 |
| B1 | 0.500 | 1.000 | 0.35 |
| B2 | 0.300 | 0.600 | 0.21 |

**解读**：B1 在 K=10 达到 expert=1.0（高于 B2 0.6）；B2 冗余更低。合成 case 上 B1/B2 各有胜负。

---

## 3. 跨 case 结论（中性表述）

1. **指标可以区分 B0/B1/B2**：合成 dominance case 区分度最强；真实 cross case 上 B0 vs B2 在 diversity/aspect 有差异。
2. **真实 case 上没有任何策略全面胜出**：B0 在 must_see/xq_recall 上意外领先；B2 只在 diversity/aspect/redundancy 有边际改善；B1 最便宜。
3. **B2 > B1 未证实**：must_see 相等或更差；成本 2–35×（真实）~ 12–127×（synth 大 pool）。
4. **小 case 饱和**：485463474（relevant=2）、487214224（relevant=1）→ recall 饱和，区分度消失（新盲区）。
5. **freshness 弱**：真实 case 中 3/5 fresh window 内无内容 → N/A；唯一有 fresh 的 487214224 其 fresh source 是 off-topic 噪音。
6. **historical_authority 全 N/A**（UNRESOLVED→NOT_SCORABLE）。
7. **analysis_coverage 无区分度**（闭环 pool 下恒 1 或近似 1）。
8. **成本不对称**：B2 的 MMR 需要全 pairwise 相似度（1080 源 pool 时 75k–276k ops），生产可行性未评估。

---

## 4. 稳定性

- 全部 selector deterministic → 96 runs 重复一致（jaccard 1.0/1.0）。
- 注意：**Stable ≠ Correct**（README 明示）。

---

## 5. 与本包其他结果的关系

| 产物 | 状态 | 与当前结果关系 |
|---|---|---|
| runs-d1/（143） | SUPERSEDED | D1 gold 不同；仅历史参考 |
| runs-d2-invalid/（96） | INVALIDATED（ASPECT_NAMESPACE_RECONCILIATION_BUG） | aspect_recall 数字无效；其余指标近似 |
| runs-corrected-d2/（96） | **当前唯一有效** | 本文件全部数字来源 |

---

## 6. 必须重复的 caveat

- **HARNESS_SANITY_ONLY**：B1/B2 是 char n-gram 代理，不是 real semantic embedding；结论不保证迁移。
- **合成证据 ≠ 生产证明**：synth case 的 gold 是生成器机械构造的。
- **真实 case 数量小**：6 个真实 case（5 单题 + 1 跨问题），语料域单一（低代码选型）。
- **无 Tier-3**：false_stop_rate = NOT_RUN。
- **没有任何策略被宣布为 winner**（本 pilot 无权下此结论）。
