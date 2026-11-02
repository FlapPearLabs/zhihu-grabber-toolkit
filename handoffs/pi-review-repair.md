# handoff — pi-review-repair

- 角色：修复（执行者），不自行宣布验收通过。
- 仓库：p2-ari-evaluation，工作树 `.worktrees/pi-review-repair`，分支 `task/pi-review-repair`。
- 候选起点 BASE：`62e4f170cbeeec5fe694984294bb27ea9fb8c8c0`（PR #145 候选）
- PREVIOUS_REVIEWED_HEAD：`b1410de`（两路独立审查在干净 worktree 给出 PASS 的那个代码 HEAD）
- **代码 HEAD：以分支 tip 起第一条非 `docs:` 提交为准**（本文件是最后一条时它就是写头部时的
  `59e0915`；若之后又落了代码提交，则以那条为准）。这样头部不会因为追加提交而落后或说谎。
- 本轮范围：`62e4f17..HEAD`。**权威清单是 `git log --oneline 62e4f17..HEAD`**，本文件不再手抄——
  每追加一条提交手抄清单就会出错（这条已经被两轮审查各抓到一次）。关键节点：
  `49e13de`/`52ec5f1`（更早一轮红测+修复）、`758a5bd`/`b1410de`（第一轮）、
  `4120b7f`/`400fe93`（审查后 P2 收口）、`3faf79b`/`59e0915`（终审后的规则与文案）。
- 依赖：`research-orchestration` 与 `zhihu-answer-grabber` 的依赖已从
  `/private/tmp/zhihu-provider-npm-cache` 离线安装（`npm ci --offline --ignore-scripts --no-audit --no-fund`）。
- 未 push、未开 PR、未 merge、未改历史、未访问真实凭据或真实模型；所有测试使用合成值与 fake transport。
- PROJECT_MEMORY_UPDATE_REQUIRED: YES（字段见 AGENTS §2.1.5；「任何 operator 声明的凭据 profile 一律拒绝、
  不得以哈希替代」「本层 runtime 身份契约表达不了 Spec 里的 lmstudio YES」属 durable security invariant，
  按 §10.3 在 merge 后由最小 `docs/memory` 提交补进 `docs/project-memory.md`；审查人不改被审 HEAD）。

## 第二轮（复审退回后：99bc6e6 → b1410de，已获两路独立 PASS）

复审记录在外层 `research-evidence/pi-provider-review-20261101/REVIEW-52ec5f1.md`，四项：

1. **P0 凭据仍可经「非当前服务商」的 profile 落盘** — 已修，做法是 fail closed：
   删除「与本层可见凭据比较」的整套方案，改为 `assertNoCredentialProfile`，
   **任何声明的 credential profile 一律拒绝**（`runtime_not_supported`）。
   理由：本层无法证明任意输入 profile 非敏感（其他服务商环境变量、SDK 内部解析的 key
   都看不见），Spec 也没有定义多账号契约，继续猜比较范围只会重演同一个洞。
   - 真红（代码回退到 `99bc6e6`、只留测试文件）：
     `node --test p1-runtime-identity-binding.test.mjs p1-runtime-qualification.test.mjs`
     → `tests 19 / pass 15 / fail 4`（I7、I8、I9、I10）。
   - 修复后同一批（含其余 6 个套件）→ `tests 84 / pass 84 / fail 0`。
   - 拒绝发生在加载 provider、创建 transport、创建任何运行产物之前；错误与 details
     不回显凭据，不持久化 key 或其哈希（只断言布尔值与「不含该值」）。
2. **资格边界（注入 runtime / 工厂接口）** — 未改行为，改为把判断写进代码注释：
   生产入口 `bin/research-p1.mjs` 没有注入路径且被门禁拒绝（Q7 覆盖）；注入 `runtime`
   与 `createModelRuntime` 是确定性 fake seam，工厂加门会把它们一起判死。
   **是否让可信内部接口也受同一合同 = 待产品决策**（见本节末尾）。
