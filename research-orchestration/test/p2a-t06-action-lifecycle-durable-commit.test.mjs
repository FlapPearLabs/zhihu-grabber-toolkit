/**
 * research-orchestration/test/p2a-t06-action-lifecycle-durable-commit.test.mjs
 *
 * P2A-T06 (#118) focused tests — action lifecycle, durable commit, replay protection.
 *
 * Authority (semantics are FROZEN; this suite must not reinterpret them):
 *   - docs/specs/p2-ari-f02-targeted-requery.md      §5 D5, §12, §14
 *   - docs/architecture/key-decisions.md             D12-5
 *   - docs/planning/..._SEAM_CONTRACT_V1.md          F.1, F.5
 *   - docs/planning/..._SEAM_MAP_V1.md               S4
 *   - Ticket Decomposition §P2A-T06; Issue #118 GOAL / IN_SCOPE / OUT_OF_SCOPE /
 *     ACCEPTANCE_CRITERIA 1–6 / REQUIRED_TESTS / COUNTEREXAMPLES C4, C5, C12
 *   - P1-R06 (#94) frozen conclusion: checkpoint is the ONLY trust root; an
 *     unanchored sidecar receipt is a P0 unanchored trust source.
 *
 * T06 owns: the lifecycle state machine (advance operations + legality checks),
 * checkpoint-first staging and commit, the `state.hashes` targeted binding key,
 * resume-time recomputation of `targetedActionId` and the replay decision,
 * append-only audit, failure semantics.
 * T06 explicitly does NOT own: authorization policy (T05), resolution predicates
 * (T08), STOP / attempt accounting (T07), orchestration (T09), any new checkpoint
 * mechanism (state.mjs `writeState` / `validateArtifactCheckpoint` are REUSED).
 *
 * Anti-tautology discipline: the expected `targetedActionId` and the expected
 * artifact hash below are INDEPENDENT literals, computed OUTSIDE the module under
 * test (raw SHA-256 over the frozen F.1 canonical-JSON payload / over the raw
 * artifact bytes) and hard-coded here. No expected identity in this suite is
 * produced by calling the module under test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIONS_FILENAME,
  ACTIONS_SCHEMA,
  ACTION_RECORD_KEYS,
  AUDIT_ENTRY_KEYS,
  ACTION_STATUSES,
  ACTION_STATUS_AUTHORIZED,
  ACTION_STATUS_COMMITTED,
  ACTION_STATUS_EVALUATED,
  ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
  ACTION_STATUS_FAILED_OPERATIONAL,
  ACTION_STATUS_PROPOSED,
  ACTION_STATUS_REJECTED,
  ACTION_STATUS_RESOLVED,
  ACTION_STATUS_UNRESOLVED,
  COMMITTED_SET,
  FINAL_EVIDENCE_STATUSES,
  LEGAL_TRANSITIONS,
  LIFECYCLE_ERROR_INVALID,
  NON_ADVANCING_TERMINAL_STATUSES,
  RESUME_BLOCKED,
  RESUME_RERUN,
  RESUME_REUSE,
  RESUME_REASON_ARTIFACT_HASH_MISMATCH,
  RESUME_REASON_ARTIFACT_MISSING,
  RESUME_REASON_AUTHORIZED_ONLY,
  RESUME_REASON_BINDING_HASH_MISSING,
  RESUME_REASON_COMMITTED_WITH_VALID_BINDING,
  RESUME_REASON_IDENTITY_REPLAY_CONFLICT,
  RESUME_REASON_NO_PRIOR_ACTION,
  RESUME_REASON_TERMINAL_NON_ADVANCING,
  TARGETED_BINDING_PREFIX,
  advanceActionStatus,
  appendAuditEntry,
  isLegalTransition,
  appendActionRecord,
  commitTargetedAction,
  createActionsArtifact,
  decideTargetedReplay,
  finalizeTargetedCommit,
  loadActionsArtifact,
  persistActionsArtifact,
  prepareTargetedCommit,
  recordRejectedDecision,
  registerAuthorizedAction,
  stageTargetedArtifact,
  targetedBindingKey,
  validateActionsArtifact,
} from '../lib/targeted-requery-lifecycle.mjs';

import { readState, STAGES, writeState } from '../lib/state.mjs';
import {
  AUTHORIZATION_STATUS_REJECTED,
  computeTargetedActionId,
} from '../lib/targeted-requery-authorization.mjs';

// ---------------------------------------------------------------------------
// frozen literals (independent oracles — computed OUTSIDE the module under test)
// ---------------------------------------------------------------------------

const PLAN_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const GAP_IDENTITY_CORE = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const GAP_ID = `${GAP_IDENTITY_CORE}:0`;
const RUN_ID = 'run-t06-oracle';
const OCCURRENCE_ID = 'occ-t06-oracle';
const PROVIDER_SCOPE = [{ providerId: 'official', capability: 'search' }];

/** Identity tuple #1 — its F.1 id was computed independently (raw SHA-256). */
const IDENTITY_A = Object.freeze({
  runId: RUN_ID,
  occurrenceId: OCCURRENCE_ID,
  planHash: PLAN_HASH,
  gapId: GAP_ID,
  attempt: 1,
  normalizedQuery: 'zhihu answer quality',
  providerScope: PROVIDER_SCOPE,
});
/** INDEPENDENT ORACLE for identity #1 (see the header discipline note). */
const TARGETED_ACTION_ID_A = '82f07e1b73a1cd76ead66d19ce6452c2849e5c7c4d2dd6d2646d305e3a597f39';

