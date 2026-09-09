// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/coverage-final-integration.mjs
 *
 * P1-T15 — Final coverage integration owner (Issue #47; Spec §1 / §9.3 / §15,
 * SEAM D consumer, docs/planning/P1_SEAM_CONTRACTS_V1.md SEAM D invariant 6).
 *
 * This module is the ONLY runtime composition owner of the complete P1
 * Cross-Question Deep Research path:
 *
 *   persisted Research Plan
 *     → multi-query retrieval rounds (T06 primitives, injected provider seam)
 *     → CoverageState update + saturation/budget/provider-failure decision
 *     → source-group selection / ambiguity (T08)
 *     → multi-group execution (T09)
 *     → dense geometry + RCE corpus selection (T11/T12)
 *     → per-group analysis / claims (T13)
 *     → cross-group aggregation / synthesis (T14, pre-synthesis guard)
 *     → FINAL coverage reconciliation (T15, second independent defense)
 *     → final disclosure / render / observability (v0.3 conventions)
 *
 * Hard contracts (never weakened here):
 *   - T13 is the SINGLE writer of the analyzed source-set identity. This module
 *     CONSUMES the T13 hook result returned by runPerGroupAnalysis; it never
 *     recomputes or second-writes it. (The deliberate absence of the T13 hook
 *     import in this file is mechanical, test-pinned: test H8.)
 *   - T15 = compare / assert / disclose ONLY (SEAM D invariant 6). The 100%
 *     analysis assertion comes exclusively from the frozen
 *     reconcileFinalCoverage mechanical set equality; never from the T14 guard
 *     PASS, never from mode naming, never from counts/saturation/synthesis
 *     success. PARTIAL != COMPLETE: partial states disclose gaps and are never
 *     rendered complete.
 *   - Feedback loop: retrieval round → CoverageState update → saturation
 *     evaluation → legal continue/stop/budget/provider-failure decision →
 *     downstream synthesis. No competing controller; the convergence journal
 *     enforces a strict single-pass acyclic stage order (repeat = refusal).
 *   - Ownership pins resolved here (Issue #47 IN_VARIANT 5):
 *       fusedCandidateCount — retrieval/fusion candidate count; the controller
 *         hook is the deterministic last writer after selection accounting
 *         (monotone, order-independent), never the selected-group count.
 *       fusedGroupCount — T08-exclusive selected source-group count.
 *       new_*_rate — T13 hook permits but passes none today; T14 writes the
 *         five synthesis diagnostics last (T13-before-T14 enforced by the
 *         journal); novelty_gain stays T06/controller-only.
 *   - All persisted artifact references are work-relative; no credentials; no
 *     machine-private absolute paths (assertArtifactSafe walk + work-relative
 *     refs only).
 *
 * This module adds NO algorithm, NO thresholds, NO provider/runtime policy.
 * Every capability is an existing frozen component joined at its published seam.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  createInitialCoverageState,
  persistCoverageState,
  updateRetrievalCoverage,
  reconcileFinalCoverage,
  OWNER_T15_FINAL,
  OWNER_RETRIEVAL_CONTROLLER,
  COVERAGE_ERROR_INCOMPLETE_ANALYSIS,
  COVERAGE_STATE_FILENAME,
  validateCoverageState,
} from './coverage-state.mjs';
import {
  evaluateRetrievalRound,
  applyRoundEvaluationToCoverageState,
} from './retrieval-round-controller.mjs';
import {
  runMultiQueryRetrieval,
  RETRIEVAL_POOL_FILENAME,
  RETRIEVAL_POOL_SCHEMA_VERSION,
  RETRIEVAL_POOL_TYPE,
  RETRIEVAL_FAILURE_NO_VALID_CHANNEL,
} from './retrieval.mjs';
import {
  selectSourceGroups,
  applySelectionToCoverageState,
  persistSelectionDecision,
  SELECT_VERDICT_AUTO,
  SELECT_VERDICT_AMBIGUOUS,
  SELECTION_DECISION_FILENAME,
} from './source-group-selection.mjs';
import {
  createMultiGroupExecutionState,
  executeGroupCapture,
  executeGroupVerify,
  executeGroupHandoff,
  isResearchComplete,
  deriveResearchCorpusManifest,
  applySourceCompletenessToCoverageState,
  persistMultiGroupState,
  loadMultiGroupState,
  MULTI_GROUP_STATE_FILENAME,
} from './multi-group-execution.mjs';
import {
  buildSelectorInput,
  applySelectionAccountingToCoverageState,
} from './rce-input-adapter.mjs';
import { selectResearchCorpus } from './rce-corpus-selector.mjs';
import {
  runPerGroupAnalysis,
} from './per-group-claim-extraction.mjs';
import {
  buildRealProvenanceResolver,
  buildRealSourceContentLoader,
  buildRealAuthorRefResolver,
} from './rce-provenance-adapter.mjs';
import { produceCrossSourceSynthesis } from './cross-source-synthesis.mjs';
import { canonicalJson } from './cross-group-aggregation.mjs';
import { assertArtifactSafe } from './rrf.mjs';
import { appendEvent } from './state.mjs';

/** Re-exported ledger identity for consumers of the integration module. */
export { COVERAGE_STATE_FILENAME };

// ---------------------------------------------------------------------------
// identity constants
// ---------------------------------------------------------------------------

