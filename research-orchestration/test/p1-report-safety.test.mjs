// SPDX-License-Identifier: AGPL-3.0-only
/**
 * test/p1-report-safety.test.mjs
 *
 * report.md is a DERIVED VIEW written NEXT TO canonical run artifacts, so its
 * filesystem boundary is part of the product safety contract (Issue #144
 * follow-up):
 *
 *   S1  the OUTPUT is validated as a file OBJECT, not as a path: a symlink
 *       (relative or absolute) or any other non-regular object is refused, so
 *       `report.md → research-result.json` can never make rendering overwrite
 *       canonical data;
 *   S2  rendering is atomic: the report replaces a directory entry instead of
 *       writing through whatever the name resolves to, so a hard link to a
 *       canonical file keeps its bytes; a normal report is still generated and
 *       re-generated with no temp debris;
 *   S3  INPUTS are proven to be regular files inside the run directory: a file
 *       symlink and a symlinked parent directory are never followed, while a
 *       normal in-directory artifact is read;
 *   S4  a refusal is coded and never echoes the out-of-work-dir target or the
 *       data it would have exposed;
 *   S5  the check cannot be turned into check-then-use: an artifact swapped for
 *       a symlink AFTER it was inspected is refused (the read is descriptor-
 *       based and re-verifies the opened object), and no report is rendered;
 *   S6  the same swap on a PARENT directory is refused for the same reason.
 *   S7  the run directory itself cannot be swapped for a symlink between the
 *       read phase and the write phase: the report is not written through the
 *       replacement, so a report outside the run directory is never clobbered.
 *   S8  the report's permissions are a property of the run: updating an
 *       existing report preserves its mode, and a new report is never wider
 *       than 0600 even under a permissive umask;
 *   S9  an access ACL attached to the existing report is never silently
 *       dropped by the atomic replace: the layer cannot reproduce an arbitrary
 *       ACL, so it refuses (fail closed) instead of widening access.
 *
 * Fully offline: fixtures are written by the test itself; no run, no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import {
  REPORT_FILENAME, ReportError, buildSourceIndex, writeReport,
} from '../lib/report.mjs';

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const RESULT = {
  ok: true,
  topic: '报告安全测试主题',
  runId: 'run-fixture',
  runtime: { runtimeId: 'deepseek-api-tool-less', model: 'deepseek-v4-pro' },
  disclosure: {
    analysisCoverage: { selectedCount: 1, analyzedCount: 1 },
    isFullCoverage: true,
    retrieval: { retrievalRounds: 1, stopReason: 'fixture_stop' },
  },
};

const GROUP_STATE = { groups: {} };

/** Write the four artifacts writeReport needs; returns the work dir. */
function fixture(prefix = 'p1-report-safety-') {
  const workDir = tmpDir(prefix);
  fs.writeFileSync(path.join(workDir, 'research-result.json'), `${JSON.stringify(RESULT, null, 2)}\n`);
  fs.writeFileSync(path.join(workDir, 'cross-source-synthesis.json'), JSON.stringify({ synthesis: { families: [], unresolved: [] } }));
  fs.writeFileSync(path.join(workDir, 'per-group-claims.json'), JSON.stringify({ groupRepresentations: [] }));
  fs.writeFileSync(path.join(workDir, 'multi-group-state.json'), JSON.stringify(GROUP_STATE));
  return workDir;
}

const reportPathOf = (workDir) => path.join(workDir, REPORT_FILENAME);

test('S1: a report.md symlink to a canonical artifact is refused and the canonical file is untouched', () => {
  const workDir = fixture();
  const canonical = path.join(workDir, 'research-result.json');
  const before = fs.readFileSync(canonical, 'utf8');
  fs.symlinkSync(canonical, reportPathOf(workDir)); // absolute link

  assert.throws(
    () => writeReport(workDir),
    (e) => e instanceof ReportError && e.code === 'REPORT_OUTPUT_UNSAFE',
    'an absolute symlink must be refused',
  );
  assert.equal(fs.readFileSync(canonical, 'utf8'), before, 'canonical data must not be overwritten through the link');
  assert.equal(fs.lstatSync(reportPathOf(workDir)).isSymbolicLink(), true, 'the link itself must be left in place, not replaced');

  // Relative link to the same canonical file: refused for the same reason.
  const relWork = fixture();
  const relCanonical = path.join(relWork, 'research-result.json');
  const relBefore = fs.readFileSync(relCanonical, 'utf8');
  fs.symlinkSync('research-result.json', reportPathOf(relWork));
  assert.throws(() => writeReport(relWork), (e) => e instanceof ReportError && e.code === 'REPORT_OUTPUT_UNSAFE');
  assert.equal(fs.readFileSync(relCanonical, 'utf8'), relBefore);
});

