# #107 原始独立审查与修复记录

REVIEW_VERDICT = CHANGES_REQUESTED
REVIEWED_HEAD = 71e4ae1718562dad44c04bd0832852a69d120ce3
BASE = 880862566478f9885b9a3c5bf25581529edd2a28
REVIEWER = independent evaluation_reviewer
P0=0 / P1=1 / P2=1 (correctness blocker)
POST_GATE_MEMORY_UPDATE_REQUIRED = NO

F1 [P1] run.mjs:87 INVALID路径直接sha256(canonicalJson(publicInput.plan))，没有生产planHash domain separation。AUTHORITY所有四结果为e3888a98b350df4e6a7ec8c9902f6117f1509baae8f4e5e22dd12aa52308ee40，而原selection/actions/ledger为a5608bb428aeea195c046926e8d67c3818d91b9e569a8078766db6470b6b6a3b。修复：只读observer复用loadPlan(workDir)，计划非法则拒绝，不新增产品identity算法。

F2 [P2 blocker] run.mjs:139 INVALID缺final gap block却将[]计算为targeted_action_count=0。AUTHORITY candidate raw ledger有3个动作和10次retrieval（baseline4）。修复：UNKNOWN，保留真实成本和raw ledger，不修改或自填final product state。

原独立验证：focused6/6，归档678产品hash、40manifest hashes、718exact-tree文件；16complete closure+metrics复算；fresh20结果及678hash一致。额外反例：cost-only无GAIN、删1103出现REGRESSION、修改raw answers被closure拒绝、无final claim不算内容hit、unverified拒绝。未发现其他P0/P1。Tier2 NOT_RUN、synthetic限制保留。

修复后新增实际incomplete-worker回归，完整campaign-corrected重跑。原找错SHA与campaign-final原文留存，不追溯改hash，不复用旧PASS。需fresh exact-SHA独立review才可集成。

## 第二次独立审查（0a6081cc092a971875163a53c52932f411a972c7）

REVIEW_VERDICT = CHANGES_REQUESTED; P0=0 / P1=0 / P2=2 blockers; POST_GATE_MEMORY_UPDATE_REQUIRED=NO。
原F1/F2经独立复核关闭。新F3/F4由GitHub自动review提出，fresh evaluation_reviewer_fresh实际负控确认。

F3：CONTROL baseline真实aspect 2/2；保持product artifacts不变，仅将一个support qid改999999或statement改为语料不存在文本，旧evaluator接受并报告1/2，会伪造weak baseline。修复：evaluator-only闭合schema，case/version/time_scope绑定，所有target/support/key expected_text/hidden ID/provenance material必须对应public frozen corpus；非法数据直接拒绝，不是产品miss。primary匹配定义不变。

F4：在隔离exact0a clone，首个product目录出现后替换CONTROL hidden time_scope，旧CLI仍exit0/stability PASS并把未提交bytes绑定到0a。修复：worker前仅读取commit blob OID元数据，不读取hidden内容；两个workers完成后一次读取buffer，对同buffer算GitOID/sha256并parse。root benchmark与public input同样绑定已提交字节，post-run不重新读另一版本作hash。新增两个负控：curator错误/unknown schema拒绝、metadata绑定后hidden字节变化拒绝。

第二次独立验证：7/7focused、20 owner planHash、678 archived hashes和40manifest hashes、16closure+metrics、10comparison；额外20产品执行稳定。以上仍不能抵消F3/F4，旧结论不转移。当前完成修复与campaign-bound，需最终fresh exact-SHA reviewer通过。
