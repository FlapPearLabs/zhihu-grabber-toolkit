// SPDX-License-Identifier: AGPL-3.0-only
/**
 * lib/p1-runtime-composer.mjs
 *
 * P1-T15 POST-MERGE REPAIR (Issue #47): runtime composition wiring.
 *
 * This module is the PRODUCTION RUNTIME COMPOSER: the single composition-
 * layer entrypoint that drives the frozen P1 composition owner
 * (lib/coverage-final-integration.mjs) through its canonical single-pass
 * stage order and binds the result for the product render/result seam:
 *
 *   persisted Research Plan (planner, plan-contract)
 *     → provider seam (official zhihu_search + global_search adapters)
 *     → beginResearchCoverageLedger
 *     → runRetrievalFeedbackLoop        (T06/T07; multi-query × multi-provider)
 *     → applySourceGroupSelection       (T08; clarification is a structured stop)
 *     → executeSelectedGroups           (T09; capture → verify → handoff, resume-aware)
 *     → dense embeddings (T11; local provider, fail-closed when unavailable)
 *     → selectResearchCorpusWithCoverage (T12; RCE)
 *     → analyzeSelectedCorpus           (T13; single analyzed-set write path)
 *     → produceSynthesisWithCoverage    (T14; pre-synthesis guard)
 *     → finalizeResearchCoverage        (T15; second independent defense)
 *     → coverage-final.json + state.p1FinalCoveragePlanHash binding
 *     → research-result.json (disclosure + verification, honest partial/failure)
 *
 * Hard rules preserved (never weakened here):
 *   - NO algorithm is implemented here: every stage is an existing frozen
 *     component joined at its published seam.
 *   - NO_SILENT_RUNTIME_FALLBACK: the composition runs ONLY on the approved
 *     canonical runtime identity; any other identity fails closed. A failure
 *     NEVER falls back to the v0.3 single-question path or to any local smoke
 *     runtime.
 *   - NO_SILENT_PROVIDER_FALLBACK: the provider seam refuses substitution.
 *   - PARTIAL != COMPLETE: a partial corpus/state produces a failure outcome
 *     with a truthful disclosure; the render binding is written ONLY on a
 *     successful full-coverage compose.
 *   - state.p1FinalCoveragePlanHash is written ONLY by this composer, ONLY on
 *     success, and ONLY to the exact planHash of the executed plan (run-bound
 *     render seam contract, docs/project-memory.md).
 *   - The global_search transport is a SYNC IO bridge (T05 seam synchrony —
 *     async HTTP bridging is the composition layer's concern, per the adapter
 *     header contract). The bridge child process resolves the access secret
 *     itself (env/file, never argv, never logged) and prints only
 *     { status, body }; credentials never enter the composer, the seam, or
 *     the adapter.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  beginResearchCoverageLedger,
  runRetrievalFeedbackLoop,
  applySourceGroupSelection,
  executeSelectedGroups,
  selectResearchCorpusWithCoverage,
  analyzeSelectedCorpus,
  produceSynthesisWithCoverage,
  buildFinalDisclosure,
  finalizeResearchCoverage,
  P1_PIPELINE_IDENTITY,
  COVERAGE_STATE_FILENAME,
  FINAL_COVERAGE_FILENAME,
  CoverageIntegrationError,
} from './coverage-final-integration.mjs';
import { DECISION_PROVIDER_FAILURE } from './retrieval-round-controller.mjs';
import { SELECTION_DECISION_FILENAME } from './source-group-selection.mjs';
import { CAPABILITY_SEARCH, createProviderSeam } from './provider-seam.mjs';
import { createOfficialSearchAdapter } from './official-search-provider.mjs';
import { createGlobalSearchAdapter } from './global-search-provider.mjs';
import { createSessionCaptureAdapter } from './session-capture-provider.mjs';
import { defaultRunner } from './runner.mjs';
import { proposeResearchPlan } from './planner.mjs';
import { loadPlan, persistPlan, PLAN_ARTIFACT_FILENAME } from './plan-contract.mjs';
import {
  makeState,
  readState,
  writeState,
  appendEvent,
  runIdentityHash,
  sha256File,
  STAGE_SEARCH,
  STAGE_SELECT,
  STAGE_CAPTURE,
  STAGE_ANALYZE,
  STAGE_RENDER,
  STAGE_COMPLETE,
  STAGE_FAILED,
} from './state.mjs';
import { createEmbeddingProvider } from './embedding-provider.mjs';
import { REQUIRED_EMBEDDING_IDENTITY } from './dense-geometry.mjs';
import { deriveCanonicalSourceId } from './rce-input-adapter.mjs';
import { assertArtifactSafe } from './rrf.mjs';
import { buildDeepSeekResearchRuntime } from './deepseek-research-runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RO_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(RO_ROOT, '..');

/** Pinned canonical composition identity (planner-pinned twin; T14 accepts exactly this). */
const CANONICAL_RUNTIME_ID = 'deepseek-api-tool-less';
// OWNER RULING 2026-09-10: authorized request model id (served naming is
// observability only — never an equality gate).
const CANONICAL_MODEL = 'deepseek-v4-pro';

