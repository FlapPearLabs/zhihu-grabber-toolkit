# P1 Seam Contracts V1 — T09→T12→T13→T14→T15 Observable Module Contracts

```text
DOCUMENT_ID = P1_SEAM_CONTRACTS_V1
STATUS = NON_AUTHORITATIVE_CANDIDATE
AUTHORITY_CLASS = PLANNING / GOVERNANCE CANDIDATE（待 ChatGPT external audit PASS + ff-only
                  integration 后生效；生效前不授权任何实现消费其字段为 product authority）
BASE_SHA = 0287ba3ef33c29357c7f8306f9e51dcca2b41da0
BRANCH = planning/p1-contract-driven-parallel-workflow
REVISION = R1（2026-09-05，PREVIOUS_SHA = 9cbe5121d1c13b2d1cb70690f9df8d7494483f7c）
           F1  SEAM A 重建为 producer-grounded 最小可观察合同（真实 reviewed T09 @ 4789382）
           F3  SEAM D diagnostics 重接地 T14/T07 所有权（novelty_gain 移除、claim_source_diversity 补回）
           F5  SEAM B/C/D 最小合同审计（移除 owner 标注 / derivedFrom / 嵌入 categoryEnum）
           F4  新增 TYPE_B 真实 producer conformance test（REAL_T09_TO_SEAM_A_CONFORMANCE = PASS）
COMPANION = docs/planning/P1_PARALLEL_EXECUTION_CONTRACT_V1.md（READY gate + 执行模型 + 测试 taxonomy）
FIXTURES = research-orchestration/test/fixtures/p1-seams/
VALIDATOR = research-orchestration/test/helpers/p1-seam-contracts.mjs
CONTRACT_TESTS = research-orchestration/test/p1-seam-contracts.test.mjs（TYPE_A）
                 research-orchestration/test/p1-seam-a-producer-conformance.test.mjs（TYPE_B，SEAM A）
SPEC_AUTHORITY = docs/specs/p1-cross-question-deep-research.md（语义唯一权威）
Date: 2026-09-05
```

## 0. 本文件是什么、不是什么

本文件把 **Spec 已冻结的语义**转录为模块间**可观察 seam 合同**，使下游 ticket 能在上游实现
merge 之前对着冻结合同 + golden fixtures 做隔离实现（Matt Pocock to-spec 的 pre-agreed
seams 层；见 key-decisions.md D11）。

- **不发明任何新语义**：每个语义字段都标注 Spec / Issue 出处。
- **不冻结私有实现**：函数名、文件名、内部状态机、私有 schema 不是合同。
- **不是第二 Spec**：与 Spec 冲突时 Spec 胜出 → `STOP: CONTRACT_CONFLICT`。
- **不改变 Ticket DAG**：DAG 边仍是真实集成顺序权威（见 companion doc §C）。

### PUBLIC / OBSERVABLE CONTRACT vs PRIVATE IMPLEMENTATION DETAIL

```text
PUBLIC（本文件冻结）:
  seam 元数据 / 可观察产物 shape（canonical fixture encoding）/ identity fields /
  invariants / valid-fail 语义 / ownership / canonical content 位置 / 版本规则

PRIVATE（不冻结）:
  私有函数与模块名、内部文件布局、状态机实现、持久化细节、
  producer 内部 richer schema（只要能投影到 canonical encoding）
```

### Canonical encoding 与 producer persisted schema 的关系

Producer 可以持久化自己的 richer artifact，但必须**能确定性投影**到本合同的 canonical
encoding（直接输出或显式 mapper）。producer persisted schema 演进时：只增可选字段 → V1 兼容；
删除/改名/语义变化 → seam major bump + fixture/validator 更新 + 下游消费面 re-review。

### SEAM_NOT_FROZEN procedure

任何一方发现合同要求一个**无 approved authority 依据**的字段/语义：
`STOP: CONTRACT_GAP`（AGENTS.md §18.3），报告：

```text
SEAM_NOT_FROZEN = <SEAM_ID>
BLOCKING_DECISION_REQUIRED = <exact missing decision + authority pointer>
```

