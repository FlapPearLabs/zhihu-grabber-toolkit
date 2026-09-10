/**
 * research-orchestration/test/p1-integration-harness.test.mjs
 *
 * Offline-deterministic tests for the P1 execution-workflow harness,
 * round 1 (PR #72 review repairs F1–F6) + round 2 (F8 canonical runtime
 * authority) + round 3 (F8b declaration-driven canonical suite authority —
 * env booleans are mechanically worthless; canonical acceptance requires the
 * project-declared runner's machine-readable PASS evidence):
 *   F1 exact-SHA freezing; F2 parallel-worker input model with a REAL
 *   temporary git repo (B -> worker-A / worker-B, sequential merges, drift
 *   refusals); F3 offline final != acceptance; F4 mode-aware dependency
 *   rules; F5 cwd-independent ledger path; F6 named negative-guard probe;
 *   F8 mode taxonomy + no-fallback env + extraction boundary; F8b runner
 *   resolution/execution/evidence contract.
 *
 * Pure logic + real temp git repos only — no network, no product semantics
 * changed, no live model.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
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
  writeLedger,
  acceptanceVerdictFor,
  wholeWaveEnvFor,
  resolveCanonicalRunner,
  validateCanonicalEvidence,
  runCanonicalRunner,
  defaultLedgerPath,
  negativeGuardProbe,
} from '../bin/integration-harness.mjs';
import { loadRuntimeAuthority, REPO_ROOT } from '../bin/runtime-authority.mjs';
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

describe('F3/F8 — acceptance verdict taxonomy (mechanical, in-ledger)', () => {
  test('offline final run is NOT acceptance-eligible', () => {
    const acc = acceptanceVerdictFor({ mode: 'offline' });
    assert.equal(acc.finalAcceptanceEligible, false);
    assert.equal(acc.acceptanceVerdict, 'OFFLINE_DRY_RUN_NOT_ACCEPTANCE');
    const l = buildLedger({ stage: 'FINAL', runtimeClass: 'OFFLINE_DRY_RUN', steps: [], ...acc });
    assert.equal(l.finalAcceptanceEligible, false);
    assert.equal(l.acceptanceVerdict, 'OFFLINE_DRY_RUN_NOT_ACCEPTANCE');
    assert.equal(l.runtimeClass, 'OFFLINE_DRY_RUN');
  });
  test('smoke is NEVER acceptance-eligible — even when every step passes (evidence cannot help it)', () => {
    const acc = acceptanceVerdictFor({ mode: 'smoke', canonicalEvidence: { ok: true, evidence: { schema: 'canonical-runner-evidence/1' } } });
    assert.equal(acc.finalAcceptanceEligible, false);
    assert.equal(acc.acceptanceVerdict, 'LOCAL_NONCANONICAL_SMOKE_NOT_ACCEPTANCE');
    const noEv = acceptanceVerdictFor({ mode: 'smoke' });
    assert.equal(noEv.finalAcceptanceEligible, false);
  });
  test('canonical eligibility requires VALIDATED runner evidence; anything else fails closed', () => {
    const ok = acceptanceVerdictFor({ mode: 'canonical', canonicalEvidence: { ok: true, code: 'CANONICAL_RUNNER_EVIDENCE_PASS', evidence: { schema: 'canonical-runner-evidence/1' } } });
    assert.equal(ok.finalAcceptanceEligible, true);
    assert.equal(ok.acceptanceVerdict, 'CANONICAL_ACCEPTANCE_PASS');
    for (const ev of [null, undefined, {}, { ok: false, code: 'CANONICAL_RUNNER_FAILED' }, { ok: false, code: 'CANONICAL_RUNNER_EVIDENCE_INVALID' }]) {
      const r = acceptanceVerdictFor({ mode: 'canonical', canonicalEvidence: ev });
      assert.equal(r.finalAcceptanceEligible, false);
      assert.equal(r.acceptanceVerdict, 'CANONICAL_ACCEPTANCE_NOT_PASSED');
    }
  });
  test('unknown mode throws', () => {
    assert.throws(() => acceptanceVerdictFor({ mode: 'yolo' }), /unknown execution mode/);
  });
  test('ledger carries the frozen reviewed sha fields + refusal policy', () => {
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
    assert.equal(l.schema, 'wf-execution-ledger/1');
    assert.match(l.masterUpdate, /REFUSED_BY_HARNESS/);
  });
});

/* ---------------------------------- F8 canonical runtime authority ---------------------------------- */

