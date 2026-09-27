/**
 * research-orchestration/test/p2a-t05-bounded-authorization-action-identity.test.mjs
 *
 * P2A-T05 (#117) focused tests — bounded authorization policy + action identity.
 *
 * Authority (semantics are FROZEN; this suite must not reinterpret them):
 *   - docs/specs/p2-ari-f02-targeted-requery.md      §5 D2/D3/D6, §6, §7, §10, §11, §13
 *   - docs/architecture/key-decisions.md             D12-2 / D12-3 / D12-6 / D12-8
 *   - docs/planning/..._SEAM_CONTRACT_V1.md          E.5(4)(5)(6)(7)(8) / E.6 / E.7 / E.8 / F.1 / F.2 / F.4
 *   - docs/planning/..._SEAM_MAP_V1.md               S3
 *   - Ticket Decomposition §P2A-T05; Issue #117 GOAL / ACCEPTANCE_CRITERIA 1–7 /
 *     REQUIRED_TESTS / COUNTEREXAMPLES C1, C2, C12
 *
 * Anti-tautology discipline: every expected hash below is an INDEPENDENT literal,
 * computed OUTSIDE the module under test from the frozen formula (raw SHA-256 over
 * the frozen canonical-JSON payload) and hard-coded here. No expected value in this
 * suite is produced by calling the module under test.
 *
 * T05 owns: authorization policy, normalizedQuery, dedupeKey, per-gap attempt bound,
 * global-budget preflight, providerScope validation, targetedActionId, authorization
 * provenance, deterministic gap ordering.
 * T05 explicitly does NOT own: T04 string safety (consumed, not re-implemented),
 * T06 lifecycle / checkpoint, T07 global STOP wiring, T09 orchestration,
 * retrieval IO, `executing` state persistence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeQueryString,
  computeDedupeKey,
  computeTargetedActionId,
  canonicalizeProviderScope,
  resolveProviderScope,
  authorizeTargetedAction,
  authorizeTargetedActionBatch,
  TARGETED_ACTION_ID_DOMAIN,
  TARGETED_ACTION_ID_FIELDS,
  PROVIDER_SCOPE_ENTRY_KEYS,
  DEFAULT_MAX_ATTEMPTS_PER_GAP,
  AUTHORIZATION_ERROR_INVALID,
  AUTHORIZATION_STATUS_AUTHORIZED,
  AUTHORIZATION_STATUS_REJECTED,
  REJECTION_CODES,
  REJECTION_PROPOSAL_NOT_ADMITTED,
  REJECTION_GAP_IDENTITY_CORE_UNRESOLVED,
  REJECTION_NORMALIZED_QUERY_EMPTY,
  REJECTION_ATTEMPT_BOUND_EXCEEDED,
  REJECTION_DEDUPE_ALREADY_AUTHORIZED,
  REJECTION_PROVIDER_NOT_PLANNED,
  REJECTION_CAPABILITY_NOT_SEARCH,
  REJECTION_PROVIDER_SCOPE_INVALID,
  REJECTION_BUDGET_EXCEEDED,
} from '../lib/targeted-requery-authorization.mjs';

/** The T04-owned closed code set — used to check T05 never invents/relabels a T04 code. */
import { REJECTION_CODES as T04_REJECTION_CODES } from '../lib/targeted-requery-trust.mjs';
/** The T01-owned E.3/E.6 normaliser — used to pin family-wide casefold agreement. */
import { normalizeSubjectString } from '../lib/targeted-requery-ledger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB_FILE = path.join(HERE, '..', 'lib', 'targeted-requery-authorization.mjs');

// ---------------------------------------------------------------------------
// fixtures — frozen literals, not module output
// ---------------------------------------------------------------------------

/** 64 lowercase hex — an E.2 gapIdentityCore shape. */
const CORE_A = '1a'.repeat(32);
const CORE_B = 'b7'.repeat(32);
/** 64 lowercase hex — a plan contract hash shape. */
const PLAN_HASH = '9f'.repeat(32);

const SCOPE_ONE = Object.freeze([{ providerId: 'zhihu_search', capability: 'search' }]);
const SCOPE_TWO = Object.freeze([
  { providerId: 'zhihu_open_platform', capability: 'search' },
  { providerId: 'zhihu_search', capability: 'search' },
]);

/**
 * Independent SHA-256 oracle, computed from the FROZEN formula outside this module:
 *   payload  = canonicalJson({ gapIdentityCore, normalizedQuery, providerScope })
 *   expected = sha256(payload)
 */
const DEDUPE_KEY_ONE =
  '886948c234668ed6c945cc7a346bbf97af1082c60b20ff665acbcdb3f14436ed';
const DEDUPE_KEY_TWO_CHANNELS =
  'bcf147b98b92e43c0c7e0cc28252fa522814d1f076fe88493716d5f6f182f574';
const DEDUPE_KEY_OTHER_CORE =
  '4f33f489f622362c7d46b2a1d94aa1d85d8abf8ba99560ff5e1c0ee6e618f9e0';

/**
 * Independent oracle for the shared F.1 baseline (see `actionInput`):
 *   payload  = 'p2-ari-targeted-action/v1:' + canonicalJson({
 *                runId, occurrenceId, planHash, gapId, attempt, normalizedQuery, providerScope })
 *   expected = sha256(payload)
 */
const ACTION_ID_ONE =
  '3adcdd355f2faef4c2439d324eb0f26144b1d19a2ab26d6202594f445d9c6468';

/**
 * Independent oracle for the S3 happy-path action: the same F.1 formula evaluated
 * over the Stage-C fixture inputs (2 planned channels, the Stage-C run/occurrence).
 */
const HAPPY_ACTION_ID =
  'a74f13d7ca5d32d681b20effc092f0588ec8a49d6d5ab5eb5ab97d162b58e0c9';

// ===========================================================================
// E.6 — normalizedQuery
// ===========================================================================

test('E.6 normalization: case variants collapse to one normalizedQuery', () => {
  assert.equal(normalizeQueryString('alpha beta'), 'alpha beta');
  assert.equal(normalizeQueryString('Alpha Beta'), 'alpha beta');
  assert.equal(normalizeQueryString('ALPHA BETA'), 'alpha beta');
  assert.equal(normalizeQueryString('aLpHa bEtA'), 'alpha beta');
});

test('E.6 normalization: leading/trailing whitespace is trimmed', () => {
  assert.equal(normalizeQueryString('   alpha beta   '), 'alpha beta');
  assert.equal(normalizeQueryString('\t alpha beta \n'), 'alpha beta');
});

