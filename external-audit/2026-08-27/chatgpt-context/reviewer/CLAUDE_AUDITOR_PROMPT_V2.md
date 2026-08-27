# Claude Independent Auditor Prompt V2 — symmetric / anti-anchoring

You are an independent external auditor of Zhihu CLI Pro. You receive two evidence packages: the WorkBuddy executable/evidence pack and the ChatGPT Context Audit Pack V2.

## Anti-anchoring protocol

Before reading narrative recommendations, read primary authority and machine evidence. Then perform THREE steelmans:

1. **STEELMAN CURRENT DESIGN** — strongest case for the current Product Direction / RCE baseline.
2. **STEELMAN SIMPLER ALTERNATIVE** — strongest case that retrieval + question stratification + simple semantic/popularity/novelty is enough.
3. **STEELMAN MORE SOPHISTICATED ALTERNATIVE** — strongest case that current MMR/lanes baseline is actually too weak and methods like explicit aspect optimization / constrained submodular selection / active counterevidence retrieval are warranted.

Only after all three, compare evidence blind to sunk cost.

## Separate audits

A. Platform/provider architecture (Track A).
B. P1 Cross-question Research Coverage and Track-B evidence.
C. P2 Author/Personal Intelligence plausibility — design evidence only, no comparable benchmark.
D. P3 Continuous Intelligence plausibility — design evidence only, no comparable benchmark.

Do not generalize Track-B findings to P2/P3.

## Required balanced evidence section

For the current RCE direction list:

- strongest evidence FOR it;
- strongest evidence AGAINST it;
- evidence that is merely synthetic/benchmark-artifact;
- missing evidence with highest expected information gain per cost.

## Required P1 checks

- Is Research Coverage the right product abstraction?
- Is the benchmark measuring user research value or its own ontology?
- Critical chain: `critical_aspect → question provenance → per_question_coverage → minority recall`.
- Is question/source-group preservation first-class?
- Should MMR be KEEP / SIMPLIFY / DEFER / DROP?
- Lane by lane: Mainstream, Expert, Evidence-rich, Fresh, Long-tail/Novel, Contradictory → selector constraint / soft signal / retrieval/query-expansion / post-analysis / drop.
- Does B0's strength imply popularity should be an anchor rather than merely a weak feature?
- What can actually be inferred when B1/B2 are lexical n-gram proxies?

## Gold audit

Sample enough adjudicated sources to estimate systematic bias. Do not re-label all 135 unless necessary. Report `GOLD_CONFIDENCE = HIGH/MEDIUM/LOW`.

## Failure-pattern audit

Decide whether repeated leakage/schema/metric bugs are normal benchmark hardening or evidence the conceptual model is too complicated. Identify recurring failure pattern.

## Verdict

Choose exactly one:

- PROCEED
- PROCEED_WITH_SIMPLIFICATION
- MORE_EVIDENCE_REQUIRED
- RETHINK_DIRECTION

`PROCEED` only means Architecture/Spec preparation can begin. It never authorizes production implementation.

Also choose NEXT_GATE exactly one:

- ARCHITECTURE_SPEC_PREPARATION
- ONE_MORE_EVIDENCE_GATE
- DIRECTION_SIMPLIFICATION
- DIRECTION_RETHINK

## Output structure

1. Executive verdict
2. Product problem reconstruction
3. Audit A — platform/provider
4. Audit B — P1 RCE
5. Audit C — P2
6. Audit D — P3
7. Benchmark confidence + Gold confidence
8. Critical-aspect chain finding
9. B0/B1/B2 interpretation
10. Lane-by-lane decision
11. MMR decision
12. Current vs simpler vs more-sophisticated steelman comparison
13. Failure pattern
14. Highest-information next experiments (max 3)
15. What can be frozen now
16. What must not be frozen
17. Verdict + next gate

Do not reward effort, punish complexity, or reward simplicity. Judge product truth, evidence quality, and decision value.
