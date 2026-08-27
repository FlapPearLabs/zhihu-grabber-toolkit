# Official and OSS Discovery Notes

STATUS: EVIDENCE_ONLY  
DATE: 2026-08-25  
AUTHORITY: NON-NORMATIVE  
IMPLEMENTATION_AUTHORIZATION: NONE

---

## 1. Purpose

本文件保存当前阶段已经调查到的：

- 知乎官方开放平台；
- 官方 Zhihu CLI / Skill / MCP；
- Access Secret / OAuth；
- Session / Cookie / QR / Browser reuse；
- 相关成熟 OSS；
- 我们现有 v0.3 与未来目标之间的 capability gap。

它不是实现合同。

所有外部事实在真正施工前都必须按当前状态重新验证。

---


## 1.1 Level 0 Scope Reconciliation — Video

As of 2026-08-26, current repository Approved Specs define:

```text
VIDEO_SUPPORT = DO_NOT_SUPPORT
```

Therefore, Video is removed from the current Zhihu CLI Pro provider/canonical-model discovery scope. Historical or external evidence that official/OSS surfaces may expose video content remains evidence-only and does not authorize product support. Reopening Video requires a separate Approved Spec amendment.

## 2. Current Internal Baseline

当前 v0.3 的核心资产不是“全知乎平台”，而是一个可信 Research Kernel。

已形成的核心能力包括：

- search；
- single-question research orchestration；
- answer capture；
- pagination / resume；
- output verification；
- provenance / evidence lineage；
- rich-content preservation；
- hierarchical corpus analysis；
- sampled/full distinction；
- controller/model authority separation；
- deterministic state / resume semantics。

当前世界观仍主要围绕：

> Question / Answer

因此下一阶段重点不是重写研究内核，而是补：

- unified provider layer；
- unified auth；
- canonical multi-content model；
- historical state store；
- cross-question / author / monitoring intelligence。

---

## 3. Official Platform — Observed Capability Families

当前调查显示，`developer.zhihu.com` 的能力面至少覆盖以下类别：

### Authentication / Access

- Access Secret / Bearer-style platform authentication
- Official Zhihu CLI
- OAuth for delegated user authorization

### Public / Search-oriented capabilities

- Zhihu Search
- Global Search
- Direct Answer / Zhida
- Hot List

这些能力存在 API / Skill / MCP 的重叠接口形态。

核心解释：

> API / CLI / Skill / MCP 不是四套业务数据。

它们分别属于不同 interface / transport / Agent integration layer。

正确集成原则：

> one capability → one canonical capability contract → multiple interfaces/providers

---

## 4. Official CLI / Skill Discovery

当前调查确认：

- 知乎开放平台已经提供官方 Zhihu CLI 文档入口；
- 官方 CDN 存在 Zhihu CLI Skill 分发路径；
- 近期真实使用材料显示官方 CLI/Skill 可覆盖搜索、热榜、直答以及部分 `me` 数据能力；
- Access Secret 与 CLI/Skill 是鉴权/接口关系，而不是独立的数据宇宙。

实施前仍需重新做：

1. 从官方来源下载当前 Skill；
2. 审计 manifest / installer / binary provenance；
3. 检查当前 `--help` / command tree；
4. 检查 version / capabilities；
5. 使用本地已有 Access Secret 进行只读 smoke；
6. 枚举真实 output contract；
7. 记录 pagination / limit / error semantics。

不得只根据二手文章或旧 README 直接写生产 adapter。

---

## 5. Authentication Plan — Evidence-backed Options

目标支持三类 Web Session 入口：

### QR Login

社区实现已经证明 CLI 拉起 QR 登录流程在工程上可行。

目标 UX：

```text
zhihu auth session qr
→ 用户扫码
→ session verified
→ secure local persistence
```

### Secure Cookie Import

允许用户已有 Cookie 时导入。

禁止：

```text
zhihu auth --cookie "<literal>"
```

原因：

- shell history；
- argv/process exposure；
- agent/tool logs。

