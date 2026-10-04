// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p2a-t13-stop-budget-counterexamples.test.mjs
 *
 * P2A-T13 (#131) — the ONLY_MISSING_COUNTEREXAMPLES closure for the frozen
 * authorization surface. TEST / EVIDENCE only: this file adds three assertions and
 * touches no production code.
 *
 * What this file adds that the existing suites do not:
 *   1. H-4 FIELD-LEVEL direct proof (patches the PARTIAL gap in
 *      p2a-t07-targeted-attempts.test.mjs:197, whose `C2` only compares
 *      roundIndex / nextRoundIndex / shouldStop and never touches the named
 *      `retrieval.retrievalRounds` field).
 *   2. A complete byte-for-byte frozen-literal pin of
 *      SATURATION_SEMANTICS_DISCLAIMER (p2a-t07:274 only greps the symbol + half a
 *      sentence; retrieval-round-controller.test.mjs:94 compares the export with
 *      itself, i.e. a same-source self-comparison that survives a text edit).
 *   3. A single runnable C1–C12 matrix gate. Each of the twelve counterexamples
 *      drives a REAL production guard with a violating input and asserts, inline
 *      and fail-closed, that the guard refuses it. There is no try/catch and no
 *      "count the cases" substitute. A separate `after` hook — registered OUTSIDE
 *      the gate callback — re-asserts the ordered list of verdicts the gate
 *      OBSERVED from those real calls; this is the anti-hollow liveness tripwire
 *      that makes a body-neutered gate (e.g. replacing the whole gate callback
 *      with `return;`) turn the file RED instead of silently green.
 *
 * ---------------------------------------------------------------------------
 * PROBED API SHAPE (established by reading the real modules — not assumed):
 *
 *   evaluateRetrievalRound(...) returns an object with keys
 *     { decision, stopReason, roundIndex, noveltyGain, cumulativeExecutedRoutesCount,
 *       plannedCoverageCount, attemptsBudgetCount, targetedAttempts, totalCandidatesCount,
 *       saturationSemantics, shouldStop, nextRoundIndex, executedRoutesThisRound,
 *       providerFailuresThisRound }
 *   — it does NOT return a `retrievalRounds` field, and it does NOT mutate the
 *     passed-in coverageState.
 *
 *   The ONE write path to the named field `coverageState.retrieval.retrievalRounds`
 *   is applyRoundEvaluationToCoverageState(...) → updateRetrievalCoverage(...),
 *   which sets `retrievalRounds: evaluationResult.roundIndex` (see
 *   lib/retrieval-round-controller.mjs:435 and lib/coverage-state.mjs:651-653).
 *   That source is `roundIndex` ALONE — `targetedAttempts` never reaches it.
 *   Assertion 1 therefore pins the field itself: (a) pure-call invariance (the
 *   field stays at its pre-run starting value) and (b) write-back equality across
 *   the no-targeted / with-targeted runs, plus a proof the written value equals
 *   roundIndex and NOT roundIndex + targeted counts.
 * ---------------------------------------------------------------------------
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createInitialCoverageState } from '../lib/coverage-state.mjs';
import {
  DECISION_BUDGET_STOP,
  DECISION_SATURATED,
  SATURATION_SEMANTICS_DISCLAIMER,
  evaluateRetrievalRound,
  applyRoundEvaluationToCoverageState,
} from '../lib/retrieval-round-controller.mjs';

import {
  GAP_TYPE_ASPECT,
  GAP_TYPE_AUTHORITY,
  GAP_TYPE_CONTRADICTION,
} from '../lib/targeted-requery-ledger.mjs';

import { ACTION_STATUS_AUTHORIZED, ACTION_STATUS_COMMITTED, ACTION_STATUS_RESOLVED, ACTION_STATUS_UNRESOLVED } from '../lib/targeted-requery-lifecycle.mjs';

import {
  RESOLUTION_BASIS_DUPLICATE_ONLY,
  RESOLUTION_BASIS_NO_NEW_EVIDENCE,
  RESOLUTION_BASIS_PROVIDER_FAILURE,
  RESOLUTION_BASIS_SAME_SIDE_ONLY,
  RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
  RESOLUTION_PREDICATE_ASPECT,
  RESOLUTION_PREDICATE_NONE_REGISTERED,
  TERMINATION_RUN_PROVIDER_FAILURE,
  classifyGapTerminal,
  evaluateResolution,
} from '../lib/targeted-requery-resolution.mjs';

