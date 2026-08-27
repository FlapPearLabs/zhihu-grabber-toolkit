# ZHCLIPRO_EXTERNAL_AUDIT_PACK — 00 READ ME FIRST

> 本包由执行 Agent 组装（2026-08-27），供**独立外部 Reviewer（Claude）** 审查。
> 组装者不做方向性判断；所有事实均附来源；所有已知失败均显式列出。
> 外部 Reviewer 有权得出包括 `RETHINK_DIRECTION` 在内的任何结论。

---

## 1. 一句话定位

这是一个**知乎研究覆盖（Research Coverage）产品方向**的 Benchmark Pilot 证据包。
产品尚未实现 TARGET（Research Coverage Engine）；当前只有：
- 一个隔离的 benchmark harness（`benchmark/`，可运行、有测试、有 335 个 run 结果）；
- 一份 ChatGPT 独立 adjudicated 的 Semantic Gold（`benchmark/adjudication/`）；
- 一组被多次修正、当前为 `D2_CORRECTED` 的 pilot 结果。

**没有 TARGET 实现。没有 real embedding。没有 Architecture Spec。没有产品版本。没有生产代码变更。**

---

## 2. 当前状态总览（组装时点）

```text
TRACK_A_DISCOVERY              = PASS
TRACK_B_BENCHMARK_DESIGN       = PASS
TRACK_B_PILOT_HARNESS          = PASS
SEMANTIC_GOLD                  = ADJUDICATED（ChatGPT source-level，135 case_labels）
D2_CORRECTED_RERUN             = PASS_AS_PARTIAL_EVIDENCE

TARGET                         = NOT_IMPLEMENTED
REAL_EMBEDDING                 = NOT_IMPLEMENTED
B1/B2 当前形态                 = LEXICAL_NGRAM_PROXY（非 real semantic embedding）
SPEC_PREPARATION_GATE          = NOT_READY
IMPLEMENTATION_AUTHORIZATION   = NONE
VERSION_ASSIGNMENT             = UNASSIGNED
```

核心事实（全部有数据支持，见 10_CORRECTED_D2_RESULTS.md）：

1. **B0/B1/B2 可被指标区分**（合成 dominance case 最锐利：diversity 0 / 0 / 0.96，expert 0 / 0 / 0.6）。
2. **真实 case 上 B2 优于 B1 未证实**（must_see 相等或更差，compute ops 2–35×）。
3. **B1/B2 是 ngram proxy，不是 semantic embedding** → 全部结果只能视为 `HARNESS_SANITY_ONLY`。
4. **合成证据 ≠ 生产证明**（合成 case 由 fixture 生成器构造，gold 是 FIXTURE_MECHANICAL）。
5. 该方向经历过多轮独立评审的 CHANGES_REQUESTED 与失败修正（详见 08），**全部记录在案**。

---

## 3. 目录地图

```text
ZHCLIPRO_EXTERNAL_AUDIT_PACK/
├── 00_READ_ME_FIRST.md                    ← 本文件
├── 01_ORIGINAL_PROBLEM_AND_USER_INTENT.md ← 原始问题与用户意图
├── 02_CURRENT_PRODUCT_DIRECTION.md        ← 当前产品方向（RCE 目标）
├── 03_CURRENT_RCE_DESIGN.md               ← 当前 RCE 设计（V1 pipeline 七机制）
├── 04_SECURITY_AND_AUTHORITY_BOUNDARIES.md← 安全与权威边界
├── 05_DESIGN_EVOLUTION.md                 ← 中立决策历史表（12 行）
├── 06_DISCOVERY_AND_PROVIDER_EVIDENCE.md  ← Track A 发现与 provider 证据
├── 07_BENCHMARK_DESIGN.md                 ← Track B benchmark 设计
├── 08_PILOT_FAILURE_AND_CORRECTION_HISTORY.md ← 11 项失败 + 修正 + 回归守卫
├── 09_SEMANTIC_GOLD_ADJUDICATION.md       ← ChatGPT 语义 Gold 裁定过程与结果
├── 10_CORRECTED_D2_RESULTS.md             ← 当前最终 pilot 结果（中立呈现）
├── 11_OPEN_QUESTIONS.md                   ← 开放问题（含 critical-aspect-chain 专项）
├── evidence/                              ← 权威文档与治理文件
│   ├── AGENTS.md / RULES.md / README*     ← Level 0 仓库治理（exact copies）
│   ├── repo-docs/                         ← 仓库 docs/（specs、project-memory 等）
│   └── LEVEL1_AUTHORITY_DOCS_STATUS.md    ← Level 1 文档存在性如实声明（见 §5）
├── benchmark/
│   ├── README.md                          ← benchmark 使用说明
│   ├── packets/                           ← 6 份 TRACK_B review packet（含全部失败与修正）
│   ├── adjudication/                      ← V2/V2.1/V2.2 提案 packet + ChatGPT 裁定 JSON（唯一 Gold authority）
│   ├── results/
│   │   ├── summary.json                   ← corrected D2 汇总（CURRENT_FINAL_PILOT_RESULT）
│   │   ├── runs-corrected-d2/ (96)        ← 当前有效 fair+oracle runs
│   │   ├── runs-d1/ (143)                 ← D1 runs（SUPERSEDED）
│   │   └── runs-d2-invalid/ (96)          ← 首个 D2 runs（INVALIDATED，见 §4）
│   └── harness/                           ← 完整 benchmark 源码（lib/scripts/tests/fixtures/cases/corpus）
└── selected_conversation_excerpts/        ← 关键决策原话摘录（带 date/context/why）
```

