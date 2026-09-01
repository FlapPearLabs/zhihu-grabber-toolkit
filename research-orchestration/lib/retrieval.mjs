// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/retrieval.mjs
 *
 * P1-T06 — Multi-query retrieval + deterministic RRF candidate fusion →
 * Candidate/Retrieval Pool (single pass, fixtures).
 * (Approved Spec docs/specs/p1-cross-question-deep-research.md §5.4 / §6.2
 *  + §9.1 Retrieval Coverage; Issue #38.)
 *
 * Pipeline (single pass — NO iterative rounds, that is T07 scope):
 *   persisted validated Research Plan (query variants, planHash)
 *   → explicit retrieval-ranked provider channels (seam, capability=search)
 *   → deterministic RRF fusion (lib/rrf.mjs)
 *   → Candidate/Retrieval Pool artifact (retrieval-pool.json + poolHash)
 *
 * Channel identity (§5.4) = query identity + provider identity + capability
 * identity, preserved on every channel record and every fused rank.
 *
 * RRF is CANDIDATE FUSION ONLY: it never performs final corpus selection
 * (selection is a downstream controller authority, T08).
 *
 * Hard contracts (Issue #38 / Spec §10.2):
 *   - NO_SILENT_PROVIDER_FALLBACK: a failed provider is recorded with its
 *     machine-readable failure identity and never substituted; sibling channels
 *     execute exactly once and independently;
 *   - zero valid retrieval channel results → FAIL CLOSED (retrieval_no_valid_channel);
 *   - malformed provider result (seam UNKNOWN_PROVIDER_CONTRACT / fused-item
 *     rank/identity contract violation) → FAIL CLOSED
 *     (retrieval_provider_contract_invalid);
 *   - contradictory ok:true + top-level failure → FAIL CLOSED
 *     (retrieval_provider_contract_invalid) — narrow hasOwnProperty guard (P1-2);
 *   - within-channel duplicate questionId → FAIL CLOSED
 *     (retrieval_provider_contract_invalid) via the rrf hard error, independent
 *     of item array order (item-order-independence, P1-4);
 *   - provider failure diagnostics are SAFE-PROJECTED to their machine-readable
 *     { code, class } identity at the T06 boundary; raw detail / path-bearing /
 *     non-JSON-safe (BigInt/cyclic) payloads never reach output, the pool
 *     artifact, or serialization — including the all-failed early return (P1-1);
 *   - per-item rejected failure identities are projected through the SAME
 *     canonical projectFailure() as top-level channel failure identities —
 *     pool.rejected entries carry `failure: { code, class }` ONLY, never raw
 *     detail / stderr / arbitrary metadata / path-bearing / credential-shaped
 *     diagnostics (P1-1, review 5076691874);
 *   - ONE complete mechanically enforced provider/caller-controlled OUTPUT +
 *     PERSISTENCE boundary (review 5077286260): every provider/caller-controlled
 *     field that can reach pool.channels / pool.candidates / pool.rejected /
 *     returned machine-readable failures is projected into a safe canonical
 *     shape or fails closed via the shared lib/rrf.mjs boundary
 *     (projectSafeJson / projectRouteString / projectSourceUrlRecord /
 *     projectFailure / assertArtifactSafe) — no uncontrolled raw passthrough;
 *   - whole provider results are mechanically validated immediately after
 *     seam.retrieve() returns, BEFORE branching on ok (P2-1, review
 *     5077286260): null / undefined / primitive / malformed / contradictory
 *     results fail closed (retrieval_provider_contract_invalid), reusing the
 *     T05 §5.1 result validator — no raw TypeError/exception escape;
 *   - provider result identity is bound to the EXACT resolved registry/channel
 *     — provider_id + capability + auth_class must equal the registry-resolved
 *     identity, never the provider's self-declared values; a drifted result
 *     fails closed, and the persisted auth_class is the registry-bound value
 *     (P1, review 5078267886); registry entries must carry a valid authClass;
 *   - retrieved_at crosses the SAME bounded privacy-safe string gate as every
 *     provider-controlled string before entering channel records (P1 review
 *     5078267886);
 *   - the all-provider-failed early return retains channel + auth_class +
 *     retrievedAt + completeness + failure — every field already safely
 *     projected — so retrieval coverage remains auditable (P2, review
 *     5078267886);
 *   - source_url URL trust reuses the repository's existing classifyUrl
 *     classifier (no weaker parallel URL policy): https-only, no userinfo,
 *     localhost/loopback/private/link-local/CGNAT/multicast/reserved hosts
 *     rejected (P1, review 5078267886);
 *   - the credential-sensitive KEY-NAME deny rule also covers compound /
 *     camelCase forms (accessToken / refreshToken / clientSecret /
 *     sessionCookie / accessKeyId / ...) — direct + e2e counterexamples (P1,
 *     review 5078267886);
 *   - plan-validation issues are projected to stable schema paths before being
 *     returned (P1-3, review 5077286260): known plan-contract paths are
 *     preserved; caller-controlled unknown property names are replaced by the
 *     stable '<unknown>' placeholder and never echoed raw;
 *   - the entire pool artifact crosses an artifact-wide safety walk
 *     (assertArtifactSafe) BEFORE persistence as defense in depth — JSON-domain
 *     types, safe keys, bounded privacy-safe strings, no cycles; a violation
 *     fails closed (retrieval_provider_contract_invalid) with no artifact
 *     written;
 *   - completeness evidence crosses a deterministic T06 persistence boundary
 *     (P1-2, review 5076691874): the required completeness status is always
 *     preserved; evidence is persisted ONLY when it is mechanically safe
 *     (JSON-domain + safe keys incl. the bare credential-sensitive KEY-NAME
 *     deny rule, depth/length-bounded, free of machine-private path /
 *     credential-shaped strings, no non-plain/prototype-mutating objects —
 *     P1-2/P2-2 review 5077286260); evidence that cannot safely enter the
 *     persisted artifact FAILS CLOSED (retrieval_provider_contract_invalid) —
 *     never bare-stored, never silently dropped, never distorted;
 *   - seam.listProviders() is GUARDED (P2, review 5076691874): a throwing
 *     registry inspection, a malformed non-array registry, or malformed
 *     registry entries return a stable retrieval_provider_contract_invalid
 *     BEFORE any provider IO — no raw throw, no provider retrieval;
 *   - a caller-supplied planHash must match the plan-contract 64-lowercase-hex
 *     format; a malformed value fails closed and is NEVER echoed back (P1-3);
 *   - rejected observations are canonicalized by stable keys before persisting
 *     (permutation-invariant, P1-5);
 *   - auth_class is persisted as adapter-bound channel provenance (§5.1), never
 *     part of the RRF channel key (P2-3);
 *   - malformed top-level `channels` (non-array) → FAIL CLOSED
 *     (retrieval_invalid_input) BEFORE any provider IO — only omitted/empty may
 *     trigger the unambiguous single-provider default (P1-1);
 *   - Session capture wrapper is NOT a retrieval-ranked channel: only
 *     capability=search channels can ever be executed here, and a channel
 *     descriptor naming any other capability fails closed;
 *   - planHash dependency identity: the pool records the planHash it was
 *     produced from; a caller-supplied planHash must mechanically match
 *     (retrieval_plan_identity_mismatch).
 *
 * Security / privacy: no credentials, no machine-private absolute paths ever
 * enter the pool; the artifact is work-dir-relative only; no network IO here
 * (all provider IO happens behind the injected seam adapters).
 */

import fs from 'node:fs';
import path from 'node:path';

import { CAPABILITY_SEARCH, COMPLETENESS_STATES, AUTH_CLASSES, validateProviderResult, CAPABILITIES } from './provider-seam.mjs';
import {
  SEAM_ERROR_UNSUPPORTED_CAPABILITY,
  SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK,
  SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT,
  SEAM_ERROR_ADAPTER_CONTRACT_INVALID,
} from './provider-seam.mjs';
import { isValidPlanHashFormat, isPlanBoundarySafeString, planHash, validatePlanInput } from './plan-contract.mjs';
import { sha256 } from './state.mjs';
import {
  RRF_K,
  RRF_RANK_SOURCE,
  RRF_TIE_BREAK,
  assertArtifactSafe,
  isBoundarySafeString,
  FUSION_CONTRACT_ERROR_CODES,
  projectAllowedErrorCode,
  projectFailure,
  projectSafeJson,
  rrfFusion,
} from './rrf.mjs';

/** Canonical persisted pool artifact name (work-dir-relative). */
export const RETRIEVAL_POOL_FILENAME = 'retrieval-pool.json';

/** Pool schema version (strict; additive evolution needs a new version). */
export const RETRIEVAL_POOL_SCHEMA_VERSION = 1;

/**
 * Seam contract-error identities that are machine-readable and safe to surface
 * (P1-1): the only `err.code` values a throwing seam/adapter may proxy. Any
 * other code (ENOENT, paths, arbitrary adapter payloads) is unvalidated and
 * must NOT reach failure output.
 */
const SEAM_CONTRACT_ERROR_CODES = Object.freeze([
  SEAM_ERROR_UNSUPPORTED_CAPABILITY,
  SEAM_ERROR_NO_SILENT_PROVIDER_FALLBACK,
  SEAM_ERROR_UNKNOWN_PROVIDER_CONTRACT,
  SEAM_ERROR_ADAPTER_CONTRACT_INVALID,
]);

/** Machine-readable failure identities (fail-closed, controller-checkable). */
export const RETRIEVAL_FAILURE_INVALID_INPUT = 'retrieval_invalid_input';
export const RETRIEVAL_FAILURE_PLAN_INVALID = 'retrieval_plan_invalid';
export const RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH = 'retrieval_plan_identity_mismatch';
export const RETRIEVAL_FAILURE_CHANNEL_NOT_RETRIEVAL_RANKED = 'retrieval_channel_not_retrieval_ranked';
export const RETRIEVAL_FAILURE_NO_VALID_CHANNEL = 'retrieval_no_valid_channel';
export const RETRIEVAL_FAILURE_CHANNEL_UNREGISTERED = 'retrieval_channel_unregistered';
export const RETRIEVAL_FAILURE_CHANNEL_DUPLICATE = 'retrieval_channel_duplicate';
export const RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID = 'retrieval_provider_contract_invalid';
export const RETRIEVAL_FAILURE_POOL_WRITE = 'retrieval_pool_write_failed';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function failure(reason, details = null) {
  return details === null ? { ok: false, reason } : { ok: false, reason, details };
}

/**
 * P1-2/P2-2 T06 completeness-evidence persistence boundary.
 *
 * The seam guarantees completeness is a { status, evidence } plain object whose
 * status is a known state and whose evidence is a plain object — but evidence
 * CONTENT is provider-controlled and may embed machine-private paths,
 * credential-shaped strings, or bare credential-sensitive KEY NAMES (RULES §11
 * path-redaction; review 5077286260). Bare-storing result.completeness would let
 * those diagnostics enter the persisted pool, so evidence must cross a
 * deterministic safety projection: preserve it ONLY when the WHOLE tree is
 * mechanically safe (JSON-domain primitives/arrays/plain objects, safe keys,
 * bounded privacy-safe strings), otherwise FAIL CLOSED — never bare-store,
 * never silently drop, never distort non-plain / prototype-mutating structures.
 */
const EVIDENCE_MAX_DEPTH = 8;

/**
 * Project provider completeness across the T06 persistence boundary: preserve
 * the required status; preserve evidence ONLY when mechanically safe; fail
 * closed (with a stable reason) when the required semantics cannot safely enter
 * the persisted artifact. Returns
 * { ok:true, completeness: { status, evidence } } or { ok:false, reason }.
 */
function projectCompleteness(completeness) {
  if (!isPlainObject(completeness)) return { ok: false, reason: 'completeness_missing' };
  if (!COMPLETENESS_STATES.includes(completeness.status)) {
    return { ok: false, reason: 'completeness_status_invalid' };
  }
  const evidence = completeness.evidence;
  if (!isPlainObject(evidence)) return { ok: false, reason: 'completeness_evidence_missing' };
  const safe = projectSafeJson(evidence, { maxDepth: EVIDENCE_MAX_DEPTH });
  if (!safe.ok) return { ok: false, reason: 'completeness_evidence_unsafe' };
  return { ok: true, completeness: { status: completeness.status, evidence: safe.value } };
}

/**
 * P1-3 (review 5077286260): project plan-validation issues to a stable safe
 * representation before returning them. validatePlanInput() embeds caller-
 * controlled unknown property names directly into issues[].path; T06 must never
 * echo an arbitrary unknown name (it may be path/credential-shaped). Known
 * plan-contract schema paths (field names + array indices + known sub-fields)
 * are preserved; any path with a caller-controlled segment is replaced by the
 * stable '<unknown>' placeholder. Messages are validator-generated static
 * templates and are kept as-is. T04 strict schema validation is NOT weakened.
 */
const PLAN_ISSUE_KNOWN_FIELDS = new Set([
  'schemaVersion', 'queryVariants', 'aspects', 'entities', 'opposingFramings',
  'terminologyVariants', 'sourceGroupIntents', 'term', 'variants', 'intent',
  'constraints', 'groupKey',
]);
const PLAN_ISSUE_PATH_SEGMENT = /^[A-Za-z]+(?:\[\d+\])?$/;

function projectPlanIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => {
    const issuePath = issue?.path;
    const known = issuePath === ''
      || (typeof issuePath === 'string'
        && issuePath.split('.').every((segment) => (
          PLAN_ISSUE_PATH_SEGMENT.test(segment)
          && PLAN_ISSUE_KNOWN_FIELDS.has(segment.replace(/\[\d+\]$/, ''))
        )));
    return {
      path: known ? issuePath : '<unknown>',
      message: typeof issue?.message === 'string' ? issue.message : 'validation_failed',
    };
  });
}

