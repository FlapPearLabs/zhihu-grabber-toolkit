// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-lifecycle.mjs
 *
 * P2A-T06 (#118) — Targeted-action lifecycle, durable commit and replay protection.
 *
 * Authority (FROZEN; this module must not reinterpret, generalize or "improve" it):
 *   - docs/specs/p2-ari-f02-targeted-requery.md      §5 D5, §12, §14        (APPROVED)
 *   - docs/architecture/key-decisions.md             D12-5
 *   - docs/planning/..._SEAM_CONTRACT_V1.md          F.1, F.5
 *   - docs/planning/..._SEAM_MAP_V1.md               S4
 *   - P1-R06 (#94) frozen conclusion: checkpoint is the ONLY trust root; an
 *     an unanchored second credential (a sidecar completion claim of any kind) is a
 *     P0 unanchored trust source.
 *
 * Ownership boundary (Ticket Graph V1 §4 — ONE_ACTIVE_WRITER_PER_BRANCH):
 *   T06 OWNS  : the lifecycle state machine (advance operations + legality checks),
 *               checkpoint-first staging and commit, the `state.hashes` targeted
 *               binding key, resume-time recomputation of `targetedActionId` and the
 *               replay decision, append-only audit, failure semantics.
 *   T06 DOES NOT OWN (and this module deliberately contains NONE of):
 *               authorization policy / dedupe / budget (T05 — CONSUMED via
 *               `computeTargetedActionId`, never re-derived),
 *               resolution predicates (T08), STOP / attempt accounting (T07),
 *               orchestration (T09), terminal visibility (T10),
 *               any ledger gap record or schema (T01),
 *               any new checkpoint mechanism — `writeState` /
 *               `validateArtifactCheckpoint` from `state.mjs` are REUSED verbatim,
 *               any persisted `executing` state, any second credential.
 *
 * ---------------------------------------------------------------------------
 * HONEST COST STATEMENT (诚实代价声明；must never be optimized away)
 * ---------------------------------------------------------------------------
 * commit point 之前崩溃，可能已发生一次真实 provider IO 但无持久完成证据，恢复方按合同
 * 安全重跑一次 —— 承认可能**重复付费一次**。这是 UNKNOWN != PASS 的必然代价。
 *
 * A crash BEFORE the commit point may have already performed ONE real provider IO,
 * but because no durable completion evidence exists the recovering side cannot prove
 * it and therefore re-runs the action once by contract — i.e. this design ADMITS the
 * possibility of paying for one duplicate retrieval. That is the necessary price of
 * "no evidence ⇒ no reuse" (UNKNOWN != PASS), and it is exactly why the commit point
 * is placed as close after the IO as possible.
 * It is FORBIDDEN to remove that cost by introducing an unanchored second credential
 * (a sidecar completion claim, or anything else that asserts completion without being
 * anchored in the checkpoint): P1-R06 adjudicated such credentials as a P0 unanchored
 * trust source and revoked them. 严禁引入未锚定的第二凭证。
 *
 * ---------------------------------------------------------------------------
 * FROZEN SEMANTICS AND THE INTERPRETATION DECISIONS TAKEN HERE
 * (recorded explicitly so reviewers can audit the decisions instead of
 * reconstructing intent from the code)
 * ---------------------------------------------------------------------------
 *
 * 1. THERE IS NO PERSISTED `EXECUTING` STATE. It can only be derived from
 *    "AUTHORIZED and no COMMITTED evidence yet"; persisting it adds no replay
 *    protection and creates a dangling state that cannot be explained after a crash
 *    (S4 MUST_NOT / D5 / P1-R06). `ACTION_STATUSES` is the closed persisted set.
 *
 * 2. THE CHECKPOINT IS THE ONLY TRUST ROOT. A record whose `status` says COMMITTED
 *    while `state.hashes[bindingKey]` is absent is NOT completion evidence: the
 *    replay decision keys on the checkpoint binding first, and a missing binding
 *    yields exactly one safe re-run (UNKNOWN != PASS). Status is a VIEW of the
 *    lifecycle; the binding is the EVIDENCE.
 *
 * 3. `validateArtifactCheckpoint` TREATS AN ABSENT EXPECTED HASH AS `ok:true`
 *    (`if (expectedHash && ...)`), which would turn "no binding" into "reuse".
 *    This module therefore requires `state.hashes[bindingKey]` to be a 64-hex string
 *    BEFORE calling it. Reusing the primitive never means reusing that hole.
 *
 * 4. COMMIT POINT ORDER IS PHYSICAL, NOT MERELY DOCUMENTED. The realised order is:
 *      (a) round artifact bytes written + fsynced,
 *      (b) the action record advanced to COMMITTED and persisted + fsynced,
 *      (c) the artifact hash placed into `state.hashes[bindingKey]` (in memory),
 *      (d) `writeState` — the checkpoint commit.
 *    (b) precedes (d) so that every non-checkpoint fact is durable before the trust
 *    root is written; a crash between them therefore degrades to "no evidence"
 *    (one safe re-run), never to a false claim of completion. F.5 requires exactly
 *    "bytes durable + hash in state.hashes, then writeState", which (a)/(c)/(d)
 *    satisfy; (b)'s position is this ticket's realisation choice, recorded as such.
 *
 * 5. THE ACTIONS ARTIFACT IS A NEW CONTROLLER-OWNED SIBLING, NOT A CHANGE TO THE
 *    T01 LEDGER. T01 owns the gap ledger's file IO / schema / validation, so this
 *    ticket must not add `targetedActions[]` to that artifact (that would be a T01
 *    schema change). The actions artifact is anchored by the same
 *    (planHash, occurrenceId) pair and is byte-deterministic for the same reason the
 *    ledger is: canonical key order + canonical record order.
 *
 * 6. AUDIT ENTRIES ARE DETERMINISTIC AND CARRY NO WALL-CLOCK TIME. Identity must
 *    never contain a timestamp (F.1); the audit trail inherits that discipline so the
 *    persisted artifact stays byte-deterministic and so two runs with identical
 *    logical content produce identical bytes. Ordering evidence is the monotonic
 *    per-action `seq`, not a clock. Wall-clock event logging, if wanted, already
 *    exists as `appendEvent` in `state.mjs` and is deliberately NOT duplicated here.
 *
 * 7. EVERY ADVANCE LEAVES MACHINE-CHECKABLE EVIDENCE (S4 MUST): the audit entry
 *    carries `from` / `to` / `event` and, for a commit, the `bindingKey` +
 *    `bindingHash` that anchor it in the checkpoint.
 *
 * 8. E.7 REJECTED-PROPOSAL RECORDING IS DISCHARGED HERE, AS AUDIT-ONLY.
 *    T05 (#117) adjudicated the "verbatim proposal copy" as a PERSISTENCE act and
 *    left it as T06's explicit downstream obligation; T05's module performs no write
 *    and emits no raw copy. This module records it in a separate `rejected[]` array:
 *      · it is keyed by NOTHING (a rejected proposal has no `targetedActionId`),
 *      · it is never consulted by any decision or transition,
 *      · `rejectionCode` is validated against T05's closed set (no free strings),
 *      · the verbatim copy is stored verbatim and is NOT trust-elevated (E.7:
 *        "审计用，不经安全门提升信任").
 *
 * 9. A NON-ADVANCING TERMINAL IS NEITHER RE-RUN NOR REUSED. F.5 enumerates only the
 *    committed set (⇒ reuse) and AUTHORIZED (⇒ one safe re-run). REJECTED and
 *    FAILED_OPERATIONAL are outside both classes, so resume FAILS CLOSED and surfaces
 *    them: automatically re-running a REJECTED action would contradict E.7 (no IO,
 *    parent gap untouched), and re-running an operational failure is a policy
 *    decision that belongs to the STOP / budget owner, not to the replay rule.
 *    Because `FAILED_OPERATIONAL` is reachable only from `AUTHORIZED` (see the
 *    LEGAL_TRANSITIONS note), this branch can never discard a validated checkpoint
 *    binding — it never hides completion evidence, it only refuses to guess.
 *
 * 10. PERSISTENCE-SHAPE VALIDATION IS NOT RE-AUTHORIZATION. This module re-checks the
 *    SHAPE of fields T01 / T05 own (gapId / gapIdentityCore / normalizedQuery /
 *    providerScope / dedupeKey) exactly as it re-checks its own, because it is the
 *    writer of the bytes it persists and must refuse to persist a record that does
 *    not derive from the frozen formulas (a self-verifying artifact). It never
 *    decides anything those tickets own: it admits or refuses bytes, never actions.
 *
 * 11. §14 NAMES FIVE FAILURE SEMANTICS; THIS TICKET REALISES THE ONE IT OWNS.
 *    `REJECTED` and `FAILED_OPERATIONAL` are lifecycle states owned here.
 *    `POOL_SAFETY_VIOLATION` (the persisted-artifact safety walk) belongs to the
 *    producer/writer of the round artifact (T02 / the existing `assertArtifactSafe`
 *    seam) — this module stages bytes it is handed and never invents a safety walk.
 *    `BUDGET_EXHAUSTED` and `IDENTITY_REPLAY_CONFLICT`'s consequences are the budget
 *    / STOP owner's (T07) and the resolution owner's (T08) respectively. A staging
 *    failure therefore fails CLOSED with a typed error rather than being relabelled
 *    as one of those codes: claiming a code this ticket does not own would be
 *    inventing evidence.
 *
 * 12. THE RESUME DECISION IS READ-ONLY. `decideTargetedReplay` writes nothing: it
 *     reports, and the caller decides what to persist. Append-only history is
 *     guaranteed structurally — no primitive in this module can drop, reorder or
 *     rewrite an existing audit entry or action record.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isValidPlanHashFormat } from './plan-contract.mjs';
import { CAPABILITY_SEARCH } from './provider-seam.mjs';
import { assertWorkRelative, validateArtifactCheckpoint, writeState } from './state.mjs';
import {
  PROVIDER_SCOPE_ENTRY_KEYS,
  REJECTION_CODES as T05_REJECTION_CODES,
  computeTargetedActionId,
  normalizeQueryString,
} from './targeted-requery-authorization.mjs';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Typed error code for every fail-closed refusal in this module. */
export const LIFECYCLE_ERROR_INVALID = 'p2a_targeted_requery_lifecycle_invalid';

// --- D5 / S4 persisted status set (closed; NO executing state) ----------------

export const ACTION_STATUS_PROPOSED = 'PROPOSED';
export const ACTION_STATUS_AUTHORIZED = 'AUTHORIZED';
export const ACTION_STATUS_COMMITTED = 'COMMITTED';
export const ACTION_STATUS_EVALUATED = 'EVALUATED';
export const ACTION_STATUS_RESOLVED = 'RESOLVED';
export const ACTION_STATUS_UNRESOLVED = 'UNRESOLVED';
export const ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET = 'EXHAUSTED_WITHIN_BUDGET';
/** Non-advancing terminal: a controlled authorization refusal (E.7) — no IO. */
export const ACTION_STATUS_REJECTED = 'REJECTED';
/** Non-advancing terminal: provider / IO failure — never an evidence conclusion. */
export const ACTION_STATUS_FAILED_OPERATIONAL = 'FAILED_OPERATIONAL';

export const ACTION_STATUSES = Object.freeze([
  ACTION_STATUS_PROPOSED,
  ACTION_STATUS_AUTHORIZED,
  ACTION_STATUS_COMMITTED,
  ACTION_STATUS_EVALUATED,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
  ACTION_STATUS_REJECTED,
  ACTION_STATUS_FAILED_OPERATIONAL,
]);

/**
 * F.5: ids in this set + a valid binding hash ⇒ NEVER re-execute the retrieval.
 * `PROPOSED` and `AUTHORIZED` are deliberately excluded: neither carries durable
 * completion evidence.
 */
export const COMMITTED_SET = Object.freeze([
  ACTION_STATUS_COMMITTED,
  ACTION_STATUS_EVALUATED,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
]);

/** S4: the two terminals that are not part of the advancing chain. */
export const NON_ADVANCING_TERMINAL_STATUSES = Object.freeze([
  ACTION_STATUS_REJECTED,
  ACTION_STATUS_FAILED_OPERATIONAL,
]);

/** The three evidence conclusions reachable from EVALUATED. */
export const FINAL_EVIDENCE_STATUSES = Object.freeze([
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
]);

/**
 * S4 LEGAL_STATES, expressed as the closed transition table. `EVALUATED` is the only
 * state that may emit an evidence conclusion (S4 ILLEGAL_STATES: no RESOLVED before
 * EVALUATED), and neither terminal has an out-edge (in particular FAILED_OPERATIONAL
 * can never be written as RESOLVED).
 *
 * `FAILED_OPERATIONAL` has exactly ONE in-edge, from `AUTHORIZED`. S4 names it as a
 * non-advancing terminal but does not enumerate its in-edges; the narrowest reading
 * is therefore the pre-commit operational boundary (provider / IO failure between
 * authorization and the commit point — the only window in which this ticket performs
 * or witnesses IO). `COMMITTED → FAILED_OPERATIONAL` is deliberately NOT declared:
 * after the commit point the durable product and its checkpoint binding are the trust
 * root, so letting a later operational marking override a validated COMMITTED action
 * would discard completion evidence and invent a branch F.5 does not define. If a
 * later owner (T08 evaluation) needs such an edge, that is that ticket's authority.
 *
 * `PROPOSED` is a member of the frozen D5 / S4 status set and keeps its two out-edges
 * here, but this module never CREATES a PROPOSED record: S4's INPUT_CONTRACT is
 * "TargetedQueryAction (AUTHORIZED)", i.e. the lifecycle owner receives actions that
 * T05 has already authorized (or rejected). PROPOSED is retained so the table is the
 * frozen one and so an out-of-contract caller cannot skip authorization silently.
 */
export const LEGAL_TRANSITIONS = Object.freeze({
  [ACTION_STATUS_PROPOSED]: Object.freeze([ACTION_STATUS_AUTHORIZED, ACTION_STATUS_REJECTED]),
  [ACTION_STATUS_AUTHORIZED]: Object.freeze([ACTION_STATUS_COMMITTED, ACTION_STATUS_FAILED_OPERATIONAL]),
  [ACTION_STATUS_COMMITTED]: Object.freeze([ACTION_STATUS_EVALUATED]),
  [ACTION_STATUS_EVALUATED]: Object.freeze([...FINAL_EVIDENCE_STATUSES]),
  [ACTION_STATUS_REJECTED]: Object.freeze([]),
  [ACTION_STATUS_FAILED_OPERATIONAL]: Object.freeze([]),
  [ACTION_STATUS_RESOLVED]: Object.freeze([]),
  [ACTION_STATUS_UNRESOLVED]: Object.freeze([]),
  [ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET]: Object.freeze([]),
});

// --- persistence surfaces ------------------------------------------------------

export const ACTIONS_SCHEMA = 'p2-ari-targeted-requery-actions/v1';
export const ACTIONS_FILENAME = 'targeted-requery-actions.json';

/**
 * Namespace for the `state.hashes` binding. It is deliberately disjoint from every
 * `STAGES` member so the existing `validateCheckpoint` walk (which only reads stage
 * keys) can never confuse a targeted binding with a stage artifact.
 */
export const TARGETED_BINDING_PREFIX = 'targeted-action:';

export const ACTION_RECORD_KEYS = Object.freeze([
  'artifactHash',
  'artifactRel',
  'attempt',
  'audit',
  'bindingHash',
  'bindingKey',
  'dedupeKey',
  'gapId',
  'gapIdentityCore',
  'normalizedQuery',
  'occurrenceId',
  'planHash',
  'providerScope',
  'runId',
  'status',
  'targetedActionId',
]);

export const AUDIT_ENTRY_KEYS = Object.freeze([
  'artifactRel',
  'bindingHash',
  'bindingKey',
  'event',
  'from',
  'reason',
  'seq',
  'to',
]);

export const REJECTED_ENTRY_KEYS = Object.freeze([
  'gapId',
  'occurrenceId',
  'planHash',
  'proposalVerbatim',
  'rejectionCode',
  'rejectionDetail',
  'runId',
]);

const ACTIONS_TOP_LEVEL_KEYS = Object.freeze(['occurrenceId', 'planHash', 'rejected', 'schema', 'targetedActions']);

const HEX64 = /^[0-9a-f]{64}$/;
const GAP_ID_SHAPE = /^[0-9a-f]{64}:\d+$/;

// --- resume vocabulary ---------------------------------------------------------

export const RESUME_REUSE = 'REUSE';
export const RESUME_RERUN = 'RERUN';
export const RESUME_BLOCKED = 'BLOCKED';

export const RESUME_REASON_COMMITTED_WITH_VALID_BINDING = 'COMMITTED_WITH_VALID_BINDING';
export const RESUME_REASON_AUTHORIZED_ONLY = 'AUTHORIZED_ONLY';
export const RESUME_REASON_BINDING_HASH_MISSING = 'BINDING_HASH_MISSING';
export const RESUME_REASON_ARTIFACT_MISSING = 'ARTIFACT_MISSING';
export const RESUME_REASON_ARTIFACT_HASH_MISMATCH = 'ARTIFACT_HASH_MISMATCH';
export const RESUME_REASON_IDENTITY_REPLAY_CONFLICT = 'IDENTITY_REPLAY_CONFLICT';
export const RESUME_REASON_NO_PRIOR_ACTION = 'NO_PRIOR_ACTION';
export const RESUME_REASON_TERMINAL_NON_ADVANCING = 'TERMINAL_NON_ADVANCING';

// ---------------------------------------------------------------------------
// module-private helpers (no shared module is created; see the sibling modules)
// ---------------------------------------------------------------------------

function lifecycleError(message) {
  const err = new Error(message);
  err.code = LIFECYCLE_ERROR_INVALID;
  return err;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function requireArtifact(artifact) {
  const verdict = validateActionsArtifact(artifact);
  if (!verdict.ok) throw lifecycleError(`refusing to operate on an invalid actions artifact: ${verdict.reason}`);
  return verdict.validated;
}

/**
 * Replay-specific validation: the frozen F.1 self-verification is SKIPPED so that a
 * tampered record can be REPORTED as `IDENTITY_REPLAY_CONFLICT` instead of being
 * rejected up front (which would hide the conflict behind a generic load failure).
 * Every other check is identical; nothing is widened for persistence.
 */
function requireArtifactForReplay(artifact) {
  const verdict = validateActionsArtifact(artifact, { selfVerify: false });
  if (!verdict.ok) throw lifecycleError(`refusing to replay from an invalid actions artifact: ${verdict.reason}`);
  return verdict.validated;
}

// ---------------------------------------------------------------------------
// state machine
// ---------------------------------------------------------------------------

export function isLegalTransition(from, to) {
  if (!ACTION_STATUSES.includes(from) || !ACTION_STATUSES.includes(to)) return false;
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

export function assertLegalTransition(from, to) {
  if (!isLegalTransition(from, to)) {
    throw lifecycleError(
      `illegal targeted-action transition: ${String(from)} -> ${String(to)}`,
    );
  }
}

/** The F.5 binding key for one targeted action. */
export function targetedBindingKey(targetedActionId) {
  if (typeof targetedActionId !== 'string' || !HEX64.test(targetedActionId)) {
    throw lifecycleError('targetedActionId must be 64 lowercase hex characters');
  }
  return `${TARGETED_BINDING_PREFIX}${targetedActionId}`;
}

// ---------------------------------------------------------------------------
// artifact: shape, validation, persistence
// ---------------------------------------------------------------------------

export function createActionsArtifact({ planHash, occurrenceId } = {}) {
  if (!isValidPlanHashFormat(planHash)) {
    throw lifecycleError('planHash must be a 64-hex plan contract hash');
  }
  if (!isNonEmptyString(occurrenceId)) throw lifecycleError('occurrenceId must be a non-empty string');
  return {
    occurrenceId,
    planHash,
    rejected: [],
    schema: ACTIONS_SCHEMA,
    targetedActions: [],
  };
}

function canonicalAuditEntry(entry) {
  return {
    artifactRel: entry.artifactRel ?? null,
    bindingHash: entry.bindingHash ?? null,
    bindingKey: entry.bindingKey ?? null,
    event: entry.event,
    from: entry.from ?? null,
    reason: entry.reason ?? null,
    seq: entry.seq,
    to: entry.to,
  };
}

function canonicalActionRecord(record) {
  return {
    artifactHash: record.artifactHash ?? null,
    artifactRel: record.artifactRel ?? null,
    attempt: record.attempt,
    audit: record.audit.map(canonicalAuditEntry),
    bindingHash: record.bindingHash ?? null,
    bindingKey: record.bindingKey ?? null,
    dedupeKey: record.dedupeKey ?? null,
    gapId: record.gapId,
    gapIdentityCore: record.gapIdentityCore,
    normalizedQuery: record.normalizedQuery,
    occurrenceId: record.occurrenceId,
    planHash: record.planHash,
    providerScope: record.providerScope.map((entry) => ({ capability: entry.capability, providerId: entry.providerId })),
    runId: record.runId,
    status: record.status,
    targetedActionId: record.targetedActionId,
  };
}

function canonicalRejectedEntry(entry) {
  return {
    gapId: entry.gapId,
    occurrenceId: entry.occurrenceId,
    planHash: entry.planHash,
    proposalVerbatim: entry.proposalVerbatim ?? null,
    rejectionCode: entry.rejectionCode,
    rejectionDetail: entry.rejectionDetail ?? null,
    runId: entry.runId,
  };
}

/** Byte-deterministic canonical form (canonical key order + canonical record order). */
function canonicalArtifact(artifact) {
  return {
    occurrenceId: artifact.occurrenceId,
    planHash: artifact.planHash,
    rejected: [...artifact.rejected]
      .map(canonicalRejectedEntry)
      .sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0)),
    schema: artifact.schema,
    targetedActions: [...artifact.targetedActions]
      .map(canonicalActionRecord)
      .sort((a, b) => (a.targetedActionId < b.targetedActionId ? -1 : a.targetedActionId > b.targetedActionId ? 1 : 0)),
  };
}

function validateAuditEntry(entry, expectedSeq) {
  if (!hasExactKeys(entry, AUDIT_ENTRY_KEYS)) return 'audit entry has an unexpected key set';
  if (!Number.isInteger(entry.seq) || entry.seq !== expectedSeq) return 'audit entry seq is not monotonic';
  if (!isNonEmptyString(entry.event)) return 'audit entry event is malformed';
  if (entry.to === null || !ACTION_STATUSES.includes(entry.to)) return 'audit entry to-status is outside the closed enum';
  if (entry.from !== null && !ACTION_STATUSES.includes(entry.from)) return 'audit entry from-status is outside the closed enum';
  if (entry.reason !== null && !isNonEmptyString(entry.reason)) return 'audit entry reason is malformed';
  if (entry.bindingKey !== null && !isNonEmptyString(entry.bindingKey)) return 'audit entry bindingKey is malformed';
  if (entry.bindingHash !== null && !HEX64.test(entry.bindingHash)) return 'audit entry bindingHash is malformed';
  if (entry.artifactRel !== null && !isNonEmptyString(entry.artifactRel)) return 'audit entry artifactRel is malformed';
  return null;
}

function validateProviderScope(scope) {
  if (!Array.isArray(scope) || scope.length === 0) return 'providerScope must be a non-empty array';
  const seen = new Set();
  for (const entry of scope) {
    if (!hasExactKeys(entry, PROVIDER_SCOPE_ENTRY_KEYS)) return 'providerScope entry must be exactly { providerId, capability }';
    if (!isNonEmptyString(entry.providerId)) return 'providerScope providerId must be a non-empty string';
    if (entry.capability !== CAPABILITY_SEARCH) return `providerScope capability must be ${CAPABILITY_SEARCH}`;
    if (seen.has(entry.providerId)) return `duplicate providerId in providerScope: ${entry.providerId}`;
    seen.add(entry.providerId);
  }
  // F.1: the scope participates in the identity in canonical (sorted) form.
  const sorted = [...scope].map((e) => e.providerId);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i - 1] > sorted[i]) return 'providerScope is not in canonical providerId order';
  }
  return null;
}

