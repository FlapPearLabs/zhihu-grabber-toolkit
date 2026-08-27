# TRACK_B_SEMANTIC_GOLD_ADJUDICATION_REVIEW_PACKET

## Verdict

```text
ADJUDICATION_PACKET_V2_2 = PASS
SOURCE_LEVEL_SEMANTIC_GOLD_ADJUDICATION = COMPLETE
FINAL_GOLD_FILE = TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json
D2 = REQUIRED_NEXT
TARGET_STATUS = NOT_IMPLEMENTED
SPEC_PREPARATION_GATE = NOT_READY
VERSION_ASSIGNMENT = UNASSIGNED
```

## Adjudication policy

- Unit: `case_id × source_id`; no cross-case semantic propagation.
- Other semantic metrics are relevance-gated.
- `UNRESOLVED` is excluded from numerator and denominator.
- Popularity metadata was not consulted.
- No web/outside evidence was used.
- `historical_authority` remains UNRESOLVED because the adjudication packet omits time/age evidence.
- Vendor/self-identified domain expertise can support `expert_topic_match`, but does not imply neutrality or evidence quality.

## Final case summary

| case | relevant | must-see | expert supported | long-tail | evidence-quality | claim-bearing sources |
|---|---:|---:|---:|---:|---:|---:|
| case-439521858 | 13 | 4 | 4 | 3 | 1 | 8 |
| case-477427067 | 16 | 4 | 11 | 5 | 6 | 5 |
| case-466695857 | 15 | 3 | 7 | 2 | 4 | 14 |
| case-485463474 | 2 | 2 | 2 | 1 | 1 | 0 |
| case-487214224 | 1 | 1 | 1 | 0 | 1 | 0 |
| case-cross-lowcode | 66 | 15 | 32 | 11 | 14 | 25 |

## Case-schema adjudication

- `case-477427067`: drop `c2-vendor-neutrality` from contradiction Gold; it is source/provenance tension, not same-claim opposition.
- `case-485463474`: retain only `asp-permission`; drop generic concept/critique aspects and `c1-innovation-vs-repackaging` as off-scope.
- Other single-case aspect/claim schemas retained with source memberships corrected.
- Cross case retains six aspects and three contradiction claims; xq1–xq4 remain cross-question provenance claims.

## Cross-question provenance revision

- xq1: selection framework + platform comparison + concrete pitfall groups.
- xq2: opposed zero-vs-low future positions + conceptual background.
- xq3: permission risk + business-scale fit; generic anonymous source removed.
- xq4: rebuilt into `vendor-self-promotion` vs `independent-or-countervailing-evaluation`; previous all-vendor provenance did not establish the claimed tension.

## Major proposal corrections

- Permission case: only 2/7 sources are substantively relevant.
- Business-line/team-fit case: only 1/3 sources is substantively relevant.
- Bare insults, link-only answers, question-only answers, and ultra-thin replies are excluded from semantic Gold.
- Several vendor/SEO answers were demoted from evidence-quality because link presence alone is not quality evidence.
- Yida claim stances were rebuilt: recommending another platform is not automatically a positive Yida stance.
- All historical-authority labels remain unresolved pending age/timestamp evidence.

## Decision counts

- `relevance`: CONFIRM=115, REVISE=20
- `must_see`: CONFIRM=111, REVISE=24
- `aspect_ids`: CONFIRM=72, REVISE=63
- `expert_topic_match_status`: UNRESOLVED=71, REVISE=4, CONFIRM=60
- `long_tail_unique`: REVISE=17, CONFIRM=118
- `claim_stances`: CONFIRM=101, REVISE=34
- `historical_authority`: UNRESOLVED=135
- `evidence_quality`: UNRESOLVED=2, REVISE=57, CONFIRM=76

## D2 instruction

Mechanically apply the adjudication JSON to the frozen D1 corpus, rebuild Gold/value-units, bump dataset version to D2, and rerun the existing fair strategies without changing selectors or metric code. Any implementation ambiguity must fail closed and be reported.