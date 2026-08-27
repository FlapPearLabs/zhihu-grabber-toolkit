// run-pilot.mjs — CORRECTED Stage A (mechanical/sanity) pilot runner.
// Fair-comparison strategies (P0-1 / P1-1):
//   B0_POPULARITY_TOP_K, B1_LEXICAL_NGRAM_PROXY, B2_MMR_NGRAM_PROXY (mechanical lanes)
// Diagnostic-only (UPPER_BOUND; excluded from fair comparison):
//   B2_ORACLE_LANES (gold lanes)
// For every case x strategy x budget:
//   - runs the selector R=3 times (stability)
//   - computes the corrected metric set on the deterministic selection
//   - enforces dataset/gold/value-units/freshness freeze before & after
//   - checks OUT_OF_POOL_DISCOVERY (closed-pool invariant)
//   - writes one machine-readable result JSON per (case, strategy, budget)
//   - writes a condensed summary.json
// All results are HARNESS_SANITY_ONLY: B1/B2 use the deterministic n-gram proxy
// (NOT the frozen Dense Embedding design), and real semantic gold is PROVISIONAL.

import fs from 'node:fs';
import path from 'node:path';
import { loadCase, makeFreezeSnapshot, assertFreezeHeld } from '../lib/case-loader.mjs';
import { embed } from '../lib/embeddings.mjs';
import { selectPopularityTopK, selectLexicalNgramTopK, selectMMRMultiLane, assignMechanicalLanes, assignOracleLanes, defaultLaneOrder, computeQuotas } from '../lib/selectors.mjs';
import { computeMetrics, jaccardStability } from '../lib/metrics.mjs';
import { buildResult, writeResult, sanitize } from '../lib/results.mjs';
import { runtimeIdentity } from '../lib/runtime.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const RUNS = path.join(ROOT, 'benchmark/results/runs');

const CASE_IDS = [
  'case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224',
  'case-cross-lowcode', 'case-synth-dominance', 'case-synth-expert',
];

// FAIR comparison set (no evaluation gold) + ORACLE diagnostic (gold lanes)
const FAIR_STRATEGIES = ['B0_POPULARITY_TOP_K', 'B1_LEXICAL_NGRAM_PROXY', 'B2_MMR_NGRAM_PROXY'];
const ORACLE_STRATEGY = 'B2_ORACLE_LANES';
const STABILITY_RUNS = 3;

class CostRecorder {
  constructor() { this.c = { embedding_calls: 0, embedding_cache_hits: 0, pairwise_similarity_calls: 0, selection_ops: 0, wall_ms: 0 }; this.t0 = Date.now(); }
  add(o) { for (const [k, v] of Object.entries(o)) this.c[k] = (this.c[k] || 0) + v; }
  snapshot() { this.c.wall_ms = Date.now() - this.t0; return { ...this.c }; }
}

function queryText(caseCfg, pool) {
  const titles = pool.questions.map((q) => q.title).join(' ');
  return (caseCfg.research_question || '') + ' ' + titles;
}

function buildProvenance(selected, pool) {
  return selected.map((id) => {
    const s = pool.byId.get(id);
    return {
      source_id: id,
      question_id: s ? s.question_id : null,
      author_key: s ? s.author_key : null,
      voteupCount: s ? s.voteupCount : null,
      createdTime: s ? s.createdTime : null,
    };
  });
}

function runStrategy(strategyId, pool, K, ctx) {
  const cost = new CostRecorder();
  let selected;
  let laneKinds = null;
  if (strategyId === 'B0_POPULARITY_TOP_K') {
    selected = selectPopularityTopK(pool, K, { cost });
  } else if (strategyId === 'B1_LEXICAL_NGRAM_PROXY') {
    selected = selectLexicalNgramTopK(pool, K, { queryText: ctx.queryText, embedCache: ctx.embedCache }, { cost });
  } else if (strategyId === 'B2_MMR_NGRAM_PROXY') {
    const lanes = assignMechanicalLanes(pool, ctx.caseCfg); // NO gold access (P0-1)
    laneKinds = Object.fromEntries(Object.entries(lanes).map(([id, l]) => [id, l.kind]));
    const laneOrder = defaultLaneOrder();
    const quotas = computeQuotas(K, lanes, laneOrder, ctx.caseCfg.lane_weights || {});
    selected = selectMMRMultiLane(pool, K, {
      queryText: ctx.queryText, embedCache: ctx.embedCache,
      lambda: ctx.caseCfg.mmr_lambda ?? 0.5, lanes, laneOrder, quotas,
    }, { cost });
  } else if (strategyId === 'B2_ORACLE_LANES') {
    const lanes = assignOracleLanes(pool, ctx.caseCfg, ctx.gold); // GOLD lanes — diagnostic only
    laneKinds = Object.fromEntries(Object.entries(lanes).map(([id, l]) => [id, l.kind]));
    const laneOrder = defaultLaneOrder();
    const quotas = computeQuotas(K, lanes, laneOrder, ctx.caseCfg.lane_weights || {});
    selected = selectMMRMultiLane(pool, K, {
      queryText: ctx.queryText, embedCache: ctx.embedCache,
      lambda: ctx.caseCfg.mmr_lambda ?? 0.5, lanes, laneOrder, quotas,
    }, { cost });
  } else {
    throw new Error('UNKNOWN_STRATEGY: ' + strategyId);
  }
  return { selected, cost: cost.snapshot(), laneKinds };
}

