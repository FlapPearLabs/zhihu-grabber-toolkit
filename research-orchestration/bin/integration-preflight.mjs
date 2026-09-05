#!/usr/bin/env node
/**
 * research-orchestration/bin/integration-preflight.mjs
 *
 * P1 execution-workflow repair (workflow efficiency audit, 2026-09-06):
 * runtime/environment preflight that must PASS before any live integration
 * test runs. Purpose: classify environment problems BEFORE expensive product
 * suites (forensic root cause RC2 — the 8192-context LM Studio incident was
 * discovered via a failed product gate instead of a preflight check).
 *
 * Pure/offline by default: with --checks-json it classifies supplied check
 * results (used by tests); without it, it probes the real environment.
 * No product semantics; fails closed on unverifiable capacity.
 *
 * Usage:
 *   node bin/integration-preflight.mjs                          # live probe, JSON to stdout
 *   node bin/integration-preflight.mjs --checks-json '<json>'    # classify supplied results
 *   node bin/integration-preflight.mjs --stage final             # also require local real artifacts
 *
 * Exit code: 0 = PREFLIGHT_PASS, 1 = PREFLIGHT_FAIL.
 */

import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as pathResolve } from 'node:path';

const REPO_ROOT = pathResolve(fileURLToPath(import.meta.url), '..', '..', '..'); // bin -> research-orchestration -> repo

const DEFAULT_BASE_URL = process.env.P1_LMSTUDIO_BASE_URL ?? 'http://127.0.0.1:1234/v1';
const DEFAULT_MODEL = process.env.P1_LMSTUDIO_MODEL ?? 'qwen/qwen3-1.7b';
const DEFAULT_MIN_CONTEXT = Number(process.env.P1_MIN_CONTEXT ?? 32768);
const DEFAULT_DOGFOOD_ROOT = process.env.P1_REAL_DOGFOOD_ROOT ?? null;
const SEAM_ARTIFACTS_DIR = process.env.P1_SEAM_ARTIFACTS_DIR ?? pathResolve(REPO_ROOT, 'work', 'p1-wave-01-integration');

/**
 * Pure classification: map a list of check results to a verdict.
 * @param {{check:string, status:'PASS'|'FAIL'|'WARN', code?:string, detail?:string}[]} checks
 */
export function classifyPreflight(checks) {
  const failures = checks.filter((c) => c.status === 'FAIL');
  const warnings = checks.filter((c) => c.status === 'WARN');
  return {
    verdict: failures.length === 0 ? 'PREFLIGHT_PASS' : 'PREFLIGHT_FAIL',
    failures,
    warnings,
    // Machine-readable summary for the execution ledger.
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

/** Dependency rule: live embedding path needs node_modules with @xenova/transformers. */
export function checkDependencies(hasNodeModules, hasTransformers) {
  if (!hasNodeModules) {
    return { check: 'deps', status: 'FAIL', code: 'DEPS_NODE_MODULES_MISSING', detail: 'research-orchestration/node_modules absent (offline suites fine; live embedding path not qualified)' };
  }
  if (!hasTransformers) {
    return { check: 'deps', status: 'WARN', code: 'DEPS_TRANSFORMERS_MISSING', detail: '@xenova/transformers not resolvable — embedding provider live path unqualified' };
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

async function probeLive({ baseUrl, model, minContext, stage }) {
  const checks = [];
  // 1. endpoint health + model presence
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
  // 2. context capacity via LM Studio /api/v0/models (REST) when reachable
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
  // 3. embedding runtime qualification
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    req.resolve('@xenova/transformers');
    checks.push({ check: 'deps', status: 'PASS', detail: '@xenova/transformers resolvable' });
  } catch {
    checks.push({ check: 'deps', status: 'WARN', code: 'DEPS_TRANSFORMERS_MISSING', detail: '@xenova/transformers not resolvable — live embedding gate would fail; run npm ci (unsandboxed) first' });
  }
  // 4. local real artifacts (final stage)
  if (stage === 'final') {
    const { existsSync } = await import('node:fs');
    const wanted = [];
    if (DEFAULT_DOGFOOD_ROOT) wanted.push(pathResolve(DEFAULT_DOGFOOD_ROOT, 'multi-group-state.json'));
    for (const rel of ['seam-b-real.json', 'seam-c-real.json', 'seam-d-real.json']) {
      wanted.push(pathResolve(SEAM_ARTIFACTS_DIR, rel));
    }
    checks.push(checkLocalArtifacts(wanted.map((path) => ({ path, exists: existsSync(path) }))));
  }
  return checks;
}

function isMainModule() {
  try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; }
}
if (isMainModule()) {
  const args = process.argv.slice(2);
  const stage = args.includes('--stage') ? args[args.indexOf('--stage') + 1] : 'intermediate';
  const jsonIdx = args.indexOf('--checks-json');
  if (jsonIdx !== -1) {
    const supplied = JSON.parse(args[jsonIdx + 1]);
    const verdict = classifyPreflight(supplied);
    console.log(JSON.stringify(verdict, null, 2));
    process.exit(verdict.verdict === 'PREFLIGHT_PASS' ? 0 : 1);
  } else {
    const checks = await probeLive({ baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, minContext: DEFAULT_MIN_CONTEXT, stage });
    const verdict = classifyPreflight(checks);
    console.log(JSON.stringify({ baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, minContext: DEFAULT_MIN_CONTEXT, stage, ...verdict }, null, 2));
    process.exit(verdict.verdict === 'PREFLIGHT_PASS' ? 0 : 1);
  }
}
