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
 *   - within-channel duplicate candidate → FAIL CLOSED with a hard
 *     machine-readable error (FUSION_DUPLICATE_IN_CHANNEL), order-independent
 *     (item-order-independence contract, P1-4);
 *   - items carrying a per-item provider failure are rejected (not fused) with
 *     their failure identity preserved and channel provenance recorded;
 *   - per-item failure identity is projected through the SAME canonical
 *     projectFailure() as top-level channel records: `rejected` entries carry
 *     `failure: { code, class }` ONLY — raw detail / stderr / path-bearing /
 *     credential-shaped diagnostics are dropped at the boundary (P1-1, review
 *     5076691874);
 *   - rejected observations are canonicalized by stable keys — channel/item
 *     order permutations yield an identical rejected list (P1-5);
 *   - malformed rank values that are NOT JSON-safe (BigInt / cyclic) still throw
 *     RANK_INVALID — the machine-readable code survives safe formatting (P2-2);
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
  FUSION_ERROR_DUPLICATE_IN_CHANNEL,
  rrfFusion,
  // P1-T06 shared persisted-artifact boundary (review 5077286260) — direct
  // unit coverage of the boundary vocabulary that retrieval.mjs also consumes.
  BOUNDARY_MAX_STRING_LENGTH,
  isBoundarySafeKey,
  isBoundarySafeString,
  projectSafeJson,
  projectRouteString,
  projectRejectedRank,
  projectSourceUrlRecord,
  assertArtifactSafe,
  projectFailure,
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

test('C5: rejected observations are canonicalized by stable keys — channel order + item order permutations yield an identical rejected list (P1-5)', () => {
  const build = (rankings) => rrfFusion(rankings).rejected;
  const forward = [
    ranking('qa', 'fixture-a', [
      ['10', 1],
      ['99', 2, { failure: { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' } }],
    ]),
    ranking('qb', 'fixture-b', [
      ['77', 1, { failure: { code: 'CANDIDATE_IDENTITY_INVALID', class: 'contract' } }],
    ]),
  ];
  // reversed channel order AND reversed item order inside the failure-bearing ranking
  const reversed = [
    ranking('qb', 'fixture-b', [
      ['77', 1, { failure: { code: 'CANDIDATE_IDENTITY_INVALID', class: 'contract' } }],
    ]),
    ranking('qa', 'fixture-a', [
      ['99', 2, { failure: { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' } }],
      ['10', 1],
    ]),
  ];
  const a = build(forward);
  const b = build(reversed);
  assert.deepEqual(a, b, 'rejected list is permutation-invariant under channel + item order');
  // canonical stable-key order: (qa, fixture-a, 99) sorts before (qb, fixture-b, 77)
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((r) => r.channel.providerId), ['fixture-a', 'fixture-b']);
  assert.equal(a[0].failure.code, 'SOURCE_URL_BOUNDARY_REJECTED');
  assert.equal(a[1].failure.code, 'CANDIDATE_IDENTITY_INVALID');
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

test('E3: within-channel duplicate candidate → FAIL CLOSED with FUSION_DUPLICATE_IN_CHANNEL regardless of item array order (P1-4)', () => {
  // "keep the first / reject the second" would make scores depend on array order
  // (rank 1 vs rank 5) — a within-channel duplicate is a malformed ranking.
  const permutations = [
    [['10', 1], ['10', 5]],
    [['10', 5], ['10', 1]],
    [['10', 1], ['10', 1]],
  ];
  for (const entries of permutations) {
    assert.throws(
      () => rrfFusion([ranking('q1', 'fixture-a', entries)]),
      (err) => err.code === FUSION_ERROR_DUPLICATE_IN_CHANNEL,
      `duplicate entries ${JSON.stringify(entries)} must throw FUSION_DUPLICATE_IN_CHANNEL, never silently re-rank`,
    );
  }
  // control: the same questionId in DIFFERENT channels is NOT a duplicate.
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1]]),
    ranking('q1', 'fixture-b', [['10', 5]]),
  ]);
  assert.deepEqual(candidateIds(fused), ['10']);
  assert.equal(fused.candidates[0].ranks.length, 2, 'distinct channels contribute independently');
  assert.deepEqual(fused.rejected, []);
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

test('E8: malformed rank values that are NOT JSON-safe (BigInt / cyclic) still throw RANK_INVALID — the machine-readable code survives safe formatting (P2-2)', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const badRanks = [1n, cyclic];
  for (const badRank of badRanks) {
    assert.throws(
      () => rrfFusion([{
        channel: channel('q1', 'fixture-a'),
        items: [{ identity: { kind: 'candidate', questionId: '10' }, provenance: { route: 'fixture', rank: badRank }, source_url: null, facts: {} }],
      }]),
      (err) => err.code === FUSION_ERROR_RANK_INVALID,
      'RANK_INVALID must be thrown even when the offending value cannot be JSON-serialized (JSON.stringify would throw before the code was assigned)',
    );
  }
  // a cyclic malformed channel identity is rendered safely too
  const cyclicChannel = {};
  cyclicChannel.self = cyclicChannel;
  assert.throws(
    () => rrfFusion([{ channel: cyclicChannel, items: [] }]),
    (err) => err.code === FUSION_ERROR_CHANNEL_IDENTITY_INVALID,
    'malformed cyclic channel identity must throw CHANNEL_IDENTITY_INVALID (safe formatting)',
  );
});

test('E9: per-item failure carrying machine-private diagnostics is projected to { code, class } ONLY in `rejected` — raw detail / stderr / credential-shaped / non-JSON-safe payload never survives (P1-1, review 5076691874)', () => {
  const SECRET_PATH = 'C:\\Users\\victim\\secret\\boundary-cache.json';
  const CREDISH = 'z_c0=someSecretCookieValue';
  const cyclicDetail = {};
  cyclicDetail.self = cyclicDetail;
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
          failure: {
            code: 'SOURCE_URL_BOUNDARY_REJECTED',
            class: 'boundary',
            detail: SECRET_PATH,
            stderr: CREDISH,
            provider_error_type: 'http_403',
            nested: cyclicDetail,
            counter: 10n,
          },
        },
      ],
    },
  ]);
  assert.deepEqual(candidateIds(fused), ['10'], 'the failed item is never fused');
  assert.equal(fused.rejected.length, 1);
  assert.deepEqual(
    fused.rejected[0].failure,
    { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' },
    'the same canonical projection as top-level channel records — { code, class } ONLY, even when the upstream failure carried extra diagnostics',
  );
  assert.equal(fused.rejected[0].channel.providerId, 'fixture-a');
  assert.equal(fused.rejected[0].identity.questionId, '99');
  const serialized = JSON.stringify(fused);
  assert.ok(!serialized.includes(SECRET_PATH), 'path-bearing detail must never survive into `rejected` (RULES §11)');
  assert.ok(!serialized.includes(CREDISH), 'credential-shaped diagnostics must never survive into `rejected`');
  assert.ok(!serialized.includes('provider_error_type') && !serialized.includes('http_403'), 'arbitrary payload fields are dropped');
});

