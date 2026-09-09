// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p1-t15-coverage-final-integration.test.mjs
 *
 * P1-T15 — Final coverage integration focused suite (Issue #47).
 *
 * Counterexample-first contract tests for the ONE final integration owner
 * (lib/coverage-final-integration.mjs) and the additive v0.3 render/disclosure
 * consumption (orchestrator.mjs loadP1FinalCoverage):
 *   CE1  selected != analyzed  → 100% assertion refused, partial disclosure
 *   CE2  partial never rendered complete (disclosure driven by the reconciled
 *        ledger flag, NEVER by guard PASS / mode naming)
 *   CE3  T14 guard PASS does NOT eliminate T15 final reconciliation (desync
 *        counterexample: guard PASS + ledger unequal → still refused)
 *   CE4  no second analyzed-set writer (hook-layer rejection + driver write-path
 *        scan + ledger identity through the T13 hook path only)
 *   CE5  new_*_rate ownership pinned (T13-before-T14 sequence enforced;
 *        out-of-order / cyclic / incomplete convergence journals refused)
 *   CE6  fusedCandidateCount (retrieval/fusion candidate count, controller
 *        last-writer) distinct from fusedGroupCount (T08 selected-group count)
 *   CE7  retrieval feedback loop closed (round → CoverageState → saturation →
 *        legal continue/stop/budget/provider-failure decision → downstream)
 *   CE8  failure/partial state never disclosed as complete
 *   CE9  observability portability (work-relative refs, no machine-private
 *        absolute paths in persisted artifacts)
 * plus the end-to-end composition proof: the complete P1 runtime path
 * (plan → retrieval rounds → selection → multi-group execution → RCE →
 * per-group analysis → synthesis → final reconciliation) joined through the
 * EXISTING T06-T14 components with the frozen CoverageState ledger as spine.
 *
 * Offline-deterministic: injected mock seam / capture / runner / runtimes /
 * embeddings. No network. Real T06-T14 modules exercised, never bypassed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  beginResearchCoverageLedger,
  runRetrievalFeedbackLoop,
  applySourceGroupSelection,
  executeSelectedGroups,
  selectResearchCorpusWithCoverage,
  analyzeSelectedCorpus,
  produceSynthesisWithCoverage,
  finalizeResearchCoverage,
  buildFinalDisclosure,
  beginConvergenceJournal,
  recordStage,
  CFI_ERROR_INVALID_INPUT,
  CFI_ERROR_STAGE_ORDER_INVALID,
  CFI_ERROR_RETRIEVAL_FAILED,
  CFI_ERROR_GUARD_EVIDENCE_REQUIRED,
  STAGE_RETRIEVAL_ROUNDS,
  STAGE_SOURCE_GROUP_SELECTION,
  STAGE_GROUP_EXECUTION,
  STAGE_CORPUS_SELECTION,
  STAGE_PER_GROUP_ANALYSIS,
  STAGE_CROSS_SOURCE_SYNTHESIS,
  CANONICAL_STAGE_ORDER,
  COVERAGE_STATE_FILENAME,
  FINAL_COVERAGE_FILENAME,
} from '../lib/coverage-final-integration.mjs';
import {
  createInitialCoverageState,
  loadCoverageState,
  updatePerGroupAnalysis,
  updateSelectionAccounting,
  COVERAGE_ERROR_INCOMPLETE_ANALYSIS,
  COVERAGE_ERROR_UNAUTHORIZED_OWNER,
} from '../lib/coverage-state.mjs';
import { planHash } from '../lib/plan-contract.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { deriveCanonicalSourceId } from '../lib/rce-input-adapter.mjs';
import { REQUIRED_EMBEDDING_IDENTITY } from '../lib/dense-geometry.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { createOrchestrator, OrchestrationError } from '../lib/orchestrator.mjs';
import { STAGE_RENDER, STAGES } from '../lib/state.mjs';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = () => '2026-09-10T12:00:00.000Z';
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

