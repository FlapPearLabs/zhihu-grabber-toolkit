/**
 * research-orchestration/lib/intent.mjs
 *
 * Research intent normalization + Approved analysis-mode policy (R4).
 * Pure functions; no IO.
 *
 * Approved policy (docs/specs/research-orchestration-scope.md §6.3 / R4):
 * - Generic intent ("帮我研究 X" / "看看大家怎么讨论 X" / "综合分析 X") → FULL-COVERAGE digest.
 * - Explicit sampled intent (快速看看 / 只看高赞 / 看前X%的回答 / top X% answers / sampled view /
 *   不需要全量 …) → top-percent-analysis with parsed X (default QUICK_PERCENT when no explicit number).
 * - CONSERVATIVE RULE: percentage/采样 only count as sampled intent when tied to an explicit
 *   ANSWER / OPINION / CORPUS frame (回答/答案/观点/高赞/看法/评论/answers…). When uncertain →
 *   FULL-COVERAGE (generic/default → full). No silent downgrade.
 */

export const MODE_DIGEST = 'digest';
export const MODE_TOP_PERCENT = 'top-percent-analysis';

/** Default percent when user expresses sampled intent without an explicit number. */
export const QUICK_PERCENT = 20;

/** Answer/corpus/opinion nouns that make an X% mention an explicit sampling request. */
const ANSWER_FRAME = '(?:回答|答案|观点|高赞|看法|意见|评论|内容|样本|语料|answers?|replies?|comments?|opinions?)';

/** Explicit non-percent sampled action frames (must clearly request a subset view). */
const SAMPLED_ACTION_FRAMES = [
  /快速(看看|预览|看一下)/i,
  /quick\s+(look|view|preview)/i,
  /只看高赞(回答)?/i,
  // 采样/抽样 trigger sampled ONLY when the wording unambiguously requests a SUBSET VIEW of
  // answers/corpus. All frames REQUIRE an answer/corpus noun (回答/答案/内容/语料/评论) and
  // reject attribute/metric compounds (数据/客户/样本/特征/质量/数量/版本…). Generic SUBJECT
  // uses stay FULL-COVERAGE. Conservative rule: when uncertain → FULL-COVERAGE (R4 §6.3).
  /采样\s*(视图|版\s*摘要)/i,
  /只采样(?:部分|一些|前|top|少量|其中)\s*(?:的)?(?:高赞\s*)?(?:回答|答案|内容|语料|评论)/i,
  /对.{0,8}(?:回答|答案|内容|语料|评论|高赞)\s*(?:做|进行|来|去)\s*抽样分析/i,
  /sampled?\s*(view|look|digest)/i,
  // Explicit refusal-of-full idioms only — bare 无/非 (Chinese subject prefixes like 无监督/非监督)
  // must NOT trigger sampled (they are ordinary research subjects, not sampling requests).
  /(不需要|不用|无需|不要|无须).{0,4}(全量|全貌|全部|full)/i,
];

/**
 * Percentage-based sampled intent: X% must be tied to an explicit ANSWER/OPINION/CORPUS frame,
 * e.g. 前20%的回答 / 只看前20%的高赞回答 / 取前20%的答案 / top 20% answers.
 * "我要20%的年化收益" / "选择20%的股票" are NOT sampled (percent is a subject, not a corpus subset).
 */
const PERCENT_SAMPLE_FRAME = new RegExp(
  `(?:只看|只取|看|取|选|要|前|top)\\s*(\\d{1,3})\\s*%\\s*(?:的)?(?:高赞\\s*)?${ANSWER_FRAME}(?!(?:率|数|量|比|差|度|值|额|价|本|据|均|总))`,
  'i',
);

const PERCENT_PATTERNS = [
  /(?:前|top)\s*(\d{1,3})\s*%/i,
  /(\d{1,3})\s*%/,
];

/** Normalize raw user input into a research topic string (trim, strip quoting). */
export function normalizeTopic(input) {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

/** Extract an explicit percentage (1..100) from a sampled intent string, or null. */
export function extractPercent(text) {
  if (typeof text !== 'string') return null;
  for (const re of PERCENT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n) && n >= 1 && n <= 100) return n;
    }
  }
  return null;
}

/** Decide the analysis mode + percent from the topic text (Approved R4 policy, conservative). */
export function resolveAnalysisIntent(topic) {
  const t = String(topic ?? '');

  // 1. Explicit non-percent sampled action frames.
  if (SAMPLED_ACTION_FRAMES.some((re) => re.test(t))) {
    const percent = extractPercent(t) ?? QUICK_PERCENT;
    return { mode: MODE_TOP_PERCENT, percent, sampledIntent: true };
  }

  // 2. Percentage tied to an explicit answer/opinion/corpus frame.
  const m = PERCENT_SAMPLE_FRAME.exec(t);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isInteger(n) && n >= 1 && n <= 100) {
      return { mode: MODE_TOP_PERCENT, percent: n, sampledIntent: true };
    }
    // out-of-range / meaningless percent → uncertain → FULL-COVERAGE
  }

  // 3. Conservative default: generic / uncertain → FULL-COVERAGE digest.
  return { mode: MODE_DIGEST, percent: null, sampledIntent: false };
}

/**
 * Normalize an explicit --mode option into the approved mode id.
 * Returns null when the value is not one of the approved modes.
 */
export function normalizeExplicitMode(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'digest' || v === 'full' || v === 'full-coverage' || v === 'full-digest') return MODE_DIGEST;
  if (v === 'top-percent' || v === 'top-percent-analysis' || v === 'sampled' || v === 'sample') return MODE_TOP_PERCENT;
  return null;
}

/**
 * Resolve the effective (mode, percent) from CLI options + Approved R4 intent policy.
 * - explicitMode 'auto' (or absent) → intent-driven;
 * - explicitMode digest/top-percent → explicit mode wins;
 * - explicitPercent alone implies sampled (top-percent);
 * - top-percent percent: explicit > intent-extracted > QUICK_PERCENT; must be integer 1..100.
 * Returns { valid, mode, percent } (valid=false for invalid mode/percent).
 */
export function resolveRequestedMode({ explicitMode = null, explicitPercent = null, intent = null } = {}) {
  const effIntent = intent ?? resolveAnalysisIntent('');
  let mode = effIntent.mode;
  let percent = effIntent.percent;

  if (explicitMode && explicitMode !== 'auto') {
    const m = normalizeExplicitMode(explicitMode);
    if (!m) return { valid: false, mode: null, percent: null };
    mode = m;
    percent = mode === MODE_TOP_PERCENT ? (explicitPercent ?? effIntent.percent ?? QUICK_PERCENT) : null;
  } else if (explicitPercent != null) {
    mode = MODE_TOP_PERCENT;
    percent = explicitPercent;
  }

  if (mode === MODE_TOP_PERCENT) {
    const raw = String(percent ?? '').trim();
    if (!/^\d{1,3}$/.test(raw)) return { valid: false, mode, percent: null };
    const n = Number.parseInt(raw, 10);
    if (n < 1 || n > 100) return { valid: false, mode, percent: null };
    percent = n;
  }
  return { valid: true, mode, percent };
}
