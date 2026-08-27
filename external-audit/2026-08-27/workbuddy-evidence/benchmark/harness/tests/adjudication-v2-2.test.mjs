// adjudication-v2-2.test.mjs — FINAL data model invariant tests (FAIL CLOSED).
// Required tests:
//   1. same source in single case + cross case -> two independent case_label records
//   2. case A must_see=true, case B must_see=false -> values remain different
//   3. case A long_tail=true, case B long_tail=false -> no OR leakage
//   4. required_provenance source -> does NOT automatically create claim_stance
//   5. explicit contradiction stance -> DOES create claim_stance
//   6. expertise evidence discovery runs for a source NOT in provisional expert gold
//   7. every case_label aspect_id resolves inside THAT case dictionary
//   8. every case_label claim_id resolves inside THAT case dictionary
// Plus: two-layer structural sanity + on-disk artifact consistency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCase } from '../lib/case-loader.mjs';
import { buildAdjudicationPacketV22 } from '../lib/adjudication-v2-2.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const REAL_CASES = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode'];

function buildRealPacket() {
  const loaded = REAL_CASES.map((caseId) => loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId }));
  return buildAdjudicationPacketV22({ cases: loaded.map((l) => ({ caseCfg: l.caseCfg, gold: l.gold, pool: l.pool })) });
}

// tiny helpers for synthetic scenario tests
function mkSource(qid, id, author, vote, created, text, assets = {}) {
  return {
    source_id: `${qid}:${id}`, question_id: qid, answer_id: String(id), author,
    author_key: String(author).toLowerCase(), url: null,
    content_html: text, content_text: text, content_chars: text.length,
    voteupCount: vote, commentCount: 0, createdTime: created, updatedTime: created,
    assets: { images: 0, links: 0, references: 0, codeBlocks: 0, videos: 0, domains: [], ...assets },
    evidence_markers: { has_code: false, has_external_links: false, has_references: false, has_images: false },
    pool_index: 0,
  };
}
function mkPool(questions) {
  const sources = questions.flatMap((q) => q.sources);
  return {
    candidate_pool_id: 't', questionIds: questions.map((q) => q.qid), questions, sources,
    verifiedSourceCount: 0, byId: new Map(sources.map((s) => [s.source_id, s])),
  };
}
const mkCfg = (id, qids, extra = {}) => ({ case_id: id, research_question: 'q', question_ids: qids, author_identity_confidence: 'WEAK', ...extra });

// ===========================================================================
// 1+2+3. case-scoped labels: no cross-case OR/merge (REAL packet evidence)
// ===========================================================================
test('REQ1: same source in single + cross case has two independent case_label records', () => {
  const p = buildRealPacket();
  // 466695857:1958779750 (领悟杂谈) appears in case-466695857 AND case-cross-lowcode
  const sid = '466695857:1958779750';
  const recs = p.case_labels.filter((cl) => cl.source_id === sid && ['case-466695857', 'case-cross-lowcode'].includes(cl.case_id));
  assert.equal(recs.length, 2, 'expected two independent case_label records, got ' + recs.length);
  assert.deepEqual(recs.map((r) => r.case_id).sort(), ['case-466695857', 'case-cross-lowcode']);
});

test('REQ2: case A must_see=true, case B must_see=false -> values remain different', () => {
  const p = buildRealPacket();
  // D2 (ChatGPT adjudicated): 439521858:3376976033 is must_see in case-439521858 but NOT in cross case
  const sid = '439521858:3376976033';
  const a = p.case_labels.find((cl) => cl.case_id === 'case-439521858' && cl.source_id === sid);
  const b = p.case_labels.find((cl) => cl.case_id === 'case-cross-lowcode' && cl.source_id === sid);
  assert.ok(a && b, 'both case_labels must exist');
  assert.equal(a.proposed_semantic_labels.must_see, true);
  assert.equal(b.proposed_semantic_labels.must_see, false, 'no cross-case propagation');
});

