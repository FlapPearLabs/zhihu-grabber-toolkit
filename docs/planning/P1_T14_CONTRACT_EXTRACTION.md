# P1-T14 CONTRACT_EXTRACTION — Cross-group aggregation + synthesis + PRE-SYNTHESIS guard

```text
TICKET_ID           = P1-T14 (GitHub Issue #46)
WORKER              = PARALLEL_WAVE_01 / T14 (isolated worktree wt-p1-t14)
BRANCH              = work/p1-t14-cross-group-aggregation
CODEGRAPH_BASE_SHA  = d1b458571518965ec7f08954b8fdf989c9655884
                      (CodeGraph MCP NOT attached this session — grounding was
                      done by reading the real modules listed in
                      RELEVANT_SURFACE_MANIFEST below at this SHA.)
UPSTREAM_SEAM       = T13_TO_T14_V1
CONTRACT_FIXTURE    = research-orchestration/test/fixtures/p1-seams/seam-c/
                      (group-representations.multi-group.json — golden input;
                       invalid.guard-mismatch.json — guard-negative input state)
INTEGRATION_STATUS  = REAL_UPSTREAM_INTEGRATED (P1 WAVE 01 integration train,
                      2026-09-05): reviewed T13 is the real upstream; the real
                      SEAM C artifact (work/p1-wave-01-integration/seam-c-real.json,
                      from the real T09 dogfood capture) passes the frozen
                      amended validator and the TYPE_B SEAM D real conformance
                      gate. DECISION_REQUIRED items below resolved per the PO
                      verdict of the same train.
OUTPUT_SEAM         = T14_TO_T15_V1 (SEAM D)
FROZEN_VALIDATOR    = research-orchestration/test/helpers/p1-seam-contracts.mjs
                      (READ-ONLY; module output is re-validated against
                      validateSynthesisOutput / assertIdentityChain in tests)
T07_HOOK            = lib/coverage-state.mjs updateSynthesisDiagnostics
                      (frozen, called not modified; caller = OWNER_T14_SYNTHESIS)
```

## Deliverables

```text
lib/pre-synthesis-guard.mjs      — PRE-SYNTHESIS guard (mechanical string
                                    equality of the two identities) + SEAM C
                                    input readability gate. Kept as its OWN
                                    module (ticket authorizes in-synthesis
                                    placement; separate module keeps the guard
                                    composable as the FIRST gate and directly
                                    unit-testable on both branches).
lib/cross-group-aggregation.mjs  — Stage-1 mechanical §8.2 aggregation
                                    (support/oppose with source/group/author,
                                    expert/evidence-rich flag, in-group
                                    contradictory↔main opposition, deterministic
                                    authorRef derivation).
lib/cross-source-synthesis.mjs   — orchestration: input gate → degradation gate
                                    → runtime pin → PRE-SYNTHESIS guard →
                                    stage-1 aggregation → injected-runtime
                                    aspect clustering (sanitized projection) →
                                    §8.3 artifact assembly → diagnostics via
                                    the T07 hook.
test/p1-t14-cross-group-synthesis.test.mjs — 33 tests (counterexample-first:
                                    committed red in 4b6d182 before modules;
                                    +2 reviewer round 1: empty-corpus
                                    fail-closed, answerCount gate-before-runtime).
No new fixtures under seam-d/ were needed (the frozen
synthesis-output.minimal.json / invalid.no-guard-evidence.json were NOT
touched; module output is validated against the frozen validator in-memory).
```

## RELEVANT_SURFACE_MANIFEST (actually read; file:line @ CODEGRAPH_BASE_SHA)

Upstream producers / contract authorities:
- docs/planning/P1_SEAM_CONTRACTS_V1.md:316-419 (SEAM C input contract), :423-537 (SEAM D output contract + diagnostics ownership map R1-F3)
- docs/planning/P1_PARALLEL_EXECUTION_CONTRACT_V1.md:298-309 (T14 packet §E3), :333-351 (§G Lane V2 binding fields), :362-372 (§I STOP conditions)
- docs/specs/p1-cross-question-deep-research.md:515-527 (§8.2/§8.3), :554-557 (§9.4), :588-601 (§10.1), :603-641 (§10.2 fail-closed)
- Issue #46 body (R2 F-2 pre-synthesis guard clause; OUT_OF_SCOPE single-writer clause)
- test/fixtures/p1-seams/seam-c/group-representations.multi-group.json (golden input)
- test/fixtures/p1-seams/seam-c/invalid.guard-mismatch.json (guard-negative input)
- test/fixtures/p1-seams/seam-d/synthesis-output.minimal.json + invalid.no-guard-evidence.json (frozen output shapes, untouched)

