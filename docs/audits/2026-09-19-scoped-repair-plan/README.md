# 2026-09-19 限定修复计划草稿

首先阅读 [SCOPED_REPAIR_PLAN.md](SCOPED_REPAIR_PLAN.md)。包含用户指定的全部20节、六条lane、两种F03设计、依赖DAG、执行waves及修复后验收。

状态：`MORE_CONTRACT_WORK_REQUIRED`。下一合法动作：`CONTRACT_DECISION_REQUIRED`。§1的待owner决策不是批准记录；本包不授权实现。

- `evidence/current-state.json`：本轮远端身份与只读边界。
- `evidence/*counterexamples.json`、`standards-projection.json`：本轮原审计probe重跑结果，与发布baseline深比较一致；这些脚本成功表示坏行为仍复现。
- `evidence/d2-pr83.json`、`d2-issue38.json`：GitHub只读receipt；可证明D2已合并，未找到原始D2批准receipt。
- `supporting/contract-review.md`、`contract-rereview.md`：独立契约文档审查与定向复核；绑定主稿SHA256，不是产品PASS。
- 其余 `supporting/`：分工调查草稿，仅作依据，不是并列authority；如与主稿最终定义不同，以主稿的明确提案和待决表为准。

整合文档检查修正了UNRESOLVED表达、resume零调用范围、现有framing能力描述，以及正向语义命中验收门。没有修改产品、测试、Spec、规则、memory或Issues，没有创建ticket/PR或提交/上传本包。

使用技能：code-review、improve-codebase-architecture、codebase-design、GitHub（仅适用只读部分）。Architecture调查A/D，Standards调查C/F，publication_check调查E并核对整合文档；Spec对本轮未参与起草的语义合同独立审查；主审整合B与全稿。未调用Claude Code实施。

校验：在此目录执行 `shasum -a 256 -c SHA256SUMS`。主稿最终sha256见独立复核记录；所有后续草稿改动均需要新的对应检查。
