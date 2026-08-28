# evidence-gate-01 — P1 Decision-Grade Evidence Gate 01

> Benchmark-only experiment. **NOT production RCE. No Spec. No version.**
> `TARGET_STATUS = NOT_IMPLEMENTED` / `IMPLEMENTATION_AUTHORIZATION = NONE` /
> `SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_REVIEW`（最终状态见
> `packets/P1_DECISION_GRADE_EVIDENCE_GATE_01_REVIEW_PACKET_FOR_CHATGPT.md`）。

## 1. What this is

Two phases inside one gate:

1. **D2.1 evaluator correction** — fixes the confirmed `QUESTION_PROVENANCE_LOST`
   defect (`question_id = qidOf(primary_sources[0])` collapsed cross-question
   aspects onto one question and depended on gold array order). See
   `packets/D2.1_CORRECTION_PACKET.md`, `packets/D2_TO_D2.1_METRIC_DIFF.md`.
2. **Four-strategy fair race** — B0 popularity / B1 real dense semantic Top-K /
   B2 question-stratified simple / B3 dense MMR + current mechanical lanes,
   on 8 pilot cases **plus one new real cross-domain case**
   (`case-hpylori-treatment`, medical — 216 sources, 5 questions, frozen
   PROVISIONAL gold). Pre-registered before any result
   (`pre-registration/EXPERIMENT_PRE_REGISTRATION.json`).

## 2. Reproducibility (A4) — fresh checkout → results, no symlinks

```bash
# 1) fresh checkout of the repo (or this directory)
git clone <repo> zhihu-grabber-toolkit && cd zhihu-grabber-toolkit/evidence-gate-01

# 2) install JS deps (node >= 22)
npm install --registry=https://registry.npmjs.org

# 3) one-command pinned dense embedding model fetch + SHA-256 verify
node scripts/fetch-dense-model.mjs

# 4) tests (41: 24 benchmark + 11 provenance + 6 race)
node --test "tests/*.test.mjs"   # Windows/node22-safe glob form
#   (plain `node --test tests/` fails on win32: directory arg is treated as a module)

# 5) D2.1 validation (corpus integrity / gold freeze / scope model /
#    order invariance / runs completeness / selection identity / diff / leaks)
node scripts/validate-d21.mjs

# 6) race validation (preregistration match / same-pool / schema /
#    gold freeze / oracle isolation / dense identity / determinism / coverage)
node scripts/validate-race.mjs

# 7) result analysis (tables, Q2 dense-vs-ngram, winner sensitivity,
#    second-adjudication packet)
node scripts/analyze-race.mjs      # requires: node --input-type=module -e "import('./scripts/analyze-race.mjs').then(m=>{m.printSummary()})"
node scripts/phase-c.mjs
```

All scripts resolve paths from their own location (`lib/paths.mjs`
`import.meta.url`), so any cwd works and **no symlink is ever needed**. The
old harness defect (`benchmark/corpus` missing vs `harness/corpus` present)
is fixed by the canonical `corpus/` layout in this tree.

## 3. Layout

```text
lib/            D2.1-corrected harness (value-units scope model, metrics,
                selectors + race selectors, dense-embed, paths, ...)
scripts/        run-d21 / run-race / validate-d21 / validate-race /
                analyze-d21-diff / analyze-race / phase-c / build-hpylori-gold.py /
                fetch-dense-model / leak-check
tests/          benchmark.test.mjs (24) + provenance.test.mjs (11) + race.test.mjs (6)
corpus/         8 pilot-case corpus (frozen D2, manifest.frozen-d2.json) +
                case-hpylori-treatment corpus (5 qids, 216 sources)
cases/          8 pilot cases (gold byte-identical to pilot D2) + case-hpylori-treatment
pre-registration/ EXPERIMENT_PRE_REGISTRATION.json + gold-freeze-record.json
adjudication/   TRACK_B gold authority (reference) + decision-sensitive packet + key
results/d21/    D2.1 rerun (96 runs) + d2-to-d21-diff.json
results/race/   race (135 runs) + summary + decision tables + Q2 + sensitivity
dense-embedding/model-sha256.txt   pinned model identities (files not committed)
packets/        D2.1_CORRECTION_PACKET.md, D2_TO_D2.1_METRIC_DIFF.md,
                DECISION_SENSITIVE_SECOND_ADJUDICATION_PACKET.md,
                P1_DECISION_GRADE_EVIDENCE_GATE_01_REVIEW_PACKET_FOR_CHATGPT.md
```

## 4. Frozen inputs (pre-registered, see EXPERIMENT_PRE_REGISTRATION.json)

- Corpus: pilot 8 cases unchanged (sha256-pinned); new case captured
  `2026-08-28T04:25Z` (216 sources, verify-output valid).
- Gold: pilot gold byte-identical to D2 pack; new case PROVISIONAL
  `g2-gate01-provisional-hpylori` frozen BEFORE strategy runs
  (`gold-freeze-record.json`; validator asserts hash equality).
- Dense model: `Xenova/bge-small-zh-v1.5` fp32 ONNX (512-dim), pinned + SHA
  verified, `allowRemoteModels=false` at runtime; deterministic normalization;
  disk + memory cache. Never falls back to ngram.
- Metric version: D2.1 corrected evaluator.

## 5. Status flags

```text
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
SPEC_PREPARATION_GATE = NOT_READY_PENDING_CHATGPT_REVIEW
B2_MMR_PLUS_LANES_WINNER = NOT_ESTABLISHED
CURRENT_STAGE = LATE_VALIDATION
NEXT_GATE = ONE_MORE_EVIDENCE_GATE (this packet) -> ChatGPT formal review
```