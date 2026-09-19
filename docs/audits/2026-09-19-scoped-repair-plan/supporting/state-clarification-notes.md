# F01/F02/F05 限定合同调查草稿

范围：只读 `<REPOSITORY_CHECKOUT>` 的当前产品源码、适用 Spec 与已发布审计证据。产品 SHA `4bea7b30b3842a876e383977686a0abc0d68302f`；publication `eb02a660cdb3ada07ee08f742e2987bb7da8b9e8`。fresh remote identity 由主审执行并交接；本子审没有另做 fetch，不声称自己验证远端。未改产品、测试、规范、memory、Issues；未调用模型/真实 capture。下面路径行号都相对该 checkout。

## 独立推导的最小不变量

先由需求推导：reuse 是“相同授权研究输入、适用版本及依赖仍成立”的当前判断，不是磁盘上某个成功结果存在。用户新题不能被旧语义 plan 替换。用户确认只解决已呈现歧义，不能同时隐式启动一次新的 retrieval。组级 verified 权威及 T13 analyzed identity 单写者不能在恢复检查中被重造。

适用 authority：`docs/specs/p1-cross-question-deep-research.md:289` 区分稳定 run identity 与 stochastic planHash；302 明确配置至少覆盖 mode、approved runtime policy、provider routes、selector/config version；305–307 planHash 改变必须使 downstream stale。该 Spec 434–453 定义组级 artifact/hash、valid-only manifest、sibling reuse 和依赖传播；455 partial 不得 complete。`docs/specs/research-orchestration-scope.md:215` 用户确认后继续；341–342 checkpoint 必须可验证；476 恢复不得重复合法完成阶段或复用 stale。

## 当前实现对照及 finding disposition

- **F01 CONFIRMED / SAME_ROOT_CAUSE with F02**：composer 323 的 restart 只绕过 readState；387–391 无条件 loadPlan(workDir)。新 state 361–363 先写入新 topic，所以原 plan 仍在时形成新题/旧 plan 混合。plan 合同校验不证明此 plan 属当前授权 request。审计 probe `restart_different_topic` 新题儿童近视仍执行旧 AI queries，fetchCalls=0。
- **F02 CONFIRMED / SAME_ROOT_CAUSE with F01**：composer 328–348 完成复用只校验 result/coverage 两文件；570–574 虽存 researchPlan hash，却未消费；未走 T09 resume authority。删除 plan 或 canonical answers 后依旧 reused/complete/isFullCoverage=true。不是要求 live 重抓，所缺是本地依赖闭包校验。
- **F05 CONFIRMED / independent production reachability defect sharing run binding**：composer 283–296 无 clarification 参数，438 调 selection 不传 clarification，439–448 只停止。CLI `research-orchestration/bin/research-p1.mjs:47` 参数面也无 clarification。底层 `coverage-final-integration.mjs:465` 已有 clarification，478 调 T08；`source-group-selection.mjs:727` 已有合法解析，914–1025 验 membership/cardinality/required keys/ambiguity，并在成功后 count=1。故 D 不能重新实现选择算法，必须接现有 owner。

F01/F02 共用 A lane；F05 保留 D lane，合同依赖 A 的 run/plan/config binding。若并行修改 composer 会争用同一文件，建议 A 合并后 D 再改 composer。

## RUN_REUSE_VALIDITY_CONTRACT（建议冻结）

唯一跨阶段 reuse 决策 owner 是 P1 composer 的 controller checkpoint 判定；下属 stage owners 提供验证结果。不能把条件分散为两个额外 if，不能让 CLI 自行判 stale。保持轻量、P1 专用，禁止通用状态框架。

`REUSED_COMPLETE` 仅当：

