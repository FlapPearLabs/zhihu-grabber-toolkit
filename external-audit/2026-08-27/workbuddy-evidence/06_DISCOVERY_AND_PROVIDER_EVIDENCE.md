# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 06 DISCOVERY AND PROVIDER EVIDENCE

> 来源：Track A（2026-08-26）只读发现 + memory 2026-08-26 日志浓缩。
> Level 1 Project Sources 06（DESIGN_HISTORY_NON_AUTHORITATIVE）本机不可用；本文是 Track A 真实发现，非该文档替代。

---

## 1. 官方知乎数据平台（2026-08-26 浏览器实测 developer.zhihu.com）

平台已正式开放（邀测）。鉴权：Bearer Access Secret + X-Request-Timestamp。

已确认端点（全部官方第一方）：

```text
GET /api/v1/content/zhihu_search          Count ≤ 10
GET /api/v1/content/global_search         Count ≤ 20, Filter, SearchDB
GET /api/v1/content/hot_list              Limit ≤ 30
POST /v1/chat/completions                 直答 zhida-fast-1p5 / thinking-1p5 / agent（OpenAI 兼容，stream）
GET /api/v1/user/contents                 Offset/Limit ≤ 50, ContentType, SortField, SortOrder
GET /api/v1/user/followees
GET /api/v1/user/collections
GET /api/v1/user/favlists
GET /api/v1/user/favlist_contents
OAuth 2.0 Authorization Code Flow         openapi.zhihu.com/authorize + POST /access_token
知识库 4 端点（bases/items/upload/search）、PDF 解析、PPT 生成
GET /api/v1/quota                         额度查询
```

**官方 Zhihu CLI 存在**：`https://developer-cdn.zhihu.com/zhihu-cli/releases/stable/skill/zhihu-cli-skill.zip`
- 凭证存 Keychain/Credential Manager；
- **只查询 Access Secret 所属账号，不接受 OAuth Token / 代查参数**；
- 官方 Skill ×4（zhihu_search / global_search / hot_list / zhida）+ MCP ×4。

---

## 2. 当前 toolkit 已实现（production，已有）

```text
官方 zhihu_search          src/official.js（匹配官方 contract：Bearer + ts + Query + Count/limit）
Session/Web signed API     x-zse-96 signer（AGPL 上游 iteng007/zhihu-mcp-server → zly2006/zhihu-plus-plus）
question / answers / comments（Top3 root）
~/.zhihu-cli/config.json   仅 Cookie 兼容读取（不调用官方 CLI，不是官方 CLI 依赖）
```

重大 gap（Track A 结论）：官方平台已提供 hot_list / global_search / 直答 / user contents / followees /
collections / favlists / favlist_contents / OAuth 委派——**当前 toolkit 全部未接入**。
zhihu_search 的 Item 已有 ContentID（回答/文章可直接定位）。

---

## 3. OSS 审计（真实源码，2026-08-26）

| 项目 | License | 架构 | 结论 |
|---|---|---|---|
| OpenCLI | Apache-2.0 | browser-session 架构；cookie browser-owned 不复制；read/write access 显式隔离 + `--execute` 门；network capture 有 sanitizeCapturedRequest/Url（Authorization/Cookie/token/secret/password/api-key 等 redact） | Browser Session Provider 候选值得 |
| Xiaofan629/zhihu-cli | Apache-2.0 | browser-cookie3 直接读浏览器 DB + credential 落盘 `~/.zhihu-cli/credential.json` + best-effort fallback | 不符合 Level 0 安全；仅 structured envelope / 命令面参考 |
| dawnswwwww/zhihu-cli | MIT | 纯官方 OpenAPI HTTP 直连；`set-secret` 走 argv 有泄漏风险 | 官方 HTTP adapter 架构参考 |
| klarkxy/zhihu-search | SATA 自定义 | 覆盖全部官方 API + OAuth 辅助 + quota 熔断 + MCP/Skill | capability 参考 + license 谨慎 |
| zly2006/zhurl | AGPL | `~/.zhihu-plus-plus/account.json` + zhihu_sign crate | signer 上游 lineage 参考 |

相关结论：`VIDEO_SUPPORT = DO_NOT_SUPPORT`（V0.3 决策 B）；Video 仅 external evidence 记录。

---

## 4. Provider 策略现状

```text
官方 OpenAPI        = 已接入（zhihu_search）+ 未接入（hot_list/global_search/直答/user 系/OAuth）
Session/Web signed  = 已接入（x-zse-96）
Browser session     = NOT_HAVE（当前是 COOKIE_INJECTED_PLAYWRIGHT_VERIFICATION，非 browser-owned session）
OpenCLI browser     = OSS_ADAPTER_CANDIDATE（未决策）
Embedding runtime   = 无（benchmark 用 ngram proxy；real embedding NOT_IMPLEMENTED）
```

---

## 5. Benchmark 语料来源（真实，只读复用）

- 2 个 verified handoff 语料：out/439521858（17 答）、out/smoke-p3/477427067（18 答）
- 4 个 captured 语料：live-batch-smoke-2 的 462973596 / 466695857 / 485463474 / 487214224（15/15/7/3 答）
- 全部为低代码/企业管理选型域；含 SHA-256 manifest（`benchmark/corpus/manifest.json`）
- 语料字段：questionId / answerCount / verified / answers[]（id, author, voteupCount, createdTime, commentCount, content_html, assets）

**author identity 缺口**：canonical answers schema **无 author_id / url_token（只有 author name string）**
→ Expert Recall / Author Concentration 机械化受阻；采用 `BENCHMARK_AUTHOR_KEY` + author_identity_confidence（STRONG/MEDIUM/WEAK/UNKNOWN）分层，不修改 production schema。

---

## 6. 诚实说明

- Track A 发现是**只读审计**结论，未接入任何新 provider（IMPLEMENTATION_AUTHORIZATION = NONE）。
- 官方平台端点信息来自浏览器实测 developer.zhihu.com（2026-08-26），可能随平台更新而变。
- 本轮（Assembly）未做任何新 discovery 实验。
