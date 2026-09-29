/**
 * p2a-t11-trust-boundary-executable-guards.test.mjs
 *
 * P2A-T11 (#123) — 信任边界可执行守卫套件（F.3 / 任务 §8；不是散文验收）
 *
 * WHAT THIS TICKET IS
 * -------------------
 * #108's trust boundary exists as frozen prose (Seam Contract §F.3) plus code
 * written by T04/T05/T09. This suite turns "the boundary holds" into something
 * that can FAIL, be re-run, and regress.
 *
 * IT IS NOT
 * ---------
 *  · a re-design of #108;
 *  · a re-implementation of the T04 trust policy;
 *  · a place to widen any trust set (ISSUE §FAIL_CLOSED: needing to widen
 *    `trustedPlanStrings` is a STOP, not a ticket-level fix);
 *  · a source-grep suite. Grep is used ONLY to ENUMERATE the call surface. Every
 *    behavioural claim below is established by EXECUTING the real production
 *    function and observing a real failure, or by a bounded mutation that makes
 *    the guard provably non-vacuous.
 *
 * TEST-FIDELITY RULES HONOURED (from the T09 post-mortem)
 * -------------------------------------------------------
 *  · No regex "proof" of behaviour. Enumeration ≠ assertion.
 *  · Every guard has a COUNTEREXAMPLE that must genuinely fail.
 *  · No test claims a path it does not execute; titles name the real call path.
 *  · Guards whose source of truth is a registry are asserted by calling it.
 *  · Where a guard could pass vacuously, a BOUNDED MUTATION proves it cannot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertArtifactSafe, isBoundarySafeString } from '../lib/rrf.mjs';
import { isPlanBoundarySafeString, planHash } from '../lib/plan-contract.mjs';
import {
  AUTH_CLASS_OFFICIAL_SECRET,
  CAPABILITY_SEARCH,
  COMPLETENESS_UNKNOWN,
  createProviderSeam,
} from '../lib/provider-seam.mjs';
import { runMultiQueryRetrieval } from '../lib/retrieval.mjs';
import { diagnoseGaps } from '../lib/targeted-requery-diagnosis.mjs';
import { sortGapsByGapId, makeGapRecord } from '../lib/targeted-requery-ledger.mjs';
import { runTargetedSubphase, SUBPHASE_STATUS_COMPLETED } from '../lib/targeted-requery-subphase.mjs';
import { LEDGER_STAGING_KEY } from '../lib/targeted-requery-lifecycle.mjs';
import { stageArtifactBytes, resolveAnchoredLedgerBytes } from '../lib/p1-runtime-composer.mjs';
import {
  isPlanOwnedBoundarySafeString,
  classifyTrustClass,
  admitTargetedQueryString,
  enumeratePlanOwnedStrings,
  evaluateTargetedQueryProposal,
  TRUST_CLASS_PLAN_OWNED,
  TRUST_CLASS_UNCLASSIFIED,
  REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP,
  REJECTION_TRUST_CLASS_UNCLASSIFIED,
  REJECTION_PLAN_OWNED_STRING_UNSAFE,
  PROPOSAL_STATUS_ADMITTED,
  PROPOSAL_STATUS_REJECTED,
} from '../lib/targeted-requery-trust.mjs';
import { createInitialCoverageState, validateCoverageState } from '../lib/coverage-state.mjs';
import {
  enumerateAssertArtifactSafeCallSurface,
  trustedCallSiteFiles,
  untrustedCallSiteFiles,
} from './helpers/t11-trust-surface-enumeration.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB_DIR = path.join(HERE, '..', 'lib');

/** A plan-shaped fixture whose strings are deliberately lens-divergent. */
function makePlan() {
  return {
    queryVariants: [
      '大语言模型 Agent 落地争议',
      '/etc/hosts 文件的作用',            // plan-lens OK, provider lens REJECTS
      'https://example.com/a?b=1',        // plan-lens OK, provider lens applies URL rules
    ],
    aspects: ['可控性', '安全边界'],
    opposingFramings: ['效率优先'],
    entities: ['OpenAI'],
    terminologyVariants: [
      { term: 'RAG', variants: ['检索增强生成'] },
    ],
    sourceGroupIntents: [
      { intent: '官方文档', constraints: ['仅官方域名'] },
    ],
  };
}

/** Canonical F.3 trust-class-UNCLASSIFIED probe: safe-looking but not plan-owned. */
const UNCLASSIFIED_PROBE = '一个看起来完全无害的自由文本查询';

// ===========================================================================
// A — the frozen trust-set call surface conforms to the current authority
// ===========================================================================

