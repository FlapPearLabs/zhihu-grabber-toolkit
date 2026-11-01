// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-runtime-identity-binding.test.mjs
 *
 * The RUN IDENTITY must be computed from exactly ONE value, and that value must
 * be stable, model-aware and endpoint-aware without ever recording the endpoint
 * itself (Issues #145 / custom base URL):
 *
 *   I1  a non-default model's checkpoint is resumable: the same runtime
 *       re-entering the same work dir REUSES the completed run instead of
 *       failing with run_identity_conflict (regression: the composer hashed
 *       `runtimeId:model` while makeState hashed only `runtimeId`);
 *   I2  the historical default identity is unchanged — the recorded runId still
 *       equals the pre-existing formula, so old default checkpoints resume;
 *   I3  a custom base URL is bound into the identity: the same endpoint is
 *       stable across runs and re-runs, a different endpoint is isolated, and a
 *       foreign checkpoint fails closed (never a silent fallback);
 *   I4  default (provider-managed endpoint) and custom-endpoint runs of the same
 *       model never share history;
 *   I5  the binding leaks nothing: state / events / result record a digest, not
 *       the host, path or any credential;
 *   I6  an endpoint that cannot be safely validated fails closed with the
 *       typed runtime error and without echoing credentials.
 *   I7  a DECLARED credential profile is bound into the run identity: two
 *       profiles on the same provider/model/endpoint never share a checkpoint
 *       (the previous identity ignored which credential configuration ran);
 *   I8  the same declared profile is stable, so re-entry still resumes;
 *   I9  a profile on the DEFAULT model is a distinct identity — it never
 *       inherits the historical default checkpoint — while an undeclared
 *       profile keeps the historical identity byte-for-byte;
 *   I10 the profile label is the ONLY credential fact in the identity: it must
 *       be a non-secret label (a malformed or key-shaped label is refused) and
 *       the key, or any hash of it, never appears in the identity or in state.
 *
 * Offline: providers, capture, runner, embeddings and the model are injected
 * test doubles; only the real composer / state / identity code is exercised.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { P1_PIPELINE_IDENTITY } from '../lib/coverage-final-integration.mjs';
import { runIdentityHash, STAGE_COMPLETE, readState, eventsFile } from '../lib/state.mjs';
import * as modelRuntime from '../lib/model-runtime.mjs';

const runtimeRunKey = (runtime) => modelRuntime.runtimeRunKey(runtime);
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';
import { fakeModelFetch, TEST_API_KEY } from './helpers/fake-model-transport.mjs';

const TOPIC = 'AI 编程工具会取代程序员吗';
const NOW = () => '2026-10-15T00:00:00.000Z';
const HISTORICAL_DEFAULT_RUNTIME = 'deepseek-api-tool-less';

const PLAN = {
  schemaVersion: 1,
  queryVariants: ['AI 编程工具 取代 程序员', 'AI coding 岗位影响'],
  aspects: ['岗位影响'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

const tmpWork = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function searchResult(providerId, ranking) {
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: NOW(),
    items: ranking.map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
  };
}

function rankingSeam() {
  const ranking = [['100', 1], ['200', 2]];
  const adapter = (providerId) => ({
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve: () => searchResult(providerId, ranking),
  });
  return createProviderSeam({ adapters: [adapter('fixture-official'), adapter('fixture-global')] });
}

const TEXTS = {
  100: ['回答一：总体上有效，多数场景成立。', '回答二：小样本下有反例。'],
  200: ['回答三：另一个问题下的主流经验。', '回答四：补充：成本是主要顾虑。'],
};

const captureAdapter = {
  providerId: 'zhihu-session-capture',
  capability: 'capture',
  authClass: 'session',
  retrieve({ questionId, outDir }) {
    const dir = path.join(outDir, String(questionId));
    fs.mkdirSync(dir, { recursive: true });
    const doc = {
      questionId: String(questionId),
      questionTitle: `问题 ${questionId} 的标题`,
      answers: TEXTS[String(questionId)].map((content, i) => ({
        id: `${questionId}-a-${i + 1}`,
        content,
        excerpt: content,
        author: `作者${questionId}-${i}`,
        voteupCount: 10 - i,
      })),
    };
    fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify(doc, null, 2)}\n`);
    return {
      ok: true,
      provider_id: 'zhihu-session-capture',
      capability: 'capture',
      auth_class: 'session',
      retrieved_at: NOW(),
      items: [{
        identity: { kind: 'group', questionId: String(questionId) },
        provenance: { route: 'fixture-capture', rank: 1, rankOrigin: 'fixture' },
        facts: { capturedAnswerCount: doc.answers.length },
      }],
      completeness: { status: 'complete', evidence: { basis: 'fixture_complete_pagination' } },
    };
  },
};

function groupRunner() {
  return (name, args) => {
    if (name === 'zhihu-verify') {
      const doc = JSON.parse(fs.readFileSync(path.join(args[0], 'answers.json'), 'utf8'));
      return {
        status: 0,
        stdout: JSON.stringify({ valid: true, questionId: String(doc.questionId), capturedAnswerCount: doc.answers.length, reportedAnswerCount: doc.answers.length }),
      };
    }
    if (name === 'zhihu-handoff') {
      const dir = args[0];
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
      fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ questionId: String(doc.questionId), task: 'digest', sourceType: 'session-capture', verified: true, generatedBy: 'fixture' }, null, 2)}\n`);
      return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') return { status: 0, stdout: JSON.stringify({ valid: true }) };
    throw new Error(`unexpected runner command: ${name}`);
  };
}

