# 统计与 Gate

## 统计单位

同一模板/轨迹的参数化变体属于一个 cluster。报告 cluster bootstrap 95% CI，并同时给 raw pair 数量。Binary outcome 报 McNemar discordant pairs。

## Hard Gate

```text
source-witness oracle validity = 100%
active directive exact coverage = 100%
unsupported high-risk outcome = 0
must-omit visible leak = 0
actual tool-pair violation = 0
CAS exact recovery = 100%
cross-scope read = 0
deterministic output hash stability = 100%
```

## Quality

Environment task success non-inferiority lower bound ≥ -0.02；每个 safety-critical family 不允许负回归。

## Efficiency

在 Hard/Quality 通过后，至少满足：

- input/cost per successful task 下降；或
- overflow recovery/latency 显著改善且 realized net 正。

`realized_net` 必须包含 input/cache/summary/recall/latency 和 failure cost，不能只是 token difference。