test('E.6 normalization: consecutive whitespace collapses to one space', () => {
  assert.equal(normalizeQueryString('alpha    beta'), 'alpha beta');
  assert.equal(normalizeQueryString('alpha\t\tbeta'), 'alpha beta');
  assert.equal(normalizeQueryString('alpha \n\t beta'), 'alpha beta');
  assert.equal(normalizeQueryString('alpha\u00a0beta'), 'alpha beta');
});

test('E.6 normalization: Unicode canonical equivalents collapse (NFC)', () => {
  const composed = 'caf\u00e9'; // café, single U+00E9
  const decomposed = 'cafe\u0301'; // cafe + combining acute
  assert.notEqual(composed, decomposed, 'the two inputs must differ byte-wise');
  assert.equal(normalizeQueryString(composed), normalizeQueryString(decomposed));
  assert.equal(normalizeQueryString(decomposed), composed);
});

test('E.6 normalization: order is trim -> NFC -> whitespace collapse -> casefold', () => {
  // A decomposed, padded, double-spaced, upper-cased input must land on the same
  // literal as its clean lower-case composed form.
  assert.equal(normalizeQueryString('  CAFE\u0301   LATTE  '), 'caf\u00e9 latte');
});

test('E.6 normalization: fails closed when the normalized result is empty', () => {
  assert.equal(normalizeQueryString(''), null);
  assert.equal(normalizeQueryString('   '), null);
  assert.equal(normalizeQueryString('\t\n  \n'), null);
  assert.equal(normalizeQueryString('\u00a0'), null);
});

test('E.6 normalization: fails closed on non-string input', () => {
  for (const bad of [null, undefined, 42, true, {}, [], Symbol('x')]) {
    assert.equal(normalizeQueryString(bad), null);
  }
});

test('E.6 normalization: is deterministic and idempotent', () => {
  const once = normalizeQueryString('  ALPHA   BETA\u00a0');
  assert.equal(once, 'alpha beta');
  assert.equal(normalizeQueryString(once), once);
  assert.equal(normalizeQueryString('  ALPHA   BETA\u00a0'), once);
});

// ===========================================================================
// E.6 — dedupeKey
// ===========================================================================

test('E.6 dedupeKey matches the frozen formula (independent oracle)', () => {
  const key = computeDedupeKey({
    gapIdentityCore: CORE_A,
    normalizedQuery: 'alpha beta',
    providerScope: SCOPE_ONE,
  });
  assert.equal(key, DEDUPE_KEY_ONE);
  assert.match(key, /^[0-9a-f]{64}$/);
});

test('E.6 dedupeKey is independent of providerScope ORDER', () => {
  const ordered = computeDedupeKey({
    gapIdentityCore: CORE_A,
    normalizedQuery: 'alpha beta',
    providerScope: SCOPE_TWO,
  });
  const shuffled = computeDedupeKey({
    gapIdentityCore: CORE_A,
    normalizedQuery: 'alpha beta',
    providerScope: [...SCOPE_TWO].reverse(),
  });
  assert.equal(ordered, DEDUPE_KEY_TWO_CHANNELS);
  assert.equal(shuffled, ordered, 'providerScope is normalised order-independently');
});

test('E.6 dedupeKey is independent of object KEY order inside a scope entry', () => {
  const a = computeDedupeKey({
    gapIdentityCore: CORE_A,
    normalizedQuery: 'alpha beta',
    providerScope: [{ capability: 'search', providerId: 'zhihu_search' }],
  });
  assert.equal(a, DEDUPE_KEY_ONE);
});

test('E.6 dedupeKey differs when gapIdentityCore differs', () => {
  const key = computeDedupeKey({
    gapIdentityCore: CORE_B,
    normalizedQuery: 'alpha beta',
    providerScope: SCOPE_ONE,
  });
  assert.equal(key, DEDUPE_KEY_OTHER_CORE);
  assert.notEqual(key, DEDUPE_KEY_ONE);
});

test('E.6 dedupeKey differs when providerScope differs', () => {
  const one = computeDedupeKey({
    gapIdentityCore: CORE_A, normalizedQuery: 'alpha beta', providerScope: SCOPE_ONE,
  });
  const two = computeDedupeKey({
    gapIdentityCore: CORE_A, normalizedQuery: 'alpha beta', providerScope: SCOPE_TWO,
  });
  assert.notEqual(one, two);
});

test('E.6 dedupeKey differs when normalizedQuery differs', () => {
  const a = computeDedupeKey({
    gapIdentityCore: CORE_A, normalizedQuery: 'alpha beta', providerScope: SCOPE_ONE,
  });
  const b = computeDedupeKey({
    gapIdentityCore: CORE_A, normalizedQuery: 'alpha gamma', providerScope: SCOPE_ONE,
  });
  assert.notEqual(a, b);
});

test('E.6 dedupeKey normalises its own inputs: equivalent queries collapse to one key', () => {
  const base = computeDedupeKey({
    gapIdentityCore: CORE_A, normalizedQuery: 'alpha beta', providerScope: SCOPE_ONE,
  });
  assert.equal(base, DEDUPE_KEY_ONE);
  for (const variant of ['Alpha Beta', '  ALPHA   BETA  ', 'aLpHa\tbEtA', 'ALPHA\u00a0BETA']) {
    assert.equal(
      computeDedupeKey({ gapIdentityCore: CORE_A, normalizedQuery: variant, providerScope: SCOPE_ONE }),
      base,
      `variant ${JSON.stringify(variant)} must produce the same dedupeKey`,
    );
  }
});

test('E.6 dedupeKey fails closed on inputs that cannot yield a canonical key', () => {
  const bad = [
    { gapIdentityCore: 'not-hex', normalizedQuery: 'alpha beta', providerScope: SCOPE_ONE },
    { gapIdentityCore: CORE_A.toUpperCase(), normalizedQuery: 'alpha beta', providerScope: SCOPE_ONE },
    { gapIdentityCore: CORE_A, normalizedQuery: '   ', providerScope: SCOPE_ONE },
    { gapIdentityCore: CORE_A, normalizedQuery: 42, providerScope: SCOPE_ONE },
    { gapIdentityCore: CORE_A, normalizedQuery: 'alpha beta', providerScope: [] },
    { gapIdentityCore: CORE_A, normalizedQuery: 'alpha beta', providerScope: null },
    {
      gapIdentityCore: CORE_A,
      normalizedQuery: 'alpha beta',
      providerScope: [{ providerId: 'zhihu_search', capability: 'capture' }],
    },
    {
      gapIdentityCore: CORE_A,
      normalizedQuery: 'alpha beta',
      providerScope: [
        { providerId: 'zhihu_search', capability: 'search' },
        { providerId: 'zhihu_search', capability: 'search' },
      ],
    },
    { gapIdentityCore: CORE_A, normalizedQuery: 'alpha beta', providerScope: [{ providerId: '', capability: 'search' }] },
    {
      gapIdentityCore: CORE_A,
      normalizedQuery: 'alpha beta',
      providerScope: [{ providerId: 'zhihu_search', capability: 'search', authClass: 'bearer' }],
    },
  ];
  for (const input of bad) {
    assert.throws(() => computeDedupeKey(input), `must refuse ${JSON.stringify(input)}`);
  }
});

