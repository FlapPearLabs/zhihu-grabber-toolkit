// adjudication-packet-v2-1.mjs — generate adjudication-packet-v2.1.json
// (self-contained, P0-1/2/3 fixed) + mechanical metadata (unchanged).
// Does NOT touch gold / selectors / metrics; no benchmark rerun.

import fs from 'node:fs';
import path from 'node:path';
import { loadCase } from '../lib/case-loader.mjs';
import { buildAdjudicationPacketV21 } from '../lib/adjudication-v2-1.mjs';
import { sanitize } from '../lib/results.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const REAL_CASES = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode'];

function main() {
  const loaded = REAL_CASES.map((caseId) => loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId }));
  const packet = buildAdjudicationPacketV21({ cases: loaded.map((l) => ({ caseCfg: l.caseCfg, gold: l.gold, pool: l.pool })) });

  // mechanical metadata (separate; popularity fields stay out of adjudication view)
  const mechMeta = { schema: 'zhihu-research-benchmark/adjudication-mechanical-metadata', sources: [] };
  const seen = new Set();
  for (const l of loaded) {
    for (const s of l.pool.sources) {
      if (seen.has(s.source_id)) continue;
      seen.add(s.source_id);
      mechMeta.sources.push({
        source_id: s.source_id, question_id: s.question_id, author_display: s.author,
        voteupCount: s.voteupCount, commentCount: s.commentCount, createdTime: s.createdTime,
        url: s.url, evidence_markers: s.evidence_markers, content_chars: s.content_chars,
      });
    }
  }

  const out1 = path.join(ROOT, 'benchmark/results/adjudication-packet-v2.1.json');
  const out2 = path.join(ROOT, 'benchmark/results/adjudication-mechanical-metadata.json');
  fs.writeFileSync(out1, JSON.stringify(sanitize(packet), null, 2));
  fs.writeFileSync(out2, JSON.stringify(sanitize(mechMeta), null, 2));

  const missing = packet.sources.filter((s) => !s.content_excerpt && s.content_excerpt_status !== 'NO_TEXT_CONTENT');
  const unresolvedExpert = packet.sources.filter((s) => s.proposed_semantic_labels.expert_topic_match_status === 'UNRESOLVED');
  console.log('ADJUDICATION_V21_OK sources=' + packet.source_count + ' cross_claims=' + packet.cross_question_provenance.length);
  console.log('missing_excerpt_or_status=' + missing.length);
  console.log('unresolved_expert=' + unresolvedExpert.length);
  const ex = packet.sources.find((s) => s.source_id === '477427067:2179827948');
  console.log('sample_excerpt_len=' + (ex.content_excerpt || '').length + ' status=' + ex.content_excerpt_status + ' kind=' + ex.content_kind);
  const exp = packet.sources.find((s) => s.proposed_semantic_labels.expert_topic_match_status === 'SUPPORTED');
  console.log('supported_expert_sample=' + (exp ? exp.source_id + ' | ' + JSON.stringify(exp.proposed_semantic_labels.expertise_evidence).slice(0, 140) : 'none'));
}

main();
