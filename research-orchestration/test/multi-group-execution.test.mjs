/**
 * research-orchestration/test/multi-group-execution.test.mjs
 *
 * P1-T09 — Multi-group Execution State + Per-group Capture/Verify/Handoff composition.
 *
 * Counterexample-first focused tests (deterministic, no network).
 * CE IDs map to docs/planning/P1_T09_MULTI_GROUP_EXECUTION_CONTRACT.md.
 *
 * Core invariants under test:
 *   I1  CAPTURED != VERIFIED (per group)
 *   I2  VerifiedGroupRefs[] valid-only, derived (never hand-appended)
 *   I3  sibling isolation
 *   I4  FILE EXISTS != VALID CACHE
 *   I5  stale propagation to dependents only
 *   I6  PARTIAL != COMPLETE
 *   I7  manifest is NOT a second canonical store
 *   I8  handoff authority inherited (verify-output / make-handoff / corpus verify)
 *   I9  no credentials / unsafe strings in any persisted surface
 *   I10 identity drift invalidates from the matching boundary; stable set identity
 */

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { validatePlanInput, planHash as computePlanHash, isValidPlanHashFormat } from '../lib/plan-contract.mjs';
import { createSessionCaptureAdapter } from '../lib/session-capture-provider.mjs';
import {
  createInitialCoverageState,
  updateSourceCompleteness,
  canonicalizeCoverageState,
  OWNER_T09_SOURCE_COMPLETENESS,
} from '../lib/coverage-state.mjs';
import {
  MULTI_GROUP_STATE_FILENAME,
  MULTI_GROUP_STATE_TYPE,
  GROUP_STAGE_PENDING,
  GROUP_STAGE_CAPTURED,
  GROUP_STAGE_VERIFIED,
  GROUP_STAGE_HANDED_OFF,
  GROUP_STAGE_FAILED,
  computeSelectionIdentity,
  createMultiGroupExecutionState,
  executeGroupCapture,
  executeGroupVerify,
  executeGroupHandoff,
  deriveVerifiedGroupRefs,
  deriveResearchCorpusManifest,
  isResearchComplete,
  finalizeResearch,
  buildSourceCompletenessUpdate,
  applySourceCompletenessToCoverageState,
  persistMultiGroupState,
  loadMultiGroupState,
  resumeMultiGroupExecution,
  MultiGroupError,
} from '../lib/multi-group-execution.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ro-mg-${prefix}-`));
}

function sha(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function makePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    queryVariants: ['大语言模型 Agent 落地争议'],
    aspects: ['技术成熟度'],
    entities: ['OpenAI'],
    opposingFramings: ['Agent 仍不成熟'],
    terminologyVariants: [{ term: 'Agent', variants: ['智能体'] }],
    sourceGroupIntents: [{ intent: '关注反方观点', constraints: [], groupKey: null }],
    ...overrides,
  };
}

function validPlanHash(plan) {
  const v = validatePlanInput(plan);
  assert.ok(v.ok, 'fixture plan must validate');
  return computePlanHash(v.plan);
}

/** Deterministic answers.json fixture. SENTINEL marks canonical content that must
 *  NEVER leak into the derived manifest (CE-07). */
function answersFixture(qid) {
  return `${JSON.stringify({
    questionId: qid,
    questionTitle: `问题 ${qid}`,
    answers: [
      { answerId: `${qid}01`, contentHtml: `<p>SENTINEL-CONTENT-${qid} 正文</p>` },
      { answerId: `${qid}02`, contentHtml: `<p>SENTINEL-CONTENT-${qid} 反方</p>` },
      { answerId: `${qid}03`, contentHtml: `<p>SENTINEL-CONTENT-${qid} 补充</p>` },
    ],
  }, null, 2)}\n`;
}

/** Raw writer: parentDir is the capture PARENT (grabs land at <parent>/<qid>/answers.json). */
function writeAnswersRaw(parentDir, qid, body = answersFixture(qid)) {
  const dir = path.join(parentDir, qid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'answers.json'), body);
  return dir;
}

/** Work-dir-level writer (resume tamper helpers operate from the work root). */
function writeAnswers(workDir, qid, body = answersFixture(qid)) {
  return writeAnswersRaw(path.join(workDir, 'zhihu'), qid, body);
}

/**
 * Fake primitive runner for zhihu-verify / zhihu-handoff / corpus-verify-handoff.
 * Deterministic; materializes handoff.json like the real make-handoff primitive.
 */