describe('F8 — canonical runtime authority (no fallback, extraction boundary)', () => {
  test('wholeWaveEnvFor(smoke) uses declared local env names; canonical carries ONLY the mode key', () => {
    const authority = loadRuntimeAuthority();
    const smoke = wholeWaveEnvFor({ mode: 'smoke', authority, env: {} });
    assert.equal(smoke[authority.env.realRuntime], '1');
    assert.equal(smoke[authority.localSmoke.baseUrlEnv], authority.localSmoke.baseUrlDefault);
    assert.equal(smoke[authority.localSmoke.modelEnv], authority.localSmoke.modelDefault);
    assert.ok(!(authority.env.runtimeMode in smoke));
    const canonical = wholeWaveEnvFor({ mode: 'canonical', authority, env: {} });
    assert.deepEqual(Object.keys(canonical), [authority.env.runtimeMode]);
    assert.equal(canonical[authority.env.runtimeMode], 'canonical');
    // no-fallback at env level: canonical overlay must not carry any local-smoke key
    for (const k of Object.keys(smoke)) assert.ok(!(k in canonical));
    assert.equal(wholeWaveEnvFor({ mode: 'offline', authority }), null);
  });
  test('loadRuntimeAuthority validates the declaration', () => {
    const a = loadRuntimeAuthority();
    assert.equal(a.canonical.runtimeId, 'deepseek-api-tool-less');
    assert.equal(a.canonical.model, 'deepseek-v4-pro');
    const bad = mkdtempSync(join(tmpdir(), 'p1-auth-'));
    writeFileSync(join(bad, 'runtime-authority.json'), JSON.stringify({ schema: 'runtime-authority/1', localSmoke: {} }));
    assert.throws(() => loadRuntimeAuthority(join(bad, 'runtime-authority.json')), /missing canonical/);
    rmSync(bad, { recursive: true, force: true });
  });
  test('EXTRACTION BOUNDARY: generic harness/preflight sources contain no vendor/project/ticket names', () => {
    const scan = /deepseek|lmstudio|qwen|zhihu|p1|t1[2-7]/i;
    for (const f of ['bin/integration-harness.mjs', 'bin/integration-preflight.mjs', 'bin/runtime-authority.mjs']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      assert.equal(scan.test(src), false, `extraction boundary violated in ${f}`);
    }
  });
});

/* ---------------------------------- F8b declaration-driven canonical suite authority ---------------------------------- */

