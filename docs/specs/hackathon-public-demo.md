# Hackathon Public Demo — Approved Spec Candidate

```text
DOCUMENT_STATUS = APPROVED_SPEC_CANDIDATE
PRE_EFFECTIVE_STATUS = REVIEW_PENDING
POST_EFFECTIVE_STATUS = APPROVED
APPROVAL_EFFECTIVE_ON =
  0. OWNER explicitly grants a SPEC-ONLY exception to the no-master-merge-before-final-acceptance rule
  1. CONTRACT_REVIEWER PASS on this exact candidate HEAD
  2. CONSISTENCY_REVIEWER PASS on the same exact candidate HEAD
  3. candidate remains legally descended from current remote master
  4. the exact reviewed HEAD is ff-only merged to remote master
  5. remote master is re-fetched and verified to contain the reviewed commit
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE_BEFORE_APPROVAL_EFFECTIVE_ON
VERSION_ASSIGNMENT = UNASSIGNED
DOCUMENT_ID = HACKATHON_PUBLIC_DEMO
NEXT_GATE = CONTRACT_PLUS_CONSISTENCY_REVIEW
Author handle: FlapPearLabs
Date: 2026-09-14
```

This document is a repository-native candidate for the owner-authorized Hackathon
public demo. It is not production code, deployment evidence, or a claim that the
public product exists. Review PASS alone does not activate it. All six
`APPROVAL_EFFECTIVE_ON` conditions above must be satisfied before implementation.

The owner request also says not to merge anything to `master` before final independent
acceptance. That rule and this repository's merge-to-activate Spec governance form a
real cycle: implementation cannot legally start until this Spec is effective, while
final acceptance cannot occur before implementation. This candidate does not resolve
that cycle by reinterpretation. A narrow, explicit owner decision allowing only this
reviewed Spec commit to merge before implementation is condition 0. Until then:

```text
OWNER_SPEC_ONLY_MERGE_EXCEPTION_REQUIRED
```

## 0. Authority relationship and amendment map

This candidate is an additive amendment to:

- `docs/specs/research-orchestration-scope.md`;
- `docs/specs/p1-cross-question-deep-research.md`.

All unamended P1, V2, V0.3, security, verification, coverage, evidence-lineage,
runtime, and failure contracts continue unchanged.

| Existing contract | Amendment |
|---|---|
| Research Orchestration §12 excludes GUI and web apps | Permit one public Next.js presentation plane for the Hackathon demo. |
| Research Orchestration §12 excludes background queue platforms | Permit one bounded in-process FIFO controller with one active P1 child and at most three queued jobs. This is not a general job platform. |
| Research Orchestration §12 excludes multi-user systems | Permit anonymous public requests subject to strict global and per-IP admission limits. No account, identity, tenant, or user-data system is authorized. |
| Research Orchestration §10 internal orchestration state/progress and runtime identity; P1 §6.3 orchestration state and §11 result-artifact hierarchy | Permit a coarser public job projection while preserving complete internal state. Public status must expose the current supported stage when a live job is running, but does not expose runtime/model identity. This is a public security amendment only; internal observability remains unchanged. |
| Research Orchestration §10 CLI/runtime composition | Permit a thin HTTP adapter that spawns the existing `research-p1.mjs` entrypoint. P1 remains the only research engine. |
| P1 §6.3 and §11, plus V0.3 internal canonical/handoff hierarchy | Permit a deterministic, sanitized public projection and immutable cached real runs after provenance and hash validation. Public projection does not become canonical data, a verified handoff, or an internal artifact authority. |

This amendment does not modify the P1 planner, retrieval, source selection,
embedding geometry or model, analysis, synthesis, coverage reconciliation,
canonical acceptance, verifier, or evidence-lineage semantics.

If implementation requires any such modification, stop with:

```text
P1_CONTRACT_CHANGE_REQUIRED
```

## 1. Product goal

A first-time public user can open a Vercel URL, understand the product, inspect a
sanitized historical real P1 result, submit one research topic, observe truthful
coarse-grained progress, read the completed result, and inspect traceable evidence.

The user does not need GitHub, Node.js, a CLI, a local install, or author assistance.

## 2. Authorized architecture

```text
Public browser
  -> Vercel production Next.js application
     -> static cached real runs
     -> thin BFF
        -> authenticated HTTPS
           -> Cloudflare Access
              -> Cloudflare Tunnel
                 -> 127.0.0.1:<dedicated-port> on the Mac
                    -> Demo API and bounded job controller
                       -> one child process per job
                          -> research-orchestration/bin/research-p1.mjs
```

