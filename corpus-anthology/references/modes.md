# corpus-anthology 模式详解

本 Skill 仅支持三种模式：`inspect`、`digest`、`archive`。

## inspect — 规模统计

```bash
node scripts/stats.mjs <文件或目录> [更多路径...]
```

- 目录递归收集 `.md/.json/.txt`（仅用于统计，不承诺通用文档处理）。
- 输出每个文件的字符数/行数/估算 token 及合计，给出分块建议。
- 判断：总字符 > 40KB（启发式）→ 禁止一次性全读，必须走分块或脚本管线。

## digest — 全覆盖分块摘要（map-reduce）

digest 的目标是**覆盖全部输入记录**并保留来源证据。与 popular-sample 不同：popular-sample 只取高赞 Top N，不能代表语料；digest 必须全部覆盖。

管线（每步详见对应脚本与 references）：

```
chunk.mjs（manifest + 分块）
→ map（LLM 逐块生成结构化结果，见 evidence-schema.md）
→ verify.mjs（覆盖率）
→ reduce.mjs（合并）
→ verify.mjs --final（最终引用验证）
```

## archive — 机械归档

```bash
node scripts/archive.mjs <srcDir> [--out collection.md] [--title "合集标题"] [--volume N] [--max-volume-chars M] [--name 前缀]
node scripts/archive.mjs <srcDir> --verify <collection.md>   # 完整性核验
```

- 递归收集 `srcDir` 下所有 `answers.md`，按路径排序。
- 生成：标题 + 统计信息 + 目录索引 + 逐篇完整正文。
- 正文**纯脚本拼接、零改写**，不消耗 LLM 上下文。
- `--volume N`：每 N 篇分一卷；`--max-volume-chars M`：按累计体积切卷（二者互斥）。
- `--verify`：核验输出前后篇数一致、内容哈希/字符数量可核验。
- **archive 是归档，不是摘要，也不是编辑。**

## 何时用哪个

| 用户诉求 | 模式 |
|---|---|
| "这批语料多大？" / "先统计一下规模" | inspect |
| "全部回答都要覆盖，做完整摘要" | digest |
| "只要最高赞的几个回答看看" | popular-sample（高赞样本，标注清楚） |
| "机械合并成分卷合集，正文别动" | archive |
| "改改排版 / 去重 / 出书" | **不支持**——本 Skill 未实现 edit/full/成书 |
