// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/helpers/test-embedding-provider.mjs
 *
 * Test-only helper providing injected test doubles for embedding tests.
 * Satisfies T10-F3: Test injection lives in test-owned code and cannot present
 * itself as certified production LOCAL / transformersjs-local-onnx provider.
 */

import { _TEST_SEAMS } from '../../lib/embedding-provider.mjs';

/**
 * Creates a test double embedding provider with an injected extractor.
 * The test double explicitly identifies as TEST category and cannot be used
 * as a certified production provider.
 */
export function createTestEmbeddingProvider({
  extractorEngine = null,
  cache = null,
  cacheDir = null,
  modelDir = null,
} = {}) {
  return _TEST_SEAMS.createTestDouble({
    extractorEngine,
    cache,
    cacheDir,
    modelDir,
  });
}

/**
 * Deterministic unit-norm 768-dimensional vector for embedding tests.
 * Shared by embedding-cache.test.mjs and embedding-provider.test.mjs.
 */
export function mockVector768(seed = 1) {
  const vec = [];
  let sumSq = 0;
  for (let i = 0; i < 768; i += 1) {
    const v = Math.sin(seed + i);
    vec.push(v);
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  return vec.map((x) => x / norm);
}
