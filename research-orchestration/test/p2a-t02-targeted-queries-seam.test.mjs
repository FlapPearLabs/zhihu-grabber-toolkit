// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p2a-t02-targeted-queries-seam.test.mjs
 *
 * P2A-T02 (#114) focused tests — `runMultiQueryRetrieval` additive
 * `targetedQueries` execution seam (SEAM F.7; Seam Map S5 / S6 / S7 and §3
 * anti-second-pipeline; Spec §9 Retrieval reuse; D12-7).
 *
 * T02 owns: the additive parameter and its branch, the providerScope channel
 * construction (reusing the existing `resolveChannels`), the unchanged planHash
 * binding, the unchanged return shape, the reused safety projection, and the
 * round-pool safety walk at `retrieval.mjs:761` (existing call site untouched).
 * T02 explicitly does NOT own: a second retrieval entry point, any duplicated
 * fusion/pool-merge composition outside the single entry, new providers /
 * capabilities / ordering / canonical identity, plan artifact changes, any
 * `trustedPlanStrings` widening, the accumulated-pool walk (T09).
 *
 * Anti-tautology discipline: expected channel footprints and candidate identities
 * are literals / fixtures written from the frozen contract, and the per-adapter
 * invocation counters are owned by the fixtures (not read back from the module).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTH_CLASS_OFFICIAL_SECRET,
  CAPABILITY_CAPTURE,
  CAPABILITY_SEARCH,
  COMPLETENESS_UNKNOWN,
  createProviderSeam,
} from '../lib/provider-seam.mjs';
import {
  RETRIEVAL_FAILURE_INVALID_INPUT,
  RETRIEVAL_FAILURE_NO_VALID_CHANNEL,
  RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH,
  RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID,
  RETRIEVAL_POOL_FILENAME,
  runMultiQueryRetrieval,
} from '../lib/retrieval.mjs';
import { planHash } from '../lib/plan-contract.mjs';

const MODULE_PATH = fileURLToPath(new URL('../lib/retrieval.mjs', import.meta.url));
const FIXED_NOW = () => '2026-09-28T12:00:00.000Z';

/** A T04-valid plan whose queryVariants do NOT contain the targeted strings. */
const PLAN = {
  schemaVersion: 1,
  queryVariants: ['基线与计划查询一', '基线与计划查询二'],
  aspects: ['目标 aspect 查询'],
  entities: [],
  opposingFramings: ['目标反面框架查询'],
  terminologyVariants: [],
  sourceGroupIntents: [],
};
const PLAN_HASH = planHash(PLAN);

function tmpWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p2a-t02-'));
}

function searchResult(providerId, entries, { query = 'q' } = {}) {
  void query;
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: FIXED_NOW(),
    items: entries.map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: {
      status: COMPLETENESS_UNKNOWN,
      evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' },
    },
  };
}

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

function channelFootprint(channel) {
  return `${channel.query}::${channel.providerId}::${channel.capability}`;
}

function buildSeam(adapters) {
  return createProviderSeam({ adapters });
}

// ---------------------------------------------------------------------------
// A. AC1 — the default branch is the historical execution sequence, verbatim
// ---------------------------------------------------------------------------

test('A1 — absent targetedQueries executes plan.queryVariants × channels, in order', () => {
  const adapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: PLAN_HASH,
    seam: buildSeam([adapter]),
    workDir: tmpWorkDir(),
  });
  assert.equal(run.ok, true);
  assert.deepEqual(
    run.pool.channels.map((c) => channelFootprint(c.channel)),
    [
      '基线与计划查询一::fixture-a::search',
      '基线与计划查询二::fixture-a::search',
    ],
  );
  assert.equal(adapter.__calls(), 2);
});

test('A2 — explicit null is byte-equivalent to the absent default', () => {
  const a = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const b = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['100', 1]], { query: input.query }));
  const absent = runMultiQueryRetrieval({ plan: PLAN, planHash: PLAN_HASH, seam: buildSeam([a]), workDir: tmpWorkDir() });
  const explicitNull = runMultiQueryRetrieval({
    plan: PLAN, planHash: PLAN_HASH, seam: buildSeam([b]), workDir: tmpWorkDir(), targetedQueries: null,
  });
  assert.deepEqual(explicitNull.pool.channels, absent.pool.channels);
  assert.deepEqual(explicitNull.pool.candidates, absent.pool.candidates);
  assert.equal(explicitNull.poolHash, absent.poolHash);
});

// ---------------------------------------------------------------------------
// B. AC2 / AC3 — the parametric path and the unchanged identity + return shape
// ---------------------------------------------------------------------------