/** T03-documented first-party global_search endpoint (read-only search). */
const GLOBAL_SEARCH_ENDPOINT = 'https://developer.zhihu.com/api/v1/content/global_search';

/** Work-relative artifact names produced/consumed by the composer. */
const PER_GROUP_CLAIMS_FILENAME = 'per-group-claims.json';
const SYNTHESIS_FILENAME = 'cross-source-synthesis.json';
const RESEARCH_RESULT_FILENAME = 'research-result.json';

export const P1_RESULT_TYPE = 'p1-research-result';

/** Composer-level stable failure identities (composition-layer; stage codes pass through). */
const CFC_TOPIC_INVALID = 'user_request_invalid';
const CFC_RUN_IDENTITY_CONFLICT = 'run_identity_conflict';
const CFC_FAILED_STATE_REQUIRES_RESTART = 'failed_state_requires_restart';
const CFC_STATE_INVALID = 'state_invalid';
const CFC_RUNTIME_NOT_SUPPORTED = 'runtime_not_supported';
const CFC_PLANNER_FAILED = 'planner_failed';
const CFC_RETRIEVAL_FAILED = 'retrieval_failed';
const CFC_SELECTION_FAILED = 'selection_failed';
const CFC_GROUP_EXECUTION_FAILED = 'group_execution_failed';
const CFC_DENSE_LAYER_UNAVAILABLE = 'dense_layer_unavailable';
const CFC_ANALYSIS_FAILED = 'analysis_failed';
const CFC_SYNTHESIS_FAILED = 'synthesis_failed';
const CFC_INCOMPLETE_ANALYSIS = 'incomplete_analysis';
const CFC_ABORTED = 'p1_compose_aborted';
const CFC_CLARIFICATION_REQUIRED = 'clarification_required';

// ---------------------------------------------------------------------------
// global_search sync transport bridge (composition layer's IO concern)
// ---------------------------------------------------------------------------

/**
 * The bridge child resolves the access secret ITSELF (ZHIHU_SECRET env, then
 * the git-ignored zhihu_secret.txt at cwd/repo root — the same resolution the
 * grabber preflight exposes) and never prints it. Only { url, query, count }
 * cross the stdin boundary; the parent receives only { status, body }.
 */
const GLOBAL_SEARCH_BRIDGE_SCRIPT = `
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const finish = (payload, code = 0) => { process.stdout.write(JSON.stringify(payload)); process.exit(code); };
  let req = null;
  try { req = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { finish({ status: 0, body: '' }, 1); }
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  let key = (process.env.ZHIHU_SECRET ?? '').trim();
  if (!key) {
    for (const dir of Array.isArray(req.secretDirs) ? req.secretDirs : []) {
      try {
        const raw = fs.readFileSync(pathMod.join(String(dir), 'zhihu_secret.txt'), 'utf8').trim();
        if (raw) { key = raw; break; }
      } catch { /* try next location */ }
    }
  }
  if (!key) finish({ status: 0, body: '' }, 1);
  try {
    const url = new URL(String(req.url));
    url.searchParams.set('Query', String(req.query));
    url.searchParams.set('Count', String(req.count));
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + key,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    });
    const body = await res.text();
    finish({ status: res.status, body });
  } catch { finish({ status: 0, body: '' }, 0); }
});
`;

