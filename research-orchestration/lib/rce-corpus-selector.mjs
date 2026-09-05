// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/rce-corpus-selector.mjs
 *
 * P1-T12 — RCE Corpus Selector (Issue #44; Spec §3 / §1.1 / §9.2).
 *
 * INPUT  = SEAM A ResearchCorpusManifest (T09 producer contract,
 *          P1_SEAM_CONTRACTS_V1 §SEAM A, T09_TO_T12_V1)
 *          + per-group eligible source candidates decomposed from the verified
 *            group artifacts (canonicalSourceId + contentHash pairs; the exact
 *            per-source decomposition is caller-owned, the verified provenance
 *            is NOT — verifiedArtifactRef is derived exclusively from the
 *            manifest's verified answersRel)
 *          + dense geometry signals from lib/dense-geometry.mjs (T11):
 *            { [canonicalSourceId]: { relevance, novelty, redundancy } }
 *
 * OUTPUT = SEAM B Selected Verified Research Corpus (T12_TO_T13_V1), exactly:
 *          { seam, seamVersion, planHash, selectedCorpusIdentity, corpus:
 *            { groups: [{ groupId, selectedSourceRefs[], accounting }],
 *              totals } }
 *          The output satisfies the frozen validator
 *          (test/helpers/p1-seam-contracts.mjs validateSelectedResearchCorpus)
 *          and is self-audited (verifySelectedResearchCorpus) before return.
 *
 * Frozen baseline policy (Spec §3, RCE_DESIGN_AMENDMENT_01):
 *   Question/Source-group Preservation + Popularity Anchor (NON-authoritative)
 *   + Dense Relevance/Novelty + Optional Lightweight Redundancy (MMR, default
 *   OFF, explicit flag).
 *
 * Hard contracts:
 *   - Preservation (§3.1): every verified manifest group with >=1 eligible
 *     source keeps >=1 selected source (anti-starvation floor = 1, invariant-
 *     first per D-5); a group with zero eligible sources is unrepresentable →
 *     fail closed. Per-group selection is independent: a large group can never
 *     reduce a small group's selection.
 *   - Popularity Anchor (§3.1/§3.2): answer count is never a truth weight. It
 *     does not enter the score, the ordering, the exclusion decisions, or the
 *     corpus identity. It may be REPORTED downstream (discussion volume) but
 *     this module neither consumes nor emits it as weight.
 *   - Dense Relevance/Novelty: every eligible source REQUIRES a valid dense
 *     signal (T11); missing → fail closed (RCE_DENSE_SIGNAL_MISSING). There is
 *     NO popularity-only fallback (Spec §10.2: popularity-anchor-only is not a
 *     legal peer option).
 *   - MMR optional (§3.2): default OFF. When enabled it REQUIRES pairwise
 *     similarity geometry (no silent degraded mode) and stays deterministic.
 *   - canonicalSourceId global uniqueness: the same canonicalSourceId under two
 *     different manifest groups fails closed (RCE_DUPLICATE_CANONICAL_SOURCE_ID)
 *     — denseSignals are keyed globally by canonicalSourceId, so a cross-group
 *     duplicate would silently share one dense signal.
 *   - verified-only (§SEAM B invariant 5): a source under a groupId outside the
 *     manifest, or with malformed identity fields, fails closed
 *     (SEAM_B_UNVERIFIED_SOURCE_REF).
 *   - Mode identity (§1.1 / §SEAM B invariant 3): selection never masquerades
 *     as top-percent-analysis or sampled mode (SEAM_B_MODE_IDENTITY_CONFLICT).
 *   - analyzed single-writer (Ticket Graph §B): no `analyzed` field may pass
 *     through input or appear in output (SEAM_B_ANALYZED_FIELD_FORBIDDEN);
 *     analyzed accounting is owned by P1-T13.
 *   - Exclusion accounting (§3.1/§SEAM B invariant 1): every excluded eligible
 *     source carries a reason category; selected <= verified <= eligible per
 *     group and in totals; enforced mechanically and re-checked fail-closed
 *     (SEAM_B_MISSING_EXCLUSION_REASON) before returning.
 *   - Identity determinism (§SEAM B IDENTITY_FIELDS): selectedCorpusIdentity is
 *     the sha256 over the canonical (key-sorted) JSON of the planHash and the
 *     order-normalized selected source sets — byte-identical for identical
 *     inputs, input-order independent.
 *
 * D-4/D-5 provisional defaults (OPEN decisions delegated to T12 implementation
 * validation — P1_TICKET_GRAPH_V1; numbers are exported, documented tunables,
 * NOT silent inline constants; see docs/planning/P1_T12_CONTRACT_EXTRACTION.md):
 *   DEFAULT_RELEVANCE_FLOOR = 0      (natural boundary: non-negative semantic
 *                                    relevance required; not an invented value)
 *   DEFAULT_NOVELTY_WEIGHT  = 0.25   (D-4 provisional; implementation validation)
 *   DEFAULT_MMR_LAMBDA      = 0.7    (D-4 provisional; classic MMR trade-off)
 *   DEFAULT_NEAR_DUPLICATE_SIMILARITY = 0.95 (D-4 provisional; redundancy gate)
 *
 * Pure, offline, deterministic. No network, no credentials, no I/O.
 */

import crypto from 'node:crypto';

import { DENSE_SIMILARITY_EPSILON } from './dense-geometry.mjs';

// ---------------------------------------------------------------------------
// constants / tunables
// ---------------------------------------------------------------------------

/** Distinct mode identity — selection never poses as top-percent-analysis/sampled. */
export const RCE_SELECTOR_MODE = 'rce-corpus-selection';

export const SEAM_ID = 'T12_TO_T13';
export const SEAM_VERSION = 1;

/** §3.1: non-negative semantic relevance required (natural boundary, D-5). */
export const DEFAULT_RELEVANCE_FLOOR = 0;
/** D-4 provisional: novelty contribution to the ranking score. */
export const DEFAULT_NOVELTY_WEIGHT = 0.25;
/** D-4 provisional: MMR relevance/redundancy trade-off (enabled mode only). */
export const DEFAULT_MMR_LAMBDA = 0.7;
/** D-4 provisional: pairwise similarity above which a source is a near-duplicate. */
export const DEFAULT_NEAR_DUPLICATE_SIMILARITY = 0.95;

/** §3.1 exclusion reason vocabulary (V1; new categories = V1-compatible). */
export const EXCLUSION_BELOW_RELEVANCE_FLOOR = 'belowRelevanceFloor';
export const EXCLUSION_NEAR_DUPLICATE = 'nearDuplicate';

/** Mode labels a T12 artifact must never carry (§1.1 STOP condition). */
const FORBIDDEN_MODE_VALUES = ['top-percent-analysis', 'sampled'];
/** Keys through which a masquerading mode identity could travel. */
const MODE_IDENTITY_KEYS = ['mode', 'analysisMode', 'samplingMode'];
/** analyzed accounting is owned by P1-T13 — forbidden anywhere in T12 artifacts. */
const ANALYZED_FIELD = 'analyzed';

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
const PLAN_HASH = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// error type
// ---------------------------------------------------------------------------

export class RceSelectorError extends Error {
  constructor(code, message, { details = null } = {}) {
    super(message);
    this.name = 'RceSelectorError';
    this.code = code;
    this.details = details;
  }
}

function failClosed(code, message, details = null) {
  throw new RceSelectorError(code, message, { details });
}

// ---------------------------------------------------------------------------
// deterministic canonical JSON (same hash domain as the frozen validator and
// the real T09 producer: recursively key-sorted, JSON.stringify leaf semantics)
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

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Recursively report paths of forbidden (key → value-matching) occurrences. */
function walkMatches(value, predicate, prefix = '') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...walkMatches(item, predicate, `${prefix}[${i}]`)));
    return found;
  }
  if (!isPlainObject(value)) return found;
  for (const [key, child] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (predicate(key, child)) found.push(p);
    found.push(...walkMatches(child, predicate, p));
  }
  return found;
}