// ===========================================================================
// F.1 — targetedActionId
// ===========================================================================

/** Shared baseline for the F.1 identity matrix. Every field is an independent literal. */
function actionInput(overrides = {}) {
  return {
    runId: 'run-demo',
    occurrenceId: 'occ-demo-1',
    planHash: PLAN_HASH,
    gapId: `${CORE_A}:0`,
    attempt: 1,
    normalizedQuery: 'alpha beta',
    providerScope: SCOPE_ONE,
    ...overrides,
  };
}

test('F.1 targetedActionId matches the frozen formula (independent oracle)', () => {
  const id = computeTargetedActionId(actionInput());
  assert.equal(id, ACTION_ID_ONE);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(TARGETED_ACTION_ID_DOMAIN, 'p2-ari-targeted-action/v1');
});

test('F.1 targetedActionId is deterministic across repeated calls (C12 replay identity)', () => {
  assert.equal(computeTargetedActionId(actionInput()), computeTargetedActionId(actionInput()));
});

test('F.1 targetedActionId is independent of providerScope order', () => {
  const a = computeTargetedActionId(actionInput({ providerScope: SCOPE_TWO }));
  const b = computeTargetedActionId(actionInput({ providerScope: [...SCOPE_TWO].reverse() }));
  assert.equal(a, b);
});

test('F.1 targetedActionId is sensitive to EVERY frozen identity field', () => {
  const baseline = computeTargetedActionId(actionInput());
  const mutations = {
    runId: { runId: 'run-other' },
    occurrenceId: { occurrenceId: 'occ-demo-2' },
    planHash: { planHash: 'ab'.repeat(32) },
    gapId: { gapId: `${CORE_A}:1` },
    attempt: { attempt: 2 },
    normalizedQuery: { normalizedQuery: 'alpha gamma' },
    providerScope: { providerScope: [{ providerId: 'zhihu_open_platform', capability: 'search' }] },
  };
  for (const [field, delta] of Object.entries(mutations)) {
    assert.notEqual(
      computeTargetedActionId(actionInput(delta)),
      baseline,
      `changing ${field} must change targetedActionId`,
    );
  }
});

test('F.1 identity carries no timestamp / randomness / path (absent by construction)', () => {
  const a = computeTargetedActionId(actionInput());
  const b = computeTargetedActionId(actionInput());
  // Any clock or RNG participation would make these differ.
  assert.equal(a, b);
  assert.equal(/[0-9a-f]{64}/.test(a), true);
});

test('F.1 targetedActionId refuses extra convenience fields (exact field set only)', () => {
  assert.throws(() => computeTargetedActionId(actionInput({ materiality: 0.9 })));
  assert.throws(() => computeTargetedActionId(actionInput({ diagnosisRound: 3 })));
  assert.throws(() => computeTargetedActionId(actionInput({ timestamp: 'anything' })));
  assert.throws(() => {
    const missing = actionInput();
    delete missing.attempt;
    computeTargetedActionId(missing);
  });
});

test('F.1 targetedActionId fails closed on malformed frozen inputs', () => {
  assert.throws(() => computeTargetedActionId(actionInput({ runId: '' })));
  assert.throws(() => computeTargetedActionId(actionInput({ occurrenceId: 42 })));
  assert.throws(() => computeTargetedActionId(actionInput({ planHash: 'nope' })));
  assert.throws(() => computeTargetedActionId(actionInput({ gapId: 'not-a-gap-id' })));
  assert.throws(() => computeTargetedActionId(actionInput({ attempt: 0 })));
  assert.throws(() => computeTargetedActionId(actionInput({ attempt: 1.5 })));
  assert.throws(() => computeTargetedActionId(actionInput({ normalizedQuery: '  ' })));
});

// ===========================================================================
// SEAM E.5(4)(5)(6)(7)(8) / E.7 / E.8 / F.2 — bounded authorization policy
// ===========================================================================

const CORE_SMALL = '0a'.repeat(32); // sorts BEFORE CORE_A
const OCCURRENCE = 'occ-p2a-t05-fixture';
const RUN_ID = 'run-p2a-t05-fixture';

/** ASCENDING order: '0a…' < '1a…' < 'b7…'. */
const GAP_ID_SMALL = `${CORE_SMALL}:0`;
const GAP_ID_ONE = `${CORE_A}:0`;
const GAP_ID_ONE_ROUND_2 = `${CORE_A}:1`;
const GAP_ID_TWO = `${CORE_B}:0`;

function makePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    queryVariants: ['alpha beta', 'alpha gamma', '大语言模型 Agent 落地争议'],
    aspects: ['技术成熟度'],
    entities: ['OpenAI'],
    opposingFramings: ['Agent 已可大规模落地'],
    terminologyVariants: [{ term: 'Agent', variants: ['智能体'] }],
    sourceGroupIntents: [{ intent: '关注反方观点', constraints: ['权威来源优先'], groupKey: null }],
    ...overrides,
  };
}

/** Real search channels only — the F.2 `plannedRoutes` universe. */
const PLANNED_ROUTES = Object.freeze([
  { providerId: 'zhihu_search', capability: 'search' },
  { providerId: 'zhihu_open_platform', capability: 'search' },
]);

/** The canonical (ascending-`providerId`) form the module must produce. */
const SORTED_PLANNED_ROUTES = Object.freeze([
  { providerId: 'zhihu_open_platform', capability: 'search' },
  { providerId: 'zhihu_search', capability: 'search' },
]);

/** Same universe, plus a non-`search` capability (used to reach E.5(8) rejection). */
const PLANNED_ROUTES_WITH_CAPTURE = Object.freeze([
  ...PLANNED_ROUTES,
  { providerId: 'zhihu_context', capability: 'capture' },
]);