describe('F8b — canonical suite authority is declaration-driven (env booleans are mechanically worthless)', () => {
  // Synthetic project-owned runner fixture (in real wiring this script is the
  // declared project gate that executes the canonical whole-wave and prints
  // machine-readable evidence; here it is parametrized through env keys).
  const RUNNER_OK = [
    "const ev = {",
    "  schema: 'canonical-runner-evidence/1',",
    "  verdict: process.env.EV_VERDICT ?? 'PASS',",
    "  runtimeId: process.env.EV_RUNTIME_ID,",
    "  model: process.env.EV_MODEL,",
    "  executionClass: process.env.EV_EXEC_CLASS ?? 'CANONICAL',",
    "  evidence: JSON.parse(process.env.EV_BLOCK ?? '{\"suite\":\"synthetic\",\"testsTotal\":3,\"testsFailed\":0}'),",
    "};",
    "console.log(JSON.stringify(ev));",
  ].join('\n');

  function mkRunner(dir, src = RUNNER_OK, file = 'runner.mjs', declare = true) {
    if (src !== null) writeFileSync(join(dir, file), src);
    const base = loadRuntimeAuthority();
    return { ...base, canonical: { ...base.canonical, runner: declare ? { file } : null } };
  }

  test('NO env boolean can authorize canonical acceptance (P1_CANONICAL_SUITE_READY=1 is mechanically worthless)', () => {
    // synthetic runner-less declaration: this contract must hold regardless of
    // the real declaration's wiring state (the real runner is wired by the P1
    // canonical-runner lane; a runner-less declaration still fails closed)
    const base = loadRuntimeAuthority();
    const authority = { ...base, canonical: { ...base.canonical, runner: null } };
    const hostileEnv = {
      P1_CANONICAL_SUITE_READY: '1',
      [authority.env.runtimeMode]: 'canonical',
      [authority.canonical.credentialEnv]: 'x'.repeat(8),
    };
    const resolved = resolveCanonicalRunner({ authority, repoRoot: '/definitely/not/a/repo', env: hostileEnv });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, 'CANONICAL_SUITE_NOT_WIRED');
    const run = runCanonicalRunner({ authority, repoRoot: '/definitely/not/a/repo', env: hostileEnv });
    assert.equal(run.ok, false);
    assert.equal(run.code, 'CANONICAL_SUITE_NOT_WIRED');
    const acc = acceptanceVerdictFor({ mode: 'canonical', canonicalEvidence: run });
    assert.equal(acc.finalAcceptanceEligible, false);
    assert.equal(acc.acceptanceVerdict, 'CANONICAL_ACCEPTANCE_NOT_PASSED');
  });

  test('missing canonical runner file -> CANONICAL_SUITE_NOT_WIRED (fail closed)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-f8b-'));
    const authority = mkRunner(dir, RUNNER_OK, 'absent-runner.mjs');
    rmSync(join(dir, 'absent-runner.mjs'), { force: true });
    const r = resolveCanonicalRunner({ authority, repoRoot: dir });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CANONICAL_SUITE_NOT_WIRED');
    rmSync(dir, { recursive: true, force: true });
  });

  test('canonical PASS requires machine-readable evidence from the declared project-owned runner (happy path)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-f8b-'));
    const authority = mkRunner(dir);
    const r = runCanonicalRunner({ authority, repoRoot: dir, env: { EV_RUNTIME_ID: authority.canonical.runtimeId, EV_MODEL: authority.canonical.model } });
    assert.equal(r.ok, true);
    assert.equal(r.evidence.schema, 'canonical-runner-evidence/1');
    assert.equal(r.evidence.runtimeId, authority.canonical.runtimeId);
    assert.equal(r.evidence.model, authority.canonical.model);
    assert.equal(r.evidence.executionClass, 'CANONICAL');
    const acc = acceptanceVerdictFor({ mode: 'canonical', canonicalEvidence: r });
    assert.equal(acc.finalAcceptanceEligible, true);
    assert.equal(acc.acceptanceVerdict, 'CANONICAL_ACCEPTANCE_PASS');
    rmSync(dir, { recursive: true, force: true });
  });

  test('runner failure / non-JSON stdout fail closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-f8b-'));
    let authority = mkRunner(dir, 'process.exit(3);', 'failing.mjs');
    let r = runCanonicalRunner({ authority, repoRoot: dir, env: {} });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CANONICAL_RUNNER_FAILED');
    authority = mkRunner(dir, 'console.log("not json at all");', 'garbage.mjs');
    r = runCanonicalRunner({ authority, repoRoot: dir, env: {} });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CANONICAL_RUNNER_EVIDENCE_INVALID');
    rmSync(dir, { recursive: true, force: true });
  });

  test('smoke/offline execution evidence can NEVER satisfy canonical acceptance; identity mismatch rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-f8b-'));
    const authority = mkRunner(dir);
    const base = { EV_RUNTIME_ID: authority.canonical.runtimeId, EV_MODEL: authority.canonical.model };
    for (const cls of ['SMOKE', 'OFFLINE_DRY_RUN', 'LOCAL_NONCANONICAL_SMOKE']) {
      const r = runCanonicalRunner({ authority, repoRoot: dir, env: { ...base, EV_EXEC_CLASS: cls } });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'CANONICAL_RUNNER_EVIDENCE_INVALID');
      assert.match(r.detail, /smoke\/offline/);
    }
    let r = runCanonicalRunner({ authority, repoRoot: dir, env: { ...base, EV_RUNTIME_ID: 'some-smoke-runtime' } });
    assert.equal(r.code, 'CANONICAL_RUNNER_EVIDENCE_INVALID');
    assert.match(r.detail, /runtimeId mismatch/);
    r = runCanonicalRunner({ authority, repoRoot: dir, env: { ...base, EV_MODEL: 'some-smoke-model' } });
    assert.equal(r.code, 'CANONICAL_RUNNER_EVIDENCE_INVALID');
    assert.match(r.detail, /model mismatch/);
    // empty evidence block = no disclosure of actual execution -> rejected
    r = runCanonicalRunner({ authority, repoRoot: dir, env: { ...base, EV_BLOCK: '{}' } });
    assert.equal(r.code, 'CANONICAL_RUNNER_EVIDENCE_INVALID');
    assert.match(r.detail, /evidence block missing or empty/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('P1 canonical runner wiring: declaration resolves the declared project runner (deliberate flip of the proving-ground NOT_WIRED pin)', () => {
    const authority = loadRuntimeAuthority();
    assert.equal(typeof authority.canonical.runner?.file, 'string');
    const r = resolveCanonicalRunner({ authority, repoRoot: REPO_ROOT });
    assert.equal(r.ok, true);
    assert.equal(r.code, 'CANONICAL_RUNNER_RESOLVED');
    assert.equal(r.file, pathResolve(REPO_ROOT, authority.canonical.runner.file));
    assert.ok(Array.isArray(r.args));
  });
});

/* ---------------------------------- F4 mode-aware dependency rules ---------------------------------- */

describe('F4 — preflight matches the execution mode', () => {
  test('smoke/canonical: missing node_modules / embedding dep = FAIL (not WARN)', () => {
    for (const mode of ['smoke', 'canonical']) {
      assert.equal(checkDependencies(mode, false, false).code, 'DEPS_NODE_MODULES_MISSING');
      assert.equal(checkDependencies(mode, false, false).status, 'FAIL');
      assert.equal(checkDependencies(mode, true, false).code, 'DEPS_EMBEDDING_MISSING');
      assert.equal(checkDependencies(mode, true, false).status, 'FAIL');
      assert.equal(checkDependencies(mode, true, true).status, 'PASS');
    }
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
    const written = writeLedger(buildLedger({ stage: 'FINAL', steps: [] }), p, dir);
    assert.equal(written, p);
    rmSync(dir, { recursive: true, force: true });
  });
});

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
