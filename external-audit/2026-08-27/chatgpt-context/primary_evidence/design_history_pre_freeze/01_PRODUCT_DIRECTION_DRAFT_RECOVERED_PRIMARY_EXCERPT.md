# Recovered primary excerpt — 01_PRODUCT_DIRECTION.md

PROVENANCE_CLASS: RECOVERED_PRIMARY_EXCERPT  
ORIGINAL_STATUS: FROZEN_DRAFT  
ORIGINAL_DATE: 2026-08-25  
CURRENT_AUTHORITY: NO  
IMPLEMENTATION_AUTHORIZATION: NONE

This excerpt is recovered from the historical pre-freeze `01_PRODUCT_DIRECTION.md`. It is intentionally included to expose superseded product assumptions rather than to preserve them.

## Product definition and three-layer framing

> Zhihu CLI Pro 不是新的知乎爬虫，也不是对知乎官方 CLI 的重新实现。
>
> 统一接入知乎官方能力、Web/Session 能力和成熟开源能力，
> 在此之上提供可信的跨问题研究、作者历史研究与持续情报能力。

```text
Zhihu Data Access
        ↓
Canonical Verified Content
        ↓
Research / Intelligence
```

The draft already preserved the v0.3 Research Kernel and stated that it should be extended through wrapping/adaptation rather than rewritten.

## Data-layer strategy

> THIN / ADAPTER-FIRST / REUSE-FIRST

Priority in the draft:

1. official Zhihu capability;
2. official CLI / API / Skill / MCP;
3. OAuth;
4. Cookie / Session;
5. browser-session reuse;
6. verified mature OSS;
7. custom implementation only for missing capabilities.

## Historical canonical-object boundary

The draft listed:

```text
User
Question
Answer
Article
Pin
Video
Comment
Topic
Collection
Relation
Evidence Source
```

This is historically important because the later authority reconciliation removed Video from the current product scope under the approved `VIDEO_SUPPORT = DO_NOT_SUPPORT` rule.

## Product priorities

### P1 — Cross-Question Deep Research

```text
natural-language question
→ multi-route search
→ multi-question / multi-format candidates
→ Coverage Engine
→ Verified Research Corpus
→ evidence-backed synthesis
```

### P2 — Author / Personal Intelligence

- own historical-content research;
- favorites research;
- other authors' currently accessible public history;
- topic/viewpoint/writing/knowledge-structure research.

### P3 — Continuous Intelligence

```text
historical baseline
→ incremental sync
→ delta detection
→ significant-change analysis
→ notification / webhook
```

## Coverage language already present

The draft explicitly separated:

- Retrieval Coverage
- Source Completeness
- Analysis Coverage

and prohibited unsupported claims of full-site completeness.

## Why this historical excerpt matters

The draft was already adapter-first, but its canonical scope and intelligence ambitions were broader than the final authority in several places. Reviewers should compare this excerpt with current `01_PRODUCT_DIRECTION_FINAL` and Track A authority reconciliation rather than treating the current design as if it emerged fully formed.
