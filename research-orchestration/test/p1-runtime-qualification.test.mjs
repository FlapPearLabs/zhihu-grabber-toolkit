// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-runtime-qualification.test.mjs
 *
 * Capability isolation is gated PER RUNTIME: only a runtime with a NAMED
 * `CAPABILITY_ISOLATION_AVAILABLE[runtime] = YES` in the approved scope may be
 * enabled, and `NO`/`UNKNOWN` fails closed as
 * `capability_isolation_unavailable` — no cross-runtime inference, no silent
 * fallback (docs/specs/v0.3-product-scope.md §5 / R2-4, §T5; the named YES
 * runtimes are listed in docs/specs/research-orchestration-scope.md §1).
 *
 * Selecting a model is what ENABLES a runtime, so the selection path is the
 * gate:
 *
 *   Q1  a provider/model with no named qualification is refused with
 *       `capability_isolation_unavailable` before any credential or transport
 *       is touched, and no run directory is created;
 *   Q2  the "any OpenAI-compatible endpoint" path (`--base-url`) is not an
 *       unqualified-runtime bypass: the same refusal, with zero model calls;
 *   Q3  the refusal names the refused runtime and the governing Spec, and does
 *       not invent a qualification rule of its own.
 *
 * Fully offline: the transport is a fake that would answer HTTP 400, and the
 * refusals happen before it could ever be called.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeP1Research } from '../lib/p1-runtime-composer.mjs';
import { stateFile } from '../lib/state.mjs';
import { fakeModelFetch } from './helpers/fake-model-transport.mjs';

const TOPIC = 'AI 编程工具会取代程序员吗';
const SPEC = 'docs/specs/research-orchestration-scope.md';
const QUALIFICATION_CODE = 'capability_isolation_unavailable';

const tmpWork = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** A transport that answers every request with 400 and records the calls. */
function unreachableTransport() {
  let calls = 0;
  const fetchImpl = fakeModelFetch(() => {
    calls += 1;
    return { status: 400, body: { error: { message: 'fake: unauthorized' } } };
  });
  return { fetchImpl, calls: () => calls };
}

test('Q1: a provider/model with no named qualification is refused, with no run created', async () => {
  const workDir = tmpWork('p1-qualification-unknown-');
  const { fetchImpl, calls } = unreachableTransport();

  const out = await composeP1Research({
    topic: TOPIC,
    workDir,
    model: 'unknownvendor/some-model',
    fetchImpl,
  });

  assert.equal(out.ok, false, 'an unqualified runtime must not be enabled');
  assert.equal(out.code, QUALIFICATION_CODE, `expected the capability-isolation refusal, got ${JSON.stringify(out)}`);
  assert.equal(calls(), 0, 'a refused runtime must never reach the transport');
  assert.equal(
    fs.existsSync(stateFile(workDir)),
    false,
    'a refused runtime must not create a run checkpoint',
  );
});

test('Q2: a custom OpenAI-compatible endpoint is not an unqualified-runtime bypass', async () => {
  const workDir = tmpWork('p1-qualification-endpoint-');
  const { fetchImpl, calls } = unreachableTransport();

  const out = await composeP1Research({
    topic: TOPIC,
    workDir,
    model: 'antigravity/claude-sonnet-4-6',
    modelBaseUrl: 'http://127.0.0.1:8045/v1',
    fetchImpl,
  });

  assert.equal(out.ok, false, 'a base URL must not enable an unqualified runtime');
  assert.equal(out.code, QUALIFICATION_CODE, `expected the capability-isolation refusal, got ${JSON.stringify(out)}`);
  assert.equal(calls(), 0, 'a refused runtime must never reach the endpoint');
  assert.equal(fs.existsSync(stateFile(workDir)), false);
});

test('Q3: the refusal names the runtime and the governing Spec', async () => {
  const workDir = tmpWork('p1-qualification-reason-');
  const out = await composeP1Research({
    topic: TOPIC,
    workDir,
    model: 'antigravity/claude-sonnet-4-6',
    modelBaseUrl: 'http://127.0.0.1:8045/v1',
    fetchImpl: unreachableTransport().fetchImpl,
  });

  assert.equal(out.ok, false);
  const details = String(out.details ?? '');
  assert.match(details, /antigravity-api-tool-less/, 'the refusal must name the refused runtime identity');
  assert.match(details, /CAPABILITY_ISOLATION_AVAILABLE/, 'the refusal must name the governing criterion');
  assert.ok(details.includes(SPEC), `the refusal must point at ${SPEC}`);
  assert.doesNotMatch(details, /127\.0\.0\.1|8045/, 'the refusal must not echo the configured endpoint');
});

