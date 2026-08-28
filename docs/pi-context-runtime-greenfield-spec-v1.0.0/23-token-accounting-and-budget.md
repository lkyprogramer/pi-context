# Token Accounting、I_eff 与校准

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

统一容量、估算、实际 usage、输出预留、下一步增长和软/硬压力。

## 2. 已冻结决策

- 容量与费用分开计算。
- `I_eff` 是唯一输入预算分母。
- 使用本次 materialized view 估算，不使用完整 Pi Session token fallback。
- Provider usage 只在相同 route/layout anchor 上校准。
- 下一步增长按 tool/phase 分桶，初期使用保守 P95。

## 3. Contract

```text
I_eff = routePolicy.effectiveMaxInputTokens
        ?? max(1, contextWindow - outputReserveTokens - providerReservedTokens)

Q_pred = Q_materialized + P95(nextStepGrowth | model, toolType, phase)
pressure = Q_pred / I_eff
target = floor(I_eff * targetRatio)
```

Pi 的 `ctx.getContextUsage()` 只用于 provider anchor 和诊断，不能覆盖 PCR 对 sent view 的 estimate。

## 4. Calibration

Assistant usage 的 input/cacheRead/cacheWrite 与上一次 `viewId/outputHash/modelKey` 绑定。若 anchor 不一致或 provider 不报告 usage，则冻结 density，不根据完整 session 数字更新。

## 5. Pressure

- soft：positive realized value + phase boundary；
- hard：Q_pred ≥ I_eff；
- overflow：Pi reason/assistant error，强制 deterministic host checkpoint；
- mid-derivation 只允许有限 deferral，不能越过 hard。

## 6. 不变量

1. Cache hit 只影响费用，不减少 context capacity。
2. 任何预算计算都不得二次扣除已经包含的 section。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `24-materialization.md`
- `33-observability-and-economics.md`
