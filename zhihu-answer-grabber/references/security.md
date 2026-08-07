# 凭据安全与 401/403 诊断

## 1. 凭据安全硬性规则

1. **绝不要求用户把完整 Cookie、Secret、Token 或登录凭证粘贴到聊天中。**
2. **绝不把凭据写入**：对话、日志、Markdown、JSON 产物、长期记忆、临时任务报告、Git。
3. Agent 只能检查凭据是否已本地配置（运行 `scripts/preflight.mjs`），**不得输出凭据内容**——包括值、长度、前缀、哈希、部分截断。
4. 缺少凭据时：停止抓取，提供本地配置说明（见下），不要求用户贴出凭据。
5. 不得替用户打开、展示或复制凭据文件内容。
6. 凭据文件（`zhihu_cookie.txt` / `zhihu_secret.txt`）已由 `.gitignore` 屏蔽；Agent 不得手动 `git add` 这些文件。

## 2. 本地配置说明（缺少凭据时提供给用户）

**Cookie（抓取必需，需包含 `z_c0` 与 `d_c0`）：**

1. 用浏览器登录 zhihu.com。
2. 打开开发者工具 → Application（应用）→ Cookies → `https://www.zhihu.com`。
3. 复制完整 Cookie 到项目目录的 `zhihu_cookie.txt`（或设置环境变量 `ZHIHU_COOKIE`）。
4. 全程在本地完成，无需把 Cookie 发给任何人。

**Access Secret（仅 search 需要）：**

- 在知乎开放平台个人中心获取，保存到 `zhihu_secret.txt`（或环境变量 `ZHIHU_SECRET`）。

**验证配置是否就绪：**

```bash
node scripts/preflight.mjs
```

预期输出：

```
cookie_configured: true
cookie_usable: true
secret_configured: false
secret_usable: false
config_source: local_file
cookie_error: none
secret_error: missing
```

只输出布尔值与错误类型，不含凭据内容。

**凭据文件权限：** POSIX 系统上 `zhihu_cookie.txt` / `zhihu_secret.txt` 必须为 `0600`（仅当前用户可读写），否则 loader 会拒绝读取。创建方式：

```bash
touch zhihu_cookie.txt zhihu_secret.txt
chmod 600 zhihu_cookie.txt zhihu_secret.txt
# 再在本机编辑这两个文件写入凭据
```

Windows 无此权限检查，但同样不要把凭据文件提交到 Git。

## 3. 401/403 诊断（只输出已验证候选）

遇到 401/403 时，**不武断归因**。按以下方式输出：

1. **已验证事实**：HTTP 状态码、请求目标主机、重试是否已发生。
2. **候选原因**（并列给出，不唯一化）：
   - Cookie 过期或无效（401 常见）。
   - Cookie 缺少必需字段（`z_c0` / `d_c0`）。
   - 请求频率过高触发风控（403 常见）。
   - 网络出口变化（仅作为候选，不做 IP 类型判断）。
3. **已排除项**（仅当有证据时）：如 `preflight` 显示 `cookie_usable: true`，则可排除"未配置/不可用"。

**禁止的表述：**

- "这是因为你的代理/Clash/IP 类型问题"（无证据）。
- "cookie 一定过期了"（未验证）。
- 任何指向具体端口、出口 IP 或网络环境的归因。

## 4. 代理与网络边界

- 默认不修改代理环境变量（`HTTP_PROXY` / `HTTPS_PROXY`）。
- 代码层强制：仅向 `https://www.zhihu.com` 携带 Cookie 与签名（主机白名单 + HTTPS 校验），其他主机一律拒绝。
- 若用户主动配置了代理且遇到网络问题，**提示用户检查其代理设置**（提示，不是归因），并建议在无代理或正确代理配置下重试。

## 5. 输出/日志卫生

- 任何错误信息不得包含 Cookie 值或 Secret 值。
- 请求失败的错误消息只含 URL 主机与状态码，不含查询参数中的敏感信息（本工具查询参数不含凭据）。
- 产物（JSON/Markdown）不含凭据字段。
