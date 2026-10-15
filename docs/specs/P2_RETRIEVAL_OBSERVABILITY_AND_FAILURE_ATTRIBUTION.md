# P2 Retrieval Observability & Failure Attribution

Status: DESIGN + OBSERVABILITY_MVP
Issue: #142
Implementation authorization: OBSERVABILITY ONLY
Hybrid retrieval implementation authorization: NO

## 1. Purpose

This Spec defines the minimum observability contract required to attribute retrieval failures before promoting Hybrid Retrieval work under #112.

The system must be able to answer, from frozen execution evidence:

> Where did a candidate or evidence item disappear from the research pipeline, and what mechanically supported failure class applies?

This capability is diagnostic. It must not change retrieval, ranking, selection, STOP, checkpoint, authority, or final-report semantics.

## 2. In scope

The MVP may instrument the existing retrieval path so an evaluator can reconstruct, where the product already knows the data:

1. query origin
2. provider retrieval result identity
3. provider rank
4. fusion / RRF state
5. candidate-pool admission
6. existing dense semantic signals
7. existing RCE / coverage decision
8. selected vs rejected terminal state
9. lifecycle / budget / STOP state when relevant

The resulting ledger must be append-only or otherwise auditable and must not become a second decision authority.

## 3. Out of scope

This Spec does not authorize:

- lexical rescue
- BM25 / FTS reranking
- local lexical indexing
- RRF redesign
- embedding-model changes
- dense-geometry changes
- RCE-policy changes
- #108 Targeted Re-query semantic changes
- STOP / checkpoint / identity changes
- automatic retrieval-policy adaptation
- implementation of #109, #110, #111, or #112 experiments

## 4. Observable candidate record

For each candidate, expose only values already known by existing runtime stages. Unknown values must remain UNKNOWN.

Minimum fields, where available:

- candidate/source identity
- query origin
- provider identity
- provider rank
- fusion/RRF rank or score
- candidate-pool admission state
- dense relevance / redundancy / novelty signals already computed
- selected: yes/no
- mechanically supported rejection / terminal reason
- lifecycle / budget / STOP state where relevant

No value may be synthesized merely to make the trace complete.

## 5. Failure taxonomy

The MVP uses a small closed taxonomy. UNKNOWN is mandatory.

Initial classes:

- PROVIDER_RECALL_MISS
- CANDIDATE_GENERATION_MISS
- FUSION_RANKING_MISS
- DENSE_RELEVANCE_MISS
- REDUNDANCY_REJECTION
- COVERAGE_SATISFIED
- BUDGET_STOP
- UNKNOWN

Names may be refined during implementation only if exact code-path inspection shows the initial taxonomy maps poorly to existing stages. Any refinement must preserve the principles below.

## 6. Attribution rules

A failure class may be emitted only when frozen runtime evidence proves the relevant condition.

### PROVIDER_RECALL_MISS

Use only when the relevant item is absent from the observed provider result universe for the executed query set.

This classification must not claim that the provider was incapable of returning the item under another query or at another time.

### CANDIDATE_GENERATION_MISS

Use when the observed retrieval/fusion pipeline fails to construct a candidate that should have been representable from already observed upstream provider data, and the exact candidate-generation seam causing exclusion is known.

Do not use this as a catch-all for an item that is merely absent from provider output.

### FUSION_RANKING_MISS

Use when the item is present in upstream provider results and reaches fusion/normalization, but the existing fusion/ranking stage is the mechanically proven reason it is demoted or excluded from the candidate path.

### DENSE_RELEVANCE_MISS

Use when the candidate reaches the candidate pool and an existing dense relevance decision is the mechanically proven reason for rejection.

### REDUNDANCY_REJECTION

Use when an existing redundancy rule is the mechanically proven reason the candidate is not selected.

### COVERAGE_SATISFIED

Use when the existing coverage policy explicitly rejects or declines the candidate because the relevant need is already considered satisfied.

### BUDGET_STOP

Use when an existing bounded-budget, lifecycle, or STOP condition is the mechanically proven reason the retrieval action/candidate cannot proceed.

