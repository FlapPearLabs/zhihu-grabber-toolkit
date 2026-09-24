# P2 Readiness Review Packet — 审查包说明与复跑指令

> 本文件是 P2 就绪审计的**索引与复跑说明**，不新增产品 authority，不修改任何 Approved Spec / governance 文档。

## 1. 审计基线

```text
AUDIT_BASE_SHA        = 9c60ae56610498f1cf782c0c36bfc9f8c0642051
REMOTE_MASTER（审计时）= 9c60ae56610498f1cf782c0c36bfc9f8c0642051
REMOTE_MASTER_CHANGED = NO
BRANCH                = audit/p2-readiness-audit-01
```

本分支在 `AUDIT_BASE_SHA` 之上**只新增下列文档文件**，不含任何产品代码改动、不含任何既有权威文档修改。

## 2. 待审查产物（repo-relative 路径）

| 文件 | 作用 |
|---|---|
| `docs/planning/P2_ARCHITECTURE_READINESS_AUDIT.md` | HY4 主审计：P1 真实链路、总表、逐 Issue（#107–#112）审计、跨 Issue seam map、ARCHITECTURE_WORK_REQUIRED、实验准备建议 |
| `docs/planning/P2_ARCHITECTURE_READINESS_AUDIT_SUPPLEMENT.md` | Finding 范围补充：grill 技能机械取证、#109 依赖语义校正、评审状态真实性校正、`ARCHITECTURE_DECISION_RECORD` 术语归一 |
| `docs/planning/P2_READINESS_INDEPENDENT_REVIEW_VERDICT.md` | 内部独立 reviewer（职责隔离）的验收结论：PASS_WITH_NONBLOCKING_FINDINGS，六张票全部 AGREE |

**冲突优先级**：凡主审计与补充报告冲突处，**以补充报告为准**（补充报告 §D 的评审状态与 §B 的 #109 语义尤其如此）。

## 3. 六张票 NEXT_GATE（当前结论）

| Issue | NEXT_GATE |
|---|---|
| #107 Research Evaluation Harness | A. READY_FOR_EXPERIMENT |
| #108 Gap-aware Targeted Re-query | C. NEEDS_ARCHITECTURE_DECISION |
| #109 Pre-stop Escape Probe | H. BLOCKED_BY_OTHER_P2（语义限定：WAIT_FOR_108_ARCHITECTURE，**非**技术硬依赖） |
| #110 Adaptive Research Planner | G. DESIGN_ONLY |
| #111 Source Authority & Evidence Quality | A. READY_FOR_EXPERIMENT（严格限定 derived 变体） |
| #112 Retrieval Signal Complementarity Experiment | A. READY_FOR_EXPERIMENT（仅 E0/E1/E1-D） |

## 4. 评审状态（务必按此真实状态签发）

```text
HY4_PRIMARY_AUDIT        = COMPLETE_SELF_AUTHORED（自审不是 PASS；RULES §8/§9）
INTERNAL_FALLBACK_REVIEW = PASS_WITH_NONBLOCKING_FINDINGS（内部 fallback，不等同 Codex gate）
CODEX_FINAL_GATE         = PENDING（待 external Codex fresh review 完成）
```

**不得**在 Codex 真正完成 fresh review 之前写出 `CODEX_FINAL_VERDICT = PASS`。

## 5. 复跑指令（external Codex）

```bash
# 取下方 §6 附录（4 反引号围栏之间）的 prompt 原文作为 PROMPT 参数
codex exec -s read-only -C <本分支的本地检出> --skip-git-repo-check "<§6 prompt 原文>"
```

§6 即该 prompt 原文（已脱敏、已含追加核验项），整段复制即可使用。

## 6. Codex review prompt 原文（附录）

````text
You are an INDEPENDENT READ-ONLY READINESS REVIEWER (Codex). You have NOT seen the conversation that produced the audit. You must fresh-read everything and judge only what you can evidence yourself.

## Target repository snapshot (DO NOT MODIFY)
- Git worktree, detached HEAD at the exact reviewed SHA:
  AUDIT_WORKTREE（本机 detached 工作树 @ 9c60ae5，non-authoritative）
- REVIEWED_SHA must be verified by you: run `git -C <that path> rev-parse HEAD`. Expected: 9c60ae56610498f1cf782c0c36bfc9f8c0642051
- Also run `git ls-remote https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git refs/heads/master` and report whether remote master changed since the audit (report REMOTE_MASTER_AT_END).

