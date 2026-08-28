# P1 Decision-Grade Evidence Gate 01 — ChatGPT Formal Review

## Verdict

```text
FORMAL_REVIEW = CHANGES_REQUESTED_NARROW
D2.1_EVALUATOR_CORRECTION = PASS_ON_SUBMITTED_EVIDENCE
FOUR_STRATEGY_RACE = PASS_AS_EXPERIMENTAL_EVIDENCE
SECOND_ADJUDICATION = COMPLETED_WITH_BLINDING_DISCLOSURE
PROVISIONAL_GOLD = REVISED
ARCHITECTURE_DIRECTION = PROCEED_WITH_SIMPLIFICATION_SUPPORTED_BUT_NOT_YET_FROZEN
SPEC_PREPARATION_GATE = NOT_READY
IMPLEMENTATION_AUTHORIZATION = NONE
```

## Second adjudication summary

Actual packet inventory:

- must_see: 22
- must_see_candidate: 10
- contradiction_stance: 11
- cross_question_aspect: 4
- total: 47

Decisions:

- YES: 27
- NO: 20

Applying the adjudication to must-see semantics yields **13** YES sources across the original must-see and candidate sets, instead of the provisional 22 must-see sources.

### Sensitivity-critical labels

- `52215270:2297169997` → **NO**
- `52215270:3312209969` → **NO**
- `616791818:105981792797` → **YES**

The submitted sensitivity analysis says removal of either of the first two labels changes the B3-vs-B2 relative ordering. Therefore the provisional B3 must-see advantage cannot be retained after this adjudication without a mechanical rescore.

## Material findings

### 1. D2.1 correction is directionally correct

The submitted gate repairs the previously confirmed question-provenance defect by using explicit scope and complete `question_ids[]`, adds order-invariance tests, and reports that D2→D2.1 changes per-question/minority metrics rather than aspect recall. This is the correct conceptual repair.

### 2. The experiment now supports simplification more strongly than the provisional report did

Before second adjudication, the medical-case must-see ordering favored B3 over B2 at K_MEDIUM by one source. Two of the three sensitivity-critical provisional must-see labels are rejected here. The existing selection outputs must now be rescored against the adjudicated Gold before any final architecture statement.

### 3. Provisional `must_see` semantics were over-inclusive

The Gold proposed 22 `must_see` sources while the judgment question asks whether a source must occupy one of 15 slots. That is internally awkward if interpreted literally. The second adjudication reduces the combined must-see/candidate YES set to 13, making the label semantics coherent with the 15-item budget.

### 4. Phase-C packet documentation has an inventory mismatch

The machine JSON actually contains **22 + 10 + 11 + 4 = 47** labels. The Markdown inventory says 15 contradiction labels and up to 12 aspect labels. The JSON should be treated as the actual adjudication input, but the packet/report must be corrected before archival freeze.

### 5. The preregistered Outcome-A rule is not fully mechanical

`B2 ~= or > B3` does not define an equivalence margin or aggregation rule across the five primary metric families. `PROCEED_WITH_SIMPLIFICATION` is therefore an evidence-backed engineering judgment, not a mechanically preregistered winner.

### 6. Do not freeze B2 exactly as implemented

B0 popularity is consistently strong, while B2 is the only fair strategy that reliably improves minority-question preservation. The strongest architecture implication is therefore **not** “ship B2 unchanged”; it is a simpler hybrid hypothesis:

```text
question/source-group preservation
+ popularity anchor
+ dense semantic relevance/novelty
+ optional lightweight redundancy control
```

The evidence does not justify six hard selector lanes.

### 7. Dense embedding remains useful even though dense Top-K is weak

The race only shows that pure dense Top-K is not a strong final selector. It does not refute dense embeddings for novelty, redundancy, clustering, or within-question retrieval.

### 8. Strict blinding was partially compromised

The companion review packet disclosed three sensitivity-critical IDs before this adjudication. No unblinding key was available, and all 47 items were judged under a single rubric, but this result should not be called perfectly blind.

### 9. Remote code review is not yet independently reproducible from GitHub

The submitted branch name `dg01-decision-grade-gate` was not visible through the connected GitHub branch search during this review. Therefore implementation claims (41/41, validators, exact source code) are accepted only as submitted evidence here, not independently re-executed by this reviewer.

## Required narrow correction

Do **not** run a new selector experiment.

1. Mechanically apply `CHATGPT_SECOND_ADJUDICATION_GATE01_V1.json` to the new-case Gold.
2. Use the withheld unblinding key only after applying judgments.
3. Rebuild affected value units / primary metrics and rescore the **existing frozen selections**. Do not rerun or retune selectors.
4. Produce exact before/after B0/B1/B2/B3 tables.
5. Correct the 47-label inventory documentation.
6. Explicitly report whether the adjudicated Gold changes Outcome A/B/C/D.
7. Push the evidence-gate branch (or publish an immutable commit) so the implementation can receive an independent code-level readback.
8. Keep `SPEC_PREPARATION_GATE = NOT_READY` until that rescore is reviewed.

## Expected architectural interpretation if the mechanical rescore confirms the sensitivity analysis

If B2 remains approximately competitive with or better than B3 on coverage after the adjudicated Gold is applied, while remaining materially simpler/cheaper, the evidence supports:

```text
PROCEED_WITH_SIMPLIFICATION
```

This should retire **hard six-lane selector constraints** from the first architecture baseline, while retaining the underlying information signals at appropriate stages (retrieval, soft scoring, diagnostics, query expansion).

It still does **not** authorize production implementation.
