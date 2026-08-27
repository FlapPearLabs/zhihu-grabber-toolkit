# Temporal Intelligence Engine — Final Design

STATUS: DESIGN_FROZEN  
VERSION_ASSIGNMENT: UNASSIGNED  
IMPLEMENTATION_AUTHORIZATION: NONE

> **Terminology note:** `V1` / `V1 baseline` in this document means the first implementation baseline of this design only. It does **not** assign a product version. `VERSION_ASSIGNMENT` remains `UNASSIGNED`.

---

## 1. Goal

用于：

- Author Historical Research
- Personal Historical Research
- Continuous Monitoring

目标不是：

> 每次新内容出现都让 LLM 重新读全部历史。

目标是：

> 建立长期 baseline，增量更新，并只对真正有意义的变化进行昂贵语义分析。

---

## 2. V1 Engineering Strategy

第一版 Temporal Intelligence 同样遵循：

> SIMPLE BASELINE FIRST

V1 不直接上线：

- complex changepoint ensembles；
- permutation test + FDR pipeline；
- learned semantic-shift model；
- graph embeddings；
- style foundation model；
- RL alert policy。

V1 先证明：

> baseline + delta + simple topic/claim statistics

是否已经足以产生高价值 monitoring。

---

## 3. Data Foundation

第一次：

```text
FULL BASELINE

枚举当前可访问：
- Answers
- Articles
- Pins
- Questions
- other supported public content

Canonicalize
        ↓
Verify
        ↓
SQLite
        ↓
Historical Corpus
```

---

## 4. SQLite Role

SQLite 不是简单 cache。

它是：

> Historical State Store

建议概念表：

- entities
- contents
- content_versions
- relations
- captures
- snapshots
- watch_targets
- watch_runs
- research_corpora

SQLite 足够轻量，并支持：

- local-first；
- transactional updates；
- indexed temporal queries；
- content version history；
- easy export / backup；
- future migration if required。

---

## 5. Incremental Sync

后续：

```text
Current Enumerable State
        ↓
Compare previous snapshot
        ↓

NEW
UPDATED
REMOVED / UNAVAILABLE
UNCHANGED
```

只有 Delta 需要重新进入昂贵语义处理。

---

## 6. V1 Temporal Representation

按时间窗口保存：

- Topic(t)
- Claim(t)
- Stance(t)
- Style(t)
- Activity(t)

其中 V1 强制优先实现：

- Topic distribution
- Claim additions/removals
- Activity count
- content-type mix

Stance / Style 可以先以轻量 features 实现。

---

## 7. V1 Change Detection

V1 不直接建立复杂统计模型。

先比较：

- recent topic distribution vs historical baseline；
- new claim clusters；
- disappearing claim clusters；
- new evidence patterns；
- activity spikes；
- content-type shifts。

产生：

> CHANGE_CANDIDATE

而不是直接：

> AUTHOR_CHANGED_OPINION

---

## 8. LLM Role

LLM 不负责全历史重读。

仅在 controller 检测到：

> CHANGE_CANDIDATE

时，读取相关时间窗口与 canonical evidence，
解释变化是否有语义意义。

Controller 仍拥有：

- source identity；
- timeline；
- counts；
- coverage；
- change candidate trigger。

---

## 9. V1 Event Model

候选：

- CONTENT_CREATED
- CONTENT_UPDATED
- TOPIC_EMERGENCE
- TOPIC_DECLINE
- CLAIM_EMERGENCE
- CLAIM_DISAPPEARANCE
- ACTIVITY_SPIKE
- CONTENT_TYPE_SHIFT

以下允许输出：

> CANDIDATE

而不是强结论：

- STANCE_SHIFT_CANDIDATE
- STYLE_SHIFT_CANDIDATE

---

## 10. Alert Policy

新发一篇内容 ≠ 必须通知。

默认区分：

### Raw Update

有新内容。

### Intelligence Event

有显著且有意义的变化。

用户可以选择：

- all updates;
- significant-only;
- topic-specific.

---

## 11. Monitoring Architecture

目前没有已确认的知乎作者内容 inbound webhook。

因此第一版：

```text
scheduler
→ incremental sync
→ SQLite diff
→ Temporal Intelligence
→ our webhook / notification
```

未来如果官方出现 event subscription：

新增 Provider，
不改 Intelligence Engine。

---

## 12. Future Mathematical Tools

### Jensen-Shannon Divergence

来源领域：

> Information Theory

用途：

比较两个时间窗口 topic probability distributions。

状态：

> FUTURE_CANDIDATE / LOW-COMPLEXITY

可较早 benchmark，但不是 V1 hard dependency。

---

### Change-point Detection

来源领域：

> Time-series Statistics

用途：

自动检测 topic/activity 结构性变化点。

状态：

> FUTURE_CANDIDATE

只有积累足够长时间序列后才有意义。

---

### Permutation Test + FDR

来源领域：

> Statistical Hypothesis Testing / Multiple Testing

用途：

验证 semantic shift 是否超过随机波动。

状态：

> FUTURE_CANDIDATE / DO_NOT_IMPLEMENT_NOW

原因：

- 需要足够样本；
- 需要定义 null distribution；
- FDR pipeline 增加统计复杂度；
- 第一版可以先输出 candidate，不做过强结论。

---

### Learned Semantic Shift Model

状态：

> DEFERRED

当前不训练。

---

## 13. Risk of Being Too Simple

### Risk A — False positive topic shift

Mitigation:

- minimum sample size；
- compare multiple windows；
- LLM only explains evidence-backed candidates。

### Risk B — Missed stance change

Mitigation:

- preserve Claim / Stance fields；
- store canonical historical evidence；
- future statistical shift models can reprocess history。

### Risk C — Sparse authors

Mitigation:

- do not claim stable long-term trends with insufficient history；
- output data sufficiency status。

### Risk D — alert noise

Mitigation:

- separate Raw Update from Intelligence Event；
- significant-only default recommended。

---

## 14. Coverage Contract

作者“全部历史”统一定义为：

> 当前 Provider 可枚举、当前仍可访问的历史内容。

必须报告：

- enumerated count;
- captured count;
- verified count;
- unavailable count;
- date range;
- content types.

禁止把：

> CURRENTLY ACCESSIBLE COMPLETE SET

说成：

> EVERYTHING EVER PUBLISHED.

---

## 15. V1 / Future Boundary

```text
V1:
Historical Baseline
+ SQLite
+ Incremental Diff
+ Topic/Claim Basic Statistics
+ Simple Change Heuristics
+ Evidence-backed LLM Explanation

FUTURE:
JS Divergence
+ Change-point Detection
+ Permutation Test
+ FDR
+ Learned Semantic Shift
+ Advanced Graph Delta
```

---

## 16. Freeze

```text
TEMPORAL_INTELLIGENCE_V1 = SIMPLE_BASELINE_FIRST
ADVANCED_STATISTICS = FUTURE_CANDIDATE
IMPLEMENTATION_AUTHORIZATION = NONE
```