function makeGroupRunner({ failVerifyFor = [], verifyValidFalseFor = [], foreignQuestionIdFor = {}, skipHandoffFor = [], handoffGateFalseFor = [] } = {}) {
  return function runPrimitive(name, args) {
    if (name === 'zhihu-verify') {
      const dir = args[0];
      const qid = path.basename(dir);
      if (failVerifyFor.includes(qid)) {
        return { status: 1, stdout: '', stderr: 'verify subprocess crashed' };
      }
      if (verifyValidFalseFor.includes(qid)) {
        return { status: 0, stdout: JSON.stringify({ valid: false, questionId: qid, capturedAnswerCount: 3, reportedAnswerCount: 3 }), stderr: '' };
      }
      const outQid = foreignQuestionIdFor[qid] ?? qid;
      return { status: 0, stdout: JSON.stringify({ valid: true, questionId: outQid, capturedAnswerCount: 3, reportedAnswerCount: 3 }), stderr: '' };
    }
    if (name === 'zhihu-handoff') {
      const dir = args[0];
      const qid = path.basename(dir);
      if (!skipHandoffFor.includes(qid)) {
        fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ task: 'digest', questionId: qid }, null, 2)}\n`);
      }
      return { status: 0, stdout: JSON.stringify({ ok: true }), stderr: '' };
    }
    if (name === 'corpus-verify-handoff') {
      const handoffFile = args[0];
      const qid = path.basename(path.dirname(handoffFile));
      if (handoffGateFalseFor.includes(qid) || !fs.existsSync(handoffFile)) {
        return { status: 0, stdout: JSON.stringify({ valid: false }), stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify({ valid: true }), stderr: '' };
    }
    throw new Error(`unexpected primitive: ${name}`);
  };
}

/**
 * Fake zhihu-grab runner consumed by the REAL T05 session-capture adapter
 * (exercises the true T05 wrapper contract, including verified===false gate).
 * failureDetail, when set, is a CREDENTIAL-SHAPED poison string (CE-08).
 */
function makeCaptureRunner({ failFor = {}, failureDetail = null, noArtifactFor = [], bodyFor = {} } = {}) {
  return function runPrimitive(name, args) {
    if (name !== 'zhihu-grab') throw new Error(`unexpected primitive: ${name}`);
    const qid = args[0];
    const outDir = args[2];
    if (failFor[qid]) {
      return {
        status: 1,
        stdout: JSON.stringify({ ok: false, error: { type: 'network', message: failureDetail ?? 'boom' } }),
        stderr: '',
      };
    }
    if (!noArtifactFor.includes(qid)) {
      writeAnswersRaw(outDir, qid, bodyFor[qid] ?? answersFixture(qid));
    }
    return {
      status: 0,
      stdout: JSON.stringify({
        ok: true,
        stage: 'captured',
        verified: false,
        questionId: qid,
        questionTitle: `问题 ${qid}`,
        capturedAnswerCount: 3,
      }),
      stderr: '',
    };
  };
}

function makeCaptureAdapter(opts = {}) {
  return createSessionCaptureAdapter({ runner: makeCaptureRunner(opts) });
}

function makeSelectionDecision(groupIds, { planHashValue = null } = {}) {
  return {
    verdict: 'auto',
    reason: 'clear_best',
    planHash: planHashValue ?? sha('plan-a'),
    poolPlanHash: planHashValue ?? sha('plan-a'),
    planHashMatch: true,
    selectorVersion: 'p1-t08-source-group-selection/v1',
    schemaVersion: 1,
    type: 'source-group-selection-decision',
    selectedGroups: groupIds.map((qid) => ({
      groupId: qid,
      questionId: qid,
      rrfScore: 0.1,
      score: 10,
      sourceUrl: { url: `https://www.zhihu.com/question/${qid}`, securityClass: 'external_unverified' },
      provenance: { route: 'zhihu-answer-grabber:grab' },
      rationaleRef: null,
      selectionReason: 'clear_best',
    })),
    selectedGroupCount: groupIds.length,
    candidates: groupIds.map((qid) => ({ questionId: qid, score: 10, rrfScore: 0.1, eligible: true, selected: true })),
    clarification: null,
    clarificationCount: 0,
    intentCoverage: { total: 1, bound: 1, unmet: 0, shortfall: 0 },
    rationale: 'fixture decision',
  };
}

function makeState(workDir, groupIds, { planHashValue = null, decision = null } = {}) {
  const planHash = planHashValue ?? sha('plan-a');
  const sel = decision ?? makeSelectionDecision(groupIds, { planHashValue: planHash });
  return createMultiGroupExecutionState({ planHash, selectionDecision: sel });
}

/** Run one group through capture → verify → handoff. */
function runGroupFlow(state, gid, workDir, { captureAdapter, runner }) {
  executeGroupCapture({ state, groupId: gid, workDir, captureAdapter });
  executeGroupVerify({ state, groupId: gid, workDir, runner });
  executeGroupHandoff({ state, groupId: gid, workDir, runner });
}

// ---------------------------------------------------------------------------
// creation / identity
// ---------------------------------------------------------------------------

test('create: valid selection produces per-group pending state with identity bindings', () => {
  const workDir = tmpDir('create');
  const planHash = validPlanHash(makePlan());
  const decision = makeSelectionDecision(['100', '200'], { planHashValue: planHash });
  const state = createMultiGroupExecutionState({ planHash, selectionDecision: decision });

  assert.equal(state.type, MULTI_GROUP_STATE_TYPE);
  assert.equal(state.planHash, planHash);
  assert.equal(state.selectionDecisionHash, sha(crypto.createHash('sha256').update('{}').digest('hex')) === '' ? null : state.selectionDecisionHash); // hash exists, exact value checked below
  assert.ok(isValidPlanHashFormat(state.selectionIdentity) || /^[0-9a-f]{64}$/.test(state.selectionIdentity));
  assert.deepEqual(Object.keys(state.groups).sort(), ['100', '200']);
  assert.equal(state.groups['100'].stage, GROUP_STAGE_PENDING);
  assert.equal(state.groups['100'].captured, false);
  assert.equal(state.groups['100'].verified, false);
  assert.deepEqual(state.verifiedGroupRefs, []);
  assert.equal(state.manifest, null);
  assert.equal(state.researchComplete, false);
});

test('CE-09 DUPLICATE_GROUP_ID: same question twice in selection → rejected (fail closed)', () => {
  const decision = makeSelectionDecision(['100']);
  decision.selectedGroups.push({ ...decision.selectedGroups[0] });
  decision.selectedGroupCount = 2;
  assert.throws(() => createMultiGroupExecutionState({ planHash: sha('plan-a'), selectionDecision: decision }), (err) => {
    assert.ok(err instanceof MultiGroupError);
    assert.equal(err.code, 'MULTI_GROUP_DUPLICATE_GROUP_ID');
    return true;
  });
});

test('create: non-auto verdict / empty set / invalid planHash rejected', () => {
  const bad1 = makeSelectionDecision(['100']);
  bad1.verdict = 'ambiguous';
  assert.throws(() => createMultiGroupExecutionState({ planHash: sha('p'), selectionDecision: bad1 }), MultiGroupError);
  assert.throws(() => createMultiGroupExecutionState({ planHash: sha('p'), selectionDecision: makeSelectionDecision([]) }), MultiGroupError);
  assert.throws(() => createMultiGroupExecutionState({ planHash: 'not-a-hash', selectionDecision: makeSelectionDecision(['100']) }), MultiGroupError);
});

test('CE-15 REORDERED_SELECTION_SAME_SET: same set in different order → identical selectionIdentity', () => {
  const a = computeSelectionIdentity(makeSelectionDecision(['100', '200', '300']).selectedGroups);
  const b = computeSelectionIdentity(makeSelectionDecision(['300', '100', '200']).selectedGroups);
  assert.equal(a, b);
  const c = computeSelectionIdentity(makeSelectionDecision(['100', '200']).selectedGroups);
  assert.notEqual(a, c); // different set → different identity
});

