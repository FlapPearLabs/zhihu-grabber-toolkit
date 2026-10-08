import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateProductInput } from '../evaluation/input.mjs';
import { measureTargets, compareResults, observeProduct, inventory, validateEvaluationCase } from '../evaluation/evaluator.mjs';
import { executeProductWorker, stageProductTree, validateBenchmark, validateObservedPair, degradeKnownHit, bindEvaluationFile, readBoundEvaluationFile } from '../evaluation/run.mjs';
import { configFingerprint, sha256File } from '../lib/state.mjs';
import { EXPERIMENT_CONFIG } from '../evaluation/product-worker.mjs';
import { loadPlan } from '../lib/plan-contract.mjs';

const publicInput = () => ({
  schema_version: 1, case_id: 'probe', task: '评估隔离', time_scope: 'frozen',
  plan: { schemaVersion: 1, queryVariants: ['资料'], aspects: ['资料'], entities: [],
    opposingFramings: [], terminologyVariants: [], sourceGroupIntents: [] },
  corpus: [{ question_id: '100', title: '模拟资料', text: '独立证据支持观点。' }],
  routes: { 资料: ['100'] },
});

const observation = () => ({
  valid: true,
  sources: [{ question_id: '100', source_id: 'source-a', text: '夜间照明是安全条件。' }],
  selected: ['source-a'], analyzed: ['source-a'],
  claims: [{ claim_id: 'claim-a', statement: '夜间照明是安全条件。', source_refs: ['source-a'] }],
});
const targets = {
  important_aspects: [{ target_id: 'lighting', support_any_of: [{ question_id: '100', accepted_statements: ['夜间照明是安全条件。'] }] }],
  counterpositions: [], key_evidence: [{ target_id: 'record', question_id: '100', expected_text: '夜间照明是安全条件。' }],
};

test('discovery requires verified selected evidence and a supported final claim, not query or aspect names', () => {
  assert.equal(measureTargets(observation(), targets).important_aspect_discovery.hits, 1);
  const unsupported = observation();
  unsupported.claims[0].statement = '查询过夜间照明。';
  assert.equal(measureTargets(unsupported, targets).important_aspect_discovery.hits, 0);
  unsupported.claims[0].statement = '夜间照明不是安全条件。';
  assert.equal(measureTargets(unsupported, targets).important_aspect_discovery.hits, 0);
  unsupported.claims[0].statement = '夜间照明是安全条件。';
  unsupported.analyzed = [];
  assert.equal(measureTargets(unsupported, targets).important_aspect_discovery.hits, 0);
  unsupported.sources = [];
  assert.equal(measureTargets(unsupported, targets).key_evidence_discovery.hits, 0);
  assert.equal(measureTargets(observation(), targets).counterposition_discovery.ratio, 'UNKNOWN');
});

test('a deliberately degraded candidate is a regression and an unequal model is invalid', () => {
  const baseline = { status: 'VALID', identity: { pair: 'same' }, metrics: measureTargets(observation(), targets), cost: { retrieval_calls: 2 } };
  const degraded = structuredClone(baseline);
  degraded.metrics = measureTargets({ ...observation(), sources: [], claims: [] }, targets);
  assert.equal(compareResults(baseline, degraded).quality_change, 'REGRESSION');
  degraded.identity.pair = 'stronger-model';
  assert.equal(compareResults(baseline, degraded).status, 'INVALID');
});

test('a product clarification or failed run is INVALID, never zero gain or a quality pass', () => {
  const valid = { status: 'VALID', identity: { pair: 'same' }, metrics: measureTargets(observation(), targets), cost: {} };
  const incomplete = { ...valid, status: 'INVALID', product_failure: 'clarification_required' };
  assert.equal(compareResults(valid, incomplete).status, 'INVALID');
  assert.equal(compareResults(incomplete, incomplete).status, 'INVALID');
});

test('empty target support and a different document with the same identity cannot manufacture hits', () => {
  const empty = structuredClone(targets);
  empty.important_aspects[0].support_any_of = [];
  assert.throws(() => measureTargets(observation(), empty), /EVALUATION_TARGET_INVALID/);
  const wrongDocument = observation();
  wrongDocument.sources[0].text = '另一份不相干材料。';
  assert.equal(measureTargets(wrongDocument, targets).key_evidence_discovery.hits, 0);
});

