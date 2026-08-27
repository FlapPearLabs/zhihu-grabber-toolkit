// build-d2-gold.mjs — mechanically convert ChatGPT adjudication into D2 Gold.
// AUTHORITY: benchmark/adjudication/TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json
// (the ONLY semantic gold authority; adjudication JSON wins over D1 gold).
// Applies: case_schema_decisions (aspect/claim KEEP/DROP), case_label_decisions
// (per case_id × source_id final labels), required_provenance_final, global_rules
// (relevance gate; UNRESOLVED excluded num+den; historical_authority UNRESOLVED).
// Rebuilds value_units. Does NOT touch selectors/metrics/case.json/corpus.
// Synthetic cases are NOT adjudicated -> gold unchanged (FIXTURE_MECHANICAL).

import fs from 'node:fs';
import path from 'node:path';
import { loadCase } from '../lib/case-loader.mjs';
import { deriveValueUnits } from '../lib/value-units.mjs';

// deterministic fresh-window membership (same semantics as metrics.mjs)
function mechanicalFreshWindow(pool, caseCfg) {
  const win = caseCfg.freshness_window_policy;
  if (!win || win.reference_epoch_sec == null || win.window_sec == null) return [];
  const threshold = win.reference_epoch_sec - win.window_sec;
  return pool.sources.filter((s) => s.createdTime != null && s.createdTime >= threshold).map((s) => s.source_id);
}

const ROOT = path.resolve('.');
const ADJ = path.join(ROOT, 'benchmark/adjudication/TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json');
const CORPUS = path.join(ROOT, 'benchmark/corpus');
const CASES = path.join(ROOT, 'benchmark/cases');

const REAL_CASES = ['case-439521858', 'case-477427067', 'case-466695857', 'case-485463474', 'case-487214224', 'case-cross-lowcode'];

function qidOf(sid) { return sid.split(':')[0]; }

