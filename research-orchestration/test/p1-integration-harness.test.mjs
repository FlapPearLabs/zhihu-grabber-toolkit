/**
 * research-orchestration/test/p1-integration-harness.test.mjs
 *
 * Offline-deterministic tests for the P1 execution-workflow repair
 * (workflow efficiency audit 2026-09-06): preflight classification,
 * tiered test plan, identity-chain verification, ledger policy.
 *
 * Pure logic only — no network, no product modules. The 2026-09-05
 * 8192-context LM Studio incident is encoded as a fixture
 * (RUNTIME_CONTEXT_INSUFFICIENT) so the preflight rule is pinned.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyPreflight,
  checkContextCapacity,
  checkDependencies,
  checkLocalArtifacts,
} from '../bin/integration-preflight.mjs';
import {
  buildTierPlan,
  verifyIdentityChain,
  buildLedger,
} from '../bin/p1-integration-harness.mjs';

const ID = 'sha256:' + 'a'.repeat(64);

function writeArtifacts(dir, { tamper = null, driftPlanHash = false } = {}) {
  const sb = { selectedCorpusIdentity: ID, planHash: 'p'.repeat(64) };
  const sc = {
    selectedCorpusIdentityRef: tamper === 'cref' ? 'sha256:' + 'b'.repeat(64) : ID,
    aggregateAnalyzedIdentity: { mappedAnalyzedSourceSetIdentity: ID },
    planHash: 'p'.repeat(64),
  };
  const sd = {
    preSynthesisGuard: {
      guardResult: 'PASS',
      selectedVerifiedSourceSetIdentity: ID,
      mappedAnalyzedSourceSetIdentity: tamper === 'guard' ? 'sha256:' + 'c'.repeat(64) : ID,
    },
    planHash: driftPlanHash ? 'q'.repeat(64) : 'p'.repeat(64),
  };
  writeFileSync(join(dir, 'seam-b-real.json'), JSON.stringify(sb));
  writeFileSync(join(dir, 'seam-c-real.json'), JSON.stringify(sc));
  writeFileSync(join(dir, 'seam-d-real.json'), JSON.stringify(sd));
}

describe('integration preflight classification', () => {
  test('all-pass checks -> PREFLIGHT_PASS', () => {
    const v = classifyPreflight([
      { check: 'runtime.model', status: 'PASS' },
      checkContextCapacity('qwen/qwen3-1.7b:2', 40960, 32768),
    ]);
    assert.equal(v.verdict, 'PREFLIGHT_PASS');
    assert.deepEqual(v.failedCodes, []);
  });

  test('8192-context incident fixture -> RUNTIME_CONTEXT_INSUFFICIENT (fail before product tests)', () => {
    const r = checkContextCapacity('qwen/qwen3-1.7b', 8192, 32768);
    assert.equal(r.status, 'FAIL');
    assert.equal(r.code, 'RUNTIME_CONTEXT_INSUFFICIENT');
    const v = classifyPreflight([r]);
    assert.equal(v.verdict, 'PREFLIGHT_FAIL');
    assert.deepEqual(v.failedCodes, ['RUNTIME_CONTEXT_INSUFFICIENT']);
  });

  test('unverifiable capacity fails closed (not silently passes)', () => {
    const r = checkContextCapacity('qwen/qwen3-1.7b', Number.NaN, 32768);
    assert.equal(r.status, 'FAIL');
    assert.equal(r.code, 'RUNTIME_CAPACITY_UNVERIFIABLE');
  });

  test('endpoint unreachable dominates verdict', () => {
    const v = classifyPreflight([
      { check: 'runtime.endpoint', status: 'FAIL', code: 'RUNTIME_ENDPOINT_UNREACHABLE' },
      checkContextCapacity('m', 40960, 32768),
    ]);
    assert.equal(v.verdict, 'PREFLIGHT_FAIL');
    assert.deepEqual(v.failedCodes, ['RUNTIME_ENDPOINT_UNREACHABLE']);
  });

  test('warnings do not fail preflight', () => {
    const v = classifyPreflight([checkDependencies(true, false)]);
    assert.equal(v.verdict, 'PREFLIGHT_PASS');
    assert.equal(v.warnings.length, 1);
  });

  test('missing deps is FAIL, missing transformers is WARN', () => {
    assert.equal(checkDependencies(false, false).code, 'DEPS_NODE_MODULES_MISSING');
    assert.equal(checkDependencies(true, false).code, 'DEPS_TRANSFORMERS_MISSING');
    assert.equal(checkDependencies(true, true).status, 'PASS');
  });

  test('missing local artifacts list exact paths', () => {
    const r = checkLocalArtifacts([
      { path: '/x/seam-b-real.json', exists: true },
      { path: '/x/seam-d-real.json', exists: false },
    ]);
    assert.equal(r.status, 'FAIL');
    assert.match(r.detail, /seam-d-real\.json/);
    assert.ok(!/seam-b-real\.json, missing|missing:.*seam-b/.test(r.detail));
  });
});

describe('tiered test plan (intermediate stages run NO full suite)', () => {
  test('plan is focused + affected gate only', () => {
    const p = buildTierPlan({ ticket: 'p1-t13', focus: 'test/p1-t13-group-representation-claims.test.mjs', gate: 'test/p1-seam-c-real-conformance.test.mjs' });
    assert.equal(p.tier, 'INTERMEDIATE');
    assert.equal(p.fullSuite, false);
    assert.deepEqual(p.files, ['test/p1-t13-group-representation-claims.test.mjs', 'test/p1-seam-c-real-conformance.test.mjs']);
  });
  test('empty plan allowed (merge-only stage)', () => {
    const p = buildTierPlan({});
    assert.deepEqual(p.files, []);
    assert.equal(p.fullSuite, false);
  });
});

describe('identity-chain verification over real artifacts', () => {
  let dir;
  test('consistent chain passes', () => {
    dir = mkdtempSync(join(tmpdir(), 'p1-chain-ok-'));
    writeArtifacts(dir);
    const r = verifyIdentityChain({ seamB: join(dir, 'seam-b-real.json'), seamC: join(dir, 'seam-c-real.json'), seamD: join(dir, 'seam-d-real.json') });
    assert.equal(r.pass, true);
    assert.equal(r.identity, ID);
  });
  test('tampered echo / guard / planHash produce named failures', () => {
    for (const tamper of ['cref', 'guard']) {
      const d = mkdtempSync(join(tmpdir(), 'p1-chain-bad-'));
      writeArtifacts(d, { tamper });
      const r = verifyIdentityChain({ seamB: join(d, 'seam-b-real.json'), seamC: join(d, 'seam-c-real.json'), seamD: join(d, 'seam-d-real.json') });
      assert.equal(r.pass, false);
      rmSync(d, { recursive: true, force: true });
    }
    const d2 = mkdtempSync(join(tmpdir(), 'p1-chain-hash-'));
    writeArtifacts(d2, { driftPlanHash: true });
    const r2 = verifyIdentityChain({ seamB: join(d2, 'seam-b-real.json'), seamC: join(d2, 'seam-c-real.json'), seamD: join(d2, 'seam-d-real.json') });
    assert.equal(r2.pass, false);
    assert.ok(r2.failures.some((f) => f.includes('planHash')));
    rmSync(d2, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('execution ledger policy', () => {
  test('ledger records master-update refusal and step timings', () => {
    const steps = [
      { name: 'preflight', startedAt: 't0', finishedAt: 't1', durationMs: 5, outcome: 'PASS' },
      { name: 'tests.full-offline', startedAt: 't1', finishedAt: 't2', durationMs: 900, outcome: 'PASS' },
    ];
    const l = buildLedger({ stage: 'FINAL', base: 'b'.repeat(40), worker: null, mergeCommit: 'm'.repeat(40), steps, extra: { live: false } });
    assert.equal(l.schema, 'p1-execution-ledger/1');
    assert.match(l.masterUpdate, /REFUSED_BY_HARNESS/);
    assert.equal(l.steps.length, 2);
    assert.equal(l.steps[1].durationMs, 900);
  });
});
