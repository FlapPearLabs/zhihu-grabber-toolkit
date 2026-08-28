# RCE_DESIGN_AMENDMENT_01_REVIEW_PACKET_FOR_CHATGPT

## A. Remote Branch / Exact Final SHA

```text
REMOTE_BRANCH : dg01-decision-grade-gate           (pushed to origin)
CONTENT_COMMIT: caec4b0fbedc5811b98361e107e9b3cd4a5954dc
TIP_COMMIT    : fb44ce0c44a1372931819d3a809abc91b4fa00b6
BASE_SHA      : c3f5e9c26e1a330f63fbbd85ede9a96a2db824b0
AMENDMENT_COMMIT: <this packet's commit SHA>

远端验证:
  git ls-remote origin dg01-decision-grade-gate
  -> fb44ce0c44a1372931819d3a809abc91b4fa00b6  refs/heads/dg01-decision-grade-gate
```

---

## B. Evidence Hygiene Fixes Applied

### H1 — Validator Comment (validate-rescore.mjs)

**Before:**
```text
//   R4 rescored metric computation deterministic & complete (all 60 hpylori
//      runs + 27 cross-lowcode fair runs)
```

**After:**
```text
//   R4 rescored metric computation deterministic & complete (all 15 hpylori
//      runs + 12 cross-lowcode fair runs)
```

**Status:** FIXED

### H2 — `must_see_hits` Field Semantics (decision-tables.json)

**Before:** cross-lowcode rows contained recall ratio (e.g., 0.2, 0.13333333333333333)

**After:** cross-lowcode rows contain integer hit count (e.g., 3, 2)

**Verification:**
```text
cross-lowcode must_see scorable: 15
Fixed B0_POPULARITY_TOP_K@K_SMALL: 0.2 -> 3 (recall=0.200)
Fixed B1_DENSE_SEMANTIC_TOP_K@K_SMALL: 0.13333333333333333 -> 2 (recall=0.133)
Fixed B2_QUESTION_STRATIFIED_SIMPLE@K_SMALL: 0.06666666666666667 -> 1 (recall=0.067)
Fixed B3_DENSE_MMR_MULTI_LANE@K_SMALL: 0.06666666666666667 -> 1 (recall=0.067)
Fixed B0_POPULARITY_TOP_K@K_MEDIUM: 0.4 -> 6 (recall=0.400)
Fixed B1_DENSE_SEMANTIC_TOP_K@K_MEDIUM: 0.2 -> 3 (recall=0.200)
Fixed B2_QUESTION_STRATIFIED_SIMPLE@K_MEDIUM: 0.2 -> 3 (recall=0.200)
Fixed B3_DENSE_MMR_MULTI_LANE@K_MEDIUM: 0.2 -> 3 (recall=0.200)
Fixed B0_POPULARITY_TOP_K@K_LARGE: 0.5333333333333333 -> 8 (recall=0.533)
Fixed B1_DENSE_SEMANTIC_TOP_K@K_LARGE: 0.4666666666666667 -> 7 (recall=0.467)
Fixed B2_QUESTION_STRATIFIED_SIMPLE@K_LARGE: 0.5333333333333333 -> 8 (recall=0.533)
Fixed B3_DENSE_MMR_MULTI_LANE@K_LARGE: 0.4 -> 6 (recall=0.400)
```

**Status:** FIXED

### H3 — Adjudication Status Metadata (GOLD_AFTER_SECOND_ADJUDICATION.json)

**Before:** All families had `PROVISIONAL` label_status

**After:** Family-specific status wording:

```text
relevance: PROVISIONAL
must_see: SECOND_ADJUDICATED
aspect_membership: PARTIALLY_SECOND_ADJUDICATED
expertise_topic_match: PROVISIONAL
evidence_quality: PROVISIONAL
evidence_presence: MECHANICAL_CONFIRMED
freshness: MECHANICAL_WINDOW_AND_PROVISIONAL_RELEVANCE
unique_long_tail_contribution: PROVISIONAL
contradiction: PARTIALLY_SECOND_ADJUDICATED
required_provenance_groups: PROVISIONAL
historical_authority: UNRESOLVED

overall label_status_policy: PARTIALLY_SECOND_ADJUDICATED
provenance.label_status: PARTIALLY_SECOND_ADJUDICATED
```

