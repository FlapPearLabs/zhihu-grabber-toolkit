# Project Memory — zhihu-grabber-toolkit

> 本文件由项目治理资产迁移（2026-08-09）从原 WorkBuddy 项目记忆提取的**稳定、非敏感、项目级、长期有效**子集。
> WorkBuddy 私有运行记忆（环境特性、本机路径、临时状态）**不进入 Git**。

## 仓库与基线

- 仓库：https://github.com/FlapPearLabs/zhihu-grabber-toolkit
- 权威 Spec（双）：`docs/specs/v2-rich-content-fidelity.md`（Status: APPROVED，禁止未经批准修改）+ `docs/specs/v0.3-product-scope.md`（Status: APPROVED）。V0.3 为 **additive / amendment Spec**：对明确 amendment target（video / search answerCount / countMismatch / Agent projection / large corpus）增量覆盖 V2 对应旧状态；其余未被 V0.3 amendment 的 V2 合同继续有效。两者均禁止未经批准修改。
- **Phase 1 approved checkpoint**（historical，非 current master）：`27e68c1b344ed5af1e1b05887462f2792ffa4fde` —— V2 Phase 1（安全 Markdown renderer 信任根）在此提交收口合并 master，CODE gate PASS，四轮 review 全过。

> 本文件不记录 `current master SHA` / `HEAD` / 临时分支存在性等运行时 Git 状态；需要时现场获取（`git fetch` → `git rev-parse` / `git compare`）。

## 架构决策（已批准）

- **V2 分 Phase 推进**；Phase 1（安全 Markdown renderer 信任根）已完成并 ff-only 合并 master：
  - `src/markdown-security.js`：`escapeUntrustedMarkdownText`（Markdown control 字符全转义 + 行级结构中和[每行含首行 + leading whitespace 首字符 NBSP 化，防跨 text-node 与 split-whitespace 累计]）、URL tokenizer / classifier / redirect 解包 / destination serializer。
  - `src/rich-renderer.js`：基于 parse5 的严格白名单 HTML→Markdown renderer。
  - `render.js` 的 `renderAnswers` 接入新 renderer：保持 V1 framing（恰好一个 `## N.`）；链接由 ID 确定性构造，不信任 `meta.url`/`answer.url`；scalar 数值收口（异常 → fallback / `(未知)`）。
- **依赖**：runtime dependency `parse5@^8.0.1` 为唯一新增（HTML parser）；**不得加第二个 parser**。
- **lockfile registry 统一 npmjs**；安装时用 `--registry=https://registry.npmjs.org` 覆盖（镜像 registry 会污染 lockfile）。

## 测试基线（稳定，离线）

- `cd zhihu-answer-grabber && npm test` → 435 pass / 0 fail / 3 skip
- `cd corpus-anthology && node --test` → 93 pass / 0 fail / 2 skip
- `node --test test/agent-pipeline.test.mjs`（仓库根，CLI×Skill 集成）→ 6 pass / 0 fail
- skip 均为既有 Windows 平台限制（symlink 相关），与实现改动无关。
- Phase 1 对抗性测试覆盖（`test/markdown-security.test.js` + `test/rich-renderer.test.js`，含 review 四轮反例）**仅覆盖 Phase 1 相关子集**：
  - URL / 外链安全（分类器、redirect 解包、destination serializer、localhost 拒绝）
  - Markdown / raw HTML 注入（escape 完整性、control 字符）
  - Setext heading / indented code block 中和（每行含首行）
  - cross-DOM-node 注入（`<br>` / inline-tag 分段）
  - split-whitespace 累计
  - code fence / language 处理
  - 已实现的 text-node / title / author 转义面
