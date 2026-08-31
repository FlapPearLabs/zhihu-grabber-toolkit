/**
 * research-orchestration/lib/plan-contract.mjs
 *
 * P1-T04 — Minimum Persisted Research Plan Contract (D-3 interface).
 *
 * Authority (docs/specs/p1-cross-question-deep-research.md §4, Issue #36):
 * - §4.1 minimum planner output keeps six conceptual field classes:
 *     query variants / aspects / entities / opposing framings /
 *     terminology variants / source-group intent + constraints.
 * - §4.2 plan authority: a plan is ONLY a validated semantic-proposal artifact.
 *     It owns NO provider IO, NO source identity, NO source validity, NO selection,
 *     NO verification, NO canonical source truth, NO runtime routing.
 * - §4.3 identity separation: run identity = normalized user request + stable
 *     configuration identity (see state.mjs runIdentityHash); the stochastic plan
 *     contents never enter run identity. planHash identifies the concrete validated
 *     plan artifact and is the dependency identity downstream artifacts record so
 *     that a regenerated plan (changed planHash) makes them stale.
 * - invalid / unparseable plan → `planner_invalid` FAIL_CLOSED; natural-language
 *     free text alone NEVER becomes a validated plan; no silent best-effort
 *     coercion that changes semantic meaning.
 *
 * D-3 delegation: exact schema / validation bounds below are implementation
 * validation bounds (PLAN_MAX_*), deterministic and fail-closed (reject, never
 * truncate). Schema is strict: unknown fields at any level are rejected within
 * schemaVersion 1; additive evolution requires a new schemaVersion.
 *
 * Normalization (deterministic + contract-safe ONLY):
 * - string entries are trimmed; exact-duplicate list entries are deduped
 *   preserving first-occurrence order; optional sub-fields get fixed defaults
 *   (constraints → [], groupKey → null). Array ORDER is significant.
 * - key order in the artifact is canonicalized for hashing (sorted keys).
 *
 * Security / privacy boundary (ticket SECURITY_GATE):
 * - plan string fields must not contain credential-shaped values or
 *   machine-private filesystem paths; violations are rejected (fail-closed),
 *   not sanitized. These are deterministic shape guards, not proof of secrecy.
 * - no network IO, no credential handling in this module; persistence is
 *   work-dir-relative only.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PLAN_SCHEMA_VERSION = 1;

/** Canonical persisted plan artifact name (work-dir-relative, like selection.json conventions). */
export const PLAN_ARTIFACT_FILENAME = 'research-plan.json';

/** Frozen machine-readable failure identities (Spec §10.2: VALID_FALSE / UNPARSEABLE distinct). */
export const PLAN_FAILURE_PLANNER_INVALID = 'planner_invalid';
export const PLAN_FAILURE_PLAN_MISSING = 'plan_missing';

/** Stale-propagation reasons for the downstream dependency seam. */
export const STALE_REASON_PLAN_HASH_MISMATCH = 'plan_hash_mismatch';
export const STALE_REASON_PLAN_DEPENDENCY_MISSING = 'plan_dependency_missing';
export const STALE_REASON_PLAN_DEPENDENCY_INVALID = 'plan_dependency_invalid';

/**
 * D-3 delegated validation bounds (fail-closed; DEFAULT_REQUIRES nothing — they are
 * implementation validation bounds, not product thresholds).
 */
export const PLAN_MAX_ENTRIES_PER_LIST = 32;
export const PLAN_MAX_STRING_LENGTH = 300;
export const PLAN_MAX_INPUT_JSON_CHARS = 262_144;

/** Hash domain separator (planHash = sha256(`${PLAN_HASH_DOMAIN}:${canonicalJson}`)). */
export const PLAN_HASH_DOMAIN = 'research-plan-contract/v1';

/**
 * planHash identity format: exactly 64 lowercase hexadecimal characters (SHA-256 hex
 * digest). A reusable plan dependency identity MUST be a syntactically valid planHash
 * produced by this contract; any other string is a malformed identity and MUST NOT
 * imply reuse (fail-closed stale-propagation contract). Two identical malformed strings
 * therefore can NEVER become reusable.
 */
const PLAN_HASH_FORMAT = /^[0-9a-f]{64}$/;

export function isValidPlanHashFormat(hash) {
  return typeof hash === 'string' && PLAN_HASH_FORMAT.test(hash);
}

const PLAN_KEYS = [
  'schemaVersion',
  'queryVariants',
  'aspects',
  'entities',
  'opposingFramings',
  'terminologyVariants',
  'sourceGroupIntents',
];

