# Spec 只读审查

REVIEWED_BASE：854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
REVIEWED_HEAD：363e613cfc92e840452bb32b138b505677b43716
结论：NOT_PROVEN；本报告不是 #126 正式 quorum，不授权合并或关闭。

先按冻结合同盲设计：真实 composer 产生、持久化 gap；controller 授权后走唯一 retrieval；checkpoint 锚定 action/result；既有 resolution、预算和最终产物连接，负控在同 occurrence 改变一个条件。随后读取规则、Spec、三份冻结规划、两次提交及完整 diff，使用既有 CodeGraph；只核对 exact-363e613 原始证据，验证 878 个引用哈希零偏差，独立复核 canonical 双向 gap/action/query/scope/result/checkpoint/final join。未运行旧 focused suites。

1. **验收阻塞：§20-7 的 per-gap 实际执行仍未证明。** 冻结原文“全局预算 + per-gap 预算均被执行”（Spec:570；用户清单:147–148）。matrix.mjs:14 仅依赖 per-gap terminal；driver.mjs:253 只检查出现 EXHAUSTED。实际边界拒绝与放宽对照在 fixtures.mjs:222–225 直接调用 controller，未把下一次动作送回 composer，去掉上界也可能保留此终态断言。该行应保持 NOT_PROVEN；这是证据缺口，未证明产品 P0/P1。

2. **§20-1/6 缺口成立，未找到现有完整链补证入口。** Seam Contract:83–86 要求未知类型不得检索，:230–232 要求同 occurrence 跨轮去重。诊断只产生三种已知类型（diagnosis.mjs:241–289）；subphase.mjs:367 固定诊断轮 0，:383 重写 gap ledger；composer.mjs:1282–1324 仅在既有 planned loop 后调用一次。fixtures.mjs:212–234 的 nextRound/unknown 是只读挑战，不能冒充持久化真实轮次。现有 crash/resume 再入仍是轮 0。增加未知 producer 接口或新诊断轮调度应交用户决策；不能为闭票放宽完整链。

未发现所审产品差异越过冻结语义：scope 过滤遵循 E.5(8)；终态采用 G.5.1（从未授权保持 UNRESOLVED）；最终可见性落实 S10；COMPLETE 的依赖检查只拒绝复用，未新增完成凭证。其余十行是候选证据，不能整体升级 T14 PASS；未发现额外可确认产品 P0/P1。使用 code-review Spec 轴；无子代理、无产品/治理/记忆修改。

行号均相对固定仓库：docs/specs/p2-ari-f02-targeted-requery.md；docs/planning/P2_ARI_108_TARGETED_REQUERY_SEAM_CONTRACT_V1.md；research-orchestration/lib/ 中对应文件；scripts 位于 research-orchestration/scripts/p2a-t14/。用户清单位于指定附件“已粘贴的文本.txt”。