/**
 * P2-1 (review 5077286260): mechanically validate the WHOLE provider result
 * immediately after seam.retrieve() returns — BEFORE branching on result.ok.
 * Reuses the T05 §5.1 result validator (validateProviderResult): a throwing
 * validator (hostile toString/getters in the T05 reason template) or an invalid
 * verdict maps to the stable retrieval_provider_contract_invalid with no raw
 * payload echo. Throws nothing.
 */
function safeValidateProviderResult(result) {
  try {
    const verdict = validateProviderResult(result);
    return verdict && verdict.valid === true ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * P2 (review 5076691874) + P1 registry-identity completeness (review
 * 5078267886) — guarded provider-registry inspection. The registry is a
 * seam-controlled boundary: a throwing listProviders(), a malformed non-array
 * registry, or malformed registry entries must never produce a raw throw or
 * reach provider retrieval IO — they return a stable
 * retrieval_provider_contract_invalid with a stable issue identity (no raw
 * err.message / payload echo). Only shape-valid entries ({ providerId,
 * capability, authClass } as non-empty strings + capability in the T05
 * capability vocabulary (CAPABILITIES) + authClass in AUTH_CLASSES — the full
 * identity this module consumes) proceed. Throws nothing; returns
 * { ok:true, registered } or { ok:false, reason, details }.
 */
function safeListProviders(seam) {
  let registered;
  try {
    registered = seam.listProviders();
  } catch {
    return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
      reason: 'provider_contract_violation',
      registryIssue: 'inspection_threw',
      note: 'provider registry inspection threw; no provider IO was performed',
    });
  }
  if (!Array.isArray(registered)) {
    return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
      reason: 'provider_contract_violation',
      registryIssue: 'not_an_array',
      note: 'provider registry must be an array of { providerId, capability, authClass } entries; no provider IO was performed',
    });
  }
  const seenIdentities = new Set();
  for (const entry of registered) {
    // R11 (Codex 5th-round P2 on 526ca71, comment 3905192539): capability must
    // be a member of the T05 vocabulary (CAPABILITIES), not merely non-empty —
    // an unknown identity like "bogus" is an unknown provider contract and must
    // fail closed as retrieval_provider_contract_invalid instead of being
    // misrouted to no_valid_channel / unregistered later.
    if (!isPlainObject(entry) || !isNonEmptyString(entry.providerId) || !isNonEmptyString(entry.capability)
      || !CAPABILITIES.includes(entry.capability) || !AUTH_CLASSES.includes(entry.authClass)) {
      return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
        reason: 'provider_contract_violation',
        registryIssue: 'malformed_entry',
        note: 'provider registry entry must be { providerId, capability, authClass } with non-empty strings, capability in the T05 capability vocabulary, and authClass in AUTH_CLASSES; no provider IO was performed',
      });
    }
    // P2 (review 5078133293): duplicate (providerId, capability) identities are
    // an ambiguous provider contract — a method-compatible seam returning the
    // same identity twice (especially with DIFFERENT authClass values) makes
    // explicit descriptors silently pick the first duplicate and default
    // routing misreport provider counts. Reject before any provider IO.
    const identityKey = `${entry.providerId}\u0000${entry.capability}`;
    if (seenIdentities.has(identityKey)) {
      return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
        reason: 'provider_contract_violation',
        registryIssue: 'duplicate_identity',
        note: 'provider registry contains duplicate (providerId, capability) identities — ambiguous provider contract; no provider IO was performed',
      });
    }
    seenIdentities.add(identityKey);
  }
  return { ok: true, registered };
}

