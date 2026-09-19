# Lane E — F07 bounded CI / regression repair planning

范围：READ ONLY SCOPED_REPAIR_PLAN。源码基线 4bea7b30b3842a876e383977686a0abc0d68302f；发布包 eb02a660cdb3ada07ee08f742e2987bb7da8b9e8。远端 fresh fetch 由主审负责并提供无漂移结果，本子审未独立联网确认。下面路径均相对仓库根。未执行完整 840 tests、未修改仓库；仅写本草稿。前一个发布检查阶段实际复跑过三 probes，本轮 fresh-read 证据，不冒充本轮 fresh run。

## 1. 当前每 PR coverage 与 F07

`.github/workflows/ci.yml:3` 对所有 pull_request 和 master / 特定旧修复分支 push 触发；`:14` 三平台 Ubuntu/macOS/Windows，Node22。当前覆盖：grabber node --test (`:33`)、anthology node --test (`:37`)、根 agent-pipeline (`:43`)、planner syntax/test (`:52`/`:55`)、integration-preflight (`:58`)、T14 async syntax/seam (`:67`/`:73`)、T14 synthesis、T15 integration 和 composition wiring (`:76`)。这不是没有 research CI，而是仅覆盖六个 research test 文件。

未路由到 CI 的 bounded 相关集合：plan-contract、coverage-state、provider-seam、global-search-provider、rrf、retrieval、retrieval-round-controller、source-group-selection、multi-group-execution、dense-geometry、embedding-provider/cache、T12、T13、claims-prompt-contract、canonical-runner、seam-contracts，以及更广的 orchestration/integration-harness/real seam suites。特别 T13 安全投影 tests 存在但不在 CI；prompt fixture test 亦遗漏。现有 workflow `:49` 的“其余套件存在既存失败”是历史注释，不能当作当前豁免：审计 PROCESS.md:37–39 记录 archive 环境失败、修正 Git 对象可见性、最终 831/0/9，仍不能将 macOS Node25 的本地结果直接升级为 Node22 三平台证明。

F07 = CONFIRMED；根因是手工 focused 路由未持续覆盖已存在的核心合同，也缺少明确 lane/skip policy。不能靠固定 840 计数长期约束（测试数量可增长）。

## 2. Reviewer probe → authoritative positive regression

审计 README.md:30 明确 exit0=观察到错误。不得把整个 probe 直接加入绿灯 CI，也不得永久测试旧错误。每个 lane owner 先按接受合同写期望行为，观察 audited base RED，最小修复后 GREEN，并保留合法正控制、边界、负例。

| Case | 现有证据/测试锚点 | future regression 期望 / 所属 lane |
|---|---|---|
| restart_different_topic | probes/architecture-counterexamples.mjs:302 | 新 run/新 topic 不得发旧查询，不复用旧 plan/coverage/selection/corpus/claims/synthesis；合法同题 resume 为正控制。A，期望错误码/是否生成新 plan 等 A contract 后冻结 |
| complete_missing_research_plan | architecture:289 | 缺 plan 不得返回 reused complete；完整依赖集可复用、plan hash mismatch 负例。A |
| complete_missing_canonical_answers | architecture:296 | 缺失或变更 canonical source 不得复用；只删不影响复用的衍生视图为边界控制（须 A 定义）。A |
| cross_group_opposite_claims | probes/spec-counterexamples.mjs:18–20 | 同 aspect 的相反 proposition/stance 不得共同计作单结论 support / widely-shared；同立场跨组正控制与 UNKNOWN 不误判冲突。B；controller tests 注入已判定关系，只证明确定性聚合，不能证明模型自然语义判断 |
| unrelated_in_group_opposition | spec:25；test/p1-t14-cross-group-synthesis.test.mjs:235 | 无关组内 contradictory 不自动反对每条 main；现有该测试断言了旧语义，必须随已接受 B contract 更新，而非保留互相冲突断言。B |
| empty_cluster | spec:27–28；T14 test:511–525 | 有 claims 输入却空语义簇须拒绝，不能产无 sourceClaimIds 的 minority；区别既有完全空 corpus 不调用 runtime 的测试。B |
| unsafe_projection | probes/standards-projection.mjs:11；test/p1-t13-group-representation-claims.test.mjs:561、597 | 从真实 canonical loader→T13→生产 adapter fake fetch 捕获请求，断言代码正文/完整外部图片URL/file URI 被既有 projection 合同处理；保留合法正文、token lineage、无 tools 的正控制。C。不能只断言 UNTRUSTED_DATA 包装即安全 |
| clarification_resume | architecture:308；test/source-group-selection.test.mjs:229、252；test/p1-t15-runtime-composition-wiring.test.mjs:514 | 下层 resolver 已有有效/非法 forced IDs tests，但生产路径还须 CLI/composer same frozen pool 恢复，无新 retrieval，非法输入不改变绑定、不得绕过数量限制。D |