// ---------------------------------------------------------------------------
// F. P1-T06 shared persisted-artifact boundary — DIRECT unit coverage
//    (review 5077286260). These helpers are consumed by retrieval.mjs too; the
//    boundary contract is verified here at the vocabulary level so the
//    integration tests in retrieval.test.mjs only need to prove the wiring.
// ---------------------------------------------------------------------------

test('F1: isBoundarySafeKey — bare credential-sensitive KEY NAMES are rejected without any value-assignment shape (P1-2 review 5077286260); case/separator variants included; magic keys rejected; safe keys pass', () => {
  for (const key of ['token', 'cookie', 'z_c0', 'secret', 'password', 'passwd', 'authorization',
    'api_key', 'api-key', 'apikey', 'access_key', 'access-key', 'accesskey', 'session_id', 'credential']) {
    assert.equal(isBoundarySafeKey(key), false, `bare credential key name must be rejected: ${key}`);
  }
  for (const key of ['Token', 'COOKIE', 'Zc0', 'zc0', 'apiKey', 'accessKey', 'sessionId', 'my_token', 'my-token']) {
    assert.equal(isBoundarySafeKey(key), false, `credential key variant must be rejected: ${key}`);
  }
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    assert.equal(isBoundarySafeKey(key), false, `magic / prototype-mutating key must be rejected: ${key}`);
  }
  for (const key of ['questionId', 'title', 'content', 'author', 'tokens', 'tokenCount', 'boundary', 'url', 'securityClass']) {
    assert.equal(isBoundarySafeKey(key), true, `non-credential key must pass: ${key}`);
  }
});

