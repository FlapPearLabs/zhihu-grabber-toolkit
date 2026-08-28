#!/usr/bin/env node
// fetch-dense-model.mjs — one-command pinned model fetch (A4 reproducibility).
// Downloads the EXACT model files used in gate-01 (Xenova/bge-small-zh-v1.5,
// fp32 ONNX) from HuggingFace and verifies SHA-256 against the pinned
// identities in dense-embedding/model-sha256.txt. No runtime download needed
// afterwards (dense-embed.mjs runs with allowRemoteModels=false).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { paths, ROOT } from '../lib/paths.mjs';

const MODEL_DIR = path.join(paths.denseModels, 'Xenova/bge-small-zh-v1.5');
const BASE_URL = 'https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main';
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt', 'onnx/model.onnx'];

const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function pinnedShas() {
  const p = path.join(ROOT, 'dense-embedding/model-sha256.txt');
  const out = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([0-9a-f]{64}) \*(.+)$/);
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

function curl(url, outFile) {
  const curlBin = process.env.CURL_BIN || 'curl';
  console.log(`downloading ${url}`);
  execFileSync(curlBin, ['-sL', '-o', outFile, '--max-time', '600', url], { stdio: ['ignore', 'inherit', 'inherit'] });
}

function main() {
  const shas = pinnedShas();
  fs.mkdirSync(path.join(MODEL_DIR, 'onnx'), { recursive: true });
  let ok = true;
  for (const f of FILES) {
    const target = path.join(MODEL_DIR, f);
    if (!fs.existsSync(target)) curl(`${BASE_URL}/${f}`, target);
    else console.log(`present: ${f}`);
    const got = sha256hex(fs.readFileSync(target));
    const want = shas.get(`Xenova/bge-small-zh-v1.5/${f}`);
    if (!want) { console.error(`NO PINNED SHA for ${f}`); process.exit(1); }
    if (got !== want) { console.error(`SHA MISMATCH ${f}: got ${got.slice(0, 12)} want ${want.slice(0, 12)}`); ok = false; }
    else console.log(`verified ${f} ${got.slice(0, 12)}`);
  }
  if (!ok) process.exit(1);
  console.log('DENSE_MODEL_READY');
}

main();