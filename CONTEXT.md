# P1 Cross-Question Deep Research — Domain Context

P1 跨问题深度研究的领域词汇表（ubiquitous language）。本文件只是 glossary：只定义术语是什么，
不含实现细节、不含 schema、不复制 Spec。每个术语的 canonical 权威出处标注在条目内；
定义与 Approved Spec 冲突时以 Spec 为准。

> STATUS: distilled from approved authority（P1 Spec / Ticket Graph V1 / ticket Issues）；
> glossary-only artifact。修订须经独立 review。

## Pipeline artifacts（按数据流顺序）

**ResearchPlan**:
Planner 产出的结构化研究提案（query variants、aspects、entities、opposing framings、
terminology variants、source-group intents），persisted、validated、hashed。
_Owner_: Research Planner 提案语义 / Controller 拥有 plan artifact identity。
_Canonical source_: Spec §4。
_Avoid_: 自由文本计划、prompt 草稿。

**planHash**:
persisted ResearchPlan artifact 的 controller-owned identity；下游 retrieval/selection/
capture/analysis 全部依赖它；plan 变更即从适当边界失效 downstream。
_Canonical source_: Spec §4.2–§4.3。

**RetrievalPool**:
multi-query / multi-provider 检索经 RRF 融合后的 candidate / source-group 池。
RRF 只负责 candidate fusion，不负责最终 corpus selection。
_Canonical source_: Spec §1、§5.4。
_Avoid_: 候选列表与选中语料混称。

**SelectedSourceGroups**:
controller-owned selection artifact 确定的 source-group 集合，每项保留 group identity、
provider/capability provenance、selection rationale reference 与 planHash dependency。
P1 的选择结果不再是单个 `selectedQuestionId`。
_Canonical source_: Spec §6.1、§7.2。

**PerGroupExecutionState**:
每组独立的 capture / verify / handoff 状态、artifact reference、hash/version、failure
identity 与 resume boundary；一组完成不把其他组标 completed。
_Canonical source_: Spec §6.1–§6.2。

**VerifiedGroupRefs**:
只能引用 per-group verify authority 已判 valid 的 artifacts 的引用集合；captured group
不能进入该集合。
_Canonical source_: Spec §6.1。

**ResearchCorpusManifest**:
只从 valid `VerifiedGroupRefs[]` + selector output 确定性派生的 composition artifact，
记录 selected source composition / group provenance / dependent hashes。
它是 execution/composition artifact，不是第二 canonical source of truth。
_Canonical source_: Spec §6.1。
_Avoid_: 把 manifest 当内容存储。

**Selected Verified Research Corpus**:
RCE 从 candidate/retrieval pool 构造的、经 selection accounting 完整计量的已验证语料集合；
拥有 corpus identity、eligible/selected/verified 计数与 exclusion reason categories。
它不含 analyzed 计数——analyzed 归 Analysis Coverage 层。
_Canonical source_: Spec §1.1、§3.1、§9.2；Issue #44。
_Avoid_: corpus construction 与 top-percent-analysis 混称。

**PerGroupResearchRepresentation**:
每个 group 进入跨源综合前形成的显式逻辑表示：canonical group identity/provider
provenance、selected/verified/analyzed source accounting、main/minority/contradictory
claims、expert/evidence-rich source refs、completeness/coverage state、discussion volume
独立信号。独立于物理 chunk packing。
_Canonical source_: Spec §8.1。
_Avoid_: 用 `canonicalSourceIds` union 冒充逻辑层。

**MappedSourceSetIdentity / AnalyzedSourceSetIdentity**:
已 mapped / 已 analyzed 的 canonical source 集合的确定性身份。per-group 与 controller-derived
aggregate 两级；aggregate identity 是 T14 PRE-SYNTHESIS guard 的消费 artifact。
唯一写入者 = P1-T13。
_Canonical source_: Spec §9.3；Ticket Graph §B；Issue #45（R2 F-4 + R3）。
_Avoid_: 任何第二写入路径、事后重算。

