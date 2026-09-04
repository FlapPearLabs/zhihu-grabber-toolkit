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
 *   binding recorded in each SelectedSourceGroup. Reform round (external
 *   review F1): a non-empty `groupKey` is a HARD constraint — it must be
 *   exactly bound to a distinct selected group and is NEVER positionally
 *   rebound; free-form `constraints` strings have NO structured semantics
 *   under plan schemaVersion 1, so any non-empty constraints[] fails closed
 *   (`selection_constraint_unevaluable`) instead of being silently treated
 *   as satisfied.
 * - ResearchCoverageState fusion hook (P1-T07, coverage-state.mjs:
 *   updateSourceGroupFusion, OWNER_T08_FUSION): T08 owns the source-group
 *   fusion accounting and records fusedCandidateCount / fusedGroupCount.
 *
 * Reform round 2 (external review P1-1) — CONSTRAINT-FIRST GROUP-SET
 * CONSTRUCTION: the selected set is CONSTRUCTED around the plan's required
 * (non-empty groupKey) intents instead of taking an unconstrained RRF top-k
 * and checking required keys post-hoc:
 *   1. every required groupKey must resolve to a DISTINCT ELIGIBLE group
 *      (absent / invalid / below minimum validity → fail closed);
 *   2. required groups are MANDATORY members of the selected set — a higher-
 *      RRF optional group can never displace them;
 *   3. remainingSlots = k - |requiredGroups| (floored at 0; takeAll → all
 *      eligible optional groups) are filled from eligible NON-required groups
 *      in the deterministic RRF order (score DESC, questionId ASC);
 *   4. the material-ambiguity boundary is evaluated ONLY where an actual free-
 *      selection boundary exists: optionalPool[remainingSlots-1] vs
 *      optionalPool[remainingSlots] over the eligible NON-required pool.
 *      remainingSlots === 0 or takeAll → no free boundary → no ambiguity.
 *   PRECEDENCE: |requiredGroups| > k (including an explicit groupCount=0 with
 *   required keys) — required keys are MANDATORY and OUTRANK k: the selected
 *   set is exactly the required groups, remainingSlots = 0, and the optional
 *   intent shortfall is 0. k only bounds the OPTIONAL fills.
 *   intentShortfall is OPTIONAL shortfall only (remainingSlots -
 *   optionalPool.length when positive); a required shortfall can never reach
 *   an AUTO verdict because the eligibility gate fails closed first. The
 *   post-construction required-coverage check is kept purely as a DEFENSIVE
 *   fail-closed invariant — the primary path is construction.
 *
 * Reform round 2 (external review P1-2) — CLARIFICATION IDENTITY BOUNDARY:
 * clarification forceGroupIds is mechanically validated BEFORE any lookup
 * (array / non-empty / string / canonical questionId / unique / eligible) with
 * NO String() coercion anywhere; every invalid clarification fails closed
 * with ONE fixed value-free rationale, so no caller-controlled value is ever
 * echoed into the decision artifact.
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
/** Reform F1: fail-closed identities for plan-intent hard gates. */
export const SELECTION_FAILURE_CONSTRAINT_UNEVALUABLE = 'selection_constraint_unevaluable';
export const SELECTION_FAILURE_PLAN_GROUP_KEY_UNSATISFIED = 'selection_plan_group_key_unsatisfied';
/** Reform F2: fail-closed identities for the pool planHash hard dependency. */
export const SELECTION_FAILURE_POOL_PLANHASH_MISSING = 'selection_pool_planhash_missing';
export const SELECTION_FAILURE_POOL_PLANHASH_MALFORMED = 'selection_pool_planhash_malformed';

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
 * canonical signal. A missing/non-finite rrfScore is an INVALID group: it
 * scores 0 for transparency but is marked ineligible (see buildCandidateGroups)
 * so it can never be silently auto-selected (fail-closed; never a fabricated
 * "clear best").
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
    // An invalid (missing/non-finite) rrfScore makes the group INELIGIBLE:
    // it must never be selectable. Eligible groups are gated in selectSourceGroups;
    // an all-invalid pool naturally lands in the no-valid-set fail-closed branch.
    const rrfValid = typeof c.rrfScore === 'number' && Number.isFinite(c.rrfScore);
    groups.push({
      questionId: String(c.identity.questionId),
      rrfScore: rrfValid ? c.rrfScore : null,
      score,
      eligible: rrfValid,
      sourceUrl: c.source_url ?? null,
      provenance: Array.isArray(c.ranks) ? c.ranks : [],
    });
  }
  groups.sort((a, b) => (b.score !== a.score ? b.score - a.score : compareQuestionId(a.questionId, b.questionId)));
  return { ok: true, groups };
}

