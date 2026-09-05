/**
 * research-orchestration/test/p1-seam-a-producer-conformance.test.mjs
 *
 * P1 SEAM A — TYPE_B REAL PRODUCER CONFORMANCE TEST (R1-F4).
 *
 * TYPE_A fixture tests (p1-seam-contracts.test.mjs) prove fixture→validator
 * consistency. That is NOT sufficient once a real producer exists: this test
 * proves the REAL reviewed T09 producer output satisfies the frozen SEAM A
 * contract:
 *
 *   ACTUAL T09 PRODUCER OUTPUT (reviewed @ pinned SHA)
 *     → deriveResearchCorpusManifest (real production module)
 *     → SEAM A validator (test/helpers/p1-seam-contracts.mjs)
 *     → PASS
 *
 * The pinned SHA is the T09 REVIEWED_CODE_SHA (fresh review Round G + third-party
 * adversarial review double PASS_WITH_NONBLOCKING_FINDINGS), delivered via PR #68.
 * The producer module is materialized read-only with `git archive` at that exact
 * SHA — this test does NOT copy, re-implement, or modify any T09 logic, and does
 * NOT require PR #68 to be merged. T09 semantics are never adapted to the seam.
 *
 * Negative conformance: a captured-but-not-verified group never becomes a valid
 * SEAM A input (I1 CAPTURED != VERIFIED), and any post-hoc artifact tampering is
 * detected by the self-verifying manifestHash recomputation.
 *
 * Deterministic, offline, no network, no credentials.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateResearchCorpusManifest } from './helpers/p1-seam-contracts.mjs';

const REVIEWED_T09_SHA = '4789382f36d179dc13957f2c23748f169875d7a2'; // T09 REVIEWED_CODE_SHA (PR #68)
const PLAN_HASH = '5f1a2b3c4d5e6f708192a3b4c5d6e7f80112233445566778899aabbccddeeff0';

function findRepoRoot() {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir; // dir or worktree pointer file
    const parent = path.resolve(dir, '..');
    if (parent === dir) throw new Error(`repo root (.git) not found above ${import.meta.url}`);
    dir = parent;
  }
}

/**
 * Materialize the REAL producer module tree at the pinned reviewed SHA via
 * `git archive` into a temp dir, then import it. Read-only w.r.t. the repo;
 * the temp dir is removed after the suite.
 */