The browser never calls the Mac origin directly. The Tunnel exposes only the Demo
API loopback listener, not SSH, Tailscale, OpenCode, development servers, or any
other Mac service.

Vercel Preview deployments are cached-only by default and receive no production
compute credential. Production may expose cached and live modes.

## 3. Frozen planes

### 3.1 Presentation plane

Vercel owns:

- production Next.js App Router UI and static assets;
- immutable cached real runs;
- request validation and a thin BFF;
- polling and public failure normalization;
- security headers and safe text rendering.

It does not own P1 execution, embedding, Zhihu/LLM secrets, checkpoints, workdirs,
or long-running research state.

### 3.2 Research compute plane

The Mac owns:

- the existing P1 runtime;
- the frozen local ONNX embedding model and model cache;
- server-generated workdirs, checkpoints, result artifacts, and private logs;
- one-active-job FIFO admission and restart reconciliation;
- core Zhihu and LLM credentials.

The first version uses one P1 child process per job and `shell: false`. It does not
embed P1 in an HTTP handler or create a second research engine.

## 4. Public API v1

The only endpoints are:

```text
POST /v1/research
GET  /v1/research/:jobId
GET  /v1/research/:jobId/result
GET  /v1/health
```

There is no public job listing, raw log, artifact-directory, workdir, runtime,
provider, model, restart, checkpoint, or arbitrary CLI surface.

`POST /v1/research` returns `202` plus an opaque job ID. BFF requests do not wait
for P1 completion. Polling begins at approximately two seconds; WebSocket, SSE,
Redis, Kafka, and a database are out of scope.

## 5. Public input contract

The exact accepted object is:

```json
{ "topic": "..." }
```

- request body is at most 2 KiB UTF-8;
- surrounding whitespace is trimmed;
- topic is 1–240 Unicode code points after trimming;
- Unicode control characters are rejected;
- topic beginning with `--` is rejected because the frozen P1 CLI interprets it as
  an option and has no option terminator; this narrow public restriction avoids a P1
  parser change and maps to `INVALID_TOPIC`;
- unknown fields are rejected;
- topic text never becomes a path, command, environment variable, model,
  provider, credential, or CLI option.

Workdirs are generated by the server under a private runtime root using a
cryptographically random job ID of at least 128 bits. Topic text is never used as a
path component.

## 6. Public job contract

The public projection is coarse and truthful. It may use only states supported by
actual persisted P1 stages or controller facts. It must not simulate percentage,
source-level increments, elapsed progress, or an ETA.

Minimum lifecycle:

```text
QUEUED
RUNNING with a supported current stage
CLARIFICATION_REQUIRED
COMPLETE
FAILED
CANCELLED
SERVER_RESTARTED
```

Supported stage labels are derived from actual P1 stage/event evidence and may be
coarser than internal stages. A running job must publish the current supported stage;
it is not optional. An implementation must not claim a distinct public stage merely
because it appears desirable in the prototype. Runtime/model identity stays in the
internal state and is deliberately excluded from the public projection.

P1 exit code 3 is projected as `CLARIFICATION_REQUIRED`, never generic failure or
success. Version 1 has no continuation endpoint: the public response uses fixed safe
copy instructing the user to make the question more specific and submit a new job.
The server does not expose internal candidates or silently choose among ambiguous
sources.

Counts are included only when actual runtime evidence supports them. In particular,
the accepted P1 does not currently prove source-by-source analysis increments such
as `117 / 396`; a timer must never manufacture them.

## 7. Public result projection

The complete internal P1 JSON is never returned to a browser. A versioned
`PublicResearchResult` is derived deterministically from hash-valid P1 artifacts.

The minimal projection contains:

```text
id
mode = live | cached-real
topic
claims[]
sourceGroups[]
evidence[]
coverage
limitations[]
generatedAt
```

Optional product sections may be added only when the actual P1 artifact schema
supports them or a deterministic, tested derivation defines them. An absent field
must be omitted or the UI must degrade; it must not be model-inferred.

The current P1 content authorities are the hash-bound final coverage,
`per-group-claims.json`, `cross-source-synthesis.json`, and verified `answers.json`.
Projection must preserve claim-to-source lineage.

### 7.1 Explicitly unsupported prototype fields

