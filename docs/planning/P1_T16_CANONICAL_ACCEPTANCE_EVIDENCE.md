# P1-T16 — Canonical End-to-End Acceptance Evidence (dogfood)

```text
TICKET                 = P1-T16 (GitHub Issue #48)
TYPE                   = DOGFOOD / ACCEPTANCE EVIDENCE (non-authoritative until independent review)
EXECUTOR_ROLE          = T16_CANONICAL_EXECUTOR
MASTER_SHA             = 9444a33b3ca24a53f8da4b9e2cb03a241925f47f
RUN_ID                 = bb8a745ce60523814bd493b35bcd4593942e3a21678cf2f318d8e19c14ca3085
WORK_DIR (relative)    = work/canonical-t16-run2-20260913T135310Z
EXECUTION_CLASS        = CANONICAL_ACCEPTANCE
EXECUTOR_VERDICT       = PASS
NEXT_LEGAL_ACTION      = INDEPENDENT_EVIDENCE_REVIEW
ISSUE_STATE            = OPEN (not closed) / TRACKER = NOT MODIFIED
```

Machine-readable twin: `docs/planning/P1_T16_CANONICAL_ACCEPTANCE_EVIDENCE.json`.

## 1. Frozen inputs and authority

| Item | Value |
|---|---|
| Repository | FlapPearLabs/zhihu-grabber-toolkit |
| Authoritative master (fresh `git ls-remote`) | `9444a33b3ca24a53f8da4b9e2cb03a241925f47f` |
| Frozen research topic | `AI 编程工具会取代程序员吗` |
| Declared canonical runtime | `deepseek-api-tool-less` |
| Requested model (owner ruling 2026-09-10) | `deepseek-v4-pro` |
| Provider-served model (observability only) | `deepseek-v4-pro` |
| Canonical entrypoint | `research-orchestration/bin/canonical-runner.mjs` |
| Fresh isolated worktree | new detached worktree at the authorized SHA — no historical T16 worktree/run artifact reused; `seam-b-real.json` / `seam-c-real.json` / `seam-d-real.json` not restored; `git stash` never used |

Production call path, mechanically confirmed by reading the shipped source:

```text
canonical-runner.mjs
  → RESEARCH_ENTRY_REL = research-orchestration/bin/research-p1.mjs      (canonical-runner.mjs:60)
  → composeP1Research() in lib/p1-runtime-composer.mjs                   (research-p1.mjs:38,104)
  → lib/coverage-final-integration.mjs  (T06/T07 retrieval → T08 selection
    → T09 group execution → T11 dense geometry → T12 RCE → T13 per-group
    → T14 synthesis → T15 final reconciliation)                        (p1-runtime-composer.mjs:53-67,415-508)
```

No test or internal direct invocation was substituted for this path; the canonical gate itself spawned the production entrypoint (`--json --restart --runtime deepseek-api-tool-less --work <dir> <topic>`, `canonical-runner.mjs:122-126`).

## 2. Preflight

```json
{ "mode": "canonical", "stage": "intermediate", "verdict": "PREFLIGHT_PASS",
  "failures": [], "warnings": [], "failedCodes": [] }
```

Invoked exactly as authorized (`--mode canonical`, **no** `--stage final`). Exit 0.

## 3. Canonical runner evidence (machine-readable)

```json
{ "schema": "canonical-runner-evidence/1", "verdict": "PASS", "executionClass": "CANONICAL",
  "runtimeId": "deepseek-api-tool-less", "model": "deepseek-v4-pro",
  "evidence": { "runId": "bb8a745c…30d85", "researchExitCode": 0, "restarted": true,
    "workDir": "work/canonical-t16-run2-20260913T135310Z",
    "artifacts": { "resultFile": "research-result.json",
                   "resultSha256": "f42838585acd5d263ab00bc1cb32f13c46d17ec8844acc94bc5d145f187b28b5",
                   "verified": true } } }
```

This is the ONLY evidence class that satisfies `finalAcceptanceEligible` (declaration-bound runtimeId/model + `executionClass = CANONICAL` + actual execution). Offline dry-run and local smoke can never satisfy it.

## 4. Critical assertions

