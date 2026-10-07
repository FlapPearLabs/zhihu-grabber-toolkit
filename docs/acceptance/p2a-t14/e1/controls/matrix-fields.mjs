import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const campaignDir = process.argv[2];
const output = process.argv[3];
const { buildMatrix } = await import(process.argv[4] ? pathToFileURL(process.argv[4]).href : new URL('../../../../../research-orchestration/scripts/p2a-t14/matrix.mjs', import.meta.url).href);
const original = JSON.parse(fs.readFileSync(`${campaignDir}/campaign.json`));
const baseline = buildMatrix(original);
assert.equal(baseline.counts.pass, 12);
const mutations = [];
for (const row of baseline.rows.filter(row => row.verdict === 'PASS')) {
  const test = (name, change) => {
    const mutated = structuredClone(original);
    const s = mutated.scenarios.find(s => s.scenarioId === row.scenarioId);
    change(s, mutated);
    const result = buildMatrix(mutated).rows.find(r => r.specItem === row.specItem);
    mutations.push({ name, item: row.specItem, scenario: row.scenarioId,
      before: row.verdict, after: result.verdict, caught: result.verdict !== 'PASS' });
  };
  test('missing exact occurrence', s => { delete s.occurrenceId; });
  test('foreign source SHA', s => { s.exactRepoSha = '0'.repeat(40); });
  test('missing input artifact refs', s => { s.inputArtifacts = []; });
  test('actual provider count differs', s => { s.observedProviderCallCount += 1; });
  test('command exit differs', s => { s.commands.at(-1).exitCode = 1; });
  const firstAssertion = row.principalRun.requiredAssertions[0]?.name;
  if (firstAssertion) test(`required assertion rejected: ${firstAssertion}`, s => {
    s.checks.find(c => c.name === firstAssertion).pass = false;
  });
}
const report = { schema: 'p2a-t14-matrix-field-controls/v1', exactRepoSha: original.exactRepoSha,
  evidenceClass: 'DATA_FIELD_NEGATIVE_CONTROL', keepsRecordedVerdictsAndOtherChecks: true,
  productRuntimeMutation: false, baseline: baseline.counts, mutations,
  failures: mutations.filter(m => !m.caught) };
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ source: report.exactRepoSha, tested: mutations.length, uncaught: report.failures.length }));
assert.equal(report.failures.length, 0);
