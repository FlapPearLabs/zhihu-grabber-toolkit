// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p1-t12-rce-corpus-selector.test.mjs
 *
 * P1-T12 — RCE Corpus Selector tests (Issue #44; Spec §3 / §1.1 / §9.2).
 *
 * Counterexample-first TDD against the frozen contracts:
 *   - INPUT  = SEAM A ResearchCorpusManifest (P1_SEAM_CONTRACTS_V1 §SEAM A)
 *              + dense geometry signals (lib/dense-geometry.mjs, T11);
 *   - OUTPUT = SEAM B Selected Verified Research Corpus, cross-checked with the
 *              FROZEN validator (test/helpers/p1-seam-contracts.mjs).
 *
 * Required test families (Issue #44 REQUIRED_TESTS + seam §SEAM B):
 *   preservation invariants / accounting completeness / anchor non-authority /
 *   MMR-optional semantics / exclusion reasons / identity determinism /
 *   mode identity (no top-percent-analysis or sampled masquerade, no `analyzed`
 *   field anywhere) / fail-closed SEAM_B_* codes / verified-only traceability.
 *
 * Pure, offline, deterministic. No network, no credentials, no fixtures files
 * added (inputs are constructed in-code from a valid SEAM A manifest builder).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  selectResearchCorpus,
  verifySelectedResearchCorpus,
  RCE_SELECTOR_MODE,
  RceSelectorError,
  DEFAULT_RELEVANCE_FLOOR,
  DEFAULT_NOVELTY_WEIGHT,
  DEFAULT_MMR_LAMBDA,
  DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  EXCLUSION_BELOW_RELEVANCE_FLOOR,
  EXCLUSION_NEAR_DUPLICATE,
} from '../lib/rce-corpus-selector.mjs';

import {
  validateSelectedResearchCorpus,
  walkForForbiddenKeys,
} from './helpers/p1-seam-contracts.mjs';

// ---------------------------------------------------------------------------
// deterministic test doubles: a VALID SEAM A manifest builder
// ---------------------------------------------------------------------------

const PLAN_HASH = '5f1a2b3c4d5e6f708192a3b4c5d6e7f80112233445566778899aabbccddeeff0';

function hex64(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex');
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Same canonical JSON domain as the frozen validator (key-sorted recursion).
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Build a SEAM A group entry (shape mirrors the frozen multi-group fixture). */
function manifestGroup(qid, { captured = 1, reported = 1, status = 'complete' } = {}) {
  return {
    groupId: qid,
    questionId: qid,
    answersRel: `zhihu/${qid}/answers.json`,
    handoffRel: `zhihu/${qid}/handoff.json`,
    answersHash: hex64(`answers:${qid}`),
    handoffHash: hex64(`handoff:${qid}`),
    capturedAnswerCount: captured,
    reportedAnswerCount: reported,
    paginationStatus: status,
  };
}

/** Build a self-verifying SEAM A manifest (manifestHash recomputed correctly). */
function buildManifest(groupEntries) {
  const manifest = {
    schemaVersion: 1,
    type: 'research-corpus-manifest',
    planHash: PLAN_HASH,
    selectionIdentity: hex64('selection-identity'),
    selectionDecisionHash: hex64('selection-decision'),
    groups: groupEntries,
    accounting: {
      selectedGroupCount: groupEntries.length,
      verifiedGroupCount: groupEntries.length,
      capturedNotVerifiedGroupCount: 0,
      failedGroupCount: 0,
    },
  };
  manifest.manifestHash = sha256Hex(canonicalJson(manifest));
  return manifest;
}

/** An eligible source candidate decomposed from a verified group artifact. */
function source(qid, n, { relevance, novelty = 0.5, answerCount } = {}) {
  const s = {
    canonicalSourceId: `${qid}-a-${n}`,
    contentHash: `sha256:${hex64(`content:${qid}:${n}`)}`,
  };
  if (answerCount !== undefined) s.answerCount = answerCount;
  return s;
}

function signal(relevance, novelty = 0.5) {
  return { relevance, novelty, redundancy: 1 - novelty };
}

function signalsFor(groups) {
  const out = {};
  for (const [qid, list] of Object.entries(groups)) {
    for (const s of list) out[s.canonicalSourceId] = s.__signal;
  }
  return out;
}

/** Attach signals to sources and return { sourcesByGroup, denseSignals }. */
function prepare(groups) {
  const sourcesByGroup = {};
  const denseSignals = {};
  for (const [qid, list] of Object.entries(groups)) {
    sourcesByGroup[qid] = list.map((s) => {
      const { __signal, ...rest } = s;
      denseSignals[s.canonicalSourceId] = __signal;
      return rest;
    });
  }
  return { sourcesByGroup, denseSignals };
}

function sourcesWith(qid, specs) {
  return specs.map(([n, relevance, novelty, answerCount]) => {
    const s = source(qid, n, { relevance, novelty, answerCount });
    s.__signal = signal(relevance, novelty);
    return s;
  });
}

/** Default 3-group scenario: large / starving-minority / medium groups. */
function baseScenario() {
  const manifest = buildManifest([
    manifestGroup('900001', { captured: 6, reported: 6 }),
    manifestGroup('900002', { captured: 1, reported: 1 }),
    manifestGroup('900003', { captured: 3, reported: 3 }),
  ]);
  const prepared = prepare({
    900001: sourcesWith('900001', [
      [1, 0.9, 0.6], [2, 0.8, 0.2], [3, 0.7, 0.9], [4, 0.6, 0.1], [5, 0.3, 0.4], [6, -0.2, 0.5],
    ]),
    // minority group: its ONLY source is below the relevance floor
    900002: sourcesWith('900002', [[1, -0.5, 0.5]]),
    900003: sourcesWith('900003', [[1, 0.6, 0.5], [2, 0.5, 0.5], [3, 0.4, 0.5]]),
  });
  return { manifest, ...prepared };
}

function group(artifact, groupId) {
  return artifact.corpus.groups.find((g) => g.groupId === groupId);
}

function exclusionSum(acc) {
  return Object.values(acc.exclusionReasonCategories || {}).reduce((s, n) => s + n, 0);
}

function assertHasErrorCode(fn, code) {
  assert.throws(fn, (e) => e instanceof RceSelectorError && e.code === code,
    `expected RceSelectorError ${code}`);
}

// ---------------------------------------------------------------------------
// preservation invariants (Spec §3.1)
// ---------------------------------------------------------------------------

describe('P1-T12 preservation invariants (Spec §3.1)', () => {
  const { manifest, sourcesByGroup, denseSignals } = baseScenario();

  test('relevant/minority group whose every source is below the floor is NOT silently zero-represented', () => {
    const artifact = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });
    const minority = group(artifact, '900002');
    assert.ok(minority, 'minority group must appear in corpus.groups');
    assert.equal(minority.selectedSourceRefs.length, 1, 'anti-starvation floor keeps the best source');
    assert.equal(minority.accounting.eligible, 1);
    assert.equal(minority.accounting.selected, 1);
    assert.equal(minority.accounting.verified, 1);
  });

  test('large group never silently swallows a small group: growing the large group leaves the small group byte-identical', () => {
    const big = sourcesWith('900001', Array.from({ length: 30 }, (_, i) => [i + 1, 0.9 - i * 0.01, 0.5]));
    const small = sourcesWith('900003', [[1, 0.6, 0.5], [2, 0.5, 0.5], [3, 0.4, 0.5]]);
    const minority = sourcesWith('900002', [[1, -0.5, 0.5]]);
    const m = buildManifest([
      manifestGroup('900001', { captured: 30 }), manifestGroup('900002'), manifestGroup('900003'),
    ]);
    const withBigGroup = prepare({ 900001: big, 900002: minority, 900003: small });
    const withSmallGroup = prepare({ 900001: big.slice(0, 5), 900002: minority, 900003: small });

    const a = selectResearchCorpus({ manifest: m, ...withBigGroup });
    const b = selectResearchCorpus({ manifest: m, ...withSmallGroup });

    assert.deepEqual(
      JSON.stringify(group(a, '900002')), JSON.stringify(group(b, '900002')),
      'small-group selection must not depend on the large group abundance',
    );
    assert.deepEqual(
      JSON.stringify(group(a, '900003')), JSON.stringify(group(b, '900003')),
    );
    // per-group independence: every group with >=1 eligible keeps >=1 selected
    for (const g of a.corpus.groups) assert.ok(g.selectedSourceRefs.length >= 1);
  });

  test('every verified manifest group is represented in the output corpus', () => {
    const artifact = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });
    const manifestIds = manifest.groups.map((g) => g.groupId).sort();
    const corpusIds = artifact.corpus.groups.map((g) => g.groupId).sort();
    assert.deepEqual(corpusIds, manifestIds);
  });
});