/**
 * P1 (review 5078133293): registry identity strings are seam-controlled and may
 * be machine-private path-shaped (e.g. an adapter registered as
 * '/home/private-user/provider' or 'C:\\workspace\\provider'). Only a
 * boundary-safe string may surface in failure details; anything else becomes
 * the stable '<redacted>' placeholder — raw registry identifiers never leak
 * through `registered` / `candidates` / `available`.
 */
function projectFailureIdentity(value) {
  return isBoundarySafeString(value) ? value : '<redacted>';
}

/**
 * C1 (final convergence repair): project a PLAN-OWNED query on the
 * all-provider-failed early return through the T04 PLAN boundary
 * (isPlanBoundarySafeString), NOT the broader provider-content lens. A
 * T04-valid query (e.g. `/etc/hosts 文件的作用` or `/root/private/research` —
 * the plan validator's PRIVATE_PATH_SHAPE covers profile roots, not /root) is
 * legitimate plan content and is PRESERVED, exactly like it is preserved on the
 * successful path (R11-P2-1); only a value that does not cross the plan
 * boundary (credential-shaped / machine-private profile-root path / over-length
 * — unreachable via a validated plan, kept here as defense in depth) becomes the
 * stable '<redacted>' placeholder.
 */
function projectPlanQuery(value) {
  return isPlanBoundarySafeString(value) ? value : '<redacted>';
}

