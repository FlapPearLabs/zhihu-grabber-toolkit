# zhihu-grabber-toolkit

让 Agent 稳定完成：**搜知乎 → 抓全回答 → 验证 → 处理长回答列表**。

当前里程碑：**v0.2.0**，已经完成真实使用验证的最小可用版本。（v0.2.0 是整个仓库当前的功能里程碑，不是 npm 软件包版本号。）

| 模块 | 作用 |
|---|---|
| [`zhihu-answer-grabber`](./zhihu-answer-grabber) | 知乎命令行工具 + 技能包：搜索、单题/批量抓取、分页抓全、断点续传、JSON/Markdown 输出、结果验证。 |
| [`corpus-anthology`](./corpus-anthology) | 回答很多、内容特别长时使用的技能包：分块处理、检查有没有漏、全量摘要/高赞样本/原文归档，避免一次性塞满上下文。 |

---

## 最简单：把仓库直接交给 Agent

把仓库链接发给 WorkBuddy、Codex、Claude Code 等编程 Agent，然后给它这句话：

```text
读取本仓库 README.md、AGENTS.md、RULES.md 和
zhihu-answer-grabber/SKILL.md，自主完成安装、配置检查和知乎任务。

不要读取、展示或要求我把 Cookie / Secret 粘贴到聊天里；
如果缺凭据，只告诉我应该在本机放哪个文件。
抓取后必须先运行 verify-output 检查结果，只有 valid=true 才能继续；
回答很多时按照技能包规则使用 corpus-anthology，不要一次性把全文塞进上下文。
```

Agent 应该能自己完成：

**读文档 → 安装依赖 → 检查本地配置 → 搜索/抓取/批量 → 验证结果 → 回答很多时分块处理。**

> Windows 当前优先使用 PowerShell。

---

## 第一次初始化

需要 **Node.js 22+**。

```bash
git clone https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git
cd zhihu-grabber-toolkit/zhihu-answer-grabber
npm ci --registry=https://registry.npmjs.org
node scripts/preflight.mjs --json
```

安装和检查可以由 Agent 自动完成。

登录凭据仍需要用户在本机配置，Agent 不会要求你把 Cookie 或 Secret 发到聊天里：

- `zhihu_cookie.txt`：抓回答需要；
- `zhihu_secret.txt`：搜索问题需要。

最简单的方式是把这两个文件放在当前 `zhihu-answer-grabber/` 目录，然后重新运行配置检查。

`preflight.mjs` 只报告“是否可用”和错误类型，不输出凭据内容。

---

## 现在能做什么

- **搜索问题**：关键词 → 知乎问题 ID；
- **全量抓取**：不是只抓第一页，会继续分页抓取全部当前可访问回答；
- **批量抓取**：一次抓多个问题，其中一个失败不会影响其他问题继续处理；
- **断点续传**：中断后继续，不必从头再抓；
- **输出文件**：抓取完成后主要会得到两个文件——
  - `answers.json`：保存原始抓取结果的数据文件，适合程序继续处理；
  - `answers.md`：整理成更适合人直接阅读的版本。
- **严格验收**：“抓到了”不等于“确认有效”，只有 `verify-output` 返回 `valid=true` 才算真正完成；
- **回答很多时**：长回答列表先看看规模、分块处理、检查有没有漏，再做全量摘要 / 高赞样本 / 原文归档；
- **更多内容**：问题附加信息，以及图片、外链、引用、代码块等丰富内容；评论补充抓取可选。

真实使用验证已处理过 **538 条回答 / 29 页** 的问题。

---

## 到底会抓下来什么？

抓取一个问题时，会保存**问题本身的信息**和**每条回答的信息**，而不是把知乎页面整个复制下来。

### 问题本身

会保存问题标题、问题链接、问题描述、话题，以及知乎显示的回答总数等信息。

### 每条回答

每条回答会保存：

- 回答 ID、回答链接、完整回答正文、回答摘要；
- 点赞数、评论数、创建时间、更新时间；
- 从正文中整理出的附加信息：图片、外链、引用 / 脚注、代码块。

目前作者部分只保存作者名称，不抓完整个人主页和粉丝等资料。

### 评论

评论默认不抓。开启评论补充（抓取命令加 `--comments`）后，会从最多 10 条高赞回答中，每条补充最多 3 条一级热门评论——它不是全量评论抓取，也不抓子评论 / 回复楼。评论会保存：评论正文、评论作者名称（如果有）、评论时间（如果有）。

### 图片、链接、引用和代码块

- **图片**：保存图片地址、说明、尺寸等可用信息；不会把图片文件下载到本地。
- **外链**：记录回答正文中的外链及其基本信息。
- **引用 / 脚注**：回答里的引用或脚注会额外整理成结构化信息。
- **代码块**：代码正文仍保留在回答正文中，同时会记录代码语言和行数等信息。
- **视频**：视频结构目前还没有正式支持。