Frozen validator / oracle (READ-ONLY):
- test/helpers/p1-seam-contracts.mjs:317-320 (assertSeamCGuardPass), :385-452 (validateSynthesisOutput), :458-470 (assertIdentityChain), :34-40 (T14-writable diagnostic key set)

Frozen T07 hook (called, never modified):
- lib/coverage-state.mjs:850-880 (updateSynthesisDiagnostics — T14-only caller, rejects analyzedSourceSet/mappedSourceSet/selectedCorpusSourceSet writes), :143-156 (applyNewRateDiagnostics), :530-595 (createInitialCoverageState)

Runtime injection / safety precedents (read, not modified):
- lib/planner.mjs:128-138 (runtime identity exact-match pin — reused discipline for the synthesis runtime pin)
- lib/rrf.mjs:405 (isBoundarySafeString), :485-537 (projectSafeJson)
- corpus-anthology/lib/lmstudio-projection.mjs:57-63 (sanitizeProjectionText — the reviewed EXTERNAL_CORPUS sanitization reused at the T14 runtime boundary)
- lib/multi-group-execution.mjs (UNTRUSTED_CONTENT projection precedent, derived-projection doctrine)
- lib/source-group-selection.mjs (groupId = T08 authority; fixture groupId == questionId, no frozen prefix)
- lib/provider-seam.mjs (fail-closed seam vocabulary; NO_SILENT_* semantics)

## Contract decisions recorded (with authority pointers)

1. Guard placement: separate module pre-synthesis-guard.mjs (ticket-authorized choice), invoked BEFORE the semantic runtime; tests assert the runtime is never invoked on guard failure.
2. Guard comparison: mechanical string equality on the shared `sha256:<64hex>` encoding (SEAM C IDENTITY_FIELDS requires SEAM B/C encoding identity — IDENTITY_ENCODING_MISMATCH risk is inherited, not re-solved here).
3. §8.3 category assignment is mechanical precedence over structure, not weights: `conflicting` (cluster contains a contradictory-kind record) > `minority` (all constituents minority-kind) > `widely-shared` (support spans ≥2 groupIds) > `group-specific`. Answer counts NEVER enter these decisions (test: swapping discussionVolume moves nothing).
4. Aspect labels come from the INJECTED runtime (Spec §5.2 semantic duty); the runtime returns ONLY a validated partition over controller-owned claimIds — unknown claimIds / duplicates / incomplete coverage / unsafe aspect strings → `T14_RUNTIME_OUTPUT_INVALID` fail-closed. The runtime never owns identity (key-decisions D02).
5. Runtime pin: exact-match `deepseek-api-tool-less` + `deepseek-v4-flash` + callable (planner.mjs:128 discipline); anything else → `T14_RUNTIME_UNAVAILABLE`, no fallback.
6. Degradation gate: any SEAM C group with completenessStatus ∈ {captured, partial, failed} → `T14_DEGRADED_REPRESENTATION` fail-closed (§10.2 NO_SEMANTIC_DOWNGRADE; §8.1 vocabulary).
7. authorRef consumption (RATIFIED, P1 WAVE 01 integration gate 2026-09-05): every SEAM C claim carries the controller-owned `authorRef` carrier (single writer = P1-T13; nullable = unresolvable author, disclosed). T14 consumes the carrier VERBATIM into the §8.2 author dimension — support/oppose entries take the claim's authorRef (or null, disclosing author-unknown). The former derived source-token fallback `author-<sha256(sourceRef)[:12]>` was REMOVED from the integrated path entirely; no derivation, no fabrication.
8. Diagnostics definitions (Spec §9.4 freezes the KEYS, not the formulas; formulas are explicit here, not silently invented): new_aspect_rate/new_claim_rate vs optional priorSynthesis baseline (absent prior → all new); new_expert_rate = expert-backed claims share; new_contradiction_rate = `conflicting` share; claim_source_diversity = distinct sourceRefs / total reference slots.
9. Claim lineage: synthesis claims carry additive `sourceClaimIds` (V1-compatible extra field) + deterministic controller-derived `claimId` = `syn-<sha256(sorted claimIds)[:12]>`; every support/oppose entry is group-scoped to its SEAM C group's canonicalSourceIds.
10. categoryEnum is NOT embedded in the artifact (R1-F5): the frozen §8.3 vocabulary lives in the validator (static authority); the module's local CLAIM_CATEGORIES mirror is for assignment only.
11. The module performs NO filesystem IO (workDir accepted and ignored by design); persistence is a controller/T15 concern — the "nothing written on FAIL_CLOSED" property is structural, and is additionally asserted against a temp dir in tests.
12. Empty verified corpus fails closed (reviewer round 1): a structurally-valid SEAM C input whose groups carry ZERO claims → `T14_EMPTY_VERIFIED_INPUT`, NO synthesis artifact — spec/issue never authorized synthesis over an empty verified corpus, and spec authorization is assumed from the repo's fail-closed convention (§10.2); PO may grant an explicit empty-corpus allowance as a spec change if desired.
13. Input single-read snapshot (adversarial round 2, H2): `produceCrossSourceSynthesis` deep-copies `seamCArtifact` ONCE at the very first read — every own property (including hostile accessors, enumerable or not) is read exactly once into a plain-data snapshot; `readSeamCInput`, the guard, the aggregation and the synthesis ALL consume that snapshot. Property provided: guard PASS and synthesis content are computed from ONE consistent set of bytes — a hostile getter cannot serve honest data to the guard read and forged data to the aggregation read (TOCTOU guard-decoupling structurally sealed, not merely detected).
14. Coded getter failures (adversarial round 2, H1): the snapshot phase is the only place hostile accessors can execute; a getter throw, a non-JSON value (function/symbol/bigint) or a cyclic graph → coded `T14_INPUT_INVALID` with error code `SEAM_C_INPUT_SNAPSHOT_FAILED` — never a bare throw from the exported entry.
15. Total-order claim sort (adversarial round 2, C5): equal-aspect clusters are tie-broken by `claimId` (unique per cluster — the runtime output is a validated partition), then canonical JSON of the claim record → `synthesisIdentity` is invariant under the runtime's emission order.
16. Reserved groupId keys (adversarial round 2, P1probe): groupId ∈ {`__proto__`, `constructor`, `prototype`} is rejected at input validation with `SEAM_C_GROUP_ID_RESERVED` — a groupId-keyed plain-object map can never silently drop a group (fail closed, never silent omission).

