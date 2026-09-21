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
import { makeState, readState, writeState, runIdentityHash } from '../lib/state.mjs';
import { MULTI_GROUP_STATE_FILENAME } from '../lib/multi-group-execution.mjs';
import { SELECTION_DECISION_FILENAME } from '../lib/source-group-selection.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
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
      const stable = snapshotWorkDir(workDir);

      m.mutate(workDir);

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

      // no hash self-healing: the mutated dependency is never rewritten/repaired
      const after = snapshotWorkDir(workDir);
      for (const rel of Object.keys(after)) {
        if (rel === 'events.jsonl' || rel === 'orchestration-state.json') continue;
        if (stable[rel] !== undefined) {
          assert.equal(after[rel], stable[rel], `${m.id}: ${rel} must not be rewritten by a failed validation`);
        }
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
