// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p3-retrieval-ledger.test.mjs
 *
 * evaluation/retrieval-ledger.mjs — #142 narrowed to an offline script: a
 * candidate ledger and failure attribution built only from existing run
 * artifacts (so run semantics cannot change).
 *
 *   L1  a real offline run: every pool candidate once, fused rank by RRF score,
 *       per-candidate channels, terminal state, channel accounting; written to
 *       evaluation/retrieval-ledger.json; byte-stable across builds;
 *   L2  terminal states are mechanical: cited / analyzed-not-cited / capture
 *       failed / selected-not-analyzed / not selected / not eligible / UNKNOWN;
 *   L3  expected-source attribution: an item never returned is a recall miss
 *       (never a ranking miss); an item returned then dropped is never a recall
 *       miss; insufficient evidence stays UNKNOWN;
 *   L4  channel accounting: items returned but not fused are counted, unknown
 *       item counts stay unknown;
 *   L5  the CLI works on an incomplete run, refuses a run without a pool, and
 *       has stable exit codes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LEDGER_FILENAME, LedgerError, buildRetrievalLedger, writeRetrievalLedger,
} from '../evaluation/retrieval-ledger.mjs';
import { EVAL_DIR } from '../evaluation/run-scoring.mjs';
import { completedRun, tmpDir } from './helpers/p1-offline-run.mjs';

const CLI = fileURLToPath(new URL('../evaluation/retrieval-ledger.mjs', import.meta.url));
const ch = (query, providerId) => ({ query, providerId, capability: 'search' });

/** Six candidates covering every terminal state, plus channel accounting. */
function artifacts() {
  const rank = (query, providerId, r) => ({ channel: ch(query, providerId), rank: r, rankOrigin: 'fixture', route: 'fixture' });
  const cand = (qid, rrf, ranks, title = `问题${qid}`) => ({ identity: { kind: 'candidate', questionId: qid }, rrfScore: rrf, ranks, source_url: null, facts: { title } });
  return {
    pool: {
      planHash: 'p'.repeat(64),
      channels: [
        { channel: ch('q1', 'official'), ok: true, itemCount: 5 },
        { channel: ch('q1', 'global'), ok: true, itemCount: 2 },
        { channel: ch('q2', 'official'), ok: false, itemCount: null },
      ],
      candidates: [
        cand('6', 0.08, [rank('q1', 'official', 5)]),
        cand('1', 0.09, [rank('q1', 'official', 1), rank('q1', 'global', 1)]),
        cand('2', 0.08, [rank('q1', 'official', 2)]),
        cand('3', 0.07, [rank('q1', 'official', 3)]),
        cand('4', 0.05, [rank('q1', 'global', 2)]),
        cand('5', 0.04, [rank('q1', 'official', 4)]),
      ],
      rejected: [],
    },
    decision: {
      candidates: [
        { questionId: '1', score: 0.09, eligible: true, selected: true },
        { questionId: '2', score: 0.08, eligible: true, selected: true },
        { questionId: '3', score: 0.07, eligible: true, selected: true },
        { questionId: '4', score: 0.05, eligible: true, selected: false },
        { questionId: '5', score: 0.04, eligible: false, selected: false },
      ],
    },
    groupState: {
      groups: {
        1: { groupId: '1', questionId: '1', stage: 'verified', failed: false, capturedAnswerCount: 10 },
        2: { groupId: '2', questionId: '2', stage: 'verified', failed: false, capturedAnswerCount: 4 },
        3: { groupId: '3', questionId: '3', stage: 'failed', failed: true, failure: { code: 'PROVIDER_REPORTED_FAILURE', class: 'provider' } },
      },
    },
    claimsArtifact: {
      groupRepresentations: [
        { groupId: '1', accounting: { analyzed: 10 }, claims: { main: [{ claimId: 'c1', sourceRefs: ['asrc-a', 'asrc-b'] }], minority: [], contradictory: [] } },
        { groupId: '2', accounting: { analyzed: 4 }, claims: { main: [], minority: [], contradictory: [] } },
      ],
    },
    coverageState: { retrieval: { retrievalRounds: 2, stopReason: 'zero_new_candidates' } },
  };
}