import {
  ACTIONS_FILENAME,
  RESUME_REASON_AUTHORIZED_ONLY,
  RESUME_REASON_BINDING_HASH_MISSING,
  RESUME_REASON_COMMITTED_WITH_VALID_BINDING,
  RESUME_REASON_IDENTITY_REPLAY_CONFLICT,
  RESUME_RERUN,
  RESUME_REUSE,
  commitTargetedAction,
  createActionsArtifact,
  decideTargetedReplay,
  loadActionsArtifact,
  prepareTargetedCommit,
  registerAuthorizedAction,
  stageTargetedArtifact,
} from '../lib/targeted-requery-lifecycle.mjs';

import { readState } from '../lib/state.mjs';

import {
  AUTHORIZATION_STATUS_AUTHORIZED,
  AUTHORIZATION_STATUS_REJECTED,
  REJECTION_DEDUPE_ALREADY_AUTHORIZED,
  REJECTION_PROPOSAL_NOT_ADMITTED,
  authorizeTargetedAction,
  computeTargetedActionId,
} from '../lib/targeted-requery-authorization.mjs';

import {
  PROPOSAL_STATUS_REJECTED,
  REJECTION_PLAN_OWNED_STRING_UNSAFE,
  REJECTION_TRUST_CLASS_UNCLASSIFIED,
  TRUST_CLASS_PLAN_OWNED,
  TRUST_CLASS_UNCLASSIFIED,
  admitTargetedQueryString,
  evaluateTargetedQueryProposal,
} from '../lib/targeted-requery-trust.mjs';

// ===========================================================================
// 1. H-4 — targeted attempts do not advance retrieval.retrievalRounds
// ===========================================================================

const H4_PLAN_HASH = 'b'.repeat(64);
const H4_ROUTE_A = { query: 'q1', providerId: 'official', capability: 'search' };

function makeH4State(rounds) {
  const state = createInitialCoverageState({ planHash: H4_PLAN_HASH });
  state.retrieval.plannedRoutes = [{ providerId: 'official', capability: 'search' }];
  state.retrieval.retrievalRounds = rounds;
  return state;
}

test('H-4 — targeted attempts leave the named retrievalRounds field untouched (field-level)', () => {
  const START_ROUNDS = 3;
  const ROUND_INDEX = START_ROUNDS + 1; // strictly greater, as the controller requires
  const TARGETED = { executed: 5, failed: 7 };

  const stateNoTargeted = makeH4State(START_ROUNDS);
  const stateWithTargeted = makeH4State(START_ROUNDS);

  const common = {
    roundIndex: ROUND_INDEX,
    newCandidatesCount: 1,
    totalCandidatesCount: 2,
    executedRoutesThisRound: [H4_ROUTE_A],
    providerFailuresThisRound: [],
  };

  const without = evaluateRetrievalRound({ coverageState: stateNoTargeted, ...common });
  const withTargeted = evaluateRetrievalRound({
    coverageState: stateWithTargeted,
    ...common,
    targetedAttempts: TARGETED,
  });

  // (a) purity: evaluateRetrievalRound does not write the named field — it stays at
  //     its pre-run starting value in BOTH runs. (If the module self-incremented
  //     retrievalRounds from targeted attempts, this would move.)
  assert.equal(
    stateNoTargeted.retrieval.retrievalRounds,
    START_ROUNDS,
    'no-targeted run must not mutate retrievalRounds',
  );
  assert.equal(
    stateWithTargeted.retrieval.retrievalRounds,
    START_ROUNDS,
    'with-targeted run must not mutate retrievalRounds',
  );

  // (b) the ONE real write path: apply each evaluation back to its own state and
  //     compare the named field itself (not roundIndex).
  const appliedNoTargeted = applyRoundEvaluationToCoverageState(stateNoTargeted, without);
  const appliedWithTargeted = applyRoundEvaluationToCoverageState(stateWithTargeted, withTargeted);

  assert.equal(
    appliedWithTargeted.retrieval.retrievalRounds,
    appliedNoTargeted.retrieval.retrievalRounds,
    'retrievalRounds after write-back must be strictly equal with/without targeted attempts',
  );
  // the write is governed solely by roundIndex ...
  assert.equal(appliedNoTargeted.retrieval.retrievalRounds, ROUND_INDEX);
  // ... and NOT inflated by the targeted channel (5 executed + 7 failed = 12).
  assert.notEqual(appliedWithTargeted.retrieval.retrievalRounds, ROUND_INDEX + TARGETED.executed + TARGETED.failed);

  // sanity: the two runs did diverge on the budget denominator (H-3 lives), so the
  // retrievalRounds equality above is a real property, not a trivially identical run.
  assert.notEqual(without.attemptsBudgetCount, withTargeted.attemptsBudgetCount);
});

