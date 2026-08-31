# P1-T03 Additional Retrieval Provider Capability Discovery — GATE-3 Evidence Report

```text
TICKET         = P1-T03 (GitHub Issue #35)
TYPE           = DISCOVERY / EVIDENCE
AUTHORITY      = NON_AUTHORITATIVE_CANDIDATE until EVIDENCE_REVIEWER PASS
                 + ff-only merge + remote master re-fetch verification
SCOPE          = evidence collection only
PRODUCTION_USE = FORBIDDEN
RISK_CLASS     = HIGH
```

## 1. Candidate

**Official `global_search` API（知乎开放平台 · 全网搜索）**

```text
PROVIDER_ID  = zhihu-open-platform
CAPABILITY   = global_search
AUTH_CLASS   = official-secret (Bearer Access Secret; same credential family as
               the existing Official Search `zhihu_search` channel — NO new
               OAuth/Session credential design required)
ENDPOINT     = GET https://developer.zhihu.com/api/v1/content/global_search
```

This is the **second** query-keyed retrieval-ranked channel on the official
platform, alongside the already-implemented first channel (`zhihu_search`,
`zhihu-answer-grabber/src/official.js`). It is NOT Session capture and does not
depend on Session/Web pagination semantics.

## 2. Why this qualifies as a retrieval-ranked channel

Approved Spec §5.4: RRF channel identity = **query + ZhihuDataProvider/capability
retrieval rankings**. The evidence below shows `global_search` is a query-keyed
capability returning a relevance-ordered result list (`Items`), distinct from
capture primitives.

First-party doc evidence (current, frozen in
`evidence/official-docs-snapshot-2026-08-31.json`, raw-response SHA256
`c3d0d4e86ef219cabd984485e289c36ee718da9b1dadd66eee9c9ff21044702a`):

