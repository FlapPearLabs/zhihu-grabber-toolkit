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
  FUSION_ERROR_UNSAFE_PROVIDER_DATA,
  // Round-6 final convergence repair (BLOCK3 / BLOCK4): duplicate-channel
  // identity error code + the FUSION_* allowlist the retrieval layer proxies.
  FUSION_ERROR_DUPLICATE_CHANNEL,
  FUSION_CONTRACT_ERROR_CODES,
  rrfFusion,
  // P1-T06 shared persisted-artifact boundary (review 5077286260) — direct
  // unit coverage of the boundary vocabulary that retrieval.mjs also consumes.
  BOUNDARY_MAX_STRING_LENGTH,
  URL_DECODE_MAX_LAYERS,
  isBoundarySafeKey,
  isBoundarySafeString,
  isBoundarySafeUrlString,
  projectSafeJson,
  projectRouteString,
  projectRejectedRank,
  projectSourceUrlRecord,
  assertArtifactSafe,
  projectFailure,
  projectAllowedErrorCode,
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

test('A4: candidate sourceUrl/facts come from the contributing channels (deterministic) — facts from the canonical-first channel; source_url is the FIRST NON-NULL validated source across contributions (Codex 4th-round P2 on 0e3e2bea: a null first source_url must not erase a later valid source reference)', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1, {
      source_url: { url: 'https://www.zhihu.com/question/10', securityClass: 'external_unverified' },
      facts: { title: 'first' },
    }]]),
    ranking('q2', 'fixture-b', [['10', 2, { facts: { title: 'second' } }]]),
  ]);
  const candidate = fused.candidates[0];
  assert.equal(candidate.facts.title, 'first', 'facts from first contributing channel');
  assert.equal(candidate.source_url.url, 'https://www.zhihu.com/question/10', 'first non-null source_url retained');
});

test('A5: canonical-first contribution has source_url NULL but a LATER channel supplies a valid source — the non-null validated URL is retained (Codex 4th-round P2 on 0e3e2bea)', () => {
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1]]),
    ranking('q2', 'fixture-b', [['10', 2, {
      source_url: { url: 'https://www.zhihu.com/question/10', securityClass: 'external_unverified' },
    }]]),
  ]);
  const candidate = fused.candidates[0];
  assert.equal(candidate.source_url.url, 'https://www.zhihu.com/question/10', 'later non-null source_url is not erased by channel-key order');
});

