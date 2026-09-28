// SPDX-License-Identifier: AGPL-3.0-only
/**
 * P2A-T09 (#121) — targeted sub-phase orchestration tests.
 *
 * Covers the ticket's REQUIRED_TESTS: position assertion, default equivalence
 * (source-level + the untouched P1 suites as the runtime evidence), the two
 * contact-surface enumeration + anti-second-pipeline guard, the integration
 * happy path, same-pool equivalence, and crash-boundary injection.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SUBPHASE_ERROR_INVALID,
  SUBPHASE_STATUS_COMPLETED,
  SUBPHASE_STATUS_NO_ACTION,
  runTargetedSubphase,
} from '../lib/targeted-requery-subphase.mjs';
import {
  AUTH_CLASS_OFFICIAL_SECRET,
  CAPABILITY_SEARCH,
  COMPLETENESS_UNKNOWN,
  createProviderSeam,
} from '../lib/provider-seam.mjs';
import { planHash } from '../lib/plan-contract.mjs';
import { runMultiQueryRetrieval } from '../lib/retrieval.mjs';
import { diagnoseGaps } from '../lib/targeted-requery-diagnosis.mjs';
import { sortGapsByGapId } from '../lib/targeted-requery-ledger.mjs';
import {
  ACTION_STATUS_COMMITTED,
  ACTION_STATUS_RESOLVED,
  RESUME_REASON_BINDING_HASH_MISSING,
  RESUME_RERUN,
  RESUME_REUSE,
  TARGETED_BINDING_PREFIX,
  decideTargetedReplay,
} from '../lib/targeted-requery-lifecycle.mjs';
import { RESOLUTION_BASIS_DUPLICATE_ONLY } from '../lib/targeted-requery-resolution.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const LIB = path.resolve(HERE, '..', 'lib');

const RUN_ID = 'run-p2a-t09';
const OCCURRENCE = 'occ-p2a-t09';

/** The single base query covers `framing-b` only, so `framing-a` / both aspects are gaps. */
const PLAN = Object.freeze({
  schemaVersion: 1,
  queryVariants: ['framing-b'],
  aspects: ['技术成熟度', '商业化节奏'],
  entities: [],
  opposingFramings: ['framing-a', 'framing-b'],
  terminologyVariants: [],
  sourceGroupIntents: [],
});
const PLAN_HASH = planHash(PLAN);

/** Strip block and line comments so source guards count CODE, not prose. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function tmpWorkDir(prefix = 'p2a-t09-subphase') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function searchResult(providerId, entries, query) {
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: '2026-09-29T00:00:00.000Z',
    items: entries.map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'fixture' } },
    query,
  };
}

function fixtureSearchAdapter(providerId, handler) {
  let calls = 0;
  return {
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve(input) { calls += 1; return handler(input); },
    __calls: () => calls,
  };
}

/** Base retrieval executes `framing-b` → questionId 100; a targeted `framing-a` → 900/901. */
function buildFixture(handler = null) {
  const adapter = fixtureSearchAdapter('fixture-a', handler ?? ((input) => (
    input.query === 'framing-a'
      ? searchResult('fixture-a', [['900', 1], ['901', 2]], input.query)
      : searchResult('fixture-a', [['100', 1]], input.query)
  )));
  const seam = createProviderSeam({ adapters: [adapter] });
  const channels = [{ providerId: 'fixture-a' }];
  const plannedRoutes = [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH }];
  return { adapter, seam, channels, plannedRoutes };
}

/** Run the base retrieval and shape it as the accumulated pool the loop would emit. */
function baseAccumulatedPool(seam, channels, workDir) {
  const run = runMultiQueryRetrieval({ plan: PLAN, planHash: PLAN_HASH, seam, channels, workDir });
  assert.equal(run.ok, true);
  return {
    schemaVersion: 1,
    type: 'retrieval-pool',
    planHash: PLAN_HASH,
    channels: run.pool.channels,
    candidates: run.pool.candidates,
    rejected: [],
    criteria: { fusion: 'rrf', scope: 'multi-round-accumulated', retrievalRounds: 1 },
  };
}

function gapsFor(pool, plan = PLAN, planHashValue = PLAN_HASH) {
  const provenance = [...new Set(pool.channels.filter((c) => c.ok).map((c) => c.channel.query))];
  const diagnosed = diagnoseGaps({
    plan,
    executedQueryProvenance: provenance,
    planHash: planHashValue,
    occurrenceId: OCCURRENCE,
    diagnosisRound: 0,
  });
  return sortGapsByGapId(diagnosed.records);
}

