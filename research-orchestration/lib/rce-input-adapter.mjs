// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/rce-input-adapter.mjs
 *
 * P1-T12 INTEGRATION ADAPTER (P1 WAVE 01 serial integration train, T12-I1/T12-I3).
 *
 * Ownership: P1-T12 (integration gate verdict IMPLEMENTATION_WAVE=PASS,
 * 2026-09-05). This module is the caller-owned per-source decomposition +
 * T11 dense-signal injection layer between:
 *   - SEAM A  : real T09 ResearchCorpusManifest + verified per-group artifacts
 *               (answers.json under artifactsRoot, keyed by group.answersRel)
 *   - SEAM A' : T11 dense geometry (lib/dense-geometry.mjs) over REAL
 *               embeddings supplied by the caller
 *   - SEAM B  : selectResearchCorpus (lib/rce-corpus-selector.mjs)
 * and a thin T07 Hook 3 adapter (applySelectionAccountingToCoverageState)
 * that maps a SEAM B artifact's accounting onto the frozen
 * updateSelectionAccounting hook (lib/coverage-state.mjs).
 *
 * Contracts (binding):
 *   - canonicalSourceId scheme (controller-owned): `asrc-` +
 *     sha256(`${groupId}:${answerId}`) lowercase-hex truncated to 24 chars.
 *     answer.id is the canonical source key from the captured metadata
 *     (answers.json entries). Globally unique across groups (the groupId is
 *     hashed into the id), boundary-safe (plain [a-z0-9-]), deterministically
 *     recomputable. Cross-group duplicates are additionally re-enforced
 *     fail-closed by the selector (RCE_DUPLICATE_CANONICAL_SOURCE_ID).
 *   - contentHash: `sha256:` + sha256 over the canonical JSON (recursively
 *     key-sorted, stable serialization) of the INDIVIDUAL answer entry object
 *     — binds each ref to its canonical source content. Exposed via
 *     computeAnswerEntryContentHash for independent gate re-verification.
 *   - verifiedArtifactRef = group.answersRel (SEAM B CANONICAL_CONTENT_LOCATION):
 *     refs point at the verified artifact; content is NEVER duplicated and
 *     no new store is created.
 *   - Verification is NEVER reinterpreted: every decomposed candidate inherits
 *     its verified status from the SEAM A manifest only. If the manifest fails
 *     frozen SEAM A validation (structural invariants + manifestHash
 *     recomputation over the producer's canonical-JSON domain) or any
 *     answers.json is missing / hash-mismatched, the adapter FAILS CLOSED.
 *   - Dense signals (T11): per candidate, dense geometry is computed with
 *     computeDenseGeometry({target, items}); a missing embedding for ANY
 *     candidate or group target FAILS CLOSED (no silent degradation, no
 *     popularity-only fallback). denseSignals are keyed globally by
 *     canonicalSourceId: { relevance, novelty, redundancy } — exactly the
 *     fields the selector consumes. densePairwise is the selector's MMR
 *     lookup shape { ids, matrix } built from the SAME vectors (global,
 *     all groups); MMR stays OFF by default (options.mmr undefined).
 *   - Group identity is preserved verbatim: sourcesByGroup is keyed exactly
 *     by the manifest's groupId.
 *
 * The ONLY I/O in this module: reading the manifest-referenced answers.json
 * artifacts (buildSelectorInput) and writing the downstream integration
 * artifact (writeRealSeamBArtifact, LOCAL-ONLY work/ output for the T13 real
 * gate). Everything else is pure and deterministic.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { selectResearchCorpus, verifySelectedResearchCorpus } from './rce-corpus-selector.mjs';
import { computeDenseGeometry, cosineSimilarity } from './dense-geometry.mjs';
import { updateSelectionAccounting } from './coverage-state.mjs';

// ---------------------------------------------------------------------------
// error type
// ---------------------------------------------------------------------------

export class RceInputAdapterError extends Error {
  constructor(code, message, { details = null } = {}) {
    super(message);
    this.name = 'RceInputAdapterError';
    this.code = code;
    this.details = details;
  }
}

function failClosed(code, message, details = null) {
  throw new RceInputAdapterError(code, message, { details });
}

// ---------------------------------------------------------------------------
// deterministic canonical JSON (same hash domain as the frozen SEAM
// validators and the real T09 producer: recursively key-sorted,
// JSON.stringify leaf semantics)
// ---------------------------------------------------------------------------

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const HEX64 = /^[0-9a-f]{64}$/;
const PLAN_HASH = /^[0-9a-f]{64}$/;

/**
 * canonicalSourceId scheme (controller-owned, see module header).
 * Deterministically recomputable; globally unique across groups because the
 * groupId is hashed into the input; plain [a-z0-9-] (boundary-safe).
 *
 * @param {string} groupId  manifest group id (T08 authority format)
 * @param {string} answerId canonical source key from the captured metadata
 * @returns {string} `asrc-<24 lowercase hex>`
 */
export function deriveCanonicalSourceId(groupId, answerId) {
  if (typeof groupId !== 'string' || groupId.length === 0
    || typeof answerId !== 'string' || answerId.length === 0) {
    failClosed('RCE_ADAPTER_INPUT_INVALID', 'deriveCanonicalSourceId requires non-empty groupId and answerId strings');
  }
  return `asrc-${sha256Hex(`${groupId}:${answerId}`).slice(0, 24)}`;
}

/**
 * contentHash binding for one answers.json entry: sha256 over the canonical
 * (key-sorted) JSON of the individual entry object. Tampering one byte of
 * the entry changes the hash (gate-verifiable binding).
 *
 * @param {object} entry one answers.json answer entry
 * @returns {string} `sha256:<64 lowercase hex>` (selector SHA256_REF domain)
 */
export function computeAnswerEntryContentHash(entry) {
  if (!isPlainObject(entry)) {
    failClosed('RCE_ADAPTER_INPUT_INVALID', 'computeAnswerEntryContentHash requires a plain object entry');
  }
  return `sha256:${sha256Hex(canonicalJson(entry))}`;
}

// ---------------------------------------------------------------------------
// SEAM A fail-closed validation (mirror of the frozen producer contract)
// ---------------------------------------------------------------------------

/**
 * Fail-closed SEAM A manifest validation MIRRORING the frozen validator
 * (test/helpers/p1-seam-contracts.mjs validateResearchCorpusManifest): the
 * structural invariants plus the self-verifying manifestHash recomputation
 * over the producer's canonical-JSON domain (every present field except
 * manifestHash itself). The frozen validator is applied INDEPENDENTLY by the
 * SEAM B real conformance gate; this mirror keeps the lib self-contained
 * (lib must not import test helpers) while never being weaker on these
 * binding invariants.
 */
function validateSeamAManifestOrThrow(manifest) {
  if (!isPlainObject(manifest)) failClosed('RCE_ADAPTER_MANIFEST_INVALID', 'SEAM A manifest must be an object');
  if (manifest.type !== 'research-corpus-manifest' || manifest.schemaVersion !== 1) {
    failClosed('RCE_ADAPTER_MANIFEST_INVALID', 'SEAM A manifest type/schemaVersion mismatch');
  }
  if (!PLAN_HASH.test(manifest.planHash || '')) {
    failClosed('RCE_ADAPTER_MANIFEST_INVALID', 'SEAM A manifest planHash missing or malformed');
  }
  if (!Array.isArray(manifest.groups) || manifest.groups.length === 0) {
    failClosed('RCE_ADAPTER_MANIFEST_INVALID', 'SEAM A manifest groups must be a non-empty array');
  }
  for (const g of manifest.groups) {
    if (!isPlainObject(g)
      || typeof g.groupId !== 'string' || g.groupId.length === 0
      || typeof g.answersRel !== 'string' || g.answersRel.length === 0
      || !HEX64.test(g.answersHash || '')) {
      failClosed('RCE_ADAPTER_MANIFEST_INVALID', 'SEAM A manifest group identity/refs/hashes invalid');
    }
  }
  // self-verifying identity: recompute manifestHash over every present field
  // except the hash itself — detects stale / tampered / smuggled manifests.
  const { manifestHash, ...hashedFields } = manifest;
  if (!HEX64.test(manifestHash || '')) {
    failClosed('RCE_ADAPTER_MANIFEST_INVALID', 'SEAM A manifestHash missing or malformed');
  }
  const recomputed = sha256Hex(canonicalJson(hashedFields));
  if (recomputed !== manifestHash) {
    failClosed('RCE_ADAPTER_MANIFEST_HASH_MISMATCH',
      'recomputed manifestHash differs — manifest is stale or tampered (fail closed)');
  }
}

/** Work-relative ref guard: never absolute, never escaping the artifacts root. */
function resolveWorkRelative(root, rel) {
  if (path.isAbsolute(rel) || rel.split('/').includes('..')) {
    failClosed('RCE_ADAPTER_INPUT_INVALID', `artifact ref must be work-relative and must not escape the artifacts root`, { ref: rel });
  }
  return path.join(root, rel);
}

// ---------------------------------------------------------------------------
// dense signal helpers (T11 consumption)
// ---------------------------------------------------------------------------

function embeddingOrThrow(map, key, kind) {
  const emb = map[key];
  if (!isPlainObject(emb) || !Array.isArray(emb.vector) || emb.vector.length === 0) {
    failClosed('RCE_ADAPTER_EMBEDDING_MISSING', `missing embedding for ${kind} ${key} (no silent degradation)`);
  }
  return emb;
}

/**
 * Global pairwise similarity geometry ({ ids, matrix }) over ALL candidates,
 * built from the same vectors as the per-group dense signals — the exact
 * shape consumed by the selector's buildPairwiseLookup (MMR path). ids are
 * sorted canonicalSourceIds; matrix[i][j] = cosine(v_i, v_j).
 */
function buildGlobalPairwise(allSources) {
  const ids = allSources.map((s) => s.canonicalSourceId).sort();
  const vectors = new Map(allSources.map((s) => [s.canonicalSourceId, s.vector]));
  const matrix = ids.map((a) => ids.map((b) => cosineSimilarity(vectors.get(a), vectors.get(b))));
  return { ids, matrix };
}

// ---------------------------------------------------------------------------
// T12-I1 — main adapter entry
// ---------------------------------------------------------------------------

/**
 * Build the exact input of selectResearchCorpus from a REAL SEAM A manifest
 * + its verified per-group artifacts + caller-supplied embeddings.
 *
 * @param {object} args
 *   manifest                 SEAM A ResearchCorpusManifest (validated fail-closed).
 *   artifactsRoot            local root the manifest's answersRel refs resolve against.
 *   embeddingsBySourceId     { [canonicalSourceId]: { vector, identity } }.
 *   targetEmbeddingByGroupId { [groupId]: { vector, identity } }.
 * @returns {{ sourcesByGroup, denseSignals, densePairwise, options }}
 *   exactly the selectResearchCorpus input face; options.mode stays undefined
 *   and options.mmr stays undefined (MMR OFF by default).
 */
export function buildSelectorInput({
  manifest,
  artifactsRoot,
  embeddingsBySourceId,
  targetEmbeddingByGroupId,
} = {}) {
  validateSeamAManifestOrThrow(manifest);
  if (typeof artifactsRoot !== 'string' || artifactsRoot.length === 0) {
    failClosed('RCE_ADAPTER_INPUT_INVALID', 'artifactsRoot must be a non-empty string');
  }
  if (!isPlainObject(embeddingsBySourceId) || !isPlainObject(targetEmbeddingByGroupId)) {
    failClosed('RCE_ADAPTER_INPUT_INVALID', 'embeddingsBySourceId and targetEmbeddingByGroupId must be objects');
  }

  const sourcesByGroup = {};
  const denseSignals = {};
  const allSources = []; // { canonicalSourceId, vector } for the global pairwise geometry
  const seenGlobal = new Set(); // canonicalSourceId -> fail closed on cross-group duplicate

  for (const mGroup of manifest.groups) {
    const { groupId, answersRel } = mGroup;

    // Decompose the VERIFIED group artifact; missing file / hash mismatch → fail closed.
    const answersAbs = resolveWorkRelative(artifactsRoot, answersRel);
    let raw;
    try {
      raw = fs.readFileSync(answersAbs);
    } catch {
      failClosed('RCE_ADAPTER_ARTIFACT_MISSING', `verified artifact missing for group ${groupId} (fail closed)`, { answersRel });
    }
    const actualHash = sha256Hex(raw);
    if (actualHash !== mGroup.answersHash) {
      failClosed('RCE_ADAPTER_ARTIFACT_HASH_MISMATCH', `answers.json content hash mismatch for group ${groupId} (fail closed)`, { answersRel });
    }
    let parsed;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      failClosed('RCE_ADAPTER_ARTIFACT_MALFORMED', `answers.json is not valid JSON for group ${groupId}`, { answersRel });
    }
    const entries = parsed?.answers;
    if (!Array.isArray(entries) || entries.length === 0) {
      failClosed('RCE_ADAPTER_ARTIFACT_MALFORMED', `answers.json must carry a non-empty answers[] for group ${groupId}`, { answersRel });
    }

    const candidates = [];
    const seenInGroup = new Set();
    for (const entry of entries) {
      if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
        failClosed('RCE_ADAPTER_ARTIFACT_MALFORMED', `every answers[] entry needs a non-empty string id (canonical source key) for group ${groupId}`, { answersRel });
      }
      const cid = deriveCanonicalSourceId(groupId, entry.id);
      if (seenInGroup.has(cid)) {
        failClosed('RCE_ADAPTER_INPUT_INVALID', `duplicate answer id within group ${groupId} (malformed decomposition)`, { answersRel });
      }
      if (seenGlobal.has(cid)) {
        failClosed('RCE_DUPLICATE_CANONICAL_SOURCE_ID', `canonicalSourceId ${cid} appears under multiple groups (fail closed)`, { groupId });
      }
      seenInGroup.add(cid);
      seenGlobal.add(cid);

      const emb = embeddingOrThrow(embeddingsBySourceId, cid, 'candidate source');
      candidates.push({
        canonicalSourceId: cid,
        contentHash: computeAnswerEntryContentHash(entry),
        // SEAM B CANONICAL_CONTENT_LOCATION: refs only, no content duplication.
        verifiedArtifactRef: answersRel,
        vector: emb.vector,
        identity: emb.identity,
      });
      allSources.push({ canonicalSourceId: cid, vector: emb.vector });
    }

    // T11 dense geometry per group: target = the group's research intent.
    const target = embeddingOrThrow(targetEmbeddingByGroupId, groupId, 'group target');
    const geometry = computeDenseGeometry({
      target: { id: groupId, vector: target.vector, identity: target.identity },
      items: candidates.map((c) => ({ id: c.canonicalSourceId, vector: c.vector, identity: c.identity })),
    });
    for (const sig of geometry.signals) {
      denseSignals[sig.id] = { relevance: sig.relevance, novelty: sig.novelty, redundancy: sig.redundancy };
    }

    // strip embedding internals — the selector only consumes the ref triple
    sourcesByGroup[groupId] = candidates.map(({ vector, identity, ...ref }) => ref);
  }

  const densePairwise = buildGlobalPairwise(allSources);

  // options: keep mode / mmr undefined (selector defaults; MMR OFF)
  return { sourcesByGroup, denseSignals, densePairwise, options: {} };
}

