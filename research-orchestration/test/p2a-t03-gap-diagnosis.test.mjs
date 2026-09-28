/**
 * research-orchestration/test/p2a-t03-gap-diagnosis.test.mjs
 *
 * P2A-T03 (#115) focused tests — gap diagnosis (provenance-coverage only).
 *
 * Authority (semantics are FROZEN; this suite must not reinterpret them):
 *   - docs/specs/p2-ari-f02-targeted-requery.md                 §5 D1, §6
 *   - docs/planning/..._SEAM_CONTRACT_V1.md                     E.1, E.3, E.3.1, E.8
 *   - docs/planning/..._SEAM_MAP_V1.md                          S1
 *   - docs/architecture/key-decisions.md                        D12-1
 *   - Ticket Decomposition §P2A-T03; Issue #115 GOAL / IN_SCOPE / OUT_OF_SCOPE /
 *     ACCEPTANCE_CRITERIA 1–5 / REQUIRED_TESTS / COUNTEREXAMPLES
 *
 * T03 owns: the diagnosis module, the provenance-coverage computation, the judgment
 * for the three gap types, the candidate plan-owned material output (audit), the
 * read-only guarantee and FAIL_CLOSED.
 * T03 explicitly does NOT own: any text / lexical / embedding attribution, any
 * "this content belongs to that aspect" judgment, writes back into pool / coverage /
 * plan, authorization (T05), retrieval IO, T01 ledger schema.
 *
 * Anti-tautology discipline: expected subjects / types are literal fixtures written
 * from the frozen contract; ledger validity is asserted through T01's own
 * self-verifying validator (a different module), never by re-deriving ids here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DIAGNOSIS_ERROR_INVALID,
  diagnoseGaps,
} from '../lib/targeted-requery-diagnosis.mjs';

import {
  GAP_TYPE_ASPECT,
  GAP_TYPE_AUTHORITY,
  GAP_TYPE_CONTRADICTION,
  GAP_TYPE_UNKNOWN,
  validateLedger,
} from '../lib/targeted-requery-ledger.mjs';

const MODULE_PATH = fileURLToPath(new URL('../lib/targeted-requery-diagnosis.mjs', import.meta.url));

const PLAN_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OCCURRENCE_ID = 'occ-t03-oracle';
const ROUND = 0;

/** A minimal VALID plan (passes plan-contract validatePlanInput). */
function basePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    queryVariants: ['zhihu research quality baseline'],
    aspects: ['AI ethics governance'],
    entities: [],
    opposingFramings: ['market driven development'],
    terminologyVariants: [],
    sourceGroupIntents: [],
    ...overrides,
  };
}

