# zhihu-grabber-toolkit

把知乎回答「搜得到 → 抓得全 → 理得清」的一整套 Agent 工具链开源出来。包含两个相互独立、可单独使用的模块：

| 模块 | 作用 | 许可证 |
|---|---|---|
| [`zhihu-answer-grabber/`](./zhihu-answer-grabber) | 知乎回答抓取器（CLI + Skill）。复用开源 zse96 v2 签名算法（衍生自 zly2006/zhihu-plus-plus → iteng007/zhihu-mcp-server），直连稳定，支持分页抓全量回答、断点续传、结构化 JSON/Markdown 输出，并提供产物完成验证（`verify-output.mjs`）与凭据预检（`preflight.mjs`）。 | AGPL-3.0（签名算法部分衍生自 AGPL 项目） |
| [`corpus-anthology/`](./corpus-anthology) | 大语料处理 Skill。对超出上下文读取能力的大型知乎回答语料执行：规模统计（inspect）、全覆盖分块摘要（digest，带来源证据）、机械归档（archive）。**不支持** edit/full/成书（未实现）。 | MIT |

---

## 1. zhihu-answer-grabber

专用的知乎回答抓取器，**不是**通用客户端。核心能力与开源 `zhihu-cli` 的差异：

- 直接读 Cookie 文件直连，规避 zhihu-cli 二维码登录在代理环境下卡死的问题；
- 分页抓全量回答 + 断点续传，适合自动化 / Agent 调用；
- 结构化输出（JSON + Markdown），而非交互式终端展示；
- 完成验证：`scripts/verify-output.mjs` 校验产物完整性与一致性。

### 安装

```bash
cd zhihu-answer-grabber
npm install      # 仅测试依赖（node:test），运行时不依赖任何第三方包
```

### 配置凭据（本地配置，均不入库，不经聊天）

```bash
# 方式 A：环境变量
export ZHIHU_COOKIE="z_c0=xxx; d_c0=yyy; ..."   # 抓回答必需
export ZHIHU_SECRET="xxxx"                        # 仅 search 功能需要（官方开放平台）

# 方式 B：在当前目录放文件（已被 .gitignore 忽略）
touch zhihu_cookie.txt zhihu_secret.txt
chmod 600 zhihu_cookie.txt zhihu_secret.txt   # POSIX 必须 0600，否则 loader 拒绝
# 然后在本机编辑这两个文件写入凭据
```

> ⚠️ Cookie 是「进知乎的门卡」，Secret 是「官方数据平台的会员卡」。
> **凭据只在本机配置，绝不粘贴到聊天、日志或任何文档中。**
> 这两个文件已在 `.gitignore` 中屏蔽，切勿提交。
> Agent 可用 `node scripts/preflight.mjs` 检查凭据是否已配置且**可用**（`cookie_usable` / `secret_usable`，只输出布尔值与错误类型，不输出凭据内容）。

### 用法

```bash
# 抓取单个问题（按问题 ID）
node scripts/zhigrab.mjs grab <QUESTION_ID>

# 批量抓取（每行一个 ID）
node scripts/zhigrab.mjs batch batch.txt

# 用官方平台搜关键词，定位相关问题 ID（需要 Secret）；--grab 仅在明确要求"抓第一个结果"时使用
node scripts/zhigrab.mjs search "Codex 使用技巧"

# 查看状态
node scripts/zhigrab.mjs status

# 抓取完成后验证产物
node scripts/verify-output.mjs out/<QUESTION_ID>
```

也可作为 WorkBuddy Skill 使用（见 `zhihu-answer-grabber/SKILL.md`）。

---

## 2. corpus-anthology

大语料处理 Skill。当知乎回答语料总量超过约 40KB（≈25k token，启发式阈值）时，**禁止一次性全读进上下文**，本 Skill 先做规模评估（`stats.mjs`），再按需求处理：

| 需求 | 模式 | 处理 |
|---|---|---|
| 先统计规模 / 决定怎么处理 | inspect | `stats.mjs` 流式统计 |
| 全部回答都要覆盖的摘要 | digest | `chunk.mjs` → map → `verify.mjs` → `reduce.mjs` → `verify.mjs --final`，带来源证据 |
| 只看最高赞的几个回答 | popular-sample | `popular-sample.mjs` 取 Top N（高赞样本，不代表语料） |
| 机械合并成分卷合集 | archive | `archive.mjs` 纯脚本拼接，正文零改写、canonical body、相对路径、按正文字符分卷；sidecar manifest 记录每篇 bodySha256，`--verify --manifest` 逐卷核验正文 SHA-256 |

**不支持的**：edit（排版编辑）、full（章节化完整版）、成书、自动去重改写——这些能力未实现，本仓库不声称支持。

详见 [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md) 与 `corpus-anthology/references/`。

---

## 两个模块的衔接

抓取产物超过直接读取能力时，`zhihu-answer-grabber` 以结构化 JSON handoff 交给 `corpus-anthology`：

```json
{
  "task": "digest",
  "sourceType": "zhihu-answers",
  "questionId": "123",
  "inputJson": "out/123/answers.json",
  "inputMarkdown": "out/123/answers.md",
  "verified": true,
  "answerCount": 247,
  "warnings": []
}
```

- 共享 schema：`references/zhihu-corpus-handoff.schema.json`（两个 Skill 引用同一文件）。
- `corpus-anthology` 接收前必须验证 `verified === true`、文件存在、JSON 可解析、`answerCount` 一致；未验证则拒绝并返回需修复项。

---

## 许可证

- `zhihu-answer-grabber` 的 **x-zse-96 签名算法**衍生自 [iteng007/zhihu-mcp-server](https://github.com/iteng007/zhihu-mcp-server)（AGPL-3.0）→ 其上游 [zly2006/zhihu-plus-plus](https://github.com/zly2006/zhihu-plus-plus)（AGPL），故以 **AGPL-3.0-only** 发布，见 [`LICENSE`](./LICENSE)。CLI 交互形态与 Cookie 登录方案参考了 [BAIGUANGMEI/zhihu-cli](https://github.com/BAIGUANGMEI/zhihu-cli)（Apache-2.0，不含签名器）。
- `corpus-anthology` 以 **MIT** 发布。

使用本仓库进行的任何抓取行为，请遵守知乎平台服务条款与当地法律法规，仅用于个人学习与研究。
