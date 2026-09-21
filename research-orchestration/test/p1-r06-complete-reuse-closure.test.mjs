// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-r06-complete-reuse-closure.test.mjs
 *
 * P1-R06 (GitHub Issue #94, Lane A) — REAL dependency closure for COMPLETE
 * reuse and for ordinary interrupted resume.
 *
 * ROOT CAUSE (fresh-confirmed against BASE_SHA 4d774307885b78b70ad134d64cc70096e489c5ec):
 * `p1-runtime-composer.mjs` classified a persisted `stage === 'COMPLETE'`
 * checkpoint as reusable after checking ONLY
 *
 *   (a) `state.p1FinalCoveragePlanHash != null`, and
 *   (b) the recorded hashes of `research-result.json` / `coverage-final.json`
 *       still equal the bytes on disk.
 *
 * That is an END-OF-CHAIN existence check, not a dependency closure. Deleting
 * or mutating ANY upstream dependency (`research-plan.json`,
 * `source-group-selection-decision.json`, a group's `answers.json`/`handoff.json`,
 * `per-group-claims.json`, `cross-source-synthesis.json`) while leaving the two
 * terminal artifacts byte-identical still produced `{ ok: true, reused: true }`
 * — a FALSE COMPLETE. A legacy / version-less / V1 synthesis artifact could
 * likewise be resurrected as "current" purely because its own file hash was
 * self-consistent.
 *
 * TARGET CONTRACT (Issue #94):
 *   - historical COMPLETE != currently reusable COMPLETE;
 *   - validation is side-effect free: ZERO network, ZERO planner/retrieval/
 *     capture/T13/T14 model call, ZERO canonical write, NO hash self-healing;
 *   - a refusal reports the EARLIEST invalid boundary, audibly;
 *   - ordinary interrupted resume continues from the appropriate boundary and
 *     never redoes still-valid completed stages or dependency-free siblings;
 *   - missing version / provenance is REFUSED, never guessed.
 *
 * All cases run the REAL `composeP1Research` production chain with injected
 * offline doubles (the same fixture strategy the P1-T15 wiring and P1-R02
 * suites use) against real temp workDirs. No network, no credentials.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planHash } from '../lib/plan-contract.mjs';
import {
  createProviderSeam,
  CAPABILITY_SEARCH,
  AUTH_CLASS_OFFICIAL_SECRET,
} from '../lib/provider-seam.mjs';
import { P1_PIPELINE_IDENTITY } from '../lib/coverage-final-integration.mjs';
import { makeState, readState, writeState, runIdentityHash, sha256File } from '../lib/state.mjs';
import { MULTI_GROUP_STATE_FILENAME, loadMultiGroupState } from '../lib/multi-group-execution.mjs';
import { SELECTION_DECISION_FILENAME } from '../lib/source-group-selection.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';

/**
 * On-disk checkpoint binding keys, pinned as LITERALS on purpose.
 *
 * These strings are part of the PERSISTED checkpoint schema, so pinning the
 * literal is a stronger stability guarantee than reading the implementation's own
 * constant back and comparing it to itself. `N4` asserts the exported constants
 * agree with these literals, so the two can never drift apart silently.
 *
 * Pinning them here also keeps this suite runnable against BASE_SHA — where the
 * closure module does not yet exist — so the RED capture exercises the real
 * production defect instead of dying on an import error.
 */
const BINDING_ACCUMULATED_POOL = 'accumulatedPool';
const BINDING_SELECTION_DECISION = 'selectionDecision';
// The ledger binding shares the completion set's `coverageState` key on purpose:
// one key, one meaning — "sha256 of coverage-state.json as recorded by the
// producer at checkpoint-write time" — refreshed by EVERY checkpoint write.
const BINDING_COVERAGE_STATE = 'coverageState';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RO_ROOT = path.resolve(HERE, '..');

const PLAN_FILENAME = 'research-plan.json';
const COVERAGE_STATE = 'coverage-state.json';
const CLAIMS_FILENAME = 'per-group-claims.json';
const SYNTHESIS_FILENAME = 'cross-source-synthesis.json';
const RESULT_FILENAME = 'research-result.json';
const COVERAGE_FINAL = 'coverage-final.json';

function tmpWork(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readEvents(workDir) {
  const file = path.join(workDir, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * The LAST event with the given name. `events.jsonl` is append-only across the
 * whole work-dir lifetime, so a resumed run's own event is never the first
 * match — a producing run also appends its own boundary/selection events.
 */
function lastEvent(workDir, name) {
  const matches = readEvents(workDir).filter((e) => e.event === name);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

// ---------------------------------------------------------------------------
// offline fixtures (mirror the P1-T15 wiring / P1-R02 double strategy)
// ---------------------------------------------------------------------------

const PLAN = {
  schemaVersion: 1,
  queryVariants: ['R06 检索词 一', 'R06 检索词 二'],
  aspects: ['岗位影响'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

function searchResult(providerId, entries, { ok = true, failure = null } = {}) {
  return {
    ok,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: '2026-09-10T12:00:00.000Z',
    items: entries.map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: {
      status: 'unknown',
      evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' },
    },
    ...(failure ? { failure } : {}),
  };
}

/**
 * Counting search seam: records every issued provider query so a reuse
 * assertion can prove ZERO retrieval calls, and every COVERED stage can prove
 * exactly which work was (not) redone.
 */
function countingSeam(questionIds, calls) {
  const ranking = questionIds.map((qid, i) => [qid, i + 1]);
  const adapter = (providerId) => ({
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve(input) {
      calls.search += 1;
      calls.searchQueries.push(input?.query ?? null);
      return searchResult(providerId, ranking);
    },
  });
  return createProviderSeam({
    adapters: [adapter('fixture-official'), adapter('fixture-global')],
  });
}

function testEmbeddingProvider(calls) {
  return {
    preflight: async () => {
      calls.embedPreflight += 1;
      return { ok: true };
    },
    embed: async (texts) => {
      calls.embed += 1;
      return { vectors: texts.map(() => mockVector768(7)) };
    },
  };
}

/** Runtime double: counts T13 analyze + T14 synthesize model invocations. */
function countingRuntime(calls) {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    async analyze({ projection }) {
      calls.analyze += 1;
      const tokens = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      assert.ok(tokens.length > 0, 'runtime double saw no issued tokens');
      return {
        main: [{ tokenRef: tokens[0], statement: '主流观点：该做法在多数场景下有效' }],
        minority: [{ tokenRef: tokens[tokens.length - 1], statement: '少数派观点：特定条件下结论相反' }],
        contradictory: [],
        expertEvidenceRichTokens: [tokens[0]],
      };
    },
    async synthesize({ claims }) {
      calls.synthesize += 1;
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

const GROUP_100_TEXTS = ['回答一：总体上有效，多数场景成立。', '回答二：小样本下有反例。'];
const GROUP_200_TEXTS = ['回答三：另一个问题下的主流经验。', '回答四：补充：成本是主要顾虑。'];

function answersJsonFor(questionId, answerTexts) {
  return {
    questionId,
    questionTitle: `问题 ${questionId} 的标题`,
    answers: answerTexts.map((content, i) => ({
      id: `${questionId}-a-${i + 1}`,
      content,
      excerpt: content,
      author: i % 2 === 0 ? `作者${questionId}-甲` : `作者${questionId}-乙`,
      voteupCount: 10 - i,
    })),
  };
}

function captureAdapterFor(answersByQuestion, calls) {
  return {
    providerId: 'zhihu-session-capture',
    capability: 'capture',
    authClass: 'session',
    retrieve({ questionId, outDir }) {
      calls.capture += 1;
      calls.capturedGroups.push(String(questionId));
      const dir = path.join(outDir, String(questionId));
      fs.mkdirSync(dir, { recursive: true });
      const doc = answersByQuestion[String(questionId)];
      if (!doc) {
        return {
          ok: false,
          provider_id: 'zhihu-session-capture',
          capability: 'capture',
          auth_class: 'session',
          retrieved_at: '2026-09-10T12:00:00.000Z',
          items: [],
          completeness: { status: 'unknown', evidence: { basis: 'fixture' } },
          failure: { code: 'CAPTURE_FIXTURE_MISSING', class: 'identity' },
        };
      }
      fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify(doc, null, 2)}\n`);
      return {
        ok: true,
        provider_id: 'zhihu-session-capture',
        capability: 'capture',
        auth_class: 'session',
        retrieved_at: '2026-09-10T12:00:00.000Z',
        items: [{
          identity: { kind: 'group', questionId: String(questionId) },
          provenance: { route: 'fixture-capture', rank: 1, rankOrigin: 'fixture' },
          facts: { capturedAnswerCount: doc.answers.length },
        }],
        completeness: { status: 'complete', evidence: { basis: 'fixture_complete_pagination' } },
      };
    },
  };
}

function groupRunnerFor(calls) {
  return (name, args) => {
    if (name === 'zhihu-verify') {
      calls.verify += 1;
      const doc = JSON.parse(fs.readFileSync(path.join(args[0], 'answers.json'), 'utf8'));
      return {
        status: 0,
        stdout: JSON.stringify({
          valid: true,
          questionId: String(doc.questionId),
          capturedAnswerCount: doc.answers.length,
          reportedAnswerCount: doc.answers.length,
        }),
      };
    }
    if (name === 'zhihu-handoff') {
      calls.handoff += 1;
      const dir = args[0];
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
      fs.writeFileSync(
        path.join(dir, 'handoff.json'),
        `${JSON.stringify({ questionId: String(doc.questionId), task: 'digest', sourceType: 'session-capture', generatedBy: 'fixture' }, null, 2)}\n`,
      );
      return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') {
      calls.handoffVerify += 1;
      return { status: 0, stdout: JSON.stringify({ valid: true }) };
    }
    throw new Error(`unexpected runner command: ${name}`);
  };
}

function zeroCalls() {
  return {
    search: 0,
    searchQueries: [],
    capture: 0,
    capturedGroups: [],
    verify: 0,
    handoff: 0,
    handoffVerify: 0,
    embedPreflight: 0,
    embed: 0,
    analyze: 0,
    synthesize: 0,
    planner: 0,
  };
}

function fixtures(calls, overrides = {}) {
  return {
    plan: PLAN,
    runtime: countingRuntime(calls),
    seam: countingSeam(['100', '200'], calls),
    captureAdapter: captureAdapterFor(
      { 100: answersJsonFor('100', GROUP_100_TEXTS), 200: answersJsonFor('200', GROUP_200_TEXTS) },
      calls,
    ),
    runner: groupRunnerFor(calls),
    embeddingProvider: testEmbeddingProvider(calls),
    ...overrides,
  };
}

const TOPIC = 'AI 编程工具会取代程序员吗';

/** Run one full, successful offline composition. */
async function runFull(workDir, overrides = {}) {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const calls = zeroCalls();
  const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls, overrides) });
  assert.equal(out.ok, true, `baseline compose must succeed: ${JSON.stringify(out)}`);
  return { out, calls };
}

function assertZeroExternalCalls(calls, label) {
  assert.equal(calls.search, 0, `${label}: zero retrieval calls`);
  assert.equal(calls.capture, 0, `${label}: zero capture calls`);
  assert.equal(calls.verify, 0, `${label}: zero verify calls`);
  assert.equal(calls.handoff, 0, `${label}: zero handoff calls`);
  assert.equal(calls.embedPreflight, 0, `${label}: zero embedding preflight calls`);
  assert.equal(calls.embed, 0, `${label}: zero embedding calls`);
  assert.equal(calls.analyze, 0, `${label}: zero T13 model calls`);
  assert.equal(calls.synthesize, 0, `${label}: zero T14 model calls`);
  assert.equal(calls.planner, 0, `${label}: zero planner calls`);
}

/** Snapshot the bytes of every production artifact (canonical-write probe). */
function snapshotWorkDir(workDir) {
  const snap = {};
  for (const rel of [
    PLAN_FILENAME,
    COVERAGE_STATE,
    SELECTION_DECISION_FILENAME,
    MULTI_GROUP_STATE_FILENAME,
    CLAIMS_FILENAME,
    SYNTHESIS_FILENAME,
    RESULT_FILENAME,
    COVERAGE_FINAL,
    'coverage-state.write-receipt.json',
    'orchestration-state.json',
    'events.jsonl',
  ]) {
    const abs = path.join(workDir, rel);
    if (fs.existsSync(abs)) snap[rel] = fs.readFileSync(abs, 'utf8');
  }
  for (const qid of ['100', '200']) {
    for (const f of ['answers.json', 'handoff.json']) {
      const abs = path.join(workDir, 'zhihu', qid, f);
      if (fs.existsSync(abs)) snap[`zhihu/${qid}/${f}`] = fs.readFileSync(abs, 'utf8');
    }
  }
  return snap;
}

// ===========================================================================
// A. a valid, complete, current-version COMPLETE is genuinely reused
// ===========================================================================

describe('P1-R06 §A — valid COMPLETE reuse', () => {
  test('A1: a valid COMPLETE is reused on the second call with ZERO external calls and unchanged canonical bytes', async () => {
    const workDir = tmpWork('p1-r06-a1-');
    const first = await runFull(workDir);
    assert.equal(first.out.reused, undefined, 'the first call computes, it does not reuse');

    const before = snapshotWorkDir(workDir);
    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const second = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });

    assert.equal(second.ok, true, `valid COMPLETE must be reusable: ${JSON.stringify(second)}`);
    assert.equal(second.reused, true, 'a genuine closure-valid COMPLETE must report reused:true');
    assert.equal(second.planHash, planHash(PLAN), 'reuse must carry the bound planHash');
    assertZeroExternalCalls(calls, 'A1 second call');

    const after = snapshotWorkDir(workDir);
    for (const [rel, bytes] of Object.entries(before)) {
      assert.equal(after[rel], bytes, `A1: canonical bytes unchanged for ${rel}`);
    }
  });

  test('A2: a valid COMPLETE result is byte-identical to the producing run', async () => {
    const workDir = tmpWork('p1-r06-a2-');
    const first = await runFull(workDir);
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const calls = zeroCalls();
    const second = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(second.ok, true);
    assert.deepEqual(second.result, first.out.result, 'reuse must return the recorded result verbatim');
    assert.equal(second.runId, first.out.runId);
  });
});

// ===========================================================================
// B. every upstream dependency edge is load-bearing
// ===========================================================================

/**
 * Build a complete run, then apply a mutation to one dependency, then assert
 * the composer REFUSES to reuse it. Each case names the boundary the refusal
 * must point at.
 *
 * Discipline: for structural mutations we re-seal the enclosing recorded hash
 * where one exists (so the assertion reaches the DEEPER intended check rather
 * than being satisfied by a merely stale terminal hash).
 */
const MUTATIONS = [
  {
    id: 'B1',
    label: 'Plan artifact deleted',
    boundary: 'plan',
    mutate(workDir) {
      fs.rmSync(path.join(workDir, PLAN_FILENAME));
    },
  },
  {
    id: 'B2',
    label: 'Plan artifact content mutated (same shape, different query variants)',
    boundary: 'plan',
    mutate(workDir) {
      const p = path.join(workDir, PLAN_FILENAME);
      const plan = JSON.parse(fs.readFileSync(p, 'utf8'));
      plan.queryVariants = ['R06 被篡改的检索词 一', 'R06 被篡改的检索词 二'];
      fs.writeFileSync(p, `${JSON.stringify(plan, null, 2)}\n`);
    },
  },
  {
    id: 'B3',
    label: 'selection decision deleted',
    boundary: 'selection',
    mutate(workDir) {
      fs.rmSync(path.join(workDir, SELECTION_DECISION_FILENAME));
    },
  },
  {
    id: 'B4',
    label: 'canonical answers artifact deleted for one group',
    boundary: 'group',
    mutate(workDir) {
      fs.rmSync(path.join(workDir, 'zhihu', '100', 'answers.json'));
    },
  },
  {
    id: 'B5',
    label: 'handoff artifact deleted for one group',
    boundary: 'group',
    mutate(workDir) {
      fs.rmSync(path.join(workDir, 'zhihu', '200', 'handoff.json'));
    },
  },
  {
    id: 'B6',
    label: 'T13 per-group claims artifact deleted',
    boundary: 'claims',
    mutate(workDir) {
      fs.rmSync(path.join(workDir, CLAIMS_FILENAME));
    },
  },
  {
    id: 'B7',
    label: 'T14 synthesis artifact deleted',
    boundary: 'synthesis',
    mutate(workDir) {
      fs.rmSync(path.join(workDir, SYNTHESIS_FILENAME));
    },
  },
  {
    id: 'B8',
    label: 'coverage-final artifact deleted',
    boundary: 'coverage',
    mutate(workDir) {
      fs.rmSync(path.join(workDir, COVERAGE_FINAL));
    },
  },
  {
    id: 'B9',
    label: 'research-result artifact deleted',
    boundary: 'result',
    mutate(workDir) {
      fs.rmSync(path.join(workDir, RESULT_FILENAME));
    },
  },
];

describe('P1-R06 §B — every dependency edge is load-bearing (deletion)', () => {
  for (const m of MUTATIONS) {
    test(`${m.id}: ${m.label} → COMPLETE is REFUSED, no external call, earliest boundary reported`, async () => {
      const workDir = tmpWork(`p1-r06-${m.id.toLowerCase()}-`);
      await runFull(workDir);

      m.mutate(workDir);
      // snapshot AFTER the mutation: validation must not repair/rewrite what the
      // operator (or an adversary) left on disk. A hash self-healing bug would
      // show up as a post-validation byte difference.
      const mutated = snapshotWorkDir(workDir);

      const calls = zeroCalls();
      const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
      const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });

      assert.equal(out.ok, false, `${m.id}: a COMPLETE with an invalid dependency must NOT be reused`);
      assert.equal(out.reused, undefined, `${m.id}: must not report reuse`);
      assert.ok(typeof out.code === 'string' && out.code.length > 0, `${m.id}: refusal must carry a stable identity`);
      assertZeroExternalCalls(calls, m.id);

      // the refusal must name the earliest invalid boundary, not just "invalid"
      const detail = String(out.details ?? '');
      assert.ok(
        detail.includes(m.boundary),
        `${m.id}: refusal details must report the earliest invalid boundary "${m.boundary}" (got: ${detail})`,
      );

      // no hash self-healing: nothing on disk may be rewritten by validation
      const after = snapshotWorkDir(workDir);
      for (const [rel, bytes] of Object.entries(mutated)) {
        if (rel === 'events.jsonl' || rel === 'orchestration-state.json') continue;
        assert.equal(after[rel], bytes, `${m.id}: ${rel} must not be rewritten by a failed validation`);
      }
    });
  }
});

// ===========================================================================
// C. same-count semantic mutation (the harder counterexample)
// ===========================================================================

describe('P1-R06 §C — same-count semantic mutation is detected', () => {
  test('C1: claims artifact mutated with the SAME claim count but different statement → refused', async () => {
    const workDir = tmpWork('p1-r06-c1-');
    await runFull(workDir);

    const claimsPath = path.join(workDir, CLAIMS_FILENAME);
    const claims = JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
    const reps = claims.groupRepresentations;
    assert.ok(Array.isArray(reps) && reps.length > 0, 'fixture must produce group representations');

    // mutate ONE claim statement while preserving every count / id / structure
    let mutated = false;
    for (const rep of reps) {
      const bucket = rep.claims?.main ?? rep.claims?.minority;
      if (Array.isArray(bucket) && bucket.length > 0) {
        bucket[0].statement = '被篡改的陈述：计数不变但语义已改变';
        mutated = true;
        break;
      }
    }
    assert.ok(mutated, 'fixture must expose at least one claim to mutate');
    fs.writeFileSync(claimsPath, `${JSON.stringify(claims, null, 2)}\n`);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });

    assert.equal(out.ok, false, 'C1: same-count semantic mutation must NOT be reused');
    assert.equal(out.reused, undefined);
    assertZeroExternalCalls(calls, 'C1');
    assert.ok(
      String(out.details ?? '').includes('claims'),
      `C1: refusal must report the claims boundary (got: ${String(out.details ?? '')})`,
    );
  });

  test('C2: synthesis artifact mutated with the SAME family count but a different aspect → refused at the synthesis boundary', async () => {
    const workDir = tmpWork('p1-r06-c2-');
    await runFull(workDir);

    const synPath = path.join(workDir, SYNTHESIS_FILENAME);
    const syn = JSON.parse(fs.readFileSync(synPath, 'utf8'));
    assert.ok(Array.isArray(syn.synthesis?.families) && syn.synthesis.families.length > 0,
      'fixture must produce synthesis families');
    syn.synthesis.families[0].aspect = '被篡改的方面（family 数量不变）';
    fs.writeFileSync(synPath, `${JSON.stringify(syn, null, 2)}\n`);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });

    assert.equal(out.ok, false, 'C2: same-count synthesis mutation must NOT be reused');
    assert.equal(out.reused, undefined);
    assertZeroExternalCalls(calls, 'C2');
    assert.ok(
      String(out.details ?? '').includes('synthesis'),
      `C2: refusal must report the synthesis boundary (got: ${String(out.details ?? '')})`,
    );
  });
});

// ===========================================================================
// D. legacy / missing version & provenance (no guessing)
// ===========================================================================

describe('P1-R06 §D — legacy / missing version is refused, never guessed', () => {
  test('D1: a synthesis artifact stripped of its SEAM D version fields is refused (no V1→V2 defaulting)', async () => {
    const workDir = tmpWork('p1-r06-d1-');
    await runFull(workDir);

    const synPath = path.join(workDir, SYNTHESIS_FILENAME);
    const syn = JSON.parse(fs.readFileSync(synPath, 'utf8'));
    delete syn.seamVersion;
    delete syn.semanticContractVersion;
    fs.writeFileSync(synPath, `${JSON.stringify(syn, null, 2)}\n`);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });

    assert.equal(out.ok, false, 'D1: a version-less synthesis artifact must never be reused as current');
    assert.equal(out.reused, undefined);
    assertZeroExternalCalls(calls, 'D1');
    assert.ok(
      String(out.details ?? '').includes('synthesis'),
      `D1: boundary must be synthesis (got: ${String(out.details ?? '')})`,
    );
  });

  test('D2: a V1-stamped synthesis artifact whose own file hash is re-sealed is STILL refused (self-consistent hash ≠ current)', async () => {
    const workDir = tmpWork('p1-r06-d2-');
    await runFull(workDir);

    const synPath = path.join(workDir, SYNTHESIS_FILENAME);
    const syn = JSON.parse(fs.readFileSync(synPath, 'utf8'));
    // Downgrade to the historical V1 shape and RE-SEAL the enclosing hash so the
    // only thing that can refuse this is the DEEPER version invariant — not a
    // stale-hash accident. (Mutation-test discipline: the assertion must have
    // teeth on the structural check, not on hash equality.)
    syn.seamVersion = 1;
    syn.semanticContractVersion = 1;
    fs.writeFileSync(synPath, `${JSON.stringify(syn, null, 2)}\n`);
    const resealedHash = sha256FileHex(synPath);

    const statePath = path.join(workDir, 'orchestration-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.hashes = { ...(state.hashes ?? {}), synthesis: resealedHash };
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });

    assert.equal(out.ok, false,
      'D2: V1 must not become reusable merely because its own file hash is self-consistent');
    assert.equal(out.reused, undefined);
    assertZeroExternalCalls(calls, 'D2');
  });

  test('D3: a COMPLETE marker whose P1 render binding is missing is refused', async () => {
    const workDir = tmpWork('p1-r06-d3-');
    await runFull(workDir);

    const statePath = path.join(workDir, 'orchestration-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.p1FinalCoveragePlanHash = null;
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });

    assert.equal(out.ok, false, 'D3: COMPLETE without the render binding is not reusable');
    assert.equal(out.reused, undefined);
    assertZeroExternalCalls(calls, 'D3');
  });
});

// ===========================================================================
// E. request / config controls
// ===========================================================================

describe('P1-R06 §E — request and config controls', () => {
  test('E1: a different topic is never served by the prior run checkpoint', async () => {
    const workDir = tmpWork('p1-r06-e1-');
    await runFull(workDir);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({
      topic: '完全不同的主题：量子计算会取代经典计算机吗',
      workDir,
      ...fixtures(calls),
    });

    assert.equal(out.ok, false, 'E1: a different run identity must fail closed');
    assert.equal(out.code, 'run_identity_conflict', `E1: got ${out.code}`);
    assertZeroExternalCalls(calls, 'E1');
  });

  test('E2: a different config is never served by the prior run checkpoint', async () => {
    const workDir = tmpWork('p1-r06-e2-');
    await runFull(workDir);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    // config participates in the composition; a different config must not be
    // silently served by a checkpoint produced under the prior config.
    const out = await composeP1Research({
      topic: TOPIC,
      workDir,
      ...fixtures(calls, { config: { maxRounds: 1, minNoveltyGain: 0.99 } }),
    });

    assert.ok(out.ok === false || out.reused !== true,
      `E2: a different config must not report reuse of the prior run (got ${JSON.stringify(out)})`);
  });

  test('E3: explicit restart never reuses the prior occurrence COMPLETE', async () => {
    const workDir = tmpWork('p1-r06-e3-');
    await runFull(workDir);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, restart: true, ...fixtures(calls) });

    assert.equal(out.ok, true, `E3: restart must recompute, got ${JSON.stringify(out)}`);
    assert.notEqual(out.reused, true, 'E3: an explicit restart must never report reuse');
    // restart re-executes the chain (new occurrence), so downstream work happens
    assert.ok(calls.search > 0, 'E3: restart must actually re-run retrieval');
  });
});

// ===========================================================================
// F. ordinal status regressions (baseline behaviours preserved)
// ===========================================================================

describe('P1-R06 §F — preserved baseline behaviours', () => {
  test('F1: every production artifact exists after a successful compose', async () => {
    const workDir = tmpWork('p1-r06-f1-');
    await runFull(workDir);
    for (const rel of [
      PLAN_FILENAME,
      SELECTION_DECISION_FILENAME,
      MULTI_GROUP_STATE_FILENAME,
      COVERAGE_STATE,
      CLAIMS_FILENAME,
      SYNTHESIS_FILENAME,
      COVERAGE_FINAL,
      RESULT_FILENAME,
    ]) {
      assert.ok(fs.existsSync(path.join(workDir, rel)), `F1: ${rel} must exist after a successful compose`);
    }
  });

  test('F2: a successful COMPLETE still binds the render seam to the executed planHash', async () => {
    const workDir = tmpWork('p1-r06-f2-');
    const { out } = await runFull(workDir);
    const state = readState(workDir);
    assert.equal(state.stage, 'COMPLETE');
    assert.equal(state.p1FinalCoveragePlanHash, planHash(PLAN));
    assert.equal(out.planHash, planHash(PLAN));
    const covFinal = JSON.parse(fs.readFileSync(path.join(workDir, COVERAGE_FINAL), 'utf8'));
    assert.equal(covFinal.pipeline, P1_PIPELINE_IDENTITY);
    assert.equal(covFinal.assertion.is100PercentAnalysis, true);
  });

  test('F3: a failed compose leaves no coverage-final artifact and a null binding', async () => {
    const workDir = tmpWork('p1-r06-f3-');
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const calls = zeroCalls();
    const allFail = createProviderSeam({
      adapters: [
        {
          providerId: 'fixture-official',
          capability: CAPABILITY_SEARCH,
          authClass: AUTH_CLASS_OFFICIAL_SECRET,
          retrieve() {
            return searchResult('fixture-official', [], {
              ok: false,
              failure: { code: 'PROVIDER_TRANSPORT_FAILED', class: 'transport' },
            });
          },
        },
        {
          providerId: 'fixture-global',
          capability: CAPABILITY_SEARCH,
          authClass: AUTH_CLASS_OFFICIAL_SECRET,
          retrieve() {
            return searchResult('fixture-global', [], {
              ok: false,
              failure: { code: 'PROVIDER_TRANSPORT_FAILED', class: 'transport' },
            });
          },
        },
      ],
    });
    const out = await composeP1Research({
      topic: TOPIC,
      workDir,
      ...fixtures(calls, { seam: allFail }),
    });
    assert.equal(out.ok, false, 'F3: all-provider-failure must fail closed');
    const state = readState(workDir);
    assert.equal(state.p1FinalCoveragePlanHash, null);
    assert.equal(fs.existsSync(path.join(workDir, COVERAGE_FINAL)), false);
  });
});

function sha256FileHex(file) {
  // local helper: the composer's recorded-hash domain is the raw file sha256
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ===========================================================================
// G. ordinary interrupted resume — valid earlier work is not redone
// ===========================================================================

/**
 * Turn an in-process FAILED checkpoint into the checkpoint a KILL at `stage` would
 * have left.
 *
 * The in-process failure path marks `FAILED`, which the resume gate then correctly
 * refuses — but a process dying mid-pipeline never gets to write that marker. So
 * the label is restored to the stage the run had reached, and NOTHING else is
 * touched: every artifact, every content binding and every ledger byte stays
 * exactly as the interrupted run produced it.
 */
function asKillShape(workDir, stage) {
  const state = readState(workDir);
  assert.equal(state.stage, 'FAILED', 'asKillShape: expected the in-process failure marker to restore');
  state.stage = stage;
  writeState(workDir, state);
  return readState(workDir);
}

/** A T13/T14 runtime double that interrupts the composition AT the analysis stage. */
function throwingRuntime(calls) {
  const base = countingRuntime(calls);
  return {
    ...base,
    async analyze() {
      calls.analyze += 1;
      throw Object.assign(new Error('synthetic interruption'), { code: 'R06_TEST_INTERRUPT' });
    },
  };
}

/** A capture double that interrupts the composition mid group stage. */
function throwingCaptureAdapter(calls) {
  return {
    providerId: 'zhihu-session-capture',
    capability: 'capture',
    authClass: 'session',
    retrieve() {
      // Count the ATTEMPT before throwing: the adapter really was invoked, so a
      // call-count assertion must see it.
      if (calls) calls.capture += 1;
      throw Object.assign(new Error('synthetic interruption'), { code: 'R06_TEST_INTERRUPT' });
    },
  };
}

/**
 * Produce the checkpoint a GENUINE interruption leaves.
 *
 * A real interruption is the process DYING mid-pipeline (kill, power loss, container
 * eviction), not an exception: the chain never gets to persist a FAILED marker. So
 * this drives the real composition to fail at `at` and then restores the ONE field a
 * kill would never have written — the stage label — leaving every other byte exactly
 * as the run left it.
 *
 * Everything else is genuinely produced, not reconstructed, and `G0` pins the facts
 * that make this faithful rather than convenient:
 *
 *   - the persisted ledger is the RETRIEVAL-time ledger, because
 *     `applySourceGroupSelection` updates fusion accounting only IN MEMORY and the
 *     group stage is what would have persisted it (fusedCandidateCount > 0,
 *     fusedGroupCount === 0). A fixture built on a COMPLETED work dir would carry
 *     the POST-run ledger and could make a broken resume look healthy;
 *   - `hashes` carries exactly the stage-boundary content bindings the composer
 *     recorded as it produced each artifact, and no terminal binding.
 *
 * `at: 'CAPTURE'` interrupts with NO group captured; `at: 'ANALYZE'` interrupts only
 * after every group completed — the only shape in which group reuse is observable.
 */
async function runUntilInterrupt(workDir, { at = 'CAPTURE' } = {}) {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const calls = zeroCalls();
  const overrides = at === 'ANALYZE'
    ? { runtime: throwingRuntime(calls) }
    : { captureAdapter: throwingCaptureAdapter(calls) };
  try {
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls, overrides) });
    assert.notEqual(out.ok, true, `an interrupted run must never report success: ${JSON.stringify(out)}`);
  } catch {
    // A propagating interruption is an equally valid (and equally ordinary) shape.
  }
  const state = readState(workDir);
  assert.ok(state, 'runUntilInterrupt: the interrupted run left a checkpoint');
  assert.ok(calls.search > 0, 'runUntilInterrupt: the interrupted run really did execute retrieval');
  if (at === 'CAPTURE') assert.ok(calls.capture > 0, 'runUntilInterrupt: the interruption happened at the group stage');
  if (at === 'ANALYZE') assert.ok(calls.analyze > 0, 'runUntilInterrupt: the interruption happened at the analysis stage');
  return { calls, state: asKillShape(workDir, at) };
}

/**
 * A capture double that completes the FIRST group and then interrupts, so the
 * checkpoint is left with one genuinely finished sibling and one unfinished group
 * — the only shape in which sibling preservation can be observed at all.
 */
function captureAdapterFailingOnCall(n, calls) {
  const base = captureAdapterFor(
    { 100: answersJsonFor('100', GROUP_100_TEXTS), 200: answersJsonFor('200', GROUP_200_TEXTS) },
    zeroCalls(),
  );
  let issued = 0;
  return {
    ...base,
    retrieve(args) {
      issued += 1;
      calls.capture += 1;
      if (issued === n) {
        throw Object.assign(new Error('synthetic interruption'), { code: 'R06_TEST_INTERRUPT' });
      }
      return base.retrieve(args);
    },
  };
}

describe('P1-R06 §G — ordinary interrupted resume reuses valid earlier work', () => {
  test('G0: a GENUINE interruption leaves the stage-boundary content bindings on disk', async () => {
    // Grounding for every resume fixture below. If the composer did not really
    // record these bindings in the live path, the binding mechanism would be dead
    // code and §G1–§G7 would pass against a shape the production chain never emits.
    const workDir = tmpWork('p1-r06-g0-');
    const { calls, state } = await runUntilInterrupt(workDir);

    assert.equal(state.hashes[BINDING_ACCUMULATED_POOL], sha256FileHex(path.join(workDir, 'retrieval-rounds', 'accumulated-pool.json')), 'G0: the T06 pool binding is the REAL artifact hash');
    assert.equal(state.hashes[BINDING_SELECTION_DECISION], sha256FileHex(path.join(workDir, SELECTION_DECISION_FILENAME)), 'G0: the T08 decision binding is the REAL artifact hash');
    assert.equal(state.hashes.perGroupClaims, undefined, 'G0: a pre-completion checkpoint carries no terminal binding');
    assert.ok(calls.capture > 0, 'G0: the genuine interrupt really reached the capture stage');

    // Fidelity anchor: the persisted ledger is the RETRIEVAL-time ledger. The
    // post-selection fusion accounting lives only in memory until the group stage
    // persists it, so a reset that assumes otherwise would be unfaithful.
    const ledger = JSON.parse(fs.readFileSync(path.join(workDir, COVERAGE_STATE), 'utf8'));
    assert.ok(ledger.retrieval.fusedCandidateCount > 0, 'G0: the on-disk ledger carries retrieval accounting');
    assert.equal(ledger.retrieval.fusedGroupCount, 0, 'G0: the on-disk ledger carries NO selection accounting yet');
  });

  test('G1: an interrupt after selection is resumed WITHOUT re-running retrieval', async () => {
    const workDir = tmpWork('p1-r06-g1-');
    await runUntilInterrupt(workDir);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });

    assert.equal(out.ok, true, `ordinary resume must succeed: ${JSON.stringify(out)}`);
    assert.equal(calls.planner, 0, 'G1: the persisted plan is reused (zero planner calls)');
    assert.equal(calls.search, 0, 'G1: retrieval is NOT re-run — the persisted T06 pool is proven reusable');
    // No group had been captured when the interruption hit, so the group stage must
    // legitimately run. The re-entry claim here is about RETRIEVAL, and asserting a
    // zero capture count would be asserting something no kill could make true.
    assert.ok(calls.capture > 0, 'G1: the group stage legitimately runs (no group existed yet)');

    const events = readEvents(workDir);
    const reentry = lastEvent(workDir, 'resume_reentry');
    assert.ok(reentry, 'G1: the resume must record its re-entry boundary');
    assert.equal(
      reentry.boundary,
      'coverage-state:source-group-selection',
      'G1: with a reusable T08 decision the re-entry boundary is the selection stage',
    );
    assert.equal(reentry.reusedRetrieval, true, 'G1: the reuse is DISCLOSED, not silent');
    assert.equal(reentry.reusedSelection, true, 'G1: the reuse is DISCLOSED, not silent');
    // Both runs record a boundary (the producing run records its live path);
    // exactly two total, and the resumed one is the later entry.
    assert.equal(
      events.filter((e) => e.event === 'resume_reentry').length,
      2,
      'G1: exactly one boundary per run — the producing run and the resumed run',
    );
  });

  test('G1b: an interrupt AFTER the groups completed reuses every group artifact', async () => {
    const workDir = tmpWork('p1-r06-g1b-');
    await runUntilInterrupt(workDir, { at: 'ANALYZE' });

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, `G1b: the resume must succeed: ${JSON.stringify(out)}`);
    assert.equal(calls.planner, 0, 'G1b: plan reused');
    assert.equal(calls.search, 0, 'G1b: retrieval reused');
    assert.equal(calls.capture, 0, 'G1b: the completed group stage is NOT redone');
    assert.equal(calls.verify, 0, 'G1b: no group is re-verified');
    assert.equal(calls.handoff, 0, 'G1b: no handoff is rewritten');
    assert.ok(calls.analyze > 0, 'G1b: the interrupted stage itself legitimately re-runs');
  });

  test('G2: the resumed run still reaches a genuine COMPLETE', async () => {
    const workDir = tmpWork('p1-r06-g2-');
    await runUntilInterrupt(workDir);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, 'G2: resume completes');

    const state = readState(workDir);
    assert.equal(state.stage, 'COMPLETE', 'G2: resume reaches COMPLETE');
    assert.equal(state.p1FinalCoveragePlanHash, planHash(PLAN), 'G2: render binding restored exactly');
    const covFinal = JSON.parse(fs.readFileSync(path.join(workDir, COVERAGE_FINAL), 'utf8'));
    assert.equal(covFinal.assertion.is100PercentAnalysis, true, 'G2: 100% analysis is re-derived, not assumed');
  });

  test('G3: a tampered selection decision is refused by the content binding, never silently reused', async () => {
    const workDir = tmpWork('p1-r06-g3-');
    await runUntilInterrupt(workDir);

    // Mutate the persisted decision. The checkpoint still records the ORIGINAL
    // bytes, so the content binding is the first line of defence to fire.
    const selPath = path.join(workDir, SELECTION_DECISION_FILENAME);
    const decision = JSON.parse(fs.readFileSync(selPath, 'utf8'));
    decision.planHash = 'f'.repeat(64);
    fs.writeFileSync(selPath, `${JSON.stringify(decision, null, 2)}\n`);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, `G3: the run must still succeed via the live path: ${JSON.stringify(out)}`);
    assert.equal(calls.search, 0, 'G3: the T06 pool itself is still provably reusable (zero retrieval calls)');
    const reentry = lastEvent(workDir, 'resume_reentry');
    assert.ok(reentry, 'G3: the resume boundary must be recorded');
    assert.equal(reentry.boundary, 'coverage-state:retrieval-rounds', 'G3: refusal drops the boundary back to selection');
    assert.equal(reentry.reusedSelection, false, 'G3: the tampered decision is not reused');
    assert.equal(reentry.selectionRefusalReason, 'content_changed', 'G3: the content binding names the tamper');
  });

  test('G3b: a RE-SEALED stale decision is refused by the T08 stale-propagation authority', async () => {
    // Hash-resealing discipline: the byte binding must not be allowed to shadow the
    // semantic authority. Here the tamper is re-sealed into the checkpoint so the
    // content binding passes, and the frozen T08 decision status must be what
    // refuses — otherwise a self-consistent forgery would earn reuse.
    const workDir = tmpWork('p1-r06-g3b-');
    await runUntilInterrupt(workDir);

    const selPath = path.join(workDir, SELECTION_DECISION_FILENAME);
    const decision = JSON.parse(fs.readFileSync(selPath, 'utf8'));
    decision.planHash = 'f'.repeat(64);
    fs.writeFileSync(selPath, `${JSON.stringify(decision, null, 2)}\n`);
    const resealed = readState(workDir);
    resealed.hashes[BINDING_SELECTION_DECISION] = sha256FileHex(selPath);
    writeState(workDir, resealed);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, `G3b: the run must still succeed via the live path: ${JSON.stringify(out)}`);
    assert.equal(calls.search, 0, 'G3b: the pool binding still holds, so retrieval is still reused');
    const reentry = lastEvent(workDir, 'resume_reentry');
    assert.equal(reentry.reusedSelection, false, 'G3b: a re-sealed stale decision is still not reused');
    assert.equal(
      reentry.selectionRefusalReason,
      'selection_plan_hash_mismatch',
      'G3b: the refusal is the T08 semantic reason, proving the authority is actually consulted',
    );
  });

  test('G4: a deleted accumulated pool disables re-entry (falls back to a real re-run)', async () => {
    const workDir = tmpWork('p1-r06-g4-');
    await runUntilInterrupt(workDir);
    fs.rmSync(path.join(workDir, 'retrieval-rounds', 'accumulated-pool.json'));

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, 'G4: the run still succeeds');
    assert.ok(calls.search > 0, 'G4: without a provably reusable pool retrieval MUST be re-run (never assumed reusable)');
  });

  test('G6: a SAME-COUNT mutation of the accumulated pool defeats reuse (content, not shape)', async () => {
    // The point of a CONTENT binding over a shape/count check: this pool is still
    // a well-formed T06 pool with the same number of candidates, so every
    // structural check in the world accepts it. Only byte identity catches it.
    const workDir = tmpWork('p1-r06-g6-');
    await runUntilInterrupt(workDir);

    const poolPath = path.join(workDir, 'retrieval-rounds', 'accumulated-pool.json');
    const pool = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    assert.ok(pool.candidates.length > 0, 'G6: fixture precondition — the pool has candidates');
    const victim = pool.candidates[0];
    const before = pool.candidates.length;
    // Semantic, count-preserving mutation of the FIRST candidate only.
    victim.rrfScore = Number(victim.rrfScore ?? 0) + 0.5;
    fs.writeFileSync(poolPath, `${JSON.stringify(pool, null, 2)}\n`);
    const mutated = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    assert.equal(mutated.candidates.length, before, 'G6: the mutation preserved the candidate count');

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, `G6: the run still succeeds: ${JSON.stringify(out)}`);
    assert.ok(
      calls.search > 0,
      'G6: a same-count semantic mutation MUST invalidate the pool binding and force real retrieval',
    );
    const reentry = lastEvent(workDir, 'resume_reentry');
    assert.equal(reentry.reusedRetrieval, false, 'G6: retrieval is not reused from a mutated pool');
  });

  test('G7: a SAME-COUNT mutation of the selection decision defeats selection reuse only', async () => {
    const workDir = tmpWork('p1-r06-g7-');
    await runUntilInterrupt(workDir);

    const selPath = path.join(workDir, SELECTION_DECISION_FILENAME);
    const decision = JSON.parse(fs.readFileSync(selPath, 'utf8'));
    const before = decision.selectedGroups.length;
    assert.ok(before > 0, 'G7: fixture precondition — the decision selected groups');
    decision.selectedGroups[0] = { ...decision.selectedGroups[0], rationale: 'mutated in place' };
    fs.writeFileSync(selPath, `${JSON.stringify(decision, null, 2)}\n`);
    assert.equal(JSON.parse(fs.readFileSync(selPath, 'utf8')).selectedGroups.length, before, 'G7: count preserved');

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, `G7: the run still succeeds: ${JSON.stringify(out)}`);
    assert.equal(calls.search, 0, 'G7: the T06 pool is untouched, so retrieval is still reused');
    const reentry = lastEvent(workDir, 'resume_reentry');
    assert.equal(reentry.reusedRetrieval, true, 'G7: retrieval reuse is not affected');
    assert.equal(reentry.reusedSelection, false, 'G7: the mutated decision is NOT reused');
    assert.equal(reentry.boundary, 'coverage-state:retrieval-rounds', 'G7: the boundary drops back to selection');
  });

  test('G5: an explicit restart is a NEW occurrence and never resumes prior work', async () => {
    const workDir = tmpWork('p1-r06-g5-');
    await runUntilInterrupt(workDir);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, restart: true, ...fixtures(calls) });
    assert.equal(out.ok, true, 'G5: restart succeeds');
    assert.ok(calls.search > 0, 'G5: a restart re-runs retrieval from scratch');
    assert.ok(calls.capture > 0, 'G5: a restart re-captures groups (no cross-occurrence reuse)');
    // A restart is a NEW occurrence: it must not REUSE anything. Its own boundary
    // event is the live path (never a reuse), and the restart must not carry the
    // prior occurrence's occurrenceId.
    const restartBoundaries = readEvents(workDir).filter((e) => e.event === 'resume_reentry');
    assert.equal(restartBoundaries.length, 2, 'G5: the producing run and the restart each record one boundary');
    const [producing, restarted] = restartBoundaries;
    assert.equal(producing.boundary, 'coverage-state:retrieval-rounds', 'G5: the producing run took the live path');
    assert.equal(restarted.boundary, 'coverage-state:retrieval-rounds', 'G5: the restart also runs retrieval live');
    assert.notEqual(
      restarted.occurrenceId,
      producing.occurrenceId,
      'G5: an explicit restart is a NEW occurrence (a fresh occurrenceId)',
    );
  });
});

// ===========================================================================
// H. sibling preservation across the group stage
// ===========================================================================

describe('P1-R06 §H — dependency-free siblings are preserved', () => {
  test('H1: an interrupt that lost ONE group preserves the sibling that finished', async () => {
    const workDir = tmpWork('p1-r06-h1-');
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');

    // GENUINE partial progress: the first group completes, then the interruption.
    const firstCalls = zeroCalls();
    try {
      const first = await composeP1Research({
        topic: TOPIC,
        workDir,
        ...fixtures(firstCalls, { captureAdapter: captureAdapterFailingOnCall(2, firstCalls) }),
      });
      assert.notEqual(first.ok, true, `H1: the interrupted run must not report success: ${JSON.stringify(first)}`);
    } catch {
      // propagate-as-interruption is an equally valid shape
    }
    assert.ok(firstCalls.capture >= 1, 'H1: at least one group was captured before the interruption');
    asKillShape(workDir, 'CAPTURE');

    // The sibling that finished must be discoverable as finished, and the group
    // that never ran must be absent — otherwise this test proves nothing.
    const groupsRoot = path.join(workDir, 'zhihu');
    const done = fs.existsSync(groupsRoot) ? fs.readdirSync(groupsRoot) : [];
    const withHandoff = done.filter((qid) => fs.existsSync(path.join(groupsRoot, qid, 'handoff.json')));
    assert.ok(withHandoff.length >= 1, `H1: a sibling really did finish (found=${JSON.stringify(done)})`);

    const calls = zeroCalls();
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, `H1: the resume repairs what is missing and succeeds: ${JSON.stringify(out)}`);
    assert.equal(calls.search, 0, 'H1: retrieval is still reused (the pool binding holds)');
    assert.ok(
      calls.capture < 2,
      `H1: the finished sibling must NOT be re-captured (capture calls=${calls.capture})`,
    );
    for (const qid of ['100', '200']) {
      assert.equal(
        fs.existsSync(path.join(groupsRoot, qid, 'handoff.json')),
        true,
        `H1: group ${qid} ends with a restored verified handoff`,
      );
    }
  });

  test('H2: an untouched resume re-uses every group artifact without any capture', async () => {
    const workDir = tmpWork('p1-r06-h2-');
    await runUntilInterrupt(workDir, { at: 'ANALYZE' });

    const before = new Map();
    for (const qid of ['100', '200']) {
      for (const f of ['answers.json', 'handoff.json']) {
        const abs = path.join(workDir, 'zhihu', qid, f);
        before.set(`${qid}/${f}`, fs.readFileSync(abs, 'utf8'));
      }
    }

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true);
    assert.equal(calls.capture, 0, 'H2: zero capture calls — every group artifact is reused');
    assert.equal(calls.verify, 0, 'H2: zero verify calls');
    assert.equal(calls.handoff, 0, 'H2: zero handoff calls');
    for (const [key, bytes] of before.entries()) {
      const [qid, f] = key.split('/');
      assert.equal(
        fs.readFileSync(path.join(workDir, 'zhihu', qid, f), 'utf8'),
        bytes,
        `H2: group artifact bytes unchanged for ${key}`,
      );
    }
  });
});

// ===========================================================================
// I / J. call-count evidence is the reuse proof
// ===========================================================================

describe('P1-R06 §I — call-count evidence proves reuse (not output equality)', () => {
  test('I1: reuse is proven by zero external calls even when a same-shaped output could be faked', async () => {
    const workDir = tmpWork('p1-r06-i1-');
    const first = await runFull(workDir);
    assert.ok(first.calls.search > 0, 'I1: the producing run really did call the providers');

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const second = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(second.ok, true);
    assertZeroExternalCalls(calls, 'I1 second call');
    assert.deepEqual(calls.searchQueries, [], 'I1: no query was issued at all');
  });

  test('I2: the retrieval-round artifacts are not rewritten by a reuse read', async () => {
    const workDir = tmpWork('p1-r06-i2-');
    await runFull(workDir);
    const roundDir = path.join(workDir, 'retrieval-rounds');
    const snapshot = {};
    for (const entry of fs.readdirSync(roundDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        snapshot[entry.name] = fs.readFileSync(path.join(roundDir, entry.name), 'utf8');
      } else {
        const poolPath = path.join(roundDir, entry.name, 'retrieval-pool.json');
        if (fs.existsSync(poolPath)) snapshot[`${entry.name}/retrieval-pool.json`] = fs.readFileSync(poolPath, 'utf8');
      }
    }

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true);
    assert.equal(out.reused, true, 'I2: a valid COMPLETE is still reused');
    for (const [rel, bytes] of Object.entries(snapshot)) {
      assert.equal(
        fs.readFileSync(path.join(roundDir, rel), 'utf8'),
        bytes,
        `I2: retrieval-round artifact bytes unchanged for ${rel}`,
      );
    }
  });
});

describe('P1-R06 §J — refusal is side-effect free (no self-healing)', () => {
  test('J1: a refused COMPLETE leaves the work dir byte-identical', async () => {
    const workDir = tmpWork('p1-r06-j1-');
    await runFull(workDir);
    // Delete a mid-chain dependency so the closure must refuse.
    fs.rmSync(path.join(workDir, CLAIMS_FILENAME));

    const before = {};
    const collect = (dir, prefix = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(abs, rel);
        else before[rel] = fs.readFileSync(abs, 'utf8');
      }
    };
    collect(workDir);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, false, 'J1: the refused COMPLETE must fail closed');
    assert.equal(out.reuseBoundary, 'claims', 'J1: the earliest invalid boundary is the deleted artifact');

    const after = {};
    const collectAfter = (dir, prefix = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) collectAfter(abs, rel);
        else after[rel] = fs.readFileSync(abs, 'utf8');
      }
    };
    collectAfter(workDir);

    // The ONLY permitted difference is the event-log append (the audit trail of
    // the refusal itself). No artifact may be rewritten, and nothing may be
    // re-created: a self-healing implementation would have repaired the missing
    // claims file here.
    for (const rel of Object.keys(before)) {
      if (rel === 'events.jsonl') continue;
      assert.equal(after[rel], before[rel], `J1: refusal must not rewrite ${rel}`);
    }
    assert.equal(
      fs.existsSync(path.join(workDir, CLAIMS_FILENAME)),
      false,
      'J1: no hash self-healing — the deleted artifact must NOT be re-created by a mere validation read',
    );
    assertZeroExternalCalls(calls, 'J1 refusal');
  });

  test('J2: a refusal while resuming does not silently promote the checkpoint', async () => {
    const workDir = tmpWork('p1-r06-j2-');
    await runFull(workDir);
    const stateBefore = readState(workDir);
    fs.rmSync(path.join(workDir, CLAIMS_FILENAME));

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, false, 'J2: refusal fails closed');
    const stateAfter = readState(workDir);
    assert.equal(
      stateAfter.stage,
      stateBefore.stage,
      'J2: a refused reuse must not alter the recorded stage',
    );
    assert.equal(calls.search, 0, 'J2: the refusal happens before any external work');
  });
});

// ===========================================================================
// K. zero network / zero model call by construction
// ===========================================================================

describe('P1-R06 §K — validation is side-effect free by construction', () => {
  test('K1: closure validation performs no fetch, no model call, no planner call', async () => {
    const workDir = tmpWork('p1-r06-k1-');
    await runFull(workDir);

    let fetchCalls = 0;
    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({
      topic: TOPIC,
      workDir,
      ...fixtures(calls, { fetchImpl: () => { fetchCalls += 1; throw new Error('network forbidden during validation'); } }),
    });
    assert.equal(out.ok, true, 'K1: reuse succeeds');
    assert.equal(fetchCalls, 0, 'K1: zero network access during a validation-only read');
    assertZeroExternalCalls(calls, 'K1');
  });

  test('K2: a genuine base RED scenario is reachable through the production entrypoint (missing claims)', async () => {
    const workDir = tmpWork('p1-r06-k2-');
    await runFull(workDir);
    fs.rmSync(path.join(workDir, CLAIMS_FILENAME));
    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, false, 'K2: the production entrypoint must refuse the broken checkpoint');
    assert.equal(out.code, 'state_invalid', `K2: the stable refusal code is used: ${JSON.stringify(out)}`);
  });
});

// ===========================================================================
// L. canonical bytes are unchanged by a successful reuse
// ===========================================================================

describe('P1-R06 §L — successful reuse preserves canonical bytes', () => {
  test('L1: reuse does not rewrite any canonical artifact', async () => {
    const workDir = tmpWork('p1-r06-l1-');
    await runFull(workDir);
    const before = snapshotWorkDir(workDir);
    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    const after = snapshotWorkDir(workDir);
    for (const [rel, bytes] of Object.entries(before)) {
      assert.equal(after[rel], bytes, `L1: ${rel} must be byte-identical after a reuse`);
    }
  });

  test('L2: the recorded content-binding hashes match the on-disk artifacts', async () => {
    const workDir = tmpWork('p1-r06-l2-');
    await runFull(workDir);
    const state = readState(workDir);
    // The completion binding set = the 6 terminal artifacts PLUS the two
    // first-stage dependencies (T06 pool, T08 decision) that the COMPLETE gate
    // must prove exactly like an interrupted resume does (independent-review
    // P0-1 — dropping them at completion is what let a deleted/mutated pool
    // ride through a COMPLETE reuse).
    assert.deepEqual(
      Object.keys(state.hashes).sort(),
      [
        'accumulatedPool',
        'coverageFinal',
        'coverageState',
        'perGroupClaims',
        'researchPlan',
        'researchResult',
        'selectionDecision',
        'synthesis',
      ],
      'L2: the completion must record the FULL content-binding set (6 terminal + 2 stage-boundary)',
    );
    for (const [key, rel] of [
      ['researchPlan', PLAN_FILENAME],
      ['coverageState', COVERAGE_STATE],
      ['coverageFinal', COVERAGE_FINAL],
      ['perGroupClaims', CLAIMS_FILENAME],
      ['synthesis', SYNTHESIS_FILENAME],
      ['researchResult', RESULT_FILENAME],
      [BINDING_ACCUMULATED_POOL, path.join('retrieval-rounds', 'accumulated-pool.json')],
      [BINDING_SELECTION_DECISION, SELECTION_DECISION_FILENAME],
    ]) {
      assert.equal(
        state.hashes[key],
        sha256FileHex(path.join(workDir, rel)),
        `L2: recorded hash for ${key} must equal the on-disk artifact bytes`,
      );
    }
  });
});

// ===========================================================================
// M–P. the production entrypoint really reaches the new validation
// ===========================================================================

describe('P1-R06 §M — the production entrypoint reaches the closure (REGISTERED != EXECUTED)', () => {
  test('M1: the composed entrypoint (not a test-only seam) performs the refusal', async () => {
    const workDir = tmpWork('p1-r06-m1-');
    await runFull(workDir);
    fs.rmSync(path.join(workDir, SYNTHESIS_FILENAME));
    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, false, 'M1: a deleted synthesis must be refused');
    assert.equal(out.reuseBoundary, 'synthesis', 'M1: the boundary names the deleted artifact');
    assert.match(
      String(out.details),
      /earliest invalid boundary=synthesis/,
      `M1: the refusal message discloses the boundary: ${out.details}`,
    );
  });

  test('M2: the closure validator is imported by the composer (static reachability)', async () => {
    const composerPath = path.join(RO_ROOT, 'lib', 'p1-runtime-composer.mjs');
    const text = fs.readFileSync(composerPath, 'utf8');
    // Assert the PROPERTY (the symbol is imported from the closure module), not the
    // exact formatting of the import statement — an import list that legitimately
    // grows must not fail a reachability check.
    const importStatement = text.match(/import \{[^}]*\} from '\.\/p1-reuse-closure\.mjs';/);
    assert.ok(importStatement, 'M2: the composer imports from the closure module');
    assert.match(
      importStatement[0],
      /validateCompleteReuseClosure/,
      'M2: the composer imports the closure validator',
    );
    assert.match(text, /validateCompleteReuseClosure\(\{/, 'M2: the composer CALLS the closure validator');
    const module = await import('../lib/p1-reuse-closure.mjs');
    assert.equal(typeof module.validateCompleteReuseClosure, 'function', 'M2: the closure validator is exported');
  });

  test('N1: every boundary identity is exported and stable', async () => {
    // NOTE ON RED: this test is the one case whose BASE_SHA failure is module
    // ABSENCE rather than a behaviour defect — the R06 vocabulary module is a
    // deliverable of this ticket, so it cannot exist before the fix. Every OTHER
    // section of this suite fails at BASE_SHA for genuine behavioural reasons
    // (see the RED capture: §A/§B/§C/§D/§E/§F/§G/§H/§K/§L/§M/§P).
    const m = await import('../lib/p1-reuse-closure.mjs');
    assert.equal(m.CLOSURE_BOUNDARY_CONFIG, 'request_config');
    assert.equal(m.CLOSURE_BOUNDARY_PLAN, 'plan');
    assert.equal(m.CLOSURE_BOUNDARY_SELECTION, 'selection');
    assert.equal(m.CLOSURE_BOUNDARY_GROUP, 'group');
    assert.equal(m.CLOSURE_BOUNDARY_CLAIMS, 'claims');
    assert.equal(m.CLOSURE_BOUNDARY_SYNTHESIS, 'synthesis');
    assert.equal(m.CLOSURE_BOUNDARY_COVERAGE, 'coverage');
    assert.equal(m.CLOSURE_BOUNDARY_RESULT, 'result');
  });

  test('N4: the exported checkpoint binding constants match the pinned on-disk literals', async () => {
    // The literals are what this suite asserts against; the exported constants are
    // what the composer writes. If they drift, the composer would write a key no
    // test pins and the resume proof would silently stop being exercised.
    const m = await import('../lib/p1-reuse-closure.mjs');
    assert.equal(m.CHECKPOINT_BINDING_ACCUMULATED_POOL, BINDING_ACCUMULATED_POOL);
    assert.equal(m.CHECKPOINT_BINDING_SELECTION_DECISION, BINDING_SELECTION_DECISION);
    assert.equal(m.CHECKPOINT_BINDING_COVERAGE_STATE, BINDING_COVERAGE_STATE);
  });

  test('O1: the recorded refusal is auditable in the event log', async () => {
    const workDir = tmpWork('p1-r06-o1-');
    await runFull(workDir);
    fs.rmSync(path.join(workDir, COVERAGE_FINAL));
    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, false);
    const events = readEvents(workDir);
    const refusal = events.find((e) => e.event === 'p1_complete_reuse_refused');
    assert.ok(refusal, 'O1: the refusal must be recorded as an auditable event');
    assert.equal(refusal.boundary, 'coverage', 'O1: the recorded boundary must be the coverage stage');
  });

  test('P1: the same rules apply when the production planner seam is the real one', async () => {
    // The production path (no injected plan) must reach the same closure. We
    // exercise only the refusal direction so no network is required: a state
    // file whose plan binding is absent is refused before any planner call.
    const workDir = tmpWork('p1-r06-p1-');
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const { runtime } = fixtures(zeroCalls());
    writeState(workDir, makeState({
      workDir,
      topic: TOPIC,
      mode: P1_PIPELINE_IDENTITY,
      percent: null,
      runtime: runtime.runtimeId,
      occurrenceId: crypto.randomUUID(),
    }));
    const state = readState(workDir);
    state.stage = 'COMPLETE';
    state.p1FinalCoveragePlanHash = null;
    writeState(workDir, state);

    let plannerCalls = 0;
    const out = await composeP1Research({
      topic: TOPIC,
      workDir,
      planner: async () => { plannerCalls += 1; throw new Error('planner must not run for a COMPLETE checkpoint'); },
      runtime,
      seam: fixtures(zeroCalls()).seam,
      captureAdapter: fixtures(zeroCalls()).captureAdapter,
      runner: fixtures(zeroCalls()).runner,
      embeddingProvider: fixtures(zeroCalls()).embeddingProvider,
    });
    assert.equal(out.ok, false, 'P1: a COMPLETE without a render binding is refused');
    assert.equal(plannerCalls, 0, 'P1: the refusal precedes any planner invocation');
  });

  test('P2: persisted group refs are PORTABLE, so the T09 validator can load them anywhere', async () => {
    // Regression guard for a real WINDOWS-ONLY product defect this ticket exposed:
    // `toWorkRelative` emitted the platform separator (`zhihu\100\answers.json`) while
    // the T09 persisted-state validator requires the exact production ref shape
    // (`zhihu/100/answers.json`). On Windows no captured group could EVER be loaded
    // from a checkpoint, so group reuse was silently impossible and a checkpoint could
    // not be reused at all — the precise opposite of this ticket's contract.
    //
    // The canonical form is the PORTABLE one (the composition owner already declares
    // and normalizes to it), so asserting it here fails on Windows if the producer ever
    // regresses, and is trivially satisfied on POSIX.
    const workDir = tmpWork('p1-r06-p2-');
    await runFull(workDir);

    const persisted = JSON.parse(fs.readFileSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME), 'utf8'));
    assert.ok(Object.keys(persisted.groups).length > 0, 'P2: fixture precondition — the state records groups');
    for (const [groupId, group] of Object.entries(persisted.groups)) {
      assert.ok(!String(group.evidenceRef ?? '').includes('\\'), `P2: ${groupId} evidenceRef must be portable (got ${JSON.stringify(group.evidenceRef)})`);
      assert.ok(!String(group.handoffRef ?? '').includes('\\'), `P2: ${groupId} handoffRef must be portable (got ${JSON.stringify(group.handoffRef)})`);
      if (group.captured) {
        assert.equal(group.evidenceRef, `zhihu/${group.questionId}/answers.json`, `P2: ${groupId} evidenceRef must equal the validator's literal`);
      }
      if (group.handoffValid) {
        assert.equal(group.handoffRef, `zhihu/${group.questionId}/handoff.json`, `P2: ${groupId} handoffRef must equal the validator's literal`);
      }
    }
    // The load is the defect's actual failure point: it must SUCCEED on every platform.
    assert.ok(loadMultiGroupState(workDir), 'P2: the persisted group state must load back (this is what failed on Windows)');
  });
});

// ===========================================================================
// R. independent-review counterexamples (review-repair round 1)
//
// The independent adversarial review of 8bc0cdf returned VERDICT: FAIL with
// three P0s and two P1s, each with a concrete falsification scenario. Every
// test in this section is ONE of those scenarios, verbatim: it must fail on
// the reviewed head and pass on the repair head. They are the reviewer's own
// falsifications, promoted into the permanent acceptance suite.
// ===========================================================================

describe('P1-R06 §R — independent-review counterexamples (8bc0cdf + 822c528 verdicts: FAIL)', () => {
  const POOL_REL = path.join('retrieval-rounds', 'accumulated-pool.json');

  test('R1 (review P0-1): a pool DELETED after COMPLETE is refused at the retrieval boundary, never reused', async () => {
    const workDir = tmpWork('p1-r06-r1-');
    await runFull(workDir);
    fs.rmSync(path.join(workDir, POOL_REL));

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, false, 'R1: a COMPLETE whose accumulated pool is gone must NOT be reused');
    assert.equal(out.reuseBoundary, 'retrieval_rounds', 'R1: the earliest invalid boundary is the retrieval stage');
    assertZeroExternalCalls(calls, 'R1');
  });

  test('R1b (review P0-1): a pool SAME-COUNT-mutated after COMPLETE is refused, never reused', async () => {
    const workDir = tmpWork('p1-r06-r1b-');
    await runFull(workDir);

    // Same-count semantic mutation, exactly the G6 tamper but applied AFTER
    // completion: no structural check can see it, only the content binding can.
    const poolPath = path.join(workDir, POOL_REL);
    const pool = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
    assert.ok(pool.candidates.length > 0, 'R1b: fixture precondition — the pool has candidates');
    const before = pool.candidates.length;
    pool.candidates[0].rrfScore = Number(pool.candidates[0].rrfScore ?? 0) + 0.5;
    fs.writeFileSync(poolPath, `${JSON.stringify(pool, null, 2)}\n`);
    assert.equal(JSON.parse(fs.readFileSync(poolPath, 'utf8')).candidates.length, before, 'R1b: count preserved');

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, false, 'R1b: a mutated pool must NOT earn a COMPLETE reuse');
    assert.equal(out.reuseBoundary, 'retrieval_rounds', 'R1b: the drift is named at the retrieval boundary');
    assertZeroExternalCalls(calls, 'R1b');
  });

  test('R2 (review P0-2): a schema-valid, planHash-preserving ledger tamper defeats the resume — no unproven ledger is ever authoritative', async () => {
    const workDir = tmpWork('p1-r06-r2-');
    await runUntilInterrupt(workDir);

    // Mutate the persisted ledger in a way its T07 owner cannot see: valid
    // structure, unchanged planHash, altered bookkeeping.
    const ledgerPath = path.join(workDir, COVERAGE_STATE);
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    ledger.retrieval.fusedCandidateCount = Number(ledger.retrieval.fusedCandidateCount ?? 0) + 1;
    fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, true, `R2: the run must still succeed via the live path: ${JSON.stringify(out)}`);
    assert.ok(calls.search > 0, 'R2: an unprovable ledger forces real retrieval — the pool is never reused on top of it');
    const reentry = lastEvent(workDir, 'resume_reentry');
    assert.equal(reentry.reusedRetrieval, false, 'R2: nothing is reused from an unproven ledger');
    assert.equal(reentry.reentryRefusalReason, 'coverage_state_content_changed', 'R2: the refusal is auditable and names the ledger');
  });

  test('R3 (review P0-3): a config A interruption is never resumed under config B', async () => {
    const workDir = tmpWork('p1-r06-r3-');
    const configA = { maxRetrievalRounds: 2 };
    const configB = { maxRetrievalRounds: 3 };
    {
      const calls = zeroCalls();
      const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
      const out = await composeP1Research({ topic: TOPIC, workDir, config: configA, ...fixtures(calls, { captureAdapter: throwingCaptureAdapter(calls) }) });
      assert.equal(out.ok, false, 'R3: the producing run interrupts at the group stage');
      assert.ok(calls.search > 0, 'R3: fixture precondition — config A really retrieved');
    }
    asKillShape(workDir, 'CAPTURE');

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, config: configB, ...fixtures(calls) });
    assert.equal(out.ok, true, `R3: config B completes its own run: ${JSON.stringify(out)}`);
    assert.ok(calls.search > 0, 'R3: config A retrieval/selection is NOT reusable for config B — the corpus would answer a different request');
    const reentry = lastEvent(workDir, 'resume_reentry');
    assert.equal(reentry.reusedRetrieval, false, 'R3: nothing from config A is reused');
    assert.equal(reentry.reentryRefusalReason, 'config_fingerprint_mismatch', 'R3: the refusal names the config identity, audibly');
  });

  test('R4 (review P1-1): claims mutated AND coverage-final deleted reports the EARLIEST boundary (claims, not coverage)', async () => {
    const workDir = tmpWork('p1-r06-r4-');
    await runFull(workDir);

    // Two faults: the EARLIER one is the claims content (PER_GROUP_ANALYSIS
    // precedes FINAL_COVERAGE_RECONCILIATION). A structural check for the later
    // boundary must never preempt the earlier boundary's content break.
    const claimsPath = path.join(workDir, CLAIMS_FILENAME);
    const claims = JSON.parse(fs.readFileSync(claimsPath, 'utf8'));
    const reps = claims.groupRepresentations;
    assert.ok(Array.isArray(reps) && reps.length > 0, 'R4: fixture must produce group representations');
    let mutated = false;
    for (const rep of reps) {
      const bucket = rep.claims?.main ?? rep.claims?.minority;
      if (Array.isArray(bucket) && bucket.length > 0) {
        bucket[0].statement = '被篡改的陈述：计数不变但语义已改变';
        mutated = true;
        break;
      }
    }
    assert.ok(mutated, 'R4: fixture must expose a claim to mutate');
    fs.writeFileSync(claimsPath, `${JSON.stringify(claims, null, 2)}\n`);
    fs.rmSync(path.join(workDir, COVERAGE_FINAL));

    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls) });
    assert.equal(out.ok, false, 'R4: two faults must refuse reuse');
    assert.equal(out.reuseBoundary, 'claims', `R4: the boundary must be the EARLIEST fault (claims), got: ${String(out.reuseBoundary)}`);
    assertZeroExternalCalls(calls, 'R4');
  });

  test('R5 (review P1-2): a failed resume attempt BEFORE the re-entry proof leaves the durable checkpoint byte-identical', async () => {
    const workDir = tmpWork('p1-r06-r5-');
    await runUntilInterrupt(workDir);
    const checkpointBefore = fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8');

    // Kill the resume attempt INSIDE the pre-proof window: the injected seam
    // throws before `planResumeReentry` ever runs. The checkpoint's recorded
    // bindings are the only evidence a later process could resume from, so this
    // failure must not persist anything over them.
    const calls = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out = await composeP1Research({
      topic: TOPIC, workDir, ...fixtures(calls, { seam: { listProviders() { throw new Error('synthetic pre-proof interruption'); } } }),
    });
    assert.equal(out.ok, false, 'R5: the pre-proof interruption fails the attempt');
    const checkpointAfter = fs.readFileSync(path.join(workDir, 'orchestration-state.json'), 'utf8');
    assert.equal(checkpointAfter, checkpointBefore, 'R5: the durable checkpoint is byte-identical — the bindings survived');

    // The evidence survived, so the NEXT ordinary resume still reuses retrieval.
    const calls2 = zeroCalls();
    const out2 = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls2) });
    assert.equal(out2.ok, true, `R5: the follow-up resume succeeds: ${JSON.stringify(out2)}`);
    assert.equal(calls2.search, 0, 'R5: retrieval is still reusable — the interrupted evidence was not destroyed');
  });

  test('R6 (review round-2 P1-1): the first checkpoint after a successful re-entry proof never downgrades the proven selectionDecision binding', async () => {
    const workDir = tmpWork('p1-r06-r6-');
    // Run 1: a genuine group-stage interruption leaves a checkpoint whose pool,
    // selectionDecision and ledger bindings are all valid and proven.
    await runUntilInterrupt(workDir);
    const killed = readState(workDir);
    assert.ok(killed.hashes[BINDING_SELECTION_DECISION], 'R6: fixture precondition — the interrupted checkpoint binds the selection decision');

    // Run 2: the resume proves re-entry at the selection boundary, then dies at
    // the exact protocol point the reviewer named: AFTER the first resumed
    // STAGE_SELECT checkpoint write, BEFORE the selection binding is rewritten
    // downstream. A real SIGKILL persists nothing; the injected crash point
    // throwing IS that death, and the kill-shape label is restored afterwards.
    const calls2 = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out2 = await composeP1Research({
      topic: TOPIC, workDir, ...fixtures(calls2, {
        crashPoint: (name) => {
          if (name === 'after_select_checkpoint') {
            throw Object.assign(new Error('synthetic SIGKILL after the resumed STAGE_SELECT checkpoint'), { code: 'R06_TEST_CRASH_POINT' });
          }
        },
      }),
    });
    assert.equal(out2.ok, false, 'R6: the crash point kills the resumed run');
    asKillShape(workDir, 'SELECT');

    // THE P1-1 PIN: the checkpoint written after the proof must STILL carry the
    // proven decision binding. A checkpoint write may never temporarily
    // downgrade durable evidence — a fresh state.hashes that drops it turns the
    // next resume into a redo of a selection that was already proven reusable.
    const after = readState(workDir);
    assert.equal(
      after.hashes[BINDING_SELECTION_DECISION],
      sha256File(path.join(workDir, SELECTION_DECISION_FILENAME)),
      'R6: the post-proof checkpoint still binds the proven selectionDecision bytes',
    );

    // Run 3: therefore the third resume must still reuse the selection.
    const calls3 = zeroCalls();
    const out3 = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls3) });
    assert.equal(out3.ok, true, `R6: the third resume completes: ${JSON.stringify(out3)}`);
    assert.equal(calls3.search, 0, 'R6: retrieval is still reused');
    const reentry3 = lastEvent(workDir, 'resume_reentry');
    assert.equal(reentry3.reusedSelection, true, 'R6: the certified selection is NOT redone by the third resume');
  });

  test('R7 (review round-2 P1-2): an owner persist that landed before the kill is re-proven at resume — the run never falls back to a full re-execution', async () => {
    const workDir = tmpWork('p1-r06-r7-');
    // Run 1: run to just past the T12 corpus-selection owner — its final ledger
    // persist has landed — and die BEFORE the composer refreshed the checkpoint
    // binding. This is exactly the disclosed P1-2 window.
    const calls1 = zeroCalls();
    const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
    const out1 = await composeP1Research({
      topic: TOPIC, workDir, ...fixtures(calls1, {
        crashPoint: (name) => {
          if (name === 'after_corpus_selection') {
            throw Object.assign(new Error('synthetic SIGKILL after the corpus-selection owner returned'), { code: 'R06_TEST_CRASH_POINT' });
          }
        },
      }),
    });
    assert.equal(out1.ok, false, 'R7: the crash point kills the producing run');
    asKillShape(workDir, 'ANALYZE');

    // Precondition — the reviewer's window is real: the checkpoint's ledger
    // binding names OLDER bytes than the ledger the owner left on disk.
    const checkpoint = readState(workDir);
    assert.notEqual(
      checkpoint.hashes[BINDING_COVERAGE_STATE],
      sha256File(path.join(workDir, COVERAGE_STATE)),
      'R7: fixture precondition — the ledger binding is stale, exactly the P1-2 window',
    );

    // Run 2: the resume must NOT punish the durable owner work with a full
    // re-execution from retrieval. The owner's own write receipt vouches for
    // the on-disk ledger bytes, so the proven boundaries stay proven.
    const calls2 = zeroCalls();
    const out2 = await composeP1Research({ topic: TOPIC, workDir, ...fixtures(calls2) });
    assert.equal(out2.ok, true, `R7: the resume completes: ${JSON.stringify(out2)}`);
    assert.equal(calls2.search, 0, 'R7: retrieval is NOT redone — a stale binding alone must never force a rerun');
    assert.equal(calls2.capture, 0, 'R7: completed groups are NOT recaptured');
    const reentry2 = lastEvent(workDir, 'resume_reentry');
    assert.equal(reentry2.reusedRetrieval, true, 'R7: the resume re-enters at the proven boundary');
    assert.equal(reentry2.reusedSelection, true, 'R7: selection is reused too');
    assert.equal(reentry2.ledgerReceiptVouched, true, 'R7: the ledger bytes are accepted via the owner write receipt, audibly');
  });
});

void runIdentityHash;

