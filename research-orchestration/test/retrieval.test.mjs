/**
 * research-orchestration/test/retrieval.test.mjs
 *
 * P1-T06 focused tests — multi-query retrieval + deterministic RRF fusion →
 * Candidate/Retrieval Pool (Spec §5.4 / §6.2; Issue #38; single pass, fixtures).
 *
 * Coverage contract (Issue #38 REQUIRED_TESTS + executor TEST EXPECTATIONS):
 *   - one query / one channel;
 *   - multiple queries (plan query variants executed per channel);
 *   - multiple fixture channels (distinct providers);
 *   - same candidate appearing in multiple rankings (RRF accumulation);
 *   - deterministic RRF accumulation / deterministic tie resolution;
 *   - input/rank ordering counterexamples (permuted channel order → identical
 *     candidate fusion);
 *   - channel provenance preservation (pool + per-candidate ranks record the
 *     query + provider + capability triple);
 *   - provider failure propagation (machine-readable, NO_SILENT_PROVIDER_FALLBACK);
 *   - P1-1 safe projection counterexamples: failure detail carrying private
 *     paths / BigInt / cyclic metadata is projected to { code, class } only — in
 *     mixed-success AND all-failed runs — and never reaches output or the pool;
 *   - P1-1 per-item projection (review 5076691874): a successful provider result
 *     with a rejected item whose failure embeds machine-private diagnostics →
 *     pool.rejected retains the allowed safe machine identity { code, class }
 *     ONLY;
 *   - P1-2 completeness evidence boundary (review 5076691874): ok AND failed
 *     channel completeness evidence embedding machine-private paths /
 *     credential-shaped diagnostics → FAIL CLOSED
 *     (retrieval_provider_contract_invalid), no artifact, no leak; safe
 *     evidence is preserved as-is (status + evidence, never bare-dropped);
 *   - P2 registry guard (review 5076691874): throwing / non-array / malformed
 *     seam.listProviders() → stable retrieval_provider_contract_invalid before
 *     any provider retrieval IO — no raw throw, no registry payload echo;
 *   - P1-2: contradictory ok:true + top-level failure → FAIL CLOSED
 *     (retrieval_provider_contract_invalid), never fused;
 *   - P1-3: malformed caller-supplied planHash (path/credential-shaped) → FAIL
 *     CLOSED with stable malformed/mismatch info; the supplied value is never echoed;
 *   - P1-4: within-channel duplicate questionId → FAIL CLOSED
 *     (retrieval_provider_contract_invalid), independent of item array order;
 *   - P1-5: pool.rejected is canonical (stable-key order) — channel descriptor
 *     + item order permutations yield an identical rejected list;
 *   - path-redaction counterexamples: absolute workDir / adapter err.message /
 *     raw malformed channel/descriptor values never leak into failure output
 *     (RULES §11) — failure details carry stable sanitized reasons only;
 *   - non-JSON-safe seam-accepted metadata (BigInt / cyclic facts) → FAIL CLOSED
 *     (retrieval_provider_contract_invalid), NO artifact written;
 *   - present-but-malformed explicit per-item failure → FAIL CLOSED
 *     (retrieval_provider_contract_invalid), never fused as valid;
 *   - P2-1: null / non-object options → FAIL CLOSED (retrieval_invalid_input),
 *     never a TypeError from destructuring;
 *   - P2-2: non-JSON-safe malformed rank (BigInt) → FAIL CLOSED with the FUSION
 *     code surviving safe formatting (retrieval_provider_contract_invalid);
 *   - P2-3: auth_class persisted as adapter-bound channel provenance on ok AND
 *     failed channel records; never part of the RRF channel key;
 *   - zero valid retrieval channels → FAIL CLOSED;
 *   - malformed provider result → FAIL CLOSED where contract requires
 *     (seam UNKNOWN_PROVIDER_CONTRACT / fused-item rank contract);
 *   - Session capture wrapper can NEVER masquerade as a retrieval-ranked channel;
 *   - persisted pool artifact: deterministic bytes + poolHash, planHash recorded,
 *     work-relative only.
 *   - R12 final convergence repair (Round-6 BLOCK1/BLOCK2/BLOCK3/BLOCK4 + C1):
 *     BLOCK1 canonical channel triple (extra descriptor fields never leak);
 *     BLOCK2 one-level percent-decoding of URL path/fragment/query before
 *     credential checks (encoded credential shapes + malformed encoding fail
 *     closed; legitimate encoded content passes); BLOCK3 duplicate channel
 *     identity is structurally prevented pre-fusion (registry duplicate
 *     identity / duplicate descriptors fail closed before any IO); BLOCK4
 *     allowlisted fusion codes surface machine-readably while arbitrary
 *     path/credential-shaped codes are nulled; C1 the plan-owned query crosses
 *     the T04 plan boundary on the ALL-failed path too (T04-valid queries are
 *     preserved, matching the successful path).
 *
 * All tests are deterministic and network-free: seam adapters are fixtures
 * (provider results per §5.1 shape), mirroring provider-seam.test.mjs conventions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CAPABILITY_SEARCH,
  CAPABILITY_CAPTURE,
  AUTH_CLASS_OFFICIAL_SECRET,
  AUTH_CLASS_SESSION,
  COMPLETENESS_UNKNOWN,
  COMPLETENESS_COMPLETE,
  COMPLETENESS_PARTIAL,
  SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT,
  createProviderSeam,
} from '../lib/provider-seam.mjs';
import {
  RETRIEVAL_POOL_FILENAME,
  RETRIEVAL_FAILURE_INVALID_INPUT,
  RETRIEVAL_FAILURE_PLAN_INVALID,
  RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH,
  RETRIEVAL_FAILURE_CHANNEL_NOT_RETRIEVAL_RANKED,
  RETRIEVAL_FAILURE_NO_VALID_CHANNEL,
  RETRIEVAL_FAILURE_CHANNEL_UNREGISTERED,
  RETRIEVAL_FAILURE_CHANNEL_DUPLICATE,
  RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID,
  RETRIEVAL_FAILURE_POOL_WRITE,
  runMultiQueryRetrieval,
} from '../lib/retrieval.mjs';
import { planHash, validatePlanInput } from '../lib/plan-contract.mjs';
import {
  FUSION_ERROR_DUPLICATE_IN_CHANNEL,
  FUSION_ERROR_DUPLICATE_CHANNEL,
  FUSION_CONTRACT_ERROR_CODES,
} from '../lib/rrf.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = () => '2026-08-30T12:00:00.000Z';

/** Minimal valid plan covering the T04 contract (queryVariants + aspects required). */
const PLAN = {
  schemaVersion: 1,
  queryVariants: ['大语言模型 Agent 落地争议', '智能体 企业落地'],
  aspects: ['技术成熟度'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};
const PLAN_HASH = planHash(PLAN);

/** Single-query plan (one query / one channel baseline). */
const PLAN_SINGLE = {
  schemaVersion: 1,
  queryVariants: ['大语言模型 Agent 落地争议'],
  aspects: ['技术成熟度'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

function tmpWorkDir(prefix = 'retrieval-t06') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

/**
 * §5.1-shape fixture result for a search-capability adapter.
 * entries: [questionId, rank, extra?] — extra may carry { failure, source_url, facts, provenance, kind }.
 */
function searchResult(providerId, entries, { ok = true, failure = null, query = 'q' } = {}) {
  const result = {
    ok,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: entries.map(([questionId, rank, extra = {}]) => ({
      identity: { kind: extra.kind ?? 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order', ...(extra.provenance ?? {}) },
      source_url: extra.source_url ?? null,
      facts: extra.facts ?? {},
      ...(extra.failure ? { failure: extra.failure } : {}),
    })),
    completeness: {
      status: COMPLETENESS_UNKNOWN,
      evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' },
    },
    ...(failure ? { failure } : {}),
  };
  void query;
  return result;
}

/**
 * Fixture search adapter (counting invocations) — registered through the REAL
 * provider seam so routing/validation semantics are exercised, not bypassed.
 */
function fixtureSearchAdapter(providerId, handler) {
  let calls = 0;
  return {
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve(input) {
      calls += 1;
      return handler(input);
    },
    __calls: () => calls,
  };
}

/** Fixture session-capture adapter — must never be reachable as a retrieval channel. */
function fixtureCaptureAdapter(providerId) {
  let calls = 0;
  return {
    providerId,
    capability: CAPABILITY_CAPTURE,
    authClass: AUTH_CLASS_SESSION,
    retrieve() {
      calls += 1;
      return {
        ok: true,
        provider_id: providerId,
        capability: CAPABILITY_CAPTURE,
        auth_class: AUTH_CLASS_SESSION,
        retrieved_at: FIXED_NOW(),
        items: [],
        completeness: { status: COMPLETENESS_COMPLETE, evidence: { basis: 'fixture' } },
        verified: false,
        validity_authority: 'verify-output',
      };
    },
    __calls: () => calls,
  };
}

function channelFootprint(channel) {
  return `${channel.query}::${channel.providerId}::${channel.capability}`;
}

function candidateIds(pool) {
  return pool.candidates.map((c) => c.identity.questionId);
}

function scoreFor(pool, questionId) {
  const hit = pool.candidates.find((c) => c.identity.questionId === questionId);
  return hit ? hit.rrfScore : null;
}

// ---------------------------------------------------------------------------
// A. baseline execution + persisted pool
// ---------------------------------------------------------------------------

test('A1: one query / one channel — pool persisted with channel record + ordered candidates + planHash', () => {
  const seam = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1], ['200', 2]], { query: input.query }))],
  });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, planHash: planHash(PLAN_SINGLE), seam, workDir });

  assert.equal(run.ok, true);
  assert.equal(run.file, RETRIEVAL_POOL_FILENAME);
  assert.equal(run.pool.planHash, planHash(PLAN_SINGLE));
  assert.equal(run.pool.schemaVersion, 1);
  assert.equal(run.pool.type, 'retrieval-pool');

  assert.equal(run.pool.channels.length, 1);
  const channel = run.pool.channels[0];
  assert.deepEqual(channel.channel, { query: PLAN_SINGLE.queryVariants[0], providerId: 'fixture-a', capability: CAPABILITY_SEARCH });
  assert.equal(channel.ok, true);
  assert.equal(channel.itemCount, 2);
  assert.equal(channel.completeness.status, COMPLETENESS_UNKNOWN);

  assert.deepEqual(candidateIds(run.pool), ['100', '200']);
  assert.equal(scoreFor(run.pool, '100'), 1 / (60 + 1));
  assert.equal(run.pool.candidates[0].ranks[0].channel.providerId, 'fixture-a');
  assert.deepEqual(run.pool.rejected, []);

  // persisted artifact exists and matches the returned hash
  const file = path.join(workDir, RETRIEVAL_POOL_FILENAME);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.planHash, planHash(PLAN_SINGLE));
  assert.deepEqual(onDisk.candidates, run.pool.candidates);
});

test('A2: multiple queries — one channel record per (query × channel) in deterministic order', () => {
  const seam = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [[input.query === PLAN.queryVariants[0] ? '100' : '300', 1]], { query: input.query }))],
  });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });

  assert.equal(run.ok, true);
  assert.deepEqual(
    run.pool.channels.map((c) => channelFootprint(c.channel)),
    [
      `${PLAN.queryVariants[0]}::fixture-a::search`,
      `${PLAN.queryVariants[1]}::fixture-a::search`,
    ],
    'plan query order preserved',
  );
  assert.deepEqual(candidateIds(run.pool), ['100', '300']);
});

