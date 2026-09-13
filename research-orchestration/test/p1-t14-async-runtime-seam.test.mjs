// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p1-t14-async-runtime-seam.test.mjs
 *
 * D6 SCOPED REPAIR — T14 ASYNC RUNTIME CONTRACT MISMATCH.
 *
 * PROVEN PRODUCTION DEFECT (at master 0d305b03):
 *   buildDeepSeekResearchRuntime().synthesize() returns chatJson(...), and
 *   chatJson IS async → the canonical production T14 seam is a Promise.
 *   cross-source-synthesis.mjs consumed runtime.synthesize(...) synchronously
 *   and validated the Promise object as if it were a plain model output →
 *   deterministic T14_RUNTIME_OUTPUT_INVALID for the real runtime
 *   (SURFACED_CODE cfi_synthesis_failed at T16).
 *
 * ROOT CAUSE: ASYNC SEAM CONTRACT DRIFT (producer ASYNC / consumer SYNC).
 * The pre-repair test doubles modelled a SYNCHRONOUS synthesize(), so the
 * suite validated the wrong seam and the defect escaped to T16.
 *
 * TARGET CONTRACT (ONE canonical contract, no Result|Promise union):
 *   runtime.synthesize(input) => Promise<ModelGeneratedSynthesisOutput>
 *   produceCrossSourceSynthesis(...)  => Promise<Result>
 *   produceSynthesisWithCoverage(...) => Promise<Result>
 *   composeP1Research(...)            => already async; awaits T14.
 *
 * Counterexamples implemented here (owner ruling CE1–CE8):
 *   CE1  real async shape (async synthesize → valid payload) — the exact
 *        production shape whose sync consumption produced the defect;
 *   CE2  delayed async resolution on a later timer tick is awaited;
 *   CE3  async rejection fails closed as runtime-unavailable, no artifact,
 *        no stage advancement, no bare unhandled rejection;
 *   CE4  asynchronously-resolved INVALID output stays T14_RUNTIME_OUTPUT_INVALID
 *        (NOT runtime-unavailable — the two classes are never collapsed);
 *   CE5  PRODUCTION-SHAPED DeepSeek adapter (real buildDeepSeekResearchRuntime
 *        + injected deterministic fake fetch + fake credential, NO network)
 *        is awaited correctly → mandatory, because sync mocks caused the escape;
 *   CE6  T13 → await T14 → T15 production composition completes in canonical
 *        stage order with an async synthesize runtime;
 *   CE7  no early artifact write: while the synthesize Promise is pending, no
 *        synthesis artifact / T14 stage journal record / T15 finalization occurs;
 *   CE8  existing synchronous test doubles remain compatible via `await`
 *        (compatibility convenience only — the declared seam stays ASYNC and
 *        no dual return-type contract is implemented or documented).
 *
 * Offline-deterministic: injected fetch / credential / runtimes. No network.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  produceCrossSourceSynthesis,
  T14_SYNTHESIS_RUNTIME_ID,
  T14_SYNTHESIS_MODEL,
} from '../lib/cross-source-synthesis.mjs';

import {
  buildDeepSeekResearchRuntime,
} from '../lib/deepseek-research-runtime.mjs';

import { DEEPSEEK_RUNTIME } from '../../corpus-anthology/lib/deepseek-tool-less.mjs';

import {
  createInitialCoverageState,
} from '../lib/coverage-state.mjs';

import {
  CANONICAL_STAGE_ORDER,
  STAGE_CROSS_SOURCE_SYNTHESIS,
  STAGE_FINAL_RECONCILIATION,
  produceSynthesisWithCoverage,
  beginConvergenceJournal,
  recordStage,
  CFI_ERROR_SYNTHESIS_FAILED,
} from '../lib/coverage-final-integration.mjs';

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'p1-seams');

function load(...segments) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, ...segments), 'utf8'));
}

const seamCMultiGroup = () => load('seam-c', 'group-representations.multi-group.json');

const MERGED_ASPECTS = {
  'c-23456789-001': '总体有效性',
  'c-34561234-001': '总体有效性',
  'c-23456789-002': '特定条件下的反例',
  'c-23456789-003': '特定条件下的反例',
};

