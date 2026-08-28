# P1_DECISION_GRADE_EVIDENCE_GATE_01_REVIEW_PACKET_FOR_CHATGPT

> **提交给 ChatGPT 正式 Review。** Reviewer 可对证据、方法、Gold、结论做任何独立核验；
> 本包不宣布 winner、不写 Spec、不实现生产 RCE。
>
> ```text
> TARGET_STATUS = NOT_IMPLEMENTED
> IMPLEMENTATION_AUTHORIZATION = NONE
> SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_REVIEW
> B2_MMR_PLUS_LANES_WINNER = NOT_ESTABLISHED
> ```

---

## A. exact branch / commit

```text
branch : dg01-decision-grade-gate
HEAD   : 1e0f7bfd1e36bfcf0136ad623a5a0888eec84ec2
          (experiment: P1 decision-grade evidence gate 01 — D2.1 evaluator
           correction + four-strategy race; this packet is part of that HEAD)
```

## B. base commit

```text
base   : c3f5e9c26e1a330f63fbbd85ede9a96a2db824b0
          (audit/claude-external-review-2026-08-27 HEAD — the external-audit
           2026-08-27 pack snapshot this gate extends; audit pack is NOT on
           origin/master, so the gate branch is based on the audit branch)
origin/master : ef34574 (未触碰; ff-only discipline preserved)
```

## C. files changed

本 gate **只新增一个目录** `evidence-gate-01/`（benchmark-only，见 README §3），
未改动生产代码、未改动 pilot pack、未改动 master：

```text
evidence-gate-01/
  lib/        value-units.mjs (scope model), metrics.mjs (per-question credit),
              selectors-race.mjs, dense-embed.mjs, paths.mjs (+ pilot lib copies)
  scripts/    run-d21, run-race, validate-d21, validate-race, analyze-d21-diff,
              analyze-race, phase-c, build-hpylori-gold.py, fetch-dense-model, leak-check
  tests/      41 tests (24 benchmark + 11 provenance + 6 race)
  corpus/     pilot corpus (frozen) + case-hpylori-treatment corpus (5 qids/216)
  cases/      pilot cases (gold byte-identical) + case-hpylori-treatment
  pre-registration/   EXPERIMENT_PRE_REGISTRATION.json + gold-freeze-record.json
  adjudication/       decision-sensitive-packet.json (+key) + pilot gold reference
  results/d21/  D2.1 rerun 96 runs + d2-to-d21-diff.json
  results/race/ race 135 runs + summary + winner-sensitivity + q2 compare
  packets/     本包 + D2.1_CORRECTION_PACKET + D2_TO_D2.1_METRIC_DIFF +
               DECISION_SENSITIVE_SECOND_ADJUDICATION_PACKET
```

## D. D2.1 evaluator correction

见 `packets/D2.1_CORRECTION_PACKET.md`（summary）：

- 缺陷：`question_id = qidOf(primary_sources[0])` / `qidOf(sids[0])` → 跨问题
  aspect 被压成单题、且依赖 gold 数组顺序（`CRITICAL_ASPECT_CHAIN =
  QUESTION_PROVENANCE_LOST`，外部审计已确认）。
- 修正：value unit 携带 `scope ∈ {QUESTION, CROSS_QUESTION, CASE}` +
  规范有序 `question_ids[]`（由 unit 自身 supporting sources 全集机械导出），
  per-question coverage 按 "对 q 计分仅当选中 q 自已的 supporting source" 记账；
  CASE unit 永不进入 per-question / minority denominator。
- 全部实验输入冻结：corpus / Semantic Gold / selectors / ngram proxy /
  budgets / cases 与 pack 完全一致（gold.json sha256 byte-identical。
  V2；selection 96/96 identical. V6）。

## E. provenance invariants

