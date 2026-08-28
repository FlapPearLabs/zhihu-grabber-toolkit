// Deterministic embedding adapter (benchmark layer only).
// Character n-gram TF vectors + cosine. Deterministic, offline, no credentials.
// IMPORTANT: this is a *similarity proxy*, NOT a neural embedding. See RUNTIME.

import crypto from 'node:crypto';

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const LATIN_WORD = /[a-z0-9]+/g;

// ---- text normalization -----------------------------------------------------
export function stripHtml(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&[a-zA-Z#0-9]+;/g, ' '); // entities -> space
  return s;
}

export function normalizeText(text) {
  const s = stripHtml(text).toLowerCase();
  // keep CJK chars and latin/digits; everything else becomes whitespace
  let out = '';
  for (const ch of s) {
    if (CJK.test(ch)) out += ch;
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---- feature extraction -----------------------------------------------------
export function extractFeatures(text) {
  const norm = normalizeText(text);
  const counts = new Map();
  const add = (f) => counts.set(f, (counts.get(f) || 0) + 1);
  // CJK: unigrams + bigrams over contiguous CJK runs
  const cjkRuns = norm.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) || [];
  for (const run of cjkRuns) {
    for (const ch of run) add('c1:' + ch);
    for (let i = 0; i < run.length - 1; i++) add('c2:' + run.slice(i, i + 2));
  }
  // Latin/digits: word tokens + bigram word pairs
  const words = norm.match(LATIN_WORD) || [];
  for (const w of words) add('w:' + w);
  for (let i = 0; i < words.length - 1; i++) add('w2:' + words[i] + '|' + words[i + 1]);
  // sublinear TF weights
  const vec = new Map();
  for (const [f, tf] of counts) vec.set(f, 1 + Math.log1p(tf));
  return vec;
}

function dot(a, b) {
  let d = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [f, v] of small) {
    const w = large.get(f);
    if (w !== undefined) d += v * w;
  }
  return d;
}

function norm(vec) {
  let s = 0;
  for (const v of vec.values()) s += v * v;
  return Math.sqrt(s);
}

// ---- embedding cache --------------------------------------------------------
const _cache = new Map(); // sha256(text) -> feature vector

export function embed(text, cache = _cache) {
  const h = crypto.createHash('sha256').update(String(text)).digest('hex');
  let vec = cache.get(h);
  if (vec) return { vec, cached: true };
  vec = extractFeatures(text);
  cache.set(h, vec);
  return { vec, cached: false };
}

export function boundedCosine(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  const raw = dot(a, b) / (na * nb);
  // clamp to [0,1] per approved metric contract
  return Math.max(0, Math.min(1, raw));
}

export function cacheStats() {
  return { cachedEntries: _cache.size };
}