该 seam 的并行化授权随之暂停；不得以 fixture 先行倒逼产品语义。

---

## SEAM A — T09 → T12（R1：producer-grounded 最小可观察合同）

> **R1 REPAIR（F1/F4）**：本 seam 由理想化接口重建为**真实 reviewed T09 producer** 实际暴露的
> 输出形状（REVIEWED_CODE_SHA = `4789382f36d179dc13957f2c23748f169875d7a2`，PR #68，未 merge）。
> seam 适配真实 producer，不要求 producer 适配 seam；identity 投影（无字段改写）。被移除的
> 发明字段见本节末尾「F1 审计」表。

```text
SEAM_ID = T09_TO_T12
VERSION = 1
PRODUCER = P1-T09 Multi-group Execution（Issue #41；reviewed @ 4789382，PR #68）
CONSUMER = P1-T12 RCE Corpus Selector（Issue #44）
INPUT  = T08 selection decision + per-group capture/verify/handoff 产物
OUTPUT = ResearchCorpusManifest（producer 真实派生产物）
PROJECTION = IDENTITY——真实输出即 canonical view，无字段改写；producer 内部可持久化
             richer state，manifest 本身就是其确定性派生面（I7）
```

### OUTPUT_OBSERVABLE_SHAPE（= 真实 deriveResearchCorpusManifest 输出，逐字段）

```jsonc
{
  "schemaVersion": 1,                                   // producer manifest schema（非 seam 信封）
  "type": "research-corpus-manifest",                   // seam binding = producer 真实 type
  "planHash": "<64hex>",                                // Spec §4.3
  "selectionIdentity": "<64hex>",                       // selected groupIds 集合身份（I10）
  "selectionDecisionHash": "<64hex>",                   // selection 决策内容身份（I10）
  "groups": [                                           // == VerifiedGroupRefs（valid-only，I1/I2）
    {
      "groupId": "<T08 权威格式>",                       // 当前 T08 实现 = questionId；合同不冻结前缀
      "questionId": "<canonical questionId>",
      "answersRel": "<work-relative 引用>",              // 不含内容；exact 文件布局属 PRIVATE（§0）
      "handoffRel": "<work-relative 引用>",
      "answersHash": "<64hex>",                         // dependent artifact hash（§6.1；裸 hex）
      "handoffHash": "<64hex>",
      "capturedAnswerCount": <n|null>,
      "reportedAnswerCount": <n|null>,
      "paginationStatus": "complete|partial|unknown"
    }
  ],
  "accounting": {                                       // §9.2 组级计量（captured != verified 可见）
    "selectedGroupCount": <n>,
    "verifiedGroupCount": <n>,
    "capturedNotVerifiedGroupCount": <n>,
    "failedGroupCount": <n>
  },
  "manifestHash": "<64hex>"                             // sha256(canonicalJson(manifest))，自校验
}
```

### IDENTITY_FIELDS

`planHash`、`selectionIdentity`、`selectionDecisionHash`（selection 决策身份，漂移按 I10 从
相应边界失效）；每 group 的 `answersHash` + `handoffHash`（dependent artifact hashes，I4/I5）；
`manifestHash` = 对除自身外全部字段的 canonical JSON 取 sha256——**自校验字段**：validator
按同一算法重算比对，任何被 hash 覆盖字段的篡改/漂移/混入都机械可检
（`SEAM_A_MANIFEST_HASH_MISMATCH`）。真实 producer 的 hash 域为裸 64 位 hex（无 `sha256:` 前缀）。

### REQUIRED_INVARIANTS

1. 只有 captured && verified && handoffValid 且带完整 artifact 身份的组可进入 `groups[]`
   （I1/I2、§6.1）；captured-not-verified / failed 组只出现在 `accounting`，永不进入 `groups[]`。
2. manifest 只从 valid refs + selection 确定性派生，可字节级复现（§6.1）。
3. manifest 不是第二 canonical store（§6.1、key-decisions D09）。
4. planHash / selectionIdentity / selectionDecisionHash 变更 → 从匹配边界失效（I10、§6.2）。
5. credentials / secret-bearing 内容永不进入 manifest（§6.2）。
6. partial 不得渲染为 complete（§6.2）。