- **V2 Phase 2（S1-S6）已实现并覆盖**：image metadata / external link assets / code block metadata / reference-footnote assets（`test/asset-extractor.test.js`）；脚注重建与对抗（重复/非法/缺失 numero、跨 answer collision、Markdown 注入、恶意脚注 URL，`test/rich-renderer.test.js`）；additive `answers[].assets` 集成、断点续传兼容、determinism（`test/grabber.test.js`）；V1 兼容回归 render/verify/handoff/CLI status（`test/v1-compat.test.js`）。
- **V2 Phase 3 — Question Metadata 已纳入 accepted project baseline 并覆盖**（`test/question-metadata.test.js`）：additive `question` 对象（`{ id, title, descriptionHtml, descriptionMarkdown, topics }`）；description source/canonicality（descriptionHtml 严格等于 server raw `detail`，渲染不突变）、description security（Markdown 注入惰性 / raw HTML 活性移除 / headingOffset=2 防 `## N.` 越界 / javascript:/data: 链接不可点击）、topics 最小字段 `{ id, name }` 确定性提取与恶意文本惰性、V1/Phase2 兼容（旧产物无 question 可读、verify/handoff 不受影响）、request budget（question info 请求恰 1 次/抓取，零新增）、determinism；missing vs empty 区分（detail/topics 缺失 ≠ 明确空值）、metadata 失败用户可见 warning（CLI 级）、resume 保留已有合法 question、identity gate（`QUESTION_METADATA_IDENTITY_CONFLICT`）、topic id/name 严格 string 校验、topics 非空全非法 omit、公开 warning 固定最小文本、resume ID 严格 string。
- **V2 Phase 4 — Comments Enrichment 已纳入 accepted project baseline 并覆盖**（`test/comments.test.js`）：additive optional `answers[].comments`（默认 OFF；唯一显式开启面 `grab <question> --comments`；batch/search/status 带 `--comments` → 静态 `invalid_input`，先于凭据/网络）；`comment_v5/answers/{answerId}/root_comment?order_by=score&limit=3&offset=`（server score/default ordering 的 Top3 root comments，禁 `status=open`，无 legacy fallback、无分页）；Top10 selected answers（canonical `voteupCount` DESC + capture-order tie）；每 selected answer 至多 1 次真实 HTTP 尝试（**`retries:0`**，requestJson 默认 retries=2 会暗中突破预算）、每 question ≤10 次、attempt 间顺序低延迟（`humanDelay` 前置，失败路径同样限速，无并发）；root predicate 五条件校验（含 `reply_root_comment_id === item.id`）任一违约 → 整个 answer enrichment 失败、无后续 item 补位；`child_comments`/reply 完全忽略；唯一 explicit-zero = `data=[] + totals=0 + is_end=true`（`commentCount===0` 不是 zero fact——V1 canonicalization 收敛 raw null/missing）；A/B/C/D resume/preservation 语义（OFF/not-selected 原样保留 exact JSON 值不 validate，selected success replace、failure 时仅 v1-compatible 保留否则 omit）；固定 question-level aggregate warning（"部分评论 enrichment 获取失败；回答核心抓取继续。"）；`contentHtml` 严格 raw + `contentMarkdown` 同一 `richHtmlToMarkdown`（无第二 parser，hostile content 全程 inert）；`answerId` 作为单 opaque path segment 且空/dot-segment path 破坏时 fail closed；`answers.md` / verify-output / handoff 合同未改。Phase 4 产品合同完整见 Approved Spec §15/§18/§20.2.2/§25/§26。
- **V0.3 决策 C（Agent projection / capability isolation）已完成**（不再标记"尚未完成"）：
  T5-LM（`lmstudio-local-tool-less` runtime-scoped YES）+ T5-R / T5-C / T5-L / 两个 YAML host（NO）
  + T6 per-source projection CODE 均已落地并合并 master；T11-R2 另为 `deepseek-api-tool-less` 取得
  runtime-scoped YES（详见下文 V0.3 Runtime Closeout 段）。
  - 注：video 已于 V0.3 决策 B 永久定为 `VIDEO_SUPPORT = DO_NOT_SUPPORT`（无 video CODE、无后续 discovery），不属于「未覆盖待补」项；`answers[].assets.videos` 仅保留兼容空字段 `[]`。

## 已批准产品决策 / 长期约束

