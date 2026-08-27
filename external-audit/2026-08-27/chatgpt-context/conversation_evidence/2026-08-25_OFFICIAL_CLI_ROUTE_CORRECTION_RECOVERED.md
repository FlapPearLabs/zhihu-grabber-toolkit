# 2026-08-25 — Official CLI discovery changed the route

PROVENANCE_CLASS: RECOVERED_ASSISTANT_CONVERSATION_EVIDENCE
AUTHORITY: DESIGN_HISTORY_ONLY, NOT CURRENT AUTHORITY
SOURCE: recovered File Library conversation artifact `分支 · 自主循环提示词.txt`.

Recovered high-confidence statements from the historical conversation:

> 我重新查了知乎当前开放平台、官方 CLI/Skill/MCP 的最新情况，以及几类现成 GitHub 项目。现在可以把这件事讲得很清楚。

> 我们现在 v0.3 是什么？一个“知乎单问题可信研究引擎”。

> 调查后一个非常重要的新发现：知乎自己已经开始做 Zhihu CLI。这个会直接改变我们的路线。

> 不要马上做 `v0.4 Universal Foundation` 的代码。先做一个调查/设计阶段，而且这次应该真的拿知乎官方 Skill/CLI 本体来审，而不是只读网页。

> 只有这张表确认以后，才写 v0.4 Spec。

The same historical discussion corrected an earlier simplistic auth assumption toward:

- own-agent / own-account use: Access Secret / official CLI may cover many self-oriented capabilities;
- delegated multi-user application: OAuth;
- public/session complement: Session/Web provider.

## Why included

This is evidence that the current `THIN / ADAPTER-FIRST / REUSE-FIRST` direction was not the initial assumption; it was a route correction caused by external capability discovery. Exact current authority is in Project Sources and Track A, not this historical excerpt.