function materializeProducer() {
  const repoRoot = findRepoRoot();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-seam-a-typeb-'));
  const tarPath = path.join(base, 'producer.tar');
  // Full-tree archive (~3 MB): the producer's lib imports cross-package sibling
  // sources (e.g. zhihu-answer-grabber/src/markdown-security.js via rrf.mjs), so
  // the archived tree must preserve repo-root-relative resolution.
  const tarBuf = execFileSync('git', ['archive', '--format=tar', REVIEWED_T09_SHA], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(tarPath, tarBuf);
  const extractDir = path.join(base, 'tree');
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xf', tarPath, '-C', extractDir]);
  const moduleUrl = pathToFileURL(
    path.join(extractDir, 'research-orchestration', 'lib', 'multi-group-execution.mjs'),
  ).href;
  return {
    moduleUrl,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

const producerTree = materializeProducer();
after(() => producerTree.cleanup());

/** Fake T05-side capture adapter: deterministic answers.json + §5.1-gate-valid result. */
function makeCaptureAdapter() {
  return {
    retrieve({ questionId, outDir }) {
      const captureDir = path.join(outDir, questionId);
      fs.mkdirSync(captureDir, { recursive: true });
      fs.writeFileSync(
        path.join(captureDir, 'answers.json'),
        `${JSON.stringify({ questionId, answers: [{ answerId: 'a-1' }, { answerId: 'a-2' }, { answerId: 'a-3' }] }, null, 2)}\n`,
      );
      return {
        ok: true,
        provider_id: 'zhihu-session-capture',
        capability: 'captureAnswers',
        auth_class: 'session',
        retrieved_at: '2026-09-05T00:00:00.000Z',
        completeness: { status: 'complete', evidence: { recorded: 'deterministic-conformance-evidence' } },
        items: [
          { identity: { questionId }, provenance: { route: 'p1-seam-a-conformance' }, facts: { capturedAnswerCount: 3 } },
        ],
      };
    },
  };
}

/** Fake primitive runner (zhihu-verify / zhihu-handoff / corpus-verify-handoff). */
function makeRunner({ verifyValidFalseFor = [] } = {}) {
  return function runPrimitive(name, args) {
    if (name === 'zhihu-verify') {
      const qid = path.basename(args[0]);
      if (verifyValidFalseFor.includes(qid)) {
        return { status: 0, stdout: JSON.stringify({ valid: false, questionId: qid, capturedAnswerCount: 3, reportedAnswerCount: 3 }), stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify({ valid: true, questionId: qid, capturedAnswerCount: 3, reportedAnswerCount: 3 }), stderr: '' };
    }
    if (name === 'zhihu-handoff') {
      const dir = args[0];
      const qid = path.basename(dir);
      fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ task: 'digest', questionId: qid }, null, 2)}\n`);
      return { status: 0, stdout: JSON.stringify({ ok: true }), stderr: '' };
    }
    if (name === 'corpus-verify-handoff') {
      return { status: 0, stdout: JSON.stringify({ valid: true }), stderr: '' };
    }
    throw new Error(`unexpected primitive: ${name}`);
  };
}

function buildSelectionDecision() {
  return {
    verdict: 'auto',
    reason: 'clear_best',
    planHash: PLAN_HASH,
    poolPlanHash: PLAN_HASH,
    planHashMatch: true,
    selectedGroups: [
      { groupId: '23456789', questionId: '23456789' },
      { groupId: '34561234', questionId: '34561234' },
    ],
  };
}

const producer = await import(producerTree.moduleUrl);

test('REAL_T09_TO_SEAM_A_CONFORMANCE: real reviewed producer output passes the frozen SEAM A validator', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-seam-a-typeb-run-'));
  try {
    const selectionDecision = buildSelectionDecision();
    const state = producer.createMultiGroupExecutionState({ planHash: PLAN_HASH, selectionDecision });
    const captureAdapter = makeCaptureAdapter();
    const runner = makeRunner({ verifyValidFalseFor: ['34561234'] }); // group 2: legal captured-not-verified

    // group 1: full compose (capture → verify → handoff)
    producer.executeGroupCapture({ state, groupId: '23456789', workDir, captureAdapter });
    producer.executeGroupVerify({ state, groupId: '23456789', workDir, runner });
    producer.executeGroupHandoff({ state, groupId: '23456789', workDir, runner });
    // group 2: capture → verify INVALID (captured != verified; stays outside refs)
    producer.executeGroupCapture({ state, groupId: '34561234', workDir, captureAdapter });
    producer.executeGroupVerify({ state, groupId: '34561234', workDir, runner });

    const manifest = producer.deriveResearchCorpusManifest({ state, selectionDecision });

    // real producer shape (no projection needed — SEAM A is an identity contract)
    assert.equal(manifest.type, 'research-corpus-manifest');
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(Object.keys(manifest).sort(), [
      'accounting', 'groups', 'manifestHash', 'planHash', 'schemaVersion',
      'selectionDecisionHash', 'selectionIdentity', 'type',
    ]);

    // I1: captured-but-not-verified group NEVER enters groups[]
    const g2 = state.groups['34561234'];
    assert.equal(g2.captured, true);
    assert.equal(g2.verified, false);
    assert.equal(g2.verification.valid, false);
    assert.ok(!manifest.groups.some((r) => r.groupId === '34561234'), 'captured-not-verified group must not enter SEAM A groups[]');
    assert.deepEqual(manifest.groups.map((r) => r.groupId), ['23456789']);

    // real accounting shows the excluded group
    assert.deepEqual(manifest.accounting, {
      selectedGroupCount: 2,
      verifiedGroupCount: 1,
      capturedNotVerifiedGroupCount: 1,
      failedGroupCount: 0,
    });

    // THE conformance proof: real output satisfies the frozen seam contract
    const result = validateResearchCorpusManifest(manifest);
    assert.equal(result.ok, true, JSON.stringify(result.errors));

    // the self-verifying hash uses the producer's own canonicalization domain
    assert.match(manifest.manifestHash, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('negative conformance: captured-only group smuggled into a real manifest fails closed (self-verifying hash)', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-seam-a-typeb-neg-'));
  try {
    const selectionDecision = buildSelectionDecision();
    const state = producer.createMultiGroupExecutionState({ planHash: PLAN_HASH, selectionDecision });
    const captureAdapter = makeCaptureAdapter();
    const runner = makeRunner({ verifyValidFalseFor: ['34561234'] });
    producer.executeGroupCapture({ state, groupId: '23456789', workDir, captureAdapter });
    producer.executeGroupVerify({ state, groupId: '23456789', workDir, runner });
    producer.executeGroupHandoff({ state, groupId: '23456789', workDir, runner });
    producer.executeGroupCapture({ state, groupId: '34561234', workDir, captureAdapter });
    producer.executeGroupVerify({ state, groupId: '34561234', workDir, runner });

    const manifest = producer.deriveResearchCorpusManifest({ state, selectionDecision });

    // smuggle the captured-not-verified group into groups[] without recomputing manifestHash
    manifest.groups.push({
      groupId: '34561234',
      questionId: '34561234',
      answersRel: 'zhihu/34561234/answers.json',
      handoffRel: 'zhihu/34561234/handoff.json',
      answersHash: crypto.createHash('sha256').update('x').digest('hex'),
      handoffHash: crypto.createHash('sha256').update('y').digest('hex'),
      capturedAnswerCount: 3,
      reportedAnswerCount: null,
      paginationStatus: 'complete',
    });

    const result = validateResearchCorpusManifest(manifest);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.code === 'SEAM_A_MANIFEST_HASH_MISMATCH'),
      `expected SEAM_A_MANIFEST_HASH_MISMATCH, got: ${JSON.stringify(result.errors)}`,
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('pinned producer SHA is the reviewed T09 commit (identity sanity)', () => {
  assert.match(REVIEWED_T09_SHA, /^[0-9a-f]{40}$/);
  // the archived module must expose the real producer surface
  assert.equal(typeof producer.deriveResearchCorpusManifest, 'function');
  assert.equal(typeof producer.deriveVerifiedGroupRefs, 'function');
  assert.equal(typeof producer.createMultiGroupExecutionState, 'function');
});
