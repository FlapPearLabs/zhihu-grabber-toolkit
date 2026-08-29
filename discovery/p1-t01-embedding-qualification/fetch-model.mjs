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
 * EGRESS CLASS OF THIS SCRIPT
 * ---------------------------
 *   direction : inbound (download)
 *   payload   : public pre-trained model weights + public model metadata
 *   corpus    : NONE
 *   credential: NONE
 *
 * USAGE
 *   node discovery/p1-t01-embedding-qualification/fetch-model.mjs \
 *     [--model Xenova/bge-small-zh-v1.5] [--dir <local model dir>]
 *
 * If you are behind an HTTP proxy, Node's env-proxy agent must be enabled:
 *   export HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897
 *   export NODE_USE_ENV_PROXY=1
 * (Node 22.x: EnvHttpProxyAgent is experimental and is opt-in.)
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { model: 'Xenova/bge-small-zh-v1.5', dir: join(HERE, 'models') };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--model') out.model = argv[++i];
    else if (argv[i] === '--dir') out.dir = resolve(argv[++i]);
  }
  return out;
}

const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

async function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const { model, dir } = parseArgs(process.argv);
  const target = join(dir, model);
  await mkdir(target, { recursive: true });

  const files = [];
  for (const rel of FILES) {
    const url = `https://huggingface.co/${model}/resolve/main/${rel}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`fetch failed for ${rel}: HTTP ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const outPath = join(target, rel);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, bytes);
    files.push({ path: rel, bytes: bytes.length, sha256: await sha256(bytes) });
  }

  // Model revision identity (public metadata; no credential involved).
  let revision = null;
  try {
    const meta = await fetch(`https://huggingface.co/api/models/${model}`);
    if (meta.ok) {
      const body = await meta.json();
      revision = body?.sha ?? null;
    }
  } catch {
    revision = null; // UNKNOWN, not PASS: reported as-is.
  }

  const identity = {
    schemaVersion: 1,
    batteryStep: 'P1_T01_MODEL_ACQUISITION',
    modelId: model,
    revisionSha: revision,
    acquisition: {
      direction: 'inbound',
      payloadClass: 'public_model_weights',
      corpusEgress: false,
      credentialUsed: false,
    },
    files,
  };

  await writeFile(join(target, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  await writeFile(join(dir, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);

  const loaded = JSON.parse(await readFile(join(dir, 'identity.json'), 'utf8'));
  console.log(`model          : ${loaded.modelId}`);
  console.log(`revisionSha    : ${loaded.revisionSha ?? 'UNKNOWN'}`);
  console.log(`localModelPath : ${dir}`);
  for (const f of loaded.files) console.log(`  ${f.path}  ${f.bytes} bytes  sha256=${f.sha256}`);
}

main().catch((err) => {
  console.error(`fetch-model failed: ${err?.message ?? err}`);
  process.exit(1);
});
