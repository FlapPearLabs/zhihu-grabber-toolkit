#!/usr/bin/env node
/**
 * DISCOVERY-ONLY (P1-T01 / Issue #33) — EmbeddingProvider qualification battery runner.
 *
 * This script is evidence-collection tooling for a DISCOVERY/EVIDENCE ticket.
 * It is NOT the production EmbeddingProvider adapter (that is P1-T10) and it is
 * deliberately isolated from every production package:
 *
 *   - it lives outside zhihu-answer-grabber/, corpus-anthology/ and research-orchestration/;
 *   - it has its own package.json and lockfile;
 *   - no production module imports it.
 *
 * USAGE
 *   node discovery/p1-t01-embedding-qualification/qualify-embedding-provider.mjs \
 *     [--provider <id|all>] [--out <file.json>] [--json]
 *
 * Provider ids:
 *   transformersjs-local-bge-small-zh-v1.5   (LOCAL, in-process ONNX)
 *   lmstudio-local-nomic-embed-text-v1.5     (LOCAL, loopback server)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProvider as createOnnxProvider } from './providers/transformersjs-local-onnx.mjs';
import { createProvider as createLmstudioProvider } from './providers/lmstudio-openai-embeddings.mjs';
import { FAILURE_CODES, redact } from './providers/errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'zh-semantic-battery.json');

const DETERMINISM_TOLERANCE = 1e-6;
const NORM_TOLERANCE = 1e-3;
const RELEVANCE_MIN_MARGIN = 0.1;

function parseArgs(argv) {
  const out = { provider: 'all', out: null, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--provider') out.provider = argv[++i];
    else if (argv[i] === '--out') out.out = resolve(argv[++i]);
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function cos(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return Number.NaN;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function l2norm(a) {
  let s = 0;
  for (const x of a) s += x * x;
  return Math.sqrt(s);
}

function allFinite(a) {
  for (const x of a) if (!Number.isFinite(x)) return false;
  return true;
}

const r4 = (n) => (Number.isFinite(n) ? Number(n.toFixed(4)) : null);

const PROVIDERS = {
  // Default entry: the small Chinese model in ./models (see fetch-model.mjs).
  'transformersjs-local-bge-small-zh-v1.5': createOnnxProvider,
  // Env-driven entry so an alternative ONNX model can be qualified without editing code:
  //   P1_T01_ONNX_MODEL / P1_T01_ONNX_MODEL_DIR
  'transformersjs-local-onnx': createOnnxProvider,
  'lmstudio-local-nomic-embed-text-v1.5': createLmstudioProvider,
};

async function embedTimed(provider, texts) {
  const t0 = performance.now();
  const res = await provider.embed(texts);
  const ms = performance.now() - t0;
  return { ...res, ms };
}

function checkVectorContract(provider, vectors, sink) {
  const dims = new Set();
  let nonFinite = 0;
  const norms = [];
  for (const v of vectors) {
    dims.add(v.length);
    if (!allFinite(v)) nonFinite += 1;
    norms.push(l2norm(v));
  }
  sink.observedDimensions = [...dims].sort((a, b) => a - b);
  sink.nonFiniteVectors = nonFinite;
  sink.normMin = r4(Math.min(...norms));
  sink.normMax = r4(Math.max(...norms));
  const dimStable = dims.size === 1;
  // A normalized profile means every vector has unit L2 norm.
  const normSpread = Math.max(...norms) - Math.min(...norms);
  const unitNorm = Math.abs(Math.min(...norms) - 1) <= NORM_TOLERANCE && Math.abs(Math.max(...norms) - 1) <= NORM_TOLERANCE;
  return { dimStable, unitNorm, normSpread: Number(normSpread.toFixed(8)) };
}

async function runBattery(provider, battery) {
  const allVectors = [];
  const timings = [];
  const result = {
    providerIdentity: provider.describe(),
    health: null,
    AC_1_relevance: { items: [], pass: false },
    AC_2_near_duplicate_vs_novel: { items: [], pass: false },
    AC_3_terminology_variation: { items: [], pass: false },
    AC_4_paraphrase_above_opposing: { paraphrase: [], opposing: [], minParaphrase: null, maxOpposing: null, pass: false },
    AC_4b_opposing_within_anchor: { items: [], pass: false },
    AC_5_short_query_to_long_passage: { items: [], pass: false },
    AC_6_determinism: { items: [], pass: false },
    AC_7_malformed_input: { items: [], pass: null },
    AC_8_vector_contract: {},
    AC_9_identity: {},
    AC_10_failure_identity: {},
  };

  try {
    result.health = await provider.health();
  } catch (err) {
    result.health = { ok: false, failureCode: err?.failureCode ?? 'UNKNOWN', message: redact(String(err?.message ?? err)) };
    result.aborted = `health check failed: ${result.health.failureCode}`;
    return result;
  }

  const embed = async (texts) => {
    const r = await embedTimed(provider, texts);
    allVectors.push(...r.vectors);
    timings.push({ n: texts.length, ms: Number(r.ms.toFixed(2)) });
    return r.vectors;
  };

  // ---- AC_1 relevance
  for (const item of battery.groups.A_relevance.items) {
    const [av, rv, uv] = await embed([item.anchor, item.related, item.unrelated]);
    const rel = cos(av, rv);
    const unrel = cos(av, uv);
    result.AC_1_relevance.items.push({ id: item.id, cos_related: r4(rel), cos_unrelated: r4(unrel), margin: r4(rel - unrel), pass: rel - unrel >= RELEVANCE_MIN_MARGIN });
  }
  result.AC_1_relevance.pass = result.AC_1_relevance.items.every((i) => i.pass);

  // ---- AC_2 near-duplicate vs same-topic-novel
  for (const item of battery.groups.B_near_duplicate_vs_novel.items) {
    const [av, dv, nv] = await embed([item.anchor, item.near_duplicate, item.same_topic_novel]);
    const nd = cos(av, dv);
    const nov = cos(av, nv);
    result.AC_2_near_duplicate_vs_novel.items.push({ id: item.id, cos_near_duplicate: r4(nd), cos_same_topic_novel: r4(nov), margin: r4(nd - nov), pass: nd > nov });
  }
  result.AC_2_near_duplicate_vs_novel.pass = result.AC_2_near_duplicate_vs_novel.items.every((i) => i.pass);

  // ---- AC_3 terminology variation
  for (const item of battery.groups.C_terminology_variation.items) {
    const [av, bv, cv] = await embed([item.a, item.b, item.unrelated_control]);
    const ab = cos(av, bv);
    const ac = cos(av, cv);
    result.AC_3_terminology_variation.items.push({ id: item.id, cos_variant: r4(ab), cos_unrelated_control: r4(ac), margin: r4(ab - ac), pass: ab > ac });
  }
  result.AC_3_terminology_variation.pass = result.AC_3_terminology_variation.items.every((i) => i.pass);

  // ---- AC_4 paraphrase must out-score opposing framing
  for (const item of battery.groups.E_paraphrase_reference.items) {
    const [av, bv] = await embed([item.a, item.b]);
    result.AC_4_paraphrase_above_opposing.paraphrase.push({ id: item.id, cos: r4(cos(av, bv)) });
  }
  for (const item of battery.groups.D_opposing_framing.items) {
    const [av, bv] = await embed([item.a, item.b]);
    result.AC_4_paraphrase_above_opposing.opposing.push({ id: item.id, cos: r4(cos(av, bv)) });
  }
  const pmin = Math.min(...result.AC_4_paraphrase_above_opposing.paraphrase.map((x) => x.cos));
  const omax = Math.max(...result.AC_4_paraphrase_above_opposing.opposing.map((x) => x.cos));
  result.AC_4_paraphrase_above_opposing.minParaphrase = r4(pmin);
  result.AC_4_paraphrase_above_opposing.maxOpposing = r4(omax);
  result.AC_4_paraphrase_above_opposing.margin = r4(pmin - omax);
  result.AC_4_paraphrase_above_opposing.pass = pmin > omax;

  // ---- AC_4b within-anchor opposing vs paraphrase (decision-relevant form of AC_4)
  for (const item of battery.groups.I_opposing_within_anchor.items) {
    const [av, pv, ov] = await embed([item.anchor, item.paraphrase, item.opposing]);
    const cp = cos(av, pv);
    const co = cos(av, ov);
    result.AC_4b_opposing_within_anchor.items.push({
      id: item.id,
      cos_paraphrase: r4(cp),
      cos_opposing: r4(co),
      margin: r4(cp - co),
      pass: cp > co,
    });
  }
  result.AC_4b_opposing_within_anchor.pass = result.AC_4b_opposing_within_anchor.items.every((i) => i.pass);

  // ---- AC_5 short query -> long passage ranking
  for (const item of battery.groups.F_short_query_to_long_passage.items) {
    const [qv, onv, offv] = await embed([item.query, item.on_topic, item.off_topic]);
    const on = cos(qv, onv);
    const off = cos(qv, offv);
    result.AC_5_short_query_to_long_passage.items.push({ id: item.id, cos_on_topic: r4(on), cos_off_topic: r4(off), margin: r4(on - off), pass: on > off });
  }
  result.AC_5_short_query_to_long_passage.pass = result.AC_5_short_query_to_long_passage.items.every((i) => i.pass);

  // ---- AC_6 determinism
  const repeats = battery.groups.G_determinism.repeats;
  for (const item of battery.groups.G_determinism.items) {
    const runs = [];
    for (let i = 0; i < repeats; i += 1) runs.push((await embed([item.text]))[0]);
    let maxDelta = 0;
    for (let i = 1; i < runs.length; i += 1) {
      for (let k = 0; k < runs[0].length; k += 1) {
        maxDelta = Math.max(maxDelta, Math.abs(runs[i][k] - runs[0][k]));
      }
    }
    result.AC_6_determinism.items.push({ id: item.id, repeats, maxAbsDelta: Number(maxDelta.toExponential(3)), pass: maxDelta <= DETERMINISM_TOLERANCE });
  }
  result.AC_6_determinism.pass = result.AC_6_determinism.items.every((i) => i.pass);

  // ---- AC_7 malformed / boundary input
  for (const item of battery.groups.H_malformed.items) {
    const text = item.generate?.kind === 'repeat' ? item.generate.base.repeat(item.generate.repeat) : item.text;
    const entry = { id: item.id, label: item.label, inputChars: text.length, outcome: null, failureCode: null, dim: null, norm: null };
    try {
      const [v] = await embed([text]);
      entry.outcome = 'VECTOR_RETURNED';
      entry.dim = v.length;
      entry.norm = r4(l2norm(v));
    } catch (err) {
      entry.outcome = 'FAILURE';
      entry.failureCode = err?.failureCode ?? 'UNCLASSIFIED';
      // Provider error messages can embed absolute local paths (e.g. ONNX model-dir
      // not-found). Evidence files are committed, so every stored message is redacted.
      entry.message = redact(String(err?.message ?? err)).slice(0, 200);
    }
    result.AC_7_malformed_input.items.push(entry);
  }
  // AC_7 is informational: any deterministic documented outcome (vector OR machine-readable
  // failure) is acceptable; "UNCLASSIFIED" is not.
  result.AC_7_malformed_input.pass = result.AC_7_malformed_input.items.every((i) => i.failureCode !== 'UNCLASSIFIED');
  result.AC_7_malformed_input.note = 'pass = every malformed input produced either a valid vector or a classified machine-readable failure code.';

  // ---- AC_8 vector contract
  const contract = checkVectorContract(provider, allVectors, result.AC_8_vector_contract);
  result.AC_8_vector_contract.dimensionStable = contract.dimStable;
  result.AC_8_vector_contract.normalizationProfile = contract.unitNorm ? 'L2_UNIT_NORM' : 'NOT_UNIT_NORM';
  result.AC_8_vector_contract.normSpread = contract.normSpread;
  result.AC_8_vector_contract.vectorsExamined = allVectors.length;
  result.AC_8_vector_contract.pass = contract.dimStable && result.AC_8_vector_contract.nonFiniteVectors === 0;

  // ---- AC_9 identity
  const lastMeta = result.health ?? {};
  result.AC_9_identity = {
    declaredModelId: provider.modelId,
    echoedModelId: null,
    revisionSha: lastMeta.revisionSha ?? null,
    transport: provider.transport,
    requiresCredential: provider.requiresCredential,
  };
  try {
    const meta = (await embedTimed(provider, ['身份回显检查'])).meta;
    result.AC_9_identity.echoedModelId = meta?.echoedModel ?? null;
    result.AC_9_identity.revisionSha = meta?.revisionSha ?? result.AC_9_identity.revisionSha;
    result.AC_9_identity.dtype = meta?.dtype ?? null;
  } catch {
    result.AC_9_identity.echoedModelId = null;
  }
  result.AC_9_identity.pass =
    (result.AC_9_identity.echoedModelId ?? result.AC_9_identity.declaredModelId) === result.AC_9_identity.declaredModelId;

  // ---- AC_10 failure identity
  result.AC_10_failure_identity = await probeFailureIdentity(provider);
  // A provider that ACCEPTS an unknown model name and still returns vectors is a
  // silent fallback, not a classified failure. Per Spec §10.2 NO_SILENT_PROVIDER_FALLBACK
  // that must count as FAIL, not PASS.
  const classified = (e) =>
    Boolean(e) && e.outcome === 'FAILURE' && Boolean(e.failureCode) && e.failureCode !== 'UNCLASSIFIED';
  result.AC_10_failure_identity.pass =
    classified(result.AC_10_failure_identity.unknownModel) &&
    classified(result.AC_10_failure_identity.unreachableEndpoint);
  result.AC_10_failure_identity.note =
    'unknown model name MUST produce a classified machine-readable failure. Returning vectors for an unknown model is a silent fallback and is scored FAIL.';

  result.latency = {
    batches: timings.length,
    perBatchMs: timings.map((t) => ({ n: t.n, ms: t.ms })),
    totalMs: Number(timings.reduce((s, t) => s + t.ms, 0).toFixed(2)),
  };

  return result;
}

async function probeFailureIdentity(provider) {
  const out = { unknownModel: null, unreachableEndpoint: null };

  // (a) unknown model name against the SAME provider family
  try {
    const bogus =
      provider.providerId === 'lmstudio-local-embeddings'
        ? (await import('./providers/lmstudio-openai-embeddings.mjs')).createProvider({ model: 't01-probe-no-such-model' })
        : (await import('./providers/transformersjs-local-onnx.mjs')).createProvider({ model: 'T01Probe/no-such-model' });
    await bogus.embed(['失败身份探测']);
    out.unknownModel = { outcome: 'NO_FAILURE', failureCode: 'NONE', note: 'provider accepted an unknown model name' };
  } catch (err) {
    out.unknownModel = { outcome: 'FAILURE', failureCode: err?.failureCode ?? 'UNCLASSIFIED', message: redact(String(err?.message ?? err)).slice(0, 200) };
  }

  // (b) unreachable loopback endpoint
  try {
    const dead = (await import('./providers/lmstudio-openai-embeddings.mjs')).createProvider({
      baseUrl: 'http://127.0.0.1:9',
      timeoutMs: 5_000,
    });
    await dead.embed(['失败身份探测']);
    out.unreachableEndpoint = { outcome: 'NO_FAILURE', failureCode: 'NONE' };
  } catch (err) {
    out.unreachableEndpoint = { outcome: 'FAILURE', failureCode: err?.failureCode ?? 'UNCLASSIFIED', message: redact(String(err?.message ?? err)).slice(0, 200) };
  }
  return out;
}

function summarize(result) {
  const acs = ['AC_1_relevance', 'AC_2_near_duplicate_vs_novel', 'AC_3_terminology_variation', 'AC_4b_opposing_within_anchor', 'AC_5_short_query_to_long_passage', 'AC_6_determinism', 'AC_7_malformed_input', 'AC_8_vector_contract', 'AC_9_identity', 'AC_10_failure_identity'];
  const counts = { pass: 0, fail: 0, unknown: 0 };
  for (const key of acs) {
    const v = result[key]?.pass;
    if (v === true) counts.pass += 1;
    else if (v === false) counts.fail += 1;
    else counts.unknown += 1;
  }
  return { ...counts, total: acs.length };
}

async function main() {
  const args = parseArgs(process.argv);
  const battery = JSON.parse(await readFile(FIXTURE, 'utf8'));
  const selected =
    args.provider === 'all'
      ? Object.keys(PROVIDERS)
      : [args.provider];

  const report = {
    schemaVersion: 1,
    artifact: 'P1_T01_EMBEDDING_QUALIFICATION_EVIDENCE',
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    battery: {
      id: battery.battery_id,
      version: battery.version,
      provenanceClass: battery.provenance.class,
      containsRealCorpus: battery.provenance.contains_real_zhihu_corpus || battery.provenance.contains_real_external_corpus,
      egressClass: battery.provenance.egress_class,
    },
    runMode: {
      offlineEnforced: process.env.P1_T01_OFFLINE_ENFORCED === '1',
      note: 'offlineEnforced=true means the runner was executed with a black-hole proxy configured (AC_11).',
    },
    candidates: [],
  };

  for (const id of selected) {
    const factory = PROVIDERS[id];
    if (!factory) {
      report.candidates.push({ id, error: 'unknown provider id' });
      continue;
    }
    const provider = factory();
    const t0 = performance.now();
    const result = await runBattery(provider, battery);
    result.summary = summarize(result);
    result.totalMs = Number((performance.now() - t0).toFixed(2));
    report.candidates.push({ id, ...result });
  }

  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
}

function printHuman(report) {
  console.log(`battery   : ${report.battery.id} v${report.battery.version}`);
  console.log(`provenance: ${report.battery.provenanceClass} (containsRealCorpus=${report.battery.containsRealCorpus})`);
  console.log(`node      : ${report.node} / ${report.platform}`);
  console.log(`offlineRun: ${report.runMode.offlineEnforced}\n`);
  for (const c of report.candidates) {
    console.log(`==== ${c.id} ====`);
    if (c.error) {
      console.log(`  error: ${c.error}\n`);
      continue;
    }
    if (c.aborted) {
      console.log(`  ABORTED: ${c.aborted}\n`);
      continue;
    }
    const id = c.providerIdentity;
    console.log(`  category=${id.providerCategory} provider=${id.providerId} model=${id.modelId} transport=${id.transport}`);
    const s = c.summary;
    console.log(`  AC summary: pass=${s.pass} fail=${s.fail} unknown=${s.unknown} / ${s.total}`);
    for (const [k, v] of Object.entries(c)) {
      if (!k.startsWith('AC_')) continue;
      const flag = v.pass === true ? 'PASS' : v.pass === false ? 'FAIL' : 'N/A ';
      console.log(`    [${flag}] ${k}${detailFor(k, v)}`);
    }
    console.log(`  latency: total=${c.latency?.totalMs}ms over ${c.latency?.batches} batches (wall ${c.totalMs}ms)\n`);
  }
}

function detailFor(key, v) {
  if (key === 'AC_4_paraphrase_above_opposing') return `  [INFORMATIONAL / cross-topic] minParaphrase=${v.minParaphrase} maxOpposing=${v.maxOpposing} margin=${v.margin}`;
  if (key === 'AC_4b_opposing_within_anchor') return `  margins=${v.items.map((i) => `${i.id}:${i.margin}`).join(' ')}`;
  if (key === 'AC_8_vector_contract') return `  dims=${JSON.stringify(v.observedDimensions)} norm=[${v.normMin},${v.normMax}] profile=${v.normalizationProfile}`;
  if (key === 'AC_1_relevance') return `  margins=${v.items.map((i) => `${i.id}:${i.margin}`).join(' ')}`;
  if (key === 'AC_2_near_duplicate_vs_novel') return `  margins=${v.items.map((i) => `${i.id}:${i.margin}`).join(' ')}`;
  if (key === 'AC_3_terminology_variation') return `  margins=${v.items.map((i) => `${i.id}:${i.margin}`).join(' ')}`;
  if (key === 'AC_5_short_query_to_long_passage') return `  margins=${v.items.map((i) => `${i.id}:${i.margin}`).join(' ')}`;
  if (key === 'AC_6_determinism') return `  maxDelta=${v.items.map((i) => i.maxAbsDelta).join(' ')}`;
  if (key === 'AC_7_malformed_input') return `  ${v.items.map((i) => `${i.label}:${i.outcome}${i.failureCode ? `/${i.failureCode}` : ''}`).join(' ')}`;
  if (key === 'AC_10_failure_identity') return `  unknown=${v.unknownModel?.failureCode} unreachable=${v.unreachableEndpoint?.failureCode}`;
  return '';
}

main().catch((err) => {
  console.error(`qualify-embedding-provider failed: ${err?.stack ?? err?.message ?? err}`);
  process.exit(1);
});
