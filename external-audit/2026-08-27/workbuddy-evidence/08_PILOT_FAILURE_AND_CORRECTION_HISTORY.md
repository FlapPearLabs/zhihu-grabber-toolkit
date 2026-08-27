# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 08 PILOT FAILURE AND CORRECTION HISTORY

> **本文件不压缩失败。** 每一项失败 = how discovered / impact / fix / regression guard。
> 这是评估"这套 benchmark 证据是否可信"的关键材料。
> 证据来源：memory 2026-08-27 各轮记录 + `benchmark/packets/` 各 review packet + ChatGPT CHANGES_REQUESTED。

---

## 失败清单（11 项）

### F1. Evaluation leakage（strategy 读取 evaluation gold）
- **failure**：初版 B2 selector 直接读 `gold.expertise` / `gold.contradiction` / `gold.must_see` 作为 lane 信号。
- **how discovered**：ChatGPT P0-1 CHANGES_REQUESTED（"B2 selector 禁止再读取 gold"）。
- **impact**：B2 结果被"用答案偷看考卷"污染；fair comparison 无效；任何 B2 优势都不可信。
- **fix**：`assignMechanicalLanes`（lane 信号仅来自 mechanical metadata / deterministic heuristic）；gold-lane 隔离为 `B2_ORACLE_LANES`（UPPER_BOUND_DIAGNOSTIC_ONLY）。
- **regression guard**：throwing-gold Proxy 测试（selector 收到 gold 即抛错）；24 oracle runs 标 `excluded_from_fair_comparison=true`；72 fair runs 审计。

### F2. Inverted / wrong metric definitions（指标定义反转与错误）
- **failure**：redundancy 方向反转（初版 HIGH=更不冗余）；per-question coverage 用 raw source count 而非 value units；question diversity Q 用 selected count。
- **how discovered**：ChatGPT 4P0+6P1 与 3P0+3P1 metric correction（2026-08-26）。
- **impact**：指标语义与批准定义不符；结论误导。
- **fix**：redundancy 反转（HIGH=more redundant）；value_units 作为 per-question 分母；Q=#scorable reference questions。
- **regression guard**：REQ 系列单元测试（bounds、|S|<2→N/A、3 ref Q 全选 Q1→diversity 0）。

### F3. Disputed denominator issues（争议 gold 进 denominator）
- **failure**：disputed/unresolved gold 曾被计入 denominator。
- **how discovered**：metric correction P0-3（disputed 从 scored 排除，新增 scorable/unresolved/dispute 统计）。
- **impact**：recall 被不可靠 label 稀释/扭曲。
- **fix**：UNRESOLVED 不计 num 不计 den 单独统计；gold stats 按 family 记录 scorable/unresolved/dispute_rate。
- **regression guard**：测试"disputed excluded from denominator"。

### F4. Cross-question provenance mistakes（跨问题 provenance 错误）
- **failure**：cross_question_claim_recall 曾允许"找到任意 ≥1 篇相关 source 即 covered"；required provenance groups 语义未落实。
- **how discovered**：final metric correction P0-1。
- **impact**：跨问题覆盖被高估。
- **fix**：必须覆盖 required_provenance_groups[] 全部；provenance 显式列 source_id。
- **regression guard**：测试"cross-question claim requires provenance groups"。

### F5. Case-scoped Gold leakage（global source labels 跨 case 传播）
- **failure**：V2.1 按 source_id 合并/OR 多 case label → case A must_see=true 泄漏到 case B。
- **how discovered**：ChatGPT V2.2 CHANGES_REQUESTED P0-1。
- **impact**：语义 label 失去 case 上下文；cross-case 比较失真。
- **fix**：两层结构（sources[] intrinsic + case_labels[] semantic）；135 case_labels 独立。
- **regression guard**：REQ1/2/3（同 source 双 case_label、must_see 值独立、long_tail 无 OR 泄漏）。

### F6. Provenance ≠ stance（provenance membership 自动生成 stance）
- **failure**：required_provenance_groups 中的 source 被自动写 `stance="for"`。
- **how discovered**：ChatGPT V2.2 CHANGES_REQUESTED P0-2。
- **impact**：provenance 成员被误判为立场支持，contradiction 结构污染。
- **fix**：独立 `required_provenance_memberships[]`（group_role 只来自 frozen gold）；claim_stances 只来自 explicit contradiction stances / human adjudication。
- **regression guard**：REQ4/5（provenance-only source 无 stance；explicit stance source 有 stance）。

### F7. Expertise evidence gating（expert evidence 依赖 gold）
- **failure**：只有 provisional expert gold 中的 source 才做 evidence discovery → 非 gold source 的专家证据被漏掉。
- **how discovered**：ChatGPT V2.2 CHANGES_REQUESTED P1。
- **impact**：expert 标签偏见（只验证已知专家）。
- **fix**：对所有 distinct source 跑同一 frozen-corpus discovery；gold 提案单独标 `expert_topic_match_proposed_by_gold`。
- **regression guard**：REQ6（非 gold source 也 discovery SUPPORTED，如 Zoho Creator）。