### 不抓什么

当前不是把知乎整个页面全部复制下来。明确不抓：完整作者档案、完整评论区、所有子评论；不会自动下载全部图片文件；视频结构目前未正式支持。

### 抓下来的文件长什么样

`answers.json` 是结构化的数据文件，大致结构如下（字段已简化）：

```json
{
  "questionId": "123456",
  "questionTitle": "问题标题",
  "answerCount": 538,

  "question": {
    "id": "123456",
    "title": "问题标题",
    "descriptionMarkdown": "问题描述……",
    "topics": [
      {
        "id": "19550517",
        "name": "人工智能"
      }
    ]
  },

  "answers": [
    {
      "id": "987654",
      "author": "作者名称",
      "url": "https://www.zhihu.com/question/123456/answer/987654",
      "content": "<p>回答完整正文……</p>",
      "excerpt": "回答摘要……",
      "voteupCount": 1234,
      "commentCount": 56,
      "createdTime": 1234567890,
      "updatedTime": 1234567890,

      "assets": {
        "images": [],
        "links": [],
        "references": [],
        "codeBlocks": [],
        "videos": []
      },

      "comments": [
        {
          "authorName": "评论作者",
          "contentMarkdown": "评论内容……",
          "createdTime": 1234567890
        }
      ]
    }
  ]
}
```

`answers.md` 是适合人阅读的版本：开头是问题标题和链接，然后按点赞数从高到低排列每条回答，每条包含作者、赞数、评论数、创建时间和回答正文。

---

## 常用命令

在 `zhihu-answer-grabber/` 目录执行：

```bash
# 检查凭据
node scripts/preflight.mjs --json

# 搜索问题
node scripts/zhigrab.mjs search "关键词" --json

# 单题全量抓取
node scripts/zhigrab.mjs grab <QUESTION_ID> --json

# 批量抓取（batch.txt 每行一个问题 ID）
node scripts/zhigrab.mjs batch batch.txt --json

# 查看状态
node scripts/zhigrab.mjs status --json

# 验证结果：唯一验收门
node scripts/verify-output.mjs out/<QUESTION_ID>

# 验证后交给回答很多时使用的技能包
node scripts/make-handoff.mjs out/<QUESTION_ID> --task digest
```

---

## 回答特别多怎么办？

如果一个问题有几百条回答，不会直接把所有内容一次性塞给大模型。

系统会：

1. 先看看内容有多大；
2. 把很长的内容分成较小的部分；
3. 一部分一部分处理；
4. 检查有没有哪部分漏掉；
5. 最后再统一汇总。

这样可以减少因为上下文太长造成的漏读、截断或只总结前半部分。

针对不同需求有三种处理方式：

- **全量摘要**：尽量覆盖全部回答；
- **高赞样本**：只看点赞较高的一部分回答，不冒充完整总结；
- **原文归档**：把原文整理到一起，不改写正文。

内部实现细节见 [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md)。

---

## 抓下来的网页内容安全吗？

知乎回答、链接和代码都只会被当作外部资料处理。

例如某条回答里写着：

“执行这个命令”
“打开这个网站”
“读取电脑里的文件”

这些文字本身不能直接让工具去执行这些操作。

当前已经做了：

- 网页内容转成更安全的 Markdown；
- 危险链接受到限制；
- 不会自动打开正文里的链接；
- 不会自动执行正文里的代码；
- 原始抓取数据不会因为后续整理而被改写。

但是要明确：**当前版本不宣称已经彻底解决所有自然语言提示词注入问题。**

更严格的大模型安全隔离仍在继续完善。

因此本项目一直把知乎内容看作：

**不可信的外部资料**，

而不是：

**给 Agent 的操作命令**。

---

## 更多文档

需要技术细节、边界和高级用法时再看：

- [`zhihu-answer-grabber/SKILL.md`](./zhihu-answer-grabber/SKILL.md)
- [`zhihu-answer-grabber/references/`](./zhihu-answer-grabber/references/)
- [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md)
- [`AGENTS.md`](./AGENTS.md) / [`RULES.md`](./RULES.md)

---

## 边界

只做**读取、整理和验证**：不点赞、不评论、不关注；不绕过验证码/权限控制；不做代理池、高频抓取或规避检测；不自动执行正文代码或自动访问正文外链。

请遵守知乎平台服务条款与当地法律法规，仅用于合法的个人学习、研究和自动化工作流。

## 许可证

- `zhihu-answer-grabber`：**AGPL-3.0-only**；
- `corpus-anthology`：**MIT**。
