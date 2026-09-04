# P1-T09 — Multi-group Execution: Surface Manifest + Contract Extraction + Counterexamples

```text
TICKET = P1-T09 (Issue #41)
BASE_SHA = 0287ba3ef33c29357c7f8306f9e51dcca2b41da0
LANE = TICKET_LANE_V2 (HIGH-RISK state/orchestration/identity/persistence)
STATUS = PRE-CODE EVIDENCE (produced before implementation)
```

---

## RELEVANT_SURFACE_MANIFEST

```text
DIRECT_IMPLEMENTATION_SURFACE =
  research-orchestration/lib/multi-group-execution.mjs (NEW — additive module)
  research-orchestration/test/multi-group-execution.test.mjs (NEW — focused tests)

UPSTREAM_PRODUCERS =
  T04 plan-contract.mjs        → planHash (research-plan artifact identity), planDependencyStatus
  T06 retrieval.mjs            → retrieval-pool.json (planHash-bound candidate pool)
  T08 source-group-selection.mjs → source-group-selection-decision.json:
      { verdict, reason, planHash, poolPlanHash, planHashMatch,
        selectorVersion, schemaVersion, type:'source-group-selection-decision',
        selectedGroups:[{ groupId, questionId, rrfScore, score, sourceUrl,
                          provenance, rationaleRef, selectionReason }],
        selectedGroupCount, candidates[], clarification, clarificationCount,
        intentCoverage, rationale }
      persistence: persistSelectionDecision (pin-then-walk assertArtifactSafe)
      reuse seam:   selectionDecisionStatus({decision, currentPlanHash, currentPoolPlanHash})

INPUT_CONTRACTS =
  T05 session-capture-provider.mjs createSessionCaptureAdapter({runner, now}):
      retrieve({questionId, outDir}) → §5.1 provider result:
        ok=true  → items[{ identity:{kind:'source-group', questionId},
                           provenance:{route, captureStage}, source_url{url,securityClass,displayHost},
                           facts:{questionTitle, capturedAnswerCount, artifacts} }],
                   completeness{status: complete|partial|unknown, evidence},
                   verified:false (mechanically enforced), validity_authority:'verify-output'
        ok=false → failure{code, class, detail?≤500, provider_error_type?}
      Non-zero primitive exit → failure BEFORE parsing (P1-2 repair); capture payload must
      carry verified===false (P1-3 repair); identity mismatch → CAPTURE_IDENTITY_MISMATCH.
  provider-seam.mjs validateProviderResult = mechanical controller gate on every result.
  zhihu-verify primitive (verify-output.mjs <captureDir>) → { valid, questionId,
      capturedAnswerCount, reportedAnswerCount } — the ONLY validity authority (RULES §4).
  zhihu-handoff primitive (make-handoff.mjs <captureDir> --task digest) → handoff.json.
  corpus-verify-handoff (corpus verify.mjs --handoff <f> --source-root <dir>) → { valid }.

VALIDATORS =
  verify-output.mjs (per-question validity; captured != verified)
  corpus verify.mjs (handoff + work + final gates)
  provider-seam.validateProviderResult
  coverage-state.validateCoverageState (impossible-accounting gates:
      verified→captured; failed⊥verified; verifiedCount≤selectedCount;
      aggregate diagnostics == per-group sums; complete pagination requires evidenceRef)
  plan-contract.isValidPlanHashFormat / validatePlanInput
  rrf.assertArtifactSafe (ONE artifact-safety walker; pin-then-walk persistence pattern)

DOWNSTREAM_CONSUMERS =
  P1-T12 RCE corpus selector (BLOCKED_BY T09) — consumes verified group composition.
  ResearchCorpusManifest — composition/derivation artifact for corpus input (T12+).
  CoverageState.updateSourceCompleteness (T07 hook, caller=T09) — Source Completeness ledger.
  corpus-anthology answers.json consumers — canonical content stays per-group.

PERSISTED_ARTIFACTS =
  <workDir>/multi-group-state.json (NEW; work-relative paths only; no timestamps in identity)
  per-group canonical artifacts (existing, untouched):
      <workDir>/zhihu/<questionId>/answers.json, handoff.json
  <workDir>/coverage-state.json (T07; written via updateSourceCompleteness caller=T09)

STATE_OWNERS =
  canonical answers content → per-group answers.json (existing authority; T09 MUST NOT copy)
  verification validity → verify-output authority (T09 only mirrors its verdict)
  per-group handoff → make-handoff + corpus handoff verify authority (T09 composes references)
  Source Completeness → T09 via updateSourceCompleteness ONLY
  selection identity → T08 decision + planHash (T09 binds, never rewrites)
  manifest derivation → T09 (deterministic; not a second canonical store)
  downstream selected/analyzed identities → T12/T13 (T09 MUST NOT write their ledgers)

IDENTITY_PROVENANCE =
  run planHash (T04) → pool.planHash (T06) → decision.planHash/poolPlanHash (T08)
  → multi-group state: planHash + selectionIdentity + selectionDecisionHash
  → per-group artifact hashes (answers.json, handoff.json sha256 at production time)
  → VerifiedGroupRefs[] (valid-only projection) → manifestHash (deterministic derivation)

FAILURE_BOUNDARIES =
  capture failure → group failed {code, class} (value-free; no raw provider echo)
  verify valid=false → captured stays true, verified stays false (legal diagnostic state)
  verify identity mismatch → group failed VERIFY_IDENTITY_MISMATCH (fail closed)
  handoff gate valid=false → handoffValid=false → excluded from refs (no validity upgrade)
  stale artifact (hash mismatch) → that group reset; dependents invalidated; siblings isolated
  planHash/selectionIdentity/selectionDecisionHash drift → invalidate from that boundary
  corrupt state file → treated as absent (fresh execution; no silent partial reuse)

SECURITY_PRIVACY_BOUNDARIES =
  credentials/secret-bearing headers/credential paths/raw provider diagnostics NEVER enter
  state/manifest/coverage updates/events (RULES §1; Spec §6.2; §10). Persistence reuses the
  ONE rrf.assertArtifactSafe walker (pin-then-walk); work-relative paths only; machine-private
  absolute paths never persisted (RULES §11).

ADJACENT_TICKET_BOUNDARIES =
  T05 owns capture wrapper authority; T08 owns selection; T07 owns CoverageState schema;
  T09 owns ONLY Source Completeness updates (caller 'T09').
  NOT authorized: T12 selection accounting; T13 mapped/analyzed source-set identity;
  T14 synthesis diagnostics; T15 final 100% assertion; new handoff schema; verifier rewrite.

OPEN_UNKNOWN_RELATIONSHIPS =
  none material remaining after direct reading of all surfaces above at BASE_SHA.
  (CodeGraph cross-module traces used to confirm: orchestrator↔state↔runner single-question
  seam untouched; coverage-state hook authorization; T08→T05→T09 composition path.)
```

