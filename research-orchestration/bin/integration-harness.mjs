#!/usr/bin/env node
/**
 * research-orchestration/bin/integration-harness.mjs
 *
 * Generic integration harness for the execution workflow (round 2, F8
 * canonical runtime authority). NOT a framework. Encodes
 * the project execution-workflow document (docs/planning/).
 *
 * EXECUTION MODE TAXONOMY (F8):
 *   offline  — FINAL_DRY_RUN. Never acceptance-eligible.
 *   smoke    — LOCAL_NONCANONICAL_SMOKE. May use the project-declared local
 *              runtime; explicitly NONCANONICAL; never acceptance-eligible
 *              (even when every step passes).
 *   canonical— CANONICAL_ACCEPTANCE. Uses the project-declared canonical
 *              runtime only; missing credential/runtime fails closed;
 *              absolutely no fallback to the local smoke runtime; only a
 *              canonical whole-wave PASS sets finalAcceptanceEligible=true.
 *
 * EXTRACTION BOUNDARY: this file and integration-preflight.mjs contain no
 * runtime/model/credential/project names — every such binding lives in the
 * project declaration file (bin/runtime-authority.json) read through
 * runtime-authority.mjs. A static test enforces this.
 *
 * The harness NEVER updates master; master advances only via a separate,
 * explicitly authorized exact-SHA ff push.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as pathResolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadRuntimeAuthority, REPO_ROOT, RO_DIR } from './runtime-authority.mjs';

const NODE_BIN = () => process.env[loadRuntimeAuthority().env.nodeBin] ?? process.execPath;

/** Git runner factory bound to a working directory (testable against temp repos). */
export function makeGit(cwd) {
  const git = (...args) => execFileSync('git', ['--no-pager', ...args], { cwd, encoding: 'utf8' }).trim();
  git.cwd = cwd;
  return git;
}
function isAncestor(git, anc, desc) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', anc, desc], { cwd: git.cwd }); return true; } catch { return false; }
}

/**
 * F1: freeze the reviewed worker identity ONCE to a full 40-hex commit SHA.
 * Exact 40-hex input is used verbatim (after existence verification); any
 * other ref (branch/tag/short sha) is resolved exactly once and frozen.
 */
export function resolveFrozenWorkerSha(git, ref) {
  const frozen = git('rev-parse', '--verify', `${ref}^{commit}`);
  if (!/^[0-9a-f]{40}$/.test(frozen)) {
    throw new Error(`F1_EXACT_SHA: resolved value is not a full 40-hex commit: ${frozen}`);
  }
  return frozen;
}

/**
 * F2: verify the parallel-worker integration input model.
 * 1. HEAD === EXPECTED_INTEGRATION_HEAD (exact)
 * 2. WORKER_REVIEW_BASE is an ancestor of WORKER_REVIEWED_SHA
 * 3. merge-base(HEAD, WORKER_REVIEWED_SHA) === WORKER_REVIEW_BASE
 */
export function verifyIntermediateInputs(git, { expectedIntegrationHead, workerReviewBase, workerReviewedSha }) {
  const failures = [];
  const head = git('rev-parse', 'HEAD');
  if (head !== expectedIntegrationHead) {
    failures.push(`HEAD ${head} != EXPECTED_INTEGRATION_HEAD ${expectedIntegrationHead} (MASTER_DRIFT / stale invocation)`);
  }
  if (!isAncestor(git, workerReviewBase, workerReviewedSha)) {
    failures.push(`WORKER_REVIEW_BASE ${workerReviewBase} is not an ancestor of WORKER_REVIEWED_SHA ${workerReviewedSha}`);
  }
  const mb = git('merge-base', 'HEAD', workerReviewedSha);
  if (mb !== workerReviewBase) {
    failures.push(`merge-base(HEAD, reviewed)=${mb} != WORKER_REVIEW_BASE ${workerReviewBase}`);
  }
  return { ok: failures.length === 0, failures, head };
}

/** F2: perform the exact merge phase (no-ff) + post-ancestry verification. Returns the post-merge HEAD. */
export function runIntermediateMerge(git, { workerReviewedSha, ticket }) {
  git('merge', '--no-ff', workerReviewedSha, '-m', `merge(workflow-integration): integrate reviewed ${ticket ?? 'worker'} (${String(workerReviewedSha).slice(0, 7)}) — exact reviewed history preserved as ancestor`);
  const head = git('rev-parse', 'HEAD');
  if (!isAncestor(git, workerReviewedSha, head)) {
    throw new Error('F2_POST_ANCESTRY_BROKEN: reviewed SHA is not an exact ancestor after merge');
  }
  return head;
}