3. **CI 多行命令在 Windows 的失败传播** — 三个多行步骤加 `shell: bash`，注释写明机制；
   本机只证明了 `sh`（只认最后一条命令）exit 0、`bash -eo pipefail` exit 1，
   **Windows 实机仍未验证**，不声称已验证。
4. **report 目录替换竞态** — 按任务范围未修，继续保持 BLOCK，不宣传全链安全可用。

### 本轮验证（绑定代码 HEAD `b1410de`，工作树 clean）

```text
$ node --test research-orchestration/test/p1-report-safety.test.mjs \
    research-orchestration/test/p1-runtime-identity-binding.test.mjs \
    research-orchestration/test/p1-report.test.mjs \
    research-orchestration/test/model-runtime.test.mjs \
    research-orchestration/test/p1-t15-runtime-composition-wiring.test.mjs \
    research-orchestration/test/p1-runtime-qualification.test.mjs \
    research-orchestration/test/p1-legacy-checkpoint-resume.test.mjs \
    research-orchestration/test/p1-runtime-endpoint-production.test.mjs
ℹ tests 84  pass 84  fail 0

$ node research-orchestration/scripts/run-classified-research-suites.mjs guard
  total registered: 54 / discovered on disk: 54
GUARD OK: manifest covers every discovered core test and has no ghost entries.   (rc=0)

$ node research-orchestration/scripts/run-classified-research-suites.mjs full-offline
FULL-OFFLINE CLASSIFICATION OK: all executable offline suites green; live/private quarantined as NOT_RUN.   (rc=0)

$ node --check（5 个改动文件）+ git diff --check
clean（无输出）
```

未提交差异的 SHA-256 与停手时一致，说明本轮提交的内容就是被独立复验过的那份：
`d1fe68880a80d2ec6925db4ec0cd79ef22cd79fdfe39b2a604c0a1ab775ab2ea`。

### 本轮未验证 / 待决策

- Windows GitHub Actions 实机未验证（本机无 pwsh）。
- report 输出目录替换的残留竞态（范围外，保持 BLOCK）。
- profile 现在一律拒绝，**多账号隔离没有实现**；同 profile 换 key 的账户契约仍需 Spec 定义。
- 可信内部接口（注入 runtime / `createModelRuntime`）是否也受资格门禁约束，属产品/治理决策。
- 独立复审尚未进行：以上是执行者证据，reviewer ≠ implementer。

## 上一轮（62e4f17 → 99bc6e6）逐项证据

### P0 凭据进入身份 / 状态 / 事件

改动：`research-orchestration/lib/model-runtime.mjs`
（`observableCredentials` / `assertProfileIsNotCredential`，替换原 `key.length >= 8` 比较）。

BASE 复现（审查探针，`/private/tmp/zhihu-review-profile-62e4.mjs`，指向审查候选副本）：

```text
{"scenario":"short-direct-key","code":"planner_failed","fakeCalls":1,"transportReceivedSyntheticKey":true,"stateContainsSyntheticCredential":true,"eventsContainSyntheticCredential":true}
{"scenario":"sdk-env-fallback","code":"planner_failed","fakeCalls":0,"transportReceivedSyntheticKey":false,"stateContainsSyntheticCredential":true,"eventsContainSyntheticCredential":true}
```

HEAD 复现（同一脚本适配本工作树，仅合成值；脚本在
`$TMPDIR/opencode/zhihu-repair-profile-probe.mjs`，未入库）：

```text
{"scenario":"short-direct-key","code":"runtime_not_supported","fakeCalls":0,"transportReceivedSyntheticKey":false,"stateContainsSyntheticCredential":false,"eventsContainSyntheticCredential":false,"artifactsCreated":false}
{"scenario":"sdk-env-fallback","code":"capability_isolation_unavailable","fakeCalls":0,"transportReceivedSyntheticKey":false,"stateContainsSyntheticCredential":false,"eventsContainSyntheticCredential":false,"artifactsCreated":false}
```

