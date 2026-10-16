# P1-T13 Semantic Contract Validation: Evidence-Rich Candidate Qualification

```text
DOCUMENT TYPE         : SEMANTIC CONTRACT FIXTURE & TARGETED COUNTEREXAMPLE RECORD
TARGET MODULE         : research-orchestration/lib/deepseek-research-runtime.mjs
CONTRACT FIELD        : expertEvidenceRichTokens
WORKTREE_BASE_HEAD    : a6fd4bd66e9d1c4b073d3fb13e82c8885fe37eea
CURRENT_HEAD          : a6fd4bd66e9d1c4b073d3fb13e82c8885fe37eea
T13_CONTRACT_BASE_SHA : 9444a33b3ca24a53f8da4b9e2cb03a241925f47f (Historic T13 Seam Baseline)
AUTHORITY             : Spec §8.1, §10.1 (SEAM C V1)
```

---

## 1. 契约修正背景与语义边界定性（Semantic Contract Boundary）

在知乎 P1 观点抽取运行时（`CLAIMS_SYSTEM_PROMPT`）中，`expertEvidenceRichTokens` 字段原先仅有输出 JSON schema 结构定义，缺乏对模型收录标准的文本约束。

初版补齐规则存在以下 **5 处重大语义与权限瑕疵**，本次修正逐一予以拨乱反正：

1. **纠正证据信号维度的偷换与缩窄（No Semantic Narrowing）**：
   * 原冻结设计中，Evidence signals 包含：公式推导、统计图表、定量数据、一手实验/基准、权威引用、代码等全族谱；
   * 修正前版本错误地将其缩窄为“仅限代码、论文、官方文档”，排除了支撑论点的公式推导与图表数据；
   * 新版本全面恢复对**公式推导、定量数据、图表、论文、可复核代码**的同等认定。
2. **剥夺大模型无法证明的“原创性”判定权（No Originality Provenance Claim）**：
   * 模型在纯上下文语料中无法证实一段代码是否由答主“原创”（原创性属于外部知识产权与防伪 Provenance 权限）；
   * 将“原创代码实现”修正为模型可实质观察的“**与主要观点直接相关、可定位的代码实现，以及其运行/实验/性能结果**”。
3. **彻底终结“存在引用 = 证据丰富”的投机漏洞（Direct Substantive Support）**：
   * 严厉禁止仅凭文末挂 arXiv 链接、贴无关官方文档或贴 `Hello World` 代码块即获收录；
   * 明确规定：**证据必须与回答的核心观点（Primary Claims）存在直接、实质性的支撑关系**；仅出现链接、代码块、机构名或“本人实测”字样不足以收录。
4. **消除字段命名对专家身份与外部已验证状态的暗示（Candidate Demarcation）**：
   * 明确界定：`expertEvidenceRichTokens` 在本运行时契约中**仅代表“证据丰富候选”（Evidence-rich candidate）**，绝不代表作者专家身份（Expert Identity），也不代表证据已通过外部真实性验证（Verified Evidence）。
5. **明确区分回归测试安全与语义正确性验证（Test Boundary Discipline）**：
   * 现有全量单元测试通过仅能证明本次 Prompt 文本修改未破坏已有单元测试与状态机契约（`Regression Safety = PASS`）；
   * 真正的语义判定准则（Semantic Criterion Precision/Recall）必须由下述针对性对抗反例集进行明确刻画。

---

## 2. 核心 Prompt 规则对比（Before vs After）

### ❌ 修正前初版（存在语义缩窄与权限越界）：
```javascript
'5. expertEvidenceRichTokens 只收录包含以下任一客观证据的回答：原创代码实现或性能基准测试、学术论文引用或数据集实测结果、一手行业数据或官方文档引用。不含上述证据的回答禁止列入该数组。'
```

### ✅ 终审修正版（语义精确、权力边界守正）：
```javascript
'5. expertEvidenceRichTokens 只标记“证据丰富候选”，不代表作者专家身份，也不代表证据已被外部验证。仅当回答正文中存在与主要观点直接相关、可定位的实质证据时收录，例如：可复核的代码实现及运行/实验/性能结果；与论点直接相关的论文、数据集或官方文档引用；带明确来源、样本/方法或可核查数值的定量/一手数据；直接支持论点的图表或公式。仅出现代码块、链接、论文名、机构名、数字或“本人实测”等字样不足以收录；无法确认则不收录。'
```

---

## 3. 最小针对性对抗与代表性用例集（8 Counterexample Cases）

对应机读测试夹具：`research-orchestration/test/fixtures/claims-evidence-counterexamples.json`

> **审计声明**：本用例表用于定义合同规范预期行为。当前未实际调用线上 DeepSeek-V4-Pro 进行实测分类，`LIVE_MODEL_OBSERVATION` 状态标注为 `NOT_RUN`，不将人工定义的契约预期冒充为真实模型执行证据。

