收到。Level 1 Project Sources 已提供实际路径。先完整读取 6 个文档，再做 Authority Reconciliation。
6 份 Level 1 Project Sources 已完整读取（00 权威索引 / 01 产品方向 / 02 RCE 冻结设计 / 03 Temporal 冻结设计 / 04 算法证据与决策 / 07 安全与跨源综合 addendum）。更新任务与日志，然后输出 Reconciliation + 完整 Packet。
Level 1 sources 完整读取完毕，Reconciliation 完成（无 unresolved conflict）。输出最终交付物。

---

# TRACK_B_BENCHMARK_DESIGN_REVIEW_PACKET_FOR_CHATGPT

> 角色：ZHIHU CLI PRO — TRACK B RESEARCH COVERAGE BENCHMARK DESIGNER
> 本轮目标：① Level 1 Authority Reconciliation；② 输出完整 Benchmark Design Packet
> 模式：BENCHMARK DESIGN ONLY（未实现 harness / 未抓语料 / 未写 RCE / 未写 Spec / 未改 canonical schema）
> REVIEWED_BASE：remote master `84534f5` + Level 1 Project Sources（00/01/02/03/04/07，完整读取）

---

## 0. Level 1 Authority Reconciliation

**已完整读取**：`00_SOURCE_AUTHORITY_AND_STATUS` / `01_PRODUCT_DIRECTION_FINAL` / `02_RESEARCH_COVERAGE_ENGINE_FINAL` / `03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL` / `04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL` / `07_RESEARCH_SECURITY_AND_CROSS_SOURCE_SYNTHESIS_GUARDRAILS`（全部 6 份，来自用户提供路径）。
**未提供**：05 / 08（Evidence Only，本轮不需要）；06（History，non-authoritative）。

### RECONCILIATION TABLE

| DESIGN_ITEM | DRAFT_VALUE（上轮） | LEVEL_1_REQUIREMENT | STATUS | CORRECTION |
|---|---|---|---|---|
| Benchmark objective | "给定 NL 问题 + 有限 budget，哪个 retrieval + subset-selection strategy 构造 relevant/broad/diverse/low-redundancy/expert-aware/evidence-rich/fresh-aware/long-tail-aware/contradiction-aware 的可信研究 Corpus" | 02 §1：SUBSET SELECTION UNDER CONSTRAINTS，非 ranking；01 §9 三分 coverage 语言 | **MATCH** | 无（补充：显式标注 objective 的 §9 语言约束） |
| V1 baseline（TARGET） | Query/Aspect Expansion + multi-query + RRF + embedding/cosine + deterministic metadata + MMR + multi-lane + simple clustering + simple saturation | 02 §3/§21：与 Draft 逐项一致（七机制）；01 §12/§7.2 Semantic Compilation | **MATCH** | 无 |
| Baselines | B0 Popularity Top-K / B1 Semantic Top-K / B2 MMR / TARGET | 02 §20：B0 Popularity Top-K / B1 Semantic Top-K / **B2 = MMR + lanes** | **NEEDS_CORRECTION** | B2 改为 "MMR + Multi-lane"（对齐 02 措辞；Draft 的 MMR 隐含 lanes，明确写出） |
| Metric set | 12 指标（Must-See/Aspect/Expert/Long-tail/Fresh/Evidence-rich/Contradiction Recall + Redundancy + Analysis Coverage + Cost + Run-to-run + Jaccard） | 02 §20 / 04 §7：完全一致 | **MATCH** | 无（增补 07 §13 五指标 + False-Stop，见下） |
| Cross-question diagnostics | Question Concentration / Author Concentration / Independent Source Diversity | 07 §13：Question Diversity / Source Concentration / Cross-question Claim Recall / Minority-question Recall / Per-question Coverage Preservation | **NEEDS_CORRECTION** | 增补 5 项（Cross-question Claim Recall / Minority-question Recall / Per-question Coverage Preservation 为新增；Draft 的 Question/Author Concentration 并入 Source Concentration） |
| False-stop | 有（Tier 3 false_stop_rate） | 02 §19 Risk E / §17：saturation 阈值必须 benchmark；防 false-stop | **MATCH** | 无 |
| Expertise | Topic-conditioned，credential/employment/education/historical 六特征 | 02 §11 / 04 A04：Topic-conditioned，禁 Global Authority；六特征一致 | **MATCH** | 无 |
| Evidence | Presence（机械）vs Quality（human）分离 | 02 §10 / 04 A05：deterministic features + "引用多 ≠ 正确" | **MATCH** | 无 |
| Freshness | freshness_sensitive / cutoff / fresh vs historical-authoritative | 02 §10：保护"刚发布未积累互动"的内容 | **MATCH** | 补充：明确 freshness 是 **弱 popularity 惩罚豁免**（新内容不得因 vote 少被排挤） |
| Long-tail | low-distribution + unique contribution；禁"低赞=长尾" | 02 §10 / §15 / 07：一致 | **MATCH** | 无 |
| Contradiction | claim_id / stance / opposing_source_ids | 02 §15 / 07 §12：一致（含 claim cluster group provenance） | **MATCH** | 补充：claim cluster 必须保留 support_questions / support_authors / expert_support / evidence_rich_support / opposing_questions |
| Saturation | simple deterministic；阈值后定；FUTURE_CANDIDATE 复杂 stopping | 02 §17 / 04 D08-D09：Chao=诊断 only；Quant=future benchmark | **MATCH** | 无 |
| Hierarchical provenance | 有 evidence lineage（R10） | 07 §9/§12：hierarchical not flat；claim cluster group provenance | **NEEDS_CORRECTION** | 明确 benchmark 的 reference 结构必须保留 question/author/source-group 层级（§I） |
| Security / semantic worker | 有 RULES §5 边界引用 | 07 Part A：UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION；semantic worker TOOL-LESS OR CAPABILITY-ISOLATED；SUSPICIOUS_DIRECTIVE quarantine | **NEEDS_CORRECTION** | benchmark 增加：① gold 构造与标注对 injection 免疫（标注协议）② quarantine 语义作为被测 pipeline 的受约束行为 |
| Advanced algorithm status | 全部 FUTURE_CANDIDATE / BENCHMARK_CANDIDATE / DEFERRED | 04 §3/§4：A01-A08 V1 CORE；D01-D17 分级（xQuAD/DPP=BENCHMARK_CANDIDATE、Submodular=HIGH-PRIORITY FUTURE BENCHMARK、MF/LTR/ActiveLearning/Search-R1/Stop-RAG/TDA=FUTURE/DEFERRED） | **MATCH** | 无（不实现） |
| Implementation authorization | NONE | 00 §4.4：NONE | **MATCH** | 无 |
| Version status | UNASSIGNED | 00 §4.3 / 01 §12：UNASSIGNED；V1 = baseline of design only，非产品版本 | **MATCH** | 无 |
| P0 Unknowns（N1） | Project Sources 无法定位 | 本轮已提供（00-07 完整读取） | **RESOLVED** | N1 关闭；05/08 未提供但仅 Evidence，不阻塞 |
| Author identity | finding（无 author_id/url_token） | P1 指令：定为 PILOT_DATA_GAP，非 blocker | **CORRECTED**（见 §P1） | BENCHMARK_AUTHOR_KEY 分层 + author_identity_confidence |

