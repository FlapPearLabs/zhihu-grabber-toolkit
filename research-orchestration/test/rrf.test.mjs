/**
 * research-orchestration/test/rrf.test.mjs
 *
 * P1-T06 focused tests — deterministic RRF candidate fusion
 * (Spec §5.4; Issue #38; single pass, fixtures).
 *
 * Coverage contract (Issue #38 REQUIRED_TESTS + executor TEST EXPECTATIONS):
 *   - one ranking / one channel contribution;
 *   - same candidate appearing in multiple rankings (multi-channel fusion);
 *   - deterministic RRF accumulation (input order permutation → bitwise-identical
 *     scores and identical pool ordering);
 *   - deterministic tie resolution (score desc, questionId asc);
 *   - channel identity (query + provider + capability) preserved per rank:
 *     every fused rank references the exact contributing channel;
 *   - rank/ordering counterexamples: permuted channel order and permuted item
 *     order within a ranking produce identical fusion output;
 *   - a ranking item without a valid 1-based provenance.rank is rejected with a
 *     hard fail-closed error (malformed input, nothing half-fused);
 *   - within-channel duplicate candidate → explicitly rejected with a
 *     machine-readable failure identity (never silently re-ranked);
 *   - items carrying a per-item provider failure are rejected (not fused) with
 *     their failure identity preserved and channel provenance recorded;
 *   - an explicit per-item failure that is present-but-malformed (not a
 *     { code, class } identity) fails closed (FAILURE_IDENTITY_INVALID) — it is
 *     never treated as "no failure" and never fused (P1-3).
 *
 * This module is PURE (no IO, no seam): every input is an explicit ranking
 * list; orchestration lives in retrieval.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RRF_K,
  RRF_RANK_SOURCE,
  RRF_TIE_BREAK,
  FUSION_ERROR_CHANNEL_IDENTITY_INVALID,
  FUSION_ERROR_ITEM_IDENTITY_INVALID,
  FUSION_ERROR_RANK_INVALID,
  FUSION_ERROR_FAILURE_IDENTITY_INVALID,
  FUSION_REJECT_DUPLICATE_IN_CHANNEL,
  rrfFusion,
} from '../lib/rrf.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function channel(query, providerId, capability = 'search') {
  return { query, providerId, capability };
}

/**
 * Build a ranking in the exact provider-result item shape consumed by fusion:
 * items carry identity.questionId + provenance.rank (+ optional rankOrigin).
 * extra.kind overrides the default item identity kind ('candidate'); when kind
 * is ABSENT the identity is constructed WITHOUT a kind field at all (P2-1), so
 * "missing-kind" cases genuinely test a kind-less upstream identity.
 */
function ranking(query, providerId, entries, { capability = 'search' } = {}) {
  return {
    channel: channel(query, providerId, capability),
    items: entries.map(([questionId, rank, extra = {}]) => ({
      identity: extra.kind === undefined ? { questionId } : { kind: extra.kind, questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order', ...(extra.provenance ?? {}) },
      source_url: extra.source_url ?? null,
      facts: extra.facts ?? {},
      ...(extra.failure ? { failure: extra.failure } : {}),
    })),
  };
}

function candidateIds(fused) {
  return fused.candidates.map((c) => c.identity.questionId);
}

function scoreFor(fused, questionId) {
  const hit = fused.candidates.find((c) => c.identity.questionId === questionId);
  return hit ? hit.rrfScore : null;
}

// ---------------------------------------------------------------------------
// A. baseline single-channel fusion
// ---------------------------------------------------------------------------

test('A1: RRF_K is the documented standard constant 60', () => {
  assert.equal(RRF_K, 60);
  assert.equal(RRF_RANK_SOURCE, 'provenance.rank');
  assert.equal(RRF_TIE_BREAK, 'score-desc-questionId-asc');
});

test('A2: one channel / one query — rank order determines score (1/(k+rank))', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1], ['20', 2], ['30', 3]]),
  ]);
  assert.deepEqual(candidateIds(fused), ['10', '20', '30']);
  const one = 1 / (RRF_K + 1);
  const two = 1 / (RRF_K + 2);
  const three = 1 / (RRF_K + 3);
  for (const [questionId, expected] of [['10', one], ['20', two], ['30', three]]) {
    const s = scoreFor(fused, questionId);
    assert.ok(Math.abs(s - expected) < 1e-15, `score for ${questionId}: ${s} ~= ${expected}`);
  }
  assert.ok(scoreFor(fused, '10') > scoreFor(fused, '20'));
  assert.ok(scoreFor(fused, '20') > scoreFor(fused, '30'));
  assert.deepEqual(fused.rejected, []);
});

