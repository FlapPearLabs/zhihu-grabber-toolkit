/**
 * research-orchestration/test/p2a-t01-gap-ledger-identity.test.mjs
 *
 * P2A-T01 (#113) focused tests — Targeted Re-query gap ledger artifact + gap identity.
 *
 * Authority (semantics are FROZEN; this suite must not reinterpret them):
 *   - docs/specs/p2-ari-f02-targeted-requery.md  §5 D1, §6, §10   (STATUS = APPROVED)
 *   - docs/architecture/key-decisions.md         D12-1, D12-8
 *   - docs/planning/..._SEAM_CONTRACT_V1.md      E.1 / E.2 / E.3 / E.8
 *   - docs/planning/..._SEAM_MAP_V1.md           S1 / S4
 *   - Issue #113 ACCEPTANCE_CRITERIA 1–6 + REQUIRED_TESTS
 *
 * Anti-tautology discipline: every expected identity/hash value below is derived
 * INDEPENDENTLY of the module under test — the frozen domain string and the
 * hand-written canonical JSON literal are spelled out here (sorted keys, exactly
 * the four E.2 inputs), never produced by calling the module's own helpers.
 *
 * T01 owns: closed gapType enum, subjectKey construction, gapIdentityCore / gapId,
 * deterministic ordering comparator, ledger read/write primitives + schema
 * validation, work-dir-relative paths, focused tests.
 * T01 explicitly does NOT own: diagnosis logic (T03), authorization (T05),
 * lifecycle/state advancement (T06), resolution (T08), any retrieval IO.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  GAP_TYPE_ASPECT,
  GAP_TYPE_CONTRADICTION,
  GAP_TYPE_AUTHORITY,
  GAP_TYPE_UNKNOWN,
  GAP_TYPES,
  GAP_IDENTITY_DOMAIN,
  LEDGER_SCHEMA,
  LEDGER_FILENAME,
  LEDGER_ERROR_INVALID,
  normalizeGapType,
  gapTypeAllowsRetrievalAction,
  normalizeSubjectString,
  aspectSubjectKey,
  opposingFramingSubjectKey,
  sourceGroupIntentSubjectKey,
  computeGapIdentityCore,
  makeGapId,
  gapIdentityCoreOf,
  compareGapsByGapId,
  sortGapsByGapId,
  createLedger,
  makeGapRecord,
  appendGapRecord,
  validateLedger,
  ledgerFile,
  persistLedger,
  loadLedger,
} from '../lib/targeted-requery-ledger.mjs';

import {
  COVERAGE_STATE_SCHEMA_VERSION,
  canonicalizeCoverageState,
  createInitialCoverageState,
} from '../lib/coverage-state.mjs';

// ---------------------------------------------------------------------------
// fixtures / independent expected values
// ---------------------------------------------------------------------------

const PLAN_HASH_A = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';
const PLAN_HASH_B = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809';
const OCCURRENCE_A = 'occ-fixture-0001';

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** E.2 spelled out literally: sha256( 'p2-ari-gap-core/v1:' + canonicalJson({4 keys}) ). */
function expectedCoreLiteral({ planHash, occurrenceId, gapType, subjectKey }) {
  const canonical =
    `{"gapType":${JSON.stringify(gapType)},`
    + `"occurrenceId":${JSON.stringify(occurrenceId)},`
    + `"planHash":${JSON.stringify(planHash)},`
    + `"subjectKey":${JSON.stringify(subjectKey)}}`;
  assert.equal(GAP_IDENTITY_DOMAIN, 'p2-ari-gap-core/v1');
  return sha256Hex(`${GAP_IDENTITY_DOMAIN}:${canonical}`);
}

function tmpWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p2a-t01-'));
}

function recordFor({ gapType = GAP_TYPE_ASPECT, subject = { kind: 'aspect', value: '定价模型' }, round = 0, planHash = PLAN_HASH_A } = {}) {
  return makeGapRecord({
    planHash,
    occurrenceId: OCCURRENCE_A,
    diagnosisRound: round,
    gapType,
    subject,
  });
}

