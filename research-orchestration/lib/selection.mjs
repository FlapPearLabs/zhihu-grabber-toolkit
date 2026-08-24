/**
 * research-orchestration/lib/selection.mjs
 *
 * Candidate-selection policy (Approved R2 + R3, docs/specs/research-orchestration-scope.md §5.1).
 * Pure functions; no IO.
 *
 * Approved contract:
 * - CLEAR BEST MATCH → auto-select; decision visible/recordable; no forced confirmation.
 * - MATERIAL AMBIGUITY → structured clarification-required result; at most one user clarification.
 * - NO VALID CANDIDATE → fail/report; never invent or silently choose an unrelated question.
 *
 * Mechanism (implementation design, delegated):
 * deterministic lexical relevance over legitimate candidate metadata only
 * (questionId / title / answerCount from search); no fabricated facts.
 */

export const SELECT_VERDICT_AUTO = 'auto';
export const SELECT_VERDICT_AMBIGUOUS = 'ambiguous';
export const SELECT_VERDICT_NONE = 'none';

/**
 * Deterministic relevance scoring constants.
 * - MIN_ABS_SCORE: minimum score for a candidate to be considered relevant (else NO VALID).
 * - AMBIGUITY_MARGIN: if best and second-best both ≥ MIN_ABS_SCORE and differ by less
 *   than this margin, treat as MATERIAL AMBIGUITY.
 */
export const MIN_ABS_SCORE = 2;
export const AMBIGUITY_MARGIN = 1;

/**
 * Build the set of lexical tokens from a topic string (lowercased).
 * - Latin/digit runs → whole run as one token (e.g. "ai", "2024").
 * - CJK runs → each character AND each adjacent bigram as tokens
 *   (Chinese has no spaces; char+bigram overlap keeps scoring deterministic
 *   and meaningful without external segmentation).
 */
export function topicTokens(topic) {
  const t = String(topic ?? '').toLowerCase();
  const runs = t.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = new Set();
  for (const run of runs) {
    if (/[\p{Script=Han}]/u.test(run)) {
      const chars = [...run];
      for (const ch of chars) tokens.add(ch);
      for (let i = 0; i + 1 < chars.length; i += 1) tokens.add(chars[i] + chars[i + 1]);
    } else {
      tokens.add(run);
    }
  }
  return [...tokens];
}

/** Deterministic overlap score of a question title against topic tokens (0-based). */
export function scoreCandidateTitle(title, tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return 0;
  const t = String(title ?? '').toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    if (tok.length === 0) continue;
    if (t.includes(tok)) score += tok.length >= 2 ? 2 : 1;
  }
  return score;
}

/**
 * Run the Approved candidate-selection policy.
 *
 * @param {string} topic        - normalized research topic
 * @param {Array}  candidates   - search candidates: {questionId, title, answerCount, url}
 * @param {object} [opts]
 * @param {string} [opts.forceQuestionId] - explicit user clarification choice (at most one clarification)
 * @returns {object} { verdict, selected, candidates, rationale }
 */
export function selectCandidate(topic, candidates, opts = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return { verdict: SELECT_VERDICT_NONE, selected: null, candidates: [], rationale: 'search returned no candidates' };
  }
  const tokens = topicTokens(topic);
  const scored = list.map((c) => ({
    ...c,
    score: scoreCandidateTitle(c.title, tokens),
  }));

  // Deterministic ordering: score DESC; answerCount DESC when both non-null (scale metadata
  // used only as a tiebreaker — never fabricated); questionId lexical ASC as final tiebreak.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aCount = Number.isSafeInteger(a.answerCount) ? a.answerCount : -1;
    const bCount = Number.isSafeInteger(b.answerCount) ? b.answerCount : -1;
    if (bCount !== aCount) return bCount - aCount;
    return String(a.questionId).localeCompare(String(b.questionId));
  });

  const best = scored[0];
  const second = scored[1] ?? null;

  // Explicit user clarification choice (at most one clarification round).
  if (opts.forceQuestionId != null) {
    const chosen = scored.find((c) => String(c.questionId) === String(opts.forceQuestionId));
    if (!chosen) {
      return {
        verdict: SELECT_VERDICT_NONE,
        selected: null,
        candidates: scored,
        rationale: `forced selection ${opts.forceQuestionId} is not among search candidates`,
      };
    }
    return {
      verdict: SELECT_VERDICT_AUTO,
      selected: chosen,
      candidates: scored,
      rationale: `user clarification chose candidate ${chosen.questionId}`,
    };
  }

  if (best.score < MIN_ABS_SCORE) {
    return {
      verdict: SELECT_VERDICT_NONE,
      selected: null,
      candidates: scored,
      rationale: `no candidate reached the minimum relevance threshold (best score ${best.score} < ${MIN_ABS_SCORE})`,
    };
  }

  const ambiguous =
    second != null &&
    second.score >= MIN_ABS_SCORE &&
    best.score - second.score < AMBIGUITY_MARGIN &&
    String(best.questionId) !== String(second.questionId);

  if (ambiguous) {
    return {
      verdict: SELECT_VERDICT_AMBIGUOUS,
      selected: null,
      candidates: scored,
      rationale: `material ambiguity: top candidates are comparably relevant (scores ${best.score} vs ${second.score}) and represent distinct questions`,
    };
  }

  return {
    verdict: SELECT_VERDICT_AUTO,
    selected: best,
    candidates: scored,
    rationale: `clear best match by deterministic relevance (score ${best.score}, next ${second ? second.score : 'n/a'})`,
  };
}
