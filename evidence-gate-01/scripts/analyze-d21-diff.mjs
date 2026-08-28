// analyze-d21-diff.mjs — D2 vs D2.1 metric diff (A3 requirement).
// D2 baseline = frozen pilot results pack (runs-corrected-d2).
// D2.1        = this experiment's corrected-evaluator rerun (results/d21).
// Both used identical frozen inputs (corpus/gold/selectors/ngram/budgets/cases);
// the ONLY difference is the evaluator semantics (value-unit question
// provenance + per-question credit). This script reports EXACTLY which metric
// fields changed and by how much, per (case, strategy, budget).

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../lib/paths.mjs';

const D2_DIR = path.resolve(paths.root, '../external-audit/2026-08-27/workbuddy-evidence/benchmark/results/runs-corrected-d2');
const D21_DIR = path.join(paths.root, 'results/d21');

const TRACKED_METRICS = [
  'must_see_recall', 'aspect_recall', 'expert_recall', 'long_tail_recall',
  'fresh_window_membership_recall', 'fresh_content_recall', 'evidence_presence_recall',
  'evidence_rich_recall', 'contradiction_claim_recall', 'cross_question_claim_recall',
  'semantic_redundancy', 'claim_redundancy', 'analysis_coverage',
  'normalized_question_diversity', 'minority_question_recall_macro',
  'minority_question_recall_min', 'independent_source_diversity',
];

const files = fs.readdirSync(D21_DIR).filter((f) => f.endsWith('.json') && f !== 'summary.json').sort();

const diffRows = [];
const metricChanged = new Map();
for (const f of files) {
  const d21 = JSON.parse(fs.readFileSync(path.join(D21_DIR, f), 'utf8'));
  const d2File = path.join(D2_DIR, f);
  if (!fs.existsSync(d2File)) {
    diffRows.push({ file: f, status: 'NO_D2_BASELINE' });
    continue;
  }
  const d2 = JSON.parse(fs.readFileSync(d2File, 'utf8'));
  const changes = [];
  for (const m of TRACKED_METRICS) {
    const a = d2.metric_results[m]?.value;
    const b = d21.metric_results[m]?.value;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ metric: m, d2: a, d21: b });
      metricChanged.set(m, (metricChanged.get(m) || 0) + 1);
    }
  }
  // per-question detail comparison (unit basis)
  const pqA = d2.metric_results.per_question_coverage_preservation;
  const pqB = d21.metric_results.per_question_coverage_preservation;
  const pqChanged = JSON.stringify(pqA?.per_question) !== JSON.stringify(pqB?.per_question);
  const pqD2 = pqA ? Object.fromEntries(Object.entries(pqA.per_question || {}).map(([q, v]) => [q, `${v.covered_units}/${v.scorable_units}`])) : null;
  const pqD21 = pqB ? Object.fromEntries(Object.entries(pqB.per_question || {}).map(([q, v]) => [q, `${v.covered_units}/${v.scorable_units}`])) : null;
  if (pqChanged) metricChanged.set('per_question_coverage_preservation', (metricChanged.get('per_question_coverage_preservation') || 0) + 1);
  diffRows.push({
    file: f,
    case_id: d21.case_id,
    strategy_id: d21.strategy_id,
    budget_key: d21.budget.key,
    K: d21.budget.K,
    selection_identical: JSON.stringify(d21.selected_source_ids) === JSON.stringify(d2.selected_source_ids),
    dataset_version_d2: d2.dataset_version,
    dataset_version_d21: d21.dataset_version,
    changed_metrics: changes,
    per_question_d2: pqChanged ? pqD2 : undefined,
    per_question_d21: pqChanged ? pqD21 : undefined,
  });
}

const changedFiles = diffRows.filter((r) => r.changed_metrics?.length || r.per_question_d2);
const summary = {
  schema: 'zhihu-research-benchmark/d2-to-d21-diff',
  generated_at: new Date().toISOString(),
  files_compared: diffRows.length,
  files_with_any_metric_change: changedFiles.length,
  files_with_selection_identical: diffRows.filter((r) => r.selection_identical).length,
  metric_change_frequency: Object.fromEntries([...metricChanged.entries()].sort((a, b) => b[1] - a[1])),
  note: 'selection_identical=true proves inputs/selectors frozen; all metric deltas are evaluator-only',
  rows: diffRows,
};
fs.writeFileSync(path.join(paths.resultsD21, 'd2-to-d21-diff.json'), JSON.stringify(summary, null, 2));
console.log('D2_TO_D2.1_DIFF_WRITTEN');
console.log('files compared:', diffRows.length, '| with metric changes:', changedFiles.length);
console.log('metric change frequency:', JSON.stringify(Object.fromEntries([...metricChanged.entries()].sort((a, b) => b[1] - a[1])), null, 0));
// highlight cross-lowcode per-question deltas for the packet
const xq = diffRows.filter((r) => r.case_id === 'case-cross-lowcode' && r.per_question_d2 && !r.strategy_id.endsWith('ORACLE_LANES'));
for (const r of xq.slice(0, 3)) {
  console.log('---', r.strategy_id, r.budget_key, '---');
  console.log('  d2 :', JSON.stringify(r.per_question_d2));
  console.log('  d21:', JSON.stringify(r.per_question_d21));
}