| Assertion | Value | Status |
|---|---|---|
| `verification.valid` | `true` (`t14PreSynthesisGuard=PASS`, `t15FinalReconciliation=PASS`, `groupsVerified=4/4`) | PASS |
| Selected verified identity set == analyzed identity set | `selectedVerifiedSourceSetIdentity == mappedAnalyzedSourceSetIdentity == sha256:acabad96b744b7269bf78aebdcd5f0aef9cb2819690540cfda896a9b5a71c393` | PASS |
| `ANALYSIS_COVERAGE` | `396 / 396 / 396` (selected / mapped / analyzed), `assertion.is100PercentAnalysis = true`, `basis = MECHANICAL_SET_EQUALITY` | 100% |
| `evidenceRefIssues` | `missingRefs=0, duplicateRefs=0, staleRefs=0, invalidRefs=0` | PASS |

**100% ANALYSIS coverage is not a 100% RETRIEVAL-coverage claim.** The assertion is produced exclusively by the frozen T15 mechanical set equality over the *analyzed* set. Retrieval stopped at `query_budget_exhausted` after 1 round (36 fused candidates) — that is an honest, disclosed retrieval stop, not a coverage claim.

## 5. The 17 acceptance rows

| # | Row | Verdict | Fresh-run evidence |
|---|---|---|---|
| 01 | MULTIPLE QUESTIONS / SOURCE GROUPS | **PASS** | 4 distinct source groups auto-selected from 36 fused candidate groups: `2077824745589028563`, `2038411932424725710`, `1962444467077358693`, `8345110904`; all 4 executed (`handoffValid=true`, stage `handed_off`); captured+verified answers 170/98/109/19 = **396** |
| 02 | MULTI-PROVIDER | **PASS** | 2 providers **actually invoked this run** (16 channel executions, `providerFailures=[]`): `zhihu-official-search` (8/8 ok, 54 items, completeness `unknown`) and `zhihu-open-platform` (8/8 ok, 80 items, completeness `complete`, `HasMore=false`). Capability `search` for both; auth class `official-secret` |
| 03 | AMBIGUITY / DUAL SELECTOR | **PASS** | Dual selector both exercised in-run: (a) source-group selector `lib/source-group-selection.mjs` → `source-group-selection-decision.json` (verdict `auto`, reason `clear_best`, `planHashMatch=true`); (b) RCE corpus selector `lib/rce-corpus-selector.mjs` → selected corpus identity `sha256:acabad96…`. Ambiguity arm conditionally not triggered in this run (boundary unambiguous). The ambiguity detector is demonstrated by the **recorded real failure attempt** (material_ambiguity → structured clarification with 6 options → stop, no guessing) plus authorized tests (R3 clarification binding, CE8). See §6 |
| 04 | DENSE GEOMETRY | **PASS** | In-run local dense layer engaged: `transformersjs-local-onnx` / `Xenova/bge-base-zh-v1.5` @ `71e50dc531959f9e04ebf190ea25b00261a0a186`, 768-dim, `noNewEgress=true`. The composer's dense stage is **fail-closed** (missing provider preflight or a missing per-source/target vector aborts the compose) — completion therefore proves all 396 source vectors + 4 group target vectors were computed. Provider independently verified offline under a black-hole proxy (unit-norm 768-dim output). Artifacts are not persisted to disk ⇒ evidence is behavioral + provider identity, not a vector dump |
| 05 | RCE | **PASS** | RCE selector produced the analyzed corpus: `selectedCorpusSourceCount=396`, `per_group_selection_coverage = 1.0` for all 4 groups, `largest_group_share=0.429`, `claim_source_diversity=1`; distinct RCE mode identity enforced (`SEAM_B_MODE_IDENTITY_CONFLICT` guard) |
| 06 | PER-GROUP ANALYSIS | **PASS** | `per-group-claims.json`: 4 `groupRepresentations`, each `completenessStatus=verified`, per-group accounting `selected=verified=mapped=analyzed` (109/98/170/19); 14 claims total (12 main + 2 minority) with `sourceRefs` + deterministically derived `authorRef`; 23 expert-evidence-rich refs |
| 07 | CROSS-GROUP SYNTHESIS | **PASS** | `cross-source-synthesis.json`: `synthesisIdentity=sha256:6e83cf0f…`, 2 synthesized claims over aspects `AI对程序员职业的替代影响` / `AI编程能力局限`, drawing support from **all 4 distinct source groups**; `categoryDistribution={widely-shared:1, group-specific:1}`; synthesis carries `groupDifferences` + `evidenceStrength` |
| 08 | T15 100% ANALYSIS COVERAGE | **PASS** | `coverage-final.json.assertion={is100PercentAnalysis:true, basis:MECHANICAL_SET_EQUALITY}`; `hookConvergenceOrder = [RETRIEVAL_ROUNDS, SOURCE_GROUP_SELECTION, GROUP_EXECUTION, CORPUS_SELECTION, PER_GROUP_ANALYSIS, CROSS_SOURCE_SYNTHESIS, FINAL_COVERAGE_RECONCILIATION]` — T15 last, exact canonical prefix; event `final_coverage_reconciliation is100PercentAnalysis=true` |
| 09 | PARTIAL != FULL | **PASS** | Full run discloses `gap=null` + `complete=true`; the partial arm is fail-closed and demonstrated by (a) the **real recorded failure attempt** which wrote NO `research-result.json` and NO `coverage-final.json` (no false FULL/PASS), and (b) authorized tests `CE6b` / `CE8` (failed or clarification compose never writes the render binding or a coverage-final artifact). T15 refusal path emits `COVERAGE_ERROR_INCOMPLETE_ANALYSIS` + `partialDisclosure.gap{missingAnalyzed,missingMapped}` |
| 10 | RESUME | **PASS** | Identity-safe, on the primary run's own work dir: production P1 entrypoint re-invoked **without** `--restart` → exit 0, `reused=true`, **same runId**, and byte-identical artifacts before/after (`research-result.json`, `coverage-final.json`, `orchestration-state.json` sha256 unchanged) — no new run identity, no contamination. Stale/mismatch refusal covered by authorized tests: `state: FILE EXISTS != VALID CACHE — hash mismatch is stale`; `state: run identity mismatch → state_mismatch`; `CASE D` resume; `CASE E` stale artifact re-run, no silent reuse |
| 11 | DISCLOSURE | **PASS** | `research-result.json.disclosure` complete and truthful: `pipeline`, `stage=FINAL_COVERAGE_RECONCILIATION`, `isFullCoverage=true`, `complete=true`, `analysisCoverage{396,396,396}`, `retrieval{rounds=1, stopReason=query_budget_exhausted, fusedCandidateCount=36, fusedGroupCount=4, providerFailureCount=0}`, `gap=null` |
| 12 | EXACT RUNTIME | **PASS** | `orchestration-state.json.runtime = deepseek-api-tool-less`; runner evidence `runtimeId = deepseek-api-tool-less`; scan of the run artifacts for `lmstudio` / `qwen` / `localSmoke` / `127.0.0.1:1234` → **0 hits** |
| 13 | MODEL ROUTE / AUTH | **PASS** | Requested `deepseek-v4-pro` (owner-authorized request route). Provider-**served** name observed `deepseek-v4-pro`, treated as observability only (never an equality gate). Authenticated live calls succeeded end-to-end: planner usage entry (`deepseek-v4-pro`, 1230 tokens, 8131 ms) plus real T13/T14 semantic output. Credential resolved from the declared 0600 file `.deepseek_api_key` (env-first); value never read/printed/logged by preflight or by this report |
| 14 | NO FALLBACK | **PASS** | Runtime-authority refusals proven live without starting any run: (a) canonical runner without the canonical overlay → `CANONICAL_RUNNER_MODE_REFUSED`; (b) P1 entrypoint with a non-declared runtime (`lmstudio-local-tool-less`) → `invalid_input … NO_SILENT_RUNTIME_FALLBACK` (exit 2). No work dir created in either case. Adapter-level identity pin + declared-runner-only execution + `CE7b` / `CE8-static` tests |
| 15 | GENUINE FAILURE | **PASS** | Authorized controlled negative path (F6 `negativeGuardProbe`, `bin/integration-harness.mjs`) against the real run's real artifact identity: tampered mapped identity → `FAIL_CLOSED` (`SEAM_C_GUARD_MISMATCH`), "no synthesis authorized". Plus the real recorded hard-stop attempt (§6) and tests `CE6b` / `CE8` |
| 16 | REPO-TRACKED SANITIZED EVIDENCE | **PASS** | This report + `P1_T16_CANONICAL_ACCEPTANCE_EVIDENCE.json`, under repo-tracked `docs/planning/`, work-relative refs only. Sanitization mechanically checked: 0 absolute host paths, 0 credential/secret-shaped strings, 0 raw corpus text |
| 17 | EXACT RUN IDENTITY | **PASS** | `runId=bb8a745ce60523814bd493b35bcd4593942e3a21678cf2f318d8e19c14ca3085`; `masterSha=9444a33b…`; `planHash=6e0640aeed7b434af7bb8cb0126fd15f616bac5b8eba3f82cd5728a886711e26`; `resultSha256=f4283858…`; `coverageFinalSha256=ee25c769…`; workDir `work/canonical-t16-run2-20260913T135310Z`; runner `startedAt 14:35:50.863Z` → `finishedAt 14:41:06.598Z` |