test('A3: multiple fixture channels (2 providers × 2 queries) fuse across channels', () => {
  const seam = createProviderSeam({
    adapters: [
      fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1], ['200', 2]], { query: input.query })),
      fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['100', 2], ['300', 1]], { query: input.query })),
    ],
  });
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    seam,
    channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }],
    workDir: tmpWorkDir(),
  });

  assert.equal(run.ok, true);
  assert.equal(run.pool.channels.length, 4, '2 queries × 2 providers');
  // 100 appears in every channel: 1/(61)+1/(62) each from a+b over both queries
  const expected100 = 2 * (1 / 61 + 1 / 62);
  const expected200 = 2 * (1 / 62);
  const expected300 = 2 * (1 / 61);
  assert.ok(Math.abs(scoreFor(run.pool, '100') - expected100) < 1e-15);
  assert.ok(Math.abs(scoreFor(run.pool, '200') - expected200) < 1e-15);
  assert.ok(Math.abs(scoreFor(run.pool, '300') - expected300) < 1e-15);
  assert.equal(run.pool.candidates[0].ranks.length, 4, 'all four contributing channels preserved per candidate');
});

test('A4: same candidate in multiple rankings accumulates — ranks record every channel identity', () => {
  const seam = createProviderSeam({
    adapters: [
      fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query })),
      fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['100', 3]], { query: input.query })),
    ],
  });
  const run = runMultiQueryRetrieval({
    plan: PLAN_SINGLE,
    seam,
    channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }],
    workDir: tmpWorkDir(),
  });
  assert.equal(run.ok, true);
  const candidate = run.pool.candidates[0];
  assert.equal(candidate.identity.questionId, '100');
  assert.equal(candidate.ranks.length, 2);
  assert.ok(candidate.ranks.every((r) => r.channel.capability === CAPABILITY_SEARCH && r.channel.query === PLAN_SINGLE.queryVariants[0]));
  const providers = candidate.ranks.map((r) => r.channel.providerId).sort();
  assert.deepEqual(providers, ['fixture-a', 'fixture-b']);
});

// ---------------------------------------------------------------------------
// B. determinism
// ---------------------------------------------------------------------------

test('B1: identical inputs → identical pool bytes and poolHash (fixtures are reproducible evidence)', async () => {
  const makeRun = () => {
    const seam = createProviderSeam({
      adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1], ['200', 2]], { query: input.query }))],
    });
    return runMultiQueryRetrieval({ plan: PLAN, planHash: PLAN_HASH, seam, workDir: tmpWorkDir() });
  };
  const run1 = makeRun();
  const run2 = makeRun();
  assert.equal(run1.poolHash, run2.poolHash);
  assert.deepEqual(run1.pool, run2.pool);
  // persisted file bytes hash to the returned poolHash
  const dir = tmpWorkDir();
  const run3 = runMultiQueryRetrieval({ plan: PLAN, seam: createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))],
  }), workDir: dir });
  const bytes = fs.readFileSync(path.join(dir, RETRIEVAL_POOL_FILENAME), 'utf8');
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), run3.poolHash, 'persisted file bytes match poolHash');
});

test('B2: permuted channel descriptor order → identical fused candidates (bitwise scores), only channel record order differs', () => {
  const build = (descriptors) => {
    const seam = createProviderSeam({
      adapters: [
        fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1], ['200', 2]], { query: input.query })),
        fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['200', 1], ['300', 2]], { query: input.query })),
      ],
    });
    const run = runMultiQueryRetrieval({ plan: PLAN, seam, channels: descriptors, workDir: tmpWorkDir() });
    return run;
  };
  const r1 = build([{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }]);
  const r2 = build([{ providerId: 'fixture-b' }, { providerId: 'fixture-a' }]);
  assert.equal(r1.ok && r2.ok, true);
  assert.deepEqual(r1.pool.candidates, r2.pool.candidates, 'fusion output is permutation-invariant');
  assert.deepEqual(r1.pool.rejected, r2.pool.rejected);
  assert.notDeepEqual(r1.pool.channels, r2.pool.channels, 'channel record order follows the (deterministic) descriptor order');
});

test('B3: deterministic tie resolution — equal scores order by questionId ascending', () => {
  const seam = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['9', 1], ['10', 1]], { query: input.query }))],
  });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });
  assert.deepEqual(candidateIds(run.pool), ['10', '9'], '"10" ties "9" → lexicographic ascending');
  assert.equal(run.pool.criteria.tieBreak, 'score-desc-questionId-asc');
});

// ---------------------------------------------------------------------------
// C. channel provenance
// ---------------------------------------------------------------------------

test('C1: pool records full channel provenance (query + provider + capability) on every channel and every rank', () => {
  const seam = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))],
  });
  const run = runMultiQueryRetrieval({ plan: PLAN, planHash: PLAN_HASH, seam, workDir: tmpWorkDir() });
  const expectedTriple = { query: PLAN.queryVariants[0], providerId: 'fixture-a', capability: CAPABILITY_SEARCH };
  assert.deepEqual(run.pool.channels[0].channel, expectedTriple);
  assert.deepEqual(run.pool.candidates[0].ranks[0].channel, expectedTriple);
});

test('C2: retrieval route (provenance.route) survives into the persisted pool ranks (retrieval-pool.json) — P1-2', () => {
  const seam = createProviderSeam({
    adapters: [
      fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { provenance: { route: 'zhihu-answer-grabber:search', rankOrigin: 'official_order' } }]], { query: input.query })),
    ],
  });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir });
  assert.equal(run.ok, true);
  const rank = run.pool.candidates[0].ranks[0];
  assert.equal(rank.route, 'zhihu-answer-grabber:search', 'route captured from provenance.route');
  assert.equal(rank.rankOrigin, 'official_order');
  const onDisk = JSON.parse(fs.readFileSync(path.join(workDir, RETRIEVAL_POOL_FILENAME), 'utf8'));
  assert.equal(onDisk.candidates[0].ranks[0].route, 'zhihu-answer-grabber:search', 'route persisted in retrieval-pool.json');
});

test('C3: fused candidate identity is canonical (kind="candidate") and permutation-invariant when channels return differing kinds — P1-3', () => {
  const build = (descriptors) => {
    const seam = createProviderSeam({
      adapters: [
        fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { kind: 'candidate' }]], { query: input.query })),
        fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['100', 2, { kind: 'source-group' }]], { query: input.query })),
      ],
    });
    return runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, channels: descriptors, workDir: tmpWorkDir() });
  };
  const r1 = build([{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }]);
  const r2 = build([{ providerId: 'fixture-b' }, { providerId: 'fixture-a' }]);
  assert.equal(r1.ok && r2.ok, true);
  assert.deepEqual(r1.pool.candidates, r2.pool.candidates, 'permuted channel descriptor order → identical fused candidates');
  assert.equal(r1.pool.candidates[0].identity.kind, 'candidate', 'canonical T06 candidate kind, not "first encountered"');
  assert.equal(r1.pool.candidates[0].identity.questionId, '100');
});

test('C4: auth_class persisted as adapter-bound channel provenance on ok AND failed channel records; never part of the RRF channel key (P2-3)', () => {
  const failingA = fixtureSearchAdapter('fixture-a', () => ({
    ok: false,
    provider_id: 'fixture-a',
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { reason: 'provider_failure' } },
  }));
  const okB = fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [failingA, okB] });
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], workDir: tmpWorkDir() });
  assert.equal(run.ok, true);

  const failedRec = run.pool.channels.find((c) => c.channel.providerId === 'fixture-a');
  assert.equal(failedRec.ok, false);
  assert.equal(failedRec.auth_class, AUTH_CLASS_OFFICIAL_SECRET, 'auth_class survives on failure channel records');
  const okRec = run.pool.channels.find((c) => c.channel.providerId === 'fixture-b');
  assert.equal(okRec.ok, true);
  assert.equal(okRec.auth_class, AUTH_CLASS_OFFICIAL_SECRET, 'auth_class survives on ok channel records');

  // auth_class is adapter-bound provenance and must NOT enter the RRF channel key:
  // the fused rank channel identity stays the §5.4 triple.
  assert.equal(run.pool.candidates.length, 1);
  const rankChannel = run.pool.candidates[0].ranks[0].channel;
  assert.deepEqual(rankChannel, { query: PLAN_SINGLE.queryVariants[0], providerId: 'fixture-b', capability: CAPABILITY_SEARCH });
  assert.ok(!('auth_class' in rankChannel), 'auth_class must not enter the RRF channel identity/key');
});

// ---------------------------------------------------------------------------
// D. provider failure propagation / fail-closed semantics
// ---------------------------------------------------------------------------

test('D1: provider failure is propagated machine-readable; sibling channels still execute exactly once (NO_SILENT_PROVIDER_FALLBACK)', () => {
  const failingA = fixtureSearchAdapter('fixture-a', () => ({
    ok: false,
    provider_id: 'fixture-a',
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider', provider_error_type: 'http_403' },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { reason: 'provider_failure' } },
  }));
  const okB = fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [failingA, okB] });
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    seam,
    channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }],
    workDir: tmpWorkDir(),
  });

  assert.equal(run.ok, true, 'one valid channel keeps the run valid');
  assert.equal(failingA.__calls(), 2, '2 queries × exactly one attempt per query — no silent retry, no substitution');
  assert.equal(okB.__calls(), 2);

  const failedChannel = run.pool.channels.find((c) => c.channel.providerId === 'fixture-a');
  assert.equal(failedChannel.ok, false);
  assert.deepEqual(failedChannel.failure, { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' }, 'P1-1 safe projection: only the machine-readable { code, class } identity survives');
  assert.ok(!('provider_error_type' in failedChannel.failure), 'arbitrary failure payload fields are dropped at the T06 boundary');
  assert.equal(failedChannel.channel.capability, CAPABILITY_SEARCH);

  assert.deepEqual(candidateIds(run.pool), ['100'], 'only valid channel contributes candidates');
});

test('D2: zero valid retrieval channels → FAIL CLOSED (retrieval_no_valid_channel)', () => {
  const failingA = fixtureSearchAdapter('fixture-a', () => ({
    ok: false,
    provider_id: 'fixture-a',
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { reason: 'provider_failure' } },
  }));
  const seam = createProviderSeam({ adapters: [failingA] });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir });

  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  assert.ok(run.details?.failedChannels?.length >= 1, 'failure identities reported for diagnostics');
  assert.equal(run.details.failedChannels[0].failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no pool artifact on fail-closed');
});

