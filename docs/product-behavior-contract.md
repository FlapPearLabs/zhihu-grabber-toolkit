# Product Behavior Contract — zhihu-grabber-toolkit

- **Status**: APPROVED（经独立 DOCUMENT review PASS 后合并 master）
- **Type**: DOCUMENT（Product Behavior Contract）
- **Scope**: 本文件只定义产品行为合同，**不包含任何实现代码**。

## 0. 权威角色澄清（Authority Roles）

以下为持久产品角色，任何后续阶段不得改变：

```text
VERIFY_OUTPUT_ROLE:
  verify-output = 产物有效性的确定性权威（deterministic artifact validity authority）
  （RULES §4；captured ≠ verified；valid === true 唯一授予路径）

BROWSER_SMOKE_ROLE:
  browser-smoke = 尽力而为的外部一致性诊断（best-effort external diagnostic）
  - 不是产物有效性权威；其 PASS / FAIL / INCONCLUSIVE 不影响 verify-output 结论
  - 浏览器渲染 / gate-page / DOM 歧义导致无法可靠结论时，INCONCLUSIVE 是可接受结果
  - INCONCLUSIVE ≠ 产物无效
  - 高级 matcher 硬化（provenance / 折叠形态 / link-card 归一化）不是 standing
    requirement；未来任何 matcher 工作需同时满足：
      1) 明确的新产品需求 / 用户授权
      2) 对拟议匹配语义足够的结构性浏览器证据
    （扁平 innerText 无法确定性恢复 body-vs-card-title provenance——不重开
      该类纯文本 heuristic 工作，除非存在更强的结构性浏览器证据）
```

## 1. 权威层级（AUTHORITY POSITION）

本文件是 **AUTHORITATIVE_PRODUCT_BEHAVIOR_SOURCE**（产品行为的权威现状与决策记录），
**从属于**以下更高权威（发生冲突时以更高权威为准）：

1. `AGENTS.md`（执行 / branch / review 工作流）
2. `RULES.md`（hard project / safety invariants）
3. Approved Specs（`docs/specs/v2-rich-content-fidelity.md`，产品需求唯一事实来源）

**SPEC_CONFLICT 流程**：若本合同任何期望的产品决策与 Approved Spec 冲突：

```text
SPEC_CONFLICT
→ STOP 该决策
→ 在 §6 记录冲突
→ 不得在本 ticket 内修订 Spec
→ 不得静默选择另一个行为
→ 冲突经 Spec amendment + DOCUMENT review 处理
```

**修订规则**：本合同一经 APPROVED，任何后续修改（含行为变更决策）必须经独立
DOCUMENT review；行为变更 CODE 票必须引用本合同对应条款作为需求依据。

## 2. 阅读指引（每项行为的五个字段）

每个行为统一以下列形式描述，**不混淆"当前事实"与"期望政策"**：

```text
CURRENT_BEHAVIOR:      仓库当前实际行为（可复现事实）
PRODUCT_DECISION:      批准生效的产品行为（= 后续一致同意的契约）
RATIONALE:             为什么（产品/安全/兼容性理由）
AUTHORITY / EVIDENCE:  现状规则的来源（HELP / Spec / references / 测试 / 代码）
IMPLEMENTATION_IMPACT: NONE / CONDITIONAL_FUTURE_TICKET / SPEC_CONFLICT
```

有效决策值（不一定每个都要新功能）：

```text
KEEP_CURRENT_BEHAVIOR    保持现状（现有行为即产品行为）
DO_NOT_SUPPORT            明确不支持（当前阶段）
DEFER_UNTIL_EVIDENCE      待证据/需求出现再决策
FUTURE_CODE_TICKET_REQUIRED  需要后续 CODE 票（本文件不实现）
```

---

## 3. 十四项产品行为决策

### 3.1 Accepted inputs（接受的输入）