/** F2: intermediate stage core (freeze → verify inputs → merge → post-ancestry). */
export function runIntermediateStage({ git, expectedIntegrationHead, workerReviewBase, worker, ticket = null }) {
  const steps = [];
  const record = (name, fn) => {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const value = fn();
      steps.push({ name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, outcome: 'PASS' });
      return value;
    } catch (e) {
      steps.push({ name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, outcome: `FAIL: ${e.message}` });
      throw e;
    }
  };
  const workerReviewedSha = record('freeze.worker_sha (F1)', () => resolveFrozenWorkerSha(git, worker));
  const inputs = record('verify.inputs (F2)', () => verifyIntermediateInputs(git, { expectedIntegrationHead, workerReviewBase, workerReviewedSha }));
  if (!inputs.ok) throw new Error(`F2_INPUT_REFUSED: ${inputs.failures.join('; ')}`);
  const mergeCommit = record('merge.exact (F2)', () => runIntermediateMerge(git, { workerReviewedSha, ticket }));
  return { workerReviewedSha, mergeCommit, steps };
}

/** Pure: build the intermediate-stage tiered test plan (focused + affected gate; NO full suite). */
export function buildTierPlan({ focus, gate } = {}) {
  const files = [];
  for (const f of [focus, gate].filter(Boolean)) files.push(...f.split(',').map((s) => s.trim()).filter(Boolean));
  return { tier: 'INTERMEDIATE', fullSuite: false, files };
}

/** F6: identity-chain verification over real artifacts (B -> C -> D). */
export function verifyIdentityChain({ seamB, seamC, seamD }) {
  const failures = [];
  const b = JSON.parse(readFileSync(seamB, 'utf8'));
  const c = JSON.parse(readFileSync(seamC, 'utf8'));
  const d = JSON.parse(readFileSync(seamD, 'utf8'));
  const sb = b.selectedCorpusIdentity;
  const scRef = c.selectedCorpusIdentityRef;
  const scAgg = c.aggregateAnalyzedIdentity?.mappedAnalyzedSourceSetIdentity;
  const g = d.preSynthesisGuard ?? {};
  if (scRef !== sb) failures.push('C.selectedCorpusIdentityRef != B.selectedCorpusIdentity');
  if (scAgg !== sb) failures.push('C.aggregate != B.selectedCorpusIdentity (echo broken)');
  if (g.selectedVerifiedSourceSetIdentity !== sb) failures.push('D.guard.selected != B');
  if (g.mappedAnalyzedSourceSetIdentity !== scAgg) failures.push('D.guard.mapped != C.aggregate');
  if (g.guardResult !== 'PASS') failures.push(`D.guardResult=${g.guardResult}`);
  if (b.planHash !== c.planHash || c.planHash !== d.planHash) failures.push('planHash drift across artifacts');
  return { pass: failures.length === 0, failures, identity: sb };
}

/**
 * F6: named negative-guard probe against the REAL product guard module with a
 * tampered artifact. The tampered identity pair MUST produce the frozen
 * FAIL_CLOSED mismatch code — recorded as a PASS/FAIL step in the ledger.
 */
export async function negativeGuardProbe({ artifact }) {
  const mod = await import(pathToFileURL(pathResolve(RO_DIR, 'lib', 'pre-synthesis-guard.mjs')).href);
  const selected = artifact.selectedCorpusIdentityRef;
  const mapped = artifact.aggregateAnalyzedIdentity?.mappedAnalyzedSourceSetIdentity;
  if (typeof mapped !== 'string' || mapped.length < 2) {
    return { pass: false, detail: 'artifact lacks mappedAnalyzedSourceSetIdentity to tamper' };
  }
  const flip = mapped[mapped.length - 1] === '0' ? '1' : '0';
  const tampered = mapped.slice(0, -1) + flip;
  const result = mod.runPreSynthesisGuard({ selectedVerifiedSourceSetIdentity: selected, mappedAnalyzedSourceSetIdentity: tampered });
  const pass = result.ok === false && result.code === 'SEAM_C_GUARD_MISMATCH' && result.guardResult === 'FAIL_CLOSED';
  return { pass, detail: pass ? 'tampered identity → FAIL_CLOSED (mismatch code), no synthesis authorized' : `unexpected guard result: ${JSON.stringify(result)}` };
}

