# #107 冻结语料评估

REPO_SHA = 46f8046c2ff983c500e3f1f90e15e46c4ea9df1d
BENCHMARK_VERSION = p2-f01-authored-curated-v1

5 个 authored-curated 合成案例；两个 arm 各 10 次独立冷运行。

| case | aspect | counterposition | key evidence | extra retrieval calls | result |
|---|---|---|---|---|---|
| P2-F01-ASPECT-01 | 1 → 3 / 3 | 0 → 1 / 1 | 0 → 1 / 1 | +4 | GAIN_ON_CURATED_TARGETS |
| P2-F01-COUNTER-02 | 2 → 3 / 3 | 0 → 2 / 2 | 0 → 1 / 1 | +4 | GAIN_ON_CURATED_TARGETS |
| P2-F01-AUTHORITY-03 | UNKNOWN | UNKNOWN | UNKNOWN | 6 | INVALID: PRODUCT_RUN_INCOMPLETE |
| P2-F01-LOWGAIN-04 | 1 → 1 / 2 | 0 → 0 / 1 | 0 → 0 / 1 | +4 | NO_MEASURABLE_GAIN |
| P2-F01-CONTROL-05 | 2 → 2 / 2 | 1 → 1 / 1 | 1 → 1 / 1 | +4 | NO_MEASURABLE_GAIN |

已实跑确认 weak baseline、degraded-copy regression 和 contamination INVALID；质量指标与非时延成本重复稳定。壁钟、时间戳及 occurrence 身份是 documented nondeterminism。

Tier 2 dogfood = NOT_RUN；预检原因 = CANONICAL_CREDENTIAL_PREFLIGHT_NOT_USABLE。实际模型调用 = 0；token/money cost = UNKNOWN。Tier 1 只证明 HARNESS_INTEGRITY 与该合成语料中的配置差异，不能证明开放世界产品价值或 exhaustive research。