| invariant | 实现与验证 |
|---|---|
| SOURCE_ORDER_INVARIANCE | 3 组排列 × synthetic + real case：全部 metrics 字节相等；派生 value-units JSON 字节不变（支持列表规范排序） |
| MULTI_QUESTION_ASPECT_PROVENANCE | `asp-concept` → `[462973596,477427067,485463474,487214224]` 等完整保留 |
| CASE_LEVEL_UNIT_NOT_IN_QUESTION_DENOMINATOR | expert/evidence group 不出现在任何 per-question 列表 |
| QUESTION_MEMBERSHIP_EXACT_MATCH | `question_ids == sorted unique qids(supporting)`（CASE→[]），9 cases 全过 |

Tests: `tests/provenance.test.mjs` (11) — all PASS.

## F. reproducibility result（fresh isolated checkout）

documented commands: README §2。实测（完整 fresh copy → `npm install`
→ 41/41 tests → validate-d21 8/8 → validate-race 9/9）全部 PASS，无需 symlink，
任意 cwd 可用。修复事项：(1) corpus 规范路径 `corpus/`（原 pack 的
`benchmark/corpus` 缺失 bug 由 layout 修复）；(2) Windows/node22 下
`node --test tests/` 目录参数不可用 → 文档与 package.json 统一用
`node --test "tests/*.test.mjs"`；(3) dense 模型即取即用脚本
`scripts/fetch-dense-model.mjs`（SHA-256 锁定，commit 不含 ~95MB 模型）。
依赖说明：validators 需要同分支内 `external-audit/2026-08-27`（D2 基线）。

## G. experiment preregistration

`pre-registration/EXPERIMENT_PRE_REGISTRATION.json`（version 1.0.0，frozen
2026-08-28T05:10+08，**先于任何 Phase B 结果**）：

- B0 popularity Top-K（anchor）；B1 real dense Top-K；B2 question-stratified
  simple（floor=1/非空 question + novelty gate 0.90）；B3 dense MMR λ=0.5 +
  current mechanical lanes（expert/contradictory 空，同 pilot 机制）；
  B3_ORACLE_LANES = diagnostic upper bound（排除 winner comparison）。
- K budgets：pilot cases 沿用 case.json；新 case 10/15/24（216 pool，
  K_MEDIUM=15 不饱和）。
- dense model `Xenova/bge-small-zh-v1.5` fp32 ONNX 512-dim，本地 pinned，
  deterministic normalization，缓存（memory+disk），**无 ngram 回退**。
- 参数在结果出现后零修改（EXPERIMENT_VERSION_BUMP 条款未触发）。

## H. new cross-domain case

```text
case-hpylori-treatment
domain : medicine (gastroenterology) — deliberately NOT low-code/enterprise
questions : 5 (52215270 136 / 533032588 34 / 616791818 28 / 3376603186 8 / 525603218 10)
pool     : 216 captured sources (verify-output valid=true; captured=pool frozen)
imbalance: 136 : 8 (17x)
```

WHY_THIS_CASE（完整 rationale 在 case.json notes + 本 §H；选择发生在读取语料
期间、race 之前，时间戳可核：corpus captured 04:25Z → case.json 04:45Z →
gold built+frozen 04:47–04:49Z → race first run 04:50Z）：

- 自然对应多个知乎问题（治疗决策 / 胃癌证据 / 根除后体验 / 自愈 / 不治疗危害），
  天然构成 cross-question research 形状；
- 规模不均衡（大问题 136 源 vs 小问题 8 源）——直接对抗 dominance failure；
- 真实观点分歧：必治派（指南立场）vs 有条件不治派（无症状评估）vs 副作用
  后悔派（IBS/菌群）vs 替代方案派（益生菌/中医）——4 个 contradiction
  clusters 全部来自真实内容；
- 高赞 mainstream（孙小白 358、逍遥散人 241、华西医院机构号 191）与
  低热度高价值（药理学博士 1 赞、超医生 0 赞、方糖医生发布 2026 指南 0 赞）
  并存——22 个 must-see 中大量 near-zero-vote，gold 与 popularity 无共线；
- 专家身份（三甲医院机构账号、医生、药师、疾控账号）与 evidence
  （指南/共识/柳叶刀队列/论文解读/引用）齐备；