---

## 4. 失效产物标注（Reviewer 必读）

| 产物 | 状态 | 说明 |
|---|---|---|
| `results/runs-d2-invalid/`（96） | **INVALIDATED** | `INVALIDATED_BY = ASPECT_NAMESPACE_RECONCILIATION_BUG`（build-d2-gold 首版用旧 D1 aspect_id 查 schema，3 case 的 KEEP aspect 被误 drop；cross aspect_recall 0.750=3/4 违反 1/6 倍数）。仅作失败记录保留。 |
| `results/runs-d1/`（143） | **SUPERSEDED** | D1 gold 为 agent PROVISIONAL 提案（含 evaluation leakage 修复前/后版本）；D2 建立后不再参与比较。 |
| `results/runs-corrected-d2/`（96） | **CURRENT_FINAL_PILOT_RESULT** | 唯一有效的 D1/D2 对比基准。 |
| `packets/TRACK_B_D2_RERUN_REVIEW_PACKET_FOR_CHATGPT.md` | **INVALIDATED（其 aspect 相关结论）** | 基于被 bug 污染的 OLD_D2；aspect_recall 数字无效。 |

---

## 5. Level 1 权威文档状态（如实声明）

任务书要求附带 00/01/02/03/04/07（authoritative）+ 05/08（EVIDENCE_ONLY）+ 06（DESIGN_HISTORY_NON_AUTHORITATIVE）。

**本机当前不存在这些文件的副本。** 历史事实：
- 2026-08-26 曾完整读取 00/01/02/03/04/07（见 `evidence/LEVEL1_AUTHORITY_DOCS_STATUS.md` 与 workspace memory），内容浓缩于 `evidence/repo-docs` 侧的记忆日志与 02/03/06 文档中；
- 05/08 从未提供（EVIDENCE_ONLY 缺失）；
- 06 从未提供（DESIGN_HISTORY_NON_AUTHORITATIVE 缺失）。

**本包不伪造 exact copies。** 相关内容的可用替代：
- Level 1 关键冻结要求 → 02/03/04 文档（基于读取记录浓缩）；
- Track A 发现 → 06 文档 + 记忆日志 2026-08-26（`evidence/repo-docs/` 未含 memory，摘要见 06）；
- 若 Reviewer 需要 Level 1 原件，需向 ChatGPT 会话索取（与 adjudication 文件同理，位于 ChatGPT 沙箱）。

---

## 6. 建议阅读顺序

1. `01` → 原始问题（为什么有这个产品方向）。
2. `05` → 12 行决策历史（快速看清方向如何演变、每次为什么变）。
3. `08` → 11 项失败历史（评估证据可信度）。
4. `09` → Semantic Gold 如何 adjudicated（评估 Gold 质量）。
5. `10` → 当前结果（中立呈现 + 所有 caveat）。
6. `11` → 开放问题（含必须回答的 critical-aspect-chain 问题）。
7. 需要细节时再进 `benchmark/` 原始数据与 `evidence/`。

---

## 7. 组装者声明

- 组装者（执行 Agent）本轮**未**做出 PROCEED / SIMPLIFY / RETHINK 结论。
- 唯一声明的状态：`EXTERNAL_AUDIT_PACK_STATUS = READY_FOR_EXTERNAL_REVIEW`。
- 所有数字来自 `benchmark/results/*.json` 与 `benchmark/adjudication/*.json`，未重跑 benchmark、未改 gold/selector/metric。
- 生产仓库 `zhihu-grabber-toolkit` 未被触碰（原 worktree 44 文件缺失异常状态保持不变；pilot 全程在隔离工作区 `zhihu-grabber-toolkit-benchmark-pilot/`）。
