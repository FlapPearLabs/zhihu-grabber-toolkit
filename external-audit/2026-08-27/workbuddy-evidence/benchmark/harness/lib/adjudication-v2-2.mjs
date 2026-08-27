// adjudication-v2-2.mjs — FINAL adjudication data model.
// Fixes over V2.1 (which is PASS on content/schema/excerpt/dictionary):
//   P0-1  TWO-LAYER structure: sources[] = intrinsic source info only;
//         case_labels[] = { case_id, source_id, proposed_semantic_labels,
//         adjudication_evidence[] }. Same source may appear in multiple
//         case_labels with INDEPENDENT labels (no cross-case OR/merge).
//   P0-2  required_provenance_memberships[] is SEPARATE from claim_stances[].
//         Provenance membership never fabricates a stance. claim_stances[]
//         comes only from explicit contradiction-cluster stance source lists.
//   P1    expertise evidence discovery runs for EVERY distinct source/author
//         from the frozen corpus — it does NOT read provisional expert gold to
//         decide whether to look for evidence. Discovery != FINAL label.
// Preserved from V2.1 (do not regress): label_schema, per-case aspect/claim
// dictionaries with namespaced cross-case ids, sanitized plain-text excerpts,
// content_excerpt_status + content_kind + content_metadata, popularity hiding,
// cross-question provenance detail.

import { stripHtml } from './embeddings.mjs';

const EXCERPT_CHARS = 300;
const CLUSTER_EXCERPT_CHARS = 120;
const EVIDENCE_SNIPPET_CHARS = 120;

const VENDOR_HINTS = ['简道云', '葡萄城', '得帆', '汉得', 'zoho', '易搭', '星云', '百数', '枚达', '蓝库', '云程', '天翎', '引迈', 'helms', 'jvs', '氚云', '全管软件', '飞搭'];

const LABEL_SCHEMA = {
  relevance: {
    definition: 'source answers or materially informs the research question (case-scoped)',
    allowed_values: ['true', 'false'], scorable_rule: 'excluded from numerator and denominator if unresolved/disputed',
  },
  must_see: {
    definition: 'answer that any credible synthesis of THIS case research question must reference (case-scoped; no cross-case propagation)',
    allowed_values: ['true', 'false'], scorable_rule: 'excluded if unresolved/disputed',
  },
  aspect_membership: {
    definition: 'source belongs to one or more research aspects of THIS case (see per-case aspect_dictionary)',
    allowed_values: ['<aspect_id> ...'], scorable_rule: 'aspect-level recall uses primary supporting sources',
  },
  expert_topic_match: {
    definition: 'author has topic-conditioned expertise (NOT global authority). Status is EVIDENCE-DRIVEN via frozen-corpus discovery, independent of provisional gold; provisional gold proposal reported separately',
    allowed_values: ['SUPPORTED', 'UNSUPPORTED', 'UNRESOLVED'],
    scorable_rule: 'SUPPORTED = scorable; UNRESOLVED/UNKNOWN = excluded from numerator and denominator, reported separately; never treat NO EVIDENCE as false; FINAL label only by human adjudication',
  },
  long_tail_unique: {
    definition: 'zero/low-vote source carrying a unique contribution not otherwise covered (case-scoped)',
    allowed_values: ['true', 'false'], scorable_rule: 'excluded if unresolved/disputed',
  },
  claim_stance: {
    definition: 'source takes for/against stance on a claim (ONLY from explicit contradiction-cluster stance lists or human adjudication; provenance membership never creates a stance)',
    allowed_values: ['for', 'against'], scorable_rule: 'claim-level recall requires claim_id + stance resolution',
  },
  historical_authority: {
    definition: 'long-established, high-value anchor answer (case-scoped)',
    allowed_values: ['true', 'false'], scorable_rule: 'excluded if unresolved/disputed',
  },
  evidence_quality: {
    definition: 'SEMANTIC quality of supporting evidence (separate from mechanical evidence PRESENCE; case-scoped)',
    allowed_values: ['true', 'false'],
    scorable_rule: 'FINAL only after adjudication; evidence presence markers are mechanical and reported separately',
  },
  required_provenance_membership: {
    definition: 'source is a member of a required provenance group for a cross-question claim (group_role comes ONLY from frozen gold definition; membership is NOT a stance)',
    allowed_values: ['REQUIRED_SOURCE_GROUP', 'SUPPORT', 'OPPOSITION', 'CONTEXT'],
    scorable_rule: 'cross-question claim coverage requires every required provenance group to have >=1 selected source; membership != claim_stance',
  },
};