export function buildD2Gold({ adjudication, oldGold, caseCfg, pool, caseId }) {
  const schemaDec = (adjudication.case_schema_decisions || {})[caseId] || { aspects: {}, claims: {} };
  const labels = (adjudication.case_label_decisions || []).filter((d) => d.case_id === caseId);

  // ---- per-source final label maps (adjudication wins) ------------------------
  const relevanceTrue = new Set();
  const relevanceFalse = new Set();
  const relevanceUnresolved = new Set();
  const mustSee = new Set();
  const expertSupported = new Set();
  const expertUnresolved = new Set();
  const longTail = new Set();
  const evQuality = new Set();
  const evQualityUnresolved = new Set();
  const histAuthAll = new Set();
  const aspectSources = new Map(); // aspect key -> Set(sources)
  const claimStances = new Map();  // claim key -> {for:Set, against:Set}

  for (const d of labels) {
    const sid = d.source_id;
    const L = d.labels || {};
    const rel = L.relevance && L.relevance.value;
    if (rel === true) relevanceTrue.add(sid);
    else if (rel === false) relevanceFalse.add(sid);
    else relevanceUnresolved.add(sid);

    if (L.must_see && L.must_see.value === true) mustSee.add(sid);
    const exp = L.expert_topic_match_status && L.expert_topic_match_status.value;
    if (exp === 'SUPPORTED') expertSupported.add(sid);
    else if (exp === 'UNRESOLVED') expertUnresolved.add(sid);
    if (L.long_tail_unique && L.long_tail_unique.value === true) longTail.add(sid);
    const evq = L.evidence_quality && L.evidence_quality.value;
    if (evq === true) evQuality.add(sid);
    else if (evq === null || L.evidence_quality && L.evidence_quality.adjudication === 'UNRESOLVED') evQualityUnresolved.add(sid);
    // historical_authority: adjudicated UNRESOLVED for ALL real case labels
    if (sid) histAuthAll.add(sid);

    for (const a of (L.aspect_ids && L.aspect_ids.value) || []) {
      if (!aspectSources.has(a)) aspectSources.set(a, new Set());
      aspectSources.get(a).add(sid);
    }
    for (const st of (L.claim_stances && L.claim_stances.value) || []) {
      if (!claimStances.has(st.claim_id)) claimStances.set(st.claim_id, { for: new Set(), against: new Set() });
      if (st.stance === 'for') claimStances.get(st.claim_id).for.add(sid);
      else if (st.stance === 'against') claimStances.get(st.claim_id).against.add(sid);
    }
  }

  // ---- relevance gate: scored families only keep relevance==true sources -------
  const gate = (set) => [...set].filter((s) => relevanceTrue.has(s));

  // ---- aspects (P0 fix): authority = adjudication, NOT old D1 aspect objects ----
  // 1. FINAL KEEP aspect ids come directly from case_schema_decisions (keys are
  //    final, namespaced where the adjudicator namespaced them).
  // 2. membership aggregated from case_label_decisions.labels.aspect_ids.value.
  // 3. relevance gate applied.
  // 4. name/definition from the adjudication source packet (adjudication-packet-v2.2.json
  //    case dictionaries) via exact key match; alias fallback to D1 aspect name by
  //    bare-id suffix is NOT used as schema authority.
  const keepAspectKeys = Object.entries(schemaDec.aspects || {})
    .filter(([k, v]) => v === 'KEEP')
    .map(([k]) => k);
  const packetPath = path.join(ROOT, 'benchmark/results/adjudication-packet-v2.2.json');
  const packetMeta = new Map();
  if (fs.existsSync(packetPath)) {
    const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
    for (const c of packet.cases || []) for (const a of c.aspect_dictionary || []) packetMeta.set(a.aspect_id, a);
  }
  const oldAspectMeta = new Map((oldGold.families.aspect_membership && oldGold.families.aspect_membership.aspects || []).map((a) => [a.aspect_id, a]));
  const aspects = keepAspectKeys.map((key) => {
    const meta = packetMeta.get(key) || oldAspectMeta.get(key) || {};
    const members = [...(aspectSources.get(key) || [])].filter((s) => relevanceTrue.has(s));
    return {
      aspect_id: key,
      name: meta.name || key,
      definition: meta.definition || meta.name || key,
      primary_sources: members,
      sources: members,
      unresolved_sources: [],
      disputed_sources: [],
    };
  });

  // ---- contradiction claims: schema KEEP + final stances -----------------------
  const oldClusters = (oldGold.families.contradiction && oldGold.families.contradiction.claim_clusters) || [];
  const claimText = new Map(oldClusters.map((c) => [c.claim_id, c.canonical_claim]));
  const claimClusters = [];
  for (const [decKey, dec] of Object.entries(schemaDec.claims || {})) {
    if (dec.decision !== 'KEEP' && dec.decision !== 'KEEP_WITH_REVISED_PROVENANCE') continue;
    if (dec.mode === 'CROSS_QUESTION_PROVENANCE') continue; // handled below
    const key = decKey; // namespaced or bare claim key as in adjudication
    const st = claimStances.get(key) || { for: new Set(), against: new Set() };
    const forArr = [...st.for].filter((s) => relevanceTrue.has(s));
    const againstArr = [...st.against].filter((s) => relevanceTrue.has(s));
    if (forArr.length === 0 && againstArr.length === 0) continue; // no substantive stances after cleanup
    const baseId = key.includes(':') ? key.split(':').pop() : key;
    claimClusters.push({
      claim_id: key,
      canonical_claim: claimText.get(baseId) || claimText.get(key) || dec.note || key,
      stances: { for: forArr, against: againstArr },
      source_ids: [...new Set([...forArr, ...againstArr])],
      disputed: false,
      adjudication_note: dec.note || null,
    });
  }

  // ---- required provenance: required_provenance_final (D2 authority) -----------
  // Applies ONLY to its declared case (case-cross-lowcode); other cases get none.
  const rpfCase = adjudication.required_provenance_final || {};
  const rpfClaims = rpfCase.case_id === caseId ? (rpfCase.claims || []) : [];
  const oldRpg = (oldGold.families.required_provenance_groups && oldGold.families.required_provenance_groups.claim_groups) || [];
  const rpgText = new Map(oldRpg.map((g) => [g.claim_id, g.claim]));
  const claimGroups = rpfClaims.map((c) => ({
    claim_id: c.claim_id,
    claim: rpgText.get(c.claim_id) || c.claim_id,
    required_provenance_groups: (c.groups || []).map((g) => ({
      group: 'question',
      group_id: g.group_id,
      question_ids: g.question_ids || [],
      sources: g.sources || [],
    })),
    disputed: false,
  }));

  // ---- freshness: fresh window (mechanical) ∩ FINAL relevance ------------------
  const winMembers = mechanicalFreshWindow(pool, caseCfg);
  const freshRelevant = winMembers.filter((s) => relevanceTrue.has(s));

  // ---- historical_authority: ALL UNRESOLVED (adjudicated) ----------------------
  // unresolved stats record ONLY relevance=true sources (P1: relevance gate).
  const historicalAuthority = {
    label_status: 'UNRESOLVED',
    sources: [],
    unresolved_sources: [...relevanceTrue],
    disputed_sources: [],
    note: 'adjudicated UNRESOLVED for all real case labels (packet omits timestamp/age evidence for long-established status); excluded from numerator and denominator; unresolved stats are relevance-gated',
  };

  // ---- assemble D2 gold --------------------------------------------------------
  const families = {
    relevance: {
      label_status: 'HUMAN_ADJUDICATED',
      sources: [...relevanceTrue],
      unresolved_sources: [...relevanceUnresolved],
      disputed_sources: [],
      per_question: Object.fromEntries(
        [...new Set([...relevanceTrue].map(qidOf))].map((q) => [q, [...relevanceTrue].filter((s) => qidOf(s) === q)]),
      ),
      adjudication: 'CONFIRMED',
    },
    must_see: { label_status: 'HUMAN_ADJUDICATED', sources: gate(mustSee), unresolved_sources: [], disputed_sources: [], note: 'relevance-gated; adjudicated' },
    aspect_membership: { label_status: 'HUMAN_ADJUDICATED', aspects },
    expertise_topic_match: {
      label_status: 'HUMAN_ADJUDICATED',
      sources: gate(expertSupported),
      unresolved_sources: gate(expertUnresolved),
      disputed_sources: [],
      note: 'relevance-gated SUPPORTED = scorable; UNRESOLVED excluded from numerator/denominator; FINAL semantics belong to ChatGPT adjudication',
    },
    evidence_quality: {
      label_status: 'HUMAN_ADJUDICATED',
      sources: gate(evQuality),
      unresolved_sources: gate(evQualityUnresolved),
      disputed_sources: [],
      note: 'relevance-gated; UNRESOLVED excluded; FINAL only per adjudication',
    },
    evidence_presence: { label_status: 'MECHANICAL_CONFIRMED', note: 'computed by harness from frozen corpus evidence markers' },
    freshness: {
      label_status: 'MECHANICAL_WINDOW_AND_FINAL_RELEVANCE',
      fresh_relevant_sources: freshRelevant,
      unresolved_sources: [],
      disputed_sources: [],
      window: caseCfg.freshness_window_policy,
      note: 'fresh window membership (mechanical) ∩ FINAL relevance (adjudicated); off-topic fresh source never FINAL fresh relevant',
    },
    unique_long_tail_contribution: { label_status: 'HUMAN_ADJUDICATED', sources: gate(longTail), unresolved_sources: [], disputed_sources: [], note: 'relevance-gated; adjudicated' },
    contradiction: { label_status: 'HUMAN_ADJUDICATED', claim_clusters: claimClusters, note: 'schema KEEP only; stances from ChatGPT final claim_stances; no provenance-derived stances' },
    required_provenance_groups: { label_status: 'HUMAN_ADJUDICATED', claim_groups: claimGroups, note: 'required_provenance_final is D2 authority' },
    historical_authority: historicalAuthority,
  };

  return {
    case_id: caseId,
    gold_version: 'g2-chatgpt-adjudicated',
    label_status_policy: {
      semantic: 'HUMAN_ADJUDICATED',
      mechanical: 'MECHANICAL_CONFIRMED',
      unresolved: 'EXCLUDED_FROM_NUMERATOR_AND_DENOMINATOR',
      note: 'ChatGPT source-level adjudication is the FINAL semantic gold for real cases; D1 provisional labels superseded',
    },
    families,
    provenance: {
      proposed_by: 'ChatGPT',
      proposed_method: 'independent source-level adjudication of adjudication-packet-v2.2',
      adjudicated_by: 'ChatGPT',
      adjudication_status: 'COMPLETE',
      label_status: 'HUMAN_ADJUDICATED',
      source_file: 'TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json',
      d1_status: 'SUPERSEDED',
    },
  };
}

