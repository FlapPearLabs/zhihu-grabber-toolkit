# TRACK_B_D2_CORRECTED_RERUN_REVIEW_PACKET_FOR_CHATGPT

> Repository: `FlapPearLabs/zhihu-grabber-toolkit`
> Role: ZHIHU CLI PRO — TRACK B D2 GOLD BUILDER + RERUNNER
> Date: 2026-08-27
> Prior: TRACK_B_PILOT_HARNESS = PASS · SEMANTIC_GOLD_ADJUDICATION = PASS · D2 first build reviewed (CHANGES_REQUESTED)
> THIS ROUND: D2 conversion correction ONLY (aspect reconciliation bug + value-unit/dataset-version validation hardening) → rerun existing D2.
> **No re-adjudication. No Semantic Gold authority change. No selector/metric/case change. No corpus. No real embedding. No TARGET. No Spec. No production.**

```text
OLD_D2_INVALIDATED_BY = ASPECT_NAMESPACE_RECONCILIATION_BUG
TARGET_STATUS         = NOT_IMPLEMENTED
REAL_EMBEDDING        = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE = NOT_READY
VERSION_ASSIGNMENT    = UNASSIGNED
D1                    = SUPERSEDED
D2                    = REBUILT_AND_RERUN (corrected)
```

---

## A. Root Cause (aspect namespace reconciliation bug)

`build-d2-gold.mjs` (first D2 build) sourced the aspect schema from the **old D1 aspect objects** and looked up `case_schema_decisions[case].aspects[old_aspect_id]` with the *bare* old id. But the final adjudication namespaced four aspects:

| case | old id | final adjudication id | effect of the bug |
|---|---|---|---|
| case-477427067 | asp-vendor | `case-477427067:asp-vendor` | aspect wrongly DROPPED (4→3) |
| case-466695857 | asp-critique | `case-466695857:asp-critique` | aspect wrongly DROPPED (3→2) |
| case-cross-lowcode | asp-criteria | `case-cross-lowcode:asp-criteria` | aspect wrongly DROPPED (6→4) |
| case-cross-lowcode | asp-concept | `case-cross-lowcode:asp-concept` | aspect wrongly DROPPED (6→4) |

**Fix**: D2 aspect schema authority now comes **directly from the adjudication** — (1) FINAL KEEP ids = keys of `case_schema_decisions[case].aspects` with value KEEP (namespaced keys used verbatim); (2) source membership aggregated from `case_label_decisions[].labels.aspect_ids.value`; (3) relevance gate; (4) name/definition resolved by exact key from the adjudication source packet (`adjudication-packet-v2.2.json` case dictionaries). Old D1 aspect ids are never used to decide Final D2 existence.

## B. Corrected Aspect Counts & Memberships

| case | expected (KEEP) | corrected D2 | VAL |
|---|---|---|---|
| case-439521858 | 4 | 4 (asp-compare, asp-vendor, asp-cost, asp-critique) | exact match |
| case-477427067 | 4 | 4 (asp-criteria, asp-concept, **case-477427067:asp-vendor**, asp-decision) | exact match |
| case-466695857 | 3 | 3 (asp-pro-source, **case-466695857:asp-critique**, asp-technical) | exact match |
| case-485463474 | 1 | 1 (asp-permission) | exact match |
| case-487214224 | 1 | 1 (asp-business-lines) | exact match |
| case-cross-lowcode | 6 | 6 (**case-cross-lowcode:asp-criteria**, asp-vendor-compare, **case-cross-lowcode:asp-concept**, asp-pitfalls, asp-zero-vs-low, asp-source-code) | exact match |

VAL12: every aspect membership set is an **exact match** of (case_label_decisions aspect_ids ∩ relevance=true) — no extra, no missing (FAIL CLOSED).

## C. Corrected Value-Unit Counts

`value_units` re-derived from the corrected D2 gold. VAL14: `critical_aspect` scorable unit count == Final KEEP aspect count for every real case (4/4/3/1/1/6). VAL15: D2 units compared against **derived D1 units** (`deriveValueUnits(gold.d1.json)` with the same derive function; backup `value-units.d1.json` per case) — all differ (no silent reuse). Loader drift check rejects stale files.