1. 持久化记录形状/版本有效；normalized topic + 受批准稳定配置 identity 与当前请求匹配。plan 内容不进入 run identity；凭据及秘密的 hash 也不进入。
2. plan bytes 可读、当前 plan schema 有效、其 hash 等于 checkpoint 记录与所有 dependent planHash；同时其 reuse provenance 绑定当前 run。目录存在或 schema-valid 不是绑定。
3. selection 与冻结 pool、plan、selection config 绑定；selected groups 的 identity 与 T09 state 一致。恢复使用 T09 现有 `resumeMultiGroupExecution` 或其同权威只读验证结果（967–1080），不由 composer 自写第二个 per-group validator。该函数会更新传入 state，完整复用判断宜在副本计算、只接受“无失效”的 verdict，勿在只判断 complete 时隐式 capture/rewrite canonical。
4. 所有 selected group 的 answers/handoff 仍可读、hash/version/identity 相等，verified/handoff 状态仍有效；manifest 从这些 refs 与 selection 确定性可重建，不能拿保存的布尔 verified 作无限期兜底。
5. selected corpus 身份、每条 sourceId/contentHash/ref 与已验证 canonical sources 一致；T13 声明的 mapped/analyzed identity/claims 仍来自该 selected set；T14 synthesis evidence lineage 仍引用有效 T13 claims。检查/比较既有 identity，不从 resume 层再次写 analyzed ledger。
6. coverage state、claims、synthesis、coverage-final、result 本地 bytes/hash/version 与记录匹配；T14 guard 和 T15 集合对账仍一致，result/run/plan/runtime binding 一致。resultHash + finalHash 不能替代 2–5。
7. 不满足任一条件即 `reused:false` 或明确 checkpoint-invalid 失败；不能报成功 current reuse。自动重做昂贵 stage 与 fail-closed 返回的 UX 选择尚需 owner 裁决，安全底线不受其影响。

### COMPLETE 依赖闭包具体范围

闭包：run/config binding → persisted plan → frozen candidate pool + selection → T09 state/derived manifest → per-group answers/handoff → selected corpus refs/identity → T13 claims + mapped/analyzed ledger → T14 synthesis/guard → T15 coverage-final → research-result。

当前 `selectResearchCorpusWithCoverage`（coverage-final-integration 640–656）仅返回 SEAM B corpusArtifact、持久化 ledger，没有持久化完整 SEAM B。因此不能制定“恢复时检查既有 corpus.json”的虚构要求。最小修复可复用 ledger 内 selected set + hash-bound claims 的 identity 及 canonical refs 验证闭包；若不能重建完整依赖证明，则需持久化最小 controller-owned dependency record（hash/identity/ref/version，不复制 canonical 内容）。具体布局由实现设计决定，合同必须先规定闭包与版本。

无需新增 HISTORICALLY_COMPLETE / CURRENTLY_REUSABLE_COMPLETE 两个持久状态。保留历史 result 的 complete 事实；每次 resume 的 reuse verdict 是当前验证结果。若未来需要展示损坏依赖下历史报告，须另设显式 historical-read 操作；不能从 resume API 默默返回历史成功冒充当前有效。

### validity / drift matrix

