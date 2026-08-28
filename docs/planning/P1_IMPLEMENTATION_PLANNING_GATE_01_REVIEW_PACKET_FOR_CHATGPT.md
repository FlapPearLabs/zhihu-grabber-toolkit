# P1_IMPLEMENTATION_PLANNING_GATE_01_REPAIR_R1 — REVIEW PACKET FOR CHATGPT

```text
PURPOSE = 审查导航专用（不构成 authority）
REVIEWER = ChatGPT（外部独立 reviewer；本 repair 未经独立 review，不得自行批准）
REVIEW_CYCLE = R1 delta re-review（响应 CHANGES_REQUESTED_NARROW：P0=0 / P1=3 / P2=2）
STATUS = REVIEW_PENDING / NON_AUTHORITATIVE_PLANNING_CANDIDATE
Date: 2026-08-28
```

## REMOTE IS REVIEW SOURCE OF TRUTH

请直接从 remote 审查，不要依赖本地文件副本。

```text
REMOTE_BRANCH      = planning/p1-implementation-gate-01
BASE_REVIEWED_HEAD = 54a0841b93452cfd5ca37780ee03e70bffc82988   （R0，已被 ChatGPT 判 CHANGES_REQUESTED_NARROW）
REPAIR_COMMIT      = 本 R1 candidate 的单 commit（parent = BASE_REVIEWED_HEAD；
                     若本文件与 branch tip 间无额外 commit，则 REPAIR_COMMIT == REMOTE_TIP）
REMOTE_TIP         = planning/p1-implementation-gate-01 的 remote tip（push 后实测）
BASE_SHA（master） = 279caf6141c26a38cf4a449b2b4cfbeba4357577（branch 的最终 master base，未变）

REVIEW_ENTRYPOINT  = docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01.md
SUPPORTING_FILE    = docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01_REVIEW_PACKET_FOR_CHATGPT.md（本文件）
```

Scope 声明：R1 只修改 `docs/planning/` 同两个文件（append repair commit，无 amend / rebase /
force push）；零代码、零 Spec、零 governance 改动。若 diff 显示其他变更 → 直接 CHANGES_REQUESTED。

## Files changed（R1 delta）

```text
docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01.md                    （修改：R1 修复）
docs/planning/P1_IMPLEMENTATION_PLANNING_GATE_01_REVIEW_PACKET_FOR_CHATGPT.md （修改：本 packet 更新为 R1）
```

delta 审查建议：`git diff 54a0841..REPAIR_COMMIT -- docs/planning/`（应仅上述两文件）。
ENTRYPOINT 末尾含 "附：R1 REPAIR RECORD" 表，逐 finding 映射修复位置。

## P1-1 resolution — D-2 拆分 + GATE-3 重定义

- 显式更正 R0 错误：Session/Cookie capture 是 capture primitive，**不是** retrieval ranking
  channel；RRF channel identity = query + ZhihuDataProvider/capability retrieval rankings（§5.4）。
  当前仓库真实只有 **一个** retrieval-ranked capability（Official Search）。
- **D-2a**（PRIMARY = C）：Provider seam + Official Search adapter —— CAN_DELEGATE_TO_IMPLEMENTATION_TICKET。
- **D-2b**（PRIMARY = B）：额外 retrieval-ranked provider/capability —— REQUIRES_SEPARATE_DISCOVERY_OR_QUALIFICATION。
- **GATE-3 = ADDITIONAL_RETRIEVAL_PROVIDER_CAPABILITY_DISCOVERY**：
  - 目的：识别/资格确认至少一个额外 retrieval-ranked provider/capability，满足 multi-provider
    retrieval 合同；只调查 P1 首个 implementation 真正相关的 capability；**现在不执行 discovery，
    不做全 provider 研究**；
  - DOES NOT BLOCK：Ticket Decomposition / generic ZhihuDataProvider seam / Official Search
    adapter / 确定性 fixtures 的 generic RRF；
  - BLOCKS：宣称 multi-provider retrieval capability complete；仅 Official Search 存在时的
    full P1 implementation completion。
- **D-9 更新**：lazy 原则保留；若 GATE-3 选中 provider 需要新 OAuth/Session credential 行为，
  D-9 立即升级为该 provider 的 scoped Discovery / Security prerequisite。
- TICKETING_READY = YES 不变。

## P1-2 resolution — 双 selector 分离 + 图重画