const ASPECT_SUBJECT = { kind: 'aspect', value: '定价模型' };

// ---------------------------------------------------------------------------
// 1. gapType enum closure (E.1) + zero retrieval-authority for UNKNOWN
// ---------------------------------------------------------------------------

test('E.1 closed enum: exactly the three MVP gap types exist', () => {
  assert.deepEqual(GAP_TYPES, ['ASPECT_GAP', 'CONTRADICTION_GAP', 'AUTHORITY_GAP']);
  assert.equal(GAP_TYPE_ASPECT, 'ASPECT_GAP');
  assert.equal(GAP_TYPE_CONTRADICTION, 'CONTRADICTION_GAP');
  assert.equal(GAP_TYPE_AUTHORITY, 'AUTHORITY_GAP');
  assert.equal(GAP_TYPE_UNKNOWN, 'UNKNOWN_GAP_TYPE');
  assert.ok(!GAP_TYPES.includes(GAP_TYPE_UNKNOWN), 'UNKNOWN_GAP_TYPE is not an MVP enum member');
});

test('E.1 enum closure: every non-member gapType (named or garbage) normalizes to UNKNOWN_GAP_TYPE', () => {
  const outsideClosedEnum = [
    'UNDERCOVERED_ASPECT',
    'SOURCE_GROUP_UNDERCOVERED',
    'CLAIM_SOURCE_DIVERSITY_LOW',
    'TERMINOLOGY_GAP',
    'EVIDENCE_DETAIL_GAP',
    'ASPECT_GAP ',        // no incidental coercion
    'aspect_gap',
    'UNKNOWN_GAP_TYPE',
    '',
    '   ',
    42,
    null,
    undefined,
    { gapType: 'ASPECT_GAP' },
  ];
  for (const raw of outsideClosedEnum) {
    assert.equal(normalizeGapType(raw), GAP_TYPE_UNKNOWN, `raw=${JSON.stringify(raw)}`);
  }
  for (const member of GAP_TYPES) {
    assert.equal(normalizeGapType(member), member);
  }
});

test('E.1: UNKNOWN_GAP_TYPE is recordable but grants zero retrieval action authority', () => {
  // recordable: a well-formed UNKNOWN_GAP_TYPE record validates inside a ledger
  const record = recordFor({
    gapType: 'TERMINOLOGY_GAP',
    subject: { kind: 'explicit', subjectKey: 'terminology:利率传导' },
  });
  assert.equal(record.gapType, GAP_TYPE_UNKNOWN);
  assert.equal(record.declaredGapType, 'TERMINOLOGY_GAP');
  const ledger = appendGapRecord(createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A }), record);
  assert.equal(validateLedger(ledger).ok, true);

  // zero retrieval action authority
  assert.equal(gapTypeAllowsRetrievalAction(GAP_TYPE_UNKNOWN), false);
  assert.equal(gapTypeAllowsRetrievalAction('TERMINOLOGY_GAP'), false);
  assert.equal(gapTypeAllowsRetrievalAction('ASPECT_GAP'), true);
  assert.equal(gapTypeAllowsRetrievalAction('CONTRADICTION_GAP'), true);
  assert.equal(gapTypeAllowsRetrievalAction('AUTHORITY_GAP'), true);
});

// ---------------------------------------------------------------------------
// 2. E.3 subjectKey branches
// ---------------------------------------------------------------------------

test('E.3 subjectKey: three mechanical branches carry their frozen prefixes', () => {
  assert.equal(aspectSubjectKey('定价模型'), 'aspect:定价模型');
  assert.equal(opposingFramingSubjectKey('规模优先'), 'opposing:规模优先');
  assert.equal(
    sourceGroupIntentSubjectKey({ intent: '监管约束' }),
    'intent:监管约束',
  );
});

