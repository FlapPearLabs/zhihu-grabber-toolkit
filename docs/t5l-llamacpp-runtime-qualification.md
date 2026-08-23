# T5-L — llama.cpp tool-less runtime qualification

## 1. Status and scope

```text
TICKET: #25 / T5-L
TYPE: DISCOVERY / SECURITY EVIDENCE
BASE: 55752c5016fa206e95fa1ac80b528a88be2be4e7
RUNTIME_ID: llamacpp-local-tool-less
PROVIDER / CLIENT: llama.cpp
FINAL_VERDICT: NO
ACTUAL_RUNTIME_BEHAVIOR: NOT_PROVEN
PROJECT_MEMORY_UPDATE_REQUIRED: NO
```

This is a fail-closed, runtime-scoped availability finding. It does not
implement T6, does not establish a capability `YES`, and does not generalize to
another llama.cpp version, model, server configuration, or runtime.

`PROJECT_MEMORY_UPDATE_REQUIRED: NO`: this conclusion records only the current
external-model availability gap, not a durable verified runtime capability
result. With no identified model, project-memory and Tracker remain unchanged.

## 2. Non-sensitive direct observations

| Evidence | Observation |
| --- | --- |
| Installed binaries | `llama-server` and `llama-cli`: version `0.2.0`, build `10566`, commit `bb4caa754`, Darwin arm64 |
| Local model cache | `llama-server --cache-list`: model count `0` |
| Server availability | No active loopback `llama-server` was observed |

No GGUF model was identified, downloaded, hashed, or submitted. No server was
started, no request was made, and no credentials or private configuration were
inspected.

## 3. Static tool information is not runtime proof

The official `llama-server --help` surface reports a default of no tools and an
agent-disabled setting. Those are static help observations only. They cannot
replace evidence from a bound model, an actual server response, an adversarial
schema probe, or a repository-owned controller with fail-closed validation.

## 4. Missing required evidence and disposition

```text
IDENTIFIED_GGUF: NONE
MODEL_HASH: NOT_PROVEN
BOUND_SERVER_RUN: NOT_PROVEN
SCHEMA_AND_ADVERSARIAL_PROBE: NOT_PROVEN
CONTROLLER_FAIL_CLOSED_EVIDENCE: NOT_PROVEN
```

Because no actual bound runtime exists for verification, the required
capability-isolation dimensions are not proven. The required disposition is
`CAPABILITY_ISOLATION_AVAILABLE[llamacpp-local-tool-less] = NO` →
`capability_isolation_unavailable`; T6 remains BLOCKED. A default shown in
help, an unloaded model cache, or the absence of a request is not evidence that
tools are unavailable to a future bound model.