const KNOWN_GAPS = Object.freeze({
  [GAP_ID_SMALL]: { gapId: GAP_ID_SMALL, gapType: 'ASPECT_GAP' },
  [GAP_ID_ONE]: { gapId: GAP_ID_ONE, gapType: 'ASPECT_GAP' },
  [GAP_ID_ONE_ROUND_2]: { gapId: GAP_ID_ONE_ROUND_2, gapType: 'ASPECT_GAP' },
  [GAP_ID_TWO]: { gapId: GAP_ID_TWO, gapType: 'ASPECT_GAP' },
});

/** E.4-injected existence resolver (the T04 contract) — no ledger, no IO. */
function resolveGap(gapId) {
  return KNOWN_GAPS[gapId] ?? null;
}

function proposal(overrides = {}) {
  return {
    gapId: GAP_ID_ONE,
    planOwnedStringRef: { field: 'queryVariants', index: 0 },
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    plan: makePlan(),
    resolveGap,
    plannedRoutes: PLANNED_ROUTES,
    runId: RUN_ID,
    occurrenceId: OCCURRENCE,
    planHash: PLAN_HASH,
    maxAttemptsPerGap: DEFAULT_MAX_ATTEMPTS_PER_GAP,
    maxQueryBudget: 10,
    attemptsBudgetCount: 0,
    attemptsByGapIdentityCore: {},
    authorizedDedupeKeys: [],
    ...overrides,
  };
}

