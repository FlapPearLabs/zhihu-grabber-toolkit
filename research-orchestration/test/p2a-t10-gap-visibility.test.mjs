// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p2a-t10-gap-visibility.test.mjs
 *
 * P2A-T10 (#122) — final-artifact visibility of the targeted-requery gap
 * terminals. Covers AC1–AC4 / REQUIRED_TESTS / COUNTEREXAMPLES of #122:
 *
 *   A  terminal visibility matrix — every terminal T08 can produce appears
 *      per-gap in the final artifact
 *   B  lineage round-trip — gapId → action → query → provider/capability → result
 *   C  STOP preservation — a run-level STOP leaves unresolved gaps visible
 *   D  budget exhaustion shows EXHAUSTED_WITHIN_BUDGET, never SATURATED
 *   E  path safety — an absolute path cannot reach the final artifact
 *   F  resolved/unresolved separation — a model claiming "resolved" cannot
 *      bypass T08's frozen predicate
 *   G  default / non-targeted compatibility — no behavioural change when the
 *      targeted path never ran
 *
 * HONEST SCOPE, stated up front so no reader over-reads this file:
 *   · The terminals asserted here are the ones T08's `classifyGapTerminal()` and
 *     `recordResolution()` actually produce. This file does NOT re-derive them —
 *     it drives the real T08 functions to obtain them, then asserts the
 *     visibility module renders what T08 decided. Terminal JUDGMENT is T08's
 *     (verified there); T10 only owns visibility.
 *   · `buildFinalDisclosure().gap` (source-analysis coverage) is a DIFFERENT
 *     object. Test G pins that this module neither reads nor overwrites it.
 *
 * The one thing this file deliberately does NOT claim: that the whole
 * finalizeResearchCoverage pipeline was exercised end-to-end. These are
 * focused unit tests over the T10 surface with real T08/T06 artifacts.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ACTION_STATUS_AUTHORIZED,
  ACTION_STATUS_COMMITTED,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
  createActionsArtifact,
  registerAuthorizedAction,
  prepareTargetedCommit,
} from '../lib/targeted-requery-lifecycle.mjs';

import { computeTargetedActionId } from '../lib/targeted-requery-authorization.mjs';

import {
  RESOLUTION_SCHEMA,
  RESOLUTION_PREDICATE_ASPECT,
  RESOLUTION_PREDICATE_NONE_REGISTERED,
  RESOLUTION_BASIS_DUPLICATE_ONLY,
  RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
  RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
  RESOLUTION_BASIS_RUN_SATURATED,
  RESOLUTION_BASIS_PER_GAP_BOUND_EXHAUSTED,
  RESOLUTION_BASIS_NO_NEW_EVIDENCE,
  createResolutionArtifact,
  recordResolution,
  classifyGapTerminal,
  finalizeGapsOnRunStop,
  isAllowedTerminalTriple,
  validateResolutionArtifact,
} from '../lib/targeted-requery-resolution.mjs';

import {
  GAP_VISIBILITY_ERROR_INVALID,
  GAP_TERMINALS,
  TARGETED_GAP_BLOCK_KEY,
  TARGETED_GAP_VISIBILITY_SCHEMA,
  buildTargetedResearchGapBlock,
  attachTargetedGapVisibility,
} from '../lib/targeted-requery-gap-visibility.mjs';

// ===========================================================================
// fixtures — built through the REAL T06 / T08 writers, never hand-forged
// ===========================================================================

const PLAN_HASH = 'a1'.repeat(32);
const OCCURRENCE = 'occ-p2a-t10';
const RUN_ID = 'run-p2a-t10';
const GAP_CORE = 'b2'.repeat(32);
const GAP_0 = `${GAP_CORE}:0`;
const GAP_1 = `${GAP_CORE}:1`;
const SCOPE = [{ providerId: 'official', capability: 'search' }];
const QUERY = 'zhihu answer quality';
const ARTIFACT_REL = 'targeted-requery-subphase/action-x/retrieval-pool.json';

