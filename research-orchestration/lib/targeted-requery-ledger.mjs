// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-ledger.mjs
 *
 * P2A-T01 (#113) — Targeted Re-query gap ledger artifact + gap identity.
 *
 * Authority (FROZEN; this module must not reinterpret, generalize or "improve" it):
 *   - docs/specs/p2-ari-f02-targeted-requery.md      §5 D1, §6, §10, §12   (APPROVED)
 *   - docs/architecture/key-decisions.md             D12-1, D12-8
 *   - docs/planning/..._SEAM_CONTRACT_V1.md          E.1 / E.2 / E.3 / E.8
 *   - docs/planning/..._SEAM_MAP_V1.md               S1 (output) / S4 (state face)
 *
 * Ownership boundary (Ticket Graph V1 §4 — ONE_ACTIVE_WRITER_PER_BRANCH):
 *   T01 OWNS  : closed gapType enum, subjectKey construction, gapIdentityCore /
 *               gapId, deterministic ordering comparator, ledger read/write
 *               primitives + schema validation, work-dir-relative paths.
 *   T01 DOES NOT OWN (and this module deliberately contains NONE of):
 *               gap diagnosis (T03), authorization / dedupe / budget (T05),
 *               lifecycle + durable commit + replay (T06), resolution (T08),
 *               any retrieval IO, any ResearchCoverageState field or schema
 *               change, any artifact-walk trust-set extension.
 *
 * D12-1: the ledger is a controller-owned DERIVED orchestration state, a SIBLING
 * of ResearchCoverageState — anchored by planHash, never written into it (adding
 * fields there would be a COVERAGE_STATE_SCHEMA_VERSION change, i.e. a P1
 * authority change that #108 must not perform in passing).
 *
 * Identity (E.2) — exactly one definition, no second formula:
 *   gapIdentityCore = sha256('p2-ari-gap-core/v1:' + canonicalJson({
 *                       planHash, occurrenceId, gapType, subjectKey }))   ← no diagnosisRound
 *   gapId           = gapIdentityCore + ':' + diagnosisRound
 * `diagnosisRound` is an AUDIT-ONLY field (D12-8): it enters no dedupe key, no
 * attempt/count key, and no cross-round core identity.
 *
 * Determinism: identity contains no timestamp, no random value, no unbound
 * artifact. The persisted artifact is byte-deterministic (canonical record
 * order + canonical key order) so that identical logical input always produces
 * identical bytes and an identical hash.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isPlanBoundarySafeString, isValidPlanHashFormat } from './plan-contract.mjs';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Typed error code for every fail-closed rejection in this module. */
export const LEDGER_ERROR_INVALID = 'p2a_targeted_requery_ledger_invalid';

/** E.1 closed MVP enum (three members only). */
export const GAP_TYPE_ASPECT = 'ASPECT_GAP';
export const GAP_TYPE_CONTRADICTION = 'CONTRADICTION_GAP';
export const GAP_TYPE_AUTHORITY = 'AUTHORITY_GAP';
/** E.1: anything outside the closed enum is recorded as this, and may not become a retrieval action. */
export const GAP_TYPE_UNKNOWN = 'UNKNOWN_GAP_TYPE';

/** The closed enum itself. `UNKNOWN_GAP_TYPE` is deliberately NOT a member. */
export const GAP_TYPES = Object.freeze([GAP_TYPE_ASPECT, GAP_TYPE_CONTRADICTION, GAP_TYPE_AUTHORITY]);

/** E.2 hash domain prefix. */
export const GAP_IDENTITY_DOMAIN = 'p2-ari-gap-core/v1';

/** Ledger artifact schema id + work-relative filename (D12-1 sibling artifact). */
export const LEDGER_SCHEMA = 'p2-ari-targeted-requery-ledger/v1';
export const LEDGER_FILENAME = 'targeted-requery-ledger.json';

const CLOSED_GAP_TYPE_SET = new Set(GAP_TYPES);
const RECORDABLE_GAP_TYPE_SET = new Set([...GAP_TYPES, GAP_TYPE_UNKNOWN]);

const SUBJECT_PREFIX_ASPECT = 'aspect:';
const SUBJECT_PREFIX_OPPOSING = 'opposing:';
const SUBJECT_PREFIX_INTENT = 'intent:';
const SUBJECT_PREFIX_INTENT_FREEFORM = 'intent-freeform:';

const LEDGER_TOP_LEVEL_KEYS = Object.freeze(['diagnosedGaps', 'occurrenceId', 'planHash', 'schema']);
const GAP_RECORD_KEYS = Object.freeze([
  'declaredGapType',
  'diagnosisRound',
  'gapId',
  'gapIdentityCore',
  'gapType',
  'occurrenceId',
  'planHash',
  'subjectKey',
]);
const GAP_ID_SHAPE = /^([0-9a-f]{64}):(\d+)$/;

// ---------------------------------------------------------------------------
// small shared helpers (module-private; no shared module is created)
// ---------------------------------------------------------------------------

function ledgerError(message) {
  const err = new Error(message);
  err.code = LEDGER_ERROR_INVALID;
  return err;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/** Stable JSON with recursively sorted object keys (arrays keep their order). */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  if (actual.length !== expectedKeys.length) return false;
  return actual.every((key, index) => key === expectedKeys[index]);
}

// ---------------------------------------------------------------------------
// E.1 — gapType closure
// ---------------------------------------------------------------------------

/**
 * E.1: the enum is CLOSED. Any value that is not one of the three frozen members
 * (named-but-unimplemented types, unknown types, non-strings, malformed casing)
 * normalizes to `UNKNOWN_GAP_TYPE`. It stays RECORDABLE but, per E.1, must not
 * be turned into a retrieval action.
 */
export function normalizeGapType(raw) {
  return typeof raw === 'string' && CLOSED_GAP_TYPE_SET.has(raw) ? raw : GAP_TYPE_UNKNOWN;
}

/**
 * E.1 type-closure predicate: does this gapType carry retrieval-action authority?
 * This is a TYPE fact only. It performs no authorization decision — authorization
 * (E.5), budget, and dedupe belong to T05 and are deliberately absent here.
 */
export function gapTypeAllowsRetrievalAction(gapType) {
  return typeof gapType === 'string' && CLOSED_GAP_TYPE_SET.has(gapType);
}

// ---------------------------------------------------------------------------
// E.3 — subjectKey
// ---------------------------------------------------------------------------

/**
 * E.3/E.6 normalization, applied to controller-mechanical subject material:
 * trim → Unicode NFC → collapse consecutive whitespace → casefold.
 *
 * Returns the normalized string, or `null` when the input cannot be a safe
 * subject (not a string / empty / fails the plan boundary). The RAW value is
 * gated FIRST and the normalized value is gated AGAIN, so normalization can
 * never weaken the existing plan-boundary lens (casefolding a machine-private
 * path must not smuggle it past the gate).
 */
export function normalizeSubjectString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!isPlanBoundarySafeString(trimmed)) return null;
  const folded = trimmed.normalize('NFC').replace(/\s+/gu, ' ').toLowerCase();
  if (!isPlanBoundarySafeString(folded)) return null;
  return folded;
}

