// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/session-capture-provider.mjs
 *
 * P1-T05 — Session/Cookie capture capability wrapper
 * (Approved Spec §5.1; D-2a; Issue #37).
 *
 * REUSE_FIRST / authority boundary: this adapter WRAPS the existing v0.3-approved
 * Session/Cookie single-question capture primitive (`zhihu-answer-grabber` `grab
 * --json` CLI machine contract). It does NOT redefine the primitive's authority:
 *   - validity stays with verify-output (captured != verified); the wrapper only
 *     mirrors the primitive's own `verified: false` and names the authority;
 *   - it adds no new browser scraping / Browser-Session data access (OUT_OF_SCOPE);
 *   - credentials never pass through the wrapper (the primitive resolves the local
 *     cookie session itself; auth_class is a classification only).
 *
 * Completeness evidence: the grab completion contract (src/grabber.js) marks the
 * pagination loop done ONLY when the server explicitly declares `paging.is_end ===
 * true` (fail-closed otherwise), and the `stage: 'captured'` payload is emitted only
 * after that loop returned. The wrapper therefore reports `complete` citing that
 * provider evidence — not an independent re-derivation, and never a validity claim.
 */

import { classifyUrl } from '../../zhihu-answer-grabber/src/markdown-security.js';
import {
  CAPABILITY_CAPTURE,
  AUTH_CLASS_SESSION,
  COMPLETENESS_COMPLETE,
  COMPLETENESS_UNKNOWN,
  PROVIDER_ZHIHU_SESSION_CAPTURE,
} from './provider-seam.mjs';

/** Machine route identity for provenance records. */
export const SESSION_CAPTURE_ROUTE = 'zhihu-answer-grabber:grab';

/** Canonical source URL construction mirrors the repo's deterministic ID-based link policy. */
export function questionSourceUrl(questionId) {
  return `https://www.zhihu.com/question/${questionId}`;
}

function failureResult({ retrievedAt, code, failureClass, detail = null, providerErrorType = null }) {
  const failure = { code, class: failureClass };
  if (detail != null) failure.detail = String(detail).slice(0, 500);
  if (providerErrorType != null) failure.provider_error_type = String(providerErrorType);
  return {
    ok: false,
    provider_id: PROVIDER_ZHIHU_SESSION_CAPTURE,
    capability: CAPABILITY_CAPTURE,
    auth_class: AUTH_CLASS_SESSION,
    retrieved_at: retrievedAt,
    items: [],
    failure,
    completeness: {
      status: COMPLETENESS_UNKNOWN,
      evidence: { reason: 'provider_failure' },
    },
  };
}

function firstLine(text) {
  return String(text ?? '').trim().split('\n')[0] ?? '';
}

/**
 * Review repair (P1-2, Issue #37): map a non-zero primitive exit to a machine-readable
 * failure BEFORE parsing — a non-zero exit is a failure regardless of what stdout claims
 * (existing orchestrator primitive semantics fail closed on non-zero exit). A structured
 * `ok:false` error report on stdout is preserved as the provider failure identity
 * (PROVIDER_REPORTED_FAILURE + provider_error_type); anything else — including a stdout
 * claiming ok=true — fails closed as PROVIDER_PROCESS_NONZERO_EXIT.
 */
function processExitFailure({ retrievedAt, res }) {
  let structuredError = null;
  let claimedOk = false;
  try {
    const parsed = JSON.parse(res.stdout);
    if (parsed && parsed.ok === false && parsed.error) structuredError = parsed.error;
    if (parsed && parsed.ok === true) claimedOk = true;
  } catch { /* stdout not JSON — raw output stays the evidence */ }
  if (structuredError) {
    return failureResult({
      retrievedAt,
      code: 'PROVIDER_REPORTED_FAILURE',
      failureClass: 'provider',
      detail: structuredError.message ?? (firstLine(res.stderr) || firstLine(res.stdout)),
      providerErrorType: structuredError.type ?? null,
    });
  }
  return failureResult({
    retrievedAt,
    code: 'PROVIDER_PROCESS_NONZERO_EXIT',
    failureClass: 'process',
    detail: claimedOk
      ? `primitive exited with status ${res.status} but stdout claimed ok=true`
      : (firstLine(res.stderr) || firstLine(res.stdout)),
  });
}

/**
 * @param {object} opts
 * @param {(name: string, args: string[], opts?: object) => { status: number, stdout: string, stderr: string }} opts.runner
 *     primitive runner (same injectable seam as orchestrator.mjs); default spawns the real CLI
 * @param {() => string} [opts.now] injectable ISO clock
 */
export function createSessionCaptureAdapter({ runner, now = defaultNow } = {}) {
  if (typeof runner !== 'function') throw new TypeError('session-capture adapter requires a runner');

  return {
    providerId: PROVIDER_ZHIHU_SESSION_CAPTURE,
    capability: CAPABILITY_CAPTURE,
    authClass: AUTH_CLASS_SESSION,

    /**
     * @param {{ questionId: string, outDir: string }} input
     *     outDir is the capture PARENT directory (the primitive writes <outDir>/<questionId>/)
     * @returns §5.1 provider result (ok=true with one source-group item, or ok=false with failure identity)
     */
    retrieve({ questionId, outDir } = {}) {
      const retrievedAt = now();

      // Static input validation before any subprocess (mirrors the CLI's static-first discipline).
      if (typeof questionId !== 'string' || !/^\d+$/.test(questionId) || typeof outDir !== 'string' || outDir.length === 0) {
        return failureResult({
          retrievedAt,
          code: 'CAPTURE_INPUT_INVALID',
          failureClass: 'input',
          detail: 'questionId must be a decimal ID string and outDir a non-empty string',
        });
      }

      const res = runner('zhihu-grab', [questionId, '--out-dir', outDir, '--json']);

      // Review repair (P1-2, Issue #37): enforce the primitive process contract BEFORE
      // parsing — a non-zero exit is a failure even if stdout claims ok=true.
      if (res.status !== 0) {
        return processExitFailure({ retrievedAt, res });
      }

      let payload = null;
      try {
        payload = JSON.parse(res.stdout);
      } catch {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_OUTPUT_UNPARSEABLE',
          failureClass: 'contract',
          detail: firstLine(res.stdout) || firstLine(res.stderr),
        });
      }

      if (!payload || payload.ok !== true || payload.error) {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_REPORTED_FAILURE',
          failureClass: 'provider',
          detail: payload?.error?.message ?? null,
          providerErrorType: payload?.error?.type ?? null,
        });
      }

      if (payload.stage !== 'captured') {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_RESULT_CONTRACT_INVALID',
          failureClass: 'contract',
          detail: `unexpected capture stage: ${String(payload.stage)}`,
        });
      }

      // Review repair (P1-3, Issue #37): capture success requires verified === false.
      // A payload claiming verified=true is a contract violation — only verify-output may
      // grant validity (captured != verified) — and must fail closed, never propagate.
      if (payload.verified !== false) {
        return failureResult({
          retrievedAt,
          code: 'PROVIDER_RESULT_CONTRACT_INVALID',
          failureClass: 'contract',
          detail: `capture payload must carry verified === false at stage=captured (got ${JSON.stringify(payload.verified)}); validity is granted only by verify-output`,
        });
      }

      if (String(payload.questionId ?? '') !== questionId) {
        return failureResult({
          retrievedAt,
          code: 'CAPTURE_IDENTITY_MISMATCH',
          failureClass: 'contract',
          detail: `requested ${questionId}, primitive reported ${String(payload.questionId)}`,
        });
      }

      const sourceUrl = classifyUrl(questionSourceUrl(questionId));

      return {
        ok: true,
        provider_id: PROVIDER_ZHIHU_SESSION_CAPTURE,
        capability: CAPABILITY_CAPTURE,
        auth_class: AUTH_CLASS_SESSION,
        retrieved_at: retrievedAt,
        items: [
          {
            identity: { kind: 'source-group', questionId },
            provenance: {
              route: SESSION_CAPTURE_ROUTE,
              captureStage: payload.stage,
            },
            source_url: {
              url: sourceUrl.canonicalUrl,
              securityClass: sourceUrl.securityClass,
              displayHost: sourceUrl.displayHost,
            },
            facts: {
              questionTitle: payload.questionTitle ?? null,
              capturedAnswerCount: payload.capturedAnswerCount ?? null,
              artifacts: payload.artifacts ?? null,
            },
          },
        ],
        completeness: {
          status: COMPLETENESS_COMPLETE,
          evidence: {
            source: 'zhihu-grab payload stage=captured',
            basis: 'capture_primitive_completion_contract_requires_server_paging_is_end',
          },
        },
        // Authority boundary (captured != verified): the verified gate above guarantees
        // the primitive carried verified === false; the wrapper emits its own mechanical
        // false and never propagates a truthy value. Validity is granted only by verify-output.
        verified: false,
        validity_authority: 'verify-output',
      };
    },
  };
}

function defaultNow() {
  return new Date().toISOString();
}