// ---- fixture work dirs (T06's commit writer needs a real dir; all are removed) ----
const WORK_DIRS = [];

function freshWorkDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `p2a-t10-${tag}-`));
  WORK_DIRS.push(dir);
  return dir;
}

function freshState() {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    occurrenceId: OCCURRENCE,
    stage: 'SEARCH',
    completedStages: [],
    artifacts: {},
    hashes: {},
  };
}

function makeAction(overrides = {}) {
  const identity = {
    runId: RUN_ID,
    occurrenceId: OCCURRENCE,
    planHash: PLAN_HASH,
    gapId: GAP_0,
    attempt: 1,
    normalizedQuery: QUERY,
    providerScope: SCOPE,
    ...overrides,
  };
  const targetedActionId = computeTargetedActionId(identity);
  const decision = {
    status: ACTION_STATUS_AUTHORIZED,
    targetedActionId,
    runId: identity.runId,
    occurrenceId: identity.occurrenceId,
    planHash: identity.planHash,
    gapId: identity.gapId,
    gapIdentityCore: GAP_CORE,
    attempt: identity.attempt,
    query: identity.normalizedQuery,
    normalizedQuery: identity.normalizedQuery,
    queryTrustClass: 'PLAN_OWNED',
    providerScope: identity.providerScope,
    dedupeKey: 'c3'.repeat(32),
    actionChannelAttemptCount: 1,
    rejectionCode: null,
    rejectionDetail: null,
  };
  return { identity, decision, targetedActionId };
}

/** A committed action ledger carrying one action, written by the real T06 writers. */
function makeActionsArtifact({ committed = true, gapId = GAP_0, artifactRel = ARTIFACT_REL } = {}) {
  const { identity, decision, targetedActionId } = makeAction({ gapId });
  let artifact = createActionsArtifact({ planHash: PLAN_HASH, occurrenceId: OCCURRENCE });
  artifact = registerAuthorizedAction(artifact, decision);
  if (committed) {
    // T06 owns the ONLY write of `artifactRel` (it lands via the commit path), so
    // the fixture drives that real writer rather than poking the field. `workDir`
    // is a real temp dir; it is removed by the cleanup hook at the foot of this file.
    const workDir = freshWorkDir('actions');
    const prepared = prepareTargetedCommit({
      workDir,
      artifact,
      state: freshState(),
      targetedActionId,
      artifactRel,
      artifactBytes: Buffer.from('{"pool":[],"poolHash":"deadbeef"}', 'utf8'),
    });
    artifact = prepared.artifact;
  }
  return { artifact, targetedActionId, identity };
}

/** A resolution artifact written by the real T08 writer. */
function makeResolutionArtifact() {
  return createResolutionArtifact({ planHash: PLAN_HASH, occurrenceId: OCCURRENCE });
}

function expectRefusal(fn, label) {
  assert.throws(fn, (err) => err?.code === GAP_VISIBILITY_ERROR_INVALID, `${label} must fail closed`);
}

// ===========================================================================
// A — terminal visibility matrix
// ===========================================================================

