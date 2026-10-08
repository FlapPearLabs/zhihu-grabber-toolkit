// SPDX-License-Identifier: AGPL-3.0-only
// Product process: no benchmark target/evaluator import or target file access.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { escapeUntrustedMarkdownText } from '../../zhihu-answer-grabber/src/markdown-security.js';
import { escapeRawHtml } from '../../corpus-anthology/lib/text.mjs';
import { validateProductInput } from './input.mjs';
import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { sha256File } from '../lib/state.mjs';
import { normalizeQueryString } from '../lib/targeted-requery-authorization.mjs';
import { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } from '../lib/provider-seam.mjs';
import { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } from '../lib/cross-source-synthesis.mjs';
import { defaultRunner } from '../lib/runner.mjs';
import { mockVector768 } from '../test/helpers/test-embedding-provider.mjs';
import { writeJson } from '../scripts/p2a-t14/fixtures.mjs';

export const EXPERIMENT_CONFIG = Object.freeze({ maxQueryBudget: 20 });
export const PROPOSAL_POLICY_VERSION = 'public-plan-first-reference-v1';

export async function runProduct({ input, workDir, arm }) {
  validateProductInput(input);
  if (!['baseline', 'candidate'].includes(arm)) throw new Error('EVALUATION_ARM_INVALID');
  if (fs.existsSync(workDir)) throw new Error('EVALUATION_COLD_DIRECTORY_REQUIRED');
  fs.mkdirSync(workDir, { recursive: true });
  const calls = []; const semanticCalls = [];
  const envelope = (providerId, capability, authClass, items, extra = {}) => ({
    ok: true, provider_id: providerId, capability, auth_class: authClass,
    retrieved_at: '2026-10-08T00:00:00.000Z', items,
    completeness: { status: capability === 'capture' ? 'complete' : 'unknown',
      evidence: { basis: 'authored-curated-frozen-fixture' } }, ...extra,
  });
  const routes = new Map(Object.entries(input.routes).map(([query, ids]) => [normalizeQueryString(query), ids]));
  const seam = createProviderSeam({ adapters: ['zhihu_search', 'zhihu-open-platform'].map(providerId => ({
    providerId, capability: CAPABILITY_SEARCH, authClass: AUTH_CLASS_OFFICIAL_SECRET,
    retrieve({ query }) {
      const ids = routes.get(normalizeQueryString(query)) ?? [];
      calls.push({ kind: 'retrieval', provider_id: providerId, query, question_ids: ids });
      return envelope(providerId, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET, ids.map((questionId, rank) => ({
        identity: { kind: 'candidate', questionId }, source_url: null, facts: {},
        provenance: { route: 'frozen-evaluation', rank: rank + 1, rankOrigin: 'fixture_order' },
      })), { query });
    },
  })) });
  const captureAdapter = {
    providerId: 'frozen-evaluation-capture', capability: 'capture', authClass: 'session',
    retrieve({ questionId, outDir }) {
      const source = input.corpus.find(item => item.question_id === questionId);
      if (!source) throw new Error('EVALUATION_SOURCE_NOT_IN_FROZEN_CORPUS');
      calls.push({ kind: 'capture', question_id: questionId });
      const dir = path.join(outDir, questionId);
      fs.mkdirSync(dir, { recursive: true });
      writeJson(path.join(dir, 'answers.json'), { questionId, questionTitle: source.title,
        answers: [{ id: `${questionId}01`, content: source.text, excerpt: source.text,
          author: '合成语料', voteupCount: 0 }] });
      fs.writeFileSync(path.join(dir, 'answers.md'), `## 1. 合成语料 — 0 赞 · 0 评论\n\n${escapeUntrustedMarkdownText(escapeRawHtml(source.text))}\n`);
      writeJson(path.join(dir, '.progress.json'), { offset: 60, done: true });
      return envelope('frozen-evaluation-capture', 'capture', 'session', [{
        identity: { kind: 'group', questionId }, facts: { capturedAnswerCount: 1 },
        provenance: { route: 'frozen-evaluation-capture', rank: 1, rankOrigin: 'fixture' },
      }]);
    },
  };
  // Identity fields satisfy the production seam pin; implementation is explicitly a double.
  const runtime = {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID, model: T14_SYNTHESIS_MODEL,
    async analyze({ projection }) {
      semanticCalls.push('analyze');
      const blocks = [...projection.matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)\][^\n]*\n([\s\S]*?)\n\[END UNTRUSTED_DATA token=\1\]/g)];
      return { main: blocks.map(block => ({ tokenRef: block[1], statement: block[2].trim() })),
        minority: [], contradictory: [], expertEvidenceRichTokens: [] };
    },
    async synthesize({ claims }) {
      semanticCalls.push('synthesize');
      return { families: claims.map(claim => ({ aspect: '独立材料观点', anchorClaimId: claim.claimId,
        members: [{ claimId: claim.claimId, stance: 'ASSERTS' }] })), unresolvedClaimIds: [] };
    },
  };
  const plan = input.plan;
  const targetedSubphase = arm === 'baseline' ? null : {
    maxQueryBudget: 20, maxAttemptsPerGap: 2,
    proposeForDiagnosis({ gaps }) {
      // Proposal data comes exclusively from the public frozen plan.
      return gaps.flatMap(gap => {
        const field = gap.gapType === 'CONTRADICTION_GAP' ? 'opposingFramings'
          : gap.gapType === 'AUTHORITY_GAP' ? 'sourceGroupIntents.intent' : 'entities';
        const entries = field === 'sourceGroupIntents.intent' ? plan.sourceGroupIntents : plan[field];
        return entries.length ? [{ gapId: gap.gapId, planOwnedStringRef: { field, index: 0 } }] : [];
      });
    },
  };
  const start = performance.now();
  const result = await composeP1Research({ topic: input.task, workDir, plan, seam, captureAdapter, runtime,
    config: EXPERIMENT_CONFIG, targetedSubphase, runner: defaultRunner(),
    embeddingProvider: { async preflight() { return { ok: true }; },
      async embed(texts) { return { vectors: texts.map(() => mockVector768(7)) }; } },
    fetchImpl() { throw new Error('DETERMINISTIC_EVALUATION_NETWORK_FORBIDDEN'); },
  });
  // Observer files belong to the product runner, never to the evaluator.
  writeJson(path.join(workDir, 'evaluation-execution-observation.json'), {
    implementation: 'DETERMINISTIC_DOUBLE', calls, semantic_calls: semanticCalls,
    cost: { retrieval_calls: calls.filter(call => call.kind === 'retrieval').length,
      retrieval_attempts: calls.filter(call => call.kind === 'retrieval').length,
      provider_calls: calls.length, external_provider_calls: 0, model_invocations: 0,
      semantic_adapter_invocations: semanticCalls.length, wall_clock_ms: performance.now() - start,
      token_cost: 'UNKNOWN', money_cost: 'UNKNOWN' },
  });
  return { ok: result.ok, code: result.code ?? null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = key => args[args.indexOf(`--${key}`) + 1];
  try {
    const file = arg('input');
    if (sha256File(file) !== arg('expected-input-hash')) throw new Error('BENCHMARK_CONTAMINATION_INPUT_HASH');
    const result = await runProduct({ input: JSON.parse(fs.readFileSync(file, 'utf8')),
      workDir: arg('work-dir'), arm: arg('arm') });
    console.log(JSON.stringify(result));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, code: String(error.code ?? error.message).split(/[ :]/)[0] }));
    process.exitCode = 1;
  }
}