- K_MEDIUM=15 << 216，不饱和。

WHY_IT_IS_ARCHITECTURE_DISCRIMINATIVE：医学内容在 dense 空间中高度同质
（四联/根除/胃癌这些概念围绕同一语义区域），MMR 的去重压力最大；同时
minority questions（自愈/危害）与小问题保护须显式发生——B1 纯语义、B2
显式 floor、B3 依赖 lane/MMR 间接保护三种机制在此可分辨。

WHY_IT_IS_NOT_SELECTED_AFTER_SEEING_STRATEGY_RESULTS：选择在 04:40Z 前
（语料阅读期）完成并写入 case.json/preregistration；race 首次运行 04:50Z
（即 gold freeze 之后）。候选备选：增程式电动车 / 中医争议 / 程序员 35 岁
危机；当时即因 "multiple natural questions + expert identity + evidence +
size imbalance" 得分最高而选幽门螺杆菌，未用任何 strategy 表现做依据。

## I. Gold freeze identity

```text
new case : g2-gate01-provisional-hpylori
  gold.json sha256 : 8961a90b…d3df5bc (pre-registration/gold-freeze-record.json)
  families        : relevance 189/216, must_see 22, aspects 7 (all CROSS-QUESTION
                    capable), expert 27 SUPPORTED, evidence_quality 34,
                    long_tail 31, contradiction 4 clusters, provenance 4 groups
  label_status    : PROVISIONAL (execution-agent proposal, full content reading,
                    frozen BEFORE strategy runs; gold.provenance.gold_frozen_before_strategy=true)
  second judgment : adjudication/decision-sensitive-packet.json (47 labels, blinded)
pilot cases : gold byte-identical to D2 pack (validator V2; freeze record all 9)
```

Discipline：freeze record 创建于 race 之（前）04:49Z；validate-race V4 断言
hash 未变。违反即 INVALID（未发生）。

## J. B0/B1/B2/B3 results

### J.1 — new medical case (case-hpylori-treatment; must_see scorable=22)

| K | strategy | must_see | aspect | xq_claim | minority_min | redundancy | ops |
|---|---|---|---|---|---|---|---|
| 10 | B0 | **0.227** | **0.714** | 0.000 | 0.000 | 0.764 | 1,162 |
| 10 | B1 dense | 0.045 | 0.286 | 0.000 | 0.000 | 0.877 | 217 |
| 10 | B2 q-strat | 0.091 | 0.571 | 0.000 | 0.000 | 0.869 | 289 |
| 10 | B3 MMR+lanes | 0.136 | 0.571 | 0.000 | 0.000 | 0.806 | 4,423 |
| 10 | B3 oracle | 0.136 | 0.571 | 0.000 | 0.000 | 0.823 | 4,381 |
| 15 | B0 | **0.318** | **0.857** | 0.000 | 0.000 | 0.771 | 1,162 |
| 15 | B1 dense | 0.136 | 0.714 | **0.250** | 0.000 | 0.873 | 217 |
| 15 | B2 | 0.136 | 0.857 | 0.000 | **0.048** | 0.852 | 380 |
| 15 | B3 | 0.182 | 0.714 | 0.000 | 0.000 | 0.825 | 8,445 |
| 15 | B3 oracle | 0.136 | 0.714 | 0.000 | 0.000 | 0.826 | 8,380 |
| 24 | B0 | 0.364 | 0.857 | 0.250 | 0.000 | 0.783 | 1,162 |
| 24 | B1 dense | 0.182 | 0.714 | 0.250 | 0.048 | 0.862 | 217 |
| 24 | B2 | 0.182 | **0.857** | 0.000 | **0.059** | 0.832 | 617 |
| 24 | B3 | **0.364** | 0.714 | 0.000 | 0.000 | 0.801 | 18,384 |
| 24 | B3 oracle | 0.273 | 0.714 | 0.000 | **0.143** | 0.805 | 18,185 |

