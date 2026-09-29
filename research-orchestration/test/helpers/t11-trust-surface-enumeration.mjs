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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
  // The FULL call text, arguments included. `text` below keeps only the first
  // line, which for a multi-line call such as
  //   assertArtifactSafe(pool, {
  //     trustedPlanStrings: new Set(validated.plan.queryVariants),
  //   });
  // is `assertArtifactSafe(pool, {` — the member is not in it at all. Any
  // consumer that reads the trust set out of `text` is therefore blind to every
  // multi-line call site, and `retrieval.mjs` is written exactly that way.
  const callText = [
    lines[idx].slice(call.index),
    ...lines.slice(idx + 1, end + 1).map((l, k) => (idx + 1 + k === end ? l.slice(0, argsEnd + 1) : l)),
  ].join(' ');
  if (!args) return { kind: 'not-a-call', spanEnd: end };
  if (/\btrustedPlanStrings\b\s*[:,}]/.test(args) || /\btrustedPlanStrings\b\s*$/.test(args)) {
    return { kind: 'call-trusted', spanEnd: end, callText };
  }
  if (/[A-Za-z_$][\w$]*\s*:/.test(args)) return { kind: 'unparsed', spanEnd: end, callText };
  // A ONE-argument call has no options at all and therefore no trust set; it is
  // honestly `call-untrusted` and must not be reported as unparsed.
  if (!args.includes(',')) return { kind: 'call-untrusted', spanEnd: end, callText };
  // ANY second argument this function cannot read as a literal is `unparsed`.
  //
  // P1-2 FIXED HERE, AND IT WAS NOT ABOUT BARE IDENTIFIERS. The rule used to
  // fire only for a second argument that was a plain bare identifier, so
  // `assertArtifactSafe(pool, opts)` was caught while
  // `assertArtifactSafe(pool, opts ?? {})`,
  // `assertArtifactSafe(pool, makeOpts())` and
  // `assertArtifactSafe(pool, { ...opts, trustedPlanStrings: qs })` all fell
  // through to `call-untrusted` — dropped from `trusted`, absent from
  // `unparsed`, and therefore never examined by C3. The security review
  // reproduced it by putting the options object behind `??` in
  // `coverage-final-integration.mjs` and watching 22/22 stay green.
  //
  // The distinguishing question is not "is it a bare identifier" but "can this
  // function read the trust set out of it". If the answer is no, the call is
  // unparsed — never silently untrusted. A literal `{}` or a member expression
  // with no `trustedPlanStrings` IS readable, and C3 resolves it below.
  //
  // THE FIFTH REVIEW FOUND THE REMAINDER OF THE SAME BUG, AND IT IS A WIRING
  // MISMATCH RATHER THAN A MISSED CASE. A bare identifier used to land in
  // `call-untrusted` here, on the grounds that the resolver CAN read it — and
  // C3 does have a `__opts__NAME` branch that reads it. But C3 iterates
  // `trusted + unparsed`, so the branch was dead: a call classified as
  // untrusted is examined by nobody, so the one classification that had a
  // working resolver behind it was the one that never reached it. The C3b
  // "P1-2 OPTIONS OBJECT" case still passed, because it calls the predicate
  // directly with a hand-built call object and so never goes through this
  // classifier at all — a mutation proof that skipped the routing it was
  // written to cover.
  //
  // The fix is the alignment, not a new rule: a second argument this
  // classifier cannot read is `unparsed` (fail loud in A1, examined by C3), and
  // a second argument it CAN read is only `call-untrusted` when reading it
  // finds no trust set — which is a question for the resolver, not for a
  // syntactic guess made here.
  //
  // ONE carve-out keeps the noise down, and it is narrow on purpose. A second
  // argument that is an EMPTY object literal — or an object literal whose
  // members are all statically visible and none of them is
  // `trustedPlanStrings` — provably carries no trust set, so it stays
  // `call-untrusted` and C3 never has to resolve it. Everything else, INCLUDING
  // a bare identifier, goes to `unparsed` where the `__opts__` branch can
  // answer it properly. Routing the empty case the long way would have C3
  // report `no statically readable trustedPlanStrings member` as an
  // unresolvable on code that is correct, which is how a guard teaches its
  // readers to ignore it.
  const secondArg = readSecondArgument(args);
  if (secondArg === null) return { kind: 'call-untrusted', spanEnd: end, callText };
  if (isProvablyTrustSetFree(secondArg)) return { kind: 'call-untrusted', spanEnd: end, callText };
  return { kind: 'unparsed', spanEnd: end, callText };
}

/**
 * The second argument of a call, taken as a BALANCED slice so a nested
 * `opts ?? {}` or `{ a: f(b, c) }` is not truncated at its first comma.
 *
 * @returns {string|null} the trimmed text, or `null` when there is none
 */
function readSecondArgument(args) {
  const commaAt = args.indexOf(',');
  if (commaAt === -1) return null;
  const tail = args.slice(commaAt + 1).trim();
  if (tail === '') return null;
  // Balance over the whole tail: the first argument is already behind us, and
  // the options object is whatever remains.
  let depth = 0;
  for (let i = 0; i < tail.length; i += 1) {
    const ch = tail[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return tail.slice(0, i).trim();
      depth -= 1;
    }
  }
  return tail;
}

/**
 * Whether a second argument PROVABLY carries no trust set, so the call is
 * honestly `call-untrusted` and needs no resolution.
 *
 * This replaces `isReadableLiteralOptions`, which asked the opposite question —
 * "can this be read?" — and produced a classification nobody acted on. The
 * distinction matters because the two questions have different failure modes:
 * answering "readable" wrongly routes a call away from every examiner (the
 * fifth review's P1-2), while answering "provably empty" wrongly only adds a
 * reportable unresolvable. The second is recoverable; the first is a hole.
 *
 * So the test is deliberately one-sided. It returns true ONLY for an object
 * literal whose keys are all statically visible and plainly not
 * `trustedPlanStrings`:
 *
 *     {}                        — nothing
 *     { a: 1, b: 2 }            — nothing
 *     { trustedPlanStrings: xs }— NOT provably free; the member is right there
 *
 * A bare identifier is never provably free: whether the options object holds a
 * trust set is a property of its binding, and a binding is exactly what the
 * `__opts__` resolver exists to read. So `assertArtifactSafe(pool, opts)` goes
 * to `unparsed` and gets examined.
 *
 * @param {string} secondArg the balanced second-argument slice
 * @returns {boolean}
 */
