# Project Memory — zhihu-grabber-toolkit

> 本文件由项目治理资产迁移（2026-08-09）从原 WorkBuddy 项目记忆提取的**稳定、非敏感、项目级、长期有效**子集。
> WorkBuddy 私有运行记忆（环境特性、本机路径、临时状态）**不进入 Git**。

## 仓库与基线

- 仓库：https://github.com/FlapPearLabs/zhihu-grabber-toolkit
- 权威 Spec：`docs/specs/v2-rich-content-fidelity.md`（Status: APPROVED，禁止未经批准修改）
- 当前 master：`27e68c1`（V2 Phase 1 收口，CODE gate PASS，四轮 review 全过）

## 架构决策（已批准）

- **V2 分 Phase 推进**；Phase 1（安全 Markdown renderer 信任根）已完成并 ff-only 合并 master：
  - `src/markdown-security.js`：`escapeUntrustedMarkdownText`（Markdown control 字符全转义 + 行级结构中和[每行含首行 + leading whitespace 首字符 NBSP 化，防跨 text-node 与 split-whitespace 累计]）、URL tokenizer / classifier / redirect 解包 / destination serializer。
  - `src/rich-renderer.js`：基于 parse5 的严格白名单 HTML→Markdown renderer。
  - `render.js` 的 `renderAnswers` 接入新 renderer：保持 V1 framing（恰好一个 `## N.`）；链接由 ID 确定性构造，不信任 `meta.url`/`answer.url`；scalar 数值收口（异常 → fallback / `(未知)`）。
- **依赖**：runtime dependency `parse5@^8.0.1` 为唯一新增（HTML parser）；**不得加第二个 parser**。
- **lockfile registry 统一 npmjs**；安装时用 `--registry=https://registry.npmjs.org` 覆盖（镜像 registry 会污染 lockfile）。

## 测试基线（稳定，离线）

- `cd zhihu-answer-grabber && npm test` → 274 pass / 0 fail / 3 skip
- `cd corpus-anthology && node --test` → 93 pass / 0 fail / 2 skip
- `node --test test/agent-pipeline.test.mjs`（仓库根，CLI×Skill 集成）→ 6 pass / 0 fail
- skip 均为既有 Windows 平台限制（symlink 相关），与实现改动无关。
- 对抗性测试资产：`test/markdown-security.test.js` + `test/rich-renderer.test.js`（Spec §23 全部对抗类别 + review 四轮反例，含 cross-node `<br>`/inline-tag 分段与空白跨节点累计）。

## 已批准产品决策 / 长期约束

- `captured` ≠ `verified`：`verified: true` 只能由 `verify-output.mjs` 授予；`make-handoff.mjs` 确定性生成 handoff，禁止手工构造。
- Agent 优先 `--json` 机器契约，不解析人类 stdout；禁止 `search --grab`（仅人类终端兼容）。
- 凭据只在本机配置，绝不进 repo / log / chat（详见 `references/security.md` 与 `RULES.md`）。
- V1 全部对外合同保持向后兼容；schema 变更只允许 additive。

## 路线图（下一阶段，未经批准不得开始）

- **V2 Phase 2**：`feat/v2-rich-content-assets`（已从最新 master 创建，空分支，未实现）。内容：image metadata / external link assets / code block assets / footnote reconstruction / additive `answers.json` assets（Spec §10-13/§18）。
- **不得在 master 或已合并分支上直接写 Phase 2**；Phase 2 实现前必须先过对应 gate。

## 历史 review 结论（沉淀）

- DOCUMENT gate（V2 Spec）：PASS（2026-08-09，Spec APPROVED）。
- CODE gate（Phase 1）：PASS @ `27e68c1`（P0/P1/P2 全 0，四轮 review：escape 完整性、framing 收口、lockfile registry、localhost namespace、cross-node 与 split-whitespace 绕过修复）。
- 建议：停止无限制地静态加 gate，进入真实使用验证与按 Phase 推进。
