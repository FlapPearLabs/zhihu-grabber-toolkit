# T14 有限修补后的统一运行证据

原始运行来源：`4ab4f4e730d1c72dcd3e93d17691324eca8d65b9`，clean source，Node `v26.10.0`。
真实 composition 的 25 场景全部 PASS，`matrix.json` 为 §20-1…12 的 12 PASS。
归档提交及以后 SHA 必须重新获得独立审查；本目录不出具 reviewer receipt。
最终同 SHA 三角色收据、CI、ff-only 及 post-master/fresh-clone 记录以 PR #132、Issue #126 为准。

`pk/source-campaign.json` 和 `matrix.json` 保留原始字节与来源 SHA。
`pk/scenario-manifest.json`、`pk/lineage-index.json` 绑定所选便携工件；
`ARCHIVAL.json` 保存文件 hash、108 个源码输入指纹、934 次引用检查及 42 个阶段/action 快照校验。
大 capture/corpus 与完整原始 observations 未纳入便携选择；原 campaign 内的路径仍是原运行相对路径。
故障负控的缺失/篡改工件明确标记 FAULT_EVIDENCE，不把故障前 hash 当成现存原字节。

三个新增 SIGKILL 场景分别覆盖：重复-only 输入漂移、new-evidence 输入反向漂移、
contradiction framing 漂移。每个场景保留原/终 checkpoint、T08 输入原字节、controller/provider trace、
单一 COMMIT、恢复与 COMPLETE ordinary resume 的零 targeted IO 证据。

字段负对照保持场景 verdict 与其他 checks 为 PASS，仅删改待测字段：

- `controls/crash-metadata-red-b110515.json`：旧矩阵 52 个变异未拒绝，真实断言退出 1。
- `controls/crash-metadata-green-4ab4f4e.json`：修补后同类 52 个变异均拒绝，基线保留 12 PASS。
- `controls/matrix-fields-4ab4f4e.json`：72 个基础字段负对照均拒绝。
- `controls/source-guards-4ab4f4e.json`：缺失/错误 SHA、staged、unstaged、untracked、执行脚本漂移
  七类输入均在创建 campaign 输出与 provider IO 前失败。

这些是 DATA_FIELD / SOURCE_GUARD 负控，不冒充产品 runtime mutation 或独立 review。
修补前产品 RED 另见上一级 `RED-FIRST.json`。

从仓库根对新 exact SHA 重新运行，然后检查其数据；输出路径须尚未使用：

```sh
T14_SHA="$(git rev-parse HEAD)"
node research-orchestration/scripts/p2a-t14/driver.mjs --expected-head "$T14_SHA" --out "$T14_OUT"
node docs/acceptance/p2a-t14/e1/controls/matrix-fields.mjs "$T14_OUT" "$T14_FIELD_OUT"
node docs/acceptance/p2a-t14/e1/controls/crash-metadata.mjs \
  research-orchestration/scripts/p2a-t14/matrix.mjs "$T14_OUT/campaign.json" "$T14_CRASH_FIELD_OUT"
node docs/acceptance/p2a-t14/e1/controls/source-guards.mjs \
  "$PWD" "$T14_SHA" "$T14_GUARD_WORK" "$T14_GUARD_OUT"
```

本目录短路径的 Windows 绝对路径投影最长 230 字符，仅是布局检查；三平台 CI 才提供真实 checkout/test 证据。
§20-13 / 研究价值仍 OUT_OF_SCOPE，归 #107/#127/T15。
