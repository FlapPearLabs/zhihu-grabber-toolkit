// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-trust.mjs
 *
 * P2A-T04 (#116) — Trust & string-safety gate for a TargetedQueryProposal.
 *
 * Authority (FROZEN; this module must not reinterpret, generalize or "improve" it):
 *   - docs/specs/p2-ari-f02-targeted-requery.md   §5 D3, §10                (APPROVED)
 *   - docs/architecture/key-decisions.md          D12-3
 *   - docs/planning/..._SEAM_CONTRACT_V1.md       E.4 / E.5(1)(2)(3)(9) / F.3
 *   - docs/planning/..._SEAM_MAP_V1.md            S2
 *   - Issue #116 GOAL / ACCEPTANCE_CRITERIA / COUNTEREXAMPLES C2, C3
 *
 * Ownership boundary (Ticket Graph V1 §4 — ONE_ACTIVE_WRITER_PER_BRANCH):
 *   T04 OWNS  : proposal shape/parsing, gapId binding through an INJECTED gap
 *               existence resolver, plan-owned string resolution, the dual-lens
 *               intersection gate, trust-class judgement, the stable
 *               rejectionCode set, focused tests.
 *   T04 DOES NOT OWN (and this module deliberately contains NONE of):
 *               ledger read/write or any mutable state (T01/T06), diagnosis
 *               (T03), dedupeKey / attempt bound / budget / targetedActionId
 *               (T05), lifecycle / durable commit / replay (T06), resolution
 *               (T08), any retrieval IO, any ResearchCoverageState change, any
 *               artifact-walk trust-set extension.
 *
 * STATELESS BY CONSTRUCTION. The module imports no IO primitive, performs no
 * retrieval, opens no file, and holds no mutable state. It never touches the
 * artifact-walk trust-set parameter and never calls the artifact walk, so it
 * cannot widen the existing artifact-walk trust sets (D12-3 / F.3 / RR11).
 *
 * ---------------------------------------------------------------------------
 * FROZEN SEMANTICS AND THE INTERPRETATION DECISIONS TAKEN HERE
 * (recorded explicitly so reviewers can audit the decisions instead of
 * reconstructing intent from the code)
 * ---------------------------------------------------------------------------
 *
 * 1. AC1 — THE ADMIT RULE IS AN INTERSECTION, NOT A CHOICE.
 *       admit(s) ⟺ isPlanBoundarySafeString(s) AND isBoundarySafeString(s)
 *    `isPlanOwnedBoundarySafeString` is the mechanical locus of that rule and is
 *    written as a literal `&&`. The two lenses are genuinely independent (see
 *    the header of `rrf.mjs` and `plan-contract.mjs`): the plan lens rejects only
 *    profile roots and bounds at 300 chars, while the provider lens rejects ANY
 *    2+-segment absolute path and bounds at 500 chars, and additionally routes
 *    URL-shaped values through an https-only / no-userinfo / multi-layer
 *    credential check that the plan lens does not have. Neither implies the
 *    other, and "listed in a trust set" is a RELAXATION in the existing code
 *    (repo evidence rrf.test.mjs:996-1008 F8: `'/etc/hosts 文件的作用'` is refused
 *    as `unsafe_string` and accepted only once it is listed). Taking the
 *    intersection keeps the accepted set ⊆ the untrusted baseline, so this
 *    module introduces NO relaxation.
 *
 * 2. PLAN_OWNED MEMBERSHIP IS NECESSARY BUT NOT SUFFICIENT.
 *    Coming from a plan is NOT a safety exemption (AC4). A string that is exact
 *    plan material is still re-judged by the intersection gate on every call.
 *    Consequently the real plan fixture used by the tests can contain
 *    provider-illegal material, and such a proposal is REJECTED even though its
 *    trustClass is legitimately PLAN_OWNED.
 *
 * 3. THE CLOSED PLAN_OWNED FIELD SET EXCLUDES `aspects`.
 *    F.3 (PLAN_OWNED definition), D12-3 and the Issue #116 GOAL enumerate the
 *    SAME closed list:
 *      queryVariants / opposingFramings / entities /
 *      terminologyVariants.term|.variants / sourceGroupIntents.intent|.constraints
 *    E.4's constraint text additionally names `aspects`, but only inside a
 *    non-normative rationale sentence ("…已足以覆盖 MVP 的全部 gap 类型"). Three
 *    normative enumerations agree against one rationale sentence, and the
 *    fail-closed reading is also the narrower authorization surface, so `aspects`
 *    (and `sourceGroupIntents[].groupKey`) are NOT PLAN_OWNED here. Widening this
 *    set later is a contract change, not a bug fix.
 *
 * 4. `planOwnedStringRef` ADDRESSES MATERIAL BY A CLOSED FIELD ENUM.
 *    E.4 freezes the ref shape as `{ field, index }` "or an exact string". Two of
 *    the seven PLAN_OWNED leaves are LISTS nested inside a list
 *    (`terminologyVariants[].variants`, `sourceGroupIntents[].constraints`), so a
 *    second ordinal is required to address them. Rather than open `field` to
 *    arbitrary paths, `field` is a CLOSED dotted-path enum and the two list leaves
 *    take a `subIndex`. Key sets are strict: `subIndex` is REQUIRED for those two
 *    leaves and FORBIDDEN elsewhere.
 *
 * 5. THE EXACT-STRING FORM IS RESOLVED BY MEMBERSHIP, NEVER TRUSTED AS-IS.
 *    E.4 allows the ref to be a literal string. Treating such a string as
 *    authorized because it looks plan-owned would be exactly the caller-defined
 *    trust bypass that RR11 forbids. It is therefore accepted only if it is
 *    byte-identical to a string of the plan's PLAN_OWNED material. The match is
 *    EXACT: trim / NFC / casefold belong to the dedupe key (E.6, T05) and using
 *    them for ADMISSION would be a widening.
 *
 * 6. E.4 PRECEDENCE WHEN BOTH STRING SOURCES ARE PRESENT.
 *    E.4 freezes: "二者都存在时，controller 以 planOwnedStringRef 为准（更小机制
 *    优先）". So a proposal carrying both is adjudicated through the ref and the
 *    `queryText` is inert — it is never the admitted query, is never consulted as
 *    a string source, and never appears in the returned decision. A proposal whose
 *    ONLY string source is `queryText` is refused with the FROZEN code
 *    `FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP` (E.4 MVP constraint / E.5(9) / AC2).
 *    This is a deliberate reading of an interaction between E.4's precedence rule
 *    ("一律 REJECTED" governs the queryText *form*) and AC2's "queryText 形式";
 *    it is flagged here for reviewer adjudication, and the alternative reading
 *    (refuse every proposal that merely carries a queryText) would be strictly
 *    narrower but would contradict E.4's explicit precedence clause.
 *
 * 7. DROPPED vs REJECTED.
 *    E.4 says a missing / non-existent gapId makes the controller "丢弃 proposal
 *    (FAIL_CLOSED)"; E.7 says an unauthorized proposal is "记录为 REJECTED …
 *    父 gap 保持其既有状态". A proposal with no resolvable parent gap cannot be
 *    attributed to a gap at all, so it is DROPPED; a proposal with a valid parent
 *    gap that fails a judgement is REJECTED. Both are fail-closed and both
 *    produce zero retrieval IO. A gapId that is malformed is, by definition, not
 *    an existing E.2 gapId, so malformed and not-found share `UNKNOWN_GAP_ID`.
 *
 * 8. SCOPE OF E.5.
 *    Issue #116 scopes this ticket to E.5(1)(2)(3)(9). E.5(4) explicit provenance,
 *    E.5(5) per-gap attempt bound, E.5(6) equivalence dedupe, E.5(7) global budget
 *    and E.5(8) providerScope ⊆ plannedRoutes are NOT implemented here (T05).
 *    `requestedProviderScope` is nevertheless type/shape/safety-checked because it
 *    is untrusted proposal input that must not flow downstream unvalidated; the
 *    subset judgement itself is deliberately absent.
 */

import { isPlanBoundarySafeString, PLAN_MAX_ENTRIES_PER_LIST } from './plan-contract.mjs';
import { isBoundarySafeString } from './rrf.mjs';
import { gapIdentityCoreOf, gapTypeAllowsRetrievalAction } from './targeted-requery-ledger.mjs';

// ---------------------------------------------------------------------------
// F.3 — trust class (closed enum)
// ---------------------------------------------------------------------------

export const TRUST_CLASS_PLAN_OWNED = 'PLAN_OWNED';
/**
 * F.3 member that the MVP does NOT open (E.4 MVP constraint / D12-3). It stays in
 * the closed enum so the enum is complete, but no code path in this module ever
 * returns it, and nothing here can mint a new authorized string.
 */
export const TRUST_CLASS_TARGETED_CONTROLLER_AUTHORIZED = 'TARGETED_CONTROLLER_AUTHORIZED';
/** F.3: everything else — FAIL_CLOSED, never executed. */
export const TRUST_CLASS_UNCLASSIFIED = 'UNCLASSIFIED';

export const TRUST_CLASSES = Object.freeze([
  TRUST_CLASS_PLAN_OWNED,
  TRUST_CLASS_TARGETED_CONTROLLER_AUTHORIZED,
  TRUST_CLASS_UNCLASSIFIED,
]);

// ---------------------------------------------------------------------------
// proposal status (E.4 DROP vs E.7 REJECTED)
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUS_ADMITTED = 'ADMITTED';
export const PROPOSAL_STATUS_REJECTED = 'REJECTED';
export const PROPOSAL_STATUS_DROPPED = 'DROPPED';

// ---------------------------------------------------------------------------
// stable, machine-readable rejectionCodes (closed set — E.5 "稳定的
// machine-readable rejectionCode")
// ---------------------------------------------------------------------------

/** E.4 MVP constraint / E.5(9) / AC2 — the ONE code whose spelling is FROZEN. */
export const REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP =
  'FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP';
/** E.5(1) — the parent gap's type carries no retrieval-action authority (E.1). */
export const REJECTION_GAP_TYPE_NOT_IN_CLOSED_ENUM = 'GAP_TYPE_NOT_IN_CLOSED_ENUM';
/** E.4 — the proposal is not a shape-valid TargetedQueryProposal. */
export const REJECTION_MALFORMED_PROPOSAL = 'MALFORMED_PROPOSAL';
/** E.4 — no gapId supplied; an unattributable proposal is dropped. */
export const REJECTION_MISSING_GAP_ID = 'MISSING_GAP_ID';
/** E.4 — neither queryText nor planOwnedStringRef is present. */
export const REJECTION_NO_QUERY_STRING_SOURCE = 'NO_QUERY_STRING_SOURCE';
/** E.4 — the structured planOwnedStringRef does not resolve to plan material. */
export const REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE = 'PLAN_OWNED_REF_NOT_RESOLVABLE';
/** E.4 — the exact-string form is not byte-identical to plan material. */
export const REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN = 'PLAN_OWNED_STRING_NOT_IN_PLAN';
/** E.5(2) / F.3 — the string failed the dual-lens intersection gate. */
export const REJECTION_PLAN_OWNED_STRING_UNSAFE = 'PLAN_OWNED_STRING_UNSAFE';
/** F.3 — the string cannot be classified as PLAN_OWNED; FAIL_CLOSED. */
export const REJECTION_TRUST_CLASS_UNCLASSIFIED = 'TRUST_CLASS_UNCLASSIFIED';
/** E.4 / E.5(1) — the gapId is malformed or matches no existing E.2 gapId. */
export const REJECTION_UNKNOWN_GAP_ID = 'UNKNOWN_GAP_ID';

export const REJECTION_CODES = Object.freeze([
  REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP,
  REJECTION_GAP_TYPE_NOT_IN_CLOSED_ENUM,
  REJECTION_MALFORMED_PROPOSAL,
  REJECTION_MISSING_GAP_ID,
  REJECTION_NO_QUERY_STRING_SOURCE,
  REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE,
  REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN,
  REJECTION_PLAN_OWNED_STRING_UNSAFE,
  REJECTION_TRUST_CLASS_UNCLASSIFIED,
  REJECTION_UNKNOWN_GAP_ID,
]);

// ---------------------------------------------------------------------------
// E.4 / F.3 — the closed PLAN_OWNED field enum
// ---------------------------------------------------------------------------

export const PLAN_OWNED_FIELDS = Object.freeze([
  'queryVariants',
  'opposingFramings',
  'entities',
  'terminologyVariants.term',
  'terminologyVariants.variants',
  'sourceGroupIntents.intent',
  'sourceGroupIntents.constraints',
]);

/** Leaves that are string LISTS nested inside a list entry (need a subIndex). */
const LIST_LEAF_FIELDS = Object.freeze([
  'terminologyVariants.variants',
  'sourceGroupIntents.constraints',
]);

const PLAN_OWNED_FIELD_SET = new Set(PLAN_OWNED_FIELDS);
const LIST_LEAF_FIELD_SET = new Set(LIST_LEAF_FIELDS);

/** The frozen proposal key set; any other key is a fail-closed shape error. */
const PROPOSAL_ALLOWED_KEYS = new Set([
  'gapId',
  'intent',
  'planOwnedStringRef',
  'queryText',
  'requestedProviderScope',
]);

const DECISION_KEYS = Object.freeze([
  'gapId',
  'gapIdentityCore',
  'query',
  'querySource',
  'rejectionCode',
  'requestedProviderScope',
  'status',
  'trustClass',
]);

// ---------------------------------------------------------------------------
// module-private helpers (no shared barrel / index module is created)
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

/** Exact-key check for the strict structured-ref shape. */
function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  if (actual.length !== expectedKeys.length) return false;
  return actual.every((key, index) => key === expectedKeys[index]);
}

