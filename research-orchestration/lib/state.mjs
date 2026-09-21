/**
 * research-orchestration/lib/state.mjs
 *
 * Orchestration state / checkpoint controller (Approved R6: DELEGATED_IMPLEMENTATION_DESIGN).
 *
 * Hard rules (docs/specs/research-orchestration-scope.md §8.2):
 * - resume only from validated checkpoints; FILE EXISTS != VALID CACHE;
 * - stale/incompatible artifact is never silently reused;
 * - credentials NEVER enter orchestration state;
 * - machine-private absolute paths NEVER enter portable/public state (work-relative only);
 * - orchestration state is NOT canonical product truth (canonical artifacts + verifier/hash
 *   authority remain with existing primitives).
 */

import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const STATE_SCHEMA_VERSION = 1;

export const STAGE_SEARCH = 'SEARCH';
export const STAGE_SELECT = 'SELECT';
export const STAGE_CAPTURE = 'CAPTURE';
export const STAGE_VERIFY = 'VERIFY';
export const STAGE_HANDOFF = 'HANDOFF';
export const STAGE_ANALYZE = 'ANALYZE';
export const STAGE_RENDER = 'RENDER';
export const STAGE_COMPLETE = 'COMPLETE';
export const STAGE_FAILED = 'FAILED';

export const STAGES = [
  STAGE_SEARCH,
  STAGE_SELECT,
  STAGE_CAPTURE,
  STAGE_VERIFY,
  STAGE_HANDOFF,
  STAGE_ANALYZE,
  STAGE_RENDER,
  STAGE_COMPLETE,
];

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export function sha256File(file) {
  const buf = fs.readFileSync(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Compute the run-identity hash: any change to topic / mode / percent / runtime invalidates
 * a prior checkpoint (stale run identity → no silent reuse).
 * NOTE: forceQuestionId (clarification resolution) is intentionally NOT part of the identity —
 * resolving a clarification continues the same run.
 */
export function runIdentityHash({ topic, mode, percent, runtime }) {
  return sha256(JSON.stringify({ topic, mode, percent, runtime }));
}

/**
 * P1-R06 (#94): deterministic content fingerprint of the composition config.
 *
 * `runIdentityHash` deliberately covers only the STABLE request identity
 * (topic/mode/percent/runtime). The composition CONFIG (rounds, novelty
 * thresholds, per-channel budgets, …) materially changes which corpus and which
 * claims a run produces, so a checkpoint produced under config A must never be
 * served to a request made under config B. Recording a stable fingerprint lets
 * the reuse closure compare configs WITHOUT widening the run identity (which
 * would have broken every existing checkpoint's runId).
 *
 * The config is canonicalized by key order and hashed; `undefined`/absent config
 * fingerprints to null (the historical, config-less call shape).
 */
export function configFingerprint(config) {
  if (config === undefined || config === null) return null;
  let canonical;
  try {
    canonical = canonicalizeForHash(config);
  } catch {
    return null;
  }
  return sha256(canonical);
}

/** Stable JSON with recursively sorted object keys (arrays keep their order). */
function canonicalizeForHash(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalizeForHash(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeForHash(value[k])}`).join(',')}}`;
}

export function makeState({ workDir, topic, mode, percent, runtime, forceQuestionId, occurrenceId, config }) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    runId: runIdentityHash({ topic, mode, percent, runtime }),
    // P1-R02 (#90): occurrence identity — a single execution of a (request, config)
    // binding. Distinct from the stable runId (normalized request + config). A
    // restart, or any non-resumable prior state, starts a NEW occurrence; an
    // ordinary process-restart resume of the SAME prior state continues the same
    // occurrence. The composer enforces the occurrence boundary (fresh plan
    // proposal + archiving the prior occurrence's derived T09 state) — the id
    // itself is the recorded identity, never a derived-state dependency key.
    occurrenceId: typeof occurrenceId === 'string' && occurrenceId.length > 0 ? occurrenceId : randomUUID(),
    topic,
    mode,
    percent,
    runtime,
    // P1-R06 (#94): the composition config this execution ran under. A checkpoint
    // is reusable only for the SAME config fingerprint (see the reuse closure).
    configFingerprint: configFingerprint(config),
    forceQuestionId: forceQuestionId ?? null,
    stage: STAGE_SEARCH,
    completedStages: [],
    selectedQuestionId: null,
    selection: null,
    artifacts: {}, // work-relative paths only
    hashes: {}, // artifact identity for checkpoint validation
    verification: null,
    coverage: null,
    // P1 final coverage integration binding (Issue #47 render seam): set ONLY by
    // a P1-integrated composer; pure v0.3 runs stay null and never consume a
    // bare coverage-final.json (run binding is the anti-cross-run contract).
    p1FinalCoveragePlanHash: null,
    updatedAt: new Date().toISOString(),
  };
}

