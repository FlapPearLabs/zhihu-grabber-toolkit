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
  TARGETED_SUBPHASE_DIRNAME,
} from '../lib/targeted-requery-subphase.mjs';
import {
  AUTH_CLASS_OFFICIAL_SECRET,
  CAPABILITY_SEARCH,
  COMPLETENESS_UNKNOWN,
  createProviderSeam,
} from '../lib/provider-seam.mjs';
import { assertArtifactSafe } from '../lib/rrf.mjs';
import { planHash } from '../lib/plan-contract.mjs';
import { makeState, readState, writeState } from '../lib/state.mjs';
import { RETRIEVAL_POOL_FILENAME, runMultiQueryRetrieval } from '../lib/retrieval.mjs';
import { diagnoseGaps } from '../lib/targeted-requery-diagnosis.mjs';
import { sortGapsByGapId } from '../lib/targeted-requery-ledger.mjs';
import {
  ACTIONS_FILENAME,
  ACTION_STATUS_COMMITTED,
  ACTION_STATUS_EVALUATED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
  ACTION_STATUS_FAILED_OPERATIONAL,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
  RESUME_REASON_BINDING_HASH_MISSING,
  RESUME_RERUN,
  RESUME_REUSE,
  TARGETED_BINDING_PREFIX,
  decideTargetedReplay,
} from '../lib/targeted-requery-lifecycle.mjs';
import { RESOLUTION_BASIS_DUPLICATE_ONLY, RESOLUTION_FILENAME } from '../lib/targeted-requery-resolution.mjs';
import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';

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

test('A5 — the augmented walk NEVER extends trustedPlanStrings with targeted strings (F.3 / D12-3)', () => {
  // FROZEN: "MVP 不向 assertArtifactSafe 的既有调用点传入任何扩展
  // trustedPlanStrings" (seam contract F.3, D12-3, seam map §3). Listing a string
  // in the trust set is a RELAXATION — it exempts that string from the
  // provider-content lens — and T04's admission gate is the INTERSECTION of two
  // lenses, so feeding admitted targeted strings into the walk would extend a
  // single-lens relaxation to new strings. T11's acceptance criterion is
  // precisely that targeted strings appear in no trustedPlanStrings.
  const source = stripComments(fs.readFileSync(path.join(LIB, 'targeted-requery-subphase.mjs'), 'utf8'));
  assert.equal(
    /normalizedQuery[^\n]*trustedPlanStrings|trustedPlanStrings[^\n]*normalizedQuery/.test(source),
    false,
    'a targeted query string must never flow into a trustedPlanStrings set',
  );
  assert.equal(
    /extraTrustedStrings/.test(source),
    false,
    'the extraTrustedStrings escape hatch must not exist',
  );
  // The walk must build its trust set from plan.queryVariants alone.
  assert.ok(
    /const trusted = new Set\(Array\.isArray\(plan\.queryVariants\) \? plan\.queryVariants : \[\]\);/.test(source),
    'the augmented walk trust set is plan.queryVariants and nothing else',
  );
  // And behaviourally: a targeted string that the UNTRUSTED baseline would reject
  // must still be refused, proving the trust list is not laundering it.
  const seam = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', () => {
    throw new Error('no provider call expected');
  })] });
  const walked = assertArtifactSafe({
    schemaVersion: 1,
    type: 'retrieval-pool',
    planHash: PLAN_HASH,
    channels: [],
    candidates: [{
      identity: { kind: 'candidate', questionId: '900' },
      provenance: { route: 'fixture', rank: 1, rankOrigin: 'fixture_order' },
      source_url: '/etc/hosts 文件的作用',
      facts: {},
    }],
    rejected: [],
    criteria: { fusion: 'rrf', scope: 'x', retrievalRounds: 1 },
  }, { trustedPlanStrings: new Set(PLAN.queryVariants) });
  assert.equal(walked.ok, false, 'an unsafe string in provider content stays unsafe without being trusted');
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