/**
 * Identity tuple #2 (different attempt → different id).
 *
 * Its id is produced by the FROZEN T05 primitive while the tests are being set up,
 * i.e. NOT by the module under test: T05 owns the F.1 formula, and this suite only
 * needs a second well-formed action to exercise cross-identity behaviour.
 */
const IDENTITY_B = Object.freeze({ ...IDENTITY_A, attempt: 2 });

const ARTIFACT_REL = 'targeted-rounds/round-1/pool.json';
const ARTIFACT_BYTES = Buffer.from('{"pool":[],"poolHash":"deadbeef"}', 'utf8');
/** INDEPENDENT ORACLE for the round artifact bytes above. */
const ARTIFACT_HASH = 'c9de5ae3aa46d2e9337ed221679eafffc5762e7db77f54f39882d24ff01d0f43';

const MODULE_PATH = fileURLToPath(new URL('../lib/targeted-requery-lifecycle.mjs', import.meta.url));

function freshWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p2a-t06-'));
}

function freshState() {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    occurrenceId: OCCURRENCE_ID,
    stage: 'SEARCH',
    completedStages: [],
    artifacts: {},
    hashes: {},
  };
}

/** A minimal T05-shaped AUTHORIZED decision (only the fields T06 consumes). */
function authorizedDecision(identity, targetedActionId) {
  return {
    status: 'AUTHORIZED',
    targetedActionId,
    runId: identity.runId,
    occurrenceId: identity.occurrenceId,
    planHash: identity.planHash,
    gapId: identity.gapId,
    gapIdentityCore: GAP_IDENTITY_CORE,
    attempt: identity.attempt,
    query: identity.normalizedQuery,
    normalizedQuery: identity.normalizedQuery,
    queryTrustClass: 'PLAN_OWNED',
    providerScope: identity.providerScope,
    dedupeKey: 'd'.repeat(64),
    actionChannelAttemptCount: 1,
    rejectionCode: null,
    rejectionDetail: null,
  };
}

/** Build an artifact that already contains one AUTHORIZED action for identity #1. */
function artifactWithAuthorizedAction() {
  return registerAuthorizedAction(
    createActionsArtifact({ planHash: PLAN_HASH, occurrenceId: OCCURRENCE_ID }),
    authorizedDecision(IDENTITY_A, TARGETED_ACTION_ID_A),
  );
}

/** A second, independently-identified action (identity #2). */
function artifactWithTwoAuthorizedActions() {
  return registerAuthorizedAction(
    artifactWithAuthorizedAction(),
    authorizedDecision(IDENTITY_B, computeTargetedActionId(IDENTITY_B)),
  );
}

// ---------------------------------------------------------------------------
// A. state machine: closed status set + legal / illegal transitions
// ---------------------------------------------------------------------------

test('A1 — the persisted status set is closed and contains NO `executing` state', () => {
  assert.deepEqual([...ACTION_STATUSES].sort(), [
    'AUTHORIZED',
    'COMMITTED',
    'EVALUATED',
    'EXHAUSTED_WITHIN_BUDGET',
    'FAILED_OPERATIONAL',
    'PROPOSED',
    'REJECTED',
    'RESOLVED',
    'UNRESOLVED',
  ].sort());
  assert.equal(ACTION_STATUSES.length, 9);
  assert.equal(ACTION_STATUSES.includes('EXECUTING'), false);
  assert.equal(ACTION_STATUSES.includes('executing'), false);
  // D5's advancing chain plus the two non-advancing terminals are all present.
  for (const s of [
    ACTION_STATUS_PROPOSED,
    ACTION_STATUS_AUTHORIZED,
    ACTION_STATUS_COMMITTED,
    ACTION_STATUS_EVALUATED,
    ACTION_STATUS_RESOLVED,
    ACTION_STATUS_UNRESOLVED,
    ACTION_STATUS_EXHAUSTED_WITHIN_BUDGET,
    ACTION_STATUS_REJECTED,
    ACTION_STATUS_FAILED_OPERATIONAL,
  ]) {
    assert.equal(ACTION_STATUSES.includes(s), true, `missing status ${s}`);
  }
  assert.deepEqual([...NON_ADVANCING_TERMINAL_STATUSES].sort(), ['FAILED_OPERATIONAL', 'REJECTED']);
  assert.deepEqual([...FINAL_EVIDENCE_STATUSES].sort(), [
    'EXHAUSTED_WITHIN_BUDGET', 'RESOLVED', 'UNRESOLVED',
  ]);
  assert.deepEqual([...COMMITTED_SET].sort(), [
    'COMMITTED', 'EVALUATED', 'EXHAUSTED_WITHIN_BUDGET', 'RESOLVED', 'UNRESOLVED',
  ]);
});