const aspectGaps = (pool) => gapsFor(pool).filter((g) => g.gapType === 'ASPECT_GAP');
const contradictionGap = (pool) => gapsFor(pool).find((g) => g.gapType === 'CONTRADICTION_GAP');

/** A T04-admissible proposal: `opposingFramings[index]` is plan-owned. */
function proposalFor(gap, index = 0) {
  return { gapId: gap.gapId, planOwnedStringRef: { field: 'opposingFramings', index } };
}

function subphaseArgs(workDir, fixture, pool, proposals, extra = {}) {
  return {
    workDir,
    plan: PLAN,
    planHash: PLAN_HASH,
    runId: RUN_ID,
    occurrenceId: OCCURRENCE,
    seam: fixture.seam,
    channels: fixture.channels,
    plannedRoutes: fixture.plannedRoutes,
    accumulatedPool: pool,
    proposals,
    maxQueryBudget: 10,
    maxAttemptsPerGap: 2,
    state: { hashes: {} },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// A. position + anti-second-pipeline + contact-surface guards
// ---------------------------------------------------------------------------

test('A1 — the sub-phase call site is INSIDE STAGE_SEARCH, after the retrieval loop and before T08 selection', () => {
  const source = fs.readFileSync(path.join(LIB, 'p1-runtime-composer.mjs'), 'utf8');
  const loop = source.indexOf('runRetrievalFeedbackLoop(');
  const subphase = source.indexOf('runTargetedSubphase(');
  const selection = source.indexOf('applySourceGroupSelection(');
  assert.ok(loop >= 0 && subphase >= 0 && selection >= 0, 'all three call sites must exist');
  assert.ok(loop < subphase, 'targeted sub-phase must run AFTER the retrieval feedback loop');
  assert.ok(subphase < selection, 'targeted sub-phase must run BEFORE T08 source-group selection');
  assert.equal(source.match(/runTargetedSubphase\(/g).length, 1);
});

test('A2 — no second retrieval pipeline: the sub-phase uses only runMultiQueryRetrieval', () => {
  const source = stripComments(fs.readFileSync(path.join(LIB, 'targeted-requery-subphase.mjs'), 'utf8'));
  assert.equal(source.match(/const res = runMultiQueryRetrieval\(/g).length, 1);
  assert.equal(/rrfFusion\s*\(/.test(source), false, 'must never call rrfFusion directly');
  assert.equal(/seam\.retrieve\s*\(/.test(source), false, 'must never combine seam.retrieve itself');
  assert.equal(/createProviderSeam\s*\(/.test(source), false);
  assert.equal(/rankSource|tieBreak/.test(source), false);
});

test('A3 — the two frozen P1 contact surfaces are exactly retrieval.mjs and retrieval-round-controller.mjs', () => {
  const retrieval = stripComments(fs.readFileSync(path.join(LIB, 'retrieval.mjs'), 'utf8'));
  const roundController = stripComments(fs.readFileSync(path.join(LIB, 'retrieval-round-controller.mjs'), 'utf8'));
  assert.ok(retrieval.includes('targetedQueries'), 'T02 contact surface: runMultiQueryRetrieval.targetedQueries');
  assert.ok(roundController.includes('targetedAttempts'), 'T07 contact surface: evaluateRetrievalRound.targetedAttempts');
  assert.equal(/targeted-requery/.test(roundController), false, 'the P1 round controller must stay ignorant of the targeted family');
  for (const file of ['rrf.mjs', 'plan-contract.mjs', 'source-group-selection.mjs', 'coverage-state.mjs']) {
    const source = stripComments(fs.readFileSync(path.join(LIB, file), 'utf8'));
    assert.equal(/targetedQueries|targetedAttempts/.test(source), false, `${file} must carry no targeted contact surface`);
  }
});

test('A4 — the frozen accumulated-pool artifact-walk call site is byte-unchanged', () => {
  // AC4: the T06/T07 accumulated-pool walk is consumed verbatim — the sub-phase
  // performs its OWN single walk over the AUGMENTED pool (the T09 writer face) and
  // never edits the frozen call site.
  const cfi = fs.readFileSync(path.join(LIB, 'coverage-final-integration.mjs'), 'utf8');
  assert.ok(
    cfi.includes('const safety = assertArtifactSafe(accumulatedPool, { trustedPlanStrings: new Set(Array.isArray(plan.queryVariants) ? plan.queryVariants : []) });'),
    'the frozen accumulated-pool walk call site must be byte-identical',
  );
  const subphase = stripComments(fs.readFileSync(path.join(LIB, 'targeted-requery-subphase.mjs'), 'utf8'));
  assert.equal(subphase.match(/assertArtifactSafe\(/g).length, 1, 'the sub-phase walks the augmented pool exactly once');
});

// ---------------------------------------------------------------------------
// B. fail-closed input gates
// ---------------------------------------------------------------------------

test('B1 — malformed anchors fail closed with a typed error and write no artifact', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const before = fs.readdirSync(workDir).sort();
  assert.throws(
    () => runTargetedSubphase({ ...subphaseArgs(workDir, fixture, pool, []), planHash: 'not-hex' }),
    (err) => err.code === SUBPHASE_ERROR_INVALID,
  );
  assert.throws(
    () => runTargetedSubphase({ ...subphaseArgs(workDir, fixture, pool, []), maxQueryBudget: 0 }),
    (err) => err.code === SUBPHASE_ERROR_INVALID,
  );
  assert.deepEqual(fs.readdirSync(workDir).sort(), before, 'a refused call must leave the work dir byte-identical');
});

// ---------------------------------------------------------------------------
// C. determinism + E.7 no silent re-run
// ---------------------------------------------------------------------------

test('C1 — a gap with no admissible proposal is never actioned (E.7)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gaps = aspectGaps(pool);
  assert.ok(gaps.length >= 2, 'fixture must diagnose at least two aspect gaps');
  const callsBefore = fixture.adapter.__calls();

  const result = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gaps[0], 0)]));

  assert.equal(result.ok, true);
  assert.equal(result.status, SUBPHASE_STATUS_COMPLETED);
  assert.equal(fixture.adapter.__calls(), callsBefore + 1, 'exactly one targeted query executed');
  assert.equal(result.executedActionIds.length, 1);
  assert.equal(fs.existsSync(path.join(workDir, 'targeted-requery-subphase')), true);
});

test('C2 — gaps are processed in gapId ascending order (E.8 canonical order)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gaps = aspectGaps(pool);
  const result = runTargetedSubphase(
    subphaseArgs(workDir, fixture, pool, [proposalFor(gaps[1], 1), proposalFor(gaps[0], 0)]),
  );
  const ids = result.gaps.map((g) => g.gapId);
  assert.deepEqual(ids, [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});

test('C3 — an empty actionable set is a legal NO_ACTION (never a fabricated gap)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const coveredPlan = { ...PLAN, aspects: ['framing-b'], opposingFramings: ['framing-b'] };
  const coveredHash = planHash(coveredPlan);
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const result = runTargetedSubphase({
    ...subphaseArgs(workDir, fixture, pool, []),
    plan: coveredPlan,
    planHash: coveredHash,
    accumulatedPool: { ...pool, planHash: coveredHash },
  });
  assert.equal(result.status, SUBPHASE_STATUS_NO_ACTION);
  assert.equal(result.counts.executed, 0);
  assert.equal(fixture.adapter.__calls(), 1, 'no targeted query was executed');
});

// ---------------------------------------------------------------------------
// D. integration happy path (diagnose → authorize → execute → commit → resolve)
// ---------------------------------------------------------------------------

test('D1 — the full sequence produces a COMMITTED action, a bound checkpoint and a RESOLVED gap', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  assert.ok(gap, 'the uncovered opposing framing must be diagnosed');
  const callsBefore = fixture.adapter.__calls();

  const result = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));

  assert.equal(fixture.adapter.__calls(), callsBefore + 1);
  assert.deepEqual(result.counts, { executed: 1, failed: 0 });

  const record = result.actionsArtifact.targetedActions.find((r) => r.targetedActionId === result.executedActionIds[0]);
  assert.equal(record.status, ACTION_STATUS_RESOLVED);
  assert.ok(record.audit.some((a) => a.to === ACTION_STATUS_COMMITTED), 'COMMITTED must be journaled');

  const bindingKey = `${TARGETED_BINDING_PREFIX}${result.executedActionIds[0]}`;
  assert.match(String(result.state.hashes[bindingKey]), /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(path.join(workDir, 'orchestration-state.json')), true, 'the checkpoint was committed');

  const resolution = result.resolutionArtifact.resolutions.find((r) => r.gapId === gap.gapId);
  assert.equal(resolution.status, ACTION_STATUS_RESOLVED);
  assert.equal(resolution.resolutionPredicateRef, 'OPPOSING_SIDE_NEW_SOURCES_V1');

  assert.equal(fs.existsSync(path.join(workDir, 'retrieval-rounds', 'accumulated-pool.json')), true);
});

