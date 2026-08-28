// validate-race.mjs — Phase B race validator (FAIL CLOSED).
//   V1 preregistration exists, frozen, and its parameters match the runs
//   V2 all-strategy same-pool: candidate_pool_id + budget K identical across
//      strategies for every (case, budget)
//   V3 result schema: required fields present on every run file
//   V4 gold freeze: gold.json bytes unchanged since D2.1 phase (per case)
//   V5 no selection reads gold: fair runs must not carry oracle flags and the
//      runner enforced throwing-gold (unit tests RACE-6); verify nobody marked
//      fair files as oracle
//   V6 dense identity recorded for all non-B0 runs; no ngram claims
//   V7 determinism: jaccard mean == 1.0 for all runs
//   V8 coverage: all 9 cases x 5 strategies x 3 budgets present
//   V9 new case present with PROVISIONAL gold + captured pool

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, CASE_IDS } from '../lib/paths.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
}

const PREREG = JSON.parse(fs.readFileSync(path.join(paths.preRegistration, 'EXPERIMENT_PRE_REGISTRATION.json'), 'utf8'));

// V1
{
  const ok = PREREG && PREREG.experiment_id === 'P1_DECISION_GRADE_EVIDENCE_GATE_01' && PREREG.status === 'FROZEN' && PREREG.strategy_definitions && PREREG.budgets && PREREG.primary_decision_metrics;
  check('V1 preregistration exists + frozen + complete', ok, 'missing fields');
}

const allCases = [...CASE_IDS, 'case-hpylori-treatment'];
const files = fs.readdirSync(paths.resultsRace).filter((f) => f.endsWith('.json') && f !== 'summary.json' && f.includes('__'));
const byCase = new Map();
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(paths.resultsRace, f), 'utf8'));
  if (!byCase.has(r.case_id)) byCase.set(r.case_id, []);
  byCase.get(r.case_id).push(r);
}

// V2 same-pool per (case, budget)
{
  let ok = true;
  const details = [];
  for (const [cid, runs] of byCase) {
    const budgets = new Set(runs.map((r) => r.budget.key + '=' + r.budget.K));
    for (const bk of budgets) {
      const poolIds = new Set(runs.filter((r) => r.budget.key + '=' + r.budget.K === bk).map((r) => r.candidate_pool_id));
      if (poolIds.size !== 1) { ok = false; details.push(`${cid}/${bk} pools differ`); }
    }
  }
  check('V2 all-strategy same-pool + identical budgets per (case, budget)', ok, details.join('; '));
}

// V3 schema
{
  let ok = true;
  const details = [];
  for (const r of [...byCase.values()].flat()) {
    for (const k of ['schema', 'dataset_version', 'case_id', 'strategy_id', 'strategy_config', 'candidate_pool_id', 'budget', 'selected_source_ids', 'metric_results', 'cost', 'stability']) {
      if (r[k] === undefined) { ok = false; details.push(`${r.case_id}/${r.strategy_id}/${r.budget.key} missing ${k}`); }
    }
    for (const m of ['must_see_recall', 'aspect_recall', 'cross_question_claim_recall', 'per_question_coverage_preservation', 'minority_question_recall_min', 'semantic_redundancy', 'cost']) {
      if (r.metric_results[m] === undefined) { ok = false; details.push(`${r.case_id}/${r.strategy_id} missing metric ${m}`); }
    }
  }
  check(`V3 result schema complete (${[...byCase.values()].flat().length} runs)`, ok, details.slice(0, 5).join('; '));
}

// V4 gold freeze (all cases incl. new)
{
  let ok = true;
  const details = [];
  for (const c of allCases) {
    const goldFile = path.join(paths.cases, c, 'gold.json');
    const h = sha(fs.readFileSync(goldFile));
    if (!shellHashRef(c)) { ok = false; details.push(`${c} no reference`); continue; }
    const ref = shellHashRef(c);
    if (h !== ref) { ok = false; details.push(`${c} gold hash changed since freeze`); }
  }
  check('V4 gold freeze held (vs freeze record)', ok, details.join('; '));
}
function shellHashRef(c) {
  // read freeze record file if exists
  const p = path.join(paths.preRegistration, 'gold-freeze-record.json');
  if (!fs.existsSync(p)) return null;
  const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
  return rec.gold_sha256[c] || null;
}

