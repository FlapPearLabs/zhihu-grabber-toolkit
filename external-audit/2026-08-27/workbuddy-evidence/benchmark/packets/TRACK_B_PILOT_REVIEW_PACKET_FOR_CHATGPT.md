# TRACK_B_PILOT_REVIEW_PACKET_FOR_CHATGPT

> Repository: `FlapPearLabs/zhihu-grabber-toolkit`
> Role: ZHIHU CLI PRO — TRACK B BENCHMARK PILOT BUILDER
> Date: 2026-08-27
> Prior gates: TRACK_A_GATE = PASSED; TRACK_B_DESIGN_GATE = PASSED
> THIS TURN AUTHORIZATION: **BENCHMARK PILOT IMPLEMENTATION ONLY**
> VERSION_ASSIGNMENT = UNASSIGNED · TARGET_STATUS = NOT_IMPLEMENTED · TARGET_RESULT = NOT_RUN
> PRODUCTION_RCE / PROVIDER_REFACTOR / SCHEMA_MIGRATION / ARCHITECTURE_SPEC / PRODUCT_VERSION / PRODUCTION_MERGE: **NOT AUTHORIZED — not executed**

---

## A. Environment / Base

```text
CURRENT_REMOTE_SHA   = 84534f539a03937b031a962b828f2e2d44c102fa  (git ls-remote origin refs/heads/master, live)
LOCAL_HEAD           = c9ff7b045737c2eddd4a5799702d720ade844a6d  (stale local worktree, NOT used)
WORKTREE_STATE       = ABNORMAL: 44 tracked files physically missing in the original worktree
                       (status shows 44 ' D'); index tree == HEAD tree; files recoverable from object store.
                       NOT touched: no checkout/restore/reset/clean; 2 untracked files (disk-space.txt,
                       node-ver.txt) left untouched.
PILOT WORKSPACE      = isolated temp workspace <repo>-benchmark-pilot/, materialized from
                       CURRENT_REMOTE_SHA via `git archive` (zero ref writes, avoids known git-ref defect)
FILES CHANGED        = ALL changes confined to <isolated-workspace>/benchmark/** (new files only)
PRODUCTION CHANGED   = NONE (zhihu-answer-grabber/ , corpus-anthology/ , research-orchestration/ ,
                       test/ , docs/ , AGENTS.md , RULES.md all untouched)
VERIFIED BY          = git archive at exact remote SHA + leak-check (74 result JSONs: no credentials /
                       secrets / tokens / absolute private paths)
```

Worktree safety handling followed repo Level-0 governance: the broken worktree was **not** silently
restored; a clean isolated workspace at CURRENT_REMOTE_SHA was used instead.

---

## B. Pilot Harness

Implemented components (all under `benchmark/`):

| Component | File | Purpose |
|---|---|---|
| Case/fixture loader | `lib/case-loader.mjs`, `lib/corpus.mjs` | case metadata, reference pool, labels, dataset version (SHA-256 of corpus+gold+freshness policy), freeze snapshots |
| Selectors | `lib/selectors.mjs` | B0_POPULARITY_TOP_K, B1_SEMANTIC_TOP_K, B2_MMR_MULTI_LANE (no TARGET) |
| Metric evaluator | `lib/metrics.mjs` | all 21 approved metrics + jaccard stability |
| Result writer | `lib/results.mjs` | machine-readable JSON + sanitizer |
| Embedding adapter | `lib/embeddings.mjs` | benchmark-local deterministic char n-gram TF proxy + cache |
| Gold stats | `lib/gold-stats.mjs` | scorable/unresolved/disputed per family (10 families) |
| Runner | `scripts/run-pilot.mjs` | 8 cases × 3 strategies × 3 budgets × 3 stability runs = 72 runs |
| Stage B packet | `scripts/adjudication-packet.mjs` | PROVISIONAL gold proposals for human/ChatGPT |

**Test result:** `node --test benchmark/tests/benchmark.test.mjs` → **17 pass / 0 fail / 0 skip**.
Covered: semantic_redundancy bounds; claim_redundancy bounds; |S|<2→N/A; disputed excluded from
denominator; omitted question→coverage 0; minority macro doesn't hide the smallest question;
diversity Q<=1→N/A; cross-question claim requires ALL provenance groups; gold-version freeze
detects in-place mutation; freshness policy frozen before run; equal-budget enforcement;
deterministic tie-breaks; stability helper; result sanitizer.

**Benchmark-only boundary:** the harness does not import or modify any production module. The real
corpora were copied read-only into `benchmark/corpus/` with a SHA-256 manifest (2 verified via
handoff `verified: true`; 4 captured-only, `captured != verified` honored). No new scraping.
No large vector DB. No TARGET selector. No production behavior change.

