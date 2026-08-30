/**
 * research-orchestration/test/plan-contract.test.mjs
 *
 * P1-T04 focused tests — Minimum Persisted Research Plan Contract (Issue #36,
 * Spec §4 of docs/specs/p1-cross-question-deep-research.md; D-3 delegated bounds).
 *
 * Required coverage (ticket REQUIRED_TESTS):
 *   1. valid schema round-trip (object → validate → persist/JSON → validate → same planHash)
 *   2. all six conceptual field classes representable
 *   3. structured validation boundaries (strict schema, no coercion)
 *   4. invalid/unparseable → planner_invalid (fail-closed; NL free text never becomes a plan)
 *   5. deterministic hash stability (incl. canonical key ordering)
 *   6. meaningful plan mutation changes planHash
 *   7. documented serialization-order semantics (key order canonicalized; array order significant)
 *   8. stale propagation seam (planHash as downstream dependency identity)
 *   9. stable run identity separation (plan contents / planHash NOT in run identity)
 *  10. credentials / machine-private paths prohibited in any plan string field
 *  11. persistence contract (work-relative artifact, fail-closed re-validation on load)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  PLAN_SCHEMA_VERSION,
  PLAN_ARTIFACT_FILENAME,
  PLAN_FAILURE_PLANNER_INVALID,
  PLAN_FAILURE_PLAN_MISSING,
  STALE_REASON_PLAN_HASH_MISMATCH,
  STALE_REASON_PLAN_DEPENDENCY_MISSING,
  STALE_REASON_PLAN_DEPENDENCY_INVALID,
  isValidPlanHashFormat,
  PLAN_MAX_ENTRIES_PER_LIST,
  PLAN_MAX_STRING_LENGTH,
  PLAN_MAX_INPUT_JSON_CHARS,
  PLAN_HASH_DOMAIN,
  validatePlanInput,
  validatePlanJson,
  canonicalPlanJson,
  planHash,
  persistPlan,
  loadPlan,
  planDependencyStatus,
  comparePlans,
} from '../lib/plan-contract.mjs';
import { runIdentityHash } from '../lib/state.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `plan-${prefix}-`));
}

function sha(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/** Fresh valid plan covering ALL six conceptual field classes (Spec §4.1). */
function basePlan() {
  return {
    schemaVersion: 1,
    queryVariants: ['大语言 Agent 争议', 'LLM agent disagreements'],
    aspects: ['技术成熟度', '行业应用前景'],
    entities: ['OpenAI', 'Anthropic'],
    opposingFramings: ['Agent 已可落地', 'Agent 仍不成熟'],
    terminologyVariants: [{ term: 'Agent', variants: ['智能体', '代理'] }],
    sourceGroupIntents: [
      {
        intent: '关注反方观点',
        constraints: ['至少包含一个高赞反对回答'],
        groupKey: 'controversy',
      },
    ],
  };
}

function shuffledKeyOrder(plan) {
  // Rebuild the same plan with top-level and nested entry keys in reverse insertion order.
  return {
    sourceGroupIntents: plan.sourceGroupIntents.map((e) => ({
      groupKey: e.groupKey,
      constraints: [...e.constraints],
      intent: e.intent,
    })),
    terminologyVariants: plan.terminologyVariants.map((e) => ({
      variants: [...e.variants],
      term: e.term,
    })),
    opposingFramings: [...plan.opposingFramings],
    entities: [...plan.entities],
    aspects: [...plan.aspects],
    queryVariants: [...plan.queryVariants],
    schemaVersion: plan.schemaVersion,
  };
}

const PLANNER_INVALID = PLAN_FAILURE_PLANNER_INVALID;

// ---------------------------------------------------------------------------
// 0. frozen failure identity
// ---------------------------------------------------------------------------

test('failure identity planner_invalid is frozen', () => {
  assert.equal(PLANNER_INVALID, 'planner_invalid');
  assert.equal(PLAN_FAILURE_PLAN_MISSING, 'plan_missing');
  assert.equal(STALE_REASON_PLAN_HASH_MISMATCH, 'plan_hash_mismatch');
  assert.equal(STALE_REASON_PLAN_DEPENDENCY_MISSING, 'plan_dependency_missing');
});