function validateActionRecord(record, artifact, selfVerify) {
  if (!hasExactKeys(record, ACTION_RECORD_KEYS)) return 'action record has an unexpected key set';
  if (typeof record.targetedActionId !== 'string' || !HEX64.test(record.targetedActionId)) {
    return 'action record targetedActionId is malformed';
  }
  if (!ACTION_STATUSES.includes(record.status)) return 'action record status is outside the closed enum';
  if (record.planHash !== artifact.planHash) return 'action record planHash does not match the artifact anchor';
  if (record.occurrenceId !== artifact.occurrenceId) return 'action record occurrenceId does not match the artifact anchor';
  if (!isNonEmptyString(record.runId)) return 'action record runId is malformed';
  if (typeof record.gapId !== 'string' || !GAP_ID_SHAPE.test(record.gapId)) return 'action record gapId is malformed';
  if (typeof record.gapIdentityCore !== 'string' || !HEX64.test(record.gapIdentityCore)) {
    return 'action record gapIdentityCore is malformed';
  }
  if (!record.gapId.startsWith(`${record.gapIdentityCore}:`)) return 'action record gapId does not derive from its core';
  if (!Number.isInteger(record.attempt) || record.attempt < 1) return 'action record attempt must be a positive integer';
  if (typeof record.normalizedQuery !== 'string' || normalizeQueryString(record.normalizedQuery) !== record.normalizedQuery) {
    return 'action record normalizedQuery is not in canonical E.6 form';
  }
  const scopeReason = validateProviderScope(record.providerScope);
  if (scopeReason !== null) return scopeReason;
  if (record.dedupeKey !== null && !HEX64.test(record.dedupeKey)) return 'action record dedupeKey is malformed';
  if (record.bindingKey !== null && record.bindingKey !== `${TARGETED_BINDING_PREFIX}${record.targetedActionId}`) {
    return 'action record bindingKey does not match its targetedActionId';
  }
  if (record.bindingHash !== null && !HEX64.test(record.bindingHash)) return 'action record bindingHash is malformed';
  if (record.artifactHash !== null && !HEX64.test(record.artifactHash)) return 'action record artifactHash is malformed';
  if (record.artifactRel !== null && typeof record.artifactRel !== 'string') return 'action record artifactRel is malformed';
  if (!Array.isArray(record.audit) || record.audit.length === 0) return 'action record audit must be a non-empty array';
  for (let i = 0; i < record.audit.length; i += 1) {
    const reason = validateAuditEntry(record.audit[i], i + 1);
    if (reason !== null) return reason;
  }
  // The last audit entry must agree with the record's current status.
  if (record.audit[record.audit.length - 1].to !== record.status) {
    return 'action record audit tail does not agree with its status';
  }
  if (selfVerify) {
    // Self-verifying: recompute the frozen F.1 identity from the persisted fields.
    // A record whose fields no longer hash to its own id is tampered and is refused
    // rather than repaired (no guessing, no silent reuse).
    const recomputed = computeTargetedActionId({
      runId: record.runId,
      occurrenceId: record.occurrenceId,
      planHash: record.planHash,
      gapId: record.gapId,
      attempt: record.attempt,
      normalizedQuery: record.normalizedQuery,
      providerScope: record.providerScope,
    });
    if (recomputed !== record.targetedActionId) {
      return 'action identity does not match the frozen F.1 formula';
    }
  }
  return null;
}