const NON_EMPTY_LIST_FIELDS = ['queryVariants', 'aspects']; // retrieval cannot run without these
const STRING_LIST_FIELDS = ['queryVariants', 'aspects', 'entities', 'opposingFramings'];

/**
 * Deterministic string guards (fail-closed shape checks).
 * - CREDENTIAL_SHAPE: credential field/assignment shapes (incl. the repo-known z_c0 auth cookie).
 * - PRIVATE_PATH_SHAPE: user-machine-private filesystem paths (POSIX /Users|/home, home-relative ~,
 *   Windows profile roots). System paths like /etc/hosts and plain URLs are NOT machine-private.
 *   Detection is anchored to a string/token boundary, so a profile path is rejected when it
 *   appears ANYWHERE — including mid-sentence and across newlines — not only at position 0.
 */
const CREDENTIAL_SHAPE =
  /(?:z_c0\s*=|(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|cookie|session[_-]?id)\s*[:=])/i;
const PRIVATE_PATH_SHAPE =
  /(?:\/Users\/|\/home\/|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|(?:^|[\s"'<>\u2018\u2019\u201c\u201d])~[/\w.-])/;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(issues) {
  return { ok: false, reason: PLAN_FAILURE_PLANNER_INVALID, issues };
}

function checkStringLeaf(value, issuePath, issues) {
  if (typeof value !== 'string') {
    issues.push({ path: issuePath, message: 'must be a string (no coercion)' });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push({ path: issuePath, message: 'must be a non-empty string' });
    return null;
  }
  if (trimmed.length > PLAN_MAX_STRING_LENGTH) {
    issues.push({ path: issuePath, message: `must be at most ${PLAN_MAX_STRING_LENGTH} characters` });
    return null;
  }
  if (CREDENTIAL_SHAPE.test(trimmed)) {
    issues.push({ path: issuePath, message: 'matches the prohibited credential-shape boundary' });
    return null;
  }
  if (PRIVATE_PATH_SHAPE.test(trimmed)) {
    issues.push({ path: issuePath, message: 'looks like a machine-private filesystem path (prohibited)' });
    return null;
  }
  return trimmed;
}

/**
 * Validate a string-list field; returns the normalized (trimmed + deduped) entries,
 * or null when issues were recorded.
 */
function checkStringList(value, field, issues, { minEntries = 0 } = {}) {
  if (!Array.isArray(value)) {
    issues.push({ path: field, message: 'must be an array' });
    return null;
  }
  if (value.length < minEntries) {
    issues.push({ path: field, message: `must contain at least ${minEntries} entr${minEntries === 1 ? 'y' : 'ies'}` });
    return null;
  }
  if (value.length > PLAN_MAX_ENTRIES_PER_LIST) {
    issues.push({ path: field, message: `must contain at most ${PLAN_MAX_ENTRIES_PER_LIST} entries` });
    return null;
  }
  const out = [];
  const seen = new Set();
  let ok = true;
  for (let i = 0; i < value.length; i += 1) {
    const trimmed = checkStringLeaf(value[i], `${field}[${i}]`, issues);
    if (trimmed === null) {
      ok = false;
      continue;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return ok ? out : null;
}

/** Validate terminologyVariants entries: strict { term, variants[] }. */
function checkTerminologyVariants(value, issues) {
  if (!Array.isArray(value)) {
    issues.push({ path: 'terminologyVariants', message: 'must be an array' });
    return null;
  }
  if (value.length > PLAN_MAX_ENTRIES_PER_LIST) {
    issues.push({ path: 'terminologyVariants', message: `must contain at most ${PLAN_MAX_ENTRIES_PER_LIST} entries` });
    return null;
  }
  const out = [];
  let ok = true;
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (!isPlainObject(entry)) {
      issues.push({ path: `terminologyVariants[${i}]`, message: 'must be a plain object { term, variants }' });
      ok = false;
      continue;
    }
    const allowed = ['term', 'variants'];
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) {
        issues.push({ path: `terminologyVariants[${i}].${key}`, message: 'unknown field (fail-closed)' });
        ok = false;
      }
    }
    const term = checkStringLeaf(entry.term, `terminologyVariants[${i}].term`, issues);
    const variants = checkStringList(entry.variants, `terminologyVariants[${i}].variants`, issues, { minEntries: 1 });
    if (term === null || variants === null) {
      ok = false;
      continue;
    }
    out.push({ term, variants });
  }
  return ok ? out : null;
}

/**
 * Validate sourceGroupIntents entries: { intent, constraints[], groupKey|null }.
 * constraints and groupKey are optional ("where applicable") and normalize to fixed defaults.
 */
function checkSourceGroupIntents(value, issues) {
  if (!Array.isArray(value)) {
    issues.push({ path: 'sourceGroupIntents', message: 'must be an array' });
    return null;
  }
  if (value.length > PLAN_MAX_ENTRIES_PER_LIST) {
    issues.push({ path: 'sourceGroupIntents', message: `must contain at most ${PLAN_MAX_ENTRIES_PER_LIST} entries` });
    return null;
  }
  const out = [];
  let ok = true;
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (!isPlainObject(entry)) {
      issues.push({ path: `sourceGroupIntents[${i}]`, message: 'must be a plain object { intent, constraints?, groupKey? }' });
      ok = false;
      continue;
    }
    const allowed = ['intent', 'constraints', 'groupKey'];
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) {
        issues.push({ path: `sourceGroupIntents[${i}].${key}`, message: 'unknown field (fail-closed)' });
        ok = false;
      }
    }
    const intent = checkStringLeaf(entry.intent, `sourceGroupIntents[${i}].intent`, issues);
    const constraints =
      entry.constraints == null
        ? []
        : checkStringList(entry.constraints, `sourceGroupIntents[${i}].constraints`, issues);
    const groupKey = entry.groupKey == null ? null : checkStringLeaf(entry.groupKey, `sourceGroupIntents[${i}].groupKey`, issues);
    if (intent === null || constraints === null || groupKey === null && entry.groupKey != null) {
      ok = false;
      continue;
    }
    out.push({ intent, constraints, groupKey });
  }
  return ok ? out : null;
}

