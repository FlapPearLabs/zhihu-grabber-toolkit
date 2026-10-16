# 文档

只想使用工具：从根目录的 [`README.md`](../README.md) 开始。想理解为什么这样设计：看下面的「架构」和「产品设计」。

## 产品合同（Spec）

| 文档 | 作用 |
|---|---|
| [`V2 Rich Content Fidelity`](./specs/v2-rich-content-fidelity.md) | 富内容、原始数据与渲染视图、安全边界的基线合同 |
| [`V0.3 Product Scope`](./specs/v0.3-product-scope.md) | V0.3 产品合同，以及对 V2 的增量修订 |
| [`Research Orchestration Scope`](./specs/research-orchestration-scope.md) | 单问题研究编排合同 |
| [`P1 Cross-Question Deep Research`](./specs/p1-cross-question-deep-research.md) | 跨问题深度研究合同 |

## 架构

| 文档 | 作用 |
|---|---|
| [`Architecture Overview`](./architecture/overview.md) | 三个模块、数据流、验收、语料与编排的总览 |
| [`Key Engineering Decisions`](./architecture/key-decisions.md) | 关键决策、替代方案和取舍 |
| [`Runtime Strategy`](./architecture/runtime-strategy.md) | 本地和云端运行时、能力隔离与模型质量的边界 |

## 产品设计

| 文档 | 作用 |
|---|---|
| [`Product Design & Evolution`](./product-design/zhihu-grabber-toolkit-product-design.md) | 产品问题、关键取舍、演进路线 |

## 使用说明

| 文档 | 作用 |
|---|---|
| [`P1 用户澄清与恢复`](./p1-clarification-recovery.md) | P1 遇到来源组选择歧义时，如何提交选择并恢复运行 |

## 工程规则

| 文档 | 作用 |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | 工作流、review 轮数预算、证据规则、默认关闭代码的期限 |
| [`RULES.md`](../RULES.md) | 凭据、原始数据、验收、Git 等硬约束 |
| [`默认关闭代码登记表`](./default-off.md) | 每段默认关闭的代码、开关位置、负责 Issue 和决定日期 |
| [`CONTEXT.md`](../CONTEXT.md) | P1 领域术语表 |

## 模块文档

| 模块 | 文档 |
|---|---|
| `zhihu-answer-grabber` | [`SKILL.md`](../zhihu-answer-grabber/SKILL.md) |
| `corpus-anthology` | [`SKILL.md`](../corpus-anthology/SKILL.md) |
| `research-orchestration` | [`research-orchestration/`](../research-orchestration/) |

## 历史资料

- [`archive/`](./archive/)：历史流程文档和决策记录。包括：
  - 项目记忆；
  - 产品行为合同的归一化视图；
  - P1/P2 规划与票据图；
  - 各 runtime 和 provider 的资格审计；
  - V0.3 dogfood 报告。

  这些只作背景参考，不是现行规则。资格审计结论只适用于当时评估的那个 provider、模型或配置，不能推广成全局结论。
- 2026-10-16 之前的验收证据（原 `docs/acceptance/`）保存在 tag [`archive/evidence-2026-10-16`](https://github.com/FlapPearLabs/zhihu-grabber-toolkit/tree/archive/evidence-2026-10-16/docs/acceptance)。