test('D3: zero registered retrieval channels (only capture adapter) → FAIL CLOSED without executing anything', () => {
  const capture = fixtureCaptureAdapter('zhihu-session-capture');
  const seam = createProviderSeam({ adapters: [capture] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  assert.equal(capture.__calls(), 0, 'capture adapter must not be invoked as a retrieval channel');
});

test('D4: malformed provider result (seam UNKNOWN_PROVIDER_CONTRACT) → FAIL CLOSED (retrieval_provider_contract_invalid)', () => {
  // adapter answers with a provider_id that does not match its registered identity →
  // the seam's identity-binding gate fails closed (UNKNOWN_PROVIDER_CONTRACT != PASS)
  const bad = fixtureSearchAdapter('fixture-a', () => ({ ...searchResult('fixture-b', [['100', 1]]), provider_id: 'fixture-b' }));
  const seamBad = createProviderSeam({ adapters: [bad] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam: seamBad, workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.code, SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT, 'known seam contract-error identity is machine-readable and safe to surface');
});

test('D5: provider items missing a valid rank → FAIL CLOSED (retrieval_provider_contract_invalid)', () => {
  const noRank = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1], ['200', undefined]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [noRank] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
});

test('D6: per-item provider failure is recorded in pool.rejected with its failure identity, never fused', () => {
  const withItemFailure = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [
    ['100', 1],
    ['99', 2, { failure: { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' } }],
  ], { query: input.query }));
  const seam = createProviderSeam({ adapters: [withItemFailure] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, true);
  assert.deepEqual(candidateIds(run.pool), ['100'], 'failed item is not fused');
  assert.equal(run.pool.rejected.length, 2, 'one rejected observation per query channel (2 queries → 2 channels)');
  for (const rejected of run.pool.rejected) {
    assert.equal(rejected.failure.code, 'SOURCE_URL_BOUNDARY_REJECTED');
    assert.equal(rejected.failure.class, 'boundary');
    assert.equal(rejected.channel.providerId, 'fixture-a');
    assert.equal(rejected.channel.capability, CAPABILITY_SEARCH);
  }
});

test('D7: seam adapter throwing an Error whose message embeds an absolute path → FAIL CLOSED with a stable reason; path AND arbitrary err.code are never echoed (P1-1 path-redaction counterexample)', () => {
  const THROWING_PATH = 'C:\\Users\\victim\\secret\\cache.json';
  const throwing = fixtureSearchAdapter('fixture-a', () => {
    const err = new Error(`ENOENT: no such file or directory, open '${THROWING_PATH}'`);
    err.code = 'ENOENT';
    throw err;
  });
  const seam = createProviderSeam({ adapters: [throwing] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'provider_contract_violation', 'stable reason, never the raw adapter err.message');
  assert.equal(run.details.code, null, 'an arbitrary adapter err.code is NOT a validated seam contract identity — never proxied (P1-1)');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(THROWING_PATH), 'adapter err.message must never surface (RULES §11 path-redaction)');
  assert.ok(!serialized.includes('ENOENT'), 'unvalidated adapter err.code must never surface (P1-1)');
});

test('D8: non-JSON-safe seam-accepted metadata (BigInt / cyclic fact) → FAIL CLOSED (retrieval_provider_contract_invalid); NO artifact written (P1-2)', () => {
  const bigIntFact = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { facts: { count: 10n } }]], { query: input.query }));
  const cyclic = {};
  cyclic.self = cyclic;
  const cyclicFact = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { facts: cyclic }]], { query: input.query }));
  for (const [label, adapter] of [['bigint', bigIntFact], ['cyclic', cyclicFact]]) {
    const seam = createProviderSeam({ adapters: [adapter] });
    const workDir = tmpWorkDir();
    const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir });
    assert.equal(run.ok, false, `${label}: non-JSON-safe seam-accepted metadata must fail closed, never escape runMultiQueryRetrieval`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, `${label}: contract failure identity`);
    // P1-2 mechanism note: the shared rrf boundary (projectSafeJson) now rejects
    // non-JSON-safe metadata during fusion projection — BEFORE pool assembly /
    // JSON.stringify — so the stable identity is the fusion-contract violation,
    // not a serialization failure. Same fail-closed contract, earlier intercept.
    assert.equal(run.details.reason, 'rrf_fusion_contract_violation', `${label}: stable projection/fusion failure reason (boundary intercepts before serialization)`);
    assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), `${label}: no artifact written when serialization fails`);
  }
});

test('D9: present-but-malformed explicit per-item failure (failure:"timeout") → FAIL CLOSED (retrieval_provider_contract_invalid); never fused as valid (P1-3)', () => {
  const malformedFailure = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { failure: 'timeout' }]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [malformedFailure] });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir });
  assert.equal(run.ok, false, 'malformed explicit per-item failure must fail closed, never fuse as a valid candidate');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'rrf_fusion_contract_violation');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact on fusion contract failure');
});

test('D10: mixed-success — failure detail carrying private paths / BigInt / cyclic metadata is projected to { code, class } only; the run stays valid (P1-1 safe projection)', () => {
  const SECRET_PATH = 'C:\\Users\\victim\\secret\\official-search-cache.json';
  const cyclicDetail = {};
  cyclicDetail.self = cyclicDetail;
  const failingA = fixtureSearchAdapter('fixture-a', () => ({
    ok: false,
    provider_id: 'fixture-a',
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: {
      code: 'PROVIDER_REPORTED_FAILURE',
      class: 'provider',
      provider_error_type: 'http_403',
      detail: SECRET_PATH,
      counter: 10n,
      nested: cyclicDetail,
    },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { reason: 'provider_failure' } },
  }));
  const okB = fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [failingA, okB] });
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], workDir: tmpWorkDir() });
  assert.equal(run.ok, true, 'one valid channel keeps the run valid — projected failure must not poison serialization');

  const failedChannel = run.pool.channels.find((c) => c.channel.providerId === 'fixture-a');
  assert.deepEqual(failedChannel.failure, { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' }, 'only the machine-readable { code, class } identity survives');
  const serialized = JSON.stringify(run.pool);
  assert.ok(!serialized.includes(SECRET_PATH), 'path-bearing detail must never reach the pool');
  assert.ok(!serialized.includes('provider_error_type'), 'arbitrary payload fields are dropped');
  assert.ok(!serialized.includes('http_403'), 'payload values are dropped');
});

test('D11: all channels failing with path-bearing / non-JSON-safe failure detail → FAIL CLOSED (retrieval_no_valid_channel) with safely projected identities; output stays JSON-serializable (P1-1)', () => {
  const SECRET_PATH = 'C:\\Users\\victim\\secret\\all-failed-cache.json';
  const cyclicDetail = {};
  cyclicDetail.self = cyclicDetail;
  const makeFailing = (providerId) => fixtureSearchAdapter(providerId, () => ({
    ok: false,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider', detail: SECRET_PATH, counter: 10n, nested: cyclicDetail },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { reason: 'provider_failure' } },
  }));
  const failingA = makeFailing('fixture-a');
  const failingB = makeFailing('fixture-b');
  const seam = createProviderSeam({ adapters: [failingA, failingB] });
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  // the all-failed early return bypasses the pool serialization guard — safe
  // projection must make it JSON-serializable anyway (no BigInt / cyclic throw).
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(SECRET_PATH), 'path-bearing detail must never leak into failure output');
  assert.ok(serialized.includes('PROVIDER_REPORTED_FAILURE'), 'machine-readable failure identity survives');
  assert.ok(run.details?.failedChannels?.length === 2, 'both failing channels reported');
  for (const fc of run.details.failedChannels) {
    assert.deepEqual(fc.failure, { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' });
  }
});

test('D12: contradictory ok:true + top-level failure → FAIL CLOSED (retrieval_provider_contract_invalid), never fused (P1-2)', () => {
  const SECRET_PATH = 'C:\\Users\\victim\\secret\\ok-failure.json';
  const contradictoryObj = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], {
    query: input.query,
    ok: true,
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider', detail: SECRET_PATH },
  }));
  // even failure:null is "present" (hasOwnProperty) — absent ≠ present-but-null
  const contradictoryNull = fixtureSearchAdapter('fixture-b', () => ({ ...searchResult('fixture-b', [['100', 1]]), failure: null }));
  for (const adapter of [contradictoryObj, contradictoryNull]) {
    const seam = createProviderSeam({ adapters: [adapter] });
    const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir: tmpWorkDir() });
    assert.equal(run.ok, false, 'contradictory ok:true + failure must fail closed, never fuse');
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
    assert.equal(run.details.reason, 'provider_contract_violation');
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes(SECRET_PATH), 'contradictory result detail must never leak');
  }
});

test('D13: within-channel duplicate questionId → FAIL CLOSED (retrieval_provider_contract_invalid); independent of item array order (P1-4)', () => {
  const dupFirst = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1], ['100', 5]], { query: input.query }));
  const dupSecond = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 5], ['100', 1]], { query: input.query }));
  for (const adapter of [dupFirst, dupSecond]) {
    const seam = createProviderSeam({ adapters: [adapter] });
    const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir: tmpWorkDir() });
    assert.equal(run.ok, false);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
    assert.equal(run.details.reason, 'rrf_fusion_contract_violation', 'rrf hard FUSION_DUPLICATE_IN_CHANNEL surfaced as a fail-closed contract failure');
  }
});

test('D14: pool.rejected is canonical — permuted channel descriptors + permuted item order produce an identical rejected list (P1-5)', () => {
  const build = (descriptors, aOrder) => {
    const seam = createProviderSeam({
      adapters: [
        fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', aOrder, { query: input.query })),
        fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['77', 1, { failure: { code: 'CANDIDATE_IDENTITY_INVALID', class: 'contract' } }]], { query: input.query })),
      ],
    });
    return runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, channels: descriptors, workDir: tmpWorkDir() });
  };
  const r1 = build(
    [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }],
    [['10', 1], ['99', 2, { failure: { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' } }]],
  );
  const r2 = build(
    [{ providerId: 'fixture-b' }, { providerId: 'fixture-a' }],
    [['99', 2, { failure: { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' } }], ['10', 1]],
  );
  assert.equal(r1.ok && r2.ok, true);
  assert.deepEqual(r1.pool.rejected, r2.pool.rejected, 'rejected list is permutation-invariant across channel descriptor + item order');
  assert.deepEqual(r1.pool.rejected.map((r) => r.channel.providerId), ['fixture-a', 'fixture-b'], 'canonical stable-key order');
});

test('D15: provider item with a non-JSON-safe malformed rank (BigInt) → FAIL CLOSED with the FUSION code surviving safe formatting (retrieval_provider_contract_invalid) (P2-2)', () => {
  const bigIntRank = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1n]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [bigIntRank] });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'rrf_fusion_contract_violation', 'RANK_INVALID code survives — JSON.stringify of the BigInt rank must not erase it');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact on fusion contract failure');
});

// ---------------------------------------------------------------------------
// E. Session capture cannot masquerade as a retrieval-ranked channel
// ---------------------------------------------------------------------------

test('E1: channel descriptor with capability != search → FAIL CLOSED (retrieval_channel_not_retrieval_ranked)', () => {
  const capture = fixtureCaptureAdapter('zhihu-session-capture');
  const search = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [capture, search] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, channels: [{ providerId: 'zhihu-session-capture', capability: CAPABILITY_CAPTURE }], workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_CHANNEL_NOT_RETRIEVAL_RANKED);
  assert.equal(capture.__calls(), 0);
});

test('E2: registered capture adapter is never invoked by multi-query retrieval (no masquerade path)', () => {
  const capture = fixtureCaptureAdapter('zhihu-session-capture');
  const search = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [capture, search] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, true);
  assert.equal(capture.__calls(), 0, 'capture capability is never routed as a retrieval-ranked channel');
  assert.ok(run.pool.channels.every((c) => c.channel.capability === CAPABILITY_SEARCH));
});

