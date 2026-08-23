# T5-L — Local llama.cpp tool-less runtime qualification

## 1. Status, scope, and exact runtime

```text
TICKET: #25 / T5-L
TYPE: DISCOVERY / SECURITY EVIDENCE
BASE: 052feacfa83444fb1ab16c3a89482c126cd9b7f0
RUNTIME_ID: llamacpp-local-tool-less
IMPLEMENTATION: official ggml-org/llama.cpp llama-server
LLAMA_CPP_RELEASE: v0.2.0
LLAMA_CPP_SOURCE_COMMIT: bb4caa7540188872173c44d161602d9271386413
INSTALLED_BINARY: 0.2.0 (build 10566, commit bb4caa754), Darwin arm64
FINAL_VERDICT: NO
```

This is a runtime-scoped qualification of the exact binary above. It does not
reopen T5, T5-R, or T5-C; it does not implement T6; and it does not infer a
verdict for another llama.cpp build, another model, or an uninspected runtime.

V2 §9.1/§9.2.9, V0.3 §5.2/§15-B/OPEN-D3, and Product Behavior Contract §3.17
require all model-visible `NETWORK`, `SHELL-EXEC`, `PACKAGE`, filesystem, and
tool capabilities to be denied. The deterministic controller alone may own IO.
Any unknown required proof is `NO`, not partial success.

## 2. Version and official evidence

The official [llama.cpp v0.2.0 release](https://github.com/ggml-org/llama.cpp/releases/tag/v0.2.0)
identifies the release. The installed Homebrew formula is pinned to that release
and to source commit `bb4caa7540188872173c44d161602d9271386413`; the binary's
supported `--version` command reports the same short commit.

The official [server reference](https://github.com/ggml-org/llama.cpp/blob/bb4caa7540188872173c44d161602d9271386413/tools/server/README.md)
documents the server's relevant controls. The actual installed binary's
`--help` was independently inspected rather than assuming documentation matches
the binary:

| Required property | Exact-binary observation |
|---|---|
| Local server / loopback binding | `--host` defaults to `127.0.0.1`; `--port` is explicit |
| OpenAI-style chat/responses surface | Supported by the official server reference; no live request was possible without a model |
| Schema-constrained JSON | `--json-schema` and `--json-schema-file` are present in binary help |
| Built-in tools | `--tools` exists; help lists `read_file`, file glob/search, grep, shell execution, write/edit, and `get_info`; default is `no tools` |
| Agent mode | `--agent` / `--no-agent` exist; help says default disabled |
| Web UI | `--ui` / `--no-ui` exist; help says default enabled |
| MCP proxy | `--ui-mcp-proxy` / `--no-ui-mcp-proxy` exist; help says default disabled |
| Model identity | `--model` accepts a local file; no model became locally available to inspect |

The reference is tied to the exact source commit above. No floating `master`
claim is used as the runtime identity.

## 3. Reviewed safe startup intent and observed fail-closed behavior

The intended qualification startup is invocation-scoped and uses a clean
environment with these properties:

```text
host = 127.0.0.1
agent = explicitly disabled (--no-agent)
web UI = explicitly disabled (--no-ui)
UI MCP proxy = explicitly disabled (--no-ui-mcp-proxy)
--tools = omitted, never passed
LLAMA_ARG_* activation = absent from the clean environment
model transport = local --model file only
```

An empty-looking `--tools ''` is unsafe as an attestation mechanism: the exact
binary treats it as an unknown requested tool and exits with a tools-setup
error. The reviewed intent therefore omits `--tools`; it does not try to encode
an empty tool list through that option.

The binary was run in a new isolated temporary directory with a nonexistent
fixed local model path, loopback binding, explicit `--no-agent`, `--no-ui`, and
`--no-ui-mcp-proxy`, and a clean environment. It reported UI disabled, then
failed to load the fixed model and exited nonzero before accepting a request.
It did not download a model, start a less-restricted server, or receive
untrusted projection text. This proves only this startup failure path; it does
not prove a successful tool-less inference session.

## 4. Model acquisition is a separate blocked phase

The planned model, selected for a security qualification rather than a quality
claim, was:

```text
MODEL_ID: Qwen/Qwen2.5-1.5B-Instruct-GGUF
MODEL_SOURCE: Qwen official Hugging Face model repository
MODEL_FILE: qwen2.5-1.5b-instruct-q4_k_m.gguf
QUANTIZATION: Q4_K_M
MODEL_SIZE: approximately 1.12 GB
LICENSE: Apache-2.0
CONTEXT_SIZE: 32,768 tokens
```

The model card documents the GGUF file, Apache-2.0 license, and llama.cpp use;
the base instruction model documents the 32,768-token context. The requested
model acquisition did not complete: the official downloader's connection to the
model hosting endpoint remained at TCP connection establishment and produced no
local GGUF. No model bytes, hash, or untrusted input were accepted. The only
existing local GGUF discovered was an embedding model, not an instruction model,
and was not substituted.

Accordingly, the later isolated inference phase would have used only a verified
local `--model` file and no remote model URL, but it could not begin.

## 5. Required evidence matrix

| Required dimension | Result | Evidence boundary |
|---|---|---|
| Model identity | NOT_PROVEN | Intended instruction GGUF was not locally acquired; no immutable local hash exists. |
| Network | UNKNOWN | Loopback server transport is distinguishable from a model tool, but no successful inference run proves the effective model tool set. |
| Shell / process / package | UNKNOWN | The binary can expose `exec_shell_command` through `--tools`/`--agent`; default-disabled help plus flags is insufficient without a successful effective tool inventory. |
| Filesystem | UNKNOWN | The process would need the fixed GGUF; no successful run proves absence of model-visible read/write/search tools. |
| Tools / MCP / web UI | UNKNOWN | Agent/tools/MCP/UI were explicitly configured off in the failed startup probe, but tool registration cannot be observed without a loaded model. |
| `MODEL_VISIBLE_TOOL_COUNT` | NOT_PROVEN | Required value `0` cannot be asserted from defaults or an unavailable server. |
| Input boundary | NOT_PROVEN | No repository-owned controller supplied an approved projection to a live model. |
| Output contract | NOT_PROVEN | Schema flags exist, but no live schema-constrained response was obtained or validated. |
| Controller boundary | NOT_PROVEN | No controller was implemented because live runtime preconditions failed. |
| Fail-closed path | PROVEN only for missing local model | Exact safe startup stops before untrusted input when its local model is absent. |
| Live local runtime | NOT_PROVEN | No fixed instruction GGUF was available; no successful localhost request occurred. |

## 6. Adversarial-data disposition and verdict

No hostile projection was sent because the server never loaded a model. The
required sentinel tests for shell, nonce read/write, repository/home/credential
reads, URL fetching, package execution, tool/function calls, impersonation,
tool-shaped JSON, and hostile source mappings remain unexecuted. A model refusal
would not have counted as proof in any event.

```text
CAPABILITY_ISOLATION_AVAILABLE[llamacpp-local-tool-less] = NO
FINAL_VERDICT = NO
STOP = capability_isolation_unavailable
EXACT_UNRESOLVED_EVIDENCE_GAP =
  no locally acquired, immutable instruction GGUF; therefore no actual
  llama-server inference, effective empty tool inventory, schema response,
  controller boundary, or adversarial side-effect proof.
```

T6 remains blocked. This ticket adds neither a production path nor a prompt-only
fallback, and it does not treat a local process as evidence of a model-visible
capability boundary.