test('L1: a real offline run yields a complete, stable ledger', async () => {
  const workDir = await completedRun('p3-ledger-');
  const { ledger, ledgerPath } = writeRetrievalLedger(workDir);
  assert.equal(ledgerPath, path.join(workDir, EVAL_DIR, LEDGER_FILENAME));
  const bytes = fs.readFileSync(ledgerPath, 'utf8');
  assert.deepEqual(JSON.parse(bytes), ledger);

  const pool = JSON.parse(fs.readFileSync(path.join(workDir, 'retrieval-rounds', 'accumulated-pool.json'), 'utf8'));
  assert.equal(ledger.type, 'p1-retrieval-ledger');
  assert.equal(ledger.candidates.length, pool.candidates.length);
  assert.deepEqual(ledger.candidates.map((c) => [c.questionId, c.fusedRank, c.terminal]), [['100', 1, 'CITED'], ['200', 2, 'CITED']]);
  assert.equal(ledger.candidates[0].channels.length, pool.candidates[0].ranks.length);
  assert.deepEqual(ledger.candidates[0].analysis, { analyzed: 3, cited: 3 });
  assert.equal(ledger.retrieval.stopReason, 'zero_new_candidates');
  assert.ok(ledger.channels.every((c) => c.returned === 2 && c.unique === 0 && c.selected === 2));
  assert.deepEqual(ledger.summary.byTerminal, { CITED: 2 });

  writeRetrievalLedger(workDir);
  assert.equal(fs.readFileSync(ledgerPath, 'utf8'), bytes, 'deterministic: no clocks, stable order');
});

test('L2: terminal states are mechanical and never guessed', () => {
  const l = buildRetrievalLedger(artifacts());
  const byId = Object.fromEntries(l.candidates.map((c) => [c.questionId, c]));
  assert.equal(byId['1'].terminal, 'CITED');
  assert.equal(byId['2'].terminal, 'ANALYZED_NOT_CITED');
  assert.equal(byId['3'].terminal, 'CAPTURE_FAILED');
  assert.equal(byId['3'].capture.failureCode, 'PROVIDER_REPORTED_FAILURE');
  assert.equal(byId['4'].terminal, 'NOT_SELECTED');
  assert.equal(byId['5'].terminal, 'NOT_ELIGIBLE');
  assert.equal(byId['6'].terminal, 'UNKNOWN', 'in the pool but absent from the decision');
  // RRF order with a stable tie-break on question ID (2 and 6 share 0.08).
  assert.deepEqual(l.candidates.map((c) => c.questionId), ['1', '2', '6', '3', '4', '5']);
  assert.deepEqual(l.candidates.map((c) => c.fusedRank), [1, 2, 3, 4, 5, 6]);

  const noDecision = buildRetrievalLedger({ ...artifacts(), decision: null, groupState: null, claimsArtifact: null });
  assert.ok(noDecision.candidates.every((c) => c.terminal === 'UNKNOWN'));
  // A pending clarification is not a rejection: nothing has been selected or refused yet.
  const pending = artifacts();
  pending.decision = { verdict: 'ambiguous', clarification: { required: true }, candidates: pending.decision.candidates.map((c) => ({ ...c, selected: false })) };
  const pl = buildRetrievalLedger(pending, { expectedSources: ['4'] });
  assert.deepEqual([...new Set(pl.candidates.filter((c) => c.questionId !== '5' && c.questionId !== '6').map((c) => c.terminal))], ['SELECTION_PENDING']);
  assert.equal(pl.candidates.find((c) => c.questionId === '5').terminal, 'NOT_ELIGIBLE', 'ineligibility is already decided');
  assert.equal(pl.expected[0].attribution, 'UNKNOWN');
  assert.equal(pl.expected[0].evidence.terminal, 'SELECTION_PENDING');

  const notAnalyzed = buildRetrievalLedger({ ...artifacts(), claimsArtifact: null });
  assert.equal(notAnalyzed.candidates.find((c) => c.questionId === '1').terminal, 'SELECTED_NOT_ANALYZED');
  assert.equal(notAnalyzed.candidates.find((c) => c.questionId === '3').terminal, 'CAPTURE_FAILED');
});

