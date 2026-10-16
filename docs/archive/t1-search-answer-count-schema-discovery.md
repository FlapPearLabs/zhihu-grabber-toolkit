# T1 — Search Answer Count Schema Discovery（证据报告）

> **Branch:** `spike/search-answer-count-schema`
> **Base:** `234a315000ccf9bdbb16f217c39914389aecf036`（T1 执行时真实 remote master，`git ls-remote origin refs/heads/master` 独立核验）
> **Date:** 2026-08-22
> **Status:** `READY` → discovery 完成，待独立 review
> **Tracker:** #6 / **Issue:** #7
> **Type:** DISCOVERY / EVIDENCE（无生产代码变更）

---

## 1. 结论（恰好一个）

```text
NO_DIRECT_ANSWER_COUNT_FIELD_OBSERVED_IN_SAMPLED_SEARCH_RESPONSES
```

在 sampled 官方 `developer.zhihu.com/api/v1/content/zhihu_search` 响应中，**未观察到**代表「问题回答数量」的可信直接字段。

**范围声明（防过度推断）**：这是 3 次搜索 / 30 个 Item 的采样观察，**不是**「官方 API 永远不会返回该字段」的穷举证明。`UPSTREAM_SCHEMA_STATUS` 由 `UNKNOWN / DISCOVERY_REQUIRED` 更新为 **`NO_DIRECT_FIELD_OBSERVED_IN_SAMPLE`**（语义等同 V0.3 Spec §3.1 的采样事实，不声称 schema 级否定）。

## 2. Method（方法）

1. **preflight**：`node zhihu-answer-grabber/scripts/preflight.mjs --json` → `cookie.usable: true`（local_file）、`secret.usable: true`。仅记录布尔可用性，不输出/不读取任何凭据值。
2. **搜索**：使用现有 `searchQuestions()`（`zhihu-answer-grabber/src/official.js`，未修改生产代码），3 个普通中文关键词，`limit=10`：
   - `机器学习` / `旅行攻略` / `Python 教程`
   - 共 **3 次** search 调用（预算 `normally 3, maximum 5`，未超）。
3. **schema inventory**：对每个 Item 递归收集结构（**只记录 key path / value type / 出现计数**，递归深度 ≤ 4，不记录任何值内容），汇总 30 个 Item 的 key 分布。
4. **候选字段扫描**：key 名匹配 `answer|count|reply|response|statistic|metric`（大小写不敏感）。
5. **交叉验证**：对候选 numeric 字段，取带 question URL 的 Item（qid），用既有 `buildQuestionInfoUrl()` + `requestJson()`（`http.js`，签名 Cookie 通道）取 `answer_count` / `comment_count` 做语义对照。补充阶段再花 **1 次** search 调用（`旅行攻略`，总数 3+1=4 ≤ 5）修正 qid 对齐后完成 5 个 qid 的交叉验证。
6. 无浏览器抓取、无 raw-response 提交、无生产行为变更。

## 3. Sample counts（样本统计）

| 关键词 | Items | 可提取 question URL 的 Items |
|---|---|---|
| 机器学习 | 10 | 1 |
| 旅行攻略 | 10 | 5 |
| Python 教程 | 10 | 3 |
| **合计** | **30** | **9** |

- 30/30 Item 的 schema 结构已入库（key path / type / occurrence）。
- 交叉验证样本：1 个关键词（旅行攻略）10 个 Item 中 5 个带 qid，全部完成 question-info 对照；另附该关键词的 ContentType 分布（`Article: 5` / `Answer: 5`）。
- 观察：search 返回混合内容类型（含 Article / Answer），**仅部分 Item 携带可抓取的问题 URL**（30 个中 9 个）。

## 4. Safe schema inventory（安全 schema 清单，30/30 出现）

仅记录结构（key path / type / 出现计数），不含任何值内容：

```text
AuthorAvatar       string  x30
AuthorBadge        string  x30
AuthorBadgeText    string  x30
AuthorityLevel     string  x30
AuthorName         string  x30
CommentCount       number  x30
ContentID          string  x30
ContentText        string  x30
ContentType        string  x30
EditTime           number  x30
RankingScore       number  x30
Title              string  x30
Url                string  x30
VoteUpCount        number  x30
CommentInfoList    array   x11   (嵌套: .0/.1/.2 对象, 各含 Content string)
```

- 递归深度 ≤ 4；`CommentInfoList` 是唯一嵌套结构（数组元素对象含 `Content` string，未深入更深层）。
- **未观察到**任何名为 `AnswerCount` / `AnswerCount*` / `answer_count` / `Answers` / `RepliesCount` 之类的字段。

## 5. Candidate-field analysis（候选字段语义分析）

匹配 `answer|count|reply|response|statistic|metric` 的字段仅 2 个：

| 字段 | Type | 出现率 | 语义判断 |
|---|---|---|---|
| `CommentCount` | number | 30/30 | 评论数（comment count）。字段名与 question-info `comment_count` 语义一致（见 §6 交叉验证）。**不是回答数。** |
| `VoteUpCount` | number | 30/30 | 内容点赞数（vote-up count）。对 Answer 类型 Item 是该回答的点赞数。**不是回答数。** |