// ---------------------------------------------------------------------------
// selection accounting completeness (§9.2 / §SEAM B invariants)
// ---------------------------------------------------------------------------

describe('P1-T12 selection accounting completeness', () => {
  const { manifest, sourcesByGroup, denseSignals } = baseScenario();
  const artifact = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });

  test('output satisfies the FROZEN SEAM B validator (unit-level producer conformance)', () => {
    const result = validateSelectedResearchCorpus(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('selected <= verified <= eligible per group; verified == selected (verified-only)', () => {
    for (const g of artifact.corpus.groups) {
      const { eligible, selected, verified } = g.accounting;
      assert.ok(selected <= verified && verified <= eligible, `${g.groupId}: ${selected}/${verified}/${eligible}`);
      assert.equal(verified, selected, 'every selected source is verified-only');
      assert.equal(g.selectedSourceRefs.length, selected);
    }
  });

  test('every excluded eligible source has a recorded exclusion reason category (per group and totals)', () => {
    for (const g of artifact.corpus.groups) {
      assert.equal(g.accounting.eligible - g.accounting.selected, exclusionSum(g.accounting));
    }
    const t = artifact.corpus.totals;
    assert.equal(t.eligible - t.selected, exclusionSum(t));
    const groupSum = artifact.corpus.groups.reduce(
      (s, g) => s + g.accounting.eligible, 0);
    assert.equal(t.eligible, groupSum);
  });

  test('floor exclusions are recorded under the documented category vocabulary', () => {
    const big = group(artifact, '900001');
    assert.equal(big.accounting.eligible, 6);
    assert.equal(big.accounting.selected, 5);
    assert.equal(big.accounting.exclusionReasonCategories[EXCLUSION_BELOW_RELEVANCE_FLOOR], 1);
    const allowed = new Set([EXCLUSION_BELOW_RELEVANCE_FLOOR, EXCLUSION_NEAR_DUPLICATE]);
    for (const g of artifact.corpus.groups) {
      for (const cat of Object.keys(g.accounting.exclusionReasonCategories)) {
        assert.ok(allowed.has(cat), `unexpected exclusion category ${cat}`);
      }
    }
  });

  test('accounting.verified is PINNED to accounting.selected (verified := selected reading)', () => {
    // Reviewer round 1 (F2): §SEAM B permits selected <= verified <= eligible;
    // the alternative reading (verified := eligible) is a product-owner
    // decision. This test pins the current reading so a silent semantic change
    // fails loudly (see P1_T12_CONTRACT_EXTRACTION.md §5 DECISION_REQUIRED).
    for (const g of artifact.corpus.groups) {
      assert.equal(g.accounting.verified, g.accounting.selected, `${g.groupId}: verified must equal selected under the pinned reading`);
    }
    assert.equal(artifact.corpus.totals.verified, artifact.corpus.totals.selected);
  });

  test('default relevance floor is 0, pinned through observable behavior (not asserted against itself)', () => {
    // DEFAULT_RELEVANCE_FLOOR = 0 means: relevance exactly 0 is KEPT, a small
    // negative is floor-excluded, and an explicit lower floor admits it back.
    // (A floor > 0 would drop the relevance-0 source; a floor < 0 would keep
    // the negative one — this run shape is only produced by floor == 0.)
    const m = buildManifest([manifestGroup('930001', { captured: 3 })]);
    const prepared = prepare({
      930001: sourcesWith('930001', [[1, 0.9, 0.5], [2, 0, 0.5], [3, -0.1, 0.5]]),
    });
    const run = (opts) => selectResearchCorpus({ manifest: m, ...prepared, options: opts });
    const artifact = run({});
    const g = group(artifact, '930001');
    assert.deepEqual(
      g.selectedSourceRefs.map((r) => r.canonicalSourceId),
      ['930001-a-1', '930001-a-2'],
      'relevance exactly 0 is kept under the default floor',
    );
    assert.equal(g.accounting.exclusionReasonCategories[EXCLUSION_BELOW_RELEVANCE_FLOOR], 1);
    const lower = run({ relevanceFloor: -1 });
    assert.equal(group(lower, '930001').selectedSourceRefs.length, 3, 'an explicit lower floor is a real tunable, not a hard rule');
    // tie the constant to the behavior: explicit DEFAULT == implicit default
    assert.equal(JSON.stringify(run({})), JSON.stringify(run({ relevanceFloor: DEFAULT_RELEVANCE_FLOOR })));
  });
});

// ---------------------------------------------------------------------------
// popularity anchor is NON-authoritative (Spec §3.1 / §3.2)
// ---------------------------------------------------------------------------

describe('P1-T12 popularity anchor is non-authoritative', () => {
  test('a high-answerCount low-relevance source never gains selection advantage from popularity', () => {
    // both sources stay selected (no cap), so popularity must have ZERO effect:
    // placing the huge answer count on either source yields identical output.
    const m = buildManifest([manifestGroup('910001', { captured: 2 })]);
    const mk = (popOnFirst) => {
      const prepared = prepare({
        910001: [
          { ...source('910001', 1, { relevance: 0.2, answerCount: popOnFirst ? 100000 : 1 }), __signal: signal(0.2, 0.5) },
          { ...source('910001', 2, { relevance: 0.9, answerCount: popOnFirst ? 1 : 100000 }), __signal: signal(0.9, 0.5) },
        ],
      });
      return selectResearchCorpus({ manifest: m, ...prepared });
    };
    const a = mk(true);
    const b = mk(false);
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'answer count placement must not change the artifact');
    assert.equal(group(a, '910001').selectedSourceRefs.length, 2);
  });

  test('popularity never rescues a source from relevance-based preservation ranking', () => {
    // all sources below the floor: preservation keeps the highest-RELEVANCE
    // source, even if another source carries an enormous answer count.
    const m = buildManifest([manifestGroup('910002', { captured: 2 })]);
    const prepared = prepare({
      910002: [
        { ...source('910002', 1, { relevance: -0.1, answerCount: 1000000 }), __signal: signal(-0.1, 0.5) },
        { ...source('910002', 2, { relevance: -0.05, answerCount: 1 }), __signal: signal(-0.05, 0.5) },
      ],
    });
    const artifact = selectResearchCorpus({ manifest: m, ...prepared });
    const kept = group(artifact, '910002').selectedSourceRefs.map((r) => r.canonicalSourceId);
    assert.deepEqual(kept, ['910002-a-2'], 'relevance ranks the preserved source; answer count is not a truth weight');
  });

  test('mutating answerCount metadata never changes the selection or the corpus identity', () => {
    const m = buildManifest([manifestGroup('910001', { captured: 2 })]);
    const mk = (pop) => {
      const prepared = prepare({
        910001: [
          { ...source('910001', 1, { relevance: 0.2, answerCount: pop }), __signal: signal(0.2, 0.5) },
          { ...source('910001', 2, { relevance: 0.9, answerCount: 1 }), __signal: signal(0.9, 0.5) },
        ],
      });
      return selectResearchCorpus({ manifest: m, ...prepared });
    };
    const a = mk(100000);
    const b = mk(999999999);
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'answer count is not a truth weight');
    assert.equal(a.selectedCorpusIdentity, b.selectedCorpusIdentity);
  });
});

