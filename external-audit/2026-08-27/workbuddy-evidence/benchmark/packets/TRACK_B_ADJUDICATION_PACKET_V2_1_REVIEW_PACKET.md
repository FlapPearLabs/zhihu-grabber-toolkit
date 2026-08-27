# TRACK_B_ADJUDICATION_PACKET_V2_1_REVIEW_PACKET

> Repository: `FlapPearLabs/zhihu-grabber-toolkit`
> Role: ZHIHU CLI PRO — TRACK B BENCHMARK PILOT BUILDER
> Date: 2026-08-27
> Prior: TRACK_B_PILOT_HARNESS_CORRECTION = **PASS** (ChatGPT)
> THIS ROUND (ADJUDICATION ARTIFACT ONLY): fix `adjudication-packet-v2.1.json` per P0-1/P0-2/P0-3 + P1 invariant test.
> **No selectors/metrics/gold touched. No benchmark rerun. No corpus added. No TARGET/embedding/D2/Spec/production.**

```text
TRACK_B_PILOT_HARNESS = PASS
SEMANTIC_GOLD         = PROVISIONAL
D2                    = NOT_CREATED
TARGET_STATUS         = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE = NOT_READY
VERSION_ASSIGNMENT    = UNASSIGNED
```

---

## A. Fixed Missing Entries (P0-1)

**Root cause found**: the 3 sources are image-heavy answers whose raw HTML contains `data-original-token="v2-..."` (a Zhihu image attribute). The result-writer sanitizer's conservative `token` pattern matched that attribute and **silently dropped the whole `content_excerpt` field** in V2.

**Fix (V2.1)**: `content_excerpt` is now **sanitized plain text** (HTML stripped, entities decoded, whitespace collapsed) instead of a raw-HTML truncation — the HTML attribute can no longer enter the excerpt, and adjudicators read readable text (also per OPTIONAL QUALITY). Additionally the entry schema now carries an explicit `content_excerpt_status` (`OK | NO_TEXT_CONTENT | REDACTED_SENSITIVE`) plus `content_kind` + `content_metadata` (images / links / domains / references / codeBlocks / content_chars), so a field is **never silently absent** — hard invariant, enforced by test.

Verified on the three previously-missing sources:

| source_id | excerpt chars | content_excerpt_status | content_kind | metadata |
|---|---|---|---|---|
| 477427067:2179827948 | 300 | OK | text | images=1, links=0 |
| 477427067:3136586716 | 300 | OK | text | images=18, links=4, domains=[open.hand-china.com] |
| 487214224:2027722356278215762 | 215 | OK | text | images=3, links=0 |

All 75 sources: **missing_excerpt_or_status = 0**. Raw-HTML truncation is gone (`content_excerpt` verified to contain no `<tag>` markup).

---

## B. Expertise Evidence Schema (P0-2)

`expertise_evidence` is now structured real evidence, not a class label:

```json
"expertise_evidence": {
  "status": "SUPPORTED" | "UNSUPPORTED" | "UNRESOLVED",
  "evidence": [
    { "type": "verified_credential" | "employment" | "profile"
           | "historical_topic_content" | "self_identified_vendor" | "other",
      "text": "..." }
  ]
}
```

Derivation (from frozen canonical corpus only — no new data):
- `self_identified_vendor`: author display name matches a known low-code vendor account (e.g. 云程智能体开发平台, 简道云, 汉得信息数字化平台, 葡萄城, 百数, …) and the content promotes its own platform → `SUPPORTED` with that evidence type.
- `historical_topic_content`: same author appears across ≥3 questions in the frozen low-code corpus (e.g. 领悟杂谈 appears in 439521858 / 477427067 / 466695857 / 485463474 / 487214224) → `SUPPORTED`.
- No confirmable evidence (name-only, no profile/credential/employment data in canonical schema) → **`expert_topic_match_status = UNRESOLVED`** with empty evidence and an explicit note. **NO EVIDENCE is never mapped to `false`.**

Distribution across the 75 real sources: **14 SUPPORTED** (vendor/self-identified or cross-question historical) / **61 UNRESOLVED** / 0 UNSUPPORTED (we cannot disprove expertise from canonical data). Per the approved Gold contract, UNRESOLVED sources are **excluded from numerator and denominator** of expert recall and reported separately; they stay out of FINAL scoring until adjudicated.

---

## C. Label / Aspect / Claim Dictionaries (P0-3)

Packet is now self-contained:

