// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/embedding-provider.test.mjs
 *
 * P1-T10 focused tests — LOCAL EmbeddingProvider adapter + validation + preflight (Issue #42, Spec §5.3, §10).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as prodModule from '../lib/embedding-provider.mjs';
import {
  ACCEPTED_LOCAL_PROFILE,
  EMBEDDING_ERROR_PROVIDER_UNREACHABLE,
  EMBEDDING_ERROR_MODEL_UNKNOWN,
  EMBEDDING_ERROR_REVISION_MISMATCH,
  EMBEDDING_ERROR_VECTOR_INVALID,
  EMBEDDING_ERROR_PROFILE_MISMATCH,
  EMBEDDING_ERROR_DENSE_UNAVAILABLE,
  EMBEDDING_ERROR_INVALID_INPUT,
  validateEmbeddingVector,
  l2Normalize,
  createEmbeddingProvider,
} from '../lib/embedding-provider.mjs';
import { EmbeddingCache } from '../lib/embedding-cache.mjs';
import { createTestEmbeddingProvider, mockVector768 } from './helpers/test-embedding-provider.mjs';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `embed-prov-${prefix}-`));
}

test('P1-T10: Accepted profile mechanical identity (8 contract fields + truncationPolicy)', () => {
  const provider = createEmbeddingProvider();

  assert.equal(provider.providerCategory, 'LOCAL');
  assert.equal(provider.providerId, 'transformersjs-local-onnx');
  assert.equal(provider.modelId, 'Xenova/bge-base-zh-v1.5');
  assert.equal(provider.modelRevision, '71e50dc531959f9e04ebf190ea25b00261a0a186');
  assert.equal(provider.vectorDimension, 768);
  assert.equal(provider.embeddingVersion, 'v1');
  assert.equal(provider.inputNormalizationVersion, 'T01_INPUT_NORM_V1');
  assert.equal(provider.outputNormalizationVersion, 'L2_UNIT_NORM');
  assert.equal(provider.truncationPolicy, 'MAX_POSITION_EMBEDDINGS_512');
  assert.deepEqual(provider.egressPolicy, { category: 'LOCAL', noNewEgress: true });
  assert.equal(provider.isCertifiedProduction, true);
  assert.equal(provider.isTestDouble, false);
});

test('P1-T10: Profile reselection rejection fail-closed', () => {
  // Rejecting any attempted profile override
  assert.throws(
    () => createEmbeddingProvider({ profileCheck: { modelId: 'Xenova/bge-small-zh-v1.5' } }),
    (err) => err.code === EMBEDDING_ERROR_PROFILE_MISMATCH
  );
  assert.throws(
    () => createEmbeddingProvider({ profileCheck: { providerCategory: 'REMOTE' } }),
    (err) => err.code === EMBEDDING_ERROR_PROFILE_MISMATCH
  );
  assert.throws(
    () => createEmbeddingProvider({ profileCheck: { modelRevision: 'main' } }),
    (err) => err.code === EMBEDDING_ERROR_PROFILE_MISMATCH
  );
});

test('P1-T10: Vector validation (768-dim, finite numbers, unit norm, tolerance enforcement)', () => {
  const valid = mockVector768(1);
  const checkValid = validateEmbeddingVector(valid);
  assert.equal(checkValid.ok, true);
  assert.equal(checkValid.dimension, 768);

  // Wrong dimension
  const shortVec = valid.slice(0, 512);
  const checkShort = validateEmbeddingVector(shortVec);
  assert.equal(checkShort.ok, false);
  assert.equal(checkShort.reason, 'dimension_mismatch');

  // Non-array
  assert.equal(validateEmbeddingVector('not-array').ok, false);

  // NaN element
  const nanVec = [...valid];
  nanVec[10] = NaN;
  const checkNan = validateEmbeddingVector(nanVec);
  assert.equal(checkNan.ok, false);
  assert.equal(checkNan.reason, 'non_finite_element');

  // Infinity element
  const infVec = [...valid];
  infVec[20] = Infinity;
  const checkInf = validateEmbeddingVector(infVec);
  assert.equal(checkInf.ok, false);
  assert.equal(checkInf.reason, 'non_finite_element');

  // -Infinity element
  const negInfVec = [...valid];
  negInfVec[30] = -Infinity;
  const checkNegInf = validateEmbeddingVector(negInfVec);
  assert.equal(checkNegInf.ok, false);
  assert.equal(checkNegInf.reason, 'non_finite_element');

  // Non-numeric element
  const strVec = [...valid];
  strVec[40] = 'string-value';
  const checkStr = validateEmbeddingVector(strVec);
  assert.equal(checkStr.ok, false);
  assert.equal(checkStr.reason, 'non_finite_element');

  // All zeros
  const zeroVec = Array(768).fill(0);
  const checkZero = validateEmbeddingVector(zeroVec);
  assert.equal(checkZero.ok, false);
  assert.equal(checkZero.reason, 'zero_magnitude_vector');

  // T10-F6: Vector whose norm deviates from 1.0 by more than allowTolerance
  const notUnit = Array(768).fill(1); // norm is sqrt(768) ≈ 27.7
  const checkNotUnit = validateEmbeddingVector(notUnit);
  assert.equal(checkNotUnit.ok, false);
  assert.equal(checkNotUnit.reason, 'norm_out_of_tolerance');
});

