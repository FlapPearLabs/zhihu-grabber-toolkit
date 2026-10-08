> 历史收据：71e4ae1 因独立审查 F1/F2 未获验收。当前候选与修复证据见 [CURRENT](CURRENT.md)；下文历史产物保留原文。

# #107 MVP implementation and evidence receipt

EVALUATION_HARNESS = IMPLEMENTED; independent review / remote CI / integration are recorded in PR and Issue, not self-authorized here.

BASE_SHA = 880862566478f9885b9a3c5bf25581529edd2a28
EVIDENCE_CODE_SHA = b6fb5265043da398b7a1e92a8fade55d64c59373
BENCHMARK_VERSION = p2-f01-authored-curated-v1
EVALUATOR_VERSION = p2-f01-exact-supported-statements-v1
PROJECT_MEMORY_UPDATE_REQUIRED = NO (no durable P1 authority or behavior change)
PRODUCTION_MUTATION = NONE

See [campaign summary](campaign-final/human-readable-summary.md), [campaign manifest](campaign-final/campaign.json) and [frozen measurement contract](../../../research-orchestration/evaluation/README.md).

Five cases, two arms, two repetitions each: 20 actual worker executions. Four valid case pairs and one incomplete case pair per repetition. Every case and both arm results are preserved, including LOWGAIN/CONTROL zero gain and AUTHORITY INVALID. All artifact refs and hashes have been mechanically checked against saved files. No machine absolute paths found in this evidence tree.

The AUTHORITY baseline stopped at production selection clarification. Candidate executed targeted retrieval then also stopped at selection clarification. Metrics are UNKNOWN, not zero/PASS. Actual retrieval calls are 4 vs 10. Initial fail-fast finding and raw owner artifacts remain in [initial-failure.json](initial-failure.json) and its linked directory. Benchmark inputs/targets/routes were never changed after the first source commit. Harness-only repair preserves incomplete runs and their actual costs.

Leakage negative control: a rehashed product input containing real hidden_targets is rejected before product directory creation. Degraded evaluator-copy control removes source 1103 and its claims; actual comparison is REGRESSION, never a product run. Completed product closure uses the existing validator and original verifier/handoff authority. Evaluator observation is read-only with before/after inventories.

Same configuration reruns have identical quality metrics, result validity/failure and all non-latency cost fields. Timestamp, occurrence identity, wall latency and artifact hashes containing these values are documented nondeterminism. Baseline/candidate use the same frozen inputs and doubles, separate cold directories, alternating execution order, same product composer and shared budget. Only the declared targeted configuration/proposal policy differs. Current default production CLI leaves targetedSubphase disabled.

Tier 2 preflight: canonical semantic/search/capture credentials unavailable. NOT_RUN, run_count=0, variance=UNKNOWN, quality=UNKNOWN. Tier 1 actual model = NONE, external provider calls = 0. No universal quality, exhaustive retrieval, actual DeepSeek use, real authority, paid cost acceptability or #108 value PASS is claimed.

## Validation before push

- Static: node --check on all five new JS modules/test; git diff --check. No configured lint/typecheck to invent, no dependencies added.
- Focused suite: 6 passed / 0 failed / 0 skipped on final source (includes incomplete-run negative control).
- Classified offline baseline run: 1067 full-offline + 37 historical-compat, no failures/skips. Addition of incomplete-run test is covered by the final focused run; final CI executes the full current suite.
- Fast-deterministic suites: 267 passed, no failures/skips; local loopback fixture required unsandboxed test execution.
- zhihu-answer-grabber: 507 passed with isolated npm cache; original local cache EPERM was environment failure, not PASS.
- corpus-anthology: 186 passed; root agent-pipeline: 6 passed; bootstrap validator: 7/7.
- TDD red/green: hidden-input rejection, missing evaluator, exact-supported-content, actual composition, incomplete product false-valid counterexample. Raw development logs remain local ignored work; the production incomplete-run finding is archived above.
- Local Node = v26.10.0; existing classifier needs explicit NODE_OPTIONS=--test-reporter=tap for count parsing on this Node. Default-reporter zero counts are not counted as test evidence. Homebrew Node 22 failed to start due to a missing dylib; CI Node 22 provides the required supported-version check.
- Codex self-review covered standards/scope and evaluator semantics; it does not substitute for independent EVALUATION_REVIEWER.

Implementation uses /implement and /tdd instructions; code-review two-axis method was used for self-review under the user's single final reviewer requirement. Scanner audited reuse seams; doc drafter authored the marked synthetic case draft. No global memories or governance/Spec files were edited. New README freezes the evaluator contract; the suite classification adds the cheap test to existing CI.