test('A2 — every frozen legal transition is accepted', () => {
  const expected = {
    PROPOSED: ['AUTHORIZED', 'REJECTED'],
    AUTHORIZED: ['COMMITTED', 'FAILED_OPERATIONAL'],
    // FAILED_OPERATIONAL has exactly ONE in-edge: the pre-commit operational window.
    COMMITTED: ['EVALUATED'],
    EVALUATED: ['RESOLVED', 'UNRESOLVED', 'EXHAUSTED_WITHIN_BUDGET'],
    REJECTED: [],
    FAILED_OPERATIONAL: [],
    RESOLVED: [],
    UNRESOLVED: [],
    EXHAUSTED_WITHIN_BUDGET: [],
  };
  for (const from of ACTION_STATUSES) {
    assert.deepEqual([...(LEGAL_TRANSITIONS[from] ?? [])].sort(), [...(expected[from] ?? [])].sort());
  }
});

test('A3 — S4 ILLEGAL_STATES are rejected by the advance primitive', () => {
  const base = artifactWithAuthorizedAction();
  const id = TARGETED_ACTION_ID_A;

  // PROPOSED may not jump straight to retrieval: it has no COMMITTED edge at all.
  assert.equal(isLegalTransition(ACTION_STATUS_PROPOSED, ACTION_STATUS_COMMITTED), false);
  assert.equal(isLegalTransition('PROPOSED', 'EVALUATED'), false);
  assert.equal(isLegalTransition('PROPOSED', 'RESOLVED'), false);
  // COMMITTED may not be silently re-run (COMMITTED -> COMMITTED).
  const committed = advanceActionStatus(base, id, ACTION_STATUS_COMMITTED);
  assert.equal(committed.targetedActions[0].status, ACTION_STATUS_COMMITTED);
  assert.throws(
    () => advanceActionStatus(committed, id, ACTION_STATUS_COMMITTED),
    (err) => err.code === LIFECYCLE_ERROR_INVALID,
  );
  // RESOLVED may not appear before EVALUATED.
  assert.throws(
    () => advanceActionStatus(committed, id, ACTION_STATUS_RESOLVED),
    (err) => err.code === LIFECYCLE_ERROR_INVALID,
  );
});

test('A4 — FAILED_OPERATIONAL is never written as RESOLVED, and is terminal', () => {
  let art = artifactWithAuthorizedAction();
  art = advanceActionStatus(art, TARGETED_ACTION_ID_A, ACTION_STATUS_FAILED_OPERATIONAL);
  assert.equal(art.targetedActions[0].status, ACTION_STATUS_FAILED_OPERATIONAL);
  assert.notEqual(art.targetedActions[0].status, ACTION_STATUS_RESOLVED);
  assert.throws(
    () => advanceActionStatus(art, TARGETED_ACTION_ID_A, ACTION_STATUS_RESOLVED),
    (err) => err.code === LIFECYCLE_ERROR_INVALID,
  );
  assert.throws(
    () => advanceActionStatus(art, TARGETED_ACTION_ID_A, ACTION_STATUS_COMMITTED),
    (err) => err.code === LIFECYCLE_ERROR_INVALID,
  );
  // and a committed action can never be marked as an operational failure: after the
  // commit point the checkpoint binding is the trust root, and overriding it would
  // discard validated completion evidence (F.5 / D12-5).
  const committedAgain = advanceActionStatus(
    artifactWithAuthorizedAction(),
    TARGETED_ACTION_ID_A,
    ACTION_STATUS_COMMITTED,
  );
  assert.throws(
    () => advanceActionStatus(committedAgain, TARGETED_ACTION_ID_A, ACTION_STATUS_FAILED_OPERATIONAL),
    (err) => err.code === LIFECYCLE_ERROR_INVALID,
  );
});

