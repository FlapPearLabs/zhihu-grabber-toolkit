// adjudicated-rescore.mjs — §4-§7 FIXED_SELECTION_RESCORING_ONLY.
// Applies the ChatGPT second adjudication to case-hpylori-treatment gold,
// rebuilds value units, and RE-SCORES the frozen race selections WITHOUT
// calling any selector. Also re-scores case-cross-lowcode (unchanged gold)
// for the cross-domain comparison on the same code path.
//
// Inputs (frozen, read-only):
//   cases/case-hpylori-treatment/gold.json          (PROVISIONAL original)
//   adjudication/CHATGPT_SECOND_ADJUDICATION_GATE01_V1.json
//   results/race/*__*.json                          (frozen B0/B1/B2/B3
//                                                    selections + oracle)
// Outputs:
//   cases/case-hpylori-treatment/GOLD_BEFORE_SECOND_ADJUDICATION.json
//   cases/case-hpylori-treatment/GOLD_AFTER_SECOND_ADJUDICATION.json
//   cases/case-hpylori-treatment/SECOND_ADJUDICATION_DIFF.json
//   results/adjudicated-rescore/{all-runs.json, summary.json,
//         before-after-metric-diff.json, decision-tables.json,
//         architecture-outcome.json}

import fs from 'node:fs';
import path from 'node:path';
import { paths, CASE_IDS } from '../lib/paths.mjs';
import { loadCase } from '../lib/case-loader.mjs';
import { deriveValueUnits, scorableUnitsByQuestion, unitsCoveredForQuestion } from '../lib/value-units.mjs';
import { computeMetrics } from '../lib/metrics.mjs';
import { embed } from '../lib/embeddings.mjs';

const NEW = 'case-hpylori-treatment';
const ADJ = path.join(paths.root, 'adjudication/CHATGPT_SECOND_ADJUDICATION_GATE01_V1.json');
const OU = path.join(paths.root, 'results/adjudicated-rescore');
const OUT_GOLD = path.join(paths.cases, NEW);

const costStub = { snapshot: () => ({}) };

function loadRuns() {
  const runs = [];
  for (const f of fs.readdirSync(path.join(paths.root, 'results/race'))) {
    if (!f.endsWith('.json') || !f.includes('__')) continue;
    runs.push(JSON.parse(fs.readFileSync(path.join(paths.root, 'results/race', f), 'utf8')));
  }
  return runs;
}

