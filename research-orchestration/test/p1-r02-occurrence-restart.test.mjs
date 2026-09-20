// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-r02-occurrence-restart.test.mjs
 *
 * P1-R02 (GitHub Issue #90, Lane A) — new execution-occurrence isolation for
 * explicit restart, exercised through the REAL composeP1Research chain (no
 * helper-only path; runtime/seam/capture/runner/embeddings/planner are the
 * same injected test doubles the P1-T15 wiring suite uses).
 *
 * RED → GREEN contract (RED = failing assertions on base c646a58):
 *
 *   - different-topic restart => the OLD plan is NEVER loaded; the composer
 *     re-proposes a fresh plan for the new topic and ZERO old queries are
 *     issued (old Plan/Coverage/Selection/Manifest/Claims/Synthesis are never
 *     treated as the new occurrence's output).
 *   - same-topic explicit restart => STILL a new occurrence; an identical
 *     canonical planHash must NOT let the prior occurrence's derived research
 *     stages (T09 multi-group state) be reused — achieved WITHOUT deleting
 *     canonical bytes (the prior occurrence's T09 state is archived intact).
 *   - ordinary non-restart process resume => SAME occurrence recognized; the
 *     valid persisted plan is reused (no blanket cancellation of reuse).
 *   - no-restart topic drift => NOT silently accepted as the original-run
 *     resume (fail closed: run_identity_conflict).
 *   - canonical runner dispatch => the canonical gate really passes --restart
 *     to the P1 entrypoint (参数 → CLI → composer 行为关联).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planHash, persistPlan } from '../lib/plan-contract.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { P1_PIPELINE_IDENTITY } from '../lib/coverage-final-integration.mjs';
import { makeState, readState, writeState, runIdentityHash } from '../lib/state.mjs';
import { MULTI_GROUP_STATE_FILENAME } from '../lib/multi-group-execution.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RO_ROOT = path.resolve(HERE, '..');
const PRIOR_OCCURRENCE_ARCHIVE = `${MULTI_GROUP_STATE_FILENAME}.prior-occurrence.bak`;

function tmpWork(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readEvents(workDir) {
  const file = path.join(workDir, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// fixtures (mirror the P1-T15 wiring-double strategy)
// ---------------------------------------------------------------------------

const PLAN_A = {
  schemaVersion: 1,
  queryVariants: ['A 题 检索词 一', 'A 题 检索词 二'],
  aspects: ['岗位影响'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

const PLAN_B = {
  schemaVersion: 1,
  queryVariants: ['B 题 检索词 一', 'B 题 检索词 二'],
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
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
    ...(failure ? { failure } : {}),
  };
}

/**
 * Fixture search seam that RECORDS every issued query so the test can prove
 * which plan's query variants were actually executed (zero old-query check).
 */
function recordingRankingSeam(questionIds, issuedQueries) {
  const ranking = questionIds.map((qid, i) => [qid, i + 1]);
  const adapter = (providerId) => ({
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve: (input) => {
      issuedQueries.push(input?.query ?? null);
      return searchResult(providerId, ranking);
    },
  });
  return createProviderSeam({ adapters: [adapter('fixture-official'), adapter('fixture-global')] });
}

function testEmbeddingProvider() {
  return {
    preflight: async () => ({ ok: true }),
    embed: async (texts) => ({ vectors: texts.map(() => mockVector768(7)) }),
  };
}

function pinnedMockRuntime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
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
      return { aspects: [{ aspect: '总体有效性', claimIds: claims.map((c) => c.claimId) }] };
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

function captureAdapterFor(answersByQuestion) {
  return {
    providerId: 'zhihu-session-capture',
    capability: 'capture',
    authClass: 'session',
    retrieve({ questionId, outDir }) {
      const dir = path.join(outDir, String(questionId));
      fs.mkdirSync(dir, { recursive: true });
      const doc = answersByQuestion[String(questionId)];
      if (!doc) {
        return {
          ok: false, provider_id: 'zhihu-session-capture', capability: 'capture', auth_class: 'session',
          retrieved_at: '2026-09-10T12:00:00.000Z', items: [],
          completeness: { status: 'unknown', evidence: { basis: 'fixture' } },
          failure: { code: 'CAPTURE_FIXTURE_MISSING', class: 'identity' },
        };
      }
      fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify(doc, null, 2)}\n`);
      return {
        ok: true, provider_id: 'zhihu-session-capture', capability: 'capture', auth_class: 'session',
        retrieved_at: '2026-09-10T12:00:00.000Z',
        items: [{ identity: { kind: 'group', questionId: String(questionId) }, provenance: { route: 'fixture-capture', rank: 1, rankOrigin: 'fixture' }, facts: { capturedAnswerCount: doc.answers.length } }],
        completeness: { status: 'complete', evidence: { basis: 'fixture_complete_pagination' } },
      };
    },
  };
}

function groupRunnerFor() {
  return (name, args) => {
    if (name === 'zhihu-verify') {
      const doc = JSON.parse(fs.readFileSync(path.join(args[0], 'answers.json'), 'utf8'));
      return { status: 0, stdout: JSON.stringify({ valid: true, questionId: String(doc.questionId), capturedAnswerCount: doc.answers.length, reportedAnswerCount: doc.answers.length }) };
    }
    if (name === 'zhihu-handoff') {
      const dir = args[0];
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
      fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ questionId: String(doc.questionId), task: 'digest', sourceType: 'session-capture', generatedBy: 'fixture' }, null, 2)}\n`);
      return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') {
      return { status: 0, stdout: JSON.stringify({ valid: true }) };
    }
    throw new Error(`unexpected runner command: ${name}`);
  };
}

function fakePlanner(plan, expectRequest) {
  let called = false;
  const fn = async ({ userRequest }) => {
    called = true;
    if (expectRequest !== undefined) assert.equal(userRequest, expectRequest);
    return { ok: true, plan, planHash: planHash(plan), file: 'research-plan.json' };
  };
  fn.wasCalled = () => called;
  return fn;
}

function composeFixtures(overrides = {}) {
  return {
    plan: PLAN_A,
    runtime: pinnedMockRuntime(),
    seam: recordingRankingSeam(['100', '200'], []),
    captureAdapter: captureAdapterFor({
      100: answersJsonFor('100', GROUP_100_TEXTS),
      200: answersJsonFor('200', GROUP_200_TEXTS),
    }),
    runner: groupRunnerFor(),
    embeddingProvider: testEmbeddingProvider(),
    ...overrides,
  };
}

// ===========================================================================

test('R02-RED: different-topic restart never executes the prior occurrence plan (zero old-query execution)', async () => {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const workDir = tmpWork('p1-r02-diff-');

  // First occurrence: topic A, plan A persisted to disk and fully executed.
  const queriesA = [];
  const out1 = await composeP1Research({
    topic: 'A 题', workDir, ...composeFixtures({ plan: PLAN_A, seam: recordingRankingSeam(['100', '200'], queriesA) }),
  });
  assert.equal(out1.ok, true, `first compose failed: ${JSON.stringify(out1)}`);
  assert.equal(out1.result.planHash, planHash(PLAN_A));
  assert.ok(queriesA.some((q) => PLAN_A.queryVariants.includes(q)), 'sanity: occurrence 1 issued plan A queries');
  const oldT09StateBytes = fs.readFileSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME), 'utf8');

  // Second occurrence: explicit restart, DIFFERENT topic B, NO injected plan.
  // A correct composer re-proposes a fresh plan for B; the broken base behavior
  // silently loadPlan()s the stale A plan from disk and executes A's queries.
  const queriesB = [];
  const plannerB = fakePlanner(PLAN_B, 'B 题');
  const out2 = await composeP1Research({
    topic: 'B 题', workDir, restart: true, planner: plannerB,
    ...composeFixtures({ plan: undefined, seam: recordingRankingSeam(['100', '200'], queriesB) }),
  });
  assert.equal(out2.ok, true, `restart compose failed: ${JSON.stringify(out2)}`);
  assert.equal(out2.result.topic, 'B 题');
  // The new occurrence must use B's freshly proposed plan, NOT the stale A plan.
  assert.equal(out2.result.planHash, planHash(PLAN_B), 'restart must not reuse the prior topic plan');
  assert.ok(plannerB.wasCalled(), 'restart must re-propose a fresh plan (planner invoked)');
  // Zero old-query execution: no plan-A query variant may be issued by occurrence 2.
  assert.deepEqual(
    queriesB.filter((q) => PLAN_A.queryVariants.includes(q)), [],
    'restart to a different topic must execute ZERO old-plan queries',
  );
  assert.ok(queriesB.some((q) => PLAN_B.queryVariants.includes(q)), 'new occurrence must execute the new plan queries');
  // Canonical bytes preserved + comparable: the on-disk plan is now B's.
  const onDiskPlan = JSON.parse(fs.readFileSync(path.join(workDir, 'research-plan.json'), 'utf8'));
  assert.equal(planHash(onDiskPlan), planHash(PLAN_B));
  // Occurrence identity is recorded; the prior occurrence's T09 derived state
  // is archived INTACT (canonical bytes preserved, never deleted).
  const state2 = readState(workDir);
  assert.equal(typeof state2.occurrenceId, 'string', 'state must record an occurrenceId');
  assert.ok(fs.existsSync(path.join(workDir, PRIOR_OCCURRENCE_ARCHIVE)), 'prior occurrence T09 state must be archived, not deleted');
  assert.equal(fs.readFileSync(path.join(workDir, PRIOR_OCCURRENCE_ARCHIVE), 'utf8'), oldT09StateBytes, 'archived T09 bytes must be preserved intact');
});

test('R02-RED: same-topic explicit restart is a NEW occurrence — identical planHash does not reuse derived T09 stages', async () => {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const workDir = tmpWork('p1-r02-same-');

  const out1 = await composeP1Research({ topic: '同一题', workDir, ...composeFixtures({ plan: PLAN_A }) });
  assert.equal(out1.ok, true);
  const state1 = readState(workDir);
  const mgs1Bytes = fs.readFileSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME), 'utf8');
  const mgs1 = JSON.parse(mgs1Bytes);
  assert.equal(state1.p1FinalCoveragePlanHash, planHash(PLAN_A));
  assert.equal(mgs1.planHash, planHash(PLAN_A), 'T09 state binds the canonical planHash (comparable across occurrences)');

  // Same topic, same canonical plan bytes — but an explicit restart must NOT
  // treat this as a continuation: a fresh occurrence with fresh T09 derived state.
  const out2 = await composeP1Research({ topic: '同一题', workDir, restart: true, ...composeFixtures({ plan: PLAN_A }) });
  assert.equal(out2.ok, true, `restart compose failed: ${JSON.stringify(out2)}`);
  const state2 = readState(workDir);
  const mgs2 = JSON.parse(fs.readFileSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME), 'utf8'));

  assert.notEqual(state2.occurrenceId, state1.occurrenceId, 'restart must mint a new occurrenceId');
  // canonical planHash stays comparable across occurrences (render binding + T09)
  assert.equal(state2.p1FinalCoveragePlanHash, planHash(PLAN_A));
  assert.equal(mgs2.planHash, planHash(PLAN_A));
  // The prior occurrence's T09 derived state must NOT be consumed as the new
  // occurrence's state: the frozen T09 resume authority must report a FRESH
  // start (no_state) for the new occurrence, and the old bytes are archived.
  const resumeEvents = readEvents(workDir).filter((e) => e.event === 'multi_group_resume');
  assert.ok(resumeEvents.length >= 2, 'both occurrences must pass through the T09 resume authority');
  const lastResume = resumeEvents[resumeEvents.length - 1];
  assert.equal(lastResume.fresh, true, 'same-topic restart must start T09 FRESH, not reuse prior derived state');
  assert.equal(lastResume.boundary, 'no_state');
  assert.equal(fs.readFileSync(path.join(workDir, PRIOR_OCCURRENCE_ARCHIVE), 'utf8'), mgs1Bytes, 'prior occurrence T09 bytes preserved intact');
});