---

## CONTRACT_EXTRACTION

```text
INPUTS =
  selectionDecision: T08 auto-verdict decision (validated shape; selectedGroups non-empty,
    unique questionIds); planHash: format-valid T04 plan hash; workDir; runner (injectable);
    captureAdapter (T05 wrapper, injectable); coverageState (T07 canonical state).

OUTPUTS =
  MultiGroupExecutionState (persisted, work-relative, credential-free)
  VerifiedGroupRefs[] (valid-only, derived — never hand-appended)
  ResearchCorpusManifest (deterministic composition/refs/hashes/accounting; manifestHash)
  Source Completeness update payload → updateSourceCompleteness(caller='T09')
  per-group failure identities (stable, value-free machine codes)

PRECONDITIONS =
  decision.verdict === 'auto' && selectedGroups.length >= 1; no duplicate groupId/questionId
  planHash format-valid; runner + captureAdapter provided; workDir writable

POSTCONDITIONS =
  every group independently tracked (captured/verified/handoffValid/failed/partial disjoint
  where validator demands); verifiedGroupRefs == derived(groups) (recomputable at any time);
  manifest reproduced byte-identically from (state, selectionDecision) dependencies;
  researchComplete === true ONLY when every group is in verifiedGroupRefs;
  CoverageState Source Completeness aggregates == mechanical per-group sums.

HARD_INVARIANTS =
  I1  CAPTURED != VERIFIED (per group, structurally)
  I2  VerifiedGroupRefs valid-only (requires captured && verified && handoffValid)
  I3  sibling isolation (group B failure/stale never mutates group A)
  I4  FILE EXISTS != VALID CACHE (every reuse revalidates recorded hashes)
  I5  stale propagation (group invalidation cascades to its dependents only)
  I6  PARTIAL != COMPLETE (researchComplete only when all groups valid; finalize fails closed)
  I7  manifest is NOT a second canonical store (refs/hashes/accounting only; no content)
  I8  handoff authority inherited (no new verified handoff schema; no manual validity upgrade)
  I9  no credentials/unsafe strings in any persisted surface (assertArtifactSafe pin-then-walk)
  I10 identity drift (planHash / selectionIdentity / selectionDecisionHash) invalidates from
      the matching boundary; reordered-but-identical group sets keep cache identity stable

VALID_SUCCESS_CASES =
  all groups capture→verify→handoff valid → complete manifest + researchComplete=true
  resume with all artifacts hash-valid → skip re-execution of valid groups
  resume after group B handoff staleness → B re-runs handoff stage only; A reused intact
  reordered identical selection → cache identity stable → valid groups reused

FAIL_CLOSED_CASES =
  captured-but-not-verified group → excluded from refs (I1)
  verify identity mismatch → group failed VERIFY_IDENTITY_MISMATCH
  duplicate group id at state creation → rejected MULTI_GROUP_DUPLICATE_GROUP_ID
  artifact present but hash mismatch → reuse rejected; group re-executed (I4)
  planHash/selection drift → fresh state from that boundary (I10)
  corrupt state file → fresh execution (no silent partial reuse)
  unsafe (credential-shaped) state content → persistence rejected (stable value-free reason)
  finalizeResearch with any group invalid → throw (partial never completes)

ALLOWED_FALLBACKS =
  none. (No provider/runtime fallback introduced by T09.)

FORBIDDEN_FALLBACKS =
  silent reuse of stale artifacts; captured→verified upgrade; partial→complete rendering;
  manifest content copying; writing other CoverageState ledgers; raw provider error echo.

IDENTITY_DEPENDENCIES =
  planHash (T04) → poolPlanHash (T06) → selectionDecisionHash (T08 bytes) →
  selectionIdentity (normalized selected group set) → per-group artifact hashes →
  VerifiedGroupRefs → manifestHash.

PERSISTENCE_DEPENDENCIES =
  multi-group-state.json (schemaVersion 1; type multi-group-execution-state); artifact-safety
  walk before write; work-relative paths only; corrupt = absent.

OWNERSHIP =
  canonical content: per-group answers.json (unchanged). validity: verify-output.
  handoff: make-handoff + corpus handoff verify. Source Completeness: T09 (hook only).
  selection identity: T08 decision. manifest derivation: T09. selected/analyzed sets: T12/T13.

OUT_OF_SCOPE =
  T12/T13/T14/T15; new retrieval provider; T17; semantic runtime; verifier rewrite;
  new public handoff schema; Approved Spec edits; frozen DAG edits; parse5 CI repair;
  any modification to the single-question orchestrator/state controller semantics.
```