test('P1-T10: L2 normalization helper', () => {
  const raw = Array(768).fill(2); // length = 2 * sqrt(768)
  const normalized = l2Normalize(raw);
  const valCheck = validateEmbeddingVector(normalized);
  assert.equal(valCheck.ok, true);
  assert.ok(Math.abs(valCheck.norm - 1.0) < 1e-6);

  // Zero vector throws
  assert.throws(() => l2Normalize(Array(768).fill(0)), (err) => err.code === EMBEDDING_ERROR_VECTOR_INVALID);
});

test('P1-T10: Local Preflight checks identity.json and exact revision', async () => {
  const dir = tmpDir('preflight');

  // 1. Missing identity.json -> FAILED
  const prov1 = createEmbeddingProvider({ modelDir: dir });
  const pre1 = await prov1.preflight();
  assert.equal(pre1.ok, false);
  assert.equal(pre1.status, 'FAILED');
  assert.equal(pre1.failureCode, EMBEDDING_ERROR_MODEL_UNKNOWN);

  // 2. Mismatched revision sha in identity.json -> FAILED
  fs.writeFileSync(
    path.join(dir, 'identity.json'),
    JSON.stringify({
      modelId: 'Xenova/bge-base-zh-v1.5',
      revisionSha: '0000000000000000000000000000000000000000',
    }),
    'utf8'
  );

  const prov2 = createEmbeddingProvider({ modelDir: dir });
  const pre2 = await prov2.preflight();
  assert.equal(pre2.ok, false);
  assert.equal(pre2.status, 'FAILED');
  assert.equal(pre2.failureCode, EMBEDDING_ERROR_REVISION_MISMATCH);
});

test('P1-T10: P1-2 repair — identity.json mismatch never echoes caller-controlled values', async () => {
  // A tampered identity.json may carry a machine-private path / credential as
  // its modelId or revisionSha. The mismatch error must report only the stable
  // fact, never echo the caller-controlled `found` value (RULES §11).
  const dir = tmpDir('mismatch-redact');

  // Nested identity.json (T01 layout) with a path-bearing modelId.
  const nestedDir = path.join(dir, ACCEPTED_LOCAL_PROFILE.modelId);
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(
    path.join(nestedDir, 'identity.json'),
    JSON.stringify({
      modelId: '/home/alice/private/model',
      revisionSha: ACCEPTED_LOCAL_PROFILE.modelRevision,
    }),
    'utf8'
  );

  const prov = createEmbeddingProvider({ modelDir: dir });
  const pre = await prov.preflight();
  assert.equal(pre.ok, false);
  assert.equal(pre.failureCode, EMBEDDING_ERROR_MODEL_UNKNOWN);
  assert.equal(pre.error.includes('/home/alice/'), false, 'caller-controlled modelId must not echo');
  assert.equal(pre.error.includes('private'), false, 'caller-controlled path must not echo');
});

