# PROVENANCE NOTICE

STATUS: SANITIZED_PRIMARY_COPY
ORIGINAL ARTIFACT: TRACK_A_PASS_2_REVIEW_PACKET_FOR_CHATGPT
SANITIZATION: machine-specific absolute local repo path only; substantive audit text unchanged.
NOT A SUMMARY.

---

我将以 ZHIHU CLI PRO — TRACK A PASS 2 AUDITOR 身份执行本轮只读审计。先建立任务清单，然后从仓库治理文件开始。
工作区出现异常状态 — 大量 `D`（deleted）标记。先诊断这是真实文件丢失还是 git 状态损坏，再做后续审计。
关键发现：**磁盘上物理缺失 44 个 tracked 文件**（git index/HEAD 完好，这是物理文件丢失，不是 ref 损坏）。所有审计目标文件 `src/official.js` / `http.js` / `grabber.js` / `signer.js` 都不在磁盘，但可从 git 对象库读取。继续核验 docs 与 git 历史。
本地对象库缺少 remote SHA `84534f5` 的对象（无法直接 diff），且工作区存在 **44 个 tracked 文件物理丢失**（mtime 均为 Aug 23 12:48，疑似已知 worktree vanish 环境问题）。继续核验 tracking ref 与 index 完整性。
index tree 与 HEAD tree 一致（index 完好），但 pack 加载有异常且工作区物理缺文件。测试从 git 对象库读取审计目标源文件：
git 对象库可正常读取。现在读取全部核心源文件进行 Phase A 审计。
核心数据路径已明确。继续读取 CLI 入口、verifier、scripts 与 references：
继续读取 scripts、references 与 search-answer-count 等关键文件：
Phase A 源码已基本掌握。现在读取 governance/spec 文档关键部分：
Phase A 主体完成。快速核验产物 schema 形态与 README，然后转入 Phase B：
Phase A 完成。现在进入 Phase B — 官方平台能力审计与 Phase D — OSS 源码审计。
本机无 OSS 候选克隆。现在克隆 5 个审计目标到临时目录（只读审计），同时并行启动官方平台资料核验：
官方平台首页确认：知乎数据开放平台（邀测阶段，邮件申请）、全网搜索 API、直答 API（支持流式）、授权数据 API。继续深挖官方文档细节：
官方站点有导航：搜索产品 / 直答 / Agent工具 / 社区数据 / 知识库。逐一抓取：
重大发现：官方平台 2026-05 正式开放（邀测），包含 hot_list / zhihu_search / global_search / zhida 直答 + 用户数据 API + 官方 Skill/MCP。需要第一方证据核验。并行抓取官方页面并检查克隆进度：
官方页面是 SPA 登录墙，静态抓取失败。改用浏览器真实访问官方文档。先检查克隆进度：
5 个仓库全部克隆成功。现在并行做两件事：官方平台浏览器核验 + 检查克隆的仓库结构。
官方文档目录已完整呈现：鉴权 / **Zhihu CLI** / 额度查询 / 搜索×3 (API+Skill+MCP) / 直答×3 / 热榜×3 / 知识库×4 / 小工具×2 / 用户数据×6 (含 **OAuth**)。继续点击各文档页：
官方 **Zhihu CLI 确认存在**：官方命令行工具 + Skill 包（`developer-cdn.zhihu.com/zhihu-cli/releases/stable/skill/zhihu-cli-skill.zip`），凭证存 Keychain/Credential Manager，**只查询 Access Secret 所属账号，不接受代查参数**；OAuth 单独面向第三方 Web 应用。继续核验搜索 API 详情：
知乎搜索 API 官方合同已完整确认。现在批量核验其余文档页（用 URL key 直接导航 + 文本提取，高效覆盖全部端点）：
热榜 API 确认。继续批量核验 global_search / zhida / 额度查询 / 用户数据 OAuth：
全网搜索 API 确认（含 Filter 高级语法 / SearchDB / HasMore 分页信号）。继续核验直答 API 与用户数据 OAuth：
直答 API 确认（Chat Completions 兼容、3 档模型、流式支持）。继续核验 OAuth 与用户数据端点：
key=oauth 重定向到鉴权页。用点击导航方式找 OAuth 文档正确 key：
OAuth 文档确认（Authorization Code Flow，`openapi.zhihu.com`）。继续核验用户数据 API（内容/关注/收藏/收藏夹）：
用户内容 API 确认（offset 分页、NextOffset、X-OAuth-Token 委派）。继续核验关注/收藏/收藏夹端点：
全部用户数据端点已确认。最后核验额度查询 API 与知识库/小工具，然后关闭浏览器：
官方能力审计已基本完成。关闭浏览器并快速核验知识库/小工具端点（简略确认即可）：
官方平台审计完成。关闭浏览器，进入 Phase D — OSS 源码审计：
OpenCLI 是纯 browser-session 架构（cookie 浏览器持有，读请求在 browser context 内执行）。深挖其网络捕获 redaction 与分页保护：
OpenCLI 审计完成（活跃、Apache-2.0、browser-session、read/write 显式隔离、`--execute` 门）。现在审计 Xiaofan629/zhihu-cli：
zhurl 审计完成（AGPL、`~/.zhihu-plus-plus/account.json`、依赖 `zhihu_sign` crate、非官方 API 文档索引 3395 行）。补查 OpenCLI 网络捕获 redaction 与 Xiaofan 剩余部分：
klarkxy 审计完成（覆盖全部官方 API + OAuth 辅助 + quota 熔断 + 错误码映射）。最后确认 OpenCLI 依赖成本与 Xiaofan 测试覆盖：
最后核验 dawnswwwww 的 credential 保存方式是否含 secret-in-argv 风险，以及 klarkxy 的 upstream 分页/错误契约细节，然后做 OpenCLI 的 cookie 流转最终确认：
所有 5 个 OSS 项目源码审计完成。现在核验 OpenCLI 的浏览器桥是否真正保持 cookie browser-owned（扩展权限模型），并补充 zhihu-plus-plus 作为 reference 的对照信息：
补充核验 Research Kernel 其余组件与 corpus-anthology 的角色，然后清理临时审计目录：
全部审计证据已收集完毕。清理临时克隆目录，写入工作日志：
全部审计证据已收集完毕。现在输出最终交付物。
# TRACK_A_PASS_2_REVIEW_PACKET_FOR_CHATGPT

