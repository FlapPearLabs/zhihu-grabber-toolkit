#!/usr/bin/env node
/**
 * research-orchestration/bin/canonical-runner.mjs
 *
 * PROJECT-OWNED canonical runner, declared mechanically by
 * bin/runtime-authority.json (canonical.runner) and executed by the generic
 * harness (runCanonicalRunner) in canonical mode ONLY. This script contains no
 * vendor/model/credential values: every such binding is read from the project
 * declaration (loadRuntimeAuthority) — the declaration owns them.
 *
 * Contract (fail closed everywhere; absolutely no fallback to any undeclared
 * or local noncanonical runtime — not at env level, not at spawn level):
 *
 *   exit 0  exactly one JSON object on stdout: canonical-runner-evidence/1,
 *           verdict PASS, executionClass CANONICAL, runtimeId/model bound to
 *           the DECLARED values, evidence block binding the executed run
 *           identity (runId/topic/mode/percent/runtime from the run's
 *           orchestration-state.json) and the result artifact identity
 *           (sha256 over research-result.json).
 *   exit != 0  machine-readable FAILED object on stdout (same schema family,
 *           verdict FAILED — can never satisfy canonical acceptance):
 *     CANONICAL_RUNNER_USAGE           no research topic supplied (exit 2)
 *     CANONICAL_RUNNER_MODE_REFUSED    env is not the canonical mode overlay
 *                                      (declared runtimeMode env key must be
 *                                      exactly 'canonical') (exit 1)
 *     CANONICAL_CREDENTIAL_MISSING     canonical credential absent — reuses
 *                                      the preflight presence-only rule and
 *                                      machine code; the value is never read,
 *                                      printed or logged (exit 1)
 *     CANONICAL_RESEARCH_FAILED        the research entrypoint did not
 *                                      complete successfully (exit 1)
 *     CANONICAL_EVIDENCE_INCOMPLETE    run identity / result artifact absent
 *                                      or unparseable after a successful
 *                                      exit — no UNBOUND evidence is ever
 *                                      emitted (exit 1)
 *     CANONICAL_EVIDENCE_RUNTIME_DRIFT the executed run's state carries a
 *                                      runtime other than the declared
 *                                      canonical runtimeId — evidence would
 *                                      be false, refused (exit 1)
 *
 * Execution boundary: the ACTUAL canonical P1 path — the existing research
 * entrypoint (bin/research.mjs) invoked with --runtime resolved from the
 * declaration (never hardcoded here), ALWAYS with --restart so canonical
 * evidence can never ride on a checkpoint produced by an earlier, possibly
 * noncanonical run; the stale result artifact is removed before the run for
 * the same reason. Research stdout/stderr are captured to log files in the
 * work dir (env is never serialized — no credential leakage).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative as pathRelative, resolve as pathResolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRuntimeAuthority, REPO_ROOT } from './runtime-authority.mjs';
import { checkCanonicalCredential } from './integration-preflight.mjs';
import { sha256File } from '../lib/state.mjs';

/** The canonical P1 path executed by this project-owned runner (project-owned constant; the RUNTIME comes from the declaration). */
const RESEARCH_ENTRY_REL = 'research-orchestration/bin/research.mjs';
const DEFAULT_WORK_REL = 'work/canonical-research';

/** Pure-ish: parse the runner CLI. Positional words = research topic; --work overrides the run work dir. */
export function parseRunnerArgs(argv) {
  const words = [];
  let work = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--work') { work = argv[++i] ?? null; continue; }
    if (a.startsWith('--')) return { usageError: `unknown option: ${a}` };
    words.push(a);
  }
  return { topic: words.join(' ').trim(), work };
}

function workRelative(repoRoot, abs) {
  return pathRelative(repoRoot, abs).split(sep).join('/');
}

/**
 * Canonical gate core. Injectable (env / repoRoot / argv / spawnImpl) so the
 * whole non-network contract is offline-testable — same pattern as the
 * harness runCanonicalRunner spawnImpl injection.
 */