/** Deep-freeze so any attempted mutation by the module throws in strict mode. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

test('S3 OUTPUT_CONTRACT: an authorized action carries the frozen action record', () => {
  const decision = authorizeTargetedAction(proposal(), context());
  assert.equal(decision.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(decision.rejectionCode, null);
  assert.equal(decision.rejectionDetail, null);
  // --- S3: { targetedActionId, planHash, runId, occurrenceId, gapId, attempt,
  //           query, queryTrustClass, providerScope, status } ------------------
  assert.equal(decision.targetedActionId, HAPPY_ACTION_ID); // independent oracle
  assert.equal(decision.planHash, PLAN_HASH);
  assert.equal(decision.runId, RUN_ID);
  assert.equal(decision.occurrenceId, OCCURRENCE);
  assert.equal(decision.gapId, GAP_ID_ONE);
  assert.equal(decision.attempt, 1);
  assert.equal(decision.query, 'alpha beta');
  assert.equal(decision.queryTrustClass, 'PLAN_OWNED');
  assert.deepEqual(decision.providerScope, SORTED_PLANNED_ROUTES);
  // --- E.6 / F.1 name for the same value (both frozen names are emitted) -----
  assert.equal(decision.normalizedQuery, decision.query);
  // --- T05-owned policy facts ------------------------------------------------
  assert.equal(decision.gapIdentityCore, CORE_A);
  assert.equal(decision.actionChannelAttemptCount, 2);
  assert.match(decision.dedupeKey, /^[0-9a-f]{64}$/);
});

test('F.4 provenance: targetedActionId -> gapId -> planHash is machine-checkable', () => {
  const decision = authorizeTargetedAction(proposal(), context());
  assert.equal(decision.targetedActionId, HAPPY_ACTION_ID);
  assert.equal(decision.gapId, GAP_ID_ONE);
  // gapIdentityCore is the stable (round-free) prefix of the bound gapId (D12-8)
  assert.equal(decision.gapId.slice(0, 64), decision.gapIdentityCore);
  assert.equal(decision.gapIdentityCore, CORE_A);
  assert.equal(decision.planHash, PLAN_HASH);
  assert.equal(decision.providerScope.length, 2);
});

test('E.5(9)/E.7: a free-form queryText proposal is REJECTED with the T04 code (zero IO)', () => {
  const decision = authorizeTargetedAction(
    { gapId: GAP_ID_ONE, queryText: '完全自由文本' },
    context(),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(decision.rejectionCode, REJECTION_PROPOSAL_NOT_ADMITTED);
  assert.equal(decision.rejectionDetail, 'FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP');
  assert.equal(decision.targetedActionId, null);
  assert.equal(decision.attempt, null);
});

test('E.4/E.7: an unresolvable parent gap is REJECTED, never re-bound (C2)', () => {
  const decision = authorizeTargetedAction(
    proposal({ gapId: `${'ff'.repeat(32)}:0` }),
    context(),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(decision.rejectionCode, REJECTION_PROPOSAL_NOT_ADMITTED);
  assert.equal(decision.targetedActionId, null);
});

test('E.5(5): attempt bound is inclusive at max and exclusive at max+1', () => {
  const atMax = authorizeTargetedAction(
    proposal(),
    context({ attemptsByGapIdentityCore: { [CORE_A]: 1 } }),
  );
  assert.equal(atMax.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(atMax.attempt, 2);

  const overMax = authorizeTargetedAction(
    proposal(),
    context({ attemptsByGapIdentityCore: { [CORE_A]: 2 } }),
  );
  assert.equal(overMax.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(overMax.rejectionCode, REJECTION_ATTEMPT_BOUND_EXCEEDED);
  assert.equal(overMax.targetedActionId, null);
});

test('E.5(5): a custom maxAttemptsPerGap is honoured', () => {
  const d = authorizeTargetedAction(
    proposal(),
    context({ maxAttemptsPerGap: 1, attemptsByGapIdentityCore: { [CORE_A]: 1 } }),
  );
  assert.equal(d.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(d.rejectionCode, REJECTION_ATTEMPT_BOUND_EXCEEDED);
});

test('E.5(6) / C1: the SAME equivalent query across rounds is authorised only ONCE', () => {
  const first = authorizeTargetedAction(proposal(), context());
  assert.equal(first.status, AUTHORIZATION_STATUS_AUTHORIZED);

  // Round 2: same gap identity core, new gapId, equivalent query, same scope.
  const second = authorizeTargetedAction(
    proposal({ gapId: GAP_ID_ONE_ROUND_2 }),
    context({ authorizedDedupeKeys: [first.dedupeKey] }),
  );
  assert.equal(second.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(second.rejectionCode, REJECTION_DEDUPE_ALREADY_AUTHORIZED);
  assert.equal(second.dedupeKey, first.dedupeKey, 'the dedupe key is round-independent');
  assert.equal(second.targetedActionId, null);
});

test('E.5(6) / C12: a replayed action identity cannot re-authorise (resume replay)', () => {
  const first = authorizeTargetedAction(proposal(), context());
  const replay = authorizeTargetedAction(
    proposal(),
    context({
      authorizedDedupeKeys: [first.dedupeKey],
      attemptsByGapIdentityCore: { [CORE_A]: 1 },
    }),
  );
  assert.equal(replay.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(replay.targetedActionId, null);
  // E.5(5) is evaluated BEFORE E.5(6) and attempt 2 == maxAttemptsPerGap is legal,
  // so the C12 replay is caught by the DEDUPE rule, not by the attempt bound.
  assert.equal(replay.rejectionCode, REJECTION_DEDUPE_ALREADY_AUTHORIZED);
  assert.equal(replay.attempt, null, 'a REJECTED action advances no attempt counter');
});

test('E.6 dedupeKey is keyed on gapIdentityCore, not on gapId: different cores both authorise', () => {
  const one = authorizeTargetedAction(proposal(), context());
  const other = authorizeTargetedAction(
    proposal({ gapId: GAP_ID_TWO }),
    context({ authorizedDedupeKeys: [one.dedupeKey] }),
  );
  assert.equal(one.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(other.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.notEqual(one.dedupeKey, other.dedupeKey);
});

test('E.5(6): a DIFFERENT query on the same gap is not deduped away', () => {
  const first = authorizeTargetedAction(proposal(), context());
  const second = authorizeTargetedAction(
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 1 } }),
    context({
      authorizedDedupeKeys: [first.dedupeKey],
      attemptsByGapIdentityCore: { [CORE_A]: 1 },
    }),
  );
  assert.equal(second.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(second.normalizedQuery, 'alpha gamma');
  assert.notEqual(second.dedupeKey, first.dedupeKey);
});

test('F.2: a provider outside plannedRoutes is REJECTED (new provider)', () => {
  const decision = authorizeTargetedAction(
    proposal({ requestedProviderScope: ['zhihu_search', 'not_a_planned_provider'] }),
    context(),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(decision.rejectionCode, REJECTION_PROVIDER_NOT_PLANNED);
  assert.equal(decision.targetedActionId, null);
});

test('F.2: a non-search capability is REJECTED (new capability)', () => {
  const decision = authorizeTargetedAction(
    proposal({ requestedProviderScope: ['zhihu_context'] }),
    context({ plannedRoutes: PLANNED_ROUTES_WITH_CAPTURE }),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(decision.rejectionCode, REJECTION_CAPABILITY_NOT_SEARCH);
});

test('F.2: an explicitly empty providerScope is REJECTED (no silent default)', () => {
  const decision = authorizeTargetedAction(
    proposal({ requestedProviderScope: [] }),
    context(),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(decision.rejectionCode, REJECTION_PROVIDER_SCOPE_INVALID);
});

test('F.2: a duplicated provider in the requested scope is REJECTED', () => {
  const decision = authorizeTargetedAction(
    proposal({ requestedProviderScope: ['zhihu_search', 'zhihu_search'] }),
    context(),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(decision.rejectionCode, REJECTION_PROVIDER_SCOPE_INVALID);
});

test('F.2: no requested scope means ALL planned search channels (default scope)', () => {
  const decision = authorizeTargetedAction(proposal(), context());
  assert.equal(decision.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.deepEqual(decision.providerScope, [
    { providerId: 'zhihu_open_platform', capability: 'search' },
    { providerId: 'zhihu_search', capability: 'search' },
  ]);
  assert.equal(decision.actionChannelAttemptCount, 2);
});

test('F.2: a single requested channel narrows the scope and the budget cost', () => {
  const decision = authorizeTargetedAction(
    proposal({ requestedProviderScope: ['zhihu_search'] }),
    context(),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.deepEqual(decision.providerScope, [{ providerId: 'zhihu_search', capability: 'search' }]);
  assert.equal(decision.actionChannelAttemptCount, 1);
});

test('E.5(7): budget cost is the number of channels, NOT 1 (2 channels, 1 slot left)', () => {
  const decision = authorizeTargetedAction(
    proposal(),
    context({ attemptsBudgetCount: 9, maxQueryBudget: 10 }),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(decision.rejectionCode, REJECTION_BUDGET_EXCEEDED);
});

test('E.5(7): 2 channels with exactly 2 slots left are AUTHORIZED (inclusive bound)', () => {
  const decision = authorizeTargetedAction(
    proposal(),
    context({ attemptsBudgetCount: 8, maxQueryBudget: 10 }),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(decision.actionChannelAttemptCount, 2);
});

test('E.5(7): the same 2-channel action fits when only ONE channel is requested', () => {
  const decision = authorizeTargetedAction(
    proposal({ requestedProviderScope: ['zhihu_search'] }),
    context({ attemptsBudgetCount: 9, maxQueryBudget: 10 }),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(decision.actionChannelAttemptCount, 1);
});

test('E.7: a REJECTED action performs zero IO and mutates no input (frozen inputs)', () => {
  const frozenProposal = deepFreeze(proposal({ requestedProviderScope: ['nope'] }));
  const frozenContext = deepFreeze(context());
  const decision = authorizeTargetedAction(frozenProposal, frozenContext);
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  // The parent gap record is a frozen object the module must never touch.
  assert.deepEqual(KNOWN_GAPS[GAP_ID_ONE], { gapId: GAP_ID_ONE, gapType: 'ASPECT_GAP' });
});

test('E.7: a REJECTED decision carries no lifecycle / resolution / saturation state', () => {
  const decision = authorizeTargetedAction(
    proposal({ requestedProviderScope: ['nope'] }),
    context(),
  );
  const serialized = JSON.stringify(decision).toLowerCase();
  for (const forbidden of ['resolved', 'saturated', 'committed', 'evaluated', 'executing', 'proposed']) {
    assert.equal(serialized.includes(forbidden), false, `REJECTED must not carry ${forbidden}`);
  }
});

test('E.7: rejection codes form a closed, stable, duplicate-free set', () => {
  assert.equal(new Set(REJECTION_CODES).size, REJECTION_CODES.length);
  assert.ok(REJECTION_CODES.includes(REJECTION_BUDGET_EXCEEDED));
  assert.ok(REJECTION_CODES.includes(REJECTION_DEDUPE_ALREADY_AUTHORIZED));
  assert.ok(REJECTION_CODES.includes(REJECTION_GAP_IDENTITY_CORE_UNRESOLVED));
  assert.ok(REJECTION_CODES.includes(REJECTION_NORMALIZED_QUERY_EMPTY));
  assert.equal(Object.isFrozen(REJECTION_CODES), true);
});

test('defensive T04-seam guards: their upstream preconditions are PINNED', () => {
  // `PER_GAP...`-style guards are live; the two below are defensive, because T04
  // already refuses the inputs that would reach them. Pin those preconditions so
  // that a future T04 relaxation turns this test red instead of silently making
  // an "unreachable" branch live.
  //
  // (a) T04 never ADMITS a gapId without a resolvable identity core.
  const offShape = authorizeTargetedAction(proposal({ gapId: 'not-a-well-formed-gap-id' }), context());
  assert.equal(offShape.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(offShape.rejectionCode, REJECTION_PROPOSAL_NOT_ADMITTED);
  assert.equal(offShape.rejectionDetail, 'UNKNOWN_GAP_ID');

  // (b) T04 never ADMITS a query that normalises to empty (the provider lens
  //     refuses whitespace-only material before T05 ever sees it).
  const whitespacePlan = makePlan({ queryVariants: ['   '] });
  const emptyQuery = authorizeTargetedAction(
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 0 } }),
    context({ plan: whitespacePlan }),
  );
  assert.equal(emptyQuery.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(emptyQuery.rejectionCode, REJECTION_PROPOSAL_NOT_ADMITTED);
  assert.equal(emptyQuery.rejectionDetail, 'PLAN_OWNED_STRING_UNSAFE');
});

test('S3: the decision key set is frozen so an accidental superset cannot drift in', () => {
  const expected = [
    'actionChannelAttemptCount', 'attempt', 'dedupeKey', 'gapId', 'gapIdentityCore',
    'normalizedQuery', 'occurrenceId', 'planHash', 'providerScope', 'query',
    'queryTrustClass', 'rejectionCode', 'rejectionDetail', 'runId', 'status',
    'targetedActionId',
  ].sort();
  const authorized = authorizeTargetedAction(proposal(), context());
  const rejected = authorizeTargetedAction(
    proposal({ requestedProviderScope: ['nope'] }),
    context(),
  );
  assert.deepEqual(Object.keys(authorized).sort(), expected);
  assert.deepEqual(Object.keys(rejected).sort(), expected, 'the decision shape is total');
});

test('E.8: multiple gaps competing for budget are consumed in ascending gapId order', () => {
  const result = authorizeTargetedActionBatch(
    [
      proposal({ gapId: GAP_ID_ONE }), // larger gapId, listed FIRST
      proposal({ gapId: GAP_ID_SMALL }), // smaller gapId, listed SECOND
    ],
    context({ maxQueryBudget: 2, attemptsBudgetCount: 0 }),
  );
  assert.equal(result.decisions.length, 2);
  const authorized = result.decisions.filter((d) => d.status === AUTHORIZATION_STATUS_AUTHORIZED);
  const rejected = result.decisions.filter((d) => d.status === AUTHORIZATION_STATUS_REJECTED);
  assert.equal(authorized.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(authorized[0].gapId, GAP_ID_SMALL, 'the smaller gapId consumes budget first');
  assert.equal(rejected[0].gapId, GAP_ID_ONE);
  assert.equal(rejected[0].rejectionCode, REJECTION_BUDGET_EXCEEDED);
  assert.deepEqual(
    result.decisions.map((d) => d.gapId),
    [GAP_ID_SMALL, GAP_ID_ONE],
    'decisions are reported in deterministic gapId-ascending order',
  );
});

test('E.8: ordering ignores model-supplied materiality / confidence (audit-only)', () => {
  // #108 §4's materiality / confidence are AUDIT-ONLY in the MVP (D12-5 / E.8):
  // they must not buy budget priority. They are attached to the GAP records here
  // (the only place the model's scores live) — the *lower*-scored, *smaller*-gapId
  // gap must still win the single remaining budget slot.
  const scoredGaps = {
    [GAP_ID_ONE]: { gapId: GAP_ID_ONE, gapType: 'ASPECT_GAP', materiality: 1, confidence: 1 },
    [GAP_ID_SMALL]: { gapId: GAP_ID_SMALL, gapType: 'ASPECT_GAP', materiality: 0, confidence: 0 },
  };
  const withScores = authorizeTargetedActionBatch(
    [proposal({ gapId: GAP_ID_ONE }), proposal({ gapId: GAP_ID_SMALL })],
    context({
      maxQueryBudget: 2,
      attemptsBudgetCount: 0,
      resolveGap: (gapId) => scoredGaps[gapId] ?? null,
    }),
  );
  const authorized = withScores.decisions.filter((d) => d.status === AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(authorized.length, 1);
  assert.equal(authorized[0].gapId, GAP_ID_SMALL, 'a higher model score must not buy priority');
});

test('E.8: the batch never mutates its inputs and threads state only on AUTHORIZED', () => {
  const attempts = deepFreeze({});
  const keys = deepFreeze([]);
  const result = authorizeTargetedActionBatch(
    [
      proposal({ gapId: GAP_ID_SMALL }),
      proposal({ gapId: GAP_ID_ONE, requestedProviderScope: ['nope'] }),
    ],
    context({ attemptsByGapIdentityCore: attempts, authorizedDedupeKeys: keys, maxQueryBudget: 10 }),
  );
  assert.deepEqual(attempts, {}, 'input attempt index is untouched');
  assert.deepEqual(keys, [], 'input dedupe set is untouched');
  assert.equal(result.nextState.attemptsByGapIdentityCore[CORE_SMALL], 1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.nextState.attemptsByGapIdentityCore, CORE_A),
    false,
    'a REJECTED action contributes nothing to the attempt index',
  );
  assert.equal(result.nextState.authorizedDedupeKeys.length, 1);
  assert.equal(result.nextState.attemptsBudgetCount, 2);
});

test('E.7: REJECTED does not downgrade to re-running the parent plan', () => {
  const decision = authorizeTargetedAction(
    proposal({ requestedProviderScope: ['nope'] }),
    context(),
  );
  assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(decision.fallback, undefined);
  assert.equal(decision.downgraded, undefined);
  assert.equal(decision.rerunParentPlan, undefined);
});

test('E.5: authorization is deterministic for identical inputs', () => {
  const a = authorizeTargetedAction(proposal(), context());
  const b = authorizeTargetedAction(proposal(), context());
  assert.deepEqual(a, b);
});

test('F.2 resolveProviderScope returns canonical (sorted, deduplicated) descriptors', () => {
  const ok = resolveProviderScope({ plannedRoutes: PLANNED_ROUTES, requestedProviderScope: null });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.providerScope, SORTED_PLANNED_ROUTES);
  const bad = resolveProviderScope({ plannedRoutes: PLANNED_ROUTES, requestedProviderScope: ['x'] });
  assert.equal(bad.ok, false);
  assert.equal(bad.rejectionCode, REJECTION_PROVIDER_NOT_PLANNED);
});

test('F.2 the canonical membership tuple is exactly { capability, providerId }', () => {
  assert.deepEqual(PROVIDER_SCOPE_ENTRY_KEYS, ['capability', 'providerId']);
  assert.equal(Object.isFrozen(PROVIDER_SCOPE_ENTRY_KEYS), true);
});

test('F.2 canonicalizeProviderScope sorts, de-duplicates and rejects malformed scopes', () => {
  assert.deepEqual(
    canonicalizeProviderScope([...SORTED_PLANNED_ROUTES].reverse()),
    SORTED_PLANNED_ROUTES,
  );
  assert.deepEqual(canonicalizeProviderScope([{ capability: 'search', providerId: 'x' }]), [
    { providerId: 'x', capability: 'search' },
  ]);
  assert.throws(() => canonicalizeProviderScope([]));
  assert.throws(() => canonicalizeProviderScope([{ providerId: 'x', capability: 'capture' }]));
  assert.throws(() => canonicalizeProviderScope([
    { providerId: 'x', capability: 'search' },
    { providerId: 'x', capability: 'search' },
  ]));
});

test('F.1 the identity field set is frozen and exact', () => {
  assert.deepEqual(TARGETED_ACTION_ID_FIELDS, [
    'attempt', 'gapId', 'normalizedQuery', 'occurrenceId', 'planHash', 'providerScope', 'runId',
  ]);
  assert.equal(Object.isFrozen(TARGETED_ACTION_ID_FIELDS), true);
});

test('E.8: same-gap proposals are ordered deterministically by CONTENT, not by caller order', () => {
  const refA = proposal({ planOwnedStringRef: { field: 'queryVariants', index: 0 } });
  const refB = proposal({ planOwnedStringRef: { field: 'queryVariants', index: 1 } });
  const forward = authorizeTargetedActionBatch([refA, refB], context({ maxQueryBudget: 2 }));
  const reverse = authorizeTargetedActionBatch([refB, refA], context({ maxQueryBudget: 2 }));
  assert.deepEqual(
    forward.decisions.map((d) => d.query),
    reverse.decisions.map((d) => d.query),
    'the consumption order must not depend on the caller array order',
  );
  assert.equal(forward.decisions[0].status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(forward.decisions[1].rejectionCode, REJECTION_BUDGET_EXCEEDED);
});

test('E.6 casefold realisation is pinned (and matches the T01 sibling normaliser)', () => {
  // The frozen wording is "casefold"; the repo-wide realisation is
  // String.prototype.toLowerCase() after NFC. This pins the realised behaviour
  // (including its known full-casefold limitation for ß) instead of leaving it
  // implicit, and pins that T01 and T05 cannot drift apart on the shared value.
  assert.equal(normalizeQueryString('STRASSE'), 'strasse');
  assert.equal(normalizeQueryString('Straße'), 'straße');
  assert.equal(normalizeQueryString('ALPHA BETA'), 'alpha beta');
  assert.equal(normalizeSubjectString('ALPHA BETA'), normalizeQueryString('ALPHA BETA'));
  assert.equal(normalizeSubjectString('  Alpha   BETA '), normalizeQueryString('  Alpha   BETA '));
});

test('E.7: rejectionDetail never carries a T04 code outside the T04 closed set', () => {
  const codes = new Set();
  const cases = [
    proposal({ planOwnedStringRef: null, queryText: 'free form' }),
    proposal({ planOwnedStringRef: null }),
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 99 } }),
    proposal({ planOwnedStringRef: { field: 'nope', index: 0 } }),
    proposal({ gapId: `${'ff'.repeat(32)}:0` }),
  ];
  for (const p of cases) {
    const d = authorizeTargetedAction(p, context());
    assert.equal(d.status, AUTHORIZATION_STATUS_REJECTED);
    if (d.rejectionDetail !== null) {
      assert.equal(
        T04_REJECTION_CODES.includes(d.rejectionDetail),
        true,
        `rejectionDetail ${d.rejectionDetail} must be a T04-owned closed code`,
      );
      codes.add(d.rejectionDetail);
    }
  }
  assert.ok(codes.size >= 3, 'the sampled proposals must exercise several distinct T04 codes');
});

test('the typed error code is the module contract for caller wiring violations', () => {
  const badInputs = [
    () => authorizeTargetedAction(proposal(), context({ maxQueryBudget: 0 })),
    () => authorizeTargetedAction(proposal(), context({ maxAttemptsPerGap: 0 })),
    () => authorizeTargetedAction(proposal(), context({ plannedRoutes: 'nope' })),
    () => authorizeTargetedAction(proposal(), context({ attemptsBudgetCount: -1 })),
    () => authorizeTargetedAction(proposal(), context({ planHash: 'bad' })),
    () => computeDedupeKey({ gapIdentityCore: 'bad', normalizedQuery: 'x', providerScope: SCOPE_ONE }),
    () => canonicalizeProviderScope('nope'),
  ];
  for (const call of badInputs) {
    assert.throws(call, (err) => err.code === AUTHORIZATION_ERROR_INVALID);
  }
});

test('source guard: the module exports NO internal helper', async () => {
  const mod = await import('../lib/targeted-requery-authorization.mjs');
  for (const name of [
    'canonicalJson', 'sha256', 'isPlainObject', 'isNonEmptyString',
    'isPositiveInteger', 'hasExactKeys', 'requirePlanHash', 'plannedRouteUniverse',
    'normalizeAttemptIndex', 'decision', 'gapIdentityCoreOf',
  ]) {
    assert.equal(name in mod, false, `${name} must stay module-private`);
  }
});

test('S3 LEGAL_STATES: a T04 DROPPED and a T04 REJECTED both map to REJECTED, distinct in detail', () => {
  // S3 freezes this seam's legal states to { AUTHORIZED, REJECTED }, and lists
  // "gapId 不存在" as an ILLEGAL state — so a proposal with no resolvable parent
  // gap can only surface as REJECTED. The T04 distinction survives in the detail.
  const dropped = authorizeTargetedAction(proposal({ gapId: `${'ff'.repeat(32)}:0` }), context());
  const refused = authorizeTargetedAction(
    proposal({ planOwnedStringRef: null, queryText: 'free form' }),
    context(),
  );
  assert.equal(dropped.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(refused.status, AUTHORIZATION_STATUS_REJECTED);
  assert.equal(dropped.rejectionDetail, 'UNKNOWN_GAP_ID');
  assert.equal(refused.rejectionDetail, 'FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP');
  assert.notEqual(dropped.rejectionDetail, refused.rejectionDetail);
  assert.equal(dropped.targetedActionId, null);
  assert.equal(refused.targetedActionId, null);
});

// ===========================================================================
// FINAL CONVERGENCE (fix/p2a-t05-final-convergence) — F2 / F5 counterexamples
//
// Authority:
//   F2 — S3 FAIL_OPEN / FAIL_CLOSED = FAIL_CLOSED; the single-action path already
//        refuses malformed explicit budget state; a silent reset to 0 would
//        regrant the entire query budget (fail-OPEN) from corrupted state.
//   F5 — E.4: `intent` is "仅审计用"; E.8 / D12-5: model-supplied material must not
//        rank gaps or move budget. The batch tie-break must therefore be a
//        function of AUTHORIZATION-RELEVANT content only.
// ===========================================================================

test('F2: an explicitly invalid batch attemptsBudgetCount FAILS CLOSED (no silent budget reset)', () => {
  const invalid = [-1, 1.5, '3', null, Number.NaN, true, [], {}, 2n];
  for (const bad of invalid) {
    assert.throws(
      () => authorizeTargetedActionBatch([proposal()], context({ attemptsBudgetCount: bad })),
      (err) => err.code === AUTHORIZATION_ERROR_INVALID,
      `batch must REFUSE attemptsBudgetCount=${String(bad)} rather than resetting it to 0`,
    );
  }
});

test('F2: a MISSING batch attemptsBudgetCount keeps the documented zero default', () => {
  const ctx = context();
  delete ctx.attemptsBudgetCount;
  const result = authorizeTargetedActionBatch([proposal()], ctx);
  assert.equal(result.decisions[0].status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(result.nextState.attemptsBudgetCount, 2);
});

test('F2: the batch and single-action paths agree on malformed budget state', () => {
  for (const bad of [-1, 1.5, '3', null]) {
    assert.throws(
      () => authorizeTargetedAction(proposal(), context({ attemptsBudgetCount: bad })),
      (err) => err.code === AUTHORIZATION_ERROR_INVALID,
    );
    assert.throws(
      () => authorizeTargetedActionBatch([proposal()], context({ attemptsBudgetCount: bad })),
      (err) => err.code === AUTHORIZATION_ERROR_INVALID,
    );
  }
});

test('F2: a valid explicit batch attemptsBudgetCount is still honoured (no over-tightening)', () => {
  const result = authorizeTargetedActionBatch(
    [proposal()],
    context({ attemptsBudgetCount: 8, maxQueryBudget: 10 }),
  );
  assert.equal(result.decisions[0].status, AUTHORIZATION_STATUS_AUTHORIZED);
  assert.equal(result.nextState.attemptsBudgetCount, 10);
});

/** Two distinct plan-owned queries on the SAME gap, with only one budget slot. */
function twoQueryPlan() {
  return makePlan({ queryVariants: ['alpha beta', 'alpha gamma'] });
}

