#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/bin/build-real-embeddings.mjs
 *
 * P1-T12 INTEGRATION (T12 real contract gate) — REAL embedding producer for
 * the SEAM B TYPE_B conformance gate (test/p1-seam-b-real-conformance.test.mjs).
 *
 * Reads the REAL T09 dogfood artifacts (multi-group-state.json → manifest →
 * per-group verified answers.json), verifies every answersHash fail-closed,
 * computes canonicalSourceId per answer entry (controller scheme
 * `asrc-<sha256(groupId:answerId)[:24]>`) and embeds:
 *   - source text  : entry.excerpt (plain-text excerpt of the captured answer;
 *                    the deterministic semantic proxy for the answer content)
 *   - target text  : questionTitle of the group's answers.json (the group's
 *                    research intent)
 * using the REAL LOCAL embedding provider (lib/embedding-provider.mjs, T10
 * accepted profile Xenova/bge-base-zh-v1.5 @ pinned revision, 768-dim,
 * L2-normalized, LOCAL egress only).
 *
 * Output JSON (consumed offline by the committed gate test via
 * P1_REAL_EMBEDDINGS_JSON):
 *   {
 *     identity: { providerId, modelId, modelRevision, vectorDimension,
 *                 embeddingVersion, inputNormalizationVersion,
 *                 outputNormalizationVersion },
 *     manifestHash, modelDirUsed,
 *     sourceVectors: { [canonicalSourceId]: number[768] },
 *     targetVectors: { [groupId]: number[768] }
 *   }
 *
 * The committed test itself stays OFFLINE-deterministic: it consumes this
 * JSON and never loads the model. This script is the ONLY step that touches
 * the local model (weights are LOCAL; no corpus egress).
 *
 * USAGE (run manually, from research-orchestration/):
 *   node bin/build-real-embeddings.mjs \
 *     --root  <artifactsRoot>            (default <repoRoot>/work/dogfood-t09-reval1)
 *     --out   <embeddings.json path>     (default <repoRoot>/work/p1-wave-01-integration/real-embeddings.json)
 *     --model-dir <local model dir>      (default env P1_T10_ONNX_MODEL_DIR or
 *                                         <repoRoot>/research-orchestration/models-bge-base-zh-v1.5)
 *   [--cache-dir <embedding cache dir>]
 *
 * One-time model acquisition (exact revision pinned, ~100 MB):
 *   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 \
 *   node discovery/p1-t01-embedding-qualification/fetch-model.mjs \
 *     --revision 71e50dc531959f9e04ebf190ea25b00261a0a186 --dir <model dir>
 *
 * No new npm dependencies. No network inside this script (model weights are
 * already LOCAL after the fetch-model step).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORCH_ROOT = path.resolve(HERE, '..');          // research-orchestration/
const REPO_ROOT = path.resolve(ORCH_ROOT, '..');     // repo root

import { createEmbeddingProvider, ACCEPTED_LOCAL_PROFILE } from '../lib/embedding-provider.mjs';
import { REQUIRED_EMBEDDING_IDENTITY } from '../lib/dense-geometry.mjs';
import { deriveCanonicalSourceId } from '../lib/rce-input-adapter.mjs';

function parseArgs(argv) {
  const out = {
    root: process.env.P1_REAL_DOGFOOD_ROOT
      ?? path.join(REPO_ROOT, 'work', 'dogfood-t09-reval1'),
    out: process.env.P1_WAVE_INTEGRATION_OUT
      ? path.join(process.env.P1_WAVE_INTEGRATION_OUT, 'real-embeddings.json')
      : path.join(REPO_ROOT, 'work', 'p1-wave-01-integration', 'real-embeddings.json'),
    modelDir: process.env.P1_T10_ONNX_MODEL_DIR
      ?? path.join(ORCH_ROOT, 'models-bge-base-zh-v1.5'),
    cacheDir: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--root') out.root = path.resolve(argv[++i]);
    else if (argv[i] === '--out') out.out = path.resolve(argv[++i]);
    else if (argv[i] === '--model-dir') out.modelDir = path.resolve(argv[++i]);
    else if (argv[i] === '--cache-dir') out.cacheDir = path.resolve(argv[++i]);
    else {
      console.error(`FAIL_CLOSED: unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  return out;
}

function failClosed(reason) {
  console.error(`FAIL_CLOSED: ${reason}`);
  process.exit(2);
}

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

async function main() {
  const { root, out, modelDir, cacheDir } = parseArgs(process.argv);

  const statePath = path.join(root, 'multi-group-state.json');
  if (!fs.existsSync(statePath)) failClosed(`real artifacts root has no multi-group-state.json at ${statePath}`);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const manifest = state.manifest;
  if (manifest?.type !== 'research-corpus-manifest') failClosed('multi-group-state.json carries no real manifest under key `manifest`');

  // Decompose + collect texts (fail closed on any missing artifact / hash mismatch)
  const texts = [];        // parallel to { kind, key }
  const sourceKeys = [];
  const targetKeys = [];
  for (const g of manifest.groups) {
    const answersAbs = path.join(root, g.answersRel);
    if (!fs.existsSync(answersAbs)) failClosed(`missing verified artifact ${g.answersRel}`);
    const actual = sha256File(answersAbs);
    if (actual !== g.answersHash) failClosed(`answersHash mismatch for ${g.answersRel}`);
    const parsed = JSON.parse(fs.readFileSync(answersAbs, 'utf8'));
    for (const entry of parsed.answers) {
      const cid = deriveCanonicalSourceId(g.groupId, entry.id);
      sourceKeys.push(cid);
      texts.push({ kind: 'source', key: cid, text: String(entry.excerpt ?? '') });
    }
    const targetText = String(parsed.questionTitle ?? '');
    if (targetText.length === 0) failClosed(`no questionTitle for group ${g.groupId}`);
    targetKeys.push(g.groupId);
    texts.push({ kind: 'target', key: g.groupId, text: targetText });
  }

  const provider = createEmbeddingProvider({ modelDir, cacheDir });
  const pre = await provider.preflight();
  if (!pre.ok) failClosed(`embedding provider preflight failed: ${pre.failureCode} ${pre.error}`);

  const { vectors } = await provider.embed(texts.map((t) => t.text));

  const sourceVectors = {};
  const targetVectors = {};
  vectors.forEach((v, i) => {
    const t = texts[i];
    if (t.kind === 'source') sourceVectors[t.key] = v;
    else targetVectors[t.key] = v;
  });
  for (const k of sourceKeys) if (!sourceVectors[k]) failClosed(`missing source vector for ${k}`);
  for (const k of targetKeys) if (!targetVectors[k]) failClosed(`missing target vector for ${k}`);

  const payload = {
    identity: { ...REQUIRED_EMBEDDING_IDENTITY },
    manifestHash: manifest.manifestHash,
    modelDirUsed: modelDir,
    profile: {
      modelId: ACCEPTED_LOCAL_PROFILE.modelId,
      modelRevision: ACCEPTED_LOCAL_PROFILE.modelRevision,
      vectorDimension: ACCEPTED_LOCAL_PROFILE.vectorDimension,
    },
    sourceVectors,
    targetVectors,
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload)}\n`);
  console.log(`real embeddings written: ${out}`);
  console.log(`  sources: ${Object.keys(sourceVectors).length}, targets: ${Object.keys(targetVectors).length}`);
}

main().catch((err) => {
  console.error(`build-real-embeddings failed: ${err?.message ?? err}`);
  process.exit(1);
});