test('Q4: the same provider label with a DIFFERENT model is not qualified', async () => {
  const workDir = tmpWork('p1-qualification-sibling-model-');
  const { fetchImpl, calls } = unreachableTransport();

  const out = await composeP1Research({
    topic: TOPIC,
    workDir,
    model: 'deepseek/unqualified-model',
    fetchImpl,
  });

  assert.equal(out.ok, false, 'a sibling model must not inherit the runtime qualification');
  assert.equal(out.code, QUALIFICATION_CODE, `expected the capability-isolation refusal, got ${JSON.stringify(out)}`);
  assert.equal(calls(), 0, 'an unqualified model must never reach the transport');
  assert.equal(fs.existsSync(stateFile(workDir)), false, 'refusal must precede the checkpoint');
});

test('Q5: a qualified model pointed at an operator endpoint is not qualified', async () => {
  const workDir = tmpWork('p1-qualification-model-endpoint-');
  const { fetchImpl, calls } = unreachableTransport();

  const out = await composeP1Research({
    topic: TOPIC,
    workDir,
    model: 'deepseek/deepseek-v4-pro',
    modelBaseUrl: 'https://example.invalid/v1',
    fetchImpl,
  });

  assert.equal(out.ok, false, 'the qualification is bound to the actual endpoint, not only the label');
  assert.equal(out.code, QUALIFICATION_CODE, `expected the capability-isolation refusal, got ${JSON.stringify(out)}`);
  assert.equal(calls(), 0, 'an unqualified endpoint must never reach the transport');
  assert.equal(fs.existsSync(stateFile(workDir)), false, 'refusal must precede the checkpoint');
  assert.doesNotMatch(String(out.details ?? ''), /example\.invalid/, 'the refusal must not echo the configured endpoint');
});

test('Q6: the refusal happens before ANY run artifact is created', async () => {
  const workDir = tmpWork('p1-qualification-no-artifacts-');
  const { fetchImpl, calls } = unreachableTransport();

  const out = await composeP1Research({
    topic: TOPIC,
    workDir,
    model: 'deepseek/deepseek-v4-pro',
    modelBaseUrl: 'https://example.invalid/v1',
    fetchImpl,
  });

  assert.equal(out.ok, false);
  assert.equal(calls(), 0);
  assert.deepEqual(fs.readdirSync(workDir), [], 'no state, events or result may be written before the gate passes');
});

/**
 * The PUBLIC entrypoint (bin/research-p1.mjs) must reach the same gate and must
 * expose no way to inject a runtime object. Only `--model` / `--base-url` are
 * forwarded, and the composer gates them. The injected-`runtime` seam is the
 * deterministic test / evidence seam (P2A T14 harness, fake runtimes), where the
 * CALLER owns the object and its qualification — it is not reachable from the CLI.
 */
test('Q7: the public CLI has no runtime-injection path and is gated', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cli = path.join(repoRoot, 'research-orchestration', 'bin', 'research-p1.mjs');

  const workDir = tmpWork('p1-qualification-cli-');
  const r = spawnSync(process.execPath, [
    cli, 'synthetic topic', '--work', workDir, '--model', 'unknownvendor/some-model', '--json',
  ], { encoding: 'utf8', timeout: 120_000 });

  assert.notEqual(r.status, 0, `the CLI must fail closed, got status ${r.status}: ${r.stderr}`);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error?.type, QUALIFICATION_CODE, `expected the capability-isolation refusal, got ${r.stdout}`);
  assert.deepEqual(fs.readdirSync(workDir), [], 'the CLI must not write artifacts for a refused runtime');

  // Structural guard: the CLI forwards only model selection, never a runtime
  // object, so it cannot skip the gate that lives at the composition boundary.
  const source = fs.readFileSync(cli, 'utf8');
  assert.doesNotMatch(source, /composeP1Research\(\{[\s\S]*?\bruntime\s*:/,
    'the public CLI must not pass an injected runtime to the composer');
});