**结论**：无 unresolved `SOURCE_AUTHORITY_CONFLICT`。修正项均为增量对齐（B2 命名、07 五指标、group provenance、freshness 语义、security 标注协议），未重写 benchmark。

---

## A. Benchmark Objective

RCE 不是 QualityScore / Ranking Engine / "找高赞"系统。Benchmark 回答：

> 给定自然语言研究问题 + 有限 budget（retrieval / token / model calls），哪个 retrieval + subset-selection strategy 能构造 **relevant · broad · diverse · low-redundancy · expert-aware · evidence-rich · fresh-aware · long-tail-aware · contradiction-aware** 的可信研究 Corpus？

本质：**SUBSET SELECTION UNDER CONSTRAINTS**（02 §1）。禁止表述"100% 找到知乎全部相关内容"；只用 01 §9 三分语言：

```text
RETRIEVAL COVERAGE      // 当前 search/query/provider 条件下覆盖了多少研究空间（相对 reference pool 的 recall）
SOURCE COMPLETENESS     // 对可枚举源：captured / currently-accessible enumerable total（机械可验证才声称）
ANALYSIS COVERAGE       // verified corpus 中多少被真正分析（机械可验证 100%）
```

---

## B. Benchmark Tier Architecture

分层理由：retrieval / ranking / selection / stopping 混在一个指标里失败时无法归因。

| Tier | 名称 | 问题 | 输入/输出 | 用途 |
|---|---|---|---|---|
| TIER 0 | Selector sanity | 同 pool 下不同 selector 质量如何？ | 固定 pool → 各 selector 指标表 | 隔离 selection 逻辑（B0/B1/B2/TARGET 同池对比） |
| TIER 1 | Retrieval coverage | query/expansion/provider/fusion 是否增加有价值的 candidate？ | NL 问题 + budget → 各配置的 pool | 隔离 retrieval/expansion/fusion；对比 single vs multi-query、official vs multi-provider vs RRF |
| TIER 2 | End-to-end research corpus | NL 问题 → selected verified corpus 全链路？ | NL 问题 + budget + strategy 配置 → selected_source_ids + 全指标 + cost | 整体验收面；失败用 Tier 0/1 诊断归因 |
| TIER 3 | Adaptive depth / stopping | 继续抓下一批是否有增益？heuristic 是否 false-stop？ | 分批检索/抓取 → 每批 new_*_rate + novelty_gain + false_stop_rate | 测 adaptive depth 与 saturation |

横切约束：**所有 Tier 共享同一 reference pool / gold 标注层**（§D），否则各 Tier 不可比。Tier 0 可用已验证语料 + fixture 构造 pool，成本最低；Tier 3 是唯一需要分批语义的层，用现有抓取 batch 能力即可。

---

## C. Dataset / Case Taxonomy

### C1. 形态分类（ZHIHU_RESEARCH_BENCHMARK_SET）

| 类 | 形态 | 示意（非最终选定） | 关键维度 |
|---|---|---|---|
| A | 技术事实型 | AI / 软件工程 / 芯片 / 数学科学 | aspect 结构清晰；evidence-rich；expert 可判 |
| B | 技术争议型 | 两种技术路线 / 性能争议 / 工程 trade-off | contradiction；双侧 aspect；long-tail 反方 |
| C | 产品/商业分析型 | 选型指标问题 | 多 aspect；evidence；作者专业度 |
| D | 长尾专业型 | 冷门领域具体问题 | long-tail recall；unique contribution |
| E | 新近事件型 | 近期发布/事件 | freshness-sensitive；reference cutoff |
| F | 需要反方证据的问题 | "X 是否真的比 Y 快" | contradiction recall（主流高赞过强时漏反方） |
| G | 多问题聚合型 | 一个 NL 主题对应多个 Zhihu Question | cross-question；question dominance 检测 |
| H | Expert-sensitive | 专业身份/历史专业度有意义的问题 | expert recall；credential-topic match |

### C2. 数量（small-but-high-quality）

```text
PILOT = 6–8 case（A×1, B×1, C×1, D×1, E×1, F×1, G×1, H×1 中选）
FULL  = 24–32 case（每类 3–4）
难度：EASY（aspect 清晰、pool 小、gold 争议低）/ MEDIUM / HARD（跨问题、专家依赖、反方稀缺）
每 case reference pool：50–300 source（跨问题 case 可更大，pilot 不超 300）
```

### C3. Inclusion / Exclusion / Duplicate / Stale

