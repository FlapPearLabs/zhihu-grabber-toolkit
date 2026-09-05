// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/rce-provenance-adapter.mjs
 *
 * P1-T13 INTEGRATION ADAPTER (P1 WAVE 01 serial integration train, T13-I1/T13-I3).
 *
 * Ownership: P1-T13 (integration gate; reviewed T13 2503fd3 is an exact
 * ancestor). This module is the caller-owned PROVENANCE + AUTHOR-IDENTITY
 * layer between:
 *   - SEAM A  : real T09 ResearchCorpusManifest + verified per-group artifacts
 *               (answers.json / handoff.json under artifactsRoot, keyed by
 *               group.answersRel / group.handoffRel)
 *   - SEAM C  : the T13 composition (lib/group-representation.mjs +
 *               lib/per-group-claim-extraction.mjs) via its INJECTABLE seams:
 *                 canonicalGroupIdentityResolver (provenance authority, T13-I1)
 *                 sourceContentLoader            (controller-owned IO)
 *                 authorRefResolver              (author identity carrier, T13-I3)
 *
 * The injectable-resolver mechanism is UNCHANGED (frozen T13 reviewed design).
 * This module only WIRES it to the real controller-owned provenance authority:
 *
 *   questionId = manifest group questionId      (SEAM A authority)
 *   providerId = capture namespace from the answersRel prefix
 *                (first path segment of group.answersRel, e.g. 'zhihu' —
 *                derived from the artifact, never hardcoded)
 *   capability = handoff.json sourceType read via group.handoffRel
 *                (the handoff task must be 'digest' — the capture composition
 *                this integration qualifies; anything else is unresolvable)
 *
 * Any component unresolvable (missing field, missing/hash-mismatched artifact,
 * blank value) → FAIL CLOSED with a coded error. The resolver NEVER invents
 * values; per-group-claim-extraction.mjs additionally fail-closes
 * (SEAM_C_REPRESENTATION_CONFLICT) when a resolver returns a non-object.
 *
 * AUTHOR IDENTITY CARRIER (T13-I3, ratified SEAM C V1 amendment 2026-09-05):
 *   - authorRef = 'author-' + sha256('zhihu-author:' + trimmed exact author
 *     string)[:16] for a non-blank author value; null for missing/blank.
 *   - Same real author (same captured metadata value) → same authorRef
 *     everywhere (deterministic derivation). authorRef is a DERIVED IDENTITY
 *     REFERENCE, not canonical content; no credentials travel in it.
 *   - Identity resolves as far as the captured metadata supports
 *     (display-name-keyed lineage). null = author identity unresolvable from
 *     canonical metadata (DISCLOSED), never fabricated from sourceRef/content.
 *   - The MODEL NEVER CREATES authorRef: runtime output schema rejects the key
 *     (MODEL_FORBIDDEN_IDENTITY_KEYS in per-group-claim-extraction.mjs reuses
 *     the model-owned-identity rejection machinery); authorRef is
 *     controller-attached afterwards in the claim assembly path.
 *
 * The ONLY I/O: reading the manifest-referenced answers.json / handoff.json
 * artifacts (content + provenance loading). Everything else is pure and
 * deterministic. No network.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { deriveCanonicalSourceId } from './rce-input-adapter.mjs';

// ---------------------------------------------------------------------------
// error type
// ---------------------------------------------------------------------------

export class RceProvenanceAdapterError extends Error {
  constructor(code, message, { details = null } = {}) {
    super(message);
    this.name = 'RceProvenanceAdapterError';
    this.code = code;
    this.details = details;
  }
}