**CrossGroupClaim / Aspect**:
跨 group 聚合的 claim/aspect，保留 supporting/opposing sources、questions/groups、authors、
expert/evidence-rich support；禁止只留 `support_count`。
_Canonical source_: Spec §8.2。

**CrossGroupSynthesisArtifact**:
区分 widely shared / group-specific / minority / conflicting claims、source-group
differences、evidence strength、discussion-volume differences 的跨源综合产物；禁止 flat
reduce 与 naive equal weight。
_Canonical source_: Spec §8.3。

**ResearchCoverageState**:
同时表达 Retrieval Coverage、Source Completeness、Analysis Coverage 与 simple diagnostics
的研究级覆盖状态；经 T07 hooks 由各 stage owner 如实更新。
_Canonical source_: Spec §9。

## Coverage（三件事不是一件事）

**Retrieval Coverage**:
当前 plan/query/provider 条件下探索了多少研究空间；通常不能声称全站 100%。
_Canonical source_: Spec §1、§9.1。

**Source Completeness**:
对每个已选、可枚举 source group 的 capture/pagination/verify 完整性。
_Canonical source_: Spec §1、§9.2。

**Analysis Coverage**:
selected Verified Research Corpus 中有多少 selected canonical sources 真正进入分析；
P1 默认必须 100%（两集合机械相等才可断言）。
_Canonical source_: Spec §1、§9.3。

## Provider / Runtime（三个独立 seam）

**ZhihuDataProvider**:
访问知乎 capability、产生 candidate/source-group identity 与 retrieval/capture provenance
的数据能力层；official-first、THIN / ADAPTER_FIRST / REUSE_FIRST；禁止 silent fallback。
_Canonical source_: Spec §5.1。

**SemanticRuntime**:
Planner、claim extraction、aspect mapping、map/reduce/synthesis 等语义生成运行时；不读取
provider credential，不拥有 canonical identity / IO / validity authority。
public-Zhihu 默认 `deepseek-api-tool-less`。
_Canonical source_: Spec §5.2。

**EmbeddingProvider**:
text-in → vector-out 的 dense geometry provider；既不等于 SemanticRuntime，也不经
`map.mjs` runtime routing 绑定。
_Canonical source_: Spec §5.3。

**Controller authority**:
Controller 拥有 canonical source identity、coverage、evidence lineage、IO、结构化验证与
fail-closed；模型只拥有语义（摘要、归纳、分类、synthesis）。
_Canonical source_: Spec §4.2、§10；`docs/architecture/key-decisions.md` D02。

## IMPORTANT_NON_EQUIVALENCES

```text
CAPTURED                != VERIFIED            （verify-output 是唯一 validity authority）
FILE EXISTS             != VALID CACHE         （checkpoint 必须经 artifact hash/version 验证）
UNKNOWN                 != PASS
ResearchCorpusManifest  != canonical source content（canonical 仍在各组 answers.json）
Selected                != Analyzed            （selection accounting 归 T12；analyzed identity 归 T13）
Sampled Analysis        != Full Coverage Digest （mode identity，不因规模/成本互相伪装）
Retrieval Coverage 100% != 全站 coverage proof （saturation 只是当前策略下新信息增益趋缓）
partial                 != complete            （partial 可报告可恢复，不得渲染为 research complete）
```

## Related Documents

- [P1 Spec](./docs/specs/p1-cross-question-deep-research.md) — 全部术语的 canonical 权威
- [Key Engineering Decisions](./docs/architecture/key-decisions.md) — D01–D11 决策记录
- [P1 Seam Contracts V1](./docs/planning/P1_SEAM_CONTRACTS_V1.md) — 模块间可观察 seam 合同
- [P1 Ticket Graph V1](./docs/planning/P1_TICKET_GRAPH_V1.md) — 依赖 DAG 与集成顺序