/**
 * Structured validation of a raw plan input (already-parsed object or any value).
 * Returns { ok: true, plan } with the deterministically normalized plan, or
 * { ok: false, reason: 'planner_invalid', issues: [{ path, message }] } (fail-closed;
 * ALL issues are collected in a deterministic order; no coercion of any value).
 */
export function validatePlanInput(raw) {
  const issues = [];
  if (!isPlainObject(raw)) {
    return fail([{ path: '', message: 'plan must be a plain JSON object' }]);
  }

  // Exact key set: every conceptual class must be present (classes cannot be compressed away).
  const keys = Object.keys(raw);
  for (const key of PLAN_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      issues.push({ path: key, message: 'missing required plan field' });
    }
  }
  for (const key of keys) {
    if (!PLAN_KEYS.includes(key)) {
      issues.push({ path: key, message: 'unknown plan field (fail-closed within schemaVersion 1)' });
    }
  }
  if (issues.length > 0) return fail(issues);

  if (raw.schemaVersion !== PLAN_SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: `must be exactly ${PLAN_SCHEMA_VERSION} (unsupported schema is fail-closed)` });
  }

  const normalized = { schemaVersion: PLAN_SCHEMA_VERSION };

  for (const field of STRING_LIST_FIELDS) {
    const minEntries = NON_EMPTY_LIST_FIELDS.includes(field) ? 1 : 0;
    const list = checkStringList(raw[field], field, issues, { minEntries });
    if (list === null) continue;
    normalized[field] = list;
  }

  const terminology = checkTerminologyVariants(raw.terminologyVariants, issues);
  if (terminology !== null) normalized.terminologyVariants = terminology;

  const groups = checkSourceGroupIntents(raw.sourceGroupIntents, issues);
  if (groups !== null) normalized.sourceGroupIntents = groups;

  if (issues.length > 0) return fail(issues);
  return { ok: true, plan: normalized };
}

/**
 * Validate a persisted/transmitted plan JSON string. Unparseable, oversized, or
 * schema-invalid input → { ok: false, reason: 'planner_invalid', issues }.
 * Natural-language free text alone can never become a validated plan.
 */
export function validatePlanJson(text) {
  if (typeof text !== 'string') {
    return fail([{ path: '', message: 'plan JSON input must be a string' }]);
  }
  if (text.length > PLAN_MAX_INPUT_JSON_CHARS) {
    return fail([{ path: '', message: `plan JSON exceeds the ${PLAN_MAX_INPUT_JSON_CHARS}-character input bound` }]);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail([{ path: '', message: 'plan JSON is unparseable' }]);
  }
  return validatePlanInput(parsed);
}