function readListEntry(list, index) {
  return Array.isArray(list) ? list[index] : undefined;
}

/** Read one PLAN_OWNED leaf by closed field path + ordinals. Never throws. */
function readPlanOwnedValue(plan, field, index, subIndex) {
  if (!isPlainObject(plan)) return null;
  switch (field) {
    case 'queryVariants':
      return readListEntry(plan.queryVariants, index);
    case 'opposingFramings':
      return readListEntry(plan.opposingFramings, index);
    case 'entities':
      return readListEntry(plan.entities, index);
    case 'terminologyVariants.term': {
      const entry = readListEntry(plan.terminologyVariants, index);
      return isPlainObject(entry) ? entry.term : undefined;
    }
    case 'terminologyVariants.variants': {
      const entry = readListEntry(plan.terminologyVariants, index);
      return isPlainObject(entry) ? readListEntry(entry.variants, subIndex) : undefined;
    }
    case 'sourceGroupIntents.intent': {
      const entry = readListEntry(plan.sourceGroupIntents, index);
      return isPlainObject(entry) ? entry.intent : undefined;
    }
    case 'sourceGroupIntents.constraints': {
      const entry = readListEntry(plan.sourceGroupIntents, index);
      return isPlainObject(entry) ? readListEntry(entry.constraints, subIndex) : undefined;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// AC1 — the dual-lens intersection gate
// ---------------------------------------------------------------------------

/**
 * AC1 / E.5(2) / F.3 / D12-3 — the ONLY admission predicate:
 *
 *     admit(s) ⟺ isPlanBoundarySafeString(s) AND isBoundarySafeString(s)
 *
 * Deliberately a literal `&&`. Never OR, never a single lens, never a
 * caller-supplied trust set. Total: every non-string, hostile or malformed input
 * returns false rather than throwing.
 */
export function isPlanOwnedBoundarySafeString(value) {
  return isPlanBoundarySafeString(value) && isBoundarySafeString(value);
}

// ---------------------------------------------------------------------------
// plan-owned material enumeration + trust class
// ---------------------------------------------------------------------------

/**
 * The PLAN_OWNED material of a validated plan, as an ascending, duplicate-free
 * list of the plan's OWN bytes.
 *
 * This is a pure read: it does NOT validate the plan (plan-contract.mjs owns
 * plan validation) and it never normalizes the strings, because admission
 * matching must be exact (see header note 5). A missing/malformed field simply
 * contributes nothing.
 */
export function enumeratePlanOwnedStrings(plan) {
  const collected = new Set();
  const addString = (value) => {
    if (typeof value === 'string') collected.add(value);
  };
  const addStringList = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) addString(entry);
    }
  };

  if (!isPlainObject(plan)) return [];

  addStringList(plan.queryVariants);
  addStringList(plan.opposingFramings);
  addStringList(plan.entities);

  if (Array.isArray(plan.terminologyVariants)) {
    for (const entry of plan.terminologyVariants) {
      if (!isPlainObject(entry)) continue;
      addString(entry.term);
      addStringList(entry.variants);
    }
  }

  if (Array.isArray(plan.sourceGroupIntents)) {
    for (const entry of plan.sourceGroupIntents) {
      if (!isPlainObject(entry)) continue;
      addString(entry.intent);
      addStringList(entry.constraints);
    }
  }

  return [...collected].sort();
}