function validateRejectedEntry(entry, artifact) {
  if (!hasExactKeys(entry, REJECTED_ENTRY_KEYS)) return 'rejected entry has an unexpected key set';
  if (entry.planHash !== artifact.planHash) return 'rejected entry planHash does not match the artifact anchor';
  if (entry.occurrenceId !== artifact.occurrenceId) return 'rejected entry occurrenceId does not match the artifact anchor';
  if (!isNonEmptyString(entry.runId)) return 'rejected entry runId is malformed';
  if (entry.gapId !== null && !GAP_ID_SHAPE.test(entry.gapId)) return 'rejected entry gapId is malformed';
  // No free strings: the code must come from T05's closed set.
  if (!isNonEmptyString(entry.rejectionCode) || !T05_REJECTION_CODES.includes(entry.rejectionCode)) {
    return 'rejected entry rejectionCode is outside the T05 closed set';
  }
  if (entry.rejectionDetail !== null && !isNonEmptyString(entry.rejectionDetail)) {
    return 'rejected entry rejectionDetail is malformed';
  }
  return null;
}

/**
 * Fail-closed schema validation. `{ ok: true, validated }` or `{ ok: false, reason }`.
 * Nothing is repaired, normalized or guessed.
 *
 * `selfVerify = false` is used ONLY by the resume loader so that a tampered record
 * can be REPORTED as an identity conflict instead of being silently loaded as if it
 * were intact; it never widens what `persistActionsArtifact` will accept.
 */
