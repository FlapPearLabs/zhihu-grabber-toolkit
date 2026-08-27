# TRACK_B_D2_RERUN_REVIEW_PACKET_FOR_CHATGPT

> Repository: `FlapPearLabs/zhihu-grabber-toolkit`
> Role: ZHIHU CLI PRO — TRACK B D2 GOLD BUILDER + RERUNNER
> Date: 2026-08-27
> Prior: TRACK_B_PILOT_HARNESS = PASS · ADJUDICATION_PACKET_V2_2 = PASS · SOURCE_LEVEL_SEMANTIC_GOLD_ADJUDICATION = COMPLETE
> THIS ROUND: mechanical D1→D2 conversion of ChatGPT adjudication → value_units rebuild → dataset version bump → rerun existing 8 cases → this packet → STOP.
> **No re-adjudication. No selector/metric/algorithm change. No corpus. No TARGET. No real embedding. No production code.**

```text
TARGET_STATUS         = NOT_IMPLEMENTED
REAL_EMBEDDING        = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE = NOT_READY
VERSION_ASSIGNMENT    = UNASSIGNED
D1                    = SUPERSEDED
D2                    = CREATED
```

---

## A. D2 Build

Input authority archived to `benchmark/adjudication/`:
- `TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json` (schema `zhihu-research-benchmark/semantic-gold-adjudication-v1` v1.0.0; adjudicator ChatGPT; source packet = adjudication-packet-v2.2: 75 sources / 135 case labels)
- `TRACK_B_SEMANTIC_GOLD_ADJUDICATION_REVIEW_PACKET.md` (human-readable explanation, non-authoritative)

Mechanical application (`benchmark/scripts/build-d2-gold.mjs`):
1. Field presence verified: `case_schema_decisions` (6) / `case_label_decisions` (135) / `required_provenance_final` (case-cross-lowcode) / `global_rules` (8) / `d2_instruction` (4) — all present. No `ADJUDICATION_APPLICATION_AMBIGUOUS` condition triggered.
2. Per real case: D1 gold backed up to `cases/<id>/gold.d1.json`; new `gold.json` written with `gold_version = g2-chatgpt-adjudicated`, `label_status = HUMAN_ADJUDICATED`, provenance `{adjudicated_by: ChatGPT, adjudication_status: COMPLETE, d1_status: SUPERSEDED}`.
3. `value_units` re-derived from D2 gold and written to `cases/<id>/value-units.json` (drift check in loader ensures no silent reuse of D1 units).
4. Dataset version recomputed (gold + value_units + freshness policy + corpus bytes) → new `d1-<hash>` value per case; runs tagged `dataset_version_status = D2`.
5. Synthetic cases (case-synth-dominance / case-synth-expert): NOT adjudicated — gold unchanged (FIXTURE_MECHANICAL), deterministic rerun identical to D1 (fixture stability evidence).

## B. Adjudication Application Audit

| rule | applied | evidence |
|---|---|---|
| gold_unit = case_id × source_id | case-scoped; no cross-case merge | 135 case_labels consumed per case |
| relevance gate (non-relevance labels only on relevance=true) | scored families filtered to relevance=true | VAL5: 0 irrelevant sources in must_see/expert/evidence/long_tail denominators |
| UNRESOLVED excluded num+den, never false | expert/evidence UNRESOLVED → `unresolved_sources`; historical_authority all UNRESOLVED | VAL4; gold stats show unresolved counts |
| historical_authority = UNRESOLVED (all real) | `sources: []` + all sources in unresolved list | VAL4; metric → N/A (NOT_SCORABLE) |
| schema KEEP/DROP | applied per case (see D) | VAL3 |
| claim_stances = final only | contradiction clusters rebuilt from adjudication stances; provenance never creates stance | REQ4/REQ5 (42/42 suite) |
| required provenance = `required_provenance_final` | xq1–xq4 rebuilt; xq4 = vendor-self-promotion + independent-or-countervailing-evaluation | VAL6 |
| d2_instruction | D2 created; selectors/metrics untouched; ngram proxy retained (HARNESS_SANITY_ONLY) | — |