```text
CURRENT_BEHAVIOR（真实实现）:
  - grab <input> 解析（normalizeQuestionInput）：
      * 输入 trim 后为纯数字 → 直接作为 candidate
      * 否则在字符串中搜索子串 /question\/(\d+)/，命中则取 <digits> 为 candidate
        （不校验 URL scheme / hostname / 是否为合法 URL；任意含
        "question/<digits>" 子串的字符串都可能被接受，
        如 https://evil.example/question/123、foo-question/123）
      * candidate 再经 validateQuestionId 强制 1-20 位纯数字
      * 非法输入 → invalid_input
  - batch <file>：文件级静态校验（存在、非空、trim、跳过空行/# 注释行）
    在 loadConfig 之前完成；但【逐行】问题输入校验并不前置——
    发生在 loadConfig 之后、cmdGrab 内部。单项失败【不会 abort 其余
    batch items】，但任一 failed item 会使顶层 batch result
    non-success（ok=false / exit 1），该失败行以 invalid_input 分类
    记录进 failed[]。凭据缺失时 batch 在逐行校验前即整体
    configuration_error。
  - search <keyword>：位置参数必须非空（缺参 → invalid_input）；
    需要解析 Access Secret（resolveSecret）；机器/人类行为与当前
    实现一致（search 只列候选，Agent 不调用 --grab）。
  - 解析接受后的请求 URL 一律由代码构造为受信知乎 URL
    （https://www.zhihu.com/question/<qid>），不信任用户输入原文；
    HTTP 层另有主机白名单（仅 www.zhihu.com 携带凭据/签名）。

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR
  - grab 接受：纯数字 ID，或任意含 "question/<digits>" 子串的字符串
    （覆盖无 scheme 链接、m.zhihu.com、/answer/ 分段 URL 等真实形态）
  - grab 拒绝：不含 question/<digits> 且非纯数字 → invalid_input
  - batch：文件级静态校验前置；逐行校验保持在后（cmdGrab 内），
    失败行 → failed[] 中 invalid_input 分类；单项失败不 abort 其余，
    但任一 failed item 使顶层 ok=false / exit 1（与 §3.5 一致）
  - search：接受非空关键词（缺参 → invalid_input）；需要 Access Secret
  - 不引入"精确 URL scheme/host 白名单"输入校验

RATIONALE:
  - 输入面宽松解析是有意保留的兼容性设计：知乎问题链接有多种合法形态
    （无 scheme / m.zhihu.com / 带 /answer/ 分段等），收紧到精确
    https://www.zhihu.com 校验会拒绝真实可用输入
  - 安全边界不依赖输入校验：请求 URL 恒由代码构造为受信知乎 URL，
    HTTP 层主机白名单保证凭据/签名不外发（RULES §1）
  - batch 逐行校验在凭据之后的现状可预测：凭据缺失时"先修凭据"
    是正确用户路径；凭据可用时非法行以 invalid_input 分类出现在
    failed[]，且使 batch 顶层 non-success（ok=false / exit 1）
  - search 输入面窄（关键词 + Secret），保持现状

AUTHORITY / EVIDENCE:
  src/grabber.js validateQuestionId / normalizeQuestionInput
    （纯数字 → candidate；否则 regex 子串搜索 question/(\d+)）
  src/cli.js readBatchInputs（文件级静态校验）/ cmdBatch / cmdGrab
    （逐行 normalizeQuestionInput 在 cmdGrab 内，loadConfig 之后）
  src/http.js assertAuthenticatedTarget（主机白名单）
  test/grabber.test.js（normalize/21 位拒绝）、test/cli-json.test.js（P1-2）

IMPLEMENTATION_IMPACT: NONE
```

### 3.2 Defaults（默认值）

```text
CURRENT_BEHAVIOR:
  - --out-dir 默认 ./out（相对当前工作目录）
  - --comments 默认 OFF（grab 不带 --comments 不产生任何评论请求）
  - browser-smoke --sample 默认 5（合法整数 1-20，越界 → invalid，exit 2）

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR

RATIONALE:
  output directory 与 credential directory 是两个独立配置维度：
  默认 output directory 仍为 cwd-relative ./out（ZAG_CONFIG_DIR 只控制
  凭据目录，不影响输出目录）；comments 默认 OFF 是请求面防护
  （Spec §15.1 NETWORK_REQUEST_DELTA = 0）；sample 上限防无限放大
  浏览器请求面。

AUTHORITY / EVIDENCE:
  src/cli.js parseArgs、src/http.js（comments OFF 时零请求）
  Spec §15.1 / §15.8、scripts/browser-smoke-core.mjs parseSampleSize

IMPLEMENTATION_IMPACT: NONE
```