test('R02: ordinary non-restart resume recognizes the SAME occurrence and reuses the persisted plan (no blanket cancellation)', async () => {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const workDir = tmpWork('p1-r02-resume-');

  // Seed a resumable (non-terminal) prior checkpoint + plan for topic A.
  const seededOccurrenceId = '00000000-1111-2222-3333-444444444444';
  writeState(workDir, makeState({
    workDir, topic: 'A 题', mode: P1_PIPELINE_IDENTITY, percent: null,
    runtime: T14_SYNTHESIS_RUNTIME_ID, occurrenceId: seededOccurrenceId,
  }));
  persistPlan(workDir, PLAN_A);

  // Real planner spy: must NOT be invoked (the persisted plan must be reused).
  const plannerSpy = fakePlanner(PLAN_B, 'A 题');
  const out = await composeP1Research({ topic: 'A 题', workDir, restart: false, planner: plannerSpy, ...composeFixtures({ plan: undefined }) });
  assert.equal(out.ok, true, `resume compose failed: ${JSON.stringify(out)}`);
  assert.equal(plannerSpy.wasCalled(), false, 'ordinary resume must reuse the persisted plan, not re-propose');
  const state = readState(workDir);
  assert.equal(state.occurrenceId, seededOccurrenceId, 'ordinary resume must continue the SAME occurrence');
  assert.equal(state.p1FinalCoveragePlanHash, planHash(PLAN_A), 'resumed occurrence binds the reused canonical planHash');
  // No occurrence boundary was crossed: the prior derived state is NOT archived.
  assert.equal(fs.existsSync(path.join(workDir, PRIOR_OCCURRENCE_ARCHIVE)), false, 'ordinary same-occurrence resume must not archive/cancel reuse');
  const events = readEvents(workDir);
  assert.ok(events.some((e) => e.event === 'plan_reused'), 'ordinary resume must record plan reuse');
});

