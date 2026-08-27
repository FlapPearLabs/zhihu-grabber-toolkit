# Track B final metric/gold contract crosswalk

STATUS: RECONSTRUCTED_CROSSWALK — NOT PRIMARY AUTHORITY
PURPOSE: bridge the recovered original Benchmark Design + first Metric/Gold Correction to the final harness contract after later review deltas.

Primary backing files in this directory:

1. `TRACK_B_BENCHMARK_DESIGN_REVIEW_PACKET_FOR_CHATGPT.md`
2. `TRACK_B_METRIC_GOLD_CORRECTION_PACKET_FOR_CHATGPT.md`
3. `TRACK_B_PILOT_CORRECTION_PACKET_FOR_CHATGPT.md`

Final contract deltas evidenced by #3 and executable tests include:

- minority macro/min = non-largest scorable reference questions; one reference question → N/A;
- normalized question diversity Q = number of scorable reference questions;
- aspect recall = binary aspect coverage, one selected primary-support source is enough;
- per-question coverage consumes explicit `value_units`, not raw answer counts;
- Evidence Presence is mechanical, Evidence Quality semantic/adjudicated;
- freshness window membership is mechanical, Fresh-content requires relevance;
- semantic/claim redundancy orientation: high = more redundant;
- disputed/unresolved units excluded from numerator and denominator;
- strategy features must be separated from evaluation Gold; oracle is diagnostic-only;
- n-gram B1/B2 are proxies, not real semantic baselines;
- cost is `relative_compute_ops`, not production/provider cost.

Why reconstructed: the standalone later review message that produced every final delta was not recovered as a primary file during self-audit. The final implemented/tests contract is available, so this crosswalk allows audit without pretending a missing document exists.