export function validateActionsArtifact(artifact, { selfVerify = true } = {}) {
  if (!isPlainObject(artifact)) return { ok: false, reason: 'actions artifact must be a plain object' };
  if (!hasExactKeys(artifact, ACTIONS_TOP_LEVEL_KEYS)) return { ok: false, reason: 'actions artifact has an unexpected key set' };
  if (artifact.schema !== ACTIONS_SCHEMA) return { ok: false, reason: 'actions artifact schema id is not recognised' };
  if (!isValidPlanHashFormat(artifact.planHash)) {
    return { ok: false, reason: 'actions artifact planHash is malformed' };
  }
  if (!isNonEmptyString(artifact.occurrenceId)) return { ok: false, reason: 'actions artifact occurrenceId is malformed' };
  if (!Array.isArray(artifact.targetedActions)) return { ok: false, reason: 'targetedActions must be an array' };
  if (!Array.isArray(artifact.rejected)) return { ok: false, reason: 'rejected must be an array' };

  const seen = new Set();
  for (const record of artifact.targetedActions) {
    const reason = validateActionRecord(record, artifact, selfVerify);
    if (reason !== null) return { ok: false, reason };
    if (seen.has(record.targetedActionId)) {
      return { ok: false, reason: `duplicate targetedActionId: ${record.targetedActionId}` };
    }
    seen.add(record.targetedActionId);
  }
  for (const entry of artifact.rejected) {
    const reason = validateRejectedEntry(entry, artifact);
    if (reason !== null) return { ok: false, reason };
  }

  const canonical = canonicalArtifact(artifact);
  for (let i = 0; i < canonical.targetedActions.length; i += 1) {
    if (canonicalJson(canonical.targetedActions[i]) !== canonicalJson(artifact.targetedActions[i])) {
      return { ok: false, reason: 'targetedActions are not in canonical targetedActionId order' };
    }
  }
  return { ok: true, validated: canonical };
}