test('A3: empty input yields an empty fused pool (no candidates, no error)', () => {
  assert.deepEqual(rrfFusion([ranking('q1', 'fixture-a', [])]), { candidates: [], rejected: [] });
  assert.deepEqual(rrfFusion([]), { candidates: [], rejected: [] });
});

test('A4: candidate sourceUrl/facts come from the first contributing channel in channel-list order (deterministic)', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1, {
      source_url: { url: 'https://www.zhihu.com/question/10', securityClass: 'external_unverified' },
      facts: { title: 'first' },
    }]]),
    ranking('q2', 'fixture-b', [['10', 2, { facts: { title: 'second' } }]]),
  ]);
  const candidate = fused.candidates[0];
  assert.equal(candidate.facts.title, 'first', 'facts from first contributing channel');
  assert.equal(candidate.source_url.url, 'https://www.zhihu.com/question/10');
});

// ---------------------------------------------------------------------------
// B. multi-channel fusion
// ---------------------------------------------------------------------------

test('B1: same candidate appearing in multiple rankings accumulates 1/(k+rank) contributions from each channel', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1], ['20', 2]]),
    ranking('q2', 'fixture-a', [['10', 2], ['30', 1]]),
  ]);
  const expected10 = 1 / (RRF_K + 1) + 1 / (RRF_K + 2);
  const expected20 = 1 / (RRF_K + 2);
  const expected30 = 1 / (RRF_K + 1);
  assert.ok(Math.abs(scoreFor(fused, '10') - expected10) < 1e-15, 'multi-channel accumulation');
  assert.ok(Math.abs(scoreFor(fused, '20') - expected20) < 1e-15);
  assert.ok(Math.abs(scoreFor(fused, '30') - expected30) < 1e-15);
  // 30 = 1/61; 10 = 1/61 + 1/62 (largest); 20 = 1/62 (smallest)
  assert.deepEqual(candidateIds(fused), ['10', '30', '20']);
});

test('B2: two providers over the same query are distinct channels (channel identity includes provider)', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1], ['20', 2]]),
    ranking('q1', 'fixture-b', [['10', 2], ['20', 1]]),
  ]);
  const expected10 = 1 / (RRF_K + 1) + 1 / (RRF_K + 2);
  const expected20 = 1 / (RRF_K + 1) + 1 / (RRF_K + 2);
  assert.ok(Math.abs(scoreFor(fused, '10') - expected10) < 1e-15);
  assert.ok(Math.abs(scoreFor(fused, '20') - expected20) < 1e-15);
  // tie: both candidates equal score → questionId ascending ('10' < '20')
  assert.deepEqual(candidateIds(fused), ['10', '20']);
});

