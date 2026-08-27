# TRACK_B_ADJUDICATION_PACKET_V2_2_REVIEW_PACKET

> Repository: `FlapPearLabs/zhihu-grabber-toolkit`
> Role: ZHIHU CLI PRO — TRACK B BENCHMARK PILOT BUILDER
> Date: 2026-08-27
> Prior: TRACK_B_PILOT_HARNESS = PASS · CORRECTED_D1 = PASS_AS_SANITY_ONLY · V2.1 CONTENT/SCHEMA/EXCERPT/DICTIONARY = PASS
> THIS ROUND (FINAL ADJUDICATION DATA MODEL ONLY): generate `adjudication-packet-v2.2.json` (P0-1/P0-2/P1) + invariant tests.
> **No selectors/metrics/cases/gold touched. No benchmark rerun. No corpus. No D2. No embedding/TARGET/Spec/production.**

```text
TRACK_B_PILOT_HARNESS = PASS
SEMANTIC_GOLD         = PROVISIONAL
D2                    = NOT_CREATED
TARGET_STATUS         = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE = NOT_READY
VERSION_ASSIGNMENT    = UNASSIGNED
```

---

## A. Case-Scoped Semantic Model (P0-1)

V2.1 merged labels by `source_id` (OR across cases) and deduplicated into one global label object — losing the `source × research_case` semantics. **Fixed with a two-layer structure:**

```text
sources[]      → intrinsic source information ONLY
                 (source_id, question_id, question_title, content_kind,
                  content_excerpt, content_excerpt_status, content_metadata,
                  author_display, author_identity_confidence)
case_labels[]  → { case_id, source_id,
                   proposed_semantic_labels: {
                     relevance, must_see, aspect_ids[],
                     expert_topic_match_status, expertise_evidence,
                     expert_topic_match_proposed_by_gold,
                     long_tail_unique, claim_stances[],
                     historical_authority, evidence_quality },
                   adjudication_evidence[] }
```

The same source appears in **multiple independent `case_labels`** — one per research case. Labels are read per-case from that case's gold only; **no cross-case OR/merge, no propagation** (case A `must_see=true` never becomes case B `must_see=true`).

**Proof on the real packet** (source `466695857:1958779750`, present in both `case-466695857` and `case-cross-lowcode`):

| case | must_see | expert discovery | gold_proposed_expert |
|---|---|---|---|
| case-466695857 | **true** | SUPPORTED (historical_topic_content) | false |
| case-cross-lowcode | **false** | SUPPORTED (historical_topic_content) | false |

Also `485463474:2406068294` long_tail: `case-485463474` = true, `case-cross-lowcode` = false (REQ3). 135 case_labels = 17+18+15+7+3+75 — every (case × source) pair present.

---

## B. Provenance Membership != Claim Stance (P0-2)

V2.1 auto-derived `stance = "for"` for sources inside `required_provenance_groups`. **Removed.** Two distinct structures now:

- **`required_provenance_memberships[]`** (flat, per member): `case_id`, `claim_id` (namespaced), `group_id`, `group_index`, `group_role`, `question_ids[]`, `source_id`. `group_role` is taken **only from the frozen gold definition** (`grp.group_role`); where gold defines no role (this pilot), it stays `REQUIRED_SOURCE_GROUP` — **never guessed** as SUPPORT/OPPOSITION/CONTEXT. 21 memberships, all `REQUIRED_SOURCE_GROUP`, all in `case-cross-lowcode`.
- **`claim_stances[]`** now comes **only** from (1) explicit contradiction-cluster stance source lists (`stances.for` / `stances.against`) or (2) future human adjudication. Provenance membership never fabricates a stance.

**Proof**: provenance-only source `477427067:2040315771` (member of xq1 provenance group) has `claim_stances: []` in `case-cross-lowcode`; contradiction-stance source `439521858:3376976033` (in `c1-yida-verdict` `stances.for`) **does** carry `claim_stance {claim_id, stance:"for", relevant_excerpt}`. `cross_question_provenance` detail (V2.1, PASS) is preserved with explicit source_ids + group_id + group_role.

---

## C. Gold-Independent Expertise Evidence Proof (P1)

V2.1 only ran `deriveExpertiseEvidence` for sources already in provisional expert gold — a gold-dependent shortcut. **Fixed:** the same frozen-corpus evidence discovery now runs for **every distinct source** (`buildAuthorFacts` over all pools; vendor-name match → `self_identified_vendor`; author in ≥3 frozen questions → `historical_topic_content`; else UNRESOLVED). Provisional gold is **not consulted to decide whether to look** for evidence; it is only reported alongside as `expert_topic_match_proposed_by_gold`.

