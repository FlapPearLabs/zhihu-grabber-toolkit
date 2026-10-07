#!/usr/bin/env node
// Draft §20 matrix compiler. Input verdicts remain authoritative; this never issues a review receipt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPECS = [
  { item: '§20-1', principal: 'unknown-gap', fixed: 'NOT_PROVEN', why: 'The unknown-gap observation is a controller-boundary negative control; no durable unknown gap is produced by composer persistence.', controls: [{ id: 'unknown-gap', checks: ['unknown guard and load-bearing control', 'controller before targeted IO'] }] },
  { item: '§20-2', principal: 'canonical', checks: ['bidirectional lineage'], controls: [{ id: 'unknown-gap', checks: ['controller before targeted IO'] }, { id: 'free-form', checks: ['controller before targeted IO'] }] },
  { item: '§20-3', principal: 'free-form', checks: ['controller before targeted IO', 'rejected proposal recorded'], controls: [{ id: 'unsafe-plan-owned', checks: ['controller before targeted IO', 'rejected proposal recorded'] }], requireZeroTargeted: true },
  { item: '§20-4', principal: 'canonical', checks: ['all provider calls', 'bidirectional lineage'], controls: [{ id: 'provider-scope', checks: ['no runtime or provider fallback'] }] },
  { item: '§20-5', principal: 'provider-scope', checks: ['no runtime or provider fallback', 'all provider calls'], controls: [{ id: 'canonical', checks: ['no runtime or provider fallback'] }, { id: 'all-provider-failed', checks: ['no runtime or provider fallback'] }] },
  { item: '§20-6', principal: 'equivalent-query', fixed: 'NOT_PROVEN', why: 'Equivalent-query and per-gap observations exercise controller guards, but do not prove a real second composer diagnosis round with persistent per-gap attempts.', controls: [{ id: 'equivalent-query', checks: ['cross-round dedupe guard and load-bearing control', 'equivalent completed replay zero IO'] }, { id: 'per-gap-bound', checks: ['per-gap guard and load-bearing control', 'per-gap terminal honest'] }] },
  { item: '§20-7', principal: 'global-budget', checks: ['budget bounds real IO', 'budget terminal honest', 'budget refuses next gap'], controls: [{ id: 'per-gap-bound', checks: ['per-gap terminal honest'] }] },
  { item: '§20-8', principal: 'canonical', checks: ['evidence resolution'], controls: [{ id: 'duplicate-only', checks: ['duplicate-only unresolved'] }, { id: 'contradiction-one-side', checks: ['one-sided does not resolve'] }, { id: 'authority-unavailable', checks: ['no authority predicate'] }] },
  { item: '§20-9', principal: 'canonical', checks: ['all durable gaps visible', 'bidirectional lineage'], controls: [{ id: 'duplicate-only', checks: ['all durable gaps visible', 'duplicate-only unresolved'] }, { id: 'authority-unavailable', checks: ['all durable gaps visible', 'no authority predicate'] }] },
  { item: '§20-10', principal: 'crash-after', checks: ['same occurrence resumes', 'real kill at window', 'resume paid IO delta', 'one durable COMMIT', 'commit window checkpoint matches kill', 'final pool hash matches binding', 'replay decision'], controls: [{ id: 'crash-before', checks: ['same occurrence resumes', 'real kill at window', 'resume paid IO delta', 'one durable COMMIT', 'replay decision'] }] },
  { item: '§20-11', principal: 'canonical', checks: ['bidirectional lineage'], controls: [{ id: 'tampered-pool', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'stale-binding', checks: ['tampered committed product refused', 'fault does not pay again'] }] },
  { item: '§20-12', principal: 'stale-binding', checks: ['tampered committed product refused', 'fault does not pay again'], controls: [{ id: 'tampered-pool', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'equivalent-query', checks: ['equivalent completed replay zero IO'] }, { id: 'missing-resolution', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'tampered-resolution', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'foreign-resolution', checks: ['tampered committed product refused', 'fault does not pay again'] }, { id: 'canonical-ledger-drift', checks: ['canonical ledger is not a replay credential', 'bidirectional lineage'] }] },
];

const findCheck = (scenario, name) => scenario?.checks?.find(c => c.name === name);
const passed = (scenario, names) => names.every(name => findCheck(scenario, name)?.pass === true);
const portableRefs = refs => (refs ?? []).map(a => ({ path: a.path ?? 'UNKNOWN', sha256: a.sha256 ?? 'UNKNOWN', bytes: a.bytes ?? 'UNKNOWN' }));

export function buildMatrix(campaign) {
  const scenarios = new Map((campaign?.scenarios ?? []).map(s => [s.scenarioId, s]));
  const rows = SPECS.map(spec => {
    const principal = scenarios.get(spec.principal);
    const controls = (spec.controls ?? []).map(ref => ({ ...ref, scenario: scenarios.get(ref.id) }));
    const principalChecksOk = !!principal && (!spec.checks || passed(principal, spec.checks));
    const controlsOk = controls.length === (spec.controls ?? []).length && controls.every(c => c.scenario && passed(c.scenario, c.checks));
    const zeroCallOk = !spec.requireZeroTargeted || (principal?.observedTargetedProviderCallCount === 0 && principal?.expectedTargetedProviderCallCount === 0);
    const scenarioVerdictsOk = !!principal && principal.verdict === 'PASS' && controls.every(c => c.scenario.verdict === 'PASS');
    const verdict = spec.fixed ?? (principalChecksOk && controlsOk && zeroCallOk && scenarioVerdictsOk ? 'PASS' : 'FAIL');
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
        lineage: principal.lineage ?? 'NOT_PROVEN',
        requiredAssertions: (spec.checks ?? []).map(name => ({ name, result: findCheck(principal, name)?.pass === true ? 'PASS' : 'NOT_PROVEN' })),
      } : 'NOT_PROVEN',
      positiveAssertion: { scenarioId: spec.principal, checks: spec.checks ?? (spec.fixed ? ['controller guard observation (limited scope)'] : 'NOT_PROVEN') },
      negativeControlRefs: controls.map(c => ({
        scenarioId: c.id,
        runId: c.scenario?.runId ?? 'UNKNOWN',
        occurrenceId: c.scenario?.occurrenceId ?? 'UNKNOWN',
        verdict: c.scenario?.verdict ?? 'UNKNOWN',
        checks: c.checks.map(name => ({ name, result: findCheck(c.scenario, name)?.pass === true ? 'PASS' : 'NOT_PROVEN' })),
      })),
      boundaryLimit: spec.fixed ? 'CONTROLLER_BOUNDARY_NEGATIVE_CONTROL; does not close the full composer persistence/round-trip obligation.' : null,
    };
  });
  rows.push({ specItem: '§20-13', scenarioId: 'OUT_OF_SCOPE', verdict: 'OUT_OF_SCOPE', reason: 'Owner T15/#127. No research quality or value claim is made.', principalRun: 'NOT_APPLICABLE', positiveAssertion: 'OUT_OF_SCOPE', negativeControlRefs: [] });
  const passCount = rows.filter(r => r.verdict === 'PASS').length;
  const notProvenCount = rows.filter(r => r.verdict === 'NOT_PROVEN').length;
  const failCount = rows.filter(r => r.verdict === 'FAIL').length;
  return {
    schema: 'p2a-t14-frozen-section-20-matrix-draft/v1',
    exactRepoSha: campaign?.exactRepoSha ?? 'UNKNOWN',
    sourceCampaignVerdict: campaign?.verdict ?? 'UNKNOWN',
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
