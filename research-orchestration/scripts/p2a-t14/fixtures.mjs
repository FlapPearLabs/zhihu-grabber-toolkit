import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SCENARIOS = [
  'canonical', 'duplicate-only', 'contradiction-one-side', 'authority-unavailable',
  'free-form', 'unsafe-plan-owned', 'unknown-gap', 'stale-action',
  'all-provider-failed', 'provider-scope', 'global-budget', 'per-gap-bound',
  'crash-before', 'crash-after', 'tampered-pool', 'stale-binding', 'equivalent-query',
  'missing-resolution', 'tampered-resolution', 'foreign-resolution', 'missing-unauthed-resolution', 'canonical-ledger-drift',
];

export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const json = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
export const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

export async function createFixture({ repo, workDir, scenario, phase = 'initial', crash = null }) {
  const load = rel => import(pathToFileURL(path.join(repo, 'research-orchestration', rel)).href);
  const [provider, synthesis, diagnosis, planContract, { defaultRunner }, { mockVector768 }, lifecycle, composer] = await Promise.all([
    load('lib/provider-seam.mjs'), load('lib/cross-source-synthesis.mjs'),
    load('lib/targeted-requery-diagnosis.mjs'), load('lib/plan-contract.mjs'),
    load('lib/runner.mjs'), load('test/helpers/test-embedding-provider.mjs'),
    load('lib/targeted-requery-lifecycle.mjs'), load('lib/p1-runtime-composer.mjs'),
  ]);
  const plan = {
    schemaVersion: 1, queryVariants: ['基础资料'], aspects: ['补充资料'],
    entities: ['补充资料'], opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [],
  };
  if (scenario === 'contradiction-one-side') {
    plan.aspects = ['基础资料'];
    plan.opposingFramings = ['相反观点'];
  }
  if (scenario === 'authority-unavailable') {
    plan.aspects = ['基础资料'];
    plan.sourceGroupIntents = [{ intent: '原始权威资料', constraints: [], groupKey: '300' }];
  }
  if (scenario === 'unsafe-plan-owned') {
    plan.aspects = ['/etc/hosts 文件的作用'];
    plan.entities = ['/etc/hosts 文件的作用'];
  }
  if (scenario === 'global-budget') {
    plan.aspects = ['第一补充资料', '第二补充资料'];
    plan.entities = [...plan.aspects];
  }
  const planHash = planContract.planHash(plan);
  const providers = ['zhihu_search', 'zhihu-open-platform'];
  const traceFile = path.join(workDir, 'acceptance-provider-calls.jsonl');
  const eventFile = path.join(workDir, 'acceptance-events.jsonl');
  const event = value => fs.appendFileSync(eventFile, `${JSON.stringify({ phase, ...value })}\n`);
  const providerCalls = () => fs.existsSync(traceFile)
    ? fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const seam = provider.createProviderSeam({ adapters: providers.map(providerId => ({
    providerId, capability: provider.CAPABILITY_SEARCH, authClass: provider.AUTH_CLASS_OFFICIAL_SECRET,
    retrieve({ query }) {
      const isTargeted = !plan.queryVariants.includes(query);
      const state = json(path.join(workDir, 'orchestration-state.json'));
      const ledger = lifecycle.readAnchoredLedger(state, sha => composer.resolveAnchoredLedgerBytes(workDir, sha));
      const gapLedger = json(path.join(workDir, 'targeted-requery-ledger.json'));
      const matching = (ledger?.targetedActions ?? []).filter(a => a.normalizedQuery === query);
      const failed = isTargeted && scenario === 'all-provider-failed';
      const ids = !isTargeted || scenario === 'duplicate-only' || scenario === 'per-gap-bound'
        || scenario === 'global-budget' ? ['100', '200'] : ['300', '301'];
      const output = failed ? {
        ok: false, provider_id: providerId, capability: provider.CAPABILITY_SEARCH,
        auth_class: provider.AUTH_CLASS_OFFICIAL_SECRET,
        retrieved_at: '2026-10-07T00:00:00.000Z',
        failure: { code: 'T14_OFFLINE_PROVIDER_FAILURE', class: 'network' }, items: [],
        completeness: { status: provider.COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'offline_fault' } },
      } : {
        ok: true, provider_id: providerId, capability: provider.CAPABILITY_SEARCH,
        auth_class: provider.AUTH_CLASS_OFFICIAL_SECRET,
        retrieved_at: '2026-10-07T00:00:00.000Z',
        items: ids.map((questionId, i) => ({
          identity: { kind: 'candidate', questionId },
          provenance: { route: 'offline-acceptance', rank: i + 1, rankOrigin: 'fixture_order' },
          source_url: null, facts: {},
        })),
        completeness: { status: provider.COMPLETENESS_UNKNOWN, evidence: { signal: 'absent', reason: 'offline_fixture' } },
        query,
      };
      const call = {
        sequence: providerCalls().length + 1, phase, query, providerId,
        capability: provider.CAPABILITY_SEARCH, kind: isTargeted ? 'targeted' : 'planned',
        runId: state?.runId, occurrenceId: state?.occurrenceId, planHash,
        authorizedActionsBeforeIo: matching.map(a => ({
          targetedActionId: a.targetedActionId, gapId: a.gapId, status: a.status,
          normalizedQuery: a.normalizedQuery, providerScope: a.providerScope,
        })),
        gapLedgerHashBeforeIo: gapLedger ? hash(fs.readFileSync(path.join(workDir, 'targeted-requery-ledger.json'))) : null,
        checkpointHashesBeforeIo: state?.hashes ?? {},
        output,
      };
      fs.appendFileSync(traceFile, `${JSON.stringify(call)}\n`);
      event({ event: 'provider_io', sequence: call.sequence, kind: call.kind, query, providerId });
      return output;
    },
  })) });
  const captureAdapter = {
    providerId: 'offline-capture', capability: 'capture', authClass: 'session',
    retrieve({ questionId, outDir }) {
      const id = String(questionId);
      const dir = path.join(outDir, id);
      fs.mkdirSync(dir, { recursive: true });
      const content = `离线证据 ${id}：工程流程需要确定性的验收。`;
      writeJson(path.join(dir, 'answers.json'), {
        questionId: id, questionTitle: `离线问题 ${id}`,
        answers: [{ id: String(Number(id) * 100 + 1), content, excerpt: content, author: `fixture-${id}`, voteupCount: 3 }],
      });
      fs.writeFileSync(path.join(dir, 'answers.md'), `## 1. fixture-${id} — 3 赞 · 0 评论\n\n${content}\n`);
      writeJson(path.join(dir, '.progress.json'), { offset: 60, done: true });
      return {
        ok: true, provider_id: 'offline-capture', capability: 'capture', auth_class: 'session',
        retrieved_at: '2026-10-07T00:00:00.000Z',
        items: [{ identity: { kind: 'group', questionId: id },
          provenance: { route: 'offline-capture', rank: 1, rankOrigin: 'fixture' }, facts: { capturedAnswerCount: 1 } }],
        completeness: { status: 'complete', evidence: { basis: 'offline_fixture' } },
      };
    },
  };
  const runtime = {
    runtimeId: synthesis.T14_SYNTHESIS_RUNTIME_ID, model: synthesis.T14_SYNTHESIS_MODEL,
    async analyze({ projection }) {
      const tokens = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map(m => m[1]);
      event({ event: 'analysis', tokens: tokens.length });
      return { main: [{ tokenRef: tokens[0], statement: '离线证据观点' }], minority: [], contradictory: [], expertEvidenceRichTokens: [tokens[0]] };
    },
    async synthesize({ claims }) {
      event({ event: 'synthesis', claims: claims.length });
      return { families: [{ aspect: '资料核验', anchorClaimId: [...claims.map(c => c.claimId)].sort()[0],
        members: claims.map(c => ({ claimId: c.claimId, stance: 'ASSERTS' })) }], unresolvedClaimIds: [] };
    },
  };
  const embeddingProvider = {
    async preflight() { return { ok: true }; },
    async embed(texts) { return { vectors: texts.map(() => mockVector768(7)) }; },
  };
  const targetedSubphase = {
    get proposals() {
      const state = json(path.join(workDir, 'orchestration-state.json'));
      const pool = json(path.join(workDir, 'retrieval-rounds/accumulated-pool.json'));
      const provenance = [...new Set(pool.channels.filter(c => c.ok).map(c => c.channel.query))];
      const diagnosed = diagnosis.diagnoseGaps({ plan, executedQueryProvenance: provenance,
        planHash, occurrenceId: state.occurrenceId, diagnosisRound: 0 });
      const proposals = diagnosed.records.map(gap => {
        let ref = { field: 'entities', index: plan.entities.findIndex(a => `aspect:${a.toLowerCase()}` === gap.subjectKey) };
        if (gap.gapType === 'CONTRADICTION_GAP') ref = { field: 'opposingFramings', index: 0 };
        if (gap.gapType === 'AUTHORITY_GAP') ref = { field: 'sourceGroupIntents.intent', index: 0 };
        if (ref.index < 0) ref.index = 0;
        let proposal = { gapId: gap.gapId, planOwnedStringRef: ref };
        if (['free-form', 'missing-unauthed-resolution'].includes(scenario)) proposal = { gapId: gap.gapId, queryText: '安全但未经授权的自由查询' };
        if (scenario === 'stale-action') proposal.gapId = `${'0'.repeat(64)}:0`;
        if (scenario === 'provider-scope') proposal.requestedProviderScope = [providers[0]];
        return proposal;
      });
      event({ event: 'proposal', runId: state.runId, occurrenceId: state.occurrenceId, planHash,
        diagnosedGapIds: diagnosed.records.map(g => g.gapId), proposals });
      writeJson(path.join(workDir, `acceptance-input-${phase}.json`), { plan, planHash, occurrenceId: state.occurrenceId, proposals,
        policy: { maxQueryBudget: targetedSubphase.maxQueryBudget, maxAttemptsPerGap: targetedSubphase.maxAttemptsPerGap } });
      return proposals;
    },
    maxQueryBudget: scenario === 'global-budget' ? 6 : 20,
    maxAttemptsPerGap: scenario === 'per-gap-bound' ? 1 : 3,
  };
  const runner = defaultRunner();
  return {
    plan, planHash, providers, providerCalls,
    options: {
      topic: '定向检索工程验收', workDir, plan, runtime, seam, captureAdapter, runner,
      embeddingProvider, targetedSubphase,
      fetchImpl: () => { throw new Error('T14_UNEXPECTED_NETWORK'); },
      crashPoint(label) {
        if (label === crash) {
          event({ event: 'crash', label });
          process.kill(process.pid, 'SIGKILL');
        }
      },
    },
  };
}

