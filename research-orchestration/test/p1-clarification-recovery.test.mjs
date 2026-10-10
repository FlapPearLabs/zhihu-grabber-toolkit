import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam } from '../lib/provider-seam.mjs';
import { readState } from '../lib/state.mjs';
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
});