// ===========================================================================
// 2. SATURATION_SEMANTICS_DISCLAIMER — complete frozen literal (byte + order)
// ===========================================================================

test('SATURATION_SEMANTICS_DISCLAIMER — frozen literal pinned key-by-key, in order', () => {
  const disclaimer = SATURATION_SEMANTICS_DISCLAIMER;

  // frozen key set (exact, ordered)
  assert.deepEqual(Object.keys(disclaimer), ['meaning', 'nonGoals']);

  // meaning — literal equality (not `includes`)
  assert.equal(
    disclaimer.meaning,
    'Marginal information gain under the current retrieval policy has diminished according to the current implementation policy.',
  );

  // nonGoals — exactly 5, each verbatim, ORDER included
  const expectedNonGoals = [
    'Does not imply all relevant information has been found',
    'Does not imply global search completeness',
    'Does not imply no undiscovered source exists',
    'Does not imply final research completeness',
    'Does not imply final analysis completeness',
  ];
  assert.equal(Array.isArray(disclaimer.nonGoals), true);
  assert.equal(disclaimer.nonGoals.length, 5);
  for (let i = 0; i < expectedNonGoals.length; i += 1) {
    assert.equal(disclaimer.nonGoals[i], expectedNonGoals[i], `nonGoals[${i}] must be byte-identical`);
  }

  // completely frozen (outer object and the array it owns)
  assert.equal(Object.isFrozen(disclaimer), true);
  assert.equal(Object.isFrozen(disclaimer.nonGoals), true);
});

// ===========================================================================
// 3. C1–C12 single-file matrix gate — non-hollow, fail-closed
// ===========================================================================
//
// Each entry cites the existing suite + line that owns the counterexample and
// drives ONE real production guard with a violating input, then asserts the
// guard's ACTUAL refusal (fail-closed). Failures are NOT captured: a single wrong
// verdict throws straight out of the gate test.
//
// ANTI-HOLLOW TRIPWIRE. Every counterexample records the verdict it OBSERVED from
// the real production call into the module-level GATE_VERDICTS array. The `after`
// hook at the very bottom — registered OUTSIDE the gate callback — re-asserts the
// full ordered list. A gate whose callback body is replaced with `return;` (the
// CONTROL-PLANE Mutation D) records nothing, so the hook fails the file: the gate
// can no longer silently turn green. The hook is a liveness/completeness tripwire;
// the substantive fail-closed judgment remains the inline assert of each case.
//
// Expected verdicts are LITERAL strings (not the imported constants) so a silent
// change of a production constant's value is caught rather than mirrored.

// ---- shared fixtures ------------------------------------------------------

const MATRIX_PLAN_HASH = '9f'.repeat(32); // 64 lowercase hex
const AUTH_CORE_A = '1a'.repeat(32);
const AUTH_GAP_ONE = `${AUTH_CORE_A}:0`;
const AUTH_GAP_ONE_ROUND_2 = `${AUTH_CORE_A}:1`;
const AUTH_RUN_ID = 'run-p2a-t13';
const AUTH_OCCURRENCE = 'occ-p2a-t13';
const AUTH_PLANNED_ROUTES = [
  { providerId: 'zhihu_search', capability: 'search' },
  { providerId: 'zhihu_open_platform', capability: 'search' },
];