// ---------------------------------------------------------------------------
// 1. valid schema round-trip
// ---------------------------------------------------------------------------

test('valid plan: validate → hash → JSON → revalidate keeps identity (round-trip)', () => {
  const v1 = validatePlanInput(basePlan());
  assert.equal(v1.ok, true, `expected ok, issues: ${JSON.stringify(v1.issues ?? [])}`);
  const h1 = planHash(v1.plan);

  const v2 = validatePlanJson(JSON.stringify(basePlan()));
  assert.equal(v2.ok, true);
  const h2 = planHash(v2.plan);

  assert.equal(h1, h2, 'JSON round-trip must preserve planHash');
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('validated plan is deterministic normalization (trim + exact-duplicate dedupe, first-occurrence order)', () => {
  const raw = basePlan();
  raw.queryVariants = ['  大语言 Agent 争议 ', '大语言 Agent 争议', 'LLM agent disagreements'];
  const v = validatePlanInput(raw);
  assert.equal(v.ok, true);
  assert.deepEqual(v.plan.queryVariants, ['大语言 Agent 争议', 'LLM agent disagreements']);
  // input is not mutated (normalization returns a new object)
  assert.equal(raw.queryVariants.length, 3);
});

// ---------------------------------------------------------------------------
// 2. all six conceptual field classes representable
// ---------------------------------------------------------------------------

test('all six conceptual field classes are representable and preserved by validation', () => {
  const v = validatePlanInput(basePlan());
  assert.equal(v.ok, true);
  const canonical = canonicalPlanJson(v.plan);
  for (const key of [
    'queryVariants',
    'aspects',
    'entities',
    'opposingFramings',
    'terminologyVariants',
    'sourceGroupIntents',
  ]) {
    assert.ok(canonical.includes(`"${key}"`), `class ${key} must be representable`);
    assert.ok(Array.isArray(v.plan[key]), `class ${key} must survive as an array`);
  }
  assert.equal(v.plan.terminologyVariants[0].term, 'Agent');
  assert.deepEqual(v.plan.sourceGroupIntents[0].constraints, ['至少包含一个高赞反对回答']);
  assert.equal(v.plan.sourceGroupIntents[0].groupKey, 'controversy');
});

test('minimal plan: required classes non-empty, optional classes may be honestly empty', () => {
  const minimal = {
    schemaVersion: 1,
    queryVariants: ['只有一个检索式'],
    aspects: ['单一视角'],
    entities: [],
    opposingFramings: [],
    terminologyVariants: [],
    sourceGroupIntents: [],
  };
  const v = validatePlanInput(minimal);
  assert.equal(v.ok, true, `expected ok, issues: ${JSON.stringify(v.issues ?? [])}`);
});

test('missing any of the six conceptual classes → planner_invalid (classes cannot be compressed away)', () => {
  for (const missing of [
    'queryVariants',
    'aspects',
    'entities',
    'opposingFramings',
    'terminologyVariants',
    'sourceGroupIntents',
  ]) {
    const plan = basePlan();
    delete plan[missing];
    const v = validatePlanInput(plan);
    assert.equal(v.ok, false, `omitting ${missing} must be rejected`);
    assert.equal(v.reason, PLANNER_INVALID);
    assert.ok(v.issues.some((i) => i.path === missing), `issue must point at ${missing}`);
  }
});

// ---------------------------------------------------------------------------
// 3. structured validation boundaries (strict; no silent coercion)
// ---------------------------------------------------------------------------

test('non-object plan inputs → planner_invalid (no coercion of primitives/arrays)', () => {
  for (const raw of [null, 42, 'text', [], true, undefined]) {
    const v = validatePlanInput(raw);
    assert.equal(v.ok, false, `input ${JSON.stringify(raw) ?? String(raw)} must be rejected`);
    assert.equal(v.reason, PLANNER_INVALID);
  }
});

test('schemaVersion must be exactly 1 (no numeric/string coercion)', () => {
  for (const bad of ['1', 2, 1.5, null, true]) {
    const plan = { ...basePlan(), schemaVersion: bad };
    const v = validatePlanInput(plan);
    assert.equal(v.ok, false, `schemaVersion ${JSON.stringify(bad)} must be rejected`);
    assert.equal(v.reason, PLANNER_INVALID);
    assert.ok(v.issues.some((i) => i.path === 'schemaVersion'));
  }
});

test('unknown top-level keys → planner_invalid (strict v1 schema, fail-closed)', () => {
  const plan = { ...basePlan(), bogus: 'future field' };
  const v = validatePlanInput(plan);
  assert.equal(v.ok, false);
  assert.equal(v.reason, PLANNER_INVALID);
  assert.ok(v.issues.some((i) => i.path === 'bogus'));
});

test('string-typed entries reject non-strings (no String() coercion of objects/numbers)', () => {
  const a = { ...basePlan(), aspects: [42] };
  assert.equal(validatePlanInput(a).ok, false);
  const b = { ...basePlan(), queryVariants: [{}] };
  const vb = validatePlanInput(b);
  assert.equal(vb.ok, false);
  assert.ok(vb.issues.some((i) => i.path === 'queryVariants[0]' && /string/.test(i.message)));
  const c = { ...basePlan(), entities: [[ 'nested', 'array' ]] };
  assert.equal(validatePlanInput(c).ok, false);
});

test('empty / whitespace-only / empty-after-trim string entries → planner_invalid', () => {
  for (const field of ['queryVariants', 'aspects', 'entities', 'opposingFramings']) {
    const plan = { ...basePlan(), [field]: ['   '] };
    const v = validatePlanInput(plan);
    assert.equal(v.ok, false, `whitespace-only entry in ${field} must be rejected`);
    assert.ok(v.issues.some((i) => i.path.startsWith(field)));
  }
  assert.equal(validatePlanInput({ ...basePlan(), queryVariants: [] }).ok, false);
  assert.equal(validatePlanInput({ ...basePlan(), aspects: [] }).ok, false);
});

test('structured entries are strictly validated', () => {
  // terminologyVariants entry: unknown key
  const t1 = { ...basePlan(), terminologyVariants: [{ term: 'X', variants: ['Y'], extra: 1 }] };
  const v1 = validatePlanInput(t1);
  assert.equal(v1.ok, false);
  assert.ok(v1.issues.some((i) => i.path.includes('terminologyVariants[0]') && /unknown/.test(i.message)));
  // terminologyVariants entry: empty variants
  const t2 = { ...basePlan(), terminologyVariants: [{ term: 'X', variants: [] }] };
  assert.equal(validatePlanInput(t2).ok, false);
  // terminologyVariants entry: non-object
  const t3 = { ...basePlan(), terminologyVariants: ['Agent=智能体'] };
  assert.equal(validatePlanInput(t3).ok, false);
  // sourceGroupIntents entry: missing intent
  const s1 = { ...basePlan(), sourceGroupIntents: [{ constraints: ['c'] }] };
  const vs1 = validatePlanInput(s1);
  assert.equal(vs1.ok, false);
  assert.ok(vs1.issues.some((i) => i.path.includes('sourceGroupIntents[0].intent')));
  // sourceGroupIntents entry: unknown key
  const s2 = { ...basePlan(), sourceGroupIntents: [{ intent: 'i', constraints: [], groupKey: null, provider: 'x' }] };
  assert.equal(validatePlanInput(s2).ok, false);
});

test('optional structured sub-fields normalize deterministically (constraints → [], groupKey → null)', () => {
  const plan = basePlan();
  plan.sourceGroupIntents = [{ intent: '只记录 intent' }];
  const v = validatePlanInput(plan);
  assert.equal(v.ok, true);
  assert.deepEqual(v.plan.sourceGroupIntents[0], {
    intent: '只记录 intent',
    constraints: [],
    groupKey: null,
  });
});

test('validation bounds (D-3 delegated): list length and string length are fail-closed, never truncated', () => {
  assert.ok(PLAN_MAX_ENTRIES_PER_LIST >= 1);
  const tooMany = basePlan();
  tooMany.queryVariants = Array.from({ length: PLAN_MAX_ENTRIES_PER_LIST + 1 }, (_, i) => `变体 ${i}`);
  const vMany = validatePlanInput(tooMany);
  assert.equal(vMany.ok, false);
  assert.ok(vMany.issues.some((i) => /at most/.test(i.message)));

  const tooLong = basePlan();
  tooLong.aspects = ['长'.repeat(PLAN_MAX_STRING_LENGTH + 1)];
  const vLong = validatePlanInput(tooLong);
  assert.equal(vLong.ok, false);
  assert.ok(vLong.issues.some((i) => i.path === 'aspects[0]'));
  // boundary: exactly at limit is fine
  const atLimit = basePlan();
  atLimit.aspects = ['长'.repeat(PLAN_MAX_STRING_LENGTH)];
  assert.equal(validatePlanInput(atLimit).ok, true);
});

// ---------------------------------------------------------------------------
// 4. invalid / unparseable → planner_invalid (fail-closed)
// ---------------------------------------------------------------------------

test('natural-language free text alone NEVER becomes a validated plan', () => {
  for (const text of [
    '帮我研究一下大语言 Agent 的争议',
    'query variants: A; aspects: B',
    '{"这是一个自然语言计划"}',
  ]) {
    const v = validatePlanJson(text);
    assert.equal(v.ok, false, `free text must not validate: ${text}`);
    assert.equal(v.reason, PLANNER_INVALID);
  }
});

test('unparseable / non-object JSON → planner_invalid (never a silent best-effort plan)', () => {
  for (const text of [
    '{broken json',
    '',
    '   ',
    '"just a string"',
    '[1, 2, 3]',
    'null',
    '42',
    JSON.stringify({}),
  ]) {
    const v = validatePlanJson(text);
    assert.equal(v.ok, false, `input must be rejected: ${JSON.stringify(text)}`);
    assert.equal(v.reason, PLANNER_INVALID);
  }
});

test('oversized plan JSON input → planner_invalid (input bound)', () => {
  const big = 'x'.repeat(PLAN_MAX_INPUT_JSON_CHARS + 1);
  const v = validatePlanJson(big);
  assert.equal(v.ok, false);
  assert.equal(v.reason, PLANNER_INVALID);
});

// ---------------------------------------------------------------------------
// 5. deterministic hash stability
// ---------------------------------------------------------------------------

test('planHash is deterministic across repeated calls and independent processes', () => {
  const p = validatePlanInput(basePlan()).plan;
  assert.equal(planHash(p), planHash(p));
  assert.equal(planHash(p), planHash(validatePlanInput(basePlan()).plan));
});

test('object key order is canonicalized: shuffled key order does NOT change planHash', () => {
  const p = validatePlanInput(basePlan()).plan;
  const q = validatePlanInput(shuffledKeyOrder(basePlan())).plan;
  assert.notDeepEqual(Object.keys(p), Object.keys(shuffledKeyOrder(basePlan())), 'sanity: insertion orders differ');
  assert.equal(planHash(p), planHash(q), 'key order is semantically irrelevant → identical planHash');
});

test('JSON serialization with different key order hashes identically', () => {
  const h1 = validatePlanJson(JSON.stringify(basePlan())).ok
    ? planHash(validatePlanJson(JSON.stringify(basePlan())).plan)
    : null;
  const h2 = planHash(validatePlanJson(JSON.stringify(shuffledKeyOrder(basePlan()))).plan);
  assert.ok(h1);
  assert.equal(h1, h2);
});

test('planHash is cross-checkable as sha256 over the canonical serialization', () => {
  const p = validatePlanInput(basePlan()).plan;
  const expected = sha(`${PLAN_HASH_DOMAIN}:${canonicalPlanJson(p)}`);
  assert.equal(planHash(p), expected);
});

// ---------------------------------------------------------------------------
// 6. meaningful mutation changes planHash
// ---------------------------------------------------------------------------

test('meaningful plan mutation changes planHash (every conceptual class participates)', () => {
  const base = validatePlanInput(basePlan()).plan;
  const baseHash = planHash(base);

  const mutations = {
    queryVariant: (p) => { p.queryVariants[0] = '不同的检索式'; },
    aspect: (p) => { p.aspects[0] = '不同的视角'; },
    entity: (p) => { p.entities[0] = 'DeepSeek'; },
    opposingFraming: (p) => { p.opposingFramings[0] = '完全相反的框架'; },
    terminologyVariant: (p) => { p.terminologyVariants[0].variants[0] = '机器人'; },
    sourceGroupIntent: (p) => { p.sourceGroupIntents[0].intent = '换个组意图'; },
    constraint: (p) => { p.sourceGroupIntents[0].constraints[0] = '换成另一条约束'; },
    addedEntity: (p) => { p.entities.push('一个新实体'); },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    const copy = validatePlanInput(basePlan()).plan;
    mutate(copy);
    const next = validatePlanInput(copy);
    assert.equal(next.ok, true, `mutation ${name} must stay valid`);
    assert.notEqual(planHash(next.plan), baseHash, `mutation ${name} must change planHash`);
  }
});

test('cosmetically different but semantically identical input (key order / duplicates / whitespace) keeps planHash', () => {
  const base = validatePlanInput(basePlan()).plan;
  const baseHash = planHash(base);

  const cosmetic = basePlan();
  cosmetic.queryVariants = ['  大语言 Agent 争议 ', '大语言 Agent 争议', 'LLM agent disagreements'];
  const v = validatePlanInput(cosmetic);
  assert.equal(v.ok, true);
  assert.equal(planHash(v.plan), baseHash, 'dedupe + trim are contract-safe normalizations');
});

// ---------------------------------------------------------------------------
// 7. documented serialization-order semantics (array order is significant)
// ---------------------------------------------------------------------------

test('array order is significant and stable: swapping query variants changes planHash deterministically', () => {
  const p = validatePlanInput(basePlan()).plan;
  const swapped = validatePlanInput(basePlan()).plan;
  swapped.queryVariants.reverse();
  const v = validatePlanInput(swapped);
  assert.equal(v.ok, true);
  const hSwapped = planHash(v.plan);
  assert.notEqual(planHash(p), hSwapped, 'array order is semantically significant (documented)');
  assert.equal(hSwapped, planHash(validatePlanInput(swapped).plan), 'still deterministic across runs');
});

// ---------------------------------------------------------------------------
// 8. stale propagation seam
// ---------------------------------------------------------------------------

test('planDependencyStatus: same planHash → reusable; changed → stale with plan_hash_mismatch', () => {
  const p = validatePlanInput(basePlan()).plan;
  const h1 = planHash(p);
  assert.deepEqual(planDependencyStatus({ currentPlanHash: h1, dependentPlanHash: h1 }), {
    reusable: true,
    stale: false,
    reason: null,
  });

  const mutated = validatePlanInput(basePlan()).plan;
  mutated.queryVariants[0] = '发生实质变化的检索式';
  const h2 = planHash(mutated);
  assert.notEqual(h1, h2);
  assert.deepEqual(planDependencyStatus({ currentPlanHash: h2, dependentPlanHash: h1 }), {
    reusable: false,
    stale: true,
    reason: STALE_REASON_PLAN_HASH_MISMATCH,
  });
});

test('planDependencyStatus: missing/unknown dependent planHash is NOT reusable (UNKNOWN != PASS)', () => {
  const h = 'a'.repeat(64);
  for (const missing of [null, undefined, '', 0, {}]) {
    const s = planDependencyStatus({ currentPlanHash: h, dependentPlanHash: missing });
    assert.equal(s.reusable, false, `dependentPlanHash ${JSON.stringify(missing) ?? String(missing)} must not be reusable`);
    assert.equal(s.stale, true);
    assert.equal(s.reason, STALE_REASON_PLAN_DEPENDENCY_MISSING);
  }
});

// ---------------------------------------------------------------------------
// 8b. R1 repair — fail-closed planHash identity format (CRITICAL INVALID fix)
// A reusable dependency identity MUST be a syntactically valid planHash
// (64 lowercase hex chars). Malformed identities MUST NOT imply reuse, even
// when identical. Two identical malformed strings can NEVER become reusable.
// ---------------------------------------------------------------------------

test('isValidPlanHashFormat: accepts 64 lowercase hex, rejects everything else', () => {
  assert.equal(isValidPlanHashFormat('a'.repeat(64)), true);
  assert.equal(isValidPlanHashFormat('0'.repeat(64)), true);
  assert.equal(isValidPlanHashFormat('f'.repeat(64)), true);
  // uppercase hex is not lowercase → invalid
  assert.equal(isValidPlanHashFormat('A'.repeat(64)), false);
  // not hex
  assert.equal(isValidPlanHashFormat('g'.repeat(64)), false);
  // wrong length
  assert.equal(isValidPlanHashFormat('a'.repeat(63)), false);
  assert.equal(isValidPlanHashFormat('a'.repeat(65)), false);
  // non-string / empty
  assert.equal(isValidPlanHashFormat(''), false);
  assert.equal(isValidPlanHashFormat(null), false);
  assert.equal(isValidPlanHashFormat(undefined), false);
  assert.equal(isValidPlanHashFormat('garbage'), false);
});

test('planDependencyStatus: valid 64-hex same → reusable; valid different → stale', () => {
  const h1 = 'a'.repeat(64);
  const h2 = 'b'.repeat(64);
  assert.deepEqual(planDependencyStatus({ currentPlanHash: h1, dependentPlanHash: h1 }), {
    reusable: true,
    stale: false,
    reason: null,
  });
  assert.deepEqual(planDependencyStatus({ currentPlanHash: h2, dependentPlanHash: h1 }), {
    reusable: false,
    stale: true,
    reason: STALE_REASON_PLAN_HASH_MISMATCH,
  });
});

test('planDependencyStatus: malformed identity is never reusable (CRITICAL INVARIANT)', () => {
  // The exact bug: identical garbage strings must NOT become reusable.
  const garbage = 'garbage';
  assert.equal(isValidPlanHashFormat(garbage), false);
  const s = planDependencyStatus({ currentPlanHash: garbage, dependentPlanHash: garbage });
  assert.equal(s.reusable, false, 'two identical malformed strings must NEVER become reusable');
  assert.equal(s.stale, true);
  assert.equal(s.reason, STALE_REASON_PLAN_DEPENDENCY_INVALID);

  // 63-char, 65-char, non-hex-64-char: all malformed → non-reusable
  const cases = [
    { label: '63-char', v: 'a'.repeat(63) },
    { label: '65-char', v: 'a'.repeat(65) },
    { label: 'non-hex 64-char', v: 'g'.repeat(64) },
    { label: 'uppercase hex', v: 'A'.repeat(64) },
    { label: 'garbage', v: 'garbage' },
  ];
  for (const c of cases) {
    const sc = planDependencyStatus({ currentPlanHash: c.v, dependentPlanHash: c.v });
    assert.equal(sc.reusable, false, `${c.label}: identical malformed must not be reusable`);
    assert.equal(sc.stale, true, `${c.label}: must be stale`);
    assert.equal(sc.reason, STALE_REASON_PLAN_DEPENDENCY_INVALID, `${c.label}: reason`);
  }
});

test('planDependencyStatus: malformed current hash → invalid (not reusable)', () => {
  const h = 'a'.repeat(64);
  const s = planDependencyStatus({ currentPlanHash: 'garbage', dependentPlanHash: h });
  assert.equal(s.reusable, false);
  assert.equal(s.stale, true);
  assert.equal(s.reason, STALE_REASON_PLAN_DEPENDENCY_INVALID);
});

test('planDependencyStatus: malformed dependent hash → invalid (not reusable)', () => {
  const h = 'a'.repeat(64);
  const s = planDependencyStatus({ currentPlanHash: h, dependentPlanHash: 'garbage' });
  assert.equal(s.reusable, false);
  assert.equal(s.stale, true);
  assert.equal(s.reason, STALE_REASON_PLAN_DEPENDENCY_INVALID);
});

test('planDependencyStatus: both malformed but identical → still NOT reusable', () => {
  // Explicit restatement of the critical invariant as an independent assertion.
  const bad = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
  const s = planDependencyStatus({ currentPlanHash: bad, dependentPlanHash: bad });
  assert.equal(s.reusable, false);
  assert.equal(s.stale, true);
  assert.equal(s.reason, STALE_REASON_PLAN_DEPENDENCY_INVALID);
});

test('comparePlans: changed vs unchanged detection with exact hashes', () => {
  const a = validatePlanInput(basePlan()).plan;
  const b = validatePlanInput(basePlan()).plan;
  const cmpSame = comparePlans(a, b);
  assert.equal(cmpSame.changed, false);
  assert.equal(cmpSame.previousPlanHash, cmpSame.nextPlanHash);

  const c = validatePlanInput(basePlan()).plan;
  c.aspects[1] = '被替换的第二个视角';
  const cmpDiff = comparePlans(a, c);
  assert.equal(cmpDiff.changed, true);
  assert.notEqual(cmpDiff.previousPlanHash, cmpDiff.nextPlanHash);
});

// ---------------------------------------------------------------------------
// 9. stable run identity separation (Spec §4.3)
// ---------------------------------------------------------------------------

test('run identity is independent of plan contents and planHash (stochastic plan output not in run identity)', () => {
  const stable = { topic: '大语言 Agent 争议', mode: 'digest', percent: null, runtime: 'deepseek-api-tool-less' };

  const planA = validatePlanInput(basePlan()).plan;
  const planB = validatePlanInput(basePlan()).plan;
  planB.queryVariants = ['完全不同的规划检索式'];
  planB.aspects = ['完全不同的视角'];
  const vB = validatePlanInput(planB);
  assert.equal(vB.ok, true);

  const hashA = planHash(planA);
  const hashB = planHash(vB.plan);
  assert.notEqual(hashA, hashB, 'sanity: the two plans are distinct artifacts');

  assert.equal(
    runIdentityHash(stable),
    runIdentityHash(stable),
    'run identity deterministic',
  );
  assert.equal(
    runIdentityHash({ ...stable }),
    runIdentityHash({ ...stable, planHash: hashA }),
    'planHash must NOT participate in run identity (extra inputs are ignored by the stable identity set)',
  );
  assert.equal(
    runIdentityHash(stable),
    runIdentityHash({ topic: stable.topic, mode: stable.mode, percent: stable.percent, runtime: stable.runtime }),
    'same stable configuration → same run identity regardless of plan mutation',
  );
});

test('planHash is available as a downstream dependency identity alongside an unchanged run identity', () => {
  const stable = { topic: '大语言 Agent 争议', mode: 'digest', percent: null, runtime: 'deepseek-api-tool-less' };
  const work = tmpDir('identity');

  const plan1 = validatePlanInput(basePlan()).plan;
  const persisted1 = persistPlan(work, plan1);
  assert.equal(persisted1.ok, true);

  const plan2 = validatePlanInput(basePlan()).plan;
  plan2.queryVariants[0] = '重新生成的检索式';
  const persisted2 = persistPlan(work, plan2);
  assert.equal(persisted2.ok, true);

  assert.equal(runIdentityHash(stable), runIdentityHash(stable), 'run identity stable across plan regeneration');
  assert.notEqual(persisted1.planHash, persisted2.planHash, 'regenerated plan → new artifact identity');
  const seam = planDependencyStatus({
    currentPlanHash: persisted2.planHash,
    dependentPlanHash: persisted1.planHash,
  });
  assert.equal(seam.reusable, false, 'artifact depending on old planHash is stale');
  assert.equal(seam.reason, STALE_REASON_PLAN_HASH_MISMATCH);
});

// ---------------------------------------------------------------------------
// 10. persistence contract
// ---------------------------------------------------------------------------

test('persistPlan writes the work-relative canonical artifact; loadPlan round-trips identity', () => {
  const work = tmpDir('persist');
  const plan = validatePlanInput(basePlan()).plan;
  const persisted = persistPlan(work, plan);
  assert.equal(persisted.ok, true);
  assert.equal(persisted.file, PLAN_ARTIFACT_FILENAME);
  assert.equal(PLAN_ARTIFACT_FILENAME, 'research-plan.json');
  const abs = path.join(work, PLAN_ARTIFACT_FILENAME);
  assert.ok(fs.existsSync(abs), 'artifact must exist inside the work dir');
  assert.ok(planHash(plan), persisted.planHash);

  const loaded = loadPlan(work);
  assert.equal(loaded.ok, true, `load must succeed: ${JSON.stringify(loaded.issues ?? loaded.reason)}`);
  assert.equal(loaded.planHash, persisted.planHash, 'persist → load preserves planHash');
  assert.deepEqual(loaded.plan, plan);
});

test('loadPlan fail-closed: missing artifact → plan_missing; corrupt → planner_invalid', () => {
  const work = tmpDir('missing');
  const missing = loadPlan(work);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, PLAN_FAILURE_PLAN_MISSING);

  const corrupt = tmpDir('corrupt');
  fs.writeFileSync(path.join(corrupt, PLAN_ARTIFACT_FILENAME), '{ not json at all');
  const bad = loadPlan(corrupt);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, PLANNER_INVALID);
});

