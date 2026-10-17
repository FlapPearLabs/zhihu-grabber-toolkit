// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p4-chunked-analysis.test.mjs
 *
 * Chunked analysis mode (P4): each group's sources are analysed in batches;
 * a claim may cite every answer that states it (multi-source) and there is no
 * 1–3 cap; when a group has several batches the model proposes a merge, the
 * controller checks it is a complete partition and unions the sources itself.
 * The SEAM C artifact keeps its shape, so synthesis / report / scoring work.
 *
 *   CH1  batches respect the source and character budgets; order kept; an
 *        oversized source gets its own batch;
 *   CH2  composed run in chunked mode: batch calls only (never the single
 *        call), a merge only for multi-batch groups, multi-source claims with
 *        per-source authorRefs, full coverage, measurable in metrics/report;
 *   CH3  aggregation attributes each source to its own author;
 *   CH4  untrusted batch / merge output is validated and fails closed;
 *   CH5  the analysis mode is part of the configuration identity; the default
 *        (single) leaves runs unchanged;
 *   CH6  the model runtime sends the map / merge prompts under their own labels;
 *   CH7  the CLI validates --analysis;
 *   CH8  every source is projected before the first batch call, and sources
 *        that carry no extractable text can never back a claim or expert ref;
 *   CH9  a contract-violating batch / merge / synthesis output is discarded and
 *        the same model is asked once more; the rejection is disclosed in the
 *        event log, and a second violation fails closed with its reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { partitionIntoBatches, MAX_BATCH_CLAIMS, extractPerGroupClaimsChunked } from '../lib/per-group-claim-extraction.mjs';
import { aggregateCrossGroupClaims } from '../lib/cross-group-aggregation.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { MAP_CLAIMS_SYSTEM_PROMPT, MERGE_CLAIMS_SYSTEM_PROMPT } from '../lib/research-prompts.mjs';
import { loadReportModel, renderReportMarkdown } from '../lib/report.mjs';
import { computeMetrics, buildScoringSheet, renderScoringSheetMarkdown } from '../evaluation/run-scoring.mjs';
import { PLAN, TOPIC, captureAdapter, embeddingProvider, runner, seam, tmpDir } from './helpers/p1-offline-run.mjs';
import { fakeModelRuntime, messagesOf } from './helpers/fake-model-transport.mjs';

const CLI = fileURLToPath(new URL('../bin/research-p1.mjs', import.meta.url));
const tokensOf = (projection) => [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);

/**
 * Runtime double for chunked mode. Each batch yields one main claim citing
 * EVERY token of the batch and one minority claim citing the first token; the
 * merge folds all main claims of a group into one and keeps minority claims
 * apart. Hooks let a test corrupt one output.
 */
function chunkedRuntime({ batchHook = (out) => out, mergeHook = (out) => out } = {}) {
  const calls = { analyze: 0, analyzeBatch: 0, merge: 0, batchTokens: [] };
  let batchNo = 0;
  const runtime = {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async () => { calls.analyze += 1; throw new Error('single-call analyze must not run in chunked mode'); },
    analyzeBatch: async ({ projection }) => {
      calls.analyzeBatch += 1;
      batchNo += 1;
      const t = tokensOf(projection);
      calls.batchTokens.push(t);
      return batchHook({
        claims: [
          { kind: 'main', statement: `第${batchNo}批共同观点`, tokenRefs: t },
          { kind: 'minority', statement: `第${batchNo}批少数观点`, tokenRefs: [t[0]] },
        ],
        expertEvidenceRichTokens: [],
      }, { tokens: t, batchNo });
    },
    mergeClaims: async ({ claims }) => {
      calls.merge += 1;
      const main = claims.filter((c) => c.kind === 'main');
      const rest = claims.filter((c) => c.kind !== 'main');
      return mergeHook({
        merged: [
          { kind: 'main', statement: '合并后的共同观点', memberIds: main.map((c) => c.id) },
          ...rest.map((c) => ({ kind: c.kind, statement: c.statement, memberIds: [c.id] })),
        ],
      }, { claims });
    },
    synthesize: async ({ claims }) => ({
      families: [{ aspect: '议题', anchorClaimId: claims[0].claimId, members: [{ claimId: claims[0].claimId, stance: 'ASSERTS' }] }],
      unresolvedClaimIds: claims.slice(1).map((c) => c.claimId),
    }),
  };
  return { runtime, calls };
}

