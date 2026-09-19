# F-RP-01 — finding-scoped 修订与执行者自检

日期：2026-09-19。范围仅为 `SYNTHESIS_CATEGORY_DIMENSION_COLLAPSE`。这是执行者 self-review，不是外部独立 reviewer 结论，不重审已关闭 findings，不批准 owner decisions 或产品实现。

## 身份与读取范围

执行 `git fetch origin` 后核验：

```text
CURRENT_MASTER = 4bea7b30b3842a876e383977686a0abc0d68302f
CURRENT_REPAIR_PLAN_HEAD = 565647b7f6cbb5abb8aaccff3d3c3ef5e7e1296e
EXPECTED_PLAN_HEAD_MATCH = YES
CURRENT_AUDIT_PUBLICATION = eb02a660cdb3ada07ee08f742e2987bb7da8b9e8
BASE_SHA = 565647b7f6cbb5abb8aaccff3d3c3ef5e7e1296e
BRANCH = fix/repair-plan-f-rp-01-20260919
REVIEWER_ROUTE = EXTERNAL_REVIEW
```

从 BASE 新建独立 worktree / branch。原 evidence branch 不改写。candidate identity 由包含本文件的 Git commit 提供，主稿内容绑定由包内 SHA256SUMS 提供，避免自引用哈希。

Fresh-read 主稿、supporting/contract-review.md、supporting/contract-rereview.md、上游 AUDIT_REPORT.md；核对当前 AGENTS/RULES、P1 Spec §8.1–8.3、P1_SEAM_CONTRACTS_V1 版本条款及直接相关源码/测试消费者。现有两份 review receipt 绑定历史主稿 hash，不覆盖本候选；F-RP-01 blocker 以本次用户任务附件为修订输入。未全仓重审、未重新 Design It Twice。没有 CodeGraph 索引，按本次指示不新建。

## 最小合同与 consumer 证据

主稿 §5.3 给出 controller-owned relationStatus 与 supportBreadth；source-claim kind 保留在 lineage，不增加 synthesis-level groupSalience。独立 UNRESOLVED record 的 breadth=null 明确表示不适用。两个 canonical 字段分别从关系表重算，legacy category 不参与计算。

检查到的当前 consumer（产品内容与 CURRENT_MASTER 相同）：

| 路径 | 当前事实 | 计划中的窄同步 |
|---|---|---|
| research-orchestration/lib/cross-group-aggregation.mjs:79–113 | 原组 main/minority/contradictory 保留为 kind，并参与错误的跨 claim opposition 装配 | 保留 kind 为原始出处上下文；不再作为 stance/conflict/breadth authority |
| research-orchestration/lib/cross-source-synthesis.mjs:95–96,178–183,350–365 | 四类别枚举、互斥分配、持久化 category | 新正交 canonical state + 单向 legacy 展示；未改当前源码 |
| research-orchestration/lib/cross-source-synthesis.mjs:487–524 | new_contradiction_rate 当前读取 category | 新版本读取 relationStatus；保留全输出记录分母/空集口径，披露 unresolved，不新造 evaluator |
| research-orchestration/lib/coverage-state.mjs:153–154,278；lib/coverage-final-integration.mjs:696–725,818–845 | ledger 保存诊断；T15 消费 T14 产物/guard/run 绑定 | 版本与正交状态传播，禁止 T15 从 category 重建关系；不改变 coverage authority |
| research-orchestration/test/helpers/p1-seam-contracts.mjs:33,429–430；test/fixtures/p1-seams/seam-d/ | 冻结 validator 和历史 artifact 要求旧四枚举 | CD-B3 major bump 后更新新版 consumer；旧产物只历史渲染 |
| research-orchestration/test/p1-t14-cross-group-synthesis.test.mjs:248–274,631–639 | 固定旧 category / diagnostic 规则 | 批准后按新合同更新断言；本轮仅更新计划中的未来回归义务 |

表内 `lib/` 和 `test/` 简写均相对 research-orchestration。上述消费者与主稿 §5.3 一致；这里只列本 blocker 的直接链路，不声称全仓消费者认证。

## 七项 finding-scoped 自检