test('E3: multiple search providers without explicit channel descriptors → FAIL CLOSED (D-2 routing stays OPEN; no guessing)', () => {
  const search = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const search2 = fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['200', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [search, search2] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  assert.equal(run.details?.reason, 'multiple_search_providers_without_explicit_channels');
  assert.equal(search.__calls(), 0, 'nothing executes before the ambiguity is resolved explicitly');
});

// ---------------------------------------------------------------------------
// F. input / identity contracts
// ---------------------------------------------------------------------------

test('F1: nonexistent explicit providerId → FAIL CLOSED (retrieval_channel_unregistered)', () => {
  const seam = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, channels: [{ providerId: 'ghost-provider' }], workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_CHANNEL_UNREGISTERED);
});

test('F2: duplicate channel descriptors → FAIL CLOSED (retrieval_channel_duplicate)', () => {
  const seam = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))] });
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    seam,
    channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-a' }],
    workDir: tmpWorkDir(),
  });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_CHANNEL_DUPLICATE);
});

test('F3: planHash identity mismatch → FAIL CLOSED (retrieval_plan_identity_mismatch)', () => {
  const seam = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))] });
  const run = runMultiQueryRetrieval({ plan: PLAN, planHash: 'f'.repeat(64), seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH);
  assert.equal(run.details.reason, 'plan_identity_mismatch');
  assert.ok(!('provided' in run.details), 'the supplied planHash value is never echoed (P1-3)');
});

test('F9: malformed caller-supplied planHash (path/credential-shaped) → FAIL CLOSED with stable malformed info; the supplied value is never echoed (P1-3)', () => {
  const search = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [search] });
  const PATHISH = 'C:\\Users\\victim\\secret\\plan-hash.txt';
  const CREDISH = 'z_c0=someSecretCookieValue';
  for (const bad of [PATHISH, CREDISH, 'not-a-hash', 'ABCDEF']) {
    const run = runMultiQueryRetrieval({ plan: PLAN, planHash: bad, seam, workDir: tmpWorkDir() });
    assert.equal(run.ok, false, `planHash: ${bad}`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH);
    assert.equal(run.details.reason, 'expected_plan_hash_malformed');
    assert.equal(run.details.expectedFormat, '64-lowercase-hex-sha256');
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes(bad), `the supplied malformed planHash must never be echoed (${bad})`);
  }
  assert.equal(search.__calls(), 0, 'no provider IO for a malformed plan identity');
});

test('F4: invalid plan → FAIL CLOSED (retrieval_plan_invalid); nothing persisted, nothing executed', () => {
  const search = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [search] });
  const contractInvalidPlans = [
    { schemaVersion: 1, queryVariants: [], aspects: [], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] }, // queryVariants empty
    { schemaVersion: 1, queryVariants: ['q'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] }, // aspects missing
  ];
  for (const badPlan of contractInvalidPlans) {
    const run = runMultiQueryRetrieval({ plan: badPlan, seam, workDir: tmpWorkDir() });
    assert.equal(run.ok, false, `plan: ${JSON.stringify(badPlan)}`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PLAN_INVALID);
    assert.ok(Array.isArray(run.details?.issues) && run.details.issues.length > 0, 'T04 validation issues surfaced');
  }
  // non-object plan values are module-input failures (distinct machine-readable identity)
  for (const notAPlan of ['not a plan', null]) {
    const run = runMultiQueryRetrieval({ plan: notAPlan, seam, workDir: tmpWorkDir() });
    assert.equal(run.ok, false);
    assert.equal(run.reason, RETRIEVAL_FAILURE_INVALID_INPUT);
  }
  assert.equal(search.__calls(), 0, 'no channel executes for an invalid plan');
});

test('F5: missing/invalid module inputs → FAIL CLOSED (retrieval_invalid_input)', () => {
  const seam = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))] });
  for (const args of [
    { seam, workDir: tmpWorkDir() },                     // plan missing
    { plan: PLAN, workDir: tmpWorkDir() },               // seam missing
    { plan: PLAN, seam, workDir: '' },                   // workDir empty
    { plan: PLAN, seam, workDir: null },                 // workDir null
  ]) {
    const run = runMultiQueryRetrieval(args);
    assert.equal(run.ok, false, JSON.stringify(Object.keys(args)));
    assert.equal(run.reason, RETRIEVAL_FAILURE_INVALID_INPUT);
  }
  // P2-1: null / non-object options must fail closed (retrieval_invalid_input),
  // never throw a TypeError from destructuring.
  for (const badOpts of [null, undefined, 'not-an-object', 42]) {
    const run = runMultiQueryRetrieval(badOpts);
    assert.equal(run.ok, false, `opts: ${String(badOpts)}`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_INVALID_INPUT);
  }
});

test('F7: top-level malformed channels (object/null/string/number) → FAIL CLOSED (retrieval_invalid_input) BEFORE any provider call — P1-1', () => {
  const search = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [search] });
  for (const channels of [{ providerId: 'ghost' }, null, 'zhihu-official-search', 42]) {
    const run = runMultiQueryRetrieval({ plan: PLAN, seam, channels, workDir: tmpWorkDir() });
    assert.equal(run.ok, false, `channels: ${JSON.stringify(channels)}`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_INVALID_INPUT, `channels: ${JSON.stringify(channels)}`);
  }
  assert.equal(search.__calls(), 0, 'zero provider retrieve calls for top-level malformed channels (fail-closed before any IO)');
});

test('F8: empty channels array is legal (omitted-equivalent) and routes the unambiguous single search provider — P1-1', () => {
  const search = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [search] });
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, channels: [], workDir: tmpWorkDir() });
  assert.equal(run.ok, true);
  assert.deepEqual(run.pool.channels.map((c) => c.channel.providerId), ['fixture-a']);
  assert.equal(search.__calls(), 1, 'single unambiguous provider routed exactly once');
});

test('F6: pool criteria documents the RRF contract (k / rank source / tie break / single pass)', () => {
  const seam = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))] });
  const run = runMultiQueryRetrieval({ plan: PLAN, planHash: PLAN_HASH, seam, workDir: tmpWorkDir() });
  assert.equal(run.pool.criteria.rrfK, 60);
  assert.equal(run.pool.criteria.rankSource, 'provenance.rank');
  assert.equal(run.pool.criteria.tieBreak, 'score-desc-questionId-asc');
  assert.equal(run.pool.criteria.scope, 'single-pass');
  assert.equal(run.pool.criteria.fusion, 'rrf');
});

test('G1: pool artifact carries no absolute machine paths (work-relative only)', () => {
  const seam = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))] });
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir: tmpWorkDir() });
  const serialized = JSON.stringify(run.pool);
  assert.ok(!/[A-Za-z]:[\\/]/.test(serialized), 'no Windows absolute paths');
  assert.ok(!serialized.includes('/Users/') && !serialized.includes('/home/'), 'no POSIX machine-private paths');
});

test('G2: pool write failure → RETRIEVAL_FAILURE_POOL_WRITE with sanitized reason; the absolute workDir never leaks into failure output (P1-1 path-redaction counterexample)', () => {
  const seam = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))] });
  // workDir points at an existing FILE → mkdirSync throws EEXIST with the
  // absolute path embedded in err.message (deterministic, platform-independent).
  const base = tmpWorkDir();
  const blocker = path.join(base, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir: blocker });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_POOL_WRITE);
  assert.equal(run.details.reason, 'pool_write_failed', 'stable sanitized reason, never the raw fs err.message');
  assert.equal(run.details.file, RETRIEVAL_POOL_FILENAME, 'work-relative artifact name only');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(blocker), 'absolute workDir must never leak into failure output (RULES §11)');
  assert.ok(!/[A-Za-z]:[\\/]/.test(serialized), 'no Windows absolute paths in failure output');
});

test('G3: malformed channels/descriptors carrying machine-private-looking values are never echoed into failure details (P1-1 path-redaction counterexample)', () => {
  const search = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const seam = createProviderSeam({ adapters: [search] });
  const SECRET_PATH = 'C:\\Users\\victim\\secret\\token.txt';
  const cases = [
    { channels: SECRET_PATH, reason: RETRIEVAL_FAILURE_INVALID_INPUT },
    { channels: [SECRET_PATH], reason: RETRIEVAL_FAILURE_INVALID_INPUT },
    { channels: [{ providerId: SECRET_PATH }], reason: RETRIEVAL_FAILURE_CHANNEL_UNREGISTERED },
    { channels: [{ providerId: 'fixture-a', capability: SECRET_PATH }], reason: RETRIEVAL_FAILURE_CHANNEL_NOT_RETRIEVAL_RANKED },
  ];
  for (const { channels, reason } of cases) {
    const run = runMultiQueryRetrieval({ plan: PLAN, seam, channels, workDir: tmpWorkDir() });
    assert.equal(run.ok, false, `channels case must fail closed: ${reason}`);
    assert.equal(run.reason, reason);
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes(SECRET_PATH), `raw malformed channel/descriptor value must never be echoed (${reason})`);
  }
  assert.equal(search.__calls(), 0, 'zero provider IO for all malformed channel inputs (fail closed before execution)');
});

// ---------------------------------------------------------------------------
// H. review 5076691874 repairs — per-item projection / completeness boundary / registry guard
// ---------------------------------------------------------------------------

test('H1: ok channel — completeness evidence embedding a machine-private path → FAIL CLOSED (retrieval_provider_contract_invalid); no artifact, no leak (P1-2 review 5076691874)', () => {
  const SECRET_PATH = 'C:\\Users\\victim\\secret\\official-search-cache.json';
  const unsafeOk = fixtureSearchAdapter('fixture-a', (input) => ({
    ...searchResult('fixture-a', [['100', 1]], { query: input.query }),
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { reason: SECRET_PATH } },
  }));
  const seam = createProviderSeam({ adapters: [unsafeOk] });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir });

  assert.equal(run.ok, false, 'unsafe completeness evidence must fail closed — never bare-stored into the pool');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'provider_contract_violation');
  assert.equal(run.details.completenessIssue, 'completeness_evidence_unsafe', 'stable completeness issue identity');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(SECRET_PATH), 'machine-private path must never reach failure output (RULES §11)');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact when completeness evidence is unsafe');
});

test('H2: failed channel — completeness evidence embedding a credential-shaped diagnostic → FAIL CLOSED (retrieval_provider_contract_invalid); never persists the credential shape (P1-2 review 5076691874)', () => {
  const CREDISH = 'z_c0=someSecretCookieValue';
  const unsafeFail = fixtureSearchAdapter('fixture-a', () => ({
    ok: false,
    provider_id: 'fixture-a',
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { reason: CREDISH } },
  }));
  const seam = createProviderSeam({ adapters: [unsafeFail] });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir });

  assert.equal(run.ok, false, 'unsafe completeness evidence on a failed channel must fail closed too — completeness semantics are never silently dropped');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.completenessIssue, 'completeness_evidence_unsafe');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(CREDISH), 'credential-shaped diagnostic must never reach output or the pool');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written');
});

