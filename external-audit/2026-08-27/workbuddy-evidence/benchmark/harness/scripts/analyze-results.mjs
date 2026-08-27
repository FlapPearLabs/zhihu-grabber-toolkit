// Analyze CORRECTED pilot results — compact tables for the correction packet.
import fs from 'node:fs';
import path from 'node:path';

const RUNS = path.resolve('benchmark/results/runs');
const files = fs.readdirSync(RUNS).filter((f) => f.endsWith('.json'));
const rows = files.map((f) => JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')));

const CASE_ORDER = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode', 'case-synth-dominance', 'case-synth-expert'];
const FAIR = ['B0_POPULARITY_TOP_K', 'B1_LEXICAL_NGRAM_PROXY', 'B2_MMR_NGRAM_PROXY'];
const ORACLE = 'B2_ORACLE_LANES';
const num = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v));

console.log('== FAIR COMPARISON (K_MEDIUM) — corrected metrics ==');
for (const c of CASE_ORDER) {
  console.log('\n### ' + c);
  for (const s of FAIR) {
    const r = rows.find((x) => x.case_id === c && x.strategy_id === s && x.budget.key === 'K_MEDIUM');
    if (!r) continue;
    const m = r.metric_results;
    console.log(`  ${s.padEnd(22)} sel=${r.selected_source_ids.length}`
      + ` | must=${num(m.must_see_recall.value)} aspect=${num(m.aspect_recall.value)} exp=${num(m.expert_recall.value)} lt=${num(m.long_tail_recall.value)}`
      + ` | freshW=${num(m.fresh_window_membership_recall.value)} freshRel=${num(m.fresh_content_recall.value)}`
      + ` | evPres=${num(m.evidence_presence_recall.value)} evQual=${num(m.evidence_rich_recall.value)}`
      + ` | contra=${num(m.contradiction_claim_recall.value)} xq=${num(m.cross_question_claim_recall.value)}`
      + ` | semRed=${num(m.semantic_redundancy.value)} claimRed=${num(m.claim_redundancy.value)}`
      + ` | div=${num(m.normalized_question_diversity.value)} macro=${num(m.minority_question_recall_macro.value)} min=${num(m.minority_question_recall_min.value)}`
      + ` | ops=${m.cost.relative_compute_ops} stab=${num(r.stability.value)}`);
  }
}

console.log('\n== ORACLE (UPPER_BOUND_DIAGNOSTIC_ONLY, EXCLUDED from fair comparison) ==');
for (const c of CASE_ORDER) {
  const r = rows.find((x) => x.case_id === c && x.strategy_id === ORACLE && x.budget.key === 'K_MEDIUM');
  if (!r) continue;
  console.log(`  ${c.padEnd(22)} exp=${num(r.metric_results.expert_recall.value)} contra=${num(r.metric_results.contradiction_claim_recall.value)} lt=${num(r.metric_results.long_tail_recall.value)} semRed=${num(r.metric_results.semantic_redundancy.value)} ops=${r.metric_results.cost.relative_compute_ops} excluded=${r.strategy_config.excluded_from_fair_comparison}`);
}

console.log('\n== SPOTLIGHT: synth dominance (K_MEDIUM) — fair set ==');
for (const s of FAIR) {
  const r = rows.find((x) => x.case_id === 'case-synth-dominance' && x.strategy_id === s && x.budget.key === 'K_MEDIUM');
  if (!r) continue;
  const conc = r.metric_results.source_concentration;
  console.log(`  ${s.padEnd(22)} largest_share=${num(conc.largest_question_share)} selByQ=${JSON.stringify(conc.selected_content_by_question)} exp=${num(r.metric_results.expert_recall.value)} contra=${num(r.metric_results.contradiction_claim_recall.value)} macro=${num(r.metric_results.minority_question_recall_macro.value)} min=${num(r.metric_results.minority_question_recall_min.value)}`);
}

