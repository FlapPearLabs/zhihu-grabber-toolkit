# ACCEPTED_EMBEDDING_IMPLEMENTATION_PROFILE_DECISION

```text
DECISION_ID      = ACCEPTED_EMBEDDING_IMPLEMENTATION_PROFILE_DECISION
TICKET           = P1-T01
ISSUE            = FlapPearLabs/zhihu-grabber-toolkit#33
TYPE             = DISCOVERY / EVIDENCE decision artifact
SCOPE_OF_DECISION= initial P1 implementation profile（仅此范围）
DECISION_STATUS  = NON_AUTHORITATIVE_CANDIDATE
BRANCH           = work/p1-t01-embedding-qualification
BASE_SHA         = cf4ce8bba66f11fd52de94e95957a0cd73fba4ea
SAME_HEAD_AS     = docs/t01-embedding-provider-qualification.md
                   + discovery/p1-t01-embedding-qualification/evidence/*.json
SPEC_ANCHOR      = docs/specs/p1-cross-question-deep-research.md §5.3 (EmbeddingProvider contract)
                   + OPEN_DECISION D-1
REVIEW_CYCLE     = R0 candidate @ a0402aee（CHANGES_REQUESTED_NARROW：P1-1/P1-2/P1-3）
                   + R1 REPAIR @ bd24ae2（精确 revision 钉死 / provider 专属失败面 /
                   input-normalization identity）
                   + R2 REPAIR（本 HEAD：FAILURE_IDENTITY 证据完整性，分离
                   A 实测失败身份 / B 仅提案未触发身份，撤销 "all verified" 过度声称）
Date             = 2026-08-30
```

> **生命周期（R3，禁止 post-review 状态编辑）**：本文件在
> `PROFILE_DECISION_EFFECTIVE_ON` 四条件全部满足之前一律为 `NON_AUTHORITATIVE_CANDIDATE`，
> **P1-T10 不得消费**（`UNKNOWN != PASS`）。禁止 "review PASS → 编辑本文件 → 新 commit"。

---

## 1. Decision record

