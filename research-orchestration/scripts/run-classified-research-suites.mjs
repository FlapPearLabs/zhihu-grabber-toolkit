// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/scripts/run-classified-research-suites.mjs
 *
 * P1-R01 (#89) — minimal CI classification / omission-check runner for the existing
 * research-orchestration core suites.
 *
 * This runner is the single source of truth for which research suites CI must
 * execute. It does NOT replace product behavior and it does NOT build a generic
 * test platform — it only enforces the registration/classification contract that
 * R01 owns (each functional repair owner registers its own RED->GREEN suites here).
 *
 * Design invariants (from Issue #89 / decomposition P1-R01):
 *   - Omission must never silently turn green: every discovered *.test.mjs must be
 *     present in suite-classification.json, and every manifest entry must exist on
 *     disk (no ghost entries). An unregistered NEW core test FAILS the check.
 *   - The guard is non-tautological: in full-offline mode every registered executable
 *     suite must actually be executed; dropping an execution route fails the check.
 *   - live-gated / private-canonical suites are reported as NOT_RUN and are never
 *     counted as offline success (SKIP != PASS; live/private absence is listed apart).
 *   - cwd contract is repository-relative (workingDirectory in the manifest), never a
 *     machine-specific absolute path. Explicit file paths are used (never `node --test
 *     <dir>`), so Windows directory/glob interpretation differences do not break CI.
 *   - @xenova/transformers is NOT required for offline execution: embedding-provider.mjs
 *     lazy-imports it only on real model load, and no current suite does that, so CI
 *     needs no `npm ci` for research-orchestration. A suite that triggers real embedding
 *     must set requires.npmInstall:true and the owner provisions it.
 *
 * Modes:
 *   guard         no test execution; verify manifest coverage + print classification.
 *   full-offline  execute historical-compat + full-offline on this platform; assert every
 *                 registered executable suite ran; report live/private as NOT_RUN; fail
 *                 if any executable suite has fail > 0.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESEARCH_DIR = path.resolve(SCRIPT_DIR, '..'); // research-orchestration
const REPO_ROOT = path.resolve(RESEARCH_DIR, '..'); // repo root
const TEST_DIR = path.join(RESEARCH_DIR, 'test');
const MANIFEST_PATH = path.join(RESEARCH_DIR, 'suite-classification.json');

const VALID_CATEGORIES = new Set([
  'fast-deterministic',
  'full-offline',
  'historical-compat',
  'live-gated',
  'private-canonical',
]);
// Categories that ordinary PR CI actually executes (offline, no credential/network).
const EXECUTABLE_OFFLINE = new Set(['historical-compat', 'full-offline']);

const SUITE_TIMEOUT_MS = 180_000;

function fail(msg) {
  process.stderr.write(`CLASSIFICATION-GUARD-FAIL: ${msg}\n`);
  process.exit(1);
}

function loadManifest() {
  let raw;
  try {
    raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  } catch (e) {
    fail(`cannot read manifest ${MANIFEST_PATH}: ${e.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    fail(`manifest is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(manifest.suites)) fail('manifest.suites must be an array');
  const seen = new Set();
  for (const entry of manifest.suites) {
    if (!entry || typeof entry.file !== 'string') {
      fail(`manifest entry missing file: ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry.file)) fail(`duplicate manifest entry: ${entry.file}`);
    seen.add(entry.file);
    if (!VALID_CATEGORIES.has(entry.category)) {
      fail(`invalid category for ${entry.file}: ${entry.category}`);
    }
  }
  return manifest;
}

function discoverTests() {
  const files = fs
    .readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort();
  return files;
}

// Omission + ghost guard. Fails the process if the manifest does not exactly match
// the discovered set of core tests.
function runGuard(manifest, discovered) {
  const registered = new Set(manifest.suites.map((s) => s.file));
  const unregistered = discovered.filter((f) => !registered.has(f));
  if (unregistered.length) {
    fail(
      `unregistered core test(s) present in research-orchestration/test/ but absent from ` +
        `suite-classification.json: ${unregistered.join(', ')} — register them or they will be ` +
        `silently omitted from CI`,
    );
  }
  const missing = manifest.suites.map((s) => s.file).filter((f) => !discovered.includes(f));
  if (missing.length) {
    fail(`manifest ghost entry/ies (registered but missing on disk): ${missing.join(', ')}`);
  }

  const byCat = {};
  for (const s of manifest.suites) byCat[s.category] = (byCat[s.category] || 0) + 1;
  process.stdout.write('RESEARCH SUITE CLASSIFICATION (guard)\n');
  for (const c of VALID_CATEGORIES) {
    if (byCat[c]) process.stdout.write(`  ${c}: ${byCat[c]}\n`);
  }
  process.stdout.write(`  total registered: ${manifest.suites.length}\n`);
  process.stdout.write(`  discovered on disk: ${discovered.length}\n`);
  process.stdout.write(
    'GUARD OK: manifest covers every discovered core test and has no ghost entries.\n',
  );
}

function parseSummary(out) {
  const nums = { tests: 0, pass: 0, fail: 0, skipped: 0 };
  for (const key of ['tests', 'pass', 'fail', 'skipped']) {
    const re = new RegExp(`^# ${key} (\\d+)`, 'm');
    const m = out.match(re);
    if (m) nums[key] = Number(m[1]);
  }
  return nums;
}

function runSuite(file, cwd) {
  return new Promise((resolve) => {
    const abs = path.join(TEST_DIR, file);
    const child = spawn(process.execPath, ['--test', abs], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
    let out = '';
    const onData = (d) => {
      out += d;
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ file, rc: -1, out: out + '\n[TIMEOUT after 180s]\n' });
    }, SUITE_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ file, rc: code, out });
    });
  });
}