---

## C. Cases (8)

| case_id | category | Q count | sources | gold status | dataset version | freshness policy |
|---|---|---|---|---|---|---|
| case-439521858 | C/A | 1 | 17 | PROVISIONAL (verified corpus) | d1-<hash> frozen | 365d before fetch (2026-08-10) |
| case-477427067 | A/F | 1 | 18 | PROVISIONAL (verified corpus) | d1-<hash> frozen | 365d before fetch (2026-08-10) |
| case-466695857 | D | 1 | 15 | PROVISIONAL (captured) | d1-<hash> frozen | 365d before fetch (2026-08-13); none fresh → N/A |
| case-485463474 | D | 1 | 7 | PROVISIONAL (captured) | d1-<hash> frozen | 365d before fetch (2026-08-13); none fresh → N/A |
| case-487214224 | D/F | 1 | 3 | PROVISIONAL (captured; 1 off-topic noise source) | d1-<hash> frozen | 365d before fetch; 1 fresh = the noise source |
| case-cross-lowcode | G (REQUIRED) | 6 | 75 | PROVISIONAL (2 verified + 4 captured) | d1-<hash> frozen | 365d before max fetch (2026-08-13) |
| case-synth-dominance | G | 3 | 1080 | FIXTURE_MECHANICAL (1000/50/30 shape) | d1-<hash> frozen | 90d before max fetch |
| case-synth-expert | H (REQUIRED) | 1 | 40 | FIXTURE_MECHANICAL (10 low-vote experts) | d1-<hash> frozen | 365d before fetch; none fresh → N/A |

Category coverage: A technical facts (439521858, 477427067, cross) · C product/business (439521858) ·
D long-tail (466695857, 485463474) · F counter-evidence (477427067, cross, synth-dominance) ·
G cross-question (cross-lowcode, synth-dominance) · H expert-sensitive (synth-expert).
E freshness is exercised where the corpus supports it (2 real cases + synth-dominance); 3 real cases
documented as freshness-N/A (corpus predates window) — a reported blind spot, not fabricated.

---

## D. Strategies

```text
B0_POPULARITY_TOP_K : sort(voteupCount DESC, source_id ASC) top-K        (deterministic, no embeddings)
B1_SEMANTIC_TOP_K   : cosine(query_embed, content_embed) top-K           (deterministic)
B2_MMR_MULTI_LANE   : MMR(relevance - lambda*maxSim) + 6-lane quotas     (deterministic)
                      lanes: mainstream / expert / evidence_rich / fresh / long_tail / contradictory
                      lane membership: mechanical (mainstream/evidence/fresh/long-tail proxy) or
                      PROVISIONAL (expert from gold, contradictory from gold claim clusters)
lambda               = 0.5 per case (pilot configuration parameter, NOT a production default)
query text           = case.research_question + all question titles (same for B1 and B2)
embedding runtime    = benchmark-local-deterministic-ngram v1.0.0 (char n-gram TF + cosine; offline,
                       deterministic, cached per content; NOT a neural embedding — honest swap point)
budgets (K)          = real single-Q: 3 / 5 / 8 ; cross-lowcode: 5 / 10 / 20 ;
                       synth-dominance: 10 / 20 / 40 ; synth-expert: 3 / 5 / 10
budget fairness      = per case: SAME pool, SAME dataset version, SAME K, SAME reference cutoff
                       across B0/B1/B2 (enforced by runner + unit test)
```

---

## E. Mechanical Results (real run table — machine source: `benchmark/results/summary.json`, 72 runs)

Verified-case snapshot (K_MEDIUM unless noted):