// ---------------------------------------------------------------------------
// MMR optional semantics (Spec §3.2: MMR is optional, default off)
// ---------------------------------------------------------------------------

function mmrScenario() {
  const m = buildManifest([manifestGroup('920001', { captured: 3 })]);
  // a-2 is a near-duplicate of a-1 (pairwise 0.99); a-3 is distinct
  const prepared = prepare({
    920001: sourcesWith('920001', [[1, 0.9, 0.5], [2, 0.88, 0.5], [3, 0.7, 0.5]]),
  });
  const pairwiseIds = ['920001-a-1', '920001-a-2', '920001-a-3'];
  const pairwise = {
    ids: pairwiseIds,
    matrix: [
      [1, 0.99, 0.1],
      [0.99, 1, 0.1],
      [0.1, 0.1, 1],
    ],
  };
  return { m, prepared, pairwise };
}

describe('P1-T12 MMR-optional semantics', () => {
  test('default: MMR is OFF — near-duplicates are kept, no nearDuplicate category', () => {
    const { m, prepared } = mmrScenario();
    const artifact = selectResearchCorpus({ manifest: m, ...prepared });
    const g = group(artifact, '920001');
    assert.equal(g.selectedSourceRefs.length, 3, 'redundancy control off by default');
    assert.ok(!(EXCLUSION_NEAR_DUPLICATE in g.accounting.exclusionReasonCategories));
  });

  test('enabled: near-duplicate is excluded with a recorded reason', () => {
    const { m, prepared, pairwise } = mmrScenario();
    const artifact = selectResearchCorpus({
      manifest: m, ...prepared, densePairwise: pairwise, options: { mmr: { enabled: true } },
    });
    const g = group(artifact, '920001');
    assert.equal(g.selectedSourceRefs.length, 2);
    assert.equal(g.accounting.exclusionReasonCategories[EXCLUSION_NEAR_DUPLICATE], 1);
    const kept = g.selectedSourceRefs.map((r) => r.canonicalSourceId);
    assert.deepEqual(kept, ['920001-a-1', '920001-a-3'], 'the higher-ranked duplicate is kept');
  });

  test('enabled: behavior stays deterministic and identity-stable (byte-identical, input-order independent)', () => {
    const { m, prepared, pairwise } = mmrScenario();
    const run = (opts) => JSON.stringify(selectResearchCorpus({
      manifest: m, ...prepared, densePairwise: pairwise, options: opts,
    }));
    const opts = { mmr: { enabled: true } };
    assert.equal(run(opts), run(opts), 'same input → byte-identical output');
    assert.equal(
      run(opts),
      run({ mmr: { enabled: true, lambda: DEFAULT_MMR_LAMBDA, nearDuplicateSimilarity: DEFAULT_NEAR_DUPLICATE_SIMILARITY } }),
      'explicit defaults equal implicit defaults',
    );

    // input-order independence: shuffle source array + signal key insertion order
    const shuffled = {
      sourcesByGroup: {
        '920001': [...prepared.sourcesByGroup['920001']].reverse(),
      },
      denseSignals: Object.fromEntries(Object.entries(prepared.denseSignals).reverse()),
    };
    const artifactA = selectResearchCorpus({ manifest: m, ...prepared, densePairwise: pairwise, options: opts });
    const artifactB = selectResearchCorpus({ manifest: m, ...shuffled, densePairwise: pairwise, options: opts });
    assert.equal(artifactA.selectedCorpusIdentity, artifactB.selectedCorpusIdentity);
  });

  test('enabled: MMR requires pairwise geometry — no silent degraded mode', () => {
    const { m, prepared } = mmrScenario();
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest: m, ...prepared, options: { mmr: { enabled: true } } }),
      'RCE_MMR_PAIRWISE_MISSING',
    );
  });

  test('DEFAULT_NOVELTY_WEIGHT is pinned through ranking behavior (MMR lambda / nearDuplicate defaults already pinned by the explicit-defaults identity test above)', () => {
    // Both sources sit below the relevance floor, so anti-starvation preserves
    // rank-1 — and rank-1 depends on the novelty weight. With w = 0.25:
    // a-1 scores -0.3 + 0.25*0.9 = -0.075 > a-2 (-0.25) → a-1 preserved.
    // With w = 0 the ordering flips and a-2 is preserved instead.
    const m = buildManifest([manifestGroup('930002', { captured: 2 })]);
    const prepared = prepare({
      930002: sourcesWith('930002', [[1, -0.3, 0.9], [2, -0.25, 0]]),
    });
    const run = (opts) => selectResearchCorpus({ manifest: m, ...prepared, options: opts });
    // explicit DEFAULT_NOVELTY_WEIGHT is indistinguishable from the default
    assert.equal(JSON.stringify(run({})), JSON.stringify(run({ noveltyWeight: DEFAULT_NOVELTY_WEIGHT })));
    const preserved = (opts) => group(run(opts), '930002').selectedSourceRefs[0].canonicalSourceId;
    assert.equal(preserved({}), '930002-a-1', 'default weight ranks the novelty-rich source first');
    assert.equal(preserved({ noveltyWeight: 0 }), '930002-a-2', 'weight 0 flips the preservation ranking — the default is a real, load-bearing tunable');
  });
});

