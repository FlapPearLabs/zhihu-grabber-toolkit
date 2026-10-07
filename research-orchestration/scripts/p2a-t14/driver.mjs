#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createFixture, runControllerControls, SCENARIOS, hash, json, writeJson } from './fixtures.mjs';
import { buildMatrix } from './matrix.mjs';

const args = process.argv.slice(2);
const arg = (key, fallback = null) => {
  const index = args.indexOf(`--${key}`);
  return index < 0 ? fallback : args[index + 1];
};
const repo = path.resolve(arg('repo', fileURLToPath(new URL('../../../', import.meta.url))));
const out = path.resolve(arg('out', '/tmp/p2a-t14-acceptance'));
const exactSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const sourceDirty = [
  ...execFileSync('git', ['diff', 'HEAD', '--name-only'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
];
if (sourceDirty.length > 0) throw new Error('T14_EXACT_SOURCE_DIRTY: commit or isolate the candidate before provider IO');
const load = rel => import(pathToFileURL(path.join(repo, 'research-orchestration', rel)).href);
const [{ readAnchoredLedger }, { resolveAnchoredLedgerBytes }] = await Promise.all([
  load('lib/targeted-requery-lifecycle.mjs'), load('lib/p1-runtime-composer.mjs'),
]);
const readLines = file => fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

function inventory(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...inventory(path.join(dir, entry.name), rel));
    else if (entry.isFile()) {
      const bytes = fs.readFileSync(path.join(dir, entry.name));
      result.push({ path: rel, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  return result;
}

function observe(workDir) {
  const state = json(path.join(workDir, 'orchestration-state.json'));
  return {
    exactRepoSha: exactSha, sourceDirty,
    runId: state?.runId ?? null, occurrenceId: state?.occurrenceId ?? null,
    plan: json(path.join(workDir, 'research-plan.json')),
    state, actions: json(path.join(workDir, 'targeted-requery-actions.json')),
    anchoredActions: readAnchoredLedger(state, sha => resolveAnchoredLedgerBytes(workDir, sha)),
    resolution: json(path.join(workDir, 'targeted-requery-resolution.json')),
    gaps: json(path.join(workDir, 'targeted-requery-ledger.json')),
    finalResult: json(path.join(workDir, 'research-result.json')),
    finalCoverage: json(path.join(workDir, 'coverage-final.json')),
    accumulatedPool: json(path.join(workDir, 'retrieval-rounds/accumulated-pool.json')),
    coverageState: json(path.join(workDir, 'coverage-state.json')),
    calls: readLines(path.join(workDir, 'acceptance-provider-calls.jsonl')),
    events: readLines(path.join(workDir, 'events.jsonl')),
    acceptanceEvents: readLines(path.join(workDir, 'acceptance-events.jsonl')),
    inventory: inventory(workDir),
  };
}

export function auditLineage(observation, workDir) {
  const failures = [];
  const check = (ok, reason) => { if (!ok) failures.push(reason); };
  const block = observation.finalCoverage?.targetedResearchGaps;
  const resultBlock = observation.finalResult?.targetedResearchGaps;
  check(block !== undefined, 'final coverage has no targetedResearchGaps');
  check(resultBlock !== undefined, 'final result has no targetedResearchGaps');
  if (!block || !resultBlock) return { valid: false, failures, joins: [] };
  check(JSON.stringify(block) === JSON.stringify(resultBlock), 'final blocks disagree');
  const actions = observation.anchoredActions?.targetedActions ?? [];
  check(observation.anchoredActions !== null, 'action ledger is not checkpoint-anchored');
  const gaps = observation.gaps?.diagnosedGaps ?? [];
  const links = block.gaps.flatMap(g => g.lineage.map(link => ({ gap: g, link })));
  const joins = [];
  for (const { gap, link } of links) {
    const action = actions.find(a => a.targetedActionId === link.targetedActionId);
    check(!!action, `orphan final action ${link.targetedActionId}`);
    if (!action) continue;
    check(gaps.some(g => g.gapId === gap.gapId), `unknown gap ${gap.gapId}`);
    check(action.gapId === gap.gapId, 'cross-gap action attribution');
    check(action.occurrenceId === observation.occurrenceId && gap.occurrenceId === observation.occurrenceId, 'cross-occurrence attribution');
    check(link.query === action.normalizedQuery, 'query does not join');
    check(JSON.stringify(link.providerScope) === JSON.stringify(action.providerScope), 'scope does not join');
    check(link.resultArtifact === action.artifactRel, 'result ref does not join');
    const artifactRel = action.artifactRel;
    if (!artifactRel) continue;
    check(!path.isAbsolute(artifactRel) && !artifactRel.includes('..'), 'result ref is not portable');
    const poolFile = path.join(workDir, artifactRel);
    check(fs.existsSync(poolFile), 'result pool is missing');
    if (!fs.existsSync(poolFile)) continue;
    const pool = json(poolFile);
    const artifactHash = hash(fs.readFileSync(poolFile));
    check(artifactHash === action.artifactHash, 'pool does not match action hash');
    check(artifactHash === observation.state.hashes?.[action.bindingKey], 'pool has no matching checkpoint credential');
    check((pool.channels ?? []).every(c => c.channel.query === action.normalizedQuery
      && action.providerScope.some(s => s.providerId === c.channel.providerId && s.capability === c.channel.capability)), 'provider/query outside authorized action');
    check(pool.candidates.every(candidate => candidate.ranks.every(rank => rank.channel.query === action.normalizedQuery
      && action.providerScope.some(scope => scope.providerId === rank.channel.providerId && scope.capability === rank.channel.capability))), 'candidate provenance outside action scope');
    check(pool.candidates.every(candidate => Math.abs(candidate.rrfScore - candidate.ranks.reduce((sum, rank) => sum + 1 / (60 + rank.rank), 0)) < 1e-12), 'RRF score is not derived from ranked provider evidence');
    const resultIds = pool.candidates.map(c => c.identity.questionId);
    check(gap.resolutionEvidence.every(id => resultIds.includes(id)), 'evidence not owned by the action result');
    joins.push({ gapId: gap.gapId, targetedActionId: action.targetedActionId,
      normalizedQuery: action.normalizedQuery, providerScope: action.providerScope,
      resultArtifact: artifactRel, artifactHash, resultQuestionIds: resultIds,
      reverse: resultIds.map(id => ({ resultQuestionId: id, targetedActionId: action.targetedActionId, gapId: gap.gapId, finalArtifact: 'coverage-final.json' })) });
  }
  check(actions.every(a => links.some(({ link }) => link.targetedActionId === a.targetedActionId)), 'orphan action in action ledger');
  check(gaps.every(g => block.gaps.some(f => f.gapId === g.gapId)), 'diagnosed gap missing from final artifact');
  check(block.gaps.every(g => gaps.some(d => d.gapId === g.gapId)), 'unknown final gap');
  check(observation.inventory.filter(a => a.path.startsWith('targeted-requery-subphase/') && a.path.endsWith('/retrieval-pool.json'))
    .every(a => actions.some(action => action.artifactRel === a.path)), 'orphan targeted result artifact');
  return { valid: failures.length === 0, failures, joins };
}

if (arg('child')) {
  const scenario = arg('child');
  fs.mkdirSync(out, { recursive: true });
  const fixture = await createFixture({ repo, workDir: out, scenario, phase: arg('phase', 'initial'), crash: arg('crash') });
  const { composeP1Research } = await load('lib/p1-runtime-composer.mjs');
  const result = await composeP1Research(fixture.options);
  writeJson(path.join(out, `acceptance-compose-${arg('phase', 'initial')}.json`), result);
  console.log(JSON.stringify({ scenario, exactRepoSha: exactSha, result }));
} else {
  fs.mkdirSync(out, { recursive: true });
  const chosen = arg('scenarios', SCENARIOS.join(',')).split(',');
  if (chosen.some(s => !SCENARIOS.includes(s))) throw new Error('Unknown T14 scenario');
  const records = [];
  const childScript = fileURLToPath(import.meta.url);
  for (const scenario of chosen) {
    const scenarioDir = path.join(out, scenario);
    const workDir = path.join(scenarioDir, 'work');
    if (fs.existsSync(workDir)) throw new Error('Campaign requires fresh scenario directories');
    fs.mkdirSync(scenarioDir, { recursive: true });
    const run = (phase, crash = null) => {
      const childArgs = [childScript, '--child', scenario, '--repo', repo, '--out', workDir, '--phase', phase];
      if (crash) childArgs.push('--crash', crash);
      const child = spawnSync(process.execPath, childArgs, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      fs.writeFileSync(path.join(scenarioDir, `${phase}.stdout.log`), child.stdout ?? '');
      fs.writeFileSync(path.join(scenarioDir, `${phase}.stderr.log`), child.stderr ?? '');
      return { command: `node research-orchestration/scripts/p2a-t14/driver.mjs --child ${scenario} --out "$T14_OUT/${scenario}/work" --phase ${phase}${crash ? ` --crash ${crash}` : ''}`,
        outputDirectoryRef: `${scenario}/work`, workingDirectory: 'repository-root',
        exitCode: child.status ?? (child.signal === 'SIGKILL' ? 137 : null), signal: child.signal, error: child.error ? String(child.error.code) : null };
    };
    const commands = [];
    const crash = scenario === 'crash-before' ? 'after_targeted_execution'
      : scenario === 'crash-after' ? 'after_targeted_commit_finalize' : null;
    commands.push(run('initial', crash));
    const initial = observe(workDir);
    writeJson(path.join(scenarioDir, 'initial-observation.json'), initial);
    let replay = null;
    let fault = null;
    let controllerControls = null;
    if (crash) {
      const { decideTargetedReplay, readAnchoredLedger } = await load('lib/targeted-requery-lifecycle.mjs');
      const { resolveAnchoredLedgerBytes } = await load('lib/p1-runtime-composer.mjs');
      const anchored = readAnchoredLedger(initial.state, sha => resolveAnchoredLedgerBytes(workDir, sha));
      const action = anchored?.targetedActions?.[0];
      if (action) {
        const identity = Object.fromEntries(['runId', 'occurrenceId', 'planHash', 'gapId', 'attempt', 'normalizedQuery', 'providerScope'].map(k => [k, action[k]]));
        replay = decideTargetedReplay({ workDir, state: initial.state, artifact: anchored, identity });
      }
      commands.push(run('resume'));
      commands.push(run('resume-again'));
    } else if (['tampered-pool', 'stale-binding', 'missing-resolution', 'tampered-resolution', 'foreign-resolution', 'missing-unauthed-resolution', 'canonical-ledger-drift'].includes(scenario)) {
      const action = initial.actions?.targetedActions?.[0];
      if (action?.artifactRel && ['tampered-pool', 'stale-binding'].includes(scenario)) {
        const target = path.join(workDir, action.artifactRel);
        const before = fs.readFileSync(target);
        const changed = JSON.parse(before);
        changed.candidates[0].identity.questionId = '999';
        writeJson(target, changed);
        fault = { kind: 'tampered-real-produced-pool', artifact: action.artifactRel, beforeHash: hash(before), afterHash: hash(fs.readFileSync(target)) };
      }
      if (scenario === 'stale-binding') {
        const ledgerHash = initial.state?.hashes?.['targeted-action-ledger'];
        const staging = initial.inventory.find(a => a.path.includes(ledgerHash ?? '__missing__') && a.path.includes('.commit-staging'));
        if (staging) {
          fs.unlinkSync(path.join(workDir, staging.path));
          fault = { ...fault, removedStagingArtifact: staging.path };
        }
      }
      if (['missing-resolution', 'missing-unauthed-resolution'].includes(scenario)) {
        fs.unlinkSync(path.join(workDir, 'targeted-requery-resolution.json'));
        fault = { kind: 'delete-real-produced-resolution' };
      }
      if (scenario === 'tampered-resolution') {
        const target = path.join(workDir, 'targeted-requery-resolution.json');
        const before = fs.readFileSync(target);
        const changed = JSON.parse(before);
        changed.resolutions[0].status = 'UNRESOLVED';
        changed.resolutions[0].resolutionBasis = 'DUPLICATE_ONLY';
        writeJson(target, changed);
        fault = { kind: 'mutate-real-produced-resolution', beforeHash: hash(before), afterHash: hash(fs.readFileSync(target)) };
      }
      if (scenario === 'canonical-ledger-drift') {
        const target = path.join(workDir, 'targeted-requery-actions.json');
        const before = fs.readFileSync(target);
        const changed = JSON.parse(before);
        changed.targetedActions[0].normalizedQuery = '非权威展示文件的篡改查询';
        writeJson(target, changed);
        fault = { kind: 'mutate-nonauthoritative-canonical-ledger', beforeHash: hash(before), afterHash: hash(fs.readFileSync(target)) };
      }
      if (scenario === 'foreign-resolution') {
        const target = path.join(workDir, 'targeted-requery-resolution.json');
        const before = fs.readFileSync(target);
        const changed = JSON.parse(before);
        changed.occurrenceId = 'foreign-occurrence';
        for (const record of changed.resolutions) record.occurrenceId = changed.occurrenceId;
        writeJson(target, changed);
        fault = { kind: 'foreign-occurrence-resolution', beforeHash: hash(before), afterHash: hash(fs.readFileSync(target)) };
      }
      commands.push(run('fault-resume'));
    } else if (['equivalent-query', 'unknown-gap', 'per-gap-bound'].includes(scenario)) {
      controllerControls = await runControllerControls({ repo, workDir });
      commands.push(run('resume'));
    }
    const observed = observe(workDir);
    const result = json(path.join(workDir, `acceptance-compose-${commands.length > 1 ? (crash ? 'resume-again' : controllerControls ? 'resume' : 'fault-resume') : 'initial'}.json`));
    const checks = [];
    const check = (name, ok, actual = null, expected = null) => checks.push({ name, pass: !!ok, actual, expected });
    check('child execution', commands.every(c => c.error === null && (c.exitCode === 0 || (crash && c.signal === 'SIGKILL'))), commands);
    const initialCalls = initial.calls.filter(c => c.kind === 'targeted').length;
    const finalCalls = observed.calls.filter(c => c.kind === 'targeted').length;
    const noTargeted = ['free-form', 'unsafe-plan-owned', 'stale-action', 'missing-unauthed-resolution'].includes(scenario);
    const expectedTargetedCalls = noTargeted ? 0 : scenario === 'provider-scope' ? 1 : crash && scenario === 'crash-before' ? 4 : 2;
    const expectedProviderCalls = expectedTargetedCalls + (crash ? 8 : 4);
    check('targeted provider calls', finalCalls === expectedTargetedCalls, finalCalls, expectedTargetedCalls);
    check('all provider calls', observed.calls.length === expectedProviderCalls, observed.calls.length, expectedProviderCalls);
    check('no runtime or provider fallback', observed.finalResult?.runtime?.runtimeId === 'deepseek-api-tool-less'
      && observed.finalResult?.runtime?.model === 'deepseek-v4-pro'
      && observed.calls.every(c => ['zhihu_search', 'zhihu-open-platform'].includes(c.providerId) && c.capability === 'search'));
    const refusal = ['tampered-pool', 'stale-binding', 'missing-resolution', 'tampered-resolution', 'foreign-resolution', 'missing-unauthed-resolution'].includes(scenario);
    if (!refusal) check('composition completed', result?.ok === true, result?.code ?? null, true);
    const block = observed.finalCoverage?.targetedResearchGaps;
    check('all durable gaps visible', block?.gaps?.length === observed.gaps?.diagnosedGaps?.length && !!block,
      block?.gaps?.length ?? null, observed.gaps?.diagnosedGaps?.length ?? null);
    check('controller before targeted IO', observed.calls.filter(c => c.kind === 'targeted').every(c => c.gapLedgerHashBeforeIo
      && c.authorizedActionsBeforeIo.length === 1 && c.authorizedActionsBeforeIo[0].status === 'AUTHORIZED'
      && c.authorizedActionsBeforeIo[0].providerScope.some(s => s.providerId === c.providerId && s.capability === c.capability)));
    const resolutions = observed.resolution?.resolutions ?? [];
    if (scenario === 'canonical') check('evidence resolution', resolutions.length === 1 && resolutions[0].status === 'RESOLVED'
      && JSON.stringify(resolutions[0].resolutionEvidence) === JSON.stringify(['300', '301']));
    if (scenario === 'duplicate-only') check('duplicate-only unresolved', resolutions.length === 1 && resolutions[0].status === 'UNRESOLVED' && resolutions[0].resolutionBasis === 'DUPLICATE_ONLY');
    if (scenario === 'contradiction-one-side') check('one-sided does not resolve', resolutions.length === 1 && resolutions[0].status === 'UNRESOLVED'
      && ['SAME_SIDE_ONLY', 'UNKNOWN_SIDE_NOT_DECLARED'].includes(resolutions[0].resolutionBasis));
    if (scenario === 'authority-unavailable') check('no authority predicate', resolutions.length === 1 && resolutions[0].status === 'UNRESOLVED'
      && resolutions[0].resolutionBasis === 'UNKNOWN_NO_AUTHORITY_PREDICATE');
    if (scenario === 'global-budget') {
      check('budget bounds real IO', observed.calls.length === 6, observed.calls.length, 6);
      check('budget terminal honest', resolutions.some(r => r.status === 'EXHAUSTED_WITHIN_BUDGET')
        && !resolutions.some(r => r.status === 'SATURATED'));
      check('budget refuses next gap', (observed.actions?.rejected ?? []).some(r => r.rejectionCode === 'GLOBAL_QUERY_BUDGET_EXCEEDED'));
    }
    if (scenario === 'per-gap-bound') check('per-gap terminal honest', resolutions.some(r => r.status === 'EXHAUSTED_WITHIN_BUDGET'));
    if (scenario === 'all-provider-failed') check('operational failure stays unresolved', observed.actions?.targetedActions?.[0]?.status === 'FAILED_OPERATIONAL'
      && resolutions.length === 1 && resolutions[0].status === 'UNRESOLVED');
    if (noTargeted && scenario !== 'stale-action') check('rejected proposal recorded', (observed.actions?.rejected ?? []).length > 0);
    if (crash) {
      check('same occurrence resumes', initial.occurrenceId === observed.occurrenceId);
      check('real kill at window', commands[0].signal === 'SIGKILL');
      check('resume paid IO delta', finalCalls - initialCalls === (scenario === 'crash-before' ? 2 : 0), finalCalls - initialCalls, scenario === 'crash-before' ? 2 : 0);
      check('one durable COMMIT', observed.actions?.targetedActions?.every(a => a.audit.filter(e => e.event === 'COMMIT').length === 1));
      const firstAction = initial.anchoredActions?.targetedActions?.[0];
      const finalAction = observed.anchoredActions?.targetedActions?.[0];
      check('commit window checkpoint matches kill', scenario === 'crash-before'
        ? firstAction?.status === 'AUTHORIZED' && initial.state?.hashes?.[`targeted-action:${firstAction.targetedActionId}`] === undefined
        : firstAction?.status === 'COMMITTED' && initial.state?.hashes?.[firstAction.bindingKey] === firstAction.artifactHash);
      check('final pool hash matches binding', finalAction?.artifactHash === observed.state?.hashes?.[finalAction?.bindingKey]);
      check('replay decision', replay?.decision === (scenario === 'crash-before' ? 'RERUN' : 'REUSE'), replay?.decision);
    }
    if (refusal) {
      check('tampered committed product refused', result?.ok === false && result?.reused !== true, result);
      check('fault does not pay again', observed.calls.length === initial.calls.length);
    }
    if (controllerControls) {
      check('control changes audit-only inputs', controllerControls.productionSecondDiagnosisRound === false && controllerControls.authorityLedgerWritten === false);
      check('same core across diagnosis round', controllerControls.originalGap.gapIdentityCore === controllerControls.nextRoundGap.gapIdentityCore
        && controllerControls.originalGap.gapId !== controllerControls.nextRoundGap.gapId);
      check('cross-round dedupe guard and load-bearing control', controllerControls.dedupeRejected.rejectionCode === 'EQUIVALENT_QUERY_ALREADY_AUTHORIZED'
        && controllerControls.dedupePositive.status === 'AUTHORIZED');
      check('per-gap guard and load-bearing control', controllerControls.boundRejected.rejectionCode === 'PER_GAP_ATTEMPT_BOUND_EXCEEDED'
        && controllerControls.boundPositive.status === 'AUTHORIZED');
      check('unknown guard and load-bearing control', controllerControls.unknownGap.gapType === 'UNKNOWN_GAP_TYPE'
        && controllerControls.unknownRejected.rejectionDetail === 'GAP_TYPE_NOT_IN_CLOSED_ENUM'
        && controllerControls.knownPositive.status === 'AUTHORIZED');
      check('controls and complete resume zero IO', observed.calls.length === initial.calls.length && result?.reused === true);
    }
    if (scenario === 'canonical-ledger-drift') check('canonical ledger is not a replay credential', result?.reused === true && observed.calls.length === initial.calls.length);
    if (scenario === 'equivalent-query') check('equivalent completed replay zero IO', observed.calls.length === initial.calls.length && result?.reused === true);
    const lineage = auditLineage(observed, workDir);
    if (!noTargeted && scenario !== 'all-provider-failed' && !refusal) check('bidirectional lineage', lineage.valid, lineage.failures);
    const record = {
      schema: 'p2a-t14-occurrence-evidence/v1', scenarioId: scenario,
      exactRepoSha: exactSha, sourceDirty, nodeVersion: process.version,
      runId: observed.runId, occurrenceId: observed.occurrenceId,
      planId: observed.gaps?.planHash ?? observed.plan?.planHash ?? null, generation: observed.occurrenceId,
      commands, inputArtifacts: observed.inventory.filter(a => a.path.startsWith('acceptance-input') || a.path === 'research-plan.json'),
      outputArtifacts: observed.inventory.filter(a => !a.path.startsWith('acceptance-')),
      observedProviderCallCount: observed.calls.length,
      expectedTargetedProviderCallCount: expectedTargetedCalls, observedTargetedProviderCallCount: finalCalls,
      expectedProviderCallCount: expectedProviderCalls,
      initialTargetedProviderCallCount: initialCalls, replay, fault, controllerControls, checks, lineage,
      result, verdict: checks.every(c => c.pass) ? 'PASS' : 'FAIL',
    };
    writeJson(path.join(scenarioDir, 'final-observation.json'), observed);
    writeJson(path.join(scenarioDir, 'evidence.json'), record);
    records.push(record);
    console.log(`${scenario}: ${record.verdict}; provider=${observed.calls.length}; targeted=${finalCalls}; failing=${checks.filter(c => !c.pass).map(c => c.name).join(', ')}`);
  }
  const campaign = { schema: 'p2a-t14-acceptance-campaign/v1', exactRepoSha: exactSha, sourceDirty,
    nodeVersion: process.version, qualityClaim: 'OUT_OF_SCOPE', scenarios: records,
    verdict: records.every(r => r.verdict === 'PASS') ? 'PASS' : 'FAIL' };
  const matrix = buildMatrix(campaign);
  campaign.scenarioChecksVerdict = campaign.verdict;
  campaign.verdict = campaign.verdict === 'FAIL' || matrix.counts.fail > 0 ? 'FAIL'
    : matrix.counts.notProven > 0 ? 'NOT_PROVEN' : 'PASS';
  campaign.engineeringGate = matrix.engineeringGate;
  writeJson(path.join(out, 'matrix.json'), matrix);
  writeJson(path.join(out, 'campaign.json'), campaign);
  console.log(`engineering gate: ${campaign.verdict}; rows PASS=${matrix.counts.pass} FAIL=${matrix.counts.fail} NOT_PROVEN=${matrix.counts.notProven}`);
  process.exitCode = campaign.verdict === 'PASS' ? 0 : campaign.verdict === 'NOT_PROVEN' ? 2 : 1;
}
