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

import { CAPABILITY_SEARCH } from './provider-seam.mjs';
import { planHash, validatePlanInput } from './plan-contract.mjs';
import { sha256 } from './state.mjs';
import {
  RRF_K,
  RRF_RANK_SOURCE,
  RRF_TIE_BREAK,
  rrfFusion,
} from './rrf.mjs';

/** Canonical persisted pool artifact name (work-dir-relative). */
export const RETRIEVAL_POOL_FILENAME = 'retrieval-pool.json';

/** Pool schema version (strict; additive evolution needs a new version). */
export const RETRIEVAL_POOL_SCHEMA_VERSION = 1;

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
 *   - explicit descriptors: { providerId, capability? } — capability must be
 *     `search` (retrieval-ranked only); providerId must be registered for the
 *     search capability; duplicates fail closed.
 * Throws nothing; returns { ok:true, providers } or { ok:false, reason, details }.
 */
function resolveChannels(seam, channels) {
  if (channels !== undefined && !Array.isArray(channels)) {
    return failure(RETRIEVAL_FAILURE_INVALID_INPUT, {
      reason: 'channels must be an array of { providerId, capability? } descriptors, or omitted/empty for the unambiguous single-provider default',
      channels,
    });
  }

  const registered = seam.listProviders();
  const searchProviders = registered
    .filter((e) => e.capability === CAPABILITY_SEARCH)
    .map((e) => e.providerId);

  if (channels === undefined || channels.length === 0) {
    if (searchProviders.length === 0) {
      return failure(RETRIEVAL_FAILURE_NO_VALID_CHANNEL, {
        reason: 'no_search_channels_registered',
        registered: registered.map((e) => ({ providerId: e.providerId, capability: e.capability })),
      });
    }
    if (searchProviders.length > 1) {
      return failure(RETRIEVAL_FAILURE_NO_VALID_CHANNEL, {
        reason: 'multiple_search_providers_without_explicit_channels',
        candidates: searchProviders,
        note: 'D-2 routing is OPEN — explicit channel descriptors required (NO_SILENT_PROVIDER_FALLBACK)',
      });
    }
    return { ok: true, providers: searchProviders };
  }

  const providers = [];
  const seen = new Set();
  for (const descriptor of channels) {
    if (!isPlainObject(descriptor) || !isNonEmptyString(descriptor.providerId)) {
      return failure(RETRIEVAL_FAILURE_INVALID_INPUT, {
        reason: 'channel descriptor must be { providerId, capability? }',
        descriptor,
      });
    }
    if (descriptor.capability != null && descriptor.capability !== CAPABILITY_SEARCH) {
      return failure(RETRIEVAL_FAILURE_CHANNEL_NOT_RETRIEVAL_RANKED, {
        channel: { providerId: descriptor.providerId, capability: descriptor.capability },
        note: 'Session capture / non-search capabilities cannot be retrieval-ranked channels (§5.4)',
      });
    }
    if (seen.has(descriptor.providerId)) {
      return failure(RETRIEVAL_FAILURE_CHANNEL_DUPLICATE, { providerId: descriptor.providerId });
    }
    seen.add(descriptor.providerId);
    if (!searchProviders.includes(descriptor.providerId)) {
      return failure(RETRIEVAL_FAILURE_CHANNEL_UNREGISTERED, {
        requested: descriptor.providerId,
        available: searchProviders,
      });
    }
    providers.push(descriptor.providerId);
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
export function runMultiQueryRetrieval({ plan, planHash: expectedPlanHash, seam, channels = [], workDir } = {}) {
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
    return failure(RETRIEVAL_FAILURE_PLAN_INVALID, { issues: validated.issues });
  }
  let planIdentity;
  try {
    planIdentity = planHash(validated.plan);
  } catch (err) {
    return failure(RETRIEVAL_FAILURE_PLAN_INVALID, { issues: err?.issues ?? null });
  }
  if (expectedPlanHash != null && expectedPlanHash !== planIdentity) {
    return failure(RETRIEVAL_FAILURE_PLAN_IDENTITY_MISMATCH, {
      provided: expectedPlanHash,
      computed: planIdentity,
    });
  }

  // 3. deterministic channel set resolution (pre-validated BEFORE any execution).
  const resolved = resolveChannels(seam, channels);
  if (!resolved.ok) return resolved;

  // 4. single-pass execution: plan query order × resolved channel order.
  const channelRecords = [];
  const rankings = [];
  for (const query of validated.plan.queryVariants) {
    for (const providerId of resolved.providers) {
      const channel = { query, providerId, capability: CAPABILITY_SEARCH };
      let result;
      try {
        result = seam.retrieve(CAPABILITY_SEARCH, { query }, { providerId });
      } catch (err) {
        // Routing/contract/exceptions from the seam: FAIL CLOSED. A provider
        // failure is a result, never a routing event — but a CONTRACT violation
        // (UNKNOWN_PROVIDER_CONTRACT etc.) cannot be judged → whole run fails.
        return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
          channel,
          code: err?.code ?? null,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      if (result.ok === true) {
        channelRecords.push({
          channel,
          ok: true,
          itemCount: Array.isArray(result.items) ? result.items.length : 0,
          retrievedAt: result.retrieved_at,
          completeness: result.completeness,
        });
        rankings.push({ channel, items: result.items });
      } else {
        // Machine-readable provider failure identity, recorded — never silently
        // substituted, never retried.
        channelRecords.push({
          channel,
          ok: false,
          retrievedAt: result.retrieved_at,
          completeness: result.completeness,
          failure: result.failure,
        });
      }
    }
  }

  // 5. zero valid retrieval channel results → FAIL CLOSED.
  const validChannels = channelRecords.filter((c) => c.ok === true);
  if (validChannels.length === 0) {
    return failure(RETRIEVAL_FAILURE_NO_VALID_CHANNEL, {
      failedChannels: channelRecords
        .filter((c) => c.ok === false)
        .map((c) => ({ channel: c.channel, failure: c.failure })),
    });
  }

  // 6. deterministic RRF candidate fusion (NOT corpus selection).
  let fused;
  try {
    fused = rrfFusion(rankings);
  } catch (err) {
    // Provider item violated the retrieval/rank contract → fail closed.
    return failure(RETRIEVAL_FAILURE_PROVIDER_CONTRACT_INVALID, {
      code: err?.code ?? null,
      message: err instanceof Error ? err.message : String(err),
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
  const content = `${JSON.stringify(pool, null, 2)}\n`;
  const poolHash = sha256(content);
  try {
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, RETRIEVAL_POOL_FILENAME), content);
  } catch (err) {
    return failure(RETRIEVAL_FAILURE_POOL_WRITE, {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, pool, poolHash, file: RETRIEVAL_POOL_FILENAME };
}