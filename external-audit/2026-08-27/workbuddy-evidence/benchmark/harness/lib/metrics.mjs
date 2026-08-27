// Metric evaluator (CORRECTED per TRACK_B_PILOT_CORRECTION).
// Approved contract boundaries (not reinterpreted):
//   semantic_redundancy      = mean(clamp(cosine,0,1)) over distinct unordered selected pairs; |S|<2 -> N/A
//   claim_redundancy         = selected unordered pairs sharing >=1 substantive claim cluster / all pairs; |S|<2 -> N/A
//   cross_question_claim     = covered iff EVERY required provenance group has >=1 selected source
//   per_question_coverage    = covered scorable VALUE UNITS(q) / all scorable VALUE UNITS(q); omitted question -> 0 (P0-2)
//   minority macro/min       = over NON-LARGEST scorable reference questions (largest by FROZEN pool size) (P0-3)
//   normalized diversity     = (1-sum p^2)/(1-1/Q) with Q = # scorable reference questions (P0-4)
//   aspect_recall            = # aspects with >=1 selected primary supporting source / # scorable aspects (P0-5)
//   evidence presence        = MECHANICAL; evidence quality = PROVISIONAL (P0-6)
//   fresh window membership  = MECHANICAL; fresh relevant = PROVISIONAL (P0-6)
//   disputed / unresolved    = excluded from numerator AND denominator, reported separately

import { boundedCosine, embed } from './embeddings.mjs';
import { scorableUnitsByQuestion, unitsCovered } from './value-units.mjs';

const NA = { value: 'N/A', scorable: 0, reason: '' };
function na(reason) { return { value: 'N/A', scorable: 0, reason }; }

function familyScorable(fam) {
  if (!fam) return [];
  const all = fam.sources || [];
  const excluded = new Set([...(fam.unresolved_sources || []), ...(fam.disputed_sources || [])]);
  return all.filter((s) => !excluded.has(s));
}

function recallForSources(scorable, selectedSet) {
  if (scorable.length === 0) return null;
  const hit = scorable.filter((s) => selectedSet.has(s)).length;
  return { value: hit / scorable.length, hit, scorable: scorable.length };
}

// ---- mechanical derivations (deterministic functions of frozen inputs) -------
function mechanicalEvidencePresence(pool) {
  return pool.sources.filter((s) => s.evidence_markers.has_code || s.evidence_markers.has_external_links || s.evidence_markers.has_references).map((s) => s.source_id);
}

function mechanicalFreshWindow(pool, caseCfg) {
  const win = caseCfg.freshness_window_policy;
  if (!win || win.reference_epoch_sec == null || win.window_sec == null) return [];
  const threshold = win.reference_epoch_sec - win.window_sec;
  return pool.sources.filter((s) => s.createdTime != null && s.createdTime >= threshold).map((s) => s.source_id);
}

