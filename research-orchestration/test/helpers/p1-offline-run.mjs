// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/helpers/p1-offline-run.mjs
 *
 * A complete P1 run composed fully offline (injected search providers, capture,
 * runner, embeddings and model runtime) — shared by tests that consume the
 * artifacts of a COMPLETE run (report.md, run scoring, retrieval ledger).
 *
 * Two source groups (questions 100 and 200, five answers). The runtime double
 * yields main/minority/contradictory claims for group 100 and main/minority for
 * group 200, and synthesizes two families plus one unresolved claim.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { composeP1Research } from '../../lib/p1-runtime-composer.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../../lib/provider-seam.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../../lib/cross-source-synthesis.mjs';
import { mockVector768 } from './test-embedding-provider.mjs';

export const TOPIC = 'AI 编程工具会取代程序员吗';
const NOW = () => '2026-10-15T00:00:00.000Z';

export const PLAN = {
  schemaVersion: 1,
  queryVariants: ['AI 编程工具 取代 程序员', 'AI coding 岗位影响'],
  aspects: ['岗位影响'],
  entities: [],
  opposingFramings: [],
  terminologyVariants: [],
  sourceGroupIntents: [],
};

export const DOCS = {
  100: {
    questionId: '100',
    questionTitle: 'AI 编程工具会让初级程序员失业吗？',
    answers: [
      { id: '1001', content: '重复性的增删改查会被自动化。', author: '甲', voteupCount: 120 },
      { id: '1002', content: '我们团队招聘没有减少。', author: '乙', voteupCount: 80 },
      { id: '1003', content: '被取代的是不学习的人。', author: '丙', voteupCount: 30 },
    ],
  },
  200: {
    questionId: '200',
    questionTitle: '企业为什么还需要工程师？',
    answers: [
      { id: '2001', content: '责任边界需要人承担。', author: '丁', voteupCount: 60 },
      { id: '2002', content: '小团队能做大项目。', author: '戊', voteupCount: 15 },
    ],
  },
};

export function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function searchResult(providerId) {
  return {
    ok: true,
    provider_id: providerId,
    capability: CAPABILITY_SEARCH,
    auth_class: AUTH_CLASS_OFFICIAL_SECRET,
    retrieved_at: NOW(),
    items: [['100', 1], ['200', 2]].map(([questionId, rank]) => ({
      identity: { kind: 'candidate', questionId },
      provenance: { route: 'fixture', rank, rankOrigin: 'fixture_order' },
      source_url: null,
      facts: {},
    })),
    completeness: { status: 'unknown', evidence: { signal: 'absent', reason: 'fixture_no_pagination_signal' } },
  };
}

export function seam() {
  const adapter = (providerId) => ({
    providerId, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve: () => searchResult(providerId),
  });
  return createProviderSeam({ adapters: [adapter('fixture-official'), adapter('fixture-global')] });
}

export const captureAdapter = {
  providerId: 'zhihu-session-capture',
  capability: 'capture',
  authClass: 'session',
  retrieve({ questionId, outDir }) {
    const dir = path.join(outDir, String(questionId));
    fs.mkdirSync(dir, { recursive: true });
    const doc = DOCS[String(questionId)];
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

export function runner(name, args) {
  const doc = () => JSON.parse(fs.readFileSync(path.join(args[0], 'answers.json'), 'utf8'));
  if (name === 'zhihu-verify') {
    const d = doc();
    return { status: 0, stdout: JSON.stringify({ valid: true, questionId: String(d.questionId), capturedAnswerCount: d.answers.length, reportedAnswerCount: d.answers.length }) };
  }
  if (name === 'zhihu-handoff') {
    fs.writeFileSync(path.join(args[0], 'handoff.json'), JSON.stringify({ questionId: String(doc().questionId), task: 'digest', sourceType: 'session-capture', verified: true, generatedBy: 'fixture' }));
    return { status: 0, stdout: '' };
  }
  if (name === 'corpus-verify-handoff') return { status: 0, stdout: JSON.stringify({ valid: true }) };
  throw new Error(`unexpected runner command: ${name}`);
}

export const embeddingProvider = {
  preflight: async () => ({ ok: true }),
  embed: async (texts) => ({ vectors: texts.map(() => mockVector768(7)) }),
};

/** Runtime double: group 100 yields main/minority/contradictory, group 200 main/minority. */
export function runtime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async ({ projection }) => {
      const t = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      return t.length === 3
        ? { main: [{ tokenRef: t[0], statement: '观点甲' }], minority: [{ tokenRef: t[2], statement: '观点丙' }], contradictory: [{ tokenRef: t[1], statement: '观点乙' }], expertEvidenceRichTokens: [t[1]] }
        : { main: [{ tokenRef: t[0], statement: '观点丁' }], minority: [{ tokenRef: t[1], statement: '观点戊' }], contradictory: [], expertEvidenceRichTokens: [] };
    },
    async synthesize({ claims }) {
      const id = (s) => claims.find((c) => c.statement === s).claimId;
      return {
        families: [
          { aspect: '议题一', anchorClaimId: id('观点甲'), members: [{ claimId: id('观点甲'), stance: 'ASSERTS' }, { claimId: id('观点乙'), stance: 'OPPOSES' }] },
          { aspect: '议题二', anchorClaimId: id('观点丁'), members: [{ claimId: id('观点丁'), stance: 'ASSERTS' }, { claimId: id('观点戊'), stance: 'ASSERTS' }] },
        ],
        unresolvedClaimIds: [id('观点丙')],
      };
    },
  };
}

/** Compose a COMPLETE offline run; returns its work directory. */
export async function completedRun(prefix = 'p1-run-') {
  const workDir = tmpDir(prefix);
  const out = await composeP1Research({
    topic: TOPIC, workDir, plan: PLAN, runtime: runtime(), seam: seam(), captureAdapter, runner, embeddingProvider,
  });
  assert.equal(out.ok, true, `fixture composition failed: ${JSON.stringify(out)}`);
  return workDir;
}