function requireNormalizedSubject(value, label) {
  const normalized = normalizeSubjectString(value);
  if (normalized === null) {
    throw ledgerError(`${label} must be a non-empty plan-boundary-safe string`);
  }
  return normalized;
}

/** E.3 branch 1: `'aspect:' + 规范化 plan.aspects[i]`. */
export function aspectSubjectKey(aspect) {
  return `${SUBJECT_PREFIX_ASPECT}${requireNormalizedSubject(aspect, 'aspect')}`;
}

/** E.3 branch 2: `'opposing:' + 规范化 plan.opposingFramings[i]`. */
export function opposingFramingSubjectKey(framing) {
  return `${SUBJECT_PREFIX_OPPOSING}${requireNormalizedSubject(framing, 'opposingFraming')}`;
}

/**
 * E.3 branch 3: `'intent:' + 规范化 plan.sourceGroupIntents[i].intent`.
 *
 * When no plan-owned intent exists, E.3 requires
 * `'intent-freeform:' + sha256(normalizedQueryIntent)` where normalizedQueryIntent
 * is the controller-validated `expectedInformation`. It must NEVER degrade to a
 * constant (that would collapse every intent-free AUTHORITY_GAP into one
 * identity). When neither a plan-owned intent nor a valid expectedInformation is
 * present there is no defensible subject, so this FAILS CLOSED.
 */
export function sourceGroupIntentSubjectKey({ intent, queryIntent } = {}) {
  const normalizedIntent = normalizeSubjectString(intent);
  if (normalizedIntent !== null) return `${SUBJECT_PREFIX_INTENT}${normalizedIntent}`;

  const normalizedQueryIntent = normalizeSubjectString(queryIntent);
  if (normalizedQueryIntent !== null) {
    return `${SUBJECT_PREFIX_INTENT_FREEFORM}${sha256(normalizedQueryIntent)}`;
  }

  throw ledgerError(
    'AUTHORITY_GAP requires a plan-owned sourceGroupIntent.intent or a validated '
    + 'expectedInformation; refusing to fall back to a constant subject identity',
  );
}