test('A5 — REJECTED is terminal and cannot be re-opened into AUTHORIZED', () => {
  const art = recordRejectedDecision(
    createActionsArtifact({ planHash: PLAN_HASH, occurrenceId: OCCURRENCE_ID }),
    {
      status: AUTHORIZATION_STATUS_REJECTED,
      targetedActionId: null,
      runId: RUN_ID,
      occurrenceId: OCCURRENCE_ID,
      planHash: PLAN_HASH,
      gapId: GAP_ID,
      gapIdentityCore: GAP_IDENTITY_CORE,
      attempt: null,
      query: null,
      normalizedQuery: null,
      queryTrustClass: null,
      providerScope: null,
      dedupeKey: null,
      actionChannelAttemptCount: null,
      rejectionCode: 'PROPOSAL_NOT_ADMITTED',
      rejectionDetail: 'UNKNOWN_GAP_ID',
    },
    { queryText: 'verbatim untrusted proposal text' },
  );
  assert.equal(art.rejected.length, 1);
  assert.equal(art.rejected[0].rejectionCode, 'PROPOSAL_NOT_ADMITTED');
  assert.equal(art.rejected[0].proposalVerbatim.queryText, 'verbatim untrusted proposal text');
  assert.equal(art.targetedActions.length, 0);
  // REJECTED has no out-edge at all.
  assert.deepEqual(LEGAL_TRANSITIONS[ACTION_STATUS_REJECTED], []);
});

test('A6 — EVALUATED may advance to exactly the three evidence terminals', () => {
  const base = artifactWithAuthorizedAction();
  const evaluated = advanceActionStatus(
    advanceActionStatus(base, TARGETED_ACTION_ID_A, ACTION_STATUS_COMMITTED),
    TARGETED_ACTION_ID_A,
    ACTION_STATUS_EVALUATED,
  );
  assert.equal(evaluated.targetedActions[0].status, ACTION_STATUS_EVALUATED);
  for (const terminal of FINAL_EVIDENCE_STATUSES) {
    const next = advanceActionStatus(evaluated, TARGETED_ACTION_ID_A, terminal);
    assert.equal(next.targetedActions[0].status, terminal);
    assert.throws(
      () => advanceActionStatus(next, TARGETED_ACTION_ID_A, ACTION_STATUS_EVALUATED),
      (err) => err.code === LIFECYCLE_ERROR_INVALID,
    );
  }
});

test('A7 — every state advance leaves machine-checkable evidence (identity + binding hash)', () => {
  const base = artifactWithAuthorizedAction();
  const committed = advanceActionStatus(base, TARGETED_ACTION_ID_A, ACTION_STATUS_COMMITTED, {
    event: 'COMMIT',
    bindingKey: targetedBindingKey(TARGETED_ACTION_ID_A),
    bindingHash: ARTIFACT_HASH,
    artifactRel: ARTIFACT_REL,
  });
  const record = committed.targetedActions[0];
  assert.equal(record.bindingKey, targetedBindingKey(TARGETED_ACTION_ID_A));
  assert.equal(record.bindingHash, ARTIFACT_HASH);
  assert.equal(record.artifactRel, ARTIFACT_REL);
  const audit = record.audit;
  assert.equal(audit.length, 2); // registration + commit
  assert.deepEqual(audit.map((e) => e.seq), [1, 2]);
  assert.equal(audit[1].event, 'COMMIT');
  assert.equal(audit[1].from, ACTION_STATUS_AUTHORIZED);
  assert.equal(audit[1].to, ACTION_STATUS_COMMITTED);
  assert.equal(audit[1].bindingHash, ARTIFACT_HASH);
});

// ---------------------------------------------------------------------------
// B. artifact persistence, append-only audit, fail-closed validation
// ---------------------------------------------------------------------------

test('B1 — round-trip: create / validate / persist / load, with a stable artifact hash', () => {
  const workDir = freshWorkDir();
  const art = artifactWithAuthorizedAction();
  const verdict = validateActionsArtifact(art);
  assert.equal(verdict.ok, true, verdict.reason);
  const persisted = persistActionsArtifact(workDir, art);
  assert.equal(persisted.ok, true);
  assert.equal(persisted.path, ACTIONS_FILENAME);
  assert.equal(fs.existsSync(path.join(workDir, ACTIONS_FILENAME)), true);

  const loaded = loadActionsArtifact(workDir, PLAN_HASH);
  assert.equal(loaded.ok, true, loaded.reason);
  assert.deepEqual(loaded.artifact, verdict.validated);
  assert.equal(loaded.hash, persisted.hash);
  // byte-deterministic: re-serialising the loaded artifact yields the same hash
  const again = persistActionsArtifact(workDir, loaded.artifact);
  assert.equal(again.hash, persisted.hash);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(path.join(workDir, ACTIONS_FILENAME))).digest('hex'),
    persisted.hash,
  );
});

test('B2 — the actions artifact schema is closed and anchored', () => {
  const art = artifactWithAuthorizedAction();
  assert.equal(art.schema, ACTIONS_SCHEMA);
  assert.equal(validateActionsArtifact({ ...art, schema: 'other/v1' }).ok, false);
  assert.equal(validateActionsArtifact({ ...art, extra: 1 }).ok, false);
  assert.equal(loadActionsArtifact(freshWorkDir(), PLAN_HASH).ok, false);
  const wrongAnchor = loadActionsArtifact((() => {
    const d = freshWorkDir();
    persistActionsArtifact(d, art);
    return d;
  })(), 'f'.repeat(64));
  assert.equal(wrongAnchor.ok, false);
  assert.equal(wrongAnchor.reason, 'stale_plan_hash');
});

