#!/usr/bin/env node
// Draft §20 matrix compiler. Input verdicts remain authoritative; this never issues a review receipt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPECS = [
  { item: '§20-1', principal: 'unknown-gap', checks: ['unknown rejected by composition', 'zero legal unknown gaps', 'zero targeted action delta', 'zero targeted provider delta'], controls: [{ id: 'canonical', checks: ['evidence resolution', 'controller before targeted IO'] }] },
  { item: '§20-2', principal: 'canonical', checks: ['bidirectional lineage'], requireLineage: true, controls: [{ id: 'unknown-gap', checks: ['controller before targeted IO'] }, { id: 'free-form', checks: ['controller before targeted IO'] }] },
  { item: '§20-3', principal: 'free-form', checks: ['controller before targeted IO', 'rejected proposal recorded'], controls: [{ id: 'unsafe-plan-owned', checks: ['controller before targeted IO', 'rejected proposal recorded'] }], requireZeroTargeted: true },
  { item: '§20-4', principal: 'canonical', checks: ['all provider calls', 'bidirectional lineage'], requireLineage: true, controls: [{ id: 'provider-scope', checks: ['no runtime or provider fallback'] }] },
  { item: '§20-5', principal: 'provider-scope', checks: ['no runtime or provider fallback', 'all provider calls'], controls: [{ id: 'canonical', checks: ['no runtime or provider fallback'] }, { id: 'all-provider-failed', checks: ['no runtime or provider fallback'] }] },
  { item: '§20-6', principal: 'equivalent-query', checks: ['real composition round-1 proposal observed', 'same core across diagnosis rounds', 'different audit gap ids across rounds', 'real controller rejection persisted', 'rejected follow-up has zero provider delta'], controls: [{ id: 'equivalent-query', checks: ['equivalent completed replay zero IO'] }] },
  { item: '§20-7', principal: 'per-gap-bound', checks: ['real composition round-1 proposal observed', 'real controller rejection persisted', 'rejected follow-up has zero provider delta'], controls: [{ id: 'global-budget', checks: ['budget bounds real IO', 'budget target literal', 'budget terminal honest', 'budget refuses next gap'] }] },
  { item: '§20-8', principal: 'canonical', checks: ['evidence resolution'], requireLineage: true, controls: [{ id: 'duplicate-only', checks: ['duplicate-only unresolved'] }, { id: 'crash-resolution-input', checks: ['original and resume planned ids drift bidirectionally', 'targeted provider delta is zero', 'T08 preserves crash-time classification', 'one checkpoint-anchored COMMIT with valid result hash', 'original T08 snapshot bound before provider IO', 'snapshot prior IDs match initial provider facts', 'snapshot bytes and hash survive COMPLETE ordinary resume'] }, { id: 'crash-resolution-reverse', checks: ['original and resume planned ids drift bidirectionally', 'targeted provider delta is zero', 'T08 preserves crash-time classification', 'one checkpoint-anchored COMMIT with valid result hash', 'original T08 snapshot bound before provider IO', 'snapshot prior IDs match initial provider facts', 'snapshot bytes and hash survive COMPLETE ordinary resume'] }, { id: 'crash-framing-drift', checks: ['framing provider coverage drifts across crash and resume', 'framing targeted result is new evidence', 'framing action anchors the intended contradiction gap', 'framing T08 uses original snapshot classification', 'framing targeted resume delta is zero', 'framing resume proposal only references prior anchored gap', 'framing snapshot bound before provider IO', 'framing snapshot prior IDs match initial provider facts', 'framing snapshot survives COMPLETE ordinary resume', 'framing feedback loop has actual budget STOP', 'framing has one anchored COMMIT'] }, { id: 'contradiction-one-side', checks: ['one-sided does not resolve'] }, { id: 'authority-unavailable', checks: ['no authority predicate'] }] },
  { item: '§20-9', principal: 'canonical', checks: ['all durable gaps visible', 'bidirectional lineage'], requireLineage: true, controls: [{ id: 'duplicate-only', checks: ['all durable gaps visible', 'duplicate-only unresolved'] }, { id: 'authority-unavailable', checks: ['all durable gaps visible', 'no authority predicate'] }] },
  { item: '§20-10', principal: 'crash-after', checks: ['same occurrence resumes', 'real kill at window', 'resume paid IO delta', 'one durable COMMIT', 'commit window checkpoint matches kill', 'final pool hash matches binding', 'replay decision'], controls: [{ id: 'crash-before', checks: ['same occurrence resumes', 'real kill at window', 'resume paid IO delta', 'one durable COMMIT', 'replay decision'] }, { id: 'crash-resolution-input', checks: ['same occurrence resumes', 'real kill at window', 'resume paid IO delta', 'one durable COMMIT', 'commit window checkpoint matches kill', 'final pool hash matches binding', 'replay decision', 'original and resume planned ids drift bidirectionally', 'targeted provider delta is zero', 'T08 preserves crash-time classification', 'one checkpoint-anchored COMMIT with valid result hash', 'original T08 snapshot bound before provider IO', 'snapshot prior IDs match initial provider facts', 'snapshot bytes and hash survive COMPLETE ordinary resume'] }, { id: 'crash-resolution-reverse', checks: ['same occurrence resumes', 'real kill at window', 'resume paid IO delta', 'one durable COMMIT', 'commit window checkpoint matches kill', 'final pool hash matches binding', 'replay decision', 'original and resume planned ids drift bidirectionally', 'targeted provider delta is zero', 'T08 preserves crash-time classification', 'one checkpoint-anchored COMMIT with valid result hash', 'original T08 snapshot bound before provider IO', 'snapshot prior IDs match initial provider facts', 'snapshot bytes and hash survive COMPLETE ordinary resume'] }, { id: 'crash-framing-drift', checks: ['same occurrence resumes', 'real kill at window', 'resume paid IO delta', 'one durable COMMIT', 'commit window checkpoint matches kill', 'final pool hash matches binding', 'replay decision', 'framing provider coverage drifts across crash and resume', 'framing targeted result is new evidence', 'framing action anchors the intended contradiction gap', 'framing T08 uses original snapshot classification', 'framing targeted resume delta is zero', 'framing resume proposal only references prior anchored gap', 'framing snapshot bound before provider IO', 'framing snapshot prior IDs match initial provider facts', 'framing snapshot survives COMPLETE ordinary resume', 'framing feedback loop has actual budget STOP', 'framing has one anchored COMMIT'] }] },
  { item: '§20-11', principal: 'canonical', checks: ['bidirectional lineage'], requireLineage: true, controls: [{ id: 'tampered-pool', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'stale-binding', checks: ['tampered committed product refused', 'fault does not pay again'] }] },
  { item: '§20-12', principal: 'stale-action', checks: ['stale action occurrence checker refuses', 'stale action negative has zero provider delta', 'stale action restored checkpoint control reuses at zero IO', 'stale action checkpoint bytes restored', 'stale action does not pay again or duplicate COMMIT', 'bidirectional lineage'], controls: [{ id: 'stale-binding', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'tampered-pool', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'equivalent-query', checks: ['equivalent completed replay zero IO'] }, { id: 'missing-resolution', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'tampered-resolution', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'foreign-resolution', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'canonical-ledger-drift', checks: ['canonical ledger is not a replay credential', 'bidirectional lineage'] }] },
];

