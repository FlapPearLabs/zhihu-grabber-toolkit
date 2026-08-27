# TRACK_B_PILOT_CORRECTION_PACKET_FOR_CHATGPT

> Repository: `FlapPearLabs/zhihu-grabber-toolkit`
> Role: ZHIHU CLI PRO — TRACK B BENCHMARK PILOT BUILDER
> Date: 2026-08-27
> Round: **PILOT HARNESS CORRECTION + ADJUDICATION PACKET V2** (closes ChatGPT CHANGES_REQUESTED, 7×P0 + 2×P1 + 10 required tests)
> Previous: TRACK_B_PILOT_REVIEW_PACKET_FOR_CHATGPT (round 1, verdict PILOT_PARTIAL)
> THIS TURN: harness correction ONLY. No new corpus. No TARGET. No Architecture Spec. No product version. No production code.

```text
TARGET_STATUS        = NOT_IMPLEMENTED
SEMANTIC_GOLD        = PROVISIONAL
D2                   = NOT_CREATED
SPEC_PREPARATION_GATE= NOT_READY
VERSION_ASSIGNMENT   = UNASSIGNED
CURRENT_REMOTE_SHA   = 84534f539a03937b031a962b828f2e2d44c102fa (unchanged; no repo writes this round)
```

---

## A. Corrected Files (all under the isolated `benchmark/` workspace; production untouched)

| File | Change |
|---|---|
| `lib/selectors.mjs` | P0-1: `assignMechanicalLanes(pool, caseCfg)` — NO gold access; lane kinds = mechanical / mechanical_presence / mechanical_window / mechanical_proxy; expert + contradictory = `NO_INDEPENDENT_SIGNAL_EMPTY` (not fabricated). `assignOracleLanes(pool, caseCfg, gold)` kept as oracle (gold lanes). Renamed `selectLexicalNgramTopK` (P1-1). |
| `lib/metrics.mjs` | P0-2/3/4/5/6 + P1-2: value-unit-based per-question coverage; minority macro/min over non-largest scorable reference questions; diversity Q = #scorable reference questions; aspect_recall aspect-level (+ `aspect_source_recall_diagnostic`); evidence_presence (MECHANICAL) vs evidence_quality (PROVISIONAL); fresh_window_membership (MECHANICAL) vs fresh_content (PROVISIONAL); `relative_compute_ops` cost. |
| `lib/value-units.mjs` | NEW (P0-2): derive value_units from gold families; unit types must_see/critical_aspect/unique_claim/required_contradiction_side/expert_source_group/evidence_source_group; case-level group units (question_id=null) not double-counted. |
| `lib/case-loader.mjs` | value_units derived at load, frozen to `cases/<id>/value-units.json`, included in dataset version hash + freeze snapshot (gold/value_units/freshness/dataset). Drift detection (loader refuses stale derived file). |
| `lib/gold-stats.mjs` | handles fresh_relevant_sources + `_value_units` stats by type. |
| `lib/adjudication-v2.mjs` | NEW (P0-7): source-level adjudication builder (excerpts, labels, expertise_evidence, claim stances, explicit cross-question provenance; no popularity fields). |
| `lib/runtime.mjs` | selector identity renamed (P1-1) + oracle entry. |
| `scripts/run-pilot.mjs` | fair set = B0/B1_LEXICAL_NGRAM_PROXY/B2_MMR_NGRAM_PROXY; oracle = B2_ORACLE_LANES (excluded_from_fair_comparison=true); result_status=HARNESS_SANITY_ONLY; D1_CORRECTED. |
| `scripts/adjudication-packet-v2.mjs` | NEW (P0-7): writes `adjudication-packet-v2.json` + `adjudication-mechanical-metadata.json`. |
| `scripts/analyze-results.mjs` | corrected metric columns + oracle audit. |
| `cases/<id>/gold.json` (6 real) | evidence_quality → PROVISIONAL; freshness → `fresh_relevant_sources` (PROVISIONAL); off-topic noise source excluded from fresh-relevant (P0-6). |
| `fixtures/build-synthetic.mjs` | same freshness schema (FIXTURE_MECHANICAL), evidence_presence note. |
| `tests/benchmark.test.mjs` | fixed wrong minority test; +10 required tests (27 total). |
| `README.md` | correction summary. |

