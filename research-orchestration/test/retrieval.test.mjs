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
    assert.equal(run.details.reason, 'pool_serialization_failed', `${label}: stable serialization failure reason`);
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
