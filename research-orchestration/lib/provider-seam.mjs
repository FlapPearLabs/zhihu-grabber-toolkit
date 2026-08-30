// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/provider-seam.mjs
 *
 * P1-T05 — ZhihuDataProvider / CapabilityProvider seam
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §5.1 / §5.4;
 *  D-2a delegation boundary; Issue #37).
 *
 * The seam is a CONTRACT + EXPLICIT ROUTING layer only. It owns:
 *   - the §5.1 minimal provider contract vocabulary: provider_id / capability /
 *     auth_class / candidate or source-group identity / provenance / source_url /
 *     retrieved_at / pagination-completeness status / machine-readable failure identity;
 *   - mechanical adapter-registration validation and provider-result validation;
 *   - explicit provider routing with NO_SILENT_PROVIDER_FALLBACK and
 *     UNKNOWN_PROVIDER_CONTRACT fail-closed semantics.
 *
 * Hard rules (Spec §5.1):
 *   NO_SILENT_PROVIDER_FALLBACK        — a failed/missing provider is never silently
 *                                        substituted by another provider or capability.
 *   UNKNOWN_PROVIDER_CONTRACT != PASS  — an adapter or result whose contract cannot be
 *                                        mechanically established fails closed.
 *
 * Boundaries (Issue #37 / D-2a):
 *   - The seam does NOT implement retrieval/selection logic itself.
 *   - No new browser scraping / Browser-Session data access, no OAuth (OUT_OF_SCOPE).
 *   - Exact per-capability routing/priority stays OPEN / DISCOVERY_REQUIRED (D-2):
 *     the seam never guesses between multiple registered providers for one capability.
 *   - Credentials never enter the seam: auth_class is a classification, adapters only
 *     forward non-credential arguments to existing primitives.
 *   - Existing capture authority is NOT redefined: capture results mirror
 *     `captured != verified` and name verify-output as the validity authority.
 */

/** Capability identities. `search` is the only known retrieval-ranked channel (§5.4). */
export const CAPABILITY_SEARCH = 'search';
export const CAPABILITY_CAPTURE = 'capture';
export const CAPABILITIES = Object.freeze([CAPABILITY_SEARCH, CAPABILITY_CAPTURE]);

/** Auth classifications (§5.1). Values are classes, never credential material. */
export const AUTH_CLASS_OFFICIAL_SECRET = 'official-secret';
export const AUTH_CLASS_OAUTH = 'oauth';
export const AUTH_CLASS_SESSION = 'session';
export const AUTH_CLASSES = Object.freeze([
  AUTH_CLASS_OFFICIAL_SECRET,
  AUTH_CLASS_OAUTH,
  AUTH_CLASS_SESSION,
]);

/** Pagination / completeness states (§5.1). Every state must carry provider evidence. */
export const COMPLETENESS_COMPLETE = 'complete';
export const COMPLETENESS_PARTIAL = 'partial';
export const COMPLETENESS_UNKNOWN = 'unknown';
export const COMPLETENESS_STATES = Object.freeze([
  COMPLETENESS_COMPLETE,
  COMPLETENESS_PARTIAL,
  COMPLETENESS_UNKNOWN,
]);

/** Registered provider identities shipped with this seam. */
export const PROVIDER_ZHIHU_OFFICIAL_SEARCH = 'zhihu-official-search';
export const PROVIDER_ZHIHU_SESSION_CAPTURE = 'zhihu-session-capture';

/** Fail-closed error codes surfaced by the seam. */
export const SEAM_ERROR_UNSUPPORTED_CAPABILITY = 'UNSUPPORTED_CAPABILITY';
export const SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK = 'NO_SILENT_PROVIDER_FALLBACK';
export const SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT = 'UNKNOWN_PROVIDER_CONTRACT';
export const SEAM_ERROR_ADAPTER_CONTRACT_INVALID = 'PROVIDER_ADAPTER_CONTRACT_INVALID';

/** Machine-readable error with a stable identity code (controller-checkable). */
export class ProviderSeamError extends Error {
  constructor(code, message, { details = null } = {}) {
    super(message);
    this.name = 'ProviderSeamError';
    this.code = code;
    this.details = details;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

/**
 * Mechanically validate an adapter's self-description (§5.1 floor).
 * Returns { valid, reason } — never throws.
 */
export function validateAdapterContract(adapter) {
  if (!isPlainObject(adapter)) return { valid: false, reason: 'adapter is not an object' };
  if (!isNonEmptyString(adapter.providerId)) return { valid: false, reason: 'providerId missing/empty' };
  if (!CAPABILITIES.includes(adapter.capability)) return { valid: false, reason: `unknown capability: ${String(adapter.capability)}` };
  if (!AUTH_CLASSES.includes(adapter.authClass)) return { valid: false, reason: `unknown auth_class: ${String(adapter.authClass)}` };
  if (typeof adapter.retrieve !== 'function') return { valid: false, reason: 'retrieve is not a function' };
  return { valid: true, reason: null };
}

/**
 * Mechanically validate a §5.1 provider result (the controller's mechanical gate).
 * Every result — success or failure — must let the controller judge: which
 * provider/capability, which candidate/group, is pagination complete, what failed.
 * Returns { valid, reason } — never throws.
 */
export function validateProviderResult(result) {
  if (!isPlainObject(result)) return { valid: false, reason: 'result is not an object' };
  if (!isNonEmptyString(result.provider_id)) return { valid: false, reason: 'provider_id missing/empty' };
  if (!isNonEmptyString(result.capability)) return { valid: false, reason: 'capability missing/empty' };
  if (!AUTH_CLASSES.includes(result.auth_class)) return { valid: false, reason: `unknown auth_class: ${String(result.auth_class)}` };
  if (!isIsoTimestamp(result.retrieved_at)) return { valid: false, reason: 'retrieved_at is not an ISO timestamp' };

  const completeness = result.completeness;
  if (!isPlainObject(completeness)) return { valid: false, reason: 'completeness missing' };
  if (!COMPLETENESS_STATES.includes(completeness.status)) {
    return { valid: false, reason: `unknown completeness status: ${String(completeness?.status)}` };
  }
  if (!isPlainObject(completeness.evidence)) return { valid: false, reason: 'completeness evidence missing (不得猜测)' };

  if (result.ok === true) {
    if (!Array.isArray(result.items)) return { valid: false, reason: 'items must be an array on success' };
    for (let i = 0; i < result.items.length; i += 1) {
      const item = result.items[i];
      if (!isPlainObject(item)) return { valid: false, reason: `items[${i}] is not an object` };
      if (!isPlainObject(item.identity) || !isNonEmptyString(item.identity.questionId)) {
        return { valid: false, reason: `items[${i}].identity.questionId missing/empty` };
      }
      if (!isPlainObject(item.provenance)) return { valid: false, reason: `items[${i}].provenance missing` };
      const hasFailure = isPlainObject(item.failure);
      if (hasFailure) {
        if (!isNonEmptyString(item.failure.code) || !isNonEmptyString(item.failure.class)) {
          return { valid: false, reason: `items[${i}].failure needs machine-readable code + class` };
        }
        if (item.source_url != null) return { valid: false, reason: `items[${i}] must not carry source_url beside a failure` };
      } else {
        const su = item.source_url;
        if (su !== null && su !== undefined) {
          if (!isPlainObject(su) || !isNonEmptyString(su.url) || !su.url.startsWith('https://')
            || !isNonEmptyString(su.securityClass)) {
            return { valid: false, reason: `items[${i}].source_url is not a boundary-validated https URL record` };
          }
        }
      }
    }
    return { valid: true, reason: null };
  }

  if (result.ok === false) {
    const failure = result.failure;
    if (!isPlainObject(failure) || !isNonEmptyString(failure.code) || !isNonEmptyString(failure.class)) {
      return { valid: false, reason: 'failure identity needs machine-readable code + class' };
    }
    if (!Array.isArray(result.items)) return { valid: false, reason: 'items must be an array on failure' };
    return { valid: true, reason: null };
  }

  return { valid: false, reason: 'ok must be boolean true/false' };
}

/**
 * Create the provider seam. Registration validates adapter contracts immediately;
 * routing is explicit-only (NO_SILENT_PROVIDER_FALLBACK). Each adapter owns its own
 * injectable clock (retrieved_at provenance).
 *
 * @param {object} opts
 * @param {Array} opts.adapters - adapters created by the *-provider.mjs modules
 */
export function createProviderSeam({ adapters = [] } = {}) {
  const registry = []; // { adapter, providerId, capability, authClass }
  const registered = new Map(); // `${capability}\u0000${providerId}` -> registry entry

  for (const adapter of adapters) {
    const verdict = validateAdapterContract(adapter);
    if (!verdict.valid) {
      throw new ProviderSeamError(SEAM_ERROR_ADAPTER_CONTRACT_INVALID, `adapter contract invalid: ${verdict.reason}`, {
        details: { providerId: adapter?.providerId ?? null },
      });
    }
    const key = `${adapter.capability}\u0000${adapter.providerId}`;
    if (registered.has(key)) {
      throw new ProviderSeamError(SEAM_ERROR_ADAPTER_CONTRACT_INVALID, 'duplicate provider registration for the same capability', {
        details: { providerId: adapter.providerId, capability: adapter.capability },
      });
    }
    const entry = { adapter, providerId: adapter.providerId, capability: adapter.capability, authClass: adapter.authClass };
    registered.set(key, entry);
    registry.push(entry);
  }

  function listProviders() {
    return registry.map((e) => ({ providerId: e.providerId, capability: e.capability, authClass: e.authClass }));
  }

  /**
   * Explicit routing. Never substitutes, never guesses:
   *   - unknown capability           → UNSUPPORTED_CAPABILITY
   *   - zero candidates              → NO_SILENT_PROVIDER_FALLBACK
   *   - explicit providerId mismatch → NO_SILENT_PROVIDER_FALLBACK (registered adapter untouched)
   *   - >1 candidates w/o explicit id → NO_SILENT_PROVIDER_FALLBACK (D-2 routing stays OPEN)
   */
  function route(capability, { providerId = null } = {}) {
    if (!CAPABILITIES.includes(capability)) {
      throw new ProviderSeamError(SEAM_ERROR_UNSUPPORTED_CAPABILITY, `unsupported capability: ${String(capability)}`, {
        details: { requested: capability, known: [...CAPABILITIES] },
      });
    }
    const candidates = registry.filter((e) => e.capability === capability);
    if (providerId != null) {
      const exact = candidates.find((e) => e.providerId === providerId);
      if (!exact) {
        throw new ProviderSeamError(
          SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK,
          `no registered provider '${providerId}' for capability '${capability}'; NO_SILENT_PROVIDER_FALLBACK`,
          { details: { requested: { capability, providerId }, available: candidates.map((e) => e.providerId) } },
        );
      }
      return exact.adapter;
    }
    if (candidates.length === 0) {
      throw new ProviderSeamError(
        SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK,
        `no registered provider for capability '${capability}'; NO_SILENT_PROVIDER_FALLBACK`,
        { details: { requested: { capability }, available: [] } },
      );
    }
    if (candidates.length > 1) {
      throw new ProviderSeamError(
        SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK,
        `multiple providers registered for capability '${capability}'; routing is OPEN (D-2) — explicit providerId required`,
        { details: { requested: { capability }, available: candidates.map((e) => e.providerId) } },
      );
    }
    return candidates[0].adapter;
  }

  /**
   * Route + retrieve + mechanical result validation in one step.
   * Adapter failure identities (ok=false results) are VALID results and are returned
   * as-is for the controller to judge — a provider failure is never a routing event,
   * so no fallback of any kind can be triggered by it.
   * A result violating the §5.1 contract fails closed: UNKNOWN_PROVIDER_CONTRACT.
   */
  function retrieve(capability, input, { providerId = null } = {}) {
    const adapter = route(capability, { providerId });
    const result = adapter.retrieve(input);
    const verdict = validateProviderResult(result);
    if (!verdict.valid) {
      throw new ProviderSeamError(
        SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT,
        `provider result violates the §5.1 contract: ${verdict.reason}; UNKNOWN_PROVIDER_CONTRACT != PASS`,
        { details: { providerId: adapter.providerId, capability: adapter.capability } },
      );
    }
    return result;
  }

  return { listProviders, route, retrieve };
}