## C. Gold Stats Before vs After (D1 provisional → D2 adjudicated)

| case | relevant D1→D2 | must_see | expert scorable (unres) | long_tail | evidence_quality (unres) | contradiction clusters | xq groups |
|---|---|---|---|---|---|---|---|
| case-439521858 | 17→**13** | 4→4 | 4→4 (9) | 5→3 | 9→1 (1) | 2→2 | 0 |
| case-477427067 | 18→**16** | 4→4 | 5→11 (5) | 5→5 | 11→6 (0) | 2→**1** | 0 |
| case-466695857 | 15→15 | 4→3 | 5→7 (8) | 6→2 | 4→4 (0) | 1→1 | 0 |
| case-485463474 | 7→**2** | 3→2 | 4→2 (0) | 3→1 | 6→1 (0) | 1→**0** | 0 |
| case-487214224 | 2→**1** | 1→1 | 1→1 (0) | 1→0 | 2→1 (0) | 0 | 0 |
| case-cross-lowcode | 74→**66** | 9→15 | 12→32 (34) | 19→11 | 39→14 (1) | 3→3 | 4→4 |

Notable: relevance gate cut irrelevant sources (esp. 485463474 7→2, 487214224 2→1, cross 74→66); ChatGPT widened expert SUPPORTED (vendor/analyst discovery) and narrowed evidence_quality (external-link presence alone insufficient).

## D. Case Schema Changes

| case | aspect | claim |
|---|---|---|
| case-477427067 | all KEEP | **c2-vendor-neutrality DROPPED_FROM_CONTRADICTION_GOLD** (VAL3: absent from clusters) |
| case-485463474 | **asp-permission KEEP**; **asp-concept DROP**, **asp-critique DROP** | **c1-innovation-vs-repackaging DROP** (clusters 1→0) |
| case-439521858 | all KEEP (asp-compare/vendor/cost/critique) | c1-yida-verdict KEEP, c2-yida-ecosystem KEEP (stance lists rebuilt from final) |
| case-466695857 | KEEP (asp-pro-source/critique/technical) | c1-source-value KEEP |
| case-487214224 | asp-business-lines KEEP | none |
| case-cross-lowcode | all 6 KEEP | 3 CONTRADICTION KEEP + 4 CROSS_QUESTION_PROVENANCE (xq4 KEEP_WITH_REVISED_PROVENANCE) |

## E. Value-Unit Rebuild

`value_units` re-derived from D2 gold per case (must_see / critical_aspect / unique_claim / required_contradiction_side / expert_source_group / evidence_source_group). VAL7: D2 unit files differ from D1-derived units for every real case; loader drift check prevents silent reuse.

## F. Test Results

- `node --test` full suite: **42/42 pass** (27 harness + 5 V2.1 + 10 V2.2). Three V2.2 tests asserting D1-specific label values were updated to D2-consistent invariants (REQ2 now uses 439521858:3376976033 must_see true/false across cases; REQ3/REQ6 moved to synthetic construction) — the model invariants they enforce are unchanged.
- `validate-d2.mjs` required validations: **10/10 PASS** (VAL1 485463474 relevant=2 · VAL2 487214224 relevant=1 · VAL3 c2 dropped · VAL4 historical_authority UNRESOLVED · VAL5 relevance gate · VAL6 xq4 revised groups · VAL7 units rebuilt · VAL8 D2 hash≠D1 · VAL9 8 cases rerun, 96 runs, all D2 · VAL10 fair budgets equal).

## G. Fair D2 Results (HARNESS_SANITY_ONLY; K_MEDIUM; 72 fair runs, all jaccard stability 1.000)