- `captured` ≠ `verified`：`verified: true` 只能由 `verify-output.mjs` 授予；`make-handoff.mjs` 确定性生成 handoff，禁止手工构造。
- Agent 优先 `--json` 机器契约，不解析人类 stdout；禁止 `search --grab`（仅人类终端兼容）。
- 凭据只在本机配置，绝不进 repo / log / chat（详见 `references/security.md` 与 `RULES.md`）。
- V1 全部对外合同保持向后兼容；schema 变更只允许 additive。
- **V2 Phase 2 additive `answers[].assets` 已落地**：`{ images, links, references, codeBlocks, videos }` 由 `src/asset-extractor.js` 从 `content` 确定性派生（Spec §18），`content` 原样保留；脚注 Markdown identifier 一律 renderer 生成 `a<answerId>-r<index>`（1-based 出现顺序，文档内全局唯一），`data-numero` 只作 `sourceNumero` metadata、绝不进 identifier；answerId 缺失/非法时脚注 fail closed 为可见文本（防跨 answer ID 冲突）；仅 `sup`（非 `sub`）视为脚注元素，与 asset-extractor 判定一致（Spec §14.1 白名单）。
- **PHASE2_1PX_PLACEHOLDER_CONTRACT（已批准；SPEC_CONFLICT_1PX_PLACEHOLDER 已关闭）**：`data:` / `blob:` 一律为 placeholder；HTTP(S) 图片仅当原始 `<img>` 显式提供 `width == 1` 且 `height == 1` 时确定性视为 1×1 placeholder；无显式尺寸证据（缺失/非法/非 1×1）不得猜测；禁止 URL 文件名/token/query/host/CSS class/alt 等启发式；禁止网络请求探测 intrinsic dimensions；placeholder candidate 被跳过后继续 `data-original → data-actualsrc → 合法 https src` 的 lower-priority fallback（1px 尺寸证据只消费一次：首个被判 1px placeholder 的 candidate 跳过后，后续 lower-priority candidate 不再因同一证据被判 1px，它们是真实 swap-in 图片）。Spec §10.1 已补充该最小 clarification（用户批准的 SPEC_CONFLICT 关闭手段，DOCUMENT review 覆盖）。
- **PHASE3_SCHEMA_DISCOVERY（2026-08-10 真实 schema discovery 实测；实现级长期事实）**：知乎 v4 `/api/v4/questions/{qid}` 的 `include` 是**严格字段白名单**，`detail`（问题描述原始 HTML，string，无描述时为空串）与 `topics`（array of `{ id, type, url, name, avatar_url, topic_type }`）必须位于 include **前部**才会被返回（放在 `author.name` 之后会被服务端丢弃）。Phase 3 将 `QUESTION_INCLUDE` 扩展为 `detail,topics,title,answer_count,comment_count,follower_count,excerpt,author.name`；description 复用同一 question info 请求 → **NETWORK_REQUEST_DELTA = 0**（每 question 仍恰 1 次元信息请求，Spec §17.2 首选路径）。`question` 为 additive optional：`id`/`title` 与 canonical 顶层 `questionId`/`questionTitle` 一致（identity gate 见下）；`descriptionHtml` 严格保留 server raw `detail`（canonical 不可变，Spec §6.1/RULES §3）；`descriptionMarkdown` 由同一 `richHtmlToMarkdown(detail, { headingOffset: 2 })` 确定性派生（description 内部 heading 最多 H3，不越 `## N.` framing，Spec §14.1.1）；`topics` 只持久化最小字段 `{ id, name }`（Spec §17.3 + 真实 schema evidence；url/avatar_url/type/topic_type 不保留；id/name 均严格 string，拒绝 String() 强转任意对象）。
  - **failure/empty 语义**（按用户批准的 Spec §20.2.1 最小 clarification，2026-08-10）：运行时 metadata 请求失败 = enrichment failure（warning 可见 + core 继续，不升 core fatal）；`detail`/`topics` 字段缺失或类型不对**不得**合成空事实（missing ≠ `""` / `[]`），仅服务器明确返回空值才持久化 empty；resume 时若磁盘已有合法 `question` 而 fresh 请求失败，**必须保留**既有 question；server `info.id` 与 canonical qid 不一致 = `QUESTION_METADATA_IDENTITY_CONFLICT`（core 级稳定错误，非 enrichment，CLI 分类 `question_metadata_identity_conflict`）。
  - answers.md 布局未改（descriptionMarkdown 只作 canonical JSON 的 safe representation；其插入 answers.md 的具体位置 Spec 未唯一确定，后续如需布局修改须经独立 DOCUMENT review）。

## 路线图（下一阶段，未经批准不得开始）

- **V2 Phase 2 — Rich Content Assets 已纳入 accepted project baseline**：additive `answers[].assets`（images / links / references / codeBlocks / videos）、canonical `content` 不可变、脚注重建（renderer 生成 `a<answerId>-r<index>`）、1px placeholder 确定性合同（Spec §10.1）均为长期合同，保持不变（见上文已批准决策与 Spec）。
- **V2 Phase 3 — Question Metadata 已纳入 accepted project baseline**：additive `question` metadata（description/topics）、NETWORK_REQUEST_DELTA=0、failure/empty semantics（Spec §20.2.1）、resume preservation 与 identity gate 均为长期合同（见上文 PHASE3_SCHEMA_DISCOVERY 与已批准决策）。
- **V0.3 execution state（HISTORICAL / COMPLETED）**：V0.3 已完成 T0→T11 gated execution，并达到
  **V0_3_EXECUTION_COMPLETE**（见下文 V0.3 Runtime Closeout）。历史 ticket 顺序与 gate 事实由
  **Tracker #6 / Git history** 保存，本文件不再把 T1→T11 作为当前 active execution state。
  历史 checkpoint（非 current master）：V0.3 Draft-review baseline `22b8ed3`；Approved authority effective
  T0 DOCUMENT NORMALIZATION `234a315`（独立 DOCUMENT review PASS 并 ff-only merge master）。
  **NEXT_STAGE（Research Orchestration）已显式批准（2026-08-24，见下文 Research Orchestration 段）；V0.4 versioning 仍需单独授权，不得自动开始。**