function runSameGapBatch(proposals) {
  return authorizeTargetedActionBatch(
    proposals,
    context({ plan: twoQueryPlan(), maxQueryBudget: 2, attemptsBudgetCount: 0 }),
  );
}

const authorizedQueries = (result) => result.decisions
  .filter((d) => d.status === AUTHORIZATION_STATUS_AUTHORIZED)
  .map((d) => d.query);

test('F5: changing ONLY the audit-only intent cannot change which query is authorized', () => {
  const first = runSameGapBatch([
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 0 }, intent: 'aaa' }),
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 1 }, intent: 'zzz' }),
  ]);
  const flipped = runSameGapBatch([
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 0 }, intent: 'zzz' }),
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 1 }, intent: 'aaa' }),
  ]);
  assert.deepEqual(authorizedQueries(first), authorizedQueries(flipped),
    'the audit-only intent must not select the authorized query');
  assert.deepEqual(
    first.decisions.map((d) => d.query),
    flipped.decisions.map((d) => d.query),
    'nor may it reorder the consumption sequence',
  );
  assert.deepEqual(authorizedQueries(first), ['alpha beta']);
});

test('F5: the same-gap tie-break is driven by authorization-relevant content', () => {
  const result = runSameGapBatch([
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 1 }, intent: 'aaa' }),
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 0 }, intent: 'zzz' }),
  ]);
  assert.deepEqual(authorizedQueries(result), ['alpha beta'],
    'planOwnedStringRef decides, regardless of the intent text');
});