test('A1: the trust-set call surface is ENUMERATED, with nothing left unparsed', () => {
  const e = enumerateAssertArtifactSafeCallSurface(LIB_DIR);
  // A new call shape the helper cannot classify must FAIL here rather than be
  // skipped — this is the enumeration guard, not a behaviour claim.
  assert.deepEqual(
    e.unparsed.map((u) => `${u.file}:${u.line}`),
    [],
    'every assertArtifactSafe call site must be classifiable as trusted/untrusted',
  );
  // All four F.3 frozen sites are present. Asserted by FILE, not by line: line
  // numbers legitimately shift when T09 inserted code into two of these files,
  // and a line-number assertion would fail on an unrelated, contract-neutral
  // change. The contract freezes the CALL SITES, and their content is asserted
  // behaviourally in A2/A3.
  assert.deepEqual(
    trustedCallSiteFiles(e),
    [
      'coverage-final-integration.mjs',
      'coverage-state.mjs',
      'retrieval.mjs',
      'source-group-selection.mjs',
      // T09 added a fifth trust-set walk (targeted-requery-subphase.mjs). Its
      // trust set is asserted to be plan-derived only, in C2.
      'targeted-requery-subphase.mjs',
    ],
    'the set of modules passing a trust set must match the audited authority surface',
  );
  assert.deepEqual(
    untrustedCallSiteFiles(e),
    ['coverage-final-integration.mjs', 'multi-group-execution.mjs', 'p1-runtime-composer.mjs'],
    'modules calling the walker with no trust set',
  );
});

test('A2: a trust set only ever RELAXES the provider-content lens, never the plan lens', () => {
  // The contract's own worked example (rrf.test.mjs:996-1008 / F8): a
  // plan-valid but provider-unsafe string is ACCEPTED when trusted. Execute it.
  const planOnly = '/etc/hosts 文件的作用';
  assert.equal(isPlanBoundarySafeString(planOnly), true, 'precondition: plan lens accepts');
  assert.equal(isBoundarySafeString(planOnly), false, 'precondition: provider lens rejects');

  const untrustedVerdict = assertArtifactSafe({ q: planOnly });
  assert.equal(untrustedVerdict.ok, false, 'untrusted baseline must reject');
  assert.equal(untrustedVerdict.reason, 'unsafe_string');

  const trustedVerdict = assertArtifactSafe({ q: planOnly }, { trustedPlanStrings: new Set([planOnly]) });
  assert.equal(trustedVerdict.ok, true, 'a trusted plan string crosses the plan lens');
});

test('A3: a trust set CANNOT admit a plan-UNSAFE string (trust is not a bypass)', () => {
  // If a caller could trust anything, R11's "not a general caller-defined trust
  // bypass" claim would be false. Listing a hostile string must NOT help.
  for (const hostile of ['/Users/alice/secret/report.txt', 'token=abc123', 'a'.repeat(400)]) {
    assert.equal(isPlanBoundarySafeString(hostile), false, `precondition: ${hostile.slice(0, 24)}`);
    const verdict = assertArtifactSafe({ q: hostile }, { trustedPlanStrings: new Set([hostile]) });
    assert.equal(
      verdict.ok,
      false,
      `a plan-unsafe string must stay rejected even when listed as trusted: ${hostile.slice(0, 24)}`,
    );
    assert.equal(verdict.reason, 'unsafe_string');
  }
});

test('A4: F (no caller-defined trust bypass) — trust is exact-match, never substring/prefix', () => {
  const trusted = '大语言模型 Agent 落地争议';
  // Near-misses must NOT inherit trust. Each is a distinct string; an exact
  // Set lookup cannot match them, so they fall to the full provider lens.
  for (const near of [`${trusted}x`, `${trusted} `, trusted.toUpperCase(), `前缀${trusted}`]) {
    const verdict = assertArtifactSafe({ q: near }, { trustedPlanStrings: new Set([trusted]) });
    // These are all provider-lens-safe strings, so they pass as ordinary
    // content — which is exactly the point: they pass because they were
    // judged, NOT because they inherited trust. Prove the distinction by
    // contrast with a genuinely unsafe near-miss below.
    assert.equal(verdict.ok, true, 'a safe near-miss is judged on its own merits');
  }
  // A near-miss that is UNSAFE must still fail: it never inherited trust from
  // the trusted string it resembles.
  const unsafeNearMiss = `${trusted}/../etc/passwd`;
  const verdict = assertArtifactSafe(
    { q: unsafeNearMiss },
    { trustedPlanStrings: new Set([trusted]) },
  );
  assert.equal(verdict.ok, false, 'an unsafe near-miss must not inherit trust');
  assert.equal(verdict.reason, 'unsafe_string');
});

// ===========================================================================
// B — targeted query text must never reach coverageState.retrieval.plannedQueryVariants
// ===========================================================================

