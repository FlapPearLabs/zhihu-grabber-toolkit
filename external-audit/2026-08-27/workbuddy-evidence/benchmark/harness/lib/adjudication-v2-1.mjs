// adjudication-v2-1.mjs — P0-1/2/3 + OPTIONAL QUALITY for the source-level
// adjudication packet (V2.1). Fixes over V2:
//   P0-1  every source entry complete: content_excerpt (sanitized PLAIN TEXT,
//         not raw HTML) non-empty OR explicit content_excerpt_status =
//         NO_TEXT_CONTENT with content_kind + content_metadata. Never silent.
//   P0-2  expertise_evidence = { status, evidence[] } with real evidence types
//         (verified_credential | employment | profile | historical_topic_content
//         | self_identified_vendor | other). Name-only -> UNRESOLVED, never
//         treated as false.
//   P0-3  packet self-contained: top-level label_schema; per-case
//         aspect_dictionary / claim_dictionary; every source.aspect_ids and
//         claim_stances.claim_id resolves (cross-case id collisions are
//         namespaced as "<case_id>:<id>").
//   OPT   adjudication_evidence[] = label-specific short evidence for
//         must_see / evidence_quality / long_tail_unique / historical_authority.
// Popularity fields (voteupCount/commentCount) remain OUT of the adjudication
// view (separate mechanical metadata file).

import { stripHtml } from './embeddings.mjs';

const EXCERPT_CHARS = 300;
const CLUSTER_EXCERPT_CHARS = 120;
const EVIDENCE_SNIPPET_CHARS = 120;

const VENDOR_HINTS = ['简道云', '葡萄城', '得帆', '汉得', 'zoho', '易搭', '星云', '百数', '枚达', '蓝库', '云程', '天翎', '引迈', 'helms', 'jvs', '氚云', '全管软件', '飞搭', '低代码helms', '低代码bi'];

// sanitized plain text (strip HTML tags/entities, collapse whitespace)
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

function includesAny(haystackArr, needles) { return needles.some((n) => haystackArr.includes(n)); }

