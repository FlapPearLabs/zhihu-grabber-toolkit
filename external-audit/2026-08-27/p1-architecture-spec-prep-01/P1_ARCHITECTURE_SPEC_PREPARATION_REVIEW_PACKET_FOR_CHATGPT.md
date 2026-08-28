# P1 Architecture Spec Draft 01 Repair R1 — Review Packet for ChatGPT

```text
DOCUMENT_ID = P1_ARCHITECTURE_SPEC_PREPARATION_REVIEW_PACKET_FOR_CHATGPT
TASK_ID = P1_ARCHITECTURE_SPEC_DRAFT_01_REPAIR_R1
BRANCH = spec/p1-architecture-spec-prep-01
ARCHITECTURE_BASE_SHA = 196db3d9775e33ff8cd6bf4e218ba4313630a923
BASE_REVIEWED_HEAD = 82ec5981b2403a3b8c2c6b966991d49767584eba
REVIEW_STATUS = REVIEW_PENDING
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
```

本 packet 交接对 `P1_CROSS_QUESTION_RESEARCH_ARCHITECTURE_SPEC_DRAFT_01.md` 的 Repair R1。审查对象只有同目录两个 Markdown；无 production implementation、无新 experiment / Gold / benchmark、无 P2/P3 implementation、无 ticket decomposition、无 Approved Spec promotion。

---

## A. Review Request

请对 Repair R1 做正式 architecture / contract review，重点判断：

1. Applicable Approved `research-orchestration-scope.md` 是否完整继承；
2. single-question selection 行为与 P1 multi-group scope amendment 是否同时成立；
3. candidate pool → selected corpus → 100% analysis 与 explicit sampled analysis 是否无混淆；
4. ZhihuDataProvider / SemanticRuntime / EmbeddingProvider 是否真正解耦；
5. multi-group execution/state/handoff/resume 是否足以纠正旧“循环 K 次即可”的过度复用主张；
6. logical Question/Source-group hierarchy 是否独立于 existing physical chunk/node hierarchy；
7. preservation、planner identity、coverage、security、failure semantics 与 OPEN decisions 是否符合 authority；
8. promotion workflow 是否避免把 external-audit ancestry 合并进 production master。

期望输出：

```text
REVIEW_VERDICT: PASS | CHANGES_REQUESTED
REVIEWED_HEAD: <exact remote branch SHA>
FINDINGS: <P0/P1/P2, with section locations>
POST_GATE_MEMORY_UPDATE_REQUIRED: YES | NO
```

---

## B. Authority Reconciliation

本轮完整纳入并对照：

- `RULES.md`
- `AGENTS.md`
- `docs/project-memory.md`
- `docs/specs/v2-rich-content-fidelity.md`
- `docs/specs/v0.3-product-scope.md`
- `docs/specs/research-orchestration-scope.md`（Applicable Approved Spec；旧 Draft 漏项）
- `docs/product-behavior-contract.md`
- `docs/architecture/runtime-strategy.md`
- authority sources `00/01/02/03/04/07/09`
- discovery evidence `05/08`（evidence-only，不提升为 contract）
- current production seams in `research-orchestration`、`zhihu-answer-grabber`、`corpus-anthology`

关键 precedence：

```text
RULES / AGENTS hard invariants
→ Applicable Approved Specs
→ product-behavior current view / accepted runtime record
→ frozen design 00/01/02/03/04/07/09
→ evidence-only 05/08
→ history 06
```

09 只在 selector/lane scope 覆盖 02/04；不能覆盖 Approved Research Orchestration 的 runtime、selection、full-coverage 与 failure contracts。

---

## C. P0-1 Resolution — Restore Approved Authority Chain

### C1. Candidate selection inheritance + P1 amendment

Repair R1 不再写“selectCandidate unchanged”。Draft §7 现在明确：

- inherited：clear best → auto；material ambiguity → at most one clarification；no valid → fail；
- amended scope：selection output 从单 `selectedQuestionId` 变为 `SelectedSourceGroups[]`；clear best 可以是最佳 multi-group set；material ambiguity 指 group sets 会改变 normalized research intent。

exact set algorithm / floor / quotas 保持 OPEN，不伪装为已有实现。

### C2. Full vs sampled

Draft §1 明确区分：

```text
Candidate / Retrieval Pool
→ RCE-selected Verified Research Corpus
→ 100% Analysis Coverage of selected corpus
```

与：