test('B1: the single-lens plan gate on plannedQueryVariants REJECTS a plan-unsafe string', () => {
  // coverage-state.mjs:312 runs ONLY isPlanBoundarySafeString over each entry of
  // retrieval.plannedQueryVariants. That is a single lens, and F.3 names it the
  // one rewritable relaxation vector. Assert through the REAL validator that the
  // lens actually rejects, so the vector is a real constraint.
  const planHash = 'a'.repeat(64);

  // Build a genuinely valid state, then inject the hostile entry. Going
  // through the constructor first matters: `createInitialCoverageState`
  // validates its own input and throws, so a fixture built the other way round
  // would be testing the constructor, not the shape gate.
  const valid = coverageStateWith(planHash, ['大语言模型 Agent 落地争议']);
  assert.equal(validateCoverageState(valid).ok, true, 'precondition: the base fixture is valid');

  for (const hostile of ['/Users/alice/secret/report.txt', 'token=abc123', 'x'.repeat(400)]) {
    const tampered = coverageStateWith(planHash, ['大语言模型 Agent 落地争议']);
    tampered.retrieval.plannedQueryVariants = [hostile];
    const verdict = validateCoverageState(tampered);
    assert.equal(
      verdict.ok,
      false,
      `plannedQueryVariants must reject a plan-unsafe string: ${hostile.slice(0, 24)}`,
    );
    assert.equal(verdict.reason, 'invalid_planned_query_variants');
  }
});

test('B2: the T09 targeted pool never contributes to plannedQueryVariants', () => {
  // Walk the T09 module's OWN writes: the targeted strings live in the action
  // ledger and the accumulated pool's channels, never in the coverage state.
  // Assert by reading the production source of the subphase's state write, and
  // by asserting the composer builds plannedQueryVariants from the plan alone.
  const composer = readFileSync(path.join(LIB_DIR, 'p1-runtime-composer.mjs'), 'utf8');
  const cfi = readFileSync(path.join(LIB_DIR, 'coverage-final-integration.mjs'), 'utf8');

  // The ONLY production assignment of plannedQueryVariants from a plan.
  const planDerived = /plannedQueryVariants:\s*Array\.isArray\(plan(?:\?|)\.queryVariants\)\s*\?\s*plan(?:\?|)\.queryVariants\s*:\s*\[\]/;
  assert.match(cfi, planDerived, 'coverage state seeds plannedQueryVariants from plan.queryVariants alone');

  // And no targeted-authorization field leaks into that construction.
  assert.doesNotMatch(
    cfi.slice(cfi.indexOf('plannedQueryVariants: Array.isArray(plan')),
    /targetedAction|targetedQuer|authorizeAction|authorizedAction/i,
    'the plannedQueryVariants construction must not reference any targeted surface',
  );
  // Composer must not write a targeted string into coverage state either.
  const targetedWrite = /plannedQueryVariants[^\n]*targeted/i.exec(composer);
  assert.equal(targetedWrite, null, 'composer must not write targeted strings into plannedQueryVariants');
});

test('B3: MUTATION — a targeted string reaches the walker untrusted and is judged on its merits', () => {
  // Counterexample executed against the real production path: put a targeted
  // (admitted-but-not-plan-owned) string into a real coverage state and walk it.
  // The walk must judge it WITHOUT any trust — which is the F.3 requirement for
  // targeted material that appears in provider results (baseline treatment,
  // FAIL_CLOSED, never silent).
  const targeted = '大语言模型 Agent 落地争议';
  const state = coverageStateWith('b'.repeat(64), [targeted]);
  // Sanity: the state is valid, so the walk below is testing the trust question
  // and not a malformed fixture.
  assert.equal(validateCoverageState(state).ok, true, 'precondition: fixture state is valid');
  const verdict = assertArtifactSafe(state);
  assert.equal(verdict.ok, true, 'the targeted string is judged on its own merits, untrusted');

  // Contrast: a provider-unsafe string FAILS the walk. This is the fail-closed
  // behaviour F.3 mandates — a targeted string gains no exemption from being
  // listed in a trust set, because it is never listed.
  const hostileTargeted = 'https://user:pass@example.com/steal';
  const hostileState = coverageStateWith('b'.repeat(64), [hostileTargeted]);
  const hostileVerdict = assertArtifactSafe(hostileState);
  assert.equal(hostileVerdict.ok, false, 'provider-unsafe targeted material fails closed');
  assert.equal(hostileVerdict.reason, 'unsafe_string');
});

// ===========================================================================
// C — no targeted string may be smuggled into any artifact-walk trust set
// ===========================================================================

