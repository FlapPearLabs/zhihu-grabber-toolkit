# zhihu-answer-grabber 使用参考

## 命令一览

| 命令 | 说明 |
|---|---|
| `grab <问题链接或ID>` | 抓取单题全部回答（支持断点续传，中断重跑自动续） |
| `batch <file.txt>` | 每行一个问题链接/ID，批量顺序抓取 |
| `search <关键词> [--grab]` | 官方开放平台搜索问题；`--grab` 仅在用户明确要求"抓第一个结果"时使用 |
| `status` | 查看 out/ 下已抓取内容与进度 |

统一入口：

```bash
node scripts/zhigrab.mjs <命令> [参数]
```

（等价于直接运行 `src/cli.js`；wrapper 会自动定位工具目录，也可用 `ZAG_DIR` 覆盖。）

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
- Agent 只能运行 `scripts/preflight.mjs` 检查凭据是否已配置且可用（`cookie_usable` / `secret_usable`），不得读取或展示凭据内容。
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
| 退出码非 0 且提示缺少 Cookie | 凭据未配置或配置无效。先运行 `scripts/preflight.mjs` 确认：`cookie_configured: false` → 未配置，按"配置方法"本地配置；`cookie_configured: true` 但 `cookie_usable: false` → 存在但不可用（按 `cookie_error` 类型处理：symlink/permission/缺 `z_c0`/缺 `d_c0`）。 |
| HTTP 401（凭证失效） | 候选原因：Cookie 过期或无效。让用户**本地**重新复制 cookie 更新 `zhihu_cookie.txt`（不粘贴到聊天）。也可能是配置来源错误（如误用 Secret 文件）。 |
| HTTP 403 | 候选原因：请求被风控拦截。候选：Cookie 无效、请求频率过高、网络出口变化。**不武断归因于代理或 IP 类型**。可稍后重试，或确认请求频率未超过限速。 |
| HTTP 429 | 触发限速退避，等待后重试（CLI 已实现指数退避 + 抖动）。 |
| 抓取数 < 问题页显示总数 | 见 `verification.md` 的"数量不一致处理"：页面统计值与接口可获取数量不一致，原因尚未确认。 |
| 未找到 zhihu-cli 配置 | 用 cookie 方式（前两种来源）即可，无需安装 zhihu-cli。 |
| 断点续传不生效 | 每次成功保存 answers.json + .progress.json，中断后重跑同命令即续传。 |

## 关键实现说明

- `x-zse-96` 请求签名：由 `src/signer.js` 计算（移植自开源 zhihu-cli，AGPL-3.0），不需要额外服务。
- 限速：每页随机延迟 1.5–4 秒；429/5xx 指数退避重试 2 次。
- 只读操作：抓取、搜索、查看进度，不包含任何写操作（点赞/评论等）。
- 网络边界：仅向 `www.zhihu.com` 携带 Cookie 与签名（代码层强制白名单）；默认不修改代理环境变量。
