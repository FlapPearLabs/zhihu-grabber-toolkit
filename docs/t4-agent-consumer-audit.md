# T4 — Agent Consumer / Runtime Audit

## 1. Status and scope

```text
TICKET: #10 / T4
TYPE: DISCOVERY / DOCUMENT
BASE: 7c4e5ca69aec885a2d093b09f536235dc44819cf
OBSERVATION: 2026-08-23
PROJECT_MEMORY_UPDATE_REQUIRED: NO
reason: This is a bounded, pre-feasibility evidence inventory.  It creates no
approved product decision, capability result, or durable implementation contract.
```

This audit records the repository state at the stated base. It does not add a
projection, a controller, a model runtime, a capability policy, or a runtime
feasibility result.

```text
NO_RUNTIME_IS_APPROVED_BY_T4
PROMPT_ONLY_GUARDS_ARE_NOT_CAPABILITY_ISOLATION
UNKNOWN_IS_NOT_YES
```

## 2. Authority read for this audit

- `AGENTS.md` §9 requires deterministic `make-handoff.mjs` production and
  `verify.mjs --handoff` validation; `RULES.md` §§3–5 retain canonical-data,
  verifier-authority, and untrusted-content boundaries.
- V2 §9 requires a deterministic projection at chunk/map time, without a
  permanent canonical-body derivative. V2 §9.1 defines the required future
  architecture: a tool-less LLM consumer with NETWORK, SHELL/EXEC, package,
  filesystem read/write, and tools all DENY; a trusted controller alone owns
  IO. V2 §§9.2.8–9.2.9 require `digest`/`map` to stop with
  `capability_isolation_unavailable` when that cannot be provided or proved.
- V0.3 §5.2 and §15-B make this a two-stage gate: T4 locates the consumer and
  runtime boundary; T5 must obtain per-runtime deterministic DENY evidence.
  V0.3 §16 OPEN-D3 and the Product Behavior Contract §3.17 require a separate
  result for each target runtime and forbid cross-runtime inference.
- `docs/project-memory.md` records that Phase 5 feasibility remains unproved;
  it also says that an UNKNOWN runtime stops rather than entering projection or
  isolation code.

## 3. Current corpus-consumer path

The repository has a deterministic artifact and map-reduce pipeline, but it
does **not** contain an executable LLM invocation or an implemented Agent
projection. The full evidenced path is therefore partly executable and partly
an external-consumer handoff:

```text
answers.json (canonical raw HTML)
  -> verify-output.mjs grants valid=true
  -> make-handoff.mjs re-verifies and writes verified handoff.json
  -> verify.mjs --handoff validates the handoff and its relative input files
  -> chunk.mjs directly reads answers.json and writes work/chunks/chunk-*.json
  -> [external LLM/model consumer described by SKILL.md; no call site in repo]
  -> work/map-results/map-<chunkId>.json
  -> verify.mjs --work validates coverage/evidence
  -> reduce.mjs and verify.mjs --final produce/validate the final digest
```

Evidence and boundary details:

1. `zhihu-answer-grabber/scripts/make-handoff.mjs` calls the upstream verifier
   before writing `handoff.json`; its output is the verified handoff contract.
2. `corpus-anthology/scripts/verify.mjs --handoff` validates the shared schema,
   containment of relative input paths, question identity, and answer count.
   `corpus-anthology/references/state-and-resume.md` §5 says failure rejects
   further processing.
3. `corpus-anthology/scripts/chunk.mjs` reads an `answers.json` path directly,
   derives local `work/chunks/*.json`, adds source identity and `chunkHash`, and
   has no `--handoff` input or model-client code. The repository integration
   test follows the same operator-mediated sequence: verify handoff first, then
   call `chunk.mjs` with `answers.json` directly (`test/agent-pipeline.test.mjs`).
4. `corpus-anthology/SKILL.md` describes the next step as an LLM reading each
   chunk and placing a structured map result in `work/map-results/`. The
   repository only validates that returned JSON afterwards:
   `verify.mjs` checks source coverage, chunk hashes, evidence locality, and
   map shape; `reduce.mjs` consumes validated map results.