/**
 * F.3 trust class of a candidate string. Membership of the plan's PLAN_OWNED
 * material is the ONLY input on this MVP surface, so the result is exactly
 * PLAN_OWNED or UNCLASSIFIED. `TARGETED_CONTROLLER_AUTHORIZED` is a member of the
 * frozen enum but is not open in the MVP (E.4 MVP constraint), so this function
 * never returns it and no code path here can mint an authorized new string.
 *
 * Classification is NOT admission: a PLAN_OWNED string still has to cross the
 * dual-lens gate (AC4).
 */
export function classifyTrustClass(value, planOwnedStrings) {
  if (typeof value !== 'string' || value.length === 0) return TRUST_CLASS_UNCLASSIFIED;
  const owned = Array.isArray(planOwnedStrings) ? planOwnedStrings : [];
  return owned.includes(value) ? TRUST_CLASS_PLAN_OWNED : TRUST_CLASS_UNCLASSIFIED;
}

/**
 * Judge a single candidate string: trust class first (F.3), then the dual-lens
 * intersection (E.5(2)). Any unclassified string FAILS CLOSED.
 */
export function admitTargetedQueryString(value, planOwnedStrings) {
  const trustClass = classifyTrustClass(value, planOwnedStrings);
  if (trustClass !== TRUST_CLASS_PLAN_OWNED) {
    return {
      admitted: false,
      trustClass: TRUST_CLASS_UNCLASSIFIED,
      rejectionCode: REJECTION_TRUST_CLASS_UNCLASSIFIED,
    };
  }
  if (!isPlanOwnedBoundarySafeString(value)) {
    return {
      admitted: false,
      trustClass: TRUST_CLASS_PLAN_OWNED,
      rejectionCode: REJECTION_PLAN_OWNED_STRING_UNSAFE,
    };
  }
  return { admitted: true, trustClass: TRUST_CLASS_PLAN_OWNED, rejectionCode: null };
}

