// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p1-seam-b-real-conformance.test.mjs
 *
 * P1 SEAM B — TYPE_B REAL INTEGRATION CONFORMANCE GATE (P1 WAVE 01, T12).
 *
 * TYPE_A fixture tests (p1-seam-contracts.test.mjs / p1-t12-rce-corpus-selector.test.mjs)
 * prove contract consistency on constructed inputs. This gate proves the REAL
 * integration chain end-to-end on the REAL T09 dogfood capture:
 *
 *   REAL multi-group-state.json (`manifest`, pinned SEAM A producer output)
 *     → frozen SEAM A validator + manifestHash recomputation      (tamper/stale gate)
 *     → T12 input adapter (lib/rce-input-adapter.mjs)             (decomposition +
 *                                                                   contentHash binding +
 *                                                                   T11 dense signals)
 *     → real selector (lib/rce-corpus-selector.mjs)               (SEAM B artifact)
 *     → verifySelectedResearchCorpus + FROZEN SEAM B validator    (self-audit)
 *     → writeRealSeamBArtifact → work/p1-wave-01-integration/
 *                                 seam-b-real.json                (downstream T13 gate)
 *
 * ---------------------------------------------------------------------------
 * RUN RECIPE (offline-deterministic; CI skips gracefully)
 * ---------------------------------------------------------------------------
 * 1. Real artifacts (LOCAL-ONLY, gitignored, NEVER committed):
 *      work/dogfood-t09-reval1/  (multi-group-state.json + zhihu/<qid>/answers.json)
 *    Resolution order: env P1_REAL_DOGFOOD_ROOT → <repoRoot>/work/dogfood-t09-reval1
 *    → <repoRoot>/../../work/dogfood-t09-reval1. Absent → the gate SKIPS.
 * 2. Real embeddings (computed ONCE, offline, via the REAL LOCAL provider):
 *      P1_T10_ONNX_MODEL_DIR=<model dir> node bin/build-real-embeddings.mjs
 *    (model acquisition, exact revision pinned, ~100 MB, one-time:
 *      NODE_USE_ENV_PROXY=1 HTTPS_PROXY=... HTTP_PROXY=... \
 *      node discovery/p1-t01-embedding-qualification/fetch-model.mjs \
 *        --revision 71e50dc531959f9e04ebf190ea25b00261a0a186 --dir <model dir>)
 *    The gate consumes the resulting JSON via env P1_REAL_EMBEDDINGS_JSON
 *    (default <repoRoot>/work/p1-wave-01-integration/real-embeddings.json);
 *    absent → the gate SKIPS. NO network and NO model load inside this test.
 * 3. Output artifact for the downstream T13 real gate:
 *      env P1_WAVE_INTEGRATION_OUT (default <repoRoot>/work/p1-wave-01-integration)
 *      → seam-b-real.json (written via the exported writeRealSeamBArtifact helper).
 *
 * Deterministic, offline. No playwright. No network. Real captured content
 * never enters the repo (work/ is gitignored).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { validateResearchCorpusManifest, validateSelectedResearchCorpus } from './helpers/p1-seam-contracts.mjs';
import {
  buildSelectorInput,
  computeAnswerEntryContentHash,
  deriveCanonicalSourceId,
  applySelectionAccountingToCoverageState,
  writeRealSeamBArtifact,
  RceInputAdapterError,
} from '../lib/rce-input-adapter.mjs';
import { selectResearchCorpus, verifySelectedResearchCorpus } from '../lib/rce-corpus-selector.mjs';
import { isBoundarySafeKey, isBoundarySafeString } from '../lib/rrf.mjs';
import { REQUIRED_EMBEDDING_IDENTITY } from '../lib/dense-geometry.mjs';
import {
  createInitialCoverageState,
  updateSourceGroupFusion,
  OWNER_T08_FUSION,
  OWNER_T12_SELECTION,
} from '../lib/coverage-state.mjs';

// ---------------------------------------------------------------------------
// real-artifact resolution (robust; CI has no local artifacts → skip)
// ---------------------------------------------------------------------------

