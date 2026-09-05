# P1 Seam Contracts V1 — T09→T12→T13→T14→T15 Observable Module Contracts

```text
DOCUMENT_ID = P1_SEAM_CONTRACTS_V1
STATUS = NON_AUTHORITATIVE_CANDIDATE
AUTHORITY_CLASS = PLANNING / GOVERNANCE CANDIDATE（待 ChatGPT external audit PASS + ff-only
                  integration 后生效；生效前不授权任何实现消费其字段为 product authority）
BASE_SHA = 0287ba3ef33c29357c7f8306f9e51dcca2b41da0
BRANCH = planning/p1-contract-driven-parallel-workflow
COMPANION = docs/planning/P1_PARALLEL_EXECUTION_CONTRACT_V1.md（READY 三 gate + 执行模型）
FIXTURES = research-orchestration/test/fixtures/p1-seams/
VALIDATOR = research-orchestration/test/helpers/p1-seam-contracts.mjs
CONTRACT_TESTS = research-orchestration/test/p1-seam-contracts.test.mjs
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

## SEAM A — T09 → T12

```text
SEAM_ID = T09_TO_T12
VERSION = 1
PRODUCER = P1-T09 Multi-group Execution State + Per-group Capture/Verify/Handoff（Issue #41）
CONSUMER = P1-T12 RCE Corpus Selector（Issue #44）
INPUT  = SelectedSourceGroups[]（T08 selection artifact）+ per-group capture/verify 产物
OUTPUT = ResearchCorpusManifest（derived composition artifact）
         + VerifiedGroupRefs[]（仅 valid）