test('H3: safe completeness evidence is preserved as-is on ok AND failed channel records — status + evidence deepEqual (P1-2 control)', () => {
  const okA = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const failingB = fixtureSearchAdapter('fixture-b', () => ({
    ok: false,
    provider_id: 'fixture-b',
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' },
    completeness: { status: COMPLETENESS_PARTIAL, evidence: { basis: 'fixture', reason: 'pagination_signal_lost' } },
  }));
  const seam = createProviderSeam({ adapters: [okA, failingB] });
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], workDir: tmpWorkDir() });
  assert.equal(run.ok, true);

  const okRec = run.pool.channels.find((c) => c.channel.providerId === 'fixture-a');
  assert.deepEqual(
    okRec.completeness,
    { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
    'safe ok-channel evidence preserved verbatim',
  );
  const failedRec = run.pool.channels.find((c) => c.channel.providerId === 'fixture-b');
  assert.deepEqual(
    failedRec.completeness,
    { status: COMPLETENESS_PARTIAL, evidence: { basis: 'fixture', reason: 'pagination_signal_lost' } },
    'safe failed-channel evidence preserved verbatim',
  );
  assert.deepEqual(failedRec.failure, { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' });
});

test('H4: successful provider result with a rejected item whose failure embeds machine-private diagnostics → pool.rejected retains { code, class } ONLY (P1-1 review 5076691874)', () => {
  const SECRET_PATH = 'C:\\Users\\victim\\secret\\boundary-reject.json';
  const CREDISH = 'z_c0=someSecretCookieValue';
  const withUnsafeItemFailure = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [
    ['100', 1],
    ['99', 2, { failure: { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary', detail: SECRET_PATH, stderr: CREDISH } }],
  ], { query: input.query }));
  const seam = createProviderSeam({ adapters: [withUnsafeItemFailure] });
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir: tmpWorkDir() });

  assert.equal(run.ok, true, 'the run stays valid — the rejected observation is projected, not fatal');
  assert.deepEqual(candidateIds(run.pool), ['100'], 'the rejected item is never fused');
  assert.equal(run.pool.rejected.length, 1);
  assert.deepEqual(
    run.pool.rejected[0].failure,
    { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' },
    'pool.rejected only retains the allowed safe machine identity { code, class }',
  );
  const serialized = JSON.stringify(run.pool);
  assert.ok(!serialized.includes(SECRET_PATH), 'path-bearing diagnostic must never reach the persisted pool');
  assert.ok(!serialized.includes(CREDISH), 'credential-shaped diagnostic must never reach the persisted pool');
});

test('H5: throwing seam.listProviders() → FAIL CLOSED (retrieval_provider_contract_invalid); no raw throw, no provider retrieval IO (P2 review 5076691874)', () => {
  const THROW_MSG = 'registry exploded: ENOENT secret/cache.json';
  let retrieveCalls = 0;
  const seam = {
    listProviders() {
      throw new Error(THROW_MSG);
    },
    retrieve() {
      retrieveCalls += 1;
      return searchResult('fixture-a', [['100', 1]]);
    },
  };
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir: tmpWorkDir() });

  assert.equal(run.ok, false, 'a throwing registry inspection must never produce a raw throw');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'provider_contract_violation');
  assert.equal(run.details.registryIssue, 'inspection_threw', 'stable registry issue identity');
  assert.equal(retrieveCalls, 0, 'no provider retrieval IO after a throwing registry inspection');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(THROW_MSG), 'raw registry-inspection error must never be echoed');
});

test('H6: malformed non-array registry (object / null / string) → FAIL CLOSED (retrieval_provider_contract_invalid); no provider retrieval IO (P2 review 5076691874)', () => {
  for (const [label, registry] of [['object', { a: 1 }], ['null', null], ['string', 'not-a-registry']]) {
    let retrieveCalls = 0;
    const seam = {
      listProviders() {
        return registry;
      },
      retrieve() {
        retrieveCalls += 1;
        return searchResult('fixture-a', [['100', 1]]);
      },
    };
    const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir: tmpWorkDir() });
    assert.equal(run.ok, false, `${label} registry must fail closed, never a raw throw`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, label);
    assert.equal(run.details.registryIssue, 'not_an_array', label);
    assert.equal(retrieveCalls, 0, `${label}: no provider retrieval IO`);
  }
});

test('H7: malformed registry entries (null / non-object / missing or non-string identity fields) → FAIL CLOSED (retrieval_provider_contract_invalid); no provider retrieval IO (P2 review 5076691874)', () => {
  const malformedRegistries = [
    [null],
    [42],
    [{ providerId: 'fixture-a' }], // capability missing
    [{ capability: CAPABILITY_SEARCH }], // providerId missing
    [{ providerId: 'fixture-a', capability: 7 }], // non-string capability
    [{ providerId: '', capability: CAPABILITY_SEARCH }], // empty providerId
  ];
  for (const registry of malformedRegistries) {
    let retrieveCalls = 0;
    const seam = {
      listProviders() {
        return registry;
      },
      retrieve() {
        retrieveCalls += 1;
        return searchResult('fixture-a', [['100', 1]]);
      },
    };
    const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir: tmpWorkDir() });
    assert.equal(run.ok, false, `registry ${JSON.stringify(registry)} must fail closed, never a raw throw`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
    assert.equal(run.details.registryIssue, 'malformed_entry');
    assert.equal(retrieveCalls, 0, 'no provider retrieval IO for a malformed registry');
  }
});

// ---------------------------------------------------------------------------
// I. P1-T06 integration-level adversarial matrix — review 5077286260
//    (P1-4 source_url credentials / P2-1 whole-result pre-validation / P2-2
//    non-plain + prototype-mutating structures / P1-3 issue-path projection)
// ---------------------------------------------------------------------------

test('I1: provider item with a credential-bearing source_url record (P1-4) → FAIL CLOSED (retrieval_provider_contract_invalid); the URL never reaches the pool or the output; no artifact', () => {
  // A structurally VALID §5.1 source_url record (passes the seam's own
  // structural gate: https + url string + securityClass) whose query carries a
  // credential-sensitive key — the rrf boundary (projectSourceUrlRecord) must
  // reject it during projection, BEFORE it can reach the persisted pool.
  const adapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [
    ['100', 1, { source_url: { url: 'https://example.invalid/?token=super-secret', securityClass: 'official-secret' } }],
  ], { query: input.query }));
  const seam = createProviderSeam({ adapters: [adapter] });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir });
  assert.equal(run.ok, false, 'credential-bearing source_url must fail closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'rrf_fusion_contract_violation', 'the shared rrf boundary rejects the URL during projection');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes('super-secret'), 'credential value must never surface');
  assert.ok(!serialized.includes('token='), 'credential-shaped URL must never surface');
});

test('I2: a method-compatible injected seam returning null / undefined / primitive results (P2-1) → FAIL CLOSED (retrieval_provider_contract_invalid) via the whole-result pre-validation; no raw TypeError escapes, no artifact', () => {
  // Hand-rolled seam that does NOT validate (bypasses createProviderSeam's
  // contract gate) — exercises retrieval.mjs's own safeValidateProviderResult
  // defense-in-depth immediately after seam.retrieve() returns.
  function rawResultSeam(result) {
    return {
      listProviders() {
        // Full registry identity (P1 review 5078267886: entries must carry
        // authClass) so the injected seam reaches seam.retrieve() and the
        // P2-1 whole-result pre-validation is what rejects the raw result.
        return [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET }];
      },
      retrieve() {
        return result;
      },
    };
  }
  for (const [label, result] of [
    ['null', null],
    ['undefined', undefined],
    ['number primitive', 42],
    ['string primitive', 'plain-string'],
  ]) {
    const workDir = tmpWorkDir();
    const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: rawResultSeam(result), workDir });
    assert.equal(run.ok, false, `${label} result must fail closed`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, `${label}: contract failure identity`);
    assert.equal(run.details.reason, 'provider_contract_violation', `${label}: stable reason, no raw payload echo`);
    assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), `${label}: no artifact written`);
  }
});

test('I3: seam-accepted facts carrying non-plain / prototype-mutating structures (P2-2) → FAIL CLOSED (retrieval_provider_contract_invalid); never collapsed, never persisted, no artifact', () => {
  const classFactsAdapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [
    ['100', 1, { facts: { d: new Date() } }],
  ], { query: input.query }));
  const protoFactsAdapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [
    ['100', 1, { facts: JSON.parse('{"__proto__": {"polluted": true}}') }],
  ], { query: input.query }));
  for (const [label, adapter] of [['class-instance facts', classFactsAdapter], ['__proto__-key facts', protoFactsAdapter]]) {
    const seam = createProviderSeam({ adapters: [adapter] });
    const workDir = tmpWorkDir();
    const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir });
    assert.equal(run.ok, false, `${label} must fail closed`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
    assert.equal(run.details.reason, 'rrf_fusion_contract_violation', `${label}: shared boundary rejects during projection`);
    assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), `${label}: no artifact written`);
  }
});

test('I4: plan-validation issues carrying caller-controlled unknown property names are projected to the stable <unknown> placeholder (P1-3); known schema paths are preserved; the raw name is never echoed', () => {
  const EVIL = '/home/private-user/x';
  const plan = {
    schemaVersion: 1,
    queryVariants: ['q'],
    aspects: ['a'],
    entities: [],
    opposingFramings: [],
    // BOTH an unknown caller-controlled key AND a known-schema violation
    // (empty term) so the projection must preserve the known path while
    // replacing the unknown segment with '<unknown>'.
    terminologyVariants: [{ term: '', variants: ['v'], [EVIL]: 1 }],
    sourceGroupIntents: [],
  };
  const run = runMultiQueryRetrieval({ plan, seam: { retrieve() {}, listProviders() {} }, workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PLAN_INVALID);
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(EVIL), 'caller-controlled unknown property name must never be echoed');
  assert.ok(serialized.includes('<unknown>'), 'the stable placeholder is used instead of the raw name');
  assert.ok(serialized.includes('terminologyVariants[0].term'), 'known plan-contract schema paths are preserved');
});


// ---------------------------------------------------------------------------
// J. P1-T06 second repair round (external review 5078267886 / Codex 5078133293)
//    — e2e counterexamples: compound credential keys (P1), URL trust classifier
//    reuse (P1), provider result identity binding (P1), all-provider-failed
//    coverage auditability (P2).
// ---------------------------------------------------------------------------

test('J1: seam-accepted facts carrying a COMPOUND / camelCase credential key (accessToken / refreshToken / clientSecret / sessionCookie) (P1 review 5078267886) → FAIL CLOSED (retrieval_provider_contract_invalid); never persisted, no artifact, no key/value leak', () => {
  for (const [label, key] of [
    ['accessToken', 'accessToken'],
    ['refreshToken', 'refreshToken'],
    ['clientSecret', 'clientSecret'],
    ['sessionCookie', 'sessionCookie'],
    ['accessKeyId', 'accessKeyId'],
    ['secretAccessKey', 'secretAccessKey'],
    ['jwtToken', 'jwtToken'],
  ]) {
    const SECRET_VALUE = `super-${label}-value`;
    const adapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [
      ['100', 1, { facts: { [key]: SECRET_VALUE } }],
    ], { query: input.query }));
    const seam = createProviderSeam({ adapters: [adapter] });
    const workDir = tmpWorkDir();
    const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir });
    assert.equal(run.ok, false, `${label}: compound credential key must fail closed`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, `${label}: contract failure identity`);
    assert.equal(run.details.reason, 'rrf_fusion_contract_violation', `${label}: shared rrf boundary rejects during projection`);
    assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), `${label}: no artifact written`);
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes(SECRET_VALUE), `${label}: credential value must never surface`);
    assert.ok(!serialized.includes(key), `${label}: credential key name must never surface`);
  }
});

