# AGENTS.md — 在这个仓库里怎么干活

先读 `README.md`（产品和用法）和 `RULES.md`（硬约束，不可违反）。改产品行为前，再读 `docs/specs/` 里对应的 Spec 和当前 Issue。

`docs/archive/` 是历史流程文档和决策记录，只作背景参考，不是现行规则。

## 1. 工作流

1. 从最新 `master` 拉分支：一个改动对应一个分支、一个 PR。不要直接在 `master` 上改。
2. 涉及正确性的改动先写测试：解析、状态、合同、安全边界、fail-closed 语义都算。先看到测试失败，再改到通过。
3. 提交前跑相关测试；改了共享代码就跑全量（命令见第 6 节）。默认目标是 `fail = 0`。
4. push 后开 PR，描述里写清四件事：
   - 改了什么，为什么改；
   - 怎么验证的：测试结果，或者真实运行的摘要和关键数字；
   - 已知限制；
   - 用户能看到的行为变化。
5. 合并由 product owner（仓库所有者）决定。
6. 分支已经有人在 review 时，不要 force push；修复一律追加 commit。

提交信息用 Conventional Commits：`feat:` / `fix:` / `docs:` / `test:` / `refactor:` / `chore:`。

## 2. Review 轮数预算

- 每个 PR 最多两轮「review → 修复」。
- 第二轮之后还有未决意见，由 product owner 三选一：
  - 合并，同时开 follow-up Issue；
  - 缩小范围后合并；
  - 关闭 PR。

  不开第三轮。
- 只有两类意见阻塞合并：
  - **P0**：凭据泄露、数据损坏、错误结论被当作正确输出；
  - **P1**：违反 `RULES.md` 或 Spec 合同、正确性缺陷。
- 其他意见（风格、命名、可选重构）不阻塞，作者自行决定是否处理。
- 自审不算 review。review 由 product owner 或其指定的人或 Agent 完成，不设法定人数。

## 3. 证据不进主树

- 不提交到仓库：运行产物、验收包、review 记录、日志、截图。
  - 本地运行放在 `work/`（已 gitignore）；
  - PR 描述或 Issue 里写摘要和关键数字；
  - 需要长期保存的，作为 Issue 附件或 Release asset。
- 例外：测试需要的最小合成数据，放在对应包的 `test/fixtures/`。
- 2026-10-16 之前的历史验收证据，保存在 tag `archive/evidence-2026-10-16` 的 `docs/acceptance/` 里。

## 4. 默认关闭的代码要有期限

- 所有默认关闭的代码都必须登记在 `docs/default-off.md`，写明四项：是什么、开关在哪、负责的 Issue、决定日期。包括：
  - 有开关但默认不启用的；
  - 已实现但没接入主流程的；
  - 只被测试或资格脚本使用的。
- 决定日期最多在登记后 8 周。
- 到期时二选一：
  - 有评估证据支持，就默认启用；
  - 否则删除。
- 延期需要 product owner 在 Issue 里写明理由和新日期，最多延期一次。
- 新增这类代码的 PR 必须同时更新登记表，否则不合并。

## 5. 模型与运行时

- 所有模型调用只走 `research-orchestration/lib/model-runtime.mjs`（基于 pi-ai）。不要在别处直接调模型 API。
- 默认模型是 `deepseek/deepseek-v4-pro`，用户可以用 `--model` 选任意厂商或 OpenAI 兼容接口。
- 模型层三条约束：
  - tool-less；
  - fail-closed；
  - 不在模型之间自动 fallback。

  运行身份必须如实记录。
- 模型输出一律当作不可信输入：先校验，再进入下游。

## 6. 测试命令

在仓库根目录执行：

```bash
(cd zhihu-answer-grabber && npm ci && npm test)
(cd corpus-anthology && node --test)
node --test test/agent-pipeline.test.mjs
(cd research-orchestration && npm ci)
node research-orchestration/scripts/run-classified-research-suites.mjs guard
node research-orchestration/scripts/run-classified-research-suites.mjs full-offline
git diff --check
```

- 新增 research-orchestration 测试文件时，要在 `research-orchestration/suite-classification.json` 登记，否则 guard 会失败。
- 需要真实网络、凭据或模型的测试归为 live/private，不进 CI。这类测试的结果写进 PR 描述。

## 7. 文档

- 文档写现状，不写过程。
  - 决定写进对应的 Spec 或 README；
  - 讨论和过程留在 PR 和 Issue 里。
- 改了用户可见的行为，就在同一个 PR 里更新 `README.md`。
- 不新增流程类文档。如果确实需要一条新规则，直接改本文件，并保持它短于 8000 字符：WorkBuddy 等工具会把它整份注入首轮上下文，超出部分会被截断。
