# Zhihu Grabber Toolkit Documentation

这里是 `zhihu-grabber-toolkit` 的文档入口。

如果只是想运行工具，优先从根目录 [`README.md`](../README.md) 和各模块 `SKILL.md` 开始；如果想理解产品边界、架构、关键决策、资格验证和当前研发方向，再从本页向下进入。

---

## Start Here

| 文档 | 适合解决的问题 |
|---|---|
| [`architecture/overview.md`](./architecture/overview.md) | 整个系统由哪些层组成，数据怎样从抓取走到研究结果？ |
| [`architecture/key-decisions.md`](./architecture/key-decisions.md) | 为什么要区分 captured / verified、full / sampled、controller / model？ |
| [`product-design/zhihu-grabber-toolkit-product-design.md`](./product-design/zhihu-grabber-toolkit-product-design.md) | 这个产品为什么一步步从知乎抓取器演进到 verified corpus 与 Research Orchestration？ |
| [`product-behavior-contract.md`](./product-behavior-contract.md) | 当前已经批准的产品行为是什么？ |

---

## Product Contracts & Specs

这些文档定义产品需求、边界和已批准行为。它们不是普通说明文档；阅读时应尊重文件中的 authority / amendment 关系。

| 文档 | 作用 |
|---|---|
| [`product-behavior-contract.md`](./product-behavior-contract.md) | 当前已批准产品行为的归一化执行视图。 |
| [`specs/v2-rich-content-fidelity.md`](./specs/v2-rich-content-fidelity.md) | Rich content、canonical data、Agent projection 等基础产品合同。 |
| [`specs/v0.3-product-scope.md`](./specs/v0.3-product-scope.md) | v0.3 的 additive product scope 与相关行为修订。 |
| [`specs/research-orchestration-scope.md`](./specs/research-orchestration-scope.md) | 单问题 Research Orchestration 的产品/实现合同。 |
| [`specs/p1-cross-question-deep-research.md`](./specs/p1-cross-question-deep-research.md) | Cross-Question Deep Research 的 P1 架构与产品合同。 |

---

## Architecture

| 文档 | 作用 |
|---|---|
| [`architecture/overview.md`](./architecture/overview.md) | 面向贡献者与读者的系统总览。 |
| [`architecture/key-decisions.md`](./architecture/key-decisions.md) | 关键产品/工程决策、替代方案和 trade-off。 |
| [`architecture/runtime-strategy.md`](./architecture/runtime-strategy.md) | Local / cloud runtime、capability isolation 与 model quality 的边界。 |

---

## Product Design

| 文档 | 作用 |
|---|---|
| [`product-design/zhihu-grabber-toolkit-product-design.md`](./product-design/zhihu-grabber-toolkit-product-design.md) | 面向产品讨论与面试阅读的“问题 → 决策 → 演进”设计文档。 |

产品设计文档不是 Approved Spec，也不改变产品合同。它的职责是解释：为什么产品会演进成现在这样，以及各阶段解决了什么用户问题。

---

## Module Documentation

### `zhihu-answer-grabber`

- [`../zhihu-answer-grabber/SKILL.md`](../zhihu-answer-grabber/SKILL.md)
- [`../zhihu-answer-grabber/references/`](../zhihu-answer-grabber/references/)

主要负责知乎搜索、抓取、分页、断点续传、rich content、输出与 deterministic verification。

### `corpus-anthology`

- [`../corpus-anthology/SKILL.md`](../corpus-anthology/SKILL.md)

主要负责 verified corpus 的分块、map、coverage/evidence verification、reduce、hierarchical digest、sampled analysis 与 archive。

### `research-orchestration`

- [`../research-orchestration/`](../research-orchestration)

主要负责把自然语言研究请求编排到既有 search / capture / verify / handoff / corpus primitives 上。

---

## Qualification & Evidence

仓库保留了若干资格验证与真实 evidence 文档，用于回答“某个 runtime / provider / schema / capability 是否真的被验证过”。这类文档是证据，不应被误读成产品宣传。

代表性入口：

- [`t01-embedding-provider-qualification.md`](./t01-embedding-provider-qualification.md)
- [`t01-accepted-embedding-implementation-profile-decision.md`](./t01-accepted-embedding-implementation-profile-decision.md)
- [`t5-capability-isolation-feasibility.md`](./t5-capability-isolation-feasibility.md)
- [`t5c-codex-chatgpt-runtime-qualification.md`](./t5c-codex-chatgpt-runtime-qualification.md)
- [`t5l-llamacpp-runtime-qualification.md`](./t5l-llamacpp-runtime-qualification.md)

更多 evidence / discovery 文档可直接浏览 [`docs/`](./) 与仓库 [`discovery/`](../discovery)。

---

## Planning & Execution History

- [`planning/`](./planning/)
- [`project-memory.md`](./project-memory.md)
- [`project-memory/`](./project-memory/)

这些文档用于 durable project memory、planning、ticket decomposition 和历史状态恢复。它们适合贡献者与维护者，不是普通用户的首要阅读入口。

---

## Engineering Governance

- [`../AGENTS.md`](../AGENTS.md)：Agent execution / branch / review / merge / recovery workflow。
- [`../RULES.md`](../RULES.md)：credential、canonical data、verification、scope、Git、review 等 hard invariants。

仓库将稳定工程规则放在 repository authority 中，而不是依赖某次 Agent 对话的上下文记忆。

---

## 建议阅读路径

### 我只想抓知乎内容

```text
README
→ zhihu-answer-grabber/SKILL.md
```

### 我要分析数百条回答

```text
README
→ corpus-anthology/SKILL.md
→ Architecture Overview
```

### 我要理解 Research Orchestration

```text
Architecture Overview
→ Research Orchestration Spec
→ Key Engineering Decisions
```

### 我要理解这个产品为什么变成现在这样

```text
Product Design & Evolution
→ Key Engineering Decisions
→ Runtime Strategy
→ P1 Cross-Question Deep Research
```

### 我要参与开发

```text
AGENTS.md
→ RULES.md
→ Applicable Spec / Issue
→ relevant module docs
```
