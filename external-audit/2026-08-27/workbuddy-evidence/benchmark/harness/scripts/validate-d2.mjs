// validate-d2.mjs — REQUIRED VALIDATIONS (§11 + ChatGPT D2 correction review).
// VAL1-10 from the D2 task; VAL11-16 added per the D2 conversion correction.
// FAIL CLOSED.

import fs from 'node:fs';
import path from 'node:path';
import { loadCase, computeDatasetVersion } from '../lib/case-loader.mjs';
import { deriveValueUnits } from '../lib/value-units.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const REAL = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode'];
const ALL = [...REAL, 'case-synth-dominance', 'case-synth-expert'];
const ADJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmark/adjudication/TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json'), 'utf8'));

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

// 3: c2-vendor-neutrality dropped
{
  const l477 = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: 'case-477427067' });
  const clusterIds = l477.gold.families.contradiction.claim_clusters.map((c) => c.claim_id);
  check('VAL3 c2-vendor-neutrality dropped', !clusterIds.some((id) => id === 'c2-vendor-neutrality' || id.endsWith(':c2-vendor-neutrality')), 'clusters=' + clusterIds.join(','));
}

// 4: historical_authority UNRESOLVED + relevance-gated unresolved stats
{
  let allOk = true;
  for (const c of REAL) {
    const l = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: c });
    const ha = l.gold.families.historical_authority;
    const rel = new Set(l.gold.families.relevance.sources);
    if (ha.label_status !== 'UNRESOLVED' || ha.sources.length !== 0) allOk = false;
    const badUnres = ha.unresolved_sources.filter((s) => !rel.has(s));
    if (badUnres.length) { allOk = false; console.log(`      ${c}: unresolved_sources includes non-relevant: ${badUnres.join(',')}`); }
  }
  check('VAL4 historical_authority UNRESOLVED + relevance-gated unresolved', allOk);
}

// 5: relevance gate
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
  check('VAL6 xq4 revised provenance groups', !!xq4 && groupIds.includes('vendor-self-promotion') && groupIds.includes('independent-or-countervailing-evaluation'), 'groups=' + groupIds.join(','));
}

// 7 + 15: value units rebuilt from D2 gold (derived D1 vs derived D2)
{
  let ok = true;
  const details = [];
  for (const c of REAL) {
    const d1Gold = JSON.parse(fs.readFileSync(path.join(CASES, c, 'gold.d1.json'), 'utf8'));
    const cur = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: c });
    const d1Units = JSON.stringify(deriveValueUnits(d1Gold));
    const d2Units = JSON.stringify(cur.valueUnits);
    if (d1Units === d2Units) { ok = false; details.push(c + ': derived D1 units identical to D2'); }
    // VAL14: critical_aspect unit count matches Final KEEP aspect count
    const keepCount = Object.values(ADJ.case_schema_decisions[c].aspects || {}).filter((v) => v === 'KEEP').length;
    const critAspects = cur.valueUnits.filter((u) => u.unit_type === 'critical_aspect' && u.scorable).length;
    if (critAspects !== keepCount) { ok = false; details.push(`${c}: critical_aspect units=${critAspects} != KEEP aspects=${keepCount}`); }
  }
  check('VAL7/VAL14/VAL15 D2 units derived from D2 gold; critical_aspect matches KEEP aspects', ok, details.join('; '));
}

// 8 + 16: dataset version identity is semantically D2
{
  let ok = true;
  const details = [];
  for (const c of REAL) {
    const cur = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: c });
    if (!cur.dataset_version.startsWith('d2-')) { ok = false; details.push(c + ': version not d2- prefixed: ' + cur.dataset_version); }
    const d1Gold = JSON.parse(fs.readFileSync(path.join(CASES, c, 'gold.d1.json'), 'utf8'));
    const d1Hash = computeDatasetVersion({ corpusDir: CORPUS, gold: d1Gold, valueUnits: deriveValueUnits(d1Gold), freshnessWindowPolicy: cur.caseCfg.freshness_window_policy, generation: 'd1' });
    if (d1Hash === cur.dataset_version) { ok = false; details.push(c + ': D1 and D2 hashes identical'); }
  }
  check('VAL8/VAL16 dataset version d2- prefix, differs from D1', ok, details.join('; '));
}

// 9: all 8 cases rerun as D2
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
      if (r.budget.K !== cfg.budgets.K_MEDIUM) { ok = false; details.push(`${c}/${s}: K=${r.budget.K} != ${cfg.budgets.K_MEDIUM}`); }
    }
    if (budgets.size !== 1) { ok = false; details.push(c + ': budgets differ'); }
  }
  check('VAL10 fair budgets equal across strategies', ok, details.join('; '));
}

// VAL11: exact Final aspect ID set matches adjudication KEEP set (all 6 real cases)
{
  let ok = true;
  const details = [];
  const EXPECTED = { 'case-439521858': 4, 'case-477427067': 4, 'case-466695857': 3, 'case-485463474': 1, 'case-487214224': 1, 'case-cross-lowcode': 6 };
  for (const c of REAL) {
    const l = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: c });
    const keepSet = Object.entries(ADJ.case_schema_decisions[c].aspects || {}).filter(([k, v]) => v === 'KEEP').map(([k]) => k).sort();
    const actual = l.gold.families.aspect_membership.aspects.map((a) => a.aspect_id).sort();
    if (JSON.stringify(keepSet) !== JSON.stringify(actual)) { ok = false; details.push(`${c}: keep=[${keepSet}] actual=[${actual}]`); }
    if (actual.length !== EXPECTED[c]) { ok = false; details.push(`${c}: count ${actual.length} != expected ${EXPECTED[c]}`); }
  }
  check('VAL11/VAL13 exact aspect ID set + counts match adjudication KEEP set (4/4/3/1/1/6)', ok, details.join('; '));
}

// VAL12: every aspect membership exact-match case_label adjudication + relevance gate
{
  let ok = true;
  const details = [];
  for (const c of REAL) {
    const l = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId: c });
    const rel = new Set(l.gold.families.relevance.sources);
    // expected membership from case_label_decisions
    const expected = new Map(); // aspect key -> Set
    for (const d of ADJ.case_label_decisions.filter((x) => x.case_id === c)) {
      if (!rel.has(d.source_id)) continue; // relevance gate
      for (const a of (d.labels.aspect_ids && d.labels.aspect_ids.value) || []) {
        if (!expected.has(a)) expected.set(a, new Set());
        expected.get(a).add(d.source_id);
      }
    }
    for (const a of l.gold.families.aspect_membership.aspects) {
      const got = new Set(a.sources || []);
      const want = expected.get(a.aspect_id) || new Set();
      const extra = [...got].filter((s) => !want.has(s));
      const missing = [...want].filter((s) => !got.has(s));
      if (extra.length || missing.length) { ok = false; details.push(`${c}/${a.aspect_id}: extra=${extra.join(',')} missing=${missing.join(',')}`); }
    }
  }
  check('VAL12 every aspect membership exact-match adjudication + relevance gate', ok, details.join('; '));
}

console.log(failures.length ? `\nVALIDATION_FAILED (${failures.length})` : '\nALL_VALIDATIONS_PASSED');
process.exit(failures.length ? 1 : 0);