function authPlan() {
  return {
    schemaVersion: 1,
    queryVariants: ['alpha beta', 'alpha gamma'],
    aspects: ['技术成熟度'],
    entities: ['OpenAI'],
    opposingFramings: ['Agent 已可大规模落地'],
    terminologyVariants: [{ term: 'Agent', variants: ['智能体'] }],
    sourceGroupIntents: [{ intent: '关注反方观点', constraints: ['权威来源优先'], groupKey: null }],
  };
}

const AUTH_KNOWN_GAPS = {
  [AUTH_GAP_ONE]: { gapId: AUTH_GAP_ONE, gapType: 'ASPECT_GAP' },
  [AUTH_GAP_ONE_ROUND_2]: { gapId: AUTH_GAP_ONE_ROUND_2, gapType: 'ASPECT_GAP' },
};
function authResolveGap(gapId) {
  return AUTH_KNOWN_GAPS[gapId] ?? null;
}
function authProposal(overrides = {}) {
  return { gapId: AUTH_GAP_ONE, planOwnedStringRef: { field: 'queryVariants', index: 0 }, ...overrides };
}
function authContext(overrides = {}) {
  return {
    plan: authPlan(),
    resolveGap: authResolveGap,
    plannedRoutes: AUTH_PLANNED_ROUTES,
    runId: AUTH_RUN_ID,
    occurrenceId: AUTH_OCCURRENCE,
    planHash: MATRIX_PLAN_HASH,
    maxAttemptsPerGap: 2,
    maxQueryBudget: 10,
    attemptsBudgetCount: 0,
    attemptsByGapIdentityCore: {},
    authorizedDedupeKeys: [],
    ...overrides,
  };
}

const TRUST_GAP_CORE = '0123456789abcdeffedcba98765432100123456789abcdeffedcba9876543210';
const TRUST_GAP_ID = `${TRUST_GAP_CORE}:0`;
function trustPlan() {
  return {
    schemaVersion: 1,
    queryVariants: ['/etc/hosts 文件的作用', '大语言模型 Agent 落地争议'],
    aspects: ['技术成熟度'],
    entities: ['OpenAI'],
    opposingFramings: ['Agent 已可大规模落地'],
    terminologyVariants: [{ term: 'Agent', variants: ['智能体'] }],
    sourceGroupIntents: [{ intent: '关注反方观点', constraints: ['权威来源优先'], groupKey: null }],
  };
}

const LIFE_PLAN_HASH = '0123456789abcdef'.repeat(4);
const LIFE_GAP_CORE = 'fedcba9876543210'.repeat(4);
const LIFE_GAP_ID = `${LIFE_GAP_CORE}:0`;
const LIFE_RUN_ID = 'run-p2a-t13-life';
const LIFE_OCCURRENCE = 'occ-p2a-t13-life';
const LIFE_PROVIDER_SCOPE = [{ providerId: 'official', capability: 'search' }];
const LIFE_ARTIFACT_REL = 'targeted-rounds/round-1/pool.json';
const LIFE_ARTIFACT_BYTES = Buffer.from('{"pool":[],"poolHash":"deadbeef"}', 'utf8');

function lifeIdentity(overrides = {}) {
  return {
    runId: LIFE_RUN_ID,
    occurrenceId: LIFE_OCCURRENCE,
    planHash: LIFE_PLAN_HASH,
    gapId: LIFE_GAP_ID,
    attempt: 1,
    normalizedQuery: 'zhihu answer quality',
    providerScope: LIFE_PROVIDER_SCOPE,
    ...overrides,
  };
}

function lifeAuthorizedDecision(identity, targetedActionId) {
  return {
    status: ACTION_STATUS_AUTHORIZED,
    targetedActionId,
    runId: identity.runId,
    occurrenceId: identity.occurrenceId,
    planHash: identity.planHash,
    gapId: identity.gapId,
    gapIdentityCore: LIFE_GAP_CORE,
    attempt: identity.attempt,
    query: identity.normalizedQuery,
    normalizedQuery: identity.normalizedQuery,
    queryTrustClass: 'PLAN_OWNED',
    providerScope: identity.providerScope,
    dedupeKey: 'd'.repeat(64),
    actionChannelAttemptCount: 1,
    rejectionCode: null,
    rejectionDetail: null,
  };
}

function lifeArtifactWithAuthorizedAction() {
  const id = computeTargetedActionId(lifeIdentity());
  return registerAuthorizedAction(
    createActionsArtifact({ planHash: LIFE_PLAN_HASH, occurrenceId: LIFE_OCCURRENCE }),
    lifeAuthorizedDecision(lifeIdentity(), id),
  );
}

