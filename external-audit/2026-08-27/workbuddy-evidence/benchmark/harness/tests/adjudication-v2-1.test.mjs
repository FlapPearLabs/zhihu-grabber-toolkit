// adjudication-v2-1.test.mjs — P1 REAL-ARTIFACT INVARIANT TEST (FAIL CLOSED).
// Runs against the ACTUAL real adjudication packet (built from the real frozen
// cases, identical to benchmark/results/adjudication-packet-v2.1.json), and
// additionally verifies the on-disk artifact exists and matches.
// Invariants per source:
//   - identity fields exist (source_id, question_id, question_title, author_display)
//   - (content_excerpt non-empty) OR (content_excerpt_status === 'NO_TEXT_CONTENT'
//     with content_kind + content_metadata)
//   - every aspect_id resolves in some case's aspect_dictionary
//   - every claim_stances.claim_id resolves in some case's claim_dictionary
//   - expert scorable (SUPPORTED) => expertise evidence non-empty
//   - UNRESOLVED => expertise_evidence present with status UNRESOLVED
// Any violation => FAIL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCase } from '../lib/case-loader.mjs';
import { buildAdjudicationPacketV21 } from '../lib/adjudication-v2-1.mjs';

const ROOT = path.resolve('.');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');
const REAL_CASES = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode'];

function buildRealPacket() {
  const loaded = REAL_CASES.map((caseId) => loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId }));
  return buildAdjudicationPacketV21({ cases: loaded.map((l) => ({ caseCfg: l.caseCfg, gold: l.gold, pool: l.pool })) });
}

function collectViolations(packet) {
  const violations = [];
  const aspectKeys = new Set();
  const claimKeys = new Set();
  for (const c of packet.cases) {
    for (const a of c.aspect_dictionary || []) aspectKeys.add(a.aspect_id);
    for (const cl of c.claim_dictionary || []) claimKeys.add(cl.claim_id);
  }
  for (const s of packet.sources) {
    // identity fields
    for (const f of ['source_id', 'question_id', 'question_title', 'author_display']) {
      if (s[f] === undefined || s[f] === null || String(s[f]).length === 0) violations.push(`${s.source_id}: missing identity field ${f}`);
    }
    // content invariant (P0-1)
    const excerptOk = s.content_excerpt && s.content_excerpt.length > 0;
    const noTextOk = s.content_excerpt_status === 'NO_TEXT_CONTENT' && s.content_kind && s.content_metadata;
    if (!excerptOk && !noTextOk) violations.push(`${s.source_id}: content_excerpt empty without explicit NO_TEXT_CONTENT status`);
    if (s.content_excerpt_status !== undefined && !['OK', 'NO_TEXT_CONTENT', 'REDACTED_SENSITIVE'].includes(s.content_excerpt_status)) violations.push(`${s.source_id}: unknown content_excerpt_status ${s.content_excerpt_status}`);
    // aspect resolution (P0-3)
    for (const a of s.proposed_semantic_labels.aspect_ids || []) {
      if (!aspectKeys.has(a)) violations.push(`${s.source_id}: unresolved aspect_id ${a}`);
    }
    // claim resolution (P0-3)
    for (const cs of s.proposed_semantic_labels.claim_stances || []) {
      if (!claimKeys.has(cs.claim_id)) violations.push(`${s.source_id}: unresolved claim_id ${cs.claim_id}`);
      if (!['for', 'against'].includes(cs.stance)) violations.push(`${s.source_id}: illegal stance ${cs.stance}`);
    }
    // expert evidence invariant (P0-2)
    const es = s.proposed_semantic_labels.expert_topic_match_status;
    const ev = s.proposed_semantic_labels.expertise_evidence;
    if (es === 'SUPPORTED' && (!ev || !ev.evidence || ev.evidence.length === 0)) violations.push(`${s.source_id}: SUPPORTED expert without evidence`);
    if (es === 'UNRESOLVED' && (!ev || ev.status !== 'UNRESOLVED')) violations.push(`${s.source_id}: UNRESOLVED without UNRESOLVED expertise_evidence`);
    if (es !== 'SUPPORTED' && es !== 'UNSUPPORTED' && es !== 'UNRESOLVED') violations.push(`${s.source_id}: illegal expert_topic_match_status ${es}`);
  }
  return violations;
}