function plainText(text, n = Infinity) {
  const t = stripHtml(String(text || '')).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}

function midSnippet(text, n = EVIDENCE_SNIPPET_CHARS) {
  const t = plainText(text);
  if (t.length <= n) return t;
  const start = Math.min(Math.floor(t.length / 3), Math.max(0, t.length - n));
  return t.slice(start, start + n) + '…';
}

function contentKind(textChars, images, links) {
  if (textChars === 0 && images > 0 && links === 0) return 'image_only';
  if (textChars === 0 && links > 0) return 'link_card';
  if (textChars === 0) return 'no_text';
  return 'text';
}

// ---- gold-INDEPENDENT expertise evidence discovery (P1) ----------------------
// Runs for every distinct author from frozen-corpus facts only. Never consults
// provisional expert gold to decide whether to look for evidence.
function buildAuthorFacts(cases) {
  const facts = new Map(); // author_key -> { display: Set, question_ids: Set }
  for (const { pool } of cases) {
    for (const s of pool.sources) {
      if (!facts.has(s.author_key)) facts.set(s.author_key, { display: new Set(), question_ids: new Set() });
      const f = facts.get(s.author_key);
      f.display.add(s.author);
      f.question_ids.add(s.question_id);
    }
  }
  return facts;
}

function discoverExpertiseEvidence(source, authorFacts) {
  const evidence = [];
  const ak = String(source.author || '').toLowerCase();
  if (VENDOR_HINTS.some((h) => ak.includes(h.toLowerCase()))) {
    evidence.push({ type: 'self_identified_vendor', text: `author display name "${source.author}" matches a known low-code vendor account; content promotes its own platform` });
  }
  const f = authorFacts.get(source.author_key);
  if (f && f.question_ids.size >= 3) {
    evidence.push({ type: 'historical_topic_content', text: `author appears across ${f.question_ids.size} questions in the frozen low-code corpus (${[...f.question_ids].slice(0, 5).join(', ')})` });
  }
  if (evidence.length === 0) {
    return { status: 'UNRESOLVED', evidence: [], note: 'name-only identity; no confirmable expertise evidence in canonical corpus; excluded from expert numerator/denominator until adjudicated' };
  }
  return { status: 'SUPPORTED', evidence };
}

