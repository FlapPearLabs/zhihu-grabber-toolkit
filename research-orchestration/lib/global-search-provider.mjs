// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/global-search-provider.mjs
 *
 * P1-T17 — second retrieval-ranked ZhihuDataProvider adapter:
 * `zhihu-open-platform / global_search` (GATE-3 qualification,
 * discovery/p1-t03-retrieval-provider-qualification; Approved Spec §5.1 / §5.4;
 * Issue #49).
 *
 * REUSE_FIRST / ADAPTER_FIRST: this adapter wraps the GATE-3-qualified official
 * `global_search` HTTP contract (GET
 * https://developer.zhihu.com/api/v1/content/global_search). It does not
 * reimplement ranking, quota, or platform semantics, and it registers through
 * the EXISTING T05 provider seam (`lib/provider-seam.mjs`) as a second channel
 * of the §5.4 retrieval-ranked capability family `search` — alongside the first
 * channel (Official Search `zhihu_search`, `official-search-provider.mjs`).
 *
 * Identity (explicit, machine-checkable):
 *   - provider_id   = 'zhihu-open-platform' (T03 PROVIDER_ID, verbatim;
 *                     seam constant PROVIDER_ZHIHU_OPEN_PLATFORM);
 *   - capability    = 'search' (the seam's retrieval-ranked §5.4 family — this
 *                     is what RRF channel identity uses);
 *   - capability_id = 'global_search' (additive result field naming the exact
 *                     GATE-3-qualified platform capability; the seam vocabulary
 *                     itself is NOT extended);
 *   - provenance    = { route: 'zhihu-open-platform:global_search',
 *                       rank: <1-based item order>,
 *                       rankOrigin: 'global_search_result_order' }.
 *
 * Auth boundary (T03): same Bearer Access Secret credential family as
 * `zhihu_search` (`Authorization: Bearer <access_secret>`). Credentials NEVER
 * enter the seam or this adapter: the injectable `transport` performs the
 * authenticated request and only non-credential arguments ({ query, count })
 * cross this boundary. `auth_class` is a classification only.
 *
 * SEAM SYNCHRONY: T05 seam adapters are synchronous (`seam.retrieve` validates
 * the result inline). `transport` is therefore a SYNC IO boundary; async HTTP
 * bridging (real fetch wiring) is the composition layer's concern (T16), never
 * this adapter's.
 *
 * T03 durable limitations honored (UNKNOWN != PASS — nothing is guessed):
 *   - PAGINATION / COMPLETENESS: the API documents ONLY the 必返 `HasMore`
 *     boolean; NO offset/page/cursor request parameter is documented, so no
 *     pagination is invented or requested. The adapter maps the provider's own
 *     signal faithfully: HasMore=true → `partial`, HasMore=false → `complete`,
 *     each citing { basis: 'provider_reported', signal: 'HasMore', hasMore } —
 *     the same provider-reported-end-of-results precedent as the session
 *     capture wrapper (`paging.is_end`). A missing/non-boolean HasMore breaks
 *     the documented response contract → fail closed
 *     (PROVIDER_RESULT_CONTRACT_INVALID), never silently `unknown`/`complete`.
 *   - FAILURE IDENTITY: `global_search` has NO own error-code table; the
 *     sibling `zhihu_search` families (10001/20001/30001/90001) are NEVER
 *     ported across documents. A non-zero envelope `Code` maps to the neutral
 *     PROVIDER_REPORTED_FAILURE with the OBSERVED code preserved verbatim as
 *     `provider_error_type` — no cause inference. The provider-controlled
 *     `Message` is UNTRUSTED provider content and is NEVER returned (T10
 *     default-deny posture, docs/project-memory.md): the failure detail is a
 *     fixed neutral withholding notice. Envelope- and transport-level
 *     violations carry their own machine-readable codes (below); NO failure
 *     path echoes a provider-controlled response body or diagnostic string.
 *   - RANKING SCORE SURFACE ASYMMETRY (recorded, not papered over): the HTTP
 *     API doc does NOT expose a documented numeric `RankingScore` (the MCP doc
 *     shows `ranking_score`; semantics UNKNOWN). Ranking ORDER of `Items` is
 *     the evidenced contract. This adapter therefore emits rank provenance from
 *     item order and NEVER synthesizes or propagates any numeric score field —
 *     the asymmetry stays visible as an absent score.
 *   - Response shape (T03 evidence): envelope `Code` (0 = observed success) /
 *     `Message` + `Data.HasMore` (必返) + `Data.Items[]` with documented fields
 *     (Title / ContentType / ContentID / ContentText / Url / CommentCount /
 *     VoteUpCount / AuthorName / AuthorAvatar / AuthorBadge / AuthorBadgeText /
 *     EditTime / AuthorityLevel). The first-party docs example shows
 *     bare-answer items (Url `https://www.zhihu.com/answer/<id>?utm_…`,
 *     ContentType `Answer`) and Article items (zhuanlan-style) — both
 *     well-formed documented shapes (PR #73 review F1).
 *
 * Per-item identity resolution (identity FIRST, PR #73 review F1):
 *   - plain-object item with a zhihu-hosted URL carrying a `/question/<qid>`
 *     segment (shared extractQuestionId) → fusible question candidate;
 *   - zhihu-hosted URL WITHOUT a `/question/<qid>` segment (bare `/answer/<id>`,
 *     zhuanlan article, …) → CANDIDATE_QUESTION_IDENTITY_UNRESOLVED
 *     (class 'provider'): the item is well-formed, but its question identity is
 *     NOT derivable from any documented Item field and answer→question
 *     resolution is UNKNOWN/undocumented — per §18.3 no resolution semantics
 *     are invented (no redirect probing, no network resolution, no
 *     ContentID→question guessing). Machine-readable detail carries the
 *     documented `{ contentType, contentId }` fields verbatim when present
 *     (T06 projects per-item failures to `{ code, class }` in the pool).
 *   - non-zhihu hosts / unusable shapes (non-object item, missing/garbage URL)
 *     → CANDIDATE_IDENTITY_INVALID (class 'contract') — strictly genuinely
 *     unusable items;
 *   - actual candidates then cross the duplicate gate
 *     (CANDIDATE_IDENTITY_DUPLICATE) and the shared URL classifier
 *     (SOURCE_URL_BOUNDARY_REJECTED).
 *
 * Candidate identity (T06 §5.4 fusion contract): only CANONICAL zhihu question
 * candidates fuse. Item URLs are resolved with the existing shared extractor
 * (`zhihu-answer-grabber` extractQuestionId — an answer item
 * /question/<qid>/answer/... canonicalizes to question <qid>); anything that
 * cannot yield a canonical question id (external 全网信源 items, non-zhihu
 * hosts, malformed URLs) becomes an EXPLICIT per-item failure identity
 * (CANDIDATE_IDENTITY_INVALID) — never fused, never silently dropped. A
 * same-question duplicate within ONE provider response is also an explicit
 * per-item failure (CANDIDATE_IDENTITY_DUPLICATE, first/highest-rank occurrence
 * contributes) — emitting it as a fusible item would fail the whole T06 run
 * (FUSION_DUPLICATE_IN_CHANNEL) for a provider response shape that is legal
 * upstream. source_url reuses the repository's shared `classifyUrl` security
 * classifier; a rejected URL becomes SOURCE_URL_BOUNDARY_REJECTED.
 *
 * Facts surface: only DOCUMENTED fields pass through
 * (title/contentType/contentId/authorityLevel), each only when present —
 * missing stays absent, never synthesized. `ContentText` (untrusted corpus) is
 * deliberately NOT propagated: content authority stays with capture/verify,
 * the candidate pool carries identity + provenance only.
 *
 * Failure taxonomy (machine-readable, fail closed; every failure result still
 * passes the §5.1 validator so the controller can judge it):
 *   SEARCH_INPUT_INVALID                input      — bad query/count (no IO)
 *   PROVIDER_TRANSPORT_FAILURE          transport  — transport threw (diagnostics
 *                                                    DEFAULT-DENY: error.name
 *                                                    only, message never echoed)
 *   PROVIDER_TRANSPORT_CONTRACT_INVALID contract  — transport returned a
 *                                                    non-{status,body} shape
 *   PROVIDER_HTTP_ERROR                 provider   — non-2xx HTTP status
 *                                                    (detail = `HTTP <status>`
 *                                                    only; body never echoed)
 *   PROVIDER_OUTPUT_UNPARSEABLE         contract   — non-JSON body (no echo)
 *   PROVIDER_REPORTED_FAILURE           provider   — envelope Code !== 0
 *                                                    (observed code verbatim in
 *                                                    provider_error_type;
 *                                                    provider Message is never
 *                                                    echoed — default-deny)
 *   PROVIDER_RESULT_CONTRACT_INVALID    contract   — envelope/Data/HasMore/Items
 *                                                    violates the documented
 *                                                    response contract
 * Per-item: CANDIDATE_QUESTION_IDENTITY_UNRESOLVED (provider — well-formed
 *           zhihu item without a derivable question identity) /
 *           CANDIDATE_IDENTITY_INVALID (contract — genuinely unusable item) /
 *           CANDIDATE_IDENTITY_DUPLICATE (contract) /
 *           SOURCE_URL_BOUNDARY_REJECTED (boundary).
 *
 * Security / privacy: no credentials, no machine-private paths, no untrusted
 * corpus text enters any emitted field; failure details are bounded (500 chars)
 * and status-only where the source is untrusted.
 */

import { classifyUrl } from '../../zhihu-answer-grabber/src/markdown-security.js';
import { extractQuestionId } from '../../zhihu-answer-grabber/src/official.js';
import {
  CAPABILITY_SEARCH,
  AUTH_CLASS_OFFICIAL_SECRET,
  COMPLETENESS_COMPLETE,
  COMPLETENESS_PARTIAL,
  COMPLETENESS_UNKNOWN,
  PROVIDER_ZHIHU_OPEN_PLATFORM,
} from './provider-seam.mjs';

/** Machine route identity for provenance records (owner:capability). */
export const GLOBAL_SEARCH_ROUTE = 'zhihu-open-platform:global_search';

/** Exact GATE-3-qualified platform capability identity (T03 CAPABILITY). */
export const GLOBAL_SEARCH_CAPABILITY_ID = 'global_search';

/** Documented request contract (T03): Count default 10, max 20. */
const DEFAULT_COUNT = 10;
const MAX_COUNT = 20;

/** Documented response fields propagated as candidate facts (camelCase), each only when present. */
const FACT_FIELDS = Object.freeze([
  ['Title', 'title'],
  ['ContentType', 'contentType'],
  ['ContentID', 'contentId'],
  ['AuthorityLevel', 'authorityLevel'],
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failureResult({ retrievedAt, code, failureClass, detail = null, providerErrorType = null }) {
  const failure = { code, class: failureClass };
  if (detail != null) failure.detail = String(detail).slice(0, 500);
  if (providerErrorType != null) failure.provider_error_type = String(providerErrorType);
  return {
    ok: false,
    provider_id: PROVIDER_ZHIHU_OPEN_PLATFORM,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    capability_id: GLOBAL_SEARCH_CAPABILITY_ID,
    retrieved_at: retrievedAt,
    items: [],
    failure,
    completeness: {
      status: COMPLETENESS_UNKNOWN,
      evidence: { reason: 'provider_failure' },
    },
  };
}

/**
 * T10 default-deny posture: transport/network error messages are an open-ended
 * untrusted surface (they can embed URLs, paths, header or credential shapes).
 * Only the stable error class name is surfaced; the message is never echoed.
 */
function transportFailure(retrievedAt, thrown) {
  let errorType = null;
  try {
    errorType = thrown?.name ?? null;
  } catch {
    errorType = null;
  }
  return failureResult({
    retrievedAt,
    code: 'PROVIDER_TRANSPORT_FAILURE',
    failureClass: 'transport',
    detail: 'transport error (diagnostics default-deny)',
    providerErrorType: errorType,
  });
}

/**
 * Completeness from the ONLY documented signal (T03): the 必返 `HasMore`
 * boolean. true → partial, false → complete; each carries the provider-reported
 * evidence. Never guessed, never silently unknown.
 */
function completenessFromHasMore(hasMore) {
  return {
    status: hasMore ? COMPLETENESS_PARTIAL : COMPLETENESS_COMPLETE,
    evidence: { basis: 'provider_reported', signal: 'HasMore', hasMore },
  };
}

/**
 * Per-item identity resolution (PR #73 review F1) — IDENTITY FIRST:
 *   1. unusable shape (non-object item, or no parseable URL) → INVALID;
 *   2. zhihu-hosted URL with a /question/<qid> segment (shared extractor)
 *      → fusible question candidate;
 *   3. zhihu-hosted URL WITHOUT a /question/<qid> segment (bare /answer/<id>,
 *      zhuanlan article — documented shapes, PR #73 F1 evidence) → UNRESOLVED:
 *      well-formed, but the question identity is NOT derivable from any
 *      documented Item field and answer→question resolution is UNKNOWN —
 *      per §18.3 no resolution semantics are invented (no redirect probing,
 *      no network resolution, no ContentID→question guessing);
 *   4. non-zhihu host → INVALID (as before).
 * Deterministic w.r.t. the URL boundary: the shared classifier is consulted
 * only for actual candidates (verified: it marks both bare-answer and
 * zhuanlan URLs clickable — the classifier is not what separates them).
 */
function isZhihuHosted(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'zhihu.com' || host.endsWith('.zhihu.com');
  } catch {
    return false;
  }
}

function unresolvedIdentityFailure(rawItem) {
  const detail = {};
  if (Object.hasOwn(rawItem, 'ContentType')) detail.contentType = rawItem.ContentType;
  if (Object.hasOwn(rawItem, 'ContentID')) detail.contentId = rawItem.ContentID;
  const failure = { code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED', class: 'provider' };
  if (Object.keys(detail).length > 0) failure.detail = detail;
  return failure;
}

/**
 * Map one documented `Data.Items[]` entry to a §5.1 contract item.
 * Only canonical zhihu question candidates are fusible; everything else is an
 * explicit per-item failure identity (never silently dropped, never fused).
 */
function toItem(rawItem, rank, contributedQuestionIds) {
  const item = {
    identity: { kind: 'candidate', questionId: '' },
    provenance: {
      route: GLOBAL_SEARCH_ROUTE,
      rank,
      rankOrigin: 'global_search_result_order',
    },
    source_url: null,
    facts: {},
  };

  if (!isPlainObject(rawItem)) {
    // Genuinely unusable shape (non-object) — explicit rejection.
    item.failure = { code: 'CANDIDATE_IDENTITY_INVALID', class: 'contract' };
    return item;
  }

  const questionId = extractQuestionId(rawItem);
  if (!questionId) {
    if (isZhihuHosted(rawItem.Url)) {
      // Well-formed zhihu-hosted item whose URL carries no /question/<qid>
      // segment (bare /answer/<id>, zhuanlan article, …): question identity
      // UNKNOWN from documented fields — never invented (§18.3), explicit
      // machine-readable non-candidate identity with the documented
      // { contentType, contentId } detail when present.
      item.failure = unresolvedIdentityFailure(rawItem);
      return item;
    }
    // Non-zhihu host / missing-garbage URL: cannot become a question candidate.
    item.failure = { code: 'CANDIDATE_IDENTITY_INVALID', class: 'contract' };
    return item;
  }
  item.identity.questionId = questionId;

  if (contributedQuestionIds.has(questionId)) {
    // Same-question duplicate within ONE response: the highest-ranked
    // occurrence already contributes; a later one must NOT be emitted as a
    // fusible item (that would fail the whole T06 run with
    // FUSION_DUPLICATE_IN_CHANNEL). Explicit, machine-readable rejection.
    item.failure = { code: 'CANDIDATE_IDENTITY_DUPLICATE', class: 'contract' };
    return item;
  }

  // §5.1: source_url must be boundary-validated — reuse the shared classifier.
  const classification = classifyUrl(rawItem.Url);
  if (!classification || classification.clickable !== true) {
    item.failure = { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' };
    return item;
  }
  item.source_url = {
    url: classification.canonicalUrl,
    securityClass: classification.securityClass,
    displayHost: classification.displayHost,
  };

  // Documented fields only, each only when present (missing stays absent).
  // ContentText / author fields / any undocumented score field are deliberately
  // NOT propagated (untrusted corpus + UNKNOWN score semantics).
  for (const [sourceKey, factKey] of FACT_FIELDS) {
    if (Object.hasOwn(rawItem, sourceKey)) item.facts[factKey] = rawItem[sourceKey];
  }

  contributedQuestionIds.add(questionId);
  return item;
}

/**
 * @param {object} opts
 * @param {(request: { query: string, count: number }) => { status: number, body: string }} opts.transport
 *     SYNC transport boundary performing the authenticated global_search GET.
 *     The adapter never sees credential material — the transport resolves the
 *     Bearer Access Secret itself (same credential family as `zhihu_search`).
 * @param {() => string} [opts.now] injectable ISO clock
 */
export function createGlobalSearchAdapter({ transport, now = defaultNow } = {}) {
  if (typeof transport !== 'function') throw new TypeError('global-search adapter requires a transport');

  return {
    providerId: PROVIDER_ZHIHU_OPEN_PLATFORM,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,

    /**
     * @param {{ query: string, count?: number }} input
     * @returns §5.1 provider result (ok=true with items, or ok=false with failure identity)
     */
    retrieve({ query, count } = {}) {
      const retrievedAt = now();

      if (typeof query !== 'string' || query.trim().length === 0) {
        return failureResult({
          retrievedAt,
          code: 'SEARCH_INPUT_INVALID',
          failureClass: 'input',
          detail: 'query must be a non-empty string',
        });
      }
      const effectiveCount = count === undefined || count === null ? DEFAULT_COUNT : count;
      if (!Number.isSafeInteger(effectiveCount) || effectiveCount < 1 || effectiveCount > MAX_COUNT) {
        return failureResult({
          retrievedAt,
          code: 'SEARCH_INPUT_INVALID',
          failureClass: 'input',
          detail: `count must be an integer within [1, ${MAX_COUNT}] (documented T03 request contract)`,
        });
      }

      let response;
      try {
        response = transport({ query, count: effectiveCount });
      } catch (err) {
        return transportFailure(retrievedAt, err);
      }
      if (!isPlainObject(response) || !Number.isFinite(response.status) || typeof response.body !== 'string') {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_TRANSPORT_CONTRACT_INVALID',
          failureClass: 'contract',
          detail: 'transport must return { status: number, body: string }',
        });
      }

      if (response.status < 200 || response.status >= 300) {
        // Status-only detail: the response body is untrusted and never echoed.
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_HTTP_ERROR',
          failureClass: 'provider',
          detail: `HTTP ${response.status}`,
        });
      }

      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_OUTPUT_UNPARSEABLE',
          failureClass: 'contract',
          detail: null,
        });
      }
      if (!isPlainObject(payload)) {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_OUTPUT_UNPARSEABLE',
          failureClass: 'contract',
          detail: null,
        });
      }

      // Envelope contract: `Code` is the observed success/failure field. A
      // missing/non-numeric Code is an envelope contract violation. A non-zero
      // Code keeps its OBSERVED identity verbatim — global_search has no own
      // error-code table, so nothing is classified or ported (T03).
      if (typeof payload.Code !== 'number' || !Number.isFinite(payload.Code)) {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_RESULT_CONTRACT_INVALID',
          failureClass: 'contract',
          detail: 'response envelope is missing a numeric Code',
        });
      }
      if (payload.Code !== 0) {
        // F2 (PR #73 review, T10 default-deny): the provider-controlled
        // `Message` is untrusted provider content and is NEVER returned. The
        // observed Code stays machine-readable in `provider_error_type`; the
        // detail is a fixed neutral withholding notice.
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_REPORTED_FAILURE',
          failureClass: 'provider',
          detail: 'provider-reported failure; message withheld (default-deny)',
          providerErrorType: payload.Code,
        });
      }

      const data = payload.Data;
      if (!isPlainObject(data)) {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_RESULT_CONTRACT_INVALID',
          failureClass: 'contract',
          detail: 'Data envelope is missing',
        });
      }
      // HasMore is the documented 必返 completeness signal — its absence or a
      // non-boolean value breaks the documented response contract (fail closed;
      // completeness is never guessed).
      if (typeof data.HasMore !== 'boolean') {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_RESULT_CONTRACT_INVALID',
          failureClass: 'contract',
          detail: 'Data.HasMore is not a boolean (documented 必返 field)',
        });
      }
      if (!Array.isArray(data.Items)) {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_RESULT_CONTRACT_INVALID',
          failureClass: 'contract',
          detail: 'Data.Items is not an array',
        });
      }

      const contributedQuestionIds = new Set();
      const items = data.Items.map((rawItem, index) => toItem(rawItem, index + 1, contributedQuestionIds));

      return {
        ok: true,
        provider_id: PROVIDER_ZHIHU_OPEN_PLATFORM,
        capability: CAPABILITY_SEARCH,
        auth_class: AUTH_CLASS_OFFICIAL_SECRET,
        capability_id: GLOBAL_SEARCH_CAPABILITY_ID,
        retrieved_at: retrievedAt,
        items,
        completeness: completenessFromHasMore(data.HasMore),
      };
    },
  };
}

function defaultNow() {
  return new Date().toISOString();
}