function findRepoRoot() {
  let dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir; // dir or worktree pointer file
    const parent = path.resolve(dir, '..');
    if (parent === dir) throw new Error(`repo root (.git) not found above ${import.meta.url}`);
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot();

function resolveRealRoot() {
  // Explicit env WINS: if set, it is authoritative (a bogus path means the
  // artifacts are absent → skip), never silently falling back to defaults.
  if (process.env.P1_REAL_DOGFOOD_ROOT) {
    const p = process.env.P1_REAL_DOGFOOD_ROOT;
    return fs.existsSync(path.join(p, 'multi-group-state.json')) ? p : null;
  }
  const candidates = [
    path.join(REPO_ROOT, 'work', 'dogfood-t09-reval1'),
    path.resolve(REPO_ROOT, '..', '..', 'work', 'dogfood-t09-reval1'),
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, 'multi-group-state.json'))) ?? null;
}

const REAL_ROOT = resolveRealRoot();
const EMBEDDINGS_PATH = process.env.P1_REAL_EMBEDDINGS_JSON
  ?? path.join(REPO_ROOT, 'work', 'p1-wave-01-integration', 'real-embeddings.json');
const INTEGRATION_OUT = process.env.P1_WAVE_INTEGRATION_OUT
  ?? path.join(REPO_ROOT, 'work', 'p1-wave-01-integration');

const MISSING = [];
if (!REAL_ROOT) MISSING.push('real artifacts root (P1_REAL_DOGFOOD_ROOT / work/dogfood-t09-reval1)');
if (!fs.existsSync(EMBEDDINGS_PATH)) MISSING.push(`real embeddings JSON (${EMBEDDINGS_PATH}); produce with bin/build-real-embeddings.mjs`);
const SKIP_REASON = MISSING.length
  ? `SEAM B real conformance needs LOCAL-ONLY artifacts not present in CI: ${MISSING.join('; ')} — see test header RUN RECIPE`
  : null;
// node:test treats the mere PRESENCE of the `skip` key as a skip — build the
// options object conditionally so a null reason never skips the gate.
const SKIP_OPT = SKIP_REASON ? { skip: SKIP_REASON } : {};

const PLAN_HASH_HEX64 = /^[0-9a-f]{64}$/;
const CID_SHAPE = /^asrc-[0-9a-f]{24}$/;

/** Load the real manifest from the capture state (key `manifest`). */
function loadRealManifest() {
  const state = JSON.parse(fs.readFileSync(path.join(REAL_ROOT, 'multi-group-state.json'), 'utf8'));
  return state.manifest;
}

/** Load real embeddings and attach the accepted identity to every vector. */
function loadRealEmbeddings() {
  const raw = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf8'));
  assert.deepEqual(raw.identity, { ...REQUIRED_EMBEDDING_IDENTITY },
    'real embeddings identity must exactly match the accepted T10/T11 profile (fail closed)');
  const embeddingsBySourceId = Object.fromEntries(
    Object.entries(raw.sourceVectors).map(([k, v]) => [k, { vector: v, identity: raw.identity }]),
  );
  const targetEmbeddingByGroupId = Object.fromEntries(
    Object.entries(raw.targetVectors).map(([k, v]) => [k, { vector: v, identity: raw.identity }]),
  );
  return { raw, embeddingsBySourceId, targetEmbeddingByGroupId };
}

/** Recompute canonicalSourceId/contentHash for every real answer entry. */
function recomputeRealDecomposition(manifest) {
  const byCanonicalId = new Map();
  for (const g of manifest.groups) {
    const parsed = JSON.parse(fs.readFileSync(path.join(REAL_ROOT, g.answersRel), 'utf8'));
    for (const entry of parsed.answers) {
      byCanonicalId.set(deriveCanonicalSourceId(g.groupId, entry.id), { groupId: g.groupId, entry });
    }
  }
  return byCanonicalId;
}

function runRealSelection(manifest, embeddings) {
  // authorized adapter API: buildSelectorInput returns the selector's
  // { sourcesByGroup, denseSignals, densePairwise, options } input face;
  // the manifest is passed to the selector by the caller.
  const input = buildSelectorInput({
    manifest,
    artifactsRoot: REAL_ROOT,
    embeddingsBySourceId: embeddings.embeddingsBySourceId,
    targetEmbeddingByGroupId: embeddings.targetEmbeddingByGroupId,
  });
  return { input, artifact: selectResearchCorpus({ manifest, ...input }) };
}

