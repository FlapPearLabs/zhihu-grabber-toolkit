// Read-only content scan for blind PROVISIONAL gold proposal.
import fs from 'node:fs';
import path from 'node:path';
import { loadQuestion, loadManifest } from '../lib/corpus.mjs';

const CORPUS = path.resolve('benchmark/corpus');
const manifest = loadManifest(CORPUS);
for (const e of manifest.entries) {
  const q = loadQuestion(CORPUS, e.qid);
  console.log('\n########## ' + e.qid + ' | ' + q.title + ' | verified=' + q.verified + ' | captured=' + q.capturedCount + '/' + q.answerCount + ' | fetched=' + q.fetchedAt);
  console.log('topics: ' + q.topics.join(', '));
  for (const s of q.sources) {
    const d = s.createdTime ? new Date(s.createdTime * 1000).toISOString().slice(0, 10) : '?';
    const flags = (s.evidence_markers.has_code ? 'C' : '-') + (s.evidence_markers.has_external_links ? 'L' : '-') + (s.evidence_markers.has_references ? 'R' : '-') + (s.evidence_markers.has_images ? 'I' : '-');
    const snip = s.content_text.slice(0, 90).replace(/\n/g, ' ');
    console.log(`${s.source_id} | v=${s.voteupCount} | cm=${s.commentCount} | ${d} | ${s.content_chars}c | ${flags} | ${s.author} | ${snip}`);
  }
}