test('R02: no-restart topic drift is rejected (not silently resumed as the original run)', async () => {
  const { composeP1Research } = await import('../lib/p1-runtime-composer.mjs');
  const workDir = tmpWork('p1-r02-drift-');

  const out1 = await composeP1Research({ topic: 'A 题', workDir, ...composeFixtures({ plan: PLAN_A }) });
  assert.equal(out1.ok, true);

  // Different topic, no restart flag -> must NOT silently reuse the A checkpoint.
  const out2 = await composeP1Research({ topic: 'B 题', workDir, restart: false, ...composeFixtures({ plan: undefined }) });
  assert.equal(out2.ok, false, 'topic drift without restart must fail closed');
  assert.equal(out2.code, 'run_identity_conflict', `expected run_identity_conflict, got ${out2.code}`);
});

// ---------------------------------------------------------------------------
// canonical runner dispatch: the canonical gate must pass --restart to the P1
// entrypoint (the "参数 → CLI → composer" link reaching the new-occurrence path).
// ---------------------------------------------------------------------------

describe('R02 canonical runner dispatch carries --restart', () => {
  test('canonical gate spawns the P1 entrypoint with --restart (reaching the composer new-occurrence path)', async () => {
    const { runCanonicalGate } = await import('../bin/canonical-runner.mjs');
    const { loadRuntimeAuthority } = await import('../bin/runtime-authority.mjs');
    const dir = tmpWork('p1-r02-cr-');
    const authority = loadRuntimeAuthority();
    const calls = [];
    const spawnImpl = (file, args, opts) => {
      calls.push({ file, args, opts });
      // simulate a completed canonical run writing the artifacts the gate binds
      const wd = path.join(dir, 'work', 'canonical-research');
      fs.mkdirSync(wd, { recursive: true });
      fs.writeFileSync(path.join(wd, 'orchestration-state.json'), JSON.stringify({
        schemaVersion: 1, runId: 'r'.repeat(64), topic: 'canonical probe',
        mode: 'top-percent', percent: 20, runtime: authority.canonical.runtimeId,
      }, null, 2));
      fs.writeFileSync(path.join(wd, 'research-result.json'), JSON.stringify({
        schemaVersion: 1, topic: 'canonical probe', runtime: authority.canonical.runtimeId,
        selectedQuestion: { url: 'https://example.com/q/1', title: 'probe' },
        verification: { valid: true, capturedAnswerCount: 3 },
      }, null, 2));
      return { status: 0, stdout: '', stderr: '' };
    };
    const env = {
      [authority.env.runtimeMode]: 'canonical',
      [authority.canonical.credentialEnv]: 'present',
    };
    const r = runCanonicalGate({ authority, env, repoRoot: dir, argv: ['canonical probe'], spawnImpl });
    assert.equal(r.ok, true, JSON.stringify(r.detail ?? null));
    assert.equal(calls.length, 1);
    const args = calls[0].args;
    assert.ok(args.includes('--restart'), 'canonical gate must pass --restart to the P1 entrypoint');
    assert.ok(args.includes('--runtime') && args[args.indexOf('--runtime') + 1] === authority.canonical.runtimeId);
  });
});
