# Excerpt — 独立 Gold 裁定（Semantic Gold authority）

- **date**: 2026-08-27（D2 Gold Builder 轮）
- **context**: ChatGPT 完成 source-level semantic gold adjudication；用户提供输入文件。
- **why included**: 说明 D2 Gold 的权威来源与机械转换原则；Reviewer 评估 Gold 质量时的依据。

## 摘录

> 前置状态：TRACK_B_PILOT_HARNESS = PASS / ADJUDICATION_PACKET_V2_2 = PASS /
> SOURCE_LEVEL_SEMANTIC_GOLD_ADJUDICATION = COMPLETE
> ChatGPT 已完成独立 Semantic Gold adjudication。
> 输入文件：TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json
> 本轮不是重新 adjudicate。# ChatGPT adjudication 是本轮唯一 Semantic Gold authority。

> 2. RELEVANCE GATE
> Gold unit = case_id × source_id。除 relevance 本身之外：must-see / aspect / expert / long-tail /
> evidence-quality / claim stance / historical-authority 进入 scored Gold 前必须 relevance == true。
> 不得让 irrelevant expert/vendor source 进入 Expert Recall denominator。

> 3. UNRESOLVED
> UNRESOLVED：不计 numerator / 不计 denominator / 单独计 unresolved/dispute stats。不得 UNRESOLVED → false。
> 特别注意：ChatGPT 本轮将全部 real-case historical_authority 设为 UNRESOLVED。
> 因此 D2：historical_authority_retention = NOT_SCORABLE / N/A。不得保留旧 D1 historical-authority Gold。

> 6. CROSS-QUESTION PROVENANCE
> 废弃旧 D1 required provenance groups。使用 required_provenance_final 作为 D2 authority。
> 特别注意：xq4-vendor-tension 已经由 ChatGPT 重建成：
> vendor-self-promotion VS independent-or-countervailing-evaluation，必须按新 group 构建。

## Why

这是"Semantic Gold 从 PROVISIONAL 到 ADJUDICATED"的关键交接；09 文档基于此。
