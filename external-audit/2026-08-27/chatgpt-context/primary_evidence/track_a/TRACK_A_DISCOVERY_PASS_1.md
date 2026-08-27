# Zhihu CLI Pro — Track A Discovery Pass 1

STATUS: DISCOVERY_EVIDENCE_ONLY  
DATE: 2026-08-26  
SPEC_STATUS: NOT_A_SPEC  
VERSION_ASSIGNMENT: UNASSIGNED  
IMPLEMENTATION_AUTHORIZATION: NONE  

> This document records the first current-state capability audit after the 2026-08-26 source-authority reconciliation. It is evidence / architecture input only. Unknowns remain unknown.

---

## 0. Authority / Scope Reconciliation Completed

Repository Level 0 remains authoritative:

- `AGENTS.md`
- `RULES.md`
- Applicable Approved Specs
- current approved product behavior contracts

The current Approved v0.3 scope states:

```text
VIDEO_SUPPORT = DO_NOT_SUPPORT
```

Therefore the newer Project Sources were reconciled as follows:

- Video removed from the current canonical-object target list.
- Video removed from the current Provider Discovery target list.
- Historical evidence that an external/official surface may expose video-like content may remain as evidence only.
- Reopening Video support requires a separate Approved Spec amendment.

No production code or Approved Spec was changed in this reconciliation.

---

## 1. Evidence Grades

```text
FIRST_PARTY_DOC
FIRST_PARTY_BINARY_OR_SKILL_OBSERVED
REAL_SMOKE
OSS_SOURCE
SECONDARY_REPORT
UNVERIFIED
```

Evidence rule:

```text
CURRENT FIRST-PARTY > REAL SMOKE > CURRENT OSS SOURCE > SECONDARY REPORT > OLD NOTES
```

A capability is not promoted merely because multiple secondary sources repeat it.

---

## 2. Current Official Platform — Confirmed First-Party Surface

### 2.1 Official catalog

Current first-party developer catalog exposes the following capability families:

- Authentication
- Zhihu CLI
- Zhihu Search — API / Skill / MCP
- Global Search — API / Skill / MCP
- Direct Answer / Zhida — API / Skill / MCP
- Hot List — API / Skill / MCP
- Knowledge Base APIs
- PDF Parse API
- PPT Generation API
- Zhihu user data:
  - OAuth onboarding
  - user contents API
  - user followees API
  - user favorites API
  - favorite collection list API
  - favorite collection contents API

Evidence grade: `FIRST_PARTY_DOC`

Official entry:

- https://developer.zhihu.com/
- https://developer.zhihu.com/docs

### 2.2 Bearer / Access Secret authentication

Current first-party docs confirm that `zhihu_search`, `global_search`, `hot_list` use:

```text
Authorization: Bearer <access_secret>
X-Request-Timestamp: <Unix seconds>
```

The official search example uses:

```text
GET https://developer.zhihu.com/api/v1/content/zhihu_search
```

Evidence grade: `FIRST_PARTY_DOC`

Confirmed product meaning:

- Access Secret is a credential, not a separate data universe.
- HTTP API / CLI / Skill / MCP should be modeled capability-first, not transport-first.

### 2.3 Zhihu Search MCP

Current first-party docs confirm:

```text
SSE:
https://developer.zhihu.com/api/mcp/zhihu_search/v1/sse

Message:
https://developer.zhihu.com/api/mcp/zhihu_search/v1/message

Tool:
zhihu_search
```

Transport:

```text
MCP over SSE
initialize -> tools/list -> tools/call
```

Input:

```text
query: String, 2..100
count: Number, 1..10, default 10
```

Output behavior:

- MCP result is `text`.
- text body is model-oriented XML.
- observed example fields include title/content_type/url/author metadata/edit_time/authority_level/ranking_score.
- POST to message endpoint may return HTTP 202 while JSON-RPC result arrives on SSE.
- current service exposes tools, not resources/prompts.

Evidence grade: `FIRST_PARTY_DOC`

Important architecture implication:

> Official MCP output must not automatically become our canonical data contract. It is a model-facing transport representation. Provider provenance and raw response should remain preserved, and canonicalization must remain deterministic.

---

## 3. Official Zhihu CLI — Current Evidence Status

