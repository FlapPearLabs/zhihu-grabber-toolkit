/**
 * t11-trust-surface-enumeration.mjs — MECHANICAL enumeration of the
 * `assertArtifactSafe` production call surface, for the P2A-T11 trust-boundary
 * guard suite.
 *
 * WHY A HELPER AND NOT INLINE REGEX
 * ---------------------------------
 * P2A-T09 shipped two guards that were proved false-green precisely because they
 * matched source text with a regex:
 *
 *   · G3 matched an inline `key !== A && key !== B` comparison — a no-op — and
 *     the test "passed" without ever reaching the registry it claimed to guard.
 *   · A F.5 staging guard matched a comment rather than the branch that runs.
 *
 * A regex that "finds" a call site is therefore NOT evidence that the call site
 * behaves a certain way. So this helper does not decide anything on its own: it
 * only turns `lib/` into a structured list, and every behavioural claim in the
 * guard suite is asserted by EXECUTING the real production function with a real
 * counterexample. If the enumeration is wrong, the behavioural assertions still
 * hold; if the behaviour changes, the behavioural assertions fail.
 *
 * WHAT IS ENUMERATED
 * ------------------
 * Every call expression `assertArtifactSafe(<value>[, { trustedPlanStrings }])`
 * in `lib/`, classified by whether it passes a trust set. Comments and the
 * walker definition itself (`rrf.mjs`, which *defines* rather than *calls* the
 * walker) are excluded by requiring a call to be an actual invocation.
 *
 * The classification is deliberately CONSERVATIVE: anything it cannot parse as a
 * single-line call is reported as `unparsed` rather than silently dropped, so a
 * new multi-line call site shows up as a failure instead of disappearing.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Strip block and line comments so commented-out code cannot be enumerated. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * Classify one stripped source line, given access to the following lines so a
 * MULTI-LINE call can be classified by its full argument text.
 *
 * The decision is made on the TEXT INSIDE THE CALL'S OWN PARENTHESES, not on
 * whatever follows the closing paren: a real call site is almost always
 * followed by an `if (!verdict.ok) {` on the same line, and an earlier version
 * of this helper anchored on the tail and therefore classified all nine real
 * call sites as `unparsed` — a silent degradation, i.e. exactly the false-green
 * shape this ticket exists to prevent.
 *
 * A trust set is recognised in BOTH forms the codebase uses:
 *   · `assertArtifactSafe(x, { trustedPlanStrings: <expr> })`  (object literal)
 *   · `assertArtifactSafe(x, { trustedPlanStrings })`           (shorthand —
 *     `source-group-selection.mjs` uses this; matching only the `:` form
 *     silently misfiled a frozen F.3 call site as untrusted)
 *
 * @param {string[]} lines stripped source lines
 * @param {number} idx index of the line that may contain a call
 * @returns {{kind: 'call-trusted'|'call-untrusted'|'not-a-call'|'unparsed', spanEnd?: number}}
 */
function classifyAt(lines, idx) {
  const line = lines[idx];
  const call = line.match(/\bassertArtifactSafe\s*\(/);
  if (!call) return { kind: 'not-a-call' };
  const open = call.index + call[0].length - 1; // index of '('

  // Walk forward across lines until the argument list balances.
  let depth = 0;
  let text = '';
  let end = idx;
  for (let i = idx; i < lines.length; i += 1) {
    const from = i === idx ? open : 0;
    for (let j = from; j < lines[i].length; j += 1) {
      const ch = lines[i][j];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { text += lines[i].slice(open + 1, j); end = i; break; }
      }
      if (i === idx && j < open) continue;
      text += ch;
    }
    if (depth === 0) break;
    text += ' ';
    end = i + 1;
    if (end - idx > 6) return { kind: 'unparsed' }; // implausibly long: surface it
  }
  if (depth !== 0) return { kind: 'unparsed' };

  const args = text.trim();
  if (!args) return { kind: 'not-a-call' };
  if (/\btrustedPlanStrings\b\s*[:,}]/.test(args) || /\btrustedPlanStrings\b\s*$/.test(args)) {
    return { kind: 'call-trusted', spanEnd: end };
  }
  if (/[A-Za-z_$][\w$]*\s*:/.test(args)) return { kind: 'unparsed', spanEnd: end };
  return { kind: 'call-untrusted', spanEnd: end };
}

/**
 * Enumerate the `assertArtifactSafe` production call surface under `libDir`.
 *
 * @param {string} libDir absolute path to the `lib/` directory
 * @returns {{
 *   files: Array<{file: string, calls: Array<{line: number, kind: string, text: string}>}>,
 *   trusted: Array<{file: string, line: number, text: string}>,
 *   untrusted: Array<{file: string, line: number, text: string}>,
 *   unparsed: Array<{file: string, line: number, text: string}>,
 * }}
 */
export function enumerateAssertArtifactSafeCallSurface(libDir) {
  const trusted = [];
  const untrusted = [];
  const unparsed = [];
  const files = [];

  for (const entry of readdirSync(libDir).sort()) {
    const full = path.join(libDir, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.endsWith('.mjs')) continue;
    // rrf.mjs DEFINES the walker (and recurses internally). Definition and
    // internal recursion are not production call sites; every other module is.
    if (entry === 'rrf.mjs') continue;

    const stripped = stripComments(readFileSync(full, 'utf8'));
    const lines = stripped.split('\n');
    const calls = [];
    for (let i = 0; i < lines.length; i += 1) {
      const { kind, spanEnd } = classifyAt(lines, i);
      if (kind === 'not-a-call') continue;
      calls.push({ file: entry, line: i + 1, text: lines[i].trim(), kind });
      if (kind === 'call-trusted') trusted.push(calls[calls.length - 1]);
      else if (kind === 'call-untrusted') untrusted.push(calls[calls.length - 1]);
      else unparsed.push(calls[calls.length - 1]);
      // Skip the continuation lines of a multi-line call so the options object
      // cannot be re-counted as a second call site.
      if (spanEnd !== undefined && spanEnd > i) i = spanEnd;
    }
    if (calls.length > 0) files.push({ file: entry, calls });
  }

  return { files, trusted, untrusted, unparsed };
}

/** Convenience: the set of module basenames that pass a trust set. */
export function trustedCallSiteFiles(enumeration) {
  return [...new Set(enumeration.trusted.map((c) => c.file))].sort();
}

/** Convenience: the set of module basenames that call the walker with no trust set. */
export function untrustedCallSiteFiles(enumeration) {
  return [...new Set(enumeration.untrusted.map((c) => c.file))].sort();
}
