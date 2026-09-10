/**
 * research-orchestration/test/p1-canonical-runner.test.mjs
 *
 * Offline-deterministic contract tests for the PROJECT-OWNED canonical runner
 * (F8b wiring): the runner is declared by bin/runtime-authority.json
 * (canonical.runner) and executed by the generic harness (runCanonicalRunner).
 * Contract pinned here:
 *   - the declaration resolves a real runner file through the EXISTING harness
 *     resolver (deliberate flip of the proving-ground NOT_WIRED pin, see
 *     p1-integration-harness.test.mjs);
 *   - the runner refuses to execute outside the canonical mode overlay
 *     (P1_RUNTIME_MODE=canonical, name from the declaration);
 *   - the runner fails closed on missing canonical credential with the
 *     EXISTING preflight machine code (CANONICAL_CREDENTIAL_MISSING,
 *     presence-only) BEFORE any spawn — even when a successful spawn is
 *     available ("everything else present" must not matter);
 *   - the runner executes the ACTUAL canonical P1 path (bin/research-p1.mjs) with
 *     the runtime resolved from the declaration (never hardcoded), always
 *     --restart (no silent checkpoint reuse), and on success emits exactly one
 *     canonical-runner-evidence/1 PASS object bound to the DECLARED
 *     runtimeId/model + the executed run identity (runId/topic/mode/percent/
 *     runtime) + the result artifact identity (sha256) — validated through the
 *     EXISTING harness validator (validateCanonicalEvidence);
 *   - a completed-looking run whose state carries a nondeclared runtime is
 *     refused (no fallback, no evidence); research failure and unbindable
 *     artifacts fail closed; evidence binding is load-bearing (tamper is
 *     rejected by the real validator).
 *
 * NO network, NO live model, NO real research execution: the research spawn is
 * injected (same pattern as harness runCanonicalRunner spawnImpl); the CLI
 * refusal spawns are fully env-controlled and deterministic (their gates fire
 * before any execution). Live canonical execution + evidence emission remains
 * T16's job.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCanonicalGate } from '../bin/canonical-runner.mjs';
import { loadRuntimeAuthority, REPO_ROOT } from '../bin/runtime-authority.mjs';
import { resolveCanonicalRunner, validateCanonicalEvidence } from '../bin/integration-harness.mjs';

const RUNNER_REL = 'research-orchestration/bin/canonical-runner.mjs';

/**
 * Real declaration with a DETERMINISTIC credential binding (an env name no
 * operator machine sets + a credential file that does not exist inside the
 * test repoRoot) — credential presence/absence is fully test-controlled.
 */
function testAuthority() {
  const base = loadRuntimeAuthority();
  return {
    ...base,
    canonical: { ...base.canonical, credentialEnv: 'ZCODE_TEST_CANONICAL_CREDENTIAL', credentialFile: 'no-such-credential-file-xyz' },
  };
}

function canonicalEnv(authority, extra = {}) {
  return { [authority.env.runtimeMode]: 'canonical', [authority.canonical.credentialEnv]: 'present', ...extra };
}

/**
 * Fixture: simulates what the REAL research run writes — the injected spawn
 * invokes write() exactly where the real research entrypoint would persist its
 * artifacts (the runner itself removes any stale result before the run, so
 * artifacts must come from the simulated run, not be pre-written).
 */
function runArtifacts(dir, authority, { runtime, topic = 'canonical runner wiring probe' } = {}) {
  const workDir = join(dir, 'work', 'canonical-research');
  const write = () => {
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'orchestration-state.json'), JSON.stringify({
      schemaVersion: 7,
      runId: 'r'.repeat(64),
      topic,
      mode: 'top-percent',
      percent: 20,
      runtime: runtime ?? authority.canonical.runtimeId,
    }, null, 2));
    writeFileSync(join(workDir, 'research-result.json'), `${JSON.stringify({
      schemaVersion: 1,
      topic,
      runtime: runtime ?? authority.canonical.runtimeId,
      selectedQuestion: { url: 'https://example.com/question/123', title: 'probe' },
      verification: { valid: true, capturedAnswerCount: 3 },
    }, null, 2)}\n`);
  };
  return { workDir, write };
}

const spawnedResearch = (calls, write) => (file, args, opts) => {
  if (calls) calls.push({ file, args, opts });
  if (write) write();
  return { status: 0, stdout: 'research result json (captured to log)', stderr: '' };
};