export function stateFile(workDir) {
  return path.join(workDir, 'orchestration-state.json');
}

export function eventsFile(workDir) {
  return path.join(workDir, 'events.jsonl');
}

export function readState(workDir) {
  const file = stateFile(workDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null; // corrupt state → treated as absent (validated before reuse)
  }
}

export function writeState(workDir, state) {
  fs.mkdirSync(workDir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const target = stateFile(workDir);
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, payload, 'utf8');
    try {
      fs.fsyncSync(fd);
    } catch (e) {
      if (e.code !== 'EINVAL' && e.code !== 'EPERM' && e.code !== 'EROFS') throw e;
    }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, target);
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'EPERM') {
      fs.rmSync(target, { force: true });
      fs.renameSync(temp, target);
    } else {
      throw err;
    }
  }
}

export function appendEvent(workDir, event) {
  fs.mkdirSync(workDir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  fs.appendFileSync(eventsFile(workDir), `${line}\n`);
}

/** Validate that a work-relative path stays inside the work dir (no traversal). */
export function assertWorkRelative(workDir, rel) {
  const abs = path.resolve(workDir, rel);
  const root = path.resolve(workDir);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
    throw new Error(`orchestration state path escapes work dir: ${rel}`);
  }
  return rel;
}

/**
 * Validate a recorded artifact checkpoint.
 * FILE EXISTS != VALID CACHE: existence alone is insufficient; the recorded sha256 must match.
 * Returns { ok, reason } — ok=false means the artifact is missing/stale and its stage must rerun.
 */
export function validateArtifactCheckpoint(workDir, rel, expectedHash) {
  try {
    assertWorkRelative(workDir, rel);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  const abs = path.resolve(workDir, rel);
  if (!fs.existsSync(abs)) return { ok: false, reason: `artifact missing: ${rel}` };
  let actual;
  try {
    actual = sha256File(abs);
  } catch (err) {
    return { ok: false, reason: `artifact unreadable: ${rel} (${err.message})` };
  }
  if (expectedHash && actual !== expectedHash) {
    return { ok: false, reason: `artifact stale (hash mismatch): ${rel}` };
  }
  return { ok: true, reason: null };
}

/**
 * Validate the whole checkpoint for the current run identity.
 * Returns { valid, reason, resumeFromStage }:
 * - valid=false + reason='state_mismatch'  → different run identity; refuse to reuse (fail closed).
 * - valid=false + reason=<stale stage>     → resume requires re-running from that stage.
 * - valid=true + resumeFromStage           → all prior stage artifacts valid; continue from stage.
 */
export function validateCheckpoint(workDir, runId, stagesToArtifacts) {
  const state = readState(workDir);
  if (!state) return { valid: false, reason: 'no_checkpoint', resumeFromStage: STAGE_SEARCH };
  if (state.runId !== runId) {
    return { valid: false, reason: 'state_mismatch', resumeFromStage: null, state };
  }
  // Re-validate each completed stage's artifact identity (in order).
  for (const stage of STAGES) {
    if (stage === STAGE_COMPLETE) break;
    if (!state.completedStages.includes(stage)) {
      return { valid: true, reason: null, resumeFromStage: stage, state };
    }
    const artifact = stagesToArtifacts[stage];
    if (artifact) {
      const rel = typeof artifact === 'function' ? artifact(state) : artifact;
      if (rel) {
        const expected = state.hashes?.[stage] ?? null;
        const check = validateArtifactCheckpoint(workDir, rel, expected);
        if (!check.ok) {
          return { valid: false, reason: `stale:${stage}:${check.reason}`, resumeFromStage: stage, state };
        }
      }
    }
  }
  return { valid: true, reason: null, resumeFromStage: state.stage, state };
}

/** Work-relative path helper (also guards against absolute paths leaking into state). */
export function toWorkRelative(workDir, absOrRel) {
  const abs = path.resolve(workDir, absOrRel);
  const rel = path.relative(path.resolve(workDir), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing to store out-of-work-dir path in state: ${absOrRel}`);
  }
  // P1-R06 (#94): a work-relative ref is PERSISTED, portability-normalized and
  // compared as a string, so its canonical form is PORTABLE (POSIX separators) on
  // every platform — not the platform separator `path.relative` happens to emit.
  //
  // This was a real Windows-only defect: `path.relative` yields
  // `zhihu\100\answers.json` there, while the T09 persisted-state validator
  // requires the exact production ref shape `zhihu/100/answers.json`. The result
  // was that on Windows a captured group could NEVER be loaded back from a
  // checkpoint, so group reuse was silently impossible and every resume redid the
  // whole group stage. The composition owner already declares this canonical form
  // and pays for it by normalizing at one consumer seam (`toPortableRef`); emitting
  // it at the source makes producer and validator agree instead of patching each
  // consumer. On POSIX `path.sep === '/'`, so this is a no-op there.
  return rel.split(path.sep).join('/');
}