test('B3 — append-only: an existing record is never rewritten', () => {
  const workDir = freshWorkDir();
  const first = artifactWithAuthorizedAction();
  persistActionsArtifact(workDir, first);
  const firstBytes = fs.readFileSync(path.join(workDir, ACTIONS_FILENAME), 'utf8');
  const firstRecord = JSON.parse(firstBytes).targetedActions[0];

  const second = registerAuthorizedAction(
    first,
    authorizedDecision(IDENTITY_B, computeTargetedActionId(IDENTITY_B)),
  );
  assert.equal(second.targetedActions.length, 2);
  const survivor = second.targetedActions.find((r) => r.targetedActionId === TARGETED_ACTION_ID_A);
  assert.deepEqual(survivor, firstRecord);
  // `appendActionRecord` itself never rewrites an existing record either
  const appended = appendActionRecord(first, second.targetedActions
    .find((r) => r.targetedActionId === computeTargetedActionId(IDENTITY_B)));
  assert.deepEqual(
    appended.targetedActions.find((r) => r.targetedActionId === TARGETED_ACTION_ID_A),
    firstRecord,
  );
});

test('B4 — the audit trail is append-only: history is preserved, never replaced', () => {
  let art = artifactWithAuthorizedAction();
  const historyAfterRegistration = [...art.targetedActions[0].audit];
  art = advanceActionStatus(art, TARGETED_ACTION_ID_A, ACTION_STATUS_COMMITTED);
  art = advanceActionStatus(art, TARGETED_ACTION_ID_A, ACTION_STATUS_EVALUATED);
  const audit = art.targetedActions[0].audit;
  assert.equal(audit.length, 3);
  assert.deepEqual(audit.slice(0, historyAfterRegistration.length), historyAfterRegistration);
  assert.deepEqual(audit.map((e) => e.seq), [1, 2, 3]);
  // a non-advancing terminal does not truncate history either
  let failed = artifactWithAuthorizedAction();
  failed = advanceActionStatus(failed, TARGETED_ACTION_ID_A, ACTION_STATUS_FAILED_OPERATIONAL);
  assert.equal(failed.targetedActions[0].audit.length, 2);
  assert.equal(failed.targetedActions[0].audit[0].event, 'REGISTER_AUTHORIZED');
});

test('B5 — a tampered record fails closed on strict load', () => {
  const workDir = freshWorkDir();
  persistActionsArtifact(workDir, artifactWithAuthorizedAction());
  const file = path.join(workDir, ACTIONS_FILENAME);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  parsed.targetedActions[0].attempt = 2; // tamper without recomputing the id
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
  const loaded = loadActionsArtifact(workDir, PLAN_HASH);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.reason, 'action identity does not match the frozen F.1 formula');
});