test('E.3 subjectKey: normalization is deterministic (trim / NFC / whitespace fold / casefold)', () => {
  assert.equal(normalizeSubjectString('  定价   模型  '), '定价 模型');
  assert.equal(aspectSubjectKey('  定价   模型  '), aspectSubjectKey('定价 模型'));
  assert.equal(aspectSubjectKey('Market  PRICING'), 'aspect:market pricing');
  // NFC: decomposed vs precomposed e-acute must collapse to one identity
  assert.equal(aspectSubjectKey('cafe\u0301 pricing'), aspectSubjectKey('caf\u00e9 pricing'));
});

test('E.3 no-intent AUTHORITY_GAP: intent-freeform uses sha256(normalizedQueryIntent), not a constant', () => {
  const q1 = '  市场   Pricing MODEL ';
  const normalizedQ1 = '市场 pricing model';
  assert.equal(
    sourceGroupIntentSubjectKey({ queryIntent: q1 }),
    `intent-freeform:${sha256Hex(normalizedQ1)}`, // independent literal-derived expectation
  );

  const q2 = '完全不同的 expectedInformation';
  const key1 = sourceGroupIntentSubjectKey({ queryIntent: q1 });
  const key2 = sourceGroupIntentSubjectKey({ queryIntent: q2 });
  assert.notEqual(key1, key2, 'different expectedInformation must not collapse to one identity');
  assert.notEqual(key1, 'intent-freeform:unknown');
  assert.ok(!/unknown$/i.test(key1));
});

test('E.3 no-intent AUTHORITY_GAP: no intent and no queryIntent fails closed (never a constant subject)', () => {
  assert.throws(() => sourceGroupIntentSubjectKey({}), (err) => err.code === LEDGER_ERROR_INVALID);
  assert.throws(() => sourceGroupIntentSubjectKey({ intent: '   ' }), (err) => err.code === LEDGER_ERROR_INVALID);
  assert.throws(
    () => sourceGroupIntentSubjectKey({ intent: null, queryIntent: '  ' }),
    (err) => err.code === LEDGER_ERROR_INVALID,
  );
});

test('#113 AC4: two unrelated no-intent AUTHORITY_GAP inputs never collapse into one identity', () => {
  const a = recordFor({
    gapType: GAP_TYPE_AUTHORITY,
    subject: { kind: 'sourceGroupIntent', queryIntent: '期望获得一手监管文件' },
  });
  const b = recordFor({
    gapType: GAP_TYPE_AUTHORITY,
    subject: { kind: 'sourceGroupIntent', queryIntent: '期望获得厂商白皮书' },
  });
  assert.notEqual(a.subjectKey, b.subjectKey);
  assert.notEqual(a.gapIdentityCore, b.gapIdentityCore);
  assert.notEqual(a.gapId, b.gapId);
});

// ---------------------------------------------------------------------------
// 3. E.2 gapIdentityCore / gapId
// ---------------------------------------------------------------------------

test('E.2 gapIdentityCore matches the frozen formula (independently re-derived literal)', () => {
  const subjectKey = 'aspect:定价模型';
  const core = computeGapIdentityCore({
    planHash: PLAN_HASH_A,
    occurrenceId: OCCURRENCE_A,
    gapType: GAP_TYPE_ASPECT,
    subjectKey,
  });
  assert.equal(core, expectedCoreLiteral({
    planHash: PLAN_HASH_A,
    occurrenceId: OCCURRENCE_A,
    gapType: GAP_TYPE_ASPECT,
    subjectKey,
  }));
  assert.match(core, /^[0-9a-f]{64}$/);
});

