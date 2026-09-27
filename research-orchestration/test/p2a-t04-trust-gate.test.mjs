/**
 * research-orchestration/test/p2a-t04-trust-gate.test.mjs
 *
 * P2A-T04 (#116) focused tests — trust & string-safety gate.
 *
 * Authority (semantics are FROZEN; this suite must not reinterpret them):
 *   - docs/specs/p2-ari-f02-targeted-requery.md      §5 D3, §10            (STATUS = APPROVED)
 *   - docs/architecture/key-decisions.md             D12-3
 *   - docs/planning/..._SEAM_CONTRACT_V1.md          E.4 / E.5(1)(2)(3)(9) / F.3
 *   - docs/planning/..._SEAM_MAP_V1.md               S2
 *   - Issue #116 GOAL / ACCEPTANCE_CRITERIA 1–6 / REQUIRED_TESTS / COUNTEREXAMPLES C2, C3
 *
 * Anti-tautology discipline: the expected verdicts below are hand-written. The
 * two lens primitives are asserted directly against LITERAL expectations (they
 * are repo-owned P1 primitives this ticket does not modify, so asserting their
 * behaviour is a conformance check, not a restatement of the module under test).
 * No expected value is obtained by calling the module under test.
 *
 * T04 owns: proposal shape/parsing, gapId binding via an INJECTED existence
 * resolver, plan-owned string resolution, the dual-lens intersection gate,
 * trust-class judgement, the stable rejectionCode set, focused tests.
 * T04 explicitly does NOT own: ledger writing (T01), diagnosis (T03),
 * dedupeKey / attempt bound / budget / targetedActionId (T05), lifecycle and
 * durable commit (T06), resolution (T08), any retrieval IO, any
 * trustedPlanStrings extension.
 *
 * LENS MATRIX (mechanically re-verified against the P1 primitives):
 *   both PASS                     '大语言模型 Agent 落地争议'
 *   plan PASS / provider FAIL     '/etc/hosts 文件的作用'      (repo F8 evidence)
 *   plan PASS / provider FAIL     'https://user:pass@example.com/x'
 *   plan FAIL / provider PASS     'a'.repeat(350)              (> PLAN_MAX_STRING_LENGTH)
 *   both FAIL                     '/Users/alice/report.txt'
 *   both FAIL                     'token=abc123'
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPlanBoundarySafeString, PLAN_MAX_STRING_LENGTH } from '../lib/plan-contract.mjs';
import { isBoundarySafeString, BOUNDARY_MAX_STRING_LENGTH } from '../lib/rrf.mjs';

import {
  TRUST_CLASS_PLAN_OWNED,
  TRUST_CLASS_TARGETED_CONTROLLER_AUTHORIZED,
  TRUST_CLASS_UNCLASSIFIED,
  TRUST_CLASSES,
  PROPOSAL_STATUS_ADMITTED,
  PROPOSAL_STATUS_REJECTED,
  PROPOSAL_STATUS_DROPPED,
  REJECTION_CODES,
  REJECTION_MISSING_GAP_ID,
  REJECTION_UNKNOWN_GAP_ID,
  REJECTION_GAP_TYPE_NOT_IN_CLOSED_ENUM,
  REJECTION_MALFORMED_PROPOSAL,
  REJECTION_NO_QUERY_STRING_SOURCE,
  REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP,
  REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE,
  REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN,
  REJECTION_PLAN_OWNED_STRING_UNSAFE,
  REJECTION_TRUST_CLASS_UNCLASSIFIED,
  PLAN_OWNED_FIELDS,
  isPlanOwnedBoundarySafeString,
  classifyTrustClass,
  admitTargetedQueryString,
  enumeratePlanOwnedStrings,
  resolvePlanOwnedStringRef,
  parseTargetedQueryProposal,
  evaluateTargetedQueryProposal,
} from '../lib/targeted-requery-trust.mjs';

const MODULE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../lib/targeted-requery-trust.mjs',
);

// ---------------------------------------------------------------------------
// fixtures / literal expectations
// ---------------------------------------------------------------------------

/** 64 lowercase hex, literal (NOT produced by the module under test). */
const PLAN_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f809';
const OCCURRENCE_ID = 'occ-p2a-t04-fixture';
const GAP_CORE_ASPECT = '0123456789abcdeffedcba98765432100123456789abcdeffedcba9876543210';
const GAP_CORE_CONTRADICTION = '89abcdef89abcdef89abcdef89abcdef89abcdef89abcdef89abcdef89abcdef';
const GAP_CORE_AUTHORITY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const GAP_CORE_UNKNOWN = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const GAP_CORE_FORGED = '1111111111111111111111111111111111111111111111111111111111111111';

const GAP_ID_ASPECT = `${GAP_CORE_ASPECT}:0`;
const GAP_ID_UNKNOWN_TYPE = `${GAP_CORE_UNKNOWN}:1`;
const GAP_ID_FORGED = `${GAP_CORE_FORGED}:0`;

/**
 * A plan-shaped fixture of the same six conceptual field classes plan-contract
 * validates. `/etc/hosts 文件的作用` is deliberately present in `queryVariants`:
 * it is PLAN-LENS LEGAL (the plan contract accepts it) yet PROVIDER-LENS ILLEGAL,
 * so it is the live proof that the intersection is a real gate and not a
 * restatement of the plan lens.
 */
function makePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    queryVariants: [
      '大语言模型 Agent 落地争议',
      'LLM agent adoption debate',
      '/etc/hosts 文件的作用',
      'https://user:pass@example.com/x',
    ],
    aspects: ['技术成熟度', '行业落地现状'],
    entities: ['OpenAI', 'Anthropic'],
    opposingFramings: ['Agent 已可大规模落地', 'Agent 仍不成熟'],
    terminologyVariants: [
      { term: 'Agent', variants: ['智能体', '代理'] },
      { term: '长上下文', variants: ['long context'] },
    ],
    sourceGroupIntents: [
      { intent: '关注反方观点', constraints: ['权威来源优先', '排除论坛'], groupKey: null },
      { intent: '覆盖英文一手来源', constraints: [], groupKey: null },
    ],
    ...overrides,
  };
}

/**
 * The exact, literal PLAN_OWNED material set of `makePlan()` — written out by
 * hand from F.3 / D12-3 (queryVariants / opposingFramings / entities /
 * terminologyVariants.term|.variants / sourceGroupIntents.intent|.constraints).
 * `aspects` and `groupKey` are deliberately ABSENT: they are real plan fields
 * but outside the frozen PLAN_OWNED list. Order is intentionally NOT sorted here
 * so that the sortedness assertion below is a real assertion.
 */
const PLAN_OWNED_LITERAL = [
  '大语言模型 Agent 落地争议',
  'LLM agent adoption debate',
  '/etc/hosts 文件的作用',
  'https://user:pass@example.com/x',
  'Agent 已可大规模落地',
  'Agent 仍不成熟',
  'OpenAI',
  'Anthropic',
  'Agent',
  '智能体',
  '代理',
  '长上下文',
  'long context',
  '关注反方观点',
  '权威来源优先',
  '排除论坛',
  '覆盖英文一手来源',
];

/** The full E.5(1) gap universe available to the injected resolver. */
const GAPS = new Map([
  [GAP_ID_ASPECT, {
    gapId: GAP_ID_ASPECT,
    gapIdentityCore: GAP_CORE_ASPECT,
    gapType: 'ASPECT_GAP',
    occurrenceId: OCCURRENCE_ID,
    planHash: PLAN_HASH,
  }],
  [`${GAP_CORE_CONTRADICTION}:2`, {
    gapId: `${GAP_CORE_CONTRADICTION}:2`,
    gapIdentityCore: GAP_CORE_CONTRADICTION,
    gapType: 'CONTRADICTION_GAP',
    occurrenceId: OCCURRENCE_ID,
    planHash: PLAN_HASH,
  }],
  [`${GAP_CORE_AUTHORITY}:3`, {
    gapId: `${GAP_CORE_AUTHORITY}:3`,
    gapIdentityCore: GAP_CORE_AUTHORITY,
    gapType: 'AUTHORITY_GAP',
    occurrenceId: OCCURRENCE_ID,
    planHash: PLAN_HASH,
  }],
  [GAP_ID_UNKNOWN_TYPE, {
    gapId: GAP_ID_UNKNOWN_TYPE,
    gapIdentityCore: GAP_CORE_UNKNOWN,
    gapType: 'UNKNOWN_GAP_TYPE',
    occurrenceId: OCCURRENCE_ID,
    planHash: PLAN_HASH,
  }],
]);

/** Injected gap-existence resolver (E.4: "经注入的 gap 存在性解析器"). */
function makeResolver(gaps = GAPS) {
  return (gapId) => (gaps instanceof Map ? gaps.get(gapId) ?? null : gaps[gapId] ?? null);
}

/** Count every resolver consultation so zero-IO / no-speculation can be asserted. */
function countingResolver(gaps = GAPS) {
  const calls = [];
  return {
    calls,
    resolve: (gapId) => {
      calls.push(gapId);
      return gaps.get(gapId) ?? null;
    },
  };
}

const PLAN = makePlan();
const PLAN_OWNED = enumeratePlanOwnedStrings(PLAN);

function evaluate(proposal, { plan = PLAN, resolveGap = makeResolver() } = {}) {
  return evaluateTargetedQueryProposal(proposal, { plan, resolveGap });
}

// ===========================================================================
// 0. closed enum / constant surface
// ===========================================================================

test('trust class is a closed three-member enum (F.3)', () => {
  assert.deepEqual([...TRUST_CLASSES], [
    'PLAN_OWNED',
    'TARGETED_CONTROLLER_AUTHORIZED',
    'UNCLASSIFIED',
  ]);
  assert.equal(TRUST_CLASS_PLAN_OWNED, 'PLAN_OWNED');
  assert.equal(TRUST_CLASS_TARGETED_CONTROLLER_AUTHORIZED, 'TARGETED_CONTROLLER_AUTHORIZED');
  assert.equal(TRUST_CLASS_UNCLASSIFIED, 'UNCLASSIFIED');
  assert.ok(Object.isFrozen(TRUST_CLASSES));
});

