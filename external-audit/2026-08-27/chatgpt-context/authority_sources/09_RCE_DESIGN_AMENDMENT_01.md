# RCE Design Amendment 01 — Selector Baseline Revision

STATUS: DESIGN_FROZEN_AMENDMENT  
VERSION_ASSIGNMENT: UNASSIGNED  
IMPLEMENTATION_AUTHORIZATION: NONE  
AMENDMENT_DATE: 2026-08-28  
AMENDMENT_BASIS: P1_DECISION_GRADE_EVIDENCE_GATE_01 (PASS_WITH_CAVEATS)

---

## 1. Amendment Authority

This amendment is based on:

```text
P1_DECISION_GRADE_EVIDENCE_GATE_01 = PASS_WITH_CAVEATS
EVIDENCE_SUPPORTED_OUTCOME = PROCEED_WITH_SIMPLIFICATION
P1_GATE01_CHATGPT_FORMAL_REVIEW_V2 = approved the evidence outcome and requested this amendment
RCE_DESIGN_AMENDMENT_01_CHATGPT_REVIEW_V1 = CHANGES_REQUESTED_NARROW (authority integration fixes)
```

It modifies the selector baseline authority in:

- `00_SOURCE_AUTHORITY_AND_STATUS.md` (authority hierarchy update)
- `02_RESEARCH_COVERAGE_ENGINE_FINAL.md` (§3, §12, §13, §21)
- `04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md` (§3 A06, A07; §8)

---

## 2. Evidence Summary

### 2.1 Gate 01 Evidence Base

- Two real cross-domain cases: low-code enterprise software + medical (H. pylori treatment)
- 216 captured sources across 5 medical questions + existing low-code corpus
- Four fair strategies compared: B0 popularity, B1 dense semantic, B2 question-stratified, B3 MMR+lanes
- Second adjudication: 47 labels, must_see 22→13, winner sensitivity HIGH
- All selections frozen; rescore only (no rerun)

### 2.2 Key Findings

At adjudicated medical K=15:

```text
                    B2 q-strat       B3 MMR+lanes
must-see             3/13             4/13
aspect                .857             .714
minority min          .050             .000
redundancy            .852             .825   lower is better
relative ops          380              8445
```

Cross-domain consistency:

1. B0 popularity is top-tier anchor but not exclusive dominance
2. B2 uniquely protects minority-question coverage across both domains
3. B3 has no stable cross-domain unique coverage gain
4. B3's consistent advantage is redundancy reduction only
5. B3_ORACLE (gold lanes) fails to provide must-see upper bound

### 2.3 Architecture Decision

```text
EVIDENCE_SUPPORTED_ARCHITECTURE_OUTCOME = OUTCOME A
PROCEED_WITH_SIMPLIFICATION
```

This is an engineering decision, not a mechanically proven statistical winner. The preregistered expression `B2 ~= or > B3` did not define a numeric equivalence margin.

---

## 3. Selector Baseline Revision

### 3.1 Previous Authority (Frozen RCE)

From `02_RESEARCH_COVERAGE_ENGINE_FINAL.md` §3, §13:

```text
MMR
+
Multi-lane Exploration Constraints
```

With six hard lanes:

- Mainstream
- Expert
- Evidence-rich
- Fresh
- Long-tail / Novel
- Contradictory

### 3.2 Revised Authority (This Amendment)

The first architecture baseline is now expressed as:

```text
Question / Source-group Preservation
+
Popularity Anchor
+
Dense Semantic Relevance / Novelty
+
Optional Lightweight Redundancy Control
```

This is intentionally NOT equivalent to `ship B2 as-is`.

### 3.3 Core Implications

1. **Question/source-group provenance and preservation** becomes a first-class selector constraint.

2. **Popularity** remains a strong anchor/feature, but never truth authority.

3. **Dense embedding** remains core semantic geometry for relevance, novelty, redundancy, clustering and aspect matching.

4. **MMR** is demoted from mandatory core selector to an optional/lightweight redundancy mechanism subject to cost and benefit.

5. **Six hard selector lanes** are not justified as baseline constraints by current evidence.

---

## 4. Lane Relocation

The information dimensions remain part of the product contract; only their hard-quota selector role is removed from the first baseline.

```text
Mainstream      -> retrieval / soft popularity feature
Expert          -> retrieval signal + topic-conditioned soft feature
Evidence-rich   -> retrieval signal + soft feature
Fresh           -> retrieval/time policy + diagnostic
Long-tail       -> soft marginal-value / novelty feature
Contradictory   -> opposing-query generation + claim-stage diagnostic
```

### 4.1 Detailed Lane Status