> 审计角色：ZHIHU CLI PRO — TRACK A PASS 2 AUDITOR
> 审计模式：READ-ONLY（`IMPLEMENTATION_AUTHORIZATION = NONE`）；未修改 src / tests / Spec / schema / command tree / package
> 审计日期：2026-08-26
> 仓库：FlapPearLabs/zhihu-grabber-toolkit（本地 <LOCAL_REPO_PATH>）

---

## A. Repository Snapshot

```text
BRANCH            : master
HEAD              : c9ff7b045737c2eddd4a5799702d720ade844a6d
REMOTE_MASTER     : 84534f539a03937b031a962b828f2e2d44c102fa（git ls-remote 实测）
LOCAL_TRACKING    : ef34574764b7fec80739cac150719dc65bafec10（packed-refs 旧值；本地对象库无 remote 新 SHA 对象）
WORKTREE          : DIRTY —— 44 个 tracked 文件物理缺失（D，未 staged），2 个 untracked（disk-space.txt / node-ver.txt）
INDEX vs HEAD     : index tree == HEAD tree（`git write-tree` 与 `HEAD^{tree}` 一致，index 完好）
THIS-ROUND EDITS  : 无（仅 .workbuddy/memory/ 工作日志 + 临时审计目录已清理）
```

⚠️ **重大环境发现（P1，需用户知悉）**：工作区有 **44 个 tracked 文件物理缺失**（mtime 均为 2026-08-23 12:48，覆盖 `zhihu-answer-grabber/src/*` 大部分、`scripts/*`、`test/*`、`docs/specs/v2-rich-content-fidelity.md` 等），与既有 "worktree vanish / partial write" 环境特性一致。index 与 HEAD 完好，缺失内容全部可从 git 对象库读取（本审计即基于 `git show HEAD:<path>` 完成）；**本轮未做任何恢复**（恢复属写操作，超出只读审计授权）。本地 `origin/master` tracking 落后于真实 remote（本地对象库缺 `84534f5` 对象，无法本地 diff）；后续任务必须按 AGENTS.md §7 先 fetch + 核验 remote master。

---

## B. Current Toolkit Reality（基于 HEAD `c9ff7b0` 真实源码）

### B1. Auth（`src/config.js` + `scripts/preflight.mjs` + `references/security.md`）