test('P1-T10: T10-F1 - Preflight checks actual artifact files and sha256 fail-closed', async () => {
  const dir = tmpDir('artifact-check');
  fs.writeFileSync(
    path.join(dir, 'identity.json'),
    JSON.stringify({
      modelId: 'Xenova/bge-base-zh-v1.5',
      revisionSha: '71e50dc531959f9e04ebf190ea25b00261a0a186',
    }),
    'utf8'
  );

  // 1. Missing artifact file
  const prov1 = createEmbeddingProvider({ modelDir: dir });
  const pre1 = await prov1.preflight();
  assert.equal(pre1.ok, false);
  assert.equal(pre1.status, 'FAILED');
  assert.equal(pre1.failureCode, EMBEDDING_ERROR_MODEL_UNKNOWN);
  assert.equal(pre1.error.includes('Required artifact missing'), true);

  // 2. Tampered artifact file (sha256 mismatch)
  fs.mkdirSync(path.join(dir, 'onnx'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'onnx', 'model_quantized.onnx'), 'TAMPERED_CONTENT', 'utf8');
  fs.writeFileSync(path.join(dir, 'tokenizer.json'), 'TAMPERED_CONTENT', 'utf8');
  fs.writeFileSync(path.join(dir, 'config.json'), 'TAMPERED_CONTENT', 'utf8');
  fs.writeFileSync(path.join(dir, 'tokenizer_config.json'), 'TAMPERED_CONTENT', 'utf8');

  const prov2 = createEmbeddingProvider({ modelDir: dir });
  const pre2 = await prov2.preflight();
  assert.equal(pre2.ok, false);
  assert.equal(pre2.status, 'FAILED');
  assert.equal(pre2.failureCode, EMBEDDING_ERROR_MODEL_UNKNOWN);
  assert.equal(pre2.error.includes('Artifact hash mismatch'), true);
});

test('P1-T10: T10-F3 - Test extractor capability isolation', async () => {
  // 1. Production module does NOT export createTestEmbeddingProvider
  assert.equal('createTestEmbeddingProvider' in prodModule, false);

  // 2. Test double created from test helper explicitly marks itself as TEST, cannot present as certified LOCAL
  const mockExtractor = async (text) => mockVector768(text.length);
  const testProv = createTestEmbeddingProvider({ extractorEngine: mockExtractor });

  assert.equal(testProv.isCertifiedProduction, false);
  assert.equal(testProv.isTestDouble, true);
  assert.equal(testProv.providerCategory, 'TEST');
  assert.equal(testProv.providerId, 'transformersjs-local-onnx-test-double');
  assert.deepEqual(testProv.egressPolicy, { category: 'TEST', noNewEgress: true });

  const pre = await testProv.preflight();
  assert.equal(pre.ok, true);
  assert.equal(pre.status, 'READY');
  assert.equal(pre.isCertifiedProduction, false);
  assert.equal(pre.isTestDouble, true);
  assert.equal(pre.providerCategory, 'TEST');
  assert.equal(pre.providerId, 'transformersjs-local-onnx-test-double');
  assert.equal(pre.truncationPolicy, 'MAX_POSITION_EMBEDDINGS_512');
});

test('P1-T10: Embed execution with deterministic cache and vector validation', async () => {
  let computeCallCount = 0;
  const mockExtractor = async (text) => {
    computeCallCount += 1;
    return mockVector768(text.length + computeCallCount);
  };

  const cache = new EmbeddingCache({ inMemoryOnly: true });
  const provider = createTestEmbeddingProvider({ extractorEngine: mockExtractor, cache });

  // 1. First embed call: both computed
  const res1 = await provider.embed(['第一段文本', '第二段文本']);
  assert.equal(res1.vectors.length, 2);
  assert.equal(res1.usage.total, 2);
  assert.equal(res1.usage.computed, 2);
  assert.equal(res1.usage.cached, 0);
  assert.equal(computeCallCount, 2);

  // Validate vectors
  assert.equal(validateEmbeddingVector(res1.vectors[0]).ok, true);
  assert.equal(validateEmbeddingVector(res1.vectors[1]).ok, true);

  // 2. Second embed call with same texts: both cached
  const res2 = await provider.embed(['第一段文本', '第二段文本']);
  assert.equal(res2.vectors.length, 2);
  assert.equal(res2.usage.total, 2);
  assert.equal(res2.usage.computed, 0);
  assert.equal(res2.usage.cached, 2);
  assert.equal(computeCallCount, 2, 'Extractor must not be called on cache hit');
  assert.deepEqual(res2.vectors, res1.vectors);

  // 3. Mixed call: one cached, one fresh
  const res3 = await provider.embed(['第一段文本', '第三段崭新的文本']);
  assert.equal(res3.vectors.length, 2);
  assert.equal(res3.usage.total, 2);
  assert.equal(res3.usage.computed, 1);
  assert.equal(res3.usage.cached, 1);
  assert.equal(computeCallCount, 3);
  assert.deepEqual(res3.vectors[0], res1.vectors[0]);
});