export function actionsFile(workDir) {
  return path.join(workDir, ACTIONS_FILENAME);
}

function serializeArtifact(artifact) {
  return `${JSON.stringify(canonicalArtifact(artifact), null, 2)}\n`;
}

/** Deterministic content hash of the persisted artifact bytes. */
export function actionsHash(artifact) {
  return sha256(Buffer.from(serializeArtifact(artifact), 'utf8'));
}

/**
 * Persist the actions artifact (write + fsync + atomic rename). Invalid input is
 * refused, never written. Returns the work-RELATIVE filename only.
 */
export function persistActionsArtifact(workDir, artifact) {
  const verdict = validateActionsArtifact(artifact);
  if (!verdict.ok) throw lifecycleError(`refusing to persist an invalid actions artifact: ${verdict.reason}`);
  const canonical = verdict.validated;
  const payload = serializeArtifact(canonical);
  const hash = actionsHash(canonical);
  const target = actionsFile(workDir);
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
    throw lifecycleError('failed to persist the targeted-requery actions artifact');
  }
  return { ok: true, path: ACTIONS_FILENAME, hash };
}

/**
 * Load + re-validate the actions artifact. FILE EXISTS != VALID CACHE: a stale
 * (different planHash), unparseable or schema-invalid artifact fails closed.
 *
 * `{ strict: false }` skips the per-record F.1 self-verification so a tampered
 * record can be surfaced as `IDENTITY_REPLAY_CONFLICT` instead of being loaded as
 * though it were intact. It does not relax any other check.
 */