async function composeChunked(rt, { workDir = tmpDir('p4-chunked-'), analysisOptions = { maxBatchSources: 2 } } = {}) {
  const out = await composeP1Research({
    topic: TOPIC, workDir, plan: PLAN, runtime: rt, seam: seam(), captureAdapter, runner, embeddingProvider,
    analysisMode: 'chunked', analysisOptions,
  });
  return { out, workDir };
}

const readJson = (workDir, rel) => JSON.parse(fs.readFileSync(path.join(workDir, rel), 'utf8'));

test('CH1: batches respect source and character budgets, keep order, isolate oversized sources', () => {
  const s = (n) => 'x'.repeat(n);
  assert.deepEqual(partitionIntoBatches([s(10), s(10), s(25), s(5)], { maxSources: 2, maxChars: 20 }), [[0, 1], [2], [3]]);
  assert.deepEqual(partitionIntoBatches([s(1), s(1), s(1), s(1), s(1)], { maxSources: 2, maxChars: 1000 }), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(partitionIntoBatches([s(30), s(1)], { maxSources: 10, maxChars: 20 }), [[0], [1]]);
  assert.deepEqual(partitionIntoBatches([], { maxSources: 2, maxChars: 20 }), []);
  const many = Array.from({ length: 97 }, (_, i) => s(1 + (i % 7)));
  const batches = partitionIntoBatches(many, { maxSources: 10, maxChars: 30 });
  assert.deepEqual(batches.flat(), many.map((_, i) => i), 'every source exactly once, in order');
  assert.ok(batches.every((b) => b.length <= 10 && b.reduce((n, i) => n + many[i].length, 0) <= 30));
});

test('CH2: chunked run — batch calls, merge only when needed, multi-source claims, full coverage', async () => {
  const { runtime, calls } = chunkedRuntime();
  const { out, workDir } = await composeChunked(runtime);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(calls.analyze, 0);
  assert.equal(calls.analyzeBatch, 3, 'group 100 (3 sources) → 2 batches, group 200 (2 sources) → 1 batch');
  assert.equal(calls.merge, 1, 'only the multi-batch group is merged');
  assert.ok(calls.batchTokens.every((t) => t.length <= 2));

  const claims = readJson(workDir, 'per-group-claims.json');
  const g100 = claims.groupRepresentations.find((g) => g.groupId === '100');
  const g200 = claims.groupRepresentations.find((g) => g.groupId === '200');
  assert.equal(g100.claims.main.length, 1);
  assert.equal(g100.claims.main[0].statement, '合并后的共同观点');
  assert.equal(g100.claims.main[0].sourceRefs.length, 3, 'the merged claim unions the sources of both batches');
  assert.equal(g100.claims.minority.length, 2, 'distinct minority claims stay apart (no cap, no forced merge)');
  assert.equal(g200.claims.main[0].sourceRefs.length, 2);
  for (const g of claims.groupRepresentations) {
    for (const kind of ['main', 'minority', 'contradictory']) {
      for (const c of g.claims[kind]) {
        assert.equal(c.authorRefs.length, c.sourceRefs.length, 'one author per source');
        assert.equal(c.authorRef, c.authorRefs[0]);
        assert.equal(new Set(c.sourceRefs).size, c.sourceRefs.length);
      }
    }
  }
  assert.equal(new Set(g100.claims.main[0].authorRefs).size, 3, 'three different authors are kept apart');
  assert.deepEqual(g100.accounting, { selected: 3, verified: 3, mapped: 3, analyzed: 3 });
  assert.equal(readJson(workDir, 'coverage-final.json').assertion.is100PercentAnalysis, true);

  const loaded = loadReportModel(workDir);
  const m = computeMetrics(loaded, { events: [] });
  assert.equal(m.citations.cited, 5);
  assert.ok(m.claims.multiSource >= 2);
  const report = renderReportMarkdown(loaded.model);
  assert.match(report, /- 合并后的共同观点 \[\[\d\]\]\([^)]+\)\[\[\d\]\]\([^)]+\)\[\[\d\]\]\([^)]+\)/, 'a multi-source claim links every answer');

  // The human check of a multi-source claim lists its first sources and says how many there are.
  const gold = { id: 't-p4', viewpoints: [{ id: 'v01', statement: '共同观点', stance: 'supports', weight: 1 }] };
  const sheet = buildScoringSheet({ ...loaded, workDir, gold, goldHash: 'h', sampleSize: 99, maxCheckSources: 2 });
  const check = sheet.claimChecks.find((c) => c.statement === '合并后的共同观点');
  assert.equal(check.sourceCount, 3);
  assert.equal(check.sources.length, 2);
  assert.match(renderScoringSheetMarkdown(sheet), /共引用 3 条回答，这里列出 2 条/);
});