- **Inclusion**：NL 问题可映射 ≥2 个 Question（或 1 大 Question + 明确子方面）；存在可判定 must-see（2+ 来源）；2 标注者初始 agreement ≥ 60%（否则 HARD 或剔除）。
- **Exclusion**：纯主观（"你最喜欢什么"）；问题太新（<5 条回答）；topic 指纹与前 3 个 case 重叠（topics[] id 并集 + 标题 token 相似度）；敏感/隐私/违规内容。
- **Stale handling**：每 case 记录 `reference_cutoff` + `case_created_at`；E 类额外记录 `event_date`；结果带 `dataset_version` + `collection_window`；E 类定期重标（不全量重标）。

---

## D. Gold / Reference Construction Protocol

### D1. 反循环原则（HARD）

```text
GOLD_ANNOTATORS_ARE_BLIND_TO_STRATEGY_OUTPUTS
LLM = ASSISTANT / PROPOSER
HUMAN / DETERMINISTIC ADJUDICATION = AUTHORITY
REFERENCE_POOL_INDEPENDENT_OF_STRATEGIES
```

1. **pool 独立构造**：宽检索 sweep（多 query 变体 + official zhihu_search + global_search + 人工补充已知重要来源）；sweep query 由标注者/第三方生成，不由被测 strategy 生成；
2. **策略新发现回流**：被测策略找到但不在 pool 的来源 → 先加入 pool 由人独立标（标注者不知道来源来自哪个策略），再算 recall；
3. **gold 先于策略运行**（pilot 中先标 case 再跑策略）；若需真实抓取则 gold 标注与策略运行在不同时间/上下文，标注者只见 source_id + 内容，不见策略名。

### D2. Must-See 由谁标

2 名 human annotator 独立标，确定性 adjudication（D7）。LLM 可提出候选（proposer），必须经人确认。**Must-See ≠ top votes**；候选定义（满足任一）：

```text
- 对核心 aspect 有不可替代贡献（该 claim 仅此来源充分阐述）
- 高专业相关度（topic-conditioned expertise）
- 强一手/官方/论文/数据证据（evidence-rich）
- 关键反方观点（contradiction 重要一方）
- 独特事实或机制解释
- 某重要 claim 的代表来源（independent_source_group 代表）
```

### D3. Aspect 定义

- **Reference Aspect Map 不由被测 planner 定义**：标注者先于策略从 NL 问题推导；
- 每 aspect：`aspect_id` / `aspect_label` / `is_critical` / `overlaps_with[]` / `definition_note`；
- 数量上限（防人为抬高 recall）：critical 3–6，optional 2–4，超限需 adjudication；
- overlap 处理：按 source 去重（一 source 覆盖 2 个重叠 aspect 只计 1 次 covered）。

### D4. Expert source 确认

- **Topic-conditioned**（02 §11）：`credential-topic match`，禁 Global Authority（NVIDIA×GPU 有 prior；×oncology 无）；
- 证据来源：credential 文本 / employment / education / 历史 topic 密度与一致性（机械部分可提取，身份部分见 §P1）；
- **不预设 ExpertiseScore 权重**：标注者只标 `expert_topic_match: {topic_id, evidence_basis, confidence}`。

### D5. Evidence-rich 确认

- **Presence**（机械）：URL（external/official/paper/code/formula/chart/data table/experiment/citation marker）——利用 `assets{}`（links 含 domain、codeBlocks、references、images）；
- **Quality**（human/semantic）：证据是否支撑其声称；"引用很多 ≠ 正确"，quality 独立于 presence。

### D6. Long-tail 定义（防"低赞=长尾"）

- `distribution_metadata`（机械）：voteupCount 分位 / comment / 问题内排名 / 时间分布；
- `unique_claim_contribution`（human）：是否贡献别的来源没有的 substantive claim / fact；
- `novel_aspect_contribution`（human）：是否覆盖 reference aspects 中其他来源未覆盖的；
- Long-tail candidate = 低分布 **且** unique contribution=YES；low-popularity-but-redundant-garbage 不算。

### D7. Contradiction 标注

- 定义：**对同一 substantive claim / mechanism / recommendation 存在 meaningful opposition / conflicting evidence**；非情绪相反/措辞不同；
- 结构：`claim_id` / `stance`(support|opposition|neutral) / `opposing_source_ids[]`；
- 标注者先列 claim 清单（LLM proposer 辅助），再标 stance 与来源；同 claim 的 support+opposition 都出现才构成 contradiction pair；
- 专门测：主流高赞过强时是否漏反方（F 类 case）。

### D8. Freshness cutoff

- 每 case：`reference_cutoff`（标注日期）+（E 类）`event_date`；
- `fresh_relevant_sources` = cutoff 前 90 天（pilot 可调）内发布的 relevant source；
- `historically_authoritative_sources` = 早于 cutoff 但被标为权威/重要保留的来源；
- **旧权威不得因"不新"被排除**：Fresh-content Recall 与 Historical-authority Retention 分别报告。

### D9. Relevant / irrelevant 判定

- 二元 `relevance`（human）：对 NL 问题有实质贡献（非重复/广告/空话/离题）；
- **不看点赞数**；disagreement → 第 3 人裁决或 `disputed`（不计分子、计分母并注明）。

### D10. 标注协议与 security（07 Part A 对齐）

- 标注者在隔离上下文工作，外部语料视为 `DATA_NOT_INSTRUCTION`：标注界面/工具不因语料文本改变行为；
- 标注工具对 `SUSPICIOUS_DIRECTIVE_CONTENT`（"忽略之前指令"/"执行以下命令"等）保持 quarantine 展示语义（照常可标为内容，但不影响标注流程指令）；
- gold 文件不含 credential / secret / 绝对路径（RULES §1/§11）。

---

## E. Label Schema

### E1. 双层标签