test('B6 — action record and audit entry key sets are closed', () => {
  // Explicit literals (not the exported constants compared with themselves): the
  // record shape is what consumers bind to, so it is pinned here by hand.
  assert.deepEqual([...ACTION_RECORD_KEYS], [
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
  assert.deepEqual([...AUDIT_ENTRY_KEYS], [
    'artifactRel',
    'bindingHash',
    'bindingKey',
    'event',
    'from',
    'reason',
    'seq',
    'to',
  ]);
  const record = artifactWithAuthorizedAction().targetedActions[0];
  assert.deepEqual(Object.keys(record).sort(), [...ACTION_RECORD_KEYS].sort());
  assert.deepEqual(Object.keys(record.audit[0]).sort(), [...AUDIT_ENTRY_KEYS].sort());
});

// ---------------------------------------------------------------------------
// C. commit point (C4 / C5) — checkpoint-first, checkpoint is the only trust root
// ---------------------------------------------------------------------------

test('C1 — commit point order: bytes durable + fsync, hash into state.hashes, then writeState', () => {
  const workDir = freshWorkDir();
  const art = artifactWithAuthorizedAction();
  const state = freshState();

  const prepared = prepareTargetedCommit({
    workDir,
    artifact: art,
    state,
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  // (1) the round artifact bytes are already durable on disk BEFORE the checkpoint
  assert.equal(fs.existsSync(path.join(workDir, ARTIFACT_REL)), true);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(path.join(workDir, ARTIFACT_REL))).digest('hex'),
    ARTIFACT_HASH,
  );
  // (2) the hash is already bound into the state the caller will hand to writeState
  assert.equal(prepared.state.hashes[targetedBindingKey(TARGETED_ACTION_ID_A)], ARTIFACT_HASH);
  // (3) the caller's input state was NOT mutated
  assert.deepEqual(state.hashes, {});
  // (4) but the checkpoint has not been written yet
  assert.equal(readState(workDir), null);

  finalizeTargetedCommit(workDir, prepared.state);
  const persisted = readState(workDir);
  assert.equal(persisted.hashes[targetedBindingKey(TARGETED_ACTION_ID_A)], ARTIFACT_HASH);
});

test('C2 — C4: a crash AFTER the commit point never re-runs the paid retrieval', () => {
  const workDir = freshWorkDir();
  const art = artifactWithAuthorizedAction();
  const committed = commitTargetedAction({
    workDir,
    artifact: art,
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.artifact.targetedActions[0].status, ACTION_STATUS_COMMITTED);

  const decision = decideTargetedReplay({
    workDir,
    state: readState(workDir),
    artifact: loadActionsArtifact(workDir, PLAN_HASH).artifact,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_REUSE);
  assert.equal(decision.reason, RESUME_REASON_COMMITTED_WITH_VALID_BINDING);
  assert.equal(decision.targetedActionId, TARGETED_ACTION_ID_A);
});

test('C3 — C5a: a crash after staging but before the commit → safe re-run once', () => {
  const workDir = freshWorkDir();
  const art = artifactWithAuthorizedAction();
  // crash after the artifact bytes are durable, before anything else
  const staged = stageTargetedArtifact(workDir, ARTIFACT_REL, ARTIFACT_BYTES);
  assert.equal(staged.hash, ARTIFACT_HASH);
  assert.equal(fs.existsSync(path.join(workDir, ARTIFACT_REL)), true);

  const decision = decideTargetedReplay({
    workDir,
    state: null, // no checkpoint at all
    artifact: art,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  // the action is still AUTHORIZED — F.5's "authorized but not committed" branch
  assert.equal(decision.reason, RESUME_REASON_AUTHORIZED_ONLY);
  assert.equal(decision.action.status, ACTION_STATUS_AUTHORIZED);
});

test('C4 — C5b: a crash after the record says COMMITTED but before writeState → safe re-run once', () => {
  const workDir = freshWorkDir();
  const art = artifactWithAuthorizedAction();
  const prepared = prepareTargetedCommit({
    workDir,
    artifact: art,
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  // the record on disk now claims COMMITTED ...
  const onDisk = loadActionsArtifact(workDir, PLAN_HASH);
  assert.equal(onDisk.ok, true);
  assert.equal(onDisk.artifact.targetedActions[0].status, ACTION_STATUS_COMMITTED);
  // ... but the checkpoint (the only trust root) does not exist yet.
  assert.equal(readState(workDir), null);

  const decision = decideTargetedReplay({
    workDir,
    state: readState(workDir),
    artifact: onDisk.artifact,
    identity: IDENTITY_A,
  });
  // UNKNOWN != PASS: a COMMITTED status without a checkpoint binding is NOT
  // completion evidence, so the honest outcome is one safe re-run.
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_BINDING_HASH_MISSING);
  assert.equal(prepared.state.hashes[targetedBindingKey(TARGETED_ACTION_ID_A)], ARTIFACT_HASH);
});

test('C5 — AUTHORIZED but never committed → safe re-run once', () => {
  const workDir = freshWorkDir();
  const art = artifactWithAuthorizedAction();
  writeState(workDir, freshState());
  const decision = decideTargetedReplay({
    workDir,
    state: readState(workDir),
    artifact: art,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_AUTHORIZED_ONLY);
});

test('C6 — binding hash present but the artifact was mutated → no false reuse', () => {
  const workDir = freshWorkDir();
  commitTargetedAction({
    workDir,
    artifact: artifactWithAuthorizedAction(),
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  fs.writeFileSync(path.join(workDir, ARTIFACT_REL), '{"pool":[1]}');
  const decision = decideTargetedReplay({
    workDir,
    state: readState(workDir),
    artifact: loadActionsArtifact(workDir, PLAN_HASH).artifact,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_ARTIFACT_HASH_MISMATCH);
});

test('C7 — binding hash present but the artifact is missing → no false reuse', () => {
  const workDir = freshWorkDir();
  commitTargetedAction({
    workDir,
    artifact: artifactWithAuthorizedAction(),
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  fs.rmSync(path.join(workDir, ARTIFACT_REL));
  const decision = decideTargetedReplay({
    workDir,
    state: readState(workDir),
    artifact: loadActionsArtifact(workDir, PLAN_HASH).artifact,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_ARTIFACT_MISSING);
});

test('C8 — a binding key with no hash in state.hashes is never treated as reuse', () => {
  const workDir = freshWorkDir();
  const art = artifactWithAuthorizedAction();
  commitTargetedAction({
    workDir,
    artifact: art,
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  // simulate a half-written / rolled-back checkpoint binding
  const state = readState(workDir);
  delete state.hashes[targetedBindingKey(TARGETED_ACTION_ID_A)];
  const decision = decideTargetedReplay({
    workDir,
    state,
    artifact: loadActionsArtifact(workDir, PLAN_HASH).artifact,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_BINDING_HASH_MISSING);
});

test('C9 — counterexample C12: same id, different content → IDENTITY_REPLAY_CONFLICT, conservative re-run, old audit kept', () => {
  const workDir = freshWorkDir();
  commitTargetedAction({
    workDir,
    artifact: artifactWithAuthorizedAction(),
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  const historyBefore = loadActionsArtifact(workDir, PLAN_HASH)
    .artifact.targetedActions[0].audit.map((e) => e.seq);

  // tamper with the identity content WITHOUT recomputing the id
  const file = path.join(workDir, ACTIONS_FILENAME);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  parsed.targetedActions[0].attempt = 7;
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);

  const replayArtifact = loadActionsArtifact(workDir, PLAN_HASH, { strict: false });
  assert.equal(replayArtifact.ok, true, replayArtifact.reason);

  const decision = decideTargetedReplay({
    workDir,
    state: readState(workDir),
    artifact: replayArtifact.artifact,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_IDENTITY_REPLAY_CONFLICT);
  // old audit traces are retained (append-only), never dropped
  assert.deepEqual(decision.action.audit.map((e) => e.seq), historyBefore);
});

test('C10 — no prior action for this identity → safe re-run', () => {
  const workDir = freshWorkDir();
  const decision = decideTargetedReplay({
    workDir,
    state: freshState(),
    artifact: artifactWithAuthorizedAction(),
    identity: IDENTITY_B,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_NO_PRIOR_ACTION);
});

test('C11 — a non-advancing terminal is not silently re-run and not reused', () => {
  const workDir = freshWorkDir();
  const art = advanceActionStatus(
    artifactWithAuthorizedAction(),
    TARGETED_ACTION_ID_A,
    ACTION_STATUS_FAILED_OPERATIONAL,
  );
  writeState(workDir, freshState());
  const decision = decideTargetedReplay({
    workDir,
    state: readState(workDir),
    artifact: art,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_BLOCKED);
  assert.equal(decision.reason, RESUME_REASON_TERMINAL_NON_ADVANCING);
});

test('C13 — a COMMITTED status alone is never completion evidence (status is a view)', () => {
  const workDir = freshWorkDir();
  // reach COMMITTED through the state machine WITHOUT the commit point:
  // no artifact staged, no binding bound.
  const art = advanceActionStatus(
    artifactWithAuthorizedAction(),
    TARGETED_ACTION_ID_A,
    ACTION_STATUS_COMMITTED,
  );
  assert.equal(art.targetedActions[0].status, ACTION_STATUS_COMMITTED);
  writeState(workDir, freshState());
  const decision = decideTargetedReplay({
    workDir,
    state: readState(workDir),
    artifact: art,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_BINDING_HASH_MISSING);
});

test('C14 — a malformed (non-64-hex) binding value is never upgraded to reuse', () => {
  const workDir = freshWorkDir();
  commitTargetedAction({
    workDir,
    artifact: artifactWithAuthorizedAction(),
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  const state = readState(workDir);
  state.hashes[targetedBindingKey(TARGETED_ACTION_ID_A)] = 'not-a-hash';
  const decision = decideTargetedReplay({
    workDir,
    state,
    artifact: loadActionsArtifact(workDir, PLAN_HASH).artifact,
    identity: IDENTITY_A,
  });
  assert.equal(decision.decision, RESUME_RERUN);
  assert.equal(decision.reason, RESUME_REASON_BINDING_HASH_MISSING);
});

test('C15 — a committed action cannot be committed a second time (no silent re-run)', () => {
  const workDir = freshWorkDir();
  const art = artifactWithAuthorizedAction();
  const first = commitTargetedAction({
    workDir,
    artifact: art,
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  assert.equal(first.ok, true);
  assert.throws(
    () => commitTargetedAction({
      workDir,
      artifact: loadActionsArtifact(workDir, PLAN_HASH).artifact,
      state: readState(workDir),
      targetedActionId: TARGETED_ACTION_ID_A,
      artifactRel: ARTIFACT_REL,
      artifactBytes: ARTIFACT_BYTES,
    }),
    (err) => err.code === LIFECYCLE_ERROR_INVALID,
  );
  // the second attempt changed nothing: one COMMIT audit entry, one binding
  const after = loadActionsArtifact(workDir, PLAN_HASH).artifact;
  assert.equal(after.targetedActions[0].status, ACTION_STATUS_COMMITTED);
  assert.equal(after.targetedActions[0].audit.filter((e) => e.event === 'COMMIT').length, 1);
  assert.equal(readState(workDir).hashes[targetedBindingKey(TARGETED_ACTION_ID_A)], ARTIFACT_HASH);
});

test('C18 — a bound action cannot have its binding rewritten by a later advance', () => {
  const committed = advanceActionStatus(
    artifactWithAuthorizedAction(),
    TARGETED_ACTION_ID_A,
    ACTION_STATUS_COMMITTED,
    {
      event: 'COMMIT',
      bindingKey: targetedBindingKey(TARGETED_ACTION_ID_A),
      bindingHash: ARTIFACT_HASH,
      artifactRel: ARTIFACT_REL,
    },
  );
  const bound = committed.targetedActions[0];
  assert.equal(bound.bindingHash, ARTIFACT_HASH);
  // advancing further with a DIFFERENT binding is refused (fail closed)
  assert.throws(
    () => advanceActionStatus(committed, TARGETED_ACTION_ID_A, ACTION_STATUS_EVALUATED, {
      bindingHash: 'b'.repeat(64),
    }),
    (err) => err.code === LIFECYCLE_ERROR_INVALID,
  );
  // ... but the normal advance (no binding supplied) preserves it exactly
  const evaluated = advanceActionStatus(committed, TARGETED_ACTION_ID_A, ACTION_STATUS_EVALUATED);
  assert.equal(evaluated.targetedActions[0].status, ACTION_STATUS_EVALUATED);
  assert.equal(evaluated.targetedActions[0].bindingKey, bound.bindingKey);
  assert.equal(evaluated.targetedActions[0].bindingHash, ARTIFACT_HASH);
  assert.equal(evaluated.targetedActions[0].artifactRel, ARTIFACT_REL);
});

test('C17 — a replay decision can be recorded as audit without changing the status', () => {
  const workDir = freshWorkDir();
  const committed = commitTargetedAction({
    workDir,
    artifact: artifactWithAuthorizedAction(),
    state: freshState(),
    targetedActionId: TARGETED_ACTION_ID_A,
    artifactRel: ARTIFACT_REL,
    artifactBytes: ARTIFACT_BYTES,
  });
  const before = committed.artifact.targetedActions[0].audit.map((e) => e.seq);
  const recorded = appendAuditEntry(committed.artifact, TARGETED_ACTION_ID_A, {
    event: 'REPLAY_DECISION_REUSE',
    reason: RESUME_REASON_COMMITTED_WITH_VALID_BINDING,
  });
  const record = recorded.targetedActions[0];
  // status unchanged ...
  assert.equal(record.status, ACTION_STATUS_COMMITTED);
  // ... history PRESERVED (append-only) and one new entry appended
  assert.deepEqual(record.audit.map((e) => e.seq), [...before, before.length + 1]);
  assert.deepEqual(record.audit.slice(0, before.length).map((e) => e.seq), before);
  assert.equal(record.audit[record.audit.length - 1].event, 'REPLAY_DECISION_REUSE');
  assert.equal(record.audit[record.audit.length - 1].reason, RESUME_REASON_COMMITTED_WITH_VALID_BINDING);
  assert.equal(record.audit[record.audit.length - 1].to, ACTION_STATUS_COMMITTED);
});

test('C16 — the targeted binding key is namespaced and never collides with a stage key', () => {
  assert.equal(TARGETED_BINDING_PREFIX, 'targeted-action:');
  assert.equal(targetedBindingKey(TARGETED_ACTION_ID_A), `targeted-action:${TARGETED_ACTION_ID_A}`);
  assert.equal(STAGES.includes(targetedBindingKey(TARGETED_ACTION_ID_A)), false);
  for (const stage of STAGES) {
    assert.equal(stage.startsWith(TARGETED_BINDING_PREFIX), false);
  }
});

// ---------------------------------------------------------------------------
// D. source guards — hard invariants that code alone cannot prove
// ---------------------------------------------------------------------------

test('D1 — no `executing` persisted state is reachable from the module', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(/'\s*EXECUTING\s*'/.test(source), false);
  assert.equal(/'\s*executing\s*'/.test(source), false);
  assert.equal(/ACTION_STATUS_EXECUTING/.test(source), false);
});

test('D2 — the honest cost statement is preserved in the module', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(/重复付费/.test(source), true);
  assert.equal(/UNKNOWN != PASS/.test(source), true);
});

test('D3 — no unanchored sidecar receipt: no second checkpoint mechanism is created', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(/receipt/i.test(source), false);
  // the checkpoint primitives are REUSED from state.mjs, not re-implemented
  assert.equal(/from '\.\/state\.mjs'/.test(source), true);
  assert.equal(/writeState/.test(source), true);
  assert.equal(/validateArtifactCheckpoint/.test(source), true);
  // no second state file / no parallel checkpoint writer
  assert.equal(/orchestration-state/.test(source), false);
});

test('D4 — identity carries no clock and no randomness', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(/Date\.now\(\)/.test(source), false);
  assert.equal(/new Date\(\)/.test(source), false);
  assert.equal(/randomUUID/.test(source), false);
  assert.equal(/Math\.random/.test(source), false);
});

test('D5 — the F.1 identity is recomputed by REUSING the T05 primitive', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  assert.equal(/from '\.\/targeted-requery-authorization\.mjs'/.test(source), true);
  assert.equal(/computeTargetedActionId/.test(source), true);
  assert.equal(/p2-ari-targeted-action\/v1/.test(source), false); // never re-derived locally
});