反例测试：`research-orchestration/test/p1-runtime-identity-binding.test.mjs`
I11（`fakeky` 作为 profile，两种写法；BASE fail → HEAD pass）与 I12（SDK 内部解析
`OPENAI_API_KEY`、本层无 key 时 fail closed）。BASE 输出：`✖ I11` / `✖ I12`；
HEAD：`ℹ tests 12 pass 12 fail 0`。断言只记录布尔值，不打印凭据。

设计要点：与本层可见的每个凭据（`RESEARCH_MODEL_API_KEY`、`DEEPSEEK_API_KEY`、
`.model_api_key`、`.deepseek_api_key`）以及已解析 key 做长度无关的相等/包含比较；
若本层解析不到 key 且使用 provider 自带端点（pi-ai 在 SDK 内部解析），无法证明
profile 只是标签 → `credential_profile_invalid` fail closed。不持久化 key 或哈希，
错误信息不回显凭据。拒绝发生在 `loadModel`、transport 与 `writeState`/`appendEvent` 之前。

### P1 资格门禁只判断标签

改动：`model-runtime.mjs`（`QUALIFIED_RUNTIMES` 精确记录 + `assertRuntimeQualified` 绑定
model 与实际端点）、`p1-runtime-composer.mjs`（把 `modelBaseUrl` 作为 `customEndpoint`
交给门禁）。

BASE 复现（`/private/tmp/zhihu-review-qualification-62e4.mjs`）：

```text
{"model":"deepseek/unqualified-model","calls":1,"code":"planner_failed","expected":"capability_isolation_unavailable","artifactsCreated":true}
{"model":"deepseek/deepseek-v4-pro","calls":1,"code":"planner_failed","expected":"capability_isolation_unavailable","artifactsCreated":true}
```

HEAD 复现（同一脚本适配本工作树）：

```text
{"model":"deepseek/unqualified-model","calls":0,"code":"capability_isolation_unavailable","expected":"capability_isolation_unavailable","artifactsCreated":false}
{"model":"deepseek/deepseek-v4-pro","calls":0,"code":"capability_isolation_unavailable","expected":"capability_isolation_unavailable","artifactsCreated":false}
```

反例测试：`p1-runtime-qualification.test.mjs` Q4/Q5/Q6（BASE 红：`planner_failed`，
Q6 实测产出 `events.jsonl` + `orchestration-state.json`；HEAD：`tests 6 pass 6 fail 0`）。

资格记录来源（未自行认定新 provider）：
- `docs/specs/research-orchestration-scope.md` §1 的具名 YES；
- `corpus-anthology/lib/deepseek-tool-less.mjs` 的 `DEEPSEEK_RUNTIME`
  （`deepseek-v4-pro` + `https://api.deepseek.com/chat/completions`，代码中以“provider
  自带端点”表达，即 `endpoint: null`）；
- `corpus-anthology/lib/lmstudio-tool-less.mjs` 的 `REVIEWED_RUNTIME`
  （`lmstudio-local-tool-less` / `qwen/qwen3-1.7b` / `http://127.0.0.1:1234/v1`）。

未知模型、兄弟模型、任何 operator 端点一律 `runtime_not_qualified` → 上层
`capability_isolation_unavailable`，且详情不回显端点 URL。

### P1 五个新增测试未登记

改动：`research-orchestration/suite-classification.json`（5 条登记为 `fast-deterministic`）
+ `.github/workflows/ci.yml` 的 `test` job 显式 `node --test` 五个套件。

BASE：

```text
$ node research-orchestration/scripts/run-classified-research-suites.mjs guard
CLASSIFICATION-GUARD-FAIL: unregistered core test(s) ... p1-legacy-checkpoint-resume.test.mjs,
p1-report-safety.test.mjs, p1-runtime-endpoint-production.test.mjs,
p1-runtime-identity-binding.test.mjs, p1-runtime-qualification.test.mjs
EXIT=1
```

HEAD：

```text
$ node research-orchestration/scripts/run-classified-research-suites.mjs guard
  fast-deterministic: 17 / full-offline: 32 / historical-compat: 2 / live-gated: 2 / private-canonical: 1
  total registered: 54   discovered on disk: 54
GUARD OK: manifest covers every discovered core test and has no ghost entries.
EXIT=0
```

