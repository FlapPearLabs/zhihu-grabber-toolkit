# Discovery Evidence Appendix — Leads to Re-verify

STATUS: EVIDENCE_ONLY  
DATE: 2026-08-25  
AUTHORITY: NON-NORMATIVE  
APPLIES_TO: `05_OFFICIAL_AND_OSS_DISCOVERY_NOTES.md`  
IMPLEMENTATION_AUTHORIZATION: NONE

---

## 1. Purpose

本文件保存此前调查中值得保留的“精确线索”，避免在清理历史聊天后丢失：

- 官方平台能力目录；
- 官方 CLI / Skill 的具体检查入口；
- 已观察到的鉴权/endpoint 线索；
- OSS reference capability map；
- Deep Research 方法论线索。

重要：

> 本文件中的精确 URL、命令、endpoint、字段和行为均属于 `LEAD_TO_REVERIFY`。

真正施工前必须重新核验当前官方文档、当前 binary/Skill 和真实只读 smoke。

---


## 1.1 Level 0 Scope Reconciliation — Video

Current Applicable Approved Specs define `VIDEO_SUPPORT = DO_NOT_SUPPORT`. Any Video-related observation in this appendix is retained only as historical/external capability evidence. It is not an active discovery or implementation target. Reopening Video requires a separate Approved Spec amendment.

## 2. Evidence Grade

使用：

```text
FIRST_PARTY_DOC
FIRST_PARTY_BINARY_OR_SKILL_OBSERVED
REAL_SMOKE
OSS_SOURCE
SECONDARY_REPORT
UNVERIFIED
```

解释：

- `FIRST_PARTY_DOC`：当前官方文档直接支持；
- `FIRST_PARTY_BINARY_OR_SKILL_OBSERVED`：实际检查官方发布物得到；
- `REAL_SMOKE`：使用本地合法凭据真实只读测试得到；
- `OSS_SOURCE`：成熟开源源码/README 提供；
- `SECONDARY_REPORT`：近期二手实测材料；
- `UNVERIFIED`：仍需调查。

Discovery 的目标之一就是尽可能把：

> SECONDARY_REPORT / UNVERIFIED

升级为：

> FIRST_PARTY_* / REAL_SMOKE。

---

## 3. Official Developer Platform — Capability Leads

此前调查记录显示，`developer.zhihu.com` 当前能力目录至少需要重新核验以下类别：

### Start / Auth

- Authentication
- Zhihu CLI

### Search / Answer / Hot

- Zhihu Search — API / Skill / MCP
- Global Search — API / Skill / MCP
- Direct Answer / Zhida — API / Skill / MCP
- Hot List — API / Skill / MCP

### Knowledge Base

- knowledge base list
- knowledge base content/items
- file upload
- retrieval/search

### Tools

- PDF parse
- PPT generation

### User Data

- OAuth onboarding
- user contents
- user followees
- user favorites
- favorite collection list
- favorite collection contents

EVIDENCE_GRADE:

> FIRST_PARTY_DOC in previous investigation; MUST re-check current catalog before implementation.

---

## 4. Official Authentication / HTTP Leads

此前官方文档调查记录过：

```text
Authorization: Bearer <Access Secret>
X-Request-Timestamp: <Unix seconds>
```

以及知乎搜索 HTTP 入口线索：

```text
GET /api/v1/content/zhihu_search
```

EVIDENCE_GRADE:

> FIRST_PARTY_DOC previously observed; LEAD_TO_REVERIFY.

不要从本文件直接推断：

- 所有 endpoint 都使用完全相同 headers；
- OAuth endpoint 也使用同一 credential；
- rate limit；
- current schema。

必须逐 capability 核验。

---

## 5. Official Zhihu Search MCP Leads

此前调查记录过 Zhihu Search MCP 的候选入口：

```text
/api/mcp/zhihu_search/v1/sse
/api/mcp/zhihu_search/v1/message
```

以及标准 MCP 流程：

```text
initialize
→ tools/list
→ tools/call
```

工具名线索：

```text
zhihu_search
```

EVIDENCE_GRADE:

> FIRST_PARTY_DOC previously observed; LEAD_TO_REVERIFY.

施工前需要重新实际验证：

- transport；
- auth；
- tool schema；
- output；
- async/SSE behavior；
- error semantics。

---

## 6. Official Skill / CLI Distribution Lead

此前调查记录过官方 Skill CDN 路径：

```text
https://developer-cdn.zhihu.com/zhihu-cli/releases/stable/skill/zhihu-cli-skill.zip
```

EVIDENCE_GRADE:

> FIRST_PARTY DISTRIBUTION LEAD / MUST REVERIFY.

安全审计流程：

1. 只从当前官方域名下载；
2. 下载后先检查 archive contents；
3. 审计 manifest / installer / scripts；
4. 不先执行未知 installer；
5. 检查 binary provenance / version / hash mechanism；
6. 不允许 secret 出现在 tool log / command argv；
7. 安装后只做 read-only capability inspection；
8. 再做 real smoke。

---

## 7. Official CLI Command Leads from Prior Reports

近期二手实测材料曾报告命令包括：

```text
auth status --verify
search zhihu
search global
hot
answer
me contents
me followees
me favorites
```

