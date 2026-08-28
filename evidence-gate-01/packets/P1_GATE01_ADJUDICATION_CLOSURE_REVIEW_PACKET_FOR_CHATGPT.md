# P1_GATE01_ADJUDICATION_CLOSURE_REVIEW_PACKET_FOR_CHATGPT

> GATE01_ADJUDICATION_CLOSURE — 第二裁决机械应用 + 冻结 selection 重计分。
> **不 rerun selector / 不调参 / 不抓新数据 / 不改 preregistration / 不进 Spec。**
> 模式：`FIXED_SELECTION_RESCORING_ONLY`。

```text
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_FINAL_REVIEW
```

---

## A. remote branch / exact final SHA

```text
REMOTE_BRANCH : dg01-decision-grade-gate           (pushed to origin)
FINAL_COMMIT  : <git rev-parse HEAD 最终值>         (见 §O 复验)
BASE_SHA      : c3f5e9c26e1a330f63fbbd85ede9a96a2db824b0
远端验证      : git ls-remote origin dg01-decision-grade-gate（§O）
```

（pushing 完成后填写实际 SHA；旧的 content commit 1e0f7bf 不变，本轮新增
closure commits 在其之上。）

## B. second adjudication input validation

```text
SECOND_ADJUDICATION_INPUT_VALIDATION = PASS (6/6)
  V1 47/47 label_id 存在、未知=0、缺失=0
  V2 decision ∈ {YES, NO, UNSURE}：实际 YES=27 / NO=20 / UNSURE=0
  V3 source identity 零修改（所有 decision key 解析到 packet label/source）
  V4 裁决文件无 strategy identity 泄漏
  V5 unblinding key 47/47 一一对应 packet（本轮补全：原 key 32 → 47）
  V6 packet 维持 blinded（无 voteup/commentCount/strategy 字段）
command: node scripts/validate-adjudication-input.mjs
输入文件: adjudication/CHATGPT_SECOND_ADJUDICATION_GATE01_V1.json (sha256 a557808b…ccace6)
         adjudication/P1_GATE01_CHATGPT_FORMAL_REVIEW_V1.md (sha256 998e6e2d…e56d429)
```

## C. corrected 47-label inventory

```text
machine packet (authority, 未改动):
  must_see               = 22
  must_see_candidate     = 10
  contradiction_stance   = 11
  cross_question_aspect  =  4
  TOTAL                  = 47   (label_id 全部唯一)
旧 Markdown inventory (must_see 22 / candidate 10 / stance 15 / aspect up to 12)
= 文档错误，已于 closure-prep commit 修正（DECISION_SENSITIVE_SECOND_ADJUDICATION_PACKET.md §2 附 erratum）。
```

## D. Gold before / after

```text
GOLD_BEFORE: cases/case-hpylori-treatment/GOLD_BEFORE_SECOND_ADJUDICATION.json
             (provisional 原件字节副本; 原件 gold.json 未被覆盖)
GOLD_AFTER : cases/case-hpylori-treatment/GOLD_AFTER_SECOND_ADJUDICATION.json
             (第二裁决机械应用: must_see NO→移除, candidate YES→提升,
              stance NO→移除该 source, aspect NO→移除该 source)
DIFF      : cases/case-hpylori-treatment/SECOND_ADJUDICATION_DIFF.json
             must_see 22 → 13
             移除 10: 52215270:1466037599 / 1515402768 / 1829396577 / 1909462572 /
                      2240620369 / 2297169997 / 2874637547 / 3312209969 /
                      533032588:2488047450 / 616791818:3257696322
             提升 1 : 52215270:3599356918 (must_see_candidate YES)
             保留 12 original; stance 移除 0 (11 stance 全 YES);
             aspect 移除 1 (asp-treatment-regimens 的 533032588:2487596117)
             交叉验证: 机械 final must_see == ChatGPT final_must_see_sources_if_applied
                       13/13 集合完全一致
```

## E. final must-see set/count