const findCheck = (scenario, name) => scenario?.checks?.find(c => c.name === name);
const passed = (scenario, names) => names.every(name => findCheck(scenario, name)?.pass === true);
const portableRefs = refs => (refs ?? []).map(a => ({ path: a.path ?? 'UNKNOWN', sha256: a.sha256 ?? 'UNKNOWN', bytes: a.bytes ?? 'UNKNOWN' }));
const fieldsComplete = (scenario, campaign) => !!scenario
  && scenario.exactRepoSha === campaign.exactRepoSha && /^[0-9a-f]{40}$/.test(scenario.exactRepoSha)
  && Array.isArray(scenario.sourceDirty) && scenario.sourceDirty.length === 0
  && ['runId', 'occurrenceId', 'planId', 'generation'].every(key => typeof scenario[key] === 'string' && scenario[key] !== 'UNKNOWN' && scenario[key].length > 0)
  && Array.isArray(scenario.commands) && scenario.commands.length > 0 && scenario.commands.every(c => c.command && Number.isInteger(c.exitCode))
  && !!scenario.lineage && typeof scenario.lineage.valid === 'boolean'
  && Array.isArray(scenario.lineage.joins) && Array.isArray(scenario.lineage.failures)
  && ['inputArtifacts', 'outputArtifacts'].every(key => Array.isArray(scenario[key]) && scenario[key].length > 0
    && scenario[key].every(ref => typeof ref.path === 'string' && !path.isAbsolute(ref.path)
      && !ref.path.split(/[\\/]/).includes('..') && /^[0-9a-f]{64}$/.test(ref.sha256)))
  && ['observedProviderCallCount', 'expectedProviderCallCount', 'observedTargetedProviderCallCount', 'expectedTargetedProviderCallCount']
    .every(key => Number.isInteger(scenario[key]) && scenario[key] >= 0);

