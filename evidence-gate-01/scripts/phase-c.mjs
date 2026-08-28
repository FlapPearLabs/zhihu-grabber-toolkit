// phase-c.mjs — Phase C artifacts: Q2 dense-vs-ngram comparison,
// decision-sensitive second-adjudication packet (blinded), winner sensitivity.
// Blinding: the adjudication packet contains NO vote/comment counts, NO
// strategy identity, NO selection provenance. The unblinding key is written
// separately (adjudication-key) and must NOT be sent to the second judge.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, CASE_IDS } from '../lib/paths.mjs';

const NEW_CASE = 'case-hpylori-treatment';
const FAIR = ['B0_POPULARITY_TOP_K', 'B1_DENSE_SEMANTIC_TOP_K', 'B2_QUESTION_STRATIFIED_SIMPLE', 'B3_DENSE_MMR_MULTI_LANE'];

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function loadRuns(dir) {
  const runs = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'summary.json') continue;
    // only per-run artifacts match case__strategy__budget naming
    if (!f.includes('__')) continue;
    runs.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  return runs;
}

const D21 = loadRuns(paths.resultsD21).filter((r) => r.strategy_config && !r.strategy_config.excluded_from_fair_comparison);
const RACE = loadRuns(paths.resultsRace);

function poolOf(caseId) {
  const { loadCase } = (() => { const fsx = fs; return { }; })();
  return null; // replaced below via dynamic import in main()
}

// ---- Q2: B1 real dense vs B1 ngram proxy (same 8 legacy cases) ----------
export function q2DenseVsNgram() {
  const rows = [];
  for (const c of CASE_IDS) {
    const ng = D21.find((r) => r.case_id === c && r.strategy_id === 'B1_LEXICAL_NGRAM_PROXY');
    for (const bk of ['K_SMALL', 'K_MEDIUM', 'K_LARGE']) {
      const ngR = D21.filter((r) => r.case_id === c && r.strategy_id === 'B1_LEXICAL_NGRAM_PROXY' && r.budget.key === bk)[0];
      const dsR = RACE.find((r) => r.case_id === c && r.strategy_id === 'B1_DENSE_SEMANTIC_TOP_K' && r.budget.key === bk);
      if (!ngR || !dsR) continue;
      const num = (m) => (m && m.value !== 'N/A' && typeof m.value === 'number') ? m.value : null;
      rows.push({
        case_id: c, budget_key: bk, K: bk,
        ngram_must_see: num(ngR.metric_results.must_see_recall),
        dense_must_see: num(dsR.metric_results.must_see_recall),
        ngram_aspect: num(ngR.metric_results.aspect_recall),
        dense_aspect: num(dsR.metric_results.aspect_recall),
        ngram_xq: num(ngR.metric_results.cross_question_claim_recall),
        dense_xq: num(dsR.metric_results.cross_question_claim_recall),
        selection_jaccard: jaccard(ngR.selected_source_ids, dsR.selected_source_ids),
      });
    }
  }
  return rows;
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union ? inter / union : 1;
}

