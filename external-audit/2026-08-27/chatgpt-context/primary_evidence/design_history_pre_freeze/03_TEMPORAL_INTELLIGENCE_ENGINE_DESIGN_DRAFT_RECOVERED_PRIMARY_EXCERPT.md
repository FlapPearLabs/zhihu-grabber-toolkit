# Recovered primary excerpt — 03_TEMPORAL_INTELLIGENCE_ENGINE_DESIGN.md

PROVENANCE_CLASS: RECOVERED_PRIMARY_EXCERPT  
ORIGINAL_STATUS: FROZEN_DRAFT  
CURRENT_AUTHORITY: NO  
IMPLEMENTATION_AUTHORIZATION: NONE

The historical Temporal Intelligence draft was materially more ambitious than the current minimal baseline.

## Goal

It targeted:

- Author Historical Research
- Personal Historical Research
- Continuous Monitoring

The design tried to avoid re-reading the full history on every update by building a persistent baseline and processing only deltas.

## Historical-state store

```text
FULL BASELINE
→ enumerate currently accessible content
→ Canonicalize
→ Verify
→ SQLite
→ Historical Corpus
```

SQLite was framed as a Historical State Store, with conceptual tables for entities, content, content versions, relations, captures, snapshots, watch targets/runs and research corpora.

## Incremental sync

```text
Current Enumerable State
        ↓
Compare previous snapshot
        ↓
NEW
UPDATED
REMOVED / UNAVAILABLE
UNCHANGED
```

Only delta was expected to re-enter expensive semantic processing.

## Temporal representation

The draft proposed:

```text
Topic(t)
Claim(t)
Stance(t)
Style(t)
Activity(t)
```

## Topic and structural shift

Candidate mechanisms included:

- Jensen-Shannon divergence for topic distribution changes;
- changepoint detection on topic proportions / activity / claim frequency.

The draft explicitly warned that topic shift is not stance shift.

## Claim / stance shift

For the same Claim family, compare:

- stance representation;
- supporting evidence;
- language;
- confidence;
- related claims.

## Statistical verification

The draft proposed that embedding drift alone must not trigger an alert. Candidate false-positive controls included:

- permutation tests;
- bootstrap;
- multiple-hypothesis correction / FDR.

Only changes above significance/materiality thresholds would become intelligence events.

## Style shift

Candidate style features included sentence-length distribution, lexical density, evidence/citation density, rhetorical structure, technicality, first-person frequency, question/statement balance and semantic style features.

The draft explicitly separated Style Shift from Viewpoint Shift.

## Event candidates

- CONTENT_CREATED
- CONTENT_UPDATED
- TOPIC_EMERGENCE
- TOPIC_DECLINE
- TOPIC_SHIFT
- STANCE_SHIFT
- STYLE_SHIFT
- ACTIVITY_SPIKE
- EVIDENCE_PATTERN_SHIFT

## Monitoring architecture

Because no confirmed inbound author-content webhook existed, the draft used:

```text
scheduler
→ incremental sync
→ SQLite diff
→ Temporal Intelligence
→ our webhook / notification
```

It also defined “all history” conservatively as the currently accessible enumerable set and required enumerated/captured/verified/unavailable counts, date range and content-type coverage.

## Why this historical excerpt matters

P2/P3 currently lack a D2-like empirical benchmark. Reviewers therefore need to see that the earlier design contained statistical shift detection, stance/style models and event semantics that were later simplified/deferred.