test('A6: rrfFusion REJECTS a non-retrieval-ranked channel (capture) — a direct caller cannot fuse non-retrieval observations into RRF scores (Codex 4th-round P2 on 0e3e2bea; §5.4 retrieval-ranked channels only)', () => {
  assert.throws(() => rrfFusion([{
    channel: channel('q1', 'fixture-a', 'capture'),
    items: [{ identity: { kind: 'candidate', questionId: '10' }, provenance: { route: 'r', rank: 1 }, source_url: null, facts: {} }],
  }]), (err) => err.code === FUSION_ERROR_CHANNEL_IDENTITY_INVALID, 'capture channel must fail closed at the RRF boundary');
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
  // Codex 3rd-round P2 on f742cb3: the fusion key must be a CANONICAL Zhihu
  // decimal question ID — a malformed ("abc") or non-canonical ("00123" vs
  // "123", which would split one question into two Map keys) identity fails
  // closed instead of producing separate unverifiable candidates.
  for (const badId of ['abc', '00123', '12 3', '1.5', '0', '-1']) {
    assert.throws(() => rrfFusion([{
      channel: channel('q1', 'fixture-a'),
      items: [
        { identity: { kind: 'candidate', questionId: badId }, provenance: { route: 'r', rank: 1 }, source_url: null, facts: {} },
      ],
    }]), (err) => err.code === FUSION_ERROR_ITEM_IDENTITY_INVALID, `non-canonical questionId ${JSON.stringify(badId)} must fail closed`);
  }
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
  // Review 5078267886 (P1): compound / camelCase credential keys must be
  // rejected too — normalization to [a-z0-9] covers snake/kebab/camel spellings.
  for (const key of ['accessToken', 'access_token', 'access-token', 'refreshToken', 'refresh_token',
    'clientSecret', 'client_secret', 'clientId', 'client_id', 'sessionCookie', 'session_cookie',
    'sessionToken', 'session_token', 'authToken', 'auth_token', 'idToken', 'id_token', 'apiToken',
    'api_token', 'secretKey', 'secret_key', 'privateKey', 'private_key', 'bearerToken', 'bearer_token',
    'oauthToken', 'oauth_token', 'csrfToken', 'csrf_token', 'xsrfToken', 'xsrf_token', 'accessKeyId',
    'access_key_id', 'secretAccessKey', 'secret_access_key', 'jwt', 'jwtToken', 'jwt_token']) {
    assert.equal(isBoundarySafeKey(key), false, `compound credential key must be rejected: ${key}`);
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
  // P1-1 (review 5080578795): root ENUMERATION is replaced by a GENERIC
  // filesystem-shaped absolute POSIX path rule (2+ path components,
  // token-boundary anchored, URL-shaped values exempt) — the deny set can no
  // longer be exhausted, so novel roots (/custom, /builds, ...) fail closed
  // like the previously enumerated ones, and even a 2-component system path
  // (/etc/hosts) fails the broader provider-content lens (the plan boundary's
  // R11 carve-out accepts it; see plan-contract.test.mjs).
  for (const s of ['/home/private-user/token.txt', '/Users/victim/secret/cache.json', 'C:\\Users\\victim\\secret\\x.json', '~/.ssh/id_rsa',
    '/root/private/run.log', '/workspace/user/run.log', '/tmp/private/run.log', '/var/tmp/x.log', '/private/tmp/x.log', 'C:\\workspace\\user.txt', 'D:/workspace/user.txt',
    '/mnt/alice/private.log', '/opt/acme/internal.json', '/srv/private/cache', '/etc/nginx/secrets.conf', '/usr/local/bin/leak', '/var/lib/docker/x', '/media/user/usb.txt',
    '/custom/alice/secret.txt', '/builds/acme/private.log', '/etc/hosts 文件的作用']) {
    assert.equal(isBoundarySafeString(s), false, `machine-private path must be rejected: ${s}`);
  }
  assert.equal(isBoundarySafeString('a'.repeat(BOUNDARY_MAX_STRING_LENGTH + 1)), false, 'over-length string must be rejected');
  assert.equal(isBoundarySafeString('a'.repeat(BOUNDARY_MAX_STRING_LENGTH)), true, 'bounded-length string must pass');
  for (const s of ['fixture', 'https://example.invalid/a?b=1', 'zhihu.com/answer/123', 'ordinary text',
    // P1-1: URL-shaped values are structured values — the generic filesystem
    // rule is deliberately NOT applied to them (URL boundary judges them), so
    // legitimate public URLs pass even with /home-like path segments or
    // path-shaped query values.
    'https://example.invalid/home/article', 'https://example.invalid/?p=/home/alice/x']) {
    assert.equal(isBoundarySafeString(s), true, `safe string must pass: ${s}`);
  }
});

test('F2-P1-2: isBoundarySafeUrlString — strictly bounded multi-layer percent-decode INSPECTION (max URL_DECODE_MAX_LAYERS layers): encoded credential shapes fail closed at EVERY layer and at the fixed limit when encoded bytes remain; malformed percent-encoding fails closed; safe encoded Unicode/ordinary content passes (P1-2, review 5080578795)', () => {
  assert.equal(URL_DECODE_MAX_LAYERS, 3, 'the fixed bound is exactly 3 decode layers (raw → decode1 → decode2 → decode3)');
  const rejects = [
    'https://example.invalid/a/token%3Dsekrit', // 1 layer (raw → decode1)
    'https://example.invalid/a/token%253Dsekrit', // 2 layers (raw → decode1 → decode2)
    'https://example.invalid/a/token%25253Dsekrit', // 3 layers (raw → decode1 → decode2 → decode3)
    'https://example.invalid/a/token%2525253Dsekrit', // beyond the fixed limit — encoded bytes remain at layer 3 → fail closed
    'https://example.invalid/a#token%253Dsekrit', // multi-layer credential in the FRAGMENT
    'https://example.invalid/?token%253Dsekrit', // multi-layer credential in a QUERY NAME
    'https://example.invalid/?v=token%25253Dsekrit', // 3-layer credential in a QUERY VALUE
    'https://example.invalid/%zz', // malformed percent-encoding in the path → fail closed
    'https://example.invalid/?a=%zz', // malformed percent-encoding in a query value → fail closed
  ];
  for (const url of rejects) {
    assert.equal(isBoundarySafeUrlString(url), false, `must fail closed: ${url}`);
  }
  const passes = [
    'https://example.invalid/%E4%B8%AD%E6%96%87/article', // safe encoded Unicode
    'https://example.invalid/time%3D3%3A30/article', // encoded = : in a NON-credential context
    'https://example.invalid/a%2Fb', // encoded slash
    'https://example.invalid/?q=100%25', // percent literal
    'https://example.invalid/?redirect=https%3A%2F%2Fexample.com%2Fx', // encoded redirect URL (no credential word)
  ];
  for (const url of passes) {
    assert.equal(isBoundarySafeUrlString(url), true, `must pass: ${url}`);
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
  // Codex 3rd-round P2 on f742cb3: retrieval ranks are 1-BASED — a rejected-item
  // rank of 0 or a negative value is invalid provenance and must fail closed,
  // matching the fusible rank gate (rank < 1 → fail closed).
  assert.equal(projectRejectedRank(0).ok, false, 'rank 0 must fail closed (1-based ranks)');
  assert.equal(projectRejectedRank(-1).ok, false, 'negative rank must fail closed (1-based ranks)');
  // Review 5078133293 (P2): ranks beyond Number.MAX_SAFE_INTEGER have already
  // been rounded by JS (9007199254740993 → ...992) and must fail closed — a
  // non-safe integer can never be a verifiable RRF rank.
  assert.equal(projectRejectedRank(Number.MAX_SAFE_INTEGER + 1).ok, false, 'rank beyond MAX_SAFE_INTEGER must fail closed');
  assert.equal(projectRejectedRank(Number.MAX_SAFE_INTEGER).ok, true, 'MAX_SAFE_INTEGER itself is a valid rank');
});

test('F5: projectSourceUrlRecord — REUSES the repository classifyUrl trust classifier (https + public host only; localhost/loopback/private/link-local rejected) + T06 credential/path hygiene; unsafe URLs FAIL CLOSED and are never rewritten (P1-4 review 5077286260 / P1 review 5078267886)', () => {
  // Review 5078133293 (P2): the PERSISTED securityClass must BIND to the shared
  // classifier verdict — a public https source is classified 'external_unverified'
  // by classifyUrl, so a provider-declared class must match it exactly.
  const safe = { url: 'https://example.invalid/a?b=1', securityClass: 'external_unverified' };
  assert.deepEqual(projectSourceUrlRecord(safe), { ok: true, value: { url: safe.url, securityClass: safe.securityClass } });
  assert.deepEqual(
    projectSourceUrlRecord({ url: 'https://example.invalid/', securityClass: 'external_unverified', note: 'dropped' }),
    { ok: true, value: { url: 'https://example.invalid/', securityClass: 'external_unverified' } },
    'non-contract metadata fields are dropped; the record is canonicalized to { url, securityClass }',
  );
  assert.deepEqual(projectSourceUrlRecord(null), { ok: true, value: null });
  assert.deepEqual(projectSourceUrlRecord(undefined), { ok: true, value: null });

  const unsafe = [
    ['credential query key', { url: 'https://example.invalid/?token=super-secret', securityClass: 'external_unverified' }],
    ['credential query key variant', { url: 'https://example.invalid/?api_key=abc', securityClass: 'external_unverified' }],
    ['userinfo credentials', { url: 'https://user:pass@example.invalid/', securityClass: 'external_unverified' }],
    ['non-https', { url: 'http://example.invalid/', securityClass: 'external_unverified' }],
    ['missing securityClass', { url: 'https://example.invalid/' }],
    ['non-string url', { url: 5, securityClass: 'external_unverified' }],
    ['non-plain record', new Date()],
    // Review 5078133293 (P2): a provider-declared securityClass that DIFFERS
    // from the shared classifier verdict (e.g. 'trusted' / 'zhimg_cdn' on a
    // plain public https source) is a false classification → FAIL CLOSED.
    ['mismatched securityClass (trusted)', { url: 'https://example.invalid/x', securityClass: 'trusted' }],
    ['mismatched securityClass (zhimg_cdn)', { url: 'https://example.invalid/x', securityClass: 'zhimg_cdn' }],
    // Review 5078267886 (P1): the SHARED classifyUrl classifier rejects
    // localhost / loopback / private / link-local / CGNAT / multicast /
    // reserved hosts — no weaker parallel URL policy in T06.
    ['localhost hostname', { url: 'https://localhost/x', securityClass: 'external_unverified' }],
    ['subdomain localhost', { url: 'https://api.localhost/x', securityClass: 'external_unverified' }],
    ['IPv4 loopback', { url: 'https://127.0.0.1/x', securityClass: 'external_unverified' }],
    ['IPv4 private 10/8', { url: 'https://10.0.0.1/x', securityClass: 'external_unverified' }],
    ['IPv4 private 172.16/12', { url: 'https://172.16.5.9/x', securityClass: 'external_unverified' }],
    ['IPv4 private 192.168/16', { url: 'https://192.168.1.1/x', securityClass: 'external_unverified' }],
    ['IPv4 link-local 169.254/16', { url: 'https://169.254.169.254/x', securityClass: 'external_unverified' }],
    ['IPv4 CGNAT 100.64/10', { url: 'https://100.64.0.1/x', securityClass: 'external_unverified' }],
    ['IPv6 loopback ::1', { url: 'https://[::1]/x', securityClass: 'external_unverified' }],
    ['IPv6 ULA fc00::/7', { url: 'https://[fc00::1]/x', securityClass: 'external_unverified' }],
    ['IPv6 link-local fe80::/10', { url: 'https://[fe80::1]/x', securityClass: 'external_unverified' }],
    ['zhihu redirect host as final target', { url: 'https://link.zhihu.com/x', securityClass: 'external_unverified' }],
  ];
  for (const [label, record] of unsafe) {
    assert.equal(projectSourceUrlRecord(record).ok, false, `${label}: must fail closed`);
  }
  // Codex 3rd-round P2 on f742cb3: a URL's PATH SEGMENT is public resource
  // addressing, NOT a machine-private filesystem path — https://…/home/… and
  // https://…/tmp/… are legitimate public source URLs and must NOT be rejected
  // by PRIVATE_PATH_SHAPE (that guard applies to bare path STRINGS, which are
  // covered by F2 and by the bare-path url case below).
  const urlPathSafe = [
    ['public URL with /home path segment', 'https://example.invalid/home/article', 'external_unverified'],
    ['public URL with /tmp path segment', 'https://example.invalid/tmp/report', 'external_unverified'],
    ['public URL with /private-user path segment', 'https://example.invalid/home/private-user/x', 'external_unverified'],
    // P1-1 (review 5080578795): a NOVEL root inside a URL path is public
    // resource addressing, NOT a local filesystem path — the generic path rule
    // must never reject it (URL-shaped values are exempt by contract).
    ['public URL with novel /custom root path', 'https://example.invalid/custom/alice/x', 'external_unverified'],
    ['public URL with novel /builds root path', 'https://example.invalid/builds/acme/private.log', 'external_unverified'],
  ];
  for (const [label, url, securityClass] of urlPathSafe) {
    assert.deepEqual(
      projectSourceUrlRecord({ url, securityClass }),
      { ok: true, value: { url, securityClass } },
      `${label}: URL path segments are not machine-private filesystem paths`,
    );
  }
  // A BARE filesystem-path STRING supplied as the url value (not a parseable
  // URL) still fails closed — the URL-specific boundary requires new URL() to
  // parse it, and the generic string boundary rejects it as a private path.
  assert.equal(
    projectSourceUrlRecord({ url: '/home/private-user/secret.json', securityClass: 'external_unverified' }).ok,
    false,
    'bare machine-private path string as url must fail closed',
  );
  assert.equal(
    projectSourceUrlRecord({ url: 'C:\\Users\\victim\\secret.json', securityClass: 'external_unverified' }).ok,
    false,
    'bare Windows path string as url must fail closed',
  );
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
  // Codex 3rd-round P2 on f742cb3: a URL-shaped string whose path segment
  // looks filesystem-like is a structured value (public resource addressing),
  // NOT a machine-private path — the artifact walk accepts it.
  assert.deepEqual(
    assertArtifactSafe({ sourceUrl: { url: 'https://example.invalid/home/article', securityClass: 'external_unverified' } }),
    { ok: true },
    'URL-shaped string with /home path passes the artifact walk',
  );
  assert.deepEqual(
    assertArtifactSafe({ v: 'https://example.invalid/tmp/report' }),
    { ok: true },
    'URL-shaped string with /tmp path passes the artifact walk',
  );

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

test('F8: assertArtifactSafe trustedPlanStrings — an EXACT plan-validated query string (validated.plan.queryVariants) crosses the plan-contract boundary (T04) instead of the broader provider-content lens; the option is NOT a general caller-defined trust bypass, and untrusted / plan-UNSAFE strings still fail closed (R11, Codex 5th-round P2 on 526ca71; renamed in the final convergence repair)', () => {
  const SYSTEM_PATH_QUERY = '/etc/hosts 文件的作用';
  // Untrusted: the full provider-content boundary rejects the system-path query.
  assert.deepEqual(
    assertArtifactSafe({ v: SYSTEM_PATH_QUERY }),
    { ok: false, reason: 'unsafe_string' },
    'untrusted system-path string still fails the provider-content lens',
  );
  // Trusted (exact T04-validated plan query): the plan-contract boundary accepts it.
  assert.deepEqual(
    assertArtifactSafe({ v: SYSTEM_PATH_QUERY }, { trustedPlanStrings: new Set([SYSTEM_PATH_QUERY]) }),
    { ok: true },
    'exact trusted plan query crosses the plan-contract boundary',
  );
  // Trusted does NOT mean blanket trust: credential-shaped strings are rejected
  // even when listed (the plan boundary rejects them too).
  assert.deepEqual(
    assertArtifactSafe({ v: 'password=sekrit' }, { trustedPlanStrings: new Set(['password=sekrit']) }),
    { ok: false, reason: 'unsafe_string' },
    'credential-shaped string is rejected even when listed as trusted',
  );
  // ... and machine-private profile-root paths are rejected even when listed.
  assert.deepEqual(
    assertArtifactSafe({ v: '/home/private-user/x' }, { trustedPlanStrings: new Set(['/home/private-user/x']) }),
    { ok: false, reason: 'unsafe_string' },
    'machine-private profile-root path is rejected even when listed as trusted',
  );
  // A nested trusted string inside the walked structure is accepted at any depth.
  assert.deepEqual(
    assertArtifactSafe(
      { channels: [{ channel: { query: SYSTEM_PATH_QUERY, providerId: 'p', capability: 'search' } }] },
      { trustedPlanStrings: new Set([SYSTEM_PATH_QUERY]) },
    ),
    { ok: true },
    'trusted plan query is accepted at any nesting depth',
  );
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

// ---------------------------------------------------------------------------
// R12. final convergence repair counterexamples
// (Round-6 BLOCK1 3905300503 / BLOCK2 3905300513 / BLOCK3 3905300520 /
//  BLOCK4 3905300529 + C2 static FUSION messages)
// ---------------------------------------------------------------------------

/** Capture a thrown error (or null when nothing was thrown). */
function capture(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

test('R12-B1: assertValidChannel canonicalizes to the exact §5.4 triple — extra caller-supplied channel fields (token / diagnostic-path keys / metadata) never reach fused ranks or rejected entries; a path-shaped providerId or a plan-UNSAFE query fails closed at channel validation (Round-6 BLOCK1, 3905300503)', () => {
  const fused = rrfFusion([
    {
      channel: {
        query: 'q1', providerId: 'fixture-a', capability: 'search',
        token: 'sekrit', diagnostic_path: '/home/private-user/x', meta: { a: 1 },
      },
      items: [{ identity: { questionId: '10' }, provenance: { route: 'fixture', rank: 1, rankOrigin: 'fixture_order' }, source_url: null, facts: {} }],
    },
  ]);
  assert.equal(fused.candidates.length, 1, 'canonicalization does not reject a valid channel');
  const rankChannel = fused.candidates[0].ranks[0].channel;
  assert.deepEqual(rankChannel, { query: 'q1', providerId: 'fixture-a', capability: 'search' }, 'rank channel is the canonical triple ONLY');
  assert.deepEqual(Object.keys(rankChannel).sort(), ['capability', 'providerId', 'query'], 'no extra keys survive canonicalization');
  // A rejected observation's channel is canonicalized identically.
  const withRejected = rrfFusion([
    {
      channel: { query: 'q1', providerId: 'fixture-a', capability: 'search', token: 'sekrit' },
      items: [{ identity: { questionId: '10' }, provenance: { route: 'fixture', rank: 1 }, source_url: null, facts: {}, failure: { code: 'X', class: 'y' } }],
    },
  ]);
  assert.deepEqual(withRejected.rejected[0].channel, { query: 'q1', providerId: 'fixture-a', capability: 'search' }, 'rejected channel is the canonical triple ONLY');
  // A path-shaped providerId cannot cross the provider-content boundary.
  assert.throws(
    () => rrfFusion([{ channel: { query: 'q1', providerId: '/home/private-user/p', capability: 'search' }, items: [] }]),
    (err) => err.code === FUSION_ERROR_CHANNEL_IDENTITY_INVALID,
    'path-shaped providerId fails closed at channel validation (provider-content boundary)',
  );
  // A plan-UNSAFE (credential-shaped) query cannot cross the T04 plan boundary.
  assert.throws(
    () => rrfFusion([{ channel: { query: 'password=sekrit', providerId: 'fixture-a', capability: 'search' }, items: [] }]),
    (err) => err.code === FUSION_ERROR_CHANNEL_IDENTITY_INVALID,
    'credential-shaped query fails closed at channel validation (T04 plan boundary)',
  );
});

test('R12-B3: duplicate channel identity across rankings (same query + providerId + capability) fails closed with FUSION_DUPLICATE_CHANNEL BEFORE any item traversal — including fully disjoint candidate sets (Round-6 BLOCK3, 3905300520)', () => {
  // Disjoint candidate sets: the repeated channel triple is ambiguous for RRF
  // accumulation regardless of the item content.
  assert.throws(
    () => rrfFusion([ranking('q1', 'fixture-a', [['10', 1]]), ranking('q1', 'fixture-a', [['20', 1]])]),
    (err) => err.code === FUSION_ERROR_DUPLICATE_CHANNEL,
    'disjoint duplicate channels fail closed with FUSION_DUPLICATE_CHANNEL',
  );
  // Overlapping candidate sets: same fail-closed class.
  assert.throws(
    () => rrfFusion([ranking('q1', 'fixture-a', [['10', 1]]), ranking('q1', 'fixture-a', [['10', 1]])]),
    (err) => err.code === FUSION_ERROR_DUPLICATE_CHANNEL,
    'overlapping duplicate channels fail closed with FUSION_DUPLICATE_CHANNEL',
  );
  // Distinct channel triples (different query / provider / capability) stay legal.
  const fused = rrfFusion([
    ranking('q1', 'fixture-a', [['10', 1]]),
    ranking('q2', 'fixture-a', [['10', 2]]),
    ranking('q1', 'fixture-b', [['10', 3]]),
  ]);
  assert.equal(fused.candidates.length, 1, 'distinct channel triples still fuse normally');
});

test('R12-B2: isBoundarySafeUrlString applies ONE level of percent-decoding to pathname/fragment/query before credential checks — encoded credential shapes and malformed encoding fail closed (Round-6 BLOCK2, 3905300513)', () => {
  for (const url of [
    'https://example.invalid/a/token%3Dsekrit', // credential encoded in the PATH
    'https://example.invalid/a#token%3Dsekrit', // credential encoded in the FRAGMENT
    'https://example.invalid/?token%3Dsekrit', // credential encoded in a QUERY NAME
    'https://example.invalid/?name%3Dz_c0%3Dabc', // credential encoded in a QUERY VALUE
  ]) {
    assert.equal(isBoundarySafeUrlString(url), false, `${url}: percent-encoded credential shape must fail closed`);
  }
  assert.equal(isBoundarySafeUrlString('https://example.invalid/%zz'), false, 'malformed percent-encoding fails closed');
  assert.equal(isBoundarySafeUrlString('https://example.invalid/%E4%B8%AD%E6%96%87/article'), true, 'legitimate encoded content still passes');
  assert.equal(isBoundarySafeUrlString('https://example.invalid/home/article'), true, 'plain public URL still passes');
});

test('R12-C2: every FUSION_* error MESSAGE is STATIC — raw provider/caller-controlled values are never embedded; the machine-readable .code carries the identity (final convergence repair C2)', () => {
  // Channel identity invalid (missing fields): no raw channel payload.
  let err = capture(() => rrfFusion([{ channel: { query: 'q1' }, items: [] }]));
  assert.equal(err.code, FUSION_ERROR_CHANNEL_IDENTITY_INVALID);
  assert.equal(err.message, 'malformed fusion channel identity (non-empty query + providerId + retrieval-ranked search capability required)');
  // Channel identity invalid (boundary): the credential-shaped query is never echoed.
  err = capture(() => rrfFusion([{ channel: { query: 'password=sekrit', providerId: 'fixture-a' }, items: [] }]));
  assert.equal(err.code, FUSION_ERROR_CHANNEL_IDENTITY_INVALID);
  assert.ok(!err.message.includes('password=sekrit'), 'credential-shaped query never embedded in the message');
  // Items not an array: static message.
  err = capture(() => rrfFusion([{ channel: { query: 'q1', providerId: 'fixture-a', capability: 'search' }, items: 'nope' }]));
  assert.equal(err.code, FUSION_ERROR_CHANNEL_IDENTITY_INVALID);
  assert.equal(err.message, 'ranking items must be an array for a fusion channel');
  // Item identity invalid: the raw questionId 'abc' is never embedded.
  err = capture(() => rrfFusion([{ channel: { query: 'q1', providerId: 'fixture-a', capability: 'search' }, items: [{ identity: { questionId: 'abc' }, provenance: { route: 'r', rank: 1 }, source_url: null, facts: {} }] }]));
  assert.equal(err.code, FUSION_ERROR_ITEM_IDENTITY_INVALID);
  assert.ok(!err.message.includes('abc'), 'raw malformed identity never embedded');
  // Rank invalid: the raw rank is never embedded.
  err = capture(() => rrfFusion([{ channel: { query: 'q1', providerId: 'fixture-a', capability: 'search' }, items: [{ identity: { questionId: '10' }, provenance: { route: 'r', rank: 0 }, source_url: null, facts: {} }] }]));
  assert.equal(err.code, FUSION_ERROR_RANK_INVALID);
  assert.equal(err.message, 'fusible item carries no valid 1-based provenance.rank');
  // Within-channel duplicate: the questionId is never embedded.
  err = capture(() => rrfFusion([{ channel: { query: 'q1', providerId: 'fixture-a', capability: 'search' }, items: [
    { identity: { questionId: '42' }, provenance: { route: 'r', rank: 1 }, source_url: null, facts: {} },
    { identity: { questionId: '42' }, provenance: { route: 'r', rank: 5 }, source_url: null, facts: {} },
  ] }]));
  assert.equal(err.code, FUSION_ERROR_DUPLICATE_IN_CHANNEL);
  assert.ok(!err.message.includes('42'), 'questionId never embedded in the duplicate-in-channel message');
  // Duplicate channel: neither the query nor the candidate ids are embedded.
  err = capture(() => rrfFusion([ranking('q1', 'fixture-a', [['10', 1]]), ranking('q1', 'fixture-a', [['20', 1]])]));
  assert.equal(err.code, FUSION_ERROR_DUPLICATE_CHANNEL);
  assert.ok(!err.message.includes('q1') && !err.message.includes('10') && !err.message.includes('20'), 'duplicate-channel message is fully static');
  // Unsafe provider data: the field name is a module literal; the raw
  // URL/credential is never embedded.
  err = capture(() => rrfFusion([{ channel: { query: 'q1', providerId: 'fixture-a', capability: 'search' }, items: [{ identity: { questionId: '10' }, provenance: { route: 'r', rank: 1 }, source_url: { url: 'https://example.invalid/?token=sekrit', securityClass: 'external_unverified' }, facts: {} }] }]));
  assert.equal(err.code, FUSION_ERROR_UNSAFE_PROVIDER_DATA);
  assert.ok(!err.message.includes('https://example.invalid') && !err.message.includes('token=sekrit'), 'raw URL/credential never embedded in the unsafe-data message');
});

test('R12-B4: FUSION_CONTRACT_ERROR_CODES allowlists EVERY FUSION_* contract error code and can never admit path/credential-shaped codes (Round-6 BLOCK4, 3905300529)', () => {
  for (const code of [
    FUSION_ERROR_CHANNEL_IDENTITY_INVALID,
    FUSION_ERROR_RANK_INVALID,
    FUSION_ERROR_ITEM_IDENTITY_INVALID,
    FUSION_ERROR_FAILURE_IDENTITY_INVALID,
    FUSION_ERROR_DUPLICATE_IN_CHANNEL,
    FUSION_ERROR_DUPLICATE_CHANNEL,
    FUSION_ERROR_UNSAFE_PROVIDER_DATA,
  ]) {
    assert.ok(FUSION_CONTRACT_ERROR_CODES.includes(code), `${code} must be allowlisted`);
  }
  assert.equal(FUSION_CONTRACT_ERROR_CODES.length, 7, 'the allowlist is complete and frozen');
  // Counterexamples: a path/credential-shaped code thrown by a buggy future
  // path is NULLED by the retrieval catch — it can never be a member here.
  assert.equal(FUSION_CONTRACT_ERROR_CODES.includes('/home/private-user/x'), false, 'path-shaped code can never be a member');
  assert.equal(FUSION_CONTRACT_ERROR_CODES.includes('token=abc'), false, 'credential-shaped code can never be a member');
  assert.equal(FUSION_CONTRACT_ERROR_CODES.includes('z_c0=secret'), false, 'credential-shaped code can never be a member');
});

// ---------------------------------------------------------------------------
// R13 — P1-T06 security repair (review 5080250592 FIX 1 + FIX 2)
// Unit-level counterexamples for the atomic error-code projection and the
// meaningful-failure-identity gate.
// ---------------------------------------------------------------------------

test('R13-F1: projectAllowedErrorCode reads err.code EXACTLY ONCE and snapshots it — stateful/throwing getters cannot leak a second private value (review 5080250592 FIX 1)', () => {
  // A. stateful getter: first read = allowed code, second hypothetical read =
  //    /home/private-user/x. The returned value must be the FIRST (allowed) read,
  //    proving the getter is read once and the snapshot (not a reread) is used.
  let reads = 0;
  const stateful = {};
  Object.defineProperty(stateful, 'code', {
    get() {
      reads += 1;
      return reads === 1 ? FUSION_ERROR_DUPLICATE_CHANNEL : '/home/private-user/x';
    },
  });
  assert.equal(
    projectAllowedErrorCode(stateful, FUSION_CONTRACT_ERROR_CODES),
    FUSION_ERROR_DUPLICATE_CHANNEL,
    'stateful getter: only the first read is used — never the private path',
  );
  assert.equal(reads, 1, 'err.code was read exactly once (no check-then-reread)');
  // B. throwing getter -> stable null, no raw throw escapes.
  const throwing = {};
  Object.defineProperty(throwing, 'code', { get() { throw new Error('boom'); } });
  assert.equal(projectAllowedErrorCode(throwing, FUSION_CONTRACT_ERROR_CODES), null, 'throwing getter -> stable null (no raw throw)');
  // C. stable malicious codes -> null (never proxied).
  assert.equal(projectAllowedErrorCode({ code: 'token=sekrit' }, FUSION_CONTRACT_ERROR_CODES), null, 'credential-shaped code -> null');
  assert.equal(projectAllowedErrorCode({ code: '/home/private-user/x' }, FUSION_CONTRACT_ERROR_CODES), null, 'path-shaped code -> null');
  // D. stable known allowlisted code -> preserved.
  assert.equal(
    projectAllowedErrorCode({ code: FUSION_ERROR_DUPLICATE_CHANNEL }, FUSION_CONTRACT_ERROR_CODES),
    FUSION_ERROR_DUPLICATE_CHANNEL,
    'allowlisted stable code is preserved',
  );
  // additional non-string / absent cases -> null.
  assert.equal(projectAllowedErrorCode({ code: 42 }, FUSION_CONTRACT_ERROR_CODES), null, 'non-string code -> null');
  assert.equal(projectAllowedErrorCode({ code: null }, FUSION_CONTRACT_ERROR_CODES), null, 'null code -> null');
  assert.equal(projectAllowedErrorCode(undefined, FUSION_CONTRACT_ERROR_CODES), null, 'undefined err -> null');
});

test('R13-F2: projectFailure rejects whitespace-only code/class — machine-readable failure identity requires NON-WHITESPACE code + class (review 5080250592 FIX 2)', () => {
  const wsCases = [
    { code: '', class: 'provider' },
    { code: '   ', class: 'provider' },
    { code: '\t', class: 'provider' },
    { code: 'PROVIDER_REPORTED_FAILURE', class: '' },
    { code: 'PROVIDER_REPORTED_FAILURE', class: '   ' },
    { code: 'PROVIDER_REPORTED_FAILURE', class: '\t' },
  ];
  for (const bad of wsCases) {
    assert.equal(projectFailure(bad).ok, false, 'whitespace-only rejected: ' + JSON.stringify(bad));
  }
  // meaningful identity preserved verbatim.
  const good = { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' };
  const r = projectFailure(good);
  assert.equal(r.ok, true, 'meaningful code+class preserved');
  assert.deepEqual(r.failure, { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' });
  // existing guards retained: null -> no failure; missing class -> rejected;
  // credential-shaped code -> rejected.
  assert.equal(projectFailure(null).ok, true, 'null -> no failure');
  assert.equal(projectFailure({ code: 'X' }).ok, false, 'missing class -> rejected');
  assert.equal(projectFailure({ code: 'token=sekrit', class: 'provider' }).ok, false, 'credential-shaped code -> rejected');
});
