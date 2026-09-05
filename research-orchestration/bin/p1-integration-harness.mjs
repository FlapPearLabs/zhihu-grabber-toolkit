#!/usr/bin/env node
/**
 * research-orchestration/bin/p1-integration-harness.mjs
 *
 * P1 execution-workflow repair (workflow efficiency audit, 2026-09-06):
 * a SMALL deterministic integration harness — not a framework. Encodes the
 * repaired execution policy (docs/planning/P1_EXECUTION_WORKFLOW_V1.md):
 *
 *   stage-intermediate: exact-SHA verification -> merge --no-ff -> tiered tests
 *     (focused ticket tests + affected seam TYPE_B gate, offline variant).
 *     NO full suite by default.
 *   stage-final: preflight -> all gates -> ONE full research-orchestration
 *     regression -> optional ONE live whole-wave run -> identity-chain +
 *     negative-guard probe -> evidence ledger. MASTER UPDATE REFUSED.
 *
 * Machine-readable ledger written to --out (default work/p1-wave-latest/execution-ledger.json).
 *
 * Usage:
 *   node bin/p1-integration-harness.mjs stage-intermediate --base <sha> --worker <sha|branch> \
 *        --ticket p1-t13 --focus 'test/p1-t13-*.test.mjs' --gate 'test/p1-seam-c-real-conformance.test.mjs'
 *   node bin/p1-integration-harness.mjs stage-final [--live] [--base <sha>] [--out <ledger.json>]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..'); // research-orchestration/..
const NODE = process.env.P1_NODE_BIN ?? process.execPath;

function git(...args) {
  return execFileSync('git', ['--no-pager', ...args], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}
function shaExists(sha) {
  try { git('cat-file', '-e', `${sha}^{commit}`); return true; } catch { return false; }
}
function isAncestor(anc, desc) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', anc, desc], { cwd: REPO_ROOT }); return true; } catch { return false; }
}
function mergeBase(a, b) {
  return git('merge-base', a, b);
}

/** Pure: build the intermediate-stage tiered test plan (no full suite). */
export function buildTierPlan({ ticket, focus, gate }) {
  const files = [];
  for (const f of [focus, gate].filter(Boolean)) files.push(...f.split(',').map((s) => s.trim()).filter(Boolean));
  return { tier: 'INTERMEDIATE', fullSuite: false, files };
}

/** Pure: identity-chain verification over real artifacts (B -> C -> D). */
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

/** Pure: enforce the "one mandatory final regression" + "master refused" policy in the ledger. */
export function buildLedger({ stage, base, worker, mergeCommit, steps, extra }) {
  return {
    schema: 'p1-execution-ledger/1',
    stage,
    base: base ?? null,
    worker: worker ?? null,
    mergeCommit: mergeCommit ?? null,
    startedAt: steps[0]?.startedAt ?? null,
    finishedAt: steps[steps.length - 1]?.finishedAt ?? null,
    steps: steps.map((s) => ({ name: s.name, startedAt: s.startedAt, finishedAt: s.finishedAt, durationMs: s.durationMs, outcome: s.outcome })),
    masterUpdate: 'REFUSED_BY_HARNESS — exact-SHA ff push is a separate, explicitly authorized operation',
    ...extra,
  };
}

async function runStageIntermediate(args) {
  const opt = {};
  for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
  const steps = [];
  const t = (name, fn) => {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try { const out = fn(); steps.push({ name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, outcome: 'PASS' }); return out; }
    catch (e) { steps.push({ name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, outcome: `FAIL: ${e.message}` }); throw e; }
  };
  const base = opt.base;
  const worker = opt.worker;
  if (!base || !worker) throw new Error('--base and --worker are required');
  t('verify.shas', () => {
    if (!shaExists(base)) throw new Error(`base ${base} not a commit`);
    if (!shaExists(worker)) throw new Error(`worker ${worker} not a commit`);
    if (!isAncestor(base, worker)) throw new Error(`base ${base} is not an ancestor of worker ${worker}`);
  });
  const alreadyMerged = isAncestor(worker, 'HEAD');
  if (!alreadyMerged) {
    t('verify.mergebase', () => {
      const mb = mergeBase('HEAD', worker);
      if (mb !== base) throw new Error(`merge-base(HEAD, worker)=${mb} != base ${base} — refusing merge (MASTER_DRIFT semantics)`);
    });
    t('merge.exact', () => {
      git('merge', '--no-ff', worker, '-m', `merge(p1-integration): integrate reviewed ${opt.ticket ?? 'worker'} (${String(worker).slice(0, 7)}) — exact reviewed history preserved as ancestor`);
      return git('rev-parse', 'HEAD');
    });
  }
  const mergeCommit = git('rev-parse', 'HEAD');
  t('verify.ancestry.post', () => {
    if (!isAncestor(base, 'HEAD') || !isAncestor(worker, 'HEAD')) throw new Error('post-merge ancestry broken');
  });
  const plan = buildTierPlan(opt);
  if (plan.files.length > 0) {
    t('tests.tiered', () => {
      execFileSync(NODE, ['--test', ...plan.files], { cwd: resolve(REPO_ROOT, 'research-orchestration'), stdio: 'inherit' });
    });
  }
  const ledger = buildLedger({ stage: 'INTERMEDIATE', base, worker, mergeCommit, steps, extra: { tierPlan: plan } });
  writeLedger(ledger, opt.out);
  console.log(JSON.stringify(ledger, null, 2));
}