并报告：

- `me contents` 的历史二手报告曾观察到 Answer / Article / Video / Pin / Question；其中 Video 仅保留为外部 capability evidence，当前产品 `VIDEO_SUPPORT = DO_NOT_SUPPORT`，不得进入 provider/canonical implementation scope；
- macOS 可能使用 Keychain；
- Windows 可能使用 Credential Manager；
- Secret 通过更安全的本地 credential mechanism 管理。

EVIDENCE_GRADE:

> SECONDARY_REPORT

因此：

> 不能直接写进生产 contract。

下一轮必须通过官方 Skill / CLI 本体：

```text
version
--help
command help
auth status
read-only smoke
```

逐条升格或否定。

---

## 8. Access Secret vs OAuth — Product Interpretation Lead

此前设计调查形成的工作假设：

```text
single-user / own Agent use
→ Access Secret / Official CLI may cover many self-oriented capabilities

third-party multi-user delegated app
→ OAuth

public/session complement
→ Session/Web provider
```

EVIDENCE_GRADE:

> MIXED: FIRST_PARTY_DOC + SECONDARY_REPORT

必须通过：

- OAuth current docs；
- official CLI current behavior；
- actual account capability smoke

重新确认边界。

不要把：

> Access Secret = all user data

或：

> OAuth = always required for own data

写死。

---

## 9. Community Official-API Coverage Reference

`klarkxy/zhihu-search`

此前调查价值：

- official-platform wrapper；
- one capability exposed through multiple surfaces；
- CLI / MCP / Skill / OpenAPI；
- official search / global search / hot / direct answer；
- user data；
- knowledge base；
- PDF/PPT；
- OAuth coverage crosswalk。

EVIDENCE_GRADE:

> OSS_SOURCE

用途：

> cross-check official capability catalog and adapter design.

不得用社区项目替代官方 contract。

---

## 10. Web / Session Capability References

### `Xiaofan629/zhihu-cli`

此前调查价值：

- Question
- Answer + comments
- Article + comments
- Pin + comments
- User
- user answers/articles/pins
- search
- hot
- collections/favorites/following/feed
- structured output envelope
- browser/session credential approaches

EVIDENCE_GRADE:

> OSS_SOURCE

---

### `BAIGUANGMEI/zhihu-cli`

此前调查价值：

- QR login
- Question / Answer
- user profile/history
- Topic / hot questions
- comments
- collections
- feed
- broad Session/Web surface

EVIDENCE_GRADE:

> OSS_SOURCE

---

### OpenCLI

此前调查价值：

- reuse logged-in browser session；
- browser bridge / localhost daemon；
- deterministic adapter；
- Zhihu commands including search/question/answer/comments/collections 等。

EVIDENCE_GRADE:

> OSS_SOURCE

---

### `zhurl`

此前调查价值：

- low-level Web API discovery；
- debugging；
- session request exploration。

EVIDENCE_GRADE:

> OSS_SOURCE

约束：

> unofficial endpoint is not a durable product contract.

---

### `zhihu-plus-plus`

此前调查价值：

- broad third-party client capability surface；
- Pin / comments / collections / user history 等现实可行性参考。

EVIDENCE_GRADE:

> OSS_SOURCE

---

## 11. Poll / Voting Result Status

此前没有取得足够证据证明：

> structured Zhihu Poll results

在当前官方平台或成熟 Web provider 中具有稳定、完整、统一的读取合同。

因此当前必须保持：

```text
POLL_RESULT_SUPPORT = DISCOVERY_REQUIRED
```

不要把：

- vote count；
- upvote action；
- poll object；

混为一谈。

---

## 12. Deep Research Methodology Leads

此前调查过的 Deep Research / Search Skills 的共同方法包括：

```text
question sharpening
query decomposition
multi-angle search
source reading
gap search
triangulation
contradiction handling
structured synthesis
citation checking
```

可借鉴组件：

```text
Research Planner
Query Expansion
Gap Critic
Triangulation
Contradiction Synthesis
```

但当前冻结原则是：

> 借方法，不把可信研究核心外包给第三方 Deep Research Skill。

我们自己的 controller 继续拥有：

- source identity；
- verification；
- coverage；
- provenance；
- evidence lineage；
- corpus completeness semantics。

外部 Skill 不得成为这些权威的替代品。

---

## 13. Exact Endpoint / Capability Facts Must Be Re-verified

在真正实现 adapter 前，至少重新验证：

```text
OFFICIAL CLI:
version
full command tree
auth behavior
output schema
pagination
errors

OFFICIAL API:
exact endpoint
auth
schema
pagination
rate/limit

MCP:
transport
tool list
schema
output
errors

OAuth:
authorize/token flow
scope
refresh/revoke if documented
user-data boundary

SESSION/WEB:
current endpoint stability
pagination
comments
Pin
Article
Topic
user history
rate behavior
```

任何没有当前证据的项：

```text
UNKNOWN
```

不得补猜。

---

## 14. Evidence Preservation Principle

历史聊天可以删除。

但以下“研究资产”必须保留：

```text
source name
capability lead
evidence grade
what it may solve
what still requires verification
```

这样既避免原始聊天污染 authority，
又不会丢掉已经花时间发现的调查线索。