### 3.1 What is first-party confirmed

The current official developer catalog contains a top-level `Zhihu CLI` documentation entry.

Official CLI doc URL is reachable:

```text
https://developer.zhihu.com/docs?key=zhihu_cli
```

Evidence grade:

```text
FIRST_PARTY_DOC_CATALOG_PRESENCE
```

### 3.2 What is NOT yet first-party observed in this pass

We have not yet independently inspected the current official Skill archive / binary in this environment.

Therefore the exact current command tree remains:

```text
FIRST_PARTY_BINARY_OR_SKILL_OBSERVED = NO
REAL_SMOKE = NO
```

The following command families are strongly corroborated by recent secondary reports and current OSS wrappers, but are NOT promoted to first-party-binary evidence yet:

```text
auth status --verify
auth set --secret-stdin
search zhihu
search global
hot
answer
me contents
me followees
me favorites ...
```

Recent secondary reports also describe `capabilities`, `--help`, OS keychain storage, pagination on `me contents`, and collection-content pagination.

Evidence grade:

```text
SECONDARY_REPORT / OSS_SOURCE
```

### 3.3 Security correction

Some recent tutorials suggest sending Access Secret to an Agent chat.

That practice conflicts with this repository's Level 0 `RULES.md`.

For this project:

```text
SECRET_IN_CHAT = FORBIDDEN
SECRET_IN_ARGV = FORBIDDEN
SECRET_IN_REPO/LOG/ARTIFACT = FORBIDDEN
```

Future CLI smoke must use an already locally configured credential or a local stdin / secret-store flow without exposing its value to the research worker or report.

---

## 4. Official API / CLI / Skill / MCP Parity — Preliminary Matrix

| Capability | Official catalog | HTTP API | Official CLI | Official Skill | Official MCP | Current confidence |
|---|---|---|---|---|---|---|
| Zhihu Search | confirmed | confirmed | secondary/OSS corroborated | catalog confirmed | exact Search MCP confirmed | HIGH for API/MCP; MEDIUM CLI |
| Global Search | confirmed | catalog confirmed | secondary/OSS corroborated | catalog confirmed | catalog confirmed | MEDIUM-HIGH |
| Hot List | confirmed | auth family confirmed | secondary/OSS corroborated | catalog confirmed | catalog confirmed | MEDIUM-HIGH |
| Direct Answer | confirmed | catalog confirmed | secondary/OSS corroborated | catalog confirmed | catalog confirmed | MEDIUM-HIGH |
| Own contents | confirmed user-data family | catalog confirmed | secondary/OSS corroborated | CLI skill likely | not established | MEDIUM |
| Own followees | confirmed user-data family | catalog confirmed | secondary/OSS corroborated | CLI skill likely | not established | MEDIUM |
| Own favorites | confirmed user-data family | catalog confirmed | secondary/OSS corroborated | CLI skill likely | not established | MEDIUM |
| Favorite collections | confirmed | catalog confirmed | secondary/OSS corroborated | CLI skill likely | not established | MEDIUM |
| OAuth delegated user | confirmed | OAuth family confirmed | not established as CLI surface | not established | not established | MEDIUM for existence; LOW exact semantics |
| Knowledge Base | confirmed | confirmed family | community wrapper exists | catalog API only | not established here | MEDIUM-HIGH |
| PDF/PPT | confirmed | confirmed family | community wrapper exists | catalog API only | not established here | MEDIUM-HIGH |

Rules:

- `catalog confirmed` does not mean exact request/response contract has been independently extracted in this pass.
- CLI command names remain provisional until official Skill/binary observation.
- capability parity must be validated capability-by-capability; do not assume all transports expose identical fields, limits, pagination, or error semantics.

---

## 5. Auth Matrix — Preliminary

