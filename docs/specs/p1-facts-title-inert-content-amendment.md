# P1 provider facts.title 惰性内容合同修正

Status: APPROVED

Owner authorization: `AUTHORIZE_NARROW_FACTS_TITLE_CONTENT_CONTRACT_ADJUSTMENT`（2026-10-12）。
本授权批准下述窄合同；实现仍须通过本文 §4 的 exact-SHA 门禁后集成。

## 1. Amendment targets

仅澄清 `p1-cross-question-deep-research.md` §5.1、§5.4、§10.1 中 provider
候选 `facts.title` 的内容／隐私准入，以及 `p2-ari-f02-targeted-requery.md` §9、§10
对该字段的安全投影。其余条款、RULES §1/§5/§11、V2/V0.3、checkpoint、verify、
handoff、selector、rank、STOP 和 #108 查询授权合同继续有效。#109/#110/#111/#112
不在本修正范围。

## 2. 内容与权限

`facts.title = UNTRUSTED_INERT_CONTENT`。外部标题中的 `/etc/hosts`、
`/usr/local/bin`、`C:\Users\example`、`../foo`、`--flag`、URL、shell/code/path
片段可以是合法研究文本。形状本身不授予执行能力；本机存在同名公共系统文件
也不证明文本来自本机。标题原值保持不变，不删字段、删 record 或为 live title 写特例。

该字段和派生值不取得 filesystem path、query/control instruction、tool argument、
command、trusted plan、checkpoint 或 STOP authority。将来真正进入这些敏感 sink 时，
必须重新经过该 sink 原有严格 validator；不得将 title 加入 `trustedPlanStrings`。

凭据、secret-bearing local content、实际本机私有路径及 runtime metadata 仍不得持久化。
来源资格与隐私是两个独立门：既有凭据／URL 编码／长度／JSON／key／异常检查保留；
当前实际 homedir、CWD、临时目录、config/model/workDir 路径上下文另行拒绝，
只检查非 secret 的路径身份及可识别编码／别名，不读取凭据或本机文件内容。
未知必需上下文不得按空值放行。不用文件存在性把公共路径文本判为私有。

此处不声称识别互联网上任意未知私有路径或无标识裸 secret。必须审计 canonical
producer 无本机 config、凭据、路径、error 或 private runtime metadata → successful
title 的数据流；若出现具体未覆盖泄漏或必需来源／隐私证明缺口，继续 fail closed。

## 3. 来源绑定与既有恢复合同

只有固定官方 search CLI 的成功读取路径、固定 canonical global-search bridge child
的成功 HTTP 读取路径可产生不可由 provider JSON 伪造的进程内来源 receipt。
receipt 绑定实际解析的 exact stdout/body；adapter 在原 success、question、provider
与 source 合同通过后，绑定 facts 对象、title 原值、question ID 和 provider/route。
自报 origin、公开 URL、任意 injectable runner/transport、非 canonical child override
不能取得资格。

RRF 只显式保留同值、同身份／来源的 facts 复制资格；普通 clone、JSON roundtrip、
值替换、getter 或不同身份不继承。generic `projectSafeJson`、其他 facts 字段与 metadata
继续原门；artifact walk 仅对 canonical candidate 中该绑定 facts 的 title 使用内容 lens。
RRF 不读取路径／凭据，不改变排序、重复／冲突或 canonical-first facts 语义。

JSON 不保存 WeakMap 资格。恢复沿用既有 trusted controller checkpoint：只能在既有
run/plan/config/occurrence owner 已提供 expected hash 后，对同一次读取的 exact bytes
核验哈希并解析这些 bytes，再根据已有 canonical candidate/provider/first-rank/route
合同恢复 title 绑定和隐私检查。普通 JSON、自报 hash 或未绑定读取不授予资格。
本修正不增加持久化 origin 字段、身份公式、认证密钥、credential store 或状态机。

恢复仍依赖现行 trusted owner state；不声称抵抗同时篡改 checkpoint 和 artifact 的
本机可信操作者。旧合法 artifact 保持格式和字节兼容；原前置 RRF facts 投影未允许的
path-shaped title 不可能因旧版本合法生产而获得新豁免。未知 provider/route 或绑定
失败仍按旧 generic 门拒绝；不得改写旧证据、丢弃 checkpoint 或静默重启 run。

## 4. 生效与证明门

实现须有原版 adapter→RRF `FUSION_UNSAFE_PROVIDER_DATA` 合成 RED、同输入 GREEN、
凭据／当前私有路径／元数据／伪造来源／复制变值／跨字段借权／控制 sink 负对照，
以及 focused、full offline、historical compatibility、fresh clone、CI 和 owner 指定的
一个独立 SECURITY/CONTRACT reviewer 对同一 exact HEAD 的审查。

reviewer 必须明确证明：

```text
TRUST_SURFACE_EXPANDED = NO
CONTROL_AUTHORITY_EXPANDED = NO
FILESYSTEM_AUTHORITY_EXPANDED = NO
QUERY_AUTHORITY_EXPANDED = NO
TRUE_SENSITIVE_SINK_GUARDS_PRESERVED = YES
```

其中 trust surface 指可信指令／控制／隐私权限；仅惰性外部内容的准入集合按本合同调整。
任一项、来源、私有上下文或恢复绑定无法证明时：`STOP = USER_DECISION_REQUIRED`。

集成产生新 master SHA 后，C1 baseline/candidate 必须在该同一 exact SHA 上重跑；
可复用冻结 question、case metadata 和明确 C1-R1 选择，不能跨 SHA 配对。
C1 完成后继续冻结 C2/C3，保留历史失败／完成证据。
