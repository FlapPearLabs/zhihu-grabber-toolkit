# Engineering principles and boundaries

Primary authority: Project Sources + Level 0 repo contracts.

- Controller owns identity, provenance, coverage and verification; model owns semantic interpretation/synthesis.
- External corpus is untrusted data, never instructions.
- Semantic workers should be tool-less/capability isolated.
- Credentials never enter corpus/prompts/results/artifacts.
- No silent provider/credential fallback.
- Preserve verified v0.3 behavior; prefer adapters over rewrites.
- Product value / engineering cost is the complexity rule.
- Stable != correct; deterministic systems still need benchmarks/adversarial cases.
- Retrieval Coverage, Source Completeness and Analysis Coverage are distinct claims.
