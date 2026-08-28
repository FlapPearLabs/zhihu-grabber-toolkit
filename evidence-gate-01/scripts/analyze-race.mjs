// analyze-race.mjs — condense race results into decision tables.

import fs from 'node:fs';
import path from 'node:path';
import { paths, CASE_IDS } from '../lib/paths.mjs';

const NEW_CASE = 'case-hpylori-treatment';
const ALL = [...CASE_IDS, NEW_CASE];
const FAIR = ['B0_POPULARITY_TOP_K', 'B1_DENSE_SEMANTIC_TOP_K', 'B2_QUESTION_STRATIFIED_SIMPLE', 'B3_DENSE_MMR_MULTI_LANE'];

function load() {
  const runs = [];
  for (const f of fs.readdirSync(paths.resultsRace)) {
    if (!f.endsWith('.json') || f === 'summary.json') continue;
    runs.push(JSON.parse(fs.readFileSync(path.join(paths.resultsRace, f), 'utf8')));
  }
  return runs;
}

const num = (m) => (m && m.value !== 'N/A' && typeof m.value === 'number' ? m.value : null);
const fmt = (v) => (v === null || v === undefined ? 'N/A' : Number(v).toFixed(3));

export function buildTables() {
  const runs = load();
  const out = { tables: [] };

  // Per-case, per-budget, per-strategy full comparison (fair only + oracle note)
  for (const c of ALL) {
    const budgets = [...new Set(runs.filter((r) => r.case_id === c).map((r) => r.budget.key))];
    for (const bk of budgets) {
      const rows = [];
      for (const s of [...FAIR, 'B3_ORACLE_LANES']) {
        const r = runs.find((x) => x.case_id === c && x.strategy_id === s && x.budget.key === bk);
        if (!r) continue;
        rows.push({
          strategy: s,
          oracle: r.strategy_config.excluded_from_fair_comparison === true,
          K: r.budget.K,
          must_see: num(r.metric_results.must_see_recall),
          aspect: num(r.metric_results.aspect_recall),
          xq_claim: num(r.metric_results.cross_question_claim_recall),
          per_q: r.metric_results.per_question_coverage_preservation,
          minority_macro: num(r.metric_results.minority_question_recall_macro),
          minority_min: num(r.metric_results.minority_question_recall_min),
          diversity: num(r.metric_results.normalized_question_diversity),
          redundancy: num(r.metric_results.semantic_redundancy),
          cost_ops: r.metric_results.cost ? r.metric_results.cost.relative_compute_ops : null,
          wall_ms: r.cost.wall_clock_ms,
          selected: r.selected_source_ids,
        });
      }
      out.tables.push({ case_id: c, budget_key: bk, rows });
    }
  }
  return out;
}

function summary() {
  const runs = load();
  const agg = [];
  const metricKeys = ['must_see', 'aspect', 'xq_claim', 'minority_min', 'redundancy', 'diversity'];
  for (const c of ALL) {
    for (const bk of ['K_SMALL', 'K_MEDIUM', 'K_LARGE']) {
      for (const s of FAIR) {
        const r = runs.find((x) => x.case_id === c && x.strategy_id === s && x.budget.key === bk);
        if (!r) continue;
        agg.push({
          case_id: c,
          domain: c === NEW_CASE ? 'new-medical' : (c.includes('synth') ? 'synthetic' : 'lowcode'),
          budget_key: bk,
          strategy: s,
          must_see: num(r.metric_results.must_see_recall),
          aspect: num(r.metric_results.aspect_recall),
          xq_claim: num(r.metric_results.cross_question_claim_recall),
          minority_min: num(r.metric_results.minority_question_recall_min),
          minority_macro: num(r.metric_results.minority_question_recall_macro),
          redundancy: num(r.metric_results.semantic_redundancy),
          diversity: num(r.metric_results.normalized_question_diversity),
          cost_ops: r.metric_results.cost ? r.metric_results.cost.relative_compute_ops : null,
        });
      }
    }
  }
  return agg;
}

export function printSummary() {
  const agg = summary();
  for (const bk of ['K_SMALL', 'K_MEDIUM', 'K_LARGE']) {
    console.log(`\n===== ${bk} =====`);
    for (const c of ALL) {
      console.log(`--- ${c} ---`);
      for (const s of FAIR) {
        const r = agg.find((x) => x.case_id === c && x.strategy === s && x.budget_key === bk);
        if (!r) continue;
        console.log(
          `${s.padEnd(28)} must=${fmt(r.must_see)} asp=${fmt(r.aspect)} xq=${fmt(r.xq_claim)} amin=${fmt(r.minority_min)} red=${fmt(r.redundancy)} ops=${r.cost_ops}`,
        );
      }
    }
  }
}

export function winnerCounts() {
  const agg = summary();
  const counts = {};
  const totals = { must_see: 0, aspect: 0, xq_claim: 0, minority_min: 0, redundancy_low: 0, cost_low: 0 };
  // For each (case, budget): count who wins per primary metric (ties -> shared)
  for (const c of ALL) {
    for (const bk of ['K_SMALL', 'K_MEDIUM', 'K_LARGE']) {
      const rows = agg.filter((r) => r.case_id === c && r.budget_key === bk);
      for (const m of ['must_see', 'aspect', 'xq_claim', 'minority_min']) {
        const vals = rows.filter((r) => r[m] !== null);
        if (!vals.length) continue;
        const best = Math.max(...vals.map((r) => r[m]));
        const winners = vals.filter((r) => r[m] === best).map((r) => r.strategy);
        for (const w of winners) {
          counts[w] = counts[w] || { must_see: 0, aspect: 0, xq_claim: 0, minority_min: 0, redundancy_low: 0, cost_low: 0 };
          counts[w][m]++;
        }
        totals[m]++;
      }
      // redundancy: LOWER is better
      {
        const vals = rows.filter((r) => r.redundancy !== null);
        if (vals.length) {
          const best = Math.min(...vals.map((r) => r.redundancy));
          for (const w of vals.filter((r) => r.redundancy === best).map((r) => r.strategy)) {
            counts[w] = counts[w] || { must_see: 0, aspect: 0, xq_claim: 0, minority_min: 0, redundancy_low: 0, cost_low: 0 };
            counts[w].redundancy_low++;
          }
          totals.redundancy_low++;
        }
      }
      // cost: LOWER is better
      {
        const ops = rows.filter((r) => r.cost_ops !== null);
        const best = Math.min(...ops.map((r) => r.cost_ops));
        for (const w of ops.filter((r) => r.cost_ops === best).map((r) => r.strategy)) {
          counts[w] = counts[w] || { must_see: 0, aspect: 0, xq_claim: 0, minority_min: 0, redundancy_low: 0, cost_low: 0 };
          counts[w].cost_low++;
        }
        totals.cost_low++;
      }
    }
  }
  return { counts, totals };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  printSummary();
  console.log('\n===== WINNER COUNTS (ties shared) =====');
  const { counts, totals } = winnerCounts();
  for (const s of FAIR) {
    if (counts[s]) console.log(s.padEnd(28), JSON.stringify(counts[s]));
  }
  console.log('totals:', JSON.stringify(totals));
  // persist table artifact
  fs.writeFileSync(path.join(paths.resultsRace, 'decision-tables.json'), JSON.stringify(buildTables(), null, 2));
  console.log('decision-tables.json written');
}