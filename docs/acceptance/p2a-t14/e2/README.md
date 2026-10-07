# T14 预算类型窄修后的统一证据

原始运行 SHA：d7d335792df7ddd3fcab179fc7a6b61d6c683e5b，clean source；真实 composition 为 25/25 PASS，§20-1…12 为 12 PASS。
pk/source-campaign.json 和 matrix.json 明确保留这一 producing SHA。后续归档提交须在其最终 exact SHA 重跑并接受 fresh review；此处没有出具最终 reviewer receipt。

预算类型回归先通过真实公共 composer 得到 RED（退出 1，7 tests / 3 pass / 4 fail），修复后 focused suite 为 83/83 PASS。
这两份日志属于 BUDGET-REPAIR.json 明示的工作树支持性证据，未冒充 clean exact-SHA 验收。
只有 RED 日志中的已知本机工作区前缀被替换为 <candidate-root>；原日志 hash 与便携日志 hash 分别保留。
三个旧独立审查原字节保留在 rejected-e2f/，均为 e2f60fd 的 CHANGES_REQUESTED / P0=0 / P1=0 / P2=1。

ARCHIVAL.json 绑定所选文件、108 个源码输入、934 次 manifest/index 引用检查和 42 个阶段/action T08 输入原字节校验。
pk/ 保留实际 checkpoint、ledger、paid pool、controller/provider trace 与原 T08 输入；缺失或篡改的故障工件明确标记 FAULT_EVIDENCE。
72 个基础矩阵字段、52 个 crash 元数据以及 7 个 source guard 负对照全部被拒绝。
这些数据字段与 source guard 负对照不冒充产品 runtime mutation。

用户对小修采用适度审查的明确调整及本次路由见 REVIEW-ROUTING.md。当前等待一位 fresh CODE reviewer 和最终 SHA 门禁。
PR #132 / Issue #126 留存最终收据、CI、ff-only、远端 equality 及 post-master fresh-clone 结果。
§20-13 / 研究价值仍 OUT_OF_SCOPE，归 #107/#127/T15。

从仓库根按 e1/README.md 的命令重跑新 exact SHA；复用 e1/controls/ 的既有检查器。
package-evidence.mjs 接收 campaign 输出目录和一个尚未使用的便携包输出目录。
Windows 路径投影只是布局检查，实际三平台 Node 22 CI 才是平台执行证据。
