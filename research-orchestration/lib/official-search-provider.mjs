// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/official-search-provider.mjs
 *
 * P1-T05 — Official Search adapter (first / currently only known retrieval-ranked
 * ZhihuDataProvider capability; Approved Spec §5.1 / §5.4; D-2a; Issue #37).
 *
 * REUSE_FIRST: this adapter WRAPS the existing `zhihu-answer-grabber` official-search
 * primitive (`searchQuestions` via the `search --json` CLI machine contract). It does
 * not reimplement search, signing, retry, or enrichment logic; it never sees the
 * Access Secret (the primitive resolves credentials itself; auth_class is a
 * classification only).
 *
 * Contract notes:
 *   - candidate identity: canonical questionId (the primitive only emits IDs it
 *     extracted from zhihu.com question URLs);
 *   - provenance: official search result order (retrieval-ranked channel for RRF §5.4);
 *   - source_url: boundary-validated by reusing the existing `classifyUrl` security
 *     classifier — a rejected URL is dropped to a per-item failure identity, never
 *     passed through unvalidated;
 *   - completeness: the search machine output carries NO pagination/completeness
 *     signal, so status stays `unknown` with explicit evidence. It is never guessed
 *     as `complete` (Spec §5.1: completeness 不得猜测);
 *   - diagnostics (T10 default-deny, P1 final cheap cleanup; durable invariant in
 *     docs/project-memory.md, same posture as the T17 global_search adapter):
 *     the subprocess boundary is untrusted — CLI/provider error messages and any
 *     raw stdout/stderr content NEVER enter any serialized failure field. Details
 *     are fixed neutral withholding notices (or bounded mechanical facts);
 *     `provider_error_type` carries only a structured, identifier-shaped
 *     `error.type` (the CLI's stable classifyError enumeration), everything else
 *     is omitted.
 */

import { classifyUrl } from '../../zhihu-answer-grabber/src/markdown-security.js';
import {
  CAPABILITY_SEARCH,
  AUTH_CLASS_OFFICIAL_SECRET,
  COMPLETENESS_UNKNOWN,
  PROVIDER_ZHIHU_OFFICIAL_SEARCH,
} from './provider-seam.mjs';

/** Machine route identity for provenance records. */
export const OFFICIAL_SEARCH_ROUTE = 'zhihu-answer-grabber:search';

function failureResult({ providerId, capability, authClass, retrievedAt, code, failureClass, detail = null, providerErrorType = null }) {
  const failure = { code, class: failureClass };
  if (detail != null) failure.detail = String(detail).slice(0, 500);
  if (providerErrorType != null) failure.provider_error_type = String(providerErrorType);
  return {
    ok: false,
    provider_id: providerId,
    capability,
    auth_class: authClass,
    retrieved_at: retrievedAt,
    items: [],
    failure,
    completeness: {
      status: COMPLETENESS_UNKNOWN,
      evidence: { reason: 'provider_failure' },
    },
  };
}

// ---------------------------------------------------------------------------
// T10 default-deny posture (docs/project-memory.md; P1 final cheap cleanup,
// same-class repair following the T17 global_search adapter precedent):
// the subprocess boundary is UNTRUSTED. CLI/provider error messages and any
// raw stdout/stderr content are an open-ended leak surface (server response
// fragments, machine paths, credential-shaped text, multi-line injection) —
// they are NEVER echoed into any serialized failure field. Every failure
// detail below is a fixed neutral adapter-controlled string (or a bounded
// mechanical fact, e.g. the exit status number); only a stable failure
// identity (code + class) plus a STRUCTURED provider_error_type survive.
// ---------------------------------------------------------------------------

/** Fixed neutral withholding notices (T17 precedent wording). */
const REPORTED_FAILURE_DETAIL = 'provider-reported failure; message withheld (default-deny)';
const NONZERO_EXIT_DETAIL = 'provider process exited with non-zero status; output withheld (default-deny)';
const UNPARSEABLE_OUTPUT_DETAIL = 'provider output was not parseable JSON; output withheld (default-deny)';

/**
 * provider_error_type carries ONLY a structured, enumerated identity — the CLI
 * machine contract's stable error classification strings (`classifyError`:
 * configuration_error / question_metadata_identity_conflict / http_error /
 * invalid_input / network_error / unknown_error). The subprocess output is
 * untrusted, so admission is mechanical: a bounded identifier-shaped string
 * only (no whitespace/control characters, no path / credential-assignment
 * shapes, ≤ 100 chars). Any other observed value — free text, numbers,
 * objects, multi-line injections — is OMITTED, never echoed (fail closed on
 * the optional diagnostic field; the machine-readable code + class identity
 * is unaffected).
 */
const PROVIDER_ERROR_TYPE_MAX_LENGTH = 100;
const PROVIDER_ERROR_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function structuredProviderErrorType(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > PROVIDER_ERROR_TYPE_MAX_LENGTH) return null;
  if (!PROVIDER_ERROR_TYPE_PATTERN.test(value)) return null;
  return value;
}

/**
 * Review repair (P1-2, Issue #37): map a non-zero primitive exit to a machine-readable
 * failure BEFORE parsing — a non-zero exit is a failure regardless of what stdout claims
 * (existing orchestrator primitive semantics fail closed on non-zero exit). A structured
 * `ok:false` error report on stdout is preserved as the provider failure identity
 * (PROVIDER_REPORTED_FAILURE + provider_error_type); anything else — including a stdout
 * claiming ok=true — fails closed as PROVIDER_PROCESS_NONZERO_EXIT.
 *
 * T10 default-deny (P1 final cheap cleanup): the provider-controlled
 * `error.message` and any raw stderr/stdout content are NEVER echoed into
 * `detail` — fixed neutral withholding notices only. `error.type` survives
 * only when it crosses the structuredProviderErrorType identity gate.
 */
function processExitFailure({ providerId, capability, authClass, retrievedAt, res }) {
  let structuredError = null;
  let claimedOk = false;
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed && parsed.ok === false && parsed.error) structuredError = parsed.error;
    if (parsed && parsed.ok === true) claimedOk = true;
  } catch { /* stdout not JSON — the failure identity below stays default-deny */ }
  if (structuredError) {
    return failureResult({
      providerId,
      capability,
      authClass,
      retrievedAt,
      code: 'PROVIDER_REPORTED_FAILURE',
      failureClass: 'provider',
      detail: REPORTED_FAILURE_DETAIL,
      providerErrorType: structuredProviderErrorType(structuredError.type),
    });
  }
  return failureResult({
    providerId,
    capability,
    authClass,
    retrievedAt,
    code: 'PROVIDER_PROCESS_NONZERO_EXIT',
    failureClass: 'process',
    // The exit status number is a bounded mechanical fact (T17 `HTTP <status>`
    // precedent); a non-numeric runner contract violation falls back to the
    // neutral notice instead of echoing an uncontrolled value.
    detail: claimedOk && Number.isSafeInteger(res.status)
      ? `primitive exited with status ${res.status} but stdout claimed ok=true`
      : NONZERO_EXIT_DETAIL,
  });
}