test('the rejectionCode set is closed, frozen and machine-readable', () => {
  const expected = [
    'FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP',
    'GAP_TYPE_NOT_IN_CLOSED_ENUM',
    'MALFORMED_PROPOSAL',
    'MISSING_GAP_ID',
    'NO_QUERY_STRING_SOURCE',
    'PLAN_OWNED_REF_NOT_RESOLVABLE',
    'PLAN_OWNED_STRING_NOT_IN_PLAN',
    'PLAN_OWNED_STRING_UNSAFE',
    'TRUST_CLASS_UNCLASSIFIED',
    'UNKNOWN_GAP_ID',
  ];
  assert.deepEqual([...REJECTION_CODES], expected);
  assert.ok(Object.isFrozen(REJECTION_CODES));
  for (const code of REJECTION_CODES) {
    assert.match(code, /^[A-Z][A-Z0-9_]*$/);
  }
  // The one FROZEN name (E.4 MVP constraint / E.5(9)) must be spelled exactly.
  assert.equal(REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP, 'FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP');
  assert.equal(REJECTION_MISSING_GAP_ID, 'MISSING_GAP_ID');
  assert.equal(REJECTION_UNKNOWN_GAP_ID, 'UNKNOWN_GAP_ID');
  assert.equal(REJECTION_GAP_TYPE_NOT_IN_CLOSED_ENUM, 'GAP_TYPE_NOT_IN_CLOSED_ENUM');
  assert.equal(REJECTION_MALFORMED_PROPOSAL, 'MALFORMED_PROPOSAL');
  assert.equal(REJECTION_NO_QUERY_STRING_SOURCE, 'NO_QUERY_STRING_SOURCE');
  assert.equal(REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE, 'PLAN_OWNED_REF_NOT_RESOLVABLE');
  assert.equal(REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN, 'PLAN_OWNED_STRING_NOT_IN_PLAN');
  assert.equal(REJECTION_PLAN_OWNED_STRING_UNSAFE, 'PLAN_OWNED_STRING_UNSAFE');
  assert.equal(REJECTION_TRUST_CLASS_UNCLASSIFIED, 'TRUST_CLASS_UNCLASSIFIED');
});

test('proposal status is a closed three-member enum (E.4 DROP vs E.7 REJECTED)', () => {
  assert.equal(PROPOSAL_STATUS_ADMITTED, 'ADMITTED');
  assert.equal(PROPOSAL_STATUS_REJECTED, 'REJECTED');
  assert.equal(PROPOSAL_STATUS_DROPPED, 'DROPPED');
});

test('PLAN_OWNED_FIELDS is the closed F.3/D12-3 list and excludes `aspects`', () => {
  assert.deepEqual([...PLAN_OWNED_FIELDS], [
    'queryVariants',
    'opposingFramings',
    'entities',
    'terminologyVariants.term',
    'terminologyVariants.variants',
    'sourceGroupIntents.intent',
    'sourceGroupIntents.constraints',
  ]);
  assert.ok(Object.isFrozen(PLAN_OWNED_FIELDS));
  // F.3 / D12-3 / Issue #116 GOAL enumerate the same closed list with NO `aspects`.
  // E.4's mention of aspects occurs in a non-normative rationale sentence.
  assert.ok(!PLAN_OWNED_FIELDS.includes('aspects'));
});

// ===========================================================================
// 1. AC1 — admit(s) is the INTERSECTION of the two lenses
// ===========================================================================

test('the two lens primitives are non-identical: all four quadrants are reachable', () => {
  // Hand-written literal expectations, verified against the P1 primitives.
  const bothPass = '大语言模型 Agent 落地争议';
  const planPassProviderFail = '/etc/hosts 文件的作用'; // repo F8 evidence
  const planPassProviderFailUrl = 'https://user:pass@example.com/x';
  const planFailProviderPass = 'a'.repeat(350);
  const bothFailProfileRoot = '/Users/alice/report.txt';
  const bothFailCredential = 'token=abc123';

  assert.equal(isPlanBoundarySafeString(bothPass), true);
  assert.equal(isBoundarySafeString(bothPass), true);

  assert.equal(isPlanBoundarySafeString(planPassProviderFail), true);
  assert.equal(isBoundarySafeString(planPassProviderFail), false);

  assert.equal(isPlanBoundarySafeString(planPassProviderFailUrl), true);
  assert.equal(isBoundarySafeString(planPassProviderFailUrl), false);

  assert.equal(planFailProviderPass.length > PLAN_MAX_STRING_LENGTH, true);
  assert.equal(isPlanBoundarySafeString(planFailProviderPass), false);
  assert.equal(isBoundarySafeString(planFailProviderPass), true);

  assert.equal(isPlanBoundarySafeString(bothFailProfileRoot), false);
  assert.equal(isBoundarySafeString(bothFailProfileRoot), false);

  assert.equal(isPlanBoundarySafeString(bothFailCredential), false);
  assert.equal(isBoundarySafeString(bothFailCredential), false);

  // And the length bounds really are distinct, so "one lens is stricter" is false.
  assert.equal(PLAN_MAX_STRING_LENGTH < BOUNDARY_MAX_STRING_LENGTH, true);
});

test('AC1: admit is the intersection — every non-both-PASS quadrant is refused', () => {
  assert.equal(isPlanOwnedBoundarySafeString('大语言模型 Agent 落地争议'), true);

  // plan PASS / provider FAIL → refuse
  assert.equal(isPlanOwnedBoundarySafeString('/etc/hosts 文件的作用'), false);
  assert.equal(isPlanOwnedBoundarySafeString('https://user:pass@example.com/x'), false);
  assert.equal(isPlanOwnedBoundarySafeString('file:/etc/hosts'), false);

  // plan FAIL / provider PASS → refuse
  assert.equal(isPlanOwnedBoundarySafeString('a'.repeat(350)), false);

  // both FAIL → refuse
  assert.equal(isPlanOwnedBoundarySafeString('/Users/alice/report.txt'), false);
  assert.equal(isPlanOwnedBoundarySafeString('token=abc123'), false);
  assert.equal(isPlanOwnedBoundarySafeString('z_c0=xyz'), false);
});