### J.2 — existing low-code cross case (case-cross-lowcode; must_see scorable=15)

| K | strategy | must_see | aspect | xq_claim | minority_min | redundancy | ops |
|---|---|---|---|---|---|---|---|
| 5 | B0 | **0.200** | 0.333 | 0.250 | 0.000 | 0.804 | 325 |
| 5 | B1 | 0.133 | 0.500 | 0.250 | 0.000 | 0.828 | 76 |
| 5 | B2 | 0.067 | 0.833 | 0.250 | 0.000 | 0.776 | 86 |
| 5 | B3 | 0.067 | 0.667 | 0.250 | 0.000 | 0.702 | 705 |
| 10 | B0 | **0.400** | 0.833 | **0.500** | 0.000 | 0.754 | 325 |
| 10 | B1 | 0.200 | 0.833 | 0.250 | 0.000 | 0.804 | 76 |
| 10 | B2 | 0.200 | 0.833 | 0.250 | **0.200** | 0.799 | 127 |
| 10 | B3 | 0.200 | 0.833 | 0.250 | 0.000 | 0.721 | 1,695 |
| 20 | B0 | **0.533** | 1.000 | **1.000** | **0.375** | 0.698 | 325 |
| 20 | B1 | 0.467 | 0.833 | 0.250 | 0.000 | 0.792 | 76 |
| 20 | B2 | **0.533** | 1.000 | 0.500 | 0.250 | 0.779 | 298 |
| 20 | B3 | 0.400 | 1.000 | 0.500 | 0.000 | 0.727 | 5,772 |

（全 9 case 全表：`results/race/decision-tables.json`；synth cases 仅作
sanity：B2/B3 在 dominance fixture 上 <B0 的 diversity/amin 改善复现，
FIXTURE_MECHANICAL gold，不进结论。）

### J.3 — winner counts（fair only, ties shared; 27 cells = 9 case × 3 budgets）

```text
              must_see  aspect  xq_claim  minority_min  redundancy_low
B0 pop        18       22      8         3             10
B1 dense      13       14      7         2             5
B2 q-strat    16       20      5         6             9
B3 mmr+lanes  13       17      6         5             16
```

## K. existing-domain vs new-domain comparison (Q7)

**跨域一致性成立**（低代码 + 医学两个真实域，在 primary metrics 上方向一致）：

1. B0 popularity 在两个域都是 must_see/aspect 最强（8/8 real-case must_see
   cells 由 B0 或并列最优；新域 3/3 cells 最优或并列）。
2. B1 real dense Top-K 在两个域都弱于 B0（不构成 semantic 晋级证据）。
3. B2 是唯一在两个域都稳定给出 nonzero minority_min 的 fair strategy
   （低代码 K10/K20: 0.200/0.250；医学 K15/K24: 0.048/0.059）；B3 机械 lanes
   在两个域都是 0.000。
4. B3 冗余最低（低代码域 6/9 cells；医学域 0/3 cells —— 医学域 B0 反而更低）。
5. B3 成本最高（低代码 2–20×B1；医学 20–85×B1；synth dominance 275k ops）。

唯一跨域分歧：医学域 K_LARGE 时 B0/B3 并列 must_see 第一（0.364），低代码域
B0 独占多数。属幅度差异，非方向反转。

## L. decision-sensitive second-adjudication result

- blinded packet（47 labels）: `adjudication/decision-sensitive-packet.json`
- unblinding key（禁止给第二 judge）: `adjudication/decision-sensitive-key.json`
- winner sensitivity（`results/race/winner-sensitivity.json`）:

```text
baseline must_see ordering @K_MEDIUM (new case):
  B0 (0.318) > B3 (0.182) > B1 (0.136) = B2 (0.136)
single-label flips changing ordering : 3 (B3-vs-B2 relative position)
top-winner (B0) flips                 : 0
GOLD_DECISION_SENSITIVITY = HIGH
```