// ---- Second adjudication packet (blinded) --------------------------------
export async function buildAdjudicationPacket() {
  const { loadCase } = await import('../lib/case-loader.mjs');
  const labels = [];
  const key = {};

  // Determine strategy mentions per source for the new case (unblinding key)
  const hpRuns = RACE.filter((r) => r.case_id === NEW_CASE && r.strategy_config && !r.strategy_config.excluded_from_fair_comparison);
  const selectedBy = new Map(); // sid -> [strategy...]
  for (const r of hpRuns) {
    for (const sid of r.selected_source_ids) {
      if (!selectedBy.has(sid)) selectedBy.set(sid, []);
      selectedBy.get(sid).push(r.strategy_id + '@' + r.budget.key);
    }
  }
  const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId: NEW_CASE });
  const pool = loaded.pool;
  const gold = loaded.gold;
  const mustSee = new Set(gold.families.must_see.sources);
  const relevant = new Set(gold.families.relevance.sources);

  // candidate A: must_see sources (22) — judge: is this genuinely must-read
  // for a research corpus on this topic? (binary)
  for (const sid of [...mustSee].sort()) {
    const s = pool.byId.get(sid);
    if (!s) continue;
    labels.push({
      label_id: `MS:${sid}`,
      kind: 'must_see',
      source_id: sid,
      question_title: s.content_text ? null : null,
      q_title: pool.questions.find((q) => q.qid === s.question_id)?.title,
      excerpt: stripHtml(s.content_text).slice(0, 320),
      question: 'MUST_SEE: 一个高质量研究语料在 15 条预算内是否必须包含此回答？（是/否）',
    });
    key[sid] = { votes: s.voteupCount, selected_by: selectedBy.get(sid) || [], in_must_see: true };
  }

  // candidate B: non-must_see sources selected by >=2 strategies (10)
  const multiSelected = [...selectedBy.entries()]
    .filter(([sid, list]) => !mustSee.has(sid) && new Set(list.map((x) => x.split('@')[0])).size >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  for (const [sid, list] of multiSelected) {
    const s = pool.byId.get(sid);
    if (!s) continue;
    labels.push({
      label_id: `MS2:${sid}`,
      kind: 'must_see_candidate',
      source_id: sid,
      q_title: pool.questions.find((q) => q.qid === s.question_id)?.title,
      excerpt: stripHtml(s.content_text).slice(0, 320),
      question: 'MUST_SEE_CANDIDATE: 此回答是否属于“必须在语料中出现”的高价值回答？（是/否）',
    });
    key[sid] = { votes: s.voteupCount, selected_by: list, in_must_see: false };
  }

  // candidate C: contradiction sides — verify stance attribution (8 sides)
  for (const c of gold.families.contradiction.claim_clusters) {
    for (const [stance, sids] of Object.entries(c.stances || {})) {
      for (const sid of sids.slice(0, 2)) {
        const s = pool.byId.get(sid);
        if (!s) continue;
        labels.push({
          label_id: `ST:${c.claim_id}:${stance}:${sid}`,
          kind: 'contradiction_stance',
          source_id: sid,
          claim: c.claim,
          stance,
          q_title: pool.questions.find((q) => q.qid === s.question_id)?.title,
          excerpt: stripHtml(s.content_text).slice(0, 320),
          question: `STANCE: 此回答是否持「${stance}」立场（相对上述主张）？（是/否/不确定）`,
        });
      }
    }
  }

  // candidate D: cross-question aspect primary reps (top per aspect per question)
  const aspectCount = { xq: 0 };
  for (const a of gold.families.aspect_membership.aspects) {
    const byQ = new Map();
    for (const sid of a.primary_sources || []) {
      const q = sid.split(':')[0];
      if (!byQ.has(q)) byQ.set(q, []);
      byQ.get(q).push(sid);
    }
    for (const [q, sids] of byQ) {
      // representative = highest-vote relevant source in this question for the aspect
      const rep = sids
        .filter((sid) => relevant.has(sid))
        .sort((x, y) => (pool.byId.get(y).voteupCount || 0) - (pool.byId.get(x).voteupCount || 0))[0];
      if (!rep) continue;
      aspectCount.xq++;
      if (aspectCount.xq > 12) continue; // cap for brevity
      const s = pool.byId.get(rep);
      labels.push({
        label_id: `ASP:${a.aspect_id}:${q}`,
        kind: 'cross_question_aspect',
        source_id: rep,
        aspect_id: a.aspect_id,
        q_title: pool.questions.find((x) => x.qid === q)?.title,
        excerpt: stripHtml(s.content_text).slice(0, 320),
        question: `ASPECT: 此回答是否是该问题下代表「${a.aspect_id}」关键维度的主要来源？（是/否）`,
      });
    }
  }

  // dedupe by source (keep first kind)
  const seen = new Set();
  const finalLabels = labels.filter((l) => {
    if (seen.has(l.source_id)) return false;
    seen.add(l.source_id);
    return true;
  });

  const packet = {
    schema: 'zhihu-research-benchmark/second-adjudication-packet',
    experiment: 'P1_DECISION_GRADE_EVIDENCE_GATE_01',
    case_id: NEW_CASE,
    generated_at: new Date().toISOString(),
    blinding: 'NO votes, NO comment counts, NO strategy identity, NO selection lists in this packet; every item shows source_id + question title + sanitized excerpt only. Unblinding key stored separately at adjudication/decision-sensitive-key.json (NOT to be shown to the second judge).',
    instructions: [
      'Judge each item independently on the stated binary/label question.',
      'Do NOT infer popularity or strategy behavior from content length or author names (they correlate with selection but are not the ground truth asked).',
      'Use the full answer if you have access to the frozen corpus; otherwise judge from the excerpt.',
    ],
    gold_freeze_ref: 'cases/case-hpylori-treatment/gold.json (PROVISIONAL, frozen 2026-08-28 before strategy runs)',
    label_count: finalLabels.length,
    labels: finalLabels,
  };
  fs.mkdirSync(path.join(paths.root, 'adjudication'), { recursive: true });
  fs.writeFileSync(path.join(paths.root, 'adjudication/decision-sensitive-packet.json'), JSON.stringify(packet, null, 2));
  fs.writeFileSync(path.join(paths.root, 'adjudication/decision-sensitive-key.json'), JSON.stringify(key, null, 2));
  return { label_count: finalLabels.length, key_count: Object.keys(key).length };
}

