/**
 * research-orchestration/lib/intent.mjs
 *
 * Research intent normalization + Approved analysis-mode policy (R4).
 * Pure functions; no IO.
 *
 * Approved policy (docs/specs/research-orchestration-scope.md §6.3 / R4):
 * - Generic intent ("帮我研究 X" / "看看大家怎么讨论 X" / "综合分析 X") → FULL-COVERAGE digest.
 * - Explicit sampled intent (快速看看 / 只看高赞 / 前X% / top X% / sampled / 不需要全量 …)
 *   → top-percent-analysis with parsed X (default QUICK_PERCENT when no explicit number).
 * - No silent downgrade; mode is decided by intent, not by corpus size / cost / runtime failure.
 */

export const MODE_DIGEST = 'digest';
export const MODE_TOP_PERCENT = 'top-percent-analysis';

/** Default percent when user expresses sampled intent without an explicit number. */
export const QUICK_PERCENT = 20;

const SAMPLED_HINTS = [
  /快速(看看|预览|看一下)/i,
  /quick\s+(look|view|preview)/i,
  /只看高赞(回答)?/i,
  // X% only counts as sampled intent when framed by an explicit sampling verb/frame
  /(?:只看|只取|看|取|选|要|前|top)\s*(\d{1,3})\s*%/i,
  // 采样 only counts as sampled intent when explicitly requested as an action
  /(?:做|给|来|要|用|取).{0,4}采样/i,
  /sampled?\s*(view|look|digest)/i,
  /(不|无|非|不是).{0,4}(需要|要求|要).{0,4}(全量|全貌|全部|full)/i,
  /(不需要|不用|无需|不要).{0,4}(全量|全貌|全部)/i,
];

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

/** Decide the analysis mode + percent from the topic text (Approved R4 policy). */
export function resolveAnalysisIntent(topic) {
  const t = String(topic ?? '');
  if (SAMPLED_HINTS.some((re) => re.test(t))) {
    const percent = extractPercent(t) ?? QUICK_PERCENT;
    return { mode: MODE_TOP_PERCENT, percent, sampledIntent: true };
  }
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