“登记 ≠ 执行”：这 5 个套件在 `test` job 里有独立的 `node --test` 步骤（CI 只运行
显式列出的套件），本地按同一命令行执行结果：

```text
p1-runtime-identity-binding     tests 12 pass 12 fail 0
p1-runtime-qualification        tests 6  pass 6  fail 0
p1-runtime-endpoint-production  tests 4  pass 4  fail 0
p1-legacy-checkpoint-resume     tests 3  pass 3  fail 0
p1-report-safety                tests 9  pass 9  fail 0
```

## 上一轮验收门禁结果（83 项那一次）

1. 反例 BASE 红 / HEAD 绿：见上（Q4-Q6、I11、I12、两个探针）。
2. `node research-orchestration/scripts/run-classified-research-suites.mjs guard` → exit 0。
3. 指定 8 套件：

```text
$ node --test research-orchestration/test/p1-report-safety.test.mjs \
    research-orchestration/test/p1-runtime-identity-binding.test.mjs \
    research-orchestration/test/p1-report.test.mjs \
    research-orchestration/test/model-runtime.test.mjs \
    research-orchestration/test/p1-t15-runtime-composition-wiring.test.mjs \
    research-orchestration/test/p1-runtime-qualification.test.mjs \
    research-orchestration/test/p1-legacy-checkpoint-resume.test.mjs \
    research-orchestration/test/p1-runtime-endpoint-production.test.mjs
ℹ tests 83  pass 83  fail 0
```

   分类 runner 的 `full-offline` 模式（工作目录按 manifest 的 `requires.workingDirectory`
   解析）：exit 0，34 个可执行套件 rc=0，live-gated / private-canonical 仍报 NOT_RUN。
   affected 回归（planner、integration-preflight、T14 async、T14 cross-group、T15
   coverage、R02、R05、R06）：`tests 248 pass 248 fail 0`；另 `p1-clarification-recovery`
   + 根级 `test/agent-pipeline.test.mjs`：`tests 20 pass 20 fail 0`。
4. `git diff --check` → clean（修复与测试提交前各验一次）。

合计：83 + 248 + 20 + 34 套件 rc=0，无新增失败。

## 上一轮未验证 / 已知风险

- 真实服务商资格、OAuth 订阅登录、费用、真实多模型可用性均未验证；本轮完全没有
  真实凭据、真实网络或真实模型调用。`capability_isolation_unavailable` 只证明门禁
  会拒绝，不证明任何新 runtime 可用。
- 资格记录仍以“运行时 + 模型 + 端点”为准；`lmstudio-local-tool-less` 的模型/端点来自
  既有 T5-LM/T6 审查记录，本工作树未重新实机验证该本地服务。
- `report` 输出目录替换的残留竞态未修（任务明确排除，未触碰 `report.mjs`）。
- 同 profile 换 key 的账户身份契约需另设计：当前只保证 profile 不是凭据，不能证明
  两个进程用同一 profile 时用的是同一账户。
- 观察（非本次改动引入）：`scripts/run-classified-research-suites.mjs` 的
  `parseSummary` 匹配 `# tests N`，本机 Node 22 输出为 `ℹ tests N`，因此分类 runner
  打印的 `tests=/pass=/fail=` 恒为 0；真正的失败判据是子进程 `rc`（本次 34 个套件均
  rc=0）。该脚本本次未修改。
- 独立复审尚未进行：以上均为执行者证据，reviewer ≠ implementer。

## 上一轮偏离说明

- 无范围外改动：只改 2 个 lib 文件、2 个测试文件、1 个 manifest、1 个 CI 工作流，
  外加本 handoff。未触碰 `AGENTS.md`、`RULES.md`、Approved Specs、`report.mjs`，
  未引入新依赖或 OAuth。
- 修复提交把 `credential_profile_invalid` 在 composer 侧呈现为 `runtime_not_supported`
  （既有错误映射，未新增错误码），测试按该既有契约断言。

## 本轮偏离说明