---

## B. Tests (27/27 pass — `node --test benchmark/tests/benchmark.test.mjs`)

All 10 required tests present and green:

1. **REQ1 selector cannot consume evaluation gold** — mechanical lane assignment runs with a throwing-gold Proxy; never touches gold; expert/contradictory lanes stay empty.
2. **REQ2 single-question minority = N/A** — 1 scorable reference question → macro/min N/A.
3. **REQ3 largest+minority gives macro 0** — Q1 (largest, coverage 1) excluded; Q2 (minority, coverage 0) → macro=0, min=0 (was wrongly 0.5 before).
4. **REQ4 3 ref Q all from one Q → diversity 0** — Q=3 scorable reference questions; selection only in Q1 → 0 (not N/A).
5. **REQ5 aspect recall 4 aspects → increments of .25** — 2/4 covered = 0.5; full = 1.0.
6. **REQ6 value_units not raw relevance source count** — relevance lists 3 sources but only 1 question-scoped unit; selecting the non-unit source → coverage 0.
7. **REQ7 evidence presence ≠ evidence quality** — presence (mechanical markers) = 0.0 vs quality (semantic gold) = 1.0 on same selection.
8. **REQ8 fresh off-topic source not FINAL fresh relevant** — window membership 1.0 (mechanical), fresh_content_recall N/A (no relevant gold).
9. **REQ9 adjudication packet V2 contains source_id + excerpt** — asserts question_title, content_excerpt, proposed labels, and NO voteupCount/commentCount.
10. **REQ10 oracle lanes excluded from fair comparison** — oracle assignment reads gold (allowed, diagnostic); runner contract excludes B2_ORACLE_LANES from fair set; 24/24 oracle runs flagged `excluded_from_fair_comparison=true` (audit below).

Plus corrected legacy tests (redundancy bounds, |S|<2→N/A, disputed exclusion, omitted-question→0, freeze, budget equality, tie-breaks, sanitizer, P1-2 cost label).

---

## C. Leakage Removal Proof (P0-1)

- Fair-comparison B2 (`B2_MMR_NGRAM_PROXY`) never receives a gold object: `assignMechanicalLanes(pool, caseCfg)` signature has no gold parameter; `selectMMRMultiLane` receives only injected lanes.
- Unit test REQ1 proves a throwing-gold Proxy is never touched.
- Per-run audit (case-cross-lowcode K_MEDIUM): `lane_kinds = {mainstream:mechanical, evidence_rich:mechanical_presence, fresh:mechanical_window, long_tail:mechanical_proxy, expert:NO_INDEPENDENT_SIGNAL_EMPTY, contradictory:NO_INDEPENDENT_SIGNAL_EMPTY}` — no gold-derived lane.
- Oracle selector (`B2_ORACLE_LANES`) reads gold by design; its 24 runs are flagged `strategy_config.excluded_from_fair_comparison = true` and `strategy_class = ORACLE_UPPER_BOUND_DIAGNOSTIC_ONLY`; analysis and summary keep fair (72) and oracle (24) strictly separate. Audit: oracle=24/24 flagged; fair=72/72 not flagged.
- STRATEGY_FEATURES (mechanical metadata / deterministic heuristics) and EVALUATION_GOLD are now separate code paths.

---

## D. Metric Correction Proof

