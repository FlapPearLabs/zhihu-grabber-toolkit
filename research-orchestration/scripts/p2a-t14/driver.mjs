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
const expectedHead = arg('expected-head');
if (!/^[a-f0-9]{40}$/.test(expectedHead ?? '')) {
  console.error('T14_EXPECTED_HEAD_REQUIRED: pass --expected-head <reviewed 40-character SHA> before running the campaign');
  process.exit(1);
}
const repo = path.resolve(arg('repo', fileURLToPath(new URL('../../../', import.meta.url))));
const out = path.resolve(arg('out', '/tmp/p2a-t14-acceptance'));
const exactSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
if (exactSha !== expectedHead) throw new Error(`T14_EXPECTED_HEAD_MISMATCH: expected ${expectedHead}, got ${exactSha}`);
const sourceDirty = [
  ...execFileSync('git', ['diff', 'HEAD', '--name-only'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
];
if (sourceDirty.length > 0) throw new Error('T14_EXACT_SOURCE_DIRTY: commit or isolate the candidate before provider IO');
const executingScripts = path.dirname(fileURLToPath(import.meta.url));
for (const name of ['driver.mjs', 'fixtures.mjs', 'matrix.mjs', 'package-evidence.mjs']) {
  const rel = 'research-orchestration/scripts/p2a-t14/' + name;
  const committed = execFileSync('git', ['show', exactSha + ':' + rel], { cwd: repo });
  if (hash(fs.readFileSync(path.join(executingScripts, name))) !== hash(committed)) {
    throw new Error('T14_EXACT_SOURCE_DIRTY: executing harness differs from HEAD: ' + rel);
  }
}
const load = rel => import(pathToFileURL(path.join(repo, 'research-orchestration', rel)).href);
const [{ readAnchoredLedger }, composer, authorizationCodes, { GAP_TYPES }, { targetedResolutionInputKey }] = await Promise.all([
  load('lib/targeted-requery-lifecycle.mjs'), load('lib/p1-runtime-composer.mjs'), load('lib/targeted-requery-authorization.mjs'), load('lib/targeted-requery-ledger.mjs'),
  load('lib/targeted-requery-subphase.mjs'),
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
  const actions = json(path.join(workDir, 'targeted-requery-actions.json'));
  const anchoredActions = readAnchoredLedger(state, sha => composer.resolveAnchoredLedgerBytes(workDir, sha));
  const resolutionInputs = (anchoredActions?.targetedActions ?? actions?.targetedActions ?? []).map(action => {
    const key = targetedResolutionInputKey(action.targetedActionId);
    const bindingHash = state?.hashes?.[key] ?? null;
    const bytes = bindingHash ? composer.resolveResolutionInputBytes(workDir, action.targetedActionId, bindingHash) : null;
    let snapshot = null;
    try { snapshot = bytes ? JSON.parse(bytes.toString('utf8')) : null; } catch {}
    return { targetedActionId: action.targetedActionId, gapId: action.gapId, planHash: action.planHash,
      occurrenceId: action.occurrenceId, key, bindingHash, byteHash: bytes ? hash(bytes) : null,
      byteLength: bytes?.length ?? null, bytesHex: bytes?.toString('hex') ?? null, snapshot };
  });
  return {
    exactRepoSha: exactSha, sourceDirty,
    runId: state?.runId ?? null, occurrenceId: state?.occurrenceId ?? null,
    plan: json(path.join(workDir, 'research-plan.json')),
    state, actions, anchoredActions, resolutionInputs,
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
      const childArgs = [childScript, '--child', scenario, '--repo', repo, '--out', workDir, '--phase', phase, '--expected-head', expectedHead];
      if (crash) childArgs.push('--crash', crash);
      const child = spawnSync(process.execPath, childArgs, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      fs.writeFileSync(path.join(scenarioDir, `${phase}.stdout.log`), child.stdout ?? '');
      fs.writeFileSync(path.join(scenarioDir, `${phase}.stderr.log`), child.stderr ?? '');
      return { command: `node research-orchestration/scripts/p2a-t14/driver.mjs --child ${scenario} --out "$T14_OUT/${scenario}/work" --phase ${phase} --expected-head ${exactSha}${crash ? ` --crash ${crash}` : ''}`,
        outputDirectoryRef: `${scenario}/work`, workingDirectory: 'repository-root',
        exitCode: child.status ?? (child.signal === 'SIGKILL' ? 137 : null), signal: child.signal, error: child.error ? String(child.error.code) : null };
    };
    const commands = [];
    const crash = scenario === 'crash-before' ? 'after_targeted_execution'
      : ['crash-after', 'crash-resolution-input', 'crash-resolution-reverse', 'crash-framing-drift'].includes(scenario) ? 'after_targeted_commit_finalize' : null;
    commands.push(run('initial', crash));
    const initial = observe(workDir);
    writeJson(path.join(scenarioDir, 'initial-observation.json'), initial);
    let replay = null;
    let fault = null;
    let controllerControls = null;
    let faultResultForRecord = null;
    let controlResultForRecord = null;
    let staleActionControlForRecord = null;
    let completeResumeProviderCallDelta = null;
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
      if (['crash-resolution-input', 'crash-resolution-reverse', 'crash-framing-drift'].includes(scenario)) {
        const callsBeforeCompleteResume = readLines(path.join(workDir, 'acceptance-provider-calls.jsonl')).length;
        commands.push(run('complete-resume'));
        completeResumeProviderCallDelta = readLines(path.join(workDir, 'acceptance-provider-calls.jsonl')).length - callsBeforeCompleteResume;
      }
    } else if (scenario === 'stale-action') {
      const checkpointFile = path.join(workDir, 'orchestration-state.json');
      const checkpointBefore = fs.readFileSync(checkpointFile);
      const originalCheckpointBackupRef = 'acceptance-stale-action-checkpoint-original.json';
      fs.writeFileSync(path.join(workDir, originalCheckpointBackupRef), checkpointBefore, { flag: 'wx' });
      const checkpointState = JSON.parse(checkpointBefore);
      const expectedOccurrenceId = initial.occurrenceId;
      const presentedOccurrenceId = `stale-${expectedOccurrenceId}`;
      const checkpointFaultState = { ...checkpointState, occurrenceId: presentedOccurrenceId };
      writeJson(checkpointFile, checkpointFaultState);
      const checkpointFaultBytes = fs.readFileSync(checkpointFile);
      const callsBeforeFault = readLines(path.join(workDir, 'acceptance-provider-calls.jsonl')).length;
      commands.push(run('stale-negative'));
      const faultResult = json(path.join(workDir, 'acceptance-compose-stale-negative.json'));
      const callsAfterFault = readLines(path.join(workDir, 'acceptance-provider-calls.jsonl')).length;
      const faultCheckpointObservation = observe(workDir);
      const negativeResult = {
        ok: faultResult?.ok ?? null,
        code: faultResult?.code ?? null,
        details: faultResult?.details ?? null,
      };
      fs.writeFileSync(checkpointFile, checkpointBefore);
      const checkpointRestored = fs.readFileSync(checkpointFile);
      const callsBeforeControl = readLines(path.join(workDir, 'acceptance-provider-calls.jsonl')).length;
      commands.push(run('stale-repaired'));
      const controlResult = json(path.join(workDir, 'acceptance-compose-stale-repaired.json'));
      const callsAfterControl = readLines(path.join(workDir, 'acceptance-provider-calls.jsonl')).length;
      const restoredState = json(checkpointFile);
      const restoredActions = json(path.join(workDir, 'targeted-requery-actions.json'));
      const originalCommitCount = (initial.actions?.targetedActions ?? []).reduce((n, action) => n + action.audit.filter(e => e.event === 'COMMIT').length, 0);
      const restoredCommitCount = (restoredActions?.targetedActions ?? []).reduce((n, action) => n + action.audit.filter(e => e.event === 'COMMIT').length, 0);
      fault = {
        kind: 'TEST_FAULT_STALE_COMPLETE_OCCURRENCE_CONTEXT',
        expectedOccurrenceId,
        presentedOccurrenceId,
        checkpointRef: 'work/orchestration-state.json',
        originalCheckpointBackupRef: `work/${originalCheckpointBackupRef}`,
        checkpointBeforeHash: hash(checkpointBefore),
        checkpointFaultHash: hash(checkpointFaultBytes),
        checkpointRestoredHash: hash(checkpointRestored),
        checkpointOriginalBytesRestored: hash(checkpointRestored) === hash(checkpointBefore),
        originalRunId: initial.runId,
        originalPlanId: initial.gaps?.planHash ?? initial.state?.hashes?.researchPlan ?? null,
      };
      const staleControlAudit = {
        schema: 'p2a-t14-stale-action-checker-control/v1',
        label: 'TEST_FAULT; audit only, never a product checkpoint or authority artifact',
        fault,
        productionCheckerResult: negativeResult,
        productionCheckerRejectedExpectedIdentityMismatch: negativeResult.ok === false && negativeResult.code === 'state_invalid'
          && String(negativeResult.details ?? '').includes('completed targeted action ledger is not checkpoint-bound to this occurrence'),
        callsBeforeFault,
        callsAfterFault,
        faultProviderCallDelta: callsAfterFault - callsBeforeFault,
        restorationControl: { result: controlResult, callsBefore: callsBeforeControl, callsAfter: callsAfterControl,
          providerCallDelta: callsAfterControl - callsBeforeControl,
          restoredOccurrenceId: restoredState?.occurrenceId ?? null,
          restoredCheckpointHash: hash(checkpointRestored), originalCommitCount, restoredCommitCount },
        faultObservation: { occurrenceId: faultCheckpointObservation.state?.occurrenceId ?? null,
          originalOccurrenceId: initial.occurrenceId,
          providerCallCount: faultCheckpointObservation.calls.length },
      };
      writeJson(path.join(workDir, 'acceptance-stale-action-control.json'), staleControlAudit);
      faultResultForRecord = faultResult;
      controlResultForRecord = controlResult;
      staleActionControlForRecord = staleControlAudit;
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
    } else if (['equivalent-query', 'per-gap-bound'].includes(scenario)) {
      controllerControls = await runControllerControls({ repo, workDir });
      commands.push(run('resume'));
    }
    const observed = observe(workDir);
    const result = scenario === 'stale-action'
      ? controlResultForRecord
      : json(path.join(workDir, `acceptance-compose-${commands.length > 1 ? (crash ? (completeResumeProviderCallDelta === null ? 'resume-again' : 'complete-resume') : controllerControls ? 'resume' : 'fault-resume') : 'initial'}.json`));
    const checks = [];
    let crashResolution = null;
    const check = (name, ok, actual = null, expected = null) => checks.push({ name, pass: !!ok, actual, expected });
    check('child execution', commands.every(c => c.error === null && (c.exitCode === 0 || (crash && c.signal === 'SIGKILL'))), commands);
    const initialCalls = initial.calls.filter(c => c.kind === 'targeted').length;
    const finalCalls = observed.calls.filter(c => c.kind === 'targeted').length;
    const noTargeted = ['free-form', 'unsafe-plan-owned', 'missing-unauthed-resolution', 'unknown-gap'].includes(scenario);
    const expectedTargetedCalls = noTargeted ? 0 : scenario === 'provider-scope' ? 1 : crash && scenario === 'crash-before' ? 4 : 2;
    const expectedProviderCalls = scenario === 'all-provider-failed' ? 6 : scenario === 'global-budget' ? 4 : crash && scenario === 'crash-framing-drift' ? 14 : crash && ['crash-resolution-input', 'crash-resolution-reverse'].includes(scenario) ? 8 : crash && ['crash-after', 'crash-before'].includes(scenario) ? 8 : scenario === 'provider-scope' ? 5 : scenario === 'unknown-gap' || ['free-form', 'unsafe-plan-owned', 'missing-unauthed-resolution'].includes(scenario) ? 4 : expectedTargetedCalls + 4;
    check('targeted provider calls', finalCalls === expectedTargetedCalls, finalCalls, expectedTargetedCalls);
    check('all provider calls', observed.calls.length === expectedProviderCalls, observed.calls.length, expectedProviderCalls);
    if (scenario === 'equivalent-query' || scenario === 'per-gap-bound') {
      const roundOne = (observed.gaps?.diagnosedGaps ?? []).filter(g => g.diagnosisRound === 1);
      const recordedCodes = (observed.actions?.rejected ?? []).map(r => r.rejectionCode);
      const wantedCode = scenario === 'equivalent-query' ? authorizationCodes.REJECTION_DEDUPE_ALREADY_AUTHORIZED : authorizationCodes.REJECTION_ATTEMPT_BOUND_EXCEEDED;
      const targetedEvents = observed.events.filter(e => /targeted.*(diagnos|proposal|decision|reject)/i.test(e.event ?? '') || e.diagnosisRound !== undefined);
      check('real composition round-1 proposal observed', roundOne.length > 0 && targetedEvents.some(e => e.diagnosisRound === 1), { gapRows: roundOne.length, events: targetedEvents }, 'round-1 controller trace');
      check('same core across diagnosis rounds', roundOne.length > 0 && roundOne.every(g => (observed.gaps?.diagnosedGaps ?? []).some(old => old.diagnosisRound === 0 && old.gapIdentityCore === g.gapIdentityCore)), roundOne.map(g => g.gapIdentityCore), 'round 0 core equality');
      check('different audit gap ids across rounds', roundOne.length > 0 && roundOne.every(g => (observed.gaps?.diagnosedGaps ?? []).some(old => old.diagnosisRound === 0 && old.gapIdentityCore === g.gapIdentityCore && old.gapId !== g.gapId)), roundOne.map(g => g.gapId), 'new audit suffix for same core');
      check('real controller rejection persisted', recordedCodes.includes(wantedCode), recordedCodes, wantedCode);
      check('rejected follow-up has zero provider delta', observed.calls.filter(c => c.kind === 'targeted').length === 2, observed.calls.filter(c => c.kind === 'targeted').length, 2);
    }
    if (scenario === 'unknown-gap') {
      const unknownReject = observed.events.some(e => e.event === 'targeted_diagnostic_validation' && e.status === 'REJECTED' && e.rejectionCode === 'UNKNOWN_GAP_TYPE');
      check('unknown rejected by composition', unknownReject, observed.events.filter(e => /unknown/i.test(e.event ?? '')), 'controller UNKNOWN_GAP_TYPE event');
      check('zero legal unknown gaps', (observed.gaps?.diagnosedGaps ?? []).every(g => GAP_TYPES.includes(g.gapType)), (observed.gaps?.diagnosedGaps ?? []).map(g => g.gapType), GAP_TYPES);
      check('zero targeted action delta', (observed.actions?.targetedActions ?? []).length === 0, observed.actions?.targetedActions?.length ?? null, 0);
      check('zero targeted provider delta', observed.calls.filter(c => c.kind === 'targeted').length === 0, observed.calls.filter(c => c.kind === 'targeted').length, 0);
    }
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
      check('budget bounds real IO', observed.calls.length === 4, observed.calls.length, 4);
      check('budget target literal', observed.calls.filter(c => c.kind === 'targeted').length === 2, observed.calls.filter(c => c.kind === 'targeted').length, 2);
      check('budget terminal honest', resolutions.some(r => r.status === 'EXHAUSTED_WITHIN_BUDGET')
        && !resolutions.some(r => r.status === 'SATURATED'));
      check('T07 budget STOP is recorded', observed.events.some(e => e.event === 'retrieval_feedback_loop_complete' && e.decision === 'BUDGET_STOP'), observed.events.filter(e => e.event === 'retrieval_feedback_loop_complete').map(e => e.decision), 'BUDGET_STOP');
      check('budget refuses next gap', (observed.actions?.rejected ?? []).some(r => r.rejectionCode === authorizationCodes.REJECTION_BUDGET_EXCEEDED));
    }
    if (scenario === 'per-gap-bound') check('per-gap terminal honest', resolutions.some(r => r.status === 'EXHAUSTED_WITHIN_BUDGET'));
    if (scenario === 'all-provider-failed') check('operational failure stays unresolved', observed.actions?.targetedActions?.[0]?.status === 'FAILED_OPERATIONAL'
      && resolutions.length === 1 && resolutions[0].status === 'UNRESOLVED');
    if (['free-form', 'unsafe-plan-owned', 'missing-unauthed-resolution'].includes(scenario)) check('rejected proposal recorded', (observed.actions?.rejected ?? []).length > 0);
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
      if (scenario === 'crash-resolution-input' || scenario === 'crash-resolution-reverse') {
        const originalPlannedIds = [...new Set(initial.calls.filter(c => c.kind === 'planned').flatMap(c => c.output?.items?.map(i => String(i.identity.questionId)) ?? []))].sort();
        const resumedPlannedIds = [...new Set(observed.calls.slice(initial.calls.length).filter(c => c.kind === 'planned').flatMap(c => c.output?.items?.map(i => String(i.identity.questionId)) ?? []))].sort();
        const targetIds = [...new Set(initial.calls.filter(c => c.kind === 'targeted').flatMap(c => c.output?.items?.map(i => String(i.identity.questionId)) ?? []))].sort();
        const expectedInput = scenario === 'crash-resolution-input';
        const expectedResolution = expectedInput ? ['UNRESOLVED', 'DUPLICATE_ONLY'] : ['RESOLVED', 'NEW_EVIDENCE_ATTRIBUTED'];
        const actualResolution = observed.resolution?.resolutions?.[0];
        const firstCommitted = initial.anchoredActions?.targetedActions?.[0];
        const inputAtCrash = initial.resolutionInputs?.find(input => input.targetedActionId === firstCommitted?.targetedActionId);
        const inputAtResume = observed.resolutionInputs?.find(input => input.targetedActionId === firstCommitted?.targetedActionId);
        const initialPlannedFacts = [...new Set(initial.calls.filter(c => c.kind === 'planned')
          .flatMap(c => c.output?.items?.map(i => String(i.identity.questionId)) ?? []))].sort();
        const targetedCall = initial.calls.find(c => c.kind === 'targeted'
          && c.authorizedActionsBeforeIo?.some(a => a.targetedActionId === firstCommitted?.targetedActionId));
        const snapshotShape = input => input?.snapshot
          && JSON.stringify(Object.keys(input.snapshot).sort()) === JSON.stringify([
            'coveredFramings', 'declaredFraming', 'occurrenceId', 'planHash', 'priorQuestionIds', 'schemaVersion', 'targetedActionId', 'type',
          ]) && input.snapshot.schemaVersion === 1 && input.snapshot.type === 'TargetedResolutionInput'
          && input.snapshot.targetedActionId === firstCommitted?.targetedActionId
          && input.snapshot.planHash === firstCommitted?.planHash && input.snapshot.occurrenceId === firstCommitted?.occurrenceId;
        const snapshotBoundBeforeIo = !!inputAtCrash && inputAtCrash.key === `targeted-resolution-input:${firstCommitted?.targetedActionId}`
          && /^[0-9a-f]{64}$/.test(inputAtCrash.bindingHash ?? '') && inputAtCrash.byteHash === inputAtCrash.bindingHash
          && snapshotShape(inputAtCrash) && targetedCall?.checkpointHashesBeforeIo?.[inputAtCrash.key] === inputAtCrash.bindingHash;
        const snapshotPriorIdsMatchProviderFacts = !!inputAtCrash
          && JSON.stringify(inputAtCrash.snapshot?.priorQuestionIds) === JSON.stringify(initialPlannedFacts);
        const snapshotRetainedAfterResume = !!inputAtCrash && !!inputAtResume
          && inputAtResume.bindingHash === inputAtCrash.bindingHash && inputAtResume.byteHash === inputAtCrash.byteHash
          && inputAtResume.bytesHex === inputAtCrash.bytesHex && snapshotShape(inputAtResume)
          && json(path.join(workDir, 'acceptance-compose-complete-resume.json'))?.ok === true
          && json(path.join(workDir, 'acceptance-compose-complete-resume.json'))?.reused === true
          && completeResumeProviderCallDelta === 0 && initial.occurrenceId === observed.occurrenceId;
        crashResolution = {
          originalPlannedIds, resumePlannedIds: resumedPlannedIds, targetedIds: targetIds,
          targetedProviderCallDelta: finalCalls - initialCalls,
          resolutionStatus: actualResolution?.status ?? null, resolutionBasis: actualResolution?.resolutionBasis ?? null,
          commitCount: firstCommitted?.audit?.filter(e => e.event === 'COMMIT').length ?? 0,
          artifactHash: firstCommitted?.artifactHash ?? null,
          initialBindingHash: initial.state?.hashes?.[firstCommitted?.bindingKey] ?? null,
          finalBindingHash: observed.state?.hashes?.[firstCommitted?.bindingKey] ?? null,
          initialBindingValid: !!firstCommitted && initial.state?.hashes?.[firstCommitted.bindingKey] === firstCommitted.artifactHash,
          finalBindingValid: !!firstCommitted && observed.state?.hashes?.[firstCommitted.bindingKey] === firstCommitted.artifactHash,
          resolutionInput: { key: inputAtCrash?.key ?? null, bindingHash: inputAtCrash?.bindingHash ?? null,
            byteHash: inputAtCrash?.byteHash ?? null, byteLength: inputAtCrash?.byteLength ?? null,
            priorQuestionIds: inputAtCrash?.snapshot?.priorQuestionIds ?? null,
            declaredFraming: inputAtCrash?.snapshot?.declaredFraming ?? null,
            coveredFramings: inputAtCrash?.snapshot?.coveredFramings ?? null,
            preIoCheckpointBindingValid: !!snapshotBoundBeforeIo, priorIdsMatchInitialProviderFacts: snapshotPriorIdsMatchProviderFacts,
            retainedHashAndBytesOnCompleteResume: snapshotRetainedAfterResume },
        };
        check('original and resume planned ids drift bidirectionally', expectedInput
          ? originalPlannedIds.includes('300') && !resumedPlannedIds.includes('300') && resumedPlannedIds.includes('100')
          : !originalPlannedIds.includes('300') && resumedPlannedIds.includes('300'), { originalPlannedIds, resumedPlannedIds }, expectedInput ? 'prior includes 300; resume excludes 300 and includes 100' : 'prior excludes 300; resume includes 300');
        check('targeted provider delta is zero', finalCalls - initialCalls === 0, finalCalls - initialCalls, 0);
        check('T08 preserves crash-time classification', actualResolution?.status === expectedResolution[0] && actualResolution?.resolutionBasis === expectedResolution[1],
          { status: actualResolution?.status ?? null, basis: actualResolution?.resolutionBasis ?? null }, expectedResolution);
        check('one checkpoint-anchored COMMIT with valid result hash', !!firstCommitted && firstCommitted.status === 'COMMITTED'
          && firstCommitted.audit.filter(e => e.event === 'COMMIT').length === 1
          && /^[0-9a-f]{64}$/.test(firstCommitted.artifactHash ?? '')
          && initial.state?.hashes?.[firstCommitted.bindingKey] === firstCommitted.artifactHash
          && observed.state?.hashes?.[firstCommitted.bindingKey] === firstCommitted.artifactHash,
        { status: firstCommitted?.status ?? null, commits: firstCommitted?.audit?.filter(e => e.event === 'COMMIT').length ?? null,
          artifactHash: firstCommitted?.artifactHash ?? null, initialBinding: initial.state?.hashes?.[firstCommitted?.bindingKey] ?? null,
          finalBinding: observed.state?.hashes?.[firstCommitted?.bindingKey] ?? null }, 'one COMMIT and checkpoint-bound result hash');
        check('original T08 snapshot bound before provider IO', snapshotBoundBeforeIo, crashResolution.resolutionInput,
          'exact action key, valid resolver bytes/hash, action scope, pre-IO checkpoint hash');
        check('snapshot prior IDs match initial provider facts', snapshotPriorIdsMatchProviderFacts,
          { snapshot: inputAtCrash?.snapshot?.priorQuestionIds ?? null, initialPlannedFacts }, initialPlannedFacts);
        check('snapshot bytes and hash survive COMPLETE ordinary resume', snapshotRetainedAfterResume,
          { initialHash: inputAtCrash?.byteHash ?? null, resumedHash: inputAtResume?.byteHash ?? null,
            byteIdentical: inputAtResume?.bytesHex === inputAtCrash?.bytesHex,
            completeResumeResult: json(path.join(workDir, 'acceptance-compose-complete-resume.json')) ?? null,
            providerCallDelta: completeResumeProviderCallDelta, sameOccurrence: initial.occurrenceId === observed.occurrenceId },
          'same valid content hash and bytes after COMPLETE reused same-occurrence call with zero provider delta');
      }
      if (scenario === 'crash-framing-drift') {
        const firstCommitted = initial.anchoredActions?.targetedActions?.[0];
        const anchoredGap = initial.gaps?.diagnosedGaps?.find(gap => gap.gapId === firstCommitted?.gapId);
        const inputAtCrash = initial.resolutionInputs?.find(input => input.targetedActionId === firstCommitted?.targetedActionId);
        const inputAtResume = observed.resolutionInputs?.find(input => input.targetedActionId === firstCommitted?.targetedActionId);
        const plannedFacts = [...new Set(initial.calls.filter(c => c.kind === 'planned' && c.output?.ok)
          .flatMap(c => c.output.items?.map(i => String(i.identity.questionId)) ?? []))].sort();
        const targetedCall = initial.calls.find(c => c.kind === 'targeted'
          && c.authorizedActionsBeforeIo?.some(a => a.targetedActionId === firstCommitted?.targetedActionId));
        const callbackEvidence = observed.acceptanceEvents.filter(e => e.event === 'framing_proposal_callback');
        const resumedCallback = callbackEvidence.find(e => e.phase === 'resume');
        const targetResolution = observed.resolution?.resolutions?.find(r => r.evaluatedActionIds?.includes(firstCommitted?.targetedActionId));
        const exactSnapshotShape = !!inputAtCrash?.snapshot
          && JSON.stringify(Object.keys(inputAtCrash.snapshot).sort()) === JSON.stringify([
            'coveredFramings', 'declaredFraming', 'occurrenceId', 'planHash', 'priorQuestionIds', 'schemaVersion', 'targetedActionId', 'type',
          ]) && inputAtCrash.snapshot.schemaVersion === 1 && inputAtCrash.snapshot.type === 'TargetedResolutionInput';
        const preIoBound = !!inputAtCrash && inputAtCrash.key === `targeted-resolution-input:${firstCommitted?.targetedActionId}`
          && /^[0-9a-f]{64}$/.test(inputAtCrash.bindingHash ?? '') && inputAtCrash.bindingHash === inputAtCrash.byteHash
          && targetedCall?.checkpointHashesBeforeIo?.[inputAtCrash.key] === inputAtCrash.bindingHash
          && exactSnapshotShape
          && inputAtCrash.snapshot?.targetedActionId === firstCommitted?.targetedActionId
          && inputAtCrash.snapshot?.planHash === firstCommitted?.planHash
          && inputAtCrash.snapshot?.occurrenceId === firstCommitted?.occurrenceId;
        const priorFactsMatch = !!inputAtCrash && JSON.stringify(inputAtCrash.snapshot?.priorQuestionIds) === JSON.stringify(plannedFacts);
        const retained = !!inputAtCrash && !!inputAtResume && inputAtCrash.byteHash === inputAtResume.byteHash
          && inputAtCrash.bytesHex === inputAtResume.bytesHex && inputAtResume.bindingHash === inputAtCrash.bindingHash
          && json(path.join(workDir, 'acceptance-compose-complete-resume.json'))?.ok === true
          && json(path.join(workDir, 'acceptance-compose-complete-resume.json'))?.reused === true
          && completeResumeProviderCallDelta === 0 && initial.occurrenceId === observed.occurrenceId;
        const initialQueries = new Map(initial.calls.filter(c => c.kind === 'planned').map(c => [c.query, c.output?.ok === true]));
        const resumedQueries = new Map(observed.calls.slice(initial.calls.length).filter(c => c.kind === 'planned').map(c => [c.query, c.output?.ok === true]));
        const initialTargetIds = [...new Set(initial.calls.filter(c => c.kind === 'targeted')
          .flatMap(c => c.output?.items?.map(i => String(i.identity.questionId)) ?? []))].sort();
        const resumeTargetCalls = observed.calls.slice(initial.calls.length).filter(c => c.kind === 'targeted').length;
        const feedbackStops = observed.events.filter(e => e.event === 'retrieval_feedback_loop_complete');
        const oneCommit = firstCommitted?.status === 'COMMITTED' && firstCommitted.audit.filter(e => e.event === 'COMMIT').length === 1
          && /^[0-9a-f]{64}$/.test(firstCommitted.artifactHash ?? '')
          && initial.state?.hashes?.[firstCommitted.bindingKey] === firstCommitted.artifactHash
          && observed.state?.hashes?.[firstCommitted.bindingKey] === firstCommitted.artifactHash;
        crashResolution = { originalPlannedIds: plannedFacts, resumePlannedIds: [...new Set(observed.calls.slice(initial.calls.length)
          .filter(c => c.kind === 'planned' && c.output?.ok).flatMap(c => c.output.items?.map(i => String(i.identity.questionId)) ?? []))].sort(),
          targetedIds: initialTargetIds, targetedProviderCallDelta: resumeTargetCalls,
          gapType: anchoredGap?.gapType ?? null, subjectKey: anchoredGap?.subjectKey ?? null,
          resolutionStatus: targetResolution?.status ?? null, resolutionBasis: targetResolution?.resolutionBasis ?? null,
          commitCount: firstCommitted?.audit?.filter(e => e.event === 'COMMIT').length ?? 0,
          artifactHash: firstCommitted?.artifactHash ?? null,
          initialBindingValid: !!firstCommitted && initial.state?.hashes?.[firstCommitted.bindingKey] === firstCommitted.artifactHash,
          finalBindingValid: !!firstCommitted && observed.state?.hashes?.[firstCommitted.bindingKey] === firstCommitted.artifactHash,
          resolutionInput: { key: inputAtCrash?.key ?? null, bindingHash: inputAtCrash?.bindingHash ?? null,
            byteHash: inputAtCrash?.byteHash ?? null, byteLength: inputAtCrash?.byteLength ?? null,
            priorQuestionIds: inputAtCrash?.snapshot?.priorQuestionIds ?? null,
            declaredFraming: inputAtCrash?.snapshot?.declaredFraming ?? null,
            coveredFramings: inputAtCrash?.snapshot?.coveredFramings ?? null,
            preIoCheckpointBindingValid: preIoBound, priorIdsMatchInitialProviderFacts: priorFactsMatch,
            retainedHashAndBytesOnCompleteResume: retained },
          resumedProposal: resumedCallback ?? null };
        check('framing provider coverage drifts across crash and resume', initialQueries.get('framing-a') === false
          && initialQueries.get('framing-b') === true && resumedQueries.get('framing-a') === true && resumedQueries.get('framing-b') === false,
        { initial: Object.fromEntries(initialQueries), resume: Object.fromEntries(resumedQueries) },
        { initial: { 'framing-a': false, 'framing-b': true }, resume: { 'framing-a': true, 'framing-b': false } });
        check('framing targeted result is new evidence', initialTargetIds.includes('300') && initialTargetIds.length === 1,
          initialTargetIds, ['300']);
        check('framing action anchors the intended contradiction gap', anchoredGap?.gapType === 'CONTRADICTION_GAP'
          && anchoredGap?.subjectKey === 'opposing:framing-a' && firstCommitted?.gapId === anchoredGap?.gapId,
        { gapType: anchoredGap?.gapType ?? null, subjectKey: anchoredGap?.subjectKey ?? null, actionGapId: firstCommitted?.gapId ?? null },
        { gapType: 'CONTRADICTION_GAP', subjectKey: 'opposing:framing-a' });
        check('framing T08 uses original snapshot classification', targetResolution?.status === 'RESOLVED'
          && targetResolution?.resolutionBasis === 'OPPOSING_SIDE_NEW_EVIDENCE'
          && JSON.stringify(targetResolution?.resolutionEvidence) === JSON.stringify(['300'])
          && inputAtCrash?.snapshot?.declaredFraming === 'framing-a'
          && JSON.stringify(inputAtCrash?.snapshot?.coveredFramings) === JSON.stringify(['framing-b']),
        { status: targetResolution?.status ?? null, basis: targetResolution?.resolutionBasis ?? null,
          evidence: targetResolution?.resolutionEvidence ?? null, declared: inputAtCrash?.snapshot?.declaredFraming ?? null,
          covered: inputAtCrash?.snapshot?.coveredFramings ?? null },
        { status: 'RESOLVED', basis: 'OPPOSING_SIDE_NEW_EVIDENCE', evidence: ['300'], declared: 'framing-a', covered: ['framing-b'] });
        check('framing targeted resume delta is zero', resumeTargetCalls === 0, resumeTargetCalls, 0);
        check('framing resume proposal only references prior anchored gap', !!resumedCallback
          && resumedCallback.anchoredPriorGapId === firstCommitted?.gapId
          && resumedCallback.proposals?.length === 1 && resumedCallback.proposals[0]?.gapId === firstCommitted?.gapId,
        resumedCallback ?? null, firstCommitted?.gapId);
        check('framing snapshot bound before provider IO', preIoBound, crashResolution.resolutionInput, 'valid resolver bytes/hash and pre-IO checkpoint key');
        check('framing snapshot prior IDs match initial provider facts', priorFactsMatch,
          { snapshot: inputAtCrash?.snapshot?.priorQuestionIds ?? null, providerFacts: plannedFacts }, plannedFacts);
        check('framing snapshot survives COMPLETE ordinary resume', retained,
          { originalHash: inputAtCrash?.byteHash ?? null, resumedHash: inputAtResume?.byteHash ?? null,
            bytesEqual: inputAtCrash?.bytesHex === inputAtResume?.bytesHex,
            completeResumeResult: json(path.join(workDir, 'acceptance-compose-complete-resume.json')) ?? null,
            providerCallDelta: completeResumeProviderCallDelta, sameOccurrence: initial.occurrenceId === observed.occurrenceId },
          'same hash and bytes after COMPLETE reused same-occurrence call with zero provider delta');
        check('framing feedback loop has actual budget STOP', feedbackStops.some(e => e.decision === 'BUDGET_STOP'
          && e.stopReason === 'query_budget_exhausted'), feedbackStops.map(e => ({ decision: e.decision, stopReason: e.stopReason, rounds: e.rounds })),
        'actual T07 BUDGET_STOP/query_budget_exhausted event');
        check('framing has one anchored COMMIT', oneCommit, { status: firstCommitted?.status ?? null,
          commits: firstCommitted?.audit?.filter(e => e.event === 'COMMIT').length ?? null,
          artifactHash: firstCommitted?.artifactHash ?? null }, 'COMMITTED, one COMMIT, initial/final checkpoint hash match');
      }
    }
    if (refusal) {
      check('tampered committed product refused', result?.ok === false && result?.reused !== true, result);
      check('fault does not pay again', observed.calls.length === initial.calls.length);
    }
    if (scenario === 'stale-action') {
      check('stale action occurrence checker refuses', staleActionControlForRecord?.productionCheckerRejectedExpectedIdentityMismatch === true,
        staleActionControlForRecord?.productionCheckerResult ?? null,
        { code: 'state_invalid', detailsIncludes: 'completed targeted action ledger is not checkpoint-bound to this occurrence' });
      check('stale action negative has zero provider delta', staleActionControlForRecord?.faultProviderCallDelta === 0,
        staleActionControlForRecord?.faultProviderCallDelta ?? null, 0);
      check('stale action restored checkpoint control reuses at zero IO', staleActionControlForRecord?.restorationControl?.result?.ok === true
        && staleActionControlForRecord?.restorationControl?.result?.reused === true
        && staleActionControlForRecord?.restorationControl?.providerCallDelta === 0,
      staleActionControlForRecord?.restorationControl ?? null, { ok: true, reused: true, providerCallDelta: 0 });
      check('stale action checkpoint bytes restored', staleActionControlForRecord?.fault?.checkpointOriginalBytesRestored === true
        && staleActionControlForRecord?.fault?.expectedOccurrenceId === observed.occurrenceId
        && staleActionControlForRecord?.fault?.presentedOccurrenceId !== observed.occurrenceId,
      staleActionControlForRecord?.fault ?? null, 'original occurrence restored; only checkpoint occurrence context faulted');
      check('stale action does not pay again or duplicate COMMIT', finalCalls === initialCalls
        && staleActionControlForRecord?.restorationControl?.originalCommitCount === 1
        && staleActionControlForRecord?.restorationControl?.restoredCommitCount === 1,
      { targetedCallsInitial: initialCalls, targetedCallsFinal: finalCalls,
        originalCommits: staleActionControlForRecord?.restorationControl?.originalCommitCount,
        restoredCommits: staleActionControlForRecord?.restorationControl?.restoredCommitCount },
      { targetedCallsDelta: 0, commits: 1 });
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
      initialTargetedProviderCallCount: initialCalls, replay, fault, controllerControls, crashResolution, checks, lineage,
      ...(scenario === 'stale-action' ? { faultResult: faultResultForRecord, controlResult: controlResultForRecord,
        staleActionControl: staleActionControlForRecord } : {}),
      result, verdict: checks.every(c => c.pass) ? 'PASS' : 'FAIL',
    };
    writeJson(path.join(scenarioDir, 'final-observation.json'), observed);
    writeJson(path.join(scenarioDir, 'evidence.json'), record);
    records.push(record);
    console.log(`${scenario}: ${record.verdict}; provider=${observed.calls.length}; targeted=${finalCalls}; failing=${checks.filter(c => !c.pass).map(c => c.name).join(', ')}`);
  }
  const campaign = { schema: 'p2a-t14-acceptance-campaign/v1', exactRepoSha: exactSha, sourceDirty,
    campaignCommand: `node research-orchestration/scripts/p2a-t14/driver.mjs --repo <repository-root> --out <fresh-output-dir> --expected-head ${exactSha}`,
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
