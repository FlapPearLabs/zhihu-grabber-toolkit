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
function classifyAt(lines, idx, walkerNames = [WALKER_EXPORT]) {
  const line = lines[idx];
  // EVERY LOCAL SPELLING OF THE WALKER (r9 P2-2). The literal name is one of
  // them; a module that imports it as `safe` contributes that spelling too, so
  // `safe(pool, { trustedPlanStrings: … })` is a call site rather than no call at
  // all. Matching one hard-coded identifier is what made an aliased widening
  // invisible to the enumerator, and the enumerator is the only thing that would
  // have handed the call to C3.
  const nameRe = walkerNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const call = new RegExp(`\\b(?:${nameRe})\\s*\\(`).exec(line);
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

  // RECURSIVE, AND ALIAS-AWARE (r9 P2-2).
  //
  // Two shapes of NEW trust-set call site used to be invisible to this
  // enumerator, which is the only thing standing between a widening and no test
  // at all:
  //
  //   lib/targeted/new-widening.mjs                    — a subdirectory
  //   import { assertArtifactSafe as safe } from './rrf.mjs'; safe(pool, {…})
  //
  // `readdirSync(libDir).sort()` with a `statSync().isFile()` filter saw only the
  // top level, and `classifyAt` matched the literal name `assertArtifactSafe`, so
  // a call through a renamed binding produced no call site in any list. Both were
  // demonstrated on a synthetic tree: three new trust-set call sites introduced,
  // one enumerated.
  //
  // The walker is still identified by the module that DEFINES it rather than by
  // its local spelling, so an alias of the defining module is skipped exactly as
  // the definition itself is — an alias is still not a production call site, it
  // is the same function seen under another name.
  const walkerModule = readdirSync(libDir).find((e) => e === 'rrf.mjs') ?? 'rrf.mjs';

  for (const rel of mjsFilesUnder(libDir)) {
    const full = path.join(libDir, rel);
    const base = path.basename(rel);
    // rrf.mjs DEFINES the walker (and recurses internally). Definition and
    // internal recursion are not production call sites; every other module is.
    if (base === walkerModule) continue;

    const stripped = stripComments(readFileSync(full, 'utf8'));
    // Every LOCAL SPELLING the walker is bound to in this module. A module that
    // renames it on import gets the same treatment as one that does not.
    const walkerNames = localWalkerNames(stripped, walkerModule);
    const lines = stripped.split('\n');
    const calls = [];
    for (let i = 0; i < lines.length; i += 1) {
      const { kind, spanEnd, callText } = classifyAt(lines, i, walkerNames);
      if (kind === 'not-a-call') continue;
      calls.push({ file: rel, line: i + 1, text: lines[i].trim(), callText: callText ?? lines[i].trim(), kind });
      if (kind === 'call-trusted') trusted.push(calls[calls.length - 1]);
      else if (kind === 'call-untrusted') untrusted.push(calls[calls.length - 1]);
      else unparsed.push(calls[calls.length - 1]);
      // Skip the continuation lines of a multi-line call so the options object
      // cannot be re-counted as a second call site.
      if (spanEnd !== undefined && spanEnd > i) i = spanEnd;
    }
    if (calls.length > 0) files.push({ file: rel, calls });
  }

  return { files, trusted, untrusted, unparsed };
}

/**
 * Every `.mjs` file under `dir`, recursively, as paths relative to `dir`.
 * Sorted, so the enumeration order is deterministic and a failing assertion names
 * the same site on every run. `node_modules`, `fixtures` and dot-directories are
 * skipped: a vendored copy of the walker under `node_modules` is not a production
 * call site, and a fixture directory is test material rather than the surface
 * this guard claims to cover.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function mjsFilesUnder(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(dir, rel)).sort()) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'fixtures') continue;
      const childRel = rel === '' ? entry : `${rel}/${entry}`;
      const full = path.join(dir, childRel);
      if (statSync(full).isDirectory()) walk(childRel);
      else if (entry.endsWith('.mjs')) out.push(childRel);
    }
  };
  walk('');
  return out.sort();
}

/**
 * Every local name the walker is called by in this source.
 *
 * The literal name is always one of them; a module that imports it under another
 * name contributes that name too, so `classifyAt` recognises the call rather than
 * seeing no call at all. An import of a DIFFERENT module that happens to share the
 * walker's name is not a walker call, and the import check is what keeps the
 * walker's own definition site from being counted through its own recursion.
 *
 * @param {string} stripped module source, comments already stripped
 * @param {string} walkerModule the defining module's basename
 * @returns {string[]}
 */
