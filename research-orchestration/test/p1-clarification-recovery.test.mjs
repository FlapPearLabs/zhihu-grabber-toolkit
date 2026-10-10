import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeP1Research, getStagingPath } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam } from '../lib/provider-seam.mjs';
import { readState, writeState } from '../lib/state.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCanonicalGate, parseRunnerArgs } from '../bin/canonical-runner.mjs';
import { loadRuntimeAuthority } from '../bin/runtime-authority.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';

const PLAN = { schemaVersion: 1, queryVariants: ['家庭远程访问'], aspects: ['可达性'], entities: [],
  opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [{ intent: '实际使用限制', constraints: [], groupKey: null }] };
function fixture(t, ids = ['100', '200']) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-clarification-'));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const calls = { search: 0, capture: 0, verify: 0, analyze: 0, synthesize: 0 };
  const adapter = providerId => ({ providerId, capability: 'search', authClass: 'official-secret', retrieve() {
    calls.search++;
    return { ok: true, provider_id: providerId, capability: 'search', auth_class: 'official-secret',
      retrieved_at: '2026-10-10T00:00:00.000Z',
      items: ids.map((id, index) => ({ identity: { kind: 'candidate', questionId: id },
        provenance: { route: 'offline-test', rank: index + 1, rankOrigin: 'fixture_order' }, facts: {}, source_url: null })),
      completeness: { status: 'unknown', evidence: { signal: 'absent' } } };
  } });
  const captureAdapter = { providerId: 'zhihu-session-capture', capability: 'capture', authClass: 'session',
    retrieve({ questionId, outDir }) {
      calls.capture++;
      const d = path.join(outDir, questionId); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'answers.json'), JSON.stringify({ questionId, questionTitle: '家庭远程访问',
        answers: [{ id: 'answer-' + questionId, content: '远程访问需要可达地址并正确配置防火墙。',
          excerpt: '需要正确配置', author: '离线测试作者', voteupCount: 1 }] }));
      return { ok: true, provider_id: 'zhihu-session-capture', capability: 'capture', auth_class: 'session',
        retrieved_at: '2026-10-10T00:00:00.000Z',
        items: [{ identity: { kind: 'group', questionId }, provenance: { route: 'offline-test', rank: 1, rankOrigin: 'fixture' }, facts: { capturedAnswerCount: 1 } }],
        completeness: { status: 'complete', evidence: { basis: 'offline-test' } } };
    } };
  const runner = (name, args) => {
    if (name === 'zhihu-verify') { calls.verify++; return { status: 0, stdout: JSON.stringify({ valid: true,
      questionId: path.basename(args[0]), capturedAnswerCount: 1, reportedAnswerCount: 1 }) }; }
    if (name === 'zhihu-handoff') {
      fs.writeFileSync(path.join(args[0], 'handoff.json'), JSON.stringify({ questionId: path.basename(args[0]),
        task: 'digest', sourceType: 'session-capture', generatedBy: 'offline-test' })); return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') return { status: 0, stdout: JSON.stringify({ valid: true }) };
    throw new Error('unexpected offline primitive');
  };
  const runtime = { runtimeId: 'deepseek-api-tool-less', model: 'deepseek-v4-pro',
    async analyze({ projection }) { calls.analyze++;
      const tokenRef = [...projection.matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)][0][1];
      return { main: [{ tokenRef, statement: '远程访问需要正确配置。' }], minority: [], contradictory: [], expertEvidenceRichTokens: [] }; },
    async synthesize({ claims }) { calls.synthesize++; return { families: claims.map(c => ({ aspect: '访问条件',
      anchorClaimId: c.claimId, members: [{ claimId: c.claimId, stance: 'ASSERTS' }] })), unresolvedClaimIds: [] }; } };
  const common = { topic: '家庭 IPv6 远程访问有哪些限制？', workDir,
    seam: createProviderSeam({ adapters: [adapter('fixture-official'), adapter('fixture-global')] }),
    captureAdapter, runner, runtime, config: { maxQueryBudget: 4 },
    embeddingProvider: { async preflight() { return { ok: true }; }, async embed(texts) { return { vectors: texts.map(() => mockVector768(7)) }; } } };
  return { workDir, calls, common, async start() { return composeP1Research({ ...common, plan: PLAN }); } };
}
const response = request => ({ schemaVersion: 1, binding: request.binding, clarification: { forceGroupIds: ['100'] } });
test('RED A: ambiguity surfaces a durable bound request and never runs downstream', async t => {
  const f = fixture(t), out = await f.start();
  assert.equal(out.clarificationRequired, true);
  assert.equal(out.code, 'clarification_required');
  assert.equal(readState(f.workDir).stage, 'SELECT');
  assert.equal(f.calls.capture, 0); assert.equal(f.calls.analyze, 0);
  assert.equal(fs.existsSync(path.join(f.workDir, 'research-result.json')), false);
  assert.ok(out.clarificationRequest, 'product composition must expose the existing selector request');
  assert.equal(out.clarificationRequest.binding.occurrenceId, readState(f.workDir).occurrenceId);
  assert.deepEqual(out.clarificationRequest.clarification.options.map(o => o.questionId), ['100', '200']);
  assert.ok(readState(f.workDir).hashes['source-group-clarification']);
});
test('RED B: explicit user clarification reaches the same selector and full downstream without retrieval replay', async t => {
  const f = fixture(t), pending = await f.start(), state = readState(f.workDir);
  const request = pending.clarificationRequest ?? { binding: { occurrenceId: state.occurrenceId } };
  const searchBefore = f.calls.search;
  const out = await composeP1Research({ ...f.common, clarificationResponse: response(request) });
  assert.equal(out.ok, true, 'valid explicit clarification must reach and complete the product pipeline');
  assert.equal(f.calls.search, searchBefore, 'committed retrieval must not be repaid');
  assert.equal(f.calls.capture, 1); assert.equal(f.calls.verify, 1); assert.equal(f.calls.analyze, 1); assert.equal(f.calls.synthesize, 1);
  assert.equal(readState(f.workDir).occurrenceId, state.occurrenceId);
  assert.equal(readState(f.workDir).stage, 'COMPLETE');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.workDir, 'source-group-selection-decision.json'))).clarificationCount, 1);
  assert.equal(fs.existsSync(path.join(f.workDir, 'research-result.json')), true);
  const before = { ...f.calls };
  const retry = await composeP1Research({ ...f.common, clarificationResponse: response(request) });
  assert.equal(retry.ok, true); assert.equal(retry.reused, true); assert.deepEqual(f.calls, before);
  const different = response(request); different.clarification.forceGroupIds = ['200'];
  const rejected = await composeP1Research({ ...f.common, clarificationResponse: different });
  assert.equal(rejected.ok, false); assert.equal(rejected.code, 'clarification_already_resolved');
  assert.deepEqual(f.calls, before);
});
function snapshot(dir) {
  const out = {};
  function visit(rel = '') { for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) visit(next); else out[next] = fs.readFileSync(path.join(dir, next)).toString('base64');
  } }
  visit(); return out;
}
test('invalid/unknown/insufficient answers preserve the exact frozen pending state and make no calls', async t => {
  const f = fixture(t), pending = await f.start(), request = pending.clarificationRequest;
  const before = snapshot(f.workDir), callsBefore = { ...f.calls };
  const again = await composeP1Research(f.common);
  assert.deepEqual(again.clarificationRequest, request); assert.deepEqual(snapshot(f.workDir), before);
  assert.deepEqual(f.calls, callsBefore, 'an unanswered pending request remains frozen');
  const missingBinding = response(request); delete missingBinding.binding;
  const stale = response(request); stale.binding = { ...stale.binding, occurrenceId: 'another-occurrence' };
  const malformed = response(request); malformed.clarification.forceGroupIds = [100];
  const unknown = response(request); unknown.clarification.forceGroupIds = ['999'];
  const insufficient = response(request); insufficient.clarification.forceGroupIds = [];
  for (const answer of [missingBinding, stale, malformed, unknown, insufficient]) {
    const out = await composeP1Research({ ...f.common, clarificationResponse: answer });
    assert.equal(out.ok, false); assert.deepEqual(f.calls, callsBefore); assert.deepEqual(snapshot(f.workDir), before);
  }
  const still = await composeP1Research({ ...f.common, clarificationResponse: insufficient });
  assert.equal(still.clarificationRequired, true); assert.deepEqual(still.clarificationRequest, request);
  const accepted = await composeP1Research({ ...f.common, clarificationResponse: response(request) });
  assert.equal(accepted.ok, true, 'invalid input did not consume the one successful resolution');
});
test('cross-occurrence answers and restart cannot repurpose a frozen request', async t => {
  const a = fixture(t), b = fixture(t), pending = await a.start(); await b.start();
  const answer = response(pending.clarificationRequest), before = snapshot(b.workDir), calls = { ...b.calls };
  const out = await composeP1Research({ ...b.common, clarificationResponse: answer });
  assert.equal(out.code, 'clarification_stale'); assert.deepEqual(snapshot(b.workDir), before); assert.deepEqual(b.calls, calls);
  const restarted = await composeP1Research({ ...a.common, restart: true, clarificationResponse: answer });
  assert.equal(restarted.code, 'clarification_stale');
});
test('removed checkpoint binding, changed config, and mutated committed pool fail before planner or retrieval fallback', async t => {
  for (const mutation of ['binding', 'config', 'pool']) {
    const f = fixture(t), pending = await f.start(), answer = response(pending.clarificationRequest);
    const state = readState(f.workDir);
    if (mutation === 'binding') { delete state.hashes['source-group-clarification']; writeState(f.workDir, state); }
    if (mutation === 'pool') {
      fs.rmSync(getStagingPath(f.workDir, 'accumulatedPool', state.hashes.accumulatedPool), { force: true });
      fs.appendFileSync(path.join(f.workDir, 'retrieval-rounds', 'accumulated-pool.json'), ' ');
    }
    const before = snapshot(f.workDir), calls = { ...f.calls };
    const out = await composeP1Research({ ...f.common,
      ...(mutation === 'config' ? { config: { maxQueryBudget: 5 } } : {}), clarificationResponse: answer,
      planner: async () => { throw new Error('must not reach planner'); } });
    assert.equal(out.ok, false); assert.equal(out.code, 'clarification_stale');
    assert.deepEqual(snapshot(f.workDir), before); assert.deepEqual(f.calls, calls);
  }
});
test('ordinary clear selection retains the existing full pipeline and creates no clarification artifact', async t => {
  const f = fixture(t, ['100']), out = await f.start();
  assert.equal(out.ok, true); assert.equal(f.calls.capture, 1); assert.equal(f.calls.analyze, 1);
  assert.equal(readState(f.workDir).hashes['source-group-clarification'], undefined);
  assert.equal(fs.existsSync(path.join(f.workDir, 'source-group-clarification-request.json')), false);
});
test('clarification recovery preserves pending decision authority across the SELECT checkpoint crash window', async t => {
  const f = fixture(t), pending = await f.start(), answer = response(pending.clarificationRequest);
  let killed;
  await composeP1Research({ ...f.common, clarificationResponse: answer, crashPoint(name) {
    if (name === 'after_select_checkpoint') { killed = readState(f.workDir); throw new Error('offline crash point'); }
  } });
  assert.equal(killed.stage, 'SELECT');
  assert.equal(killed.hashes.selectionDecision, answer.binding.pendingDecisionHash,
    'the first resumed checkpoint must not downgrade pending authority');
  // A real SIGKILL has no catch-path FAILED write; restore that captured kill shape.
  writeState(f.workDir, killed);
  const search = f.calls.search;
  const resumed = await composeP1Research({ ...f.common, clarificationResponse: answer });
  assert.equal(resumed.ok, true); assert.equal(f.calls.search, search);
});
test('request/pending staging can recover missing canonical views only through the checkpoint binding', async t => {
  const f = fixture(t), pending = await f.start(), before = f.calls.search;
  fs.rmSync(path.join(f.workDir, 'source-group-clarification-request.json'));
  fs.rmSync(path.join(f.workDir, 'source-group-selection-decision.json'));
  const out = await composeP1Research({ ...f.common, clarificationResponse: response(pending.clarificationRequest) });
  assert.equal(out.ok, true); assert.equal(f.calls.search, before);
  const calls = { ...f.calls };
  const retry = await composeP1Research({ ...f.common, clarificationResponse: response(pending.clarificationRequest) });
  assert.equal(retry.ok, true, 'original pending bytes must survive canonical-view recovery for idempotence');
  assert.equal(retry.reused, true); assert.deepEqual(f.calls, calls);
});
test('targeted enablement stays bound to the same request; recovery preserves existing #108 artifacts', async t => {
  const f = fixture(t);
  f.common.targetedSubphase = { maxQueryBudget: 4, maxAttemptsPerGap: 2, proposeForDiagnosis() { return []; } };
  const pending = await f.start(), before = snapshot(f.workDir), search = f.calls.search;
  assert.equal(pending.clarificationRequired, true);
  const refused = await composeP1Research({ ...f.common, targetedSubphase: null, clarificationResponse: response(pending.clarificationRequest) });
  assert.equal(refused.code, 'clarification_stale'); assert.deepEqual(snapshot(f.workDir), before);
  const out = await composeP1Research({ ...f.common, clarificationResponse: response(pending.clarificationRequest) });
  assert.equal(out.ok, true); assert.equal(f.calls.search, search); assert.ok(out.result.targetedResearchGaps);
});
test('selection persistence failure cannot be surfaced as a usable clarification request', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.workDir, 'source-group-selection-decision.json'));
  const out = await f.start();
  assert.equal(out.ok, false); assert.equal(out.code, 'selection_failed'); assert.equal(out.clarificationRequest, undefined);
  assert.equal(f.calls.capture, 0); assert.equal(f.calls.analyze, 0);
});
test('product CLI rejects unreadable input and restart+clarification without a live call', () => {
  const cli = fileURLToPath(new URL('../bin/research-p1.mjs', import.meta.url));
  for (const flags of [['--clarification', '/no-such-response-file'], ['--restart', '--clarification', 'response.json']]) {
    const out = spawnSync(process.execPath, [cli, '--json', ...flags, 'public question'], { encoding: 'utf8' });
    assert.equal(out.status, 2); assert.equal(JSON.parse(out.stdout).error.type, 'invalid_input');
    assert.equal(out.stdout.includes('/no-such-response-file'), false);
  }
});
test('actual P1 CLI parses a bound user response and reaches selector rejection, preserving the pending request', async t => {
  const f = fixture(t); f.common.config = undefined;
  const pending = await f.start(), answer = response(pending.clarificationRequest);
  answer.clarification.forceGroupIds = ['999'];
  const input = path.join(f.workDir, 'response.json'); fs.writeFileSync(input, JSON.stringify(answer));
  const before = snapshot(f.workDir);
  const cli = fileURLToPath(new URL('../bin/research-p1.mjs', import.meta.url));
  const out = spawnSync(process.execPath, [cli, f.common.topic, '--json', '--work', f.workDir, '--clarification', input], { encoding: 'utf8' });
  assert.equal(out.status, 3);
  assert.deepEqual(JSON.parse(out.stdout).clarificationRequest, pending.clarificationRequest);
  assert.deepEqual(snapshot(f.workDir), before);
});
test('canonical caller exposes request with exit 3 and forwards explicit recovery without restart', t => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-canonical-clarify-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const base = loadRuntimeAuthority();
  const authority = { ...base, canonical: { ...base.canonical, credentialEnv: 'OFFLINE_TEST_PRESENT', credentialFile: 'absent-file' } };
  const env = { [authority.env.runtimeMode]: 'canonical', OFFLINE_TEST_PRESENT: 'present' };
  const calls = [], request = { schemaVersion: 1, type: 'p1-source-group-clarification-request' };
  const gate = args => runCanonicalGate({ authority, env, repoRoot, argv: args,
    spawnImpl(file, argv) { calls.push(argv); return { status: 3, stdout: JSON.stringify({ clarificationRequest: request }), stderr: '' }; } });
  const first = gate(['--work', 'work/test', 'public question']);
  assert.equal(first.exitCode, 3); assert.deepEqual(first.clarificationRequest, request); assert.ok(calls[0].includes('--restart'));
  const second = gate(['--work', 'work/test', '--clarification', 'response.json', 'public question']);
  assert.equal(second.ok, false); assert.equal(second.exitCode, 3);
  assert.ok(calls[1].includes('--clarification')); assert.equal(calls[1].includes('--restart'), false);
  assert.ok(parseRunnerArgs(['--clarification']).usageError);
  const success = runCanonicalGate({ authority, env, repoRoot,
    argv: ['--work', 'work/test', '--clarification', 'response.json', 'public question'],
    spawnImpl() {
      fs.writeFileSync(path.join(repoRoot, 'work/test/orchestration-state.json'), JSON.stringify({ runId: 'offline-run', runtime: authority.canonical.runtimeId }));
      fs.writeFileSync(path.join(repoRoot, 'work/test/research-result.json'), JSON.stringify({ schemaVersion: 1 }));
      return { status: 0, stdout: '{}', stderr: '' };
    } });
  assert.equal(success.ok, true);
  assert.equal(success.evidence.evidence.restarted, false, 'explicit recovery is never reported as a restart');
});
