// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-title-fallback.test.mjs
 *
 * The capture primitive degrades gracefully when Zhihu's question-info request
 * fails: answers are captured, `questionTitle` is ''. Dense geometry needs a
 * per-group target text, so P1 falls back to the SAME question's title from
 * the retrieval pool (search result), discloses it as an event, and still
 * fails closed when no title exists anywhere.
 *
 *   TF1  empty captured title + search title → run completes; the search title
 *        (minus the " - 知乎" suffix) is the embedding target; event recorded;
 *   TF2  a captured title always wins over the search title;
 *   TF3  no captured and no search title → group_execution_failed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { DOCS, PLAN, TOPIC, captureAdapter, runner, runtime, tmpDir } from './helpers/p1-offline-run.mjs';
import { mockVector768 } from './helpers/test-embedding-provider.mjs';

const SEARCH_TITLES = { 100: '搜索结果里的标题一 - 知乎', 200: '搜索结果里的标题二' };

function seamWithTitles(titles) {
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
      facts: titles[questionId] === undefined ? {} : { title: titles[questionId] },
    })),
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
  });
  return createProviderSeam({
    adapters: ['fixture-official', 'fixture-global'].map((providerId) => ({
      providerId, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET, retrieve: retrieve(providerId),
    })),
  });
}

/** Capture that loses the question title for the given groups (metadata request failed). */
function captureWithoutTitle(groups) {
  return {
    ...captureAdapter,
    retrieve(input) {
      const out = captureAdapter.retrieve(input);
      if (groups.includes(String(input.questionId))) {
        const file = path.join(input.outDir, String(input.questionId), 'answers.json');
        const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
        doc.questionTitle = '';
        fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
      }
      return out;
    },
  };
}

function recordingEmbeddings() {
  const texts = [];
  return {
    texts,
    provider: {
      preflight: async () => ({ ok: true }),
      embed: async (batch) => { texts.push(...batch); return { vectors: batch.map(() => mockVector768(7)) }; },
    },
  };
}

function events(workDir) {
  return fs.readFileSync(path.join(workDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function compose({ titles, lose }) {
  const workDir = tmpDir('p1-title-');
  const emb = recordingEmbeddings();
  const out = await composeP1Research({
    topic: TOPIC, workDir, plan: PLAN, runtime: runtime(), seam: seamWithTitles(titles),
    captureAdapter: captureWithoutTitle(lose), runner, embeddingProvider: emb.provider,
  });
  return { out, workDir, texts: emb.texts };
}

test('TF1: an empty captured title falls back to the search title, disclosed as an event', async () => {
  const { out, workDir, texts } = await compose({ titles: SEARCH_TITLES, lose: ['100'] });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(texts.includes('搜索结果里的标题一'), 'search title without the " - 知乎" suffix is the target text');
  assert.ok(!texts.some((t) => t.endsWith(' - 知乎')));
  assert.ok(texts.includes(DOCS[200].questionTitle), 'the other group keeps its captured title');
  const fallback = events(workDir).filter((e) => e.event === 'group_title_fallback');
  assert.deepEqual(fallback.map((e) => [e.groupId, e.source]), [['100', 'search_result']]);
});

test('TF2: a captured title always wins over the search title', async () => {
  const { out, workDir, texts } = await compose({ titles: SEARCH_TITLES, lose: [] });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(texts.includes(DOCS[100].questionTitle));
  assert.ok(!texts.includes('搜索结果里的标题一'));
  assert.equal(events(workDir).filter((e) => e.event === 'group_title_fallback').length, 0);
});

test('TF3: no captured title and no search title still fails closed', async () => {
  const { out } = await compose({ titles: { 200: SEARCH_TITLES[200] }, lose: ['100'] });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'group_execution_failed');
  assert.match(String(out.details ?? out.message ?? JSON.stringify(out)), /no questionTitle for group 100/);
});
