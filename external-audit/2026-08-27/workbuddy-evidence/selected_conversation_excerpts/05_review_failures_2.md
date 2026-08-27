# Excerpt — 后续评审失败（sanitizer 误杀 / provenance≠stance / aspect namespace bug）

- **date**: 2026-08-27（V2.1 → V2.2 → D2 correction 轮）
- **context**: 三次独立评审各自发现不同缺陷。
- **why included**: 展示失败类型的多样性——从数据管道（sanitizer）到数据模型（stance）再到转换逻辑（namespace）；Reviewer 需评估这些是否已彻底闭合。

## 摘录 1（V2.1 — sanitizer 误杀）

> P0-1 — COMPLETE EVERY SOURCE ENTRY
> 实际 adjudication-packet-v2 中有 3 个 source 缺 content_excerpt：
> 477427067:2179827948 / 477427067:3136586716 / 487214224:2027722356278215762
> 修成硬 invariant：每个 real source 必须满足：
> A. content_excerpt non-empty；OR B. content_excerpt_status = NO_TEXT_CONTENT

> P0-2 — EXPERTISE EVIDENCE MUST BE REAL EVIDENCE
> 当前 "practitioner_or_independent" / "vendor_or_official_account" 只是 class，不是 evidence。
> 如果只有 author name / 无法确认：expert_topic_match_status = UNRESOLVED。
> 不能把 NO EVIDENCE 直接当成 expert_topic_match = false。

## 摘录 2（V2.2 — provenance ≠ stance / case-scoped）

> P0-1 — SEMANTIC LABELS MUST BE CASE-SCOPED
> 当前错误：V2.1 将多个 case 的 relevance/must_see/... 按 source_id 合并/OR，然后 sourcesById 去重成一个 global label object。
> 同一个 source 可以有多个 case_labels。不得把 case A must_see=true 自动传播成 case B must_see=true。

> P0-2 — PROVENANCE MEMBERSHIP != CLAIM STANCE
> 当前错误：required_provenance_groups 中的 source 被自动写成 stance = "for"。删除该推导。
> claim_stances[] 只能来自：1. contradiction claim explicit stance source lists；2. human adjudication。

## 摘录 3（D2 correction — namespace bug）

> P0 — FIX ASPECT ID RECONCILIATION
> 当前 build-d2-gold.mjs 错误地：oldGold.aspect_id → 直接查 case_schema_decisions[case].aspects[old_id]
> 但 Final adjudication 中部分 aspect 已 namespaced：case-477427067:asp-vendor / case-466695857:asp-critique /
> case-cross-lowcode:asp-criteria / case-cross-lowcode:asp-concept
> 不得以 old D1 aspect objects 作为 D2 aspect schema authority。
> cross-lowcode 有 6 个 scorable aspects。因此普通 binary aspect_recall 必须为 1/6 的整数倍。
> 当前旧 D2 的 0.750 证明 denominator 错误。

## Why

F8（sanitizer）、F5/F6（case-scope/stance）、F10（namespace）的原始评审文本。
尤其 F10 是污染了 OLD_D2 结果的 bug——Reviewer 应确认 corrected D2 是干净的（16/16 validation + 回归证明）。