| 问题 | 事实 |
|---|---|
| 1. auth classes | 两类：**Cookie**（Web API 签名通道）+ **Access Secret**（官方 OpenAPI 通道）。`ConfigError` 统一错误类 |
| 2. 每类 credential 由谁读取 | Cookie：`ZHIHU_COOKIE` env → `zhihu_cookie.txt`（ZAG_CONFIG_DIR/cwd）→ `~/.zhihu-cli/config.json`（仅读 `cookies/userAgent/zse93` 字段）；Secret：`ZHIHU_SECRET` env → `zhihu_secret.txt`。`loadConfig()` / `resolveSecret()` 单一入口 |
| 3. credential 是否复制到新 store | **否**。从不写 credential 到产物 / repo / log / chat；`browser-smoke` 仅内存转 Playwright cookies（`toPlaywrightCookies`）不落盘 |
| 4. silent fallback | Cookie 三来源是**显式优先级链**（env → 本地文件 → CLI config），非静默降级；缺字段/symlink/权限问题 fail closed 抛错。Secret 无 fallback，缺则 throw |
| 5. current production contract | `product-behavior-contract.md §3.14`：KEEP_CURRENT_BEHAVIOR；symlink 拒绝、POSIX 0600 强制、preflight 只输出布尔/错误类型、认证头只发 `https://www.zhihu.com` |
| 6. historical compatibility | `~/.zhihu-cli/config.json` 读取 = **兼容历史/community zhihu-cli 的 credential/config 形态**（复用其登录产物），**不是调用官方 CLI、也不是官方 CLI 依赖**。精确区分：兼容 config format ≠ 依赖官方 CLI |

### B2. Official HTTP（`src/official.js`）

- 端点：`GET https://developer.zhihu.com/api/v1/content/zhihu_search`（**仅此一个官方端点**）
- Headers：`Authorization: Bearer <secret>` + `X-Request-Timestamp`（秒级）+ `Content-Type: application/json` —— 与官方文档实测一致
- Query：`Query`（关键词）+ `limit`（**注意**：官方文档参数名为 `Count`，默认 10 最大 10；当前代码传 `limit`，T1/T2 真实 smoke 通过，建议 Spec 前用真实 smoke 验证 `limit` vs `Count` 别名兼容性 —— P2 finding）
- Timeout 20s，重试 ≤2 次指数退避（429/5xx），`Code!==0` 抛错，`Data.Items` 解析
- JSON schema 假设：`Data.Items[].Url/Title/ContentType` + T2 enrichment 消费 question-info `answer_count`
- 覆盖：**仅 search**；**无独立 Official Provider abstraction**（`official.js` 是单函数模块，非 provider 接口）
- 测试：`test/http.test.js`、`search-answer-count*.test.js`、`cli-entrypoint` 覆盖签名/预算/降级

### B3. Session/Web（`src/http.js` + `src/grabber.js` + `src/signer.js`）

- 端点：`/api/v4/questions/{qid}`（info）、`/api/v4/questions/{qid}/answers`（分页）、`/api/v4/comment_v5/answers/{aid}/root_comment`（Top3，order_by=score, limit=3, offset= 空）
- 签名：`x-zse-96 = 2.0_<encrypt(md5(zse93+path+query+d_c0))>`，来源标注 `iteng007/zhihu-mcp-server`（AGPL-3.0）→ 上溯 `zly2006/zhihu-plus-plus` zse96 v2 算法（signer.js 头部完整 attribution）
- 分页：offset 循环 + `paging.is_end===true` 完成合同 + **MAX_PAGES=300** 硬上限 + 连续两页指纹防重复循环 + 空数据但非 is_end → fail closed
- resume：`.progress.json`（offset/done）原子写（pid tmp + rename）
- identity：question info `id` 与 canonical qid 不一致 → `QUESTION_METADATA_IDENTITY_CONFLICT`（不吞掉）
- comments：Top10 高赞回答（voteupCount DESC 稳定序）× 每回答 Top3 root；`retries:0` 预算；`child_comments` 忽略；explicit-zero 唯一来源 `data=[]+totals=0+is_end=true`；v1-compat preserve/omit 语义
- 速率：`humanDelay` 1.5–4s 随机；`requestJson` 指数退避+抖动+Retry-After 尊重；主机白名单 `www.zhihu.com` + HTTPS + 无 userinfo
- 限流错误：401/403 事实型诊断（不武断归因），429/5xx 重试，响应体 10MB 上限

### B4. Research Kernel（必须保留的既有资产）

- **verification**：`src/verifier.js` 单一事实来源（14 项校验，fence-aware Markdown 帧计数），`verify-output.mjs` 唯一授予 `verified:true`
- **provenance / captured vs verified**：`captured` ≠ `verified`；grab 恒输出 `verified:false`
- **evidence lineage**：handoff（`make-handoff.mjs` 确定性生成，三方一致：目录=JSON=handoff；`verified`/`answerCount`/`questionId` 禁止手工构造）
- **resume**：`.progress.json` + `loadExistingAnswers`/`loadExistingQuestion`（canonical-compatible 保留，不兼容不伪造）
- **corpus processing / hierarchical synthesis**：`corpus-anthology/`（stats / chunk / map-reduce / popular-sample / archive / verify）—— T5 审计确认其 LLM 调用点无确定性 DENY 证据（capability isolation = NO）
- **machine JSON contract**：`--json` 单文档 stdout、错误枚举 `configuration_error/invalid_input/network_error/http_error/question_metadata_identity_conflict/unknown_error`、路径脱敏（B-1 跨盘 `base:"outdir"` fail-closed）
- **capability isolation / tool-less semantic workers**：V2 §9.1 合同（NETWORK/SHELL/FS/TOOLS=DENY）+ V0.3 决策 C；T5 对两个 `agents/openai.yaml` host 均 `NO` → digest/map STOP