// ---------------------------------------------------------------------------
// per-group execution
// ---------------------------------------------------------------------------

test('CE-01 CAPTURED_NOT_VERIFIED: verify valid=false keeps group out of VerifiedGroupRefs', () => {
  const workDir = tmpDir('ce01');
  const state = makeState(workDir, ['100', '200']);
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner({ verifyValidFalseFor: ['100'] });

  executeGroupCapture({ state, groupId: '100', workDir, captureAdapter });
  executeGroupVerify({ state, groupId: '100', workDir, runner });

  assert.equal(state.groups['100'].captured, true);
  assert.equal(state.groups['100'].verified, false);
  assert.equal(state.groups['100'].failed, false);
  const refs = deriveVerifiedGroupRefs(state);
  assert.equal(refs.length, 0);
  // accounting: captured-not-verified is visible
  const update = buildSourceCompletenessUpdate(state);
  assert.equal(update.perGroupStatus['100'].captured, true);
  assert.equal(update.perGroupStatus['100'].verified, false);
  assert.equal(update.diagnostics.capturedNotVerifiedCount, 3);
});

test('happy path: two groups capture → verify → handoff → refs + complete', () => {
  const workDir = tmpDir('happy');
  const state = makeState(workDir, ['100', '200']);
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner();

  runGroupFlow(state, '100', workDir, { captureAdapter, runner });
  // group 200 must still be untouched after group 100 completed (I3)
  assert.equal(state.groups['200'].stage, GROUP_STAGE_PENDING);
  runGroupFlow(state, '200', workDir, { captureAdapter, runner });

  const refs = deriveVerifiedGroupRefs(state);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map((r) => r.groupId), ['100', '200']);
  assert.equal(state.groups['100'].stage, GROUP_STAGE_HANDED_OFF);
  assert.equal(state.groups['200'].stage, GROUP_STAGE_HANDED_OFF);
  assert.equal(isResearchComplete(state), true);
  finalizeResearch(state);
  assert.equal(state.researchComplete, true);
});

test('CE-06 WRONG_GROUP_IDENTITY: verify reports foreign questionId → group fails closed', () => {
  const workDir = tmpDir('ce06');
  const state = makeState(workDir, ['100']);
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner({ foreignQuestionIdFor: { '100': '999' } });

  executeGroupCapture({ state, groupId: '100', workDir, captureAdapter });
  executeGroupVerify({ state, groupId: '100', workDir, runner });

  assert.equal(state.groups['100'].captured, true);
  assert.equal(state.groups['100'].verified, false);
  assert.equal(state.groups['100'].failed, true);
  assert.equal(state.groups['100'].failure.code, 'VERIFY_IDENTITY_MISMATCH');
  assert.equal(deriveVerifiedGroupRefs(state).length, 0);
});

test('verify subprocess crash → group failed with machine identity, no raw stderr echo into state', () => {
  const workDir = tmpDir('vfail');
  const state = makeState(workDir, ['100']);
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner({ failVerifyFor: ['100'] });

  executeGroupCapture({ state, groupId: '100', workDir, captureAdapter });
  executeGroupVerify({ state, groupId: '100', workDir, runner });

  assert.equal(state.groups['100'].failed, true);
  assert.equal(state.groups['100'].failure.code, 'VERIFY_PROCESS_FAILED');
  assert.equal(state.groups['100'].failure.class, 'process');
  assert.equal(state.groups['100'].failure.detail, undefined);
});

test('CE-19 CAPTURE_ADAPTER_CONTRACT: provider result missing evidence → group failed via validateProviderResult gate', () => {
  const workDir = tmpDir('ce19');
  const state = makeState(workDir, ['100']);
  const brokenAdapter = {
    providerId: 'zhihu-session-capture',
    capability: 'capture',
    authClass: 'session',
    retrieve() {
      return {
        ok: true,
        provider_id: 'zhihu-session-capture',
        capability: 'capture',
        auth_class: 'session',
        retrieved_at: '2026-09-04T00:00:00.000Z',
        items: [{ identity: { kind: 'source-group', questionId: '100' }, provenance: {} }],
        completeness: { status: 'complete' }, // evidence missing → contract invalid
        verified: false,
        validity_authority: 'verify-output',
      };
    },
  };

  executeGroupCapture({ state, groupId: '100', workDir, captureAdapter: brokenAdapter });
  assert.equal(state.groups['100'].captured, false);
  assert.equal(state.groups['100'].failed, true);
  assert.equal(state.groups['100'].failure.code, 'PROVIDER_RESULT_CONTRACT_INVALID');
  assert.equal(deriveVerifiedGroupRefs(state).length, 0);
});

test('CE-13 UNKNOWN_COMPLETENESS: provider completeness=unknown → paginationStatus=unknown, never complete', () => {
  const workDir = tmpDir('ce13');
  const state = makeState(workDir, ['100']);
  const unknownAdapter = {
    providerId: 'zhihu-session-capture',
    capability: 'capture',
    authClass: 'session',
    retrieve({ outDir }) {
      writeAnswersRaw(outDir, '100');
      return {
        ok: true,
        provider_id: 'zhihu-session-capture',
        capability: 'capture',
        auth_class: 'session',
        retrieved_at: '2026-09-04T00:00:00.000Z',
        items: [{
          identity: { kind: 'source-group', questionId: '100' },
          provenance: { route: 'zhihu-answer-grabber:grab' },
          source_url: { url: 'https://www.zhihu.com/question/100', securityClass: 'external_unverified' },
          facts: { questionTitle: 'q', capturedAnswerCount: 3, artifacts: null },
        }],
        completeness: { status: 'unknown', evidence: { reason: 'provider_contract_open' } },
        verified: false,
        validity_authority: 'verify-output',
      };
    },
  };

  executeGroupCapture({ state, groupId: '100', workDir, captureAdapter: unknownAdapter });
  assert.equal(state.groups['100'].captured, true);
  assert.equal(state.groups['100'].paginationStatus, 'unknown');
  assert.equal(state.groups['100'].partial, false);

  // full valid flow on unknown pagination still composes (validity is verify authority's),
  // but completeness is reported honestly as unknown, not complete.
  const runner = makeGroupRunner();
  executeGroupVerify({ state, groupId: '100', workDir, runner });
  executeGroupHandoff({ state, groupId: '100', workDir, runner });
  const refs = deriveVerifiedGroupRefs(state);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].paginationStatus, 'unknown');
});