// ---------------------------------------------------------------------------
// identity determinism (§SEAM B IDENTITY_FIELDS)
// ---------------------------------------------------------------------------

describe('P1-T12 identity determinism', () => {
  test('same input → byte-identical artifact and selectedCorpusIdentity', () => {
    const { manifest, sourcesByGroup, denseSignals } = baseScenario();
    const a = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });
    const b = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });
    assert.equal(a.selectedCorpusIdentity, b.selectedCorpusIdentity);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.match(a.selectedCorpusIdentity, /^sha256:[0-9a-f]{64}$/);
  });

  test('input array/key order does not affect identity (set identity, not order identity)', () => {
    const { manifest, sourcesByGroup, denseSignals } = baseScenario();
    const shuffled = {
      sourcesByGroup: Object.fromEntries(
        [...Object.entries(sourcesByGroup)].reverse().map(([k, v]) => [k, [...v].reverse()]),
      ),
      denseSignals: Object.fromEntries([...Object.entries(denseSignals)].reverse()),
    };
    const a = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });
    const b = selectResearchCorpus({ manifest, ...shuffled });
    assert.equal(a.selectedCorpusIdentity, b.selectedCorpusIdentity);
  });

  test('selection changes → identity changes (identity is a function of the selected set)', () => {
    const { manifest, sourcesByGroup, denseSignals } = baseScenario();
    const a = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });
    const narrower = prepare({
      900001: sourcesWith('900001', [[1, 0.9, 0.6]]),
      900002: sourcesWith('900002', [[1, -0.5, 0.5]]),
      900003: sourcesWith('900003', [[1, 0.6, 0.5], [2, 0.5, 0.5], [3, 0.4, 0.5]]),
    });
    const b = selectResearchCorpus({ manifest, ...narrower });
    assert.notEqual(a.selectedCorpusIdentity, b.selectedCorpusIdentity);
  });
});