### B5. 当前不存在的能力（对官方矩阵而言）

Hot list、Global search、直答、用户内容/关注/收藏/收藏夹、OAuth、知识库、PDF/PPT、额度查询、官方 CLI/Skill/MCP 集成、search 直接返回 answer/article 全文定位（官方 Item 含 `ContentID`）—— 全部未接入。

---

## C. Official Capability Matrix（2026-08-26 浏览器实测 developer.zhihu.com 第一方文档）

| CAPABILITY | OFFICIAL_HTTP | OFFICIAL_CLI | OFFICIAL_SKILL | OFFICIAL_MCP | OAUTH | AUTH | PAGING | EVIDENCE_GRADE |
|---|---|---|---|---|---|---|---|---|
| Auth / Access Secret | `Authorization: Bearer` + `X-Request-Timestamp` | 有 | 有 | 有 | — | Bearer Secret | — | FIRST_PARTY_DOC |
| Zhihu Search | `GET /api/v1/content/zhihu_search`（Count≤10） | 有 | 有 | 有 | — | Bearer | 无（HasMore 恒 false） | FIRST_PARTY_DOC |
| Global Search | `GET /api/v1/content/global_search`（Count≤20, Filter, SearchDB） | 有 | 有 | 有 | — | Bearer | HasMore（无显式 next 参数） | FIRST_PARTY_DOC |
| Hot List | `GET /api/v1/content/hot_list`（Limit≤30） | 有 | 有 | 有 | — | Bearer | 无 | FIRST_PARTY_DOC |
| Direct Answer (Zhida) | `POST /v1/chat/completions`（zhida-fast-1p5/thinking-1p5/agent，OpenAI 兼容，stream 支持） | 有 | 有 | 有 | — | Bearer | — | FIRST_PARTY_DOC |
| User contents | `GET /api/v1/user/contents`（ContentType: all/answer/article/zvideo/pin/question） | 有 | — | — | `X-OAuth-Token` | Bearer | Offset/NextOffset | FIRST_PARTY_DOC |
| Followees | `GET /api/v1/user/followees` | 有 | — | — | `X-OAuth-Token` | Bearer | Offset/NextOffset | FIRST_PARTY_DOC |
| Collections (recent) | `GET /api/v1/user/collections` | 有 | — | — | `X-OAuth-Token` | Bearer | 无 | FIRST_PARTY_DOC |
| Favorite lists | `GET /api/v1/user/favlists` | 有 | — | — | `X-OAuth-Token` | Bearer | 无 | FIRST_PARTY_DOC |
| Favlist contents | `GET /api/v1/user/favlist_contents`（FavlistUrlToken） | 有 | — | — | `X-OAuth-Token` | Bearer | Offset/NextOffset | FIRST_PARTY_DOC |
| OAuth 2.0 | `openapi.zhihu.com/authorize` + `POST /access_token`（Authorization Code Flow；app_id/app_key 邮件申请） | —（CLI 不用 OAuth） | — | — | 是 | app_id+app_key | — | FIRST_PARTY_DOC |
| Knowledge Base | bases / items / upload / search（4 端点） | 有 | — | — | — | Bearer | — | FIRST_PARTY_DOC |
| PDF parse / PPT gen | 2 端点（小工具） | 有 | — | — | — | Bearer | — | FIRST_PARTY_DOC |
| Quota query | `GET /api/v1/quota`（APIIDs） | 有 | — | — | — | Bearer | — | FIRST_PARTY_DOC |
| Official CLI | —（CLI 包本身） | `developer-cdn.zhihu.com/zhihu-cli/releases/stable/skill/zhihu-cli-skill.zip`，**只查 Access Secret 所属账号，不接受 OAuth/代查参数**；凭证存 Keychain/Credential Manager | 是（同包） | — | — | Secret → OS secret store | — | FIRST_PARTY_DOC（CLI 存在与能力描述；未下载二进制实测） |

错误码统一契约：`0` 成功 / `10001` 参数 / `20001` 鉴权 / `30001` 频率限制 / `30002` 配额限制 / `90001` 内部错误（用户数据端点含 30002）。

---

## D. Current Toolkit × Official Gap Matrix