test('#113 AC2/AC3: same logical gap across diagnosisRounds → same core, different gapId', () => {
  const round1 = recordFor({ round: 1 });
  const round2 = recordFor({ round: 2 });
  const round9 = recordFor({ round: 9 });

  assert.equal(round1.gapIdentityCore, round2.gapIdentityCore);
  assert.equal(round2.gapIdentityCore, round9.gapIdentityCore);
  assert.notEqual(round1.gapId, round2.gapId);
  assert.notEqual(round2.gapId, round9.gapId);

  assert.equal(round1.gapId, `${round1.gapIdentityCore}:1`);
  assert.equal(round9.gapId, `${round9.gapIdentityCore}:9`);
});

test('#113 AC3: diagnosisRound is excluded from the identity core even when a caller passes it', () => {
  const base = {
    planHash: PLAN_HASH_A,
    occurrenceId: OCCURRENCE_A,
    gapType: GAP_TYPE_ASPECT,
    subjectKey: 'aspect:定价模型',
  };
  const core = computeGapIdentityCore(base);
  // a caller leaking the audit field must not change the core
  assert.equal(computeGapIdentityCore({ ...base, diagnosisRound: 7 }), core);
  assert.equal(computeGapIdentityCore({ ...base, diagnosisRound: 0 }), core);
});

test('E.2 identity is deterministic and free of timestamps / randomness', () => {
  const args = {
    planHash: PLAN_HASH_A,
    occurrenceId: OCCURRENCE_A,
    gapType: GAP_TYPE_CONTRADICTION,
    subjectKey: 'opposing:规模优先',
  };
  const first = computeGapIdentityCore(args);
  for (let i = 0; i < 25; i += 1) {
    assert.equal(computeGapIdentityCore(args), first);
  }
  // independent re-derivation of the same literal formula
  assert.equal(first, expectedCoreLiteral(args));
});

test('E.2 identity inputs are exactly the four frozen fields (no extra identity input)', () => {
  const base = {
    planHash: PLAN_HASH_A,
    occurrenceId: OCCURRENCE_A,
    gapType: GAP_TYPE_ASPECT,
    subjectKey: 'aspect:定价模型',
  };
  const core = computeGapIdentityCore(base);
  const mutated = [
    { ...base, planHash: PLAN_HASH_B },
    { ...base, occurrenceId: 'occ-fixture-0002' },
    { ...base, gapType: GAP_TYPE_AUTHORITY },
    { ...base, subjectKey: 'aspect:其他' },
  ];
  for (const variant of mutated) {
    assert.notEqual(computeGapIdentityCore(variant), core);
  }
});

test('E.2 input validation fails closed on malformed planHash / occurrenceId / subjectKey', () => {
  const base = {
    planHash: PLAN_HASH_A,
    occurrenceId: OCCURRENCE_A,
    gapType: GAP_TYPE_ASPECT,
    subjectKey: 'aspect:定价模型',
  };
  const bad = [
    { ...base, planHash: PLAN_HASH_A.slice(0, 63) },
    { ...base, planHash: PLAN_HASH_A.toUpperCase() },
    { ...base, planHash: undefined },
    { ...base, occurrenceId: '' },
    { ...base, occurrenceId: 7 },
    { ...base, gapType: 'ASPECT_GAP ' },
    { ...base, gapType: undefined },
    { ...base, subjectKey: '' },
    { ...base, subjectKey: 123 },
  ];
  for (const variant of bad) {
    assert.throws(() => computeGapIdentityCore(variant), (err) => err.code === LEDGER_ERROR_INVALID);
  }
});

test('E.2 gapId round-trip: makeGapId / gapIdentityCoreOf are inverse for valid ids', () => {
  const core = computeGapIdentityCore({
    planHash: PLAN_HASH_A,
    occurrenceId: OCCURRENCE_A,
    gapType: GAP_TYPE_ASPECT,
    subjectKey: 'aspect:定价模型',
  });
  assert.equal(makeGapId(core, 0), `${core}:0`);
  assert.equal(gapIdentityCoreOf(`${core}:0`), core);
  assert.equal(gapIdentityCoreOf(`${core}:12`), core);
  // fail closed on malformed ids (never a guessed core)
  assert.equal(gapIdentityCoreOf('not-a-gap-id'), null);
  assert.equal(gapIdentityCoreOf(`${core}:-1`), null);
  assert.equal(gapIdentityCoreOf(`${core}:1.5`), null);
  assert.equal(gapIdentityCoreOf(core), null);
  assert.throws(() => makeGapId(core, -1), (err) => err.code === LEDGER_ERROR_INVALID);
  assert.throws(() => makeGapId(core, 1.5), (err) => err.code === LEDGER_ERROR_INVALID);
  assert.throws(() => makeGapId('short', 0), (err) => err.code === LEDGER_ERROR_INVALID);
});

