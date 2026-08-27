// validate-d2.mjs — REQUIRED VALIDATIONS (§11 of the D2 task).
//   1. case-485463474 relevant Gold source count = 2
//   2. case-487214224 relevant Gold source count = 1
//   3. case-477427067 c2-vendor-neutrality NOT in contradiction Gold
//   4. all real historical_authority = UNRESOLVED / excluded
//   5. irrelevant sources NOT in expert/must-see/evidence denominators
//   6. xq4 uses revised provenance groups (vendor-self-promotion + independent/countervailing)
//   7. D1 value units NOT silently reused (drift detection / content differs)
//   8. D2 dataset hash != D1 hash
//   9. all 8 cases rerun (96 runs with dataset_version_status=D2)
//  10. fair strategy budgets remain equal
// FAIL CLOSED.

import fs from 'node:fs';
import path from 'node:path';
import { loadCase, computeDatasetVersion } from '../lib/case-loader.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const REAL = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode'];
const ALL = [...REAL, 'case-synth-dominance', 'case-synth-expert'];

const failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
}

// 1 & 2: relevance counts
{
  const l485 = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: 'case-485463474' });
  const l487 = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: 'case-487214224' });
  check('VAL1 case-485463474 relevant=2', l485.gold.families.relevance.sources.length === 2, 'got ' + l485.gold.families.relevance.sources.length);
  check('VAL2 case-487214224 relevant=1', l487.gold.families.relevance.sources.length === 1, 'got ' + l487.gold.families.relevance.sources.length);
}

// 3: c2-vendor-neutrality dropped from contradiction gold
{
  const l477 = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: 'case-477427067' });
  const clusterIds = l477.gold.families.contradiction.claim_clusters.map((c) => c.claim_id);
  check('VAL3 c2-vendor-neutrality dropped', !clusterIds.some((id) => id === 'c2-vendor-neutrality' || id.endsWith(':c2-vendor-neutrality')), 'clusters=' + clusterIds.join(','));
}

// 4: historical_authority UNRESOLVED everywhere (real cases)
{
  let allUnresolved = true;
  for (const c of REAL) {
    const l = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: c });
    const ha = l.gold.families.historical_authority;
    if (ha.label_status !== 'UNRESOLVED' || ha.sources.length !== 0) allUnresolved = false;
  }
  check('VAL4 historical_authority UNRESOLVED for all real cases', allUnresolved);
}

// 5: irrelevant sources excluded from expert/must_see/evidence denominators
{
  let ok = true;
  const details = [];
  for (const c of REAL) {
    const l = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: c });
    const rel = new Set(l.gold.families.relevance.sources);
    for (const fam of ['must_see', 'expertise_topic_match', 'evidence_quality', 'unique_long_tail_contribution']) {
      const famObj = l.gold.families[fam];
      const srcs = (famObj && famObj.sources) || [];
      const bad = srcs.filter((s) => !rel.has(s));
      if (bad.length) { ok = false; details.push(`${c}/${fam}: ${bad.join(',')}`); }
    }
  }
  check('VAL5 relevance gate holds for scored families', ok, details.join('; '));
}

// 6: xq4 revised provenance groups
{
  const l = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: 'case-cross-lowcode' });
  const xq4 = l.gold.families.required_provenance_groups.claim_groups.find((g) => g.claim_id === 'xq4-vendor-tension');
  const groupIds = (xq4 ? xq4.required_provenance_groups : []).map((g) => g.group_id);
  const hasVendor = groupIds.includes('vendor-self-promotion');
  const hasIndependent = groupIds.includes('independent-or-countervailing-evaluation');
  check('VAL6 xq4 revised provenance groups', !!xq4 && hasVendor && hasIndependent, 'groups=' + groupIds.join(','));
}

// 7: D1 value units not silently reused
{
  let ok = true;
  const details = [];
  for (const c of REAL) {
    const unitsFile = path.join(CASES, c, 'value-units.json');
    const d1GoldFile = path.join(CASES, c, 'gold.d1.json');
    if (!fs.existsSync(d1GoldFile)) { ok = false; details.push(c + ': missing gold.d1.json'); continue; }
    const d1Gold = JSON.parse(fs.readFileSync(d1GoldFile, 'utf8'));
    const d1Units = JSON.stringify(d1Gold.value_units || []);
    const d2Units = fs.readFileSync(unitsFile, 'utf8');
    if (d1Units === d2Units.trim()) { ok = false; details.push(c + ': value-units identical to D1'); }
  }
  check('VAL7 D2 value units rebuilt (differ from D1)', ok, details.join('; '));
}

// 8: D2 dataset hash != D1 hash
{
  let ok = true;
  const details = [];
  for (const c of REAL) {
    const d1Gold = JSON.parse(fs.readFileSync(path.join(CASES, c, 'gold.d1.json'), 'utf8'));
    const cur = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: c });
    const d1Hash = computeDatasetVersion({ corpusDir: CORPUS, gold: d1Gold, valueUnits: d1Gold.value_units || [], freshnessWindowPolicy: cur.caseCfg.freshness_window_policy });
    if (d1Hash === cur.dataset_version) { ok = false; details.push(c + ': hash unchanged'); }
  }
  check('VAL8 D2 dataset hash != D1', ok, details.join('; '));
}

// 9: all 8 cases rerun with D2 status
{
  const runsDir = path.join(ROOT, 'benchmark/results/runs');
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json'));
  const casesRun = new Set();
  let allD2 = true;
  let fair = 0, oracle = 0;
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
    casesRun.add(r.case_id);
    if (r.dataset_version_status !== 'D2') allD2 = false;
    if (r.strategy_config.excluded_from_fair_comparison) oracle++; else fair++;
  }
  check('VAL9 all 8 cases rerun as D2', files.length === 96 && casesRun.size === 8 && allD2, `files=${files.length} cases=${casesRun.size} allD2=${allD2}`);
  console.log(`      fair=${fair} oracle=${oracle}`);
}

// 10: fair budgets equal
{
  const runsDir = path.join(ROOT, 'benchmark/results/runs');
  let ok = true;
  const details = [];
  for (const c of ALL) {
    const cfg = JSON.parse(fs.readFileSync(path.join(CASES, c, 'case.json'), 'utf8'));
    const budgets = new Set();
    for (const s of ['B0_POPULARITY_TOP_K', 'B1_LEXICAL_NGRAM_PROXY', 'B2_MMR_NGRAM_PROXY']) {
      const file = path.join(runsDir, `${c}__${s}__K_MEDIUM.json`);
      if (!fs.existsSync(file)) { ok = false; details.push(c + ' missing run ' + s); continue; }
      const r = JSON.parse(fs.readFileSync(file, 'utf8'));
      budgets.add(r.budget.K);
      if (r.budget.K !== cfg.budgets.K_MEDIUM) { ok = false; details.push(`${c}/${s}: K=${r.budget.K} != case config ${cfg.budgets.K_MEDIUM}`); }
    }
    if (budgets.size !== 1) { ok = false; details.push(c + ': budgets differ across strategies'); }
  }
  check('VAL10 fair budgets equal across strategies', ok, details.join('; '));
}

console.log(failures.length ? `\nVALIDATION_FAILED (${failures.length})` : '\nALL_VALIDATIONS_PASSED');
process.exit(failures.length ? 1 : 0);