/**
 * Canonical Zhihu questionId gate — EXACTLY matches T06 rrf.mjs
 * CANONICAL_QUESTION_ID (/^[1-9]\d*$/): canonical decimal integer,
 * no leading zeros, no length cap. One canonical definition across the
 * T06 pool boundary and the T08 selection boundary (V2 grounding CE-08).
 */
export function isCanonicalQuestionId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
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
 * - An intent with a non-empty `groupKey` binds ONLY by exact questionId match
 *   (strongest, deterministic). A non-empty-groupKey intent is NEVER
 *   positionally bound: its groupKey is a hard constraint enforced by the
 *   fail-closed groupKey gate in selectSourceGroups / resolveClarification.
 * - Remaining selected groups are bound, in order, to intents whose groupKey
 *   is null (rationale records only); those optional intents stay reported via
 *   intentCoverage (unmet / shortfall diagnostics).
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
  // Second pass: bind remaining selected groups ONLY to intents whose
  // groupKey is null (in plan order, as rationale records). An intent with a
  // non-empty groupKey is never positionally bound.
  let nextIntent = 0;
  for (const g of selectedGroups) {
    if (bindings.has(g.questionId)) continue;
    while (nextIntent < intents.length && (usedIntent.has(nextIntent) || isNonEmptyString(intents[nextIntent].groupKey))) nextIntent += 1;
    if (nextIntent < intents.length) {
      usedIntent.add(nextIntent);
      bindings.set(g.questionId, { intentIndex: nextIntent, groupKey: intents[nextIntent].groupKey ?? null });
      nextIntent += 1;
    }
  }
  return { bindings, unmet: intents.length - usedIntent.size };
}

/**
 * Reform F1 hard gate: count required (non-empty groupKey) plan intents that
 * cannot be bound to a DISTINCT group id from the given set (greedy, per-intent
 * in plan order; two intents may not share one group). Fixed rationale text
 * reports only the count — groupKey values are never echoed.
 */
function countUnsatisfiedRequiredGroupKeys(plan, groupIds) {
  const available = new Set(groupIds);
  const used = new Set();
  let unsatisfied = 0;
  for (const it of plan.sourceGroupIntents) {
    if (!isNonEmptyString(it.groupKey)) continue;
    if (available.has(it.groupKey) && !used.has(it.groupKey)) {
      used.add(it.groupKey);
    } else {
      unsatisfied += 1;
    }
  }
  return unsatisfied;
}