test('F3 — a pre-checkpoint crash does NOT let the record fabricate its own completion credential', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  assert.throws(() => runTargetedSubphase({
    ...args,
    crashAt: (label) => { if (label === 'after_targeted_commit_prepare') throw new Error('simulated SIGKILL'); },
  }), /simulated SIGKILL/);
  const callsAfterCrash = fixture.adapter.__calls();

  // On re-run T06's replay returns RERUN (the checkpoint never carried the binding).
  // F.5 forbids manufacturing completion evidence from the record's own bindingHash —
  // that value is outside the F.1 identity and is not checkpoint-anchored, so
  // promoting it is exactly the P1-R06 unanchored-second-credential P0. The correct
  // behaviour is to finish the recorded action WITHOUT re-paying and WITHOUT
  // claiming a binding the checkpoint never committed.
  const recovered = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));

  assert.equal(fixture.adapter.__calls(), callsAfterCrash, 'no repeated paid retrieval');
  assert.equal(recovered.executedActionIds.length, 0, 'nothing was re-executed');
  const record = recovered.actionsArtifact.targetedActions.find((r) => r.gapId === gap.gapId);
  const bindingKey = `${TARGETED_BINDING_PREFIX}${record.targetedActionId}`;
  assert.equal(
    recovered.state.hashes?.[bindingKey],
    undefined,
    'the checkpoint must NOT gain a binding it never committed (checkpoint is the only trust root)',
  );
  assert.notEqual(
    record.bindingHash,
    undefined,
    "the record's own memory of the artifact is retained as audit history",
  );
  assert.ok(
    [ACTION_STATUS_COMMITTED, ACTION_STATUS_EVALUATED, ACTION_STATUS_RESOLVED,
      ACTION_STATUS_UNRESOLVED, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET].includes(record.status),
    'the recorded action did reach a committed-set status',
  );
  const ids = recovered.pool.candidates.map((c) => c.identity.questionId);
  assert.ok(ids.includes('900') && ids.includes('901'), 'the already-paid candidates were NOT dropped');
});

test('F3b — a crash between the commit point and the T08 conclusion still reaches a terminal on re-run', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  // Crash AFTER the checkpoint commit (binding durable, so the replay decision is
  // REUSE) but BEFORE the T08 verdict: the record is stuck at COMMITTED, which is in
  // COMMITTED_SET yet is NOT one of FINAL_EVIDENCE_STATUSES. This is the window the
  // REUSE branch's `advanceToTerminal` exists for — the pre-commit
  // `after_targeted_execution` label exercises the AUTHORIZED re-run path instead.
  assert.throws(() => runTargetedSubphase({
    ...args,
    crashAt: (label) => { if (label === 'after_targeted_commit_finalize') throw new Error('simulated SIGKILL'); },
  }), /simulated SIGKILL/);

  const crashed = fs.readFileSync(path.join(workDir, ACTIONS_FILENAME), 'utf8');
  assert.equal(
    JSON.parse(crashed).targetedActions.some((r) => r.status === ACTION_STATUS_COMMITTED),
    true,
    'precondition: a COMMITTED-but-unconcluded record is on disk',
  );

  const callsAfterCrash = fixture.adapter.__calls();
  // The recovered run must receive the PERSISTED checkpoint — the commit point is
  // complete, so the binding is on disk. Handing it a fresh empty `state` would
  // reproduce the production bug this suite exists to catch (makeState starts from
  // `hashes: {}`), and the replay decision would downgrade a proven REUSE to RERUN.
  const persisted = JSON.parse(fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8'));
  const recovered = runTargetedSubphase({
    ...subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]),
    state: persisted,
  });

  assert.equal(fixture.adapter.__calls(), callsAfterCrash, 'REUSE must not repeat the paid retrieval');
  assert.equal(recovered.reusedActionIds.length, 1, 'the committed binding made this a REUSE');
  const record = recovered.actionsArtifact.targetedActions.find((r) => r.gapId === gap.gapId);
  assert.equal(
    record.status,
    ACTION_STATUS_RESOLVED,
    'a COMMITTED-but-unconcluded action must not be stranded without a terminal (S10)',
  );
  const resolution = recovered.resolutionArtifact.resolutions.find((r) => r.gapId === gap.gapId);
  assert.notEqual(resolution, undefined, 'a resolution record was written for the gap');
  const ids = recovered.pool.candidates.map((c) => c.identity.questionId);
  assert.ok(ids.includes('900') && ids.includes('901'), 'the committed evidence was carried forward');
});

