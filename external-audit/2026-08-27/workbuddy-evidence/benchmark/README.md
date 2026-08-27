# Research Coverage Benchmark — Pilot (Track B, CORRECTED)

> **STATUS: PILOT (CORRECTED D1).** Benchmark-only. No production code touched. No TARGET implemented.
> **VERSION_ASSIGNMENT: UNASSIGNED.** **IMPLEMENTATION_AUTHORIZATION: BENCHMARK_PILOT_ONLY.**
> **Review gate: TRACK_B_PILOT_CORRECTION_PACKET_FOR_CHATGPT (CHANGES_REQUESTED closed round).**
> **D2 = NOT_CREATED.** D2 is created only after ChatGPT source-level adjudication.

## 1. Correction round summary (ChatGPT CHANGES_REQUESTED → closed)

| P0/P1 | fix | status |
|---|---|---|
| P0-1 | B2 fair selector no longer reads evaluation gold; `B2_MMR_NGRAM_PROXY` uses mechanical lanes (mainstream / evidence PRESENCE / fresh window / long-tail proxy); expert+contradictory lanes EMPTY (no independent signal, not fabricated). Gold-lane selector kept as `B2_ORACLE_LANES` = UPPER_BOUND_DIAGNOSTIC_ONLY, excluded from fair comparison (24/24 runs flagged). | DONE |
| P0-2 | value_units[] derived from gold (`lib/value-units.mjs`), frozen per case (`cases/<id>/value-units.json`), included in dataset version. per_question_coverage = covered scorable value units / all scorable value units. unit types: must_see / critical_aspect / unique_claim / required_contradiction_side / expert_source_group / evidence_source_group. | DONE |
| P0-3 | minority macro/min computed over NON-LARGEST scorable reference questions (largest by frozen reference pool size, not selection). Single scorable question → N/A. Legacy wrong test (0.5) fixed to 0. | DONE |
| P0-4 | normalized_question_diversity Q = # scorable reference questions (not selected count). 3 ref Q all from Q1 → 0 (not N/A). Q<=1 → N/A. | DONE |
| P0-5 | aspect_recall = # aspects with ≥1 selected primary supporting source / # scorable aspects (1/n increments). Old metric renamed `aspect_source_recall_diagnostic`. | DONE |
| P0-6 | evidence_presence (MECHANICAL, computed from corpus markers) ≠ evidence_quality (PROVISIONAL). fresh_window_membership_recall (MECHANICAL) ≠ fresh_content_recall (PROVISIONAL; fresh-RELEVANT only; off-topic fresh source never FINAL). | DONE |
| P0-7 | adjudication-packet-v2.json: per-source source_id / question_id / question_title / content_excerpt / author_display / author_identity_confidence + proposed semantic labels + expertise_evidence + claim stances w/ excerpt; cross-question provenance lists explicit source_ids; NO voteupCount/commentCount (separate mechanical metadata file). | DONE |
| P1-1 | n-gram proxy renamed `B1_LEXICAL_NGRAM_PROXY` / `B2_MMR_NGRAM_PROXY`; all current results = HARNESS_SANITY_ONLY. Real `B1_SEMANTIC_TOP_K` / `B2_MMR_MULTI_LANE` require a real embedding adapter before becoming true baselines. | DONE |
| P1-2 | `cost_units` → `relative_compute_ops`; wall_clock_ms / embedding_calls / pairwise_similarity_calls retained; NOT production cost. | DONE |

## 2. Layout

```text
benchmark/
  README.md
  corpus/                 frozen corpus snapshot + manifest.json (SHA-256)
  cases/                  per-case case.json + gold.json + value-units.json (derived, frozen)
  fixtures/               synthetic fixture generators (dominance / expert)
  lib/                    harness (selectors with mechanical/oracle lanes, metrics corrected,
                          value-units, case-loader, embeddings proxy, results, adjudication-v2, ...)
  scripts/                run-pilot / analyze-results / adjudication-packet-v2 / leak-check / ...
  tests/                  benchmark-only unit tests (27; includes 10 required new tests)
  results/
    runs/                 96 run results (72 fair + 24 oracle)
    runs-legacy-d1/       47 superseded D1 runs (historical evidence)
    summary.json          condensed table
    adjudication-packet-v2.json            (P0-7; source-level proposals)
    adjudication-mechanical-metadata.json  (vote/comment/etc. kept out of adjudication view)
```

## 3. Cases (8 — unchanged; no new corpus)

Same 8 cases as round 1 (5 real single-question, 1 cross-question, 2 synthetic).
Semantic gold remains PROVISIONAL (real) / FIXTURE_MECHANICAL (synthetic). D2 not created.

## 4. Strategies

- FAIR (no gold): `B0_POPULARITY_TOP_K`, `B1_LEXICAL_NGRAM_PROXY`, `B2_MMR_NGRAM_PROXY` (mechanical lanes).
- DIAGNOSTIC: `B2_ORACLE_LANES` (gold lanes; UPPER_BOUND; excluded_from_fair_comparison=true).
- All results: `result_status = HARNESS_SANITY_ONLY` (ngram proxy ≠ frozen Dense Embedding).

## 5. How to run (node >= 22)

```bash
node benchmark/scripts/sync-corpus.mjs          # one-time corpus snapshot (SRC_REPO env for source path)
node benchmark/fixtures/build-synthetic.mjs     # regenerate synthetic fixtures + gold
node --test benchmark/tests/benchmark.test.mjs  # 27 unit tests (10 required new)
node benchmark/scripts/run-pilot.mjs            # corrected D1 run -> results/runs + summary
node benchmark/scripts/adjudication-packet-v2.mjs  # P0-7 source-level packet
node benchmark/scripts/analyze-results.mjs      # condensed tables
node benchmark/scripts/leak-check.mjs           # credential / private-path check
```

## 6. Boundary / non-goals

- No production behavior modified; no TARGET; no vector DB; no new scraping; D2 not created.
- Results contain no credentials / cookies / secrets / absolute private paths (leak-check enforced, 148 files).
- No FINAL benchmark winner claims; real semantic metrics PROVISIONAL until source-level adjudication.