// ---------------------------------------------------------------------------
// 4. E.8 deterministic ordering
// ---------------------------------------------------------------------------

test('E.8 deterministic ordering: ascending gapId hexadecimal comparison, stable, non-mutating', () => {
  const cores = ['00ff', 'ff00', '0a0b'].map((prefix) => prefix.padEnd(64, '0'));
  const records = cores.map((core, index) => ({
    gapId: `${core}:${index}`,
  }));
  const shuffled = [records[2], records[0], records[1]];
  const sorted = sortGapsByGapId(shuffled);
  const ids = sorted.map((r) => r.gapId);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(ids, [`${cores[0]}:0`, `${cores[2]}:2`, `${cores[1]}:1`]);
  // comparator agrees with the sorted order
  assert.ok(compareGapsByGapId(sorted[0], sorted[1]) < 0);
  assert.equal(compareGapsByGapId(sorted[1], sorted[1]), 0);
  // input untouched (primitives must not mutate caller state)
  assert.deepEqual(shuffled.map((r) => r.gapId), [records[2].gapId, records[0].gapId, records[1].gapId]);
});

test('E.8 ordering is total and deterministic for records sharing a gapId (audit tie-break)', () => {
  const core = computeGapIdentityCore({
    planHash: PLAN_HASH_A,
    occurrenceId: OCCURRENCE_A,
    gapType: GAP_TYPE_ASPECT,
    subjectKey: 'aspect:定价模型',
  });
  const sameGapId = [
    { gapId: `${core}:3`, subjectKey: 'aspect:定价模型', declaredGapType: 'ASPECT_GAP', gapType: 'ASPECT_GAP', gapIdentityCore: core, diagnosisRound: 3 },
    { gapId: `${core}:3`, subjectKey: 'aspect:定价模型', declaredGapType: 'ASPECT_GAP', gapType: 'ASPECT_GAP', gapIdentityCore: core, diagnosisRound: 3 },
  ];
  assert.equal(compareGapsByGapId(sameGapId[0], sameGapId[1]), 0);
  const first = sortGapsByGapId(sameGapId).map((r) => JSON.stringify(r));
  const second = sortGapsByGapId([...sameGapId].reverse()).map((r) => JSON.stringify(r));
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// 5. ledger schema, roundtrip, append-only semantics
// ---------------------------------------------------------------------------

test('ledger schema: canonical shape with exactly the frozen keys', () => {
  const ledger = createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A });
  assert.deepEqual(Object.keys(ledger).sort(), ['diagnosedGaps', 'occurrenceId', 'planHash', 'schema']);
  assert.equal(ledger.schema, LEDGER_SCHEMA);
  assert.deepEqual(ledger.diagnosedGaps, []);
  assert.equal(validateLedger(ledger).ok, true);
});

test('ledger append is append-only and returns a new artifact (no mutation of the input)', () => {
  const empty = createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A });
  const one = appendGapRecord(empty, recordFor({ subject: ASPECT_SUBJECT, round: 1 }));
  assert.equal(empty.diagnosedGaps.length, 0, 'input ledger must not be mutated');
  assert.equal(one.diagnosedGaps.length, 1);
  const two = appendGapRecord(one, recordFor({
    gapType: GAP_TYPE_CONTRADICTION,
    subject: { kind: 'opposingFraming', value: '规模优先' },
    round: 1,
  }));
  assert.equal(two.diagnosedGaps.length, 2);
  // history preserved: the earlier record is still present verbatim
  assert.deepEqual(two.diagnosedGaps.find((r) => r.gapType === GAP_TYPE_ASPECT), one.diagnosedGaps[0]);
});

