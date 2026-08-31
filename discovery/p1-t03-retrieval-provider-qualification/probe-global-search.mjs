#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DISCOVERY-ONLY (P1-T03 / Issue #35, GATE-3) — read-only smoke probe for the
 * candidate additional retrieval-ranked capability: Official `global_search` API.
 *
 * EGRESS CLASS
 *   direction : outbound, developer.zhihu.com only (first-party official platform)
 *   payload   : one synthetic query keyword ("zhihu toolkit rrf channel probe");
 *               NO real Zhihu corpus, NO captured content is sent
 *   credential: uses the repo-local ignored `zhihu_secret.txt` (already securely
 *               configured for the existing Official Search channel). The secret
 *               is read at runtime and NEVER written to output. No secret value,
 *               hash, prefix, suffix, or length is recorded anywhere.
 *
 * WHAT THIS PROBE ESTABLISHES (and what it does not)
 *   Establishes (real, observed):
 *     - endpoint reachability + auth behavior against current live service
 *     - presence of a query-keyed, ranked Items array (retrieval-ranking contract)
 *     - pagination/completeness-observable fields actually returned (HasMore etc.)
 *     - machine-readable failure identity surfaces (HTTP status / Code / Message)
 *   Does NOT establish:
 *     - ranking-semantics guarantees (score meaning is upstream-defined)
 *     - completeness beyond the sampled queries
 *     - schema-level exhaustiveness (sampled observation only)
 *
 * USAGE
 *   node discovery/p1-t03-retrieval-provider-qualification/probe-global-search.mjs \
 *     --out discovery/p1-t03-retrieval-provider-qualification/evidence/read-only-smoke-global-search-<ts>.json
 *   (secret file path defaults to repo-root zhihu_secret.txt; override with --secret-file)
 *
 * FAIL-CLOSED: any unexpected shape → verdict UNKNOWN for that surface; the probe
 * never guesses pagination semantics, ranking semantics, or completeness.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const args = process.argv.slice(2);
function arg(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}
const secretFile = arg('--secret-file', resolve(REPO_ROOT, 'zhihu_secret.txt'));
const outFile = arg('--out', null);

const ENDPOINT = 'https://developer.zhihu.com/api/v1/content/global_search';
// Synthetic handcrafted query — no real corpus text is transmitted.
const QUERY = 'zhihu toolkit rrf channel probe';
const COUNT = 5;

function readSecret() {
  const raw = readFileSync(secretFile, 'utf8').trim();
  if (!raw) throw new Error('secret file is empty');
  return raw;
}

function classifyRedundantFields(item) {
  // presence-only schema observation (values are NOT recorded)
  const fields = ['Title', 'ContentType', 'ContentID', 'ContentText', 'Url',
    'CommentCount', 'VoteUpCount', 'AuthorName', 'AuthorAvatar', 'AuthorBadge',
    'AuthorBadgeText', 'EditTime', 'AuthorityLevel'];
  return fields.filter((f) => f in item);
}

async function main() {
  const secret = readSecret();
  const ts = Math.floor(Date.now() / 1000);
  const url = new URL(ENDPOINT);
  url.searchParams.set('Query', QUERY);
  url.searchParams.set('Count', String(COUNT));

  const observation = {
    ticket: 'P1-T03 / Issue #35 (GATE-3)',
    probe: 'read-only-smoke of official global_search API',
    endpoint: ENDPOINT,
    method: 'GET',
    query_synthetic: QUERY,
    count_requested: COUNT,
    secret_file_used: '<REDACTED>', // path intentionally not recorded
    secret_material_recorded: 'NONE (by contract)',
    ran_at_utc: new Date().toISOString(),
    surfaces: {},
  };

  let res;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${secret}`,
        'X-Request-Timestamp': String(ts),
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    observation.surfaces.transport = { outcome: 'ERROR', error_class: error.name, message: String(error.message) };
    observation.VERDICT = 'UNKNOWN';
    return finish(observation, outFile);
  }

  const text = await res.text();
  observation.surfaces.http = { status: res.status, ok: res.ok };
  if (!res.ok) {
    observation.surfaces.http.body_head = text.slice(0, 200);
    observation.VERDICT = 'UNKNOWN';
    return finish(observation, outFile);
  }

  let parsed;
  try { parsed = JSON.parse(text); } catch {
    observation.surfaces.body = { outcome: 'NON_JSON' };
    observation.VERDICT = 'UNKNOWN';
    return finish(observation, outFile);
  }

  const code = parsed?.Code;
  const msg = typeof parsed?.Message === 'string' ? parsed.Message : null;
  observation.surfaces.envelope = { code_observed: code, message_observed: msg === null ? null : '<redacted-string-presence-only>' };

  const data = parsed?.Data;
  const items = Array.isArray(data?.Items) ? data.Items : null;
  observation.surfaces.retrieval_channel = {
    items_is_array: Array.isArray(items),
    items_len_observed: Array.isArray(items) ? items.length : null,
    // ranking contract evidence: Items is the query-keyed ranked result list.
    // Doc-level: https://developer.zhihu.com/docs (global_search API) defines Items
    // as "内容数据列表"; ranked-by-relevance is upstream semantic (not re-verified here).
    ranked_list_observed: Array.isArray(items) && items.length > 0,
    hasmore_observed: typeof data?.HasMore === 'boolean' ? data.HasMore : null,
    item_fields_present: Array.isArray(items) && items.length > 0 ? classifyRedundantFields(items[0]) : [],
    // no dedupe / completeness inference — sampled observation only
  };

  const ok = code === 0 && Array.isArray(items);
  observation.VERDICT = ok ? 'SMOKE_PASS_SAMPLED' : 'UNKNOWN';
  observation.SAMPLED_SCOPE_NOTE =
    'single synthetic query, single invocation; all semantics beyond observed response shape are UNKNOWN';
  finish(observation, outFile);
}

function finish(observation, outFile) {
  console.log(JSON.stringify({
    VERDICT: observation.VERDICT,
    surfaces: observation.surfaces,
  }, null, 2));
  if (outFile) {
    writeFileSync(resolve(outFile), JSON.stringify(observation, null, 2) + '\n', 'utf8');
    console.log(`evidence written: ${outFile}`);
  }
}

main();