Unless future actual artifacts prove them, production must not ship:

- stance percentages or `shareRatio`;
- author badge/title;
- claim-aligned highlight quotations;
- generated hero verdicts, summaries, takeaway prose, or battle summaries;
- any statistic, identity, vote count, year, question, answer, or URL copied from
  illustrative prototype content.

Vote counts and answer timestamps may be projected only from verified `answers.json`
and only after the public schema defines their exact nullable semantics. A source
excerpt may be shown as a source excerpt; without span alignment it must not be
described as the exact quote supporting a specific claim.

### 7.2 Coverage wording

Coverage keeps retrieval and analysis separate:

```json
{
  "selectedCorpusCount": 396,
  "mappedCorpusCount": 396,
  "analyzedCorpusCount": 396,
  "analysisCoverage": 1.0,
  "analysisComplete": true,
  "retrievalCompleteness": "UNKNOWN"
}
```

`analysisCoverage = 1.0` means 100% analysis coverage of the selected corpus. It
does not mean all relevant Zhihu content was retrieved. Public copy must not claim
that the product exhausted or read all of Zhihu.

## 8. Cached real runs

Cached real runs are first-class, immutable, sanitized artifacts deployed with the
Vercel application and readable while the Mac is offline.

Every cached case must have:

- provenance to a completed, independently accepted real P1 run;
- source artifact hashes and a sanitizer/projection manifest;
- the same version-compatible public result contract as live mode;
- no raw corpus HTML, credentials, workdir, absolute path, raw logs, raw provider
  body, stack, stderr, or internal runtime configuration;
- an explicit public label such as `历史真实研究结果` or `Cached Real Run`.

Cached and live provenance are never interchangeable. Live failure must not return a
cached result while pretending success.

The existing T16 acceptance summary is a trusted provenance seed, not a complete
cached result. It lacks the research result, claims, synthesis, and verified answer
bytes required for the public dossier. Until those bytes are recovered and verified
against the recorded hashes, or a new real run is accepted, the number of eligible
cached results is zero.

## 9. Public failure contract

Public failures use stable codes and ordinary Chinese messages. At minimum:

```text
INVALID_TOPIC
JOB_NOT_FOUND
RESULT_NOT_READY
QUEUE_FULL
LIVE_RESEARCH_UNAVAILABLE
LIVE_RESEARCH_FAILED
LIVE_RESEARCH_TIMEOUT
BACKEND_UNAVAILABLE
SERVER_RESTARTED
CANCELLED
CLARIFICATION_REQUIRED
```

The browser never receives a stack trace, absolute path, workdir, provider response,
credential/cookie, subprocess command/argv, internal event dump, full stderr, raw
native diagnostic, plan hash, runtime identity, or model identity.

## 10. Resource and failure policy

Initial limits are configurable server policy:

```text
MAX_ACTIVE_JOBS = 1
MAX_QUEUE = 3
PER_IP = 2 accepted jobs per rolling hour
GLOBAL = 6 accepted jobs per rolling hour
LIVE_TIMEOUT = 20 minutes
```

The Vercel BFF is the only owner of public client-IP derivation. It removes any
browser-supplied demo identity header and derives a canonical IP only from trusted
platform connection metadata. It forwards that value in a dedicated header only on
an authenticated Access-protected request. The Mac accepts that header only after the
Cloudflare Access service-token gate; direct origin access is unavailable. The Mac
controller owns one atomic rolling-hour admission ledger for both per-IP and global
limits, so serverless instances cannot race independent in-memory counters. If a
trustworthy platform IP is unavailable or malformed, the request uses a conservative
shared unknown-client bucket; it never trusts an arbitrary browser header.

The controller safely terminates a timed-out child and publishes
`LIVE_RESEARCH_TIMEOUT`. Queue saturation publishes `QUEUE_FULL` without starting a
child.

On server restart, previously running jobs become `SERVER_RESTARTED` and are not
silently replayed. Completed results remain readable only when retained artifacts
still pass their integrity checks.

Mac offline, Tunnel failure, Zhihu failure, LLM failure, P1 failure, timeout, and
Vercel redeploy all require explicit tested behavior. P1 failure never renders
`COMPLETE`.

## 11. Secret and runtime root policy

Core Zhihu, session, and LLM secrets remain on the Mac. Vercel receives only the
inter-plane machine credential needed by Cloudflare Access.

The Mac runtime root is outside the repository and separates:

```text
models/
jobs/
results/
logs/
secrets/
```

Secret directories are `0700`; secret files are `0600`, regular files, and not
symlinks. A controlled parser reads data; shell `source` is forbidden. Only the
minimum P1 environment is passed to the child.

The embedding identity remains:

```text
@xenova/transformers 2.17.2
Xenova/bge-base-zh-v1.5
revision 71e50dc531959f9e04ebf190ea25b00261a0a186
quantized ONNX
768 dimensions
remote runtime model download disabled
```

Changing the model or embedding geometry is not authorized.

Deployment must materialize the exact frozen model revision outside the checkout,
verify every required artifact against a reviewed SHA-256 manifest, disable runtime
remote downloads, and fail readiness when any byte is absent or mismatched.

## 12. Access and network policy

The Demo API listens only on `127.0.0.1:<dedicated-port>`. Cloudflare Tunnel points
only to that loopback origin. Cloudflare Access protects the self-hosted application
with a machine-to-machine service token used by the Vercel BFF.

CORS, an obscure hostname, a query token, or Tunnel alone is not authentication.
Direct unauthenticated compute access must fail before reaching the Demo API.

No secret URL or token is committed, logged, or included in an acceptance report.

The Mac service is supervised by `launchd` unless target-host evidence establishes a
safer native alternative. Acceptance requires login/reboot recovery, automatic restart
after unexpected exit, bounded stdout/stderr retention, and logs that pass secret/path
non-disclosure checks. The supervisor starts only the loopback Demo API and never an
unrelated Mac service.

## 13. Frontend contract

Production is a new Next.js App Router application. The prototype at
`web-demo/index.html` is a visual reference only and must not be directly deployed.

The frozen design authority is:

```text
BRANCH = feat/cross-question-web-demo
COMMIT = 5331a82cb4ee703ab1c49744f2358c7305c913cf
PATHS =
  docs/product-design/hackathon-web-demo/PRODUCT_DESIGN_DIAGNOSIS.md
  docs/product-design/hackathon-web-demo/ROUND_2_DESIGN_DIRECTIONS_AND_IA.md
  docs/product-design/hackathon-web-demo/ROUND_3_AND_4_WIREFRAMES_AND_STATES.md
  docs/product-design/hackathon-web-demo/ROUND_5_AND_6_DESIGN_SYSTEM_AND_DATA_SPEC.md
  docs/product-design/hackathon-web-demo/ROUND_7_AND_8_MOTION_AND_HANDOFF_SPEC.md
  web-demo/index.html
```

Implementers consume those paths from the exact commit, not a moving branch tip.

The frontend preserves the Living Editorial Dossier direction:

- editorial home and topic input;
- explicit cached real run entry;
- truthful research stage view rather than a spinner or CLI log;
- readable claims, source-group landscape, evidence, coverage, and limitations;
- keyboard-accessible evidence drawer with visible focus and Escape close;
- responsive/mobile reading and `prefers-reduced-motion` support;
- no hover-only critical interaction;
- no generic admin dashboard, chat UI, neon AI landing page, or KPI-card wall.

All research content is untrusted plain text. React text rendering is used; arbitrary
HTML injection and automatic URL linking are forbidden. Security headers include an
appropriate CSP, `X-Content-Type-Options: nosniff`, and frame protection.

Prototype documents and pages must visibly state that illustrative copy is not
research evidence before they are introduced to the production branch.

## 14. Test obligations

Correctness-bearing code follows contract-driven TDD with positive, boundary, and
negative tests.

Required suites cover:

- request, job, result, and error contracts;
- body/code-point/control-character/unknown-field validation;
- path traversal, shell characters, malformed JSON, and forbidden public controls;
- queue capacity, single active child, timeout, child exit, failure, and restart;
- stack, secret, raw error, provider body, command, and path non-disclosure;
- cached, queued, progress, complete, failed, unavailable, drawer, keyboard, and
  mobile frontend states;
- BFF authentication header forwarding without browser exposure;
- fake deterministic P1 child integration for routine tests;
- deployment-like cached/offline/live/restart/outage acceptance.

Real Zhihu and LLM services are not called by ordinary automated tests.

## 15. Ticket DAG