// ---------------------------------------------------------------------------
// T12-I3 — T07 Hook 3 thin adapter
// ---------------------------------------------------------------------------

/**
 * Map a SEAM B artifact's corpus accounting onto the frozen T07 Hook 3
 * updateSelectionAccounting payload and apply it to a CoverageState.
 *
 * Faithful mapping (Hook 3 accepted keys only — mappedSourceSet /
 * analyzedSourceSet / retrieval are NEVER written; the hook rejects them and
 * they are owned by T13 / T06):
 *   selectedCorpusSourceSet      ← flattened selected canonicalSourceIds
 *   selected_source_group_count  ← corpus.groups.length
 *   selected_content_by_group    ← { [groupId]: accounting.selected }
 *   per_group_selection_coverage ← { [groupId]: accounting.selected / accounting.eligible }
 *   largest_group_share          ← max group selected share of totals.selected
 *
 * coverage-state.mjs itself is NOT modified; the caller token is forwarded
 * verbatim and must be the OWNER_T12_SELECTION ('T12') token the hook asserts.
 *
 * @param {object} state   ResearchCoverageState (frozen T07 contract)
 * @param {object} artifact SEAM B Selected Verified Research Corpus
 * @param {{ caller: string }} opts caller token; 'T12' required by Hook 3
 * @returns {object} next validated CoverageState (hook return value)
 */