test('AC1: admit is exactly (plan lens AND provider lens) for every probed input', () => {
  const probes = [
    '大语言模型 Agent 落地争议',
    '/etc/hosts 文件的作用',
    'https://user:pass@example.com/x',
    'file:/etc/hosts',
    'a'.repeat(350),
    '/Users/alice/report.txt',
    'token=abc123',
    'z_c0=xyz',
    '关注反方观点',
    'OpenAI',
    '智能体',
    '',
    '   ',
    'https://example.com/ok',
    '100% 纯文本',
    null,
    undefined,
    42,
    {},
    [],
  ];
  for (const probe of probes) {
    const expected = isPlanBoundarySafeString(probe) && isBoundarySafeString(probe);
    assert.equal(
      isPlanOwnedBoundarySafeString(probe),
      expected,
      `intersection mismatch for ${JSON.stringify(probe)}`,
    );
  }
});

test('AC1: admit is never satisfied by either lens alone (no OR, no single lens)', () => {
  const planOnly = '/etc/hosts 文件的作用';
  const providerOnly = 'a'.repeat(350);
  assert.equal(isBoundarySafeString(planOnly), false);
  assert.equal(isPlanOwnedBoundarySafeString(planOnly), false);
  assert.equal(isPlanBoundarySafeString(providerOnly), false);
  assert.equal(isPlanOwnedBoundarySafeString(providerOnly), false);
});

test('isPlanOwnedBoundarySafeString is total and never throws on hostile input', () => {
  const hostile = {
    toString() {
      throw new Error('hostile toString must never escape');
    },
  };
  assert.equal(isPlanOwnedBoundarySafeString(hostile), false);
  assert.equal(isPlanOwnedBoundarySafeString(() => {}), false);
  assert.equal(isPlanOwnedBoundarySafeString(Symbol('x')), false);
});

// ===========================================================================
// 2. trust class — PLAN_OWNED membership, TARGETED_* never open in MVP
// ===========================================================================

test('`aspects` is NOT PLAN_OWNED even though it is a real plan field', () => {
  const owned = enumeratePlanOwnedStrings(PLAN);
  assert.ok(owned.includes('大语言模型 Agent 落地争议'));
  assert.ok(owned.includes('智能体'));
  assert.ok(owned.includes('long context'));
  assert.ok(owned.includes('关注反方观点'));
  assert.ok(owned.includes('权威来源优先'));
  // aspects / groupKey are outside the frozen PLAN_OWNED list
  assert.ok(!owned.includes('技术成熟度'));
  assert.ok(!owned.includes('行业落地现状'));
});

test('enumeratePlanOwnedStrings returns exactly the literal PLAN_OWNED set', () => {
  const owned = enumeratePlanOwnedStrings(PLAN);
  assert.equal(owned.length, PLAN_OWNED_LITERAL.length);
  for (const s of PLAN_OWNED_LITERAL) {
    assert.ok(owned.includes(s), `missing PLAN_OWNED material: ${JSON.stringify(s)}`);
  }
});

test('enumeratePlanOwnedStrings output is sorted ascending and duplicate-free', () => {
  const owned = enumeratePlanOwnedStrings(PLAN);
  assert.deepEqual(owned, [...owned].sort());
  assert.equal(new Set(owned).size, owned.length);
  const dupPlan = makePlan({ entities: ['OpenAI', 'OpenAI'], queryVariants: ['OpenAI'] });
  const dupOwned = enumeratePlanOwnedStrings(dupPlan);
  assert.equal(dupOwned.filter((s) => s === 'OpenAI').length, 1);
});

test('enumeratePlanOwnedStrings is defensive about a missing/malformed plan', () => {
  assert.deepEqual(enumeratePlanOwnedStrings(null), []);
  assert.deepEqual(enumeratePlanOwnedStrings({}), []);
  assert.deepEqual(enumeratePlanOwnedStrings({ queryVariants: 'not-an-array' }), []);
  assert.deepEqual(enumeratePlanOwnedStrings({ terminologyVariants: [{}] }), []);
});

test('classifyTrustClass: plan material → PLAN_OWNED; anything else → UNCLASSIFIED', () => {
  for (const owned of PLAN_OWNED_LITERAL) {
    assert.equal(classifyTrustClass(owned, PLAN_OWNED), TRUST_CLASS_PLAN_OWNED, owned);
  }
  // Membership is the ONLY trust-class input on this MVP surface: even
  // provider-unsafe plan material is *classified* PLAN_OWNED (and then refused
  // by the safety gate, see AC4 below) — classification is not an admission.
  assert.equal(classifyTrustClass('/etc/hosts 文件的作用', PLAN_OWNED), TRUST_CLASS_PLAN_OWNED);
  assert.equal(classifyTrustClass('https://user:pass@example.com/x', PLAN_OWNED), TRUST_CLASS_PLAN_OWNED);

  for (const foreign of [
    '一个看起来完全安全的无关查询',
    'https://example.com/ok',
    '技术成熟度', // a real plan field, but not PLAN_OWNED
    '行业落地现状',
    'openai', // normalization variant, not the plan's bytes
    '',
  ]) {
    assert.equal(classifyTrustClass(foreign, PLAN_OWNED), TRUST_CLASS_UNCLASSIFIED, foreign);
  }
});

test('MVP: classifyTrustClass never returns TARGETED_CONTROLLER_AUTHORIZED', () => {
  const probes = [
    '智能体',
    '大语言模型 Agent 落地争议',
    '一个模型自己编出来的新查询',
    '/etc/hosts 文件的作用',
    '',
    null,
  ];
  for (const probe of probes) {
    assert.notEqual(classifyTrustClass(probe, PLAN_OWNED), TRUST_CLASS_TARGETED_CONTROLLER_AUTHORIZED);
  }
});