function isProvablyTrustSetFree(secondArg) {
  if (!/^\{[\s\S]*\}$/.test(secondArg)) return false;
  // `trustedPlanStrings` anywhere in the literal — as a key, a shorthand, or a
  // spread that could carry one — is enough to disqualify it.
  if (/\btrustedPlanStrings\b/.test(secondArg)) return false;
  // A spread or a computed key can introduce members this text does not show,
  // so the literal is not closed over its own keys.
  if (/\.\.\./.test(secondArg)) return false;
  if (/\[\s*[^'"\]]/.test(secondArg)) return false;
  // Every remaining member must be a plain `key:` with a literal-ish value. A
  // bare `key` (shorthand) is fine: it is still a visible, named key.
  for (const member of splitTopLevelMembers(secondArg.slice(1, -1))) {
    const t = member.trim();
    if (t === '') continue;
    if (!/^[A-Za-z_$][\w$]*\s*[:,]/.test(t) && !/^['"][^'"]*['"]\s*:/.test(t)) return false;
  }
  return true;
}

/** Split an object literal's body on commas that are not nested inside anything. */
function splitTopLevelMembers(body) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') out.push(current);
  return out;
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
      const { kind, spanEnd, callText } = classifyAt(lines, i);
      if (kind === 'not-a-call') continue;
      calls.push({ file: entry, line: i + 1, text: lines[i].trim(), callText: callText ?? lines[i].trim(), kind });
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
export function resolveTrustSetProvenance(source, rootVar, { maxDepth = 8, budget } = {}) {
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
    out.push(...destructuredAliasBindingsOf(source, name));
    // A `for…of` head is a binding too. Without this rule the loop variable
    // resolves to nothing at all, the name that was being iterated is never
    // visited, and a trust set widened through a loop reads as clean — see
    // `loopHeadBindingsOf` for the shape that stayed green through four
    // review rounds.
    out.push(...loopHeadBindingsOf(source, name));

    // RECEIVER mutation: `NAME.add(x)`, `NAME.delete(x)`, `NAME.clear()`.
    // The name is the RECEIVER, which is unambiguous — nothing else can put
    // the trust set there — and it holds for any method name. That generality
    // is the point: the fourth review's P1-2 was a list containing only
    // `add|delete`, and a list of verbs survives only until the next verb.
    const receiver = new RegExp(`\\b${escapeRe(name)}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(\\s*([^)]*)`, 'g');
    for (let m = receiver.exec(source); m !== null; m = receiver.exec(source)) {
      out.push({ kind: 'mutate', expr: m[1] });
    }

    // ARGUMENT mutation: `Object.assign(trusted, targetedPools)` — the trust
    // set handed to a callee that writes into it. Same P1, different position.
    //
    // GATED ON THE NAME ACTUALLY BEING A SET, and the gate is not optional.
    // Ungated, `fn(name, …)` matches every call that takes a first argument in
    // a 4000-line module: the parameter `plan` alone produced 101 expressions
    // and 31 phantom blind spots, because plenty of calls take a plan first and
    // none of them writes into it. Position is necessary and not sufficient;
    // being a set is the actual precondition for `Object.assign(trusted, …)`
    // to mean anything.
    if (isSetCarrierIn(source, name)) {
      // The negative lookbehind sits IMMEDIATELY before the trust set's name,
      // not before the callee. Placed before the callee — the obvious reading
      // of "not a member access" — it forbids the dot in `Object.assign(…)`,
      // which is precisely the call the fourth review built, and the rule
      // matched nothing at all. What must be excluded is the trust set appearing
      // as a PROPERTY (`opts.trusted`), because that is a read of someone
      // else's field rather than this set being written into.
      const asFirstArg = new RegExp(
        `\\b[A-Za-z_$][\\w$]*\\s*\\(\\s*(?<![.\\w$])${escapeRe(name)}\\s*,([^)]*)`,
        'g',
      );
      for (let m = asFirstArg.exec(source); m !== null; m = asFirstArg.exec(source)) {
        out.push({ kind: 'mutate', expr: m[1] });
      }
    }
    out.push(...callbackReceiverBindingsOf(source, name));
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
      // No binding explains this name — but a name with no binding is often a
      // CALL, and a call's value is decided by the callee's body.
      // `validated.plan.queryVariants` reduces to `validatePlanInput`, which
      // has no binding in `retrieval.mjs`; it is imported from
      // `plan-contract.mjs`. Reporting it blind-spotped the F.3 boundary's own
      // production line on its two most legitimate bindings
      // (`validatePlanInput`, `isPlainObject`), which is the noise-to-signal
      // failure that makes a guard's real findings get waived.
      //
      // So the body route is consulted before declaring a blind spot, and only
      // a name no route explains is reported.
      //
      // The cross-module hop is deliberately NOT taken here: this function has
      // no `libDir`, and inventing one would make a pure source walk depend on
      // the filesystem. A `import { name } from './x.mjs'` is therefore recorded
      // as a PENDING import — a distinct, non-empty expression list that carries
      // no `unresolvable`, so the one caller that CAN follow the import is
      // obliged to try. It must NOT be recorded as a plain expression, because
      // every route short-circuits on `expressions.length > 0` and a completed
      // import marker there means the origin module's body is never read: adding
      // a targeted string to `plan-contract.mjs` stayed green because exactly
      // that short-circuit fired. Any other
      // unexplained name is a genuine blind spot.
      const viaBody = resolveCallReturnProvenance(source, name, { budget });
      if (viaBody.found) {
        for (const e of viaBody.expressions) expressions.add(e);
        for (const n of viaBody.unresolvable) unresolvable.add(n);
        return;
      }
      if (isLibRelativeImport(source, name)) {
        expressions.add(IMPORT_PENDING_MARKER + name);
        return;
      }
      unresolvable.add(name);
      return;
    }
    for (const { expr } of found) {
      expressions.add(expr);
      // Every identifier read inside this expression is followed transitively.
      //
      // P1-B FIXED HERE. A mutation argument used to be treated as a LEAF:
      // `trusted.add(action.normalizedQuery)` was caught only because the
      // literal word `normalizedQuery` matched the surface pattern, while
      // `trusted.add(qs)` — the same widening behind one intermediate — was
      // not, and neither was a `for…of` loop appending per item. Treating the
      // leaf as a leaf made the mutation half of the guard a false green for
      // exactly the renames and indirections it was meant to survive. A
      // mutation argument is an ordinary read and is now followed like one.
      for (const ident of provenanceIdentifiersIn(expr)) {
        // `PROVENANCE_VOCABULARY` and not just `RESERVED`. This walk is the one
        // that produced `fs`, `path` and `message` as blind spots on the F.3
        // boundary's own line: the body route filtered vocabulary and this one
        // did not, so the same identifier was clean on one path and a finding
        // on the other. One vocabulary, applied at every place a name is
        // followed.
        if (RESERVED.has(ident) || PROVENANCE_VOCABULARY.has(ident)) continue;
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
 * Resolve the actual trust set behind an ES6-SHORTHAND call site
 * (`assertArtifactSafe(x, { trustedPlanStrings })`) by finding the CALLERS of
 * the enclosing function and reading what they pass for that member.
 *
 * WHY THIS IS NEEDED (P1-A, second half)
 * ---------------------------------------
 * With the shorthand, the trust set is a FUNCTION PARAMETER, so there is nothing
 * in the enclosing module to read: a lexical walk of that module's source
 * matched unrelated symbols that merely share the name (`ok`, `reason`,
 * `currentPoolPlanHash`) and produced a nonsensical provenance list. Following
 * the parameter is impossible without a call graph; following the CALLERS is
 * both possible and the more honest check, because the callers are where the
 * trusted strings actually enter.
 *
 * When no caller can be found — an exported function nothing in `lib/` calls —
 * that is reported as `unresolvable` so the guard fails closed rather than
 * waving the site through.
 *
 * @param {string} libDir absolute path to `lib/`
 * @param {string} file the module containing the shorthand call
 * @param {string} calleeName the enclosing exported function's name
 * @param {string} memberName the shorthand member, e.g. `trustedPlanStrings`
 * @returns {{expressions: string[], unresolvable: string[]}}
 */
export function resolveShorthandTrustSetFromCallers(libDir, file, calleeName, memberName) {
  const expressions = new Set();
  const unresolvable = new Set();
  let callerCount = 0;

  for (const entry of readdirSync(libDir).sort()) {
    if (!entry.endsWith('.mjs')) continue;
    const full = path.join(libDir, entry);
    if (!statSync(full).isFile()) continue;
    const stripped = stripComments(readFileSync(full, 'utf8'));
    for (const m of stripped.matchAll(new RegExp(`\\b${escapeRe(calleeName)}\\s*\\(`, 'g'))) {
      // Skip the declaration itself.
      const before = stripped.slice(Math.max(0, m.index - 80), m.index);
      if (/\bfunction\s*$/.test(before)) continue;
      const args = readCallArguments(stripped, m.index + m[0].length - 1);
      if (args === null) continue;
      callerCount += 1;
      // The member may sit in ANY argument — `persistSelectionDecision(workDir,
      // decision, { trustedPlanStrings: … })` puts it third — so the whole
      // argument list is searched rather than each argument in turn. Checking
      // arguments one at a time and reporting the first miss is what made this
      // site look unresolvable when its real trust set was perfectly readable.
      let resolvedHere = false;
      for (const arg of args) {
        const member = readMemberValue(arg, memberName);
        if (member === null) continue;
        resolvedHere = true;
        expressions.add(member);
        // Follow one level of indirection: the argument is usually a variable.
        if (/^[A-Za-z_$][\w$]*$/.test(member)) {
          const nested = resolveTrustSetProvenance(stripped, member);
          for (const e of nested.expressions) expressions.add(e);
          for (const n of nested.unresolvable) unresolvable.add(`${entry}: ${n}`);
        }
      }
      if (!resolvedHere) {
        unresolvable.add(`${entry}: \`${calleeName}(…)\` passes no readable \`${memberName}\``);
      }
    }
  }

  if (callerCount === 0) {
    unresolvable.add(`no in-module caller of \`${calleeName}\` found in lib/`);
  }
  return { expressions: [...expressions], unresolvable: [...unresolvable] };
}

/** The argument texts of one call, given the index of its opening paren. */
function readCallArguments(source, open) {
  let depth = 0;
  let argsStart = open + 1;
  let argsEnd = -1;
  for (let j = open; j < source.length && j - open < 4000; j += 1) {
    const ch = source[j];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) { argsEnd = j; break; }
    }
  }
  if (argsEnd === -1) return null;
  return splitTopLevelCommas(source.slice(argsStart, argsEnd));
}

/** Split an argument list on commas that are not inside brackets. */
function splitTopLevelCommas(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const tail = text.slice(start).trim();
  if (tail !== '') out.push(tail);
  return out;
}

/**
 * The value of `memberName` inside one object-literal argument, or the
 * argument itself if it is shorthand (`{ trustedPlanStrings }`).
 */
function readMemberValue(argText, memberName) {
  const body = argText.trim();
  if (!/^[{[]/.test(body)) return null;
  const keyAt = body.indexOf(memberName);
  if (keyAt === -1) return null;
  const after = body.slice(keyAt + memberName.length);
  const colonAt = after.indexOf(':');
  if (colonAt === -1) {
    // Shorthand at the call site too: the value is the member name itself,
    // bound by the caller's own scope. Report it so the caller resolves it.
    return memberName;
  }
  const value = readBalancedMemberValue(after.slice(colonAt + 1));
  return value === '' ? null : value;
}

function readBalancedMemberValue(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return text.slice(0, i).trim();
      depth -= 1;
    } else if (ch === ',' && depth === 0) return text.slice(0, i).trim();
  }
  return text.trim();
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
 * The MODULE an identifier is imported from, if any, per the `lib/` import map.
 *
 * A cross-module import is the last hop a lexical walk can take before it would
 * need real module resolution. Two of the five audited sites lean on it —
 * `retrieval.mjs` reads `validatePlanInput` from `plan-contract.mjs` — so
 * stopping there leaves the boundary checked only up to the import line, and a
 * helper on the other side of that line is exactly where a reviewer would move
 * the widening next.
 *
 * @param {string} libDir absolute path to `lib/`
 * @param {string} file the importing module's basename
 * @param {string} name the imported binding
 * @returns {string|null} the imported module's basename
 */
export function importOriginOf(libDir, file, name) {
  // `existsSync` rather than `statSync` so a SYNTHETIC source (a mutation-proof
  // fixture named after a module that does not exist on disk) yields `null`
  // instead of throwing ENOENT out of a predicate that is supposed to answer
  // "can this name be accounted for?", not "does this path exist?".
  const full = path.join(libDir, file);
  if (!existsSync(full)) return null;
  if (!statSync(full).isFile()) return null;
  const stripped = stripComments(readFileSync(full, 'utf8'));
  // BOTH QUOTE STYLES — see `isLibRelativeImport`. A path spelled with double
  // quotes is the same import, and matching only one of them makes the
  // cross-module route silently inapplicable.
  // GROUPS: 1 = the name list, 2 = the opening quote (a back-reference so the
  // path cannot contain its own delimiter), 3 = the path. The quote group is
  // there only to close the match, and the first version of this edit read
  // `m[2]` as the path — which is the quote character. `path.basename('"')` is
  // `'""'`, no such file exists, and the route returns `null` while looking
  // like it ran: a cross-module hop that is silently inapplicable, which is
  // the same blindness as not having the rule at all.
  for (const m of stripped.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*(['"])(\.[^'"]+)\2/g)) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim());
    if (!names.includes(name)) continue;
    const target = path.basename(m[3]);
    const targetFull = path.join(libDir, target);
    if (existsSync(targetFull) && statSync(targetFull).isFile()) return target;
  }
  return null;
}

/**
 * The source expressions a FUNCTION CALL contributes to the trust set, when the
 * call is the whole right-hand side (`const validated = validatePlanInput(plan)`).
 *
 * P1-1 REQUIRED THIS. A call result is a semantic boundary for a lexical walk:
 * the value comes from the callee's body, not from the binding site. Treating
 * the call as an opaque leaf is exactly the hole the third review round walked
 * through — `trustedPlanStrings: collectTrustedPlanStrings(validated.plan)`
 * stayed green while the targeted surface sat inside the helper.
 *
 * So the callee's own body is read, and every identifier IT reads is followed
 * in the callee's scope. That does not execute anything, but it does mean a
 * helper that pulls from a targeted surface cannot hide: the name appears in the
 * returned expressions, and the caller's `TARGETED_SURFACE` match sees it.
 *
 * @param {string} source the module containing the call
 * @param {string} callName the called function's name
 * @param {{budget?: object, maxHops?: number}} [opts] `budget` is the shared
 *   call-graph budget; `maxHops` bounds how deep this route may recurse
 * @returns {{found: boolean, expressions: string[], unresolvable: string[]}}
 */
export function resolveCallReturnProvenance(source, callName, { budget, maxHops = 12 } = {}) {
  const expressions = new Set();
  const unresolvable = new Set();
  // SHARED, NOT PER-CALL. The body route, the binding walk and the cross-module
  // route call each other, and two of them can reach the same function through
  // different paths — `plan-contract.mjs` has `validatePlanInput` and
  // `validatePlanJson` each calling `validatePlanInput`. With a fresh budget per
  // call the mutual recursion never terminates: adding a targeted string to
  // `plan-contract.mjs` made the guard throw `RangeError: Maximum call stack
  // size exceeded` instead of reporting a violation, which is a guard that dies
  // on exactly the input it exists to catch. One budget per top-level walk makes
  // every function resolve at most once, so the walk is finite by construction.
  const graph = budget ?? { visited: new Set() };
  if (graph.visited.has(callName)) {
    return { found: true, expressions: [`${callName}(…) body (already walked)`], unresolvable: [] };
  }
  if (graph.visited.size >= maxHops) {
    // FAIL CLOSED, AND THE ASYMMETRY WITH `maxDepth` IS THE POINT.
    //
    // The fourth review flagged this as fail-open: reaching the limit returned
    // an expression saying "truncated, not clean" and an EMPTY `unresolvable`,
    // so C3 read it as a clean site. A 14-link call chain with the targeted
    // surface at the far end passed. The sibling budget — `maxDepth` in
    // `resolveTrustSetProvenance` — has always reported
    // `… max depth 8 exceeded` as an unresolvable, i.e. failed closed. Two
    // budgets bounding the same walk must agree on which way to fail, or the
    // tighter one is an opt-out from the guard.
    //
    // A truncation the guard cannot see past is a blind spot, so it is reported
    // as one. The honest way to make this quieter is a larger `maxHops`, which
    // is a decision about how much call graph to read — not something to
    // achieve by making the guard look clean.
    return {
      found: true,
      expressions: [],
      unresolvable: [`${callName} (call-graph hop limit ${maxHops} reached — walk truncated, not clean)`],
    };
  }
  // MARKED ONLY AFTER THE BODY IS LOCATED. The sixth review found why, and the
  // difference is between a guard and a rubber stamp.
  //
  // `visited.add(callName)` used to run BEFORE the header lookup, so a name with
  // no top-level function here was marked visited and then returned
  // `found: false`. The caller tries its next route, which calls back into this
  // function with the SAME shared budget, hits `visited.has(callName)`, and got
  // `found: true, expressions: ['name(…) body (already walked)']` — describing a
  // body that was never read. The caller reads that as "answered", so an
  // identifier NO route can explain came out as a clean resolution:
  //
  //   resolveNameInModule(src, 'smuggledTargeted', { budget: { visited: new Set() } })
  //   // → { expressions: ["smuggledTargeted(…) body (already walked)"], unresolvable: [] }
  //
  // The guard's own contract is that an unexplained name is a blind spot, not a
  // pass, and this quietly inverted it. A memo may answer "what did this name
  // resolve to", never "have I heard of it" — so the mark goes in after the body
  // is found, and a name that was merely ASKED ABOUT is not marked at all.
  // Re-asking is cheap; answering from a failed lookup is the whole bug.
  const header = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${escapeRe(callName)}\\s*\\(`);
  const lines = source.split('\n');
  const startAt = lines.findIndex((l) => header.test(l));
  if (startAt === -1) {
    // Not a top-level function in this module: an import, a method, or a
    // binding the walk cannot see. `found: false` is what lets the caller
    // distinguish "this route does not apply" from "this route applied and the
    // name is unexplained" — without it every route-4 blind spot is
    // indistinguishable from a successful lookup that returned nothing.
    return {
      found: false,
      expressions: [],
      unresolvable: [`${callName} is not a top-level function here`],
    };
  }
  graph.visited.add(callName);
  // Collect the whole body by brace pairing from the header's opening brace.
  let depth = 0;
  let started = false;
  const body = [];
  for (let i = startAt; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth += 1; started = true; }
      else if (ch === '}') depth -= 1;
      body.push(ch);
    }
    if (started && depth === 0) break;
  }
  const text = body.join('');
  expressions.add(`${callName}(…) body`);
  // The body TEXT ITSELF is evidence before any name in it is resolved.
  //
  // P1-1, fourth revision, and it is the subtlest of them. Every earlier
  // revision followed identifiers and never asked what the body READS. A body
  // that folds a caller's targeted strings into the value it returns —
  //   for (const leak of (raw.__t11targetedStrings ?? [])) {
  //     normalized.queryVariants.push(leak);
  //   }
  // — names only `leak`, which the body itself binds, so the name route
  // correctly answered "local, nothing more to resolve" and the targeted
  // surface never entered the evidence at all. Following names is not enough;
  // `raw.__t11targetedStrings` has to be visible, and it is a member read, not a
  // name binding. So the body text is checked directly, and the name walk runs
  // on top of it for the bindings that reach further.
  expressions.add(text);
  const pending = new Set();
  for (const ident of provenanceIdentifiersIn(text)) {
    if (RESERVED.has(ident) || PROVENANCE_VOCABULARY.has(ident)) continue;
    // The function's own name appears inside its body (recursion, or a
    // reference to itself in a string check). Following it would resolve to the
    // same function forever and report `name.name` as an unresolvable binding —
    // a false blind spot that trains the reader to ignore real ones.
    if (ident === callName) continue;
    const nested = resolveNameInModule(source, ident, { scope: text, budget: graph });
    for (const e of nested.expressions) expressions.add(e);
    for (const n of nested.unresolvable) unresolvable.add(`${callName}.${n}`);
    // PENDING IMPORTS PROPAGATE OUT OF A BODY — the fourth review's P1-1.
    //
    // This loop used to read only `expressions` and `unresolvable`, so a name
    // the origin module itself imports was dropped: it entered no expression
    // list, no unresolvable list, and nothing obliged anyone to follow it. The
    // fourth review built exactly that and stayed 22/22 green — a helper
    // (`zz-t11-bypass-helper.mjs`) holding `targetedPools` is not a violation,
    // not a blind spot, and not even a note. A pending import is a QUESTION, and
    // a question has to travel up to the one caller that can answer it.
    for (const name of nested.pendingImports ?? []) pending.add(name);
  }
  return {
    found: true,
    expressions: [...expressions],
    unresolvable: [...unresolvable],
    pendingImports: [...pending],
  };
}

/**
 * Explain ONE identifier by every route available, and report a blind spot only
 * when all of them fail.
 *
 * WHY THIS HAD TO BECOME ONE FUNCTION (P1-1, third revision)
 * -------------------------------------------------------
 * The first attempt put the routing in the test's `followInto` and had
 * `resolveCallReturnProvenance` do its own nested `resolveTrustSetProvenance`
 * walk. Two recursions over two vocabularies, each unaware of the other, and
 * they contaminated each other: the caller filtered keywords, the body route
 * did not, and a body-local `const issues` was reported as a blind spot in one
 * route and as a binding in the other. `isPlainObject` surfaced three times in
 * one message, and `followInto` was then re-feeding the body route's own output
 * (`plan-contract.mjs validatePlanInput.isPlainObject`) back in as if it were a
 * new expression.
 *
 * So the routes live here, once. Order matters and is not arbitrary:
 *
 *   1. the identifier's own SCOPE first — if the text that introduced it binds
 *      it, it is a local, and a local is a complete answer, not a question;
 *   2. a module-level binding (intermediate variable, parameter, alias,
 *      `.add()` mutation);
 *   3. a top-level function declared in the same module — the value comes from
 *      its body, so the body is the evidence;
 *   4. only then, the caller's cross-module route, which needs `libDir`.
 *
 * `scope` is the text the name was read from — the caller's expression for a
 * top-level read, the callee's body for a name read inside a body. It is what
 * makes a local binding resolvable without inventing a scope analyser.
 *
 * @param {string} source module source
 * @param {string} ident the identifier to explain
 * @param {{scope?: string, budget?: object}} [opts] `scope` = text that
 *   introduced `ident`; `budget` = the shared call-graph budget
 * @returns {{expressions: string[], unresolvable: string[]}}
 */
export function resolveNameInModule(source, ident, { scope = '', budget } = {}) {
  // Route 1 — a local of the scope that introduced this name.
  if (scope !== '' && scopeBoundNames(scope).has(ident)) {
    return { expressions: [`local \`${ident}\``], unresolvable: [] };
  }
  // Route 2 — a module-level binding.
  //
  // A binding ROUTE that found expressions is authoritative even if it also
  // carries unresolvables for names IT walked into. Those nested names are the
  // route's own report and are propagated; the ident itself is answered, and
  // re-reporting it here would double-count the same blind spot once per hop.
  const bound = resolveTrustSetProvenance(source, ident, { budget });
  if (bound.expressions.length > 0) {
    // PENDING IMPORTS ARE REPORTED ALONGSIDE SUBSTANTIVE EXPRESSIONS, never
    // instead of them.
    //
    // The first attempt returned early whenever there was any substantive
    // expression, on the reasoning that the name was therefore answered. That
    // reasoning is wrong: `validated = validatePlanInput(plan)` also walks
    // `isPlainObject`, whose body yields real expressions, so `validated`
    // returned eight of them and the pending `validatePlanInput` import was
    // dropped on the floor. A targeted string folded into `plan-contract.mjs`
    // therefore stayed invisible — the route that exists to catch exactly that
    // was never entered. Both halves of the answer have to travel together.
    const pending = pendingNames(bound.expressions);
    if (pending.length > 0) {
      return {
        expressions: bound.expressions,
        unresolvable: bound.unresolvable,
        pendingImports: pending,
      };
    }
    return { expressions: bound.expressions, unresolvable: bound.unresolvable };
  }
  // Route 3 — a top-level function here; its body's reads are the evidence.
  const local = resolveCallReturnProvenance(source, ident, { budget });
  if (local.found) {
    // The body may itself read an imported name, so the same "pending travels
    // with the answer" rule applies one level deeper — and the names come from
    // the body's own `pendingImports`, not from a re-scan of its expression
    // list, because a body-level pending import was never written into any
    // expression in the first place.
    const pending = local.pendingImports ?? [];
    return pending.length > 0
      ? { expressions: local.expressions, unresolvable: local.unresolvable, pendingImports: pending }
      : { expressions: local.expressions, unresolvable: local.unresolvable };
  }
  // Route 4 — nothing in THIS module explains it.
  //
  // A name nothing here explains is not automatically a blind spot: it may be
  // imported from another `lib/` module, which this function has no `libDir` to
  // reach. Reporting those as blind spots made a follow-the-callee-body route
  // unusable — `isPlanBoundarySafeString` calls `isBoundarySafeString` in
  // `rrf.mjs`, so the whole `plan-contract.mjs` subtree came back as dozens of
  // unresolvables (`password`, `token`, `Users`, `home` — the internals of a
  // regex and of a comment in a file this walk cannot see). A guard that reports
  // the internals of a neighbouring module as blind spots is a guard whose real
  // findings get waived, so an import-shaped name is handed to the caller as a
  // pending import instead.
  if (isLibRelativeImport(source, ident)) {
    // NO expression here on purpose. The marker travels in `pendingImports`, so
    // the caller — the only holder of `libDir` — is obliged to take the hop. An
    // expression in this list would satisfy the caller's `length > 0` check and
    // be treated as answered, and this route exists precisely because that
    // short-circuit is what hid a targeted string in `plan-contract.mjs`.
    return { expressions: [], unresolvable: [], pendingImports: [ident] };
  }
  return { expressions: [], unresolvable: [ident] };
}

/**
 * Prefix marking an expression as a `lib/`-relative import whose body is one
 * hop away, rather than a resolved expression.
 *
 * The distinction is load-bearing. Every route in the walk short-circuits on
 * `expressions.length > 0`, so an ordinary expression recorded for an imported
 * function reads as "answered" and the caller never follows the import. Folding
 * a targeted string into `plan-contract.mjs`'s `validatePlanInput` stayed green
 * through exactly that path. A marker is non-empty (so it is not a blind spot)
 * yet excluded from "substantive" (so it cannot end the search).
 */
const IMPORT_PENDING_MARKER = '__pendingImport__';

/** The bare names behind a list of `IMPORT_PENDING_MARKER` expressions. */
function pendingNames(expressions) {
  return expressions
    .filter((e) => e.startsWith(IMPORT_PENDING_MARKER))
    .map((e) => e.slice(IMPORT_PENDING_MARKER.length));
}

/**
 * Whether `name` is bound to a `Set` anywhere in this source.
 *
 * The precondition for reading `fn(name, …)` as a write INTO `name`. A plan, a
 * pool, a decision object — all of them take first arguments, and none of them
 * is a set, so without this gate the argument-mutation rule invents blind spots
 * at every call site in the file rather than at the ones that mutate.
 */
function isSetCarrierIn(source, name) {
  return new RegExp(`\\b${escapeRe(name)}\\s*=\\s*new\\s+Set\\b`).test(source);
}

/**
 * Whether `name` is bound by a `lib/`-relative import statement in this source.
 *
 * A pure source question with no filesystem dependency, which is what lets the
 * binding walk distinguish "imported, therefore reachable by the caller that
 * has `libDir`" from "unknown, therefore a blind spot". A bare package import
 * (`from 'node:fs'`) is NOT one: there is no readable body, so it stays a blind
 * spot and the guard fails closed.
 *
 * BOTH QUOTE STYLES, and that is not a stylistic detail. Every regex here used
 * to spell the module path as `'…'`, which is invisible to
 * `import { x } from "./y.mjs"`. Double quotes are legal, Prettier-normalised
 * code routinely uses them, and the effect of not matching is the worst kind:
 * a name the guard cannot see declared as an import is reported as an
 * UNRESOLVABLE, and an unresolvable in this walk is a blind spot rather than a
 * violation — so a two-hop widening written with double quotes read as
 * "nothing found" and the site looked clean. Found while building the C3b
 * multi-module fixture, which is the only reason it surfaced at all.
 */
function isLibRelativeImport(source, name) {
  const re = /import\s*\{[\s\S]*?\}\s*from\s*(['"])\.[^'"]*\1/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const names = /\{([\s\S]*?)\}/.exec(m[0])?.[1] ?? '';
    for (const entry of names.split(',')) {
      const bound = entry.trim().split(/\s+as\s+/).pop().trim();
      if (bound === name) return true;
    }
  }
  return false;
}

/**
 * Every name BOUND inside one piece of source: declarations, `for` heads,
 * destructuring, parameters, and arrow-callback parameters.
 *
 * A name in here is defined by this text. Resolving it further is not possible
 * and not necessary — the question "where did this come from" is answered by
 * the text itself. This is the difference between a blind spot and a local, and
 * conflating the two is what turned a real guard into noise.
 */
function scopeBoundNames(scope) {
  const names = new Set();
  const add = (raw) => {
    for (const piece of String(raw).split(',')) {
      // `{ a: b }` binds `b`; `[a, b]` binds each; `= default` is not a name.
      const n = piece.split(':').pop().split('=')[0].replace(/[{}[\]]/g, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  };
  for (const list of functionParameterLists(scope)) for (const p of list) add(p);
  for (const m of scope.matchAll(/\b(?:const|let|var)\s+([^=;]+)/g)) add(m[1]);
  for (const m of scope.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([^;)]+)/g)) add(m[1]);
  for (const m of scope.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of scope.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  return names;
}

/**
 * The source expressions a call contributes when the callee is IMPORTED from
 * another `lib/` module — `validatePlanInput(plan)` in `retrieval.mjs`, whose
 * body lives in `plan-contract.mjs`.
 *
 * WHY THIS IS NEEDED (P1-1 residual)
 * ----------------------------------
 * The cross-module shape is the single most common form in this codebase: the
 * trust set is built from the output of a T04 plan-contract call, and that
 * function lives one module away. Resolving only the CALLING module reported
 * `validatePlanInput is not a top-level function here` — a blind spot for the
 * exact binding the F.3 boundary is written in terms of.
 *
 * The origin module is found through the import statement, not through
 * guessing, and only `lib/` relatives are followed: a bare package import has no
 * readable body here, and that stays `unresolvable` so the guard fails closed.
 *
 * @param {string} libDir absolute path to `lib/`
 * @param {string} file the module containing the call
 * @param {string} callName the called function's name
 * @returns {{expressions: string[], unresolvable: string[]}}
 */
export function resolveImportedCallReturnProvenance(libDir, file, callName, { budget } = {}) {
  const origin = importOriginOf(libDir, file, callName);
  if (origin === null) {
    return { found: false, expressions: [], unresolvable: [`${callName} is not readable in this module or any lib/ import`] };
  }
  const originSource = stripComments(readFileSync(path.join(libDir, origin), 'utf8'));
  // The budget is SHARED with the calling module's walk, and the visited key is
  // namespaced by origin module: `isPlainObject` exists in several `lib/`
  // modules, and treating them as one node would silently skip a real body.
  const graph = budget ?? { visited: new Set() };
  const scoped = { visited: new Set([...graph.visited].map((k) => `${origin}::${k}`)) };
  const viaOrigin = resolveCallReturnProvenance(originSource, callName, { budget: scoped });
  graph.visited.add(`${origin}::${callName}`);
  if (!viaOrigin.found) {
    return { found: false, expressions: [], unresolvable: [`${callName} is imported from ${origin} but has no top-level body there`] };
  }

  // THE CHAIN IS FOLLOWED TO THE END, NOT ONE LINK.
  //
  // P1-1, fourth review. `plan-contract.mjs` importing a helper that itself
  // imports the targeted surface is a TWO-link chain, and reading only the first
  // link reported the helper's name as nothing at all — no expression, no
  // unresolvable, no pending. The fourth review built exactly that and the
  // suite stayed 22/22 green.
  //
  // So every pending import the origin body declared is followed too, from the
  // ORIGIN module (that is where its import statements live — resolving it
  // against the original caller is what made the first attempt find nothing).
  // Depth is bounded by the shared call-graph budget, and a link that cannot be
  // resolved becomes an unresolvable, so the chain fails closed.
  const expressions = viaOrigin.expressions.map((e) => `${origin}: ${e}`);
  const unresolvable = viaOrigin.unresolvable.map((n) => `${origin} ${n}`);
  const seenChain = new Set([`${origin}::${callName}`]);

  const followChain = (moduleName, name, depth) => {
    if (depth > 6) {
      unresolvable.push(`${moduleName} ${name} (import chain depth 6 exceeded — walk truncated)`);
      return;
    }
    const key = `${moduleName}::${name}`;
    if (seenChain.has(key)) return;
    seenChain.add(key);
    const nextSource = stripComments(readFileSync(path.join(libDir, moduleName), 'utf8'));
    const viaNext = resolveCallReturnProvenance(nextSource, name, { budget: graph });
    if (!viaNext.found) {
      unresolvable.push(`${moduleName} ${name} is imported but has no top-level body there`);
      return;
    }
    for (const e of viaNext.expressions) expressions.push(`${moduleName}: ${e}`);
    for (const n of viaNext.unresolvable) unresolvable.push(`${moduleName} ${n}`);
    for (const next of viaNext.pendingImports ?? []) followChain(moduleName, next, depth + 1);
  };

  for (const next of viaOrigin.pendingImports ?? []) {
    const nextOrigin = importOriginOf(libDir, origin, next);
    if (nextOrigin === null) {
      unresolvable.push(`${origin} ${next} is not readable in ${origin} or any lib/ import`);
      continue;
    }
    followChain(nextOrigin, next, 1);
  }

  return { found: true, expressions, unresolvable };
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

/**
 * A DESTRUCTURED-ALIAS binding: `const { plan, seam } = options;`.
 *
 * This is not an exotic form — it is how `runMultiQueryRetrieval` binds its
 * inputs, and its trust set is written as `validated.plan.queryVariants`. A
 * walk that stops at the alias reports `plan` and `validated` as unresolvable
 * and drowns the guard in vocabulary noise, which is how a real signal gets
 * lost among dozens of harmless ones. The alias contributes the SOURCE it is
 * destructured from, so the walk continues from `options` instead of stopping.
 */
function destructuredAliasBindingsOf(source, name) {
  const out = [];
  const decl = new RegExp(
    `\\b(?:const|let|var)\\s*\\{([^{}]*)\\}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*;`,
    'g',
  );
  for (let m = decl.exec(source); m !== null; m = decl.exec(source)) {
    const members = m[1].split(',').map((s) => s.trim());
    for (const member of members) {
      // `planHash: expectedPlanHash` binds `expectedPlanHash`, not `planHash`.
      const bound = member.includes(':') ? member.split(':').pop().trim() : member;
      const withDefault = bound.split('=')[0].trim();
      if (withDefault !== name) continue;
      out.push({ kind: 'destructure', expr: `${m[2]}.${withDefault}` });
    }
  }
  return out;
}

/**
 * Bindings created by a `for…of` / `for…in` HEAD: `for (const c of candidates)`.
 *
 * WHY THIS HAD TO BE ADDED (found while closing the fourth review's P1s)
 * ---------------------------------------------------------------------
 * The fourth review's two findings were both about POSITION — a call return
 * value, an `Object.assign` first argument. Both are now closed. Mechanically
 * probing the guard afterwards for a THIRD shape turned up one that no
 * position-based rule can reach, and it is the same class of hole the mutation
 * rules were added for, wearing a different costume:
 *
 *     const trusted = new Set(plan.queryVariants);
 *     for (const c of candidates) trusted.add(c.rawQuery);
 *
 * `candidates` is `mergeCandidates(accumulatedPool, targetedPools)` — a merge
 * whose output is *mostly* legitimate, so it is not a targeted surface by name
 * and the closed vocabulary has nothing to match. `c` is a loop binding, and
 * `bindingsOf` had no rule for loop bindings at all, so `c` resolved to nothing,
 * `candidates` was never visited, and the targeted bytes entered the trust set
 * with the suite at 22/22 green. The alias is a rename — the weakest possible
 * adversary — which is exactly why a name-matched guard must not be the only
 * thing standing between a targeted string and the trust set.
 *
 * The loop head IS a binding, so it belongs here with the other binding rules:
 * it contributes the ITERATED collection, and the existing recursive walk
 * carries it from there. Note this is deliberately NOT gated on the name being
 * a Set: the loop may be feeding any downstream use of the trust set, and a
 * gate would reintroduce the position-blindness that made the fourth review's
 * P1-2 possible.
 *
 * SCOPE, NOT JUST POSITION. The fifth review's P2 was right that a bare
 * "any loop binding of this name, anywhere" rule conflates two different
 * variables that share a spelling:
 *
 *     for (const pool of targetedPools) { … }      // `pool` HERE is a loop var
 *     const trusted = new Set(pool.queryVariants); // `pool` HERE is the param
 *
 * The trust set reads the SECOND `pool` and the loop has nothing to do with
 * it. Position alone does not separate them — the read comes AFTER the loop
 * head, so a "is it referenced later?" test still fires. What separates them
 * is that a `for (const x of …)` head binds `x` for the LOOP BODY only, and
 * the loop body is the braced block that follows. A reference outside that
 * block is a different binding of the same name.
 *
 * So a loop head is reported only when the name is also read INSIDE the loop
 * body. That is the shape the rule exists for — `for (const c of candidates)
 * trusted.add(c.rawQuery)` — and it is exactly the shape that makes the
 * iterated collection a real input to the trust set.
 */
function loopHeadBindingsOf(source, name) {
  const out = [];
  // `for (const c of candidates)` / `for (let x in obj)` — the declared name
  // may carry a keyword prefix and may be a destructuring pattern, in which case
  // the member names are what get bound.
  const decl = new RegExp(
    `\\bfor\\s*\\(\\s*(?:const|let|var)\\s+([^;)]*?)\\s+(?:of|in)\\s+([^;)]+?)\\s*\\)\\s*\\{`,
    'g',
  );
  const usesName = new RegExp(`\\b${escapeRe(name)}\\b`);
  for (let m = decl.exec(source); m !== null; m = decl.exec(source)) {
    const pattern = m[1].trim();
    const iterated = m[2].trim();
    // The loop BODY is the block this head opens. Only a read inside it is
    // governed by this binding.
    const body = readBraceBlock(source, m.index + m[0].length - 1);
    if (body === null || !usesName.test(body)) continue;
    const inner = /^\{([\s\S]*)\}$/.exec(pattern);
    if (inner) {
      // `for (const { rawQuery } of candidates)` binds the MEMBER names, and
      // the iterated collection is what carries the data either way.
      for (const member of inner[1].split(',')) {
        const bound = (member.includes(':') ? member.split(':').pop() : member).split('=')[0].trim();
        if (bound === name) out.push({ kind: 'loop-head', expr: iterated });
      }
      continue;
    }
    if (pattern === name) out.push({ kind: 'loop-head', expr: iterated });
  }
  return out;
}

/** The text inside the `{…}` block whose opening brace is at `open`, or null. */
function readBraceBlock(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * The RECEIVER of a host call whose CALLBACK mutates the trust set.
 *
 * WHY THIS HAD TO BE ADDED (fifth review, P1-1)
 * ---------------------------------------------
 * `loopHeadBindingsOf` connects a loop variable to the collection it iterates.
 * Nothing connected a CALLBACK PARAMETER to the value being iterated, and the
 * idiomatic form of the same widening is a method call, not a `for` loop:
 *
 *     targetedPools.forEach((p) => p.channels.forEach((c) => trusted.add(c.channel.query)));
 *
 * The receiver rule above did capture `c.channel.query` — and `c` is a
 * callback parameter, so it correctly resolves to "local, nothing further" and
 * the walk stops. `targetedPools` is the RECEIVER of the outer `.forEach`, and
 * no rule read it, so the targeted surface never entered the evidence and the
 * suite stayed green. Note this one needs no rename and no indirection: the
 * targeted name is spelled out in the source, and the guard still missed it,
 * which is a worse failure than the alias holes because there is nothing an
 * author has to avoid.
 *
 * So: when a mutation of the trust set appears inside an arrow function or
 * function expression that is an ARGUMENT to a call, the call's receiver is a
 * binding of the data that reaches the trust set, and it is followed like any
 * other. The mutation must be inside the callback for this to fire — a
 * `targetedPools.forEach(…)` that never touches the trust set contributes
 * nothing, and matching every call in the file regardless would drown the
 * walk in the same 101-expression noise the argument rule had to be gated
 * against.
 *
 * @param {string} source module source
 * @param {string} name the trust-set variable
 * @returns {Array<{kind: string, expr: string}>}
 */
function callbackReceiverBindingsOf(source, name) {
  const out = [];
  const mutation = new RegExp(`\\b${escapeRe(name)}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`);
  // CHEAP GATE FIRST, THEN THE EXPENSIVE SCAN. `bindingsOf` is called once per
  // distinct name the walk reaches, and each call re-scans the whole module with
  // every rule in this file. Adding one rule that scans unconditionally turned
  // that into a per-name full-module rescan, and the walk — which is
  // transitively recursive — multiplied it: the fifth review's own bypass hung
  // the process with a heap OOM (exit 137) before it could report anything.
  //
  // So this rule asks the cheapest possible question first — does the module
  // contain ANY method call on this name at all? — and only then pays for the
  // statement scan. A name that is never a receiver of anything costs one
  // substring test.
  if (!mutation.test(source)) return out;

  // A STATEMENT that mutates the trust set inside a callback, together with the
  // full receiver chain of the host call it belongs to.
  //
  // Chaining is the whole difficulty. `targetedPools.map(p => p.channels)
  // .forEach(cs => …trusted.add(…))` is one statement, and the mutation sits in
  // the LAST link's argument while the targeted name is in the FIRST link's
  // receiver. Matching per-link — which is what the first version did, and what
  // the first version of the fifth review's own bypass exploited — finds the
  // `.map` link with no mutation in its arguments and the `.forEach` link with
  // a mutation and a receiver that is `)` rather than a name, so neither fires
  // and the statement reads as clean. So the chain is walked as a unit and its
  // ROOT receiver is what gets reported.
  //
  // The scan is bounded to the MUTATING STATEMENT rather than the whole module:
  // once the cheap gate has said a mutation exists, only the text around that
  // mutation can contain the callback it sits in, and slicing to the enclosing
  // statement keeps this rule's cost independent of module size.
  const at = source.search(mutation);
  if (at === -1) return out;
  const lineStart = source.lastIndexOf('\n', at) + 1;
  let lineEnd = source.indexOf('\n', at);
  if (lineEnd === -1) lineEnd = source.length;
  const text = source.slice(lineStart, lineEnd);
  if (!/\(\s*[A-Za-z_$][\w$]*\s*\)\s*=>/.test(text) && !/\bfunction\s*\(/.test(text)) return out;
  for (const receiver of methodChainRootsOf(text)) {
    // A receiver that IS the trust set is the mutation's own target, not a
    // source of data for it — following it would be a self-loop.
    //
    // The comparison is textual because the receiver may now be an EXPRESSION
    // (`[...targetedPools]`, `plan.queryVariants`), so an exact match is the
    // only honest test. A receiver that merely CONTAINS the name is a different
    // thing and must be reported.
    if (receiver === name || receiver === `${name}.`) continue;
    out.push({ kind: 'callback-receiver', expr: receiver });
  }
  return out;
}

/**
 * The ROOT receiver of every method chain in one statement.
 *
 *     targetedPools.map(f).forEach(g)   ->  ['targetedPools']
 *     rows.filter(f).forEach(g)          ->  ['rows']
 *
 * A chain is a run of `.name(` links; the receiver of the first link is the
 * only name the whole chain's data flows from, so it is the only one worth
 * following. Returns every chain's root in the text, so a statement carrying
 * two independent chains contributes both.
 *
 * @param {string} text one statement
 * @returns {string[]}
 */
function methodChainRootsOf(text) {
  const roots = [];
  // A chain link: an identifier followed by `.name(`.
  //
  // THE `g` FLAG IS LOAD-BEARING, and its absence is what hung this function
  // at exit 137 through two rewrites. Without `g`, `RegExp.prototype.exec`
  // IGNORES `lastIndex` and restarts at 0 on every call, so the loop kept
  // re-matching the first link forever, pushing to `roots` without bound until
  // the heap died. With `g`, `lastIndex` is the scan position and the loop
  // advances monotonically.
  //
  // AND IT IS NOT SUFFICIENT, which the sixth review established by
  // construction. A chain's root is not always a bare identifier:
  //
  //     [...targetedPools].forEach(f)        — root is an array literal
  //     [].concat(targetedPools).forEach(f)  — root is a call, not a name
  //     plan.queryVariants.concat(x).forEach — root is a MEMBER expression
  //
  // Requiring `IDENT.method(` skipped all three, so a targeted collection
  // wrapped in any of the most ordinary adapters was invisible again. The rule
  // now takes the receiver as TEXT — whatever precedes the first `.name(` of a
  // chain, however it is spelled — and hands the walk a slice to work on. That
  // also fixes the member-expression case the same review flagged as a false
  // positive: `plan.queryVariants.concat(…)` now yields `plan.queryVariants`
  // rather than the property name `queryVariants` on its own.
  const link = /\.\s*[A-Za-z_$][\w$]*\s*\(/g;
  let depth = 0;
  let scannedTo = 0;
  // ONE ROOT PER CHAIN, decided by whether this link OPENS a chain or continues
  // one. Without that distinction every link in a chain re-reported the whole
  // text before it, so `a.map(f).forEach(g)` produced the receiver for `.map`
  // AND again for `.forEach` — this time containing the callback body, which is
  // noise the walk then had to resolve. A chain's data comes from its first
  // link's receiver; later links operate on that result, not on a new source.
  let chainOpen = true;
  while (scannedTo <= text.length) {
    const ch = text[scannedTo];
    if (ch === '(' || ch === '[') { depth += 1; scannedTo += 1; continue; }
    if (ch === ')' || ch === ']') { depth -= 1; scannedTo += 1; continue; }
    if (ch === ',' || ch === ';') { chainOpen = true; scannedTo += 1; continue; }
    if (depth !== 0) { scannedTo += 1; continue; }
    link.lastIndex = scannedTo;
    const m = link.exec(text);
    if (m === null) break;
    const receiver = text.slice(scannedTo, m.index).trim();
    if (chainOpen) {
      // The receiver is everything from the start of this chain up to the dot,
      // however it is spelled — a bare name, a member expression, an array
      // literal or a call.
      if (receiver !== '') roots.push(receiver);
      chainOpen = false;
    }
    // A literal root carries no data, so the chain's actual source is in the
    // FIRST LINK'S ARGUMENTS: `[].concat(targetedPools).forEach(f)` and
    // `Object.assign([], targetedPools).forEach(f)` both put the targeted
    // collection there, and reporting `[]` as the receiver finds nothing. This
    // is not a trick: an empty literal as the head of a chain is the standard
    // way to write "start a fresh collection", so the arguments are where the
    // data has to be.
    if (/^[[({]\s*[}\])]?$/.test(receiver)) {
      const args = readCallArguments(text, m.index + m[0].length - 1);
      if (args !== null) {
        for (const arg of splitTopLevelMembers(args)) {
          const t = arg.trim();
          if (t !== '') roots.push(t);
        }
      }
    }
    // Continue after this link's arguments; the depth counter returns to zero
    // on the matching `)`, and the next `.name(` at depth 0 continues the chain.
    scannedTo = m.index + m[0].length;
  }
  return roots;
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
export function provenanceIdentifiersIn(expr) {
  const stripped = String(expr)
    .replace(/\.\.\.([A-Za-z_$][\w$]*)/g, `${SPREAD_MARKER}$1`)
    // Drop string literals so a targeted-looking word inside prose is not a hit.
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    // Drop REGEX LITERALS, which are neither code nor data.
    //
    // `plan-contract.mjs` carries `CREDENTIAL_SHAPE`, a regex whose alternation
    // spells out `password|passwd|secret|token|z_c0|api[_-]?key|cookie|session`.
    // Those are the literal characters a credential looks like, not identifiers
    // any binding provides, and the walk reported every one of them as a blind
    // spot: five findings on the F.3 boundary's own line, all of them words
    // inside a pattern. Stripping regex literals is what makes `unresolvable`
    // mean a name again.
    //
    // The character class excludes an unescaped `/` so the `[/]` in a character
    // class does not terminate the literal early.
    .replace(/(?:^|[=(,:[!&|?{};\n]\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g, (m) => m.replace(/[^\n]/g, ' '))
    // Drop ARROW BODIES: what an expression reads is decided by the expression,
    // not by what a callback it happens to contain reads.
    .replace(/\(([^()]*)\)\s*=>/g, '()=>')
    // Drop OBJECT-LITERAL KEYS, which are names the code DEFINES, not names it
    // reads.
    //
    // The sixth review surfaced this, and it was invisible until then for a
    // reason worth recording: the shared call-graph budget used to mark a name
    // as visited even when the body lookup had FAILED, so a second route asking
    // about the same name got back "already walked" and the name was never
    // reported. `plan-contract.mjs`'s `validatePlanInput` builds
    // `const normalized = { schemaVersion: PLAN_SCHEMA_VERSION }`, and
    // `schemaVersion` — a KEY — came out as an unresolvable name on the F.3
    // boundary's own line. Fixing the budget restored the honest report; this
    // makes the report CORRECT, because a key is not an input.
    //
    // Member access is already handled below (`a.normalizedQuery` -> `a`); this
    // is the sibling case, `key: value` inside a literal. Both quoted and bare
    // keys are covered, and the trailing space keeps `key` out of the match so
    // the VALUE is still walked.
    .replace(/([{,]\s*)(?:'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)\s*:(?!:)/g, '$1:')
    // Drop property names: `a.normalizedQuery` -> `a`.
    .replace(/\.\s*[A-Za-z_$][\w$]*/g, '.');
  return [...stripped.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((m) => m[0]);
}

/** Marker prefix `provenanceIdentifiersIn` uses to keep a spread read walkable. */
const SPREAD_MARKER = '__p2aT11Spread__';

const RESERVED = new Set([
  'new', 'Set', 'Array', 'Object', 'String', 'Number', 'Boolean', 'typeof',
  'instanceof', 'true', 'false', 'null', 'undefined', 'if', 'else', 'return',
  'const', 'let', 'var', 'function', 'length', 'flatMap', 'map', 'filter',
  'isArray', 'join', 'concat', 'push', 'slice', 'from', 'of', 'keys', 'values',
]);

/**
 * Language and library vocabulary that is never a trust input.
 *
 * P1-1 REQUIRED THIS, AND IT HAD TO LIVE HERE. Once every shape's identifiers
 * are followed transitively — which is what closing the inline-expression
 * bypass demanded — the walk also reaches `new`, `Set`, `Array`, `for`, `const`
 * and the like, and each would be reported as an unresolvable binding. A guard
 * that reports fifty pieces of vocabulary as blind spots trains its reader to
 * ignore it, and the next real blind spot goes unread. Filtering the vocabulary
 * keeps `unresolvable` meaning exactly one thing: a name the module cannot
 * account for, which is a genuine blind spot.
 *
 * It is exported and used from BOTH the caller's `followInto` and this
 * module's own `resolveCallReturnProvenance`. The cross-module route reads a
 * whole exported function body — `validatePlanInput` alone contains `for`,
 * `const`, `raw`, `issues`, `key`, `path`, `message`, `fail` — so filtering
 * only at the call site left the body route as a noise machine.
 */
const PROVENANCE_VOCABULARY = new Set([
  'new', 'Set', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Map',
  'Promise', 'Symbol', 'JSON', 'Math', 'Error', 'TypeError', 'globalThis',
  'isArray', 'from', 'of', 'keys', 'values', 'entries', 'length', 'flat',
  'flatMap', 'map', 'filter', 'reduce', 'forEach', 'some', 'every', 'find',
  'join', 'concat', 'push', 'pop', 'slice', 'splice', 'includes', 'indexOf',
  'has', 'get', 'set', 'add', 'delete', 'clear', 'typeof', 'instanceof',
  'void', 'in', 'true', 'false', 'null', 'undefined', 'this',
  'isNaN', 'parseInt', 'parseFloat', 'structuredClone', 'assign', 'freeze',
  'create', 'defineProperty', 'NaN', 'Infinity',
  // Control-flow and declaration keywords. These reach the walk the moment a
  // callee BODY is read rather than a single expression, and none of them is a
  // value a trust set can be fed from.
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'const', 'let', 'var', 'function', 'return', 'await', 'async', 'class',
  'try', 'catch', 'finally', 'throw', 'default', 'yield', 'static', 'export',
  // Common local aliases of literals, so a body that builds a message or a
  // key list is not read as a trust input.
  'key', 'path', 'message', 'issues', 'issue', 'reason', 'ok', 'result',
  // Node built-in module namespaces. `import fs from 'node:fs'` makes `fs` a
  // binding whose value is a module object — never a string a trust set could
  // be fed from, and its absence as a lib/ relative import is not a blind spot.
  'fs', 'node', 'util', 'crypto', 'os', 'url', 'buffer', 'events', 'stream',
  'assert', 'child_process', 'zlib', 'readline', 'timers', 'process',
  // The trust set's own MEMBER NAME. In
  // `assertArtifactSafe(x, { trustedPlanStrings: trusted })` this is the name OF
  // the slot, not a variable holding it, and treating it as a binding drags the
  // enclosing function's entire call graph into the walk
  // (`trustedPlanStrings.buildCandidateGroups…`).
  'trustedPlanStrings',
]);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