| case | strategy | must_see | aspect | expert | long_tail | fresh | contra | sem_red | claim_red | div | macro | min | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 439521858 | B0 | 1.000 | 0.357 | 0.500 | 0.000 | 0.000 | 0.500 | 0.226 | 0.600 | N/A | 0.294 | 0.294 | 49 |
| 439521858 | B1 | 0.500 | 0.295 | 0.250 | 0.000 | 0.000 | 1.000 | 0.238 | 0.100 | N/A | 0.294 | 0.294 | 35 |
| 439521858 | B2 | 0.250 | 0.253 | 0.500 | 0.600 | 1.000 | 0.500 | 0.246 | 0.000 | N/A | 0.294 | 0.294 | 136 |
| 477427067 | B0 | 0.750 | 0.425 | 0.600 | 0.000 | 0.000 | 1.000 | 0.417 | 0.000 | N/A | 0.278 | 0.278 | 53 |
| 477427067 | B1 | 0.500 | 0.375 | 0.200 | 0.400 | 0.000 | 1.000 | 0.325 | 0.100 | N/A | 0.278 | 0.278 | 37 |
| 477427067 | B2 | 0.500 | 0.381 | 0.200 | 0.400 | 1.000 | 1.000 | 0.310 | 0.100 | N/A | 0.278 | 0.278 | 174 |
| cross-lowcode | B0 | 0.667 | 0.178 | 0.417 | 0.000 | 0.000 | 0.333 | 0.280 | 0.133 | 0.773 | 0.112 | 0.000 | 325 |
| cross-lowcode | B1 | 0.222 | 0.109 | 0.083 | 0.000 | 0.000 | 0.667 | 0.263 | 0.022 | 0.990 | 0.100 | 0.000 | 151 |
| cross-lowcode | B2 | 0.222 | 0.149 | 0.083 | 0.158 | 0.333 | 0.667 | 0.238 | 0.022 | 0.933 | 0.100 | 0.000 | 1818 |
| synth-dominance | B0 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.479 | 0.000 | N/A | 0.007 | 0.000 | 7544 |
| synth-dominance | B1 | 0.000 | 0.222 | 0.000 | 0.000 | 0.667 | 0.000 | 0.640 | 0.000 | N/A | 0.222 | 0.000 | 2161 |
| synth-dominance | B2 | 0.083 | 0.356 | 0.800 | 0.000 | 0.267 | 1.000 | 0.278 | 0.032 | 0.982 | 0.137 | 0.005 | 63639 |
| synth-expert | B0 | 0.250 | 0.333 | 0.000 | 0.000 | N/A | N/A | 0.481 | 0.000 | N/A | 0.125 | 0.125 | 149 |
| synth-expert | B1 | 0.375 | 0.250 | 0.500 | 0.400 | N/A | N/A | 0.566 | 0.000 | N/A | 0.125 | 0.125 | 81 |
| synth-expert | B2 | 0.375 | 0.200 | 0.400 | 0.200 | N/A | N/A | 0.211 | 0.000 | N/A | 0.125 | 0.125 | 421 |

`analysis_coverage` = K / |verified pool| for every strategy in the closed-pool setup (identical across
strategies — low-information diagnostic, see §K). `false_stop_rate` = NOT_RUN (no Tier-3 batch fixture).
`historical_authority_retention` and `evidence_rich_recall` are recorded per run in the JSONs
(evidence_rich is MECHANICAL; historical_authority is PROVISIONAL).

---

## F. Semantic Gold Status

```text
case-439521858       : PROVISIONAL   (agent-proposed; adjudication pending)
case-477427067       : PROVISIONAL   (agent-proposed; adjudication pending)
case-466695857       : PROVISIONAL   (agent-proposed; adjudication pending)
case-485463474       : PROVISIONAL   (agent-proposed; adjudication pending)
case-487214224       : PROVISIONAL   (agent-proposed; adjudication pending; 1 noise source flagged)
case-cross-lowcode   : PROVISIONAL   (agent-proposed; 4 cross-question claims w/ provenance groups)
case-synth-dominance : FIXTURE_MECHANICAL (deterministic fixture ground truth; NOT human-adjudicated)
case-synth-expert    : FIXTURE_MECHANICAL (deterministic fixture ground truth; NOT human-adjudicated)
```

No FINAL human gold exists for any real case. **No metric on real cases is claimed FINAL.** Synthetic
cases are scored as FIXTURE_SANITY only (harness sanity), not FINAL. Dispute rate = 0 (no disputed
labels proposed on real data — disputed-handling is unit-tested but not exercised on real gold; see §K).

---

## G. Metric Results (strategy × case × metric)

- **FINAL_SCORABLE**: mechanical families only — freshness recall, evidence-rich recall (mechanical
  marker), semantic_redundancy (deterministic embedding proxy), analysis_coverage, question diversity,
  source concentration, independent source diversity, cost, jaccard stability. These are computed and
  auditable now.
- **PROVISIONAL**: must_see / aspect / expert / long-tail / contradiction / cross-question / claim
  redundancy / per-question coverage / minority recall (denominators come from PROVISIONAL semantic gold).
- **N/A**: cross-question recall & diversity on single-question cases (by contract); freshness on
  freshness-empty cases; false_stop_rate everywhere (NOT_RUN).
- Full per-metric values are in `benchmark/results/runs/*.json` (72 files) and `summary.json`.

---

## H. Cross-question Findings

