// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p2a-t13-stop-budget-counterexamples.test.mjs
 *
 * P2A-T13 (#125) — the ONLY_MISSING_COUNTEREXAMPLES closure for the frozen
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
 *   3. A single runnable C1–C12 matrix gate. Each of the fifteen counterexamples
 *      drives a REAL production guard and asserts, inline, the verdict that guard
 *      must return. Most are fail-closed (a violating input must be REFUSED), but
 *      not all: C4 replays a durably COMMITTED action and must be REUSED (no paid
 *      retrieval again; its fixture is a clean commit, not a crash), and C5 covers
 *      the crash windows either side of the commit point, which must yield exactly
 *      one safe re-run. The direction each case demands is stated in its own comment;
 *      do not read "matrix gate" as "fifteen refusals". There is no try/catch and no
 *      "count the cases" substitute. A separate `after` hook — registered OUTSIDE
 *      the gate callback and LAST — re-asserts the ordered list of verdicts the
 *      gate OBSERVED from those real calls. Two hooks guard liveness, and because
 *      node:test skips later `after` hooks once one fails, they are registered in
 *      this order on purpose: the fixture-cleanup hook FIRST, the verdict tripwire
 *      LAST. A gate that throws partway is caught by the tripwire (verdicts
 *      incomplete) with cleanup already done; a gate body replaced wholesale by
 *      `return;` is caught by the cleanup hook's "fixtures must actually have been
 *      created" guard, since a neutered gate creates none. Either way the file
 *      turns RED instead of silently green.
 *
 *      The gate now carries FIFTEEN ordered verdicts: C11b/C11c/C11d were added
 *      after review proved the first attempt at this gate covered the H-5
 *      manufacture direction only halfway. Every case block in the gate — C11b
 *      included — records its observed verdict, so removing a record, reordering
 *      the expected list, or excising a block alone each turns the file RED.
 *      HONEST LIMIT: the expected list lives in this same file, so deleting a case
 *      block AND its expected entry together is an internally consistent edit the
 *      tripwire cannot see — that residual gap is exactly what review of this
 *      file's diff is for. Read the "C11*" cluster as one counterexample
 *      seen from four sides — block, manufacture-by-executed, manufacture-by-failed,
 *      and the denominator that must NOT be substituted.
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

import { createInitialCoverageState, updateRetrievalCoverage, OWNER_T06_RETRIEVAL } from '../lib/coverage-state.mjs';
import {
  DECISION_BUDGET_STOP,
  DECISION_CONTINUE,
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
// verdict that guard MUST return for that input. Failures are NOT captured: a
// single wrong verdict throws straight out of the gate test.
//
// The required direction is per-case, not uniformly "refuse": C4 must REUSE a
// committed action, C5 must permit exactly one re-run, C11 must still reach
// SATURATED, C11d must reach SATURATED, and C11b/C11c must yield CONTINUE. Read
// "matrix gate" as "fifteen ordered verdicts", not "fifteen refusals".
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

// Every work dir handed to a fixture, removed in the `after` hook at the foot of
// this file. Populated by freshWorkDir(); declared before it so the push is hoisted.
const WORK_DIRS = [];

function freshWorkDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `p2a-t13-${tag}-`));
  // SECURITY review P3: these fixtures used to be created and never removed, leaking
  // four directories into os.tmpdir() on every CI run. The contents are synthetic
  // ('b'.repeat(64), 'deadbeef', …) — no credential ever lands here — but a suite
  // should not accumulate state across runs. Collected here and removed by a cleanup
  // `after` hook at the foot of this file, registered BEFORE the anti-hollow tripwire
  // so that a failing run still cleans up.
  WORK_DIRS.push(dir);
  return dir;
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
  'C11b:CONTINUE',
  'C11c:CONTINUE',
  'C11d:SATURATED',
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
    // The load-bearing C9 judgement is the decision/stopReason pair asserted above.
    // This third check is a loose lower bound, NOT a pin: a drift that still lands
    // >= 10 (e.g. 10 -> 11) would pass. It is here only to show the denominator
    // actually grew past the planned-only count, so do not read it as an exact
    // accounting freeze.
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

  // ---- C11b — targeted attempts cannot MANUFACTURE a saturation ------------
  // ref: docs/planning/P2_ARI_108_TICKET_DECOMPOSITION_V1.md:673 ("targeted 既不能
  //      制造也不能阻止 SATURATED"), :690-691 (FAIL_CLOSED merge gate), :851 (H-5).
  //
  // C11 above pins only the BLOCKING direction. This is the converse.
  //
  // HISTORICAL, NOT CURRENT: when this case was first added, the manufacture
  // direction was genuinely unguarded — swapping the saturation precondition's
  // denominator at lib/retrieval-round-controller.mjs:350 from `plannedCoverageCount`
  // to `attemptsBudgetCount` left every suite in the repo green. That is the gap this
  // case closed, and it is why the ticket's merge-gate condition
  // (P2_ARI_108_TICKET_DECOMPOSITION_V1.md:690-691) is now satisfied.
  //
  // It is NO LONGER true that "no suite detects it": C11c below now catches the same
  // denominator substitution through the failed half of the targeted channel, so this
  // direction is doubly pinned. Removing this block alone still turns the file RED
  // (the tripwire sees the missing 'C11b:CONTINUE' record), but the substantive
  // regression C11b was written for would also be caught by C11c. Read the two as a
  // pair, not as one load-bearing case with an inert duplicate.
  //
  // The fixture is chosen so the two denominators DISAGREE and the earlier guards
  // stay out of the way (defaults: maxQueryBudget 10, maxRetrievalRounds 3,
  // minRoundsBeforeSaturation 1):
  //   plannedRoutes.length          = 4   -> the saturation precondition
  //   executedRoutesThisRound       = 1   -> plannedCoverageCount  = 1  (1 < 4)
  //   targetedAttempts              = 3   -> attemptsBudgetCount  = 4  (4 >= 4)
  //   attemptsBudgetCount (4) < maxQueryBudget (10)  -> budget guard does not fire
  //   roundIndex 1 >= minRoundsBeforeSaturation 1, and 1 < maxRetrievalRounds 3
  //   newCandidatesCount 0 -> the SATURATED branch is the branch under test
  // So with the correct denominator the run must NOT saturate; with the targeted
  // denominator leaking in it would. Asserting the decision is therefore
  // load-bearing against exactly that substitution.
  {
    const state = createInitialCoverageState({ planHash: H4_PLAN_HASH });
    state.retrieval.plannedRoutes = Array.from({ length: 4 }, () => ({
      providerId: 'official',
      capability: 'search',
    }));
    const result = evaluateRetrievalRound({
      coverageState: state,
      roundIndex: 1,
      newCandidatesCount: 0,
      totalCandidatesCount: 2,
      executedRoutesThisRound: [H4_ROUTE_A],
      providerFailuresThisRound: [],
      targetedAttempts: { executed: 3, failed: 0 },
    });
    // Document the fixture's premise before asserting on it: if either count
    // drifts, the case silently stops testing anything, so pin both.
    assert.equal(result.plannedCoverageCount, 1, 'fixture premise: only the planned route ran');
    assert.equal(result.attemptsBudgetCount, 4, 'fixture premise: the targeted channel pushed the other denominator up');
    assert.equal(
      result.attemptsBudgetCount >= state.retrieval.plannedRoutes.length,
      true,
      'fixture premise: the targeted denominator is what WOULD satisfy the precondition'
    );
    assert.notEqual(result.decision, DECISION_SATURATED, 'targeted attempts must not manufacture a saturation the plan routes did not earn');
    assert.notEqual(result.stopReason, 'zero_new_candidates');
    // The honest outcome is that the round keeps going, not that it stops for a
    // different reason. CONTINUE is the only decision that neither claims
    // saturation nor silently consumes the remaining budget here.
    assert.equal(result.decision, DECISION_CONTINUE);
    recordGateVerdict('C11b', result.decision);
  }

  // ---- C11c — `targeted.failed` must not manufacture saturation either -----
  // ref: docs/planning/P2_ARI_108_TICKET_DECOMPOSITION_V1.md:673 ("targeted 既不能
  //      制造也不能阻止 SATURATED"), :690-691 (FAIL_CLOSED merge gate), :851 (H-5).
  //
  // THE GAP C11b LEAVES OPEN. C11b fixes `targetedAttempts: { executed: 3, failed: 0 }`,
  // so it only ever proves the `executed` half of the targeted channel cannot inflate
  // the saturation denominator. The `failed` half is a SEPARATE input to the same
  // budget denominator (`attemptsBudgetCount = cumulativeAttemptsCount + executed + failed`,
  // lib/retrieval-round-controller.mjs:277) and was never exercised. Proven escapable by
  // mutation: swapping the precondition's denominator to
  // `plannedCoverageCount + resolvedTargetedAttempts.failed` leaves this suite green.
  //
  // The fixture is the NARROWEST possible version of C11b — identical geometry, only
  // the targeted split moved to the failed side:
  //   plannedRoutes.length    = 4  -> the saturation precondition
  //   executedRoutesThisRound = 1  -> plannedCoverageCount = 1  (1 < 4)
  //   targetedAttempts        = { executed: 0, failed: 3 } -> attemptsBudgetCount = 4 (>= 4)
  //   attemptsBudgetCount (4) < maxQueryBudget (10)     -> budget guard silent
  //   roundIndex 1 >= minRoundsBeforeSaturation 1, and 1 < maxRetrievalRounds 3
  //   newCandidatesCount 0    -> the SATURATED branch is the branch under test
  // A failed targeted attempt is not a planned route and earns no coverage, so the
  // correct answer is CONTINUE — the same verdict C11b demands, reached through the
  // other half of the same counterexample.
  {
    const state = createInitialCoverageState({ planHash: H4_PLAN_HASH });
    state.retrieval.plannedRoutes = Array.from({ length: 4 }, () => ({
      providerId: 'official',
      capability: 'search',
    }));
    const result = evaluateRetrievalRound({
      coverageState: state,
      roundIndex: 1,
      newCandidatesCount: 0,
      totalCandidatesCount: 2,
      executedRoutesThisRound: [H4_ROUTE_A],
      providerFailuresThisRound: [],
      targetedAttempts: { executed: 0, failed: 3 },
    });
    // Premise first: if either denominator drifts, the case silently stops testing
    // anything, so both are pinned before the verdict is claimed.
    assert.equal(result.plannedCoverageCount, 1, 'fixture premise: only the planned route ran, so no coverage was earned');
    assert.equal(result.attemptsBudgetCount, 4, 'fixture premise: the FAILED targeted attempts alone push the budget denominator to the precondition');
    assert.equal(result.targetedAttempts.failed, 3, 'fixture premise: the failed half of the targeted channel is what is under test');
    assert.equal(
      result.attemptsBudgetCount >= state.retrieval.plannedRoutes.length,
      true,
      'fixture premise: the targeted denominator is what WOULD satisfy the precondition'
    );
    // The load-bearing judgement: a FAILED targeted attempt must not be laundered into
    // planned coverage and used to claim saturation.
    assert.notEqual(result.decision, DECISION_SATURATED, 'failed targeted attempts must not manufacture a saturation the plan routes did not earn');
    assert.notEqual(result.stopReason, 'zero_new_candidates');
    assert.equal(result.decision, DECISION_CONTINUE);
    recordGateVerdict('C11c', result.decision);
  }

  // ---- C11d — historical provider failures count as coverage; the executed-
  //      routes-only count must not stand in for plannedCoverageCount ----------
  // ref: lib/retrieval-round-controller.mjs:270-277 (the two counters),
  //      :350 (the precondition), :288-306 + :348 (the THIS-round failure guard).
  //
  // SCOPE — WHAT THIS CASE DOES AND DOES NOT CLAIM. It pins exactly ONE thing: that a
  // provider failure already recorded in the coverage state counts toward
  // plannedCoverageCount. It does NOT pin the sibling clause in the same precondition,
  // `providerFailuresThisRound.length === 0` (a failure THIS round bars saturation) —
  // this fixture passes an empty array, so that branch is never entered here.
  //
  // OWNERSHIP OF THAT SIBLING CLAUSE: NOT ESTABLISHED. Do not assume it is covered
  // elsewhere. An earlier revision of this comment named a suite that owns it; that
  // claim was refuted by a round-3 reviewer's mutation sweep (deleting the clause left
  // every suite they ran green) and could not be independently re-verified in the
  // parent session before this file was finalized. Until a suite is mechanically shown
  // to catch that deletion, treat the clause as UNOWNED — the honest status, and the
  // reason this paragraph exists instead of a citation.
  //
  // THE GAP. The precondition at :350 compares `plannedCoverageCount`, which at :271 is
  // VERBATIM `cumulativeAttemptsCount` — existing executed routes PLUS existing
  // PROVIDER FAILURES plus this round's. A historical provider failure is an attempt the
  // plan made and paid for, so it counts toward coverage. The response object also carries
  // `cumulativeExecutedRoutesCount` (:270), which counts executed routes ONLY.
  // Substituting it for `plannedCoverageCount` in the precondition is therefore a
  // plausible-looking edit that silently drops historical provider failures out of the
  // saturation denominator. Proven escapable: with this case absent, the mutation
  // `cumulativeExecutedRoutesCount >= totalPlannedRoutes` leaves T13, T05, T06, T07, T08,
  // T09 and retrieval-round-controller.test.mjs all green, because no other fixture ever
  // puts a provider failure in the coverage state's HISTORY.
  //
  // The property is reachable on the LIVE path, not only synthetically: a mixed round
  // (some routes succeed, some fail) records executed routes alongside failures, so the two
  // counters diverge in real runs. This fixture narrows it further — 0 historical executed
  // routes — purely to maximise the disagreement between the two counters, which is what
  // makes the substitution observable. The narrowing is why the premise assertions below
  // are pinned rather than assumed.
  //
  // Fixture: 3 planned routes; 2 historical provider failures + 1 route executed THIS
  // round, none failed this round:
  //   plannedCoverageCount          = 2 (history failures) + 1 (this route) = 3 >= 3 ✓
  //   cumulativeExecutedRoutesCount = 0 (history routes) + 1 (this route)     = 1 <  3 ✗
  //   attemptsBudgetCount           = 3 < maxQueryBudget 10                   -> budget silent
  //   roundIndex 1 >= minRoundsBeforeSaturation 1, and 1 < maxRetrievalRounds 3
  //   newCandidatesCount 0 -> the SATURATED branch is the branch under test
  // The plan HAS earned saturation. If the executed-routes-only count were substituted
  // the round would fall through to CONTINUE — a false negative that keeps burning
  // rounds and budget on a query that has, by the frozen semantics, diminished.
  {
    const baseState = createInitialCoverageState({ planHash: H4_PLAN_HASH });
    baseState.retrieval.plannedRoutes = Array.from({ length: 3 }, () => ({
      providerId: 'official',
      capability: 'search',
    }));
    // Put the failures in the coverage state's HISTORY through the real, authorized
    // write hook — not by poking the object literal. OWNER_T06_RETRIEVAL is an
    // authorized caller for this hook (lib/coverage-state.mjs:613), and the hook
    // re-validates the returned state, so this is an in-contract transition.
    // Note the production writer actually uses OWNER_RETRIEVAL_CONTROLLER, not this
    // token, and it writes executedRoutes and providerFailures together — this fixture
    // deliberately narrows to failures-only, which is why the premise pins below matter.
    const state = updateRetrievalCoverage(
      baseState,
      {
        executedRoutes: [],
        providerFailures: [
          { code: 'provider_timeout', class: 'transient' },
          { code: 'rate_limited', class: 'transient' },
        ],
        fusedCandidateCount: 0,
      },
      { caller: OWNER_T06_RETRIEVAL }
    );

    const result = evaluateRetrievalRound({
      coverageState: state,
      roundIndex: 1,
      newCandidatesCount: 0,
      totalCandidatesCount: 2,
      executedRoutesThisRound: [H4_ROUTE_A],
      providerFailuresThisRound: [],
      targetedAttempts: { executed: 0, failed: 0 },
    });
    // Premise pins. `>=` deliberately, not `===`: what matters is that the two
    // counters DISAGREE about this fixture, so neither can be silently swapped for the
    // other without one of these failing.
    assert.equal(
      state.retrieval.providerFailures.length,
      2,
      'fixture premise: the coverage state really carries historical provider failures'
    );
    assert.equal(
      result.plannedCoverageCount,
      3,
      'fixture premise: historical provider failures count toward planned coverage'
    );
    assert.equal(
      result.cumulativeExecutedRoutesCount,
      1,
      'fixture premise: the executed-routes-only count is strictly smaller, so substituting it would change the verdict'
    );
    assert.equal(
      result.plannedCoverageCount >= state.retrieval.plannedRoutes.length,
      true,
      'fixture premise: the plan HAS earned the saturation precondition'
    );
    assert.equal(
      result.attemptsBudgetCount < 10,
      true,
      'fixture premise: the budget guard stays silent, so saturation is the branch reached'
    );
    // The load-bearing judgement: coverage earned by a paid, failed plan attempt still
    // counts, so the plan-earned saturation must NOT be blocked by the narrower counter.
    assert.equal(result.decision, DECISION_SATURATED, 'historical provider failures must not shrink the saturation denominator');
    assert.equal(result.stopReason, 'zero_new_candidates');
    recordGateVerdict('C11d', result.decision);
  }

  // ---- C12 — identity replay conflict re-runs, never falsely reuses ------
  // ref: test/p2a-t06-action-lifecycle-durable-commit.test.mjs:688 (root guard),
  //      test/p2a-t05-bounded-authorization-action-identity.test.mjs:557
  //
  // HONEST SCOPE NOTE: this exercises the ROOT guard of decideTargetedReplay
  // (p2a-t06:688) — the persisted identity content is tampered WITHOUT recomputing
  // the id, so the id→content binding mismatches and the guard forces RERUN. It
  // does NOT cover the p2a-t09 targeted-subphase ORCHESTRATION route. An earlier
  // draft of this comment cited p2a-t09:1379 as that route; that citation was
  // removed because it was factually wrong — p2a-t09:1379 is "G6 — CASE 2 BYPASSES
  // the E.6 dedupe gate" and the string REPLAY_CONFLICT does not appear anywhere in
  // p2a-t09-targeted-subphase-orchestration.test.mjs. C12 claims the root guard it
  // depends on, not that integration path.
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

  // Inline completeness: the gate must have observed every verdict, in order.
  assert.deepEqual(
    GATE_VERDICTS,
    GATE_EXPECTED_VERDICTS,
    'the C1–C12 matrix gate must observe every counterexample verdict',
  );
});