// ---------------------------------------------------------------------------
// E.4 — planOwnedStringRef resolution
// ---------------------------------------------------------------------------

function refFailure(rejectionCode) {
  return { ok: false, value: null, field: null, rejectionCode };
}

/**
 * Resolve an E.4 `planOwnedStringRef` against a plan.
 *
 * Two accepted forms:
 *   · exact string           → accepted only if byte-identical to PLAN_OWNED
 *                              material of the plan (membership, never trust);
 *   · { field, index[, subIndex] } → `field` from the CLOSED PLAN_OWNED enum;
 *                              `subIndex` required exactly for the two list
 *                              leaves, forbidden elsewhere; the resolved leaf
 *                              must be a non-empty string.
 *
 * Everything else fails closed. The returned value is always the plan's own
 * bytes — this function never synthesizes, normalizes or trims a query string.
 */
export function resolvePlanOwnedStringRef(plan, ref) {
  if (typeof ref === 'string') {
    if (ref.length === 0) return refFailure(REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN);
    const owned = enumeratePlanOwnedStrings(plan);
    if (!owned.includes(ref)) return refFailure(REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN);
    return { ok: true, value: ref, field: null, rejectionCode: null };
  }

  if (!isPlainObject(ref)) return refFailure(REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);

  const { field } = ref;
  if (typeof field !== 'string' || !PLAN_OWNED_FIELD_SET.has(field)) {
    return refFailure(REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);
  }

  const isListLeaf = LIST_LEAF_FIELD_SET.has(field);
  const expectedKeys = isListLeaf ? ['field', 'index', 'subIndex'] : ['field', 'index'];
  if (!hasExactKeys(ref, expectedKeys)) {
    return refFailure(REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);
  }

  if (!isNonNegativeInteger(ref.index)) {
    return refFailure(REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);
  }
  if (isListLeaf && !isNonNegativeInteger(ref.subIndex)) {
    return refFailure(REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);
  }

  const value = readPlanOwnedValue(plan, field, ref.index, ref.subIndex);
  if (typeof value !== 'string' || value.length === 0) {
    return refFailure(REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);
  }
  return { ok: true, value, field, rejectionCode: null };
}