| Capability | Current Toolkit | Official HTTP | Official CLI | Session/Web | Gap | Recommended Direction |
|---|---|---|---|---|---|---|
| Zhihu Search | ✅ ALREADY_HAVE（official.js） | ✅ | ✅ | ✅（search_v3） | 参数名 `limit` vs `Count` 待 smoke 验证 | 保留；加 adapter 边界 |
| Global Search | ❌ | ✅ | ✅ | — | MISSING | USE_OFFICIAL_HTTP（新 adapter） |
| Hot List | ❌ | ✅ | ✅ | ✅（v3/feed hot-lists） | MISSING | USE_OFFICIAL_HTTP |
| Direct Answer (Zhida) | ❌ | ✅ | ✅ | — | MISSING | USE_OFFICIAL_HTTP（如需 Agent 问答；非抓取核心） |
| Question detail | ✅（info + metadata） | — | ✅ | ✅ | ALREADY_HAVE | 保留 |
| Answer detail | ✅（分页 answers，content 全量） | —（search Item 有 ContentID 但无单答正文端点） | ✅ | ✅ | ALREADY_HAVE | 保留 |
| Question answer enumeration | ✅（offset 分页 + MAX_PAGES + fingerprint） | — | ✅ | ✅ | ALREADY_HAVE | 保留 |
| Article | ⚠️ 仅 assets/links 识别 | search 可返回 Article Item | ✅ | ✅ | PARTIAL | 视 scope 决定（当前无正文抓取） |
| Pin | ❌ | user contents ContentType=pin 可列 | ✅ | ✅ | MISSING | USE_OFFICIAL_HTTP（列；正文仍走 web） |
| Comment | ⚠️ Top3 root only（默认 OFF） | —（search Item 有 CommentInfoList 精选评论） | ✅（OpenCLI 层级） | ✅（comment_v5） | PARTIAL | 维持 Top3 合同；层级评论 = OSS_CANDIDATE / OWN_MINIMAL_GAP |
| Full/subcomment tree | ❌ | ❌（无官方端点） | ✅（OpenCLI replies） | ✅（child_comments 存在但被忽略） | MISSING | OSS_CANDIDATE（OpenCLI）/ OWN_MINIMAL_GAP |
| Topic | ✅（question.topics {id,name}） | — | — | ✅ | ALREADY_HAVE | 保留 |
| Collection（favorite lists） | ❌ | ✅ | ✅ | ✅ | MISSING | USE_OFFICIAL_HTTP |
| User | ⚠️ 仅 author.name | ✅（contents 含 Author） | ✅ | ✅ | PARTIAL | USE_OFFICIAL_HTTP |
| Public user history | ❌（需他人 OAuth 授权） | ✅ 但需 X-OAuth-Token | ❌（CLI 不代查） | ✅（members/{id}） | MISSING/受限 | UNKNOWN（OAuth 授权流程外部性） |
| Own contents | ❌ | ✅（本人免 OAuth） | ✅ | — | MISSING | USE_OFFICIAL_HTTP |
| Followees | ❌ | ✅（本人） | ✅ | — | MISSING | USE_OFFICIAL_HTTP |
| Favorites / favlists / contents | ❌ | ✅（本人） | ✅ | ✅ | MISSING | USE_OFFICIAL_HTTP |
| OAuth delegated user | ❌ | ✅（X-OAuth-Token） | ❌（CLI 明确不支持） | — | MISSING | OWN_MINIMAL_GAP（仅当第三方应用场景出现）；当前产品无此需求 |
| QR login | ❌ | —（官方 OAuth 是 Web redirect） | ❌（官方 CLI 用 Secret） | community zhihu-cli 有 | MISSING | 不进入当前 scope（凭据安全模型禁止） |
| Browser session reuse | ✅（browser-smoke best-effort + Playwright cookies 内存转换） | — | — | — | ALREADY_HAVE（尽力而为） | OSS_CANDIDATE（OpenCLI browser-session 架构） |
| Poll result | ❌ | — | — | ✅（v4 questions/{id}/polls 类） | MISSING | UNKNOWN（无真实 evidence；video 类比） |

**VIDEO**：`VIDEO_SUPPORT = DO_NOT_SUPPORT`（V0.3 决策 B）；仅 external capability evidence 记录（官方 user contents 支持 `zvideo` 类型 = 事实记录，不进入 provider 实现 scope）。

---

## E. OSS Provider Audit（真实源码审计，非 README 级）

