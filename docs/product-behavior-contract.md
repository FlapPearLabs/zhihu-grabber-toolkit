# Product Behavior Contract — zhihu-grabber-toolkit

- **Status**: DRAFT（本文件需经独立 DOCUMENT review PASS 后方为 APPROVED）
- **Type**: DOCUMENT（Product Behavior Contract）
- **Base**: `master` @ `f614e3683630670b321ac79659d9137f7134a161`
- **Branch**: `docs/product-behavior-contract`
- **Scope**: 本文件只定义产品行为合同，**不包含任何实现代码**。

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
CURRENT_BEHAVIOR:
  - question URL（含 https://www.zhihu.com/question/<digits>）或纯数字问题 ID（1-20 位）
  - batch 文件：每行一个问题链接/ID，逐行 trim、跳过空行与 # 注释行；文件缺失/为空 → invalid_input
  - search：关键词（需要 Access Secret）
  - 非法/无法识别输入（非纯数字、非 question/<digits> URL、超长数字）→ invalid_input
  - 静态输入校验先于凭据检查（invalid_input 不依赖凭据状态）

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR
  - 接受：question URL / 纯数字 ID / batch 文件 / search 关键词
  - 拒绝：其余一切 → invalid_input（静态校验先于凭据 / 网络 / capture side effect）

RATIONALE:
  纯数字白名单（1-20 位）防路径注入与 ID 混淆；静态校验前置保证错误分类稳定、
  不因凭据状态而漂移；batch 行内注释支持便于维护列表。

AUTHORITY / EVIDENCE:
  src/grabber.js validateQuestionId / normalizeQuestionInput
  src/cli.js parseQuestionId / readBatchInputs（invalidInput 标记）
  test/grabber.test.js（normalize/21 位拒绝）、test/cli-json.test.js（P1-2 静态前置）

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
  out-dir 默认与 cwd 解耦（可 ZAG_CONFIG_DIR / --out-dir 显式指定）；
  comments 默认 OFF 是请求面防护（Spec §15.1 NETWORK_REQUEST_DELTA = 0）；
  sample 上限防无限放大浏览器请求面。

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

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR

RATIONALE:
  每问题独立目录保证 artifact isolation；containment 防止 qid 被利用做目录穿越；
  相对路径是机器契约的脱敏要求。

AUTHORITY / EVIDENCE:
  src/grabber.js resolveQuestionDir、src/cli.js relPath
  references/usage.md（输出文件）、references/handoff-schema.md（相对路径）

IMPLEMENTATION_IMPACT: NONE
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
  0   status 恒 0（即使某产物 invalid——status 自身执行成功）

  结构化错误 type 枚举（以实现为准）:
    configuration_error / invalid_input / network_error / http_error /
    question_metadata_identity_conflict / unknown_error

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR（exit-code 矩阵按上表固化）
  【已记录文档漂移】references/usage.md 的错误枚举含 not_found 且未列
  question_metadata_identity_conflict，与实现 classifyError 不一致；
  本合同以实现为准。该 usage.md 漂移属 reference 文档问题，后续另行处理，
  不属于本 ticket 修改范围。

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
CURRENT_BEHAVIOR:
  - stdout 只输出单一合法 JSON 文档（可直接 JSON.parse，不混入人类日志/ANSI/进度）
  - 错误结构化：{ schemaVersion:1, ok:false, command, error:{ type, message } }
  - 错误消息脱敏：无绝对路径（sanitizeDisplayPaths）、无凭据、无服务器正文、无注入行
  - JSON 输出路径一律相对路径
  - grab 成功：stage=captured、verified:false、warnings[]（固定最小文本）

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR

RATIONALE:
  Agent 优先 --json 机器契约；错误面统一脱敏是凭据安全（RULES §1）与路径脱敏
  （RULES §9）的落地。

AUTHORITY / EVIDENCE:
  src/cli.js emitJson / classifyError / publicErrorMessage / sanitizeDisplayPaths
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
CURRENT_BEHAVIOR:
  - 重跑同命令（grab <qid>）自动续传：读 .progress.json（offset/done）+ answers.json
  - seen-set 去重：已有答案不被重复添加；旧答案（无 assets/comments）不被改写
  - 每页成功即写 answers.json 快照 + 保存 progress（tmp+rename 原子写）
  - answers.md 每次全量重渲染（派生视图）
  - 中断后重跑从 saved offset 继续；已完成的（done=true）再跑也会重新执行分页循环

PRODUCT_DECISION:
  KEEP_CURRENT_BEHAVIOR
  - resume-merge 是唯一重跑语义；不提供 clean-restart（见 §3.10）

RATIONALE:
  断点续传保证中断可恢复、不丢数据、不重复；与 V1 合同一致。

AUTHORITY / EVIDENCE:
  src/grabber.js ProgressStore / loadExistingAnswers / grabAll
  references/usage.md（断点续传不生效排查）、Spec §5（V1 基线）

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
KEEP_CURRENT_BEHAVIOR:          3.1 / 3.2 / 3.3 / 3.4 / 3.5 / 3.6 / 3.7 / 3.8 / 3.9 /
                                3.11 / 3.12(transport) / 3.13 / 3.14
DO_NOT_SUPPORT（当前阶段）:      3.10（clean-restart / --fresh）、
                                3.11（corrupt 自动清理）、
                                3.12（batch 自动重试）
DEFER_UNTIL_EVIDENCE:           无（当前无待证据决策；如未来出现 clean-restart /
                                corrupt-cleanup / batch-retry 需求，重新走 DOCUMENT 决策）
FUTURE_CODE_TICKET_REQUIRED:    无（本合同全部决策保持现状，不产生实现票）
```

**关键结论**：本合同 14 项决策**全部保持现状或明确不支持**，不引入任何新的产品行为。
T-2（batch 回归测试）与 T-3（browser matcher 修复）可按各自边界推进，不会因本合同
产生新的投机功能。

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

**已记录 reference 文档漂移（非 Spec violation，不属本 ticket 修改范围）**：

```text
OBSERVATION D-1:
  references/usage.md 的错误类型枚举声明含 not_found，且未列
  question_metadata_identity_conflict；
  实际实现（src/cli.js classifyError）无 not_found 分支，
  但有 question_metadata_identity_conflict。
  → 本合同 §3.6 以实现为准；usage.md 的后续更新属 reference 文档维护，
     不在 T-1 范围内修改。
```

---

## 7. 维护与修订流程

1. 本合同一经独立 DOCUMENT review APPROVED，即成为后续行为决策的权威现状/决策记录。
2. 任何行为变更 CODE 票必须引用本合同对应条款（§3.x）作为需求依据。
3. 任何对本合同的修改（含新增决策、变更决策）必须经独立 DOCUMENT review；
   与 Approved Spec 冲突的决策必须先走 SPEC_CONFLICT 流程（§1）。
4. 本合同不取代、不覆盖 AGENTS.md / RULES.md / Approved Spec；冲突时以更高权威为准。