const providerCountsMatch = scenario => !!scenario
  && scenario.observedProviderCallCount === scenario.expectedProviderCallCount
  && scenario.observedTargetedProviderCallCount === scenario.expectedTargetedProviderCallCount;

const commandStatusesValid = scenario => {
  if (!scenario || !Array.isArray(scenario.commands) || scenario.commands.length === 0) return false;
  const isCrashWindow = ['crash-before', 'crash-after', 'crash-resolution-input', 'crash-resolution-reverse', 'crash-framing-drift'].includes(scenario.scenarioId);
  return scenario.commands.every((command, index) => {
    if (!command || command.error !== null || !Number.isInteger(command.exitCode)) return false;
    if (isCrashWindow && index === 0 && command.signal !== 'SIGKILL') return false;
    if (command.signal === 'SIGKILL') {
      const expectedCrashPoint = scenario.scenarioId === 'crash-before' ? 'after_targeted_execution'
        : ['crash-after', 'crash-resolution-input', 'crash-resolution-reverse', 'crash-framing-drift'].includes(scenario.scenarioId) ? 'after_targeted_commit_finalize' : null;
      return isCrashWindow && index === 0 && command.exitCode === 137
        && (command.command ?? '').includes(`--child ${scenario.scenarioId} `)
        && (command.command ?? '').includes(`--expected-head ${scenario.exactRepoSha}`)
        && (command.command ?? '').includes('--phase initial')
        && (command.command ?? '').includes(`--crash ${expectedCrashPoint}`);
    }
    return command.signal == null && command.exitCode === 0;
  });
};

const lineageState = scenario => {
  if (!scenario || !Object.hasOwn(scenario, 'lineage') || !scenario.lineage || typeof scenario.lineage !== 'object'
    || typeof scenario.lineage.valid !== 'boolean' || !Array.isArray(scenario.lineage.joins)
    || !Array.isArray(scenario.lineage.failures)) return 'NOT_PROVEN';
  return scenario.lineage.valid === true && scenario.lineage.failures.length === 0 ? 'PASS' : 'FAIL';
};
const requiredLineageState = scenario => {
  const state = lineageState(scenario);
  if (state !== 'PASS') return state;
  if (scenario.observedTargetedProviderCallCount > 0 && scenario.lineage.joins.length === 0) return 'FAIL';
  return 'PASS';
};

