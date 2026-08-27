// gold_stats_by_family — per label family: scorable / unresolved / disputed counts
// and dispute rate. Disputed+unresolved are excluded from metric numerator AND
// denominator (per correction P0-3 of round 2) and reported separately here.
// CORRECTED: handles evidence_presence (mechanical), evidence_quality (provisional),
// and freshness fresh_relevant_sources (provisional).

export function goldStatsByFamily(gold) {
  const fam = gold.families || {};
  const stats = {};
  for (const [name, f] of Object.entries(fam)) {
    if (!f || typeof f !== 'object') continue;
    const sourceField = f.fresh_relevant_sources !== undefined ? f.fresh_relevant_sources : (f.sources || []);
    const unresolved = f.unresolved_sources || [];
    const disputed = f.disputed_sources || [];
    const total = sourceField.length;
    const excluded = new Set([...unresolved, ...disputed]);
    const scorable = sourceField.filter((s) => !excluded.has(s)).length;
    stats[name] = {
      label_status: f.label_status || 'UNSPECIFIED',
      total,
      scorable,
      unresolved: unresolved.length,
      disputed: disputed.length,
      gold_dispute_rate: total ? disputed.length / total : 0,
    };
    if (f.aspects) stats[name].aspect_count = f.aspects.length;
    if (f.claim_clusters) stats[name].claim_cluster_count = f.claim_clusters.length;
    if (f.claim_groups) stats[name].claim_group_count = f.claim_groups.length;
  }
  // value-unit level stats (P0-2)
  const units = gold.value_units || [];
  if (units.length) {
    const byType = {};
    for (const u of units) {
      if (!byType[u.unit_type]) byType[u.unit_type] = { total: 0, scorable: 0 };
      byType[u.unit_type].total += 1;
      if (u.scorable) byType[u.unit_type].scorable += 1;
    }
    stats._value_units = { total: units.length, scorable: units.filter((u) => u.scorable).length, by_type: byType };
  }
  return stats;
}
