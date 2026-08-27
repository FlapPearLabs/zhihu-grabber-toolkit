# Recovered primary excerpt — 02_RESEARCH_COVERAGE_ENGINE_DESIGN.md

PROVENANCE_CLASS: RECOVERED_PRIMARY_EXCERPT  
ORIGINAL_STATUS: FROZEN_DRAFT  
ORIGINAL_STAGE: THEORY / BENCHMARK DESIGN  
CURRENT_AUTHORITY: NO  
IMPLEMENTATION_AUTHORIZATION: NONE

## Original problem definition

> Research Coverage Engine 不是 Ranking Engine.

The draft framed the task as:

> Given a natural-language research question and bounded cost, select a relevant, broad, diverse, low-redundancy trusted corpus that preserves expert, evidence-rich, fresh, long-tail, and opposing material.

Formally:

```text
SUBSET SELECTION UNDER CONSTRAINTS
```

rather than:

```text
INDIVIDUAL DOCUMENT RANKING
```

## Original pipeline

```text
Natural Language Question
        ↓
Research Planner
        ↓
Aspect Map
        ↓
Query Expansion
        ↓
Multi-source Retrieval
        ↓
Candidate Fusion
        ↓
Candidate Geometry
        ↓
Feature Extraction
        ↓
Coverage-aware Subset Selection
        ↓
Exploration
        ↓
Claim / Aspect Mapping
        ↓
Gap Detection
        ↓
Adaptive Expansion
        ↓
Stopping Decision
        ↓
Verified Research Corpus
        ↓
Existing v0.3 Research Kernel
```

## Candidate geometry

The draft proposed a cached semantic representation:

```text
Content Embedding Matrix
X ∈ R^(n × d)

Research Aspect Embedding Matrix
A ∈ R^(m × d)

R = X A^T
```

for content↔aspect relevance, clustering, redundancy, representative selection, novelty and claim grouping.

Optional PCA/SVD was allowed only if benchmark evidence showed no material loss in Must-See, Expert, Long-tail and Aspect Recall.

## Topic-conditioned expertise

The draft explicitly rejected a global authority score:

```text
NVIDIA engineer × GPU
→ possible strong prior

NVIDIA engineer × oncology
→ little/no expertise prior
```

Matrix factorization was explicitly retained as a future candidate, not a V1 requirement.

## Multi-lane inclusion

Candidate lanes:

- Mainstream
- Expert
- Evidence-rich
- Fresh
- Long-tail / Novel
- Contradictory

## Original subset-selection ladder

```text
Baseline 0 — Popularity Top-K
Baseline 1 — Semantic Top-K
Baseline 2 — MMR
Candidate A — xQuAD
Candidate B — Submodular Facility Location
Candidate C — DPP
Candidate D — Submodular + explicit constraints
```

The draft said the benchmark, not the design document, must choose the winner.

## Desired set objective

The selected set S was expected to balance:

- relevance;
- aspect coverage;
- corpus representativeness;
- viewpoint diversity;
- expertise coverage;
- evidence coverage;
- freshness;
- contradiction coverage;
- low redundancy;
- bounded cost.

## Explicit hard-constraint exploration

The draft considered:

- total token ≤ budget;
- minimum important-aspect coverage;
- minimum expert opportunity;
- minimum fresh opportunity;
- minimum long-tail opportunity;
- no single Question dominates;
- no single Author dominates;
- minimum independent Questions;
- minimum content-type diversity.

Thresholds were explicitly required to be benchmarked rather than guessed.

## Claim Graph

The draft proposed moving the research unit from Document toward Claim:

```text
Claim / Evidence / Author / Source / Time / Stance / Topic
```

with relationships such as:

```text
SUPPORTS
CONTRADICTS
SAME_CLAIM
AUTHORED_BY
CITES
BELONGS_TO_TOPIC
```

## Adaptive retrieval and stopping

Default cross-question mode was `ADAPTIVE_DEEP`, observing:

- new aspect rate;
- new claim rate;
- new expert rate;
- new contradiction rate;
- new evidence-type rate;
- marginal representative gain.

Stopping candidates included:

- Quant / QuantCI;
- new-claim saturation;
- aspect saturation;
- marginal coverage gain;
- Chao unseen-species diagnostic;
- future value-based stopping.

Chao was explicitly diagnostic only, never retrieval-recall proof.

## Why this historical excerpt matters

The final RCE deliberately removed or deferred much of this machinery. An external reviewer should judge whether that contraction was justified by product value/evidence or whether useful structure was removed prematurely.