D4 planner contract check (prerequisite for any of the above): fresh planner output has 5 `sourceGroupIntents`, **every** `groupKey === null` and **every** `constraints === []` → `D4_ALL_SATISFIED = true`. No coercion was applied.

## 6. Environment repair and the real failure record (executor disclosure)

Two environment defects were found in the fresh worktree. Both were repaired as **environment provisioning only** — no source, test, prompt, threshold, model, provider, or product behaviour was changed.

| # | Defect | Root cause (proven) | Repair |
|---|---|---|---|
| E1 | `research-orchestration/node_modules` absent; `@xenova/transformers` unloadable | transitive `sharp@0.32.6` had no prebuilt binary (proxy blocked) and fell back to a source build with no libvips; then undici's experimental env-proxy agent aborts the **4th sequential full-file fetch** in one process (reproduced deterministically: 3 small files OK, 4th large file aborts at timeout; the same URL succeeds as the first request of a fresh process) | installed deps with the proxy; rebuilt `sharp` against its successfully-vendored libvips v8.14.5; acquired the ONNX artifact from the **same pinned revision URL** and verified it against the **product's own frozen profile hashes** — all 4 artifacts `MATCH` (`ACCEPTED_LOCAL_PROFILE.artifacts`) |
| E2 | `zhihu-answer-grabber/node_modules` absent → `parse5` `ERR_MODULE_NOT_FOUND` → `zhihu-official-search` returned `PROVIDER_PROCESS_NONZERO_EXIT` on every channel | the fresh worktree has no gitignored `node_modules`; runtime deps were never installed | `npm ci --omit=dev` in `zhihu-answer-grabber`; official search re-verified live (7 real candidates returned) |

