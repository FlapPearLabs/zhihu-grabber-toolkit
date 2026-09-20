// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/safe-content-projection.mjs
 *
 * P1-R04 (Issue #92) — SINGLE HTML Agent projection owner for the T13
 * semantic request boundary (V2 §9.2.4–9.2.9; P1 Spec §10.1).
 *
 * The REAL canonical source loader keeps returning canonical raw content —
 * its meaning is unchanged (FRESH-CONFIRMED root cause: the loader is correct;
 * T13 adds the fence). This module is the deterministic, inert,
 * structure-preserving projection applied to that raw content BEFORE it may
 * enter any model-visible semantic request. It reuses the EXISTING reviewed
 * parser/sanitizer primitives — no second parser/sanitizer framework:
 *
 *   - zhihu-answer-grabber/src/rich-renderer.js richHtmlToMarkdown
 *     (parse5 strict-whitelist HTML→Markdown renderer, AGPL, same-license
 *     reuse; dynamically imported so bare-node environments that never load
 *     it keep working — markup content in such an environment FAILS CLOSED,
 *     it is never projected unsafely);
 *   - zhihu-answer-grabber/src/markdown-security.js escapeUntrustedMarkdownText
 *     (pure module, already imported cross-package by reviewed P1 modules);
 *   - corpus-anthology/lib/lmstudio-projection.mjs sanitizeProjectionText /
 *     hasExtractableContent (MIT; AGPL-depends-on-MIT is the license-legal
 *     direction; the MIT package gains no AGPL dependency).
 *
 * Projection policy (behavior contract, not implementation binding):
 *   - PRESERVE: paragraph boundaries, lists, blockquote text, headings,
 *     inline evidence text, bounded metadata (code language/lines, image
 *     placeholders, display hosts).
 *   - OMIT by default: code block bodies → deterministic marker
 *     `[CODE_BLOCK language=... lines=N omitted_by_policy]` (V2 §9.2.4).
 *     Code bodies are never silently enabled for semantic use.
 *   - NEUTRALIZE: URLs / protocols / paths / backslashes / percent-encoding /
 *     control chars (sanitizeProjectionText) plus T13 fence-forgery tokens
 *     (UNTRUSTED_DATA / DATA_NOT_INSTRUCTION substrings) so untrusted content
 *     can neither leak nor FORGE additional sources.
 *   - METADATA-ONLY: a source with no extractable text after the policy
 *     yields metadataOnly=true; the caller still sends it through the real
 *     T13 semantic analysis (never skipped, never marked analyzed without a
 *     legal analysis, never given an invented claim).
 *   - FAIL CLOSED: any projection/assertion failure throws a coded
 *     SafeProjectionError BEFORE the semantic fetch; the caller turns it into
 *     the T13 group fail-closed path with zero transport calls.
 *
 * Bounded defense, honestly documented: this projection raises the cost of
 * prompt injection and removes the enumerated leak classes mechanically; it
 * does NOT promise injection can never succeed. Information loss (code
 * bodies, URLs, path tokens, markup) is intentional and deterministic.
 *
 * No network, no code execution, no tool capability. Pure deterministic text
 * transformation + one memoized dynamic module import.
 */

import {
  sanitizeProjectionText,
  hasExtractableContent,
} from '../../corpus-anthology/lib/lmstudio-projection.mjs';
import { escapeUntrustedMarkdownText } from '../../zhihu-answer-grabber/src/markdown-security.js';

/** Projection identity carried on every projection for downstream versioning (R06 handoff). */
export const SAFE_PROJECTION_VERSION = 'p1-r04-safe-projection/1';

/** Coded fail-closed error (module-level identity; T13 maps it onto the SEAM C group fail-closed path). */
export class SafeProjectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SafeProjectionError';
    this.code = code;
  }
}

const ERR_RENDERER_REQUIRED = 'SAFE_PROJECTION_RENDERER_REQUIRED';
const ERR_RENDER_FAILED = 'SAFE_PROJECTION_RENDER_FAILED';
const ERR_ASSERTION_FAILED = 'SAFE_PROJECTION_ASSERTION_FAILED';

// ---------------------------------------------------------------------------
// memoized dynamic renderer load (parse5 lives in zhihu-answer-grabber)
// ---------------------------------------------------------------------------

let rendererPromise = null;

/**
 * Load the reviewed parse5 whitelist renderer once. Resolves to
 * { richHtmlToMarkdown } or null when the dependency is unavailable in this
 * environment (bare checkout). A null renderer NEVER degrades safety: markup
 * content simply fails closed (see projectSourceForSemanticRequest).
 */
export function loadAgentProjectionRenderer() {
  if (rendererPromise === null) {
    rendererPromise = import('../../zhihu-answer-grabber/src/rich-renderer.js')
      .then((mod) => (typeof mod?.richHtmlToMarkdown === 'function'
        ? { richHtmlToMarkdown: mod.richHtmlToMarkdown }
        : null))
      .catch(() => null);
  }
  return rendererPromise;
}

// ---------------------------------------------------------------------------
// code-body omission (V2 §9.2.4: DEFAULT OMIT + deterministic metadata marker)
// ---------------------------------------------------------------------------

/**
 * Replace every fenced code block in the renderer's Markdown output with the
 * bounded metadata marker. The renderer guarantees each fence is a line of
 * 3+ backticks (length > longest backtick run inside the body), so the scan
 * below is deterministic and cannot be escaped by body content.
 */
