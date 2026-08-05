---
name: zhihu-answer-grabber
description: 知乎回答抓取 CLI 能力（Agent 原生调用）。当用户要求抓取/爬取知乎某个问题的全部回答、批量抓取知乎问题、搜索知乎问题，或基于知乎回答内容做分析/总结时使用。Trigger keywords: 知乎, zhihu, 抓取知乎, 知乎回答, 爬知乎, 知乎问题回答, zhihu answers, grab zhihu, crawl zhihu, codex有哪些奇技淫巧 等知乎问题标题。
agent_created: true
---

# zhihu-answer-grabber

## 用途

用命令行抓取知乎**指定问题的全部回答**，输出结构化 JSON（`answers.json`）与可读 Markdown（`answers.md`）。支持断点续传、批量抓取、官方平台搜索定位问题。整个抓取使用用户真实登录 Cookie + x-zse-96 签名 + 限速重试，模拟真人浏览。

## 何时使用

- 用户给出知乎问题链接/ID/标题，要求"抓取/爬取/下载/获取全部回答"。
- 用户要求批量抓取多个知乎问题。
- 用户给出关键词，要求找到相关问题（可自动抓取）。
- 用户要求基于知乎回答内容做总结、归纳、分析——先抓取，再读取产物输出内容。

## 前置条件

- 登录凭据：工具目录下 `zhihu_cookie.txt`（或环境变量 `ZHIHU_COOKIE`，或 `~/.zhihu-cli/config.json`）。若均缺失，运行会报"缺少 Cookie"，此时**请用户提供**：浏览器登录 zhihu.com → F12 → Network → 刷新 → 第一个请求的 Request Headers 里 `cookie:` 整串。
- 不要给命令设置 `HTTP_PROXY/HTTPS_PROXY` 环境变量（本机 Clash 7897 出口是美国数据中心 IP，会被知乎 40362 风控；node fetch 默认直连住宅 IP，无需代理）。

## 工作流

1. **解析自然语言需求**，按下表映射到命令：
   | 用户意图示例 | 执行命令 |
   |---|---|
   | "抓取 https://www.zhihu.com/question/2063557784394785882 的回答" | `grab <链接>` |
   | "抓这个问题 ID 123456 的所有回答" | `grab 123456` |
   | "批量抓这些问题"（用户给了多个链接/文件） | 把链接逐行写入临时文件后 `batch <file>` |
   | "搜一下知乎上 xxx" | `search xxx`（若用户还想直接抓，加 `--grab`） |
   | "看看抓了哪些" | `status` |

2. **调用工具**（必须用 wrapper，它会自动定位工具目录并切到含 cookie 的目录）：
   ```
   node scripts/zhigrab.mjs <命令> [参数]        # 在 zhihu-answer-grabber/ 目录下运行
   ```
   等价于直接跑 `src/cli.js`（wrapper 会自动定位到本仓库的 `zhihu-answer-grabber/` 根目录）。

3. **抓取完成后的输出（必须执行）**：
   - 读取产物 `out/<问题ID>/answers.md`（或 `answers.json`）——产物位于仓库的 `zhihu-answer-grabber/out/<问题ID>/`（运行后生成）。
   - 用 `present_files` 把 `answers.md` 和 `answers.json` 呈现给用户。
   - **输出内容**：给用户一段结构化总结，包含：问题标题、抓取回答总数、按赞数排序的 Top 3–5 回答要点（作者 + 核心观点，从正文中提炼）、以及（若用户要求）按主题归纳的技巧清单。
   - 若抓取数与问题页显示总数不一致，说明"其余为被折叠/仅关注者可见，接口侧不可见"。

4. **隐私处理**：cookie 文件为敏感凭证，只存在于工具目录，不写入长期记忆；用户可随时删除。

## 详细参考

命令参数、cookie 来源、输出字段、错误排查见 `references/usage.md`。抓取逻辑报错时按该文件的"常见错误排查"表处理（40362=代理问题、401/403=cookie 过期等）。

## 边界

- 只做读取操作（抓取/搜索/查进度），不含点赞、评论、关注等写操作。
- 不绕过验证码/人机验证；默认 1.5–4s 限速，勿改造成高频抓取。