test('A — every terminal T08 can produce is rendered per-gap in the final artifact', () => {
  const { artifact: actions } = makeActionsArtifact();
  let resolution = makeResolutionArtifact();

  // Three terminals obtained from T08's own classifier, not hand-written.
  const resolved = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_RESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
    },
    terminationReason: 'NONE',
    everAuthorized: true,
  });
  assert.equal(resolved.status, ACTION_STATUS_RESOLVED, 'fixture premise: T08 produced RESOLVED');

  const exhausted = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE,
    },
    terminationReason: 'PER_GAP_BOUND_EXHAUSTED',
    everAuthorized: true,
  });
  assert.equal(exhausted.status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET, 'fixture premise: T08 produced EXHAUSTED_WITHIN_BUDGET');

  // T08: for a NON-budget cause, the termination reason OWNS the basis. A run-level
  // SATURATION is therefore reported as UNRESOLVED / RUN_SATURATED — the basis records
  // that gain decayed; the status does NOT claim the gap was answered.
  const unknown = classifyGapTerminal({
    predicateResult: {
      status: ACTION_STATUS_UNRESOLVED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED,
      resolutionBasis: RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
    },
    terminationReason: 'RUN_SATURATED',
    everAuthorized: true,
  });
  assert.equal(unknown.status, ACTION_STATUS_UNRESOLVED, 'fixture premise: T08 produced UNRESOLVED');
  assert.equal(
    unknown.resolutionBasis,
    RESOLUTION_BASIS_RUN_SATURATED,
    'fixture premise: a non-budget termination owns the basis, per T08 G.5.1',
  );

  // Render all three into the resolution artifact through T08's writer.
  // A fourth gap carrying UNKNOWN_NO_AUTHORITY_PREDICATE verbatim. This basis is
  // only producible with the NONE_REGISTERED predicate (T08's closed triple table),
  // and it must reach the final artifact unaltered — it is the honest form of
  // "an authority gap nobody can resolve", which must never be rounded off.
  const gapsToRecord = [
    { ...resolved, gapId: GAP_0, predicateRef: RESOLUTION_PREDICATE_ASPECT },
    { ...exhausted, gapId: GAP_1, predicateRef: RESOLUTION_PREDICATE_ASPECT },
    { ...unknown, gapId: 'b2'.repeat(32) + ':2', predicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED },
    {
      gapId: 'b2'.repeat(32) + ':3',
      predicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED,
      status: ACTION_STATUS_UNRESOLVED,
      resolutionBasis: RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
    },
  ];
  for (const g of gapsToRecord) {
    resolution = recordResolution(resolution, {
      gapId: g.gapId,
      gapIdentityCore: GAP_CORE,
      targetedActionId: null,
      status: g.status,
      resolutionPredicateRef: g.predicateRef,
      resolutionBasis: g.resolutionBasis,
      planHash: PLAN_HASH,
      occurrenceId: OCCURRENCE,
    });
  }
  assert.equal(validateResolutionArtifact(resolution).ok, true, 'fixture premise: T08 artifact is valid');

  const block = buildTargetedResearchGapBlock({ resolutionArtifact: resolution, actionsArtifact: actions });

  assert.equal(block.schema, TARGETED_GAP_VISIBILITY_SCHEMA);
  assert.equal(block.gapCount, 4);
  assert.equal(block.resolvedCount, 1);
  assert.equal(block.unresolvedCount, 2);
  assert.equal(block.exhaustedWithinBudgetCount, 1);

  // Every gap is individually visible with its terminal + basis.
  const byId = new Map(block.gaps.map((g) => [g.gapId, g]));
  assert.equal(byId.get(GAP_0).status, ACTION_STATUS_RESOLVED);
  assert.equal(byId.get(GAP_0).resolutionPredicateRef, RESOLUTION_PREDICATE_ASPECT);
  assert.equal(byId.get(GAP_1).status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET);
  assert.equal(byId.get(GAP_1).resolutionBasis, RESOLUTION_BASIS_PER_GAP_BOUND_EXHAUSTED);
  assert.equal(byId.get(`${GAP_CORE}:2`).status, ACTION_STATUS_UNRESOLVED);
  assert.equal(
    byId.get(`${GAP_CORE}:2`).resolutionBasis,
    RESOLUTION_BASIS_RUN_SATURATED,
    'saturation is recorded as the basis for UNRESOLVED — the honest direction',
  );
  assert.equal(
    byId.get(`${GAP_CORE}:3`).resolutionBasis,
    RESOLUTION_BASIS_UNKNOWN_NO_AUTHORITY_PREDICATE,
    'UNKNOWN_NO_AUTHORITY_PREDICATE must survive to the final artifact verbatim',
  );

  // The three statuses present are exactly T08's closed terminal set.
  const statuses = new Set(block.gaps.map((g) => g.status));
  assert.deepEqual([...statuses].sort(), [...GAP_TERMINALS].sort());
});