function lifeFreshState() {
  return {
    schemaVersion: 1,
    runId: LIFE_RUN_ID,
    occurrenceId: LIFE_OCCURRENCE,
    stage: 'SEARCH',
    completedStages: [],
    artifacts: {},
    hashes: {},
  };
}

function freshWorkDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `p2a-t13-${tag}-`));
}

// ---- liveness tripwire state ----------------------------------------------

const GATE_VERDICTS = [];

const GATE_EXPECTED_VERDICTS = [
  'C1:EQUIVALENT_QUERY_ALREADY_AUTHORIZED',
  'C2:TRUST_CLASS_UNCLASSIFIED|PROPOSAL_NOT_ADMITTED',
  'C3:PLAN_OWNED_STRING_UNSAFE|PLAN_OWNED|null',
  'C4:REUSE|COMMITTED_WITH_VALID_BINDING',
  'C5:AUTHORIZED_ONLY|BINDING_HASH_MISSING',
  'C6:UNRESOLVED|DUPLICATE_ONLY',
  'C7:UNRESOLVED|SAME_SIDE_ONLY',
  'C8:UNRESOLVED|NONE_REGISTERED|UNKNOWN_NO_AUTHORITY_PREDICATE',
  'C9:BUDGET_STOP|query_budget_exhausted',
  'C10:UNRESOLVED|PROVIDER_FAILURE',
  'C11:SATURATED',
  'C12:RERUN|IDENTITY_REPLAY_CONFLICT',
];

function recordGateVerdict(id, verdict) {
  GATE_VERDICTS.push(`${id}:${verdict}`);
}

// ---- the gate -------------------------------------------------------------