/** Fixed fail-closed rationale for the required-groupKey gate (count only, no values). */
function groupKeyUnsatisfiedRationale(unsatisfiedCount) {
  return `plan requires ${unsatisfiedCount} explicit source-group key(s) not satisfied by the eligible candidate pool (fail-closed)`;
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

  // 1b. Reform F1 constraints gate (immediately after plan validation, before
  // any pool work): constraints[] are FREE-FORM STRINGS with NO structured
  // semantics under plan schemaVersion 1 — they cannot be mechanically
  // evaluated, so they must fail closed instead of being silently treated as
  // satisfied. Fixed rationale text; constraint strings are never echoed.
  if (normalizedPlan.sourceGroupIntents.some((it) => Array.isArray(it.constraints) && it.constraints.length > 0)) {
    return failureVerdict(SELECTION_FAILURE_CONSTRAINT_UNEVALUABLE, {
      planHash: planIdentity,
      rationale:
        'plan intent constraints cannot be mechanically evaluated under plan schemaVersion 1 '
        + '(no structured constraint semantics); failing closed instead of treating them as satisfied',
    });
  }

  // 2. Pool validity.
  const built = buildCandidateGroups(pool);
  if (!built.ok) {
    return failureVerdict(built.reason, { planHash: planIdentity, poolPlanHash: pool?.planHash ?? null });
  }

  // 3. Plan/pool identity consistency (Spec §4.3 dependency identity).
  // Reform F2: the pool planHash is a HARD dependency identity. A missing or
  // malformed identity fails closed; untrusted raw values are never persisted
  // into the decision (a malformed identity is recorded as null).
  const poolPlanHash = pool?.planHash ?? null;
  if (!isNonEmptyString(poolPlanHash)) {
    return failureVerdict(SELECTION_FAILURE_POOL_PLANHASH_MISSING, {
      planHash: planIdentity,
      poolPlanHash: null,
      rationale: 'retrieval-pool artifact is missing its planHash dependency identity (fail-closed)',
    });
  }
  if (!isValidPlanHashFormat(poolPlanHash)) {
    return failureVerdict(SELECTION_FAILURE_POOL_PLANHASH_MALFORMED, {
      planHash: planIdentity,
      poolPlanHash: null,
      rationale: 'retrieval-pool planHash dependency identity is malformed (fail-closed); raw value not recorded',
    });
  }
  const planHashMatch = poolPlanHash === planIdentity;
  if (!planHashMatch) {
    return failureVerdict(SELECTION_FAILURE_PLAN_POOL_MISMATCH, {
      planHash: planIdentity,
      poolPlanHash,
      rationale: 'persisted plan identity does not match the retrieval-pool planHash (stale dependency)',
    });
  }

  // 4. Eligible candidate groups (minimum validity gate; D-5 bound).
  // A group is eligible only if its rrfScore is finite (valid) AND it clears
  // the minScore bound. Invalid groups are never selectable (fail-closed).
  const eligible = built.groups
    .map((g, idx) => ({ ...g, rankIndex: idx }))
    .filter((g) => g.eligible && g.score >= minScore);

  // 4b. Reform F1 groupKey hard gate (after eligible computation, BEFORE the
  // clarification branch): every intent with a non-empty groupKey must be
  // satisfiable by a DISTINCT eligible group. Any unsatisfied required key →
  // fail closed (fixed rationale, count only).
  const eligibleGateShortfall = countUnsatisfiedRequiredGroupKeys(normalizedPlan, eligible.map((g) => g.questionId));
  if (eligibleGateShortfall > 0) {
    return finalize({
      verdict: SELECT_VERDICT_NONE,
      reason: SELECTION_FAILURE_PLAN_GROUP_KEY_UNSATISFIED,
      planIdentity, poolPlanHash, planHashMatch,
      selectedGroups: [],
      eligible,
      clarification: null,
      clarificationCount: 0,
      normalizedPlan,
      intentShortfall: 0,
      rationale: groupKeyUnsatisfiedRationale(eligibleGateShortfall),
    });
  }

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

  // 7. Determine the intended group count k and CONSTRUCT the set
  // constraint-first (reform round 2 P1-1): required (groupKey) intents are
  // MANDATORY members resolved FIRST; the remaining free slots are filled
  // from eligible NON-required groups in the deterministic RRF order.
  const k = intendedGroupCount(normalizedPlan, opts);
  const takeAll = !Number.isFinite(k);

  // Step 4b already proved every distinct required groupKey binds to a
  // DISTINCT eligible group, so this filter yields exactly the mandatory set.
  const requiredKeySet = new Set(
    normalizedPlan.sourceGroupIntents
      .filter((it) => isNonEmptyString(it.groupKey))
      .map((it) => it.groupKey),
  );
  const requiredGroups = eligible.filter((g) => requiredKeySet.has(g.questionId));
  const optionalPool = eligible.filter((g) => !requiredKeySet.has(g.questionId));

  // PRECEDENCE: |requiredGroups| > k (including explicit groupCount=0 with
  // required keys) — required keys are MANDATORY and OUTRANK k: remainingSlots
  // floors at 0 and the selected set is exactly the required groups. k only
  // bounds the OPTIONAL fills.
  const remainingSlots = takeAll ? optionalPool.length : Math.max(0, k - requiredGroups.length);
  const optionalFills = optionalPool.slice(0, remainingSlots);
  const selected = [...requiredGroups, ...optionalFills].sort(
    (a, b) => (b.score !== a.score ? b.score - a.score : compareQuestionId(a.questionId, b.questionId)),
  );
  // intentShortfall is OPTIONAL shortfall only (required shortfall can never
  // reach here: the step 4b gate fails closed first). takeAll → 0.
  const intentShortfall = takeAll ? 0 : Math.max(0, remainingSlots - optionalPool.length);

  // Explicit zero-count (e.g. groupCount=0) with available candidates and NO
  // required keys → no set satisfies the requested scope → fail closed rather
  // than a misleading empty "clear best". With required keys the mandatory
  // members outrank k, so this branch is only reachable when the constraint-
  // first construction above produced an empty set.
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

  // 8. Material ambiguity: fuzzy boundary evaluated ONLY where an actual free-
  // selection boundary exists — optionalPool[remainingSlots-1] vs
  // optionalPool[remainingSlots] (eligible NON-required groups in RRF order).
  // remainingSlots === 0 (fully constrained set) or takeAll → no free boundary
  // → no ambiguity. A fuzzy gap BELOW the boundary among optional groups does
  // not trigger it: required membership never distorts the boundary logic.
  let ambiguous = false;
  let ambiguityMessage = null;
  if (!takeAll && remainingSlots > 0 && optionalPool.length > remainingSlots) {
    const lastIncluded = optionalPool[remainingSlots - 1];
    const firstExcluded = optionalPool[remainingSlots];
    if (lastIncluded.score - firstExcluded.score < ambiguityMargin) {
      ambiguous = true;
      ambiguityMessage =
        `material ambiguity: the free-selection boundary of the source-group set is fuzzy `
        + `(optional group ${lastIncluded.questionId} score ${lastIncluded.score} vs `
        + `excluded optional group ${firstExcluded.questionId} score ${firstExcluded.score}; `
        + `gap < ambiguity margin ${ambiguityMargin}) — auto-selecting would change the normalized research intent`;
    }
  }

  if (ambiguous) {
    // The clarification options must express a COMPLETE legal resolution: the
    // mandatory required groups plus the free-boundary optional candidates
    // (every optional group up to and including the first excluded one), in
    // the deterministic comparator order.
    const boundaryOptional = optionalPool.slice(0, remainingSlots + 1);
    const options = [...requiredGroups, ...boundaryOptional]
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : compareQuestionId(a.questionId, b.questionId)))
      .map((g) => ({
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
  // DEFENSIVE fail-closed invariant ONLY (reform round 2 P1-1): the primary
  // path is the constraint-first construction at step 7, which already
  // includes every required group as a mandatory member. This post-
  // construction coverage check is retained as a last-resort invariant guard;
  // valid AUTO outcomes reach here THROUGH CONSTRUCTION, never via this
  // branch. A required group that is eligible but not selected (e.g. outranked
  // at k) must NEVER be positionally rebound or reported satisfied.
  const selectedGateShortfall = countUnsatisfiedRequiredGroupKeys(normalizedPlan, selected.map((g) => g.questionId));
  if (selectedGateShortfall > 0) {
    return finalize({
      verdict: SELECT_VERDICT_NONE,
      reason: SELECTION_FAILURE_PLAN_GROUP_KEY_UNSATISFIED,
      planIdentity, poolPlanHash, planHashMatch,
      selectedGroups: [],
      eligible,
      clarification: null,
      clarificationCount: 0,
      normalizedPlan,
      intentShortfall: 0,
      rationale: groupKeyUnsatisfiedRationale(selectedGateShortfall),
    });
  }

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
 * Fixed value-free rationale for EVERY invalid clarification input (reform
 * round 2 P1-2): no raw forceGroupId, no attacker/user-controlled string, and
 * no credential-shaped data is ever echoed into the decision artifact.
 */
const CLARIFICATION_INVALID_RATIONALE =
  'clarification contains an invalid or unavailable source-group identity';

function invalidClarificationVerdict(planIdentity, poolPlanHash) {
  return failureVerdict(SELECTION_FAILURE_INVALID_CLARIFICATION, {
    planHash: planIdentity,
    poolPlanHash,
    rationale: CLARIFICATION_INVALID_RATIONALE,
  });
}

/**
 * Resolve a clarification answer (forceGroupIds). Honors the user's explicit
 * choice, never re-asks (clarificationCount becomes 1), and fails closed on
 * any invalid clarification input. This guarantees clarification_count <= 1.
 *
 * Reform round 2 (external review P1-2) — CLARIFICATION IDENTITY BOUNDARY:
 * forceGroupIds is mechanically validated BEFORE any lookup, in this order:
 *   1. is an Array (missing/non-array under a provided clarification object
 *      fails closed);
 *   2. non-empty;
 *   3. every item is a string (typeof — NO String() coercion anywhere);
 *   4. every item passes isCanonicalQuestionId (the canonical Zhihu
 *      questionId gate reused from T06);
 *   5. unique (no duplicates);
 *   6. every item references an ELIGIBLE group.
 * Every violation — malformed, duplicate, unknown, or ineligible — returns
 * SELECT_VERDICT_NONE / selection_invalid_clarification with the SAME fixed
 * value-free rationale (CLARIFICATION_INVALID_RATIONALE), so the persisted
 * decision can never carry a caller-controlled value.
 */
function resolveClarification({ eligible, normalizedPlan, planIdentity, poolPlanHash, planHashMatch, opts }) {
  const force = opts.clarification;
  const forceIds = Array.isArray(force?.forceGroupIds) ? force.forceGroupIds : null;
  if (forceIds === null || forceIds.length === 0) {
    // Missing/non-array, or empty (user selected nothing) — an empty success
    // verdict is never produced; fail closed with the fixed rationale.
    return invalidClarificationVerdict(planIdentity, poolPlanHash);
  }
  if (!forceIds.every((id) => typeof id === 'string')) {
    return invalidClarificationVerdict(planIdentity, poolPlanHash);
  }
  if (!forceIds.every((id) => isCanonicalQuestionId(id))) {
    return invalidClarificationVerdict(planIdentity, poolPlanHash);
  }
  if (new Set(forceIds).size !== forceIds.length) {
    return invalidClarificationVerdict(planIdentity, poolPlanHash);
  }
  const forced = [];
  for (const id of forceIds) {
    const g = eligible.find((e) => e.questionId === id);
    if (!g) {
      // Unknown or ineligible identity — validated above, so no echo needed:
      // the fixed rationale carries zero caller-controlled content.
      return invalidClarificationVerdict(planIdentity, poolPlanHash);
    }
    forced.push(g);
  }
  forced.sort((a, b) => (b.score !== a.score ? b.score - a.score : compareQuestionId(a.questionId, b.questionId)));

  // Reform F1 groupKey hard gate on the forced set: the user-selected set must
  // exactly cover every required (non-empty groupKey) intent with distinct
  // bindings — a forced resolution that leaves a required key unsatisfied
  // fails closed (count-only rationale; no groupKey values echoed).
  const forcedGateShortfall = countUnsatisfiedRequiredGroupKeys(normalizedPlan, forced.map((g) => g.questionId));
  if (forcedGateShortfall > 0) {
    return finalize({
      verdict: SELECT_VERDICT_NONE,
      reason: SELECTION_FAILURE_PLAN_GROUP_KEY_UNSATISFIED,
      planIdentity, poolPlanHash, planHashMatch,
      selectedGroups: [],
      eligible,
      clarification: null,
      clarificationCount: 0,
      normalizedPlan,
      intentShortfall: 0,
      rationale: groupKeyUnsatisfiedRationale(forcedGateShortfall),
    });
  }

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
 * ONLY when its planHash matches the CURRENT valid plan's planHash AND both
 * pool identities (decision.poolPlanHash and currentPoolPlanHash) are
 * syntactically valid planHashes that match each other. Reform F2: the pool
 * planHash is a HARD dependency identity — a missing identity is
 * `selection_dependency_missing`, a malformed one is
 * `selection_dependency_invalid`; an invalid identity NEVER implies reuse,
 * even when identical. Returns { reusable, stale, reason }.
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
  // Pool identity is a hard dependency: both sides must be format-valid
  // planHashes before any comparison (fail-closed reuse contract).
  const decisionPoolOk = isValidPlanHashFormat(decision.poolPlanHash);
  const currentPoolOk = isValidPlanHashFormat(currentPoolPlanHash);
  if (!decisionPoolOk || !currentPoolOk) {
    const isMissing = (h) => !(typeof h === 'string' && h.length > 0);
    const reason =
      isMissing(decision.poolPlanHash) || isMissing(currentPoolPlanHash)
        ? 'selection_dependency_missing'
        : 'selection_dependency_invalid';
    return { reusable: false, stale: true, reason };
  }
  if (decision.poolPlanHash !== currentPoolPlanHash) {
    return { reusable: false, stale: true, reason: 'selection_pool_hash_mismatch' };
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