// ===========================================================================
// D — budget exhaustion must never read as SATURATED
// ===========================================================================

test('D — EXHAUSTED_WITHIN_BUDGET stays EXHAUSTED_WITHIN_BUDGET and never becomes SATURATED', () => {
  const { artifact: actions } = makeActionsArtifact();
  let resolution = makeResolutionArtifact();

  // T08's G.5.1: a budget-class cause with an authorization is EXHAUSTED, and
  // RUN_SATURATED is deliberately NOT a budget-class cause.
  const exhausted = classifyGapTerminal({
    predicateResult: { status: ACTION_STATUS_UNRESOLVED, resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT, resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE },
    terminationReason: 'PER_GAP_BOUND_EXHAUSTED',
    everAuthorized: true,
  });
  const saturatedCause = classifyGapTerminal({
    predicateResult: { status: ACTION_STATUS_UNRESOLVED, resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT, resolutionBasis: RESOLUTION_BASIS_NO_NEW_EVIDENCE },
    terminationReason: 'RUN_SATURATED',
    everAuthorized: true,
  });
  assert.equal(exhausted.status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET);
  assert.equal(saturatedCause.status, ACTION_STATUS_UNRESOLVED, 'RUN_SATURATED yields UNRESOLVED, not exhausted');

  resolution = recordResolution(resolution, {
    gapId: GAP_0, gapIdentityCore: GAP_CORE, targetedActionId: null,
    status: exhausted.status, resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: exhausted.resolutionBasis, planHash: PLAN_HASH, occurrenceId: OCCURRENCE,
  });
  resolution = recordResolution(resolution, {
    gapId: GAP_1, gapIdentityCore: GAP_CORE, targetedActionId: null,
    status: saturatedCause.status, resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: saturatedCause.resolutionBasis, planHash: PLAN_HASH, occurrenceId: OCCURRENCE,
  });

  const block = buildTargetedResearchGapBlock({ resolutionArtifact: resolution, actionsArtifact: actions });
  const byId = new Map(block.gaps.map((g) => [g.gapId, g]));

  assert.equal(byId.get(GAP_0).status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET);
  assert.equal(byId.get(GAP_1).status, ACTION_STATUS_UNRESOLVED);
  // The word SATURATED survives only as a BASIS on an UNRESOLVED gap, never a status.
  for (const gap of block.gaps) {
    assert.notEqual(gap.status, 'SATURATED', 'SATURATED must never be a rendered gap status');
  }
  assert.equal(
    byId.get(GAP_1).resolutionBasis,
    RESOLUTION_BASIS_RUN_SATURATED,
    'saturation is recorded as the basis for UNRESOLVED — the honest direction',
  );
});

// ===========================================================================
// B — lineage round-trip
// ===========================================================================

test('B — lineage round-trips gapId → action → query → provider/capability → result', () => {
  const { artifact: actions, targetedActionId } = makeActionsArtifact();
  let resolution = makeResolutionArtifact();
  resolution = recordResolution(resolution, {
    gapId: GAP_0, gapIdentityCore: GAP_CORE, targetedActionId,
    status: ACTION_STATUS_UNRESOLVED, resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: RESOLUTION_BASIS_DUPLICATE_ONLY, planHash: PLAN_HASH, occurrenceId: OCCURRENCE,
  });

  const block = buildTargetedResearchGapBlock({ resolutionArtifact: resolution, actionsArtifact: actions });
  const gap = block.gaps[0];

  assert.equal(gap.lineageComplete, true, 'a fully linked gap reports complete lineage');
  assert.deepEqual(gap.missingActionIds, []);
  assert.equal(gap.lineage.length, 1);

  const link = gap.lineage[0];
  assert.equal(link.targetedActionId, targetedActionId, 'lineage joins the gap to the exact action');
  assert.equal(link.query, QUERY);
  assert.equal(link.resultArtifact, ARTIFACT_REL, 'the result ref is carried structurally, not narrated');
  assert.deepEqual(link.providerScope, SCOPE, 'providerId + capability are visible');
  assert.equal(link.actionStatus, ACTION_STATUS_COMMITTED);

  // Round-trip: the action id in the block resolves back through the ledger.
  const record = actions.targetedActions.find((r) => r.targetedActionId === targetedActionId);
  assert.ok(record, 'lineage id must resolve to a real action record');
  assert.equal(record.gapId, gap.gapId, 'the join is symmetric');
});

