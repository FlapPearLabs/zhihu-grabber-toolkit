# Hackathon Public Showcase

```text
DOCUMENT_STATUS = APPROVED_SPEC_CANDIDATE
PRE_EFFECTIVE_STATUS = REVIEW_PENDING
TARGET_STATUS = NOT_IMPLEMENTED
DOCUMENT_ID = HACKATHON_PUBLIC_DEMO
```

This additive amendment authorizes a Vercel-only interactive product showcase.
It does not authorize public research execution or change any P1 semantics.

## Scope

The public product is a Next.js application deployed on Vercel. It provides a
guided interactive replay, an illustrative dossier labelled `Illustrative Demo
Data`, verified engineering evidence from the accepted P1 run, and prominent
links to the GitHub implementation, architecture, tests, and local-run guide.

Public P1 execution, arbitrary live topics, Mac public compute, queues, public
embedding, credentials, Cloudflare Tunnel/Access, and any BFF-to-Mac path are
out of scope. Illustrative data MUST NOT be represented as real Zhihu quotes,
authors, engagement counts, or canonical P1 artifacts.

## Truth model

The UI MUST mechanically distinguish:

- `VERIFIED ENGINE EVIDENCE`: baseline `a6fd4bd66e9d1c4b073d3fb13e82c8885fe37eea`,
  4 source groups, 2 retrieval providers, 396 selected, 396 mapped, and 396
  analyzed; analysis coverage is 100% and retrieval completeness is `UNKNOWN`.
- `ILLUSTRATIVE INTERACTIVE DEMO DATA`: deterministic fixtures for replay and
  dossier presentation, visibly labelled and never claimed as real artifacts.

`100% analysis coverage` MUST NOT be described as `100% Zhihu retrieval coverage`.
No citation, quote, badge, count, or provenance may be invented.

## Experience

The home screen explains the product within five seconds and offers `体验研究
过程` and `查看完整 GitHub 项目`. Any topic control edits the demonstration
topic only; it is not a live research form.

The replay presents:

```text
研究问题 → 问题拆解 → 跨问题发现 → Source Groups → 语料筛选
→ 全选定语料分析 → 共识 / 分歧 → Evidence Lineage → Final Dossier
```

The dossier includes summary, claims, consensus, contradictions, source groups,
evidence inspection, coverage, and limitations. Motion must not imply live
network retrieval.

## Verified engine

The application MUST include a restrained `Canonical P1 Acceptance` section
showing only evidence-backed values and linking to the repository acceptance
record. It MUST identify the online dossier as an interaction demo and GitHub as
the complete self-hosted research engine:

```text
clone repository → configure runtime → run P1 locally / self-hosted
```

## Boundaries

The implementation may use static data, local fixtures, and deterministic replay.
It MUST NOT invoke `research-p1.mjs`, expose credentials, or create a public
compute endpoint. This amendment does not resolve or amend P1 `OPEN_DECISION D-1`,
embedding, retrieval, selection, analysis, synthesis, coverage, or evidence
lineage semantics. If implementation requires changing those semantics, stop with:

```text
P1_CONTRACT_CHANGE_REQUIRED
```

Only the Vercel presentation plane is deployed. Preview and production contain no
research or compute credentials. Safe text rendering, security headers, keyboard
accessibility, responsive layout, and reduced-motion support are required.

## Acceptance

Acceptance requires a working Vercel URL, visibly labelled demo data, exact
evidence-backed P1 metrics, working GitHub links, honest README/submission copy,
and proof that no public P1 runtime, queue, Mac compute, Cloudflare, embedding,
or credential path exists. Final status is one of `PASS | FAIL | BLOCKED | NOT_RUN`.
