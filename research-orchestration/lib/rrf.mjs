// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/rrf.mjs
 *
 * P1-T06 — Deterministic RRF (Reciprocal Rank Fusion) candidate fusion
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §5.4; Issue #38).
 *
 * RRF fuses QUERY/PROVIDER RETRIEVAL RANKINGS only. Its channel identity comes
 * from query + ZhihuDataProvider/capability — it does NOT include SemanticRuntime
 * or EmbeddingProvider. RRF is Candidate Fusion ONLY: it never selects a final
 * corpus (selection is a downstream controller responsibility, T08).
 *
 * Determinism contract (Issue #38):
 *   - scores accumulate 1/(RRF_K + rank) per contributing channel;
 *   - accumulation is canonical: each candidate's contributions are summed in
 *     channelKey order (query asc, providerId asc, capability asc) so that any
 *     input channel permutation yields bitwise-identical scores;
 *   - candidate order: rrfScore desc, then questionId ASC (lexicographic string
 *     compare) — documented tie semantics;
 *   - item array order within a ranking is irrelevant (rank comes from
 *     provenance.rank, never from array position);
 *   - facts/sourceUrl of a fused candidate are taken from the canonical-first
 *     contributing channel (channelKey ascending) — permutation-invariant;
 *   - candidate identity is canonical: every fused candidate identity.kind is
 *     'candidate' (T06 candidate contract), independent of any upstream item
 *     kind — permutation-invariant under differing/missing upstream kinds;
 *   - retrieval-route provenance (provenance.route) is preserved on every fused
 *     rank (and every rejected observation); an absent upstream route stays
 *     NULL and is never invented.
 *
 * Fail-closed semantics:
 *   - malformed channel identity, or a FUSIBLE item with a missing/invalid
 *     1-based integer rank or missing/empty questionId → hard error (throws with
 *     a machine-readable .code; nothing half-fused);
 *   - items carrying a per-item provider failure (T05 seam P2-1 shape) are
 *     REJECTED (never fused) and surfaced in `rejected` with their
 *     machine-readable failure identity + contributing channel; an EXPLICIT
 *     per-item failure that is present-but-malformed (not a { code, class }
 *     identity) is a CONTRACT VIOLATION → hard error (never treated as "no
 *     failure", never fused);
 *   - P1-1: the rejected per-item failure is projected through the SAME
 *     canonical projectFailure() as top-level channel failure identities — the
 *     `rejected` entries carry `failure: { code, class }` ONLY. Raw detail /
 *     stderr / arbitrary metadata / path-bearing / credential-shaped diagnostics
 *     are dropped at the boundary so they can never reach the returned/persisted
 *     pool artifact, regardless of how much extra payload the upstream item
 *     failure carried.
 *   - a duplicate of an already-contributed candidate within the same channel is
 *     a CONTRACT VIOLATION → hard error (FUSION_DUPLICATE_IN_CHANNEL): "keep the
 *     first / reject the second" would make scores depend on item array order
 *     (P1-4), so a within-channel duplicate fails closed regardless of order;
 *   - rejected observations are canonicalized by a stable key (channel triple +
 *     questionId + rank/route + failure code/class) before returning, so the
 *     rejected list is permutation-invariant under channel/item order (P1-5);
 *   - P1-1 persisted-artifact boundary (review 5077286260): EVERY provider/
 *     caller-controlled value that can reach pool.candidates / pool.rejected /
 *     returned failures is projected into a safe canonical shape or fails
 *     closed (FUSION_UNSAFE_PROVIDER_DATA): candidate contribution fields
 *     (rankOrigin / route / source_url / facts), rejected observation fields
 *     (identity / rank / route), and failure identities (code/class are
 *     bounded privacy-safe strings). No uncontrolled raw passthrough; safe
 *     data is preserved deterministically; the whole artifact additionally
 *     crosses assertArtifactSafe() in retrieval.mjs as defense in depth.
 *
 * This module is PURE: no IO, no seam, no credentials, no clock. URL trust
 * classification reuses the repository's existing classifier
 * (zhihu-answer-grabber/src/markdown-security.js classifyUrl — the SAME one
 * official-search-provider.mjs / session-capture-provider.mjs use); it is also
 * pure (no IO/network).
 */

// Review 5078267886 (P1): source_url must reuse the repository's existing URL
// trust classifier (classifyUrl) — https-only, no userinfo,
// localhost/loopback/private/link-local/CGNAT/multicast/reserved hosts are
// rejected by the SHARED classifier, never by a weaker parallel policy.
import { classifyUrl } from '../../zhihu-answer-grabber/src/markdown-security.js';

/** Standard RRF constant (k = 60). */
export const RRF_K = 60;

/** Rank source field inside provider-result items. */
export const RRF_RANK_SOURCE = 'provenance.rank';

/** Documented tie-break identity. */
export const RRF_TIE_BREAK = 'score-desc-questionId-asc';

/** Hard fail-closed error codes (malformed input; nothing half-fused). */
export const FUSION_ERROR_CHANNEL_IDENTITY_INVALID = 'FUSION_CHANNEL_IDENTITY_INVALID';
export const FUSION_ERROR_RANK_INVALID = 'FUSION_RANK_INVALID';
export const FUSION_ERROR_ITEM_IDENTITY_INVALID = 'FUSION_ITEM_IDENTITY_INVALID';
export const FUSION_ERROR_FAILURE_IDENTITY_INVALID = 'FUSION_FAILURE_IDENTITY_INVALID';
/** Hard fail-closed error code: within-channel duplicate candidate (P1-4). */
export const FUSION_ERROR_DUPLICATE_IN_CHANNEL = 'FUSION_DUPLICATE_IN_CHANNEL';
/**
 * Hard fail-closed error code: provider/caller-controlled data cannot be safely
 * projected into the persisted pool (P1-1 boundary, review 5077286260).
 */
export const FUSION_ERROR_UNSAFE_PROVIDER_DATA = 'FUSION_UNSAFE_PROVIDER_DATA';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Canonical Zhihu question-ID (Codex 3rd-round P2 on f742cb3): the fusion key
 * must be a canonical decimal integer WITHOUT leading zeros — "abc" is
 * malformed, and "00123" vs "123" would otherwise split one question into two
 * Map keys. /^[1-9]\d*$/ accepts canonical decimal IDs only.
 */
const CANONICAL_QUESTION_ID = /^[1-9]\d*$/;
function isCanonicalQuestionId(value) {
  return typeof value === 'string' && CANONICAL_QUESTION_ID.test(value);
}

// ---------------------------------------------------------------------------
// P1-T06 persisted-artifact boundary (shared with retrieval.mjs)
//
// ONE explicit T06 boundary for every provider/caller-controlled value that can
// reach pool.channels / pool.candidates / pool.rejected / returned machine-
// readable failures (review 5077286260). Each field is either projected into a
// safe canonical shape or fails closed — no uncontrolled raw passthrough:
//   - strings: bounded length + free of credential-shaped content + free of
//     machine-private path content (RULES §11) — isBoundarySafeString;
//   - object keys: dedicated credential-sensitive KEY-NAME deny rule (bare
//     `token` / `cookie` / `z_c0` / ... keys are rejected even without a
//     value-assignment shape, incl. case/separator variants) + magic /
//     prototype-mutating keys (`__proto__` / `prototype` / `constructor`) —
//     isBoundarySafeKey;
//   - nested values: JSON-domain only (null / string / finite number / boolean /
//     array / strict PLAIN object); BigInt / cyclic / function / symbol /
//     undefined / non-plain object classes fail closed — projectSafeJson;
//   - provenance.route / rankOrigin: null stays null, a present value must be a
//     safe string — projectRouteString;
//   - source_url: null or a canonical { url, securityClass } record whose URL is
//     https and free of credential-bearing userinfo / query data and machine-
//     private path content — projectSourceUrlRecord;
//   - the WHOLE pool artifact is mechanically walked before persistence
//     (defense in depth) — assertArtifactSafe.
// Every helper is exception-safe (hostile getters / toString can never escape as
// a raw throw) and deterministic (safe input is preserved exactly).
// ---------------------------------------------------------------------------

/** Bounded length for any provider/caller-controlled string entering the persisted artifact. */
export const BOUNDARY_MAX_STRING_LENGTH = 500;

/** Credential-shaped content (field/assignment shapes incl. the repo-known z_c0 auth cookie). */
export const CREDENTIAL_SHAPE =
  /(?:z_c0\s*=|(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|session[_-]?id)\s*[:=])/i;
/** Machine-private filesystem path content (POSIX system/workspace roots,
 *  Windows drive roots, home-relative ~). Review 5078133293 (P1, two rounds):
 *  enumerating a handful of roots is not enough — the deny set must cover the
 *  FULL standard POSIX top-level directory set (/bin /boot /dev /etc /home
 *  /lib /lib64 /media /mnt /opt /proc /root /run /sbin /srv /sys /tmp /usr
 *  /var, macOS /Applications /Library /System /Volumes /Users /private
 *  /cores /Network /nix /data, container/CI roots /workspace) plus ANY Windows
 *  drive root (C:\... / D:/...), so values like /mnt/alice/private.log,
 *  /opt/acme/internal.json or /srv/private/cache can never pass. */
export const PRIVATE_PATH_SHAPE =
  /(?:\/(?:Users|home|root|workspace|tmp|etc|opt|srv|mnt|media|proc|sys|dev|run|boot|lib|lib64|usr|var|bin|sbin|Applications|Library|System|Volumes|private|cores|Network|nix|data)(?:[\\/]|$)|(?<![A-Za-z])[A-Za-z]:[\\/]|(?:^|[\s"'<>\u2018\u2019\u201c\u201d])~[/\w.-])/;

/**
 * Credential-sensitive KEY-NAME deny rule (P1-2 review 5077286260 + P1 compound/
 * camelCase extension review 5078267886): a bare object key such as `token`,
 * `cookie`, `z_c0`, `api_key` is credential-bearing even without a
 * `name=value` assignment shape. Matches case variants and
 * `-`/`_` separators (normalized exact names) plus standalone-word patterns.
 * Review 5078267886 (P1): the deny set must also cover COMPOUND / camelCase
 * credential keys (accessToken / refreshToken / clientSecret / sessionCookie /
 * accessKeyId / secretAccessKey / ...) — normalization to [a-z0-9] makes the
 * exact-name set cover snake/kebab/camel spellings alike. Safe lookalikes
 * (tokens / tokenCount / questionId / securityClass ...) are NOT in the set.
 */
const SENSITIVE_KEY_NAMES = Object.freeze([
  // bare bases (R4)
  'token', 'secret', 'password', 'passwd', 'cookie', 'authorization',
  'api_key', 'api-key', 'apikey', 'access_key', 'access-key', 'accesskey',
  'session_id', 'session-id', 'sessionid', 'z_c0', 'zc0',
  'credential', 'credentials',
  // compound / camelCase forms (R5) — each spelling normalizes to one exact name
  'access_token', 'access-token', 'accessToken',
  'refresh_token', 'refresh-token', 'refreshToken',
  'client_secret', 'client-secret', 'clientSecret',
  'client_id', 'client-id', 'clientId',
  'session_cookie', 'session-cookie', 'sessionCookie',
  'session_token', 'session-token', 'sessionToken',
  'auth_token', 'auth-token', 'authToken',
  'id_token', 'id-token', 'idToken',
  'api_token', 'api-token', 'apiToken',
  'secret_key', 'secret-key', 'secretKey',
  'private_key', 'private-key', 'privateKey',
  'bearer_token', 'bearer-token', 'bearerToken',
  'oauth_token', 'oauth-token', 'oauthToken',
  'csrf_token', 'csrf-token', 'csrfToken',
  'xsrf_token', 'xsrf-token', 'xsrfToken',
  'access_key_id', 'access-key-id', 'accessKeyId',
  'secret_access_key', 'secret-access-key', 'secretAccessKey',
  'jwt', 'jwt_token', 'jwt-token', 'jwtToken',
]);
const SENSITIVE_KEY_NAMES_NORMALIZED = new Set(
  SENSITIVE_KEY_NAMES.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')),
);
const SENSITIVE_KEY_PATTERN =
  /(?:^|[_\-\s])(?:z[_\-]?c0|token|secret|password|passwd|cookie|authorization|api[_\-]?key|access[_\-]?key|session[_\-]?id)(?:[_\-\s]|$)/i;

function isSensitiveKeyName(key) {
  if (typeof key !== 'string') return true;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SENSITIVE_KEY_NAMES_NORMALIZED.has(normalized)) return true;
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** A key may enter the persisted artifact only when it is neither credential-sensitive nor magic/prototype-mutating. */
export function isBoundarySafeKey(key) {
  return !isSensitiveKeyName(key) && key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
}

/** A provider/caller-controlled string may enter the persisted artifact only when bounded + privacy-safe. */
export function isBoundarySafeString(value) {
  return typeof value === 'string'
    && value.length <= BOUNDARY_MAX_STRING_LENGTH
    && !CREDENTIAL_SHAPE.test(value)
    && !PRIVATE_PATH_SHAPE.test(value);
}

/**
 * Codex 3rd-round P2 on f742cb3 (review 5078133293): a URL is a STRUCTURED
 * value — its path segment (https://example.com/home/article, .../tmp/report)
 * is public resource addressing, NOT a machine-private filesystem path, so
 * PRIVATE_PATH_SHAPE must not reject a legitimate public URL before the shared
 * classifyUrl trust classifier can accept it. The URL-specific boundary is:
 *   - bounded length;
 *   - no credential-shaped content anywhere (query/fragment/userinfo);
 *   - parseable by new URL() — a bare machine-private path (/home/x, C:\x,
 *     ~/.ssh/...) fails to parse and still fails closed;
 *   - https: only;
 *   - no userinfo credentials.
 * Host trust (public vs localhost/loopback/private/link-local/CGNAT/...) is
 * still decided ONLY by the shared classifyUrl classifier (see
 * projectSourceUrlRecord) — this is not a weaker parallel URL policy.
 */
export function isBoundarySafeUrlString(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > BOUNDARY_MAX_STRING_LENGTH) return false;
  if (CREDENTIAL_SHAPE.test(value)) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false; // bare filesystem path / unparseable → fail closed
  }
  return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
}

/**
 * Strict plain-object check (P2-2, review 5077286260): only objects whose
 * prototype is Object.prototype or null are JSON-domain plain objects. Class
 * instances / custom-prototype objects must NOT be silently collapsed to `{}`.
 */
function isPlainObjectStrict(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deterministic deep projection of a provider/caller-controlled value into the
 * JSON-domain persisted-artifact subset: null / string (bounded + privacy-safe) /
 * finite number / boolean / array / strict plain object with safe keys. Fails
 * closed ({ ok:false }) on BigInt / cyclic refs / function / symbol / undefined /
 * non-plain object classes / magic or credential-sensitive keys / unsafe strings /
 * over-depth. Exception-safe: hostile getters cannot escape as a raw throw.
 * Safe input is preserved exactly (deterministic deep copy).
 */
export function projectSafeJson(value, { maxDepth = 8 } = {}) {
  try {
    return projectSafeJsonInner(value, 0, maxDepth, new Set());
  } catch {
    return { ok: false };
  }
}

function projectSafeJsonInner(value, depth, maxDepth, ancestors) {
  if (depth > maxDepth) return { ok: false };
  if (value === null) return { ok: true, value: null };
  const type = typeof value;
  if (type === 'string') return isBoundarySafeString(value) ? { ok: true, value } : { ok: false };
  if (type === 'number') return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (type === 'boolean') return { ok: true, value };
  if (type === 'bigint' || type === 'undefined' || type === 'function' || type === 'symbol') {
    return { ok: false };
  }
  if (ancestors.has(value)) return { ok: false }; // cyclic reference
  ancestors.add(value);
  if (Array.isArray(value)) {
    const out = [];
    for (const element of value) {
      const safe = projectSafeJsonInner(element, depth + 1, maxDepth, ancestors);
      if (!safe.ok) {
        ancestors.delete(value);
        return { ok: false };
      }
      out.push(safe.value);
    }
    ancestors.delete(value);
    return { ok: true, value: out };
  }
  if (!isPlainObjectStrict(value)) {
    ancestors.delete(value);
    return { ok: false };
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isBoundarySafeKey(key)) {
      ancestors.delete(value);
      return { ok: false };
    }
    const safe = projectSafeJsonInner(entry, depth + 1, maxDepth, ancestors);
    if (!safe.ok) {
      ancestors.delete(value);
      return { ok: false };
    }
    out[key] = safe.value;
  }
  ancestors.delete(value);
  return { ok: true, value: out };
}

/**
 * provenance.route / provenance.rankOrigin persistence boundary: null stays
 * null (absent route is never invented); a present value must be a bounded
 * privacy-safe string, otherwise fail closed.
 */
export function projectRouteString(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  return isBoundarySafeString(value) ? { ok: true, value } : { ok: false };
}

/** rejected-observation rank persistence boundary: null or a SAFE integer (JSON-safe).
 *  Review 5078133293 (P2): ranks beyond Number.MAX_SAFE_INTEGER have already been
 *  rounded by JavaScript — only a safe integer can be a verifiable RRF rank.
 *  Codex 3rd-round P2 on f742cb3: retrieval ranks are 1-BASED — a rejected-item
 *  rank must ALSO be a positive safe integer (rank 0 / negative values are
 *  invalid provenance and fail closed, matching the fusible rank gate); absent
 *  rank stays null. */
export function projectRejectedRank(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) return { ok: true, value };
  return { ok: false };
}

/**
 * source_url persistence boundary (§5.1, P1-4 review 5077286260 + P1 URL-trust
 * reuse review 5078267886): null stays null; a present record is canonicalized
 * to { url, securityClass } ONLY when the URL passes the repository's existing
 * URL trust classifier (classifyUrl — https-only, no credential userinfo,
 * localhost/loopback/private/link-local/CGNAT/multicast/reserved hosts
 * rejected) AND the T06 credential/path hygiene checks (credential-shaped
 * query data, machine-private path content, bounded length). The URL is never
 * silently rewritten — an unsafe URL fails closed instead. Non-contract
 * metadata fields are dropped (they are not §5.1-required source identity).
 */
export function projectSourceUrlRecord(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!isPlainObjectStrict(value)) return { ok: false };
  const url = value.url;
  if (typeof url !== 'string' || url.length === 0) return { ok: false };
  // Codex 3rd-round P2 on f742cb3: a URL's path segment is public resource
  // addressing, not a machine-private filesystem path — use the URL-specific
  // boundary (https-only, no userinfo, parseable, no credential-shaped
  // content) instead of the generic string boundary whose PRIVATE_PATH_SHAPE
  // would reject legitimate public URLs like https://example.com/home/article.
  if (!isBoundarySafeUrlString(url)) return { ok: false };
  // Review 5078267886 (P1): URL trust is decided by the repository's SHARED
  // classifier (the same classifyUrl official-search-provider.mjs /
  // session-capture-provider.mjs use). No weaker parallel URL policy: a URL
  // the shared classifier rejects (non-https / userinfo / localhost /
  // loopback / private / link-local / CGNAT / multicast / reserved /
  // link.zhihu.com as final target) fails closed here. Never rewritten.
  const classified = classifyUrl(url);
  if (classified === null) return { ok: false };
  const securityClass = value.securityClass;
  if (typeof securityClass !== 'string' || securityClass.length === 0) return { ok: false };
  if (!isBoundarySafeString(securityClass)) return { ok: false };
  // Review 5078133293 (P2): the PERSISTED securityClass is bound to the shared
  // classifier's verdict — a provider-declared class that differs from
  // classifyUrl's result (e.g. 'trusted' / 'zhimg_cdn' on a plain public https
  // source that the classifier marks 'external_unverified') is a false
  // classification and FAILS CLOSED; the classifier result is never overridden.
  if (classified.securityClass !== securityClass) return { ok: false };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false };
  }
  // Defense in depth (classifyUrl already rejects userinfo; keep the explicit
  // check so this boundary never regresses if the classifier changes).
  if (parsed.username !== '' || parsed.password !== '') return { ok: false };
  for (const [name, entry] of parsed.searchParams.entries()) {
    if (!isBoundarySafeKey(name) || !isBoundarySafeString(entry)) return { ok: false };
  }
  return { ok: true, value: { url, securityClass } };
}