const staleActionEvidence = scenario => {
  const audit = scenario?.staleActionControl;
  const fault = audit?.fault;
  const restoration = audit?.restorationControl;
  const checkResult = audit?.productionCheckerResult;
  const restoredResult = restoration?.result;
  const rawFault = scenario?.faultResult;
  const rawControl = scenario?.controlResult;
  const valid = rawFault?.ok === false && rawFault.code === 'state_invalid'
    && typeof rawFault.details === 'string' && rawFault.details.includes('completed targeted action ledger is not checkpoint-bound to this occurrence')
    && rawControl?.ok === true && rawControl.reused === true
    && rawControl.runId === scenario.runId && rawControl.planHash === scenario.planId
    && audit?.schema === 'p2a-t14-stale-action-checker-control/v1'
    && audit?.label === 'TEST_FAULT; audit only, never a product checkpoint or authority artifact'
    && checkResult?.ok === false && checkResult.code === rawFault.code && checkResult.details === rawFault.details
    && audit.productionCheckerRejectedExpectedIdentityMismatch === true
    && fault?.kind === 'TEST_FAULT_STALE_COMPLETE_OCCURRENCE_CONTEXT'
    && fault.expectedOccurrenceId === scenario.occurrenceId && typeof fault.presentedOccurrenceId === 'string'
    && fault.presentedOccurrenceId.length > 0 && fault.presentedOccurrenceId !== scenario.occurrenceId
    && fault.originalRunId === scenario.runId && fault.originalPlanId === scenario.planId
    && fault.checkpointOriginalBytesRestored === true
    && /^[0-9a-f]{64}$/.test(fault.checkpointBeforeHash ?? '')
    && fault.checkpointBeforeHash === fault.checkpointRestoredHash
    && fault.checkpointBeforeHash !== fault.checkpointFaultHash
    && /^[0-9a-f]{64}$/.test(fault.checkpointFaultHash ?? '')
    && audit.faultProviderCallDelta === 0 && audit.callsAfterFault === audit.callsBeforeFault
    && restoredResult?.ok === true && restoredResult.reused === true
    && restoration.providerCallDelta === 0 && restoration.callsAfter === restoration.callsBefore
    && restoration.restoredOccurrenceId === scenario.occurrenceId
    && restoration.restoredCheckpointHash === fault.checkpointBeforeHash
    && restoration.originalCommitCount === 1 && restoration.restoredCommitCount === 1
    && audit.faultObservation?.occurrenceId === fault.presentedOccurrenceId
    && audit.faultObservation?.originalOccurrenceId === scenario.occurrenceId
    && scenario.observedTargetedProviderCallCount === 2 && scenario.expectedTargetedProviderCallCount === 2
    && scenario.observedProviderCallCount === 6 && scenario.expectedProviderCallCount === 6;
  return { valid, faultResult: rawFault ?? 'NOT_PROVEN', controlResult: rawControl ? {
    ok: rawControl.ok, reused: rawControl.reused, runId: rawControl.runId, planHash: rawControl.planHash,
  } : 'NOT_PROVEN', rejectionReason: rawFault?.details ?? 'NOT_PROVEN', faultProviderCallDelta: audit?.faultProviderCallDelta ?? 'NOT_PROVEN',
  expectedOccurrenceId: fault?.expectedOccurrenceId ?? 'NOT_PROVEN', presentedOccurrenceId: fault?.presentedOccurrenceId ?? 'NOT_PROVEN',
  checkpointBeforeHash: fault?.checkpointBeforeHash ?? 'NOT_PROVEN', checkpointFaultHash: fault?.checkpointFaultHash ?? 'NOT_PROVEN',
  checkpointRestoredHash: fault?.checkpointRestoredHash ?? 'NOT_PROVEN', restorationProviderCallDelta: restoration?.providerCallDelta ?? 'NOT_PROVEN',
  originalCommitCount: restoration?.originalCommitCount ?? 'NOT_PROVEN', restoredCommitCount: restoration?.restoredCommitCount ?? 'NOT_PROVEN' };
};