/**
 * Resolve a `subject` descriptor into a controller-mechanical subjectKey.
 *
 * The three frozen gap types each have exactly one E.3 construction. For
 * `UNKNOWN_GAP_TYPE` the frozen authority defines no subject construction rule,
 * so this primitive requires the controller (the only writer) to declare the
 * subject explicitly rather than inventing a prefix or a constant. A mismatch
 * between the gap type and the subject construction fails closed.
 */
function resolveSubjectKey(gapType, subject) {
  if (!isPlainObject(subject)) {
    throw ledgerError('gap record requires a subject descriptor');
  }
  if (gapType === GAP_TYPE_ASPECT) {
    if (subject.kind !== 'aspect') throw ledgerError('ASPECT_GAP requires subject.kind === "aspect"');
    return aspectSubjectKey(subject.value);
  }
  if (gapType === GAP_TYPE_CONTRADICTION) {
    if (subject.kind !== 'opposingFraming') {
      throw ledgerError('CONTRADICTION_GAP requires subject.kind === "opposingFraming"');
    }
    return opposingFramingSubjectKey(subject.value);
  }
  if (gapType === GAP_TYPE_AUTHORITY) {
    if (subject.kind !== 'sourceGroupIntent') {
      throw ledgerError('AUTHORITY_GAP requires subject.kind === "sourceGroupIntent"');
    }
    return sourceGroupIntentSubjectKey({ intent: subject.intent, queryIntent: subject.queryIntent });
  }
  if (subject.kind !== 'explicit') {
    throw ledgerError(
      'UNKNOWN_GAP_TYPE has no frozen subject construction; pass subject.kind === "explicit" '
      + 'with a controller-declared subjectKey',
    );
  }
  return requireNormalizedSubject(subject.subjectKey, 'explicit subjectKey');
}

// ---------------------------------------------------------------------------
// E.2 — identity
// ---------------------------------------------------------------------------

/**
 * E.2: `gapIdentityCore = sha256('p2-ari-gap-core/v1:' + canonicalJson({planHash,
 * occurrenceId, gapType, subjectKey}))`. Exactly four inputs are read; a caller
 * leaking `diagnosisRound` cannot change the core (D12-8).
 */
export function computeGapIdentityCore(input = {}) {
  const { planHash, occurrenceId, gapType, subjectKey } = input;
  if (typeof planHash !== 'string' || !isValidPlanHashFormat(planHash)) {
    throw ledgerError('planHash must be a 64-hex plan contract hash');
  }
  if (typeof occurrenceId !== 'string' || occurrenceId.length === 0) {
    throw ledgerError('occurrenceId must be a non-empty string');
  }
  if (typeof gapType !== 'string' || !RECORDABLE_GAP_TYPE_SET.has(gapType)) {
    throw ledgerError('gapType must be a closed-enum member or UNKNOWN_GAP_TYPE');
  }
  if (typeof subjectKey !== 'string' || subjectKey.length === 0) {
    throw ledgerError('subjectKey must be a non-empty string');
  }
  // Identity must be canonical by construction: the stored subjectKey is always
  // the normalized form, so recomputation from persisted bytes is stable.
  if (normalizeSubjectString(subjectKey) !== subjectKey) {
    throw ledgerError('subjectKey must already be in canonical (normalized) form');
  }
  return sha256(`${GAP_IDENTITY_DOMAIN}:${canonicalJson({ planHash, occurrenceId, gapType, subjectKey })}`);
}

/** E.2: `gapId = gapIdentityCore + ':' + diagnosisRound` (round is audit-only). */
export function makeGapId(gapIdentityCore, diagnosisRound) {
  if (typeof gapIdentityCore !== 'string' || !/^[0-9a-f]{64}$/.test(gapIdentityCore)) {
    throw ledgerError('gapIdentityCore must be 64 lowercase hex characters');
  }
  if (!Number.isInteger(diagnosisRound) || diagnosisRound < 0) {
    throw ledgerError('diagnosisRound must be a non-negative integer');
  }
  return `${gapIdentityCore}:${diagnosisRound}`;
}