export function loadActionsArtifact(workDir, expectedPlanHash = null, { strict = true } = {}) {
  const target = actionsFile(workDir);
  if (!fs.existsSync(target)) return { ok: false, reason: 'file_not_found', path: ACTIONS_FILENAME };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return { ok: false, reason: 'unparseable', path: ACTIONS_FILENAME };
  }
  const verdict = validateActionsArtifact(parsed, { selfVerify: strict });
  if (!verdict.ok) return { ok: false, reason: verdict.reason, path: ACTIONS_FILENAME };
  if (expectedPlanHash !== null && verdict.validated.planHash !== expectedPlanHash) {
    return { ok: false, reason: 'stale_plan_hash', path: ACTIONS_FILENAME };
  }
  return {
    ok: true,
    artifact: verdict.validated,
    hash: actionsHash(verdict.validated),
    path: ACTIONS_FILENAME,
    degraded: strict === false,
  };
}

function sortByTargetedActionId(records) {
  return [...records].sort((a, b) => (
    a.targetedActionId < b.targetedActionId ? -1 : a.targetedActionId > b.targetedActionId ? 1 : 0
  ));
}

/**
 * Append-only primitive: returns a NEW artifact whose record list is in canonical
 * `targetedActionId` order; no earlier record is rewritten, reordered in content or
 * dropped. Canonical ordering is a persistence-shape property (byte determinism),
 * not a product-behaviour statement: consumers may still re-sort.
 */
export function appendActionRecord(artifact, record) {
  const validated = requireArtifact(artifact);
  if (!isPlainObject(record)) throw lifecycleError('action record must be a plain object');
  const candidate = {
    ...validated,
    targetedActions: sortByTargetedActionId([...validated.targetedActions, record]),
  };
  const next = validateActionsArtifact(candidate);
  if (!next.ok) throw lifecycleError(`refusing to append an invalid action record: ${next.reason}`);
  return next.validated;
}

// ---------------------------------------------------------------------------
// registration (consume T05 decisions — never re-derive authority)
// ---------------------------------------------------------------------------

/**
 * Record an AUTHORIZED T05 decision as a new action at `AUTHORIZED`.
 *
 * The id is RE-VERIFIED against the frozen F.1 formula from the decision's own
 * fields, so a decision whose id does not follow from its content is refused rather
 * than persisted. This module never computes an id by any other route.
 */
export function registerAuthorizedAction(artifact, decision) {
  const validated = requireArtifact(artifact);
  if (!isPlainObject(decision)) throw lifecycleError('authorization decision must be a plain object');
  if (decision.status !== ACTION_STATUS_AUTHORIZED) {
    throw lifecycleError('only an AUTHORIZED decision can be registered as an action');
  }
  const { targetedActionId } = decision;
  if (typeof targetedActionId !== 'string' || !HEX64.test(targetedActionId)) {
    throw lifecycleError('decision targetedActionId is malformed');
  }
  if (validated.targetedActions.some((r) => r.targetedActionId === targetedActionId)) {
    throw lifecycleError(`targetedActionId already registered: ${targetedActionId}`);
  }
  const recomputed = computeTargetedActionId({
    runId: decision.runId,
    occurrenceId: decision.occurrenceId,
    planHash: decision.planHash,
    gapId: decision.gapId,
    attempt: decision.attempt,
    normalizedQuery: decision.normalizedQuery,
    providerScope: decision.providerScope,
  });
  if (recomputed !== targetedActionId) {
    throw lifecycleError('decision targetedActionId does not follow from its identity fields (F.1)');
  }
  const record = {
    artifactHash: null,
    artifactRel: null,
    attempt: decision.attempt,
    audit: [{
      artifactRel: null,
      bindingHash: null,
      bindingKey: null,
      event: 'REGISTER_AUTHORIZED',
      from: null,
      reason: null,
      seq: 1,
      to: ACTION_STATUS_AUTHORIZED,
    }],
    bindingHash: null,
    bindingKey: null,
    dedupeKey: decision.dedupeKey ?? null,
    gapId: decision.gapId,
    gapIdentityCore: decision.gapIdentityCore ?? null,
    normalizedQuery: decision.normalizedQuery,
    occurrenceId: decision.occurrenceId,
    planHash: decision.planHash,
    providerScope: decision.providerScope,
    runId: decision.runId,
    status: ACTION_STATUS_AUTHORIZED,
    targetedActionId,
  };
  return appendActionRecord(validated, record);
}

/**
 * E.7 / T05-P2-2 downstream obligation: record a REJECTED decision, audit-only.
 *
 * `rejected[]` is keyed by nothing (a rejected proposal has no id), is never read by
 * any transition or replay decision, and keeps the verbatim proposal copy without
 * trust-elevating it.
 */
export function recordRejectedDecision(artifact, decision, proposal = null) {
  const validated = requireArtifact(artifact);
  if (!isPlainObject(decision)) throw lifecycleError('authorization decision must be a plain object');
  if (decision.status !== 'REJECTED') {
    throw lifecycleError('only a REJECTED decision can be recorded as a rejected proposal');
  }
  const entry = {
    gapId: typeof decision.gapId === 'string' ? decision.gapId : null,
    occurrenceId: decision.occurrenceId,
    planHash: decision.planHash,
    proposalVerbatim: proposal === undefined ? null : proposal,
    rejectionCode: decision.rejectionCode ?? null,
    rejectionDetail: decision.rejectionDetail ?? null,
    runId: decision.runId,
  };
  const candidate = {
    ...validated,
    rejected: [...validated.rejected, entry].sort((a, b) => (
      canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0
    )),
  };
  const next = validateActionsArtifact(candidate);
  if (!next.ok) throw lifecycleError(`refusing to record an invalid rejected proposal: ${next.reason}`);
  return next.validated;
}

// ---------------------------------------------------------------------------
// transitions
// ---------------------------------------------------------------------------

function findRecord(artifact, targetedActionId) {
  const index = artifact.targetedActions.findIndex((r) => r.targetedActionId === targetedActionId);
  if (index === -1) return null;
  return { index, record: artifact.targetedActions[index] };
}

