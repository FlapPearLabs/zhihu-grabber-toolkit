# handoff — pi-review-repair

- 角色：修复（执行者），不自行宣布验收通过。
- 仓库：p2-ari-evaluation，工作树 `.worktrees/pi-review-repair`，分支 `task/pi-review-repair`。
- BASE_SHA：`62e4f170cbeeec5fe694984294bb27ea9fb8c8c0`（审查结论 CHANGES_REQUESTED 的候选 HEAD）
- HEAD_SHA：`52ec5f18b9a7f20f1ab8465b77e0c248bba4a60d`
- 提交：`49e13de` test（红反例 + 登记 + CI 入口）、`52ec5f1` fix（实现）、本文件 docs。
- 依赖：`research-orchestration` 与 `zhihu-answer-grabber` 的依赖已从
  `/private/tmp/zhihu-provider-npm-cache` 离线安装（`npm ci --offline --ignore-scripts --no-audit --no-fund`）。
- 未 push、未开 PR、未 merge、未改历史、未访问真实凭据或真实模型；所有测试使用合成值与 fake transport。

## 逐项证据

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

## 验收门禁结果

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

## 未验证 / 已知风险

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

## 偏离说明

- 无范围外改动：只改 2 个 lib 文件、2 个测试文件、1 个 manifest、1 个 CI 工作流，
  外加本 handoff。未触碰 `AGENTS.md`、`RULES.md`、Approved Specs、`report.mjs`，
  未引入新依赖或 OAuth。
- 修复提交把 `credential_profile_invalid` 在 composer 侧呈现为 `runtime_not_supported`
  （既有错误映射，未新增错误码），测试按该既有契约断言。
