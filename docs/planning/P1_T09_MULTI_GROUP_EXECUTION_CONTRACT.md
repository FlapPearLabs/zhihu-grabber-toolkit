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

---

## FRESH REVIEW ROUND A — FINDINGS + REPAIR (R2-F1..F8)

```text
REVIEWED_HEAD_A = 1bf225054fa5805fc84a3d18e8ab6c457369d6b9
VERDICT_A       = CHANGES_REQUESTED (independent fresh reviewer; own CodeGraph grounding
                  PASS; 9 executed probes, 5 confirmed defects; probes in /tmp/t09_fresh_review/)

F1  P1  complete&&failed coverage contradiction — capture-complete then verify
        process/identity failure left paginationStatus='complete' on a failed group;
        the derived Source Completeness payload then violated the T07 validator
        (coverage_invalid_state), contradicting CE-18. Also: the legal verify
        valid=false branch did not supersede stale failure marks.
        REPAIR: markGroupFailed downgrades paginationStatus→unknown (and partial→false);
        a completed verify run (valid OR legal-invalid) clears stale failed/failure.
F2  P2  missing recorded hash made I4 revalidation vacuous (validateArtifactCheckpoint
        skips comparison when expectedHash is falsy) — captured state with empty
        artifactHashes survived resume over tampered disk bytes.
        REPAIR: load rejects captured-without-answersJson-hash (and handoffValid-
        without-handoffJson/handoffRef) as corrupt; resume additionally treats a
        missing expected hash as stale (defense in depth).
F3  P2  cross-group artifact swap (evidenceRef/handoffRef pointing at another group's
        REAL artifacts with self-consistent hashes) passed load+resume+manifest.
        REPAIR: load cross-field coherence — captured ⇒ evidenceRef ===
        zhihu/<questionId>/answers.json + recorded hash; handoffValid ⇒ handoffRef ===
        zhihu/<questionId>/handoff.json + recorded hash. Invalid → corrupt → fresh.
F4  P2  reordered-identical decision hit the selectionDecisionHash boundary (byte-hash
        was array-order sensitive) → full discard, contradicting VALID_SUCCESS_CASES
        ('reordered identical selection → valid groups reused') and the I10 promise.
        REPAIR: selectionDecisionHash domain refined to an order-canonical decision
        identity (selectedGroups sorted by groupId, candidates sorted by questionId;
        every other decision field covered verbatim). Content change still drifts;
        reorder now reuses composed groups. Identity-chain note updated accordingly.
F5  P2  shape-valid foreign group injected into the persisted groups map (superset of
        the selection) passed load and wedged resume at the composition derivation
        (MULTI_GROUP_REF_IDENTITY_INVALID throw) instead of corrupt→fresh.
        REPAIR: load validates groups map === recorded selectionIdentity (order-
        independent set equality); inconsistent map = corruption → null → fresh.
F6  P3  '__proto__' groupId silently vanished from the groups map at create
        (prototype accessor assignment) — selection vs execution-state divergence.
        REPAIR: create rejects __proto__/constructor/prototype groupIds
        (MULTI_GROUP_GROUP_ID_FORBIDDEN); load rejects such keys in persisted maps.
F7  P3  test quality — tautological assertion removed (now asserts the 64-hex decision
        identity and its distinctness from the set identity); R2 tests add the two
        missing coverage blind spots (complete-then-verify-failure → coverage apply;
        reordered-decision resume reuse).
F8  P3  T09 boundary did not validate questionId canonicality (a non-canonical identity
        wedged at persistence instead of failing at create).
        REPAIR: create rejects non-canonical questionId via T08's exported
        isCanonicalQuestionId (authority reuse — no new rule invented).

R2 TDD = RED at exact 1bf2250 (44 tests / 36 pass / 8 fail — /tmp/t09_red_r2.log)
         → append-only repair → GREEN 44/44 → full regression (see lane packet).
```
```

## FRESH REVIEW ROUND B — FINDINGS + REPAIR (R3-FB1..FB3)

Fresh review @ exact 1c6a9e8 (post-R2 repair SHA). VERDICT: CHANGES_REQUESTED
(1×P2 + 2×P3). All three findings are defensive-coherence gaps in the persisted
state trust surface; none changes the happy path.

ID  PRI  FINDING + REPAIR
--  ---  --------------------------------------------------------------------------------
FB1 P2   Cross-file circular trust: a persisted group's questionId was validated only
         against itself (loop trust). An attacker who steals/re-writes group records
         wholesale (e.g. swaps group 200's captured record under groupId '100',
         co-rewriting questionId) produced a self-consistent load, and the resume path
         then composed handoffs against the WRONG question — cross-file identity lie.
         REPAIR: resume re-binds every persisted per-group questionId to the DECISION
         it already carries (selectionDecision.selectedGroups — the cross-file,
         non-circular authority). Any group whose questionId !== decision's recorded
         questionId → whole state incompatible → fresh (boundary 'incompatible').
         Load-layer answer remains fail-closed-first; resume decides compatibility.
FB2 P2   Flag/mirror incoherence loaded cleanly: verified=true alongside a verification
         mirror that is null / {valid:false} / {valid:true,questionId:'other'}; or
         handoffValid=true with verified=false; or failed=true with verified=true
         (coverage-forbidden pair, cf. T07 complete⊥failed). None were rejected —
         the mirror is the validity authority, so a contradicting flag is corruption.
         REPAIR: isValidGroupEntry coherence gate — verified ⇒ captured ∧
         verification plain-object ∧ verification.valid===true ∧
         verification.questionId === g.questionId; handoffValid ⇒ verified;
         failed ∧ verified → corrupt.
FB3 P3   questionId canonicality missing at load (T06/T08 authority): a persisted
         entry with questionId '../x801' passed the non-empty string check, made the
         R2-F3 evidenceRef equality self-consistent ('zhihu/../x801/answers.json' —
         shallow path alias slips past assertWorkRelative), and wedged the coverage
         hook permanently.
         REPAIR: isValidGroupEntry rejects non-canonical questionId via T08's
         isCanonicalQuestionId at load (authority reuse; no new rule invented).

R3 TDD = RED at exact 1c6a9e8 (47 tests / 44 pass / 3 fail — /tmp/t09_red_r3.log;
         the 3 failures are exactly FB1/FB2/FB3; the 44 pre-existing tests show zero
         perturbation)
         → append-only repair (this round) → GREEN 47/47
         → full regression 467/467 (420 pre-existing + 47 focused; /tmp/t09_regression_r3.log)

Repair edits (append-only, single repair commit):
  1. resumeMultiGroupExecution: decision cross-binding gate after the
     selectionDecisionHash boundary (decisionQuestionByGroup map; mismatch → fresh,
     RESUME_BOUNDARY_INCOMPATIBLE).
  2. isValidGroupEntry: isCanonicalQuestionId(g.questionId) gate (R3-FB3).
  3. isValidGroupEntry: flag/mirror coherence gate (R3-FB2).
  4. computeSelectionDecisionIdentity docstring: sort-stability semantics recorded
     (ES2019 stable sort; duplicate keys with divergent payloads → order-dependent
     → over-invalidation → fail-closed, not a defect).

Note (R2-F5 superset + FB1 interplay): the load-layer selection-set equality check
(F5 repair) already rejects a wholesale injected superset; FB1 closes the
equal-size-swap variant that kept the set identical but rewrote per-group
questionIds. Together: persisted groups map must equal the recorded selection set
AND every per-group questionId must equal the decision's recorded questionId.
```

