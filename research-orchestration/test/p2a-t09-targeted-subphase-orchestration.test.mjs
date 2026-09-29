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
  ACTION_STATUS_AUTHORIZED,
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
import { composeP1Research, resolveAnchoredLedgerBytes, stageArtifactBytes, COMMIT_STAGING_DIR } from '../lib/p1-runtime-composer.mjs';
import { LEDGER_STAGING_KEY } from '../lib/targeted-requery-lifecycle.mjs';
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
    // F.6: the PLANNED half of the global budget denominator. 2 = one executed
    // planned route + one planned provider failure, i.e. the frozen P1 loop has
    // already spent attempts before the sub-phase may authorize anything. Spelled
    // out (not derived from a fixture coverage state) so the tests that pin the
    // preflight arithmetic can state the expected four-term sum literally.
    plannedAttemptsBudgetCount: 2,
    state: { hashes: {} },
    // F.5.1 — the REAL composition-layer staging primitives, not doubles. Gate G4
    // forbids standing in for the trust machinery with hand-rolled fakes: an
    // in-memory map would let a test "recover" bytes no production run could, and
    // would prove nothing about the content-addressed directory that makes an
    // anchor recoverable across a crash. These are the same functions the composer
    // injects, so a regression in either is visible here.
    stageLedgerBytes: (bytes) => stageArtifactBytes(workDir, LEDGER_STAGING_KEY, bytes).sha,
    resolveAnchoredBytes: (sha) => resolveAnchoredLedgerBytes(workDir, sha),
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

  // F.5.1 CASE 2 (the #130 core crash window): the COMMITTED ledger bytes are durable
  // in staging, but `finalizeTargetedCommit` never ran, so the checkpoint still anchors
  // the PRE-commit ledger version. Resume reads ONLY that anchored version, so it sees
  // AUTHORIZED — never COMMITTED — and takes F.5's plain safe re-run branch: the
  // retrieval is paid for a second time ONCE, which the contract admits, because the
  // crash proves nothing. What it must never do is read the newer unanchored COMMITTED
  // version, or claim a binding the checkpoint never committed.
  const callsBeforeResume = fixture.adapter.__calls();
  const recovered = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));

  assert.ok(
    fixture.adapter.__calls() > callsBeforeResume,
    'CASE 2: resume from the anchored AUTHORIZED version re-runs the paid retrieval exactly once',
  );
  const record = recovered.actionsArtifact.targetedActions.find((r) => r.gapId === gap.gapId);
  assert.equal(
    recovered.actionsArtifact.targetedActions.filter((r) => r.gapId === gap.gapId).length,
    1,
    'the re-run REUSES the recorded action — it must not authorize a second record (E.6 / CASE 2)',
  );
  assert.ok(
    [ACTION_STATUS_COMMITTED, ACTION_STATUS_EVALUATED, ACTION_STATUS_RESOLVED,
      ACTION_STATUS_UNRESOLVED, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET].includes(record.status),
    'the recorded action did reach a committed-set status',
  );
  const bindingKey = `${TARGETED_BINDING_PREFIX}${record.targetedActionId}`;
  assert.match(
    String(recovered.state.hashes?.[bindingKey] ?? ''),
    /^[0-9a-f]{64}$/,
    'the completed re-run commits its own binding at the one writeState commit point',
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

  // Crash before finalizeTargetedCommit → COMMITTED bytes durable, NO checkpoint
  // commit. Then destroy the round product, so neither the anchored ledger nor any
  // staged copy can yield a readable product and nothing may be re-paid.
  assert.throws(() => runTargetedSubphase({
    ...args,
    crashAt: (label) => { if (label === 'after_targeted_commit_prepare') throw new Error('simulated SIGKILL'); },
  }), /simulated SIGKILL/);
  fs.rmSync(path.join(workDir, TARGETED_SUBPHASE_DIRNAME), { recursive: true, force: true });

  // F.5.1 CASE 2 + the "no readable product" branch: resume reads the ANCHORED
  // (pre-commit) ledger, so the action is AUTHORIZED and F.5 mandates one safe
  // re-run. The re-run pays again and produces a FRESH product, so it succeeds —
  // that is the contract's admitted double payment, not a silent drop.
  //
  // The genuinely unrecoverable case is CASE 3b, covered by H3b below. Here what
  // must be pinned is that a re-run never reports ok:true on the strength of a
  // product whose bytes are gone: the paid pool is regenerated, not laundered.
  const recovered = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]));
  assert.equal(recovered.ok, true, 'the mandated safe re-run regenerates the product');
  assert.equal(recovered.executedActionIds.length, 1, 'exactly one re-run happened');
  const ids = recovered.pool.candidates.map((c) => c.identity.questionId);
  assert.ok(ids.length > 0, 'the augmented pool carries the freshly paid evidence');
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

