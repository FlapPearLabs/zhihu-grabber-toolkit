# P1 用户澄清与恢复

当 source-group selector 返回 material_ambiguity 时，P1 保持 SELECT，退出码为 3，不进入 capture、分析或 final。用户提交显式 JSON 回应后，既有 selector 重新判断合法性；控制器不会替用户选组。

## 两步调用

从仓库根目录执行。现有凭据与 embedding 配置入口保持原样。

```sh
P1_RUNTIME_MODE=canonical node research-orchestration/bin/canonical-runner.mjs "研究问题" --work work/my-research
```

请求保存在该 work 目录的 `source-group-clarification-request.json`，并通过结构化输出的 clarificationRequest 返回。canonical 输出仍为 FAILED / CLARIFICATION_REQUIRED，不能当作 canonical acceptance PASS。

用户查看 requiredGroupIds、remainingSlots 与 clarification.options，用原请求的 binding 原样填入回应；内层格式沿用 selector 已有合同：

```json
{
  "schemaVersion": 1,
  "binding": { "这里必须是原请求完整的 binding": "此处仅为格式占位，不可直接提交" },
  "clarification": { "forceGroupIds": ["用户明确选定的 canonical question ID"] }
}
```

选择必须包括全部 requiredGroupIds，并从已有 boundary options 填足 remainingSlots。ID 是字符串，不接受重复、未知、范围外的 group，不接受自由文本修改 plan。没有默认答案或自动全选。

将回应保存为 work 目录内的 `response.json`，恢复同一问题和 work 目录：

```sh
P1_RUNTIME_MODE=canonical node research-orchestration/bin/canonical-runner.mjs "研究问题" --work work/my-research --clarification work/my-research/response.json
```

专用 P1 产品入口也支持 `node research-orchestration/bin/research-p1.mjs "研究问题" --work work/my-research --json --clarification work/my-research/response.json`。恢复不能与 --restart 同用；canonical 默认首次调用仍显式 --restart。

## Seam map

| 项 | 既有 owner / 接线 |
| --- | --- |
| PRODUCER | selectSourceGroups；ambiguous/material_ambiguity，已有 clarification options |
| REQUEST | 原 selector clarification + 最小 state binding envelope；required groups / remaining slots 来自原 plan 与 intendedGroupCount |
| CURRENT_CONSUMER | applySourceGroupSelection 的既有 clarification 参数 |
| MISSING_PASS_THROUGH | 已增加 composeP1Research.clarificationResponse 与 P1/canonical --clarification |
| RECOVERY_CALL | 同 occurrence 的 R06 planResumeReentry → 同一 selector → 原后续流水线 |
| STATE_BINDING | run/occurrence、planHash、pool/ledger bytes、pending decision hash、selector version/default config、composition config fingerprint、targeted enablement |

request 通过已有 staging → checkpoint → materialize 协议提交；checkpoint.hashes 的 source-group-clarification 是附加依赖绑定。回应不是 checkpoint、研究证据或新的选择权威。历史 pending bytes 保留在既有 staging；resolved decision 沿用既有 clarificationCount/forcedGroupIds 记录，events 记录 clarification_supplied。

响应在任何 planner/检索/状态改写前校验。非法输入保持原 pending 和 checkpoint；不消耗成功机会、不生成第二问题。合法但不足的选择保持 clarification_required；修正后可重试。只允许一次成功 resolution；同一已成功 ID 集合可幂等恢复，第二个不同集合拒绝。绑定失效时拒绝旧回应，不能重新检索后套用它。

旧 live smoke 没有该 checkpoint 绑定，因此保留为历史失败；新的 live smoke 必须先 fresh 生成请求。两 arm 用同一协议，回应者只看原问题、请求和声明的用户意图，不能看 arm 身份、#108 enablement 或 downstream 结果。

selector 排序、ambiguityMargin、plan/run identity、STOP 和 checkpoint 的权威角色均保持既有合同。焦点验证：`node --test research-orchestration/test/p1-clarification-recovery.test.mjs`；原始 RED 证据为 test-only commit a57dad6。