// ---------------------------------------------------------------------------
// E. same-pool equivalence (RRF dedup, deterministic order, duplicate handling)
// ---------------------------------------------------------------------------

test('E1 — targeted candidates enter the SAME pool with best-rrfScore dedup and canonical order', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);

  const result = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));

  const ids = result.pool.candidates.map((c) => c.identity.questionId);
  assert.ok(ids.includes('100'), 'the base candidate survives');
  assert.ok(ids.includes('900') && ids.includes('901'), 'the targeted candidates are merged in');
  for (let i = 1; i < result.pool.candidates.length; i += 1) {
    const prev = result.pool.candidates[i - 1];
    const cur = result.pool.candidates[i];
    const byScore = Number(cur.rrfScore) - Number(prev.rrfScore);
    assert.ok(
      byScore < 0 || (byScore === 0 && String(prev.identity.questionId) < String(cur.identity.questionId)),
      'candidates must stay in the frozen RRF order',
    );
  }
  assert.equal(new Set(ids).size, ids.length, 'no duplicated canonical identity');
});

test('E2 — a targeted result that adds no new canonical questionId is not evidence (G.1)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture((input) => searchResult('fixture-a', [['100', 1]], input.query));
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);

  const result = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));
  const resolution = result.resolutionArtifact.resolutions.find((r) => r.gapId === gap.gapId);
  assert.equal(resolution.status, 'UNRESOLVED');
  assert.equal(resolution.resolutionBasis, RESOLUTION_BASIS_DUPLICATE_ONLY);
});

