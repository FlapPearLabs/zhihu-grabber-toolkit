# 2026-08-25 — Universal CLI → adapter-first route correction

PROVENANCE_CLASS: RECOVERED_CONVERSATION_EXCERPT  
AUTHORITY: DESIGN_HISTORY_ONLY  
NOT_A_SPEC: YES

This file preserves the decision-relevant portion of the historical discussion in which discovery of the official Zhihu CLI/platform changed the planned route.

## Earlier ambition

The discussion initially framed the target as:

> 把“只研究 Question/Answer”升级成“统一接入知乎所有合法可用数据能力”。

and described a unified CLI that could understand:

```text
official platform / CLI / MCP
Access Secret / API / Skill
OAuth
Web Session / QR
+
our grab / verify / corpus / research
```

The user-facing ambition was a “Zhihu Universal Intelligence CLI” supporting research, author history, own history, favorites, pins, monitoring, hot list and search.

## Three-layer simplification

The discussion then compressed a more complicated architecture into:

```text
Layer 1 — Data entry
official API / CLI / MCP / Access Secret / OAuth / Web Session / QR

Layer 2 — Existing trusted research kernel
normalize / verify / dedupe / provenance / coverage / resume / corpus / evidence

Layer 3 — Intelligence
cross-question research / author research / history / favorites / monitoring / viewpoint change
```

## Discovery that changed the route

A key statement was:

> 调查后一个非常重要的新发现：知乎自己已经开始做 Zhihu CLI。这个会直接改变我们的路线。

The resulting direction was:

> 对于官方已经有 CLI 能力的部分，优先复用/兼容官方 CLI，而不是立刻逆向重写。

The discussion distinguished likely provider roles:

```text
official capability
→ first choice where contract exists

official CLI wrapper
→ useful where CLI coverage is better / HTTP contract is unstable

Web Session
→ public/session complement

OAuth
→ delegated multi-user authorization

existing v0.3
→ preserve proven capture/verify/research kernel
```

## Explicit hard stop before Spec

The route correction explicitly said:

> 不要马上做 `v0.4 Universal Foundation` 的代码。

Instead:

1. audit official Skill/CLI;
2. inspect version/capabilities/help;
3. perform read-only smoke where authorized;
4. enumerate official commands/output/auth;
5. read official API/Skill/MCP/OAuth docs;
6. compare mature OSS;
7. compare current v0.3;
8. produce capability/provider crosswalk;
9. only then write the next Spec.

The key line was:

> 只有这张表确认以后，才写 v0.4 Spec。

## Why included

This excerpt shows that `THIN / ADAPTER-FIRST / REUSE-FIRST` was a route correction caused by capability discovery, not a premise assumed from the start.
