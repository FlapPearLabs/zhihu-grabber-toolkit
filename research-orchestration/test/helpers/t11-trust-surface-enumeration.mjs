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

  // Walk forward across lines until the argument list balances, then take the
  // text BETWEEN the outermost parens as a slice.
  //
  // The argument text is a SLICE, not an accumulation. Two earlier versions
  // accumulated character by character, and each had an off-by-one that
  // corrupted the result in a way the trust-set cases survived by luck:
  //
  //   · starting the scan AT `open` appended the slice AND then the paren, so
  //     `args` came out doubled (`(pool, opts` + `pool, opts`);
  //   · appending the current character before testing for the closing paren
  //     appended the call's own `);`, so `args` ended in `{ trustedPlanStrings });`.
  //
  // The second form is the dangerous one: it made every SINGLE-LINE call look
  // like it had trailing text, so argument-shape classification could never
  // match, and a bare-identifier options argument fell through to
  // `call-untrusted` — the P1-2 bypass. Slicing removes the class of bug.
  let depth = 0;
  let argsStart = -1;
  let argsEnd = -1;
  let end = idx;
  for (let i = idx; i < lines.length; i += 1) {
    for (let j = i === idx ? open : 0; j < lines[i].length; j += 1) {
      const ch = lines[i][j];
      if (ch === '(') {
        depth += 1;
        if (depth === 1) argsStart = j + 1;
      } else if (ch === ')') {
        // The closing paren of the CALL is at depth 1 and is not decremented:
        // it is the boundary, not a nesting level. Breaking out of the inner
        // loop on `depth === 0` instead would never fire here, and the scan
        // would run on to the length cap and report `unparsed` for every call.
        if (depth === 1) { argsEnd = j; end = i; break; }
        depth -= 1;
      }
    }
    if (argsEnd !== -1) break;
    end = i + 1;
    if (end - idx > 6) return { kind: 'unparsed' }; // implausibly long: surface it
  }
  if (argsStart === -1 || argsEnd === -1) return { kind: 'unparsed' };

  const parts = [lines[idx].slice(argsStart, argsEnd)];
  for (let i = idx + 1; i <= end; i += 1) {
    parts.push(i === end ? lines[i].slice(0, argsEnd) : lines[i]);
  }
  const args = parts.join(' ').trim();
  if (!args) return { kind: 'not-a-call', spanEnd: end };
  if (/\btrustedPlanStrings\b\s*[:,}]/.test(args) || /\btrustedPlanStrings\b\s*$/.test(args)) {
    return { kind: 'call-trusted', spanEnd: end };
  }
  if (/[A-Za-z_$][\w$]*\s*:/.test(args)) return { kind: 'unparsed', spanEnd: end };
  // A BARE IDENTIFIER as the whole options argument is the dangerous case the
  // P1 review caught: `assertArtifactSafe(pool, opts)`. Whether `opts` carries a
  // trust set is not decidable from this line, so classifying it as
  // `call-untrusted` would drop it from `trusted` AND from `unparsed` — a silent
  // degradation of exactly the kind this helper exists to prevent. Report it as
  // `unparsed` so A1 fails loudly and a human (or a resolver below) decides.
  //
  //
  // A ONE-argument call has no options at all and therefore no trust set; it is
  // honestly `call-untrusted` and must not be reported as unparsed.
  if (args.includes(',')) {
    const secondArg = args.split(',').slice(1).join(',').trim();
    if (secondArg && /^[A-Za-z_$][\w$]*$/.test(secondArg)) {
      return { kind: 'unparsed', spanEnd: end };
    }
  }
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

// ===========================================================================
// Trust-set provenance resolution
// ===========================================================================

/**
 * Resolve the SET OF SOURCE EXPRESSIONS that feed one `trustedPlanStrings`
 * argument, following intermediate variables transitively and including
 * post-construction mutation.
 *
 * WHY THIS EXISTS (P1 from the security review)
 * ---------------------------------------------
 * The first version of the C guard decided "is this trust set built from a
 * targeted surface?" by regex-matching a CLOSED LIST OF IDENTIFIER NAMES inside
 * the single `const trusted = …;` statement. The security review demonstrated
 * three widenings that leave it green:
 *
 *   const qs = targetedPools.flatMap(…);            // intermediate
 *   const trusted = new Set([...plan.queryVariants, …qs]);
 *
 *   const trusted = new Set(plan.queryVariants);
 *   trusted.add(action.normalizedQuery);             // post-construction
 *
 *   assertArtifactSafe(pool, opts);                  // via an options object
 *
 * A name list cannot defend against a rename, and a single statement cannot see
 * a two-statement story. So this walks the actual bindings: it collects every
 * assignment to the trust-set variable, every intermediate it reads, and every
 * `.add()` / `.delete()` mutation applied to it, transitively.
 *
 * It remains a lexical approximation — this is a test helper, not a full AST
 * resolver — but it closes the three shapes above, and it is deliberately
 * CONSERVATIVE in the direction that matters: when it cannot understand a
 * binding, it reports that fact instead of reporting "clean".
 *
 * @param {string} source module source (comments already stripped)
 * @param {string} rootVar the variable passed as `trustedPlanStrings`
 * @returns {{expressions: string[], unresolvable: string[]}}
 */
