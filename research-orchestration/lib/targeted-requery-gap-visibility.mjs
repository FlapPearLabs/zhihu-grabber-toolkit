// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-gap-visibility.mjs
 *
 * P2A-T10 (#122) — S10 final-artifact gap visibility. SEAM S10 / Seam Contract
 * F.4 + G.5 + H-8; Spec §13, §20-9, §20-11.
 *
 * WHAT THIS TICKET OWNS: the *visibility* of the targeted-requery gap terminals
 * that T08 already produced, inside the final research artifact.
 *
 * WHAT THIS TICKET DOES NOT OWN (and never re-implements):
 *   · terminal JUDGMENT — `classifyGapTerminal()` (T08) is the only authority.
 *     This module never decides a status; it renders what T08 decided.
 *   · terminal SEMANTICS — `RESOLUTION_BASES` / `TERMINATION_REASONS` (T08) are
 *     read here, never redefined.
 *   · run-level STOP finalisation — `finalizeGapsOnRunStop()` (T08).
 *   · gap IDENTITY — `computeTargetedActionId()` (T05/F.1) and
 *     `targetedBindingKey()` (T06) are CONSUMED, never recomputed here, and no
 *     second lineage model is introduced.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE BLOCK, AND WHY IT MUST NOT BE CALLED `gap`
 *
 * `coverage-final-integration.mjs` ALREADY has a `gap` field on the final
 * disclosure, and it means something else entirely:
 *
 *   existing `gap` = { missingAnalyzed, missingMapped }
 *                   = SOURCE-ANALYSIS COVERAGE gaps (which selected sources were
 *                     never mapped / analyzed). It is a T15 completeness concern.
 *
 *   THIS module's block = TARGETED-REQUERY RESEARCH gaps
 *                   = the gap ledger's own terminal states (RESOLVED /
 *                     UNRESOLVED / EXHAUSTED_WITHIN_BUDGET) each with its
 *                     `resolutionBasis`, plus mechanically traceable lineage.
 *
 * The two are different objects with different vocabularies and different
 * consumers. They are emitted under DIFFERENT, explicit names —
 * `targetedResearchGaps` vs the pre-existing `gap` — so no consumer can confuse
 * them and nothing existing is overwritten. This is the additive-only rule.
 *
 * ---------------------------------------------------------------------------
 * THE PRODUCT INVARIANT THIS MODULE EXISTS TO UPHOLD
 *
 * "An unresolved gap must never silently disappear, and must never be
 *  re-described as SATURATED." Two specific prohibitions, mechanically enforced
 *  below rather than asserted in prose:
 *
 *   P1  SATURATED IS NOT A GAP TERMINAL. `GAP_TERMINALS` (T08's closed set) has
 *       exactly three members and 'SATURATED' is not one of them. A status that
 *       is not a member is refused, so a gap can never be rendered as satisfied
 *       merely because the retrieval loop reported saturation. Note T08's
 *       `RESOLUTION_BASIS_RUN_SATURATED` is a *basis for UNRESOLVED*, never a
 *       status — that asymmetry is exactly the confusion being fenced off.
 *
 *   P2  EXHAUSTION IS NOT SATURATION. `EXHAUSTED_WITHIN_BUDGET` means the budget
 *       ran out before the gap was answered. Presenting that as SATURATED would
 *       claim "marginal gain decayed" when the truth is "we stopped paying".
 *       T08 owns the distinction (G.5.1); this module refuses to blur it and
 *       keeps the two vocabularies in separate fields.
 *
 * ---------------------------------------------------------------------------
 * LINEAGE (F.4) — STRUCTURAL, NOT NARRATIVE
 *
 * Every emitted gap carries a `lineage` array whose entries join, by value:
 *
 *   gapId → targetedActionId → query → providerId/capability → resultArtifact
 *
 * Each link is copied from the artifact that already owns it:
 *   · `targetedActionId` — from T08's `evaluatedActionIds` and the audit trail
 *   · `query` / `providerScope` — from the T06 action record
 *   · `resultArtifact` — from the T06 audit `artifactRel`, which is already a
 *     WORK-RELATIVE path (never an absolute one)
 *
 * A gap whose action id is NOT present in the supplied action ledger is still
 * emitted (its terminal is truth and must stay visible) but is marked
 * `lineageComplete: false` with the missing id listed. Dropping it would be the
 * silent disappearance this ticket forbids; inventing a link would be a lie.
 *
 * PATH SAFETY: every emitted string is checked against the shared boundary-safety
 * helper before it leaves this module, so a credential shape or a multi-component
 * machine path cannot reach the final artifact even if a caller supplies one.
 * `resultArtifact` gets a stricter, locally-owned check (work-relative, no drive
 * letter, no `..`). HONEST SCOPE OF THAT GUARANTEE: the shared helper's private-path
 * rule needs two or more path components, so a single-component root such as `/tmp`
 * or `/etc` is NOT rejected by it. Claiming otherwise would be an overclaim — the
 * guarantee is "no credential and no multi-component private path", not "no absolute
 * string of any shape".
 */

import { isBoundarySafeString } from './rrf.mjs';
import {
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
} from './targeted-requery-lifecycle.mjs';
import {
  RESOLUTION_BASES,
  RESOLUTION_PREDICATES,
  isAllowedTerminalTriple,
} from './targeted-requery-resolution.mjs';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Typed error code for every fail-closed refusal in this module. */
export const GAP_VISIBILITY_ERROR_INVALID = 'p2a_targeted_gap_visibility_invalid';

/** The schema id written into the final artifact's targeted-gap block. */
export const TARGETED_GAP_VISIBILITY_SCHEMA = 'p2a-targeted-research-gaps/v1';

/**
 * The name this block takes in the final artifact. Deliberately NOT `gap` —
 * see the header. `gap` already means source-analysis coverage.
 */
export const TARGETED_GAP_BLOCK_KEY = 'targetedResearchGaps';

/**
 * T08's closed terminal set, re-declared as a CONSTANT rather than imported as
 * a mutable binding so a downstream edit to T08's internal list cannot silently
 * widen what this module will render. `validateResolutionArtifact` already
 * refuses any status outside the three; this is the second, independent fence.
 */
export const GAP_TERMINALS = Object.freeze([
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
]);

/** The exact key set of the emitted block itself. Order is the frozen emit order. */
export const TARGETED_GAP_BLOCK_KEYS = Object.freeze([
  'exhaustedWithinBudgetCount',
  'gapCount',
  'gaps',
  'lineageComplete',
  'resolvedCount',
  'schema',
  'unresolvedCount',
]);

/** The exact key set of one emitted gap entry. Order is the frozen emit order. */
export const TARGETED_GAP_ENTRY_KEYS = Object.freeze([
  'gapId',
  'gapIdentityCore',
  'lineage',
  'lineageComplete',
  'missingActionIds',
  'occurrenceId',
  'planHash',
  'resolutionBasis',
  'resolutionEvidence',
  'resolutionPredicateRef',
  'status',
]);

/** The exact key set of one lineage entry. */
export const TARGETED_GAP_LINEAGE_KEYS = Object.freeze([
  'actionStatus',
  'attempt',
  'providerScope',
  'query',
  'resultArtifact',
  'targetedActionId',
]);

const HEX64 = /^[0-9a-f]{64}$/;
const GAP_ID_SHAPE = /^[0-9a-f]{64}:\d+$/;

// ---------------------------------------------------------------------------
// module-private helpers
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function visibilityError(message) {
  const err = new Error(message);
  err.code = GAP_VISIBILITY_ERROR_INVALID;
  return err;
}

/**
 * Every string that leaves this module passes through here. Absolute paths,
 * temp dirs and home directories are all machine-private, and the final artifact
 * is a product surface — so this is enforced structurally, not by convention.
 *
 * NO `String()` COERCION. Coercing first would launder a missing or non-string
 * value into a truthy literal — `String(undefined)` is `"undefined"`, which is
 * non-empty AND boundary-safe, so a field that was never set would sail through a
 * check this module documents as fail-closed. A value that is not already a string
 * is refused, because "absent" and "present but malformed" must both fail.
 */
function requireSafeString(value, label) {
  if (typeof value !== 'string') {
    throw visibilityError(`${label} must be a string, got ${value === null ? 'null' : typeof value}`);
  }
  if (!isNonEmptyString(value)) throw visibilityError(`${label} must be a non-empty string`);
  if (!isBoundarySafeString(value)) {
    throw visibilityError(`${label} must be boundary-safe (no machine-private path, no credential shape)`);
  }
  return value;
}

/**
 * A result artifact reference must be WORK-RELATIVE.
 *
 * TWO DISTINCT CHECKS, and keeping them separate is what makes each one testable:
 *   1. `requireNonEmptyRef` — shape only (a non-empty string). It deliberately does
 *      NOT consult the shared boundary helper, so this function is the ONLY place
 *      an absolute machine path can be refused on the `resultArtifact` field.
 *   2. the work-relative rule below — absolute / drive-letter / `~` / `..` are all
 *      refused.
 *
 * Why not fold the shared `isBoundarySafeString` in here: it would already reject
 * `/Users/...` and make check 2 dead code that no test could distinguish from a
 * no-op. Keeping the responsibility local means a mutation that disables check 2
 * is caught HERE, by this module, rather than silently absorbed by an upstream
 * policy that a future change could widen. Other emitted strings (gapId, query,
 * provider ids) do go through `requireSafeString` — this field gets the stricter,
 * independently-owned treatment because it is the one most likely to carry a path
 * out of the product surface.
 */
function requireWorkRelativeRef(value, label) {
  if (!isNonEmptyString(value)) throw visibilityError(`${label} must be a non-empty string`);
  if (value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw visibilityError(`${label} must be a work-relative ref, never an absolute path`);
  }
  if (value.split(/[\\/]/).includes('..')) {
    throw visibilityError(`${label} must not escape the work dir via '..'`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// the builder
// ---------------------------------------------------------------------------

/**
 * Build the targeted-research-gap visibility block for the final artifact.
 *
 * Additive by construction: this returns a NEW top-level block and touches
 * nothing else. A run that never entered the targeted path yields an empty
 * `gaps` array rather than a missing key, so the default (non-targeted) product
 * behaviour is observably unchanged.
 *
 * @param {object}  args
 * @param {object}  args.resolutionArtifact  T08's `targeted-requery-resolution.json`
 *                                           content — the ONLY source of terminals.
 * @param {object}  args.actionsArtifact     T06's `targeted-requery-actions.json`
 *                                           content — the ONLY source of lineage.
 * @param {string} [args.occurrenceId]       run anchor, when the caller has one.
 * @returns {{ schema: string, gapCount: number, resolvedCount: number,
 *             unresolvedCount: number, exhaustedWithinBudgetCount: number,
 *             lineageComplete: boolean, gaps: object[] }}
 */
export function buildTargetedResearchGapBlock({ resolutionArtifact, actionsArtifact, occurrenceId = null } = {}) {
  if (!isPlainObject(resolutionArtifact)) {
    throw visibilityError('resolutionArtifact (T08) is required: this module never judges a terminal itself');
  }
  if (resolutionArtifact.schema !== 'p2-ari-targeted-requery-resolution/v1') {
    throw visibilityError('resolutionArtifact is not a T08 targeted-requery-resolution artifact');
  }
  if (!Array.isArray(resolutionArtifact.resolutions)) {
    throw visibilityError('resolutionArtifact.resolutions must be an array');
  }
  if (!isPlainObject(actionsArtifact)) {
    throw visibilityError('actionsArtifact (T06) is required for lineage');
  }
  if (!Array.isArray(actionsArtifact.targetedActions)) {
    throw visibilityError('actionsArtifact.targetedActions must be an array');
  }

  const planHash = requireSafeString(resolutionArtifact.planHash, 'resolutionArtifact.planHash');
  const artifactOccurrence = requireSafeString(resolutionArtifact.occurrenceId, 'resolutionArtifact.occurrenceId');
  if (occurrenceId !== null && occurrenceId !== artifactOccurrence) {
    throw visibilityError('occurrenceId does not match the resolution artifact anchor');
  }
  if (actionsArtifact.planHash !== planHash) {
    throw visibilityError('actionsArtifact is anchored to a different planHash than the resolution artifact');
  }

  // ---- index the action ledger by id so each gap's lineage is a lookup, not a guess
  const actionById = new Map();
  for (const record of actionsArtifact.targetedActions) {
    if (!isPlainObject(record) || !isNonEmptyString(record.targetedActionId)) {
      throw visibilityError('every action record needs a targetedActionId');
    }
    if (actionById.has(record.targetedActionId)) {
      throw visibilityError(`duplicate targetedActionId in the action ledger: ${record.targetedActionId}`);
    }
    actionById.set(record.targetedActionId, record);
  }

  // Deterministic ascending gapId order, so the emitted block is byte-deterministic.
  const ordered = [...resolutionArtifact.resolutions].sort((a, b) => (
    a?.gapId < b?.gapId ? -1 : a?.gapId > b?.gapId ? 1 : 0
  ));

  const emitted = [];
  const seenGapIds = new Set();

  for (const record of ordered) {
    if (!isPlainObject(record)) throw visibilityError('every resolution record must be a plain object');
    const gapId = record.gapId;
    if (!isNonEmptyString(gapId) || !GAP_ID_SHAPE.test(gapId)) {
      throw visibilityError('every resolution record needs a well-formed gapId');
    }
    if (seenGapIds.has(gapId)) {
      throw visibilityError(`duplicate gapId in the resolution artifact: ${gapId}`);
    }
    seenGapIds.add(gapId);

    // ---- P1/P2 fence: only T08's three terminals may be rendered. A status like
    // 'SATURATED' is refused here rather than displayed, which is how "a gap was
    // re-described as satisfied" is made impossible instead of merely discouraged.
    const status = record.status;
    if (!GAP_TERMINALS.includes(status)) {
      throw visibilityError(
        `gap ${gapId} carries status "${String(status)}" which is not a gap terminal; `
        + 'SATURATED is not a terminal and a gap terminal is never re-described',
      );
    }

    const basis = record.resolutionBasis;
    if (basis !== null && basis !== undefined) {
      if (!RESOLUTION_BASES.includes(basis)) {
        throw visibilityError(`gap ${gapId} carries a resolutionBasis outside T08's closed set: ${String(basis)}`);
      }
    }
    const predicateRef = record.resolutionPredicateRef;
    if (predicateRef !== null && predicateRef !== undefined) {
      if (!RESOLUTION_PREDICATES.includes(predicateRef)) {
        throw visibilityError(`gap ${gapId} carries a resolutionPredicateRef outside T08's closed set: ${String(predicateRef)}`);
      }
    }

    // Defence in depth, third layer: membership of each closed set is not enough —
    // the COMBINATION must be one T08's frozen predicates can actually produce.
    // T08 owns that table (`isAllowedTerminalTriple`); it is consumed here, never
    // copied, so a hand-forged "RESOLVED with a duplicate-only basis" is refused at
    // the product surface even if it somehow reached this module.
    if (!isAllowedTerminalTriple(status, predicateRef ?? null, basis ?? null)) {
      throw visibilityError(
        `gap ${gapId} carries a terminal triple T08's frozen predicates cannot produce `
        + `(status=${status}, predicateRef=${String(predicateRef)}, basis=${String(basis)})`,
      );
    }

    // Identity is CONSUMED, never redefined — but "consumed faithfully" is not the
    // same as "consistent". E.2 defines `gapId = gapIdentityCore + ':' + diagnosisRound`,
    // so a pair where the id does not start with the core is self-contradictory and
    // would put two disagreeing identity claims on the product surface. Verified here
    // rather than assumed, because T08's own validator is not on this path.
    const gapIdentityCore = requireSafeString(record.gapIdentityCore, `gap[${gapId}].gapIdentityCore`);
    if (!/^[0-9a-f]{64}$/.test(gapIdentityCore)) {
      throw visibilityError(`gap[${gapId}].gapIdentityCore must be 64 lowercase hex characters`);
    }
    if (!gapId.startsWith(`${gapIdentityCore}:`)) {
      throw visibilityError(
        `gap[${gapId}] does not derive from its gapIdentityCore (${gapIdentityCore})`,
      );
    }

    if (record.planHash !== planHash) {
      throw visibilityError(`gap ${gapId} is anchored to a different planHash than the artifact`);
    }
    if (record.occurrenceId !== artifactOccurrence) {
      throw visibilityError(`gap ${gapId} is anchored to a different occurrence than the artifact`);
    }

    // ---- lineage (F.4). Built from the ids T08 actually recorded, then joined to
    // the action ledger for query / provider / result. Never reconstructed.
    const actionIds = [...new Set([
      ...(Array.isArray(record.evaluatedActionIds) ? record.evaluatedActionIds : []),
      ...(Array.isArray(record.audit)
        ? record.audit.map((e) => e?.targetedActionId).filter((v) => v !== null && v !== undefined)
        : []),
    ])].filter((v) => isNonEmptyString(v));

    for (const id of actionIds) {
      if (!HEX64.test(id)) throw visibilityError(`gap ${gapId} references a malformed targetedActionId: ${id}`);
    }
    actionIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const lineage = [];
    const missingActionIds = [];
    for (const id of actionIds) {
      const action = actionById.get(id);
      if (action === undefined) {
        // Terminal stays visible; the link is declared missing rather than faked.
        missingActionIds.push(id);
        continue;
      }
      if (action.gapId !== gapId) {
        throw visibilityError(`action ${id} is bound to gap ${action.gapId} but surfaced under gap ${gapId}`);
      }
      const committed = (Array.isArray(action.audit) ? action.audit : [])
        .filter((e) => isNonEmptyString(e?.artifactRel))
        .map((e) => e.artifactRel)
        .pop() ?? null;

      lineage.push({
        actionStatus: requireSafeString(action.status, `lineage[${id}].actionStatus`),
        attempt: Number.isSafeInteger(action.attempt) && action.attempt > 0 ? action.attempt : null,
        providerScope: normalizeScope(action.providerScope, `lineage[${id}].providerScope`),
        query: requireSafeString(action.normalizedQuery, `lineage[${id}].query`),
        resultArtifact: committed === null
          ? null
          : requireWorkRelativeRef(committed, `lineage[${id}].resultArtifact`),
        targetedActionId: id,
      });
    }

    const entry = {
      gapId,
      gapIdentityCore,
      lineage,
      // Per-gap completeness carries the same honesty as the block-level flag: a gap
      // with no recorded action has no chain to be complete about, so it reports false
      // rather than a vacuous true.
      lineageComplete: missingActionIds.length === 0 && lineage.length > 0,
      missingActionIds,
      occurrenceId: artifactOccurrence,
      planHash,
      resolutionBasis: basis ?? null,
      resolutionEvidence: normalizeEvidence(record.resolutionEvidence, gapId),
      resolutionPredicateRef: predicateRef ?? null,
      status,
    };

    if (!hasExactKeys(entry, TARGETED_GAP_ENTRY_KEYS)) {
      throw visibilityError(`emitted gap ${gapId} does not match the frozen key set`);
    }
    emitted.push(entry);
  }

  // `lineageComplete` means "every recorded action id resolved AND at least one link
  // exists when the gap was ever authorized". A gap that was NEVER authorized has no
  // action to link, and calling that complete would overstate what is known — the
  // honest value is false, with the reason carried by an empty `lineage`.
  const block = {
    schema: TARGETED_GAP_VISIBILITY_SCHEMA,
    gapCount: emitted.length,
    resolvedCount: countBy(emitted, ACTION_STATUS_RESOLVED),
    unresolvedCount: countBy(emitted, ACTION_STATUS_UNRESOLVED),
    exhaustedWithinBudgetCount: countBy(emitted, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET),
    lineageComplete: emitted.every((g) => g.lineageComplete && g.lineage.length > 0),
    gaps: emitted,
  };
  // The builder holds itself to the same contract the seam enforces, so a drift in
  // either direction fails here first.
  return assertWellFormedBlock(block);
}

/**
 * Attach the visibility block to a final-artifact-shaped object WITHOUT touching
 * any existing key. Returns a new object; the input is not mutated. This is the
 * additive seam T10 owns — `gap` (source-analysis coverage) is left exactly as
 * the caller supplied it.
 *
 * This is the LAST function before the product surface, so it re-validates rather
 * than trusting: an earlier draft accepted any object with a `gaps` array, which
 * meant a caller that mis-built a block could attach `status: 'SATURATED'` or a
 * counter that disagreed with the array, and the error text promised a check that
 * did not exist. The schema id, the terminal set and the counters are therefore
 * all verified HERE, so the "mechanically enforced, not asserted in prose" claim
 * holds at the seam and not merely inside the builder.
 */
export function attachTargetedGapVisibility(finalArtifactLike, block) {
  if (!isPlainObject(finalArtifactLike)) throw visibilityError('final artifact must be a plain object');
  assertWellFormedBlock(block);
  if (finalArtifactLike[TARGETED_GAP_BLOCK_KEY] !== undefined) {
    throw visibilityError(`final artifact already carries a ${TARGETED_GAP_BLOCK_KEY} block; refusing to overwrite`);
  }
  return { ...finalArtifactLike, [TARGETED_GAP_BLOCK_KEY]: block };
}

/**
 * The block's own shape contract, enforced at the seam. Every claim a consumer
 * would read off the block (`schema`, the four counters, the per-gap terminals) is
 * checked against what the block actually carries, so a hand-built or drifted block
 * cannot reach the artifact.
 */
function assertWellFormedBlock(block) {
  if (!isPlainObject(block)) throw visibilityError('block must be a buildTargetedResearchGapBlock() result');
  if (block.schema !== TARGETED_GAP_VISIBILITY_SCHEMA) {
    throw visibilityError(`block schema must be ${TARGETED_GAP_VISIBILITY_SCHEMA}, got ${String(block.schema)}`);
  }
  if (!Array.isArray(block.gaps)) throw visibilityError('block.gaps must be an array');
  if (typeof block.lineageComplete !== 'boolean') {
    throw visibilityError('block.lineageComplete must be a boolean');
  }
  for (const counter of ['gapCount', 'resolvedCount', 'unresolvedCount', 'exhaustedWithinBudgetCount']) {
    if (!Number.isSafeInteger(block[counter]) || block[counter] < 0) {
      throw visibilityError(`block.${counter} must be a non-negative integer`);
    }
  }
  if (!hasExactKeys(block, TARGETED_GAP_BLOCK_KEYS)) {
    throw visibilityError('block does not match the frozen top-level key set');
  }
  for (const gap of block.gaps) {
    if (!isPlainObject(gap) || !hasExactKeys(gap, TARGETED_GAP_ENTRY_KEYS)) {
      throw visibilityError('every block gap must match the frozen entry key set');
    }
    if (!GAP_TERMINALS.includes(gap.status)) {
      throw visibilityError(`block gap ${String(gap.gapId)} carries a non-terminal status: ${String(gap.status)}`);
    }
    if (!Array.isArray(gap.lineage) || !Array.isArray(gap.missingActionIds)) {
      throw visibilityError(`block gap ${String(gap.gapId)} must carry lineage and missingActionIds arrays`);
    }
    // Per-gap completeness is a DERIVED claim, so the seam checks the derivation
    // rather than the type. A hand-edited `lineageComplete: true` over a gap with no
    // link is exactly the overstatement this ticket exists to prevent, and it would
    // otherwise reach the product unchecked.
    const derived = gap.missingActionIds.length === 0 && gap.lineage.length > 0;
    if (gap.lineageComplete !== derived) {
      throw visibilityError(
        `block gap ${String(gap.gapId)} reports lineageComplete=${String(gap.lineageComplete)} `
        + `but its lineage/missingActionIds derive ${String(derived)}`,
      );
    }
  }
  // Counters are part of the contract a consumer reads; they must not disagree with
  // the array they summarise.
  if (block.gapCount !== block.gaps.length) throw visibilityError('block.gapCount disagrees with block.gaps.length');
  if (block.resolvedCount !== countBy(block.gaps, ACTION_STATUS_RESOLVED)) {
    throw visibilityError('block.resolvedCount disagrees with the gaps it summarises');
  }
  if (block.unresolvedCount !== countBy(block.gaps, ACTION_STATUS_UNRESOLVED)) {
    throw visibilityError('block.unresolvedCount disagrees with the gaps it summarises');
  }
  if (block.exhaustedWithinBudgetCount !== countBy(block.gaps, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET)) {
    throw visibilityError('block.exhaustedWithinBudgetCount disagrees with the gaps it summarises');
  }
  return block;
}

function countBy(gaps, status) {
  return gaps.filter((g) => g.status === status).length;
}

function hasExactKeys(obj, keys) {
  const actual = Object.keys(obj).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((k, i) => k === expected[i]);
}

/**
 * A provider scope is part of the F.4 chain (providerId + capability), so an empty
 * or absent one is a MISSING LINK, not an empty list. T06 requires the scope to be a
 * non-empty array on every committed record; this therefore refuses rather than
 * emitting `[]`, which would let the block report `lineageComplete: true` while the
 * provider link had silently vanished. Refusing keeps the completeness claim honest.
 */
function normalizeScope(scope, label) {
  if (!Array.isArray(scope) || scope.length === 0) {
    throw visibilityError(`${label} must be a non-empty array of channel descriptors`);
  }
  return scope.map((entry) => {
    if (!isPlainObject(entry)) throw visibilityError(`${label} entries must be plain objects`);
    return {
      capability: requireSafeString(entry.capability, `${label}.capability`),
      providerId: requireSafeString(entry.providerId, `${label}.providerId`),
    };
  }).sort((a, b) => (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0));
}

function normalizeEvidence(evidence, gapId) {
  if (evidence === null || evidence === undefined) return [];
  if (!Array.isArray(evidence)) throw visibilityError(`gap[${gapId}].resolutionEvidence must be an array`);
  return [...new Set(evidence.map((v) => requireSafeString(v, `gap[${gapId}].resolutionEvidence[]`)))]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