```

### OUTPUT_OBSERVABLE_SHAPE（canonical fixture encoding）

```jsonc
{
  "seam": "T09_TO_T12",
  "seamVersion": 1,
  "planHash": "<64hex>",                              // Spec §4.3
  "verifiedGroupRefs": [                              // Spec §6.1：仅 valid 组
    {
      "groupId": "q-<questionId>",
      "questionId": "<questionId>",
      "verifiedArtifactRef": "<path>",                // 引用，不含内容
      "contentHash": "sha256:<64hex>",                // dependent hash（§6.1）
      "verifyResultRef": "<path>",                    // verify authority 证据引用（§2.2）
      "verifyAuthority": "verify-output",
      "selectedSourceCount": <n>,                     // §9.2 per-group 计数
      "verifiedAt": "<ISO8601>"
    }
  ],
  "manifest": {
    "manifestHash": "sha256:<64hex>",
    "derivedFrom": ["verifiedGroupRefs", "selectorOutputRef"],
    "selectorOutputRef": "<path>",                    // T08 selection artifact 引用
    "selectedGroupCount": <n>,
    "groupProvenance": [                              // §5.1 provider/capability provenance
      { "groupId": "q-<id>", "providerId": "<id>", "capability": "<id>" }
    ]
  }
}
```

### IDENTITY_FIELDS

`planHash`、`manifestHash`、每 ref 的 `contentHash` + `verifyResultRef`、
`selectedGroupCount`。manifest 相同输入必须确定性重建（§6.1）。

### REQUIRED_INVARIANTS

1. 只有 verify authority 判 valid 的组可进入 `verifiedGroupRefs`；captured 不得进入（§6.1、§6.2）。
2. manifest 只从 valid refs + selector output 确定性派生（§6.1）。
3. manifest 不是第二 canonical store（§6.1、key-decisions D09）。
4. planHash / group identity 变更 → 该组及依赖 artifact 失效（§6.2）。
5. credentials / secret-bearing 内容永不进入 manifest（§6.2）。
6. partial 不得渲染为 complete（§6.2）。

### VALID_SUCCESS

全部 ref 的 `contentHash` 与 per-group artifact 现值一致、`verifyResultRef` 存在且 authority =
verify-output、planHash 与当前 plan 一致、派生可复现。

### FAIL_CLOSED

| 条件 | 错误码 |
|---|---|
| ref 缺 verify 证据引用 / authority 不是 verify-output | `SEAM_A_MISSING_VERIFY_EVIDENCE` |
| manifest 内出现 canonical 内容体（回答正文/markdown/渲染文本） | `SEAM_A_CANONICAL_CONTENT_FORBIDDEN` |
| hash 不匹配 / identity stale | `SEAM_A_STALE_DEPENDENCY` |
| planHash 不一致 | `SEAM_A_PLAN_HASH_MISMATCH` |
| manifest 结构性不一致（计数/派生声明/provenance 缺失） | `SEAM_A_MANIFEST_INCONSISTENT` |

### OWNERSHIP

producer = T09；verified 状态权威 = verify-output authority（不变，§2.2）；T12 只消费。

### CANONICAL_CONTENT_LOCATION

各组 `answers.json`（§6.1）。manifest 只持 refs + hashes。

### FORBIDDEN_DUPLICATION

回答正文、渲染 markdown、projection 文本、credential 内容。

### SECURITY_BOUNDARY

manifest 属 execution artifact：内容引用指向 UNTRUSTED_CORPUS，但 manifest 本身进入
semantic worker 时仍受 §10.1 投影隔离约束；无 machine-private path（RULES §11）。

### BACKWARD_COMPATIBILITY / VERSIONING_RULE

只增可选字段 = V1 兼容；删除/改名/语义变化 = major bump + fixture/validator 同步 +
下游 re-review。禁止 post-review 静默改 fixture 语义。

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
        "groupId": "q-<id>",
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
      "groupId": "q-<id>",
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
    "perGroup": { "q-<id>": "sha256:<64hex>" },
    "owner": "P1-T13",
    "derivedFrom": ["perGroupAnalyzedIdentities"]
  }
}
```

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
        "support": [ { "sourceRef": "<canonicalSourceId>", "groupId": "q-<id>", "authorRef": "<id>" } ],
        "oppose":   [ /* 同构 */ ],
        "expertEvidenceRichSupport": <bool> }
    ],
    "categoryEnum": ["widely-shared", "group-specific", "minority", "conflicting"],  // §8.3
    "groupDifferences": [ /* source-group differences */ ],
    "evidenceStrength": [ /* §8.3 */ ],
    "discussionVolumeDifferences": { /* §8.3 */ }
  },
  "diagnostics": {                                    // §9.4 冻结键集（synthesis 级，T14 写）
    "new_aspect_rate": <f>, "new_claim_rate": <f>, "new_expert_rate": <f>,
    "new_contradiction_rate": <f>, "novelty_gain": <f>
  }
}
```

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

同 SEAM A。`categoryEnum` 按 §8.3 冻结词表；diagnostics 键集按 §9.4 冻结——两者扩展均需
Spec 级 authority，不得由 seam amendment 私自扩张。

---

## 附：Seam → fixture / validator / test 对照

| Seam | valid minimal | valid multi-group | fail-closed |
|---|---|---|---|
| A | `seam-a/research-corpus-manifest.minimal.json` | `seam-a/research-corpus-manifest.multi-group.json` | `seam-a/invalid.captured-only-ref.json` |
| B | `seam-b/selected-research-corpus.minimal.json` | `seam-b/selected-research-corpus.multi-group.json` | `seam-b/invalid.missing-exclusion-reason.json` |
| C | `seam-c/group-representations.multi-group.json` | （同左，多组即 realistic case） | `seam-c/invalid.guard-mismatch.json` |
| D | `seam-d/synthesis-output.minimal.json` | （由 chain test 以 B+C 真实链验证） | `seam-d/invalid.no-guard-evidence.json` |

canonical-content 重复检测：contract test 在内存中向 valid A fixture 植入内容体字段并断言
`SEAM_A_CANONICAL_CONTENT_FORBIDDEN`（无需独立文件）。
