// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/source-group-selection.mjs
 *
 * P1-T08 — Source-group Set Selection / Ambiguity Gate (Spec
 * docs/specs/p1-cross-question-deep-research.md §7; Issue #40).
 *
 * Authority:
 * - §7.1 inherited (single-question): clear best → auto (visible/recordable);
 *   material ambiguity → at most one clarification; no valid → fail closed.
 * - §7.2 P1 additive amendment: the selection result is no longer a single
 *   `selectedQuestionId` but a `SelectedSourceGroups[]` satisfying the
 *   persisted Research Plan. "auto" may select MULTIPLE source groups.
 * - §4.3 planHash dependency: the selection decision artifact is bound to the
 *   persisted plan identity (planHash) and to the pool's planHash; a regenerated
 *   plan (changed planHash) makes the decision stale (fail-closed reuse).
 * - §10.2 FAIL_CLOSED / NO_SILENT_GUESS: ambiguity is NEVER silently guessed —
 *   an ambiguous verdict carries an empty selectedGroups and a structured
 *   clarification request; the controller must obtain exactly one user
 *   clarification (clarificationCount <= 1) before a forced resolution.
 *
 * This module is a CONSUMER of upstream contracts; it does NOT redefine them:
 * - Candidate/Retrieval Pool (P1-T06, retrieval.mjs: RETRIEVAL_POOL_FILENAME);
 *   each pool candidate is `{ identity:{kind:'candidate',questionId}, rrfScore,
 *   ranks, source_url, facts }`. `rrfScore` is the deterministic retrieval
 *   relevance already fused by T06 against the plan's queries → it is the
 *   relevance signal this selector uses. A source group's canonical identity is
 *   its `questionId` (Spec §2.3 / §3.1 group-identity-preservation).
 * - Persisted Research Plan (P1-T04, plan-contract.mjs): supplies
 *   `sourceGroupIntents` (intent/constraints/groupKey) which (a) sets the
 *   intended group count k and (b) provides the consistency-checked rationale
 *   binding recorded in each SelectedSourceGroup.
 * - ResearchCoverageState fusion hook (P1-T07, coverage-state.mjs:
 *   updateSourceGroupFusion, OWNER_T08_FUSION): T08 owns the source-group
 *   fusion accounting and records fusedCandidateCount / fusedGroupCount.
 *
 * Numeric boundaries (minScore / ambiguityMargin / default k) are D-5
 * implementation-validation bounds, not product thresholds; they are explicit,
 * deterministic, and overridable per call so tests are stable.
 *
 * Pure functions + deterministic persistence only. No network IO, no credential
 * handling, no external runtime dependency.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  validatePlanInput,
  planHash as computePlanHash,
  isValidPlanHashFormat,
} from './plan-contract.mjs';
import { updateSourceGroupFusion, OWNER_T08_FUSION } from './coverage-state.mjs';

/** Canonical persisted selection-decision artifact name (work-dir-relative). */
export const SELECTION_DECISION_FILENAME = 'source-group-selection-decision.json';

/** Selection-decision schema version (strict; additive evolution needs a new version). */
export const SELECTION_DECISION_SCHEMA_VERSION = 1;

/** P1-T08 selector owner token (consumed by the T07 fusion hook). */
export const SELECTION_OWNER = OWNER_T08_FUSION;

/** Three-branch verdict constants. */
export const SELECT_VERDICT_AUTO = 'auto';
export const SELECT_VERDICT_AMBIGUOUS = 'ambiguous';
export const SELECT_VERDICT_NONE = 'none';

/** Machine-readable failure / reason identities (fail-closed, controller-checkable). */
export const SELECTION_FAILURE_PLANNER_INVALID = 'planner_invalid';
export const SELECTION_FAILURE_INVALID_POOL = 'selection_invalid_pool';
export const SELECTION_FAILURE_PLAN_POOL_MISMATCH = 'selection_plan_pool_mismatch';
export const SELECTION_FAILURE_INVALID_CLARIFICATION = 'selection_invalid_clarification';
export const SELECTION_FAILURE_NO_VALID_GROUP = 'selection_no_valid_group';