const embeddingProvider = () => ({
  preflight: async () => ({ ok: true }),
  embed: async (texts) => ({ vectors: texts.map(() => mockVector768(7)) }),
});

/** The pinned default-identity mock runtime (T13 analyze + T14 synthesize). */
function mockRuntime(identity = { runtimeId: T14_SYNTHESIS_RUNTIME_ID, model: T14_SYNTHESIS_MODEL }) {
  return {
    ...identity,
    analyze: async ({ projection }) => {
      const tokens = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      assert.ok(tokens.length > 0, 'mock runtime saw no issued tokens');
      return {
        main: [{ tokenRef: tokens[0], statement: '主流观点：该做法在多数场景下有效' }],
        minority: [{ tokenRef: tokens[tokens.length - 1], statement: '少数派观点：特定条件下结论相反' }],
        contradictory: [],
        expertEvidenceRichTokens: [tokens[0]],
      };
    },
    async synthesize({ claims }) {
      return {
        families: [{
          aspect: '总体有效性',
          anchorClaimId: [...claims.map((c) => c.claimId)].sort()[0],
          members: claims.map((c) => ({ claimId: c.claimId, stance: 'ASSERTS' })),
        }],
        unresolvedClaimIds: [],
      };
    },
  };
}

const NON_DEFAULT = { runtimeId: 'antigravity-api-tool-less', model: 'claude-sonnet-4-6' };

function compose(workDir, runtime) {
  return composeP1Research({
    topic: TOPIC,
    workDir,
    plan: PLAN,
    runtime,
    seam: rankingSeam(),
    captureAdapter,
    runner: groupRunner(),
    embeddingProvider: embeddingProvider(),
  });
}

test('I1: a non-default model checkpoint is reused on re-entry (no run_identity_conflict)', async () => {
  const workDir = tmpWork('p1-identity-model-');
  const first = await compose(workDir, mockRuntime(NON_DEFAULT));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.reused, undefined);

  const second = await compose(workDir, mockRuntime(NON_DEFAULT));
  assert.equal(second.ok, true, `re-entering the same non-default model run must reuse it: ${JSON.stringify(second)}`);
  assert.notEqual(second.code, 'run_identity_conflict');
  assert.equal(second.reused, true);
  assert.equal(second.runId, first.runId, 'the same runtime must reproduce the same run identity');

  const state = readState(workDir);
  assert.equal(state.stage, STAGE_COMPLETE);
  assert.equal(state.runtime, runtimeRunKey(NON_DEFAULT), 'the checkpoint records the SAME identity the composer hashed');
  assert.match(state.runtime, /^antigravity-api-tool-less:claude-sonnet-4-6$/);
});

test('I2: the historical default identity is preserved byte-for-byte', async () => {
  const workDir = tmpWork('p1-identity-default-');
  const out = await compose(workDir, mockRuntime());
  assert.equal(out.ok, true, JSON.stringify(out));

  const state = readState(workDir);
  assert.equal(state.runtime, HISTORICAL_DEFAULT_RUNTIME, 'the default keeps the bare runtimeId in state');
  assert.equal(
    state.runId,
    runIdentityHash({ topic: TOPIC, mode: P1_PIPELINE_IDENTITY, percent: null, runtime: HISTORICAL_DEFAULT_RUNTIME }),
    'a checkpoint written by the old default code must still match',
  );
  assert.equal(out.runId, state.runId);
});