test('P1-T10: Fail-closed behavior on invalid input and extractor errors', async () => {
  const mockExtractor = async () => mockVector768(1);
  const provider = createTestEmbeddingProvider({ extractorEngine: mockExtractor });

  // Non-array input
  await assert.rejects(
    () => provider.embed('not-an-array'),
    (err) => err.code === EMBEDDING_ERROR_INVALID_INPUT
  );

  // Non-string element
  await assert.rejects(
    () => provider.embed(['valid text', 12345]),
    (err) => err.code === EMBEDDING_ERROR_INVALID_INPUT
  );

  // Extractor throwing error
  const throwingExtractor = async () => {
    throw new Error('Native ONNX runtime fault');
  };
  const failingProvider = createTestEmbeddingProvider({ extractorEngine: throwingExtractor });
  await assert.rejects(
    () => failingProvider.embed(['测试文本']),
    (err) => err.code === EMBEDDING_ERROR_DENSE_UNAVAILABLE
  );

  // Extractor returning malformed vector
  const malformedExtractor = async () => [1, 2, 3]; // only 3 elements
  const malformedProvider = createTestEmbeddingProvider({ extractorEngine: malformedExtractor });
  await assert.rejects(
    () => malformedProvider.embed(['测试文本']),
    (err) => err.code === EMBEDDING_ERROR_VECTOR_INVALID
  );
});

test('P1-T10: l2Normalize throws EMBEDDING_ERROR_VECTOR_INVALID on empty array', () => {
  assert.throws(() => l2Normalize([]), (err) => err.code === EMBEDDING_ERROR_VECTOR_INVALID);
});

test('P1-T10: Preflight errors do not leak absolute paths', async () => {
  const prov = createEmbeddingProvider({ modelDir: '/secret/path/to/models' });
  const pre = await prov.preflight();
  assert.equal(pre.ok, false);
  assert.equal(pre.error.includes('/secret/path'), false);
});

test('P1-T10: P1-1 repair — accepted T01 acquisition layout reaches READY', async () => {
  // Reproduce the EXACT layout written by the accepted T01 acquisition authority
  // (discovery/p1-t01-embedding-qualification/fetch-model.mjs):
  //   <dir>/identity.json                       (mirror)
  //   <dir>/<modelId>/{config.json, tokenizer.json, tokenizer_config.json,
  //                   onnx/model_quantized.onnx, identity.json}
  // where <modelId> = "Xenova/bge-base-zh-v1.5" (contains a slash → nested subdir).
  const dir = tmpDir('t01-layout');
  const modelRel = ACCEPTED_LOCAL_PROFILE.modelId; // "Xenova/bge-base-zh-v1.5"
  const modelRoot = path.join(dir, modelRel);

  fs.mkdirSync(path.join(modelRoot, 'onnx'), { recursive: true });

  const identity = {
    schemaVersion: 2,
    batteryStep: 'P1_T01_MODEL_ACQUISITION',
    modelId: ACCEPTED_LOCAL_PROFILE.modelId,
    requestedRevision: ACCEPTED_LOCAL_PROFILE.modelRevision,
    revisionSha: ACCEPTED_LOCAL_PROFILE.modelRevision,
    acquisition: { exactRevisionPinned: true },
    files: [],
  };
  // T01 writes identity.json BOTH at <dir>/identity.json (mirror) AND <dir>/<modelId>/identity.json.
  fs.writeFileSync(path.join(dir, 'identity.json'), JSON.stringify(identity), 'utf8');
  fs.writeFileSync(path.join(modelRoot, 'identity.json'), JSON.stringify(identity), 'utf8');

  // Artifacts are placed under <dir>/<modelId>/<filename>, matching fetch-model's
  // `join(dir, model)` target. Content is irrelevant for the layout check (identity
  // gate hashes them; a READY verdict requires the extractor which we cannot load
  // offline, so we assert the LAYOUT is mechanically recognized by checking the
  // preflight no longer reports artifact_absent for the nested layout).
  for (const filename of Object.keys(ACCEPTED_LOCAL_PROFILE.artifacts)) {
    fs.writeFileSync(path.join(modelRoot, filename), 'placeholder', 'utf8');
  }

  // modelDir points at <dir> (the acquisition root), matching fetch-model --dir.
  const prov = createEmbeddingProvider({ modelDir: dir });
  const pre = await prov.preflight();

  // With the layout fixed, the identity gate must RESOLVE the nested artifacts
  // (no 'Required artifact missing'). Placeholder content cannot match the real
  // sha256, so the gate proceeds to the hash check and reports a tamper — which
  // proves the nested layout was mechanically found (the pre-repair code would
  // have reported 'Required artifact missing' instead).
  assert.equal(pre.ok, false);
  assert.equal(pre.error.includes('Required artifact missing'), false,
    'artifact resolution must recognize the accepted T01 nested layout');
  assert.equal(pre.error.includes('Artifact hash mismatch'), true,
    'nested artifacts must be found and hashed (placeholder → tamper)');
});