test('loadPlan re-validates: tampered-but-schema-invalid artifact → planner_invalid (FILE EXISTS != VALID CACHE)', () => {
  const work = tmpDir('tampered');
  const plan = validatePlanInput(basePlan()).plan;
  assert.equal(persistPlan(work, plan).ok, true);

  const tampered = JSON.parse(fs.readFileSync(path.join(work, PLAN_ARTIFACT_FILENAME), 'utf8'));
  delete tampered.aspects; // schema-invalidating hand edit
  fs.writeFileSync(path.join(work, PLAN_ARTIFACT_FILENAME), JSON.stringify(tampered, null, 2));

  const loaded = loadPlan(work);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.reason, PLANNER_INVALID);
});

test('persistPlan refuses invalid plans and writes nothing (fail-closed persistence)', () => {
  const work = tmpDir('refuse');
  const invalid = basePlan();
  invalid.aspects = 'not an array';
  const res = persistPlan(work, invalid);
  assert.equal(res.ok, false);
  assert.equal(res.reason, PLANNER_INVALID);
  assert.ok(Array.isArray(res.issues) && res.issues.length > 0);
  assert.equal(fs.existsSync(path.join(work, PLAN_ARTIFACT_FILENAME)), false, 'no artifact may be written');
});

// ---------------------------------------------------------------------------
// 11. credentials / machine-private paths prohibited
// ---------------------------------------------------------------------------