- **P0-2 value_units**: derived per case (e.g. case-439521858 → 19 units: 4 must_see + 4 critical_aspect + 5 unique_claim + 4 required_contradiction_side + 1 expert_source_group + 1 evidence_source_group); per_question_coverage now uses covered scorable units / all scorable units (REQ6).
- **P0-3 minority**: largest reference question = max frozen pool size among scorable reference questions. Cross case (sizes 17/18/15/15/7/3): largest = 477427067 (18) excluded; macro over the other 5. Synth-dominance B0: macro=0.000, min=0.000 (both minority questions crushed — correct detection); B2: macro=0.667, min=0.333. Single-question real cases → N/A (by contract).
- **P0-4 diversity**: synth-dominance Q=3 scorable reference questions → B0 div=0.000 (all from Q1), B1 div=0.000 (all from Q3), B2 div=0.960. Previously these were N/A. Cross case div=0.696–0.792 (Q=6). Q<=1 → N/A (REQ2/REQ4).
- **P0-5 aspect_recall**: 4-aspect cases now only take 0/0.25/0.5/0.75/1 (case-439521858: 0.750; case-477427067: 1.000). Synth-dominance (3 aspects): B0=0.000, B1=0.333, B2=1.000. `aspect_source_recall_diagnostic` reported separately.
- **P0-6 evidence/freshness**: `evidence_presence_recall` (MECHANICAL_CONFIRMED) vs `evidence_rich_recall` (PROVISIONAL) split; `fresh_window_membership_recall` (MECHANICAL) vs `fresh_content_recall` (PROVISIONAL, fresh-RELEVANT only). case-487214224: fresh window membership 1.0 but fresh_content N/A (the only fresh member is the off-topic noise source — never FINAL fresh relevant). Cross case: B2 freshW=0.750, freshRel=1.000 and NOISE_SELECTED=false at K_MEDIUM.

---

## E. Corrected 8-case D1 Sanity Results (HARNESS_SANITY_ONLY; fair set; K_MEDIUM)