/**
 * @param {object} opts
 * @param {(name: string, args: string[], opts?: object) => { status: number, stdout: string, stderr: string }} opts.runner
 *     primitive runner (same injectable seam as orchestrator.mjs); default spawns the real CLI
 * @param {() => string} [opts.now] injectable ISO clock
 */
export function createOfficialSearchAdapter({ runner, now = defaultNow } = {}) {
  if (typeof runner !== 'function') throw new TypeError('official-search adapter requires a runner');

  return {
    providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,

    /**
     * @param {{ query: string }} input
     * @returns §5.1 provider result (ok=true with items, or ok=false with failure identity)
     */
    retrieve({ query } = {}) {
      const retrievedAt = now();

      if (typeof query !== 'string' || query.trim().length === 0) {
        return failureResult({
          providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
          capability: CAPABILITY_SEARCH,
          authClass: AUTH_CLASS_OFFICIAL_SECRET,
          retrievedAt,
          code: 'SEARCH_INPUT_INVALID',
          failureClass: 'input',
          detail: 'query must be a non-empty string',
        });
      }

      const res = runner('zhihu-search', [query, '--json']);

      // Review repair (P1-2, Issue #37): enforce the primitive process contract BEFORE
      // parsing — a non-zero exit is a failure even if stdout claims ok=true.
      if (res.status !== 0) {
        return processExitFailure({
          providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
          capability: CAPABILITY_SEARCH,
          authClass: AUTH_CLASS_OFFICIAL_SECRET,
          retrievedAt,
          res,
        });
      }

      let payload = null;
      try {
        payload = JSON.parse(res.stdout);
      } catch {
        return failureResult({
          providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
          capability: CAPABILITY_SEARCH,
          authClass: AUTH_CLASS_OFFICIAL_SECRET,
          retrievedAt,
          code: 'PROVIDER_OUTPUT_UNPARSEABLE',
          failureClass: 'contract',
          detail: UNPARSEABLE_OUTPUT_DETAIL,
        });
      }

      if (!payload || payload.ok !== true || payload.error) {
        // T10 default-deny: the provider-controlled `error.message` is untrusted
        // subprocess content and is NEVER returned; only the fixed neutral
        // withholding notice is. The observed `error.type` stays machine-readable
        // ONLY when it crosses the structured identity gate (see above).
        return failureResult({
          providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
          capability: CAPABILITY_SEARCH,
          authClass: AUTH_CLASS_OFFICIAL_SECRET,
          retrievedAt,
          code: 'PROVIDER_REPORTED_FAILURE',
          failureClass: 'provider',
          detail: REPORTED_FAILURE_DETAIL,
          providerErrorType: structuredProviderErrorType(payload?.error?.type),
        });
      }

      if (!Array.isArray(payload.candidates)) {
        return failureResult({
          providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
          capability: CAPABILITY_SEARCH,
          authClass: AUTH_CLASS_OFFICIAL_SECRET,
          retrievedAt,
          code: 'PROVIDER_RESULT_CONTRACT_INVALID',
          failureClass: 'contract',
          detail: 'candidates is not an array',
        });
      }

      const items = payload.candidates.map((candidate, index) => {
        const item = {
          identity: { kind: 'candidate', questionId: String(candidate?.questionId ?? '') },
          provenance: {
            route: OFFICIAL_SEARCH_ROUTE,
            rank: index + 1,
            rankOrigin: 'official_search_result_order',
          },
          source_url: null,
          facts: {},
        };

        if (!/^\d+$/.test(item.identity.questionId)) {
          item.failure = { code: 'CANDIDATE_IDENTITY_INVALID', class: 'contract' };
          return item;
        }

        // §5.1: source_url must be boundary-validated — reuse the existing security classifier.
        const classification = classifyUrl(candidate?.url);
        if (!classification || classification.clickable !== true) {
          item.failure = { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' };
          return item;
        }
        item.source_url = {
          url: classification.canonicalUrl,
          securityClass: classification.securityClass,
          displayHost: classification.displayHost,
        };

        // Pass through upstream facts only when the primitive actually provided them
        // (missing stays absent — never synthesized; answerCount semantics per V0.3 OPEN-D1).
        for (const key of ['title', 'contentType', 'answerCount']) {
          if (Object.hasOwn(candidate, key)) item.facts[key] = candidate[key];
        }
        return item;
      });

      return {
        ok: true,
        provider_id: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
        capability: CAPABILITY_SEARCH,
        auth_class: AUTH_CLASS_OFFICIAL_SECRET,
        retrieved_at: retrievedAt,
        items,
        completeness: {
          status: COMPLETENESS_UNKNOWN,
          evidence: {
            signal: 'absent',
            reason: 'search_primitive_output_provides_no_pagination_completeness_signal',
          },
        },
      };
    },
  };
}

function defaultNow() {
  return new Date().toISOString();
}