Required case (`case-cross-lowcode`, 6 questions / 75 sources; question sizes 17/18/15/15/7/3) and
synthetic dominance fixture (1000/50/30) both present. Findings:

1. **The dominance failure mode IS detectable.** synth-dominance K_MEDIUM: B0 `largest_question_share`
   = 1.000 (all 20 from the 1000-answer question), `minority_macro` = 0.007, `min` = 0.000,
   `cross_question_claim_recall` = 0.000, `expert_recall` = 0.000. B2 reduces share to 0.400 and lifts
   expert_recall to 0.800 and contradiction to 1.000. The metric battery catches the crush that
   aggregate recall alone would hide.
2. **B1 has its own over-concentration failure mode:** on synth-dominance B1 selects all 20 from the
   single best-matching question (share 1.000, macro 0.222 but min 0.000) — semantic Top-K alone can be
   a worse-coverage baseline than popularity for cross-question research.
3. **Lane quotas protect lanes, not questions.** In the real cross case at K=10, B2 selects 0 sources
   from the 3-answer question 487214224 and 0 from 485463474 (`min` = 0.000 for all strategies).
   Even at K=20, B2's only 487214224 pick is the off-topic noise source → its per-question coverage
   stays 0.000. **Per-question coverage preservation requires explicit per-question constraints** —
   a concrete TARGET design input.
4. **Mechanical fresh lane can admit fresh-but-irrelevant content.** At K=20 the B2 fresh lane selected
   the off-topic answer (道家/道教 content in a low-code question) because it is mechanically fresh with
   1 vote; at K=10 MMR relevance kept it out. Finding: fresh lane needs a relevance gate, not just
   freshness.
5. `cross_question_claim_recall` behaves per contract: at cross K=10 all strategies score 0.000–0.250
   (provenance-group coverage is strict); B0 reaches 0.750 at K=20 only when votes spread the selection.

---

## I. Cost + Stability Findings

- **Stability: all 72 runs deterministic** → `jaccard_stability` mean = min = 1.000 everywhere
  (3 runs per cell, all C(3,2) pairs). This confirms determinism (Stable ≠ Correct — noted).
- **Cost (relative units; same machine):** B0 ≈ 4–7.5k (sort ops); B1 ≈ 31–2161 (1 embed/query +
  N embeds + N cosines); B2 ≈ 19–63639. B2 is **4–30× B1** because the naive greedy MMR recomputes
  max-similarity for every candidate at every step (O(K²N)). At pilot scale this is acceptable
  (worst 63k units on the 1080-pool); it would need incremental-MMR optimization before production.
- Embedding cache hits reduce duplicate cost across B1/B2 within a case (cache shared).

---

## J. Out-of-pool Discoveries

```text
OUT_OF_POOL_DISCOVERY = none
```

Selectors operate on a closed candidate pool (asserted per run; 0 violations). No gold bump
(D1 → D2) was triggered. NOTE: if ChatGPT/human adjudication revises any gold label, the dataset
version hash changes and the pilot must be re-run as D2 per the freeze contract.

---

## K. Benchmark Quality Findings

1. **Does the benchmark distinguish B0/B1/B2? YES.** Strongly on expert/long-tail/fresh/contradiction/
   cross-question recall, redundancy, question concentration, cost (see §E/H). The synthetic cases are
   the sharpest discriminators; the real cases show moderate, plausible differentiation.
2. **Most useful metrics:** expert_recall, long_tail_recall, fresh_content_recall,
   contradiction_claim_recall, minority_question_recall_min, per_question_coverage,
   cross_question_claim_recall, claim_redundancy, semantic_redundancy, largest_question_share, cost.
3. **Metrics without differentiation (so far):** `analysis_coverage` (identical across strategies in a
   closed pool — it measures budget share, not quality); `independent_source_diversity` (≈1.0 on real
   corpus because authors are mostly unique per source; only drops when an author repeats across lanes);
   `jaccard_stability` (always 1.0 for deterministic selectors — a determinism check, not a ranking
   metric); `normalized_question_diversity` is N/A for all single-question cases by design.
4. **Gold labeling stable?** Mechanical labels are stable and version-hashed (MECHANICAL_CONFIRMED).
   Semantic proposals are internally consistent but **unadjudicated** (PROVISIONAL); dispute rate 0 —
   disputed-label handling is only unit-tested, not exercised on real gold. Stability of construction
   is verified; stability of adjudication is a P0 unknown.
5. **Pilot cost acceptable?** Yes for harness/annotation scale (8 cases, 75 + 1080 + 40 sources;
   deterministic embedding proxy is offline and free). Retrieval cost not yet measured (no live
   retrieval in this pilot — pool is fixed). B2 compute cost is high but bounded.