test('B3: every fused rank preserves the full channel identity (query + provider + capability)', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1, { provenance: { rankOrigin: 'origin-a' } }]]),
    ranking('q2', 'fixture-b', [['10', 3, { provenance: { rankOrigin: 'origin-b' } }]]),
  ]);
  assert.equal(fused.candidates.length, 1);
  const candidate = fused.candidates[0];
  assert.equal(candidate.identity.questionId, '10');
  assert.equal(candidate.ranks.length, 2);
  const [ra, rb] = candidate.ranks;
  assert.deepEqual(ra.channel, { query: 'q1', providerId: 'fixture-a', capability: 'search' });
  assert.equal(ra.rank, 1);
  assert.equal(ra.rankOrigin, 'origin-a');
  assert.deepEqual(rb.channel, { query: 'q2', providerId: 'fixture-b', capability: 'search' });
  assert.equal(rb.rank, 3);
  assert.equal(rb.rankOrigin, 'origin-b');
});

test('B4: retrieval route (provenance.route) is preserved into every fused rank; an absent route stays NULL (distinguishable, never invented) — P1-2', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1, { provenance: { route: 'zhihu-answer-grabber:search', rankOrigin: 'official_order' } }]]),
    ranking('q2', 'fixture-b', [['10', 2, { provenance: { route: null, rankOrigin: 'fixture_order' } }]]),
  ]);
  assert.equal(fused.candidates.length, 1);
  const candidate = fused.candidates[0];
  assert.equal(candidate.ranks.length, 2);
  const [ra, rb] = candidate.ranks;
  assert.equal(ra.route, 'zhihu-answer-grabber:search', 'route captured from provenance.route');
  assert.equal(ra.channel.providerId, 'fixture-a');
  assert.equal(ra.rankOrigin, 'official_order');
  assert.equal(rb.route, null, 'absent upstream route stays NULL — UNKNOWN distinguishable from an established route');
  assert.equal(rb.channel.providerId, 'fixture-b');
});

// ---------------------------------------------------------------------------
// C. determinism
// ---------------------------------------------------------------------------

test('C1: permuted channel input order produces a bitwise-identical fused pool (deterministic accumulation)', () => {
  const rankings = [
    ranking('qa', 'fixture-a', [['10', 1], ['20', 3]]),
    ranking('qb', 'fixture-b', [['10', 2], ['30', 1]]),
    ranking('qc', 'fixture-c', [['10', 4], ['20', 1]]),
    ranking('qa', 'fixture-d', [['30', 2]]),
  ];
  const permutations = [
    rankings,
    [...rankings].reverse(),
    [rankings[3], rankings[0], rankings[2], rankings[1]],
  ];
  const serialized = permutations.map((p) => JSON.stringify(rrfFusion(p)));
  assert.equal(new Set(serialized).size, 1, 'all input permutations serialize identically');
});

test('C2: permuted item order within a single ranking yields the same fused pool (rank comes from provenance.rank, not array order)', () => {
  const base = [
    ['10', 1],
    ['20', 2],
    ['30', 3],
  ];
  const shuffled = [
    ['30', 3],
    ['10', 1],
    ['20', 2],
  ];
  const a = rrfFusion([ranking('q1', 'fixture-a', base)]);
  const b = rrfFusion([ranking('q1', 'fixture-a', shuffled)]);
  assert.deepEqual(a, b);
});

test('C3: repeated fusion calls on the same inputs are deep-equal (fixtures = reproducible evidence)', () => {
  const input = [
    ranking('q1', 'fixture-a', [['10', 1], ['20', 2]]),
    ranking('q2', 'fixture-b', [['20', 1], ['10', 3]]),
  ];
  assert.deepEqual(rrfFusion(input), rrfFusion(input));
});