/** Defensive depth cap for the whole-artifact walk (projections already bound provider-controlled depth). */
const MAX_ARTIFACT_DEPTH = 20;

/**
 * Artifact-wide defense-in-depth (P1-1, review 5077286260): mechanically walk
 * the WHOLE pool before persistence — JSON-domain types only, safe keys,
 * bounded privacy-safe strings, no cycles — so no provider/caller-controlled
 * value can reach the artifact even if a future code path forgets a field-level
 * projection. Exception-safe; returns { ok:true } or { ok:false, reason }.
 */
export function assertArtifactSafe(value) {
  try {
    return assertArtifactSafeInner(value, 0, new Set());
  } catch {
    return { ok: false, reason: 'walk_threw' };
  }
}

function assertArtifactSafeInner(value, depth, ancestors) {
  if (depth > MAX_ARTIFACT_DEPTH) return { ok: false, reason: 'depth_exceeded' };
  if (value === null) return { ok: true };
  const type = typeof value;
  if (type === 'string') {
    // Codex 3rd-round P2 on f742cb3: a URL-shaped string is a structured value
    // whose path segment is NOT a machine-private filesystem path — the
    // artifact-wide walk accepts it via the URL-specific boundary as well.
    return (isBoundarySafeString(value) || isBoundarySafeUrlString(value))
      ? { ok: true }
      : { ok: false, reason: 'unsafe_string' };
  }
  if (type === 'number') return Number.isFinite(value) ? { ok: true } : { ok: false, reason: 'non_finite_number' };
  if (type === 'boolean') return { ok: true };
  if (type === 'bigint' || type === 'undefined' || type === 'function' || type === 'symbol') {
    return { ok: false, reason: `unsupported_type_${type}` };
  }
  if (ancestors.has(value)) return { ok: false, reason: 'cyclic' };
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const element of value) {
      const verdict = assertArtifactSafeInner(element, depth + 1, ancestors);
      if (!verdict.ok) {
        ancestors.delete(value);
        return verdict;
      }
    }
    ancestors.delete(value);
    return { ok: true };
  }
  if (!isPlainObjectStrict(value)) {
    ancestors.delete(value);
    return { ok: false, reason: 'non_plain_object' };
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!isBoundarySafeKey(key)) {
      ancestors.delete(value);
      return { ok: false, reason: 'unsafe_key' };
    }
    const verdict = assertArtifactSafeInner(entry, depth + 1, ancestors);
    if (!verdict.ok) {
      ancestors.delete(value);
      return verdict;
    }
  }
  ancestors.delete(value);
  return { ok: true };
}