function omitCodeBodies(markdown) {
  const lines = String(markdown).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^(`{3,})\s*([^\s`][^`]*)?\s*$/.exec(lines[i]);
    if (!open) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const fenceLen = open[1].length;
    const closeRe = new RegExp(`^\`{${fenceLen}}\\s*$`);
    const body = [];
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j])) {
      body.push(lines[j]);
      j += 1;
    }
    const lang = (open[2] ?? '').trim();
    const langPart = /^[A-Za-z0-9_+-]{1,40}$/.test(lang) ? `language=${lang}` : 'language=unknown';
    out.push(`[CODE_BLOCK ${langPart} lines=${body.length} omitted_by_policy]`);
    i = j + 1;
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// fence-forgery neutralization (untrusted content must not create sources)
// ---------------------------------------------------------------------------

const FORGED_FENCE_PATTERNS = [
  [/\[\s*BEGIN\s+UNTRUSTED_DATA[^\]]*\]/gi, '（数据边界）'],
  [/\[\s*END\s+UNTRUSTED_DATA[^\]]*\]/gi, '（数据边界）'],
  [/UNTRUSTED_DATA/gi, '（数据边界）'],
  [/DATA_NOT_INSTRUCTION/gi, '（数据边界）'],
  // Bare `token=<n>` fragments (e.g. surviving fence-attribute remnants after
  // escaping): without framing they cannot create a source, but neutralizing
  // them deterministically removes the whole forgery class.
  [/\btoken\s*=\s*[0-9]+\b/gi, '（数据边界）'],
];

function neutralizeForgedFences(text) {
  let out = text;
  for (const [pattern, replacement] of FORGED_FENCE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// mechanical leak assertions (fail closed BEFORE the semantic fetch)
// ---------------------------------------------------------------------------

const SCHEME_WITH_AUTHORITY_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;

function assertProjectedTextIsSafe(text) {
  if (text.includes('<')) {
    throw new SafeProjectionError(ERR_ASSERTION_FAILED, 'projected content still contains raw markup ("<") — fail closed');
  }
  if (text.includes('```')) {
    throw new SafeProjectionError(ERR_ASSERTION_FAILED, 'projected content still contains a code fence — fail closed');
  }
  if (SCHEME_WITH_AUTHORITY_RE.test(text)) {
    throw new SafeProjectionError(ERR_ASSERTION_FAILED, 'projected content still contains a scheme:// reference (URL / file URI) — fail closed');
  }
  if (/UNTRUSTED_DATA|DATA_NOT_INSTRUCTION/i.test(text)) {
    throw new SafeProjectionError(ERR_ASSERTION_FAILED, 'projected content still contains source-framing tokens — fail closed');
  }
}

// ---------------------------------------------------------------------------
// single projection entrypoint
// ---------------------------------------------------------------------------

/**
 * Project ONE source's canonical raw content into the safe, inert,
 * structure-preserving Agent View text.
 *
 * @param {string} content canonical raw content (unchanged semantics; the
 *   canonical bytes/hash are never rewritten by this module)
 * @param {{ renderer?: { richHtmlToMarkdown: Function } | null }} [opts]
 *   renderer: preloaded via loadAgentProjectionRenderer(); null only in
 *   environments without the parse5 dependency, where markup content fails
 *   closed and plain text still gets the deterministic escape+sanitize path.
 * @returns {{ text: string, metadataOnly: boolean }}
 *   text: the safe inner projection text (the caller fences it as
 *   UNTRUSTED_DATA under a controller-issued opaque token).
 *   metadataOnly: true when nothing extractable remains after the policy —
 *   the caller MUST still run the real semantic analysis over the fenced
 *   source (with a deterministic metadata-only marker) and may then count it
 *   analyzed on a legal (possibly empty) result.
 * @throws {SafeProjectionError} coded fail-closed — NEVER a silent unsafe pass.
 */
export function projectSourceForSemanticRequest(content, opts = {}) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new SafeProjectionError(ERR_RENDER_FAILED, 'safe projection requires non-empty canonical content (fail closed)');
  }

  let structured;
  if (content.includes('<')) {
    // Markup content: the strict-whitelist parse5 renderer is REQUIRED.
    const renderer = opts.renderer ?? null;
    if (renderer === null) {
      throw new SafeProjectionError(
        ERR_RENDERER_REQUIRED,
        'markup content requires the parse5 whitelist renderer, which is unavailable in this environment — fail closed (never project raw HTML)',
      );
    }
    let markdown;
    try {
      markdown = renderer.richHtmlToMarkdown(content);
    } catch (error) {
      throw new SafeProjectionError(ERR_RENDER_FAILED, `safe projection rendering failed — fail closed (${error?.code ?? error?.name ?? 'error'})`);
    }
    structured = omitCodeBodies(markdown);
  } else {
    // Plain-text canonical content: same escape primitive the renderer applies
    // to every text node (no markup to parse, so no parser is needed).
    structured = escapeUntrustedMarkdownText(content);
  }

  // Ref neutralization (URL/protocol/path/percent/control chars) then fence
  // forgery neutralization, then the mechanical leak assertions.
  const neutralized = neutralizeForgedFences(sanitizeProjectionText(structured));
  const text = neutralized.trim();
  assertProjectedTextIsSafe(text);

  return {
    text,
    metadataOnly: !hasExtractableContent(text),
  };
}