## D. Before/After Affected Metrics (aspect_recall, K_MEDIUM, fair)

| case | strategy | OLD_D2 (buggy denom) | NEW_D2 (correct denom) | note |
|---|---|---|---|---|
| case-477427067 | all | 1.000 (3 aspects) | 1.000 (4 aspects) | denominator fixed 3→4 |
| case-466695857 | all | 1.000 (2 aspects) | 1.000 (3 aspects) | denominator fixed 2→3 |
| case-cross-lowcode | B0 | 0.750 (3/4) | **0.833 (5/6)** | now 1/6-multiple ✓ |
| case-cross-lowcode | B1 | 0.500 (2/4) | **0.667 (4/6)** | now 1/6-multiple ✓ |
| case-cross-lowcode | B2 | 0.750 (3/4) | **0.833 (5/6)** | now 1/6-multiple ✓ |
| case-439521858 / 485463474 / 487214224 | all | unchanged | unchanged | namespacing did not affect them |

**Regression proof**: cross-lowcode has 6 scorable aspects → every aspect_recall is now a multiple of 1/6 (0.667 = 4/6, 0.833 = 5/6). The impossible 0.750 (3/4 denominator) no longer occurs. No other metric moved (aspects affect only aspect_recall; all 96 runs rerun deterministically, jaccard stability 1.000).

## E. Validation Results (16/16 PASS, FAIL CLOSED)

```text
VAL1   case-485463474 relevant=2                         PASS
VAL2   case-487214224 relevant=1                         PASS
VAL3   c2-vendor-neutrality dropped                      PASS
VAL4   historical_authority UNRESOLVED + relevance-gated PASS
VAL5   relevance gate holds                              PASS
VAL6   xq4 revised provenance groups                     PASS
VAL7/14/15  D2 units derived from D2 gold; critical_aspect == KEEP aspects;
           derived-D1 vs derived-D2 units differ          PASS
VAL8/16 dataset version d2-<hash> prefix, != D1          PASS
VAL9   all 8 cases rerun as D2 (96 runs)                 PASS
VAL10  fair budgets equal                                PASS
VAL11/13 exact aspect ID set + counts match KEEP (4/4/3/1/1/6)  PASS
VAL12  every aspect membership exact-match               PASS
```

Full test suite: **42/42 pass** (27 harness + 5 V2.1 + 10 V2.2). Leak-check 245 files PASS; production worktree untouched.

## F. Corrected D2 Fair Results (HARNESS_SANITY_ONLY; K_MEDIUM; unchanged except aspect_recall)