/**
 * F8: acceptance verdict is a pure function of the execution mode and the
 * canonical step outcome. smoke is NEVER acceptance-eligible (even on PASS);
 * only canonical ACCEPTANCE_PASS qualifies.
 */
export function acceptanceVerdictFor({ mode, canonicalStepOutcome = 'NOT_RUN' }) {
  if (mode === 'offline') return { finalAcceptanceEligible: false, acceptanceVerdict: 'OFFLINE_DRY_RUN_NOT_ACCEPTANCE' };
  if (mode === 'smoke') return { finalAcceptanceEligible: false, acceptanceVerdict: 'LOCAL_NONCANONICAL_SMOKE_NOT_ACCEPTANCE' };
  if (mode === 'canonical') {
    return canonicalStepOutcome === 'PASS'
      ? { finalAcceptanceEligible: true, acceptanceVerdict: 'CANONICAL_ACCEPTANCE_PASS' }
      : { finalAcceptanceEligible: false, acceptanceVerdict: 'CANONICAL_ACCEPTANCE_NOT_PASSED' };
  }
  throw new Error(`unknown execution mode: ${mode}`);
}

/**
 * F8: whole-wave env overlay per mode. canonical NEVER carries the local
 * smoke runtime keys (no-fallback is enforced at the env level), and the
 * canonical credential is inherited from the operator environment only.
 */
export function wholeWaveEnvFor({ mode, authority, env = process.env }) {
  if (mode === 'offline') return null;
  if (mode === 'smoke') {
    return {
      [authority.env.realRuntime]: '1',
      [authority.localSmoke.baseUrlEnv]: env[authority.localSmoke.baseUrlEnv] ?? authority.localSmoke.baseUrlDefault,
      [authority.localSmoke.modelEnv]: env[authority.localSmoke.modelEnv] ?? authority.localSmoke.modelDefault,
    };
  }
  if (mode === 'canonical') {
    return { [authority.env.runtimeMode]: 'canonical' };
  }
  throw new Error(`unknown execution mode: ${mode}`);
}

/**
 * F8: canonical readiness — fail closed WITHOUT using the credential.
 * 1. canonical credential present: declared env var non-empty OR declared
 *    0600 file exists at the repo root (the value is never read by the harness).
 * 2. canonical suite wiring switch: the whole-wave gates must consume the
 *    canonical runtime declaration (env switch) — otherwise canonical mode
 *    aborts rather than silently exercising the local smoke runtime under a
 *    canonical label (that would be a forbidden fallback).
 */
export function canonicalReadiness({ authority, env = process.env, repoRoot = REPO_ROOT }) {
  const failures = [];
  const envPresent = typeof env[authority.canonical.credentialEnv] === 'string' && env[authority.canonical.credentialEnv].trim() !== '';
  const filePresent = authority.canonical.credentialFile ? existsSync(pathResolve(repoRoot, authority.canonical.credentialFile)) : false;
  if (!envPresent && !filePresent) {
    failures.push({ code: 'CANONICAL_CREDENTIAL_MISSING', detail: `${authority.canonical.credentialEnv} not set and ${authority.canonical.credentialFile} not present — canonical acceptance fails closed (no fallback)` });
  }
  if (env[authority.env.suiteReady] !== '1') {
    failures.push({ code: 'CANONICAL_SUITE_NOT_WIRED', detail: 'whole-wave gates do not yet consume the canonical runtime declaration; refusing to run a canonical-labelled wave that would exercise a noncanonical runtime' });
  }
  return { ok: failures.length === 0, failures };
}

/** F5: repository-root-relative default ledger path (from the declaration) — cwd-independent. */
export function defaultLedgerPath(repoRoot = REPO_ROOT, authority = loadRuntimeAuthority()) {
  return pathResolve(repoRoot, authority.ledger.dir, 'execution-ledger.json');
}

export function buildLedger({ stage, runtimeClass = null, expectedIntegrationHead = null, workerReviewBase = null, workerReviewedSha = null, mergeCommit = null, steps = [], finalAcceptanceEligible = null, acceptanceVerdict = null, extra = {} }) {
  return {
    schema: 'wf-execution-ledger/1',
    stage,
    runtimeClass,
    expectedIntegrationHead,
    workerReviewBase,
    workerReviewedSha,
    mergeCommit,
    startedAt: steps[0]?.startedAt ?? null,
    finishedAt: steps[steps.length - 1]?.finishedAt ?? null,
    steps: steps.map((s) => ({ name: s.name, startedAt: s.startedAt, finishedAt: s.finishedAt, durationMs: s.durationMs, outcome: s.outcome })),
    masterUpdate: 'REFUSED_BY_HARNESS — exact-SHA ff push is a separate, explicitly authorized operation',
    finalAcceptanceEligible,
    acceptanceVerdict,
    ...extra,
  };
}