test('J2: provider source_url on a localhost / loopback / private / link-local host is structurally valid at the seam but REJECTED by the repository classifyUrl trust classifier (P1 review 5078267886) → FAIL CLOSED, never persisted, no artifact', () => {
  for (const [label, url] of [
    ['localhost', 'https://localhost/internal'],
    ['IPv4 loopback', 'https://127.0.0.1/internal'],
    ['IPv4 private 10/8', 'https://10.0.0.1/internal'],
    ['IPv4 private 192.168/16', 'https://192.168.1.1/internal'],
    ['IPv4 link-local', 'https://169.254.169.254/latest/meta-data'],
    ['IPv6 loopback', 'https://[::1]/internal'],
  ]) {
    const adapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [
      ['100', 1, { source_url: { url, securityClass: 'official-secret' } }],
    ], { query: input.query }));
    const seam = createProviderSeam({ adapters: [adapter] });
    const workDir = tmpWorkDir();
    const run = runMultiQueryRetrieval({ plan: PLAN, seam, workDir });
    assert.equal(run.ok, false, `${label}: unsafe host source_url must fail closed`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, `${label}: contract failure identity`);
    assert.equal(run.details.reason, 'rrf_fusion_contract_violation', `${label}: shared rrf boundary (classifyUrl reuse) rejects during projection`);
    assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), `${label}: no artifact written`);
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes(url), `${label}: unsafe URL must never surface`);
  }
});

test('J3: provider result identity NOT bound to the resolved registry/channel — drifted provider_id / capability / auth_class (P1 review 5078267886) → FAIL CLOSED (retrieval_provider_contract_invalid) even when the §5.1 structure is valid; the drifted identity is never echoed', () => {
  // Injected seam bypassing createProviderSeam's own binding gate
  // (assertResultIdentityBound) — exercises retrieval.mjs's OWN binding check
  // right after the whole-result pre-validation, on a structurally VALID result.
  function rawSeam(result) {
    return {
      listProviders() {
        return [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET }];
      },
      retrieve() {
        return result;
      },
    };
  }
  const drifts = [
    ['provider_id drift', { provider_id: 'fixture-b' }],
    ['capability drift', { capability: CAPABILITY_CAPTURE }],
    ['auth_class drift', { auth_class: AUTH_CLASS_SESSION }],
  ];
  for (const [label, patch] of drifts) {
    const base = searchResult('fixture-a', [['100', 1]]);
    const result = { ...base, ...patch };
    const workDir = tmpWorkDir();
    const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: rawSeam(result), workDir });
    assert.equal(run.ok, false, `${label}: drifted result identity must fail closed`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, `${label}: contract failure identity`);
    assert.equal(run.details.reason, 'provider_contract_violation', `${label}: stable reason, no raw echo`);
    assert.ok(String(run.details.note).includes('bind'), `${label}: binding note present`);
    assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), `${label}: no artifact written`);
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes('fixture-b'), `${label}: drifted provider_id never surfaces`);
    assert.ok(!serialized.includes(AUTH_CLASS_SESSION), `${label}: drifted auth_class never surfaces`);
    assert.ok(!serialized.includes(CAPABILITY_CAPTURE), `${label}: drifted capability never surfaces`);
  }
});

test('J4: ALL providers failed → the no_valid_channel early return RETAINS safely projected channel + auth_class + retrievedAt + completeness + failure for every failed channel (P2 review 5078267886); retrieval coverage stays auditable; raw failure detail never leaks', () => {
  const SECRET_DETAIL = '/home/private-user/secret/cache.json';
  function failResult(providerId) {
    return {
      ok: false,
      provider_id: providerId,
      capability: CAPABILITY_SEARCH,
      auth_class: AUTH_CLASS_OFFICIAL_SECRET,
      retrieved_at: FIXED_NOW(),
      items: [],
      failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider', detail: SECRET_DETAIL },
      completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'no_pagination_signal' } },
    };
  }
  const adapterA = fixtureSearchAdapter('fixture-a', () => failResult('fixture-a'));
  const adapterB = fixtureSearchAdapter('fixture-b', () => failResult('fixture-b'));
  const seam = createProviderSeam({ adapters: [adapterA, adapterB] });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], workDir });

  assert.equal(run.ok, false, 'all-failed must fail closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  const failed = run.details.failedChannels;
  assert.equal(failed.length, 2, 'BOTH failing channels reported with full projected identity');
  for (const fc of failed) {
    assert.ok(fc.channel && fc.channel.providerId && fc.channel.capability, 'channel identity retained');
    assert.equal(fc.channel.capability, CAPABILITY_SEARCH);
    assert.equal(fc.auth_class, AUTH_CLASS_OFFICIAL_SECRET, 'registry-bound auth_class retained');
    assert.equal(fc.retrievedAt, FIXED_NOW(), 'retrievedAt retained');
    assert.deepEqual(fc.completeness, { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'no_pagination_signal' } }, 'projected completeness retained');
    assert.deepEqual(fc.failure, { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' }, 'failure retained as the canonical { code, class } identity — raw detail projected away');
    assert.ok(!('detail' in fc.failure), 'raw failure detail never survives projection');
  }
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written on all-failed');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(SECRET_DETAIL), 'path-bearing failure detail must never surface');
});

test('J5: provider registry with DUPLICATE (providerId, capability) identities — including entries carrying DIFFERENT authClass values (P2 review 5078133293) → FAIL CLOSED (retrieval_provider_contract_invalid) before any provider IO; no artifact', () => {
  const seam = {
    listProviders() {
      return [
        { providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
        { providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_SESSION },
      ];
    },
    retrieve() {
      throw new Error('provider IO must not be performed on a duplicate registry identity');
    },
  };
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir });
  assert.equal(run.ok, false, 'duplicate registry identity must fail closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'provider_contract_violation');
  assert.equal(run.details.registryIssue, 'duplicate_identity');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written');
});

test('J6: shape-valid registry identities that are machine-private PATH-SHAPED (P1 review 5078133293) are REDACTED to the stable <redacted> placeholder in failure details — the absolute path never surfaces; no artifact', () => {
  const REGISTRY_PATH = '/home/private-user/provider';
  const seam = {
    listProviders() {
      return [
        { providerId: `${REGISTRY_PATH}-a`, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
        { providerId: `${REGISTRY_PATH}-b`, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
      ];
    },
    retrieve() {
      throw new Error('provider IO must not be performed before channel resolution');
    },
  };
  const workDir = tmpWorkDir();
  // no explicit channels → multiple search providers → the failure details expose `candidates`
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  assert.equal(run.details.reason, 'multiple_search_providers_without_explicit_channels');
  assert.deepEqual(run.details.candidates, ['<redacted>', '<redacted>'], 'path-shaped registry identities are redacted, never echoed raw');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(REGISTRY_PATH), 'the absolute registry path never surfaces');
  assert.ok(serialized.includes('<redacted>'), 'the stable redaction placeholder is what surfaces instead');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written');
});

test('J7: provider rank beyond Number.MAX_SAFE_INTEGER (P2 review 5078133293) → FAIL CLOSED (retrieval_provider_contract_invalid) at the fusion rank gate — a JS-rounded rank can never be a verifiable RRF score; no artifact', () => {
  function rawSeam(items) {
    return {
      listProviders() {
        return [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET }];
      },
      retrieve() {
        return {
          ok: true,
          provider_id: 'fixture-a',
          capability: CAPABILITY_SEARCH,
          auth_class: AUTH_CLASS_OFFICIAL_SECRET,
          retrieved_at: FIXED_NOW(),
          items,
          completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'no_pagination_signal' } },
        };
      },
    };
  }
  // 9007199254740993 has ALREADY been rounded by JavaScript to ...992 — beyond
  // MAX_SAFE_INTEGER, so two distinct upstream ranks could collapse onto one
  // value; the rank gate must reject it (Number.isInteger alone would accept).
  const UNSAFE_RANK = Number.MAX_SAFE_INTEGER + 1;
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({
    plan: PLAN_SINGLE,
    seam: rawSeam([{ identity: { questionId: '100' }, provenance: { rank: UNSAFE_RANK } }]),
    workDir,
  });
  assert.equal(run.ok, false, 'non-safe-integer rank must fail closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'rrf_fusion_contract_violation');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written');
});

test('J8: ALL-provider-failed early return with a machine-private PATH-SHAPED providerId (P1 review 5078133293, 2nd round) → the channel identity is projected through projectFailureIdentity to <redacted>; the absolute path never surfaces in the failure result', () => {
  const REGISTRY_PATH = '/home/private-user/provider';
  function failResult(providerId) {
    return {
      ok: false,
      provider_id: providerId,
      capability: CAPABILITY_SEARCH,
      auth_class: AUTH_CLASS_OFFICIAL_SECRET,
      retrieved_at: FIXED_NOW(),
      items: [],
      failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' },
      completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'no_pagination_signal' } },
    };
  }
  const seam = {
    listProviders() {
      return [
        { providerId: `${REGISTRY_PATH}-a`, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
        { providerId: `${REGISTRY_PATH}-b`, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
      ];
    },
    retrieve(_capability, _params, ctx) {
      return failResult(ctx.providerId);
    },
  };
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({
    plan: PLAN_SINGLE,
    seam,
    channels: [{ providerId: `${REGISTRY_PATH}-a` }, { providerId: `${REGISTRY_PATH}-b` }],
    workDir,
  });
  assert.equal(run.ok, false, 'all-failed must fail closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  const failed = run.details.failedChannels;
  assert.equal(failed.length, 2, 'BOTH failing channels reported');
  for (const fc of failed) {
    assert.equal(fc.channel.providerId, '<redacted>', 'path-shaped providerId is redacted in the all-failed channel identity');
    assert.equal(fc.channel.capability, CAPABILITY_SEARCH, 'capability identity retained');
    assert.equal(fc.auth_class, AUTH_CLASS_OFFICIAL_SECRET, 'registry-bound auth_class retained');
  }
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes(REGISTRY_PATH), 'the absolute registry path never surfaces in the failure result');
  assert.ok(serialized.includes('<redacted>'), 'the stable redaction placeholder surfaces instead');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written');
});