### VALID_SUCCESS

`manifestHash` 重算一致；accounting 与 `groups[]` 机械自洽（`verifiedGroupCount == groups.length`
且 ≤ `selectedGroupCount`）；全部 ref 为 work-relative、内容无关引用；无 canonical 内容体。

### FAIL_CLOSED

| 条件 | 错误码 |
|---|---|
| type / schemaVersion 不符 | `SEAM_A_TYPE` / `SEAM_A_SCHEMA_VERSION` |
| planHash 缺失或格式错 | `SEAM_A_PLAN_HASH` |
| selection 身份字段缺失或格式错 | `SEAM_A_SELECTION_IDENTITY` |
| group 条目 identity 缺失 | `SEAM_A_GROUP_IDENTITY` |
| ref 非 work-relative / 含路径逃逸 | `SEAM_A_ARTIFACT_REF` |
| artifact hash 非 64hex | `SEAM_A_CONTENT_HASH` |
| 计数非 null 且非非负整数 | `SEAM_A_COUNT_INVALID` |
| paginationStatus 越界 | `SEAM_A_PAGINATION_STATUS` |
| accounting 缺失 / 字段不齐 | `SEAM_A_ACCOUNTING_INVALID` |
| accounting 与 groups[] 不自洽 | `SEAM_A_ACCOUNTING_INCONSISTENT` |
| manifestHash 缺失 / 重算不一致（篡改、stale、captured 组混入） | `SEAM_A_MANIFEST_HASH` / `SEAM_A_MANIFEST_HASH_MISMATCH` |
| groups 为空（零 verified 组不可作为可消费 artifact） | `SEAM_A_REFS_REQUIRED` |
| manifest 内出现 canonical 内容体 | `SEAM_A_CANONICAL_CONTENT_FORBIDDEN` |

### OWNERSHIP

producer = T09；verified 状态权威 = verify-output / handoff authority（不变，§2.2）；
T12 只消费。

### CANONICAL_CONTENT_LOCATION

各组 `answers.json`（+ per-group `handoff.json` 作为 handoff 权威产物）。manifest 只持
refs + hashes + accounting。

### FORBIDDEN_DUPLICATION

回答正文、渲染 markdown、projection 文本、credential 内容；verify 判定镜像 / 验证证据指针 /
派生元数据也不得复制进 manifest（valid-only 语义由 I1/I2 与 producer 保证）。

### SECURITY_BOUNDARY

manifest 属 execution artifact：内容引用指向 UNTRUSTED_CORPUS，但 manifest 本身进入
semantic worker 时仍受 §10.1 投影隔离约束；无 machine-private path（RULES §11）。

### BACKWARD_COMPATIBILITY / VERSIONING_RULE

producer manifest schemaVersion 1 ↔ SEAM A V1。真实输出**新增字段**（其 manifestHash 天然
覆盖新字段）→ validator 重算规则天然兼容 = V1 兼容；删字段 / 改名 / 语义变化 / canonical 化
算法变化 → seam major bump + fixture/validator 同步 + 下游消费面 re-review。禁止 post-review
静默改 fixture 语义。

### F1 审计：移除的发明字段（相对 R0 seam）

| R0 字段 | 处置 | 理由（authority / 消费需求核查） |
|---|---|---|
| `verifiedArtifactRef` / `contentHash` | 更名为真实字段 `answersRel`+`handoffRel` / `answersHash`+`handoffHash` | 对齐真实 producer 字段名 |
| `verifyResultRef` | 移除 | 真实 VerifiedGroupRefs 不暴露；valid-only 由 I1/I2 保证；运行时产物无需复制验证证据指针 |
| `verifyAuthority` | 移除 | 静态权威（verify-output）复制进运行时产物（F5 模式）；由本合同 OWNERSHIP 记录 |
| `verifiedAt` | 移除 | producer 不暴露；Issue #44 无消费需求 |
| `selectedSourceCount` | 移除 | 无 authority 依据；T12 依据 Issue #44 自行从 verified corpus 计算 eligible/selected |
| `manifest.derivedFrom` | 移除 | derivedFrom 解释数组（F5 模式）；派生语义由 I7 与本合同记录 |
| `manifest.selectorOutputRef` | 移除 | producer 不暴露；selection 身份由 selectionIdentity/selectionDecisionHash 承载（更强） |
| `manifest.selectedGroupCount`（顶层） | 移入 `accounting` | 对齐真实 producer 结构 |
| `manifest.groupProvenance` | 移除 | producer manifest 不含；§5.1 provenance 属 T08 selection 决策面，非本 seam |
| groupId `"q-<id>"` 前缀 | 移除 | 真实 T08 输出 groupId == questionId；格式由 T08 权威决定，合同不冻结前缀 |