---

## COUNTEREXAMPLE REGISTER (executable; IDs map to test names)

```text
CE-01 CAPTURED_NOT_VERIFIED        capture ok + verify valid=false → excluded from refs;
                                   captured=true verified=false; accounting counts it
CE-02 SIBLING_ISOLATION            B answers tampered on resume → only B invalidated; A reused
CE-03 FILE_EXISTS_NOT_CACHE        answers.json exists w/ wrong bytes → reuse rejected
CE-04 PLAN_IDENTITY_DRIFT          planHash changed → fresh state; old refs not stitched
CE-05 PARTIAL_NOT_COMPLETE         one group valid + one interrupted → researchComplete=false;
                                   finalizeResearch throws; manifest accounting shows partial
CE-06 WRONG_GROUP_IDENTITY         verify reports foreign questionId → group failed
                                   VERIFY_IDENTITY_MISMATCH; excluded from refs
CE-07 MANIFEST_SECOND_STORE        sentinel content in answers never appears in manifest;
                                   manifest keys limited to composition/refs/accounting
CE-08 CREDENTIAL_POISONING         secret-bearing failure detail rejected by persistence walk;
                                   state bytes contain no secret; stable value-free reason
CE-09 DUPLICATE_GROUP_ID           same question twice in selection → creation rejected
CE-10 REFS_NO_DUPLICATES           deriveVerifiedGroupRefs idempotent; no duplicate refs
CE-11 FRESH_HANDOFF_STALE_ANSWERS  answers tampered → handoff dependent invalidated too
CE-12 STALE_HANDOFF_FRESH_SIBLING  handoff.json tampered → only handoffValid dropped;
                                   verified (answers-bound) preserved; re-handoff on resume
CE-13 UNKNOWN_COMPLETENESS         provider completeness=unknown → paginationStatus=unknown,
                                   never complete; complete requires evidenceRef
CE-14 INTERRUPTED_STATE_WRITE      corrupt multi-group-state.json → fresh execution
CE-15 REORDERED_SELECTION_SAME_SET same set different order → identical selectionIdentity
CE-16 REMOVED_GROUP_NOT_IN_MANIFEST group removed by new selection → absent from state/manifest
CE-17 HOSTILE_GETTER_STATE         throwing getter in state input → persist fails closed
CE-18 HOOK_ACCOUNTING_MECHANICAL   derived update always satisfies updateSourceCompleteness
                                   validator; inconsistent manual payload throws (hook alive)
CE-19 CAPTURE_ADAPTER_CONTRACT     invalid provider result shape → group failed with
                                   PROVIDER_RESULT_CONTRACT_INVALID (validateProviderResult gate)
CE-20 PLAN_IDENTITY_BINDING        decision.planHash/poolPlanHash missing, malformed, or
                                   != executing planHash → MULTI_GROUP_PLAN_IDENTITY_MISMATCH
                                   at create (and every resume fresh path); stale
                                   (plan, decision) pair never composes — re-selection required
CE-21 STATE_SHAPE_GROUPS           parseable state, valid type/schemaVersion, groups
                                   missing/array/empty → corrupt → load null → resume fresh
                                   (no raw throw, no silent empty-groups 'resume')
CE-22 STATE_SHAPE_GROUP_ENTRY      tampered group entries (nulled; groupId != key; boolean
                                   coercion; unknown artifact-hash keys; failure w/ raw detail
                                   keys) → corrupt → load null → resume fresh
```