/**
 * Safely render an arbitrary value inside a fail-closed error message (P2-2).
 * BigInt / cyclic references / hostile serializers must never prevent the
 * machine-readable error .code from being attached: JSON.stringify first, then
 * String(), then a stable placeholder — this NEVER throws.
 */
function safeFormat(value) {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // fall through to String()
  }
  try {
    return String(value);
  } catch {
    return '[unrepresentable value]';
  }
}

/**
 * A valid per-item failure identity is a machine-readable { code, class }
 * record (T05 seam P2-1 shape). Anything else present on `failure` is a
 * contract violation — distinguishable from an ABSENT failure.
 */
function isValidFailureIdentity(failure) {
  return isPlainObject(failure) && isNonEmptyString(failure.code) && isNonEmptyString(failure.class);
}

/**
 * P1-1 CANONICAL safe failure projection (shared with retrieval.mjs): reduce a
 * provider failure to its machine-readable identity fields ONLY ({ code, class }
 * — T05 seam P2-1 shape). Raw detail / provider_error_type / arbitrary payloads
 * — including path-bearing, credential-shaped, or non-JSON-safe (BigInt /
 * cyclic) metadata — are dropped at the T06 boundary so no raw diagnostic can
 * reach failure output, the pool artifact, or the serialization guard. Absent
 * failure → { ok:true, failure:null }; a PRESENT failure that is not a
 * shape-valid { code, class } identity → { ok:false } (contract violation).
 * This is the one projection used for BOTH top-level channel failure identities
 * (retrieval.mjs) AND per-item rejected failure identities (rrf.mjs), so every
 * persisted failure has the exact same safe shape.
 */