| Auth class | Intended boundary | Current evidence | Unknowns |
|---|---|---|---|
| Access Secret / Bearer | official platform capabilities; public search services definitely confirmed | FIRST_PARTY_DOC | exact account capability grants; user-data permission behavior |
| Official CLI credential storage | own Agent / own account workflow | SECONDARY_REPORT + OSS corroboration | current binary behavior; exact version; OS-specific error semantics |
| OAuth Authorization Code | delegated-user application | official catalog + current OSS audit | scope, state, PKCE, refresh, revoke, user-info contract |
| Cookie / Web Session | session-only Web capabilities | current toolkit + OSS_SOURCE | stable provider boundaries, pagination, rate behavior |
| QR login | acquire Web session | OSS_SOURCE | current endpoint stability, lifecycle, secure persistence |
| Existing Browser Session | reuse already logged-in browser | OpenCLI OSS_SOURCE | least-privilege bridge design, cookie/token exposure, isolation model |

### OAuth finding

A current, actively maintained official-platform wrapper (`klarkxy/zhihu-search`) explicitly refuses to invent undocumented OAuth behavior. Its current code implements only:

```text
GET https://openapi.zhihu.com/authorize
POST https://openapi.zhihu.com/access_token
```

and deliberately does not invent:

```text
scope
state
PKCE
refresh token
revoke
user-info endpoint
```

This is `OSS_SOURCE`, not first-party authority, but it is a strong signal that those items must remain `UNKNOWN` until direct official evidence / smoke resolves them.

---

## 6. Current Toolkit vs External Capability Gap

Current `FlapPearLabs/zhihu-grabber-toolkit` master already provides:

- Zhihu search for question discovery;
- single-question answer capture;
- pagination / resume;
- verification / provenance / evidence lineage;
- question metadata;
- answer rich-content metadata;
- limited optional root-comment enrichment;
- large-corpus verified analysis;
- single-question natural-language research orchestration.

Current explicit limits include:

- no complete author profile;
- no full comment tree / subcomments;
- no general Article provider;
- no general Pin provider;
- no full Topic provider;
- no Collection / own-history provider;
- no QR / Browser Session reuse provider;
- no cross-question verified corpus orchestration yet;
- Video intentionally unsupported by Level 0 contract.

This confirms the next platform work is a provider/canonicalization gap, not a reason to rewrite the existing Research Kernel.

---

## 7. OSS Provider Audit — Pass 1

### 7.1 `dawnswwwww/zhihu-cli`

Evidence:

- current public repository;
- MIT license;
- community wrapper around Zhihu Open Platform capability;
- thin CLI/client architecture;
- recent 2026 maintenance;
- public search/global/hot/answer-oriented capability.

Preliminary disposition:

```text
REFERENCE + POSSIBLE ADAPT
NOT YET A REQUIRED DEPENDENCY
```

Why:

- permissive license;
- useful thin-wrapper patterns;
- but official HTTP is simple enough that direct capability adapters may remain thinner than taking a dependency.

### 7.2 `klarkxy/zhihu-search`

Evidence:

- very active in August 2026;
- explicit API coverage crosswalk;
- CLI + MCP + Skill + OpenAPI multi-surface architecture;
- robust attention to OAuth unknowns, pagination ambiguity, structured errors, quotas;
- Python 3.10+, FastMCP/FastAPI/httpx stack;
- license: SATA v2.0 (MIT-like text plus star/thank condition).

Preliminary disposition:

```text
HIGH-VALUE REFERENCE
POSSIBLE ADAPT
DIRECT DEPENDENCY = HOLD
```

Hold reasons:

1. non-standard SATA license requires a deliberate compliance decision;
2. Python/FastMCP/FastAPI stack may be excessive for the current Node-based thin data layer;
3. much of its value is capability mapping / error semantics / multi-surface architecture rather than unique data access.

### 7.3 `Xiaofan629/zhihu-cli`

Evidence:

- Apache-2.0;
- Question / Answer / Article / Pin / User / comments / collections / feed style Web-session surface;
- structured output-envelope design;
- maintained in 2026, but less current than OpenCLI / klarkxy at this snapshot.

Preliminary disposition:

```text
REFERENCE + ADAPTER CANDIDATE
```

High-value parts:

- canonical content/envelope ideas;
- broad read-capability map;
- Web-session error handling.

Needs before reuse:

- endpoint-currentness audit;
- credential storage audit;
- pagination/completeness smoke;
- tests/failure semantics review.

### 7.4 `BAIGUANGMEI/zhihu-cli`

Evidence:

- Apache-2.0;
- QR login, Cookie login, user/topic/feed/collection/comments and broad Web V4 surface;
- README explicitly advertises browser-fingerprint consistency to lower anti-scraping/risk-control behavior;
- README exposes a literal `--cookie "..."` interface.

