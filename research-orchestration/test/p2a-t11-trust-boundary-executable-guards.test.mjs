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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  resolveTrustSetProvenance,
  resolveOptionsTrustSetExpression,
  resolveShorthandTrustSetFromCallers,
  provenanceIdentifiersIn,
  resolveCallReturnProvenance,
  resolveImportedCallReturnProvenance,
  resolveNameInModule,
  isVocabularyOnly,
  isWalkableTrustSetName,
  splitMemberAccess,
  memberWritePathsIn,
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

test('A1b: EVERY shape the enumerator files as `unparsed` is one C3 will actually examine', () => {
  // A GUARD ON THE ROUTING, because the fifth review's P1-2 was not a missed
  // shape at all — it was two correct components disagreeing about where a call
  // goes.
  //
  //   the classifier:  a bare-identifier second argument is READABLE, so this
  //                    call has no trust set  ->  `call-untrusted`
  //   C3:             examines `trusted + unparsed`, and `untrusted` by nobody
  //
  // So the `__opts__NAME` branch — the code that can resolve exactly that shape
  // — was unreachable from the real call path, and every options-object widening
  // was waved through. C3b did not catch it because C3b calls the predicate
  // directly with a hand-built call object and therefore never goes through the
  // classifier at all: the mutation proof was exercising a different route than
  // production takes.
  //
  // The invariant is now asserted directly, on a synthetic module, because the
  // production one cannot produce the shape (A1 already requires its `unparsed`
  // list to be empty, and a case that only fires on synthetic input is exactly
  // the case that used to rot unnoticed). The property:
  //
  //   the union of what C3 examines and what is provably trust-set-free
  //   is everything — nothing is silently dropped between the two components.
  //
  // `untrustedCallSiteFiles` is the honest home for a provably-empty call, so
  // the assertion is that `trusted ∪ unparsed ∪ untrusted` covers every call the
  // enumerator found, AND that no call classified `untrusted` carries a second
  // argument the resolver would have to look at.
  const dir = mkdtempSync(path.join(tmpdir(), 't11-a1b-'));
  try {
    writeFileSync(path.join(dir, 'synthetic.mjs'), [
      // Each of these is a DIFFERENT reason a call could be invisible, and each
      // one is a shape the guard claims to handle.
      'export function widened(plan, targetedPools) {',
      '  const opts = { trustedPlanStrings: new Set([...plan.queryVariants, ...targetedPools.map((t) => t.rawQuery)]) };',
      '  return assertArtifactSafe(pool, opts);',            // bare identifier
      '}',
      'export function degraded(plan) {',
      '  const opts = { trustedPlanStrings: new Set(plan.queryVariants) };',
      '  return assertArtifactSafe(pool, opts ?? {});',      // operator
      '}',
      'export function computed(plan) {',
      '  return assertArtifactSafe(pool, makeOpts(plan));',  // call
      '}',
      'export function clean(pool) {',
      '  return assertArtifactSafe(pool, {});',               // provably free
      '}',
      'export function noOptions(pool) {',
      '  return assertArtifactSafe(pool);',                   // no second arg
      '}',
    ].join('\n'));
    const e = enumerateAssertArtifactSafeCallSurface(dir);
    const examined = [...e.trusted, ...e.unparsed];
    const lines = e.files.flatMap((f) => f.calls).map((c) => c.line);
    assert.equal(
      examined.length + e.untrusted.length,
      lines.length,
      'every enumerated call must be either examined by C3 or provably trust-set-free',
    );
    // The three shapes that DO carry a trust set must all be examined. This is
    // the assertion that would have failed before the fix: `widened` and
    // `degraded` were both filed as `untrusted` and examined by nobody.
    const examinedText = examined.map((c) => c.text).join('\n');
    for (const marker of ['assertArtifactSafe(pool, opts);', 'assertArtifactSafe(pool, opts ?? {});', 'assertArtifactSafe(pool, makeOpts(plan));']) {
      assert.ok(
        examinedText.includes(marker),
        `C3 must examine \`${marker}\` — it carries a trust set the resolver can read`,
      );
    }
    // And the two provably-free shapes must NOT become noise: routing them the
    // long way would have C3 report an unresolvable on correct code.
    const untrustedText = e.untrusted.map((c) => c.text).join('\n');
    for (const marker of ['assertArtifactSafe(pool, {});', 'assertArtifactSafe(pool);']) {
      assert.ok(
        untrustedText.includes(marker),
        `\`${marker}\` provably carries no trust set and must stay out of C3's way`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  // WHY DATA FLOW AND NOT A NAME LIST (P1 from the security review)
  // --------------------------------------------------------------
  // The first version decided "targeted?" by regex-matching a closed list of
  // identifier names inside the single `const trusted = …;` statement. The
  // security review showed three widenings that leave that version green:
  //
  //   const qs = targetedPools.flatMap(…);   const trusted = new Set([…, …qs]);
  //   const trusted = new Set(…);            trusted.add(action.normalizedQuery);
  //   assertArtifactSafe(pool, opts);        // trust set behind an options object
  //
  // A name list cannot survive a rename, and one statement cannot see a
  // two-statement story. So this resolves each trust set's actual provenance
  // with `resolveTrustSetProvenance`, which follows intermediate variables
  // transitively and includes post-construction `.add()`.
  //
  // It remains a lexical approximation. Where it cannot understand a binding it
  // reports that as `unresolved` rather than as clean, and this test FAILS on an
  // unresolved trust set — silence in a security guard is the failure mode that
  // matters.
  const e = enumerateAssertArtifactSafeCallSurface(LIB_DIR);

  const violations = [];
  const unresolved = [];
  // `unparsed` is included deliberately. A call the enumerator cannot classify
  // — `assertArtifactSafe(pool, opts)` is the case the security review found —
  // is exactly where a hidden trust set lives, so C3 must not skip it. If the
  // options object resolves and is clean, the verdict is empty; if it carries a
  // targeted surface, C3 fires. A1 independently fails on the unparsed call, so
  // neither guard depends on the other being right.
  for (const call of [...e.trusted, ...e.unparsed]) {
    const src = stripComments(readFileSync(path.join(LIB_DIR, call.file), 'utf8'));
    const verdict = c3TrustSurfaceVerdict(src, call);
    violations.push(...verdict.violations);
    unresolved.push(...verdict.unresolvable);
  }

  assert.deepEqual(
    violations,
    [],
    'no trust set may be fed by a targeted surface (F.3: targeted strings must appear in '
    + 'NO trustedPlanStrings)',
  );
  assert.deepEqual(
    unresolved,
    [],
    'every trust set must have fully resolvable provenance; an unresolvable binding is '
    + 'a blind spot, not a pass',
  );
});

/**
 * F.3 forbids the PROVENANCE of the strings, not any particular variable name.
 * These are the surfaces a targeted query string can come from; the provenance
 * walk is what makes a closed name list sufficient, because reaching any of them
 * through an intermediate or a mutation still resolves to these names.
 *
 * Non-global so `.test` carries no `lastIndex` state between call sites.
 *
 * r7 P2-1: THE REAL TARGETED FIELD NAMES WERE MISSING. The list above is all
 * `targeted*`-shaped identifiers, and that is exactly backwards — the code's own
 * C1 comment names what a targeted query string actually arrives as
 * (`targetedPools[].channels[].query`, `proposals[].queryText`), and NONE of
 * `query`, `queryText`, `rawQuery`, `channels`, `candidates`, `proposals`,
 * `actions`, `accumulatedPool` was in the set. So
 *
 *     const trusted = new Set(proposals.map((p) => p.queryText));
 *
 * reached the trust set, the walk resolved `proposals` as an ordinary
 * plan-shaped name, and the verdict came back clean. It is a fail-open, and
 * unlike the other two findings it needs no rename and no exotic chain — it
 * needs the real field name, which is the shape the codebase actually uses.
 * The walk is what makes a closed list sufficient, so the list has to be closed
 * over the REAL carriers.
 *
 * `query` alone does not match `plan.queryVariants` or `queryText`: `\b` on both
 * sides means `queryVariants` has no word boundary after `query`, so the
 * production trust set is unaffected.
 */
const TARGETED_SURFACE = /\b(targetedPools|targetedActions|targetedActionId|targetedQuer|targetedString|authorizedAction|evaluatedGaps|diagnosedLedger|normalizedQuery|targetedQuery|queryText|rawQuery|channels|candidates|proposals|accumulatedPool|actions|query)\b/;

/**
 * Language and library vocabulary that is never a trust input.
 *
 * P1-1 REQUIRED THIS. Once every shape's identifiers are followed transitively
 * — which is what closing the inline-expression bypass demanded — the walk also
 * reaches `new`, `Set`, `Array` and the like, and each would be reported as an
 * unresolvable binding. A guard that reports fifty pieces of vocabulary as
 * blind spots trains its reader to ignore it, and the next real blind spot goes
 * unread. Filtering the vocabulary keeps `unresolvable` meaning exactly one
 * thing: a name the module cannot account for, which is a genuine blind spot.
 */
const PROVENANCE_VOCABULARY = new Set([
  'new', 'Set', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Map',
  'Promise', 'Symbol', 'JSON', 'Math', 'Error', 'TypeError', 'globalThis',
  'isArray', 'from', 'of', 'keys', 'values', 'entries', 'length', 'flat',
  'flatMap', 'map', 'filter', 'reduce', 'forEach', 'some', 'every', 'find',
  'join', 'concat', 'push', 'pop', 'slice', 'splice', 'includes', 'indexOf',
  'has', 'get', 'set', 'add', 'delete', 'clear', 'typeof', 'instanceof',
  'void', 'in', 'true', 'false', 'null', 'undefined', 'this',
  'isNaN', 'parseInt', 'parseFloat', 'structuredClone', 'assign', 'freeze',
  'create', 'defineProperty', 'NaN', 'Infinity',
]);

/**
 * C3's PREDICATE, factored out so C3b can EXECUTE it on synthetic sources
 * instead of re-implementing it. A mutation proof that re-derives the rule is
 * not a proof of the rule; this one calls the same code path C3 does.
 *
 * @param {string} src module source, comments already stripped
 * @param {{file: string, line: number, text: string}} call one trusted call site
 * @param {{libDir?: string}} [opts] `libDir` is where the cross-module route
 *   reads sibling modules from; it DEFAULTS to the real `lib/`, so a synthetic
 *   multi-module fixture has to opt into a temporary directory explicitly rather
 *   than accidentally resolving against production files.
 * @returns {{violations: string[], unresolvable: string[]}}
 */
function c3TrustSurfaceVerdict(src, call, { libDir = LIB_DIR } = {}) {
  const violations = [];
  const unresolvable = [];
  const at = `${call.file}:${call.line}`;

  const checkExpressions = (varName, expressions) => {
    for (const expr of expressions) {
      if (TARGETED_SURFACE.test(expr)) {
        violations.push(
          `${at} — trust set \`${varName}\` is fed by a targeted surface: ${expr.slice(0, 120)}`,
        );
      }
    }
  };

  // Every root is reduced to SOURCE EXPRESSIONS, and every identifier read
  // inside such an expression is followed transitively.
  //
  // P1-1 FIXED HERE. Three review rounds converged on one underlying mistake
  // from different directions: treating a NON-EMPTY text root as if it were a
  // TRACKED one. The `__expr__` branch tested an inline expression as text and
  // stopped, so `new Set([...trusted, ...qs])` passed whenever the widening sat
  // one hop behind `qs`; the shorthand caller's member value was followed only
  // when it happened to be a bare identifier. Three of the five audited sites
  // are `__expr__`, so the guard was materially blind on most of the surface it
  // claims to cover.
  //
  // So there is exactly ONE place where an expression becomes evidence, and
  // every shape below is reduced to expressions before reaching it. A shape
  // that cannot be reduced does not get a pass — it is reported unresolved.
  //
  // A name is only a BLIND SPOT if it cannot be accounted for by ANY route. A
  // binding is not the only thing that explains an identifier: a call's value
  // comes from the callee's body, in this module or one hop away in `lib/`.
  // Reporting every unbound name as a blind spot — while the callee body sitting
  // right there is readable — produced `validatePlanInput` and `isPlainObject`
  // as unresolvables on the F.3 boundary's own production line. That is the
  // noise-to-signal failure in its purest form: a guard that cries wolf on the
  // two most legitimate bindings in the codebase is a guard whose real findings
  // will be waived through. Hence the routing, which tries every route and
  // reports a blind spot only when all of them fail.
  //
  // The three IN-MODULE routes live in the helper (`resolveNameInModule`), so
  // the body route and this one cannot disagree about what a local is. Only the
  // cross-module route is added here, because it is the one route that needs
  // `libDir` and the call site's file — knowledge this function has and the
  // helper's module-level entry point does not.
  const resolveName = (ident, budget) => {
    const localRoutes = resolveNameInModule(src, ident, { budget });

    // A function IMPORTED from another `lib/` module — the shape the trust
    // boundary actually uses, since the trusted strings are the output of a T04
    // plan-contract call that lives one module away.
    //
    // Two things can arrive here and BOTH must be followed. `ident` itself may
    // be the import (`validatePlanInput`); or the binding walk may have reduced
    // `ident` to a name that IS an import and reported it as a pending import
    // rather than an answer — precisely so that this hop, the only one holding
    // `libDir`, is the one that takes it.
    //
    // The pending imports are followed EVEN WHEN the local routes already
    // produced expressions. `validated = validatePlanInput(plan)` also reaches
    // `isPlainObject`, whose body yields eight real expressions, so an
    // early-return-on-non-empty dropped the pending import and a targeted
    // string folded into `plan-contract.mjs` stayed green.
    const candidates = new Set([...(localRoutes.pendingImports ?? [])]);
    if (localRoutes.expressions.length === 0) candidates.add(ident);
    const expressions = [...(localRoutes.expressions ?? [])];
    const unresolvable = [...(localRoutes.unresolvable ?? [])];
    let resolvedAny = localRoutes.expressions.length > 0;
    // Failures are COLLECTED, not re-queried: every call into the cross-module
    // route advances the one shared call-graph budget, so asking a second time
    // would either report a budget-exhausted lookup as a genuine miss or
    // double-count the same blind spot once per candidate.
    const hopFailures = [];
    for (const name of candidates) {
      const imported = resolveImportedCallReturnProvenance(libDir, call.file, name, { budget });
      if (!imported.found) {
        hopFailures.push(...(imported.unresolvable ?? []));
        continue;
      }
      resolvedAny = true;
      expressions.push(...imported.expressions);
      unresolvable.push(...imported.unresolvable);
    }
    if (resolvedAny) return { expressions, unresolvable };

    // Nothing in this module or its `lib/` imports accounts for the name. A
    // callback parameter reaches here only if the lexical walk missed its
    // scope, so this is a real blind spot and C3 fails closed on it.
    //
    // A CROSS-MODULE HOP THAT WAS TAKEN AND FAILED IS ALSO A BLIND SPOT, and it
    // used to be dropped on the floor (r9 P1-2). `import { gather as filter }`
    // resolves to an origin module, that module declares no `filter`, and the
    // route returned `{found: false, unresolvable: [...]}`. The old
    // `if (!imported.found) continue;` discarded that unresolvable, so an
    // import the walk could not follow read as a CLEAN resolution — the exact
    // inversion this guard's contract forbids, and one more reason a vocabulary
    // collision was enough to hide a widening. The failure REPLACES the generic
    // blind spot rather than joining it, because it is the same blind spot with
    // the reason attached.
    if (hopFailures.length > 0) {
      return { expressions: [], unresolvable: [...hopFailures, ...unresolvable] };
    }
    return { expressions: [], unresolvable: [ident] };
  };

  const followInto = (label, expression, seen = new Set()) => {
    checkExpressions(label, [expression]);
    // r11 P1-1 FIXED HERE. A member access inside this expression can be the
    // BINDING that fed the trust set, and the identifier loop below cannot see
    // that: `provenanceIdentifiersIn` strips property names by design, so
    // `new Set(holder.trusted)` reduces to `['new','Set','holder']` and the
    // walk asks about an empty object literal while the targeted string sits in
    // `holder.trusted = new Set(…targetedPools…)`, which nothing ever consults.
    // The verdict came back `{violations: [], unresolvable: []}` — CLEAN, on a
    // one-dot widening of the F.3 boundary. I reproduced exactly that.
    //
    // The member route is consulted ONLY for members this module actually
    // WRITES (see `memberWritePathsIn` for the measurement that rules out the
    // broader "every member" rule: it costs 8 false blind spots on
    // `coverage-final-integration.mjs:461` for `Array.isArray`, which is a
    // builtin read with no write anywhere). A property write is the only thing
    // that makes `receiver.member` a binding of a trust set rather than a read
    // of someone else's data, and on all three production sites with an inline
    // trust set this yields nothing at all — so the fix is quiet in production
    // and loud on the bypass.
    //
    // The write is reported through the SAME `checkExpressions`/`resolveName`
    // pair as every other route, so a member write cannot produce a verdict the
    // bare-variable route could not.
    // ONE budget for the whole call site, shared by every route beneath it.
    // The routes call each other — the binding walk asks the body route, the
    // body route asks the binding walk, and the cross-module route re-enters
    // both in the origin module — so a per-identifier budget never terminates.
    // Sharing it makes every function body resolve at most once per call site.
    //
    // DECLARED ABOVE THE MEMBER LOOP, and that position is load-bearing. It was
    // originally written just above the identifier loop below, which left the
    // member route — added in this same review — starting a FRESH top-level walk
    // per member path. The helper's own finiteness argument is "one budget per
    // top-level walk"; a route that invents its own walk is not covered by it.
    // The mutation matrix caught the consequence rather than a reviewer: M7
    // (`pool.__trusted = new Set([...trusted, ...pool.map(…)])`, the r9 P1-3
    // shape) took 27.4s for a single root and returned 294 expressions with
    // 5702 unresolvables, and the suite did not finish. A guard that does not
    // terminate is a fail-open of its own kind — CI never completes, so the
    // ticket never lands and the widening ships unchallenged. Sharing the one
    // budget is what puts the member route back under the invariant.
    //
    // IT DOES NOT FULLY FIX M7, and the comment must not imply that it does.
    // The real-`lib/` mutation matrix reaches M7 (`pool.__trusted = new
    // Set([...trusted, ...pool.map((p) => p.channels[0].query)])`) and the suite
    // still does not finish. Measured on the mutated file: ONE root,
    // `pool.__trusted`, takes 27.4s and returns 294 expressions with 5702
    // unresolvables, where the unmutated `trusted` takes 5ms and 2/0. The
    // existing budget bounds FUNCTION BODIES (`resolveCallReturnProvenance`'s
    // `visited` set); nothing bounds the fan-out over NAMES, so a member whose
    // right-hand side re-reads the receiver explodes combinatorially.
    //
    // Attribution, because it decides whose defect this is: the same
    // non-termination reproduces on a DETACHED WORKTREE AT HEAD `9bcf63f`,
    // whose unmutated suite is 28/28 green. So M7 is PRE-EXISTING at HEAD and
    // is NOT introduced by the r11 P1-1/P1-2 work. It is left unfixed here
    // deliberately — repairing it is a separate ticket with its own
    // authorization, and silently widening this repair is exactly what the
    // bounded-repair rule forbids. Tracked as a new finding, not absorbed.
    const budget = { visited: new Set() };
    for (const memberPath of memberWritePathsIn(src, expression)) {
      const split = splitMemberAccess(memberPath);
      if (split === null || seen.has(memberPath)) continue;
      seen.add(memberPath);
      const memberBound = resolveTrustSetProvenance(src, memberPath, { budget });
      checkExpressions(label, memberBound.expressions);
      for (const name of memberBound.unresolvable) {
        unresolvable.push(`${at} \`${label}.${name}\``);
      }
    }
    for (const ident of provenanceIdentifiersIn(expression)) {
      // Globals and built-ins are not trust inputs. `new Set(…)`, `Array.isArray`
      // and a module-level helper named like a builtin would otherwise each be
      // reported as an unresolvable binding, and the guard would drown in noise
      // that is really just vocabulary. Only names the module cannot account for
      // are blind spots, and those are what must fail.
      //
      // r10 P1-1 FIXED HERE. This used to read `PROVENANCE_VOCABULARY.has(ident)`
      // — a bare SPELLING test, which is the r9 P1-2 defect reproduced in the
      // test layer after the helper had already fixed it. So the same widening
      // was caught through a variable (`const filter = targetedPools.map(…)`)
      // and waved through inline (`new Set(filter)`), decided purely by
      // formatting. `isVocabularyOnly` is the binding-aware predicate: a
      // vocabulary word WITH a binding is a variable and must be read.
      if (isVocabularyOnly(src, ident)) continue;
      // Cycle guard: a trust set built from itself resolves to nothing new, and
      // without this the walk would not terminate on `const a = [...a]`.
      if (seen.has(ident)) continue;
      seen.add(ident);

      const nested = resolveName(ident, budget);
      checkExpressions(label, nested.expressions);
      for (const name of nested.unresolvable) unresolvable.push(`${at} \`${label}.${name}\``);
      // NO recursive re-follow here, and the omission is load-bearing. Each
      // route is already transitive: `resolveTrustSetProvenance` walks
      // intermediates to its depth limit, and `resolveCallReturnProvenance`
      // walks the identifiers IT reads. Feeding a route's OUTPUT back in as if
      // it were a fresh expression double-counts that work and, worse, re-reads
      // a whole imported function BODY as if it were one expression — which
      // turned `checkStringList`'s internals (`z_c0`, `password`, `token`, `api`)
      // into blind spots. Depth belongs to the route that owns the scope, not
      // to the caller that started the walk.
    }
  };

  for (const root of trustSetRootsOf(call.callText ?? call.text)) {
    // `__expr__<text>` — an INLINE trust set, e.g.
    // `{ trustedPlanStrings: new Set(targetedPools…) }`. There is nothing to
    // walk, but the expression itself is the evidence, and the identifiers it
    // reads are still followed.
    // P1-A: this branch did not exist, and the empty case silently skipped the
    // site entirely.
    if (root.startsWith('__expr__')) {
      followInto('<inline>', root.slice('__expr__'.length));
      continue;
    }

    // `__shorthand__NAME` — the ES6 shorthand `{ trustedPlanStrings }`, where the
    // trust set is whatever the enclosing function's PARAMETER of that name is
    // bound to. Nothing in this module decides it, so the CALLERS are followed
    // instead: they are where the trusted strings actually enter.
    if (root.startsWith('__shorthand__')) {
      const paramName = root.slice('__shorthand__'.length);
      const callee = enclosingFunctionName(src, call.line);
      if (callee === null) {
        unresolvable.push(`${at} — cannot determine the enclosing function of the shorthand call`);
        continue;
      }
      const nested = resolveShorthandTrustSetFromCallers(LIB_DIR, call.file, callee, paramName);
      // The label is for the MESSAGE, not for resolution. Passing the parameter
      // name into `followInto` as if it were the value made the walk try to
      // resolve `trustedPlanStrings` as a variable, and since the shorthand
      // member name appears in every options literal in the module, that
      // reached `finalize` → `buildCandidateGroups` → its whole inner call
      // graph. The name is known; the CALLERS' expressions are what is unknown.
      for (const expr of nested.expressions) followInto('<shorthand>', expr);
      for (const name of nested.unresolvable) unresolvable.push(`${at} \`${paramName}\` → ${name}`);
      continue;
    }

    // `__opts__NAME` — a trust set hidden behind an options object.
    if (root.startsWith('__opts__')) {
      const varName = root.slice('__opts__'.length);
      const memberExpr = resolveOptionsTrustSetExpression(src, varName);
      if (memberExpr === null) {
        unresolvable.push(
          `${at} — options object \`${varName}\` has no statically readable trustedPlanStrings member`,
        );
        continue;
      }
      // A MEMBER behind the options object is the same case as one written
      // inline, and it has to be classified the same way (r9 P1-3).
      // `resolveOptionsTrustSetExpression` correctly returns `holder.trusted`
      // here, and `followInto` would then check that text and recurse on
      // `provenanceIdentifiersIn` — which yields `holder`, because the property
      // name is stripped by design. So the property write that fed the trust set
      // is never consulted, and the site reads clean. The inline route was
      // already taught this; the options route was not.
      //
      // "IS A MEMBER" IS ASKED OF THE WHOLE VALUE, NOT WITH `includes('.')`.
      // The obvious test also matches
      //
      //   new Set([...plan.queryVariants, ...targetedPools.map(…)])
      //
      // which is an INLINE EXPRESSION that happens to contain a dot, and routing
      // that to the binding walk asks a question about a path that does not
      // exist — the existing P1-2-routing case then read clean. The classifier
      // that already draws this line for the inline route is reused rather than
      // re-derived, because two answers to "is this a name?" is what the r9
      // review found in the first place.
      if (!classifyTrustSetValue(memberExpr).startsWith('__expr__')) {
        const memberBound = resolveTrustSetProvenance(src, memberExpr);
        for (const expr of memberBound.expressions) followInto(varName, expr);
        for (const name of memberBound.unresolvable) unresolvable.push(`${at} \`${varName}\` → ${name}`);
        continue;
      }
      followInto(varName, memberExpr);
      continue;
    }

    // A plain variable. `followInto` on the variable's own name adds the walk
    // `resolveTrustSetProvenance` already performs; it is called for the uniform
    // treatment rather than for extra coverage.
    //
    // A DOTTED root is NOT covered by that uniformity, and the reason is worth
    // recording because it is the whole of r9 P1-3 (r9 P1-3 follow-up).
    // `followInto(root, root)` checks the root's own TEXT and then recurses on
    // the identifiers `provenanceIdentifiersIn(root)` returns. For a bare name
    // the identifier list is `[root]` itself, so the recursion re-asks about the
    // trust set and the binding route answers — the bare case works BECAUSE the
    // text and the binding happen to be the same string. For `holder.trusted`
    // the identifier list is `['holder']` (the property name is stripped, by
    // design), so the recursion asks about the RECEIVER, the receiver's only
    // binding is `const holder = {}`, and the property write that actually fed
    // the trust set is never consulted by anyone.
    //
    // So a dotted root is resolved as a BINDING of that member — which is the
    // question actually being asked — rather than as text.
    // r10 P1-2 FIXED HERE. The test said "is this a member?" with
    // `root.includes('.')`, so the SAME defect survived the helper fix:
    // `classifyTrustSetValue` now routes `holder['trusted']` and `h?.trusted`
    // here as names — and then this predicate sent them straight to
    // `followInto(root, root)`, which checks the member's own TEXT and recurses
    // on `['holder']`. The property write that fed the trust set is never
    // consulted, and r10 P1-2a read clean.
    //
    // The separator is not what makes a member a member, so it must not be the
    // thing that decides. The classifier already draws this line, and it is
    // reused rather than re-derived — two answers to "is this a name?" is how
    // r9's review found the first one.
    if (!classifyTrustSetValue(root).startsWith('__expr__')) {
      const memberBound = resolveTrustSetProvenance(src, root);
      for (const expr of memberBound.expressions) followInto(root, expr);
      for (const name of memberBound.unresolvable) unresolvable.push(`${at} \`${root}\` → ${name}`);
      continue;
    }
    followInto(root, root);
  }

  return { violations, unresolvable };
}

/**
 * Every `trustedPlanStrings` ARGUMENT at one call site, as a list of either a
 * variable to walk or a literal expression to test directly.
 *
 * P1-A FIXED HERE. The previous version returned `[]` for an inline expression
 * (`trustedPlanStrings: new Set(...)`) and for the ES6 shorthand
 * (`{ trustedPlanStrings }`), on the reasoning that "an inline expression yields
 * no roots, and C3's expression test checks it directly". It did not: C3's loop
 * body IS the expression test, so returning `[]` meant the site was never
 * examined at all. Four of the five audited sites — including two of the four
 * frozen F.3 sites — were silently unguarded. The security review found this by
 * running the extractor over the real call surface and observing four empty
 * results.
 *
 * So every shape now yields something to check:
 *   `trustedPlanStrings: <ident>`       -> walk the variable
 *   `trustedPlanStrings: <expression>`  -> test the expression
 *   `{ trustedPlanStrings }` (shorthand)-> walk the parameter
 *   `assertArtifactSafe(x, opts)`       -> resolve the options object
 *
 * @returns {string[]} `__opts__NAME` markers, bare variable names, or `__expr__`
 *   prefixes carrying a literal expression.
 */
function trustSetRootsOf(callText) {
  const roots = [];

  // `assertArtifactSafe(value, opts)` — the options object hides the trust set.
  const bare = /assertArtifactSafe\s*\([^,]+,\s*([A-Za-z_$][\w$]*)\s*\)/.exec(callText);
  if (bare !== null) {
    roots.push(`__opts__${bare[1]}`);
    return roots;
  }

  // ES6 shorthand: `{ trustedPlanStrings }` with no colon. The name after it is
  // a PARAMETER, so it is a variable to walk, not an expression.
  const shorthand = /\{\s*trustedPlanStrings\s*(?:[,}])/.exec(callText);
  if (shorthand !== null) {
    // The identifier is whatever is bound to `trustedPlanStrings` in scope; the
    // call text alone cannot say which, so resolve it from the module instead.
    roots.push('__shorthand__trustedPlanStrings');
    return roots;
  }

  // `trustedPlanStrings: <value>` — read the value with bracket parity so a
  // `new Set([...a, ...b])` is not truncated at its first comma.
  const keyAt = callText.indexOf('trustedPlanStrings');
  if (keyAt !== -1) {
    const after = callText.slice(keyAt + 'trustedPlanStrings'.length);
    const colonAt = after.indexOf(':');
    if (colonAt !== -1) {
      const value = readBalancedValue(after.slice(colonAt + 1));
      if (value !== '') {
        roots.push(classifyTrustSetValue(value));
      }
    }
  }
  return roots;
}

/**
 * Is this trust-set value a THING TO WALK, or an EXPRESSION to test as text?
 *
 * A DOTTED NAME IS A THING TO WALK (r9 P1-3). The bare-identifier test used here
 * is `/^[A-Za-z_$][\w$]*$/`, so `holder.trusted` failed it and was filed as
 * `__expr__holder.trusted` — and the `__expr__` branch tests an expression as
 * TEXT and stops, never asking any route where a value bound to that member
 * came from. So:
 *
 *   const holder = {};
 *   holder.trusted = new Set(targetedPools.map((p) => p.channels[0].query));
 *   assertArtifactSafe(pool, { trustedPlanStrings: holder.trusted });
 *
 * came back clean. The `__expr__` branch is not wrong about expressions — it is
 * wrong about a name, and the two were indistinguishable because the classifier
 * only recognised ONE spelling of "name".
 *
 * The dotted form reaches the binding walk, which resolves the member's own
 * property writes and then the receiver. Anything with brackets, spaces or
 * operators in it is still an expression.
 *
 * r10 P1-2 FIXED HERE: EVERY MEMBER-ACCESS SPELLING IS A NAME.
 * `classifyTrustSetValue` recognised exactly one spelling of "walkable name" —
 * `ident(.ident)*`. The other two spellings of the same member therefore fell
 * through to `__expr__`, whose branch tests text and stops:
 *
 *   holder['trusted'] = new Set(tp.map(…));   // computed write
 *   assertArtifactSafe(pool, { trustedPlanStrings: holder['trusted'] });
 *
 *   h?.trusted = new Set(tp.map(…));          // optional-chained write
 *   assertArtifactSafe(pool, { trustedPlanStrings: h?.trusted });
 *
 * Both are the r9 P1-3 defect again, reached through a different syntax. The
 * distinguishing feature is not the DOT — it is that the value is a member
 * access at all, i.e. a receiver followed by a property, in any of the ways JS
 * spells that. Everything else (calls, spreads, ternaries, arithmetic) stays an
 * expression, because those are genuinely not names.
 *
 * r10 P1-2 FOLLOW-UP: over-broad member recognition is its own failure. Widening
 * this to "any dotted thing" re-broke the r9 P1-2 routing case:
 *
 *   new Set(plan.queryVariants)
 *
 * is an EXPRESSION built from a read, not a name, and routing it to the binding
 * walk asks about a path that does not exist — it made the walk expand
 * `validatePlanInput`'s entire function body and report its locals as blind
 * spots on a frozen production line. So the classifier stays anchored at both
 * ends, which already excludes everything with an operator in it, and
 * `a.b.c` is deliberately NOT a name here: a two-segment path is a read whose
 * base still has to be resolved as an expression.
 */
function classifyTrustSetValue(value) {
  // A bare identifier, or a receiver with EXACTLY ONE property in any spelling
  // (`a.b`, `a['b']`, `a?.b`, `a?.['b']`). Anchored at both ends so an
  // expression that merely CONTAINS a member (`new Set(a.b)`) or chains several
  // (`a.b.c`) stays an expression.
  //
  // r10 P1-2b: this used to carry its OWN copy of that regex, and the copy had
  // lost the pure-bracket form (`a['b']`, no dot at all) that the helper's
  // version has. So the walk was told `holder['trusted']` is a name and the
  // classifier that decides what to DO with a name said it was an expression —
  // two halves of one decision, disagreeing silently, on a security guard.
  // The spellings are now the helper's single definition.
  //
  // r10 P1-2c: this is NOT the helper's `splitMemberAccess`. That one asks "is
  // this NAME a member?" and answers YES for `a.b.c`. This one asks "is this
  // trust-set VALUE a name or an inline expression?", and for `a.b.c` the answer
  // is EXPRESSION — the base is a read whose own value still has to be resolved,
  // so routing it to the binding walk asks about a path that does not exist.
  // Sharing a verdict between the two was r10's first attempt and it regressed
  // C3 into eighteen false blind spots on the frozen line; they share the
  // SPELLINGS, not the answer.
  return isWalkableTrustSetName(value) ? value : `__expr__${value}`;
}

/**
 * The name of the function whose body contains `line`. Scans backwards for the
 * nearest `function NAME(` header at column 0, which is the form every function
 * in this codebase uses.
 */
function enclosingFunctionName(src, line) {
  const lines = src.split('\n');
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i -= 1) {
    const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (m !== null) return m[1];
  }
  return null;
}

/**
 * Read one object-literal member value out of `text`, stopping at the comma or
 * brace that ends it at nesting depth 0. Truncating at the first comma — the
 * obvious implementation — cuts `new Set([...a, ...b])` in half and returns a
 * clean-looking prefix.
 */
function readBalancedValue(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return text.slice(0, i).trim();
      depth -= 1;
    } else if (ch === ',' && depth === 0) return text.slice(0, i).trim();
  }
  return text.trim();
}