export function projectFailure(failure) {
  if (failure === undefined || failure === null) return { ok: true, failure: null };
  if (!isPlainObject(failure) || !isNonEmptyString(failure.code) || !isNonEmptyString(failure.class)) {
    return { ok: false };
  }
  // P1-1: a failure identity may only persist/surface when its code/class strings
  // are themselves bounded + privacy-safe — a path/credential-shaped code must
  // never reach the artifact or the returned failure output.
  if (!isBoundarySafeString(failure.code) || !isBoundarySafeString(failure.class)) return { ok: false };
  return { ok: true, failure: { code: failure.code, class: failure.class } };
}

/** P1-1: provider-controlled data that cannot cross the persisted-artifact boundary fails closed. */
function throwUnsafeProviderData(field, channel) {
  const err = new Error(`provider-controlled ${field} cannot be safely projected into the persisted pool for channel ${safeFormat(channel)}`);
  err.code = FUSION_ERROR_UNSAFE_PROVIDER_DATA;
  throw err;
}

/** Canonical channel key: [query, providerId, capability] — exact §5.4 identity triple. */
function channelKey(channel) {
  return JSON.stringify([channel.query, channel.providerId, channel.capability]);
}

/** Compare two channel keys lexicographically (array element order). */
function compareChannelKey(a, b) {
  const [aq, ap, ac] = JSON.parse(a);
  const [bq, bp, bc] = JSON.parse(b);
  if (aq !== bq) return aq < bq ? -1 : 1;
  if (ap !== bp) return ap < bp ? -1 : 1;
  if (ac !== bc) return ac < bc ? -1 : 1;
  return 0;
}