test('CH3: aggregation attributes each source to its own author', () => {
  const artifact = {
    groupRepresentations: [{
      groupId: 'g',
      expertEvidenceRichRefs: [],
      claims: {
        main: [{ claimId: 'c1', statement: 's', sourceRefs: ['a', 'b'], authorRef: 'author-x', authorRefs: ['author-x', 'author-y'] }],
        minority: [{ claimId: 'c2', statement: 't', sourceRefs: ['a', 'c'], authorRef: 'author-x' }],
        contradictory: [],
      },
    }],
  };
  const { records } = aggregateCrossGroupClaims(artifact);
  assert.deepEqual(records[0].sourceRefs.map((r) => r.authorRef), ['author-x', 'author-y']);
  assert.deepEqual(records[1].sourceRefs.map((r) => r.authorRef), ['author-x', 'author-x'], 'without authorRefs the claim author applies (legacy)');
});

test('CH4: untrusted batch and merge output is validated and fails closed', async () => {
  const cases = [
    ['token from another batch', { batchHook: (o, { tokens }) => (tokens.includes('1') ? o : { ...o, claims: [{ kind: 'main', statement: 'x', tokenRefs: ['1'] }] }) }, /another batch/],
    ['invented token', { batchHook: (o) => ({ ...o, claims: [{ kind: 'main', statement: 'x', tokenRefs: ['999'] }] }) }, /unknown token/],
    ['empty tokenRefs', { batchHook: (o) => ({ ...o, claims: [{ kind: 'main', statement: 'x', tokenRefs: [] }] }) }, /tokenRefs/],
    ['bad kind', { batchHook: (o) => ({ ...o, claims: [{ kind: 'majority', statement: 'x', tokenRefs: o.claims[0].tokenRefs }] }) }, /kind/],
    ['unexpected key', { batchHook: (o) => ({ ...o, claims: [{ ...o.claims[0], weight: 3 }] }) }, /unexpected key/],
    ['identity key', { batchHook: (o) => ({ ...o, claims: [{ ...o.claims[0], questionId: '100' }] }) }, /identity key/],
    ['too many claims', { batchHook: (o) => ({ ...o, claims: Array.from({ length: MAX_BATCH_CLAIMS + 1 }, (_, i) => ({ kind: 'minority', statement: `s${i}`, tokenRefs: [o.claims[0].tokenRefs[0]] })) }) }, /too many claims/],
    ['merge drops a claim', { mergeHook: (o) => ({ merged: o.merged.slice(1) }) }, /partition/],
    ['merge repeats a claim', { mergeHook: (o) => ({ merged: [...o.merged, o.merged[0]] }) }, /partition/],
    ['merge invents an id', { mergeHook: (o) => ({ merged: [...o.merged, { kind: 'main', statement: 'x', memberIds: ['b9-9'] }] }) }, /unknown claim id/],
    ['merge empty members', { mergeHook: (o) => ({ merged: [...o.merged, { kind: 'main', statement: 'x', memberIds: [] }] }) }, /memberIds/],
  ];
  for (const [name, hooks, expected] of cases) {
    const { runtime, calls } = chunkedRuntime(hooks);
    const { out } = await composeChunked(runtime);
    assert.equal(out.ok, false, name);
    assert.equal(out.code, 'p1_compose_aborted', name);
    assert.match(String(out.details), expected, name);
    if (name === 'invented token') assert.equal(calls.analyzeBatch, 2, 'the first batch is asked twice, then the group fails');
    if (name === 'merge drops a claim') assert.equal(calls.merge, 2);
  }
});

