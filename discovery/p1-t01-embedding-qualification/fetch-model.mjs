#!/usr/bin/env node
/**
 * DISCOVERY-ONLY (P1-T01 / Issue #33) — one-time local model weight acquisition.
 *
 * WHY THIS IS A SEPARATE STEP
 * ---------------------------
 * The qualification battery must be able to run with ZERO outbound network access
 * (that is the empirical basis for the NO_NEW_EGRESS claim, acceptance criterion
 * AC_11). Therefore model acquisition is deliberately separated from battery
 * execution: this script is the ONLY step that touches the network, and it fetches
 * model weights only — never corpus text.
 *
 * EXACT-REVISION REPRODUCIBILITY (R1 repair, review finding P1-1)
 * ---------------------------------------------------------------
 * Resolving `resolve/main/<file>` at download time does NOT mechanically reproduce
 * the exact reviewed model snapshot. This script therefore supports
 *
 *     --revision <sha>
 *
 * which:
 *   1. validates the revision against the Hub API for that model,
 *   2. FAILS CLOSED if the revision is unavailable or the API-resolved sha differs,
 *   3. fetches EVERY required file from that exact revision
 *      (`resolve/<revision>/<file>`, never `resolve/main/`),
 *   4. records requested + resolved revision in identity.json,
 *      including the per-file source revision.
 *
 * There is NO fallback to `main`. A silent fallback would make the reviewed
 * snapshot unreproducible and is forbidden.
 *
 * EGRESS CLASS OF THIS SCRIPT
 * ---------------------------
 *   direction : inbound (download)
 *   payload   : public pre-trained model weights + public model metadata
 *   corpus    : NONE
 *   credential: NONE
 *
 * USAGE
 *   node discovery/p1-t01-embedding-qualification/fetch-model.mjs \
 *     [--model Xenova/bge-base-zh-v1.5] [--revision <40-hex sha>] [--dir <local model dir>]
 *
 * If you are behind an HTTP proxy, Node's env-proxy agent must be enabled:
 *   export HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897
 *   export NODE_USE_ENV_PROXY=1
 * (Node 22.x: EnvHttpProxyAgent is experimental and is opt-in.)
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { model: 'Xenova/bge-base-zh-v1.5', revision: null, dir: join(HERE, 'models') };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--model') out.model = argv[++i];
    else if (argv[i] === '--revision') out.revision = argv[++i];
    else if (argv[i] === '--dir') out.dir = resolve(argv[++i]);
  }
  return out;
}

function failClosed(reason) {
  console.error(`FAIL_CLOSED: ${reason}`);
  process.exit(2);
}

const REVISION_RE = /^[0-9a-f]{40}$/;
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

async function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function resolveRevision(model, requested) {
  // A pinned revision is mandatory for a reviewed profile: `main` moves.
  if (!requested) failClosed('no --revision provided. Exact-revision acquisition is required; refusing to fetch from a moving ref (main).');
  if (!REVISION_RE.test(requested)) failClosed(`--revision "${requested}" is not a 40-hex commit sha`);

  const url = `https://huggingface.co/api/models/${model}/revision/${requested}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    failClosed(`revision lookup network error for ${requested}: ${err?.message ?? err}`);
  }
  if (res.status === 404) failClosed(`revision ${requested} does not exist for model ${model} (HTTP 404)`);
  if (!res.ok) failClosed(`revision lookup failed for ${requested}: HTTP ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch {
    failClosed(`revision lookup returned a non-JSON body for ${requested}`);
  }
  const resolved = body?.sha ?? null;
  if (!resolved) failClosed(`revision lookup for ${requested} returned no sha`);
  if (resolved !== requested) {
    failClosed(`revision mismatch: requested ${requested}, hub resolved ${resolved}. Refusing to proceed.`);
  }
  return { requested, resolved };
}

async function main() {
  const { model, revision, dir } = parseArgs(process.argv);

  const rev = await resolveRevision(model, revision);
  console.log(`model          : ${model}`);
  console.log(`revision (pin) : ${rev.requested}`);
  console.log(`revision (hub) : ${rev.resolved}`);

  const target = join(dir, model);
  await mkdir(target, { recursive: true });

  const files = [];
  for (const rel of FILES) {
    // Exact revision only: `resolve/main/` is intentionally never used.
    const url = `https://huggingface.co/${model}/resolve/${rev.resolved}/${rel}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      failClosed(`fetch failed for ${rel} at revision ${rev.resolved}: HTTP ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const outPath = join(target, rel);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, bytes);
    files.push({
      path: rel,
      bytes: bytes.length,
      sha256: await sha256(bytes),
      sourceRevision: rev.resolved,
    });
    console.log(`  ${rel.padEnd(28)} ${String(bytes.length).padStart(10)} bytes  sha256=${files.at(-1).sha256}`);
  }

  const identity = {
    schemaVersion: 2,
    batteryStep: 'P1_T01_MODEL_ACQUISITION',
    modelId: model,
    requestedRevision: rev.requested,
    revisionSha: rev.resolved,
    acquisition: {
      direction: 'inbound',
      payloadClass: 'public_model_weights',
      corpusEgress: false,
      credentialUsed: false,
      exactRevisionPinned: true,
      fallbackToMainUsed: false,
    },
    files,
  };

  await writeFile(join(target, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  await writeFile(join(dir, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  console.log(`identity.json  : ${dir}/identity.json (schemaVersion 2, exact-revision pinned)`);
}

main().catch((err) => {
  console.error(`fetch-model failed: ${err?.message ?? err}`);
  process.exit(1);
});