/**
 * Canonical stable key for one rejected observation (P1-5): channel triple +
 * questionId + rank/route + failure code/class (+ full identity serialization to
 * keep identical-questionId/differing-kind observations distinguishable). Sorting
 * rejected observations by this key makes the rejected list permutation-invariant.
 * Only primitives are compared; identity is serialized with a safe fallback.
 */
function rejectedKey(rejected) {
  const identity = isPlainObject(rejected.identity) ? rejected.identity : null;
  const questionId = identity !== null && isNonEmptyString(identity.questionId) ? identity.questionId : null;
  const rank = typeof rejected.rank === 'number' && Number.isFinite(rejected.rank) ? rejected.rank : null;
  const route = typeof rejected.route === 'string' ? rejected.route : null;
  const code = isNonEmptyString(rejected.failure?.code) ? rejected.failure.code : '';
  const klass = isNonEmptyString(rejected.failure?.class) ? rejected.failure.class : '';
  let identityKey;
  try {
    identityKey = JSON.stringify(identity);
  } catch {
    identityKey = `[unserializable:${typeof identity}]`;
  }
  return JSON.stringify([
    rejected.channel?.query ?? '',
    rejected.channel?.providerId ?? '',
    rejected.channel?.capability ?? '',
    questionId,
    rank,
    route,
    code,
    klass,
    identityKey,
  ]);
}