| case | strat | must | aspect | expert | long_tail | freshW | freshRel | evPres | evQual | contra | xq | semRed | div | macro | min | ops |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 439521858 | B0 | 0.750 | 0.750 | 0.750 | 0.000 | 0.000 | 0.000 | 0.333 | 0.000 | 1.000 | N/A | 0.226 | N/A | N/A | N/A | 49 |
| 439521858 | B1 | 0.750 | 0.750 | 0.250 | 0.000 | 0.000 | 0.000 | 0.333 | 1.000 | 1.000 | N/A | 0.238 | N/A | N/A | N/A | 35 |
| 439521858 | B2 | 0.500 | 0.750 | 0.500 | 0.000 | 1.000 | 1.000 | 0.444 | 0.000 | 1.000 | N/A | 0.217 | N/A | N/A | N/A | 169 |
| 477427067 | B0 | 0.750 | 1.000 | 0.273 | 0.000 | 0.000 | 0.000 | 0.500 | 0.500 | 1.000 | N/A | 0.417 | N/A | N/A | N/A | 53 |
| 477427067 | B1 | 0.250 | 1.000 | 0.273 | 0.400 | 0.500 | 0.500 | 0.200 | 0.167 | 1.000 | N/A | 0.325 | N/A | N/A | N/A | 37 |
| 477427067 | B2 | 0.500 | 1.000 | 0.364 | 0.200 | 1.000 | 1.000 | 0.400 | 0.333 | 1.000 | N/A | 0.350 | N/A | N/A | N/A | 167 |
| 466695857 | B0 | 0.667 | 1.000 | 0.571 | 0.000 | N/A | N/A | 0.750 | 0.750 | 1.000 | N/A | 0.315 | N/A | N/A | N/A | 42 |
| 466695857 | B1 | 0.667 | 1.000 | 0.429 | 0.500 | N/A | N/A | 0.250 | 0.750 | 1.000 | N/A | 0.282 | N/A | N/A | N/A | 31 |
| 466695857 | B2 | 0.333 | 1.000 | 0.571 | 0.000 | N/A | N/A | 0.750 | 0.500 | 1.000 | N/A | 0.259 | N/A | N/A | N/A | 129 |
| 485463474 | B0 | 0.500 | 1.000 | 0.500 | 0.000 | N/A | N/A | 0.667 | 1.000 | N/A | N/A | 0.341 | N/A | N/A | N/A | 15 |
| 485463474 | B1 | 1.000 | 1.000 | 1.000 | 1.000 | N/A | N/A | 0.667 | 1.000 | N/A | N/A | 0.307 | N/A | N/A | N/A | 15 |
| 485463474 | B2 | 1.000 | 1.000 | 1.000 | 1.000 | N/A | N/A | 0.667 | 1.000 | N/A | N/A | 0.307 | N/A | N/A | N/A | 84 |
| 487214224 | B0 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | N/A | 1.000 | 1.000 | N/A | N/A | 0.189 | N/A | N/A | N/A | 4 |
| 487214224 | B1 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | N/A | 1.000 | 1.000 | N/A | N/A | 0.189 | N/A | N/A | N/A | 7 |
| 487214224 | B2 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | N/A | 1.000 | 1.000 | N/A | N/A | 0.189 | N/A | N/A | N/A | 19 |
| cross-lowcode | B0 | 0.400 | 0.750 | 0.188 | 0.000 | 0.000 | 0.000 | 0.206 | 0.286 | 0.667 | 0.500 | 0.280 | 0.696 | 0.308 | 0.000 | 325 |
| cross-lowcode | B1 | 0.200 | 0.500 | 0.094 | 0.000 | 0.000 | 0.000 | 0.176 | 0.143 | 0.667 | 0.000 | 0.263 | 0.792 | 0.169 | 0.000 | 151 |
| cross-lowcode | B2 | 0.200 | 0.750 | 0.156 | 0.091 | 0.750 | 1.000 | 0.206 | 0.143 | 0.667 | 0.000 | 0.248 | 0.768 | 0.201 | 0.000 | 1703 |
| synth-dominance | B0 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.005 | 0.000 | 0.000 | 0.000 | 0.479 | **0.000** | 0.000 | 0.000 | 7544 |
| synth-dominance | B1 | 0.000 | 0.333 | 0.000 | 0.000 | 0.667 | 0.667 | 0.000 | 0.000 | 0.000 | 0.000 | 0.640 | **0.000** | 0.167 | 0.000 | 2161 |
| synth-dominance | B2 | 0.167 | 1.000 | 0.600 | 0.000 | 0.267 | 0.267 | 0.024 | 0.600 | 1.000 | 1.000 | 0.279 | 0.960 | 0.667 | 0.333 | 75889 |
| synth-expert | B0 | 0.250 | 0.500 | 0.000 | 0.000 | N/A | N/A | 0.000 | 0.000 | N/A | N/A | 0.481 | N/A | N/A | N/A | 149 |
| synth-expert | B1 | 0.375 | 0.500 | 0.500 | 0.400 | N/A | N/A | 0.250 | 0.250 | N/A | N/A | 0.566 | N/A | N/A | N/A | 81 |
| synth-expert | B2 | 0.250 | 0.500 | 0.300 | 0.200 | N/A | N/A | 0.200 | 0.200 | N/A | N/A | 0.153 | N/A | N/A | N/A | 443 |