### CONTRACT TESTS（taxonomy 见 companion doc §E2）

```text
TYPE_A = REQUIRED（3 fixtures，见 §附）
TYPE_B = REQUIRED（producer 已存在）：
         research-orchestration/test/p1-seam-a-producer-conformance.test.mjs
         pin REVIEWED_T09_SHA = 4789382f36d179dc13957f2c23748f169875d7a2，git archive 只读物化
         真实 producer，公共 API 构造确定性状态 → deriveResearchCorpusManifest → SEAM A validator
         → PASS；负例：captured-but-not-verified 组不进入 groups[]（I1）+ 混入被自校验 hash 拒绝。
REAL_T09_TO_SEAM_A_CONFORMANCE = PASS（2026-09-05，本分支验证记录）
```

---

## SEAM B — T12 → T13

```text
SEAM_ID = T12_TO_T13
VERSION = 1
PRODUCER = P1-T12 RCE Corpus Selector（Issue #44）
CONSUMER = P1-T13 Question/Source-group representation + per-group claim extraction（Issue #45）
INPUT  = SEAM A artifact + dense geometry（T11）
OUTPUT = Selected Verified Research Corpus（含 corpus identity + selection accounting）
```

### OUTPUT_OBSERVABLE_SHAPE（canonical fixture encoding）

```jsonc
{
  "seam": "T12_TO_T13",
  "seamVersion": 1,
  "planHash": "<64hex>",
  "selectedCorpusIdentity": "sha256:<64hex>",         // §9.3 selected verified source set identity
  "corpus": {
    "groups": [
      {
        "groupId": "<T08 权威格式，与 SEAM A 同一 identity>",   // R1：不再示例化 "q-" 前缀
        "selectedSourceRefs": [                       // 引用，不含内容
          { "canonicalSourceId": "<stable-id>", "contentHash": "sha256:<64hex>",
            "verifiedArtifactRef": "<path>" }
        ],
        "accounting": {                               // §3.1 / §9.2 / Issue #44 IN_SCOPE
          "eligible": <n>, "selected": <n>, "verified": <n>,
          "exclusionReasonCategories": { "<category>": <n> }
        }
      }
    ],
    "totals": { "eligible": <n>, "selected": <n>, "verified": <n>,
                "exclusionReasonCategories": { "<category>": <n> } }
  }
}
```

注意：canonicalSourceId 的具体编码由 producer 权威决定（delegated）；合同只要求
stable identity + contentHash 配对。**T12 产物中不得出现任何 `analyzed` 计数字段**
（analyzed 归 T13 唯一写入，Issue #44 OUT_OF_SCOPE）。

> **R1-F5 审计结论（SEAM B）**：逐 REQUIRED 字段核查后**零移除**——`planHash`（Spec §4.3
> 绑定）、`selectedCorpusIdentity`（Issue #46 guard 比较基准）、per-source refs（T13 claims
> 绑定）、`accounting`（Issue #44 IN_SCOPE：eligible/selected/verified + exclusion reasons
> 完整可测）、`totals`（Issue #44「selection accounting 完整且可测」的 corpus 级机械一致性
> 面，validator 交叉核对）。无 timestamps / owner 标注 / derivedFrom / 嵌入枚举可疑项。
> groupId 示例格式与 SEAM A 对齐（T08 权威，不冻结前缀）。

### IDENTITY_FIELDS

`selectedCorpusIdentity`（selected verified source set 的确定性身份；其编码即 T14 guard
的比较基准）、`planHash`、per-source `canonicalSourceId` + `contentHash`。