- `RankingScore` 是搜索排序分数（未命中 count token，但即便命中也不代表回答数；此处顺带记录，不展开）。
- **无** `statistics` / `metrics` / `reply` / `response` 结构。

## 6. Cross-check（交叉验证，5 个 qid vs question-info）

用 question-info（`/api/v4/questions/{qid}?include=...answer_count,comment_count...`，签名 Cookie 通道）对照：

| qid | search.CommentCount | search.VoteUpCount | info.answer_count | info.comment_count | 结论 |
|---|---|---|---|---|---|
| 2019876119994742446 | 1 | 0 | 19 | 0 | CommentCount 非回答数（1≠19）；VoteUpCount 非回答数（0≠19） |
| 1895978524164199182 | 0 | 0 | 6 | 0 | 均非回答数（0≠6） |
| 544632596 | 0 | **1** | 1 | 0 | VoteUpCount=1 与 answer_count=1 **数值巧合**（该问题仅 1 回答且该回答恰 1 赞）；字段名/语义为点赞数，不构成回答数字段证据 |
| 549115287 | 0 | 0 | 2 | 0 | 均非回答数 |
| 419972457 | 0 | 0 | 10 | 0 | 均非回答数 |

- **4/5** 明确否定两个 count 字段与 answer_count 等价；**1/5**（544632596）仅数值相等（`1=1`），但因字段名与语义（该回答点赞数）与「问题回答数」不兼容，不视为回答数字段。CommentCount 与 info.comment_count 在 4/5 样本一致（`COMMENT_COUNT` 语义），佐证其为评论数。
- 无任何 search Item 字段在所有样本上与 `answer_count` 系统性一致。

## 7. Final result

```text
RESULT: NO_DIRECT_ANSWER_COUNT_FIELD_OBSERVED_IN_SAMPLED_SEARCH_RESPONSES
```

（不把采样未观测写成「API 永远没有此字段」；不改变生产代码。）

## 8. OPEN-D1 impact

```text
OPEN-D1_DECISION_REQUIRED
```

官方 search Item schema 在采样中无直接回答数字段 → 决策 A 第二优先路径（question-info `answer_count` 补充）成为候选，但**不得默认静默引入**。以下为证据（**evidence only，不决策**）：

- **question-info 是否需要 Cookie**：**是**。question-info 走 `www.zhihu.com` 签名认证通道（`http.js buildQuestionInfoUrl` + `buildSignedHeaders`，需要 `loadConfig()` 的 Cookie + `d_c0` 签名）。与 search（仅 Access Secret，`developer.zhihu.com` Bearer 通道）**不同凭据面**。
- **每候选请求增量**：**每候选 1 次** question-info 请求（`NETWORK_REQUEST_DELTA = +1/candidate`）。当前 `cmdSearch` 输出 `unique` 后 `slice(0, 10)`（默认候选上限 **10**），最坏 10 次/question-info 请求；无批量 question-info 聚合路径（当前仓库无批量接口调用）。
- **失败语义可行性**：可复用 V2 §20.2 enrichment 语义——单候选 question-info 失败仅使该候选 `answerCount: null`，不拖累整个 search 命令；缺失/`null` 优于虚构（决策 A.3 铁律）。
- **隐私 / 风控 / 成本影响**：引入携带 Cookie 的认证请求面扩大（每候选 1 次签名请求，10 候选 → +10 请求）；cookie 认证面比 search 的 secret 面更接近登录态，风控观察面更大；成本（请求数、延迟）随候选数线性增长。需要产品决策的是：**是否接受该请求面/凭据面扩大**、**每次 search 的 question-info 请求预算上限**。
- **batch question-info path**：**不存在**（当前实现无批量 question-info 聚合调用；grabber 是逐问题 1 次）。

## 9. Request / credential impact（本 T1 自身）

- search 调用：4 次（3 次主 discovery + 1 次 cross-check 对齐），在 `normally 3, maximum 5` 预算内。
- question-info 调用：5 次（交叉验证 5 个 qid），每次间隔 `humanDelay`（1.5–4s），low-frequency。
- 凭据：仅通过既有 `resolveSecret()` / `loadConfig()` 读取；任何凭据值未打印、未落盘、未进报告。

## 10. Security statement

```text
NO_SECRET_DISCLOSED
NO_COOKIE_DISCLOSED
NO_RAW_SEARCH_RESPONSE_COMMITTED
NO_UNTRUSTED_TEXT_PERSISTED
```

- 未输出/未提交任何 secret / cookie 值。
- 未提交任何 raw search response；`out/t1-discovery/`（含中间 JSON）位于 gitignored `out/`，不入库。
- 报告不含任何 Title / ContentText / Content / AuthorName 等不可信字符串；仅含 key path / type / 计数 / 数值型交叉验证结果。

## 11. 下一步（非本 T1 范围）

- **OPEN-D1 决策包已整理（§8）**：由用户/产品方拍板是否接受 question-info `answer_count` 补充（请求面/凭据面扩大）及预算上限；用户批准前**禁止**进入 fallback T2。
- T1 本票待独立 review：exact HEAD 为本文档 commit 后的分支 HEAD（见 handoff）。

---

*End of T1 report.*