test('admitTargetedQueryString: PLAN_OWNED material must STILL pass both lenses', () => {
  // Plan-legal but provider-illegal → refused even though trustClass is PLAN_OWNED.
  const refused = admitTargetedQueryString('/etc/hosts 文件的作用', PLAN_OWNED);
  assert.equal(refused.admitted, false);
  assert.equal(refused.trustClass, TRUST_CLASS_PLAN_OWNED);
  assert.equal(refused.rejectionCode, REJECTION_PLAN_OWNED_STRING_UNSAFE);

  const refusedUrl = admitTargetedQueryString('https://user:pass@example.com/x', PLAN_OWNED);
  assert.equal(refusedUrl.admitted, false);
  assert.equal(refusedUrl.rejectionCode, REJECTION_PLAN_OWNED_STRING_UNSAFE);

  // Safe plan material → admitted as PLAN_OWNED.
  const ok = admitTargetedQueryString('智能体', PLAN_OWNED);
  assert.equal(ok.admitted, true);
  assert.equal(ok.trustClass, TRUST_CLASS_PLAN_OWNED);
  assert.equal(ok.rejectionCode, null);
});

test('admitTargetedQueryString: a safe string that is NOT plan material fails closed (C2)', () => {
  // C2 counterexample: "似是而非的无关查询" — safe but not plan-owned.
  const unrelated = '2026 年新能源汽车销量排行';
  assert.equal(isPlanOwnedBoundarySafeString(unrelated), true); // "safe" is not enough
  const verdict = admitTargetedQueryString(unrelated, PLAN_OWNED);
  assert.equal(verdict.admitted, false);
  assert.equal(verdict.trustClass, TRUST_CLASS_UNCLASSIFIED);
  assert.equal(verdict.rejectionCode, REJECTION_TRUST_CLASS_UNCLASSIFIED);
});

// ===========================================================================
// 3. E.4 — planOwnedStringRef resolution
// ===========================================================================

test('{field,index} resolves flat list fields to the plan’s own bytes', () => {
  const cases = [
    ['queryVariants', 0, '大语言模型 Agent 落地争议'],
    ['queryVariants', 3, 'https://user:pass@example.com/x'],
    ['opposingFramings', 1, 'Agent 仍不成熟'],
    ['entities', 0, 'OpenAI'],
    ['terminologyVariants.term', 0, 'Agent'],
    ['sourceGroupIntents.intent', 0, '关注反方观点'],
  ];
  for (const [field, index, expected] of cases) {
    const r = resolvePlanOwnedStringRef(PLAN, { field, index });
    assert.equal(r.ok, true, `${field}[${index}] should resolve`);
    assert.equal(r.value, expected);
  }
});

test('list-valued nested leaves require subIndex and resolve correctly', () => {
  const a = resolvePlanOwnedStringRef(PLAN, {
    field: 'terminologyVariants.variants',
    index: 0,
    subIndex: 1,
  });
  assert.equal(a.ok, true);
  assert.equal(a.value, '代理');

  const b = resolvePlanOwnedStringRef(PLAN, {
    field: 'sourceGroupIntents.constraints',
    index: 0,
    subIndex: 0,
  });
  assert.equal(b.ok, true);
  assert.equal(b.value, '权威来源优先');

  const c = resolvePlanOwnedStringRef(PLAN, {
    field: 'sourceGroupIntents.constraints',
    index: 1,
    subIndex: 0,
  });
  assert.equal(c.ok, false, 'empty constraints list has no entry 0');
  assert.equal(c.rejectionCode, REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);
});

test('subIndex is REQUIRED for list leaves and FORBIDDEN otherwise (strict shape)', () => {
  const missing = resolvePlanOwnedStringRef(PLAN, { field: 'terminologyVariants.variants', index: 0 });
  assert.equal(missing.ok, false);
  assert.equal(missing.rejectionCode, REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);

  const surplus = resolvePlanOwnedStringRef(PLAN, { field: 'entities', index: 0, subIndex: 0 });
  assert.equal(surplus.ok, false);
  assert.equal(surplus.rejectionCode, REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);
});

test('unknown field / unknown key / bad index / out-of-range all fail closed', () => {
  const bad = [
    { field: 'aspects', index: 0 }, // real plan field, NOT PLAN_OWNED
    { field: 'sourceGroupIntents.groupKey', index: 0 },
    { field: 'queryVariants[0]', index: 0 },
    { field: 'queryVariants', index: 0, extra: 1 },
    { field: 'queryVariants' },
    { index: 0 },
    { field: 'queryVariants', index: -1 },
    { field: 'queryVariants', index: 1.5 },
    { field: 'queryVariants', index: '0' },
    { field: 'queryVariants', index: 99 },
    { field: 'terminologyVariants.term', index: 99 },
    null,
    [],
  ];
  for (const ref of bad) {
    const r = resolvePlanOwnedStringRef(PLAN, ref);
    assert.equal(r.ok, false, `ref ${JSON.stringify(ref)} must not resolve`);
    assert.equal(r.rejectionCode, REJECTION_PLAN_OWNED_REF_NOT_RESOLVABLE);
    assert.equal(r.value, null);
  }
});

test('a bare string ref is the exact-string form, not a malformed object ref', () => {
  // 'queryVariants' is a well-formed *string*, so E.4's exact-string branch
  // applies: it must be adjudicated by membership (NOT_IN_PLAN), never by the
  // structured-ref code.
  const r = resolvePlanOwnedStringRef(PLAN, 'queryVariants');
  assert.equal(r.ok, false);
  assert.equal(r.rejectionCode, REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN);
});

test('the exact-string form is resolved by MEMBERSHIP, not trusted as-is', () => {
  // A real plan-owned string → resolvable.
  const ok = resolvePlanOwnedStringRef(PLAN, 'OpenAI');
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 'OpenAI');

  // A safe-looking string that is NOT plan material → NOT resolvable.
  const foreign = resolvePlanOwnedStringRef(PLAN, '2026 年新能源汽车销量排行');
  assert.equal(foreign.ok, false);
  assert.equal(foreign.rejectionCode, REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN);
});

