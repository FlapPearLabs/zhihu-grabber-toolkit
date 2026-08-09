# Project Memory — zhihu-grabber-toolkit

> 本文件由项目治理资产迁移（2026-08-09）从原 WorkBuddy 项目记忆提取的**稳定、非敏感、项目级、长期有效**子集。
> WorkBuddy 私有运行记忆（环境特性、本机路径、临时状态）**不进入 Git**。

## 仓库与基线

- 仓库：https://github.com/FlapPearLabs/zhihu-grabber-toolkit
- 权威 Spec：`docs/specs/v2-rich-content-fidelity.md`（Status: APPROVED，禁止未经批准修改）
- **Phase 1 approved checkpoint**（historical，非 current master）：`27e68c1b344ed5af1e1b05887462f2792ffa4fde` —— V2 Phase 1（安全 Markdown renderer 信任根）在此提交收口合并 master，CODE gate PASS，四轮 review 全过。

> 本文件不记录 `current master SHA` / `HEAD` / 临时分支存在性等运行时 Git 状态；需要时现场获取（`git fetch` → `git rev-parse` / `git compare`）。

## 架构决策（已批准）

- **V2 分 Phase 推进**；Phase 1（安全 Markdown renderer 信任根）已完成并 ff-only 合并 master：
  - `src/markdown-security.js`：`escapeUntrustedMarkdownText`（Markdown control 字符全转义 + 行级结构中和[每行含首行 + leading whitespace 首字符 NBSP 化，防跨 text-node 与 split-whitespace 累计]）、URL tokenizer / classifier / redirect 解包 / destination serializer。
  - `src/rich-renderer.js`：基于 parse5 的严格白名单 HTML→Markdown renderer。
  - `render.js` 的 `renderAnswers` 接入新 renderer：保持 V1 framing（恰好一个 `## N.`）；链接由 ID 确定性构造，不信任 `meta.url`/`answer.url`；scalar 数值收口（异常 → fallback / `(未知)`）。
- **依赖**：runtime dependency `parse5@^8.0.1` 为唯一新增（HTML parser）；**不得加第二个 parser**。
- **lockfile registry 统一 npmjs**；安装时用 `--registry=https://registry.npmjs.org` 覆盖（镜像 registry 会污染 lockfile）。

## 测试基线（稳定，离线）

- `cd zhihu-answer-grabber && npm test` → 367 pass / 0 fail / 3 skip
- `cd corpus-anthology && node --test` → 93 pass / 0 fail / 2 skip
- `node --test test/agent-pipeline.test.mjs`（仓库根，CLI×Skill 集成）→ 6 pass / 0 fail
- skip 均为既有 Windows 平台限制（symlink 相关），与实现改动无关。
- Phase 1 对抗性测试覆盖（`test/markdown-security.test.js` + `test/rich-renderer.test.js`，含 review 四轮反例）**仅覆盖 Phase 1 相关子集**：
  - URL / 外链安全（分类器、redirect 解包、destination serializer、localhost 拒绝）
  - Markdown / raw HTML 注入（escape 完整性、control 字符）
  - Setext heading / indented code block 中和（每行含首行）
  - cross-DOM-node 注入（`<br>` / inline-tag 分段）
  - split-whitespace 累计
  - code fence / language 处理
  - 已实现的 text-node / title / author 转义面
- **V2 Phase 2（S1-S6）已实现并覆盖**：image metadata / external link assets / code block metadata / reference-footnote assets（`test/asset-extractor.test.js`）；脚注重建与对抗（重复/非法/缺失 numero、跨 answer collision、Markdown 注入、恶意脚注 URL，`test/rich-renderer.test.js`）；additive `answers[].assets` 集成、断点续传兼容、determinism（`test/grabber.test.js`）；V1 兼容回归 render/verify/handoff/CLI status（`test/v1-compat.test.js`）。
- **尚未完成、不得标记为 covered**（按已批准 Spec 相应 Phase 再补测试）：description / topics（question metadata）、comments、Agent projection / capability isolation、video（Spec §16 待真实样本）。

## 已批准产品决策 / 长期约束

- `captured` ≠ `verified`：`verified: true` 只能由 `verify-output.mjs` 授予；`make-handoff.mjs` 确定性生成 handoff，禁止手工构造。
- Agent 优先 `--json` 机器契约，不解析人类 stdout；禁止 `search --grab`（仅人类终端兼容）。
- 凭据只在本机配置，绝不进 repo / log / chat（详见 `references/security.md` 与 `RULES.md`）。
- V1 全部对外合同保持向后兼容；schema 变更只允许 additive。
- **V2 Phase 2 additive `answers[].assets` 已落地**：`{ images, links, references, codeBlocks, videos }` 由 `src/asset-extractor.js` 从 `content` 确定性派生（Spec §18），`content` 原样保留；脚注 Markdown identifier 一律 renderer 生成 `a<answerId>-r<index>`（1-based 出现顺序，文档内全局唯一），`data-numero` 只作 `sourceNumero` metadata、绝不进 identifier；answerId 缺失/非法时脚注 fail closed 为可见文本（防跨 answer ID 冲突）；仅 `sup`（非 `sub`）视为脚注元素，与 asset-extractor 判定一致（Spec §14.1 白名单）。
- **PHASE2_1PX_PLACEHOLDER_CONTRACT（已批准；SPEC_CONFLICT_1PX_PLACEHOLDER 已关闭）**：`data:` / `blob:` 一律为 placeholder；HTTP(S) 图片仅当原始 `<img>` 显式提供 `width == 1` 且 `height == 1` 时确定性视为 1×1 placeholder；无显式尺寸证据（缺失/非法/非 1×1）不得猜测；禁止 URL 文件名/token/query/host/CSS class/alt 等启发式；禁止网络请求探测 intrinsic dimensions；placeholder candidate 被跳过后继续 `data-original → data-actualsrc → 合法 https src` 的 lower-priority fallback（1px 尺寸证据只消费一次：首个被判 1px placeholder 的 candidate 跳过后，后续 lower-priority candidate 不再因同一证据被判 1px，它们是真实 swap-in 图片）。Spec §10.1 已补充该最小 clarification（用户批准的 SPEC_CONFLICT 关闭手段，DOCUMENT review 覆盖）。

