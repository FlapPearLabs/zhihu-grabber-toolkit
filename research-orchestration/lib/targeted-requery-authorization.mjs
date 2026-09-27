// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-authorization.mjs
 *
 * P2A-T05 (#117) — Bounded authorization policy + targeted-action identity.
 *
 * Authority (FROZEN; this module must not reinterpret, generalize or "improve" it):
 *   - docs/specs/p2-ari-f02-targeted-requery.md   §5 D2/D3/D6, §6, §7, §10, §11, §13  (APPROVED)
 *   - docs/architecture/key-decisions.md          D12-2, D12-3, D12-6, D12-8
 *   - docs/planning/..._SEAM_CONTRACT_V1.md       E.5(4)(5)(6)(7)(8) / E.6 / E.7 / E.8 / F.1 / F.2 / F.4
 *   - docs/planning/..._SEAM_MAP_V1.md            S3
 *   - Ticket Decomposition §P2A-T05; Issue #117 ACCEPTANCE_CRITERIA 1–7
 *
 * Ownership boundary (Ticket Graph V1 §4 — ONE_ACTIVE_WRITER_PER_BRANCH):
 *   T05 OWNS  : authorization policy, normalizedQuery, dedupeKey, per-gap attempt
 *               bound, global-budget preflight, providerScope validation,
 *               targetedActionId, authorization provenance, deterministic gap
 *               ordering, the T05 rejectionCode set.
 *   T05 DOES NOT OWN (and this module deliberately contains NONE of):
 *               string safety / proposal admission (T04 — CONSUMED via
 *               `evaluateTargetedQueryProposal`, never re-implemented),
 *               lifecycle / durable commit / replay (T06), global STOP wiring or
 *               `evaluateRetrievalRound` accounting (T07), orchestration (T09),
 *               resolution (T08), any retrieval IO, any `executing` persisted
 *               state, any ResearchCoverageState / ledger write, any
 *               trustedPlanStrings extension, and any write into the coverage
 *               state's plan-bound query-variant surface (D12-3 / D12-4).
 *
 * PURE BY CONSTRUCTION. The module imports no IO primitive, opens no file, performs
 * no retrieval, reads no clock and no randomness, and mutates no input. Every
 * `REJECTED` verdict is a controlled, auditable refusal with ZERO IO and ZERO writes
 * (E.7): the parent gap is left untouched, nothing is counted as resolved or
 * saturated, and nothing is silently downgraded to re-running the parent plan.
 *
 * ---------------------------------------------------------------------------
 * FROZEN SEMANTICS AND THE INTERPRETATION DECISIONS TAKEN HERE
 * (recorded explicitly so reviewers can audit the decisions instead of
 * reconstructing intent from the code)
 * ---------------------------------------------------------------------------
 *
 * 1. `normalizedQuery` IS EXACTLY E.6's PIPELINE AND NOTHING MORE:
 *       trim → Unicode NFC → collapse consecutive whitespace → casefold.
 *    No stemming, no tokenisation, no lexical ranking, no semantic normalisation,
 *    no model rewriting. "Casefold" is realised as `String.prototype.toLowerCase()`
 *    (after NFC), which is the same realisation T01 froze in
 *    `normalizeSubjectString` for the sibling E.3/E.6 material; introducing a
 *    second, differently-shaped case-folding would let the two halves of the same
 *    dedupe contract drift apart. The realised behaviour is pinned by test —
 *    including its known full-casefold limitation (`'ß'` folds to `'ß'`, not
 *    `'ss'`), which is a property of the frozen family realisation, not a licence
 *    to add a custom folding table here.
 *
 * 2. `normalizeQueryString` DOES NOT RE-APPLY A SAFETY LENS.
 *    E.6 defines a normalisation pipeline, not an admission gate. Adding a lens
 *    here would be an unauthorised re-implementation of T04's dual-lens
 *    intersection (E.5(2), F.3) and would silently change which strings reach the
 *    dedupe key. The string reaching this function has already been admitted by the
 *    T04 gate; this function only canonicalises it. It DOES fail closed (returns
 *    `null`) when the result is empty or the input is not a string, because an
 *    empty normalised query cannot be a stable dedupe input.
 *
 * 3. `computeDedupeKey` CANONICALISES ITS OWN INPUTS, BECAUSE E.6/F.1 REQUIRE THE
 *    KEY TO BE EQUIVALENCE- AND ORDER-INDEPENDENT.
 *    F.1 states providerScope is "顺序无关，排序后参与哈希" and E.6's whole purpose is
 *    that *equivalent* queries share one key. A key that changes when the caller
 *    happens to pass a differently-cased string or a differently-ordered channel
 *    list would silently defeat C1. The canonicalisation applied is exactly the
 *    frozen one (E.6 normalisation; providerScope sorted by `providerId`), so the
 *    accepted set is unchanged — nothing is widened. Inputs that cannot yield a
 *    canonical key (non-hex core, empty query, empty/duplicate/non-search scope)
 *    fail closed with a typed error.
 *
 * 4. `providerScope` ENTRIES ARE THE F.2 CHANNEL DESCRIPTORS `{ providerId, capability }`.
 *    F.2 freezes `providerScope ⊆ plannedRoutes = [{ providerId, capability: 'search' }]`.
 *    `capability` is therefore always `CAPABILITY_SEARCH` in a canonical scope;
 *    any other capability is not a canonical scope member and fails closed here.
 *    The *rejection* of a requested non-search capability (a stable rejectionCode,
 *    not a throw) is adjudicated by `resolveProviderScope` below, which is the
 *    E.5(8) authorization surface.
 *
 * 5. JSON CANONICALISATION IS MODULE-PRIVATE (same choice T01 made for the sibling
 *    `targeted-requery-ledger.mjs`, and the same "no shared module is created"
 *    reasoning recorded there). The frozen formulas name `canonicalJson`; the
 *    targeted-requery family keeps one byte-identical private implementation per
 *    module so neither ticket can silently change the other's identity domain.
 *    The `cross-group-aggregation.mjs` export is a Seam-D concern and is deliberately
 *    not reached into from here.
 *
 * 6. NO CLOCK, NO RANDOMNESS, NO PATH IN ANY IDENTITY (F.1: "不使用时间戳、随机数或
 *    未绑定产物"). The source guard in the focused suite asserts this mechanically.
 *
 * 7. THE DECISION EMITS BOTH FROZEN NAMES FOR THE E.6 VALUE.
 *    Seam Map S3's OUTPUT_CONTRACT names the field `query` and `queryTrustClass`;
 *    E.6 / F.1 name the same value `normalizedQuery`. Both are frozen authority, so
 *    the decision carries both (`query` and `normalizedQuery` always equal), plus
 *    S3's `planHash` / `runId` / `occurrenceId`, so the F.4 provenance chain
 *    `targetedActionId → gapId → (ledger: gapType + subjectKey) → planHash` is
 *    machine-checkable without asking a consumer to rename anything. The one link
 *    this module cannot close on its own is `gapType` / `subjectKey`, which are
 *    T01 ledger fields and are deliberately NOT duplicated here.
 *
 * 8. E.7's "PROPOSAL 原样副本" IS A PERSISTENCE ACT, NOT A POLICY OUTPUT.
 *    E.7 requires a REJECTED proposal to be *recorded* with its rejectionCode and a
 *    verbatim copy of the proposal (audit-only, deliberately not trust-elevated by
 *    the safety gate). Recording is a write, and writes belong to the ledger /
 *    lifecycle writer (T01 ledger primitives, T06 append-only audit). This module
 *    performs NO write and returns NO raw copy of untrusted input; it returns the
 *    stable `rejectionCode` plus a `rejectionDetail` that is validated against
 *    T04's closed code enum. Emitting raw proposal bytes on a policy decision would
 *    spread untrusted content across every consumer, which is precisely the
 *    boundary this ticket exists to keep narrow.
 *
 * 9. THE DECISION SHAPE IS TOTAL. Every key is always present and `null` when it
 *    does not apply — the same convention the sibling T04 module uses — so a
 *    consumer never has to distinguish "absent" from "not applicable".
 *
 * 10. T04's `DROPPED` AND `REJECTED` BOTH SURFACE AS `REJECTED` HERE, AND THE
 *     DISTINCTION IS NOT LOST. Seam Map S3 freezes this seam's LEGAL_STATES to
 *     exactly { AUTHORIZED, REJECTED } and lists "gapId 不存在" among its
 *     ILLEGAL_STATES, so a proposal with no resolvable parent gap cannot be
 *     authorized and has no third verdict to take. T04's own distinction is
 *     preserved on the decision as `rejectionDetail` (T04's closed code —
 *     e.g. `UNKNOWN_GAP_ID` for a dropped proposal vs `FREE_FORM_QUERY_NOT_
 *     AUTHORIZED_IN_MVP` for a refused one), so the audit trail still separates
 *     "could not be attributed to a gap" from "attributed and refused".
 */

import crypto from 'node:crypto';

import { CAPABILITY_SEARCH } from './provider-seam.mjs';
import { isValidPlanHashFormat } from './plan-contract.mjs';
import { compareGapsByGapId, gapIdentityCoreOf } from './targeted-requery-ledger.mjs';
import {
  PROPOSAL_STATUS_ADMITTED,
  REJECTION_CODES as T04_REJECTION_CODES,
  evaluateTargetedQueryProposal,
} from './targeted-requery-trust.mjs';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Typed error code for every fail-closed refusal that is an input-contract error. */
export const AUTHORIZATION_ERROR_INVALID = 'p2a_targeted_requery_authorization_invalid';

/** E.5 outcome vocabulary (E.7): an authorization decision is exactly one of these. */
export const AUTHORIZATION_STATUS_AUTHORIZED = 'AUTHORIZED';
export const AUTHORIZATION_STATUS_REJECTED = 'REJECTED';

/** F.1 hash domain prefix for `targetedActionId`. */
export const TARGETED_ACTION_ID_DOMAIN = 'p2-ari-targeted-action/v1';

/** E.6: the one canonical membership tuple inside a `providerScope` entry. */
export const PROVIDER_SCOPE_ENTRY_KEYS = Object.freeze(['capability', 'providerId']);

/**
 * D6 / Spec §5 D6: the minimal per-gap bound introduced by this ticket
 * (`maxAttemptsPerGap` default 2). It bounds the **action** count for one
 * `gapIdentityCore`; channel-level attempts are accounted separately (channel-level
 * attempts are counted in full against `maxQueryBudget`, never against this bound).
 */
export const DEFAULT_MAX_ATTEMPTS_PER_GAP = 2;

/**
 * Stable machine-readable rejection codes owned by this ticket.
 *
 * The set enumerates exactly the codes a DECISION can carry. A malformed
 * authorization *input* (bad `plannedRoutes`, missing `maxQueryBudget`, …) is a
 * caller wiring error and fails closed with a typed throw instead — so it has no
 * verdict code, and no unreachable member is listed here.
 */
export const REJECTION_PROPOSAL_NOT_ADMITTED = 'PROPOSAL_NOT_ADMITTED';
export const REJECTION_GAP_IDENTITY_CORE_UNRESOLVED = 'GAP_IDENTITY_CORE_UNRESOLVED';
export const REJECTION_NORMALIZED_QUERY_EMPTY = 'NORMALIZED_QUERY_EMPTY';
export const REJECTION_ATTEMPT_BOUND_EXCEEDED = 'PER_GAP_ATTEMPT_BOUND_EXCEEDED';
export const REJECTION_DEDUPE_ALREADY_AUTHORIZED = 'EQUIVALENT_QUERY_ALREADY_AUTHORIZED';
export const REJECTION_PROVIDER_NOT_PLANNED = 'PROVIDER_NOT_IN_PLANNED_ROUTES';
export const REJECTION_CAPABILITY_NOT_SEARCH = 'CAPABILITY_NOT_SEARCH';
export const REJECTION_PROVIDER_SCOPE_INVALID = 'PROVIDER_SCOPE_INVALID';
export const REJECTION_BUDGET_EXCEEDED = 'GLOBAL_QUERY_BUDGET_EXCEEDED';

export const REJECTION_CODES = Object.freeze([
  REJECTION_PROPOSAL_NOT_ADMITTED,
  REJECTION_GAP_IDENTITY_CORE_UNRESOLVED,
  REJECTION_NORMALIZED_QUERY_EMPTY,
  REJECTION_ATTEMPT_BOUND_EXCEEDED,
  REJECTION_DEDUPE_ALREADY_AUTHORIZED,
  REJECTION_PROVIDER_NOT_PLANNED,
  REJECTION_CAPABILITY_NOT_SEARCH,
  REJECTION_PROVIDER_SCOPE_INVALID,
  REJECTION_BUDGET_EXCEEDED,
]);

const GAP_IDENTITY_CORE_SHAPE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// small shared helpers (module-private; no shared module is created)
// ---------------------------------------------------------------------------

function authorizationError(message) {
  const err = new Error(message);
  err.code = AUTHORIZATION_ERROR_INVALID;
  return err;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * Stable JSON with recursively sorted object keys (arrays keep their order).
 * Byte-identical to the sibling `targeted-requery-ledger.mjs` implementation —
 * see design decision 5 in the header.
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  if (actual.length !== expectedKeys.length) return false;
  return actual.every((key, index) => key === expectedKeys[index]);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

// ---------------------------------------------------------------------------
// E.6 — normalizedQuery
// ---------------------------------------------------------------------------

/**
 * E.6 normalisation pipeline: trim → Unicode NFC → collapse consecutive
 * whitespace to a single U+0020 → casefold.
 *
 * Returns the canonical string, or `null` when the input is not a string or the
 * canonical result is empty (fail closed — see design decision 2).
 */
export function normalizeQueryString(value) {
  if (typeof value !== 'string') return null;
  const collapsed = value.trim().normalize('NFC').replace(/\s+/gu, ' ').toLowerCase();
  return collapsed.length === 0 ? null : collapsed;
}

// ---------------------------------------------------------------------------
// F.2 — canonical providerScope
// ---------------------------------------------------------------------------

/**
 * Canonicalise a `providerScope` into the F.2 form: a duplicate-free list of
 * `{ providerId, capability: 'search' }` descriptors sorted ascending by
 * `providerId` (order-independence is part of the hashed value, F.1).
 *
 * This is a *canonicalisation* helper, not the E.5(8) authorization decision: it
 * throws on a scope that cannot be canonical (empty, malformed entry, duplicate
 * providerId, non-search capability). The adjudicated, `rejectionCode`-bearing
 * subset check against `plannedRoutes` lives in `resolveProviderScope`.
 */
export function canonicalizeProviderScope(providerScope) {
  if (!Array.isArray(providerScope) || providerScope.length === 0) {
    throw authorizationError('providerScope must be a non-empty array of channel descriptors');
  }
  const seen = new Set();
  const entries = providerScope.map((entry) => {
    if (!hasExactKeys(entry, PROVIDER_SCOPE_ENTRY_KEYS)) {
      throw authorizationError('providerScope entry must be exactly { providerId, capability }');
    }
    if (!isNonEmptyString(entry.providerId)) {
      throw authorizationError('providerScope entry providerId must be a non-empty string');
    }
    if (entry.capability !== CAPABILITY_SEARCH) {
      throw authorizationError(`providerScope capability must be ${CAPABILITY_SEARCH}`);
    }
    if (seen.has(entry.providerId)) {
      throw authorizationError(`duplicate providerId in providerScope: ${entry.providerId}`);
    }
    seen.add(entry.providerId);
    return { providerId: entry.providerId, capability: CAPABILITY_SEARCH };
  });
  return entries.sort((a, b) => (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0));
}

// ---------------------------------------------------------------------------
// E.6 — dedupeKey
// ---------------------------------------------------------------------------

function requireGapIdentityCore(gapIdentityCore) {
  if (typeof gapIdentityCore !== 'string' || !GAP_IDENTITY_CORE_SHAPE.test(gapIdentityCore)) {
    throw authorizationError('gapIdentityCore must be 64 lowercase hex characters');
  }
  return gapIdentityCore;
}

/**
 * E.6: `dedupeKey = sha256(canonicalJson({ gapIdentityCore, normalizedQuery,
 * providerScope }))`.
 *
 * The key is keyed on `gapIdentityCore` — NOT on `gapId` and NOT on
 * `diagnosisRound` (D12-8): the same gap must keep one identity across diagnosis
 * rounds, otherwise C1 would only be caught inside a single round. No timestamp,
 * random value, filesystem path or unfrozen model output takes part.
 */
export function computeDedupeKey({ gapIdentityCore, normalizedQuery, providerScope } = {}) {
  const core = requireGapIdentityCore(gapIdentityCore);
  const query = normalizeQueryString(normalizedQuery);
  if (query === null) {
    throw authorizationError('normalizedQuery must normalise to a non-empty string');
  }
  const scope = canonicalizeProviderScope(providerScope);
  return sha256(canonicalJson({
    gapIdentityCore: core,
    normalizedQuery: query,
    providerScope: scope,
  }));
}

/** Validate a plan contract hash (F.1 `planHash` input). Module-private. */
function requirePlanHash(planHash) {
  if (typeof planHash !== 'string' || !isValidPlanHashFormat(planHash)) {
    throw authorizationError('planHash must be a 64-hex plan contract hash');
  }
  return planHash;
}

// ---------------------------------------------------------------------------
// F.1 — targetedActionId (the replay key)
// ---------------------------------------------------------------------------

/** F.1: the EXACT identity field set. No additional convenience field may participate. */
export const TARGETED_ACTION_ID_FIELDS = Object.freeze([
  'attempt',
  'gapId',
  'normalizedQuery',
  'occurrenceId',
  'planHash',
  'providerScope',
  'runId',
]);

/** E.2 gapId shape (`gapIdentityCore + ':' + diagnosisRound`). */
const GAP_ID_SHAPE = /^[0-9a-f]{64}:\d+$/;

/**
 * F.1: `targetedActionId = sha256('p2-ari-targeted-action/v1:' + canonicalJson({
 * runId, occurrenceId, planHash, gapId, attempt, normalizedQuery, providerScope }))`.
 *
 * The field set is enforced EXACTLY: a caller adding a convenience field (a
 * materiality score, a diagnosis round, a timestamp) is refused rather than
 * silently ignored, so no extra input can ever participate in the identity. Only
 * contract-attested fields are read; there is no clock, no randomness and no
 * unbound artifact (F.1).
 *
 * `normalizedQuery` and `providerScope` are canonicalised with the frozen E.6 /
 * F.1 canonicalisation, so the identity is stable under equivalent inputs —
 * which is what makes a resume-time recomputation (C12) yield the same id and
 * therefore refuse to re-authorize a replayed action.
 */
export function computeTargetedActionId(input = {}) {
  if (!hasExactKeys(input, TARGETED_ACTION_ID_FIELDS)) {
    throw authorizationError(
      `targetedActionId input must be exactly { ${TARGETED_ACTION_ID_FIELDS.join(', ')} }`,
    );
  }
  const { runId, occurrenceId, planHash, gapId, attempt } = input;
  if (!isNonEmptyString(runId)) throw authorizationError('runId must be a non-empty string');
  if (!isNonEmptyString(occurrenceId)) throw authorizationError('occurrenceId must be a non-empty string');
  requirePlanHash(planHash);
  if (typeof gapId !== 'string' || !GAP_ID_SHAPE.test(gapId)) {
    throw authorizationError('gapId must be gapIdentityCore + ":" + diagnosisRound');
  }
  if (!isPositiveInteger(attempt)) throw authorizationError('attempt must be a positive integer');

  const query = normalizeQueryString(input.normalizedQuery);
  if (query === null) {
    throw authorizationError('normalizedQuery must normalise to a non-empty string');
  }
  const scope = canonicalizeProviderScope(input.providerScope);

  return sha256(`${TARGETED_ACTION_ID_DOMAIN}:${canonicalJson({
    runId,
    occurrenceId,
    planHash,
    gapId,
    attempt,
    normalizedQuery: query,
    providerScope: scope,
  })}`);
}

// ---------------------------------------------------------------------------
// F.2 — E.5(8): providerScope ⊆ plannedRoutes
// ---------------------------------------------------------------------------

/**
 * Validate the F.2 channel universe. A malformed `plannedRoutes` is a CALLER
 * wiring error (the controller resolves it from the provider registry), so it
 * fails closed with a typed throw rather than an authorization verdict.
 */
function plannedRouteUniverse(plannedRoutes) {
  if (!Array.isArray(plannedRoutes)) {
    throw authorizationError('plannedRoutes must be an array of { providerId, capability } descriptors');
  }
  const universe = new Map();
  for (const route of plannedRoutes) {
    if (!hasExactKeys(route, PROVIDER_SCOPE_ENTRY_KEYS)) {
      throw authorizationError('plannedRoutes entry must be exactly { providerId, capability }');
    }
    if (!isNonEmptyString(route.providerId) || !isNonEmptyString(route.capability)) {
      throw authorizationError('plannedRoutes entry providerId/capability must be non-empty strings');
    }
    if (universe.has(route.providerId)) {
      throw authorizationError(`duplicate providerId in plannedRoutes: ${route.providerId}`);
    }
    universe.set(route.providerId, route.capability);
  }
  return universe;
}

/**
 * E.5(8) / F.2: resolve the action's `providerScope`.
 *
 *   · absent request  → the DEFAULT scope = every authorized planned SEARCH channel
 *   · present request → exactly the requested subset, each id resolved against
 *     `plannedRoutes`
 *
 * A new provider (not in `plannedRoutes`) and a non-`search` capability are both
 * REJECTED — the capability vocabulary is closed at `CAPABILITY_SEARCH` for this
 * action class, and there is NO silent fallback (F.2). An empty or duplicated
 * requested scope is refused rather than quietly repaired.
 *
 * Returns `{ ok: true, providerScope }` with a canonical (sorted, duplicate-free)
 * descriptor list, or `{ ok: false, rejectionCode }`.
 */
export function resolveProviderScope({ plannedRoutes, requestedProviderScope = null } = {}) {
  const universe = plannedRouteUniverse(plannedRoutes);

  if (requestedProviderScope === null || requestedProviderScope === undefined) {
    const all = [...universe.entries()]
      .filter(([, capability]) => capability === CAPABILITY_SEARCH)
      .map(([providerId]) => ({ providerId, capability: CAPABILITY_SEARCH }));
    if (all.length === 0) return { ok: false, rejectionCode: REJECTION_PROVIDER_SCOPE_INVALID };
    return { ok: true, providerScope: canonicalizeProviderScope(all) };
  }

  if (!Array.isArray(requestedProviderScope) || requestedProviderScope.length === 0) {
    return { ok: false, rejectionCode: REJECTION_PROVIDER_SCOPE_INVALID };
  }

  const seen = new Set();
  const entries = [];
  for (const providerId of requestedProviderScope) {
    if (!isNonEmptyString(providerId)) {
      return { ok: false, rejectionCode: REJECTION_PROVIDER_SCOPE_INVALID };
    }
    if (!universe.has(providerId)) {
      return { ok: false, rejectionCode: REJECTION_PROVIDER_NOT_PLANNED };
    }
    if (universe.get(providerId) !== CAPABILITY_SEARCH) {
      return { ok: false, rejectionCode: REJECTION_CAPABILITY_NOT_SEARCH };
    }
    if (seen.has(providerId)) {
      return { ok: false, rejectionCode: REJECTION_PROVIDER_SCOPE_INVALID };
    }
    seen.add(providerId);
    entries.push({ providerId, capability: CAPABILITY_SEARCH });
  }
  return { ok: true, providerScope: canonicalizeProviderScope(entries) };
}

// ---------------------------------------------------------------------------
// E.5(4)(5)(6)(7) / E.7 — the bounded authorization decision
// ---------------------------------------------------------------------------

const DECISION_KEYS = Object.freeze([
  'status',
  'targetedActionId',
  'runId',
  'occurrenceId',
  'planHash',
  'gapId',
  'gapIdentityCore',
  'attempt',
  'query',
  'normalizedQuery',
  'queryTrustClass',
  'providerScope',
  'dedupeKey',
  'actionChannelAttemptCount',
  'rejectionCode',
  'rejectionDetail',
]);

/**
 * Fixed decision shape (same convention as the sibling T04 module): every key is
 * always present, `null` where it does not apply.
 *
 * `query` is the S3 output-contract name for the E.6 value and `normalizedQuery`
 * is the E.6 / F.1 name for the SAME value. Both frozen names are emitted so
 * neither seam consumer has to rename anything (see design decision 7).
 */
function decision(overrides) {
  const base = {
    status: null,
    targetedActionId: null,
    runId: null,
    occurrenceId: null,
    planHash: null,
    gapId: null,
    gapIdentityCore: null,
    attempt: null,
    query: null,
    normalizedQuery: null,
    queryTrustClass: null,
    providerScope: null,
    dedupeKey: null,
    actionChannelAttemptCount: null,
    rejectionCode: null,
    rejectionDetail: null,
  };
  for (const key of Object.keys(overrides)) {
    if (!DECISION_KEYS.includes(key)) continue;
    base[key] = overrides[key];
  }
  return base;
}

/**
 * A T04 rejection code is passed through as `rejectionDetail` ONLY after being
 * checked against T04's own closed enum. An unrecognised value is dropped to
 * `null` rather than propagated as an unvalidated free string through this
 * module's output surface.
 */
function safeRejectionDetail(code) {
  return typeof code === 'string' && T04_REJECTION_CODES.includes(code) ? code : null;
}

/** Accept a plain-object attempt index keyed by `gapIdentityCore`. */
function normalizeAttemptIndex(index) {
  if (index === null || index === undefined) return {};
  if (!isPlainObject(index)) throw authorizationError('attemptsByGapIdentityCore must be a plain object');
  const copy = {};
  for (const [core, count] of Object.entries(index)) {
    if (!GAP_IDENTITY_CORE_SHAPE.test(core)) {
      throw authorizationError(`attemptsByGapIdentityCore key is not a gapIdentityCore: ${core}`);
    }
    if (!Number.isInteger(count) || count < 0) {
      throw authorizationError(`attemptsByGapIdentityCore[${core}] must be a non-negative integer`);
    }
    copy[core] = count;
  }
  return copy;
}

function normalizeDedupeKeys(keys) {
  if (keys === null || keys === undefined) return new Set();
  if (keys instanceof Set) return new Set(keys);
  if (!Array.isArray(keys)) throw authorizationError('authorizedDedupeKeys must be an array or a Set');
  return new Set(keys);
}

/**
 * E.5(4)(5)(6)(7)(8) / E.7: decide whether ONE `TargetedQueryProposal` becomes an
 * authorized `TargetedQueryAction`.
 *
 * Evaluation order (recorded deliberately — the ONLY departure from E.5's
 * checklist numbering is forced by data dependency):
 *
 *   1. T04 trust gate (`evaluateTargetedQueryProposal`) — E.5(1)(2)(3)(9)
 *   2. E.5(4)  explicit parent-gap provenance (`gapIdentityCore` resolvable from `gapId`)
 *   3. E.6     `normalizedQuery` must exist
 *   4. E.5(8)  `providerScope` resolution — REQUIRED BEFORE 5 and 6, because both the
 *              dedupe key (E.6) and the budget cost (E.5(7)) are defined over the
 *              *resolved* channel list
 *   5. E.5(5)  per-gap attempt bound, counted on `gapIdentityCore` (D12-8)
 *   6. E.5(6)  equivalent-query dedupe within the occurrence
 *   7. E.5(7)  global budget preflight, costed as the CHANNEL count (never 1)
 *
 * Any failure yields `REJECTED` with a stable `rejectionCode` and ZERO side
 * effects (E.7): no IO, no clock, no state mutation, no parent-gap change, no
 * resolution / saturation credit, no downgrade to re-running the parent plan.
 *
 * `maxQueryBudget` is an explicit input: resolving the global budget configuration
 * is the round controller's concern (T07), not this ticket's. `maxAttemptsPerGap`
 * IS owned here (D6).
 */
export function authorizeTargetedAction(rawProposal, contextInput = {}) {
  if (!isPlainObject(contextInput)) throw authorizationError('authorization context must be a plain object');
  const {
    plan = null,
    resolveGap = null,
    plannedRoutes,
    runId,
    occurrenceId,
    planHash,
    maxAttemptsPerGap = DEFAULT_MAX_ATTEMPTS_PER_GAP,
    maxQueryBudget,
    attemptsBudgetCount = 0,
  } = contextInput;

  // ---- caller wiring is validated fail-closed (not an authorization verdict) ---
  if (!isPositiveInteger(maxAttemptsPerGap)) throw authorizationError('maxAttemptsPerGap must be a positive integer');
  if (!isPositiveInteger(maxQueryBudget)) throw authorizationError('maxQueryBudget must be a positive integer');
  if (!Number.isInteger(attemptsBudgetCount) || attemptsBudgetCount < 0) {
    throw authorizationError('attemptsBudgetCount must be a non-negative integer');
  }
  if (!isNonEmptyString(runId)) throw authorizationError('runId must be a non-empty string');
  if (!isNonEmptyString(occurrenceId)) throw authorizationError('occurrenceId must be a non-empty string');
  requirePlanHash(planHash);

  const attemptCounts = normalizeAttemptIndex(contextInput.attemptsByGapIdentityCore);
  const authorizedDedupeKeys = normalizeDedupeKeys(contextInput.authorizedDedupeKeys);

  /** Context facts carried on EVERY decision (audit traceability, never an authorization state). */
  const trace = { runId, occurrenceId, planHash };

  // ---- 1. T04 trust gate (consumed, never re-implemented) ---------------------
  const verdict = evaluateTargetedQueryProposal(rawProposal, { plan, resolveGap });
  if (verdict.status !== PROPOSAL_STATUS_ADMITTED) {
    return decision({
      ...trace,
      status: AUTHORIZATION_STATUS_REJECTED,
      gapId: typeof verdict.gapId === 'string' ? verdict.gapId : null,
      gapIdentityCore: typeof verdict.gapIdentityCore === 'string' ? verdict.gapIdentityCore : null,
      queryTrustClass: typeof verdict.trustClass === 'string' ? verdict.trustClass : null,
      rejectionCode: REJECTION_PROPOSAL_NOT_ADMITTED,
      rejectionDetail: safeRejectionDetail(verdict.rejectionCode),
    });
  }

  const { gapId } = verdict;
  const bound = {
    ...trace,
    gapId,
    queryTrustClass: typeof verdict.trustClass === 'string' ? verdict.trustClass : null,
  };

  // ---- 2. E.5(4): explicit parent-gap provenance ------------------------------
  const gapIdentityCore = gapIdentityCoreOf(gapId);
  if (gapIdentityCore === null) {
    return decision({
      ...bound,
      status: AUTHORIZATION_STATUS_REJECTED,
      rejectionCode: REJECTION_GAP_IDENTITY_CORE_UNRESOLVED,
    });
  }

  // ---- 3. E.6: a usable normalizedQuery --------------------------------------
  const normalizedQuery = normalizeQueryString(verdict.query);
  if (normalizedQuery === null) {
    return decision({
      ...bound,
      gapIdentityCore,
      status: AUTHORIZATION_STATUS_REJECTED,
      rejectionCode: REJECTION_NORMALIZED_QUERY_EMPTY,
    });
  }
  // S3's output-contract name for the same E.6 value (design decision 7).
  const query = normalizedQuery;

  // ---- 4. E.5(8) / F.2: providerScope ---------------------------------------
  const scopeResult = resolveProviderScope({
    plannedRoutes,
    requestedProviderScope: verdict.requestedProviderScope ?? null,
  });
  if (!scopeResult.ok) {
    return decision({
      ...bound,
      gapIdentityCore,
      query,
      normalizedQuery,
      status: AUTHORIZATION_STATUS_REJECTED,
      rejectionCode: scopeResult.rejectionCode,
    });
  }
  const providerScope = scopeResult.providerScope;

  // ---- 5. E.5(5): per-gap attempt bound, keyed on gapIdentityCore ------------
  const attempt = (attemptCounts[gapIdentityCore] ?? 0) + 1;
  if (attempt > maxAttemptsPerGap) {
    return decision({
      ...bound,
      gapIdentityCore,
      query,
      normalizedQuery,
      providerScope,
      status: AUTHORIZATION_STATUS_REJECTED,
      rejectionCode: REJECTION_ATTEMPT_BOUND_EXCEEDED,
    });
  }

  // ---- 6. E.5(6) / E.6: equivalent-query dedupe within the occurrence --------
  const dedupeKey = computeDedupeKey({ gapIdentityCore, normalizedQuery, providerScope });
  if (authorizedDedupeKeys.has(dedupeKey)) {
    return decision({
      ...bound,
      gapIdentityCore,
      query,
      normalizedQuery,
      providerScope,
      dedupeKey,
      status: AUTHORIZATION_STATUS_REJECTED,
      rejectionCode: REJECTION_DEDUPE_ALREADY_AUTHORIZED,
    });
  }

  // ---- 7. E.5(7): global budget preflight, costed in CHANNEL attempts --------
  const actionChannelAttemptCount = providerScope.length;
  if (attemptsBudgetCount + actionChannelAttemptCount > maxQueryBudget) {
    return decision({
      ...bound,
      gapIdentityCore,
      query,
      normalizedQuery,
      providerScope,
      dedupeKey,
      status: AUTHORIZATION_STATUS_REJECTED,
      rejectionCode: REJECTION_BUDGET_EXCEEDED,
    });
  }

  // ---- AUTHORIZED -----------------------------------------------------------
  return decision({
    ...bound,
    gapIdentityCore,
    query,
    normalizedQuery,
    providerScope,
    dedupeKey,
    attempt,
    actionChannelAttemptCount,
    targetedActionId: computeTargetedActionId({
      runId,
      occurrenceId,
      planHash,
      gapId,
      attempt,
      normalizedQuery,
      providerScope,
    }),
    status: AUTHORIZATION_STATUS_AUTHORIZED,
  });
}

// ---------------------------------------------------------------------------
// E.8 — deterministic multi-gap consumption
// ---------------------------------------------------------------------------

/**
 * E.8: authorize a batch of proposals for one occurrence.
 *
 * Gaps competing for the remaining budget are consumed in ASCENDING `gapId`
 * order — the T01-frozen comparator is REUSED (imported), not re-implemented.
 * The comparator is total: proposals that bind the SAME gapId are tie-broken on
 * their canonical JSON, so the consumption order is a deterministic function of
 * the proposal CONTENT and never of the caller's array order.
 *
 * The comparator reads only `gapId` and the proposal's canonical form. It never
 * reads `materiality` / `confidence`: E.8 / D12-5 keep those model-supplied
 * scores audit-only, so no model score can rank a gap or move budget.
 *
 * State is THREADED, never mutated: only an AUTHORIZED action advances the
 * per-gap attempt index, registers its dedupe key and consumes budget. The
 * caller's inputs are left byte-identical, and `nextState` returns fresh
 * structures the caller (T06) may persist.
 *
 * SCOPE NOTE (E.8 literally reads "多个 gap 竞争预算"): the ascending-`gapId` rule
 * constrains cross-GAP competition. Two proposals for the SAME gap are not
 * competing gaps; their relative order is fixed deterministically by content
 * rather than by any priority semantics, which is the narrowest reading that
 * invents no ordering rule the contract does not state.
 */
export function authorizeTargetedActionBatch(rawProposals, contextInput = {}) {
  if (!isPlainObject(contextInput)) throw authorizationError('authorization context must be a plain object');
  const list = Array.isArray(rawProposals) ? rawProposals : [];
  const ordered = [...list].sort(compareGapsByGapId);

  let attemptCounts = { ...normalizeAttemptIndex(contextInput.attemptsByGapIdentityCore) };
  const dedupeKeys = normalizeDedupeKeys(contextInput.authorizedDedupeKeys);
  const startingBudgetCount = Number.isInteger(contextInput.attemptsBudgetCount) && contextInput.attemptsBudgetCount >= 0
    ? contextInput.attemptsBudgetCount
    : 0;
  let consumedChannelAttempts = 0;

  const decisions = [];
  for (const proposal of ordered) {
    const result = authorizeTargetedAction(proposal, {
      ...contextInput,
      attemptsBudgetCount: startingBudgetCount + consumedChannelAttempts,
      attemptsByGapIdentityCore: attemptCounts,
      authorizedDedupeKeys: dedupeKeys,
    });
    decisions.push(result);
    if (result.status === AUTHORIZATION_STATUS_AUTHORIZED) {
      attemptCounts = { ...attemptCounts, [result.gapIdentityCore]: result.attempt };
      dedupeKeys.add(result.dedupeKey);
      consumedChannelAttempts += result.actionChannelAttemptCount;
    }
  }

  return {
    decisions,
    nextState: {
      attemptsBudgetCount: startingBudgetCount + consumedChannelAttempts,
      attemptsByGapIdentityCore: attemptCounts,
      authorizedDedupeKeys: [...dedupeKeys],
    },
  };
}