test('F3c — a committed action whose bytes are gone FAILS CLOSED instead of reporting ok with dropped evidence', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  // Crash before finalizeTargetedCommit → COMMITTED record, NO checkpoint binding,
  // then delete the staged bytes so nothing is readable and nothing may be re-paid.
  assert.throws(() => runTargetedSubphase({
    ...args,
    crashAt: (label) => { if (label === 'after_targeted_commit_prepare') throw new Error('simulated SIGKILL'); },
  }), /simulated SIGKILL/);
  fs.rmSync(path.join(workDir, TARGETED_SUBPHASE_DIRNAME), { recursive: true, force: true });

  assert.throws(
    () => runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)])),
    /no completion evidence/,
    'dropping paid evidence silently behind ok:true is a silent wrong value',
  );
});

test('H1 — a NEW occurrence in a reused work dir does NOT load the prior occurrence artifacts', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);

  // Occurrence A populates the work dir. Occurrence B (same planHash, same workDir)
  // must not inherit it: `loadActionsArtifact` only checks planHash, and the
  // composer archives only the group-level state, so without an occurrence anchor
  // check the very first `registerAuthorizedAction` throws on the occurrenceId
  // anchor and aborts the whole composition.
  const first = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));
  assert.equal(first.actionsArtifact.occurrenceId, OCCURRENCE);

  const second = runTargetedSubphase({
    ...subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]),
    occurrenceId: 'occurrence-b',
  });

  assert.equal(second.actionsArtifact.occurrenceId, 'occurrence-b', 'the anchor is occurrence B');
  assert.equal(second.ok, true, 'a new occurrence must not abort on the stale anchor');
  assert.equal(
    second.actionsArtifact.targetedActions.every((r) => r.occurrenceId === 'occurrence-b'),
    true,
    'every persisted record belongs to the current occurrence',
  );
  assert.equal(
    second.actionsArtifact.targetedActions.some((r) => r.occurrenceId === OCCURRENCE),
    false,
    "no record from the prior occurrence survived into the new one",
  );
});

test('H3 — a terminal conclusion whose evidence bytes are gone FAILS CLOSED (F.5 has no terminal exemption)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  const first = runTargetedSubphase(args);
  const record = first.actionsArtifact.targetedActions.find((r) => r.gapId === gap.gapId);
  assert.equal(record.status, ACTION_STATUS_RESOLVED, 'precondition: a terminal conclusion exists');
  // Destroy the evidence AND the checkpoint binding: the verdict stands, the bytes
  // do not. F.5 says hash-mismatch / missing-artifact → treat as uncommitted, with
  // no terminal exemption, and nothing downstream reads the resolution artifact —
  // the augmented pool is the only downstream-consumable product. So this must
  // fail closed rather than report ok:true with the paid pool dropped.
  fs.rmSync(path.join(workDir, TARGETED_SUBPHASE_DIRNAME), { recursive: true, force: true });

  assert.throws(
    () => runTargetedSubphase({ ...args, state: { hashes: {} } }),
    /no completion evidence and no readable product/,
    'a terminal verdict must not license silently dropping its evidence',
  );
});