// These challenges call the actual controller guards with this occurrence's
// checkpoint facts. They are boundary controls, not a second composer round.
export async function runControllerControls({ repo, workDir }) {
  const load = rel => import(pathToFileURL(path.join(repo, 'research-orchestration', rel)).href);
  const [ledger, authorization, lifecycle, composer, attempts, subphase] = await Promise.all([
    load('lib/targeted-requery-ledger.mjs'), load('lib/targeted-requery-authorization.mjs'),
    load('lib/targeted-requery-lifecycle.mjs'), load('lib/p1-runtime-composer.mjs'),
    load('lib/targeted-requery-attempts.mjs'), load('lib/targeted-requery-subphase.mjs'),
  ]);
  const state = json(path.join(workDir, 'orchestration-state.json'));
  const callsFile = path.join(workDir, 'acceptance-provider-calls.jsonl');
  const callsBefore = fs.readFileSync(callsFile, 'utf8');
  const authorityFiles = ['orchestration-state.json', 'targeted-requery-actions.json', 'targeted-requery-ledger.json'];
  const authorityBefore = Object.fromEntries(authorityFiles.map(file => [file, hash(fs.readFileSync(path.join(workDir, file)))]));
  const anchored = lifecycle.readAnchoredLedger(state, sha => composer.resolveAnchoredLedgerBytes(workDir, sha));
  const plan = json(path.join(workDir, 'research-plan.json'));
  const coverage = json(path.join(workDir, 'coverage-state.json'));
  const action = anchored.targetedActions[0];
  const coreCounts = {};
  for (const a of anchored.targetedActions) coreCounts[a.gapIdentityCore] = (coreCounts[a.gapIdentityCore] ?? 0) + 1;
  const paid = attempts.computeTargetedAttemptCounts({ actions: anchored.targetedActions });
  const policy = json(path.join(workDir, 'acceptance-input-initial.json')).policy;
  const base = {
    plan, runId: state.runId, occurrenceId: state.occurrenceId, planHash: anchored.planHash,
    plannedRoutes: coverage.retrieval.plannedRoutes,
    attemptsBudgetCount: subphase.computePlannedAttemptCount(coverage) + paid.executed + paid.failed,
    attemptsByGapIdentityCore: coreCounts, authorizedDedupeKeys: anchored.targetedActions.map(a => a.dedupeKey),
    ...policy,
  };
  const gap = json(path.join(workDir, 'targeted-requery-ledger.json')).diagnosedGaps.find(g => g.gapId === action.gapId);
  const nextRound = { ...gap, diagnosisRound: gap.diagnosisRound + 1,
    gapId: ledger.makeGapId(gap.gapIdentityCore, gap.diagnosisRound + 1) };
  const queryRef = { field: 'entities', index: plan.entities.findIndex(q => authorization.normalizeQueryString(q) === action.normalizedQuery) };
  const proposal = { gapId: nextRound.gapId, planOwnedStringRef: queryRef };
  const context = { ...base, maxAttemptsPerGap: Math.max(base.maxAttemptsPerGap, coreCounts[action.gapIdentityCore] + 1),
    resolveGap: id => id === nextRound.gapId ? nextRound : null };
  const dedupeRejected = authorization.authorizeTargetedAction(proposal, context);
  const dedupePositive = authorization.authorizeTargetedAction(proposal,
    { ...context, authorizedDedupeKeys: base.authorizedDedupeKeys.filter(k => k !== action.dedupeKey) });
  const otherProposal = { gapId: nextRound.gapId, planOwnedStringRef: { field: 'queryVariants', index: 0 } };
  const boundContext = { ...context, maxAttemptsPerGap: coreCounts[action.gapIdentityCore] };
  const boundRejected = authorization.authorizeTargetedAction(otherProposal, boundContext);
  const boundPositive = authorization.authorizeTargetedAction(otherProposal,
    { ...boundContext, maxAttemptsPerGap: boundContext.maxAttemptsPerGap + 1 });
  const unknown = ledger.makeGapRecord({ planHash: anchored.planHash, occurrenceId: state.occurrenceId,
    diagnosisRound: 1, gapType: 'UNSUPPORTED_ACCEPTANCE_TYPE', subject: { kind: 'explicit', subjectKey: gap.subjectKey } });
  const unknownProposal = { gapId: unknown.gapId, planOwnedStringRef: { field: 'queryVariants', index: 0 } };
  const unknownRejected = authorization.authorizeTargetedAction(unknownProposal,
    { ...base, maxAttemptsPerGap: context.maxAttemptsPerGap, resolveGap: id => id === unknown.gapId ? unknown : null });
  const known = ledger.makeGapRecord({ planHash: anchored.planHash, occurrenceId: state.occurrenceId,
    diagnosisRound: 1, gapType: 'ASPECT_GAP', subject: { kind: 'aspect', value: plan.aspects[0] } });
  const knownPositive = authorization.authorizeTargetedAction({ ...unknownProposal, gapId: known.gapId },
    { ...base, maxAttemptsPerGap: context.maxAttemptsPerGap, resolveGap: id => id === known.gapId ? known : null });
  const controls = {
    evidenceClass: 'CONTROLLER_BOUNDARY_NEGATIVE_CONTROL', productionSecondDiagnosisRound: false,
    runId: state.runId, occurrenceId: state.occurrenceId, planHash: anchored.planHash,
    ledgerCheckpointHash: state.hashes[lifecycle.LEDGER_CHECKPOINT_KEY],
    contextFacts: { ...base, plan: undefined }, effectiveGuardControlPolicy: { maxAttemptsPerGap: context.maxAttemptsPerGap },
    originalGap: gap, nextRoundGap: nextRound,
    unknownGap: unknown, dedupeRejected, dedupePositive, boundRejected, boundPositive, unknownRejected, knownPositive,
    controlDifferences: { dedupe: 'leave attempt headroom to isolate dedupe, then remove only target dedupe key from read-only context',
      bound: 'increase only limit by one in read-only context',
      unknown: 'change only type and its required canonical identity using the public record builder' },
    providerCallCountBefore: callsBefore.trim().split('\n').length,
    providerCallCountAfter: fs.readFileSync(callsFile, 'utf8').trim().split('\n').length,
    providerIoPerformed: callsBefore !== fs.readFileSync(callsFile, 'utf8'),
    authorityBeforeHashes: authorityBefore,
    authorityAfterHashes: Object.fromEntries(authorityFiles.map(file => [file, hash(fs.readFileSync(path.join(workDir, file)))])),
    authorityLedgerWritten: authorityFiles.some(file => authorityBefore[file] !== hash(fs.readFileSync(path.join(workDir, file)))),
  };
  writeJson(path.join(workDir, 'acceptance-controller-controls.json'), controls);
  return controls;
}
