#!/usr/bin/env node
/**
 * research-orchestration/bin/integration-preflight.mjs
 *
 * Generic execution-workflow preflight (round 2, F8 mode-aware). All
 * runtime/model/credential/env names come from the project declaration
 * (bin/runtime-authority.json) — no vendor or project names here (statically
 * enforced).
 *
 *   --mode offline (default): explicitly OFFLINE dry-run. Checks: local real
 *     artifacts (final stage) only. Runtime and dependencies intentionally
 *     NOT checked (documented non-check: the offline suite provably runs on a
 *     bare worktree).
 *
 *   --mode smoke: LOCAL_NONCANONICAL_SMOKE preflight. Checks: local runtime
 *     endpoint health, model served, context capacity, dependencies
 *     (missing = FAIL — the whole-wave gates need them), artifacts (final).
 *
 *   --mode canonical: CANONICAL_ACCEPTANCE preflight. Checks: runtime
 *     authority declaration valid, canonical credential PRESENT (env or
 *     declared 0600 file — presence only; the credential value is never read,
 *     printed or transmitted by preflight), dependencies, artifacts (final).
 *     NO endpoint probe and NO local-runtime probe happen here — canonical
 *     mode must not touch the noncanonical smoke runtime at all.
 *
 * Exit code: 0 = PREFLIGHT_PASS, 1 = PREFLIGHT_FAIL.
 */

import { existsSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadRuntimeAuthority, REPO_ROOT, RO_DIR } from './runtime-authority.mjs';

/** Pure classification: map a list of check results to a verdict. */
export function classifyPreflight(checks) {
  const failures = checks.filter((c) => c.status === 'FAIL');
  const warnings = checks.filter((c) => c.status === 'WARN');
  return {
    verdict: failures.length === 0 ? 'PREFLIGHT_PASS' : 'PREFLIGHT_FAIL',
    failures,
    warnings,
    failedCodes: failures.map((f) => f.code ?? f.check),
  };
}

/** Context-capacity rule (encodes the undersized-context incident of 2026-09-05). */
export function checkContextCapacity(model, servedContext, requiredMin) {
  if (!Number.isFinite(servedContext)) {
    return { check: 'runtime.context', status: 'FAIL', code: 'RUNTIME_CAPACITY_UNVERIFIABLE', detail: `served context unknown for ${model}` };
  }
  if (servedContext < requiredMin) {
    return { check: 'runtime.context', status: 'FAIL', code: 'RUNTIME_CONTEXT_INSUFFICIENT', detail: `model ${model} serves ${servedContext} < required ${requiredMin}` };
  }
  return { check: 'runtime.context', status: 'PASS', detail: `${model} serves ${servedContext} >= ${requiredMin}` };
}

/**
 * Dependency rule, mode-aware.
 * smoke + canonical: node_modules and the declared embedding dependency are
 *   REQUIRED (missing = FAIL — the whole-wave gates import them).
 * offline: not checked (returns null) — the offline suite provably runs
 *   without node_modules; a missing dep is not a false gate there.
 */
export function checkDependencies(mode, hasNodeModules, hasEmbeddingDep) {
  if (mode === 'offline') return null;
  if (!hasNodeModules) {
    return { check: 'deps', status: 'FAIL', code: 'DEPS_NODE_MODULES_MISSING', detail: 'research-orchestration/node_modules absent — whole-wave gates unqualified; install dependencies first' };
  }
  if (!hasEmbeddingDep) {
    return { check: 'deps', status: 'FAIL', code: 'DEPS_EMBEDDING_MISSING', detail: 'declared embedding dependency not resolvable — whole-wave embedding gate would fail' };
  }
  return { check: 'deps', status: 'PASS', detail: 'node_modules + embedding dependency present' };
}

/** Local real-artifact rule for the final wave. */
export function checkLocalArtifacts(paths) {
  const missing = paths.filter((p) => !p.exists);
  if (missing.length > 0) {
    return { check: 'artifacts', status: 'FAIL', code: 'ARTIFACTS_MISSING', detail: `missing: ${missing.map((m) => m.path).join(', ')}` };
  }
  return { check: 'artifacts', status: 'PASS', detail: `${paths.length} real artifact(s) resolved` };
}