describe('F8b wiring — declaration resolves the project canonical runner', () => {
  test('declared runner file resolves through the EXISTING harness resolver and exists on disk', () => {
    const authority = loadRuntimeAuthority();
    assert.equal(typeof authority.canonical.runner?.file, 'string');
    const r = resolveCanonicalRunner({ authority, repoRoot: REPO_ROOT });
    assert.equal(r.ok, true);
    assert.equal(r.code, 'CANONICAL_RUNNER_RESOLVED');
    assert.equal(r.file, pathResolve(REPO_ROOT, authority.canonical.runner.file));
    assert.ok(Array.isArray(r.args));
  });

  test('CLI refuses without a research topic (machine-readable usage failure, exit 2)', () => {
    const r = spawnSync(process.execPath, [pathResolve(REPO_ROOT, RUNNER_REL)], {
      cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env },
    });
    assert.equal(r.status, 2);
    const out = JSON.parse(r.stdout);
    assert.equal(out.verdict, 'FAILED');
    assert.equal(out.code, 'CANONICAL_RUNNER_USAGE');
  });

  test('CLI REFUSES to execute outside the canonical mode overlay (env-controlled, deterministic, before any execution)', () => {
    const authority = loadRuntimeAuthority();
    for (const mode of ['smoke', 'offline']) {
      const r = spawnSync(process.execPath, [pathResolve(REPO_ROOT, RUNNER_REL), 'some topic'], {
        cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, [authority.env.runtimeMode]: mode },
      });
      assert.equal(r.status, 1, `mode=${mode}`);
      const out = JSON.parse(r.stdout);
      assert.equal(out.code, 'CANONICAL_RUNNER_MODE_REFUSED', `mode=${mode}`);
      assert.equal(out.verdict, 'FAILED', `mode=${mode}`);
    }
  });
});