- 显式区分两个 selector，禁止合并：
  - **(A) Source-group Set Selection / Ambiguity Gate**（新 [4]）：输入 Candidate/Retrieval Pool，
    输出 `SelectedSourceGroups[]`；clear best group set → auto；material ambiguity → 至多一次
    clarification；no valid group set → fail closed；发生在 per-group capture **之前**（Approved §7）。
  - **(B) RCE Corpus Selector**（[10]）：输入 verified candidate sources/groups + metadata +
    dense geometry，输出 selected Verified Research Corpus；baseline = Preservation + Popularity
    Anchor + Dense Relevance/Novelty + optional lightweight redundancy；发生在 capture/verify **之后**。
- Critical path 按 review 指定链重画（15 组件 + 三 gate），ENTRYPOINT §F 含逐组件终检表
  （1–15 全部在位并显式编号）。

## P1-3 resolution — CoverageState cross-cutting + saturation feedback

- **[13] ResearchCoverageState = cross-cutting controller state**：从 [3] retrieval 起始持续更新，
  贯穿 retrieval / provider routes / source-group selection / capture-verification / RCE selection /
  claim-aspect analysis；同时追踪 Retrieval Coverage / Source Completeness / Analysis Coverage。
  不再表示为 late linear stage。
- **[14] Saturation = FEEDBACK CONTROLLER**，显式反馈边：
  `[13] → saturation decision → 未饱和 → 追加 retrieval round（回到 [3]）；饱和 / budget stop →
  继续走向 final synthesis`。
- 阈值不冻结；D-6 保持 CAN_DELEGATE_TO_IMPLEMENTATION_TICKET +
  DEFAULT_REQUIRES_IMPLEMENTATION_VALIDATION。

## P2 resolutions

- **P2-1（D-8 wording）**：删除 "CLOSED_FOR_V1"（planning artifact 无权关闭 Approved Spec decision）。
  改为：

  ```text
  D-8 = DEFER_FROM_INITIAL_P1_BASELINE
  NO_TICKET_IN_INITIAL_DAG = YES
  APPROVED_SPEC_DECISION_STATUS = REMAINS_OPEN
  DEFAULT = DO_NOT_INTRODUCE
  ```

  全文（§C / §D / §I / §K）已统一为该表述；ENTRYPOINT 中 "CLOSED_FOR_V1" 仅存于
  R1 REPAIR RECORD 的修复说明引用，不再作为任何 D-8 状态断言出现。
- **P2-2（GATE-2 wording）**：实质结论不变（remote embedding egress 需显式 authority）。
  强化：GATE-2 结论必须经适用的 security / contract governance 与 independent review，
  **转化为显式 repository authority/evidence** 后才允许 remote embedding 实现；
  聊天声明或 executor note 单独不足；本 Gate 不预设具体 ticket/review 类型。

## D-1…D-9 final classification（R1）

| ID | PRIMARY_CLASS | 一句话理由 |
|---|---|---|
| D-1 | B（GATE-1） | seam 已冻结；provider 选型需 egress+qualification 证据；blocks 实现，不 blocks ticketing |
| D-2a | C | Provider seam + Official Search adapter（唯一已知 retrieval-ranked capability）可 TDD 委派 |
| D-2b | B（GATE-3） | 额外 retrieval-ranked provider 满足 multi-provider 合同；blocks multi-provider completeness / full P1 completion；不 blocks ticketing/seam/adapter/fixtures-RRF |
| D-3 | C（DAG 前部 interface ticket） | 概念字段与 plan authority 已冻结；exact schema 可 TDD |
| D-4 | C + IMPLEMENTATION_VALIDATION | 数值调参；planning 不拍权重、不重跑 benchmark |
| D-5 | C（invariant-first） | anti-starvation 先表达为可测不变量；拒绝 six hard quotas |
| D-6 | C + IMPLEMENTATION_VALIDATION | saturation 语义冻结 + feedback controller 定位；thresholds/rounds/budgets 实现验证 |
| D-7 | C（cache/storage）+ B 子门（GATE-2） | cache schema 不阻塞；remote egress 结论须经 governance+review 转为 repo authority/evidence |
| D-8 | D（DEFER_FROM_INITIAL_P1_BASELINE） | NO_TICKET_IN_INITIAL_DAG=YES；APPROVED_SPEC_DECISION_STATUS=REMAINS_OPEN；DEFAULT=DO_NOT_INTRODUCE |
| D-9 | D（lazy + GATE-3 触发升级） | 既有 Session/Cookie 边界不动；GATE-3 选中 provider 需新 OAuth/Session → 立即 provider-scoped Discovery/Security prerequisite |

PRESERVE 确认：D-1 / D-3 / D-4 / D-5 / D-6 / D-7 cache-egress 拆分 / D-9 lazy 原则 / 四组件
selector / six-dimension relocation / 安全模型 / overengineering rejection list 全部未变。