### 3.3 Output-directory semantics（输出目录语义）

```text
CURRENT_BEHAVIOR:
  - 默认 ./out，每问题写入 out/<questionId>/ 子目录
  - 产物：answers.json / answers.md / .progress.json（以及可选的 handoff.json）
  - resolveQuestionDir 强制 containment：最终目录必须位于 out-dir 之下（防路径越界）
  - 机器输出（--json）中的路径一律相对路径（相对 cwd），不泄漏绝对路径
  - 已知缺陷（BUG_ID: B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE）：
    src/cli.js relPath 用 path.relative(process.cwd(), absPath)；Windows 下
    cwd 与 out-dir 跨盘时（如 cwd=D:\project、out-dir=C:\capture）无法产生
    正常 cwd-relative 路径，path.relative 返回 drive-qualified 路径 →
    机器 JSON 可能输出绝对路径，违反本合同的 no-absolute-path 要求

PRODUCT_DECISION:
  OPTION A —— 保持跨盘 --out-dir 受支持，但机器 artifact 路径【绝不】是绝对路径：
  1) 正常可表达时（cwd 与 out-dir 同盘或可相对）：
     保持现状 —— artifacts.json/markdown/progress 为 relative-to-cwd
  2) Windows cross-volume 无法 relative-to-cwd 时：
     artifacts 路径改为 relative-to-out-dir（不含盘符/前导斜杠），
     并新增结构化字段 artifacts.base（"cwd" | "outdir"）标明该批路径的基准，
     消费方按 resolve(<base 对应根>, path) 解析；
     禁止输出绝对路径 / drive-qualified 路径 / path.basename-only 丢身份

RATIONALE:
  每问题独立目录保证 artifact isolation；containment 防止 qid 被利用做目录穿越；
  相对路径是机器契约的脱敏要求（no-absolute-path 是不可弱化不变量）。
  cross-volume 场景下"relative-to-cwd"与"跨盘 out-dir"物理上无法同时满足，
  因此用显式 base 标识提供确定性、无歧义的替代语义（不禁止跨盘抓取，
  不把绝对路径放回 JSON）。仅 Windows 跨盘边界触发，正常场景零行为变化。

AUTHORITY / EVIDENCE:
  src/grabber.js resolveQuestionDir、src/cli.js relPath
  references/usage.md（输出文件、相对路径）、references/handoff-schema.md
  （handoff 内部 inputJson/inputMarkdown 是相对 handoff 所在目录的独立合同，
   不受本决策影响——handoff 由 make-handoff 自建路径，不消费 artifacts 字段）

IMPLEMENTATION_IMPACT: CODE_TICKET_REQUIRED（B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE
  修复：relPath 增加跨盘分支 + artifacts.base 字段；含 Windows/portable 回归测试。
  另需同步 references/usage.md §"路径一律相对路径" 的表述为"同盘 relative-to-cwd、
  跨盘 relative-to-out-dir + base"。本合同批准后开独立 CODE ticket）
```

### 3.4 Captured vs verified（抓取态与验收态）

```text
CURRENT_BEHAVIOR:
  - grab/batch 输出 stage: "captured"、verified: false——从不自行声称验收通过
  - verified: true 只能由 verify-output.mjs（valid === true）授予
  - status 分别报告 captureStatus（in_progress/captured）与 verificationStatus
    （unverified/valid/invalid）
  - make-handoff 只接受 valid === true 的产物；verified/answerCount/questionId 由代码构建

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR
  - captured ≠ verified；verify-output 是唯一验收权威（14 项校验）

RATIONALE:
  防止"抓取完成"被误报为"验收通过"；机器契约要求严格区分。

AUTHORITY / EVIDENCE:
  RULES.md §4（Verify-Output Authority）、src/verifier.js、
  scripts/verify-output.mjs、scripts/make-handoff.mjs
  Spec §5（V1 基线）、Spec §18.2（现有合同不变）

IMPLEMENTATION_IMPACT: NONE
```

### 3.5 Batch partial success（批量部分成功）

