// adjudication-packet-v2.mjs — P0-7: source-level adjudication packet.
// Writes:
//   benchmark/results/adjudication-packet-v2.json   (adjudication view; no popularity)
//   benchmark/results/adjudication-mechanical-metadata.json  (vote/comment/url etc., separate)
// Real cases only (semantic adjudication applies to real corpus; synthetic
// fixtures are FIXTURE_MECHANICAL and need no adjudication).

import fs from 'node:fs';
import path from 'node:path';
import { loadCase } from '../lib/case-loader.mjs';
import { buildAdjudicationPacketV2 } from '../lib/adjudication-v2.mjs';
import { sanitize } from '../lib/results.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const REAL_CASES = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode'];

function main() {
  const loaded = REAL_CASES.map((caseId) => loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId }));
  const packet = buildAdjudicationPacketV2({ cases: loaded.map((l) => ({ caseCfg: l.caseCfg, gold: l.gold, pool: l.pool })) });

  // separate mechanical metadata (NOT in adjudication view; popularity fields live here)
  const mechMeta = {
    schema: 'zhihu-research-benchmark/adjudication-mechanical-metadata',
    note: 'mechanical fields kept OUT of the adjudication view to reduce popularity bias; consult only if needed',
    sources: [],
  };
  const seen = new Set();
  for (const l of loaded) {
    for (const s of l.pool.sources) {
      if (seen.has(s.source_id)) continue;
      seen.add(s.source_id);
      mechMeta.sources.push({
        source_id: s.source_id,
        question_id: s.question_id,
        author_display: s.author,
        voteupCount: s.voteupCount,
        commentCount: s.commentCount,
        createdTime: s.createdTime,
        url: s.url,
        evidence_markers: s.evidence_markers,
        content_chars: s.content_chars,
      });
    }
  }

  const out1 = path.join(ROOT, 'benchmark/results/adjudication-packet-v2.json');
  const out2 = path.join(ROOT, 'benchmark/results/adjudication-mechanical-metadata.json');
  fs.writeFileSync(out1, JSON.stringify(sanitize(packet), null, 2));
  fs.writeFileSync(out2, JSON.stringify(sanitize(mechMeta), null, 2));
  console.log('ADJUDICATION_V2_OK sources=' + packet.source_count + ' cross_claims=' + packet.cross_question_provenance.length);
  console.log('MECH_META_OK sources=' + mechMeta.sources.length);
  const sample = packet.sources[0];
  console.log('sample:', sample.source_id, '| labels:', JSON.stringify(sample.proposed_semantic_labels).slice(0, 160));
}

main();
