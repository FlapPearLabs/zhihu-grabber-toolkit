// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-legacy-checkpoint-resume.test.mjs
 *
 * Compatibility proof for the run-identity repair (Issue #145): a COMPLETE
 * default-identity checkpoint written by the PREVIOUS version of the composer
 * must still resume. It is not enough to recompute the old hash — this suite
 * resumes the real checkpoint.
 *
 * The fixture `fixtures/p1-legacy-checkpoint/` is the byte output of commit
 * bfdd489's `composeP1Research` (the candidate before this repair), generated
 * offline by `fixtures/p1-legacy-checkpoint/regenerate.mjs`; see the README
 * next to it for the exact recipe. It carries every artifact the reuse-closure
 * validator walks (plan, selection decision, retrieval rounds, canonical
 * answers + handoffs, claims, synthesis, coverage, result).
 *
 *   L1  the legacy checkpoint still resumes: `{ ok: true, reused: true }` with
 *       the SAME runId, and NO model call (the runtime throws if touched);
 *   L2  the resume writes nothing — every file is byte-identical afterwards;
 *   L3  the legacy checkpoint is never served to a wider identity: another
 *       model, or the same model on a custom endpoint, fails closed with
 *       `run_identity_conflict` and leaves the checkpoint untouched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { P1_PIPELINE_IDENTITY } from '../lib/coverage-final-integration.mjs';
import { readState, runIdentityHash, STAGE_COMPLETE } from '../lib/state.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/p1-legacy-checkpoint/', import.meta.url));
const LEGACY_RUN_ID = 'bb8a745ce60523814bd493b35bcd4593942e3a21678cf2f318d8e19c14ca3085';
const LEGACY_TOPIC = 'AI 编程工具会取代程序员吗';
const HISTORICAL_DEFAULT_RUNTIME = 'deepseek-api-tool-less';
const NOW = () => '2026-10-15T00:00:00.000Z';

/** Same plan the fixture was generated with (the resume path loads the stored one). */
const PLAN = {
  schemaVersion: 1,
  queryVariants: ['AI 编程工具 取代 程序员', 'AI coding 岗位影响'],
  aspects: ['岗位影响'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

const TEXTS = {
  100: ['回答一：总体上有效，多数场景成立。', '回答二：小样本下有反例。'],
  200: ['回答三：另一个问题下的主流经验。', '回答四：补充：成本是主要顾虑。'],
};

function tmpCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-legacy-checkpoint-'));
  fs.cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

function searchResult(providerId, ranking) {
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: NOW(),
    items: ranking.map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
  };
}

function rankingSeam() {
  const ranking = [['100', 1], ['200', 2]];
  const adapter = (providerId) => ({
    providerId,
    capability: CAPABILITY_SEARCH,
    authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve: () => searchResult(providerId, ranking),
  });
  return createProviderSeam({ adapters: [adapter('fixture-official'), adapter('fixture-global')] });
}

const captureAdapter = {
  providerId: 'zhihu-session-capture',
  capability: 'capture',
  authClass: 'session',
  retrieve({ questionId, outDir }) {
    const dir = path.join(outDir, String(questionId));
    fs.mkdirSync(dir, { recursive: true });
    const doc = {
      questionId: String(questionId),
      questionTitle: `问题 ${questionId} 的标题`,
      answers: TEXTS[String(questionId)].map((content, i) => ({
        id: `${questionId}-a-${i + 1}`,
        content,
        excerpt: content,
        author: `作者${questionId}-${i}`,
        voteupCount: 10 - i,
      })),
    };
    fs.writeFileSync(path.join(dir, 'answers.json'), `${JSON.stringify(doc, null, 2)}\n`);
    return {
      ok: true,
      provider_id: 'zhihu-session-capture',
      capability: 'capture',
      auth_class: 'session',
      retrieved_at: NOW(),
      items: [{
        identity: { kind: 'group', questionId: String(questionId) },
        provenance: { route: 'fixture-capture', rank: 1, rankOrigin: 'fixture' },
        facts: { capturedAnswerCount: doc.answers.length },
      }],
      completeness: { status: 'complete', evidence: { basis: 'fixture_complete_pagination' } },
    };
  },
};

function groupRunner() {
  return (name, args) => {
    if (name === 'zhihu-verify') {
      const doc = JSON.parse(fs.readFileSync(path.join(args[0], 'answers.json'), 'utf8'));
      return {
        status: 0,
        stdout: JSON.stringify({ valid: true, questionId: String(doc.questionId), capturedAnswerCount: doc.answers.length, reportedAnswerCount: doc.answers.length }),
      };
    }
    if (name === 'zhihu-handoff') {
      const dir = args[0];
      const doc = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json'), 'utf8'));
      fs.writeFileSync(path.join(dir, 'handoff.json'), `${JSON.stringify({ questionId: String(doc.questionId), task: 'digest', sourceType: 'session-capture', verified: true, generatedBy: 'fixture' }, null, 2)}\n`);
      return { status: 0, stdout: '' };
    }
    if (name === 'corpus-verify-handoff') return { status: 0, stdout: JSON.stringify({ valid: true }) };
    throw new Error(`unexpected runner command: ${name}`);
  };
}

const embeddingProvider = () => ({
  preflight: async () => ({ ok: true }),
  embed: async (texts) => ({ vectors: texts.map(() => mockVector768(7)) }),
});

/** A runtime that FAILS the test if the model is touched at all. */
function untouchedRuntime(identity = { runtimeId: T14_SYNTHESIS_RUNTIME_ID, model: T14_SYNTHESIS_MODEL }) {
  const refuse = () => { throw new Error('a checkpoint reuse must not call the model'); };
  return { ...identity, analyze: refuse, synthesize: refuse, completeText: refuse, completeJson: refuse };
}

function compose(workDir, runtime) {
  return composeP1Research({
    topic: LEGACY_TOPIC,
    workDir,
    plan: PLAN,
    runtime,
    seam: rankingSeam(),
    captureAdapter,
    runner: groupRunner(),
    embeddingProvider: embeddingProvider(),
  });
}

/** relpath → sha256 of every file in the run directory. */
function treeDigest(dir) {
  const out = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.set(path.relative(dir, abs), crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
      else out.set(path.relative(dir, abs), `non-file:${entry.name}`);
    }
  };
  walk(dir);
  return out;
}

