# T5-R — Named Tool-less Responses Runtime Qualification

## 1. Status and evidence identity

```text
TICKET: #22 / T5-R
TYPE: DISCOVERY / SECURITY EVIDENCE
BASE: c9ff7b045737c2eddd4a5799702d720ade844a6d
RUNTIME_ID: openai-responses-tool-less
PROVIDER: OpenAI API
ENDPOINT: POST https://api.openai.com/v1/responses
MODEL: gpt-4.1-2025-04-14
PROJECT_MEMORY_UPDATE_REQUIRED: NO
```

This is a new, named runtime qualification. Its review identity is the Git
object plus the Issue #22 handoff and reviewer `REVIEWED_HEAD`; this document
does not self-assign a mutable candidate HEAD. It does not change the existing
runtime-scoped `NO` verdicts for either anonymous `agents/openai.yaml`
interface host from T5, and they do not imply a verdict for this candidate.

## 2. Authoritative API evidence

The official OpenAI Responses API reference, rechecked on 2026-08-23, documents `POST /responses`,
the `tools` array, `tool_choice`, and `text.format` structured JSON-schema
output. It lists built-in tools, MCP tools, and custom functions as members of
the `tools` surface. <https://developers.openai.com/api/reference/cli/resources/responses/methods/create>

The current official GPT-4.1 model page lists the Responses endpoint,
Structured Outputs support, and the fixed snapshot
`gpt-4.1-2025-04-14`. <https://developers.openai.com/api/docs/models/gpt-4.1>

The candidate therefore locks the exact request configuration below rather
than relying on a floating alias:

```json
{
  "model": "gpt-4.1-2025-04-14",
  "input": "<deterministic analysis projection text only>",
  "tools": [],
  "tool_choice": "none",
  "parallel_tool_calls": false,
  "store": false,
  "text": {
    "format": {
      "type": "json_schema",
      "name": "tool_less_map_result",
      "strict": true
    }
  }
}
```

The controller rejects any runtime configuration differing from that exact
endpoint, snapshot, empty tools array, or `tool_choice: "none"`.

## 3. Minimal repository-owned controller boundary

`corpus-anthology/lib/openai-responses-tool-less.mjs` is a qualification
prototype, not T6. It accepts only an object explicitly labelled
`deterministic-analysis-projection`, whose input is nonempty text with explicit
source IDs. Every source ID is restricted to `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`
and must occur exactly once, in the same order as `sourceIds`, as a complete
line of the exact form `[SOURCE <id>]`. Missing, unknown, mismatched,
out-of-order, duplicate, or malformed tags reject the projection before any
model request.

The projection rejects remote or file references before sending input to the
model. This is a constructive, fail-closed text boundary: any RFC scheme token
(`scheme:`; therefore including `http:`, `ftp:`, `s3:`, `ssh:`, `file:`,
`data:`, and `blob:`), protocol-relative `//host`, `www.`, UNC or apparent
absolute/relative file path rejects the entire projection. This deliberately
also rejects ambiguous colon-bearing text rather than treating a prompt
instruction as a security control. A literal backslash is also rejected
outright: this restricted qualification format has no complete safe Windows
path grammar, so `\Windows\...` and every other backslash-bearing input fail
closed.

Before that reference scan, every percent-bearing input must decode with
`decodeURIComponent` repeatedly to a stable value within eight passes; invalid
percent syntax or further nesting is rejected. The scan then applies to the
stable decoded value, so the tested `%252F%252F` double-encoding cannot bypass
the `//` check. The original and decoded text reject every Unicode `Cf` or
surrogate (`Cs`) code point and every C0/C1 control except structural tab, LF,
and CR. This includes U+2063. These are the complete enforced encoding and
invisible-character rules; they are controller-local checks, not claims about
actual remote runtime behavior. The prototype accepts no content blocks,
uploaded files, or file input types.

The controller alone receives an API key parameter, sends HTTPS to the fixed
OpenAI endpoint, and validates the returned data. The request body contains
only the projection text plus fixed configuration; its API credential remains
in the HTTP authorization header and is never included in model input or JSON
request content.

The validator follows the official [Create Responses reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create): it ignores all non-consumed top-level, message, and `output_text` metadata (including `background`, IDs, timestamps, message `phase`, and `logprobs`) rather than copying it into the map, controller commands, or logs. It still requires the security-relevant `object: "response"`, completed status, fixed model, `tools: []`, `tool_choice: "none"`, and `parallel_tool_calls: false`. It accepts only one completed assistant `message`; only one `output_text` item is accepted, its `annotations` must be an empty array, and only its `text` is parsed. Tool/function/MCP/reasoning/computer and every other output-item type remain rejected.