Level 0 conflict:

- project forbids stealth / anti-detection techniques;
- project forbids unsafe credential handling via argv/chat.

Preliminary disposition:

```text
DEPENDENCY = REJECT
REFERENCE_ONLY_FOR_CAPABILITY_LEADS
```

Allowed use:

- capability discovery;
- endpoint/schema lead generation;
- QR state-machine ideas only after separate security verification.

Forbidden to import as product behavior:

- stealth / browser-fingerprint anti-detection stack;
- literal-cookie argv workflow;
- write surface by default.

### 7.5 `jackwener/OpenCLI`

Evidence:

- Apache-2.0;
- highly active current repository;
- Browser Bridge / browser-backed adapter architecture;
- current Zhihu adapter documents:
  - hot
  - recommend
  - search
  - question answers
  - answer detail
  - answer comments with reply hierarchy
  - favorite collections and contents
  - article/answer export
- current project also has write commands, but write surface is separable;
- recent commits explicitly harden structured network capture and redact credential-shaped / CSRF values.

Preliminary disposition:

```text
HIGH-PRIORITY BROWSER-SESSION ADAPTER CANDIDATE
SECURITY AUDIT REQUIRED BEFORE REUSE
```

Why it is more interesting than a raw cookie copier:

> It can potentially let Zhihu CLI Pro reuse an already authenticated browser session while keeping the browser as the credential owner.

Still unknown:

- exact bridge privilege surface;
- whether canonical reads can be exposed without credential material leaving the bridge;
- failure/timeout/session-expiry semantics;
- whether a minimal read-only subset can be wrapped without importing write authority.

### 7.6 `zly2006/zhurl`

Evidence:

- active 2026 low-level Zhihu API exploration client;
- documents Web/API endpoint behavior;
- Cargo metadata: `AGPL-3.0-only`;
- uses Zhihu++ cookie/signing context.

Preliminary disposition:

```text
REFERENCE_ONLY / DISCOVERY_TOOL
```

Reason:

- AGPL licensing;
- unofficial endpoint contracts are inherently unstable;
- best value is debugging / schema reconnaissance, not production dependency.

### 7.7 `zhihu-plus-plus`

Preliminary disposition:

```text
REFERENCE_ONLY
```

Reason:

- broad real-world client capability evidence;
- AGPL distribution implications;
- mobile-client architecture is not the desired thin provider dependency.

---

## 8. Preliminary Provider Roles

This is not a frozen target architecture. It is the current evidence-backed working model.

```text
OFFICIAL_HTTP
  strongest candidate for public/open-platform canonical provider

OFFICIAL_CLI
  strongest candidate for official Agent UX / own-user access surface
  exact binary contract still needs observation

OFFICIAL_SKILL
  installation/instruction surface; not automatically a canonical data provider

OFFICIAL_MCP
  useful interoperability surface
  model-oriented representation; not automatically canonical

OAUTH_PROVIDER
  delegated-user provider
  exact current semantics incomplete

SESSION_WEB_PROVIDER
  complement for content objects / public history / deep comments not covered officially

BROWSER_SESSION_PROVIDER
  potential safest session UX if credential remains owned by browser

CURRENT_V0_3_PROVIDER
  retain existing question/answer capture and verifier behavior; do not rewrite
```

---

## 9. Completeness Semantics — Findings So Far

### 9.1 Search

Official Zhihu Search MCP has a bounded `count` of 1..10 per call.

This alone cannot justify source-completeness claims.

Therefore:

```text
SEARCH = RETRIEVAL_COVERAGE
NOT SOURCE_COMPLETENESS
```

### 9.2 Own contents / collections

Recent CLI reports and current OSS audits suggest some official user-data surfaces expose explicit offset / next-offset semantics, while others may only document `Limit` or a recent subset.

Until current first-party/binary smoke verifies each endpoint:

```text
OWN_CONTENTS_COMPLETENESS = UNKNOWN/PARTIAL_BY_CAPABILITY
COLLECTION_LIST_COMPLETENESS = UNKNOWN
RECENT_FAVORITES = EXPLICITLY NOT HISTORICAL_COMPLETENESS
```

