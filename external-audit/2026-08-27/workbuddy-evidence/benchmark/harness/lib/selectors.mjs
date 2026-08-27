// Selectors (corrected per TRACK_B_PILOT_CORRECTION).
// FAIR-COMPARISON STRATEGIES (must not consume evaluation gold):
//   B0_POPULARITY_TOP_K
//   B1_LEXICAL_NGRAM_PROXY      (renamed from B1_SEMANTIC_TOP_K; P1-1)
//   B2_MMR_NGRAM_PROXY          (renamed from B2_MMR_MULTI_LANE; mechanical lanes only; P0-1+P1-1)
// DIAGNOSTIC-ONLY (UPPER_BOUND; gold lanes; EXCLUDED from fair comparison):
//   B2_ORACLE_LANES
// TARGET (RCE V1) is intentionally NOT implemented in this pilot.
//
// Boundary (P0-1): STRATEGY_FEATURES != EVALUATION_GOLD.
// Fair-comparison selectors derive lane signals ONLY from:
//   1. mechanical metadata (votes, timestamps, evidence markers),
//   2. independently computed deterministic heuristics,
//   3. independent frozen semantic feature compilation (none exists in this pilot).
// No expert/contradictory signal exists without gold in the pilot -> those lanes
// are EMPTY for mechanical B2 rather than fabricated.

import { boundedCosine, embed } from './embeddings.mjs';

function stableById(a, b) {
  return a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0;
}

// ---- B0: Popularity Top-K ----------------------------------------------------
export function selectPopularityTopK(pool, K, ctx) {
  const cost = ctx ? ctx.cost : null;
  if (cost) cost.add({ selection_ops: pool.sources.length * Math.log(pool.sources.length + 1) });
  const ranked = [...pool.sources].sort((a, b) => {
    if (b.voteupCount !== a.voteupCount) return b.voteupCount - a.voteupCount;
    return stableById(a, b);
  });
  return ranked.slice(0, K).map((s) => s.source_id);
}

// ---- B1: Lexical n-gram proxy Top-K (P1-1 rename; deterministic, offline) ----
export function selectLexicalNgramTopK(pool, K, { queryText, embedCache }, ctx) {
  const cost = ctx ? ctx.cost : null;
  const q = embed(queryText, embedCache);
  if (cost) cost.add({ embedding_calls: 1, cache_hits: q.cached ? 1 : 0 });
  const scored = pool.sources.map((s) => {
    const e = embed(s.content_text, embedCache);
    if (cost) cost.add({ embedding_calls: 1, cache_hits: e.cached ? 1 : 0 });
    return { s, rel: boundedCosine(q.vec, e.vec) };
  });
  if (cost) cost.add({ pairwise_similarity_calls: pool.sources.length });
  scored.sort((a, b) => {
    if (b.rel !== a.rel) return b.rel - a.rel;
    return stableById(a.s, b.s);
  });
  return scored.slice(0, K).map((x) => x.s.source_id);
}

// ---- MECHANICAL lane assignment (NO gold access; P0-1) ------------------------
// Lane signals are only: votes (mechanical), evidence PRESENCE markers
// (mechanical), freshness window membership (mechanical), long-tail mechanical
// proxy (zero-vote + substantive). Expert and Contradictory lanes have NO
// independent production-plausible signal in this pilot -> empty, NOT fabricated.
export function assignMechanicalLanes(pool, caseCfg, _goldUnused) {
  const lanes = {};
  const def = (id, members, kind, quotaWeight = 1) => {
    lanes[id] = { id, members: new Set(members), kind, quotaWeight };
  };
  const votes = pool.sources.map((s) => s.voteupCount);
  const medianVote = votes.length ? votes.slice().sort((a, b) => a - b)[Math.floor(votes.length / 2)] : 0;

  def('mainstream', pool.sources.filter((s) => s.voteupCount > medianVote || s.voteupCount >= 1).map((s) => s.source_id), 'mechanical');

  // evidence PRESENCE (mechanical markers) — NOT evidence quality (semantic)
  def('evidence_rich', pool.sources.filter((s) => s.evidence_markers.has_code || s.evidence_markers.has_external_links || s.evidence_markers.has_references).map((s) => s.source_id), 'mechanical_presence');

  const win = caseCfg.freshness_window_policy;
  if (win && win.reference_epoch_sec != null && win.window_sec != null) {
    const threshold = win.reference_epoch_sec - win.window_sec;
    def('fresh', pool.sources.filter((s) => s.createdTime != null && s.createdTime >= threshold).map((s) => s.source_id), 'mechanical_window');
  } else {
    def('fresh', [], 'mechanical_window');
  }

  const minChars = caseCfg.long_tail_min_chars ?? 80;
  def('long_tail', pool.sources.filter((s) => s.voteupCount === 0 && s.content_chars >= minChars).map((s) => s.source_id), 'mechanical_proxy');

  // No gold-derived signals available without evaluation gold:
  def('expert', [], 'NO_INDEPENDENT_SIGNAL_EMPTY');
  def('contradictory', [], 'NO_INDEPENDENT_SIGNAL_EMPTY');

  return lanes;
}