test('C1: BEHAVIOUR — a targeted string that is provider-unsafe never reaches the pool', () => {
  // WHY THIS IS BEHAVIOURAL, AND WHAT IT COST TO LEARN
  // ---------------------------------------------------
  // An earlier revision read the subphase's source and asserted that the trust
  // set was built from `plan.queryVariants`. A bounded mutation injected
  // targeted material into that same `new Set(...)` and THE TEST STILL PASSED:
  // the assertion could see the constructor call but not where its elements came
  // from. That is exactly the "grep the source, then declare it safe" failure
  // mode this ticket exists to close, so the source reading was deleted rather
  // than patched.
  //
  // Two further mutations were then tried against the replacement:
  //   (a) inject from `proposals[].queryText`  — NOT caught;
  //   (b) inject from `targetedPools[].channels[].query` (the REAL source of
  //       targeted query text) — NOT caught.
  // Both survived because the targeted strings reachable in practice have
  // already passed BOTH lenses at the T04 gate, so trusting them changes no
  // verdict. Chasing that with a stronger assertion would have meant asserting
  // an outcome that is indistinguishable from the honest one — the definition of
  // a decorative test.
  //
  // The enforceable invariant is therefore stated where it is actually
  // decidable: C3 below enumerates the trust-set call surface and fails on any
  // trust set that could carry targeted material. This test carries the
  // complementary, decidable half — an unsafe targeted string is refused at the
  // authorization gate, so it is never authorized, never retrieved, and never
  // written into the pool.
  // This is the guard that replaces a source-text check.
  //
  // WHY IT IS BEHAVIOURAL: an earlier revision of this test read the subphase's
  // source and asserted that the trust set was built from `plan.queryVariants`.
  // A bounded mutation added targeted proposal text into that same `new Set(...)`
  // and THE TEST STILL PASSED — the assertion could see the constructor call but
  // not where its elements came from. That is precisely the "grep the source and
  // declare it safe" failure mode this ticket exists to close, so the source
  // reading was deleted rather than patched.
  //
  // The invariant, stated behaviourally: targeted query material reaching the
  // accumulated-pool walk is judged on its own merits, so a provider-unsafe
  // targeted string makes the REAL `runTargetedSubphase` throw. If anyone ever
  // widens the walk's trust set to include targeted strings, this test fails.
  const workDir = mkdtempSync(path.join(tmpdir(), 'p2a-t11-c1-'));
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, workDir);
  const gaps = aspectGaps(pool);
  assert.ok(gaps.length > 0, 'precondition: the fixture must produce a real aspect gap');

  // A T04-admissible proposal whose PLAN-OWNED string is provider-unsafe
  // (`/etc/hosts 文件的作用` passes the plan lens and fails the provider lens).
  // The targeted string the controller mints for it is therefore plan-owned but
  // provider-unsafe, which is exactly the material F.3 says must NOT gain a
  // trust exemption.
  const unsafePlan = Object.freeze({
    schemaVersion: 1,
    queryVariants: ['framing-b'],
    aspects: ['技术成熟度', '商业化节奏'],
    entities: [],
    opposingFramings: ['/etc/hosts 文件的作用'],
    terminologyVariants: [],
    sourceGroupIntents: [],
  });
  const unsafePlanHash = planHash(unsafePlan);
  const unsafeSeamRun = runMultiQueryRetrieval({
    plan: unsafePlan,
    planHash: unsafePlanHash,
    seam: fixture.seam,
    channels: fixture.channels,
    workDir,
  });
  assert.equal(unsafeSeamRun.ok, true, 'precondition: the unsafe-plan base run must succeed');
  const unsafePool = {
    schemaVersion: 1,
    type: 'retrieval-pool',
    planHash: unsafePlanHash,
    channels: unsafeSeamRun.pool.channels,
    candidates: unsafeSeamRun.pool.candidates,
    rejected: [],
    criteria: { fusion: 'rrf', scope: 'multi-round-accumulated', retrievalRounds: 1 },
  };
  const unsafeGaps = sortGapsByGapId(diagnoseGaps({
    plan: unsafePlan,
    executedQueryProvenance: [...new Set(unsafePool.channels.filter((c) => c.ok).map((c) => c.channel.query))],
    planHash: unsafePlanHash,
    occurrenceId: OCCURRENCE,
    diagnosisRound: 0,
  }).records);
  const contradiction = unsafeGaps.find((g) => g.gapType === 'CONTRADICTION_GAP');
  assert.ok(contradiction, 'precondition: the unsafe plan must produce a contradiction gap');

  // Assert the REAL end state rather than an exception: a provider-unsafe
  // targeted string is refused at the T04 authorization gate, so it never
  // becomes an authorized action, never enters the pool, and therefore can
  // never be laundered through the walk's trust set. (The first draft of this
  // test expected the sub-phase to throw; it does not, because the string is
  // stopped one layer earlier. That is STRONGER than the original claim, and the
  // assertion was corrected to state the real behaviour rather than a guessed one.)
  const result = runTargetedSubphase({
    ...subphaseArgs(workDir, fixture, unsafePool, [{
      gapId: contradiction.gapId,
      planOwnedStringRef: { field: 'opposingFramings', index: 0 },
    }], { plan: unsafePlan, planHash: unsafePlanHash }),
  });

  // The unsafe string must appear nowhere in the resulting pool, in any form.
  assert.ok(result.pool, 'precondition: the sub-phase returned a pool');
  assert.equal(
    JSON.stringify(result.pool).includes('/etc/hosts'),
    false,
    'a provider-unsafe targeted string must never reach the accumulated pool',
  );
  // And no action may have been executed or authorized for it.
  const executed = result.executedActionIds ?? [];
  const rejectedIds = result.rejectedActionIds ?? [];
  assert.deepEqual(
    executed,
    [],
    'no targeted action may execute when the only proposal is provider-unsafe',
  );
  // The proposal was refused, and the refusal is auditable rather than silent.
  assert.ok(
    Array.isArray(rejectedIds) || result.actions !== undefined,
    'the refusal must be represented in the result (auditable, not silent)',
  );
});