/** D-5 delegated defaults (implementation-validation bounds; overridden per call). */
export const DEFAULT_MIN_GROUP_SCORE = 0;
export const DEFAULT_AMBIGUITY_MARGIN = 0.01;

/** Selection-reason codes recorded per SelectedSourceGroup. */
export const SELECT_REASON_CLEAR_BEST = 'clear_best';
export const SELECT_REASON_CLARIFICATION_FORCED = 'clarification_forced';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function failureVerdict(reason, extra = {}) {
  return {
    verdict: SELECT_VERDICT_NONE,
    reason,
    planHash: extra.planHash ?? null,
    poolPlanHash: extra.poolPlanHash ?? null,
    planHashMatch: false,
    selectedGroups: [],
    candidates: [],
    clarification: null,
    clarificationCount: 0,
    intentCoverage: { total: 0, bound: 0, unmet: 0, shortfall: 0 },
    rationale: extra.rationale ?? reason,
  };
}

/** Deterministic lexical compare for canonical questionId strings. */
function compareQuestionId(a, b) {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * Score one pool candidate group by retrieval relevance. `rrfScore` is the
 * deterministic T06-fused relevance against the plan's queries; it is the
 * canonical signal. A missing/non-finite rrfScore degrades to 0 (invalid group).
 */
export function scoreCandidateGroup(candidate) {
  const s = candidate?.rrfScore;
  return typeof s === 'number' && Number.isFinite(s) ? s : 0;
}

/**
 * Validate + normalize the candidate pool into an ordered, scored, eligible
 * group list. Returns { ok:false, reason } (fail-closed) when the pool is
 * malformed, or { ok:true, groups: [...] } where each group is
 * { questionId, rrfScore, score, sourceUrl, provenance, eligible } sorted by
 * score DESC then questionId ASC.
 */
export function buildCandidateGroups(pool) {
  if (!isPlainObject(pool) || !Array.isArray(pool.candidates)) {
    return { ok: false, reason: SELECTION_FAILURE_INVALID_POOL };
  }
  const groups = [];
  for (const c of pool.candidates) {
    if (!isPlainObject(c) || !isPlainObject(c.identity) || !isCanonicalQuestionId(c.identity.questionId)) {
      return { ok: false, reason: SELECTION_FAILURE_INVALID_POOL };
    }
    const score = scoreCandidateGroup(c);
    groups.push({
      questionId: String(c.identity.questionId),
      rrfScore: score,
      score,
      sourceUrl: c.source_url ?? null,
      provenance: Array.isArray(c.ranks) ? c.ranks : [],
    });
  }
  groups.sort((a, b) => (b.score !== a.score ? b.score - a.score : compareQuestionId(a.questionId, b.questionId)));
  return { ok: true, groups };
}

/** Reuse T06's canonical questionId gate so a malformed id fails closed. */
function isCanonicalQuestionId(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  // Canonical Zhihu decimal question id: 1..19 digits, no leading zeros, non-empty.
  return /^(?!0)\d{1,19}$/.test(value);
}

/**
 * Determine the intended group count k from the plan / options.
 * - opts.groupCount (explicit, tests/pipeline override) wins.
 * - Else plan.sourceGroupIntents.length when the plan declares any intents.
 * - Else (no explicit count, no plan intents) → select ALL eligible groups
 *   (P1 breadth default; no artificial boundary → no boundary ambiguity).
 */
export function intendedGroupCount(plan, opts = {}) {
  if (opts.groupCount != null) {
    const k = Number(opts.groupCount);
    return Number.isInteger(k) && k >= 0 ? k : 0;
  }
  const intents = plan?.sourceGroupIntents;
  if (Array.isArray(intents) && intents.length > 0) return intents.length;
  return Number.POSITIVE_INFINITY; // sentinel: take all eligible
}

/**
 * Bind selected groups to plan sourceGroupIntents for the consistency record.
 * - An intent with a non-null `groupKey` binds to a selected group whose
 *   questionId equals that groupKey (exact, deterministic).
 * - Remaining unbound intents are recorded as `unmet` (a consistency diagnostic;
 *   constraint matching is an OPEN design — recorded, not a hard fail).
 * Returns { bindings: Map<questionId, {intentIndex, groupKey}>, unmet: number }.
 */
export function bindGroupsToPlanIntents(selectedGroups, plan) {
  const intents = Array.isArray(plan?.sourceGroupIntents) ? plan.sourceGroupIntents : [];
  const bindings = new Map();
  const usedIntent = new Set();
  // First pass: exact groupKey matches (strongest binding).
  for (const g of selectedGroups) {
    const hit = intents.findIndex((it, idx) => !usedIntent.has(idx) && isNonEmptyString(it.groupKey) && it.groupKey === g.questionId);
    if (hit >= 0) {
      usedIntent.add(hit);
      bindings.set(g.questionId, { intentIndex: hit, groupKey: intents[hit].groupKey });
    }
  }
  // Second pass: positional binding for the still-unbound intents, in order.
  let nextIntent = 0;
  for (const g of selectedGroups) {
    if (bindings.has(g.questionId)) continue;
    while (nextIntent < intents.length && usedIntent.has(nextIntent)) nextIntent += 1;
    if (nextIntent < intents.length) {
      usedIntent.add(nextIntent);
      bindings.set(g.questionId, { intentIndex: nextIntent, groupKey: intents[nextIntent].groupKey ?? null });
      nextIntent += 1;
    }
  }
  return { bindings, unmet: intents.length - usedIntent.size };
}

/**
 * Core selector A: Candidate/Retrieval Pool + persisted Research Plan →
 * SelectedSourceGroups[] with a three-branch, fail-closed, planHash-bound decision.
 *
 * @param {object} pool   retrieval-pool artifact ({ schemaVersion, planHash?, candidates[] })
 * @param {object} plan   validated T04 Research Plan (all six field classes)
 * @param {object} [opts]
 * @param {number} [opts.groupCount]   explicit intended group count k (overrides plan)
 * @param {number} [opts.minScore]     minimum relevance for a group to be eligible
 * @param {number} [opts.ambiguityMargin]  max score gap at the set boundary for ambiguity
 * @param {object} [opts.clarification]  user clarification answer: { forceGroupIds: string[] }
 *                                        (at most one clarification; never re-asks)
 * @returns {object} selection decision (see SELECT_VERDICT_* + SelectedSourceGroups[])
 */
export function selectSourceGroups(pool, plan, opts = {}) {
  const minScore = typeof opts.minScore === 'number' ? opts.minScore : DEFAULT_MIN_GROUP_SCORE;
  const ambiguityMargin = typeof opts.ambiguityMargin === 'number' ? opts.ambiguityMargin : DEFAULT_AMBIGUITY_MARGIN;

  // 1. Plan validity (Spec §4.2: invalid plan → planner_invalid fail-closed).
  const planValidation = validatePlanInput(plan);
  if (!planValidation.ok) {
    return failureVerdict(SELECTION_FAILURE_PLANNER_INVALID, { rationale: 'plan failed validation (planner_invalid)' });
  }
  const normalizedPlan = planValidation.plan;
  let planIdentity;
  try {
    planIdentity = computePlanHash(normalizedPlan);
  } catch {
    return failureVerdict(SELECTION_FAILURE_PLANNER_INVALID, { rationale: 'plan hash computation failed' });
  }

  // 2. Pool validity.
  const built = buildCandidateGroups(pool);
  if (!built.ok) {
    return failureVerdict(built.reason, { planHash: planIdentity, poolPlanHash: pool?.planHash ?? null });
  }

  // 3. Plan/pool identity consistency (Spec §4.3 dependency identity).
  const poolPlanHash = pool?.planHash ?? null;
  const planHashMatch = isValidPlanHashFormat(poolPlanHash) && poolPlanHash === planIdentity;
  if (isValidPlanHashFormat(poolPlanHash) && poolPlanHash !== planIdentity) {
    return failureVerdict(SELECTION_FAILURE_PLAN_POOL_MISMATCH, {
      planHash: planIdentity,
      poolPlanHash,
      rationale: 'persisted plan identity does not match the retrieval-pool planHash (stale dependency)',
    });
  }

  // 4. Eligible candidate groups (minimum validity gate; D-5 bound).
  const eligible = built.groups
    .map((g, idx) => ({ ...g, rankIndex: idx }))
    .filter((g) => g.score >= minScore);

  // 5. Clarification resolution (at most one; never silently guesses).
  if (opts.clarification != null) {
    return resolveClarification({
      pool, eligible, normalizedPlan, planIdentity, poolPlanHash, planHashMatch, ambiguityMargin, opts,
    });
  }

  // 6. No valid group set → fail closed.
  if (eligible.length === 0) {
    return finalize({
      verdict: SELECT_VERDICT_NONE,
      reason: SELECTION_FAILURE_NO_VALID_GROUP,
      planIdentity, poolPlanHash, planHashMatch,
      selectedGroups: [],
      eligible,
      clarification: null,
      clarificationCount: 0,
      normalizedPlan,
      intentShortfall: 0,
      rationale: 'no candidate group set reached the minimum validity threshold',
    });
  }

  // 7. Determine the intended group count k and the set boundary.
  const k = intendedGroupCount(normalizedPlan, opts);
  const takeAll = !Number.isFinite(k);
  const takeCount = takeAll ? eligible.length : Math.min(k, eligible.length);
  const selected = eligible.slice(0, takeCount);
  const intentShortfall = takeAll || k <= eligible.length ? 0 : k - eligible.length;

  // Explicit zero-count (e.g. groupCount=0) with available candidates → no set
  // satisfies the requested scope → fail closed rather than a misleading empty "clear best".
  if (selected.length === 0) {
    return finalize({
      verdict: SELECT_VERDICT_NONE,
      reason: SELECTION_FAILURE_NO_VALID_GROUP,
      planIdentity, poolPlanHash, planHashMatch,
      selectedGroups: [],
      eligible,
      clarification: null,
      clarificationCount: 0,
      normalizedPlan,
      intentShortfall,
      rationale: 'requested group count is zero while candidate groups are available',
    });
  }

  // 8. Material ambiguity: fuzzy set boundary at k (only when a boundary exists).
  let ambiguous = false;
  let ambiguityMessage = null;
  if (!takeAll && eligible.length > k && k > 0) {
    const lastIncluded = eligible[k - 1];
    const firstExcluded = eligible[k];
    if (lastIncluded.score - firstExcluded.score < ambiguityMargin) {
      ambiguous = true;
      ambiguityMessage =
        `material ambiguity: the selected group set boundary is fuzzy `
        + `(included group ${lastIncluded.questionId} score ${lastIncluded.score} vs `
        + `excluded group ${firstExcluded.questionId} score ${firstExcluded.score}; `
        + `gap < ambiguity margin ${ambiguityMargin}) — auto-selecting would change the normalized research intent`;
    }
  }

  if (ambiguous) {
    const options = eligible.slice(0, Math.max(k + 1, 1)).map((g) => ({
      groupId: g.questionId,
      questionId: g.questionId,
      score: g.score,
      sourceUrl: g.sourceUrl,
    }));
    return finalize({
      verdict: SELECT_VERDICT_AMBIGUOUS,
      reason: 'material_ambiguity',
      planIdentity, poolPlanHash, planHashMatch,
      selectedGroups: [],
      eligible,
      clarification: {
        required: true,
        count: 1, // exactly one clarification allowed
        options,
        message: ambiguityMessage,
      },
      clarificationCount: 0,
      normalizedPlan,
      intentShortfall,
      rationale: ambiguityMessage,
    });
  }

  // 9. Clear best group set → deterministic auto-selection.
  const { bindings, unmet } = bindGroupsToPlanIntents(selected, normalizedPlan);
  const selectedGroups = selected.map((g) => ({
    groupId: g.questionId,
    questionId: g.questionId,
    rrfScore: g.rrfScore,
    score: g.score,
    sourceUrl: g.sourceUrl,
    provenance: g.provenance,
    rationaleRef: bindings.get(g.questionId) ?? null,
    selectionReason: SELECT_REASON_CLEAR_BEST,
  }));

  const rationale =
    `clear best group set: auto-selected ${selectedGroups.length} source group(s) `
    + `(score desc; planHash ${planIdentity.slice(0, 12)}…)`;

  return finalize({
    verdict: SELECT_VERDICT_AUTO,
    reason: 'clear_best',
    planIdentity, poolPlanHash, planHashMatch,
    selectedGroups,
    eligible,
    clarification: null,
    clarificationCount: 0,
    normalizedPlan,
    intentShortfall,
    unmetIntentCount: unmet,
    rationale,
  });
}

/**
 * Resolve a clarification answer (forceGroupIds). Honors the user's explicit
 * choice, never re-asks (clarificationCount becomes 1), and fails closed on an
 * invalid/unknown forced id. This guarantees clarification_count <= 1.
 */
function resolveClarification({ eligible, normalizedPlan, planIdentity, poolPlanHash, planHashMatch, opts }) {
  const force = opts.clarification;
  const forceIds = Array.isArray(force?.forceGroupIds) ? force.forceGroupIds.map(String) : null;
  if (forceIds === null) {
    return failureVerdict(SELECTION_FAILURE_INVALID_CLARIFICATION, {
      planHash: planIdentity, poolPlanHash, rationale: 'clarification provided without a valid forceGroupIds array',
    });
  }
  const forced = [];
  for (const id of forceIds) {
    const g = eligible.find((e) => e.questionId === id);
    if (!g) {
      return failureVerdict(SELECTION_FAILURE_INVALID_CLARIFICATION, {
        planHash: planIdentity, poolPlanHash,
        rationale: `clarification forceGroupIds contains an unknown group id: ${id}`,
      });
    }
    forced.push(g);
  }
  forced.sort((a, b) => (b.score !== a.score ? b.score - a.score : compareQuestionId(a.questionId, b.questionId)));

  const { bindings, unmet } = bindGroupsToPlanIntents(forced, normalizedPlan);
  const selectedGroups = forced.map((g) => ({
    groupId: g.questionId,
    questionId: g.questionId,
    rrfScore: g.rrfScore,
    score: g.score,
    sourceUrl: g.sourceUrl,
    provenance: g.provenance,
    rationaleRef: bindings.get(g.questionId) ?? null,
    selectionReason: SELECT_REASON_CLARIFICATION_FORCED,
  }));

  const rationale =
    `clarification resolved: user-selected ${selectedGroups.length} source group(s) `
    + `(clarificationCount=1; no further clarification permitted)`;

  return finalize({
    verdict: SELECT_VERDICT_AUTO,
    reason: 'clarification_resolved',
    planIdentity, poolPlanHash, planHashMatch,
    selectedGroups,
    eligible,
    clarification: {
      required: false,
      count: 0, // no more clarifications remain
      options: null,
      message: null,
      forcedGroupIds: forceIds,
    },
    clarificationCount: 1,
    normalizedPlan,
    intentShortfall: 0,
    unmetIntentCount: unmet,
    rationale,
  });
}

/**
 * Assemble the final decision object (shared by every branch). Adds the scored
 * candidate transparency list and the intent-coverage diagnostic.
 */
function finalize({ verdict, reason, planIdentity, poolPlanHash, planHashMatch, selectedGroups, eligible, clarification, clarificationCount, normalizedPlan, intentShortfall, unmetIntentCount, rationale }) {
  const intentTotal = Array.isArray(normalizedPlan?.sourceGroupIntents) ? normalizedPlan.sourceGroupIntents.length : 0;
  const candidates = eligible.map((g) => ({
    questionId: g.questionId,
    score: g.score,
    rrfScore: g.rrfScore,
    eligible: true,
    selected: selectedGroups.some((s) => s.questionId === g.questionId),
  }));
  return {
    verdict,
    reason,
    planHash: planIdentity,
    poolPlanHash,
    planHashMatch,
    selectorVersion: 'p1-t08-source-group-selection/v1',
    schemaVersion: SELECTION_DECISION_SCHEMA_VERSION,
    type: 'source-group-selection-decision',
    selectedGroups,
    selectedGroupCount: selectedGroups.length,
    candidates,
    clarification,
    clarificationCount,
    intentCoverage: {
      total: intentTotal,
      bound: Math.max(0, intentTotal - (unmetIntentCount ?? 0)),
      unmet: unmetIntentCount ?? 0,
      shortfall: intentShortfall ?? 0,
    },
    rationale,
  };
}

/**
 * Persist the selection decision (work-dir-relative; no credentials). Returns
 * { ok:true, file }. Determinism: artifact content is canonical (no timestamp)
 * so its meaning is stable and it can be re-validated for staleness.
 */
export function persistSelectionDecision(workDir, decision) {
  if (!isPlainObject(decision) || !isNonEmptyString(workDir)) {
    return { ok: false, reason: SELECTION_FAILURE_INVALID_POOL };
  }
  fs.mkdirSync(workDir, { recursive: true });
  const file = path.join(workDir, SELECTION_DECISION_FILENAME);
  fs.writeFileSync(file, `${JSON.stringify(decision, null, 2)}\n`);
  return { ok: true, file: SELECTION_DECISION_FILENAME };
}

/**
 * Load + RE-VALIDATE a persisted selection decision (FILE EXISTS != VALID CACHE).
 * Returns { ok:true, decision } or { ok:false, reason }.
 */
export function loadSelectionDecision(workDir) {
  const file = path.join(workDir, SELECTION_DECISION_FILENAME);
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'selection_decision_missing' };
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, reason: 'selection_decision_unreadable' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'selection_decision_unparseable' };
  }
  if (!isPlainObject(parsed) || parsed.type !== 'source-group-selection-decision') {
    return { ok: false, reason: 'selection_decision_invalid' };
  }
  return { ok: true, decision: parsed };
}