```text
PROVIDER_CATEGORY =
LOCAL

NAMED_PROVIDER =
transformersjs-local-onnx
  transport        = in-process ONNX Runtime (Node)
  providerVersionId= onnxruntime-node-inprocess
  requiresCredential = false

NAMED_MODEL_PROFILE =
Xenova/bge-base-zh-v1.5
  artifact        = onnx/model_quantized.onnx（quantized）
  pooling         = mean
  normalize       = true

MODEL_VERSION_IDENTITY =
  huggingfaceRepoId = Xenova/bge-base-zh-v1.5
  exactRevisionPinned = true            (R1: fetch-model.mjs --revision, no main fallback)
  requestedRevision = 71e50dc531959f9e04ebf190ea25b00261a0a186
  revisionSha       = 71e50dc531959f9e04ebf190ea25b00261a0a186  (hub-resolved == requested)
  perFileSourceRevision = 71e50dc531959f9e04ebf190ea25b00261a0a186 (every file, verified)
  onnx_sha256       = b665f3bba56c3119bc76ba131ebcc544d720a7408cb11581bdf354aaa0198d43
  onnx_bytes        = 102868746
  tokenizer_sha256  = 7dfbf1966ebf99d471c3796e9b457329d2b2182b817e144f1e904b957745c839
  config_sha256     = 855206771223efad2dfb8e212a716b20c4c71c8094309ca2da79d31bacb03276
  tokenizer_config_sha256 = 9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3
  NOTE: cache identity must pin revisionSha + normalization version, per Spec §5.3.

VECTOR_DIMENSION =
768
  (constant across all inputs and batch sizes; observedDimensions = [768])

INPUT_NORMALIZATION_VERSION =   (R1 / P1-3 — MEASURED actual behavior, not invented)
T01_INPUT_NORM_V1
  tokenizerClass    = BertTokenizer (wordpiece, vocab pinned by tokenizer.json sha256)
  instructionPrefix = none (deliberately not applied in this battery)
  maxInputTokens    = 512 (pipeline truncates input to the first 512 tokens; tokenizer
                          itself does NOT truncate: raw 3452 tokens pass through tokenize())
  truncationEvidence= shared-prefix bracketing: 508 tokens -> cos 0.974416 (below window),
                          531 tokens -> cos 1.000000 (at window, identical to 3452-token input)
  pooling           = mean
  definition        = tokenize -> truncate to first 512 tokens -> mean-pool token embeddings
  consequence       = text beyond 512 tokens contributes nothing to the vector (CAVEAT-8)

OUTPUT_NORMALIZATION_VERSION =
L2_UNIT_NORM
  definition  = L2 normalize after pooling
  observed L2 norm range = [1.0, 1.0]
  consequence = cosine similarity equals dot product

EMBEDDING_VERSION_IDENTITY =
  modelRevision + file sha256 (above) + INPUT_NORMALIZATION_VERSION + OUTPUT_NORMALIZATION_VERSION
  discovery runtime identity (from committed package-lock.json):
    node                = v22.22.2
    platform            = darwin
    @xenova/transformers= 2.17.2
    onnxruntime-node    = 1.14.0
    onnxruntime-common  = 1.14.0
    sharp               = 0.32.6
  NOTE: T10 must compose the Spec §5.3 cache identity from these parts — no guessing.

FAILURE_IDENTITY =
  DISCOVERY-PROPOSED (NOT an Approved contract; P1-T10 must re-derive from
  Spec §5.3 / §10.2 under its own review). PROVIDER-SPECIFIC (R1 / P1-2).
  R2 EVIDENCE-INTEGRITY CORRECTION: the prior "Applicable to THIS in-process ONNX
  provider (all verified)" overclaimed the evidence. Only the identities under (A)
  were empirically triggered as observed machine-readable provider failures in T01.
  The identities under (B) are DISCOVERY-PROPOSED identifiers defined in
  providers/errors.mjs but were NOT triggered / NOT observed as failure paths in
  T01. This is a truthful scoping of what the committed evidence demonstrates — it
  is NOT a downgrade of the model selection.

  (A) EMPIRICALLY VERIFIED / OBSERVED IN T01 — this in-process ONNX provider
      (each exercised by an applicable AC_10 failure probe and produced a classified
       machine-readable failure; see evidence/candidate-transformersjs-bge-base-zh-v1.5-r1.json
       AC_10_failure_identity, applicableCount=3, crossProviderClaim=NONE):
    EMBEDDING_MODEL_UNKNOWN
      — unknown/absent model id (allowRemoteModels=false) → fail closed (verified)
      — missing local artifact / load failure         → fail closed (verified)
    EMBEDDING_INPUT_INVALID
      — embed() called with a non-array input → fail closed (verified)

  (B) DISCOVERY-PROPOSED / NOT EMPIRICALLY TRIGGERED IN T01
      (defined in providers/errors.mjs; NOT observed as provider failures in T01;
       may be carried as candidate controller-side production checks for P1-T10 to
       re-derive under its own ticket — do NOT claim T01 verified them):
    EMBEDDING_VECTOR_NON_FINITE
      — vector contains NaN/Inf → NOT OBSERVED / NOT VERIFIED AS FAILURE PATH IN T01
    EMBEDDING_VECTOR_DIMENSION_MISMATCH
      — dimension differs from profile → NOT OBSERVED / NOT VERIFIED AS FAILURE PATH IN T01
      (AC_8 observed the produced vectors to be finite and dimensionally stable;
       that confirms the happy-path vector contract, NOT that the provider emits
       these codes when the adverse condition occurs. No T01 probe injected
       NaN/Inf or an off-dimension vector, so no failure path was demonstrated.)

  N/A for this in-process provider surface (truthful — NOT endpoint failures for this profile):
    EMBEDDING_PROVIDER_UNREACHABLE — in-process transport has NO network endpoint;
                                     this surface belongs to the HTTP-server provider
                                     family (e.g. lmstudio-local-embeddings). No
                                     cross-provider failure claim is present.
    EMBEDDING_PROVIDER_HTTP_ERROR  — same reason as above.

EGRESS_CLASSIFICATION =
LOCAL / NO_NEW_EGRESS = YES   (revalidated in R1)
  embed-time outbound network = NONE (mechanically verified, AC_11, R1 black-hole rerun
                                     byte-identical to the online run)
  only network action = one-time INBOUND acquisition of public model weights at the exact
                        pinned revision (identity.json schemaVersion 2; fallbackToMainUsed=false)
  corpus egress = false
  credential used = false

SUPPORTING_EVIDENCE =
  docs/t01-embedding-provider-qualification.md                       (report, same HEAD)
  discovery/p1-t01-embedding-qualification/evidence/candidate-transformersjs-bge-base-zh-v1.5-r1.json   (R1, authoritative)
  discovery/p1-t01-embedding-qualification/evidence/candidate-transformersjs-bge-small-zh-v1.5-r1.json
  discovery/p1-t01-embedding-qualification/evidence/candidate-lmstudio-nomic-embed-text-v1.5-r1.json
  discovery/p1-t01-embedding-qualification/evidence/ac11-offline-blackhole-proxy-bge-base-zh-v1.5-r1.json
  discovery/p1-t01-embedding-qualification/evidence/remote-capability-deepseek.json
  discovery/p1-t01-embedding-qualification/fixtures/zh-semantic-battery.json
  discovery/p1-t01-embedding-qualification/                          (probe harness + README + lockfile)
  (R0 非 -r1 证据文件保留作已审历史；其 AC_10 跨 provider 探针为 P1-2 已修正缺陷)

QUALIFICATION_SCOPE =
  battery          = P1_T01_ZH_SEMANTIC_BATTERY_V1 (handcrafted synthetic Chinese)
  candidates       = 3 LOCAL (bge-small-zh-v1.5, bge-base-zh-v1.5, nomic-embed-text-v1.5)
                     + REMOTE assessed as NOT_QUALIFIABLE_IN_THIS_ENVIRONMENT
  environment      = Node v22.22.2 / darwin, single machine, CPU
  measured ACs     = AC_1 relevance, AC_2 near-dup vs novel, AC_3 terminology variation,
                     AC_4 (cross-topic, informational), AC_4b within-anchor opposition,
                     AC_5 short-query→long-passage, AC_6 determinism, AC_7 malformed input,
                     AC_8 vector contract, AC_9 identity, AC_10 failure identity (provider-
                     specific), AC_11 no-egress, + input-side normalization measurement (R1)
  outcome          = 9 pass / 1 fail / 0 unknown  (R1 rerun on exact pinned revision;
                     numerically identical to R0 — no evidence drift)
  NOT covered      = real-Zhihu end-to-end acceptance (P1-T16 dogfood),
                     cross-domain generalization, GPU/other OS, real-corpus throughput
```