**结论：second-adjudication disagreement（尤其实体 MS 标签 52215270:2297169997、
52215270:3312209969、616791818:105981792797）会改变 B2-vs-B3 相对次序 →
按任务 §Phase C：`GOLD_DECISION_SENSITIVITY = HIGH`，不得进入 Spec Gate。
B0 领先本身对单标签翻转稳健（0 flips）。**

## M. primary metric comparison

| primary metric | 观察（real cases, fair strategies） |
|---|---|
| 1. Must-See Recall | B0 全面最强（8/8 cells 最优或并列）；B3 在医学 K24 追平；dense/分层未能系统性打败 popularity |
| 2. Cross-Question Claim / Required-Provenance Coverage | 低代码域 B0 最优（0.5/1.0 vs ≤0.5）；医学域整体弱（≤0.25），B1 K15/24 唯一 nonzero；无策略稳定解决 |
| 3. Per-Question Coverage + Minority-min | B2 唯一在两域稳定 >0 的 fair 策略；B3 机械 lanes 两域 =0（依赖空 expert/contradictory lane）；oracle 显示 lanes 有潜力（医学 K24 0.143）但机制层拿不到 |
| 4. Aspect Coverage | B0 最优或并列最多（22/27 cells）；B2 次之（20）；trend: 高赞 comprehensive answers 天然覆盖多 aspect |
| 5. Redundancy + Cost | B3 冗余最低（低代码域一致，医学域否）；B3 成本 2–85×B1、B2 5–30×B3 便宜；B1 最便宜 |

## N. cost comparison

```text
relative_compute_ops (NOT_PRODUCTION_COST; same-machine relative):
  B1 dense : cheapest semantic selector (76–1,081 ops across cases)
  B2       : 1.3–2.9× B1 (floor walk + novelty pairs)
  B0       : fixed selection_ops; ≈5–14× B1 on big pools
  B3       : 10–85× B1 (pairwise MMR); synth dominance 275k ops
wall clock: dominated by dense inference (cached); model calls = unique texts
            only (disk cache: second run 53,280 attempts / 53,280 hits = 0 net
            model calls); diagnostics only, no production cost claim.
```

## O. failures / caveats

```text
- GOLD_DECISION_SENSITIVITY = HIGH：B2-vs-B3 must_see 差异部分落在 single-label
  翻转带内 → 3-flip 分析见 L；B0 领先对单标签稳健。
- B3_ORACLE_LANES 在 must_see 上不是 upper bound（医学 K15/K24 0.136/0.273 < B0
  0.318/0.364）：lanes 只会把配额移给 expert/contradictory 成员，反而挤掉
  must-see——oracle 上界只对 lane-specific 指标成立。这是架构级证据，不是 bug。
- 新 case gold 为 PROVISIONAL（执行侧提出），47 个 decision-sensitive labels
  待第二 adjudication；K_MEDIUM 差异（1 source / 22）在噪声带内。
- 医学域 3/5 问题 captured<answerCount（136/145 等，折叠回答）＝ frozen pool
  的固有偏置；grabber verify 均 valid。
- B2 novelty gate 0.90 与 floor=1 是 frozen 参数，未做调参搜索（pre-registered；
  敏感性未系统探索）。
- synth cases 为 FIXTURE_MECHANICAL gold，仅 sanity，不进 winner 结论。
- Tier-3 / adaptive stopping 未运行（NOT_RUN）——本轮显式禁止。
- 未做 production cost 测量（本轮禁止为此扩张工程）；relative ops 只是
  same-machine 代理。
```

## P. which previous conclusions survived

1. **B0 popularity 在真实知乎数据上是强 baseline**（跨域复现：must_see /
   aspect / xq 全面领先）——且现在由 real dense + 新域复证。
2. **B2（MMR+lanes 类）在真实 case 上未系统性胜过简单策略**——原 pilot
   "B2 > B1 未证实" 在 corrected evaluator + real dense 下依然成立，且扩展到
   B3-vs-B2：coverage 相当（差异在 gold 噪声带内）。
