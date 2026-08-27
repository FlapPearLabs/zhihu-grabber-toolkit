# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 09 SEMANTIC GOLD ADJUDICATION

> 目的：完整呈现 Semantic Gold 如何从"agent 提案"变成"ChatGPT 独立裁定"，以及当前 Gold 的结构与质量特征。
> 权威输入：`benchmark/adjudication/TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json`（唯一 Semantic Gold authority）。

---

## 1. 裁定流程（时间线）

```text
Pilot（2026-08-27 ①）          agent 生成 PROVISIONAL 语义标签提案（禁止自封 FINAL）
Adjudication V2（P0-7）         逐 source 提案 packet（75 sources，无 popularity 字段）
Adjudication V2.1               补全 excerpt/expert evidence/label schema（3 源 sanitizer 误杀修复）
Adjudication V2.2               两层数据模型（sources intrinsic + case_labels semantic；provenance≠stance；
                                gold-independent expertise discovery）
ChatGPT source-level adjudication（COMPLETE）
  → TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json（135 case_labels + 6 case_schema + provenance final）
D2 Gold build                   机械转换（build-d2-gold.mjs）+ 16/16 validation
D2 corrected rerun              CURRENT_FINAL_PILOT_RESULT
```

---

## 2. Adjudication JSON 结构（权威输入）

```text
case_schema_decisions          6 case 的 aspect/claim keep/drop（namespaced keys）
case_label_decisions           135 条 case_id × source_id 裁定
required_provenance_final      cross-question claim 的最终 provenance groups（xq4 重建）
global_rules                   relevance gate / UNRESOLVED 处理等 8 条
d2_instruction                 D2 构建指令（hash 内容等 4 项）
adjudicator / schema_version / source_packet / adjudication_basis
```

---

## 3. 关键裁定内容（摘要）

### 3.1 global_rules（核心）
- Gold unit = `case_id × source_id`
- relevance gate：除 relevance 外，must-see/aspect/expert/long-tail/evidence/stance/historical 进入 scored Gold 前必须 `relevance == true`
- UNRESOLVED：不计 num、不计 den、单独统计；不得 UNRESOLVED→false
- **全部 real-case historical_authority = UNRESOLVED**（→ D2 中 NOT_SCORABLE/N/A）

### 3.2 case_schema_decisions（KEEP/DROP）
- case-477427067：DROP `c2-vendor-neutrality`（contradiction gold）
- case-485463474：KEEP `asp-permission`；DROP `asp-concept` / `asp-critique` / `c1-innovation-vs-repackaging`
- case-439521858 / case-477427067 / case-466695857 / case-487214224 / case-cross-lowcode：按 Final KEEP set（namespaced，如 `case-477427067:asp-vendor`）

### 3.3 required_provenance_final
- 废弃旧 D1 required provenance groups
- **xq4-vendor-tension 重建为：vendor-self-promotion VS independent-or-countervailing-evaluation**

### 3.4 claim_stances
- 完全采用 adjudication final；禁止恢复 provisional stances
- 禁止：情绪化 insult 自动作为 contradiction；推荐其它厂商自动作为 positive stance；provenance membership 自动生成 stance

---

## 4. D2 Gold 统计（build-d2-gold 输出，对比 D1）

| case | relevant D1→D2 | must_see | expert scorable（unres） | evidence_quality（unres） | aspects |
|---|---|---|---|---|---|
| case-439521858 | 17→13 | ↓ | SUPPORTED 扩宽 | 收紧 | 4 |
| case-477427067 | 18→16 | ↓ | SUPPORTED 扩宽 | 收紧 | 4 |
| case-466695857 | — | ↓ | SUPPORTED 扩宽 | 收紧 | 3 |
| case-485463474 | 7→**2** | ↓ | — | 收紧 | 1 |
| case-487214224 | 2→**1** | ↓ | — | 收紧 | 1 |
| case-cross-lowcode | 74→66 | ↓ | SUPPORTED 扩宽 | 收紧 | 6 |

（synthetic 2 case 未 adjudicate：FIXTURE_MECHANICAL 不变。）

---

## 5. Gold 质量特征（中立评估）

**支持可信的方面：**
- 独立裁定者（ChatGPT），非 agent 自证；盲于策略输出
- relevance gate 严格；UNRESOLVED 不伪造
- case-scoped（无跨 case 传播）；provenance 与 stance 分离
- 16/16 机械 validation（aspect ID set、membership exact-match、relevance gate、D1 units 不复用、D2 hash≠D1）

**保留谨慎的方面：**
- 裁定质量本身未再被第二方核验（ChatGPT 是唯一 authority）
- expert 判定依赖作者名/内容自述（author identity 弱）
- evidence_quality 收紧后部分 case 只有 1–14 个 gold source → 小 case 饱和
- historical_authority 全 N/A → 该维度本轮完全不可评分

---

## 6. 与 D1 的关系

```text
D1（agent provisional）  → SUPERSEDED（不再参与比较）
D2（adjudicated）        → CREATED
D2 corrected             → CURRENT_FINAL_PILOT_RESULT
```

Gold 版本 hash 随 gold 内容变化（D1→D2 hash 必然不同）；corpus 与 freshness policy 未变（冻结）。
