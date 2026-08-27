# Runtime Strategy — V0.3 Architecture Record

> Status: ACCEPTED PROJECT ARCHITECTURE RECORD
> Scope: post-V0.3 normalization of already-validated runtime architecture and engineering lessons.
> This document does not amend Approved Specs, change product behavior, or start V0.4.

## 1. Why this record exists

V0.3 began with capability-isolation work and progressively exercised multiple runtime candidates. Real dogfood exposed an important distinction that was not explicit enough at the start:

```text
capability isolation != model quality
```

A runtime can be safely capability-isolated yet still be a poor operational choice for a particular workload because of model-output quality, inference-profile sensitivity, latency, cost, or completion reliability.

V0.3 therefore converged on a provider-independent controller/runtime architecture rather than a product design tied to one model or one execution location.

## 2. Architectural boundary

The trusted controller owns deterministic truth and execution authority.

Controller-owned responsibilities include:

- canonical source identity;
- source coverage;
- canonical evidence lineage;
- projection construction and sanitization;
- structured-output validation;
- runtime selection and qualification status;
- filesystem/network IO owned by the controller;
- fail-closed behavior;
- mode identity and full-vs-sampled disclosure.

The model owns semantic generation only.

The model must not be treated as authority for canonical identity, evidence lineage, coverage, credentials, filesystem/network access, or product-mode semantics.

A concise design rule is:

```text
Controller owns truth and authority.
Model owns semantics.
```

This principle was strengthened during T11-R1 when model-generated `sourceId` was removed from the model-output contract and source identity became controller-owned deterministic state.

## 3. Runtime is replaceable infrastructure

Runtime choice is an execution dependency, not product identity.

A runtime change must not silently change:

- `captured != verified` semantics;
- deterministic verification authority;
- canonical source identity;
- evidence lineage;
- full-coverage requirements;
- sampled-vs-full mode identity;
- fail-closed semantics;
- credential boundaries.

Runtime-specific model parameters are qualification/profile evidence, not product semantics unless an Approved Spec explicitly elevates one to a product requirement.

Examples of runtime/profile evidence that should normally stay out of product contracts:

- model version;
- thinking / non-thinking mode;
- temperature;
- top-p / top-k / min-p;
- max completion tokens;
- provider-specific JSON-output knobs;
- provider-specific retry/rate-limit details.

## 4. V0.3 validated runtime state

### 4.1 `lmstudio-local-tool-less`

V0.3 proved that a local LM Studio runtime can satisfy the capability-isolation requirement with a zero model-visible tool surface and controller-owned IO.

That qualification remains valid for the reviewed runtime/profile. It is not invalidated by later cloud-runtime work.

Real T11 dogfood also exposed Qwen3 1.7B model-quality limitations under this workload, including probabilistic structured-output problems and later completion-loop/length failures. Those are model-quality observations, not evidence that the capability-isolation boundary failed.

Therefore:

```text
CAPABILITY_ISOLATION_AVAILABLE[lmstudio-local-tool-less] = YES
MODEL_QUALITY_FOR_LARGE_T11_WORKLOAD = LIMITED
```

The second statement is workload-specific evidence, not a global claim about LM Studio or Qwen models.

### 4.2 `deepseek-api-tool-less`

T11-R2 added and independently qualified a remote `deepseek-api-tool-less` runtime while preserving the same controller-owned identity/lineage boundary.

It was then used to complete the real V0.3 dogfood bands at approximately 79 / 183 / 318 captured answers with full deterministic verification, top-percent analysis, and full-coverage digest/hierarchy evidence.

Therefore the accepted runtime-scoped fact is:

```text
CAPABILITY_ISOLATION_AVAILABLE[deepseek-api-tool-less] = YES
```

This does not imply that arbitrary OpenAI-compatible providers are qualified.

## 5. Local vs cloud is a policy choice, not a product fork

V0.3 effectively validated two execution locations:

```text
Trusted Controller
├── local runtime
└── remote cloud runtime
```

They are additive execution options, not separate products.

### Local runtime strengths

- corpus can remain local;
- no per-request provider fee;
- offline/local-only operation is possible when the reviewed runtime supports it;
- useful where privacy or data-egress requirements demand locality.

### Local runtime costs/risks

- model quality may be lower for a constrained hardware budget;
- inference behavior can be sensitive to model/runtime profile;
- local runtime installation, model loading, and qualification add operational complexity.

### Cloud runtime strengths

- stronger model quality can reduce model-specific workaround pressure;
- operational setup can be simpler once credential handling is established;
- provider usage can be measured directly for real cost/latency evidence.

### Cloud runtime costs/risks

- approved projection data leaves the machine;
- credentials and provider availability become dependencies;
- usage has monetary cost and provider-specific rate/error behavior.

V0.3 approval to transmit public Zhihu dogfood projections to DeepSeek must not be generalized into permission to transmit private or sensitive corpora. Private/sensitive-data policy requires its own explicit authority.

## 6. Runtime-selection engineering rule

For future product validation, default to a sufficiently capable runtime first unless an approved constraint requires otherwise.

Recommended decision order:

1. choose a runtime capable enough to validate the actual product behavior;
2. measure quality, latency, token usage, reliability, and cost on real workloads;
3. optimize, localize, or introduce routing only against measured or explicitly approved constraints.

Local inference should become a blocking requirement only when justified by a real constraint such as:

- privacy / data-egress requirements;
- offline operation;
- measured API cost;
- measured latency;
- availability / reliability requirements;
- deployment constraints explicitly approved by the product owner.

This yields the durable rule:

```text
Strong/capable-runtime first for product validation.
Local optimization follows measured or approved constraints.
```

This is not a mandate to always use cloud models, nor a statement that DeepSeek is universally preferred. It is a sequencing rule intended to prevent premature optimization around a weaker runtime before the product workflow itself has been validated.

## 7. What V0.3 taught us

The durable lessons are:

1. **Controller should own truth; model should own semantics.**
2. **Capability isolation and model quality are separate axes.**
3. **Runtime is replaceable infrastructure, not product identity.**
4. **Do not make a weaker/local runtime a product-validation blocker without a measured or approved reason.**
5. **Measure real cost before optimizing for cost.**
6. **Qualification evidence is runtime/profile-scoped; never generalize one provider/model result to another.**
7. **Historical experiments must not be promoted into current product facts.**

## 8. Evidence / authority boundaries

Use the repository layers consistently:

- Applicable Approved Specs: product requirements and amendments;
- `docs/product-behavior-contract.md`: current approved product behavior;
- this architecture record: cross-cutting design rationale and durable engineering strategy;
- `docs/project-memory.md`: concise accepted long-lived project facts/lessons;
- qualification/dogfood evidence: provider/model/profile-specific measurements and observed limitations;
- Tracker / Issues / Git history: execution state and exact reviewed/merged identity.

Do not copy transient runtime parameters into higher-authority documents merely because they were useful in one qualification run.

## 9. V0.3 closeout boundary

V0.3 execution is complete. This record normalizes lessons from completed work only.

It does not authorize:

- V0.4 work;
- automatic model routing;
- arbitrary provider support;
- private-corpus cloud egress;
- new retry/fallback semantics;
- replacing deterministic verification with model judgment.
