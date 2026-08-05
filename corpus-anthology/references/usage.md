# corpus-anthology 脚本用法参考

## stats.mjs — 规模评估（所有模式的第一步）

```bash
node stats.mjs <文件或目录> [更多路径...]
```

- 目录会递归收集 `.md/.json/.txt`。
- 输出每个文件的字符数/行数/估算 token 及合计，并给出分块建议（单块 ≤30KB 或 ≤800 行）。
- 判断：总字符 > 40KB → 禁止一次性全读，必须走分块或脚本。

## digest.mjs — summary 模式（精华摘要）

```bash
node digest.mjs <answers.json 或目录> [--top 6] [--max-chars 1300] [--key voteupCount] [--out digest.md]
```

- 输入兼容两种 JSON 结构：`{questionTitle, answers:[...]}` 或纯数组；传目录则递归找所有 `answers.json` 并按路径排序逐题处理。
- `--key` 指定排序字段（知乎回答常用 `voteupCount`；可换成 `commentCount`、`createdTime` 等）。
- 摘要条目含：作者、赞/评、正文截断。**Read 摘要后由 LLM 归纳成最终总结**（每条 ≤500 字要点，控制总输出）。

## archive.mjs — archive/edit 模式（全量合集）

```bash
node archive.mjs <srcDir> [--out collection.md] [--title "合集标题"] [--volume N] [--name collection]
```

- 递归收集 `srcDir` 下所有 `answers.md`，按路径排序。
- 生成：标题 + 统计信息 + **目录索引**（编号/标题/字符数）+ 逐篇完整正文。
- 正文**纯脚本拼接、零改写**，因此不消耗 LLM 上下文；LLM 只需 Read 目录索引确认结构与排版。
- `--volume N`：每 N 篇分一卷，输出 `collection_001.md / collection_002.md ...`（文件名前缀用 `--name` 改）。
- 定位到输出文件后，用 `wc`/`stats.mjs` 复核规模，再决定是否需要分卷或补充说明页。

## 组合示例（知乎回答大合集）

```bash
# 1) 评估
node stats.mjs ./out
# 2) 精简版
node digest.mjs ./out --out digest.md
# 3) 全量合集（每 30 篇一卷）
node archive.mjs ./out --title "知乎 Codex 实战大合集" --volume 30
```

## 常见问题

- **archive 后正文顺序**：按问题目录名（ID）排序，如需按赞数/时间排序，先排序再建目录或手动指定。
- **edit 模式想改正文**：不要指望脚本改写；用 map-reduce 分块读原文、逐章生成新版本，再拼接。
- **full 模式章节设计**：基于 digest 的要点分布设计章节（如按主题聚类），再分章 map-reduce 精读填充。