export function buildMatrix(campaign) {
  const scenarios = new Map((campaign?.scenarios ?? []).map(s => [s.scenarioId, s]));
  const rows = SPECS.map(spec => {
    const principal = scenarios.get(spec.principal);
    const controls = (spec.controls ?? []).map(ref => ({ ...ref, scenario: scenarios.get(ref.id) }));
    const principalChecksOk = !!principal && (!spec.checks || passed(principal, spec.checks));
    const controlsOk = controls.length === (spec.controls ?? []).length && controls.every(c => c.scenario && passed(c.scenario, c.checks));
    const zeroCallOk = !spec.requireZeroTargeted || (principal?.observedTargetedProviderCallCount === 0 && principal?.expectedTargetedProviderCallCount === 0);
    const scenarioVerdictsOk = !!principal && principal.verdict === 'PASS' && controls.every(c => c.scenario?.verdict === 'PASS');
    const participatingRuns = [principal, ...controls.map(c => c.scenario)];
    const fieldsOk = fieldsComplete(principal, campaign) && controls.every(c => fieldsComplete(c.scenario, campaign));
    const countsOk = participatingRuns.every(providerCountsMatch);
    const commandsOk = participatingRuns.every(commandStatusesValid);
    const staleEvidence = spec.principal === 'stale-action' ? staleActionEvidence(principal) : null;
    const principalLineageRequired = !!spec.requireLineage || (spec.checks ?? []).includes('bidirectional lineage');
    const participantsLineage = participatingRuns.map((scenario, index) => ({
      scenario,
      required: index === 0 ? principalLineageRequired : (controls[index - 1]?.checks ?? []).includes('bidirectional lineage'),
    }));
    const lineageStatuses = participantsLineage.map(entry => entry.required
      ? requiredLineageState(entry.scenario) : 'PASS');
    const lineage = requiredLineageState(principal);
    const lineageOk = lineageStatuses.every(status => status === 'PASS');
    const hardFailure = participatingRuns.some(s => s && s.verdict !== 'PASS')
      || participatingRuns.some(s => s && !providerCountsMatch(s))
      || participatingRuns.some(s => s && !commandStatusesValid(s))
      || (staleEvidence && !staleEvidence.valid)
      || lineageStatuses.some((status, index) => participantsLineage[index].required && status === 'FAIL');
    const verdict = hardFailure ? 'FAIL' : !fieldsOk || !lineageOk ? 'NOT_PROVEN'
      : principalChecksOk && controlsOk && zeroCallOk && scenarioVerdictsOk && countsOk && commandsOk ? 'PASS' : 'FAIL';
    const inputRefs = portableRefs(principal?.inputArtifacts);
    const outputRefs = portableRefs(principal?.outputArtifacts);
    return {
      specItem: spec.item,
      scenarioId: spec.principal,
      verdict,
      reason: spec.why ?? (verdict === 'PASS' ? 'Required principal and negative-control checks passed on their individual recorded occurrences.' : 'One or more required scenario checks or evidence fields are not proven.'),
      principalRun: principal ? {
        exactRepoSha: principal.exactRepoSha ?? 'UNKNOWN',
        runId: principal.runId ?? 'UNKNOWN',
        occurrenceId: principal.occurrenceId ?? 'UNKNOWN',
        planId: principal.planId ?? 'UNKNOWN',
        generation: principal.generation ?? 'UNKNOWN',
        commands: principal.commands ?? 'UNKNOWN',
        exitCodes: principal.commands?.map(c => c.exitCode ?? 'UNKNOWN') ?? 'UNKNOWN',
        inputArtifacts: inputRefs,
        outputArtifacts: outputRefs,
        providerCounts: {
          observed: principal.observedProviderCallCount ?? 'UNKNOWN',
          expected: principal.expectedProviderCallCount ?? 'UNKNOWN',
          observedTargeted: principal.observedTargetedProviderCallCount ?? 'UNKNOWN',
          expectedTargeted: principal.expectedTargetedProviderCallCount ?? 'UNKNOWN',
        },
        lineage: principal?.lineage ? { ...principal.lineage, integrityVerdict: lineage } : 'NOT_PROVEN',
        ...(staleEvidence ? { staleActionEvidence: staleEvidence } : {}),
        requiredAssertions: (spec.checks ?? []).map(name => ({ name, result: findCheck(principal, name)?.pass === true ? 'PASS' : 'NOT_PROVEN' })),
      } : 'NOT_PROVEN',
      positiveAssertion: { scenarioId: spec.principal, checks: spec.checks ?? 'NOT_PROVEN' },
      negativeControlRefs: controls.map(c => ({
        scenarioId: c.id,
        runId: c.scenario?.runId ?? 'UNKNOWN',
        occurrenceId: c.scenario?.occurrenceId ?? 'UNKNOWN',
        verdict: c.scenario?.verdict ?? 'UNKNOWN',
        checks: c.checks.map(name => ({ name, result: findCheck(c.scenario, name)?.pass === true ? 'PASS' : 'NOT_PROVEN' })),
      })),
      boundaryLimit: null,
    };
  });
  rows.push({ specItem: '§20-13', scenarioId: 'OUT_OF_SCOPE', verdict: 'OUT_OF_SCOPE', reason: 'Owner T15/#127. No research quality or value claim is made.', principalRun: 'NOT_APPLICABLE', positiveAssertion: 'OUT_OF_SCOPE', negativeControlRefs: [] });
  const passCount = rows.filter(r => r.verdict === 'PASS').length;
  const notProvenCount = rows.filter(r => r.verdict === 'NOT_PROVEN').length;
  const failCount = rows.filter(r => r.verdict === 'FAIL').length;
  return {
    schema: 'p2a-t14-frozen-section-20-matrix-draft/v1',
    exactRepoSha: campaign?.exactRepoSha ?? 'UNKNOWN',
    sourceScenarioChecksVerdict: campaign?.scenarioChecksVerdict ?? campaign?.verdict ?? 'UNKNOWN',
    engineeringGate: failCount || notProvenCount ? 'BLOCKED' : 'PENDING_INDEPENDENT_REVIEW',
    status: 'DRAFT_NOT_REVIEWED',
    reviewReceipt: 'NOT_CREATED',
    counts: { pass: passCount, fail: failCount, notProven: notProvenCount, outOfScope: 1 },
    qualityClaim: 'OUT_OF_SCOPE',
    rows,
  };
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) { console.error('Usage: node matrix.mjs <campaign.json> <matrix.json>'); process.exit(2); }
  const campaign = JSON.parse(fs.readFileSync(input, 'utf8'));
  const matrix = buildMatrix(campaign);
  fs.writeFileSync(output, `${JSON.stringify(matrix, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, rows: matrix.rows.length, counts: matrix.counts, status: matrix.status, engineeringGate: matrix.engineeringGate }, null, 2));
}