describe('F8b wiring — fail-closed gates (core, injected env/spawn)', () => {
  test('mode gate: unset / smoke / offline overlay refuses with CANONICAL_RUNNER_MODE_REFUSED', () => {
    const authority = testAuthority();
    const cases = [{}, { [authority.env.runtimeMode]: 'smoke' }, { [authority.env.runtimeMode]: 'offline' }];
    for (const env of cases) {
      const r = runCanonicalGate({ authority, env, repoRoot: tmpdir(), argv: ['some topic'] });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'CANONICAL_RUNNER_MODE_REFUSED');
    }
  });

  test('COUNTEREXAMPLE: canonical mode without credential fails closed with the preflight code, BEFORE any spawn — even when a successful spawn is available', () => {
    const authority = testAuthority(); // deterministic env-only credential name
    let spawnCalls = 0;
    const dir = mkdtempSync(join(tmpdir(), 'p1-runner-cred-'));
    const r = runCanonicalGate({
      authority,
      env: { [authority.env.runtimeMode]: 'canonical' }, // credential env var ABSENT; credential file absent in dir
      repoRoot: dir,
      argv: ['some topic'],
      spawnImpl: () => { spawnCalls += 1; return { status: 0, stdout: '', stderr: '' }; },
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CANONICAL_CREDENTIAL_MISSING');
    assert.ok(r.detail.includes(authority.canonical.credentialEnv));
    assert.equal(spawnCalls, 0); // refusal must not depend on what the spawn could have done
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('F8b wiring — canonical execution boundary + evidence contract (offline, injected spawn)', () => {
  test('happy path: research entrypoint executed with DECLARED runtime + --restart; evidence validates through the EXISTING canonical-runner-evidence/1 validator and binds run + artifact identity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-runner-ok-'));
    const authority = testAuthority();
    const { workDir, write } = runArtifacts(dir, authority);
    const calls = [];
    const r = runCanonicalGate({
      authority, env: canonicalEnv(authority), repoRoot: dir, argv: ['canonical runner wiring probe'], spawnImpl: spawnedResearch(calls, write),
    });
    assert.equal(r.ok, true, JSON.stringify(r.detail ?? null));

    // spawn boundary: the ACTUAL canonical P1 path, runtime resolved from the declaration
    assert.equal(calls.length, 1);
    const { file, args, opts } = calls[0];
    assert.equal(file, process.execPath); // no nodeBin override in env -> process.execPath (same rule as the harness)
    assert.equal(args[0], pathResolve(dir, 'research-orchestration', 'bin', 'research-p1.mjs'));
    assert.ok(args.includes('--json'));
    assert.ok(args.includes('--restart')); // never ride on a prior (possibly noncanonical) checkpoint
    const rt = args.indexOf('--runtime');
    assert.ok(rt !== -1);
    assert.equal(args[rt + 1], authority.canonical.runtimeId); // read from the declaration, not hardcoded
    const wk = args.indexOf('--work');
    assert.equal(args[wk + 1], workDir);
    assert.equal(args[args.length - 1], 'canonical runner wiring probe');
    assert.equal(opts.env[authority.env.runtimeMode], 'canonical'); // overlay forwarded
    assert.equal(opts.env[authority.canonical.credentialEnv], 'present'); // credential env forwarded (research needs it; values never logged)

    // evidence: accepted by the REAL validator with the REAL declaration
    const realAuthority = loadRuntimeAuthority();
    const v = validateCanonicalEvidence(JSON.stringify(r.evidence), realAuthority);
    assert.equal(v.ok, true, JSON.stringify(v.detail ?? null));
    assert.equal(v.evidence.schema, 'canonical-runner-evidence/1');
    assert.equal(v.evidence.verdict, 'PASS');
    assert.equal(v.evidence.executionClass, 'CANONICAL');
    assert.equal(v.evidence.runtimeId, realAuthority.canonical.runtimeId);
    assert.equal(v.evidence.model, realAuthority.canonical.model);
    // run identity binding (from the executed run's orchestration-state.json)
    assert.equal(v.evidence.evidence.runId, 'r'.repeat(64));
    assert.deepEqual(v.evidence.evidence.run, {
      topic: 'canonical runner wiring probe', mode: 'top-percent', percent: 20, runtime: realAuthority.canonical.runtimeId,
    });
    // artifact identity binding: sha256 over the ACTUAL result bytes
    const expectedSha = createHash('sha256').update(readFileSync(join(workDir, 'research-result.json'))).digest('hex');
    assert.equal(v.evidence.evidence.artifacts.resultFile, 'research-result.json');
    assert.equal(v.evidence.evidence.artifacts.resultSha256, expectedSha);
    assert.equal(v.evidence.evidence.restarted, true);
    assert.deepEqual(v.evidence.evidence.logs, { stdout: 'canonical-runner-stdout.log', stderr: 'canonical-runner-stderr.log' });
    rmSync(dir, { recursive: true, force: true });
  });

  test('COUNTEREXAMPLE: empty --work value falls back to the DEFAULT canonical work dir (never silently targets the repo root)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-runner-wk-'));
    const authority = testAuthority();
    const { write } = runArtifacts(dir, authority);
    const calls = [];
    const r = runCanonicalGate({
      authority, env: canonicalEnv(authority), repoRoot: dir, argv: ['--work', '', 'some topic'], spawnImpl: spawnedResearch(calls, write),
    });
    assert.equal(r.ok, true, JSON.stringify(r.detail ?? null));
    const wk = calls[0].args.indexOf('--work');
    assert.equal(calls[0].args[wk + 1], join(dir, 'work', 'canonical-research'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('COUNTEREXAMPLE: a completed-looking run whose state carries a NONDECLARED runtime is refused — no fallback, no evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-runner-drift-'));
    const authority = testAuthority();
    const { write } = runArtifacts(dir, authority, { runtime: 'undeclared-smoke-runtime' }); // as if a smoke/checkpoint run produced it
    const r = runCanonicalGate({
      authority, env: canonicalEnv(authority), repoRoot: dir, argv: ['canonical runner wiring probe'], spawnImpl: spawnedResearch([], write),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CANONICAL_EVIDENCE_RUNTIME_DRIFT');
    assert.ok(r.detail.includes('undeclared-smoke-runtime'));
    rmSync(dir, { recursive: true, force: true });
  });

  test('research entrypoint failure -> CANONICAL_RESEARCH_FAILED, no evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-runner-fail-'));
    const authority = testAuthority();
    const r = runCanonicalGate({
      authority, env: canonicalEnv(authority), repoRoot: dir, argv: ['some topic'],
      spawnImpl: () => ({ status: 1, stdout: '', stderr: '[research] fail (runtime_unavailable)' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CANONICAL_RESEARCH_FAILED');
    rmSync(dir, { recursive: true, force: true });
  });

  test('research "succeeds" but run identity artifacts are absent -> CANONICAL_EVIDENCE_INCOMPLETE (no unbound evidence)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-runner-inc-'));
    const authority = testAuthority();
    const r = runCanonicalGate({
      authority, env: canonicalEnv(authority), repoRoot: dir, argv: ['some topic'],
      spawnImpl: () => ({ status: 0, stdout: '', stderr: '' }), // success, but wrote nothing
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CANONICAL_EVIDENCE_INCOMPLETE');
    rmSync(dir, { recursive: true, force: true });
  });

  test('evidence binding is load-bearing: tampered runtimeId / model / verdict / executionClass rejected by the REAL validator', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p1-runner-bind-'));
    const authority = testAuthority();
    const { write } = runArtifacts(dir, authority);
    const r = runCanonicalGate({
      authority, env: canonicalEnv(authority), repoRoot: dir, argv: ['canonical runner wiring probe'], spawnImpl: spawnedResearch([], write),
    });
    assert.equal(r.ok, true);
    const realAuthority = loadRuntimeAuthority();
    for (const [field, bad] of [
      ['runtimeId', 'undeclared-smoke-runtime'],
      ['model', 'undeclared-smoke-model'],
      ['verdict', 'FAILED'],
      ['executionClass', 'LOCAL_NONCANONICAL_SMOKE'],
    ]) {
      const tampered = { ...r.evidence, [field]: bad };
      const v = validateCanonicalEvidence(JSON.stringify(tampered), realAuthority);
      assert.equal(v.ok, false, `${field} tamper must be rejected`);
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