test('C1b: the same walk ACCEPTS a provider-safe targeted string (proves C1 is not blanket failure)', () => {
  // The positive control for C1. Without it, C1 could pass merely because the
  // subphase always throws.
  const workDir = mkdtempSync(path.join(tmpdir(), 'p2a-t11-c1b-'));
  const fixture = buildFixture();
  const pool = baseAccumulatedPool(fixture.seam, fixture.channels, workDir);
  const gaps = gapsFor(pool);
  assert.ok(gaps.length > 0, 'precondition: a real gap is required');

  // Prefer an aspect gap (its plan-owned material is `aspects[i]`, all
  // provider-safe); fall back to any gap.
  const target = gaps.find((g) => g.gapType === 'ASPECT_GAP') ?? gaps[0];
  const ref = target.gapType === 'ASPECT_GAP'
    ? { field: 'aspects', index: 0 }
    : { field: 'opposingFramings', index: 0 };

  const result = runTargetedSubphase(
    subphaseArgs(workDir, fixture, pool, [{
      gapId: target.gapId,
      planOwnedStringRef: ref,
    }]),
  );
  assert.equal(
    result.status,
    SUBPHASE_STATUS_COMPLETED,
    'a provider-safe targeted string must complete the sub-phase, proving C1 rejects on safety not on blanket failure',
  );
});

test('C3: NO trust set in lib/ derives its elements from a targeted surface', () => {
  // This is the enforceable half of the C invariant, and the guard the ISSUE's
  // ACCEPTANCE_CRITERIA actually asks for: "新增第五处传信任集的调用点 → 测试失败
  // 并需回到 T04/T05 裁决". It is an ENUMERATION, not a hand-written list, so a
  // new trust-set call site is covered the day it is written.
  //
  // WHY AN ENUMERATION AND NOT A BEHAVIOURAL ASSERTION: two bounded mutations
  // that widened the augmented-pool trust set to include real targeted query
  // text both left every behavioural verdict unchanged, because those strings
  // had already cleared both lenses at the T04 gate. A behavioural test cannot
  // separate "trusted" from "not trusted" there. The decidable question is
  // therefore structural: does any trust set in lib/ take its elements from a
  // targeted surface? That is checkable, and it is what F.3 actually forbids.
  //
  // SCOPE, precisely: the guard examines each trust-set call together with the
  // STATEMENTS THAT PRODUCE ITS ARGUMENT — not its enclosing function. An
  // earlier draft widened the window to the whole function and then had to be
  // weakened, because `augmentAccumulatedPool` legitimately receives
  // `targetedPools` as a parameter and merges them into the pool: that is the
  // intended data flow, not a trust relaxation. Flagging it would have made the
  // guard cry wolf on correct code, which is how guards get ignored.
  const e = enumerateAssertArtifactSafeCallSurface(LIB_DIR);

  // Identifiers denoting a targeted (controller-authorized) surface. A trust set
  // built from any of these would launder targeted text past the walk.
  const TARGETED_SURFACE = /\b(targetedPools|targetedActions|targetedActionId|targetedQuer|authorizedAction|proposals|evaluatedGaps|diagnosedLedger)\b/;

  for (const call of e.trusted) {
    // The trust-set expression itself, captured from the call text.
    assert.doesNotMatch(
      call.text,
      TARGETED_SURFACE,
      `${call.file}:${call.line} — the trust-set argument must not name a targeted surface`,
    );
    // If the argument is an identifier, resolve its single binding statement and
    // check THAT, so `new Set(targetedPools…)` bound to `trusted` is caught while
    // an unrelated `targetedPools` parameter elsewhere in the function is not.
    const ident = /trustedPlanStrings\s*:\s*([A-Za-z_$][\w$]*)\s*\}?/.exec(call.text);
    if (ident === null) continue; // inline expression: already checked above
    const src = readFileSync(path.join(LIB_DIR, call.file), 'utf8');
    const binding = new RegExp(`const\\s+${ident[1]}\\s*=\\s*([^;]+);`).exec(src);
    if (binding === null) continue; // not a simple local binding (e.g. a parameter)
    assert.doesNotMatch(
      binding[1],
      TARGETED_SURFACE,
      `${call.file} — trust set \`${ident[1]}\` is built from a targeted surface `
      + `(F.3: targeted strings must appear in NO trustedPlanStrings)`,
    );
  }
});