/**
 * P1 (independent review on f742cb3): EVERY failure path that echoes a channel
 * must project the seam-controlled providerId through projectFailureIdentity —
 * the same projection the all-failed early return applies — so a machine-
 * private path-shaped adapter name can never surface on ANY failure path
 * (retrieve throw, whole-result pre-validation, identity bind, retrieved_at
 * gate, completeness gate, failure-identity gate).
 */
function safeChannelProjection(channel) {
  return { ...channel, providerId: projectFailureIdentity(channel.providerId) };
}

/**
 * Resolve the deterministic channel set BEFORE any provider IO:
 *   - `channels` omitted/empty array: the only legal default is a seam with
 *     EXACTLY ONE registered search provider (unambiguous); zero →
 *     no_valid_channel; many → no_valid_channel (D-2 routing stays OPEN — the
 *     controller must disambiguate explicitly; NO_SILENT_PROVIDER_FALLBACK,
 *     never guess);
 *   - `channels` a malformed non-array (object/null/string/…) → FAIL CLOSED
 *     (retrieval_invalid_input) before any provider introspection/IO — a
 *     malformed explicit value is never treated as "no explicit channels"
 *     (P1-1);
 *   - registry inspection is GUARDED (P2): throwing / non-array / malformed
 *     registry → retrieval_provider_contract_invalid before any provider IO;
 *   - explicit descriptors: { providerId, capability? } — capability must be
 *     `search` (retrieval-ranked only); providerId must be registered for the
 *     search capability; duplicates fail closed.
 * Throws nothing; returns { ok:true, providers } or { ok:false, reason, details }.
 */