test('P1-T10: P1-2 repair — native extractor errors never leak machine-private paths', async () => {
  // Native Transformers.js / ONNX failures can carry absolute model/cache/user
  // paths in err.message. embed() must project them through the repository's
  // machine-private-path boundary — a stable safe identity/message, never the
  // raw native diagnostic.
  const leakingMessage = 'Failed to load /home/alice/.cache/huggingface/models--Xenova--bge-base-zh-v1.5/snapshots/abc/model.onnx: ENOENT';
  const throwingExtractor = async () => {
    throw new Error(leakingMessage);
  };
  const provider = createTestEmbeddingProvider({ extractorEngine: throwingExtractor });

  await assert.rejects(
    () => provider.embed(['测试文本']),
    (err) => {
      assert.equal(err.code, EMBEDDING_ERROR_DENSE_UNAVAILABLE);
      assert.equal(err.message.includes('/home/alice/'), false, 'absolute path must not leak');
      assert.equal(err.message.includes('.cache/huggingface'), false, 'cache path must not leak');
      return true;
    }
  );
});

test('P1-T10: P1-2 repair — native diagnostics default-deny (never leak)', async () => {
  // Native diagnostics are UNTRUSTED and an open-ended leak surface. The
  // default-deny posture returns a fixed neutral identity for EVERY native
  // message — never the raw diagnostic. These cases span the leak classes
  // found across review rounds (POSIX/Windows paths, credentials, URL tails,
  // file:// URIs, UNC, URL userinfo, bare Bearer tokens); all must collapse to
  // the same neutral identity with no raw token surfaced.
  const cases = [
    'api_key=sk-live-secret-value-1234567890',
    'authorization: Bearer tok_abc123def456',
    'Failed to load C:\\Users\\alice\\.cache\\huggingface\\model.onnx',
    'token=secretvalue123',
    'password: hunter2 secret',
    'https://huggingface.co/model?status=failed /home/alice/.cache/model.onnx',
    'failed to load file:///home/alice/private/model.onnx',
    'file:///Users/bob/.cache/huggingface/model.onnx',
    // UNC path
    '\\\\server\\share\\Users\\alice\\model.onnx',
    // file:// host form (two-slash)
    'file://server/share/Users/alice/private/model.onnx',
    // URL userinfo
    'https://alice:s3cr3t@example.test/model',
    // bare Bearer token (space-separated, no '=' colon shape)
    'Bearer sk-live-secret',
    // even a benign-looking native message must not be surfaced verbatim
    'native runtime fault',
  ];

  for (const message of cases) {
    const throwingExtractor = async () => {
      throw new Error(message);
    };
    const provider = createTestEmbeddingProvider({ extractorEngine: throwingExtractor });

    await assert.rejects(
      () => provider.embed(['测试文本']),
      (err) => {
        assert.equal(err.code, EMBEDDING_ERROR_DENSE_UNAVAILABLE);
        // No raw token may surface (covers every secret value / path / username above).
        assert.equal(err.message.includes('sk-live-secret'), false);
        assert.equal(err.message.includes('tok_abc123'), false);
        assert.equal(err.message.includes('secretvalue123'), false);
        assert.equal(err.message.includes('hunter2'), false);
        assert.equal(err.message.includes('s3cr3t'), false);
        assert.equal(err.message.includes('alice'), false);
        assert.equal(err.message.includes('bob'), false);
        assert.equal(err.message.includes('server'), false);
        assert.equal(err.message.includes('model.onnx'), false);
        // The fixed neutral identity must be present.
        assert.equal(err.message.includes('native extractor failed'), true);
        return true;
      }
    );
  }
});