**Proof (REQ6)**: `477427067:2884408759` (Zoho Creator低代码开发) is **not** in the provisional expert gold (`gold_proposed_expert = false`), yet discovery still produced `expert_topic_match_status = SUPPORTED` with `evidence: [{type:"self_identified_vendor", ...}]`. Discovery is evidence — the **FINAL expert label remains human adjudication's** (label_schema records this rule).

Per-case-label expert distribution: **SUPPORTED = 60 / UNRESOLVED = 75 / UNSUPPORTED = 0** (label-level; SUPPORTED includes all vendor-name and cross-question authors discovered from the frozen corpus). UNRESOLVED stays excluded from expert numerator/denominator per the approved Gold contract.

---

## D. Invariant Tests (FAIL CLOSED)

New `benchmark/tests/adjudication-v2-2.test.mjs` (10 tests; all violations throw → FAIL):

| # | requirement | result |
|---|---|---|
| REQ1 | same source in single + cross case → two independent `case_label` records | pass (2 records: case-466695857, case-cross-lowcode) |
| REQ2 | case A must_see=true, case B must_see=false → values differ | pass |
| REQ3 | case A long_tail=true, case B long_tail=false → no OR leakage | pass |
| REQ4 | required_provenance source → does NOT auto-create claim_stance | pass (`claim_stances: []`) |
| REQ5 | explicit contradiction stance → DOES create claim_stance | pass (`stance:"for"`) |
| REQ6 | expertise evidence discovery runs for a source NOT in provisional expert gold | pass (SUPPORTED with evidence, gold_proposed=false) |
| REQ7 | every case_label aspect_id resolves inside THAT case dictionary | pass (0 violations) |
| REQ8 | every case_label claim_id resolves inside THAT case dictionary | pass (0 violations) |
| + | two-layer structure (sources intrinsic-only; case_labels carry semantics) | pass |
| + | on-disk `adjudication-packet-v2.2.json` matches built packet + full invariant scan + label_schema preserved (8 labels + required_provenance_membership) | pass |

Full suite: **42/42 pass** (27 harness + 5 V2.1 + 10 V2.2). V2.1 tests untouched (no regression).

---

## E. Source Count

```text
sources[] (intrinsic)                  = 75   (deduplicated real sources)
content_excerpt missing w/o status     = 0    (sanitized plain text; NO_TEXT_CONTENT explicit)
expert SUPPORTED (discovery)           = 60 case_labels / UNRESOLVED = 75 / UNSUPPORTED = 0
required_provenance_memberships        = 21   (group_role = REQUIRED_SOURCE_GROUP from frozen gold)
cross_question_provenance claims       = 4    (explicit source_ids + group_id + group_role)
leak check (credentials/private paths) = PASS (149 artifact files)
```

## F. Case-Label Count

```text
case_labels[] = 135  (= 17 + 18 + 15 + 7 + 3 + 75 per case)
  case-439521858     17   case-477427067     18   case-466695857     15
  case-485463474      7   case-487214224      3   case-cross-lowcode  75
case_labels with >=1 claim_stance = 52 (all from explicit contradiction stances)
```

## G. Statement: Benchmark Not Rerun

```text
NO BENCHMARK RERUN.  NO GOLD CHANGE.
- selectors / metrics / benchmark cases : untouched
- gold files                             : untouched (SEMANTIC_GOLD stays PROVISIONAL; not adjudicated; no D2)
- 96 D1 runs + summary.json              : untouched
- corpus                                 : unchanged
```

Artifacts produced/changed this round only:
- `benchmark/lib/adjudication-v2-2.mjs` (new; FINAL data model)
- `benchmark/scripts/adjudication-packet-v2-2.mjs` (new)
- `benchmark/tests/adjudication-v2-2.test.mjs` (new; 10 tests)
- `benchmark/results/adjudication-packet-v2.2.json` (new deliverable)
- `benchmark/results/adjudication-mechanical-metadata.json` (regenerated identically; popularity stays outside adjudication view)

Production code / original worktree: untouched (git status unchanged: 44 pre-existing missing files, 2 untracked files).

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

Proposed next step (NOT executed): ChatGPT reviews this packet; if accepted, proceed to **source-level adjudication** of `adjudication-packet-v2.2.json` (per case_label: CONFIRM/REVISE/REJECT using label_schema + per-case dictionaries; UNRESOLVED expert handled per Gold contract), then rebuild gold as D2 and rerun all strategies.
