# 2026-09-19 限定修复计划草稿

首先阅读 [SCOPED_REPAIR_PLAN.md](SCOPED_REPAIR_PLAN.md)。包含用户指定的全部20节、六条lane、两种F03设计、依赖DAG、执行waves及修复后验收。

状态：`OWNER_DECISIONS=FROZEN`，`REPAIR_PLAN_STATUS=READY_FOR_CONTRACT_CONSISTENCY_REVIEW`。下一合法动作：`INDEPENDENT_CONTRACT_AND_CONSISTENCY_REVIEW`；`READY_TO_DECOMPOSE_REPAIR_TICKETS=NO`。Owner 决定已批准，正式 Spec/seam amendment 尚未完成，本包不授权实现或拆票。

- [OWNER_CONTRACT_DECISIONS.md](OWNER_CONTRACT_DECISIONS.md)：正式记录本次 owner 选择、批准来源、authority impact 与后续审查；CD-F1 对 Lane A–E 核心修复非阻塞。
- [supporting/owner-decision-self-check.md](supporting/owner-decision-self-check.md)：本次窄一致性自检与文件范围检查，不是独立双审。
- `supporting/f-rp-01-self-review.md`：前次 8919438 修订的执行者自检，保留原文和当时 PENDING 状态。F-RP-01 外部 PASS/CLOSED/0 blockers 由本次 owner 提供并绑定该 SHA，来源说明见 decision record；不把这份 self-review 冒充外部 receipt。
- `evidence/current-state.json`：原计划起草时的远端身份与只读边界。
- `evidence/*counterexamples.json`、`standards-projection.json`：原计划起草时的审计probe重跑结果，与发布baseline深比较一致；这些脚本成功表示坏行为仍复现。
- `evidence/d2-pr83.json`、`d2-issue38.json`：GitHub只读receipt；可证明D2已合并，未找到原始D2批准receipt。
- `supporting/contract-review.md`、`contract-rereview.md`：独立契约文档审查与定向复核；绑定主稿SHA256，不是产品PASS。
- 其余 `supporting/`：分工调查草稿，仅作依据，不是并列authority；如与主稿最终定义不同，以 OWNER_CONTRACT_DECISIONS.md 的已冻结选择及主稿同步定义为准。

以下两段记录原计划起草阶段（565647b），不描述本次窄修订的发布动作或技能使用；本次 freeze 记录见 OWNER_CONTRACT_DECISIONS.md 与 owner-decision-self-check.md。

整合文档检查修正了UNRESOLVED表达、resume零调用范围、现有framing能力描述，以及正向语义命中验收门。没有修改产品、测试、Spec、规则、memory或Issues，没有创建ticket/PR或提交/上传本包。

使用技能：code-review、improve-codebase-architecture、codebase-design、GitHub（仅适用只读部分）。Architecture调查A/D，Standards调查C/F，publication_check调查E并核对整合文档；Spec对本轮未参与起草的语义合同独立审查；主审整合B与全稿。未调用Claude Code实施。

校验：在此目录执行 `shasum -a 256 -c SHA256SUMS`。当前主稿 sha256 以 SHA256SUMS 为准；旧 supporting receipts 和 evidence 均保持原时态，含旧 PENDING/停止条件；它们不覆盖当前 owner freeze，也不能转移为本候选的 Contract + Consistency PASS。所有后续改动均需要新的对应检查。