---

## 2. CAVEATS

```text
CAVEAT-1 (model limitation, architecturally routed)
  Within-anchor opposing-vs-paraphrase discrimination is imperfect (I1 margin = -0.0816).
  Per Spec §3.2 the `Contradictory` dimension is explicitly relocated to
  retrieval / soft features / diagnostics / opposing-query / claim-stage — NOT to dense geometry.
  HARD CONSEQUENCE FOR DOWNSTREAM: P1-T11 must NOT rely on cosine similarity alone to decide
  claim opposition; P1-T13/T14 must implement opposition at claim-stage.

CAVEAT-2 (sampled scope)
  One handcrafted battery, three candidates, one machine, CPU, synthetic Chinese text.
  Not a universal benchmark, not a Gold set, not cross-domain proof.

CAVEAT-3 (dependency and footprint)
  Requires 103 MB model weights and an in-process ONNX runtime.
  P1-T01 introduces it only as a discovery-scoped devDependency in an isolated directory
  (own package.json; no production package.json or lockfile touched).
  P1-T10 must promote it to a production dependency under its own review and record the
  RULES.md §7 justification.

CAVEAT-4 (latency is a single CPU observation)
  1469 ms / 32 batches is one measurement, not a real-corpus throughput validation.

CAVEAT-5 (downgrade clause — explicit, not silent)
  If P1-T10 implementation validation shows base is operationally unacceptable on real corpus
  scale, `Xenova/bge-small-zh-v1.5` (512d) is the pre-measured fallback. The measured quality
  delta (terminology C3 0.1541 → 0.0743; within-anchor I2 +0.0281 → -0.0959) must be recorded
  as the trade-off. This is a T10 decision under test, NEVER a runtime silent fallback
  (Spec §10.2 NO_SILENT_PROVIDER_FALLBACK).

CAVEAT-6 (historical harness model not auto-approved)
  `bge-small-zh-v1.5` was empirically evaluated and NOT selected. The selected profile was
  chosen from this battery's measured discrimination data, independent of harness history.

CAVEAT-7 (remote path remains closed, not rejected)
  REMOTE is recorded as NOT_QUALIFIABLE_IN_THIS_ENVIRONMENT: the only credentialled remote
  provider (DeepSeek) exposes no embeddings endpoint (HTTP 404 on /v1/embeddings and
  /embeddings); no other remote embedding credential exists. Any future REMOTE profile
  additionally requires P1-T02 / GATE-2 egress authority. P1-T01 does not activate T02.

CAVEAT-8 (input truncation — R1 MEASURED, not invented)
  This profile truncates input to the first 512 tokens (tokenizer itself does not
  truncate). 508 tokens → cos 0.974416 (below window); 531 tokens → cos 1.000000,
  identical to a 3452-token input. 512 == model max_position_embeddings.
  INPUT_NORMALIZATION_VERSION captures this. Any change (e.g. instruction prefix or
  different truncation) changes the version and invalidates the Spec §5.3 cache identity;
  re-qualification is required. T10 must surface this to operators.

CAVEAT-9 (exact revision is a hard acquisition requirement — R1)
  fetch-model.mjs requires --revision <sha> and fails closed (exit 2) if the revision
  is unavailable or the hub-resolved sha differs; there is NO fallback to `main`.
  T10 production model acquisition must keep the same pinned revision and verify file
  sha256. Model updates are a new-revision re-qualification, not a silent bump.
```

