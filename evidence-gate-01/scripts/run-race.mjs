// run-race.mjs — Phase B four-strategy fair race (P1 gate-01).
// Fair: B0_POPULARITY_TOP_K, B1_DENSE_SEMANTIC_TOP_K, B2_QUESTION_STRATIFIED_SIMPLE,
//       B3_DENSE_MMR_MULTI_LANE
// Diagnostic (excluded): B3_ORACLE_LANES (gold lanes, UPPER_BOUND)
// All 9 cases (8 pilot + new case-hpylori-treatment), all budgets, R=3 stability.
// Real dense embeddings via lib/dense-embed.mjs; inputs frozen per
// EXPERIMENT_PRE_REGISTRATION.json (created BEFORE this run).
// No-Gold-leak: fair strategies receive a throwing-gold proxy.

import fs from 'node:fs';
import path from 'node:path';
import { loadCase, makeFreezeSnapshot, assertFreezeHeld } from '../lib/case-loader.mjs';
import { selectPopularityTopK } from '../lib/selectors.mjs';
import { selectDenseSemanticTopK, selectQuestionStratifiedSimple, selectDenseMMRMultiLane, assignMechanicalLanes, assignOracleLanes, defaultLaneOrder, computeQuotas, DENSE_MODEL } from '../lib/selectors-race.mjs';
import { computeMetrics, jaccardStability } from '../lib/metrics.mjs';
import { buildResult, writeResult, sanitize } from '../lib/results.mjs';
import { embeddingIdentity, loadDiskCache, saveDiskCache, embedDense, denseCosine } from '../lib/dense-embed.mjs';
import { paths, CASE_IDS, REAL_CASE_IDS } from '../lib/paths.mjs';

const ALL_CASES = [...CASE_IDS, 'case-hpylori-treatment'];
const FAIR_STRATEGIES = ['B0_POPULARITY_TOP_K', 'B1_DENSE_SEMANTIC_TOP_K', 'B2_QUESTION_STRATIFIED_SIMPLE', 'B3_DENSE_MMR_MULTI_LANE'];
const ORACLE_STRATEGY = 'B3_ORACLE_LANES';
const STABILITY_RUNS = 3;
const NOVELTY_THRESHOLD = 0.9;

class CostRecorder {
  constructor() { this.c = { embedding_calls: 0, embedding_cache_hits: 0, pairwise_similarity_calls: 0, selection_ops: 0, wall_ms: 0 }; this.t0 = Date.now(); }
  add(o) { for (const [k, v] of Object.entries(o)) { if (k === 'cache_hits') this.c.embedding_cache_hits = (this.c.embedding_cache_hits || 0) + v; else this.c[k] = (this.c[k] || 0) + v; } }
  snapshot() { this.c.wall_ms = Date.now() - this.t0; return { ...this.c }; }
}

