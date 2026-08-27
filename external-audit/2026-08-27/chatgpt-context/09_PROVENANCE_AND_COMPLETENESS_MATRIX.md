# Provenance and completeness matrix

## Evidence classes

- `EXACT_LOCAL_COPY`: byte-level exact source available in this pack.
- `RECOVERED_PRIMARY_FILE`: primary artifact recovered from current File Library / prior execution and materialized locally.
- `SANITIZED_PRIMARY_COPY`: primary artifact with machine-specific private path removed only.
- `VERBATIM_CONVERSATION_EVIDENCE`: exact user text recoverable from project/conversation export.
- `RECOVERED_CONVERSATION_EXCERPT`: selected historical wording recoverable but not a full transcript.
- `RECONSTRUCTED_CROSSWALK`: our synthesis across primary contracts; never authority.
- `GENERATED_SYNTHESIS`: continuity aid only.

## Coverage matrix

| Evidence chain | V1 status | V2 status | Notes |
|---|---|---|---|
| Project Sources 00–08 | PASS | PASS | exact local copies; previously byte-checked 9/9 |
| v0.3 starting boundary | PARTIAL | PASS | exact repo README/spec/behavior/project-memory copied from WorkBuddy evidence pack |
| original quality/expertise user intent | PARTIAL | PASS_FOR_DECISION_PROVENANCE | exact recovered user message; not full chat transcript |
| post-v0.3 six-feature product request | MISSING | PASS | exact recovered user messages 2026-08-25 |
| official-CLI route correction | summary-only | PASS_FOR_HISTORY | recovered historical excerpts + Track A primary evidence |
| Track A Pass1 | missing in audit pack | PASS | exact local primary file |
| Track A Pass2 | missing in audit pack | PASS | sanitized primary copy; only local path removed |
| Track B original benchmark design | missing/summary | PASS | recovered primary packet |
| Track B 4P0+6P1 metric/gold correction | missing | PASS | recovered primary packet |
| later final metric deltas | scattered | PASS_WITH_RECONSTRUCTED_CROSSWALK | final behavior triangulated from Pilot Correction + tests; standalone second correction artifact not recovered |
| Pilot failure/correction chain | PASS | PASS | WorkBuddy pack + pilot handoff |
| Semantic Gold + corrected D2 | PASS | PASS | exact local artifacts |
| P2/P3 empirical validation | absent | ABSENT_BY_DESIGN | no comparable benchmark exists; must not be implied |
| full original chat transcript | absent | INTENTIONALLY_NOT_COMPLETE | selected decision evidence only |

## Residual limitation

The only material historical-contract artifact still not recovered as a standalone primary file is the later metric-contract review that led to the final minority/aspect/evidence/freshness definitions. V2 does not invent it. Instead it supplies `TRACK_B_FINAL_CONTRACT_CROSSWALK.md`, explicitly `RECONSTRUCTED_CROSSWALK`, backed by the recovered first correction plus the final Pilot Correction packet and executable regression tests.