// ---------------------------------------------------------------------------
// E.4 — proposal parsing (strict shape; UNTRUSTED input)
// ---------------------------------------------------------------------------

function parseFailure(rejectionCode) {
  return { ok: false, rejectionCode, proposal: null };
}

/**
 * Parse/validate the SHAPE of an UNTRUSTED TargetedQueryProposal (E.4).
 *
 * Strict and fail-closed: unknown keys, wrong types, out-of-bound lists and
 * unsafe audit/scope strings are all refused. Nothing is coerced, trimmed or
 * repaired, and `queryText` is carried only as inert audit material — it is never
 * an authorization source (E.4 MVP constraint).
 *
 * `gapId` KEY PRESENCE IS NOT ENFORCED HERE. A missing/null/empty gapId is an
 * E.4 BINDING outcome (DROP, `MISSING_GAP_ID`), adjudicated by
 * `evaluateTargetedQueryProposal`, not a shape error.
 */
export function parseTargetedQueryProposal(raw) {
  if (!isPlainObject(raw)) return parseFailure(REJECTION_MALFORMED_PROPOSAL);

  for (const key of Object.keys(raw)) {
    if (!PROPOSAL_ALLOWED_KEYS.has(key)) return parseFailure(REJECTION_MALFORMED_PROPOSAL);
  }

  const rawGapId = raw.gapId ?? null;
  if (rawGapId !== null && typeof rawGapId !== 'string') {
    return parseFailure(REJECTION_MALFORMED_PROPOSAL);
  }

  const rawQueryText = raw.queryText ?? null;
  if (rawQueryText !== null && typeof rawQueryText !== 'string') {
    return parseFailure(REJECTION_MALFORMED_PROPOSAL);
  }

  const rawIntent = raw.intent ?? null;
  if (rawIntent !== null && (typeof rawIntent !== 'string' || !isPlanBoundarySafeString(rawIntent))) {
    return parseFailure(REJECTION_MALFORMED_PROPOSAL);
  }

  const rawScope = raw.requestedProviderScope ?? null;
  let scope = null;
  if (rawScope !== null) {
    if (!Array.isArray(rawScope) || rawScope.length > PLAN_MAX_ENTRIES_PER_LIST) {
      return parseFailure(REJECTION_MALFORMED_PROPOSAL);
    }
    for (const entry of rawScope) {
      if (
        typeof entry !== 'string'
        || entry.trim().length === 0
        || !isBoundarySafeString(entry)
      ) {
        return parseFailure(REJECTION_MALFORMED_PROPOSAL);
      }
    }
    scope = [...rawScope];
  }

  const rawRef = raw.planOwnedStringRef ?? null;
  if (rawRef !== null && typeof rawRef !== 'string' && !isPlainObject(rawRef)) {
    return parseFailure(REJECTION_MALFORMED_PROPOSAL);
  }

  return {
    ok: true,
    rejectionCode: null,
    proposal: {
      gapId: rawGapId,
      planOwnedStringRef: rawRef,
      queryText: rawQueryText,
      requestedProviderScope: scope,
      intent: rawIntent,
    },
  };
}