## Artifacts to review
- The audit you are reviewing: docs/planning/P2_ARCHITECTURE_READINESS_AUDIT.md
- Verbatim exports of the six target Issues (#107-#112): docs/planning/issue-107.txt ... issue-112.txt
  (These were exported from GitHub with `gh api`. You may cross-check with `gh issue view <n> --repo FlapPearLabs/zhihu-grabber-toolkit` if the CLI is available, but the local exports are sufficient and authoritative for this review.)

## Background you need (do not assume anything not evidenced in the repo/files)
This repository completed a phase called P1 (cross-question deep research). Six new OPEN Issues #107-#112 form the P2 adaptive-research-intelligence backlog. The audited question was: for each Issue, what is the single NEXT_GATE, classified as one of:
A READY_FOR_EXPERIMENT / B READY_FOR_SPEC / C NEEDS_ARCHITECTURE_DECISION / D NEEDS_ADR / E NEEDS_SEAM_MAP / F NEEDS_DISCOVERY_EVIDENCE / G DESIGN_ONLY / H BLOCKED_BY_OTHER_P2.
The audit classified: #107=A, #108=C, #109=H (blocked by #108), #110=G, #111=A (derived-only variant), #112=A.

## Hard constraints on you
- READ-ONLY with respect to the repository worktree. Never create/modify/delete anything inside it, never create branches/commits/PRs/issues, never run npm install or test suites that write into it.
- You MAY write exactly one file: docs/planning/CODEX_FINAL_VERDICT.md
- Do NOT trust the audit's claims merely because they are stated. Spot-check the load-bearing ones against actual code/docs. If you cannot verify a claim, mark it UNVERIFIED (never PASS).
- Be adversarial but proportionate. Do NOT invent new architecture, do NOT propose implementations, do NOT build ADRs/specs. Your job is to decide whether the audit's NEXT_GATE assignments are evidenced and whether anything material was missed.

## Required checks
1. MISSED SEAM / ADR / OWNER / PRODUCTION CALLER — for #107-#112, did the audit miss a boundary, owner, or production caller that must be settled first? Especially: is there any existing seam or authority in the repo that changes a verdict?
2. OVER-ENGINEERING — did the audit itself over-engineer (demand artifacts that are not justified), or under-engineer (let a proposal into "experiment" that actually mutates production)?
3. WRONGFUL PROMOTION — was #110 pushed beyond DESIGN_ONLY, or #112 pushed beyond E0/E1/E1-D off-path minimal causal experiment? Verify #112's claim PRODUCTION_MUTATION=NONE is actually achievable given the code.
4. GRILL-AS-ARCHITECT — flag any place where the audit substituted its own architectural design for evidence-based classification.
5. EVIDENCE PER NEXT_GATE — each NEXT_GATE must be supportable by cited evidence in the audit or by code/docs you checked yourself.

## Load-bearing claims worth spot-checking (verify or refute with file:line evidence)
- The described P1 chain is real (planner -> retrieval rounds -> provider rankings -> RRF -> accumulated candidate pool -> dense geometry -> RCE selector -> per-group claims -> synthesis -> coverage-final -> STOP), and specifically that P1 is NOT pure embedding retrieval.
- `research-orchestration/lib/retrieval-round-controller.mjs` explicitly declares it does NOT implement Issue #53 targeted re-query / #54 escape probe / #55 advanced research loop.
- Every retrieval round re-executes the SAME plan; there is no per-round query override / second query source in code. Check `lib/coverage-final-integration.mjs runRetrievalFeedbackLoop` and `lib/retrieval.mjs runMultiQueryRetrieval`, and how `channels` are built in `lib/p1-runtime-composer.mjs`.
- `planHash` is the identity binding across selection / multi-group resume / coverage state / v0.3 render consumption.
- `ResearchCoverageState` (lib/coverage-state.mjs) is canonical and ownership-pinned (owner tokens; `coverage_unauthorized_owner` / `coverage_illegal_write`).
- A saturation semantics disclaimer already exists in code (search for SATURATION_SEMANTICS_DISCLAIMER) declaring that saturation does NOT imply global completeness.
- No token/cost budget controller exists; only maxRetrievalRounds / maxQueryBudget exist in IMPLEMENTATION_DEFAULTS_RECORD.
- `selectResearchCorpus` in lib/rce-corpus-selector.mjs takes denseSignals as an injected parameter (so an off-path experiment can vary signals without touching production).
- An accumulated cross-round candidate pool artifact exists and is persisted (look for `retrieval-rounds/accumulated-pool.json` or equivalent constant).
- The repository has NO ADR mechanism (no docs/adr), and docs/architecture/key-decisions.md is a narrative decision log rather than an ADR registry. Check whether using the existing key-decisions.md instead of introducing an ADR regime is defensible.
- The repository has NO evaluation/experiment lane and no existing rule for when a design may be "consumed"/promoted (verify against docs/AGENTS.md, docs/RULES.md, docs/project-memory.md, docs/specs/*, docs/planning/P1_SEAM_CONTRACTS_V1.md, docs/product-behavior-contract.md).
- There is a mandatory CI test-suite registration file (research-orchestration/suite-classification.json) so new suites need no new CI infrastructure.

## Output format — write this exact structure to the verdict file
```
REVIEWED_SHA = <exact sha you verified>
REMOTE_MASTER_AT_END = <sha>
AUDIT_TARGET_SHA_MATCH = YES / NO
VERDICT = PASS / PASS_WITH_NONBLOCKING_FINDINGS / CHANGES_REQUESTED
QUORUM_REQUIRED = <Contract+Consistency quorum per repo docs, if applicable>
FINDINGS =
  P0 / P1 / P2 | issue | claim | evidence (file:line or command output you ran) | why not covered by existing authority | smallest sufficient fix | which NEXT_GATE it affects
SPOT_CHECK_RESULTS = (CONFIRMED / REFUTED / UNVERIFIED for each load-bearing claim above; keep terse)
NEXT_GATE_REVIEW =
  #107 audit=<gate> reviewer=<agree|disagree, propose <other>> reason=<evidence>
  #108 ...
  #109 ...
  #110 ...
  #111 ...
  #112 ...
OVERENGINEERING_CHECK = <verdict + specifics>
 wrongful_promotion_110 = NO / YES(evidence)
 wrongful_promotion_112 = NO / YES(evidence)
GRILL_AS_ARCHITECT = NO / YES(evidence)
POST_GATE_MEMORY_UPDATE_REQUIRED = YES / NO (this reviewer does not edit the repo)
```
Keep the file under 900 words. Write no other files. Then reply with a one-paragraph summary.

## 追加核验项（补充报告新增，务必逐条核）

1. **G-A1 动态查询 vs 产物安全信任集**：`research-orchestration/lib/rrf.mjs:642-651`（`trustedPlanStrings` 只信任 `validated.plan.queryVariants`，明示 NOT a general caller-defined trust bypass）与 `research-orchestration/lib/retrieval.mjs:759-762`。
2. **G-A2 saturation 分母**：`research-orchestration/lib/retrieval-round-controller.mjs:305-306`（`cumulativeAttemptsCount >= totalPlannedRoutes`）与 `:242`、`:288`（预算跨轮累计 vs `maxQueryBudget=10`）。
3. **G-A3 已计划但未执行的查询字段**：`research-orchestration/lib/retrieval.mjs:547`（只执行 `queryVariants`）对 `research-orchestration/lib/plan-contract.mjs:85-94`（plan 另含 `entities` / `opposingFramings` / `terminologyVariants` / `aspects`）。
4. **G-A4 作者身份载体**：`research-orchestration/lib/rce-provenance-adapter.mjs:246-288`（`authorRef` 确定性派生、缺失披露 null、模型永不创建）与 `research-orchestration/lib/cross-group-aggregation.mjs:83-87,121`。
5. **#109 依赖语义**：判断 `TECHNICALLY_HARD_BLOCKED_BY_108 = NO`、`ARCHITECTURALLY_PREFERRED_DEPENDENCY = #108` 是否成立（补充报告 B 节）。
````
## 7. 范围边界（审查时请勿越界）

- 只做 **architecture readiness / NEXT_GATE 裁决**，不做实现、不创建 Spec / ADR 文件 / Ticket。
- 不推进 #110（DESIGN_ONLY），不推进 #112 的 BM25 / FTS / 新检索 provider / 持久索引 / 向量库。
- 不把 grill 提出的问题自动升格为新的 gate；#108 的 gate 已是 C，补充发现只增加决策清单条目。
- 审计结论不得被解释为"P1 研究质量不好"——仓库当前**没有任何**研究质量实测证据。

---

*本文件随审计产物一同进入独立评审；未修改 `AGENTS.md` / `RULES.md` / `docs/project-memory.md` / 任何 Approved Spec。*