test('CH5: the analysis mode is configuration identity; single (default) is unchanged', async () => {
  const { runtime } = chunkedRuntime();
  const { out, workDir } = await composeChunked(runtime);
  assert.equal(out.ok, true);
  assert.notEqual(readJson(workDir, 'orchestration-state.json').configFingerprint, null);
  // Re-running the same directory in single mode is another configuration → refused, never reused.
  const single = await composeP1Research({
    topic: TOPIC, workDir, plan: PLAN, runtime, seam: seam(), captureAdapter, runner, embeddingProvider,
  });
  assert.equal(single.ok, false);
  assert.match(String(single.details), /different composition config/);
  // An explicit 'single' is the default: no configuration identity is added.
  const plainDir = tmpDir('p4-single-');
  const { runtime: never } = chunkedRuntime();
  const plain = await composeP1Research({
    topic: TOPIC, workDir: plainDir, plan: PLAN, seam: seam(), captureAdapter, runner, embeddingProvider, analysisMode: 'single',
    runtime: { ...never, analyze: async ({ projection }) => ({ main: [{ tokenRef: tokensOf(projection)[0], statement: '观点' }], minority: [], contradictory: [], expertEvidenceRichTokens: [] }) },
  });
  assert.equal(plain.ok, true, JSON.stringify(plain));
  assert.equal(readJson(plainDir, 'orchestration-state.json').configFingerprint, null);
  const bad = await composeP1Research({
    topic: TOPIC, workDir: tmpDir('p4-bad-'), plan: PLAN, runtime, seam: seam(), captureAdapter, runner, embeddingProvider, analysisMode: 'parallel',
  });
  assert.equal(bad.ok, false);
  assert.match(String(bad.details ?? bad.code), /analysis mode/);
});

test('CH6: the model runtime sends the map and merge prompts under their own labels', async () => {
  const usageSink = [];
  const { runtime, calls } = await fakeModelRuntime((body) => {
    const { system } = messagesOf(body);
    return system === MAP_CLAIMS_SYSTEM_PROMPT ? '{"claims":[],"expertEvidenceRichTokens":[]}' : '{"merged":[]}';
  }, { usageSink });
  assert.deepEqual(await runtime.analyzeBatch({ projection: '[BEGIN UNTRUSTED_DATA token=1] x [END UNTRUSTED_DATA token=1]' }), { claims: [], expertEvidenceRichTokens: [] });
  assert.deepEqual(await runtime.mergeClaims({ claims: [{ id: 'b1-1', kind: 'main', statement: 's' }] }), { merged: [] });
  assert.equal(messagesOf(calls[0].body).system, MAP_CLAIMS_SYSTEM_PROMPT);
  assert.equal(messagesOf(calls[1].body).system, MERGE_CLAIMS_SYSTEM_PROMPT);
  assert.deepEqual(JSON.parse(messagesOf(calls[1].body).user), { claims: [{ id: 'b1-1', kind: 'main', statement: 's' }] });
  assert.deepEqual(usageSink.map((u) => u.label), ['analyze_batch', 'merge']);
});

test('CH7: the CLI validates --analysis', () => {
  const cli = (args) => {
    const r = spawnSync(process.execPath, [CLI, '--json', ...args], { encoding: 'utf8', timeout: 30_000 });
    return { status: r.status, message: JSON.parse(r.stdout).error.message };
  };
  for (const bad of [['--analysis', 'parallel'], ['--analysis']]) {
    assert.deepEqual(cli([TOPIC, ...bad]), { status: 2, message: '--analysis requires single or chunked' }, bad.join(' '));
  }
  // Valid modes are accepted by the parser (the next check, a missing topic, is what fails).
  for (const mode of ['single', 'chunked']) {
    assert.deepEqual(cli(['--analysis', mode]), { status: 2, message: 'missing research topic' }, mode);
  }
});

