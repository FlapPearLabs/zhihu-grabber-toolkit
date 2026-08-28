# DECISION-SENSITIVE SECOND ADJUDICATION PACKET

> Blinded re-judgment of the labels that can change the architecture decision.
> **Do NOT show the unblinding key to the second judge.**

## 1. Blinded packet (machine readable)

```text
adjudication/decision-sensitive-packet.json   47 labels, judgment-ready
adjudication/decision-sensitive-key.json      UNBLINDING KEY — separate file,
                                              NOT for the second judge
```

Blinding guarantees implemented in the packet:

- NO vote/comment counts
- NO strategy identity, NO “selected by …” provenance
- NO popularity-derived fields; only source_id + question title + sanitized
  excerpt + the exact judgment question

## 2. Label inventory — CORRECTED (per machine JSON; previous Markdown was wrong)

The machine packet (`adjudication/decision-sensitive-packet.json`) is the
authority. Its actual inventory is:

| kind | count (machine JSON) | judgment question |
|---|---|---|
| must_see | **22** | Must a high-quality 15-item research corpus include this answer? (YES/NO) |
| must_see_candidate | **10** | same question, for sources ≥2 strategies selected but NOT in gold must_see |
| contradiction_stance | **11** | does this source take the stated for/against stance on the claim? (YES/NO/UNSURE) |
| cross_question_aspect | **4** | is this source the question-level primary representative of the aspect? (YES/NO) |
| **TOTAL** | **47** | (label_id 全部唯一；µ verify 脚本统计) |

> Erratum: an earlier version of this Markdown claimed
> `contradiction_stance = 15` and `cross_question_aspect = up to 12`.
> That was a **documentation error** — the machine packet deduplicates by
> source (first kind wins), yielding 11 stance + 4 aspect labels. The machine
> JSON was never edited; only this Markdown is corrected.

All 47 label items come from the **new real cross-domain case**
`case-hpylori-treatment` (PROVISIONAL gold `g2-gate01-provisional-hpylori`,
frozen 2026-08-28 **before** any selector result).

## 3. Instructions for the second adjudicator

1. Judge each item independently on its stated question. Use the frozen corpus
   (`corpus/<qid>/answers.json`) when possible; otherwise judge from the
   excerpt.
2. Ignore author fame and answer length **as popularity signals** — you are
   judging informational value for a research corpus, not whether the answer
   is popular.
3. Return per-label YES/NO/UNSURE plus a one-line reason for NO answers.

## 4. Pre-computed winner sensitivity (from primary gold; `results/race/winner-sensitivity.json`)

Baseline must-see ordering at K_MEDIUM on the new case:

```text
B0_POPULARITY_TOP_K (0.318) > B3_DENSE_MMR_MULTI_LANE (0.182)
> B1_DENSE_SEMANTIC_TOP_K (0.136) = B2_QUESTION_STRATIFIED_SIMPLE (0.136)
```

Single must-see label removals that flip the architecture ordering: **3**

| flipped label (must-see) | top winner changed? | B3-vs-B2 relative flip? |
|---|---|---|
| 52215270:2297169997 (药理学博士) | NO (B0 stays first) | **YES** (B3 drops to last) |
| 52215270:3312209969 (真实姓名, IBS 反例) | NO | **YES** |
| 616791818:105981792797 (伯伯) | NO | **YES** |

```text
GOLD_DECISION_SENSITIVITY = HIGH
```

Because a single disputed must-see label changes the **B2-vs-B3** relative
position, the architecture A/B decision cannot be settled at decision grade
until the second adjudication resolves these labels. B0's first place is NOT
flipped by any single label (top_winner_flips = 0), so the
“popularity dominance” headline is gold-robust.

## 5. Decision consequence (task §Phase C)

If second-adjudication disagreement changes the architecture winner:

```text
GOLD_DECISION_SENSITIVITY = HIGH  ->  MUST NOT enter Spec Gate.
```

The final review packet therefore reports:

```text
SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_REVIEW
```