// Resource hygiene (SECURITY review P3): remove every fixture work dir.
//
// ORDER IS LOAD-BEARING. node:test runs top-level `after` hooks in registration
// order and SKIPS the remaining hooks once one fails. A cleanup hook registered
// after the tripwire would therefore never run on exactly the runs that matter:
// a gate that throws leaves GATE_VERDICTS incomplete, the tripwire fails, and the
// cleanup below would be skipped — leaking every fixture dir the run created. So
// the cleanup is registered FIRST, while the tripwire stays last.
after(() => {
  for (const dir of WORK_DIRS) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Fails when WORK_DIRS is empty, which is what a gate body replaced by
  // `return;` produces — so this hook, not the tripwire below, is what catches
  // that particular neutering now that it runs FIRST. Without it the survivor
  // check below would be vacuously true on an empty array and a neutered gate
  // would look like a clean sweep. An always-true cleanup assertion is not a
  // cleanup assertion, and this suite's whole point is that none is decorative.
  assert.ok(
    WORK_DIRS.length > 0,
    'fixtures must actually have created work dirs for cleanup to be meaningful',
  );
  assert.equal(
    WORK_DIRS.filter((d) => fs.existsSync(d)).length,
    0,
    'no fixture work dir may survive the suite',
  );
});

// Anti-hollow tripwire — registered OUTSIDE the gate callback, and LAST so that the
// cleanup hook above has already run. It catches a gate that started but did not
// finish: a throw partway through leaves GATE_VERDICTS incomplete here. The
// wholesale `return;` neutering is caught by the cleanup hook's WORK_DIRS guard
// instead, since that mutation also removes every fixture creation.
after(() => {
  assert.deepEqual(
    GATE_VERDICTS,
    GATE_EXPECTED_VERDICTS,
    'C1–C12 gate liveness: the gate callback body did not execute its counterexamples',
  );
});