| 问题 | 自检结论与依据 |
|---|---|
| 1. F-RP-01 是否关闭？ | CLOSED（执行者层面）。§5.1 保持 Aspect ≠ Proposition；§5.3 Case B 明确 CONFLICTING + MULTI_GROUP，Case D 同时保留多组支持和两条组内 minority metadata。待外部 exact-SHA 复核。 |
| 2. 是否在另一字段或 legacy mapping 重引折叠？ | 未发现。relationStatus/supportBreadth 分别重算、校验，不相互覆盖；互斥 legacy label 仅为有损视图，必须携带/展示 canonical 两维，不可单独作为新版语义输出。 |
| 3. unresolved 是否可能转成 group-specific？ | 合同禁止。UNRESOLVED + null + 原出处，无 support/oppose/legacy category；四枚举必填旧接口拒绝不兼容，不补默认值。CD-B2 全 unresolved 报告政策仍待 owner。 |
| 4. minority 是否提升为全局属性？ | 合同禁止。新 synthesis 不生成全局 minority category，也不新增 groupSalience taxonomy。历史 minority 仅历史渲染，原 claim 标签继续可见。 |
| 5. breadth 是否变成 truth/confidence/consensus？ | 合同明确否定，也不证明 evidence independence。只数 ASSERTS 的 distinct source groups；OPPOSES/UNRESOLVED 不计入。 |
| 6. legacy 是否反向驱动 canonical semantics？ | 合同禁止。§10 的 legacy_category_is_derived_only 覆盖篡改/删除视图不能改变 canonical state/identity、两侧引用及 diagnostics。旧 category 不得用于补新字段；只能用原始 lineage 按新合同 re-synthesis / re-evaluation。 |
| 7. 是否发生 scope expansion？ | 未发现。只改计划包：主稿、README、本自检、SHA256SUMS。Lane A/C/D/E/F 与无关章节保持原文；§12/14/15 仅同步引用。没有产品、测试、Spec、治理、memory、Issue、CI 修改。 |

反例自检还覆盖：同一 source 的两条相反 claim 不能按 sourceRef 跨两侧去重；一组支持加多个反对组仍是 SINGLE_GROUP；已解析 family 不得没有自 ASSERTS anchor；legacy view 被改为 widely-shared 不能把 UNRESOLVED 变成支持。§17 继续保留明确 golden 漏合并/all-unresolved 的失败门，新增只输出 conflicting、丢失 breadth 必须 FAIL。

## 检查与方法

- Standards 自检：scope-only diff、Conventional Commit、历史 receipts 不改写、提案与现行 authority 分离；无新的范围/authority finding。普通代码 smell 不用于扩写本次文档合同。
- Spec 自检：对照用户 F-RP-01 的三维定义、A–F、四项必需回归、3+2 live golden、版本和外部 review gate，未发现缺项。§10 另列 same-source 两侧 lineage 回归。
- 机械检查：20 个一级章节保留；§3/4/7/8/9/11/16/18 及 Lane A/C/D/E/F 与 BASE 逐字节相同；A–F 与五项回归条款均在，旧主稿 canonical 分类优先级与 unresolved→group-specific 条款已移除。历史 receipts 中旧文字保留为历史证据，由 README/§20 明示不可转移。
- `git diff --check`；提交前核验整个包的 `shasum -a 256 -c SHA256SUMS` 和 BASE→candidate 路径 allowlist。原 evidence 与两份历史 contract review 保持字节不变。
- 动态产品 tests / live semantic validation：NOT_APPLICABLE_TO_PLAN_ONLY_CHANGE / NOT_RUN。没有新增可执行测试或 fake 实现来冒充产品验收；§10/17 是未来实施的必需合同。
- 使用 `code-review`（blocker/consumer 核对与 Standards/Spec 双轴执行者自检）、`codebase-design`（最小 interface 与三维语义定义）。本次用户限定窄修订/外部复核优先，不执行 skill 中广泛 redesign、tracker setup 或内部最终 reviewer 流程。未使用 implement/to-tickets/tdd/improve-codebase-architecture。
- 子代理/Claude Code：未调用。核心语义合同由 Codex 直接修订与自检，外部 reviewer 路由保持；self-review 不冒充 independent review。
- Codex 最终验收范围：本计划包修订和机械检查；产品/实现验收未进行。只更新本计划文档，未更新仓库规则、CI 门禁、Spec 或 project-memory。PROJECT_MEMORY_UPDATE_REQUIRED=NO。

```text
SELF_REVIEW = PASS
F-RP-01 = CLOSED (executor self-review only)
REPAIR_PLAN_STATUS = READY_FOR_FINDING_SCOPED_REVIEW
READY_TO_DECOMPOSE_REPAIR_TICKETS = NO
OWNER_DECISIONS = PROPOSED / PENDING OWNER DECISION
NEXT_LEGAL_ACTION = FINDING_SCOPED_EXTERNAL_REVIEW
```