test('C4: candidate identity.kind is canonical ("candidate") and order-independent under differing/missing upstream kinds — P1-3', () => {
  const orderA = [
    ranking('q1', 'fixture-a', [['10', 1, { kind: 'candidate' }]]),
    ranking('q2', 'fixture-b', [['10', 2, { kind: 'source-group' }]]),
  ];
  const orderB = [
    ranking('q2', 'fixture-b', [['10', 2, { kind: 'source-group' }]]),
    ranking('q1', 'fixture-a', [['10', 1, { kind: 'candidate' }]]),
  ];
  // P2-1: the helper now truly omits kind when absent (no implicit 'candidate').
  const missingKind = [
    ranking('q2', 'fixture-b', [['10', 2, { kind: 'source-group' }]]),
    ranking('q1', 'fixture-a', [['10', 1]]), // kind ABSENT upstream (no default)
  ];
  const fA = rrfFusion(orderA);
  const fB = rrfFusion(orderB);
  const fM = rrfFusion(missingKind);
  assert.deepEqual(fA, fB, 'fusion is permutation-invariant under differing identity kinds');
  for (const f of [fA, fB, fM]) {
    assert.deepEqual(f.candidates[0].identity, { kind: 'candidate', questionId: '10' }, 'canonical T06 candidate kind, not "first encountered", even when upstream kind is missing');
  }
});

// ---------------------------------------------------------------------------
// D. deterministic tie semantics
// ---------------------------------------------------------------------------

test('D1: equal scores tie-break by questionId ascending (deterministic, documented)', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['9', 1], ['10', 1]]),
  ]);
  assert.deepEqual(candidateIds(fused), ['10', '9'], 'lexicographic ascending: "10" < "9"');
});

test('D2: tie rule is stable under channel input order permutation', () => {
  const a = rrfFusion([
    ranking('q1', 'fixture-a', [['9', 1], ['10', 1]]),
    ranking('q2', 'fixture-b', [['9', 2], ['10', 2]]),
  ]);
  const b = rrfFusion([
    ranking('q2', 'fixture-b', [['10', 2], ['9', 2]]),
    ranking('q1', 'fixture-a', [['10', 1], ['9', 1]]),
  ]);
  assert.deepEqual(candidateIds(a), candidateIds(b));
});

// ---------------------------------------------------------------------------
// E. malformed input → fail closed (nothing half-fused)
// ---------------------------------------------------------------------------

test('E1: ranking without a valid 1-based provenance.rank is rejected with RANK_INVALID (fail closed)', () => {
  const badRankings = [
    { provenance: { route: 'r', rank: 0 } },
    { provenance: { route: 'r' } },
    { provenance: { route: 'r', rank: 1.5 } },
    { provenance: { route: 'r', rank: -1 } },
  ];
  for (const provenance of badRankings) {
    assert.throws(() => rrfFusion([{
      channel: channel('q1', 'fixture-a'),
      items: [{ identity: { kind: 'candidate', questionId: '10' }, provenance, source_url: null, facts: {} }],
    }]), (err) => err.code === FUSION_ERROR_RANK_INVALID, `rank input: ${JSON.stringify(provenance)}`);
  }
});

test('E2: malformed channel identity (missing query/providerId/capability) is rejected (fail closed)', () => {
  for (const badChannel of [
    { query: 'q1', providerId: 'fixture-a' },            // capability missing
    { query: 'q1', capability: 'search' },               // providerId missing
    { providerId: 'fixture-a', capability: 'search' },   // query missing
  ]) {
    assert.throws(() => rrfFusion([{ channel: badChannel, items: [] }]),
      (err) => err.code === FUSION_ERROR_CHANNEL_IDENTITY_INVALID, `channel: ${JSON.stringify(badChannel)}`);
  }
});

test('E3: within-channel duplicate candidate → second occurrence explicitly rejected with a machine-readable failure identity; first occurrence still fuses (never silently re-ranked)', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1], ['10', 5]]),
  ]);
  assert.equal(fused.candidates.length, 1);
  assert.equal(fused.candidates[0].identity.questionId, '10');
  assert.equal(fused.candidates[0].ranks.length, 1, 'only the first occurrence contributes its rank');
  assert.equal(fused.candidates[0].ranks[0].rank, 1);
  assert.equal(fused.rejected.length, 1);
  assert.equal(fused.rejected[0].failure.code, FUSION_REJECT_DUPLICATE_IN_CHANNEL);
  assert.deepEqual(fused.rejected[0].channel, channel('q1', 'fixture-a'));
  assert.equal(fused.rejected[0].identity.questionId, '10');
});

