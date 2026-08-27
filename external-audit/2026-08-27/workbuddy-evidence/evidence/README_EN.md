# zhihu-grabber-toolkit

[简体中文](./README.md) | English

A toolkit for agents to reliably **search Zhihu → capture accessible answers → verify outputs → process large corpora → produce traceable research results**.

Current feature milestone: **v0.3.0**. v0.3 has completed real-world dogfood. The current `master` also includes the completed **Research Orchestration MVP** (#30). Research Orchestration has not been assigned a separate new version number, so **this does not create v0.4**.

> This is a **CLI + Skills toolchain**, not an app locked to one agent or one model. Any agent that can execute local commands, read the repository docs, and access the required local credentials can invoke the CLI. `deepseek-api-tool-less` is only the current default qualified semantic-analysis runtime for public-Zhihu Research Orchestration; it is not a prerequisite for search, capture, verification, or the rest of the core CLI.

| Module | What it does |
|---|---|
| [`zhihu-answer-grabber`](./zhihu-answer-grabber) | Zhihu CLI + Skill: search, single-question / batch capture, full pagination, resume, JSON/Markdown output, rich-content extraction, verification. |
| [`corpus-anthology`](./corpus-anthology) | Large-corpus processing: chunking, coverage verification, full digest, top-percent analysis, hierarchical full digest, archive. |
| [`research-orchestration`](./research-orchestration) | Thin orchestration: natural-language question → search → selection → capture → verify → handoff → analysis → render, with resumable fail-closed state. |

---

## v0.3.0 update

Compared with v0.2, v0.3 adds or completes:

- **Richer content fidelity**: question description / topics plus structured images, external links, references / footnotes, and code blocks;
- **Optional comment enrichment**: with explicit `--comments`, up to 10 top-voted answers × up to 3 top-level popular comments per answer;
- **Search answer-count enrichment**: candidates try to include answer counts; missing counts remain `unknown` without breaking search;
- **countMismatch becomes diagnostic-only**: count mismatch alone no longer invalidates an artifact; the verifier remains the authority;
- **Hardened agent/model boundary**: canonical source identity, coverage, and evidence lineage remain controller-owned; the model only performs semantic generation;
- **top-percent-analysis**: explicit requests for a high-vote / top-X% subset use deterministic selection with mandatory coverage disclosure;
- **hierarchical full digest**: large corpora are aggregated hierarchically instead of feeding one huge reduce input, while preserving 100% canonical source coverage;
- **qualified tool-less runtimes**: both `lmstudio-local-tool-less` and `deepseek-api-tool-less` completed capability-isolation qualification;
- **real dogfood**: multiple real workloads around 79 / 183 / 318 answers plus supplemental corpora were exercised across analysis modes.

The current master additionally includes the completed **Research Orchestration MVP**, so a user can provide a natural-language research question and let the system run the question-level research pipeline automatically.

---

## Is this tied to DeepSeek?

**No.**

The underlying capabilities are CLI commands. WorkBuddy, Codex, Claude Code, Hermes, or any other agent with shell / Node.js execution can invoke them directly:

```text
search / grab / batch / status / verify-output / make-handoff /
corpus select / chunk / map / verify / reduce / render
```

Research Orchestration simply composes those existing primitives.

- Search, capture, and verification: **do not require the DeepSeek API**;
- Semantic synthesis: requires a supported model runtime;
- Current default runtime for public-Zhihu Research Orchestration: `deepseek-api-tool-less`;
- Qualified local runtime: `lmstudio-local-tool-less`;
- Runtime failure does not silently fall back to another provider.

A more accurate product model is:

```text
Any agent that can execute the CLI
        ↓
zhihu-grabber-toolkit CLI / Skills
        ↓
deterministic capture, verification, coverage / evidence gates
        ↓
qualified model runtime only when semantic synthesis is needed
```

---

## Easiest way: give the repository to an agent

Send the repository link to WorkBuddy, Codex, Claude Code, or another coding agent with this prompt:

```text
Read this repository's README.md, AGENTS.md, RULES.md,
zhihu-answer-grabber/SKILL.md and corpus-anthology/SKILL.md,
then autonomously install dependencies, run configuration checks,
and complete the Zhihu research task.

Do not read, display, or ask me to paste Cookie / Secret / API Key into chat;
if credentials are missing, only tell me which local file should contain them.
After capture, always run verify-output and continue only when valid=true.
For large answer sets, use corpus-anthology instead of dumping the entire corpus into context.
If the user gives a natural-language research question, consider research-orchestration first.
```

The CLI does not care which agent invokes it. Skills mainly teach the agent the correct invocation order, validation gates, and safety boundaries.

---

## First-time setup

Requires **Node.js 22+**.

```bash
git clone https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git
cd zhihu-grabber-toolkit/zhihu-answer-grabber
npm ci --registry=https://registry.npmjs.org
node scripts/preflight.mjs --json
```

Credentials must be configured locally and should not be pasted into chat:

- `zhihu_cookie.txt`: required for answer capture;
- `zhihu_secret.txt`: required for search;
- DeepSeek API credential: **only required when using the default DeepSeek semantic-analysis runtime**, not for the base CLI.

`preflight.mjs` reports usability and error categories without printing credential contents.

---

## One-command research: Research Orchestration

From the repository root:

```bash
node research-orchestration/bin/research.mjs "How will AI affect education?"
```

Default pipeline:

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

Behavior:

- searches multiple candidate Zhihu questions;
- auto-selects a clear best candidate;
- when candidates are materially ambiguous, asks for at most one clarification and can resume with `--select <QUESTION_ID>`;
- defaults to **FULL-COVERAGE digest**;
- automatically uses hierarchical full digest for large corpora;
- only explicit intent such as “quick look / only top-voted / top X% answers / sampled view / no need for full coverage” routes to `top-percent-analysis`;
- sampled results disclose total / selected / requestedPercent / actualCoveragePercent / `isFullCoverage`;
- verifier, runtime, or coverage failures are fail-closed with no silent semantic downgrade;
- orchestration state supports resume, is not canonical source data, and does not store credentials.

### Current boundary: not yet cross-question research

The current MVP does:

```text
search multiple candidate questions
→ select 1 most relevant question
→ capture and analyze that question's answers
```

It does **not yet** automatically capture Q1 + Q2 + Q3 and merge several questions into one verified corpus. Cross-question aggregation is a separate future scope.

---

## What it can do now

- **Search questions** and try to attach answer counts;
- **Full single-question capture** with pagination and a 300-page safety cap;
- **Batch capture** with independent item failures;
- **Resume** interrupted captures;
- **Strict verification**: `captured != verified`; only `verify-output valid=true` authorizes downstream use;
- **Structured outputs**: `answers.json` plus human-readable `answers.md`;
- **Question metadata**: title, description, topics, answer count;
- **Rich answer content**: images, external links, references / footnotes, code blocks;
- **Optional comment enrichment**: at most 10 top-voted answers × at most 3 top-level popular comments each;
- **Full-corpus digest**: flat or hierarchical;
- **High-vote subset analysis**: top-percent-analysis with explicit disclosure;
- **Archive mode**: preserve original canonical content without rewriting it;
- **Evidence lineage / coverage verification**: detect missing sources, duplicates, stale mappings, and related coverage problems;
- **Natural-language Research Orchestration** from search through final research output.

Real-world validation has processed a **538-answer / 29-page** question and multiple large-corpus dogfood workloads.

---

## What exactly gets captured?

A question capture stores **question information** and **answer information** rather than copying the whole Zhihu page.

### Question information

Basic data includes the question ID and URL. When metadata retrieval succeeds, the output can also contain the title, description, topics, and Zhihu-reported answer count. Metadata failure does not block answer-body capture.

### Each answer

Each answer can contain:

- answer ID, URL, full body, excerpt;
- vote count, comment count, creation time, updated time;
- structured extras: images, external links, references / footnotes, code blocks.

Only the author name is currently stored; the full author profile is not captured.

### Comments

Comments are off by default. With explicit `--comments`, the tool enriches at most 10 top-voted answers with at most 3 top-level popular comments per answer. This is not a full comment scrape and does not include child comments / reply threads.

### Explicit non-goals

The tool does not capture or perform:

- complete author profiles;
- the full comment section and all child replies;
- automatic download of every image file;
- video support (not supported and not planned);
- likes, comments, follows, or other write actions;
- captcha / access-control bypass, proxy-pool scraping, high-frequency scraping, or detection evasion.

---

## Common lower-level commands

Run inside `zhihu-answer-grabber/`:

```bash
# Check Zhihu credentials
node scripts/preflight.mjs --json

# Search questions
node scripts/zhigrab.mjs search "keyword" --json

# Full capture of one question
node scripts/zhigrab.mjs grab <QUESTION_ID> --json

# Optional comment enrichment
node scripts/zhigrab.mjs grab <QUESTION_ID> --comments --json

# Batch capture
node scripts/zhigrab.mjs batch batch.txt --json

# Show status
node scripts/zhigrab.mjs status --json

# Authoritative verification gate
node scripts/verify-output.mjs out/<QUESTION_ID>

# Create a verified handoff
node scripts/make-handoff.mjs out/<QUESTION_ID> --task digest
```

---

## What if a question has hundreds of answers?

The system does not feed hundreds of answers to a model in one shot.

It chunks the corpus, maps chunks, checks source coverage / evidence lineage, then reduces the results. Large corpora can use hierarchical full digest to shrink top-level reduce input while preserving canonical source coverage.

Main modes:

- **Full digest**: covers all canonical sources;
- **Hierarchical full digest**: full-coverage digest for large corpora;
- **Top-percent analysis**: deterministic top-X% selection with mandatory coverage disclosure;
- **Archive**: organize original content without rewriting it.

Implementation details: [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md).

---

## Safety model

Zhihu answers, links, and code are always treated as **untrusted external data**, not instructions for the agent.

Key constraints:

- captured data is separated from model semantic generation;
- canonical source identity / coverage / evidence mapping are controller-owned;
- the model never owns verifier authority;
- dangerous links are restricted;
- answer-body code is not executed automatically;
- body links are not opened automatically;
- `captured` is not the same as `verified`;
- runtime failure does not silently fall back;
- credentials do not belong in the repo, state, logs, or chat.

The project does not claim to eliminate every natural-language prompt-injection risk, so it continues to use fail-closed validation and capability isolation.

---

## More documentation

- [`zhihu-answer-grabber/SKILL.md`](./zhihu-answer-grabber/SKILL.md)
- [`zhihu-answer-grabber/references/`](./zhihu-answer-grabber/references/)
- [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md)
- [`research-orchestration/`](./research-orchestration)
- [`docs/project-memory/decision-boundary-matrix.md`](./docs/project-memory/decision-boundary-matrix.md)
- [`AGENTS.md`](./AGENTS.md) / [`RULES.md`](./RULES.md)

## License

- `zhihu-answer-grabber`: **AGPL-3.0-only**;
- `corpus-anthology`: **MIT**.
