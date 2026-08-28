# D2 → D2.1 METRIC DIFF （Correction History）

> Machine-readable source: `results/d21/d2-to-d21-diff.json`.
> Scope: only `case-cross-lowcode` is affected (the only pilot case with
> cross-question aspects). All other 7 cases: **zero metric change**
> (75/96 runs unchanged — they contain no multi-question value units).

---

## 1. Summary

```text
files compared            : 96 (8 cases x 4 strategies x 3 budgets)
files with ANY change     : 12 (all case-cross-lowcode)
selection identical       : 96 / 96  (inputs & selectors frozen; delta = evaluator only)
metric change frequency   :
  per_question_coverage_preservation : 12  (dominates)
  minority_question_recall_macro     :  9
  aspect_recall / all other metrics  :  0  (unchanged)
```

## 2. What changed per unit (denominator shifts, D2 -> D2.1)

| Question | D2 scorable units | D2.1 units | delta | cause (collapsed aspect now credited to its real questions) |
|---|---|---|---|---|
| 487214224 | 1 | **3** | +2 | +asp-concept, +asp-pitfalls |
| 485463474 | 4 | **5** | +1 | +asp-concept |
| 477427067 | 10 | **11** | +1 | +asp-concept |
| 462973596 | 6 | **7** | +1 | +asp-concept |

`439521858` and `466695857` unchanged (9 and 8 units).

## 3. Per-question coverage, case-cross-lowcode K_MEDIUM (fair strategies)

| strategy | question | D2 covered/scorable | D2.1 | change |
|---|---|---|---|---|
| B0 | 462973596 | 0/5 = 0.000 | 0/7 = **0.000** | denominator 5→7 (coverage same, pressure up) |
| B0 | 485463474 | 2/4 = 0.500 | 2/5 = **0.400** | **value drops 0.500 → 0.400** |
| B0 | 487214224 | 0/1 = 0.000 | 0/3 = **0.000** | denominator 1→3 |
| B1-ngram | 462973596 | 2/5 = 0.400 | 3/7 = **0.429** | **value rises 0.400 → 0.429** |
| B1-ngram | 485463474 | 0/4 = 0.000 | 0/5 = 0.000 | denominator 4→5 |
| B1-ngram | 487214224 | 0/1 = 0.000 | 0/3 = 0.000 | denominator 1→3 |
| B2-ngram | 462973596 | 1/5 = 0.200 | 2/7 = **0.286** | **value rises 0.200 → 0.286** |
| B2-ngram | 477427067 | 4/11 | 3/11 = **0.364** | **value drops 0.364 → 0.273** |
| B2-ngram | 485463474 | 0/4 = 0.000 | 0/5 = 0.000 | denominator 4→5 |
| B2-ngram | 487214224 | 0/1 | 0/3 | denominator 1→3 |

Full machine-readable per-run/per-question listing: `results/d21/d2-to-d21-diff.json`.

## 4. Minority-question recall impact (9/12 runs moved)

`minority_question_recall_macro` changed in 9 of the 12 cross-lowcode runs
(3 runs unchanged — e.g. B0 K_SMALL where every affected question had 0
coverage, so the macro average coincidentally stayed 0.111). Every change is a
consequence of the denominator corrections above — **not** of any selector or
gold change.

## 5. What did NOT change (oversight guard)

- `must_see_recall` — 0 occurrences (units unchanged).
- `aspect_recall` — 0 occurrences (aspect-level coverage, membership-based).
- `cross_question_claim_recall` — 0 occurrences (provenance groups were
  already explicit source lists, not unit-question attribution).
- `normalized_question_diversity` — 0 occurrences (Q unchanged: all six
  reference questions already had ≥1 scorable unit both before and after).

## 6. Consequences for previous conclusions (task §A3)

1. The D2 statement *“只有 aspect_recall 移动了”* is **invalidated** and must
   not be repeated (see D2.1_CORRECTION_PACKET §7).
2. D2 per-question / minority numbers for `case-cross-lowcode` are **not
   trustworthy** as absolute values; ordinal strategy comparisons on this case
   are affected in 3 of 27 fair runs (B0 K_MEDIUM: 485463474 0.500→0.400;
   B1 K_MEDIUM 462973596 0.400→0.429; B2 K_MEDIUM 477427067 0.364→0.273).
3. All four strategies' relative ordering on `must_see` was unaffected
   (that metric did not move), so the pilot's B0-must-see-dominance headline
   survives; the corrected evaluator makes per-question and minority claims
   **more accurate** (cross-question aspects now correctly count in every
   question they cover).