// ---------------------------------------------------------------------------
// mode identity (§1.1 / §SEAM B invariant 3 + analyzed single-writer = T13)
// ---------------------------------------------------------------------------

describe('P1-T12 mode identity', () => {
  const { manifest, sourcesByGroup, denseSignals } = baseScenario();
  const artifact = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });

  test('selector accepts its own mode identity literal and rejects a near-miss foreign mode (mode identity pinned through behavior)', () => {
    // The exact exported literal is accepted and a one-character near-miss is
    // rejected — this pins RCE_SELECTOR_MODE's VALUE through observable
    // behavior instead of asserting the constant against itself.
    assert.doesNotThrow(() => selectResearchCorpus({
      manifest, sourcesByGroup, denseSignals, options: { mode: 'rce-corpus-selection' },
    }));
    assertHasErrorCode(
      () => selectResearchCorpus({
        manifest, sourcesByGroup, denseSignals, options: { mode: 'rce-corpus-selector' },
      }),
      'SEAM_B_MODE_IDENTITY_CONFLICT',
    );
  });

  test('output contains NO analyzed field anywhere (single writer = P1-T13)', () => {
    assert.deepEqual(walkForForbiddenKeys(artifact, ['analyzed']), []);
  });

  test('output never masquerades as top-percent-analysis or sampled mode', () => {
    const forbidden = ['mode', 'analysisMode', 'topPercent', 'percent', 'samplingMode'];
    for (const key of forbidden) {
      assert.deepEqual(walkForForbiddenKeys(artifact, [key]), []);
    }
  });

  test('requesting a top-percent-analysis / sampled masquerade fails closed', () => {
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest, sourcesByGroup, denseSignals, options: { mode: 'top-percent-analysis' } }),
      'SEAM_B_MODE_IDENTITY_CONFLICT',
    );
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest, sourcesByGroup, denseSignals, options: { mode: 'sampled' } }),
      'SEAM_B_MODE_IDENTITY_CONFLICT',
    );
    // the selector's own mode identity is accepted
    assert.doesNotThrow(() => selectResearchCorpus({
      manifest, sourcesByGroup, denseSignals, options: { mode: RCE_SELECTOR_MODE },
    }));
  });
});