test('REQ3: case A long_tail=true, case B long_tail=false -> no OR leakage (synthetic)', () => {
  // two cases share a source; case A gold marks it long_tail, case B does not
  const shared = mkSource('Q1', 's1', 'A', 0, 1, 'unique long-tail contribution text here');
  const poolA = mkPool([{ qid: 'Q1', title: 't', sources: [shared] }]);
  const poolB = mkPool([{ qid: 'Q1', title: 't', sources: [shared] }]);
  const goldA = { families: { unique_long_tail_contribution: { sources: ['Q1:s1'] }, relevance: { per_question: { Q1: ['Q1:s1'] } } } };
  const goldB = { families: { unique_long_tail_contribution: { sources: [] }, relevance: { per_question: { Q1: ['Q1:s1'] } } } };
  const p = buildAdjudicationPacketV22({ cases: [{ caseCfg: mkCfg('case-A', ['Q1']), gold: goldA, pool: poolA }, { caseCfg: mkCfg('case-B', ['Q1']), gold: goldB, pool: poolB }] });
  const a = p.case_labels.find((cl) => cl.case_id === 'case-A' && cl.source_id === 'Q1:s1');
  const b = p.case_labels.find((cl) => cl.case_id === 'case-B' && cl.source_id === 'Q1:s1');
  assert.equal(a.proposed_semantic_labels.long_tail_unique, true);
  assert.equal(b.proposed_semantic_labels.long_tail_unique, false, 'no OR leakage across cases');
  assert.equal(p.source_count, 1, 'one intrinsic source');
  assert.equal(p.case_label_count, 2, 'two case-scoped labels');
});

// ===========================================================================
// 4+5. provenance membership != claim stance
// ===========================================================================
test('REQ4: required_provenance source does NOT automatically create claim_stance', () => {
  const p = buildRealPacket();
  // xq1 provenance includes 477427067:2040315771; that source has NO contradiction stance in cross case
  const sid = '477427067:2040315771';
  const cross = p.case_labels.find((cl) => cl.case_id === 'case-cross-lowcode' && cl.source_id === sid);
  assert.ok(cross, 'source must exist in cross case');
  assert.equal(cross.proposed_semantic_labels.claim_stances.length, 0, 'provenance membership must not fabricate stance');
  // but it IS a required provenance member
  assert.ok(p.required_provenance_memberships.some((m) => m.case_id === 'case-cross-lowcode' && m.source_id === sid), 'source must appear in required_provenance_memberships');
});

test('REQ5: explicit contradiction stance DOES create claim_stance', () => {
  const p = buildRealPacket();
  // 439521858:3376976033 (表单大师) is in c1-yida-verdict stances.for in case-439521858
  const sid = '439521858:3376976033';
  const rec = p.case_labels.find((cl) => cl.case_id === 'case-439521858' && cl.source_id === sid);
  assert.ok(rec, 'source must exist in case-439521858');
  assert.ok(rec.proposed_semantic_labels.claim_stances.length >= 1, 'explicit contradiction stance must produce claim_stance');
  const st = rec.proposed_semantic_labels.claim_stances.find((s) => s.stance === 'for');
  assert.ok(st, 'stance=for expected');
});

// ===========================================================================
// 6. gold-INDEPENDENT expertise discovery
// ===========================================================================
test('REQ6: expertise evidence discovery runs gold-independently for a non-gold-expert source (synthetic)', () => {
  // gold declares NO expert at all; vendor-name source and plain source both get
  // discovery run -> vendor SUPPORTED(self_identified_vendor), plain UNRESOLVED,
  // and neither was proposed by gold
  const vendor = mkSource('Q1', 'v', '简道云', 0, 1, '本平台为企业提供低代码解决方案');
  const plain = mkSource('Q1', 'p', '路人甲', 0, 1, '普通回答内容');
  const pool = mkPool([{ qid: 'Q1', title: 't', sources: [vendor, plain] }]);
  const gold = { families: { expertise_topic_match: { sources: [] }, relevance: { per_question: { Q1: ['Q1:v', 'Q1:p'] } } } };
  const p = buildAdjudicationPacketV22({ cases: [{ caseCfg: mkCfg('case-X', ['Q1']), gold, pool }] });
  const v = p.case_labels.find((cl) => cl.source_id === 'Q1:v');
  const pl = p.case_labels.find((cl) => cl.source_id === 'Q1:p');
  assert.equal(v.proposed_semantic_labels.expert_topic_match_proposed_by_gold, false);
  assert.equal(v.proposed_semantic_labels.expert_topic_match_status, 'SUPPORTED', 'vendor-name discovery runs even without gold expert');
  assert.ok(v.proposed_semantic_labels.expertise_evidence.evidence.length >= 1);
  assert.equal(pl.proposed_semantic_labels.expert_topic_match_status, 'UNRESOLVED');
  assert.ok(pl.proposed_semantic_labels.expertise_evidence.status === 'UNRESOLVED');
});