```text
FINAL_MUST_SEE_COUNT = 13
  retained original must_see   = 12
  promoted must_see_candidate  = 1  (52215270:3599356918, Master Qi)
  removed provisional must_see = 10
final set (13): 3376603186:28820202588, 52215270:2071906039922963690,
  52215270:2326510132, 52215270:3156697298, 52215270:3611600579,
  52215270:975101683, 52215270:3599356918, 525603218:2444858135,
  533032588:2712153634, 533032588:83325887262, 616791818:105981792797,
  616791818:3164788252, 616791818:91125298017
语义: 13 ≤ 15-slot budget，与 label question 定义一致（不再把 22 个可替代
来源全部称为 must-have）；ChatGPT Formal Review §3 的 over-inclusion 修正已落实。
```

## F. value-unit changes

```text
- must_see units: 22 → 13 (unit per scorable must-see source)
- contradiction: clusters 4 → 4 (无 stance 移除 -> membership 不变)
- aspects: 7 → 7 (asp-treatment-regimens 丢 1 primary source: 号卡侦探 2487596117)
  受影响 cross-question memberships: asp-treatment-regimens 的 qid 覆盖不变
- per-question denominators 重算（must_see 相关 qids 变少）
- cross-question provenance structures 不变（required_provenance_groups 未被
  第二裁决触碰）
- value units 由 GOLD_AFTER 经 D2.1 scope model 重新派生（validate-rescore R3 通过）
```

## G. frozen-selection identity proof

```text
SELECTION_IDENTITY_BEFORE_AFTER = EXACT
  validator: node scripts/validate-rescore.mjs R1
  results  : 27/27 runs (hpylori 15 + cross-lowcode fair 12) selected_source_ids
             与 results/race/* 冻结 JSON byte-identical
静态保证: adjudicated-rescore.mjs 不 import / 不调用任何 selector (R5)
selectors NEVER invoked in this round (no B0/B1/B2/B3 call sites).
```

## H. before / after metric tables（medical case；must_see 分母 22 → 13）

### K10

| strategy | must_see bef→aft | asp | xq | amin | red | ops |
|---|---|---|---|---|---|---|
| B0 | 0.227→0.231 (5/22→3/13) | 0.714 | 0.000 | 0.000 | 0.764 | 1,162 |
| B1 | 0.045→0.154 (1/22→2/13) | 0.286 | 0.000 | 0.000 | 0.877 | 217 |
| B2 | 0.091→0.231 (2/22→3/13) | 0.571 | 0.000 | 0.000 | 0.869 | 289 |
| B3 | 0.136→0.308 (3/22→4/13) | 0.571 | 0.000 | 0.000 | 0.806 | 4,423 |
| B3 oracle | 0.136→0.231 (3/22→3/13) | 0.429 | 0.000 | 0.000 | 0.823 | 4,381 |

### K15

| strategy | must_see bef→aft | asp | xq | amin | red | ops |
|---|---|---|---|---|---|---|
| B0 | 0.318→0.308 (7/22→4/13) | 0.857 | 0.000 | 0.000 | 0.771 | 1,162 |
| B1 | 0.136→0.308 (3/22→4/13) | 0.714 | 0.250 | 0.000 | 0.873 | 217 |
| B2 | 0.136→0.231 (3/22→3/13) | 0.857 | 0.000 | **0.050** | 0.852 | 380 |
| B3 | 0.182→0.308 (4/22→4/13) | 0.714 | 0.000 | 0.000 | 0.825 | 8,445 |
| B3 oracle | 0.136→0.231 (3/22→3/13) | 0.714 | 0.000 | 0.000 | 0.826 | 8,380 |

### K24

| strategy | must_see bef→aft | asp | xq | amin | red | ops |
|---|---|---|---|---|---|---|
| B0 | 0.364→0.308 (8/22→4/13) | 0.857 | 0.250 | 0.000 | 0.783 | 1,162 |
| B1 | 0.182→0.308 (4/22→4/13) | 0.714 | 0.250 | 0.050 | 0.862 | 217 |
| B2 | 0.182→0.308 (4/22→4/13) | 0.857 | 0.000 | **0.062** | 0.832 | 617 |
| B3 | 0.364→0.462 (8/22→6/13) | 0.714 | 0.250 | 0.000 | 0.801 | 18,384 |
| B3 oracle | 0.273→0.462 (6/22→6/13) | 0.857 | 0.250 | **0.150** | 0.805 | 18,185 |