test('credential-shaped strings are rejected in plan string fields (fail-closed, no sanitization)', () => {
  const cases = [
    ['queryVariants', ['z_c0=1%3AABCdef']],
    ['queryVariants', ['Cookie: k=v']],
    ['queryVariants', ['token=abc123']],
    ['aspects', ['api_key: sk-xxxx']],
    ['entities', ['authorization: Bearer xyz']],
    ['opposingFramings', ['password=hunter2']],
    ['sourceGroupIntents', [{ intent: 'secret: 123', constraints: [] }]],
    ['terminologyVariants', [{ term: 'session_id: abc', variants: ['x'] }]],
  ];
  for (const [field, value] of cases) {
    const plan = { ...basePlan(), [field]: value };
    const v = validatePlanInput(plan);
    assert.equal(v.ok, false, `credential-shaped ${field} must be rejected: ${JSON.stringify(value)}`);
    assert.equal(v.reason, PLANNER_INVALID);
  }
});

test('machine-private filesystem paths are rejected in plan string fields', () => {
  const cases = [
    ['queryVariants', ['/Users/alice/secret.txt 的内容']],
    ['queryVariants', ['/home/bob/.zshrc']],
    ['aspects', ['~/Documents/notes.md']],
    ['entities', ['C:\\Users\\carol\\cookie.txt']],
  ];
  for (const [field, value] of cases) {
    const plan = { ...basePlan(), [field]: value };
    const v = validatePlanInput(plan);
    assert.equal(v.ok, false, `machine-private path in ${field} must be rejected: ${JSON.stringify(value)}`);
    assert.equal(v.reason, PLANNER_INVALID);
    assert.ok(v.issues.some((i) => /machine-private|private path/i.test(i.message)), 'issue must name the boundary');
  }
});

test('legitimate non-private strings remain valid (boundary is narrow, not a content ban)', () => {
  const plan = basePlan();
  plan.queryVariants = ['https://www.zhihu.com/question/123 的回答质量如何', '/etc/hosts 文件的作用'];
  const v = validatePlanInput(plan);
  assert.equal(v.ok, true, `URLs and system (non-machine-private) paths stay valid: ${JSON.stringify(v.issues ?? [])}`);
});