function resolveChannels(seam, channels) {
  if (channels !== undefined && !Array.isArray(channels)) {
    // P1-1: never echo the raw (possibly arbitrary/machine-private) channels
    // value; report a stable type descriptor only.
    return failure(RETRIEVAL_FAILURE_INVALID_INPUT, {
      reason: 'channels must be an array of { providerId, capability? } descriptors, or omitted/empty for the unambiguous single-provider default',
      receivedType: channels === null ? 'null' : Array.isArray(channels) ? 'array' : typeof channels,
    });
  }

  const registeredResult = safeListProviders(seam);
  if (!registeredResult.ok) return registeredResult;
  const registered = registeredResult.registered;
  // P1 (review 5078267886): keep the FULL resolved registry identity —
  // { providerId, capability, authClass } — so provider result identity
  // (provider_id + capability + auth_class) can be bound to the EXACT resolved
  // registry/channel instead of trusting the provider's self-declared values.
  const searchProviders = registered.filter((e) => e.capability === CAPABILITY_SEARCH);

  if (channels === undefined || channels.length === 0) {
    if (searchProviders.length === 0) {
      return failure(RETRIEVAL_FAILURE_NO_VALID_CHANNEL, {
        reason: 'no_search_channels_registered',
        registered: registered.map((e) => ({ providerId: projectFailureIdentity(e.providerId), capability: projectFailureIdentity(e.capability) })),
      });
    }
    if (searchProviders.length > 1) {
      return failure(RETRIEVAL_FAILURE_NO_VALID_CHANNEL, {
        reason: 'multiple_search_providers_without_explicit_channels',
        candidates: searchProviders.map((e) => projectFailureIdentity(e.providerId)),
        note: 'D-2 routing is OPEN — explicit channel descriptors required (NO_SILENT_PROVIDER_FALLBACK)',
      });
    }
    return { ok: true, providers: searchProviders };
  }

  const providers = [];
  const seen = new Set();
  for (const descriptor of channels) {
    if (!isPlainObject(descriptor) || !isNonEmptyString(descriptor.providerId)) {
      // P1-1: never echo the raw (possibly arbitrary/machine-private) descriptor;
      // report a stable type descriptor + which required field was invalid.
      return failure(RETRIEVAL_FAILURE_INVALID_INPUT, {
        reason: 'channel descriptor must be { providerId, capability? }',
        receivedType: descriptor === null ? 'null' : Array.isArray(descriptor) ? 'array' : typeof descriptor,
        providerIdInvalid: !isNonEmptyString(descriptor?.providerId),
      });
    }
    if (descriptor.capability != null && descriptor.capability !== CAPABILITY_SEARCH) {
      // P1-1: no raw descriptor/capability echo; stable invalid-input reason only.
      return failure(RETRIEVAL_FAILURE_CHANNEL_NOT_RETRIEVAL_RANKED, {
        reason: 'capability_must_be_search',
        note: 'Session capture / non-search capabilities cannot be retrieval-ranked channels (§5.4)',
      });
    }
    if (seen.has(descriptor.providerId)) {
      return failure(RETRIEVAL_FAILURE_CHANNEL_DUPLICATE, { reason: 'duplicate_channel_descriptor' });
    }
    seen.add(descriptor.providerId);
    const entry = searchProviders.find((e) => e.providerId === descriptor.providerId);
    if (!entry) {
      return failure(RETRIEVAL_FAILURE_CHANNEL_UNREGISTERED, {
        reason: 'provider_not_registered_for_search_capability',
        available: searchProviders.map((e) => projectFailureIdentity(e.providerId)),
      });
    }
    providers.push(entry);
  }
  return { ok: true, providers };
}