// ---------------------------------------------------------------------------
// THE gate
// ---------------------------------------------------------------------------

test('REAL_T09_TO_T12_TO_SEAM_B_CONFORMANCE: real manifest → adapter → selector → frozen validators → accounting → determinism → downstream artifact', SKIP_OPT, () => {
  // ---- 1. real SEAM A manifest: frozen validator + manifestHash recomputation
  const manifest = loadRealManifest();
  assert.equal(manifest.type, 'research-corpus-manifest');
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(PLAN_HASH_HEX64.test(manifest.planHash));
  assert.ok(PLAN_HASH_HEX64.test(manifest.manifestHash), 'real manifestHash must be the real producer encoding (plain 64hex, no prefix)');
  const seamA = validateResearchCorpusManifest(manifest);
  assert.equal(seamA.ok, true, JSON.stringify(seamA.errors)); // validator recomputes manifestHash internally
  assert.equal(manifest.groups.length, 2, 'real capture: 2 verified groups');

  // adapter fail-closed precondition: the real embeddings bind THIS capture
  const embeddings = loadRealEmbeddings();
  assert.equal(embeddings.raw.manifestHash, manifest.manifestHash,
    'embeddings JSON was generated from a different capture (fail closed)');

  // ---- 2. adapter → real selector → SEAM B artifact → both frozen audits PASS
  const { artifact } = runRealSelection(manifest, embeddings);
  assert.doesNotThrow(() => verifySelectedResearchCorpus(artifact));
  const seamB = validateSelectedResearchCorpus(artifact);
  assert.equal(seamB.ok, true, JSON.stringify(seamB.errors));
  assert.equal(artifact.seam, 'T12_TO_T13');
  assert.equal(artifact.seamVersion, 1);
  assert.equal(artifact.planHash, manifest.planHash);

  // ---- 3. verified accounting semantics (PO 2026-09-05: verified := eligible)
  for (const g of artifact.corpus.groups) {
    const { eligible, selected, verified } = g.accounting;
    assert.ok(selected <= verified && verified <= eligible, `${g.groupId}: ${selected}/${verified}/${eligible}`);
    assert.equal(verified, eligible, `${g.groupId}: VERIFICATION != SELECTION — every eligible source inherits valid upstream verification`);
  }
  const t = artifact.corpus.totals;
  assert.equal(t.verified, t.eligible);
  assert.ok(t.selected <= t.verified && t.verified <= t.eligible);
  const groupSum = artifact.corpus.groups.reduce((s, g) => s + g.accounting.eligible, 0);
  assert.equal(t.eligible, groupSum, 'totals consistent with per-group accounting');

  // ---- 4. canonicalSourceId properties on the REAL decomposition
  const decomposition = recomputeRealDecomposition(manifest);
  const allIds = [...decomposition.keys()];
  assert.equal(allIds.length, 50, 'real capture: 2 + 48 answers');
  assert.equal(new Set(allIds).size, allIds.length, 'canonicalSourceId globally unique across BOTH groups');
  for (const id of allIds) {
    assert.match(id, CID_SHAPE, 'boundary-safe scheme shape: plain asrc-<24 lowercase hex>');
    assert.equal(deriveCanonicalSourceId(decomposition.get(id).groupId, decomposition.get(id).entry.id), id);
    assert.ok(isBoundarySafeKey(id), 'canonicalSourceId passes the repo boundary-safety key helper');
    assert.ok(isBoundarySafeString(id), 'canonicalSourceId passes the repo boundary-safety string helper');
  }
  // determinism: recompute the whole scheme twice → identical
  const decomposition2 = recomputeRealDecomposition(manifest);
  assert.deepEqual([...decomposition2.keys()].sort(), [...allIds].sort());
  // contentHash binding: recomputed hash of the SAME entry is identical for every selected ref
  for (const g of artifact.corpus.groups) {
    for (const ref of g.selectedSourceRefs) {
      const { entry } = decomposition.get(ref.canonicalSourceId);
      assert.ok(entry, `selected ref ${ref.canonicalSourceId} traces to a real answer entry`);
      assert.equal(computeAnswerEntryContentHash(entry), ref.contentHash, 'contentHash binds the ref to the canonical source content');
      assert.equal(ref.verifiedArtifactRef, manifest.groups.find((m) => m.groupId === g.groupId).answersRel,
        'verifiedArtifactRef is the SEAM A verified artifact (no content duplication, no new store)');
    }
  }
  // tamper ONE byte of an entry → different contentHash
  {
    const anyId = [...artifact.corpus.groups][0].selectedSourceRefs[0].canonicalSourceId;
    const { entry } = decomposition.get(anyId);
    const tampered = JSON.parse(JSON.stringify(entry));
    assert.ok(typeof tampered.content === 'string' && tampered.content.length > 0);
    tampered.content = (tampered.content[0] === 'X' ? `Y${tampered.content.slice(1)}` : `X${tampered.content.slice(1)}`);
    assert.notEqual(computeAnswerEntryContentHash(tampered), computeAnswerEntryContentHash(entry), 'one-byte tamper changes the content hash');
  }

  // ---- 5. determinism: full adapter+selection run twice → byte-identical artifact
  const { artifact: artifact2 } = runRealSelection(manifest, embeddings);
  assert.equal(JSON.stringify(artifact), JSON.stringify(artifact2), 'identity + accounting byte-identical across runs');

  // ---- 6. downstream T13 real gate artifact (LOCAL-ONLY work/ output)
  const outPath = writeRealSeamBArtifact(artifact, { outPath: path.join(INTEGRATION_OUT, 'seam-b-real.json') });
  assert.ok(fs.existsSync(outPath));
  const reread = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(reread.selectedCorpusIdentity, artifact.selectedCorpusIdentity);
  assert.match(artifact.selectedCorpusIdentity, /^sha256:[0-9a-f]{64}$/);
  console.log(`SEAM_B_REAL artifact written: ${outPath}`);
  console.log(`selectedCorpusIdentity: ${artifact.selectedCorpusIdentity}`);
  console.log(`totals: ${JSON.stringify(artifact.corpus.totals)}`);
});

