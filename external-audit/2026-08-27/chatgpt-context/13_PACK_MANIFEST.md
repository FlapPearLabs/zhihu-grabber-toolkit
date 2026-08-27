# Pack manifest — V2

CONTENT_FILE_COUNT = 49

V1_STATUS = SUPERSEDED
EXTERNAL_AUDIT_READINESS = YES_WITH_DISCLOSED_RESIDUAL_GAPS

See `SHA256SUMS.txt` for per-file hashes.

## Top-level evidence groups

- `authority_sources/`: exact Project Sources 00–08
- `primary_evidence/v0_3/`: exact repo starting-point evidence
- `primary_evidence/track_a/`: Track A Pass1 + sanitized primary Pass2
- `primary_evidence/track_b_design/`: original benchmark contract + corrections + reconstructed final crosswalk
- `conversation_evidence/`: selected user/design-history evidence with provenance classes
- `pilot_handoff/`: adjudication + corrected D2 current evidence
- `reviewer/`: symmetric external auditor prompt V2

## Residual disclosure

- Full chat transcript intentionally absent; selected decision evidence only.
- One later standalone Track-B contract-correction artifact was not recovered; final contract crosswalk is explicitly reconstructed and backed by final harness/tests.
- Track A Pass2 is sanitized only for a machine-specific absolute path.
- P2/P3 are not empirically benchmarked.