- 范围：2 个测试文件、2 个 lib 文件、1 个 CLI 帮助文本、1 个 CI 工作流，外加本 handoff。
  未触碰 `AGENTS.md`、`RULES.md`、Approved Specs、`report.mjs`，未新增依赖、未引入 OAuth。
- 与上一轮的方向性差异：上一轮试图「证明 profile 不是凭据」，本轮放弃该路线，改为
  「任何声明的 profile 一律拒绝」。这是安全上的 fail-closed 选择；代价是凭据 profile
  功能当前完全不可用，要等 Spec 定义多账号契约后重新设计。
- 错误码沿用既有映射：profile 被拒在 composer 侧呈现 `runtime_not_supported`，
  未新增错误码，测试按既有契约断言。

## 第三轮（本轮）：审查后的 P2 收口（`b1410de` → `400fe93`）

两路独立审查（干净 worktree、对抗性、各自写探针 + 突变）均给 `REVIEW_VERDICT: PASS`，
无 P0/P1，共报 7 条非阻塞问题。本轮修了其中 6 条（第 7 条是既有问题，见末尾）：

1. `suite-classification.json` 的 note 仍在描述**已删除**的「长度无关比较」方案 —— 改为
   「任何声明的 credential profile 在任何调用与产物之前被拒绝」。
2. `p1-runtime-composer.mjs` 的「唯一生产入口」措辞 —— 改为「P1 对外 CLI 入口是
   `bin/research-p1.mjs`」，并写明第二个调用点 `evaluation/product-worker.mjs` 注入的是
   禁网的确定性 double。
3. 空 profile 两处语义相反 —— 新增 `declaredCredentialProfileLabel`，工厂与
   `runtimeRunKey` 共用一条规则：**显式传入的空/空白值算「声明错误」**（拒绝），
   环境变量为空仍表示「未声明」。删除了 `?? 'declared'` 这个凭空造值。红测 I13。
4. `lmstudio-local-tool-less` 是永远匹配不上的死记录 —— 从 `QUALIFIED_RUNTIMES` 移除
   （说明移进注释：Spec 里有 YES，但本层 runtime 身份契约表达不了它，且 P1 adapter 不构造
   它），报错文案不再宣称一个无法启用的运行时。
5. `.github/workflows/ci.yml` 第 4 个多行步骤补 `shell: bash`（该 job 只在 ubuntu，风险为 0，
   但注释承诺「every multi-line step」）。
6. 本文件补 `PROJECT_MEMORY_UPDATE_REQUIRED`。

### 本轮验证

```text
$ node --test <8 个验收套件>              → tests 85 / pass 85 / fail 0（多出 I13）
$ ... run-classified-research-suites.mjs guard   → 54/54, rc=0
$ ... run-classified-research-suites.mjs full-offline → rc=0
$ node --test p1-t14-cross-group-synthesis planner   → 43/43、32/32
$ git diff --check                         → clean
```

`p1-integration-harness.test.mjs` 单独在仓库根跑仍是 33/34，失败项是既有的
`EXTRACTION BOUNDARY`（用 `process.cwd()` 拼 `bin/…`，仓库根没有该目录），与本轮无关。

### 未修（第 7 条，既有问题，不含在本轮）

`run-classified-research-suites.mjs` 的 `parseSummary` 只匹配 TAP 的 `# tests N`，在 Node 26
输出 `ℹ tests N` 时计数恒为 0；分类 runner 的真实判据是子进程 rc。属既有缺陷、不在本任务
范围，未改。

### 第三轮的复审反馈与追加修复（→ `400fe93` 之后、本文件所在提交）

对 `400fe93` 的两路复审：一路 PASS，一路 CHANGES_REQUESTED（P1 是本文件头部过期，
已在上面的头部修好），另报 3 条 P2，全部处理如下：

- **P1 交接包头停在上一轮** → 头部改为「候选 BASE 62e4f17 / PREVIOUS_REVIEWED_HEAD b1410de /
  代码 HEAD 400fe93 / 全文提交链路」，并把上面两节标题改回「第二轮」「第三轮（本轮）」。
