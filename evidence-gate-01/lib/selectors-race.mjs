// Race selectors — P1 gate-01 Phase B (benchmark-only; NOT production).
// FAIR strategies (no gold access, same frozen pool):
//   B0_POPULARITY_TOP_K            (existing, mandatory anchor)
//   B1_DENSE_SEMANTIC_TOP_K        (real dense embedding + cosine)
//   B2_QUESTION_STRATIFIED_SIMPLE  (per-question floor + global dense rank +
//                                   simple novelty gate)
//   B3_DENSE_MMR_MULTI_LANE        (real dense embeddings + MMR + current
//                                   fair mechanical lanes)
// DIAGNOSTIC-ONLY (UPPER_BOUND; gold lanes; EXCLUDED from winner comparison):
//   B3_ORACLE_LANES
//
// Preregistered parameters (EXPERIMENT_PRE_REGISTRATION.json, frozen before
// any run): floor rule, novelty threshold, MMR lambda, lane weights, tie-break.
// All are deterministic; no randomness, no gold, no optimizer.

import { selectMMRMultiLane as mmrCore, assignMechanicalLanes, assignOracleLanes, defaultLaneOrder, computeQuotas } from './selectors.mjs';
import { denseCosine, embedDense, DENSE_MODEL } from './dense-embed.mjs';