- **V0.3 已批准产品决策（durable，见 `docs/specs/v0.3-product-scope.md`）**：
  - **A. Search Answer Count（T1/T2 已进入 accepted implementation baseline）**：目标——搜索候选应尽可能提供来自可信上游的回答数量；缺失 / null 优于虚构。
    - T1 discovery 结论（独立 review PASS 后 merge）：官方 `zhihu_search` Item schema 采样结论
      `NO_DIRECT_ANSWER_COUNT_FIELD_OBSERVED_IN_SAMPLED_SEARCH_RESPONSES`（3 关键词 / 30 Items，
      顶层 schema 无 answer-count 字段；仅 `CommentCount`=评论数 / `VoteUpCount`=点赞数；采样观察，非 schema 级否定）。
    - OPEN-D1（用户批准）：`APPROVED_BOUNDED_QUESTION_INFO_ENRICHMENT`——用既有 question-info
      `/api/v4/questions/{qid}` `answer_count` 补充；仅 enrichment 最终 candidates（丢弃的 Item 不发请求）；
      每候选至多 1 次真实 HTTP 尝试（retries:0）；候选上限 10 → `MAX_EXTRA_REQUESTS_PER_SEARCH = 10`；
      Cookie 不可用 → 全部 `answerCount=null`，search 仍成功；单候选失败 → 该候选 null；
      `answerCount` 仅是 upstream scale metadata，非 verified claim / capture completeness proof。
    - T2 accepted implementation（durable）：
      - search final candidates 暴露 `answerCount: number | null`（additive optional，
        candidates[] 键序 `questionId/title/answerCount/contentType/url`）；
      - 来源：既有 question-info `/api/v4/questions/{qid}` 的 `answer_count`；
      - 仅 final candidates enrichment（dedupe/slice 丢弃的 Item 不发请求）；
      - 每候选至多 1 次真实 HTTP 尝试（retries:0）；当前候选 cap 10 → max +10 / search；
      - Cookie 不可用 → search 仍成功，`answerCount=null`（enrichment 降级，非 search 失败）；
      - 单候选 enrichment 失败 → 仅该候选 null，search 继续；
      - 异常 `answer_count`（负数 / 小数 / 字符串 / 缺失 / 超 safe 整数）→ null；
        仅非负 safe integer 被接受；真实 0 保留为 0；
      - 人类输出：已知「回答数：N」/ 未知「回答数：未知」/ 真实 0 显示 0（未知绝不显示 0）；
      - `answerCount` 仅是 upstream scale metadata，非 verified claim / capture completeness proof；
      - 无 browser scraping；verifier 语义不变；
      - CLI 直接执行兼容 POSIX bin symlink 安装（`isDirectExecution` realpath 判定）；
      - 测试：`test/search-answer-count.test.js`（count 校验 / 预算 / 降级语义）+
        `test/search-answer-count-cli.test.js`（CLI 集成合同）+ `test/cli-entrypoint.test.js`（bin 入口）。
  - **B. Video**：`VIDEO_SUPPORT = DO_NOT_SUPPORT`（永久产品立场）。不抓 / 不 enrich / 不加载 / 不下载 / 不转码 /
    不抓字幕 / 不做语音识别 / 不做视频理解 / 不为视频做 discovery / 不建 speculative parser；
    `answers[].assets.videos: []` 仅作兼容保留字段。IMPLEMENTATION_IMPACT: NONE。V2 §16/§24/§25 已由 T0 归一化为该立场。
  - **C. Agent projection / capability isolation**：V2 §9/§9.1/§9.2 安全合同已批准（LLM NETWORK/SHELL/FS/TOOLS 全 DENY，
    trusted controller 唯一 IO，隔离不可用 → fail closed）。T5 对当前仓库可识别的两个未命名 interface host
    分别给出 `NO`：`zhihu-answer-grabber/agents/openai.yaml` host 与
    `corpus-anthology/agents/openai.yaml` host 均没有可审查的 host product/version、模型调用与 controller
    边界、或 NETWORK/SHELL/FILESYSTEM/TOOLS 的确定性 DENY 证据。每个 runtime 的 `NO`（以及任何
    未评估 runtime 的 UNKNOWN）都必须路由为 `capability_isolation_unavailable` → digest/map STOP；
    禁止跨 runtime 推导、禁止 prompt-only 降级，且 T6 不得实现或启用受支持 runtime path。
    T5-C 对具名 `codex-chatgpt-login-tool-less`（OpenAI Codex CLI `0.136.0`、ChatGPT login）同样给出
    runtime-scoped `NO`：客户端内建 model-generated shell command，故 `MODEL_VISIBLE_TOOL_COUNT >= 1`；
    read-only sandbox / approval 并不移除工具，且 live model catalogue refresh 失败导致固定 model identity 未验证，
    repository-owned controller / fail-closed boundary 也未建立。该结论仅适用于这一精确版本与配置，不推导到其他
    Codex/ChatGPT runtime；T6 继续因 `capability_isolation_unavailable` 阻塞。
    **T5-LM（#26）对具名 `lmstudio-local-tool-less`（LM Studio app `0.4.19+2`、localhost-only `127.0.0.1:1234`、
    CORS OFF、无 MCP servers；本地 `qwen/qwen3-1.7b` MLX 8-bit，`model.safetensors` sha256
    `637386c1…a6a1`）独立给出 runtime-scoped `YES`：`MODEL_VISIBLE_TOOL_COUNT = 0`（请求恒 `tools: []` +
    `tool_choice: "none"`；LM Studio 工具面为请求驱动，对照 probe 证明提供函数工具时才暴露 tool_calls），
    json_schema 结构化输出（MLX 经 Outlines 约束解码）与 controller 确定性校验双层成立，live probe + 12 项
    对抗 battery + 哨兵全过，repository-owned controller 唯一 IO，fail-closed 路径实证。**模型质量与运行时
    安全分离**：1.7B 对完整 map schema（claims + 全 sourceCoverage）覆盖不稳，被 controller fail-closed 拒绝，
    属模型质量（T6/dogfood 另行评估），不影响本运行时安全 YES。该 YES 仅适用于这一精确 LM Studio 版本/
    配置/模型组合，不推导到其他 runtime；既有 NO（T5 两个 YAML host、T5-R、T5-C、T5-L llama.cpp）不变。
    T6 现仅对该 runtime 合法解锁（START_GATE 满足），其余 runtime 仍不得标记支持。
  - **T6（#12）已为 `lmstudio-local-tool-less` 实现 per-source Agent projection + isolation CODE**（已合并 master）：
    `corpus-anthology/lib/lmstudio-projection.mjs`（确定性投影消毒：URL/路径/协议/反斜杠/百分号/控制字符
    中和，占位符用无方括号形式「（外部链接）/（路径）」；**短 token 投影设计**——长真实 sourceId 无法被
    1.7B 可靠回显，投影声明 `[SOURCE <index>]` 短 token，模型只回显 token，controller 映射回真实 ID）、
    `lib/lmstudio-map-executor.mjs`（逐来源调用 tool-less runtime，空正文来源由 controller 确定性合成
    「来源正文为空」条目不调用模型，全来源成功后确定性装配全覆盖 map 结果；任一来源失败 → 整个 chunk
    fail closed，无部分结果）、`scripts/map.mjs`（digest map 步骤 CLI，幂等复用）。`verify.mjs` 全覆盖
    门（missingMappedSources/duplicateMaps/malformedMaps 等）在真实 live 端到端 smoke 中全 0。模型质量
    （1.7B 摘要忠实度、themes 暂为空数组）与运行时安全分离，由后续 dogfood 评估。
  - **D. countMismatch**：`COUNT_MISMATCH_SEVERITY = DIAGNOSTIC_ONLY`（V0.3 决策 D 已进入 accepted implementation baseline；
    保留 reportedAnswerCount / capturedAnswerCount / countMismatch 三诊断字段（VERIFIER_DIAGNOSTIC_RESULT），
    移出 `verifier.warnings[]`（不影响 `valid`；因 `make-handoff` 投影 `verifier.warnings` → `handoff.warnings` 自然不再含 countMismatch）。
    真实实现合同：`src/verifier.js:145–158` 写入三诊断字段但不再 push warning；`scripts/make-handoff.mjs` 仍按原样
    投影 `verification.warnings`（T3 不改 schema，不改投影源）；`references/verification.md` §3 已同步为「DIAGNOSTIC_ONLY」
    描述。其他 warning / failure / handoff / 14 项 verify-output 权威语义不变。回归：matched counts 不产生
    countMismatch warning，且无其他 verifier failure 时保持 `valid=true`；mismatch-only 同样不影响
    `valid`；真实 verifier failure 继续 `valid=false`，保留对应 warning / failure 语义。Test coverage：
    `test/count-mismatch-diagnostic.test.js`（R2-5 六项 contract assertions + 8 项回归）+ 既有 `test/verify-output.test.js` P2-3
    已重写为 DIAGNOSTIC_ONLY 断言。Issue #4 product-problem record 是否 close 取决于 T3 exact reviewed SHA
    PASS + ff-only merge + 行为满足 #4 acceptance（见 Issue #9 close 流程）。
  - **大型语料四层能力**：CURRENT IMPLEMENTED（popular-sample / full-coverage digest / archive /
    **top-percent-analysis（T8 #14，2026-08-23 实现并合并）**）vs APPROVED TARGET（hierarchical full digest，
    **合同已批准（T9 #15，2026-08-23），CODE 待 T10**）。硬不变量 `SAMPLED_ANALYSIS != FULL_COVERAGE_DIGEST`
    ——指 **pipeline identity 保持分离**（`mode` 恒为 `top-percent-analysis`，绝不因 X=100 静默变 `digest`；
    `isFullCoverage` 是覆盖事实，非模式身份；仅 `mode=="digest"` 代表全量 digest 管线）；
    hierarchical full digest 必须保持 source coverage / evidence mapping / canonical source ID lineage。
    **top-percent selection + identity 合同已由 T7 #13 批准（2026-08-23，decision record：
    `docs/t7-top-percent-contract-decision.md`）**：`K=max(1,ceil(X/100×N))`、X∈[1,100] 整数（禁 0/小数/负/>100，
    非法 → invalid_input）、strict count 取前 K（无 tie 扩展）、排序 `(voteupCount DESC, canonical decimal
    answerId ASC)`（decimal 比较：先比数字位数再按位比，非 JS 字符串序/非 Number 转换）、mandatory --percent；
    X=100 不路由 digest（identity 恒 sampled，`isFullCoverage` 按覆盖事实为 true）；披露结构
    `totalAnswers/selectedAnswers/requestedPercent/actualCoveragePercent/selectionRule/selectedSourceIds/isFullCoverage`
    + `mode="top-percent-analysis"`；selectionRule 机器表示 `top-<X>-pct-voteup-desc-answerid-dec-asc-strict`；
    共享 handoff schema 不变（OPTION C，corpus 侧 selection.json scope + selectorHash）。
    **T8 #14 实现**（2026-08-23）：`lib/top-percent-selector.mjs`（确定性选择/validateSelection/selectorHash）、
    `scripts/select.mjs`（→ selection.json）、chunk `--mode top-percent-analysis --selection`、verify selection-scope
    门（selectionScopeIssues 交叉校验）、reduce `mode="top-percent-analysis"` + 披露块、render 7 项披露；
    digest/popular-sample/archive 零改动；测试 22 项（selector 14 + pipeline 8）。
    **hierarchical full digest 合同已由 T9 #15 批准（2026-08-23，MODIFY + APPROVE AS MODIFIED；
    decision record：`docs/t9-hierarchical-digest-contract.md`）**：
    架构 OPTION A additive explicit（flat digest 行为/消费合同不变、仍默认；V0.3 不自动路由）；
    ADAPTIVE 深度（nodeCount==1 终止；2≤childCount≤MAX_CHILDREN_PER_NODE 禁 single-child；
    nextLevel.nodeCount 严格递减；hierarchy_input_too_large fail closed）；controller 左到右贪婪分组
    （MAX_CHILDREN_PER_NODE / MAX_PROJECTED_INPUT_BUDGET 为 reviewed runtime/execution profile
    parameters，T10 从 qualified runtime 推导）；HYBRID lineage（child refs + controller materialized
    union；每层递归覆盖不变量 union(children)==parent；COVERAGE ≠ CLAIM EVIDENCE）；fail-closed 验证；
    stale 向上传播（依赖祖先失效、无关 sibling 可复用）；T9 原始批准合同 runtime 限定：
    **仅 lmstudio-local-tool-less**；无静默 fallback；
    （历史限定：该原始 runtime 限定在 T11-R2 由独立资格通过的 `deepseek-api-tool-less` **加性扩展**，
      hierarchy 节点/manifest runtime 身份已线程化真实传输；见下文 V0.3 Runtime Closeout。）
    final.json 消费合同不变（mode="digest" flat/hierarchical 一致）。
    实测证据：reduce-input 线性增长（38→9.6K chars；538→134.7K chars，ESTIMATED 52-95K token），
    顶层撰写阶段是压力点。
    **T10 #16 实现**（2026-08-23）：`lib/hierarchy.mjs`（packGroups 贪婪分组 / nodeHash /
    inputHash / controller materialized union / validateHierarchy 递归覆盖不变量）、
    `map.mjs --hierarchy`（L1 maps 后自适应聚合，L2 合成经 T6 控制器 tool-less/json_schema）、
    verify hierarchyIssues 门、reduce 顶层节点 claims → final.json（mode="digest" 消费合同不变）。
    实测性能（合成 538 源，MEASURED）：reduce-input 192.9KB/538 claims → 105.8KB/7 顶层 claims
    （claims -98.7%、bytes -45.2%）。flat digest 行为不变；hierarchy 显式启用不自动路由。
