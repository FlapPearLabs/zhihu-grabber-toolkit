# zhihu-answer-grabber 使用参考

## 命令一览

| 命令 | 说明 |
|---|---|
| `grab <问题链接或ID> [--out-dir <dir>]` | 抓取单题全部回答（支持断点续传，中断重跑自动续） |
| `batch <file.txt> [--out-dir <dir>]` | 每行一个问题链接/ID，批量顺序抓取 |
| `search <关键词> [--grab]` | 官方开放平台搜索问题；默认只列候选，`--grab` 仅供人类终端使用（Agent 禁止） |
| `status [--out-dir <dir>]` | 查看产物目录下的抓取与验收状态 |

通用选项：

- `--json`：机器可读输出。stdout 只输出**单一合法 JSON 文档**，不混入人类日志；错误同样结构化（`ok:false` + `error.type/message`）。
- `--out-dir <dir>`：产物目录（默认 `./out`）。与凭据目录 `ZAG_CONFIG_DIR`、当前工作目录 cwd 三者解耦。

统一入口：

```bash
node "<SKILL_ROOT>/scripts/zhigrab.mjs" <命令> [参数]
```

其中 `<SKILL_ROOT>` = 本 Skill 所在目录（含 `SKILL.md` 的目录，Agent 加载 Skill 时已知其位置）。**Agent 必须用绝对路径调用所有脚本，不得假设当前工作目录恰好是 Skill 目录**；`cwd` 仍用于默认 `out/` 输出位置与本地凭据目录（或 `ZAG_CONFIG_DIR` / `--out-dir` 显式指定），与脚本位置互不相关。

（等价于直接运行 `src/cli.js`；wrapper 会用 `import.meta.url` 自动定位 `src/cli.js`，也可用 `ZAG_DIR` 覆盖工具目录。）

## 状态语义（captured vs verified）

**两个概念必须严格区分，不能用"完成"模糊覆盖：**

| 状态 | 含义 | 由谁授予 |
|---|---|---|
| `captured` | 抓取阶段结束：产物（answers.json/answers.md/.progress.json）已写入磁盘 | `grab` / `batch` 写入后即为 captured |
| `verified` | 产物通过完整验收：JSON 可解析、ID 无重复、md/json 一致、done=true、无损坏残留 | **只有 `verify-output.mjs`（valid === true）** |

- `grab` 输出 `stage: "captured"`、`verified: false`——**grab 从不自行声称验收通过**。
- `status` 分别报告 `captureStatus`（`in_progress` / `captured`）与 `verificationStatus`（`unverified` / `valid` / `invalid`）。
- `progress.done === true` 只表示分页循环结束，**不等于** `verified`。

## JSON 机器契约

```bash
# 抓取：stage=captured, verified=false
node "<SKILL_ROOT>/scripts/zhigrab.mjs" grab 123 --json
# → {"schemaVersion":1,"ok":true,"command":"grab","stage":"captured","questionId":"123",
#    "questionTitle":"...","capturedAnswerCount":247,
#    "artifacts":{"json":"out/123/answers.json","markdown":"out/123/answers.md","progress":"out/123/.progress.json"},
#    "verified":false,"warnings":[]}

# 搜索：候选数组（已去重、过滤非知乎 URL、清除控制字符）
node "<SKILL_ROOT>/scripts/zhigrab.mjs" search "浏览器词典" --json
# → {"schemaVersion":1,"ok":true,"command":"search","query":"...","candidates":[
#      {"questionId":"123","title":"...","contentType":"...","url":"https://www.zhihu.com/question/123"}]}

# 批量：succeeded[] / failed[]，任一失败退出码非 0
node "<SKILL_ROOT>/scripts/zhigrab.mjs" batch list.txt --json

# 状态：captureStatus + verificationStatus 分离
node "<SKILL_ROOT>/scripts/zhigrab.mjs" status --json
# → {"schemaVersion":1,"ok":true,"command":"status","items":[
#      {"questionId":"123","capturedAnswerCount":247,"captureStatus":"captured","verificationStatus":"valid"}]}

# 错误：结构化
# → {"schemaVersion":1,"ok":false,"command":"grab",
#    "error":{"type":"configuration_error","message":"..."}}
```

错误类型枚举：`configuration_error` / `invalid_input` / `network_error` / `http_error` / `question_metadata_identity_conflict` / `unknown_error`（`ConfigError.errorType` 优先复用）。

**规则：**

- JSON 模式 stdout 必须可直接 `JSON.parse`，不混入 `✓` / `▶` / 进度日志 / ANSI。
- 路径一律相对路径（相对当前工作目录），不泄漏绝对本机路径。
- 不输出 Cookie / Secret / Token 内容。
- `verified` 只能由 `verify-output.mjs` 置 true；`grab` / `batch` 永远输出 `verified: false`。