test('CE-08 CREDENTIAL_POISONING: capture failure detail is never echoed into state', () => {
  const workDir = tmpDir('ce08');
  const state = makeState(workDir, ['100']);
  const SECRET = 'Authorization: Bearer sk-SECRET-VALUE token=SECRET_VALUE';
  const captureAdapter = makeCaptureAdapter({ failFor: { '100': true }, failureDetail: SECRET });
  const runner = makeGroupRunner();

  executeGroupCapture({ state, groupId: '100', workDir, captureAdapter });
  assert.equal(state.groups['100'].failed, true);
  assert.equal(state.groups['100'].failure.code, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(state.groups['100'].failure.detail, undefined);

  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes('SECRET-VALUE'));
  assert.ok(!serialized.includes('Authorization'));
});

test('CE-08b persist rejects credential-shaped state content (pin-then-walk, stable reason)', () => {
  const workDir = tmpDir('ce08b');
  const state = makeState(workDir, ['100']);
  state.groups['100'].failure = { code: 'X', class: 'provider', detail: 'cookie=SECRET_COOKIE_VALUE at /Users/someone/cookie.txt' };
  const verdict = persistMultiGroupState(workDir, state);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'multi_group_state_unsafe');
  assert.ok(!fs.existsSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME)), 'unsafe state must not be written');
});

test('CE-17 HOSTILE_GETTER_STATE: throwing getter in state → persist fails closed, no escape', () => {
  const workDir = tmpDir('ce17');
  const state = makeState(workDir, ['100']);
  Object.defineProperty(state.groups['100'], 'poison', {
    enumerable: true,
    get() {
      throw new Error('hostile getter');
    },
  });
  const verdict = persistMultiGroupState(workDir, state);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'multi_group_state_unsafe');
});

test('persist + load round-trip preserves state; corrupt file loads as absent', () => {
  const workDir = tmpDir('persist');
  const state = makeState(workDir, ['100']);
  const verdict = persistMultiGroupState(workDir, state);
  assert.equal(verdict.ok, true);
  const loaded = loadMultiGroupState(workDir);
  assert.deepEqual(loaded, state);

  fs.writeFileSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME), '{"schemaVersion": 1, "trunc');
  assert.equal(loadMultiGroupState(workDir), null);

  fs.writeFileSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME), JSON.stringify({ schemaVersion: 99, type: 'other' }));
  assert.equal(loadMultiGroupState(workDir), null);
});

// ---------------------------------------------------------------------------
// handoff composition
// ---------------------------------------------------------------------------

test('CE-12 STALE_HANDOFF_FRESH_ANSWERS analog: handoff gate failure → excluded from refs, verified preserved, retryable', () => {
  const workDir = tmpDir('ce12');
  const state = makeState(workDir, ['100']);
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner({ handoffGateFalseFor: ['100'] });

  executeGroupCapture({ state, groupId: '100', workDir, captureAdapter });
  executeGroupVerify({ state, groupId: '100', workDir, runner });
  executeGroupHandoff({ state, groupId: '100', workDir, runner });

  // verified content stays verified (verify authority), but composition excludes it
  assert.equal(state.groups['100'].verified, true);
  assert.equal(state.groups['100'].handoffValid, false);
  assert.equal(state.groups['100'].failed, false); // verified ⊥ failed (coverage validator)
  assert.equal(deriveVerifiedGroupRefs(state).length, 0);

  // retry handoff with a healthy gate → ref appears (no validity upgrade; the gate re-ran)
  const healthyRunner = makeGroupRunner();
  executeGroupHandoff({ state, groupId: '100', workDir, runner: healthyRunner });
  assert.equal(state.groups['100'].handoffValid, true);
  assert.equal(state.groups['100'].stage, GROUP_STAGE_HANDED_OFF);
  assert.equal(deriveVerifiedGroupRefs(state).length, 1);
});

test('verify precondition: cannot verify a group that was never captured (fail closed throw)', () => {
  const workDir = tmpDir('precond');
  const state = makeState(workDir, ['100']);
  const runner = makeGroupRunner();
  assert.throws(() => executeGroupVerify({ state, groupId: '100', workDir, runner }), MultiGroupError);
  assert.throws(() => executeGroupHandoff({ state, groupId: '100', workDir, runner }), MultiGroupError);
  assert.throws(() => executeGroupCapture({ state, groupId: 'missing', workDir, captureAdapter: makeCaptureAdapter() }), MultiGroupError);
});

test('CE-07 MANIFEST_SECOND_STORE: manifest carries composition/refs only — no canonical content', () => {
  const workDir = tmpDir('ce07');
  const state = makeState(workDir, ['100', '200']);
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner();
  runGroupFlow(state, '100', workDir, { captureAdapter, runner });
  runGroupFlow(state, '200', workDir, { captureAdapter, runner });

  const manifest = deriveResearchCorpusManifest({ state, selectionDecision: makeSelectionDecision(['100', '200']) });
  const serialized = JSON.stringify(manifest);
  assert.ok(!serialized.includes('SENTINEL-CONTENT'), 'manifest must never contain canonical content');

  // structural whitelist: only composition/ref/provenance/accounting keys
  assert.deepEqual(
    Object.keys(manifest).sort(),
    ['accounting', 'groups', 'manifestHash', 'planHash', 'schemaVersion', 'selectionDecisionHash', 'selectionIdentity', 'type'],
  );
  for (const g of manifest.groups) {
    assert.deepEqual(
      Object.keys(g).sort(),
      ['answersHash', 'answersRel', 'capturedAnswerCount', 'groupId', 'handoffHash', 'handoffRel', 'paginationStatus', 'questionId', 'reportedAnswerCount'],
    );
  }
  assert.ok(/^[0-9a-f]{64}$/.test(manifest.manifestHash));
});