## 路线图（下一阶段，未经批准不得开始）

- **V2 Phase 2 — Rich Content Assets 已纳入 accepted project baseline**：additive `answers[].assets`（images / links / references / codeBlocks / videos）、canonical `content` 不可变、脚注重建（renderer 生成 `a<answerId>-r<index>`）、1px placeholder 确定性合同（Spec §10.1）均为长期合同，保持不变（见上文已批准决策与 Spec）。
- **V2 Phase 3 — Question Metadata**（description / topics，Approved Spec §17）是下一个计划实现的阶段；**未经新的 authorized phase task / gate 批准，不得开始**。
- 开始前：从**届时最新的 remote master** 创建（或重建）其 feature 分支；不依赖任何历史临时分支 ref 作为长期事实。
- **browser-smoke caveat（长期）**：`browser-smoke` 存在已知的 pre-existing false-negative baseline（部分渲染形态的内容匹配）；其绝对结果 FAIL 不得改标为 PASS；Phase 2 是在已明确批准的 no-regression baseline exception 下被接受的；browser-smoke 工具本身的改进是独立 follow-up defect，不属于任何已接受 Phase 的交付范围。

## 历史 review 结论（沉淀）

- DOCUMENT gate（V2 Spec）：PASS（2026-08-09，Spec APPROVED）。
- CODE gate（Phase 1）：PASS @ `27e68c1`（P0/P1/P2 全 0，四轮 review：escape 完整性、framing 收口、lockfile registry、localhost namespace、cross-node 与 split-whitespace 绕过修复）。
- **CODE gate（Phase 2 — Rich Content Assets）**：PASS（2026-08-09），已纳入 accepted project baseline。
- 建议：停止无限制地静态加 gate，进入真实使用验证与按 Phase 推进。

## Maintenance Contract

- 本文件是 **Git tracked durable project memory**；GitHub master 是最终权威版本。
- `.workbuddy/memory/` 是 **non-authoritative runtime memory**（自动产生、ignored、可含临时上下文），只作参考输入，不覆盖本文件及任何 repo-tracked authority。
- **任务开始必须读取本文件**；缺失时 STOP 并报告 `PROJECT_MEMORY_MISSING`。
- **memory decision 分两类，按任务角色执行**：
  - **PRE-GATE TASK**（实现 / 文档 / 修复 / research / smoke）：结束前必须判断 `PROJECT_MEMORY_UPDATE_REQUIRED: YES | NO`。YES 时随**当前 task branch** 更新本文件并进入同一次 independent review；NO 时不得修改本文件（工作树保持 clean）。
  - **INDEPENDENT REVIEWER**：必须判断 `POST_GATE_MEMORY_UPDATE_REQUIRED: YES | NO`。YES 时 reviewer **不修改被审 branch**；被审 branch 按 reviewed HEAD 正常 merge 后，依 `AGENTS.md` §3.5 创建独立 `docs/memory` follow-up branch 更新本文件，单独通过 independent review 后才能 merge；NO 时不产生 post-gate memory follow-up。
- **pre-gate durable knowledge 随产生它的 task branch 一起 review**；**gate-generated durable knowledge**（如 final gate conclusion、accepted checkpoint）如需沉淀，走独立 post-gate memory follow-up（reviewer 只报告 `POST_GATE_MEMORY_UPDATE_REQUIRED`，不修改被审 branch）。
- **Git history 足以保存的纯 SHA / merge 状态无需机械复制进本文件**；不要为了把 gate PASS 写进来而制造 review loop。
- 只有 **durable + verified + project-level + non-sensitive** 的信息才进入本文件。
- 禁止写入：current HEAD / current master SHA（除非作为 historical approved checkpoint）/ 临时 branch 存在性 / workspace path / 本机用户名 / backup path / credentials / private runtime state / 临时 task progress / scratch reasoning / 未经确认的猜测。
- 本文件不是 changelog：不记录 commit history / daily log / task log / review transcript；信息失效时更新为新的长期事实或标注 historical checkpoint，不向尾部无限堆日志。
- 所有 project-memory 更新都必须被 **independent review** 覆盖：pre-gate update 随原 task branch review；post-gate update 随独立 `docs/memory` follow-up branch review。不得声称 post-gate update 必须留在产生 gate 结论的原 task branch。通过 review 后才进入 GitHub master。