### E1. jackwener/OpenCLI（重点）
- **Maintenance**：活跃（2026-08-26 仍有提交，v1.8.7，PR #2377/#2406）；24 个 zhihu 专属测试文件；zhihu 命令集成熟
- **License**：Apache-2.0 ✅
- **Architecture**：**纯 Browser Session 架构**（Chrome extension `debugger`/`cookies` 权限 + localhost daemon WS `ws://localhost:19825` + 隔离 Chrome 窗口）；zhihu adapter 34 个命令模块；read/write 通过 `access: 'read'|'write'` 显式声明 + write 命令全部要求 `--execute`
- **Security**：cookie 保持 **browser-owned**（`chrome.cookies` 读取，**不复制到本地文件/argv**）；read 请求在 browser context 内执行（`page.evaluate(fetch, {credentials:'include'})`）；PRIVACY.md 声明零遥测/零外部传输；身份验证走 `GET /api/v4/me`（z_c0 检查 + url_token 提取）；无 stealth/fingerprint 设计（是浏览器自身 session）；**未发现独立 network-capture redaction 模块**（结构化捕获 commit 存在，但 cookie 不经过 CLI 进程因此天然不进 log）
- **Pagination**：limit≤1000 上限、`is_end` 终止、`seen`/`visited` 双 Set 防重复页、循环防环
- **Completeness**：hot / search / question / answer-detail / answer-comments（**含 reply 层级**，replies-limit）/ collections / collection / follow / followers / following / user / pins / recommend / download / like / favorite / comment / answer（写）
- **Dependency footprint**：Node ≥20.18，runtime deps 8 个（readability/cli-table3/commander/js-yaml/turndown/undici/ws）；**全量依赖成本高**（181 个 clis + extension）；仅复用 zhihu read adapter 需评估裁剪

**结论：值得作为 Browser Session Provider dependency / adapter 候选**。A（Cookie copy → our process → signed Web API）与 B（existing browser session → browser-context request → canonical adapter）比较：
- **安全性**：B 更优 —— cookie 永不离开浏览器进程，无落盘/argv/log 泄漏面；A 在现有安全模型下已属安全（白名单+redaction），但凭据仍在我们的进程内。若未来需要 write 或高防风控场景，B 是更稳路径
- **复杂度**：B 引入 extension+daemon+WS 三件套（显著复杂度）；A 保持纯 HTTP 进程内（低复杂度）
- **可靠性**：B 依赖浏览器窗口生命周期（daemon 保活、扩展权限）；A 依赖签名协议稳定性（x-zse-96 轮换风险）
- **建议 disposition**：`Browser Session read adapter = ADAPT_CANDIDATE`（仅当未来需要 write/风控豁免才整包引入）；`Network redaction 思路 = REFERENCE`；`Write commands = REJECT_CURRENT_SCOPE`（本项目无写能力需求，且 Level 0 安全要求更高）

### E2. Xiaofan629/zhihu-cli
- **Maintenance**：2026-04-12 后无提交（5 个月 inactive）；3 个测试文件（390 行）
- **License**：Apache-2.0 ✅
- **Architecture**：Python TUI（click+rich+aiohttp）；命令：question/answer/article/pin/user/search/hot/collections/interactions（含写：vote/follow/unfollow）
- **Security**：❌ **不符合 Level 0**：`browser-cookie3` 直接读 Chrome/Firefox/Edge/Brave Cookie DB；credential 落盘 `~/.zhihu-cli/credential.json`（明文，7 天 TTL）；**best-effort fallback**（网络验证失败时静默用 saved credential）；手动 `login --z-c0 <cookie>`（cookie 进 argv）
- **Completeness**：structured envelope `{ok, schema_version, data/error}`（**值得借鉴**）；normalized payloads（**值得借鉴**）；评论只到一级（无 reply 层级）
- **Disposition**：`Structured output envelope = REFERENCE/ADAPT`；`Content normalization = REFERENCE`；`Auth persistence = REJECT_AS_IS`（browser-cookie3 + 落盘 + fallback 三重违反）；`整体 = REFERENCE_ONLY`

### E3. dawnswwwww/zhihu-cli
- **Maintenance**：2026-06-29 后无提交（2 个月 inactive）；tests/cli.rs + integration.rs + mocked_api.rs（mock server 模式）
- **License**：MIT ✅
- **Architecture**：Rust（clap+reqwest+serde），**纯官方 OpenAPI HTTP 直连**（search zhihu/global + ask zhida + hot）；`build_request` 纯函数 + `handle_with_client` 可注入 client（**测试性设计优秀，值得借鉴**）；Limit 边界 clamp 硬编码在测试中
- **Security**：⚠️ `auth set-secret <SECRET>` 走 **argv**（secret-in-argv 泄漏面，本项目禁止）；`auth login` 走 stdin 交互（✅）；config.toml 0600 ✅
- **Disposition**：`Official HTTP adapter 架构 = ADAPT_CANDIDATE`（thin client + 可测纯函数模式）；`argv secret = REJECT`；`整体 = REFERENCE`