async function jsonFetch(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function artifactsCheck(stage, authority) {
  if (stage !== 'final') return null;
  const base = pathResolve(process.env[authority.env.seamArtifactsDir] ?? pathResolve(REPO_ROOT, authority.artifacts.dir));
  const wanted = authority.artifacts.files.map((rel) => pathResolve(base, rel));
  return checkLocalArtifacts(wanted.map((path) => ({ path, exists: existsSync(path) })));
}

function depsCheck(mode, authority) {
  let hasNodeModules = false;
  let hasEmbeddingDep = false;
  try {
    const roRequire = createRequire(pathResolve(RO_DIR, 'package.json'));
    roRequire.resolve(authority.deps.embedding);
    hasEmbeddingDep = true;
    hasNodeModules = existsSync(pathResolve(RO_DIR, 'node_modules'));
  } catch {
    hasNodeModules = existsSync(pathResolve(RO_DIR, 'node_modules'));
    hasEmbeddingDep = false;
  }
  return checkDependencies(mode, hasNodeModules, hasEmbeddingDep);
}

/**
 * F8 canonical credential presence — fail closed WITHOUT using the
 * credential: declared env var non-empty OR declared 0600 file exists at the
 * repo root. The credential value is never read into memory by preflight.
 */
export function checkCanonicalCredential(authority, env = process.env, repoRoot = REPO_ROOT) {
  const envName = authority.canonical.credentialEnv;
  const fileRel = authority.canonical.credentialFile;
  const envPresent = typeof env[envName] === 'string' && env[envName].trim() !== '';
  const filePresent = fileRel ? existsSync(pathResolve(repoRoot, fileRel)) : false;
  if (!envPresent && !filePresent) {
    return { check: 'canonical.credential', status: 'FAIL', code: 'CANONICAL_CREDENTIAL_MISSING', detail: `${envName} not set and ${fileRel} not present — canonical acceptance fails closed (no fallback)` };
  }
  return { check: 'canonical.credential', status: 'PASS', detail: `canonical credential present (${envPresent ? 'env' : 'file'})` };
}

async function probeLive({ mode, authority, stage }) {
  const checks = [];
  const finalArtifacts = artifactsCheck(stage, authority);
  if (finalArtifacts) checks.push(finalArtifacts);
  if (mode === 'offline') {
    checks.push({ check: 'mode', status: 'PASS', detail: 'offline mode — runtime/dependencies intentionally not required (docs §C)' });
    return checks;
  }
  const deps = depsCheck(mode, authority);
  if (deps) checks.push(deps);
  if (mode === 'canonical') {
    // F8: presence-only credential check; NO endpoint probe, NO local-runtime probe.
    checks.push(checkCanonicalCredential(authority));
    checks.push({ check: 'canonical.mode', status: 'PASS', detail: `canonical runtime ${authority.canonical.runtimeId}/${authority.canonical.model} declared (reachability verified at run time by the runtime authority module, not by preflight)` });
    return checks;
  }
  // mode === 'smoke' — local noncanonical runtime, values from the declaration
  const baseUrl = process.env[authority.localSmoke.baseUrlEnv] ?? authority.localSmoke.baseUrlDefault;
  const model = process.env[authority.localSmoke.modelEnv] ?? authority.localSmoke.modelDefault;
  const minContext = Number(process.env[authority.env.minContext] ?? 32768);
  let models = null;
  try {
    const body = await jsonFetch(`${baseUrl}/models`, 5000);
    const ids = Array.isArray(body?.data) ? body.data.map((m) => m.id) : [];
    models = ids;
    checks.push(ids.includes(model)
      ? { check: 'runtime.model', status: 'PASS', detail: `${model} served` }
      : { check: 'runtime.model', status: 'FAIL', code: 'RUNTIME_MODEL_NOT_SERVED', detail: `${model} not in [${ids.join(', ')}]` });
  } catch (e) {
    checks.push({ check: 'runtime.endpoint', status: 'FAIL', code: 'RUNTIME_ENDPOINT_UNREACHABLE', detail: `${baseUrl}: ${e.message}` });
  }
  if (models) {
    let servedCtx = Number.NaN;
    try {
      const apiRoot = baseUrl.replace(/\/v1\/?$/, '');
      const body = await jsonFetch(`${apiRoot}/api/v0/models`, 5000);
      const entry = (Array.isArray(body?.data) ? body.data : []).find((m) => m?.id === model || m?.model === model);
      servedCtx = Number(entry?.max_context_length ?? entry?.context_length ?? Number.NaN);
    } catch { /* capacity API unavailable — handled by the rule below */ }
    checks.push(checkContextCapacity(model, servedCtx, minContext));
  }
  return checks;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}
if (isMainModule()) {
  const args = process.argv.slice(2);
  const stage = args.includes('--stage') ? args[args.indexOf('--stage') + 1] : 'intermediate';
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'offline';
  const jsonIdx = args.indexOf('--checks-json');
  if (jsonIdx !== -1) {
    const supplied = JSON.parse(args[jsonIdx + 1]);
    const verdict = classifyPreflight(supplied);
    console.log(JSON.stringify(verdict, null, 2));
    process.exit(verdict.verdict === 'PREFLIGHT_PASS' ? 0 : 1);
  } else {
    const authority = loadRuntimeAuthority();
    const checks = await probeLive({ mode, authority, stage });
    const verdict = classifyPreflight(checks);
    console.log(JSON.stringify({ mode, stage, ...verdict }, null, 2));
    process.exit(verdict.verdict === 'PREFLIGHT_PASS' ? 0 : 1);
  }
}
