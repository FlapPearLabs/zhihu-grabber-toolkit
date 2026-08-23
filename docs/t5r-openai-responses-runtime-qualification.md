# T5-R — Named Tool-less Responses Runtime Qualification

## 1. Status and exact candidate

```text
TICKET: #22 / T5-R
TYPE: DISCOVERY / SECURITY EVIDENCE
BASE: 3aa2b072632b97b35312809e3605f1f4b98e151c
RUNTIME_ID: openai-responses-tool-less
PROVIDER: OpenAI API
ENDPOINT: POST https://api.openai.com/v1/responses
MODEL: gpt-4.1-2025-04-14
PROJECT_MEMORY_UPDATE_REQUIRED: NO
```

This is a new, named runtime qualification. It does not change the existing
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
source IDs. It rejects remote/file URI references (`http(s)`, `www.`, `file:`,
`data:`, `blob:`), duplicate source IDs, and non-text input; it accepts no
content blocks, uploaded files, or file input types.

The controller alone receives an API key parameter, sends HTTPS to the fixed
OpenAI endpoint, and validates the returned data. The request body contains
only the projection text plus fixed configuration; its API credential remains
in the HTTP authorization header and is never included in model input or JSON
request content.

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
2. remote/file reference or non-text projection input;
3. missing controller API credential before transport is called;
4. returned model identity mismatch;
5. returned enabled tools, non-`none` tool choice, or unsupported output item;
6. malformed JSON/schema and invalid source/evidence IDs.

`corpus-anthology/scripts/qualify-openai-responses-runtime.mjs` is the small
reproducible live probe. It uses the same hostile input and only emits a
credential-free JSON verdict. A real credential is required solely in the
controller process as `OPENAI_API_KEY`.

### 4.1 New-base execution record (2026-08-23)

The following commands were run against this candidate based on
`3aa2b072632b97b35312809e3605f1f4b98e151c`:

| Command | Result |
| --- | --- |
| `node --test test/openai-responses-tool-less.test.js` | PASS — 5/5 tests |
| `node --test` (from `corpus-anthology`) | PASS — 100/100 tests |
| `node --test test/agent-pipeline.test.mjs` | PASS — 6/6 tests |
| `node scripts/qualify-openai-responses-runtime.mjs` | FAIL-CLOSED — exit 1; `valid: false`; no controller credential was available |

For the required unrelated-product regression comparison, the identical
`npm test` suite was run in a clean `3aa2b072632b97b35312809e3605f1f4b98e151c`
worktree and in this candidate. Both exited 1 with exactly 507 tests: 500
pass, 7 fail, and 0 skipped. The matching failures are `B1-cli`, `B1-batch`,
`T2-batch`, `P3-P1-2`, and three `test/config.test.js` checks that encounter
the existing temporary credential-file `0600` assertion. This is a baseline
failure set, not a candidate regression; it is retained without unrelated
repair.

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