/**
 * Build the production global_search transport: a SYNC IO boundary that runs
 * the authenticated GET through a short-lived node child (async HTTP bridged
 * synchronously; no new dependencies). Throws on transport failure — the
 * adapter maps that to its neutral PROVIDER_TRANSPORT_FAILURE identity.
 */
export function createSyncGlobalSearchTransport({ timeoutMs = 30_000 } = {}) {
  return function transport({ query, count }) {
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', GLOBAL_SEARCH_BRIDGE_SCRIPT], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      input: JSON.stringify({ url: GLOBAL_SEARCH_ENDPOINT, query, count, secretDirs: [process.cwd(), REPO_ROOT] }),
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (res.error || res.status !== 0 || typeof res.stdout !== 'string') {
      throw new Error(`global_search transport failed (exit ${res.status ?? 'n/a'})`);
    }
    const out = JSON.parse(res.stdout);
    if (typeof out?.status !== 'number' || typeof out?.body !== 'string') {
      throw new Error('global_search transport returned a malformed bridge payload');
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// embedding computation (T11 dense geometry; exact seam-B recipe contract)
// ---------------------------------------------------------------------------

async function computeEmbeddings({ manifest, workDir, provider, fail }) {
  const texts = [];
  const slots = []; // { kind: 'source' | 'target', key } — parallel to texts
  for (const g of manifest.groups) {
    const answersAbs = path.join(workDir, g.answersRel);
    if (!existsSync(answersAbs)) fail(CFC_GROUP_EXECUTION_FAILED, `missing verified artifact ${g.answersRel}`);
    const actual = sha256File(answersAbs);
    if (actual !== g.answersHash) fail(CFC_GROUP_EXECUTION_FAILED, `answersHash mismatch for ${g.answersRel}`);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(answersAbs, 'utf8'));
    } catch {
      fail(CFC_GROUP_EXECUTION_FAILED, `verified artifact unreadable for group ${g.groupId}`);
    }
    for (const entry of parsed.answers ?? []) {
      slots.push({ kind: 'source', key: deriveCanonicalSourceId(g.groupId, entry.id) });
      texts.push(String(entry.excerpt ?? ''));
    }
    const targetText = String(parsed.questionTitle ?? '');
    if (targetText.length === 0) fail(CFC_GROUP_EXECUTION_FAILED, `no questionTitle for group ${g.groupId}`);
    slots.push({ kind: 'target', key: g.groupId });
    texts.push(targetText);
  }

  const pre = await provider.preflight();
  if (!pre.ok) fail(CFC_DENSE_LAYER_UNAVAILABLE, `embedding provider preflight failed (${pre.failureCode ?? 'unknown'})`);
  let vectors;
  try {
    ({ vectors } = await provider.embed(texts));
  } catch {
    fail(CFC_DENSE_LAYER_UNAVAILABLE, 'embedding computation failed');
  }
  const embeddingsBySourceId = {};
  const targetEmbeddingByGroupId = {};
  vectors.forEach((vector, i) => {
    const slot = slots[i];
    const entry = { vector, identity: { ...REQUIRED_EMBEDDING_IDENTITY } };
    if (slot.kind === 'source') embeddingsBySourceId[slot.key] = entry;
    else targetEmbeddingByGroupId[slot.key] = entry;
  });
  for (const slot of slots) {
    if (slot.kind === 'source' && !embeddingsBySourceId[slot.key]) fail(CFC_DENSE_LAYER_UNAVAILABLE, `missing source vector for ${slot.key}`);
    if (slot.kind === 'target' && !targetEmbeddingByGroupId[slot.key]) fail(CFC_DENSE_LAYER_UNAVAILABLE, `missing target vector for ${slot.key}`);
  }
  return { embeddingsBySourceId, targetEmbeddingByGroupId, sourceCount: slots.filter((s) => s.kind === 'source').length };
}

// ---------------------------------------------------------------------------
// the composer
// ---------------------------------------------------------------------------

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function sanitizeMessage(message) {
  return String(message ?? '').slice(0, 300);
}

/**
 * Drive the complete P1 Cross-Question Deep Research composition.
 *
 * Returns (never throws for expected outcomes):
 *   { ok: true,  result, runId, planHash, reused?: true }
 *   { ok: false, code, details?, clarificationRequired?, options?, partialDisclosure? }
 */
export async function composeP1Research({
  topic,
  workDir,
  plan: injectedPlan = null,
  runtime = null,
  seam = null,
  captureAdapter = null,
  runner = null,
  embeddingProvider = null,
  fetchImpl = fetch,
  config = undefined,
  usageSink = null,
  restart = false,
} = {}) {
  const fail = (code, details = null, extra = {}) => ({ ok: false, code, details: details ? sanitizeMessage(details) : null, ...extra });

  // 0. input validation (USER_REQUEST class — normal validation, §10.1).
  if (!isNonEmptyString(topic) || topic.trim().length > 2000) {
    return fail(CFC_TOPIC_INVALID, 'topic must be a non-empty string of at most 2000 characters');
  }
  if (!isNonEmptyString(workDir)) {
    return fail(CFC_ABORTED, 'workDir is required');
  }
  const normalizedTopic = topic.trim();

  // Runtime pin: the composition chain (planner/T13/T14) accepts ONLY the
  // approved canonical runtime identity — anything else fails closed.
  const effectiveRuntime = runtime ?? buildDeepSeekResearchRuntime({ fetchImpl });
  if (effectiveRuntime.runtimeId !== CANONICAL_RUNTIME_ID || effectiveRuntime.model !== CANONICAL_MODEL) {
    return fail(CFC_RUNTIME_NOT_SUPPORTED, `P1 composition accepts only ${CANONICAL_RUNTIME_ID}/${CANONICAL_MODEL} — refusing ${String(effectiveRuntime.runtimeId ?? 'unknown')}`);
  }

  const mode = P1_PIPELINE_IDENTITY;
  const runId = runIdentityHash({ topic: normalizedTopic, mode, percent: null, runtime: effectiveRuntime.runtimeId });

  // 1. State bootstrap / resume classification (checkpoint identity validated —
  //    FILE EXISTS != VALID CACHE). restart discards any prior checkpoint and
  //    starts fresh (the canonical runner always passes --restart so canonical
  //    evidence can never ride on a checkpoint from an earlier, possibly
  //    noncanonical run).
  const existing = restart ? null : readState(workDir);
  if (existing) {
    if (existing.runId !== runId) {
      return fail(CFC_RUN_IDENTITY_CONFLICT, 'existing state belongs to a different run identity (topic/mode/runtime)');
    }
    if (existing.stage === STAGE_COMPLETE) {
      if (existing.p1FinalCoveragePlanHash == null) {
        return fail(CFC_STATE_INVALID, 'state says COMPLETE but carries no P1 render binding');
      }
      const resultPath = path.join(workDir, RESEARCH_RESULT_FILENAME);
      const coveragePath = path.join(workDir, FINAL_COVERAGE_FILENAME);
      // FILE EXISTS != VALID CACHE: a completed checkpoint is reused ONLY when
      // the recorded artifact hashes still bind to the exact bytes on disk.
      const recorded = existing.hashes ?? {};
      let hashesValid = false;
      try {
        hashesValid = existsSync(resultPath) && existsSync(coveragePath)
          && recorded.researchResult === sha256File(resultPath)
          && recorded.coverageFinal === sha256File(coveragePath);
      } catch { hashesValid = false; }
      if (!hashesValid) {
        return fail(CFC_STATE_INVALID, 'completed checkpoint artifacts no longer match the recorded hashes (stale/tampered — not reusable)');
      }
      try {
        const result = JSON.parse(readFileSync(resultPath, 'utf8'));
        return { ok: true, reused: true, result, runId, planHash: existing.p1FinalCoveragePlanHash };
      } catch {
        return fail(CFC_STATE_INVALID, 'research result artifact unreadable');
      }
    }
    if (existing.stage === STAGE_FAILED) {
      return fail(CFC_FAILED_STATE_REQUIRES_RESTART, 'previous run failed — restart required (state.stage=FAILED)');
    }
    // else: resume — plan reuse below keeps the run deterministic where reuse
    // is legal (Spec §4.3), and the T09 resume authority reuses still-valid groups.
  }

  const state = makeState({ workDir, topic: normalizedTopic, mode, percent: null, runtime: effectiveRuntime.runtimeId });
  state.stage = STAGE_SEARCH;
  writeState(workDir, state);
  appendEvent(workDir, { event: 'p1_compose_begin', runId, mode, runtime: effectiveRuntime.runtimeId });

  const persistFailure = (code, details = null, extra = {}) => {
    state.stage = STAGE_FAILED;
    state.p1FinalCoveragePlanHash = null;
    writeState(workDir, state);
    appendEvent(workDir, { event: 'p1_compose_failed', code });
    return fail(code, details, extra);
  };

  try {
    // 2. Research Plan (injected for tests; production: reuse a valid persisted
    //    plan, else propose through the pinned planner — never both). The
    //    injected plan is persisted through the same validate-then-write
    //    contract so the plan artifact always exists for identity binding.
    let plan = injectedPlan;
    let expectedPlanHash = null;
    if (plan) {
      const persisted = persistPlan(workDir, plan);
      if (!persisted.ok) {
        return persistFailure(CFC_PLANNER_FAILED, persisted.reason ?? 'plan_invalid');
      }
      expectedPlanHash = persisted.planHash;
    } else {
      const loaded = loadPlan(workDir);
      if (loaded.ok) {
        plan = loaded.plan;
        expectedPlanHash = loaded.planHash;
        appendEvent(workDir, { event: 'plan_reused', planHash: expectedPlanHash });
      } else {
        const proposed = await proposeResearchPlan({ userRequest: normalizedTopic, workDir, fetchImpl, usageSink });
        if (!proposed.ok) {
          return persistFailure(CFC_PLANNER_FAILED, proposed.details ?? proposed.reason, { plannerReason: proposed.reason ?? null });
        }
        plan = proposed.plan;
        expectedPlanHash = proposed.planHash;
      }
    }

    // 3. Provider seam (official zhihu_search + global_search — NO substitution).
    const effectiveRunner = runner ?? defaultRunner();
    const effectiveSeam = seam ?? createProviderSeam({
      adapters: [
        createOfficialSearchAdapter({ runner: effectiveRunner }),
        createGlobalSearchAdapter({ transport: createSyncGlobalSearchTransport() }),
      ],
    });
    const plannedRoutes = effectiveSeam.listProviders()
      .filter((p) => p.capability === CAPABILITY_SEARCH)
      .map((p) => ({ providerId: p.providerId, capability: p.capability }));

    // 4. Stage chain — the frozen composition owner, canonical single-pass order.
    const started = beginResearchCoverageLedger({ plan, planHash: expectedPlanHash, workDir, plannedRoutes });
    let coverageState = started.coverageState;
    const { journal } = started;

    state.stage = STAGE_SEARCH;
    writeState(workDir, state);

    const loop = runRetrievalFeedbackLoop({
      coverageState, plan, planHash: expectedPlanHash, workDir,
      seam: effectiveSeam,
      // Explicit deterministic routes: every registered search channel, in
      // registry order — the same list recorded as plannedRoutes in the ledger.
      channels: plannedRoutes.map((r) => ({ providerId: r.providerId })),
      config, journal,
    });
    if (loop.pool === null || loop.decision === DECISION_PROVIDER_FAILURE) {
      return persistFailure(CFC_RETRIEVAL_FAILED, `retrieval ended without a candidate pool (decision=${String(loop.decision)}, stopReason=${String(loop.stopReason)})`);
    }
    coverageState = loop.coverageState;

    state.stage = STAGE_SELECT;
    writeState(workDir, state);

    const selection = applySourceGroupSelection({ coverageState, pool: loop.pool, plan, workDir, journal });
    if (selection.clarificationRequired) {
      appendEvent(workDir, {
        event: 'clarification_required', stage: STAGE_SELECT,
        options: (selection.decision?.clarification?.options ?? []).map((o) => o.questionId),
      });
      appendEvent(workDir, { event: 'stop', reason: 'clarification_required' });
      return fail(CFC_CLARIFICATION_REQUIRED, null, {
        clarificationRequired: true,
        options: (selection.decision?.clarification?.options ?? []).map((o) => o.questionId),
      });
    }
    if (!selection.ok) {
      return persistFailure(CFC_SELECTION_FAILED, selection.code, { selectionReason: selection.code ?? null });
    }
    coverageState = selection.coverageState;

    state.stage = STAGE_CAPTURE;
    writeState(workDir, state);

    const execution = executeSelectedGroups({
      coverageState, decision: selection.decision, planHash: expectedPlanHash, workDir,
      captureAdapter: captureAdapter ?? createSessionCaptureAdapter({ runner: effectiveRunner }),
      runner: effectiveRunner, journal,
    });
    coverageState = execution.coverageState;

    state.stage = STAGE_ANALYZE;
    writeState(workDir, state);

    // 5. Dense geometry (T11) — fail-closed when the local provider is unavailable.
    const embeddings = await computeEmbeddings({
      manifest: execution.manifest, workDir,
      provider: embeddingProvider ?? createEmbeddingProvider({
        modelDir: process.env.P1_T10_ONNX_MODEL_DIR ?? path.join(RO_ROOT, 'models-bge-base-zh-v1.5'),
      }),
      fail: (code, details) => { throw new CoverageIntegrationError(code, details ?? code); },
    });

    const corpus = selectResearchCorpusWithCoverage({
      coverageState, manifest: execution.manifest, workDir,
      embeddingsBySourceId: embeddings.embeddingsBySourceId,
      targetEmbeddingByGroupId: embeddings.targetEmbeddingByGroupId,
      journal,
    });
    coverageState = corpus.coverageState;

    const analysis = await analyzeSelectedCorpus({
      coverageState, corpusArtifact: corpus.corpusArtifact, manifest: execution.manifest,
      planHash: expectedPlanHash, runtime: effectiveRuntime, workDir, journal,
    });
    coverageState = analysis.coverageState;
    writeArtifact(workDir, PER_GROUP_CLAIMS_FILENAME, analysis.seamCArtifact);

    const synthesis = produceSynthesisWithCoverage({
      coverageState, seamCArtifact: analysis.seamCArtifact, runtime: effectiveRuntime, workDir, journal,
    });
    coverageState = synthesis.coverageState;
    writeArtifact(workDir, SYNTHESIS_FILENAME, synthesis.synthesisArtifact);

    state.stage = STAGE_RENDER;
    writeState(workDir, state);

    // 6. FINAL reconciliation (T15; second independent defense) — 100% ONLY via
    //    mechanical set equality; partial refuses completion.
    const fin = finalizeResearchCoverage({
      coverageState, synthesisArtifact: synthesis.synthesisArtifact, workDir, journal,
      requireFullCoverage: true,
      runtimeIdentity: { runtimeId: effectiveRuntime.runtimeId, model: effectiveRuntime.model },
      synthesisArtifactRef: SYNTHESIS_FILENAME,
    });
    if (!fin.ok) {
      const result = {
        schemaVersion: 1,
        type: P1_RESULT_TYPE,
        ok: false,
        topic: normalizedTopic,
        mode,
        runId,
        planHash: expectedPlanHash,
        runtime: { runtimeId: effectiveRuntime.runtimeId, model: effectiveRuntime.model },
        disclosure: fin.partialDisclosure,
        verification: { valid: false, basis: { t15FinalReconciliation: 'REFUSED_INCOMPLETE' } },
        error: { code: CFC_INCOMPLETE_ANALYSIS, message: 'P1 analysis coverage is not 100% — partial state is never complete' },
      };
      writeResult(workDir, result);
      return persistFailure(CFC_INCOMPLETE_ANALYSIS, 'analysis coverage is not 100%', { partialDisclosure: fin.partialDisclosure });
    }

    // 7. Result artifact + render binding (written ONLY here, ONLY on success).
    const groups = Object.values(execution.multiGroupState.groups);
    const verifiedCount = groups.filter((g) => g.handoffValid === true).length;
    const result = {
      schemaVersion: 1,
      type: P1_RESULT_TYPE,
      ok: true,
      topic: normalizedTopic,
      mode,
      runId,
      planHash: expectedPlanHash,
      runtime: { runtimeId: effectiveRuntime.runtimeId, model: effectiveRuntime.model },
      disclosure: buildFinalDisclosure({ artifact: fin.artifact }),
      verification: {
        valid: true,
        basis: {
          t14PreSynthesisGuard: 'PASS',
          t15FinalReconciliation: 'PASS',
          groupsVerified: `${verifiedCount}/${groups.length}`,
          analysisCoverage: {
            selectedCount: fin.artifact.coverage.analysisCoverage.selectedCount,
            mappedCount: fin.artifact.coverage.analysisCoverage.mappedCount,
            analyzedCount: fin.artifact.coverage.analysisCoverage.analyzedCount,
          },
        },
      },
      artifacts: {
        researchPlan: PLAN_ARTIFACT_FILENAME,
        selectionDecision: SELECTION_DECISION_FILENAME,
        coverageState: COVERAGE_STATE_FILENAME,
        coverageFinal: FINAL_COVERAGE_FILENAME,
        perGroupClaims: PER_GROUP_CLAIMS_FILENAME,
        synthesis: SYNTHESIS_FILENAME,
        researchResult: RESEARCH_RESULT_FILENAME,
      },
      ...(Array.isArray(usageSink) ? { usage: usageSink } : {}),
    };
    writeResult(workDir, result);

    state.stage = STAGE_COMPLETE;
    state.completedStages = [STAGE_SEARCH, STAGE_SELECT, STAGE_CAPTURE, STAGE_ANALYZE, STAGE_RENDER];
    state.p1FinalCoveragePlanHash = expectedPlanHash;
    state.artifacts = { ...result.artifacts };
    state.hashes = {
      researchPlan: sha256File(path.join(workDir, PLAN_ARTIFACT_FILENAME)),
      coverageFinal: sha256File(path.join(workDir, FINAL_COVERAGE_FILENAME)),
      researchResult: sha256File(path.join(workDir, RESEARCH_RESULT_FILENAME)),
    };
    state.coverage = {
      is100PercentAnalysis: fin.artifact.assertion.is100PercentAnalysis,
      selectedCount: fin.artifact.coverage.analysisCoverage.selectedCount,
      analyzedCount: fin.artifact.coverage.analysisCoverage.analyzedCount,
    };
    writeState(workDir, state);
    appendEvent(workDir, { event: 'p1_compose_complete', planHash: expectedPlanHash, runId });

    return { ok: true, result, runId, planHash: expectedPlanHash };
  } catch (error) {
    if (error instanceof CoverageIntegrationError) {
      return persistFailure(error.code, error.message);
    }
    return persistFailure(CFC_ABORTED, error?.message ?? String(error));
  }
}

function writeArtifact(workDir, filename, value) {
  const safety = assertArtifactSafe(value);
  if (!safety.ok) {
    throw new CoverageIntegrationError(CFC_ABORTED, `artifact ${filename} failed the safety walk: ${safety.reason}`);
  }
  writeFileSync(path.join(workDir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function writeResult(workDir, result) {
  const safety = assertArtifactSafe(result);
  if (!safety.ok) {
    throw new CoverageIntegrationError(CFC_ABORTED, `research result failed the safety walk: ${safety.reason}`);
  }
  writeFileSync(path.join(workDir, RESEARCH_RESULT_FILENAME), `${JSON.stringify(result, null, 2)}\n`);
}
