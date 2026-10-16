// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-max-group-answers.test.mjs
 *
 * --max-group-answers N (default off): a source group whose provider-reported
 * answer count exceeds N is not eligible for selection, so it is never
 * captured or analyzed; the exclusion is recorded in the selection decision,
 * disclosed in report.md and attributed in the retrieval ledger. The limit is
 * part of the run's configuration identity, so checkpoints made under another
 * limit (or none) are never reused.
 *
 *   MG1  over-limit groups are excluded; unknown and under-limit counts stay eligible;
 *   MG2  without a limit the decision is byte-for-byte unchanged;
 *   MG3  a malformed limit fails closed;
 *   MG4  every eligible group over the limit → no valid group (fail closed), disclosed;
 *   MG5  composed run: the excluded group is never captured; decision, report
 *        and configuration identity record the limit;
 *   MG6  a COMPLETE run under one limit is refused (never reused) under another;
 *        an explicit restart runs fresh;
 *   MG7  the ledger marks excluded groups NOT_ELIGIBLE with the reason;
 *   MG8  the CLI validates --max-group-answers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { planHash, validatePlanInput } from '../lib/plan-contract.mjs';
import {
  SELECTION_FAILURE_CONFIG_INVALID, SELECTION_FAILURE_NO_VALID_GROUP, selectSourceGroups,
} from '../lib/source-group-selection.mjs';
import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { REPORT_FILENAME, writeReport } from '../lib/report.mjs';
import { buildRetrievalLedger } from '../evaluation/retrieval-ledger.mjs';
import { PLAN, TOPIC, captureAdapter, embeddingProvider, runner, tmpDir } from './helpers/p1-offline-run.mjs';

const CLI = fileURLToPath(new URL('../bin/research-p1.mjs', import.meta.url));

// ---------------------------------------------------------------------------
// Selector-level fixtures (canonical T06 pool shapes)

const plan = PLAN; // no source-group intents → every eligible group is selected
const ph = planHash(validatePlanInput(plan).plan);

function cand(qid, rrfScore, answerCount) {
  return {
    identity: { kind: 'candidate', questionId: qid },
    rrfScore,
    ranks: [{ channel: { query: 'q', providerId: 'p', capability: 'search' }, rank: 1, rankOrigin: 'search', route: 'web' }],
    source_url: { url: `https://www.zhihu.com/question/${qid}`, securityClass: 'external_unverified' },
    facts: answerCount === undefined ? { title: `q${qid}` } : { title: `q${qid}`, answerCount },
  };
}
const pool = (cands) => ({ schemaVersion: 1, type: 'retrieval-pool', planHash: ph, candidates: cands });

test('MG1: over-limit groups are excluded; unknown and under-limit counts stay eligible', () => {
  const d = selectSourceGroups(pool([cand('100', 0.1, 50), cand('200', 0.09, 900), cand('300', 0.08), cand('400', 0.07, 600)]), plan, { maxGroupAnswers: 600 });
  assert.equal(d.verdict, 'auto');
  assert.deepEqual(d.selectedGroups.map((g) => g.questionId), ['100', '300', '400']);
  assert.deepEqual(d.candidates.map((c) => c.questionId), ['100', '300', '400']);
  assert.equal(d.maxGroupAnswers, 600);
  assert.deepEqual(d.excludedByAnswerLimit, [{ questionId: '200', answerCount: 900 }]);
  assert.ok(d.selectedGroups.every((g) => !('answerCount' in g)), 'selected group records keep their shape');
});

test('MG2: without a limit the decision is unchanged', () => {
  const cands = [cand('100', 0.1, 50), cand('200', 0.09, 900), cand('300', 0.08)];
  const plain = selectSourceGroups(pool(cands), plan);
  assert.ok(!('maxGroupAnswers' in plain) && !('excludedByAnswerLimit' in plain));
  assert.deepEqual(selectSourceGroups(pool(cands), plan, { maxGroupAnswers: null }), plain);
  assert.deepEqual(selectSourceGroups(pool(cands), plan, { maxGroupAnswers: undefined }), plain);
  assert.deepEqual(plain.selectedGroups.map((g) => g.questionId), ['100', '200', '300']);
});

test('MG3: a malformed limit fails closed', () => {
  for (const bad of [0, -5, 1.5, '600', Number.NaN, Infinity]) {
    const d = selectSourceGroups(pool([cand('100', 0.1, 50)]), plan, { maxGroupAnswers: bad });
    assert.equal(d.verdict, 'none', String(bad));
    assert.equal(d.reason, SELECTION_FAILURE_CONFIG_INVALID, String(bad));
    assert.equal(d.selectedGroups.length, 0);
  }
});

test('MG4: when every eligible group is over the limit, selection fails closed and discloses why', () => {
  const d = selectSourceGroups(pool([cand('100', 0.1, 5000), cand('200', 0.09, 900)]), plan, { maxGroupAnswers: 600 });
  assert.equal(d.verdict, 'none');
  assert.equal(d.reason, SELECTION_FAILURE_NO_VALID_GROUP);
  assert.deepEqual(d.excludedByAnswerLimit.map((e) => e.questionId), ['100', '200']);
});

// ---------------------------------------------------------------------------
// Composer-level

/** Search results that report answer counts (as the open-platform search does). */
function seamWithCounts(counts) {
  const retrieve = (providerId) => () => ({
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: '2026-10-16T00:00:00.000Z',
    items: [['100', 1], ['200', 2]].map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: { title: `问题${questionId}`, answerCount: counts[questionId] },
    })),
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
  });
  return createProviderSeam({
    adapters: ['fixture-official', 'fixture-global'].map((providerId) => ({
      providerId, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET, retrieve: retrieve(providerId),
    })),
  });
}

