# Zhihu CLI Pro — Independent External Audit Snapshot

Status: **READY_FOR_CLAUDE_EXTERNAL_AUDIT_WITH_DISCLOSED_RESIDUAL_GAPS**

This directory is an audit-only snapshot. It does **not** authorize production implementation and does not modify the product code on this branch outside this `external-audit/2026-08-27/` tree.

## What is here

- `chatgpt-context/` — ChatGPT Context Audit Pack V2, expanded. Contains exact Project Sources 00–08, recovered primary Track A / Track B contracts, verbatim user-intent evidence, provenance matrices, self-audit, and disclosed residual gaps.
- `workbuddy-evidence/` — WorkBuddy External Audit Pack, expanded. Contains executable benchmark harness, corpus/cases, D1 history, invalid first D2, corrected D2, adjudicated Gold, tests, review packets, and failure history.
- `review/CLAUDE_AUDITOR_PROMPT_V2.md` — balanced external-auditor instructions.
- `review/FILES_SHA256.txt` — SHA-256 for every audit file in this snapshot.

## Required reading order

1. `chatgpt-context/00_READ_ME_FIRST.md`
2. `chatgpt-context/02_AUTHORITY_AND_FROZEN_DIRECTION.md`
3. Exact `chatgpt-context/authority_sources/00...08` Project Sources
4. `chatgpt-context/09_PROVENANCE_AND_COMPLETENESS_MATRIX.md`
5. `chatgpt-context/10_CROSS_PACK_AUTHORITY_RECONCILIATION.md`
6. `workbuddy-evidence/00_READ_ME_FIRST.md`
7. `workbuddy-evidence/08_PILOT_FAILURE_AND_CORRECTION_HISTORY.md`
8. `workbuddy-evidence/10_CORRECTED_D2_RESULTS.md`
9. `workbuddy-evidence/11_OPEN_QUESTIONS.md`
10. Primary contracts and executable evidence under both packs
11. Only then read `review/CLAUDE_AUDITOR_PROMPT_V2.md` and perform the audit.

## Critical status

```text
TARGET_STATUS               = NOT_IMPLEMENTED
REAL_EMBEDDING              = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE       = NOT_READY
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT          = UNASSIGNED
D1                          = SUPERSEDED
FIRST_D2                    = INVALIDATED_BY_ASPECT_NAMESPACE_RECONCILIATION_BUG
CORRECTED_D2                = CURRENT_FINAL_PILOT_RESULT
```

## Evidence rules

- Exact primary sources beat narrative summaries.
- Corrected later artifacts beat invalidated earlier artifacts.
- ChatGPT Semantic Gold adjudication beats provisional D1 Gold for D2 evaluation.
- `RECONSTRUCTED_*` and `GENERATED_SYNTHESIS` artifacts are explicitly non-authoritative.
- WorkBuddy's historical `MISSING_ON_DISK` statements describe its local assembly environment, not project-global nonexistence; see the cross-pack reconciliation file.

## Scope warning

Track B D2 empirically tests only a subset of P1 Research Coverage hypotheses. It does not empirically validate P2 Author/Personal Intelligence or P3 Continuous Intelligence.

## External reviewer freedom

The reviewer may legitimately conclude PROCEED, PROCEED_WITH_SIMPLIFICATION, MORE_EVIDENCE_REQUIRED, or RETHINK_DIRECTION. Do not reward sunk effort or preserve mechanisms merely because they were extensively benchmarked.