// ---------------------------------------------------------------------------
// F. crash boundary injection
// ---------------------------------------------------------------------------

test('F1 — a crash before the checkpoint commit yields no completion evidence (one safe re-run)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  assert.throws(() => runTargetedSubphase({
    ...args,
    crashAt: (label) => { if (label === 'after_targeted_commit_prepare') throw new Error('simulated SIGKILL'); },
  }), /simulated SIGKILL/);

  const artifact = JSON.parse(fs.readFileSync(path.join(workDir, 'targeted-requery-actions.json'), 'utf8'));
  const committed = artifact.targetedActions.find((r) => r.status === ACTION_STATUS_COMMITTED);
  assert.ok(committed, 'the COMMITTED record was persisted before the crash');
  const replay = decideTargetedReplay({
    workDir,
    state: { hashes: {} },
    artifact,
    identity: {
      runId: committed.runId,
      occurrenceId: committed.occurrenceId,
      planHash: committed.planHash,
      gapId: committed.gapId,
      attempt: committed.attempt,
      normalizedQuery: committed.normalizedQuery,
      providerScope: committed.providerScope,
    },
  });
  assert.equal(replay.decision, RESUME_RERUN);
  assert.equal(replay.reason, RESUME_REASON_BINDING_HASH_MISSING);
});

test('F2 — after a completed run the committed action is REUSEd (never re-executed)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);

  const result = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));
  const record = result.actionsArtifact.targetedActions.find((r) => r.targetedActionId === result.executedActionIds[0]);
  const replay = decideTargetedReplay({
    workDir,
    state: result.state,
    artifact: result.actionsArtifact,
    identity: {
      runId: record.runId,
      occurrenceId: record.occurrenceId,
      planHash: record.planHash,
      gapId: record.gapId,
      attempt: record.attempt,
      normalizedQuery: record.normalizedQuery,
      providerScope: record.providerScope,
    },
  });
  assert.equal(replay.decision, RESUME_REUSE);
});

// ---------------------------------------------------------------------------
// G. default equivalence (source-level; the untouched P1 suites are the runtime
//    evidence and are run unchanged by the classified gate)
// ---------------------------------------------------------------------------

test('G1 — the composer only runs the sub-phase behind an opt-in guard (default off)', () => {
  const source = fs.readFileSync(path.join(LIB, 'p1-runtime-composer.mjs'), 'utf8');
  const guard = source.indexOf('if (targetedSubphase !== null) {');
  const call = source.indexOf('runTargetedSubphase(');
  assert.ok(guard >= 0, 'the opt-in guard must exist');
  assert.ok(guard < call, 'the call must be inside the opt-in guard');
  assert.equal((source.match(/targetedSubphase\s*=\s*null/g) ?? []).length, 1, 'default value must be null (disabled)');
});