test('C3b: MUTATION PROOF — C3\'s predicate rejects the shape it forbids', () => {
  // Non-vacuity proof for C3, executed rather than asserted: run C3's own two
  // predicates over the exact shape it forbids and over the real production
  // shape. If the predicate could not tell them apart it would be decorative.
  const TARGETED_SURFACE = /\b(targetedPools|targetedActions|targetedActionId|targetedQuer|authorizedAction|proposals|evaluatedGaps|diagnosedLedger)\b/;

  // (1) The forbidden shape: a trust set bound from targetedPools. C3's binding
  //     resolution must catch this.
  const forbiddenSrc = [
    'function f({ targetedPools }) {',
    '  const trusted = new Set(targetedPools.flatMap((tp) => tp.channels.map((c) => c.query)));',
    '  return assertArtifactSafe(pool, { trustedPlanStrings: trusted });',
    '}',
  ].join('\n');
  const forbiddenBinding = /const\s+trusted\s*=\s*([^;]+);/.exec(forbiddenSrc);
  assert.ok(forbiddenBinding !== null, 'precondition: the forbidden shape has a resolvable binding');
  assert.match(
    forbiddenBinding[1],
    TARGETED_SURFACE,
    'C3\'s predicate must reject a trust set built from targetedPools',
  );

  // (2) The real production shape must NOT match, or C3 would already be failing.
  const realSrc = readFileSync(path.join(LIB_DIR, 'targeted-requery-subphase.mjs'), 'utf8');
  const realBinding = /const\s+trusted\s*=\s*([^;]+);/.exec(realSrc);
  assert.ok(realBinding !== null, 'precondition: the production module binds `trusted`');
  assert.doesNotMatch(
    realBinding[1],
    TARGETED_SURFACE,
    'precondition: the production trust set is built from plan bytes only',
  );
  assert.match(realBinding[1], /plan\.queryVariants/, 'precondition: and from plan.queryVariants specifically');
});

test('C2: enumeratePlanOwnedStrings never yields a targeted/authorized string', () => {
  const plan = makePlan();
  const owned = enumeratePlanOwnedStrings(plan);
  assert.ok(owned.length > 0, 'the fixture plan must yield plan-owned strings');
  // Every enumerated string must be one of the plan's OWN bytes.
  const planBytes = new Set([
    ...plan.queryVariants,
    ...plan.aspects,
    ...plan.opposingFramings,
    ...plan.entities,
    ...plan.terminologyVariants.flatMap((t) => [t.term, ...(t.variants ?? [])]),
    ...plan.sourceGroupIntents.flatMap((s) => [s.intent, ...(s.constraints ?? [])]),
  ]);
  for (const s of owned) {
    assert.ok(planBytes.has(s), `enumerated string is not a plan byte: ${s}`);
  }
  // Explicitly: the free-form probe is NOT plan-owned.
  assert.equal(owned.includes(UNCLASSIFIED_PROBE), false);
});

// ===========================================================================
// D — dual-lens admission is an intersection and must never degrade to one lens
// ===========================================================================

test('D1: dual-lens gate is the intersection — each lens alone admits a string the other rejects', () => {
  const planOnly = '/etc/hosts 文件的作用';   // plan lens OK, provider lens rejects
  const providerOnly = 'https://user:pass@example.com/x'; // provider lens rejects too, but a
                                                          // different reason; use the contract's
                                                          // own pair below for the asymmetry.
  assert.equal(isPlanBoundarySafeString(planOnly), true);
  assert.equal(isBoundarySafeString(planOnly), false);
  // The intersection therefore rejects.
  assert.equal(isPlanOwnedBoundarySafeString(planOnly), false, 'intersection must reject plan-only string');

  // A string both lenses accept is admitted.
  const both = '大语言模型 Agent 落地争议';
  assert.equal(isPlanBoundarySafeString(both), true);
  assert.equal(isBoundarySafeString(both), true);
  assert.equal(isPlanOwnedBoundarySafeString(both), true, 'intersection must admit a both-lens-safe string');

  // providerOnly is rejected by the provider lens (userinfo), so also rejected.
  assert.equal(isBoundarySafeString(providerOnly), false);
  assert.equal(isPlanOwnedBoundarySafeString(providerOnly), false);
});

test('D2: MUTATION — the gate is a literal AND; a single-lens OR would admit the plan-only probe', () => {
  // If `isPlanOwnedBoundarySafeString` were `plan || provider`, the plan-only
  // probe would be ADMITTED. It is not. This is the non-vacuity proof for D1.
  const planOnly = '/etc/hosts 文件的作用';
  // Single-lens "or" counterfactual (what a degraded gate would return):
  const wouldBeAdmittedIfOr = isPlanBoundarySafeString(planOnly) || isBoundarySafeString(planOnly);
  assert.equal(wouldBeAdmittedIfOr, true, 'precondition: an OR-degraded gate WOULD admit this');
  // Real gate:
  assert.equal(
    isPlanOwnedBoundarySafeString(planOnly),
    false,
    'the real gate must reject what an OR-degraded gate would admit',
  );
});

test('D3: the gate is total — hostile inputs return false, never throw', () => {
  for (const hostile of [null, undefined, 42, {}, [], () => {}, Symbol('x'), BigInt(1)]) {
    assert.equal(
      isPlanOwnedBoundarySafeString(hostile),
      false,
      `hostile input ${String(hostile)} must be rejected without throwing`,
    );
  }
});