```text
CURRENT_BEHAVIOR:
  - batch 输出 succeeded[] / failed[]
  - ok = failed.length === 0；任一问题失败 → 顶层 ok:false 且 exit 1
  - 单问题失败不影响其余（顺序执行、逐条隔离）
  - succeeded[].warnings 保留（含 metadata/comments warning）

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR

RATIONALE:
  部分失败语义明确可预测；失败项由用户/Agent 重跑（依赖各问题续传状态）。

AUTHORITY / EVIDENCE:
  src/cli.js cmdBatch、test/cli-json.test.js（batch 脱敏 / 静态校验）
  Spec §18.2（batch 合同不变）

IMPLEMENTATION_IMPACT: NONE
```

### 3.6 Exit-code matrix（退出码矩阵）

```text
CURRENT_BEHAVIOR（实现实测）:
  0   命令成功（grab / batch 全成功 / search / status）
  1   batch 任一问题失败；任何命令错误（含 invalid_input / configuration_error /
      network_error / http_error / unknown_error）
  0   verify-output valid === true
  1   verify-output valid === false
  2   verify-output / browser-smoke 用法错误；browser-smoke inconclusive / 运行错误
  0   browser-smoke pass
  1   browser-smoke fail（mismatch）
  2   browser-smoke inconclusive（含环境不可用 / gate page / 配置失败）
  0   status：artifact invalid / unverified 本身不会使成功执行的 status
      命令非零；但 status 命令自身若发生未处理运行错误，仍走 main() 的
      统一 catch → exit 1

  结构化错误 type 枚举（以实现为准）:
    configuration_error / invalid_input / network_error / http_error /
    question_metadata_identity_conflict / unknown_error

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR（exit-code 矩阵按上表固化）
  【已校准 reference 漂移】references/usage.md 原错误枚举含 not_found 且
  未列 question_metadata_identity_conflict，与实现 classifyError 不一致
  （历史 drift：Approved V1 base 305db1c 时 usage.md 已含 not_found，
  而当时 classifyError 已无 not_found 分支，非新引入 regression）。
  本票内已校准 usage.md 错误枚举以实现为准（documentation-only，
  无运行时行为变更）；见 §6 D-1。

RATIONALE:
  机器契约可依赖；0/1/2 语义区分成功 / 失败 / 不确定（inconclusive 不得 exit 0）。

AUTHORITY / EVIDENCE:
  src/cli.js classifyError / main、scripts/verify-output.mjs、
  scripts/browser-smoke-core.mjs exitCodeForResult
  test/cli-json.test.js（错误分类）、test/browser-smoke.test.js（exit 语义）

IMPLEMENTATION_IMPACT: NONE
```

### 3.7 Machine JSON contract（机器 JSON 契约）

