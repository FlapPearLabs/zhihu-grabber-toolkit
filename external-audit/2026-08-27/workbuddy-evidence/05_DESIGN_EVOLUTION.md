# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 05 DESIGN EVOLUTION

> 中立决策历史表。每一行 = 一次方向性改变。
> 目的：让 Reviewer 快速看清"为什么从 A 走到 B"，包括每次失败与代价。
> 证据来源：workspace memory 2026-08-26/27 + 各 TRACK_B packet + adjudication JSON。

---

## 1. 决策历史表（12 行）

| # | OLD_DIRECTION | EVIDENCE / FAILURE | WHY_CHANGED | NEW_DIRECTION | CURRENT_CONFIDENCE | OPEN_UNKNOWN |
|---|---|---|---|---|---|---|
| 1 | Answer quality ranking（按质量排序答案） | 用户原始直觉：高赞≠高质量；但"质量"无定义、不可测量 | 需要可测量、可审计的对象；质量排序被证明无法客观定义 | Research Coverage（覆盖性子集选择） | HIGH（方向合理） | "覆盖"的量化标准仍依赖 benchmark 定义 |
| 2 | Single-question 抓取 | 439521858 / 477427067 单题语料无法回答跨题研究问题 | 用户研究问题天然跨多题（选型=多问） | Cross-question 研究（natural language → ≥3 questions） | HIGH | 问题-研究问题映射（Expansion）未实现 |
| 3 | Weighted quality score（加权质量分） | 无法客观定义权重；权重=拍脑袋；评审反复质疑 | 被评审（ChatGPT）指为无依据的 heuristic | Subset selection under constraints（budget 约束下选择） | HIGH | budget 语义（K vs tokens）未定 |
| 4 | Pure popularity / pure semantic Top-K | B0/B1 pilot：popularity 主导、semantic 过集中（synth-dominance B1 全选单问） | 单一信号无法覆盖多类价值 | Diversity exploration（diversity 指标 + MMR） | MEDIUM | diversity 与 relevance 的 trade-off 无 production 依据 |
| 5 | MMR（纯 relevance−λ·redundancy） | 真实 case 上 B2 未显著优于 B1；成本 2–35× | 单一 MMR 无法保护专家/反方/新鲜等小众价值 | MMR + Multi-lane 假设 | LOW-MEDIUM（未证实） | lane 配额、λ、relevance gate 均未定 |
| 6 | Lanes（机械 lane 配额） | cross case：lane 配额保护 lane 不保护小 question（3 答小问题 minority min=0）；K_LARGE fresh lane 选入 off-topic 噪音 | lane 配额解决"覆盖类别"不解决"覆盖问题" | Question-level coverage 显式约束（per-question coverage / minority recall 指标化） | LOW（识别出问题，未解决） | 显式约束机制未设计 |
| 7 | Provisional semantic labels（agent 自标） | 初版 gold 全部 agent PROVISIONAL；评审禁止"自己给自己出题" | 需要独立 authority | Independent Gold（ChatGPT source-level adjudication） | HIGH（已完成） | adjudication 后仍存在 UNRESOLVED 族（historical_authority 全 UNRESOLVED） |
| 8 | Global source labels（按 source 全局标） | V2.1 按 source_id 合并/OR 多 case label → 丢失 case×source 语义；case A must_see=true 泄漏到 case B | 评审（V2.2 CHANGES_REQUESTED）指出语义泄漏 | Case × source labels（两层结构：sources intrinsic + case_labels semantic） | HIGH（已验证无传播） | 多 case 共享源的解释成本（135 case_labels） |
| 9 | Strategy Gold leakage（B2 读 gold 选 lane） | 初版 B2 用 gold.expertise/contradiction 作为 lane 信号 = 用答案偷看考卷 | 评审（P0-1）确立 STRATEGY_FEATURES ≠ EVALUATION_GOLD | Strategy/evaluation separation（mechanical lanes + oracle diagnostic 隔离） | HIGH（已实施+测试） | expert/contradictory 的独立信号仍未找到（lanes 空） |
| 10 | D1（agent provisional gold） | 语义 gold 未经独立裁定；多轮 metric/gold 修正仍无法自证 | ChatGPT 完成 source-level adjudication | Adjudicated D2 | HIGH（当前有效） | D2 依赖 ChatGPT 裁定质量；UNRESOLVED 处理 |
| 11 | First D2（aspect 名裸用） | **ASPECT_NAMESPACE_RECONCILIATION_BUG**：3 case 的 KEEP aspect 被误 drop（cross 6→4；aspect_recall 0.750=3/4 违反 1/6 倍数） | ChatGPT 审查发现 namespace 不匹配（`case-477427067:asp-vendor` 等） | Namespace reconciliation correction（D2 corrected） | HIGH（16/16 validation） | 无（bug 已闭合） |
| 12 | （未发生）Real embedding / TARGET 实现 | — | — | **NOT_IMPLEMENTED**（刻意推迟到 benchmark 结论被审查后） | — | real embedding 是否改变 B1/B2 结论 |

---

## 2. 观察（中立，非结论）

- 方向演变总趋势：**从"排序"走向"覆盖"，从"agent 自证"走向"独立裁定"，从"单策略"走向"可比较基线"**。
- 每次评审的 CHANGES_REQUESTED 都对应一个真实缺陷（除 #10 是计划内升级）。
- 当前最大的设计悬而未决项集中在：**lane 机制的价值未被证实**（#5/#6）、**question-level coverage 未解决**（#6）、**embedding 缺失**（#12）。

---

## 3. 时间线（简短）

```text
2026-08-26  Track A 发现（官方平台 + OSS 审计）→ PASS
2026-08-26  Track B Benchmark Design → PASS；Metric/Gold 修正 2 轮（4P0+6P1, 3P0+3P1）
2026-08-27  ① Pilot（8 case，72 runs）→ PILOT_PARTIAL
2026-08-27  ② Harness Correction（P0-1..P0-7, P1-1..P1-2, 10 测试）→ PASS
2026-08-27  ③ Adjudication V2.1（excerpt/schema/expert evidence）→ PASS
2026-08-27  ④ Adjudication V2.2（case-scoped model）→ PASS
2026-08-27  ⑤ D2 Gold build + rerun（ChatGPT adjudication 应用）→ D2_PILOT_PARTIAL
2026-08-27  ⑥ D2 correction（ASPECT_NAMESPACE_RECONCILIATION_BUG 修复，16/16 validation）→ PASS_AS_PARTIAL_EVIDENCE
2026-08-27  ⑦（本轮）External Audit Pack Assembly → READY_FOR_EXTERNAL_REVIEW
```