/** Persisted final coverage integration artifact filename (work-relative). */
export const FINAL_COVERAGE_FILENAME = 'coverage-final.json';
export const FINAL_COVERAGE_SCHEMA_VERSION = 1;
export const FINAL_COVERAGE_TYPE = 'p1-final-coverage-integration';

/** P1 pipeline identity disclosed by the final integration (mode identity). */
export const P1_PIPELINE_IDENTITY = 'p1-cross-question-deep-research';

/** Final reconciliation stage identity. */
export const STAGE_FINAL_RECONCILIATION = 'FINAL_COVERAGE_RECONCILIATION';

/** Convergence stage identities (strict single-pass acyclic order). */
export const STAGE_RETRIEVAL_ROUNDS = 'RETRIEVAL_ROUNDS';
export const STAGE_SOURCE_GROUP_SELECTION = 'SOURCE_GROUP_SELECTION';
export const STAGE_GROUP_EXECUTION = 'GROUP_EXECUTION';
export const STAGE_CORPUS_SELECTION = 'CORPUS_SELECTION';
export const STAGE_PER_GROUP_ANALYSIS = 'PER_GROUP_ANALYSIS';
export const STAGE_CROSS_SOURCE_SYNTHESIS = 'CROSS_SOURCE_SYNTHESIS';

export const CANONICAL_STAGE_ORDER = Object.freeze([
  STAGE_RETRIEVAL_ROUNDS,
  STAGE_SOURCE_GROUP_SELECTION,
  STAGE_GROUP_EXECUTION,
  STAGE_CORPUS_SELECTION,
  STAGE_PER_GROUP_ANALYSIS,
  STAGE_CROSS_SOURCE_SYNTHESIS,
  STAGE_FINAL_RECONCILIATION,
]);

/** Machine-readable error identities. */
export const CFI_ERROR_INVALID_INPUT = 'cfi_invalid_input';
export const CFI_ERROR_STAGE_ORDER_INVALID = 'cfi_stage_order_invalid';
export const CFI_ERROR_RETRIEVAL_FAILED = 'cfi_retrieval_failed';
export const CFI_ERROR_RESEARCH_INCOMPLETE = 'cfi_research_incomplete';
export const CFI_ERROR_SYNTHESIS_FAILED = 'cfi_synthesis_failed';
/** Frozen SEAM D contract code (only guardResult === 'PASS' may accompany synthesis). */
export const CFI_ERROR_GUARD_EVIDENCE_REQUIRED = 'SEAM_D_GUARD_EVIDENCE_REQUIRED';

/** Work-relative subdirectory holding per-round retrieval pool artifacts. */
export const RETRIEVAL_ROUNDS_DIRNAME = 'retrieval-rounds';
/** Accumulated cross-round pool artifact filename (work-relative). */
export const ACCUMULATED_POOL_FILENAME = 'accumulated-pool.json';

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;

export class CoverageIntegrationError extends Error {
  constructor(code, message, { details = null } = {}) {
    super(message);
    this.name = 'CoverageIntegrationError';
    this.code = code;
    this.details = details;
  }
}