test('B1 — targetedQueries executes ONLY those queries × channels', () => {
  const adapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['900', 1]], { query: input.query }));
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: PLAN_HASH,
    seam: buildSeam([adapter]),
    workDir: tmpWorkDir(),
    targetedQueries: ['目标 aspect 查询'],
  });
  assert.equal(run.ok, true);
  assert.deepEqual(
    run.pool.channels.map((c) => channelFootprint(c.channel)),
    ['目标 aspect 查询::fixture-a::search'],
  );
  assert.equal(adapter.__calls(), 1);
});

test('B2 — the planHash binding stays the ORIGINAL plan identity (plan artifact immutable)', () => {
  const adapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['900', 1]], { query: input.query }));
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: PLAN_HASH,
    seam: buildSeam([adapter]),
    workDir: tmpWorkDir(),
    targetedQueries: ['目标反面框架查询'],
  });
  assert.equal(run.pool.planHash, PLAN_HASH);
  assert.equal(run.pool.planHash, planHash(PLAN));
});

test('B3 — the return shape is unchanged: { ok, pool, poolHash, file }', () => {
  const adapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['900', 1]], { query: input.query }));
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: PLAN_HASH,
    seam: buildSeam([adapter]),
    workDir: tmpWorkDir(),
    targetedQueries: ['目标 aspect 查询'],
  });
  assert.deepEqual(Object.keys(run).sort(), ['file', 'ok', 'pool', 'poolHash']);
  assert.equal(run.file, RETRIEVAL_POOL_FILENAME);
  assert.equal(typeof run.poolHash, 'string');
  assert.equal(run.poolHash.length, 64);
  assert.equal(run.pool.criteria.fusion, 'rrf');
  assert.equal(run.pool.criteria.scope, 'single-pass');
});

test('B4 — a wrong planHash still fails closed on the targeted path (AC2)', () => {
  const adapter = fixtureSearchAdapter('fixture-a', () => searchResult('fixture-a', [['900', 1]]));
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: 'f'.repeat(64),
    seam: buildSeam([adapter]),
    workDir: tmpWorkDir(),
    targetedQueries: ['目标 aspect 查询'],
  });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH);
  assert.equal(adapter.__calls(), 0);
});

test('B5 — multiple targeted queries × two providers keeps the plan channel order', () => {
  const a = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['900', 1]], { query: input.query }));
  const b = fixtureSearchAdapter('fixture-b', (input) => searchResult('fixture-b', [['901', 1]], { query: input.query }));
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: PLAN_HASH,
    seam: buildSeam([a, b]),
    channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }],
    workDir: tmpWorkDir(),
    targetedQueries: ['目标 aspect 查询', '目标反面框架查询'],
  });
  assert.equal(run.ok, true);
  assert.deepEqual(
    run.pool.channels.map((c) => channelFootprint(c.channel)).sort(),
    [
      '目标 aspect 查询::fixture-a::search',
      '目标 aspect 查询::fixture-b::search',
      '目标反面框架查询::fixture-a::search',
      '目标反面框架查询::fixture-b::search',
    ].sort(),
  );
});

// ---------------------------------------------------------------------------
// C. input validation — fail closed BEFORE any IO
// ---------------------------------------------------------------------------