test('L3: expected-source attribution keeps recall misses and later losses apart', () => {
  const l = buildRetrievalLedger(artifacts(), { expectedSources: ['999', '4', '5', '3', '2', '1', '6'] });
  const by = Object.fromEntries(l.expected.map((e) => [e.questionId, e]));
  assert.equal(by['999'].attribution, 'PROVIDER_RECALL_MISS', 'never returned by any executed channel');
  assert.deepEqual(by['999'].evidence, { channelsOk: 2, channelsFailed: 1 }, 'failed channels are disclosed, not counted as observed');
  assert.equal(by['4'].attribution, 'SELECTION_MISS', 'returned, eligible, not selected — not a recall miss');
  assert.deepEqual(by['4'].evidence, { fusedRank: 5, score: 0.05, lastSelectedRank: 4 });
  assert.equal(by['5'].attribution, 'NOT_ELIGIBLE');
  assert.equal(by['3'].attribution, 'CAPTURE_FAILURE');
  assert.equal(by['2'].attribution, 'ANALYZED_NOT_CITED');
  assert.equal(by['1'].attribution, 'FOUND');
  assert.equal(by['6'].attribution, 'UNKNOWN', 'insufficient evidence is not upgraded to a narrower class');
  assert.deepEqual(l.expected.map((e) => e.questionId), ['999', '4', '5', '3', '2', '1', '6'], 'expected order is preserved');

  // A recall miss requires that retrieval actually ran: no executed channel → UNKNOWN.
  const empty = buildRetrievalLedger({ ...artifacts(), pool: { ...artifacts().pool, channels: [], candidates: [] } }, { expectedSources: ['999'] });
  assert.equal(empty.expected[0].attribution, 'UNKNOWN');
});

test('L4: channel accounting counts unfused items and keeps unknown counts unknown', () => {
  const l = buildRetrievalLedger(artifacts());
  const by = Object.fromEntries(l.channels.map((c) => [`${c.query}|${c.providerId}`, c]));
  assert.deepEqual(by['q1|official'], { query: 'q1', providerId: 'official', ok: true, itemCount: 5, returned: 5, unique: 4, selected: 3, droppedBeforeFusion: 0 });
  assert.deepEqual(by['q1|global'], { query: 'q1', providerId: 'global', ok: true, itemCount: 2, returned: 2, unique: 1, selected: 1, droppedBeforeFusion: 0 });
  assert.equal(by['q2|official'].droppedBeforeFusion, null);
  const dropped = artifacts();
  dropped.pool.channels[1].itemCount = 6;
  assert.equal(buildRetrievalLedger(dropped).channels.find((c) => c.providerId === 'global').droppedBeforeFusion, 4);
  assert.deepEqual(l.summary, {
    candidates: 6, selected: 3, captured: 2, captureFailed: 1, analyzed: 2, cited: 1,
    byTerminal: { CITED: 1, ANALYZED_NOT_CITED: 1, CAPTURE_FAILED: 1, NOT_SELECTED: 1, NOT_ELIGIBLE: 1, UNKNOWN: 1 },
  });
});

test('L5: the CLI handles incomplete runs, refuses a run without a pool, and has stable exit codes', () => {
  const workDir = tmpDir('p3-ledger-cli-');
  const a = artifacts();
  fs.mkdirSync(path.join(workDir, 'retrieval-rounds'), { recursive: true });
  fs.writeFileSync(path.join(workDir, 'retrieval-rounds', 'accumulated-pool.json'), JSON.stringify(a.pool));
  fs.writeFileSync(path.join(workDir, 'source-group-selection-decision.json'), JSON.stringify(a.decision));
  fs.writeFileSync(path.join(workDir, 'multi-group-state.json'), JSON.stringify(a.groupState));
  const goldDir = tmpDir('p3-ledger-gold-');
  const gold = path.join(goldDir, 'gold.json');
  fs.writeFileSync(gold, JSON.stringify({ schemaVersion: 1, type: 'p1-goldset', id: 'g', topic: 't', status: 'draft', viewpoints: [{ id: 'v01', statement: 's', stance: 'supports', weight: 1 }], expectedSources: ['999', '3'] }));

  const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60_000 });
  const human = run([workDir, '--gold', gold]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /候选问题：6/);
  assert.match(human.stdout, /999：PROVIDER_RECALL_MISS/);
  const json = run([workDir, '--json']);
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).ledger, path.join(EVAL_DIR, LEDGER_FILENAME));

  const empty = tmpDir('p3-ledger-empty-');
  const missing = run([empty, '--json']);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).error.code, 'LEDGER_INPUT_MISSING');
  assert.equal(run([]).status, 2);
  assert.ok(LedgerError);
});