// ---- ORACLE lane assignment (reads evaluation gold) --------------------------
// UPPER_BOUND_DIAGNOSTIC_ONLY. Never part of the fair B0/B1/B2 comparison.
export function assignOracleLanes(pool, caseCfg, gold) {
  const lanes = {};
  const def = (id, members, kind, quotaWeight = 1) => {
    lanes[id] = { id, members: new Set(members), kind, quotaWeight };
  };
  const votes = pool.sources.map((s) => s.voteupCount);
  const medianVote = votes.length ? votes.slice().sort((a, b) => a - b)[Math.floor(votes.length / 2)] : 0;
  def('mainstream', pool.sources.filter((s) => s.voteupCount > medianVote || s.voteupCount >= 1).map((s) => s.source_id), 'mechanical');

  const expertIds = new Set();
  if (gold && gold.families && gold.families.expertise_topic_match) {
    for (const s of gold.families.expertise_topic_match.sources || []) expertIds.add(s);
  }
  for (const a of caseCfg.expert_author_keys || []) {
    for (const s of pool.sources) if (s.author_key === a) expertIds.add(s.source_id);
  }
  def('expert', [...expertIds], 'oracle_gold_expertise');

  const contraIds = new Set();
  if (gold && gold.families && gold.families.contradiction && gold.families.contradiction.claim_clusters) {
    for (const c of gold.families.contradiction.claim_clusters) {
      for (const s of c.source_ids || []) contraIds.add(s);
    }
  }
  def('contradictory', [...contraIds], 'oracle_gold_contradiction');

  const evIds = new Set();
  if (gold && gold.families && gold.families.evidence_presence) {
    for (const s of gold.families.evidence_presence.sources || []) evIds.add(s);
  } else {
    for (const s of pool.sources) if (s.evidence_markers.has_code || s.evidence_markers.has_external_links || s.evidence_markers.has_references) evIds.add(s.source_id);
  }
  def('evidence_rich', [...evIds], 'mechanical_presence');

  const win = caseCfg.freshness_window_policy;
  if (win && win.reference_epoch_sec != null && win.window_sec != null) {
    const threshold = win.reference_epoch_sec - win.window_sec;
    def('fresh', pool.sources.filter((s) => s.createdTime != null && s.createdTime >= threshold).map((s) => s.source_id), 'mechanical_window');
  } else {
    def('fresh', [], 'mechanical_window');
  }
  const minChars = caseCfg.long_tail_min_chars ?? 80;
  def('long_tail', pool.sources.filter((s) => s.voteupCount === 0 && s.content_chars >= minChars).map((s) => s.source_id), 'mechanical_proxy');
  return lanes;
}

// ---- B2: MMR + Multi-lane (shared core; lanes injected by caller) ------------
export function selectMMRMultiLane(pool, K, { queryText, embedCache, lambda = 0.5, lanes, laneOrder, quotas }, ctx) {
  const cost = ctx ? ctx.cost : null;
  const q = embed(queryText, embedCache);
  if (cost) cost.add({ embedding_calls: 1, cache_hits: q.cached ? 1 : 0 });

  const sims = new Map();
  const rel = new Map();
  for (const s of pool.sources) {
    const e = embed(s.content_text, embedCache);
    if (cost) cost.add({ embedding_calls: 1, cache_hits: e.cached ? 1 : 0 });
    sims.set(s.source_id, e.vec);
    rel.set(s.source_id, boundedCosine(q.vec, e.vec));
  }

  const byId = pool.byId;
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

  const mmrScore = (id) => {
    let maxSim = 0;
    for (const t of selected) {
      const sim = boundedCosine(sims.get(id), sims.get(t));
      maxSim = Math.max(maxSim, sim);
    }
    return rel.get(id) - lambda * maxSim;
  };

  const pickBest = (candidates) => {
    let best = null;
    let bestScore = -Infinity;
    for (const id of candidates) {
      if (selectedSet.has(id)) continue;
      const sc = mmrScore(id);
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
      const pick = pickBest(candidates);
      if (pick === null) continue;
      selected.push(pick);
      selectedSet.add(pick);
      laneFilled.set(laneId, laneFilled.get(laneId) + 1);
      remaining -= 1;
      progressed = true;
    }
  }

  while (remaining > 0) {
    const pick = pickBest([...byId.keys()]);
    if (pick === null) break;
    selected.push(pick);
    selectedSet.add(pick);
    remaining -= 1;
  }
  if (cost) cost.add({ selection_ops: selected.length * (pool.sources.length + 1) });
  return selected;
}

export function defaultLaneOrder() {
  return ['mainstream', 'expert', 'evidence_rich', 'fresh', 'long_tail', 'contradictory'];
}

export function computeQuotas(K, lanes, laneOrder, weights) {
  const quotas = {};
  const active = laneOrder.filter((id) => (lanes[id].members.size || 0) > 0);
  const totalWeight = active.reduce((s, id) => s + (weights[id] != null ? weights[id] : 1), 0) || 1;
  let sum = 0;
  for (const id of laneOrder) {
    const size = lanes[id].members.size || 0;
    if (size === 0) { quotas[id] = 0; continue; }
    const w = weights[id] != null ? weights[id] : 1;
    const raw = Math.ceil((K * w) / totalWeight);
    quotas[id] = Math.max(0, Math.min(raw, size, K - sum));
    sum += quotas[id];
  }
  for (const id of laneOrder) {
    if (sum >= K) break;
    const size = lanes[id].members.size || 0;
    const add = Math.min(size - quotas[id], K - sum);
    quotas[id] += add;
    sum += add;
  }
  return quotas;
}