test('P1: real adjudication packet V2.1 satisfies all invariants (FAIL CLOSED)', () => {
  const packet = buildRealPacket();
  const violations = collectViolations(packet);
  assert.deepEqual(violations, [], 'packet invariant violations: ' + JSON.stringify(violations));
  assert.ok(packet.source_count >= 70, 'expect ~75 real sources, got ' + packet.source_count);
});

test('P1: label_schema defines all 8 required labels', () => {
  const packet = buildRealPacket();
  const required = ['relevance', 'must_see', 'aspect_membership', 'expert_topic_match', 'long_tail_unique', 'claim_stance', 'historical_authority', 'evidence_quality'];
  for (const l of required) {
    assert.ok(packet.label_schema[l], 'missing label_schema.' + l);
    assert.ok(packet.label_schema[l].definition, 'missing definition for ' + l);
  }
});

test('P1: on-disk adjudication-packet-v2.1.json exists and matches built packet', () => {
  const file = path.join(ROOT, 'benchmark/results/adjudication-packet-v2.1.json');
  assert.ok(fs.existsSync(file), 'artifact file missing: ' + file);
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  const built = buildRealPacket();
  assert.equal(disk.schema, built.schema);
  assert.equal(disk.source_count, built.source_count);
  assert.deepEqual(collectViolations(disk), [], 'on-disk packet violates invariants');
});

test('P1: the 3 previously-missing sources now carry non-empty sanitized plain-text excerpts', () => {
  const packet = buildRealPacket();
  for (const sid of ['477427067:2179827948', '477427067:3136586716', '487214224:2027722356278215762']) {
    const e = packet.sources.find((s) => s.source_id === sid);
    assert.ok(e, 'missing ' + sid);
    assert.ok(e.content_excerpt && e.content_excerpt.length > 0, sid + ' excerpt still empty');
    assert.equal(e.content_excerpt_status, 'OK');
    assert.ok(!/<[a-z]+[ >]/.test(e.content_excerpt), sid + ' excerpt contains raw HTML tags');
  }
});

test('P1: NO_TEXT_CONTENT path is explicit (unit-level)', () => {
  // construct a minimal case whose source has zero text but image metadata
  const noTextSource = {
    source_id: 'Q1:n', question_id: 'Q1', answer_id: 'n', author: 'X', author_key: 'x',
    content_html: '<figure><img src="https://img.example.com/a.jpg" /></figure>',
    content_text: '', content_chars: 0, voteupCount: 0, commentCount: 0,
    createdTime: 1, updatedTime: 1,
    assets: { images: 1, links: 0, references: 0, codeBlocks: 0, videos: 0, domains: [] },
    evidence_markers: { has_code: false, has_external_links: false, has_references: false, has_images: true },
    pool_index: 0,
  };
  const pool = {
    candidate_pool_id: 't', questionIds: ['Q1'],
    questions: [{ qid: 'Q1', title: 't' }], sources: [noTextSource], verifiedSourceCount: 0,
    byId: new Map([[noTextSource.source_id, noTextSource]]),
  };
  const caseCfg = { case_id: 't', research_question: 'q', question_ids: ['Q1'], author_identity_confidence: 'WEAK' };
  const gold = { families: { relevance: { per_question: {} } } };
  const packet = buildAdjudicationPacketV21({ cases: [{ caseCfg, gold, pool }] });
  const e = packet.sources[0];
  assert.equal(e.content_excerpt_status, 'NO_TEXT_CONTENT');
  assert.equal(e.content_kind, 'image_only');
  assert.ok(e.content_metadata && e.content_metadata.images === 1);
  assert.deepEqual(collectViolations(packet), []);
});