/**
 * Advance one action to `nextStatus`.
 *
 * The transition is validated against the frozen `LEGAL_TRANSITIONS` table, so the
 * S4 ILLEGAL_STATES are structurally unreachable: no PROPOSED → retrieval, no silent
 * re-run of a COMMITTED action, no evidence conclusion before EVALUATED, and no
 * FAILED_OPERATIONAL that gets written as RESOLVED.
 *
 * Every advance appends exactly one audit entry (S4 MUST: machine-checkable evidence
 * = identity + binding hash). History is never rewritten — `append-only` here is a
 * structural property, not a promise.
 */
export function advanceActionStatus(artifact, targetedActionId, nextStatus, options = {}) {
  const validated = requireArtifact(artifact);
  if (!isPlainObject(options)) throw lifecycleError('advance options must be a plain object');
  const found = findRecord(validated, targetedActionId);
  if (found === null) throw lifecycleError(`unknown targetedActionId: ${String(targetedActionId)}`);
  assertLegalTransition(found.record.status, nextStatus);

  const {
    event = null,
    reason = null,
    bindingKey = null,
    bindingHash = null,
    artifactRel = null,
  } = options;

  // Once an action carries a binding, that binding is IMMUTABLE. Letting a later
  // advance rewrite it would let the record's memory of the committed artifact drift
  // away from the checkpoint that is the trust root (the replay decision always
  // re-validates bytes, so this could only cause a spurious re-run — never a false
  // reuse — but a drift between the record and the trust root is still a defect).
  if (found.record.bindingKey !== null && bindingKey !== null && bindingKey !== found.record.bindingKey) {
    throw lifecycleError('refusing to rewrite the bindingKey of an already-bound action');
  }
  if (found.record.bindingHash !== null && bindingHash !== null && bindingHash !== found.record.bindingHash) {
    throw lifecycleError('refusing to rewrite the bindingHash of an already-bound action');
  }
  if (found.record.artifactRel !== null && artifactRel !== null && artifactRel !== found.record.artifactRel) {
    throw lifecycleError('refusing to rewrite the artifactRel of an already-bound action');
  }

  const nextRecord = {
    ...found.record,
    status: nextStatus,
    artifactHash: bindingHash ?? found.record.artifactHash,
    artifactRel: artifactRel ?? found.record.artifactRel,
    bindingHash: bindingHash ?? found.record.bindingHash,
    bindingKey: bindingKey ?? found.record.bindingKey,
    audit: [
      ...found.record.audit,
      {
        artifactRel: artifactRel ?? null,
        bindingHash: bindingHash ?? null,
        bindingKey: bindingKey ?? null,
        event: event ?? `ADVANCE_${nextStatus}`,
        from: found.record.status,
        reason,
        seq: found.record.audit.length + 1,
        to: nextStatus,
      },
    ],
  };

  const nextActions = [...validated.targetedActions];
  nextActions[found.index] = nextRecord;
  const next = validateActionsArtifact({ ...validated, targetedActions: nextActions });
  if (!next.ok) throw lifecycleError(`refusing an invalid advance: ${next.reason}`);
  return next.validated;
}

/**
 * Append an audit entry WITHOUT changing the status (replay / conflict evidence).
 * Used to keep the old traces visible when a conservative re-run is decided.
 */
export function appendAuditEntry(artifact, targetedActionId, { event, reason = null } = {}) {
  const validated = requireArtifact(artifact);
  const found = findRecord(validated, targetedActionId);
  if (found === null) throw lifecycleError(`unknown targetedActionId: ${String(targetedActionId)}`);
  if (!isNonEmptyString(event)) throw lifecycleError('audit entry event must be a non-empty string');
  const nextRecord = {
    ...found.record,
    audit: [
      ...found.record.audit,
      {
        artifactRel: found.record.artifactRel ?? null,
        bindingHash: found.record.bindingHash ?? null,
        bindingKey: found.record.bindingKey ?? null,
        event,
        from: found.record.status,
        reason,
        seq: found.record.audit.length + 1,
        to: found.record.status,
      },
    ],
  };
  const nextActions = [...validated.targetedActions];
  nextActions[found.index] = nextRecord;
  const next = validateActionsArtifact({ ...validated, targetedActions: nextActions });
  if (!next.ok) throw lifecycleError(`refusing an invalid audit entry: ${next.reason}`);
  return next.validated;
}

// ---------------------------------------------------------------------------
// commit point (F.5 / D5) — checkpoint-first
// ---------------------------------------------------------------------------

/**
 * Step (a) of the commit point: make the action's persisted round artifact bytes
 * durable (write + fsync + atomic rename) and return their hash.
 *
 * The path stays work-relative and inside the work dir (reusing `assertWorkRelative`
 * from `state.mjs`); machine-private absolute paths never enter state or artifacts.
 */