console.log('\n== SPOTLIGHT: cross-question (case-cross-lowcode, K_MEDIUM) ==');
for (const s of FAIR) {
  const r = rows.find((x) => x.case_id === 'case-cross-lowcode' && x.strategy_id === s && x.budget.key === 'K_MEDIUM');
  if (!r) continue;
  const conc = r.metric_results.source_concentration;
  console.log(`  ${s.padEnd(22)} largest_share=${num(conc.largest_question_share)} selByQ=${JSON.stringify(conc.selected_content_by_question)} xq=${num(r.metric_results.cross_question_claim_recall.value)} macro=${num(r.metric_results.minority_question_recall_macro.value)} min=${num(r.metric_results.minority_question_recall_min.value)} div=${num(r.metric_results.normalized_question_diversity.value)}`);
}

console.log('\n== SPOTLIGHT: expert preservation (case-synth-expert, K_MEDIUM) ==');
for (const s of FAIR) {
  const r = rows.find((x) => x.case_id === 'case-synth-expert' && x.strategy_id === s && x.budget.key === 'K_MEDIUM');
  if (!r) continue;
  console.log(`  ${s.padEnd(22)} expert_recall=${num(r.metric_results.expert_recall.value)} must=${num(r.metric_results.must_see_recall.value)} semRed=${num(r.metric_results.semantic_redundancy.value)} ops=${r.metric_results.cost.relative_compute_ops}`);
}

console.log('\n== B2 (mechanical) vs B1 delta — K_MEDIUM fair set ==');
for (const c of CASE_ORDER) {
  const b1 = rows.find((x) => x.case_id === c && x.strategy_id === 'B1_LEXICAL_NGRAM_PROXY' && x.budget.key === 'K_MEDIUM');
  const b2 = rows.find((x) => x.case_id === c && x.strategy_id === 'B2_MMR_NGRAM_PROXY' && x.budget.key === 'K_MEDIUM');
  if (!b1 || !b2) continue;
  const g = (r, k) => (typeof r.metric_results[k].value === 'number' ? r.metric_results[k].value : null);
  const dSemRed = g(b2, 'semantic_redundancy') !== null && g(b1, 'semantic_redundancy') !== null ? g(b2, 'semantic_redundancy') - g(b1, 'semantic_redundancy') : 'N/A';
  const dMust = g(b2, 'must_see_recall') !== null && g(b1, 'must_see_recall') !== null ? g(b2, 'must_see_recall') - g(b1, 'must_see_recall') : 'N/A';
  const dExp = g(b2, 'expert_recall') !== null && g(b1, 'expert_recall') !== null ? g(b2, 'expert_recall') - g(b1, 'expert_recall') : 'N/A';
  const dMacro = g(b2, 'minority_question_recall_macro') !== null && g(b1, 'minority_question_recall_macro') !== null ? g(b2, 'minority_question_recall_macro') - g(b1, 'minority_question_recall_macro') : 'N/A';
  console.log(`  ${c.padEnd(22)} dSemRed=${num(dSemRed)} dMustSee=${num(dMust)} dExpert=${num(dExp)} dMacro=${num(dMacro)} opsB1=${b1.metric_results.cost.relative_compute_ops} opsB2=${b2.metric_results.cost.relative_compute_ops}`);
}

console.log('\n== STABILITY (all fair runs should be 1.0 — deterministic) ==');
const fairRows = rows.filter((r) => !r.strategy_config.excluded_from_fair_comparison);
const stabVals = fairRows.map((r) => r.stability.value);
console.log('fair runs:', fairRows.length, '| min stability:', Math.min(...stabVals).toFixed(4), '| unique:', [...new Set(stabVals)].join(','));

console.log('\n== ORACLE exclusion audit ==');
const oracleRows = rows.filter((r) => r.strategy_config.excluded_from_fair_comparison);
console.log('oracle runs flagged excluded_from_fair_comparison:', oracleRows.length === 24 ? '24/24 OK' : 'MISMATCH ' + oracleRows.length);
console.log('fair runs (not oracle):', rows.length - oracleRows.length === 72 ? '72/72 OK' : 'MISMATCH');