---

## RETROACTIVE ROUND — PRE-FRESH-REVIEW CONTRACT REPAIR (CE-20/21/22)

```text
TRIGGER = product-owner instruction before FRESH REVIEW: probe CE-20/21/22; repair any
          contract defect via RED → append-only repair → GREEN; complete retroactive
          CodeGraph grounding on the candidate. Independence semantics clarified:
          independent graph QUERY / relationship reasoning — NOT independent graph
          database construction; no full reindex merely for a fresh reviewer.

RED_EVIDENCE = /tmp/t09_red_ce2022.log — node --test at exact candidate c6dc4c3
          (pre-repair lib): 36 tests, 33 pass, 3 fail:
            CE-20 'Missing expected exception' (no fail-closed identity binding)
            CE-21 TypeError 'Cannot convert undefined or null to object' (raw throw)
            CE-22 TypeError "Cannot read properties of null (reading 'captured')" (raw throw)

CE-20 PLAN_IDENTITY_BINDING   createMultiGroupExecutionState now hard-binds BOTH T08
          decision identity fields (decision.planHash AND decision.poolPlanHash) to the
          executing planHash (format-valid + equality; mirrors the T08
          selectionDecisionStatus fail-closed reuse contract). A (planHash, decision)
          pair that is internally inconsistent fails closed
          MULTI_GROUP_PLAN_IDENTITY_MISMATCH on every path (create + all resume fresh
          boundaries). Plan drift therefore requires a RE-SELECTION under the new plan,
          never composition of a stale decision. CE-04 test updated to this stronger
          semantics (stale pair throws; legal plan drift uses a fresh decision).
CE-21 STATE_SHAPE_GROUPS      loadMultiGroupState deep-validates persisted shape: a
          parseable file with valid type/schemaVersion but missing/array/empty groups
          map is CORRUPT → null → resume fresh (no_state). Closes the raw-throw at
          resume's groups iteration and the silent empty-groups 'resume' state.
CE-22 STATE_SHAPE_GROUP_ENTRY entry-level validation: strict key whitelists (15-entry
          production shape; 9-key top-level shape), entry.groupId === key, strict
          booleans (no truthiness coercion), enum-bounded stage/paginationStatus,
          artifact-hash whitelist {answersJson, handoffJson}, failure object exactly
          {code, class} (raw detail keys rejected). Invalid → null → fresh. Path
          containment of evidenceRef/handoffRef stays with the T06 authority
          (validateArtifactCheckpoint → assertWorkRelative), revalidated on every reuse.

REPAIR = append-only commit on work/p1-t09-multi-group-execution (c6dc4c3 untouched;
         repair SHA recorded in the lane packet / final report).
```

---

## GROUNDING RECORD (honest labels per product-owner-required format)

```text
PRE_CODE_CODEGRAPH_GROUNDING = INCOMPLETE
  (implementation began before the rebuilt graph was ready; no PASS is claimed)
DIRECT_REPOSITORY_GROUNDING  = PASS
  (every manifest surface read verbatim at exact SHAs during AUTHORITY / MANIFEST phases)

RETROACTIVE_CODEGRAPH_GROUNDING = PASS (reused healthy exact-base index + incremental candidate delta)
  BASE_GRAPH       = wt-p1-t08-reform/research-orchestration CodeGraph index
                     (32 files / 653 nodes / 3459 edges, 'Index is up to date');
                     worktree HEAD verified = 0287ba3ef33c29357c7f8306f9e51dcca2b41da0
                     (exact base/master). REUSED — not rebuilt.
  CANDIDATE_DELTA  = index copied to wt-p1-t09/research-orchestration + `codegraph sync`:
                     'Synced 4 changed files — Added: 2, Modified: 2 — 154 nodes in 2.3s'
                     → 34 files / 738 nodes / 3971 edges, including the T09 module + tests.
  FULL_REBUILD     = a background full-repo init (wt-p1-t09 root) started earlier in this
                     session is NOT waited on and NOT required (healthy exact-base graph +
                     candidate delta satisfies grounding; product-owner instruction #10).
  REVIEWER_USAGE   = fresh reviewer must ground via graph QUERY against this index plus
                     direct reads at the exact candidate SHA; no reviewer-owned reindex.
```