（redundancy 为 gold-independent，AFTER=race dense 值；ops 不变 —— 因为
selection 未变。完整机器数据: results/adjudicated-rescore/*。）

## I. B2-vs-B3 adjudicated result（@ K_MEDIUM = K15）

```text
must_see   : B2 0.231 (3/13) < B3 0.308 (4/13)   —— B3 高 1 source
aspect     : B2 0.857 > B3 0.714                 —— B2 高
minority   : B2 0.050 > B3 0.000                 —— B2 高（唯一保护者）
redundancy : B2 0.852 > B3 0.825                 —— B3 低（优）
cost       : B2 380 ops << B3 8,445 ops          —— B2 便宜 22×
全 budget  : must_see B3 均高 1-2 source (4v3/4v3/6v4); aspect B2 高 (0.571=/
            0.857/0.857 vs 0.571/0.714/0.714); minority B2 唯一 >0
结论: 第二裁决后 B3 在 must_see 上仍领先但差距固定在 1–2 个 source
(13-slot 分母), 而 B2 在 aspect/minority 全面更优且便宜一个数量级。
1-2 source 差 = 裁决敏感性带（§J）；不能声称 MECHANICALLY_PROVEN_WINNER。
```

## J. B0 robustness

```text
provisional gold: B0 全面最强 (0 flips 反超; K15 0.318 第一)
adjudicated gold: B0 must_see 0.231/0.308/0.308 → K15 并列第一、K10/K24 并列第二;
                  B0 命中 7/22 → 4/13 —— 被裁的 10 个 provisional must_see 中
                  3 个是 B0 的高赞命中（provisional over-inclusion 曾虚增 B0）
结论: B0 popularity 仍是 top-tier feature/anchor，但 adjudicated 后不再是
独占 dominance；其 "must-see 优势" 的一部分来自被第二裁决裁掉的 over-inclusive
label，这佐证 popularity ≠ must-have。
```

## K. cross-domain comparison

```text
（low-code gold 未经第二裁决; medical = adjudicated 13）
1. B0 popularity dominance：低代码域仍成立 (K5/K10/K20 must_see 0.2/0.4/0.533
   全最高); 医学域降为 tie/2nd —— dominance 由 "全胜" 改为 "top-tier, 不稳定独占"
2. B2 minority-question protection：两域唯一稳定 >0 —— 低代码 0.200/0.250,
   医学 0.050/0.062（adjudicated 后依然成立）
3. B3 独有 coverage improvement：无跨域稳定存在 —— 医学 must_see 仅 1-2 source
   优势 (13 分母), 低代码域 B2 ≥ B3 (K_LARGE 0.533 vs 0.400); 无 "simple
   selector 无法取得的重要 coverage"
4. B3 redundancy advantage：相对 B2 跨域一致存在（两域、全 K, B3 更低 0.02-0.05）;
   相对 B0 域不一致 (低代码 B3 低, 医学 B0 低) —— 表述修正自上一轮 packet §R
   （上一轮 "医学域 0/3 cells B3 更低" 有误: 医学域相对 B2 是 3/3 cells 更低)
5. simplification 支持度：覆盖层面 B2≈B3 + B2 更简单更便宜; B3 独有 = redundancy
   （第 5 primary, 成本邻近型）→ 仍支持 simplification, 且证据比 provisional
   版更强（B0 不再独占也削弱"popularity-only"反方）
```

## L. architecture Outcome (pre-registered rule, §10-§11)

```text
OUTCOME A 门槛: B2 core-coverage ≈/> B3 AND 更简单更便宜 AND B3 无跨域稳定
               独有 coverage gain —— 满足:
  coverage: 指标级互有胜负, 差距 ≤1-2 source (13-slot)/或 B2 更优 (aspect, minority)
  cost    : B2 5-30× 便宜 (medical 380-617 vs 4.4k-18.4k ops)
  B3 gain : 仅 redundancy (两域一致但属第 5 primary, 非 coverage);
            oracle lanes 也未能给 B3 提供 must_see 上界 (medical K15 0.231<0.308)

OUTCOME A 门槛 vs 其他: OUTCOME B 不满足 (无跨域稳定 "重要 coverage" 独有 gain);
           OUTCOME C 不满足 (four strategies 覆盖了大部分可得 must-see/aspect,
           B2 有 minority 改善); OUTCOME D 不满足 (metrics 稳定对应人工价值:
           B0 强 + B2 minority + B3 redundancy 均在两域可复现)

EVIDENCE_SUPPORTED_ARCHITECTURE_OUTCOME =
  OUTCOME A — PROCEED_WITH_SIMPLIFICATION
(NOT MECHANICALLY_PROVEN_WINNER: B2~=or>B3 的 numeric equivalence margin
 未 preregister, 按 §10 只作 evidence-backed engineering judgment;
 不冻结为 "winner code", 见 §M)
```

## M. six-lane implication

```text
hard selector constraints（当前 lane quota 机制）→ 退出:
  mainstream     → retrieval signal / soft ranking feature（votes 已是 B0 核心）
  expert         → retrieval signal + soft feature（credential-topic match）
  evidence_rich  → retrieval signal + soft feature（mechanical markers）
  fresh          → query expansion / temporal signal；当前语料下 diagnostic only
  long_tail      → soft ranking feature（zero-vote + substantive），非配额 lane
  contradictory  → selector 层 diagnostic only（无独立 production 信号）；
                   矛盾结构属于 claim-stage 分析，不属于 inclusion 决策

若 OUTCOME A 成立, 架构假设（需未来实验/文档验证, 本轮不实现）:
  question/source-group preservation + popularity anchor
  + dense semantic relevance/novelty + optional lightweight redundancy control
  —— 不是 "ship B2 as-is"，不是 six hard lanes；
  注意 dense embedding 不应弃用: 仅 dense Top-K 弱, 仍有 novelty/redundancy/
  clustering/within-question retrieval 用途（ChatGPT review finding 7 认可）。
```

## N. remaining caveats

```text
1. equivalence margin 未 preregister → Outcome 是 engineering judgment
2. 1-2 source 差 (13-slot) = B2/B3 must_see 的裁决敏感带; B3 领先非机械赢家
3. blinding 部分妥协: 敏感性 label_id 在 adjudication 前披露
   (ChatGPT review finding 8); packet 本身仍无 popularity/strategy 字段
4. medical must_see 13 个中 3 个为 B0 高赞命中被裁 → B0 数值随 gold 修订下降,
   这是 gold 语义修正的预期效果, 不是 B0 实现缺陷
5. fresh lane 在现语料下实质性 content 稀少 (diagnostic only)
6. UNSURE=0: 裁决全部分类, 无二次跳棋
7. seven 个 aspects 中 asp-treatment-regimens 丢失 1 个 primary source:
   aspect_recall 分母不变 (7), 但该 aspect 的支撑结构变薄
```

## O. tests / validators

```text
command                            pass  fail
node --test "tests/*.test.mjs"       41    0   (existing suite)
node scripts/validate-d21.mjs         8    0   (D2.1 validator)
node scripts/validate-race.mjs        9    0   (race validator)
node scripts/validate-adjudication-input.mjs  6  0  (V1-V6)
node scripts/validate-rescore.mjs     5    0   (R1-R5, selection identity EXACT)
gold before/after diff: machine-verified (13/13 chatgpt match, __len__ 分解)
environment: Windows 11 + node v22.22.2 + npm 10.9.7 (managed runtimes), git bash
```

## P. exact next recommended gate

```text
NEXT_GATE = P1_GATE01_ChatGPT_FORMAL_REVIEW_V2
  scope: (1) 核验 remote dg01-decision-grade-gate 上本 packet 与
         results/adjudicated-rescore/* (code-level readback, review finding 9 关闭);
         (2) 对 OUTCOME A 的 primary-metric 证据给出 PASS/CHANGES_REQUESTED;
         (3) 决定是否把 §M 架构假设 (question/source-group preservation +
             popularity anchor + dense semantic relevance/novelty + optional
             redundancy control) 批准为下一阶段 benchmark 假设 (仍非 Spec);
         (4) SPEC_PREPARATION_GATE 保持 NOT_READY 直至 review PASS。
  之后才可能解锁: Architecture/Spec Preparation (仍需独立 product 决策)。
```

---

FINAL STATE（强制保持）:

```text
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_FINAL_REVIEW
```