function writeLedger(ledger, out) {
  const p = resolve(out ?? '../../work/p1-wave-latest/execution-ledger.json');
  mkdirSync(resolve(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(ledger, null, 2));
  console.error(`ledger -> ${p}`);
}

async function runStageFinal(args) {
  const live = args.includes('--live');
  const base = args[args.indexOf('--base') + 1] ?? null;
  const outIdx = args.indexOf('--out');
  const steps = [];
  const t = async (name, fn) => {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try { const out = await fn(); steps.push({ name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, outcome: 'PASS' }); return out; }
    catch (e) { steps.push({ name, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, outcome: `FAIL: ${e.message}` }); throw e; }
  };
  let preflight = null;
  try {
    preflight = await t('preflight', async () => {
      const { spawnSync } = await import('node:child_process');
      const a = ['bin/integration-preflight.mjs', '--stage', 'final'];
      const r = spawnSync(NODE, a, { cwd: resolve(REPO_ROOT, 'research-orchestration'), encoding: 'utf8' });
      const parsed = JSON.parse(r.stdout ?? '{}');
      if (r.status !== 0) throw new Error(`${parsed.verdict}: ${(parsed.failedCodes ?? []).join(',')}`);
      return parsed;
    });
  } catch (e) {
    const ledger = buildLedger({ stage: 'FINAL', base, worker: null, mergeCommit: git('rev-parse', 'HEAD'), steps, extra: { live, note: 'aborted BEFORE product tests (environment classification per policy)' } });
    writeLedger(ledger, outIdx !== -1 ? args[outIdx + 1] : undefined);
    console.log(JSON.stringify(ledger, null, 2));
    process.exit(1);
  }
  const roDir = resolve(REPO_ROOT, 'research-orchestration');
  await t('tests.full-offline', async () => {
    execFileSync(NODE, ['--test', 'test/*.test.mjs'], { cwd: roDir, stdio: 'inherit' });
  });
  if (live) {
    await t('tests.live-whole-wave', async () => {
      execFileSync(NODE, ['--test', '--test-concurrency=1', 'test/*.test.mjs'], {
        cwd: roDir, stdio: 'inherit',
        env: { ...process.env, P1_REAL_RUNTIME: '1', P1_LMSTUDIO_MODEL: process.env.P1_LMSTUDIO_MODEL ?? 'qwen/qwen3-1.7b:2' },
      });
    });
  }
  const work = resolve(process.env.P1_SEAM_ARTIFACTS_DIR ?? resolve(REPO_ROOT, 'work/p1-wave-01-integration'));
  const chain = await t('identity.chain', () => verifyIdentityChain({
    seamB: resolve(work, 'seam-b-real.json'),
    seamC: resolve(work, 'seam-c-real.json'),
    seamD: resolve(work, 'seam-d-real.json'),
  }));
  if (!chain.pass) throw new Error(`identity chain failures: ${chain.failures.join('; ')}`);
  const ledger = buildLedger({ stage: 'FINAL', base, worker: null, mergeCommit: git('rev-parse', 'HEAD'), steps, extra: { live, preflight: preflight ?? null, identityChain: chain } });
  writeLedger(ledger, outIdx !== -1 ? args[outIdx + 1] : undefined);
  console.log(JSON.stringify(ledger, null, 2));
}

function isMainModule() {
  try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; }
}
if (isMainModule()) {
  const [stage, ...rest] = process.argv.slice(2);
  try {
    if (stage === 'stage-intermediate') await runStageIntermediate(rest);
    else if (stage === 'stage-final') await runStageFinal(rest);
    else {
      console.error('usage: p1-integration-harness.mjs (stage-intermediate|stage-final) [options] — see header');
      process.exit(2);
    }
  } catch (e) {
    console.error(`HARNESS_ABORT: ${e.message}`);
    process.exit(1);
  }
}
