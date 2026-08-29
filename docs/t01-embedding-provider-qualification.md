# P1-T01 — EmbeddingProvider Qualification Discovery（GATE-1）

```text
DOCUMENT_ID     = P1_T01_EMBEDDING_PROVIDER_QUALIFICATION
TICKET          = P1-T01
ISSUE           = FlapPearLabs/zhihu-grabber-toolkit#33
TYPE            = DISCOVERY / EVIDENCE
AUTHORITY_CLASS = NON_AUTHORITATIVE_CANDIDATE
REVIEWER        = ChatGPT（外部独立 EVIDENCE_REVIEWER）
BRANCH          = work/p1-t01-embedding-qualification
BASE_SHA        = cf4ce8bba66f11fd52de94e95957a0cd73fba4ea
SCOPE           = 资格证据采集 + qualification decision artifact（同一 exact HEAD）
TARGET_STATUS   = NOT_IMPLEMENTED
IMPLEMENTATION_AUTHORIZATION = P1-T01 ONLY
Date            = 2026-08-30
```

> 本文件与 `docs/t01-accepted-embedding-implementation-profile-decision.md` 位于**同一个 exact
> candidate HEAD**。在 EVIDENCE_REVIEWER 对该 exact HEAD PASS + ff-only merge + remote master
> re-fetch 验证之前，两者均为 `NON_AUTHORITATIVE_CANDIDATE`，P1-T10 不得消费。

---

## 0. START_GATE 与 freshness 核验（执行前已完成）

| 项 | 期望 | 实测 | 结论 |
|---|---|---|---|
| `origin/master`（fetch 后） | `cf4ce8bba66f11fd52de94e95957a0cd73fba4ea` | 同 | PASS |
| Issue #33 STATUS | `AUTHORIZED_TO_START` | 同 | PASS |
| Issue #33 START_GATE | `PASS` | 同 | PASS |
| Tracker #32 授权范围 | `SCOPED_TO_T01_AND_T04_ONLY` | 同 | PASS |
| branch ancestry | 从 exact master 创建 | `merge-base --is-ancestor origin/master HEAD` 退出码 0 | PASS |

无 drift。未执行 P1-T02 / T03 / T04 / T05 / T10 或任何下游票。

---

## 1. 候选集与收敛理由

任务要求"最小严肃候选集"，并明确禁止因 harness 历史默认批准 `bge-small-zh-v1.5`。候选按
**本机真实可用能力**收敛，不做 embedding 模型大盘点：

| # | 候选 | 类别 | 入选理由 |
|---|---|---|---|
| L1 | `transformersjs-local-onnx` + `Xenova/bge-small-zh-v1.5` | LOCAL | 进程内 ONNX、可版本钉死、完全本地；**正是被点名"不得默认批准"的历史 harness 模型，必须实测** |
| L2 | `transformersjs-local-onnx` + `Xenova/bge-base-zh-v1.5` | LOCAL | 与 L1 同 provider 的更大档位，用于判定 L1 的弱点是否为容量问题 |
| L3 | `lmstudio-local-embeddings` + `text-embedding-nomic-embed-text-v1.5` | LOCAL | 本机**已加载**、且所属 runtime（`lmstudio-local-tool-less`）在 V0.3 已获能力隔离 YES 的既有本地选项；用来验证"现成的最省力选项"是否够用 |
| R1 | 远端 OpenAI 兼容 embeddings | REMOTE | —— （见 §6：**无任何可资格化的远端候选**） |

未纳入：Ollama（本机未运行，引入新 runtime 需独立授权）、SentenceTransformers/torch（新 Python
运行时，超出本票 scope）、任何需要新增凭据的远端服务。

---

## 2. Fixture 与出网边界

- Battery：`discovery/p1-t01-embedding-qualification/fixtures/zh-semantic-battery.json`
  （`P1_T01_ZH_SEMANTIC_BATTERY_V1`，`provenance.class = SYNTHETIC_HANDCRAFTED`）。
- 全部为中文**手工合成**语句，P1 形态（观点 / 技术讨论口吻），**不含**任何真实知乎语料、
  不含任何真实 `EXTERNAL_CORPUS`、不含凭据。
