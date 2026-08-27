# Algorithm complexity exploration — evidence of overshoot and later contraction

PROVENANCE_CLASS: CROSS-SOURCE_DESIGN_HISTORY_EVIDENCE
AUTHORITY: HISTORY, NOT CURRENT ALGORITHM APPROVAL

## Earlier exploration

A historical algorithm evidence registry treated several advanced methods as serious candidates:

- RRF — strong baseline candidate.
- MMR — baseline.
- xQuAD — benchmark candidate.
- Submodular / Facility Location — described as a primary Research Coverage Engine candidate / high-priority benchmark.
- DPP — benchmark against MMR/Submodular.
- Active Learning — exploration-budget design input.
- Chao — saturation diagnostic only.

A historical Research Coverage design also described the problem explicitly as `SUBSET SELECTION UNDER CONSTRAINTS`, not single-document QualityScore ranking, and listed MMR / xQuAD / Submodular / DPP / explicit constraints in the experiment ladder.

## Later contraction

Later design discussion and the frozen Project Sources reduced the first baseline to a much smaller stack:

- Query / Aspect Expansion
- RRF
- Embedding + Cosine
- deterministic expertise/evidence/freshness signals
- MMR + multi-lane exploration
- simple claim/aspect clustering
- simple deterministic saturation

Advanced methods were moved to `BENCHMARK_CANDIDATE`, `FUTURE_CANDIDATE`, or `DEFERRED` rather than production requirements.

## Self-audit correction

The prior Context Pack made this evolution look too clean, as though complexity was always tightly controlled. That is hindsight bias. A more accurate history is:

`quality/value signal exploration → scalar-score rejection → subset-selection framing → substantial advanced-algorithm exploration → explicit complexity pullback → benchmark-first baseline`.

This document deliberately preserves the fact that the design process itself overshot before it converged.
