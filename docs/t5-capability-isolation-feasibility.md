# T5 — Capability Isolation Feasibility

## 1. Status, authority, and scope

```text
TICKET: #11 / T5
TYPE: DISCOVERY / SECURITY EVIDENCE
BASE: 1a3db38e2d0edbbec4597bf861187c546bbb954f
PROJECT_MEMORY_UPDATE_REQUIRED: YES
```

This is a repository-evidence feasibility result, not a new runtime design or
an assertion about unspecified external products. Its target-runtime inventory
comes from the T4 audit: the two tracked, unnamed interface hosts declared by
the two `agents/openai.yaml` files.

The decision rule is V2 §9.1/§9.2.9, V0.3 §5.2/§15-B/OPEN-D3, and Product
Behavior Contract §3.17: a runtime can receive `YES` only when an
untrusted-content-reading LLM consumer is provably tool-less and separated from
controller-owned IO. Any required UNKNOWN means that runtime is not `YES`.

```text
CAPABILITY_ISOLATION_AVAILABLE[target_runtime] = YES | NO
NO / UNKNOWN -> capability_isolation_unavailable -> that runtime's digest/map STOP
NO cross-runtime inference
NO PARTIAL verdict
PROMPT_ONLY_GUARDS_ARE_NOT_CAPABILITY_ISOLATION
```

## 2. Evidence method and current corpus boundary

T4 established the current documented pipeline:

```text
verified answers.json
  -> make-handoff.mjs
  -> corpus verify.mjs --handoff
  -> chunk.mjs -> work/chunks/*.json
  -> [external LLM step described in corpus-anthology/SKILL.md]
  -> work/map-results/*.json
  -> verify.mjs / reduce.mjs
```

The executable repository does not contain the bracketed model call. In
particular:

- `corpus-anthology/SKILL.md` asks an LLM to read chunks and write map-result
  JSON, but it names no runtime, version, model client, controller, or tool
  policy.
- `corpus-anthology/scripts/chunk.mjs` reads local JSON and writes local chunk
  files; `verify.mjs` and `reduce.mjs` validate or consume local map-result
  files. None invokes a model or configures an LLM consumer.
- `test/agent-pipeline.test.mjs` constructs map-result JSON as a fixture. It
  tests downstream schema/coverage validation, not a model call or a capability
  boundary.
- `zhihu-answer-grabber/agents/openai.yaml` is upstream Skill-activation and
  preflight metadata for collection. It is not a corpus chunk-to-model boundary.

This absence does not prove an external host lacks a capability. It does prove
that the repository supplies no deterministic, runtime-specific evidence for a
`YES` decision.

## 3. Evaluated target runtimes

### 3.1 `zhihu-answer-grabber/agents/openai.yaml` interface host

```text
RUNTIME_ID: zhihu-answer-grabber/agents/openai.yaml interface host
T4_EVIDENCE_REF: docs/t4-agent-consumer-audit.md §5–§8;
  zhihu-answer-grabber/agents/openai.yaml
NETWORK: UNKNOWN
SHELL: UNKNOWN
FILESYSTEM: UNKNOWN
TOOLS: UNKNOWN
CONTROLLER_BOUNDARY: NOT_PROVEN
FAIL_CLOSED_PATH: NOT_PROVEN
FINAL_VERDICT: NO
```

Rationale:

- The YAML has only `interface` display/default-prompt fields and
  `policy.allow_implicit_invocation: true`; it says a host that does not
  support those fields may ignore them. It has no model-call, sandbox,
  network, shell, filesystem, tool-manifest, or controller setting.
- The associated implementation does make ordinary collection HTTP requests
  and its wrapper can launch the local CLI. Those are upstream Skill
  implementation facts, not a separate untrusted-content-reading corpus model
  consumer with an enforceable boundary.
- There is no named host product/version, no tool-less consumer instantiation,
  and no runtime test that attempts and deterministically denies the required
  capabilities. A default prompt or implicit-invocation policy is not evidence
  of denial.
- The repository has no controller that receives a chunk, makes a tool-less
  model call, validates the model response, and writes its map result. No
  executable runtime fail-closed path can therefore be proven for this host.

### 3.2 `corpus-anthology/agents/openai.yaml` interface host

