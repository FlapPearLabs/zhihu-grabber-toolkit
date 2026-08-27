# Provenance and completeness matrix

## Evidence classes

- `EXACT_LOCAL_COPY`: byte-level exact source available in this pack.
- `RECOVERED_PRIMARY_FILE`: primary artifact recovered and materialized as a complete file.
- `SANITIZED_PRIMARY_COPY`: primary artifact with machine-specific private path removed only.
- `RECOVERED_PRIMARY_EXCERPT`: exact/substantial recovered passages from a historical primary artifact; not claimed byte-complete.
- `VERBATIM_CONVERSATION_EVIDENCE`: exact user text recoverable from project/conversation export.
- `RECOVERED_CONVERSATION_EXCERPT`: selected historical wording recoverable but not a full transcript.
- `RECONSTRUCTED_CROSSWALK`: synthesis across primary contracts; never authority.
- `GENERATED_SYNTHESIS`: continuity aid only.

## Coverage matrix

| Evidence chain | Current status | Notes |
|---|---|---|
| Project Sources 00–08 | PASS | exact copies; current design authority |
| v0.3 starting boundary | PASS | repo README/spec/behavior/project-memory |
| original quality/expertise user intent | PASS_FOR_DECISION_PROVENANCE | exact recovered user message; not full transcript |
| post-v0.3 six-feature / universal-CLI request | PASS | recovered user/conversation evidence |
| official-CLI route correction | PASS_FOR_HISTORY | expanded recovered conversation excerpt + Track A primary evidence |
| pre-freeze Product Direction draft | PARTIAL_PRIMARY_RECOVERY | substantial `RECOVERED_PRIMARY_EXCERPT`; not claimed byte-complete |
| pre-freeze RCE Design draft | PARTIAL_PRIMARY_RECOVERY | substantial excerpt includes Candidate Geometry, hard constraints, Claim Graph, adaptive retrieval/stopping |
| pre-freeze Temporal Design draft | PARTIAL_PRIMARY_RECOVERY | substantial excerpt includes Topic/Claim/Stance/Style/Activity, changepoints, permutation/bootstrap/FDR |
| pre-freeze Algorithm Evidence Base | PARTIAL_PRIMARY_RECOVERY | substantial excerpt includes xQuAD/Submodular/DPP/Active Learning/stopping candidates |
| Track A Pass1 | PASS | primary file |
| Track A Pass2 | PASS | sanitized primary copy; local path removed only |
| Track B original benchmark design | PASS | recovered primary packet |
| Track B 4P0+6P1 metric/gold correction | PASS | recovered primary packet |
| later final metric deltas | PASS_WITH_RECONSTRUCTED_CROSSWALK | standalone later correction artifact not recovered; triangulated via Pilot Correction + tests |
| Pilot failure/correction chain | PASS | WorkBuddy pack + review excerpts + tests |
| Semantic Gold + corrected D2 | PASS | adjudication JSON + corrected rerun |
| P2/P3 empirical validation | ABSENT_BY_DESIGN | no comparable benchmark exists |
| full original chat transcript | INTENTIONALLY_NOT_COMPLETE | selected decision evidence only |
| canonical reviewer prompt | PASS | `review/CLAUDE_AUDITOR_PROMPT_V3.md`; other copies archival |

## Residual limitations

The audit snapshot is sufficient for a decision audit only if the reviewer explicitly distinguishes `SEEN`, `PARTIAL`, and `NOT_SEEN`.

Material residual gaps:

1. the later standalone metric-contract review that led to final minority/aspect/evidence/freshness definitions was not recovered as a standalone primary file;
2. the four pre-freeze design drafts are represented by substantial recovered primary excerpts, not falsely claimed as byte-complete files;
3. full historical chat continuity is not complete;
4. P2/P3 have design evidence but no D2-like empirical validation.

The canonical reviewer prompt requires an explicit evidence-visibility and missing-context report so these gaps cannot disappear into narrative confidence.