/**
 * Validate one channel identity (§5.4): non-empty query + providerId + capability.
 * Throw FUSION_CHANNEL_IDENTITY_INVALID otherwise (fail closed).
 */
function assertValidChannel(channel) {
  if (!isPlainObject(channel)
    || !isNonEmptyString(channel.query)
    || !isNonEmptyString(channel.providerId)
    || !isNonEmptyString(channel.capability)) {
    const err = new Error(`malformed fusion channel identity (query + providerId + capability required): ${safeFormat(channel)}`);
    err.code = FUSION_ERROR_CHANNEL_IDENTITY_INVALID;
    throw err;
  }
  return channel;
}

/**
 * Deterministic RRF fusion over an explicit list of retrieval-ranked channels.
 *
 * @param {Array<{ channel: {query, providerId, capability}, items: Array }>} rankings
 *   each ranking mirrors a §5.1 provider result channel: `channel` is the exact
 *   query+provider+capability identity; `items` are provider-result items
 *   (identity.questionId + provenance.rank + optional per-item failure).
 * @returns {{ candidates: Array, rejected: Array }}
 *   candidates: deterministically ordered fused candidates
 *     [{ identity: {kind: 'candidate', questionId}, rrfScore,
 *        ranks: [{channel, rank, rankOrigin, route}], sourceUrl, facts }]
 *   rejected: explicitly rejected observations
 *     [{ channel, identity, rank, route, failure: {code, class} }]
 * @throws {Error} with .code = FUSION_* when input is malformed (fail closed).
 */
