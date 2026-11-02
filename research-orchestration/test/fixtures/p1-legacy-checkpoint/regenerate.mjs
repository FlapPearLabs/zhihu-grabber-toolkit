// Generate a COMPLETE default-identity checkpoint with the PREVIOUS version
// (bfdd489) of the composer, so the repaired code can be proven to resume it.
// Offline only: seam/capture/runner/embeddings/model are fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OLD = process.env.OLD_TREE;
const { composeP1Research } = await import(path.join(OLD, 'lib/p1-runtime-composer.mjs'));
const { createProviderSeam, CAPABILITY_SEARCH, AUTH_CLASS_OFFICIAL_SECRET } = await import(path.join(OLD, 'lib/provider-seam.mjs'));
const { mockVector768 } = await import(path.join(OLD, 'test/helpers/test-embedding-provider.mjs'));
const { T14_SYNTHESIS_RUNTIME_ID, T14_SYNTHESIS_MODEL } = await import(path.join(OLD, 'lib/cross-source-synthesis.mjs'));

const TOPIC = 'AI 编程工具会取代程序员吗';
const NOW = () => '2026-10-15T00:00:00.000Z';
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

function mockRuntime() {
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    analyze: async ({ projection }) => {
      const tokens = [...String(projection).matchAll(/\[BEGIN UNTRUSTED_DATA token=([A-Za-z0-9]+)/g)].map((m) => m[1]);
      if (tokens.length === 0) throw new Error('mock runtime saw no issued tokens');
      return {
        main: [{ tokenRef: tokens[0], statement: '主流观点：该做法在多数场景下有效' }],
        minority: [{ tokenRef: tokens[tokens.length - 1], statement: '少数派观点：特定条件下结论相反' }],
        contradictory: [],
        expertEvidenceRichTokens: [tokens[0]],
      };
    },
    async synthesize({ claims }) {
      return {
        families: [{
          aspect: '总体有效性',
          anchorClaimId: [...claims.map((c) => c.claimId)].sort()[0],
          members: claims.map((c) => ({ claimId: c.claimId, stance: 'ASSERTS' })),
        }],
        unresolvedClaimIds: [],
      };
    },
  };
}

const workDir = process.argv[2];
const out = await composeP1Research({
  topic: TOPIC,
  workDir,
  plan: PLAN,
  runtime: mockRuntime(),
  seam: rankingSeam(),
  captureAdapter,
  runner: groupRunner(),
  embeddingProvider: embeddingProvider(),
});
console.log(JSON.stringify({ ok: out.ok, code: out.code ?? null, runId: out.runId ?? null, reused: out.reused ?? null }, null, 2));
if (!out.ok) process.exit(1);