test('E4: a rejected input never produces a partial pool — throws propagate as hard errors', () => {
  assert.throws(() => rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1]]),
    { channel: channel('q2', 'fixture-b'), items: [{ identity: { questionId: '20' }, provenance: { route: 'r' }, source_url: null, facts: {} }] },
  ]), (err) => err.code === FUSION_ERROR_RANK_INVALID);
});

test('E6: fusible item without a valid questionId identity → hard fail-closed error (ITEM_IDENTITY_INVALID)', () => {
  assert.throws(() => rrfFusion([{
    channel: channel('q1', 'fixture-a'),
    items: [
      { identity: { kind: 'candidate', questionId: '' }, provenance: { route: 'r', rank: 1 }, source_url: null, facts: {} },
    ],
  }]), (err) => err.code === FUSION_ERROR_ITEM_IDENTITY_INVALID);
  assert.throws(() => rrfFusion([{
    channel: channel('q1', 'fixture-a'),
    items: [
      { identity: null, provenance: { route: 'r', rank: 1 }, source_url: null, facts: {} },
    ],
  }]), (err) => err.code === FUSION_ERROR_ITEM_IDENTITY_INVALID);
});

test('E5: items carrying a per-item provider failure are rejected (not fused) with their failure identity + channel provenance; the rest of the ranking still fuses', () => {
  const fused = rrfFusion([
    {
      channel: channel('q1', 'fixture-a'),
      items: [
        { identity: { kind: 'candidate', questionId: '10' }, provenance: { route: 'fixture', rank: 1 }, source_url: null, facts: {} },
        {
          identity: { kind: 'candidate', questionId: '99' },
          provenance: { route: 'fixture', rank: 2 },
          source_url: null,
          facts: {},
          failure: { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' },
        },
      ],
    },
  ]);
  assert.deepEqual(candidateIds(fused), ['10']);
  assert.equal(fused.candidates[0].rejected?.length ?? 0, 0, 'rejected items surface at pool level, not inside candidates');
  assert.equal(fused.rejected.length, 1);
  assert.equal(fused.rejected[0].failure.code, 'SOURCE_URL_BOUNDARY_REJECTED');
  assert.equal(fused.rejected[0].failure.class, 'boundary');
  assert.deepEqual(fused.rejected[0].channel, channel('q1', 'fixture-a'));
  assert.equal(fused.rejected[0].identity.questionId, '99');
});

test('E7: explicit per-item failure that is present-but-malformed (not a { code, class } identity) → hard fail-closed error (FAILURE_IDENTITY_INVALID); never treated as "no failure", never fused (P1-3)', () => {
  const base = { channel: channel('q1', 'fixture-a') };
  const cases = [
    ['timeout', 'plain string failure'],
    [null, 'explicit null failure'],
    [{ code: 'X' }, 'missing class'],
    [{ class: 'provider' }, 'missing code'],
    [{}, 'empty object'],
  ];
  for (const [failure, label] of cases) {
    const item = {
      identity: { kind: 'candidate', questionId: '10' },
      provenance: { route: 'fixture', rank: 1 },
      source_url: null,
      facts: {},
      failure,
    };
    assert.throws(
      () => rrfFusion([{ ...base, items: [item] }]),
      (err) => err.code === FUSION_ERROR_FAILURE_IDENTITY_INVALID,
      `${label}: present-but-malformed explicit failure must throw FAILURE_IDENTITY_INVALID, never fuse`,
    );
  }
  // control: an ABSENT failure key is not a contract violation — the item fuses.
  const fused = rrfFusion([{
    ...base,
    items: [{ identity: { kind: 'candidate', questionId: '10' }, provenance: { route: 'fixture', rank: 1 }, source_url: null, facts: {} }],
  }]);
  assert.deepEqual(candidateIds(fused), ['10'], 'absent failure is distinguishable from present-but-malformed');
});