export function resolveTrustSetProvenance(source, rootVar, { maxDepth = 8 } = {}) {
  const statements = splitStatements(source);
  const expressions = new Set();
  const unresolvable = new Set();
  const seen = new Set();

  /** Every `X = <expr>;` binding of `name`, plus every `name.add(<expr>)`. */
  function bindingsOf(name) {
    const out = [];
    // Declarations and reassignments: const/let/var NAME = ...  |  NAME = ...
    const assign = new RegExp(`\\b(?:const|let|var)?\\s*\\b${escapeRe(name)}\\s*=\\s*([^;]+);`, 'g');
    for (let m = assign.exec(source); m !== null; m = assign.exec(source)) {
      out.push({ kind: 'assign', expr: m[1] });
    }
    // Function PARAMETER, including object destructuring:
    //   function augmentAccumulatedPool({ plan, targetedPools }) { … }
    // This is a real, complete binding with no in-file right-hand side to read,
    // so it resolves to the parameter name itself. Without it, every trust set
    // sourced from a destructured `plan` parameter is reported `unresolvable`
    // and C3 fails on honest production code — the guard must be strict about
    // real threats, not noisy about the shape the codebase actually uses.
    out.push(...parameterBindingsOf(source, name));
    // Post-construction mutation: NAME.add(<expr>) / NAME.delete(...)
    const mutate = new RegExp(`\\b${escapeRe(name)}\\s*\\.\\s*(?:add|delete)\\s*\\(\\s*([^)]*)`, 'g');
    for (let m = mutate.exec(source); m !== null; m = mutate.exec(source)) {
      out.push({ kind: 'mutate', expr: m[1] });
    }
    return out;
  }

  function walk(rawName, depth) {
    // `_SPREAD_x` is the `identifiersIn` marker for a spread read of `x`; the
    // variable it names is `x`, so normalise before any binding lookup.
    const name = rawName.startsWith(SPREAD_MARKER) ? rawName.slice(SPREAD_MARKER.length) : rawName;
    if (depth > maxDepth) {
      unresolvable.add(`${name} (max depth ${maxDepth} exceeded)`);
      return;
    }
    if (seen.has(name)) return;
    seen.add(name);
    const found = bindingsOf(name);
    if (found.length === 0) {
      unresolvable.add(name);
      return;
    }
    for (const { kind, expr } of found) {
      expressions.add(expr);
      // Every identifier read inside this expression is followed transitively.
      if (kind === 'mutate') continue; // `.add(action.normalizedQuery)` — a leaf
      for (const ident of identifiersIn(expr)) {
        if (RESERVED.has(ident)) continue;
        walk(ident, depth + 1);
      }
    }
  }

  walk(rootVar, 0);

  // A name that is ONLY a locally-bound callback parameter (`(tp) => …`) is a
  // local, not an unresolvable trust input. The walk above recurses into such
  // names because it cannot see arrow-function scope; un-mark them here so a
  // lambda does not read as a blind spot.
  for (const name of [...unresolvable]) {
    if (locallyBoundNames(source).has(name)) unresolvable.delete(name);
  }
  return { expressions: [...expressions], unresolvable: [...unresolvable] };
}