test('F5: the inert queryText cannot control priority either', () => {
  const result = runSameGapBatch([
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 1 }, queryText: 'aaa' }),
    proposal({ planOwnedStringRef: { field: 'queryVariants', index: 0 }, queryText: 'zzz' }),
  ]);
  assert.deepEqual(authorizedQueries(result), ['alpha beta']);
});

test('F5: entries identical in authorization-relevant content denote the SAME action', () => {
  // Same gapId + same planOwnedStringRef + same scope => same normalizedQuery =>
  // same dedupeKey. Deleting either audit annotation cannot change WHAT is
  // authorized, only the position of two equivalent entries.
  const result = runSameGapBatch([
    proposal({ intent: 'aaa' }),
    proposal({ intent: 'zzz' }),
  ]);
  assert.equal(authorizedQueries(result).length, 1);
  assert.deepEqual(authorizedQueries(result), ['alpha beta']);
  const rejected = result.decisions.filter((d) => d.status === AUTHORIZATION_STATUS_REJECTED);
  assert.equal(rejected[0].rejectionCode, REJECTION_DEDUPE_ALREADY_AUTHORIZED);
});

// ===========================================================================
// fixtures sanity (guards the oracles themselves)
// ===========================================================================

test('fixture sanity: CORE_A is 64 hex and PLAN_HASH is 64 hex', () => {
  assert.match(CORE_A, /^[0-9a-f]{64}$/);
  assert.match(CORE_B, /^[0-9a-f]{64}$/);
  assert.match(PLAN_HASH, /^[0-9a-f]{64}$/);
});

test('source guard: the module performs no IO and owns no foreign lifecycle', () => {
  const src = fs.readFileSync(LIB_FILE, 'utf8');
  for (const forbidden of [
    "node:fs", "node:child_process", "node:net", "node:http", "node:https",
    "fetch(", "execSync", "spawnSync", "Date.now", "Math.random", "Date(",
    "executedRoutes", "plannedQueryVariants", "retrieval-round-controller",
  ]) {
    assert.equal(src.includes(forbidden), false, `module must not reference ${forbidden}`);
  }
});