- Official docs nav lists **全网搜索 API / Skill / MCP** as a first-class product
  alongside 知乎搜索; the platform positioning ("为大模型设计的高可信搜索引擎，
  整合知乎站内高质量问答与全网权威信源") is a retrieval product, not a capture tool.
- Request contract: `Query` (required keyword), `Count` (default 10, **max 20**),
  `Filter` (advanced host/publish_time filter expression), `SearchDB`
  (`all` / `realtime` / `static`).
- Response contract: `Data.HasMore` (Bool, 必返) + `Data.Items[]` ranked content
  list with per-item fields including `AuthorityLevel`（权威等级 1-4）and,
  observed in the sibling `zhihu_search` doc, `RankingScore`（排序分数，Float32，必返）.
  Note precisely: the `global_search` API doc's Item table does **not** list
  `RankingScore`; the **global_search MCP** doc returns `ranking_score` per item
  (e.g. `0.9800`). The API's ranking signal is therefore evidenced as ordered
  `Items` + MCP-side `ranking_score`, NOT as a documented API response field.
  This asymmetry is recorded, not papered over.
- 鉴权 doc explicitly names `global_search` among the Bearer-auth endpoints
  ("对于 `zhihu_search`、`global_search`、`hot_list` 等接口，调用时统一使用 Bearer 鉴权即可").
- Quota doc defines a dedicated daily quota item `global_search`（全网搜）,
  independently queryable via `GET /api/v1/quota?APIIDs=global_search`.

## 3. Evidence grading (per current precedence)

| Surface | Grade | Evidence |
|---|---|---|
| Endpoint + params + response schema | **CURRENT FIRST-PARTY DOC** | frozen snapshot (see §2), fetched 2026-08-31, unauthenticated public docs console |
| Bearer auth contract incl. `global_search` | **CURRENT FIRST-PARTY DOC** | 鉴权 doc in same snapshot |
| Independent daily quota | **CURRENT FIRST-PARTY DOC** | 额度查询 API doc in same snapshot |
| Additional access surfaces (Skill zip, MCP over SSE) | **CURRENT FIRST-PARTY DOC** | 全网搜索 Skill / MCP docs in same snapshot (not exercised — out of scope) |
| Live behavior of endpoint/auth/ranked-list/HasMore | **CURRENT REAL READ-ONLY SMOKE** | `evidence/read-only-smoke-global-search-2026-08-31.json`, VERDICT `SMOKE_PASS_SAMPLED` |

Secondary OSS/press reports (2026-05 launch coverage; e.g. third-party articles
describing API/Skill/MCP launch, daily free quota, per-search result caps) are
consistent with the first-party docs but were NOT used as decision evidence.

## 4. Read-only smoke result (sampled)

`probe-global-search.mjs` (repo-tracked, reproducible) against the live endpoint
with the existing securely-configured official Access Secret (same file already
used for the `zhihu_search` channel; **no secret material recorded**):

```text
HTTP         = 200
Code         = 0 (success)
Items        = array, len 3 (synthetic query, Count=5)
HasMore      = false (boolean, present)
Item fields  = Title / ContentType / ContentID / ContentText / Url /
               CommentCount / VoteUpCount / AuthorName / AuthorAvatar /
               AuthorBadge / AuthorBadgeText / EditTime / AuthorityLevel
VERDICT      = SMOKE_PASS_SAMPLED
```

Sampled scope: **1 synthetic query, 1 invocation, 2026-08-31**. No real Zhihu
corpus was transmitted; the query string is handcrafted synthetic text.

## 5. Contract-relevant statuses (UNKNOWN != PASS discipline)

| Status | Value | Basis |
|---|---|---|
| `PAGINATION_COMPLETENESS_STATUS` | **PARTIAL — HasMore documented & observed; no offset/page/cursor parameter documented; deeper-pagination mechanics = UNKNOWN** | Doc defines `HasMore` (必返) but no pagination request parameter; smoke observed `HasMore:false`. Completeness beyond one page is NOT asserted. |
| `FAILURE_IDENTITY_STATUS` | **PARTIAL — error-code families documented on sibling `zhihu_search` doc; `global_search` doc has NO own error-code section; envelope `Code`/`Message` observed live** | Observed `Code:0` success envelope. Failure taxonomy (10001/20001/30001/90001) is documented for `zhihu_search`; reusing it for `global_search` would be inference → recorded as UNKNOWN, not asserted. |
| Ranking semantics | **UNKNOWN (score meaning), ORDERED LIST = evidenced** | API doc does not document score semantics for `global_search`; MCP doc shows `ranking_score` attribute. Order-of-`Items` as relevance ranking is the evidenced contract; numeric score semantics stay UNKNOWN. |
| Output schema completeness | **SAMPLED ONLY** | Field table is documented as 必返, but no schema-level exhaustiveness claim is made. |
| Auth behavior | **EVIDENCED (Bearer, same secret family)** | First-party 鉴权 doc + live 200 with existing official secret. No new OAuth/session design needed → **no D-9 trigger observed**. |

## 6. D-9 assessment

D-9 (provider-specific OAuth / Session credential behavior, DEFERRED with
provider-scoped upgrade rule) — **NOT TRIGGERED** on current evidence:
`global_search` uses the same Bearer Access Secret auth family already approved
for `zhihu_search` (first-party 鉴权 doc names both endpoints under one Bearer
contract; live smoke used the existing ignored `zhihu_secret.txt`). No new
OAuth scope, session, or browser-credential behavior is required.

If the EVIDENCE_REVIEWER disagrees (e.g. considers quota/account isolation a new
credential behavior), the D-9 path is: scoped Ticket Graph amendment → Contract
review → integration. **This ticket does not perform any amendment.**

## 7. Official-first policy check (frozen, not reopened)

The frozen provider preference order (Spec §5.1) is untouched: `global_search`
is **position 1 (知乎官方能力) / position 2 (官方 API)** — it is an official
platform capability, consistent with official-first. `THIN / ADAPTER_FIRST /
REUSE_FIRST` is respected: a future adapter (T17) would wrap this HTTP contract
without redefining the seam. No provider-order amendment is proposed.

## 8. What this ticket does NOT claim

- NOT claiming multi-provider retrieval is complete — that requires T17
  implementation after independent review of this evidence.
- NOT claiming pagination completeness, ranking-score semantics, or a global
  error taxonomy for `global_search` (recorded UNKNOWN where evidence is absent).
- NOT claiming the MCP / Skill surfaces work — documented, not exercised.
- NOT modifying Ticket Graph, Approved Spec, or D-9.

## 9. T17 trigger candidate

```text
T17_TRIGGER_CANDIDATE = YES (conditional, per Tracker semantics):
  GATE-3 qualification = QUALIFIED (evidence-level), no D-9 amendment observed.
  T17 remains CONDITIONAL_NOT_ACTIVE until this report PASSes independent
  EVIDENCE_REVIEWER review and the next START_GATE re-verifies master + DAG.
```

## 10. Reproducing the evidence

```bash
# 1. freeze the first-party doc snapshot (no credentials, unauthenticated GET):
#    see evidence/official-docs-snapshot-2026-08-31.json provenance block
#    (source: GET https://developer.zhihu.com/console/api/v3/docs)

# 2. read-only live smoke (uses existing ignored repo-root zhihu_secret.txt;
#    writes no secret material into output):
node discovery/p1-t03-retrieval-provider-qualification/probe-global-search.mjs \
  --out discovery/p1-t03-retrieval-provider-qualification/evidence/read-only-smoke-global-search-<ts>.json
```

## 11. Isolation & scope

This directory is discovery-only, has **no package.json** (zero new
dependencies; Node 22 built-in `fetch` only), is not imported by any production
module, and touches no production files. Scope is mechanically checkable via
`git diff --name-only <base>...HEAD`.