export function runCanonicalGate({
  authority = loadRuntimeAuthority(),
  env = process.env,
  repoRoot = REPO_ROOT,
  argv = process.argv.slice(2),
  spawnImpl,
} = {}) {
  const fail = (code, detail, exitCode = 1) => ({ ok: false, code, detail, exitCode });

  const parsed = parseRunnerArgs(argv);
  if (parsed.usageError) return fail('CANONICAL_RUNNER_USAGE', parsed.usageError, 2);
  if (!parsed.topic) return fail('CANONICAL_RUNNER_USAGE', 'missing research topic — the canonical gate requires an explicit topic', 2);

  // Gate 1 — mode: refuse anything that is not the canonical overlay. The
  // harness wholeWaveEnvFor sets exactly this key for canonical mode; nothing
  // else (no env boolean, no presence of smoke keys) authorizes execution.
  if (env[authority.env.runtimeMode] !== 'canonical') {
    return fail('CANONICAL_RUNNER_MODE_REFUSED', `${authority.env.runtimeMode} must be exactly 'canonical' — refusing to execute outside the canonical overlay (no fallback)`);
  }

  // Gate 2 — credential presence: reuse the preflight rule + machine code,
  // presence-only (the value is never read into this process's logic).
  const cred = checkCanonicalCredential(authority, env, repoRoot);
  if (cred.status !== 'PASS') {
    return fail('CANONICAL_CREDENTIAL_MISSING', cred.detail);
  }

  const workDir = pathResolve(repoRoot, parsed.work || DEFAULT_WORK_REL); // empty --work falls back to the default (never silently targets the repo root)
  const resultPath = join(workDir, 'research-result.json');
  // No silent checkpoint fallback: the canonical run always starts fresh and
  // the stale result artifact can never be mistaken for this run's output.
  rmSync(resultPath, { force: true });

  const spawn = spawnImpl ?? ((file, args, opts) => spawnSync(file, args, opts));
  const nodeBin = env[authority.env.nodeBin] || process.execPath || 'node';
  const researchEntry = pathResolve(repoRoot, RESEARCH_ENTRY_REL);
  const startedAt = new Date().toISOString();
  const r = spawn(
    nodeBin,
    [researchEntry, '--json', '--restart', '--runtime', authority.canonical.runtimeId, '--work', workDir, parsed.topic],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env },
  );
  const finishedAt = new Date().toISOString();
  // Capture execution logs next to the run artifacts (env is never serialized —
  // no credential leakage). Only actually-written logs may appear in evidence.
  const logs = {};
  try {
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'canonical-runner-stdout.log'), r.stdout ?? '');
    logs.stdout = 'canonical-runner-stdout.log';
  } catch { /* log capture must never mask the gate result */ }
  try {
    writeFileSync(join(workDir, 'canonical-runner-stderr.log'), r.stderr ?? '');
    logs.stderr = 'canonical-runner-stderr.log';
  } catch { /* log capture must never mask the gate result */ }
  if (r.error || (r.status ?? 1) !== 0) {
    const tail = String(r.stderr ?? r.error?.message ?? '').slice(-500);
    return fail('CANONICAL_RESEARCH_FAILED', `research entrypoint did not complete (exit ${r.status ?? 'n/a'})${tail ? `: ${tail}` : ''}`);
  }

  // Evidence binding — fail closed when the executed run cannot be bound.
  const statePath = join(workDir, 'orchestration-state.json');
  let runState = null;
  try {
    runState = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return fail('CANONICAL_EVIDENCE_INCOMPLETE', `run identity unreadable at ${workRelative(repoRoot, statePath)} — no unbound evidence is emitted`);
  }
  if (!runState || typeof runState.runId !== 'string' || runState.runId === '') {
    return fail('CANONICAL_EVIDENCE_INCOMPLETE', 'orchestration-state.json carries no runId — no unbound evidence is emitted');
  }
  if (runState.runtime !== authority.canonical.runtimeId) {
    return fail('CANONICAL_EVIDENCE_RUNTIME_DRIFT', `executed run identity carries runtime ${JSON.stringify(runState.runtime ?? null)}, declaration declares ${JSON.stringify(authority.canonical.runtimeId)} — refusing to emit evidence bound to a nondeclared runtime`);
  }
  if (!existsSync(resultPath)) {
    return fail('CANONICAL_EVIDENCE_INCOMPLETE', 'research-result.json absent after a successful research exit — no unbound evidence is emitted');
  }
  let result = null;
  try {
    result = JSON.parse(readFileSync(resultPath, 'utf8'));
  } catch {
    return fail('CANONICAL_EVIDENCE_INCOMPLETE', 'research-result.json is not valid JSON — no unbound evidence is emitted');
  }

  const evidence = {
    schema: 'canonical-runner-evidence/1',
    verdict: 'PASS',
    executionClass: 'CANONICAL',
    runtimeId: authority.canonical.runtimeId,
    model: authority.canonical.model,
    evidence: {
      entrypoint: RESEARCH_ENTRY_REL,
      runnerFile: authority.canonical.runner?.file ?? null,
      workDir: workRelative(repoRoot, workDir),
      run: { topic: runState.topic ?? null, mode: runState.mode ?? null, percent: runState.percent ?? null, runtime: runState.runtime },
      runId: runState.runId,
      researchExitCode: r.status,
      restarted: true,
      startedAt,
      finishedAt,
      artifacts: {
        resultFile: 'research-result.json',
        resultSha256: sha256File(resultPath),
        selectedQuestionUrl: result?.selectedQuestion?.url ?? null,
        verified: result?.verification?.valid === true,
      },
      logs,
    },
  };
  return { ok: true, evidence, exitCode: 0 };
}

function isMainModule() {
  try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; }
}
if (isMainModule()) {
  let r;
  try {
    r = runCanonicalGate({ argv: process.argv.slice(2) });
  } catch (e) {
    r = { ok: false, code: 'CANONICAL_RUNNER_ABORTED', detail: String(e?.message ?? e), exitCode: 1 };
  }
  if (r.ok) {
    console.log(JSON.stringify(r.evidence, null, 2));
    process.exit(0);
  }
  console.log(JSON.stringify({ schema: 'canonical-runner-evidence/1', verdict: 'FAILED', code: r.code, detail: r.detail ?? null }, null, 2));
  process.exit(r.exitCode ?? 1);
}
