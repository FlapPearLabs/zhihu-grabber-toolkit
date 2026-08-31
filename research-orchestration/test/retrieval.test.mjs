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
 *   - zero valid retrieval channels → FAIL CLOSED;
 *   - malformed provider result → FAIL CLOSED where contract requires
 *     (seam UNKNOWN_PROVIDER_CONTRACT / fused-item rank contract);
 *   - Session capture wrapper can NEVER masquerade as a retrieval-ranked channel;
 *   - persisted pool artifact: deterministic bytes + poolHash, planHash recorded,
 *     work-relative only.
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
  runMultiQueryRetrieval,
} from '../lib/retrieval.mjs';
import { planHash, validatePlanInput } from '../lib/plan-contract.mjs';

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
 * entries: [questionId, rank, extra?] — extra may carry { failure, source_url, facts, provenance }.
 */
function searchResult(providerId, entries, { ok = true, failure = null, query = 'q' } = {}) {
  const result = {
    ok,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: entries.map(([questionId, rank, extra = {}]) => ({
      identity: { kind: 'candidate', questionId },
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
  assert.equal(failedChannel.failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(failedChannel.failure.provider_error_type, 'http_403');
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