|变化|分类|最早失效或动作|
|---|---|---|
|normalized topic 改变|MUST_INVALIDATE|run 与 plan 后全部；无 restart 时拒绝冲突，有 restart 时新研究|
|同题同 stable config、全部依赖 hash/version 有效|MAY_REUSE|沿相同 run 恢复；不调用 planner/model/provider|
|plan 缺失/损坏/hash 不一致|MUST_INVALIDATE|PLAN/RETRIEVAL 及 downstream；不能只换 plan 文件继续旧 selection|
|同 request 重新生成 plan、hash 恰相同|MUST_REVALIDATE|不可仅凭 hash 推断新 execution 可读旧 stage；由 restart policy 决定是否允许；普通 resume 可验证后复用|
|provider route/selector/retrieval budget 配置变化|MUST_INVALIDATE|当前“同 run 恢复”资格失效；配置 identity 必须包含 effective defaults/version；新 run 下允许复用哪些不相关缓存须显式 policy|
|approved runtime policy / requested model / prompt、projection 或 semantic contract version 变化|MUST_INVALIDATE affected semantics|不得将旧分析冒充按新合同生成；至少 T13 或 T14 起依赖失效；底层未变 canonical 可经 owner 校验保留|
|provider response served-model 观测字符串变化|MAY_REUSE|既有 owner ruling 接受该字段为 observability；不能发明 response.model 精确相等 gate|
|canonical answers missing/hash/version 改变|MUST_INVALIDATE affected group + dependents|T09 判断；无依赖 valid sibling 可复用；corpus/claims/synthesis/final 失效|
|仅 handoff 缺失/改变|MUST_REVALIDATE|T09 handoff 层恢复；answers 未变可保留原 verified 根，重新 handoff 后重验 downstream|
|selected set 或其 contentHash identity 改变|MUST_INVALIDATE|corpus → T13/T14/final|
|claims/synthesis/coverage/result 任一 bytes 缺失/改变|MUST_INVALIDATE dependent tail|不得“修正记录 hash”就重新接受|
|日志时间、进度格式、无语义注释、凭据轮换|MAY_REUSE|不因这些变化使已绑定语料重算；凭据不入 identity|
|未记录旧 prompt/model/config 版本的 legacy checkpoint|UNKNOWN / policy|默认不授予 current reuse；不能猜历史版本。迁移方案需 owner 选保守拒绝/显式重新验证|
|更换模型供应端内部不可观测版本、远端文章后来修改|UNKNOWN|不臆测本地历史 corpus 被改；不引入 online freshness 检查，本地 evidence scope 明示|

版本指纹不是整个 git SHA：docs-only commit 不应使全 corpus 失效。建议 reviewed scoped contract versions（planner/profile、selection、projection、claims、synthesis）或相应实际输入 fingerprint；模型响应未知变化不能被指纹夸称完全捕捉。

## restart/resume 操作语义与需 owner 决策项

- resume：同 normalized request + stable config；在最早无效依赖前复用 valid 部分，不改变 topic、不调用新 planner 来悄悄覆盖原 plan。
- restart(new topic)：不得读旧 ResearchPlan/CoverageState/SelectionDecision/Manifest/Claims/Synthesis 作本次 stage 事实。全体由 run owner 判 stale。旧 canonical 文件不删除；不得把 repair 偷变 grab clean-restart（product-behavior-contract 448–458 明确 capture 没有该产品语义）。新 group capture 仍调用批准的 primitive，后续 verify 重新授予本次 validity。
- same topic new run / `--restart`：**OWNER DECISION REQUIRED A1**。注释与 CLI 说丢弃 checkpoint；推荐执行所有新 stage，不复用旧 derived stage，且非破坏性保留旧 canonical bytes。是否允许同题显式重用旧 ResearchPlan 是独立选项，当前无选项，不能静默允许。
- same topic changed config：不作原 run 的 resume；返回 identity conflict 或显式 restart 新 run。无无条件 provider/model fallback。
- same topic changed model：当前 CLI 只支持固定 runtime；不能借 A lane 扩 runtime/model 路由。未来批准的 model 变更至少失效 affected semantic tail。
- **OWNER DECISION REQUIRED A2**：失效的 complete checkpoint 是否仅报告原因、由用户 restart，还是自动从最早失效 stage 继续（有费用/网络后果）。建议本 lane 默认明确 fail-closed，并对 ordinary interrupted resume 保留既有 valid sibling 恢复。
- **OWNER DECISION REQUIRED A3**：旧缺版本 checkpoint 一律不可复用的迁移策略、同题 restart 是否保留旧结果读取能力。不能把完整旧历史证据销毁作为“最小修复”。

## F05 frozen clarification 合同

用户 clarification 是对 pending decision 的显式选择，输入为既有 T08 `forceGroupIds`，不是自由文本覆写 plan。生产 CLI 接入一个明确选项/文件输入（具体拼写非产品合同；不新增聊天系统）。绑定至少 run identity + planHash + **真实 candidate pool hash** + selector effective config/version + pending decision hash；只靠 `poolPlanHash` 不够，同 plan 两次 retrieval 可得不同 pool。

