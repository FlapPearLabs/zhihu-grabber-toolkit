#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { configFingerprint, sha256, sha256File } from '../lib/state.mjs';
import { canonicalJson } from '../lib/cross-group-aggregation.mjs';
import { json, writeJson } from '../scripts/p2a-t14/fixtures.mjs';
import { validateProductInput } from './input.mjs';
import { observeProduct, measureTargets, compareResults, validateEvaluationCase, EVALUATOR_VERSION } from './evaluator.mjs';
import { EXPERIMENT_CONFIG, PROPOSAL_POLICY_VERSION } from './product-worker.mjs';

// A copied execution root contains production code/dependencies and one public input only.
// This is a benchmark file boundary, not an OS sandbox for hostile executable code.
export function stageProductTree(repo, file) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-f01-product-'));
  try {
    const refs = [
      'references/zhihu-corpus-handoff.schema.json',
      'research-orchestration/package.json', 'research-orchestration/lib',
      'research-orchestration/evaluation/input.mjs', 'research-orchestration/evaluation/product-worker.mjs',
      'research-orchestration/scripts/p2a-t14/fixtures.mjs',
      'research-orchestration/test/helpers/test-embedding-provider.mjs',
      'corpus-anthology/package.json', 'corpus-anthology/lib', 'corpus-anthology/scripts',
      'zhihu-answer-grabber/package.json', 'zhihu-answer-grabber/src', 'zhihu-answer-grabber/scripts',
    ];
    const rejectLinks = source => {
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) throw new Error('EVALUATION_STAGE_SYMLINK_REJECTED');
      if (stat.isDirectory()) for (const entry of fs.readdirSync(source)) rejectLinks(path.join(source, entry));
    };
    for (const ref of refs) {
      const source = path.join(repo, ref); rejectLinks(source);
      const dest = path.join(stage, ref); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(source, dest, { recursive: true });
    }
    fs.copyFileSync(file, path.join(stage, 'product-input.json'));
    return stage;
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
}