// Throwing gold proxy — fair strategies MUST not read evaluation gold.
function goldGate(gold) {
  return new Proxy(gold, {
    get(target, prop, receiver) {
      if (['families', 'value_units'].includes(prop)) {
        throw new Error('GOLD_READ_VIOLATION_FAIR_STRATEGY');
      }
      return Reflect.get(target, prop, receiver);
    },
  });
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

async function runStrategy(strategyId, pool, K, ctx) {
  const cost = new CostRecorder();
  let selected;
  let laneKinds = null;
  const embedCache = ctx.embedCache;
  const fairGold = goldGate(ctx.gold);
  if (strategyId === 'B0_POPULARITY_TOP_K') {
    selected = selectPopularityTopK(pool, K, { cost });
  } else if (strategyId === 'B1_DENSE_SEMANTIC_TOP_K') {
    selected = await selectDenseSemanticTopK(pool, K, { queryText: ctx.queryText, embedCache }, { cost });
  } else if (strategyId === 'B2_QUESTION_STRATIFIED_SIMPLE') {
    selected = await selectQuestionStratifiedSimple(pool, K, { queryText: ctx.queryText, embedCache, noveltyThreshold: NOVELTY_THRESHOLD }, { cost });
  } else if (strategyId === 'B3_DENSE_MMR_MULTI_LANE') {
    // mechanical lanes only; goldGate gold is passed but never touched
    const lanes = assignMechanicalLanes(pool, ctx.caseCfg, fairGold);
    laneKinds = Object.fromEntries(Object.entries(lanes).map(([id, l]) => [id, l.kind]));
    const laneOrder = defaultLaneOrder();
    const quotas = computeQuotas(K, lanes, laneOrder, ctx.caseCfg.lane_weights || {});
    selected = await selectDenseMMRMultiLane(pool, K, {
      queryText: ctx.queryText, embedCache,
      lambda: ctx.caseCfg.mmr_lambda ?? 0.5, lanes, laneOrder, quotas,
    }, { cost });
  } else if (strategyId === 'B3_ORACLE_LANES') {
    const lanes = assignOracleLanes(pool, ctx.caseCfg, ctx.gold); // gold lanes — diagnostic only
    laneKinds = Object.fromEntries(Object.entries(lanes).map(([id, l]) => [id, l.kind]));
    const laneOrder = defaultLaneOrder();
    const quotas = computeQuotas(K, lanes, laneOrder, ctx.caseCfg.lane_weights || {});
    selected = await selectDenseMMRMultiLane(pool, K, {
      queryText: ctx.queryText, embedCache,
      lambda: ctx.caseCfg.mmr_lambda ?? 0.5, lanes, laneOrder, quotas,
    }, { cost });
  } else {
    throw new Error('UNKNOWN_STRATEGY: ' + strategyId);
  }
  return { selected, cost: cost.snapshot(), laneKinds };
}

async function main() {
  fs.mkdirSync(paths.resultsRace, { recursive: true });
  const embedCache = loadDiskCache();
  const summaryRows = [];
  const allWarnings = [];
  let totalEmbedCalls = 0;
  let totalCacheHits = 0;

  for (const caseId of ALL_CASES) {
    const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId });
    const { caseCfg, gold, pool, dataset_version, goldStats } = loaded;
    const before = makeFreezeSnapshot(loaded);
    const ctx = { caseCfg, gold, queryText: queryText(caseCfg, pool), embedCache };

    for (const [budgetKey, K] of Object.entries(caseCfg.budgets)) {
      for (const strategyId of [...FAIR_STRATEGIES, ORACLE_STRATEGY]) {
        const oracle = strategyId === ORACLE_STRATEGY;
        const runs = [];
        for (let r = 0; r < STABILITY_RUNS; r++) {
          runs.push(await runStrategy(strategyId, pool, K, ctx));
        }
        const selected = runs[0].selected;
        const cost = runs[0].cost;
        const laneKinds = runs[0].laneKinds;
        const poolIds = new Set(pool.sources.map((s) => s.source_id));
        const outOfPool = selected.filter((id) => !poolIds.has(id));
        const warnings = [];
        if (outOfPool.length) warnings.push({ type: 'OUT_OF_POOL_DISCOVERY', count: outOfPool.length, source_ids: outOfPool });
        if (oracle) warnings.push({ type: 'ORACLE_UPPER_BOUND_DIAGNOSTIC_ONLY', note: 'gold lanes; EXCLUDED from winner comparison' });
        // track dense-cache stats across runs for the summary
        for (const r of runs) { totalEmbedCalls += r.cost.embedding_calls; totalCacheHits += r.cost.embedding_cache_hits; }

        const metrics = computeMetrics({ caseCfg, gold, pool, selected, cost, extra: { embedCache: new Map() } }); // fresh ngram cache: dense cache must never mix with ngram feature maps
        // Override redundancy with the REAL DENSE backend (same vectors as selection)
        {
          const denseVecs = [];
          for (const sid of selected) {
            const src = pool.byId.get(sid);
            if (src) denseVecs.push((await embedDense(src.content_text, embedCache)).vec);
          }
          if (denseVecs.length >= 2) {
            let sum = 0; let n = 0;
            for (let i = 0; i < denseVecs.length; i++) {
              for (let j = i + 1; j < denseVecs.length; j++) {
                sum += await denseCosine(denseVecs[i], denseVecs[j]);
                n += 1;
              }
            }
            metrics.semantic_redundancy = { value: sum / n, pairs: n, scoring_status: 'REAL_DENSE_BACKEND' };
            metrics.semantic_diversity = { value: 1 - metrics.semantic_redundancy.value };
          }
        }
        const stability = jaccardStability(runs.map((r) => r.selected));

        const strategy_config = {
          strategy_id: strategyId,
          budget_key: budgetKey,
          K,
          tie_break: 'source_id_asc',
          query_text_source: 'case.research_question + question titles',
          embedding: strategyId === 'B0_POPULARITY_TOP_K' ? null : embeddingIdentity(),
          mmr_lambda: strategyId.startsWith('B3') ? (caseCfg.mmr_lambda ?? 0.5) : null,
          lane_weights: strategyId.startsWith('B3') ? (caseCfg.lane_weights || {}) : null,
          lane_kinds: laneKinds,
          novelty_threshold: strategyId === 'B2_QUESTION_STRATIFIED_SIMPLE' ? NOVELTY_THRESHOLD : null,
          floor_rule: strategyId === 'B2_QUESTION_STRATIFIED_SIMPLE' ? 'floor_q = 1 per non-empty question (candidate-structure only)' : null,
          strategy_class: oracle ? 'ORACLE_UPPER_BOUND_DIAGNOSTIC_ONLY' : 'FAIR_COMPARISON',
          excluded_from_fair_comparison: oracle,
          experiment_preregistration: 'pre-registration/EXPERIMENT_PRE_REGISTRATION.json (version 1.0.0)',
          result_status: 'D2.1_EVALUATOR + REAL_DENSE_RACE',
          result_status_note: oracle
            ? 'UPPER_BOUND DIAGNOSTIC ONLY; never enters B0/B1/B2/B3 winner comparison'
            : 'real dense embedding (bge-small-zh-v1.5 fp32); D2.1 corrected evaluator; preregistration frozen before run',
        };

        const result = buildResult({
          dataset_version,
          dataset_version_status: 'D2.1',
          case_id: caseId,
          case_meta: {
            category: caseCfg.category,
            question_count: pool.questionIds.length,
            source_count: pool.sources.length,
            verified_source_count: pool.verifiedSourceCount,
            gold_label_status: gold.provenance.label_status,
            gold_adjudication_status: gold.provenance.adjudication_status,
            scoring_status: gold.provenance.label_status === 'HUMAN_ADJUDICATED' ? 'HUMAN_ADJUDICATED_SEMANTIC' : (gold.provenance.label_status === 'PROVISIONAL' ? 'PROVISIONAL_SEMANTIC' : 'FIXTURE_MECHANICAL'),
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
          notes: 'P1 gate-01 Phase B race. Fair strategies never read evaluation gold (throwing-gold proxy). Preregistration 1.0.0 frozen before run.',
        });

        const file = path.join(paths.resultsRace, `${caseId}__${strategyId}__${budgetKey}.json`);
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

  saveDiskCache(embedCache);

  const summary = {
    schema: 'zhihu-research-benchmark/summary-race-d21',
    schema_version: '3.0.0-d21-race',
    generated_at: new Date().toISOString(),
    dataset_version_status: 'D2.1',
    result_status: 'D2.1_EVALUATOR + REAL_DENSE_RACE',
    experiment_preregistration: 'pre-registration/EXPERIMENT_PRE_REGISTRATION.json 1.0.0 (frozen before run)',
    dense_model: DENSE_MODEL,
    stability_runs: STABILITY_RUNS,
    fair_comparison_strategies: FAIR_STRATEGIES,
    oracle_strategy: { id: ORACLE_STRATEGY, note: 'UPPER_BOUND_DIAGNOSTIC_ONLY; excluded_from_fair_comparison' },
    dense_embedding_total_calls: totalEmbedCalls,
    dense_embedding_total_cache_hits: totalCacheHits,
    dense_embedding_cache_file: 'dense-embedding/cache/embedding-cache.json',
    rows: summaryRows,
    warnings: allWarnings,
  };
  fs.writeFileSync(path.join(paths.resultsRace, 'summary.json'), JSON.stringify(sanitize(summary), null, 2));
  console.log('RACE_COMPLETE');
  console.log('runs written:', summaryRows.length, '(fair=' + summaryRows.filter((r) => !r.oracle).length + ', oracle=' + summaryRows.filter((r) => r.oracle).length + ')');
  console.log('dense embedding calls:', totalEmbedCalls, '| cache hits:', totalCacheHits);
  console.log('warnings:', allWarnings.length ? JSON.stringify(allWarnings.slice(0, 3)) : 'none');
}

main().catch((e) => { console.error('RACE_RUN_FAILED', e); process.exit(1); });