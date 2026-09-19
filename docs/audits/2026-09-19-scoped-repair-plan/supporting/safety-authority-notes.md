# F04 / F08 scoped repair lane draft

基线：主审fresh-fetch确认origin/master=4bea7b30b3842a876e383977686a0abc0d68302f；审计发布eb02a660cdb3ada07ee08f742e2987bb7da8b9e8。本代理读当前源码、authority、审计README/PROCESS/F04/F08/projection probe，不复跑真实模型、不改repo。以下均为设计草稿，非授权实现。

## LANE C — Safe corpus projection (F04)

ROOT CAUSE：P1 T13新建了fenced字符串投影，但仅检测canonical ID，没有消费继承的HTML Agent View及reference sanitization合同。buildRealSourceContentLoader (`research-orchestration/lib/rce-provenance-adapter.mjs:305-319`)保持raw canonical HTML是正确的；错误不在canonical loader“没清洗”，而在消费端`per-group-claim-extraction.mjs:141-155,270-275`把raw text直接包装送出；`deepseek-research-runtime.mjs:168-169`直接发该字符串。

CURRENT CONTRACT：P1 Spec §10.1 (`docs/specs/p1-cross-question-deep-research.md:598-601`)明确继承V2；V2 `docs/specs/v2-rich-content-fidelity.md:423-456`要求有语义结构的deterministic inert projection、代码正文DEFAULT OMIT+metadata、图片bounded host/classification metadata、外部链接domain/classification、外图无完整URL。RULES §1/§5要求凭据不进入产物/日志，tool-less隔离不是prompt承诺。

### Existing capability: exactly what can be reused

- `corpus-anthology/lib/lmstudio-projection.mjs:81-109` buildProjection输入是**已stripHtml的纯文本**+短sourceId+可选meta，不是HTML renderer；输出exact `{kind:'deterministic-analysis-projection', sourceIds:[token], text:'[SOURCE token]…'}`。sourceId可为短opaque token；canonical identity继续由controller私有映射拥有。
- `lmstudio-projection.mjs:23-64` sanitizeProjectionText确定性移除百分号，替换scheme/URL/www/路径/反斜杠/SOURCE marker，删除控制/不可见字符；不保证代码body移除、不保留image host，也不是任意secret识别器。禁止把“调用此函数”写成完整V2安全验收。
- `corpus-anthology/lib/lmstudio-tool-less.mjs:135-196` assertProjection做exact shape、单sourceId、唯一SOURCE tag、remote/file reference拒绝。不能原样拿单source断言检查P1多source group；必须先逐source安全投影/断言，再由controller组装现有token group frame。不得为接入而放宽共享assertProjection。
- `corpus-anthology/lib/text.mjs:36-48` stripHtml仅移除script/style、标签并解码/转义；pre/code正文仍保留，标题/列表结构也丢失。现有`chunk.mjs:84`→`lmstudio-map-executor.mjs:96-105`复用了reference sanitizer，但不是完整V2 HTML Agent View实现。
- `zhihu-answer-grabber/src/rich-renderer.js:18,214,270-306,499`已有parse5与白名单HTML→Human Markdown渲染器；Human View故意保留code和URL，不能直接用其默认输出冒充Agent View。应复用既有parse5解析/分类能力、现有reference sanitizer/拒绝器，补足一个最小统一Agent projection入口，**不得新增第二parser或第二套URL/path sanitizer**。最终模块放置与MIT/AGPL依赖方向需实现前明确；不要让MIT corpus包反向耦合AGPL renderer而未审查许可/包装影响。

TARGET CONTRACT：canonical HTML bytes/hash不变；controller从每个已验证source导出安全Agent文本（结构保留、code metadata/body omit、inert host/classification、无raw HTML主动内容/完整remote-file references）；逐source检查通过后再opaque-token封装；不漏selected source，不因过滤后空内容静默移除；语义输出identity映射仍只归controller。filter→empty的source必须保留accounting，但不得借“empty result accepted”擅自宣称语义已经分析成功。

CREDENTIAL：SemanticRuntime仅接收公开语料的安全projection，不带provider Secret/Cookie/API key、路径、author私密metadata；DeepSeek transport Authorization只由controller配置（`deepseek-research-runtime.mjs:111-137`），不得进入body/fixture/report。现有sanitizeProjectionText**不能检测任意裸secret**，不允许宣称全局DLP；修复不扩大credential文件读取或加入secret扫描体系。

OWNER DECISIONS REQUIRED：
1. 如P1 evidence-rich确需代码正文，必须明确SPEC/PRODUCT DECISION REQUIRED；当前默认修复遵守DEFAULT OMIT，不能用新prompt Rule5偷渡。
2. 完全由code/image/reference组成的source过滤后如何表示、如何计入analyzed语义完成，需与F03/F01 validity合同共同确定；建议显式“不可提取语义”结果/保留source accounting，未经裁决不复制legacy auto-synthesized=>analyzed假设。
3. metadata严格程度沿用V2 host/classification，不能只把所有链接替换为（链接）便宣称完全恢复保真。

FILES / CALLERS：主要`per-group-claim-extraction.mjs`投影owner+最小共享Agent HTML转换入口；复用lmstudio-projection/tool-less与parse5现有能力，尽量不改canonical loader/claims schema/DEEPSEEK routing。Production `p1-runtime-composer.mjs`→coverage integration→T13→runtime.analyze。Test `p1-t13-group-representation-claims.test.mjs`、`p1-t15-runtime-composition-wiring.test.mjs`及新增安全合同用例；最终文件清单须以模块放置裁决冻结。