- 覆盖范围：语义相关对、近重复 vs 同主题新颖、术语变体（含中英跨语种缩写）、对立表述、
  同锚点释义/对立对照、短查询 vs 长中文段落、确定性、畸形/空/超长/控制字符输入、
  向量形状与数值有效性、归一化、身份回显、失败身份、时延。
- **采样范围声明**：这是小型手工判别 battery，**不是**通用中文 embedding benchmark，
  **不是** Gold set。它只提供 provider/model-scoped 的方向性证据；采样证据不得升级为全局质量声明。

出网纪律（P1-T02 / GATE-2 未激活）：

- 本地候选：语料零出网（AC_11 机械验证，见 §5）。
- 远端侧：唯一一次对外调用是 §6 的能力存在性探测，**载荷为 2 条手工合成 fixture**，
  不落盘任何远端向量，不构成 GATE-2 授权。

---

## 3. 十项资格维度结论（选中候选 L2）

| # | 维度 | 结论 |
|---|---|---|
| 1 | provider category | **LOCAL** |
| 2 | named provider | `transformersjs-local-onnx`（进程内 ONNX Runtime，Node） |
| 3 | named model/profile | `Xenova/bge-base-zh-v1.5`，quantized ONNX |
| 4 | model/version identity | HF revision `71e50dc531959f9e04ebf190ea25b00261a0a186`；`onnx/model_quantized.onnx` 102,868,746 bytes，sha256 `b665f3bba56c3119bc76ba131ebcc544d720a7408cb11581bdf354aaa0198d43` |
| 5 | vector dimension | **768**（跨输入与批大小恒定） |
| 6 | vector validity contract | float32；全部分量 finite（nonFinite = 0）；空串/纯空白/单字/8000 字超长/含控制字符均返回有效 768 维向量（确定性，无静默垃圾向量） |
| 7 | Chinese semantic quality | 见 §4。10 项 AC 中 9 项 PASS；唯一 FAIL 为**同锚点对立判别**（AC_4b），已按 Spec §3.2 定位归属（见 §7 CAVEAT-1） |
| 8 | normalization profile | **mean pooling + L2 normalize**；实测 L2 norm ∈ [1, 1]，profile = `L2_UNIT_NORM`（单位范数，余弦即点积） |
| 9 | machine-readable failure identity | discovery-proposed 代码集，实测可产生：`EMBEDDING_MODEL_UNKNOWN`（未知模型 fail-closed）、`EMBEDDING_PROVIDER_UNREACHABLE`（端点不可达） |
| 10 | egress implications | **NO_NEW_EGRESS = YES**。嵌入阶段零出网（AC_11）。唯一网络动作是**一次性入站**下载公开模型权重（不含语料、不含凭据） |

---

## 4. 三候选实测对照

机器可读证据：
`discovery/p1-t01-embedding-qualification/evidence/candidate-transformersjs-bge-small-zh-v1.5.json`、
`.../candidate-transformersjs-bge-base-zh-v1.5.json`、
`.../candidate-lmstudio-nomic-embed-text-v1.5.json`、
`.../ac11-offline-blackhole-proxy-bge-base-zh-v1.5.json`、
`.../remote-capability-deepseek.json`。

### 4.1 判别力（余弦 margin，越大越好）

| AC | L1 bge-small-zh (512d) | L2 bge-base-zh (768d) | L3 nomic (768d) |
|---|---|---|---|
| AC_1 相关性 A1/A2/A3 | 0.4156 / 0.5198 / 0.2833 | **0.4581** / 0.4936 / 0.2318 | 0.1268 / 0.1056 / 0.1404 |
| AC_2 近重复 vs 新颖 B1/B2/B3 | 0.2605 / 0.2909 / 0.3124 | **0.3475** / 0.2522 / **0.4070** | 0.0171 / 0.0831 / 0.1752 |
| AC_3 术语变体 C1/C2/C3/C4 | 0.1068 / 0.3049 / 0.0743 / 0.3925 | **0.1434** / **0.4103** / **0.1541** / **0.4337** | 0.0769 / 0.1159 / 0.0735 / 0.0241 |
| AC_4b 同锚点释义>对立 I1/I2/I3 | −0.2740 / −0.0959 / +0.0387 | **−0.0816** / **+0.0281** / **+0.0726** | −0.0003 / −0.3693 / −0.0566 |
| AC_5 短查询→长段落 F1/F2 | 0.1772 / 0.4006 | **0.1850** / **0.4109** | 0.1631 / 0.1619 |
| AC 汇总 | 9 pass / 1 fail | 9 pass / 1 fail | **8 pass / 2 fail** |