### REQUIRED_INVARIANTS

1. 每组 eligible/selected/verified + exclusion reason category 完整可测（§3.1、Issue #44 AC）。
2. relevant/minority group 不得无记录地零代表；大组不得静默吞小组（§3.1）。
3. selection 不伪装为 `top-percent-analysis`（§1.1、Issue #44 STOP）。
4. answer count / popularity 不自动成为 truth weight（§3.1、§3.2）。
5. 每个 selected source 必须来自 SEAM A verified refs（verified-only）。
6. 无 analyzed 计数字段（单一写入者 = T13，Ticket Graph §B）。

### VALID_SUCCESS

identity 确定性可复现；组内 `selected ≤ verified ≤ eligible`；每个被排除的 eligible source
都有 exclusion reason category；全部 source refs 可回溯到 SEAM A verified 产物。

### FAIL_CLOSED

| 条件 | 错误码 |
|---|---|
| exclusion reason 缺失（有排除无记录） | `SEAM_B_MISSING_EXCLUSION_REASON` |
| 出现 analyzed 字段（所有权越界） | `SEAM_B_ANALYZED_FIELD_FORBIDDEN` |
| selected source 无 verified 出处 | `SEAM_B_UNVERIFIED_SOURCE_REF` |
| 伪装 sampled/top-percent mode | `SEAM_B_MODE_IDENTITY_CONFLICT` |

### OWNERSHIP

producer = T12（selection accounting 所有权）；analyzed 计数所有权 = T13（不在此 seam）。

### CANONICAL_CONTENT_LOCATION

各组 `answers.json`。本 seam 只持 refs + hashes + accounting。

### FORBIDDEN_DUPLICATION

回答正文 / 渲染文本；第二 analyzed 计数体系。

### SECURITY_BOUNDARY

refs 指向 UNTRUSTED_CORPUS；corpus 身份不携带 credential；UNTRUSTED_CONTENT 投影规则在
下游 T13 消费时适用（§10.1）。

### BACKWARD_COMPATIBILITY / VERSIONING_RULE

同 SEAM A。`exclusionReasonCategories` 的具体 category 词表由 producer 按既有约定维护；
新增 category = V1 兼容。

---

## SEAM C — T13 → T14

```text
SEAM_ID = T13_TO_T14
VERSION = 1
PRODUCER = P1-T13 representation + per-group claim extraction（Issue #45）
CONSUMER = P1-T14 Cross-group aggregation + synthesis（Issue #46）
INPUT  = SEAM B artifact（Selected Verified Research Corpus）
OUTPUT = per-group research representations + claims
         + aggregate mapped/analyzed source-set identity（T13 唯一写入）
```

### OUTPUT_OBSERVABLE_SHAPE（canonical fixture encoding）

```jsonc
{
  "seam": "T13_TO_T14",
  "seamVersion": 1,
  "planHash": "<64hex>",
  "selectedCorpusIdentityRef": "sha256:<64hex>",      // SEAM B identity 的只读回显
  "groupRepresentations": [                           // §8.1 全字段
    {
      "groupId": "<T08 权威格式，与 SEAM A/B 同一 identity>",
      "canonicalGroupIdentity": { "questionId": "<id>", "providerId": "<id>", "capability": "<id>" },
      "accounting": { "selected": <n>, "verified": <n>, "mapped": <n>, "analyzed": <n> },
      "claims": {
        "main":         [ { "claimId": "<id>", "statement": "<text>", "sourceRefs": ["<canonicalSourceId>"] } ],
        "minority":     [ /* 同上 */ ],
        "contradictory":[ /* 同上 */ ]
      },
      "expertEvidenceRichRefs": ["<canonicalSourceId>"],
      "completenessStatus": "verified",               // §9.2 冻结词表 captured/verified/partial/failed
      "discussionVolume": { "answerCount": <n> }      // 独立信号（§8.1）
    }
  ],
  "aggregateAnalyzedIdentity": {                      // T14 PRE-SYNTHESIS guard 消费 artifact
    "mappedAnalyzedSourceSetIdentity": "sha256:<64hex>",
    "perGroup": { "<groupId>": "sha256:<64hex>" }
  }
}
```