export function executeProductWorker({ repo, file, workDir, arm, inputHash }) {
  if (fs.existsSync(workDir)) throw new Error('EVALUATION_COLD_DIRECTORY_REQUIRED');
  const stage = stageProductTree(repo, file);
  try {
    const output = path.join(stage, 'product-output');
    const child = spawnSync(process.execPath, ['research-orchestration/evaluation/product-worker.mjs',
      '--input', 'product-input.json', '--expected-input-hash', inputHash, '--work-dir', output, '--arm', arm],
    { cwd: stage, env: { ...process.env, NODE_PATH: '' }, encoding: 'utf8', timeout: 90_000, maxBuffer: 64 * 1024 });
    if (fs.existsSync(output)) fs.cpSync(output, workDir, { recursive: true });
    let result;
    try { result = JSON.parse(child.stdout); }
    catch { return { ok: false, code: 'EVALUATION_WORKER_PROCESS_FAILED' }; }
    return child.status === 0 && result.ok === true ? result
      : { ok: false, code: result.code ?? 'EVALUATION_WORKER_FAILED' };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

export function validateBenchmark(benchmark) {
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson(keys.sort());
  const ids = new Set();
  if (!exact(benchmark, ['schema_version', 'benchmark_version', 'scope', 'cases'])
      || benchmark.schema_version !== 1 || typeof benchmark.benchmark_version !== 'string'
      || !benchmark.benchmark_version.trim() || benchmark.scope !== 'CURATED_TARGETS != OPEN_WORLD_COMPLETENESS'
      || !Array.isArray(benchmark.cases) || benchmark.cases.length < 5 || benchmark.cases.length > 8) throw new Error('EVALUATION_BENCHMARK_INVALID');
  for (const descriptor of benchmark.cases) {
    if (!exact(descriptor, ['case_id', 'product_input', 'evaluation_case'])
        || typeof descriptor.case_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(descriptor.case_id)
        || ids.has(descriptor.case_id)
        || ['product_input', 'evaluation_case'].some(key => typeof descriptor[key] !== 'string'
          || descriptor[key] !== `research-orchestration/evaluation/benchmark/cases/${descriptor.case_id}/${key === 'product_input' ? 'product-input' : 'eval-case'}.json`)) throw new Error('EVALUATION_BENCHMARK_INVALID');
    ids.add(descriptor.case_id);
  }
  return benchmark;
}

export function validateObservedPair(baseline, candidate) {
  if (!baseline.run_id || !baseline.plan_hash || baseline.run_id !== candidate.run_id
      || baseline.plan_hash !== candidate.plan_hash) throw new Error('EVALUATION_OBSERVED_IDENTITY_MISMATCH');
  if (!baseline.occurrence_id || !candidate.occurrence_id || baseline.occurrence_id === candidate.occurrence_id) throw new Error('EVALUATION_SHARED_OCCURRENCE');
}

export function degradeKnownHit(observation, targets) {
  if (!observation.valid) return null;
  const hit = Object.values(measureTargets(observation, targets)).flatMap(metric => metric.targets).find(target => target.hit === true);
  if (!hit) return null;
  const removed = hit.proof.question_id;
  const degraded = structuredClone(observation);
  const refs = degraded.sources.filter(source => source.question_id === removed).map(source => source.source_id);
  degraded.sources = degraded.sources.filter(source => !refs.includes(source.source_id));
  degraded.claims = degraded.claims.filter(claim => !claim.source_refs.some(ref => refs.includes(ref)));
  return { observation: degraded, removed_question_id: removed };
}

const relative = (repo, file) => path.relative(repo, file).split(path.sep).join('/');
const stableCost = cost => Object.fromEntries(Object.entries(cost).filter(([key]) => key !== 'wall_clock_ms'));

// Reads Git metadata only; hidden evaluator bytes are first read after both workers.
export function bindEvaluationFile(repo, repoSha, ref) {
  return execFileSync('git', ['rev-parse', `${repoSha}:${ref}`], { cwd: repo, encoding: 'utf8' }).trim();
}

export function readBoundEvaluationFile(repo, file, committedBlob) {
  const bytes = fs.readFileSync(file);
  const actualBlob = execFileSync('git', ['hash-object', '--stdin', '--no-filters'],
    { cwd: repo, input: bytes, encoding: 'utf8' }).trim();
  if (actualBlob !== committedBlob) throw new Error('EVALUATION_CASE_CHANGED_DURING_RUN');
  return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) };
}

function preflight(repo) {
  const read = script => {
    const result = spawnSync(process.execPath, [path.join(repo, script), '--json'],
      { cwd: repo, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 });
    try { return JSON.parse(result.stdout); } catch { return null; }
  };
  const semantic = read('corpus-anthology/scripts/preflight-deepseek.mjs');
  const retrieval = read('zhihu-answer-grabber/scripts/preflight.mjs');
  const usable = semantic?.credential?.usable === true && retrieval?.cookie?.usable === true
    && retrieval?.secret?.usable === true;
  return { semantic_credential_usable: semantic?.credential?.usable ?? 'UNKNOWN',
    capture_cookie_usable: retrieval?.cookie?.usable ?? 'UNKNOWN',
    search_secret_usable: retrieval?.secret?.usable ?? 'UNKNOWN',
    status: 'NOT_RUN', reason: usable ? 'LIVE_EVALUATION_IS_SEPARATE_FROM_THIS_DETERMINISTIC_COMMAND'
      : 'CANONICAL_CREDENTIAL_PREFLIGHT_NOT_USABLE', run_count: 0, variance: 'UNKNOWN', research_quality: 'UNKNOWN' };
}

function summarize(caseId, comparison) {
  if (comparison.status !== 'VALID') return `| ${caseId} | UNKNOWN | UNKNOWN | UNKNOWN | ${comparison.incremental_cost?.retrieval_calls ?? 'UNKNOWN'} | INVALID: ${comparison.reason} |`;
  const values = Object.values(comparison.metrics);
  return `| ${caseId} | ${values.map(v => `${v.baseline_hits} → ${v.candidate_hits} / ${v.total}`).join(' | ')} | ${comparison.incremental_cost.retrieval_calls >= 0 ? '+' : ''}${comparison.incremental_cost.retrieval_calls} | ${comparison.quality_change} |`;
}