ambiguity STOP 前 controller 必须成功持久化 frozen accumulated pool、相应 coverage ledger、pending decision 和 binding；任何写失败不能宣称“可恢复等待选择”。带合法 clarification 的 resume 先验证上述 hash/binding，再调用现有 `selectSourceGroups`，传同 pool+plan+config+clarification，成功后从 T09 capture 继续。不得重新检索；不得重新 planner；不得另建 bypass selector 的 forced selection 入口。

有效选择必须满足：pending ambiguity 存在；全部 mandatory groupKeys；准确 free-slot 数；成员只来自已展示 options；canonical/unique IDs；成功 resolution count=1。成功后任何第二个不同 clarification 拒绝；相同 answer 的传输重试可幂等复用已验证 resolved decision，不消耗第二次选择，不重复 capture。既有 resolver 自己不负责持久化跨调用次数（1025 count=1 是 output），composer 负责保存/检查一次性执行事实。

**OWNER DECISION REQUIRED D1**：invalid input 是否消耗这一次 clarification？推荐不消耗成功解析次数，返回固定 invalid_clarification，保持原 pending snapshot 不变，且不重新发一个新问题；规范“最多一次”可解释为问一次，也可解释用户仅提交一次，因此必须裁决，不能由实现者猜。严格 terminal-invalid 也是可选，但要明示合法重试方式。pool 被删/改、plan/config drift 的 clarification 一律 fail closed/stale_pending；不能重新 retrieval 后套旧 answer。

## bounded same-class search

范围只查 P1 composer、state.mjs、T08 persistence/reuse、T09 resume，以及 legacy orchestrator 的 reuse 调用；未扫描新系统。

1. SAME_ROOT_CAUSE A：P1 runIdentityHash 实参只有 topic/mode/percent/runtime（composer 316；state 57），缺 Spec 302 要求的 provider/config identity；非 complete resume 361–363 重置 state 后从 retrieval 重走（419–433），并非 stage-aware reuse。配置 drift 尚无新增 live/端到端实证，不能冒充审计第9 finding，但必须使 A 合同封住同一复用口。
2. SAME_ROOT_CAUSE D：T08 `selectionDecisionStatus` 1165–1195 的 currentPoolPlanHash 实为 planHash，不是 candidate bytes identity；`loadSelectionDecision` 1132–1153 只查 object/type；因此 D 不可把这两个现有函数当已具 frozen-candidate integrity 的证明。需要在新的 production caller 处先验证 frozen artifact 绑定并重新调用现有选择 validator。
3. SAME_ROOT_CAUSE D：integration 478 后忽略 `persistSelectionDecision` 返回值（480）。待澄清状态的 durability 必须处理写失败，不能继续许诺 recoverable STOP。这是 D 接入持久化必要条件，不扩展为全仓 persistence 审计。
4. ADJACENT_DEFECT：legacy `validateArtifactCheckpoint` 145 仅在 expectedHash truthy 时比较；`validateCheckpoint` 174 默认 null；v0.3 orchestrator 628 COMPLETE 分支依赖此结果。源码显示缺 hash 可退化为存在性检查，但本轮未造新 v0.3 probe，不进入 P1 修复 scope。A 不应把 legacy helper 的行为当可信缺省，也不应顺手改所有 caller。
5. POSITIVE CONTROL：T09 resume 967–1080 已校验 plan、selection set、selection decision、group identity、answers/handoff hashes，且支持 valid sibling；不重写该 owner。

## lane A 与 D 执行边界