// ---------------------------------------------------------------------------
// input validation (fail closed)
// ---------------------------------------------------------------------------

function validateManifest(manifest) {
  if (!isPlainObject(manifest)) failClosed('RCE_MANIFEST_INVALID', 'SEAM A manifest must be an object');
  if (manifest.type !== 'research-corpus-manifest' || manifest.schemaVersion !== 1) {
    failClosed('RCE_MANIFEST_INVALID', 'SEAM A manifest type/schemaVersion mismatch');
  }
  if (!PLAN_HASH.test(manifest.planHash || '')) {
    failClosed('RCE_MANIFEST_INVALID', 'SEAM A manifest planHash missing or malformed');
  }
  if (!Array.isArray(manifest.groups) || manifest.groups.length === 0) {
    failClosed('RCE_MANIFEST_INVALID', 'SEAM A manifest groups must be a non-empty array (zero verified groups is a terminal producer state, not a consumable artifact)');
  }
  for (const g of manifest.groups) {
    if (!isPlainObject(g) || typeof g.groupId !== 'string' || g.groupId.length === 0
      || typeof g.answersRel !== 'string' || g.answersRel.length === 0) {
      failClosed('RCE_MANIFEST_INVALID', 'SEAM A manifest group identity/refs invalid');
    }
  }
}