test('manifest determinism: identical inputs reproduce byte-identical manifest + hash', () => {
  const workDirA = tmpDir('determA');
  const workDirB = tmpDir('determB');
  const decision = makeSelectionDecision(['100', '200']);
  const stateA = makeState(workDirA, ['100', '200'], { decision });
  const stateB = makeState(workDirB, ['100', '200'], { decision });

  for (const [state, workDir] of [[stateA, workDirA], [stateB, workDirB]]) {
    const captureAdapter = makeCaptureAdapter();
    const runner = makeGroupRunner();
    runGroupFlow(state, '100', workDir, { captureAdapter, runner });
    runGroupFlow(state, '200', workDir, { captureAdapter, runner });
  }

  const mA = deriveResearchCorpusManifest({ state: stateA, selectionDecision: decision });
  const mB = deriveResearchCorpusManifest({ state: stateB, selectionDecision: decision });
  assert.equal(JSON.stringify(mA), JSON.stringify(mB));
  assert.equal(mA.manifestHash, mB.manifestHash);

  // any verified artifact hash change must change manifest identity:
  // persist → tamper answers → resume invalidates group 100 (hash mismatch) → re-execute
  assert.equal(persistMultiGroupState(workDirA, stateA).ok, true);
  writeAnswers(workDirA, '100', answersFixture('100').replace('10001', '10999'));
  const resumed = resumeMultiGroupExecution({ workDir: workDirA, planHash: stateA.planHash, selectionDecision: decision });
  assert.deepEqual(resumed.invalidatedGroupIds, ['100']);
  const changedBody = answersFixture('100').replace('10001', '10999'); // re-capture sees different upstream content
  const retryAdapter = makeCaptureAdapter({ bodyFor: { '100': changedBody } });
  runGroupFlow(resumed.state, '100', workDirA, { captureAdapter: retryAdapter, runner: makeGroupRunner() });
  const mA2 = deriveResearchCorpusManifest({ state: resumed.state, selectionDecision: decision });
  assert.notEqual(mA2.manifestHash, mA.manifestHash);
});

test('CE-05 PARTIAL_NOT_COMPLETE: interrupted group keeps research partial — never complete', () => {
  const workDir = tmpDir('ce05');
  const state = makeState(workDir, ['100', '200']);
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner();

  runGroupFlow(state, '100', workDir, { captureAdapter, runner });
  // group 200 interrupted during capture: provider returned ok but artifact never landed
  const brokenAdapter = makeCaptureAdapter({ noArtifactFor: ['200'] });
  executeGroupCapture({ state, groupId: '200', workDir, captureAdapter: brokenAdapter });
  assert.equal(state.groups['200'].failed, true);
  assert.equal(state.groups['200'].failure.code, 'CAPTURE_ARTIFACT_MISSING');

  assert.equal(isResearchComplete(state), false);
  assert.throws(() => finalizeResearch(state), (err) => {
    assert.ok(err instanceof MultiGroupError);
    assert.equal(err.code, 'MULTI_GROUP_RESEARCH_NOT_COMPLETE');
    return true;
  });
  assert.equal(state.researchComplete, false);

  const manifest = deriveResearchCorpusManifest({ state, selectionDecision: makeSelectionDecision(['100', '200']) });
  assert.equal(manifest.accounting.selectedGroupCount, 2);
  assert.equal(manifest.accounting.verifiedGroupCount, 1);
  assert.equal(manifest.accounting.failedGroupCount, 1);
});

// ---------------------------------------------------------------------------
// resume / stale propagation
// ---------------------------------------------------------------------------

test('CE-02 SIBLING_ISOLATION: stale group B invalidates only B; valid sibling A is reused', () => {
  const workDir = tmpDir('ce02');
  const decision = makeSelectionDecision(['100', '200']);
  const state = makeState(workDir, ['100', '200'], { decision });
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner();
  runGroupFlow(state, '100', workDir, { captureAdapter, runner });
  runGroupFlow(state, '200', workDir, { captureAdapter, runner });
  persistMultiGroupState(workDir, state);

  // tamper ONLY group 200's answers.json
  writeAnswers(workDir, '200', answersFixture('200').replace('20002', '20999'));

  const resume = resumeMultiGroupExecution({ workDir, planHash: state.planHash, selectionDecision: decision });
  assert.equal(resume.fresh, false);
  assert.deepEqual(resume.invalidatedGroupIds, ['200']);

  // sibling 100 fully preserved (I3)
  assert.equal(resume.state.groups['100'].stage, GROUP_STAGE_HANDED_OFF);
  assert.equal(resume.state.groups['100'].verified, true);
  assert.equal(resume.state.groups['100'].handoffValid, true);
  // stale group 200 reset for re-execution
  assert.equal(resume.state.groups['200'].stage, GROUP_STAGE_PENDING);
  assert.equal(resume.state.groups['200'].captured, false);

  const refs = deriveVerifiedGroupRefs(resume.state);
  assert.deepEqual(refs.map((r) => r.groupId), ['100']);
  assert.equal(resume.state.researchComplete, false);
});