- **V0.3 Runtime Closeout（2026-08-24，V0_3_EXECUTION_COMPLETE）**：真实 dogfood 在约 79 / 183 / 318
  回答带（另加 47 补充语料）完成，全五类 run（capture / archive / popular-sample / top-percent /
  hierarchical full digest）全部通过确定性验证。
  - `lmstudio-local-tool-less`：独立能力资格通过（`CAPABILITY_ISOLATION_AVAILABLE = YES`，runtime-scoped），
    保留为有效本地 runtime；真实 dogfood 暴露 Qwen3 1.7B 在该工作负载下的模型质量限制（概率性输出身份污染、
    数字 confidence 越界、自指文本回显循环）——这些是**模型质量观测**，不否定其能力隔离。
  - `deepseek-api-tool-less`：独立能力资格通过（`CAPABILITY_ISOLATION_AVAILABLE = YES`，provider/runtime-specific），
    用于完成 V0.3 真实 dogfood；该资格**不得推广**为任意 OpenAI 兼容 provider 支持。
    云出网批准仅限 V0.3 T11 公开知乎语料，**不得推广**到私密 / 敏感语料（私密语料云策略需独立授权）。
  - 协议硬化（T11-R1 #27）：模型输出移除 sourceId（身份 controller 确定性归属）、confidence 枚举化
    high/medium/low、投影 meta 去 voteupCount；RCA 纠正确认生产 L1/hierarchy 本就使用短不透明 token。
  - **持久教训**：能力隔离与模型质量是独立轴；可信 controller 拥有 canonical 源身份 / 源覆盖 /
    证据 lineage / 结构化校验 / fail-closed 权威，模型只拥有语义生成。
  - **排序教训**：不得让较弱 / 本地 runtime 成为产品验证的阻断依赖，除非隐私、离线、实测成本、
    实测时延、可用性或已批准需求确实要求。
  - **成本教训**：先实测真实成本，再围绕假设的成本优化架构。