## DECISION_REQUIRED (surfaced, not silently resolved)

ALL ITEMS RESOLVED by the P1 WAVE 01 integration-train PO verdict (2026-09-05):

1. AUTHOR_IDENTITY_CARRIER_MISSING — RESOLVED: the real authorRef carrier is
   integrated from T13 (additive SEAM C V1 amendment, REQUIRED-but-NULLABLE on
   every claim); the source-token fallback derivation was removed from the
   integrated aggregation path (T14-I1). The former CONSUMER WARNING is void:
   `authorRef` on SEAM D entries IS the real author signal (or null =
   author-unknown, disclosed).
2. CATEGORY_ASSIGNMENT_AUTHORITY — RESOLVED (ratified, no tuning): the V1
   deterministic structural precedence `conflicting > minority >
   widely-shared > group-specific` is confirmed as-is; no numerical truth
   weights, no answer-count weighting (pinned end-to-end in the T14 suite).
3. PRIOR_SYNTHESIS_BASELINE_UNMODELED — RESOLVED (first-run baseline
   ratified): no prior synthesis ⇒ first run — everything observed counts as
   new, so the prior-baseline novelty rates (new_aspect_rate / new_claim_rate)
   are 1; no prior is invented and no second diagnostics store exists (the
   frozen T07 hook updateSynthesisDiagnostics remains the single write path).
   new_expert_rate / new_contradiction_rate remain the structural shares
   documented in decision 8 (they are not prior-relative).
4. EMPTY_VERIFIED_INPUT — RESOLVED (ratified, round 1): a structurally-valid
   SEAM C input with ZERO verified claims fails closed
   `T14_EMPTY_VERIFIED_INPUT` (decision 12); ratified unchanged by the same
   PO verdict — empty saturation never masquerades as a conclusion.

## STOP conditions encountered

None. No frozen seam validator rejected contract-correct output; no shared file
needed edits; no high-value out-of-scope blocker appeared.
