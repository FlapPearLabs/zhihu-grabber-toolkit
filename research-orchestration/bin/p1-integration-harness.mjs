#!/usr/bin/env node
/**
 * research-orchestration/bin/p1-integration-harness.mjs
 *
 * P1 execution-workflow repair, round 1 (PR #72 review, 2026-09-06):
 * small deterministic integration harness — not a framework. Encodes
 * docs/planning/P1_EXECUTION_WORKFLOW_V1.md.
 *
 * Round-1 repairs (F1–F6):
 *   F1 reviewed worker input is frozen ONCE to a full 40-hex commit SHA at
 *      invocation start; every check/merge/ledger field uses the frozen SHA.
 *   F2 parallel-worker input model: EXPECTED_INTEGRATION_HEAD (HEAD must
 *      equal it exactly), WORKER_REVIEW_BASE (ancestor of the reviewed SHA),
 *      WORKER_REVIEWED_SHA; merge-base(HEAD, reviewed) must equal the review
 *      base. Models parallel workers whose common base is NOT the current
 *      integration HEAD.
 *   F3 FINAL_DRY_RUN != FINAL_ACCEPTANCE: an offline stage-final run records
 *      finalAcceptanceEligible=false (mechanically, in the ledger).
 *   F5 default ledger path is repository-root-relative and cwd-independent.
 *   F6 stage-final executes a named negative-guard probe (real product guard
 *      module, tampered real artifact) and records its PASS/FAIL.
 *
 * Usage:
 *   stage-intermediate --expected-head <sha> --worker-review-base <sha> \
 *        --worker <40-hex sha | ref resolved+frozen once> \
 *        [--ticket p1-t13] [--focus 'test/...'] [--gate 'test/...'] [--out <abs path>]
 *   stage-final [--live] [--out <abs path>]
 *
 * The harness NEVER updates master; master advances only via a separate,
 * explicitly authorized exact-SHA ff push.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve as pathResolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REPO_ROOT = pathResolve(fileURLToPath(import.meta.url), '..', '..', '..'); // bin -> research-orchestration -> repo
const RO_DIR = pathResolve(REPO_ROOT, 'research-orchestration');
const NODE = process.env.P1_NODE_BIN ?? process.execPath;

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

/** F2: verify the parallel-worker integration input model.
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
  git('merge', '--no-ff', workerReviewedSha, '-m', `merge(p1-integration): integrate reviewed ${ticket ?? 'worker'} (${String(workerReviewedSha).slice(0, 7)}) — exact reviewed history preserved as ancestor`);
  const head = git('rev-parse', 'HEAD');
  if (!isAncestor(git, workerReviewedSha, head)) {
    throw new Error('F2_POST_ANCESTRY_BROKEN: reviewed SHA is not an exact ancestor after merge');
  }
  return head;
}

/** F3: ledger policy — offline stage-final is a DRY RUN, never acceptance. */
export function acceptanceVerdictFor({ liveRequested, liveStepOutcome }) {
  if (liveRequested && liveStepOutcome === 'PASS') return { finalAcceptanceEligible: true, acceptanceVerdict: 'ELIGIBLE_LIVE_WAVE_PASS' };
  if (liveRequested) return { finalAcceptanceEligible: false, acceptanceVerdict: 'LIVE_REQUESTED_BUT_NOT_PASSED' };
  return { finalAcceptanceEligible: false, acceptanceVerdict: 'OFFLINE_DRY_RUN_NOT_ACCEPTANCE' };
}

/** F5: repository-root-relative default ledger path — invocation cwd must not matter. */
export function defaultLedgerPath(repoRoot = REPO_ROOT) {
  return pathResolve(repoRoot, 'work', 'p1-wave-latest', 'execution-ledger.json');
}

/** F6: named negative-guard probe against the REAL product guard module with a tampered real artifact. */
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
  return { pass, detail: pass ? 'tampered identity → FAIL_CLOSED (SEAM_C_GUARD_MISMATCH), no synthesis authorized' : `unexpected guard result: ${JSON.stringify(result)}` };
}

