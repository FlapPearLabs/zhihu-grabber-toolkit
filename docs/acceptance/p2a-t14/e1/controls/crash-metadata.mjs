import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [matrixFile, campaignFile, output] = process.argv.slice(2);
const { buildMatrix } = await import(pathToFileURL(path.resolve(matrixFile)).href);
const original = JSON.parse(fs.readFileSync(campaignFile));
const baseline = buildMatrix(original);
assert.equal(baseline.counts.pass, 12);
const ids = ['crash-resolution-input', 'crash-resolution-reverse', 'crash-framing-drift'];
const variants = [
  ['delete-crashResolution', s => { delete s.crashResolution; }],
  ['delete-resolutionInput', s => { delete s.crashResolution.resolutionInput; }],
  ['delete-bindingHash', s => { delete s.crashResolution.resolutionInput.bindingHash; }],
  ['mismatch-byteHash', s => { s.crashResolution.resolutionInput.byteHash = 'f'.repeat(64); }],
  ['priorIDs-mismatch', s => { s.crashResolution.resolutionInput.priorQuestionIds = ['999']; }],
  ['status-basis-wrong', s => { s.crashResolution.resolutionStatus = 'WRONG'; s.crashResolution.resolutionBasis = 'WRONG'; }],
  ['commit-count-zero', s => { s.crashResolution.commitCount = 0; }],
  ['preIO-false', s => { s.crashResolution.resolutionInput.preIoCheckpointBindingValid = false; }],
  ['input-hash-shape-invalid', s => { s.crashResolution.resolutionInput.bindingHash = 'bad'; }],
  ['snapshot-priorIDs-missing', s => { delete s.crashResolution.resolutionInput.priorQuestionIds; }],
  ['snapshot-status-metadata-missing', s => { delete s.crashResolution.resolutionStatus; delete s.crashResolution.resolutionBasis; }],
  ['foreign-action-snapshot-key', s => { s.crashResolution.resolutionInput.key = 'targeted-resolution-input:' + 'f'.repeat(64); }],
  ['targeted-ids-foreign', s => { s.crashResolution.targetedIds = ['999']; }],
  ['empty-resume-planned-ids', s => { s.crashResolution.resumePlannedIds = []; }],
  ['zero-snapshot-bytes', s => { s.crashResolution.resolutionInput.byteLength = 0; }],
];
const mutations = [];
function test(id, name, mutate) {
  const campaign = structuredClone(original);
  mutate(campaign.scenarios.find(s => s.scenarioId === id));
  const matrix = buildMatrix(campaign);
  const rows = ['§20-8', '§20-10'].map(item => ({ item, verdict: matrix.rows.find(r => r.specItem === item).verdict }));
  mutations.push({ scenarioId: id, mutation: name, recordedScenarioVerdict: 'PASS', recordedChecksUnchanged: true,
    rows, caught: rows.every(r => r.verdict !== 'PASS') });
}
for (const id of ids) {
  for (const [name, mutate] of variants) test(id, name, mutate);
  if (id === 'crash-framing-drift') {
    test(id, 'missing-declared-framing', s => { delete s.crashResolution.resolutionInput.declaredFraming; });
    test(id, 'missing-covered-framings', s => { delete s.crashResolution.resolutionInput.coveredFramings; });
    test(id, 'false-covered-opposition', s => { s.crashResolution.resolutionInput.coveredFramings = [s.crashResolution.resolutionInput.declaredFraming]; });
  } else {
    test(id, 'initial-pool-binding-mismatch', s => { s.crashResolution.initialBindingHash = 'f'.repeat(64); });
    test(id, 'final-pool-binding-mismatch', s => { s.crashResolution.finalBindingHash = 'f'.repeat(64); });
  }
}
const report = { schema: 'p2a-t14-crash-metadata-controls/v1', producingCampaignSha: original.exactRepoSha,
  evidenceClass: 'DATA_FIELD_NEGATIVE_CONTROL', productRuntimeMutation: false, baseline: baseline.counts,
  mutations, uncaught: mutations.filter(m => !m.caught) };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ tested: mutations.length, uncaught: report.uncaught.length, baseline: baseline.counts }));
assert.equal(report.uncaught.length, 0, 'missing/corrupt crash metadata must not retain PASS');