/**
 * Split a well-formed gapId back into its stable core (the ONLY part allowed in
 * dedupe / attempt / cross-round identity keys, D12-8). Malformed ids return
 * `null` — never a guessed core.
 */
export function gapIdentityCoreOf(gapId) {
  if (typeof gapId !== 'string') return null;
  const match = GAP_ID_SHAPE.exec(gapId);
  return match === null ? null : match[1];
}

// ---------------------------------------------------------------------------
// E.8 — deterministic ordering
// ---------------------------------------------------------------------------

function gapIdOf(record) {
  return isPlainObject(record) && typeof record.gapId === 'string' ? record.gapId : '';
}

/**
 * E.8: gaps competing for budget are consumed in ascending `gapId` order
 * (hexadecimal string comparison). The comparator is total and deterministic: a
 * tie on gapId falls back to the canonical JSON of the record, so the persisted
 * order never depends on insertion order or on model-supplied materiality /
 * confidence scores.
 */
export function compareGapsByGapId(a, b) {
  const idA = gapIdOf(a);
  const idB = gapIdOf(b);
  if (idA < idB) return -1;
  if (idA > idB) return 1;
  const jsonA = canonicalJson(a ?? null);
  const jsonB = canonicalJson(b ?? null);
  if (jsonA < jsonB) return -1;
  if (jsonA > jsonB) return 1;
  return 0;
}

/** Non-mutating deterministic ordering of gap records (E.8). */
export function sortGapsByGapId(records) {
  if (!Array.isArray(records)) throw ledgerError('records must be an array');
  return [...records].sort(compareGapsByGapId);
}

// ---------------------------------------------------------------------------
// gap records
// ---------------------------------------------------------------------------

/**
 * Build a single gap record.
 *
 * The record is grounded ONLY in frozen fields; Issue #108 §4's `materiality` /
 * `confidence` are audit-only in the MVP and are deliberately NOT part of the
 * schema (D12-5 forbids letting model scores influence ordering or authorization).
 */
export function makeGapRecord({ planHash, occurrenceId, diagnosisRound, gapType, subject } = {}) {
  if (typeof planHash !== 'string' || !isValidPlanHashFormat(planHash)) {
    throw ledgerError('planHash must be a 64-hex plan contract hash');
  }
  if (typeof occurrenceId !== 'string' || occurrenceId.length === 0) {
    throw ledgerError('occurrenceId must be a non-empty string');
  }
  if (!Number.isInteger(diagnosisRound) || diagnosisRound < 0) {
    throw ledgerError('diagnosisRound must be a non-negative integer');
  }
  const declaredGapType = typeof gapType === 'string' ? gapType : String(gapType ?? '');
  // audit copy of what the controller declared (bounded + boundary-safe)
  const declaredSafe = declaredGapType.length === 0 ? GAP_TYPE_UNKNOWN : declaredGapType;
  if (normalizeSubjectString(declaredSafe) === null) {
    throw ledgerError('declaredGapType must be a boundary-safe string');
  }
  const normalizedGapType = normalizeGapType(declaredGapType);
  const subjectKey = resolveSubjectKey(normalizedGapType, subject);
  const gapIdentityCore = computeGapIdentityCore({
    planHash,
    occurrenceId,
    gapType: normalizedGapType,
    subjectKey,
  });
  return {
    declaredGapType: declaredSafe,
    diagnosisRound,
    gapId: makeGapId(gapIdentityCore, diagnosisRound),
    gapIdentityCore,
    gapType: normalizedGapType,
    occurrenceId,
    planHash,
    subjectKey,
  };
}

// ---------------------------------------------------------------------------
// ledger artifact
// ---------------------------------------------------------------------------

/** Fresh, empty ledger anchored to one (planHash, occurrenceId) binding. */
export function createLedger({ planHash, occurrenceId } = {}) {
  if (typeof planHash !== 'string' || !isValidPlanHashFormat(planHash)) {
    throw ledgerError('planHash must be a 64-hex plan contract hash');
  }
  if (typeof occurrenceId !== 'string' || occurrenceId.length === 0) {
    throw ledgerError('occurrenceId must be a non-empty string');
  }
  return {
    diagnosedGaps: [],
    occurrenceId,
    planHash,
    schema: LEDGER_SCHEMA,
  };
}

/** Rebuild one record in canonical key order (byte-deterministic persistence). */
function canonicalRecord(record) {
  return {
    declaredGapType: record.declaredGapType,
    diagnosisRound: record.diagnosisRound,
    gapId: record.gapId,
    gapIdentityCore: record.gapIdentityCore,
    gapType: record.gapType,
    occurrenceId: record.occurrenceId,
    planHash: record.planHash,
    subjectKey: record.subjectKey,
  };
}