> **R1-F5 审计结论（SEAM C）**：从 REQUIRED 形状移除 `aggregateAnalyzedIdentity.owner`
> 与 `aggregateAnalyzedIdentity.derivedFrom`——两者分别是「静态权威重复的 owner 标注」与
> 「derivedFrom 解释数组」（F5 明确可疑类别）：所有权由静态权威承载（Issue #45
> single-owner 条款 `ANALYZED_SOURCE_SET_IDENTITY_OWNER = P1-T13`、Ticket Graph §B、
> key-decisions D10），SEAM C 产物只能由 T13 产出这一点由 seam 本身保证；伪造 owner 标注
> 不提供任何安全价值。其余字段（§8.1 representation 全字段、claims lineage、guard 消费的
> aggregate identity）均有直接 authority 与消费需求，保留。

### IDENTITY_FIELDS

`mappedAnalyzedSourceSetIdentity`（aggregate）+ per-group identities；**其编码必须与
SEAM B `selectedCorpusIdentity` 同一 identity encoding**——否则 Issue #46 的机械比较
`selected_verified_source_set_identity == mapped_analyzed_source_set_identity` 不成立。
`selectedCorpusIdentityRef` 是对输入 seam 的只读回显，不得被下游改写。

### REQUIRED_INVARIANTS

1. §8.1 字段全部可表达且可机械校验（Issue #45 AC）。
2. claims 的 sourceRefs 是 controller-owned canonicalSourceId；模型只回短 token / 语义，
   不拥有 sourceId（Issue #45 AC、key-decisions D02）。
3. analyzed identity 唯一写入者 = T13；per-group + aggregate 均由其确定性组合（Ticket Graph §B）。
4. `analyzed ≤ verified ≤ selected`；analyzed 集合 ⊆ selected corpus。
5. 任一来源失败 → 该组 fail closed，无部分结果冒充（Issue #45 STOP）。
6. runtime unavailable → fail closed（Issue #45）。

### VALID_SUCCESS

aggregate identity 与 `selectedCorpusIdentityRef` 机械相等（guard 等分支可放行）、
representation 与 canonical 不冲突、claims lineage 可回溯。

### FAIL_CLOSED

| 条件 | 错误码 |
|---|---|
| aggregate identity ≠ selected corpus identity（guard 不等分支输入态） | `SEAM_C_GUARD_MISMATCH` |
| representation 与 canonical 冲突 | `SEAM_C_REPRESENTATION_CONFLICT` |
| claims 携带非 controller-owned identity | `SEAM_C_MODEL_OWNED_IDENTITY` |
| 缺 aggregate identity / owner 标注 | `SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE` |

### OWNERSHIP

producer = T13（mapped/analyzed identity 唯一写入者）；T14 只消费 aggregate identity，
不得创建或维护第二套（Issue #46 OUT_OF_SCOPE）。

### CANONICAL_CONTENT_LOCATION

claims 引用 canonicalSourceId；statement 语义文本属 derived view（key-decisions D03），
canonical 仍在各组 `answers.json`。

### FORBIDDEN_DUPLICATION

第二 analyzed identity 写入路径；用 `canonicalSourceIds` union 冒充 §8.1 逻辑层（Spec §2.3/§8.1）。

### SECURITY_BOUNDARY

EXTERNAL_CORPUS 输入类：UNTRUSTED_CONTENT / DATA_NOT_INSTRUCTION；语义 worker 无
credential 访问；投影安全断言由 T13/T14 测试维持（§10.1、Issue #46 REQUIRED_EVIDENCE）。

### BACKWARD_COMPATIBILITY / VERSIONING_RULE

同 SEAM A。claims 内部结构的加字段 = V1 兼容；identity encoding 变化 = major bump
（会连带 SEAM B/D 的比较语义）。

---

## SEAM D — T14 → T15