/** A runtime double that works for any number of groups. */
function anyGroupRuntime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async ({ projection }) => {
      const t = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      return { main: [{ tokenRef: t[0], statement: `观点${t.length}` }], minority: [], contradictory: [], expertEvidenceRichTokens: [] };
    },
    synthesize: async ({ claims }) => ({
      families: [{ aspect: '议题', anchorClaimId: claims[0].claimId, members: claims.map((c) => ({ claimId: c.claimId, stance: 'ASSERTS' })) }],
      unresolvedClaimIds: [],
    }),
  };
}

function countingCapture() {
  const calls = [];
  return { calls, adapter: { ...captureAdapter, retrieve(input) { calls.push(String(input.questionId)); return captureAdapter.retrieve(input); } } };
}

async function compose(workDir, { maxGroupAnswers, capture }) {
  return composeP1Research({
    topic: TOPIC, workDir, plan: PLAN, runtime: anyGroupRuntime(), seam: seamWithCounts({ 100: 3, 200: 900 }),
    captureAdapter: capture.adapter, runner, embeddingProvider,
    ...(maxGroupAnswers === undefined ? {} : { maxGroupAnswers }),
  });
}

const readJson = (workDir, rel) => JSON.parse(fs.readFileSync(path.join(workDir, rel), 'utf8'));

test('MG5: the excluded group is never captured; decision, report and identity record the limit', async () => {
  const workDir = tmpDir('p1-maxans-');
  const capture = countingCapture();
  const out = await compose(workDir, { maxGroupAnswers: 600, capture });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(capture.calls, ['100'], 'the 900-answer group is never captured');
  const decision = readJson(workDir, 'source-group-selection-decision.json');
  assert.deepEqual(decision.excludedByAnswerLimit, [{ questionId: '200', answerCount: 900 }]);
  assert.equal(decision.maxGroupAnswers, 600);
  assert.notEqual(readJson(workDir, 'orchestration-state.json').configFingerprint, null);

  writeReport(workDir);
  const report = fs.readFileSync(path.join(workDir, REPORT_FILENAME), 'utf8');
  assert.match(report, /回答数超过 600 条/);
  assert.match(report, /\[问题 200\]\(https:\/\/www\.zhihu\.com\/question\/200\)（900 条回答）/);

  // Without the flag nothing changes: both groups, and no configuration identity.
  const plainDir = tmpDir('p1-maxans-plain-');
  const plainCapture = countingCapture();
  const plain = await compose(plainDir, { capture: plainCapture });
  assert.equal(plain.ok, true, JSON.stringify(plain));
  assert.deepEqual(plainCapture.calls.sort(), ['100', '200']);
  assert.equal(readJson(plainDir, 'orchestration-state.json').configFingerprint, null);
  assert.ok(!('excludedByAnswerLimit' in readJson(plainDir, 'source-group-selection-decision.json')));
  writeReport(plainDir);
  assert.doesNotMatch(fs.readFileSync(path.join(plainDir, REPORT_FILENAME), 'utf8'), /回答数超过/);
});

test('MG6: a COMPLETE run under one limit is not reused under another', async () => {
  const workDir = tmpDir('p1-maxans-reuse-');
  const first = countingCapture();
  assert.equal((await compose(workDir, { maxGroupAnswers: 600, capture: first })).ok, true);
  const same = countingCapture();
  assert.equal((await compose(workDir, { maxGroupAnswers: 600, capture: same })).ok, true);
  assert.deepEqual(same.calls, [], 'same limit → COMPLETE run reused, nothing recaptured');
  // Another limit is another configuration: the checkpoint is refused (fail
  // closed), never silently reused, and nothing is captured.
  const other = countingCapture();
  const refused = await compose(workDir, { maxGroupAnswers: 1000, capture: other });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'state_invalid');
  assert.match(String(refused.details), /different composition config/);
  assert.deepEqual(other.calls, []);
  // An explicit restart under the new limit runs fresh and captures both groups.
  const fresh = countingCapture();
  const restarted = await composeP1Research({
    topic: TOPIC, workDir, plan: PLAN, runtime: anyGroupRuntime(), seam: seamWithCounts({ 100: 3, 200: 900 }),
    captureAdapter: fresh.adapter, runner, embeddingProvider, maxGroupAnswers: 1000, restart: true,
  });
  assert.equal(restarted.ok, true, JSON.stringify(restarted));
  assert.deepEqual(fresh.calls.sort(), ['100', '200']);
});

test('MG7: the ledger marks excluded groups NOT_ELIGIBLE with the reason', () => {
  const decision = selectSourceGroups(pool([cand('100', 0.1, 50), cand('200', 0.09, 900)]), plan, { maxGroupAnswers: 600 });
  const l = buildRetrievalLedger({ pool: pool([cand('100', 0.1, 50), cand('200', 0.09, 900)]), decision }, { expectedSources: ['200'] });
  const c = l.candidates.find((x) => x.questionId === '200');
  assert.equal(c.terminal, 'NOT_ELIGIBLE');
  assert.equal(c.selection.ineligibleReason, 'answer_count_over_limit');
  assert.equal(c.selection.answerCount, 900);
  assert.equal(l.expected[0].attribution, 'NOT_ELIGIBLE');
});

test('MG8: the CLI validates --max-group-answers', () => {
  for (const bad of [['--max-group-answers', '0'], ['--max-group-answers', 'abc'], ['--max-group-answers', '1.5'], ['--max-group-answers']]) {
    const r = spawnSync(process.execPath, [CLI, TOPIC, '--json', ...bad], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 2, `${bad.join(' ')}: ${r.stdout}${r.stderr}`);
  }
});