|字段|A — P1 run/checkpoint validity|D — clarification production reachability|
|---|---|---|
|FINDINGS|F01/F02|F05|
|ROOT CAUSE|全 run reuse provenance/闭包缺失，两个 caller 只验局部|底层 resolver 未接生产及 frozen continuation|
|TARGET|上述 RUN_REUSE_VALIDITY_CONTRACT|pending snapshot 一次合法 continuation|
|IN SCOPE|P1 专用身份/依赖验证、restart隔离、complete复用、必要最小 dependency metadata|CLI输入→composer→既有 T08、pending持久化、config/pool binding、一次性/幂等|
|OUT|新状态引擎、在线freshness、自动model切换、canonical删除、legacy全面改造|聊天系统、目标重检索、#53、改T08评分/阈值/选择算法|
|LIKELY FILES|lib/p1-runtime-composer.mjs；P1限定 checkpoint 辅助（仅必要时）；lib/coverage-final-integration.mjs；必要 state helpers/test；不改变T13单写者|bin/research-p1.mjs；lib/p1-runtime-composer.mjs；lib/coverage-final-integration.mjs；T08 persistence helper仅所需|
|PRODUCTION CALLER|research-p1 → composeP1Research|同上→applySourceGroupSelection→selectSourceGroups|
|TEST CALLER|现有 runtime-composition-wiring + dedicated P1 checkpoint tests|相同生产 composer + CLI argument parser/子进程 + frozen T08 tests|
|DEPENDENCIES|A1/A2/A3 contract decisions；语义/投影 version contract（可先预留明确版本字段）|A run/config/pending identity；D1 invalid attempt policy|
|PARALLELISM|F01与F02不拆并发同文件；A测试设计可与别lane并行|待A合并后改composer，避免同文件竞写；T08反例设计可先独立|
|MODEL|GPT-6 high/xhigh：持久化/闭包/架构判断；窄测试可Sol|GPT-5.6 Sol high；复杂resume判断由GPT-6复核|
|REVIEWERS|独立CODE_REVIEWER，自己构造跨run/依赖missing/drift反例；合同若改Approved Spec需CONTRACT+CONSISTENCY quorum|独立CODE_REVIEWER，独立CLI/frozen pool/重复submission反例|
|ACCEPTANCE|真实生产caller offline反例+不触发模型/provider的reuse；新old绑定无混合；精确SHA tests/CI|同一frozen pool合法选项真实进入capture；no retrieval/planner；invalid/no pending/第二次一律明确定义|

## 具体 regression / acceptance 清单

A1 restart_different_topic：使用旧合法 plan + 原 run state，对新 topic restart，断言旧 query 不执行；planner fake返回新 plan；结果只能绑定新题；不是把 probe exit0当PASS。
A2 complete_missing_research_plan 与 complete_missing_canonical_answers：先走真实 composer+离线adapters生成完整成功，再单独删除依赖；拒绝 reused/complete，不手造成功state。
A3 对 hash mismatch、missing handoff、changed selection、changed claims/synthesis、changed config、legacy missing version、corrupt state/unknown schema各做同类变体。未变全部依赖应零额外检索/模型调用成功复用；valid sibling 不重抓。
D1 clarification_resume：首次必定 ambiguous（不得沿用现有 wiring test 537–539 “ok true or false 都接受”的弱断言），保存 pool；第二次携带合法选择，断言capture收到正确集合、query调用数不增加。
D2 在等待期间改变 live adapter结果但不改磁盘 pool，合法answer仍按旧冻结 pool继续；修改/删除磁盘 pool必须拒绝；同plan不同pool不能仅靠planHash通过。
D3 invalid IDs/重复/越界/漏required/错误cardinality/无pending/第二次不同answer、相同answer网络重试、decision写盘失败、CLI input malformed、绑定缺失。所有负例断言零capture/零model并保持pending数据按合同不变。

DAG：`A-contract + D-policy → A实施与回归 → A独立review → D实施与回归 → D独立review → merged组合gate`。Regression 属每lane，不等最后CI。CI lane 可先建立 gate、各lane逐次补required测试；最终组合跑 full offline。A需消费 B/C 最终 semantic/projection version，故允许先并行实现稳定字段，最终整合必须用真实新version再验证缺失旧版本拒绝与变更失效。

本草稿状态：可独立review，但 A1/A2/A3/D1 仍 OWNER DECISION REQUIRED；未冻结这些选择前，不应授予 execution readiness。必要observability只限当前reuse拒绝原因、resume boundary、绑定hash及clarification count；不构建 #79。
