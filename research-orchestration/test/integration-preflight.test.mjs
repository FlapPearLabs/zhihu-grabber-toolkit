import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PREFLIGHT = fileURLToPath(new URL('../bin/integration-preflight.mjs', import.meta.url));

function runPreflight(args, env = process.env) {
  return spawnSync(process.execPath, [PREFLIGHT, ...args], {
    encoding: 'utf8',
    env,
  });
}

test('CLI PASS path emits structured PREFLIGHT_PASS JSON and exits 0', () => {
  const result = runPreflight(['--checks-json', '[]']);

  assert.equal(result.status, 0);
  assert.notEqual(result.stdout.trim(), '');
  assert.equal(JSON.parse(result.stdout).verdict, 'PREFLIGHT_PASS');
});

test('CLI FAIL path emits structured PREFLIGHT_FAIL JSON and exits non-zero', () => {
  const checks = [{ check: 'forced', status: 'FAIL', code: 'TEST_FAILURE', detail: 'intentional test failure' }];
  const result = runPreflight(['--checks-json', JSON.stringify(checks)]);

  assert.equal(result.status, 1);
  assert.notEqual(result.stdout.trim(), '');
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.verdict, 'PREFLIGHT_FAIL');
  assert.deepEqual(evidence.failedCodes, ['TEST_FAILURE']);
});

test('direct CLI invocation never silently succeeds with no output', () => {
  const result = runPreflight(['--checks-json', '[]']);

  assert.equal(
    result.status === 0 && result.stdout.trim() === '' && result.stderr.trim() === '',
    false,
  );
});

test('importing the module does not execute the CLI or exit the process', () => {
  const moduleUrl = pathToFileURL(PREFLIGHT).href;
  const program = `const mod = await import(${JSON.stringify(moduleUrl)}); process.stdout.write(JSON.stringify({ classifyPreflight: typeof mod.classifyPreflight }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], { encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { classifyPreflight: 'function' });
});

test('canonical mode direct entry emits a structured verdict without live network access', () => {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  const result = runPreflight(['--mode', 'canonical'], env);

  assert.ok(result.status === 0 || result.status === 1);
  assert.notEqual(result.stdout.trim(), '');
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.mode, 'canonical');
  assert.equal(evidence.stage, 'intermediate');
  assert.match(evidence.verdict, /^PREFLIGHT_(?:PASS|FAIL)$/);
});