/**
 * Reject analyzed-field smuggling (T13 single-writer ownership) and mode
 * masquerade attempts travelling inside the INPUT payloads.
 */
function assertInputOwnershipClean(payload) {
  const analyzed = walkMatches(payload, (key) => key === ANALYZED_FIELD);
  if (analyzed.length > 0) {
    failClosed('SEAM_B_ANALYZED_FIELD_FORBIDDEN', 'analyzed accounting is owned by P1-T13; it must not travel through T12 input', { paths: analyzed });
  }
  const masquerade = walkMatches(
    payload,
    (key, value) => MODE_IDENTITY_KEYS.includes(key) && FORBIDDEN_MODE_VALUES.includes(value),
  );
  if (masquerade.length > 0) {
    failClosed('SEAM_B_MODE_IDENTITY_CONFLICT', 'selection must not carry a top-percent-analysis / sampled mode identity', { paths: masquerade });
  }
}

function validateSourceRef(source, groupId) {
  if (!isPlainObject(source)) failClosed('RCE_INPUT_INVALID', `source under group ${groupId} must be an object`);
  if (typeof source.canonicalSourceId !== 'string' || source.canonicalSourceId.length === 0
    || !SHA256_REF.test(source.contentHash || '')) {
    failClosed('SEAM_B_UNVERIFIED_SOURCE_REF', 'eligible source lacks a stable canonicalSourceId + sha256 contentHash pair (verified provenance required)', { groupId });
  }
}

function validateDenseSignal(signal, sourceId) {
  if (!isPlainObject(signal)) {
    failClosed('RCE_DENSE_SIGNAL_MISSING', `no dense geometry signal for eligible source ${sourceId} (no popularity-only fallback exists)`);
  }
  const { relevance, novelty, redundancy } = signal;
  if (!isFiniteNumber(relevance) || relevance < -1 || relevance > 1) {
    failClosed('RCE_DENSE_SIGNAL_INVALID', `dense relevance out of domain for ${sourceId}`);
  }
  for (const [name, v] of [['novelty', novelty], ['redundancy', redundancy]]) {
    if (!isFiniteNumber(v) || v < 0 || v > 1) {
      failClosed('RCE_DENSE_SIGNAL_INVALID', `dense ${name} out of domain for ${sourceId}`);
    }
  }
}

/**
 * Pairwise similarity lookup for MMR mode, consumed from T11's
 * computeDenseGeometry output shape: { ids: string[], matrix: number[][] }.
 */
function buildPairwiseLookup(densePairwise) {
  if (!isPlainObject(densePairwise) || !Array.isArray(densePairwise.ids) || !Array.isArray(densePairwise.matrix)) {
    failClosed('RCE_MMR_PAIRWISE_MISSING', 'MMR requires pairwise similarity geometry (T11 pairwiseSimilarity); none provided');
  }
  const { ids, matrix } = densePairwise;
  const index = new Map(ids.map((id, i) => [id, i]));
  const lookup = new Map();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = 0; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (a === b) continue;
      const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      lookup.set(key, matrix[i][j]);
    }
  }
  return {
    similarity(a, b) {
      if (a === b) return 1;
      const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      if (!lookup.has(key)) {
        failClosed('RCE_MMR_PAIRWISE_MISSING', `pairwise similarity missing for candidate pair (${a}, ${b})`);
      }
      return lookup.get(key);
    },
  };
}

// ---------------------------------------------------------------------------
// selection policy (frozen baseline, deterministic)
// ---------------------------------------------------------------------------

