#!/usr/bin/env node
/**
 * DISCOVERY-ONLY (P1-T01 / Issue #33) — REMOTE embeddings CAPABILITY probe.
 *
 * SCOPE AND BOUNDARY (read before running)
 * ----------------------------------------
 * This probe answers ONE question only: does a given remote provider endpoint
 * expose an embeddings capability at all? It is a capability-existence probe,
 * NOT a quality qualification and NOT an egress authorization.
 *
 * Hard boundary enforced here (P1-T01 task rules §5: P1-T02 / GATE-2 is NOT active):
 *   - It sends ONLY handcrafted synthetic fixtures drawn from
 *     fixtures/zh-semantic-battery.json (provenance.class === SYNTHETIC_HANDCRAFTED).
 *   - It refuses to run if the fixture provenance class is anything else.
 *   - It accepts no corpus path, no corpus file and no captured-artifact input at all.
 *   - It never persists returned vectors; only scalar shape/identity metadata is reported.
 *   - It is opt-in: requires P1_T01_REMOTE_CAPABILITY_PROBE=1.
 *   - Output never contains credential values, hashes, prefixes, or private paths.
 *
 * If a remote provider is ever selected as the P1 implementation profile, P1-T02
 * (GATE-2, remote embedding egress authority) must pass separately. This probe does
 * not activate, pre-approve, or substitute for GATE-2.
 *
 * USAGE
 *   P1_T01_REMOTE_CAPABILITY_PROBE=1 \
 *   P1_T01_REMOTE_BASE_URL=https://api.deepseek.com \
 *   P1_T01_REMOTE_API_KEY=<key> \
 *   node discovery/p1-t01-embedding-qualification/providers/remote-capability-probe.mjs [--json]
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '..', 'fixtures', 'zh-semantic-battery.json');

const CANDIDATE_PATHS = ['/v1/embeddings', '/embeddings'];

function classify(status) {
  if (status === 404) return 'NO_EMBEDDINGS_ENDPOINT';
  if (status === 401 || status === 403) return 'AUTH_REJECTED';
  if (status === 400) return 'BAD_REQUEST';
  if (status === 200) return 'EMBEDDINGS_CAPABILITY_PRESENT';
  if (status === 405) return 'METHOD_OR_PATH_NOT_SUPPORTED';
  return `HTTP_${status}`;
}

async function main() {
  const jsonMode = process.argv.includes('--json');
  const enabled = process.env.P1_T01_REMOTE_CAPABILITY_PROBE === '1';
  const baseUrl = process.env.P1_T01_REMOTE_BASE_URL ?? '';
  const apiKey = process.env.P1_T01_REMOTE_API_KEY ?? '';

  const report = {
    schemaVersion: 1,
    probe: 'P1_T01_REMOTE_EMBEDDINGS_CAPABILITY',
    enabled,
    inputPolicy: {
      corpusEgress: false,
      fixtureClass: null,
      persistedVectors: false,
    },
    results: [],
    verdict: 'NOT_QUALIFIED',
    verdictReason: 'not_run',
  };

  if (!enabled) {
    report.verdictReason = 'probe_not_enabled';
    emit(jsonMode, report);
    return;
  }
  if (!baseUrl) {
    report.verdictReason = 'no_remote_base_url_configured';
    emit(jsonMode, report);
    return;
  }

  const battery = JSON.parse(await readFile(FIXTURE, 'utf8'));
  const provenanceClass = battery?.provenance?.class;
  report.inputPolicy.fixtureClass = provenanceClass ?? null;
  if (provenanceClass !== 'SYNTHETIC_HANDCRAFTED') {
    report.verdictReason = 'fixture_provenance_refused';
    emit(jsonMode, report);
    process.exitCode = 2;
    return;
  }
  if (battery?.provenance?.contains_real_zhihu_corpus || battery?.provenance?.contains_real_external_corpus) {
    report.verdictReason = 'fixture_contains_real_corpus_refused';
    emit(jsonMode, report);
    process.exitCode = 2;
    return;
  }

  // Two short handcrafted neutral strings. Deliberately tiny: this is a capability
  // existence check, not a quality measurement.
  const payload = [battery.groups.C_terminology_variation.items[0].a, battery.groups.C_terminology_variation.items[0].b];

  if (!apiKey) {
    report.verdictReason = 'no_remote_credential_configured';
    emit(jsonMode, report);
    return;
  }

  for (const path of CANDIDATE_PATHS) {
    const entry = { path, httpStatus: null, errorClass: null, embeddingCapability: 'UNKNOWN', observedDimension: null };
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: 'probe-capability-check', input: payload }),
      });
      entry.httpStatus = res.status;
      entry.errorClass = classify(res.status);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        const first = Array.isArray(body?.data) ? body.data[0]?.embedding : null;
        if (Array.isArray(first)) {
          entry.embeddingCapability = 'YES';
          entry.observedDimension = first.length;
        } else {
          entry.embeddingCapability = 'UNKNOWN';
          entry.errorClass = 'RESPONSE_SCHEMA_UNEXPECTED';
        }
      } else if (res.status === 404 || res.status === 405) {
        entry.embeddingCapability = 'NO';
      } else {
        entry.embeddingCapability = 'UNKNOWN';
      }
    } catch (err) {
      entry.errorClass = `NETWORK_ERROR:${err?.cause?.code ?? err?.code ?? 'unknown'}`;
      entry.embeddingCapability = 'UNKNOWN';
    }
    report.results.push(entry);
  }

  const anyYes = report.results.some((r) => r.embeddingCapability === 'YES');
  const allNo = report.results.length > 0 && report.results.every((r) => r.embeddingCapability === 'NO');
  if (anyYes) {
    report.verdict = 'CAPABILITY_PRESENT';
    report.verdictReason = 'embeddings_endpoint_responded';
  } else if (allNo) {
    report.verdict = 'CAPABILITY_ABSENT';
    report.verdictReason = 'no_embeddings_endpoint';
  } else {
    report.verdict = 'UNKNOWN';
    report.verdictReason = 'inconclusive';
  }
  emit(jsonMode, report);
}

function emit(jsonMode, report) {
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`probe                 : ${report.probe}`);
  console.log(`enabled               : ${report.enabled}`);
  console.log(`corpusEgress          : ${report.inputPolicy.corpusEgress}`);
  console.log(`fixtureClass          : ${report.inputPolicy.fixtureClass ?? 'n/a'}`);
  console.log(`persistedVectors      : ${report.inputPolicy.persistedVectors}`);
  for (const r of report.results) {
    console.log(
      `  ${r.path.padEnd(16)} http=${String(r.httpStatus ?? '-').padEnd(4)} class=${String(r.errorClass).padEnd(28)} capability=${r.embeddingCapability}${r.observedDimension ? ` dim=${r.observedDimension}` : ''}`,
    );
  }
  console.log(`verdict               : ${report.verdict} (${report.verdictReason})`);
}

main().catch((err) => {
  console.error(`remote-capability-probe failed: ${err?.message ?? err}`);
  process.exit(1);
});
