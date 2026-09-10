// SPDX-License-Identifier: AGPL-3.0-only
/**
 * lib/global-search-bridge-child.mjs
 *
 * P1-T15 D3 POST-MERGE REPAIR (Issue #47): global_search sync-bridge child
 * lifecycle, extracted from the p1-runtime-composer -e script so the child
 * core is directly testable and the child process can drain naturally.
 *
 * Defect (mechanically proven by the P1-T16 canonical dogfood): the old -e
 * script wrote the COMPLETE provider response to stdout and then called
 * process.exit() from inside the async stdin 'end' continuation. On Windows
 * that explicit exit races libuv's async stdin teardown ("Assertion failed:
 * !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c", exit 0xC0000409),
 * so the parent's (correct) nonzero-exit validation classified a COMPLETED
 * response as a transport failure.
 *
 * Contract (owner ruling 2026-09-10/11):
 *   - LIFECYCLE ONLY: never process.exit() mid-async; report the exit INTENT
 *     as a return value (0 success / nonzero failure) and let the process
 *     drain naturally;
 *   - the parent's nonzero-exit + stdout validation stays unchanged and still
 *     classifies an abnormal exit as a transport failure (never a "pretend
 *     success");
 *   - the access secret is resolved HERE (ZHIHU_SECRET env, then
 *     zhihu_secret.txt in the stdin-passed secretDirs — the same resolution
 *     the grabber preflight exposes), stays inside this module, and is never
 *     written out: only { status, body } payloads reach the writer. An
 *     HTTP-level provider response (including non-2xx) is a COMPLETED
 *     exchange: exit intent 0, status/body passed through verbatim for the
 *     parent/adapter to judge; only a transport-level failure (fetch
 *     rejection, malformed request, missing credential) is nonzero.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Exit intent: success (the only process status the parent accepts). */
export const BRIDGE_EXIT_OK = 0;
/** Exit intent: transport-level failure (the parent's validation maps this to a throw). */
export const BRIDGE_EXIT_FAILURE = 1;

const SECRET_FILENAME = 'zhihu_secret.txt';

function readSecretFile(filePath) {
  return readFileSync(filePath, 'utf8');
}

/**
 * Secret resolution stays INSIDE the bridge: env first (the grabber preflight
 * convention), then the git-ignored secret file in each passed directory.
 * Returns '' when no credential source resolves.
 */
function resolveAccessSecret({ env, secretDirs, secretFileReader }) {
  const fromEnv = String(env?.ZHIHU_SECRET ?? '').trim();
  if (fromEnv) return fromEnv;
  for (const dir of Array.isArray(secretDirs) ? secretDirs : []) {
    try {
      const raw = secretFileReader(path.join(String(dir), SECRET_FILENAME)).trim();
      if (raw) return raw;
    } catch { /* try next location */ }
  }
  return '';
}

/**
 * Run one bridge child exchange and report the exit INTENT (never exit the
 * process).
 *
 * @param {object} [opts]
 * @param {{ url: string, query: string, count: unknown, secretDirs?: string[] }} [opts.request]
 *     the parent's stdin request ({ url, query, count, secretDirs }).
 * @param {typeof fetch} [opts.fetchImpl] injectable fetch (offline tests).
 * @param {object} [opts.env] injectable env for secret resolution.
 * @param {(filePath: string) => string} [opts.secretFileReader] injectable secret-file reader.
 * @param {{ write(s: string): unknown }} [opts.writer] injectable stdout writer.
 * @returns {Promise<number>} 0 (BRIDGE_EXIT_OK) when the provider exchange
 *     completed (any HTTP status); nonzero (BRIDGE_EXIT_FAILURE) when the
 *     request is malformed, no credential resolves, or the transport itself
 *     failed (fetch rejection). The ONLY payloads ever written are
 *     { status, body } objects.
 */
export async function runGlobalSearchBridgeChild({
  request,
  fetchImpl = globalThis.fetch,
  env = process.env,
  secretFileReader = readSecretFile,
  writer = process.stdout,
} = {}) {
  const writePayload = (payload) => writer.write(JSON.stringify(payload));
  if (!request || typeof request !== 'object') {
    writePayload({ status: 0, body: '' });
    return BRIDGE_EXIT_FAILURE;
  }
  const key = resolveAccessSecret({ env, secretDirs: request.secretDirs, secretFileReader });
  if (!key) {
    writePayload({ status: 0, body: '' });
    return BRIDGE_EXIT_FAILURE;
  }
  try {
    const url = new URL(String(request.url));
    url.searchParams.set('Query', String(request.query));
    url.searchParams.set('Count', String(request.count));
    const res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + key,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    });
    const body = await res.text();
    writePayload({ status: res.status, body });
    return BRIDGE_EXIT_OK;
  } catch {
    // Transport failure: surfaced via the nonzero exit intent and mapped (by
    // the parent's UNCHANGED validation) to the adapter's
    // PROVIDER_TRANSPORT_FAILURE semantics — never a forged success.
    writePayload({ status: 0, body: '' });
    return BRIDGE_EXIT_FAILURE;
  }
}