路径简写：probes/ 前缀为 docs/audits/2026-09-18-system-architecture/；test/ 前缀为 research-orchestration/。

伪造 sourceRef probe (`spec-counterexamples.mjs:29–33`) 是内部 seam robustness，不是已证生产 exploit。B 可以按同一 lineage contract 纳入控制器 invalid-ID regression；不能为它新增安全事件叙事或扩大治理项目。

## 3. 推荐 gate routing

**FAST CONTRACT GATE：每 PR，Node22，三平台。** 保留当前三个包/入口 gate（本计划不删旧保护）；新增 A/B/C/D 的权威回归与已有 plan/coverage/selection/T13/T12/current composer/canonical entry 合同。异步 fake runtime/fetch 必须保留生产形状。用显式文件清单或 Node 驱动枚举执行，避免 Windows shell glob 假设；workflow:42、51 已说明目录参数问题。快速关键 tests 不许 skip；新增核心合同文件必须明确归属 gate，未归属应失败或触发 review。

**FULL OFFLINE RESEARCH SUITE：Ubuntu Node22，每个修复 PR + master，另 nightly/manual。** 不必把全 840 tests 在每平台重复。现有所有网络独立 tests（含 provider/retrieval/RRF/geometry/cache/runner）纳入完整清单；private/live 文件明确单列不可静默遗失。初期每 repair PR 必跑，稳定后若希望收缩触发范围须单独拿耗时/漏测数据裁决，不能此轮凭想象优化。锁定依赖安装但不下载模型权重；geometry/provider 测试使用已有 mocks。完整 offline gate 必须实际 fail0，预期零 skip；若保留混合 suite 执行，则显式记录私有 gate skip 名单/原因并声明 offline PASS 范围，不能把总 exit0 叫 full P1 PASS。

**PLATFORM MATRIX：现有三平台保护每 PR保留；新增重点为 state 文件路径/rename/hash、restart/CLI 解析/子进程 bridge。** FAST已跑的不用复制第三次；较重全研究三平台可 nightly/manual，须先验证 Git/tar 与 Windows 路径/Node22 可行性。不能以本地 Mac 831 pass 推定跨平台新增路径通过。现有 wiring test:750 使用 loopback HTTP/子进程，CI应允许本地监听，但不得把它误称外网 live test。

**HISTORICAL PRODUCER COMPATIBILITY：Full offline 的独立子步骤，Ubuntu Node22，master和修复 PR。** p1-seam-a-producer-conformance.test.mjs:40 pin T09 SHA 4789382...，:43–50 查 .git，:65 git archive、:72 tar。必须 fetch完整历史或精确必需对象并验证可读（checkout现仅默认浅克隆，ci.yml:18），不能因历史 SHA 缺失 skip 然后 PASS。它测旧 reviewed producer与冻结 seam，不能代替 current producer regression。p1-integration-harness.test.mjs:54–59 另外创建 temp Git repos，需 Git 身份在fixture内局部设置，不改用户global配置。