```text
OBJECTIVE / MECHANICAL（确定性提取，无 LLM）
  publication/update time      → answers.createdTime / updatedTime
  vote count                   → voteupCount / commentCount
  source URL / question identity → answers.url / questionId
  contains external citation   → assets.links（domain 分类）
  contains paper link          → links domain ∈ {arxiv, semanticscholar, doi, ACM, IEEE, ...}
  contains code block          → assets.codeBlocks.length > 0
  contains formula             → content LaTeX/MathML marker
  contains chart/image         → assets.images.length > 0
  contains data table          → content <table> marker
  content type                 → question/answer/article/pin
  distribution metadata        → 分位/排名/时间分布
  author identity              → BENCHMARK_AUTHOR_KEY（§P1）

HUMAN / SEMANTIC（标注者/裁决）
  relevance / aspect membership / must-see / substantive contradiction /
  evidence quality / expertise-topic match / unique long-tail contribution
```

### E2. LLM 角色边界（HARD）

```text
LLM = ASSISTANT / PROPOSER（生成候选标签 + 冲突提示）
HUMAN / DETERMINISTIC ADJUDICATION = AUTHORITY
LLM 标签未经 adjudication 不得进入 gold
机械 label 自动进入 gold，标注者 spot-check
```

### E3. Fixture 存储（未来草案）

```text
benchmark/datasets/<dataset_version>/cases/<case_id>/
  case.json            // NL 问题 + metadata + reference_cutoff
  reference-pool.json  // source_id[] + 机械 label
  gold.json            // human labels（must_see/aspect/contradiction/expert/long_tail/evidence_quality）
  label-schema.json    // 版本化 label 定义
```

---

## F. Metric Definitions（逐指标精确定义）

通用约定：`S` = strategy 选中集；`G_cat` = reference pool 中属某类的 gold 集；Recall = `|S ∩ G_cat| / |G_cat|`。所有 recall 相对 **reference pool**，不宣称绝对全量。

### F1. Must-See Recall
- NAME: `must_see_recall`
- PURPOSE: 系统是否找到"不可错过"的来源（核心指标）
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `|S ∩ G_must_see| / |G_must_see|`；critical-aspect 子集单独报
- REQUIRED_LABELS: `must_see_label` + `must_see_aspect` + `independent_source_group`
- AGGREGATION: case 级 macro-avg
- FAILURE_MODE: 高赞内容淹没低赞 must-see（popularity feedback loop，02 §12）
- INTERPRETATION: 越高越好；与 redundancy 联合看
- DO_NOT_CLAIM: 不宣称"覆盖知乎全部 must-see"；must-see ≠ top votes

### F2. Aspect Recall
- NAME: `aspect_recall`
- PURPOSE: corpus 是否覆盖研究问题的各方面
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `|aspects_covered_by(S)| / |reference_aspects|`（覆盖 = 至少 1 selected source 的 primary aspect；重叠去重）
- REQUIRED_LABELS: reference aspect map + `aspect_membership`(is_primary)
- AGGREGATION: 分 critical/optional 报；macro-avg
- FAILURE_MODE: planner 自己漏 aspect（gold 独立于 planner 定义）；aspect 过细抬高 recall
- INTERPRETATION: critical 是硬指标，optional 是软指标
- DO_NOT_CLAIM: 重叠 aspect 不重复计数；aspect 权重不预先固定

### F3. Expert Recall
- NAME: `expert_recall`
- PURPOSE: 是否漏掉真正有价值的专业来源（topic-conditioned）
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `|S ∩ G_expert| / |G_expert|`（G_expert = expert_topic_match.confidence ∈ {high, medium}）
- REQUIRED_LABELS: `expert_topic_match` + `BENCHMARK_AUTHOR_KEY`（§P1）
- AGGREGATION: 按 topic 分组报（NVIDIA×GPU vs ×oncology 不混）
- FAILURE_MODE: 低赞高专业来源被漏
- INTERPRETATION: 越高越好；不预设 ExpertiseScore 生产权重
- DO_NOT_CLAIM: 不把 global authority 当 expertise；不宣称"最权威来源"

### F4. Long-tail Recall
- NAME: `long_tail_recall`
- PURPOSE: 是否找到低分布但有独特贡献的来源
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `|S ∩ G_long_tail| / |G_long_tail|`（G_long_tail = unique_claim_contribution=true 且低分布）
- REQUIRED_LABELS: `unique_claim_contribution` + `distribution_metadata`
- AGGREGATION: case 级；F 类单独报
- FAILURE_MODE: 只抓高赞 → long-tail recall 低；或 low-vote 垃圾被误标 gold
- INTERPRETATION: 高 = 好，必须与 redundancy 联合
- DO_NOT_CLAIM: **绝不把 low-vote 当 long-tail 定义**；不宣称"找到长尾 = 找到全部小众"

### F5. Fresh-content Recall
- NAME: `fresh_content_recall`
- PURPOSE: freshness-sensitive 问题是否找到 recent relevant content（且不排除旧权威）
- UNIT: 0–1（+ `historical_authority_retention` 0–1）
- FORMULA_OR_PROCEDURE: `|S ∩ G_fresh| / |G_fresh|`；retention = `|S ∩ G_historical_authoritative| / |G_historical_authoritative|`
- REQUIRED_LABELS: `reference_cutoff` + `createdTime` + `historically_authoritative_sources`
- AGGREGATION: 仅 E 类 case
- FAILURE_MODE: 偏好旧权威漏新内容；或过度追新排除旧权威
- INTERPRETATION: 两数同看（fresh 高但 retention 低 = 过度追新）
- DO_NOT_CLAIM: 不宣称"越新越好"；**freshness 是弱 popularity 惩罚豁免**（新内容不得因 vote 少被排挤，02 §10）

### F6. Evidence-rich Recall
- NAME: `evidence_rich_recall`
- PURPOSE: 是否优先找到证据丰富来源
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `|S ∩ G_evidence_rich| / |G_evidence_rich|`（presence ≥ 1 类 marker 且 quality ∈ {high, medium}）
- REQUIRED_LABELS: 机械 `evidence_presence` + human `evidence_quality`
- AGGREGATION: 按 evidence 类型分（paper/code/data/formula）
- FAILURE_MODE: 引用多但无关被计入
- INTERPRETATION: presence 是机械底线，quality 是质量门
- DO_NOT_CLAIM: **"引用很多 = 正确"禁止推论**；presence ≠ quality

