/**
 * research-orchestration/test/provider-seam.test.mjs
 *
 * P1-T05 focused tests — ZhihuDataProvider / CapabilityProvider seam
 * (Spec §5.1 / §5.4; D-2a delegation boundary; Issue #37).
 *
 * Coverage contract (Issue #37 REQUIRED_TESTS):
 *   - seam contract unit tests (§5.1 field floor, adapter/result validation);
 *   - both adapter contract tests (Official Search + Session/Cookie capture wrapper);
 *   - failure / completeness semantics (machine-readable failure identity, no guessing);
 *   - NO_SILENT_PROVIDER_FALLBACK routing assertions (no substitution, no guessing,
 *     unsupported capability fail-closed, UNKNOWN_PROVIDER_CONTRACT != PASS);
 *   - section F: Issue #37 external CODE_REVIEW repair regressions
 *     (P1-1 result↔adapter identity binding, P1-2 non-zero exit fail-closed,
 *     P1-3 verified===false gate, P2-1 per-item failure semantics).
 *
 * All tests are deterministic and network-free: the CLI primitives are replaced by
 * fake runners recording invocations, mirroring orchestration.test.mjs conventions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_SEARCH,
  CAPABILITY_CAPTURE,
  CAPABILITIES,
  AUTH_CLASS_OFFICIAL_SECRET,
  AUTH_CLASS_OAUTH,
  AUTH_CLASS_SESSION,
  AUTH_CLASSES,
  COMPLETENESS_COMPLETE,
  COMPLETENESS_UNKNOWN,
  COMPLETENESS_STATES,
  PROVIDER_ZHIHU_OFFICIAL_SEARCH,
  PROVIDER_ZHIHU_SESSION_CAPTURE,
  ProviderSeamError,
  SEAM_ERROR_UNSUPPORTED_CAPABILITY,
  SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK,
  SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT,
  SEAM_ERROR_ADAPTER_CONTRACT_INVALID,
  validateAdapterContract,
  validateProviderResult,
  createProviderSeam,
} from '../lib/provider-seam.mjs';
import { createOfficialSearchAdapter } from '../lib/official-search-provider.mjs';
import { createSessionCaptureAdapter } from '../lib/session-capture-provider.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = () => '2026-08-30T12:00:00.000Z';

/** Fake runner (function-shaped, matching orchestrator runner convention) recording every invocation. */
function makeRecordingRunner(handlers = {}) {
  const calls = [];
  const runner = (name, args) => {
    calls.push({ name, args });
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected primitive call: ${name}`);
    return handler(args);
  };
  runner.calls = calls;
  return runner;
}

function searchPayload(candidates) {
  return JSON.stringify({ schemaVersion: 1, ok: true, command: 'search', query: 'q', candidates });
}

function grabPayload(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    ok: true,
    command: 'grab',
    stage: 'captured',
    questionId: '123',
    questionTitle: '测试问题',
    capturedAnswerCount: 3,
    artifacts: { json: 'zhihu/123/answers.json', markdown: 'zhihu/123/answers.md' },
    verified: false,
    warnings: [],
    ...overrides,
  });
}

/** Minimal valid seam result (ok=true) for validator tests. */
function validSearchResult(overrides = {}) {
  return {
    ok: true,
    provider_id: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: '2026-08-30T12:00:00.000Z',
    items: [
      {
        identity: { kind: 'candidate', questionId: '123' },
        provenance: { route: 'zhihu-answer-grabber:search', rank: 1 },
        source_url: { url: 'https://www.zhihu.com/question/123', securityClass: 'external_unverified' },
        facts: {},
      },
    ],
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { signal: 'absent' } },
    ...overrides,
  };
}

function okHandler(body, status = 0) {
  return () => ({ status, stdout: body, stderr: '' });
}

// ---------------------------------------------------------------------------
// A. seam contract — constants and validators
// ---------------------------------------------------------------------------

test('A1: seam constants expose the §5.1 vocabulary', () => {
  assert.deepEqual([...CAPABILITIES].sort(), [CAPABILITY_CAPTURE, CAPABILITY_SEARCH]);
  assert.deepEqual([...AUTH_CLASSES].sort(), [AUTH_CLASS_OAUTH, AUTH_CLASS_OFFICIAL_SECRET, AUTH_CLASS_SESSION].sort());
  assert.deepEqual([...COMPLETENESS_STATES].sort(), ['complete', 'partial', 'unknown']);
  assert.equal(AUTH_CLASS_OFFICIAL_SECRET, 'official-secret');
  assert.equal(AUTH_CLASS_SESSION, 'session');
});

test('A2: validateAdapterContract rejects malformed adapters (fail closed)', () => {
  const base = { providerId: 'p', capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_SESSION, retrieve: () => {} };
  assert.equal(validateAdapterContract(base).valid, true);
  for (const broken of [
    null,
    { ...base, providerId: '' },
    { ...base, providerId: 7 },
    { ...base, capability: 'nonsense' },
    { ...base, authClass: 'bearer-token' },
    { ...base, retrieve: 'not-a-function' },
  ]) {
    const verdict = validateAdapterContract(broken);
    assert.equal(verdict.valid, false, `expected invalid: ${JSON.stringify(broken)}`);
  }
});

test('A3: validateProviderResult enforces the §5.1 result floor', () => {
  assert.equal(validateProviderResult(validSearchResult()).valid, true);

  const cases = [
    ['missing provider_id', validSearchResult({ provider_id: undefined })],
    ['empty provider_id', validSearchResult({ provider_id: '' })],
    ['unknown auth_class', validSearchResult({ auth_class: 'cookie-jar' })],
    ['non-ISO retrieved_at', validSearchResult({ retrieved_at: 'yesterday' })],
    ['missing completeness', validSearchResult({ completeness: undefined })],
    ['bad completeness status', validSearchResult({ completeness: { status: 'COMPLETE', evidence: {} } })],
    ['completeness without evidence', validSearchResult({ completeness: { status: COMPLETENESS_UNKNOWN } })],
    ['ok=true without items array', validSearchResult({ items: null })],
    ['item without identity', validSearchResult({ items: [{ provenance: {}, source_url: null }] })],
    ['item without provenance', validSearchResult({ items: [{ identity: { questionId: '1' }, source_url: null }] })],
    ['item with unvalidated source_url', validSearchResult({
      items: [{ identity: { questionId: '1' }, provenance: {}, source_url: { url: 'http://a.example' } }],
    })],
    ['failure result without failure.code', {
      ...validSearchResult({ ok: false }),
      failure: { class: 'provider' },
      items: [],
    }],
    ['failure result without completeness', {
      ...validSearchResult({ ok: false, items: [] }),
      failure: { code: 'X', class: 'provider' },
      completeness: undefined,
    }],
  ];
  for (const [label, result] of cases) {
    const verdict = validateProviderResult(result);
    assert.equal(verdict.valid, false, `expected invalid: ${label}: ${verdict?.reason ?? ''}`);
  }
});

test('A4: failure result contract is machine-readable (code + class, completeness unknown)', () => {
  const failureResult = {
    ok: false,
    provider_id: PROVIDER_ZHIHU_OFFICIAL_SEARCH,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: '2026-08-30T12:00:00.000Z',
    items: [],
    failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider', detail: 'x', provider_error_type: 'http_403' },
    completeness: { status: COMPLETENESS_UNKNOWN, evidence: { reason: 'provider_failure' } },
  };
  assert.equal(validateProviderResult(failureResult).valid, true);
});

// ---------------------------------------------------------------------------
// B. seam routing — NO_SILENT_PROVIDER_FALLBACK / fail-closed semantics
// ---------------------------------------------------------------------------

function countingAdapter(id, capability, authClass, result = null) {
  let calls = 0;
  return {
    providerId: id,
    capability,
    authClass,
    retrieve() {
      calls += 1;
      return result ?? validSearchResult({ provider_id: id });
    },
    __calls: () => calls,
  };
}

test('B1: unknown capability → UNSUPPORTED_CAPABILITY (fail closed)', () => {
  const seam = createProviderSeam({ adapters: [countingAdapter('p', CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET)] });
  assert.throws(() => seam.route('web-scraping'), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_UNSUPPORTED_CAPABILITY);
});

test('B2: no registered adapter for a known capability → NO_SILENT_PROVIDER_FALLBACK, never substituted', () => {
  // Only a capture adapter exists; asking for search must fail closed.
  const seam = createProviderSeam({ adapters: [countingAdapter('c', CAPABILITY_CAPTURE, AUTH_CLASS_SESSION)] });
  assert.throws(() => seam.route(CAPABILITY_SEARCH), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK);
});

test('B3: explicit providerId mismatch → NO_SILENT_PROVIDER_FALLBACK and the registered adapter is NOT invoked', () => {
  const official = countingAdapter(PROVIDER_ZHIHU_OFFICIAL_SEARCH, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET);
  const seam = createProviderSeam({ adapters: [official] });
  assert.throws(() => seam.route(CAPABILITY_SEARCH, { providerId: 'zhihu-browser-scraper' }), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK);
  assert.equal(official.__calls(), 0, 'no silent fallback invocation happened');
});

test('B4: multiple adapters for one capability without explicit providerId → NO_SILENT_PROVIDER_FALLBACK (D-2 routing stays OPEN, no guessing)', () => {
  const a = countingAdapter('search-a', CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET);
  const b = countingAdapter('search-b', CAPABILITY_SEARCH, AUTH_CLASS_SESSION);
  const seam = createProviderSeam({ adapters: [a, b] });
  assert.throws(() => seam.route(CAPABILITY_SEARCH), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK);
  // explicit providerId disambiguates deterministically
  assert.equal(seam.route(CAPABILITY_SEARCH, { providerId: 'search-b' }).providerId, 'search-b');
});

test('B5: adapter with invalid self-contract is rejected at registration (UNKNOWN contract never passes)', () => {
  assert.throws(() => createProviderSeam({
    adapters: [{ providerId: 'x', capability: 'nonsense', authClass: AUTH_CLASS_SESSION, retrieve: () => {} }],
    now: FIXED_NOW,
  }), (err) => err instanceof ProviderSeamError && err.code === SEAM_ERROR_ADAPTER_CONTRACT_INVALID);
});

test('B6: adapter returning a contract-invalid result → UNKNOWN_PROVIDER_CONTRACT (not PASS)', () => {
  const broken = countingAdapter('broken', CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET, { ok: 'yes' });
  const seam = createProviderSeam({ adapters: [broken] });
  assert.throws(() => seam.retrieve(CAPABILITY_SEARCH, { query: 'q' }), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT);
});

test('B7: listProviders exposes the registered (provider, capability, auth_class) triples', () => {
  const seam = createProviderSeam({
    adapters: [
      countingAdapter(PROVIDER_ZHIHU_OFFICIAL_SEARCH, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET),
      countingAdapter(PROVIDER_ZHIHU_SESSION_CAPTURE, CAPABILITY_CAPTURE, AUTH_CLASS_SESSION),
    ],
  });
  assert.deepEqual(seam.listProviders(), [
    { providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET },
    { providerId: PROVIDER_ZHIHU_SESSION_CAPTURE, capability: CAPABILITY_CAPTURE, authClass: AUTH_CLASS_SESSION },
  ]);
});

// ---------------------------------------------------------------------------
// C. Official Search adapter (wraps existing zhihu-search primitive)
// ---------------------------------------------------------------------------

test('C1: success mapping — candidates become §5.1 contract items with rank provenance', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(searchPayload([
      { questionId: '123', title: '问题一', answerCount: 12, contentType: '问题', url: 'https://www.zhihu.com/question/123' },
      { questionId: '456', title: '问题二', answerCount: null, contentType: '问题', url: 'https://www.zhihu.com/question/456' },
    ])),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: '测试搜索' });

  assert.equal(result.ok, true);
  assert.equal(result.provider_id, PROVIDER_ZHIHU_OFFICIAL_SEARCH);
  assert.equal(result.capability, CAPABILITY_SEARCH);
  assert.equal(result.auth_class, AUTH_CLASS_OFFICIAL_SECRET);
  assert.equal(result.retrieved_at, '2026-08-30T12:00:00.000Z');
  assert.deepEqual(runner.calls, [{ name: 'zhihu-search', args: ['测试搜索', '--json'] }]);

  assert.equal(result.completeness.status, COMPLETENESS_UNKNOWN, 'search output carries no pagination completeness signal — not guessed');
  assert.equal(typeof result.completeness.evidence, 'object');

  assert.equal(result.items.length, 2);
  const [first, second] = result.items;
  assert.equal(first.identity.questionId, '123');
  assert.equal(first.provenance.rank, 1);
  assert.equal(first.provenance.rankOrigin, 'official_search_result_order');
  assert.ok(first.source_url.url.startsWith('https://'));
  assert.equal(typeof first.source_url.securityClass, 'string');
  assert.equal(first.facts.answerCount, 12);
  assert.equal(second.facts.answerCount, null, 'explicit null stays null (missing优于虚构)');
  assert.equal(second.provenance.rank, 2);
});

test('C2: hostile candidate URL is boundary-rejected at the seam (classifyUrl reuse, not reimplemented)', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(searchPayload([
      { questionId: '123', title: 'x', answerCount: null, contentType: '问题', url: 'javascript:alert(1)' },
    ])),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(result.ok, true);
  assert.equal(result.items[0].source_url, null);
  assert.equal(result.items[0].failure.code, 'SOURCE_URL_BOUNDARY_REJECTED');
});

test('C3: provider-reported failure (ok=false JSON) maps to a machine-readable failure identity', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(JSON.stringify({
      schemaVersion: 1, ok: false, command: 'search', error: { type: 'http_403', message: 'denied' },
    }), 1),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(result.failure.class, 'provider');
  assert.equal(result.failure.provider_error_type, 'http_403');
  assert.equal(result.completeness.status, COMPLETENESS_UNKNOWN);
  assert.deepEqual(result.items, []);
});

test('C4: unparseable provider output → PROVIDER_OUTPUT_UNPARSEABLE', () => {
  const runner = makeRecordingRunner({ 'zhihu-search': () => ({ status: 0, stdout: 'boom', stderr: '' }) });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_OUTPUT_UNPARSEABLE');
  assert.equal(result.failure.class, 'contract');
});

test('C5: exit 0 but candidates shape broken → PROVIDER_RESULT_CONTRACT_INVALID', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(JSON.stringify({ schemaVersion: 1, ok: true, command: 'search', query: 'q' })),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
});

test('C6: empty input → SEARCH_INPUT_INVALID without invoking the primitive', () => {
  const runner = makeRecordingRunner({});
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  for (const query of ['', '   ', null, 42]) {
    const result = adapter.retrieve({ query });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'SEARCH_INPUT_INVALID');
    assert.equal(result.failure.class, 'input');
  }
  assert.equal(runner.calls.length, 0);
});

test('C7: empty candidates → ok=true with zero items; completeness stays unknown (not complete)', () => {
  const runner = makeRecordingRunner({ 'zhihu-search': okHandler(searchPayload([])) });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
  assert.equal(result.completeness.status, COMPLETENESS_UNKNOWN);
});

test('C8: seam route + retrieve uses exactly the Official Search adapter (capability isolation of routing)', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(searchPayload([
      { questionId: '123', title: 't', answerCount: 1, contentType: '问题', url: 'https://www.zhihu.com/question/123' },
    ])),
  });
  const seam = createProviderSeam({
    adapters: [
      createOfficialSearchAdapter({ runner, now: FIXED_NOW }),
      createSessionCaptureAdapter({ runner, now: FIXED_NOW }),
    ],
  });
  const result = seam.retrieve(CAPABILITY_SEARCH, { query: 'q' });
  assert.equal(result.ok, true);
  assert.deepEqual(runner.calls.map((c) => c.name), ['zhihu-search'], 'capture primitive must not be invoked for search');
});

// ---------------------------------------------------------------------------
// D. Session/Cookie capture adapter (wraps existing zhihu-grab primitive;
//    does NOT redefine its authority — captured != verified)
// ---------------------------------------------------------------------------

test('D1: success mapping — source group identity, server-is-end completeness evidence, authority preserved', () => {
  const runner = makeRecordingRunner({ 'zhihu-grab': okHandler(grabPayload()) });
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ questionId: '123', outDir: 'work/zhihu' });

  assert.equal(result.ok, true);
  assert.equal(result.provider_id, PROVIDER_ZHIHU_SESSION_CAPTURE);
  assert.equal(result.capability, CAPABILITY_CAPTURE);
  assert.equal(result.auth_class, AUTH_CLASS_SESSION);
  assert.equal(result.retrieved_at, '2026-08-30T12:00:00.000Z');
  assert.deepEqual(runner.calls, [{ name: 'zhihu-grab', args: ['123', '--out-dir', 'work/zhihu', '--json'] }]);

  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.identity.kind, 'source-group');
  assert.equal(item.identity.questionId, '123');
  assert.equal(item.provenance.route, 'zhihu-answer-grabber:grab');
  assert.equal(item.provenance.captureStage, 'captured');
  assert.equal(item.source_url.url, 'https://www.zhihu.com/question/123');
  assert.equal(typeof item.source_url.securityClass, 'string');

  assert.equal(result.completeness.status, COMPLETENESS_COMPLETE, 'grab completion contract: server paging is_end confirmed');
  assert.equal(typeof result.completeness.evidence.basis, 'string');

  assert.equal(result.verified, false, 'wrapper mirrors the primitive: capture is NOT verification');
  assert.equal(result.validity_authority, 'verify-output', 'validity authority is NOT redefined by the wrapper');
  assert.deepEqual(item.facts.artifacts, { json: 'zhihu/123/answers.json', markdown: 'zhihu/123/answers.md' });
  assert.equal(item.facts.capturedAnswerCount, 3);
});

test('D2: invalid questionId / missing outDir → CAPTURE_INPUT_INVALID without invoking the primitive', () => {
  const runner = makeRecordingRunner({});
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  for (const bad of ['12abc', '', '../etc', null, 123]) {
    const result = adapter.retrieve({ questionId: bad, outDir: 'w' });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'CAPTURE_INPUT_INVALID');
    assert.equal(result.failure.class, 'input');
  }
  const result = adapter.retrieve({ questionId: '123', outDir: '' });
  assert.equal(result.failure.code, 'CAPTURE_INPUT_INVALID');
  assert.equal(runner.calls.length, 0, 'no subprocess for statically invalid input');
});

test('D3: captured identity mismatch → CAPTURE_IDENTITY_MISMATCH (controller can judge what failed)', () => {
  const runner = makeRecordingRunner({ 'zhihu-grab': okHandler(grabPayload({ questionId: '456' })) });
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ questionId: '123', outDir: 'w' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'CAPTURE_IDENTITY_MISMATCH');
  assert.equal(result.failure.class, 'contract');
});

test('D4: non-captured stage in payload → PROVIDER_RESULT_CONTRACT_INVALID', () => {
  const runner = makeRecordingRunner({ 'zhihu-grab': okHandler(grabPayload({ stage: 'partial' })) });
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ questionId: '123', outDir: 'w' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
});

test('D5: provider-reported failure keeps provider error type machine-readable', () => {
  const runner = makeRecordingRunner({
    'zhihu-grab': okHandler(JSON.stringify({
      schemaVersion: 1, ok: false, command: 'grab', error: { type: 'network_error', message: 'timeout' },
    }), 1),
  });
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ questionId: '123', outDir: 'w' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(result.failure.provider_error_type, 'network_error');
  assert.equal(result.completeness.status, COMPLETENESS_UNKNOWN);
});

test('D6: non-zero exit without a structured failure report → PROVIDER_PROCESS_NONZERO_EXIT (fail closed)', () => {
  const runner = makeRecordingRunner({ 'zhihu-grab': () => ({ status: 1, stdout: '', stderr: 'fatal' }) });
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ questionId: '123', outDir: 'w' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_PROCESS_NONZERO_EXIT');
  assert.equal(result.failure.class, 'process');
});

test('D7: seam retrieve routes capture to exactly the session adapter', () => {
  const runner = makeRecordingRunner({ 'zhihu-grab': okHandler(grabPayload()) });
  const seam = createProviderSeam({
    adapters: [
      createOfficialSearchAdapter({ runner, now: FIXED_NOW }),
      createSessionCaptureAdapter({ runner, now: FIXED_NOW }),
    ],
  });
  const result = seam.retrieve(CAPABILITY_CAPTURE, { questionId: '123', outDir: 'work/zhihu' });
  assert.equal(result.ok, true);
  assert.deepEqual(runner.calls.map((c) => c.name), ['zhihu-grab'], 'search primitive must not be invoked for capture');
});

// ---------------------------------------------------------------------------
// E. credential hygiene + no-fallback end-to-end
// ---------------------------------------------------------------------------

test('E1: seam outputs never contain credential values (auth_class is a classification, not a secret)', () => {
  const CANARY_SECRET = 'SUPER-SECRET-ACCESS-KEY-CANARY';
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(searchPayload([
      { questionId: '123', title: 't', answerCount: null, contentType: '问题', url: 'https://www.zhihu.com/question/123' },
    ])),
    'zhihu-grab': okHandler(grabPayload()),
  });
  const seam = createProviderSeam({
    adapters: [
      createOfficialSearchAdapter({ runner, now: FIXED_NOW }),
      createSessionCaptureAdapter({ runner, now: FIXED_NOW }),
    ],
  });
  const searchResult = seam.retrieve(CAPABILITY_SEARCH, { query: 'q' });
  const captureResult = seam.retrieve(CAPABILITY_CAPTURE, { questionId: '123', outDir: 'work/zhihu' });
  for (const result of [searchResult, captureResult]) {
    assert.ok(!JSON.stringify(result).includes(CANARY_SECRET), 'no secret material in seam output');
    assert.ok(!JSON.stringify(result).includes('Cookie'), 'no cookie material in seam output');
  }
  // adapter passes only query/flags — never credentials
  for (const call of runner.calls) {
    assert.ok(!call.args.some((a) => String(a).includes(CANARY_SECRET)));
  }
});

test('E2: a failed search does NOT trigger any fallback attempt; subsequent capture runs independently', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(JSON.stringify({
      schemaVersion: 1, ok: false, command: 'search', error: { type: 'http_403', message: 'denied' },
    }), 1),
    'zhihu-grab': okHandler(grabPayload()),
  });
  const seam = createProviderSeam({
    adapters: [
      createOfficialSearchAdapter({ runner, now: FIXED_NOW }),
      createSessionCaptureAdapter({ runner, now: FIXED_NOW }),
    ],
  });
  const failed = seam.retrieve(CAPABILITY_SEARCH, { query: 'q' });
  assert.equal(failed.ok, false);
  const capture = seam.retrieve(CAPTURE_CAPABILITY_SAFE(), { questionId: '123', outDir: 'w' });
  assert.equal(capture.ok, true);
  assert.deepEqual(runner.calls.map((c) => c.name), ['zhihu-search', 'zhihu-grab'],
    'exactly one attempt per retrieve — no silent retry, no silent substitute');
});

// ---------------------------------------------------------------------------
// F. repair regressions (Issue #37 external CODE_REVIEW: P1-1 / P1-2 / P1-3 / P2-1)
// ---------------------------------------------------------------------------

test('F1: P1-1 — result.provider_id not matching the routed adapter → UNKNOWN_PROVIDER_CONTRACT (fail closed)', () => {
  const drift = countingAdapter('search-a', CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET,
    validSearchResult({ provider_id: 'some-other-provider' }));
  const seam = createProviderSeam({ adapters: [drift] });
  assert.throws(() => seam.retrieve(CAPABILITY_SEARCH, { query: 'q' }), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT);
  assert.equal(drift.__calls(), 1, 'adapter ran once; the seam rejected its result identity');
});

test('F2: P1-1 — result.capability not matching the routed adapter → UNKNOWN_PROVIDER_CONTRACT (fail closed)', () => {
  const drift = countingAdapter('search-a', CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET,
    validSearchResult({ capability: CAPABILITY_CAPTURE }));
  const seam = createProviderSeam({ adapters: [drift] });
  assert.throws(() => seam.retrieve(CAPABILITY_SEARCH, { query: 'q' }), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT);
});

test('F3: P1-1 — result.auth_class not matching the routed adapter → UNKNOWN_PROVIDER_CONTRACT (fail closed)', () => {
  const drift = countingAdapter('search-a', CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET,
    validSearchResult({ auth_class: AUTH_CLASS_SESSION }));
  const seam = createProviderSeam({ adapters: [drift] });
  assert.throws(() => seam.retrieve(CAPABILITY_SEARCH, { query: 'q' }), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT);
});

test('F4: P1-1 — matching identity passes the binding (positive control)', () => {
  const seam = createProviderSeam({ adapters: [countingAdapter('search-a', CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET)] });
  const result = seam.retrieve(CAPABILITY_SEARCH, { query: 'q' });
  assert.equal(result.provider_id, 'search-a');
  assert.equal(result.capability, CAPABILITY_SEARCH);
  assert.equal(result.auth_class, AUTH_CLASS_OFFICIAL_SECRET);
});

test('F5: P1-2 — official search: non-zero exit with stdout claiming ok=true fails closed', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(searchPayload([
      { questionId: '123', url: 'https://www.zhihu.com/question/123' },
    ]), 1),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(result.ok, false, 'non-zero exit must never be accepted as success');
  assert.equal(result.failure.code, 'PROVIDER_PROCESS_NONZERO_EXIT');
  assert.equal(result.failure.class, 'process');
  assert.deepEqual(result.items, []);
  assert.equal(validateProviderResult(result).valid, true, 'failure stays machine-readable');
});

test('F6: P1-2 — session capture: non-zero exit with stdout claiming ok=true fails closed', () => {
  const runner = makeRecordingRunner({ 'zhihu-grab': okHandler(grabPayload(), 1) });
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ questionId: '123', outDir: 'w' });
  assert.equal(result.ok, false, 'non-zero exit must never be accepted as success');
  assert.equal(result.failure.code, 'PROVIDER_PROCESS_NONZERO_EXIT');
  assert.equal(result.failure.class, 'process');
  assert.deepEqual(result.items, []);
  assert.equal(validateProviderResult(result).valid, true, 'failure stays machine-readable');
});

test('F7: P1-2 — non-zero exit still preserves a structured ok:false provider failure identity (detail default-deny)', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(JSON.stringify({
      schemaVersion: 1, ok: false, command: 'search', error: { type: 'http_403', message: 'denied' },
    }), 1),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(result.failure.class, 'provider');
  assert.equal(result.failure.provider_error_type, 'http_403', 'machine-readable provider error detail preserved');
  // Contract update (P1 final cheap cleanup, T10 default-deny): the raw provider
  // message ('denied') is no longer echoed — the detail is the fixed neutral
  // withholding notice; the machine-readable identity (code + class +
  // provider_error_type) is unchanged.
  assert.equal(result.failure.detail, 'provider-reported failure; message withheld (default-deny)');
  assert.ok(!JSON.stringify(result).includes('denied'), 'provider message never reaches any serialized surface');
});

test('F8: P1-3 — stage=captured + verified=true → PROVIDER_RESULT_CONTRACT_INVALID (fail closed, never propagated)', () => {
  const runner = makeRecordingRunner({ 'zhihu-grab': okHandler(grabPayload({ verified: true })) });
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ questionId: '123', outDir: 'w' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
  assert.equal(result.failure.class, 'contract');
  assert.equal(result.verified, undefined, 'no verified claim escapes the gate');
  assert.equal(validateProviderResult(result).valid, true, 'failure stays machine-readable');
});

test('F9: P1-3 — stage=captured without verified:false → PROVIDER_RESULT_CONTRACT_INVALID (strict === false gate)', () => {
  const runner = makeRecordingRunner({ 'zhihu-grab': okHandler(grabPayload({ verified: undefined })) });
  const adapter = createSessionCaptureAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ questionId: '123', outDir: 'w' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
});

test('F10: P2-1 — invalid candidate identity surfaces as a per-item failure through the seam (not whole-result rejection)', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(searchPayload([
      { title: 'no id', url: 'https://www.zhihu.com/question/999' },
      { questionId: '123', url: 'https://www.zhihu.com/question/123' },
    ])),
  });
  const seam = createProviderSeam({ adapters: [createOfficialSearchAdapter({ runner, now: FIXED_NOW })] });
  const result = seam.retrieve(CAPABILITY_SEARCH, { query: 'q' });
  assert.equal(result.ok, true, 'per-item failure must not invalidate the whole result');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].failure.code, 'CANDIDATE_IDENTITY_INVALID');
  assert.equal(result.items[1].identity.questionId, '123');
  assert.equal(validateProviderResult(result).valid, true, 'validator accepts failed items lacking questionId');
});

test('F11: P2-1 — validator accepts failed items lacking questionId; still rejects such success items', () => {
  const failedItem = validSearchResult({
    items: [
      {
        identity: { kind: 'candidate', questionId: '' },
        provenance: { route: 'zhihu-answer-grabber:search', rank: 1 },
        source_url: null,
        failure: { code: 'CANDIDATE_IDENTITY_INVALID', class: 'contract' },
      },
    ],
  });
  assert.equal(validateProviderResult(failedItem).valid, true, 'per-item failure with empty questionId is valid');
  assert.equal(validateProviderResult(validSearchResult({
    items: [{ identity: { kind: 'candidate', questionId: '' }, provenance: { route: 'r' }, source_url: null }],
  })).valid, false, 'success items still require a non-empty questionId');
});

// ---------------------------------------------------------------------------
// G. T10 default-deny — official-search diagnostic normalization (P1 final
//    cheap cleanup; same durable security invariant as T10 / T17):
//    provider / CLI / process-controlled free text (error.message, stderr,
//    stdout, any open-ended subprocess output) must NEVER enter any serialized
//    failure surface — detail is a fixed neutral string; provider_error_type
//    carries only a bounded identifier-shaped structured identity (the CLI
//    machine contract's stable classifyError enumeration), everything else is
//    omitted. Mirrors the T17 global_search sentinel pattern
//    (global-search-provider.test.mjs B-series).
// ---------------------------------------------------------------------------

const REPORTED_FAILURE_NEUTRAL_DETAIL = 'provider-reported failure; message withheld (default-deny)';
const NONZERO_EXIT_NEUTRAL_DETAIL = 'provider process exited with non-zero status; output withheld (default-deny)';
const UNPARSEABLE_NEUTRAL_DETAIL = 'provider output was not parseable JSON; output withheld (default-deny)';

test('G1: provider-reported failure via non-zero exit — neutral detail, message sentinel never surfaces', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(JSON.stringify({
      schemaVersion: 1, ok: false, command: 'search', error: { type: 'http_error', message: 'denied TOPSECRETVALUE' },
    }), 1),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(validateProviderResult(result).valid, true, 'failure stays machine-readable');
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(result.failure.class, 'provider');
  assert.equal(result.failure.provider_error_type, 'http_error', 'enumerated structured identity preserved');
  assert.equal(result.failure.detail, REPORTED_FAILURE_NEUTRAL_DETAIL);
  assert.ok(!JSON.stringify(result).includes('TOPSECRETVALUE'), 'provider message never reaches any serialized surface');
});

test('G2: structured ok:false without a message no longer falls back to stderr/stdout echo (default-deny)', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': () => ({
      status: 1,
      stdout: JSON.stringify({ schemaVersion: 1, ok: false, command: 'search', error: { type: 'http_error' } }),
      stderr: 'Authorization failed TOPSECRETVALUE',
    }),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(validateProviderResult(result).valid, true);
  assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(result.failure.detail, REPORTED_FAILURE_NEUTRAL_DETAIL);
  assert.ok(!JSON.stringify(result).includes('TOPSECRETVALUE'), 'stderr echo must never surface');
});

test('G3: non-zero exit without a structured report — neutral detail; stderr/stdout sentinels never surface', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': () => ({ status: 1, stdout: `panic: TOPSECRETVALUE`, stderr: `FATAL: TOPSECRETVALUE` }),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(validateProviderResult(result).valid, true);
  assert.equal(result.failure.code, 'PROVIDER_PROCESS_NONZERO_EXIT');
  assert.equal(result.failure.class, 'process');
  assert.equal(result.failure.detail, NONZERO_EXIT_NEUTRAL_DETAIL);
  assert.ok(!JSON.stringify(result).includes('TOPSECRETVALUE'), 'process output must never surface');
});

test('G4: unparseable output — neutral detail; stdout/stderr sentinels never surface', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': () => ({ status: 0, stdout: `<html>TOPSECRETVALUE</html>`, stderr: `warn: TOPSECRETVALUE` }),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(validateProviderResult(result).valid, true);
  assert.equal(result.failure.code, 'PROVIDER_OUTPUT_UNPARSEABLE');
  assert.equal(result.failure.class, 'contract');
  assert.equal(result.failure.detail, UNPARSEABLE_NEUTRAL_DETAIL);
  assert.ok(!JSON.stringify(result).includes('TOPSECRETVALUE'), 'raw output echo must never surface');
});

test('G5: provider_error_type carries only a bounded identifier-shaped structured identity; hostile values are omitted on every path', () => {
  const HOSTILE_TYPES = [
    'http_error\nTOPSECRETVALUE', // multi-line injection
    'token=TOPSECRETVALUE', // credential-assignment shape
    '/home/user/TOPSECRETVALUE', // machine-private path shape
    `Bearer ${'x'.repeat(120)} TOPSECRETVALUE`, // over-length free text
    123, // non-string
    { nested: 'TOPSECRETVALUE' }, // structured non-identity
    '',
    '   ',
  ];
  for (const hostileType of HOSTILE_TYPES) {
    for (const [label, handler] of [
      ['exit 0', okHandler(JSON.stringify({
        schemaVersion: 1, ok: false, command: 'search', error: { type: hostileType, message: 'm' },
      }))],
      ['non-zero exit', okHandler(JSON.stringify({
        schemaVersion: 1, ok: false, command: 'search', error: { type: hostileType, message: 'm' },
      }), 1)],
    ]) {
      const runner = makeRecordingRunner({ 'zhihu-search': handler });
      const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
      const result = adapter.retrieve({ query: 'q' });
      assert.equal(validateProviderResult(result).valid, true, `${label}: failure stays machine-readable`);
      assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE', label);
      assert.equal(result.failure.detail, REPORTED_FAILURE_NEUTRAL_DETAIL, label);
      assert.ok(!('provider_error_type' in result.failure), `${label}: non-identity error.type (${typeof hostileType}) is omitted, never echoed`);
      assert.ok(!JSON.stringify(result).includes('TOPSECRETVALUE'), `${label}: hostile error.type must never surface`);
    }
  }
});

test('G6: positive control — the documented CLI classifyError enumeration crosses the structural gate verbatim', () => {
  for (const type of [
    'configuration_error',
    'question_metadata_identity_conflict',
    'http_error',
    'invalid_input',
    'network_error',
    'unknown_error',
  ]) {
    const runner = makeRecordingRunner({
      'zhihu-search': okHandler(JSON.stringify({
        schemaVersion: 1, ok: false, command: 'search', error: { type, message: 'm' },
      })),
    });
    const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
    const result = adapter.retrieve({ query: 'q' });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE');
    assert.equal(result.failure.provider_error_type, type, `enumerated identity preserved verbatim: ${type}`);
  }
});

test('G7: claimed-ok non-zero exit keeps the bounded mechanical status detail; stdout sentinels never surface', () => {
  const runner = makeRecordingRunner({
    'zhihu-search': okHandler(searchPayload([
      { questionId: '123', title: 'TOPSECRETVALUE', url: 'https://www.zhihu.com/question/123' },
    ]), 1),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assert.equal(validateProviderResult(result).valid, true);
  assert.equal(result.failure.code, 'PROVIDER_PROCESS_NONZERO_EXIT');
  assert.equal(result.failure.detail, 'primitive exited with status 1 but stdout claimed ok=true',
    'adapter-constructed mechanical fact (exit status number only) is the one allowed non-neutral detail');
  assert.ok(!JSON.stringify(result).includes('TOPSECRETVALUE'), 'claimed-ok stdout content must never surface');
});

test('G8: sentinel umbrella — NO official-search failure path echoes provider/CLI/process-controlled text into any serialized surface', () => {
  const SENTINEL = 'TOPSECRETVALUE';
  const structuredStdout = JSON.stringify({
    schemaVersion: 1, ok: false, command: 'search', error: { type: 'http_error', message: `denied: ${SENTINEL}` },
  });
  const scenarios = [
    ['non-zero exit + structured provider message', () => ({ status: 1, stdout: structuredStdout, stderr: '' })],
    ['non-zero exit + structured error without message (stderr fallback)', () => ({
      status: 1,
      stdout: JSON.stringify({ schemaVersion: 1, ok: false, command: 'search', error: { type: 'http_error' } }),
      stderr: `Authorization failed ${SENTINEL}`,
    })],
    ['non-zero exit + non-JSON stdout', () => ({ status: 1, stdout: `panic: ${SENTINEL}`, stderr: `FATAL: ${SENTINEL}` })],
    ['non-zero exit + stdout claiming ok=true', () => ({
      status: 1,
      stdout: searchPayload([{ questionId: '123', title: SENTINEL, url: 'https://www.zhihu.com/question/123' }]),
      stderr: '',
    })],
    ['exit 0 + non-JSON stdout', () => ({ status: 0, stdout: `<html>${SENTINEL}</html>`, stderr: `warn: ${SENTINEL}` })],
    ['exit 0 + ok:false provider message', () => ({
      status: 0,
      stdout: JSON.stringify({ schemaVersion: 1, ok: false, command: 'search', error: { type: 'network_error', message: `server said ${SENTINEL}` } }),
      stderr: '',
    })],
    ['exit 0 + ok:false hostile error.type', () => ({
      status: 0,
      stdout: JSON.stringify({ schemaVersion: 1, ok: false, command: 'search', error: { type: `http_error ${SENTINEL}`, message: 'm' } }),
      stderr: '',
    })],
    ['exit 0 + candidates shape broken (sentinel stdout)', () => ({
      status: 0,
      stdout: JSON.stringify({ schemaVersion: 1, ok: true, command: 'search', note: SENTINEL }),
      stderr: '',
    })],
  ];
  for (const [name, handler] of scenarios) {
    const runner = makeRecordingRunner({ 'zhihu-search': handler });
    const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
    const result = adapter.retrieve({ query: 'q' });
    assert.equal(validateProviderResult(result).valid, true, `${name}: failure stays machine-readable`);
    assert.equal(result.ok, false, name);
    assert.ok(!JSON.stringify(result).includes(SENTINEL), `sentinel leaked on path: ${name}`);
  }
  // input boundary: the caller-supplied query itself is never echoed into any
  // failure result (sentinel travels AS the query; the failure carries no echo)
  const runner = makeRecordingRunner({
    'zhihu-search': () => ({ status: 1, stdout: structuredStdout, stderr: '' }),
  });
  const adapter = createOfficialSearchAdapter({ runner, now: FIXED_NOW });
  const result = adapter.retrieve({ query: SENTINEL });
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.ok(!JSON.stringify(result).includes(SENTINEL), 'the query value must never be echoed into a failure result');
});

// helper kept at bottom to avoid hoisting confusion
function CAPTURE_CAPABILITY_SAFE() {
  return CAPABILITY_CAPTURE;
}
