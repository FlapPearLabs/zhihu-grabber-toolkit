// Inspect which fresh sources B2 selected in cross case (noise-source check).
import fs from 'node:fs';
import path from 'node:path';
import { loadQuestion } from '../lib/corpus.mjs';

const CORPUS = path.resolve('benchmark/corpus');
const r = JSON.parse(fs.readFileSync(path.resolve('benchmark/results/runs/case-cross-lowcode__B2_MMR_MULTI_LANE__K_MEDIUM.json'), 'utf8'));
const byId = new Map();
for (const qid of ['439521858', '477427067', '462973596', '466695857', '485463474', '487214224']) {
  const q = loadQuestion(CORPUS, qid);
  for (const s of q.sources) byId.set(s.source_id, s);
}
console.log('B2 cross K_MEDIUM selected:');
for (const id of r.selected_source_ids) {
  const s = byId.get(id);
  const fresh = s && s.createdTime && s.createdTime >= 1786628392 - 31536000;
  console.log(`  ${id} | ${s ? s.author : '?'} | fresh=${fresh} | ${s ? s.content_text.slice(0, 30) : ''}`);
}
const NOISE = '487214224:2027722356278215762';
console.log('NOISE_SOURCE_SELECTED:', r.selected_source_ids.includes(NOISE));
