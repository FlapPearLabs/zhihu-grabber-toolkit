// adjudication-packet.mjs — Stage B: package the PROVISIONAL semantic gold
// proposals for human/ChatGPT adjudication. This packet is the mechanism by
// which agent-proposed labels become FINAL human gold — the agent MUST NOT
// self-promote semantic labels to FINAL on its own.

import fs from 'node:fs';
import path from 'node:path';
import { loadCase } from '../lib/case-loader.mjs';
import { goldStatsByFamily } from '../lib/gold-stats.mjs';
import { sanitize } from '../lib/results.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const CASE_IDS = [
  'case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224',
  'case-cross-lowcode', 'case-synth-dominance', 'case-synth-expert',
];

function main() {
  const packet = {
    schema: 'zhihu-research-benchmark/adjudication-packet',
    schema_version: '1.0.0-pilot',
    generated_at: new Date().toISOString(),
    purpose: 'Human/ChatGPT adjudication of PROVISIONAL semantic gold. Agent proposed labels below; adjudicator may CONFIRM / REVISE / REJECT each. Only adjudicated labels become FINAL human gold. FIXTURE_MECHANICAL cases (synthetic) need no adjudication.',
    cases: [],
  };
  for (const caseId of CASE_IDS) {
    const loaded = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId });
    const { caseCfg, gold, goldStats, dataset_version } = loaded;
    const needsAdjudication = gold.provenance.label_status === 'PROVISIONAL';
    const entry = {
      case_id: caseId,
      dataset_version,
      label_status: gold.provenance.label_status,
      needs_adjudication: needsAdjudication,
      category: caseCfg.category,
      gold_stats_by_family: goldStats,
      per_family_labels: {},
    };
    for (const [name, f] of Object.entries(gold.families)) {
      if (!f || typeof f !== 'object') continue;
      const summary = { label_status: f.label_status || 'UNSPECIFIED' };
      if (f.sources) summary.source_count = f.sources.length;
      if (f.unresolved_sources && f.unresolved_sources.length) summary.unresolved = f.unresolved_sources.length;
      if (f.disputed_sources && f.disputed_sources.length) summary.disputed = f.disputed_sources.length;
      if (f.aspects) summary.aspects = f.aspects.map((a) => ({ aspect_id: a.aspect_id, name: a.name, sources: a.sources.length }));
      if (f.claim_clusters) summary.claim_clusters = f.claim_clusters.map((c) => ({ claim_id: c.claim_id, canonical_claim: c.canonical_claim, stances: Object.fromEntries(Object.entries(c.stances || {}).map(([k, v]) => [k, v.length])), disputed: !!c.disputed }));
      if (f.claim_groups) summary.claim_groups = f.claim_groups.map((g) => ({ claim_id: g.claim_id, claim: g.claim, required_provenance_groups: (g.required_provenance_groups || []).map((grp) => ({ group: grp.group, question_ids: grp.question_ids, sources: grp.sources.length })) }));
      if (f.window) summary.window = f.window;
      entry.per_family_labels[name] = summary;
    }
    packet.cases.push(entry);
  }
  const out = path.join(ROOT, 'benchmark/results/adjudication-packet.json');
  fs.writeFileSync(out, JSON.stringify(sanitize(packet), null, 2));
  console.log('ADJUDICATION_PACKET_OK ->', out);
  for (const c of packet.cases) console.log(`${c.case_id}\tlabel=${c.label_status}\tneeds_adjudication=${c.needs_adjudication}`);
}

main();