### 4.2 契约与运维

| 项 | L1 small | L2 base | L3 nomic |
|---|---|---|---|
| 维度 | 512 | **768** | 768 |
| 归一化 | L2 单位范数 | L2 单位范数 | L2 单位范数 |
| 确定性（3 次重复最大绝对偏差） | 0 | **0** | 0 |
| 未知模型名 | `EMBEDDING_MODEL_UNKNOWN`（fail-closed） | `EMBEDDING_MODEL_UNKNOWN`（fail-closed） | **返回向量（`NONE`）= 静默回退** |
| 端点不可达 | `EMBEDDING_PROVIDER_UNREACHABLE` | `EMBEDDING_PROVIDER_UNREACHABLE` | `EMBEDDING_PROVIDER_UNREACHABLE` |
| battery 总时延（32 批） | 316.78 ms | 1469.57 ms | 1150.16 ms |
| 模型体积 | 23 MB | **103 MB** | 由 LM Studio 管理 |

### 4.3 候选取舍

**L3（nomic）明确淘汰**——两条独立硬缺陷：

1. **中文退化**：不同中文句产生近乎相同向量。最强证据是 AC_4 中出现**余弦恰为 1.0**
   （"远程办公提高了员工的工作效率" vs "远程办公降低了团队沟通效率" → 完全相同的向量）。
   其方向性 AC 虽"通过"，但 margin 仅 0.017–0.14（L2 为 0.23–0.49），其中 AC_2 B1
   近重复/新颖 margin 仅 **0.0171**——对冗余控制而言无法操作。
2. **静默回退**：向 LM Studio 请求未知模型名 `t01-probe-no-such-model` 时**返回了向量**而非报错。
   这直接违反 Spec §10.2 `NO_SILENT_PROVIDER_FALLBACK`。

结论：L3 不适用于 P1 中文工作负载；`lmstudio-local-tool-less` 既有能力隔离 YES 是**运行时安全**
结论，不推导到该 runtime 上任意 embedding 模型的中文质量（与 V0.3 "模型质量 ≠ 运行时安全"
的持久教训一致）。

**L1 vs L2 选择 L2（base）**——L2 在 P1 合同最相关的两条轴上显著更好：

- 术语变体（Spec §4.1 明确要求 plan 产出 `terminology variants`）：C3「RAG」↔「检索增强生成」
  从 0.0743 → 0.1541（约 2 倍）；四项均值 0.220 → 0.285。
- 同锚点对立判别（Spec §4.1 明确要求 `opposing framings`）：I2 由 −0.0959 翻正为 +0.0281，
  I1 误差从 −0.2740 收敛到 −0.0816。
- 近重复/新颖（冗余控制核心）：B1 0.2605 → 0.3475、B3 0.3124 → 0.4070。

代价是 4.4× 时延（1469 ms vs 317 ms / 32 批，CPU）与 4.5× 模型体积。P1 的 embedding 走
缓存、按 source 一次，该代价在语料规模上可接受；而 dense geometry 按 Spec §3.2 是 selector
的**核心语义几何**，判别力优先。

> **T10 可回退条款**：若 T10 在真实语料规模上实测证明 base 的时延/内存不可接受，可改用
> `bge-small-zh-v1.5`（512d）。该降级是 T10 的**显式实现验证结论**（D-4 / D-6 允许），
> 必须作为被测决策记录，**不得**成为运行时静默回退（`NO_SILENT_PROVIDER_FALLBACK`）。

---

## 5. AC_11 — 出网否定性验证（机械证据，非声明）

