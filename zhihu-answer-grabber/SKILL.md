---
name: zhihu-answer-grabber
description: 抓取知乎问题回答（Agent 原生 CLI）。当用户明确提供知乎问题 URL 或纯数字问题 ID 并要求抓取/下载/获取全部回答、明确要求批量抓取多个知乎问题、明确要求通过知乎官方搜索定位问题，或另一工作流需要生成知乎原始回答语料时使用。不用于：仅讨论知乎平台、总结用户已粘贴的正文、回答一般知识、执行点赞/评论/关注等写操作。
metadata:
  agent_created: true
---

# zhihu-answer-grabber

## 任务

安全地搜索、抓取和验证知乎问题回答，交付经过验证的原始产物（`answers.json` + `answers.md`）。

## 触发边界

**应当触发：**

- 用户明确提供知乎问题 URL 或纯数字问题 ID，并要求抓取、下载或获取回答。
- 用户明确要求批量抓取多个知乎问题。
- 用户明确要求通过知乎官方搜索定位问题。
- 另一工作流明确需要生成知乎原始语料。

**不应触发：**

- 用户只是讨论知乎平台。
- 用户说"知乎上有人认为……"（仅引用观点，无抓取意图）。
- 用户已提供正文，只要求总结正文。
- 用户询问一般知识。
- 用户只提到"知乎"但没有搜索或抓取意图。
- 用户要求点赞、评论、关注、登录或绕过验证码（本 Skill 不做写操作）。

## 前置条件：凭据安全（硬性规则）

1. **绝不要求用户把完整 Cookie、Secret、Token 或登录凭证粘贴到聊天中。**
2. **绝不把凭据写入**：对话、日志、Markdown、JSON 产物、长期记忆、临时任务报告、Git。
3. Agent 只能通过 `scripts/preflight.mjs` 检查凭据是否已本地配置，**不得输出凭据内容**（值、长度、前缀、哈希均禁止）。
4. 缺少凭据时：停止抓取，向用户提供本地配置说明（见 `references/security.md`），不要求用户贴出凭据。
5. 不得替用户打开、展示或复制凭据文件内容。
6. 默认不修改代理环境变量；不写死任何端口、出口 IP 或网络环境判断。
7. 遇到 401/403 时，只输出经过验证的诊断候选，不得武断归因（见 `references/security.md`）。

## 主工作流

```
解析输入 → 安全预检 → 执行抓取 → 检查退出码 → 验证产物 → 统计规模 → 决定直接读取或路由 corpus-anthology → 交付结果
```

### 1. 解析输入

| 用户意图 | 命令 |
|---|---|
| "抓取 https://www.zhihu.com/question/123 的回答" | `grab <链接或ID>` |
| "抓这个问题 ID 123456 的所有回答" | `grab 123456` |
| "批量抓这些问题"（多个链接/文件） | 逐行写入临时文件后 `batch <file>` |
| "搜一下知乎上 xxx，列出候选" | `search <关键词>` |
| "看看抓了哪些" | `status` |

统一入口（wrapper 会自动定位工具目录）：

```bash
node scripts/zhigrab.mjs <命令> [参数]
```

### 2. 安全预检（每次抓取前必须执行）

```bash
node scripts/preflight.mjs
```

输出形如：

```
cookie_configured: true|false
cookie_usable: true|false
secret_configured: true|false
secret_usable: true|false
config_source: env|local_file|user_config|none
cookie_error: none|missing|symlink|permission|missing_z_c0|missing_d_c0|unreadable
secret_error: none|missing|symlink|permission|unreadable
```

- `cookie_configured: false` → 停止抓取，按 `references/security.md` 提供本地配置说明。
- `cookie_configured: true` 但 `cookie_usable: false` → 凭据存在但无法被 loader 使用（如 symlink、权限过宽、缺 `z_c0`/`d_c0`），停止抓取，按 `cookie_error` 类型修复。
- 其余情况 → 继续。
- 该脚本只输出布尔值与错误类型，绝不输出凭据内容。