### E4. klarkxy/zhihu-search
- **Maintenance**：活跃（2026-08-24 v1.6.0）；**覆盖面最全**：search/global/ask/trending/user_contents/followees/collections/favlists/favlist_contents/knowledge(4)/pdf(3)/ppt(2)/quota/OAuth 辅助
- **License**：**SATA 2.0（The Star And Thank Author License，自定义）** ⚠️ —— 非 OSI 标准；"GitHub 开源 ≠ 可直接复制"，复制代码需保留署名+致谢要求；**不推荐作为代码复用来源，仅参考**
- **Architecture**：Python（httpx+fastmcp）；UpstreamClient 协议抽象（base.py）+ 错误分类 `McpError`（TokenInvalid/RateLimited/UpstreamUnavailable/Timeout 等 JSON-RPC code 映射）+ 本地 quota 熔断器（RateLimited 触发冷却）+ 参数上下界常量表（文档驱动）
- **Security**：credentials.py env→`~/.config/zhihu-search/credentials.json`（明文，作者明确论证"Bearer 低权限无需加密"——立场合理但与本项目凭据安全标准不同）；无 browser 读取；`--save-token` stdin 优先
- **Disposition**：`Capability coverage 清单 = REFERENCE`；`错误码→异常映射 = REFERENCE/ADAPT`；`quota 熔断 = REFERENCE`；`License = 不可复用代码`；`整体 = REFERENCE_ONLY`