### F7. Contradiction Recall
- NAME: `contradiction_recall`
- PURPOSE: 是否同时保留 opposing evidence（防单一叙事）
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `|contradiction_pairs_with_both_sides_selected| / |G_pairs|`
- REQUIRED_LABELS: `claim_id` + `stance` + `opposing_source_ids[]`
- AGGREGATION: B/F 类必报；full set 汇总
- FAILURE_MODE: 主流高赞过强 → 反方被排挤
- INTERPRETATION: 高 = 保留冲突证据；不要求每 claim 双侧（non-contradictory 不计）
- DO_NOT_CLAIM: 不把"观点不同"当 contradiction；不宣称"应包含错误观点"

### F8. Redundancy
- NAME: `redundancy`
- PURPOSE: 防"100 条来自同一 Question / 作者"当 100 个独立证据
- UNIT: 0–1（1 = 完全独立）
- FORMULA_OR_PROCEDURE: `1 - mean_pairwise_similarity(S, S)`（embedding；fixture 层）；辅以 `claim_redundancy = 1 - |claim_clusters_covered|/|S|`
- REQUIRED_LABELS: 机械（questionId/authorId/URL）+ semantic similarity（模型 proposer）+ human `independent_source_group`
- AGGREGATION: case 级
- FAILURE_MODE: 多抓同源不降分
- INTERPRETATION: 与 recall 联合；redundancy 高不能靠 recall 掩盖
- DO_NOT_CLAIM: 不把"文本不重复"当"证据独立"（same-claim redundancy 由 claim 层检测）

### F9. Analysis Coverage
- NAME: `analysis_coverage`
- PURPOSE: 区分"抓到了"与"分析了"
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `analyzed_verified_selected / verified_selected`（source_id 集合）
- REQUIRED_LABELS: 机械（selected/verified/analyzed_source_ids）
- AGGREGATION: case 级
- FAILURE_MODE: 全量 digest 中断 → <1
- INTERPRETATION: 不衡量 retrieval；只衡量分析完成度
- DO_NOT_CLAIM: **100% analysis coverage ≠ 100% retrieval coverage**（明确禁止等价）

### F10. Cost
- NAME: `cost`
- UNIT: counts / tokens / ms / 缓存命中率
- FORMULA_OR_PROCEDURE: 逐字段：`provider_requests` / `retrieved_documents` / `selected_documents` / `selected_tokens` / `embedding_calls` / `semantic_model_calls` / `model_input_tokens` / `model_output_tokens` / `wall_clock_ms` / `persisted_cache_hits`
- REQUIRED_LABELS: 无（harness 记录）
- AGGREGATION: case 级 + strategy 汇总
- FAILURE_MODE: 无限抓 → cost 爆炸但 recall 高
- INTERPRETATION: **recall 与 cost 必须成对报告**（Pareto）
- DO_NOT_CLAIM: 不单凭 cost 或单凭 recall 判胜

### F11. Run-to-run Stability
- NAME: `run_to_run_stability`
- PURPOSE: 同输入同配置多次运行输出是否一致
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: 3 次运行，`min(Jaccard(run1,run2), Jaccard(run1,run3))`
- REQUIRED_LABELS: 无（重复运行）
- AGGREGATION: case 级
- FAILURE_MODE: 非确定性（种子/采样/网络）导致漂移
- INTERPRETATION: 高 = 可复现；**稳定 ≠ 正确**
- DO_NOT_CLAIM: 不把 stability 当 quality；不奖励"稳定地漏"

### F12. Jaccard Stability
- NAME: `jaccard_stability`
- PURPOSE: selection 集合重叠度（跨 run / 跨 strategy）
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `Jaccard(S1,S2) = |S1∩S2|/|S1∪S2|`
- REQUIRED_LABELS: 无
- AGGREGATION: run-pair 平均
- FAILURE_MODE: 阈值误判（不设固定阈值，benchmark 后定）
- INTERPRETATION: 配合 stability 解释
- DO_NOT_CLAIM: 不单独作 acceptance gate

### F13. Question Diversity
- NAME: `question_diversity`（07 §13）
- PURPOSE: 防 selector 只围绕最大 Question 优化
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `1 - Σ_q (n_q/n)²`（Herfindahl 补；n_q = 选中集内 question q 的 source 数）
- REQUIRED_LABELS: 机械 questionId
- AGGREGATION: case 级（G 类必报）
- FAILURE_MODE: 1000 答大 Question 压死小 Question
- INTERPRETATION: 高 = 跨问题分散；须与 recall 联合（不能靠牺牲 recall 换分散）
- DO_NOT_CLAIM: 不把"分散"当"覆盖好"（no naive equal weight，07 §10）

### F14. Source Concentration
- NAME: `source_concentration`（07 §11/§13）
- PURPOSE: 检测单 Question / 单 Author / 单 Content Type / 单 Claim 源群体支配
- UNIT: 0–1 各维度 + 计数
- FORMULA_OR_PROCEDURE: 记录并报告：`selected_question_count` / `selected_content_by_question` / `largest_question_share` / `selected_author_concentration`（Herfindahl over authors）/ `selected_content_type_distribution` / `claim_source_diversity`（claims 的来源 Question 数）
- REQUIRED_LABELS: 机械 questionId/authorId/contentType + `claim_id`
- AGGREGATION: case 级诊断（不单独作 pass/fail）
- FAILURE_MODE: 单一来源群体支配 claim
- INTERPRETATION: 诊断面；阈值 benchmark 后定（07 §11）
- DO_NOT_CLAIM: 不把集中度当直接质量分