// ---------------------------------------------------------------------------
// E.4 / E.5(1)(2)(3)(9) — the whole judgement
// ---------------------------------------------------------------------------

function decision(overrides) {
  const base = {
    status: null,
    gapId: null,
    gapIdentityCore: null,
    query: null,
    querySource: null,
    rejectionCode: null,
    requestedProviderScope: null,
    trustClass: null,
  };
  for (const key of Object.keys(overrides)) {
    if (!DECISION_KEYS.includes(key)) continue;
    base[key] = overrides[key];
  }
  return base;
}

/**
 * Judge a TargetedQueryProposal end to end on this ticket's surface:
 *
 *   parse (E.4 shape)
 *   → gapId binding        E.4 + E.5(1)   via the INJECTED `resolveGap`
 *   → gapType closure      E.5(1)
 *   → string source        E.4 (planOwnedStringRef only; MVP)
 *   → ref resolution       E.4
 *   → trust class + dual lens   E.5(2)(3)  F.3 / AC1
 *
 * `resolveGap(gapId)` is INJECTED (E.4: "经注入的 gap 存在性解析器"): this module
 * owns no ledger and reads no state. It must return the existing gap record (an
 * object carrying at least `gapId` and `gapType`) or null. An answer whose
 * `gapId` is not byte-identical to the requested one fails closed, because E.4
 * requires an EXACT match with an existing E.2 gapId.
 *
 * Zero retrieval IO, no ledger writes, no dedupe/budget/attempt accounting (T05),
 * no targetedActionId (T05). A refused proposal is a controlled, auditable
 * refusal — never a silent fallback to re-running the parent plan (E.7).
 */