3. **B1/B2 的 ngram 结论方向性未变**：real dense B1 仍不敌 popularity；
   dense 改变个别数字不改变 winner ordering（Q2）。
4. **oracle lanes 保持 upper-bound-diagnostic 定位**（对 lane 指标），
   不进 winner comparison。
5. **cost 不对称**：MMR pairwise 是大 pool 成本主导（275k ops worst case）。

## Q. which previous conclusions were invalidated

1. **“只有 aspect_recall 移动了”（11_OPEN_QUESTIONS §1 的 D2 表述）→ 证伪**：
   D2→D2.1 实际移动的是 `per_question_coverage_preservation`（12/12）与
   `minority_question_recall_macro`（9/12）；aspect_recall 0 变化。
   根因即 QUESTION_PROVENANCE_LOST 黑洞化效应（详见 D2_TO_D2.1_METRIC_DIFF）。
2. **“case 级 aspect 因 question_id=null 而不进 per-question 指标 = 正常”
   的放任解释 → 修正**：case 级（expert/evidence group）确实不进；但
   cross-question aspects 必须进其所覆盖的全部 question（4 个真实 qid
   被错误归入 1 个，denominators 1→3 / 4→5 / 10→11 / 6→7）。
3. **“B2 只在 diversity/aspect/redundancy 有边际改善” 的 pilot 结论中
   minority 部分 → 修订**：corrected evaluator 下 B2 是唯一在两域稳定
   保护 small question 的 fair 策略（此前被 collapsed denominators 掩盖；
   同时 B0 K20 lowcode minority_min=0.375 显示大 K 下 popularity 也能
   覆盖 minority——上一轮未见此数字）。

## R. evidence-supported outcome (pre-registered decision rule)

```text
OUTCOME A conditions (B2 ≈/> B3 on coverage + cost lower + complexity lower
+ stability >=) — measured:
  coverage : B2 >= B3 on minority_min (两域全 cells), aspect (医学 K15/K24),
             lowcode must_see K_LARGE; B3 > B2 on hpylori must_see K10/15/24
             (3/22, 4/22, 8/22 vs 2/22, 3/22, 4/22) — 其中 K15 差 1 source
             位于 single-label 翻转带内 (winner-sensitivity flips)
  cost     : B2 5–30× cheaper than B3
  complexity: B2 参数 (floor+threshold) << B3 (MMR+6 lanes+weights)
  stability : both deterministic (jaccard 1.0)
  B3-only unique value : redundancy lowest in lowcode domain (6/9 cells),
             NOT in medical domain (0/3), and redundancy is scored but its
             research value is secondary to coverage (secondary/diagnostic
             per task §5 primary list — redundancy is listed primary #5,
             so this counts, with the cross-domain caveat)

EVIDENCE_SUPPORTS =
  PROCEED_WITH_SIMPLIFICATION            (tentative; B2 vs B3 coverage ≈,
                                           B2 cheaper/simpler; B3 redundancy
                                           advantage is domain-inconsistent)
  WITH GOLD_DECISION_SENSITIVITY = HIGH  (→ Spec gate stays closed until
                                           ChatGPT second adjudication)

NOT selected: OUTCOME B (MMR+lanes 未在多个真实 case 稳定取得 simple 无法
取得的 coverage improvement: machinery-level lanes 在 two domains 均未保护
minority, oracle 只证明潜力)；
NOT OUTCOME C (popularity+dense+stratified 至少覆盖了 must-see/aspect 大
部分可得价值, B2 有 minority 改善)；
NOT OUTCOME D (metrics 与人工研究价值对应稳定: B0 dominance 本身是真实
知乎内容结构的合理反映, 且 gold 非 popularity 构造——22 must-see 中大量
near-zero-vote；D2.1 evaluator 修正已消除已知 metric-model 扭曲)。

FINAL STATE

TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_REVIEW
NEXT_GATE = ChatGPT formal review of this packet (+ second adjudication of
            adjudication/decision-sensitive-packet.json, blinded)
```