test('S1b: any pre-existing non-regular report target is refused instead of written', () => {
  const workDir = fixture();
  fs.mkdirSync(reportPathOf(workDir));
  assert.throws(() => writeReport(workDir), (e) => e instanceof ReportError && e.code === 'REPORT_OUTPUT_UNSAFE');
  assert.equal(fs.lstatSync(reportPathOf(workDir)).isDirectory(), true);
});

test('S2: rendering is atomic — a hard-linked canonical file keeps its bytes and a normal report is generated', () => {
  const workDir = fixture();
  const canonical = path.join(workDir, 'research-result.json');
  const before = fs.readFileSync(canonical, 'utf8');
  fs.linkSync(canonical, reportPathOf(workDir)); // regular file, same inode as the canonical artifact

  const { reportPath, model } = writeReport(workDir);
  assert.equal(reportPath, reportPathOf(workDir));
  assert.ok(model.topic.length > 0);
  assert.equal(fs.readFileSync(canonical, 'utf8'), before, 'writing the report must never write through a shared inode');
  assert.equal(fs.lstatSync(reportPath).isFile(), true);
  assert.notEqual(fs.statSync(reportPath).ino, fs.statSync(canonical).ino, 'the report must be a new object, unlinking the alias');
  assert.match(fs.readFileSync(reportPath, 'utf8'), /^# 研究报告：报告安全测试主题/m);

  // A second render replaces the previous report and leaves no temp debris.
  const second = writeReport(workDir);
  assert.equal(second.reportPath, reportPath);
  assert.deepEqual(
    fs.readdirSync(workDir).filter((name) => name.includes('.tmp-')),
    [],
    'atomic rendering must clean up its temp file',
  );
  assert.equal(fs.readFileSync(canonical, 'utf8'), before);
});

test('S3: artifact inputs are read only from regular files inside the run directory', () => {
  const outside = tmpDir('p1-report-outside-');
  fs.mkdirSync(path.join(outside, '100'), { recursive: true });
  fs.writeFileSync(path.join(outside, '100', 'answers.json'), JSON.stringify({
    questionId: '100',
    questionTitle: 'OUTSIDE_SECRET_TITLE',
    answers: [{ id: '1001', author: 'OUTSIDE_SECRET_AUTHOR', voteupCount: 1 }],
  }));
  const groupStateFor = (evidenceRef) => ({
    groups: { 100: { groupId: '100', questionId: '100', evidenceRef } },
  });
  const REL = 'zhihu/100/answers.json';

  // (a) parent directory symlink: workDir/zhihu -> outside/ (so zhihu/100/answers.json is outside data)
  const parentLink = tmpDir('p1-report-parent-link-');
  fs.symlinkSync(outside, path.join(parentLink, 'zhihu'));
  const viaParent = buildSourceIndex(parentLink, groupStateFor(REL));
  assert.equal(viaParent.groups.get('100').title, null, 'a symlinked parent directory must not be followed');
  assert.equal(viaParent.sources.size, 0);

  // (b) file symlink: workDir/zhihu/100/answers.json -> outside/100/answers.json
  const fileLink = tmpDir('p1-report-file-link-');
  fs.mkdirSync(path.join(fileLink, 'zhihu', '100'), { recursive: true });
  fs.symlinkSync(path.join(outside, '100', 'answers.json'), path.join(fileLink, REL));
  const viaFile = buildSourceIndex(fileLink, groupStateFor(REL));
  assert.equal(viaFile.groups.get('100').title, null, 'a symlinked artifact file must not be followed');
  assert.equal(viaFile.sources.size, 0);

  // (c) control: the same layout with a regular file IS read.
  const normal = tmpDir('p1-report-normal-');
  fs.mkdirSync(path.join(normal, 'zhihu', '100'), { recursive: true });
  fs.writeFileSync(path.join(normal, REL), JSON.stringify({
    questionId: '100',
    questionTitle: '正常标题',
    answers: [{ id: '1001', author: '作者甲', voteupCount: 3 }],
  }));
  const viaNormal = buildSourceIndex(normal, groupStateFor(REL));
  assert.equal(viaNormal.groups.get('100').title, '正常标题');
  assert.equal(viaNormal.sources.size, 1);
});

test('S4: a symlinked canonical input is refused without echoing the outside target or its content', () => {
  const workDir = fixture();
  const outside = tmpDir('p1-report-outside-secret-');
  const outsideFile = path.join(outside, 'research-result.json');
  fs.writeFileSync(outsideFile, JSON.stringify({ ok: true, topic: 'OUTSIDE_SECRET_TOPIC' }));
  fs.rmSync(path.join(workDir, 'research-result.json'));
  fs.symlinkSync(outsideFile, path.join(workDir, 'research-result.json'));

  let error = null;
  try {
    writeReport(workDir);
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof ReportError, 'a symlinked input must be refused with a coded error');
  assert.equal(error.code, 'REPORT_INPUT_UNSAFE');
  assert.ok(!error.message.includes(outsideFile), 'the refusal must not echo the out-of-work-dir target');
  assert.ok(!error.message.includes('OUTSIDE_SECRET_TOPIC'), 'the refusal must not expose the data it refused to read');
  assert.ok(!error.message.includes(outside), 'the refusal must not leak the external directory');
});

/**
 * Run `fn` with the filesystem entry `swappedBefore` replaced by `replace()`
 * the first time an implementation consumes that path — either by opening it
 * or by reading it by name. This deterministically reproduces an attacker
 * winning the check-then-use race (the check has already happened).
 */
function withSwapBeforeUse(swappedBefore, replace, fn) {
  const target = path.resolve(swappedBefore);
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    replace();
  };
  const realOpenSync = fs.openSync;
  const realReadFileSync = fs.readFileSync;
  fs.openSync = function patchedOpenSync(p, ...rest) {
    if (typeof p === 'string' && path.resolve(p) === target) swap();
    return realOpenSync.call(fs, p, ...rest);
  };
  fs.readFileSync = function patchedReadFileSync(p, ...rest) {
    if (typeof p === 'string' && path.resolve(p) === target) swap();
    return realReadFileSync.call(fs, p, ...rest);
  };
  try {
    return { result: fn(), swapped: () => swapped };
  } finally {
    fs.openSync = realOpenSync;
    fs.readFileSync = realReadFileSync;
  }
}