Attempt-1 (`work/canonical-t16-20260913T135310Z`) is retained as the **real failure record** required by Issue #48. It ran before E2 was repaired and stopped at a hard gate:

```text
terminal state     : clarification_required (material ambiguity in source-group selection, 6 structured options)
canonical runner   : FAILED / CANONICAL_RESEARCH_FAILED (exit 3)
research-result    : ABSENT      (no false FULL/PASS)
coverage-final     : ABSENT      (no false FULL/PASS)
```

This consumption of the single permitted re-run was **environment-cause**, not a transient-provider retry: it is reported explicitly here so the independent reviewer can judge it. No run was retried for a more favourable outcome; no deterministic failure was ever retried.

## 7. Offline suite (repository-authorized validation)

`node --test test/*.test.mjs` in `research-orchestration`, on the same exact SHA: **exit 0 — 838 tests, 73 suites, 829 pass, 0 fail, 9 skipped**. Includes the negative/ordering/resume evidence cited above (`CASE D`, `CASE E`, stale-hash, run-identity mismatch, `D6-CE6` awaited-T14→T15 ordering, `CE6b`, `CE8`, F6 guard probe).

## 8. Explicit non-claims

- Not a claim of 100% **retrieval** coverage; retrieval stopped deterministically at `query_budget_exhausted`.
- Not a claim that ambiguity resolution ran in the successful run; it did not (boundary unambiguous) — see row 03 and §6.
- Not acceptance: `finalAcceptanceEligible` here means the canonical runner emitted declaration-bound PASS evidence. The **independent evidence review + owner-level final gate have not happened**; Issue #48 stays OPEN and the Tracker is unmodified.
- No product code, test, prompt, threshold, model, provider, or declaration was modified by this executor.