// ===========================================================================
// C — STOP preservation
// ===========================================================================

test('C — gaps survive a run-level STOP and stay visible with their real terminal', () => {
  const { artifact: actions } = makeActionsArtifact();

  // T08's H-8 finaliser: nothing is dropped, nothing stays non-terminal.
  const finalised = finalizeGapsOnRunStop({
    gaps: [
      { gapId: GAP_0, everAuthorized: true },
      { gapId: GAP_1, everAuthorized: false },
    ],
    runStopReason: 'RUN_BUDGET_STOP',
  });
  assert.equal(finalised.gaps.length, 2, 'fixture premise: STOP finalised both gaps');

  let resolution = makeResolutionArtifact();
  for (const g of finalised.gaps) {
    resolution = recordResolution(resolution, {
      gapId: g.gapId, gapIdentityCore: GAP_CORE, targetedActionId: null,
      status: g.status, resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      resolutionBasis: g.resolutionBasis, planHash: PLAN_HASH, occurrenceId: OCCURRENCE,
    });
  }

  const block = buildTargetedResearchGapBlock({ resolutionArtifact: resolution, actionsArtifact: actions });
  assert.equal(block.gapCount, 2, 'a run-level STOP must not drop a gap from the final artifact');
  const byId = new Map(block.gaps.map((g) => [g.gapId, g]));
  assert.equal(byId.get(GAP_0).status, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET, 'authorized + budget stop = exhausted');
  assert.equal(byId.get(GAP_1).status, ACTION_STATUS_UNRESOLVED, 'never-authorized + budget stop = UNRESOLVED, NOT exhausted');
});

// ===========================================================================
// E — path safety
// ===========================================================================

test('E — an absolute machine path cannot reach the final artifact', () => {
  const { artifact: actions, targetedActionId } = makeActionsArtifact();
  let resolution = makeResolutionArtifact();
  resolution = recordResolution(resolution, {
    gapId: GAP_0, gapIdentityCore: GAP_CORE, targetedActionId,
    status: ACTION_STATUS_UNRESOLVED, resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
    resolutionBasis: RESOLUTION_BASIS_DUPLICATE_ONLY, planHash: PLAN_HASH, occurrenceId: OCCURRENCE,
  });

  // Sanity: the untouched block carries no absolute path.
  const clean = buildTargetedResearchGapBlock({ resolutionArtifact: resolution, actionsArtifact: actions });
  assert.ok(!JSON.stringify(clean).includes('/Users/'), 'no absolute path in the clean render');

  // Defence in depth: T06's commit writer ALREADY refuses an absolute artifactRel
  // ("artifactRel escapes the work dir"), so a ledger carrying one cannot be built
  // through the real writer. That first layer is asserted here; the SECOND layer —
  // T10's own refusal — is asserted next by hand-building a ledger record whose
  // committed ref is absolute, which is what an unvalidated producer would hand us.
  const { decision, targetedActionId: badId } = makeAction({ gapId: GAP_0 });
  let badActions = createActionsArtifact({ planHash: PLAN_HASH, occurrenceId: OCCURRENCE });
  badActions = registerAuthorizedAction(badActions, decision);
  assert.throws(
    () => prepareTargetedCommit({
      workDir: freshWorkDir('badpath'),
      artifact: badActions,
      state: freshState(),
      targetedActionId: badId,
      artifactRel: '/Users/someone/.ssh/id_rsa',
      artifactBytes: Buffer.from('{"pool":[],"poolHash":"deadbeef"}', 'utf8'),
    }),
    (err) => typeof err?.message === 'string' && /escapes the work dir/.test(err.message),
    'T06 must already refuse an absolute artifactRel',
  );

  // Layer 2 — T10's own fence. Built by cloning a legitimately committed record and
  // rewriting ONLY its committed ref, which is exactly the "unvalidated producer"
  // input T10 must survive without leaking a path to the product surface.
  const good = makeActionsArtifact({ committed: true });
  const tampered = {
    ...good.artifact,
    targetedActions: good.artifact.targetedActions.map((r) => ({
      ...r,
      audit: r.audit.map((e) => ({ ...e, artifactRel: '/Users/someone/.ssh/id_rsa' })),
    })),
  };
  expectRefusal(
    () => buildTargetedResearchGapBlock({ resolutionArtifact: resolution, actionsArtifact: tampered }),
    'an absolute resultArtifact ref reaching T10',
  );
});

