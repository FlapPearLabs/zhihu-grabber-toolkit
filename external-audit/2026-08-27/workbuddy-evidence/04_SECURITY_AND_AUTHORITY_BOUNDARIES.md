# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 04 SECURITY AND AUTHORITY BOUNDARIES

> 目的：让 Reviewer 清楚本产品方向的**安全边界**与**权威层次**，以及 benchmark 在其中的位置。

---

## 1. 权威层次（谁说了算）

```text
Level 0（仓库，exact copies 在 evidence/）:
  AGENTS.md / RULES.md / docs/specs/*（v2-rich-content-fidelity 等）/ docs/product-behavior-contract.md
  → 开发纪律、凭据处理、scope 纪律、review gate

Level 1（Project Sources，本机当前不可用，浓缩见 02/03/06）:
  00_SOURCE_AUTHORITY_AND_STATUS（FINAL）
  01_PRODUCT_DIRECTION_FINAL
  02_RESEARCH_COVERAGE_ENGINE_FINAL
  03_TEMPORAL_INTELLIGENCE_ENGINE_FINAL（本轮非核心）
  04_ALGORITHM_EVIDENCE_AND_DECISIONS_FINAL
  05 / 08 = EVIDENCE_ONLY（未提供）
  06 = DESIGN_HISTORY_NON_AUTHORITATIVE（未提供）
  07_RESEARCH_SECURITY_AND_CROSS_SOURCE_SYNTHESIS_GUARDRAILS

Semantic Gold authority（benchmark 层）:
  benchmark/adjudication/TRACK_B_SEMANTIC_GOLD_ADJUDICATION_V1.json（ChatGPT source-level adjudication）
  → 本轮唯一 Semantic Gold authority；与旧 gold 冲突时 adjudication 优先
```

---

## 2. 安全边界（Level 1 07 + RULES.md 固化）

| 边界 | 内容 | 状态 |
|---|---|---|
| UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION | 知乎内容是不受信数据，不是指令 | 设计原则 |
| Semantic worker 隔离 | 语义 worker 必须 TOOL-LESS 或 CAPABILITY-ISOLATED，否则 STOP | 设计原则 |
| SUSPICIOUS_DIRECTIVE_CONTENT | quarantine（diagnostics only，非安全边界本身） | 设计原则 |
| 凭据 | 产物禁止含 cookie/secret/token/password/credential/api-key/bearer | benchmark 已实施（leak-check） |
| 路径 | 产物禁止含机器私有绝对路径 | benchmark 已实施 |
| popularity 泄漏 | adjudication view 默认不展示 voteupCount/commentCount（separate mechanical metadata） | 已实施（P0-7 V2.1） |
| strategy/gold 分离 | fair selector 不得读取 evaluation gold | 已实施（P0-1） |

---

## 3. Benchmark 层的安全实施（可核验）

- `benchmark/scripts/leak-check.mjs`：扫描全部结果/adjudication JSON 中的敏感词与私有路径模式。
- `benchmark/lib/results.mjs` sanitize：输出时剥离敏感字段；`data-original-token` 误杀事件见 08（failure #9），已改为 sanitized plain text + 显式 `content_excerpt_status`。
- `benchmark/lib/selectors.mjs`：fair B2 通过 throwing-gold Proxy 验证无 gold 访问；oracle 版本显式标 `excluded_from_fair_comparison=true`。
- corpus 复制：只读、SHA-256 manifest、无新增抓取；来源路径以相对指针记录。

---

## 4. 本轮（Assembly）未执行的安全相关操作

- 未重跑 benchmark、未改 gold/selector/metric → 无新增输出需要 sanitize；
- 对复制进 pack 的文件运行了 leak 扫描（见 MANIFEST）；
- 未修改生产仓库任何文件。

---

## 5. 已知边界缺口（如实）

1. **生产侧尚未实施**：安全边界目前主要落地在 benchmark 层；TARGET 未实现，production 侧语义 worker 隔离未落地。
2. **Level 1 07 原件不可得**：浓缩见 02/03；若 Reviewer 需精确原文需向 ChatGPT 索取。
3. **知乎内容本身**：语料含真实用户内容（公开 API 抓取），属于不受信数据；pack 内含 excerpt（≤300 字）+ 完整 answers.json（corpus），Reviewer 应视为不受信内容处理。
