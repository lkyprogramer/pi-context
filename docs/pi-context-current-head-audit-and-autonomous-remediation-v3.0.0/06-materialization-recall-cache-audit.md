# Materialization、Recall 与 Cache Economics 审计

## 改进

- System Prompt 和 Tool Schema 进入 I_eff；
- Directory、Recall Page、Lease Warning 已进入产品 materializer；
- B1 Identity 与 B2 PCR Materializer 已拆开；
- Usage 记录绑定 viewId；
- cacheRead/cacheWrite 尝试从 Assistant Entry 读取。

## 缺口

1. Lease 是进程内状态，重启语义不成立；
2. Provider reserve/cache 的来源并非统一 Host Contract；
3. `input + cacheRead` 是 logical context 近似，不是 billed monetary cost；
4. 缺少目标 provider 的 live cache ablation；
5. Recall-needed 与 recall-not-needed 的误召回/漏召回没有 publication 级成对统计；
6. B2 的 Directory/Recall Layer Token Breakdown 没有成为 Gate 一等指标。

## 必须拆分的指标

```text
checkpointTokens
materializedViewTokensByLayer
requestLogicalInputTokens
providerInputTokens
providerCacheReadTokens
providerCacheWriteTokens
outputTokens
estimatedEffectiveInputTokens
monetaryCostMicros (只有价格与折扣已知时)
```

未知字段必须保留 `null + source=unavailable`，不得用 0 代替。