// ===========================================================================
// F — resolved/unresolved separation (frozen predicate cannot be bypassed)
// ===========================================================================

test('F — a caller cannot make a non-producible terminal visible', () => {
  const { artifact: actions } = makeActionsArtifact();
  const base = makeResolutionArtifact();

  // Layer 1: a RESOLVED carrying an UNKNOWN / duplicate basis. T08's closed triple
  // table cannot produce it (RESOLVED only pairs with NEW_EVIDENCE_ATTRIBUTED or
  // OPPOSING_SIDE_NEW_EVIDENCE). Assert BOTH that T08's own writer refuses it and
  // that T10's visibility fence refuses a hand-forged artifact carrying it.
  const badTriple = {
    ...base,
    resolutions: [{
      audit: [],
      evaluatedActionIds: [],
      gapId: GAP_0,
      gapIdentityCore: GAP_CORE,
      occurrenceId: OCCURRENCE,
      planHash: PLAN_HASH,
      resolutionBasis: RESOLUTION_BASIS_DUPLICATE_ONLY,
      resolutionPredicateRef: RESOLUTION_PREDICATE_ASPECT,
      status: ACTION_STATUS_RESOLVED,
      resolutionEvidence: [],
    }],
  };
  expectRefusal(
    () => buildTargetedResearchGapBlock({ resolutionArtifact: badTriple, actionsArtifact: actions }),
    'a hand-forged RESOLVED that T08 would not produce',
  );

  // Layer 2: RESOLVED paired with the NONE_REGISTERED predicate — the "no predicate
  // registered, therefore no resolution" case, which T08 explicitly forbids.
  const noPredicate = {
    ...base,
    resolutions: [{
      ...badTriple.resolutions[0],
      resolutionBasis: RESOLUTION_BASIS_NEW_EVIDENCE_ATTRIBUTED,
      resolutionPredicateRef: RESOLUTION_PREDICATE_NONE_REGISTERED,
    }],
  };
  expectRefusal(
    () => buildTargetedResearchGapBlock({ resolutionArtifact: noPredicate, actionsArtifact: actions }),
    'a RESOLVED carrying NONE_REGISTERED',
  );

  // Layer 3: a status outside the closed terminal set. 'SATURATED' is refused by the
  // visibility fence, which is how "a gap re-described as satisfied" is made
  // impossible rather than merely discouraged.
  //
  // Two independent fences reject this, and the second one is asserted here so the
  // suite does not credit one layer with work the other did. Disabling the
  // terminal-set check alone still leaves the file RED, because T08's
  // `isAllowedTerminalTriple` — the frozen authority T10 consumes rather than
  // copies — independently refuses every status that is not RESOLVED, UNRESOLVED or
  // EXHAUSTED_WITHIN_BUDGET. That redundancy is deliberate: a gap can never be
  // rendered as SATURATED even if one fence is removed.
  const saturated = { ...base, resolutions: [{ ...badTriple.resolutions[0], status: 'SATURATED' }] };
  expectRefusal(
    () => buildTargetedResearchGapBlock({ resolutionArtifact: saturated, actionsArtifact: actions }),
    'a gap rendered as SATURATED',
  );
  // Assert the redundancy explicitly, against T08's own table.
  assert.equal(
    isAllowedTerminalTriple('SATURATED', RESOLUTION_PREDICATE_ASPECT, RESOLUTION_BASIS_NO_NEW_EVIDENCE),
    false,
    'fixture premise: T08 itself forbids a SATURATED terminal, independently of any T10 fence',
  );
  assert.deepEqual(
    [...GAP_TERMINALS].sort(),
    [ACTION_STATUS_RESOLVED, ACTION_STATUS_UNRESOLVED, ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET].sort(),
    'fixture premise: the rendered terminal set is exactly the three T08 terminals — SATURATED is not among them',
  );
});