## GATE-1 / GATE-2 / GATE-3 summary

```text
GATE-1（D-1）  EmbeddingProvider Qualification Discovery
               blocks → EmbeddingProvider adapter / Dense layer 实现
GATE-2（D-7b） remote embedding egress authority
               产出须转显式 repo authority/evidence（governance + review）
               blocks → remote embedding 实现（local 须记录"无新增 egress"）
GATE-3（D-2b） ADDITIONAL_RETRIEVAL_PROVIDER_CAPABILITY_DISCOVERY
               NOT blocking → ticketing / seam / Official Search adapter / fixtures-RRF
               blocking    → multi-provider completeness claim；仅 Official Search 的 full P1 completion
D-9 触发       GATE-3 provider 需新 OAuth/Session → provider-scoped Discovery/Security prerequisite
```

三个 gate 均可作为 discovery ticket 进入 Ticket DAG，不要求提前完成。

## Critical Path final form（15 组件 + 反馈）

```text
[1] Research Plan → [2] Provider seam → [3] Multi-query/multi-provider retrieval + RRF
    → Candidate/Retrieval Pool → [4] Source-group Set Selection / Ambiguity Gate
    → SelectedSourceGroups[] → [5] Multi-group Execution State
    → [6] Per-group Capture/Verify/Handoff → [7] Verified candidate source pool
    → [10] RCE Corpus Selector（+ [8] EmbeddingProvider ←GATE-1/GATE-2、[9] Dense layer 并行前置）
    → Selected Verified Research Corpus → [11] Question/Source-group representation
    → [12] Claim/Aspect synthesis → [15] v0.3 final synthesis integration

[13] ResearchCoverageState = cross-cutting（自 [3] 起持续更新，三覆盖账目）
[14] saturation feedback：[13] → decision →（未饱和）回到 [3] /（饱和/budget）→ 下游
```

逐组件 1–15 终检表见 ENTRYPOINT §F。

## Checks（执行时实测）

```text
git fetch + ls-remote（开工 freshness check）  # master 仍 = 279caf6；branch tip 仍 = 54a0841（BASE_REVIEWED_HEAD）
append repair commit                            # 无 amend / rebase / force push
git diff --check                                # clean
scope audit                                     # 仅同两个 planning 文件；无其他变更被提交
REMOTE_TIP == REPAIR_COMMIT                     # push 后 ls-remote 实时验证
```

## Exact questions for ChatGPT（delta re-review）

1. **P1-1 验证**：D-2a/D-2b 拆分与 GATE-3 的 blocking/non-blocking 语义是否与你的指令一致？
   R0 错误（Session capture 当 retrieval channel）是否已完全更正且未在其他段落残留？
2. **P1-2 验证**：新图是否正确包含并分离 [4] Source-group Set Selection（§7，capture 前）与
   [10] RCE Corpus Selector（§3 baseline，capture/verify 后）？15 组件终检表是否全部在位、
   依赖方向正确？
3. **P1-3 验证**：[13] cross-cutting 定位与 [14] 显式反馈边是否符合指令？是否存在把
   CoverageState 残留表示为末端线性阶段的段落？
4. **P2-1 验证**："CLOSED_FOR_V1" 是否已全文清除？D-8 四行表述是否准确，且未在任何位置声称
   本 Gate 关闭了 Approved Spec decision？
5. **P2-2 验证**：GATE-2 governance 要求（结论 → repo authority/evidence，governance + review，
   聊天声明不足）是否表述充分？是否避免了预设具体 ticket/review 类型？
6. **Scope 验证**：`54a0841..REPAIR_COMMIT` 是否仅触及同两个 planning 文件、仅含 5 项 finding
   对应的修复？PRESERVE 清单是否全部未动？
7. **遗留确认项**（自 R0 packet 延续）：P1 Approved Spec 的 CONTRACT/CONSISTENCY 双 reviewer
   PASS（on exact HEAD `279caf6`）记录在外部审查会话，repo 端仅 promote/repair commit 留痕 ——
   请确认该双 PASS 记录存在且针对 `279caf6`。

---

```text
TICKETING_READY = YES
MUST_RESOLVE_BEFORE_TICKETING = empty

TARGET_STATUS = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = NONE
VERSION_ASSIGNMENT = UNASSIGNED

NEXT_LEGAL_STAGE = P1_TICKET_DECOMPOSITION
                  （仅在本 delta re-review PASS 后生效）
```

---

*REMOTE IS REVIEW SOURCE OF TRUTH。本 packet 与 REVIEW_ENTRYPOINT 均为 NON_AUTHORITATIVE
planning candidate；SELF_REVIEW != INDEPENDENT_REVIEW。*
