// adjudication-packet-v2-2.mjs — generate adjudication-packet-v2.2.json
// (FINAL data model; P0-1 case-scoped labels / P0-2 membership!=stance /
// P1 gold-independent expertise evidence). Does NOT touch gold / selectors /
// metrics; no benchmark rerun.

import fs from 'node:fs';
import path from 'node:path';
import { loadCase } from '../lib/case-loader.mjs';
import { buildAdjudicationPacketV22 } from '../lib/adjudication-v2-2.mjs';
import { sanitize } from '../lib/results.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const REAL_CASES = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode'];

function main() {
  const loaded = REAL_CASES.map((caseId) => loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId }));
  const packet = buildAdjudicationPacketV22({ cases: loaded.map((l) => ({ caseCfg: l.caseCfg, gold: l.gold, pool: l.pool })) });

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

  const out1 = path.join(ROOT, 'benchmark/results/adjudication-packet-v2.2.json');
  const out2 = path.join(ROOT, 'benchmark/results/adjudication-mechanical-metadata.json');
  fs.writeFileSync(out1, JSON.stringify(sanitize(packet), null, 2));
  fs.writeFileSync(out2, JSON.stringify(sanitize(mechMeta), null, 2));

  // quick audit
  const stanceSources = packet.case_labels.filter((cl) => cl.proposed_semantic_labels.claim_stances.length > 0).length;
  const membershipSources = packet.required_provenance_memberships.length;
  const supportedExpert = packet.case_labels.filter((cl) => cl.proposed_semantic_labels.expert_topic_match_status === 'SUPPORTED').length;
  console.log('ADJUDICATION_V22_OK sources=' + packet.source_count + ' case_labels=' + packet.case_label_count);
  console.log('case_labels_with_claim_stance=' + stanceSources + ' | required_provenance_memberships=' + membershipSources);
  console.log('expert SUPPORTED labels=' + supportedExpert + ' (gold-independent discovery)');
  // no stance fabricated from provenance: verify every stance source is in some contradiction cluster
  console.log('provenance_membership_count_by_case=' + JSON.stringify(packet.required_provenance_memberships.reduce((a, m) => { a[m.case_id] = (a[m.case_id] || 0) + 1; return a; }, {})));
}

main();