async function main() {
  fs.mkdirSync(RUNS, { recursive: true });
  const summaryRows = [];
  const allWarnings = [];

  for (const caseId of CASE_IDS) {
    const loaded = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId });
    const { caseCfg, gold, pool, dataset_version, goldStats } = loaded;
    const before = makeFreezeSnapshot(loaded);
    const embedCache = new Map();
    const ctx = { caseCfg, gold, queryText: queryText(caseCfg, pool), embedCache };

    for (const [budgetKey, K] of Object.entries(caseCfg.budgets)) {
      for (const strategyId of [...FAIR_STRATEGIES, ORACLE_STRATEGY]) {
        const oracle = strategyId === ORACLE_STRATEGY;
        const runs = [];
        for (let r = 0; r < STABILITY_RUNS; r++) {
          runs.push(runStrategy(strategyId, pool, K, ctx));
        }
        const selected = runs[0].selected;
        const cost = runs[0].cost;
        const laneKinds = runs[0].laneKinds;
        const poolIds = new Set(pool.sources.map((s) => s.source_id));
        const outOfPool = selected.filter((id) => !poolIds.has(id));
        const warnings = [];
        if (outOfPool.length) warnings.push({ type: 'OUT_OF_POOL_DISCOVERY', count: outOfPool.length, source_ids: outOfPool });
        if (pool.verifiedSourceCount === 0) warnings.push({ type: 'POOL_NOT_VERIFIED', note: 'captured != verified; analysis_coverage N/A' });
        if (oracle) warnings.push({ type: 'ORACLE_UPPER_BOUND_DIAGNOSTIC_ONLY', note: 'gold lanes; EXCLUDED from fair comparison' });

        const metrics = computeMetrics({ caseCfg, gold, pool, selected, cost, extra: { embedCache } });
        const stability = jaccardStability(runs.map((r) => r.selected));

        const strategy_config = {
          strategy_id: strategyId,
          budget_key: budgetKey,
          K,
          tie_break: 'source_id_asc',
          query_text_source: 'case.research_question + question titles',
          mmr_lambda: strategyId.startsWith('B2') ? (caseCfg.mmr_lambda ?? 0.5) : null,
          lane_weights: strategyId.startsWith('B2') ? (caseCfg.lane_weights || {}) : null,
          lane_kinds: laneKinds,
          embedding_runtime: strategyId === 'B0_POPULARITY_TOP_K' ? null : runtimeIdentity().embedding_runtime,
          strategy_class: oracle ? 'ORACLE_UPPER_BOUND_DIAGNOSTIC_ONLY' : 'FAIR_COMPARISON',
          excluded_from_fair_comparison: oracle,
          result_status: 'HARNESS_SANITY_ONLY',
          result_status_note: oracle
            ? 'UPPER_BOUND_DIAGNOSTIC ONLY; never enters B0/B1/B2 fair comparison'
            : 'B1/B2 use deterministic lexical n-gram proxy (NOT frozen Dense Embedding); real semantic gold = HUMAN_ADJUDICATED (ChatGPT); ngram results remain harness evidence only',
        };

        const result = buildResult({
          dataset_version,
          dataset_version_status: process.env.DATASET_STATUS || 'D2',
          case_id: caseId,
          case_meta: {
            category: caseCfg.category,
            question_count: pool.questionIds.length,
            source_count: pool.sources.length,
            verified_source_count: pool.verifiedSourceCount,
            gold_label_status: gold.provenance.label_status,
            gold_adjudication_status: gold.provenance.adjudication_status,
            scoring_status: gold.provenance.label_status === 'HUMAN_ADJUDICATED' ? 'HUMAN_ADJUDICATED_SEMANTIC' : 'FIXTURE_MECHANICAL',
          },
          strategy_id: strategyId,
          strategy_config,
          candidate_pool_id: pool.candidate_pool_id,
          budget: { key: budgetKey, K },
          selected_source_ids: selected,
          provenance: buildProvenance(selected, pool),
          metric_results: metrics,
          gold_stats_by_family: goldStats,
          cost,
          stability,
          warnings,
          notes: 'D2 run. Real semantic gold = HUMAN_ADJUDICATED (ChatGPT, TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json); synthetic = FIXTURE_MECHANICAL. HARNESS_SANITY_ONLY: ngram proxy, not production embedding. No FINAL benchmark winner claims.',
        });

        const file = path.join(RUNS, `${caseId}__${strategyId}__${budgetKey}.json`);
        writeResult(result, file);
        allWarnings.push(...warnings);

        summaryRows.push({
          case_id: caseId, strategy_id: strategyId, budget_key: budgetKey, K,
          oracle: oracle || false,
          selected_count: selected.length,
          must_see_recall: metrics.must_see_recall.value,
          aspect_recall: metrics.aspect_recall.value,
          aspect_source_recall_diagnostic: metrics.aspect_source_recall_diagnostic.value,
          expert_recall: metrics.expert_recall.value,
          long_tail_recall: metrics.long_tail_recall.value,
          fresh_window_membership_recall: metrics.fresh_window_membership_recall.value,
          fresh_content_recall: metrics.fresh_content_recall.value,
          historical_authority_retention: metrics.historical_authority_retention.value,
          evidence_presence_recall: metrics.evidence_presence_recall.value,
          evidence_rich_recall: metrics.evidence_rich_recall.value,
          contradiction_claim_recall: metrics.contradiction_claim_recall.value,
          cross_question_claim_recall: metrics.cross_question_claim_recall.value,
          semantic_redundancy: metrics.semantic_redundancy.value,
          claim_redundancy: metrics.claim_redundancy.value,
          analysis_coverage: metrics.analysis_coverage.value,
          normalized_question_diversity: metrics.normalized_question_diversity.value,
          largest_question_share: metrics.source_concentration.largest_question_share,
          minority_macro: metrics.minority_question_recall_macro.value,
          minority_min: metrics.minority_question_recall_min.value,
          independent_source_diversity: metrics.independent_source_diversity.value,
          relative_compute_ops: metrics.cost.relative_compute_ops,
          wall_clock_ms: metrics.cost.wall_clock_ms,
          jaccard_mean: stability.value,
          jaccard_min: stability.min,
          false_stop_rate: metrics.false_stop_rate.value,
        });
      }
    }

    const after = makeFreezeSnapshot(loaded);
    try {
      assertFreezeHeld(before, after);
    } catch (e) {
      allWarnings.push({ type: 'FREEZE_VIOLATION', case_id: caseId, message: e.message });
      throw e;
    }
  }

  const summary = {
    schema: 'zhihu-research-benchmark/summary',
    schema_version: '3.0.0-d2',
    generated_at: new Date().toISOString(),
    dataset_version_status: process.env.DATASET_STATUS || 'D2',
    result_status: 'HARNESS_SANITY_ONLY',
    d2: 'CREATED',
    semantic_gold: 'HUMAN_ADJUDICATED (real cases; ChatGPT adjudication V1) / FIXTURE_MECHANICAL (synthetic)',
    stability_runs: STABILITY_RUNS,
    embedding_runtime: runtimeIdentity().embedding_runtime,
    fair_comparison_strategies: FAIR_STRATEGIES,
    oracle_strategy: { id: ORACLE_STRATEGY, note: 'UPPER_BOUND_DIAGNOSTIC_ONLY; excluded_from_fair_comparison' },
    rows: summaryRows,
    warnings: allWarnings,
  };
  fs.writeFileSync(path.join(ROOT, 'benchmark/results/summary.json'), JSON.stringify(sanitize(summary), null, 2));
  console.log('D2_RERUN_COMPLETE');
  console.log('runs written:', summaryRows.length, '(fair=' + summaryRows.filter((r) => !r.oracle).length + ', oracle=' + summaryRows.filter((r) => r.oracle).length + ')');
  console.log('warnings:', allWarnings.length ? JSON.stringify(allWarnings.slice(0, 3)) : 'none');
}

main().catch((e) => { console.error('PILOT_RUN_FAILED', e); process.exit(1); });