```text
H01 Plane + Public API + Data Contract
 -> H06 Cached Real Run Sanitization
 -> H02 Production Next.js Frontend + BFF
 -> H03 Mac P1 Adapter + Job Controller
 -> H05 Mac Secret Loader + Runtime Root
 -> H04 Cloudflare Access + Tunnel
 -> H07 Public Safety + Failure Projection
 -> H08 Vercel + Mac Deployment
 -> H09 Real Public Acceptance + Performance
 -> H10 Submission and Demo Documentation
```

Independent tickets may be implemented concurrently on separate branches only after
this Spec is effective and their dependency gates are satisfied. There is at most one
active writer per branch. Every ticket has focused commits, tests, evidence, and the
required exact-SHA independent reviewer quorum.

No implementation or deployment ticket may be merged to master before final public
acceptance unless the owner separately changes that integration rule. This Spec
candidate itself must become effective before implementation can legally begin.

After the Spec-only exception and activation, the milestone uses one cumulative
`feat/hackathon-public-demo` integration branch. Each H ticket produces a focused
commit and an independently reviewed checkpoint on that cumulative history. A
dependency may start only after its prerequisite checkpoint has the required exact-SHA
PASS; the checkpoint is not reported as merged or DONE. Subsequent commits do not
transfer an old review verdict to the new cumulative HEAD. H09 triggers fresh final
code, security, and integration review of the exact cumulative HEAD and deployed
configuration. Only that final PASS permits one ff-only merge of the accumulated
branch and remote verification. This is the owner-authorized milestone execution
topology required by the no-intermediate-merge rule; it does not waive per-ticket
review, scope, or evidence gates.

## 16. Real acceptance

H09 must perform at least one real end-to-end live run through:

```text
production or production-like frontend
 -> Vercel BFF
 -> Cloudflare Access
 -> Tunnel
 -> Mac Demo API
 -> real research-p1.mjs
 -> sanitized public result
```

The acceptance records topic, cold/warm runtime when available, model load duration,
peak RSS, swap before/after, CPU behavior, failure rate scope, selected/mapped/analyzed
counts, final status, and a sanitized evidence path.

Historical runtime numbers do not establish target-host performance.

A first-time participant who knows nothing about the repository must, using only the
public URL and within three minutes, be able to understand the product, open a cached
real result, inspect a claim and its evidence, understand the coverage limitation,
submit live research, and observe at least one truthful state transition.

## 17. Completion definition

`HACKATHON_PUBLIC_DEMO_READY = PASS` only when all of the following are real and
verified:

- public Vercel URL serves the production Next.js experience;
- at least one complete provenance-verified cached real result is readable with the
  Mac offline;
- the authenticated live path reaches the real P1 and returns a valid public result;
- Preview cannot access production compute by default;
- the Mac API is loopback-only and Access rejects unauthenticated callers;
- secret, raw error, path, workdir, CLI, runtime, provider, and arbitrary HTML
  surfaces remain private;
- live failure never silently falls back to cached content;
- mobile and accessibility checks pass;
- H09 performance evidence is recorded;
- final independent security and integration acceptance passes on the exact deployed
  candidate.

Missing external authorization, credentials, source artifacts, or a real run remains
`BLOCKED` or `NOT_RUN`; it is never upgraded to PASS from a plan or mock.

The final implementation report records each of these fields with exactly one status
from `PASS | FAIL | BLOCKED | NOT_RUN`:

```text
P1_BASELINE_SHA
DESIGN_BASELINE_SHA
INTEGRATION_BRANCH
INTEGRATION_HEAD_SHA
PUBLIC_FRONTEND
CACHED_REAL_RUN
LIVE_RESEARCH
VERCEL_DEPLOYMENT
CLOUDFLARE_TUNNEL
CLOUDFLARE_ACCESS
MAC_COMPUTE_SERVICE
LOCAL_EMBEDDING
SECRET_ISOLATION
RATE_LIMIT
FAILURE_ISOLATION
MOBILE_UX
PUBLIC_E2E
```

## 18. Non-goals

- no P1 semantic redesign;
- no canonical runner public exposure;
- no second research engine;
- no parallel P1 jobs in the first version;
- no database, Redis, WebSocket, SSE, Kafka, Kubernetes, or PM2 requirement;
- no account, tenant, billing, social publishing, recommendation, or autonomous topic
  discovery system;
- no CAPTCHA/access-control bypass, proxy pool, or high-frequency crawling;
- no model change or remote runtime model download;
- no illustrative evidence presented as fact;
- no production compute credential in Preview by default;
- no direct exposure of unrelated Mac services.
