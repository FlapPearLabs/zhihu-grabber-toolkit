/**
 * research-orchestration/test/p1-integration-harness.test.mjs
 *
 * Offline-deterministic tests for the P1 execution-workflow harness,
 * round 1 (PR #72 review repairs F1–F6, 2026-09-06):
 *   F1 exact-SHA freezing; F2 parallel-worker input model with a REAL
 *   temporary git repo (B -> worker-A / worker-B, sequential merges, drift
 *   refusals); F3 offline final != acceptance; F4 mode-aware dependency
 *   rules; F5 cwd-independent ledger path; F6 named negative-guard probe.
 *
 * Pure logic + real temp git repos only — no network, no product semantics
 * changed, no live model.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  makeGit,
  resolveFrozenWorkerSha,
  verifyIntermediateInputs,
  runIntermediateMerge,
  runIntermediateStage,
  buildTierPlan,
  verifyIdentityChain,
  buildLedger,
  acceptanceVerdictFor,
  defaultLedgerPath,
  negativeGuardProbe,
} from '../bin/p1-integration-harness.mjs';
import {
  classifyPreflight,
  checkContextCapacity,
  checkDependencies,
  checkLocalArtifacts,
} from '../bin/integration-preflight.mjs';

const ID = 'sha256:' + 'a'.repeat(64);

/* ---------------------------------- F2/F1 temp-git scaffolding ---------------------------------- */

function initTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'p1-f2-'));
  const git = makeGit(dir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  git('config', 'user.name', 'FlapPearLabs');
  git('config', 'user.email', '151931662+FlapPearLabs@users.noreply.github.com');
  writeFileSync(join(dir, 'base.txt'), 'B\n');
  git('add', '.');
  git('commit', '-m', 'B: common base');
  const B = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'worker-a');
  writeFileSync(join(dir, 'a.txt'), 'A\n');
  git('add', '.');
  git('commit', '-m', 'A: worker-A change');
  const A = git('rev-parse', 'HEAD');
  git('checkout', 'main');
  git('checkout', '-b', 'worker-b');
  writeFileSync(join(dir, 'c.txt'), 'C\n');
  git('add', '.');
  git('commit', '-m', 'C: worker-B change');
  const C = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'integration', B);
  return { dir, git, B, A, C };
}

describe('F1 — exact-SHA freezing', () => {
  test('exact 40-hex sha accepted verbatim', () => {
    const { git, A } = initTempRepo();
    assert.equal(resolveFrozenWorkerSha(git, A), A);
    rmSync(git.cwd, { recursive: true, force: true });
  });
  test('branch ref resolved ONCE and frozen to the full commit sha', () => {
    const { git, A } = initTempRepo();
    assert.equal(resolveFrozenWorkerSha(git, 'worker-a'), A);
    rmSync(git.cwd, { recursive: true, force: true });
  });
  test('unknown ref refuses', () => {
    const { git } = initTempRepo();
    assert.throws(() => resolveFrozenWorkerSha(git, 'does-not-exist'), /rev-parse|unknown|Failed/);
    rmSync(git.cwd, { recursive: true, force: true });
  });
});