```text
explicit user-requested sampled analysis
→ top-percent-analysis / popular-sample
→ distinct mode + disclosure
```

`top-percent-analysis` 不再作为普通 P1 scale-control；runtime/cost/corpus size 均不得触发 silent sampled downgrade。

### C3. Runtime policy split

旧 D-2 已拆为：

| Seam | Status in Repair R1 |
|---|---|
| `SEMANTIC_RUNTIME_POLICY` | CURRENT APPROVED：public Zhihu 默认 `deepseek-api-tool-less`；NO_SILENT_RUNTIME_FALLBACK |
| `EMBEDDING_PROVIDER` | OPEN；provider/model/egress/qualification 未冻结 |
| `ZHIHU_DATA_PROVIDER` | OPEN / DISCOVERY_REQUIRED；Official Search 是 first known adapter，不是 architecture |

### C4. Failure semantics

Draft §10 恢复 Approved default：

```text
FAIL_CLOSED
NO_SEMANTIC_DOWNGRADE
DENSE_CAPABILITY_UNAVAILABLE → FAIL_CLOSED
```

`popularity-anchor-only` 不再是已合法 peer option。未来 degraded mode 需要 `REQUIRES_EXPLICIT_SPEC_AUTHORITY + DISTINCT_MODE_IDENTITY + disclosure/acceptance contract`。

---

## D. P0-2 Resolution — Real Zhihu Data Provider Seam

Draft §5 把三种能力彻底分开：

1. `ZhihuDataProvider / CapabilityProvider`：知乎 retrieval/capture capability、auth class、candidate/group identity、provenance、source URL、retrievedAt、pagination/completeness、machine-readable failure；
2. `SemanticRuntime`：Planner / claim / synthesis semantic generation；
3. `EmbeddingProvider`：dense vector generation + identity/cache/egress/failure contract。

Data Provider hard rules：

```text
NO_SILENT_PROVIDER_FALLBACK
UNKNOWN_PROVIDER_CONTRACT != PASS
```

本轮没有冻结 exact endpoint、OAuth scope、CLI command、Session/Web pagination。RRF 只融合 query/provider retrieval rankings，不再把 model runtime 混进 provider channel identity。

---

## E. P0-3 Resolution — Multi-group Execution / Handoff / Hierarchy

### E1. Corrected current seam

Draft §2 明确当前 production 是 single-question：single selectedQuestion、single stage artifact/hash、single handoff、single `answers.json` analysis。删除“stage/state/resume 零改动”主张。

### E2. Additive execution contract

Draft §6 新增概念结构：

```text
SelectedSourceGroups[]
PerGroupExecutionState
VerifiedGroupRefs[]
ResearchCorpusManifest (derived composition)
```

并冻结：

- per-group capture / verify / checkpoint；
- `captured != verified` per group；
- partial completion resume；
- stale group invalidation + unaffected sibling reuse；
- downstream planHash/group-composition dependency invalidation；
- credentials excluded from state；
- research manifest 不成为第二 canonical truth；
- partial run 不得渲染为 research complete；
- exact filename/schema delegated。

### E3. Corrected hierarchy claim

Draft §2/§8 现在区分：

```text
existing hierarchy = reusable physical chunk/node aggregation infrastructure
P1 requirement = explicit logical Question/Source-group representation layer
```

目标层级真实存在：

```text
Content
→ Question / Source-group
→ Claim / Aspect
→ Cross-source synthesis
```

---

## F. P1 Resolutions

### F1. Preservation semantics

删除“整组不可分割 selector atom”。当前合同只冻结 group identity/provenance、anti-starvation、per-group selection/coverage measurability；组内 exact floor/count/quota 仍 OPEN。P1 corpus construction 不偷用 top-percent sampled identity。

### F2. Planner + identity

Planner 概念输出扩展为 query variants、aspects、entities、opposing framings、terminology variants、source-group intent/constraints。Plan 必须 persisted / validated / hashed；controller owns plan artifact identity。

```text
run identity = normalized user request + stable configuration identity
plan artifact identity = planHash
planHash change → invalidate downstream from PLAN/RETRIEVAL
```

### F3. EmbeddingProvider

EmbeddingProvider 不再绑定 `map.mjs` runtime routing。最小 contract 已含 provider/model identity、embedding version、normalization version、cache/reuse、vector validation、failure identity、egress/security policy；production provider/model 保持 OPEN。

### F4. Coverage / saturation

