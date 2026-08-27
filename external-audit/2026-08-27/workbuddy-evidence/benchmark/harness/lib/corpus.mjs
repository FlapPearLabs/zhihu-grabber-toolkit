// Corpus loader — reads the frozen corpus snapshot, verifies SHA-256 against
// the manifest, and normalizes every answer into a benchmark source record.
// Read-only: never mutates the corpus.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stripHtml, normalizeText } from './embeddings.mjs';
import { normalizeAuthorKey } from './author-key.mjs';

const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function loadManifest(corpusDir) {
  const p = path.join(corpusDir, 'manifest.json');
  if (!fs.existsSync(p)) throw new Error('CORPUS_MANIFEST_MISSING: ' + p);
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(m.entries)) throw new Error('CORPUS_MANIFEST_INVALID');
  return m;
}

export function loadQuestion(corpusDir, qid) {
  const manifest = loadManifest(corpusDir);
  const entry = manifest.entries.find((e) => e.qid === qid);
  if (!entry) throw new Error('QUESTION_NOT_IN_MANIFEST: ' + qid);
  const file = path.join(corpusDir, qid, 'answers.json');
  if (!fs.existsSync(file)) throw new Error('CORPUS_FILE_MISSING: ' + file);
  const raw = fs.readFileSync(file);
  const got = sha256hex(raw);
  if (got !== entry.sha256) throw new Error(`CORPUS_INTEGRITY_FAIL qid=${qid} expected=${entry.sha256.slice(0, 12)} got=${got.slice(0, 12)}`);
  const j = JSON.parse(raw.toString('utf8'));
  return normalizeQuestion(j, entry);
}

export function normalizeQuestion(j, entry) {
  const qid = String(j.questionId);
  const answers = Array.isArray(j.answers) ? j.answers : [];
  const sources = answers.map((a, i) => normalizeSource(a, qid, i, j));
  return {
    qid,
    title: j.questionTitle || '',
    description: (j.question && (j.question.descriptionMarkdown || j.question.descriptionHtml)) || '',
    topics: (j.question && j.question.topics) ? j.question.topics.map((t) => t.name) : [],
    answerCount: j.answerCount ?? answers.length,
    fetchedAt: j.fetchedAt || null,
    url: j.url || null,
    verified: entry.handoffVerified === true,
    capturedCount: answers.length,
    sources,
  };
}

function normalizeSource(a, qid, idx, question) {
  const content = String(a.content || '');
  const text = normalizeText(content);
  const assets = a.assets || {};
  const domains = Array.from(
    new Set((assets.links || []).map((l) => l.domain).filter(Boolean)),
  );
  return {
    source_id: `${qid}:${a.id}`,
    question_id: qid,
    answer_id: String(a.id),
    author: a.author != null ? String(a.author) : '(anonymous)',
    author_key: normalizeAuthorKey(a.author),
    url: a.url || null,
    content_html: content,
    content_text: text,
    content_chars: text.length,
    voteupCount: Number(a.voteupCount ?? 0),
    commentCount: Number(a.commentCount ?? 0),
    createdTime: a.createdTime != null ? Number(a.createdTime) : null,
    updatedTime: a.updatedTime != null ? Number(a.updatedTime) : null,
    assets: {
      images: (assets.images || []).length,
      links: (assets.links || []).length,
      references: (assets.references || []).length,
      codeBlocks: (assets.codeBlocks || []).length,
      videos: (assets.videos || []).length,
      domains,
    },
    evidence_markers: {
      has_code: (assets.codeBlocks || []).length > 0,
      has_external_links: (assets.links || []).length > 0,
      has_references: (assets.references || []).length > 0,
      has_images: (assets.images || []).length > 0,
    },
    pool_index: idx,
    // canonical raw content must stay authoritative; we keep a pointer only
    _canonical_question: question.questionTitle || null,
  };
}

export function buildPool(corpusDir, questionIds) {
  const questions = questionIds.map((qid) => loadQuestion(corpusDir, qid));
  const sources = questions.flatMap((q) => q.sources);
  const verifiedCount = questions.filter((q) => q.verified).length;
  return {
    candidate_pool_id: `pool-${questionIds.join('+')}`,
    questionIds,
    questions,
    sources,
    verifiedQuestionCount: verifiedCount,
    verifiedSourceCount: sources.filter((s) => questions.find((q) => q.qid === s.question_id).verified).length,
    byId: new Map(sources.map((s) => [s.source_id, s])),
  };
}