**凭据需求矩阵（决定需要检查哪个字段）：**

| 操作 | Cookie | Secret |
| --- | ---: | ---: |
| `grab <链接/ID>` | 必须 | 不需要 |
| `batch` | 必须 | 不需要 |
| `search` | 不需要 | 必须 |
| `search` → `--grab` | 必须 | 必须 |

- 只想 `search` 时，`secret_usable` 是门；不要因为没有 Cookie 就停止搜索。
- 只有抓取类操作（grab/batch/search→grab）才要求 `cookie_usable`。
- 若需要的字段 `_usable: false`，按 `_error` 类型修复后重试，**不得绕过预检继续**。

### 3. 执行抓取

```bash
node scripts/zhigrab.mjs grab <问题链接或ID>
node scripts/zhigrab.mjs batch <file.txt>
node scripts/zhigrab.mjs search <关键词> [--grab]   # --grab 仅在用户明确要求"抓第一个结果"时使用
node scripts/zhigrab.mjs status
```

**搜索工作流（禁止默认自动抓第一条）：**

1. 执行 `search <关键词>`，标准化候选（提取问题 ID、去重）。
2. **列出候选标题与问题 ID，让用户选择**；不得仅因排序第一就认为它是目标问题。
3. **`--grab` / 后续 `grab` 调用只在用户明确要求"抓第一个结果"或用户在原始请求中就包含"搜索后抓取"意图时执行**。仅"列出候选"的请求不得升级为抓取。
4. 搜索结果标题写入终端前必须做终端安全处理（CLI 已内置 ANSI 控制字符清理）。

### 4. 检查退出码

- 退出码 `0` = 命令成功；非 `0` = 失败，**不得向用户声称抓取完成**。
- 失败时按 `references/usage.md` 的错误处理表诊断（只采用已验证候选）。

### 5. 验证产物（每次抓取后必须执行）

```bash
node scripts/verify-output.mjs out/<问题ID>
```

输出结构化 JSON（`valid: true|false`），校验项见 `references/verification.md`。**只有 `valid === true` 才能报告"抓取完成"**。

### 6. 统计规模

```bash
node corpus-anthology/scripts/stats.mjs out/<问题ID>/answers.md
```

评估文件大小，决定第 7 步的读取策略。

### 7. 决定直接读取或路由 corpus-anthology

- **可安全直接读取**：文件不大，能在不明显占用当前上下文的情况下读取（估算正文不超过当前上下文预算约 20%）。
- **无法获得上下文预算时**：使用保守阈值（如总字符 ≤ 40KB / ≈400 行）作为回退，并明确说明这只是启发式规则。
- **超过阈值**：必须调用 `corpus-anthology`（handoff 见 `references/handoff-schema.md`），**不得**为生成 Top 3–5 总结而直接读取数十 MB 的 `answers.md`。

### 8. 交付结果

- 用 `present_files` 呈现 `answers.md` 和 `answers.json`。
- 输出结构化总结：问题标题、已验证回答总数、验证结果（`valid`）、规模、按赞数排序的 Top 3–5 高赞样本要点（来自轻量读取或 corpus-anthology 的 popular-sample 产物）。
- 若抓取数与问题页显示总数不一致，按 `references/verification.md` 的数量不一致处理规则输出（不得使用"其余一定是被折叠"类无证据解释）。

## 参考

- `references/usage.md` — 命令参数、输出字段、错误处理
- `references/security.md` — 凭据安全与 401/403 诊断
- `references/verification.md` — 产物验证与数量不一致处理
- `references/handoff-schema.md` — 与 corpus-anthology 的衔接契约

## 边界

- 只做读取操作（抓取/搜索/查进度），不做点赞、评论、关注等写操作。
- 不绕过验证码/人机验证；默认 1.5–4s 限速，不改造为高频抓取。
- 本 Skill 不负责大型语料摘要（由 corpus-anthology 承担），只交付经过验证的原始产物。