// ---- Winner sensitivity: flip must_see labels and see if winner changes ----
export async function winnerSensitivity() {
  const { loadCase } = await import('../lib/case-loader.mjs');
  const { computeMetrics } = await import('../lib/metrics.mjs');
  const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId: NEW_CASE });
  const pool = loaded.pool;
  const gold = loaded.gold;
  const costStub = { snapshot: () => ({}) };
  const selections = new Map();
  for (const r of RACE.filter((x) => x.case_id === NEW_CASE && x.budget.key === 'K_MEDIUM' && x.strategy_config && !x.strategy_config.excluded_from_fair_comparison)) {
    selections.set(r.strategy_id, r.selected_source_ids);
  }
  const mustSee = [...gold.families.must_see.sources];

  const baseline = new Map();
  for (const [s, sel] of selections) {
    const m = computeMetrics({ caseCfg: loaded.caseCfg, gold, pool, selected: sel, cost: costStub, extra: {} });
    baseline.set(s, m.must_see_recall.value);
  }
  const orderOf = (vals) => [...FAIR].sort((a, b) => (vals.get(b) - vals.get(a)) || (a < b ? -1 : 1));
  const baseOrder = orderOf(baseline);

  const flips = [];
  for (const sid of mustSee) {
    // alternative gold: remove this must_see label
    const g2 = JSON.parse(JSON.stringify(gold));
    g2.families.must_see.sources = g2.families.must_see.sources.filter((s) => s !== sid);
    const vals = new Map();
    for (const [s, sel] of selections) {
      const m = computeMetrics({ caseCfg: loaded.caseCfg, gold: g2, pool, selected: sel, cost: costStub, extra: {} });
      vals.set(s, m.must_see_recall.value ?? 0);
    }
    const order = orderOf(vals);
    const top = order[0];
    if (top !== baseOrder[0] || JSON.stringify(order) !== JSON.stringify(baseOrder)) {
      const b3vsB2base = baseOrder.indexOf('B3_DENSE_MMR_MULTI_LANE') < baseOrder.indexOf('B2_QUESTION_STRATIFIED_SIMPLE');
      const b3vsB2new = order.indexOf('B3_DENSE_MMR_MULTI_LANE') < order.indexOf('B2_QUESTION_STRATIFIED_SIMPLE');
      const b0vsB2base = baseOrder.indexOf('B0_POPULARITY_TOP_K') < baseOrder.indexOf('B2_QUESTION_STRATIFIED_SIMPLE');
      const b0vsB2new = order.indexOf('B0_POPULARITY_TOP_K') < order.indexOf('B2_QUESTION_STRATIFIED_SIMPLE');
      flips.push({
        flipped_label: sid,
        baseline_top: baseOrder[0],
        new_top: top,
        new_order: order,
        removed_from_gold: true,
        top_winner_changed: top !== baseOrder[0],
        b3_b2_relative_flip: b3vsB2base !== b3vsB2new,
        b0_b2_relative_flip: b0vsB2base !== b0vsB2new,
      });
    }
  }
  // also test "add" flips: promote a few non-mustsee high-value cands? (gold change after freeze is INVALID; this is pure sensitivity diagnostics, not a gold change)
  const result = {
    case_id: NEW_CASE,
    baseline_must_see_ordering: baseOrder,
    baseline_values: Object.fromEntries(baseline),
    flip_count: flips.length,
    flips,
    top_winner_flips: flips.filter((f) => f.top_winner_changed).length,
    b3_b2_relative_flips: flips.filter((f) => f.b3_b2_relative_flip).length,
    b0_b2_relative_flips: flips.filter((f) => f.b0_b2_relative_flip).length,
    verdict: (flips.some((f) => f.top_winner_changed) || flips.some((f) => f.b3_b2_relative_flip))
      ? 'GOLD_DECISION_SENSITIVITY = HIGH (single must-see label flips change architecture ordering, incl. B3-vs-B2 relative position)'
      : 'GOLD_DECISION_SENSITIVITY = LOW',
  };
  fs.writeFileSync(path.join(paths.resultsRace, 'winner-sensitivity.json'), JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const q2 = q2DenseVsNgram();
  console.log('=== Q2: B1 real-dense vs B1 ngram proxy ===');
  for (const r of q2) {
    console.log(`${r.case_id} ${r.budget_key.padEnd(8)} ngram_ms=${r.ngram_must_see} dense_ms=${r.dense_must_see} ngram_asp=${r.ngram_aspect} dense_asp=${r.dense_aspect} jac=${r.selection_jaccard.toFixed(2)}`);
  }
  fs.writeFileSync(path.join(paths.resultsRace, 'q2-dense-vs-ngram.json'), JSON.stringify(q2, null, 2));
  buildAdjudicationPacket().then((r) => {
    console.log('adjudication packet labels:', r.label_count, '| key entries:', r.key_count);
    return winnerSensitivity();
  }).then((w) => {
    console.log('winner sensitivity:', w.verdict, '| flips:', w.flip_count);
    console.log('  baseline ordering:', w.baseline_must_see_ordering.join(' > '));
    if (w.flips.length) console.log('  first flip:', JSON.stringify(w.flips[0]));
  }).catch((e) => { console.error('FAIL', e); process.exit(1); });
}