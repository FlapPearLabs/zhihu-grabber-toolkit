/**
 * research-orchestration/test/global-search-provider.test.mjs
 *
 * P1-T17 focused tests — second retrieval-ranked provider adapter
 * (zhihu-open-platform / global_search; GATE-3 qualification
 * discovery/p1-t03-retrieval-provider-qualification; Approved Spec §5.1 / §5.4;
 * Issue #49).
 *
 * Coverage contract (Issue #49 REQUIRED_TESTS):
 *   - adapter contract tests: §5.1 seam contract all fields (positive + boundary
 *     + negative), explicit provider identity ('zhihu-open-platform', T03
 *     PROVIDER_ID verbatim) + explicit capability identity ('global_search') on
 *     top of the seam's retrieval-ranked `search` capability family;
 *   - completeness semantics NOT guessed (T03 durable limitation): the ONLY
 *     documented completeness signal is the 必返 `HasMore` boolean —
 *     HasMore=true → `partial`, HasMore=false → `complete`, both citing the
 *     provider-reported evidence; a missing/non-boolean HasMore is a response-
 *     contract violation → fail closed (never silently `unknown`/`complete`);
 *     no pagination is invented (no offset/page/cursor parameter exists);
 *   - machine-readable failure semantics; unknown/undocumented upstream errors
 *     → neutral structured identities (never guessed causes); `global_search`
 *     has NO own error-code table → zhihu_search's 10001/20001/30001/90001
 *     families are NEVER ported across documents;
 *   - T03-recorded surface asymmetry NOT masked: the HTTP API doc exposes NO
 *     documented numeric `RankingScore` — ranking ORDER is the evidenced
 *     contract; a numeric score is never synthesized nor propagated;
 *   - NO_SILENT_PROVIDER_FALLBACK: with BOTH retrieval channels registered,
 *     routing without an explicit providerId fails closed; explicit selection
 *     never invokes the sibling channel; a failed channel is never substituted;
 *   - "Official Search + global_search dual-channel RRF" fixture tests: both
 *     REAL adapters registered through the REAL provider seam, executed by the
 *     REAL T06 retrieval pipeline over deterministic offline fixtures, with
 *     exact RRF math, fused channel provenance, and machine-readable rejections.
 *
 * All tests are deterministic and network-free: the HTTP transport is a fake
 * (T03-documented response shape as fixtures), the official adapter's CLI
 * primitive is a fake runner. No credentials exist anywhere in this suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAPABILITY_SEARCH,
  AUTH_CLASS_OFFICIAL_SECRET,
  COMPLETENESS_COMPLETE,
  COMPLETENESS_PARTIAL,
  PROVIDER_ZHIHU_OFFICIAL_SEARCH,
  PROVIDER_ZHIHU_OPEN_PLATFORM,
  ProviderSeamError,
  SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK,
  validateAdapterContract,
  validateProviderResult,
  createProviderSeam,
} from '../lib/provider-seam.mjs';
import { createOfficialSearchAdapter, OFFICIAL_SEARCH_ROUTE } from '../lib/official-search-provider.mjs';
import {
  createGlobalSearchAdapter,
  GLOBAL_SEARCH_ROUTE,
  GLOBAL_SEARCH_CAPABILITY_ID,
} from '../lib/global-search-provider.mjs';
import {
  RETRIEVAL_POOL_FILENAME,
  RETRIEVAL_FAILURE_NO_VALID_CHANNEL,
  RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID,
  runMultiQueryRetrieval,
} from '../lib/retrieval.mjs';
import { RRF_K } from '../lib/rrf.mjs';
import { planHash } from '../lib/plan-contract.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = () => '2026-08-30T12:00:00.000Z';

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'global-search');
function readFixture(...segments) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, ...segments), 'utf8'));
}

/** Deterministic §5.1 gate: every adapter result — success AND failure — must pass. */
function assertSeamValid(result) {
  const verdict = validateProviderResult(result);
  assert.equal(verdict.valid, true, `§5.1 contract violation: ${verdict.reason}`);
}

/**
 * Fake global_search HTTP transport (sync — the seam adapter contract is sync).
 * map: query → { response } | { status, body } | { throwError }
 * Records every request ({ query, count }) for explicit-invocation assertions.
 */
function makeGlobalTransport(map = {}) {
  const calls = [];
  const transport = (request) => {
    calls.push({ query: request.query, count: request.count });
    const entry = map[request.query];
    if (!entry) throw new Error(`unexpected global_search transport call: ${request.query}`);
    if (entry.throwError) throw entry.throwError;
    if (entry.body !== undefined) return { status: entry.status ?? 200, body: entry.body };
    return { status: 200, body: JSON.stringify(entry.response) };
  };
  transport.calls = calls;
  return transport;
}

/** Fake zhihu-search CLI runner (official adapter primitive), same convention as provider-seam.test.mjs. */
function makeOfficialRunner(map = {}) {
  const calls = [];
  const runner = (name, args) => {
    calls.push({ name, args });
    const entry = map[args[0]];
    if (!entry) throw new Error(`unexpected primitive call: ${name} ${args[0]}`);
    if (entry.exit !== undefined) {
      return { status: entry.exit, stdout: entry.stdout ?? '', stderr: entry.stderr ?? '' };
    }
    return {
      status: 0,
      stdout: JSON.stringify({ schemaVersion: 1, ok: true, command: 'search', query: args[0], candidates: entry.candidates }),
      stderr: '',
    };
  };
  runner.calls = calls;
  return runner;
}

function officialCandidate(questionId, title, answerCount) {
  return { questionId, title, answerCount, contentType: '问题', url: `https://www.zhihu.com/question/${questionId}` };
}