```text
CURRENT_BEHAVIOR（真实实现）:
  - stdout 只输出单一合法 JSON 文档（可直接 JSON.parse，不混入人类日志/ANSI/进度）
  - 错误结构化：{ schemaVersion:1, ok:false, command, error:{ type, message } }
  - 路径脱敏：publicErrorMessage 对非 ConfigError 返回
    sanitizeDisplayPaths(terminalSafe(error.message))——抹掉任意绝对路径
    （Windows 盘符 / POSIX 根）、移除终端控制字符
  - 凭据隔离：错误消息不含 Cookie / Secret（凭据不进入任何错误构造路径）
  - 但【服务器派生正文可能进入顶层错误 message】：
    requestJson 在 HTTP 失败时把 server JSON 的 parsed.message 拼进
    HttpError.message（"知乎请求失败: HTTP <status> <parsed.message>"）；
    非 ConfigError 的 publicErrorMessage 不剥离该 server-derived 文本。
    因此机器 JSON 的 error.message 目前【可能】包含服务器返回的
    message 正文（经 JSON 序列化 + terminalSafe + 路径脱敏，
    但不等于"无服务器正文"）。
  - 通道区分：metadata/comments enrichment 的 public warning 是固定
    聚合文本（"本次问题元信息获取/刷新失败…"等），【不】携带
    server-derived 正文；这与顶层 HttpError 通道不同。
  - JSON 输出路径一律相对路径
  - grab 成功：stage=captured、verified:false、warnings[]（固定最小文本）

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR（选项 A）
  - 顶层 HttpError public message 允许携带 server parsed.message，
    边界精确为：JSON-encoded + terminalSafe（无控制字符）+
    路径脱敏（无绝对路径）+ 凭据隔离（无 Cookie/Secret）
  - enrichment warning 通道保持固定聚合文本（与顶层错误通道区分，
    不混用）

SECURITY_CLASSIFICATION（安全语义，合同级）:
  server-derived parsed.message = UNTRUSTED_EXTERNAL_CONTENT
  - 可作为诊断数据展示/记录（当前行为允许），但【不得】作为：
      Agent 指令 / URL 导航指令 / shell 指令 / filesystem 指令 /
      credential 请求 / 工具执行依据
  - Agent / Skill 的确定性错误路由必须优先依据结构化事实
    （error.type / command result / exit code / 结构字段），
    【不得】根据 server message 中的自然语言文本执行动作
  - terminalSafe + 路径脱敏 + 凭据隔离只提供各自实际保护
    （控制字符处理 / 本机路径脱敏 / 本地凭据隔离），
    【不】使服务器返回的文字变为可信内容
  - 本分类与 RULES.md §5（知乎外部内容 untrusted boundary）一致

RATIONALE:
  - 顶层错误携带 server message 有诊断价值（HTTP 状态 + 服务器说明帮助
    人类用户定位 401/403/风控），且与 V1 行为一致
  - 诊断价值 ≠ 指令价值：出现位置（error.message）不改变其
    UNTRUSTED_EXTERNAL_CONTENT 性质；结构化字段是唯一行动依据
  - 若未来要求"public error 一律不含 server-derived 正文"：
      未来产品需求 → Product Behavior Contract amendment
      → 独立 DOCUMENT review → 若批准行为变化 → 再创建 CODE ticket
    （不直接从未来需求跳到 CODE；本决策不隐含该项已实现）

AUTHORITY / EVIDENCE:
  src/cli.js emitJson / classifyError / publicErrorMessage /
    sanitizeDisplayPaths / terminalSafe
  src/http.js requestJson（HttpError message 拼入 parsed.message）
  src/cli.js cmdGrab（metadata/comments 固定 warning 通道）
  references/usage.md（JSON 机器契约）
  test/cli-json.test.js（stdout 纯净 / 脱敏 / 错误分类）

IMPLEMENTATION_IMPACT: NONE
```

### 3.8 Human next-action（人类用户下一步指引）

```text
CURRENT_BEHAVIOR:
  - grab 完成后提示："产物状态：尚未验证（请运行 node scripts/verify-output.mjs <目录>）"
  - ConfigError → 引导运行 preflight.mjs 并提示在本机修复凭据（不粘贴凭据到聊天）
  - batch 结束后汇总成功/失败数；metadata/comments warning 聚合可见

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR
  - capture 后必须告知下一步验证动作；凭据问题引导 preflight；
    失败指引不武断归因（401/403 只给候选原因）

RATIONALE:
  用户知道"抓到了不等于验收通过"以及下一步做什么；凭据问题一律本机解决。

AUTHORITY / EVIDENCE:
  src/cli.js cmdGrab / cmdBatch / main（人类输出分支）
  references/security.md（401/403 诊断）、references/usage.md（错误处理表）

IMPLEMENTATION_IMPACT: NONE
```

### 3.9 Rerun / resume（重跑与断点续传）