// ===========================================================================
// 7+8. resolution INSIDE THAT case dictionary
// ===========================================================================
test('REQ7+8: every case_label aspect_id/claim_id resolves inside ITS OWN case dictionary', () => {
  const p = buildRealPacket();
  const dictByCase = new Map(p.cases.map((c) => [c.case_id, c]));
  const violations = [];
  for (const cl of p.case_labels) {
    const dict = dictByCase.get(cl.case_id);
    if (!dict) { violations.push(`${cl.case_id}: missing case dict`); continue; }
    const aspectKeys = new Set(dict.aspect_dictionary.map((a) => a.aspect_id));
    const claimKeys = new Set(dict.claim_dictionary.map((c) => c.claim_id));
    for (const a of cl.proposed_semantic_labels.aspect_ids || []) {
      if (!aspectKeys.has(a)) violations.push(`${cl.case_id}/${cl.source_id}: aspect ${a} not in own dict`);
    }
    for (const cs of cl.proposed_semantic_labels.claim_stances || []) {
      if (!claimKeys.has(cs.claim_id)) violations.push(`${cl.case_id}/${cl.source_id}: claim ${cs.claim_id} not in own dict`);
    }
  }
  assert.deepEqual(violations, []);
});

// ===========================================================================
// structure + artifact consistency (FAIL CLOSED on everything above via assert)
// ===========================================================================
test('two-layer structure: sources intrinsic-only, case_labels carry semantics', () => {
  const p = buildRealPacket();
  const s = p.sources[0];
  assert.equal(s.proposed_semantic_labels, undefined, 'sources[] must be intrinsic-only');
  assert.ok(s.content_excerpt !== undefined && s.content_excerpt_status !== undefined);
  assert.ok(p.case_labels[0].case_id && p.case_labels[0].source_id);
  assert.ok(p.case_labels[0].proposed_semantic_labels.relevance !== undefined);
  assert.equal(p.source_count, 75, 'intrinsic source count');
  assert.equal(p.case_label_count, 135, 'case-scoped label count (17+18+15+7+3+75)');
});

test('on-disk adjudication-packet-v2.2.json exists, matches, passes invariant scan', () => {
  const file = path.join(ROOT, 'benchmark/results/adjudication-packet-v2.2.json');
  assert.ok(fs.existsSync(file), 'artifact missing');
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const built = buildRealPacket();
  assert.equal(disk.schema, 'zhihu-research-benchmark/adjudication-packet-v2.2');
  assert.equal(disk.source_count, built.source_count);
  assert.equal(disk.case_label_count, built.case_label_count);
  // every source complete (P0-1 from V2.1, must not regress)
  const missing = disk.sources.filter((s) => !s.content_excerpt && s.content_excerpt_status !== 'NO_TEXT_CONTENT');
  assert.equal(missing.length, 0, 'sources with silent missing excerpt: ' + missing.length);
});

test('label_schema preserved: all 8 labels + provenance membership rule', () => {
  const p = buildRealPacket();
  for (const l of ['relevance', 'must_see', 'aspect_membership', 'expert_topic_match', 'long_tail_unique', 'claim_stance', 'historical_authority', 'evidence_quality', 'required_provenance_membership']) {
    assert.ok(p.label_schema[l], 'missing label_schema.' + l);
  }
  assert.ok(p.label_schema.claim_stance.definition.includes('provenance membership never creates a stance') || p.label_schema.claim_stance.definition.includes('never'), 'claim_stance schema must encode membership!=stance');
});