function stableById(a, b) {
  return a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// B1: REAL dense semantic Top-K
// ---------------------------------------------------------------------------
export async function selectDenseSemanticTopK(pool, K, { queryText, embedCache }, ctx) {
  const cost = ctx ? ctx.cost : null;
  const q = await embedDense(queryText, embedCache);
  if (cost) cost.add({ embedding_calls: 1, cache_hits: q.cached ? 1 : 0 });
  const scored = [];
  for (const s of pool.sources) {
    const e = await embedDense(s.content_text, embedCache);
    if (cost) cost.add({ embedding_calls: 1, cache_hits: e.cached ? 1 : 0 });
    scored.push({ s, rel: await denseCosine(q.vec, e.vec) });
  }
  scored.sort((a, b) => (b.rel !== a.rel ? b.rel - a.rel : stableById(a.s, b.s)));
  return scored.slice(0, K).map((x) => x.s.source_id);
}

// ---------------------------------------------------------------------------
// B2: QUESTION-STRATIFIED SIMPLE (preregistered, frozen rule)
//   1. floor_q = 1 for every question with >=1 source (hard representation
//      constraint; only candidate/source-group structure decides it).
//   2. Select by global dense relevance: prefer sources whose question floor
//      is still unsatisfied (one per question), then plain relevance.
//   3. Simple novelty redundancy control: skip a candidate when its dense
//      cosine to ANY already-selected source > noveltyThreshold (0.90).
//   No gold, no expert/fresh/contradiction labels, no optimizer.
// ---------------------------------------------------------------------------
export async function selectQuestionStratifiedSimple(pool, K, { queryText, embedCache, noveltyThreshold = 0.9 }, ctx) {
  const cost = ctx ? ctx.cost : null;
  const q = await embedDense(queryText, embedCache);
  if (cost) cost.add({ embedding_calls: 1, cache_hits: q.cached ? 1 : 0 });

  const groupOf = new Map(); // source_id -> question_id
  const groupSize = new Map(); // question_id -> count
  for (const s of pool.sources) {
    groupOf.set(s.source_id, s.question_id);
    groupSize.set(s.question_id, (groupSize.get(s.question_id) || 0) + 1);
  }
  const questions = [...groupSize.keys()];
  const floor = new Map();
  for (const qid of questions) floor.set(qid, 1); // frozen rule: 1 per non-empty question

  const ranked = [];
  for (const s of pool.sources) {
    const e = await embedDense(s.content_text, embedCache);
    if (cost) cost.add({ embedding_calls: 1, cache_hits: e.cached ? 1 : 0 });
    ranked.push({ s, rel: await denseCosine(q.vec, e.vec), vec: e.vec });
  }
  ranked.sort((a, b) => (b.rel !== a.rel ? b.rel - a.rel : stableById(a.s, b.s)));

  const selected = [];
  const selectedSet = new Set();
  const selectedVecs = [];
  const filled = new Map();

  // PHASE 1 — hard per-question floors: guarantee >=1 representation for every
  // question with candidates (order = global dense relevance across questions).
  for (const { s, vec } of ranked) {
    if (selected.length >= K) break;
    if (selectedSet.has(s.source_id)) continue;
    const qid = groupOf.get(s.source_id);
    if ((filled.get(qid) || 0) >= (floor.get(qid) || 0)) continue; // floor already met
    selected.push(s.source_id);
    selectedSet.add(s.source_id);
    selectedVecs.push(vec);
    filled.set(qid, (filled.get(qid) || 0) + 1);
  }

  // PHASE 2 — global dense relevance with simple novelty gate.
  for (const { s, vec } of ranked) {
    if (selected.length >= K) break;
    if (selectedSet.has(s.source_id)) continue;
    let dup = false;
    for (const v of selectedVecs) {
      const sim = await denseCosine(vec, v);
      if (cost) cost.add({ pairwise_similarity_calls: 1 });
      if (sim > noveltyThreshold) { dup = true; break; }
    }
    if (dup) continue;
    selected.push(s.source_id);
    selectedSet.add(s.source_id);
    selectedVecs.push(vec);
  }
  if (cost) cost.add({ selection_ops: selected.length * 2 });
  return selected;
}

// ---------------------------------------------------------------------------
// B3: DENSE MMR + current fair mechanical lanes (same lane mechanics as the
// existing B2_MMR_NGRAM_PROXY, but real dense embeddings for rel/redundancy).
// ---------------------------------------------------------------------------
export async function selectDenseMMRMultiLane(pool, K, { queryText, embedCache, lambda = 0.5, lanes, laneOrder, quotas }, ctx) {
  const cost = ctx ? ctx.cost : null;
  const q = await embedDense(queryText, embedCache);
  if (cost) cost.add({ embedding_calls: 1, cache_hits: q.cached ? 1 : 0 });

  const byId = pool.byId;
  const sims = new Map();
  const rel = new Map();
  for (const s of pool.sources) {
    const e = await embedDense(s.content_text, embedCache);
    if (cost) cost.add({ embedding_calls: 1, cache_hits: e.cached ? 1 : 0 });
    sims.set(s.source_id, e.vec);
    rel.set(s.source_id, await denseCosine(q.vec, e.vec));
  }

  const selected = [];
  const selectedSet = new Set();
  const laneCandidates = new Map();
  const laneQuota = new Map();
  const laneFilled = new Map();

  for (const laneId of laneOrder) {
    const lane = lanes[laneId];
    const members = [...lane.members].filter((id) => byId.has(id)).sort();
    laneCandidates.set(laneId, members);
    const quota = quotas[laneId] != null ? Math.min(quotas[laneId], members.length) : 0;
    laneQuota.set(laneId, quota);
    laneFilled.set(laneId, 0);
  }

  const mmrScore = async (id) => {
    let maxSim = 0;
    const v = sims.get(id);
    for (const t of selected) {
      const sim = await denseCosine(v, sims.get(t));
      maxSim = Math.max(maxSim, sim);
    }
    return rel.get(id) - lambda * maxSim;
  };

  const pickBest = async (candidates) => {
    let best = null;
    let bestScore = -Infinity;
    for (const id of candidates) {
      if (selectedSet.has(id)) continue;
      const sc = await mmrScore(id);
      if (cost) cost.add({ pairwise_similarity_calls: selected.length });
      if (sc > bestScore || (sc === bestScore && (best === null || id < best))) {
        bestScore = sc;
        best = id;
      }
    }
    return best;
  };

  let remaining = K;
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (const laneId of laneOrder) {
      if (remaining <= 0) break;
      if (laneFilled.get(laneId) >= laneQuota.get(laneId)) continue;
      const candidates = laneCandidates.get(laneId) || [];
      const pick = await pickBest(candidates);
      if (pick === null) continue;
      selected.push(pick);
      selectedSet.add(pick);
      laneFilled.set(laneId, laneFilled.get(laneId) + 1);
      remaining -= 1;
      progressed = true;
    }
  }

  while (remaining > 0) {
    const pick = await pickBest([...byId.keys()]);
    if (pick === null) break;
    selected.push(pick);
    selectedSet.add(pick);
    remaining -= 1;
  }
  if (cost) cost.add({ selection_ops: selected.length * (pool.sources.length + 1) });
  return selected;
}

// Re-export lane machinery + identity for the runner.
export { assignMechanicalLanes, assignOracleLanes, defaultLaneOrder, computeQuotas, DENSE_MODEL };