// -----------------------------------------------------------------------------
function main() {
  const adjudication = JSON.parse(fs.readFileSync(ADJ, 'utf8'));
  // mechanical validation of required top-level fields
  for (const f of ['case_schema_decisions', 'case_label_decisions', 'required_provenance_final', 'global_rules', 'd2_instruction']) {
    if (adjudication[f] === undefined) throw new Error('ADJUDICATION_MISSING_FIELD: ' + f);
  }
  for (const caseId of REAL_CASES) {
    const loaded = loadCase({ corpusDir: CORPUS, casesDir: CASES, caseId });
    const d2 = buildD2Gold({ adjudication, oldGold: loaded.gold, caseCfg: loaded.caseCfg, pool: loaded.pool, caseId });

    // backup D1 gold (historical), backup D1 value-units (derived from D1 gold,
    // NOT copied from the current file which may already be D2), write D2 gold,
    // rebuild value_units
    const goldFile = path.join(CASES, caseId, 'gold.json');
    const d1File = path.join(CASES, caseId, 'gold.d1.json');
    if (!fs.existsSync(d1File)) fs.copyFileSync(goldFile, d1File);
    const unitsFile = path.join(CASES, caseId, 'value-units.json');
    const d1UnitsFile = path.join(CASES, caseId, 'value-units.d1.json');
    if (!fs.existsSync(d1UnitsFile)) {
      const d1Gold = JSON.parse(fs.readFileSync(d1File, 'utf8'));
      fs.writeFileSync(d1UnitsFile, JSON.stringify(deriveValueUnits(d1Gold), null, 2));
    }
    fs.writeFileSync(goldFile, JSON.stringify(d2, null, 2));

    const units = deriveValueUnits(d2);
    fs.writeFileSync(unitsFile, JSON.stringify(units, null, 2));

    console.log('D2_GOLD_OK', caseId, '| relevant=' + d2.families.relevance.sources.length, '| must_see=' + d2.families.must_see.sources.length, '| expert_scorable=' + d2.families.expertise_topic_match.sources.length, '| expert_unresolved=' + d2.families.expertise_topic_match.unresolved_sources.length, '| long_tail=' + d2.families.unique_long_tail_contribution.sources.length, '| evq=' + d2.families.evidence_quality.sources.length, '| clusters=' + d2.families.contradiction.claim_clusters.length, '| xq_groups=' + d2.families.required_provenance_groups.claim_groups.length);
  }
  console.log('D2_GOLD_BUILD_COMPLETE');
}

// allow import for tests
if (process.argv[1] && process.argv[1].endsWith('build-d2-gold.mjs')) main();