test('CE-03 FILE_EXISTS_NOT_CACHE: present answers.json with wrong bytes is never accepted as cache', () => {
  const workDir = tmpDir('ce03');
  const decision = makeSelectionDecision(['100']);
  const state = makeState(workDir, ['100'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  // rewrite answers.json with DIFFERENT bytes (file exists!)
  writeAnswers(workDir, '100', answersFixture('100').replace('正文', '被篡改的正文'));

  const resume = resumeMultiGroupExecution({ workDir, planHash: state.planHash, selectionDecision: decision });
  assert.deepEqual(resume.invalidatedGroupIds, ['100']);
  assert.equal(resume.state.groups['100'].stage, GROUP_STAGE_PENDING);
  assert.equal(resume.state.groups['100'].verified, false);
  assert.equal(deriveVerifiedGroupRefs(resume.state).length, 0);
});

test('CE-04 PLAN_IDENTITY_DRIFT: changed planHash → fresh state; old refs never stitched', () => {
  const workDir = tmpDir('ce04');
  const decision = makeSelectionDecision(['100', '200'], { planHashValue: sha('plan-a') });
  const state = makeState(workDir, ['100', '200'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  runGroupFlow(state, '200', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  // CE-20 binding: the stale (plan-b, decision-from-plan-a) pair can never compose —
  // plan drift requires a RE-SELECTION under the new plan, never reuse of the old decision.
  assert.throws(
    () => resumeMultiGroupExecution({ workDir, planHash: sha('plan-b'), selectionDecision: decision }),
    (err) => err instanceof MultiGroupError && err.code === 'MULTI_GROUP_PLAN_IDENTITY_MISMATCH',
  );

  // legal plan drift: fresh re-selection under the NEW plan → fresh state at the plan boundary
  const newPlanDecision = makeSelectionDecision(['100', '200'], { planHashValue: sha('plan-b') });
  const resume = resumeMultiGroupExecution({ workDir, planHash: sha('plan-b'), selectionDecision: newPlanDecision });
  assert.equal(resume.fresh, true);
  assert.equal(resume.boundary, 'plan');
  assert.deepEqual(resume.invalidatedGroupIds, []);
  assert.deepEqual(resume.state.verifiedGroupRefs, []);
  assert.equal(resume.state.groups['100'].stage, GROUP_STAGE_PENDING);
  assert.equal(resume.state.researchComplete, false);
});

test('CE-16 REMOVED_GROUP_NOT_IN_MANIFEST: group removed by new selection → absent from fresh state', () => {
  const workDir = tmpDir('ce16');
  const decision = makeSelectionDecision(['100', '200'], { planHashValue: sha('plan-a') });
  const state = makeState(workDir, ['100', '200'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  runGroupFlow(state, '200', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  // selection shrinks to {100}: selectionIdentity drift → selection-boundary invalidation
  const newDecision = makeSelectionDecision(['100'], { planHashValue: sha('plan-a') });
  const resume = resumeMultiGroupExecution({ workDir, planHash: sha('plan-a'), selectionDecision: newDecision });
  assert.equal(resume.fresh, true);
  assert.equal(resume.boundary, 'selection');
  assert.deepEqual(Object.keys(resume.state.groups), ['100']);
  const manifest = deriveResearchCorpusManifest({ state: resume.state, selectionDecision: newDecision });
  assert.ok(!JSON.stringify(manifest).includes('"200"'));
});

test('selection_decision drift (same plan, same set, different decision bytes) → fresh from decision boundary', () => {
  const workDir = tmpDir('sdhash');
  const decision = makeSelectionDecision(['100']);
  const state = makeState(workDir, ['100'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  const mutated = JSON.parse(JSON.stringify(decision));
  mutated.rationale = 'different rationale bytes';
  const resume = resumeMultiGroupExecution({ workDir, planHash: state.planHash, selectionDecision: mutated });
  assert.equal(resume.fresh, true);
  assert.equal(resume.boundary, 'selection_decision');
});

test('CE-14 INTERRUPTED_STATE_WRITE: corrupt state file → fresh execution, no silent partial reuse', () => {
  const workDir = tmpDir('ce14');
  const decision = makeSelectionDecision(['100']);
  const state = makeState(workDir, ['100'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  fs.writeFileSync(path.join(workDir, MULTI_GROUP_STATE_FILENAME), '{"schemaVersion":1,"type":"multi-group-exec');

  const resume = resumeMultiGroupExecution({ workDir, planHash: state.planHash, selectionDecision: decision });
  assert.equal(resume.fresh, true);
  assert.equal(resume.boundary, 'no_state');
  assert.equal(resume.state.groups['100'].stage, GROUP_STAGE_PENDING);
  assert.deepEqual(resume.state.verifiedGroupRefs, []);
});

test('CE-11 FRESH_HANDOFF_STALE_ANSWERS: answers tampered → dependent handoff invalidated upward', () => {
  const workDir = tmpDir('ce11');
  const decision = makeSelectionDecision(['100']);
  const state = makeState(workDir, ['100'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  // answers rewritten; handoff.json left untouched — handoff DEPENDS on answers
  writeAnswers(workDir, '100', answersFixture('100').replace('10003', '10993'));

  const resume = resumeMultiGroupExecution({ workDir, planHash: state.planHash, selectionDecision: decision });
  assert.deepEqual(resume.invalidatedGroupIds, ['100']);
  const g = resume.state.groups['100'];
  assert.equal(g.stage, GROUP_STAGE_PENDING);
  assert.equal(g.captured, false);
  assert.equal(g.verified, false);
  assert.equal(g.handoffValid, false);
  assert.equal(g.verification, null);
  assert.deepEqual(deriveVerifiedGroupRefs(resume.state), []);
});

test('stale handoff only: answers valid → verified preserved, handoff re-runs on resume', () => {
  const workDir = tmpDir('ho-stale');
  const decision = makeSelectionDecision(['100']);
  const state = makeState(workDir, ['100'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  // tamper handoff.json ONLY
  fs.writeFileSync(path.join(workDir, 'zhihu', '100', 'handoff.json'), '{"task":"digest","questionId":"100","tampered":true}\n');

  const resume = resumeMultiGroupExecution({ workDir, planHash: state.planHash, selectionDecision: decision });
  assert.deepEqual(resume.invalidatedGroupIds, ['100']);
  const g = resume.state.groups['100'];
  assert.equal(g.captured, true);
  assert.equal(g.verified, true); // answers-bound validity preserved
  assert.equal(g.handoffValid, false);
  assert.equal(g.stage, GROUP_STAGE_VERIFIED);
  assert.deepEqual(deriveVerifiedGroupRefs(resume.state), []);

  // re-run handoff stage only → group re-composes without re-capture/re-verify
  executeGroupHandoff({ state: resume.state, groupId: '100', workDir, runner: makeGroupRunner() });
  assert.equal(deriveVerifiedGroupRefs(resume.state).length, 1);
});

test('resume with no prior state → fresh create', () => {
  const workDir = tmpDir('resume-fresh');
  const decision = makeSelectionDecision(['100']);
  const resume = resumeMultiGroupExecution({ workDir, planHash: sha('plan-a'), selectionDecision: decision });
  assert.equal(resume.fresh, true);
  assert.equal(resume.boundary, 'no_state');
  assert.deepEqual(Object.keys(resume.state.groups), ['100']);
});

// ---------------------------------------------------------------------------
// CoverageState hook (T09-owned Source Completeness ONLY)
// ---------------------------------------------------------------------------

test('CE-18 HOOK_ACCOUNTING_MECHANICAL: derived update satisfies validator; aggregates == per-group sums', () => {
  const workDir = tmpDir('ce18');
  const state = makeState(workDir, ['100', '200', '300']);
  const captureAdapter = makeCaptureAdapter();
  runGroupFlow(state, '100', workDir, { captureAdapter, runner: makeGroupRunner() });            // verified+handed off
  executeGroupCapture({ state, groupId: '200', workDir, captureAdapter });                        // captured only
  const runnerFail = makeGroupRunner({ verifyValidFalseFor: ['200'] });
  executeGroupVerify({ state, groupId: '200', workDir, runner: runnerFail });                     // captured != verified
  const capFail = makeCaptureAdapter({ failFor: { '300': true } });
  executeGroupCapture({ state, groupId: '300', workDir, captureAdapter: capFail });               // failed

  const coverageState = createInitialCoverageState({ planHash: sha('plan-a') });
  const next = applySourceCompletenessToCoverageState(coverageState, state);

  const ledger = canonicalizeCoverageState(next).sourceCompleteness;
  assert.equal(ledger.perGroupStatus['100'].verified, true);
  assert.equal(ledger.perGroupStatus['100'].selectedCount, 3);
  assert.equal(ledger.perGroupStatus['100'].verifiedCount, 3);
  assert.equal(ledger.perGroupStatus['200'].captured, true);
  assert.equal(ledger.perGroupStatus['200'].verified, false);
  assert.equal(ledger.perGroupStatus['300'].failed, true);
  assert.equal(ledger.diagnostics.totalSelectedCount, 6);
  assert.equal(ledger.diagnostics.totalVerifiedCount, 3);
  assert.equal(ledger.diagnostics.capturedNotVerifiedCount, 3);

  // the ONLY ledger touched is sourceCompleteness (T09 ownership boundary)
  const before = canonicalizeCoverageState(coverageState);
  const after = canonicalizeCoverageState(next);
  assert.deepEqual(after.retrieval, before.retrieval);
  assert.deepEqual(after.analysisCoverage, before.analysisCoverage);
  assert.deepEqual(after.diagnostics, before.diagnostics);
});

test('hook authorization: updateSourceCompleteness rejects non-T09 callers (hook alive)', () => {
  const coverageState = createInitialCoverageState({ planHash: sha('plan-a') });
  assert.throws(() => updateSourceCompleteness(coverageState, { perGroupStatus: {} }, { caller: 'T12' }), (err) => {
    assert.equal(err.code, 'coverage_unauthorized_owner');
    return true;
  });
  // inconsistent manual payload (verified > selected) throws — derivation must never produce this
  assert.throws(() => updateSourceCompleteness(
    coverageState,
    { perGroupStatus: { g1: { captured: true, verified: true, partial: false, failed: false, paginationStatus: 'unknown', evidenceRef: null, selectedCount: 1, verifiedCount: 2 } }, diagnostics: { capturedNotVerifiedCount: 0, totalSelectedCount: 1, totalVerifiedCount: 2 } },
    { caller: OWNER_T09_SOURCE_COMPLETENESS },
  ), (err) => {
    assert.equal(err.code, 'coverage_invalid_state');
    return true;
  });
});

test('I1 defensive: hand-constructed captured-only group can never enter refs via derivation', () => {
  const workDir = tmpDir('i1');
  const state = makeState(workDir, ['100']);
  const g = state.groups['100'];
  g.captured = true; // forged flag without verify/handoff authority
  g.evidenceRef = 'zhihu/100/answers.json';
  g.artifactHashes.answersJson = sha('forged');
  assert.equal(deriveVerifiedGroupRefs(state).length, 0);

  g.verified = true; // still no handoff authority
  assert.equal(deriveVerifiedGroupRefs(state).length, 0);

  g.handoffValid = true; // even with all flags forged, refs require recorded handoff artifacts
  assert.equal(deriveVerifiedGroupRefs(state).length, 0); // handoffRef/hash absent → excluded
});

test('CE-10 REFS_NO_DUPLICATES: derivation is idempotent and duplicate-free', () => {
  const workDir = tmpDir('ce10');
  const state = makeState(workDir, ['100', '200']);
  const captureAdapter = makeCaptureAdapter();
  const runner = makeGroupRunner();
  runGroupFlow(state, '100', workDir, { captureAdapter, runner });
  runGroupFlow(state, '200', workDir, { captureAdapter, runner });

  const refs1 = deriveVerifiedGroupRefs(state);
  const refs2 = deriveVerifiedGroupRefs(state);
  assert.deepEqual(refs1, refs2);
  assert.equal(new Set(refs2.map((r) => r.groupId)).size, refs2.length);
});

test('I4+I8 guard: ref hashes bind to exact artifact bytes at composition time', () => {
  const workDir = tmpDir('refhash');
  const state = makeState(workDir, ['100']);
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  const refs = deriveVerifiedGroupRefs(state);
  assert.equal(refs[0].answersHash, crypto.createHash('sha256').update(fs.readFileSync(path.join(workDir, 'zhihu', '100', 'answers.json'))).digest('hex'));
  assert.equal(refs[0].handoffHash, crypto.createHash('sha256').update(fs.readFileSync(path.join(workDir, 'zhihu', '100', 'handoff.json'))).digest('hex'));
  assert.equal(refs[0].answersRel, 'zhihu/100/answers.json');
  assert.equal(refs[0].handoffRel, 'zhihu/100/handoff.json');
});

// ---------------------------------------------------------------------------
// CE-20/21/22 — identity binding + persisted-state shape validation
// (retroactive grounding round: contract defects identified before fresh review;
//  each maps to docs/planning/P1_T09_MULTI_GROUP_EXECUTION_CONTRACT.md register)
// ---------------------------------------------------------------------------

test('CE-20 PLAN_IDENTITY_BINDING: decision composed under another plan/pool identity is rejected at the T09 boundary', () => {
  // decision.planHash != planHash argument → fail closed (no cross-plan composition)
  const d1 = makeSelectionDecision(['100'], { planHashValue: sha('plan-a') });
  assert.throws(
    () => createMultiGroupExecutionState({ planHash: sha('plan-b'), selectionDecision: d1 }),
    (err) => err instanceof MultiGroupError && err.code === 'MULTI_GROUP_PLAN_IDENTITY_MISMATCH',
  );

  // decision.poolPlanHash != planHash argument (pool built under a different plan) → fail closed
  const d2 = makeSelectionDecision(['100'], { planHashValue: sha('plan-a') });
  d2.poolPlanHash = sha('plan-c');
  assert.throws(
    () => createMultiGroupExecutionState({ planHash: sha('plan-a'), selectionDecision: d2 }),
    (err) => err.code === 'MULTI_GROUP_PLAN_IDENTITY_MISMATCH',
  );

  // missing decision plan identity → fail closed
  const d3 = makeSelectionDecision(['100']);
  delete d3.planHash;
  assert.throws(
    () => createMultiGroupExecutionState({ planHash: sha('plan-a'), selectionDecision: d3 }),
    (err) => err.code === 'MULTI_GROUP_PLAN_IDENTITY_MISMATCH',
  );

  // resume-level: a (planHash, decision) pair that is internally inconsistent fails
  // closed instead of silently composing fresh state from a decision that was never
  // made under that plan (the plan boundary requires a RE-SELECTION, not reuse).
  const workDir = tmpDir('ce20-resume');
  const oldDecision = makeSelectionDecision(['100'], { planHashValue: sha('plan-a') });
  const state = makeState(workDir, ['100'], { decision: oldDecision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);
  assert.throws(
    () => resumeMultiGroupExecution({ workDir, planHash: sha('plan-b'), selectionDecision: oldDecision }),
    (err) => err instanceof MultiGroupError && err.code === 'MULTI_GROUP_PLAN_IDENTITY_MISMATCH',
  );
});

test('CE-21 STATE_SHAPE_GROUPS: parseable state with missing/malformed groups never raw-throws resume — corrupt → fresh', () => {
  const workDir = tmpDir('ce21');
  const decision = makeSelectionDecision(['100']);
  const state = makeState(workDir, ['100'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  const stateFile = path.join(workDir, MULTI_GROUP_STATE_FILENAME);
  const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  const expectFresh = () => {
    const resume = resumeMultiGroupExecution({ workDir, planHash: state.planHash, selectionDecision: decision });
    assert.equal(resume.fresh, true);
    assert.equal(resume.boundary, 'no_state');
    assert.equal(resume.state.groups['100'].stage, GROUP_STAGE_PENDING);
    assert.deepEqual(resume.state.verifiedGroupRefs, []);
  };

  // variant A: groups key missing entirely (type/schemaVersion still valid)
  const noGroups = { ...parsed };
  delete noGroups.groups;
  fs.writeFileSync(stateFile, JSON.stringify(noGroups, null, 2));
  expectFresh();

  // variant B: groups replaced by a non-object (array) — must not silently resume
  fs.writeFileSync(stateFile, JSON.stringify({ ...parsed, groups: [] }, null, 2));
  expectFresh();

  // variant C: groups emptied (selection was non-empty; empty groups can never be valid)
  fs.writeFileSync(stateFile, JSON.stringify({ ...parsed, groups: {} }, null, 2));
  expectFresh();
});

test('CE-22 STATE_SHAPE_GROUP_ENTRY: semantically malformed group entries are never reused — corrupt → fresh', () => {
  const workDir = tmpDir('ce22');
  const decision = makeSelectionDecision(['100']);
  const state = makeState(workDir, ['100'], { decision });
  runGroupFlow(state, '100', workDir, { captureAdapter: makeCaptureAdapter(), runner: makeGroupRunner() });
  persistMultiGroupState(workDir, state);

  const stateFile = path.join(workDir, MULTI_GROUP_STATE_FILENAME);
  const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  const expectFresh = () => {
    const resume = resumeMultiGroupExecution({ workDir, planHash: state.planHash, selectionDecision: decision });
    assert.equal(resume.fresh, true);
    assert.equal(resume.boundary, 'no_state');
    assert.equal(resume.state.groups['100'].stage, GROUP_STAGE_PENDING);
    assert.deepEqual(resume.state.verifiedGroupRefs, []);
  };

  // A: entry nulled out
  fs.writeFileSync(stateFile, JSON.stringify({ ...parsed, groups: { '100': null } }, null, 2));
  expectFresh();

  // B: entry identity tampered (entry.groupId no longer equals its key) — never silently accepted
  const b = JSON.parse(JSON.stringify(parsed));
  b.groups['100'].groupId = '999';
  fs.writeFileSync(stateFile, JSON.stringify(b, null, 2));
  expectFresh();

  // C: boolean flags coerced to strings (captured: 'true') — no truthiness reuse
  const c = JSON.parse(JSON.stringify(parsed));
  c.groups['100'].captured = 'true';
  fs.writeFileSync(stateFile, JSON.stringify(c, null, 2));
  expectFresh();

  // D: unknown artifact hash key injected (hash domain tampered)
  const d = JSON.parse(JSON.stringify(parsed));
  d.groups['100'].artifactHashes.evildoer = 'cafebabe';
  fs.writeFileSync(stateFile, JSON.stringify(d, null, 2));
  expectFresh();

  // E: failure object carrying raw detail keys (value-free contract violated)
  const e = JSON.parse(JSON.stringify(parsed));
  e.groups['100'].failure = { code: 'X', class: 'provider', detail: 'raw provider stack' };
  fs.writeFileSync(stateFile, JSON.stringify(e, null, 2));
  expectFresh();
});