### F15. Minority-question Recall
- NAME: `minority_question_recall`（07 §13）
- PURPOSE: 小 Question（30/50 答）的 gold 是否被大 Question 压死
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: 按 question 分组的 recall 中，对非最大 question 组的 macro-avg；另报 `largest_question_recall` 对比
- REQUIRED_LABELS: `must_see_label`/`aspect_membership` 按 question 分组
- AGGREGATION: G 类 case 必报
- FAILURE_MODE: 大 Q recall 高而小 Q recall 低 → dominance
- INTERPRETATION: 差距大 = 需 lane/配额修正
- DO_NOT_CLAIM: 不要求小 Q 与大 Q 等权（07 §10）；只要求小 Q 的独有价值不被吞

### F16. Per-question Coverage Preservation
- NAME: `per_question_coverage_preservation`（07 §13）
- PURPOSE: 每个被纳入研究的问题保持其内部覆盖（不因全局选择牺牲单题完整性）
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: 对每个 selected question：`|S ∩ G_q| / |G_q|`；报告 min/mean 及最低值 question_id
- REQUIRED_LABELS: gold 按 question 分组
- AGGREGATION: case 级 min + mean
- FAILURE_MODE: 某问题内部 gold 几乎全漏
- INTERPRETATION: 保底语义；min 低 = 该问题被整体跳过
- DO_NOT_CLAIM: 不宣称"每题全量"；只测选择后的保留

### F17. Independent Source Diversity
- NAME: `independent_source_diversity`
- PURPOSE: 是否覆盖多个独立来源群体（非同一 question/作者/claim 重复）
- UNIT: 0–1
- FORMULA_OR_PROCEDURE: `|independent_source_groups_covered| / |independent_source_groups_in_pool|`（group 由 `independent_source_group` 标签定义，adjudication 确认）
- REQUIRED_LABELS: human `independent_source_group`
- AGGREGATION: case 级
- FAILURE_MODE: 同源大量重复被当多样
- INTERPRETATION: 高 = 证据结构多样（07 §12：100 答 1 题 ≠ 20 源 8 题）
- DO_NOT_CLAIM: 不把 source 数当 diversity

### F18. False Stop Rate
- NAME: `false_stop_rate`
- PURPOSE: heuristic 判定 saturation 后是否仍出现重要来源（Tier 3 专属）
- UNIT: 0–1（case 比例）+ 漏类型分布
- FORMULA_OR_PROCEDURE: `#cases where heuristic stopped but later batch had gold must-see/expert/contradiction/critical-aspect/evidence-rich / #false-stop-test-cases`；每 false-stop 记录漏掉类型
- REQUIRED_LABELS: gold（must_see/expert/contradiction/aspect/evidence）+ 分批选择记录
- AGGREGATION: Tier 3 专属
- FAILURE_MODE: saturation 过早（02 §19 Risk E）
- INTERPRETATION: 低 = 好；须与 cost 联合（永远不停 = 平凡解）
- DO_NOT_CLAIM: 不把"平均少抓多少"当 false-stop 度量；不只报数量不报类型

**Metric 治理**：以上 18 项不自动全部进 production acceptance；pilot 后按区分度/标注成本/解释力筛选。

---

## G. Baselines and Candidate Strategies

```text
BASELINE 0 — Popularity Top-K
  选择：voteupCount DESC（可含 comment_count 弱 social validation）→ Top K
  定位：下限；禁止把 popularity 当 truth/quality（02 §10）

BASELINE 1 — Semantic Top-K
  选择：query/content embedding similarity → Top K
  定位：无 redundancy 处理的 semantic baseline

BASELINE 2 — MMR + Multi-lane Exploration Constraints（对齐 02 §20 措辞）
  选择：relevance + λ·redundancy penalty（MMR 贪心）+ 多 lane 约束
  lane：Mainstream / Expert / Evidence-rich / Fresh / Long-tail / Contradictory（02 §12）
  λ 与 lane 配额是配置参数（benchmark 后定，不写死）

TARGET — V1 Simple Baseline（02 §3/§21 冻结；本轮不实现，contract 预留）
  LLM Query/Aspect Expansion
  + Multi-source / Multi-query Retrieval
  + RRF fusion
  + Embedding + Cosine Geometry
  + Deterministic Metadata Features（expertise/evidence/freshness/weak popularity）
  + MMR + Multi-lane Exploration Constraints
  + Simple Claim/Aspect Clustering
  + Simple Saturation Heuristics
  + → Verified Research Corpus → v0.3 Research Kernel
```

**Future candidates（仅记录，不实现）**：xQuAD / DPP / Submodular（04：BENCHMARK_CANDIDATE / HIGH-PRIORITY FUTURE BENCHMARK）；trained LTR / MF / Active Learning / Search-R1 / Stop-RAG / TDA / Quant / Chao-as-authority（FUTURE / DEFERRED / METHOD_REFERENCE_ONLY）。

### G2. Strategy contract（provider-neutral hook）

```text
STRATEGY_ID     = 确定性字符串
STRATEGY_CONFIG = 版本化 JSON（K / λ / expansion 词表 / provider 列表 / budget / lane 配置）
PROVIDER_SET    = ["official-http", "session-web", "browser-session", ...]（内部可替换）
BUDGET          = { max_selected_sources, max_selected_tokens, max_provider_requests, ... }
输入：research_question + reference_cutoff
输出：selected_source_ids[] + provenance（每 id 的 provider/query/stage）
```

Provider 对比矩阵（未来可测，不要求现在实现）：Official only vs +Session/Web vs +Browser Session；single vs multi-query；official rank vs RRF fusion。

---

## H. Adaptive Retrieval / False-Stop Evaluation

### H1. 分批测量（Tier 3）

