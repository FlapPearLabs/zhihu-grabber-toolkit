# zhihu-grabber-toolkit

[简体中文](./README.md) | English

A toolkit for coding agents to reliably **search Zhihu → capture accessible answers → verify the output → process large answer sets**.

Current milestone: **v0.2.0**, a minimal usable version that has completed real-world validation. (v0.2.0 is the repository's current feature milestone, not an npm package version.)

| Module | What it does |
|---|---|
| [`zhihu-answer-grabber`](./zhihu-answer-grabber) | A Zhihu command-line tool + skill package: search, single-question and batch capture, full pagination, resume, JSON/Markdown output, result verification. |
| [`corpus-anthology`](./corpus-anthology) | A skill package for questions with many long answers: chunked processing, completeness checking, full digest / popular sample / archive, without filling up the context at once. |

---

## Easiest way: give the repository to an agent

Send the repository link to a coding agent such as WorkBuddy, Codex, or Claude Code, together with this prompt:

```text
Read this repository's README.md, AGENTS.md, RULES.md, and
zhihu-answer-grabber/SKILL.md, then autonomously install dependencies,
run configuration checks, and complete Zhihu tasks.

Do not read, display, or ask me to paste Cookie / Secret into the chat;
if credentials are missing, just tell me which file to place on this machine.
After capture, always run verify-output and continue only when valid=true;
for large answer sets, follow the skill rules and use corpus-anthology —
do not dump the entire corpus into the context at once.
```

The agent should be able to handle the rest by itself:

**Read the docs → install dependencies → check local configuration → search / capture / batch → verify results → chunk large answer sets.**

> On Windows, PowerShell is currently the recommended shell.

---

## First-time setup

Requires **Node.js 22+**.

```bash
git clone https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git
cd zhihu-grabber-toolkit/zhihu-answer-grabber
npm ci --registry=https://registry.npmjs.org
node scripts/preflight.mjs --json
```

Installation and checks can be done automatically by the agent.

Login credentials still need to be configured by you on this machine; the agent will not ask you to paste Cookie or Secret into the chat:

- `zhihu_cookie.txt`: needed for capturing answers;
- `zhihu_secret.txt`: needed only for `search`.

The simplest way is to place these two files in the current `zhihu-answer-grabber/` directory and re-run the configuration check.

`preflight.mjs` only reports whether things are usable and what type of error occurred; it never outputs credential contents.

---

## What it can do

- **Search questions**: keyword → Zhihu question ID;
- **Full capture**: it does not just fetch the first page — it keeps paginating to capture all currently accessible answers. Normally it keeps paginating until Zhihu explicitly reports the end; to avoid an infinite loop on abnormal pagination, there is currently a safety cap of 300 pages per question;
- **Batch capture**: capture multiple questions in one run; one failure does not affect the others;
- **Resume**: if interrupted, it continues where it stopped instead of restarting from the first page;
- **Output files**: you mainly get two files after capture —
  - `answers.json`: the data file with the raw captured results, suitable for further programmatic processing;
  - `answers.md`: a version organized for direct human reading.
- **Strict verification**: "captured" is not the same as "verified"; only when `verify-output` returns `valid=true` is the job truly done;
- **Large answer sets**: first check the size, process in chunks, check for gaps, then produce a full digest / popular sample / archive;
- **Rich content**: question extra info, plus images, external links, references, and code blocks; optional comment fetching.

Real-world validation has processed a question with **538 answers / 29 pages**.

---

## What exactly gets captured?

When capturing a question, the tool saves **information about the question itself** and **information about each answer** — it does not copy the entire Zhihu page.

### Question information

The question ID and URL are basic information. When the question info request succeeds, it additionally saves the question title, description, topics, and the total answer count reported by Zhihu. A failure to fetch question info does not prevent the answer bodies from being captured.

### Each answer

For each answer, the tool saves:

- answer ID, answer URL, full answer body, excerpt;
- vote count, comment count, creation time, last updated time;
- structured extras extracted from the body: images, external links, references / footnotes, code blocks.

Currently only the **author name** is saved. It does not capture the full author profile, follower count, following count, verification details, or full bio.

### Comments

Comments are off by default. When enabled with `--comments`, the tool picks at most 10 top-voted answers and adds at most 3 top-level popular comments per answer. It is not a full comment scrape, and it does not capture child comments / reply threads. Each comment saves: the comment body, the comment author's name (if available), and the comment time (if available).

### Images, links, references, and code blocks

- **Images**: saves the image URL and any available info such as caption and dimensions; image files are not downloaded to your machine.
- **External links**: records external links found in the answer body and their basic info.
- **References / footnotes**: references and footnotes in an answer are additionally organized into structured info.
- **Code blocks**: the code text stays in the answer body; the language and line count are recorded as well.
- **Videos**: video structure extraction is not officially supported yet.

### What is not captured

This is not a full copy of the Zhihu page. Explicitly not captured: complete author profiles, the full comment section, all child comments; image files are not downloaded automatically; video structure is not officially supported yet.

### What do the output files look like?

`answers.json` is the structured data file. A simplified view of its shape:

```json
{
  "questionId": "123456",
  "questionTitle": "Question title",
  "answerCount": 538,

  "question": {
    "id": "123456",
    "title": "Question title",
    "descriptionMarkdown": "Question description...",
    "topics": [
      {
        "id": "19550517",
        "name": "Artificial Intelligence"
      }
    ]
  },

  "answers": [
    {
      "id": "987654",
      "author": "Author name",
      "url": "https://www.zhihu.com/question/123456/answer/987654",
      "content": "<p>Full answer body...</p>",
      "excerpt": "Answer excerpt...",
      "voteupCount": 1234,
      "commentCount": 56,
      "createdTime": 1234567890,
      "updatedTime": 1234567890,

      "assets": {
        "images": [],
        "links": [],
        "references": [],
        "codeBlocks": [],
        "videos": []
      },

      "comments": [
        {
          "authorName": "Comment author",
          "contentHtml": "<p>Comment body...</p>",
          "contentMarkdown": "Comment body...",
          "createdTime": 1234567890
        }
      ]
    }
  ]
}
```

This is a simplified example to illustrate the structure; it is not the full formal data contract. `comments` can only appear when `--comments` is explicitly enabled; the default capture does not add comment fields, and the exact fields may vary by version.

`answers.md` is the human-readable version. It mainly contains:

- question title;
- question URL;
- capture time;
- total answer count reported by Zhihu;
- number of answers actually captured this time;
- answers sorted by vote count, descending;
- each answer's author name;
- vote count;
- comment count;
- answer URL;
- creation time;
- answer body.

Two current boundaries:

1. Comments fetched via `--comments` are stored in the `comments` field of the corresponding answer, i.e. `answers[].comments`; they are not automatically inserted into `answers.md` for now.
2. A successfully fetched question description is stored in the `question` info of `answers.json`; the human-readable `answers.md` does not display it separately for now.

---

## Common commands

Run inside the `zhihu-answer-grabber/` directory:

```bash
# Check credentials
node scripts/preflight.mjs --json

# Search questions
node scripts/zhigrab.mjs search "keyword" --json

# Full capture of a single question
node scripts/zhigrab.mjs grab <QUESTION_ID> --json

# Batch capture (batch.txt, one question ID per line)
node scripts/zhigrab.mjs batch batch.txt --json

# Show status
node scripts/zhigrab.mjs status --json

# Verify results: the required verification step
node scripts/verify-output.mjs out/<QUESTION_ID>

# After verification, hand off to the skill for large answer sets
node scripts/make-handoff.mjs out/<QUESTION_ID> --task digest
```

---

## What if a question has hundreds of answers?

The tool never dumps all content into the model in one shot.

Instead it:

1. checks how large the content is;
2. splits long content into smaller parts;
3. processes each part;
4. checks whether any part was missed;
5. combines the results at the end.

This reduces omissions and truncation, and helps avoid summaries that cover only the beginning of an oversized corpus.

There are three modes for different needs:

- **Full digest**: aims to cover all answers;
- **Top-voted sample**: only a portion of the highest-voted answers — it does not claim to be a complete summary;
- **Archive**: organizes the original text together without rewriting it.

Implementation details: see [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md).

---

## Is captured web content safe?

Zhihu answers, links, and code are always treated as external data.

For example, if an answer says:

"run this command"
"open this website"
"read a file on my computer"

Those words alone cannot make the tool perform those actions.

What the tool currently does:

- converts web content into safer Markdown;
- restricts dangerous links;
- does not automatically open links in the body;
- does not automatically execute code in the body;
- raw captured data is not rewritten by later processing.

To be clear: **this version does not claim to fully solve all natural-language prompt-injection risks.**

Stricter safeguards around model interactions are still being improved.

That is why this project always treats Zhihu content as:

**untrusted external data**,

not as:

**instructions for the agent**.

---

## More documentation

Read these when you need technical details, boundaries, and advanced usage:

- [`zhihu-answer-grabber/SKILL.md`](./zhihu-answer-grabber/SKILL.md)
- [`zhihu-answer-grabber/references/`](./zhihu-answer-grabber/references/)
- [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md)
- [`AGENTS.md`](./AGENTS.md) / [`RULES.md`](./RULES.md)

---

## Boundaries

This tool only **reads, organizes, and verifies**: it does not like, comment, or follow; it does not bypass captchas or access controls; it does not use proxy pools, high-frequency scraping, or detection evasion; it does not execute body code or open external links in the body automatically.

Please comply with Zhihu's terms of service and applicable local laws. Use it only for lawful personal learning, research, and automation workflows.

## License

- `zhihu-answer-grabber`: **AGPL-3.0-only**;
- `corpus-anthology`: **MIT**.
