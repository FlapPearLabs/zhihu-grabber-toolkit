# P2A-T14 独立验收原始收据

ROLE = ACCEPTANCE_EVIDENCE_REVIEWER
BASE = 854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
REVIEWED_HEAD = e2f60fd044d4bf45ce03cb7eb12b16c286aab8f0
REMOTE_TIP = e2f60fd044d4bf45ce03cb7eb12b16c286aab8f0
REVIEW_VERDICT = CHANGES_REQUESTED
ACCEPTANCE_VERDICT = CHANGES_REQUESTED
P0 = 0
P1 = 0
P2 = 1
ACCEPTANCE_BLOCKERS = 1
PROJECT_MEMORY_UPDATE_REQUIRED = NO（本失败审查门不更新；后续集成状态由 owner 维护）

此收据源自 fresh remote 完整历史 clone 与实际执行，未参与实现、未继承历史 PASS/收据。没有修改 owner source、remote、Issue 或 PR，没有再调子代理，也没有修产品。

## 唯一发现

[P2] composer 在冻结 T05 输入校验前强制转换预算（p1-runtime-composer.mjs:1291）。公开 composer 的独立支持性探针对 integer4、string"4"、Infinity、valueOf()=>4 对象各运行完整链；四者均 ok=true、provider=6、targeted=2。后三个非法输入应在 targeted IO 前被拒绝。T05:655-656 原 Number.isInteger 正整数要求被 Math.min 隐藏。原始探针及 JSON/日志已保存，证据属于本 SHA supporting composition observation；不冒充第26个统一场景。未证明合并后预算超支，也不把 policy4/P1默认cap10 外推为 P1 STOP 配置变化，故严重级别 P2。应最小恢复原输入校验并在新 SHA 重新审查。

## 指定冻结矩阵的实际观察

统一 driver 实际退出0，25/25 PASS；自行重新编译 matrix 12 PASS、0 FAIL、0 NOT_PROVEN。每行来自当前完整 occurrence；无法将该固定 valid-policy 矩阵 PASS 推广为对非法预算输入的最终签字，因此总 gate 为 CHANGES_REQUESTED。

| Spec | 本次 principal scenario | 观察判定 |
|---|---|---|
| §20-1 | unknown-gap | PASS |
| §20-2 | canonical | PASS |
| §20-3 | free-form | PASS |
| §20-4 | canonical | PASS |
| §20-5 | provider-scope | PASS |
| §20-6 | equivalent-query | PASS |
| §20-7 | per-gap-bound | PASS |
| §20-8 | canonical | PASS |
| §20-9 | canonical | PASS |
| §20-10 | crash-after | PASS |
| §20-11 | canonical | PASS |
| §20-12 | stale-action | PASS |
| §20-13 | OUT_OF_SCOPE | OUT_OF_SCOPE |

§20-1 unknown 由 controller 拒绝，合法 unknown gap=0、targeted action=0、targeted provider=0；planned IO=4 不能混称 targeted IO。§20-6 等价二次诊断真实拒绝 EQUIVALENT_QUERY_ALREADY_AUTHORIZED；§20-7真实第二 proposal 拒绝 PER_GAP_ATTEMPT_BOUND_EXCEEDED，各拒绝后 targeted delta0。globalbudget 实际 total4、targeted2、BUDGET_STOP，与诚实终态检查通过。

crash-before 首次真实 SIGKILL 后合法 targeted 重跑 delta2；crash-after及双向 prior/framing漂移恢复 delta0，原输入字节、checkpoint与单COMMIT绑定都通过；COMPLETE ordinary resume保持输入与零targetedIO。血缘从 final→gap→action→normalizedQuery/providerScope→RRF pool/hash/result 正反 join，无 orphan/cross-gap；stale/tamper/missing 控制真实 executable 拒绝且无重复付费。只有 search/capture/semantic/embedding 外部 doubles，诊断、授权、预算、checkpoint、replay、resolution、lineage 使用实际产品函数；fixture proposal 是公开不可信 policy 输入，不替代内部 authority。

## 负控与归档

72字段负控、52crash原始元数据负控保留 scenario verdict/其他checks后删改字段，全部撤销PASS；7来源门禁在建输出与providerIO前拒绝。首次source guard因detached clone没有脚本要求的本地branch失败已保留，不作通过；仅自己的temp clone建立对应本地branch后独立freshwork重跑7/7。

新 package 实际 STRUCTURAL_CHECKS_OK/errors0，完整 logs/campaign/package已保留。归档 producing SHA=4ab4f4e…，当前审查SHA=e2f60fd…；108源码hash对当前代码匹配，467归档files bytes/hash、934manifest/index引用、42阶段/action原T08输入scope/closedshape/checkpoint/hash与crash raw metadata均重算通过。FAULT_EVIDENCE缺失/篡改hash明确不证明存在原字节；包中缺失故障refs按故障标签保留，未冒充原字节。包扫描未发现本机绝对路径或token；短路径projection230只证明布局，三平台实际CI由root收齐，supporting/full-offline均不替代T14。

RED-FIRST 3原字节hash及ARCHITECTURE-APPROVALS 5原字节hash均一致；bounded RED绑定clean preimplementation054与design hash，dirty recovery RED明确WORKING_TREE_SUPPORTING/expected assertion exit1。设计审查原文明确设计批准仅在有限授权及RED-FIRST之后允许产品实现；Git对象/ancestry与原文source顺序吻合。归档commit时间不单独证明历史临时文件墙钟先后，未将归档或旧review转授当前SHA。

该验收不声称researchquality提升；§20-13 OUT_OF_SCOPE，归#107/#127/T15。来源末次ls-remote仍为exactHEAD，master仍BASE，源树干净。

## 交付与自检

review.md为本独立原始收据，validation.json保存commands/exits/counts/identity与检查摘要；artifact-manifest.json逐文件SHA256绑定logs、campaign、package及probe，artifact-manifest.sha256绑定清单本身。详见各.log及archive-audit.py输出。未使用额外skill/subagent，未更新规则/门禁/文档，临时审查记录之外无仓库写入。