export function buildAdjudicationPacketV21({ cases }) {
  const labelSchema = {
    relevance: {
      definition: 'source answers or materially informs the research question',
      allowed_values: ['true', 'false'], scorable_rule: 'excluded from numerator and denominator if unresolved/disputed',
    },
    must_see: {
      definition: 'answer that any credible synthesis of this research question must reference',
      allowed_values: ['true', 'false'], scorable_rule: 'excluded if unresolved/disputed',
    },
    aspect_membership: {
      definition: 'source belongs to one or more research aspects (see per-case aspect_dictionary)',
      allowed_values: ['<aspect_id> ...'], scorable_rule: 'aspect-level recall uses primary supporting sources',
    },
    expert_topic_match: {
      definition: 'author has topic-conditioned expertise (NOT global authority)',
      allowed_values: ['SUPPORTED', 'UNSUPPORTED', 'UNRESOLVED'],
      scorable_rule: 'SUPPORTED = scorable; UNRESOLVED/UNKNOWN = excluded from numerator and denominator, reported separately; never treat NO EVIDENCE as false',
    },
    long_tail_unique: {
      definition: 'zero/low-vote source carrying a unique contribution not otherwise covered',
      allowed_values: ['true', 'false'], scorable_rule: 'excluded if unresolved/disputed',
    },
    claim_stance: {
      definition: 'source takes for/against stance on a claim (see per-case claim_dictionary)',
      allowed_values: ['for', 'against'], scorable_rule: 'claim-level recall requires claim_id + stance resolution',
    },
    historical_authority: {
      definition: 'long-established, high-value anchor answer',
      allowed_values: ['true', 'false'], scorable_rule: 'excluded if unresolved/disputed',
    },
    evidence_quality: {
      definition: 'SEMANTIC quality of supporting evidence (separate from mechanical evidence PRESENCE)',
      allowed_values: ['true', 'false'],
      scorable_rule: 'FINAL only after adjudication; evidence presence markers are mechanical and reported separately',
    },
  };

  // ---- global registries for self-containment (cross-case id collision) ------
  const aspectRegistry = new Map(); // finalKey -> {case_id, aspect_id, name, definition}
  const claimRegistry = new Map();  // finalKey -> {case_id, claim_id, canonical_claim, allowed_stances}
  const caseDicts = [];

  for (const { caseCfg, gold } of cases) {
    const fam = gold.families || {};
    const aspectDict = [];
    for (const a of ((fam.aspect_membership || {}).aspects || [])) {
      let key = a.aspect_id;
      const clash = [...aspectRegistry.keys()].find((k) => k === a.aspect_id && aspectRegistry.get(k).case_id !== caseCfg.case_id);
      if (clash) key = `${caseCfg.case_id}:${a.aspect_id}`;
      if (!aspectRegistry.has(key)) aspectRegistry.set(key, { case_id: caseCfg.case_id, aspect_id: a.aspect_id, name: a.name, definition: a.definition || a.name });
      aspectDict.push({ aspect_id: key, name: a.name, definition: a.definition || a.name, case_id: caseCfg.case_id });
    }
    const claimDict = [];
    const clusters = [...((fam.contradiction || {}).claim_clusters || []), ...((fam.required_provenance_groups || {}).claim_groups || [])];
    for (const c of clusters) {
      const cid = c.claim_id;
      let key = cid;
      const clash = [...claimRegistry.keys()].find((k) => k === cid && claimRegistry.get(k).case_id !== caseCfg.case_id);
      if (clash) key = `${caseCfg.case_id}:${cid}`;
      if (!claimRegistry.has(key)) claimRegistry.set(key, { case_id: caseCfg.case_id, claim_id: cid, canonical_claim: c.canonical_claim || c.claim, allowed_stances: ['for', 'against'] });
      claimDict.push({ claim_id: key, canonical_claim: c.canonical_claim || c.claim, allowed_stances: ['for', 'against'], case_id: caseCfg.case_id });
    }
    caseDicts.push({
      case_id: caseCfg.case_id,
      research_question: caseCfg.research_question,
      question_ids: caseCfg.question_ids,
      aspect_dictionary: aspectDict,
      claim_dictionary: claimDict,
    });
  }

  // ---- label lookups ----------------------------------------------------------
  const mustSee = new Map();
  const relevant = new Map();
  const expert = new Map();
  const longTail = new Map();
  const histAuth = new Map();
  const evQual = new Map();
  const aspectOf = new Map(); // source_id -> [resolved aspect keys]
  const claimOf = new Map();  // source_id -> [{claim_key, stance}]
  const authorQuestionCount = new Map(); // author_key -> Set(question_ids)

  for (const { caseCfg, gold, pool } of cases) {
    const fam = gold.families || {};
    const qidSet = new Set(caseCfg.question_ids);
    for (const s of pool.sources) {
      if (!authorQuestionCount.has(s.author_key)) authorQuestionCount.set(s.author_key, new Set());
      authorQuestionCount.get(s.author_key).add(s.question_id);
    }
    const put = (map, sid, val) => map.set(sid, (map.get(sid) || false) || val);
    for (const sid of (fam.must_see || {}).sources || []) put(mustSee, sid, true);
    if (fam.relevance && fam.relevance.per_question) {
      for (const arr of Object.values(fam.relevance.per_question)) for (const s of arr) put(relevant, s, true);
    } else {
      for (const s of (fam.relevance || {}).sources || []) put(relevant, s, true);
    }
    for (const sid of (fam.expertise_topic_match || {}).sources || []) put(expert, sid, true);
    for (const sid of (fam.unique_long_tail_contribution || {}).sources || []) put(longTail, sid, true);
    for (const sid of (fam.historical_authority || {}).sources || []) put(histAuth, sid, true);
    for (const sid of (fam.evidence_quality || {}).sources || []) put(evQual, sid, true);

    for (const a of ((fam.aspect_membership || {}).aspects || [])) {
      let key = a.aspect_id;
      if (aspectRegistry.get(key) && aspectRegistry.get(key).case_id !== caseCfg.case_id) key = `${caseCfg.case_id}:${a.aspect_id}`;
      for (const s of (a.primary_sources || a.sources || [])) {
        if (!aspectOf.has(s)) aspectOf.set(s, []);
        if (!aspectOf.get(s).includes(key)) aspectOf.get(s).push(key);
      }
    }
    for (const c of ((fam.contradiction || {}).claim_clusters || [])) {
      let key = c.claim_id;
      if (claimRegistry.get(key) && claimRegistry.get(key).case_id !== caseCfg.case_id) key = `${caseCfg.case_id}:${c.claim_id}`;
      for (const [stance, sids] of Object.entries(c.stances || {})) {
        for (const s of sids || []) {
          if (!claimOf.has(s)) claimOf.set(s, []);
          claimOf.get(s).push({ claim_key: key, stance });
        }
      }
    }
    for (const c of ((fam.required_provenance_groups || {}).claim_groups || [])) {
      let key = c.claim_id;
      if (claimRegistry.get(key) && claimRegistry.get(key).case_id !== caseCfg.case_id) key = `${caseCfg.case_id}:${c.claim_id}`;
      for (const grp of (c.required_provenance_groups || [])) {
        for (const s of (grp.sources || [])) {
          if (!claimOf.has(s)) claimOf.set(s, []);
          claimOf.get(s).push({ claim_key: key, stance: 'for' });
        }
      }
    }
    void qidSet;
  }

  // ---- source entries ---------------------------------------------------------
  const sourcesById = new Map();
  for (const { caseCfg, pool } of cases) {
    for (const s of pool.sources) {
      if (sourcesById.has(s.source_id)) continue;
      const plain = plainText(s.content_html || s.content_text);
      const chars = s.content_text ? s.content_text.length : plain.length;
      const images = (s.assets && s.assets.images) || 0;
      const links = (s.assets && s.assets.links) || 0;
      const domains = (s.assets && s.assets.domains) || [];
      let excerpt = plain.slice(0, EXCERPT_CHARS);
      let status = 'OK';
      if (excerpt.length === 0 && chars === 0) status = 'NO_TEXT_CONTENT';
      const kind = contentKind(chars, images, links);

      // P0-2 real expertise evidence
      const expertStatus = expert.get(s.source_id)
        ? deriveExpertiseEvidence(s, authorQuestionCount)
        : { status: 'UNRESOLVED', evidence: [] };
      // if gold proposed expert but we have no evidence -> must stay UNRESOLVED (not false)
      const expertTopicMatchStatus = expertStatus.status;

      const entry = {
        source_id: s.source_id,
        question_id: s.question_id,
        question_title: (pool.questions.find((q) => q.qid === s.question_id) || {}).title || s.question_id,
        content_kind: kind,
        content_excerpt: excerpt,
        content_excerpt_status: status,
        content_metadata: { content_chars: chars, images, links, domains, references: (s.assets && s.assets.references) || 0, codeBlocks: (s.assets && s.assets.codeBlocks) || 0 },
        author_display: s.author,
        author_identity_confidence: caseCfg.author_identity_confidence || 'WEAK',
        proposed_semantic_labels: {
          relevance: relevant.has(s.source_id) || false,
          must_see: mustSee.get(s.source_id) || false,
          aspect_ids: aspectOf.get(s.source_id) || [],
          expert_topic_match_status: expertTopicMatchStatus,
          expertise_evidence: expertStatus,
          long_tail_unique: longTail.get(s.source_id) || false,
          claim_stances: [],
          historical_authority: histAuth.get(s.source_id) || false,
          evidence_quality: evQual.get(s.source_id) || false,
        },
        adjudication_evidence: [],
      };

      // claim stances (dedup)
      const have = new Set();
      for (const st of claimOf.get(s.source_id) || []) {
        const k = st.claim_key + ':' + st.stance;
        if (have.has(k)) continue;
        have.add(k);
        entry.proposed_semantic_labels.claim_stances.push({ claim_id: st.claim_key, stance: st.stance, relevant_excerpt: plain.slice(0, CLUSTER_EXCERPT_CHARS) });
      }

      // OPTIONAL QUALITY: label-specific short evidence
      const labelSnippets = [];
      if (entry.proposed_semantic_labels.must_see) labelSnippets.push({ label_type: 'must_see', evidence: [{ type: 'content_snippet', text: midSnippet(s.content_html || s.content_text) }] });
      if (entry.proposed_semantic_labels.evidence_quality) {
        const marks = [];
        if (domains.length) marks.push({ type: 'evidence_marks', text: 'external links: ' + domains.slice(0, 4).join(', ') });
        if ((s.assets && s.assets.codeBlocks) > 0) marks.push({ type: 'evidence_marks', text: 'code blocks: ' + s.assets.codeBlocks });
        if ((s.assets && s.assets.references) > 0) marks.push({ type: 'evidence_marks', text: 'references: ' + s.assets.references });
        marks.push({ type: 'content_snippet', text: midSnippet(s.content_html || s.content_text) });
        labelSnippets.push({ label_type: 'evidence_quality', evidence: marks });
      }
      if (entry.proposed_semantic_labels.long_tail_unique) labelSnippets.push({ label_type: 'long_tail_unique', evidence: [{ type: 'content_snippet', text: midSnippet(s.content_html || s.content_text) }] });
      if (entry.proposed_semantic_labels.historical_authority) labelSnippets.push({ label_type: 'historical_authority', evidence: [{ type: 'content_snippet', text: midSnippet(s.content_html || s.content_text) }] });
      entry.adjudication_evidence = labelSnippets;

      sourcesById.set(s.source_id, entry);
    }
  }

  // ---- cross-question provenance (explicit source_ids) -----------------------
  const crossProvenance = [];
  for (const { caseCfg, gold, pool } of cases) {
    const fam = gold.families || {};
    for (const g of ((fam.required_provenance_groups || {}).claim_groups || [])) {
      let key = g.claim_id;
      if (claimRegistry.get(key) && claimRegistry.get(key).case_id !== caseCfg.case_id) key = `${caseCfg.case_id}:${g.claim_id}`;
      crossProvenance.push({
        claim_id: key,
        claim: g.claim || g.canonical_claim,
        required_provenance_groups: (g.required_provenance_groups || []).map((grp) => ({
          group: grp.group,
          question_ids: grp.question_ids || [],
          sources: (grp.sources || []).map((sid) => {
            const s = pool.byId.get(sid);
            return { source_id: sid, author_display: s ? s.author : null, content_excerpt: s ? plainText(s.content_html || s.content_text, CLUSTER_EXCERPT_CHARS) : null };
          }),
        })),
      });
    }
  }

  return {
    schema: 'zhihu-research-benchmark/adjudication-packet-v2.1',
    schema_version: '2.1.0',
    generated_at: new Date().toISOString(),
    purpose: 'source-level semantic gold adjudication for ChatGPT/human (self-contained: label schema + per-case dictionaries included). Proposed labels are PROVISIONAL. Popularity fields intentionally omitted; see separate mechanical metadata.',
    label_schema: labelSchema,
    cases: caseDicts,
    source_count: sourcesById.size,
    sources: [...sourcesById.values()],
    cross_question_provenance: crossProvenance,
    mechanical_metadata_ref: 'adjudication-mechanical-metadata.json',
  };
}

function deriveExpertiseEvidence(s, authorQuestionCount) {
  const evidence = [];
  const ak = String(s.author || '').toLowerCase();
  const isVendorName = VENDOR_HINTS.some((h) => ak.includes(h.toLowerCase()));
  if (isVendorName) {
    evidence.push({ type: 'self_identified_vendor', text: `author display name "${s.author}" matches a known low-code vendor account; content promotes its own platform` });
  }
  const qCount = authorQuestionCount.get(s.author_key);
  if (qCount && qCount.size >= 3) {
    evidence.push({ type: 'historical_topic_content', text: `author appears across ${qCount.size} questions in the frozen low-code corpus (${[...qCount].slice(0, 5).join(', ')})` });
  }
  if (evidence.length === 0) {
    return { status: 'UNRESOLVED', evidence: [], note: 'name-only identity; no confirmable expertise evidence in canonical corpus; excluded from expert numerator/denominator until adjudicated' };
  }
  return { status: 'SUPPORTED', evidence };
}