test('separate product processes expose a real weak baseline and evaluator leaves both artifact trees unchanged', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const file = path.join(repo, 'research-orchestration/evaluation/benchmark/cases/P2-F01-ASPECT-01/product-input.json');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-f01-ci-'));
  try {
    const results = {};
    for (const arm of ['baseline', 'candidate']) {
      const workDir = path.join(temp, arm);
      assert.equal(executeProductWorker({ repo, file, workDir, arm, inputHash: sha256File(file) }).ok, true);
      const before = inventory(workDir);
      const actual = observeProduct(workDir, configFingerprint(EXPERIMENT_CONFIG));
      const hidden = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'eval-case.json')));
      results[arm] = measureTargets(actual, hidden.targets);
      assert.deepEqual(inventory(workDir), before);
    }
    assert.equal(results.baseline.important_aspect_discovery.hits, 1);
    assert.equal(results.candidate.important_aspect_discovery.hits, 3);
    const contaminated = JSON.parse(fs.readFileSync(file));
    contaminated.hidden_targets = ['leaked'];
    const leakedFile = path.join(temp, 'leaked.json');
    fs.writeFileSync(leakedFile, JSON.stringify(contaminated));
    const leakedWork = path.join(temp, 'contaminated-product');
    const control = executeProductWorker({ repo, file: leakedFile, workDir: leakedWork, arm: 'candidate', inputHash: sha256File(leakedFile) });
    assert.equal(control.ok, false);
    assert.match(control.code, /BENCHMARK_CONTAMINATION/);
    assert.equal(fs.existsSync(leakedWork), false);
    const hashControl = executeProductWorker({ repo, file: leakedFile, workDir: leakedWork, arm: 'candidate', inputHash: sha256File(file) });
    assert.equal(hashControl.code, 'BENCHMARK_CONTAMINATION_INPUT_HASH');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('product boundary rejects evaluator data even when nested in public fields', () => {
  assert.doesNotThrow(() => validateProductInput(publicInput()));
  for (const change of [
    input => { input.hidden_targets = ['secret']; },
    input => { input.plan.evaluation_notes = 'secret'; },
    input => { input.corpus[0].expected_authority_target = true; },
    input => { input.routes.资料 = { hidden_targets: ['secret'] }; },
  ]) {
    const input = publicInput();
    change(input);
    assert.throws(() => validateProductInput(input), /BENCHMARK_CONTAMINATION/);
  }
});

test('actual incomplete worker retains owner plan identity and unknown final lineage without rewriting product', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const file = path.join(repo, 'research-orchestration/evaluation/benchmark/cases/P2-F01-AUTHORITY-03/product-input.json');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-f01-incomplete-'));
  const workDir = path.join(temp, 'candidate');
  try {
    const execution = executeProductWorker({ repo, file, workDir, arm: 'candidate', inputHash: sha256File(file) });
    assert.equal(execution.ok, false);
    assert.equal(execution.code, 'clarification_required');
    assert.equal(JSON.parse(fs.readFileSync(path.join(workDir, 'targeted-requery-actions.json'))).targetedActions.length, 3);
    const before = inventory(workDir);
    const actual = observeProduct(workDir, configFingerprint(EXPERIMENT_CONFIG), execution);
    assert.equal(actual.valid, false);
    assert.equal(actual.plan_hash, loadPlan(workDir).planHash);
    assert.equal(actual.targeted_action_count, 'UNKNOWN');
    assert.deepEqual(inventory(workDir), before);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('curator typos, stale time scope and unknown fields cannot manufacture a weak baseline', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const dir = path.join(repo, 'research-orchestration/evaluation/benchmark/cases/P2-F01-ASPECT-01');
  const input = JSON.parse(fs.readFileSync(path.join(dir, 'product-input.json')));
  const gold = JSON.parse(fs.readFileSync(path.join(dir, 'eval-case.json')));
  assert.doesNotThrow(() => validateEvaluationCase(gold, input, gold.benchmark_version));
  for (const change of [
    c => { c.time_scope = 'different time'; },
    c => { c.targets.key_evidence[0].question_id = '999999'; },
    c => { c.targets.important_aspects[0].support_any_of[0].accepted_statements = ['not in this source']; },
    c => { c.targets.counterpositions[0].extra = 'unknown'; },
    c => { c.targets.key_evidence[0].expected_text = 'changed document'; },
  ]) { const bad = structuredClone(gold);change(bad);assert.throws(() => validateEvaluationCase(bad, input, gold.benchmark_version), /EVALUATION_CASE_INVALID/); }
});

test('hidden-file binding uses committed metadata and refuses a changed file before post-run scoring', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const ref = 'research-orchestration/evaluation/benchmark/cases/P2-F01-ASPECT-01/eval-case.json';
  const bound = bindEvaluationFile(repo, 'HEAD', ref);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-f01-bound-'));
  try {
    const file = path.join(temp, 'eval-case.json');fs.copyFileSync(path.join(repo, ref), file);
    assert.equal(readBoundEvaluationFile(repo, file, bound).value.case_id, 'P2-F01-ASPECT-01');
    fs.appendFileSync(file, '\n');
    assert.throws(() => readBoundEvaluationFile(repo, file, bound), /EVALUATION_CASE_CHANGED_DURING_RUN/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});


test('normalized route collisions are rejected rather than silently replacing the authored route', () => {
  const input = publicInput();
  input.routes = { Q: ['100'], ' q ': [] };
  assert.throws(() => validateProductInput(input), /BENCHMARK_CONTAMINATION/);
});


test('closed manifest rejects version, identity, duplicate and path packaging errors before outputs', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'research-orchestration/evaluation/benchmark/benchmark.json')));
  assert.doesNotThrow(() => validateBenchmark(manifest));
  for (const change of [
    value => { value.benchmark_version = null; },
    value => { value.benchmark_version = ' '; },
    value => { value.extra = true; },
    value => { value.scope = 'complete truth'; },
    value => { value.cases[0].case_id = '../escaped'; },
    value => { value.cases[0].product_input = '/tmp/public.json'; },
    value => { value.cases[0].evaluation_case = value.cases[1].evaluation_case; },
    value => { value.cases[1] = value.cases[0]; },
  ]) { const bad = structuredClone(manifest);change(bad);assert.throws(() => validateBenchmark(bad), /EVALUATION_BENCHMARK_INVALID/); }
});