// ---------------------------------------------------------------------------
// fail-closed semantics (§SEAM B FAIL_CLOSED + verified-only)
// ---------------------------------------------------------------------------

describe('P1-T12 fail-closed semantics', () => {
  const { manifest, sourcesByGroup, denseSignals } = baseScenario();
  const artifact = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });

  test('self-audit accepts its own contract-correct output', () => {
    assert.doesNotThrow(() => verifySelectedResearchCorpus(artifact));
  });

  test('SEAM_B_MISSING_EXCLUSION_REASON: an excluded eligible source without a reason fails closed', () => {
    const mutated = JSON.parse(JSON.stringify(artifact));
    const g = mutated.corpus.groups.find((x) => x.groupId === '900001');
    g.accounting.exclusionReasonCategories = {}; // drop the belowRelevanceFloor record
    assertHasErrorCode(() => verifySelectedResearchCorpus(mutated), 'SEAM_B_MISSING_EXCLUSION_REASON');
  });

  test('SEAM_B_ANALYZED_FIELD_FORBIDDEN: any analyzed field fails closed', () => {
    const mutated = JSON.parse(JSON.stringify(artifact));
    mutated.corpus.groups[0].accounting.analyzed = 2;
    assertHasErrorCode(() => verifySelectedResearchCorpus(mutated), 'SEAM_B_ANALYZED_FIELD_FORBIDDEN');
    const topLevel = JSON.parse(JSON.stringify(artifact));
    topLevel.analyzed = 5;
    assertHasErrorCode(() => verifySelectedResearchCorpus(topLevel), 'SEAM_B_ANALYZED_FIELD_FORBIDDEN');
  });

  test('SEAM_B_UNVERIFIED_SOURCE_REF: a source ref without verified provenance fails closed', () => {
    const mutated = JSON.parse(JSON.stringify(artifact));
    mutated.corpus.groups[0].selectedSourceRefs[0].contentHash = 'not-a-hash';
    assertHasErrorCode(() => verifySelectedResearchCorpus(mutated), 'SEAM_B_UNVERIFIED_SOURCE_REF');
    const noRef = JSON.parse(JSON.stringify(artifact));
    delete noRef.corpus.groups[0].selectedSourceRefs[0].verifiedArtifactRef;
    assertHasErrorCode(() => verifySelectedResearchCorpus(noRef), 'SEAM_B_UNVERIFIED_SOURCE_REF');
  });

  test('SEAM_B_MODE_IDENTITY_CONFLICT: a masquerading mode label fails closed', () => {
    const mutated = JSON.parse(JSON.stringify(artifact));
    mutated.mode = 'top-percent-analysis';
    assertHasErrorCode(() => verifySelectedResearchCorpus(mutated), 'SEAM_B_MODE_IDENTITY_CONFLICT');
    const sampled = JSON.parse(JSON.stringify(artifact));
    sampled.analysisMode = 'sampled';
    assertHasErrorCode(() => verifySelectedResearchCorpus(sampled), 'SEAM_B_MODE_IDENTITY_CONFLICT');
  });

  test('verified-only: source under a group outside the SEAM A manifest fails closed', () => {
    const smuggled = {
      ...sourcesByGroup,
      '999999': [{ canonicalSourceId: '999999-a-1', contentHash: `sha256:${hex64('x')}` }],
    };
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest, sourcesByGroup: smuggled, denseSignals }),
      'SEAM_B_UNVERIFIED_SOURCE_REF',
    );
  });

  test('verified-only: malformed contentHash / canonicalSourceId fails closed', () => {
    const badHash = {
      ...sourcesByGroup,
      900001: [{ canonicalSourceId: '900001-a-1', contentHash: 'deadbeef' }],
    };
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest, sourcesByGroup: badHash, denseSignals }),
      'SEAM_B_UNVERIFIED_SOURCE_REF',
    );
  });

  test('every selected ref traces to the SEAM A verified artifact of its group', () => {
    for (const g of artifact.corpus.groups) {
      const mGroup = manifest.groups.find((m) => m.groupId === g.groupId);
      for (const ref of g.selectedSourceRefs) {
        assert.equal(ref.verifiedArtifactRef, mGroup.answersRel);
        assert.match(ref.contentHash, /^sha256:[0-9a-f]{64}$/);
        assert.ok(ref.canonicalSourceId.length > 0);
      }
    }
  });

  test('fail closed when an eligible source has no dense signal (no popularity-only fallback)', () => {
    const missing = { ...denseSignals };
    delete missing['900001-a-1'];
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest, sourcesByGroup, denseSignals: missing }),
      'RCE_DENSE_SIGNAL_MISSING',
    );
  });

  test('fail closed when a verified manifest group has zero eligible sources (unrepresentable)', () => {
    const prepared = prepare({
      900001: sourcesWith('900001', [[1, 0.9, 0.5]]),
      900002: [], // verified group with no decomposable source
      900003: sourcesWith('900003', [[1, 0.6, 0.5]]),
    });
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest, ...prepared }),
      'RCE_PRESERVATION_UNREPRESENTABLE',
    );
  });

  test('fail closed on malformed SEAM A manifest input', () => {
    const badPlan = { ...manifest, planHash: 'not-a-plan-hash' };
    assertHasErrorCode(() => selectResearchCorpus({ manifest: badPlan, sourcesByGroup, denseSignals }), 'RCE_MANIFEST_INVALID');
    const badType = { ...manifest, type: 'something-else' };
    assertHasErrorCode(() => selectResearchCorpus({ manifest: badType, sourcesByGroup, denseSignals }), 'RCE_MANIFEST_INVALID');
    const empty = { ...manifest, groups: [] };
    assertHasErrorCode(() => selectResearchCorpus({ manifest: empty, sourcesByGroup, denseSignals }), 'RCE_MANIFEST_INVALID');
  });

  test('duplicate canonicalSourceId within a group fails closed', () => {
    const dup = {
      ...sourcesByGroup,
      900001: [
        { canonicalSourceId: '900001-a-1', contentHash: `sha256:${hex64('d1')}` },
        { canonicalSourceId: '900001-a-1', contentHash: `sha256:${hex64('d2')}` },
      ],
    };
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest, sourcesByGroup: dup, denseSignals }),
      'RCE_INPUT_INVALID',
    );
  });

  test('RCE_DUPLICATE_CANONICAL_SOURCE_ID: the same canonicalSourceId under two different groups fails closed', () => {
    // denseSignals are keyed GLOBALLY by canonicalSourceId — a cross-group
    // duplicate would silently share one dense signal (reviewer round 1 F1).
    const shared = '900001-a-1';
    const crossGroup = {
      sourcesByGroup: {
        900001: [{ canonicalSourceId: shared, contentHash: `sha256:${hex64('c1')}` }],
        900002: [{ canonicalSourceId: shared, contentHash: `sha256:${hex64('c2')}` }],
        900003: sourcesWith('900003', [[1, 0.6, 0.5]]),
      },
      denseSignals: { ...denseSignals, [shared]: signal(0.9, 0.5) },
    };
    assertHasErrorCode(
      () => selectResearchCorpus({ manifest, ...crossGroup }),
      'RCE_DUPLICATE_CANONICAL_SOURCE_ID',
    );
  });
});