test('append fails closed on foreign ledger / mismatched plan anchor', () => {
  const ledger = createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A });
  assert.throws(
    () => appendGapRecord(ledger, recordFor({ planHash: PLAN_HASH_B, subject: ASPECT_SUBJECT })),
    (err) => err.code === LEDGER_ERROR_INVALID,
  );
  assert.throws(
    () => appendGapRecord({ schema: LEDGER_SCHEMA, planHash: PLAN_HASH_A }, recordFor({ subject: ASPECT_SUBJECT })),
    (err) => err.code === LEDGER_ERROR_INVALID,
  );
});

test('ledger schema roundtrip: persist → load is byte-stable and independent of append order', () => {
  const workDirA = tmpWorkDir();
  const workDirB = tmpWorkDir();
  const rAspect = recordFor({ subject: ASPECT_SUBJECT, round: 1 });
  const rOpposing = recordFor({
    gapType: GAP_TYPE_CONTRADICTION,
    subject: { kind: 'opposingFraming', value: '规模优先' },
    round: 2,
  });
  const rAuthority = recordFor({
    gapType: GAP_TYPE_AUTHORITY,
    subject: { kind: 'sourceGroupIntent', queryIntent: '一手监管文件' },
    round: 0,
  });

  let forward = createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A });
  for (const record of [rAspect, rOpposing, rAuthority]) forward = appendGapRecord(forward, record);

  let reverse = createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A });
  for (const record of [rAuthority, rOpposing, rAspect]) reverse = appendGapRecord(reverse, record);

  const writtenA = persistLedger(workDirA, forward);
  const writtenB = persistLedger(workDirB, reverse);
  assert.equal(writtenA.ok, true);
  assert.equal(writtenA.path, LEDGER_FILENAME);
  assert.equal(writtenA.hash, writtenB.hash, 'persisted artifact must be order-independent');
  assert.equal(fs.readFileSync(ledgerFile(workDirA), 'utf8'), fs.readFileSync(ledgerFile(workDirB), 'utf8'));

  const loaded = loadLedger(workDirA, PLAN_HASH_A);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.path, LEDGER_FILENAME);
  assert.equal(loaded.hash, writtenA.hash);
  assert.deepEqual(loaded.ledger, forward);

  // re-validating the loaded artifact reproduces the same hash (self-verifying)
  persistLedger(workDirA, loaded.ledger);
  assert.equal(loadLedger(workDirA, PLAN_HASH_A).hash, writtenA.hash);
});

test('persisted ledger never records machine-private paths and stays work-dir relative', () => {
  const workDir = tmpWorkDir();
  const ledger = appendGapRecord(
    createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A }),
    recordFor({ subject: ASPECT_SUBJECT }),
  );
  const written = persistLedger(workDir, ledger);
  assert.equal(written.path, LEDGER_FILENAME);
  assert.ok(!path.isAbsolute(written.path));
  const raw = fs.readFileSync(ledgerFile(workDir), 'utf8');
  assert.ok(!raw.includes(workDir), 'work dir absolute path must never enter the artifact');
  assert.ok(!raw.includes(os.tmpdir()), 'temp dir path must never enter the artifact');
  // no timestamps / no random identity material in the persisted bytes
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw), 'no ISO timestamps in the ledger artifact');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(raw), 'no UUID-shaped values in the ledger artifact');
});