### F8. Sanitizer excerpt loss（sanitizer 误杀字段）
- **failure**：3 个 source（477427067:2179827948、477427067:3136586716、487214224:2027722356278215762）缺 content_excerpt。
- **how discovered**：ChatGPT V2.1 CHANGES_REQUESTED P0-1（"3 个 source 缺 excerpt"）。
- **root cause**：知乎图文回答 raw HTML 含 `data-original-token="v2-..."` 图片属性 → sanitizer 的 `token` 敏感词正则误杀整字段。
- **impact**：adjudication 无法进行（缺内容）；字段静默缺失违反 artifact invariant。
- **fix**：excerpt 改 sanitized plain text（stripHtml）；显式 `content_excerpt_status`（OK/NO_TEXT_CONTENT/REDACTED_SENSITIVE）+ content_kind + content_metadata。
- **regression guard**：V2.1 invariant 测试（每 source 必有 excerpt 或显式 status）+ 3 个修复源专项断言。

### F9. Irrelevant generic low-code Gold contamination（irrelevant 语料污染 gold）
- **failure**：487214224（"石勒为民除道" 道家内容）混入低代码选型 case；初版 gold 未隔离 off-topic 噪音源。
- **how discovered**：corpus 内容扫描（2026-08-27 pilot 准备阶段）。
- **impact**：relevance label 被污染；fresh 指标把 off-topic fresh 内容当"新鲜相关"候选。
- **fix**：relevance gate（非 relevance 标签一律不进 scored denominator）；fresh_content_recall 只计 fresh **and relevant**（PROVISIONAL）；fresh-but-off-topic 永不 FINAL。
- **regression guard**：测试"fresh off-topic source 不 FINAL fresh relevant"；D2 验证 relevant=1（487214224）。

### F10. First D2 aspect namespace bug（ASPECT_NAMESPACE_RECONCILIATION_BUG）
- **failure**：build-d2-gold 首版用旧 D1 aspect_id（裸名）查 case_schema_decisions，而 Final adjudication 已 namespaced（`case-477427067:asp-vendor`、`case-466695857:asp-critique`、`case-cross-lowcode:asp-criteria`/`asp-concept`）→ 3 case 的 KEEP aspect 被误 drop（477427067 4→3、466695857 3→2、cross 6→4）；cross aspect_recall 0.750=3/4 违反 1/6 倍数。
- **how discovered**：ChatGPT D2 formal review（CHANGES_REQUESTED P0）。
- **impact**：OLD_D2 aspect 相关指标全部无效（0.750 无法由 6-aspect denominator 产生）。
- **fix**：D2 aspect schema authority 直接来自 adjudication（KEEP keys 原样 + case_label_decisions.aspect_ids 聚合 + relevance gate + v2.2 packet 提供 name/definition）。
- **regression guard**：VAL11（exact Final aspect ID set == adjudication KEEP set）、VAL12（membership exact-match）、VAL13（cross=6）、VAL14（critical_aspect==KEEP）；回归证明 aspect_recall 全部 1/6 倍数。
- **状态**：96 个 OLD_D2 runs 已归档为 `results/runs-d2-invalid/`，显式标 `INVALIDATED_BY = ASPECT_NAMESPACE_RECONCILIATION_BUG`。

### F11. Historical authority over-claiming（historical authority 无证据却保留）
- **failure**：D1 gold 的 historical_authority 有 label 但无可靠证据（canonical schema 无作者历史信息）；初版保留并计分。
- **how discovered**：ChatGPT adjudication 将全部 real-case historical_authority 设为 UNRESOLVED。
- **impact**：historical_authority_retention 曾产生无依据数字。
- **fix**：D2 中全部 UNRESOLVED → NOT_SCORABLE / N/A；unresolved_sources 只记 relevance=true 的 case sources（评审修正）。
- **regression guard**：VAL4（all real historical_authority = UNRESOLVED/excluded）；测试 N/A 路径。

---

## 跨失败观察（中立）

1. **多数失败由独立评审发现，而非自查**（F1/F3/F4/F5/F6/F7/F10/F11）——这佐证了"独立 gate"流程的价值，也说明 agent 自证不可靠。
2. **修复模式一致**：隔离（strategy/gold 分离、oracle 隔离）、显式化（status 字段、memberships）、权威上移（adjudication）。
3. **每项修复都伴随回归测试**，且测试在下一轮评审中继续被审查。
4. **F10 是最严重的残留 bug**（污染了 D2 首轮结果），已被显式 INVALIDATED；Reviewer 应确认修正后的 D2 是干净的。