test('REAL adapter fail-closed: tampered real manifest (manifestHash stale) → RCE_ADAPTER_MANIFEST_HASH_MISMATCH', SKIP_OPT, () => {
  const manifest = loadRealManifest();
  const embeddings = loadRealEmbeddings();
  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.groups[0].capturedAnswerCount = 999; // post-hoc mutation of a hashed field
  assert.throws(
    () => buildSelectorInput({
      manifest: tampered,
      artifactsRoot: REAL_ROOT,
      embeddingsBySourceId: embeddings.embeddingsBySourceId,
      targetEmbeddingByGroupId: embeddings.targetEmbeddingByGroupId,
    }),
    (e) => e instanceof RceInputAdapterError && e.code === 'RCE_ADAPTER_MANIFEST_HASH_MISMATCH',
  );
});

test('REAL adapter fail-closed: missing embedding for one real candidate → RCE_ADAPTER_EMBEDDING_MISSING', SKIP_OPT, () => {
  const manifest = loadRealManifest();
  const embeddings = loadRealEmbeddings();
  const decomposition = recomputeRealDecomposition(manifest);
  const someId = decomposition.keys().next().value;
  const partial = { ...embeddings.embeddingsBySourceId };
  delete partial[someId];
  assert.throws(
    () => buildSelectorInput({
      manifest,
      artifactsRoot: REAL_ROOT,
      embeddingsBySourceId: partial,
      targetEmbeddingByGroupId: embeddings.targetEmbeddingByGroupId,
    }),
    (e) => e instanceof RceInputAdapterError && e.code === 'RCE_ADAPTER_EMBEDDING_MISSING',
  );
});

// ---------------------------------------------------------------------------
// T12-I3 — T07 Hook 3 thin adapter (offline; uses a real-shape SEAM B artifact)
// ---------------------------------------------------------------------------

function hex64(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest('hex');
}

const PLAN_HASH = '5f1a2b3c4d5e6f708192a3b4c5d6e7f80112233445566778899aabbccddeeff0';