6. **B2 ≥ B1? NOT established.** B2 lowers semantic_redundancy (synth: −0.36; real: −0.02) and
   improves lane/expert coverage on the synthetic dominance case (expert 0.8 vs 0.0), but on real
   verified cases at K_MEDIUM B2 does **not** improve must_see (439521858: 0.25 vs B1 0.50) and on
   synth-expert B1 beats B2 on expert_recall (0.5 vs 0.4). B2 also costs 4–30× B1. → B2 superiority is
   **not yet justified**; TARGET remains NOT_IMPLEMENTED.
7. **Benchmark defects found (self-reported):**
   - Freshness blind spot: 3/5 real cases have zero fresh sources → metric N/A on real corpus
     (corpus too old for 365d window).
   - Mechanical freshness lane admits off-topic content at large K (needs relevance gate).
   - Lane quotas do not protect small questions (needs explicit per-question constraints).
   - Small-pool saturation: when K ≥ pool size (case-487214224, 3 answers, K=3/5/8), all strategies
     select everything → metrics saturate, no discrimination at small K.
   - `analysis_coverage` is low-information in a closed-pool pilot (all strategies equal).

---

## L. Evidence-backed Decision

```text
VERDICT: PILOT_PARTIAL
```

**PASS criteria met:** harness runs end-to-end; 17/17 tests pass; freeze enforced; result contract
machine-auditable (74 JSONs, leak-check clean); B0/B1/B2 clearly differentiated on multiple metrics;
dominance failure mode detectable; cost bounded; no out-of-pool churn; no fabrication
(false_stop_rate = NOT_RUN, freshness = N/A where no data, semantic gold = PROVISIONAL).

**Not yet achieved (why not PASS):** (1) semantic gold is unadjudicated — every semantic metric on real
cases is PROVISIONAL; (2) B2's superiority over B1 is NOT demonstrated on real cases and B2 costs
4–30× B1; (3) freshness evidence on real corpus is thin (3/5 cases N/A); (4) several benchmark
defects found (§K.7) need design fixes before the benchmark is a stable production gate.
No failure condition A–G was triggered fatally; findings D/E were genuine discoveries, not metric bugs.

**Not FAIL because:** no fatal failure condition; the benchmark demonstrably discriminates strategies,
detects dominance, and surfaced real, actionable defects — exactly what a pilot should do.

---

## M. P0 Remaining Unknowns

1. **Semantic gold adjudication** — no human/ChatGPT FINAL gold for any real case; all real-case
   semantic metrics are PROVISIONAL. (Unblocked by: adjudicate `benchmark/results/adjudication-packet.json`.)
2. **Real embedding runtime** — B1/B2 used a deterministic n-gram proxy; a real embedding model may
   shift semantic_redundancy and B1/B2 ordering.
3. **Freshness data scarcity** — real corpus has few fresh sources; freshness discrimination on real
   data is only weakly evidenced.
4. **Author identity** — canonical schema has no author id (name-only, WEAK confidence); expert gold on
   real cases is tentative; strict unique-author attribution impossible without a stable key.
5. **Tier 3 / adaptive stopping** — no batch fixture; `false_stop_rate` NOT_RUN.
6. **Retrieval (pool construction) cost** — not measured (fixed pools only; live multi-query retrieval
   cost is outside this pilot).

## N. Proposed Next Step (propose only — NOT executed)

1. Submit this packet + `benchmark/results/adjudication-packet.json` to ChatGPT for:
   (a) semantic gold adjudication on the 5 real cases + cross case (confirm/revise/reject per family);
   (b) verdict on `PILOT_PARTIAL`.
2. After adjudication returns: rebuild gold as D2 (dataset version bump), re-run all strategies per the
   freeze contract, and compute FINAL_SCORABLE metrics for real cases.
3. Only after FINAL metrics: decide whether B2 (with fixes: relevance-gated fresh lane, per-question
   constraints, incremental MMR) justifies TARGET implementation — via a separate authorized ticket.
4. Do not expand to dozens/hundreds of cases, do not start TARGET/architecture/product version, do not
   merge benchmark into production — until the adjudication gate passes.

---

## Hard Stop

```text
PILOT DELIVERABLE SUBMITTED.
HANDOFF_COMPLETE = YES (this packet is copy-paste ready for ChatGPT review)
HANDED OFF TO   = ChatGPT formal review (user-mediated)
NO TARGET RCE / NO ARCHITECTURE SPEC / NO PRODUCT VERSION / NO PRODUCTION PR / NO MERGE / NO REVIEWER LOOP
```