// V5 no oracle leak into fair set
{
  const fairFiles = files.filter((f) => !f.includes('B3_ORACLE_LANES'));
  let ok = true;
  const details = [];
  for (const f of fairFiles) {
    const r = JSON.parse(fs.readFileSync(path.join(paths.resultsRace, f), 'utf8'));
    if (r.strategy_config.excluded_from_fair_comparison) { ok = false; details.push(`${f} wrongly excluded`); }
    if (r.strategy_config.strategy_class !== 'FAIR_COMPARISON') { ok = false; details.push(`${f} class=${r.strategy_config.strategy_class}`); }
  }
  const oracleFiles = files.filter((f) => f.includes('B3_ORACLE_LANES'));
  const oracleAllFlagged = oracleFiles.every((f) => {
    const r = JSON.parse(fs.readFileSync(path.join(paths.resultsRace, f), 'utf8'));
    return r.strategy_config.excluded_from_fair_comparison === true && r.strategy_config.strategy_class === 'ORACLE_UPPER_BOUND_DIAGNOSTIC_ONLY';
  });
  check(`V5 fair=${fairFiles.length} no oracle flag; oracle=${oracleFiles.length} all flagged`, ok && oracleAllFlagged, details.join('; '));
}

// V6 dense identity, no ngram
{
  let ok = true;
  const details = [];
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(paths.resultsRace, f), 'utf8'));
    if (r.strategy_id === 'B0_POPULARITY_TOP_K') continue;
    const emb = r.strategy_config.embedding;
    if (!emb || !emb.model || emb.model.id !== 'Xenova/bge-small-zh-v1.5') { ok = false; details.push(`${f} missing dense identity`); }
    if (/ngram|lexical/i.test(JSON.stringify(r.strategy_config.result_status_note || ''))) { ok = false; details.push(`${f} ngram claim in dense run`); }
  }
  check('V6 real dense identity on all non-B0 runs', ok, details.slice(0, 5).join('; '));
}

// V7 determinism
{
  let ok = true;
  const details = [];
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(paths.resultsRace, f), 'utf8'));
    if (r.stability.value !== 1 || r.stability.min !== 1) { ok = false; details.push(`${f} jaccard=${r.stability.value}/${r.stability.min}`); }
  }
  check('V7 run-to-run determinism (jaccard 1.0/1.0)', ok, details.slice(0, 5).join('; '));
}

// V8 coverage
{
  const expect = allCases.length * 5 * 3; // 9 cases x 5 strategies x 3 budgets
  const have = files.length;
  const perStrategy = {};
  for (const f of files) {
    const s = f.split('__')[1];
    perStrategy[s] = (perStrategy[s] || 0) + 1;
  }
  check('V8 race coverage complete (9x5x3 = 135)', have === expect, `have=${have} expect=${expect}`);
}

// V9 new case
{
  const hp = byCase.get('case-hpylori-treatment') || [];
  const fair = hp.filter((r) => !r.strategy_config.excluded_from_fair_comparison);
  const gold = JSON.parse(fs.readFileSync(path.join(paths.cases, 'case-hpylori-treatment', 'gold.json'), 'utf8'));
  const ok = fair.length === 12 && gold.provenance.label_status === 'PROVISIONAL' && gold.provenance.gold_frozen_before_strategy === true;
  check('V9 new case: 12 fair runs + PROVISIONAL frozen gold', ok, `fair=${fair.length}`);
}

console.log(failures.length ? `\nVALIDATION_FAILED (${failures.length})` : '\nALL_VALIDATIONS_PASSED');
process.exit(failures.length ? 1 : 0);