export function writeLedger(ledger, out, repoRoot = REPO_ROOT, authority = loadRuntimeAuthority()) {
  const p = isAbsolute(out) ? out : defaultLedgerPath(repoRoot, authority);
  mkdirSync(pathResolve(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(ledger, null, 2));
  console.error(`ledger -> ${p}`);
  return p;
}

const RUNTIME_CLASS = { offline: 'OFFLINE_DRY_RUN', smoke: 'LOCAL_NONCANONICAL_SMOKE', canonical: 'CANONICAL_ACCEPTANCE' };

async function cliStageIntermediate(args) {
  const opt = {};
  for (let i = 0; i < args.length; i += 2) if (args[i].startsWith('--')) opt[args[i].replace(/^--/, '')] = args[i + 1];
  const authority = loadRuntimeAuthority();
  const git = makeGit(REPO_ROOT);
  const steps = [];
  try {
    if (!opt['expected-head'] || !opt['worker-review-base'] || !opt.worker) {
      throw new Error('--expected-head, --worker-review-base and --worker are required');
    }
    const core = runIntermediateStage({
      git,
      expectedIntegrationHead: opt['expected-head'],
      workerReviewBase: opt['worker-review-base'],
      worker: opt.worker,
      ticket: opt.ticket ?? null,
    });
    steps.push(...core.steps);
    const plan = buildTierPlan({ focus: opt.focus, gate: opt.gate });
    if (plan.files.length > 0) {
      const s0 = new Date().toISOString(); const tt = Date.now();
      try {
        execFileSync(NODE_BIN(), ['--test', ...plan.files], { cwd: RO_DIR, stdio: 'inherit' });
        steps.push({ name: 'tests.tiered', startedAt: s0, finishedAt: new Date().toISOString(), durationMs: Date.now() - tt, outcome: 'PASS' });
      } catch (e) {
        steps.push({ name: 'tests.tiered', startedAt: s0, finishedAt: new Date().toISOString(), durationMs: Date.now() - tt, outcome: 'FAIL' });
        throw e;
      }
    }
    const ledger = buildLedger({
      stage: 'INTERMEDIATE', runtimeClass: null,
      expectedIntegrationHead: opt['expected-head'], workerReviewBase: opt['worker-review-base'],
      workerReviewedSha: core.workerReviewedSha, mergeCommit: git('rev-parse', 'HEAD'),
      steps, extra: { tierPlan: plan, frozenFrom: opt.worker },
    });
    writeLedger(ledger, opt.out, REPO_ROOT, authority);
    console.log(JSON.stringify(ledger, null, 2));
  } catch (e) {
    const ledger = buildLedger({
      stage: 'INTERMEDIATE', runtimeClass: null,
      expectedIntegrationHead: opt['expected-head'] ?? null, workerReviewBase: opt['worker-review-base'] ?? null,
      steps, extra: { aborted: e.message },
    });
    writeLedger(ledger, opt.out, REPO_ROOT, authority);
    console.error(`HARNESS_ABORT: ${e.message}`);
    process.exit(1);
  }
}

async function cliStageFinal(args) {
  const outIdx = args.indexOf('--out');
  const out = outIdx !== -1 ? args[outIdx + 1] : undefined;
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'offline';
  if (!['offline', 'smoke', 'canonical'].includes(mode)) {
    console.error(`HARNESS_ABORT: unknown execution mode '${mode}' (offline|smoke|canonical)`);
    process.exit(2);
  }
  const authority = loadRuntimeAuthority();
  const git = makeGit(REPO_ROOT);
  const steps = [];
  const recordAsync = async (name, fn) => {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
      const value = await fn();
      steps.push({ name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, outcome: 'PASS' });
      return value;
    } catch (e) {
      steps.push({ name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, outcome: `FAIL: ${e.message}` });
      throw e;
    }
  };
  try {
    await recordAsync('preflight', async () => {
      const r = spawnSync(NODE_BIN(), ['bin/integration-preflight.mjs', '--stage', 'final', '--mode', mode], { cwd: RO_DIR, encoding: 'utf8' });
      let parsed = {};
      try { parsed = JSON.parse(r.stdout ?? '{}'); } catch { /* unparseable output treated as failure below */ }
      if (r.status !== 0) throw new Error(`${parsed.verdict ?? 'PREFLIGHT_FAIL'}: ${(parsed.failedCodes ?? []).join(',')}`);
      return parsed;
    });
    await recordAsync('tests.full-offline', async () => {
      execFileSync(NODE_BIN(), ['--test', 'test/*.test.mjs'], { cwd: RO_DIR, stdio: 'inherit' });
    });
    let canonicalStepOutcome = 'NOT_RUN';
    if (mode === 'smoke') {
      await recordAsync('tests.smoke-whole-wave', async () => {
        execFileSync(NODE_BIN(), ['--test', '--test-concurrency=1', 'test/*.test.mjs'], {
          cwd: RO_DIR, stdio: 'inherit', env: { ...process.env, ...wholeWaveEnvFor({ mode, authority }) },
        });
        return 'PASS';
      });
    }
    if (mode === 'canonical') {
      await recordAsync('canonical.readiness (F8)', async () => {
        const r = canonicalReadiness({ authority });
        if (!r.ok) throw new Error(r.failures.map((f) => `${f.code}: ${f.detail}`).join('; '));
        return 'PASS';
      });
      await recordAsync('tests.canonical-whole-wave', async () => {
        execFileSync(NODE_BIN(), ['--test', '--test-concurrency=1', 'test/*.test.mjs'], {
          cwd: RO_DIR, stdio: 'inherit', env: { ...process.env, ...wholeWaveEnvFor({ mode, authority }) },
        });
        canonicalStepOutcome = 'PASS';
        return 'PASS';
      });
    }
    const work = pathResolve(process.env[authority.env.seamArtifactsDir] ?? pathResolve(REPO_ROOT, authority.artifacts.dir));
    const chain = await recordAsync('identity.chain (F6)', () => verifyIdentityChain({
      seamB: pathResolve(work, authority.artifacts.files[0]),
      seamC: pathResolve(work, authority.artifacts.files[1]),
      seamD: pathResolve(work, authority.artifacts.files[2]),
    }));
    if (!chain.pass) throw new Error(`identity chain failures: ${chain.failures.join('; ')}`);
    const negative = await recordAsync('guard.negative (F6)', async () => negativeGuardProbe({ artifact: JSON.parse(readFileSync(pathResolve(work, authority.artifacts.files[1]), 'utf8')) }));
    if (!negative.pass) throw new Error(`negative guard probe failed: ${negative.detail}`);
    const acc = acceptanceVerdictFor({ mode, canonicalStepOutcome });
    const ledger = buildLedger({
      stage: 'FINAL', runtimeClass: RUNTIME_CLASS[mode],
      mergeCommit: git('rev-parse', 'HEAD'), steps,
      finalAcceptanceEligible: acc.finalAcceptanceEligible, acceptanceVerdict: acc.acceptanceVerdict,
      extra: { mode, identityChain: chain, guardNegative: negative },
    });
    writeLedger(ledger, out, REPO_ROOT, authority);
    console.log(JSON.stringify(ledger, null, 2));
    if (!acc.finalAcceptanceEligible) {
      console.error(`NOT ACCEPTANCE-ELIGIBLE: ${acc.acceptanceVerdict}. Canonical acceptance requires the canonical whole-wave = PASS.`);
    }
  } catch (e) {
    const acc = acceptanceVerdictFor({ mode, canonicalStepOutcome: 'FAIL' });
    const ledger = buildLedger({
      stage: 'FINAL', runtimeClass: RUNTIME_CLASS[mode],
      mergeCommit: (() => { try { return git('rev-parse', 'HEAD'); } catch { return null; } })(),
      steps, finalAcceptanceEligible: acc.finalAcceptanceEligible, acceptanceVerdict: acc.acceptanceVerdict,
      extra: { mode, aborted: e.message },
    });
    writeLedger(ledger, out, REPO_ROOT, authority);
    console.error(`HARNESS_ABORT: ${e.message}`);
    process.exit(1);
  }
}

function isMainModule() {
  try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; }
}
if (isMainModule()) {
  const [stage, ...rest] = process.argv.slice(2);
  try {
    if (stage === 'stage-intermediate') await cliStageIntermediate(rest);
    else if (stage === 'stage-final') await cliStageFinal(rest);
    else {
      console.error('usage: integration-harness.mjs (stage-intermediate|stage-final) [options] — see header');
      process.exit(2);
    }
  } catch (e) {
    console.error(`HARNESS_ABORT: ${e.message}`);
    process.exit(1);
  }
}