export function buildLedger({ stage, expectedIntegrationHead = null, workerReviewBase = null, workerReviewedSha = null, mergeCommit = null, steps = [], finalAcceptanceEligible = null, acceptanceVerdict = null, extra = {} }) {
  return {
    schema: 'p1-execution-ledger/1',
    stage,
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

export function writeLedger(ledger, out, repoRoot = REPO_ROOT) {
  const p = isAbsolute(out) ? out : defaultLedgerPath(repoRoot);
  mkdirSync(pathResolve(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(ledger, null, 2));
  console.error(`ledger -> ${p}`);
  return p;
}

/** F2/F1: intermediate stage core (verify inputs → merge → post-ancestry). Steps recorded. */
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

function writeLedgerOrAbort({ stage, extra, steps, out, workerReviewedSha = null, workerReviewBase = null, expectedIntegrationHead = null }) {
  const mergeCommit = (() => { try { return makeGit(REPO_ROOT)('rev-parse', 'HEAD'); } catch { return null; } })();
  const ledger = buildLedger({ stage, expectedIntegrationHead, workerReviewBase, workerReviewedSha, mergeCommit, steps, extra });
  writeLedger(ledger, out);
  console.log(JSON.stringify(ledger, null, 2));
}

/** Pure: build the intermediate-stage tiered test plan (focused + affected gate; NO full suite). */
export function buildTierPlan({ focus, gate } = {}) {
  const files = [];
  for (const f of [focus, gate].filter(Boolean)) files.push(...f.split(',').map((s) => s.trim()).filter(Boolean));
  return { tier: 'INTERMEDIATE', fullSuite: false, files };
}

async function cliStageIntermediate(args) {
  const opt = {};
  for (let i = 0; i < args.length; i += 2) if (args[i].startsWith('--')) opt[args[i].replace(/^--/, '')] = args[i + 1];
  const git = makeGit(REPO_ROOT);
  const steps = [];
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
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
        execFileSync(NODE, ['--test', ...plan.files], { cwd: RO_DIR, stdio: 'inherit' });
        steps.push({ name: 'tests.tiered', startedAt: s0, finishedAt: new Date().toISOString(), durationMs: Date.now() - tt, outcome: 'PASS' });
      } catch (e) {
        steps.push({ name: 'tests.tiered', startedAt: s0, finishedAt: new Date().toISOString(), durationMs: Date.now() - tt, outcome: 'FAIL' });
        throw e;
      }
    }
    writeLedgerOrAbort({
      stage: 'INTERMEDIATE',
      steps,
      expectedIntegrationHead: opt['expected-head'],
      workerReviewBase: opt['worker-review-base'],
      workerReviewedSha: core.workerReviewedSha,
      out: opt.out,
      extra: { tierPlan: plan, frozenFrom: opt.worker },
    });
  } catch (e) {
    writeLedgerOrAbort({
      stage: 'INTERMEDIATE',
      steps,
      expectedIntegrationHead: opt['expected-head'] ?? null,
      workerReviewBase: opt['worker-review-base'] ?? null,
      out: opt.out,
      extra: { aborted: e.message },
    });
    console.error(`HARNESS_ABORT: ${e.message}`);
    process.exit(1);
  }
  void startedAt; void t0;
}