function failClosed(code, message, details = null) {
  throw new CoverageIntegrationError(code, message, { details });
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

// ---------------------------------------------------------------------------
// convergence journal (strict single-pass acyclic stage order)
// ---------------------------------------------------------------------------

/**
 * The convergence journal records the runtime hook-convergence sequence. It is
 * the mechanical acyclicity guard: a stage may be recorded exactly once, and
 * only as the next entry of CANONICAL_STAGE_ORDER. Any repeat, skip, or
 * reordering is refused fail-closed — there is no cyclic control graph.
 */
export function beginConvergenceJournal() {
  return { stages: [] };
}

export function recordStage(journal, stage) {
  if (!isPlainObject(journal) || !Array.isArray(journal.stages)) {
    failClosed(CFI_ERROR_STAGE_ORDER_INVALID, 'convergence journal missing or malformed');
  }
  const expectedIndex = journal.stages.length;
  if (expectedIndex >= CANONICAL_STAGE_ORDER.length || CANONICAL_STAGE_ORDER[expectedIndex] !== stage) {
    failClosed(
      CFI_ERROR_STAGE_ORDER_INVALID,
      `stage "${String(stage)}" is not the next legal convergence stage (single-pass acyclic order enforced)`,
      { expectedIndex, recordedSoFar: [...journal.stages] },
    );
  }
  journal.stages.push(stage);
  return journal;
}

function requireJournalAtStage(journal, stage) {
  const idx = CANONICAL_STAGE_ORDER.indexOf(stage);
  if (!isPlainObject(journal) || !Array.isArray(journal.stages)) {
    failClosed(CFI_ERROR_STAGE_ORDER_INVALID, 'convergence journal missing or malformed');
  }
  // Exact canonical prefix equality: content AND length. A journal that skipped,
  // repeated, or reordered stages (or was forged without recordStage) is refused.
  const expected = CANONICAL_STAGE_ORDER.slice(0, idx);
  if (journal.stages.length !== expected.length
    || journal.stages.some((s, i) => s !== expected[i])) {
    failClosed(
      CFI_ERROR_STAGE_ORDER_INVALID,
      `stage "${String(stage)}" requires the exact canonical stage prefix (no repeats, no skips, no reordering)`,
      { recordedSoFar: [...journal.stages] },
    );
  }
}

// ---------------------------------------------------------------------------
// stage 1 — coverage ledger begin
// ---------------------------------------------------------------------------

/**
 * Create + persist the initial ResearchCoverageState for a P1 research run.
 * plannedRoutes are the caller-resolved channel descriptors the round loop
 * will execute (providerId + capability); planned query variants come from the
 * persisted plan.
 */
export function beginResearchCoverageLedger({ plan, planHash: expectedPlanHash, workDir, plannedRoutes = [] }) {
  if (!isPlainObject(plan) || !isNonEmptyString(expectedPlanHash) || !isNonEmptyString(workDir)) {
    failClosed(CFI_ERROR_INVALID_INPUT, 'beginResearchCoverageLedger requires plan, planHash, workDir');
  }
  if (!Array.isArray(plannedRoutes)) {
    failClosed(CFI_ERROR_INVALID_INPUT, 'plannedRoutes must be an array of { providerId, capability } descriptors');
  }
  // createInitialCoverageState validates the planHash format fail-closed.
  const coverageState = createInitialCoverageState({
    planHash: expectedPlanHash,
    plannedQueryVariants: Array.isArray(plan.queryVariants) ? plan.queryVariants : [],
    plannedRoutes,
  });
  persistCoverageState(workDir, coverageState);
  const journal = beginConvergenceJournal();
  appendEvent(workDir, { event: 'coverage_ledger_begin', planHash: expectedPlanHash });
  return { coverageState, journal };
}

// ---------------------------------------------------------------------------
// stage 2 — retrieval feedback loop (round → ledger → saturation → decision)
// ---------------------------------------------------------------------------

function projectChannelFailures(channelRecords, roundIndex) {
  return channelRecords
    .filter((c) => c.ok === false)
    .map((c) => ({
      code: c.failure?.code ?? 'PROVIDER_FAILURE_UNKNOWN',
      class: c.failure?.class ?? 'unknown',
      query: c.channel?.query,
      providerId: c.channel?.providerId,
      roundIndex,
    }));
}

/**
 * Run the complete retrieval feedback loop through the frozen T07 round
 * controller and the T06 single-pass retrieval primitive:
 *   round → runMultiQueryRetrieval → accumulate unique fused candidates
 *         → evaluateRetrievalRound → applyRoundEvaluationToCoverageState
 *         → persist → CONTINUE / SATURATED / BUDGET_STOP / PROVIDER_FAILURE.
 *
 * Re-executing the SAME planned retrieval is the only in-contract round
 * semantics (targeted re-query is Issue #53 — explicitly out of scope); zero
 * new candidates is the mechanical saturation proof the controller accepts.
 *
 * Returns { ok:true, decision, stopReason, coverageState, pool, rounds }.
 * decision === 'PROVIDER_FAILURE' carries pool === null (no candidate pool
 * exists; downstream selection must refuse) and the run must fail closed.
 */
export function runRetrievalFeedbackLoop({
  coverageState, plan, planHash: expectedPlanHash, workDir, seam, channels, config, journal,
} = {}) {
  if (!isPlainObject(plan) || !isNonEmptyString(expectedPlanHash) || !isNonEmptyString(workDir) || !isPlainObject(seam)) {
    failClosed(CFI_ERROR_INVALID_INPUT, 'runRetrievalFeedbackLoop requires plan, planHash, workDir, seam');
  }
  requireJournalAtStage(journal, STAGE_RETRIEVAL_ROUNDS);

  const accumulated = new Map(); // questionId → candidate record (best rrfScore wins)
  const accumulatedChannels = new Map(); // channel triple → record (first round wins)
  let roundIndex = 0;
  let decision = null;
  let stopReason = null;

  for (;;) {
    roundIndex += 1;
    if (roundIndex > 1024) failClosed(CFI_ERROR_RETRIEVAL_FAILED, 'retrieval round loop exceeded the mechanical safety bound');
    const roundWorkDir = path.join(workDir, RETRIEVAL_ROUNDS_DIRNAME, `round-${roundIndex}`);
    const res = runMultiQueryRetrieval({ plan, planHash: expectedPlanHash, seam, channels, workDir: roundWorkDir });

    if (!res.ok) {
      if (res.reason === RETRIEVAL_FAILURE_NO_VALID_CHANNEL) {
        // Every provider failed this round: an all-failure round is a round —
        // the controller judges it PROVIDER_FAILURE and the run fails closed
        // with the recorded failure identities (NO_SILENT_PROVIDER_FALLBACK).
        const providerFailuresThisRound = (Array.isArray(res.details?.failedChannels) ? res.details.failedChannels : [])
          .map((c) => ({
            code: c.failure?.code ?? 'PROVIDER_FAILURE_UNKNOWN',
            class: c.failure?.class ?? 'unknown',
            query: c.channel?.query,
            providerId: c.channel?.providerId,
            roundIndex,
          }));
        const evaluation = evaluateRetrievalRound({
          coverageState,
          roundIndex,
          newCandidatesCount: 0,
          totalCandidatesCount: accumulated.size,
          executedRoutesThisRound: [],
          providerFailuresThisRound,
          config,
        });
        coverageState = applyRoundEvaluationToCoverageState(coverageState, evaluation);
        persistCoverageState(workDir, coverageState);
        appendEvent(workDir, {
          event: 'retrieval_round', roundIndex, decision: evaluation.decision,
          noveltyGain: evaluation.noveltyGain, newCandidatesCount: 0,
          totalCandidatesCount: accumulated.size, providerFailures: providerFailuresThisRound.length,
        });
        recordStage(journal, STAGE_RETRIEVAL_ROUNDS);
        return {
          ok: true,
          decision: evaluation.decision,
          stopReason: evaluation.stopReason,
          coverageState,
          pool: null,
          rounds: roundIndex,
        };
      }
      // Plan/pool-write/contract failures are NOT round outcomes — fail closed
      // with the stable T06 reason surfaced (never a raw provider payload).
      failClosed(CFI_ERROR_RETRIEVAL_FAILED, `retrieval failed closed: ${String(res.reason)}`, { reason: res.reason });
    }

    const pool = res.pool;
    let newCandidatesCount = 0;
    for (const candidate of pool.candidates) {
      const questionId = candidate?.identity?.questionId;
      if (!isNonEmptyString(questionId)) failClosed(CFI_ERROR_RETRIEVAL_FAILED, 'fused candidate missing its identity questionId');
      const existing = accumulated.get(questionId);
      if (!existing) {
        accumulated.set(questionId, candidate);
        newCandidatesCount += 1;
      } else if (Number(candidate.rrfScore) > Number(existing.rrfScore)) {
        accumulated.set(questionId, candidate);
      }
    }
    for (const record of pool.channels) {
      const key = `${record.channel?.query ?? ''}::${record.channel?.providerId ?? ''}::${record.channel?.capability ?? ''}`;
      if (!accumulatedChannels.has(key)) accumulatedChannels.set(key, record);
    }

    const executedRoutesThisRound = pool.channels
      .filter((c) => c.ok === true)
      .map((c) => ({
        query: c.channel.query,
        providerId: c.channel.providerId,
        capability: c.channel.capability,
        roundIndex,
      }));
    const providerFailuresThisRound = projectChannelFailures(pool.channels, roundIndex);

    const evaluation = evaluateRetrievalRound({
      coverageState,
      roundIndex,
      newCandidatesCount,
      totalCandidatesCount: accumulated.size,
      executedRoutesThisRound,
      providerFailuresThisRound,
      config,
    });
    coverageState = applyRoundEvaluationToCoverageState(coverageState, evaluation);
    persistCoverageState(workDir, coverageState);
    appendEvent(workDir, {
      event: 'retrieval_round', roundIndex, decision: evaluation.decision,
      noveltyGain: evaluation.noveltyGain, newCandidatesCount,
      totalCandidatesCount: accumulated.size, providerFailures: providerFailuresThisRound.length,
    });

    if (evaluation.shouldStop) {
      decision = evaluation.decision;
      stopReason = evaluation.stopReason;
      break;
    }
  }

  // Deterministic accumulated pool for downstream selection: candidates sorted
  // by rrfScore desc then questionId asc (the T06/RRF ordering contract);
  // channel records from the first round that produced them.
  const sortedCandidates = [...accumulated.values()].sort((a, b) => {
    const s = Number(b.rrfScore) - Number(a.rrfScore);
    if (s !== 0) return s;
    return String(a.identity.questionId) < String(b.identity.questionId) ? -1 : 1;
  });
  const accumulatedPool = {
    schemaVersion: RETRIEVAL_POOL_SCHEMA_VERSION,
    type: RETRIEVAL_POOL_TYPE,
    planHash: expectedPlanHash,
    channels: [...accumulatedChannels.values()],
    candidates: sortedCandidates,
    rejected: [],
    criteria: {
      fusion: 'rrf',
      scope: 'multi-round-accumulated',
      retrievalRounds: roundIndex,
    },
  };
  const safety = assertArtifactSafe(accumulatedPool, { trustedPlanStrings: new Set(Array.isArray(plan.queryVariants) ? plan.queryVariants : []) });
  if (!safety.ok) failClosed(CFI_ERROR_RETRIEVAL_FAILED, `accumulated pool failed the artifact safety walk: ${safety.reason}`);
  try {
    fs.mkdirSync(path.join(workDir, RETRIEVAL_ROUNDS_DIRNAME), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, RETRIEVAL_ROUNDS_DIRNAME, ACCUMULATED_POOL_FILENAME),
      `${JSON.stringify(accumulatedPool, null, 2)}\n`,
    );
  } catch {
    failClosed(CFI_ERROR_RETRIEVAL_FAILED, 'accumulated pool persistence failed', { file: ACCUMULATED_POOL_FILENAME });
  }

  recordStage(journal, STAGE_RETRIEVAL_ROUNDS);
  appendEvent(workDir, { event: 'retrieval_feedback_loop_complete', decision, stopReason, rounds: roundIndex });
  return { ok: true, decision, stopReason, coverageState, pool: accumulatedPool, rounds: roundIndex };
}