**Status:** FIXED

---

## C. RCE Design Amendment 01

### C.1 Amendment Document

Created: `external-audit/2026-08-27/chatgpt-context/authority_sources/09_RCE_DESIGN_AMENDMENT_01.md`

**Scope:** Selector baseline revision only

**Authority basis:**
```text
P1_DECISION_GRADE_EVIDENCE_GATE_01 = PASS_WITH_CAVEATS
EVIDENCE_SUPPORTED_OUTCOME = PROCEED_WITH_SIMPLIFICATION
CHATGPT_FORMAL_REVIEW_V2 = ACCEPTED
```

### C.2 Selector Baseline Revision

**Previous authority (frozen RCE):**
```text
MMR + Multi-lane Exploration Constraints
```

**Revised authority (this amendment):**
```text
Question / Source-group Preservation
+
Popularity Anchor
+
Dense Semantic Relevance / Novelty
+
Optional Lightweight Redundancy Control
```

### C.3 Lane Relocation

```text
Mainstream      -> retrieval / soft popularity feature
Expert          -> retrieval signal + topic-conditioned soft feature
Evidence-rich   -> retrieval signal + soft feature
Fresh           -> retrieval/time policy + diagnostic
Long-tail       -> soft marginal-value / novelty feature
Contradictory   -> opposing-query generation + claim-stage diagnostic
```

### C.4 Authority Files Updated

1. `02_RESEARCH_COVERAGE_ENGINE_FINAL.md`
   - §3 V1 Core Pipeline: Updated pipeline diagram and algorithm list
   - §12 Multi-lane Inclusion: Added amendment note for lane relocation
   - §13 MMR — V1 Main Selector: Added amendment note for MMR demotion
   - §21 Freeze: Updated RCE_V1 formula

2. `04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md`
   - §3 A06 MMR: Status changed from V1 CORE to OPTIONAL_REDUNDANCY_MECHANISM
   - §3 A07 Multi-lane Exploration: Status changed from V1 DESIGN MECHANISM to RETRIEVAL_SIGNALS
   - §8 Final Engineering Decision: Updated V1 implementation list

3. `09_RCE_DESIGN_AMENDMENT_01.md` (new)
   - Complete amendment document with evidence summary, revision details, and authority index

### C.5 Evidence Limitations Preserved

1. Only two real cross-domain decision cases support the selector architecture comparison.
2. The medical second adjudication was partially contaminated by prior sensitivity-ID disclosure.
3. `relative_compute_ops` is a harness-relative cost proxy, not production cost.
4. B3 still wins must-see by 1–2 sources in the adjudicated medical case and has an XQ advantage at K=24.
5. Dense Top-K being weak does not imply dense embeddings are weak.
6. The current evidence supports removing hard six-lane quotas, not deleting expertise/evidence/freshness/long-tail/contradiction information from the product.
7. P2/P3 remain design-only and are not unlocked by this P1 gate.

---

## D. Validation Results

### D.1 Tests

```text
Command: node --test "tests/*.test.mjs"
Result: 41/41 pass, 0 fail
Environment: Windows 11 + node v22.22.2
```

### D.2 Validators

```text
D2.1 validator: ALL_VALIDATIONS_PASSED (8/8)
Race validator: ALL_VALIDATIONS_PASSED (9/9)
Rescore validator: ALL_RESCORE_VALIDATIONS_PASSED (5/5)
Adjudication input validator: SECOND_ADJUDICATION_INPUT_VALIDATION = PASS (6/6)
```

### D.3 Evidence Hygiene Verification