```text
SEAM_ID = T14_TO_T15
VERSION = 1
PRODUCER = P1-T14 Cross-group aggregation + synthesis（Issue #46）
CONSUMER = P1-T15 CoverageState final integration + assertion + observability（Issue #47）
INPUT  = SEAM C artifact（representations + claims + aggregate identity）
OUTPUT = cross-group synthesis artifact（含 PRE-SYNTHESIS guard 证据）
         + synthesis-level 语义诊断（经 T07 hook 更新）
```

### OUTPUT_OBSERVABLE_SHAPE（canonical fixture encoding）

```jsonc
{
  "seam": "T14_TO_T15",
  "seamVersion": 1,
  "planHash": "<64hex>",
  "preSynthesisGuard": {                              // Issue #46 R2 F-2：guard 证据随产物走
    "guardResult": "PASS",                            // 仅 "PASS" 可伴随 synthesis artifact
    "selectedVerifiedSourceSetIdentity": "sha256:<64hex>",   // = SEAM B identity
    "mappedAnalyzedSourceSetIdentity": "sha256:<64hex>"      // = SEAM C aggregate identity
  },
  "synthesis": {
    "synthesisIdentity": "sha256:<64hex>",
    "claims": [
      { "claimId": "<id>", "aspect": "<text>", "category": "widely-shared",
        "support": [ { "sourceRef": "<canonicalSourceId>", "groupId": "<T08 groupId>", "authorRef": "<id>" } ],
        "oppose":   [ /* 同构 */ ],
        "expertEvidenceRichSupport": <bool> }
    ],
    // R1-F5：§8.3 category 冻结词表是静态权威，不再嵌入运行时产物的 categoryEnum 字段
    "groupDifferences": [ /* source-group differences */ ],
    "evidenceStrength": [ /* §8.3 */ ],
    "discussionVolumeDifferences": { /* §8.3 */ }
  },
  "diagnostics": {                                    // 仅 T14 可写键集（见下方所有权映射）
    "new_aspect_rate": <f>, "new_claim_rate": <f>, "new_expert_rate": <f>,
    "new_contradiction_rate": <f>, "claim_source_diversity": <f>
  }
}
```

### diagnostics 所有权映射（R1-F3：FIELD → OWNER → AUTHORITY）

`diagnostics` 的 REQUIRED 键集 = **T14 经冻结 T07 hook `updateSynthesisDiagnostics` 实际可写
的键集**（coverage-state.mjs @ master；Spec §9.4）。不按命名相似度推断，逐键给出权威：

| field | OWNER | AUTHORITY |
|---|---|---|
| `new_aspect_rate` | T14 | Hook 5 `updateSynthesisDiagnostics` → `applyNewRateDiagnostics`；Spec §9.4 |
| `new_claim_rate` | T14 | 同上 |
| `new_expert_rate` | T14 | 同上 |
| `new_contradiction_rate` | T14 | 同上 |
| `claim_source_diversity` | T14 | Hook 5 显式 T14-only 写入路径；Spec §9.4（R1-F3 补回：R0 缺失） |
| `novelty_gain` | **T06 / Retrieval Controller** | Hook 1 `updateRetrievalCoverage` —— 非 T14 可写，**已从 SEAM D 移除**（R0 漂移项） |
| `selected_source_group_count` 等 selection 类 | T12 | Hook 3 `updateSelectionAccounting` —— 不经 SEAM D |
| `capturedNotVerifiedCount` 等 completeness 类 | T09 | Hook 2 `updateSourceCompleteness` —— 不经 SEAM D |

### IDENTITY_FIELDS

`synthesisIdentity`、guard 双 identity（必须分别等于 SEAM B / SEAM C 的对应 identity）、
`planHash`。claims 保留 supporting/opposing 的 source/group/author 结构（§8.2 禁止只留
`support_count`）。

### REQUIRED_INVARIANTS

1. synthesis artifact 存在 ⇔ guard PASS 且双 identity 机械相等（不等 → FAIL_CLOSED 且
   NO SYNTHESIS ARTIFACT，Issue #46）。
2. T14 不写 analyzed source-set identity（只消费，Issue #46 OUT_OF_SCOPE）。
3. 聚合保留 supporting/opposing sources、questions/groups/authors、expert/evidence-rich
   support（§8.2）。
