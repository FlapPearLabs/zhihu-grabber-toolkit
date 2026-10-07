# Standards 补充审查

REVIEWED_BASE: 854dd3cb2f9d5fa06df1dd79e7aad4ab42aea2b3
REVIEWED_HEAD: 363e613cfc92e840452bb32b138b505677b43716
VERDICT: CHANGES_REQUESTED（Standards 轴；不构成 #126 quorum）

**P2 — 已暂存源码可冒充 exact SHA。** `research-orchestration/scripts/p2a-t14/driver.mjs:17` 仅执行 `git diff --name-only`，漏掉 index 与 HEAD 的差异；第18行及 fixture 从磁盘加载产品。若产品修改已暂存，`sourceDirty=[]`，运行代码仍可能不等于第16行记录的 HEAD；`matrix.mjs:25-27` 会接受该身份。违反 AGENTS §5.2 Identity / Tests-Evidence、RULES §10-11 证据真实性及附件 §5 EXACT_REPO_SHA。最小修复：检查 tracked source 相对 HEAD 的全部差异，并在执行前拒绝；不要仅依赖矩阵事后解释。当前初始工作树干净；此发现不声称已有证据 SHA 错误。

盲推理：真实 composer 负责组合、checkpoint 唯一授予完成、既有检索/分类器负责产品语义，driver 和 packager 只观察并派生证据。三个产品接缝与此一致；未发现其他 Standards 硬违反。Fowler 判断提示：无需要更改冻结签名或抽象的 actionable smell。

实际读取：冻结附件、AGENTS、RULES、product-behavior-contract（指定旧路径不存在）、项目记忆及 F02 相关合同；固定两提交和八文件 diff、完整新增脚本、既有周边；CodeGraph 两次 explore。实际检查：初始 HEAD/clean status 与固定 diff --check（退出0）。未运行动态套件，未据执行者自述确认22/1083/267结果。源码明确保持 §20-1/6 NOT_PROVEN；不得据此报告 T14 PASS。

仅写本报告；未改产品、Git、Issue、规则或全局记忆。使用 skill：code-review；未另派子代理。POST_GATE_MEMORY_UPDATE_REQUIRED: NO。
