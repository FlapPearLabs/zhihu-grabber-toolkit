# P1-T13 CONTRACT_EXTRACTION — Issue #45 (P1 Ticket Lane V2 binding)

```text
TICKET_ID            = P1-T13 (GitHub issue #45)
UPSTREAM_SEAM        = T12_TO_T13_V1
CONTRACT_FIXTURE     = research-orchestration/test/fixtures/p1-seams/seam-b/
                       (selected-research-corpus.multi-group.json + .minimal.json;
                        existing fixtures consumed READ-ONLY, never modified)
OUTPUT_SEAM          = T13_TO_T14_V1 (§SEAM C, P1_SEAM_CONTRACTS_V1.md)
INTEGRATION_STATUS   = NOT_YET_REAL_UPSTREAM
MAX_REACHABLE_STATE  = IMPLEMENTATION_REVIEWED (§G binding; INTEGRATION_ACCEPTED
                       requires real T12 artifacts passing SEAM B + TYPE_B)
CODEGRAPH_BASE_SHA    = d1b458571518965ec7f08954b8fdf989c9655884
                       (CodeGraph MCP not attached this session; grounding done by
                       reading the real modules below at this SHA)
IMPLEMENTATION_MODEL_CLASS = DEEPSEEK_V4_FLASH (Issue #45)
RISK_CLASS           = MEDIUM
```

## 1. Ownership (binding)

`ANALYZED_SOURCE_SET_IDENTITY_OWNER = P1-T13` (Issue #45 single-owner clause;
Ticket Graph §B; key-decisions D10). In this implementation the ONLY analyzed/mapped
source-set identity write paths are:

- `lib/group-representation.mjs` — `derivePerGroupAnalyzedIdentity` /
  `deriveAggregateAnalyzedIdentity` / `assembleSeamCArtifact` (identity derivation,
  single module);
- `lib/per-group-claim-extraction.mjs` — `applyAnalysisToCoverageState` (the ONLY
  CoverageState write, exclusively via frozen T07 hook `updatePerGroupAnalysis`,
  caller `OWNER_T13_ANALYSIS`).

T14 consumes `aggregateAnalyzedIdentity`; T15 audits. Negative tests in
`test/p1-t13-group-representation-claims.test.mjs` prove no second write path
exists at module level (T14 hook rejection with `coverage_illegal_write`) and hook
level (`updatePerGroupAnalysis` rejects non-T13 callers).

## 2. RELEVANT_SURFACE_MANIFEST (upstream producers / validators / consumers actually read, at CODEGRAPH_BASE_SHA)