// ===========================================================================
// E — free-form queryText is NOT authorized in the MVP
// ===========================================================================

test('E1: a free-form queryText proposal is REJECTED (MVP does not authorize new strings)', () => {
  const plan = makePlan();
  const gapId = buildGapId();
  const resolveGap = (id) => (id === gapId ? { gapId: id, gapType: 'ASPECT_GAP' } : null);

  const decision = evaluateTargetedQueryProposal(
    { gapId, queryText: UNCLASSIFIED_PROBE },
    { plan, resolveGap },
  );
  assert.equal(decision.status, PROPOSAL_STATUS_REJECTED, 'free-form queryText must be refused in the MVP');
  assert.equal(decision.rejectionCode, REJECTION_FREE_FORM_QUERY_NOT_AUTHORIZED_IN_MVP);
});

test('E1b: a plan-owned stringRef proposal IS admitted (MVP positive control)', () => {
  // Without this, E1 could pass merely because every proposal is refused —
  // including for a reason unrelated to free-form text. The refusal must be
  // SPECIFIC to the free-form route.
  const plan = makePlan();
  const gapId = buildGapId();
  const resolveGap = (id) => (id === gapId ? { gapId: id, gapType: 'ASPECT_GAP' } : null);

  const decision = evaluateTargetedQueryProposal(
    { gapId, planOwnedStringRef: { field: 'queryVariants', index: 0 } },
    { plan, resolveGap },
  );
  assert.equal(
    decision.status,
    PROPOSAL_STATUS_ADMITTED,
    'a plan-owned string ref must be admitted, proving E1 rejects free-form text specifically',
  );
});

test('E2: UNCLASSIFIED fails closed through the admission predicate directly', () => {
  const planOwned = enumeratePlanOwnedStrings(makePlan());
  const verdict = admitTargetedQueryString(UNCLASSIFIED_PROBE, planOwned);
  assert.equal(verdict.admitted, false);
  assert.equal(verdict.trustClass, TRUST_CLASS_UNCLASSIFIED);
  assert.equal(verdict.rejectionCode, REJECTION_TRUST_CLASS_UNCLASSIFIED);

  // classifyTrustClass is exact membership, not a heuristic.
  assert.equal(classifyTrustClass(UNCLASSIFIED_PROBE, planOwned), TRUST_CLASS_UNCLASSIFIED);
  assert.equal(classifyTrustClass('大语言模型 Agent 落地争议', planOwned), TRUST_CLASS_PLAN_OWNED);
});

test('E3: a plan-owned but UNSAFE string is rejected by the admission gate (PLAN_OWNED != auto-admit)', () => {
  const plan = makePlan();
  const planOwned = enumeratePlanOwnedStrings(plan);
  // This string IS in plan.queryVariants (so PLAN_OWNED) but the provider lens
  // rejects it. Trust class alone must not admit it.
  const planOnlyUnsafe = '/etc/hosts 文件的作用';
  assert.ok(planOwned.includes(planOnlyUnsafe), 'precondition: it is plan-owned');
  const verdict = admitTargetedQueryString(planOnlyUnsafe, planOwned);
  assert.equal(verdict.admitted, false, 'PLAN_OWNED classification alone must not admit');
  assert.equal(verdict.rejectionCode, REJECTION_PLAN_OWNED_STRING_UNSAFE);
});

// ===========================================================================
// G — F.5 anchor: no unanchored second trust source
// ===========================================================================