做法：把 `HTTPS_PROXY/HTTP_PROXY` 指向黑洞地址 `127.0.0.1:9` 并启用 Node env-proxy agent，
重跑 L2 的完整 battery。

结果（证据：`evidence/ac11-offline-blackhole-proxy-bge-base-zh-v1.5.json`）：

```text
offlineEnforced = True
AC summary      = pass 9 / fail 1 / unknown 0
AC_1..AC_8 全部数值 与 在线运行 逐字节相同   → True
```

即：**嵌入阶段不需要也无法进行任何对外网络调用**。

```text
NO_NEW_EGRESS = YES
```

整个 ticket 唯一的网络动作是**一次性入站**获取公开模型权重（`fetch-model.mjs`）：
方向 inbound、载荷 public model weights、不含语料、不使用凭据。

```text
REQUIRES_REMOTE_EGRESS_AUTHORITY = NO
```

理由：代表性资格验证**未**受阻于"必须使用真实公开知乎语料出网"——本地候选在合成中文 fixture
上即可完成十项维度的判定，且选中结局为 LOCAL。因此不触发移交 T02 的条件。

---

## 6. REMOTE 侧评估（结论：本机无远端候选可资格化）

| 检查 | 结果 |
|---|---|
| 环境变量中的远端 embedding 凭据（`OPENAI_API_KEY` / `DASHSCOPE_API_KEY` / `ZHIPU_API_KEY` / `VOYAGE_API_KEY` / `COHERE_API_KEY` / `HF_TOKEN` 等） | 全部 absent |
| 仓库内已配置凭据的远端 provider | 仅 DeepSeek（`.deepseek_api_key`，gitignored，值不入产物） |
| DeepSeek embeddings 能力探测（载荷＝2 条手工合成 fixture） | `POST /v1/embeddings` → **HTTP 404**；`POST /embeddings` → **HTTP 404** |
| 判定 | `CAPABILITY_ABSENT`（证据：`evidence/remote-capability-deepseek.json`） |

因此：

```text
REMOTE_QUALIFICATION_RESULT = NOT_QUALIFIABLE_IN_THIS_ENVIRONMENT
```

- 唯一持凭据的远端 provider **不提供 embeddings 能力**；
- 无任何其它远端 embedding provider 凭据；
- 即便存在远端候选，其实现仍另需 P1-T02 / GATE-2 出网授权——**本票不激活 T02**。

按 `UNKNOWN != PASS`，REMOTE 侧既未 PASS 也未 FAIL，而是记录为"本机不可资格化"。
这不构成选择 LOCAL 的唯一理由，但与 §4.3 的本地质量证据合并后，LOCAL 是本轮唯一可裁决的选项。

---

## 7. CAVEATS（必须随任何后续实现 / 产品声明存活）

**CAVEAT-1（已知模型限制 + 架构归属）**：所有三候选在同锚点对立判别（AC_4b）上均不完美；
L2 的最佳结果是 I1 = −0.0816（仍偏好表层词面重叠）。按 **Spec §3.2**，
`Contradictory` 维度已被显式迁移到 **retrieval / soft features / diagnostics /
opposing-query / claim-stage**，而非 hard selector quotas，也**不是** dense geometry 的职责。
因此该限制不否定本 profile，但产生硬约束：

> **T11（dense semantic layer）不得仅凭余弦相似度判定 claim 对立；T13/T14 必须在 claim-stage
> 实现对立识别。** 该约束应随 T01 结论传递，不得在下游被静默忽略。

**CAVEAT-2（采样范围）**：证据来自 1 个手工 battery、3 个候选、单机 CPU、合成中文文本；
不是跨领域普遍证明，不含真实知乎语料的端到端验收（那是 T16 dogfood 的职责）。

**CAVEAT-3（依赖与体积）**：L2 需 103 MB 模型权重与进程内 ONNX runtime。本票仅以
**discovery-scoped devDependency** 形式引入（独立 `package.json`，不污染任何生产包）。
T10 若采纳该 profile，须自行按 `RULES.md` §7 记录理由并通过其 review 将依赖提升为生产依赖。