test('C1-C12 matrix gate — each counterexample runs a real production path, fail-closed', () => {
  // ---- C1 — equivalent query already authorized (dedupe) -------------------
  // ref: test/p2a-t05-bounded-authorization-action-identity.test.mjs:542
  {
    const first = authorizeTargetedAction(authProposal(), authContext());
    assert.equal(first.status, AUTHORIZATION_STATUS_AUTHORIZED, 'C1 first authorization must be AUTHORIZED');
    // round 2: same gap identity core, new gapId, equivalent query, dedupeKey known
    const second = authorizeTargetedAction(
      authProposal({ gapId: AUTH_GAP_ONE_ROUND_2 }),
      authContext({ authorizedDedupeKeys: [first.dedupeKey] }),
    );
    assert.equal(second.status, AUTHORIZATION_STATUS_REJECTED, 'C1 equivalent query must be REJECTED');
    assert.equal(second.rejectionCode, REJECTION_DEDUPE_ALREADY_AUTHORIZED);
    assert.equal(second.dedupeKey, first.dedupeKey);
    recordGateVerdict('C1', second.rejectionCode);
  }

  // ---- C2 — unrelated/unresolvable proposal refused, never re-bound -------
  // ref: test/p2a-t05-bounded-authorization-action-identity.test.mjs:506,
  //      test/p2a-t04-trust-gate.test.mjs:480
  {
    // (a) an unrelated, safe-looking but NOT plan-owned query fails closed.
    const unrelated = admitTargetedQueryString('2026 年新能源汽车销量排行', ['大语言模型 Agent 落地争议']);
    assert.equal(unrelated.admitted, false);
    assert.equal(unrelated.trustClass, TRUST_CLASS_UNCLASSIFIED);
    assert.equal(unrelated.rejectionCode, REJECTION_TRUST_CLASS_UNCLASSIFIED);

    // (b) an unresolvable parent gap is rejected, never re-bound.
    const decision = authorizeTargetedAction(
      authProposal({ gapId: `${'ff'.repeat(32)}:0` }),
      authContext(),
    );
    assert.equal(decision.status, AUTHORIZATION_STATUS_REJECTED);
    assert.equal(decision.rejectionCode, REJECTION_PROPOSAL_NOT_ADMITTED);
    recordGateVerdict('C2', `${unrelated.rejectionCode}|${decision.rejectionCode}`);
  }

  // ---- C3 — plan-owned but provider-unsafe string never leaks -------------
  // ref: test/p2a-t04-trust-gate.test.mjs:786, test/p2a-t04-trust-gate.test.mjs:802
  {
    const decision = evaluateTargetedQueryProposal(
      { gapId: TRUST_GAP_ID, planOwnedStringRef: '/etc/hosts 文件的作用' },
      { plan: trustPlan(), resolveGap: (id) => (id === TRUST_GAP_ID ? { gapId: TRUST_GAP_ID, gapType: 'ASPECT_GAP' } : null) },
    );
    // plan-owned and provider-unsafe → refused, query never leaks.
    assert.equal(decision.status, PROPOSAL_STATUS_REJECTED);
    assert.equal(decision.rejectionCode, REJECTION_PLAN_OWNED_STRING_UNSAFE);
    assert.equal(decision.trustClass, TRUST_CLASS_PLAN_OWNED);
    assert.equal(decision.query, null);
    recordGateVerdict('C3', `${decision.rejectionCode}|${decision.trustClass}|${decision.query}`);
  }

  // ---- C4 — durable commit + valid binding is REUSED, never re-run --------
  // ref: test/p2a-t06-action-lifecycle-durable-commit.test.mjs:532,
  //      test/p2a-t09-targeted-subphase-orchestration.test.mjs:571
  {
    const workDir = freshWorkDir('c4');
    const committed = commitTargetedAction({
      workDir,
      artifact: lifeArtifactWithAuthorizedAction(),
      state: lifeFreshState(),
      targetedActionId: computeTargetedActionId(lifeIdentity()),
      artifactRel: LIFE_ARTIFACT_REL,
      artifactBytes: LIFE_ARTIFACT_BYTES,
    });
    assert.equal(committed.ok, true);
    assert.equal(committed.artifact.targetedActions[0].status, ACTION_STATUS_COMMITTED);

    const decision = decideTargetedReplay({
      workDir,
      state: readState(workDir),
      artifact: loadActionsArtifact(workDir, LIFE_PLAN_HASH).artifact,
      identity: lifeIdentity(),
    });
    // a durable commit + valid binding is REUSED — the paid retrieval is never re-run.
    assert.equal(decision.decision, RESUME_REUSE);
    assert.equal(decision.reason, RESUME_REASON_COMMITTED_WITH_VALID_BINDING);
    recordGateVerdict('C4', `${decision.decision}|${decision.reason}`);
  }

  // ---- C5 — crash points re-run exactly once, never falsely reuse ---------
  // ref: test/p2a-t06-action-lifecycle-durable-commit.test.mjs:557, :577,
  //      test/p2a-t09-targeted-subphase-orchestration.test.mjs:435
  {
    // (a) crash after staging, before any checkpoint → safe re-run once.
    const workDirA = freshWorkDir('c5a');
    const staged = stageTargetedArtifact(workDirA, LIFE_ARTIFACT_REL, LIFE_ARTIFACT_BYTES);
    assert.equal(staged.ok, true);
    const stagedDecision = decideTargetedReplay({
      workDir: workDirA,
      state: null,
      artifact: lifeArtifactWithAuthorizedAction(),
      identity: lifeIdentity(),
    });
    assert.equal(stagedDecision.decision, RESUME_RERUN);
    assert.equal(stagedDecision.reason, RESUME_REASON_AUTHORIZED_ONLY);
    assert.equal(stagedDecision.action.status, ACTION_STATUS_AUTHORIZED);

    // (b) crash after the record says COMMITTED but before writeState → safe re-run once.
    const workDirB = freshWorkDir('c5b');
    prepareTargetedCommit({
      workDir: workDirB,
      artifact: lifeArtifactWithAuthorizedAction(),
      state: lifeFreshState(),
      targetedActionId: computeTargetedActionId(lifeIdentity()),
      artifactRel: LIFE_ARTIFACT_REL,
      artifactBytes: LIFE_ARTIFACT_BYTES,
    });
    const unboundDecision = decideTargetedReplay({
      workDir: workDirB,
      state: readState(workDirB),
      artifact: loadActionsArtifact(workDirB, LIFE_PLAN_HASH).artifact,
      identity: lifeIdentity(),
    });
    assert.equal(unboundDecision.decision, RESUME_RERUN);
    assert.equal(unboundDecision.reason, RESUME_REASON_BINDING_HASH_MISSING);
    recordGateVerdict('C5', `${stagedDecision.reason}|${unboundDecision.reason}`);
  }

  // ---- C6 — duplicate-only targeted evidence does not resolve -------------
  // ref: test/p2a-t08-gap-reevaluation-resolution.test.mjs:213 (duplicate-only at :222)
  {
    const verdict = evaluateResolution({
      gapType: GAP_TYPE_ASPECT,
      priorQuestionIds: ['100'],
      targetedQuestionIds: ['100', '100'],
    });
    assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
    assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_DUPLICATE_ONLY);
    recordGateVerdict('C6', `${verdict.status}|${verdict.resolutionBasis}`);
  }

  // ---- C7 — same-side-only targeted evidence does not resolve -------------
  // ref: test/p2a-t08-gap-reevaluation-resolution.test.mjs:257
  {
    const verdict = evaluateResolution({
      gapType: GAP_TYPE_CONTRADICTION,
      priorQuestionIds: ['100'],
      targetedQuestionIds: ['400'],
      declaredFraming: 'opposing:market-driven',
      coveredFramings: ['opposing:market-driven'],
    });
    assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
    assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_SAME_SIDE_ONLY);
    recordGateVerdict('C7', `${verdict.status}|${verdict.resolutionBasis}`);
  }

  // ---- C8 — authority gap with no registered predicate stays UNKNOWN ------
  // ref: test/p2a-t08-gap-reevaluation-resolution.test.mjs:231
  {
    const verdict = evaluateResolution({
      gapType: GAP_TYPE_AUTHORITY,
      priorQuestionIds: ['100'],
      targetedQuestionIds: ['400', '500', '600'],
    });
    assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
    assert.equal(verdict.resolutionPredicateRef, RESOLUTION_PREDICATE_NONE_REGISTERED);
    assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE);
    recordGateVerdict('C8', `${verdict.status}|${verdict.resolutionPredicateRef}|${verdict.resolutionBasis}`);
  }

  // ---- C9 — budget exhaustion stops the round ----------------------------
  // ref: test/p2a-t07-targeted-attempts.test.mjs:137,
  //      test/p2a-t09-targeted-subphase-orchestration.test.mjs:1442
  {
    const state = createInitialCoverageState({ planHash: H4_PLAN_HASH });
    state.retrieval.plannedRoutes = Array.from({ length: 8 }, () => ({ providerId: 'official', capability: 'search' }));
    const result = evaluateRetrievalRound({
      coverageState: state,
      roundIndex: 1,
      newCandidatesCount: 1,
      totalCandidatesCount: 2,
      executedRoutesThisRound: [H4_ROUTE_A],
      providerFailuresThisRound: [],
      targetedAttempts: { executed: 7, failed: 2 },
    });
    assert.equal(result.decision, DECISION_BUDGET_STOP);
    assert.equal(result.stopReason, 'query_budget_exhausted');
    assert.equal(result.attemptsBudgetCount >= 10, true);
    recordGateVerdict('C9', `${result.decision}|${result.stopReason}`);
  }

  // ---- C10 — provider failure is never a resolution fact ------------------
  // ref: test/p2a-t08-gap-reevaluation-resolution.test.mjs:396,
  //      test/p2a-t06-action-lifecycle-durable-commit.test.mjs:271
  {
    const verdict = classifyGapTerminal({
      predicateResult: {
        status: ACTION_STATUS_UNRESOLVED,
        resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
        resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
      },
      terminationReason: TERMINATION_RUN_PROVIDER_FAILURE,
      everAuthorized: true,
    });
    // failure is never a resolution fact and never EXHAUSTED_WITHIN_BUDGET.
    assert.equal(verdict.status, ACTION_STATUS_UNRESOLVED);
    assert.equal(verdict.resolutionBasis, RESOLUTION_BASIS_PROVIDER_FAILURE);
    assert.notEqual(verdict.status, ACTION_STATUS_RESOLVED);
    recordGateVerdict('C10', `${verdict.status}|${verdict.resolutionBasis}`);
  }

  // ---- C11 — targeted attempts cannot block a plan-earned saturation ------
  // ref: test/p2a-t07-targeted-attempts.test.mjs:148,
  //      test/p2a-t07-targeted-attempts.test.mjs:160
  {
    const state = createInitialCoverageState({ planHash: H4_PLAN_HASH });
    state.retrieval.plannedRoutes = [
      { providerId: 'official', capability: 'search' },
      { providerId: 'official', capability: 'search' },
    ];
    const base = evaluateRetrievalRound({
      coverageState: state,
      roundIndex: 1,
      newCandidatesCount: 0,
      totalCandidatesCount: 2,
      executedRoutesThisRound: [H4_ROUTE_A, { query: 'q2', providerId: 'official', capability: 'search' }],
      providerFailuresThisRound: [],
    });
    assert.equal(base.decision, DECISION_SATURATED);
    const withTargeted = evaluateRetrievalRound({
      coverageState: state,
      roundIndex: 1,
      newCandidatesCount: 0,
      totalCandidatesCount: 2,
      executedRoutesThisRound: [H4_ROUTE_A, { query: 'q2', providerId: 'official', capability: 'search' }],
      providerFailuresThisRound: [],
      targetedAttempts: { executed: 1, failed: 1 },
    });
    // targeted attempts cannot block a saturation the plan routes earned.
    assert.equal(withTargeted.decision, DECISION_SATURATED);
    assert.equal(withTargeted.plannedCoverageCount, base.plannedCoverageCount);
    recordGateVerdict('C11', withTargeted.decision);
  }

  // ---- C12 — identity replay conflict re-runs, never falsely reuses ------
  // ref: test/p2a-t06-action-lifecycle-durable-commit.test.mjs:688 (root guard),
  //      test/p2a-t05-bounded-authorization-action-identity.test.mjs:557,
  //      test/p2a-t09-targeted-subphase-orchestration.test.mjs:1379
  //
  // HONEST SCOPE NOTE: this exercises the ROOT guard of decideTargetedReplay
  // (p2a-t06:688) — the persisted identity content is tampered WITHOUT recomputing
  // the id, so the id→content binding mismatches and the guard forces RERUN. This
  // is NOT the same code path as the p2a-t09:1379 subphase integration route, which
  // reaches a replay conflict THROUGH the targeted-subphase orchestration; C12 does
  // not claim to cover that integration path, only the root guard it depends on.
  {
    const workDir = freshWorkDir('c12');
    commitTargetedAction({
      workDir,
      artifact: lifeArtifactWithAuthorizedAction(),
      state: lifeFreshState(),
      targetedActionId: computeTargetedActionId(lifeIdentity()),
      artifactRel: LIFE_ARTIFACT_REL,
      artifactBytes: LIFE_ARTIFACT_BYTES,
    });
    // tamper the persisted identity content WITHOUT recomputing the id → replay conflict.
    const file = path.join(workDir, ACTIONS_FILENAME);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    parsed.targetedActions[0].attempt = 7;
    fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);

    const replayArtifact = loadActionsArtifact(workDir, LIFE_PLAN_HASH, { strict: false });
    assert.equal(replayArtifact.ok, true, replayArtifact.reason);
    const decision = decideTargetedReplay({
      workDir,
      state: readState(workDir),
      artifact: replayArtifact.artifact,
      identity: lifeIdentity(),
    });
    // same id, different content → conservative re-run, never a false reuse.
    assert.equal(decision.decision, RESUME_RERUN);
    assert.equal(decision.reason, RESUME_REASON_IDENTITY_REPLAY_CONFLICT);
    recordGateVerdict('C12', `${decision.decision}|${decision.reason}`);
  }

  // Inline completeness: the gate must have observed all twelve verdicts.
  assert.deepEqual(
    GATE_VERDICTS,
    GATE_EXPECTED_VERDICTS,
    'the C1–C12 matrix gate must observe every counterexample verdict',
  );
});

// Anti-hollow tripwire — registered OUTSIDE the gate callback. Replacing the whole
// gate body with `return;` leaves GATE_VERDICTS empty here, so the file fails RED
// instead of letting the gate silently turn green.
after(() => {
  assert.deepEqual(
    GATE_VERDICTS,
    GATE_EXPECTED_VERDICTS,
    'C1–C12 gate liveness: the gate callback body did not execute its counterexamples',
  );
});