function localWalkerNames(stripped, walkerModule) {
  // THE WALKER'S EXPORT NAME IS THE CONSTANT, NOT THE FILENAME (r9 P2-2).
  //
  // Reading the spelling off the filename produced `['rrf']`, which matches no
  // call anywhere — so a synthetic fixture that calls the walker without
  // importing it enumerated nothing at all, silently. The export name is the
  // thing callers actually write.
  const names = new Set([WALKER_EXPORT]);
  for (const m of stripped.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    if (path.basename(m[3]) !== walkerModule) continue;
    for (const entry of m[1].split(',')) {
      const t = entry.trim();
      if (t === '') continue;
      const parts = t.split(/\s+as\s+/).map((s) => s.trim());
      // ONLY the entry whose EXPORTED name is the walker. This module's import
      // block is a single multi-line list of a dozen rrf exports, and treating
      // every name in it as a spelling of the walker made `projectSafeJson(`,
      // `projectAllowedErrorCode(` and the rest read as walker calls — which is
      // how three unrelated lines of `retrieval.mjs` became `unparsed` call
      // sites and failed A1.
      //
      // An alias is the local spelling; without one the local name IS the export
      // name.
      if (parts[0] !== WALKER_EXPORT) continue;
      names.add(parts[parts.length - 1]);
    }
  }
  // r10 P1-3: LOCAL RE-BINDINGS. An import alias is the obvious way to rename
  // the walker; assigning it to another const is the one-liner way, and it
  // defeated the enumerator completely:
  //
  //   import { assertArtifactSafe } from './rrf.mjs';
  //   const walker = assertArtifactSafe;
  //   walker(pool, { trustedPlanStrings: trusted });
  //
  // produced ZERO call objects. Not "unparsed" — absent from every list, so A1's
  // file lists were unchanged, `unparsed` stayed empty, and C3/C3c never
  // iterated the site. The enumerator is the only thing between a widening and
  // no test at all, so that is a one-token refactor away from a green suite
  // covering nothing.
  //
  // The transitivity matters: an alias of an alias is still the walker, so the
  // new names are collected to a fixed point rather than in one pass.
  //
  // Destructure-from-namespace is included for the same reason:
  //   const { assertArtifactSafe: go } = rrf;   /   const { assertArtifactSafe } = rrf;
  for (const m of stripped.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*[;,]/g,
  )) {
    if (m[2] !== WALKER_EXPORT && !names.has(m[2])) continue;
    names.add(m[1]);
  }
  for (const m of stripped.matchAll(
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([A-Za-z_$][\w$]*)\s*[;,]/g,
  )) {
    for (const entry of m[1].split(',')) {
      const parts = entry.trim().split(/\s*:\s*/).map((s) => s.trim());
      if (parts.length !== 2) continue;
      if (parts[0] !== WALKER_EXPORT) continue;
      names.add(parts[1]);
    }
  }
  // r11 P1-2: THE ASSIGNMENT FORMS r10's ONE-SHAPE RULE DID NOT COVER.
  //
  // r10 added `const NAME = IDENT;`, which is the shape an author writes when
  // they are being explicit. Three shapes that are the SAME statement with the
  // declaration or the qualifier moved defeated it completely, and I verified
  // all three vanish from EVERY list — not "unparsed", ABSENT, so A1's
  // completeness check passed and C3 never iterated the site:
  //
  //   let w;  w = assertArtifactSafe;              // late-bound, declared first
  //   const w = rrf.assertArtifactSafe;            // read off a namespace
  //   const w = assertArtifactSafe.bind(null);     // partially applied
  //
  // Each one is a single-token edit away from the form that IS handled, which is
  // what makes this class of hole expensive: a guard that a reviewer can walk
  // around with punctuation has no floor, and the cost of the miss is a clean
  // C3 verdict rather than a reported blind spot.
  //
  // THE RIGHT-HAND SIDE IS ASKED OF `splitMemberAccess`, NOT OF A NEW REGEX.
  // That is deliberate and it is the reason this is not a fifth copy of the
  // member rules. The first attempt here spelled the walker path out as
  // `(?:IDENT\.)*assertArtifactSafe`, and that accepts `anything.at.all.
  // assertArtifactSafe` from any object in the module — including a property
  // with that name on an unrelated local, in a 4000-line file. The question
  // being asked is "is the last segment the walker's export name, however the
  // path spells it", and `splitMemberAccess` is already the single answer to
  // that, in every spelling, with the receiver recursion that a namespace read
  // genuinely has.
  //
  // `.bind(…)` is stripped BEFORE the question is asked, because a bound
  // function is still the walker: `assertArtifactSafe.bind(null)` reduces to
  // `assertArtifactSafe`, and asking the member rule about a call would report
  // nothing.
  //
  // THE BARE FORM IS A DIRECT COMPARISON, NOT A MEMBER SPLIT. I got this wrong
  // first and the probe caught it: `splitMemberAccess('assertArtifactSafe')`
  // returns NULL, because a bare name is not a member access — it is the shape
  // that answers "is this a name?" with "no", which is correct for its question.
  // So the member split alone silently dropped `const w = assertArtifactSafe`,
  // the very form r10 handled. Both halves are needed: a bare name is the
  // walker by direct comparison, and anything with a receiver is the walker when
  // its last segment is the export name.
  const walk = (rhs) => {
    const value = String(rhs).trim().replace(/\s*\.\s*bind\s*\([^()]*\)\s*$/, '');
    if (value === WALKER_EXPORT) return true;
    const split = splitMemberAccess(value);
    return split !== null && split.member === WALKER_EXPORT;
  };
  // ONE ASSIGNMENT LOOP, IN A FIXPOINT.
  //
  // WHY ONE, NOT TWO. The first version of this repair had a declaration-shaped
  // loop (`const w = …` with the keyword) and a bare-assignment loop (`w = …`),
  // and a mutation pass proved the declaration loop DEAD: disabling it left
  // every fixture green. The bare-assignment pattern
  //
  //   /(?<![.\w$])([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g
  //
  // already matches `const w = assertArtifactSafe;` (the keyword is simply not
  // part of the name capture). So the declaration loop was a second answer to
  // "is this local bound to the walker", and the mutation pass is what caught the
  // redundancy rather than a reading of the code. It stays removed.
  //
  // THE RIGHT-HAND SIDE IS THE AUTHORITY, NOT THE LOCAL (`names.has(m[1])`). The
  // first attempt gated on the LEFT, and it is unsatisfiable for the exact case
  // the finding is about: `let w;` contributes nothing to `names`, so `w` is never
  // a known walker name, and `w = assertArtifactSafe;` is never accepted. The
  // probe reported the site still ABSENT while the gate looked reasonable. A bare
  // assignment only ever CHANGES a binding, so the right-hand side is the whole
  // claim and the only thing that has to be checked.
  //
  // `names.has(rhs)` IS WHAT MAKES THE FIXPOINT LOAD-BEARING. A FORWARD reference
  // chain — `const w = a; const a = b; const b = assertArtifactSafe;` — resolves
  // one link per pass: pass 1 finds `b`, pass 2 finds `a`, pass 3 finds `w`. A
  // single pass (or no fixpoint) leaves `w` invisible, which is the precise
  // partial fix the probe reported. I verified that: with the fixpoint collapsed
  // to one pass the forward-chain fixture stays ABSENT from every list. The set
  // can only grow, so it terminates.
  for (;;) {
    const before = names.size;
    for (const m of stripped.matchAll(
      /(?<![.\w$])([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g,
    )) {
      const rhs = m[2].trim();
      if (walk(rhs) || names.has(rhs)) names.add(m[1]);
    }
    if (names.size === before) break;
  }
  return [...names];
}

/**
 * The name the trust walker is exported under.
 *
 * A constant because it is the join between two facts that live in different
 * places: the module that DEFINES the walker, and the name its callers bind.
 * Deriving one from the other (filename → export name, or the reverse) is what
 * produced both halves of the r9 P2-2 finding.
 */
const WALKER_EXPORT = 'assertArtifactSafe';

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

  // THE SCOPE EVERY BINDING QUERY IN THIS WALK IS ANSWERED AGAINST (r9 P2-1).
  //
  // A parameter binds a name inside its OWN function body and nowhere else, so
  // "is `carrier` a parameter?" is not a question about the module — it is a
  // question about the region the trust set is built in. The region is computed
  // ONCE, from the trust-set ROOT, and threaded through every binding rule:
  //
  //   function unrelated(carrier) { return String(carrier).length; }
  //   export function build(plan, pool) {
  //     const trusted = new Set(plan.queryVariants);
  //     trusted.add(carrier);              // <- nothing in `build` binds it
  //     assertArtifactSafe(pool, { trustedPlanStrings: trusted });
  //   }
  //
  // Every module-wide parameter scan reported `carrier` as bound — from a
  // function that has nothing to do with `build` — so it entered the EVIDENCE as
  // an expression and never became an unresolvable. That is worse than the
  // `locallyBoundNames` variant of the same defect: there a real blind spot was
  // deleted at the end, here one was never created. The control with the
  // parameter renamed was correctly reported, so this is a hole, not a limit.
  //
  // `null` means the trust set is built at MODULE level, where no top-level
  // function's parameters are in scope.
  const rootScope = enclosingTopLevelFunctionBody(source, rootVar);

  /** Every `X = <expr>;` binding of `name`, plus every `name.add(<expr>)`. */
  function bindingsOf(name) {
    const out = [];
    // Declarations and reassignments: const/let/var NAME = ...  |  NAME = ...
    //
    // MATCHED AGAINST A PARAMETER-BLANKED COPY (r7 P1-1 fallout). The regex has
    // no way to tell an assignment from a DEFAULT VALUE, so
    //
    //   function checkStringList(value, field, issues, { minEntries = 0 } = {}) {
    //     … issues.push({ path: field, message: 'must be an array' }); …
    //
    // matched `minEntries = 0 } = {}) { … issues.push({…})` as one assignment
    // whose right-hand side is a fragment of the function BODY. That fragment
    // became an evidence expression, and the identifier walk over it read the
    // words inside a string literal — `must`, `be`, `an`, `array` — as free
    // variables. The result was forty blind spots on the F.3 boundary's own
    // production line, every one of them a word out of an error message.
    //
    // So parameter lists are blanked (length preserved, so the match index still
    // addresses the original text) before the regex runs, and the expression is
    // sliced from the ORIGINAL source. The defect was never that the regex was
    // too loose about `=`; it was that it was reading a place where `=` means
    // something else entirely.
    const scannable = blankParameterLists(source);
    const assign = new RegExp(`\\b(?:const|let|var)?\\s*\\b${escapeRe(name)}\\s*=\\s*([^;]+);`, 'g');
    for (let m = assign.exec(scannable); m !== null; m = assign.exec(scannable)) {
      out.push({ kind: 'assign', expr: source.slice(m.index, m.index + m[0].length) });
    }
    // Function PARAMETER, including object destructuring:
    //   function augmentAccumulatedPool({ plan, targetedPools }) { … }
    // This is a real, complete binding with no in-file right-hand side to read,
    // so it resolves to the parameter name itself. Without it, every trust set
    // sourced from a destructured `plan` parameter is reported `unresolvable`
    // and C3 fails on honest production code — the guard must be strict about
    // real threats, not noisy about the shape the codebase actually uses.
    out.push(...parameterBindingsOf(source, name, rootScope));
    out.push(...destructuredAliasBindingsOf(source, name));
    // A `for…of` head is a binding too. Without this rule the loop variable
    // resolves to nothing at all, the name that was being iterated is never
    // visited, and a trust set widened through a loop reads as clean — see
    // `loopHeadBindingsOf` for the shape that stayed green through four
    // review rounds.
    out.push(...loopHeadBindingsOf(source, name));
    // DESTRUCTURING ASSIGNMENT: `({ NAME } = src)` and `[NAME] = src` (r9 P1-2).
    //
    // The assign regex above requires an IDENTIFIER immediately before `=`, so
    // `({ filter } = opts)` matched nothing at all and `filter` had no binding
    // anywhere. That is enough to turn the name into a blind spot, which fails
    // closed — but a blind spot is the guard saying "I cannot see this", and here
    // it CAN: the right-hand side is a plain name one token away. Reporting a
    // blind spot for a binding whose source is written in the same statement is
    // the noise-to-signal failure in its mildest form, and it is avoidable for
    // the cost of one rule.
    //
    // The object's SOURCE is the evidence, so `opts` is followed and the
    // targeted collection inside it is reached.
    for (const m of source.matchAll(/(^|[;{(])\s*\{([^{}]*)\}\s*=\s*(?!=)\s*([A-Za-z_$][\w$]*)/g)) {
      for (const piece of m[2].split(',')) {
        if (boundNameOf(piece) !== name) continue;
        out.push({ kind: 'destructure-assign', expr: `{ ${m[2].trim()} } = ${m[3]}` });
        out.push({ kind: 'destructure-source', expr: m[3] });
      }
    }
    for (const m of source.matchAll(/(^|[;{(,])\s*\[([^\][]*)\]\s*=\s*(?!=)\s*([A-Za-z_$][\w$]*)/g)) {
      for (const piece of m[2].split(',')) {
        if (boundNameOf(piece) !== name) continue;
        out.push({ kind: 'array-destructure-assign', expr: `[ ${m[2].trim()} ] = ${m[3]}` });
        out.push({ kind: 'destructure-source', expr: m[3] });
      }
    }
    // PROPERTY WRITE: `holder.trusted = new Set(targetedPools…)` (r9 P1-3).
    //
    // Every rule above tracks a NAME, and a member write is not one — the name
    // `trusted` here is the trust set's MEMBER, and the binding rule for it
    // correctly declines to treat a member as a variable. But the walk is handed
    // the member expression `holder.trusted` (that is what the call site reads),
    // and `provenanceIdentifiersIn` strips the property name, so the write's
    // right-hand side was never connected to anything:
    //
    //   const holder = {};
    //   holder.trusted = new Set(targetedPools.map((p) => p.channels[0].query));
    //   assertArtifactSafe(pool, { trustedPlanStrings: holder.trusted });
    //
    // read as clean. The non-property control WAS caught, which is what makes
    // this a hole rather than a limitation: `holder` is a real local, so the
    // walk resolved it, and `holder`'s only binding is the empty object — the
    // targeted collection sat in a statement nothing was following.
    //
    // So a write to `RECEIVER.PROPERTY` is a binding of the expression
    // `RECEIVER.PROPERTY`, and the receiver is additionally reported so the walk
    // keeps following the object it writes into. `holder = {}` resolving to
    // "an object literal, no data" is then the honest answer.
    out.push(...propertyWriteBindingsOf(source, name));

    // RECEIVER mutation: `NAME.add(x)`, `NAME.delete(x)`, `NAME.clear()`.
    // The name is the RECEIVER, which is unambiguous — nothing else can put
    // the trust set there — and it holds for any method name. That generality
    // is the point: the fourth review's P1-2 was a list containing only
    // `add|delete`, and a list of verbs survives only until the next verb.
    //
    // ARGUMENTS ARE READ BY BRACKET PAIRING, NOT BY `[^)]*` (r7 P1-1 fallout).
    // The character class stops at the FIRST `)`, which is not the end of the
    // argument list whenever an argument contains a call or an object literal:
    //
    //   issues.push({ path: issuePath, message: 'must be a string (no coercion)' });
    //
    // was cut to `{ path: issuePath, message: 'must be a string (no coercion` —
    // an unterminated string. The identifier walk over that fragment then read
    // the prose inside the message as free variables, and `checkStringLeaf`
    // reported `must`, `be`, `a`, `string`, `no`, `coercion` as blind spots on
    // the F.3 boundary's own production line. Pairing to the matching `)` is
    // what "the arguments" means; `[^)]*` was never that.
    const receiver = new RegExp(`\\b${escapeRe(name)}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`, 'g');
    for (let m = receiver.exec(source); m !== null; m = receiver.exec(source)) {
      const args = readCallArguments(source, m.index + m[0].length - 1);
      if (args !== null) {
        for (const arg of args) out.push({ kind: 'mutate', expr: arg });
      }
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
        `\\b[A-Za-z_$][\\w$]*\\s*\\(\\s*(?<![.\\w$])${escapeRe(name)}\\s*,`,
        'g',
      );
      for (let m = asFirstArg.exec(source); m !== null; m = asFirstArg.exec(source)) {
        // Bracket pairing again (r7 P1-1 fallout): `[^)]*` truncated the
        // remainder at the first `)` inside a nested call or object literal and
        // left an unterminated string, which the identifier walk read as prose.
        // `readCallArguments` already returns the arguments split on top-level
        // commas, so the trust set itself — which the pattern has just consumed
        // up to its comma — is element 0 and the written-into values follow.
        const args = readCallArguments(source, m.index + m[0].length - 1);
        if (args !== null) {
          for (const arg of args) {
            if (arg !== name) out.push({ kind: 'mutate', expr: arg });
          }
        }
      }
    }
    out.push(...callbackReceiverBindingsOf(source, name));
    return out;
  }

  function walk(rawName, depth) {
    // `_SPREAD_x` is the `identifiersIn` marker for a spread read of `x`; the
    // variable it names is `x`, so normalise before any binding lookup.
    const name = rawName.startsWith(SPREAD_MARKER) ? rawName.slice(SPREAD_MARKER.length) : rawName;
    // A DOTTED root is a MEMBER, not a variable, and the rules below all speak
    // about names (r9 P1-3).
    //
    // `holder.trusted` is the shape the call site reads when the trust set is
    // handed over as an object's field. Two things have to happen, and doing
    // either alone leaves the widening visible:
    //
    //   1. the member's own name is looked up, so `propertyWriteBindingsOf` can
    //      find `holder.trusted = …` and report its right-hand side;
    //   2. the RECEIVER is walked as a name, so `const holder = {}` resolves and
    //      `holder` is not reported as a blind spot in its own right.
    //
    // The property name alone is not a variable — `trustedPlanStrings` is the
    // member of every options literal in the codebase — so step 1 filters the
    // vocabulary the same way every other name is filtered.
    // A MEMBER is a name, in any of the spellings JS offers. r10 P1-2: the test
    // used to be `name.includes('.')`, which made the DOT load-bearing —
    // `holder['trusted']` came out as one segment, the member name was the whole
    // expression, and no property write could ever match it:
    //
    //   holder['trusted'] = new Set(tp.map(…));   // the actual write
    //   … { trustedPlanStrings: holder['trusted'] } // what the walk saw
    //
    // `splitMemberAccess` reduces every spelling to `{receiver, member}` with
    // the receiver left as a PATH, so `a.b.c` recurses on `a.b` exactly as it
    // always did. Only the separator was ever the problem.
    const memberSplit = splitMemberAccess(name);
    if (memberSplit !== null) {
      const { receiver, member } = memberSplit;
      if (depth > maxDepth) {
        unresolvable.add(`${name} (max depth ${maxDepth} exceeded)`);
        return;
      }
      const key = `member:${receiver}.${member}`;
      if (seen.has(key)) return;
      seen.add(key);
      // A3. MUTATION INTO THE MEMBER: `holder.trusted.add(x)`, `state.inner.trusted
      // .add(x)`, `holder["k"].trusted.add(x)`. The two routes above answer "what is
      // written to this member" and "who is the receiver"; neither answers "what is
      // MUTATED INTO it", and the assignment pattern structurally cannot — `…=(?!=)`
      // never matches `.add(`. So a set handed over as a member and then fed through
      // its own `.add()` was walked, resolved, and reported clean with the argument
      // that would have leaked never having entered the walk at all.
      //
      // The ASKED SPELLING is rebuilt here rather than reusing `name`, because
      // `name` may be `holder?.['trusted']` while the write is `holder.trusted.add(`.
      // Every spelling of one member is the same member, so the receiver path is
      // re-spelled in the CANONICAL dotted form and the property is matched as a
      // literal OR a quoted bracket — the four spellings `splitMemberAccess` accepts,
      // and no others.
      for (const arg of memberRouteMutationArguments(source, receiver, member)) {
        expressions.add(arg);
        for (const ident of provenanceIdentifiersIn(arg)) {
          if (isVocabularyOnly(source, ident)) continue;
          walk(ident, depth + 1);
        }
      }
      for (const { expr, receiver: writeReceiver } of propertyWriteBindingsOf(source, member)) {
        if (writeReceiver !== undefined && writeReceiver.replace(/\s+/g, '') !== receiver) continue;
        expressions.add(expr);
        for (const ident of provenanceIdentifiersIn(expr)) {
          if (isVocabularyOnly(source, ident)) continue;
          walk(ident, depth + 1);
        }
      }
      walk(receiver, depth + 1);
      return;
    }
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
        //
        // BUT A NAME IN THE VOCABULARY IS NOT AUTOMATICALLY VOCABULARY (r7
        // P1-1). This filter is SPELLING-based, and the vocabulary is full of
        // ordinary, legal JavaScript variable names: `map`, `filter`, `keys`,
        // `values`, `join`, `concat`, `push`, `slice`, `key`, `path`,
        // `message`, `result`, `ok`, `reason`, `issue`, `fs`, `process`,
        // `crypto`. So
        //
        //     const filter = targetedPools.flatMap((tp) => tp.channels.map(...));
        //     const trusted = new Set(filter);
        //
        // never followed `filter` at all: the walk saw a name it had been told
        // was a library method, concluded there was nothing to resolve, and
        // reported the trust set as clean. That is a fail-OPEN, and it is
        // reachable by a one-word RENAME of an otherwise honest binding — the
        // exact class of rename the provenance walk exists to survive. The
        // `fs`/`process`/`crypto` entries make it worse: a name the engine
        // itself declares "never a trust input" is a plausible carrier.
        //
        // The fix is to stop filtering by spelling and filter by POSITION. A
        // vocabulary word in method position (`.map(`, `.filter(`, `new Set(`)
        // is a method call and carries no data; the same word as a BARE name is
        // a variable that may hold anything. So a vocabulary word is skipped
        // only when the module has no binding that explains it — and this file
        // already has the function that answers that question, so a colliding
        // name is followed rather than dropped.
        if (isVocabularyOnly(source, ident)) continue;
        walk(ident, depth + 1);
      }
    }
  }

  // A1's newly walkable values retain the expression evidence r11 tested.
  // Keep the asked spelling: normalising a receiver is not resolving its value.
  if (isWalkableTrustSetName(rootVar)
      && !SINGLE_SEGMENT_FORM.test(normaliseMemberSpelling(rootVar))) {
    expressions.add(rootVar);
  }
  walk(rootVar, 0);

  // A name that is ONLY a locally-bound callback parameter (`(tp) => …`) is a
  // local, not an unresolvable trust input. The walk above recurses into such
  // names because it cannot see arrow-function scope; un-mark them here so a
  // lambda does not read as a blind spot.
  //
  // THE QUALIFIER MATTERS (r7 P1-1 fallout). The body route reports a nested
  // blind spot as `callee.name`, so by the time it reaches here the name is
  // `validatePlanInput.must`, not `must`. A bare `locallyBoundNames(source).has(
  // 'validatePlanInput.must')` is false, the entry survives, and the F.3
  // boundary's own production line fills with blind spots that have nothing to
  // do with any real threat — the noise-to-signal failure that makes a guard's
  // actual findings get waived. So the comparison is made on the LAST SEGMENT,
  // which is the name the walk was actually asking about.
  // THE SCOPE IS THE ENCLOSING FUNCTION, NOT THE MODULE (r9 P2-1).
  //
  // The rule this comment sits on removes an unresolvable when the name is a
  // callback parameter, which is right for `for (const tp of targetedPools)`
  // read inside the trust-set expression: the lambda's `tp` is a local, and
  // reporting it is the noise-to-signal failure. But the test it used was
  // `locallyBoundNames(source)` over the WHOLE MODULE, and a module-global set
  // contains a name bound by any function anywhere in the file:
  //
  //   function unrelated(carrier) { return String(carrier).length; }
  //   export function build(plan, pool) {
  //     const trusted = new Set(plan.queryVariants);
  //     trusted.add(carrier);          // <- a REAL blind spot: nothing binds it
  //     assertArtifactSafe(pool, { trustedPlanStrings: trusted });
  //   }
  //
  // `carrier` is bound — by a function that has nothing to do with `build` — so
  // the entry was deleted and the trust set read as clean. That is the guard's
  // one unforgivable inversion: a name it CANNOT account for reported as a name
  // it checked. The non-blind-spot control, with the parameter renamed, was
  // correctly reported, which is what makes this a hole and not a limitation.
  //
  // A lexical walk cannot compute real lexical scope, but it CAN compute
  // CONTAINMENT: the top-level function whose body holds the trust-set root is
  // the only region whose parameters can be in scope at the read. So the local
  // set is taken from that function's own text, and the module-level case (a
  // trust set built outside any function) falls back to ARROW parameters only,
  // since a module-level `function f(x)` cannot bind anything visible to a
  // sibling.
  const locals = locallyBoundNamesInScopeOf(source, rootVar);
  for (const name of [...unresolvable]) {
    const bare = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    if (locals.has(name) || locals.has(bare)) unresolvable.delete(name);
  }
  return { expressions: [...expressions], unresolvable: [...unresolvable] };
}

/**
 * The callback/loop parameter names that can be in scope at `rootVar`.
 *
 * When `rootVar` sits inside a top-level function, that function's parameters
 * are the only ones that can possibly be in scope, and a parameter of a
 * DIFFERENT top-level function is by definition not one of them. When the trust
 * set is built at module level, no `function` parameter is reachable and only
 * arrow callbacks count.
 *
 * @param {string} source module source
 * @param {string} rootVar the trust-set variable
 * @returns {Set<string>}
 */
function locallyBoundNamesInScopeOf(source, rootVar) {
  const body = enclosingTopLevelFunctionBody(source, rootVar);
  if (body !== null) return locallyBoundNames(body);
  // Module level: arrow callback parameters only. A top-level `function f(x)`
  // binds `x` inside `f` and nowhere else, so honouring it here would recreate
  // the module-global hole this scoping exists to close.
  const names = new Set();
  for (const arrow of source.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const p of arrow[1].split(',')) {
      const t = p.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(t)) names.add(t);
    }
  }
  for (const m of source.matchAll(/\(([A-Za-z_$][\w$]*)\)\s*=>/g)) names.add(m[1]);
  return names;
}