describe('F2 — parallel-worker integration (REAL temp git: B -> worker-A / worker-B)', () => {
  test('sequential merges of two siblings succeed; reviewed SHAs stay exact ancestors; no rewrite', () => {
    const { dir, git, B, A, C } = initTempRepo();
    const r1 = runIntermediateStage({ git, expectedIntegrationHead: B, workerReviewBase: B, worker: A, ticket: 'p1-t12' });
    assert.ok(/^[0-9a-f]{40}$/.test(r1.mergeCommit));
    const head1 = r1.mergeCommit;
    // worker-A's reviewed commit unchanged (no rebase/re-form)
    assert.equal(git('rev-parse', 'worker-a^{commit}'), A);

    const r2 = runIntermediateStage({ git, expectedIntegrationHead: head1, workerReviewBase: B, worker: C, ticket: 'p1-t13' });
    const head2 = r2.mergeCommit;
    // both reviewed commits remain exact ancestors; reviewed SHAs byte-unchanged
    assert.equal(git('rev-parse', 'worker-b^{commit}'), C);
    assert.equal(git('rev-parse', 'worker-a^{commit}'), A);
    assert.equal(git('merge-base', 'HEAD', A), A);
    assert.equal(git('merge-base', 'HEAD', C), C);
    assert.equal(git('merge-base', 'HEAD', B), B);
    assert.notEqual(head2, head1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('stale EXPECTED_INTEGRATION_HEAD refuses (MASTER_DRIFT semantics)', () => {
    const { dir, git, B, A } = initTempRepo();
    runIntermediateStage({ git, expectedIntegrationHead: B, workerReviewBase: B, worker: A, ticket: 'p1-t12' });
    // replaying with the stale head must refuse
    assert.throws(() => runIntermediateStage({ git, expectedIntegrationHead: B, workerReviewBase: B, worker: A, ticket: 'p1-t12' }), /F2_INPUT_REFUSED.*EXPECTED_INTEGRATION_HEAD/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('worker-review-base not an ancestor of the reviewed sha refuses', () => {
    const { dir, git, B, A, C } = initTempRepo();
    // A is NOT an ancestor of C (siblings) — using it as review base must refuse
    assert.throws(() => runIntermediateStage({ git, expectedIntegrationHead: B, workerReviewBase: A, worker: C, ticket: 'p1-t13' }), /F2_INPUT_REFUSED.*ancestor/);
    void B;
    rmSync(dir, { recursive: true, force: true });
  });

  test('verifyIntermediateInputs reports all three failure classes', () => {
    const { dir, git, B, A, C } = initTempRepo();
    runIntermediateStage({ git, expectedIntegrationHead: B, workerReviewBase: B, worker: A, ticket: 'p1-t12' });
    const head1 = git('rev-parse', 'HEAD');
    const v = verifyIntermediateInputs(git, { expectedIntegrationHead: B, workerReviewBase: A, workerReviewedSha: C });
    assert.equal(v.ok, false);
    assert.ok(v.failures.some((f) => f.includes('EXPECTED_INTEGRATION_HEAD')));
    assert.ok(v.failures.some((f) => f.includes('ancestor')));
    void head1;
    rmSync(dir, { recursive: true, force: true });
  });

  test('runIntermediateMerge keeps exact ancestry after --no-ff', () => {
    const { dir, git, B, A } = initTempRepo();
    const head = runIntermediateMerge(git, { workerReviewedSha: A, ticket: 'p1-t12' });
    assert.equal(git('merge-base', 'HEAD', A), A);
    assert.equal(git('merge-base', 'HEAD', B), B);
    rmSync(dir, { recursive: true, force: true });
  });
});

/* ---------------------------------- F3 offline final != acceptance ---------------------------------- */

describe('F3 — FINAL_DRY_RUN != FINAL_ACCEPTANCE (mechanical, in-ledger)', () => {
  test('offline final run is NOT acceptance-eligible', () => {
    const acc = acceptanceVerdictFor({ liveRequested: false, liveStepOutcome: 'NOT_RUN' });
    assert.equal(acc.finalAcceptanceEligible, false);
    assert.equal(acc.acceptanceVerdict, 'OFFLINE_DRY_RUN_NOT_ACCEPTANCE');
    const l = buildLedger({ stage: 'FINAL', steps: [], ...acc });
    assert.equal(l.finalAcceptanceEligible, false);
    assert.equal(l.acceptanceVerdict, 'OFFLINE_DRY_RUN_NOT_ACCEPTANCE');
  });
  test('live whole-wave PASS is the only acceptance-eligible path', () => {
    const ok = acceptanceVerdictFor({ liveRequested: true, liveStepOutcome: 'PASS' });
    assert.equal(ok.finalAcceptanceEligible, true);
    assert.equal(ok.acceptanceVerdict, 'ELIGIBLE_LIVE_WAVE_PASS');
    const bad = acceptanceVerdictFor({ liveRequested: true, liveStepOutcome: 'FAIL: x' });
    assert.equal(bad.finalAcceptanceEligible, false);
    assert.equal(bad.acceptanceVerdict, 'LIVE_REQUESTED_BUT_NOT_PASSED');
  });
  test('ledger carries the frozen reviewed sha fields', () => {
    const l = buildLedger({
      stage: 'INTERMEDIATE',
      expectedIntegrationHead: 'h'.repeat(40),
      workerReviewBase: 'b'.repeat(40),
      workerReviewedSha: 'w'.repeat(40),
      mergeCommit: 'm'.repeat(40),
      steps: [],
    });
    assert.equal(l.workerReviewedSha, 'w'.repeat(40));
    assert.equal(l.expectedIntegrationHead, 'h'.repeat(40));
    assert.equal(l.workerReviewBase, 'b'.repeat(40));
    assert.match(l.masterUpdate, /REFUSED_BY_HARNESS/);
  });
});

/* ---------------------------------- F4 mode-aware dependency rules ---------------------------------- */

describe('F4 — preflight matches the execution mode', () => {
  test('live: missing node_modules / transformers = FAIL (not WARN)', () => {
    assert.equal(checkDependencies('live', false, false).code, 'DEPS_NODE_MODULES_MISSING');
    assert.equal(checkDependencies('live', false, false).status, 'FAIL');
    assert.equal(checkDependencies('live', true, false).code, 'DEPS_TRANSFORMERS_MISSING');
    assert.equal(checkDependencies('live', true, false).status, 'FAIL');
    assert.equal(checkDependencies('live', true, true).status, 'PASS');
  });
  test('offline: dependency check intentionally not applied (returns null — documented non-check)', () => {
    assert.equal(checkDependencies('offline', false, false), null);
  });
  test('offline classification contains no runtime requirement', () => {
    const v = classifyPreflight([{ check: 'mode', status: 'PASS', detail: 'offline mode' }]);
    assert.equal(v.verdict, 'PREFLIGHT_PASS');
  });
  test('8192-context incident fixture stays pinned (live mode)', () => {
    const r = checkContextCapacity('qwen/qwen3-1.7b', 8192, 32768);
    assert.equal(r.status, 'FAIL');
    assert.equal(r.code, 'RUNTIME_CONTEXT_INSUFFICIENT');
    assert.equal(classifyPreflight([r]).verdict, 'PREFLIGHT_FAIL');
  });
  test('capacity unverifiable fails closed', () => {
    const r = checkContextCapacity('m', Number.NaN, 32768);
    assert.equal(r.code, 'RUNTIME_CAPACITY_UNVERIFIABLE');
  });
  test('missing local artifacts list exact paths', () => {
    const r = checkLocalArtifacts([
      { path: '/x/seam-b-real.json', exists: true },
      { path: '/x/seam-d-real.json', exists: false },
    ]);
    assert.equal(r.status, 'FAIL');
    assert.match(r.detail, /seam-d-real\.json/);
  });
});

/* ---------------------------------- F5 cwd-independent ledger path ---------------------------------- */

describe('F5 — ledger default path is repository-root-relative (cwd must not matter)', () => {
  test('path identical before/after chdir', () => {
    const fakeRoot = '/fake/repo-root';
    const before = defaultLedgerPath(fakeRoot);
    const prevCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      const after = defaultLedgerPath(fakeRoot);
      assert.equal(after, before);
    } finally {
      process.chdir(prevCwd);
    }
    assert.equal(before, join(fakeRoot, 'work', 'p1-wave-latest', 'execution-ledger.json'));
  });
  test('explicit absolute path wins over default', () => {
    const p = '/tmp/whatever/ledger.json';
    const dir = mkdtempSync(join(tmpdir(), 'p1-f5-'));
    const written = require_writeLedger(p, dir);
    assert.equal(written, p);
    rmSync(dir, { recursive: true, force: true });
  });
});

/** helper: call the (non-exported-in-ESM-friendly) writeLedger via import — wrapper for hermetic test */
import { writeLedger } from '../bin/p1-integration-harness.mjs';
function require_writeLedger(p, repoRoot) {
  return writeLedger(buildLedger({ stage: 'FINAL', steps: [] }), p, repoRoot);
}

/* ---------------------------------- F6 executable evidence matches the docs ---------------------------------- */

describe('F6 — identity-chain positive + named negative-guard probe (real product guard module)', () => {
  function fixtureDir({ tamperMapped = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'p1-f6-'));
    mkdirSync(dir, { recursive: true });
    const mapped = tamperMapped ? 'sha256:' + 'b'.repeat(64) : ID;
    writeFileSync(join(dir, 'seam-b-real.json'), JSON.stringify({ selectedCorpusIdentity: ID, planHash: 'p'.repeat(64) }));
    writeFileSync(join(dir, 'seam-c-real.json'), JSON.stringify({
      selectedCorpusIdentityRef: ID,
      aggregateAnalyzedIdentity: { mappedAnalyzedSourceSetIdentity: mapped },
      planHash: 'p'.repeat(64),
    }));
    writeFileSync(join(dir, 'seam-d-real.json'), JSON.stringify({
      preSynthesisGuard: { guardResult: 'PASS', selectedVerifiedSourceSetIdentity: ID, mappedAnalyzedSourceSetIdentity: mapped },
      planHash: 'p'.repeat(64),
    }));
    return dir;
  }
  test('positive chain passes on consistent artifacts', () => {
    const dir = fixtureDir();
    const r = verifyIdentityChain({ seamB: join(dir, 'seam-b-real.json'), seamC: join(dir, 'seam-c-real.json'), seamD: join(dir, 'seam-d-real.json') });
    assert.equal(r.pass, true);
    rmSync(dir, { recursive: true, force: true });
  });
  test('named negative-guard probe: tampered identity -> FAIL_CLOSED (SEAM_C_GUARD_MISMATCH)', async () => {
    const dir = fixtureDir({ tamperMapped: true });
    const artifact = JSON.parse(readFileSync(join(dir, 'seam-c-real.json'), 'utf8'));
    const probe = await negativeGuardProbe({ artifact });
    assert.equal(probe.pass, true, probe.detail);
    assert.match(probe.detail, /FAIL_CLOSED/);
    rmSync(dir, { recursive: true, force: true });
  });
  test('identity-chain detects drift (guard/echo/planHash)', () => {
    const dir = fixtureDir({ tamperMapped: true });
    const r = verifyIdentityChain({ seamB: join(dir, 'seam-b-real.json'), seamC: join(dir, 'seam-c-real.json'), seamD: join(dir, 'seam-d-real.json') });
    assert.equal(r.pass, false);
    assert.ok(r.failures.some((f) => f.includes('echo broken')), r.failures.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });
});

/* ---------------------------------- tier plan ---------------------------------- */

describe('tier plan (intermediate stages run NO full suite)', () => {
  test('focused + affected gate only', () => {
    const p = buildTierPlan({ focus: 'test/p1-t13-group-representation-claims.test.mjs', gate: 'test/p1-seam-c-real-conformance.test.mjs' });
    assert.equal(p.tier, 'INTERMEDIATE');
    assert.equal(p.fullSuite, false);
    assert.deepEqual(p.files, ['test/p1-t13-group-representation-claims.test.mjs', 'test/p1-seam-c-real-conformance.test.mjs']);
  });
});