## FRESH REVIEW ROUND C — FINDINGS + REPAIR (R4-RC1..RC3)

Fresh review @ exact 05f0133 (post-R3 repair SHA). VERDICT: CHANGES_REQUESTED
(2×P2 + 1×P3). All 11 prior closures (F1..F8, FB1..FB3) verified CLOSED_VERIFIED;
reviewer's own probes C4 (key-order drift → clean reuse) and C5 (garbage recorded
hash → stale reset, never reuse) confirmed the defense HOLDS in those directions.

ID  PRI  FINDING + REPAIR
--  ---  --------------------------------------------------------------------------------
RC1 P2   create accepted two DISTINCT groupIds composing the SAME questionId (checked
         duplicate groupIds, canonicality, plan binding — but not questionId
         uniqueness). A forged decision (T08 structures groupId===questionId away;
         T09 re-validates decision preconditions at its own boundary) yields two
         groups sharing one evidence directory, double-counts one source in manifest
         accounting and T07 Source Completeness aggregation, and doubles the I3
         sibling-interference surface. Violates contract PRECONDITIONS
         ("no duplicate groupId/questionId").
         REPAIR: create loop rejects duplicate questionId across selectedGroups
         (MULTI_GROUP_DUPLICATE_QUESTION_ID, fail closed).