/**
 * The BODY TEXT of the top-level function containing `name`, or `null`.
 *
 * Top-level only, matching how every function in this codebase is declared, and
 * deliberate: a nested `function` expression's parameters cannot be scoped
 * reliably by a lexical walk, and admitting them would reopen the hole.
 *
 * @param {string} source module source
 * @param {string} name the identifier to locate
 * @returns {string|null}
 */
function enclosingTopLevelFunctionBody(source, name) {
  const header = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+[A-Za-z_$][\\w$]*\\s*\\(`,
    'gm',
  );
  const spans = [];
  for (let m = header.exec(source); m !== null; m = header.exec(source)) {
    const braceAt = source.indexOf('{', m.index);
    if (braceAt === -1) continue;
    let depth = 0;
    for (let i = braceAt; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { spans.push([braceAt + 1, i]); break; }
      }
    }
  }
  const at = source.search(new RegExp(`\\b${escapeRe(name)}\\b`));
  if (at === -1) return null;
  // The OUTERMATCH containing the name. Spans are pushed in source order and do
  // not nest at the top level, so the first hit is the only candidate.
  for (const [from, to] of spans) {
    if (at > from && at < to) return source.slice(from, to);
  }
  return null;
}

/**
 * Is this identifier REALLY vocabulary in this module, or is it a local that
 * merely shares a spelling with a library method?
 *
 * r7 P1-1. The walk used to skip a name whenever `RESERVED` or
 * `PROVENANCE_VOCABULARY` contained its SPELLING, which silently dropped any
 * honest binding named `filter`, `map`, `keys`, `result`, `fs` and the rest.
 * Those are all legal JavaScript variable names, so the guard could be defeated
 * by renaming one local — a fail-open, and the cheapest possible bypass.
 *
 * The distinction that actually matters is whether a BINDING explains the name:
 *
 *   - a name bound in this module (`const filter = …`, a parameter, a
 *     destructured property, a `for…of` head) is a VARIABLE and its value has to
 *     be read, whatever it is spelled;
 *   - a name with no binding is whatever the vocabulary says it is — a method
 *     in `.map(…)`, a keyword, a Node module namespace — and carries no data.
 *
 * So the binding query is the test, and it is the same query `bindingsOf` makes,
 * *not* a second, weaker spelling heuristic. A vocabulary word that happens to
 * be shadowed is followed; an unshadowed one is not.
 *
 * @param {string} source module source
 * @param {string} ident the identifier about to be followed
 * @returns {boolean} true when the name is genuinely vocabulary here
 *
 * EXPORTED (r10 P1-1). The test layer used to answer this question a second
 * time, by SPELLING alone:
 *
 *   if (PROVENANCE_VOCABULARY.has(ident)) continue;
 *
 * That is the original defect wearing a different hat. A widening written as
 * `const filter = targetedPools.map(...); new Set(filter)` is CAUGHT, because
 * the walk sees a real binding; the identical widening written INLINE as
 * `new Set(filter)` is SKIPPED, because the only question asked is whether the
 * name is spelled like a library method. Same bytes of attacker data, opposite
 * verdict, decided by formatting.
 *
 * And it is not an academic difference: two of the five frozen sites spell
 * their trust set inline (`coverage-state.mjs`, `coverage-final-integration.mjs`),
 * so the blind spelling was covering real production ground. The rule is now
 * asked ONCE, here, and both callers route through it.
 */
export function isVocabularyOnly(source, ident) {
  if (!RESERVED.has(ident) && !PROVENANCE_VOCABULARY.has(ident)) return false;
  // `trustedPlanStrings` is the trust set's MEMBER NAME, not a variable, and it
  // is in the vocabulary precisely so the enclosing call graph is not dragged in.
  // It is never a binding of its own, so the generic rule below would keep it
  // filtered — asserted here so that stays true if the vocabulary ever changes.
  if (ident === 'trustedPlanStrings') return true;
  return !hasBindingIn(source, ident);
}

/** True when this module binds `name` in any form the walk can explain. */
function hasBindingIn(source, name) {
  // NOT A SECOND, WEAKER SPELLING HEURISTIC (r9 P1-2). This function used to
  // re-derive "is this a binding?" from a handful of patterns, and `bindingsOf`
  // derived it from different ones. Two derivations of one question is two
  // answers waiting to disagree, and they did:
  //
  //   import { filter } from './helper.mjs';        — a binding; not recognised
  //   let filter; ({ filter } = opts);              — a binding; not recognised
  //
  // Both are real carriers of targeted bytes named with a vocabulary word, and
  // both read as "no binding here, so `filter` is just a library method" — the
  // walk skips the name entirely and the trust set comes back clean. The
  // non-vocabulary control (`gather`) was CAUGHT through the cross-module route,
  // which proves the engine can see the widening and that only the vocabulary
  // filter was hiding it.
  //
  // So the question is asked ONCE, here, and every caller routes through it.
  return bindingFormsIn(source, name).length > 0;
}

/**
 * Every BINDING of `name` in this module, as `{kind, expr}` records, or `[]`.
 *
 * THE SINGLE AUTHORITY FOR "is this name bound?" (r9 P1-2).
 *
 * This is the whole binding surface, gathered in one place so that no caller can
 * answer the question more narrowly than another:
 *
 *   - `const|let|var NAME = …` and bare `NAME = …` (r7: matched against a
 *     parameter-blanked copy, so a default VALUE is never read as an assignment
 *     target);
 *   - function parameters, including destructured properties;
 *   - arrow-function parameters, including the single-name form;
 *   - `for…of` / `for…in` heads;
 *   - `import { NAME } from …` and its alias form `import { a as NAME }`
 *     (r9 P1-2);
 *   - DESTRUCTURING ASSIGNMENT, `({ NAME } = …)` and `[NAME] = …` (r9 P1-2).
 *
 * The mutation, callback-receiver and argument-mutation rules of `bindingsOf` are
 * deliberately NOT here: those are ways a name's VALUE changes, not ways the name
 * comes into existence, and folding them in would make every trust-set name look
 * like it had a binding in every module.
 *
 * @param {string} source module source (comments already stripped)
 * @param {string} name
 * @returns {Array<{kind: string, expr: string}>}
 */
function bindingFormsIn(source, name) {
  const out = [];
  const push = (kind, expr) => {
    if (expr !== '' && expr !== null && expr !== undefined) out.push({ kind, expr });
  };
  const re = escapeRe(name);

  // Declaration / reassignment. The lookbehind keeps `x.filter = …` from
  // counting as a binding of a BARE `filter`; `(?!=)` keeps `filter == x` out.
  if (new RegExp(`(?<![.\\w$])(?:const|let|var)\\s+${re}\\s*=(?!=)`).test(source)) {
    push('declare', name);
  }
  if (new RegExp(`(?<![.\\w$])${re}\\s*=(?!=)[^=]`).test(source)) push('assign', name);

  // Parameter / destructured-property / callback-parameter bindings.
  //
  // An OBJECT KEY is deliberately NOT evidence. `{ must: 'be a string' }` in
  // `plan-contract.mjs` is data, not a binding, and treating it as one made
  // thirty-odd prose words (`must`, `be`, `a`, `no`, `exactly`, …) look like
  // shadowed variables — the walk then chased them and reported the F.3
  // boundary's own production line as full of blind spots. Only a position that
  // genuinely introduces a NAME counts.
  for (const list of functionParameterLists(source)) {
    for (const p of list) {
      const inner = /^\s*\{([\s\S]*)\}\s*$/.exec(p);
      if (inner) {
        for (const piece of inner[1].split(',')) {
          if (boundNameOf(piece) === name) push('parameter-property', piece.trim());
        }
        continue;
      }
      const bare = boundNameOf(p);
      if (bare !== '' && bare === name) push('parameter', bare);
    }
  }
  for (const arrow of [/\(([^()]*)\)\s*=>/g, /\(([A-Za-z_$][\w$]*)\)\s*=>/g]) {
    for (let m = arrow.exec(source); m !== null; m = arrow.exec(source)) {
      for (const p of m[1].split(',')) {
        const bare = boundNameOf(p);
        if (bare !== '' && bare === name) push('arrow-parameter', bare);
      }
    }
  }
  for (const b of loopHeadBindingsOf(source, name)) push('loop-head', b.expr);

  // IMPORT BINDINGS, ALIAS FORM INCLUDED (r9 P1-2). `import { filter } from
  // './h.mjs'` and `import { gather as filter } from './h.mjs'` bind `filter`
  // exactly as `const filter = …` does, and both are one-word renames of the
  // carrier that the non-vocabulary control was caught through.
  //
  // THE ALIAS IS THE POINT, and the cheap direction is not enough.
  // `isLibRelativeImport` already knew how to read `.split(/\s+as\s+/).pop()`,
  // so "does the module import this name" was answerable; what was missing is
  // that an import is a BINDING, which is what makes a vocabulary-spelled
  // carrier reachable. Splitting the two questions is what let this stay green.
  for (const m of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*(['"])[^'"]*\2/g)) {
    for (const entry of m[1].split(',')) {
      const t = entry.trim();
      if (t === '') continue;
      // `{ a as b }` binds `b`; `{ a }` binds `a`.
      const bound = t.split(/\s+as\s+/).pop().trim();
      if (bound === name) push('import', t);
    }
  }

  // DESTRUCTURING ASSIGNMENT (r9 P1-2). `({ filter } = opts)` and
  // `[filter] = row` bind `filter` with no `const|let|var` anywhere, so the
  // declaration patterns above see nothing — and the carrier is read one
  // statement later, at which point the name looks free.
  //
  // The leading `(` is required on the object form: without it,
  // `if (filter = compute())` and every comparison-with-assignment would count
  // as a binding, which is a false positive on a shape that appears constantly.
  for (const m of source.matchAll(/(^|[;{(])\s*\{([^{}]*)\}\s*=\s*(?!=)/g)) {
    for (const piece of m[2].split(',')) {
      if (boundNameOf(piece) === name) push('destructure-assign', m[0].trim());
    }
  }
  for (const m of source.matchAll(/(^|[;{(,])\s*\[([^\][]*)\]\s*=\s*(?!=)/g)) {
    for (const piece of m[2].split(',')) {
      if (boundNameOf(piece) === name) push('array-destructure-assign', m[0].trim());
    }
  }
  return out;
}

/**
 * The NAME one binding position introduces.
 *
 * `{ a: b }` binds `b`, `[a, b]` binds each piece, `= default` is not a name,
 * and a rest element binds its head. This is the same reduction `scopeBoundNames`
 * performs, extracted so every binding test answers with one definition.
 */
function boundNameOf(piece) {
  return String(piece)
    .replace(/^\s*\.{3}/, '')
    .split(':').pop()
    .split('=')[0]
    .replace(/[{}[\]]/g, '')
    .trim();
}


/**
 * Replace the INSIDE of every function signature's parameter list with spaces,
 * preserving length so an index found in the result still addresses the original
 * source.
 *
 * A default value in a parameter list (`{ minEntries = 0 } = {}`) is
 * syntactically an assignment but semantically a binding, and a regex that
 * looks for `NAME = …;` cannot tell the two apart. Blanking the list removes the
 * ambiguity at its source instead of adding another pattern to the pile.
 *
 * @param {string} source
 * @returns {string} a same-length copy with parameter-list interiors blanked
 */
function blankParameterLists(source) {
  const out = source.split('');
  const fn = /\bfunction\b/g;
  // Blank from the `=` that introduces a DEFAULT VALUE to the end of that
  // default, keeping the parameter's own NAME visible.
  //
  // Blanking the whole list would be simpler and wrong: `runMultiQueryRetrieval(opts = {})`
  // binds `opts`, and that binding is exactly what
  // `assertArtifactSafe(pool, { trustedPlanStrings: new Set(validated.plan.queryVariants) })`
  // depends on. Erasing the name left the production trust set unresolvable —
  // the guard failing on honest code, which is the same noise-to-signal failure
  // as reporting a real threat and getting it waived. The NAME is the binding;
  // only the default's right-hand side is the thing that must not be read as an
  // assignment target.
  const blankDefaultValue = (from, to) => {
    let i = from;
    while (i < to) {
      const ch = source[i];
      if (ch === '(' || ch === '[' || ch === '{') {
        // Blank a nested bracket's interior, keeping its delimiters, so the
        // `=` that follows it is still visible.
        let d = 0;
        for (let k = i; k < to; k += 1) {
          const c = source[k];
          if (c === '(' || c === '[' || c === '{') d += 1;
          else if (c === ')' || c === ']' || c === '}') {
            d -= 1;
            if (d === 0) { i = k; break; }
          }
        }
        for (let k = i + 1; k < to; k += 1) {
          if (out[k] !== '\n') out[k] = ' ';
        }
        i += 1;
        continue;
      }
      if (ch === ',') { i += 1; continue; }
      // `name = default` — blank the default only.
      for (let k = i; k < to; k += 1) {
        if (out[k] !== '\n') out[k] = ' ';
      }
      break;
    }
  };
  for (let m = fn.exec(source); m !== null; m = fn.exec(source)) {
    const open = source.indexOf('(', m.index);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < source.length && i - open < 2000; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { blankDefaultValue(open + 1, i); break; }
      }
    }
  }
  // Arrow functions with a parenthesised parameter list: `(a, b = 1) => …`.
  const arrow = /\(([^()]*)\)\s*=>/g;
  for (let m = arrow.exec(source); m !== null; m = arrow.exec(source)) {
    const open = m.index;
    blankDefaultValue(open + 1, open + 1 + m[1].length);
  }
  return out.join('');
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
 * Writes to `RECEIVER.NAME` — the trust set handed over as a member rather than
 * a bare variable (r9 P1-3).
 *
 * Two spellings reach the same member expression, and both are covered:
 *
 *   holder.trusted = new Set(targetedPools…);    // property write
 *   class T { trusted = new Set(targetedPools…) } // field initialiser, read `t.trusted`
 *
 * The field form is included because the member is read from a DIFFERENT object
 * than the one written — `assertArtifactSafe(pool, { trustedPlanStrings: h.trusted })`
 * where `h` is a `TrustHolder` — so there is no receiver to follow from the
 * field's own text; the field initialiser has to be reported against the BARE
 * member name, which is what `name` is here.
 *
 * @param {string} source module source
 * @param {string} name the trust set's member name, e.g. `trusted`
 * @returns {Array<{kind: string, expr: string}>}
 */
/**
 * The SPELLINGS of a member access, shared so the three consumers below can
 * never drift apart on what JS allows.
 *
 * r10 P1-2. `name.includes('.')` was the whole test everywhere, so
 * `holder['trusted']` and `h?.trusted` — the same member, written the other two
 * ways JS allows — were not recognised as names at all. A receiver, a
 * separator, and a property; only the separator varies.
 *
 * `RECEIVER` is a PATH (`a`, `a.b`, `a.b.c`) because the walk recurses on the
 * receiver and has always been able to. Anchoring it at one identifier is what
 * made `validated.plan.queryVariants` stop being a member.
 *
 * `LITERAL_PROPERTY` accepts a BARE identifier only after a dot (`a.b`); after
 * brackets it must be QUOTED (`a['b']`), because `a[b]` with a variable key is
 * not a read of the member `b` — it is a read of whatever property `b` holds at
 * run time, and the walk has nothing to follow. See `propertyWriteBindingsOf`
 * for the same distinction on the write side, and for the regression that found
 * it.
 */
const RECEIVER = String.raw`[A-Za-z_$][\w$]*(?:\s*(?:\?\.|\.)\s*[A-Za-z_$][\w$]*)*`;
const LITERAL_PROPERTY = String.raw`(?:[A-Za-z_$][\w$]*|'[^']*'|"[^"]*"|\`[^\`]*\`)`;
const QUOTED_PROPERTY = String.raw`(?:'[^']*'|"[^"]*"|\`[^\`]*\`)`;

/** `recv.prop` — separator form, path receiver, bare or literal property. */
const SEPARATOR_FORM = new RegExp(
  String.raw`^\s*(${RECEIVER})\s*\.\s*(${LITERAL_PROPERTY})\s*$`,
);
/** `recv['prop']` — bracket form, path receiver, QUOTED property only. */
const BRACKET_FORM = new RegExp(
  String.raw`^\s*(${RECEIVER})\s*\[\s*(${QUOTED_PROPERTY})\s*\]\s*$`,
);
/**
 * A receiver of EXACTLY ONE identifier, then one property — `a.b` or `a['b']`,
 * and (after normalisation) `a?.b` and `a?.['b']`.
 *
 * This is `isWalkableTrustSetName`'s form, and the difference from the two above
 * is the whole point: it refuses a receiver PATH. `a.b.c` is a member to
 * `splitMemberAccess` and an EXPRESSION here, because the base is a read whose
 * own value still has to be resolved.
 */
const SINGLE_SEGMENT_FORM = new RegExp(
  String.raw`^\s*[A-Za-z_$][\w$]*\s*(?:\.\s*${LITERAL_PROPERTY}|\[\s*${QUOTED_PROPERTY}\s*\])\s*$`,
);

// A1 (candidate). A trust-set VALUE that is a MEMBER is a thing to walk; a value
// that is an EXPRESSION is text to test. r11's `SINGLE_SEGMENT_FORM` draws that
// line at exactly ONE property, so `state.inner.trusted` and `holder[k].trusted`
// were filed as expressions -- tested as text, then walked no further. Both are
// members, and both are how a trust set is handed over on the F.3 boundary.
//
// These two forms widen the line WITHOUT loosening it: each still requires the
// value to be a pure member-access chain, so `new Set(a.b)`, `a.b + c`, and any
// expression that merely CONTAINS a member stay expressions.
const MULTI_SEGMENT_FORM = new RegExp(
  String.raw`^\s*[A-Za-z_$][\w$]*\s*(?:\.\s*${LITERAL_PROPERTY}\s*)+(?:\.\s*[A-Za-z_$][\w$]*|\[\s*${QUOTED_PROPERTY}\s*\])\s*$`,
);

// A COMPUTED member: `holder[k]`, `holder[k].trusted` (the F.3 shape),
// `state.inner[k]`, `state.inner[k].trusted`. A computed key may sit at ANY position
// in the chain; each step is `.literal`, or `.identifier[ key ]`.
//
// WHY AN IDENTIFIER KEY IS ADMITTED HERE, when `propertyWriteBindingsOf` refuses a
// bare `out[key] = …`: that refusal is about a write with NO RECEIVER, where the
// property is whatever the variable holds and the walk has nothing to follow. A
// computed key on a NAMED receiver is different -- `holder[k].trusted` still has the
// receiver `holder`, and F.3 is exactly that shape. What the walk still cannot follow
// is the VARIABLE's value, which is why a computed member is a name to walk and not a
// resolved binding: the walk asks about `holder`, and `holder`'s own writes are
// followed by the existing receiver route rather than by guessing `k`.
const COMPUTED_KEY_FORM = new RegExp(
  String.raw`^\s*[A-Za-z_$][\w$]*\s*(?:\[\s*(?:${QUOTED_PROPERTY}|[A-Za-z_$][\w$]*)\s*\]|\.\s*(?:${LITERAL_PROPERTY}|[A-Za-z_$][\w$]*\s*\[\s*(?:${QUOTED_PROPERTY}|[A-Za-z_$][\w$]*)\s*\]))+\s*$`,
);

/**
 * Strip the OPTIONAL-CHAIN operator, so the two member forms are all that is
 * left to recognise.
 *
 * `?.` is a guard on the ACCESS, never part of the member's identity —
 * `h?.trusted` and `h.trusted` are the same member, and `h?.['trusted']` is
 * `h['trusted']`. Normalising it away first is why the two regexes above need
 * no optional-chain branches of their own, and why there is no third capture
 * offset to get wrong.
 */
function normaliseMemberSpelling(name) {
  return name
    .replace(/\?\s*\.\s*\[/g, '[')  // h?.['p'] -> h['p']
    .replace(/\?\s*\./g, '.');       // h?.p     -> h.p
}

/**
 * Split a NAME into its last property and the receiver path reaching it, in any
 * member-access spelling.
 *
 * THIS IS THE PREDICATE FOR "is this NAME a member access?" — and `a.b.c` IS
 * one: its last segment is a property and the rest is the receiver, which the
 * walk then recurses into exactly as it always did.
 *
 * It is NOT the predicate for "is this trust-set VALUE a name or an inline
 * expression?" (`isWalkableTrustSetName`, below), where `a.b.c` is an
 * EXPRESSION because its base is a read whose own value still has to be
 * resolved. r10's first attempt merged the two — anchoring both at exactly one
 * property — and it cost a repair cycle: `validated.plan.queryVariants` stopped
 * being a member, fell out of the member walk, and got resolved as a bare
 * variable, so the walk pulled in `validatePlanInput`'s entire function body and
 * reported its eighteen locals as blind spots on `retrieval.mjs:800`, the frozen
 * F.3 line the guard exists to protect. A guard that cries wolf there is a guard
 * whose real findings get waived. The two questions are separate, and each has
 * its own answer.
 *
 * @param {string} name
 * @returns {{receiver: string, member: string}|null} null when `name` is not a
 *   member access in any spelling
 */
export function splitMemberAccess(name) {
  const normalised = normaliseMemberSpelling(name);
  for (const re of [SEPARATOR_FORM, BRACKET_FORM]) {
    const m = re.exec(normalised);
    if (m === null) continue;
    // The property arrives QUOTED for the computed spellings, and the walk
    // looks it up as a NAME — `propertyWriteBindingsOf` builds a regex from it,
    // and `'trusted'` as a pattern matches a quote character, not the property.
    // The quotes are JS syntax around the member, never part of its identity:
    // `holder['trusted']` and `holder.trusted` are the same member, which is the
    // whole reason the walk accepts all the spellings in the first place.
    return {
      receiver: m[1].replace(/\s+/g, ''),
      member: m[2].replace(/^(['"`])([\s\S]*)\1$/, '$2'),
    };
  }
  return null;
}

/**
 * ARGUMENTS of every call that MUTATES INTO `receiver.member` —
 * `holder.trusted.add(x)`, `state.inner.trusted.add(x)`, `holder['trusted'].add(x)`.
 *
 * A3. The member route answers two questions about a member — what is ASSIGNED to
 * it, and who is the RECEIVER holding it — and a third question goes unanswered:
 * what is MUTATED INTO it. The assignment pattern cannot answer that one by
 * construction: its tail is `=(?!=)([^;]+);`, and `.add(` is not `=`. So a trust set
 * handed over as a member and then fed through its own `.add()` resolved to a
 * binding, reported CLEAN, and the argument that would have leaked had never been
 * in the walk at all. Silence, produced by a rule that was never wrong about
 * assignments — only silent about mutations.
 *
 * The receiver is matched as a PATH and the property in the four spellings
 * `splitMemberAccess` accepts, so `holder?.['trusted']` (how the ASK arrived) is the
 * same member as `holder.trusted.add(` (how the WRITE is spelled). The receiver is
 * compared after whitespace normalisation, for the same reason
 * `propertyWriteHasReceiver` compares that way: `nextState . retrieval` and
 * `nextState.retrieval` are one receiver, and two different receivers are two
 * different bindings however similarly they are spelled.
 *
 * ARGUMENTS ARE READ BY BRACKET PAIRING, never by `[^)]*` — the same r7 P1-1
 * constraint the receiver-mutation route already carries: an argument containing a
 * call or an object literal truncates at its first `)`, and the identifier walk then
 * reads the truncated fragment's prose as free variables.
 *
 * This asks only about the ASKED member. It is not a second property-write rule —
 * it never reads `propertyWritePattern` — and it cannot re-admit a name the
 * classifier refused: the member route is DOWNSTREAM of that decision.
 *
 * @param {string} source module source
 * @param {string} receiver the receiver path, whitespace already normalised
 * @param {string} member the property name
 * @returns {string[]} the arguments, in source order; empty when there is no such call
 */
function memberRouteMutationArguments(source, receiver, member) {
  const re = escapeRe(member);
  const Q = "(?:'" + re + "'|\"" + re + "\"|" + '\x60' + re + '\x60' + ')';
  const SPELLING = '(?:\\.\\s*' + re + '|\\?\\.\\s*' + re + '|\\[\\s*' + Q + '\\s*\\]|\\?\\.\\s*\\[\\s*' + Q + '\\s*\\])';
  const receiverPath = receiver.split('.').map(escapeRe).join('\\s*\\.\\s*');
  const call = new RegExp(
    '(?<![.\\w$])' + receiverPath + '\\s*' + SPELLING + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(',
    'g',
  );
  // INJECTION: can this call feed a value INTO the trust set? Only a mutating
  // method can, so a name on this READ vocabulary contributes nothing. The list
  // is closed on purpose: an UNKNOWN name is treated as mutating, so an
  // unrecognised method fails CLOSED (reported) instead of silently clean.
  //
  // CONTINUATION: a read's RESULT is a different value, so a read also ends
  // the chain. That is what keeps `.has(a).add(leak)` contributing no phantom
  // mutation expression (contract ATTACK 4).
  const reads = new Set(['has', 'forEach', 'map', 'includes', 'indexOf', 'lastIndexOf', 'join', 'values', 'entries', 'keys', 'toString', 'slice', 'concat', 'some', 'every', 'filter', 'reduce', 'find', 'findIndex', 'at', 'flat', 'trim', 'padStart', 'replace', 'match']);
  const isMutation = (name) => !reads.has(name);
  const nextCall = /\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/y;
  const out = [];
  for (let m = call.exec(source); m !== null; m = call.exec(source)) {
    let method = m[1];
    let open = m.index + m[0].length - 1;
    for (;;) {
      // Local pairing is needed for the continuation's position. Scanning to
      // source.length also avoids the shared reader's silent 4000-char cutoff.
      // This retains that reader's lexical bracket semantics (not a parser).
      let depth = 1;
      let close = open + 1;
      for (; close < source.length; close += 1) {
        const ch = source[close];
        if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
        if (depth === 0) break;
      }
      if (depth !== 0) break;
      if (isMutation(method)) {
        out.push(...splitTopLevelCommas(source.slice(open + 1, close)));
      }
      if (method !== 'add') break;
      nextCall.lastIndex = close + 1;
      const next = nextCall.exec(source);
      if (next === null) break;
      method = next[1];
      open = nextCall.lastIndex - 1;
    }
  }
  return out;
}

/**
 * Is this trust-set VALUE a MEMBER to walk, or an INLINE EXPRESSION to test as
 * text?
 *
 * A receiver with EXACTLY ONE property, in any spelling: `a.b`, `a['b']`, `a?.b`,
 * `a?.['b']`. Anchored at both ends so an expression that merely CONTAINS a
 * member (`new Set(a.b)`) or chains several (`a.b.c`) stays an expression — see
 * `splitMemberAccess` for why that is a different question from the one it asks.
 *
 * A BARE IDENTIFIER is deliberately not in this set, and must not be added. It
 * reaches the walk by a different route that is already correct: the `__expr__`
 * branch checks the name's own text and then recurses on
 * `provenanceIdentifiersIn(name)`, which for a bare name yields the name itself,
 * so the binding walk is asked anyway. Routing a bare name here as well would
 * be asking the same question twice by two paths, and the first answer would
 * pre-empt the second.
 *
 * Exported from the helper so the SPELLINGS have one definition. The test
 * layer's own copy had lost the pure-bracket form, which made `holder['trusted']`
 * a NAME to the walk and an EXPRESSION to the classifier deciding what to do
 * with the name: two halves of one decision, disagreeing silently, on a
 * security guard.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isWalkableTrustSetName(value) {
  // The `?.` normalisation matters here too, so the optional-chained spellings
  // do not each need a branch of their own. It is done by string rewrite rather
  // than by a shared regex on purpose: the two consumers want DIFFERENT receivers
  // (a path versus a single identifier) and the SAME property rules, and sharing
  // the property rules is what matters — sharing a verdict is what r10's first
  // attempt did wrong.
  const normalised = normaliseMemberSpelling(value);
  return SINGLE_SEGMENT_FORM.test(normalised)
    || MULTI_SEGMENT_FORM.test(normalised)
    || COMPUTED_KEY_FORM.test(normalised);
}

/**
 * ONE definition of "a write to the named member", as a global regex.
 *
 * r11 P1-1 required this to exist. The walk already had exactly this rule — in
 * `propertyWriteBindingsOf` — and the new caller (`memberWritePathsIn`, below)
 * needs to ask the same question, because a member that has no write is a pure
 * READ and must be left alone. Two copies of the four-spelling alternation would
 * be two answers to "is `h?.['trusted']` a write", which is precisely the class
 * of defect r9's review found in this file: the test layer and the helper each
 * carrying their own member regex and disagreeing silently, on a security guard.
 *
 * The alternative — call `propertyWriteBindingsOf` and look at the result — was
 * rejected because it also returns `class-field` entries, so "has a write" would
 * answer a different question for a receiver-less field. The write rule is what
 * is being shared, so the write rule is what gets shared.
 *
 * The four spellings and the refusal of a BARE computed key are documented where
 * they are explained: `propertyWriteBindingsOf`, above.
 *
 * @param {string} name the member (property) name
 * @returns {RegExp} global; `exec` yields `[full, receiver, rhs]`
 */
function propertyWritePattern(name) {
  const re = escapeRe(name);
  const Q = `(?:'${re}'|"${re}"|\`${re}\`)`;
  const SEP = [
    `\\.\\s*${re}`,                      // h.trusted
    `\\?\\.\\s*${re}`,                   // h?.trusted
    `\\[\\s*${Q}\\s*\\]`,                // h['trusted']
    `\\?\\.\\s*\\[\\s*${Q}\\s*\\]`,       // h?.['trusted']
  ].join('|');
  return new RegExp(
    `(?<![.\\w$])([A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*)\\s*(?:${SEP})\\s*=(?!=)([^;]+);`,
    'g',
  );
}

/**
 * Does this module WRITE `receiver.name`, with THAT receiver?
 *
 * The write RULE is `propertyWritePattern`'s and is not duplicated here; this asks
 * only the extra question a widened receiver makes necessary. With the receiver
 * group widened to a dotted chain, one property name can be written through
 * several unrelated receivers, and those are different bindings:
 *
 *   nextState.retrieval.plannedQueryVariants = update.plannedQueryVariants;
 *   assertArtifactSafe(state, { trustedPlanStrings: new Set(ret.plannedQueryVariants) });
 *
 * The walk asks about `ret.plannedQueryVariants`; the write above is to
 * `nextState.retrieval.plannedQueryVariants`. Answering the first question with
 * the second is what made the widened receiver report the production boundary as
 * fed by a targeted surface.
 *
 * @param {string} source module source
 * @param {string} name the property (member) name
 * @param {string} receiver the receiver the walk ASKED about
 * @returns {boolean}
 */
function propertyWriteHasReceiver(source, name, receiver) {
  const assign = propertyWritePattern(name);
  for (let m = assign.exec(source); m !== null; m = assign.exec(source)) {
    if (m[1].replace(/\s+/g, '') === receiver) return true;
  }
  assign.lastIndex = 0;
  return false;
}

/**
 * Member paths inside `expr` that this module actually WRITES TO.
 *
 * r11 P1-1. `followInto` used to reduce an expression to
 * `provenanceIdentifiersIn`, which strips property names BY DESIGN — so a
 * member read inside an inline trust set lost its property half before anything
 * could ask about the write that fed it:
 *
 *   const holder = {};
 *   holder.trusted = new Set([...plan.queryVariants, ...targetedPools.map((p) => p.rawQuery)]);
 *   assertArtifactSafe(pool, { trustedPlanStrings: new Set(holder.trusted) });
 *
 * `provenanceIdentifiersIn('new Set(holder.trusted)')` is `['new','Set','holder']`,
 * so the walk asked about `holder`, whose only binding is the empty object. The
 * verdict was `{violations: [], unresolvable: []}` — CLEAN. That is a fail-open on
 * the F.3 boundary's own semantics, and it needed no rename, no computed key and
 * no alias: one `.` on a read.
 *
 * WHY NOT EVERY MEMBER, AND THIS IS THE WHOLE DESIGN. The obvious fix — consult
 * the member route for every member path in the expression — reproduces the r10
 * P1-2 regression exactly, and I measured it rather than reasoning about it. On
 * the real frozen call sites:
 *
 *   coverage-final-integration.mjs:461  Array.isArray(plan.queryVariants) ? … : []
 *     → member route on `Array.isArray` yields 45 expressions and 8 blind spots
 *
 * Eight false blind spots on the production line the guard exists to protect, for
 * a member that is a BUILTIN READ and has no write anywhere. The noise-to-signal
 * failure is worse than the hole: a reader who sees `failClosed`,
 * `CoverageIntegrationError` and `seam` reported as unresolvable on the F.3
 * boundary learns to waive unresolvable, and then the real one goes unread.
 *
 * So the predicate is not "is this a member" but "IS THIS MEMBER EVER WRITTEN IN
 * THIS MODULE". That is the same question `propertyWriteBindingsOf` already
 * answers, and it is the question that actually matters: a property write is the
 * only thing that makes `receiver.member` a BINDING of a trust set rather than a
 * read of someone else's data. Pure reads are already covered — the receiver is
 * still walked as a name, which is what caught `const validated =
 * validatePlanInput(plan)` on `retrieval.mjs:800`.
 *
 * Measured on the three production sites with an inline trust set, this returns
 * EMPTY (`Array.isArray`, `plan.queryVariants`, `ret.plannedQueryVariants` and
 * `validated.plan.queryVariants` have no writes), so the fix adds no noise to
 * production while catching both `new Set(holder.trusted)` and
 * `new Set([...holder['trusted']])`.
 *
 * @param {string} source module source
 * @param {string} expr the expression to scan
 * @returns {string[]} member paths, in order of appearance, deduplicated
 */
export function memberWritePathsIn(source, expr) {
  const paths = String(expr).match(MEMBER_PATH_IN_EXPR) ?? [];
  const out = [];
  const seen = new Set();
  for (const path of paths) {
    const split = splitMemberAccess(path);
    // A member with no split is not a member access at all; and a member whose
    // name is never written in this module is a pure read, left to the receiver
    // walk. Deduplicated because `plan.queryVariants` can appear twice in one
    // expression (`new Set(Array.isArray(plan.queryVariants) ? … : [])`) and
    // asking the same question twice is how a shared budget gets misread as a
    // genuine miss.
    if (split === null) continue;
    // RECEIVER IDENTITY: a write to `R.member` is evidence for the ASKED path
    // `R.member` only when the write's own receiver IS R. Same property name
    // through a different receiver is a different binding.
    if (!propertyWriteHasReceiver(source, split.member, split.receiver)) continue;
    const key = `${split.receiver}.${split.member}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
/** Member-path shape used by `memberWritePathsIn`. */
const MEMBER_PATH_IN_EXPR = /[A-Za-z_$][\w$]*(?:\s*(?:\?\.|\.)\s*[A-Za-z_$][\w$]*|\s*\[\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*\])+/g;

function propertyWriteBindingsOf(source, name) {
  const out = [];
  const re = escapeRe(name);
  // `RECEIVER.NAME = RHS;` — the lookbehind keeps `x.other.NAME` from matching
  // a two-segment receiver, which is correct: the walk follows dotted names from
  // the right, so the LAST segment is the one that matters.
  //
  // r10 P1-2: the SEPARATOR between receiver and property is not the identity
  // of a member — only JS syntax varies it. These four spellings are one member:
  //
  //   holder.trusted       = new Set(tp.map(…));
  //   holder['trusted']    = new Set(tp.map(…));
  //   holder["trusted"]    = new Set(tp.map(…));
  //   h?.trusted           = new Set(tp.map(…));
  //   holder?.['trusted']  = new Set(tp.map(…));
  //
  // The separator is matched as ONE alternation that CONSUMES the member name.
  // An earlier version put the name in the separator and then repeated it after,
  // which requires the name to appear twice and silently matches nothing — the
  // kind of mistake that looks like "no widening found" rather than "my regex
  // is wrong", and would have left this guard quietly blind while reporting
  // clean.
  //
  // A BARE (UNQUOTED) COMPUTED KEY IS DELIBERATELY NOT ONE OF THEM, and its
  // absence was found by a regression rather than by reading. `h[name] = …`
  // with a VARIABLE key is not a write to the member `name` — it is a write to
  // whatever property that variable holds at run time — so the walk has nothing
  // to follow and must not claim it has:
  //
  //   for (const key of Object.keys(plan)) { out[key] = canonicalize(value[key]); }
  //   err[key] = v.issues;      normalized[key] = list;
  //
  // Those are the loop bodies of `plan-contract.mjs`'s own validators. Accepting
  // them made `propertyWriteBindingsOf` report three unrelated writes as
  // evidence for every member name the walk ever asked about, and the resulting
  // `canonicalize` / `list` / `v.issues` reads dragged the whole
  // `validatePlanInput` body into the provenance of the F.3 boundary's own
  // production line — eighteen false blind spots on `retrieval.mjs:800`, the
  // frozen line the guard exists to protect. A guard that cries wolf there is a
  // guard whose real findings get waived.
  //
  // Only the QUOTED forms are writes to a known member, and a quoted key is a
  // literal, so this cannot go blind on a real widening: `holder['trusted']` is
  // a static property name, exactly as `holder.trusted` is.
  const assign = propertyWritePattern(name);
  for (let m = assign.exec(source); m !== null; m = assign.exec(source)) {
    const receiver = m[1];
    if (receiver === name) continue;
    out.push({ kind: 'property-write', expr: `${receiver}.${name} = ${m[2].trim()}`, receiver });
    out.push({ kind: 'property-write-receiver', expr: receiver, receiver });
  }
  // A CLASS FIELD initialiser: `trusted = new Set(…)` with no `const|let|var`.
  // Matched only at the start of a line so an ordinary local declaration is not
  // picked up twice — it is already a declaration for `bindingsOf`.
  const field = new RegExp(`^\\s*${re}\\s*=\\s*([^;\\n]+);`, 'gm');
  for (let m = field.exec(source); m !== null; m = field.exec(source)) {
    out.push({ kind: 'class-field', expr: `${name} = ${m[1].trim()}` });
  }
  return out;
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
  return importBindingOf(libDir, file, name)?.module ?? null;
}

/**
 * The `{module, exported}` pair a local binding is imported AS, or `null`.
 *
 * WHY THE ORIGINAL NAME HAS TO TRAVEL WITH THE MODULE (r9 P1-2)
 * -----------------------------------------------------------
 * An aliased import binds a local name to a DIFFERENT name in the origin module:
 *
 *     import { gather as filter } from './helper.mjs';
 *     const trusted = new Set(filter(opts));
 *
 * `importOriginOf` resolved the module correctly (`helper.mjs`) and then asked
 * `resolveCallReturnProvenance` for a body named `filter` — which that module
 * does not declare, so the lookup returned `found: false` and the alias read as
 * a clean resolution. The non-vocabulary control was caught precisely because
 * its local name and its exported name were the same string, which is the only
 * reason the defect survived: renaming the import to collide with a vocabulary
 * word is all it takes.
 *
 * So the two names are resolved TOGETHER and the ORIGIN module is looked up
 * under the name it actually declares.
 *
 * @param {string} libDir absolute path to `lib/`
 * @param {string} file the importing module's basename
 * @param {string} name the LOCAL binding
 * @returns {{module: string, exported: string}|null}
 */
function importBindingOf(libDir, file, name) {
  // `existsSync` rather than `statSync` so a SYNTHETIC source (a mutation-proof
  // fixture named after a module that does not exist on disk) yields `null`
  // instead of throwing ENOENT out of a predicate that is supposed to answer
  // "can this name be accounted for?", not "does this path exist?".
  const full = path.join(libDir, file);
  if (!existsSync(full)) return null;
  if (!statSync(full).isFile()) return null;
  const stripped = stripComments(readFileSync(full, "utf8"));
  // BOTH QUOTE STYLES — see `isLibRelativeImport`. A path spelled with double
  // quotes is the same import, and matching only one of them makes the
  // cross-module route silently inapplicable.
  for (const m of stripped.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*(["'])(\.[^"']*)\2/g)) {
    for (const entry of m[1].split(",")) {
      const t = entry.trim();
      if (t === "") continue;
      const parts = t.split(/\s+as\s+/).map((s) => s.trim());
      const local = parts[parts.length - 1];
      if (local !== name) continue;
      const target = path.basename(m[3]);
      const targetFull = path.join(libDir, target);
      if (existsSync(targetFull) && statSync(targetFull).isFile()) {
        // `{ gather as filter }` -> exported `gather`; `{ gather }` -> `gather`.
        return { module: target, exported: parts[0] };
      }
    }
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
    // r7 P1-1: spelling-based vocabulary filtering dropped honest locals named
    // `filter`/`map`/`result`/… on this route too, which is how the same bypass
    // stayed green through BOTH routes. `isVocabularyOnly` asks whether a
    // binding explains the name instead of what the name is spelled.
    if (isVocabularyOnly(source, ident)) continue;
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
  // Route 4a — a local of the SCOPE, reached only after the earlier routes ran.
  //
  // r7 P1-1 fallout. `resolveCallReturnProvenance` reads a callee body and then
  // asks about every name in it, passing that body as `scope`. Route 1 already
  // covers names the SCOPE binds, so a body-local is normally answered there —
  // but Route 1 tests `scopeBoundNames`, which only sees declarations, `for`
  // heads, destructuring and PARAMETERS. A name introduced some other way, or
  // one that only looks bound, fell through to here and was reported as a blind
  // spot in a module the guard had just finished reading. Once the walk follows
  // vocabulary-colliding locals (the r7 P1-1 fix), `plan-contract.mjs`'s own
  // prose words surfaced this: `validatePlanInput.must`, `.be`, `.a`, and forty
  // more, all reported as unresolved on the F.3 boundary's own production line.
  //
  // Reporting a name as a blind spot that the SAME text visibly binds is the
  // one thing this guard must never do — it converts "I cannot see this" into
  // "I checked this", which is strictly worse than missing a rule. So the
  // full local-binding set is consulted before declaring a blind spot.
  //
  // AND IT IS THE SCOPE'S OWN SET, NOT THE MODULE'S (r9 P2-1). `scope` is the
  // text that introduced the name — a callee body, or a caller's expression. When
  // a scope IS supplied, only names bound inside it can be in scope, and reading
  // the WHOLE MODULE instead lets an unrelated top-level function's parameter
  // answer for it:
  //
  //   function unrelated(carrier) { return String(carrier).length; }
  //   export function build(plan, pool) {
  //     const trusted = new Set(plan.queryVariants);
  //     trusted.add(carrier);        // <- nothing in `build` binds it
  //     assertArtifactSafe(pool, { trustedPlanStrings: trusted });
  //   }
  //
  // `carrier` was reported here as `local \`carrier\``, which is the guard's one
  // unforgivable inversion: a name it cannot account for, presented as one it
  // checked. The control with the parameter renamed was correctly reported,
  // which is what makes this a hole rather than a limitation.
  //
  // With NO scope (`scope === ''`) the walk is at module level, where the
  // honest answer is the module's own top-level bindings — an arrow callback
  // parameter, a module declaration. A top-level `function f(x)` binds `x`
  // inside `f` and nowhere else, so it is deliberately not consulted.
  if (scope !== '' && locallyBoundNames(scope).has(ident)) {
    return { expressions: [`local \`${ident}\``], unresolvable: [] };
  }
  if (scope === '' && enclosingTopLevelFunctionBody(source, ident) !== null) {
    return { expressions: [`local \`${ident}\``], unresolvable: [] };
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
  const binding = importBindingOf(libDir, file, callName);
  const origin = binding?.module ?? null;
  // THE ORIGIN IS LOOKED UP UNDER ITS OWN EXPORTED NAME (r9 P1-2). An aliased
  // import binds `filter` to an exported `gather`, so asking the origin module
  // for a body named `filter` finds nothing — and "nothing here" was reported
  // as a clean resolution rather than as the blind spot it is.
  const exported = binding?.exported ?? callName;
  if (origin === null) {
    return { found: false, expressions: [], unresolvable: [`${callName} is not readable in this module or any lib/ import`] };
  }
  const originSource = stripComments(readFileSync(path.join(libDir, origin), 'utf8'));
  // The budget is SHARED with the calling module's walk, and the visited key is
  // namespaced by origin module: `isPlainObject` exists in several `lib/`
  // modules, and treating them as one node would silently skip a real body.
  const graph = budget ?? { visited: new Set() };
  const scoped = { visited: new Set([...graph.visited].map((k) => `${origin}::${k}`)) };
  const viaOrigin = resolveCallReturnProvenance(originSource, exported, { budget: scoped });
  graph.visited.add(`${origin}::${exported}`);
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
  const seenChain = new Set([`${origin}::${exported}`]);

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
function parameterBindingsOf(source, name, scope) {
  const out = [];
  // SCOPED, NOT MODULE-GLOBAL (r9 P2-1). This used to read every function
  // signature in the file and call any match a binding of `name`. A parameter
  // binds a name INSIDE its own function body and nowhere else, so:
  //
  //   function unrelated(carrier) { return String(carrier).length; }
  //   export function build(plan, pool) {
  //     const trusted = new Set(plan.queryVariants);
  //     trusted.add(carrier);
  //     assertArtifactSafe(pool, { trustedPlanStrings: trusted });
  //   }
  //
  // reported `carrier` as a bound parameter — from a function that has nothing to
  // do with `build` — and pushed it into the EVIDENCE as an expression. The name
  // therefore never became an unresolvable, so the trust set read as clean.
  //
  // `scope` is the BODY of the function the trust set is built in, or `null` at
  // module level. A signature whose body IS the scope is a binding; any other
  // signature cannot be, because nothing in it is in scope at the read.
  //
  // THE FALLBACK IS DELIBERATE AND NARROW. A signature this walk cannot enclose
  // — a nested function expression, a method, a signature inside a template
  // literal — would otherwise stop counting, which could turn an honest binding
  // into a blind spot. So when the scope is known but no signature claims the
  // name, EVERY signature is still consulted: the difference is that a name is
  // only accepted as a parameter when it is ALSO reached from the scope, and a
  // name no signature binds at all still becomes an unresolvable. The strict
  // scope therefore removes the false attribution without inventing one.
  const signatures = topLevelFunctionParameterLists(source);
  if (scope === null) {
    // Module level: no top-level function's parameters are in scope. An arrow
    // callback parameter is a different thing and is handled by the loop-head and
    // arrow rules elsewhere; a top-level `function f(x)` binds `x` inside `f`.
    for (const params of functionParameterLists(source)) {
      for (const p of params) {
        if (boundNameOf(p) === name) { out.push({ kind: 'param', expr: name }); break; }
      }
    }
    return out;
  }
  for (const { params, body } of signatures) {
    // A parameter is `NAME`, `NAME = default`, or `{ NAME }` / `{ NAME: alias }`.
    // `Array.prototype.includes` is EXACT equality, so it matched only the
    // first shape: `runMultiQueryRetrieval(opts = {})` was not recognised as
    // binding `opts` at all, and the F.3 boundary's own production trust set —
    // `assertArtifactSafe(pool, { trustedPlanStrings: new Set(validated.plan
    // .queryVariants) })`, inside that function — came back `unresolvable`.
    //
    // That defect was invisible until the r7 P1-1 fix stopped the assign rule
    // from producing a malformed body fragment for the same parameter: the
    // fragment used to supply a bogus expression, and the bogus expression is
    // what kept the assertion green. Two wrongs, and the second one was
    // load-bearing. So the comparison is on the parameter's own NAME, with the
    // default value stripped, rather than on the whole parameter text.
    if (body !== scope) continue;
    for (const p of params) {
      const bare = p.split('=')[0].trim();
      if (bare === name) { out.push({ kind: 'param', expr: name }); break; }
      const inner = /^\s*\{([\s\S]*)\}\s*$/.exec(bare);
      if (!inner) continue;
      for (const piece of inner[1].split(',')) {
        if (piece.split(':').pop().trim() === name) { out.push({ kind: 'param', expr: name }); break; }
      }
    }
  }
  return out;
}

/**
 * Every top-level function's parameter list, paired with its body text.
 *
 * Signatures are read with parenthesis pairing from the `function` keyword
 * rather than by matching any `{…})` in the file, so an ordinary object literal
 * argument (`foo({ plan })`) is NOT mistaken for a parameter list. The body is
 * carried alongside because `parameterBindingsOf` has to know which function a
 * parameter belongs to (r9 P2-1) — a parameter binds a name inside its own body
 * and nowhere else, so pairing them is the whole of the scoping rule.
 *
 * @returns {Array<{params: string[], body: string}>}
 */
function topLevelFunctionParameterLists(source) {
  const out = [];
  const header = /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/gm;
  for (let m = header.exec(source); m !== null; m = header.exec(source)) {
    const open = source.indexOf('(', m.index);
    if (open === -1) continue;
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length && i - open < 2000; i += 1) {
      const ch = source[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) continue;
    const params = source
      .slice(open + 1, close)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const braceAt = source.indexOf('{', close);
    if (braceAt === -1) { out.push({ params, body: '' }); continue; }
    let d = 0;
    let end = -1;
    for (let i = braceAt; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') d += 1;
      else if (ch === '}') {
        d -= 1;
        if (d === 0) { end = i; break; }
      }
    }
    out.push({ params, body: end === -1 ? '' : source.slice(braceAt + 1, end) });
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
  // TWO regexes, not one. The gate must NOT carry the `g` flag, because
  // `RegExp.prototype.test` advances `lastIndex` on a global regex — a shared
  // global instance would make the gate consume the first match and the scan
  // loop below start at the SECOND one, silently skipping exactly the mutation
  // this rule exists to examine.
  const gate = new RegExp(`\\b${escapeRe(name)}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`);
  const mutation = new RegExp(`\\b${escapeRe(name)}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`, 'g');
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
  if (!gate.test(source)) return out;

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
  //
  // EVERY mutation is scanned, not just the first (r9 P1-1). `source.search`
  // took the leftmost one and stopped, so a module whose first `trusted.add` is
  // an unrelated single-line one hid every later wrapped form.
  //
  // AND THE SLICE IS THE STATEMENT, NOT THE LINE (r9 P1-1). This rule was the
  // last one still slicing to the mutation's own LINE, and the two ordinary ways
  // of writing a multi-line callback both put the receiver somewhere else:
  //
  //   targetedPools.forEach((p) => {      <- receiver on the `.forEach` line
  //     trusted.add(p);                   <- mutation on its own line
  //   });
  //
  //   targetedPools                       <- receiver two lines up
  //     .filter((p) => p.ok)
  //     .forEach((p) => trusted.add(p));
  //
  // Prettier produces the second shape on any chain that exceeds the line width,
  // so this was not a contrived fixture: the identical code is a violation when
  // written on one line and clean when wrapped, which is the definition of a
  // format-dependent bypass. The r8 fixtures were all single-line, which is why
  // five review rounds of line-sensitive probing never hit it.
  for (let m = mutation.exec(source); m !== null; m = mutation.exec(source)) {
    const text = statementWindowAround(source, m.index);
    if (!/\(\s*[A-Za-z_$][\w$]*\s*\)\s*=>/.test(text) && !/\bfunction\s*\(/.test(text)) continue;
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
  }
  return out;
}

/**
 * The STATEMENT around `at`, in the sense "the whole host call the mutation sits
 * inside" — which is what a receiver rule has to see.
 *
 * A mutation's own line is not that: the host call's receiver is on the line
 * that OPENS the callback, which for the two common shapes is a different line
 * from the one the mutation is on. So the window is found by walking back to the
 * nearest statement boundary and forward to the next one.
 *
 * The asymmetry in the backward walk is deliberate and load-bearing. A `;` ends
 * the previous statement, so the window starts immediately AFTER it — widening to
 * the start of that line would drag `const trusted = new Set(…)` in and make
 * `new Set` look like a chain root, which is noise the walk then has to resolve.
 * A `{` opens the callback body and is at the END of the host call's line, so the
 * window has to start at that LINE's beginning or the receiver is left outside
 * the slice. Treating both boundaries the same way fixes one of the two shapes
 * and breaks the other.
 *
 * @param {string} source
 * @param {number} at index of the mutation
 * @returns {string}
 */
function statementWindowAround(source, at) {
  let start = 0;
  let boundary = ';';
  for (let i = at - 1; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch !== ';' && ch !== '{' && ch !== '}') continue;
    boundary = ch;
    start = i + 1;
    break;
  }
  if (boundary !== ';') {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    if (lineStart < start) start = lineStart;
  }
  let end = source.length;
  for (let i = at; i < source.length; i += 1) {
    if (source[i] === ';') { end = i + 1; break; }
  }
  return source.slice(start, end);
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
    // A LITERAL root carries no variable data, so the chain's actual source is
    // in the FIRST LINK'S ARGUMENTS: `[].concat(targetedPools).forEach(f)` and
    // `Object.assign([], targetedPools).forEach(f)` both put the targeted
    // collection there, and reporting `[]` as the receiver finds nothing. An
    // empty literal as the head of a chain is the standard way to write "start a
    // fresh collection", so the arguments are where the data has to be.
    //
    // AND THE LITERAL NEED NOT BE EMPTY (r7 P1-2). The sixth review's fix tested
    // `/^[[({]\s*[}\])]?$/`, which `[]` passes and `["seed"]` does not — so
    //
    //     ["seed"].concat(targetedPools).forEach((p) => trusted.add(p.query))
    //
    // reported the root `["seed"]`, never walked `targetedPools`, and the trust
    // set read as clean. The empty/non-empty distinction has no principled
    // basis here: a literal's SEED is a datum the chain also carries, and the
    // targeted collection is in the arguments either way. So ANY bracket-led
    // root takes its first link's arguments as roots too.
    if (/^[[({]/.test(receiver)) {
      const args = readCallArguments(text, m.index + m[0].length - 1);
      if (args !== null) {
        for (const arg of args) {
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