| case | strat | must | aspect | expert | long_tail | evQual | contra | xq | semRed | div | macro | min | ops |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 439521858 | B0 | 0.750 | 0.750 | 0.750 | 0.000 | 0.000 | 1.000 | N/A | 0.226 | N/A | N/A | N/A | 49 |
| 439521858 | B1 | 0.750 | 0.750 | 0.250 | 0.000 | 1.000 | 1.000 | N/A | 0.238 | N/A | N/A | N/A | 35 |
| 439521858 | B2 | 0.500 | 0.750 | 0.500 | 0.000 | 0.000 | 1.000 | N/A | 0.217 | N/A | N/A | N/A | 169 |
| 477427067 | B0 | 0.750 | 1.000 | 0.273 | 0.000 | 0.500 | 1.000 | N/A | 0.417 | N/A | N/A | N/A | 53 |
| 477427067 | B1 | 0.250 | 1.000 | 0.273 | 0.400 | 0.167 | 1.000 | N/A | 0.325 | N/A | N/A | N/A | 37 |
| 477427067 | B2 | 0.500 | 1.000 | 0.364 | 0.200 | 0.333 | 1.000 | N/A | 0.350 | N/A | N/A | N/A | 167 |
| 466695857 | B0 | 0.667 | 1.000 | 0.571 | 0.000 | 0.750 | 1.000 | N/A | 0.315 | N/A | N/A | N/A | 42 |
| 466695857 | B1 | 0.667 | 1.000 | 0.429 | 0.500 | 0.750 | 1.000 | N/A | 0.282 | N/A | N/A | N/A | 31 |
| 466695857 | B2 | 0.333 | 1.000 | 0.571 | 0.000 | 0.500 | 1.000 | N/A | 0.259 | N/A | N/A | N/A | 129 |
| 485463474 | B0 | 0.500 | 1.000 | 0.500 | 0.000 | 1.000 | N/A | N/A | 0.341 | N/A | N/A | N/A | 15 |
| 485463474 | B1 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | N/A | N/A | 0.307 | N/A | N/A | N/A | 15 |
| 485463474 | B2 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | N/A | N/A | 0.307 | N/A | N/A | N/A | 84 |
| 487214224 | B0 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | N/A | N/A | 0.189 | N/A | N/A | N/A | 4 |
| 487214224 | B1 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | N/A | N/A | 0.189 | N/A | N/A | N/A | 7 |
| 487214224 | B2 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | N/A | N/A | 0.189 | N/A | N/A | N/A | 19 |
| cross-lowcode | B0 | 0.400 | **0.833** | 0.188 | 0.000 | 0.286 | 0.667 | 0.500 | 0.280 | 0.696 | 0.308 | 0.000 | 325 |
| cross-lowcode | B1 | 0.200 | **0.667** | 0.094 | 0.000 | 0.143 | 0.667 | 0.000 | 0.263 | 0.792 | 0.169 | 0.000 | 151 |
| cross-lowcode | B2 | 0.200 | **0.833** | 0.156 | 0.091 | 0.143 | 0.667 | 0.000 | 0.248 | 0.768 | 0.201 | 0.000 | 1703 |
| synth-dominance | B0 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.479 | 0.000 | 0.000 | 0.000 | 7544 |
| synth-dominance | B1 | 0.000 | 0.333 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.640 | 0.000 | 0.167 | 0.000 | 2161 |
| synth-dominance | B2 | 0.167 | 1.000 | 0.600 | 0.000 | 0.600 | 1.000 | 1.000 | 0.279 | 0.960 | 0.667 | 0.333 | 75889 |
| synth-expert | B0 | 0.250 | 0.500 | 0.000 | 0.000 | 0.000 | N/A | N/A | 0.481 | N/A | N/A | N/A | 149 |
| synth-expert | B1 | 0.375 | 0.500 | 0.500 | 0.400 | 0.250 | N/A | N/A | 0.566 | N/A | N/A | N/A | 81 |
| synth-expert | B2 | 0.250 | 0.500 | 0.300 | 0.200 | 0.200 | N/A | N/A | 0.153 | N/A | N/A | N/A | 443 |

## G. B0/B1/B2 Conclusions (corrected D2, unchanged from the prior D2 review except aspect_recall)

1. Strategies remain distinguishable (synth-dominance sharpest: diversity 0/0/0.960, expert 0/0/0.600, contradiction 0/0/1.000, xq 0/0/1.000). Real cases: moderate adjudicated-gold-consistent differences.
2. **B2 ≥ B1 still NOT established** — must_see equal-or-worse on real cases (439521858 −0.25, 466695857 −0.33), 4–35× compute ops. Same conclusion as D1 and prior D2.
3. cross-question: B0 reaches 2/4 xq claims at K=10; B1/B2 0/4 (semantic concentration). Smallest question still unselected at K_MEDIUM (min=0.000) — per-question constraints remain a TARGET design input.
4. historical_authority NOT_SCORABLE; small-case saturation (485463474/487214224) unchanged.

## H. Status

```text
TARGET_STATUS         = NOT_IMPLEMENTED
REAL_EMBEDDING        = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE = NOT_READY
VERSION_ASSIGNMENT    = UNASSIGNED
D1                    = SUPERSEDED
D2                    = REBUILT_AND_RERUN (corrected; invalid OLD_D2 archived to results/runs-legacy-d2-invalid/)
HANDOFF_COMPLETE      = YES
```

Proposed next step (NOT executed): ChatGPT reviews this corrected packet; then, per the agreed cadence, assemble the complete evidence/design/history pack (D1 + D2 corrected runs, adjudication, harness) for one independent external review (Claude) before any further gate.
