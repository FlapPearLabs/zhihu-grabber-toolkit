# 2026-09-18 独立系统与架构审计证据包

**待 owner 审查；不是产品验收 PASS，不授权修复或合并。**

- 审计产品 SHA：`4bea7b30b3842a876e383977686a0abc0d68302f`
- 历史 P1 accepted product：`9444a33b3ca24a53f8da4b9e2cb03a241925f47f`
- 历史验收 evidence：`a6fd4bd66e9d1c4b073d3fb13e82c8885fe37eea`
- 原审计结论：`REPAIR_BEFORE_NEW_DESIGN`
- 本次发布授权：用户要求“把调查证据，过程，报告，测试上传远端我来审查”。仅新增本目录；未修产品、改门禁或更新 tracker。

## 建议审查顺序

1. [完整审计报告](AUDIT_REPORT.md)：15 节、8 个 finding、已证/未知边界、#79 A/B 方案。
2. [调查过程与复现说明](PROCESS.md)：实际步骤、失败与恢复、各 agent 角色、限制。
3. [Architecture 反例结果](evidence/architecture-counterexamples.json)、[Spec 反例结果](evidence/spec-counterexamples.json)、[安全投影结果](evidence/standards-projection-result.json)。
4. [完整研究测试日志](evidence/research-final.tap)：840 total / 831 pass / 0 fail / 9 skip。
5. [GitHub CI 快照](evidence/ci.json)、[open Issues](evidence/open-issues.json)、[#48](evidence/issue48.json)、[#32](evidence/issue32.json)。这些是审计时读取的快照，不自动随远端更新。
6. [HTML 可视化](architecture-review.html)：下载后打开；GitHub blob 页面不会执行 HTML。文字/卡片有本地 CSS，Mermaid/Tailwind CDN 只用于展示，报告中无凭据。

## 三个可移植反例

在本分支 repository root 执行（Node.js 支持 ES modules；原审计 Node v25.8.0，CI Node22）：

```sh
node docs/audits/2026-09-18-system-architecture/probes/architecture-counterexamples.mjs
node docs/audits/2026-09-18-system-architecture/probes/spec-counterexamples.mjs
node docs/audits/2026-09-18-system-architecture/probes/standards-projection.mjs
```

脚本不调用真实模型或抓取、不读取真实凭据。Architecture 脚本只在 OS temp 生成并篡改合成文件；其他脚本使用仓库 fixtures 与 fake runtime/fetch。**exit 0 表示观察到被报告的错误行为，不表示产品通过。** 修复以后这些调查脚本可能不再通过，应据 expected behavior 另建防回归测试。

`probes/` 相对原脚本仅调整 import/默认仓库定位与输出目录，保留反例语义。`original-probes/` 是路径脱敏的原脚本文本，供核对演变，不作为直接执行入口。`published-*-replay.json` 是发布副本重新运行结果，已与原 observed JSON 深比较相等。

重跑完整研究套件须先安装 grabber runtime dependencies（仅当本地尚无依赖）：

```sh
npm ci --prefix zhihu-answer-grabber --ignore-scripts --registry=https://registry.npmjs.org
cd research-orchestration
node --test --test-reporter=tap test/*.test.mjs
```

完整 suite 的部分 fixture 使用 Git 历史：需完整 clone 中可读取 pinned historical SHA，单独下载 source archive 不足。真实语料/模型 suites 在证据缺席时 skip；不能将 skip 算验收通过。建议在 disposable checkout 运行，suite 本身会创建 OS-temp Git fixture branches；不修改目标仓库分支。

## 内容完整性与脱敏

- [SHA256SUMS](SHA256SUMS) 校验包中全部其余文件：在本目录运行 `shasum -a 256 -c SHA256SUMS`。
- [provenance.json](evidence/provenance.json) 保存原日志与发布日志 hash、是否路径脱敏；发布日志不是冒充逐字未改的原日志。
- 未上传原始真实知乎 corpus、凭据、node_modules、整份源码副本或私人会话转录。原始 corpus 本次未取得；完整过程仅为基于工具记录重建的操作记录，不包含模型内部推理。
- 失败日志保留：初次 archive 缺 `.git`、补足 Git 读取后的复跑、空 stdout 文件等均在 PROCESS 解释。

## 审查边界

原审计报告保持历史时态；本次远端上传是后续授权动作。当前分支只供审阅，不等于 master 已接受本报告，不自动关闭任何 Issue。产品修复、Spec 决策、CI 扩展与规则沉淀均待另行授权。