RC2 P2   Load gate had no partial ↔ paginationStatus coherence: a persisted
         shape-valid partial=true + paginationStatus='complete' (T07-forbidden pair)
         loaded cleanly, RESUMED (hashes valid → reuse), and then
         applySourceCompletenessToCoverageState threw coverage_invalid_state
         mid-controller — wedging instead of corrupt→fresh. Breaks CE-18 ("derived
         updates always apply") with the same structure as the R2-F5 wedge family;
         the R3-FB2 flag-coherence gate did not cover partial.
         REPAIR: isValidGroupEntry enforces partial === (paginationStatus ===
         'partial') — the exact invariant every live flow maintains (capture derives
         partial from status; failure downgrade and stale reset set the neutral pair).
RC3 P3   isValidGroupEntry type-validated mirror valid/questionId but NOT the mirror
         count fields: persisted garbage (capturedAnswerCount:{injected:'object'},
         reportedAnswerCount:'not-a-number') loaded → resumed → flowed into
         VerifiedGroupRefs and manifest.groups[].reportedAnswerCount (T12 accounting
         surface, I7 hygiene). Not a reuse-lie (refs still bound to real artifact
         hashes), hence P3.
         REPAIR: load gate requires both mirror count fields to be integer-or-null
         (live flows build them via intOrNull; absent/non-integer → corrupt).

R4 TDD = RED at exact 05f0133 (50 tests / 47 pass / 3 fail — /tmp/t09_red_r4.log;
         the 3 failures are exactly RC1/RC2/RC3; the 47 pre-existing tests show zero
         perturbation)
         → append-only repair (this round) → GREEN 50/50
         → full regression 470/470 (420 pre-existing + 50 focused; /tmp/t09_regression_r4.log)

Repair edits (append-only, single repair commit):
  1. createMultiGroupExecutionState: seenQuestionIds set + MULTI_GROUP_DUPLICATE_QUESTION_ID.
  2. isValidGroupEntry: partial ↔ paginationStatus bidirectional coherence gate.
  3. isValidGroupEntry: mirror count-field integer-or-null type gate.

Round C reviewer probes (evidence /tmp/t09_round_c_probes.mjs — reviewer-authored,
run against exact 05f0133): C1 dup-questionId = NOT CAUGHT (=RC1), C2 mirror-garbage
= NOT CAUGHT (=RC3), C3 partial+complete = NOT CAUGHT (=RC2), C4 key-order drift =
defense held (clean reuse, order-independent comparisons), C5 garbage recorded hash
= defense held (stale reset, over-invalidation only, fail-closed).
```

## FRESH REVIEW ROUND D — CONVERGENCE FINDINGS + REPAIR (R5-D1..D4)

Fresh review @ exact a5863a7 (post-R4 repair SHA). VERDICT: CHANGES_REQUESTED —
convergence nearly complete: NO P1/P2 remain; 4×P3 residual bookkeeping/robustness
gaps. All 14 prior findings (F1..F8, FB1..FB3, RC1..RC3) verified CLOSED_VERIFIED.
Reviewer over-rejection evidence (O1–O6): six module-produced states (legal
verify-false+partial, handoff gate failure, capture failure, verify crash,
asymmetric progress, unknown pagination) persist→load→resume ALL ACCEPTED — the
R4 gates reject nothing the module itself can write.

ID  PRI  FINDING + REPAIR
--  ---  --------------------------------------------------------------------------------
D1  P3   RC3 gate required integer-or-null mirror counts but not NON-NEGATIVE:
         persisted verification.reportedAnswerCount=-3 (intOrNull can never produce
         a negative — it is null-or-(int>=0)) loaded → reused → flowed into
         manifest.groups[].reportedAnswerCount. Violates the module's own
         "not-producible persisted combination = corruption → fresh" standard.
         REPAIR: both mirror count gates tightened to integer && >= 0 (exact
         intOrNull domain).
D2  P3   Mirror-count ADOPTION invariant not re-checked at load: verify success
         copies a non-null mirror capturedAnswerCount into the entry; a persisted
         divergence (entry=99, mirror=3) is not producible, loaded → reused →
         inflated T07 Source Completeness accounting (selectedCount=99 /
         verifiedCount=99; validator internally self-consistent, no wedge —
         accounting lie only).
         REPAIR: FB2 verified block requires verification.capturedAnswerCount
         !== null ⇒ entry capturedAnswerCount === mirror value.
D3  P3   stage had enum validation only — no stage↔flags production mapping. Not-
         producible combinations (stage='pending' ∧ captured/verified/handoffValid
         all true; stage='handed_off' ∧ handoffValid=false) loaded → reused. No
         validity lie (derivation reads flags, refs correctly excluded — reviewer
         probe D3a), but bookkeeping distortion for stage-driven external consumers.
         REPAIR: isValidGroupEntry enforces the exact production mapping —
         pending ⇒ all flags false; captured ⇒ captured ∧ ¬verified ∧
         ¬handoffValid ∧ ¬failed; verified ⇒ captured ∧ verified ∧ ¬handoffValid ∧
         ¬failed; handed_off ⇒ all three true ∧ ¬failed; failed ⇒ failed ∧
         ¬verified ∧ ¬handoffValid (captured free: pre-capture and post-capture
         failures are both live outcomes).
D4  P3   executeGroupCapture: existsSync → sha256File with no try/catch — a
         directory (or permission loss / TOCTOU swap) at the answers.json path made
         EISDIR escape the controller as a raw filesystem exception, violating the
         module's own "controller failure → value-free {code,class} group failure"
         pattern (adapter throw and runner throws are both caught; only the hash
         step was bare). Same shape at executeGroupHandoff for handoff.json.
         REPAIR: hash BEFORE any state mutation, wrapped in try/catch → capture:
         markGroupFailed(CAPTURE_ARTIFACT_MISSING, 'contract'); handoff:
         g.failure = {HANDOFF_ARTIFACT_MISSING, 'contract'} (failed NOT set —
         coverage forbids failed && verified), matching each function's existing
         missing-artifact failure pattern. Resume path already immune
         (validateArtifactCheckpoint catches internally → stale).

R5 TDD = RED at exact a5863a7 (54 tests / 50 pass / 4 fail — /tmp/t09_red_r5.log;
         the 4 failures are exactly D1/D2/D3/D4; the 50 pre-existing tests show zero
         perturbation)
         → append-only repair (this round) → GREEN 54/54
         → full regression 474/474 (420 pre-existing + 54 focused; /tmp/t09_regression_r5.log)

Repair edits (append-only, single repair commit):
  1. isValidGroupEntry: mirror count gates → non-negative integer-or-null (D1).
  2. isValidGroupEntry verified block: mirror/entry count adoption invariant (D2).
  3. isValidGroupEntry: stage↔flags production-mapping gate (D3).
  4. executeGroupCapture: pre-mutation hash try/catch → value-free failure (D4).
  5. executeGroupHandoff: pre-mutation hash try/catch → value-free failure (D4).

Round D reviewer probes (evidence /tmp/t09_round_d_probes.mjs +
/tmp/t09_round_d_overreach.mjs, run against exact a5863a7): D1-probe negative
mirror = NOT CAUGHT (=D1); D2-probe count divergence = NOT CAUGHT (=D2); D3-probe
stage/flags = NOT CAUGHT (=D3); forged verifiedGroupRefs + garbage manifest +
researchComplete=true = CAUGHT (whole file rejected by the FB2 gate — fabricated
refs never consumed); directory-at-answers-path = NOT CAUGHT (=D4, EISDIR escape).
```

## FRESH REVIEW ROUND E — CONVERGENCE FINDINGS + REPAIR (R6-E1..E3)

Fresh review @ exact db10418 (post-R5 repair SHA). VERDICT: CHANGES_REQUESTED —
2×P2 + 1×P3 observation. 16 of 18 prior findings strictly CLOSED_VERIFIED;
RC2 → PARTIAL (wedge family forged variant still open) and D3 → PARTIAL (register
mapping incomplete — one over-rejection). Round D's D4/D1/D2 and all Round A/B/C
repairs withstood scrutiny. Reviewer probes also re-confirmed: __proto__ via raw
JSON round-trip = defense held (E2-probe).

ID  PRI  FINDING + REPAIR
--  ---  --------------------------------------------------------------------------------
E1  P2   OVER-REJECTION (D3 regression): executeGroupVerify's legal valid=false
         supersede branch (R2-F1b) cleared failed/failure but left stage='failed' →
         the module legally produces {stage:'failed', failed:false, captured:true}
         (verify crash → retry → legal invalid). persist accepts; the D3 load gate
         rejects stage='failed' ∧ ¬failed → whole state loads as null → resume
         fresh → the composed SIBLING group is discarded on every
         crash→retry→persist cycle. Violates Round D's repair mandate ("must accept
         every state the module itself can produce") and the contract's reuse
         guarantees.
         REPAIR: the supersede branch restores g.stage = GROUP_STAGE_CAPTURED (the
         group is by definition captured at that point — verify's precondition).
         Production mapping now complete: every live-flow tuple passes the gate.
E2  P2   RC2 wedge family, forged variant: no gate bound paginationStatus:'complete'
         to captured:true. {captured:false, paginationStatus:'complete',
         stage:'pending'} is not producible (only capture SUCCESS writes
         complete/partial, always with captured=true; failure downgrades and stale
         resets write 'unknown'), but loaded → resumed → reused →
         buildSourceCompletenessUpdate emitted evidenceRef:null → the T07 validator
         threw coverage_invalid_state mid-controller — a permanent wedge (CE-18
         broken for this forgery).
         REPAIR: isValidGroupEntry clause — !captured ⇒ paginationStatus==='unknown'
         (also subsumes the lazy partial=true ∧ captured=false forgery).
E3  P3   (non-blocking observation, folded in) FB2 gated the mirror only when
         verified=true; a forged {verified:false, stage:'captured',
         verification:{valid:true,...}} loaded with LAZY acceptance (refs stay 0
         until full recomposition; mirror overwritten on re-verify; no validity
         lie). Live flows write only {valid:false} mirrors (or null) for
         non-verified groups, so a valid=true mirror without verified=true is not
         producible.
         REPAIR (hardening, in the same repair commit): verification block rejects
         !verified ∧ verification.valid===true.

R6 TDD = RED at exact db10418 (57 tests / 54 pass / 3 fail — /tmp/t09_red_r6.log;
         failures exactly E1/E2/E3 with intended assertions; the 54 pre-existing
         tests show zero perturbation. Note: the first RED attempt failed for a
         HARNESS reason (runGroupFlow invoked handoff on a not-verified group →
         precondition throw before any assertion); the harness was corrected to
         per-primitive driving and RED was re-captured cleanly at the same exact
         SHA with the lib changes stashed — the committed RED evidence is the
         corrected run.)
         → append-only repair (this round) → GREEN 57/57
         → full regression 477/477 (420 pre-existing + 57 focused; /tmp/t09_regression_r6.log)

Repair edits (append-only, single repair commit):
  1. executeGroupVerify supersede branch: restore stage to GROUP_STAGE_CAPTURED (E1).
  2. isValidGroupEntry: !captured ⇒ paginationStatus==='unknown' production clause (E2).
  3. isValidGroupEntry verification block: !verified ∧ mirror.valid===true → corrupt (E3).

Round E reviewer probes (evidence /tmp/t09_round_e_probes.mjs, run against exact
db10418): E1-probe crash→retry→persist→resume = NOT CAUGHT (sibling discarded —
=E1); E4-probe captured=false+complete = NOT CAUGHT (coverage wedge — =E2);
E3-probe forged valid=true mirror = lazy acceptance (=E3, hardened);
__proto__-via-JSON probe = CAUGHT (defense held).
```

## FRESH REVIEW ROUND F — CONVERGENCE FINDINGS + REPAIR (R7-F1..F2)

Fresh review @ exact 8c80c8f (post-R6 repair SHA). VERDICT: CHANGES_REQUESTED —
1×P2 + 1×P3, both narrow. ALL 21 prior findings (F1..F8, FB1..FB3, RC1..RC3,
D1..D4, E1..E3) verified CLOSED_VERIFIED. The E1 repair survived the reviewer's
independent over-rejection sweep: 6 producible failure/retry tuples
(A1 handoff-gate-failure + sibling, A2 crash-mirror, A3 recapture-after-mirror,
A4 capture-failure-after-capture, A5 partial capture, A6 never-captured failure,
A1b recompose-after-resume) ALL persist→load→resume ACCEPTED with composed
siblings preserved.

ID  PRI  FINDING + REPAIR
--  ---  --------------------------------------------------------------------------------
F1  P2   Third variant of the wedge family: the load gate enforced two of the three
         pagination production invariants (RC2 partial↔status; E2 !captured⇒unknown)
         but not failed ⇒ paginationStatus==='unknown'. markGroupFailed ALWAYS
         downgrades to unknown+partial=false, and every complete/partial writer
         clears failed synchronously — so the forged tuple {captured:true,
         verified:false, stage:'failed', failed:true, failure:{code,class},
         paginationStatus:'complete', partial:false} (over hash-valid artifacts)
         is not producible, yet it loaded → resume reused it →
         buildSourceCompletenessUpdate emitted failed ∧ complete → the T07
         validator threw coverage_invalid_state mid-controller (CE-18; reviewer
         probe B, empirically confirmed; the fully-composed variant of the same
         forgery was already caught by the failed⊥verified gate — defense held).
         REPAIR: isValidGroupEntry clause — failed ⇒ paginationStatus==='unknown'
         (also closes the failed∧partial variant; reviewer over-rejection scan
         confirms every producible failed tuple carries 'unknown').
F2  P3   The persisted verification mirror accepted arbitrary extra keys (live
         flows write exactly four production keys). Lazy — no consumer reads
         mirror extras, no validity/accounting effect — but inconsistent with the
         failure {code,class} strictness and the CE-22 exact-production-shape
         philosophy.
         REPAIR: mirror whitelisted to GROUP_VERIFICATION_KEYS = [valid,
         questionId, capturedAnswerCount, reportedAnswerCount] (rejects nothing
         producible).

R7 TDD = RED at exact 8c80c8f (59 tests / 57 pass / 2 fail — /tmp/t09_red_r7.log;
         failures exactly F1 (both tamper variants) and F2 with intended
         assertions; the 57 pre-existing tests show zero perturbation)
         → append-only repair (this round) → GREEN 59/59
         → full regression 479/479 (420 pre-existing + 59 focused; /tmp/t09_regression_r7.log)

Repair edits (append-only, single repair commit):
  1. isValidGroupEntry: failed ⇒ paginationStatus==='unknown' production clause (F1).
  2. GROUP_VERIFICATION_KEYS constant + mirror key whitelist in the
     verification block (F2).

Round F reviewer probes (evidence /tmp/t09_round_f_probes.mjs, run against exact
8c80c8f): probe B failed∧complete = NOT CAUGHT (=F1, wedge confirmed
empirically); probe A 7-check over-rejection sweep = ALL ACCEPTED (defense held —
no producible tuple rejected); probe C mirror extra key = lazy (=F2); probe D
E1-roundtrip independent re-drive = CAUGHT (reuse, sibling preserved); probe E
E2/E3 direct re-probes = CAUGHT at load.
```

## FRESH REVIEW ROUND G — FINAL CONVERGENCE: PASS_WITH_NONBLOCKING_FINDINGS

Fresh review @ exact 4789382 (post-R7 repair SHA). VERDICT: **PASS** — blocking
findings: none. All 23 registered findings (F1..F8, FB1..FB3, RC1..RC3, D1..D4,
E1..E3, Round-F F1..F2) independently re-verified CLOSED_VERIFIED with line-level
citations. Reviewer's own probes:

- G1 over-rejection sweep (3 producible sub-probes: partial-capture→crash→
  supersede→persist→resume with sibling; recapture-after-crash; handoff-stale
  recorded hash on handoffValid:false): ALL ACCEPTED, composed work preserved.
- G2 wedge-family exhaustive sweep (15 forged variants through
  load→resume→applySourceCompletenessToCoverageState): ALL rejected at load
  (corrupt→fresh, no_state); the T07 hook never throws mid-controller — CE-18
  holds end-to-end; the RC2/E2/F1 clause family exactly covers the T07 forbidden
  set as emitted by buildSourceCompletenessUpdate.
- G3 two non-blocking P3 observations (EXTERNAL_REVIEW_POOL — see OVERRIDE
  classification below): (a) forged researchComplete=true over all-pending groups
  loads but is never read and is recomputed to false at resume (healed, inert);
  (b) forged failure identity on a handoffValid group loads but failure is read
  by no derivation/coverage path (inert bookkeeping). Both are not-producible-
  but-inert handcrafted states that fail safely at the repo boundary; coherence
  gates for them are DEFERRED unless external consumers of the raw loaded object
  appear.

## CONVERGENCE OVERRIDE (PRODUCT-OWNER, 2026-09-04) — APPLIED TO THIS REGISTER

The product owner issued a convergence override governing the remainder of the
T09 lane. Its rules, as applied to this register and the third-party review:

1. P0/P1 remain mandatory blockers.
2. P2 blocks ONLY if P2_CORE: reachable through the ticket's OWNED
   runtime/persistence boundary AND violates an explicit T09 hard invariant AND
   materially affects correctness/identity/resume/security/validity.
   P2_ADJACENT / defensive-hardening findings are NON-BLOCKING and are recorded
   in an external-review pool.
3. P3 is non-blocking by default; no further repair round is opened for P3-only
   findings.
4. The reviewer may return PASS_WITH_NONBLOCKING_FINDINGS.
5. State-validation scope: distinguish REACHABLE_PRODUCTION_STATE from
   ARBITRARY_HOSTILE_HANDCRAFTED_STATE. The module is NOT authorized to become a
   general formal state-schema engine; the requirement is that hostile input
   FAILS SAFELY at the repo boundary (no refs/manifest/coverage/accounting
   effect), not that every theoretically malformed tuple is rejected.
6. No new invariant is introduced merely for internal consistency.
7. Any proposed repair must pass the regression-risk test: does it reject a
   currently legal runtime state? (This test is retrospective — Round E's E1
   over-rejection is the standing example of why it exists.)
8. Classification outcome for Round G: P0=0, P1=0, P2_CORE=0 → Fresh Review
   final status = PASS_WITH_NONBLOCKING_FINDINGS; the fresh-repair loop is
   STOPPED (no R8); the candidate code SHA is preserved at 4789382 (this
   registration commit is docs-only and does not touch lib/ or test/).
9. THIRD-PARTY ADVERSARIAL REVIEW proceeds on the same blocking classification
   (P0/P1/P2_CORE block; P2_ADJACENT + P3 → external-review pool; verdicts may
   be PASS | PASS_WITH_NONBLOCKING_FINDINGS | CHANGES_REQUESTED) and is bounded
   to a single review round — it is not another unlimited hardening round.
```

## THIRD-PARTY ADVERSARIAL REVIEW — TASK #11 (SINGLE ROUND, OVERRIDE CLASSIFICATION)

REVIEWED_CODE_SHA: 4789382 (branch tip c49530a verified docs-only ahead — delta
touches only this register). External-grade reviewer, independent of the
implementation and of all internal fresh-review rounds. 23 empirical probes run
against exact-HEAD module + real flows; contract re-derived independently from
the contract text (register treated as claims, not evidence).

VERDICT: **PASS_WITH_NONBLOCKING_FINDINGS** — P0=0, P1=0, P2_CORE=0.

BLOCKING_FINDINGS: none.

EXTERNAL_REVIEW_POOL (non-blocking, per CONVERGENCE OVERRIDE):
- N1 (P2_ADJACENT) create accepts arbitrarily long groupIds while the persist
  safety walker (rrf.mjs BOUNDARY_MAX_STRING_LENGTH=500) rejects any groups-map
  key >500 chars — a hostile handcrafted decision with a >501-char groupId
  executes fully in-memory but can never be checkpointed (work lost on restart).
  Non-blocking: unreachable via module-produced state (T08 carries
  groupId===questionId canonical numeric), violates no hard invariant (I9 is
  exactly why persist rejects), fails safe at the repo boundary (stable value-free
  reason, nothing written, controller not wedged). Repair direction if ever
  taken: align create's groupId bound with the persist walker (regression-risk
  test passes — no legal runtime state has long groupIds).
- N2 (P3) loadMultiGroupState nulls wrong-typed files so the resume
  type/schemaVersion INCOMPATIBLE branch is dead code — same fail-closed outcome
  (fresh, boundary 'no_state'); label-only semantics.
- N3 (P3) re-capture of a previously verify-failed group does not clear the stale
  {valid:false} mirror — inert (verified=false governs derivation; next verify
  overwrites).
- N4 (P3) persisted verifiedGroupRefs/manifest are shallow-checked and never
  consumed before authoritative recomputation at resume (forged refs+manifest+
  researchComplete healed) — confirms Round-G G3's deferred classification.

SPOT_AUDIT (6 highest-risk closures): CE-20 plan binding / FB1 decision
cross-binding / F5 set equality / D3 stage mapping / Round-F F1 failed⇒unknown /
E1 supersede restoration — ALL SPOT_AUDIT_VERIFIED, each with an independent
empirical probe (incl. CE-20 transitivity through the resume REUSE path:
planHash/poolPlanHash are inside the decision-identity hash domain, so hash
equality ⇒ CE-20-valid recorded decision).

ADVERSARIAL_PROBES (23): IDENTITY 4/4 defense held (order-canonicalization,
cross-mapped questionIds → selection_decision boundary, CE-20 transitivity,
duplicate-keyed divergence fail-closed); PERSISTENCE 6 probes — torn writes/BOM/
trailing garbage all load-null, __proto__ rejected, truncated hash → stale,
null-count mirror accepted (over-rejection pass), content-swap with forged hashes
correctly out of T09 scope (I8 verify authority), oversized groupId = N1;
DERIVATION 4/4 held (mixed-validity accounting exact, finalize throws, partial
ledger coherent, forged projections healed); RESUME boundary-label sweep correct
across all drift classes; byte-identical manifest on invalidate→re-execute (I7
determinism); OVER-REJECTION sweep 7/7 producible tuples accepted with composed
siblings preserved.

TESTS_OBSERVED: focused 59/59 + full regression 479/479, independently re-run at
exact HEAD by the external reviewer (matching Round-G figures).

Gate outcome: fresh review (Round G) + third-party review both
PASS_WITH_NONBLOCKING_FINDINGS with zero blocking findings on the same code SHA
4789382. Lane proceeds to Task #12 (PR + real CI + post-CI fresh contract
review). External-review pool (G3 x2, N1–N4) is carried into the PR description
for merge-gate visibility.
