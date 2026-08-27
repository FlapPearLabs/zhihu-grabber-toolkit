// Runtime identity — deterministic, machine-auditable, credential-free.
export const RUNTIME = {
  node: process.version,
  platform: 'node',
  benchmark_harness_version: '0.1.0-pilot',
  embedding_runtime: {
    id: 'benchmark-local-deterministic-ngram',
    version: '1.0.0',
    kind: 'deterministic-lexical-similarity-proxy',
    note: 'NOT a neural embedding model. Pilot-only deterministic similarity proxy (char n-gram TF vectors + cosine) so B1/B2 are runnable offline, cheap and stable. Swap point for a real embedding runtime in a later round.',
  },
  selectors: {
    B0_POPULARITY_TOP_K: '1.0.0',
    B1_LEXICAL_NGRAM_PROXY: '1.0.0', // P1-1: renamed from B1_SEMANTIC_TOP_K; deterministic n-gram proxy, HARNESS_SANITY_ONLY
    B2_MMR_NGRAM_PROXY: '1.0.0',     // P1-1 + P0-1: renamed; mechanical lanes only (no gold access)
    B2_ORACLE_LANES: '1.0.0',        // P0-1: gold lanes; UPPER_BOUND_DIAGNOSTIC_ONLY, excluded from fair comparison
  },
};

export function runtimeIdentity() {
  return JSON.parse(JSON.stringify(RUNTIME));
}