**CAVEAT-4（时延为 CPU 单次观测）**：1469 ms / 32 批为本机 Node 22 / darwin 单次测量，
未经真实语料规模压力测试；T10 须做实现验证（见 §4.3 回退条款）。

**CAVEAT-5（历史 harness 模型未被默认批准）**：`bge-small-zh-v1.5` 经实测后**未被选中**；
选中的 `bge-base-zh-v1.5` 是依据本 battery 的实测判别力数据，与 harness 历史无关。

---

## 8. 复现命令

```bash
cd discovery/p1-t01-embedding-qualification
npm install --registry=https://registry.npmjs.org

# 一次性入站获取模型权重（需代理时启用 Node env-proxy）
export HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 NODE_USE_ENV_PROXY=1
npm run fetch-model                                   # L1: Xenova/bge-small-zh-v1.5
node fetch-model.mjs --model Xenova/bge-base-zh-v1.5 --dir ./models-bge-base-zh-v1.5   # L2

# 跑 battery
node qualify-embedding-provider.mjs --provider transformersjs-local-bge-small-zh-v1.5
P1_T01_ONNX_MODEL=Xenova/bge-base-zh-v1.5 \
P1_T01_ONNX_MODEL_DIR="$PWD/models-bge-base-zh-v1.5" \
  node qualify-embedding-provider.mjs --provider transformersjs-local-onnx
node qualify-embedding-provider.mjs --provider lmstudio-local-nomic-embed-text-v1.5

# AC_11 黑洞代理复验
env P1_T01_OFFLINE_ENFORCED=1 HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
    NODE_USE_ENV_PROXY=1 P1_T01_ONNX_MODEL=Xenova/bge-base-zh-v1.5 \
    P1_T01_ONNX_MODEL_DIR="$PWD/models-bge-base-zh-v1.5" \
  node qualify-embedding-provider.mjs --provider transformersjs-local-onnx
```

`git diff --check` 已执行且 clean。凭据值 / 哈希 / 前缀 / 本机私有路径均未进入任何提交产物
（模型权重目录已由 discovery 目录内 `.gitignore` 排除；身份以 revision SHA + 文件 sha256 钉死）。

---

## 9. 交付状态

| 项 | 值 |
|---|---|
| QUALIFICATION_RESULT | **LOCAL** |
| SELECTED_PROVIDER | `transformersjs-local-onnx` |
| SELECTED_MODEL_PROFILE | `Xenova/bge-base-zh-v1.5`（quantized ONNX） |
| DECISION_ARTIFACT | `docs/t01-accepted-embedding-implementation-profile-decision.md`（同一 exact HEAD） |
| DECISION_STATUS | `NON_AUTHORITATIVE_CANDIDATE` |
| NO_NEW_EGRESS | **YES** |
| REQUIRES_REMOTE_EGRESS_AUTHORITY | **NO** |
| PROJECT_MEMORY_UPDATE_REQUIRED | **YES**（见 §10） |
| REQUIRED_REVIEWER | `EVIDENCE_REVIEWER` |
| IMPLEMENTATION_AUTHORIZATION | **P1-T01 ONLY** |

---

## 10. PROJECT_MEMORY_UPDATE_REQUIRED = YES

理由（不是机械更新）：本票产生了一条 **durable runtime/qualification fact**——
本机已加载的 `text-embedding-nomic-embed-text-v1.5` 在中文上退化（不同中文句可产生余弦恰为 1.0
的相同向量），且该 loopback provider 对未知模型名静默回退。后续 Agent 若不经此记录，
很可能再次把"已加载的现成本地模型"当作 P1 embedding 的默认选择而重复踩坑。

按 `AGENTS.md` §10.3 与 `docs/project-memory.md` Maintenance Contract，**post-gate durable
knowledge 走独立 `docs/memory` follow-up branch**：本票**不**在已审 HEAD 上追加 memory 编辑，
也不在 review PASS 后回改本分支。reviewer 只需报告
`POST_GATE_MEMORY_UPDATE_REQUIRED: YES | NO`；若 YES，由独立 follow-up branch 单独 review 后合入。