---

## 3. Status and effect

```text
DECISION_STATUS =
NON_AUTHORITATIVE_CANDIDATE

PROFILE_DECISION_EFFECTIVE_ON =
  1. this artifact exists on the exact P1-T01 candidate HEAD
     (together with the qualification report and evidence files);
  2. EVIDENCE_REVIEWER PASS on that exact same HEAD;
  3. that exact reviewed HEAD is ff-only merged to remote master;
  4. remote master is re-fetched and verified to contain it.

BEFORE all four conditions:
  decision = NON_AUTHORITATIVE_CANDIDATE
  P1-T10 MUST NOT consume it.

AFTER all four conditions:
  decision = ACCEPTED_EMBEDDING_IMPLEMENTATION_PROFILE_DECISION
  (scope: initial P1 implementation profile only)

FORBIDDEN:
  Evidence Review PASS → edit this file → new commit.
  Any change requested by the reviewer requires a NEW candidate HEAD and a FRESH review.
```

---

## 4. Downstream routing

```text
LOCAL outcome ⇒ NO_NEW_EGRESS = YES
  P1-T10 blocking set (LOCAL branch) = P1-T01 (#33) only.
  P1-T02 (#34) stays CONDITIONAL_NOT_ACTIVE and is never activated by this decision.

REMOTE outcome ⇒ (not taken)
  would have required P1-T10 BLOCKED_BY = P1-T01 + P1-T02.
```

---

*本文件与 qualification report 位于同一 exact candidate HEAD，供独立 EVIDENCE_REVIEWER
在同一 HEAD 上审查。SELF_REVIEW != INDEPENDENT_REVIEW。*