| Lane | Previous Role | New Role | Rationale |
|---|---|---|---|
| Mainstream | Hard quota lane | Retrieval signal + soft popularity feature | Vote count already a core B0 signal; no independent selector justification |
| Expert | Hard quota lane | Retrieval signal + topic-conditioned soft feature | Credential-topic match valuable but not selector-level constraint |
| Evidence-rich | Hard quota lane | Retrieval signal + soft feature | Mechanical markers useful but not selector constraint |
| Fresh | Hard quota lane | Retrieval/time policy + diagnostic | Minimal fresh-window substance in current corpus |
| Long-tail | Hard quota lane | Soft marginal-value / novelty feature | Zero-vote + substantive = ranking signal, not quota |
| Contradictory | Hard quota lane | Opposing-query generation + claim-stage diagnostic | No independent production signal at selector level |

---

## 5. Evidence Limitations That Must Survive Into Spec

Do not erase these caveats:

1. Only two real cross-domain decision cases support the selector architecture comparison.
2. The medical second adjudication was partially contaminated by prior sensitivity-ID disclosure.
3. `relative_compute_ops` is a harness-relative cost proxy, not production cost.
4. B3 still wins must-see by 1–2 sources in the adjudicated medical case and has an XQ advantage at K=24.
5. Dense Top-K being weak does not imply dense embeddings are weak.
6. The current evidence supports removing hard six-lane quotas, not deleting expertise/evidence/freshness/long-tail/contradiction information from the product.
7. P2/P3 remain design-only and are not unlocked by this P1 gate.

---

## 6. Replaceability / Future Candidate Boundary

The simplified architecture preserves replacement seams for:

- MMR (optional redundancy control)
- xQuAD (aspect-aware diversification)
- Submodular optimization (coverage + representativeness)
- DPP (quality + diversity)
- Trained LTR (learned feature weights)

These remain FUTURE_CANDIDATE per `04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md` §4.

The amendment does NOT:

- Delete any information dimension from the product contract
- Remove benchmark hooks for future algorithms
- Authorize production implementation
- Assign product version

---

## 7. Authority Index Update

This amendment overrides the following sections in the frozen RCE documents:

### 7.1 `02_RESEARCH_COVERAGE_ENGINE_FINAL.md`

- §3 V1 Core Pipeline: Replace `MMR + Multi-lane Exploration Constraints` with revised selector baseline
- §12 Multi-lane Inclusion: Demote from hard selector constraint to retrieval/ranking signals
- §13 MMR — V1 Main Selector: Demote to optional redundancy mechanism
- §21 Freeze: Update RCE_V1 formula

### 7.2 `04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md`

- §3 A06 MMR: Update status from V1 CORE to OPTIONAL_REDUNDANCY_MECHANISM
- §3 A07 Multi-lane Exploration: Update status from V1 DESIGN MECHANISM to RETRIEVAL_SIGNALS
- §8 Final Engineering Decision: Update V1 implementation list

### 7.3 Documents NOT Affected

- `01_PRODUCT_DIRECTION_FINAL.md` — unchanged
- `03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL.md` — unchanged
- `05_OFFICIAL_AND_OSS_DISCOVERY_NOTES.md` — unchanged
- `06_DESIGN_HISTORY_AND_OPEN_QUESTIONS.md` — unchanged
- `07_RESEARCH_SECURITY_AND_CROSS_SOURCE_SYNTHESIS_GUARDRAILS.md` — unchanged
- `08_DISCOVERY_EVIDENCE_APPENDIX.md` — unchanged

---

## 8. Implementation Status

```text
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_FINAL_REVIEW
```

This amendment updates the design authority only. No production code has been written or authorized.

---

## 9. Next Gate

After this amendment is accepted:

```text
NEXT_GATE = ARCHITECTURE_SPEC_PREPARATION
```

The architecture spec may now proceed against the revised selector baseline.

---

## 10. Amendment Metadata

```text
amendment_id: RCE_DESIGN_AMENDMENT_01
amendment_date: 2026-08-28
basis: P1_DECISION_GRADE_EVIDENCE_GATE_01 (PASS_WITH_CAVEATS)
review_request: P1_GATE01_CHATGPT_FORMAL_REVIEW_V2 (approved evidence, requested amendment)
review_status: RCE_DESIGN_AMENDMENT_01_CHATGPT_REVIEW_V1 = CHANGES_REQUESTED_NARROW (authority integration fixes)
review_closure: RCE_DESIGN_AMENDMENT_01_AUTHORITY_CLOSURE_CHATGPT_FINAL_REVIEW = PASS
scope: selector baseline + lane relocation
documents_modified: 00_SOURCE_AUTHORITY_AND_STATUS.md, 02_RESEARCH_COVERAGE_ENGINE_FINAL.md, 04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md
documents_unaffected: 01, 03, 05, 06, 07, 08
implementation_status: NOT_IMPLEMENTED
```