/**
 * Stale-propagation seam (Spec §4.3): a prior selection decision is reusable
 * ONLY when its planHash matches the CURRENT valid plan's planHash AND its
 * poolPlanHash matches the current pool's planHash. Any mismatch → stale
 * (fail-closed reuse). Returns { reusable, stale, reason }.
 */
export function selectionDecisionStatus({ decision, currentPlanHash, currentPoolPlanHash }) {
  if (!isPlainObject(decision) || !isValidPlanHashFormat(decision.planHash)) {
    return { reusable: false, stale: true, reason: 'selection_dependency_invalid' };
  }
  if (!isValidPlanHashFormat(currentPlanHash)) {
    return { reusable: false, stale: true, reason: 'selection_dependency_missing' };
  }
  if (decision.planHash !== currentPlanHash) {
    return { reusable: false, stale: true, reason: 'selection_plan_hash_mismatch' };
  }
  if (isValidPlanHashFormat(currentPoolPlanHash)) {
    if (decision.poolPlanHash !== currentPoolPlanHash) {
      return { reusable: false, stale: true, reason: 'selection_pool_hash_mismatch' };
    }
  }
  return { reusable: true, stale: false, reason: null };
}

/**
 * Apply the T08 selection result to the T07 ResearchCoverageState fusion ledger
 * (OWNER_T08_FUSION). Records fusedCandidateCount (groups considered) and
 * fusedGroupCount (groups selected). Returns the new validated coverage state.
 */
export function applySelectionToCoverageState(coverageState, selectionResult, { caller = SELECTION_OWNER } = {}) {
  const candidateCount = Array.isArray(selectionResult?.candidates) ? selectionResult.candidates.length : 0;
  const groupCount = Array.isArray(selectionResult?.selectedGroups) ? selectionResult.selectedGroups.length : 0;
  return updateSourceGroupFusion(
    coverageState,
    { fusedCandidateCount: candidateCount, fusedGroupCount: groupCount },
    { caller },
  );
}
