# Current state and external review questions

Current:

- Track A discovery: passed as evidence input, not production adapter implementation.
- Track B design/harness: passed after corrections.
- Semantic Gold: independently adjudicated by ChatGPT, still single-adjudicator.
- Corrected D2: current pilot evidence.
- Production TARGET: not implemented.
- Real embedding: not implemented.
- Spec gate: not ready before external review.

External reviewer should independently decide:

1. Is Research Coverage the correct product abstraction for P1?
2. Does the benchmark measure user research value or encode the design team's preferences?
3. Does question/source-group preservation need to be first-class above lanes?
4. Should MMR survive?
5. Should Expert/Fresh/Long-tail/Contradiction be constraints, soft signals, retrieval/query behaviors, post-analysis behaviors, or dropped?
6. Does the `critical_aspect → question_id → per_question_coverage → minority` chain lose provenance?
7. Which one or two missing experiments have highest information value?
8. Separately: is Track A's adapter-first platform direction sound?
9. Separately: are P2/P3 plausible designs even though they have not received a comparable empirical benchmark?