`historical_authority_retention` = N/A on all real cases (adjudicated UNRESOLVED → NOT_SCORABLE; no D1 gold retained). `false_stop_rate` = NOT_RUN (no Tier-3 fixture). Oracle (24 runs) excluded from fair comparison (audit 24/24 + 72/72 OK).

## H. Cross-Question D2 Results (case-cross-lowcode, K_MEDIUM)

| strategy | largest_share | per-question selection | xq_recall (4 claims) | macro | min | diversity |
|---|---|---|---|---|---|---|
| B0 | 0.600 | {439521858:6, 477427067:2, 466695857:1, 485463474:1} | **0.500** (2/4) | 0.308 | 0.000 | 0.696 |
| B1 | 0.400 | {439521858:4, 462973596:3, 477427067:3} | 0.000 | 0.169 | 0.000 | 0.792 |
| B2 | 0.500 | {439521858:5, 477427067:3, 462973596:1, 466695857:1} | 0.000 | 0.201 | 0.000 | 0.768 |

With adjudicated provenance, B0 reaches 2/4 cross-question claims at K=10 (xq1 framework + xq2 debate) while B1/B2 cover 0 — semantic Top-K/MMR concentrate on the best-matching question and miss required provenance groups. Smallest question (487214224, 1 relevant source) still never selected at K_MEDIUM (min=0.000 for all) — per-question constraints remain a TARGET design input, unchanged from D1.

## I. B0 vs B1 vs B2 Findings (D2, fair, K_MEDIUM)

1. **Distinction preserved**: synth-dominance remains the sharpest separator (diversity 0/0/0.960; expert 0/0/0.600; contradiction 0/0/1.000; xq 0/0/1.000). Real cases show moderate, adjudicated-gold-consistent differences (e.g. 439521858 expert B0 0.750 vs B1 0.250; 485463474 B1/B2 must_see 1.000 vs B0 0.500).
2. **B2 vs B1 still NOT superior on real gold**: B2 lowers semantic_redundancy on 5/8 cases (synth −0.36/−0.41, real ≈ −0.02) and sometimes lifts expert recall (+0.25 / +0.09 / +0.14 / +0.06), but must_see is equal-or-worse on real cases (439521858 −0.25, 466695857 −0.33) and B2 costs 4–35× B1. **No evidence B2 ≥ B1** — same conclusion as D1.
3. Small-case saturation (485463474 relevant=2, 487214224 relevant=1): at K≥pool, recall saturates → those cases no longer discriminate (documented blind spot).
4. B0's popularity still protects must_see on verified cases (0.750/0.750/0.667) — popularity ≠ quality but anchors mainstream coverage.

