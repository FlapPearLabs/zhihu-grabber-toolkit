// adjudication-v2.mjs — P0-7 source-level adjudication packet builder.
// For every REAL source: source_id, question_id, question_title, content_excerpt,
// author_display, author_identity_confidence + proposed semantic labels.
// Popularity fields (voteupCount/commentCount) are deliberately NOT in the
// adjudication view (they live in the separate mechanical metadata file).
// Cross-question provenance lists explicit source_ids (never "sources: 2").

const EXCERPT_CHARS = 300;
const CLUSTER_EXCERPT_CHARS = 120;

const VENDOR_HINTS = ['简道云', '葡萄城', '得帆', '汉得', 'zoho', '易搭', '星云', '百数', '枚达', '蓝库', '云程', '天翎', '引迈', 'helms', 'jvs', '氚云'];
const INDEPENDENT_HINTS = ['领悟杂谈', '人月聊IT', '元宇宙开发者', '徐翔轩', '表单大师', '效率工具指北'];

function expertiseEvidenceLabel(author, author_key) {
  const ak = String(author || '').toLowerCase();
  if (VENDOR_HINTS.some((h) => ak.includes(h.toLowerCase()))) return 'vendor_or_official_account';
  if (INDEPENDENT_HINTS.some((h) => ak.includes(h.toLowerCase()))) return 'practitioner_or_independent';
  return 'unknown_author_class';
}

function excerpt(text, n = EXCERPT_CHARS) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n) + '…';
}

function includesAny(set, arr) { return arr.some((s) => set.has(s)); }

export function buildAdjudicationPacketV2({ cases, corpusDir }) {
  const sourcesById = new Map();
  const crossClaims = [];

  for (const { caseCfg, gold, pool } of cases) {
    const fam = gold.families || {};
    const byId = pool.byId;
    const questionTitle = (qid) => (pool.questions.find((q) => q.qid === qid) || {}).title || qid;

    // label lookups
    const mustSee = new Set((fam.must_see || {}).sources || []);
    const relevant = new Set();
    if (fam.relevance && fam.relevance.per_question) {
      for (const arr of Object.values(fam.relevance.per_question)) for (const s of arr) relevant.add(s);
    } else {
      for (const s of (fam.relevance || {}).sources || []) relevant.add(s);
    }
    const expert = new Set((fam.expertise_topic_match || {}).sources || []);
    const longTail = new Set((fam.unique_long_tail_contribution || {}).sources || []);
    const histAuth = new Set((fam.historical_authority || {}).sources || []);
    const evQual = new Set((fam.evidence_quality || {}).sources || []);
    const aspectOf = new Map();
    for (const a of ((fam.aspect_membership || {}).aspects || [])) {
      for (const s of (a.primary_sources || a.sources || [])) {
        if (!aspectOf.has(s)) aspectOf.set(s, []);
        aspectOf.get(s).push(a.aspect_id);
      }
    }
    const claimOf = new Map(); // source_id -> [{claim_id, stance}]
    for (const c of ((fam.contradiction || {}).claim_clusters || [])) {
      for (const [stance, sids] of Object.entries(c.stances || {})) {
        for (const s of sids || []) {
          if (!claimOf.has(s)) claimOf.set(s, []);
          claimOf.get(s).push({ claim_id: c.claim_id, stance });
        }
      }
    }

    for (const s of pool.sources) {
      const existing = sourcesById.get(s.source_id);
      const entry = existing || {
        source_id: s.source_id,
        question_id: s.question_id,
        question_title: questionTitle(s.question_id),
        content_excerpt: excerpt(s.content_html || s.content_text),
        author_display: s.author,
        author_identity_confidence: caseCfg.author_identity_confidence || 'WEAK',
        proposed_semantic_labels: {
          relevance: relevant.has(s.source_id) ? true : (includesAny(new Set(relevant), [s.source_id]) ? true : false),
          must_see: mustSee.has(s.source_id),
          aspect_ids: aspectOf.get(s.source_id) || [],
          expert_topic_match: expert.has(s.source_id),
          expertise_evidence: expert.has(s.source_id) ? expertiseEvidenceLabel(s.author, s.author_key) : null,
          long_tail_unique: longTail.has(s.source_id),
          claim_stances: [],
          historical_authority: histAuth.has(s.source_id),
          evidence_quality: evQual.has(s.source_id),
        },
      };
      if (!existing) sourcesById.set(s.source_id, entry);
      // merge claim stances (dedupe by claim_id:stance)
      const stances = claimOf.get(s.source_id) || [];
      const have = new Set(entry.proposed_semantic_labels.claim_stances.map((c) => c.claim_id + ':' + c.stance));
      for (const st of stances) {
        if (!have.has(st.claim_id + ':' + st.stance)) {
          entry.proposed_semantic_labels.claim_stances.push({
            claim_id: st.claim_id,
            stance: st.stance,
            relevant_excerpt: excerpt(s.content_html || s.content_text, CLUSTER_EXCERPT_CHARS),
          });
          have.add(st.claim_id + ':' + st.stance);
        }
      }
    }

    // cross-question provenance with explicit source_ids
    if (fam.required_provenance_groups && fam.required_provenance_groups.claim_groups) {
      for (const g of fam.required_provenance_groups.claim_groups) {
        crossClaims.push({
          claim_id: g.claim_id,
          claim: g.claim,
          required_provenance_groups: (g.required_provenance_groups || []).map((grp) => ({
            group: grp.group,
            question_ids: grp.question_ids || [],
            sources: (grp.sources || []).map((sid) => {
              const s = byId.get(sid);
              return { source_id: sid, author_display: s ? s.author : null, content_excerpt: s ? excerpt(s.content_html || s.content_text, CLUSTER_EXCERPT_CHARS) : null };
            }),
          })),
        });
      }
    }
  }

  return {
    schema: 'zhihu-research-benchmark/adjudication-packet-v2',
    schema_version: '2.0.0',
    generated_at: new Date().toISOString(),
    purpose: 'source-level semantic gold adjudication for ChatGPT/human. Proposed labels are PROVISIONAL proposals; adjudicator confirms/revises/rejects. Popularity fields intentionally omitted to reduce popularity bias; see separate mechanical metadata.',
    source_count: sourcesById.size,
    sources: [...sourcesById.values()],
    cross_question_provenance: crossClaims,
    mechanical_metadata_ref: 'adjudication-mechanical-metadata.json',
  };
}
