// dense-embed.mjs — REAL dense embedding backend (Phase B).
// Model: Xenova/bge-small-zh-v1.5 (BAAI bge-small-zh-v1.5, ONNX, 512-dim,
// Chinese-optimized) via @xenova/transformers (transformers.js v2).
// Guarantees:
//   - model/version identity recorded in every embedding artifact
//   - deterministic input normalization (same normalizeText as ngram harness)
//   - on-disk + in-memory embedding cache (sha256(text) -> vector JSON)
//   - NEVER falls back to ngram and still claims Dense
// Determinism note: ONNX fp32 inference on the same model weights + same input
// produces identical vectors across runs on the same machine; vectors are
// cached to disk so re-runs reuse exact bytes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline, env } from '@xenova/transformers';
import { normalizeText } from './embeddings.mjs';
import { paths } from './paths.mjs';

export const DENSE_MODEL = {
  id: 'Xenova/bge-small-zh-v1.5',
  upstream: 'BAAI/bge-small-zh-v1.5',
  dims: 512,
  kind: 'real-dense-embedding (ONNX fp32 via transformers.js)',
  quantization: 'fp32',
  max_seq_length: 512,
  license: 'MIT (BAAI bge)',
  files: ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt', 'onnx/model.onnx'],
  note: 'Chinese-optimized BERT-based embedding; cosine similarity in benchmark is computed over these real vectors, NOT char n-grams. Model files pinned in dense-embedding/models/ (sha256 in embedding identity artifact).',
};

let _extractor = null;
async function getExtractor() {
  if (!_extractor) {
    // Local pinned model files (downloaded & verified at gate-01 setup time).
    // NO remote fetch at runtime -> deterministic, offline, reproducible.
    env.localModelPath = paths.denseModels + path.sep;
    env.allowRemoteModels = false;
    _extractor = await pipeline('feature-extraction', DENSE_MODEL.id, {
      local_files_only: true,
      quantized: false, // fp32: deterministic exact weights
    });
  }
  return _extractor;
}

const cacheFile = path.join(paths.denseCache, 'embedding-cache.json');

export function loadDiskCache() {
  if (!fs.existsSync(cacheFile)) return new Map();
  const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const m = new Map();
  for (const [k, v] of Object.entries(j)) m.set(k, v);
  return m;
}

export function saveDiskCache(cache) {
  fs.mkdirSync(paths.denseCache, { recursive: true });
  const j = Object.fromEntries(cache);
  fs.writeFileSync(cacheFile, JSON.stringify(j));
}

// Normalized deterministic input: same normalization as the harness ngram
// path (stripHtml+lowercase+token filter), then explicit token truncation at
// model max length by transformers.js. The FULL normalized text is what gets
// embedded — no randomness anywhere.
export function denseEmbedInput(text) {
  return normalizeText(text);
}

// async embed: {vec: Float32Array-ish Array, cached: bool}
export async function embedDense(text, cache = new Map()) {
  const key = crypto.createHash('sha256').update(String(text || '')).digest('hex');
  const hit = cache.get(key);
  if (hit) return { vec: Float32Array.from(hit), cached: true, key };
  const input = denseEmbedInput(text);
  const ex = await getExtractor(); // NOTE: must await the extractor promise FIRST
  const out = await ex(input, { pooling: 'mean', normalize: true });
  const vec = Array.from(out.data);
  cache.set(key, vec);
  return { vec: Float32Array.from(vec), cached: false, key };
}

export async function denseCosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const raw = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.max(0, Math.min(1, raw));
}

export function embeddingIdentity() {
  return {
    model: DENSE_MODEL,
    runtime: 'transformers.js @xenova/transformers',
    norm: 'normalizeText (shared with harness) + mean pooling + L2 normalize',
    determinism: 'fp32 ONNX, fixed weights, sha256 input keys, disk cache',
    artifact: 'dense-embedding/cache/embedding-cache.json',
  };
}