```text
batch 1 → 2 → 3 → ...（每批 = 一轮追加 retrieval/抓取）
每批记录：
  new_aspect_rate        = 新增覆盖 aspect / 参考 aspects
  new_claim_cluster_rate = 新增 claim 簇 / 参考 claim 簇
  new_expert_rate        = 新增 expert source / gold_expert
  new_contradiction_rate = 新增 contradiction pair / gold pairs
  new_evidence_type_rate = 新增 evidence 类型覆盖
  novelty_gain           = 综合新增价值（权重 benchmark 后定）
  → SATURATION_CANDIDATE 标记（02 §17：连续若干批几乎无新 aspect/claim/expert/contradiction 且 novelty 低）
```

### H2. False-Stop 专项

- 预先构造 FALSE STOP CASES：gold 已知后段 batch 包含 must-see/expert/contradiction/critical-aspect/evidence-rich；
- `false_stop_rate`（§F18）+ 漏掉类型分布；
- 约束：V1 只允许 simple deterministic saturation（不实现 Chao/Quant/RL stopping）；判定必须用 gold（非 heuristic 自证）；cost 同时记录（防"永远不停"平凡解）。

---

## I. Cross-Question Evaluation

### I1. Reference 结构（HARD，对齐 07 §9）

```text
source_id / question_id / author_id(§P1) / claim_id / aspect_id /
support|opposition / evidence_markers / source_group
禁止 all-answers-flat-gold（07 §8）
层级：Answer/Content → Question/Source-group → Claim/Aspect → Cross-source synthesis
```

### I2. G 类专门检测（对齐 07 §10–§13）

- pilot 至少 1 case：NL 问题 → ≥3 Question（如 1000 答 + 30 答 + 50 答）；
- 检测：大 Question 是否压死小 Question（`minority_question_recall` / `per_question_coverage_preservation` / `question_diversity` / `source_concentration`）；
- **No naive equal weight**：讨论量（DISCUSSION_VOLUME）与证据/覆盖价值（EVIDENCE/COVERAGE VALUE）作为两个独立信号保留（07 §10）；
- **Claim cluster group provenance**（07 §12）：cluster 至少记录 support_sources / support_questions / support_authors / expert_support / evidence_rich_support / opposing_sources / opposing_questions。

---

## J. Cost + Stability Evaluation

- **Cost**：§F10 全部字段；每次 strategy 运行附带；cache hits 单独记录；Pareto 视角（(recall 向量, cost) 点，不做单指标排名）。
- **Stability**：每 strategy/case ≥3 次重复（pilot 可 2 次）；**必须同时报告 stability + coverage quality**；记录非确定性来源（seed / temperature / 网络时序），不消除只归因。
- 防"稳定地漏"：stability 高但 expert/long-tail/contradiction recall 低 → 报告为质量缺陷而非稳定性优点。

---

## K. Machine-Readable Benchmark Result Contract

（概念设计；不实现。字段：）

```json
{
  "benchmark_run": "br-<hash>",
  "benchmark_version": "0.1.0-draft",
  "dataset_version": "dset-2026-08-26-v0",
  "case_id": "G-001",
  "strategy_id": "target-v1-simple-baseline",
  "strategy_config": {},
  "candidate_pool_id": "pool-G-001-v0",
  "budget": {},
  "selected_source_ids": [],
  "provenance": { "<source_id>": { "provider": "official-http", "query": "q2", "stage": "retrieval" } },
  "metric_results": { "must_see_recall": 0.8, "...": "..." },
  "cost": { "provider_requests": 25, "...": "..." },
  "coverage_breakdown": {
    "retrieval_coverage": {},
    "analysis_coverage": { "selected": 80, "verified_selected": 80, "analyzed_selected": 0 }
  },
  "stability": { "run_to_run": 0.9, "jaccard": 0.85 },
  "false_stop": null,
  "warnings": [],
  "metadata": {
    "model_runtime_identity": null,
    "provider_snapshot": "2026-08-26T22:00+08:00",
    "random_seed": 42,
    "benchmark_version_note": ""
  }
}
```

**Contract 硬要求**：deterministic IDs；provenance 逐 source；benchmark + dataset 双版本；strategy 配置快照；seed；model/runtime identity（无则 null）；provider snapshot/time；**无 credential / 无 raw secret / 无绝对私有路径**（RULES §1/§11）。

---

## L. Pilot Plan

### L1. 规模（6–8 case）

| # | 类 | 测试点 |
|---|---|---|
| P1 | A | Tier 0 selector sanity |
| P2 | B | contradiction recall |
| P3 | C | aspect + evidence（可用 477427067 类题） |
| P4 | D | long-tail recall |
| P5 | E | freshness |
| P6 | F | 漏反方检测 |
| P7 | G | cross-question（3 Question） |
| P8 | H | expert recall（fixture 层 author 标注） |

（人力受限时 P1–P6 为最小集；P7/P8 是 cross-question 与 expert 关键，建议保留。）

### L2. 标注复杂度

- 机械 label：自动提取 + spot-check（~0.5h/case）；
- semantic label（2 标注者 + adjudicator）：~2–4h/case；
- pilot 总人力 ≈ 8 × 3h ≈ **24–32 标注小时**。

### L3. Candidate pool 原则

- 单问题 case 30–100 source；跨问题 100–300；pilot 单 case ≤300；
- pool 由 sweep + 人工补充构造，独立于被测策略。

### L4. Baselines

- 每 case：B0 + B1 + B2（+ 可选 TARGET 原型，若无实现则输出 NOT_RUN 占位）；
- pilot 首要验证 benchmark 可用性，不是选 winner。

### L5. 输出

- 每 case 一份 machine contract（§K）+ 汇总表（strategy × case × metric）。

### L6. "Benchmark 设计失败"信号（发现即停）

```text
- 标注者 agreement < 60%
- 所有 strategy 无区分度（指标不敏感）
- 被测策略找到的 must-see 不在 reference pool（gold 不完整）
- 机械 label 与 human label 系统性矛盾（如高赞全标 must-see → popularity bias 泄漏进 gold）
- cost 记录无法解释 strategy 差异
- 同一 case 重标漂移 > 阈值
```

---