/** Product workers complete before the first read of a case's evaluator-only data. */
export function runBenchmark({ repo, out, productRoot, repoSha, repeats = 2 }) {
  if (fs.existsSync(out) || fs.existsSync(productRoot)) throw new Error('EVALUATION_FRESH_DIRECTORIES_REQUIRED');
  const benchmarkFile = path.join(repo, 'research-orchestration/evaluation/benchmark/benchmark.json');
  const benchmarkRead = readBoundEvaluationFile(repo, benchmarkFile,
    bindEvaluationFile(repo, repoSha, relative(repo, benchmarkFile)));
  const benchmark = validateBenchmark(benchmarkRead.value);
  const prepared = benchmark.cases.map(descriptor => {
    const file = path.join(repo, descriptor.product_input);
    const inputRead = readBoundEvaluationFile(repo, file, bindEvaluationFile(repo, repoSha, descriptor.product_input));
    const publicInput = validateProductInput(inputRead.value);
    if (descriptor.case_id !== publicInput.case_id) throw new Error('EVALUATION_CASE_ID_MISMATCH');
    const inputHash = inputRead.sha256;
    const evaluationFile = path.join(repo, descriptor.evaluation_case);
    const evaluatorBlob = bindEvaluationFile(repo, repoSha, descriptor.evaluation_case);
    const canonicalInputHash = sha256(canonicalJson(publicInput));
    return { descriptor, file, publicInput, inputHash, evaluationFile, evaluatorBlob, canonicalInputHash, inputRead };
  });
  fs.mkdirSync(out, { recursive: true });
  const campaign = { schema_version: 1, repo_sha: repoSha, benchmark_version: benchmark.benchmark_version,
    evaluator_version: EVALUATOR_VERSION, case_count: benchmark.cases.length, repeats,
    tier: 'DETERMINISTIC_REPLAYABLE', pairs: [],
    documented_nondeterminism: ['wall_clock_ms', 'timestamp', 'product occurrence_id', 'artifact hashes containing occurrence/timestamp'],
    dogfood: preflight(repo) };
  for (const { descriptor, file, publicInput, inputHash, evaluationFile, evaluatorBlob, canonicalInputHash, inputRead } of prepared) {
    const caseOut = path.join(out, descriptor.case_id);
    fs.mkdirSync(caseOut);
    const pairs = [];
    for (let repetition = 1; repetition <= repeats; repetition++) {
      const pairDir = path.join(caseOut, `repeat-${repetition}`);
      fs.mkdirSync(pairDir);
      const observations = {}; const executions = {};
      const order = repetition % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
      // Every arm is cold, separate, with identical provider/corpus/model doubles.
      for (const arm of order) {
        const workDir = path.join(productRoot, descriptor.case_id, `${repetition}-${arm}`);
        const result = executeProductWorker({ repo, file, workDir, arm, inputHash });
        if (!result.ok && !fs.existsSync(path.join(workDir, 'evaluation-execution-observation.json'))) {
          throw new Error(`EVALUATION_WORKER_FAILED:${descriptor.case_id}:${arm}:${result.code}`);
        }
        observations[arm] = observeProduct(workDir, configFingerprint(EXPERIMENT_CONFIG), result);
        executions[arm] = json(path.join(workDir, 'evaluation-execution-observation.json'));
        const copy = path.join(pairDir, `${arm}-product`);
        fs.cpSync(workDir, copy, { recursive: true });
        observations[arm].artifact_hashes = observations[arm].artifact_hashes.map(item =>
          ({ ...item, path: relative(repo, path.join(copy, item.path)) }));
        observations[arm].sources = observations[arm].sources.map(source => ({ ...source,
          evidence_ref: relative(repo, path.join(copy, source.evidence_ref)) }));
      }
      // No hidden fields, evaluator notes or labels have been read before this point.
      if (sha256File(file) !== inputHash) throw new Error('EVALUATION_PRODUCT_INPUT_CHANGED_DURING_RUN');
      const evaluationRead = readBoundEvaluationFile(repo, evaluationFile, evaluatorBlob);
      const evaluationCase = validateEvaluationCase(evaluationRead.value, publicInput, benchmark.benchmark_version);
      writeJson(path.join(pairDir, 'eval-case.json'), evaluationCase);
      const benchmarkHashes = { [relative(repo, benchmarkFile)]: benchmarkRead.sha256,
        [descriptor.product_input]: inputRead.sha256, [descriptor.evaluation_case]: evaluationRead.sha256 };
      const results = {};
      for (const arm of ['baseline', 'candidate']) {
        const observation = observations[arm];
        const execution = executions[arm];
        const selectedSources = observation.sources.filter(source => observation.selected.includes(source.source_id));
        const returnedIds = execution.calls.filter(call => call.kind === 'retrieval').flatMap(call => call.question_ids);
        const gaps = observation.targeted_gaps?.gaps ?? [];
        results[arm] = { schema_version: 1, status: observation.valid ? 'VALID' : 'INVALID',
          product_failure: observation.product_failure ?? null, arm, repetition,
          identity: { repo_sha: repoSha, case_id: descriptor.case_id, benchmark_version: benchmark.benchmark_version,
            benchmark_hashes: benchmarkHashes, evaluator_case_git_blob: evaluatorBlob, evaluator_version: EVALUATOR_VERSION,
            product_input_hash: inputHash, canonical_product_input_hash: canonicalInputHash,
            time_scope: publicInput.time_scope, shared_product_config: EXPERIMENT_CONFIG,
            runtime_identity: { implementation: 'DETERMINISTIC_DOUBLE', node: process.version,
              contract_runtime_pin: 'deepseek-api-tool-less', embedding: 'existing mockVector768(7)' },
            model_identity: { actual_model: 'NONE', contract_model_pin: 'deepseek-v4-pro', semantic_policy: 'verbatim-fenced-content-v1' },
            provider_identity: ['zhihu_search:frozen-double', 'zhihu-open-platform:frozen-double', 'frozen-evaluation-capture'] },
          product_config: { ...EXPERIMENT_CONFIG, targeted_enabled: arm === 'candidate',
            proposal_policy: arm === 'candidate' ? PROPOSAL_POLICY_VERSION : 'NONE', max_attempts_per_gap: 2,
            cache_state: 'COLD_SEPARATE_DIRECTORY', planner: 'PUBLIC_FROZEN_PLAN' },
          timestamp: new Date().toISOString(),
          product_identity: { run_id: observation.run_id, occurrence_id: observation.occurrence_id, plan_hash: observation.plan_hash },
          artifact_hashes: observation.artifact_hashes, product_checkpoint_hashes: observation.product_checkpoint_hashes,
          metrics: observation.valid ? measureTargets(observation, evaluationCase.targets)
            : Object.fromEntries(['important_aspects', 'counterpositions', 'key_evidence'].map((family, index) =>
              [['important_aspect_discovery', 'counterposition_discovery', 'key_evidence_discovery'][index],
                { hits: 'UNKNOWN', total: evaluationCase.targets[family].length, ratio: 'UNKNOWN',
                  targets: evaluationCase.targets[family].map(target => ({ target_id: target.target_id, hit: 'UNKNOWN', proof: null })) }])),
          cost: { ...execution.cost, selected_corpus_sources: selectedSources.length,
            downstream_material_chars: selectedSources.reduce((sum, source) => sum + source.text.length, 0) },
          supporting: { stop_reason: observation.stop_reason,
            duplicate_ratio: returnedIds.length ? 1 - new Set(returnedIds).size / returnedIds.length : 'UNKNOWN',
            unresolved_gap_rate: gaps.length ? gaps.filter(gap => gap.status !== 'RESOLVED').length / gaps.length : 'UNKNOWN',
            targeted_action_count: observation.valid
              ? new Set(gaps.flatMap(gap => gap.lineage.map(link => link.targetedActionId))).size : observation.targeted_action_count,
            new_materially_useful_sources_per_targeted_round: 'UNKNOWN' } };
        writeJson(path.join(pairDir, `${arm}-result.json`), results[arm]);
      }
      validateObservedPair(results.baseline.product_identity, results.candidate.product_identity);
      const comparison = compareResults(results.baseline, results.candidate);
      comparison.identity = results.baseline.identity;
      comparison.confound = ['Synthetic curated corpus and exact verbatim semantic double; excludes live quality.',
        'Fixed public planner output and injected proposal policy; default CLI targeted re-query remains disabled.',
        'Shared host wall-clock latency varies; order alternates across identical reruns.'];
      writeJson(path.join(pairDir, 'comparison.json'), comparison);
      writeJson(path.join(pairDir, 'run-manifest.json'), {
        schema_version: 1, ...results.baseline.identity, timestamp: new Date().toISOString(),
        product_input_hash: inputHash, product_input_excludes: ['hidden_targets', 'evaluation_notes', 'targets', 'gold_labels'],
        execution_order: order, worker_process_separate_from_evaluator: true,
        product_execution_root: 'COPIED_CODE_AND_PUBLIC_INPUT_ONLY', hidden_files_in_execution_tree: false,
        product_identities: Object.fromEntries(Object.entries(results).map(([arm, result]) => [arm, result.product_identity])),
        product_configs: Object.fromEntries(Object.entries(results).map(([arm, result]) => [arm, result.product_config])),
        result_artifact_hashes: Object.fromEntries(['eval-case.json', 'baseline-result.json', 'candidate-result.json', 'comparison.json']
          .map(name => [relative(repo, path.join(pairDir, name)), sha256File(path.join(pairDir, name))])),
      });
      fs.writeFileSync(path.join(pairDir, 'human-readable-summary.md'), `# ${descriptor.case_id}\n\n合成冻结语料；actual model = NONE。${comparison.quality_change ?? comparison.status}。\n\n| case | aspect | counterposition | key evidence | extra retrieval calls | result |\n|---|---|---|---|---|---|\n${summarize(descriptor.case_id, comparison)}\n\nCURATED_TARGETS != OPEN_WORLD_COMPLETENESS。成本和全部原始产物见同目录 JSON；这份报告不裁定 #108 产品价值。\n`);
      pairs.push(results);
      campaign.pairs.push({ case_id: descriptor.case_id, repetition, comparison: relative(repo, path.join(pairDir, 'comparison.json')) });
      const degradation = degradeKnownHit(observations.candidate, evaluationCase.targets);
      if (repetition === 1 && !campaign.controls && degradation) {
        const controls = path.join(caseOut, 'controls'); fs.mkdirSync(controls);
        const contaminatedFile = path.join(controls, 'contaminated-input.json');
        writeJson(contaminatedFile, { ...publicInput, hidden_targets: evaluationCase.hidden_targets });
        const invalidWork = path.join(productRoot, 'contamination-control');
        const invalid = executeProductWorker({ repo, file: contaminatedFile, workDir: invalidWork, arm: 'candidate', inputHash: sha256File(contaminatedFile) });
        if (invalid.ok || !invalid.code.includes('BENCHMARK_CONTAMINATION') || fs.existsSync(invalidWork)) throw new Error('EVALUATION_LEAKAGE_CONTROL_FAILED');
        const degraded = { ...results.candidate, control_kind: 'DELIBERATELY_DEGRADED_EVALUATOR_COPY_NOT_PRODUCT_RUN',
          metrics: measureTargets(degradation.observation, evaluationCase.targets) };
        const regression = compareResults(results.candidate, degraded);
        if (regression.quality_change !== 'REGRESSION') throw new Error('EVALUATION_REGRESSION_CONTROL_FAILED');
        writeJson(path.join(controls, 'degraded-result.json'), degraded);
        writeJson(path.join(controls, 'degraded-comparison.json'), regression);
        campaign.controls = { leakage: { status: 'PASS', invalid_run: invalid, product_io_started: false },
          degraded_candidate: { status: 'PASS', removed_question_id: degradation.removed_question_id, result: relative(repo, path.join(controls, 'degraded-comparison.json')) } };
      }
    }
    const stable = pairs.every(pair => ['baseline', 'candidate'].every(arm =>
      canonicalJson(pair[arm].metrics) === canonicalJson(pairs[0][arm].metrics)
        && pair[arm].status === pairs[0][arm].status && pair[arm].product_failure === pairs[0][arm].product_failure
        && canonicalJson(stableCost(pair[arm].cost)) === canonicalJson(stableCost(pairs[0][arm].cost))));
    if (!stable) throw new Error('EVALUATION_UNEXPLAINED_METRIC_DRIFT');
  }
  if (!campaign.controls) throw new Error('EVALUATION_REGRESSION_CONTROL_NO_KNOWN_HIT');
  campaign.stability = 'PASS_METRICS_AND_NON_LATENCY_COST';
  campaign.known_weak_baseline = campaign.pairs.some(pair => {
    const comparison = json(path.join(repo, pair.comparison));
    return comparison.status === 'VALID' && Object.values(comparison.metrics).some(metric => metric.baseline_hits < metric.total);
  });
  if (!campaign.known_weak_baseline) throw new Error('EVALUATION_WEAK_BASELINE_NOT_DETECTED');
  campaign.baseline_runs = campaign.candidate_runs = benchmark.cases.length * repeats;
  writeJson(path.join(out, 'campaign.json'), campaign);
  const rows = campaign.pairs.filter(pair => pair.repetition === 1)
    .map(pair => summarize(pair.case_id, json(path.join(repo, pair.comparison))));
  fs.writeFileSync(path.join(out, 'human-readable-summary.md'), `# #107 冻结语料评估\n\nREPO_SHA = ${repoSha}\nBENCHMARK_VERSION = ${benchmark.benchmark_version}\n\n${campaign.case_count} 个 authored-curated 合成案例；两个 arm 各 ${campaign.baseline_runs} 次独立冷运行。\n\n| case | aspect | counterposition | key evidence | extra retrieval calls | result |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n\n已实跑确认 weak baseline、degraded-copy regression 和 contamination INVALID；质量指标与非时延成本重复稳定。壁钟、时间戳及 occurrence 身份是 documented nondeterminism。\n\nTier 2 dogfood = NOT_RUN；预检原因 = ${campaign.dogfood.reason}。实际模型调用 = 0；token/money cost = UNKNOWN。Tier 1 只证明 HARNESS_INTEGRITY 与该合成语料中的配置差异，不能证明开放世界产品价值或 exhaustive research。\n`);
  return campaign;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const arg = key => args[args.indexOf(`--${key}`) + 1];
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const expected = arg('expected-head');
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(expected ?? '') || actual !== expected) throw new Error('EVALUATION_EXACT_HEAD_REQUIRED');
  const sourcePaths = ['research-orchestration', 'corpus-anthology', 'zhihu-answer-grabber', 'AGENTS.md', 'RULES.md', 'docs/specs', '.github'];
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...sourcePaths], { cwd: repo, encoding: 'utf8' }).trim();
  if (dirty) throw new Error('EVALUATION_EXACT_SOURCE_DIRTY');
  const outputRel = arg('out');
  if (!outputRel || path.isAbsolute(outputRel) || outputRel.split(/[\\/]/).includes('..')) throw new Error('EVALUATION_REPO_RELATIVE_OUTPUT_REQUIRED');
  const campaign = runBenchmark({ repo, out: path.join(repo, outputRel),
    productRoot: path.join(repo, 'work', `p2-f01-products-${path.basename(outputRel)}`), repoSha: actual });
  console.log(JSON.stringify({ repo_sha: actual, case_count: campaign.case_count, stability: campaign.stability, controls: campaign.controls }));
}