export function evaluateTargetedQueryProposal(raw, { plan = null, resolveGap = null } = {}) {
  const parsed = parseTargetedQueryProposal(raw);
  if (!parsed.ok) {
    return decision({ status: PROPOSAL_STATUS_REJECTED, rejectionCode: parsed.rejectionCode });
  }
  const proposal = parsed.proposal;

  // ---- E.4 binding: gapId required ---------------------------------------
  if (typeof proposal.gapId !== 'string' || proposal.gapId.length === 0) {
    return decision({ status: PROPOSAL_STATUS_DROPPED, rejectionCode: REJECTION_MISSING_GAP_ID });
  }

  // ---- E.4/E.5(1): the gapId must be a well-formed E.2 gapId -------------
  if (gapIdentityCoreOf(proposal.gapId) === null || typeof resolveGap !== 'function') {
    return decision({ status: PROPOSAL_STATUS_DROPPED, rejectionCode: REJECTION_UNKNOWN_GAP_ID });
  }

  // ---- E.4/E.5(1): it must match an EXISTING gapId exactly ---------------
  const gap = resolveGap(proposal.gapId);
  if (
    !isPlainObject(gap)
    || gap.gapId !== proposal.gapId
    || typeof gap.gapType !== 'string'
  ) {
    return decision({ status: PROPOSAL_STATUS_DROPPED, rejectionCode: REJECTION_UNKNOWN_GAP_ID });
  }

  const bound = {
    gapId: gap.gapId,
    gapIdentityCore: gapIdentityCoreOf(gap.gapId),
    requestedProviderScope: proposal.requestedProviderScope,
  };

  // ---- E.5(1): the parent gap type must carry action authority (E.1) -----
  if (!gapTypeAllowsRetrievalAction(gap.gapType)) {
    return decision({
      ...bound,
      status: PROPOSAL_STATUS_REJECTED,
      rejectionCode: REJECTION_GAP_TYPE_NOT_IN_CLOSED_ENUM,
    });
  }

  // ---- E.4: at least one string source -----------------------------------
  const hasQueryText = typeof proposal.queryText === 'string' && proposal.queryText.length > 0;
  const hasRef = proposal.planOwnedStringRef !== null;
  if (!hasQueryText && !hasRef) {
    return decision({
      ...bound,
      status: PROPOSAL_STATUS_REJECTED,
      rejectionCode: REJECTION_NO_QUERY_STRING_SOURCE,
    });
  }

  // ---- E.4 MVP constraint / E.5(9): queryText is never an authorization ---
  if (!hasRef) {
    return decision({
      ...bound,
      status: PROPOSAL_STATUS_REJECTED,
      rejectionCode: REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP,
    });
  }

  // ---- E.4: resolve the plan-owned ref into the plan's own bytes ----------
  const resolved = resolvePlanOwnedStringRef(plan, proposal.planOwnedStringRef);
  if (!resolved.ok) {
    return decision({
      ...bound,
      status: PROPOSAL_STATUS_REJECTED,
      rejectionCode: resolved.rejectionCode,
    });
  }

  // ---- AC1 / E.5(2)(3) / F.3: trust class + dual-lens intersection --------
  const verdict = admitTargetedQueryString(resolved.value, enumeratePlanOwnedStrings(plan));
  if (!verdict.admitted) {
    return decision({
      ...bound,
      status: PROPOSAL_STATUS_REJECTED,
      rejectionCode: verdict.rejectionCode,
      trustClass: verdict.trustClass,
    });
  }

  return decision({
    ...bound,
    status: PROPOSAL_STATUS_ADMITTED,
    query: resolved.value,
    querySource: 'planOwnedStringRef',
    rejectionCode: null,
    trustClass: TRUST_CLASS_PLAN_OWNED,
  });
}