function diagnose(overrides = {}) {
  return diagnoseGaps({
    plan: basePlan(),
    executedQueryProvenance: [],
    planHash: PLAN_HASH,
    occurrenceId: OCCURRENCE_ID,
    diagnosisRound: ROUND,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// A. source guards — the hard prohibitions
// ---------------------------------------------------------------------------

test('A1 — the diagnosis module performs ZERO filesystem IO (read-only by construction)', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(/from 'node:fs'/.test(source), false);
  assert.equal(/from 'node:path'/.test(source), false);
  assert.equal(/writeFileSync|mkdirSync|renameSync|appendFileSync/.test(source), false);
});

test('A2 — identity and normalization are REUSED, never re-derived', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  // gap identity + subject normalization come from T01
  assert.equal(/from '\.\/targeted-requery-ledger\.mjs'/.test(source), true);
  assert.equal(/makeGapRecord/.test(source), true);
  assert.equal(/normalizeSubjectString/.test(source), true);
  // no second normalization formula and no clock / randomness
  assert.equal(/NFC/.test(source), false);
  assert.equal(/toLowerCase/.test(source), false);
  assert.equal(/Date\.now\(\)|new Date\(\)|Math\.random|randomUUID/.test(source), false);
  // the plan gate is the EXISTING plan-contract validator
  assert.equal(/validatePlanInput/.test(source), true);
});

// ---------------------------------------------------------------------------
// B. E.3.1 — provenance coverage, not content attribution
// ---------------------------------------------------------------------------

test('B1 — an aspect never covered by executed-query provenance → ASPECT_GAP', () => {
  const result = diagnose();
  assert.equal(result.ok, true);
  const aspectGaps = result.records.filter((r) => r.gapType === GAP_TYPE_ASPECT);
  assert.equal(aspectGaps.length, 1);
  assert.equal(aspectGaps[0].subjectKey, 'aspect:ai ethics governance');
});

test('B2 — an aspect ALREADY covered by executed-query provenance → NOT diagnosed', () => {
  const result = diagnose({
    executedQueryProvenance: ['other executed query', 'AI Ethics Governance'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.records.filter((r) => r.gapType === GAP_TYPE_ASPECT).length, 0);
});

test('B3 — an opposingFraming never executed → CONTRADICTION_GAP (frozen counterexample)', () => {
  const result = diagnose();
  const framingGaps = result.records.filter((r) => r.gapType === GAP_TYPE_CONTRADICTION);
  assert.equal(framingGaps.length, 1);
  assert.equal(framingGaps[0].subjectKey, 'opposing:market driven development');
});

test('B4 — an opposingFraming already executed → NOT diagnosed', () => {
  const result = diagnose({
    executedQueryProvenance: ['market driven development'],
  });
  assert.equal(result.records.filter((r) => r.gapType === GAP_TYPE_CONTRADICTION).length, 0);
});

test('B5 — coverage equivalence goes through the FROZEN normalization (trim/NFC/casefold)', () => {
  const result = diagnose({
    executedQueryProvenance: ['  AI ETHICS   governance  '],
  });
  assert.equal(result.records.filter((r) => r.gapType === GAP_TYPE_ASPECT).length, 0);
});

test('B6 — unnormalizable provenance entries are skipped, never fatal and never matching', () => {
  const result = diagnose({
    executedQueryProvenance: ['/Users/someone/private', 'AI ethics governance'],
  });
  assert.equal(result.ok, true);
  // the private path cannot normalize, so it cannot cover anything — but the
  // legitimate entry still covers the aspect
  assert.equal(result.records.filter((r) => r.gapType === GAP_TYPE_ASPECT).length, 0);
  assert.equal(result.records.filter((r) => r.gapType === GAP_TYPE_CONTRADICTION).length, 1);
});

test('B7 — queryVariants coverage does NOT clear aspect gaps (baseline only runs queryVariants)', () => {
  const result = diagnose({
    executedQueryProvenance: ['zhihu research quality baseline'],
  });
  assert.equal(result.records.filter((r) => r.gapType === GAP_TYPE_ASPECT).length, 1);
});

// ---------------------------------------------------------------------------
// C. AUTHORITY_GAP is proposal-driven, never coverage-driven
// ---------------------------------------------------------------------------

test('C1 — plan.sourceGroupIntents[i].intent → AUTHORITY_GAP (plan-owned mechanical source)', () => {
  const result = diagnose({
    plan: basePlan({
      sourceGroupIntents: [{ intent: 'authoritative policy documents', constraints: [], groupKey: null }],
    }),
  });
  const authority = result.records.filter((r) => r.gapType === GAP_TYPE_AUTHORITY);
  assert.equal(authority.length, 1);
  assert.equal(authority[0].subjectKey, 'intent:authoritative policy documents');
});

test('C2 — an explicit expectedInformation proposal → intent-freeform AUTHORITY_GAP', () => {
  const result = diagnose({
    proposedAuthorityGaps: [{ expectedInformation: 'peer reviewed comparisons' }],
  });
  const authority = result.records.filter((r) => r.gapType === GAP_TYPE_AUTHORITY);
  assert.equal(authority.length, 1);
  assert.match(authority[0].subjectKey, /^intent-freeform:[0-9a-f]{64}$/);
});

test('C3 — AUTHORITY_GAP is never produced by coverage absence', () => {
  // no sourceGroupIntents, no proposals → zero AUTHORITY gaps, whatever is uncovered
  const result = diagnose();
  assert.equal(result.records.filter((r) => r.gapType === GAP_TYPE_AUTHORITY).length, 0);
});

test('C4 — an unnormalizable proposal expectedInformation fails closed (typed)', () => {
  assert.throws(
    () => diagnose({ proposedAuthorityGaps: [{ expectedInformation: '/Users/someone/private' }] }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
});

test('C5 — a malformed proposal entry fails closed (typed)', () => {
  assert.throws(
    () => diagnose({ proposedAuthorityGaps: ['free text'] }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
  assert.throws(
    () => diagnose({ proposedAuthorityGaps: [{ noExpectedInformation: true }] }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
});

// ---------------------------------------------------------------------------
// D. FAIL_CLOSED — unreadable state produces no gaps and never continues silently
// ---------------------------------------------------------------------------

test('D1 — an invalid plan fails closed (missing / unknown fields)', () => {
  assert.throws(() => diagnose({ plan: { schemaVersion: 1 } }), (err) => err.code === DIAGNOSIS_ERROR_INVALID);
  assert.throws(
    () => diagnose({ plan: basePlan({ unexpectedField: 1 }) }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
});

test('D2 — a non-object plan / malformed anchors fail closed (typed)', () => {
  assert.throws(() => diagnose({ plan: 'not a plan' }), (err) => err.code === DIAGNOSIS_ERROR_INVALID);
  assert.throws(
    () => diagnose({ planHash: 'zz' }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
  assert.throws(
    () => diagnose({ occurrenceId: '' }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
  assert.throws(
    () => diagnose({ diagnosisRound: -1 }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
});

test('D3 — a malformed provenance input fails closed (typed)', () => {
  assert.throws(
    () => diagnose({ executedQueryProvenance: 'not an array' }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
  assert.throws(
    () => diagnose({ executedQueryProvenance: [42] }),
    (err) => err.code === DIAGNOSIS_ERROR_INVALID,
  );
});

// ---------------------------------------------------------------------------
// E. determinism + canonical persistence shape (via T01's own validator)
// ---------------------------------------------------------------------------

test('E1 — same input → identical output (mechanically recomputable)', () => {
  const a = diagnose();
  const b = diagnose();
  assert.deepEqual(a, b);
});

test('E2 — the produced ledger is valid under T01’s own self-verifying validator', () => {
  const result = diagnose();
  const verdict = validateLedger(result.ledger);
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.validated.planHash, PLAN_HASH);
  assert.equal(verdict.validated.occurrenceId, OCCURRENCE_ID);
});

test('E3 — duplicate normalized materials collapse to ONE gap (no duplicate gapId)', () => {
  const result = diagnose({
    plan: basePlan({ aspects: ['AI ethics governance', 'AI  Ethics governance'] }),
  });
  const aspectGaps = result.records.filter((r) => r.gapType === GAP_TYPE_ASPECT);
  assert.equal(aspectGaps.length, 1);
  const ids = new Set(result.records.map((r) => r.gapId));
  assert.equal(ids.size, result.records.length);
});

test('E4 — records are in canonical gapId order (E.8 persistence shape via T01)', () => {
  const result = diagnose({
    plan: basePlan({
      aspects: ['aspect one', 'aspect two'],
      opposingFramings: ['framing one', 'framing two'],
    }),
  });
  const ids = result.records.map((r) => r.gapId);
  assert.deepEqual([...ids].sort(), ids);
});

test('E5 — diagnosisRound is audit-only: a different round re-diagnoses the same subject', () => {
  const r0 = diagnose({ diagnosisRound: 0 });
  const r1 = diagnose({ diagnosisRound: 1 });
  assert.equal(r0.records[0].gapIdentityCore, r1.records[0].gapIdentityCore);
  assert.notEqual(r0.records[0].gapId, r1.records[0].gapId);
});

// ---------------------------------------------------------------------------
// F. read-only + output shape + closed enum
// ---------------------------------------------------------------------------

test('F1 — diagnosis never mutates the caller’s plan (deep-frozen input)', () => {
  const plan = Object.freeze({
    ...basePlan({ aspects: ['frozen aspect'] }),
    sourceGroupIntents: Object.freeze([]),
  });
  const result = diagnose({ plan });
  assert.equal(result.ok, true);
  assert.equal(result.records.some((r) => r.gapType === GAP_TYPE_ASPECT), true);
});

test('F2 — output shape: { ok, ledger, records, candidateMaterials }', () => {
  const result = diagnose();
  assert.deepEqual(Object.keys(result).sort(), ['candidateMaterials', 'ledger', 'ok', 'records']);
  assert.deepEqual(Object.keys(result.candidateMaterials).sort(), [
    'aspectMaterials', 'intentMaterials', 'opposingFramingMaterials',
  ]);
  assert.deepEqual(result.candidateMaterials.aspectMaterials, ['ai ethics governance']);
  assert.deepEqual(result.candidateMaterials.opposingFramingMaterials, ['market driven development']);
  assert.deepEqual(result.candidateMaterials.intentMaterials, []);
});

test('F3 — UNKNOWN_GAP_TYPE can never enter the diagnosis output', () => {
  const result = diagnose({
    plan: basePlan({
      aspects: ['aspect one', 'aspect two'],
      opposingFramings: ['framing one'],
      sourceGroupIntents: [{ intent: 'intent one', constraints: [], groupKey: null }],
    }),
    proposedAuthorityGaps: [{ expectedInformation: 'some expected information' }],
  });
  for (const record of result.records) {
    assert.notEqual(record.gapType, GAP_TYPE_UNKNOWN);
    assert.notEqual(record.gapType, 'executing');
    assert.equal([GAP_TYPE_ASPECT, GAP_TYPE_CONTRADICTION, GAP_TYPE_AUTHORITY].includes(record.gapType), true);
  }
  assert.equal(validateLedger(result.ledger).ok, true);
});