/** Deterministic canonical serialization (recursively sorted object keys; arrays keep order). */
export function canonicalPlanJson(plan) {
  return JSON.stringify(canonicalize(plan));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/**
 * Deterministic planHash over the canonical serialization of the VALIDATED plan.
 * Invalid input → throw with .code = 'planner_invalid' (fail-closed; nothing is hashed).
 * Object key order is canonicalized; array order is significant (documented semantics).
 */
export function planHash(plan) {
  const v = validatePlanInput(plan);
  if (!v.ok) {
    const err = new Error('plan invalid (fail-closed): refusing to hash');
    err.code = PLAN_FAILURE_PLANNER_INVALID;
    err.issues = v.issues;
    throw err;
  }
  return sha256(`${PLAN_HASH_DOMAIN}:${canonicalPlanJson(v.plan)}`);
}

/**
 * Persistence contract: validate-then-write the canonical artifact inside workDir.
 * Only validated plans are ever written; invalid input → { ok:false, reason, issues }
 * and NOTHING is written. Returns { ok:true, planHash, file } (work-relative name).
 */
export function persistPlan(workDir, plan) {
  const v = validatePlanInput(plan);
  if (!v.ok) {
    return { ok: false, reason: PLAN_FAILURE_PLANNER_INVALID, issues: v.issues };
  }
  const hash = planHash(v.plan);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, PLAN_ARTIFACT_FILENAME), `${JSON.stringify(v.plan, null, 2)}\n`);
  return { ok: true, planHash: hash, file: PLAN_ARTIFACT_FILENAME };
}

/**
 * Load + RE-VALIDATE the persisted plan artifact (FILE EXISTS != VALID CACHE).
 * Returns { ok:true, plan, planHash } or
 * { ok:false, reason: 'plan_missing' | 'planner_invalid', issues? }.
 */
export function loadPlan(workDir) {
  const file = path.join(workDir, PLAN_ARTIFACT_FILENAME);
  if (!fs.existsSync(file)) {
    return { ok: false, reason: PLAN_FAILURE_PLAN_MISSING };
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return fail([{ path: '', message: 'plan artifact unreadable' }]);
  }
  const v = validatePlanJson(text);
  if (!v.ok) return v;
  return { ok: true, plan: v.plan, planHash: planHash(v.plan) };
}

/**
 * Stale-propagation seam (Spec §4.3 boundary): downstream artifacts record the
 * planHash they were produced from; the controller compares it with the current
 * valid plan's planHash.
 *
 * A dependency identity is only trusted when it is a syntactically valid planHash
 * (64 lowercase hex chars from this contract). Malformed identities MUST NOT imply
 * reuse, even if identical — this is the fail-closed stale-propagation contract.
 * - both valid + equal          → { reusable: true,  stale: false, reason: null }
 * - both valid + different      → { reusable: false, stale: true,  reason: 'plan_hash_mismatch' }
 * - malformed (wrong format)    → { reusable: false, stale: true,  reason: 'plan_dependency_invalid' }
 * - missing/empty (no identity) → { reusable: false, stale: true,  reason: 'plan_dependency_missing' }
 */
export function planDependencyStatus({ currentPlanHash, dependentPlanHash } = {}) {
  const currentOk = isValidPlanHashFormat(currentPlanHash);
  const dependentOk = isValidPlanHashFormat(dependentPlanHash);
  if (!currentOk || !dependentOk) {
    // Distinguish "no identity recorded" (missing) from "identity present but malformed"
    // — both are fail-closed non-reusable, with honest distinct reasons.
    const isMissing = (h) => !(typeof h === 'string' && h.length > 0);
    const reason =
      isMissing(currentPlanHash) || isMissing(dependentPlanHash)
        ? STALE_REASON_PLAN_DEPENDENCY_MISSING
        : STALE_REASON_PLAN_DEPENDENCY_INVALID;
    return { reusable: false, stale: true, reason };
  }
  if (currentPlanHash === dependentPlanHash) {
    return { reusable: true, stale: false, reason: null };
  }
  return { reusable: false, stale: true, reason: STALE_REASON_PLAN_HASH_MISMATCH };
}

/**
 * Compare two plan artifacts by planHash.
 * Returns { changed, previousPlanHash, nextPlanHash }; invalid input throws (fail-closed).
 */
export function comparePlans(previousPlan, nextPlan) {
  const previousPlanHash = planHash(previousPlan);
  const nextPlanHash = planHash(nextPlan);
  return { changed: previousPlanHash !== nextPlanHash, previousPlanHash, nextPlanHash };
}