| 编号 | 用例名称 | 核心输入特征 | 核心主张 (Primary Claim) | EXPECTED_CONTRACT_BEHAVIOR | LIVE_MODEL_OBSERVATION | STATUS | 判定理论依据 |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| **A** | 文末随便贴 arXiv 链接 | 正文全是泛泛空话，文末挂独立链接 `https://arxiv.org/abs/2301.12345` | AI 将重塑软件工程范式 | **EXCLUDE (NOT evidence-rich)** | **NOT_RUN** | **CONTRACT_FIXTURE_DEFINED** | 仅有表面链接存在，正文无实质性引证支撑逻辑。 |
| **B** | Hello World / 无关代码块 | 探讨语言优劣时贴 `print("Hello, World!")` 玩具代码 | Python 比其他语言更简洁优雅适合入门 | **EXCLUDE (NOT evidence-rich)** | **NOT_RUN** | **CONTRACT_FIXTURE_DEFINED** | 玩具打印语句，无实质可复核实现或实验度量。 |
| **C** | “本人实测”，无方法和数据 | 口头宣称“本人实测开发效率翻倍，效果极好” | AI 编程工具能成倍提升团队效能 | **EXCLUDE (NOT evidence-rich)** | **NOT_RUN** | **CONTRACT_FIXTURE_DEFINED** | 纯主观经验断言，无样本量、对照组与可核查数值。 |
| **D** | 官方文档链接，但与主要观点无关 | 论述微服务网络延迟过高，附带 React `useState` 官方文档链接 | 微服务架构会导致分布式网络延迟失控 | **EXCLUDE (NOT evidence-rich)** | **NOT_RUN** | **CONTRACT_FIXTURE_DEFINED** | 虽为权威官方文档，但与被支持观点毫无逻辑关联。 |
| **E** | Benchmark + 方法 + 数值结果 | 1000万行 TPC-H 单表聚合对比，DuckDB 118ms vs SQLite 1420ms | DuckDB 在单表聚合分析上优于 SQLite | **INCLUDE (Evidence-rich candidate)** | **NOT_RUN** | **CONTRACT_FIXTURE_DEFINED** | 具备完整测试环境、样本、对照基准与确定数值。 |
| **F** | 论文引用，并明确用于支持观点 | 引用 DeepSeek-V3 技术报告 Table 2 低秩压缩对 MLA KV Cache 显存节约数据 | MLA 架构显著降低长文本推理显存开销 | **INCLUDE (Evidence-rich candidate)** | **NOT_RUN** | **CONTRACT_FIXTURE_DEFINED** | 明确引用章节、表号与具体参数比值，强支撑机制。 |
| **G** | 一手行业数据（带来源/样本/数值） | 3,400台计算节点在线微服务集群，动态调度使利用率从 14% 升至 38% | 细粒度调度可大幅提升集群利用率 | **INCLUDE (Evidence-rich candidate)** | **NOT_RUN** | **CONTRACT_FIXTURE_DEFINED** | 包含真实生产环境样本规模、前后对比数据与稳定性指标。 |
| **H** | 直接支撑结论的图表或公式推导 | 代入阿姆达尔定律推导串行比例 20% 时理论最大加速比不超过 5 倍 | 系统加速比受限于串行瓶颈存在硬天花板 | **INCLUDE (Evidence-rich candidate)** | **NOT_RUN** | **CONTRACT_FIXTURE_DEFINED** | 严密的数学公式推导，决定性支撑核心结论。 |

---

## 4. 语义评测边界与局限性声明（Semantic Limitations）

### 4.1 现阶段已证明事实（PROVEN）：
1. **Prompt contract frozen**：`CLAIMS_SYSTEM_PROMPT` 规则 5 文本契约已冻结，不越权声称原创或专家身份，且覆盖完整证据族谱；
2. **Fixture expectations defined**：8 类针对性反例集（Cases A ~ H）的合同行为预期已通过夹具与文档清晰定义；
3. **Static contract test PASS**：静态契约测试（`p1-claims-prompt-contract.test.mjs`）验证了 Rule 5 的语义不变量与夹具数据结构完整性；
4. **Regression safety PASS**：全套已有单元与回归测试（840 项测试，831 pass, 0 fail, 9 skipped）全绿，证明对既有状态机与 SEAM 契约零破坏。

### 4.2 现阶段尚未证明事项（UNPROVEN & NOT CLAIMED）：
1. **DeepSeek-V4-Pro semantic classification = 8/8**：本反例集**尚未在线实际调用真实 DeepSeek-V4-Pro 执行分类**；不得将人工定义的契约预期冒充为真实模型执行结果；
2. **Semantic precision / recall**：在海量真实知乎复杂语料上的实际语义查准率与查全率仍需后续离线金标语料集进行量化评测，不可仅凭静态测试断言语义准确度已达 100%。