## handoff 生成（机器）

```bash
node "<SKILL_ROOT>/scripts/make-handoff.mjs" out/123 --task digest|archive|inspect
```

- 只接受 `verify-output` `valid === true` 的产物；未通过验证则拒绝生成。
- 输出 `out/123/handoff.json`（`verified: true`、`answerCount`、`questionId` 均由代码从已验证产物构建）。
- 详情见 `handoff-schema.md`。

## 凭据来源（本地配置，三选一，优先级从高到低）

1. 环境变量 `ZHIHU_COOKIE`（完整 cookie 字符串）
2. 凭据目录下 `zhihu_cookie.txt`（默认当前目录，可用 `ZAG_CONFIG_DIR` 指定）
3. `~/.zhihu-cli/config.json`（zhihu-cli 登录产物）

**Access Secret（仅 search 需要）：**

- 环境变量 `ZHIHU_SECRET` 或凭据目录下 `zhihu_secret.txt`（开发者平台个人中心获取）

**配置方法（不经过聊天）：**

- Cookie：浏览器登录 zhihu.com → F12 → Application → Cookies → 复制含 `z_c0` 与 `d_c0` 的完整 cookie 到 `zhihu_cookie.txt`（本地操作，不粘贴到对话）。POSIX 下记得 `chmod 600 zhihu_cookie.txt`。
- Secret：复制开发者平台获取的 Access Secret 到 `zhihu_secret.txt`。

**安全规则（硬性）：**

- 绝不把凭据粘贴到聊天、日志、Markdown、JSON 产物、长期记忆或 Git。
- Agent 只能运行 `"<SKILL_ROOT>/scripts/preflight.mjs"` 检查凭据是否已配置且可用（`cookie_usable` / `secret_usable`），不得读取或展示凭据内容。
- 凭据文件已由 `.gitignore` 屏蔽，切勿提交。

## 输出文件

```
out/<问题ID>/answers.json      # 结构化：题目元信息 + 回答数组
out/<问题ID>/answers.md        # 可读：按赞数倒序
out/<问题ID>/.progress.json    # 断点续传状态
```

## answers.json 字段

`questionId / questionTitle / answerCount / fetchedAt / answers[]`

回答对象：`id / author / url / content(HTML) / excerpt / voteupCount / commentCount / createdTime / updatedTime`

## 错误处理

| 现象 | 已验证的处理（非归因） |
|---|---|
| 退出码非 0 且提示缺少 Cookie | 凭据未配置或配置无效。先运行 `"<SKILL_ROOT>/scripts/preflight.mjs"` 确认：`cookie_configured: false` → 未配置，按"配置方法"本地配置；`cookie_configured: true` 但 `cookie_usable: false` → 存在但不可用（按 `cookie_error` 类型处理：symlink/permission/缺 `z_c0`/缺 `d_c0`）。 |
| HTTP 401 | 事实：知乎返回 401，认证请求未被接受。候选原因：Cookie 过期或无效、配置来源错误等，**具体原因尚未确定**。让用户**本地**重新复制 cookie 更新 `zhihu_cookie.txt`（不粘贴到聊天），或检查配置来源。 |
| HTTP 403 | 事实：知乎返回 403，请求被服务器拒绝。候选原因：凭据、签名协议、请求上下文、账号权限或风控，**具体原因尚未确定**。可稍后重试，或确认请求频率未超过限速；不武断归因于代理或 IP 类型。 |
| HTTP 429 | 触发限速退避，等待后重试（CLI 已实现指数退避 + 抖动）。 |
| 抓取数 < 问题页显示总数 | 见 `verification.md` 的"数量不一致处理"：页面统计值与接口可获取数量不一致，原因尚未确认。 |
| 未找到 zhihu-cli 配置 | 用 cookie 方式（前两种来源）即可，无需安装 zhihu-cli。 |
| 断点续传不生效 | 每次成功保存 answers.json + .progress.json，中断后重跑同命令即续传。 |

## 关键实现说明

- `x-zse-96` 请求签名：由 `src/signer.js` 计算（移植自开源 zhihu-cli，AGPL-3.0），不需要额外服务。
- 限速：每页随机延迟 1.5–4 秒；429/5xx 指数退避重试 2 次。
- 只读操作：抓取、搜索、查看进度，不包含任何写操作（点赞/评论等）。
- 网络边界：仅向 `www.zhihu.com` 携带 Cookie 与签名（代码层强制白名单）；默认不修改代理环境变量。
