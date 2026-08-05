# zhihu-answer-grabber 使用与排错参考

## 命令一览

| 命令 | 说明 |
|---|---|
| `grab <问题链接或ID>` | 抓取单题全部回答（支持断点续传，中断重跑自动续） |
| `batch <file.txt>` | 每行一个问题链接/ID，批量顺序抓取 |
| `search <关键词> [--grab]` | 官方开放平台搜索问题；`--grab` 直接抓第一个结果 |
| `status` | 查看 out/ 下已抓取内容与进度 |

## Cookie 来源（三选一，优先级从高到低）
1. 环境变量 `ZHIHU_COOKIE`（整串 cookie）
2. 工具目录下 `zhihu_cookie.txt`（整串 cookie）
3. `~/.zhihu-cli/config.json`（zhihu-cli 登录产物）

## Access Secret（仅 search 需要）
- 环境变量 `ZHIHU_SECRET` 或工具目录下 `zhihu_secret.txt`（开发者平台个人中心获取）

## 输出文件
```
out/<问题ID>/answers.json      # 结构化：题目元信息 + 回答数组
out/<问题ID>/answers.md        # 可读：按赞数倒序
out/<问题ID>/.progress.json    # 断点续传状态
```

## answers.json 字段
`questionId / questionTitle / answerCount / fetchedAt / answers[]`
回答对象：`id / author / url / content(HTML) / excerpt / voteupCount / commentCount / createdTime / updatedTime`

## 常见错误排查

| 现象 | 原因与处理 |
|---|---|
| HTTP 40362「请求存在异常」 | 运行环境设置了 `HTTP_PROXY/HTTPS_PROXY`（如 Clash 7897，出口是数据中心 IP）。**node fetch 默认直连**，不要在环境变量里设代理即可；若用了 curl，加 `--noproxy '*'` |
| HTTP 401 / 403 缺少 z_c0 | cookie 过期或无效：让用户重新从浏览器复制 cookie（F12 → Network → 请求头里的 cookie 整串）更新 `zhihu_cookie.txt` |
| 抓取数 < 问题页显示总数 | 知乎接口只返回可见回答（被折叠/仅关注者可见不在 v4 接口中），属正常 |
| 未找到 zhihu-cli 配置 | 用 cookie 方式（前两种来源）即可，无需安装 zhihu-cli |
| 断点续传不生效 | 每次成功保存 answers.json + .progress.json，中断后重跑同命令即续传 |

## 关键实现说明
- `x-zse-96` 请求签名：由 `src/signer.js` 计算（移植自开源 zhihu-cli，AGPL-3.0），不需要额外服务。
- 限速：每页随机延迟 1.5–4 秒；429/5xx 指数退避重试 2 次。
- 只读操作：抓取、搜索、查看进度，不包含任何写操作（点赞/评论等）。