function tmpWork(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Minimal valid plan (T04 contract). */
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

/** Plan with ONE groupKey-bound intent (drives selected < eligible). */
const PLAN_BOUND = {
  ...PLAN,
  sourceGroupIntents: [{ intent: '核心问题讨论', constraints: [], groupKey: '100' }],
};

/** Plan with ONE free intent (drives the material-ambiguity boundary). */
const PLAN_FREE_INTENT = {
  ...PLAN,
  sourceGroupIntents: [{ intent: '代表性讨论', constraints: [], groupKey: null }],
};

/** §5.1-shape search result fixture. entries: [questionId, rank]. */
function searchResult(providerId, entries, { ok = true, failure = null } = {}) {
  return {
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
      status: 'unknown',
      evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' },
    },
    ...(failure ? { failure } : {}),
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

/** Multi-channel seam: every channel returns the same full ranking. */
function rankingSeam(questionIds) {
  const ranking = questionIds.map((qid, i) => [qid, i + 1]);
  return createProviderSeam({
    adapters: [
      fixtureSearchAdapter('fixture-a', () => searchResult('fixture-a', ranking)),
      fixtureSearchAdapter('fixture-b', () => searchResult('fixture-b', ranking)),
    ],
  });
}

function allFailedSeam() {
  return createProviderSeam({
    adapters: [
      fixtureSearchAdapter('fixture-a', () => searchResult('fixture-a', [], {
        ok: false,
        failure: { code: 'PROVIDER_TRANSPORT_FAILED', class: 'transport' },
      })),
      fixtureSearchAdapter('fixture-b', () => searchResult('fixture-b', [], {
        ok: false,
        failure: { code: 'PROVIDER_TRANSPORT_FAILED', class: 'transport' },
      })),
    ],
  });
}

/** Deterministic 768-dim unit-norm embedding with the accepted identity. */
function fixtureEmbedding(seed) {
  return { vector: mockVector768(seed), identity: { ...REQUIRED_EMBEDDING_IDENTITY } };
}

function embeddingSeed(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h + 1;
}

/** T13-shape mock semantic runtime (controller-issued tokens only). */
function t13MockRuntime() {
  return {
    runtimeId: 'mock-deepseek-api-tool-less',
    analyze: async ({ projection }) => {
      assert.ok(typeof projection === 'string' && projection.length > 0);
      const tokens = [...projection.matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      assert.ok(tokens.length > 0, 'mock runtime saw no issued tokens');
      return {
        main: [{ tokenRef: tokens[0], statement: '主流观点：该做法在多数场景下有效' }],
        minority: [{ tokenRef: tokens[tokens.length - 1], statement: '少数派观点：特定条件下结论相反' }],
        contradictory: [],
        expertEvidenceRichTokens: [tokens[0]],
      };
    },
  };
}

/** T14-shape mock synthesis runtime: one aspect over ALL claims (partition). */
function t14MockRuntime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    synthesize({ claims }) {
      return { aspects: [{ aspect: '总体有效性', claimIds: claims.map((c) => c.claimId) }] };
    },
  };
}

const GROUP_100_TEXTS = ['回答一：总体上有效，多数场景成立。', '回答二：小样本下有反例。'];
const GROUP_200_TEXTS = ['回答三：另一个问题下的主流经验。', '回答四：补充：成本是主要顾虑。'];

/** Canonical answers.json content for one captured question group. */
function answersJsonFor(questionId, answerTexts) {
  return {
    questionId,
    answers: answerTexts.map((content, i) => ({
      id: `${questionId}-a-${i + 1}`,
      content,
      author: i % 2 === 0 ? `作者${questionId}-甲` : `作者${questionId}-乙`,
      voteupCount: 10 - i,
    })),
  };
}

/** Multi-group capture mock: writes real answers.json per group. */
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
          ok: false,
          provider_id: 'zhihu-session-capture',
          capability: 'capture',
          auth_class: 'session',
          retrieved_at: FIXED_NOW(),
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
        retrieved_at: FIXED_NOW(),
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

/** Mock runner for the T09 verify/handoff authority mirroring. */
function groupRunnerFor() {
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
      fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ questionId: String(doc.questionId), task: 'digest', sourceType: 'session-capture', generatedBy: 'fixture' }, null, 2)}\n`);
      return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') {
      return { status: 0, stdout: JSON.stringify({ valid: true }) };
    }
    throw new Error(`unexpected runner command: ${name}`);
  };
}

/** Drive the deterministic P1 chain through synthesis with injected mocks. */
async function driveChain({ workDir, plan = PLAN } = {}) {
  const journal = beginConvergenceJournal();
  const identity = planHash(plan);
  const started = beginResearchCoverageLedger({ plan, planHash: identity, workDir });
  let coverageState = started.coverageState;
  const loop = runRetrievalFeedbackLoop({
    coverageState, plan, planHash: identity, workDir, seam: rankingSeam(['100', '200']),
    channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
  });
  coverageState = loop.coverageState;
  const selection = applySourceGroupSelection({ coverageState, pool: loop.pool, plan, workDir, journal });
  coverageState = selection.coverageState;
  const groups = executeSelectedGroups({
    coverageState, decision: selection.decision, planHash: identity, workDir,
    captureAdapter: captureAdapterFor({
      100: answersJsonFor('100', GROUP_100_TEXTS),
      200: answersJsonFor('200', GROUP_200_TEXTS),
    }),
    runner: groupRunnerFor(),
    journal,
  });
  coverageState = groups.coverageState;
  const answersByGroup = { 100: GROUP_100_TEXTS, 200: GROUP_200_TEXTS };
  const embeddingsBySourceId = {};
  const targetEmbeddingByGroupId = {};
  for (const g of groups.manifest.groups) {
    // candidates share the group target direction (above the selector relevance
    // floor → the full selected set is analyzed; deterministic offline fixture)
    targetEmbeddingByGroupId[g.groupId] = fixtureEmbedding(embeddingSeed(`target-${g.groupId}`));
    for (const a of answersJsonFor(g.questionId, answersByGroup[g.questionId]).answers) {
      const cid = deriveCanonicalSourceId(g.groupId, a.id);
      embeddingsBySourceId[cid] = fixtureEmbedding(embeddingSeed(`target-${g.groupId}`));
    }
  }
  const corpus = selectResearchCorpusWithCoverage({
    coverageState, manifest: groups.manifest, workDir,
    embeddingsBySourceId, targetEmbeddingByGroupId, journal,
  });
  coverageState = corpus.coverageState;
  const analysis = await analyzeSelectedCorpus({
    coverageState, corpusArtifact: corpus.corpusArtifact, manifest: groups.manifest,
    planHash: identity, runtime: t13MockRuntime(), workDir, journal,
  });
  coverageState = analysis.coverageState;
  const synthesis = produceSynthesisWithCoverage({
    coverageState, seamCArtifact: analysis.seamCArtifact, runtime: t14MockRuntime(), workDir, journal,
  });
  coverageState = synthesis.coverageState;
  return { journal, coverageState, loop, selection, groups, corpus, analysis, synthesis };
}

/** Guard-PASS SEAM D artifact for desync counterexamples (H2/H3). */
function guardPassSynthesisArtifact(planHash0, identityHex) {
  return {
    seam: 'T14_TO_T15',
    seamVersion: 1,
    planHash: planHash0,
    preSynthesisGuard: {
      guardResult: 'PASS',
      selectedVerifiedSourceSetIdentity: `sha256:${identityHex}`,
      mappedAnalyzedSourceSetIdentity: `sha256:${identityHex}`,
    },
    synthesis: {
      synthesisIdentity: `sha256:${identityHex.split('').reverse().join('')}`,
      claims: [], groupDifferences: [], evidenceStrength: [], discussionVolumeDifferences: { byGroup: {} },
    },
    diagnostics: { new_aspect_rate: 0.5, new_claim_rate: 0.5, new_expert_rate: 0.5, new_contradiction_rate: 0.5, claim_source_diversity: 0.5 },
  };
}

/** Full canonical journal prefix (everything before the T15 stage). */
function fullJournal() {
  const journal = beginConvergenceJournal();
  for (const s of CANONICAL_STAGE_ORDER.slice(0, 6)) recordStage(journal, s);
  return journal;
}

// ---------------------------------------------------------------------------
// A. ledger begin
// ---------------------------------------------------------------------------

describe('T15 ledger begin', () => {
  test('A1: initial valid ledger persisted with plan identity; journal empty', () => {
    const work = tmpWork('t15-a1-');
    const { coverageState, journal } = beginResearchCoverageLedger({ plan: PLAN, planHash: PLAN_HASH, workDir: work });
    assert.equal(coverageState.planHash, PLAN_HASH);
    assert.equal(coverageState.retrieval.retrievalRounds, 0);
    assert.equal(coverageState.analysisCoverage.is100PercentAnalysis, false);
    assert.deepEqual(journal.stages, []);
    const loaded = loadCoverageState(work, PLAN_HASH);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.planHash, PLAN_HASH);
  });
  test('A2: malformed planHash fails closed', () => {
    const work = tmpWork('t15-a2-');
    assert.throws(() => beginResearchCoverageLedger({ plan: PLAN, planHash: 'not-a-hash', workDir: work }), (e) => e.code !== undefined);
  });
});

// ---------------------------------------------------------------------------
// B. retrieval feedback loop (CE7)
// ---------------------------------------------------------------------------

describe('T15 retrieval feedback loop (CE7)', () => {
  test('B1: round 1 CONTINUE → round 2 SATURATED (zero new); ledger + pools + events persisted', () => {
    const work = tmpWork('t15-b1-');
    const journal = beginConvergenceJournal();
    const started = beginResearchCoverageLedger({ plan: PLAN, planHash: PLAN_HASH, workDir: work });
    const loop = runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: PLAN, planHash: PLAN_HASH, workDir: work,
      seam: rankingSeam(['100', '200', '300']), channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
    });
    assert.equal(loop.ok, true);
    assert.equal(loop.decision, 'SATURATED');
    assert.equal(loop.stopReason, 'zero_new_candidates');
    assert.equal(loop.coverageState.retrieval.retrievalRounds, 2);
    assert.equal(loop.coverageState.retrieval.stopReason, 'zero_new_candidates');
    // 3 unique candidates accumulated across both channels and both rounds
    assert.equal(loop.coverageState.retrieval.fusedCandidateCount, 3);
    // novelty_gain written by the controller hook (T06-owned); final round = 0
    assert.equal(loop.coverageState.diagnostics.novelty_gain, 0);
    // executed routes accumulate: 2 rounds × (2 query variants × 2 channels) = 8
    assert.equal(loop.coverageState.retrieval.executedRoutes.length, 8);
    assert.ok(loop.coverageState.retrieval.executedRoutes.every((r) => r.roundIndex >= 1));
    // per-round pool artifacts persisted (work-relative)
    assert.ok(fs.existsSync(path.join(work, 'retrieval-rounds', 'round-1', 'retrieval-pool.json')));
    assert.ok(fs.existsSync(path.join(work, 'retrieval-rounds', 'round-2', 'retrieval-pool.json')));
    // accumulated pool for downstream selection
    assert.equal(loop.pool.candidates.length, 3);
    assert.equal(loop.pool.planHash, PLAN_HASH);
    // ledger persisted after the rounds
    const loaded = loadCoverageState(work, PLAN_HASH);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.retrieval.retrievalRounds, 2);
    // progress events recorded
    const events = fs.readFileSync(path.join(work, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.event === 'retrieval_round' && e.roundIndex === 1 && e.decision === 'CONTINUE'));
    assert.ok(events.some((e) => e.event === 'retrieval_round' && e.roundIndex === 2 && e.decision === 'SATURATED'));
    // convergence journal recorded the stage exactly once (acyclic)
    assert.deepEqual(journal.stages, [STAGE_RETRIEVAL_ROUNDS]);
  });

  test('B2: maxRetrievalRounds=1 → BUDGET_STOP with the pool available for downstream', () => {
    const work = tmpWork('t15-b2-');
    const journal = beginConvergenceJournal();
    const started = beginResearchCoverageLedger({ plan: PLAN, planHash: PLAN_HASH, workDir: work });
    const loop = runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: PLAN, planHash: PLAN_HASH, workDir: work,
      seam: rankingSeam(['100', '200']), channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
      config: { maxRetrievalRounds: 1 },
    });
    assert.equal(loop.decision, 'BUDGET_STOP');
    assert.equal(loop.stopReason, 'max_rounds_reached');
    assert.equal(loop.coverageState.retrieval.retrievalRounds, 1);
    assert.equal(loop.pool.candidates.length, 2);
  });

  test('B3: all providers fail round 1 → PROVIDER_FAILURE stop, recorded, no pool; selection refuses', () => {
    const work = tmpWork('t15-b3-');
    const journal = beginConvergenceJournal();
    const started = beginResearchCoverageLedger({ plan: PLAN, planHash: PLAN_HASH, workDir: work });
    const loop = runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: PLAN, planHash: PLAN_HASH, workDir: work,
      seam: allFailedSeam(), channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
    });
    assert.equal(loop.decision, 'PROVIDER_FAILURE');
    assert.equal(loop.stopReason, 'all_providers_failed_this_round');
    // 2 query variants × 2 providers all failed = 4 failed channel records
    assert.equal(loop.coverageState.retrieval.providerFailures.length, 4);
    assert.equal(loop.coverageState.retrieval.stopReason, 'all_providers_failed_this_round');
    assert.equal(loop.pool, null);
    assert.throws(() => applySourceGroupSelection({
      coverageState: loop.coverageState, pool: null, plan: PLAN, workDir: work, journal,
    }), (e) => e.code === CFI_ERROR_INVALID_INPUT);
  });

  test('B4: retrieval contract failure (invalid plan) fails closed with stable code', () => {
    const work = tmpWork('t15-b4-');
    const journal = beginConvergenceJournal();
    const started = beginResearchCoverageLedger({ plan: PLAN, planHash: PLAN_HASH, workDir: work });
    const brokenPlan = { ...PLAN, queryVariants: [] };
    assert.throws(() => runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: brokenPlan, planHash: PLAN_HASH, workDir: work,
      seam: rankingSeam(['100']), channels: [{ providerId: 'fixture-a' }], journal,
    }), (e) => e.code === CFI_ERROR_RETRIEVAL_FAILED);
  });

  test('B5: fusedCandidateCount monotone across rounds (never decreases)', () => {
    const work = tmpWork('t15-b5-');
    const journal = beginConvergenceJournal();
    const started = beginResearchCoverageLedger({ plan: PLAN, planHash: PLAN_HASH, workDir: work });
    const loop = runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: PLAN, planHash: PLAN_HASH, workDir: work,
      seam: rankingSeam(['100', '200']), channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
      config: { maxRetrievalRounds: 2, saturationNoveltyGainThreshold: 0.0 },
    });
    assert.ok(loop.coverageState.retrieval.fusedCandidateCount >= 2);
  });
});

// ---------------------------------------------------------------------------
// C. source-group selection + fused-count ownership (CE6)
// ---------------------------------------------------------------------------

describe('T15 source-group selection + fused-count ownership (CE6)', () => {
  test('C1: intent-bound selection → fusedCandidateCount stays pool candidate count; fusedGroupCount = selected groups', () => {
    const work = tmpWork('t15-c1-');
    const journal = beginConvergenceJournal();
    const boundHash = planHash(PLAN_BOUND);
    const started = beginResearchCoverageLedger({ plan: PLAN_BOUND, planHash: boundHash, workDir: work });
    const loop = runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: PLAN_BOUND, planHash: boundHash, workDir: work,
      seam: rankingSeam(['100', '200', '300']), channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
      config: { maxRetrievalRounds: 1 },
    });
    const selection = applySourceGroupSelection({ coverageState: loop.coverageState, pool: loop.pool, plan: PLAN_BOUND, workDir: work, journal });
    assert.equal(selection.ok, true);
    assert.equal(selection.decision.verdict, 'auto');
    assert.equal(selection.decision.selectedGroupCount, 1); // mandatory bound group only
    assert.equal(selection.decision.candidates.length, 3); // eligible groups
    // CE6: retrieval/fusion candidate count (controller last-writer) never silently
    // becomes the selected-group count
    assert.equal(selection.coverageState.retrieval.fusedCandidateCount, 3);
    assert.equal(selection.coverageState.retrieval.fusedGroupCount, 1);
    assert.notEqual(selection.coverageState.retrieval.fusedCandidateCount, selection.coverageState.retrieval.fusedGroupCount);
  });

  test('C2: material ambiguity → clarificationRequired (no selection write); valid clarification resolves once', () => {
    const work = tmpWork('t15-c2-');
    const journal = beginConvergenceJournal();
    const freeHash = planHash(PLAN_FREE_INTENT);
    const started = beginResearchCoverageLedger({ plan: PLAN_FREE_INTENT, planHash: freeHash, workDir: work });
    const loop = runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: PLAN_FREE_INTENT, planHash: freeHash, workDir: work,
      seam: rankingSeam(['100', '200', '300']), channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
      config: { maxRetrievalRounds: 1 },
    });
    const selection = applySourceGroupSelection({ coverageState: loop.coverageState, pool: loop.pool, plan: PLAN_FREE_INTENT, workDir: work, journal });
    assert.equal(selection.clarificationRequired, true);
    assert.ok(selection.decision.clarification.options.length >= 2);
    // no fused-group write happened (no selection was made)
    assert.equal(selection.coverageState.retrieval.fusedGroupCount, 0);
    // journal still only has the retrieval stage (selection did not complete)
    assert.deepEqual(journal.stages, [STAGE_RETRIEVAL_ROUNDS]);
    // the single legal clarification resolves the ambiguity (never re-asks)
    const resolved = applySourceGroupSelection({
      coverageState: selection.coverageState, pool: loop.pool, plan: PLAN_FREE_INTENT, workDir: work, journal,
      clarification: { forceGroupIds: ['100'] },
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.decision.clarificationCount, 1);
    assert.equal(resolved.coverageState.retrieval.fusedGroupCount, 1);
    assert.deepEqual(journal.stages, [STAGE_RETRIEVAL_ROUNDS, STAGE_SOURCE_GROUP_SELECTION]);
  });

  test('C3: no valid group → fail closed outcome', () => {
    const work = tmpWork('t15-c3-');
    const journal = beginConvergenceJournal();
    const started = beginResearchCoverageLedger({ plan: PLAN, planHash: PLAN_HASH, workDir: work });
    const loop = runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: PLAN, planHash: PLAN_HASH, workDir: work,
      seam: rankingSeam(['100']), channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
      config: { maxRetrievalRounds: 1 },
    });
    // all eligible groups dropped via minScore → none verdict
    const selection = applySourceGroupSelection({
      coverageState: loop.coverageState, pool: loop.pool, plan: PLAN, workDir: work, journal,
      minScore: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(selection.ok, false);
    assert.equal(selection.code, 'selection_no_valid_group');
  });

  test('C4: selection stage recorded exactly once; counts coherent after auto-selection', () => {
    const work = tmpWork('t15-c4-');
    const journal = beginConvergenceJournal();
    const started = beginResearchCoverageLedger({ plan: PLAN, planHash: PLAN_HASH, workDir: work });
    const loop = runRetrievalFeedbackLoop({
      coverageState: started.coverageState, plan: PLAN, planHash: PLAN_HASH, workDir: work,
      seam: rankingSeam(['100', '200', '300']), channels: [{ providerId: 'fixture-a' }, { providerId: 'fixture-b' }], journal,
      config: { maxRetrievalRounds: 1 },
    });
    const selection = applySourceGroupSelection({ coverageState: loop.coverageState, pool: loop.pool, plan: PLAN, workDir: work, journal });
    assert.equal(selection.coverageState.retrieval.fusedCandidateCount, 3);
    assert.equal(selection.coverageState.retrieval.fusedGroupCount, 3);
    assert.deepEqual(journal.stages, [STAGE_RETRIEVAL_ROUNDS, STAGE_SOURCE_GROUP_SELECTION]);
    // acyclicity: re-running the selection stage on the same journal is refused
    assert.throws(() => applySourceGroupSelection({ coverageState: selection.coverageState, pool: loop.pool, plan: PLAN, workDir: work, journal }), (e) => e.code === CFI_ERROR_STAGE_ORDER_INVALID);
  });
});

// ---------------------------------------------------------------------------
// H. full chain convergence → final reconciliation (CE1-CE9)
// ---------------------------------------------------------------------------

describe('T15 full chain convergence → final reconciliation', () => {
  test('H1 (chain): complete runtime path joins real components; 100% assertion on mechanical equality', async () => {
    const work = tmpWork('t15-h1-');
    const driven = await driveChain({ workDir: work });
    const { journal, coverageState, synthesis } = driven;
    // journal = exact canonical stage order, each stage exactly once (acyclic)
    assert.deepEqual(journal.stages, CANONICAL_STAGE_ORDER.slice(0, 6));
    // selected == analyzed (full analysis of every selected source)
    assert.ok(coverageState.analysisCoverage.selectedCorpusSourceSet.length > 0);
    assert.deepEqual(
      coverageState.analysisCoverage.analyzedSourceSet,
      coverageState.analysisCoverage.selectedCorpusSourceSet,
    );
    assert.ok(synthesis.synthesisArtifact.synthesis.claims.length > 0);

    const final = finalizeResearchCoverage({
      coverageState, synthesisArtifact: synthesis.synthesisArtifact, workDir: work, journal,
      requireFullCoverage: true,
      runtimeIdentity: { runtimeId: 'deepseek-api-tool-less', model: 'deepseek-v4-flash' },
    });
    assert.equal(final.ok, true);
    assert.equal(final.coverageState.analysisCoverage.is100PercentAnalysis, true);
    assert.ok(fs.existsSync(path.join(work, FINAL_COVERAGE_FILENAME)));
    const artifact = JSON.parse(fs.readFileSync(path.join(work, FINAL_COVERAGE_FILENAME), 'utf8'));
    assert.equal(artifact.type, 'p1-final-coverage-integration');
    assert.equal(artifact.assertion.is100PercentAnalysis, true);
    assert.equal(artifact.assertion.basis, 'MECHANICAL_SET_EQUALITY');
    // double defense recorded: T14 guard + T15 reconciliation, both present
    assert.equal(artifact.doubleDefense.t14PreSynthesisGuard.guardResult, 'PASS');
    assert.equal(artifact.doubleDefense.t15FinalReconciliation, 'PASS');
    // observability minimum: stage / pipeline identity / coverage / runtime identity
    assert.equal(artifact.stage, 'FINAL_COVERAGE_RECONCILIATION');
    assert.ok(artifact.pipeline);
    assert.ok(artifact.runtime.runtimeId);
    assert.ok(artifact.coverage.retrieval.retrievalRounds >= 1);
    assert.deepEqual(artifact.hookConvergenceOrder, CANONICAL_STAGE_ORDER);
    // disclosure driven by the reconciled flag
    assert.equal(final.disclosure.isFullCoverage, true);
    assert.equal(final.disclosure.complete, true);
    assert.equal(final.disclosure.gap, null);
    // reconciled ledger persisted
    const loaded = loadCoverageState(work, PLAN_HASH);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.analysisCoverage.is100PercentAnalysis, true);
  });

  test('H2 (CE1/CE2/CE3): guard PASS + ledger desync → 100% refused; partial disclosure with gap evidence', () => {
    const work = tmpWork('t15-h2-');
    let coverageState = createInitialCoverageState({ planHash: PLAN_HASH, plannedQueryVariants: PLAN.queryVariants });
    const selected = ['asrc-aaaaaaaaaaaaaaaaaaaaaaaa', 'asrc-bbbbbbbbbbbbbbbbbbbbbbbb', 'asrc-cccccccccccccccccccccccc'];
    coverageState = updateSelectionAccounting(coverageState, { selectedCorpusSourceSet: selected }, { caller: 'T12' });
    coverageState = updatePerGroupAnalysis(
      coverageState,
      {
        mappedSourceSet: [selected[0], selected[1]],
        analyzedSourceSet: [selected[0], selected[1]],
        perGroupMappedSourceSet: { g1: [selected[0], selected[1]] },
        perGroupAnalyzedSourceSet: { g1: [selected[0], selected[1]] },
      },
      { caller: 'T13' },
    );
    const final = finalizeResearchCoverage({
      coverageState, synthesisArtifact: guardPassSynthesisArtifact(PLAN_HASH, 'a'.repeat(64)), workDir: work,
      journal: fullJournal(), requireFullCoverage: true,
    });
    assert.equal(final.ok, false);
    assert.equal(final.code, COVERAGE_ERROR_INCOMPLETE_ANALYSIS);
    // CE2/CE8: disclosure driven by the ledger, never complete — despite guard PASS
    assert.equal(final.partialDisclosure.complete, false);
    assert.equal(final.partialDisclosure.isFullCoverage, false);
    assert.deepEqual(final.partialDisclosure.gap.missingAnalyzed.sort(), [selected[2]]);
    assert.equal(final.partialDisclosure.t14GuardResult, 'PASS');
  });

  test('H3 (CE8): requireFullCoverage=false reconciles honestly; persisted flag false; artifact says partial', () => {
    const work = tmpWork('t15-h3-');
    let coverageState = createInitialCoverageState({ planHash: PLAN_HASH });
    const selected = ['asrc-dddddddddddddddddddddddd', 'asrc-eeeeeeeeeeeeeeeeeeeeeeee'];
    coverageState = updateSelectionAccounting(coverageState, { selectedCorpusSourceSet: selected }, { caller: 'T12' });
    coverageState = updatePerGroupAnalysis(
      coverageState,
      {
        mappedSourceSet: [selected[0]],
        analyzedSourceSet: [selected[0]],
        perGroupMappedSourceSet: { g1: [selected[0]] },
        perGroupAnalyzedSourceSet: { g1: [selected[0]] },
      },
      { caller: 'T13' },
    );
    const final = finalizeResearchCoverage({
      coverageState, synthesisArtifact: guardPassSynthesisArtifact(PLAN_HASH, 'c'.repeat(64)), workDir: work,
      journal: fullJournal(), requireFullCoverage: false,
    });
    assert.equal(final.ok, true); // reconciled honestly
    assert.equal(final.coverageState.analysisCoverage.is100PercentAnalysis, false);
    const artifact = JSON.parse(fs.readFileSync(path.join(work, FINAL_COVERAGE_FILENAME), 'utf8'));
    assert.equal(artifact.assertion.is100PercentAnalysis, false);
    assert.equal(final.disclosure.complete, false);
    assert.deepEqual(final.disclosure.gap.missingAnalyzed.sort(), [selected[1]]);
    const loaded = loadCoverageState(work, PLAN_HASH);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.state.analysisCoverage.is100PercentAnalysis, false);
  });

  test('H4 (CE3 variant): guard evidence missing / FAIL → coded refusal before any reconciliation', () => {
    const work = tmpWork('t15-h4-');
    const coverageState = createInitialCoverageState({ planHash: PLAN_HASH });
    const journal = fullJournal();
    assert.throws(() => finalizeResearchCoverage({
      coverageState,
      synthesisArtifact: {
        seam: 'T14_TO_T15', seamVersion: 1, planHash: PLAN_HASH,
        preSynthesisGuard: { guardResult: 'FAIL_CLOSED', selectedVerifiedSourceSetIdentity: `sha256:${'a'.repeat(64)}`, mappedAnalyzedSourceSetIdentity: `sha256:${'b'.repeat(64)}` },
        synthesis: {}, diagnostics: {},
      },
      workDir: work, journal, requireFullCoverage: true,
    }), (e) => e.code === CFI_ERROR_GUARD_EVIDENCE_REQUIRED);
    assert.throws(() => finalizeResearchCoverage({
      coverageState,
      synthesisArtifact: { seam: 'T14_TO_T15', seamVersion: 1, planHash: PLAN_HASH, synthesis: {}, diagnostics: {} },
      workDir: work, journal: fullJournal(), requireFullCoverage: true,
    }), (e) => e.code === CFI_ERROR_GUARD_EVIDENCE_REQUIRED);
  });

  test('H5 (CE5): convergence journal order enforced — out-of-order / repeated / missing stages refused', () => {
    const work = tmpWork('t15-h5-');
    const coverageState = createInitialCoverageState({ planHash: PLAN_HASH });
    const guardOk = guardPassSynthesisArtifact(PLAN_HASH, 'e'.repeat(64));

    // T14 before T13 (out of order) — forged journal bypassing recordStage;
    // the stage guards must refuse it (no cyclic / reordered convergence).
    let journal = { stages: [STAGE_RETRIEVAL_ROUNDS, STAGE_SOURCE_GROUP_SELECTION, STAGE_GROUP_EXECUTION, STAGE_CORPUS_SELECTION, STAGE_CROSS_SOURCE_SYNTHESIS, STAGE_PER_GROUP_ANALYSIS] };
    assert.throws(() => finalizeResearchCoverage({ coverageState, synthesisArtifact: guardOk, workDir: work, journal, requireFullCoverage: true }), (e) => e.code === CFI_ERROR_STAGE_ORDER_INVALID);

    // repeated stage (cycle)
    journal = beginConvergenceJournal();
    recordStage(journal, STAGE_RETRIEVAL_ROUNDS);
    recordStage(journal, STAGE_SOURCE_GROUP_SELECTION);
    assert.throws(() => recordStage(journal, STAGE_SOURCE_GROUP_SELECTION), (e) => e.code === CFI_ERROR_STAGE_ORDER_INVALID);
    assert.throws(() => recordStage(journal, STAGE_RETRIEVAL_ROUNDS), (e) => e.code === CFI_ERROR_STAGE_ORDER_INVALID);

    // missing stage
    journal = beginConvergenceJournal();
    for (const s of [STAGE_RETRIEVAL_ROUNDS, STAGE_SOURCE_GROUP_SELECTION, STAGE_GROUP_EXECUTION, STAGE_CORPUS_SELECTION, STAGE_PER_GROUP_ANALYSIS]) recordStage(journal, s);
    assert.throws(() => finalizeResearchCoverage({ coverageState, synthesisArtifact: guardOk, workDir: work, journal, requireFullCoverage: true }), (e) => e.code === CFI_ERROR_STAGE_ORDER_INVALID);
  });

  test('H6 (CE9): persisted observability is portable — no machine-private absolute paths', async () => {
    const work = tmpWork('t15-h6-');
    const driven = await driveChain({ workDir: work });
    const final = finalizeResearchCoverage({
      coverageState: driven.coverageState, synthesisArtifact: driven.synthesis.synthesisArtifact,
      workDir: work, journal: driven.journal, requireFullCoverage: true,
    });
    assert.equal(final.ok, true);
    for (const f of [COVERAGE_STATE_FILENAME, FINAL_COVERAGE_FILENAME, 'events.jsonl']) {
      const raw = fs.readFileSync(path.join(work, f), 'utf8');
      assert.ok(!raw.includes(work), `${f} must not contain the absolute work path`);
      assert.ok(!/^[A-Za-z]:[\\/]/m.test(raw), `${f} must not contain drive-letter absolute paths`);
      assert.ok(!raw.includes(os.tmpdir()), `${f} must not contain the machine tmp root`);
    }
  });

  test('H7: disclosure builder — reconciled flag is the ONLY completeness source', () => {
    const sets1 = { selectedCorpusSourceSet: ['s1', 's2', 's3', 's4'], mappedSourceSet: ['s1', 's2', 's3', 's4'], analyzedSourceSet: ['s1', 's2', 's3', 's4'] };
    const d1 = buildFinalDisclosure({
      artifact: { assertion: { is100PercentAnalysis: true }, coverage: { retrieval: { retrievalRounds: 2, stopReason: 'zero_new_candidates', fusedCandidateCount: 3, fusedGroupCount: 2 }, analysisCoverage: sets1 } },
    });
    assert.equal(d1.isFullCoverage, true);
    assert.equal(d1.complete, true);
    assert.equal(d1.gap, null);

    const sets2 = { selectedCorpusSourceSet: ['s1', 's2', 's3', 's4'], mappedSourceSet: ['s1', 's2', 's3'], analyzedSourceSet: ['s1', 's2'] };
    const d2 = buildFinalDisclosure({
      artifact: { assertion: { is100PercentAnalysis: false }, coverage: { retrieval: { retrievalRounds: 1, stopReason: 'max_rounds_reached', fusedCandidateCount: 3, fusedGroupCount: 1 }, analysisCoverage: sets2 } },
    });
    assert.equal(d2.isFullCoverage, false);
    assert.equal(d2.complete, false);
    assert.deepEqual(d2.gap.missingAnalyzed.sort(), ['s3', 's4']);
    assert.deepEqual(d2.gap.missingMapped, ['s4']);
  });

  test('H8 (CE4): no second analyzed-set writer — hook layer rejects non-T13 callers; driver never writes analyzed sets', async () => {
    const coverageState = createInitialCoverageState({ planHash: PLAN_HASH });
    assert.throws(() => updatePerGroupAnalysis(coverageState, { analyzedSourceSet: ['x'] }, { caller: 'T15' }), (e) => e.code === COVERAGE_ERROR_UNAUTHORIZED_OWNER);
    assert.throws(() => updatePerGroupAnalysis(coverageState, { analyzedSourceSet: ['x'] }, { caller: 'T14' }), (e) => e.code === COVERAGE_ERROR_UNAUTHORIZED_OWNER);
    // driver source scan: the final integration owner must not reference the T13
    // hook path nor its owner token (single-writer contract — analyzed-set
    // writes flow ONLY through runPerGroupAnalysis, whose T13 hook call the
    // driver consumes as data)
    const src = fs.readFileSync(path.join(THIS_DIR, '..', 'lib', 'coverage-final-integration.mjs'), 'utf8');
    assert.ok(!src.includes('updatePerGroupAnalysis'), 'driver must not call the T13 hook directly (analyzed writes flow only through runPerGroupAnalysis)');
    assert.ok(!src.includes('OWNER_T13_ANALYSIS'), 'driver must never claim the T13 owner token');
    // runtime identity: the driver's analysis stage returns the T13 hook result as-is
    const work = tmpWork('t15-h8-');
    const driven = await driveChain({ workDir: work });
    assert.ok(driven.analysis.seamCArtifact);
    assert.ok(driven.coverageState.analysisCoverage.analyzedSourceSet.length > 0);
  });
});

// ---------------------------------------------------------------------------
// I. orchestrator additive render/disclosure consumption
// ---------------------------------------------------------------------------

describe('T15 v0.3 render/disclosure integration', () => {
  test('I1: absent P1 artifact → null (v0.3 path untouched)', async () => {
    const { loadP1FinalCoverage } = await import('../lib/orchestrator.mjs');
    const work = tmpWork('t15-i1-');
    assert.equal(loadP1FinalCoverage(work), null);
  });

  test('I2: malformed P1 artifact → coded coverage_failed (fail closed)', async () => {
    const { loadP1FinalCoverage } = await import('../lib/orchestrator.mjs');
    const work = tmpWork('t15-i2-');
    fs.writeFileSync(path.join(work, FINAL_COVERAGE_FILENAME), '{ not json');
    assert.throws(() => loadP1FinalCoverage(work), (e) => e instanceof OrchestrationError && e.code === 'coverage_failed');
    fs.writeFileSync(path.join(work, FINAL_COVERAGE_FILENAME), JSON.stringify({ type: 'something-else', assertion: {} }));
    assert.throws(() => loadP1FinalCoverage(work), (e) => e instanceof OrchestrationError && e.code === 'coverage_failed');
  });

  /** Seed a minimal valid digest-run work dir whose checkpoint resumes at RENDER. */
  function seedDigestRun(prefix, p1Assertion) {
    const work = tmpWork(prefix);
    const cw = path.join(work, 'corpus');
    fs.mkdirSync(path.join(cw, 'final'), { recursive: true });
    const finalJson = { mode: 'digest', claims: [], summary: null };
    fs.writeFileSync(path.join(cw, 'final', 'final.json'), JSON.stringify(finalJson));
    fs.writeFileSync(path.join(cw, 'coverage.json'), JSON.stringify({ valid: true, mode: 'digest', mapCount: 1, missingMappedSources: 0, staleHashes: 0, hierarchyIssues: null }));
    fs.writeFileSync(path.join(cw, 'final', 'digest.md'), '# digest\n');

    const h = (s) => createHash('sha256').update(s).digest('hex');
    const artifacts = {
      SEARCH: 'search-result.json', SELECT: 'selection-decision.json', CAPTURE: 'zhihu/100/answers.json',
      VERIFY: 'zhihu/100/answers.json', HANDOFF: 'zhihu/100/handoff.json', ANALYZE: 'corpus/final/final.json',
    };
    for (const rel of Object.values(artifacts)) {
      fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
      fs.writeFileSync(path.join(work, rel), 'x');
    }
    const state = {
      schemaVersion: 1,
      runId: h(JSON.stringify({ topic: 't', mode: 'digest', percent: null, runtime: 'deepseek-api-tool-less' })),
      topic: 't', mode: 'digest', percent: null, runtime: 'deepseek-api-tool-less', forceQuestionId: null,
      stage: STAGE_RENDER,
      completedStages: STAGES.filter((s) => ![STAGE_RENDER, 'COMPLETE'].includes(s)),
      selectedQuestionId: '100',
      selectedQuestion: { questionId: '100', title: 'q', answerCount: 1, url: '' },
      selection: { verdict: 'auto', rationale: 'r', candidates: [] },
      artifacts,
      hashes: Object.fromEntries(Object.entries(artifacts).map(([k, rel]) => [k, h(fs.readFileSync(path.join(work, rel), 'utf8'))])),
      verification: { valid: true, questionId: '100', capturedAnswerCount: 1, reportedAnswerCount: 1 },
      coverage: null, analysisResult: { mode: 'digest', percent: null, useHierarchy: false, totalChars: 1, finalJson },
      searchCandidates: [], result: null, updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(work, 'orchestration-state.json'), JSON.stringify(state, null, 2));
    fs.writeFileSync(path.join(work, FINAL_COVERAGE_FILENAME), JSON.stringify({
      type: 'p1-final-coverage-integration', planHash: PLAN_HASH, stage: 'FINAL_COVERAGE_RECONCILIATION',
      pipeline: 'p1-cross-question-deep-research',
      assertion: { is100PercentAnalysis: p1Assertion, basis: 'MECHANICAL_SET_EQUALITY' },
      coverage: { retrieval: { retrievalRounds: p1Assertion ? 2 : 1, stopReason: p1Assertion ? 'zero_new_candidates' : 'max_rounds_reached' } },
    }));
    return work;
  }

  test('I3: stageRender derives the 100% claim ONLY from the reconciled P1 assertion', async () => {
    // Reconciled FALSE → render must NOT claim complete, even in a digest run.
    const work = seedDigestRun('t15-i3-false-', false);
    const orch = createOrchestrator({
      workDir: work, topic: 't', mode: 'digest', percent: null, runtime: 'deepseek-api-tool-less',
      runner: () => ({ status: 0, stdout: '', stderr: '' }),
    });
    const result = await orch.runOrchestration();
    assert.equal(result.analysis.isFullCoverage, false, 'P1 partial must never render complete even in digest-named runs');
    assert.equal(result.analysis.coverageFinal.is100PercentAnalysis, false);
    const md = fs.readFileSync(path.join(work, 'research-result.md'), 'utf8');
    assert.ok(md.includes('部分'), 'partial disclosure must be visible in the human render');
    assert.ok(!md.includes('100% 全量'), 'must not render the v0.3 100% line over a partial P1 reconciliation');

    // Reconciled TRUE → 100% claim allowed, derived from the artifact (independent dir).
    const work2 = seedDigestRun('t15-i3-true-', true);
    const orch2 = createOrchestrator({
      workDir: work2, topic: 't', mode: 'digest', percent: null, runtime: 'deepseek-api-tool-less',
      runner: () => ({ status: 0, stdout: '', stderr: '' }),
    });
    const result2 = await orch2.runOrchestration();
    assert.equal(result2.analysis.isFullCoverage, true);
    assert.equal(result2.analysis.coverageFinal.is100PercentAnalysis, true);
    const md2 = fs.readFileSync(path.join(work2, 'research-result.md'), 'utf8');
    assert.ok(md2.includes('100%'));
  });
});