test('H2 — a real composer RESUME carries a real targeted binding across, making F.5 REUSE reachable', async () => {
  // This must drive the PRODUCTION path, not re-type the composer's one-line
  // carry-over: seed a resumable checkpoint, run composeP1Research so the sub-phase
  // commits real bindings, kill the run, then resume (restart=false) and assert the
  // bindings survived the resume boundary AND that they are what make the next run
  // a REUSE. A semantic regression in the composer's resume branch (wrong state
  // object, wrong `existing` reference) would break real F.5 reachability while a
  // hand-rolled copy of the same line kept passing.
  const workDir = tmpWorkDir('p2a-t09-h2-resume');
  const args = g2ComposeArgs(workDir);
  const plan = { ...G2_PLAN, opposingFramings: ['AI 编程工具无法取代 程序员'] };
  const occurrenceId = 'occurrence-h2';

  const seeded = makeState({
    workDir,
    topic: args.topic,
    mode: 'p1-cross-question-deep-research',
    percent: null,
    runtime: args.runtime.runtimeId,
    occurrenceId,
    config: {},
  });
  seeded.stage = 'search';
  writeState(workDir, seeded);

  const proposals = sortGapsByGapId(diagnoseGaps({
    plan,
    executedQueryProvenance: [...plan.queryVariants],
    planHash: planHash(plan),
    occurrenceId,
    diagnosisRound: 0,
  }).records).map((gap) => ({
    gapId: gap.gapId,
    planOwnedStringRef: { field: 'opposingFramings', index: 0 },
  }));

  const targetedSubphase = { proposals, maxQueryBudget: 10, maxAttemptsPerGap: 2 };

  // Establish real bindings: a full composition with the sub-phase enabled.
  const first = await composeP1Research({ ...args, plan, targetedSubphase });
  assert.equal(first.ok, true, `first pass failed: ${JSON.stringify(first)}`);

  const afterFirst = readState(workDir);
  const carriedKeys = Object.keys(afterFirst.hashes ?? {}).filter((k) => k.startsWith(TARGETED_BINDING_PREFIX));
  assert.ok(carriedKeys.length >= 1, `precondition: real bindings exist (got ${JSON.stringify(carriedKeys)})`);
  for (const key of carriedKeys) {
    assert.match(afterFirst.hashes[key], /^[0-9a-f]{64}$/, `${key} is a canonical hash`);
  }

  // Simulate a process SIGKILLed after the sub-phase committed: the durable
  // checkpoint a real kill leaves is non-terminal. A `crashPoint` throw CANNOT
  // produce this state — the composer catches every throw and marks the run FAILED,
  // which forces a restart and therefore a NEW occurrence, so no binding would ever
  // be carried. Rewinding `stage` is the faithful stand-in for those bytes.
  writeState(workDir, { ...afterFirst, stage: 'search' });

  // Second pass: an ordinary resume (restart defaults to false). The composer's
  // resume boundary must adopt those bindings, which is the ONLY thing that lets
  // decideTargetedReplay return REUSE instead of re-paying.
  const second = await composeP1Research({ ...args, plan, targetedSubphase });
  assert.equal(second.ok, true, `resume failed: ${JSON.stringify(second)}`);

  const actions = JSON.parse(fs.readFileSync(path.join(workDir, ACTIONS_FILENAME), 'utf8'));
  const terminal = actions.targetedActions.filter((r) => r.status === ACTION_STATUS_RESOLVED
    || r.status === ACTION_STATUS_UNRESOLVED
    || r.status === ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET);
  assert.ok(terminal.length >= 1, 'the resumed run still carries terminal conclusions');

  // The resume must not have created a SECOND action for work already paid for:
  // a re-payment shows up as a duplicate commit under a new id.
  const actionIds = actions.targetedActions.map((r) => r.targetedActionId);
  assert.equal(new Set(actionIds).size, actionIds.length, 'no duplicate action was created by the resume');
  for (const r of actions.targetedActions) {
    const commits = r.audit.filter((a) => a.event === 'COMMIT').length;
    assert.ok(commits <= 1, `action ${r.targetedActionId.slice(0, 8)} committed ${commits} times`);
  }

  // The final checkpoint must STILL hold the bindings (terminal rebuild preserves
  // them) — otherwise the next resume would re-pay.
  const finalState = readState(workDir);
  const finalKeys = Object.keys(finalState.hashes ?? {}).filter((k) => k.startsWith(TARGETED_BINDING_PREFIX));
  assert.deepEqual(finalKeys.sort(), carriedKeys.sort(), 'bindings survive all the way to the final checkpoint');
});