test('S5: an artifact swapped for a symlink after inspection is refused, not read', () => {
  const workDir = fixture();
  const outside = tmpDir('p1-report-race-outside-');
  const outsideFile = path.join(outside, 'research-result.json');
  fs.writeFileSync(outsideFile, JSON.stringify({ ok: true, topic: 'OUTSIDE_RACE_SECRET_TOPIC' }));
  const canonical = path.join(workDir, 'research-result.json');
  const canonicalBefore = fs.readFileSync(canonical, 'utf8');

  let error = null;
  const run = withSwapBeforeUse(canonical, () => {
    fs.rmSync(canonical);
    fs.symlinkSync(outsideFile, canonical);
  }, () => {
    try {
      writeReport(workDir);
    } catch (err) {
      error = err;
    }
  });
  assert.equal(run.swapped(), true, 'the race window must actually have been exercised');
  assert.ok(error instanceof ReportError, 'a raced read must be refused with a coded error');
  assert.equal(error.code, 'REPORT_INPUT_UNSAFE');
  assert.ok(!error.message.includes('OUTSIDE_RACE_SECRET_TOPIC'), 'refused data must not be exposed');
  assert.ok(!error.message.includes(outsideFile), 'the refusal must not echo the link target');
  assert.equal(fs.existsSync(path.join(workDir, REPORT_FILENAME)), false, 'no report may be rendered from an unverified read');
  assert.equal(fs.readFileSync(outsideFile, 'utf8').includes('OUTSIDE_RACE_SECRET_TOPIC'), true);
  assert.notEqual(canonicalBefore, '');
});