export function buildAdjudicationPacketV22({ cases }) {
  const authorFacts = buildAuthorFacts(cases);

  // ---- case-scoped dictionaries (namespaced on cross-case id collision) ------
  const caseDicts = [];
  const aspectKeysByCase = new Map(); // case_id -> Set(namespaced aspect keys)
  const claimKeysByCase = new Map();  // case_id -> Set(namespaced claim keys)
  const rawAspectOwner = new Map();   // raw aspect_id -> first claiming case_id
  const rawClaimOwner = new Map();    // raw claim_id -> first claiming case_id
  const aspectKeyOf = new Map();      // `${case_id}|${aspect_id}` -> namespaced key
  const claimKeyOf = new Map();       // `${case_id}|${claim_id}` -> namespaced key

  for (const { caseCfg, gold } of cases) {
    const fam = gold.families || {};
    const aspectDict = [];
    for (const a of ((fam.aspect_membership || {}).aspects || [])) {
      let key = a.aspect_id;
      const owner = rawAspectOwner.get(a.aspect_id);
      if (owner && owner !== caseCfg.case_id) key = `${caseCfg.case_id}:${a.aspect_id}`;
      rawAspectOwner.set(a.aspect_id, rawAspectOwner.get(a.aspect_id) || caseCfg.case_id);
      aspectKeyOf.set(`${caseCfg.case_id}|${a.aspect_id}`, key);
      aspectDict.push({ aspect_id: key, name: a.name, definition: a.definition || a.name, case_id: caseCfg.case_id });
      if (!aspectKeysByCase.has(caseCfg.case_id)) aspectKeysByCase.set(caseCfg.case_id, new Set());
      aspectKeysByCase.get(caseCfg.case_id).add(key);
    }
    const claimDict = [];
    const clusters = [...((fam.contradiction || {}).claim_clusters || []), ...((fam.required_provenance_groups || {}).claim_groups || [])];
    for (const c of clusters) {
      let key = c.claim_id;
      const owner = rawClaimOwner.get(c.claim_id);
      if (owner && owner !== caseCfg.case_id) key = `${caseCfg.case_id}:${c.claim_id}`;
      rawClaimOwner.set(c.claim_id, rawClaimOwner.get(c.claim_id) || caseCfg.case_id);
      claimKeyOf.set(`${caseCfg.case_id}|${c.claim_id}`, key);
      claimDict.push({ claim_id: key, canonical_claim: c.canonical_claim || c.claim, allowed_stances: ['for', 'against'], case_id: caseCfg.case_id });
      if (!claimKeysByCase.has(caseCfg.case_id)) claimKeysByCase.set(caseCfg.case_id, new Set());
      claimKeysByCase.get(caseCfg.case_id).add(key);
    }
    caseDicts.push({
      case_id: caseCfg.case_id,
      research_question: caseCfg.research_question,
      question_ids: caseCfg.question_ids,
      aspect_dictionary: aspectDict,
      claim_dictionary: claimDict,
    });
  }

  // ---- per-case label maps (NO cross-case merge) ------------------------------
  const caseLabels = [];
  const sourcesById = new Map(); // intrinsic-only source records
  const crossProvenance = [];
  const requiredMemberships = [];

  for (const { caseCfg, gold, pool } of cases) {
    const fam = gold.families || {};
    const cid = caseCfg.case_id;

    const relevant = new Set();
    if (fam.relevance && fam.relevance.per_question) {
      for (const arr of Object.values(fam.relevance.per_question)) for (const s of arr) relevant.add(s);
    } else {
      for (const s of (fam.relevance || {}).sources || []) relevant.add(s);
    }
    const mustSee = new Set((fam.must_see || {}).sources || []);
    const goldExpert = new Set((fam.expertise_topic_match || {}).sources || []);
    const longTail = new Set((fam.unique_long_tail_contribution || {}).sources || []);
    const histAuth = new Set((fam.historical_authority || {}).sources || []);
    const evQual = new Set((fam.evidence_quality || {}).sources || []);

    const aspectOf = new Map(); // source_id -> [namespaced aspect keys of THIS case]
    for (const a of ((fam.aspect_membership || {}).aspects || [])) {
      const key = aspectKeyOf.get(`${cid}|${a.aspect_id}`);
      for (const s of (a.primary_sources || a.sources || [])) {
        if (!aspectOf.has(s)) aspectOf.set(s, []);
        if (!aspectOf.get(s).includes(key)) aspectOf.get(s).push(key);
      }
    }

    // claim_stances: ONLY explicit contradiction-cluster stance lists (P0-2)
    const claimOf = new Map(); // source_id -> [{claim_key, stance}]
    for (const c of ((fam.contradiction || {}).claim_clusters || [])) {
      const key = claimKeyOf.get(`${cid}|${c.claim_id}`);
      for (const [stance, sids] of Object.entries(c.stances || {})) {
        for (const s of sids || []) {
          if (!claimOf.has(s)) claimOf.set(s, []);
          claimOf.get(s).push({ claim_key: key, stance });
        }
      }
    }

    // required provenance membership (P0-2): flat, no stance fabrication
    for (const g of ((fam.required_provenance_groups || {}).claim_groups || [])) {
      const claimKey = claimKeyOf.get(`${cid}|${g.claim_id}`);
      (g.required_provenance_groups || []).forEach((grp, gi) => {
        // group_role comes ONLY from frozen gold definition; no guessing.
        // Frozen gold defines these groups as required provenance groups.
        const role = grp.group_role || 'REQUIRED_SOURCE_GROUP';
        for (const sid of grp.sources || []) {
          requiredMemberships.push({
            case_id: cid,
            claim_id: claimKey,
            group_id: g.claim_id + ':group:' + gi,
            group_index: gi,
            group_role: role,
            question_ids: grp.question_ids || [],
            source_id: sid,
          });
        }
      });
      // cross-question provenance detail (V2.1 preserved)
      crossProvenance.push({
        claim_id: claimKey,
        claim: g.claim || g.canonical_claim,
        required_provenance_groups: (g.required_provenance_groups || []).map((grp, gi) => ({
          group: grp.group,
          group_id: g.claim_id + ':group:' + gi,
          group_role: grp.group_role || 'REQUIRED_SOURCE_GROUP',
          question_ids: grp.question_ids || [],
          sources: (grp.sources || []).map((sid) => {
            const s = pool.byId.get(sid);
            return { source_id: sid, author_display: s ? s.author : null, content_excerpt: s ? plainText(s.content_html || s.content_text, CLUSTER_EXCERPT_CHARS) : null };
          }),
        })),
      });
    }

    // ---- per-source case-scoped labels ----------------------------------------
    for (const s of pool.sources) {
      // intrinsic record (once per source)
      if (!sourcesById.has(s.source_id)) {
        const plain = plainText(s.content_html || s.content_text);
        const chars = s.content_text ? s.content_text.length : plain.length;
        const images = (s.assets && s.assets.images) || 0;
        const links = (s.assets && s.assets.links) || 0;
        const domains = (s.assets && s.assets.domains) || [];
        const excerpt = plain.slice(0, EXCERPT_CHARS);
        sourcesById.set(s.source_id, {
          source_id: s.source_id,
          question_id: s.question_id,
          question_title: (pool.questions.find((q) => q.qid === s.question_id) || {}).title || s.question_id,
          content_kind: contentKind(chars, images, links),
          content_excerpt: excerpt,
          content_excerpt_status: excerpt.length === 0 && chars === 0 ? 'NO_TEXT_CONTENT' : 'OK',
          content_metadata: { content_chars: chars, images, links, domains, references: (s.assets && s.assets.references) || 0, codeBlocks: (s.assets && s.assets.codeBlocks) || 0 },
          author_display: s.author,
          author_identity_confidence: caseCfg.author_identity_confidence || 'WEAK',
        });
      }

      // P1: gold-INDEPENDENT expertise discovery for EVERY source
      const discovery = discoverExpertiseEvidence(s, authorFacts);

      const labels = {
        relevance: relevant.has(s.source_id),
        must_see: mustSee.has(s.source_id),
        aspect_ids: aspectOf.get(s.source_id) || [],
        expert_topic_match_status: discovery.status,
        expertise_evidence: discovery,
        expert_topic_match_proposed_by_gold: goldExpert.has(s.source_id),
        long_tail_unique: longTail.has(s.source_id),
        claim_stances: [],
        historical_authority: histAuth.has(s.source_id),
        evidence_quality: evQual.has(s.source_id),
      };
      const have = new Set();
      for (const st of claimOf.get(s.source_id) || []) {
        const k = st.claim_key + ':' + st.stance;
        if (have.has(k)) continue;
        have.add(k);
        labels.claim_stances.push({ claim_id: st.claim_key, stance: st.stance, relevant_excerpt: plainText(s.content_html || s.content_text, CLUSTER_EXCERPT_CHARS) });
      }

      // label-specific short evidence (per case-scoped label values)
      const labelSnippets = [];
      if (labels.must_see) labelSnippets.push({ label_type: 'must_see', evidence: [{ type: 'content_snippet', text: midSnippet(s.content_html || s.content_text) }] });
      if (labels.evidence_quality) {
        const marks = [];
        const domains = (s.assets && s.assets.domains) || [];
        if (domains.length) marks.push({ type: 'evidence_marks', text: 'external links: ' + domains.slice(0, 4).join(', ') });
        if ((s.assets && s.assets.codeBlocks) > 0) marks.push({ type: 'evidence_marks', text: 'code blocks: ' + s.assets.codeBlocks });
        if ((s.assets && s.assets.references) > 0) marks.push({ type: 'evidence_marks', text: 'references: ' + s.assets.references });
        marks.push({ type: 'content_snippet', text: midSnippet(s.content_html || s.content_text) });
        labelSnippets.push({ label_type: 'evidence_quality', evidence: marks });
      }
      if (labels.long_tail_unique) labelSnippets.push({ label_type: 'long_tail_unique', evidence: [{ type: 'content_snippet', text: midSnippet(s.content_html || s.content_text) }] });
      if (labels.historical_authority) labelSnippets.push({ label_type: 'historical_authority', evidence: [{ type: 'content_snippet', text: midSnippet(s.content_html || s.content_text) }] });

      caseLabels.push({
        case_id: cid,
        source_id: s.source_id,
        proposed_semantic_labels: labels,
        adjudication_evidence: labelSnippets,
      });
    }
  }

  return {
    schema: 'zhihu-research-benchmark/adjudication-packet-v2.2',
    schema_version: '2.2.0',
    generated_at: new Date().toISOString(),
    purpose: 'source-level semantic gold adjudication for ChatGPT/human — FINAL data model. TWO-LAYER: sources[] = intrinsic only; case_labels[] = case-scoped semantic proposals (no cross-case OR/merge). Provenance membership is separate from claim stance. Expertise evidence is gold-independent. Popularity fields hidden.',
    label_schema: LABEL_SCHEMA,
    cases: caseDicts,
    source_count: sourcesById.size,
    case_label_count: caseLabels.length,
    sources: [...sourcesById.values()],
    case_labels: caseLabels,
    required_provenance_memberships: requiredMemberships,
    cross_question_provenance: crossProvenance,
    mechanical_metadata_ref: 'adjudication-mechanical-metadata.json',
  };
}