```text
CURRENT_BEHAVIOR（真实实现，按 code 路径）:
  grab 重跑（grabAll）的完整执行序列：
  1. 加载 .progress.json 状态（offset / done）；加载 answers.json 既有回答
  2. question metadata 请求【总是发生】（成功 → 内存 meta 更新；
     失败 → metadata_failed warning + 保留兼容既有 question）
  3. done = state.done：
     - done === false → 从 saved offset 继续分页（seen-set 去重，
       每页写 answers.json 快照 + progress 原子保存）
     - done === true → while(!done) 分页循环【完全跳过】，不再请求任何回答页
  4. cmdGrab 随后【总是】用返回的 answers 重新渲染 answers.md（派生视图）
  5. comments 分支（仅 --comments 时）：
     - selected-answer comments enrichment 在分页之后【仍会执行】，
       可能按 Spec §15.7 语义新增/替换既有 answer.comments
     - enrichment 完成后写最终 canonical 快照（新 meta + answers）
  6. 磁盘写入语义（done=true 重跑时）：
     - comments OFF：无分页、无最终 writeJson → answers.json 保持
       磁盘原样（新 metadata 不持久化）；answers.md 被重新渲染
     - comments ON：enrichment 后 writeJson 会用新 meta + comments
       变更重写 answers.json

  核心字段语义：
  - 既有 core answer 字段 / assets 不被 resume 反向改写（backfill）
    ——只有分页新抓取的答案才带 assets
  - comments 字段是唯一可能被 enrichment 新增/替换的既有字段
    （仅 --comments 时；Spec §15.7 B/C/D 语义）

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR
  - resume-merge 是唯一重跑语义；不提供 clean-restart（见 §3.10）
  - done=true 的 completed rerun 保持上述"metadata 刷新 + md 重渲染 +
    分页跳过"语义（不新增"强制重新分页"行为）

RATIONALE:
  断点续传保证中断可恢复、不丢数据、不重复；completed rerun 的
  md 重渲染语义保证产物视图始终与最新 meta 一致；comments 行为
  由 Spec §15.7 明确定义。与 V1 合同一致。

AUTHORITY / EVIDENCE:
  src/grabber.js grabAll（state.done → while(!done) 跳过；
    metadata 请求前置；comments 分支在循环后；writeJson 条件执行）
  src/cli.js cmdGrab（renderAnswers 总是执行）
  Spec §15.7（comments B/C/D 语义）、references/usage.md

IMPLEMENTATION_IMPACT: NONE
```

### 3.10 Clean restart / fresh（弃旧重抓）

```text
CURRENT_BEHAVIOR:
  - 无 --fresh / --force 选项
  - 重复 grab 恒为 resume-merge；"弃旧重抓"当前只能手工删除 out/<qid>/ 目录

PRODUCT_DECISION:
  DO_NOT_SUPPORT（当前阶段）
  - 明确决定：不实现 --fresh / --force；resume-merge 是唯一重跑语义
  - 若未来出现明确的 clean-restart 产品需求 → 另行产品决策（DOCUMENT review）后再实现

RATIONALE:
  当前无产品需求证据；避免为投机功能引入破坏性/覆盖语义（resume 已保证
  不丢数据）。新增破坏性选项必须先定义其覆盖边界，风险高于收益。

AUTHORITY / EVIDENCE:
  src/cli.js（无相关选项）、src/grabber.js（resume 逻辑）
  本审计 finding F-04（PRODUCT_AMBIGUITY）

IMPLEMENTATION_IMPACT: NONE（保持现状；不创建代码票）
```

### 3.11 Corrupt-artifact recovery（损坏产物恢复）

```text
CURRENT_BEHAVIOR:
  - 读取损坏文件（answers.json / .progress.json）→ corruptError 改名 .corrupt-<ts> 并抛错
    （不静默当空、不删除原文件）
  - verify-output 将 .corrupt-* 残留作为失败条件（check 12）
  - 无 CLI 清理命令；用户需手工删除/检查 .corrupt-* 文件
  - grab 下次重跑会重建 answers.json，但 .corrupt-* 残留仍使 verify 失败直到手工清理

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR + 明确"不自动清理"
  - fail-closed 保留：损坏文件改名备份 + verify 拦截 + 人工介入清理
  - 明确决定：不实现自动清理（自动删除可能误删用户数据；保留人工检查路径）
  - 若未来需要 cleanup 命令 → 另行 DOCUMENT 决策

RATIONALE:
  损坏文件不静默当空处理（防数据覆盖）；自动清理会隐式改变用户文件状态，
  与"用户自有数据保护"原则冲突。

AUTHORITY / EVIDENCE:
  src/grabber.js corruptError、src/verifier.js（check 12 = .corrupt-* files）
  本审计 finding F-03

IMPLEMENTATION_IMPACT: NONE
```

### 3.12 Batch failed-question retry（批量失败项重试）

