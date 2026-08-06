# zhihu-grabber-toolkit

把知乎回答「搜得到 → 抓得全 → 理得清」的一整套 Agent 工具链开源出来。包含两个相互独立、可单独使用的模块：

| 模块 | 作用 | 许可证 |
|---|---|---|
| [`zhihu-answer-grabber/`](./zhihu-answer-grabber) | 知乎回答抓取器（CLI + Skill）。复用开源 zse96 v2 签名算法（衍生自 zly2006/zhihu-plus-plus → iteng007/zhihu-mcp-server），直连稳定，支持分页抓全量回答、断点续传、结构化 JSON/Markdown 输出。 | AGPL-3.0（签名算法部分衍生自 AGPL 项目） |
| [`corpus-anthology/`](./corpus-anthology) | 大语料路由编排 Skill。十几篇长回答上下文会塞爆时，自动按意图路由：精简总结 / 全量合集 / 排版整理 / 章节化完整版，且全程保护 LLM 上下文。 | MIT |

---

## 1. zhihu-answer-grabber

专用的知乎回答抓取器，**不是**通用客户端。核心能力与开源 `zhihu-cli` 的差异：

- 直接读 Cookie 文件直连，规避 zhihu-cli 二维码登录在代理环境下卡死的问题；
- 分页抓全量回答 + 断点续传，适合自动化 / Agent 调用；
- 结构化输出（JSON + Markdown），而非交互式终端展示。

### 安装

```bash
cd zhihu-answer-grabber
npm install      # 仅测试依赖（node:test），运行时不依赖任何第三方包
```

### 配置凭据（二选一，均不入库）

```bash
# 方式 A：环境变量
export ZHIHU_COOKIE="z_c0=xxx; d_c0=yyy; ..."   # 抓回答必需
export ZHIHU_SECRET="xxxx"                        # 仅 search 功能需要（官方开放平台）

# 方式 B：在当前目录放文件（已被 .gitignore 忽略）
echo "z_c0=xxx; d_c0=yyy" > zhihu_cookie.txt
echo "你的secret" > zhihu_secret.txt
```

> ⚠️ Cookie 是「进知乎的门卡」，Secret 是「官方数据平台的会员卡」。
> 只抓回答 → 只要 Cookie；想用「搜关键词定位问题」→ 再加 Secret。
> **这两个文件已在 `.gitignore` 中屏蔽，切勿提交。**

### 用法

```bash
# 抓取单个问题（按问题 ID）
node scripts/zhigrab.mjs grab <QUESTION_ID>

# 批量抓取（每行一个 ID）
node scripts/zhigrab.mjs batch batch.txt

# 用官方平台搜关键词，定位相关问题 ID（需要 Secret）
node scripts/zhigrab.mjs search "Codex 使用技巧"

# 查看状态
node scripts/zhigrab.mjs status
```

也可作为 WorkBuddy Skill 使用（见 `zhihu-answer-grabber/SKILL.md`）。

---

## 2. corpus-anthology

大语料路由编排器。当你要处理的回答/文档总量超过约 40KB（≈25k token）时，**禁止一次性全读进上下文**，本 Skill 会先做规模评估（`stats.mjs`），再按你的意图路由：

| 意图 | 模式 | 处理 |
|---|---|---|
| 总结要点 / 太长了 | summary | `digest.mjs` 抽精华 → LLM 归纳 |
| 全部保存 / 大合集 | archive | `archive.mjs` 纯脚本拼接，正文零改写、不占上下文 |
| 整理 / 排版 / 加目录 | edit | 脚本合并 + LLM 只看索引做决策 |
| 完整版 / 成书 | full | map-reduce 分块精读 + 分层合成 |

详见 [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md) 与 [`references/usage.md`](./corpus-anthology/references/usage.md)。

---

## 许可证

- `zhihu-answer-grabber` 的 **x-zse-96 签名算法**衍生自 [iteng007/zhihu-mcp-server](https://github.com/iteng007/zhihu-mcp-server)（AGPL-3.0）→ 其上游 [zly2006/zhihu-plus-plus](https://github.com/zly2006/zhihu-plus-plus)（AGPL），故以 **AGPL-3.0-only** 发布，见 [`LICENSE`](./LICENSE)。CLI 交互形态与 Cookie 登录方案参考了 [BAIGUANGMEI/zhihu-cli](https://github.com/BAIGUANGMEI/zhihu-cli)（Apache-2.0，不含签名器）。
- `corpus-anthology` 以 **MIT** 发布。

使用本仓库进行的任何抓取行为，请遵守知乎平台服务条款与当地法律法规，仅用于个人学习与研究。
