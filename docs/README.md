# Documentation

Zhihu Grabber Toolkit 的文档入口。

如果只想使用工具，从根目录 [`README.md`](../README.md) 开始；如果想理解系统为什么这样设计，从本页进入 Architecture / Product Design。

## Start Here

| 文档 | 适合谁 | 内容 |
|---|---|---|
| [`Architecture Overview`](./architecture/overview.md) | 开发者 / 贡献者 | 三个模块、数据流、verification、corpus 与 orchestration 总览 |
| [`Key Engineering Decisions`](./architecture/key-decisions.md) | 开发者 / 技术面试 / 维护者 | 关键决策、替代方案、trade-off 与演进 |
| [`Product Design & Evolution`](./product-design/zhihu-grabber-toolkit-product-design.md) | 产品 / AI 产品 / 想理解项目演进的人 | 从知乎抓取到跨问题研究的产品问题、判断与路线 |

## Product Contracts

| 文档 | 作用 |
|---|---|
| [`Product Behavior Contract`](./product-behavior-contract.md) | 当前已批准产品行为的归一化视图 |
| [`V2 Rich Content Fidelity`](./specs/v2-rich-content-fidelity.md) | rich content、canonical / projection、安全边界 baseline |
| [`V0.3 Product Scope`](./specs/v0.3-product-scope.md) | V0.3 产品合同与 additive amendments |
| [`Research Orchestration Scope`](./specs/research-orchestration-scope.md) | 单问题 Research Orchestration 的批准实现合同 |
| [`P1 Cross-Question Deep Research`](./specs/p1-cross-question-deep-research.md) | 跨多个 Question / Source-group 的 Deep Research 设计 |

## Architecture

| 文档 | 作用 |
|---|---|
| [`Architecture Overview`](./architecture/overview.md) | 系统整体结构 |
| [`Key Engineering Decisions`](./architecture/key-decisions.md) | 决策沉淀 |
| [`Runtime Strategy`](./architecture/runtime-strategy.md) | local / cloud runtime、capability isolation 与 model quality 边界 |

## Product Design

| 文档 | 作用 |
|---|---|
| [`Zhihu Grabber Toolkit: Product Design & Evolution`](./product-design/zhihu-grabber-toolkit-product-design.md) | 产品问题、关键取舍、演进路线与 P1 产品方向 |

## Qualification & Evidence

这些文档回答“某个具体 runtime / provider / schema 决策为什么可以被接受”，属于 evidence，而不是 README 的主阅读路径。

当前仓库包括例如：

- [`T01 Embedding Provider Qualification`](./t01-embedding-provider-qualification.md)
- [`T01 Accepted Embedding Implementation Profile`](./t01-accepted-embedding-implementation-profile-decision.md)
- [`T1 Search Answer Count Schema Discovery`](./t1-search-answer-count-schema-discovery.md)
- [`T4 Agent Consumer Audit`](./t4-agent-consumer-audit.md)
- [`T5 Capability Isolation Feasibility`](./t5-capability-isolation-feasibility.md)
- 其他 runtime qualification / dogfood evidence。

原则：**qualification evidence 是 provider / model / profile scoped 的，不能自动推广成全局产品事实。**

## Engineering Governance

| 文档 | 作用 |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | repository-driven Agent execution / review / merge workflow |
| [`RULES.md`](../RULES.md) | credential、canonical data、scope、Git、review 等 hard invariants |
| [`Project Memory`](./project-memory.md) | durable long-lived project facts；不是运行状态或 changelog |

## Module Documentation

| 模块 | 文档 |
|---|---|
| `zhihu-answer-grabber` | [`SKILL.md`](../zhihu-answer-grabber/SKILL.md) |
| `corpus-anthology` | [`SKILL.md`](../corpus-anthology/SKILL.md) |
| `research-orchestration` | 入口与实现见 [`research-orchestration/`](../research-orchestration/) |

## How to Read the Repository

### 只想用

```text
README
→ Quick Start
→ Module SKILL
```

### 想理解架构

```text
Architecture Overview
→ Key Engineering Decisions
→ Runtime Strategy
```

### 想理解产品为什么长成这样

```text
Product Design & Evolution
→ Research Orchestration Spec
→ P1 Cross-Question Deep Research
```

### 想审计一个具体技术判断

```text
Applicable Spec / Decision
→ Qualification / Evidence
→ GitHub Issue / PR / exact reviewed SHA
```

## Authority Note

本页只是导航，不创建新的产品 authority。

真实 authority 关系以：

```text
RULES.md
+ AGENTS.md
+ Applicable Approved Specs
+ product-behavior-contract.md 的归一化边界
```

为准。Architecture / Product Design 文档用于解释设计与演进，不得覆盖 Approved Specs。