## M. Benchmark Quality Risks

| 风险 | 最小 mitigation |
|---|---|
| Label leakage | 盲标协议（§D1）；pool 与策略输出隔离 |
| Popularity bias | must-see 定义排除 vote；标注不看赞数 |
| Model self-evaluation bias | LLM=proposer，人=authority |
| Temporal leakage | reference_cutoff + case_created_at 双记录 |
| Duplicated questions | topic 指纹去重 |
| Duplicated authors | BENCHMARK_AUTHOR_KEY + author_identity_confidence；独立来源 group |
| Provider bias | provider-neutral contract + provenance |
| Annotation disagreement | 2 人 + 第 3 人裁决；disputed 不计分子计分母 |
| Gold-set incompleteness | 人工补充 + 策略新发现回流 + 失败信号检测（L6） |
| Aspect taxonomy overfitting | 数量上限 + critical/optional 分级 |
| Benchmark gaming | 指标向量 + cost Pareto；不设单一可优化标量 |
| Stale benchmark | E 类定期重标；版本化 dataset |
| High-cost gold construction | pilot 6–8 case 先行；机械 label 自动；LLM 辅助候选 |
| Prompt injection 影响标注 | 标注工具隔离 + quarantine 语义（§D10） |

---

## N. P0 Unknowns（只保留真阻塞项）

| # | UNKNOWN | 状态 | 影响/动作 |
|---|---|---|---|
| N1 | ~~Project Sources 无法定位~~ | **RESOLVED**（本轮完整读取 00/01/02/03/04/07） | 关闭；05/08 未提供但仅 Evidence，不阻塞 |
| N2 | author identity（§P1） | **PILOT_DATA_GAP（非 blocker）** | BENCHMARK_AUTHOR_KEY + confidence；严格指标（Author Concentration / Expert identity attribution）在 MEDIUM 以下不启用，除非人工 adjudication |
| N3 | 官方 zhihu_search `Count` vs `limit` 兼容未 smoke | OPEN（Track A G1 遗留） | Tier 1 校准前 1 次真实 smoke（credential 不进报告） |
| N4 | global_search `HasMore` 分页语义 | OPEN（Track A G2 遗留） | 官方文档/smoke 确认 |
| N5 | freshness 窗口（90 天）合理性 | OPEN | pilot 校准；benchmark 后定 |
| N6 | Tier 3 分批语义的 fixture | OPEN | pilot 用已验证语料时间切分模拟，验证指标后再定真实分批 |

**不阻塞**：provider 实现（contract provider-neutral）；复杂算法（FUTURE_CANDIDATE）；OAuth（无第三方场景）；Poll（不进入 scope）。

---

## O. Evidence Gate Status

```text
LEVEL_1_SOURCES_READ        = YES（00/01/02/03/04/07 完整读取）
AUTHORITY_RECONCILIATION    = COMPLETE（无 unresolved SOURCE_AUTHORITY_CONFLICT；4 项 NEEDS_CORRECTION 已修正）
FULL_PACKET_OUTPUT          = YES（本文件 A–P）
TRACK_B_DESIGN              = COMPLETE
TRACK_B_PILOT_EXECUTION     = NOT_STARTED
SPEC_PREPARATION_GATE       = NOT_READY
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT          = UNASSIGNED
```

（TRACK_B_DESIGN = COMPLETE 的充分条件已满足：① L1 sources 完整读取；② reconciliation 无 unresolved conflict；③ 完整 packet 输出。Pilot 未执行，故 SPEC_PREPARATION_GATE 保持 NOT_READY；Pilot/evidence 经 ChatGPT 审查前不得写 Spec。）

---

## P. Proposed Next Step（仅建议，不执行）

1. ChatGPT 审查本 packet（reconciliation + 完整设计）；
2. 审查通过后：解决 N3/N4（官方 API 参数 smoke）+ N5（freshness 窗口校准）+ N2 落地（BENCHMARK_AUTHOR_KEY 标注协议）；
3. 运行 6–8 case pilot（Tier 0 离线演练 → 标注 → baseline 对比 → machine contract），按 §L6 检查可用性；
4. pilot 结论审查 → 才讨论 Track A+B 合流 → EVIDENCE GATE REVIEW → Architecture/Spec Preparation。

**本轮不执行**：不实现 harness、不抓大规模语料、不写 RCE、不写 Spec、不创建版本/Issue/PR、不自动 Reviewer。

---

## §P1. Author Identity Classification（P1 修正）

```text
BENCHMARK_AUTHOR_KEY =
  stable provider author id
  OR url_token
  OR canonical user id
  OR benchmark fixture-local stable identity

author_identity_confidence =
  STRONG   // provider id / url_token / canonical user id（稳定、可跨 source 合并）
  MEDIUM   // fixture-local 标注确认的身份（pilot 内有效）
  WEAK     // 仅 author name string + 人工 adjudication 辅助
  UNKNOWN  // 无法确认

AUTHOR_IDENTITY_GAP = PILOT_DATA_GAP（非 blocker）
```

**约束**：当前 canonical corpus 只有 author name（无 author_id/url_token）→ 仅 name 时不得用于严格的 Author Concentration / unique-author counts / Expert Recall identity attribution，除非人工 adjudication 确认身份（pilot 以 fixture 层手工标注身份，标记 confidence）。**不改 production canonical schema、不新增 Provider、不为 benchmark 施工 Author system。**

---

```text
REVIEWED_BASE         = 84534f5（remote master）+ Level 1 Project Sources（00/01/02/03/04/07，完整读取）
TRACK_B_DESIGN        = COMPLETE
TRACK_B_PILOT_EXECUTION = NOT_STARTED
SPEC_PREPARATION_GATE = NOT_READY
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT    = UNASSIGNED
THIS_ROUND_EDITS      = NONE（production read-only；仅 .workbuddy/memory/ 日志）
```

等待 ChatGPT 正式审查。在收到进一步指令前 **STOP**。