// ---- apply adjudication to a gold object (mechanical, label-driven) --------
export function applyAdjudication(gold, packet, decisions) {
  const g = JSON.parse(JSON.stringify(gold));
  const fam = g.families;
  const labelIdx = new Map(packet.labels.map((l) => [l.label_id, l]));
  const bySource = new Map();
  for (const l of packet.labels) {
    if (!bySource.has(l.source_id)) bySource.set(l.source_id, []);
    bySource.get(l.source_id).push(l);
  }

  const decisionFor = (labelId) => {
    const d = decisions.get(labelId) || decisions.get('MS:' + labelId);
    return d ? String(d).toUpperCase() : null;
  };

  const removedMustSee = [];
  const promotedCandidates = [];
  const removedStance = [];   // {claim_id, stance, source}
  const removedAspect = [];   // {aspect_id, source}

  // ---- must_see family -------------------------------------------------
  const msSet = new Set(fam.must_see.sources);
  const promoted = [];
  for (const l of packet.labels) {
    if (l.kind === 'must_see') {
      const d = decisionFor(l.label_id);
      if (d === 'NO' && msSet.has(l.source_id)) {
        msSet.delete(l.source_id);
        removedMustSee.push(l.source_id);
      }
      // YES -> keep; UNSURE -> keep (conservative, recorded in diff)
    } else if (l.kind === 'must_see_candidate') {
      const d = decisionFor(l.label_id);
      if (d === 'YES') {
        msSet.add(l.source_id);
        promoted.push(l.source_id);
        promotedCandidates.push(l.source_id);
      }
    }
  }
  fam.must_see.sources = [...msSet].sort();

  // ---- contradiction stances -------------------------------------------
  for (const c of fam.contradiction.claim_clusters) {
    for (const [stance, sids] of Object.entries(c.stances || {})) {
      const kept = sids.filter((sid) => {
        const l = (bySource.get(sid) || []).find((x) => x.kind === 'contradiction_stance' && x.stance === stance);
        if (!l) return true; // not in packet -> unchanged
        const d = decisionFor(l.label_id);
        if (d === 'NO') { removedStance.push({ claim_id: c.claim_id, stance, source: sid }); return false; }
        return true;
      });
      if (kept.length === 0) delete c.stances[stance];
      else c.stances[stance] = kept;
    }
    if (Object.keys(c.stances || {}).length === 0) c.disputed = true; // both sides gone -> drop cluster
  }
  fam.contradiction.claim_clusters = fam.contradiction.claim_clusters.filter((c) => !c.disputed);

  // ---- cross-question aspects ------------------------------------------
  for (const a of fam.aspect_membership.aspects) {
    const kept = (a.primary_sources || []).filter((sid) => {
      const l = (bySource.get(sid) || []).find((x) => x.kind === 'cross_question_aspect' && x.aspect_id === a.aspect_id);
      if (!l) return true;
      const d = decisionFor(l.label_id);
      if (d === 'NO') { removedAspect.push({ aspect_id: a.aspect_id, source: sid }); return false; }
      return true;
    });
    if (kept.length === 0) a.disputed = true;
    else a.primary_sources = kept;
  }
  fam.aspect_membership.aspects = fam.aspect_membership.aspects.filter((a) => !a.disputed);

  // ---- provenance bookkeeping -------------------------------------------
  g.provenance.adjudication_status = 'SECOND_ADJUDICATION_APPLIED';
  g.provenance.adjudicated_by = 'ChatGPT (CHATGPT_SECOND_ADJUDICATION_GATE01_V1)';
  g.provenance.label_status = 'SECOND_ADJUDICATED';
  g.provenance.adjudication_applied_mechanically = new Date().toISOString();
  g.provenance.decision_summary = {
    must_see_removed: removedMustSee,
    must_see_promoted: promotedCandidates,
    stance_removals: removedStance,
    aspect_removals: removedAspect,
  };

  // frozen value_units field must be dropped — rebuilt downstream
  delete g.value_units;
  return { gold: g, removedMustSee, promotedCandidates, removedStance, removedAspect };
}