// ===========================================================================
// G — default / non-targeted compatibility (additive; does not touch `gap`)
// ===========================================================================

test('G — additive: attaching the block does not touch the existing gap field', () => {
  // The pre-existing final-artifact shape. `gap` here is SOURCE-ANALYSIS coverage.
  const finalLike = {
    schemaVersion: 2,
    assertion: { is100PercentAnalysis: false },
    gap: { missingAnalyzed: ['q1'], missingMapped: ['q1'] },
  };
  const before = JSON.parse(JSON.stringify(finalLike));

  const block = buildTargetedResearchGapBlock({
    resolutionArtifact: makeResolutionArtifact(),
    actionsArtifact: makeActionsArtifact().artifact,
  });
  const merged = attachTargetedGapVisibility(finalLike, block);

  // The existing gap field is byte-identical — additive only.
  assert.deepEqual(merged.gap, before.gap, 'source-analysis gap must be untouched');
  assert.ok(merged[TARGETED_GAP_BLOCK_KEY], 'the targeted block is present under its own key');
  assert.notEqual(TARGETED_GAP_BLOCK_KEY, 'gap', 'the two gap concepts must not share a name');
  assert.equal(finalLike[TARGETED_GAP_BLOCK_KEY], undefined, 'the input object is not mutated');

  // Empty targeted path → empty block, not a missing key (default path observably unchanged).
  const emptyBlock = buildTargetedResearchGapBlock({
    resolutionArtifact: makeResolutionArtifact(),
    actionsArtifact: makeActionsArtifact().artifact,
  });
  assert.equal(emptyBlock.gapCount, 0);
  assert.deepEqual(emptyBlock.gaps, []);
  assert.equal(emptyBlock.lineageComplete, true);
});

// ===========================================================================
// resource hygiene — remove every fixture work dir
// ===========================================================================
//
// Registered FIRST and alone. node:test skips later top-level `after` hooks once
// one fails, so a single cleanup hook placed first always runs; a second guard
// registered after it could be skipped on exactly the runs that matter.
after(() => {
  for (const dir of WORK_DIRS) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Non-vacuous: fails when no fixture ever created a dir, which would mean the
  // suite stopped exercising the real commit path and had become hollow.
  assert.ok(WORK_DIRS.length > 0, 'fixtures must actually have created work dirs for cleanup to be meaningful');
  assert.equal(
    WORK_DIRS.filter((d) => fs.existsSync(d)).length,
    0,
    'no fixture work dir may survive the suite',
  );
});

// ===========================================================================
// schema anchor — the block is versioned, so a consumer can pin it
// ===========================================================================

test('schema anchor — the emitted block is versioned and typed', () => {
  const { artifact: actions } = makeActionsArtifact();
  const block = buildTargetedResearchGapBlock({
    resolutionArtifact: makeResolutionArtifact(),
    actionsArtifact: actions,
  });
  assert.equal(block.schema, 'p2a-targeted-research-gaps/v1');
  assert.equal(block.schema, TARGETED_GAP_VISIBILITY_SCHEMA);
  assert.equal(RESOLUTION_SCHEMA, 'p2-ari-targeted-requery-resolution/v1', 'T08 schema consumed verbatim');
});