## J. Cost / Stability

- Stability: all 72 fair runs deterministic → jaccard mean = min = 1.000.
- `relative_compute_ops` (not production cost): B0 ≈ 4–7544 (sort), B1 ≈ 7–2161, B2 ≈ 19–75889 (2–35× B1). wall_clock_ms / embedding_calls / pairwise_similarity_calls retained per run.
- Synthetic fixtures unchanged → identical results across D1/D2 (fixture determinism).

## K. Changed Conclusions vs D1

| item | D1 (provisional gold) | D2 (adjudicated gold) | change |
|---|---|---|---|
| Benchmark distinguishes B0/B1/B2 | yes | **yes (stronger denominators)** | held |
| B2 ≥ B1 | not established | **not established** | held (must_see worse, cost higher) |
| historical_authority | provisional recall | **NOT_SCORABLE (UNRESOLVED)** | removed from scoring |
| evidence_quality | inflated denominator (9–39) | tight (1–14) after adjudication | major tightening |
| expert SUPPORTED | narrow (4–12) | broad (4–32 incl. vendor/analyst discovery) | widened |
| 485463474 / 487214224 | noisy 7/2 relevant | clean 2/1 relevant | saturation blind spot surfaced |
| cross-question xq recall (B0, K=10) | 0.250 | 0.500 (2/4 with revised groups) | improved via adjudicated provenance |
| freshness | thin (365d window) | same window; off-topic fresh excluded | unchanged blind spot |
| cost | B2 2–35× B1 | same | unchanged |

## L. Remaining Unknowns

1. Real embedding runtime — B1/B2 remain ngram proxy; all results HARNESS_SANITY_ONLY (P1-1 gate not yet authorized).
2. Tier-3 adaptive stopping — false_stop_rate NOT_RUN.
3. Freshness data scarcity — 3/5 real single-question cases have no fresh content.
4. Author identity — name-only (WEAK); expert gold now adjudicated but strict unique-author attribution still impossible.
5. B2 cost scaling — naive O(K²N) MMR; incremental-MMR needed before production.
6. Small-case saturation — recall saturates when K ≥ relevant pool (design question for budget selection).
7. Per-question coverage preservation — none of the three strategies protects the smallest question at K_MEDIUM (needs explicit constraints in TARGET design).

## M. Evidence-Backed Verdict

```text
VERDICT: D2_PILOT_PARTIAL
```

Evidence for PASS-side: adjudication applied mechanically with zero ambiguity (no ADJUDICATION_APPLICATION_AMBIGUOUS); all 10 required validations PASS; 42/42 tests; 96 runs rerun cleanly as D2; D1 core conclusions reproduce under FINAL gold (strategies distinguishable; B2 not superior; cost gap real).

Evidence against full PASS: (1) **B2 ≥ B1 remains unproven** on adjudicated gold — must_see equal-or-worse, 4–35× cost; (2) all results remain HARNESS_SANITY_ONLY because real embedding is still not authorized/implemented; (3) fresh Tier-3 (false_stop_rate) absent; (4) small-case saturation and per-question coverage gaps are unresolved benchmark design issues. No FAIL condition triggered (no unresolvable adjudication, no validation failure, no collapsed conclusions).

Next step (propose only, NOT executed): hold here — do not enter production development; assemble the complete evidence/design/history pack (D1+D2 runs, adjudication, harness) and hand to Claude for one independent external review, as agreed.

---

## Status

```text
TARGET_STATUS         = NOT_IMPLEMENTED
REAL_EMBEDDING        = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE = NOT_READY
VERSION_ASSIGNMENT    = UNASSIGNED
D1                    = SUPERSEDED
D2                    = CREATED
HANDOFF_COMPLETE      = YES
```