4. synthesis 区分 §8.3 全部 category；无 flat reduce、无 naive equal weight（§8.3）。
5. diagnostics 键 ⊆ §9.4 冻结键集；经 T07 hook 如实更新（Issue #46 IN_SCOPE）。
6. T15 只消费/比较/断言，不重算、不第二写入（Issue #47；T15 断言 = 双保险）。

### VALID_SUCCESS

guard PASS + identity 链一致（B = C = D 回显）、claims 结构完整、diagnostics 完整、
lineage controller-owned。

### FAIL_CLOSED

| 条件 | 错误码 |
|---|---|
| 缺 guard 证据 / guardResult ≠ PASS 却有 synthesis | `SEAM_D_GUARD_EVIDENCE_REQUIRED` |
| guard 双 identity 与 B/C 来源不一致 | `SEAM_D_IDENTITY_CHAIN_BREAK` |
| claim 只有计数字段无 source 结构 | `SEAM_D_COUNT_ONLY_CLAIM` |
| diagnostics 出现 §9.4 之外的键 | `SEAM_D_UNKNOWN_DIAGNOSTIC_KEY` |
| claim/category/section 结构缺失 | `SEAM_D_CLAIM_STRUCTURE_REQUIRED` / `SEAM_D_UNKNOWN_CLAIM_CATEGORY` / `SEAM_D_SYNTHESIS_SECTION_REQUIRED` / `SEAM_D_DIAGNOSTICS_INCOMPLETE` |

### OWNERSHIP

producer = T14（synthesis + synthesis-level diagnostics）；analyzed identity 所有权仍在
T13；T15 拥有最终对账 / 100% assertion / 披露（唯一有权宣称完整 saturation wiring 完成，
Ticket Graph §B）。

### CANONICAL_CONTENT_LOCATION

synthesis 是 derived view；canonical 仍在各组 `answers.json`（D03）。

### FORBIDDEN_DUPLICATION

第二 analyzed identity；flat reduce 后丢弃 supporting/opposing 结构的"计数式"聚合。

### SECURITY_BOUNDARY

synthesis 面向最终 render/披露：无 machine-private path；UNTRUSTED 投影规则在 render 侧
继续适用（Issue #47 AC）。

### BACKWARD_COMPATIBILITY / VERSIONING_RULE

同 SEAM A。claim category 词表按 §8.3 冻结（静态权威，validator 内置）；diagnostics 键集 =
T14 hook 可写集——两者扩展均需 Spec 级 authority，不得由 seam amendment 私自扩张。

---

## 附：Seam → fixture / validator / test 对照

| Seam | valid minimal | valid multi-group | fail-closed | TYPE_B |
|---|---|---|---|---|
| A | `seam-a/research-corpus-manifest.minimal.json` | `seam-a/research-corpus-manifest.multi-group.json` | `seam-a/invalid.stale-manifest-hash.json` | **REQUIRED**（T09 已存在 @ 4789382）→ `test/p1-seam-a-producer-conformance.test.mjs` |
| B | `seam-b/selected-research-corpus.minimal.json` | `seam-b/selected-research-corpus.multi-group.json` | `seam-b/invalid.missing-exclusion-reason.json` | DEFERRED_UNTIL_T12 |
| C | `seam-c/group-representations.multi-group.json` | （同左，多组即 realistic case） | `seam-c/invalid.guard-mismatch.json` | DEFERRED_UNTIL_T13 |
| D | `seam-d/synthesis-output.minimal.json` | （由 chain test 以 B+C 真实链验证） | `seam-d/invalid.no-guard-evidence.json` | DEFERRED_UNTIL_T14 |

canonical-content 重复检测：contract test 在内存中向 valid A fixture 植入内容体字段并断言
`SEAM_A_CANONICAL_CONTENT_FORBIDDEN`（无需独立文件）。

**R1 新增机械保障（SEAM A）**：manifestHash 自校验——validator 重算真实 producer 的 hash 域
（canonicalJson 逐键排序 + sha256），fixtures 的 manifestHash 为真实计算值；任何被 hash 覆盖
字段的篡改 / captured 组混入 / stale 漂移都触发 `SEAM_A_MANIFEST_HASH_MISMATCH`。