推荐设计：

```text
zhihu auth session import --stdin
```

或安全本地文件。

### Existing Browser Session Reuse

OpenCLI 类项目证明 browser-session reuse 是可行设计方向。

目标：

> 尽量复用已经登录的浏览器状态，而不是复制 Cookie 到多个地方。

是否采用浏览器 bridge、cookie extraction 或其他机制，必须经过单独安全审计。

---

## 6. OSS Reference Projects

以下项目是“设计参考 / capability evidence”，不是当前产品依赖清单。

### `dawnswwwww/zhihu-cli`

值得借鉴：

- thin CLI handlers；
- centralized HTTP client；
- centralized auth injection；
- mockable client；
- testable command boundary。

主要价值：

> 官方开放平台 CLI architecture reference。

---

### `klarkxy/zhihu-search`

值得借鉴：

- 一份上游 capability；
- 同时暴露 CLI / MCP / Skill / OpenAPI；
- 参数校验 / 转发 / 错误翻译分层。

主要价值：

> one capability, multiple surfaces。

---

### `Xiaofan629/zhihu-cli`

值得借鉴：

- Question / Answer / Article / Pin / User 等统一命令面；
- user history；
- comments；
- structured output envelope；
- browser/session credential strategy。

主要价值：

> Canonical Content / Agent-friendly envelope / broad Web read surface。

---

### `BAIGUANGMEI/zhihu-cli`

值得借鉴：

- QR login；
- broad Session/Web capability；
- Question / Answer / User / Topic / Collection / Feed；
- Pin / Article 等内容对象。

主要价值：

> Session provider capability map。

写操作能力即使存在，也不代表本产品当前应启用写操作。

---

### OpenCLI

值得借鉴：

- existing browser session reuse；
- browser bridge；
- deterministic CLI adapter；
- website-to-CLI abstraction。

主要价值：

> Browser Session Provider architecture。

---

### `zhurl`

值得借鉴：

- low-level Web endpoint exploration；
- API debugging；
- session-based request behavior。

主要价值：

> discovery / debugging reference。

不应把非官方 endpoint 当永久合同。

---

### `zhihu-plus-plus`

值得借鉴：

- 实际完整第三方客户端所覆盖的 Web capability surface；
- Pin / comments / collections / history 等现实可行性。

主要价值：

> “现实中哪些公开/登录态能力可能拿到”的证据。

---

## 7. Current Architecture Conclusion from Discovery

未来目标建议保持三层理解：

```text
1. Data Access / Providers
   Official API / CLI / Skill / MCP
   Access Secret / OAuth
   QR / Cookie / Browser Session
              ↓
2. Existing Research Kernel
   normalize / verify / provenance
   coverage / resume / corpus
   hierarchy / evidence
              ↓
3. Intelligence
   cross-question research
   author/personal research
   historical corpus
   continuous monitoring
```

更具体的内部长期结构：

```text
Agent Surface
    ↓
Capability Router
    ↓
Official Provider / Session-Web Provider / OAuth
    ↓
Canonical Zhihu Model
    ↓
SQLite Historical Store
    ↓
Research Kernel
    ↓
Research Coverage / Temporal Intelligence
```

---

## 8. Canonical Model Direction

研究层不应直接消费不同 Provider 的原始 JSON。

目标 canonical objects：

- User
- Question
- Answer
- Article
- Pin
- Comment
- Topic
- Collection
- Relation
- Evidence Source

至少保留：

- canonical identity；
- content type；
- provider；
- auth class；
- source URL；
- retrievedAt；
- provenance；
- verification state；
- completeness state。

---

## 9. Provider Policy

核心原则：

> unify capability, do not erase provenance.

允许同一 capability 存在多个 provider。

例如概念上：

```text
search.zhihu
→ official-api

me.contents
→ official-cli / official-api depending on verified current contract

content.pin
→ session-web if official capability is insufficient

research.topic
→ our intelligence layer
```

禁止：

```text
official provider failed
→ silently scrape session-web
```