- **V0.3 关键 gate（immediate）**：T3 countMismatch / T4+T5 Agent consumer & isolation feasibility /
  T7 top-percent contract（**已批准，2026-08-23**）/ T9 hierarchical digest contract（**已批准，2026-08-23**）。
  各 T 遵循 Spec gate，不无条件并行。
- **DEFERRED（长期，未经批准不得开始）**：
  - browser-smoke 高级 matcher 硬化（provenance / 折叠形态 / link-card 归一化）
  - 旧 cross-shell Architecture Grill 设计线：不恢复
  - 注：Phase 5 实现 / Agent projection（原 DEFERRED 项）已转为 V0.3 当前工作进行（决策 C）；
    video（原 DEFERRED 项）已转为 V0.3 决策 B 永久 DO_NOT_SUPPORT，不再属于 DEFERRED；
    **研究流程自动化（research pipeline automation）已由 Research Orchestration Approved Spec
    显式授权 MVP（2026-08-24，见下文 Research Orchestration 段）**，不再属于 DEFERRED。
- **BROWSER_SMOKE_ROLE（持久）**：`browser-smoke` = **尽力而为的外部一致性诊断**
  （best-effort external diagnostic），**不是产物有效性权威**；verify-output 才是
  确定性产物有效性权威（RULES §4）。其 PASS / FAIL / INCONCLUSIVE 不影响
  verify-output 结论；渲染 / gate-page / DOM 歧义导致无法可靠结论时 INCONCLUSIVE
  可接受。**REOPEN 条件**：仅当 1) 明确新产品需求 / 用户授权，且 2) 对拟议匹配
  语义有足够的结构性浏览器证据（扁平 innerText 无法确定性恢复 body-vs-card-title
  provenance——不重开该类纯文本 heuristic 工作）。