### UNKNOWN

Use whenever evidence is insufficient to support a narrower class.

The system must prefer UNKNOWN over inferred or narrative root cause.

## 7. Candidate trace invariants

Enabling observability must not change:

- provider queries
- provider result ordering
- provider call count except for instrumentation that is strictly local and non-networked
- fusion/RRF output
- dense scores
- candidate-pool membership
- RCE selection
- targeted re-query behavior
- STOP decisions
- checkpoint identity or lifecycle
- final artifact semantics

Where practical, exact before/after equivalence should be verified for deterministic fixtures.

## 8. Persistence and privacy

The observability layer may persist only evidence already authorized for the research/evaluation surface.

It must not add:

- secrets
- credentials
- private local paths
- hidden provider payload fields not already permitted
- new raw-content persistence solely for diagnostics

If a useful attribution would require expanding persistence/privacy scope, stop and request a separate owner decision.

## 9. Acceptance tests

### A. Traceability

Given a frozen run, an evaluator can trace selected and rejected candidates through the observable stages without modifying the original run.

### B. No semantic drift

With observability enabled, deterministic fixtures preserve existing retrieval and selection outputs.

### C. Deterministic evidence

For a frozen deterministic fixture, the candidate ledger and attribution output are stable across repeated runs, excluding explicitly nondeterministic fields such as wall-clock timing.

### D. Negative controls

Tests must prove at minimum:

1. an item absent before provider output is not mislabeled as FUSION_RANKING_MISS
2. an item returned by a provider but rejected later is not mislabeled as PROVIDER_RECALL_MISS
3. insufficient evidence yields UNKNOWN
4. removing or bypassing a load-bearing observation seam causes the relevant attribution test to fail
5. enabling the observability layer does not alter existing candidate selection on deterministic fixtures

### E. Dogfood utility

At least one frozen real-world dogfood case demonstrates that the layer can distinguish two materially different failure locations, for example:

- not returned by provider
- returned by provider but rejected downstream

This proves diagnostic utility only. It does not prove retrieval-quality improvement.

## 10. Relationship to #112 Hybrid Retrieval

#142 is a prerequisite for evidence-driven promotion of #112.

Decision path:

E0 current retrieval
-> Retrieval Observability / Failure Attribution
-> real dogfood
-> measured failure distribution
-> smallest justified experiment

Promotion examples:

- exact-entity / rare-term misses -> consider #112 E1 lexical rescue
- candidate exists but ranking/fusion loses it -> consider #112 E2 BM25/FTS rerank
- provider candidate universe repeatedly lacks material evidence -> consider #112 E3 local lexical retrieval
- no recurring attributable retrieval bottleneck -> NO_CHANGE is valid

Completion of this Spec does not authorize E1, E2, or E3 implementation.

## 11. Relationship to existing roadmap

- #108 remains engineering-complete and value-UNKNOWN; this Spec may improve diagnosis but must not change #108.
- #109 remains gated by real false-stop and reachable-alternative evidence.
- #110 remains DESIGN_ONLY.
- #111 remains evidence-driven roadmap work.
- #112 remains hybrid-retrieval roadmap work and should consume evidence produced by this Spec.

## 12. Review and governance

Default review intensity:

- focused affected verification
- affected offline/historical suites
- exact-SHA verification
- one independent CODE/CONTRACT reviewer

Escalate only if implementation touches:

- authority
- identity
- STOP semantics
- checkpoint semantics
- privacy/persistence scope
- security/trust boundaries

## 13. Exit criteria

This Spec is complete when:

1. frozen runs expose an auditable candidate trace across existing retrieval stages
2. a bounded failure taxonomy is emitted only when mechanically supported
3. UNKNOWN is preserved when attribution cannot be proven
4. deterministic fixtures show no semantic drift
5. negative controls are load-bearing
6. at least one frozen real-world dogfood case demonstrates materially different attributable failure locations

After completion, dogfood failure distribution may be used to decide whether #112 should run E1, E2, E3, or remain NO_CHANGE.

IMPLEMENT_HYBRID_RETRIEVAL_NOW = NO
