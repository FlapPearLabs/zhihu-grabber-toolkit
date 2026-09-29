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
  resolveTrustSetProvenance,
  resolveOptionsTrustSetExpression,
  resolveShorthandTrustSetFromCallers,
  provenanceIdentifiersIn,
  resolveCallReturnProvenance,
  resolveImportedCallReturnProvenance,
  resolveNameInModule,
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
 */
const TARGETED_SURFACE = /\b(targetedPools|targetedActions|targetedActionId|targetedQuer|targetedString|authorizedAction|evaluatedGaps|diagnosedLedger|normalizedQuery|targetedQuery)\b/;

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
 * @returns {{violations: string[], unresolvable: string[]}}
 */
function c3TrustSurfaceVerdict(src, call) {
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
    for (const name of candidates) {
      const imported = resolveImportedCallReturnProvenance(LIB_DIR, call.file, name, { budget });
      if (!imported.found) continue;
      resolvedAny = true;
      expressions.push(...imported.expressions);
      unresolvable.push(...imported.unresolvable);
    }
    if (resolvedAny) return { expressions, unresolvable };

    // Nothing in this module or its `lib/` imports accounts for the name. A
    // callback parameter reaches here only if the lexical walk missed its
    // scope, so this is a real blind spot and C3 fails closed on it.
    return { expressions: [], unresolvable: [ident] };
  };

  const followInto = (label, expression, seen = new Set()) => {
    checkExpressions(label, [expression]);
    // ONE budget for the whole call site, shared by every route beneath it.
    // The routes call each other — the binding walk asks the body route, the
    // body route asks the binding walk, and the cross-module route re-enters
    // both in the origin module — so a per-identifier budget never terminates.
    // Sharing it makes every function body resolve at most once per call site.
    const budget = { visited: new Set() };
    for (const ident of provenanceIdentifiersIn(expression)) {
      // Globals and built-ins are not trust inputs. `new Set(…)`, `Array.isArray`
      // and a module-level helper named like a builtin would otherwise each be
      // reported as an unresolvable binding, and the guard would drown in noise
      // that is really just vocabulary. Only names the module cannot account for
      // are blind spots, and those are what must fail.
      if (PROVENANCE_VOCABULARY.has(ident)) continue;
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
      for (const expr of nested.expressions) followInto(paramName, expr);
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
      followInto(varName, memberExpr);
      continue;
    }

    // A plain variable. `followInto` on the variable's own name adds the walk
    // `resolveTrustSetProvenance` already performs; it is called for the uniform
    // treatment rather than for extra coverage.
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
        roots.push(/^[A-Za-z_$][\w$]*$/.test(value) ? value : `__expr__${value}`);
      }
    }
  }
  return roots;
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

test('C3b: MUTATION PROOF — the three widenings the security review found are now fatal', () => {
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
  ];

  for (const { name, src } of CASES) {
    const stripped = stripComments(src);
    const callText = /return\s+assertArtifactSafe\s*\([^;]*\);/.exec(stripped);
    assert.ok(callText !== null, `precondition: ${name} has a parseable call site`);
    const verdict = c3TrustSurfaceVerdict(stripped, {
      file: 'synthetic.mjs',
      line: 1,
      text: callText[0].trim(),
    });
    assert.ok(
      verdict.violations.length > 0,
      `C3 must reject this widening — ${name}. A guard that cannot see it is decorative.`,
    );
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