### 9.3 Session/Web

Do not infer completeness just because a Web client can paginate.

Each resource needs separate checks for:

```text
pagination termination
stable identity
repeated/stalled page detection
deleted/unavailable semantics
hard caps
rate behavior
server ordering
```

### 9.4 Cross-provider rule

```text
provider A failure
!= permission to silently fall back to provider B
```

Provider choice/fallback reason must be explicit and provenance-preserving.

---

## 10. Most Important Unknowns After Pass 1

### P0 discovery unknowns

1. Current official CLI binary version and exact command tree.
2. Official CLI current structured output contract and stable error codes.
3. Current official `me` pagination/completeness by subcommand.
4. Access Secret actual account capability boundary.
5. OAuth exact documented flow semantics: state/scope/PKCE/refresh/revoke/user-info.
6. Official user API exact pagination and delegated-vs-own auth behavior.
7. Poll / structured voting-result support.
8. Official vs Session/Web content completeness for Article / Pin / comments / public user history.
9. OpenCLI Browser Bridge security boundary for read-only reuse.
10. QR/session lifecycle and secure persistence design.

### P1 discovery unknowns

- Topic exact current fields and enumerable relationships.
- full comment tree hard limits / ordering semantics.
- search depth / duplicate behavior across multiple query rounds.
- provider rate/error behavior.
- canonical identity mapping across official search URLs and Web objects.

---

## 11. Required Next Evidence Pass

### Pass 2A — Official Skill / Binary Static Observation

On a machine able to fetch the official CDN artifact:

1. fetch only from current official domain;
2. inspect archive before execution;
3. record manifest/version/hash metadata without secrets;
4. inspect scripts/installers;
5. install only after static review;
6. run:

```text
version
capabilities
--help
auth --help
search --help
me --help
me favorites --help
```

Output evidence must redact no secret because no secret should be present.

### Pass 2B — Local Read-Only Smoke

Use an already locally configured Access Secret or secure local stdin / secret-store injection.

Never paste it into chat/report.

Minimum smoke:

```text
auth status --verify
search zhihu -- minimal bounded query
search global -- minimal bounded query
hot -- minimal bounded query
me contents --limit 1
me followees --limit 1
me favorites lists/recent/items -- minimum legal bounds
```

Record only:

```text
command/version
success/failure class
safe field names/types
paging shape
counts/limits
elapsed/request behavior
credential source class (not value)
```

### Pass 2C — OAuth First-Party Extraction / Smoke

Goal:

- resolve authorize/token parameters;
- verify whether scopes exist;
- verify refresh/revoke semantics if documented;
- determine delegated-user API authorization header and data boundary;
- keep undocumented fields UNKNOWN.

### Pass 2D — Session/Web Read-Only Comparison

Candidates:

1. current toolkit existing Session/Web client;
2. OpenCLI browser-backed Zhihu adapter;
3. one Apache-licensed session CLI as comparison;
4. AGPL tools only as discovery references.

Test content classes within current Level 0 scope:

```text
Question
Answer
Article
Pin
Comment
Topic
Collection
User / Public History
Poll (discovery only if evidence appears)
```

Video remains excluded.

---

## 12. Evidence Gate Status

```text
TRACK_A_PASS_1 = COMPLETE
SOURCE_AUTHORITY_VIDEO_CONFLICT = RESOLVED
OFFICIAL_PLATFORM_CATALOG = CONFIRMED
OFFICIAL_SEARCH_MCP = CONFIRMED
OFFICIAL_BEARER_SEARCH_AUTH = CONFIRMED
OFFICIAL_CLI_CATALOG_PRESENCE = CONFIRMED
OFFICIAL_CLI_BINARY_CONTRACT = NOT_YET_OBSERVED
REAL_ACCESS_SECRET_SMOKE = NOT_RUN
OAUTH_EXACT_SEMANTICS = PARTIAL / UNKNOWN
SESSION_PROVIDER_SELECTION = NOT_FINAL
POLL_SUPPORT = UNKNOWN

SPEC_PREPARATION_GATE = NOT_READY
PRODUCTION_IMPLEMENTATION = NOT_AUTHORIZED
```

The correct next step is evidence Pass 2, not Spec authoring.