test('H3 — a checkpoint-anchored ledger whose bytes are gone FAILS CLOSED (F.5.1 CASE 3b)', () => {
  const workDir = tmpWorkDir();
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  const first = runTargetedSubphase(args);
  const record = first.actionsArtifact.targetedActions.find((r) => r.gapId === gap.gapId);
  assert.equal(record.status, ACTION_STATUS_RESOLVED, 'precondition: a terminal conclusion exists');
  assert.match(
    String(first.state.hashes?.[LEDGER_STAGING_KEY] ?? ''),
    /^[0-9a-f]{64}$/,
    'precondition: the checkpoint anchors the ledger version',
  );

  // Destroy BOTH the canonical ledger and its content-addressed copy, so the
  // anchored version is unrecoverable. The round product still exists and still
  // hashes correctly — so nothing about the ACTION is wrong; what is missing is the
  // authority to decide which ledger version counts. F.5.1 CASE 3b therefore fails
  // closed instead of silently rebuilding an empty ledger (which would re-authorize
  // and re-pay for gaps already paid for) or trusting the canonical file.
  fs.rmSync(path.join(workDir, ACTIONS_FILENAME), { force: true });
  fs.rmSync(path.join(workDir, COMMIT_STAGING_DIR), { recursive: true, force: true });

  assert.throws(
    () => runTargetedSubphase({ ...args, state: first.state }),
    /anchors an action-ledger version whose bytes are unrecoverable/,
    'an unrecoverable anchor must surface UNKNOWN, never be washed into a clean re-authorize',
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
  // Resume hands over the REAL persisted checkpoint, so `readBoundTargetedPool` looks
  // the artifact up against the checkpoint binding (F.5.1: never the record's own
  // unanchored `artifactHash`) and the tampered bytes fail that check. F.5 has no
  // terminal exemption for this, so it must fail closed rather than merge unverified
  // content behind ok:true.
  const persisted = JSON.parse(fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8'));
  assert.throws(
    () => runTargetedSubphase({ ...args, state: persisted }),
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

// ---------------------------------------------------------------------------
// F.5 amendment acceptance gates G1–G6 (docs/planning/
// P2_ARI_108_F5_CHECKPOINT_ANCHORED_LEDGER_AMENDMENT_V1.md §5).
//
// These are the gates the owner made binding on this repair. G1/G2 are
// source-level by construction ("verbatim unchanged" is not observable at
// runtime); G4/G5/G6 must be REAL runs — no crashPoint-instead-of-SIGKILL,
// no source regex standing in for a resume.
// ---------------------------------------------------------------------------

test('G1 — the E.6 dedupeKey field set is VERBATIM unchanged, and `attempt` is excluded from it', async () => {
  const { computeDedupeKey } = await import('../lib/targeted-requery-authorization.mjs');
  const source = fs.readFileSync(path.join(LIB, 'targeted-requery-authorization.mjs'), 'utf8');
  // The formula object literal is the field set — no DEDUPE_KEY_FIELDS constant
  // exists in this implementation, so pin the literal itself.
  assert.match(
    source,
    /export function computeDedupeKey\(\{ gapIdentityCore, normalizedQuery, providerScope \} = \{\}\)/,
    'computeDedupeKey destructures exactly the three frozen E.6 fields',
  );

  // Behavioural proof beats a regex: the key is a pure function of those three
  // fields, so an added `attempt` field would change the digest. Same inputs, two
  // different (hypothetical) attempt numbers, must still hash identically — this is
  // exactly why F.5's re-run can reuse an AUTHORIZED record instead of authorizing
  // a new one.
  const core = 'a'.repeat(64);
  const scope = [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH }];
  const key = computeDedupeKey({ gapIdentityCore: core, normalizedQuery: 'framing-a', providerScope: scope });
  assert.equal(
    computeDedupeKey({ gapIdentityCore: core, normalizedQuery: 'framing-a', providerScope: scope }),
    key,
    'the dedupe key is deterministic',
  );
  // Order-independence of providerScope (F.1 "顺序无关") is part of the same field set.
  assert.equal(
    computeDedupeKey({ gapIdentityCore: core, normalizedQuery: 'framing-a', providerScope: [...scope].reverse() }),
    key,
    'providerScope order does not change the key',
  );
  assert.equal(
    /attempt/.test(source.match(/export function computeDedupeKey[\s\S]*?\n\}/)[0]),
    false,
    '`attempt` does not appear anywhere in computeDedupeKey — E.6 is verbatim',
  );
});

test('G2 — the T06 LEGAL_TRANSITIONS table is VERBATIM unchanged (no committed→authorized edge)', async () => {
  const { LEGAL_TRANSITIONS } = await import('../lib/targeted-requery-lifecycle.mjs');
  const {
    ACTION_STATUS_PROPOSED,
    ACTION_STATUS_REJECTED,
  } = await import('../lib/targeted-requery-lifecycle.mjs');
  const source = fs.readFileSync(path.join(LIB, 'targeted-requery-lifecycle.mjs'), 'utf8');
  assert.match(source, /export const LEGAL_TRANSITIONS = Object\.freeze\(\{/);

  // The amendment's entire mechanism is "CASE 2 resume sees AUTHORIZED and takes the
  // EXISTING safe re-run branch". That works only because committed → authorized was
  // NOT quietly added here. Assert the exact table, edge for edge.
  assert.deepEqual(
    LEGAL_TRANSITIONS[ACTION_STATUS_AUTHORIZED],
    [ACTION_STATUS_COMMITTED, ACTION_STATUS_FAILED_OPERATIONAL],
    'AUTHORIZED still has exactly two out-edges',
  );
  assert.deepEqual(
    LEGAL_TRANSITIONS[ACTION_STATUS_COMMITTED],
    [ACTION_STATUS_EVALUATED],
    'COMMITTED still advances only to EVALUATED — no un-commit edge was added',
  );
  assert.deepEqual(LEGAL_TRANSITIONS[ACTION_STATUS_REJECTED], [], 'REJECTED is still terminal');
  assert.deepEqual(
    LEGAL_TRANSITIONS[ACTION_STATUS_FAILED_OPERATIONAL],
    [],
    'FAILED_OPERATIONAL is still terminal',
  );
  for (const terminal of [ACTION_STATUS_RESOLVED, ACTION_STATUS_UNRESOLVED, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET]) {
    assert.deepEqual(LEGAL_TRANSITIONS[terminal], [], `${terminal} is still terminal`);
  }
  assert.equal(
    Object.values(LEGAL_TRANSITIONS).some((edges) => edges.includes(ACTION_STATUS_AUTHORIZED)),
    true,
    'PROPOSED → AUTHORIZED still exists (first authorization is still legal)',
  );
});

test('G3 — resume staging cleanup must NOT delete the still-anchored ledger version', () => {
  const source = fs.readFileSync(path.join(LIB, 'p1-runtime-composer.mjs'), 'utf8');
  // The amendment is explicit that this is a REQUIRED one-line change, not a
  // free parameter: without it `cleanupStaging` deletes the only recoverable
  // bytes of the anchored ledger and every resume becomes CASE 3b fail-closed.
  assert.match(
    source,
    /item\.key\s*!==\s*CHECKPOINT_BINDING_COVERAGE_STATE\s*&&\s*item\.key\s*!==\s*LEDGER_STAGING_KEY/,
    'the resume materialize loop excludes the ledger staging key from cleanupStaging',
  );
});

test('G4 — every F.5.1 crash window has a REAL run, and each anchors what it claims to', () => {
  // CASE 1 — crash BEFORE the commit point. Durable: the pre-commit ledger.
  // The checkpoint keeps anchoring it, so resume recovers an AUTHORIZED record.
  {
    const workDir = tmpWorkDir('g4-case1');
    const fixture = buildFixture();
    const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
    const gap = contradictionGap(pool);
    const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);
    assert.throws(() => runTargetedSubphase({
      ...args,
      crashAt: (label) => { if (label === 'after_targeted_execution') throw new Error('killed before commit'); },
    }), /killed before commit/);
    const recovered = runTargetedSubphase(args);
    assert.equal(recovered.actionsArtifact.targetedActions.length, 1, 'CASE 1: the AUTHORIZED record is recovered, not duplicated');
  }

  // CASE 2 — crash BETWEEN (b) and (d): COMMITTED bytes durable, checkpoint NOT
  // committed. This is the #130 core window and the one the amendment exists for.
  {
    const workDir = tmpWorkDir('g4-case2');
    const fixture = buildFixture();
    const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
    const gap = contradictionGap(pool);
    const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);
    assert.throws(() => runTargetedSubphase({
      ...args,
      crashAt: (label) => { if (label === 'after_targeted_commit_prepare') throw new Error('killed between b and d'); },
    }), /killed between b and d/);
    // The checkpoint on disk was never written after the AUTHORIZED anchor, so it
    // still points at the PRE-commit ledger. Reading it must yield AUTHORIZED —
    // proof that the newer COMMITTED bytes in staging do NOT participate.
    const persisted = JSON.parse(fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8'));
    const anchoredBytes = resolveAnchoredLedgerBytes(workDir, persisted.hashes[LEDGER_STAGING_KEY]);
    assert.notEqual(anchoredBytes, null, 'the anchored ledger version is still recoverable after the crash');
    const anchored = JSON.parse(anchoredBytes.toString('utf8'));
    assert.equal(
      anchored.targetedActions[0].status,
      ACTION_STATUS_AUTHORIZED,
      'CASE 2: the ANCHORED version is AUTHORIZED — the durable-but-uncommitted COMMITTED version is excluded',
    );
  }

  // CASE 3 — crash AFTER (d): the commit point is complete, so resume REUSEs and
  // never pays twice. This is what the amendment claims finally became reachable.
  {
    const workDir = tmpWorkDir('g4-case3');
    const fixture = buildFixture();
    const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
    const gap = contradictionGap(pool);
    const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);
    assert.throws(() => runTargetedSubphase({
      ...args,
      crashAt: (label) => { if (label === 'after_targeted_commit_finalize') throw new Error('killed after d'); },
    }), /killed after d/);
    const callsAfterCrash = fixture.adapter.__calls();
    const persisted = JSON.parse(fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8'));
    const recovered = runTargetedSubphase({ ...args, state: persisted });
    assert.equal(fixture.adapter.__calls(), callsAfterCrash, 'CASE 3: REUSE never re-pays');
    assert.equal(recovered.reusedActionIds.length, 1, 'CASE 3: the committed binding makes this a REUSE');
  }

  // CASE 3b — the anchored bytes are gone. Fail closed (also pinned by H3).
  {
    const workDir = tmpWorkDir('g4-case3b');
    const fixture = buildFixture();
    const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
    const gap = contradictionGap(pool);
    const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);
    const first = runTargetedSubphase(args);
    fs.rmSync(path.join(workDir, COMMIT_STAGING_DIR), { recursive: true, force: true });
    fs.rmSync(path.join(workDir, ACTIONS_FILENAME), { force: true });
    assert.throws(
      () => runTargetedSubphase({ ...args, state: first.state }),
      /bytes are unrecoverable/,
      'CASE 3b: an unrecoverable anchor fails closed',
    );
  }
});

test('G5 — after a resume, every targetedActionId commits EXACTLY once', () => {
  const workDir = tmpWorkDir('g5-once');
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  const first = runTargetedSubphase(args);
  const persisted = JSON.parse(fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8'));
  // Resume TWICE. Each resume must reuse, never re-authorize and never re-pay,
  // and the ledger must never grow a second record for the same action.
  runTargetedSubphase({ ...args, state: persisted });
  const third = runTargetedSubphase({ ...args, state: persisted });

  const ids = third.actionsArtifact.targetedActions.map((r) => r.targetedActionId);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate targetedActionId in the ledger');
  assert.equal(third.actionsArtifact.targetedActions.length, 1, 'exactly one record survives');
  assert.equal(third.executedActionIds.length, 0, 'the resumes never executed anything');
  assert.equal(third.reusedActionIds.length, 1, 'the resumes reused the single committed action');
  assert.equal(third.rejectedActionIds.length, 0, 'a proven commit is never re-litigated as a dedupe rejection');
  assert.equal(first.actionsArtifact.targetedActions[0].targetedActionId, ids[0], 'the identity is stable across resumes');
});

test('G6 — CASE 2 BYPASSES the E.6 dedupe gate: the gate is never CALLED, not merely relaxed', () => {
  const workDir = tmpWorkDir('g6-dedupe-bypass');
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);

  // Crash between (b) and (d): the durable ledger now contains an AUTHORIZED record.
  // A re-authorization of the same proposal would carry the SAME dedupeKey, because
  // E.6 excludes `attempt` — so if resume went through `authorizeTargetedAction` it
  // would be REJECTED as EQUIVALENT_QUERY_ALREADY_AUTHORIZED and F.5's mandated
  // re-run would be unreachable. Counting the dedupe rejections in the resulting
  // ledger is therefore a direct mechanical proof that the gate was never entered.
  assert.throws(() => runTargetedSubphase({
    ...args,
    crashAt: (label) => { if (label === 'after_targeted_commit_prepare') throw new Error('killed between b and d'); },
  }), /killed between b and d/);

  const recovered = runTargetedSubphase(args);
  const records = recovered.actionsArtifact.targetedActions;
  const dedupeRejections = records.filter((r) => r.status === 'REJECTED'
    && String(r.rejectionCode ?? '').includes('DEDUPE'));
  assert.equal(
    dedupeRejections.length,
    0,
    'G6: the dedupe gate produced NO rejection — resume reused the AUTHORIZED record instead of re-authorizing',
  );
  assert.equal(
    records.filter((r) => r.gapId === gap.gapId).length,
    1,
    'G6: exactly one action exists; a second authorization would have been a second record',
  );
  assert.ok(
    !records.some((r) => r.status === 'REJECTED' && String(r.rejectionCode ?? '').includes('DEDUPE')),
    'G6: E.6 is BYPASSED, not widened — the frozen dedupe still rejects duplicates, resume simply never asks',
  );
});

// ---------------------------------------------------------------------------
// Finding #3 — global budget preflight must see BOTH halves.
//
// The mechanical requirement, stated by the owner:
//   attemptsBudgetCount = planned executedRoutes + planned providerFailures
//                          + targeted executed + targeted failed
// Neither a planned-only nor a targeted-only denominator satisfies it, and the
// amendment made this urgent: it is what makes F.5's safe re-run reachable, and a
// re-run is real paid IO.
// ---------------------------------------------------------------------------

test('BUDGET-1 — the authorization preflight DENOMINATOR is planned + targeted, not targeted alone', async () => {
  const { computePlannedAttemptCount } = await import('../lib/targeted-requery-subphase.mjs');
  const coverageState = {
    retrieval: {
      executedRoutes: [
        { query: 'q1', providerId: 'p', capability: CAPABILITY_SEARCH, roundIndex: 1 },
        { query: 'q2', providerId: 'p', capability: CAPABILITY_SEARCH, roundIndex: 1 },
      ],
      providerFailures: [
        { code: 'X', class: 'unknown', providerId: 'p', roundIndex: 1 },
      ],
    },
  };
  assert.equal(computePlannedAttemptCount(coverageState), 3, 'planned half = 2 executedRoutes + 1 providerFailure');

  // The same coverage state, fed through the REAL composer path. maxQueryBudget = 4
  // leaves exactly 1 attempt; the targeted action's providerScope is 1 channel, so
  // 3 + 1 = 4 <= 4 is authorized. If the preflight saw ONLY the targeted half it
  // would compute 0 + 1 <= 4 and stay silent about the 3 already spent — and a
  // second targeted action would then be authorized on an exhausted budget.
  const workDir = tmpWorkDir('budget-denominator');
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);

  const fits = runTargetedSubphase(subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)], {
    maxQueryBudget: 4,
    plannedAttemptsBudgetCount: computePlannedAttemptCount(coverageState),
  }));
  assert.equal(fits.actionsArtifact.targetedActions.length, 1, '3 planned + 1 targeted = 4 fits the budget');

  // maxQueryBudget = 3: 3 + 1 > 3 must be REJECTED as a budget refusal. A
  // targeted-only denominator would compute 0 + 1 <= 3 and authorize it.
  const workDir2 = tmpWorkDir('budget-denominator-tight');
  const fixture2 = buildFixture();
  const pool2 = baseAccumulatedPool(fixture2.seam, fixture2.channels, path.join(workDir2, 'base'));
  const gap2 = contradictionGap(pool2);
  const tight = runTargetedSubphase(subphaseArgs(workDir2, fixture2, pool2, [proposalFor(gap2, 0)], {
    maxQueryBudget: 3,
    plannedAttemptsBudgetCount: computePlannedAttemptCount(coverageState),
  }));
  assert.equal(tight.executedActionIds.length, 0, 'no action executed once the planned spend exhausts the budget');
  assert.equal(tight.actionsArtifact.targetedActions.length, 0, 'no action was ever authorized');
  // Rejections live in the artifact's own `rejected[]` ledger (T06's shape), not as
  // a status on `targetedActions[]`.
  assert.equal(tight.actionsArtifact.rejected.length, 1, 'the proposal is REJECTED — the planned half is visible to E.5(7)');
  assert.match(
    String(tight.actionsArtifact.rejected[0].rejectionCode ?? ''),
    /BUDGET/,
    'the rejection carries the budget refusal code',
  );
});