function rankCandidates(candidates, noveltyWeight) {
  // score = dense relevance + D-4 provisional novelty weight; popularity is
  // NEVER part of the score (§3.1: answer count is not a truth weight).
  const scored = candidates.map((c) => ({
    ...c,
    score: c.signal.relevance + noveltyWeight * c.signal.novelty,
  }));
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > DENSE_SIMILARITY_EPSILON) return b.score - a.score;
    return a.canonicalSourceId < b.canonicalSourceId ? -1 : a.canonicalSourceId > b.canonicalSourceId ? 1 : 0;
  });
  return scored;
}

/**
 * Greedy lightweight MMR (optional redundancy control, Spec §3.2):
 * iteratively picks argmax(lambda*relevance - (1-lambda)*maxSim-to-selected).
 * Ties broken deterministically by canonicalSourceId ASC. A remaining candidate
 * whose max similarity to the selected set is >= nearDuplicateSimilarity is
 * excluded as nearDuplicate instead of being selected. The first (preservation)
 * candidate is always selected.
 */
function applyMmr(candidates, pairwise, { lambda, nearDuplicateSimilarity }) {
  const remaining = [...candidates];
  const selected = [];
  const excluded = [];
  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    let bestMaxSim = 0;
    for (let i = 0; i < remaining.length; i += 1) {
      const c = remaining[i];
      let maxSim = 0;
      for (const s of selected) {
        const sim = pairwise.similarity(c.canonicalSourceId, s.canonicalSourceId);
        if (sim > maxSim) maxSim = sim;
      }
      const mmrScore = lambda * c.signal.relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore + DENSE_SIMILARITY_EPSILON
        || (Math.abs(mmrScore - bestScore) <= DENSE_SIMILARITY_EPSILON
          && bestIdx >= 0
          && c.canonicalSourceId < remaining[bestIdx].canonicalSourceId)) {
        bestScore = mmrScore;
        bestIdx = i;
        bestMaxSim = maxSim;
      }
    }
    const pick = remaining[bestIdx];
    if (selected.length > 0 && bestMaxSim >= nearDuplicateSimilarity) {
      excluded.push({ source: pick, category: EXCLUSION_NEAR_DUPLICATE });
    } else {
      selected.push(pick);
    }
    remaining.splice(bestIdx, 1);
  }
  return { selected, excluded };
}

// ---------------------------------------------------------------------------
// main entry
// ---------------------------------------------------------------------------

/**
 * Select the SEAM B Selected Verified Research Corpus from a SEAM A manifest
 * + per-group eligible sources + dense geometry signals.
 *
 * @param {object} args
 *   manifest        SEAM A ResearchCorpusManifest (producer contract input).
 *   sourcesByGroup  { [groupId]: [{ canonicalSourceId, contentHash, ... }] } —
 *                   eligible candidates decomposed from the VERIFIED group
 *                   artifacts. groupIds outside the manifest fail closed.
 *   denseSignals    { [canonicalSourceId]: { relevance, novelty, redundancy } }
 *                   from T11 dense geometry; required for every eligible source.
 *   densePairwise   optional { ids, matrix } (T11 pairwiseSimilarity output);
 *                   REQUIRED when options.mmr.enabled.
 *   options         { mode?, relevanceFloor?, noveltyWeight?, mmr?:
 *                     { enabled=false, lambda?, nearDuplicateSimilarity? } }
 * @returns {object} SEAM B artifact (frozen OUTPUT_OBSERVABLE_SHAPE).
 */