/** Rebuild the whole ledger in canonical order + canonical key order. */
function canonicalLedger(ledger) {
  return {
    diagnosedGaps: sortGapsByGapId(ledger.diagnosedGaps.map(canonicalRecord)),
    occurrenceId: ledger.occurrenceId,
    planHash: ledger.planHash,
    schema: ledger.schema,
  };
}

function validateGapRecord(record, ledger) {
  if (!hasExactKeys(record, GAP_RECORD_KEYS)) {
    return 'gap record has an unexpected key set';
  }
  if (typeof record.planHash !== 'string' || !isValidPlanHashFormat(record.planHash)) {
    return 'gap record planHash is malformed';
  }
  if (record.planHash !== ledger.planHash) return 'gap record planHash does not match the ledger anchor';
  if (typeof record.occurrenceId !== 'string' || record.occurrenceId.length === 0) {
    return 'gap record occurrenceId is malformed';
  }
  if (record.occurrenceId !== ledger.occurrenceId) {
    return 'gap record occurrenceId does not match the ledger anchor';
  }
  if (typeof record.gapType !== 'string' || !RECORDABLE_GAP_TYPE_SET.has(record.gapType)) {
    return 'gap record gapType is outside the closed enum';
  }
  if (normalizeSubjectString(record.declaredGapType) === null) {
    return 'gap record declaredGapType is not boundary-safe';
  }
  // declaredGapType must be a faithful audit copy: a closed member keeps its own
  // name, anything else normalizes to UNKNOWN_GAP_TYPE.
  if (normalizeGapType(record.declaredGapType) !== record.gapType) {
    return 'gap record declaredGapType does not normalize to its gapType';
  }
  if (!Number.isInteger(record.diagnosisRound) || record.diagnosisRound < 0) {
    return 'gap record diagnosisRound must be a non-negative integer';
  }
  if (typeof record.subjectKey !== 'string' || normalizeSubjectString(record.subjectKey) !== record.subjectKey) {
    return 'gap record subjectKey is not a canonical boundary-safe string';
  }
  if (typeof record.gapIdentityCore !== 'string' || !/^[0-9a-f]{64}$/.test(record.gapIdentityCore)) {
    return 'gap record gapIdentityCore is malformed';
  }
  // Self-verifying: recompute the frozen E.2 formula from the persisted fields.
  const recomputed = computeGapIdentityCore({
    planHash: record.planHash,
    occurrenceId: record.occurrenceId,
    gapType: record.gapType,
    subjectKey: record.subjectKey,
  });
  if (recomputed !== record.gapIdentityCore) return 'gap record identity does not match the frozen formula';
  if (record.gapId !== `${record.gapIdentityCore}:${record.diagnosisRound}`) {
    return 'gap record gapId is not gapIdentityCore + ":" + diagnosisRound';
  }
  return null;
}

/**
 * Fail-closed schema validation. Returns `{ ok: true, validated }` or
 * `{ ok: false, reason }`. Nothing is repaired, normalized or guessed: a
 * foreign/tampered/stale-shaped ledger is simply refused.
 */
export function validateLedger(ledger) {
  if (!hasExactKeys(ledger, LEDGER_TOP_LEVEL_KEYS)) {
    return { ok: false, reason: 'ledger has an unexpected key set' };
  }
  if (ledger.schema !== LEDGER_SCHEMA) return { ok: false, reason: 'ledger schema id is not recognised' };
  if (typeof ledger.planHash !== 'string' || !isValidPlanHashFormat(ledger.planHash)) {
    return { ok: false, reason: 'ledger planHash is malformed' };
  }
  if (typeof ledger.occurrenceId !== 'string' || ledger.occurrenceId.length === 0) {
    return { ok: false, reason: 'ledger occurrenceId is malformed' };
  }
  if (!Array.isArray(ledger.diagnosedGaps)) return { ok: false, reason: 'diagnosedGaps must be an array' };

  const seenGapIds = new Set();
  for (const record of ledger.diagnosedGaps) {
    const reason = validateGapRecord(record, ledger);
    if (reason !== null) return { ok: false, reason };
    // append-only audit trail: one gap identity may be recorded once per round
    if (seenGapIds.has(record.gapId)) return { ok: false, reason: `duplicate gapId in ledger: ${record.gapId}` };
    seenGapIds.add(record.gapId);
  }

  const ordered = sortGapsByGapId(ledger.diagnosedGaps);
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i] !== ledger.diagnosedGaps[i]) {
      return { ok: false, reason: 'diagnosedGaps are not in canonical E.8 order' };
    }
  }
  return { ok: true, validated: canonicalLedger(ledger) };
}

