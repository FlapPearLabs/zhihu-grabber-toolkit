# Zhihu Grabber Toolkit

[简体中文](./README.md) | English

**A toolkit for capturing, verifying, and processing Zhihu content at scale.**

It supports the full path from searching Zhihu questions, capturing currently accessible answers, resuming interrupted jobs, and deterministic verification, to large-corpus processing and Agent Research Orchestration.

```text
Search → Grab → Verify → Process Corpus → Research
```

Useful for:

- archiving and organizing Zhihu content;
- giving AI Agents / LLM workflows reliable Zhihu data;
- analyzing large answer corpora;
- building resumable research workflows on top of Zhihu content.

> This project is first and foremost a **Zhihu Grabber Toolkit**. Research Orchestration, coverage, and evidence-lineage capabilities were added to solve a practical follow-up problem: once content is captured, how can an Agent use it reliably? The project is not being repositioned as a generic Deep Research product.

**Start here:** [Quick Start](#quick-start) · [Features](#features) · [Documentation](./docs/README.md) · [Architecture](./docs/architecture/overview.md) · [Key Decisions](./docs/architecture/key-decisions.md)

---

## Why this project exists

Saving the answers under a Zhihu question into JSON is not the hard part. Long-term use quickly raises harder questions:

- Was pagination actually complete?
- Can an interrupted capture resume safely?
- When does “captured” become “verified”?
- How should images, citations, code blocks, and links be preserved?
- How should hundreds of answers be analyzed without dumping everything into one prompt?
- If only highly upvoted answers are analyzed, how do we avoid presenting a sampled view as full coverage?
- How does an Agent distinguish external content from executable instructions?
- When one research topic is spread across several Zhihu questions, how do we build a traceable corpus without letting one large popular question dominate everything else?

The project therefore evolved from:

```text
Question → Answers → JSON / Markdown
```

into:

```text
Research Question
      ↓
Search / Select
      ↓
Capture
      ↓
Deterministic Verification
      ↓
Verified Corpus
      ↓
Coverage-aware Processing
      ↓
Evidence-backed Result
```

The low-level capabilities remain explicit, independently usable CLI primitives. Research Orchestration is a thin layer over them.

---

## Features

The repository currently has three major layers:

| Module | Responsibility |
|---|---|
| [`zhihu-answer-grabber`](./zhihu-answer-grabber) | Search, single/batch capture, pagination, resume, rich content, JSON/Markdown output, verification. |
| [`corpus-anthology`](./corpus-anthology) | Chunking, map, coverage/evidence verification, full digests, hierarchical digests, top-percent analysis, archive. |
| [`research-orchestration`](./research-orchestration) | Natural-language request → search → select → capture → verify → handoff → analyze → render; resumable and fail-closed. |

### Capture

- Search Zhihu questions and, when available, enrich candidates with answer counts;
- paginate through currently accessible answers for a question;
- capture multiple questions independently;
- resume interrupted work;
- emit `answers.json` and human-readable `answers.md`;
- preserve title, description, topics, answer body, vote counts, comment counts, timestamps, and other metadata;
- extract images, links, citations/footnotes, and code blocks;
- optionally enrich a bounded set of popular comments with `--comments`;
- no CAPTCHA bypass, proxy pool, high-frequency scraping, or stealth / anti-detection behavior.

### Verification

The project explicitly separates:

```text
captured != verified
```

A completed capture only means the artifact exists on disk. Only deterministic `verify-output` validation can move an artifact onto the verified handoff path.

### Large-corpus processing

Hundreds of answers are not concatenated into one giant prompt.

```text
Canonical Corpus
      ↓
Chunk
      ↓
Map
      ↓
Coverage / Evidence Verification
      ↓
Reduce / Hierarchical Reduce
      ↓
Final Result
```

Current modes include:

- **Full digest** — consume all canonical sources in the selected corpus;
- **Hierarchical full digest** — add aggregation levels for large corpora while preserving source coverage;
- **Top-percent analysis** — deterministically analyze the top X% by popularity and disclose real coverage;
- **Archive** — preserve content without rewriting canonical source text.

### Research Orchestration

The currently implemented single-question research entrypoint is:

```bash
node research-orchestration/bin/research.mjs "How will AI affect education?"
```

Default flow:

```text
SEARCH
→ SELECT
→ CAPTURE
→ VERIFY
→ HANDOFF
→ ANALYZE
→ RENDER
→ COMPLETE
```

The system searches candidate questions, auto-selects when the best match is sufficiently clear, and asks for at most one clarification when there is material ambiguity. Full-coverage digest is the default; sampled analysis is entered only when the user explicitly asks for a quick / popular / top-X% view.

**The current stable Research Orchestration boundary remains single-question research.** Cross-question Deep Research is being developed as a separate P1 scope and is not presented here as an already completed feature.

---

## Quick Start

Requires **Node.js 22+**.

```bash
git clone https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git
cd zhihu-grabber-toolkit/zhihu-answer-grabber
npm ci --registry=https://registry.npmjs.org
node scripts/preflight.mjs --json
```

Credentials stay on the local machine. An Agent should never ask you to paste them into chat:

- `zhihu_cookie.txt` — required for answer capture;
- `zhihu_secret.txt` — required for question search;
- DeepSeek API credentials — only required when using the default DeepSeek semantic-analysis runtime, not for the base capture CLI.

`preflight.mjs` reports availability and error categories only; it never prints credential values.

### Common commands

Run from `zhihu-answer-grabber/`:

```bash
# Check configuration
node scripts/preflight.mjs --json

# Search questions
node scripts/zhigrab.mjs search "keyword" --json

# Capture one question
node scripts/zhigrab.mjs grab <QUESTION_ID> --json

# Optional popular-comment enrichment
node scripts/zhigrab.mjs grab <QUESTION_ID> --comments --json

# Batch capture
node scripts/zhigrab.mjs batch batch.txt --json

# Inspect status
node scripts/zhigrab.mjs status --json

# Deterministic verification gate
node scripts/verify-output.mjs out/<QUESTION_ID>

# Build a verified handoff
node scripts/make-handoff.mjs out/<QUESTION_ID> --task digest
```

<details>
<summary><strong>Hand the repository directly to an Agent</strong></summary>

For WorkBuddy, Codex, Claude Code, Hermes, or another Agent capable of local command execution, have it read:

```text
README.md
AGENTS.md
RULES.md
zhihu-answer-grabber/SKILL.md
corpus-anthology/SKILL.md
```

A minimal instruction set is:

```text
Set up the repository, run preflight checks, and complete the Zhihu research task.
Never read, print, or ask me to paste Cookie / Secret / API Key values into chat.
After capture, run verify-output; continue only when valid=true.
For large answer sets, use corpus-anthology instead of placing all full text into one model context.
For a natural-language research request, consider research-orchestration first.
```

The CLI itself is not tied to one Agent or one model.

</details>

---

## Why these design choices

As the project expanded from capture to Agent use and long-corpus research, several decisions became stable product/engineering boundaries:

| Decision | Why |
|---|---|
| **`captured != verified`** | Having data on disk does not mean the artifact has passed deterministic validation. |
| **Controller owns truth; Model owns semantics** | Canonical identity, coverage, evidence lineage, and verification authority should not depend on probabilistic model output. |
| **Canonical data is separate from derived views** | Markdown, summaries, and model projections must not overwrite the source of truth. |
| **Full coverage ≠ sampled analysis** | Reading a popular subset must not be presented as analysis of the full corpus. |
| **Thin Orchestrator** | Coordinate reliable primitives instead of reimplementing capture, verification, and corpus processing. |
| **Runtime is replaceable infrastructure** | Product semantics should not be tied to DeepSeek, LM Studio, or any single model. |
| **Retrieval / Source / Analysis Coverage are different** | Any “100% coverage” claim must state what exactly is covered. |

For rationale, alternatives, and trade-offs:

- [`docs/architecture/key-decisions.md`](./docs/architecture/key-decisions.md)
- [`docs/architecture/overview.md`](./docs/architecture/overview.md)
- [`docs/product-design/zhihu-grabber-toolkit-product-design.md`](./docs/product-design/zhihu-grabber-toolkit-product-design.md)

---

## Product thinking

### Popularity is valuable, but it is not truth

Highly upvoted answers are often information-dense and absolutely worth prioritizing. But strong answers can also signal quality through:

- concrete examples and verifiable evidence;
- images, papers, and website references;
- code or formula derivations;
- professional background that is genuinely relevant to the question.

Author verification, professional/academic background, and a history of strong answers can be useful soft signals, but “low followers / no verification” must not become an automatic low-quality label. Cross-question selection therefore treats popularity as an anchor and combines it with semantic relevance, source-group preservation, novelty, and other signals instead of becoming a simple vote-count ranking system.

### More data does not automatically mean better research

A useful system needs to answer:

1. What did we find?
2. What did we select, and why?
3. Was selected material captured completely?
4. How much of the selected corpus was actually analyzed?
5. Can conclusions be traced back to sources?

That is why the project kept evolving beyond capture into verification, corpus processing, and research orchestration.

---

## Safety & correctness boundaries

Zhihu answers, links, and code are always treated as **untrusted external content**, not Agent instructions.

Core constraints include:

- Cookie / Secret / Token values never enter the repository, logs, state files, Markdown reports, or chat;
- raw HTML in `answers.json` remains the canonical source; rendered outputs are derived views;
- `verify-output` remains the deterministic artifact-validity authority;
- a model cannot grant `verified` status to its own input;
- content code is not auto-executed and external links are not opened by default;
- runtime/provider failure does not silently become a different fallback product mode;
- `UNKNOWN != PASS`;
- no CAPTCHA bypass, access-control bypass, proxy pools, high-frequency scraping, or stealth / anti-detection.

The project does not claim to have solved all natural-language prompt-injection risks, so capability isolation and fail-closed behavior remain explicit design goals.

---

## Current status & direction

The current evolution can be summarized as:

```text
Grab
 ↓
Reliable Capture
 ↓
Rich Content
 ↓
Verified Corpus
 ↓
Large-Corpus Processing
 ↓
Single-Question Research Orchestration
 ↓
Cross-Question Deep Research   ← active P1 work
```

The current feature milestone remains **v0.3.0**. Research Orchestration and subsequent P1 work do not automatically create a new version number merely by existing in master or development branches.

P1 is not “call grab several times.” Its goal is to construct a Verified Research Corpus across multiple Questions / Source-groups under an explicit retrieval boundary and distinguish:

- **Retrieval Coverage** — how broadly the current plan/query/provider policy explored;
- **Source Completeness** — whether selected source groups were fully captured/paginated/verified;
- **Analysis Coverage** — how much of the selected verified corpus actually entered analysis.

The selected corpus may require Analysis Coverage = 100% without claiming “100% of all relevant Zhihu content was retrieved.”

---

## Development

This repository also uses a repository-driven Agent workflow: stable engineering rules live in the repository instead of depending on one chat session’s memory.

For correctness-bearing CODE tickets, the current execution path is:

```text
/implement
→ contract-driven TDD
→ static / mechanical verification
→ dynamic tests
→ adversarial self-review
→ remote CI / automated review
→ independent exact-SHA review
```

Long-lived constraints include:

- `tests green != task complete`;
- self-review is not independent review;
- reviewer PASS binds only to the exact reviewed SHA;
- one active writer per branch;
- remote-master integration is serialized and ff-only by default.

See [`AGENTS.md`](./AGENTS.md) and [`RULES.md`](./RULES.md). These rules govern development workflow; they are not part of the product runtime.

---

## Documentation

### Start Here

- [Documentation Hub](./docs/README.md)
- [Architecture Overview](./docs/architecture/overview.md)
- [Key Engineering Decisions](./docs/architecture/key-decisions.md)
- [Product Design & Evolution](./docs/product-design/zhihu-grabber-toolkit-product-design.md)

### Product / Specs

- [Product Behavior Contract](./docs/product-behavior-contract.md)
- [V0.3 Product Scope](./docs/specs/v0.3-product-scope.md)
- [Research Orchestration Scope](./docs/specs/research-orchestration-scope.md)
- [P1 Cross-Question Deep Research](./docs/specs/p1-cross-question-deep-research.md)

### Module Docs

- [`zhihu-answer-grabber/SKILL.md`](./zhihu-answer-grabber/SKILL.md)
- [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md)
- [`research-orchestration/`](./research-orchestration)

Qualification, evidence, planning, and historical design materials are indexed from [`docs/README.md`](./docs/README.md) instead of being dumped into the root README.

---

## Repository Layout

```text
zhihu-answer-grabber/    # search, capture, verification
corpus-anthology/        # large-corpus processing, coverage/evidence pipeline
research-orchestration/  # research orchestration
references/              # shared schemas / references
docs/                    # product, architecture, specs, evidence, planning
```

---

## Explicit non-goals

- full author-profile scraping;
- complete comment trees and all nested replies;
- automatic download of every image asset;
- video capture;
- write actions such as voting, commenting, or following;
- CAPTCHA / permission bypass;
- proxy pools, high-frequency scraping, stealth / anti-detection;
- making one model/provider the product identity;
- presenting sampled analysis as full coverage;
- claiming exhaustive retrieval of all relevant content across Zhihu.

---

## License

- `zhihu-answer-grabber`: **AGPL-3.0-only**;
- `corpus-anthology`: **MIT**.