**LIVE / PRIVATE / MODEL GATES：manual受控授权；可由已有资源充足的夜间执行安排触发，不能暗设付费调用。** seam-b/c/d real-conformance依赖 private capture。seam-c:127–134 缺材料会skip；:524–547 为 P1_REAL_RUNTIME=1 / LM Studio，可不可达skip；历史 qwen/LMStudio gate不等于当前 DeepSeek runtime semantic acceptance。将 collected skip作为 NOT_RUN/UNAVAILABLE+具体原因，SKIP!=PASS，凭据永不进入报告。A/B/C/D deterministic合同通过后，当前模型/prompt/config exact identity的真实语义样本重验另出结果；完整canonical acceptance还须真实检索/捕获/verifier/lineage/最终产物，不可与 fake runtime / private recorded runtime混同。

## 4. Lane E bounded spec

LANE: E. FINDINGS: F07（其它 findings 的 tests由原 lane owner负责，E仅路由与结果归类）。ROOT CAUSE: 核心合同未持续进入 CI。CURRENT CONTRACT: RULES.md §10 focused+relevant regressions；AGENTS.md §18.2 每 invariant 正/边/负 RED→GREEN；UNKNOWN!=PASS。BROKEN BEHAVIOR: 三平台CI绿仍可遗漏 T13 等现存测试。

TARGET CONTRACT: 每个已修核心 invariant都有 authoritative test 和明确 PR路由；完整offline与历史/私有/模型证据分开；结果包括 exact candidate SHA、Node/OS、执行命令/文件、pass/fail/skip原因。

IN SCOPE: .github/workflows/ci.yml、必要的最小执行清单或runner（可先纯workflow显式文件，无需通用框架）、lane test路由、CI产物与skip分类、过时CI注释最小更新。OUT OF SCOPE: 产品业务修复、Spec自行改语义、模型自动评分平台、#79 observatory、付费自动调用、重写全部测试/跨平台工具框架。

PRODUCTION CALLER: 无产品caller；GitHub push/PR触发。TEST CALLER: Node test runner + current CLI/adapter doubles；historical子步骤明确 separate。DEPENDENCIES: E0分类/现有suite路由可Wave0并行；各lane新regression命名与合同冻结后E1纳入；最终E2在合并组合 SHA验证。不能把测试全部拖到最终E，A–D每个实现都须先 RED/GREEN。共享 ci.yml由E单owner串行更改，避免A–D争用；A/D composer共享另由主审排序。

REVIEWER: 独立 CI/integration reviewer，核对实际运行文件清单、skip策略、Node22/平台、依赖/凭据与历史SHA。不为纯CI硬加双安全review；C的产品安全review仍由C负责。独立反例：在scratch candidate证明删掉核心文件路由会被missing-coverage检查/审查识别；未知skip不被归PASS；历史对象缺失明确fail。不得破坏真实产品分支演示。

ACCEPTANCE EVIDENCE: exact SHA remote CI terminal、明确all intended tests executed、fail0、无隐性skip、PR/master触发证明、历史对象可读、platform结果、无产品scope drift、独立review receipt。没有必要为执行清单建立大型测试框架。

IMPLEMENTATION_MODEL_RECOMMENDATION: GPT-5.6 Sol / medium 做 CI清单、workflow与运行证据归类；复杂平台失败升级 high；GPT-5.6 Terra / medium可做已冻结清单机械整理。关键A/B/C合同测试仍由对应强contract reviewer判断，不能交低成本模型独立决定语义。以上为未来任务分配建议，没有运行benchmarks，非模型性能事实。

## 5. Bounded same-class findings

SAME_ROOT_CAUSE：claims-prompt-contract、T13、selection/state/provider等现有核心tests未进入workflow；纳入E。SAME_ROOT_CAUSE：workflow历史“其余既存失败”注释不可作为永久未验证豁免；最小更正。ADJACENT：历史real seam混合recorded/private/live和当前runtime不一致，仅明确gate分类，不重写历史fixture或评测平台。OUT_OF_SCOPE：全仓CI工具升级、actions版本升级、全研究三平台性能优化；本轮未调查。
