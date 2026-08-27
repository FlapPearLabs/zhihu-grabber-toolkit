# WORKBUDDY — FINALIZE CLAUDE EXTERNAL AUDIT BRANCH

Repository: `FlapPearLabs/zhihu-grabber-toolkit`

Existing audit branch: `audit/claude-external-review-2026-08-27`

Base authority: `master@84534f539a03937b031a962b828f2e2d44c102fa`

This is a MECHANICAL FILE-ASSEMBLY task only. Do not research, redesign, adjudicate, rerun the benchmark, modify production code, or write a new Spec.

## Inputs

Locate these local artifacts:

1. `ZHCLIPRO_CHATGPT_CONTEXT_AUDIT_PACK_V2.zip`
   - expected SHA256: `a634dda29172cf8d688eff306dca8dc1182c2a4fc58436d42b18281a949e3a13`
   - expected expanded file count: 51

2. `ZHCLIPRO_EXTERNAL_AUDIT_PACK.zip` (or the equivalent `(1)` downloaded copy)
   - expected SHA256 from its manifest: `619E66EF2DFCF8A3C2E0FDC40DA95AB2B3F2E86259AFAD238F8730A4E5EFB776`
   - expected expanded file count: 470

If either input is missing or hash-mismatched, STOP and report the exact missing/mismatched artifact. Do not substitute an older ChatGPT V1 context pack.

## Required branch layout

Populate exactly under:

```text
external-audit/2026-08-27/
├── README.md                                  # already present; preserve/update status only
├── chatgpt-context/                           # all 51 files from Context Pack V2, prefix stripped
├── workbuddy-evidence/                        # all 470 files from WorkBuddy pack, Windows separators normalized
└── review/
    ├── CLAUDE_AUDITOR_PROMPT_V2.md            # already present; preserve
    └── FILES_SHA256.txt                       # regenerate over every file except itself
```

For the ChatGPT ZIP, strip the top-level `ZHCLIPRO_CHATGPT_CONTEXT_AUDIT_PACK_V2/` directory.

For the WorkBuddy ZIP, normalize backslash ZIP entry separators to `/` before writing files.

Do not omit:
- invalid first D2 runs;
- superseded D1 runs;
- corrected D2 runs;
- all benchmark harness code/tests/cases/corpus;
- adjudication JSON and packets;
- all 00–08 exact Project Sources from ChatGPT Context V2;
- recovered Track A Pass 1 / Pass 2;
- Track B benchmark-design / metric-gold primary contracts;
- conversation evidence and generated-synthesis provenance labels;
- self-audit and residual-gap disclosures.

## Validation

Before commit, verify:

- `chatgpt-context` files = 51
- `workbuddy-evidence` files = 470
- final audit tree files = 524 total (`51 + 470 + README + prompt + FILES_SHA256`)
- every final audit file is UTF-8 readable
- no credential value / cookie / secret has been introduced
- exact invalid/superseded markers remain intact
- `git diff master...HEAD` has no product-code change

Generate `review/FILES_SHA256.txt` with SHA-256 for every file under `external-audit/2026-08-27/` except `FILES_SHA256.txt` itself.

Update the README status to:

`READY_FOR_CLAUDE_EXTERNAL_AUDIT_WITH_DISCLOSED_RESIDUAL_GAPS`

## Cleanup

After expanded files are staged, delete the temporary branch-only bootstrap material:

- `.github/workflows/expand-external-audit.yml`
- `external-audit-bootstrap/`

These paths must NOT exist in the final branch tip.

## Commit / verify

Commit only the audit snapshot + bootstrap cleanup. Do not touch production paths.

Suggested commit message:

`audit: publish complete Claude external review snapshot`

Then verify the final branch tip and report:

- branch name
- final commit SHA
- `master...branch` changed-file count
- audit-tree file count
- context/workbuddy counts
- secret/path scan result
- direct GitHub URL to `external-audit/2026-08-27/README.md`

Do not open a production PR unless explicitly asked. STOP after verification.