- **Top-level `label_schema`** defines all 8 labels — `relevance`, `must_see`, `aspect_membership`, `expert_topic_match`, `long_tail_unique`, `claim_stance`, `historical_authority`, `evidence_quality` — each with `definition`, `allowed_values`, and `scorable_rule` (including the UNRESOLVED exclusion rule for expert_topic_match).
- **Per-case block** (`cases[]`) carries `case_id`, `research_question`, `question_ids`, `aspect_dictionary[]` (aspect_id / name / definition) and `claim_dictionary[]` (claim_id / canonical_claim / allowed_stances).
- **Resolution**: every `source.aspect_ids` entry resolves into some case's `aspect_dictionary`; every `claim_stances[].claim_id` resolves into some case's `claim_dictionary`. Cross-case id collisions (e.g. `asp-vendor` in 439521858 and 477427067; `c1-yida-verdict` in 439521858 and cross-lowcode) are **namespaced as `<case_id>:<aspect_id|claim_id>`** to keep resolution unambiguous.

Verified: **0 unresolved aspect_ids, 0 unresolved claim_ids** across all 75 sources. Per-case dictionary sizes: 439521858 (4 aspects / 2 claims), 477427067 (4/2), 466695857 (3/1), 485463474 (3/1), 487214224 (1/0), cross-lowcode (6/7).

Cross-question provenance (4 claims) lists **explicit source_ids** (each with author_display + excerpt), never "sources: 2".

---

## D. Artifact Invariant Test Result (P1)

New integration test file `benchmark/tests/adjudication-v2-1.test.mjs` (5 tests, **FAIL CLOSED** — any violation throws):

1. **P1 real packet invariants**: for every source — identity fields (`source_id`, `question_id`, `question_title`, `author_display`) present; `(content_excerpt non-empty) OR (content_excerpt_status === 'NO_TEXT_CONTENT' with content_kind + content_metadata)`; every `aspect_id` resolves; every `claim_id` resolves with legal stance; `SUPPORTED` expert ⇒ non-empty evidence; `UNRESOLVED` ⇒ explicit UNRESOLVED expertise_evidence. → **pass, 0 violations on the real 75-source packet.**
2. **label_schema completeness**: all 8 labels present with definitions.
3. **on-disk artifact match**: `benchmark/results/adjudication-packet-v2.1.json` exists, schema/source_count match the built packet, and the on-disk packet passes the same invariant scan.
4. **previously-missing 3 sources**: excerpts non-empty, status OK, no raw HTML tags.
5. **NO_TEXT_CONTENT path**: unit case with zero-text + image-only source yields `content_excerpt_status = NO_TEXT_CONTENT`, `content_kind = image_only`, `content_metadata.images = 1`, and passes the invariant scan.

Full suite: **32/32 pass** (27 harness + 5 V2.1). `benchmark.test.mjs` untouched (harness correction remains PASS).

---

## E. Source Count / Unresolved Expert Count

```text
sources in adjudication-packet-v2.1.json = 75   (deduplicated across 6 real cases)
cross-question provenance claims          = 4   (explicit source_ids)
label_schema labels                       = 8
expert_topic_match_status: SUPPORTED = 14 | UNRESOLVED = 61 | UNSUPPORTED = 0
sources with adjudication_evidence[]     = 54  (label-specific short evidence for
                                                must_see / evidence_quality /
                                                long_tail_unique / historical_authority)
content_excerpt missing without status    = 0
unresolved aspect_ids / claim_ids         = 0 / 0
leak check (credentials / private paths)  = PASS (148 artifact files)
```

---

## F. Statement: Corrected D1 Results Were NOT Rerun

```text
NO BENCHMARK RERUN.
- selectors        : untouched (still B0 / B1_LEXICAL_NGRAM_PROXY / B2_MMR_NGRAM_PROXY + B2_ORACLE_LANES)
- metrics          : untouched
- gold             : untouched (SEMANTIC_GOLD stays PROVISIONAL)
- 96 D1 runs       : not rerun; benchmark/results/runs/* unchanged
- summary.json     : not regenerated
- corpus           : not added
- D2               : NOT_CREATED
```

The only artifacts produced/changed this round:
- `benchmark/lib/adjudication-v2-1.mjs` (new)
- `benchmark/scripts/adjudication-packet-v2-1.mjs` (new)
- `benchmark/tests/adjudication-v2-1.test.mjs` (new, 5 tests)
- `benchmark/results/adjudication-packet-v2.1.json` (new deliverable)
- `benchmark/results/adjudication-mechanical-metadata.json` (regenerated identically; popularity fields remain outside the adjudication view)

Production code / original worktree: untouched (git status unchanged: 44 pre-existing missing files, 2 untracked files as before).

---

## Status

```text
TRACK_B_PILOT_HARNESS = PASS
SEMANTIC_GOLD         = PROVISIONAL
D2                    = NOT_CREATED
TARGET_STATUS         = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE = NOT_READY
VERSION_ASSIGNMENT    = UNASSIGNED
HANDOFF_COMPLETE      = YES
```

Proposed next step (NOT executed): ChatGPT reviews this packet; if accepted, proceed to **source-level adjudication** of `adjudication-packet-v2.1.json` (per-source CONFIRM/REVISE/REJECT, using label_schema + dictionaries; UNRESOLVED expert handled per Gold contract), then rebuild gold as D2 and rerun all strategies.
