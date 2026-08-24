/**
 * research-orchestration/lib/runner.mjs
 *
 * Primitive subprocess runner (thin). The orchestrator NEVER reimplements capture/verify/
 * handoff/corpus logic — it spawns the existing deterministic primitives and consumes their
 * machine-readable results (ORCHESTRATOR_COORDINATES / VERIFIER_AUTHORITATES).
 *
 * The runner is injectable so tests can substitute deterministic fakes without network.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ZHIHU_SCRIPTS = path.join(REPO, 'zhihu-answer-grabber', 'scripts');
const ZHIHU_CLI = path.join(REPO, 'zhihu-answer-grabber', 'src', 'cli.js');
const CORPUS_SCRIPTS = path.join(REPO, 'corpus-anthology', 'scripts');

/**
 * Default runner: spawnSync the real primitive with node.
 * Returns { status, stdout, stderr }.
 */
export function defaultRunner() {
  const NODE = process.execPath;

  function run(scriptPath, args, opts = {}) {
    const res = spawnSync(NODE, [scriptPath, ...args], {
      encoding: 'utf8',
      cwd: opts.cwd || REPO,
      env: { ...process.env, ...(opts.env || {}) },
      timeout: opts.timeout || 600_000,
    });
    if (res.error) {
      return { status: -1, stdout: '', stderr: String(res.error.message) };
    }
    return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  }

  /**
   * Run a named primitive.
   * @param {string} name - one of the orchestration primitive names
   * @param {string[]} args - CLI args for that primitive
   * @param {object} [opts] - {cwd, env, timeout}
   */
  return function runPrimitive(name, args, opts = {}) {
    switch (name) {
      case 'zhihu-search':
        return run(ZHIHU_CLI, ['search', ...args], opts);
      case 'zhihu-grab':
        return run(ZHIHU_CLI, ['grab', ...args], opts);
      case 'zhihu-verify':
        return run(path.join(ZHIHU_SCRIPTS, 'verify-output.mjs'), args, opts);
      case 'zhihu-handoff':
        return run(path.join(ZHIHU_SCRIPTS, 'make-handoff.mjs'), args, opts);
      case 'zhihu-preflight':
        return run(path.join(ZHIHU_SCRIPTS, 'preflight.mjs'), ['--json', ...args], opts);
      case 'deepseek-preflight':
        return run(path.join(CORPUS_SCRIPTS, 'preflight-deepseek.mjs'), args, opts);
      case 'corpus-verify-handoff':
        return run(path.join(CORPUS_SCRIPTS, 'verify.mjs'), ['--handoff', ...args], opts);
      case 'corpus-chunk':
        return run(path.join(CORPUS_SCRIPTS, 'chunk.mjs'), args, opts);
      case 'corpus-select':
        return run(path.join(CORPUS_SCRIPTS, 'select.mjs'), args, opts);
      case 'corpus-map':
        return run(path.join(CORPUS_SCRIPTS, 'map.mjs'), args, opts);
      case 'corpus-verify-work':
        return run(path.join(CORPUS_SCRIPTS, 'verify.mjs'), ['--work', ...args], opts);
      case 'corpus-verify-final':
        return run(path.join(CORPUS_SCRIPTS, 'verify.mjs'), ['--work', ...args], opts);
      case 'corpus-reduce':
        return run(path.join(CORPUS_SCRIPTS, 'reduce.mjs'), args, opts);
      case 'corpus-render':
        return run(path.join(CORPUS_SCRIPTS, 'render-final.mjs'), args, opts);
      default:
        throw new Error(`unknown primitive: ${name}`);
    }
  };
}