### E5. zly2006/zhurl
- **Maintenance**：仅 README 更新（无近期功能提交）；单文件 `src/main.rs`
- **License**：AGPL-3.0-only ⚠️（传染性；本项目 signer 上游 zhihu-plus-plus 同为 AGPL —— signer.js 已是 AGPL 派生，全仓 AGPL-3.0-only 许可证已一致）
- **Architecture**：curl-like 通用客户端（ureq+jaq 内嵌 jq 过滤）；`--web`（zhihu_sign crate 签名）/`--android`（无签名）；从 `~/.zhihu-plus-plus/account.json` 读 cookie（zhihu-plus-plus 浏览器扩展生成）
- **Value**：**非官方 API 文档索引**（docs/apis/*.md，3395 行，含 account/feeds-search-history/content/people/interactions/daily）—— 对 Session/Web 能力边界发现有用
- **Disposition**：`API 文档索引 = REFERENCE`；`签名实现 = 已有上游（不新增）`；`整体 = REFERENCE_ONLY`

**Reference-only 对照**：`zly2006/zhihu-plus-plus`（AGPL-3.0，Android+desktop，zse96 v2 签名权威上游，当前 signer.js 已 attribution）；`BAIGUANGMEI/zhihu-cli`（未克隆，仅记录为 reference 候选）。

---

## F. Provider Recommendation（NON-FROZEN 分层建议）

```text
LAYER 1  Official HTTP Provider        —— CANONICAL，search/hot/global/user-data/quota 直连
         （thin provider-neutral adapter；Bearer Secret；现有 official.js 升级为完整 provider）
LAYER 2  Session/Web Provider          —— CANONICAL，question/answers/comments 全量抓取（现有内核，保留）
LAYER 3  Browser Session Provider      —— OSS_CANDIDATE（OpenCLI 架构），仅当 write/风控豁免需求出现
LAYER 4  OAuth Provider                —— OWN_MINIMAL_GAP，仅当第三方应用/委派场景出现（当前产品无需求）
COMPAT   ~/.zhihu-cli/config.json 读取 —— COMPATIBILITY_SURFACE（保留，明确标注非官方 CLI 依赖）
```

**Official CLI 判定：`COMPATIBILITY_SURFACE`，不是 `CORE_PROVIDER`。** 证据：
1. 官方 CLI 的全部能力（search/global/hot/zhida/user-data/knowledge/quota）**均已有等价官方 HTTP 端点**（本轮 FIRST_PARTY_DOC 核验）；
2. CLI 的独有价值是 **agent 部署便利 + OS secret store 管理**，不是 HTTP 未公开的 capability；
3. CLI 明确"不接受 OAuth Token / 代查参数"，不能替代 OAuth Provider；
4. 引入 CLI = 增加 `Our Process → CLI → HTTP → Zhihu` 中间层，违反 THIN_DATA_LAYER / ADAPTER_FIRST。
唯一例外条件：若未来真实 smoke 证明官方 HTTP 的 pagination 或错误契约不足（如 global_search HasMore 无 next 语义、user collections 无分页），再重新评估 CLI 是否提供独有 pagination。

---

## G. P0 Unknowns Remaining（真正阻塞后续 Spec 的 UNKNOWN）

| # | UNKNOWN | 影响 | 最小补证据动作 |
|---|---|---|---|
| G1 | 官方 zhihu_search 参数 `Count` vs 当前代码 `limit` 的兼容性 | 决定 Official HTTP adapter 是否需改动现有 official.js | 1 次真实 smoke：用现有 Secret 分别以 `Count`/`limit` 各发 1 请求对比返回（**credential 不进入报告**） |
| G2 | global_search 的 `HasMore=true` 时如何取下一页（文档未给 next 参数） | Global Search adapter 分页合同 | 官方文档/真实 smoke 确认；若官方无分页则 adapter 单页+filter 组合 |
| G3 | 官方 user collections（近期收藏）无分页参数，长列表截断行为 | User data adapter 完整性 | 官方文档确认或 smoke 采样（sampled evidence，不升级 global claim） |
| G4 | 官方 CLI 二进制未实测（SKILL 包能力是否与文档一致） | CLI 判定是否需升级 CORE_PROVIDER | 下载 skill zip 静态检查（不安装/不运行）；如证据不足维持 COMPATIBILITY_SURFACE |
| G5 | OAuth 精确语义（scope 申请清单、token 有效期、刷新机制） | OAuth Provider 设计 | 官方无公开完整文档 → 维持 UNKNOWN，**不作为当前 Spec 前置**（当前产品无第三方委派需求） |
| G6 | Browser Session security boundary（OpenCLI daemon 端口暴露面、扩展权限模型） | 是否采纳 Browser Session Provider | 仅当 L3 需求出现时专项审计；当前不阻塞 |
| G7 | 评论全量/层级是否进入产品（Top3 vs full tree） | Comment capability scope | 产品决策（非 evidence）；默认维持 Top3 合同 |
| G8 | Poll / 投票结果支持 | 产品 scope | 维持 UNKNOWN + 不进入当前 scope（与 video 同类处理） |
| G9 | 工作区 44 文件物理缺失 + local/remote master 漂移 | 任何后续 git 操作前置条件 | 独立授权恢复任务（`git restore` from HEAD 对象，index 完好低风险）+ fetch 核验 remote |

---

## H. Evidence Gate Status

```text
TRACK_A_PASS_2 = COMPLETE
  - Official platform：developer.zhihu.com 文档中心 24 个文档页经浏览器实测（FIRST_PARTY_DOC），
    覆盖鉴权/CLI/搜索×3/直答/热榜/知识库/小工具/用户数据×6/额度查询/官方 Skill+MCP 目录
  - OSS：5 个候选仓库真实源码审计（非 README）+ zhihu-plus-plus 对照；本机临时克隆已清理
  - Current toolkit：基于 HEAD 对象库真实源码（工作区文件缺失，从 git show 读取），
    结合产物 schema 实测（out/439521858）+ 既有测试/T4/T5 证据
  - 未执行项：官方 CLI 二进制未下载（G4）；无真实网络 smoke（本轮禁止带 credential 运行）

SPEC_PREPARATION_GATE = READY
  - 理由：Track A 已产出足够证据支撑下一阶段设计（capability 边界、provider 分层、
    OSS 取舍均已 evidence-grounded）；P0 unknowns 均为可最小补证据的 bounded 项，
    不阻塞 Track B benchmark design 本身
```

---

## I. Proposed Next Step（仅建议，不执行）

**进入 Track B Benchmark Design**：以官方 HTTP 为基准建立 provider-neutral 能力基准（每 capability 的 input/output/limit/pagination/error contract 测试矩阵），候选基准：dawnswwwww 的 `build_request` 纯函数 + `handle_with_client` 注入模式（MIT，可借鉴）与 klarkxy 的错误码→异常映射 + quota 熔断（仅参考，SATA license 不可复制代码）。

Track B 前置的最小证据补全（在 Spec 书写前完成，均为 bounded 动作）：G1（Count/limit 兼容 smoke）→ G2（global_search 分页）→ G3（collections 截断）。G4–G9 不阻塞 Track B，但 Spec 前需对 G4/G9 有明确处置。

**明确不执行**：不写 Spec、不创建 Issue/branch/PR、不进入生产实现、不自动 Reviewer。等待用户将本 packet 交 ChatGPT 正式审查。

---

```text
REVIEWED_BASE      : c9ff7b045737c2eddd4a5799702d720ade844a6d（HEAD；remote 84534f5 未 fetch 至本地对象库）
WORKSPACE_STATE    : DIRTY（44 deleted + 2 untracked；本轮未修改）
THIS_ROUND_EDITS   : NONE（production read-only）
TRACK_A_PASS_2     : COMPLETE
SPEC_PREP_GATE     : READY
NEXT_STEP          : Track B Benchmark Design（等待用户交 ChatGPT 审查）
```

等待你的指令 —— 在 ChatGPT 正式审查通过前，本轮到此 STOP。