/**
 * Append-only primitive: returns a NEW ledger with the record appended in
 * canonical order. The input ledger is never mutated, and no earlier record is
 * rewritten (append-only audit history). Convergence across diagnosis rounds is
 * expressed by an identical `gapIdentityCore` with a different `gapId` — this
 * primitive does not itself decide authorization or dedupe (T05).
 */
export function appendGapRecord(ledger, record) {
  const verdict = validateLedger(ledger);
  if (!verdict.ok) throw ledgerError(`refusing to append to an invalid ledger: ${verdict.reason}`);
  if (!isPlainObject(record)) throw ledgerError('gap record must be a plain object');
  if (record.planHash !== ledger.planHash) throw ledgerError('gap record planHash does not match the ledger anchor');
  if (record.occurrenceId !== ledger.occurrenceId) {
    throw ledgerError('gap record occurrenceId does not match the ledger anchor');
  }
  // E.8: the persisted artifact is kept in canonical gapId order regardless of
  // the caller's append order, so identical logical content always serializes to
  // identical bytes (order-independence is part of the persistence contract).
  const candidate = {
    ...verdict.validated,
    diagnosedGaps: sortGapsByGapId([...verdict.validated.diagnosedGaps, record]),
  };
  const next = validateLedger(candidate);
  if (!next.ok) throw ledgerError(`refusing to append an invalid gap record: ${next.reason}`);
  return next.validated;
}

// ---------------------------------------------------------------------------
// persistence (work-dir relative, byte-deterministic, atomic)
// ---------------------------------------------------------------------------

/** Work-dir-relative ledger path. */
export function ledgerFile(workDir) {
  return path.join(workDir, LEDGER_FILENAME);
}

function serializeLedger(ledger) {
  return `${JSON.stringify(canonicalLedger(ledger), null, 2)}\n`;
}

/** Deterministic content hash of the persisted ledger bytes. */
export function ledgerHash(ledger) {
  return sha256(serializeLedger(ledger));
}

/**
 * Persist the ledger. Invalid input is refused (typed error), never written.
 * Returns the work-RELATIVE filename only — the machine-private work dir never
 * enters the returned value or the artifact (RULES.md §11).
 */
export function persistLedger(workDir, ledger) {
  const verdict = validateLedger(ledger);
  if (!verdict.ok) throw ledgerError(`refusing to persist an invalid ledger: ${verdict.reason}`);
  const payload = serializeLedger(verdict.validated);
  const target = ledgerFile(workDir);
  try {
    fs.mkdirSync(workDir, { recursive: true });
    const temp = `${target}.tmp-${process.pid}`;
    const fd = fs.openSync(temp, 'w');
    try {
      fs.writeFileSync(fd, payload, 'utf8');
      try {
        fs.fsyncSync(fd);
      } catch (e) {
        if (e.code !== 'EINVAL' && e.code !== 'EPERM' && e.code !== 'EROFS') throw e;
      }
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, target);
  } catch {
    throw ledgerError('failed to persist the targeted-requery ledger');
  }
  return { ok: true, path: LEDGER_FILENAME, hash: sha256(payload) };
}

/**
 * Load + re-validate the ledger for an optional expected plan anchor.
 * FILE EXISTS != VALID CACHE: a stale (different planHash), unparseable or
 * schema-invalid artifact fails closed with a stable reason.
 */
export function loadLedger(workDir, expectedPlanHash = null) {
  const target = ledgerFile(workDir);
  if (!fs.existsSync(target)) return { ok: false, reason: 'file_not_found', path: LEDGER_FILENAME };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return { ok: false, reason: 'unparseable', path: LEDGER_FILENAME };
  }
  const verdict = validateLedger(parsed);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, path: LEDGER_FILENAME };
  if (expectedPlanHash !== null && verdict.validated.planHash !== expectedPlanHash) {
    return { ok: false, reason: 'stale_plan_hash', path: LEDGER_FILENAME };
  }
  return {
    ok: true,
    ledger: verdict.validated,
    hash: sha256(serializeLedger(verdict.validated)),
    path: LEDGER_FILENAME,
  };
}
