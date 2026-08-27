// BENCHMARK_AUTHOR_KEY — stable, name-derived author key for the pilot.
// Canonical answers schema has NO stable author id (only a name string), so:
//   - STRONG   : fixture-defined identity (synthetic cases only)
//   - MEDIUM   : fixture-local identity, manually confirmed within the case
//   - WEAK     : name-only, plausible but not uniquely attributable
//   - UNKNOWN  : cannot attribute
// Name-only keys must NOT be treated as strict unique-author attribution.

export function normalizeAuthorKey(name) {
  return String(name || '(anonymous)').trim().replace(/\s+/g, ' ').toLowerCase();
}

export const AUTHOR_CONFIDENCE = {
  STRONG: 'STRONG',
  MEDIUM: 'MEDIUM',
  WEAK: 'WEAK',
  UNKNOWN: 'UNKNOWN',
};

export function defaultAuthorConfidence(caseMeta) {
  if (caseMeta && caseMeta.author_identity === 'fixture_defined') return AUTHOR_CONFIDENCE.MEDIUM;
  return AUTHOR_CONFIDENCE.WEAK; // real canonical corpus: name-only
}