test('J9: INTERMEDIATE failure paths with a machine-private PATH-SHAPED channel providerId (independent review P1 on f742cb3) → EVERY failure echo of the channel projects providerId through projectFailureIdentity to <redacted>; the absolute path never surfaces on retrieve-throw / identity-drift / unsafe-retrieved_at paths; no artifact', () => {
  const REGISTRY_PATH = '/home/private-user/provider';
  // Explicit single channel so the run proceeds to provider IO (no
  // multiple_search_providers early return); the channel identity is
  // path-shaped and must be redacted on EVERY intermediate failure path.
  const CHANNELS = [{ providerId: `${REGISTRY_PATH}-a` }];
  const REGISTRY_ENTRY = { providerId: `${REGISTRY_PATH}-a`, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET };

  function makeSeam(retrieveImpl) {
    return {
      listProviders() {
        return [REGISTRY_ENTRY];
      },
      retrieve(_capability, _params, ctx) {
        return retrieveImpl(ctx);
      },
    };
  }

  function assertRedactedChannel(run, workDir, label) {
    assert.equal(run.ok, false, `${label}: must fail closed`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, `${label}: contract failure identity`);
    assert.equal(run.details.reason, 'provider_contract_violation', `${label}: stable reason`);
    assert.equal(run.details.channel.providerId, '<redacted>', `${label}: path-shaped channel providerId is redacted`);
    assert.equal(run.details.channel.capability, CAPABILITY_SEARCH, `${label}: capability identity retained`);
    assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), `${label}: no artifact written`);
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes(REGISTRY_PATH), `${label}: the absolute registry path never surfaces`);
    assert.ok(serialized.includes('<redacted>'), `${label}: the stable redaction placeholder surfaces instead`);
  }

  // (a) seam.retrieve() throws → catch path (retrieval.mjs ~:527).
  {
    const workDir = tmpWorkDir();
    const run = runMultiQueryRetrieval({
      plan: PLAN_SINGLE,
      seam: makeSeam(() => {
        throw new Error('boom');
      }),
      channels: CHANNELS,
      workDir,
    });
    assertRedactedChannel(run, workDir, 'retrieve-throw');
  }

  // (b) structurally valid result with DRIFTED provider_id → identity bind
  //     check (retrieval.mjs ~:554); the drifted value is safe-shaped but the
  //     CHANNEL identity is path-shaped and must still be redacted.
  {
    const workDir = tmpWorkDir();
    const drift = { ...searchResult('fixture-b', [['100', 1]]) };
    const run = runMultiQueryRetrieval({
      plan: PLAN_SINGLE,
      seam: makeSeam(() => drift),
      channels: CHANNELS,
      workDir,
    });
    assertRedactedChannel(run, workDir, 'identity-drift');
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes('fixture-b'), 'identity-drift: drifted provider_id never surfaces');
  }

  // (c) structurally valid, identity-bound result with UNSAFE (path-shaped)
  //     retrieved_at → retrieved_at gate (retrieval.mjs ~:567).
  {
    const workDir = tmpWorkDir();
    const unsafe = { ...searchResult(`${REGISTRY_PATH}-a`, [['100', 1]]), retrieved_at: '/home/private-user/ts' };
    const run = runMultiQueryRetrieval({
      plan: PLAN_SINGLE,
      seam: makeSeam(() => unsafe),
      channels: CHANNELS,
      workDir,
    });
    assertRedactedChannel(run, workDir, 'unsafe-retrieved_at');
  }
});

test('J10: ALL-provider-failed early return with a T04-valid PATH-SHAPED plan QUERY (C1 final convergence repair) → the plan-owned query crosses the T04 PLAN boundary (projectPlanQuery), NOT the provider-content lens; a machine-private /root/... query that passes plan validation is PRESERVED verbatim on the all-failed path — matching its preservation on the successful path (R11-P2-1)', () => {
  // The plan validator's PRIVATE_PATH_SHAPE covers /Users /home Windows-profile
  // roots and ~ — but NOT the full POSIX set (/root /etc /opt ...). A query like
  // /root/private/research passes plan validation yet carries a machine-private
  // path. C1: plan-owned content is judged by the plan boundary alone — a
  // T04-valid query stays verbatim in the all-failed channel identity; only a
  // query that FAILS the T04 boundary (credential shape / profile-root path)
  // would be projected to <redacted> (defense-in-depth: validation and
  // projection share the same boundary, so the redaction branch is unreachable
  // through the public seam today).
  const PATH_QUERY = '/root/private/research';
  const failResult = {
    ok: false,
    provider_id: 'fixture-a',
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'no_pagination_signal' } },
  };
  const seam = {
    listProviders() {
      return [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET }];
    },
    retrieve() {
      return failResult;
    },
  };
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({
    plan: { ...PLAN_SINGLE, queryVariants: [PATH_QUERY] },
    seam,
    channels: [{ providerId: 'fixture-a' }],
    workDir,
  });
  assert.equal(run.ok, false, 'all-failed must fail closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  const failed = run.details.failedChannels;
  assert.equal(failed.length, 1, 'the failing channel is reported');
  assert.equal(failed[0].channel.query, PATH_QUERY, 'T04-valid plan query is PRESERVED in the all-failed channel identity (plan boundary, not provider-content lens)');
  assert.equal(failed[0].channel.providerId, 'fixture-a', 'safe providerId identity retained');
  const serialized = JSON.stringify(run);
  assert.ok(serialized.includes(PATH_QUERY), 'the plan-owned query is part of the plan contract — its identity is retained on the all-failed path');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written');
});

test('R11-P2-1: a T04-valid system-path plan query (e.g. "/etc/hosts 文件的作用") is preserved in the pool — the artifact walk applies the plan-validation query contract, NOT the broader provider-content lens (Codex 5th-round P2 on 526ca71); the successful run no longer misreports retrieval_provider_contract_invalid', () => {
  const SYSTEM_PATH_QUERY = '/etc/hosts 文件的作用';
  const seam = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))],
  });
  const workDir = tmpWorkDir('retrieval-r11');
  const run = runMultiQueryRetrieval({
    plan: { ...PLAN_SINGLE, queryVariants: [SYSTEM_PATH_QUERY] },
    seam,
    workDir,
  });
  assert.equal(run.ok, true, 'T04-valid system-path query must NOT fail the successful run');
  assert.equal(run.pool.channels[0].channel.query, SYSTEM_PATH_QUERY, 'plan query is preserved verbatim in the channel record');
  const persisted = JSON.parse(fs.readFileSync(path.join(workDir, RETRIEVAL_POOL_FILENAME), 'utf8'));
  assert.equal(persisted.channels[0].channel.query, SYSTEM_PATH_QUERY, 'persisted pool keeps the plan query');
  // C1 (final convergence repair): the ALL-FAILED path applies the SAME plan
  // boundary — the T04-valid query is preserved there too, so the two paths
  // never disagree about plan-owned identity (dual-path consistency).
  const failResult = {
    ok: false,
    provider_id: 'fixture-a',
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'no_pagination_signal' } },
  };
  const failedSeam = {
    listProviders() {
      return [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET }];
    },
    retrieve() {
      return failResult;
    },
  };
  const failedRun = runMultiQueryRetrieval({
    plan: { ...PLAN_SINGLE, queryVariants: [SYSTEM_PATH_QUERY] },
    seam: failedSeam,
    channels: [{ providerId: 'fixture-a' }],
    workDir: tmpWorkDir('retrieval-r11'),
  });
  assert.equal(failedRun.ok, false, 'all-failed must fail closed');
  assert.equal(failedRun.details.failedChannels[0].channel.query, SYSTEM_PATH_QUERY, 'the SAME T04-valid plan query is preserved on the all-failed provenance too');
});

test('R11-P2-2: a registry entry with an UNKNOWN capability identity (capability: "bogus") → FAIL CLOSED (retrieval_provider_contract_invalid, registryIssue malformed_entry) before any provider IO, even WITH explicit channel descriptors (Codex 5th-round P2 on 526ca71; capability must be in the T05 vocabulary)', () => {
  const seam = {
    listProviders() {
      return [{ providerId: 'p', capability: 'bogus', authClass: AUTH_CLASS_SESSION }];
    },
    retrieve() {
      throw new Error('provider IO must never be reached for an unknown capability identity');
    },
  };
  const run = runMultiQueryRetrieval({
    plan: PLAN_SINGLE,
    seam,
    channels: [{ providerId: 'p' }],
    workDir: tmpWorkDir('retrieval-r11'),
  });
  assert.equal(run.ok, false, 'unknown registry capability must fail closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.registryIssue, 'malformed_entry');
});

test('R11-P2-2b: unknown registry capability fails closed even WITHOUT explicit channels — default routing never sees the entry, and no provider IO occurs', () => {
  const seam = {
    listProviders() {
      return [{ providerId: 'p', capability: 'bogus', authClass: AUTH_CLASS_SESSION }];
    },
    retrieve() {
      throw new Error('provider IO must never be reached for an unknown capability identity');
    },
  };
  const run = runMultiQueryRetrieval({
    plan: PLAN_SINGLE,
    seam,
    workDir: tmpWorkDir('retrieval-r11'),
  });
  assert.equal(run.ok, false, 'unknown registry capability must fail closed before routing');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.registryIssue, 'malformed_entry');
});

test('R11-P2-2c: a T05-valid non-retrieval registry capability (capture) remains a VALID registry entry — only retrieval ROUTING is refused; the registry itself is not a contract violation', () => {
  const capAdapter = fixtureCaptureAdapter('cap-provider');
  const seam = createProviderSeam({
    adapters: [
      capAdapter,
      fixtureSearchAdapter('search-provider', (input) => searchResult('search-provider', [['100', 1]], { query: input.query })),
    ],
  });
  const workDir = tmpWorkDir('retrieval-r11');
  const run = runMultiQueryRetrieval({
    plan: PLAN_SINGLE,
    seam,
    channels: [{ providerId: 'search-provider' }],
    workDir,
  });
  assert.equal(run.ok, true, 'capture registry entry is T05-valid; explicit search channel still resolves');
  assert.equal(run.pool.channels[0].channel.providerId, 'search-provider');
  assert.equal(capAdapter.__calls(), 0, 'capture adapter is never invoked for a retrieval run');
});

// ---------------------------------------------------------------------------
// R12 — final convergence repair (Round-6 BLOCK1/BLOCK2/BLOCK3/BLOCK4 + C1/C2)
// retrieval-boundary counterexamples: the seam feeds the REAL fusion path, so
// these tests exercise the boundary the layer above rrfFusion actually sees.
// ---------------------------------------------------------------------------

test('R12-B1 (retrieval boundary): BLOCK1 canonical channel identity — explicit channel descriptors carrying EXTRA fields (query / capability / junk) never leak into channel provenance; the pool channel record is the canonical { query, providerId, capability } triple only (3905300503)', () => {
  const seam = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }))],
  });
  const workDir = tmpWorkDir('retrieval-r12');
  const run = runMultiQueryRetrieval({
    plan: PLAN_SINGLE,
    seam,
    channels: [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH, query: 'hijack-query', foo: 'bar' }],
    workDir,
  });
  assert.equal(run.ok, true, 'extra descriptor fields must not break routing');
  const canonical = { query: PLAN_SINGLE.queryVariants[0], providerId: 'fixture-a', capability: CAPABILITY_SEARCH };
  assert.deepEqual(run.pool.channels[0].channel, canonical, 'channel provenance is canonical-only — extra descriptor fields are dropped at the boundary');
  const persisted = JSON.parse(fs.readFileSync(path.join(workDir, RETRIEVAL_POOL_FILENAME), 'utf8'));
  assert.deepEqual(persisted.channels[0].channel, canonical, 'persisted artifact keeps the canonical triple only');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes('hijack-query') && !serialized.includes('foo'), 'extra descriptor fields never surface anywhere in the result');
});

