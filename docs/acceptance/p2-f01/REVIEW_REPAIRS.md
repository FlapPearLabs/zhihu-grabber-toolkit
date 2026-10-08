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


## c4aeba40f46b8f651739c01a30b68e7a9f6a16d2 后续反馈

自动 review 在 original heads 0a6081cc / c4aeba40 上提出11条剩余反馈（原评论永久保留于PR133 discussion_r4214236194 至 discussion_r4214290519）；前述F3/F4已修不重复计。fresh evaluation_reviewer_final 重新读取后确认 hidden 的仅逻辑输入白名单没有满足物理存放边界，不能沿用先前无finding的中间判断授予PASS。

本次修复仅evaluation：staged product tree不含gold/.git/evaluator/acceptance，无回原repo链接；真实production defaultRunner从stage运行。descriptor安全唯一ID、相对文件与公开payloadID一致、manifest version/scope/闭合schema；真实pair owner run/plan身份相等且occurrence不同；normalized route碰撞拒绝并用Map；canonical原text保留且md展示复用既有HTML/Markdown转义；degraded从实际已hit任意family选取，全部无hit拒绝；报告case数量/credential reason从实际campaign渲染。未改case、route、target、metric或产品实现/authority。

TDD：normalized collision原代码为Missing expected exception，修复后拒绝。focused15/15包括manifest错误/路径/duplicate、observed owner drift、空key family真实aspect degradation、copied root及其Node child隐藏路径ENOENT/no symlink、恶意HTML/heading/fence canonical保留且展示惰性、constructor/__proto__无route为真正空结果。需要在新SHA重跑全部campaign、fresh clone、CI与fresh independent review；旧PASS不转移。


## 476db0d602c664d20af5609f78b8b9415cbade50 自动review终态

Completed但有4条有效finding：discussion_r4214440774/775/779/784。stage环境PWD指向原checkout；HTML投影缺parse5/entities；stage复制currentworktree而非boundcommit；CLI缺out误取flag。不能称Completed为PASS。修复：platform最小env、stage复制已安装lock版本依赖并记录实际文件fingerprint、Git ls-tree/cat-file源码、option存在与值检查。HTML测试新增真实product.ok断言后原476失败（false != true），补依赖后通过。新增实际子进程无pointer/env injection，实际小Gitrepo boundsource与后来dirtytext隔离；focused17/17。需新SHA全20run/fresh/CI/fresh independent review。