test('I3: a custom endpoint is stable, isolated, and never silently reused across endpoints', async () => {
  const A = 'http://127.0.0.1:8045/v1';
  const B = 'http://127.0.0.1:8046/v1';
  const withEndpoint = (endpoint, identity = NON_DEFAULT) => ({ ...mockRuntime(identity), customEndpoint: endpoint });

  const dirA = tmpWork('p1-identity-endpoint-a-');
  const a1 = await compose(dirA, withEndpoint(A));
  assert.equal(a1.ok, true, JSON.stringify(a1));

  // Same endpoint, same run: re-entry reuses instead of conflicting.
  const a2 = await compose(dirA, withEndpoint(A));
  assert.equal(a2.ok, true, JSON.stringify(a2));
  assert.equal(a2.reused, true);
  assert.equal(a2.runId, a1.runId, 'the same endpoint must produce a stable identity');

  // Different endpoint, same model/provider: a different run identity.
  const dirB = tmpWork('p1-identity-endpoint-b-');
  const b1 = await compose(dirB, withEndpoint(B));
  assert.equal(b1.ok, true, JSON.stringify(b1));
  assert.notEqual(b1.runId, a1.runId, 'a different endpoint must be a different identity');

  // A checkpoint from endpoint B is never served to endpoint A.
  const crossed = await compose(dirB, withEndpoint(A));
  assert.equal(crossed.ok, false, 'crossing endpoints must fail closed');
  assert.equal(crossed.code, 'run_identity_conflict');
  assert.equal(readState(dirB).runId, b1.runId, 'the foreign checkpoint must be left intact');
});

test('I4: the default runtime and a custom-endpoint runtime of the same model never share history', async () => {
  const dir = tmpWork('p1-identity-default-vs-custom-');
  const def = await compose(dir, mockRuntime());
  assert.equal(def.ok, true, JSON.stringify(def));

  const custom = await compose(dir, { ...mockRuntime(), customEndpoint: 'https://api.example.test/v1' });
  assert.equal(custom.ok, false, 'a custom-endpoint run must not reuse the default checkpoint');
  assert.equal(custom.code, 'run_identity_conflict');
  assert.notEqual(
    runtimeRunKey({ ...mockRuntime(), customEndpoint: 'https://api.example.test/v1' }),
    runtimeRunKey(mockRuntime()),
    'the custom endpoint must be bound into the identity',
  );
});

test('I5: the endpoint binding is a digest — no host, path or credential reaches state, events or result', async () => {
  const endpoint = 'https://internal.example.test/tenant-secret-path/v1';
  const workDir = tmpWork('p1-identity-no-leak-');
  const out = await compose(workDir, { ...mockRuntime(), customEndpoint: endpoint });
  assert.equal(out.ok, true, JSON.stringify(out));

  const state = readState(workDir);
  assert.match(state.runtime, /^deepseek-api-tool-less:endpoint-[0-9a-f]{16}$/, `unexpected recorded identity: ${state.runtime}`);

  const stateText = fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8');
  const eventsText = fs.readFileSync(eventsFile(workDir), 'utf8');
  const resultText = fs.readFileSync(path.join(workDir, 'research-result.json'), 'utf8');
  for (const [label, text] of [['state', stateText], ['events', eventsText], ['result', resultText]]) {
    assert.ok(!text.includes('internal.example.test'), `${label} must not record the endpoint host`);
    assert.ok(!text.includes('tenant-secret-path'), `${label} must not record the endpoint path`);
    assert.ok(!text.includes(endpoint), `${label} must not record the endpoint URL`);
  }

  // Same endpoint ⇒ same binding; a different endpoint ⇒ a different binding.
  assert.equal(runtimeRunKey({ ...mockRuntime(), customEndpoint: endpoint }), state.runtime);
  assert.notEqual(runtimeRunKey({ ...mockRuntime(), customEndpoint: 'https://other.example.test/v1' }), state.runtime);
  // Equivalent spellings of one endpoint normalize to one binding.
  const variants = [
    'https://api.example.test/v1',
    'https://api.example.test/v1/',
    'https://API.example.test:443/v1',
  ].map((url) => runtimeRunKey({ ...mockRuntime(), customEndpoint: url }));
  assert.equal(new Set(variants).size, 1, `endpoint spellings must normalize: ${variants.join(' | ')}`);
});