test('R12-B2 (retrieval boundary): BLOCK2 bounded multi-layer percent-decoding — an encoded credential shape in the URL path / fragment / query name / query value fails closed during fusion projection at EVERY decode layer and at the fixed 3-layer limit; malformed percent-encoding fails closed; legitimate encoded content still passes (3905300513 → P1-2 5080578795)', () => {
  const encodedCredentialUrls = [
    // 1-layer encoded credentials (Round-6 BLOCK2 baseline, 3905300513)
    'https://example.invalid/a/token%3Dsekrit', // credential encoded in the PATH
    'https://example.invalid/a#token%3Dsekrit', // credential encoded in the FRAGMENT
    'https://example.invalid/?token%3Dsekrit', // credential encoded in a QUERY NAME
    'https://example.invalid/?name%3Dz_c0%3Dabc', // credential encoded in a QUERY VALUE
    'https://example.invalid/%zz', // malformed percent-encoding → fail closed
    // P1-2 (5080578795): strictly bounded multi-layer decode — 2/3-layer and
    // beyond-limit encoded credentials must ALL fail closed.
    'https://example.invalid/a/token%253Dsekrit', // 2-layer encoded credential in the PATH
    'https://example.invalid/a/token%25253Dsekrit', // 3-layer encoded credential in the PATH
    'https://example.invalid/a/token%2525253Dsekrit', // beyond the 3-layer limit — encoded bytes remain → fail closed
    'https://example.invalid/a#token%253Dsekrit', // 2-layer encoded credential in the FRAGMENT
    'https://example.invalid/?token%253Dsekrit', // 2-layer encoded credential in a QUERY NAME
    'https://example.invalid/?v=token%25253Dsekrit', // 3-layer encoded credential in a QUERY VALUE
  ];
  for (const url of encodedCredentialUrls) {
    const seam = createProviderSeam({
      adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { source_url: { url, securityClass: 'official-secret' } }]], { query: input.query }))],
    });
    const workDir = tmpWorkDir('retrieval-r12');
    const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir });
    assert.equal(run.ok, false, `${url}: encoded credential shape must fail closed`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, `${url}: contract failure identity`);
    assert.equal(run.details.reason, 'rrf_fusion_contract_violation', `${url}: rejected during fusion projection`);
    assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), `${url}: no artifact written`);
    const serialized = JSON.stringify(run);
    assert.ok(!serialized.includes('token=sekrit') && !serialized.includes('z_c0='), `${url}: the credential never surfaces in any decoded form`);
  }
  // Legitimate percent-encoded content must still pass the boundary. The
  // securityClass must equal the shared classifier's verdict for a public https
  // URL (external_unverified — classifier-bound, never provider-declared).
  const safeSeam = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { source_url: { url: 'https://example.invalid/%E4%B8%AD%E6%96%87/article', securityClass: 'external_unverified' } }]], { query: input.query }))],
  });
  const safeRun = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: safeSeam, workDir: tmpWorkDir('retrieval-r12') });
  assert.equal(safeRun.ok, true, 'legitimate encoded content still passes');
  assert.equal(candidateIds(safeRun.pool).length, 1, 'the safe item is fused');
  // P1-2 safe controls: encoded = : in a NON-credential context and an encoded
  // redirect URL (no credential word) still pass the bounded multi-layer
  // inspection — the fixed limit only fails closed on credential-adjacent
  // encoded syntax, not on ordinary encoded content.
  const safeSeam2 = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { source_url: { url: 'https://example.invalid/time%3D3%3A30/article', securityClass: 'external_unverified' } }]], { query: input.query }))],
  });
  const safeRun2 = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: safeSeam2, workDir: tmpWorkDir('retrieval-r12') });
  assert.equal(safeRun2.ok, true, 'encoded = : in a non-credential context still passes');
  assert.equal(candidateIds(safeRun2.pool).length, 1, 'the safe item is fused');
  const safeSeam3 = createProviderSeam({
    adapters: [fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1, { source_url: { url: 'https://example.invalid/?redirect=https%3A%2F%2Fexample.com%2Fx', securityClass: 'external_unverified' } }]], { query: input.query }))],
  });
  const safeRun3 = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: safeSeam3, workDir: tmpWorkDir('retrieval-r12') });
  assert.equal(safeRun3.ok, true, 'encoded redirect URL (no credential word) still passes');
  assert.equal(candidateIds(safeRun3.pool).length, 1, 'the safe item is fused');
});

test('R12-B3 (retrieval boundary): BLOCK3 duplicate channel identity is structurally PREVENTED before fusion — registry duplicate identities and duplicate channel descriptors fail closed pre-IO; the fusion-layer FUSION_DUPLICATE_CHANNEL code is allowlisted so any future reachable duplicate surfaces machine-readably (3905300520)', () => {
  // (a) duplicate channel descriptors fail closed before any provider IO.
  const seamA = createProviderSeam({ adapters: [fixtureSearchAdapter('fixture-a', () => { throw new Error('provider IO must never be reached for duplicate descriptors'); })] });
  const dupDescriptors = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: seamA, channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-a' }], workDir: tmpWorkDir('retrieval-r12') });
  assert.equal(dupDescriptors.ok, false);
  assert.equal(dupDescriptors.reason, RETRIEVAL_FAILURE_CHANNEL_DUPLICATE, 'duplicate descriptors fail closed before fusion');
  // (b) duplicate (providerId, capability) registry identities fail closed pre-IO.
  const seamB = {
    listProviders() {
      return [
        { providerId: 'x', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
        { providerId: 'x', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_SESSION },
      ];
    },
    retrieve() {
      throw new Error('provider IO must never be reached for a duplicate registry identity');
    },
  };
  const dupRegistry = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: seamB, workDir: tmpWorkDir('retrieval-r12') });
  assert.equal(dupRegistry.ok, false);
  assert.equal(dupRegistry.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(dupRegistry.details.registryIssue, 'duplicate_identity', 'ambiguous registry identity fails closed before any IO');
  // (c) the fusion-layer duplicate-channel code is allowlisted — if a future
  // path ever reaches it, the retrieval catch surfaces it machine-readably.
  assert.ok(FUSION_CONTRACT_ERROR_CODES.includes(FUSION_ERROR_DUPLICATE_CHANNEL), 'FUSION_DUPLICATE_CHANNEL is allowlisted for machine-readable surfacing');
});

test('R12-B4 (retrieval boundary): BLOCK4 allowlist — a fusion contract failure surfaces its machine-readable allowlisted code; an arbitrary path/credential-shaped adapter code is nulled, never proxied (3905300529)', () => {
  // (a) positive surface: within-channel duplicate → the allowlisted
  // FUSION_DUPLICATE_IN_CHANNEL code surfaces machine-readably.
  const dupAdapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1], ['100', 5]], { query: input.query }));
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: createProviderSeam({ adapters: [dupAdapter] }), workDir: tmpWorkDir('retrieval-r12') });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.reason, 'rrf_fusion_contract_violation');
  assert.equal(run.details.code, FUSION_ERROR_DUPLICATE_IN_CHANNEL, 'allowlisted fusion code surfaces machine-readably');
  assert.ok(FUSION_CONTRACT_ERROR_CODES.includes(run.details.code), 'the surfaced code is a member of the allowlist');
  // (b) negative: a path/credential-shaped code thrown by an adapter is nulled
  // at the boundary — never proxied, never surfaced.
  for (const [label, code] of [['credential-shaped', 'token=sekrit'], ['path-shaped', '/home/private-user/x']]) {
    const throwing = fixtureSearchAdapter('fixture-a', () => {
      const err = new Error('boom');
      err.code = code;
      throw err;
    });
    const badRun = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam: createProviderSeam({ adapters: [throwing] }), workDir: tmpWorkDir('retrieval-r12') });
    assert.equal(badRun.ok, false, `${label}: adapter throw fails closed`);
    assert.equal(badRun.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, `${label}: contract failure identity`);
    assert.equal(badRun.details.code, null, `${label} code is never proxied`);
    const serialized = JSON.stringify(badRun);
    assert.ok(!serialized.includes(code), `${label} code never surfaces`);
  }
  // (c) allowlist integrity at the retrieval boundary: complete + frozen + no
  // path/credential-shaped member can ever be admitted.
  assert.equal(FUSION_CONTRACT_ERROR_CODES.length, 7, 'the allowlist is complete');
  assert.ok(Object.isFrozen(FUSION_CONTRACT_ERROR_CODES), 'the allowlist is frozen — no runtime mutation');
  assert.equal(FUSION_CONTRACT_ERROR_CODES.includes('/home/private-user/x'), false, 'path-shaped code can never be a member');
  assert.equal(FUSION_CONTRACT_ERROR_CODES.includes('token=sekrit'), false, 'credential-shaped code can never be a member');
});

// ---------------------------------------------------------------------------
// R13 — P1-T06 security repair (review 5080250592 FIX 1, seam path)
// End-to-end coverage that the atomic projection also holds on the SEAM
// catch branch (not just the shared helper unit test in rrf.test.mjs).
// ---------------------------------------------------------------------------
test('R13-F3: seam-thrown error with a STATEFUL code getter is projected atomically — only the FIRST (allowed) read surfaces, the second private-path read can never leak (review 5080250592 FIX 1, seam path)', () => {
  let reads = 0;
  const statefulErr = {};
  Object.defineProperty(statefulErr, 'code', {
    get() {
      reads += 1;
      return reads === 1 ? SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT : '/home/private-user/x';
    },
  });
  const seam = {
    listProviders() {
      return [{ providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET }];
    },
    retrieve() {
      throw statefulErr;
    },
  };
  const run = runMultiQueryRetrieval({ plan: PLAN_SINGLE, seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, false, 'seam-thrown contract violation fails closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, 'the run fails at the provider-contract boundary');
  assert.equal(run.details.code, SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT, 'only the FIRST (allowed) code read surfaces');
  assert.notEqual(run.details.code, '/home/private-user/x', 'the second private-path read can NEVER surface');
  assert.equal(reads, 1, 'err.code was read EXACTLY ONCE — no check-then-reread across the seam catch');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes('/home/private-user/x'), 'the private path is never serialized');
});

// ---------------------------------------------------------------------------
// R13 — P1-T06 security repair (review 5080250592 FIX 2, e2e path)
// End-to-end coverage that the meaningful-failure-identity gate (whitespace
// rejection) also holds through the full all-provider-failed retrieval path.
// ---------------------------------------------------------------------------
test('R13-F4: ALL-provider-failed e2e with a WHITESPACE-ONLY failure identity (review 5080250592 FIX 2) → the meaningless identity is rejected at the T06 boundary and the run fails closed with a stable contract failure; the whitespace code never surfaces and no artifact is written', () => {
  const seam = {
    listProviders() {
      return [
        { providerId: 'fixture-a', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
        { providerId: 'fixture-b', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
      ];
    },
    retrieve(_capability, _params, ctx) {
      return {
        ok: false,
        provider_id: ctx.providerId,
        capability: CAPABILITY_SEARCH,
        auth_class: AUTH_CLASS_OFFICIAL_SECRET,
        retrieved_at: FIXED_NOW(),
        items: [],
        failure: { code: '   ', class: 'provider' },
        completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'no_pagination_signal' } },
      };
    },
  };
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({
    plan: PLAN_SINGLE,
    seam,
    channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }],
    workDir,
  });
  assert.equal(run.ok, false, 'whitespace-only failure identity must fail closed');
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, 'stable contract failure, not a meaningless identity');
  assert.ok(run.details?.note?.includes('malformed'), 'the boundary reports the identity as malformed');
  assert.notEqual(run.details?.code, '   ', 'the whitespace code is NEVER surfaced as a machine-readable code');
  const serialized = JSON.stringify(run);
  assert.ok(!serialized.includes('"code":"   "'), 'the raw whitespace code is never serialized as a failure code');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no artifact written on fail-closed');
});