/**
 * Execute the single-pass multi-query retrieval and persist the fused
 * Candidate/Retrieval Pool.
 *
 * @param {object} opts
 * @param {object} opts.plan        validated Research Plan (T04 contract)
 * @param {string} [opts.planHash]  controller-owned plan identity; when given it
 *                                  MUST equal planHash(plan) (fail-closed check)
 * @param {object} opts.seam        provider seam (createProviderSeam result);
 *                                  only capability=search channels are used
 * @param {Array}  [opts.channels]  explicit channel descriptors
 *                                  [{ providerId, capability? }]; omitted/empty =
 *                                  the seam's single unambiguous search provider;
 *                                  a malformed non-array fails closed
 *                                  (retrieval_invalid_input) before any IO
 * @param {string} opts.workDir     work directory for the pool artifact
 * @returns {object} { ok:true, pool, poolHash, file } | { ok:false, reason, details? }
 */
export function runMultiQueryRetrieval(opts = {}) {
  // P2-1: destructuring defaults only cover `undefined` — a null / non-object
  // options value would throw a TypeError before validation. Normalize first so
  // ANY non-object input falls through to the fail-closed module-input check.
  const options = isPlainObject(opts) ? opts : {};
  const { plan, planHash: expectedPlanHash, seam, channels = [], workDir } = options;
  // 1. module-input validation (fail closed; no IO before this).
  if (!isPlainObject(plan) || !isPlainObject(seam) || typeof seam.retrieve !== 'function'
    || typeof seam.listProviders !== 'function' || !isNonEmptyString(workDir)) {
    return failure(RETRIEVAL_FAILURE_INVALID_INPUT, {
      reason: 'plan (object), seam (with retrieve/listProviders), and a non-empty workDir are required',
    });
  }

  // 2. plan validity + planHash identity (Spec §4.3 dependency identity).
  const validated = validatePlanInput(plan);
  if (!validated.ok) {
    // P1-3: issue paths are projected to stable schema paths — a caller-
    // controlled unknown key is never echoed raw.
    return failure(RETRIEVAL_FAILURE_PLAN_INVALID, { issues: projectPlanIssues(validated.issues) });
  }
  let planIdentity;
  try {
    planIdentity = planHash(validated.plan);
  } catch (err) {
    return failure(RETRIEVAL_FAILURE_PLAN_INVALID, { issues: projectPlanIssues(err?.issues ?? null) });
  }
  if (expectedPlanHash != null) {
    // P1-3: a caller-supplied plan identity is only comparable when it is a
    // syntactically valid planHash (64 lowercase hex, plan-contract). A malformed
    // value is never echoed back — it may be path/credential-shaped — only stable
    // malformed/mismatch info is returned.
    if (!isValidPlanHashFormat(expectedPlanHash)) {
      return failure(RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH, {
        reason: 'expected_plan_hash_malformed',
        expectedFormat: '64-lowercase-hex-sha256',
      });
    }
    if (expectedPlanHash !== planIdentity) {
      return failure(RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH, {
        reason: 'plan_identity_mismatch',
        computed: planIdentity,
      });
    }
  }

  // 3. deterministic channel set resolution (pre-validated BEFORE any execution).
  const resolved = resolveChannels(seam, channels);
  if (!resolved.ok) return resolved;

  // 4. single-pass execution: plan query order × resolved channel order.
  const channelRecords = [];
  const rankings = [];
  for (const query of validated.plan.queryVariants) {
    for (const provider of resolved.providers) {
      const channel = { query, providerId: provider.providerId, capability: CAPABILITY_SEARCH };
      let result;
      try {
        result = seam.retrieve(CAPABILITY_SEARCH, { query }, { providerId: provider.providerId });
      } catch (err) {
        // Routing/contract/exceptions from the seam: FAIL CLOSED. A provider
        // failure is a result, never a routing event — but a CONTRACT violation
        // (UNKNOWN_PROVIDER_CONTRACT etc.) cannot be judged → whole run fails.
        // P1-1: never echo a raw adapter/fs err.message (it may embed a
        // machine-private path); and never proxy an unvalidated err.code — only
        // the known seam contract-error identities are machine-readable and safe
        // to surface; anything else becomes a stable reason with no code.
        return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
          channel: safeChannelProjection(channel),
          code: projectAllowedErrorCode(err, SEAM_CONTRACT_ERROR_CODES),
          reason: 'provider_contract_violation',
        });
      }
      // P2-1 (review 5077286260): mechanically validate the WHOLE provider
      // result immediately after seam.retrieve() returns — BEFORE branching on
      // result.ok. A method-compatible injected seam returning null/undefined/
      // primitive/malformed/contradictory results fails closed here with a
      // stable retrieval_provider_contract_invalid; no raw TypeError can
      // escape, and no raw result payload is echoed.
      if (!safeValidateProviderResult(result).ok) {
        return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
          channel: safeChannelProjection(channel),
          reason: 'provider_contract_violation',
          note: 'provider result violates the §5.1 contract (malformed or contradictory)',
        });
      }
      // P1 (review 5078267886): bind the provider result identity to the EXACT
      // resolved registry/channel — provider_id + capability + auth_class must
      // equal the registry-resolved identity (NOT the provider's self-declared
      // values). A drifted result fails closed; the persisted auth_class is the
      // registry-bound value, never the result's.
      if (result.provider_id !== provider.providerId
        || result.capability !== CAPABILITY_SEARCH
        || result.auth_class !== provider.authClass) {
        return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
          channel: safeChannelProjection(channel),
          reason: 'provider_contract_violation',
          note: 'provider result identity does not bind to the resolved registry/channel (provider_id + capability + auth_class)',
        });
      }
      // P2/P1 (review 5078267886): retrieved_at is provider-controlled and must
      // cross the SAME bounded privacy-safe string gate as every other
      // provider-controlled string entering channel records (it is persisted on
      // ok AND failed records, and is retained on the all-failed early return so
      // retrieval coverage stays auditable).
      const retrievedAt = result.retrieved_at;
      if (!isBoundarySafeString(retrievedAt)) {
        return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
          channel: safeChannelProjection(channel),
          reason: 'provider_contract_violation',
          note: 'retrieved_at cannot safely enter the persisted pool',
        });
      }
      if (result.ok === true) {
        // P1-2: contradictory ok:true + top-level failure can never fuse — fail
        // closed. hasOwnProperty keeps this narrow: even failure:null counts as
        // present (absent ≠ present-but-null).
        if (Object.prototype.hasOwnProperty.call(result, 'failure')) {
          return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
            channel: safeChannelProjection(channel),
            reason: 'provider_contract_violation',
            note: 'ok:true result must not carry a top-level failure identity',
          });
        }
        // P1-2 (review 5076691874): completeness evidence crosses the T06
        // persistence boundary BEFORE it can reach the pool — required status
        // preserved, evidence preserved only when mechanically safe, unsafe
        // evidence fails closed (never bare-stored, never silently dropped).
        const projectedCompleteness = projectCompleteness(result.completeness);
        if (!projectedCompleteness.ok) {
          return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
            channel: safeChannelProjection(channel),
            reason: 'provider_contract_violation',
            note: 'completeness evidence cannot safely enter the persisted pool (P1-2)',
            completenessIssue: projectedCompleteness.reason,
          });
        }
        channelRecords.push({
          channel,
          ok: true,
          auth_class: provider.authClass, // P2-3: registry-bound adapter provenance (§5.1)
          itemCount: Array.isArray(result.items) ? result.items.length : 0,
          retrievedAt,
          completeness: projectedCompleteness.completeness,
        });
        rankings.push({ channel, items: result.items });
      } else {
        // Machine-readable provider failure identity, recorded — never silently
        // substituted, never retried. P1-1: the failure is SAFE-PROJECTED at the
        // T06 boundary (identity fields only) so raw detail / path-bearing /
        // non-JSON-safe payloads never reach output, the artifact, or the
        // serialization guard — including on the all-failed early return below.
        const projected = projectFailure(result.failure);
        if (!projected.ok) {
          return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
            channel: safeChannelProjection(channel),
            reason: 'provider_contract_violation',
            note: 'provider failure identity malformed (needs machine-readable { code, class })',
          });
        }
        // P1-2: same completeness persistence boundary as the ok path — the
        // failed-channel record must not bare-store unsafe provider evidence.
        const projectedCompleteness = projectCompleteness(result.completeness);
        if (!projectedCompleteness.ok) {
          return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
            channel: safeChannelProjection(channel),
            reason: 'provider_contract_violation',
            note: 'completeness evidence cannot safely enter the persisted pool (P1-2)',
            completenessIssue: projectedCompleteness.reason,
          });
        }
        channelRecords.push({
          channel,
          ok: false,
          auth_class: provider.authClass, // P2-3: registry-bound adapter provenance (§5.1)
          retrievedAt,
          completeness: projectedCompleteness.completeness,
          failure: projected.failure,
        });
      }
    }
  }

  // 5. zero valid retrieval channel results → FAIL CLOSED. Every field retained
  //    here is already safely projected at the T06 boundary (channel identity is
  //    registry/plan-derived, auth_class is the registry-bound value, retrievedAt
  //    is a bounded privacy-safe string, completeness + failure are canonical
  //    projections), so this early return is JSON-serializable by construction —
  //    no raw detail / BigInt / cyclic payload can escape even though it bypasses
  //    the pool serialization guard (P2, review 5078267886: all-provider-failed
  //    results retain channel + auth_class + retrievedAt + completeness + failure
  //    so retrieval coverage remains auditable).
  const validChannels = channelRecords.filter((c) => c.ok === true);
  if (validChannels.length === 0) {
    return failure(RETRIEVAL_FAILURE_NO_VALID_CHANNEL, {
      failedChannels: channelRecords
        .filter((c) => c.ok === false)
        .map((c) => ({
          // P1 (review 5078133293, 2nd round): this early return bypasses
          // assertArtifactSafe, so the seam-controlled providerId is projected
          // through projectFailureIdentity like every other registry identity —
          // a machine-private path-shaped adapter name can never surface.
          // C1 (final convergence repair): the plan-owned query crosses the T04
          // PLAN boundary (projectPlanQuery), not the provider-content lens — a
          // T04-valid query is preserved verbatim on the all-failed path, matching
          // its preservation on the successful path (R11-P2-1).
          channel: {
            ...c.channel,
            providerId: projectFailureIdentity(c.channel.providerId),
            query: projectPlanQuery(c.channel.query),
          },
          auth_class: c.auth_class,
          retrievedAt: c.retrievedAt,
          completeness: c.completeness,
          failure: c.failure,
        })),
    });
  }

  // 6. deterministic RRF candidate fusion (NOT corpus selection).
  let fused;
  try {
    fused = rrfFusion(rankings);
  } catch (err) {
    // Provider item violated the retrieval/rank contract → fail closed. This
    // also covers a present-but-malformed per-item failure (P1-3) and a
    // duplicate channel identity (Round-6 BLOCK3, 3905300520). P1-1 + Round-6
    // BLOCK4 (3905300529): ONLY an allowlisted FUSION_* contract error code may
    // surface — an arbitrary / credential-shaped / path-bearing thrown code
    // becomes null — and a raw err.message is never emitted.
    return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
      code: projectAllowedErrorCode(err, FUSION_CONTRACT_ERROR_CODES),
      reason: 'rrf_fusion_contract_violation',
    });
  }

  // 7. pool artifact (work-relative only; no credentials; deterministic).
  const pool = {
    schemaVersion: RETRIEVAL_POOL_SCHEMA_VERSION,
    type: 'retrieval-pool',
    planHash: planIdentity,
    channels: channelRecords,
    candidates: fused.candidates,
    rejected: fused.rejected,
    criteria: {
      fusion: 'rrf',
      rrfK: RRF_K,
      rankSource: RRF_RANK_SOURCE,
      tieBreak: RRF_TIE_BREAK,
      scope: 'single-pass',
    },
  };

  // P1-1 (review 5077286260): artifact-wide defense-in-depth — mechanically
  // walk the WHOLE pool BEFORE persistence so no provider/caller-controlled
  // value can reach the artifact even if a future field skips its projection.
  // A violation fails closed with a stable issue identity; no artifact is
  // written on the fail-closed path.
  // R11 (Codex 5th-round P2 on 526ca71, comment 3905192528): channel queries
  // are plan-owned content validated by the T04 plan contract at ingestion —
  // the walk applies the SAME query-string contract as plan validation
  // (trustedPlanStrings) instead of reclassifying valid plan content (e.g. a
  // T04-valid system-path query like `/etc/hosts 文件的作用`) with the broader
  // provider-content lens, which would falsely fail a successful run.
  // `trustedPlanStrings` is NOT a general caller-defined trust bypass: it is
  // exactly the validated plan's queryVariants and each member is still
  // re-validated by the plan boundary.
  const artifactVerdict = assertArtifactSafe(pool, {
    trustedPlanStrings: new Set(validated.plan.queryVariants),
  });
  if (!artifactVerdict.ok) {
    return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
      reason: 'artifact_safety_violation',
      issue: artifactVerdict.reason,
    });
  }

  // P1-2: seam-accepted provider metadata may be non-JSON-safe (BigInt, cyclic
  // references). Serialize inside the guard so a throw becomes a stable
  // fail-closed contract failure — it must NEVER escape runMultiQueryRetrieval,
  // and no artifact is written when serialization fails (write happens after).
  let content;
  try {
    content = `${JSON.stringify(pool, null, 2)}\n`;
  } catch (err) {
    return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
      code: err?.code ?? null,
      reason: 'pool_serialization_failed',
    });
  }

  const poolHash = sha256(content);
  try {
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, RETRIEVAL_POOL_FILENAME), content);
  } catch (err) {
    // P1-1: fs errors embed absolute workDir paths in err.message; return a
    // stable sanitized reason only (RULES §11 path-redaction).
    return failure(RETRIEVAL_FAILURE_POOL_WRITE, {
      reason: 'pool_write_failed',
      file: RETRIEVAL_POOL_FILENAME,
    });
  }

  return { ok: true, pool, poolHash, file: RETRIEVAL_POOL_FILENAME };
}