function buildSmallManifestAndArtifact() {
  const manifest = {
    schemaVersion: 1,
    type: 'research-corpus-manifest',
    planHash: PLAN_HASH,
    selectionIdentity: hex64('si'),
    selectionDecisionHash: hex64('sd'),
    groups: [
      { groupId: 'g1', questionId: 'g1', answersRel: 'zhihu/g1/answers.json', handoffRel: 'zhihu/g1/handoff.json', answersHash: hex64('a1'), handoffHash: hex64('h1'), capturedAnswerCount: 3, reportedAnswerCount: 3, paginationStatus: 'complete' },
      { groupId: 'g2', questionId: 'g2', answersRel: 'zhihu/g2/answers.json', handoffRel: 'zhihu/g2/handoff.json', answersHash: hex64('a2'), handoffHash: hex64('h2'), capturedAnswerCount: 1, reportedAnswerCount: 1, paginationStatus: 'complete' },
    ],
    accounting: { selectedGroupCount: 2, verifiedGroupCount: 2, capturedNotVerifiedGroupCount: 0, failedGroupCount: 0 },
  };
  manifest.manifestHash = hex64(JSON.stringify(manifest));
  const signal = (r) => ({ relevance: r, novelty: 0.5, redundancy: 0.5 });
  const sourcesByGroup = {
    g1: ['1', '2', '3'].map((n) => ({ canonicalSourceId: `g1-${n}`, contentHash: `sha256:${hex64(`g1${n}`)}` })),
    g2: [{ canonicalSourceId: 'g2-1', contentHash: `sha256:${hex64('g21')}` }],
  };
  const denseSignals = {
    'g1-1': signal(0.9), 'g1-2': signal(0.8), 'g1-3': signal(-0.5), 'g2-1': signal(0.4),
  };
  const artifact = selectResearchCorpus({ manifest, sourcesByGroup, denseSignals });
  return { artifact };
}

test('T12-I3: applySelectionAccountingToCoverageState maps SEAM B accounting onto the frozen Hook 3 keys', () => {
  const { artifact } = buildSmallManifestAndArtifact();
  let state = createInitialCoverageState({ planHash: PLAN_HASH });
  // Hook 3 invariant: selected_source_group_count cannot exceed fusedGroupCount
  state = updateSourceGroupFusion(state, { fusedGroupCount: 2 }, { caller: OWNER_T08_FUSION });

  const next = applySelectionAccountingToCoverageState(state, artifact, { caller: OWNER_T12_SELECTION });

  const expectedSelected = artifact.corpus.groups
    .flatMap((g) => g.selectedSourceRefs.map((r) => r.canonicalSourceId)).sort();
  assert.deepEqual(next.analysisCoverage.selectedCorpusSourceSet, expectedSelected);
  assert.equal(next.diagnostics.selected_source_group_count, artifact.corpus.groups.length);
  for (const g of artifact.corpus.groups) {
    assert.equal(next.diagnostics.selected_content_by_group[g.groupId], g.accounting.selected);
    assert.equal(next.diagnostics.per_group_selection_coverage[g.groupId], g.accounting.selected / g.accounting.eligible);
  }
  const totals = artifact.corpus.totals;
  const expectedShare = totals.selected > 0
    ? Math.max(...artifact.corpus.groups.map((g) => g.accounting.selected)) / totals.selected
    : 0;
  assert.equal(next.diagnostics.largest_group_share, expectedShare);
  // T13 single-writer ledgers are NOT touched by the T12 hook
  assert.deepEqual(next.analysisCoverage.mappedSourceSet, []);
  assert.deepEqual(next.analysisCoverage.analyzedSourceSet, []);
  assert.equal(next.analysisCoverage.is100PercentAnalysis, false);
});

test('T12-I3: unauthorized caller / malformed artifact fail closed (no state mutation)', () => {
  const { artifact } = buildSmallManifestAndArtifact();
  const state = updateSourceGroupFusion(
    createInitialCoverageState({ planHash: PLAN_HASH }),
    { fusedGroupCount: 2 },
    { caller: OWNER_T08_FUSION },
  );
  assert.throws(
    () => applySelectionAccountingToCoverageState(state, artifact, { caller: 'T13' }),
    (e) => e.code === 'coverage_unauthorized_owner',
  );
  const malformed = JSON.parse(JSON.stringify(artifact));
  delete malformed.corpus;
  assert.throws(() => applySelectionAccountingToCoverageState(state, malformed, { caller: OWNER_T12_SELECTION }));
});