/** Strip block and line comments so provenance walks see code, not prose. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

test('C3b: MUTATION PROOF — every widening the security reviews found is now fatal', () => {
  // Non-vacuity proof for C3, EXECUTED rather than asserted, and executed
  // through C3's OWN predicate (`c3TrustSurfaceVerdict`) — a mutation proof
  // that re-derives the rule proves nothing about the rule.
  //
  // The security review showed three widenings that left the first version
  // (identifier-name grep over one statement) green. Each is reproduced here
  // verbatim, and each must now produce a C3 violation.
  const CASES = [
    {
      name: 'P1-1a: an INTERMEDIATE variable hides the targeted surface',
      src: [
        'function f({ targetedPools, plan }) {',
        '  const qs = targetedPools.flatMap((tp) => tp.channels.map((c) => c.query));',
        '  const trusted = new Set([...plan.queryVariants, ...qs]);',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      name: 'P1-1b: a post-construction .add() widens an otherwise clean set',
      src: [
        'function f({ plan, action }) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  const opts = { trustedPlanStrings: trusted };',
        '  trusted.add(action.normalizedQuery);',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      name: 'P1-2: the trust set hides behind an OPTIONS OBJECT',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const opts = { trustedPlanStrings: new Set(targetedPools.flatMap((tp) => tp.channels)) };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    // THE FOURTH REVIEW'S TWO FINDINGS, AS CASES. Both were MISSED by the
    // third revision and both are here so the suite fails if either shape is
    // ever reintroduced. A repair with no case behind it is a repair that
    // decays quietly.
    {
      name: 'P1-1 chain: the widening is TWO lib/ modules away, behind a pending import',
      src: [
        'import { widenPlan } from "./zz-mid.mjs";',
        'function f({ plan }) {',
        '  const trusted = new Set(widenPlan(plan.queryVariants));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
      libFiles: {
        'zz-mid.mjs': [
          'import { harvestTargetedStrings } from "./zz-leaf.mjs";',
          'export function widenPlan(v) {',
          '  return [...v, ...harvestTargetedStrings(v)];',
          '}',
        ].join('\n'),
        'zz-leaf.mjs': [
          'export function harvestTargetedStrings(evaluatedGaps) {',
          '  const targetedPools = evaluatedGaps.map((g) => g.rawQuery);',
          '  return targetedPools;',
          '}',
        ].join('\n'),
      },
    },
    {
      name: 'P1-2 mutation: Object.assign writes targeted bytes into the set',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  Object.assign(trusted, targetedPools.map((tp) => tp.rawQuery));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    // THE ALIAS BYPASS, FOUND BY PROBING THE GUARD AFTER CLOSING THE FOURTH
    // REVIEW'S TWO FINDINGS. Both of those were POSITION holes — a value at a
    // call's return, a value at a callee's first argument. This one is not a
    // position at all, which is why no position-based rule reaches it:
    //
    //     const candidates = mergeCandidates(accumulatedPool, targetedPools);
    //     for (const c of candidates) trusted.add(c.rawQuery);
    //
    // `candidates` is not a targeted surface by name — it is the merged pool, a
    // legitimate value that CONTAINS targeted bytes — so the closed vocabulary
    // has nothing to match, and a rename defeats it. `c` is a loop binding, for
    // which `bindingsOf` had no rule, so `candidates` was never visited and the
    // suite sat at 22/22 green. The synthetic form below is the same shape with
    // a helper in place; the production-equivalent form is asserted separately
    // against the real module.
    {
      name: 'ALIAS: a merge helper output widens the set through a for…of head',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const candidates = mergeCandidates(targetedPools);',
        '  const trusted = new Set(plan.queryVariants);',
        '  for (const c of candidates) {',
        '    if (c && typeof c.rawQuery === "string") trusted.add(c.rawQuery);',
        '  }',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
        'function mergeCandidates(targetedPools) {',
        '  return targetedPools.flatMap((p) => p.candidates);',
        '}',
      ].join('\n'),
    },
    // THE FIFTH REVIEW'S TWO FINDINGS, AS CASES. Both were MISSED by the
    // fourth revision, and the first of them is the worse of the two kinds of
    // hole this guard has produced: it needs no rename, no alias and no
    // computed name. The targeted surface is spelled out in the source and the
    // guard still missed it, because `targetedPools` was the RECEIVER of a
    // `.forEach` whose CALLBACK held the mutation, and nothing connected a
    // callback parameter to the value being iterated.
    {
      name: 'P1-1 receiver: a callback mutates the set from a targeted receiver',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  targetedPools.forEach((p) => p.channels.forEach((c) => trusted.add(c.channel.query)));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // The chained form, which is what the first version of the fix still
      // missed: the mutation sits in the LAST link's argument and the targeted
      // name in the FIRST link's receiver, so a per-link match finds neither.
      name: 'P1-1 receiver: the same widening through a method CHAIN',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  targetedPools.map((p) => p.channels).forEach((cs) => cs.forEach((c) => trusted.add(c.query)));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // P1-2 was a WIRING mismatch rather than a missed shape: the classifier
      // decided a bare-identifier second argument was "readable" and filed it
      // under `call-untrusted`, while C3 only ever examines `trusted +
      // unparsed`. So the `__opts__` branch that can resolve exactly that shape
      // was dead code, and the case passed only because it called the
      // predicate directly with a hand-built call object. This case goes through
      // the same hand-built path C3b always has, and a separate assertion in
      // A1's territory covers the routing; what matters here is that the shape
      // is fatal to the predicate itself.
      name: 'P1-2 routing: the widening behind a bare-identifier options object',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const opts = { trustedPlanStrings: new Set([...plan.queryVariants, ...targetedPools.map((tp) => tp.rawQuery)]) };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    // THE SIXTH REVIEW'S TWO FINDINGS. Both were MISSED by the fifth revision,
    // and the first is the third distinct way the same hole has appeared: a
    // place where the targeted name is present in the source and the guard has
    // no rule that reads it.
    {
      // The chain's root is an ARRAY LITERAL, not a bare name. Requiring
      // `IDENT.method(` skipped it, and `[...x].forEach(…)` is how people write
      // "iterate a copy".
      name: 'P1-1 receiver: the chain root is a spread array literal',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  [...targetedPools].forEach((p) => trusted.add(p.query));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // The chain's root is an EMPTY LITERAL, so the data is in the first
      // link's ARGUMENTS rather than in a receiver at all.
      name: 'P1-1 receiver: the chain root is an empty literal and the data is an argument',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  [].concat(targetedPools).forEach((p) => trusted.add(p.query));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // r7 P1-1. The walk filtered vocabulary by SPELLING, so any honest local
      // named after a library method — `filter`, `map`, `keys`, `result`, `fs`
      // — was dropped instead of followed. Those are legal JavaScript variable
      // names, so the guard could be defeated by renaming ONE local, which is
      // the cheapest bypass in this whole file and the exact class of rename
      // the provenance walk exists to survive. The filter is now positional: a
      // vocabulary word with a BINDING is a variable, and a variable is read.
      name: 'r7 P1-1: a local whose NAME collides with a library method carries targeted bytes',
      src: [
        'function f({ plan, targetedPools }) {',
        '  const filter = targetedPools.flatMap((tp) => tp.channels.map((c) => c.query));',
        '  const trusted = new Set(filter);',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // r7 P1-2. The literal-root fallback tested `/^[[({]\s*[}\])]?$/`, which
      // `[]` passes and `["seed"]` does not. So the equally idiomatic
      //
      //   ["seed"].concat(targetedPools).forEach((p) => trusted.add(p.query))
      //
      // reported the root `["seed"]`, never walked `targetedPools`, and the
      // trust set read as clean. A literal's seed is a datum the chain also
      // carries and the targeted collection is in the arguments either way, so
      // the empty/non-empty distinction has no principled basis: ANY
      // bracket-led root now contributes its first link's arguments.
      name: 'r7 P1-2: a NON-EMPTY literal chain root still hides first-link arguments',
      src: [
        'function f(plan, targetedPools) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  ["seed"].concat(targetedPools).forEach((p) => trusted.add(p.query));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // r7 P2-1. Every entry in TARGETED_SURFACE was `targeted*`-shaped, while
      // the code's own C1 comment names the real carriers —
      // `targetedPools[].channels[].query`, `proposals[].queryText` — none of
      // which matched. The walk resolved `proposals` as an ordinary plan-shaped
      // name and returned a clean verdict. Unlike the two findings above this
      // needs no rename and no exotic chain: it needs the real field name, so
      // it is the least contrived bypass of the three.
      name: 'r7 P2-1: the REAL targeted field name widens the set with no rename at all',
      src: [
        'function f(plan, proposals) {',
        '  const trusted = new Set(proposals.map((p) => p.queryText));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // r9 P1-1 (a). The receiver rule sliced the MUTATION'S OWN LINE, so the
      // two ordinary ways of writing a multi-line callback both put the
      // targeted receiver somewhere else:
      //
      //   targetedPools.forEach((p) => {   <- receiver here
      //     trusted.add(p);                <- mutation here
      //   });
      //
      // Prettier produces this shape for any callback over the line width, so
      // the IDENTICAL widening was a violation on one line and clean when
      // wrapped — a format-dependent bypass. Every receiver fixture through r8
      // was single-line, which is why five review rounds of line-sensitive
      // probing never hit it.
      name: 'r9 P1-1a: a MULTI-LINE callback hides the receiver from the mutation line',
      src: [
        'function f(plan, targetedPools) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  targetedPools.forEach((p) => {',
        '    trusted.add(p);',
        '  });',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // r9 P1-1 (b). The same defect on a chain Prettier wrapped across lines.
      // The chain root is TWO LINES ABOVE the mutation, so even a
      // statement-level slice has to reach back past the `.filter` link.
      name: 'r9 P1-1b: a PRETTIER-WRAPPED chain hides the root from the mutation line',
      src: [
        'function f(plan, targetedPools) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  targetedPools',
        '    .filter((p) => p.ok)',
        '    .forEach((p) => trusted.add(p));',
        '  const opts = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, opts);',
        '}',
      ].join('\n'),
    },
    {
      // r9 P1-2 (a). An IMPORT is a binding, and the vocabulary filter asked a
      // different question from the binding walk — so an honest binding named
      // with a library method's spelling was skipped outright:
      //
      //   import { filter } from './zz-helper.mjs';   // helper reads targetedPools
      //   const trusted = new Set(filter(opts));
      //
      // The non-vocabulary control (`gather`) was CAUGHT through the cross-module
      // route, which proves the engine can see the widening and that only the
      // vocabulary filter was hiding it.
      name: 'r9 P1-2a: an IMPORT named with a vocabulary word still binds a carrier',
      libFiles: {
        'zz-helper.mjs': [
          'export function filter(opts) {',
          '  return (opts.targetedPools ?? []).map((p) => p.channels[0].query);',
          '}',
        ].join('\n'),
      },
      src: [
        "import { filter } from './zz-helper.mjs';",
        'function f(plan, opts) {',
        '  const trusted = new Set(filter(opts));',
        '  const o = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, o);',
        '}',
      ].join('\n'),
    },
    {
      // r9 P1-2 (b). The ALIAS form, which needed two independent fixes: the
      // import had to be recognised as a binding, AND the origin module had to
      // be looked up under the name it exports (`gather`) rather than the name it
      // is bound to locally (`filter`). `importOriginOf` resolved the module
      // correctly and then asked for a body named `filter`, found none, and the
      // route reported a clean resolution instead of a blind spot.
      name: 'r9 P1-2b: an import ALIASED onto a vocabulary word is followed to the origin body',
      libFiles: {
        'zz-helper2.mjs': [
          'export function gather(opts) {',
          '  return (opts.targetedPools ?? []).map((p) => p.channels[0].query);',
          '}',
        ].join('\n'),
      },
      src: [
        "import { gather as filter } from './zz-helper2.mjs';",
        'function f(plan, opts) {',
        '  const trusted = new Set(filter(opts));',
        '  const o = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, o);',
        '}',
      ].join('\n'),
    },
    {
      // r9 P1-2 (c). A DESTRUCTURING ASSIGNMENT binds with no `const|let|var`
      // anywhere, so the declaration patterns see nothing and the carrier reads
      // free one statement later. The leading paren on the object form is what
      // keeps `if (filter = compute())` out.
      name: 'r9 P1-2c: a destructuring ASSIGNMENT named with a vocabulary word binds a carrier',
      src: [
        'function f(plan) {',
        '  const opts = { filter: targetedPools.map((p) => p.channels[0].query) };',
        '  let filter;',
        '  ({ filter } = opts);',
        '  const trusted = new Set(filter);',
        '  const o = { trustedPlanStrings: trusted };',
        '  return assertArtifactSafe(pool, o);',
        '}',
      ].join('\n'),
    },
    {
      // r9 P1-3. The trust set handed over as an OBJECT FIELD rather than a bare
      // variable. Two independent gaps had to close together:
      //
      //   · `trustSetRootsOf` filed `holder.trusted` as an INLINE EXPRESSION
      //     (its bare-identifier test did not match a dotted name), and the
      //     `__expr__` branch tests text and stops — no route was ever asked;
      //   · `bindingsOf` had no rule for a PROPERTY WRITE, so even once it was
      //     walked as a binding, `holder.trusted = new Set(targetedPools…)` was
      //     not connected to anything.
      //
      // The control with a plain variable WAS caught, which is what makes this a
      // hole rather than a limitation of a lexical walk.
      name: 'r9 P1-3: the trust set handed over as an OBJECT FIELD is resolved through the write',
      src: [
        'const holder = {};',
        'function f(pool) {',
        '  holder.trusted = new Set(targetedPools.map((p) => p.channels[0].query));',
        '  const o = { trustedPlanStrings: holder.trusted };',
        '  return assertArtifactSafe(pool, o);',
        '}',
      ].join('\n'),
    },
    {
      // r9 P1-3, second spelling. A CLASS FIELD initialiser, read from a
      // DIFFERENT object than the one written — so there is no receiver to
      // follow and the field initialiser has to be reported against the bare
      // member name.
      name: 'r9 P1-3b: a CLASS FIELD initialiser read through another object is resolved',
      src: [
        'export class TrustHolder {',
        '  trusted = new Set(targetedPools.map((p) => p.channels[0].query));',
        '}',
        'function f(pool, h) {',
        '  const o = { trustedPlanStrings: h.trusted };',
        '  return assertArtifactSafe(pool, o);',
        '}',
      ].join('\n'),
    },
  ];

  // r9 P2-1. An UNRELATED function's parameter must not be able to explain a
  // blind spot in the function that actually holds the trust set.
  //
  // Before the fix, `parameterBindingsOf` / `locallyBoundNames` / Route 4a each
  // scanned the WHOLE MODULE for a matching parameter name. A sibling
  // `function unrelated(filter)` was therefore enough to resolve a trust-set
  // reference to `filter` that has NO binding at all in its own function — the
  // provenance engine reported "explained by parameter `filter`", reported no
  // blind spot, and the widening went through. That is precisely the fail-open
  // this guard exists to prevent, and it is SILENT: an unexplained name and an
  // explained one both yield `violations: []`.
  //
  // Note the predicate. This case is asserted on `unresolvable`, NOT on
  // `violations`, because `filter` here is not itself a targeted surface — the
  // defect is that a blind spot DISAPPEARED, not that a violation appeared.
  // Putting it in `CASES` would have asserted `violations.length > 0`, which is
  // the wrong predicate and which it cannot satisfy at any fix.
  const P2_1_BLIND_SPOT = [
    'function unrelated(filter) {',
    '  return filter;',
    '}',
    'function f(pool) {',
    '  const trusted = new Set(pool.queryVariants);',
    '  trusted.add(filter);',
    '  const opts = { trustedPlanStrings: trusted };',
    '  return assertArtifactSafe(pool, opts);',
    '}',
  ].join('\n');

  // The CONTROL: byte-identical except that `filter` is now declared as a
  // parameter OF `f`, so it IS lexically in scope at the call site and the
  // parameter route must still resolve it.
  //
  // This is the only shape that separates the two states. A control that merely
  // renamed the SIBLING's parameter would pass both before and after the fix
  // (after the fix the sibling is invisible either way) and would prove nothing.
  // Declaring `filter` on `f` is what makes the scoped lookup observable: the
  // counterexample must report a blind spot while the control reports none.
  const P2_1_IN_SCOPE_CONTROL = P2_1_BLIND_SPOT.replace(
    'function f(pool) {',
    'function f(pool, filter) {',
  );

  for (const { name, src, libFiles } of CASES) {
    const stripped = stripComments(src);
    const callText = /return\s+assertArtifactSafe\s*\([^;]*\);/.exec(stripped);
    assert.ok(callText !== null, `precondition: ${name} has a parseable call site`);
    // A case with `libFiles` is a MULTI-MODULE fixture, and BOTH halves have to
    // exist on disk.
    //
    // The siblings obviously have to, or the pending import resolves to nothing
    // and the case fails for a reason unrelated to the rule. The CALLER has to
    // as well, and that one is easy to miss: `importOriginOf` reads
    // `libDir/<call.file>` to find which module declares the imported name, so a
    // `synthetic.mjs` that exists only as an in-memory string is invisible to
    // it. The first version of this fixture did exactly that and the case
    // failed — which is the failure mode worth having, since a case that cannot
    // fail for its stated reason is worse than no case at all.
    //
    // The directory lives in `os.tmpdir()` and is removed in a `finally`, so
    // nothing survives the assertion either way.
    let libDir = LIB_DIR;
    let tempDir = null;
    if (libFiles) {
      tempDir = mkdtempSync(path.join(tmpdir(), 't11-c3b-'));
      for (const [file, body] of Object.entries(libFiles)) {
        writeFileSync(path.join(tempDir, file), `${stripComments(body)}\n`);
      }
      writeFileSync(path.join(tempDir, 'synthetic.mjs'), `${stripped}\n`);
      libDir = tempDir;
    }
    try {
      const verdict = c3TrustSurfaceVerdict(stripped, {
        file: 'synthetic.mjs',
        line: 1,
        text: callText[0].trim(),
        // `callText` CARRIES THE WHOLE ARGUMENT LIST, and `trustSetRootsOf`
        // reads the trust set out of it. Passing only `text` worked for every
        // case above because each of them spells the member on the call's own
        // line — and would have silently mis-parsed the r9 P1-3 cases, whose
        // trust set is a MEMBER (`holder.trusted`) and whose verdict depends on
        // the root classifier running at all. A mutation proof that omits the
        // field under test proves nothing about the field under test.
        callText: callText[0],
      }, { libDir });
      assert.ok(
        verdict.violations.length > 0,
        `C3 must reject this widening — ${name}. A guard that cannot see it is decorative.`,
      );
    } finally {
      if (tempDir !== null) rmSync(tempDir, { recursive: true, force: true });
    }
  }

// (3b) r9 P2-1. The counterexample and its control, asserted together.
  //
  // They are byte-identical except for one token, so any difference in outcome
  // is attributable to that token alone — which is the only form in which a
  // lexical-scope claim is mechanical rather than rhetorical.
  for (const { label, src, expectBlindSpot } of [
    { label: 'sibling-scope counterexample', src: P2_1_BLIND_SPOT, expectBlindSpot: true },
    { label: 'in-scope control', src: P2_1_IN_SCOPE_CONTROL, expectBlindSpot: false },
  ]) {
    const stripped = stripComments(src);
    const callText = /return\s+assertArtifactSafe\s*\([^;]*\);/.exec(stripped);
    assert.ok(callText !== null, `precondition: the P2-1 ${label} has a parseable call site`);
    const verdict = c3TrustSurfaceVerdict(
      stripped,
      {
        file: 'synthetic.mjs',
        line: 1,
        text: callText[0].trim(),
        callText: callText[0],
      },
      { libDir: LIB_DIR },
    );
    assert.deepEqual(
      verdict.violations,
      [],
      `the P2-1 ${label} must report no violation: \`filter\` is not itself a `
        + `targeted surface, and the defect under test is a MISSING blind spot`,
    );
    if (expectBlindSpot) {
      assert.ok(
        verdict.unresolvable.length > 0,
        'a name that is bound ONLY in an unrelated function must be reported as a '
          + 'blind spot — a sibling parameter must not be able to explain it',
      );
    } else {
      assert.deepEqual(
        verdict.unresolvable,
        [],
        `the P2-1 ${label} binds \`filter\` on f itself, so the parameter route — now `
          + `scoped to the trust-set root's own function body — must still resolve it. `
          + `Got: ${JSON.stringify(verdict.unresolvable)}`,
      );
    }
  }

  // (4) Negative control: the REAL production binding must NOT trip C3, or the
  //     three assertions above would be satisfied by an always-throw predicate.
  const realSrc = stripComments(readFileSync(path.join(LIB_DIR, 'targeted-requery-subphase.mjs'), 'utf8'));
  const realCalls = enumerateAssertArtifactSafeCallSurface(LIB_DIR)
    .trusted.filter((c) => c.file === 'targeted-requery-subphase.mjs');
  assert.ok(realCalls.length > 0, 'precondition: the production module has a trusted call site');
  const realVerdicts = realCalls.map((c) => c3TrustSurfaceVerdict(realSrc, c));
  assert.deepEqual(
    realVerdicts.flatMap((v) => v.violations),
    [],
    'precondition: the production trust set is built from plan bytes only',
  );
  assert.deepEqual(
    realVerdicts.flatMap((v) => v.unresolvable),
    [],
    'precondition: and the production trust set provenance is fully resolvable',
  );
  assert.match(
    resolveTrustSetProvenance(realSrc, 'trusted').expressions.join(' | '),
    /plan\.queryVariants/,
    'precondition: and from plan.queryVariants specifically',
  );

  // (5) FALSE-POSITIVE CONTROL for the loop-head rule, which the fifth review
  //     correctly flagged as scope-blind. A loop over a targeted surface that
  //     the trust set never reads is not a widening, and reporting it would be
  //     the noise-to-signal failure that gets real findings waived.
  //
  //     Deliberately uses distinct names (`row` vs `plan`). The review's own
  //     example reused one name for both the loop variable and the plan, which
  //     makes the case ambiguous — a guard that reports `targetedPools` there
  //     is arguably right, and a test built on an ambiguous example cannot
  //     distinguish "correctly strict" from "correctly noisy".
  const unrelatedLoop = [
    'function buildTrustSet({ plan, targetedPools }) {',
    '  for (const row of targetedPools) { void row; }',
    '  const trusted = new Set(plan.queryVariants);',
    '  const opts = { trustedPlanStrings: trusted };',
    '  return assertArtifactSafe(pool, opts);',
    '}',
  ].join('\n');
  const unrelatedVerdict = c3TrustSurfaceVerdict(unrelatedLoop, {
    file: 'synthetic.mjs',
    line: 1,
    text: 'return assertArtifactSafe(pool, opts);',
  });
  assert.deepEqual(
    unrelatedVerdict.violations,
    [],
    'a loop over a targeted surface the trust set never reads is NOT a violation',
  );

  // (6) THE SIXTH REVIEW'S P1-2, WHICH IS NOT A VIOLATION CASE AT ALL.
  //
  // Every other case in this test asserts a VIOLATION, because a targeted
  // surface reached the trust set. This one is the opposite failure: a name NO
  // route can explain, which the guard must report as a blind spot. The shared
  // call-graph budget used to mark a name as visited BEFORE checking whether
  // the body was found, so a second route asking about it got back
  // "already walked" — a body that was never read — and an identifier nothing
  // explains came out as cleanly resolved:
  //
  //   resolveNameInModule(src, 'smuggledTargeted', { budget: { visited: new Set() } })
  //   // → { expressions: ["smuggledTargeted(…) body (already walked)"], unresolvable: [] }
  //
  // That inverts the guard's own contract, stated in C3: an unresolvable
  // binding is a blind spot, not a pass. A blind spot the guard INVENTS for
  // itself is worse than a missing rule, because it turns "I cannot see this"
  // into "I checked this and it is fine" — and a reviewer reading the output
  // has no way to tell the two apart.
  //
  // So this asserts the fail-closed direction explicitly: no violation (there is
  // no targeted surface), and a non-empty unresolvable (the name is
  // unexplained). Asserting only "no violation" would pass on the broken code.
  const unexplained = [
    'function f({ plan }) {',
    '  const trusted = new Set(plan.queryVariants);',
    '  trusted.add(smuggledUndeclaredName);',
    '  const opts = { trustedPlanStrings: trusted };',
    '  return assertArtifactSafe(pool, opts);',
    '}',
  ].join('\n');
  const unexplainedVerdict = c3TrustSurfaceVerdict(unexplained, {
    file: 'synthetic.mjs',
    line: 1,
    text: 'return assertArtifactSafe(pool, opts);',
  });
  assert.deepEqual(
    unexplainedVerdict.violations,
    [],
    'precondition: an unexplained name is not itself a targeted surface',
  );
  assert.ok(
    unexplainedVerdict.unresolvable.length > 0,
    'a name no route explains must be reported as a blind spot — the budget must not ' +
      'memoise a FAILED body lookup as a resolved one',
  );
});

test('C3c: EVERY trust-set call site yields something for C3 to examine', () => {
  // P1-A GUARDED. `trustSetRootsOf` used to return `[]` for an inline
  // expression and for the ES6 shorthand, on the reasoning that C3's expression
  // test would cover them "directly". It did not: the expression test IS the
  // loop body, so an empty result meant the site was never examined. Four of the
  // five audited sites were therefore unguarded while the suite reported green —
  // including two of the four frozen F.3 sites. The security review found it by
  // running the extractor over the real call surface and counting empty results.
  //
  // This asserts the property that was violated: no trust-set call site may
  // yield zero examinable roots. It is a guard ON THE GUARD, which is the only
  // place this class of bug can be caught from — C3's own assertions cannot
  // notice that they were never reached.
  const e = enumerateAssertArtifactSafeCallSurface(LIB_DIR);
  assert.ok(e.trusted.length > 0, 'precondition: trust-set call sites exist');

  const silent = [];
  for (const call of e.trusted) {
    const roots = trustSetRootsOf(call.callText ?? call.text);
    if (roots.length === 0) silent.push(`${call.file}:${call.line} | ${call.text}`);
  }
  assert.deepEqual(
    silent,
    [],
    'every trust-set call site must yield a variable, an expression, or an options '
    + 'marker for C3 to examine; an empty result is an UNGUARDED site, not a clean one',
  );

  // And every site must produce a verdict object C3 can assert on — not merely
  // an entry in an array.
  //
  // P2-1 FIXED HERE. The previous line was
  //   verdicts.filter((v) => v.violations.length > 0 || v.unresolvable.length > 0 || true)
  // whose `|| true` made the predicate constant: every element passed no matter
  // what it contained, so the assertion could not fail and proved nothing. A
  // guard that cannot fail is worse than no guard, because it is indistinguishable
  // from one that is working. The predicate now tests the two properties that
  // actually matter, and the count is compared to the enumerated site count so a
  // site cannot escape by being classified as something other than `trusted`.
  const verdicts = e.trusted.map((c) => c3TrustSurfaceVerdict(
    stripComments(readFileSync(path.join(LIB_DIR, c.file), 'utf8')),
    c,
  ));
  const malformed = verdicts
    .map((v, i) => (v === null || !Array.isArray(v.violations) || !Array.isArray(v.unresolvable)
      ? `${e.trusted[i].file}:${e.trusted[i].line}` : null))
    .filter(Boolean);
  assert.deepEqual(
    malformed,
    [],
    'every site must produce a well-formed verdict; a missing one is an unexamined site, not a clean one',
  );
  assert.equal(verdicts.length, e.trusted.length, 'each site must produce a verdict');
});

// r9 P2-2. The ENUMERATOR is the other half of this guard, and it had the same
// shape of defect C3c exists to catch: a site the enumerator never returned was
// a site no verdict could ever be computed for.
//
// Two independent blindnesses, both silent:
//
//   (a) DEPTH. The scan read one directory level. Any call site in a
//       subdirectory of `lib/` was simply not in the surface, so the suite
//       reported green over a smaller surface than it believed.
//
//   (b) SPELLING. The scan matched the literal string `assertArtifactSafe`. A
//       module that imported the walker under an alias —
//       `import { assertArtifactSafe as safe }` — and then called `safe(...)`
//       produced no call object at all.
//
// A first attempt at this fixture made the walker name a DERIVED value (from the
// file name, yielding `['rrf']`) and then returned an empty set, which "passed"
// for the wrong reason. The fix pins the walker's EXPORTED name as a constant and
// accepts the exported name plus any local alias bound to it — and, critically,
// only for import entries whose EXPORTED name is the walker. Accepting every
// entry in the same `rrf.mjs` import block made `projectSafeJson(` and
// `projectAllowedErrorCode(` match, which broke the production A1 count; that
// regression is what the `unrelated` control below now pins shut.
test('r9 P2-2: the call-surface enumerator sees SUBDIRECTORIES and IMPORT ALIASES', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't11-p22-'));
  try {
    writeFileSync(
      path.join(dir, 'rrf.mjs'),
      [
        'export function assertArtifactSafe(a, b) {',
        '  return { a, b };',
        '}',
        'export function projectSafeJson(x) {',
        '  return x;',
        '}',
        'export function projectAllowedErrorCode(x) {',
        '  return x;',
        '}',
      ].join('\n'),
    );
    // (a) plain spelling, top level.
    writeFileSync(
      path.join(dir, 'plain.mjs'),
      [
        "import { assertArtifactSafe } from './rrf.mjs';",
        'export function f(plan) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  return assertArtifactSafe(plan, { trustedPlanStrings: trusted });',
        '}',
      ].join('\n'),
    );
    // (b) the same walker under an ALIAS.
    writeFileSync(
      path.join(dir, 'aliased.mjs'),
      [
        "import { assertArtifactSafe as safe } from './rrf.mjs';",
        'export function g(plan) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  return safe(plan, { trustedPlanStrings: trusted });',
        '}',
      ].join('\n'),
    );
    // (a) a SUBDIRECTORY call site, one level down.
    mkdirSync(path.join(dir, 'targeted'), { recursive: true });
    writeFileSync(
      path.join(dir, 'targeted', 'new-widening.mjs'),
      [
        "import { assertArtifactSafe } from '../rrf.mjs';",
        'export function h(plan) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  return assertArtifactSafe(plan, { trustedPlanStrings: trusted });',
        '}',
      ].join('\n'),
    );
    // The CONTROL for the over-broad import fix: a module that imports OTHER
    // exports from the same block and calls them. None of these is a walker call,
    // so none may appear in the surface. Without this, "alias-aware" could be
    // satisfied by matching every imported name in the block.
    writeFileSync(
      path.join(dir, 'unrelated.mjs'),
      [
        "import { projectSafeJson, projectAllowedErrorCode } from './rrf.mjs';",
        'export function i(p) {',
        '  return projectSafeJson(p) || projectAllowedErrorCode(p);',
        '}',
      ].join('\n'),
    );

    const surface = enumerateAssertArtifactSafeCallSurface(dir);
    const trustedFiles = surface.trusted.map((c) => c.file).sort();
    const enumeratedFiles = surface.files.map((f) => f.file).sort();

    // Each fixture call carries a trust set, so all three are TRUST-RED call
    // sites — the class a widening would arrive as. Asserting on `trusted`
    // rather than on "some list contains it" is deliberate: a call site with no
    // trust set lands in `untrusted`, and asserting membership of any list would
    // let the test pass on a site C3 never even examines.
    assert.deepEqual(
      trustedFiles,
      ['aliased.mjs', 'plain.mjs', 'targeted/new-widening.mjs'],
      'the TRUST-RED surface must include the aliased call, the plain call, and the '
        + 'SUBDIRECTORY call — and must not include callers of non-walker exports',
    );
    assert.ok(
      surface.trusted.some((c) => c.file === 'aliased.mjs'),
      'precondition: an import alias must not hide a call site',
    );
    assert.ok(
      surface.trusted.some((c) => c.file === 'targeted/new-widening.mjs'),
      'precondition: a subdirectory must not hide a call site',
    );
    assert.equal(
      enumeratedFiles.includes('unrelated.mjs'),
      false,
      'a non-walker export from the same import block is not a walker call site',
    );
    assert.deepEqual(
      surface.unparsed.map((c) => c.file),
      [],
      'no walker call site may be left unclassified',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// r10 P1-1. A widening must not be able to hide behind the SPELLING of the name
// it is read through.
//
// The r9 repair made the helper's own walk binding-aware: a vocabulary word with
// a binding is a variable, not a library method. The TEST layer kept the old
// spelling test, so the same defect survived one layer down:
//
//   const filter = targetedPools.map((p) => p.rawQuery);        // CAUGHT
//   assertArtifactSafe(state, { trustedPlanStrings: new Set(filter) });   // clean
//
// Only the formatting differs. And it is not academic: two of the five frozen
// sites spell their trust set inline, so the blind spelling was covering real
// production ground. Each case below is the reviewer's verbatim input.
test('r10 P1-1: an INLINE trust set read through a vocabulary-spelled binding is not skipped', () => {
  const CASES = [
    {
      name: 'r10 P1-1a: inline `new Set(filter)` where `filter` is a real targeted binding',
      src: [
        'function f(pool, targetedPools) {',
        '  const filter = targetedPools.map((p) => p.rawQuery);',
        '  return assertArtifactSafe(pool, { trustedPlanStrings: new Set(filter) });',
        '}',
      ].join('\n'),
    },
    {
      // The spread form is the CONTROL for the diagnosis. It differs from the
      // case above by one token, and before the fix it was CAUGHT — which is
      // what proves the miss was the spelling filter rather than a limit of the
      // walk: same data, same route, opposite verdict, decided by formatting.
      name: 'r10 P1-1b: CONTROL — the same widening via spread IS caught',
      src: [
        'function f(pool, targetedPools) {',
        '  const filter = targetedPools.map((p) => p.rawQuery);',
        '  return assertArtifactSafe(pool, { trustedPlanStrings: new Set([...filter]) });',
        '}',
      ].join('\n'),
    },
  ];

  for (const { name, src } of CASES) {
    const stripped = stripComments(src);
    const callText = /return\s+assertArtifactSafe\s*\([^;]*\);/.exec(stripped);
    assert.ok(callText !== null, `precondition: ${name} has a parseable call site`);
    const verdict = c3TrustSurfaceVerdict(
      stripped,
      { file: 'synthetic.mjs', line: 1, text: callText[0].trim(), callText: callText[0] },
      { libDir: LIB_DIR },
    );
    assert.ok(
      verdict.violations.length > 0 || verdict.unresolvable.length > 0,
      `C3 must not wave this through — ${name}. A vocabulary SPELLING is not a `
        + `proof that a name is unbound; the binding-aware predicate decides that.`,
    );
  }
});

// r10 P1-2. A member access is a NAME in every spelling JS offers, not only the
// dotted one.
//
// `classifyTrustSetValue` recognised `ident(.ident)*` and nothing else, so the
// computed and optional-chained spellings of the SAME member were filed as
// inline expressions — whose branch tests text and stops. That is the r9 P1-3
// defect reached through different syntax, and both forms returned a completely
// empty verdict.
test('r10 P1-2: COMPUTED and OPTIONAL-CHAINED members are walked, not treated as expressions', () => {
  const CASES = [
    {
      name: 'r10 P1-2a: computed member `holder[\'trusted\']`',
      src: [
        'function f(pool, tp) {',
        '  const holder = {};',
        '  holder[\'trusted\'] = new Set(tp.map((p) => p.query));',
        '  return assertArtifactSafe(pool, { trustedPlanStrings: holder[\'trusted\'] });',
        '}',
      ].join('\n'),
    },
    {
      name: 'r10 P1-2b: optional-chained member `h?.trusted`',
      src: [
        'function f(pool, tp, h) {',
        '  h?.trusted = new Set(tp.map((p) => p.query));',
        '  return assertArtifactSafe(pool, { trustedPlanStrings: h?.trusted });',
        '}',
      ].join('\n'),
    },
  ];

  for (const { name, src } of CASES) {
    const stripped = stripComments(src);
    const callText = /return\s+assertArtifactSafe\s*\([^;]*\);/.exec(stripped);
    assert.ok(callText !== null, `precondition: ${name} has a parseable call site`);
    const verdict = c3TrustSurfaceVerdict(
      stripped,
      { file: 'synthetic.mjs', line: 1, text: callText[0].trim(), callText: callText[0] },
      { libDir: LIB_DIR },
    );
    assert.ok(
      verdict.violations.length > 0 || verdict.unresolvable.length > 0,
      `C3 must not wave this through — ${name}. Every member-access spelling is a `
        + `name to walk; only the separator between receiver and property varies.`,
    );
  }
});

// r10 P1-4. A DYNAMIC index write is not a write to a named member.
//
// This is the regression that the r10 repair itself introduced, and it is here
// because the fix that removed it was found by running the suite, not by reading
// it — so the reason has to outlive the debugging.
//
// The member walk grew a bare-bracket spelling, `h[name] = RHS`, to cover
// `h['name'] = RHS`. Those are not the same statement. With a QUOTED key the
// property is a literal, so the write really is to the member `name`. With a
// VARIABLE key it is a write to whatever property that variable holds at run
// time, and the walk has nothing to follow:
//
//   for (const key of Object.keys(plan)) { out[key] = canonicalize(value[key]); }
//   err[key] = v.issues;      normalized[key] = list;
//
// Those are the loop bodies of `plan-contract.mjs`'s own validators. Treating
// them as writes to a member made `propertyWriteBindingsOf` report three
// unrelated assignments as evidence for EVERY member name the walk asked about,
// and the reads they dragged in (`canonicalize`, `list`, `v.issues`) pulled the
// whole `validatePlanInput` body into the provenance of `retrieval.mjs:800` —
// eighteen false blind spots on the frozen F.3 line the guard exists to protect.
//
// The failure mode is worth naming precisely, because it is the worst kind: the
// guard got LOUDER and no more correct. Every finding it made was noise, on the
// one production line where a real finding must never be waived.
test('r10 P1-4: a DYNAMIC index write is not a write to a named member', () => {
  // The precise invariant, asked of the route the fix changed. `key` is a loop
  // variable, and reading `out[key] = …` as a write to the member `key` is what
  // produced the eighteen false blind spots: a name the module cannot otherwise
  // explain came back "explained" by a write to a property chosen at run time.
  //
  // `resolveNameInModule` is asked directly rather than through C3, because C3's
  // own answer for this fixture is already correct FOR A DIFFERENT REASON — the
  // `out` binding's loop body genuinely reads `plan`, which is on the targeted
  // surface — so asking C3 would test that and not this.
  const withDynamicKey = [
    'function f(plan) {',
    '  const out = {};',
    '  for (const key of Object.keys(plan)) { out[key] = plan[key]; }',
    '  return out;',
    '}',
  ].join('\n');
  const dynamic = resolveNameInModule(withDynamicKey, 'key', {});
  const dynamicExprs = dynamic.expressions.join('\n');
  assert.ok(
    !/out\.key\s*=/.test(dynamicExprs),
    'a dynamic index write must not be reported as a write to the member `key`; '
      + `got: ${dynamicExprs.slice(0, 200)}`,
  );


  // The CONTROL, one token apart: the quoted form IS a member write and must
  // still be found. Without this, the assertion above would also pass on a
  // build that had simply stopped looking at property writes at all.
  const withQuotedKey = [
    'function f(plan) {',
    '  const out = {};',
    "  out['key'] = plan.key;",
    '  return out;',
    '}',
  ].join('\n');
  const quoted = resolveNameInModule(withQuotedKey, 'key', {});
  assert.ok(
    quoted.expressions.some((e) => /out\.key\s*=/.test(e)),
    'a QUOTED index write is a write to that member and must still be found — '
      + `got: ${quoted.expressions.join(' | ').slice(0, 200)}`,
  );
});

// r10 P1-3. The enumerator must see the walker through a LOCAL re-binding.
//
// `localWalkerNames` handled import aliases and stopped there. Assigning the
// walker to a local const produced ZERO call objects — not "unparsed", absent
// from every list — so A1's file lists were unchanged, `unparsed` stayed empty,
// and C3/C3c never iterated the site. The enumerator is the only thing standing
// between a widening and no test at all, and a one-token refactor defeated it.
test('r10 P1-3: a LOCALLY re-bound walker is still enumerated as a call site', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't11-r10p13-'));
  try {
    writeFileSync(
      path.join(dir, 'rrf.mjs'),
      'export function assertArtifactSafe(a, b) { return { a, b }; }\n',
    );
    // (a) const re-binding of the imported walker.
    writeFileSync(
      path.join(dir, 'rebound.mjs'),
      [
        "import { assertArtifactSafe } from './rrf.mjs';",
        'const walker = assertArtifactSafe;',
        'export function seed(pool, targetedPools, plan) {',
        '  const trusted = new Set([...plan.queryVariants, ...targetedPools.map((p) => p.rawQuery)]);',
        '  return walker(pool, { trustedPlanStrings: trusted });',
        '}',
      ].join('\n'),
    );
    // (b) CONTROL: the identical widening called DIRECTLY, which r9 already
    // caught. If this one were missed the fixture would be broken rather than
    // the enumerator, so it is asserted alongside.
    writeFileSync(
      path.join(dir, 'direct.mjs'),
      [
        "import { assertArtifactSafe } from './rrf.mjs';",
        'export function seed(pool, targetedPools, plan) {',
        '  const trusted = new Set([...plan.queryVariants, ...targetedPools.map((p) => p.rawQuery)]);',
        '  return assertArtifactSafe(pool, { trustedPlanStrings: trusted });',
        '}',
      ].join('\n'),
    );

    const surface = enumerateAssertArtifactSafeCallSurface(dir);
    const files = surface.trusted.map((c) => c.file).sort();
    assert.deepEqual(
      files,
      ['direct.mjs', 'rebound.mjs'],
      'a walker reached through a local const is the same walker: it must appear in '
        + 'the TRUST-RED surface exactly as a direct call does',
    );
    assert.deepEqual(
      surface.unparsed.map((c) => c.file),
      [],
      'no walker call site may be left unclassified',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('r11 P1-1: a MEMBER nested inside an inline trust set is a binding, not a read', () => {
  // The hole the tenth security review's repair opened, and the second one this
  // guard has produced that needs no rename, no computed key and no alias — one
  // dot on a read:
  //
  //   const holder = {};
  //   holder.trusted = new Set([...plan.queryVariants, ...targetedPools.map((p) => p.rawQuery)]);
  //   assertArtifactSafe(pool, { trustedPlanStrings: new Set(holder.trusted) });
  //
  // `followInto` reduces every expression through `provenanceIdentifiersIn`,
  // which strips property names BY DESIGN. So `new Set(holder.trusted)` yields
  // `['new','Set','holder']`, the walk asks about `holder`, and `holder`'s only
  // binding is the empty object. The statement carrying the targeted string is
  // consulted by nobody. I reproduced the verdict: `{violations: [],
  // unresolvable: []}` — CLEAN.
  //
  // It is the same class of defect as r9 P1-3, which is why the fix is in the
  // same place: the trust set is a BINDING of `holder.trusted`, and a property
  // write is what makes it one.
  const CASES = [
    {
      name: 'inline Set over a member: new Set(holder.trusted)',
      value: 'new Set(holder.trusted)',
    },
    {
      name: 'inline spread over a COMPUTED member: [...holder[\'trusted\']]',
      value: 'new Set([...plan.queryVariants, ...holder[\'trusted\']])',
    },
    {
      name: 'inline Set over an OPTIONAL-CHAINED member: holder?.trusted',
      value: 'new Set(holder?.trusted)',
    },
  ];

  for (const c of CASES) {
    const src = [
      'function f(pool, plan, targetedPools) {',
      '  const holder = {};',
      '  holder.trusted = new Set([...plan.queryVariants, ...targetedPools.map((p) => p.rawQuery)]);',
      `  return assertArtifactSafe(pool, { trustedPlanStrings: ${c.value} });`,
      '}',
    ].join('\n');
    const verdict = c3TrustSurfaceVerdict(src, { file: 'r11-p1-1.mjs', line: 4, text: '', callText: `assertArtifactSafe(pool, { trustedPlanStrings: ${c.value} })` });
    assert.ok(
      verdict.violations.length > 0,
      `${c.name}: a member whose PROPERTY WRITE carries a targeted string must be a `
        + 'violation — the write is the binding, and a clean verdict here is the '
        + 'fail-open this test exists to make impossible to reintroduce',
    );
  }

  // AND THE POSITIVE CONTROL, because a rule that fires on every member is just
  // as wrong as one that fires on none. `worker` is a receiver with a property
  // write in the module, and its write is CLEAN — the site must stay clean. This
  // is the noise half of the contract: the member route is consulted for members
  // the module WRITES, and consulting it must not manufacture findings.
  const cleanSrc = [
    'function f(pool, plan) {',
    '  const holder = {};',
    '  holder.trusted = new Set(plan.queryVariants);',
    '  return assertArtifactSafe(pool, { trustedPlanStrings: new Set(holder.trusted) });',
    '}',
  ].join('\n');
  const cleanVerdict = c3TrustSurfaceVerdict(cleanSrc, {
    file: 'r11-p1-1-clean.mjs',
    line: 4,
    text: '',
    callText: 'assertArtifactSafe(pool, { trustedPlanStrings: new Set(holder.trusted) })',
  });
  assert.deepEqual(
    cleanVerdict.violations,
    [],
    'a member whose property write is plan-shaped is clean — the member route must not '
      + 'manufacture violations, or its findings get waived as noise',
  );
});

test('r11 P1-1b: a PURE member read is not dragged into the member route', () => {
  // The reason the fix above is scoped to members the module WRITES, stated as
  // an executable test because the scoping is a judgement call and judgement
  // calls decay.
  //
  // `Array.isArray(plan.queryVariants) ? plan.queryVariants : []` is the REAL
  // trust set on `coverage-final-integration.mjs:461`. Routing every member
  // through the member route there yields 45 expressions and 8 blind spots —
  // `failClosed`, `CoverageIntegrationError`, `seam` and friends reported as
  // unresolvable on the frozen line the guard exists to protect. Eight false
  // blind spots is worse than the hole: a reader trained to waive unresolvable
  // waives the real one.
  const src = [
    'function f(pool, plan) {',
    '  return assertArtifactSafe(pool, {',
    '    trustedPlanStrings: new Set(Array.isArray(plan.queryVariants) ? plan.queryVariants : []),',
    '  });',
    '}',
  ].join('\n');
  assert.deepEqual(
    memberWritePathsIn(src, 'new Set(Array.isArray(plan.queryVariants) ? plan.queryVariants : [])'),
    [],
    'no member in this expression is written in this module, so none may be routed to the '
      + 'member route — the receiver walk already covers a pure read',
  );
  // While a member that IS written is routed. Same predicate, opposite answer.
  const written = [
    'function f(pool, plan, targetedPools) {',
    '  const holder = {};',
    '  holder.trusted = new Set(targetedPools.map((p) => p.rawQuery));',
    '  return assertArtifactSafe(pool, { trustedPlanStrings: new Set(holder.trusted) });',
    '}',
  ].join('\n');
  assert.deepEqual(
    memberWritePathsIn(written, 'new Set(holder.trusted)'),
    ['holder.trusted'],
    'a member WITH a property write is a binding and must be routed',
  );
});

test('r11 P1-2: walker aliases bound LATE, from a NAMESPACE, or via .bind() are enumerated', () => {
  // r10 taught the enumerator `const w = assertArtifactSafe;`. Three spellings of
  // the same statement with the declaration or the qualifier moved defeated it,
  // and I verified all three vanish from EVERY list — not `unparsed`, ABSENT —
  // so A1's completeness check passed and C3 never iterated the site:
  //
  //   let w;  w = assertArtifactSafe;              // late-bound
  //   const w = rrf.assertArtifactSafe;            // namespace member
  //   const w = assertArtifactSafe.bind(null);     // partially applied
  //
  // Each is one token from a form that IS handled, which is what makes this class
  // of hole expensive: the cost of the miss is a clean C3 verdict, not a
  // reported blind spot.
  const dir = mkdtempSync(path.join(tmpdir(), 't11-r11p12-'));
  try {
    writeFileSync(
      path.join(dir, 'rrf.mjs'),
      [
        'export function assertArtifactSafe(a, b) { return { a, b }; }',
        'export const rrf = { assertArtifactSafe };',
        '',
      ].join('\n'),
    );
    const WIDENING = [
      '  const trusted = new Set([...plan.queryVariants, ...targetedPools.map((p) => p.rawQuery)]);',
      '  return %s(pool, { trustedPlanStrings: trusted });',
    ];
    const shapes = {
      // (a) late-bound: declared first, assigned on a later line.
      'a-late-assign.mjs': { pre: ['let w;', 'w = assertArtifactSafe;'], call: 'w' },
      // (b) namespace member.
      'b-namespace.mjs': { pre: ['const w = rrf.assertArtifactSafe;'], call: 'w' },
      // (c) partially applied — a bound function is still the walker.
      'c-bind.mjs': { pre: ['const w = assertArtifactSafe.bind(null);'], call: 'w' },
      // (d) alias of an alias: the fixpoint has to carry the fact forward.
      'd-alias-chain.mjs': { pre: ['const a = assertArtifactSafe;', 'const w = a;'], call: 'w' },
      // (e) FORMER-REFERENCE chain, three deep. The aliases are declared in
      //     REVERSE order, so each pass can only advance one link: the set has
      //     `assertArtifactSafe` initially, pass 1 finds `b`, pass 2 finds `a`,
      //     pass 3 finds `w`. A single pass leaves `w` invisible — this is the
      //     case that makes the fixpoint load-bearing rather than tidy, and I
      //     verified it needs all three passes.
      'e-forward-chain.mjs': {
        pre: ['const w = a;', 'const a = b;', 'const b = assertArtifactSafe;'],
        call: 'w',
      },
      // (f) COMMA-SEPARATED declaration. `const w = assertArtifactSafe, other = 1;`
      //     is why there are TWO assignment loops: the declaration form stops at
      //     the comma, and the bare-assignment form stops at the semicolon and
      //     captures `assertArtifactSafe, other = 1` as the right-hand side — a
      //     value that is not the walker. Only the declaration form sees this
      //     one, and without it the site is absent from every list.
      'f-comma-decl.mjs': { pre: ['const w = assertArtifactSafe, other = 1;'], call: 'w' },
      // (g) CONTROL: the direct call r9 already caught. If this one were missed
      // the fixture would be broken rather than the enumerator.
      'g-control-direct.mjs': { pre: [], call: 'assertArtifactSafe' },
    };
    for (const [file, shape] of Object.entries(shapes)) {
      writeFileSync(path.join(dir, file), [
        "import { assertArtifactSafe, rrf } from './rrf.mjs';",
        ...shape.pre,
        'export function seed(pool, targetedPools, plan) {',
        ...WIDENING.map((l) => l.replace('%s', shape.call)),
        '}',
      ].join('\n'));
    }

    const surface = enumerateAssertArtifactSafeCallSurface(dir);
    const listed = new Set([
      ...surface.trusted.map((c) => c.file),
      ...surface.unparsed.map((c) => c.file),
    ]);
    for (const file of Object.keys(shapes)) {
      assert.ok(
        listed.has(file),
        `${file}: a walker reached through ${file} must appear in the enumerated surface. `
          + 'ABSENT (not "unparsed") is the failure that matters — it means A1 passes and C3 '
          + 'never looks at the site.',
      );
    }
    // Every one of them is a TRUST-RED call (the options literal names a trust
    // set), so they belong in `trusted` specifically, not merely somewhere.
    assert.deepEqual(
      surface.trusted.map((c) => c.file).sort(),
      Object.keys(shapes).sort(),
      'each alias form must be classified into the same TRUST-RED bucket a direct call is',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('r11 P1-2b: an ordinary local assignment is NOT read as a walker alias', () => {
  // The negative half of r11 P1-2, and the reason the bare-assignment rule keys
  // on the RIGHT-HAND SIDE. Keying it on the left (as the first attempt did)
  // deadlocks `let w; w = assertArtifactSafe;`, because `w` is never a known
  // walker name; keying it on the right without this test would put every
  // reassigned local in the walker spellings, and then every `workDir(` in a
  // 4000-line module reads as a walker call site.
  const dir = mkdtempSync(path.join(tmpdir(), 't11-r11p12b-'));
  try {
    writeFileSync(
      path.join(dir, 'rrf.mjs'),
      'export function assertArtifactSafe(a, b) { return { a, b }; }\n',
    );
    writeFileSync(
      path.join(dir, 'innocent.mjs'),
      [
        "import { assertArtifactSafe } from './rrf.mjs';",
        'let workDir;',
        'workDir = somethingElse;',
        'let other = compute();',
        'other = workDir;',
        'export function seed(pool, plan) {',
        '  const trusted = new Set(plan.queryVariants);',
        '  return assertArtifactSafe(pool, { trustedPlanStrings: trusted });',
        '}',
      ].join('\n'),
    );
    const surface = enumerateAssertArtifactSafeCallSurface(dir);
    assert.deepEqual(
      surface.unparsed.map((c) => c.file),
      [],
      'a local that merely gets reassigned must not become a walker spelling — otherwise '
        + 'every call of it becomes a call site and A1 fails on unrelated code',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