test('H4 — a committed artifact whose bytes were tampered with is refused, not merged', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  runTargetedSubphase(args);
  // Locate the committed round product and append a candidate, keeping it valid JSON.
  const dir = fs.readdirSync(path.join(workDir, TARGETED_SUBPHASE_DIRNAME))
    .find((d) => d.startsWith('action-'));
  const poolFile = path.join(workDir, TARGETED_SUBPHASE_DIRNAME, dir, RETRIEVAL_POOL_FILENAME);
  const parsed = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
  parsed.candidates.push({
    ...parsed.candidates[0],
    identity: { kind: 'candidate', questionId: '999999' },
  });
  fs.writeFileSync(poolFile, JSON.stringify(parsed, null, 2));

  // The bytes are parseable and correctly shaped — only the hash reveals the edit.
  assert.throws(
    () => runTargetedSubphase({ ...args, state: { hashes: {} } }),
    /no completion evidence and no readable product/,
    'a tampered-but-parseable artifact must fail closed, never be merged behind ok:true',
  );
});

test('I1 — a full-chain composeP1Research run with the sub-phase ENABLED executes and augments the pool', async () => {
  // G2 only proves the DISABLED path is byte-identical. Nothing ran the enabled
  // wiring end-to-end, so an argument-plumbing regression (wrong `state`/`crashAt`
  // forwarding at the composer call site) would be invisible.
  const workDir = tmpWorkDir('p2a-t09-i1-enabled');

  // Reuse the G2 offline doubles verbatim so the ONLY difference from G2 is the
  // targetedSubphase parameter itself. The plan gains ONE opposing framing: a T04
  // proposal must reference a plan-owned string, so without it the sub-phase would
  // (correctly) find no admissible proposal and this test would prove nothing.
  const plan = { ...G2_PLAN, opposingFramings: ['AI 编程工具 无法取代 程序员'] };
  const args = g2ComposeArgs(workDir);
  // gapId is derived from occurrenceId, and the composer mints a RANDOM occurrence
  // for a fresh work dir — so a proposal computed before the run could never match.
  // Pre-seeding a resumable checkpoint pins the occurrence, which is also the
  // production shape this test needs (it is a RESUME, not a fresh start).
  const occurrenceId = 'occurrence-i1';
  const seeded = makeState({
    workDir,
    topic: args.topic,
    mode: 'p1-cross-question-deep-research',
    percent: null,
    runtime: g2Runtime().runtimeId,
    occurrenceId,
    config: args.config ?? {},
  });
  seeded.stage = 'search';
  writeState(workDir, seeded);

  const diagnosed = sortGapsByGapId(diagnoseGaps({
    plan,
    executedQueryProvenance: [...plan.queryVariants],
    planHash: planHash(plan),
    occurrenceId,
    diagnosisRound: 0,
  }).records);
  const proposals = diagnosed.map((gap) => ({
    gapId: gap.gapId,
    planOwnedStringRef: { field: 'opposingFramings', index: 0 },
  }));
  assert.ok(proposals.length >= 1, 'precondition: the plan yields at least one diagnosable gap');

  const result = await composeP1Research({
    ...args,
    plan,
    targetedSubphase: {
      proposals,
      maxQueryBudget: 10,
      maxAttemptsPerGap: 2,
    },
  });
  assert.equal(result.ok, true, `compose (sub-phase enabled) failed: ${JSON.stringify(result)}`);

  const actions = JSON.parse(fs.readFileSync(path.join(workDir, ACTIONS_FILENAME), 'utf8'));
  assert.ok(actions.targetedActions.length >= 1, 'the enabled sub-phase authorized at least one action');
  assert.ok(
    actions.targetedActions.every((r) => r.status === ACTION_STATUS_RESOLVED
      || r.status === ACTION_STATUS_UNRESOLVED
      || r.status === ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET),
    'every composer-driven action reached a terminal conclusion',
  );

  // The checkpoint must carry the targeted binding — this is the F.5 trust root,
  // and the same key the composer now re-adopts on a resume.
  const checkpoint = JSON.parse(fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8'));
  const bindingKeys = Object.keys(checkpoint.hashes ?? {}).filter((k) => k.startsWith(TARGETED_BINDING_PREFIX));
  assert.equal(
    bindingKeys.length,
    actions.targetedActions.filter((r) => r.status !== ACTION_STATUS_FAILED_OPERATIONAL).length,
    'every committed action is anchored in the checkpoint',
  );
  for (const key of bindingKeys) {
    assert.match(checkpoint.hashes[key], /^[0-9a-f]{64}$/, `${key} is a canonical content hash`);
  }

  const resolution = JSON.parse(fs.readFileSync(path.join(workDir, RESOLUTION_FILENAME), 'utf8'));
  assert.ok(resolution.resolutions.length >= 1, 'a resolution was recorded through the composer');
});

test('F4 — a second complete run over the same work dir REUSEs (zero new retrieval, same pool)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);

  const first = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));
  const callsAfterFirst = fixture.adapter.__calls();
  const second = runTargetedSubphase({
    ...subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]),
    state: first.state,
  });

  assert.equal(fixture.adapter.__calls(), callsAfterFirst, 'a reuse must never repeat the paid retrieval');
  assert.equal(second.reusedActionIds.length, 1);
  assert.equal(second.executedActionIds.length, 0);
  assert.deepEqual(
    second.pool.candidates.map((c) => c.identity.questionId),
    first.pool.candidates.map((c) => c.identity.questionId),
    'the reused pool is identical',
  );
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