test('CH8: projection precedes every batch call; text-less sources cannot back claims', async () => {
  const corpus = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/p1-seams/seam-b/selected-research-corpus.minimal.json', import.meta.url)), 'utf8'));
  const groupId = corpus.corpus.groups[0].groupId;
  const contents = {
    '23456789-a-101': '回答 A：我认为这个方法在多数场景下有效。',
    '23456789-a-102': '<code>INLINE_ONLY_CANARY &lt;</code>',
    '23456789-a-103': '回答 C：我持相反意见。',
  };
  const base = {
    corpus, groupId,
    canonicalGroupIdentityResolver: (id) => ({ questionId: id, providerId: 'official-search', capability: 'searchQuestions' }),
    analysisOptions: { maxBatchSources: 2 },
  };
  const runtimeCiting = (pick) => {
    const calls = { batch: 0 };
    return {
      calls,
      runtime: {
        analyzeBatch: async ({ projection }) => { calls.batch += 1; return pick(tokensOf(projection)); },
        mergeClaims: async ({ claims }) => ({ merged: claims.map((c) => ({ kind: c.kind, statement: c.statement, memberIds: [c.id] })) }),
      },
    };
  };
  // A loader failure on the LAST source happens before any batch call.
  const failing = runtimeCiting(() => ({ claims: [] }));
  await assert.rejects(() => extractPerGroupClaimsChunked({
    ...base, runtime: failing.runtime,
    sourceContentLoader: (_ref, id) => { if (id === '23456789-a-103') throw new Error('unreadable'); return contents[id]; },
  }), (e) => e.code === 'SEAM_C_SOURCE_FAILURE');
  assert.equal(failing.calls.batch, 0);
  // Token 2 is inline-code-only: citing it as a claim source or expert ref fails closed.
  const loader = (_ref, id) => contents[id];
  for (const pick of [
    (t) => ({ claims: t.includes('2') ? [{ kind: 'main', statement: '观点', tokenRefs: ['1', '2'] }] : [] }),
    (t) => ({ claims: [], expertEvidenceRichTokens: t.includes('2') ? ['2'] : [] }),
  ]) {
    await assert.rejects(() => extractPerGroupClaimsChunked({ ...base, runtime: runtimeCiting(pick).runtime, sourceContentLoader: loader }),
      (e) => e.code === 'SEAM_C_MODEL_OUTPUT_INVALID' && /inline-code-only/.test(e.message));
  }
  // The same group without that citation completes with full accounting.
  const ok = await extractPerGroupClaimsChunked({
    ...base, sourceContentLoader: loader,
    runtime: runtimeCiting((t) => {
      const citable = t.filter((x) => x !== '2');
      return { claims: [{ kind: 'main', statement: '观点', tokenRefs: [...citable, ...citable] }] };
    }).runtime,
  });
  assert.deepEqual(ok.claims.main.map((c) => c.sourceRefs), [['23456789-a-101'], ['23456789-a-103']], 'a repeated token cites its source once');
  assert.deepEqual(ok.claims.main.map((c) => c.authorRefs), [[null], [null]], 'no resolver → authors disclosed as null');
  assert.deepEqual(ok.analyzedSourceIds, ['23456789-a-101', '23456789-a-102', '23456789-a-103']);
});

test('CH9: one re-ask after a contract-violating output; disclosed; a second violation fails closed', async () => {
  const events = (workDir) => fs.readFileSync(path.join(workDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((e) => e.event === 'model_output_rejected');
  // Batch 1 and the merge each violate the contract once, the synthesis once.
  let merges = 0;
  let syntheses = 0;
  const { runtime, calls } = chunkedRuntime({
    batchHook: (o, { batchNo }) => (batchNo === 1 ? { ...o, claims: [{ ...o.claims[0], kind: 'majority' }] } : o),
    mergeHook: (o) => { merges += 1; return merges === 1 ? { merged: o.merged.slice(1) } : o; },
  });
  const synthesize = runtime.synthesize;
  runtime.synthesize = async (args) => { syntheses += 1; return syntheses === 1 ? { families: [], unresolvedClaimIds: [] } : synthesize(args); };
  const { out, workDir } = await composeChunked(runtime);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(calls.analyzeBatch, 4);
  assert.equal(calls.merge, 2);
  assert.equal(syntheses, 2);
  const rejected = events(workDir);
  assert.deepEqual(rejected.map((e) => [e.stage, e.attempt]), [['analyze_batch', 1], ['merge', 1], ['synthesis', 1]]);
  assert.equal(rejected[0].groupId, '100');
  assert.match(rejected[0].reason, /kind/);
  assert.match(rejected[1].reason, /partition/);
  assert.equal(rejected[2].reason, '5 claim(s) missing from the partition');
  const fileEvents = fs.readFileSync(path.join(workDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(computeMetrics(loadReportModel(workDir), { events: fileEvents }).rejectedModelOutputs, 3, 'metrics count the re-asks');

  // A synthesis that violates the contract twice fails closed and says why.
  const twice = chunkedRuntime();
  let n = 0;
  twice.runtime.synthesize = async ({ claims }) => { n += 1; return { families: [], unresolvedClaimIds: claims.slice(1).map((c) => c.claimId) }; };
  const failed = await composeChunked(twice.runtime);
  assert.equal(failed.out.ok, false);
  assert.equal(n, 2);
  assert.match(String(failed.out.details), /T14_RUNTIME_OUTPUT_INVALID \(1 claim\(s\) missing from the partition\)/);
  assert.deepEqual(events(failed.workDir).map((e) => [e.stage, e.attempt]), [['synthesis', 1], ['synthesis', 2]]);
});
