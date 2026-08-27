# Design evolution — revised after adversarial self-audit

This is a historical map, not authority. It intentionally includes wrong turns.

| Stage | Evidence / pressure | What changed | Current status |
|---|---|---|---|
| v0.3 single-question trusted research | v0.3 repo specs/README | reliable capture/verify/full-corpus analysis for ONE selected question | preserved foundation |
| quality/value signal exploration | user quality discussion: evidence, expertise, weak popularity | explored how to prefer useful answers without equating likes with quality | historical input |
| scalar score rejected | different dimensions have incompatible semantics; new/low-vote expertise can matter | moved away from one QualityScore Top-K | supported principle |
| cross-question user demand | explicit 2026-08-25 request | multi-question/cross-format aggregation became P1 product target | frozen direction |
| official/OSS capability discovery | official Zhihu CLI/API/Skill/MCP/OAuth and broad OSS surfaces | stopped assuming we should build a giant Universal Foundation ourselves; moved to adapter-first discovery before Spec | frozen direction |
| subset-selection framing | cross-question redundancy / dominance problem | RCE framed as set selection under constraints, not document ranking | frozen theory framing |
| advanced algorithm exploration | xQuAD/Submodular/DPP/active-learning/stopping literature | complexity expanded significantly; Submodular was once treated as high-priority candidate | historical overshoot |
| baseline contraction | engineering value/cost policy | reduced V1 theory baseline to RRF + embeddings + deterministic features + MMR/lanes + simple clustering/saturation | frozen baseline hypothesis, not winner |
| benchmark-first | algorithm uncertainty | prohibited production winner by design; benchmark must decide | frozen governance |
| metric/gold hardening | independent review found contract errors | value units, non-largest minority, normalized Q, contradiction claim, unresolved exclusion, etc. | corrected contract |
| strategy/gold separation | evaluation leakage discovered | fair B2 cannot read evaluation Gold; oracle isolated | corrected harness |
| case×source Gold | cross-case semantic leakage | semantic Gold made research-case scoped | corrected adjudication model |
| independent Gold + D2 | provisional labels unreliable | ChatGPT adjudicated 135 case-label records; D2 rebuilt | current evidence |
| first D2 invalidated | aspect namespace reconciliation bug | corrected schema authority, exact memberships and D2 hash | current corrected D2 |
| corrected D2 result | real cases do not show stable B2 superiority; ngram proxies only | current baseline architecture remains unproven | external audit checkpoint |

## Self-audit note

V1 compressed this history too aggressively into “answer quality → RCE,” which hid the intermediate quality/value work and made the algorithm contraction look more intentional than it actually was. V2 corrects that.