test('F2: isBoundarySafeString — credential assignment shapes / machine-private paths / over-length strings are rejected; safe strings pass (P1-1 / RULES §11)', () => {
  for (const s of ['z_c0=abc123', 'token=super-secret', 'cookie: abc', 'Authorization: Bearer x', 'api_key = x']) {
    assert.equal(isBoundarySafeString(s), false, `credential-shaped string must be rejected: ${s}`);
  }
  for (const s of ['/home/private-user/token.txt', '/Users/victim/secret/cache.json', 'C:\\Users\\victim\\secret\\x.json', '~/.ssh/id_rsa']) {
    assert.equal(isBoundarySafeString(s), false, `machine-private path must be rejected: ${s}`);
  }
  assert.equal(isBoundarySafeString('a'.repeat(BOUNDARY_MAX_STRING_LENGTH + 1)), false, 'over-length string must be rejected');
  assert.equal(isBoundarySafeString('a'.repeat(BOUNDARY_MAX_STRING_LENGTH)), true, 'bounded-length string must pass');
  for (const s of ['fixture', 'https://example.invalid/a?b=1', 'zhihu.com/answer/123', 'ordinary text']) {
    assert.equal(isBoundarySafeString(s), true, `safe string must pass: ${s}`);
  }
});

test('F3: projectSafeJson — safe JSON-domain data is preserved EXACTLY as a deterministic deep copy; unsafe values fail closed (P2-2 review 5077286260)', () => {
  const safe = { a: [1, 'x', true, null, 1.5], b: { nested: { ok: 'https://example.invalid/' } } };
  const verdict = projectSafeJson(safe);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.value, safe, 'safe input is preserved exactly');
  assert.notEqual(verdict.value, safe, 'a deep copy, not the same reference');

  const cyclic = {};
  cyclic.self = cyclic;
  const cases = [
    ['BigInt', { n: 10n }],
    ['cyclic', cyclic],
    ['undefined value', { u: undefined }],
    ['function value', { f: () => {} }],
    ['symbol value', { s: Symbol('x') }],
    ['non-plain object (Date)', { d: new Date() }],
    ['non-plain object (class instance)', { c: new (class Foo {})() }],
    ['magic own key', JSON.parse('{"__proto__": 1}')],
    ['constructor key', JSON.parse('{"constructor": {"prototype": 1}}')],
    ['credential key', { token: 'x' }],
    ['credential-shaped string value', { v: 'token=abc' }],
    ['private-path string value', { v: '/home/user/x' }],
    ['over-length string value', { v: 'a'.repeat(501) }],
    ['non-finite number', { n: Infinity }],
    ['over-default-depth', { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 1 } } } } } } } } } }],
  ];
  for (const [label, value] of cases) {
    assert.equal(projectSafeJson(value).ok, false, `${label}: must fail closed`);
  }

  assert.equal(projectSafeJson({ a: { b: { c: 1 } } }, { maxDepth: 2 }).ok, false, 'over-depth with explicit maxDepth must fail closed');
  assert.equal(projectSafeJson({ a: { b: { c: 1 } } }, { maxDepth: 3 }).ok, true, 'within explicit maxDepth must pass');
});

test('F4: projectRouteString / projectRejectedRank — absent values stay null; safe values preserved; unsafe values fail closed', () => {
  assert.deepEqual(projectRouteString(null), { ok: true, value: null });
  assert.deepEqual(projectRouteString(undefined), { ok: true, value: null });
  assert.deepEqual(projectRouteString('fixture_order'), { ok: true, value: 'fixture_order' });
  assert.equal(projectRouteString('/Users/victim/x').ok, false, 'private-path route must fail closed');
  assert.equal(projectRouteString('token=abc').ok, false, 'credential-shaped route must fail closed');
  assert.equal(projectRouteString(5).ok, false, 'non-string route must fail closed');

  assert.deepEqual(projectRejectedRank(null), { ok: true, value: null });
  assert.deepEqual(projectRejectedRank(undefined), { ok: true, value: null });
  assert.deepEqual(projectRejectedRank(3), { ok: true, value: 3 });
  assert.equal(projectRejectedRank(Infinity).ok, false, 'non-finite rank must fail closed');
  assert.equal(projectRejectedRank(NaN).ok, false, 'NaN rank must fail closed');
  assert.equal(projectRejectedRank('3').ok, false, 'non-number rank must fail closed');
  assert.equal(projectRejectedRank(10n).ok, false, 'BigInt rank must fail closed');
});

