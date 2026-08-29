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
  revisionSha       = 71e50dc531959f9e04ebf190ea25b00261a0a186
  onnx_sha256       = b665f3bba56c3119bc76ba131ebcc544d720a7408cb11581bdf354aaa0198d43
  onnx_bytes        = 102868746
  tokenizer_sha256  = 7dfbf1966ebf99d471c3796e9b457329d2b2182b817e144f1e904b957745c839
  config_sha256     = 855206771223efad2dfb8e212a716b20c4c71c8094309ca2da79d31bacb03276
  tokenizer_config_sha256 = 9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3
  NOTE: cache identity must pin revisionSha + normalization version, per Spec §5.3.

VECTOR_DIMENSION =
768
  (constant across all inputs and batch sizes; observedDimensions = [768])

NORMALIZATION_PROFILE_IDENTITY =
L2_UNIT_NORM
  definition  = mean pooling, then L2 normalize
  observed L2 norm range = [1.0, 1.0]
  consequence = cosine similarity equals dot product

FAILURE_IDENTITY =
  DISCOVERY-PROPOSED (NOT an Approved contract; P1-T10 must re-derive from
  Spec §5.3 / §10.2 under its own review):
    EMBEDDING_MODEL_UNKNOWN          — unknown model name → fail closed
    EMBEDDING_PROVIDER_UNREACHABLE   — transport unreachable
    EMBEDDING_PROVIDER_HTTP_ERROR    — non-2xx, not classified above
    EMBEDDING_RESPONSE_SCHEMA_INVALID— response shape violated
    EMBEDDING_INPUT_INVALID          — input not an array of strings
    EMBEDDING_VECTOR_NON_FINITE      — vector contains NaN/Inf
    EMBEDDING_VECTOR_DIMENSION_MISMATCH — dimension differs from profile
  Observed on this profile:
    unknown model      → EMBEDDING_MODEL_UNKNOWN        (verified)
    unreachable endpoint → EMBEDDING_PROVIDER_UNREACHABLE (verified)

EGRESS_CLASSIFICATION =
LOCAL / NO_NEW_EGRESS = YES
  embed-time outbound network = NONE (mechanically verified, AC_11)
  only network action = one-time INBOUND acquisition of public model weights
  corpus egress = false
  credential used = false

SUPPORTING_EVIDENCE =
  docs/t01-embedding-provider-qualification.md                       (report, same HEAD)
  discovery/p1-t01-embedding-qualification/evidence/candidate-transformersjs-bge-base-zh-v1.5.json
  discovery/p1-t01-embedding-qualification/evidence/candidate-transformersjs-bge-small-zh-v1.5.json
  discovery/p1-t01-embedding-qualification/evidence/candidate-lmstudio-nomic-embed-text-v1.5.json
  discovery/p1-t01-embedding-qualification/evidence/ac11-offline-blackhole-proxy-bge-base-zh-v1.5.json
  discovery/p1-t01-embedding-qualification/evidence/remote-capability-deepseek.json
  discovery/p1-t01-embedding-qualification/fixtures/zh-semantic-battery.json
  discovery/p1-t01-embedding-qualification/                          (probe harness + README)

QUALIFICATION_SCOPE =
  battery          = P1_T01_ZH_SEMANTIC_BATTERY_V1 (handcrafted synthetic Chinese)
  candidates       = 3 LOCAL (bge-small-zh-v1.5, bge-base-zh-v1.5, nomic-embed-text-v1.5)
                     + REMOTE assessed as NOT_QUALIFIABLE_IN_THIS_ENVIRONMENT
  environment      = Node v22.22.2 / darwin, single machine, CPU
  measured ACs     = AC_1 relevance, AC_2 near-dup vs novel, AC_3 terminology variation,
                     AC_4 (cross-topic, informational), AC_4b within-anchor opposition,
                     AC_5 short-query→long-passage, AC_6 determinism, AC_7 malformed input,
                     AC_8 vector contract, AC_9 identity, AC_10 failure identity, AC_11 no-egress
  outcome          = 9 pass / 1 fail / 0 unknown
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