Draft §9 定义 Retrieval Coverage、Source Completeness、Analysis Coverage，并保留：

```text
new_aspect_rate
new_claim_rate
new_expert_rate
new_contradiction_rate
novelty_gain
```

以及 group concentration/representation diagnostics。threshold / budgets / minimum rounds：`DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION`。

### F5. Security typing

Draft §10 区分：

- `USER_REQUEST` → normal length/encoding/schema/identity validation；
- `MODEL_GENERATED_PLAN` → structured-output validation / controller hash；
- `EXTERNAL_CORPUS` → UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION / projection sanitization / isolated worker。

不再把用户研究主题机械当 external corpus 套 `sanitizeProjectionText`。

### F6. Terminology

全篇统一：

```text
P1 = Cross-Question Deep Research
P2 = Author / Personal Intelligence
P3 = Continuous Intelligence
Temporal Intelligence = shared engine/design for P2/P3
```

---

## G. OPEN_DECISIONS Before / After

| Topic | Before | Repair R1 |
|---|---|---|
| production embedding model/provider | D-1 OPEN | D-1 OPEN，且 contract expanded |
| all runtime/provider priority | D-2 OPEN（混合） | split：semantic policy RESOLVED；data routing D-2 OPEN；embedding D-1/D-7 OPEN |
| planner schema | D-3 OPEN，概念仅 queries/aspects | D-3 OPEN exact schema；六类概念输出已冻结 |
| selector params | D-4 OPEN | D-4 OPEN |
| question floor | D-5 OPEN | D-5 OPEN，扩为 group floor/count/quota/anti-starvation boundary |
| saturation | D-6 OPEN | D-6 OPEN，明确 thresholds/min rounds/budgets require validation |
| dense unavailable | D-7 fail-closed vs degraded OPEN | **RESOLVED default = FAIL_CLOSED**；future degraded requires explicit Spec + distinct identity |
| global quality score | D-8 OPEN | D-8 OPEN，minimum-correct default none |
| OAuth/credential behavior | D-9 OPEN | D-9 OPEN / DISCOVERY_REQUIRED；按 provider-specific boundary |
| embedding cache/egress profile | implicit/missing | D-7 OPEN；architecture contract defined, values not frozen |

---

## H. Evidence Caveats Preserved

仍明确保留：two-case scope、partial blinding contamination、relative ops 非生产成本、B3 medical/K24 优势、Dense Top-K caveat、six dimensions relocated-not-deleted、P2/P3 design-only。

未重新打开：four-component direction、six-dimension relocation、MMR optional status、RRF、dense direction、large KG、xQuAD/DPP/Submodular、P2/P3 implementation、新 experiment / Gold。

---

## I. Promotion Workflow — Mandatory After PASS

当前 branch 具有 evidence / external-audit ancestry。即使本 Draft 获得 PASS，也**禁止直接把当前 branch merge 到 master**，否则会把 external-audit evidence tree 意外带入 production history。

若 product owner 在 PASS 后另行决定 Approved Spec promotion，唯一合法流程：

```text
latest remote master
→ create clean spec-promotion branch
→ copy only approved spec / authority artifacts
→ independent CONTRACT_REVIEWER + CONSISTENCY_REVIEWER
→ both PASS on the same exact SHA
→ re-fetch and verify no master drift
→ ff-only merge
→ remote verify
```

禁止：直接 merge 本 audit-ancestry branch、复制整个 `external-audit/` tree、把 evidence-only 05/08 提升为 contract、在 review 后 amend/rebase/force-push。

---

## J. Scope / Verification

Expected changed files from `BASE_REVIEWED_HEAD`：exactly 2：

```text
external-audit/2026-08-27/p1-architecture-spec-prep-01/
  P1_CROSS_QUESTION_RESEARCH_ARCHITECTURE_SPEC_DRAFT_01.md
  P1_ARCHITECTURE_SPEC_PREPARATION_REVIEW_PACKET_FOR_CHATGPT.md
```

Reviewer verification：

```bash
git ls-remote origin refs/heads/spec/p1-architecture-spec-prep-01
git diff --name-only 82ec5981b2403a3b8c2c6b966991d49767584eba...origin/spec/p1-architecture-spec-prep-01
git diff --check 82ec5981b2403a3b8c2c6b966991d49767584eba...origin/spec/p1-architecture-spec-prep-01
```

Final state：

```text
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
P1_ARCHITECTURE_SPEC_DRAFT_01 = REVIEW_PENDING
```