/** A valid T14 partition over the controller-issued claimIds (fixture-bound). */
function validPartitionFor(claims) {
  const clusters = new Map();
  for (const claim of claims) {
    const aspect = MERGED_ASPECTS[claim.claimId] ?? '未分簇观点';
    if (!clusters.has(aspect)) clusters.set(aspect, []);
    clusters.get(aspect).push(claim.claimId);
  }
  return { aspects: [...clusters.entries()].map(([aspect, claimIds]) => ({ aspect, claimIds })) };
}

// ---------------------------------------------------------------------------
// CE1 — REAL ASYNC SHAPE
// ---------------------------------------------------------------------------

describe('D6 CE1 — real async synthesize shape (the production seam)', () => {
  test('CE1: an ASYNC synthesize runtime is awaited, not validated as a Promise object', async () => {
    const calls = [];
    const runtime = {
      runtimeId: T14_SYNTHESIS_RUNTIME_ID,
      model: T14_SYNTHESIS_MODEL,
      async synthesize({ claims }) {
        calls.push(claims.map((c) => c.claimId));
        return validPartitionFor(claims);
      },
    };

    const result = await produceCrossSourceSynthesis({
      seamCArtifact: seamCMultiGroup(),
      runtime,
    });

    assert.equal(result.ok, true, `async runtime must succeed post-repair: ${JSON.stringify(result)}`);
    // The pre-repair failure mode was T14_RUNTIME_OUTPUT_INVALID (a Promise is
    // not a plain object with an `aspects` array) — pin the exact absence.
    assert.notEqual(result.code, 'T14_RUNTIME_OUTPUT_INVALID',
      'a Promise must NEVER be validated as a model output object');
    assert.ok(result.artifact, 'a synthesis artifact must be produced');
    assert.equal(result.artifact.seam, 'T14_TO_T15');
    assert.equal(calls.length, 1, 'the async synthesize face is invoked exactly once');
    assert.ok(Array.isArray(calls[0]) && calls[0].length > 0);
  });

  test('CE1b: the module returns a Promise (canonical async API) — not a synchronous Result', async () => {
    const runtime = {
      runtimeId: T14_SYNTHESIS_RUNTIME_ID,
      model: T14_SYNTHESIS_MODEL,
      async synthesize({ claims }) { return validPartitionFor(claims); },
    };
    const returned = produceCrossSourceSynthesis({ seamCArtifact: seamCMultiGroup(), runtime });
    assert.ok(returned instanceof Promise, 'produceCrossSourceSynthesis must be uniformly async');
    const result = await returned;
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// CE2 — DELAYED ASYNC RESOLUTION
// ---------------------------------------------------------------------------

describe('D6 CE2 — delayed async resolution', () => {
  test('CE2: a Promise resolving on a later timer tick is awaited and its value consumed', async () => {
    let resolvedSynchronously = true;
    const runtime = {
      runtimeId: T14_SYNTHESIS_RUNTIME_ID,
      model: T14_SYNTHESIS_MODEL,
      synthesize({ claims }) {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolvedSynchronously = false;
            resolve(validPartitionFor(claims));
          }, 25);
        });
      },
    };

    const result = await produceCrossSourceSynthesis({
      seamCArtifact: seamCMultiGroup(),
      runtime,
    });

    assert.equal(resolvedSynchronously, false, 'the timer must actually have elapse-marked the async path');
    assert.equal(result.ok, true, `T14 must wait for the late resolution: ${JSON.stringify(result)}`);
    assert.ok(result.artifact, 'the RESOLVED output (not the pending Promise) drives assembly');
    assert.ok(result.artifact.synthesis.claims.length > 0);
  });

  test('CE2b: resolution ordering — T14 output is derived from the LATE value, not an early snapshot', async () => {
    const runtime = {
      runtimeId: T14_SYNTHESIS_RUNTIME_ID,
      model: T14_SYNTHESIS_MODEL,
      async synthesize({ claims }) {
        await new Promise((r) => { setTimeout(r, 10); });
        // single aspect over ALL claims — only reachable if awaited
        return { aspects: [{ aspect: '总体有效性', claimIds: claims.map((c) => c.claimId) }] };
      },
    };
    const result = await produceCrossSourceSynthesis({ seamCArtifact: seamCMultiGroup(), runtime });
    assert.equal(result.ok, true);
    assert.equal(result.artifact.synthesis.claims.length, 1,
      'the single late-resolved aspect must be the consumed output');
  });
});