```text
H1: validate-rescore.mjs comment corrected (60/27 -> 15/12)
H2: decision-tables.json must_see_hits corrected (12 cross-lowcode rows)
H3: GOLD_AFTER_SECOND_ADJUDICATION.json status metadata updated (11 families + provenance)
```

---

## E. Amendment Scope Compliance

### E.1 Permitted Actions (Completed)

- [x] Fix three non-blocking evidence hygiene issues (H1, H2, H3)
- [x] Create RCE_DESIGN_AMENDMENT_01 document
- [x] Update authority index
- [x] Update frozen RCE documents with amendment notes
- [x] Verify all changes

### E.2 Prohibited Actions (Not Performed)

- [ ] Rerun experiment
- [ ] Change Gold
- [ ] Production implementation
- [ ] P2/P3 processing
- [ ] Write Architecture Spec
- [ ] Assign product version

---

## F. Final State

```text
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_FINAL_REVIEW

P1_EVIDENCE_GATE = PASS_WITH_CAVEATS
EVIDENCE_SUPPORTED_OUTCOME = PROCEED_WITH_SIMPLIFICATION
RCE_DESIGN_AMENDMENT_01 = APPROVED_AND_APPLIED

NEXT_GATE = ARCHITECTURE_SPEC_PREPARATION
```

---

## G. Next Recommended Gate

```text
P1_GATE01_RCE_AMENDMENT_01_CHATGPT_REVIEW
```

ChatGPT should:

1. Verify the three evidence hygiene fixes are correct
2. Verify the RCE_DESIGN_AMENDMENT_01 accurately reflects the Gate 01 evidence
3. Verify the authority file updates are consistent
4. Provide PASS/CHANGES_REQUESTED verdict
5. If PASS, authorize ARCHITECTURE_SPEC_PREPARATION to proceed

---

## H. Files Changed

### New Files

1. `external-audit/2026-08-27/chatgpt-context/authority_sources/09_RCE_DESIGN_AMENDMENT_01.md`

### Modified Files

1. `evidence-gate-01/scripts/validate-rescore.mjs` (H1 comment fix)
2. `evidence-gate-01/results/adjudicated-rescore/decision-tables.json` (H2 must_see_hits fix)
3. `evidence-gate-01/cases/case-hpylori-treatment/GOLD_AFTER_SECOND_ADJUDICATION.json` (H3 status metadata fix)
4. `external-audit/2026-08-27/chatgpt-context/authority_sources/02_RESEARCH_COVERAGE_ENGINE_FINAL.md` (amendment notes)
5. `external-audit/2026-08-27/chatgpt-context/authority_sources/04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md` (amendment notes)

### Unchanged Files

- All other authority documents
- All experiment results (frozen)
- All Gold files (original gold.json untouched)
- All selector implementations (not invoked)

---

## I. Commit History

```text
fb44ce0 closure-packet: section A uses CONTENT_COMMIT + ls-remote tip convention
afbe560 closure-packet: record remote final sha (caec4b0f, ls-remote verified)
caec4b0 closure: apply ChatGPT second adjudication (47/47) + fixed-selection rescore + OUTCOME A
7c23e57 closure-prep: complete unblinding key (47/47), correct phase-C inventory doc (22/10/11/4), add rescore pipeline + validators
1e0f7bf experiment: P1 decision-grade evidence gate 01 (D2.1 evaluator correction + four-strategy race)
c3f5e9c (base) audit snapshot
```

---

## J. Amendment Metadata

```text
amendment_id: RCE_DESIGN_AMENDMENT_01
amendment_date: 2026-08-28
authorized_by: P1_DECISION_GRADE_EVIDENCE_GATE_01 (PASS_WITH_CAVEATS)
reviewed_by: ChatGPT (P1_GATE01_CHATGPT_FORMAL_REVIEW_V2)
scope: selector baseline + lane relocation
documents_modified: 02_RESEARCH_COVERAGE_ENGINE_FINAL.md, 04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md
documents_created: 09_RCE_DESIGN_AMENDMENT_01.md
implementation_status: NOT_IMPLEMENTED
```