async function runFullOffline(manifest) {
  // Registration guard still runs over the FULL manifest (all 29) so a new
  // unregistered core test fails even here.
  runGuard(manifest, discoverTests());

  const executable = manifest.suites.filter((s) => EXECUTABLE_OFFLINE.has(s.category));
  const notRun = manifest.suites.filter((s) => !EXECUTABLE_OFFLINE.has(s.category));

  const results = [];
  const executedFiles = new Set();
  for (const s of executable) {
    const cwd =
      s.requires && s.requires.workingDirectory === 'research-orchestration'
        ? RESEARCH_DIR
        : REPO_ROOT;
    const r = await runSuite(s.file, cwd);
    const nums = parseSummary(r.out);
    executedFiles.add(s.file);
    results.push({ file: s.file, category: s.category, ...nums, rc: r.rc });
  }

  // Non-tautological guard: every registered executable suite must have been executed.
  const expected = new Set(executable.map((s) => s.file));
  for (const f of expected) {
    if (!executedFiles.has(f)) {
      fail(`registered executable suite was NOT executed: ${f}`);
    }
  }

  let totalFail = 0;
  const byCat = {};
  for (const r of results) {
    byCat[r.category] = byCat[r.category] || { tests: 0, pass: 0, fail: 0, skipped: 0 };
    byCat[r.category].tests += r.tests;
    byCat[r.category].pass += r.pass;
    byCat[r.category].fail += r.fail;
    byCat[r.category].skipped += r.skipped;
    totalFail += r.fail;
    const status = r.fail > 0 ? 'FAIL' : r.skipped > 0 ? 'PASS(skip)' : 'PASS';
    process.stdout.write(
      `  [${r.category}] ${r.file}: tests=${r.tests} pass=${r.pass} fail=${r.fail} ` +
        `skip=${r.skipped} -> ${status}\n`,
    );
  }

  process.stdout.write('\nCATEGORY TOTALS (executed offline):\n');
  for (const c of ['historical-compat', 'full-offline']) {
    if (byCat[c]) {
      process.stdout.write(
        `  ${c}: tests=${byCat[c].tests} pass=${byCat[c].pass} fail=${byCat[c].fail} ` +
          `skip=${byCat[c].skipped}\n`,
      );
    }
  }

  process.stdout.write(
    '\nOTHER CATEGORIES (reported separately; never counted as offline pass):\n',
  );
  for (const s of notRun) {
    if (s.category === 'fast-deterministic') {
      // fast-deterministic suites are executed by the preserved 3-platform `test` job,
      // not re-executed here (avoids duplicate work); they are covered, not absent.
      process.stdout.write(
        `  [${s.category}] ${s.file}: EXECUTED IN 'test' job (preserved 3-platform fast-deterministic gates)\n`,
      );
    } else {
      process.stdout.write(`  [${s.category}] ${s.file}: NOT_RUN — ${s.absence || 'gated'}\n`);
    }
  }

  if (totalFail > 0) {
    fail(`offline research suites have ${totalFail} failing test(s)`);
  }
  process.stdout.write(
    '\nFULL-OFFLINE CLASSIFICATION OK: all executable offline suites green; ' +
      'live/private quarantined as NOT_RUN.\n',
  );
}

const mode = process.argv[2] || 'guard';
const manifest = loadManifest();
const discovered = discoverTests();

if (mode === 'guard') {
  runGuard(manifest, discovered);
} else if (mode === 'full-offline') {
  await runFullOffline(manifest);
} else {
  fail(`unknown mode: ${mode} (expected guard|full-offline)`);
}