- 后续阶段开始前：从**届时最新的 remote master** 创建（或重建）其 feature 分支；不依赖任何历史临时分支 ref 作为长期事实。

## Research Orchestration（APPROVED + IMPLEMENTED（MVP），2026-08-24）

- **Spec**：`docs/specs/research-orchestration-scope.md`（Approved implementation contract，原 Issue #5 的规范化 successor）。
- **当前状态（durable）**：`STATUS: APPROVED` · `IMPLEMENTATION_STATUS: IMPLEMENTED (MVP, #30)` ·
  `IMPLEMENTATION_AUTHORIZATION: MVP_AUTHORIZED` · `VERSION_ASSIGNMENT: UNASSIGNED` ·
  `PRODUCT_STAGE: NEXT_STAGE / RESEARCH_ORCHESTRATION`。
- **产品决策（R1–R5 APPROVED；R6–R7 DELEGATED_IMPLEMENTATION_DESIGN）**：自然语言研究意图 +
  概念 `research <topic>`（exact CLI 属 implementation detail）；自动选择最相关问题（MATERIAL AMBIGUITY →
  最多一次 clarification）；默认 FULL-COVERAGE RESEARCH（大 corpus 用 hierarchical full digest，sampled 仅显式意图）；
  公开知乎研究默认 runtime = `deepseek-api-tool-less`（NO_SILENT_RUNTIME_FALLBACK；public egress ≠ private/sensitive egress）；
  最小可恢复 orchestration state 与 stage progress / graceful stop-resume 由实现设计。