| case | strategy | must | aspect | expert | long_tail | freshW | freshRel | evPres | evQual | contra | xq | semRed | claimRed | div | macro | min | ops |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 439521858 | B0 | 1.000 | 0.750 | 0.500 | 0.000 | 0.000 | 0.000 | 0.333 | 0.333 | 0.500 | N/A | 0.226 | 0.600 | N/A | N/A | N/A | 49 |
| 439521858 | B1 | 0.500 | 0.750 | 0.250 | 0.000 | 0.000 | 0.000 | 0.333 | 0.333 | 1.000 | N/A | 0.238 | 0.100 | N/A | N/A | N/A | 35 |
| 439521858 | B2 | 0.500 | 0.750 | 0.250 | 0.200 | 1.000 | 1.000 | 0.444 | 0.444 | 0.500 | N/A | 0.217 | 0.300 | N/A | N/A | N/A | 169 |
| 477427067 | B0 | 0.750 | 1.000 | 0.600 | 0.000 | 0.000 | 0.000 | 0.500 | 0.455 | 1.000 | N/A | 0.417 | 0.000 | N/A | N/A | N/A | 53 |
| 477427067 | B1 | 0.500 | 1.000 | 0.200 | 0.400 | 0.500 | 0.000 | 0.200 | 0.182 | 1.000 | N/A | 0.325 | 0.100 | N/A | N/A | N/A | 37 |
| 477427067 | B2 | 0.500 | 1.000 | 0.400 | 0.200 | 1.000 | 1.000 | 0.400 | 0.364 | 1.000 | N/A | 0.350 | 0.100 | N/A | N/A | N/A | 167 |
| 466695857 | B0 | 0.750 | 1.000 | 0.600 | 0.167 | N/A | N/A | 0.750 | 0.750 | 1.000 | N/A | 0.315 | 0.300 | N/A | N/A | N/A | 42 |
| 466695857 | B1 | 0.250 | 1.000 | 0.000 | 0.333 | N/A | N/A | 0.250 | 0.250 | 1.000 | N/A | 0.282 | 0.300 | N/A | N/A | N/A | 31 |
| 466695857 | B2 | 0.500 | 1.000 | 0.400 | 0.333 | N/A | N/A | 0.750 | 0.750 | 1.000 | N/A | 0.259 | 0.600 | N/A | N/A | N/A | 129 |
| 485463474 | B0 | 0.333 | 1.000 | 0.500 | 0.667 | N/A | N/A | 0.667 | 0.667 | 1.000 | N/A | 0.341 | 0.100 | N/A | N/A | N/A | 15 |
| 485463474 | B1 | 0.667 | 1.000 | 0.750 | 1.000 | N/A | N/A | 0.667 | 0.667 | 1.000 | N/A | 0.307 | 0.000 | N/A | N/A | N/A | 15 |
| 485463474 | B2 | 0.667 | 1.000 | 0.750 | 1.000 | N/A | N/A | 0.667 | 0.667 | 1.000 | N/A | 0.307 | 0.000 | N/A | N/A | N/A | 84 |
| 487214224 | B0 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | 1.000 | N/A | N/A | 0.189 | 0.000 | N/A | N/A | N/A | 4 |
| 487214224 | B1 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | 1.000 | N/A | N/A | 0.189 | 0.000 | N/A | N/A | N/A | 7 |
| 487214224 | B2 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | N/A | 1.000 | 1.000 | N/A | N/A | 0.189 | 0.000 | N/A | N/A | N/A | 19 |
| cross-lowcode | B0 | 0.667 | 0.667 | 0.417 | 0.000 | 0.000 | 0.000 | 0.206 | 0.179 | 0.333 | 0.250 | 0.280 | 0.133 | 0.696 | 0.224 | 0.000 | 325 |
| cross-lowcode | B1 | 0.222 | 0.667 | 0.083 | 0.000 | 0.000 | 0.000 | 0.176 | 0.154 | 0.667 | 0.000 | 0.263 | 0.022 | 0.792 | 0.180 | 0.000 | 151 |
| cross-lowcode | B2 | 0.222 | 0.500 | 0.083 | 0.105 | 0.750 | 1.000 | 0.206 | 0.179 | 0.333 | 0.000 | 0.248 | 0.022 | 0.768 | 0.150 | 0.000 | 1703 |
| synth-dominance | B0 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.005 | 0.000 | 0.000 | 0.000 | 0.479 | 0.000 | **0.000** | 0.000 | 0.000 | 7544 |
| synth-dominance | B1 | 0.000 | 0.333 | 0.000 | 0.000 | 0.667 | 0.667 | 0.000 | 0.000 | 0.000 | 0.000 | 0.640 | 0.000 | **0.000** | 0.167 | 0.000 | 2161 |
| synth-dominance | B2 | 0.167 | 1.000 | 0.600 | 0.000 | 0.267 | 0.267 | 0.024 | 0.600 | 1.000 | 1.000 | 0.279 | 0.032 | 0.960 | 0.667 | 0.333 | 75889 |
| synth-expert | B0 | 0.250 | 0.500 | 0.000 | 0.000 | N/A | N/A | 0.000 | 0.000 | N/A | N/A | 0.481 | 0.000 | N/A | N/A | N/A | 149 |
| synth-expert | B1 | 0.375 | 0.500 | 0.500 | 0.400 | N/A | N/A | 0.250 | 0.250 | N/A | N/A | 0.566 | 0.000 | N/A | N/A | N/A | 81 |
| synth-expert | B2 | 0.250 | 0.500 | 0.300 | 0.200 | N/A | N/A | 0.200 | 0.200 | N/A | N/A | 0.153 | 0.000 | N/A | N/A | N/A | 443 |

Notes: `analysis_coverage` = K/|verified pool| for all strategies (low-information in closed pool, unchanged). `false_stop_rate` = NOT_RUN. Oracle rows (24) are NOT in this table — they are UPPER_BOUND_DIAGNOSTIC_ONLY (expert_recall up to 1.000 on synth-dominance; contradiction 1.000 on most cases) and must not be used for fair comparison. All 72 fair runs: jaccard stability mean=min=1.000 (deterministic). `relative_compute_ops` includes fractional selection_ops for B0 (log factor) — informational only.