test('observed owner run and plan identity must match while occurrences must be separate', () => {
  const baseline = { run_id: 'owner-run', plan_hash: 'owner-plan', occurrence_id: 'baseline-occurrence' };
  const candidate = { ...baseline, occurrence_id: 'candidate-occurrence' };
  assert.doesNotThrow(() => validateObservedPair(baseline, candidate));
  for (const key of ['run_id', 'plan_hash']) assert.throws(() => validateObservedPair(baseline, { ...candidate, [key]: 'foreign' }), /OBSERVED_IDENTITY_MISMATCH/);
  assert.throws(() => validateObservedPair(baseline, baseline), /SHARED_OCCURRENCE/);
});

test('degradation uses an actually hit aspect even when key evidence is empty', () => {
  const noKey = { ...targets, key_evidence: [] };
  const degraded = degradeKnownHit(observation(), noKey);
  assert.equal(degraded.removed_question_id, '100');
  assert.equal(measureTargets(degraded.observation, noKey).important_aspect_discovery.hits, 0);
  assert.equal(degradeKnownHit({ ...observation(), claims: [] }, noKey), null);
});

test('copied product root and its Node child cannot open gold through normal repository-relative paths', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const file = path.join(repo, 'research-orchestration/evaluation/benchmark/cases/P2-F01-ASPECT-01/product-input.json');
  const stage = stageProductTree(repo, file);
  try {
    assert.equal(sha256File(path.join(stage, 'product-input.json')), sha256File(file));
    for (const ref of ['.git', 'docs', 'research-orchestration/evaluation/benchmark', 'research-orchestration/evaluation/evaluator.mjs']) assert.equal(fs.existsSync(path.join(stage, ref)), false);
    const probe = `import fs from 'node:fs';import {spawnSync} from 'node:child_process';
      const read = () => { try {fs.readFileSync('research-orchestration/evaluation/benchmark/cases/P2-F01-ASPECT-01/eval-case.json');return 'LEAK';} catch(e) {return e.code;} };
      console.log(read());const child=spawnSync(process.execPath,['--input-type=module','-e','import fs from "node:fs";try{fs.readFileSync("research-orchestration/evaluation/benchmark/cases/P2-F01-ASPECT-01/eval-case.json");process.exitCode=1;}catch(e){console.log(e.code);}'],{encoding:'utf8'});console.log(child.stdout.trim());process.exitCode=child.status;`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: stage, encoding: 'utf8' });
    assert.equal(result.status, 0);assert.equal(result.stdout.trim(), 'ENOENT\nENOENT');
    const walk = dir => { for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name);const stat = fs.lstatSync(file);assert.equal(stat.isSymbolicLink(), false);if (stat.isDirectory()) walk(file); } };walk(stage);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
});

test('untrusted curated text stays canonical while Markdown controls and inherited route names stay inert', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const input = publicInput();
  input.plan.queryVariants = ['资料', 'constructor', '__proto__'];
  input.corpus[0].text = '<script>alert(1)</script>\n## 2. injected\n```active';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-f01-untrusted-'));
  try {
    const file = path.join(temp, 'product-input.json');fs.writeFileSync(file, JSON.stringify(input));
    const workDir = path.join(temp, 'product');
    executeProductWorker({ repo, file, workDir, arm: 'baseline', inputHash: sha256File(file) });
    const canonical = JSON.parse(fs.readFileSync(path.join(workDir, 'zhihu/100/answers.json')));
    assert.equal(canonical.answers[0].content, input.corpus[0].text);
    const md = fs.readFileSync(path.join(workDir, 'zhihu/100/answers.md'), 'utf8');
    assert.equal(md.includes('<script>'), false);assert.equal((md.match(/^## \d+\./gm) ?? []).length, 1);
    const trace = JSON.parse(fs.readFileSync(path.join(workDir, 'evaluation-execution-observation.json')));
    const empty = trace.calls.filter(call => ['constructor', '__proto__'].includes(call.query));
    assert.ok(empty.length > 0);assert.ok(empty.every(call => call.question_ids.length === 0));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