// ---------------------------------------------------------------------------
// output shape / passthrough
// ---------------------------------------------------------------------------

describe('P1-T12 SEAM B output shape', () => {
  const { manifest, sourcesByGroup, denseSignals } = baseScenario();
  const artifact = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });

  test('envelope: seam / seamVersion / planHash passthrough / identity encoding', () => {
    assert.equal(artifact.seam, 'T12_TO_T13');
    assert.equal(artifact.seamVersion, 1);
    assert.equal(artifact.planHash, manifest.planHash);
    assert.match(artifact.selectedCorpusIdentity, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(artifact).sort(), [
      'corpus', 'planHash', 'seam', 'seamVersion', 'selectedCorpusIdentity',
    ]);
  });

  test('groupId uses the T08 authority format from SEAM A (no invented prefix)', () => {
    for (const g of artifact.corpus.groups) {
      const mGroup = manifest.groups.find((m) => m.groupId === g.groupId);
      assert.ok(mGroup, `groupId ${g.groupId} must come from the SEAM A manifest`);
      assert.equal(g.groupId, mGroup.questionId, 'same identity family as SEAM A');
    }
  });

  test('totals are the mechanical cross-checked sum of per-group accounting', () => {
    const t = artifact.corpus.totals;
    let eligible = 0; let selected = 0; let verified = 0;
    const cats = {};
    for (const g of artifact.corpus.groups) {
      eligible += g.accounting.eligible;
      selected += g.accounting.selected;
      verified += g.accounting.verified;
      for (const [k, n] of Object.entries(g.accounting.exclusionReasonCategories)) {
        cats[k] = (cats[k] || 0) + n;
      }
    }
    assert.deepEqual(t, { eligible, selected, verified, exclusionReasonCategories: cats });
  });
});