```text
RUNTIME_ID: corpus-anthology/agents/openai.yaml interface host
T4_EVIDENCE_REF: docs/t4-agent-consumer-audit.md §3–§8;
  corpus-anthology/agents/openai.yaml; corpus-anthology/SKILL.md
NETWORK: UNKNOWN
SHELL: UNKNOWN
FILESYSTEM: UNKNOWN
TOOLS: UNKNOWN
CONTROLLER_BOUNDARY: NOT_PROVEN
FAIL_CLOSED_PATH: NOT_PROVEN
FINAL_VERDICT: NO
```

Rationale:

- This YAML likewise contains only interface/default-prompt metadata and
  `allow_implicit_invocation`; it expressly permits host fallback when the
  fields are unsupported. It contains no capability-deny configuration.
- The corpus scripts possess local filesystem IO to create/verify chunks and
  map results. That is not evidence that a separate LLM consumer is prevented
  from filesystem access, nor does it establish controller-only IO.
- The Skill's prose describes an LLM map step, but no model client, tool
  manifest, runtime configuration, or executable controller boundary exists in
  the tracked repository. The integration test simulates the LLM result rather
  than executing it.
- Consequently no deterministic test demonstrates network, shell, filesystem,
  or tools DENY, and no executable runtime-specific
  `capability_isolation_unavailable` path is available to inspect.

## 4. Verdict matrix and fail-closed consequence

| Runtime | Network | Shell | Filesystem | Tools | Controller | Runtime fail-closed path | Final verdict |
|---|---|---|---|---|---|---|---|
| `zhihu-answer-grabber/agents/openai.yaml` interface host | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_PROVEN | NOT_PROVEN | **NO** |
| `corpus-anthology/agents/openai.yaml` interface host | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | NOT_PROVEN | NOT_PROVEN | **NO** |

Each `NO` is independent. It means only that the repository lacks the complete
deterministic evidence required to enable that specific interface host; it does
not generalize to an uninspected host or claim that the host can never support
isolation.

For both evaluated runtimes, the required disposition is:

```text
CAPABILITY_ISOLATION_AVAILABLE[zhihu-answer-grabber/agents/openai.yaml interface host] = NO
CAPABILITY_ISOLATION_AVAILABLE[corpus-anthology/agents/openai.yaml interface host] = NO

-> capability_isolation_unavailable
-> do not invoke an untrusted-content-reading consumer for digest/map
-> do not enable or implement a supported runtime path in T6
-> STOP; do not fall back to prompt-only mitigation or a tool-enabled Agent
```

V2/V0.3 specify this fail-closed result as the governing contract. The absence
of an existing runtime implementation means this ticket cannot demonstrate a
runtime-emitted error; it can and does establish that no implementation/enable
decision is authorized for either evaluated target.

## 5. Evidence gaps that prevented YES

For each target independently, the following evidence is absent:

1. A concrete host product and version that consume the YAML interface metadata.
2. A reproducible model-call boundary that identifies an untrusted LLM consumer
   and a separate trusted controller.
3. Runtime-native, deterministic DENY controls for network, shell/process and
   package execution, filesystem read/write, and tools/functions/plugins.
4. Positive and adversarial execution evidence proving each DENY while hostile
   chunk text requests network, shell, filesystem, or tool actions.
5. A controller-owned path that accepts only verified input/projection, validates
   structured model output before writing map results, and detects boundary
   setup failure without a prompt-only fallback.

No generic external documentation was used to fill these gaps: the YAML files
do not identify a host product to which such documentation could be safely
attributed. The current Codex/WorkBuddy execution environment is also not a
repository-supported consumer runtime and is not evidence for either verdict.

## 6. Security non-claims

```text
NO_RUNTIME_IS_APPROVED_BY_T5
NO_RUNTIME_RECEIVES_YES
PROMPT_ONLY_GUARDS_ARE_NOT_CAPABILITY_ISOLATION
UNKNOWN_IS_NOT_YES
THE TWO NO VERDICTS DO NOT DESCRIBE UNINSPECTED RUNTIMES
```

This audit does not create a projection, controller, model integration, sandbox,
tool policy, or unsafe fallback. It changes no canonical verification or
handoff contract.

## 7. Required next state

All evaluated target runtimes are `NO`; therefore the T5 stop condition applies.
After the required independent security and contract/document reviews, T6 must
not implement or enable a supported runtime path. The sequential execution loop
must stop and surface `capability_isolation_unavailable` rather than inventing a
runtime or relaxing the boundary.