test('S6: a parent directory swapped for a symlink after inspection is refused, not read', () => {
  const outside = tmpDir('p1-report-race-parent-outside-');
  fs.mkdirSync(path.join(outside, '100'), { recursive: true });
  fs.writeFileSync(path.join(outside, '100', 'answers.json'), JSON.stringify({
    questionId: '100',
    questionTitle: 'OUTSIDE_RACE_PARENT_TITLE',
    answers: [{ id: '1001', author: 'OUTSIDE_RACE_PARENT_AUTHOR', voteupCount: 1 }],
  }));

  const workDir = tmpDir('p1-report-race-parent-');
  fs.mkdirSync(path.join(workDir, 'zhihu', '100'), { recursive: true });
  const evidenceRef = 'zhihu/100/answers.json';
  fs.writeFileSync(path.join(workDir, evidenceRef), JSON.stringify({
    questionId: '100', questionTitle: '正常标题', answers: [{ id: '1001', author: '作者甲', voteupCount: 3 }],
  }));
  const groupState = { groups: { 100: { groupId: '100', questionId: '100', evidenceRef } } };

  const run = withSwapBeforeUse(path.join(workDir, evidenceRef), () => {
    fs.rmSync(path.join(workDir, 'zhihu'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(workDir, 'zhihu'));
  }, () => buildSourceIndex(workDir, groupState));

  assert.equal(run.swapped(), true, 'the race window must actually have been exercised');
  assert.equal(run.result.groups.get('100').title, null, 'a raced parent directory must not be followed');
  assert.equal(run.result.sources.size, 0);
});

/**
 * Run `fn` with the whole run directory replaced by a symlink to `outside` the
 * first time the implementation creates a file inside it (its temp report).
 * This is the deterministic form of "the directory is swapped between the read
 * phase and the write phase": every artifact has already been read.
 */
function withDirSwapBeforeTempWrite(workDir, outside, fn) {
  const dir = path.resolve(workDir);
  const realOpenSync = fs.openSync;
  const realWriteFileSync = fs.writeFileSync;
  const realMkdtempSync = fs.mkdtempSync;
  let swapped = false;
  const isReportTemp = (p) => typeof p === 'string'
    && path.resolve(path.dirname(p)) === dir
    && path.basename(p).startsWith(`.${REPORT_FILENAME}.tmp-`);
  const swap = () => {
    if (swapped) return;
    swapped = true;
    fs.renameSync(dir, `${dir}-moved`);
    fs.symlinkSync(outside, dir);
  };
  fs.openSync = function patchedOpenSync(p, ...rest) {
    if (isReportTemp(p)) swap();
    return realOpenSync.call(fs, p, ...rest);
  };
  fs.writeFileSync = function patchedWriteFileSync(p, ...rest) {
    if (isReportTemp(p)) swap();
    return realWriteFileSync.call(fs, p, ...rest);
  };
  fs.mkdtempSync = function patchedMkdtempSync(p, ...rest) {
    if (typeof p === 'string' && path.resolve(p) === dir) swap();
    return realMkdtempSync.call(fs, p, ...rest);
  };
  try {
    return { result: fn(), swapped: () => swapped };
  } finally {
    fs.openSync = realOpenSync;
    fs.writeFileSync = realWriteFileSync;
    fs.mkdtempSync = realMkdtempSync;
  }
}

test('S7: a run directory replaced by a symlink before the write cannot redirect the report outside', () => {
  const workDir = fixture('p1-report-dirswap-');
  const outside = tmpDir('p1-report-dirswap-outside-');
  // The outside directory already holds a report: it must survive untouched.
  const outsideReport = path.join(outside, REPORT_FILENAME);
  const outsideBefore = '# 目录外既有报告\n\n这些字节不属于本次运行，任何写入都不得覆盖它们。\n';
  fs.writeFileSync(outsideReport, outsideBefore);

  let error = null;
  const run = withDirSwapBeforeTempWrite(workDir, outside, () => {
    try {
      writeReport(workDir);
    } catch (err) {
      error = err;
    }
  });

  assert.equal(run.swapped(), true, 'the directory-replacement window must actually have been exercised');
  assert.ok(error instanceof ReportError, 'a replaced run directory must be refused with a coded error');
  assert.equal(error.code, 'REPORT_OUTPUT_UNSAFE');
  assert.equal(fs.readFileSync(outsideReport, 'utf8'), outsideBefore, 'the report outside the run directory must not be overwritten');
  assert.deepEqual(
    fs.readdirSync(outside).filter((name) => name.includes('.tmp-')),
    [],
    'a refused write must not leave temp debris outside the run directory',
  );
  assert.equal(fs.existsSync(path.join(`${workDir}-moved`, REPORT_FILENAME)), false, 'no report may be rendered next to the moved artifacts');
});

test('S8: rendering preserves an existing report mode and never creates a wider report', {
  // POSIX-scoped invariant: the requirement is about unix permission bits. A
  // Windows checkout has no such bits — Node synthesises `0o666` for any
  // writable file and only the read-only attribute is expressible — so `0600`
  // cannot be created or observed there. This is a known platform limit, not a
  // passing test: Windows access is governed by ACL inheritance, which this
  // layer does not manage. See the handoff's unverified list.
  skip: process.platform === 'win32'
    ? 'POSIX permission bits do not exist on Windows (mode is synthesised from the read-only attribute)'
    : false,
}, () => {
  const workDir = fixture('p1-report-mode-');
  const reportPath = reportPathOf(workDir);
  const modeOf = () => fs.statSync(reportPath).mode & 0o777;
  const previous = process.umask(0o022);
  try {
    // (a) a NEW report is private even under umask 022 (the default create mode
    //     0666 & ~022 = 0644 would expose it to every local user).
    writeReport(workDir);
    assert.equal(modeOf(), 0o600, 'a new report must not be wider than 0600');

    // (b) updating an existing 0600 report keeps 0600 (no 0644 regression).
    writeReport(workDir);
    assert.equal(modeOf(), 0o600, 'updating a report must not widen its permissions');

    // (c) an explicitly narrowed mode survives an update unchanged.
    fs.chmodSync(reportPath, 0o400);
    writeReport(workDir);
    assert.equal(modeOf(), 0o400, 'the existing mode must be preserved exactly');

    // (d) a mode the run deliberately widened is still the run's to keep.
    fs.chmodSync(reportPath, 0o640);
    writeReport(workDir);
    assert.equal(modeOf(), 0o640, 'an existing mode must be preserved, not narrowed behind the operator');

    assert.deepEqual(
      fs.readdirSync(workDir).filter((name) => name.includes('.tmp-')),
      [],
      'permission handling must not leave temp debris',
    );
  } finally {
    process.umask(previous);
  }
});

/**
 * Can this machine create an access ACL on a file? The S9 contract is about
 * platform ACLs, so the test only runs where one can actually be attached.
 */
function aclSupport() {
  if (process.platform === 'darwin') return { ok: true };
  if (process.platform !== 'linux') return { ok: false, reason: 'no ACL tooling assumed on this platform' };
  try {
    execFileSync('setfacl', ['--version'], { stdio: 'ignore' });
    return { ok: true, linux: true };
  } catch {
    return { ok: false, reason: 'setfacl is not installed on this Linux host' };
  }
}

test('S9: an existing report ACL is never silently dropped by an atomic update', {
  skip: aclSupport().ok ? false : `access ACLs are not testable here: ${aclSupport().reason}`,
}, () => {
  const workDir = fixture('p1-report-acl-');
  const reportPath = reportPathOf(workDir);
  writeReport(workDir);

  // Attach an access ACL the run did not ask for. On macOS a deny-read rule
  // also makes the file unreadable to its own owner, which is the sharpest
  // observable form of "this replacement widened access".
  if (process.platform === 'darwin') {
    execFileSync('chmod', ['+a', 'everyone deny read', reportPath]);
  } else {
    execFileSync('setfacl', ['-m', 'u:nobody:r', reportPath]);
  }
  // macOS lists ACL entries as extra lines (`ls -e`); GNU ls has no `-e` and
  // marks an ACL with a trailing `+` on the permission bits instead.
  const aclLines = () => {
    if (process.platform === 'darwin') {
      return execFileSync('ls', ['-led', reportPath], { encoding: 'utf8' })
        .split('\n').slice(1).map((line) => line.trim()).filter((line) => line !== '');
    }
    const modes = execFileSync('ls', ['-ld', reportPath], { encoding: 'utf8' });
    return (modes.split(/\s+/)[0] ?? '').endsWith('+') ? ['+'] : [];
  };
  assert.ok(aclLines().length > 0, 'the fixture must really carry an ACL');

  assert.throws(
    () => writeReport(workDir),
    (e) => e instanceof ReportError
      && e.code === 'REPORT_OUTPUT_UNSAFE'
      && /ACL/.test(e.message),
    'an update must refuse rather than replace a file whose ACL it cannot preserve',
  );
  assert.ok(aclLines().length > 0, 'the existing ACL must still be in place after the refusal');
  assert.deepEqual(
    fs.readdirSync(workDir).filter((name) => name.includes('.tmp-')),
    [],
    'a refused update must not leave temp debris',
  );
});