// ---------------------------------------------------------------------------
// stage 3 — source-group selection / ambiguity (T08 accounting)
// ---------------------------------------------------------------------------

/**
 * Run the T08 source-group selection over the accumulated pool and converge
 * its accounting into the ledger:
 *   - auto      → T08 fusion accounting applied, then the controller
 *                 (deterministic last writer) re-pins fusedCandidateCount to
 *                 the retrieval/fusion candidate count — the selected-group
 *                 count can NEVER silently become the candidate count.
 *   - ambiguous → clarificationRequired (at most one clarification, resolved
 *                 by the T08 selector itself); no accounting write.
 *   - none      → fail-closed outcome { ok:false, code }.
 */
export function applySourceGroupSelection({
  coverageState, pool, plan, workDir, journal, clarification = null, minScore = undefined,
} = {}) {
  if (!isPlainObject(pool) || !Array.isArray(pool.candidates)) {
    failClosed(CFI_ERROR_INVALID_INPUT, 'applySourceGroupSelection requires the accumulated retrieval pool');
  }
  requireJournalAtStage(journal, STAGE_SOURCE_GROUP_SELECTION);

  const opts = {};
  if (minScore !== undefined) opts.minScore = minScore;
  if (clarification != null) opts.clarification = clarification;
  const decision = selectSourceGroups(pool, plan, opts);
  persistSelectionDecision(workDir, decision, {
    trustedPlanStrings: new Set(Array.isArray(plan?.queryVariants) ? plan.queryVariants : []),
  });

  if (decision.verdict === SELECT_VERDICT_AUTO) {
    let next = applySelectionToCoverageState(coverageState, decision);
    // Ownership pin (Issue #47 invariant 5B): fusedCandidateCount is the
    // retrieval/fusion candidate count. The T08 hook legitimately writes its
    // eligible-group count into the same field; the controller hook is the
    // deterministic LAST writer so the final value is order-independent and
    // never conflated with the selected-group count.
    next = updateRetrievalCoverage(
      next,
      { fusedCandidateCount: pool.candidates.length },
      { caller: OWNER_RETRIEVAL_CONTROLLER },
    );
    recordStage(journal, STAGE_SOURCE_GROUP_SELECTION);
    appendEvent(workDir, {
      event: 'source_group_selection', verdict: decision.verdict,
      selectedGroupCount: decision.selectedGroupCount, candidateGroupCount: decision.candidates.length,
    });
    return { ok: true, coverageState: next, decision };
  }

  if (decision.verdict === SELECT_VERDICT_AMBIGUOUS) {
    // No accounting write, no stage completion: the run stops for the single
    // legal clarification. The full decision artifact was persisted above.
    appendEvent(workDir, {
      event: 'clarification_required',
      stage: STAGE_SOURCE_GROUP_SELECTION,
      optionQuestionIds: (decision.clarification?.options ?? []).map((o) => o.questionId),
    });
    return { clarificationRequired: true, decision, coverageState };
  }

  return { ok: false, code: decision.reason, decision, coverageState };
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function toPortableRef(p) {
  return String(p).split(path.sep).join('/');
}

/**
 * Composition-seam portability normalization (integration owner duty).
 * The SEAM A manifest is a controller-derived composition artifact (Spec §6.1),
 * never a second canonical store. T09 captures work-relative refs with the
 * platform separator; downstream consumers require portable refs. This
 * normalizes ref separators ONLY (selection identity, group identity, artifact
 * hashes and accounting untouched) and recomputes the self-verifying
 * manifestHash over the SAME canonical-JSON domain as the producer. On POSIX
 * systems this is the identity function — the producer artifact passes through
 * byte-identical.
 */
function normalizeManifestRefsForComposition(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  const { manifestHash, ...fields } = copy;
  let changed = false;
  for (const g of Array.isArray(fields.groups) ? fields.groups : []) {
    for (const key of ['answersRel', 'handoffRel']) {
      if (typeof g[key] === 'string') {
        const normalized = toPortableRef(g[key]);
        if (normalized !== g[key]) {
          g[key] = normalized;
          changed = true;
        }
      }
    }
  }
  if (!changed) return manifest;
  return { ...fields, manifestHash: sha256Hex(canonicalJson(fields)) };
}

// ---------------------------------------------------------------------------
// stage 4 — multi-group execution (T09)
// ---------------------------------------------------------------------------

/**
 * Execute every selected group through the frozen T09 per-group primitives
 * (capture → verify → handoff, idempotent + resume-aware), derive the SEAM A
 * ResearchCorpusManifest, and converge Source Completeness into the ledger.
 * Any required group left unverified (or failed) fails closed (Spec §10.2:
 * a partial corpus can never be declared complete).
 */
export function executeSelectedGroups({
  coverageState, decision, planHash: expectedPlanHash, workDir, captureAdapter, runner, journal,
} = {}) {
  requireJournalAtStage(journal, STAGE_GROUP_EXECUTION);

  const existing = loadMultiGroupState(workDir);
  const multiGroupState = (existing && existing.planHash === expectedPlanHash)
    ? existing
    : createMultiGroupExecutionState({ planHash: expectedPlanHash, selectionDecision: decision });
  persistMultiGroupState(workDir, multiGroupState);

  for (const groupId of Object.keys(multiGroupState.groups).sort()) {
    const g = multiGroupState.groups[groupId];
    if (g.handoffValid) continue;
    if (!g.captured) {
      executeGroupCapture({ state: multiGroupState, groupId, workDir, captureAdapter });
      persistMultiGroupState(workDir, multiGroupState);
      appendEvent(workDir, { event: 'group_capture', groupId, failed: g.failed === true });
    }
    if (!g.verified && !g.failed) {
      executeGroupVerify({ state: multiGroupState, groupId, workDir, runner });
      persistMultiGroupState(workDir, multiGroupState);
      appendEvent(workDir, { event: 'group_verify', groupId, verified: g.verified === true });
    }
    if (g.failed) {
      failClosed(CFI_ERROR_RESEARCH_INCOMPLETE, `group ${groupId} failed during execution (fail closed; partial corpus cannot be declared complete)`, {
        groupId, code: g.failure?.code ?? null, class: g.failure?.class ?? null,
      });
    }
    if (g.verified && !g.handoffValid) {
      executeGroupHandoff({ state: multiGroupState, groupId, workDir, runner });
      persistMultiGroupState(workDir, multiGroupState);
      if (g.failure) {
        failClosed(CFI_ERROR_RESEARCH_INCOMPLETE, `group ${groupId} handoff gate invalid (fail closed)`, {
          groupId, code: g.failure.code ?? null, class: g.failure.class ?? null,
        });
      }
    }
  }

  coverageState = applySourceCompletenessToCoverageState(coverageState, multiGroupState);
  persistCoverageState(workDir, coverageState);

  if (!isResearchComplete(multiGroupState)) {
    failClosed(CFI_ERROR_RESEARCH_INCOMPLETE, 'not every selected group composed valid (captured != verified; fail closed)');
  }

  const manifest = normalizeManifestRefsForComposition(
    deriveResearchCorpusManifest({ state: multiGroupState, selectionDecision: decision }),
  );
  persistMultiGroupState(workDir, multiGroupState);
  recordStage(journal, STAGE_GROUP_EXECUTION);
  appendEvent(workDir, { event: 'group_execution_complete', groups: Object.keys(multiGroupState.groups).length });
  return { ok: true, coverageState, multiGroupState, manifest };
}

// ---------------------------------------------------------------------------
// stage 5 — RCE corpus selection (T11/T12)
// ---------------------------------------------------------------------------

/**
 * Build the selector input from the SEAM A manifest + verified artifacts +
 * caller-supplied embeddings (T11 dense geometry; unavailable embeddings fail
 * closed inside the adapter — no degradation), run the frozen RCE selection,
 * and converge the T12 selection accounting into the ledger.
 */
export function selectResearchCorpusWithCoverage({
  coverageState, manifest, workDir, embeddingsBySourceId, targetEmbeddingByGroupId, journal,
} = {}) {
  requireJournalAtStage(journal, STAGE_CORPUS_SELECTION);

  const input = buildSelectorInput({ manifest, artifactsRoot: workDir, embeddingsBySourceId, targetEmbeddingByGroupId });
  const corpusArtifact = selectResearchCorpus({ manifest, ...input });
  const next = applySelectionAccountingToCoverageState(coverageState, corpusArtifact, { caller: 'T12' });
  persistCoverageState(workDir, next);
  recordStage(journal, STAGE_CORPUS_SELECTION);
  appendEvent(workDir, {
    event: 'corpus_selection_complete',
    selectedSourceCount: next.analysisCoverage.selectedCorpusSourceSet.length,
  });
  return { ok: true, coverageState: next, corpusArtifact };
}

// ---------------------------------------------------------------------------
// stage 6 — per-group analysis (T13; single analyzed-set write path)
// ---------------------------------------------------------------------------

/**
 * Run the T13 per-group analysis over the selected corpus with the REAL
 * controller-owned provenance authorities (manifest + verified artifacts) and
 * converge the ledger through the T13 hook result returned by
 * runPerGroupAnalysis. This module NEVER writes the analyzed source-set
 * identity itself — T13's hook path is the only writer (test-pinned).
 */
export async function analyzeSelectedCorpus({
  coverageState, corpusArtifact, manifest, planHash: expectedPlanHash, runtime, workDir, journal,
} = {}) {
  requireJournalAtStage(journal, STAGE_PER_GROUP_ANALYSIS);

  const result = await runPerGroupAnalysis({
    corpus: corpusArtifact,
    planHash: expectedPlanHash,
    runtime,
    sourceContentLoader: buildRealSourceContentLoader({ manifest, artifactsRoot: workDir }),
    canonicalGroupIdentityResolver: buildRealProvenanceResolver({ manifest, artifactsRoot: workDir }),
    authorRefResolver: buildRealAuthorRefResolver({ manifest, artifactsRoot: workDir }),
    coverageState,
  });
  persistCoverageState(workDir, result.coverageState);
  recordStage(journal, STAGE_PER_GROUP_ANALYSIS);
  appendEvent(workDir, {
    event: 'per_group_analysis_complete',
    groups: result.artifact.groupRepresentations.length,
  });
  return { ok: true, coverageState: result.coverageState, seamCArtifact: result.artifact, groupResults: result.groupResults };
}

// ---------------------------------------------------------------------------
// stage 7 — cross-group synthesis (T14; guard + diagnostics)
// ---------------------------------------------------------------------------

/**
 * Run the T14 cross-source synthesis (pre-synthesis guard FIRST gate inside
 * the frozen composition) and converge the T14 synthesis diagnostics into the
 * ledger. A failed synthesis throws fail-closed — NO synthesis artifact exists
 * and the run never proceeds to final reconciliation.
 */
export function produceSynthesisWithCoverage({
  coverageState, seamCArtifact, runtime, workDir, priorSynthesis = null, journal,
} = {}) {
  requireJournalAtStage(journal, STAGE_CROSS_SOURCE_SYNTHESIS);
  if (!isNonEmptyString(workDir)) {
    failClosed(CFI_ERROR_INVALID_INPUT, 'produceSynthesisWithCoverage requires workDir');
  }

  const result = produceCrossSourceSynthesis({ seamCArtifact, runtime, coverageState, priorSynthesis });
  if (!result.ok) {
    failClosed(CFI_ERROR_SYNTHESIS_FAILED, `cross-source synthesis failed closed: ${String(result.code)}`, {
      code: result.code,
      ...(result.preSynthesisGuard ? { preSynthesisGuard: result.preSynthesisGuard } : {}),
    });
  }
  persistCoverageState(workDir, result.coverageState);
  recordStage(journal, STAGE_CROSS_SOURCE_SYNTHESIS);
  appendEvent(workDir, { event: 'cross_source_synthesis_complete', guardResult: 'PASS' });
  return { ok: true, coverageState: result.coverageState, synthesisArtifact: result.artifact };
}

// ---------------------------------------------------------------------------
// stage 8 — FINAL coverage reconciliation (T15; second independent defense)
// ---------------------------------------------------------------------------

function selectedMinusOther(selected, other) {
  const otherSet = new Set(other);
  return selected.filter((id) => !otherSet.has(id)).sort();
}

function analysisCoverageView(ledger) {
  const ac = ledger.analysisCoverage;
  return {
    selectedCorpusSourceSet: [...ac.selectedCorpusSourceSet],
    mappedSourceSet: [...ac.mappedSourceSet],
    analyzedSourceSet: [...ac.analyzedSourceSet],
    selectedCount: ac.selectedCorpusSourceSet.length,
    mappedCount: ac.mappedSourceSet.length,
    analyzedCount: ac.analyzedSourceSet.length,
    evidenceRefIssues: {
      missingRefs: [...ac.evidenceRefIssues.missingRefs],
      duplicateRefs: [...ac.evidenceRefIssues.duplicateRefs],
      staleRefs: [...ac.evidenceRefIssues.staleRefs],
      invalidRefs: [...ac.evidenceRefIssues.invalidRefs],
    },
  };
}

function retrievalView(ledger) {
  return {
    retrievalRounds: ledger.retrieval.retrievalRounds,
    stopReason: ledger.retrieval.stopReason,
    fusedCandidateCount: ledger.retrieval.fusedCandidateCount,
    fusedGroupCount: ledger.retrieval.fusedGroupCount,
    providerFailureCount: ledger.retrieval.providerFailures.length,
  };
}

function disclosureGap(ledger) {
  const ac = ledger.analysisCoverage;
  const missingAnalyzed = selectedMinusOther(ac.selectedCorpusSourceSet, ac.analyzedSourceSet);
  const missingMapped = selectedMinusOther(ac.selectedCorpusSourceSet, ac.mappedSourceSet);
  return { missingAnalyzed, missingMapped };
}

/**
 * Build the final disclosure from the FINAL COVERAGE INTEGRATION ARTIFACT.
 * The reconciled assertion flag is the ONLY completeness source — never the
 * T14 guard, never a mode name, never counts. Partial states carry explicit
 * gap evidence and are never rendered complete (PARTIAL != COMPLETE).
 */
export function buildFinalDisclosure({ artifact } = {}) {
  if (!isPlainObject(artifact) || !isPlainObject(artifact.assertion) || typeof artifact.assertion.is100PercentAnalysis !== 'boolean') {
    failClosed(CFI_ERROR_INVALID_INPUT, 'buildFinalDisclosure requires a final coverage integration artifact');
  }
  const isFullCoverage = artifact.assertion.is100PercentAnalysis;
  const ac = artifact.coverage.analysisCoverage;
  return {
    pipeline: artifact.pipeline,
    stage: artifact.stage,
    isFullCoverage,
    complete: isFullCoverage,
    analysisCoverage: {
      selectedCount: ac.selectedCount,
      mappedCount: ac.mappedCount,
      analyzedCount: ac.analyzedCount,
    },
    retrieval: artifact.coverage.retrieval,
    gap: isFullCoverage ? null : {
      missingAnalyzed: selectedMinusOther(ac.selectedCorpusSourceSet, ac.analyzedSourceSet),
      missingMapped: selectedMinusOther(ac.selectedCorpusSourceSet, ac.mappedSourceSet),
    },
  };
}

/**
 * THE T15 final gate (SEAM D consumer; second independent defense).
 *
 * 1. Convergence order must be the exact canonical prefix (T15 last).
 * 2. T14 guard evidence is CONSUMED structurally: only a PASS guard with both
 *    identity refs may accompany a synthesis artifact (frozen SEAM D contract).
 * 3. The 100% analysis assertion is produced EXCLUSIVELY by the frozen
 *    reconcileFinalCoverage mechanical set equality on the ledger. A guard
 *    PASS with a desynced ledger is STILL refused (double defense).
 * 4. Persist the reconciled ledger + the final coverage integration artifact
 *    (work-relative refs only) and derive the disclosure from its flag.
 */
export function finalizeResearchCoverage({
  coverageState, synthesisArtifact, workDir, journal,
  requireFullCoverage = true, runtimeIdentity = null, synthesisArtifactRef = null,
} = {}) {
  if (!isNonEmptyString(workDir) || !isPlainObject(synthesisArtifact)) {
    failClosed(CFI_ERROR_INVALID_INPUT, 'finalizeResearchCoverage requires coverageState, synthesisArtifact, workDir');
  }
  requireJournalAtStage(journal, STAGE_FINAL_RECONCILIATION);

  // (2) consume the T14 guard evidence — frozen SEAM D: only PASS may travel
  // with a synthesis artifact; identity refs must be well-formed.
  const guard = synthesisArtifact.preSynthesisGuard;
  if (!isPlainObject(guard)
    || guard.guardResult !== 'PASS'
    || !SHA256_REF.test(String(guard.selectedVerifiedSourceSetIdentity ?? ''))
    || !SHA256_REF.test(String(guard.mappedAnalyzedSourceSetIdentity ?? ''))) {
    failClosed(CFI_ERROR_GUARD_EVIDENCE_REQUIRED, 'synthesis artifact lacks usable PASS pre-synthesis guard evidence (SEAM D fail closed)', {
      guardResult: isPlainObject(guard) ? guard.guardResult ?? null : null,
    });
  }

  // (3) the assertion — frozen T07 reconcileFinalCoverage, caller T15. The
  // first independent defense (T14 guard) having passed does NOT eliminate
  // this second, ledger-based defense.
  let reconciled;
  try {
    reconciled = reconcileFinalCoverage(coverageState, { caller: OWNER_T15_FINAL, assertFullCoverage: requireFullCoverage });
  } catch (err) {
    if (err && err.code === COVERAGE_ERROR_INCOMPLETE_ANALYSIS) {
      const ledger = validateCoverageState(coverageState).validated;
      const gap = disclosureGap(ledger);
      const partialDisclosure = {
        pipeline: P1_PIPELINE_IDENTITY,
        stage: STAGE_FINAL_RECONCILIATION,
        isFullCoverage: false,
        complete: false,
        analysisCoverage: {
          selectedCount: ledger.analysisCoverage.selectedCorpusSourceSet.length,
          mappedCount: ledger.analysisCoverage.mappedSourceSet.length,
          analyzedCount: ledger.analysisCoverage.analyzedSourceSet.length,
        },
        retrieval: retrievalView(ledger),
        gap,
        t14GuardResult: guard.guardResult,
      };
      appendEvent(workDir, {
        event: 'final_coverage_reconciliation_refused',
        missingAnalyzed: gap.missingAnalyzed.length,
        missingMapped: gap.missingMapped.length,
      });
      return { ok: false, code: COVERAGE_ERROR_INCOMPLETE_ANALYSIS, partialDisclosure, coverageState };
    }
    throw err;
  }

  persistCoverageState(workDir, reconciled);

  const artifact = {
    schemaVersion: FINAL_COVERAGE_SCHEMA_VERSION,
    type: FINAL_COVERAGE_TYPE,
    planHash: reconciled.planHash,
    pipeline: P1_PIPELINE_IDENTITY,
    stage: STAGE_FINAL_RECONCILIATION,
    assertion: {
      is100PercentAnalysis: reconciled.analysisCoverage.is100PercentAnalysis,
      basis: 'MECHANICAL_SET_EQUALITY',
    },
    doubleDefense: {
      t14PreSynthesisGuard: {
        guardResult: guard.guardResult,
        selectedVerifiedSourceSetIdentity: guard.selectedVerifiedSourceSetIdentity,
        mappedAnalyzedSourceSetIdentity: guard.mappedAnalyzedSourceSetIdentity,
      },
      t15FinalReconciliation: 'PASS',
    },
    coverage: {
      retrieval: retrievalView(reconciled),
      analysisCoverage: analysisCoverageView(reconciled),
      sourceCompleteness: {
        totalSelectedCount: reconciled.sourceCompleteness.diagnostics.totalSelectedCount,
        totalVerifiedCount: reconciled.sourceCompleteness.diagnostics.totalVerifiedCount,
        capturedNotVerifiedCount: reconciled.sourceCompleteness.diagnostics.capturedNotVerifiedCount,
      },
    },
    diagnostics: { ...reconciled.diagnostics },
    hookConvergenceOrder: [...journal.stages, STAGE_FINAL_RECONCILIATION],
    runtime: isPlainObject(runtimeIdentity)
      ? { runtimeId: String(runtimeIdentity.runtimeId ?? ''), model: String(runtimeIdentity.model ?? '') }
      : null,
    artifacts: {
      coverageState: COVERAGE_STATE_FILENAME,
      finalCoverage: FINAL_COVERAGE_FILENAME,
      ...(isNonEmptyString(synthesisArtifactRef) ? { synthesis: synthesisArtifactRef } : {}),
    },
  };

  // Artifact safety walk before any write (no credentials, no machine-private
  // paths, no cycles — the repository's ONE artifact-safety authority).
  const safety = assertArtifactSafe(artifact);
  if (!safety.ok) failClosed(CFI_ERROR_INVALID_INPUT, `final coverage artifact failed the safety walk: ${safety.reason}`);
  let content;
  try {
    content = `${JSON.stringify(artifact, null, 2)}\n`;
  } catch {
    failClosed(CFI_ERROR_INVALID_INPUT, 'final coverage artifact serialization failed');
  }
  try {
    fs.writeFileSync(path.join(workDir, FINAL_COVERAGE_FILENAME), content);
  } catch {
    failClosed(CFI_ERROR_INVALID_INPUT, 'final coverage artifact persistence failed', { file: FINAL_COVERAGE_FILENAME });
  }

  recordStage(journal, STAGE_FINAL_RECONCILIATION);
  appendEvent(workDir, { event: 'final_coverage_reconciliation', is100PercentAnalysis: artifact.assertion.is100PercentAnalysis });

  return {
    ok: true,
    artifact,
    coverageState: reconciled,
    disclosure: buildFinalDisclosure({ artifact }),
  };
}