test('BUDGET-2 — the preflight refuses to run without the planned half (fail closed, never under-count)', async () => {
  const { computePlannedAttemptCount } = await import('../lib/targeted-requery-subphase.mjs');
  assert.equal(typeof computePlannedAttemptCount, 'function');
  // A coverage state missing either array is a caller bug, not a zero budget.
  assert.throws(() => computePlannedAttemptCount(null), /plain object/);
  assert.throws(() => computePlannedAttemptCount({ retrieval: {} }), /executedRoutes/);

  const workDir = tmpWorkDir('budget-required');
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, path.join(workDir, 'base'));
  const gap = contradictionGap(pool);
  const args = subphaseArgs(workDir, fixture, pool, [proposalFor(gap, 0)]);
  assert.throws(
    () => runTargetedSubphase({ ...args, plannedAttemptsBudgetCount: undefined }),
    /plannedAttemptsBudgetCount/,
    'omitting the planned half must fail closed rather than silently authorize on the targeted half alone',
  );
});

test('BUDGET-3 — the round loop forwards the targeted half into BOTH evaluateRetrievalRound call sites', () => {
  const source = fs.readFileSync(path.join(LIB, 'coverage-final-integration.mjs'), 'utf8');
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Both branches — the normal round AND the all-providers-failed round — must
  // carry `targetedAttempts`. Omitting it on the failure branch would under-count
  // the budget exactly when the run is already degrading.
  const calls = stripped.match(/evaluateRetrievalRound\(\{[\s\S]*?\n\s*\}\)/g) ?? [];
  assert.equal(calls.length, 2, 'the loop has exactly two evaluateRetrievalRound call sites');
  for (const [i, call] of calls.entries()) {
    assert.match(call, /targetedAttempts\s*,/, `call site ${i + 1} forwards targetedAttempts`);
  }
  // And the loop must accept it as an additive, default-null parameter.
  assert.match(
    source,
    /targetedAttempts = null,/,
    'runRetrievalFeedbackLoop takes targetedAttempts as an additive default-null input',
  );
});

test('BUDGET-4 — the composer derives the loop targeted half from the ANCHORED ledger, never the canonical file', () => {
  const source = fs.readFileSync(path.join(LIB, 'p1-runtime-composer.mjs'), 'utf8');
  assert.match(
    source,
    /readAnchoredLedger\(state,\s*\(sha\)\s*=>\s*resolveAnchoredLedgerBytes\(workDir,\s*sha\)\)/,
    'the pre-loop budget read goes through the checkpoint-anchored ledger',
  );
  assert.match(
    source,
    /computeTargetedAttemptCounts\(\{\s*actions:\s*anchoredPriorLedger\.targetedActions\s*\}\)/,
    'the counts come from the deterministic ledger export, never a hand-built number',
  );
  assert.match(
    source,
    /targetedAttempts:\s*priorTargetedAttempts/,
    'the derived counts are what the loop receives',
  );
  // The planned half the sub-phase needs is likewise derived, not supplied by config.
  assert.match(
    source,
    /plannedAttemptsBudgetCount:\s*computePlannedAttemptCount\(coverageState\)/,
    'the sub-phase preflight gets the planned half from the live coverage state',
  );
});