```text
CURRENT_BEHAVIOR:
  TRANSPORT RETRY（已存在）:
    requestJson 默认 retries=2：429/5xx/网络失败指数退避（1s/2s + 抖动，上限 30s，
    优先遵循 Retry-After）；单页最多 3 次实际 HTTP 尝试
    （comments 请求例外：显式 retries=0，预算合同 Spec §15.3）

  BATCH-LEVEL RETRY（不存在）:
    batch 中失败的问题只记录 failed[]，不自动重试；由用户/Agent 重跑整文件
    （各问题依赖自身续传状态继续）

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR
  - transport retry：保持（既有 HTTP 层重试）
  - batch 自动重试：DO_NOT_SUPPORT（当前阶段）
  - 若未来要新增 batch failed-question retry 策略（次数/退避/幂等/请求预算）
    → 必须先经产品决策（DOCUMENT review），不得直接实现

RATIONALE:
  区分两层 retry 避免混用；batch 自动重试涉及新请求预算语义，须先定义契约；
  当前失败→重跑的行为已可预测。

AUTHORITY / EVIDENCE:
  src/http.js requestJson（retries/backoff）、src/grabber.js（comments retries=0）
  src/cli.js cmdBatch（failed[] 语义）、Spec §15.3（comments 预算）
  本审计 finding F-05

IMPLEMENTATION_IMPACT: NONE
```

### 3.13 Overwrite / destructive behavior（覆盖与破坏性行为）

```text
CURRENT_BEHAVIOR:
  - resume 非破坏：answers.json 每次写快照 = 既有 + 新增（seen-set 去重），非静默覆盖
  - answers.md 每次全量重渲染（派生视图，canonical content 永不回写）
  - .progress.json 每次保存覆盖（断点状态）
  - 损坏文件改名备份（.corrupt-*）而非删除
  - 无任何自动删除用户文件的操作

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR
  - resume 不静默破坏已有数据；派生视图（answers.md）可重写；损坏文件改名而非删除；
    用户自有文件不被隐式删除

RATIONALE:
  与 Spec §6.1（canonical content 不可变）和 RULES §3（渲染不回写 canonical）一致；
  破坏性最小化。

AUTHORITY / EVIDENCE:
  src/grabber.js writeJson / corruptError、src/render.js renderAnswers
  Spec §6.1、RULES.md §3

IMPLEMENTATION_IMPACT: NONE
```

### 3.14 Credential / cookie boundary（凭据边界）

```text
CURRENT_BEHAVIOR:
  Cookie 来源优先级：ZHIHU_COOKIE 环境变量 > 凭据目录 zhihu_cookie.txt
    （ZAG_CONFIG_DIR 或 cwd）> ~/.zhihu-cli/config.json
  Access Secret：ZHIHU_SECRET 环境变量 > 凭据目录 zhihu_secret.txt（仅 search 需要）
  保护：
    - 拒绝 symlink 凭据文件（防指向非预期文件）
    - POSIX 下要求 0600 权限（过宽拒绝）
    - 凭据绝不进入 repo / log / 聊天 / JSON 产物 / Markdown / 长期记忆 / 错误消息
    - preflight 只输出布尔值与错误类型（不输出值/长度/前缀/哈希）
    - 认证头只发往 https://www.zhihu.com（主机白名单）
  配置错误 → configuration_error + 引导 preflight（本机修复，不粘贴凭据）

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR

RATIONALE:
  凭据安全是最高优先级硬约束（RULES §1）；来源优先级稳定；零泄漏面。

AUTHORITY / EVIDENCE:
  RULES.md §1、src/config.js（loadConfig / resolveSecret / assertSafeCredentialFile）
  references/security.md、test/preflight.test.js
  src/http.js assertAuthenticatedTarget

IMPLEMENTATION_IMPACT: NONE
```

---

## 4. 决策汇总