function failClosed(code, message, details = null) {
  throw new RceProvenanceAdapterError(code, message, { details });
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const HEX64 = /^[0-9a-f]{64}$/;
/** Frozen ratified shape: 'author-' + 16 lowercase hex chars (V1 amendment). */
export const AUTHOR_REF_PATTERN = /^author-[0-9a-f]{16}$/;
/** The capture composition this adapter qualifies (handoff.json task). */
const SUPPORTED_HANDOFF_TASK = 'digest';

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Work-relative ref guard: never absolute, never escaping the artifacts root. */
function resolveWorkRelative(root, rel, { groupId, kind }) {
  if (typeof rel !== 'string' || rel.length === 0 || path.isAbsolute(rel) || rel.split('/').includes('..')) {
    failClosed('RCE_PROVENANCE_INPUT_INVALID', `${kind} ref must be a work-relative string that does not escape the artifacts root (fail closed)`, { groupId, kind, ref: rel });
  }
  return path.join(root, rel);
}

/** Read + sha256-verify one manifest-referenced artifact against its manifest hash. */
function readVerifiedArtifact(root, group, { relKey, hashKey, kind }) {
  const abs = resolveWorkRelative(root, group[relKey], { groupId: group.groupId, kind });
  let raw;
  try {
    raw = fs.readFileSync(abs);
  } catch {
    failClosed('RCE_PROVENANCE_ARTIFACT_MISSING', `verified ${kind} artifact missing for group ${group.groupId} (fail closed)`, { groupId: group.groupId, rel: group[relKey] });
  }
  const actualHash = sha256Hex(raw);
  if (actualHash !== group[hashKey]) {
    failClosed('RCE_PROVENANCE_ARTIFACT_HASH_MISMATCH', `${kind} content hash mismatch for group ${group.groupId} — stale or tampered artifact (fail closed)`, { groupId: group.groupId, rel: group[relKey] });
  }
  return raw;
}

/**
 * Minimal fail-closed SEAM A sanity gate for THIS module's authority reads:
 * the manifest must carry the identity/refs/hashes this adapter dereferences.
 * (Full frozen-SEAM-A validation + manifestHash recomputation lives in the
 * SEAM B real conformance gate and the T12 adapter; this module re-derives
 * only what it consumes — it never widens the contract.)
 */
function validateManifestAuthorityOrThrow(manifest) {
  if (!isPlainObject(manifest)
    || manifest.type !== 'research-corpus-manifest'
    || manifest.schemaVersion !== 1) {
    failClosed('RCE_PROVENANCE_MANIFEST_INVALID', 'SEAM A manifest must be a research-corpus-manifest v1 object');
  }
  if (!Array.isArray(manifest.groups) || manifest.groups.length === 0) {
    failClosed('RCE_PROVENANCE_MANIFEST_INVALID', 'SEAM A manifest groups must be a non-empty array');
  }
  for (const g of manifest.groups) {
    if (!isPlainObject(g)
      || typeof g.groupId !== 'string' || g.groupId.length === 0
      || typeof g.questionId !== 'string' || g.questionId.length === 0
      || typeof g.answersRel !== 'string' || g.answersRel.length === 0
      || typeof g.handoffRel !== 'string' || g.handoffRel.length === 0
      || !HEX64.test(g.answersHash || '')
      || !HEX64.test(g.handoffHash || '')) {
      failClosed('RCE_PROVENANCE_MANIFEST_INVALID', `SEAM A manifest group identity/refs/hashes invalid for group ${g?.groupId ?? '?'}`);
    }
  }
}

/**
 * Load, hash-verify and index the REAL captured per-group artifacts.
 * Returns, per group: { groupId, questionId, providerId, capability,
 * entriesByCanonicalSourceId: Map(canonicalSourceId → answer entry) }.
 * Shared by the provenance resolver, the content loader and the authorRef
 * resolver so all three see the SAME verified decomposition (consistent with
 * rce-input-adapter's deriveCanonicalSourceId scheme).
 */
function loadRealGroupAuthorities({ manifest, artifactsRoot }) {
  validateManifestAuthorityOrThrow(manifest);
  if (typeof artifactsRoot !== 'string' || artifactsRoot.length === 0) {
    failClosed('RCE_PROVENANCE_INPUT_INVALID', 'artifactsRoot must be a non-empty string');
  }
  const groups = [];
  for (const mGroup of manifest.groups) {
    const { groupId, questionId, answersRel } = mGroup;

    // providerId = capture namespace from the answersRel prefix (artifact-derived).
    const namespace = answersRel.split('/')[0];
    if (!namespace || namespace.includes('.') || namespace !== namespace.trim()) {
      failClosed('RCE_PROVENANCE_UNRESOLVABLE', `capture namespace unresolvable from answersRel prefix for group ${groupId} (fail closed)`, { groupId, answersRel });
    }

    // capability = handoff.json sourceType (task must be the qualified composition).
    const handoffRaw = readVerifiedArtifact(artifactsRoot, mGroup, { relKey: 'handoffRel', hashKey: 'handoffHash', kind: 'handoff' });
    let handoff;
    try {
      handoff = JSON.parse(handoffRaw.toString('utf8'));
    } catch {
      failClosed('RCE_PROVENANCE_ARTIFACT_MALFORMED', `handoff.json is not valid JSON for group ${groupId}`, { groupId });
    }
    if (!isPlainObject(handoff) || handoff.task !== SUPPORTED_HANDOFF_TASK
      || typeof handoff.sourceType !== 'string' || handoff.sourceType.length === 0) {
      failClosed('RCE_PROVENANCE_UNRESOLVABLE', `capability unresolvable: handoff task must be '${SUPPORTED_HANDOFF_TASK}' with a non-empty sourceType for group ${groupId} (fail closed, no invention)`, { groupId, task: handoff?.task ?? null });
    }

    // Verified answer entries (content + captured author metadata authority).
    const answersRaw = readVerifiedArtifact(artifactsRoot, mGroup, { relKey: 'answersRel', hashKey: 'answersHash', kind: 'answers' });
    let parsed;
    try {
      parsed = JSON.parse(answersRaw.toString('utf8'));
    } catch {
      failClosed('RCE_PROVENANCE_ARTIFACT_MALFORMED', `answers.json is not valid JSON for group ${groupId}`, { groupId });
    }
    const entries = parsed?.answers;
    if (!Array.isArray(entries) || entries.length === 0) {
      failClosed('RCE_PROVENANCE_ARTIFACT_MALFORMED', `answers.json must carry a non-empty answers[] for group ${groupId}`, { groupId });
    }
    const entriesByCanonicalSourceId = new Map();
    for (const entry of entries) {
      if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
        failClosed('RCE_PROVENANCE_ARTIFACT_MALFORMED', `every answers[] entry needs a non-empty string id for group ${groupId}`, { groupId });
      }
      const cid = deriveCanonicalSourceId(groupId, entry.id);
      if (entriesByCanonicalSourceId.has(cid)) {
        failClosed('RCE_PROVENANCE_INPUT_INVALID', `duplicate answer id within group ${groupId} (malformed decomposition)`, { groupId });
      }
      entriesByCanonicalSourceId.set(cid, entry);
    }

    groups.push({
      groupId,
      questionId,
      providerId: namespace,
      capability: handoff.sourceType,
      entriesByCanonicalSourceId,
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// T13-I1 — real provenance resolver (controller-owned authority)
// ---------------------------------------------------------------------------

/**
 * Build the canonicalGroupIdentityResolver from the REAL controller-owned
 * provenance authority (SEAM A manifest + verified handoff.json artifacts).
 * The returned function maps groupId → { questionId, providerId, capability }
 * and FAILS CLOSED (coded) on any unresolvable group — values are never
 * invented. Wire into runPerGroupAnalysis / extractPerGroupClaims via the
 * existing canonicalGroupIdentityResolver injection point (mechanism unchanged).
 *
 * @param {{ manifest: object, artifactsRoot: string }} args
 * @returns {(groupId: string) => { questionId: string, providerId: string, capability: string }}
 */
export function buildRealProvenanceResolver({ manifest, artifactsRoot } = {}) {
  const groups = loadRealGroupAuthorities({ manifest, artifactsRoot });
  const byGroupId = new Map(groups.map((g) => [g.groupId, g]));
  return (groupId) => {
    const g = byGroupId.get(groupId);
    if (!g) {
      failClosed('RCE_PROVENANCE_UNRESOLVABLE', `canonicalGroupIdentity unresolvable for group ${String(groupId)} — not in the provenance authority (fail closed, no invention)`, { groupId });
    }
    return { questionId: g.questionId, providerId: g.providerId, capability: g.capability };
  };
}

// ---------------------------------------------------------------------------
// T13-I3 — author identity carrier (controller-attached, never model-owned)
// ---------------------------------------------------------------------------

/**
 * Controller-owned authorRef derivation (ratified SEAM C V1 amendment,
 * 2026-09-05). Non-blank author metadata → 'author-' + sha256('zhihu-author:'
 * + trimmed exact author string)[:16]; missing/blank → null (DISCLOSED
 * unresolvable identity — never fabricated from sourceRef or content).
 * Same captured author value → same authorRef everywhere (deterministic).
 *
 * @param {string|null|undefined} authorMetadata captured author display value
 * @returns {string|null} authorRef or null
 */
export function deriveAuthorRef(authorMetadata) {
  if (typeof authorMetadata !== 'string') return null;
  const trimmed = authorMetadata.trim();
  if (trimmed === '') return null;
  return `author-${sha256Hex(`zhihu-author:${trimmed}`).slice(0, 16)}`;
}

/**
 * Build the controller-injected authorRefResolver for the T13 composition:
 * canonicalSourceId → authorRef|null from the REAL captured author metadata.
 * Unknown canonicalSourceId → fail closed (a controller-side bug, not a
 * disclosed null); blank captured author → null (disclosed). The resolver
 * output is shape-checked again at the claim assembly site
 * (per-group-claim-extraction.mjs) so a garbage value can never reach SEAM C.
 *
 * @param {{ manifest: object, artifactsRoot: string }} args
 * @returns {(canonicalSourceId: string) => string|null}
 */
export function buildRealAuthorRefResolver({ manifest, artifactsRoot } = {}) {
  const groups = loadRealGroupAuthorities({ manifest, artifactsRoot });
  const authorRefBySourceId = new Map();
  for (const g of groups) {
    for (const [cid, entry] of g.entriesByCanonicalSourceId) {
      authorRefBySourceId.set(cid, deriveAuthorRef(entry.author));
    }
  }
  return (canonicalSourceId) => {
    if (!authorRefBySourceId.has(canonicalSourceId)) {
      failClosed('RCE_PROVENANCE_UNRESOLVABLE', `author metadata unresolvable for canonicalSourceId ${String(canonicalSourceId)} — not in the verified capture (fail closed)`, { canonicalSourceId });
    }
    return authorRefBySourceId.get(canonicalSourceId);
  };
}

// ---------------------------------------------------------------------------
// T13 real gate — controller-owned source content loader
// ---------------------------------------------------------------------------

/**
 * Build the controller-owned sourceContentLoader consumed by
 * extractPerGroupClaims: (verifiedArtifactRef, canonicalSourceId) → content.
 * Reads from the SAME hash-verified decomposition as the provenance and
 * authorRef resolvers. Missing/empty content → fail closed (the T13 module
 * already wraps loader errors into SEAM_C_SOURCE_FAILURE; this loader fails
 * closed first with coded detail).
 *
 * @param {{ manifest: object, artifactsRoot: string }} args
 * @returns {(verifiedArtifactRef: string, canonicalSourceId: string) => string}
 */
export function buildRealSourceContentLoader({ manifest, artifactsRoot } = {}) {
  const groups = loadRealGroupAuthorities({ manifest, artifactsRoot });
  const contentBySourceId = new Map();
  for (const g of groups) {
    for (const [cid, entry] of g.entriesByCanonicalSourceId) {
      contentBySourceId.set(cid, typeof entry.content === 'string' ? entry.content : '');
    }
  }
  return (_verifiedArtifactRef, canonicalSourceId) => {
    const content = contentBySourceId.get(canonicalSourceId);
    if (typeof content !== 'string' || content.trim() === '') {
      failClosed('RCE_PROVENANCE_SOURCE_CONTENT_MISSING', `source content missing/empty for ${String(canonicalSourceId)} (fail closed)`, { canonicalSourceId });
    }
    return content;
  };
}
