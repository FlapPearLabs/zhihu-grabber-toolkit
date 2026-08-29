/**
 * DISCOVERY-ONLY (P1-T01 / Issue #33). Not a production module. Not imported by
 * any package under zhihu-answer-grabber/, corpus-anthology/ or research-orchestration/.
 *
 * Shared machine-readable failure identity for embedding qualification probes.
 *
 * NOTE ON AUTHORITY: the codes below are DISCOVERY-PROPOSED identifiers produced to
 * answer P1-T01 qualification dimension #9 (machine-readable failure identity).
 * They are NOT an Approved contract. P1-T10 (EmbeddingProvider adapter) must
 * re-derive the production failure identity from Applicable Approved Specs
 * (docs/specs/p1-cross-question-deep-research.md §5.3 / §10.2) under its own review.
 */
export const FAILURE_CODES = Object.freeze({
  PROVIDER_UNREACHABLE: 'EMBEDDING_PROVIDER_UNREACHABLE',
  PROVIDER_HTTP_ERROR: 'EMBEDDING_PROVIDER_HTTP_ERROR',
  MODEL_UNKNOWN: 'EMBEDDING_MODEL_UNKNOWN',
  RESPONSE_SCHEMA_INVALID: 'EMBEDDING_RESPONSE_SCHEMA_INVALID',
  INPUT_INVALID: 'EMBEDDING_INPUT_INVALID',
  VECTOR_NON_FINITE: 'EMBEDDING_VECTOR_NON_FINITE',
  VECTOR_DIMENSION_MISMATCH: 'EMBEDDING_VECTOR_DIMENSION_MISMATCH',
  NOT_IMPLEMENTED: 'EMBEDDING_PROBE_NOT_IMPLEMENTED',
});

export class EmbeddingProbeError extends Error {
  constructor(failureCode, message, detail = undefined) {
    super(message);
    this.name = 'EmbeddingProbeError';
    this.failureCode = failureCode;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * Redact anything that could carry a credential or a machine-private path.
 * Discovery artifacts must be safe to commit.
 */
export function redact(value) {
  if (typeof value !== 'string') return value;
  const home = process.env.HOME ?? '';
  let out = value;
  if (home) out = out.split(home).join('<HOME>');
  // Bearer / sk- style tokens must never reach a committed artifact.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1<REDACTED>');
  out = out.replace(/\bsk-[A-Za-z0-9._-]{4,}/g, 'sk-<REDACTED>');
  return out;
}