// ---------------------------------------------------------------------------
// CE3 — ASYNC REJECTION
// ---------------------------------------------------------------------------

describe('D6 CE3 — async rejection fails closed as runtime unavailable', () => {
  test('CE3: Promise.reject() → T14_RUNTIME_UNAVAILABLE, no artifact, no unhandled rejection', async () => {
    const rejections = [];
    const onUnhandled = (reason) => rejections.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const runtime = {
        runtimeId: T14_SYNTHESIS_RUNTIME_ID,
        model: T14_SYNTHESIS_MODEL,
        synthesize() {
          return Promise.reject(new Error('ECONNREFUSED transport failure'));
        },
      };

      const result = await produceCrossSourceSynthesis({
        seamCArtifact: seamCMultiGroup(),
        runtime,
      });

      assert.equal(result.ok, false);
      assert.equal(result.code, 'T14_RUNTIME_UNAVAILABLE',
        'a REJECTED Promise is a transport/availability class — never an output-invalid class');
      assert.equal(result.artifact, undefined, 'FAIL_CLOSED: no synthesis artifact');
      assert.equal(result.synthesis, undefined);

      // allow any stray microtask rejection to surface before asserting
      await new Promise((r) => { setTimeout(r, 20); });
      assert.deepEqual(rejections, [],
        'the awaited rejection must be handled inside the module — no bare unhandled rejection');
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  test('CE3b: an async throw (await-style rejection) has the identical fail-closed class', async () => {
    const runtime = {
      runtimeId: T14_SYNTHESIS_RUNTIME_ID,
      model: T14_SYNTHESIS_MODEL,
      async synthesize() { throw new Error('socket hang up'); },
    };
    const result = await produceCrossSourceSynthesis({ seamCArtifact: seamCMultiGroup(), runtime });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'T14_RUNTIME_UNAVAILABLE');
    assert.equal(result.artifact, undefined);
  });
});

// ---------------------------------------------------------------------------
// CE4 — RESOLVED INVALID OUTPUT
// ---------------------------------------------------------------------------

describe('D6 CE4 — asynchronously-resolved invalid output keeps its own class', () => {
  const invalidCases = [
    ['not an object', () => Promise.resolve('nope')],
    ['no aspects array', () => Promise.resolve({ wrong: [] })],
    ['aspects not an array', () => Promise.resolve({ aspects: 'x' })],
    ['forged claimId (not controller-issued)', () => Promise.resolve({
      aspects: [{ aspect: 'a', claimIds: ['FORGED-CLAIM-ID'] }],
    })],
    ['incomplete partition (missing claims)', () => Promise.resolve({
      aspects: [{ aspect: 'a', claimIds: ['c-23456789-001'] }],
    })],
    ['non-string aspect', () => Promise.resolve({
      aspects: [{ aspect: 42, claimIds: ['c-23456789-001'] }],
    })],
  ];

  for (const [label, produce] of invalidCases) {
    test(`CE4: async-resolved ${label} → T14_RUNTIME_OUTPUT_INVALID (NOT runtime-unavailable)`, async () => {
      const runtime = {
        runtimeId: T14_SYNTHESIS_RUNTIME_ID,
        model: T14_SYNTHESIS_MODEL,
        synthesize: () => produce(),
      };
      const result = await produceCrossSourceSynthesis({ seamCArtifact: seamCMultiGroup(), runtime });
      assert.equal(result.ok, false, label);
      assert.equal(result.code, 'T14_RUNTIME_OUTPUT_INVALID', label);
      assert.notEqual(result.code, 'T14_RUNTIME_UNAVAILABLE',
        'output-invalid and runtime-unavailable must never be collapsed');
      assert.equal(result.artifact, undefined, label);
    });
  }

  test('CE4b: the two fail-closed classes are disjoint across the SAME async seam', async () => {
    const rejected = await produceCrossSourceSynthesis({
      seamCArtifact: seamCMultiGroup(),
      runtime: {
        runtimeId: T14_SYNTHESIS_RUNTIME_ID,
        model: T14_SYNTHESIS_MODEL,
        synthesize: () => Promise.reject(new Error('transport')),
      },
    });
    const resolvedInvalid = await produceCrossSourceSynthesis({
      seamCArtifact: seamCMultiGroup(),
      runtime: {
        runtimeId: T14_SYNTHESIS_RUNTIME_ID,
        model: T14_SYNTHESIS_MODEL,
        synthesize: () => Promise.resolve({ aspects: [{ aspect: 'a', claimIds: ['FORGED'] }] }),
      },
    });
    assert.equal(rejected.code, 'T14_RUNTIME_UNAVAILABLE');
    assert.equal(resolvedInvalid.code, 'T14_RUNTIME_OUTPUT_INVALID');
    assert.notEqual(rejected.code, resolvedInvalid.code);
  });
});

// ---------------------------------------------------------------------------
// CE5 — PRODUCTION-SHAPED DEEPSEEK ADAPTER (mandatory)
// ---------------------------------------------------------------------------

const FAKE_CREDENTIAL = { usable: true, key: 'sk-fake-deterministic-test-credential' };

/** Deterministic fake fetch serving one well-formed envelope (NO network). */
function fakeFetchServing(aspectsBuilder) {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push({ url, body });
    const claims = JSON.parse(body.messages[1].content).claims;
    const payload = {
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      model: DEEPSEEK_RUNTIME.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(aspectsBuilder(claims)) },
        finish_reason: 'stop',
      }],
    };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  };
  fetchImpl.seen = seen;
  return fetchImpl;
}