5. The current chunk text is `cleanText(rec.content)` plus source markers
   (`chunk.mjs`), rather than an implemented V2 §9/§9.2 deterministic Agent
   projection. In particular, this audit found no projector implementing the
   required question/comments/assets/code-block projection contract.

Consequently, there is no current code-level route that hands untrusted chunk
content to a model. There is only a documented external step between chunk-file
generation and map-result ingestion. This is an evidence gap, not evidence
that a tool-enabled consumer is safe.

## 4. Trusted-controller and model-consumer boundary

| Role | Current repository evidence | Audit conclusion |
|---|---|---|
| Canonical producer / verifier | `verify-output.mjs`, `make-handoff.mjs`, and the shared handoff schema | Deterministic upstream verification is implemented. |
| Corpus pre/post-processing | `verify.mjs`, `chunk.mjs`, `reduce.mjs`, `render-final.mjs` perform local filesystem IO and deterministic validation/rendering. | These scripts are not the V2 trusted controller because none performs a model call, validates a model response at the call boundary, or owns a consumer capability policy. |
| Trusted controller required by V2 | V2 §9.1 specifies: controller reads projection/chunk, makes a tool-less model call, validates structured JSON, then writes a map result. | Not implemented or located in the current repository. |
| Untrusted-content-reading LLM consumer | `corpus-anthology/SKILL.md` and `references/evidence-schema.md` describe an LLM that reads chunk text and returns map JSON. | No runtime, call site, process, API configuration, or capability-enforcement mechanism is present in the repository. |

The model consumer must treat all chunk/projection text as untrusted data. A
sentence inside an answer, link, or code block cannot be an instruction to
open a URL, execute code, access files, or use a tool. This semantic rule is
necessary but does not supply the required runtime isolation.

## 5. Target-runtime inventory

The following is the complete repository-tracked runtime-facing inventory found
by this audit. It intentionally does not turn the current Codex/WorkBuddy
execution environment into a product runtime.

### `corpus-anthology/agents/openai.yaml` interface host (product name/version unspecified)

```text
RUNTIME_ID: corpus-anthology/agents/openai.yaml interface host
WHY_IN_SCOPE: This is the only tracked runtime-integration artifact. It declares
  an OpenAI-facing Skill interface and allow_implicit_invocation policy; the
  corpus Skill test asserts that this file exists and has that policy.
EVIDENCE: corpus-anthology/agents/openai.yaml; corpus-anthology/test/skill-behavior.test.js
MODEL_CALL_BOUNDARY: Not present. The YAML contains display/prompt/policy metadata,
  not an API client, model configuration, process boundary, or LLM call.
TRUSTED_CONTROLLER_BOUNDARY: Not present. No controller implementation is named
  by the YAML or corpus scripts.
TOOL_CAPABILITY_CONTROL_SURFACE: `policy.allow_implicit_invocation` controls only
  invocation policy. It does not demonstrate deterministic DENY for network,
  shell, filesystem, package installation, or tools.
CURRENT_VERDICT: UNASSESSED
```

`agents/openai.yaml` explicitly says hosts that do not support its policy or
interface fields may ignore them. It therefore cannot establish a particular
host product, version, or security property.

### Excluded from the target-runtime inventory: WorkBuddy runtime memory

`AGENTS.md` and `RULES.md` mention `.workbuddy/memory/` solely as ignored,
non-authoritative working memory. No tracked WorkBuddy corpus-consumer adapter,
model-call integration, or capability configuration was found. The fact that
an audit could be executed in a WorkBuddy/Codex environment is not product
evidence and does not put WorkBuddy in scope as an approved target runtime.

No other model client, model provider configuration, subprocess launcher, or
runtime capability document was found under the repository's tracked corpus
implementation. In particular, the `openai.yaml` filename must not be expanded
into an invented OpenAI product/runtime name.

## 6. Capability-control surfaces by runtime

| Runtime | Network | Shell / package | Filesystem read/write | Tools | Evidence-based conclusion |
|---|---|---|---|---|---|
| `corpus-anthology/agents/openai.yaml` interface host | No deterministic control identified | No deterministic control identified | No deterministic control identified | No deterministic control identified | The only surface found is implicit-invocation metadata. It is not capability isolation; all required controls remain unassessed. |