- **P2 I13 对 `runtimeRunKey` 一侧没有牙**（把实现改回 `?? 'declared'` 仍然 13/13 绿，
  因为两种实现抛的是同一个错误码）→ 断言改成匹配文案 `/must not be empty/`。
  突变复核：在 `$TMPDIR/tooth-wt` 把该行还原成旧写法 → I13 红；本体绿。
- **P2 环境变量只写空白时被当「未声明」，与显式空白被拒不一致** → `resolveCredentialProfile`
  改为：仅**空字符串**表示未声明（shell 的「未设置」），空白字符串是声明 → 拒绝
  （`must not be blank`）。红测同样是 I13（把该规则还原 → I13 红），绿后 85/85。
- **P2 注释措辞**：`declaredCredentialProfileLabel` 的说明改为「present（非 null/undefined）即声明」，
  并写明 `env` 是工厂专有输入、`runtimeRunKey` 传 `env: {}` 不会偷看进程环境。
- **P2 提交信息与产物错位**：`400fe93` 的提交信息第 6 条说「handoff 补 PROJECT_MEMORY 字段」，
  实际该字段在 `9b187b5` 的 docs 提交里。历史不改写，在此如实记录。

第三轮验证（本轮最终状态）：8 套件 `85/85`、guard `54/54 rc=0`、`full-offline rc=0`、
`git diff --check` clean；`I13` 的两侧牙齿用突变各证一次。

### 终审后的追加修复（→ 本文件所在 docs 提交）

终审对 `3faf79b` 给 CHANGES_REQUESTED，只有 1 条 P1 + 1 条 P2，已处理：

- **P1 头部仍落后（写 `400fe93` 而实际 HEAD 是 `3faf79b`）** → 头部改为「代码 HEAD 以本文件之前
  最后一条非 `docs:` 提交为准（写头部时是 `59e0915`）」，并把 `62e4f17..HEAD` 的完整提交链路
  逐条列出。这样后续任何代码提交都不会让头部变成谎话。
- **P2 两条通道的拒绝文案不同** → 环境变量那条点明 `RESEARCH_MODEL_CREDENTIAL_PROFILE` 并说
  「unset 该变量」，显式参数那条点明 `credentialProfile option`（`59e0915`）；行为不变。

终审同时独立复跑确认：8 套件 85/85、guard 54/54 rc=0、full-offline rc=0、`git diff --check` 干净、
`I13` 与空白规则两条突变都会红、增量无越界。

## 终审（整份候选，一次性判定）

- 审查者：独立子代理，干净 git worktree（`$TMPDIR/opencode/final-59e0915`），依赖为独立副本，
  未改任何工作树；自跑测试、自做 4 个突变。
- `FINAL_VERDICT: PASS`，`REVIEWED_HEAD: 59e0915`。
- 四项原始阻断项逐条判为「修住」，并各自给了反例思路；其中 report 目录替换的
  `assert → rename` 窗口仍是**已知 BLOCK**（纯 JS 无法彻底关闭），未被宣称为全链安全。
- 独立跑出的数字：8 个验收套件 85/85、guard 54 registered / 54 discovered rc=0、
  full-offline rc=0、`git diff --check` 干净、`node --check` 通过。
- 4 个突变全部按预期变红：资格回退为标签（Q4/Q5/Q6）、report 模式常量 0o644（S8）、
  删除 profile 拒绝（I9/I13）、删除 `assertSameRunDir`（S7）。
- `POST_GATE_MEMORY_UPDATE_REQUIRED: YES`（「声明 profile 一律拒绝且不得以哈希替代」
  「本层 runtime 身份契约表达不了 Spec 里的 lmstudio YES」「`''` 仅作 env 未设置、空白一律拒绝」）。
- NON_BLOCKING（不阻塞合并，记录备查）：`suite-classification.json` 里 `p1-report-safety` 的
  note 写的是内容权限，实际测的是文件系统安全（描述错位）；S7 未覆盖 assert→rename 窗口；
  权限策略不主动收窄既有 mode。
