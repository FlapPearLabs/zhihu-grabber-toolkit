/**
 * research-orchestration/bin/runtime-authority.mjs
 *
 * Generic loader for the project runtime-authority declaration.
 * The declaring file (bin/runtime-authority.json) is PROJECT-OWNED: all
 * runtime/model/credential/env/ledger names live there. This loader and the
 * harness/preflight contain no vendor or project names (statically enforced).
 */

import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN_DIR = pathResolve(fileURLToPath(import.meta.url), '..');
export const REPO_ROOT = pathResolve(BIN_DIR, '..', '..');
export const RO_DIR = pathResolve(REPO_ROOT, 'research-orchestration');

export function loadRuntimeAuthority(path = pathResolve(BIN_DIR, 'runtime-authority.json')) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (raw.schema !== 'runtime-authority/1') throw new Error('runtime authority schema mismatch');
  if (!raw.canonical?.runtimeId || !raw.canonical?.model || !raw.canonical?.credentialEnv) {
    throw new Error('runtime authority missing canonical runtimeId/model/credentialEnv');
  }
  if (!raw.localSmoke?.class || raw.localSmoke.class !== 'LOCAL_NONCANONICAL_SMOKE') {
    throw new Error('runtime authority missing/invalid localSmoke declaration');
  }
  return raw;
}