```text
KEEP_CURRENT_BEHAVIOR:          3.1 / 3.2 / 3.4 / 3.5 / 3.6 / 3.7 / 3.8 / 3.9 /
                                3.11 / 3.12(transport) / 3.13 / 3.14
OPTION A（跨盘路径规则，替代 3.3 的 KEEP_CURRENT）:
                                3.3 —— 机器 artifact 路径绝不绝对；
                                同盘 relative-to-cwd 保持现状；
                                Windows cross-volume 时 relative-to-out-dir
                                + artifacts.base 字段（见 §3.3）
DO_NOT_SUPPORT（当前阶段）:      3.10（clean-restart / --fresh）、
                                3.11（corrupt 自动清理）、
                                3.12（batch 自动重试）
DEFER_UNTIL_EVIDENCE:           无（当前无待证据决策；如未来出现 clean-restart /
                                corrupt-cleanup / batch-retry 需求，重新走 DOCUMENT 决策）
FUTURE_CODE_TICKET_REQUIRED:    1 项 —— 3.3（B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE
                                修复：relPath 跨盘分支 + artifacts.base 字段 +
                                Windows/portable 回归测试；基于本合同批准后开独立
                                CODE ticket）
                                （注：§3.1 输入严格化、§3.7 剥离 server message 等
                                "未来可能的行为变化"一律走：
                                未来产品需求 → 本合同 amendment → 独立 DOCUMENT
                                review → 若批准 → 再创建 CODE ticket；
                                不得直接从未来需求跳到 CODE）
```

**关键结论**：本合同 13 项决策保持现状或明确不支持；**1 项（§3.3）已批准跨盘路径规则变化**（B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE 修复依据），该变化仅影响 Windows 跨盘边界的机器路径表示，正常场景零行为变化。T-2（batch 回归测试）已按 §3.1-§3.14 边界推进；不因本合同产生投机功能。

---

## 5. SPEC_CONFLICT 记录

```text
SPEC_CONFLICTS: NONE
```

本合同 14 项决策均与 Approved Spec（docs/specs/v2-rich-content-fidelity.md）一致：
- comments 默认 OFF / 仅 grab 支持（Spec §15.1/§15.8）→ §3.2
- captured ≠ verified / verify-output 权威（Spec §5、§18.2）→ §3.4
- canonical content 不可变 / additive only（Spec §6.1/§18.1）→ §3.13
- 请求预算 / 限速（Spec §15.3、§21.1.8）→ §3.2/§3.12
- 凭据隔离（Spec §21.1.7、RULES §1）→ §3.14

未发现任何需要修订 Spec 的冲突。

---

## 6. 实现与已批准合同的一致性核查

```text
CURRENT_IMPLEMENTATION_CONTRACT_VIOLATIONS: NONE
```

审计对照 Approved Spec 与实现（grabber / cli / http / verifier / make-handoff /
browser-smoke-core）未发现实现违反已批准合同的情况。

**已记录 reference 文档漂移（非 Spec violation）**：

```text
OBSERVATION D-1（已在本票内校准）:
  references/usage.md 的错误类型枚举声明含 not_found，且未列
  question_metadata_identity_conflict；实际实现（src/cli.js classifyError）
  无 not_found 分支，但有 question_metadata_identity_conflict。
  独立 review 确认：Approved V1 base（305db1c…）时 usage.md 已含 not_found，
  而当时 classifyError 已无 not_found 分支 → 历史 reference drift，
  非本阶段新引入的 runtime regression。
  → 本票已在 docs/product-behavior-contract 分支内校准 usage.md 错误枚举
    （documentation correction only，runtime behavior unchanged）：
    移除 not_found（确认非活跃分类）；加入 question_metadata_identity_conflict。
```

```text
OBSERVATION D-2（已在本票内校准）:
  SKILL.md（zhihu-answer-grabber/SKILL.md）错误类型示例文本
  （"configuration_error|invalid_input|network_error|http_error|unknown_error"）
  未列 question_metadata_identity_conflict。
  → 与 usage.md 同类 drift（Agent 编排入口文档与实现不一致，合并后会造成
     Product Contract / usage.md / runtime 一套枚举、SKILL.md 另一套）。
  → 本票已校准 SKILL.md 该行（加入 question_metadata_identity_conflict），
    documentation/orchestration-contract-only，未改动任何 Skill workflow 行为。
```

---

## 7. 维护与修订流程

1. 本合同一经独立 DOCUMENT review APPROVED，即成为后续行为决策的权威现状/决策记录。
2. 任何行为变更 CODE 票必须引用本合同对应条款（§3.x）作为需求依据。
3. 任何对本合同的修改（含新增决策、变更决策）必须经独立 DOCUMENT review；
   与 Approved Spec 冲突的决策必须先走 SPEC_CONFLICT 流程（§1）。
4. 本合同不取代、不覆盖 AGENTS.md / RULES.md / Approved Spec；冲突时以更高权威为准。