export function rrfFusion(rankings) {
  if (!Array.isArray(rankings)) {
    const err = new Error('rankings must be an array of channel rankings');
    err.code = FUSION_ERROR_CHANNEL_IDENTITY_INVALID;
    throw err;
  }

  const rejected = []; // collected in traversal order; canonicalized below (P1-5)
  const byCandidate = new Map(); // questionId -> accumulated record

  for (const ranking of rankings) {
    assertValidChannel(ranking?.channel);
    if (!Array.isArray(ranking.items)) {
      const err = new Error(`ranking items must be an array for channel ${safeFormat(ranking.channel)}`);
      err.code = FUSION_ERROR_CHANNEL_IDENTITY_INVALID;
      throw err;
    }
    const key = channelKey(ranking.channel);

    for (const item of ranking.items) {
      // Distinguish failure ABSENT vs PRESENT-BUT-MALFORMED (P1-3): an explicit
      // `failure` key must carry a machine-readable { code, class } identity.
      // A malformed explicit failure is a contract violation → fail closed
      // (never treated as "no failure", never fused, nothing half-fused).
      const failurePresent = item != null && Object.prototype.hasOwnProperty.call(item, 'failure');
      if (failurePresent) {
        if (!isValidFailureIdentity(item.failure)) {
          const err = new Error(`per-item failure present but not a machine-readable { code, class } identity in channel ${safeFormat(ranking.channel)}`);
          err.code = FUSION_ERROR_FAILURE_IDENTITY_INVALID;
          throw err;
        }
        // Items already carrying a provider failure are never fused (T05 P2-1):
        // they surface in `rejected` with their machine-readable identity.
        // P1-1: project through the canonical projectFailure() so the rejected
        // entry retains `{ code, class }` ONLY — any raw detail / stderr /
        // path-bearing / credential-shaped payload the upstream failure carried
        // is dropped here, matching the top-level channel-record projection.
        // isValidFailureIdentity above guarantees the projection succeeds.
        const projected = projectFailure(item.failure);
        if (!projected.ok) {
          // Unreachable after the shape gate — fail closed rather than emit an
          // undefined projection (nothing half-fused).
          const err = new Error(`per-item failure identity could not be safely projected in channel ${safeFormat(ranking.channel)}`);
          err.code = FUSION_ERROR_FAILURE_IDENTITY_INVALID;
          throw err;
        }
        // P1-1 (review 5077286260): EVERY provider-controlled field of a rejected
        // observation crosses the SAME persisted-artifact boundary — identity /
        // rank / route are projected (or fail closed); the failure is the
        // canonical { code, class } identity. Raw provider metadata never reaches
        // `rejected`, the pool artifact, or the returned result.
        const projectedIdentity = projectSafeJson(item.identity ?? null);
        if (!projectedIdentity.ok) throwUnsafeProviderData('rejected identity', ranking.channel);
        const projectedRank = projectRejectedRank(item.provenance?.rank);
        if (!projectedRank.ok) throwUnsafeProviderData('rejected rank', ranking.channel);
        const projectedRoute = projectRouteString(item.provenance?.route);
        if (!projectedRoute.ok) throwUnsafeProviderData('rejected route', ranking.channel);
        rejected.push({
          channel: ranking.channel,
          identity: projectedIdentity.value,
          rank: projectedRank.value,
          route: projectedRoute.value,
          failure: projected.failure,
        });
        continue;
      }

      // FUSIBLE item: mechanical contract checks (fail closed, nothing half-fused).
      const identity = item?.identity;
      // Codex 3rd-round P2 on f742cb3: the fusion key must be a CANONICAL Zhihu
      // decimal question ID — malformed identities ("abc") and non-canonical
      // spellings ("00123" vs "123", which would split one question into two
      // Map keys) fail closed instead of producing separate unverifiable
      // candidates.
      if (!isPlainObject(identity) || !isCanonicalQuestionId(identity.questionId)) {
        const err = new Error(`fusible item without a valid canonical questionId identity in channel ${safeFormat(ranking.channel)}`);
        err.code = FUSION_ERROR_ITEM_IDENTITY_INVALID;
        throw err;
      }
      const rank = item?.provenance?.rank;
      // Review 5078133293 (P2): beyond integer/1-based shape, the rank must be a
      // SAFE integer — JS has already rounded anything beyond
      // Number.MAX_SAFE_INTEGER (e.g. 9007199254740993 → ...992), so distinct
      // upstream ranks could collapse and produce an unverifiable RRF score.
      if (!Number.isSafeInteger(rank) || rank < 1) {
        const err = new Error(`fusible item carries no valid 1-based ${RRF_RANK_SOURCE} (got ${safeFormat(rank)}) in channel ${safeFormat(ranking.channel)}`);
        err.code = FUSION_ERROR_RANK_INVALID;
        throw err;
      }

      const questionId = identity.questionId;
      let record = byCandidate.get(questionId);
      if (!record) {
        record = {
          questionId,
          // Canonical T06 candidate identity (P1-3): fusion keys by questionId;
          // kind is normalized to the candidate contract so the fused identity is
          // order-independent — an upstream kind variant is never "first wins".
          identity: { kind: 'candidate', questionId },
          contributions: [],
        };
        byCandidate.set(questionId, record);
      }

      // Duplicate within the same channel (P1-4): "keep the first / reject the
      // second" would make scores depend on item array order (rank 1 vs rank 5),
      // which violates the item-order-independence contract. FAIL CLOSED instead —
      // the detection is order-independent (a duplicate anywhere throws).
      if (record.contributions.some((c) => c.key === key)) {
        const err = new Error(`duplicate questionId '${questionId}' within the same channel ${safeFormat(ranking.channel)}; within-channel duplicates fail closed (item-order-independence, P1-4)`);
        err.code = FUSION_ERROR_DUPLICATE_IN_CHANNEL;
        throw err;
      }

      // P1-1 (review 5077286260): provider-controlled contribution fields
      // (rankOrigin / route / source_url / facts) cross the persisted-artifact
      // boundary here — projected into safe canonical shapes or fail closed.
      // `rank` already passed the integer gate and is therefore JSON-safe.
      const projectedRankOrigin = projectRouteString(item.provenance?.rankOrigin);
      if (!projectedRankOrigin.ok) throwUnsafeProviderData('rankOrigin', ranking.channel);
      const projectedRoute = projectRouteString(item.provenance?.route);
      if (!projectedRoute.ok) throwUnsafeProviderData('route', ranking.channel);
      const projectedSourceUrl = projectSourceUrlRecord(item.source_url);
      if (!projectedSourceUrl.ok) throwUnsafeProviderData('source_url', ranking.channel);
      const projectedFacts = projectSafeJson(item.facts ?? {});
      if (!projectedFacts.ok) throwUnsafeProviderData('facts', ranking.channel);

      record.contributions.push({
        key,
        channel: ranking.channel,
        rank,
        rankOrigin: projectedRankOrigin.value,
        route: projectedRoute.value,
        source_url: projectedSourceUrl.value,
        facts: projectedFacts.value,
      });
    }
  }

  const candidates = [];
  for (const record of byCandidate.values()) {
    // Canonical accumulation order (permutation-invariant → bitwise-deterministic).
    record.contributions.sort((a, b) => compareChannelKey(a.key, b.key));
    let rrfScore = 0;
    for (const c of record.contributions) rrfScore += 1 / (RRF_K + c.rank);

    const first = record.contributions[0]; // canonical-first contributing channel
    candidates.push({
      identity: record.identity,
      rrfScore,
      ranks: record.contributions.map((c) => ({
        channel: c.channel,
        rank: c.rank,
        rankOrigin: c.rankOrigin,
        route: c.route,
      })),
      source_url: first.source_url,
      facts: first.facts,
    });
  }

  // Deterministic candidate order: score desc, then questionId ASC (documented tie).
  candidates.sort((a, b) => {
    if (a.rrfScore !== b.rrfScore) return b.rrfScore - a.rrfScore;
    return a.identity.questionId < b.identity.questionId ? -1 : 1;
  });

  // P1-5: canonicalize rejected observations by stable key so the rejected list
  // is permutation-invariant (channel order / item order never change it).
  rejected.sort((a, b) => {
    const ka = rejectedKey(a);
    const kb = rejectedKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });

  return { candidates, rejected };
}