COUNTEREXAMPLES / ACCEPTANCE：把审计`standards-projection.mjs`变成expected-safe断言，不复制其“泄漏=true才PASS”逻辑；fake fetch抓实际request，断言raw HTML/code canary/full image URL/file URI不存在，host/结构/code metadata符合合同，credentials仅header且任何错误/持久化无凭据；canonical原bytes/hash不变，opaque token一一对应。新增CJK相邻路径、percent编码、假SOURCE/BEGIN/END标记、嵌套pre/code、仅代码source、混合安全/不安全内容、重复title与source token攻击；拒绝不安全projection时zero fetch。现有T13/T14/lineage/coverage/production wiring回归不得削弱。

DEPENDENCIES / PARALLELISM：先冻结projection input/output与空语义政策；可与State lane独立分析/实现，但`p1-runtime-composer`共享编辑需串行集成。F03 prompt对code evidence能力的描述必须与该lane合并后的真实可见信息匹配。F07从本lane开始纳入离线test，非最后补测试。

REVIEWERS：按AGENTS.md:367，SECURITY_REVIEWER + CODE_OR_CONTRACT_REVIEWER，same exact SHA，至少一人新造反例；若改Approved Spec，另需Contract+Consistency双quorum，不用安全review替代authority变更review。实现建议GPT-6高推理（复杂安全接缝），普通fixture/CI可Sol；最终审查独立。LIVE模型仅用于修后语义能力校准，不能替代确定性projection证明。未获真实run授权不执行。

OUT OF SCOPE：新provider/model、prompt-only隔离、保留code正文的隐式amendment、联网OCR/图片加载、第二canonical store、完整DLP、#79 instrumentation。

## Bounded same-class search

- SAME_ROOT_CAUSE（纳入C）：T13 raw canonical HTML→fence→analyze这条直接消费链，包含其所有production caller。修复owner只有一个，不给每个caller加不同sanitizer。
- ADJACENT_DEFECT（单列，不自动施工）：legacy corpus `chunk.mjs:84`→text.stripHtml→buildProjection保留code正文且压扁结构，虽有URL/path sanitizer仍未满足完整V2 projection。此事实来自源码，不是本轮新造全面legacy acceptance判决。是否迁移legacy消费者进入共享Agent projection需独立scoped授权/回归；不把F04扩成全部corpus重构。
- NO SAME-CLASS BYPASS FOUND：T14 `cross-source-synthesis.mjs:331-338`发出的statement已经sanitizeProjectionText；hierarchy.mjs:149-171子claims消毒并使用现有tool-less projection。只保留其回归，不重写。
- OUT_OF_SCOPE：Planner是USER_REQUEST / MODEL_GENERATED_PLAN路径，P1 Spec §10.1明确不能机械套corpus sanitizer；合法用户URL/路径不得因F04被删除。Qualification脚本synthetic payload亦不构成production raw corpus绕过。

## LANE F — Authority hygiene (F08)

ROOT CAUSE：D2行为修复合并后，durable导航与current code comments没校准；不是运行时算法待改。

D2 IMPLEMENTATION EVIDENCE：commit `85103afdc861f81ae88c95888de662578748f5ef`仅改rrf.mjs/test。`rrf.mjs:997-1023`当前行为：每channel/qid选最低**显式rank**，仅计一次；equal-best projected rankOrigin/route/source_url/facts等价则fold，否则FUSION_DUPLICATE_CONFLICT；非法rank仍fail；跨channel继续分别贡献。`test/rrf.test.mjs:1286-1459` D2-CE1..8验证此合同（含真实响应的脱敏fixture）。本地未找到独立tracked D2 owner decision文档；实现/tests是行为证据，不得独立覆盖Approved Spec。发布前引用既有owner/Issue批准receipt，若无法定位则明确AUTHORITY_RECEIPT_NOT_LOCATED，不编造新批准。

WHAT IS STALE（只改现行含义）：`docs/project-memory.md:246`；`research-orchestration/lib/rrf.mjs:49-52`；`retrieval.mjs:32-34`；`global-search-provider.mjs:97-102,114-117,169`。保留adapter原样透传重复、不自行去重的仍正确部分，仅校准fusion downstream结局。

WHAT REMAINS HISTORICAL：原T06/T17 reviewer记录、历史审计包/AUDIT_REPORT/PROCESS/probes/evidence hash、旧commit与历史failure文字；`FUSION_ERROR_DUPLICATE_IN_CHANNEL`兼容导出/旧测试历史描述不是顺手删死代码机会。现行tests D2-CE保持，不改断言迎合旧文档；不要把runtime behavior恢复成fatal duplicate。

TARGET CONTRACT：一个current导航准确概述已批准D2，链接其authority；历史文本保持时态。Scope只限5个现行文件的对应句/注释，不重写project-memory整体、不动Approved Spec/AGENTS/RULES、不新建决策来追认历史。

TESTS / ACCEPTANCE：`rrf.test.mjs`、`retrieval.test.mjs`、`global-search-provider.test.mjs`（实际文件存在性实现票再核对）；diff明确无runtime语句改动，bounded rg复核所有FUSION_DUPLICATE_IN_CHANNEL/duplicate-fatal文本逐条current-vs-historical；没有新功能/新强制测试门。独立CONTRACT_REVIEWER最低quorum（AGENTS DOCUMENT），memory正常branch+review要求适用；若真的改产品authority则升级quorum并STOP等待owner。

DEPENDENCIES：D2 receipt核对→文档校准→contract review；可与其他lane并行，无语义lane依赖，集成仍串行。实现建议Sol中推理（窄文档+注释，审查可独立Terra/Sol高推理）。POST_GATE_MEMORY_UPDATE_REQUIRED=NO（修复目标已包括stale memory校准，不创建审查结论追记循环）。不执行任何编辑。
