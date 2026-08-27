# Zhihu CLI Pro — Independent External Audit Snapshot

Status: **READY_FOR_CLAUDE_EXTERNAL_AUDIT_WITH_DISCLOSED_RESIDUAL_GAPS**

This branch is an audit-only snapshot based on `master@84534f539a03937b031a962b828f2e2d44c102fa`. It does **not** authorize production implementation.

## Layout

```text
external-audit/2026-08-27/
├── README.md
├── chatgpt-context/
│   ├── authority_sources/
│   ├── primary_evidence/
│   │   ├── v0_3/
│   │   ├── track_a/
│   │   ├── track_b_design/
│   │   └── design_history_pre_freeze/
│   └── conversation_evidence/
├── workbuddy-evidence/
└── review/
    ├── PROMPT_AUTHORITY.md
    ├── CLAUDE_AUDITOR_PROMPT_V3.md
    ├── INTEGRITY_MANIFEST_AUTHORITY.md
    ├── FILES_SHA256.txt
    └── FILES_SHA256_V3_PATCH.txt
```

## Required reading order

1. `chatgpt-context/00_READ_ME_FIRST.md`
2. `chatgpt-context/02_AUTHORITY_AND_FROZEN_DIRECTION.md`
3. exact current Project Sources 00–08 under `chatgpt-context/authority_sources/`
4. `chatgpt-context/09_PROVENANCE_AND_COMPLETENESS_MATRIX.md`
5. `chatgpt-context/10_CROSS_PACK_AUTHORITY_RECONCILIATION.md`
6. v0.3 primary evidence
7. Track A Pass 1/2
8. Track B benchmark-design + correction contracts
9. `chatgpt-context/primary_evidence/design_history_pre_freeze/README.md` and the four recovered pre-freeze primary excerpts
10. `chatgpt-context/conversation_evidence/2026-08-25_UNIVERSAL_CLI_TO_ADAPTER_FIRST_RELEVANT_EXCERPT.md`
11. `workbuddy-evidence/08_PILOT_FAILURE_AND_CORRECTION_HISTORY.md`
12. `workbuddy-evidence/09_SEMANTIC_GOLD_ADJUDICATION.md`
13. `workbuddy-evidence/10_CORRECTED_D2_RESULTS.md`
14. `workbuddy-evidence/11_OPEN_QUESTIONS.md`
15. executable benchmark cases, selectors, metrics, value-units and tests
16. `review/INTEGRITY_MANIFEST_AUTHORITY.md`
17. `review/PROMPT_AUTHORITY.md`
18. `review/CLAUDE_AUDITOR_PROMPT_V3.md`

## Critical status

```text
TARGET_STATUS                 = NOT_IMPLEMENTED
REAL_EMBEDDING                = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE         = NOT_READY
IMPLEMENTATION_AUTHORIZATION  = NONE
VERSION_ASSIGNMENT            = UNASSIGNED
D1                            = SUPERSEDED
FIRST_D2                      = INVALIDATED_BY_ASPECT_NAMESPACE_RECONCILIATION_BUG
CORRECTED_D2                  = CURRENT_FINAL_PILOT_RESULT
```

## Evidence rules

- Exact/current primary authority beats summaries.
- Corrected later artifacts beat invalidated earlier artifacts.
- ChatGPT Semantic Gold adjudication beats provisional D1 Gold for D2 evaluation.
- `RECONSTRUCTED_*` and `GENERATED_SYNTHESIS` are explicitly non-authoritative.
- `RECOVERED_PRIMARY_EXCERPT` is historical primary evidence but weaker than a byte-complete recovered file.
- WorkBuddy `MISSING_ON_DISK` statements describe its assembly environment, not project-global nonexistence.
- Track-B D2 empirically tests only part of P1 and does not empirically validate P2/P3.

## Integrity-manifest rule

The original WorkBuddy snapshot manifest is preserved as `review/FILES_SHA256.txt`.

The final-history patch is an explicit overlay in `review/FILES_SHA256_V3_PATCH.txt`.

For paths present in the V3 patch, the V3 hash wins. For all other pre-existing paths, the original manifest remains authoritative. New V3 files exist only in the overlay.

See `review/INTEGRITY_MANIFEST_AUTHORITY.md`.

## Explicit residual gaps

The snapshot is designed for decision audit, not forensic reconstruction of every chat message.

Known residual gaps include:

1. full original chat transcript is intentionally not complete;
2. one later standalone Track-B metric-contract review was not recovered; final behavior is cross-checked through Pilot Correction + executable tests;
3. the four pre-freeze design-history artifacts are materialized here as substantial `RECOVERED_PRIMARY_EXCERPT` files rather than claimed byte-complete copies;
4. P2/P3 do not have D2-like empirical validation.

The canonical Claude prompt therefore requires the reviewer to report both what was actually seen and what remains unseen/partial, including whether any missing interval could materially change the verdict.