test('I6: an unvalidatable endpoint fails closed with a typed error and no credential echo', async () => {
  const workDir = tmpWork('p1-identity-bad-endpoint-');
  const out = await compose(workDir, { ...mockRuntime(), customEndpoint: 'https://user:s3cr3t-pass@api.example.test/v1' });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'runtime_not_supported', 'an unsafe endpoint must not fall back to the plain identity');
  assert.ok(!String(out.details ?? '').includes('s3cr3t-pass'), 'the credential must never be echoed');
  assert.equal(fs.existsSync(path.join(workDir, 'orchestration-state.json')), false, 'no checkpoint may be written for a refused runtime');
});

/** The mock runtime plus a declared (non-secret) credential profile and a call count. */
function profileRuntime(identity, credentialProfile) {
  const base = mockRuntime(identity);
  let calls = 0;
  return {
    runtime: {
      ...base,
      credentialProfile,
      analyze: (args) => { calls += 1; return base.analyze(args); },
      synthesize: (args) => { calls += 1; return base.synthesize(args); },
    },
    calls: () => calls,
  };
}

test('I7: two declared credential profiles on one model/endpoint never share a checkpoint', async () => {
  const workDir = tmpWork('p1-identity-profile-');
  const a = profileRuntime(NON_DEFAULT, 'account-a');
  const first = await compose(workDir, a.runtime);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.match(readState(workDir).runtime, /:credential-profile-account-a$/, 'the declared profile must be recorded in the identity');

  const b = profileRuntime(NON_DEFAULT, 'account-b');
  const crossed = await compose(workDir, b.runtime);
  assert.equal(crossed.ok, false, 'another credential profile must not be served this checkpoint');
  assert.equal(crossed.code, 'run_identity_conflict');
  assert.equal(b.calls(), 0, 'a refused profile must not call the model');
  assert.equal(readState(workDir).runId, first.runId, 'the foreign checkpoint must be left intact');
});

test('I8: the same declared credential profile resumes the checkpoint', async () => {
  const workDir = tmpWork('p1-identity-profile-resume-');
  const first = profileRuntime(NON_DEFAULT, 'account-a');
  const out1 = await compose(workDir, first.runtime);
  assert.equal(out1.ok, true, JSON.stringify(out1));

  const again = profileRuntime(NON_DEFAULT, 'account-a');
  const out2 = await compose(workDir, again.runtime);
  assert.equal(out2.ok, true, `the same profile must resume: ${JSON.stringify(out2)}`);
  assert.equal(out2.reused, true);
  assert.equal(out2.runId, out1.runId);
  assert.equal(again.calls(), 0, 'a reuse must not call the model again');
});

test('I9: a profile on the default model is a distinct identity, an undeclared one stays historical', async () => {
  const plainDir = tmpWork('p1-identity-profile-default-plain-');
  const plain = await compose(plainDir, mockRuntime());
  assert.equal(plain.ok, true, JSON.stringify(plain));

  const profiledDir = tmpWork('p1-identity-profile-default-profiled-');
  const profiled = profileRuntime(undefined, 'account-a');
  const out = await compose(profiledDir, profiled.runtime);
  assert.equal(out.ok, true, JSON.stringify(out));

  const profiledState = readState(profiledDir);
  assert.notEqual(profiledState.runId, plain.runId, 'a profiled default run must not inherit the historical checkpoint');
  assert.equal(profiledState.runtime, 'deepseek-api-tool-less:credential-profile-account-a');
  assert.match(readState(plainDir).runtime, /^deepseek-api-tool-less$/, 'an undeclared profile keeps the historical identity');

  // The profiled checkpoint is never served to the unprofiled default run.
  const crossed = await compose(profiledDir, mockRuntime());
  assert.equal(crossed.ok, false);
  assert.equal(crossed.code, 'run_identity_conflict');
});

