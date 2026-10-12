// SPDX-License-Identifier: AGPL-3.0-only
// Content provenance only. None of these receipts grant path/query/tool/plan
// authority. JSON cannot carry them; trusted local controller code owns IO.
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const responses = new WeakMap();
const titles = new WeakMap();
const privateRoots = new Set([fileURLToPath(new URL('../..', import.meta.url))]);
const ROUTES = new Map([
  ['zhihu-official-search', 'zhihu-answer-grabber:search'],
  ['zhihu-open-platform', 'zhihu-open-platform:global_search'],
]);

export function registerPrivateTitleRoot(root) {
  if (typeof root === 'string' && path.isAbsolute(root)) privateRoots.add(path.resolve(root));
}

// Store the exact successful canonical IO bytes, not a provider-reported label.
export function recordCanonicalSearchResponse(response, providerId, field) {
  if (ROUTES.has(providerId) && typeof response?.[field] === 'string') {
    responses.set(response, { providerId, field, bytes: response[field], status: response.status });
  }
  return response;
}

export function bindCanonicalProviderTitle(item, response, providerId) {
  const receipt = responses.get(response);
  if (!receipt || receipt.providerId !== providerId || response[receipt.field] !== receipt.bytes || response.status !== receipt.status) return;
  bindTitle(item.facts, item.identity.questionId, providerId, item.provenance.route);
}

function bindTitle(facts, questionId, providerId, route) {
  const descriptor = Object.getOwnPropertyDescriptor(facts, 'title');
  if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' &&
      /^[1-9]\d*$/.test(questionId) && ROUTES.get(providerId) === route) {
    titles.set(facts, { value: descriptor.value, questionId, providerId, route,
      private: containsPrivateTitleContext(descriptor.value) });
  }
}

export function externalTitlePrivacySafe(facts, value) {
  const receipt = facts && titles.get(facts);
  const descriptor = facts && Object.getOwnPropertyDescriptor(facts, 'title');
  return Boolean(receipt && !receipt.private && descriptor && Object.hasOwn(descriptor, 'value') &&
    descriptor.value === receipt.value && value === receipt.value);
}

export function hasExternalTitle(facts, questionId, providerId, route) {
  const receipt = facts && titles.get(facts);
  const descriptor = facts && Object.getOwnPropertyDescriptor(facts, 'title');
  return Boolean(receipt && descriptor && Object.hasOwn(descriptor, 'value') &&
    descriptor.value === receipt.value && questionId === receipt.questionId &&
    providerId === receipt.providerId && route === receipt.route);
}

export function candidateHasExternalTitle(candidate) {
  if (candidate?.identity?.kind !== 'candidate' || !Array.isArray(candidate.ranks)) return false;
  const first = candidate.ranks[0]; // canonical-first contribution owns facts
  return hasExternalTitle(candidate.facts, candidate.identity.questionId, first?.channel?.providerId, first?.route);
}

export function copyExternalTitleBinding(from, to, questionId, providerId, route) {
  if (hasExternalTitle(from, questionId, providerId, route) && to.title === from.title) {
    titles.set(to, { ...titles.get(from) }); // pure copy; never re-read runtime context in RRF
  }
}

// Actual machine context is a separate privacy gate, even for external content.
// Existence of a public path such as /etc/hosts is not privacy classification.
// Only path configuration is consulted; credential values/files are never read.
export function containsPrivateTitleContext(value) {
  const roots = [os.homedir(), os.tmpdir(), process.cwd(), ...privateRoots];
  if (roots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) return true;
  for (const name of ['ZAG_CONFIG_DIR', 'ZHIHU_CLI_CONFIG', 'ZHIHU_CREATOR_CONFIG', 'P1_T10_ONNX_MODEL_DIR']) {
    if (typeof process.env[name] === 'string' && path.isAbsolute(process.env[name])) roots.push(process.env[name]);
  }
  // Directory/file identity only, including supported symlink aliases. An
  // existing but unresolvable private context is UNKNOWN and fails closed.
  try {
    for (const root of [...roots]) if (existsSync(root)) roots.push(realpathSync(root));
  } catch { return true; }
  const normalize = text => text.replaceAll('\\', '/').replace(/\/+/g, '/')
    .replaceAll('/private/var/', '/var/').replaceAll('/private/tmp/', '/tmp/').toLowerCase();
  const anchors = roots.map(root => normalize(path.resolve(root)).replace(/\/$/, '')).filter(root => root.length > 1);
  let inspected = value;
  for (let layer = 0; layer < 4; layer++) {
    const normalized = normalize(inspected);
    if (anchors.some(anchor => {
      let at = normalized.indexOf(anchor);
      while (at !== -1) {
        const next = normalized.slice(at + anchor.length, at + anchor.length + 1);
        if (next === '' || !/[\p{L}\p{N}\p{M}_.~-]/u.test(next)) return true;
        at = normalized.indexOf(anchor, at + 1);
      }
      return false;
    })) return true;
    try {
      const decoded = decodeURIComponent(inspected);
      if (decoded === inspected) break;
      inspected = decoded;
    } catch { break; }
  }
  return /%[0-9a-f]{2}/i.test(inspected); // unresolved encoding cannot certify privacy
}

/** Restore only from the existing controller's expected hash, over THESE bytes.
 * This preserves the existing trusted-owner-state model, not authentication
 * against a local actor able to rewrite both checkpoint and artifact. No marker,
 * source URL or artifact's self-reported hash grants content provenance.
 */
export function parseBoundProviderPool(bytes, expectedHash) {
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash) ||
      createHash('sha256').update(bytes).digest('hex') !== expectedHash) return null;
  try {
    const pool = JSON.parse(bytes.toString('utf8'));
    if (!pool || !Array.isArray(pool.candidates) || !Array.isArray(pool.channels)) return null;
    for (const candidate of pool.candidates) {
      const first = candidate?.ranks?.[0];
      if (candidate?.identity?.kind !== 'candidate' || !candidate.facts ||
          first?.channel?.capability !== 'search' || !Number.isSafeInteger(first.rank) || first.rank < 1) continue;
      bindTitle(candidate.facts, candidate.identity.questionId, first.channel.providerId, first.route);
    }
    return pool;
  } catch { return null; }
}