Post-correction observations (HARNESS_SANITY_ONLY, not final):
- B0/B1/B2 remain clearly distinguished on synth-dominance (diversity 0/0/0.960; expert 0/0/0.600; contradiction 0/0/1.000; xq 0/0/1.000).
- B2's mechanical lanes now preserve expert content on synth-dominance via the evidence-PRESENCE lane (expert fixture sources carry links) — a mechanical, gold-free path.
- B2 lowers semantic_redundancy vs B1 on 5/8 cases (synth: −0.36/−0.41), at 2–35× compute ops (worst 75889 on the 1080-pool).
- Real cases: B2 ≈ B1 on must_see; B2 helps fresh window coverage (439521858/477427067 freshW 1.0 vs B1 0.0/0.5) but expert/long-tail gains are mixed → **B2 superiority still not established on real semantic gold**.

---

## F. Adjudication Packet V2 Summary (P0-7)

- `benchmark/results/adjudication-packet-v2.json`: **75 real sources** (deduplicated across the 6 real cases; synthetic fixtures excluded — FIXTURE_MECHANICAL needs no adjudication) + **4 cross-question provenance claims** with explicit source_ids (never "sources: 2").
- Each source entry: `source_id`, `question_id`, `question_title`, `content_excerpt` (≤300 chars), `author_display`, `author_identity_confidence`, and `proposed_semantic_labels` = { relevance, must_see, aspect_ids[], expert_topic_match + expertise_evidence (vendor_or_official / practitioner_or_independent / unknown_author_class), long_tail_unique, claim_stances[] (claim_id, stance, relevant_excerpt ≤120 chars), historical_authority, evidence_quality }.
- **Popularity bias control**: voteupCount / commentCount are NOT in the adjudication view; they live in `benchmark/results/adjudication-mechanical-metadata.json` (75 sources) for consult-on-demand.
- Adjudicator action per source: CONFIRM / REVISE / REJECT each proposed label. After adjudication, gold rebuild as D2 (dataset version bump) and re-run all strategies per the freeze contract.

---

## G. Remaining Unknowns

1. **Semantic gold adjudication** — no human/ChatGPT FINAL gold yet; all real-case semantic metrics PROVISIONAL (unchanged; D2 NOT created).
2. **Real embedding runtime** — B1/B2 still run the deterministic n-gram proxy (HARNESS_SANITY_ONLY). A minimal real embedding adapter + cache is required before `B1_SEMANTIC_TOP_K` / `B2_MMR_MULTI_LANE` become true baselines (P1-1).
3. **Freshness evidence scarcity** — 3/5 real single-question cases have no fresh content (freshW/freshRel N/A); only the cross case and synth-dominance exercise freshness meaningfully.
4. **Author identity** — canonical schema has no author id (name-only, WEAK); expert gold tentative; strict unique-author attribution impossible without a stable key.
5. **Dispute handling** — disputed labels are unit-tested but not exercised on real gold (dispute rate 0).
6. **Tier 3 / adaptive stopping** — false_stop_rate NOT_RUN (no batch fixture).
7. **Retrieval cost** — fixed pools only; live multi-query retrieval cost outside this pilot.
8. **B2 cost scaling** — naive greedy MMR is O(K²N) (75889 ops on 1080-pool); needs incremental-MMR before any production consideration.

---

## Status & Next Step (propose only)

```text
VERDICT (this round) = CHANGES_REQUESTED → corrections submitted
TARGET_STATUS        = NOT_IMPLEMENTED
SEMANTIC_GOLD        = PROVISIONAL
D2                   = NOT_CREATED
SPEC_PREPARATION_GATE= NOT_READY
VERSION_ASSIGNMENT   = UNASSIGNED
```

Proposed next step (NOT executed): ChatGPT reviews this packet; if accepted, proceed to **source-level adjudication** on `adjudication-packet-v2.json`; after adjudication, rebuild gold as D2 and re-run all strategies (freeze contract), then reassess B2 vs B1 and TARGET authorization.

```text
HANDOFF_COMPLETE = YES (copy-paste ready for ChatGPT)
```