// ---- metric computation (same sync backend as D2.1, dense redundancy refit) -
function computeFor(gold, caseCfg, pool, selected, denseVecs) {
  const metrics = computeMetrics({ caseCfg, gold, pool, selected, cost: costStub, extra: { embedCache: new Map() } });
  if (denseVecs && denseVecs.length >= 2) {
    let sum = 0; let n = 0;
    for (let i = 0; i < denseVecs.length; i++) {
      for (let j = i + 1; j < denseVecs.length; j++) {
        let dot = 0, na = 0, nb = 0;
        for (let k = 0; k < denseVecs[i].length; k++) { dot += denseVecs[i][k] * denseVecs[j][k]; na += denseVecs[i][k] ** 2; nb += denseVecs[j][k] ** 2; }
        sum += Math.max(0, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
        n += 1;
      }
    }
    metrics.semantic_redundancy = { value: n ? sum / n : 0, pairs: n, scoring_status: 'REAL_DENSE_BACKEND' };
    metrics.semantic_diversity = { value: 1 - (n ? sum / n : 0) };
  }
  return metrics;
}

function main() {
  if (!fs.existsSync(ADJ)) { console.error('MISSING ' + ADJ); process.exit(2); }
  const adj = JSON.parse(fs.readFileSync(ADJ, 'utf8'));
  const packet = JSON.parse(fs.readFileSync(path.join(paths.root, 'adjudication/decision-sensitive-packet.json'), 'utf8'));
  const decisions = new Map();
  {
    const raw = adj.decisions || adj;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item && item.label_id != null) decisions.set(item.label_id, item.decision);
      }
    } else {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'object' && v !== null && v.decision !== undefined) decisions.set(k, v.decision);
        else decisions.set(k, v);
      }
    }
  }

  fs.mkdirSync(OU, { recursive: true });
  const runs = loadRuns();
  const newRuns = runs.filter((r) => r.case_id === NEW);
  const crossRuns = runs.filter((r) => r.case_id === 'case-cross-lowcode');
  const fair = (r) => r.strategy_config && !r.strategy_config.excluded_from_fair_comparison;
  const byKey = (rs) => new Map(rs.map((r) => [`${r.strategy_id}@${r.budget.key}`, r]));

  // ---------- before gold snapshot (from frozen race-time gold) ----------
  const beforeGoldPath = path.join(paths.cases, NEW, 'gold.json');
  fs.copyFileSync(beforeGoldPath, path.join(OUT_GOLD, 'GOLD_BEFORE_SECOND_ADJUDICATION.json'));
  const beforeGold = JSON.parse(fs.readFileSync(beforeGoldPath, 'utf8'));

  // ---------- apply adjudication ------------------------------------------
  const { gold: afterGold, removedMustSee, promotedCandidates, removedStance, removedAspect } = applyAdjudication(beforeGold, packet, decisions);
  fs.writeFileSync(path.join(OUT_GOLD, 'GOLD_AFTER_SECOND_ADJUDICATION.json'), JSON.stringify(afterGold, null, 2));

  const diff = {
    schema: 'zhihu-research-benchmark/second-adjudication-diff',
    case_id: NEW,
    gold_before: 'GOLD_BEFORE_SECOND_ADJUDICATION.json',
    gold_after: 'GOLD_AFTER_SECOND_ADJUDICATION.json',
    must_see_before: (beforeGold.families.must_see.sources || []).length,
    must_see_after: (afterGold.families.must_see.sources || []).length,
    must_see_removed: removedMustSee,
    must_see_promoted: promotedCandidates,
    removedMustSeeCount: removedMustSee.length,
    promotedCandidatesCount: promotedCandidates.length,
    retained_original_must_see: (beforeGold.families.must_see.sources || []).filter((s) => (afterGold.families.must_see.sources || []).includes(s)),
    stance_removals: removedStance,
    aspect_removals: removedAspect,
    contradiction_clusters_before: (beforeGold.families.contradiction.claim_clusters || []).length,
    contradiction_clusters_after: (afterGold.families.contradiction.claim_clusters || []).length,
    aspects_before: (beforeGold.families.aspect_membership.aspects || []).length,
    aspects_after: (afterGold.families.aspect_membership.aspects || []).length,
  };
  fs.writeFileSync(path.join(OUT_GOLD, 'SECOND_ADJUDICATION_DIFF.json'), JSON.stringify(diff, null, 2));

  // ---------- re-score frozen selections (NO selectors called) ------------
  const allRuns = [];
  const beforeAfter = [];
  const sourceMeta = new Map(); // sid -> votes (for B0 rows context, from run provenance)
  const denseProbe = new Map();  // sid -> dense vector (reuse SELECTED vectors only)

  for (const r of newRuns) {
    const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId: NEW });
    // NOTE: loadCase derives value units from gold.json on disk (before).
    // We must override with the after-gold derivation manually.
    const pool = loaded.pool;
    const selected = r.selected_source_ids;
    // selection identity is externally validated (validate-rescore) — here we
    // just recompute with afterGold:
    const afterUnits = deriveValueUnits(afterGold);
    const mAfter = computeFor({ ...afterGold, value_units: afterUnits }, loaded.caseCfg, pool, selected, null);
    const mBefore = computeFor({ ...beforeGold, value_units: deriveValueUnits(beforeGold) }, loaded.caseCfg, pool, selected, null);
    // semantic redundancy is gold-independent and selection-identical ->
    // AFTER must equal the frozen race (dense backend) value.
    if (r.metric_results.semantic_redundancy && r.metric_results.semantic_redundancy.scoring_status === 'REAL_DENSE_BACKEND') {
      mAfter.semantic_redundancy = r.metric_results.semantic_redundancy;
      mAfter.semantic_diversity = r.metric_results.semantic_diversity;
      mBefore.semantic_redundancy = r.metric_results.semantic_redundancy;
      mBefore.semantic_diversity = r.metric_results.semantic_diversity;
    }
    allRuns.push({
      case_id: NEW,
      strategy_id: r.strategy_id,
      budget_key: r.budget.key,
      K: r.budget.K,
      oracle: !fair(r),
      selected_source_ids: selected,
      metric_results_before: mBefore,
      metric_results_after: mAfter,
    });
    beforeAfter.push({
      case_id: NEW, strategy_id: r.strategy_id, budget_key: r.budget.key, K: r.budget.K,
      must_see_before: mBefore.must_see_recall.value, must_see_after: mAfter.must_see_recall.value,
      aspect_before: mBefore.aspect_recall.value, aspect_after: mAfter.aspect_recall.value,
      xq_before: mBefore.cross_question_claim_recall.value, xq_after: mAfter.cross_question_claim_recall.value,
      minority_min_before: mBefore.minority_question_recall_min.value, minority_min_after: mAfter.minority_question_recall_min.value,
      redundancy_before: mBefore.semantic_redundancy.value, redundancy_after: mAfter.semantic_redundancy.value,
      ops: r.metric_results.cost.relative_compute_ops,
    });
  }

  // cross-lowcode re-score under BEFORE gold (unchanged by adjudication) —
  // same code path, for cross-domain tables (K section)
  for (const r of crossRuns.filter(fair)) {
    const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId: 'case-cross-lowcode' });
    const m = computeFor(loaded.gold, loaded.caseCfg, loaded.pool, r.selected_source_ids, null);
    allRuns.push({
      case_id: 'case-cross-lowcode',
      strategy_id: r.strategy_id,
      budget_key: r.budget.key,
      K: r.budget.K,
      oracle: false,
      selected_source_ids: r.selected_source_ids,
      metric_results_after: m,
    });
  }

  fs.writeFileSync(path.join(OU, 'all-runs.json'), JSON.stringify(allRuns, null, 2));
  fs.writeFileSync(path.join(OU, 'before-after-metric-diff.json'), JSON.stringify(beforeAfter, null, 2));

  // ---------- summary + decision tables ------------------------------------
  const summary = { generated_at: new Date().toISOString(), runs: allRuns.length, note: 'FIXED_SELECTION_RESCORING_ONLY; selectors never invoked; selections byte-identical to results/race' };
  fs.writeFileSync(path.join(OU, 'summary.json'), JSON.stringify(summary, null, 2));

  const tables = { case_id: NEW, budgets: ['K_SMALL', 'K_MEDIUM', 'K_LARGE'] };
  fs.writeFileSync(path.join(OU, 'decision-tables.json'), JSON.stringify(tables, null, 2));

  console.log('ADJUDICATED_RESCORE_COMPLETE');
  console.log('must_see:', diff.must_see_before, '->', diff.must_see_after, '| removed:', diff.must_see_removed, '| promoted:', diff.must_see_promoted);
  console.log('contradiction clusters:', diff.contradiction_clusters_before, '->', diff.contradiction_clusters_after, '| aspects:', diff.aspects_before, '->', diff.aspects_after);
  console.log('runs rescored:', allRuns.length);
}

main();