- **实现事实（durable，#30 merged @ a9dcd4f，2026-08-24）**：
  - 入口：`node research-orchestration/bin/research.mjs "<topic>"`（thin controller，仅 spawn 既有 zhihu/corpus primitives，零 reimplementation）；
  - 编排阶段：SEARCH → SELECT → CAPTURE → VERIFY → HANDOFF → ANALYZE → RENDER → COMPLETE（+ FAILED）；退出码 0/1/2/3（3 = CLARIFICATION_REQUIRED，`--select <qid>` 恢复）；
  - 候选选择：确定性词法相关性（CJK char+bigram），clear best → auto-select（决策写入 selection-decision.json）；歧义 → 结构化 clarification；无候选 → `no_valid_candidate` fail-closed；
  - 分析路由：generic → full-coverage digest（>32K chars 自动 hierarchical full digest）；显式 sampled 意图（快速看看/只看高赞/前X%的回答/sampled view/不需要全量 等）→ top-percent-analysis + 完整披露（isFullCoverage=false）；
  - 意图分类采用 **decision-boundary matrix 工程法**（见 `docs/project-memory/decision-boundary-matrix.md`）：保守默认 FULL-COVERAGE，全矩阵回归；
  - runtime：默认 `deepseek-api-tool-less`（preflight 失败 → `runtime_unavailable` fail-closed，无静默 fallback）；state 无凭据、work-relative 路径、非 canonical；
  - Acceptance A–L 已满足（focused 36/36 + zhihu 507/507 + corpus 185/185 + agent-pipeline 6/6；真实 dogfood：全量 digest / hierarchy 198 答 23 claims / sampled 40@20% 披露 / 自然歧义澄清）。
- **#5（HISTORICAL）**：CLOSED / `state_reason = not_planned` 是获批**前**记录的历史 close 分类，
  **不构成**实现禁止；#30 已作为其后继实现 ticket 完成（CLOSED / completed）。
- **不创建 V0.4**：VERSION_ASSIGNMENT 保持 UNASSIGNED 直至另行单独授权；V0.4 versioning 与 Research Orchestration MVP 分离。

## 历史 review 结论（沉淀）

- DOCUMENT gate（V2 Spec）：PASS（2026-08-09，Spec APPROVED）。
- CODE gate（Phase 1）：PASS @ `27e68c1`（P0/P1/P2 全 0，四轮 review：escape 完整性、framing 收口、lockfile registry、localhost namespace、cross-node 与 split-whitespace 绕过修复）。
- **CODE gate（Phase 2 — Rich Content Assets）**：PASS（2026-08-09），已纳入 accepted project baseline。
- **CODE gate（Phase 3 — Question Metadata）**：PASS（2026-08-10），已纳入 accepted project baseline。
- **CODE gate（Phase 4 — Comments Enrichment）**：PASS（2026-08-11），已纳入 accepted project baseline。
- 建议：停止无限制地静态加 gate，进入真实使用验证与按 Phase 推进。

## Maintenance Contract

- 本文件是 **Git tracked durable project memory**；GitHub master 是最终权威版本。
- `.workbuddy/memory/` 是 **non-authoritative runtime memory**（自动产生、ignored、可含临时上下文），只作参考输入，不覆盖本文件及任何 repo-tracked authority。
- **任务开始必须读取本文件**；缺失时 STOP 并报告 `PROJECT_MEMORY_MISSING`。
- **memory decision 分两类，按任务角色执行**：
  - **PRE-GATE TASK**（实现 / 文档 / 修复 / research / smoke）：结束前必须判断 `PROJECT_MEMORY_UPDATE_REQUIRED: YES | NO`。YES 时随**当前 task branch** 更新本文件并进入同一次 independent review；NO 时不得修改本文件（工作树保持 clean）。
  - **INDEPENDENT REVIEWER**：必须判断 `POST_GATE_MEMORY_UPDATE_REQUIRED: YES | NO`。YES 时 reviewer **不修改被审 branch**；被审 branch 按 reviewed HEAD 正常 merge 后，依 `AGENTS.md` §10.3 创建独立 `docs/memory` follow-up branch 更新本文件，单独通过 independent review 后才能 merge；NO 时不产生 post-gate memory follow-up。
- **pre-gate durable knowledge 随产生它的 task branch 一起 review**；**gate-generated durable knowledge**（如 final gate conclusion、accepted checkpoint）如需沉淀，走独立 post-gate memory follow-up（reviewer 只报告 `POST_GATE_MEMORY_UPDATE_REQUIRED`，不修改被审 branch）。
- **Git history 足以保存的纯 SHA / merge 状态无需机械复制进本文件**；不要为了把 gate PASS 写进来而制造 review loop。
- 只有 **durable + verified + project-level + non-sensitive** 的信息才进入本文件。
- 禁止写入：current HEAD / current master SHA（除非作为 historical approved checkpoint）/ 临时 branch 存在性 / workspace path / 本机用户名 / backup path / credentials / private runtime state / 临时 task progress / scratch reasoning / 未经确认的猜测。
- 本文件不是 changelog：不记录 commit history / daily log / task log / review transcript；信息失效时更新为新的长期事实或标注 historical checkpoint，不向尾部无限堆日志。
- 所有 project-memory 更新都必须被 **independent review** 覆盖：pre-gate update 随原 task branch review；post-gate update 随独立 `docs/memory` follow-up branch review。不得声称 post-gate update 必须留在产生 gate 结论的原 task branch。通过 review 后才进入 GitHub master。
