// value_units derivation — D2.1 CORRECTED question-provenance scope model.
// ------------------------------------------------------------------------
// Historical defect (QUESTION_PROVENANCE_LOST, external audit CRITICAL_ASPECT_CHAIN):
//   critical_aspect question_id was qidOf(primary_sources[0]) and
//   contra-side question_id was qidOf(stances[..][0]) -> the value unit's
//   question membership depended on the ARRAY ORDER of gold support lists.
//   A cross-question aspect was silently collapsed onto ONE arbitrary question.
//
// D2.1 correction:
//   Every unit carries an explicit semantic scope:
//     scope        = 'QUESTION' | 'CROSS_QUESTION' | 'CASE'
//     question_ids = sorted unique question ids mechanically derived from the
//                    unit's own supporting sources (CASE units -> [], i.e. no
//                    legal question ownership).
//   Source-array order can never change question membership:
//     question_ids is a SET over ALL supporting sources, sorted canonically.
//   CASE-scoped units are excluded from every per-question denominator.
//
// Coverage semantics (metrics.mjs):
//   per-question coverage counts a unit for EACH question in its question_ids;
//   a unit is covered FOR question q only when >=1 supporting source FROM q
//   is selected (never credited via a source of another question).
//
// unit_type: must_see | critical_aspect | unique_claim |
//            required_contradiction_side | expert_source_group | evidence_source_group

const UNSUPPORTED = new Set(['relevance', 'freshness', 'evidence_presence', 'mechanical_metadata']);

const qidOf = (sid) => String(sid).split(':')[0];

// Mechanical, canonical scope derivation: sorted unique question ids over ALL
// supporting sources. Order of the input array is irrelevant by construction.
function scopeOf(primarySupportingIds) {
  const qs = [...new Set(primarySupportingIds.filter(Boolean).map(qidOf))].sort();
  if (qs.length === 0) return { scope: 'CASE', question_ids: [] };
  if (qs.length === 1) return { scope: 'QUESTION', question_ids: qs };
  return { scope: 'CROSS_QUESTION', question_ids: qs };
}

export function deriveValueUnits(gold) {
  const fam = gold.families || {};
  const units = [];
  const excludedOf = (f) => new Set([...(f.unresolved_sources || []), ...(f.disputed_sources || [])]);
  const scorable = (sid, excluded) => !excluded.has(sid);

  // must_see: one unit per scorable must-see source (single source -> QUESTION)
  if (fam.must_see && fam.must_see.sources) {
    const ex = excludedOf(fam.must_see);
    for (const sid of fam.must_see.sources) {
      units.push({
        unit_id: `must_see:${sid}`,
        scope: scopeOf([sid]).scope,
        question_ids: scopeOf([sid]).question_ids,
        unit_type: 'must_see',
        supporting_source_ids: [sid],
        scorable: scorable(sid, ex),
        status: scorable(sid, ex) ? 'scorable' : 'excluded',
      });
    }
  }

  // critical_aspect: one unit per aspect; question membership = ALL primary
  // supporting sources' questions (QUESTION or CROSS_QUESTION), NEVER the
  // array-order first element.
  if (fam.aspect_membership && fam.aspect_membership.aspects) {
    for (const a of fam.aspect_membership.aspects) {
      const primary = a.primary_sources || a.sources || [];
      const ex = new Set([...(a.unresolved_sources || []), ...(a.disputed_sources || [])]);
      const scorablePrimary = primary.filter((sid) => !ex.has(sid)).sort();
      const { scope, question_ids } = scopeOf(scorablePrimary);
      units.push({
        unit_id: `critical_aspect:${a.aspect_id}`,
        scope,
        question_ids,
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
        scope: scopeOf([sid]).scope,
        question_ids: scopeOf([sid]).question_ids,
        unit_type: 'unique_claim',
        supporting_source_ids: [sid],
        scorable: scorable(sid, ex),
        status: scorable(sid, ex) ? 'scorable' : 'excluded',
      });
    }
  }

  // required_contradiction_side: one unit per stance; question membership
  // spans ALL sources of that stance (order-invariant).
  if (fam.contradiction && fam.contradiction.claim_clusters) {
    for (const c of fam.contradiction.claim_clusters) {
      if (c.disputed) continue;
      for (const [stance, sids] of Object.entries(c.stances || {})) {
        if (!Array.isArray(sids) || sids.length === 0) continue;
        const { scope, question_ids } = scopeOf(sids);
        units.push({
          unit_id: `contra_side:${c.claim_id}:${stance}`,
          scope,
          question_ids,
          unit_type: 'required_contradiction_side',
          claim_id: c.claim_id,
          stance,
          supporting_source_ids: [...sids].sort(),
          scorable: true,
          status: 'scorable',
        });
      }
    }
  }

  // expert_source_group: case-level group unit. No legal question ownership:
  // scope=CASE, question_ids=[] -> NEVER enters any per-question denominator.
  if (fam.expertise_topic_match && fam.expertise_topic_match.sources) {
    const ex = excludedOf(fam.expertise_topic_match);
    const sids = fam.expertise_topic_match.sources.filter((sid) => !ex.has(sid)).sort();
    units.push({
      unit_id: 'expert_source_group',
      scope: 'CASE',
      question_ids: [],
      unit_type: 'expert_source_group',
      supporting_source_ids: sids,
      scorable: sids.length > 0,
      status: sids.length > 0 ? 'scorable' : 'excluded',
    });
  }

  // evidence_source_group: one case-level group unit (SEMANTIC evidence quality)
  if (fam.evidence_quality && fam.evidence_quality.sources) {
    const ex = excludedOf(fam.evidence_quality);
    const sids = fam.evidence_quality.sources.filter((sid) => !ex.has(sid)).sort();
    units.push({
      unit_id: 'evidence_source_group',
      scope: 'CASE',
      question_ids: [],
      unit_type: 'evidence_source_group',
      supporting_source_ids: sids,
      scorable: sids.length > 0,
      status: sids.length > 0 ? 'scorable' : 'excluded',
    });
  }

  return units;
}

// question -> scorable units applicable to that question.
// A unit applies to EVERY question in its (canonical, order-free) question_ids.
export function scorableUnitsByQuestion(valueUnits) {
  const byQ = new Map();
  for (const u of valueUnits) {
    if (!u.scorable) continue;
    for (const qid of u.question_ids || []) {
      if (!byQ.has(qid)) byQ.set(qid, []);
      byQ.get(qid).push(u);
    }
  }
  return byQ;
}

// Units covered by a selection, GLOBALLY (any supporting source selected).
// Used for aspect-level / claim-level metrics where question membership is
// deliberately not part of the definition.
export function unitsCovered(units, selectedSet) {
  return units.filter((u) => (u.supporting_source_ids || []).some((sid) => selectedSet.has(sid)));
}

// Units covered FOR a specific question q: requires >=1 selected supporting
// source whose OWN question is q. A CROSS_QUESTION unit is not credited to q
// merely because another question's source was selected.
export function unitsCoveredForQuestion(units, selectedSet, qid) {
  return units.filter((u) =>
    (u.supporting_source_ids || []).some((sid) => selectedSet.has(sid) && qidOf(sid) === qid),
  );
}

// Order-invariance check helper: derivations must be byte-identical after
// shuffling all gold support arrays.
export { qidOf };