export function selectResearchCorpus({
  manifest,
  sourcesByGroup,
  denseSignals,
  densePairwise = null,
  options = {},
} = {}) {
  validateManifest(manifest);
  if (!isPlainObject(sourcesByGroup) || !isPlainObject(denseSignals)) {
    failClosed('RCE_INPUT_INVALID', 'sourcesByGroup and denseSignals must be objects');
  }
  if (!isPlainObject(options)) failClosed('RCE_INPUT_INVALID', 'options must be an object');
  const { mode, relevanceFloor = DEFAULT_RELEVANCE_FLOOR, noveltyWeight = DEFAULT_NOVELTY_WEIGHT, mmr } = options;
  if (mode !== undefined && mode !== RCE_SELECTOR_MODE) {
    failClosed('SEAM_B_MODE_IDENTITY_CONFLICT', `selection refuses to run under a foreign mode identity (expected ${RCE_SELECTOR_MODE})`);
  }
  if (!isFiniteNumber(relevanceFloor)) failClosed('RCE_INPUT_INVALID', 'relevanceFloor must be a finite number');
  if (!isFiniteNumber(noveltyWeight)) failClosed('RCE_INPUT_INVALID', 'noveltyWeight must be a finite number');
  const mmrEnabled = mmr?.enabled === true;
  const mmrOptions = {
    lambda: mmr?.lambda ?? DEFAULT_MMR_LAMBDA,
    nearDuplicateSimilarity: mmr?.nearDuplicateSimilarity ?? DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  };
  if (!isFiniteNumber(mmrOptions.lambda) || mmrOptions.lambda <= 0 || mmrOptions.lambda >= 1) {
    failClosed('RCE_INPUT_INVALID', 'mmr.lambda must be a finite number in (0,1)');
  }
  if (!isFiniteNumber(mmrOptions.nearDuplicateSimilarity) || mmrOptions.nearDuplicateSimilarity <= 0 || mmrOptions.nearDuplicateSimilarity > 1) {
    failClosed('RCE_INPUT_INVALID', 'mmr.nearDuplicateSimilarity must be a finite number in (0,1]');
  }
  assertInputOwnershipClean({ sourcesByGroup, denseSignals, options });

  const pairwise = mmrEnabled ? buildPairwiseLookup(densePairwise) : null;
  const manifestGroupIds = new Set(manifest.groups.map((g) => g.groupId));

  // verified-only: any candidate under a group outside the SEAM A manifest has
  // no verified provenance → fail closed (§SEAM B invariant 5).
  for (const groupId of Object.keys(sourcesByGroup)) {
    if (!manifestGroupIds.has(groupId)) {
      failClosed('SEAM_B_UNVERIFIED_SOURCE_REF', `candidate sources reference groupId outside the SEAM A verified manifest`, { groupId });
    }
  }

  const groups = [];
  // canonicalSourceId is required GLOBALLY unique across groups: denseSignals
  // are keyed by canonicalSourceId alone, so the same id under two groups would
  // silently share one dense signal (fail closed, reviewer round 1 F1).
  const seenSourceOwner = new Map(); // canonicalSourceId -> groupId
  for (const mGroup of manifest.groups) {
    const groupId = mGroup.groupId;
    const rawSources = sourcesByGroup[groupId];
    // §3.1: a verified group with no eligible source cannot be represented in a
    // SEAM B artifact (selectedSourceRefs must be non-empty) — fail closed
    // instead of emitting an unrepresentable/starved corpus.
    if (!Array.isArray(rawSources) || rawSources.length === 0) {
      failClosed('RCE_PRESERVATION_UNREPRESENTABLE', `verified group ${groupId} has zero eligible sources; preservation cannot be satisfied (fail closed)`, { groupId });
    }

    // dedupe + validate; duplicates are a malformed decomposition, never silently merged
    const byId = new Map();
    for (const s of rawSources) {
      validateSourceRef(s, groupId);
      if (byId.has(s.canonicalSourceId)) {
        failClosed('RCE_INPUT_INVALID', `duplicate canonicalSourceId ${s.canonicalSourceId} in group ${groupId}`);
      }
      const priorGroup = seenSourceOwner.get(s.canonicalSourceId);
      if (priorGroup !== undefined) {
        failClosed('RCE_DUPLICATE_CANONICAL_SOURCE_ID',
          `canonicalSourceId ${s.canonicalSourceId} appears under multiple groups (${priorGroup}, ${groupId}); denseSignals are keyed globally, so a cross-group duplicate would silently share one dense signal`,
          { canonicalSourceId: s.canonicalSourceId, groups: [priorGroup, groupId] });
      }
      seenSourceOwner.set(s.canonicalSourceId, groupId);
      const sig = denseSignals[s.canonicalSourceId];
      validateDenseSignal(sig, s.canonicalSourceId);
      byId.set(s.canonicalSourceId, { ...s, signal: sig });
    }
    const eligibleCount = byId.size;

    // relevance floor (D-5 numeric: natural non-negative boundary)
    const ranked = rankCandidates([...byId.values()], noveltyWeight);
    const kept = ranked.filter((c) => c.signal.relevance >= relevanceFloor);
    const floorExcluded = ranked.length - kept.length;
    let selected = kept;
    const exclusions = {};
    if (floorExcluded > 0) exclusions[EXCLUSION_BELOW_RELEVANCE_FLOOR] = floorExcluded;

    if (selected.length === 0) {
      // §3.1 anti-starvation: the group's best source is preserved even when
      // every source is below the floor (never silently zero-represented).
      selected = [ranked[0]];
      exclusions[EXCLUSION_BELOW_RELEVANCE_FLOOR] = eligibleCount - 1;
    } else if (mmrEnabled && selected.length > 1) {
      const mmrResult = applyMmr(selected, pairwise, mmrOptions);
      selected = mmrResult.selected;
      for (const e of mmrResult.excluded) {
        exclusions[e.category] = (exclusions[e.category] || 0) + 1;
      }
    }

    const selectedRefs = selected
      .slice()
      .sort((a, b) => (a.canonicalSourceId < b.canonicalSourceId ? -1 : a.canonicalSourceId > b.canonicalSourceId ? 1 : 0))
      .map((c) => ({
        canonicalSourceId: c.canonicalSourceId,
        contentHash: c.contentHash,
        // verified provenance derived EXCLUSIVELY from the SEAM A manifest —
        // a selected source can only point at its group's verified artifact.
        verifiedArtifactRef: mGroup.answersRel,
      }));

    groups.push({
      groupId,
      selectedSourceRefs: selectedRefs,
      accounting: {
        eligible: eligibleCount,
        selected: selectedRefs.length,
        // PINNED READING (§SEAM B accounting): verified := selected.
        // §SEAM B permits selected <= verified <= eligible; the alternative
        // reading (verified := eligible, since every eligible candidate
        // decomposes from verified group artifacts) is equally valid. Which
        // reading governs T07/T15 reconciliation is a PRODUCT-OWNER decision,
        // not an implementation choice — a silent change here must fail the
        // pinning test loudly (reviewer round 1 F2).
        verified: selectedRefs.length, // verified-only: every selected source is verified
        exclusionReasonCategories: exclusions,
      },
    });
  }

  const totals = {
    eligible: 0,
    selected: 0,
    verified: 0,
    exclusionReasonCategories: {},
  };
  for (const g of groups) {
    totals.eligible += g.accounting.eligible;
    totals.selected += g.accounting.selected;
    totals.verified += g.accounting.verified;
    for (const [k, n] of Object.entries(g.accounting.exclusionReasonCategories)) {
      totals.exclusionReasonCategories[k] = (totals.exclusionReasonCategories[k] || 0) + n;
    }
  }

  // canonical, order-independent identity over the selected verified source set
  const identityPayload = {
    planHash: manifest.planHash,
    groups: groups.map((g) => ({
      groupId: g.groupId,
      selectedSourceRefs: g.selectedSourceRefs,
    })).sort((a, b) => (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0)),
  };

  const artifact = {
    seam: SEAM_ID,
    seamVersion: SEAM_VERSION,
    planHash: manifest.planHash,
    selectedCorpusIdentity: `sha256:${sha256Hex(canonicalJson(identityPayload))}`,
    corpus: { groups, totals },
  };

  // fail-closed self-audit before return (mechanically redundant by
  // construction; kept as the frozen SEAM B invariant gate)
  verifySelectedResearchCorpus(artifact);
  return artifact;
}