test('subject material carrying machine-private shapes is rejected before persistence', () => {
  const rejected = [
    '/Users/alice/private/notes.txt',
    '/home/bob/secret.md',
    '~/.ssh/id_rsa',
    'z_c0=abc123',
    'token: deadbeef',
  ];
  for (const value of rejected) {
    assert.equal(normalizeSubjectString(value), null, `must reject: ${value}`);
    assert.throws(() => aspectSubjectKey(value), (err) => err.code === LEDGER_ERROR_INVALID);
    assert.throws(
      () => recordFor({ subject: { kind: 'aspect', value } }),
      (err) => err.code === LEDGER_ERROR_INVALID,
      `must refuse to build a record for: ${value}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. fail-closed validation of a foreign / tampered ledger
// ---------------------------------------------------------------------------

test('invalid ledgers fail closed with a typed error (no silent repair, no guessing)', () => {
  const workDir = tmpWorkDir();
  const good = appendGapRecord(
    createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A }),
    recordFor({ subject: ASPECT_SUBJECT, round: 2 }),
  );
  const record = good.diagnosedGaps[0];

  const cases = {
    'wrong schema string': { ...good, schema: 'p2-ari-targeted-requery-ledger/v0' },
    'missing schema': { planHash: good.planHash, occurrenceId: good.occurrenceId, diagnosedGaps: [] },
    'extra top-level key': { ...good, extra: 1 },
    'malformed planHash': { ...good, planHash: 'nope' },
    'empty occurrenceId': { ...good, occurrenceId: '' },
    'non-array diagnosedGaps': { ...good, diagnosedGaps: {} },
    'gapType outside closure': { ...good, diagnosedGaps: [{ ...record, gapType: 'UNDERCOVERED_ASPECT' }] },
    'tampered gapIdentityCore': { ...good, diagnosedGaps: [{ ...record, gapIdentityCore: PLAN_HASH_B }] },
    'gapId not core:round': { ...good, diagnosedGaps: [{ ...record, gapId: `${record.gapIdentityCore}:99` }] },
    'gapId with negative round': {
      ...good,
      diagnosedGaps: [{ ...record, gapId: `${record.gapIdentityCore}:-1`, diagnosisRound: -1 }],
    },
    'non-integer diagnosisRound': { ...good, diagnosedGaps: [{ ...record, diagnosisRound: 1.5 }] },
    'record extra key': { ...good, diagnosedGaps: [{ ...record, materiality: 0.9 }] },
    'record missing subjectKey': {
      ...good,
      diagnosedGaps: [(() => { const { subjectKey, ...rest } = record; return rest; })()],
    },
    'empty subjectKey': { ...good, diagnosedGaps: [{ ...record, subjectKey: '' }] },
    'subjectKey with machine-private path': {
      ...good,
      diagnosedGaps: [{ ...record, subjectKey: 'aspect:/Users/alice/x.txt' }],
    },
    'records not in canonical order': {
      ...good,
      diagnosedGaps: [
        recordFor({ subject: { kind: 'aspect', value: 'zzz' } }),
        recordFor({ subject: { kind: 'aspect', value: 'aaa' } }),
      ].sort((a, b) => compareGapsByGapId(b, a)),
    },
    'not a plain object': [1, 2, 3],
  };

  for (const [label, value] of Object.entries(cases)) {
    const verdict = validateLedger(value);
    assert.equal(verdict.ok, false, `validateLedger must reject: ${label}`);
    assert.equal(typeof verdict.reason, 'string');
    assert.ok(verdict.reason.length > 0);
    assert.throws(() => persistLedger(workDir, value), (err) => err.code === LEDGER_ERROR_INVALID, label);
  }
});

test('missing / unparseable / stale ledger load fails closed with a stable reason', () => {
  const workDir = tmpWorkDir();

  const absent = loadLedger(workDir, PLAN_HASH_A);
  assert.equal(absent.ok, false);
  assert.equal(absent.reason, 'file_not_found');
  assert.equal(absent.path, LEDGER_FILENAME);

  fs.writeFileSync(ledgerFile(workDir), '{not json', 'utf8');
  const unparseable = loadLedger(workDir, PLAN_HASH_A);
  assert.equal(unparseable.ok, false);
  assert.equal(unparseable.reason, 'unparseable');

  persistLedger(workDir, appendGapRecord(
    createLedger({ planHash: PLAN_HASH_A, occurrenceId: OCCURRENCE_A }),
    recordFor({ subject: ASPECT_SUBJECT }),
  ));

  // #113 REQUIRED_TESTS: planHash change → the ledger is not reusable
  const drifted = loadLedger(workDir, PLAN_HASH_B);
  assert.equal(drifted.ok, false);
  assert.equal(drifted.reason, 'stale_plan_hash');
  assert.equal(loadLedger(workDir, PLAN_HASH_A).ok, true);

  // tampered on-disk record must be rejected on load, not repaired
  const onDisk = JSON.parse(fs.readFileSync(ledgerFile(workDir), 'utf8'));
  onDisk.diagnosedGaps[0].gapIdentityCore = PLAN_HASH_B;
  fs.writeFileSync(ledgerFile(workDir), JSON.stringify(onDisk, null, 2), 'utf8');
  assert.equal(loadLedger(workDir, PLAN_HASH_A).ok, false);
});

test('ledgerFile stays inside the work dir (work-dir-relative contract)', () => {
  const workDir = tmpWorkDir();
  const file = ledgerFile(workDir);
  assert.equal(path.dirname(file), path.resolve(workDir));
  assert.equal(path.basename(file), LEDGER_FILENAME);
});

// ---------------------------------------------------------------------------
// 7. regression: ResearchCoverageState is UNTOUCHED (frozen sibling artifact)
// ---------------------------------------------------------------------------

test('#113 AC5: ResearchCoverageState schemaVersion and canonicalize keyset are verbatim unchanged', () => {
  assert.equal(COVERAGE_STATE_SCHEMA_VERSION, 1);

  const state = createInitialCoverageState({
    planHash: PLAN_HASH_A,
    plannedQueryVariants: ['q1'],
    plannedRoutes: [{ providerId: 'p1', capability: 'search' }],
  });
  const canonical = canonicalizeCoverageState(state);

  // Frozen keyset of canonicalizeCoverageState (independent literal, not derived
  // from the implementation under test).
  const EXPECTED_KEYS = {
    '': ['analysisCoverage', 'diagnostics', 'planHash', 'retrieval', 'schemaVersion', 'sourceCompleteness'],
    retrieval: ['executedRoutes', 'fusedCandidateCount', 'fusedGroupCount', 'plannedQueryVariants', 'plannedRoutes', 'providerFailures', 'retrievalRounds', 'stopReason'],
    sourceCompleteness: ['diagnostics', 'perGroupStatus'],
    'sourceCompleteness.diagnostics': ['capturedNotVerifiedCount', 'totalSelectedCount', 'totalVerifiedCount'],
    analysisCoverage: ['analyzedSourceSet', 'evidenceRefIssues', 'is100PercentAnalysis', 'mappedSourceSet', 'perGroupAnalyzedSourceSet', 'perGroupMappedSourceSet', 'selectedCorpusSourceSet'],
    'analysisCoverage.evidenceRefIssues': ['duplicateRefs', 'invalidRefs', 'missingRefs', 'staleRefs'],
    diagnostics: ['claim_source_diversity', 'largest_group_share', 'new_aspect_rate', 'new_claim_rate', 'new_contradiction_rate', 'new_expert_rate', 'novelty_gain', 'per_group_selection_coverage', 'selected_author_concentration', 'selected_content_by_group', 'selected_content_type_distribution', 'selected_source_group_count'],
  };
  for (const [node, keys] of Object.entries(EXPECTED_KEYS)) {
    const target = node === '' ? canonical : node.split('.').reduce((acc, part) => acc[part], canonical);
    assert.deepEqual(Object.keys(target).sort(), keys, `keyset changed at: ${node || '<root>'}`);
  }
});