test('L1: a checkpoint written by the previous version still resumes, without touching the model', async () => {
  const workDir = tmpCopy();
  const legacy = readState(workDir);
  assert.equal(legacy.stage, STAGE_COMPLETE, 'the fixture must be a COMPLETE checkpoint');
  assert.equal(legacy.runId, LEGACY_RUN_ID);
  assert.equal(legacy.runtime, HISTORICAL_DEFAULT_RUNTIME, 'the artifact under test must be a legacy default checkpoint');
  assert.equal(
    legacy.runId,
    runIdentityHash({ topic: LEGACY_TOPIC, mode: P1_PIPELINE_IDENTITY, percent: null, runtime: HISTORICAL_DEFAULT_RUNTIME }),
    'the legacy checkpoint carries the historical default identity',
  );

  const out = await compose(workDir, untouchedRuntime());
  assert.equal(out.ok, true, `the legacy checkpoint must resume: ${JSON.stringify(out)}`);
  assert.equal(out.reused, true);
  assert.equal(out.runId, LEGACY_RUN_ID, 'resume must reproduce the recorded run identity');
  assert.equal(readState(workDir).stage, STAGE_COMPLETE);
});

test('L2: resuming the legacy checkpoint writes nothing', async () => {
  const workDir = tmpCopy();
  const before = treeDigest(workDir);
  const out = await compose(workDir, untouchedRuntime());
  assert.equal(out.ok, true, JSON.stringify(out));
  const after = treeDigest(workDir);
  assert.deepEqual([...after.keys()], [...before.keys()], 'a reuse must not add or remove files');
  const differing = [...before.keys()].filter((rel) => before.get(rel) !== after.get(rel));
  assert.deepEqual(differing, [], 'a reuse must not modify any byte');
});

test('L3: the legacy checkpoint is never served to a wider identity', async () => {
  const otherModel = tmpCopy();
  const modelBefore = treeDigest(otherModel);
  const modelOut = await compose(otherModel, untouchedRuntime({ runtimeId: 'antigravity-api-tool-less', model: 'claude-sonnet-4-6' }));
  assert.equal(modelOut.ok, false, 'another model must not reuse a default checkpoint');
  assert.equal(modelOut.code, 'run_identity_conflict');
  assert.deepEqual(treeDigest(otherModel), modelBefore, 'a refused resume must leave the checkpoint untouched');

  const customEndpoint = tmpCopy();
  const endpointBefore = treeDigest(customEndpoint);
  const endpointOut = await compose(customEndpoint, {
    ...untouchedRuntime(),
    customEndpoint: 'https://api.example.test/v1',
  });
  assert.equal(endpointOut.ok, false, 'a custom endpoint must not reuse a provider-endpoint checkpoint');
  assert.equal(endpointOut.code, 'run_identity_conflict');
  assert.deepEqual(treeDigest(customEndpoint), endpointBefore, 'a refused resume must leave the checkpoint untouched');
});
