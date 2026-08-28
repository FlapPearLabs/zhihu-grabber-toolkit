# RCE_DESIGN_AMENDMENT_01_AUTHORITY_CLOSURE_REVIEW_PACKET_FOR_CHATGPT

## A. Remote Branch

```text
REMOTE_BRANCH: dg01-decision-grade-gate
```

## B. Base SHA

```text
BASE_SHA: c3f5e9c26e1a330f63fbbd85ede9a96a2db824b0 (audit snapshot)
```

## C. Authority-Fix Content Commit

```text
AUTHORITY_FIX_CONTENT_COMMIT: c6955c61fa837541029c5106f1462ef4d4577eaa
```

## D. Actual Remote Tip

```text
REMOTE_TIP_AT_REPORT_TIME: 8890572ed5beafffca4aa38512afa6089a16eaa3
```

（ls-remote verified: 8890572ed5beafffca4aa38512afa6089a16eaa3 refs/heads/dg01-decision-grade-gate）

注：CONTENT_COMMIT = c6955c6（authority closure 内容），REPORTING_TIP = 8890572（含 bookkeeping commit）。

---

## E. 00 Authority Hierarchy Changes

### E.1 Source Set Updated

- 9 份 → 10 份
- 新增 `09_RCE_DESIGN_AMENDMENT_01.md` (SCOPED FROZEN DESIGN AMENDMENT)

### E.2 Level 1 Updated

- 5 份 → 6 份
- 09 加入 Level 1，类型：SCOPED FROZEN DESIGN AMENDMENT

### E.3 Precedence Defined

**在以下 scope 内，09 覆盖 02/04 中冲突的 selector/lane 相关表述：**

- RCE selector baseline
- Question / Source-group preservation
- Popularity role
- Dense semantic role
- Redundancy-control role
- Six-lane role relocation

**在 scope 外，02/04 保持原有 Level 1 authority。**

09 不允许覆盖：

- 01 Product Direction
- 03 Temporal Intelligence
- 07 Security / synthesis guardrails
- Provider / Auth
- P2 / P3
- Version assignment
- Implementation authorization

### E.4 Project-State Summary Updated

```text
RESEARCH_COVERAGE_ENGINE = DESIGN_FROZEN_WITH_AMENDMENT
ALGORITHM_DECISIONS = DESIGN_FROZEN_WITH_AMENDMENT
P1_EVIDENCE_GATE = PASS_WITH_CAVEATS
RCE_DESIGN_AMENDMENT_01 = REVIEW_PENDING
```

### E.5 Core Frozen Principles Updated

旧：
```text
MMR
+ multi-lane exploration
```

新：
```text
Question/Source-group Preservation
+ Popularity Anchor
+ Dense Semantic Relevance/Novelty
+ Optional Lightweight Redundancy Control
```

Six information dimensions 保留但不再是 hard selector quotas。

### E.6 Next Allowed Stage Updated

旧：Discovery / Capability Audit + Research Coverage Benchmark Design

新：ARCHITECTURE_SPEC_PREPARATION（保留 NO PRODUCTION IMPLEMENTATION）

---

## F. 02 Contradiction Cleanup

### F.1 Changes Made

1. §2: "多 lane" → "六个 information dimensions" + Note 说明不是 hard quotas
2. §4.2: "V1 使用 MMR" → "Optional lightweight redundancy control (MMR available)" + Note
3. §4.3: "MMR 本质上逐步选择" → "Greedy lightweight redundancy control"
4. §12: "Multi-lane Inclusion" → "Information Dimensions" + 新角色定义
5. §13: "MMR — V1 Main Selector" → "Optional Lightweight Redundancy Control" + 新 baseline 描述
6. §14 xQuAD: "V1 的 MMR + lanes 已能覆盖大量收益" → "当前 simplified baseline 尚未证明需要更复杂 diversification"
7. Risk C: "evidence-rich lane" → "evidence-rich signal"
8. Risk D: "MMR over-diversifies" → "Redundancy control over-diversifies"
9. Baseline 2: "MMR + lanes" → "Question/source-group preservation + popularity anchor + dense semantic relevance/novelty + optional redundancy control"

### F.2 Grep Verification

搜索 MMR/lane/lanes/multi-lane/quota/Main Selector/must preserve → 所有冲突已清理

---

## G. 04 Contradiction Cleanup

### G.1 Changes Made

1. §2 Mathematical Tool Map: "RRF、MMR" → "RRF、optional redundancy control"
2. A06 MMR: "因此必须 MMR + Multi-lane Exploration Constraints" → "Therefore, the first baseline does NOT use MMR as the sole selector" + 新 baseline
3. A06: "MMR is available as an optional redundancy mechanism, but does not define the first selector architecture by itself"
4. xQuAD: "V1 MMR + lanes already gives strong baseline" → "current simplified baseline must first be evaluated in architecture/implementation; advanced diversification only promoted by future evidence"
5. Submodular: "V1 先建立 strong MMR baseline" → "Current simplified baseline must first be evaluated in architecture/implementation; advanced diversification only promoted by future evidence"
6. §5: "V1 Diversity: MMR + lanes" → "V1 Selection / Diversity: Question/source-group preservation + dense novelty + optional redundancy control" + Note
7. §6 Risk table: "long-tail lanes" → "long-tail signal", "mainstream lane" → "popularity anchor", "Lane quota 拍脑袋" → "No hard quotas"