async function cliStageFinal(args) {
  const live = args.includes('--live');
  const outIdx = args.indexOf('--out');
  const out = outIdx !== -1 ? args[outIdx + 1] : undefined;
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
  const mode = live ? 'live' : 'offline';
  try {
    // F4: mode-aware preflight. Offline dry-run must not demand a runtime.
    await recordAsync('preflight', async () => {
      const r = spawnSync(NODE, ['bin/integration-preflight.mjs', '--stage', 'final', '--mode', mode], { cwd: RO_DIR, encoding: 'utf8' });
      let parsed = {};
      try { parsed = JSON.parse(r.stdout ?? '{}'); } catch { /* unparseable output treated as failure below */ }
      if (r.status !== 0) throw new Error(`${parsed.verdict ?? 'PREFLIGHT_FAIL'}: ${(parsed.failedCodes ?? []).join(',')}`);
      return parsed;
    });
    await recordAsync('tests.full-offline', async () => {
      execFileSync(NODE, ['--test', 'test/*.test.mjs'], { cwd: RO_DIR, stdio: 'inherit' });
    });
    let liveStepOutcome = 'NOT_RUN';
    if (live) {
      const s = await recordAsync('tests.live-whole-wave', async () => {
        execFileSync(NODE, ['--test', '--test-concurrency=1', 'test/*.test.mjs'], {
          cwd: RO_DIR, stdio: 'inherit',
          env: { ...process.env, P1_REAL_RUNTIME: '1', P1_LMSTUDIO_MODEL: process.env.P1_LMSTUDIO_MODEL ?? 'qwen/qwen3-1.7b:2' },
        });
        return 'PASS';
      });
      liveStepOutcome = s;
    }
    const work = pathResolve(process.env.P1_SEAM_ARTIFACTS_DIR ?? pathResolve(REPO_ROOT, 'work', 'p1-wave-01-integration'));
    const chain = await recordAsync('identity.chain (F6)', () => verifyIdentityChain({
      seamB: pathResolve(work, 'seam-b-real.json'),
      seamC: pathResolve(work, 'seam-c-real.json'),
      seamD: pathResolve(work, 'seam-d-real.json'),
    }));
    if (!chain.pass) throw new Error(`identity chain failures: ${chain.failures.join('; ')}`);
    const negative = await recordAsync('guard.negative (F6)', async () => negativeGuardProbe({ artifact: JSON.parse(readFileSync(pathResolve(work, 'seam-c-real.json'), 'utf8')) }));
    if (!negative.pass) throw new Error(`negative guard probe failed: ${negative.detail}`);
    const acc = acceptanceVerdictFor({ liveRequested: live, liveStepOutcome });
    const ledger = buildLedger({
      stage: 'FINAL',
      mergeCommit: git('rev-parse', 'HEAD'),
      steps,
      finalAcceptanceEligible: acc.finalAcceptanceEligible,
      acceptanceVerdict: acc.acceptanceVerdict,
      extra: { live, mode, identityChain: chain, guardNegative: negative },
    });
    writeLedger(ledger, out);
    console.log(JSON.stringify(ledger, null, 2));
    if (!acc.finalAcceptanceEligible) console.error('FINAL_DRY_RUN: NOT acceptance-eligible (offline). Canonical P1 acceptance requires live whole-wave = PASS.');
  } catch (e) {
    const acc = acceptanceVerdictFor({ liveRequested: live, liveStepOutcome: 'FAIL' });
    const ledger = buildLedger({
      stage: 'FINAL',
      mergeCommit: (() => { try { return git('rev-parse', 'HEAD'); } catch { return null; } })(),
      steps,
      finalAcceptanceEligible: acc.finalAcceptanceEligible,
      acceptanceVerdict: acc.acceptanceVerdict,
      extra: { live, mode, aborted: e.message },
    });
    writeLedger(ledger, out);
    console.error(`HARNESS_ABORT: ${e.message}`);
    process.exit(1);
  }
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

function isMainModule() {
  try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; }
}
if (isMainModule()) {
  const [stage, ...rest] = process.argv.slice(2);
  try {
    if (stage === 'stage-intermediate') await cliStageIntermediate(rest);
    else if (stage === 'stage-final') await cliStageFinal(rest);
    else {
      console.error('usage: p1-integration-harness.mjs (stage-intermediate|stage-final) [options] — see header');
      process.exit(2);
    }
  } catch (e) {
    console.error(`HARNESS_ABORT: ${e.message}`);
    process.exit(1);
  }
}
