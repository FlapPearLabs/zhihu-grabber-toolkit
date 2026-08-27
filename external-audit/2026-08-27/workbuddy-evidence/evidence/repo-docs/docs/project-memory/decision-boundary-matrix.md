# Decision-Boundary Matrix — Durable Engineering Memory

> Status: DURABLE ENGINEERING MEMORY
> Scope: rule-based classification, content cleaning, routing, filtering, and other transformations where false positives / false negatives have asymmetric cost.
> This file records a reusable engineering technique, not current runtime state or a product-version contract.

## 1. Problem class

When a system uses regexes or deterministic heuristics to decide whether content should be classified, removed, transformed, or routed, local fixes can enter a **regex whack-a-mole** loop:

- rule too broad → false positives / collateral damage;
- rule too narrow → false negatives / missed cases;
- patch one example → create another edge case;
- reviewers discover examples one by one → repeated repair/re-review cycles and high execution cost.

The durable lesson is: **do not design the rule from the latest failing example. Design the decision boundary first.**

## 2. Positive / Negative / Adversarial matrix

Before implementing or materially changing a heuristic classifier, build an executable decision-boundary matrix.

Each row should contain at least:

```text
CASE_ID
INPUT
EXPECTED_CLASS
DIMENSION
WHY_THIS_CASE_MATTERS
ERROR_COST_IF_WRONG
```

Use three sets:

1. **Positive cases** — inputs that MUST match / trigger the behavior.
2. **Negative cases** — inputs that MUST NOT match / trigger it.
3. **Adversarial twins** — minimally different pairs where one should match and the other should not.

Example pattern:

```text
P01  "只看前20%的回答"       → SAMPLED   explicit corpus subset
N01  "我要20%的年化收益"      → FULL      percentage is research subject
P02  "给我一个采样视图"       → SAMPLED   explicit subset-view request
N02  "给我讲讲采样定理"       → FULL      sampling is topic, not routing intent
```

The matrix is the contract. A new rule is acceptable only when the **whole matrix** still passes.

## 3. Design dimensions

Do not generate cases by paraphrase alone. Vary the dimensions that commonly move a decision across the boundary:

- semantic object: answer / opinion / corpus vs metric / stock / employee / signal / data;
- lexical collision: keyword used as a subject instead of an instruction;
- compound nouns: `回答` vs `回答率`, `样本` vs `样本量`;
- action vs methodology question: "do X" vs "how should X be done";
- feasibility suffixes: `可以吗 / 是否可行 / 有没有必要 / 怎么做`;
- punctuation and clause boundaries: comma, question mark, semicolon, multi-clause input;
- long-distance dependencies: key terms separated by long phrases;
- percentage / number placement;
- Chinese / English variants where the product accepts both;
- substring and token-boundary collisions;
- explicit CLI/options vs inferred natural-language intent.

For destructive content cleaning, also vary:

- line boundaries and whitespace;
- nested markup / formatting;
- legitimate content containing the cleanup marker;
- malformed-but-user-owned content;
- repeated or adjacent markers.

## 4. Conservative default follows error cost

Choose the default from the asymmetric cost of mistakes.

Examples:

- destructive cleanup: deleting valid user content is usually worse than leaving some junk → **uncertain → keep**;
- Research Orchestration routing: silently sampling when the user expected full coverage changes research semantics, while doing full coverage when sampling might have sufficed mainly costs time/compute → **uncertain → FULL-COVERAGE**.

This is a fail-safe / conservative classifier policy, not an implementation accident.

## 5. Regression protocol

Whenever a new misclassification is discovered:

```text
observe failure
→ classify the root decision-boundary dimension
→ add the failing case (and preferably its adversarial twin) to the matrix FIRST
→ repair the general rule
→ run the entire matrix
→ run affected integration/regression tests
→ only then accept the repair
```

Never fix a production rule with a one-off exception that is not represented by a durable regression case.

A historical bug is not considered closed until its row is permanently executable.

## 6. Stop adding regex guards when the problem becomes semantic

Regex is well suited to stable surface form:

- IDs;
- dates;
- fixed markers;
- explicit CLI syntax;
- strongly framed phrases.

Regex is a poor long-term owner of open-ended semantic distinctions such as:

> Is `采样` the subject being researched, or an instruction to sample the corpus?

Escalation rule:

```text
explicit option / exact syntax
→ high-precision deterministic rule
→ structured parser / classifier when semantics dominate
→ conservative default when still uncertain
```

Warning signs that escalation is needed:

- repeated reviewer cycles add only new regex guards;
- negative lookaheads and distance windows dominate the implementation;
- punctuation or word-order variants repeatedly bypass rules;
- fixing one false positive creates another false negative;
- the matrix grows faster than the semantic model becomes clearer.

## 7. Review-budget rule

Before launching repeated independent review on a heuristic classifier:

1. build the first adversarial matrix centrally;
2. include known positive, negative, lexical-collision, punctuation, long-distance, and methodology/feasibility cases;
3. implement against that matrix;
4. ask reviewers to identify **missing dimensions**, not merely isolated sentences;
5. when a reviewer finds a new dimension, expand the matrix by category before the next repair.

This reduces reviewer-driven whack-a-mole and prevents a small semantic classifier from consuming disproportionate implementation/review budget.

## 8. Research Orchestration application

For `FULL-COVERAGE` vs `SAMPLED` routing, the durable policy is:

```text
explicit subset intent → SAMPLED
explicit CLI sampled option → SAMPLED
generic research intent → FULL-COVERAGE
ambiguous / uncertain intent → FULL-COVERAGE
```

`SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST` remains a product invariant; this memory explains the engineering method used to protect that boundary and does not replace the Approved Spec.

## 9. Generalization

The same technique applies to:

- DOCX/HTML/Markdown cleanup;
- content sanitization;
- data deduplication / claim clustering;
- routing intents;
- allow/deny filters;
- import normalization;
- extraction heuristics;
- migration transforms.

Core principle:

> **Define and test the decision boundary before optimizing the rule. New failures become permanent matrix rows, not temporary regex patches.**