The local corpus scripts themselves use filesystem IO by design. That does not
prove a separate LLM consumer lacks filesystem access. Likewise, the absence
of `fetch`, shell spawning, or a model client in those scripts proves only that
they do not implement the missing controller; it is not a runtime-level DENY
proof for an external host.

## 7. Fail-closed insertion points

No implemented model-call boundary exists at which a runtime guard can now be
inserted. The authoritative contract nevertheless identifies the required
future stop points; T4 records them without implementing them:

1. **Before a controller gives a chunk/projection to a model:** require the
   verified artifact/handoff path and a successful deterministic projection.
   If either cannot be established, do not call the model and do not write a
   map result.
2. **At the future controller's model-call boundary:** resolve the exact target
   runtime's T5 result. If it is not deterministic `YES`, emit
   `capability_isolation_unavailable` and stop that runtime's `digest`/`map`.
3. **After the future model response:** the controller must schema/field
   validate it before it writes a map result. Existing `verify.mjs` provides
   downstream integrity validation but does not substitute for this missing
   controller boundary.
4. **On projection/capability failure:** V2 §9.2.8 requires stopping the
   derivative digest/map workflow without changing canonical capture validity
   or widening the canonical `verify-output` gate.

These are contract-required guard locations, not a proposed runtime design and
not evidence that a guard currently exists.

## 8. Evidence gaps

1. There is no repository model invocation, controller, or projection renderer;
   the exact executable chunk-to-model path cannot be inspected.
2. There is no named/versioned target host behind `agents/openai.yaml`, nor a
   tracked host/runtime integration document that exposes capability controls.
3. There is no deterministic-deny configuration or adversarial runtime test for
   NETWORK, SHELL/EXEC, PACKAGE INSTALL, filesystem read/write, or TOOLS.
4. Handoff verification and chunk creation are separate commands; current
   `chunk.mjs` does not consume a handoff or enforce that its direct JSON input
   was verified. This must not be described as an already enforced controller
   gate.
5. Existing map validation proves integrity of returned files, not that an
   untrusted-content-reading model had no capabilities while producing them.

## 9. Inputs required by T5

Before T5 may return a runtime-scoped `YES` or `NO`, it needs, for each actual
target runtime selected by product integration evidence:

1. Exact host product, version, launch/configuration source, and a reproducible
   model-call path that identifies the controller and the consumer.
2. Runtime-native configuration or instrumentation that can deterministically
   deny network, shell/exec/package installation, filesystem read, filesystem
   write, and tools to the model consumer while allowing only controller-owned
   IO.
3. Reproducible positive and adversarial tests demonstrating each DENY at the
   model-consumer boundary, including hostile chunk text asking for those
   capabilities; logs must not contain credentials or machine-private paths.
4. Evidence that controller input is a verified artifact plus the deterministic
   projection, and that only validated structured JSON is accepted before a map
   result is written.
5. A per-runtime result with no `PARTIAL` state: `YES` only on deterministic
   evidence; otherwise `NO`/`UNKNOWN` routes to
   `capability_isolation_unavailable` and stops that runtime.

## 10. Security assertions and non-assertions

```text
ASSERTED:
- Canonical verification, handoff validation, chunk identity, and downstream
  map/evidence validation have repository evidence.
- The V2/V0.3 fail-closed contract requires a tool-less consumer and a
  controller-owned IO boundary.

NOT ASSERTED:
- No current runtime has deterministic capability isolation.
- No current runtime has CAPABILITY_ISOLATION_AVAILABLE=YES or NO from T4.
- No prompt, Skill description, YAML display/default prompt, or absence of a
  local API client establishes capability isolation.
- No WorkBuddy/Codex runtime security property is inferred from this audit.
```

```text
NO_RUNTIME_IS_APPROVED_BY_T4
PROMPT_ONLY_GUARDS_ARE_NOT_CAPABILITY_ISOLATION
UNKNOWN_IS_NOT_YES
```