test('I10: the profile is a non-secret label — malformed or key-shaped labels are refused and no key is bound', async () => {
  const fetchImpl = fakeModelFetch(() => ({ text: '{"main":[]}' }));
  const base = { spec: 'antigravity/claude-sonnet-4-6', baseUrl: 'http://127.0.0.1:8045/v1', apiKey: TEST_API_KEY, fetchImpl };

  const declared = await modelRuntime.createModelRuntime({ ...base, credentialProfile: 'account-a' });
  assert.equal(declared.credentialProfile, 'account-a');
  const key = runtimeRunKey(declared);
  assert.match(key, /:credential-profile-account-a$/);
  assert.equal(key.includes(TEST_API_KEY), false, 'the key must never be part of the identity');
  assert.equal(JSON.stringify(declared).includes(TEST_API_KEY), false, 'the runtime surface must not expose the key');

  const fromEnv = await modelRuntime.createModelRuntime({ ...base, env: { [modelRuntime.MODEL_CREDENTIAL_PROFILE_ENV]: 'account-b' } });
  assert.equal(fromEnv.credentialProfile, 'account-b', 'the profile may be declared through the environment');

  for (const bad of ['Account A!', 'a'.repeat(65), `${TEST_API_KEY}`, `x-${TEST_API_KEY}`]) {
    await assert.rejects(
      () => modelRuntime.createModelRuntime({ ...base, credentialProfile: bad }),
      /credential_profile_invalid/,
      `an unusable profile label must be refused: ${bad}`,
    );
  }
});

/** Run `fn` with exactly the given env, restoring the real env afterwards. */
async function withEnv(vars, fn) {
  const saved = new Map();
  for (const [name, value] of Object.entries(vars)) {
    saved.set(name, Object.hasOwn(process.env, name) ? process.env[name] : undefined);
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// Synthetic values only. They are never real credentials, and no assertion below
// prints or compares them into the repository — only booleans are recorded.
const SHORT_SYNTHETIC_KEY = 'fakeky'; // deliberately shorter than 8 characters
const SDK_ONLY_SYNTHETIC_KEY = 'synthetic-sdk-only-key';

test('I11: a SHORT credential used as the profile is refused, and nothing is persisted', async () => {
  for (const profile of [SHORT_SYNTHETIC_KEY, `x-${SHORT_SYNTHETIC_KEY}`]) {
    const workDir = tmpWork('p1-identity-profile-short-key-');
    const fetchImpl = fakeModelFetch(() => ({ status: 400, body: { error: { message: 'fake: synthetic' } } }));

    const out = await withEnv({
      [modelRuntime.MODEL_API_KEY_ENV]: SHORT_SYNTHETIC_KEY,
      [modelRuntime.MODEL_CREDENTIAL_PROFILE_ENV]: profile,
      DEEPSEEK_API_KEY: null,
      OPENAI_API_KEY: null,
    }, () => composeP1Research({ topic: TOPIC, workDir, fetchImpl }));

    assert.equal(out.ok, false, 'a credential must never become the durable run identity');
    assert.equal(out.code, 'runtime_not_supported');
    assert.equal(fetchImpl.calls.length, 0, 'the refusal must precede any model call');
    assert.equal(fs.existsSync(path.join(workDir, 'orchestration-state.json')), false, 'no checkpoint may be written');
    assert.equal(fs.existsSync(eventsFile(workDir)), false, 'no event may be written');
    assert.equal(fs.readdirSync(workDir).length, 0, 'no run artifact may be created');
    const details = String(out.details ?? '');
    assert.equal(details.includes(SHORT_SYNTHETIC_KEY), false, 'the refusal must not echo the credential');
  }
});

test('I12: a key the SDK would resolve itself cannot be compared, so a profile fails closed', async () => {
  const fetchImpl = fakeModelFetch(() => ({ text: '{}' }));
  await withEnv({
    [modelRuntime.MODEL_API_KEY_ENV]: null,
    [modelRuntime.MODEL_CREDENTIAL_PROFILE_ENV]: null,
    DEEPSEEK_API_KEY: null,
    OPENAI_API_KEY: SDK_ONLY_SYNTHETIC_KEY,
  }, async () => {
    // No explicit key at this layer and no custom endpoint: pi-ai would resolve
    // OPENAI_API_KEY internally, so the profile cannot be proven distinct from it.
    await assert.rejects(
      () => modelRuntime.createModelRuntime({ spec: 'openai/gpt-5.1-mini', credentialProfile: 'account-a', fetchImpl }),
      /credential_profile_invalid/,
      'an unprovable credential must fail closed rather than be persisted',
    );
  });
});
