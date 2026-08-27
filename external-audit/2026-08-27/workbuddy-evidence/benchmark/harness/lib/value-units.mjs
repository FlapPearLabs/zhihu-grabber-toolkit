// value_units derivation (P0-2).
// per_question_coverage is measured in VALUE UNITS, NOT raw source counts.
// A unit is covered when >=1 of its supporting_source_ids is selected.
// unit_type: must_see | critical_aspect | unique_claim |
//            required_contradiction_side | expert_source_group | evidence_source_group

const UNSUPPORTED = new Set(['relevance', 'freshness', 'evidence_presence', 'mechanical_metadata']);

export function deriveValueUnits(gold) {
  const fam = gold.families || {};
  const units = [];
  const excludedOf = (f) => new Set([...(f.unresolved_sources || []), ...(f.disputed_sources || [])]);
  const qidOf = (sid) => sid.split(':')[0];
  const scorable = (sid, excluded) => !excluded.has(sid);

  // must_see: one unit per scorable must-see source
  if (fam.must_see && fam.must_see.sources) {
    const ex = excludedOf(fam.must_see);
    for (const sid of fam.must_see.sources) {
      units.push({
        unit_id: `must_see:${sid}`,
        question_id: qidOf(sid),
        unit_type: 'must_see',
        supporting_source_ids: [sid],
        scorable: scorable(sid, ex),
        status: scorable(sid, ex) ? 'scorable' : 'excluded',
      });
    }
  }

  // critical_aspect: one unit per aspect (primary supporting sources)
  if (fam.aspect_membership && fam.aspect_membership.aspects) {
    for (const a of fam.aspect_membership.aspects) {
      const primary = a.primary_sources || a.sources || [];
      const ex = new Set([...(a.unresolved_sources || []), ...(a.disputed_sources || [])]);
      const scorablePrimary = primary.filter((sid) => !ex.has(sid));
      units.push({
        unit_id: `critical_aspect:${a.aspect_id}`,
        question_id: primary.length ? qidOf(primary[0]) : null,
        unit_type: 'critical_aspect',
        aspect_id: a.aspect_id,
        supporting_source_ids: scorablePrimary,
        scorable: scorablePrimary.length > 0,
        status: scorablePrimary.length > 0 ? 'scorable' : 'excluded',
      });
    }
  }

  // unique_claim: one unit per scorable long-tail source
  if (fam.unique_long_tail_contribution && fam.unique_long_tail_contribution.sources) {
    const ex = excludedOf(fam.unique_long_tail_contribution);
    for (const sid of fam.unique_long_tail_contribution.sources) {
      units.push({
        unit_id: `unique_claim:${sid}`,
        question_id: qidOf(sid),
        unit_type: 'unique_claim',
        supporting_source_ids: [sid],
        scorable: scorable(sid, ex),
        status: scorable(sid, ex) ? 'scorable' : 'excluded',
      });
    }
  }

  // required_contradiction_side: one unit per stance per claim cluster
  if (fam.contradiction && fam.contradiction.claim_clusters) {
    for (const c of fam.contradiction.claim_clusters) {
      if (c.disputed) continue;
      for (const [stance, sids] of Object.entries(c.stances || {})) {
        if (!Array.isArray(sids) || sids.length === 0) continue;
        units.push({
          unit_id: `contra_side:${c.claim_id}:${stance}`,
          question_id: qidOf(sids[0]),
          unit_type: 'required_contradiction_side',
          claim_id: c.claim_id,
          stance,
          supporting_source_ids: sids,
          scorable: true,
          status: 'scorable',
        });
      }
    }
  }

  // expert_source_group: one case-level group unit (question_id = null so it is
  // NOT double-counted into any single question's per-question coverage)
  if (fam.expertise_topic_match && fam.expertise_topic_match.sources) {
    const ex = excludedOf(fam.expertise_topic_match);
    const sids = fam.expertise_topic_match.sources.filter((sid) => !ex.has(sid));
    units.push({
      unit_id: 'expert_source_group',
      question_id: null,
      unit_type: 'expert_source_group',
      supporting_source_ids: sids,
      scorable: sids.length > 0,
      status: sids.length > 0 ? 'scorable' : 'excluded',
    });
  }

  // evidence_source_group: one case-level group unit (SEMANTIC evidence quality)
  if (fam.evidence_quality && fam.evidence_quality.sources) {
    const ex = excludedOf(fam.evidence_quality);
    const sids = fam.evidence_quality.sources.filter((sid) => !ex.has(sid));
    units.push({
      unit_id: 'evidence_source_group',
      question_id: null,
      unit_type: 'evidence_source_group',
      supporting_source_ids: sids,
      scorable: sids.length > 0,
      status: sids.length > 0 ? 'scorable' : 'excluded',
    });
  }

  return units;
}

export function scorableUnitsByQuestion(valueUnits) {
  const byQ = new Map();
  for (const u of valueUnits) {
    if (!u.scorable || !u.question_id) continue;
    if (!byQ.has(u.question_id)) byQ.set(u.question_id, []);
    byQ.get(u.question_id).push(u);
  }
  return byQ;
}

export function unitsCovered(units, selectedSet) {
  return units.filter((u) => (u.supporting_source_ids || []).some((sid) => selectedSet.has(sid)));
}