/** Identifiers bound as callback parameters or destructured bindings anywhere. */
function locallyBoundNames(source) {
  const names = new Set();
  for (const list of functionParameterLists(source)) {
    for (const p of list) {
      const inner = /^\s*\{([\s\S]*)\}\s*$/.exec(p);
      if (inner) {
        for (const m of inner[1].split(',')) {
          const key = m.split(':').pop().trim();
          if (key) names.add(key);
        }
        continue;
      }
      if (p) names.add(p);
    }
  }
  const arrow = /\(([^()]*)\)\s*=>/g;
  for (let m = arrow.exec(source); m !== null; m = arrow.exec(source)) {
    for (const p of m[1].split(',')) {
      const t = p.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  const single = /\(([A-Za-z_$][\w$]*)\)\s*=>/g;
  for (let m = single.exec(source); m !== null; m = single.exec(source)) names.add(m[1]);
  return names;
}

/**
 * Resolve `assertArtifactSafe(value, opts)` where the options object hides the
 * trust set: find `opts`'s object-literal binding and return the expression
 * assigned to its `trustedPlanStrings` member.
 *
 * The P1 review showed that passing the trust set behind an options variable
 * made the old enumerator report the call as UNTRUSTED — dropping it from the
 * trust surface entirely. The enumerator now reports such calls as `unparsed`
 * (so A1 fails loudly); this function is how a caller may resolve them
 * deliberately instead.
 *
 * @returns {string|null} the trust-set expression, or null if there is none
 */
export function resolveOptionsTrustSetExpression(source, optsVar) {
  const objBinding = new RegExp(`\\b(?:const|let|var)\\s+${escapeRe(optsVar)}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;`).exec(source);
  if (objBinding === null) return null;
  // Read the member value with BRACKET/BRACE PARITY, not `[^,}]+`. A trust set
  // built as `new Set([...a, ...b])` contains a comma at depth 1, and the
  // character-class version truncated the expression at that comma — returning
  // `new Set([...trusted`, which reads as clean. Truncating the very value the
  // guard exists to inspect is the failure mode, not a formatting detail.
  const marker = 'trustedPlanStrings';
  const keyAt = objBinding[1].indexOf(marker);
  if (keyAt === -1) return null;
  const after = objBinding[1].slice(keyAt + marker.length);
  const colonAt = after.indexOf(':');
  if (colonAt === -1) return null;
  const valueStart = colonAt + 1;
  const body = after.slice(valueStart);
  let depth = 0;
  let end = body.length;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) { end = i; break; }
      depth -= 1;
    } else if (ch === ',' && depth === 0) { end = i; break; }
  }
  const value = body.slice(0, end).trim();
  return value === '' ? null : value;
}


/**
 * A destructured or plain FUNCTION PARAMETER binding, as a self-named
 * expression: `plan` is a complete binding, so it contributes the expression
 * `plan` and the surrounding expression's `plan.queryVariants` read is what the
 * caller matches on.
 *
 * Signatures are read with parenthesis pairing from the `function` keyword
 * rather than by matching any `{…})` in the file, so an ordinary object literal
 * argument (`foo({ plan })`) is NOT mistaken for a parameter list.
 *
 * @returns {Array<{kind: string, expr: string}>}
 */
function parameterBindingsOf(source, name) {
  const out = [];
  for (const params of functionParameterLists(source)) {
    if (params.includes(name)) out.push({ kind: 'param', expr: name });
  }
  return out;
}

/** Every function signature's parameter list, split into trimmed member names. */
function functionParameterLists(source) {
  const lists = [];
  const fn = /\bfunction\b/g;
  for (let m = fn.exec(source); m !== null; m = fn.exec(source)) {
    const open = source.indexOf('(', m.index);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < source.length && i - open < 2000; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          lists.push(source.slice(open + 1, i).split(',').map((s) => s.trim()));
          break;
        }
      }
    }
  }
  return lists;
}

/** Split a module into top-level `;`-terminated statements (lexical approximation). */
function splitStatements(source) {
  return source.split(';').map((s) => s.trim()).filter(Boolean);
}

/**
 * Identifiers appearing in an expression: every VARIABLE it reads, with
 * property names, string literals and arrow-callback bodies removed.
 *
 * The spread rule is the load-bearing one. A spread IS a read of a variable
 * (`new Set([...plan.queryVariants, ...qs])` reads `qs`), but the property-name
 * strip below would eat the `qs` along with the dot and lose that hop — and
 * losing the hop is exactly how a two-statement widening stays invisible. So
 * the spread member is detached behind an `_SPREAD_` prefix FIRST, which makes
 * the member a plain identifier and leaves no dot for the strip to match.
 */
function identifiersIn(expr) {
  const stripped = String(expr)
    .replace(/\.\.\.([A-Za-z_$][\w$]*)/g, `${SPREAD_MARKER}$1`)
    // Drop string literals so a targeted-looking word inside prose is not a hit.
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    // Drop ARROW BODIES: what an expression reads is decided by the expression,
    // not by what a callback it happens to contain reads.
    .replace(/\(([^()]*)\)\s*=>/g, '()=>')
    // Drop property names: `a.normalizedQuery` -> `a`.
    .replace(/\.\s*[A-Za-z_$][\w$]*/g, '.');
  return [...stripped.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((m) => m[0]);
}

/** Marker prefix `identifiersIn` uses to keep a spread read walkable. */
const SPREAD_MARKER = '__p2aT11Spread__';

const RESERVED = new Set([
  'new', 'Set', 'Array', 'Object', 'String', 'Number', 'Boolean', 'typeof',
  'instanceof', 'true', 'false', 'null', 'undefined', 'if', 'else', 'return',
  'const', 'let', 'var', 'function', 'length', 'flatMap', 'map', 'filter',
  'isArray', 'join', 'concat', 'push', 'slice', 'from', 'of', 'keys', 'values',
]);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