export function applySelectionAccountingToCoverageState(state, artifact, { caller } = {}) {
  // fail closed on any malformed artifact BEFORE touching the state
  verifySelectedResearchCorpus(artifact);

  const groups = artifact.corpus.groups;
  const totals = artifact.corpus.totals;
  const selectedCorpusSourceSet = [];
  const selectedContentByGroup = {};
  const perGroupSelectionCoverage = {};
  let largestGroupShare = 0;

  for (const g of groups) {
    const { groupId } = g;
    for (const ref of g.selectedSourceRefs) {
      selectedCorpusSourceSet.push(ref.canonicalSourceId);
    }
    selectedContentByGroup[groupId] = g.accounting.selected;
    perGroupSelectionCoverage[groupId] = g.accounting.eligible > 0
      ? g.accounting.selected / g.accounting.eligible
      : 0;
    const share = totals.selected > 0 ? g.accounting.selected / totals.selected : 0;
    if (share > largestGroupShare) largestGroupShare = share;
  }

  const update = {
    selectedCorpusSourceSet,
    selected_source_group_count: groups.length,
    selected_content_by_group: selectedContentByGroup,
    per_group_selection_coverage: perGroupSelectionCoverage,
    largest_group_share: largestGroupShare,
  };

  return updateSelectionAccounting(state, update, { caller });
}

// ---------------------------------------------------------------------------
// T12 real gate — downstream artifact writer (LOCAL-ONLY)
// ---------------------------------------------------------------------------

/**
 * Write the real SEAM B artifact for the downstream T13 real gate.
 * LOCAL-ONLY: the output lives under work/ (gitignored); real captured
 * content must never be committed into the repo.
 *
 * @param {object} artifact SEAM B artifact (verifySelectedResearchCorpus-checked)
 * @param {{ outPath?: string }} opts explicit output file path
 * @returns {string} the written file path
 */
export function writeRealSeamBArtifact(artifact, { outPath } = {}) {
  verifySelectedResearchCorpus(artifact);
  if (typeof outPath !== 'string' || outPath.length === 0) {
    failClosed('RCE_ADAPTER_INPUT_INVALID', 'writeRealSeamBArtifact requires an explicit outPath');
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return outPath;
}