### G.2 Grep Verification

搜索 MMR/lane/lanes/multi-lane/quota/Main Selector/must preserve → 所有冲突已清理

---

## H. 09 Status/Provenance Correction

### H.1 Status Changed

旧：`STATUS: AMENDMENT_APPROVED`

新：`STATUS: REVIEW_PENDING`

### H.2 Authority Provenance Corrected

旧：
```text
authorized_by: P1_DECISION_GRADE_EVIDENCE_GATE_01 (PASS_WITH_CAVEATS)
reviewed_by: ChatGPT (P1_GATE01_CHATGPT_FORMAL_REVIEW_V2)
```

新：
```text
basis: P1_DECISION_GRADE_EVIDENCE_GATE_01 (PASS_WITH_CAVEATS)
review_request: P1_GATE01_CHATGPT_FORMAL_REVIEW_V2 (approved evidence, requested amendment)
review_status: RCE_DESIGN_AMENDMENT_01_CHATGPT_REVIEW_V1 = CHANGES_REQUESTED_NARROW (authority integration fixes)
```

### H.3 Documents Modified Updated

旧：`documents_modified: 02, 04`

新：`documents_modified: 00, 02, 04`

---

## I. Exact Current Selector Authority

```text
Question / Source-group Preservation
+
Popularity Anchor
+
Dense Semantic Relevance / Novelty
+
Optional Lightweight Redundancy Control
```

---

## J. Exact Six-Dimension Roles

```text
Mainstream      → retrieval / soft popularity feature
Expert          → retrieval signal + topic-conditioned soft feature
Evidence-rich   → retrieval signal + soft feature
Fresh           → retrieval/time policy + diagnostic
Long-tail       → soft marginal-value / novelty feature
Contradictory   → opposing-query generation + claim-stage diagnostic
```

---

## K. P1 Gate State

```text
P1_EVIDENCE_GATE = PASS_WITH_CAVEATS
RCE_DESIGN_AMENDMENT_01 = REVIEW_PENDING
```

---

## L. Architecture/Spec Stage State

```text
ARCHITECTURE_SPEC_PREPARATION = NOT_YET_AUTHORIZED (pending ChatGPT Final Acceptance)
TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED
```

---

## M. Files Changed

### Modified

1. `external-audit/2026-08-27/chatgpt-context/authority_sources/00_SOURCE_AUTHORITY_AND_STATUS.md`
2. `external-audit/2026-08-27/chatgpt-context/authority_sources/02_RESEARCH_COVERAGE_ENGINE_FINAL.md`
3. `external-audit/2026-08-27/chatgpt-context/authority_sources/04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL.md`
4. `external-audit/2026-08-27/chatgpt-context/authority_sources/09_RCE_DESIGN_AMENDMENT_01.md`

### Unchanged

- All experiment results (frozen)
- All Gold files (semantic content untouched)
- All selector implementations (not invoked)
- All benchmark artifacts
- P2/P3 documents

---

## N. Grep/Audit for Stale Normative Wording

### 02 Search Results

搜索 MMR/lane/lanes/multi-lane/quota/Main Selector/must preserve → 所有冲突已清理，仅剩历史/注释引用

### 04 Search Results

搜索 MMR/lane/lanes/multi-lane/quota/Main Selector/must preserve → 所有冲突已清理，仅剩历史/注释引用

---

## O. Tests/Validators

```text
Tests: 41/41 pass
D2.1 validator: ALL_VALIDATIONS_PASSED
Race validator: ALL_VALIDATIONS_PASSED
Adjudication input: SECOND_ADJUDICATION_INPUT_VALIDATION = PASS
Rescore validator: ALL_RESCORE_VALIDATIONS_PASSED
```

Environment: Windows 11 + node v22.22.2

---

## P. Confirmation

- [x] No experiment was rerun
- [x] No Gold semantic content was changed
- [x] No selector parameters were adjusted
- [x] No new algorithms were added
- [x] No P2/P3 were modified
- [x] No Architecture Spec was written
- [x] No production implementation was authorized
- [x] Only authority documents were updated for consistency

---

## Q. Expected Next Verdict

If this narrow authority patch is correct:

```text
RCE_DESIGN_AMENDMENT_01 = PASS
P1_EVIDENCE_GATE = CLOSED
NEXT_GATE = ARCHITECTURE_SPEC_PREPARATION
IMPLEMENTATION_AUTHORIZATION = NONE
```