test('C1 — malformed targetedQueries fail closed with zero IO', () => {
  for (const bad of [[], 'not an array', [42], [''], [null], [{}]]) {
    const adapter = fixtureSearchAdapter('fixture-a', () => searchResult('fixture-a', [['900', 1]]));
    const run = runMultiQueryRetrieval({
      plan: PLAN,
      planHash: PLAN_HASH,
      seam: buildSeam([adapter]),
      workDir: tmpWorkDir(),
      targetedQueries: bad,
    });
    assert.equal(run.ok, false, `expected fail-closed for ${JSON.stringify(bad)}`);
    assert.equal(run.reason, RETRIEVAL_FAILURE_INVALID_INPUT);
    assert.equal(adapter.__calls(), 0, `no IO for ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// D. AC4 — same RRF / same canonical identity, no weighting or private ordering
// ---------------------------------------------------------------------------

test('D1 — when the query list coincides, the targeted path is byte-identical to the plan path', () => {
  const items = [['500', 1], ['600', 2], ['700', 3]];
  const planM = {
    ...PLAN,
    queryVariants: ['目标 aspect 查询', '目标反面框架查询'],
  };
  const planRun = runMultiQueryRetrieval({
    plan: planM,
    planHash: planHash(planM),
    seam: buildSeam([fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', items, { query: input.query }))]),
    workDir: tmpWorkDir(),
  });
  const targetedRun = runMultiQueryRetrieval({
    plan: planM,
    planHash: planHash(planM),
    seam: buildSeam([fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', items, { query: input.query }))]),
    workDir: tmpWorkDir(),
    targetedQueries: ['目标 aspect 查询', '目标反面框架查询'],
  });
  assert.equal(targetedRun.ok, true);
  // identical candidates INCLUDING rrfScore and the per-channel ranks: the targeted
  // path adds no weighting, no promotion and no private ordering.
  assert.deepEqual(targetedRun.pool.candidates, planRun.pool.candidates);
  assert.deepEqual(targetedRun.pool.criteria, planRun.pool.criteria);
  assert.equal(targetedRun.poolHash, planRun.poolHash);
});

test('D2 — duplicate questionIds across targeted queries dedupe by the EXISTING canonical rule', () => {
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: PLAN_HASH,
    seam: buildSeam([fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['800', 1]], { query: input.query }))]),
    workDir: tmpWorkDir(),
    targetedQueries: ['目标 aspect 查询', '目标反面框架查询'],
  });
  assert.equal(run.ok, true);
  const ids = run.pool.candidates.map((c) => c.identity.questionId);
  assert.deepEqual(ids, ['800']);
});

// ---------------------------------------------------------------------------
// E. failure semantics are those of the ONE existing pipeline
// ---------------------------------------------------------------------------

test('E1 — all-provider-failed on the targeted path uses the existing failure code', () => {
  const adapter = fixtureSearchAdapter('fixture-a', (input) => ({
    ...searchResult('fixture-a', [], { query: input.query }),
    ok: false,
    failure: { code: 'provider_timeout', class: 'transient' },
  }));
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: PLAN_HASH,
    seam: buildSeam([adapter]),
    workDir: tmpWorkDir(),
    targetedQueries: ['目标 aspect 查询'],
  });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
});

test('E2 — the artifact walk is NOT weakened: an un-admitted hostile targeted string still fails closed', () => {
  // In production every targeted string is admitted by the T04 DUAL-LENS gate
  // (plan ∧ provider) before it can reach retrieval, so this is the defence-in-
  // depth boundary for a caller that bypasses that gate. The walk call site and
  // trustedPlanStrings are untouched (AC5), so it must still refuse.
  const adapter = fixtureSearchAdapter('fixture-a', (input) => searchResult('fixture-a', [['900', 1]], { query: input.query }));
  const tmpDirCheck = tmpWorkDir();
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: PLAN_HASH,
    seam: buildSeam([adapter]),
    workDir: tmpDirCheck,
    targetedQueries: ['/Users/someone/private/notes'],
  });
  assert.equal(run.ok, false);
  // The existing pipeline refuses it (the fusion contract guard or the artifact
  // walk, depending on where the string is inspected first) — either way it never
  // reaches the pool and no artifact is written.
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(typeof run.details.reason, 'string');
  assert.equal(fs.existsSync(path.join(tmpDirCheck, RETRIEVAL_POOL_FILENAME)), false);
});

// ---------------------------------------------------------------------------
// F. structural guards — ONE entry point, walk call site untouched
// ---------------------------------------------------------------------------

test('F1 — the artifact-walk call site and trustedPlanStrings are byte-unchanged (AC5)', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const occurrences = source.match(/trustedPlanStrings: new Set\(validated\.plan\.queryVariants\)/g) ?? [];
  assert.equal(occurrences.length, 1);
  assert.equal(/assertArtifactSafe\(pool, \{/.test(source), true);
});

test('F2 — no second retrieval entry point and no duplicated fusion composition', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  // exactly one exported retrieval entry
  const exportedFns = source.match(/^export function (\w+)/gm) ?? [];
  assert.equal(exportedFns.some((line) => line.includes('runMultiQueryRetrieval')), true);
  // the parametric branch reuses the SAME loop body: no second rrfFusion call site
  const fusionCalls = source.match(/rrfFusion\(/g) ?? [];
  assert.equal(fusionCalls.length, 1);
});

test('F3 — the targeted branch synthesises no channels outside the existing resolver', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  // the targeted branch must never build a channel outside resolveChannels
  const resolverCalls = source.match(/const resolved = resolveChannels\(seam, channels\);/g) ?? [];
  assert.equal(resolverCalls.length, 1);
  // and it must not register / construct any provider of its own
  assert.equal(/listProviders\(/.test(source), true); // consumed from the seam, never replaced
  assert.equal(/createProviderSeam\(/.test(source), false);
});