export function stageTargetedArtifact(workDir, rel, bytes) {
  if (!isNonEmptyString(rel)) throw lifecycleError('artifactRel must be a non-empty work-relative path');
  if (typeof bytes !== 'string' && !Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw lifecycleError('artifactBytes must be a string, Buffer or Uint8Array');
  }
  let safeRel;
  try {
    safeRel = assertWorkRelative(workDir, rel);
  } catch {
    throw lifecycleError(`artifactRel escapes the work dir: ${rel}`);
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  const hash = sha256(buffer);
  const target = path.resolve(workDir, safeRel);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}`;
    const fd = fs.openSync(temp, 'w');
    try {
      fs.writeFileSync(fd, buffer);
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
    throw lifecycleError(`failed to stage the targeted round artifact: ${safeRel}`);
  }
  return { ok: true, path: safeRel, hash };
}

/**
 * Steps (a)–(c) of the commit point, WITHOUT the checkpoint commit (see the header's
 * design decision 4 for the realised order, which this docstring must match):
 *   (a) round artifact bytes durable + fsynced,
 *   (b) the action advanced to COMMITTED and persisted + fsynced,
 *   (c) the artifact hash placed into `state.hashes[bindingKey]` (in memory only —
 *       it reaches disk in step (d), `finalizeTargetedCommit`).
 *
 * The caller's `state` is NOT mutated: the returned state is a fresh object that the
 * caller must hand to `finalizeTargetedCommit`. Split here is what makes the crash
 * boundary mechanically testable — a caller that stops after this call has durable
 * bytes and a COMMITTED record but NO checkpoint binding, which by design is "no
 * completion evidence" (one safe re-run), never a false completion claim.
 */
export function prepareTargetedCommit({
  workDir,
  artifact,
  state,
  targetedActionId,
  artifactRel,
  artifactBytes,
} = {}) {
  const validated = requireArtifact(artifact);
  if (!isPlainObject(state)) throw lifecycleError('orchestration state must be a plain object');
  const found = findRecord(validated, targetedActionId);
  if (found === null) throw lifecycleError(`unknown targetedActionId: ${String(targetedActionId)}`);
  if (found.record.status !== ACTION_STATUS_AUTHORIZED) {
    throw lifecycleError(
      `only an AUTHORIZED action may be committed (status is ${found.record.status})`,
    );
  }
  const bindingKey = targetedBindingKey(targetedActionId);
  const staged = stageTargetedArtifact(workDir, artifactRel, artifactBytes);

  const nextArtifact = advanceActionStatus(validated, targetedActionId, ACTION_STATUS_COMMITTED, {
    event: 'COMMIT',
    bindingKey,
    bindingHash: staged.hash,
    artifactRel: staged.path,
  });
  persistActionsArtifact(workDir, nextArtifact);

  const nextState = {
    ...state,
    hashes: { ...(state.hashes ?? {}), [bindingKey]: staged.hash },
  };
  return {
    ok: true,
    artifact: nextArtifact,
    state: nextState,
    hash: staged.hash,
    rel: staged.path,
    bindingKey,
  };
}

/**
 * Step (d) of the commit point: `writeState` — the checkpoint commit.
 * This is the only durable fact that counts as completion evidence.
 *
 * The function writes exactly the state it is handed: passing anything other than the
 * state returned by `prepareTargetedCommit` (or an equivalent that already carries the
 * binding in `hashes`) would commit a checkpoint without the targeted binding, which
 * is by design "no completion evidence" — i.e. one safe re-run, never a false claim.
 */
export function finalizeTargetedCommit(workDir, state) {
  writeState(workDir, state);
  return { ok: true };
}

/** The full commit point: prepare (a–c) then finalize (d). */
export function commitTargetedAction(params = {}) {
  const prepared = prepareTargetedCommit(params);
  finalizeTargetedCommit(params.workDir, prepared.state);
  return prepared;
}

// ---------------------------------------------------------------------------
// resume / replay decision (F.5 DUPLICATE_REPLAY_RULE)
// ---------------------------------------------------------------------------

function replayDecision(decision, reason, targetedActionId, action) {
  return { decision, reason, targetedActionId, action };
}

/**
 * Decide, on resume, whether a candidate targeted action may reuse a previously
 * committed result or must be safely re-run once. READ-ONLY: nothing is written.
 *
 *   · committed-set status + a present 64-hex binding hash + `validateArtifactCheckpoint`
 *     ok  → REUSE (never re-execute the paid retrieval; C4)
 *   · AUTHORIZED only, or a missing / mismatched binding, or a missing artifact
 *     → RERUN once (no durable completion evidence; C5)
 *   · same id with different content → IDENTITY_REPLAY_CONFLICT: conservative re-run,
 *     and the old audit traces are retained by the artifact's append-only structure
 *     (this function itself never drops them; C12)
 *   · a non-advancing terminal → BLOCKED (fail closed; see design decision 9)
 *
 * `identity` is the exact F.1 field set; the id is recomputed by REUSING T05's
 * `computeTargetedActionId`, so no second identity formula can drift in here.
 */
export function decideTargetedReplay({ workDir, state = null, artifact, identity } = {}) {
  const validated = requireArtifactForReplay(artifact);
  if (!isPlainObject(identity)) throw lifecycleError('identity must be a plain object');
  const targetedActionId = computeTargetedActionId(identity);

  const found = findRecord(validated, targetedActionId);
  if (found === null) return replayDecision(RESUME_RERUN, RESUME_REASON_NO_PRIOR_ACTION, targetedActionId, null);
  const record = found.record;

  if (NON_ADVANCING_TERMINAL_STATUSES.includes(record.status)) {
    return replayDecision(RESUME_BLOCKED, RESUME_REASON_TERMINAL_NON_ADVANCING, targetedActionId, record);
  }

  // Same id, different content: recompute from the STORED fields. A mismatch means
  // the persisted record no longer derives from its own id — report the conflict and
  // take the conservative branch instead of trusting either reading.
  const recomputed = computeTargetedActionId({
    runId: record.runId,
    occurrenceId: record.occurrenceId,
    planHash: record.planHash,
    gapId: record.gapId,
    attempt: record.attempt,
    normalizedQuery: record.normalizedQuery,
    providerScope: record.providerScope,
  });
  if (recomputed !== record.targetedActionId) {
    return replayDecision(RESUME_RERUN, RESUME_REASON_IDENTITY_REPLAY_CONFLICT, targetedActionId, record);
  }

  if (!COMMITTED_SET.includes(record.status)) {
    // PROPOSED carries no authorization at all; AUTHORIZED carries no completion
    // evidence. Both are the "safe re-run once" class of F.5.
    return replayDecision(RESUME_RERUN, RESUME_REASON_AUTHORIZED_ONLY, targetedActionId, record);
  }

  const bindingKey = targetedBindingKey(targetedActionId);
  const expectedHash = state?.hashes?.[bindingKey];
  // Design decision 3: `validateArtifactCheckpoint` treats an absent expected hash as
  // ok, so the binding must be proven present here — otherwise "no evidence" would be
  // silently upgraded to "reuse".
  if (typeof expectedHash !== 'string' || !HEX64.test(expectedHash)) {
    return replayDecision(RESUME_RERUN, RESUME_REASON_BINDING_HASH_MISSING, targetedActionId, record);
  }
  if (record.artifactRel === null) {
    return replayDecision(RESUME_RERUN, RESUME_REASON_ARTIFACT_MISSING, targetedActionId, record);
  }
  if (record.artifactHash !== null && record.artifactHash !== expectedHash) {
    return replayDecision(RESUME_RERUN, RESUME_REASON_ARTIFACT_HASH_MISMATCH, targetedActionId, record);
  }
  const check = validateArtifactCheckpoint(workDir, record.artifactRel, expectedHash);
  if (!check.ok) {
    const reason = check.reason.includes('missing')
      ? RESUME_REASON_ARTIFACT_MISSING
      : RESUME_REASON_ARTIFACT_HASH_MISMATCH;
    return replayDecision(RESUME_RERUN, reason, targetedActionId, record);
  }
  return replayDecision(RESUME_REUSE, RESUME_REASON_COMMITTED_WITH_VALID_BINDING, targetedActionId, record);
}