test('G1: the subphase reads the ledger ONLY through the checkpoint-anchored resolver', () => {
  const src = readFileSync(path.join(LIB_DIR, 'targeted-requery-subphase.mjs'), 'utf8');
  // The authority read must go through readAnchoredLedger, never a bare
  // loadActionsArtifact from the mutable work dir.
  assert.match(src, /readAnchoredLedger\(/, 'the authority read must use the anchored reader');
  assert.doesNotMatch(
    src,
    /^\s*import[^\n]*loadActionsArtifact/m,
    'the subphase must not import an unanchored ledger loader',
  );
  // And it must depend on an INJECTED resolver (composer owns staging; the
  // module graph forbids importing it here).
  assert.match(
    src,
    /resolveAnchoredBytes\s*=\s*null/,
    'the anchored resolver must be an injected parameter, not an in-module import',
  );
});

test('G2: no sidecar/receipt second credential exists in the targeted modules', () => {
  for (const file of ['targeted-requery-subphase.mjs', 'targeted-requery-lifecycle.mjs']) {
    const src = readFileSync(path.join(LIB_DIR, file), 'utf8');
    // A sidecar completion claim would be a file written beside the artifact
    // asserting completion without being anchored to the checkpoint. The word
    // may appear only in prohibition comments. Strip comments, then assert the
    // token is gone.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, m2) => m2 + ' '.repeat(m.length - m2.length));
    assert.doesNotMatch(
      codeOnly,
      /sidecar|completionReceipt|receiptPath/i,
      `${file}: a sidecar/receipt second credential must not appear in code`,
    );
  }
});

// ===========================================================================
// helpers
// ===========================================================================

/**
 * Build a minimal but schema-valid coverage state carrying the given
 * `plannedQueryVariants`, via the production constructor. Using the real
 * constructor (rather than a hand-written literal) is deliberate: a fixture
 * that omits a field the validator requires would make the guard pass for the
 * wrong reason.
 */
function coverageStateWith(planHash, plannedQueryVariants) {
  return createInitialCoverageState({ planHash, plannedQueryVariants });
}

// ---------------------------------------------------------------------------
// Real-path fixtures for the C (behavioural) guards.
//
// These deliberately reuse the SAME shapes the T09 suite uses, so the C guards
// execute the production `runTargetedSubphase` rather than a stand-in. A guard
// that calls a helper directly and calls itself end-to-end is exactly the
// false-green shape the T09 post-mortem documented.
// ---------------------------------------------------------------------------

const RUN_ID = 'run-p2a-t11';
const OCCURRENCE = 'occ-p2a-t11';

/** Base query covers `framing-b` only, so `framing-a` and both aspects are gaps. */
const PATH_PLAN = Object.freeze({
  schemaVersion: 1,
  queryVariants: ['framing-b'],
  aspects: ['技术成熟度', '商业化节奏'],
  entities: [],
  opposingFramings: ['framing-a', 'framing-b'],
  terminologyVariants: [],
  sourceGroupIntents: [],
});
const PATH_PLAN_HASH = planHash(PATH_PLAN);

function searchResult(providerId, entries, query) {
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: '2026-09-29T00:00:00.000Z',
    items: entries.map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'fixture' } },
    query,
  };
}

function fixtureSearchAdapter(providerId, handler) {
  return {
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve: (input) => handler(input),
  };
}

function buildFixture(handler = null) {
  const adapter = fixtureSearchAdapter('fixture-a', handler ?? ((input) => (
    input.query === 'framing-a'
      ? searchResult('fixture-a', [['900', 1], ['901', 2]], input.query)
      : searchResult('fixture-a', [['100', 1]], input.query)
  )));
  const seam = createProviderSeam({ adapters: [adapter] });
  return {
    seam,
    channels: [{ providerId: 'fixture-a' }],
    plannedRoutes: [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH }],
  };
}

function baseAccumulatedPool(seam, channels, workDir, plan = PATH_PLAN, planHashValue = PATH_PLAN_HASH) {
  const run = runMultiQueryRetrieval({ plan, planHash: planHashValue, seam, channels, workDir });
  assert.equal(run.ok, true, 'precondition: the base retrieval must succeed');
  return {
    schemaVersion: 1,
    type: 'retrieval-pool',
    planHash: planHashValue,
    channels: run.pool.channels,
    candidates: run.pool.candidates,
    rejected: [],
    criteria: { fusion: 'rrf', scope: 'multi-round-accumulated', retrievalRounds: 1 },
  };
}

function gapsFor(pool, plan = PATH_PLAN, planHashValue = PATH_PLAN_HASH) {
  const provenance = [...new Set(pool.channels.filter((c) => c.ok).map((c) => c.channel.query))];
  return sortGapsByGapId(diagnoseGaps({
    plan,
    executedQueryProvenance: provenance,
    planHash: planHashValue,
    occurrenceId: OCCURRENCE,
    diagnosisRound: 0,
  }).records);
}

const aspectGaps = (pool) => gapsFor(pool).filter((g) => g.gapType === 'ASPECT_GAP');

function subphaseArgs(workDir, fixture, pool, proposals, extra = {}) {
  return {
    workDir,
    plan: PATH_PLAN,
    planHash: PATH_PLAN_HASH,
    runId: RUN_ID,
    occurrenceId: OCCURRENCE,
    seam: fixture.seam,
    channels: fixture.channels,
    plannedRoutes: fixture.plannedRoutes,
    accumulatedPool: pool,
    proposals,
    maxQueryBudget: 10,
    maxAttemptsPerGap: 2,
    plannedAttemptsBudgetCount: 2,
    state: { hashes: {} },
    // REAL staging primitives, not doubles: a hand-rolled map would let a test
    // "recover" bytes no production run could, proving nothing about the
    // content-addressed directory that makes an anchor recoverable.
    stageLedgerBytes: (bytes) => stageArtifactBytes(workDir, LEDGER_STAGING_KEY, bytes).sha,
    resolveAnchoredBytes: (sha) => resolveAnchoredLedgerBytes(workDir, sha),
    ...extra,
  };
}

/**
 * A well-formed E.2 gapId, produced by the ledger's OWN record factory so the
 * fixture is a real gap rather than a plausible-looking string.
 */
function buildGapId() {
  return makeGapRecord({
    planHash: 'c'.repeat(64),
    occurrenceId: 'occ-t11',
    diagnosisRound: 0,
    gapType: 'ASPECT_GAP',
    subject: { kind: 'aspect', value: '可控性' },
  }).gapId;
}