// ---------------------------------------------------------------------------
// G2. FULL-CHAIN default equivalence (REQUIRED_TESTS: 缺省等价性（全链路对照）)
// Two real composeP1Research runs over injected offline doubles — one with the
// parameter absent, one with `targetedSubphase: null` — must produce the identical
// canonical artifact set, and NEITHER may produce a targeted artifact.
// ---------------------------------------------------------------------------

const G2_PLAN = {
  schemaVersion: 1,
  queryVariants: ['AI 编程工具 取代 程序员', 'AI coding 工具 岗位影响'],
  aspects: ['岗位影响'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

const G2_TEXTS = { 100: ['回答一：总体上有效。', '回答二：小样本下有反例。'], 200: ['回答三：另一个问题下的经验。'] };

function g2SearchResult(providerId, questionIds) {
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: '2026-09-29T00:00:00.000Z',
    items: questionIds.map((questionId, i) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank: i + 1, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'fixture' } },
  };
}

function g2Seam() {
  return createProviderSeam({
    adapters: [
      { providerId: 'fixture-official', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET, retrieve: () => g2SearchResult('fixture-official', ['100', '200']) },
      { providerId: 'fixture-global', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET, retrieve: () => g2SearchResult('fixture-global', ['100', '200']) },
    ],
  });
}