// ---------------------------------------------------------------------------
// fail-closed self-audit (frozen §SEAM B FAIL_CLOSED semantics)
// ---------------------------------------------------------------------------

function sha256RefOk(v) {
  return typeof v === 'string' && SHA256_REF.test(v);
}

/**
 * Audit a candidate SEAM B artifact against the frozen fail-closed semantics
 * and throw RceSelectorError with the exact §SEAM B error codes:
 *   SEAM_B_MISSING_EXCLUSION_REASON  — excluded eligible source without reason
 *   SEAM_B_ANALYZED_FIELD_FORBIDDEN  — analyzed field anywhere (owner = T13)
 *   SEAM_B_UNVERIFIED_SOURCE_REF     — malformed / unprovenanced source ref
 *   SEAM_B_MODE_IDENTITY_CONFLICT    — top-percent-analysis / sampled masquerade
 * selectResearchCorpus runs this on its own output before returning.
 */
export function verifySelectedResearchCorpus(artifact) {
  if (!isPlainObject(artifact)) failClosed('RCE_INPUT_INVALID', 'SEAM B artifact must be an object');

  const analyzed = walkMatches(artifact, (key) => key === ANALYZED_FIELD);
  if (analyzed.length > 0) {
    failClosed('SEAM_B_ANALYZED_FIELD_FORBIDDEN', 'analyzed accounting is owned by P1-T13 (single writer); forbidden in a SEAM B artifact', { paths: analyzed });
  }
  const masquerade = walkMatches(
    artifact,
    (key, value) => MODE_IDENTITY_KEYS.includes(key) && FORBIDDEN_MODE_VALUES.includes(value),
  );
  if (masquerade.length > 0) {
    failClosed('SEAM_B_MODE_IDENTITY_CONFLICT', 'SEAM B artifact must never carry a top-percent-analysis / sampled mode identity', { paths: masquerade });
  }

  if (!isPlainObject(artifact.corpus) || !Array.isArray(artifact.corpus.groups) || artifact.corpus.groups.length === 0) {
    failClosed('RCE_OUTPUT_INVALID', 'SEAM B corpus.groups must be a non-empty array');
  }

  let totalEligible = 0;
  let totalSelected = 0;
  let totalVerified = 0;
  const totalCats = {};
  for (const g of artifact.corpus.groups) {
    const acc = g?.accounting;
    if (!isPlainObject(acc)) failClosed('RCE_OUTPUT_INVALID', `group ${g?.groupId} accounting missing`);
    const { eligible, selected, verified } = acc;
    if (![eligible, selected, verified].every((v) => Number.isInteger(v) && v >= 0)) {
      failClosed('RCE_OUTPUT_INVALID', `group ${g.groupId} accounting must be non-negative integers`);
    }
    if (!(selected <= verified && verified <= eligible)) {
      failClosed('RCE_OUTPUT_INVALID', `group ${g.groupId} violates selected <= verified <= eligible`);
    }
    if (!Array.isArray(g.selectedSourceRefs) || g.selectedSourceRefs.length !== selected) {
      failClosed('RCE_OUTPUT_INVALID', `group ${g.groupId} selectedSourceRefs must match the selected count`);
    }
    for (const ref of g.selectedSourceRefs) {
      if (!isPlainObject(ref) || typeof ref.canonicalSourceId !== 'string' || ref.canonicalSourceId.length === 0
        || !sha256RefOk(ref.contentHash) || typeof ref.verifiedArtifactRef !== 'string' || ref.verifiedArtifactRef.length === 0) {
        failClosed('SEAM_B_UNVERIFIED_SOURCE_REF', 'selected source ref lacks canonicalSourceId + sha256 contentHash + verifiedArtifactRef', { groupId: g.groupId });
      }
    }
    const cats = acc.exclusionReasonCategories;
    if (!isPlainObject(cats)) {
      failClosed('SEAM_B_MISSING_EXCLUSION_REASON', `group ${g.groupId} exclusionReasonCategories missing (fail closed)`);
    }
    const catSum = Object.values(cats).reduce((s, n) => s + n, 0);
    if (!Object.values(cats).every((n) => Number.isInteger(n) && n >= 0) || eligible - selected !== catSum) {
      failClosed('SEAM_B_MISSING_EXCLUSION_REASON', `group ${g.groupId} has excluded eligible sources without a recorded reason category (fail closed)`);
    }
    totalEligible += eligible;
    totalSelected += selected;
    totalVerified += verified;
    for (const [k, n] of Object.entries(cats)) totalCats[k] = (totalCats[k] || 0) + n;
  }

  const totals = artifact.corpus.totals;
  if (!isPlainObject(totals)) failClosed('RCE_OUTPUT_INVALID', 'corpus.totals missing');
  if (totals.eligible !== totalEligible || totals.selected !== totalSelected || totals.verified !== totalVerified) {
    failClosed('RCE_OUTPUT_INVALID', 'corpus.totals must equal the per-group sums');
  }
  const totalsSum = Object.values(totals.exclusionReasonCategories || {}).reduce((s, n) => s + n, 0);
  if (totalEligible - totalSelected !== totalsSum) {
    failClosed('SEAM_B_MISSING_EXCLUSION_REASON', 'totals exclusion accounting incomplete (fail closed)');
  }
  return true;
}
