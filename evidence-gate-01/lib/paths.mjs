// Root-relative path resolution — A4 reproducibility fix.
// Every script resolves directories from THIS module's own location
// (evidence-gate-01/), so a fresh checkout works from ANY cwd with no
// symlinks and no layout assumption beyond the committed tree.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // <root>/lib
export const ROOT = path.resolve(HERE, '..');

export const paths = {
  root: ROOT,
  corpus: path.join(ROOT, 'corpus'),
  cases: path.join(ROOT, 'cases'),
  tests: path.join(ROOT, 'tests'),
  resultsD21: path.join(ROOT, 'results/d21'),
  resultsRace: path.join(ROOT, 'results/race'),
  packets: path.join(ROOT, 'packets'),
  preRegistration: path.join(ROOT, 'pre-registration'),
  denseCache: path.join(ROOT, 'dense-embedding/cache'),
  denseModels: path.join(ROOT, 'dense-embedding/models'),
  adjudication: path.join(ROOT, 'adjudication'),
};

export const CASE_IDS = [
  'case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224',
  'case-cross-lowcode', 'case-synth-dominance', 'case-synth-expert',
];

export const REAL_CASE_IDS = [
  'case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224',
  'case-cross-lowcode',
];