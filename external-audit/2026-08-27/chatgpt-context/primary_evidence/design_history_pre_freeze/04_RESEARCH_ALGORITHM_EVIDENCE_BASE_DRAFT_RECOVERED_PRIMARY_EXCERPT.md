# Recovered primary excerpt — 04_RESEARCH_ALGORITHM_EVIDENCE_BASE.md

PROVENANCE_CLASS: RECOVERED_PRIMARY_EXCERPT  
ORIGINAL_STATUS: FROZEN_DRAFT / RESEARCH EVIDENCE / CANDIDATE REGISTRY  
CURRENT_AUTHORITY: NO  
IMPLEMENTATION_AUTHORIZATION: NONE

The original file explicitly stated:

> A paper appearing here does not authorize production use. Every algorithm must pass a unified benchmark.

## Candidate registry highlights

### CQA Learning-to-Rank

Role: content-level feature model / baseline.  
It was not considered sufficient to solve research-corpus subset selection alone.

### Expert Finding / TUEF

Borrowed topic-conditioned expertise and content+social/user signals.  
Matrix factorization remained a future candidate and was explicitly `DO_NOT_IMPLEMENT`.

### RRF

Role: first-stage deterministic fusion for rankings whose scores are not directly comparable.  
Status: strong baseline candidate.

### MMR

Role: simple relevance-minus-redundancy diversification baseline.

### xQuAD

Role: aspect-aware diversification candidate.

### Submodular Optimization

The draft said:

```text
ROLE = primary Research Coverage Engine candidate
STATUS = HIGH PRIORITY BENCHMARK
```

Borrowed ideas:

- coverage;
- representativeness;
- diversity;
- diminishing returns;
- greedy approximation.

### DPP

Role: diversity subset-selection candidate.  
Status: benchmark against MMR/Submodular.

### Active Learning

Role: exploration-budget theory using uncertainty, representativeness, diversity and coreset ideas.

### Generative Query Expansion

Role: Research Planner — infrequent semantic planning followed by deterministic retrieval where possible.

### Chao unseen-species estimator

Role: saturation diagnostic only.  
The draft explicitly prohibited claiming it measured true Zhihu retrieval recall.

### Stopping rules

Recall-aware / confidence-based stopping was marked high priority as a first-generation reference.

### InfoGain-RAG / Stop-RAG / Search-R1 / Deep Research Agents

These were retained as method references or future learned/offline signals, with explicit warnings against prematurely placing expensive per-document LLM scoring or RL retrieval/stopping in the online path.

### Temporal references

The registry also included changepoint analysis and statistically significant semantic-shift detection with permutation/FDR ideas for monitoring.

## Historical experiment ladder

```text
Baseline 0: Popularity Top-K
Baseline 1: Semantic Top-K
Baseline 2: MMR
Candidate: xQuAD
Candidate: Submodular Facility Location
Candidate: DPP
Candidate: Submodular + Constraints
```

## Explicitly deferred

- matrix factorization;
- Search-R1 training;
- Stop-RAG / RL stopping;
- persistent homology / topological data analysis.

## Why this historical excerpt matters

The current final algorithm authority is substantially narrower. This excerpt is direct evidence that the design process genuinely explored a more sophisticated architecture before contracting to a cheaper baseline.
