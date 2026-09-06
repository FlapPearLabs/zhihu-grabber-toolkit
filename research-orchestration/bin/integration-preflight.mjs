#!/usr/bin/env node
/**
 * research-orchestration/bin/integration-preflight.mjs
 *
 * P1 execution-workflow repair (workflow efficiency audit 2026-09-06;
 * round 1 per PR #72 review — F4 mode-aware preflight):
 *
 *   --mode offline (default): an explicitly OFFLINE dry-run must NOT demand
 *     a runtime. Checks: local real artifacts (final stage) only. The
 *     @xenova/transformers dependency is deliberately NOT checked here
 *     because the offline suite is proven to run without node_modules
 *     (657/657 on a bare worktree); requiring it offline would be a false gate.
 *
 *   --mode live: required before LIVE acceptance. Checks: endpoint health,
 *     exact model served, context capacity sufficient, @xenova/transformers
 *     resolvable (missing = FAIL — the live embedding gate needs it), local
 *     real artifacts (final stage), env variables.
 *
 * Pure/offline: with --checks-json it classifies supplied check results
 * (used by tests). Exit code: 0 = PREFLIGHT_PASS, 1 = PREFLIGHT_FAIL.
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as pathResolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const REPO_ROOT = pathResolve(fileURLToPath(import.meta.url), '..', '..', '..'); // bin -> research-orchestration -> repo
const RO_DIR = pathResolve(REPO_ROOT, 'research-orchestration');

const DEFAULT_BASE_URL = process.env.P1_LMSTUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1';
const DEFAULT_MODEL = process.env.P1_LMSTUDIO_MODEL ?? 'qwen/qwen3-1.7b';
const DEFAULT_MIN_CONTEXT = Number(process.env.P1_MIN_CONTEXT ?? 32768);
const DEFAULT_DOGFOOD_ROOT = process.env.P1_REAL_DOGFOOD_ROOT ?? null;
const SEAM_ARTIFACTS_DIR = process.env.P1_SEAM_ARTIFACTS_DIR ?? pathResolve(REPO_ROOT, 'work', 'p1-wave-01-integration');

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

/** Context-capacity rule (encodes the 2026-09-05 8192-ctx incident). */
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
 * F4: dependency rule is MODE-AWARE.
 * live: node_modules and @xenova/transformers are REQUIRED (missing = FAIL —
 *       the live embedding gate imports them).
 * offline: not checked (returns null) — the offline suite provably runs
 *       without node_modules; a missing dep is not a false gate there.
 */
export function checkDependencies(mode, hasNodeModules, hasTransformers) {
  if (mode !== 'live') return null;
  if (!hasNodeModules) {
    return { check: 'deps', status: 'FAIL', code: 'DEPS_NODE_MODULES_MISSING', detail: 'research-orchestration/node_modules absent — live embedding path unqualified; run npm ci (unsandboxed) first' };
  }
  if (!hasTransformers) {
    return { check: 'deps', status: 'FAIL', code: 'DEPS_TRANSFORMERS_MISSING', detail: '@xenova/transformers not resolvable — live embedding gate would fail' };
  }
  return { check: 'deps', status: 'PASS', detail: 'node_modules + @xenova/transformers present' };
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

function artifactsCheck(stage) {
  if (stage !== 'final') return null;
  const wanted = [];
  if (DEFAULT_DOGFOOD_ROOT) wanted.push(pathResolve(DEFAULT_DOGFOOD_ROOT, 'multi-group-state.json'));
  for (const rel of ['seam-b-real.json', 'seam-c-real.json', 'seam-d-real.json']) {
    wanted.push(pathResolve(SEAM_ARTIFACTS_DIR, rel));
  }
  return checkLocalArtifacts(wanted.map((path) => ({ path, exists: existsSync(path) })));
}

async function probeLive({ mode, baseUrl, model, minContext, stage }) {
  const checks = [];
  const finalArtifacts = artifactsCheck(stage);
  if (finalArtifacts) checks.push(finalArtifacts);
  if (mode === 'offline') {
    // F4: an explicitly offline dry-run must not demand a runtime.
    // Documented non-check: @xenova/transformers (offline suite runs without node_modules).
    checks.push({ check: 'mode', status: 'PASS', detail: 'offline mode — runtime endpoint/dependencies intentionally not required (see docs §C)' });
    return checks;
  }
  // mode === 'live'
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
  let hasNodeModules = false;
  let hasTransformers = false;
  try {
    const roRequire = createRequire(pathResolve(RO_DIR, 'package.json'));
    roRequire.resolve('@xenova/transformers');
    hasTransformers = true;
    hasNodeModules = existsSync(pathResolve(RO_DIR, 'node_modules'));
  } catch {
    hasNodeModules = existsSync(pathResolve(RO_DIR, 'node_modules'));
    hasTransformers = false;
  }
  const deps = checkDependencies('live', hasNodeModules, hasTransformers);
  if (deps) checks.push(deps);
  return checks;
}

function isMainModule() {
  try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; }
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
    const checks = await probeLive({ mode, baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, minContext: DEFAULT_MIN_CONTEXT, stage });
    const verdict = classifyPreflight(checks);
    console.log(JSON.stringify({ baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, minContext: DEFAULT_MIN_CONTEXT, stage, mode, ...verdict }, null, 2));
    process.exit(verdict.verdict === 'PREFLIGHT_PASS' ? 0 : 1);
  }
}
