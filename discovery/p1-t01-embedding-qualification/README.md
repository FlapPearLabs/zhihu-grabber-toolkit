# P1-T01 EmbeddingProvider Qualification Discovery — harness

```text
TICKET         = P1-T01 (GitHub Issue #33)
TYPE           = DISCOVERY / EVIDENCE
AUTHORITY      = NON_AUTHORITATIVE_CANDIDATE until EVIDENCE_REVIEWER PASS
                + ff-only merge + remote master re-fetch verification
SCOPE          = evidence collection only
PRODUCTION_USE = FORBIDDEN
```

## What this directory is

A **discovery-only** qualification harness used to produce decision-grade evidence for
choosing the initial P1 `EmbeddingProvider` implementation profile
(Spec `docs/specs/p1-cross-question-deep-research.md` §5.3, OPEN_DECISION **D-1**).

## What this directory is NOT

- NOT the production `EmbeddingProvider` adapter — that is **P1-T10** and is out of scope for P1-T01.
- NOT an embedding cache, NOT dense geometry, NOT a selector, NOT a vector database.
- NOT a remote egress authorization and NOT a substitute for **P1-T02 / GATE-2**.
- NOT imported by, and not a dependency of, `zhihu-answer-grabber/`, `corpus-anthology/`
  or `research-orchestration/`.

### Isolation rationale

This harness lives in a top-level `discovery/` directory with **its own `package.json`
and lockfile** so that:

1. no production `package.json` or lockfile is touched by this ticket;
2. no production module can accidentally import probe code;
3. the scope of the ticket is mechanically checkable (`git diff --stat` shows one directory
   plus the two docs/ artifacts).

## Directory contents

| Path | Role |
|---|---|
| `fixtures/zh-semantic-battery.json` | Handcrafted synthetic Chinese discrimination battery + acceptance criteria |
| `fetch-model.mjs` | **One-time, network** step: download public ONNX model weights, record sha256 + revision |
| `providers/errors.mjs` | Discovery-proposed machine-readable failure identity codes |
| `providers/transformersjs-local-onnx.mjs` | LOCAL candidate: in-process ONNX (`Xenova/bge-small-zh-v1.5`) |
| `providers/lmstudio-openai-embeddings.mjs` | LOCAL candidate: loopback server (`text-embedding-nomic-embed-text-v1.5`) |
| `providers/remote-capability-probe.mjs` | REMOTE capability-existence probe (fixture-only, opt-in) |
| `qualify-embedding-provider.mjs` | Battery runner |

## Fixture provenance and egress boundary

All battery text is **handcrafted synthetic Chinese**. It contains no real Zhihu content,
no captured corpus, and no credentials. It is therefore safe to send to a remote provider
under the P1-T01 fixture-only rule.

P1-T02 / GATE-2 is **not active**. Consequently no remote qualification in this ticket may
send real Zhihu corpus, retrieved Zhihu source text, or real `EXTERNAL_CORPUS`. The remote
capability probe refuses to run unless the fixture file declares
`provenance.class === "SYNTHETIC_HANDCRAFTED"` and contains no real corpus.

## Reproducing the evidence

```bash
cd discovery/p1-t01-embedding-qualification

# 0. install the discovery-scoped dev dependency (reproducible: `npm ci` verified)
npm install --registry=https://registry.npmjs.org
#    (in-place `npm ci` may be blocked by a sandbox bulk-delete guard; it was verified
#     in a clean copy of package.json + package-lock.json — 80 packages, exit 0)

# 1. one-time model acquisition — EXACT REVISION REQUIRED (R1 / P1-1).
#    All files are fetched from resolve/<revision>/<file>. No `main` fallback.
#    Missing/invalid/mismatched revision → FAIL_CLOSED (exit 2).
#    behind a proxy, Node's env-proxy agent must be enabled:
export HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897
export NODE_USE_ENV_PROXY=1
node fetch-model.mjs --model Xenova/bge-base-zh-v1.5 \
  --revision 71e50dc531959f9e04ebf190ea25b00261a0a186 --dir ./models-bge-base-zh-v1.5

# 2. run the battery for a provider
P1_T01_ONNX_MODEL=Xenova/bge-base-zh-v1.5 \
P1_T01_ONNX_MODEL_DIR="$PWD/models-bge-base-zh-v1.5" \
  node qualify-embedding-provider.mjs --provider transformersjs-local-onnx

# 3. write the evidence file
P1_T01_ONNX_MODEL=Xenova/bge-base-zh-v1.5 \
P1_T01_ONNX_MODEL_DIR="$PWD/models-bge-base-zh-v1.5" \
  node qualify-embedding-provider.mjs --provider transformersjs-local-onnx \
  --out evidence/candidate-transformersjs-bge-base-zh-v1.5-r1.json
```

### Failure-identity probes are provider-specific (R1 / P1-2)

Each provider adapter declares its own `failureProbes()`; non-applicable surfaces are
reported as `N/A` with a reason and are excluded from scoring. The in-process ONNX
provider therefore has `ENDPOINT_UNREACHABLE = N/A` (no endpoint exists) and verifies
only its own surfaces (absent model / missing artifact / invalid input). No
cross-provider failure claim is present, and `NO_SILENT_PROVIDER_FALLBACK` is unchanged.

### AC_11 — proving no egress at embed time

The battery itself must run with **no outbound network**. To verify this mechanically,
re-run it with a black-hole proxy:

```bash
export HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9
export NODE_USE_ENV_PROXY=1
export P1_T01_OFFLINE_ENFORCED=1
P1_T01_ONNX_MODEL=Xenova/bge-base-zh-v1.5 \
P1_T01_ONNX_MODEL_DIR="$PWD/models-bge-base-zh-v1.5" \
  node qualify-embedding-provider.mjs --provider transformersjs-local-onnx
```

A successful run under a black-hole proxy shows no outbound call was needed or made.
(The loopback LM Studio candidate is unaffected by proxy settings; its egress class is
established by the fact that its transport is `127.0.0.1`.)

## Dependency note

`@xenova/transformers` is a **dev-only, discovery-scoped** dependency declared in this
directory's own `package.json`. See the `//dependencyJustification` field in that file for
the `RULES.md` §7 record. It is deliberately **not** added to any production package.
