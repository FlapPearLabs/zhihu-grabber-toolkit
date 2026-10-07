import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
const [sourceRepo, expectedSha, workRoot, output] = process.argv.slice(2);
assert.match(expectedSha, /^[0-9a-f]{40}$/);
assert(!fs.existsSync(workRoot));
fs.mkdirSync(workRoot, { recursive: true });
const clone = path.join(workRoot, 'clone');
execFileSync('git', ['clone', '--no-hardlinks', '--branch', 'codex/p2a-t14-acceptance', sourceRepo, clone], { stdio: 'pipe' });
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: clone, encoding: 'utf8' }).trim(), expectedSha);
const driver = path.join(clone, 'research-orchestration/scripts/p2a-t14/driver.mjs');
const results = [];
function run(name, args, expectedError, customDriver = driver) {
  const out = path.join(workRoot, name);
  const child = spawnSync(process.execPath, [customDriver, '--repo', clone, '--out', out, ...args], { cwd: clone, encoding: 'utf8', timeout: 30000 });
  const error = child.stderr.match(/T14_[A-Z_]+/)?.[0] ?? 'UNKNOWN';
  const caught = child.status === 1 && child.signal === null && !child.error
    && error === expectedError && !fs.existsSync(out);
  results.push({ control: name, exitCode: child.status, signal: child.signal, errorCode: error,
    outputDirectoryCreated: fs.existsSync(out), providerIoPossible: fs.existsSync(out), caught });
  assert(caught, JSON.stringify(results.at(-1)));
}
run('missing-head', [], 'T14_EXPECTED_HEAD_REQUIRED');
run('malformed-head', ['--expected-head', 'b110515'], 'T14_EXPECTED_HEAD_REQUIRED');
run('foreign-head', ['--expected-head', '0'.repeat(40)], 'T14_EXPECTED_HEAD_MISMATCH');
const readme = path.join(clone, 'README.md');
const original = fs.readFileSync(readme);
fs.appendFileSync(readme, '\nT14 isolated source guard control\n');
run('unstaged', ['--expected-head', expectedSha], 'T14_EXACT_SOURCE_DIRTY');
execFileSync('git', ['add', 'README.md'], { cwd: clone });
run('staged', ['--expected-head', expectedSha], 'T14_EXACT_SOURCE_DIRTY');
fs.writeFileSync(readme, original);
execFileSync('git', ['add', 'README.md'], { cwd: clone });
const untracked = path.join(clone, 't14-source-guard-control.txt');
fs.writeFileSync(untracked, 'isolated control');
run('untracked', ['--expected-head', expectedSha], 'T14_EXACT_SOURCE_DIRTY');
fs.unlinkSync(untracked);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: clone, encoding: 'utf8' }), '');
const external = path.join(workRoot, 'external-harness');
fs.mkdirSync(external);
for (const name of ['driver.mjs', 'fixtures.mjs', 'matrix.mjs', 'package-evidence.mjs']) {
  fs.copyFileSync(path.join(path.dirname(driver), name), path.join(external, name));
}
fs.appendFileSync(path.join(external, 'driver.mjs'), '\n// isolated executing-byte mismatch control\n');
run('executing-harness-drift', ['--expected-head', expectedSha], 'T14_EXACT_SOURCE_DIRTY', path.join(external, 'driver.mjs'));
const report = { schema: 'p2a-t14-source-guard-controls/v1', exactRepoSha: expectedSha,
  evidenceClass: 'SOURCE_GUARD_NEGATIVE_CONTROL', isolatedClone: true, productCampaign: false,
  results, counts: { tested: results.length, caught: results.filter(r => r.caught).length } };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report.counts));