| Surface | Role | Evidence (file:line @ d1b4585) |
|---|---|---|
| SEAM B contract | INPUT (frozen candidate) | docs/planning/P1_SEAM_CONTRACTS_V1.md:214-313 |
| SEAM C contract | OUTPUT (frozen candidate) | docs/planning/P1_SEAM_CONTRACTS_V1.md:316-419 |
| Parallel packet / Lane V2 binding | governance | docs/planning/P1_PARALLEL_EXECUTION_CONTRACT_V1.md:291-309 (§E3), 333-351 (§G), 362-372 (§I) |
| Frozen oracle (READ-ONLY) | golden fixtures + guard semantics | research-orchestration/test/p1-seam-contracts.test.mjs:153-220 |
| Frozen validators (READ-ONLY use) | `validateGroupRepresentations` / `assertSeamCGuardPass` | research-orchestration/test/helpers/p1-seam-contracts.mjs:317-381 |
| SEAM B fixtures | canonical input encoding | research-orchestration/test/fixtures/p1-seams/seam-b/selected-research-corpus.{multi-group,minimal}.json |
| T07 CoverageState hooks | consumed, never modified | research-orchestration/lib/coverage-state.mjs:803 (Hook 4 `updatePerGroupAnalysis`, T13), :850 (Hook 5 T14 strict source-set rejection), :739 (Hook 3 T12), :530 (`createInitialCoverageState`), :62 (`OWNER_T13_ANALYSIS`) |
| T09 multi-group execution | hash domain + composition precedent (read-only) | research-orchestration/lib/multi-group-execution.mjs:131 (canonicalJson), :149 (`computeSelectionIdentity`) |
| T05 provider seam | runtime/provider injection seam precedent | research-orchestration/lib/provider-seam.mjs:177 (`createProviderSeam`), :252 (`retrieve` + mechanical validation) |
| T11 dense geometry | T13 input surface context (read-only) | research-orchestration/lib/dense-geometry.mjs:1-80 |
| Runtime projection precedent | token-only projection pattern (T6/T11-R1 #27) | corpus-anthology/lib/lmstudio-map-executor.mjs:53-121 (`runChunkMap`: opaque tokens, controller-owned identity, chunk fail-closed) |
| SemanticRuntime (qualified, never imported by tests) | DEEPSEEK_V4_FLASH tool-less contract | corpus-anthology/lib/deepseek-tool-less.mjs:30-38 (`DEEPSEEK_RUNTIME`) |
| Spec §8.1 / §9.2 / §9.3 / §10.1 | semantic authority | docs/specs/p1-cross-question-deep-research.md:502-524, 540-553, 588-601 |

## 3. Implementation deltas vs frozen contract (V1-compatible)

1. **Aggregate identity derivation (Issue #46 guard-equal branch)**: full selected-corpus
   coverage → `mappedAnalyzedSourceSetIdentity` is the byte-identical echo of SEAM B
   `selectedCorpusIdentity` (set identity semantics: the analyzed set IS the selected set).
   Partial coverage → a DISTINCT deterministic `sha256:` identity
   (`kind: 'T13_PARTIAL_ANALYZED_SOURCE_SET'`) that can never pass the guard. This realizes
   §SEAM C VALID_SUCCESS "aggregate identity 与 selectedCorpusIdentityRef 机械相等" without a
   second identity encoding (IDENTITY_ENCODING_MISMATCH STOP avoided).
2. **canonicalGroupIdentity provenance**: SEAM B does NOT carry per-group
   `providerId`/`capability` (nor does SEAM A). No default is invented — the controller
   injects a `canonicalGroupIdentityResolver(groupId)` from the provenance authority;
   unresolvable → fail closed `SEAM_C_REPRESENTATION_CONFLICT`.
3. **discussionVolume.answerCount**: mechanically derived from the group's
   `selectedSourceRefs.length` (each selected source IS one answer artifact of the corpus);
   answer count stays an independent signal (Spec §8.1/§8.3), never a truth weight.
4. **Guard mismatch input state**: production assembly fails closed
   (`SEAM_C_GUARD_MISMATCH`); `assembleSeamCArtifact({enforceGuardEquality:false})` exists
   ONLY to materialize the diagnostic mismatch input state mirroring the frozen
   `seam-c/invalid.guard-mismatch.json` semantics (structurally valid + guard-failing).
5. **Module-level fail-closed codes** beyond the frozen §SEAM C table:
   `SEAM_C_RUNTIME_UNAVAILABLE`, `SEAM_C_SOURCE_FAILURE`, `SEAM_C_MODEL_OUTPUT_INVALID`,
   `SEAM_C_PROJECTION_ISOLATION_VIOLATION` (per-group-claim-extraction.mjs), plus
   `SEAM_C_ANALYZED_SET_FOREIGN_MEMBER` (group-representation.mjs; reviewer round 1 —
   `buildGroupRepresentation` additionally validates the analyzed set as a SUBSET of the
   group's `selectedSourceRefs` canonicalSourceIds, not counts alone). The frozen four
   (`SEAM_C_GUARD_MISMATCH`, `SEAM_C_REPRESENTATION_CONFLICT`, `SEAM_C_MODEL_OWNED_IDENTITY`,
   `SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE`) are emitted exactly per §SEAM C.

## 4. DECISION_REQUIRED (surfaced, not improvised)

- **D1 (seam amendment)**: assign frozen seam codes for "runtime unavailable",
  "single source failure", "model output shape violation", and "projection isolation
  violation" — the frozen §SEAM C table covers only the four guard semantics; T13 must
  fail closed for the first two per Issue #45 AC but has no frozen code to emit.
  Reviewer round 1 additionally adds module-level `SEAM_C_ANALYZED_SET_FOREIGN_MEMBER`
  (analyzed id outside the group's selected set in `buildGroupRepresentation`) to this
  same pending-assignment list.
- **D2 (upstream gap)**: SEAM B carries no per-group provider provenance and no answer
  count; §8.1 requires both (`canonicalGroupIdentity`, `discussionVolume`). Proposal:
  T12 extends SEAM B (V1-compatible additive fields) or T13 keeps the injected
  resolver + mechanical answerCount derivation (current implementation).
- **D3 (T12/T13 integration)**: verify T12's real `canonicalSourceId` encoding remains
  boundary-safe (CoverageState hook validation) and stable; the frozen fixture encoding
  (`<questionId>-a-<n>`) is assumed representative until real artifacts exist.

## 5. Test / evidence map (REQUIRED_TESTS → file)

| Requirement (Issue #45) | Test |
|---|---|
| representation completeness (§8.1 mechanical) | `test/p1-t13-group-representation-claims.test.mjs` §2 (frozen validator + field walk) |
| claims contract / controller-owned identity | §5 (`SEAM_C_MODEL_OWNED_IDENTITY` variants, deterministic claimIds) |
| isolation / projection safety (§10.1) | §6 (DATA_NOT_INSTRUCTION fencing, isolation assertion, injection-shaped content) |
| failure semantics | §7 (runtime unavailable, single-source failure, empty content, no artifact on failure) |
| accounting updates via T07 hook | §8 (`updatePerGroupAnalysis` caller T13, end-to-end, no 100% self-assertion) |
| analyzed identity single ownership | §3 (mechanical derivation + negative second-write-path tests) |
| guard equality pre-conditions | §4 (guard-equal branch, mismatch detection, frozen-mismatch mirror) |
| fail-closed codes per §SEAM C | §1/§4/§5 (all four frozen codes exercised) |
| zero network / mocked runtimes | all runtime calls use injected mocks; no deepseek module import in tests |

Full suite gate: ≥508 pass / 0 fail at CODEGRAPH_BASE_SHA + this delta.
