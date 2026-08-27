// Benchmark corpus sync: READ-ONLY copy of existing verified/captured corpora
// from the original worktree into the isolated benchmark workspace, with a
// SHA-256 manifest. No new scraping. Source paths are recorded as relative
// pointers for provenance; the manifest is machine-auditable.
// Source repository path is injected via env (SRC_REPO) to keep machine-private
// paths out of the deliverable. Defaults to a relative sibling convention; a
// real run must pass SRC_REPO explicitly.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SRC = process.env.SRC_REPO || path.resolve('..');
const DST = path.resolve('benchmark/corpus');
const SOURCES = [
  { qid: '439521858', file: 'out/439521858/answers.json', handoff: 'out/439521858/handoff.json' },
  { qid: '477427067', file: 'out/smoke-p3/477427067/answers.json', handoff: 'out/smoke-p3/477427067/handoff.json' },
  { qid: '462973596', file: '.workbuddy/live-batch-smoke-2/run/462973596/answers.json', handoff: null },
  { qid: '466695857', file: '.workbuddy/live-batch-smoke-2/run/466695857/answers.json', handoff: null },
  { qid: '485463474', file: '.workbuddy/live-batch-smoke-2/run/485463474/answers.json', handoff: null },
  { qid: '487214224', file: '.workbuddy/live-batch-smoke-2/run/487214224/answers.json', handoff: null },
];
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const entries = [];
for (const s of SOURCES) {
  const srcAbs = path.join(SRC, s.file);
  if (!fs.existsSync(srcAbs)) { console.error('MISSING SOURCE', srcAbs); process.exit(1); }
  const raw = fs.readFileSync(srcAbs);
  const parsed = JSON.parse(raw.toString('utf8'));
  const dstDir = path.join(DST, s.qid);
  fs.mkdirSync(dstDir, { recursive: true });
  fs.writeFileSync(path.join(dstDir, 'answers.json'), raw);
  let handoffVerified = null;
  if (s.handoff) {
    const h = JSON.parse(fs.readFileSync(path.join(SRC, s.handoff), 'utf8'));
    handoffVerified = h.verified === true;
  }
  entries.push({
    qid: s.qid,
    title: parsed.questionTitle,
    answerCount: parsed.answerCount,
    captured: (parsed.answers || []).length,
    fetchedAt: parsed.fetchedAt,
    sha256: sha256(raw),
    bytes: raw.length,
    source: s.file,
    handoffVerified,
  });
}
const manifest = {
  manifest_version: 1,
  created_at: new Date().toISOString(),
  corpus_scope: 'lowcode-research-selection',
  entries,
};
fs.writeFileSync(path.join(DST, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('CORPUS_SYNC_OK');
for (const e of entries) {
  console.log(e.qid + '\t' + e.title.slice(0, 30) + '\tans=' + e.answerCount + '\tcap=' + e.captured + '\tverified=' + e.handoffVerified + '\tsha=' + e.sha256.slice(0, 12));
}