export function computeMetrics({ caseCfg, gold, pool, selected, cost, extra }) {
  const selectedSet = new Set(selected);
  const byId = pool.byId;
  const S = selected.map((id) => byId.get(id)).filter(Boolean);
  const fam = gold.families;
  const valueUnits = gold.value_units || [];

  const out = {};

  // ---- Must-See Recall (PROVISIONAL until adjudicated) -----------------------
  {
    const r = recallForSources(familyScorable(fam.must_see), selectedSet);
    out.must_see_recall = r || na('no_scorable_must_see_gold');
    out.must_see_recall.scoring_status = 'PROVISIONAL';
  }

  // ---- Aspect Recall (P0-5: aspect-level, increments of 1/#aspects) ----------
  {
    const aspects = fam.aspect_membership && fam.aspect_membership.aspects ? fam.aspect_membership.aspects : [];
    const scorableAspects = aspects.filter((a) => !a.disputed);
    const coveredAspects = scorableAspects.filter((a) => {
      const primary = a.primary_sources || a.sources || [];
      return primary.some((sid) => selectedSet.has(sid));
    });
    out.aspect_recall = scorableAspects.length
      ? { value: coveredAspects.length / scorableAspects.length, covered_aspects: coveredAspects.length, scorable_aspects: scorableAspects.length, increments: `1/${scorableAspects.length}` }
      : na('no_scorable_aspect_gold');
    out.aspect_recall.scoring_status = 'PROVISIONAL';
    // diagnostic only — source-level mean recall, NOT aspect_recall
    {
      const per = [];
      for (const a of aspects) {
        const scorable = familyScorable({ sources: a.sources || [], unresolved_sources: a.unresolved_sources || [], disputed_sources: a.disputed_sources || [] });
        const r = recallForSources(scorable, selectedSet);
        if (r) per.push(r.value);
      }
      out.aspect_source_recall_diagnostic = per.length
        ? { value: per.reduce((x, y) => x + y, 0) / per.length, aspects: per.length, per_aspect: per, note: 'diagnostic only; not the approved aspect_recall' }
        : na('no_scorable_aspect_gold');
    }
  }

  // ---- Expert Recall (PROVISIONAL) -------------------------------------------
  {
    const r = recallForSources(familyScorable(fam.expertise_topic_match), selectedSet);
    out.expert_recall = r || na('no_scorable_expert_gold');
    out.expert_recall.scoring_status = 'PROVISIONAL';
  }

  // ---- Long-tail Recall (PROVISIONAL) ----------------------------------------
  {
    const r = recallForSources(familyScorable(fam.unique_long_tail_contribution), selectedSet);
    out.long_tail_recall = r || na('no_scorable_long_tail_gold');
    out.long_tail_recall.scoring_status = 'PROVISIONAL';
  }

  // ---- Freshness (P0-6: window membership MECHANICAL; relevant PROVISIONAL) --
  {
    const winMembers = mechanicalFreshWindow(pool, caseCfg);
    const rWin = recallForSources(winMembers, selectedSet);
    out.fresh_window_membership_recall = rWin || na('no_fresh_window_members');
    out.fresh_window_membership_recall.scoring_status = 'MECHANICAL_CONFIRMED';

    const relevant = fam.freshness ? familyScorable({ sources: fam.freshness.fresh_relevant_sources || [], unresolved_sources: fam.freshness.unresolved_sources || [], disputed_sources: fam.freshness.disputed_sources || [] }) : [];
    const rRel = recallForSources(relevant, selectedSet);
    out.fresh_content_recall = rRel || na('no_scorable_fresh_relevant_gold');
    out.fresh_content_recall.scoring_status = 'PROVISIONAL';
    out.fresh_content_recall.note = 'PROVISIONAL until relevance adjudicated; fresh-but-off-topic sources are never FINAL fresh relevant gold';
  }

  // ---- Historical-authority Retention (PROVISIONAL) --------------------------
  {
    const r = recallForSources(familyScorable(fam.historical_authority), selectedSet);
    out.historical_authority_retention = r || na('no_scorable_historical_authority_gold');
    out.historical_authority_retention.scoring_status = 'PROVISIONAL';
  }

  // ---- Evidence (P0-6: presence MECHANICAL; quality PROVISIONAL) -------------
  {
    const presence = mechanicalEvidencePresence(pool);
    const rPres = recallForSources(presence, selectedSet);
    out.evidence_presence_recall = rPres || na('no_evidence_presence_sources');
    out.evidence_presence_recall.scoring_status = 'MECHANICAL_CONFIRMED';

    const rQual = recallForSources(familyScorable(fam.evidence_quality), selectedSet);
    out.evidence_rich_recall = rQual || na('no_scorable_evidence_quality_gold');
    out.evidence_rich_recall.scoring_status = 'PROVISIONAL';
    out.evidence_rich_recall.note = 'FINAL only after evidence_quality is human-adjudicated';
  }

  // ---- Contradiction Claim Recall (claim-based, PROVISIONAL) -----------------
  {
    const clusters = fam.contradiction && fam.contradiction.claim_clusters ? fam.contradiction.claim_clusters : [];
    const scorableClusters = clusters.filter((c) => !c.disputed);
    const covered = scorableClusters.filter((c) => (c.source_ids || []).some((s) => selectedSet.has(s)));
    const bothStances = scorableClusters.filter((c) => {
      const forSet = (c.stances && c.stances.for) || [];
      const againstSet = (c.stances && c.stances.against) || [];
      return forSet.some((s) => selectedSet.has(s)) && againstSet.some((s) => selectedSet.has(s));
    });
    out.contradiction_claim_recall = scorableClusters.length
      ? { value: covered.length / scorableClusters.length, covered: covered.length, scorable: scorableClusters.length, both_stances_covered: bothStances.length }
      : na('no_scorable_contradiction_clusters');
    out.contradiction_claim_recall.scoring_status = 'PROVISIONAL';
  }

  // ---- Cross-question Claim Recall (per final correction P0-1 of round 2) ----
  {
    const groups = fam.required_provenance_groups && fam.required_provenance_groups.claim_groups ? fam.required_provenance_groups.claim_groups : [];
    const scorable = groups.filter((g) => !g.disputed);
    const covered = [];
    for (const g of scorable) {
      const rpg = g.required_provenance_groups || [];
      const ok = rpg.length > 0 && rpg.every((grp) => (grp.sources || []).some((s) => selectedSet.has(s)));
      covered.push({ claim_id: g.claim_id, covered: ok });
    }
    out.cross_question_claim_recall = scorable.length
      ? { value: covered.filter((c) => c.covered).length / covered.length, covered: covered.filter((c) => c.covered).length, scorable: covered.length, per_claim: covered }
      : na('no_cross_question_claim_gold');
    if (out.cross_question_claim_recall.value !== 'N/A') out.cross_question_claim_recall.scoring_status = 'PROVISIONAL';
  }

  // ---- Semantic Redundancy (mechanical: ngram proxy; HARNESS_SANITY_ONLY) ----
  {
    const embedCache = extra ? extra.embedCache : null;
    const vecs = S.map((s) => embed(s.content_text, embedCache).vec);
    if (S.length < 2) {
      out.semantic_redundancy = na('|S|<2');
    } else {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < S.length; i++) {
        for (let j = i + 1; j < S.length; j++) {
          sum += boundedCosine(vecs[i], vecs[j]);
          n += 1;
        }
      }
      out.semantic_redundancy = { value: sum / n, pairs: n };
    }
    out.semantic_redundancy.scoring_status = 'HARNESS_SANITY_ONLY';
    if (S.length >= 2 && out.semantic_redundancy.value !== 'N/A') {
      out.semantic_diversity = { value: 1 - out.semantic_redundancy.value };
    } else {
      out.semantic_diversity = na('|S|<2');
    }
  }

  // ---- Claim Redundancy (pair-sharing-claim ratio; PROVISIONAL) --------------
  {
    if (S.length < 2) {
      out.claim_redundancy = na('|S|<2');
    } else {
      const clusters = fam.contradiction && fam.contradiction.claim_clusters ? fam.contradiction.claim_clusters : [];
      const clusters2 = fam.required_provenance_groups && fam.required_provenance_groups.claim_groups ? fam.required_provenance_groups.claim_groups : [];
      const allClusters = [...clusters, ...clusters2].filter((c) => !c.disputed && (c.source_ids || []).length >= 2);
      let sharing = 0;
      let total = 0;
      for (let i = 0; i < S.length; i++) {
        for (let j = i + 1; j < S.length; j++) {
          total += 1;
          const a = S[i].source_id;
          const b = S[j].source_id;
          if (allClusters.some((c) => (c.source_ids || []).includes(a) && (c.source_ids || []).includes(b))) sharing += 1;
        }
      }
      out.claim_redundancy = { value: sharing / total, sharing, total };
      out.claim_redundancy.scoring_status = 'PROVISIONAL';
    }
  }

  // ---- Analysis Coverage (verified corpus share entering selection) ----------
  {
    const verifiedIds = pool.sources.filter((s) => pool.questions.find((q) => q.qid === s.question_id).verified).map((s) => s.source_id);
    if (verifiedIds.length === 0) {
      out.analysis_coverage = na('no_verified_sources_in_pool');
    } else {
      const hit = verifiedIds.filter((id) => selectedSet.has(id)).length;
      out.analysis_coverage = { value: hit / verifiedIds.length, hit, scorable: verifiedIds.length };
    }
    out.analysis_coverage.scoring_status = 'MECHANICAL_CONFIRMED';
  }

  // ---- Normalized Question Diversity (P0-4: Q = # scorable reference Qs) -----
  {
    const scorableQ = new Set();
    for (const u of valueUnits) if (u.scorable && u.question_id) scorableQ.add(u.question_id);
    const referenceQs = caseCfg.reference_questions || [];
    const Q = referenceQs.filter((q) => scorableQ.has(q)).length;
    if (Q <= 1) {
      out.normalized_question_diversity = na(Q === 0 ? 'no_scorable_reference_questions' : 'Q<=1');
    } else {
      const qcount = new Map();
      for (const id of selected) {
        const s = byId.get(id);
        if (!s) continue;
        qcount.set(s.question_id, (qcount.get(s.question_id) || 0) + 1);
      }
      const p = referenceQs.filter((q) => scorableQ.has(q)).map((q) => (qcount.get(q) || 0) / (selected.length || 1));
      const sumSq = p.reduce((x, y) => x + y * y, 0);
      out.normalized_question_diversity = { value: (1 - sumSq) / (1 - 1 / Q), Q, per_question: Object.fromEntries(qcount) };
      out.normalized_question_diversity.scoring_status = 'MECHANICAL_CONFIRMED';
    }
  }

  // ---- Source Concentration diagnostics (07 Part B) --------------------------
  {
    const qcount = new Map();
    const acount = new Map();
    const types = new Map();
    for (const id of selected) {
      const s = byId.get(id);
      if (!s) continue;
      qcount.set(s.question_id, (qcount.get(s.question_id) || 0) + 1);
      acount.set(s.author_key, (acount.get(s.author_key) || 0) + 1);
      types.set('answer', (types.get('answer') || 0) + 1);
    }
    const qShares = [...qcount.values()].map((c) => c / (selected.length || 1));
    const aShares = [...acount.values()].map((c) => c / (selected.length || 1));
    const claimClusters = fam.contradiction && fam.contradiction.claim_clusters ? fam.contradiction.claim_clusters : [];
    const claimQuestions = new Set();
    const goldClaimQuestions = new Set();
    for (const c of claimClusters) {
      for (const sid of c.source_ids || []) {
        const s = byId.get(sid);
        if (s) { goldClaimQuestions.add(s.question_id); if (selectedSet.has(sid)) claimQuestions.add(s.question_id); }
      }
    }
    out.source_concentration = {
      selected_question_count: qcount.size,
      selected_content_by_question: Object.fromEntries(qcount),
      largest_question_share: qShares.length ? Math.max(...qShares) : 0,
      selected_author_concentration: aShares.reduce((x, y) => x + y * y, 0),
      selected_content_type_distribution: Object.fromEntries(types),
      claim_source_diversity: goldClaimQuestions.size ? claimQuestions.size / goldClaimQuestions.size : null,
    };
  }

  // ---- Per-question coverage (P0-2: value units) + minority recall (P0-3) ----
  {
    const byQ = scorableUnitsByQuestion(valueUnits);
    const referenceQs = caseCfg.reference_questions || [];
    const scorableQs = referenceQs.filter((q) => (byQ.get(q) || []).length > 0);
    const per = {};
    for (const q of referenceQs) {
      const unitsQ = byQ.get(q) || [];
      if (unitsQ.length === 0) continue; // not scorable
      const covered = unitsCovered(unitsQ, selectedSet).length;
      per[q] = { value: covered / unitsQ.length, covered_units: covered, scorable_units: unitsQ.length };
    }
    out.per_question_coverage_preservation = {
      per_question: Object.fromEntries(scorableQs.map((q) => [q, per[q]])),
      scorable_question_count: scorableQs.length,
      unit_basis: 'value_units',
    };

    // largest reference question by FROZEN reference pool size (P0-3)
    const poolSizeByQ = new Map();
    for (const s of pool.sources) poolSizeByQ.set(s.question_id, (poolSizeByQ.get(s.question_id) || 0) + 1);
    const sizes = scorableQs.map((q) => poolSizeByQ.get(q) || 0);
    const maxSize = sizes.length ? Math.max(...sizes) : 0;
    const nonLargest = scorableQs.filter((q) => (poolSizeByQ.get(q) || 0) < maxSize);

    const valuesNonLargest = nonLargest.map((q) => per[q].value);
    out.minority_question_recall_macro = valuesNonLargest.length
      ? { value: valuesNonLargest.reduce((x, y) => x + y, 0) / valuesNonLargest.length, questions: valuesNonLargest.length, excluded_largest: true, basis: 'non-largest scorable reference questions by frozen pool size' }
      : na('fewer_than_two_scorable_reference_questions');
    out.minority_question_recall_min = valuesNonLargest.length
      ? { value: Math.min(...valuesNonLargest), basis: 'non-largest scorable reference questions' }
      : na('fewer_than_two_scorable_reference_questions');

    // micro diagnostic over NON-LARGEST questions (diagnostic only)
    {
      const totalGold = nonLargest.reduce((s, q) => s + per[q].scorable_units, 0);
      const totalHit = nonLargest.reduce((s, q) => s + per[q].covered_units, 0);
      out.minority_question_recall_micro_diagnostic = totalGold ? { value: totalHit / totalGold, note: 'diagnostic only' } : na('fewer_than_two_scorable_reference_questions');
    }
  }

  // ---- Independent Source Diversity ------------------------------------------
  {
    const pairs = new Set(S.map((s) => s.author_key + '@' + s.question_id));
    out.independent_source_diversity = S.length ? { value: pairs.size / S.length, unique_pairs: pairs.size, n: S.length } : na('no_selected');
  }

  // ---- Cost (P1-2: relative_compute_ops, not production cost) ---------------
  {
    const c = cost && typeof cost.snapshot === 'function' ? cost.snapshot() : (cost || {});
    out.cost = {
      relative_compute_ops: (c.embedding_calls || 0) + (c.pairwise_similarity_calls || 0) + (c.selection_ops || 0),
      embedding_calls: c.embedding_calls || 0,
      embedding_cache_hits: c.embedding_cache_hits || 0,
      pairwise_similarity_calls: c.pairwise_similarity_calls || 0,
      selection_ops: c.selection_ops || 0,
      wall_clock_ms: c.wall_ms || 0,
      note: 'relative_compute_ops = local relative compute (embedding_calls + pairwise_similarity_calls + selection_ops) within same machine; NOT a production cost estimate. Provider/model cost must be measured separately.',
    };
  }

  // ---- False Stop Rate -------------------------------------------------------
  out.false_stop_rate = { value: 'NOT_RUN', reason: 'no Tier-3 batch fixture in this pilot; would require adaptive stopping harness' };

  return out;
}

// ---- Jaccard stability --------------------------------------------------------
export function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = new Set([...sa].filter((x) => sb.has(x))).size;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : inter / union;
}

export function jaccardStability(selections) {
  if (selections.length < 2) return { value: 'N/A', reason: 'need >=2 runs', pairs: 0 };
  const vals = [];
  for (let i = 0; i < selections.length; i++) {
    for (let j = i + 1; j < selections.length; j++) vals.push(jaccard(selections[i], selections[j]));
  }
  return {
    value: vals.reduce((x, y) => x + y, 0) / vals.length,
    min: Math.min(...vals),
    pairs: vals.length,
    per_pair: vals,
  };
}