const Q1 = '大语言模型 Agent 落地争议';
const Q2 = '智能体 企业落地';
const PLAN = {
  schemaVersion: 1,
  queryVariants: [Q1, Q2],
  aspects: ['技术成熟度'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

function tmpWorkDir(prefix = 'global-search-t17') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

// ---------------------------------------------------------------------------
// A. adapter identity + §5.1 contract floor + success mapping
// ---------------------------------------------------------------------------

test('A1: success mapping — T03-documented response shape becomes §5.1 contract items', () => {
  const transport = makeGlobalTransport({ [Q1]: { response: readFixture('response.complete.json') } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });

  assert.equal(validateAdapterContract(adapter).valid, true);
  assert.equal(adapter.providerId, PROVIDER_ZHIHU_OPEN_PLATFORM, 'provider identity is the T03 PROVIDER_ID, verbatim');
  assert.equal(adapter.capability, CAPABILITY_SEARCH, 'registered under the seam retrieval-ranked capability family');
  assert.equal(adapter.authClass, AUTH_CLASS_OFFICIAL_SECRET, 'same Bearer Access Secret credential family as zhihu_search (T03)');

  const result = adapter.retrieve({ query: Q1 });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  assert.equal(result.provider_id, PROVIDER_ZHIHU_OPEN_PLATFORM);
  assert.equal(result.capability, CAPABILITY_SEARCH);
  assert.equal(result.auth_class, AUTH_CLASS_OFFICIAL_SECRET);
  assert.equal(result.retrieved_at, '2026-08-30T12:00:00.000Z');
  assert.equal(result.capability_id, GLOBAL_SEARCH_CAPABILITY_ID, 'explicit named capability identity (T03 CAPABILITY = global_search)');
  assert.deepEqual(transport.calls, [{ query: Q1, count: 10 }], 'documented default Count=10; adapter forwards only non-credential arguments');

  assert.equal(result.items.length, 2);
  const [first, second] = result.items;
  // T03: an answer item under /question/123/answer/456 canonicalizes to question candidate 123.
  assert.equal(first.identity.kind, 'candidate');
  assert.equal(first.identity.questionId, '123');
  assert.equal(first.provenance.rank, 1);
  assert.equal(first.provenance.rankOrigin, 'global_search_result_order');
  assert.equal(first.provenance.route, GLOBAL_SEARCH_ROUTE);
  assert.equal(first.source_url.url, 'https://www.zhihu.com/question/123/answer/456');
  assert.equal(first.source_url.securityClass, 'external_unverified', 'source_url classified by the SHARED repository classifier');
  assert.deepEqual(first.facts, { title: '大模型落地的真实成本', contentType: 'answer', contentId: 'ans-456', authorityLevel: '3' });

  assert.equal(second.identity.questionId, '200');
  assert.equal(second.provenance.rank, 2);
  assert.equal(second.source_url.url, 'https://www.zhihu.com/question/200');

  assert.equal(result.completeness.status, COMPLETENESS_COMPLETE, 'HasMore=false is the provider-reported end-of-results signal');
  assert.deepEqual(result.completeness.evidence, { basis: 'provider_reported', signal: 'HasMore', hasMore: false });
});

test('A2: HasMore=true → completeness `partial` with the provider-reported evidence (never complete)', () => {
  const transport = makeGlobalTransport({
    q: { response: { Code: 0, Data: { HasMore: true, Items: [{ Title: 't', ContentType: 'question', ContentID: 'c1', AuthorityLevel: '1', Url: 'https://www.zhihu.com/question/700' }] } } },
  });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  assert.equal(result.completeness.status, COMPLETENESS_PARTIAL, 'provider signals more results exist — completeness is partial, not guessed');
  assert.deepEqual(result.completeness.evidence, { basis: 'provider_reported', signal: 'HasMore', hasMore: true });
});

test('A3: empty Items + HasMore=false → ok=true with zero items; completeness stays provider-reported', () => {
  const transport = makeGlobalTransport({ q: { response: { Code: 0, Data: { HasMore: false, Items: [] } } } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
  assert.equal(result.completeness.status, COMPLETENESS_COMPLETE);
  assert.equal(result.completeness.evidence.hasMore, false);
});

test('A4: count contract — ONLY omission (undefined) defaults to 10; explicit 1..20 forwarded; every other value fails closed before IO (E2, round 4)', () => {
  const transport = makeGlobalTransport({
    q: { response: { Code: 0, Data: { HasMore: false, Items: [] } } },
  });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });

  adapter.retrieve({ query: 'q' });
  adapter.retrieve({ query: 'q', count: undefined });
  adapter.retrieve({ query: 'q', count: 1 });
  adapter.retrieve({ query: 'q', count: 20 });
  assert.deepEqual(transport.calls.map((c) => c.count), [10, 10, 1, 20], 'only undefined omission defaults; Count max 20 per T03 request contract');

  for (const bad of [null, 0, 21, -1, 2.5, '5', NaN, true, Infinity, 1e21]) {
    const result = adapter.retrieve({ query: 'q', count: bad });
    assert.equal(result.ok, false, `count value must fail closed: ${String(bad)}`);
    assert.equal(result.failure.code, 'SEARCH_INPUT_INVALID');
    assert.equal(result.failure.class, 'input');
    assertSeamValid(result);
  }
  assert.equal(transport.calls.length, 4, 'no transport IO for statically invalid input — explicit null is NOT a default');
});

test('A5: invalid query → SEARCH_INPUT_INVALID without transport IO', () => {
  const transport = makeGlobalTransport({});
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  for (const query of ['', '   ', null, 42, undefined]) {
    const result = adapter.retrieve({ query });
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'SEARCH_INPUT_INVALID');
    assert.equal(result.failure.class, 'input');
    assertSeamValid(result);
  }
  assert.equal(transport.calls.length, 0);
});

test('A6: missing/non-function transport → TypeError at construction (same contract as the official adapter runner)', () => {
  assert.throws(() => createGlobalSearchAdapter({}), TypeError);
  assert.throws(() => createGlobalSearchAdapter({ transport: 'not-a-function' }), TypeError);
});

// ---------------------------------------------------------------------------
// B. failure semantics — machine-readable, fail-closed, never guessed
// ---------------------------------------------------------------------------

test('B1: transport throws (network/auth-layer error) → PROVIDER_TRANSPORT_FAILURE with default-deny diagnostics', () => {
  const transport = makeGlobalTransport({ q: { throwError: new Error('fetch failed https://host/path?TOKEN=TOPSECRETVALUE') } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_TRANSPORT_FAILURE');
  assert.equal(result.failure.class, 'transport');
  assert.ok(!('provider_error_type' in result.failure), 'D2: transport failure carries NO caller-controlled identity (error names are not guaranteed built-ins)');
  assert.equal(result.failure.detail, 'transport error (diagnostics default-deny)', 'fixed neutral detail only');
  assert.equal(result.completeness.status, 'unknown');
  const dumped = JSON.stringify(result);
  assert.ok(!dumped.includes('TOPSECRETVALUE'), 'raw error message is never echoed (T10 default-deny posture)');
  assert.ok(!dumped.includes('https://host/path'), 'no path/URL leakage through failure detail');
});

test('B2: malformed transport result → PROVIDER_TRANSPORT_CONTRACT_INVALID (fail closed)', () => {
  for (const malformed of [null, undefined, 'ok', { status: '200', body: '{}' }, { status: 200 }, { status: 200, body: 7 }]) {
    const calls = [];
    const adapter = createGlobalSearchAdapter({
      transport: (request) => {
        calls.push({ query: request.query, count: request.count });
        return malformed;
      },
      now: FIXED_NOW,
    });
    const result = adapter.retrieve({ query: 'q' });
    assertSeamValid(result);
    assert.equal(result.ok, false, `malformed transport result must fail closed: ${JSON.stringify(malformed)}`);
    assert.equal(result.failure.code, 'PROVIDER_TRANSPORT_CONTRACT_INVALID');
    assert.equal(result.failure.class, 'contract');
  }
});

test('B3: HTTP non-2xx → PROVIDER_HTTP_ERROR with status-only detail (response body never echoed)', () => {
  const transport = makeGlobalTransport({ q: { status: 403, body: '{"Message":"denied TOKEN=TOPSECRETVALUE"}' } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_HTTP_ERROR');
  assert.equal(result.failure.class, 'provider');
  assert.equal(result.failure.detail, 'HTTP 403', 'machine-readable HTTP status identity; body stays out');
  const dumped = JSON.stringify(result);
  assert.ok(!dumped.includes('TOPSECRETVALUE'));
});

test('B4: non-JSON body → PROVIDER_OUTPUT_UNPARSEABLE, no untrusted body echo', () => {
  const transport = makeGlobalTransport({ q: { status: 200, body: '<html>TOPSECRETVALUE</html>' } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_OUTPUT_UNPARSEABLE');
  assert.equal(result.failure.class, 'contract');
  assert.ok(!JSON.stringify(result).includes('TOPSECRETVALUE'));
});

test('B5: undocumented upstream error Code → neutral PROVIDER_REPORTED_FAILURE + observed code; NO ported zhihu_search error families; Message default-deny (F2)', () => {
  // global_search has NO own error-code table (T03 durable limitation): an
  // unknown non-zero Code must keep its OBSERVED identity, never be classified
  // into the sibling zhihu_search families 10001/20001/30001/90001. The
  // provider-controlled Message is UNTRUSTED provider content — T10 default-deny:
  // it is never returned; only a fixed neutral withholding notice is.
  const transport = makeGlobalTransport({ q: { response: { Code: 99999, Message: 'quota exhausted TOPSECRETVALUE' } } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(result.failure.class, 'provider');
  assert.equal(result.failure.provider_error_type, '99999', 'the OBSERVED envelope code, verbatim');
  for (const ported of ['10001', '20001', '30001', '90001']) {
    assert.notEqual(result.failure.provider_error_type, ported, 'no cross-document error-family porting');
  }
  assert.equal(result.failure.detail, 'provider-reported failure; message withheld (default-deny)', 'fixed neutral notice, no provider Message echo');
  assert.equal(result.completeness.status, 'unknown');
  assert.ok(!JSON.stringify(result).includes('TOPSECRETVALUE'), 'provider Message never reaches any serialized surface');
});

test('B10: sentinel umbrella — NO failure path echoes provider-controlled diagnostics into any serialized surface', () => {
  const SENTINEL = 'TOPSECRETVALUE';
  const hostileNameError = new Error('message irrelevant');
  hostileNameError.name = `Bearer ${SENTINEL}`;
  const scenarios = [
    ['transport throw', () => { throw new Error(`fetch failed ${SENTINEL}`); }],
    ['transport hostile name', () => { throw hostileNameError; }],
    ['transport malformed', () => 'not-an-object'],
    ['http 403 body', () => ({ status: 403, body: `{"Message":"${SENTINEL}"}` })],
    ['non-JSON body', () => ({ status: 200, body: `<html>${SENTINEL}</html>` })],
    ['envelope error message', () => ({ status: 200, body: JSON.stringify({ Code: 42, Message: `${SENTINEL} in message` }) })],
    ['contract violation body', () => ({ status: 200, body: JSON.stringify({ Code: 0, Message: SENTINEL, Data: { HasMore: 'nope', Items: `${SENTINEL}` } }) })],
  ];
  for (const [name, transport] of scenarios) {
    const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
    const result = adapter.retrieve({ query: 'q' });
    assertSeamValid(result);
    assert.equal(result.ok, false, name);
    assert.ok(!JSON.stringify(result).includes(SENTINEL), `sentinel leaked on path: ${name}`);
  }
});

test('B6: JSON body without an envelope Code → PROVIDER_RESULT_CONTRACT_INVALID (envelope contract violation)', () => {
  const transport = makeGlobalTransport({ q: { response: { Data: { HasMore: false, Items: [] } } } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
  assert.equal(result.failure.class, 'contract');
});

test('B7: Code=0 with missing/non-object Data → PROVIDER_RESULT_CONTRACT_INVALID', () => {
  for (const data of [undefined, null, 'nope', 7]) {
    const transport = makeGlobalTransport({ q: { response: { Code: 0, Data: data } } });
    const result = createGlobalSearchAdapter({ transport, now: FIXED_NOW }).retrieve({ query: 'q' });
    assertSeamValid(result);
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
  }
});

test('B8: HasMore missing/non-boolean → PROVIDER_RESULT_CONTRACT_INVALID (documented 必返 signal; completeness never guessed)', () => {
  for (const data of [
    { Items: [] },
    { HasMore: 'true', Items: [] },
    { HasMore: 1, Items: [] },
    { HasMore: null, Items: [] },
  ]) {
    const transport = makeGlobalTransport({ q: { response: { Code: 0, Data: data } } });
    const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
    const result = adapter.retrieve({ query: 'q' });
    assertSeamValid(result);
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
    assert.equal(result.failure.class, 'contract');
  }
});

test('B9: Code=0 with missing/non-array Items → PROVIDER_RESULT_CONTRACT_INVALID', () => {
  for (const items of [undefined, null, 'nope', {}]) {
    const transport = makeGlobalTransport({ q: { response: { Code: 0, Data: { HasMore: false, Items: items } } } });
    const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
    const result = adapter.retrieve({ query: 'q' });
    assertSeamValid(result);
    assert.equal(result.ok, false);
    assert.equal(result.failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
  }
});

// ---------------------------------------------------------------------------
// C. item mapping counterexamples (mixed fixture — T03 field table)
// ---------------------------------------------------------------------------

const MIXED = () => readFixture('response.partial-mixed.json');

test('C1: mixed page — fusible question candidates + explicit per-item failure identities (nothing silently dropped)', () => {
  const transport = makeGlobalTransport({ q: { response: MIXED() } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 5);
  assert.equal(result.completeness.status, COMPLETENESS_PARTIAL);
  assert.equal(result.completeness.evidence.hasMore, true);

  const [fusible, external, secondQuestion, boundary, withBody] = result.items;

  assert.equal(fusible.identity.questionId, '300', 'answer item canonicalizes to its question candidate');
  assert.equal(fusible.provenance.rank, 1);
  assert.equal(fusible.failure, undefined);

  // C2 (PR #73 round 2): global_search is a full-web capability — a well-formed
  // parseable external URL is NOT a malformed contract item; its zhihu question
  // identity is unresolved.
  assert.equal(external.failure.code, 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED', 'external items are unresolved, not malformed');
  assert.equal(external.failure.class, 'provider');
  assert.equal(external.source_url, null, 'a per-item failure never rides beside a source_url');
  assert.equal(external.provenance.rank, 2);

  assert.equal(secondQuestion.identity.questionId, '600', 'a second distinct question item stays a fusible candidate');
  assert.equal(secondQuestion.failure, undefined);
  assert.equal(secondQuestion.provenance.rank, 3);

  assert.equal(boundary.identity.questionId, '400');
  assert.equal(boundary.failure.code, 'SOURCE_URL_BOUNDARY_REJECTED', 'shared classifyUrl verdict, never a weaker parallel policy');
  assert.equal(boundary.failure.class, 'boundary');
  assert.equal(boundary.provenance.rank, 4);

  assert.equal(withBody.identity.questionId, '500');
  assert.equal(withBody.failure, undefined);
  assert.equal(withBody.provenance.rank, 5);
});

test('C2: RankingScore surface asymmetry NOT masked — no numeric score is synthesized or propagated (T03)', () => {
  const transport = makeGlobalTransport({ q: { response: MIXED() } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  const dumped = JSON.stringify(result);
  for (const forbidden of ['RankingScore', 'rankingScore', 'rank_score', '"score"']) {
    assert.ok(!dumped.includes(forbidden), `the undocumented HTTP-API score surface must stay absent: ${forbidden}`);
  }
  // rank provenance is ORDER-based (the evidenced contract), never score-derived.
  const fusible = result.items[0];
  assert.deepEqual(fusible.provenance, { route: GLOBAL_SEARCH_ROUTE, rank: 1, rankOrigin: 'global_search_result_order' });
});

test('C3: ContentText (untrusted corpus) never enters the candidate result surface', () => {
  const transport = makeGlobalTransport({ q: { response: MIXED() } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  const dumped = JSON.stringify(result);
  assert.ok(!dumped.includes('ContentText'));
  assert.ok(!dumped.includes('不可信外部语料正文'));
  const withBody = result.items[4];
  assert.deepEqual(withBody.facts, { title: '带正文的知乎问题', contentType: 'question', contentId: 'q-500', authorityLevel: '2' });
});

// --- F1 repair (PR #73 review): documented Answer/Article item identity ------
//
// The first-party docs example (T03 evidence snapshot) shows bare-answer items
// (Url https://www.zhihu.com/answer/<id>?utm_..., ContentType 'Answer') and
// Article items (zhuanlan-style). These are WELL-FORMED documented shapes whose
// question identity is simply NOT derivable from any documented Item field:
// answer→question resolution is UNKNOWN/undocumented (§18.3 — no invented
// resolution semantics). They must carry CANDIDATE_QUESTION_IDENTITY_UNRESOLVED
// (class 'provider'), NOT CANDIDATE_IDENTITY_INVALID.
//
// Deterministic code path (verified): classifyUrl('https://zhuanlan.zhihu.com/p/…')
// and classifyUrl('https://www.zhihu.com/answer/…') are BOTH clickable=true
// (securityClass 'external_unverified') — the boundary classifier is not what
// distinguishes them; identity resolution runs FIRST, so a zhihu-hosted URL
// without a /question/<qid> segment is UNRESOLVED regardless of the classifier
// verdict, and the classifier is only consulted for actual candidates.

test('C4: documented bare-answer item (docs example shape) → CANDIDATE_QUESTION_IDENTITY_UNRESOLVED, not INVALID; detail default-deny (C4 round 2)', () => {
  const transport = makeGlobalTransport({ q: { response: readFixture('response.docs-example-mixed.json') } });
  const adapter = createGlobalSearchAdapter({ transport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);

  const [answer, article, question] = result.items;
  assert.equal(answer.identity.questionId, '', 'no derivable question identity (never invented)');
  assert.deepEqual(answer.failure, {
    code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED',
    class: 'provider',
    detail: 'provider item carries no derivable zhihu question identity (documented shape; default-deny detail)',
  }, 'well-formed zhihu item whose URL carries no /question/<qid>: question identity UNKNOWN, not malformed; NO provider-controlled detail values (T10 default-deny)');
  assert.equal(answer.source_url, null);
  assert.equal(answer.provenance.rank, 1);
  assert.equal(answer.provenance.route, GLOBAL_SEARCH_ROUTE);

  assert.deepEqual(article.failure, {
    code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED',
    class: 'provider',
    detail: 'provider item carries no derivable zhihu question identity (documented shape; default-deny detail)',
  }, 'zhuanlan-style Article is a parseable URL without a question segment → UNRESOLVED');
  assert.equal(article.provenance.rank, 2);

  assert.equal(question.failure, undefined, 'question-bearing item remains a fusible candidate');
  assert.equal(question.identity.questionId, '700');
  assert.equal(question.provenance.rank, 3);
  assert.deepEqual(question.facts, { title: '合成问题条目（docs 示例形状）', contentType: 'Question', contentId: 'q-700', authorityLevel: '2' });
});

test('C5: CANDIDATE_IDENTITY_INVALID stays strictly for genuinely malformed items', () => {
  const items = ['garbage-string', 42, null, { ContentType: 'Answer', ContentID: 'x' }, { Url: 'not a url at all' }];
  const result = createGlobalSearchAdapter({
    transport: () => ({ status: 200, body: JSON.stringify({ Code: 0, Data: { HasMore: false, Items: items } }) }),
    now: FIXED_NOW,
  }).retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  for (const item of result.items) {
    assert.deepEqual(item.failure, { code: 'CANDIDATE_IDENTITY_INVALID', class: 'contract' }, 'unusable shape (non-object / no usable URL)');
    assert.equal(item.source_url, null);
  }
});

test('C6: page of ONLY documented Answers+Articles → §5.1-valid ok=true result, zero candidates, all identities explicit (no whole-run failure, no silent drop)', () => {
  const page = {
    Code: 0,
    Data: {
      HasMore: true,
      Items: [
        { ContentType: 'Answer', ContentID: '1903044959663284999', Url: 'https://www.zhihu.com/answer/1903044959663284999' },
        { ContentType: 'Article', ContentID: '710000000', Url: 'https://zhuanlan.zhihu.com/p/710000000' },
      ],
    },
  };
  const globalTransport = makeGlobalTransport({ [Q1]: { response: page } });
  const adapter = createGlobalSearchAdapter({ transport: globalTransport, now: FIXED_NOW });
  const result = adapter.retrieve({ query: Q1 });
  assertSeamValid(result);
  assert.equal(result.ok, true, 'a page whose items are all non-candidates is a valid provider result, never a run failure');
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.equal(item.failure.code, 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED');
    assert.equal(item.failure.class, 'provider');
  }

  // Through the REAL T06 pipeline: the channel stays valid, nothing fused,
  // every observation explicit — never a whole-run failure, never a silent drop.
  const seam = createProviderSeam({ adapters: [adapter] });
  const run = runMultiQueryRetrieval({
    plan: { schemaVersion: 1, queryVariants: [Q1], aspects: ['技术成熟度'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] },
    planHash: planHash({ schemaVersion: 1, queryVariants: [Q1], aspects: ['技术成熟度'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] }),
    seam,
    channels: [{ providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }],
    workDir: tmpWorkDir(),
  });
  assert.equal(run.ok, true);
  assert.deepEqual(run.pool.candidates, [], 'no derivable question identity → nothing fused');
  assert.equal(run.pool.rejected.length, 2);
  for (const rejected of run.pool.rejected) {
    assert.deepEqual(rejected.failure, { code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED', class: 'provider' });
    assert.equal(rejected.channel.providerId, PROVIDER_ZHIHU_OPEN_PLATFORM);
  }
});

test('C7: parseable non-zhihu URL → UNRESOLVED, never INVALID (full-web capability; C2 round 2)', () => {
  const page = {
    Code: 0,
    Data: {
      HasMore: false,
      Items: [
        { ContentType: 'article', ContentID: 'ext-1', Url: 'https://www.example.com/article' },
        { ContentType: 'doc', ContentID: 'ext-2', Url: 'https://docs.example.org/guide?page=1' },
        { Title: '合成问题条目', ContentType: 'question', ContentID: 'q-700', AuthorityLevel: '2', Url: 'https://www.zhihu.com/question/700' },
      ],
    },
  };
  const adapter = createGlobalSearchAdapter({ transport: () => ({ status: 200, body: JSON.stringify(page) }), now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  const [first, second, candidate] = result.items;
  assert.deepEqual(first.failure, {
    code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED',
    class: 'provider',
    detail: 'provider item carries no derivable zhihu question identity (documented shape; default-deny detail)',
  });
  assert.deepEqual(second.failure, {
    code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED',
    class: 'provider',
    detail: 'provider item carries no derivable zhihu question identity (documented shape; default-deny detail)',
  });
  assert.equal(candidate.failure, undefined);
  assert.equal(candidate.identity.questionId, '700');
});

test('C8: duplicate question in ONE response passes through the adapter; the frozen T06 FUSION_DUPLICATE_IN_CHANNEL gate owns the failure (C3 round 2)', () => {
  const dupPage = () => readFixture('response.duplicate-questions.json');

  // Adapter level: BOTH same-question items are emitted as candidates — the
  // adapter does NOT run a per-response duplicate policy of its own.
  const adapter = createGlobalSearchAdapter({ transport: makeGlobalTransport({ [Q1]: { response: dupPage() } }), now: FIXED_NOW });
  const result = adapter.retrieve({ query: Q1 });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].identity.questionId, '300');
  assert.equal(result.items[1].identity.questionId, '300', 'duplicates pass through — no adapter-level dedup, no item-order-dependent contributions');
  for (const item of result.items) assert.equal(item.failure, undefined);

  // Through the REAL T06 pipeline, single global channel: the frozen gate fires
  // (whole-channel fail-closed, machine-readable), and NO pool artifact exists.
  const singleSeam = createProviderSeam({ adapters: [adapter] });
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({
    plan: { schemaVersion: 1, queryVariants: [Q1], aspects: ['技术成熟度'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] },
    planHash: planHash({ schemaVersion: 1, queryVariants: [Q1], aspects: ['技术成熟度'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] }),
    seam: singleSeam,
    channels: [{ providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }],
    workDir,
  });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID);
  assert.equal(run.details.code, 'FUSION_DUPLICATE_IN_CHANNEL', 'duplicate policy belongs to the frozen T06/rrf gate');
  assert.ok(!fs.existsSync(path.join(workDir, RETRIEVAL_POOL_FILENAME)), 'no pool artifact on the fail-closed path');

  // Dual-channel: a healthy sibling channel does NOT mask or substitute the
  // duplicate-bearing channel — the gate fires regardless of sibling health.
  const officialRunner = makeOfficialRunner({ [Q1]: { candidates: [officialCandidate('100', '问题一百', 5)] } });
  const globalTransport = makeGlobalTransport({ [Q1]: { response: dupPage() } });
  const dualSeam = createProviderSeam({
    adapters: [
      createOfficialSearchAdapter({ runner: officialRunner, now: FIXED_NOW }),
      createGlobalSearchAdapter({ transport: globalTransport, now: FIXED_NOW }),
    ],
  });
  const dualRun = runMultiQueryRetrieval({
    plan: { schemaVersion: 1, queryVariants: [Q1], aspects: ['技术成熟度'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] },
    planHash: planHash({ schemaVersion: 1, queryVariants: [Q1], aspects: ['技术成熟度'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] }),
    seam: dualSeam,
    channels: [{ providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH }, { providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }],
    workDir: tmpWorkDir(),
  });
  assert.equal(dualRun.ok, false, 'no silent substitution of the duplicate-bearing channel');
  assert.equal(dualRun.details.code, 'FUSION_DUPLICATE_IN_CHANNEL');
  assert.equal(officialRunner.calls.length, 1, 'the sibling channel executed exactly once (failure is not a routing event)');
});

test('C9: UNRESOLVED detail is default-deny — provider ContentType/ContentID sentinels never surface (C4 round 2)', () => {
  const page = {
    Code: 0,
    Data: {
      HasMore: false,
      Items: [
        {
          ContentType: 'TOPSECRET_A',
          ContentID: 'TOPSECRET_B',
          Url: 'https://www.zhihu.com/answer/1903044959663284999?utm_source=TOPSECRET_C',
        },
      ],
    },
  };
  const adapter = createGlobalSearchAdapter({ transport: () => ({ status: 200, body: JSON.stringify(page) }), now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  assert.deepEqual(result.items[0].failure, {
    code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED',
    class: 'provider',
    detail: 'provider item carries no derivable zhihu question identity (documented shape; default-deny detail)',
  });
  const dumped = JSON.stringify(result);
  for (const sentinel of ['TOPSECRET_A', 'TOPSECRET_B', 'TOPSECRET_C']) {
    assert.ok(!dumped.includes(sentinel), `provider-controlled value must never surface: ${sentinel}`);
  }

  // Through the REAL T06 pipeline: rejected entries carry { code, class } only.
  const seam = createProviderSeam({ adapters: [adapter] });
  const plan = { schemaVersion: 1, queryVariants: [Q1], aspects: ['技术成熟度'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] };
  const run = runMultiQueryRetrieval({ plan, planHash: planHash(plan), seam, channels: [{ providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }], workDir: tmpWorkDir() });
  assert.equal(run.ok, true);
  assert.equal(run.pool.rejected.length, 1);
  assert.deepEqual(run.pool.rejected[0].failure, { code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED', class: 'provider' });
  assert.ok(!JSON.stringify(run).includes('TOPSECRET'));
});

// --- D3 repair (PR #73 review round 3): documented required item fields ------
//
// The first-party docs Item table marks Title / ContentType / ContentID /
// AuthorityLevel as 必返 String; the adapter's FACT_FIELDS consume exactly
// these four. For CANDIDATES (items that passed identity classification) the
// documented required-field contract is enforced: any missing/mistyped
// required field → explicit CANDIDATE_FACT_CONTRACT_INVALID (class 'contract')
// — never silent omission, never a fusible candidate with missing required
// facts. Order: identity classification first, THEN required-facts gate, THEN
// classifyUrl boundary, THEN fact copy. Non-required / deliberately-unconsumed
// fields (ContentText, CommentCount, VoteUpCount, Author*, EditTime, …) are
// NOT enforced — absence stays tolerated (documented schema variance beyond
// the consumed surface; no over-strict).

test('C10: candidate required-field contract — missing/mistyped 必返 fields → CANDIDATE_FACT_CONTRACT_INVALID, others unaffected (D3)', () => {
  const good = { Title: '合规条目', ContentType: 'question', ContentID: 'q-800', AuthorityLevel: '2', Url: 'https://www.zhihu.com/question/800' };
  const badVariants = [
    ['missing Title', { ContentType: 'question', ContentID: 'c', AuthorityLevel: '1', Url: 'https://www.zhihu.com/question/810' }],
    ['missing ContentType', { Title: 't', ContentID: 'c', AuthorityLevel: '1', Url: 'https://www.zhihu.com/question/811' }],
    ['missing ContentID', { Title: 't', ContentType: 'question', AuthorityLevel: '1', Url: 'https://www.zhihu.com/question/812' }],
    ['missing AuthorityLevel', { Title: 't', ContentType: 'question', ContentID: 'c', Url: 'https://www.zhihu.com/question/813' }],
    ['number ContentType', { Title: 't', ContentType: 7, ContentID: 'c', AuthorityLevel: '1', Url: 'https://www.zhihu.com/question/814' }],
    ['object ContentID', { Title: 't', ContentType: 'question', ContentID: { nested: true }, AuthorityLevel: '1', Url: 'https://www.zhihu.com/question/815' }],
    ['null AuthorityLevel', { Title: 't', ContentType: 'question', ContentID: 'c', AuthorityLevel: null, Url: 'https://www.zhihu.com/question/816' }],
    // Determinism pin: the facts gate fires BEFORE the boundary gate.
    ['facts gate before boundary gate', { Title: 't', ContentType: 'question', ContentID: 'c', Url: 'http://www.zhihu.com/question/817' }],
  ];
  const items = [good, ...badVariants.map(([, item]) => item)];
  const adapter = createGlobalSearchAdapter({
    transport: () => ({ status: 200, body: JSON.stringify({ Code: 0, Data: { HasMore: false, Items: items } }) }),
    now: FIXED_NOW,
  });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, items.length);

  assert.equal(result.items[0].identity.questionId, '800', 'the compliant item stays a fusible candidate, unaffected');
  assert.equal(result.items[0].failure, undefined);

  for (const [index, [label]] of badVariants.entries()) {
    const item = result.items[index + 1];
    assert.deepEqual(item.failure, { code: 'CANDIDATE_FACT_CONTRACT_INVALID', class: 'contract' }, label);
    assert.equal(item.source_url, null);
    assert.deepEqual(item.facts, {});
    assert.ok(item.identity.questionId.length > 0, `identity classification ran first (${label})`);
  }

  // Through the REAL T06 pipeline: zero fusible contribution from the invalid
  // items; the compliant item unaffected; every rejection machine-readable.
  const seam = createProviderSeam({ adapters: [adapter] });
  const plan = { schemaVersion: 1, queryVariants: [Q1], aspects: ['技术成熟度'], entities: [], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] };
  const run = runMultiQueryRetrieval({ plan, planHash: planHash(plan), seam, channels: [{ providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }], workDir: tmpWorkDir() });
  assert.equal(run.ok, true);
  assert.deepEqual(run.pool.candidates.map((c) => c.identity.questionId), ['800']);
  assert.equal(run.pool.rejected.length, badVariants.length);
  for (const rejected of run.pool.rejected) {
    assert.deepEqual(rejected.failure, { code: 'CANDIDATE_FACT_CONTRACT_INVALID', class: 'contract' });
  }
});

test('C11: exact-URL-only item → CANDIDATE_FACT_CONTRACT_INVALID, never a fusible candidate with empty facts (Codex counterexample, D3)', () => {
  const page = { Code: 0, Data: { HasMore: false, Items: [{ Url: 'https://www.zhihu.com/question/123' }] } };
  const adapter = createGlobalSearchAdapter({ transport: () => ({ status: 200, body: JSON.stringify(page) }), now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  const item = result.items[0];
  assert.equal(item.identity.questionId, '123');
  assert.deepEqual(item.failure, { code: 'CANDIDATE_FACT_CONTRACT_INVALID', class: 'contract' });
  assert.deepEqual(item.facts, {});
  assert.equal(item.source_url, null);
});

test('C12: non-required / unconsumed fields stay tolerated — no over-strict (D3)', () => {
  const page = {
    Code: 0,
    Data: {
      HasMore: false,
      Items: [
        { Title: '仅必返字段', ContentType: 'question', ContentID: 'c1', AuthorityLevel: '2', Url: 'https://www.zhihu.com/question/900' },
        {
          Title: '带可选字段',
          ContentType: 'question',
          ContentID: 'c2',
          AuthorityLevel: '3',
          Url: 'https://www.zhihu.com/question/901',
          CommentCount: 5,
          VoteUpCount: 9,
          AuthorName: '匿名用户',
          EditTime: '2026-01-01',
          ContentText: '不可信正文——仅容忍存在，不消费',
          CommentInfoList: [{ x: 1 }],
        },
      ],
    },
  };
  const adapter = createGlobalSearchAdapter({ transport: () => ({ status: 200, body: JSON.stringify(page) }), now: FIXED_NOW });
  const result = adapter.retrieve({ query: 'q' });
  assertSeamValid(result);
  assert.equal(result.ok, true);
  assert.equal(result.items[0].failure, undefined, 'an item with exactly the required fields stays a candidate');
  assert.equal(result.items[1].failure, undefined, 'extra documented-optional fields are not enforced');
  for (const item of result.items) {
    assert.equal(Object.keys(item.facts).length, 4, 'only the consumed surface is copied');
  }
  const dumped = JSON.stringify(result);
  assert.ok(!dumped.includes('CommentInfoList'));
  assert.ok(!dumped.includes('不可信正文'));
});

// ---------------------------------------------------------------------------
// D. seam integration — explicit routing, identity binding, no silent fallback
// ---------------------------------------------------------------------------

function dualChannelSeam({ officialMap, globalMap } = {}) {
  const officialRunner = makeOfficialRunner(officialMap ?? {
    [Q1]: { candidates: [officialCandidate('100', '问题一百', 5), officialCandidate('200', '问题二百', 3)] },
    [Q2]: { candidates: [officialCandidate('100', '问题一百', 5), officialCandidate('300', '问题三百', 8)] },
  });
  const globalTransport = makeGlobalTransport(globalMap ?? {
    [Q1]: { response: MIXED() },
    [Q2]: { response: readFixture('response.complete.json') },
  });
  const seam = createProviderSeam({
    adapters: [
      createOfficialSearchAdapter({ runner: officialRunner, now: FIXED_NOW }),
      createGlobalSearchAdapter({ transport: globalTransport, now: FIXED_NOW }),
    ],
  });
  return { seam, officialRunner, globalTransport };
}

test('D1: seam route + retrieve binds the zhihu-open-platform identity (explicit providerId only)', () => {
  const { seam, globalTransport } = dualChannelSeam();
  const routed = seam.route(CAPABILITY_SEARCH, { providerId: PROVIDER_ZHIHU_OPEN_PLATFORM });
  assert.equal(routed.providerId, PROVIDER_ZHIHU_OPEN_PLATFORM);

  const result = seam.retrieve(CAPABILITY_SEARCH, { query: Q1 }, { providerId: PROVIDER_ZHIHU_OPEN_PLATFORM });
  assertSeamValid(result);
  assert.equal(result.provider_id, PROVIDER_ZHIHU_OPEN_PLATFORM);
  assert.equal(result.capability_id, GLOBAL_SEARCH_CAPABILITY_ID);
  assert.equal(globalTransport.calls.length, 1, 'exactly the selected channel executed');
});

test('D2: BOTH retrieval channels registered + routing without explicit providerId → NO_SILENT_PROVIDER_FALLBACK', () => {
  const { seam, officialRunner, globalTransport } = dualChannelSeam();
  assert.throws(() => seam.route(CAPABILITY_SEARCH), (err) => err instanceof ProviderSeamError
    && err.code === SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK);
  assert.equal(officialRunner.calls.length, 0, 'no silent pick of the first/any channel');
  assert.equal(globalTransport.calls.length, 0, 'no silent pick of the first/any channel');
});

test('D3: explicit selection never invokes the sibling channel (adapter-level capability isolation)', () => {
  const { seam, officialRunner, globalTransport } = dualChannelSeam();
  seam.retrieve(CAPABILITY_SEARCH, { query: Q1 }, { providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH });
  assert.equal(globalTransport.calls.length, 0, 'official selection must not touch global_search');
  seam.retrieve(CAPABILITY_SEARCH, { query: Q1 }, { providerId: PROVIDER_ZHIHU_OPEN_PLATFORM });
  assert.equal(officialRunner.calls.length, 1, 'global selection must not touch the official primitive');
  assert.equal(globalTransport.calls.length, 1);
});

// ---------------------------------------------------------------------------
// E. Official Search + global_search dual-channel RRF fixtures (REQUIRED_TESTS)
// ---------------------------------------------------------------------------

test('E1: dual-channel RRF fusion — exact math, per-channel provenance, machine-readable rejections', () => {
  const { seam } = dualChannelSeam();
  const workDir = tmpWorkDir();
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: planHash(PLAN),
    seam,
    channels: [{ providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH }, { providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }],
    workDir,
  });
  assert.equal(run.ok, true);
  const pool = run.pool;

  // 4 channel records: 2 queries × 2 explicit channels, registry-bound identity.
  assert.equal(pool.channels.length, 4);
  assert.deepEqual(pool.channels.map((c) => `${c.channel.query}::${c.channel.providerId}`), [
    `${Q1}::${PROVIDER_ZHIHU_OFFICIAL_SEARCH}`,
    `${Q1}::${PROVIDER_ZHIHU_OPEN_PLATFORM}`,
    `${Q2}::${PROVIDER_ZHIHU_OFFICIAL_SEARCH}`,
    `${Q2}::${PROVIDER_ZHIHU_OPEN_PLATFORM}`,
  ]);
  assert.deepEqual(pool.channels.map((c) => c.auth_class), Array(4).fill(AUTH_CLASS_OFFICIAL_SECRET));

  const byChannel = new Map(pool.channels.map((c) => [`${c.channel.query}::${c.channel.providerId}`, c]));
  assert.equal(byChannel.get(`${Q1}::${PROVIDER_ZHIHU_OFFICIAL_SEARCH}`).itemCount, 2);
  assert.equal(byChannel.get(`${Q1}::${PROVIDER_ZHIHU_OFFICIAL_SEARCH}`).completeness.status, 'unknown');
  assert.equal(byChannel.get(`${Q1}::${PROVIDER_ZHIHU_OPEN_PLATFORM}`).itemCount, 5);
  assert.equal(byChannel.get(`${Q1}::${PROVIDER_ZHIHU_OPEN_PLATFORM}`).completeness.status, COMPLETENESS_PARTIAL);
  assert.equal(byChannel.get(`${Q2}::${PROVIDER_ZHIHU_OFFICIAL_SEARCH}`).itemCount, 2);
  assert.equal(byChannel.get(`${Q2}::${PROVIDER_ZHIHU_OPEN_PLATFORM}`).itemCount, 2);
  assert.equal(byChannel.get(`${Q2}::${PROVIDER_ZHIHU_OPEN_PLATFORM}`).completeness.status, COMPLETENESS_COMPLETE);
  assert.equal(byChannel.get(`${Q2}::${PROVIDER_ZHIHU_OPEN_PLATFORM}`).completeness.evidence.hasMore, false);

  // Exact RRF math (canonical accumulation order), candidate order score desc.
  assert.deepEqual(pool.candidates.map((c) => c.identity.questionId), ['100', '300', '200', '123', '600', '500']);
  const score = (questionId) => pool.candidates.find((c) => c.identity.questionId === questionId).rrfScore;
  assert.equal(score('100'), 1 / (RRF_K + 1) + 1 / (RRF_K + 1), '100: official q1 r1 + official q2 r1');
  assert.equal(score('300'), 1 / (RRF_K + 1) + 1 / (RRF_K + 2), '300: global q1 r1 + official q2 r2');
  assert.equal(score('200'), 1 / (RRF_K + 2) + 1 / (RRF_K + 2), '200: official q1 r2 + global q2 r2');
  assert.equal(score('123'), 1 / (RRF_K + 1), '123: global q2 r1 only');
  assert.equal(score('600'), 1 / (RRF_K + 3), '600: global q1 r3 only (distinct second question item)');
  assert.equal(score('500'), 1 / (RRF_K + 5), '500: global q1 r5 only');

  // Fused ranks preserve the §5.4 channel triple + retrieval route/rank origin.
  const ranks = (questionId) => pool.candidates.find((c) => c.identity.questionId === questionId).ranks;
  assert.deepEqual(ranks('300'), [
    { channel: { query: Q1, providerId: PROVIDER_ZHIHU_OPEN_PLATFORM, capability: CAPABILITY_SEARCH }, rank: 1, rankOrigin: 'global_search_result_order', route: GLOBAL_SEARCH_ROUTE },
    { channel: { query: Q2, providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH, capability: CAPABILITY_SEARCH }, rank: 2, rankOrigin: 'official_search_result_order', route: OFFICIAL_SEARCH_ROUTE },
  ]);
  assert.deepEqual(ranks('123'), [
    { channel: { query: Q2, providerId: PROVIDER_ZHIHU_OPEN_PLATFORM, capability: CAPABILITY_SEARCH }, rank: 1, rankOrigin: 'global_search_result_order', route: GLOBAL_SEARCH_ROUTE },
  ]);

  // source_url: canonical-first NON-NULL validated record; facts from canonical-first channel.
  const candidate300 = pool.candidates.find((c) => c.identity.questionId === '300');
  assert.deepEqual(candidate300.source_url, { url: 'https://www.zhihu.com/question/300/answer/9001', securityClass: 'external_unverified' });
  assert.deepEqual(candidate300.facts, { title: '智能体记忆机制综述', contentType: 'answer', contentId: 'ans-9001', authorityLevel: '3' });

  // Rejections: machine-readable identity + contributing channel, nothing silent.
  // C2: the well-formed external item is UNRESOLVED (provider class), not INVALID.
  assert.equal(pool.rejected.length, 2);
  const rejectedByCode = new Map(pool.rejected.map((r) => [r.failure.code, r]));
  const unresolved = rejectedByCode.get('CANDIDATE_QUESTION_IDENTITY_UNRESOLVED');
  assert.deepEqual(unresolved, {
    channel: { query: Q1, providerId: PROVIDER_ZHIHU_OPEN_PLATFORM, capability: CAPABILITY_SEARCH },
    identity: { kind: 'candidate', questionId: '' },
    rank: 2,
    route: GLOBAL_SEARCH_ROUTE,
    failure: { code: 'CANDIDATE_QUESTION_IDENTITY_UNRESOLVED', class: 'provider' },
  });
  const boundary = rejectedByCode.get('SOURCE_URL_BOUNDARY_REJECTED');
  assert.equal(boundary.identity.questionId, '400');
  assert.deepEqual(boundary.failure, { code: 'SOURCE_URL_BOUNDARY_REJECTED', class: 'boundary' });
});

test('E2: explicit single-channel selection — only global_search executes; Official Search untouched', () => {
  const { seam, officialRunner, globalTransport } = dualChannelSeam();
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: planHash(PLAN),
    seam,
    channels: [{ providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }],
    workDir: tmpWorkDir(),
  });
  assert.equal(run.ok, true);
  assert.equal(officialRunner.calls.length, 0, 'NO_SILENT_PROVIDER_FALLBACK: no sibling IO');
  assert.equal(globalTransport.calls.length, 2, 'exactly one call per plan query');
  assert.deepEqual(run.pool.channels.map((c) => c.channel.providerId), [PROVIDER_ZHIHU_OPEN_PLATFORM, PROVIDER_ZHIHU_OPEN_PLATFORM]);
  for (const candidate of run.pool.candidates) {
    for (const rank of candidate.ranks) {
      assert.equal(rank.channel.providerId, PROVIDER_ZHIHU_OPEN_PLATFORM);
      assert.equal(rank.route, GLOBAL_SEARCH_ROUTE);
    }
  }
});

test('E3: explicit single-channel selection — only Official Search executes; global_search untouched', () => {
  const { seam, officialRunner, globalTransport } = dualChannelSeam();
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: planHash(PLAN),
    seam,
    channels: [{ providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH }],
    workDir: tmpWorkDir(),
  });
  assert.equal(run.ok, true);
  assert.equal(globalTransport.calls.length, 0);
  assert.equal(officialRunner.calls.length, 2);
  assert.deepEqual(run.pool.channels.map((c) => c.channel.providerId), [PROVIDER_ZHIHU_OFFICIAL_SEARCH, PROVIDER_ZHIHU_OFFICIAL_SEARCH]);
});

test('E4: BOTH channels registered + channels omitted → FAIL CLOSED (multiple_search_providers_without_explicit_channels), zero provider IO', () => {
  const { seam, officialRunner, globalTransport } = dualChannelSeam();
  const run = runMultiQueryRetrieval({ plan: PLAN, planHash: planHash(PLAN), seam, workDir: tmpWorkDir() });
  assert.equal(run.ok, false);
  assert.equal(run.reason, RETRIEVAL_FAILURE_NO_VALID_CHANNEL);
  assert.equal(run.details.reason, 'multiple_search_providers_without_explicit_channels');
  assert.deepEqual(run.details.candidates, [PROVIDER_ZHIHU_OFFICIAL_SEARCH, PROVIDER_ZHIHU_OPEN_PLATFORM]);
  assert.equal(officialRunner.calls.length, 0);
  assert.equal(globalTransport.calls.length, 0);
});

test('E5: a failed channel is recorded with its machine-readable identity and NEVER substituted', () => {
  const { seam } = dualChannelSeam({
    officialMap: {
      [Q1]: { exit: 1, stderr: 'Authorization failed TOKEN=TOPSECRETVALUE' },
      [Q2]: { exit: 1, stderr: 'Authorization failed TOKEN=TOPSECRETVALUE' },
    },
  });
  const run = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: planHash(PLAN),
    seam,
    channels: [{ providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH }, { providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }],
    workDir: tmpWorkDir(),
  });
  assert.equal(run.ok, true, 'the surviving channel is a valid run — the failed one is recorded, not substituted');
  const officialRecords = run.pool.channels.filter((c) => c.channel.providerId === PROVIDER_ZHIHU_OFFICIAL_SEARCH);
  assert.equal(officialRecords.length, 2);
  for (const record of officialRecords) {
    assert.equal(record.ok, false);
    assert.deepEqual(record.failure, { code: 'PROVIDER_PROCESS_NONZERO_EXIT', class: 'process' });
    assert.equal(record.completeness.status, 'unknown');
  }
  // The surviving channel actually produced candidates (this assertion keeps the
  // no-substitution check from passing vacuously on an empty result).
  assert.equal(run.pool.candidates.length, 5, 'global q1 {300,600,500} + q2 {123,200}');
  // Every fused rank comes from the global channel only — no attribution drift.
  for (const candidate of run.pool.candidates) {
    for (const rank of candidate.ranks) {
      assert.notEqual(rank.channel.providerId, PROVIDER_ZHIHU_OFFICIAL_SEARCH);
      assert.equal(rank.channel.providerId, PROVIDER_ZHIHU_OPEN_PLATFORM);
    }
  }
  // Safe projection: the failing primitive's raw stderr never reaches the pool.
  assert.ok(!JSON.stringify(run).includes('TOPSECRETVALUE'));
});

test('E6: channel-order permutation → identical candidate fusion and identical rejections (deterministic dual-channel RRF)', () => {
  const first = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: planHash(PLAN),
    seam: dualChannelSeam().seam,
    channels: [{ providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH }, { providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }],
    workDir: tmpWorkDir(),
  });
  const second = runMultiQueryRetrieval({
    plan: PLAN,
    planHash: planHash(PLAN),
    seam: dualChannelSeam().seam,
    channels: [{ providerId: PROVIDER_ZHIHU_OPEN_PLATFORM }, { providerId: PROVIDER_ZHIHU_OFFICIAL_SEARCH }],
    workDir: tmpWorkDir(),
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(second.pool.candidates, first.pool.candidates, 'fusion output is permutation-invariant (T06 B2 contract)');
  assert.deepEqual(second.pool.rejected, first.pool.rejected, 'rejected list is permutation-invariant (T06 P1-5)');
  // Channel record ORDER follows descriptor order (only that much differs); the
  // executed channel identity SET is identical.
  assert.deepEqual(
    [...first.pool.channels.map((c) => `${c.channel.query}::${c.channel.providerId}`)].sort(),
    [...second.pool.channels.map((c) => `${c.channel.query}::${c.channel.providerId}`)].sort(),
  );
});