除非未来 Approved Spec 明确允许某种 fallback，并且 provenance / reason 被记录。

---

## 10. Monitoring Discovery

当前调查没有确认知乎对“某作者新增/修改内容”提供公开 inbound webhook/event subscription。

因此首版监控应假定：

```text
scheduler
→ periodic sync
→ SQLite snapshot diff
→ NEW / UPDATED / REMOVED / UNCHANGED
→ analyze delta
→ our webhook / notification
```

这里：

- polling/sync 负责发现变化；
- webhook 负责把我们的 intelligence event 向外发送。

如果未来官方出现事件订阅：

> 作为新的 provider 输入，不改变 Temporal Intelligence 核心合同。

---

## 11. Content-Type Findings

当前外部证据支持以下方向具有现实可行性：

- Question
- Answer
- Article
- Pin / 想法
- User
- Comment
- Topic
- Collection
- user public history

但：

> 可行 ≠ 当前官方支持 ≠ 当前稳定 ≠ 当前完整。

特别是：

- Poll / 投票字段；
- 完整评论树；
- Topic 具体字段；
- third-party public user history completeness；
- search depth；
- hard pagination limits；
- official vs session completeness；

都必须进入真实 capability audit。

---

## 12. “Full / Complete” Terminology

未来所有 discovery / implementation 必须区分：

### Retrieval Coverage

搜索研究空间覆盖程度。

通常无法证明全知乎 100%。

### Source Completeness

对于一个明确、可枚举 source，
当前 Provider 实际枚举/抓取是否完整。

### Analysis Coverage

Verified Corpus 中被分析的比例。

避免宣传：

> “全站所有内容都研究完了。”

更准确：

> “跨多个高相关知乎来源，在明确的检索策略下达到高覆盖/饱和，并对已验证语料进行可审计分析。”

---

## 13. Open Discovery Questions

以下项目不得猜：

- 官方 CLI 当前完整 command tree；
- 官方 CLI 与 HTTP API 的真实 parity；
- Access Secret 当前账号真实 capability；
- OAuth scopes；
- OAuth refresh/error semantics；
- official pagination；
- Pin / Article 在官方 user-content 中的实际形态；
- comments / subcomments completeness；
- Topic available fields；
- Poll result access；
- Search depth / max windows；
- Session/Web rate behavior；
- official vs session completeness difference；
- OSS endpoint current stability；
- Browser Session reuse 的安全边界；
- capability-by-provider error semantics。

---

## 14. Required Next Discovery Output

下一阶段调查建议最终形成：

```text
ZHCLIPRO_CAPABILITY_MATRIX
ZHCLIPRO_PROVIDER_MATRIX
ZHCLIPRO_AUTH_MATRIX
ZHCLIPRO_CANONICAL_MODEL
ZHCLIPRO_OUTPUT_CONTRACT
ZHCLIPRO_COMPLETENESS_SEMANTICS
ZHCLIPRO_TARGET_ARCHITECTURE
ZHCLIPRO_IMPLEMENTATION_ROADMAP
```

推荐 capability matrix 字段：

```text
CAPABILITY
OFFICIAL_DOC_SOURCE
OFFICIAL_API
OFFICIAL_CLI
OFFICIAL_SKILL
OFFICIAL_MCP
OAUTH
SESSION_WEB
CURRENT_TOOLKIT_SUPPORT
CANONICAL_OBJECT
AUTH_REQUIREMENT
PROVIDER
OUTPUT_CONTRACT
COMPLETENESS_SEMANTICS
GAP
RISK_STABILITY
TESTABILITY
RECOMMENDED_IMPLEMENTATION
PRIORITY
```

---

## 15. Evidence Handling Rule

本文件随时间会过期。

真正施工前：

> CURRENT OFFICIAL EVIDENCE > THIS DISCOVERY NOTE

若新官方文档与本文件冲突：

- 更新本文件；
- 不维护旧事实的兼容性；
- 不把历史 observation 当长期 contract。
