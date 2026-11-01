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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