The response is accepted only when all of the following hold:

- `status === "completed"` and returned `model` exactly equals the reviewed
  snapshot;
- returned `tools` is exactly `[]` and `tool_choice` exactly `"none"`;
- exactly one completed assistant `message` is present, with exactly one
  `output_text` item; any tool/function/MCP/other output item fails closed;
- the text parses as the strict qualification JSON schema;
- the root, every claim, and every `sourceCoverage` entry have exactly the
  schema's declared fields (extra fields fail closed locally);
- every claim evidence ID is among the supplied IDs, and `sourceCoverage`
  covers each supplied ID exactly once.

The prototype deliberately does not read repository inputs, write map files,
or decide controller actions based on model output. Those production T6 duties
remain out of scope until a runtime earns `YES`.

## 4. Adversarial and fail-closed executable evidence

`corpus-anthology/test/openai-responses-tool-less.test.js` injects synthetic
untrusted projection text requesting shell execution, credential/filesystem
reads, URL fetching, package installation, function calls, and controller
impersonation. It verifies the only exposed model surface is the fixed text-only
request with `tools: []` and `tool_choice: "none"`; no refusal text is accepted
as security evidence.

The tests also prove controller-local fail-closed handling for:

1. changed model, endpoint, tools, or tool choice;
2. the listed scheme, protocol-relative/host, file-path, invalid-percent,
   double-percent (`%252F%252F`), over-eight-pass, U+2063, and non-text
   projection mutations;
3. source-tag missing/unknown/mismatched/out-of-order/duplicate/malformed
   mutations against the exact source-ID mapping contract;
4. missing controller API credential before transport is called;
5. returned model identity mismatch;
6. returned enabled tools, non-`none` tool choice, or unsupported output item;
7. malformed JSON/schema and invalid source/evidence IDs.

`corpus-anthology/scripts/qualify-openai-responses-runtime.mjs` is the small
reproducible live probe. It uses the same hostile input and only emits a
credential-free JSON verdict. A real credential is required solely in the
controller process as `OPENAI_API_KEY`.

### 4.1 New-base execution record (2026-08-23)

The following commands were run against this candidate based on
`c9ff7b045737c2eddd4a5799702d720ade844a6d`:

| Command | Result |
| --- | --- |
| `node --test test/openai-responses-tool-less.test.js` | PASS — 7/7 tests |
| `node --test` (from `corpus-anthology`) | PASS — 102/102 tests |
| `node --test test/agent-pipeline.test.mjs` | PASS — 6/6 tests |
| `node scripts/qualify-openai-responses-runtime.mjs` | FAIL-CLOSED — exit 1; fixed public `valid: false` / `errorCategory: capability_isolation_unavailable`; no controller credential was available |

For the required unrelated-product regression comparison, the identical
`npm test` suite was run in a clean `c9ff7b045737c2eddd4a5799702d720ade844a6d`
worktree and in this candidate. Both exited 0 with exactly 507 tests: 507
pass, 0 fail, and 0 skipped.

## 5. Per-dimension verdict

```text
RUNTIME_ID: openai-responses-tool-less
T4_EVIDENCE_REF: docs/t4-agent-consumer-audit.md (new named runtime is outside
  the two anonymous hosts audited by T4)
NETWORK: NOT_PROVEN
SHELL: NOT_PROVEN
FILESYSTEM: NOT_PROVEN
TOOLS: NOT_PROVEN
CONTROLLER_BOUNDARY: PROVEN_LOCALLY
FAIL_CLOSED_PATH: PROVEN_LOCALLY
ACTUAL_RUNTIME_BEHAVIOR: NOT_PROVEN
FINAL_VERDICT: NO
RATIONALE: Official documentation plus deterministic controller tests establish
  the intended request boundary, but this execution environment has no
  OPENAI_API_KEY. The live qualification probe therefore cannot authenticate,
  confirm account access to the fixed snapshot, or inspect an actual Responses
  API result. Local mock transport is not evidence of remote runtime behavior.
```

`NO` is intentionally narrow: it is not a claim that the OpenAI API or model
cannot satisfy the contract. It means this ticket has not established every
required dimension with actual runtime evidence. T6 remains blocked. To reopen
qualification, run the checked-in probe with a controller-side credential and
re-review the resulting exact evidence; do not change the tool-less contract
or use a prompt-only substitute.