test('F5: projectSourceUrlRecord — https + no credential userinfo/query + no machine-private path pass; unsafe URLs FAIL CLOSED and are never rewritten (P1-4 review 5077286260)', () => {
  const safe = { url: 'https://example.invalid/a?b=1', securityClass: 'official-secret' };
  assert.deepEqual(projectSourceUrlRecord(safe), { ok: true, value: { url: safe.url, securityClass: safe.securityClass } });
  assert.deepEqual(
    projectSourceUrlRecord({ url: 'https://example.invalid/', securityClass: 'official-secret', note: 'dropped' }),
    { ok: true, value: { url: 'https://example.invalid/', securityClass: 'official-secret' } },
    'non-contract metadata fields are dropped; the record is canonicalized to { url, securityClass }',
  );
  assert.deepEqual(projectSourceUrlRecord(null), { ok: true, value: null });
  assert.deepEqual(projectSourceUrlRecord(undefined), { ok: true, value: null });

  const unsafe = [
    ['credential query key', { url: 'https://example.invalid/?token=super-secret', securityClass: 'official-secret' }],
    ['credential query key variant', { url: 'https://example.invalid/?api_key=abc', securityClass: 'official-secret' }],
    ['userinfo credentials', { url: 'https://user:pass@example.invalid/', securityClass: 'official-secret' }],
    ['non-https', { url: 'http://example.invalid/', securityClass: 'official-secret' }],
    ['machine-private path in URL', { url: 'https://example.invalid/home/private-user/x', securityClass: 'official-secret' }],
    ['missing securityClass', { url: 'https://example.invalid/' }],
    ['non-string url', { url: 5, securityClass: 'official-secret' }],
    ['non-plain record', new Date()],
  ];
  for (const [label, record] of unsafe) {
    assert.equal(projectSourceUrlRecord(record).ok, false, `${label}: must fail closed`);
  }
});

test('F6: assertArtifactSafe — the whole-artifact walk accepts safe canonical artifacts and rejects unsafe keys/strings/cycles/non-plain/BigInt with stable reasons (P1-1 defense-in-depth)', () => {
  const safeArtifact = {
    schemaVersion: 1,
    type: 'retrieval-pool',
    channels: [{ ok: true, channel: { query: 'q', providerId: 'p', capability: 'search' }, failure: null }],
    candidates: [{ key: 'q::p::100', rank: 1, facts: { count: 2 } }],
    rejected: [],
    criteria: { fusion: 'rrf', rrfK: 60 },
  };
  assert.deepEqual(assertArtifactSafe(safeArtifact), { ok: true });

  const cyclic = {};
  cyclic.self = cyclic;
  const cases = [
    ['credential key', { token: 'x' }, 'unsafe_key'],
    ['magic own key', JSON.parse('{"__proto__": 1}'), 'unsafe_key'],
    ['credential-shaped string', { v: 'z_c0=abc' }, 'unsafe_string'],
    ['private-path string', { v: '/Users/victim/x' }, 'unsafe_string'],
    ['over-length string', { v: 'a'.repeat(501) }, 'unsafe_string'],
    ['cyclic', cyclic, 'cyclic'],
    ['BigInt', { n: 10n }, 'unsupported_type_bigint'],
    ['non-plain object', { d: new Date() }, 'non_plain_object'],
    ['non-finite number', { n: Infinity }, 'non_finite_number'],
  ];
  for (const [label, value, reason] of cases) {
    const verdict = assertArtifactSafe(value);
    assert.equal(verdict.ok, false, `${label}: must fail closed`);
    assert.equal(verdict.reason, reason, `${label}: stable machine-readable reason`);
  }
});

test('F7: projectFailure — code/class must be bounded privacy-safe strings; path/credential-shaped or over-length identities are rejected (P1-1)', () => {
  assert.deepEqual(
    projectFailure({ code: 'OK', class: 'boundary' }),
    { ok: true, failure: { code: 'OK', class: 'boundary' } },
  );
  for (const failure of [
    { code: '/home/private-user/x', class: 'boundary' },
    { code: 'token=abc', class: 'boundary' },
    { code: 'OK', class: 'z_c0=secret' },
    { code: 'a'.repeat(501), class: 'boundary' },
    { code: 5, class: 'boundary' },
    { code: 'OK' },
  ]) {
    assert.equal(projectFailure(failure).ok, false, 'unsafe failure identity must be rejected');
  }
});