function g2CaptureAdapter() {
  return {
    providerId: 'zhihu-session-capture',
    capability: 'capture',
    authClass: 'session',
    retrieve({ questionId, outDir }) {
      const dir = path.join(outDir, String(questionId));
      fs.mkdirSync(dir, { recursive: true });
      const texts = G2_TEXTS[String(questionId)] ?? [];
      fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify({
        questionId,
        questionTitle: `问题 ${questionId}`,
        answers: texts.map((content, i) => ({ id: `${questionId}-a-${i + 1}`, content, excerpt: content, author: `作者${questionId}`, voteupCount: 5 - i })),
      }, null, 2)}\n`);
      return {
        ok: true,
        provider_id: 'zhihu-session-capture',
        capability: 'capture',
        auth_class: 'session',
        retrieved_at: '2026-09-29T00:00:00.000Z',
        items: [{ identity: { kind: 'group', questionId: String(questionId) }, provenance: { route: 'fixture-capture', rank: 1, rankOrigin: 'fixture' }, facts: { capturedAnswerCount: texts.length } }],
        completeness: { status: 'complete', evidence: { basis: 'fixture_complete_pagination' } },
      };
    },
  };
}

function g2Runner() {
  return (name, args) => {
    if (name === 'zhihu-verify') {
      const doc = JSON.parse(fs.readFileSync(path.join(args[0], 'answers.json'), 'utf8'));
      return { status: 0, stdout: JSON.stringify({ valid: true, questionId: String(doc.questionId), capturedAnswerCount: doc.answers.length, reportedAnswerCount: doc.answers.length }) };
    }
    if (name === 'zhihu-handoff') {
      const dir = args[0];
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
      fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ questionId: String(doc.questionId), task: 'digest', sourceType: 'session-capture', generatedBy: 'fixture' }, null, 2)}\n`);
      return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') return { status: 0, stdout: JSON.stringify({ valid: true }) };
    throw new Error(`unexpected runner command: ${name}`);
  };
}

function g2EmbeddingProvider() {
  return { preflight: async () => ({ ok: true }), embed: async (texts) => ({ vectors: texts.map(() => mockVector768(7)) }) };
}

function g2Runtime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async ({ projection }) => {
      const tokens = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      return {
        main: [{ tokenRef: tokens[0], statement: '主流观点' }],
        minority: [{ tokenRef: tokens[tokens.length - 1], statement: '少数派观点' }],
        contradictory: [],
        expertEvidenceRichTokens: [tokens[0]],
      };
    },
    synthesize: async ({ claims }) => ({
      families: [{ aspect: '总体有效性', anchorClaimId: [...claims.map((c) => c.claimId)].sort()[0], members: claims.map((c) => ({ claimId: c.claimId, stance: 'ASSERTS' })) }],
      unresolvedClaimIds: [],
    }),
  };
}

/** Every file under workDir, work-relative, excluding the timestamped volatile ones. */
function artifactInventory(workDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      const rel = path.relative(workDir, abs);
      if (rel === 'orchestration-state.json' || rel === 'events.jsonl' || rel === '.p1-commit-staging' || rel.startsWith('.p1-commit-staging/')) continue;
      out.push(rel);
    }
  };
  walk(workDir);
  return out.sort();
}

function g2ComposeArgs(workDir) {
  return {
    topic: 'AI 编程工具会取代程序员吗',
    workDir,
    plan: G2_PLAN,
    runtime: g2Runtime(),
    seam: g2Seam(),
    captureAdapter: g2CaptureAdapter(),
    runner: g2Runner(),
    embeddingProvider: g2EmbeddingProvider(),
  };
}

test('G2 — a real full-chain run is byte-equivalent with the parameter absent vs explicitly null, and creates no targeted artifact', async () => {
  const dirAbsent = tmpWorkDir('p2a-t09-g2-absent');
  const dirNull = tmpWorkDir('p2a-t09-g2-null');

  const absent = await composeP1Research(g2ComposeArgs(dirAbsent));
  assert.equal(absent.ok, true, `compose (param absent) failed: ${JSON.stringify(absent)}`);

  const explicitNull = await composeP1Research({ ...g2ComposeArgs(dirNull), targetedSubphase: null });
  assert.equal(explicitNull.ok, true, `compose (param null) failed: ${JSON.stringify(explicitNull)}`);

  // identical canonical artifact inventory
  assert.deepEqual(artifactInventory(dirAbsent), artifactInventory(dirNull));

  // and NO targeted artifact / sub-phase directory in either
  for (const dir of [dirAbsent, dirNull]) {
    const inventory = artifactInventory(dir);
    assert.equal(
      inventory.some((rel) => rel.includes('targeted-requery')),
      false,
      `the default path must create no targeted artifact (${dir})`,
    );
  }
});