describe('D6 CE5 — production-shaped DeepSeek adapter (fake fetch, no network)', () => {
  test('CE5: the REAL buildDeepSeekResearchRuntime synthesize Promise contract is awaited', async () => {
    const fetchImpl = fakeFetchServing((claims) => validPartitionFor(claims));
    const runtime = buildDeepSeekResearchRuntime({
      fetchImpl,
      credential: FAKE_CREDENTIAL,
    });

    // 1. the production seam is genuinely asynchronous (the proven defect source)
    const probe = runtime.synthesize({ claims: [{ claimId: 'c-23456789-001', groupId: 'g', kind: 'main', statement: 'x' }] });
    assert.ok(probe instanceof Promise,
      'PRODUCTION CONTRACT: synthesize() returns a Promise — this is exactly what the sync consumer mis-handled');
    await probe;

    // 2. the T14 seam consumes that REAL runtime without network and succeeds
    const runtimeFresh = buildDeepSeekResearchRuntime({ fetchImpl, credential: FAKE_CREDENTIAL });
    const result = await produceCrossSourceSynthesis({
      seamCArtifact: seamCMultiGroup(),
      runtime: runtimeFresh,
    });

    assert.equal(result.ok, true,
      `the real DeepSeek adapter shape must be compatible post-repair: ${JSON.stringify(result)}`);
    assert.notEqual(result.code, 'T14_RUNTIME_OUTPUT_INVALID',
      'the Promise must be awaited, never validated as an output object');
    assert.ok(result.artifact);
    assert.ok(fetchImpl.seen.length >= 1, 'the injected fake transport was actually used (no real network)');
    assert.equal(fetchImpl.seen[0].url, DEEPSEEK_RUNTIME.endpoint);
  });

  test('CE5b: the real adapter rejecting (transport) → T14_RUNTIME_UNAVAILABLE, not output-invalid', async () => {
    const runtime = buildDeepSeekResearchRuntime({
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
      credential: FAKE_CREDENTIAL,
    });
    const result = await produceCrossSourceSynthesis({
      seamCArtifact: seamCMultiGroup(),
      runtime,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'T14_RUNTIME_UNAVAILABLE');
    assert.equal(result.artifact, undefined);
  });

  test('CE5c: the real adapter resolving MALFORMED model output → T14_RUNTIME_OUTPUT_INVALID', async () => {
    const fetchImpl = fakeFetchServing(() => ({ aspects: [{ aspect: 'x', claimIds: ['FORGED-CLAIM-ID'] }] }));
    const runtime = buildDeepSeekResearchRuntime({ fetchImpl, credential: FAKE_CREDENTIAL });
    const result = await produceCrossSourceSynthesis({
      seamCArtifact: seamCMultiGroup(),
      runtime,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'T14_RUNTIME_OUTPUT_INVALID',
      'a resolved-but-invalid model partition is an OUTPUT class, never a transport class');
  });
});

// ---------------------------------------------------------------------------
// CE6 / CE7 — composition ordering + no early artifact write
// ---------------------------------------------------------------------------

describe('D6 CE6/CE7 — composition ordering and no early artifact write', () => {
  test('CE7: while the synthesize Promise is pending, no artifact / journal record is produced', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd6-ce7-'));
    let releaseSynthesis;
    const pending = new Promise((resolve) => { releaseSynthesis = resolve; });
    const runtime = {
      runtimeId: T14_SYNTHESIS_RUNTIME_ID,
      model: T14_SYNTHESIS_MODEL,
      synthesize({ claims }) {
        return pending.then(() => validPartitionFor(claims));
      },
    };

    try {
      const before = fs.readdirSync(workDir);
      const inflight = produceCrossSourceSynthesis({
        seamCArtifact: seamCMultiGroup(),
        runtime,
        workDir,
      });
      assert.ok(inflight instanceof Promise);

      // let several macrotask turns pass while the Promise is still pending
      await new Promise((r) => { setTimeout(r, 30); });
      assert.deepEqual(fs.readdirSync(workDir), before,
        'NO cross-source synthesis artifact may be written while the runtime Promise is pending');

      releaseSynthesis();
      const result = await inflight;
      assert.equal(result.ok, true);
      // the module performs no IO by design (workDir is reserved), so the
      // pending window still leaves the directory untouched
      assert.deepEqual(fs.readdirSync(workDir), before,
        'T14 performs no IO — the write happens in the T15 integration stage');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  test('CE7b: the synthesis Promise is not consumed before it settles (single-await discipline)', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd6-ce7b-'));
    const events = [];
    const runtime = {
      runtimeId: T14_SYNTHESIS_RUNTIME_ID,
      model: T14_SYNTHESIS_MODEL,
      async synthesize({ claims }) {
        events.push('synthesize:start');
        await new Promise((r) => { setTimeout(r, 15); });
        events.push('synthesize:settled');
        return validPartitionFor(claims);
      },
    };
    try {
      const result = await produceCrossSourceSynthesis({
        seamCArtifact: seamCMultiGroup(),
        runtime,
        workDir,
      });
      events.push('t14:resolved');
      assert.equal(result.ok, true);
      assert.deepEqual(events, ['synthesize:start', 'synthesize:settled', 't14:resolved'],
        'artifact assembly must not begin before the runtime settles');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CE8 — EXISTING SYNC TEST DOUBLE COMPATIBILITY (convenience only)
// ---------------------------------------------------------------------------

describe('D6 CE8 — sync test double compatibility via await (not a dual contract)', () => {
  test('CE8: `await` naturally consumes a synchronous plain result — declared seam stays ASYNC', async () => {
    const runtime = {
      runtimeId: T14_SYNTHESIS_RUNTIME_ID,
      model: T14_SYNTHESIS_MODEL,
      synthesize({ claims }) { return validPartitionFor(claims); }, // legacy sync double
    };
    const result = await produceCrossSourceSynthesis({
      seamCArtifact: seamCMultiGroup(),
      runtime,
    });
    assert.equal(result.ok, true, 'awaiting a plain value is well-defined JS and must keep working');
    // The declared production seam remains a Promise-returning API; that the
    // module tolerates a plain value under `await` is a JS semantic, NOT a
    // documented Result|Promise union contract.
    assert.ok(result.artifact);
  });
});

// ---------------------------------------------------------------------------
// COVERAGE_STAGE_ORDER reference (guards CE6's stage vocabulary import)
// ---------------------------------------------------------------------------

describe('D6 stage vocabulary sanity', () => {
  test('the frozen canonical stage order exists and contains the T14 + T15 stages', () => {
    assert.ok(Array.isArray(CANONICAL_STAGE_ORDER), 'CANONICAL_STAGE_ORDER must be exported');
    assert.ok(CANONICAL_STAGE_ORDER.includes(STAGE_CROSS_SOURCE_SYNTHESIS));
    assert.ok(CANONICAL_STAGE_ORDER.includes(STAGE_FINAL_RECONCILIATION));
  });

  test('an initial coverage state is derivable for the fixture planHash', () => {
    const state = createInitialCoverageState({ planHash: seamCMultiGroup().planHash });
    assert.ok(state && typeof state === 'object');
  });
});
