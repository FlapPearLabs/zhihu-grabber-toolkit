# zhihu-grabber-toolkit

让 Agent 稳定完成：**搜知乎 → 抓全回答 → 验证 → 处理长回答列表**。

当前里程碑：**v0.2.0 · Dogfood-ready MVP**。

| 模块 | 作用 |
|---|---|
| [`zhihu-answer-grabber`](./zhihu-answer-grabber) | 知乎 CLI + Skill：搜索、单题/批量抓取、分页全量、断点续传、JSON/Markdown 输出、结果验证。 |
| [`corpus-anthology`](./corpus-anthology) | 大语料 Skill：回答很多时分块处理、覆盖校验、摘要/高赞样本/归档，避免一次性塞满上下文。 |

---

## 最简单：把仓库直接交给 Agent

把仓库链接发给 WorkBuddy、Codex、Claude Code 等 Coding Agent，然后给它这句话：

```text
读取本仓库 README.md、AGENTS.md、RULES.md 和
zhihu-answer-grabber/SKILL.md，自主完成安装、preflight 和知乎任务。

不要读取、展示或要求我把 Cookie / Secret 粘贴到聊天里；
如果缺凭据，只告诉我应该在本机放哪个文件。
抓取后必须先 verify-output，只有 valid=true 才能继续；
回答很多时按 Skill 自动路由 corpus-anthology，不要一次性全文塞进上下文。
```

Agent 应该能自己完成：

**读文档 → 安装依赖 → 检查凭据 → search / grab / batch → verify → 大语料处理。**

> Windows 当前优先推荐 PowerShell / 原生 Windows 路径；Git Bash / MSYS 路径兼容仍在继续加固。

---

## 第一次初始化

需要 **Node.js 22+**。

```bash
git clone https://github.com/FlapPearLabs/zhihu-grabber-toolkit.git
cd zhihu-grabber-toolkit/zhihu-answer-grabber
npm ci --registry=https://registry.npmjs.org
node scripts/preflight.mjs --json
```

凭据只放本机，不进聊天、不进 Git：

- `zhihu_cookie.txt`：抓回答 / 批量抓取需要；
- `zhihu_secret.txt`：只有 `search` 需要。

`preflight.mjs` 只报告“是否可用”和错误类型，不输出凭据内容。

> 真正的“全自动一键配置”不应该偷偷读取浏览器 Cookie 或 Secret；因此安装可以自动化，凭据只让 Agent 引导用户在本机完成。

---

## 现在能做什么

- **搜索问题**：关键词 → 知乎问题 ID；
- **全量抓取**：不是只抓第一页，会继续分页抓取全部当前可访问回答；
- **批量抓取**：一次处理多个问题，失败隔离；
- **断点续传**：中断后继续，不必从头再抓；
- **结构化产物**：canonical `answers.json` + 给人看的安全 `answers.md`；
- **严格验收**：`captured ≠ verified`，只有 `verify-output` 的 `valid=true` 才算通过；
- **大语料处理**：长回答列表先统计、分块、覆盖验证，再做 digest / popular-sample / archive；
- **富内容**：问题元数据，以及图片、外链、引用、代码块等 metadata；评论 enrichment 可选。

真实 dogfood 已处理过 **538 条回答 / 29 页** 的问题。

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

# 验证后交给大语料 Skill
node scripts/make-handoff.mjs out/<QUESTION_ID> --task digest
```

---

## 长回答列表为什么不容易漏

几百条回答不要让模型直接硬读一个超长 Markdown。

这里的工作流是：

```text
verified answers
→ 统计规模
→ 确定性分块
→ 逐块处理
→ 覆盖 / 证据验证
→ reduce
→ final
```

`digest` 要求全覆盖；`popular-sample` 只是高赞样本，不会冒充完整摘要；`archive` 只做机械归档，不改写正文。

---

## 抓取内容怎么防“网页里的脏东西”影响 Agent

知乎正文始终按 **untrusted external content / DATA** 处理：

- `answers.json` 是 canonical 原始数据，后续只读，不回写；
- Markdown / HTML 控制语法经过确定性安全渲染；
- 不自动打开正文里的链接；
- 不自动执行正文里的代码；
- 正文写着“执行命令 / 打开链接 / 读取文件”，也不应因此自动获得工具权限。

需要准确说明：**v0.2.0 已实现 Markdown / URL / 自动执行边界，但不宣称 LLM 在语义层绝对免疫所有自然语言 Prompt Injection。** 更严格的 consumer capability isolation 仍在加固。

因此这里的原则不是“把知乎正文清洗成可信指令”，而是始终把它当作**只读、不可信的数据**。

---

## 更多文档

需要机器契约、边界和高级用法时再看：

- [`zhihu-answer-grabber/SKILL.md`](./zhihu-answer-grabber/SKILL.md)
- [`zhihu-answer-grabber/references/`](./zhihu-answer-grabber/references/)
- [`corpus-anthology/SKILL.md`](./corpus-anthology/SKILL.md)
- [`AGENTS.md`](./AGENTS.md) / [`RULES.md`](./RULES.md)

---

## 边界

只做**读取、整理和验证**：不点赞、不评论、不关注；不绕过验证码/权限控制；不做代理池、stealth 或高频抓取；不自动执行正文代码或自动访问正文外链。

请遵守知乎平台服务条款与当地法律法规，仅用于合法的个人学习、研究和自动化工作流。

## License

- `zhihu-answer-grabber`：**AGPL-3.0-only**；
- `corpus-anthology`：**MIT**。