test('membership is EXACT — normalization variants are not plan material (no widening)', () => {
  for (const variant of ['openai', ' Openai', 'OPENAI ', 'ＯｐｅｎＡＩ']) {
    const r = resolvePlanOwnedStringRef(PLAN, variant);
    assert.equal(r.ok, false, `${JSON.stringify(variant)} must not match 'OpenAI'`);
    assert.equal(r.rejectionCode, REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN);
  }
});

// ===========================================================================
// 4. E.4 — proposal shape / parsing
// ===========================================================================

test('parseTargetedQueryProposal accepts the frozen proposal shape', () => {
  const r = parseTargetedQueryProposal({
    gapId: GAP_ID_ASPECT,
    planOwnedStringRef: { field: 'entities', index: 0 },
    requestedProviderScope: ['official-search'],
    intent: '补齐实体覆盖',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.proposal, {
    gapId: GAP_ID_ASPECT,
    planOwnedStringRef: { field: 'entities', index: 0 },
    queryText: null,
    requestedProviderScope: ['official-search'],
    intent: '补齐实体覆盖',
  });
});

test('parseTargetedQueryProposal rejects unknown keys and wrong types (strict, fail closed)', () => {
  const bad = [
    null,
    undefined,
    'proposal',
    [],
    { gapId: GAP_ID_ASPECT, unknownField: 1 },
    { gapId: GAP_ID_ASPECT, planOwnedStringRef: { field: 'entities', index: 0 }, extra: true },
    { gapId: 42, planOwnedStringRef: 'OpenAI' },
    { gapId: GAP_ID_ASPECT, queryText: 42 },
    { gapId: GAP_ID_ASPECT, requestedProviderScope: 'official-search' },
    { gapId: GAP_ID_ASPECT, requestedProviderScope: [42] },
    { gapId: GAP_ID_ASPECT, requestedProviderScope: [''] },
    { gapId: GAP_ID_ASPECT, requestedProviderScope: ['   '] },
    { gapId: GAP_ID_ASPECT, requestedProviderScope: ['token=abc'] },
    { gapId: GAP_ID_ASPECT, intent: 42 },
    { gapId: GAP_ID_ASPECT, intent: 'token=abc' },
    { gapId: GAP_ID_ASPECT, planOwnedStringRef: 42 },
  ];
  for (const raw of bad) {
    const r = parseTargetedQueryProposal(raw);
    assert.equal(r.ok, false, `raw ${JSON.stringify(raw)} must be refused`);
    assert.equal(r.rejectionCode, REJECTION_MALFORMED_PROPOSAL);
  }
});

test('gapId key-presence is an E.4 BINDING outcome (DROP), not a parse error', () => {
  // A shape-valid proposal with no gapId parses; the binding step drops it.
  const parsed = parseTargetedQueryProposal({ planOwnedStringRef: 'OpenAI' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.proposal.gapId, null);
  const r = evaluate({ planOwnedStringRef: 'OpenAI' });
  assert.equal(r.status, PROPOSAL_STATUS_DROPPED);
  assert.equal(r.rejectionCode, REJECTION_MISSING_GAP_ID);
});

test('E.4: neither queryText nor planOwnedStringRef present → NO_QUERY_STRING_SOURCE', () => {
  const r = evaluate({ gapId: GAP_ID_ASPECT });
  assert.equal(r.status, PROPOSAL_STATUS_REJECTED);
  assert.equal(r.rejectionCode, REJECTION_NO_QUERY_STRING_SOURCE);
  assert.equal(r.query, null);
});

// ===========================================================================
// 5. E.4 MVP constraint / E.5(9) — queryText is never an authorization source
// ===========================================================================

test('AC2: queryText-only proposal → REJECTED + FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP', () => {
  const r = evaluate({ gapId: GAP_ID_ASPECT, queryText: 'Agent 落地的反对意见有哪些' });
  assert.equal(r.status, PROPOSAL_STATUS_REJECTED);
  assert.equal(r.rejectionCode, REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP);
  assert.equal(r.query, null);
  assert.equal(r.querySource, null);
});

test('AC2/C2: a SAFE but free-form queryText is still refused (safety != authorization)', () => {
  const safeFreeForm = '有关 Agent 成熟度的反面证据';
  assert.equal(isPlanOwnedBoundarySafeString(safeFreeForm), true);
  const r = evaluate({ gapId: GAP_ID_ASPECT, queryText: safeFreeForm });
  assert.equal(r.status, PROPOSAL_STATUS_REJECTED);
  assert.equal(r.rejectionCode, REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP);
});

test('an UNSAFE queryText is refused with the same frozen MVP code (never a trust path)', () => {
  const r = evaluate({ gapId: GAP_ID_ASPECT, queryText: 'https://user:pass@example.com/x' });
  assert.equal(r.status, PROPOSAL_STATUS_REJECTED);
  assert.equal(r.rejectionCode, REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP);
});

test('E.4 precedence: when BOTH are present, planOwnedStringRef wins and queryText is inert', () => {
  const r = evaluate({
    gapId: GAP_ID_ASPECT,
    queryText: '模型自由编造的查询',
    planOwnedStringRef: { field: 'entities', index: 1 },
  });
  assert.equal(r.status, PROPOSAL_STATUS_ADMITTED);
  assert.equal(r.query, 'Anthropic');
  assert.equal(r.querySource, 'planOwnedStringRef');
  assert.notEqual(r.query, '模型自由编造的查询');
  // The inadmissible free text must not leak into the admitted decision.
  assert.equal(JSON.stringify(r).includes('模型自由编造的查询'), false);
});

// ===========================================================================
// 6. E.5(1) — gapId binding
// ===========================================================================

test('E.4: missing gapId → DROPPED (no inference, no new gap)', () => {
  for (const raw of [
    { planOwnedStringRef: { field: 'entities', index: 0 } },
    { gapId: null, planOwnedStringRef: { field: 'entities', index: 0 } },
    { gapId: '', planOwnedStringRef: { field: 'entities', index: 0 } },
  ]) {
    const r = evaluate(raw);
    assert.equal(r.status, PROPOSAL_STATUS_DROPPED, JSON.stringify(raw));
    assert.equal(r.rejectionCode, REJECTION_MISSING_GAP_ID);
    assert.equal(r.query, null);
  }
});

test('E.4: an unknown/malformed gapId → DROPPED, never a guessed core', () => {
  for (const gapId of [
    GAP_ID_FORGED,
    'not-a-gap-id',
    `${GAP_CORE_ASPECT}:`, // no round
    `${GAP_CORE_ASPECT.toUpperCase()}:0`, // uppercase core is not an E.2 gapId
    'x'.repeat(64) + ':0',
  ]) {
    const r = evaluate({ gapId, planOwnedStringRef: { field: 'entities', index: 0 } });
    assert.equal(r.status, PROPOSAL_STATUS_DROPPED, `gapId ${gapId}`);
    assert.equal(r.rejectionCode, REJECTION_UNKNOWN_GAP_ID);
    assert.equal(r.gapIdentityCore, null);
  }
});

test('E.4: a resolver answer whose gapId does not match exactly fails closed', () => {
  const r = evaluate(
    { gapId: GAP_ID_ASPECT, planOwnedStringRef: { field: 'entities', index: 0 } },
    {
      resolveGap: () => ({
        gapId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0',
        gapType: 'ASPECT_GAP',
      }),
    },
  );
  assert.equal(r.status, PROPOSAL_STATUS_DROPPED);
  assert.equal(r.rejectionCode, REJECTION_UNKNOWN_GAP_ID);
});

test('E.5(1): a gapType outside the E.1 closed enum cannot become a retrieval action', () => {
  const r = evaluate({
    gapId: GAP_ID_UNKNOWN_TYPE,
    planOwnedStringRef: { field: 'entities', index: 0 },
  });
  assert.equal(r.status, PROPOSAL_STATUS_REJECTED);
  assert.equal(r.rejectionCode, REJECTION_GAP_TYPE_NOT_IN_CLOSED_ENUM);
  assert.equal(r.query, null);
});

test('E.5(1): all three closed gap types are acceptable parents', () => {
  for (const gapId of [
    GAP_ID_ASPECT,
    `${GAP_CORE_CONTRADICTION}:2`,
    `${GAP_CORE_AUTHORITY}:3`,
  ]) {
    const r = evaluate({ gapId, planOwnedStringRef: { field: 'entities', index: 0 } });
    assert.equal(r.status, PROPOSAL_STATUS_ADMITTED, gapId);
    assert.equal(r.gapId, gapId);
  }
});

test('the admitted decision carries the gapIdentityCore, never the round-bearing gapId, as identity', () => {
  const r = evaluate({
    gapId: `${GAP_CORE_CONTRADICTION}:2`,
    planOwnedStringRef: { field: 'entities', index: 0 },
  });
  assert.equal(r.status, PROPOSAL_STATUS_ADMITTED);
  assert.equal(r.gapId, `${GAP_CORE_CONTRADICTION}:2`);
  assert.equal(r.gapIdentityCore, GAP_CORE_CONTRADICTION);
  assert.equal(r.gapIdentityCore.includes(':'), false);
});

// ===========================================================================
// 7. C3 / AC4 — provider-like content never becomes trusted
// ===========================================================================

test('C3: plan-owned material carrying provider-like unsafe content is refused', () => {
  const cases = [
    { field: 'queryVariants', index: 2 }, // '/etc/hosts 文件的作用' (plan-legal, provider-illegal)
    { field: 'queryVariants', index: 3 }, // 'https://user:pass@example.com/x'
    '/etc/hosts 文件的作用',
    'https://user:pass@example.com/x',
  ];
  for (const ref of cases) {
    const r = evaluate({ gapId: GAP_ID_ASPECT, planOwnedStringRef: ref });
    assert.equal(r.status, PROPOSAL_STATUS_REJECTED, JSON.stringify(ref));
    assert.equal(r.rejectionCode, REJECTION_PLAN_OWNED_STRING_UNSAFE);
    assert.equal(r.query, null);
    assert.equal(r.trustClass, TRUST_CLASS_PLAN_OWNED);
  }
});

test('C3: a hostile plan cannot smuggle a credential-shaped string through the gate', () => {
  const hostilePlan = makePlan({ entities: ['token=abc123'] });
  const owned = enumeratePlanOwnedStrings(hostilePlan);
  assert.ok(owned.includes('token=abc123'), 'membership is a plan fact, not a safety fact');
  const r = evaluateTargetedQueryProposal(
    { gapId: GAP_ID_ASPECT, planOwnedStringRef: 'token=abc123' },
    { plan: hostilePlan, resolveGap: makeResolver() },
  );
  assert.equal(r.status, PROPOSAL_STATUS_REJECTED);
  assert.equal(r.rejectionCode, REJECTION_PLAN_OWNED_STRING_UNSAFE);
});

test('AC4: plan-owned material is RE-JUDGED every time (plan provenance is not an exemption)', () => {
  // Same string, two plans: safe in one, provider-unsafe in the other — the
  // verdict must follow the STRING, never the fact that it came from a plan.
  const unsafe = '/etc/hosts 文件的作用';
  const safePlan = makePlan({ queryVariants: ['大语言模型 Agent 落地争议'] });
  const unsafePlan = makePlan({ queryVariants: [unsafe] });

  const fromSafePlan = evaluateTargetedQueryProposal(
    { gapId: GAP_ID_ASPECT, planOwnedStringRef: unsafe },
    { plan: safePlan, resolveGap: makeResolver() },
  );
  assert.equal(fromSafePlan.status, PROPOSAL_STATUS_REJECTED);
  assert.equal(fromSafePlan.rejectionCode, REJECTION_PLAN_OWNED_STRING_NOT_IN_PLAN);

  const fromUnsafePlan = evaluateTargetedQueryProposal(
    { gapId: GAP_ID_ASPECT, planOwnedStringRef: unsafe },
    { plan: unsafePlan, resolveGap: makeResolver() },
  );
  assert.equal(fromUnsafePlan.status, PROPOSAL_STATUS_REJECTED);
  assert.equal(fromUnsafePlan.rejectionCode, REJECTION_PLAN_OWNED_STRING_UNSAFE);
});

// ===========================================================================
// 8. zero IO / no resolver speculation / determinism
// ===========================================================================

test('a refused proposal never consults more than the one gapId it was given', () => {
  const counter = countingResolver();
  evaluate(
    { gapId: GAP_ID_ASPECT, queryText: 'free form' },
    { resolveGap: counter.resolve },
  );
  assert.deepEqual(counter.calls, [GAP_ID_ASPECT]);
});

test('a malformed proposal never touches the gap resolver at all', () => {
  const counter = countingResolver();
  for (const raw of [null, {}, { gapId: GAP_ID_ASPECT, bogus: 1 }]) {
    evaluateTargetedQueryProposal(raw, { plan: PLAN, resolveGap: counter.resolve });
  }
  assert.deepEqual(counter.calls, []);
});

test('evaluation performs no network IO (global fetch is never touched)', () => {
  const original = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => {
    called += 1;
    throw new Error('network IO is forbidden on the trust gate');
  };
  try {
    evaluate({ gapId: GAP_ID_ASPECT, planOwnedStringRef: { field: 'entities', index: 0 } });
    evaluate({ gapId: GAP_ID_ASPECT, queryText: 'free' });
    evaluate({ gapId: GAP_ID_FORGED, planOwnedStringRef: 'OpenAI' });
    admitTargetedQueryString('智能体', PLAN_OWNED);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(called, 0);
});

test('the decision object has a deterministic, fixed key set and no timestamp/random', () => {
  const r = evaluate({ gapId: GAP_ID_ASPECT, planOwnedStringRef: { field: 'entities', index: 0 } });
  assert.deepEqual(Object.keys(r).sort(), [
    'gapId',
    'gapIdentityCore',
    'query',
    'querySource',
    'rejectionCode',
    'requestedProviderScope',
    'status',
    'trustClass',
  ]);

  const a = evaluate({ gapId: GAP_ID_ASPECT, planOwnedStringRef: { field: 'entities', index: 0 } });
  const b = evaluate({ gapId: GAP_ID_ASPECT, planOwnedStringRef: { field: 'entities', index: 0 } });
  assert.deepEqual(a, b);
});

test('the same string yields the same verdict regardless of the proposal that carried it', () => {
  const viaRef = evaluate({ gapId: GAP_ID_ASPECT, planOwnedStringRef: 'OpenAI' });
  const viaIndex = evaluate({ gapId: GAP_ID_ASPECT, planOwnedStringRef: { field: 'entities', index: 0 } });
  assert.equal(viaRef.status, PROPOSAL_STATUS_ADMITTED);
  assert.deepEqual(viaRef, viaIndex);
});

// ===========================================================================
// 9. AC6 — no trustedPlanStrings widening, no artifact-walk coupling, no IO imports
// ===========================================================================

test('AC6: the module never mentions trustedPlanStrings and never calls the artifact walk', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(source.includes('trustedPlanStrings'), false);
  assert.equal(source.includes('assertArtifactSafe'), false);
  assert.equal(source.includes('plannedQueryVariants'), false);
});

test('the trust gate is stateless: it imports no IO module directly', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  for (const forbidden of [
    'node:fs',
    'node:fs/promises',
    'node:child_process',
    'node:http',
    'node:https',
    'node:net',
    'node:dgram',
    'node:worker_threads',
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected import: ${forbidden}`);
  }
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/XMLHttpRequest/.test(source), false);
});

test('the trust gate is deterministic by construction: no clock, no randomness', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(source.includes('Date.now'), false);
  assert.equal(source.includes('Math.random'), false);
  assert.equal(source.includes('new Date('), false);
});

test('the trust gate imports ONLY the two lens modules and the T01 identity contract', () => {
  // A precise, checkable claim: the DIRECT import list is exactly the frozen
  // authority set — no IO module, no provider/retrieval module. A transitive
  // closure assertion would be unsound here: the provider lens itself lives in
  // rrf.mjs, which legitimately imports the provider-seam constant module.
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const relative = [];
  const re = /from\s+'(\.[^']+)'/g;
  let m;
  while ((m = re.exec(source)) !== null) relative.push(m[1]);
  assert.deepEqual(relative, [
    './plan-contract.mjs',
    './rrf.mjs',
    './targeted-requery-ledger.mjs',
  ]);
});
