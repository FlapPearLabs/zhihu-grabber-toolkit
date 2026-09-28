/**
 * research-orchestration/test/p2a-t08-gap-reevaluation-resolution.test.mjs
 *
 * P2A-T08 (#120) focused tests — gap re-evaluation, resolution predicates, terminal
 * semantics.
 *
 * Authority (semantics are FROZEN; this suite must not reinterpret them):
 *   - docs/specs/p2-ari-f02-targeted-requery.md                 §13, §14, §18, §20-8/§20-9
 *   - docs/planning/..._SEAM_CONTRACT_V1.md                     G.1–G.5.1, H-6 / H-7 / H-8
 *   - docs/planning/..._SEAM_MAP_V1.md                          S9, S10
 *   - Ticket Decomposition §P2A-T08; Issue #120 GOAL / IN_SCOPE / OUT_OF_SCOPE /
 *     ACCEPTANCE_CRITERIA / REQUIRED_TESTS / COUNTEREXAMPLES C6, C7, C8
 *
 * T08 owns: the re-evaluation module, the three resolution predicates (including
 * NONE_REGISTERED), the resolutionBasis set, the G.5.1 terminal rule and the H-8
 * run-stop finalisation rule.
 * T08 explicitly does NOT own: any #111 authority predicate, heat / likes /
 * verified-badge / authorRef as an authority proxy, any stance / sentiment /
 * text-attribution classifier, terminal visibility rendering (T10), orchestration
 * (T09), STOP / attempt accounting (T07), retrieval IO.
 *
 * Anti-tautology discipline: expected values below are literal known-good fixtures
 * written from the frozen contract (not produced by the module under test). Every
 * questionId used is a canonical Zhihu id (`/^[1-9]\d*$/`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RESOLUTION_BASES,
  RESOLUTION_BASIS_DUPLICATE_ONLY,
  RESOLUTION_BASIS_GAP_TYPE_NOT_ACTIONABLE,
  RESOLUTION_BASIS_NEVER_AUTHORIZED,
  RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
  RESOLUTION_BASIS_NO_NEW_EVIDENCE,
  RESOLUTION_BASIS_OPPOSING_SIDE_NEW_EVIDENCE,
  RESOLUTION_BASIS_OPERATIONAL_FAILURE,
  RESOLUTION_BASIS_PER_GAP_BOUND_EXHAUSTED,
  RESOLUTION_BASIS_PROVIDER_FAILURE,
  RESOLUTION_BASIS_RUN_BUDGET_STOP,
  RESOLUTION_BASIS_RUN_SATURATED,
  RESOLUTION_BASIS_SAME_SIDE_ONLY,
  RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
  RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED,
  RESOLUTION_BASIS_BUDGET_PREFLIGHT_REJECTED,
  RESOLUTION_ERROR_INVALID,
  RESOLUTION_FILENAME,
  RESOLUTION_PREDICATES,
  RESOLUTION_PREDICATE_ASPECT,
  RESOLUTION_PREDICATE_NONE_REGISTERED,
  RESOLUTION_PREDICATE_OPPOSING,
  RESOLUTION_SCHEMA,
  TERMINATION_ACTION_OPERATIONAL_FAILURE,
  TERMINATION_BUDGET_PREFLIGHT_REJECTED,
  TERMINATION_NEVER_AUTHORIZED,
  TERMINATION_NONE,
  TERMINATION_PER_GAP_BOUND_EXHAUSTED,
  TERMINATION_REASONS,
  TERMINATION_RUN_BUDGET_STOP,
  TERMINATION_RUN_PROVIDER_FAILURE,
  TERMINATION_RUN_SATURATED,
  classifyGapTerminal,
  computeNewEvidenceIds,
  createResolutionArtifact,
  evaluateResolution,
  finalizeGapsOnRunStop,
  loadResolutionArtifact,
  persistResolutionArtifact,
  recordResolution,
  validateResolutionArtifact,
} from '../lib/targeted-requery-resolution.mjs';

import {
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
} from '../lib/targeted-requery-lifecycle.mjs';
import {
  GAP_TYPE_ASPECT,
  GAP_TYPE_AUTHORITY,
  GAP_TYPE_CONTRADICTION,
  GAP_TYPE_UNKNOWN,
} from '../lib/targeted-requery-ledger.mjs';

const PLAN_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OCCURRENCE_ID = 'occ-t08-oracle';
const GAP_IDENTITY_CORE = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const GAP_ID = `${GAP_IDENTITY_CORE}:0`;

const MODULE_PATH = fileURLToPath(new URL('../lib/targeted-requery-resolution.mjs', import.meta.url));

function freshWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p2a-t08-'));
}

function emptyArtifact() {
  return createResolutionArtifact({ planHash: PLAN_HASH, occurrenceId: OCCURRENCE_ID });
}

// ---------------------------------------------------------------------------
// A. closed vocabularies
// ---------------------------------------------------------------------------

test('A1 — the resolution predicate set is closed (three members, incl. NONE_REGISTERED)', () => {
  assert.deepEqual([...RESOLUTION_PREDICATES].sort(), [
    'ASPECT_MIN_NEW_SOURCES_V1',
    'NONE_REGISTERED',
    'OPPOSING_SIDE_NEW_SOURCES_V1',
  ]);
  assert.equal(RESOLUTION_PREDICATES.length, 3);
  // #111 is NOT implemented: there is deliberately no AUTHORITY predicate member.
  assert.equal(RESOLUTION_PREDICATES.some((p) => /AUTHORITY/i.test(p)), false);
});

test('A2 — the resolutionBasis set is closed and contains no authority proxy', () => {
  assert.equal(RESOLUTION_BASES.length, 15);
  for (const basis of RESOLUTION_BASES) {
    assert.equal(typeof basis, 'string');
    assert.equal(basis.length > 0, true);
  }
  // G-A4 / OUT_OF_SCOPE: heat / likes / authority proxies are never a basis.
  for (const forbidden of ['HEAT', 'LIKES', 'UPVOTES', 'AUTHOR_REF', 'VERIFIED_BADGE', 'POPULARITY']) {
    assert.equal(RESOLUTION_BASES.includes(forbidden), false, `forbidden basis ${forbidden}`);
  }
});

test('A3 — the termination-reason set is closed and SATURATED is never a gap terminal', () => {
  assert.deepEqual([...TERMINATION_REASONS].sort(), [
    'ACTION_OPERATIONAL_FAILURE',
    'BUDGET_PREFLIGHT_REJECTED',
    'NEVER_AUTHORIZED',
    'NONE',
    'PER_GAP_BOUND_EXHAUSTED',
    'RUN_BUDGET_STOP',
    'RUN_PROVIDER_FAILURE',
    'RUN_SATURATED',
  ]);
  // 'SATURATED' is only ever an INPUT (a run-level stop reason), never an OUTPUT status.
  assert.equal(RESOLUTION_BASES.includes('SATURATED'), false);
  assert.notEqual(ACTION_STATUS_RESOLVED, 'SATURATED');
});

// ---------------------------------------------------------------------------
// B. G.1 / G.2 — new evidence is canonical-questionId novelty
// ---------------------------------------------------------------------------

test('B1 — new evidence = targeted fused ids minus the pre-action pool', () => {
  const result = computeNewEvidenceIds({
    priorQuestionIds: ['100', '200', '300'],
    targetedQuestionIds: ['200', '400', '100', '500'],
  });
  assert.deepEqual(result.newEvidenceIds, ['400', '500']);
});

test('B2 — duplicates inside one action collapse to one', () => {
  const result = computeNewEvidenceIds({
    priorQuestionIds: [],
    targetedQuestionIds: ['700', '700', '700'],
  });
  assert.deepEqual(result.newEvidenceIds, ['700']);
});

test('B3 — non-canonical questionIds fail closed (typed error, never silently dropped)', () => {
  for (const bad of ['0123', '0', 'abc', '', '12a', 100, null]) {
    assert.throws(
      () => computeNewEvidenceIds({ priorQuestionIds: [], targetedQuestionIds: [bad] }),
      (err) => err.code === RESOLUTION_ERROR_INVALID,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
    assert.throws(
      () => computeNewEvidenceIds({ priorQuestionIds: [bad], targetedQuestionIds: ['100'] }),
      (err) => err.code === RESOLUTION_ERROR_INVALID,
      `expected rejection for prior ${JSON.stringify(bad)}`,
    );
  }
});

test('B4 — novelty is questionId identity, never a count and never text similarity', () => {
  // Same count, entirely overlapping ids  → zero new evidence.
  const sameCount = computeNewEvidenceIds({
    priorQuestionIds: ['1', '2', '3'],
    targetedQuestionIds: ['1', '2', '3'],
  });
  assert.deepEqual(sameCount.newEvidenceIds, []);
  // One id, brand new → one new evidence.
  const oneNew = computeNewEvidenceIds({
    priorQuestionIds: ['1', '2', '3'],
    targetedQuestionIds: ['9'],
  });
  assert.deepEqual(oneNew.newEvidenceIds, ['9']);
});

// ---------------------------------------------------------------------------
// C. G.4 / G.5 — the three predicates
// ---------------------------------------------------------------------------

test('C1 — ASPECT_GAP: ≥1 new canonical source → RESOLVED', () => {
  const verdict = evaluateResolution({
    gapType: GAP_TYPE_ASPECT,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['400'],
  });
  assert.equal(verdict.status, ACTION_STATUS_RESOLVED);
  assert.equal(verdict.resolutionPredicateRef, RESOLUTION_PREDICATE_ASPECT);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED);
});

test('C2 — ASPECT_GAP: zero new evidence → UNRESOLVED (never RESOLVED)', () => {
  const none = evaluateResolution({
    gapType: GAP_TYPE_ASPECT,
    priorQuestionIds: ['100'],
    targetedQuestionIds: [],
  });
  assert.equal(none.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(none.resolutionBasis, RESOLUTION_BASIS_NO_NEW_EVIDENCE);

  const allDupes = evaluateResolution({
    gapType: GAP_TYPE_ASPECT,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['100', '100'],
  });
  assert.equal(allDupes.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(allDupes.resolutionBasis, RESOLUTION_BASIS_DUPLICATE_ONLY);
});

test('C3 — AUTHORITY_GAP: NONE_REGISTERED → UNRESOLVED even WITH new evidence (C8)', () => {
  const verdict = evaluateResolution({
    gapType: GAP_TYPE_AUTHORITY,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['400', '500', '600'],
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionPredicateRef, RESOLUTION_PREDICATE_NONE_REGISTERED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE);
  // #111 is out of scope: no authority predicate may be registered here.
  assert.notEqual(verdict.resolutionPredicateRef, 'AUTHORITY_PREDICATE_V1');
});

test('C4 — CONTRADICTION_GAP: new evidence on the OTHER declared side → RESOLVED', () => {
  const verdict = evaluateResolution({
    gapType: GAP_TYPE_CONTRADICTION,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['400'],
    declaredFraming: 'opposing:market-driven',
    coveredFramings: ['opposing:regulation-driven'],
  });
  assert.equal(verdict.status, ACTION_STATUS_RESOLVED);
  assert.equal(verdict.resolutionPredicateRef, RESOLUTION_PREDICATE_OPPOSING);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_OPPOSING_SIDE_NEW_EVIDENCE);
});

test('C5 — CONTRADICTION_GAP: same side again → UNRESOLVED (C7)', () => {
  const verdict = evaluateResolution({
    gapType: GAP_TYPE_CONTRADICTION,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['400'],
    declaredFraming: 'opposing:market-driven',
    coveredFramings: ['opposing:market-driven'],
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_SAME_SIDE_ONLY);
});

test('C6 — CONTRADICTION_GAP: side undecidable → UNKNOWN → UNRESOLVED, never guessed', () => {
  const noDeclared = evaluateResolution({
    gapType: GAP_TYPE_CONTRADICTION,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['400'],
    declaredFraming: null,
    coveredFramings: ['opposing:regulation-driven'],
  });
  assert.equal(noDeclared.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(noDeclared.resolutionBasis, RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED);

  const noCovered = evaluateResolution({
    gapType: GAP_TYPE_CONTRADICTION,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['400'],
    declaredFraming: 'opposing:market-driven',
    coveredFramings: null,
  });
  assert.equal(noCovered.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(noCovered.resolutionBasis, RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED);
});

test('C7 — UNKNOWN_GAP_TYPE is never resolvable', () => {
  const verdict = evaluateResolution({
    gapType: GAP_TYPE_UNKNOWN,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['400'],
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_GAP_TYPE_NOT_ACTIONABLE);
});

test('C8 — an EMPTY covered-side list is not "nothing covered yet": it is undecidable', () => {
  // No provenance of an already-covered side exists, so opposition cannot be
  // demonstrated → fail closed, never guessed.
  const verdict = evaluateResolution({
    gapType: GAP_TYPE_CONTRADICTION,
    priorQuestionIds: ['100'],
    targetedQuestionIds: ['400'],
    declaredFraming: 'opposing:market-driven',
    coveredFramings: [],
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_UNKNOWN_SIDE_NOT_DECLARED);
});

// ---------------------------------------------------------------------------
// D. G.3 — the closed "this is not resolution" list
// ---------------------------------------------------------------------------

test('D1 — "the query was executed" alone is never resolution', () => {
  const verdict = evaluateResolution({
    gapType: GAP_TYPE_ASPECT,
    priorQuestionIds: ['100'],
    targetedQuestionIds: [],
    executed: true,
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_NO_NEW_EVIDENCE);
});

test('D2 — "provider returned a non-zero count" is never resolution', () => {
  const verdict = evaluateResolution({
    gapType: GAP_TYPE_ASPECT,
    priorQuestionIds: ['100', '200', '300'],
    targetedQuestionIds: ['100', '200', '300', '100'],
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_DUPLICATE_ONLY);
});

test('D3 — a model assertion is never resolution (no verdict input is accepted)', () => {
  // The public evaluation surface has no field through which a model (or anyone)
  // can declare the outcome; an unknown assertion key must not change the verdict.
  const withAssertion = evaluateResolution({
    gapType: GAP_TYPE_ASPECT,
    priorQuestionIds: ['100'],
    targetedQuestionIds: [],
    modelAssertion: 'found authoritative sources',
  });
  assert.equal(withAssertion.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(evaluateResolution({
    gapType: GAP_TYPE_ASPECT,
    priorQuestionIds: ['100'],
    targetedQuestionIds: [],
  }).status, withAssertion.status);
});

// ---------------------------------------------------------------------------
// E. G.5.1 — EXHAUSTED_WITHIN_BUDGET vs UNRESOLVED
// ---------------------------------------------------------------------------

test('E1 — budget-class terminations with ≥1 authorization → EXHAUSTED_WITHIN_BUDGET', () => {
  for (const [reason, basis] of [
    [TERMINATION_PER_GAP_BOUND_EXHAUSTED, RESOLUTION_BASIS_PER_GAP_BOUND_EXHAUSTED],
    [TERMINATION_BUDGET_PREFLIGHT_REJECTED, RESOLUTION_BASIS_BUDGET_PREFLIGHT_REJECTED],
    [TERMINATION_RUN_BUDGET_STOP, RESOLUTION_BASIS_RUN_BUDGET_STOP],
  ]) {
    const verdict = classifyGapTerminal({
      predicateResult: {
        status: ACTION_STATUS_UNRESOLVED,
        resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
        resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
      },
      terminationReason: reason,
      everAuthorized: true,
    });
    assert.equal(verdict.status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET, `reason ${reason}`);
    assert.equal(verdict.resolutionBasis, basis, `reason ${reason}`);
  }
});

test('E2 — SATURATED is NEVER written as EXHAUSTED_WITHIN_BUDGET (G.5.1 prohibition)', () => {
  const verdict = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    },
    terminationReason: TERMINATION_RUN_SATURATED,
    everAuthorized: true,
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_RUN_SATURATED);
  assert.notEqual(verdict.status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET);
});

test('E3 — PROVIDER_FAILURE is never written as EXHAUSTED (failure ≠ budget fact)', () => {
  const verdict = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    },
    terminationReason: TERMINATION_RUN_PROVIDER_FAILURE,
    everAuthorized: true,
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_PROVIDER_FAILURE);
});

test('E4 — H-6: operational failure ≠ resolved ≠ saturation ≠ "no more evidence"', () => {
  const verdict = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    },
    terminationReason: TERMINATION_ACTION_OPERATIONAL_FAILURE,
    everAuthorized: true,
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_OPERATIONAL_FAILURE);
  assert.notEqual(verdict.status, ACTION_STATUS_RESOLVED);
});

test('E5 — never authorized → UNRESOLVED, even under a budget-class termination', () => {
  const verdict = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    },
    terminationReason: TERMINATION_PER_GAP_BOUND_EXHAUSTED,
    everAuthorized: false,
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_NEVER_AUTHORIZED);

  const never = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    },
    terminationReason: TERMINATION_NEVER_AUTHORIZED,
    everAuthorized: false,
  });
  assert.equal(never.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(never.resolutionBasis, RESOLUTION_BASIS_NEVER_AUTHORIZED);
});

test('E6 — a satisfied predicate wins: RESOLVED is never downgraded by a stop reason', () => {
  for (const reason of [
    TERMINATION_NONE,
    TERMINATION_PER_GAP_BOUND_EXHAUSTED,
    TERMINATION_RUN_SATURATED,
    TERMINATION_RUN_PROVIDER_FAILURE,
    TERMINATION_ACTION_OPERATIONAL_FAILURE,
  ]) {
    const verdict = classifyGapTerminal({
      predicateResult: {
        status: ACTION_STATUS_RESOLVED,
        resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
        resolutionBasis: RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
      },
      terminationReason: reason,
      everAuthorized: true,
    });
    assert.equal(verdict.status, ACTION_STATUS_RESOLVED, `reason ${reason}`);
  }
});

test('E7 — no termination and no predicate → plain UNRESOLVED with the real basis', () => {
  const verdict = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_OPPOSING,
      resolutionBasis: RESOLUTION_BASIS_SAME_SIDE_ONLY,
    },
    terminationReason: TERMINATION_NONE,
    everAuthorized: true,
  });
  assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
  assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_SAME_SIDE_ONLY);
});

// ---------------------------------------------------------------------------
// F. H-8 — run-level STOP finalisation (nothing may be silently dropped)
// ---------------------------------------------------------------------------

test('F1 — H-8: every non-terminal gap is explicitly finalised and stays visible', () => {
  const gaps = [
    { gapId: `${GAP_IDENTITY_CORE}:2`, status: null, everAuthorized: true },
    { gapId: `${GAP_IDENTITY_CORE}:0`, status: null, everAuthorized: false },
    { gapId: `${GAP_IDENTITY_CORE}:1`, status: ACTION_STATUS_RESOLVED, everAuthorized: true },
  ];
  const result = finalizeGapsOnRunStop({ gaps, runStopReason: TERMINATION_RUN_BUDGET_STOP });
  assert.equal(result.gaps.length, 3);
  // deterministic ascending gapId order
  assert.deepEqual(result.gaps.map((g) => g.gapId), [
    `${GAP_IDENTITY_CORE}:0`,
    `${GAP_IDENTITY_CORE}:1`,
    `${GAP_IDENTITY_CORE}:2`,
  ]);
  const byId = new Map(result.gaps.map((g) => [g.gapId, g]));
  assert.equal(byId.get(`${GAP_IDENTITY_CORE}:2`).status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET);
  assert.equal(byId.get(`${GAP_IDENTITY_CORE}:0`).status, ACTION_STATUS_UNRESOLVED);
  assert.equal(byId.get(`${GAP_IDENTITY_CORE}:0`).resolutionBasis, RESOLUTION_BASIS_NEVER_AUTHORIZED);
  // an already-RESOLVED gap is not rewritten
  assert.equal(byId.get(`${GAP_IDENTITY_CORE}:1`).status, ACTION_STATUS_RESOLVED);
});

test('F2 — H-8 under SATURATED: no gap is marked EXHAUSTED_WITHIN_BUDGET', () => {
  const result = finalizeGapsOnRunStop({
    gaps: [
      { gapId: `${GAP_IDENTITY_CORE}:0`, status: null, everAuthorized: true },
      { gapId: `${GAP_IDENTITY_CORE}:1`, status: null, everAuthorized: true },
    ],
    runStopReason: TERMINATION_RUN_SATURATED,
  });
  for (const gap of result.gaps) {
    assert.equal(gap.status, ACTION_STATUS_UNRESOLVED);
    assert.equal(gap.resolutionBasis, RESOLUTION_BASIS_RUN_SATURATED);
    assert.notEqual(gap.status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET);
  }
});

test('F3 — H-8 under PROVIDER_FAILURE: nothing is marked resolved or exhausted', () => {
  const result = finalizeGapsOnRunStop({
    gaps: [{ gapId: GAP_ID, status: null, everAuthorized: true }],
    runStopReason: TERMINATION_RUN_PROVIDER_FAILURE,
  });
  assert.equal(result.gaps[0].status, ACTION_STATUS_UNRESOLVED);
  assert.equal(result.gaps[0].resolutionBasis, RESOLUTION_BASIS_PROVIDER_FAILURE);
});

// ---------------------------------------------------------------------------
// G. persistence
// ---------------------------------------------------------------------------

test('G1 — artifact round-trip, canonical order, stale anchor fails closed', () => {
  const workDir = freshWorkDir();
  const art = emptyArtifact();
  assert.equal(art.schema, RESOLUTION_SCHEMA);
  const persisted = persistResolutionArtifact(workDir, art);
  assert.equal(persisted.path, RESOLUTION_FILENAME);
  const loaded = loadResolutionArtifact(workDir, PLAN_HASH);
  assert.equal(loaded.ok, true, loaded.reason);
  assert.equal(loaded.artifact.planHash, PLAN_HASH);
  assert.equal(loadResolutionArtifact(workDir, 'f'.repeat(64)).reason, 'stale_plan_hash');
  assert.equal(validateResolutionArtifact({ ...art, schema: 'other/v1' }).ok, false);
  assert.equal(validateResolutionArtifact({ ...art, extra: 1 }).ok, false);
});

test('G2 — recording a resolution is append-only and RESOLVED is sticky', () => {
  const workDir = freshWorkDir();
  let art = emptyArtifact();
  art = recordResolution(art, {
    gapId: GAP_ID,
    gapIdentityCore: GAP_IDENTITY_CORE,
    planHash: PLAN_HASH,
    occurrenceId: OCCURRENCE_ID,
    targetedActionId: 'a'.repeat(64),
    status: ACTION_STATUS_RESOLVED,
    resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
    newEvidenceIds: ['400'],
  });
  const first = JSON.parse(JSON.stringify(art.resolutions[0]));
  // a later UNRESOLVED evaluation must NOT downgrade a RESOLVED gap
  art = recordResolution(art, {
    gapId: GAP_ID,
    gapIdentityCore: GAP_IDENTITY_CORE,
    planHash: PLAN_HASH,
    occurrenceId: OCCURRENCE_ID,
    targetedActionId: 'b'.repeat(64),
    status: ACTION_STATUS_UNRESOLVED,
    resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    newEvidenceIds: [],
  });
  assert.equal(art.resolutions.length, 1);
  assert.equal(art.resolutions[0].status, ACTION_STATUS_RESOLVED);
  // audit history is preserved, never rewritten
  assert.deepEqual(art.resolutions[0].audit.slice(0, first.audit.length), first.audit);
  assert.equal(art.resolutions[0].evaluatedActionIds.length, 2);
});

test('G3 — a caller cannot bypass the predicates by handing in a bare RESOLVED', () => {
  const art = emptyArtifact();
  // RESOLVED + NONE_REGISTERED is not producible by any frozen predicate.
  assert.throws(
    () => recordResolution(art, {
      gapId: GAP_ID,
      gapIdentityCore: GAP_IDENTITY_CORE,
      targetedActionId: 'c'.repeat(64),
      status: ACTION_STATUS_RESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED,
      resolutionBasis: RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
      newEvidenceIds: ['400'],
    }),
    (err) => err.code === RESOLUTION_ERROR_INVALID,
  );
  // RESOLVED carrying an UNKNOWN basis is equally impossible.
  assert.throws(
    () => recordResolution(art, {
      gapId: GAP_ID,
      gapIdentityCore: GAP_IDENTITY_CORE,
      targetedActionId: 'c'.repeat(64),
      status: ACTION_STATUS_RESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
      newEvidenceIds: ['400'],
    }),
    (err) => err.code === RESOLUTION_ERROR_INVALID,
  );
  assert.equal(art.resolutions.length, 0);
});

test('G4 — H-8 finalisation records carry no action id and stay valid', () => {
  const art = recordResolution(emptyArtifact(), {
    gapId: GAP_ID,
    gapIdentityCore: GAP_IDENTITY_CORE,
    targetedActionId: null,
    status: ACTION_STATUS_UNRESOLVED,
    resolutionPredicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED,
    resolutionBasis: RESOLUTION_BASIS_NEVER_AUTHORIZED,
    newEvidenceIds: [],
  });
  assert.equal(art.resolutions.length, 1);
  assert.equal(art.resolutions[0].status, ACTION_STATUS_UNRESOLVED);
  assert.deepEqual(art.resolutions[0].evaluatedActionIds, []);
  const loaded = loadResolutionArtifact(freshWorkDir(), PLAN_HASH,);
  assert.equal(loaded.ok, false); // nothing persisted yet — the record lives in memory
});

test('G5 — evidence ACCUMULATES across evaluations for one gap', () => {
  let art = emptyArtifact();
  art = recordResolution(art, {
    gapId: GAP_ID,
    gapIdentityCore: GAP_IDENTITY_CORE,
    targetedActionId: 'a'.repeat(64),
    status: ACTION_STATUS_RESOLVED,
    resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
    newEvidenceIds: ['400'],
  });
  art = recordResolution(art, {
    gapId: GAP_ID,
    gapIdentityCore: GAP_IDENTITY_CORE,
    targetedActionId: 'b'.repeat(64),
    status: ACTION_STATUS_UNRESOLVED,
    resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    newEvidenceIds: [],
  });
  assert.deepEqual(art.resolutions[0].resolutionEvidence, ['400']);
});

test('G6 — the record key set is pinned by hand (not by self-comparison)', () => {
  const art = recordResolution(emptyArtifact(), {
    gapId: GAP_ID,
    gapIdentityCore: GAP_IDENTITY_CORE,
    targetedActionId: 'a'.repeat(64),
    status: ACTION_STATUS_RESOLVED,
    resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
    newEvidenceIds: ['400'],
  });
  assert.deepEqual(Object.keys(art.resolutions[0]).sort(), [
    'audit',
    'evaluatedActionIds',
    'gapId',
    'gapIdentityCore',
    'occurrenceId',
    'planHash',
    'resolutionBasis',
    'resolutionEvidence',
    'resolutionPredicateRef',
    'status',
  ]);
  // S9's OUTPUT_CONTRACT name is the persisted field name.
  assert.equal(Array.isArray(art.resolutions[0].resolutionEvidence), true);
});

// ---------------------------------------------------------------------------
// H. source guards
// ---------------------------------------------------------------------------

test('H1 — no authority proxy is implemented (G-A4 / OUT_OF_SCOPE)', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  for (const forbidden of ['authorRef', 'heat', 'likes', 'upvotes', 'voteup', 'verifiedBadge', 'popularity']) {
    assert.equal(new RegExp(forbidden, 'i').test(source), false, `forbidden identifier ${forbidden}`);
  }
  for (const forbidden of ['stance', 'sentiment', 'classifier']) {
    assert.equal(new RegExp(forbidden, 'i').test(source), false, `forbidden identifier ${forbidden}`);
  }
});

test('H2 — model-supplied scores never steer the verdict (H-7 / D12-5)', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  for (const forbidden of ['materiality', 'confidence']) {
    assert.equal(new RegExp(forbidden, 'i').test(source), false, `forbidden identifier ${forbidden}`);
  }
});

test('H3 — frozen primitives are REUSED, not re-derived', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  // canonical questionId gate comes from the existing P1 seam
  assert.equal(/isCanonicalQuestionId/.test(source), true);
  assert.equal(/from '\.\/source-group-selection\.mjs'/.test(source), true);
  // gap types come from T01; gap statuses come from T06
  assert.equal(/from '\.\/targeted-requery-ledger\.mjs'/.test(source), true);
  assert.equal(/from '\.\/targeted-requery-lifecycle\.mjs'/.test(source), true);
  // the canonical questionId regex must not be re-declared here
  assert.equal(/\[1-9\]/.test(source), false);
});

test('H4 — no clock and no randomness in the evaluation path', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(/Date\.now\(\)/.test(source), false);
  assert.equal(/new Date\(\)/.test(source), false);
  assert.equal(/Math\.random/.test(source), false);
  assert.equal(/randomUUID/.test(source), false);
});
